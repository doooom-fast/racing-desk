using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using NUnit.Framework;
using RacingDesk.Data.Pedals;
using RacingDesk.Host;

namespace RacingDesk.Tests.IRacing
{
    /// <summary>
    /// The host stops when the app that started it goes, and is gone within a few seconds of that whatever holds it up.
    /// On 2026-09-29 the app was quit as the sim closed; the host logged the sim going, saved the session and the car's
    /// view, and then stayed, with no app, holding e_sqlite3.dll, until it was ended by hand. Its main thread had never
    /// got past starting the SDK (SdkStartTests), so the stop the parent watch asked for was heard by nothing.
    /// These run that again with a stand-in for the app: a process with no window that lives until its input is closed.
    /// Nothing here listens on a port or opens a store.
    /// </summary>
    [TestFixture]
    public class HostStopTests
    {
        private readonly List<IDisposable> _cleanup = new List<IDisposable>();

        [TearDown]
        public void TearDown()
        {
            foreach (var d in _cleanup) try { d.Dispose(); } catch { }
            _cleanup.Clear();
        }

        /// <summary>
        /// A HostStop and what it did, one to a test: a deadline a test leaves running lands on its own and not on the
        /// next test's.
        /// </summary>
        private sealed class Stopping
        {
            private readonly List<string> _log = new List<string>();
            private int _ends;

            public readonly ManualResetEventSlim Stop = new ManualResetEventSlim();
            public readonly ManualResetEventSlim Ended = new ManualResetEventSlim();
            public readonly HostStop Host;
            public DateTime AskedAt, EndedAt;

            public Stopping(TimeSpan grace, Action? release = null)
            {
                Host = new HostStop(Stop, grace, m =>
                {
                    lock (_log) { if (_log.Count == 0) AskedAt = DateTime.UtcNow; _log.Add(m); }
                }, null, () =>
                {
                    // In the host this ends the process. Here it notes when, for the test runner is the process.
                    EndedAt = DateTime.UtcNow;
                    Interlocked.Increment(ref _ends);
                    Ended.Set();
                }, release);
            }

            public int Ends => Volatile.Read(ref _ends);
            public List<string> Log() { lock (_log) return _log.ToList(); }
        }

        /// <summary>The app, as the host sees it: a process, which quits when its input is closed. No window.</summary>
        private Process App()
        {
            var app = Process.Start(new ProcessStartInfo("cmd.exe", "/d /q /c \"set /p _=\"")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardInput = true,
            })!;
            _cleanup.Add(new Cleanup(() => { if (!app.HasExited) app.Kill(); app.Dispose(); }));
            return app;
        }

        private static void Quit(Process app)
        {
            app.StandardInput.Close();
            Assert.That(app.WaitForExit(5000), Is.True, "the stand-in for the app did not quit");
        }

        private sealed class Cleanup : IDisposable
        {
            private readonly Action _dispose;
            public Cleanup(Action dispose) => _dispose = dispose;
            public void Dispose() => _dispose();
        }

        /// <summary>A save that waits, as one waits on the store while another connection holds it.</summary>
        private static CarPedalsRecorder Pedals(ManualResetEventSlim saving, ManualResetEventSlim storeFree, List<PedalsSeen> saved) =>
            new CarPedalsRecorder(() => null, _ => null!, () => true, () => DateTime.UtcNow, seen =>
            {
                saving.Set();
                storeFree.Wait();
                lock (saved) saved.Add(seen);
            });

        [Test]
        public void TheAppGoingWhileASimGoneSaveWaitsEndsTheHostWithinTheGrace()
        {
            var grace = TimeSpan.FromSeconds(1);
            var stopping = new Stopping(grace);
            var app = App();
            stopping.Host.WatchParent(app.Id);

            // The sim closes: the SDK's thread hands over what the run left, and the save waits on the store.
            using var saving = new ManualResetEventSlim();
            var storeFree = new ManualResetEventSlim();
            _cleanup.Add(new Cleanup(storeFree.Set));
            var saved = new List<PedalsSeen>();
            var pedals = Pedals(saving, storeFree, saved);
            pedals.See("hondacivictyper", absSetting: true, absWorking: false, lapsCompleted: 9);
            new Thread(() => pedals.SimGone()) { IsBackground = true, Name = "sdk (disconnected)" }.Start();
            Assert.That(saving.Wait(5000), Is.True);

            // And the host's main thread is where the one of 19:28 was: in a start that did not return, short of the
            // loop that hears the stop. Past it, it would stop in order.
            var started = new ManualResetEventSlim();
            _cleanup.Add(new Cleanup(started.Set));
            new Thread(() =>
            {
                started.Wait();            // let go when the test is over, and then it is too late
                stopping.Stop.Wait();
                pedals.SimGone();
                stopping.Host.Stopped();
            }) { IsBackground = true, Name = "main" }.Start();

            Thread.Sleep(300);
            Assert.That(stopping.Stop.IsSet, Is.False, "the app is still here");
            Assert.That(stopping.Ended.IsSet, Is.False);

            var quit = DateTime.UtcNow;
            Quit(app);

            Assert.That(stopping.Stop.Wait(2000), Is.True, "the stop is asked for as soon as the app has gone");
            Assert.That(stopping.Ended.Wait(5000), Is.True, "and the host is ended, though nothing in it could stop");
            Assert.That(stopping.EndedAt - quit, Is.GreaterThanOrEqualTo(grace - TimeSpan.FromMilliseconds(50)).And.LessThan(grace + TimeSpan.FromSeconds(2)));
            Assert.That(saved, Is.Empty, "the save that could not be made is left: nothing of it is committed");
            var log = stopping.Log();
            Assert.That(log[0], Is.EqualTo($"the app that started this host (pid {app.Id}) has gone — stopping"));
            Assert.That(log[1], Does.StartWith("the stop was not over 1 s after it was asked for — ending the process"));
            Assert.That(log, Has.Count.EqualTo(2));
            Assert.That(stopping.Ends, Is.EqualTo(1));
        }

        [Test]
        public void ASimGoneSaveThatCanFinishIsKeptBeforeTheHostEnds()
        {
            // Longer than the others: the stop has to be seen over well inside it, on a machine that may be busy.
            var grace = TimeSpan.FromSeconds(4);
            var stopping = new Stopping(grace);
            var app = App();
            stopping.Host.WatchParent(app.Id);

            using var saving = new ManualResetEventSlim();
            using var storeFree = new ManualResetEventSlim();
            var saved = new List<PedalsSeen>();
            var pedals = Pedals(saving, storeFree, saved);
            pedals.See("hondacivictyper", absSetting: true, absWorking: false, lapsCompleted: 9);
            var sdkThread = new Thread(() => pedals.SimGone()) { IsBackground = true, Name = "sdk (disconnected)" };
            sdkThread.Start();
            Assert.That(saving.Wait(5000), Is.True);

            // The main thread in its loop, as it is now that the start returns: it hears the stop and stops in order.
            // The save under way is the SDK thread's, and the process waits for that thread (IRSDKSharper's threads
            // are not background ones), so the stop is over when the save is.
            using var over = new ManualResetEventSlim();
            DateTime overAt = default;
            new Thread(() =>
            {
                stopping.Stop.Wait();
                pedals.SimGone();          // nothing left for it: the SDK's thread took the run
                sdkThread.Join();
                stopping.Host.Stopped();
                overAt = DateTime.UtcNow;
                over.Set();
            }) { IsBackground = true, Name = "main" }.Start();

            Quit(app);
            Assert.That(stopping.Stop.Wait(2000), Is.True);
            Thread.Sleep(200);             // the store is slow, but not stuck
            storeFree.Set();

            Assert.That(over.Wait(3000), Is.True, "the stop is over once the save is");
            Assert.That(saved.Select(s => (s.CarPath, s.Laps, s.AbsSeen)), Is.EqualTo(new[] { ("hondacivictyper", 0, true) }),
                "kept once, by the thread that had it; the laps are a session's, counted from its first frame");
            Assert.That(overAt - stopping.AskedAt, Is.LessThan(grace), "over within the grace");

            // In the host the process has ended by now. The test runner has not, and the deadline says so.
            Assert.That(stopping.Ended.Wait(grace + TimeSpan.FromSeconds(3)), Is.True);
            Assert.That(stopping.EndedAt, Is.GreaterThan(overAt));
            Assert.That(stopping.Log().Last(), Does.StartWith("stopped, but the process was still here 4 s after the stop was asked for"));
        }

        [Test]
        public void AnAppThatIsNotThereStopsTheHostAtOnce()
        {
            var stopping = new Stopping(TimeSpan.FromSeconds(1));

            // No process has this id: ids are multiples of four, and far smaller.
            stopping.Host.WatchParent(int.MaxValue);

            Assert.That(stopping.Stop.Wait(2000), Is.True);
            Assert.That(stopping.Log().Single(), Is.EqualTo($"the app that started this host (pid {int.MaxValue}) has gone — stopping"));
            Assert.That(stopping.Ended.Wait(5000), Is.True);
        }

        [Test]
        public void TheStopIsAskedForOnce()
        {
            var grace = TimeSpan.FromSeconds(1);
            var stopping = new Stopping(grace);

            stopping.Host.Ask("Ctrl+C");
            stopping.Host.Ask("Ctrl+C");
            stopping.Host.Ask("--exit-after 10 s");

            Assert.That(stopping.Stop.IsSet, Is.True);
            Assert.That(stopping.Ended.Wait(5000), Is.True);
            Thread.Sleep(grace + TimeSpan.FromMilliseconds(300));
            Assert.That(stopping.Ends, Is.EqualTo(1), "one deadline");
            Assert.That(stopping.Log(), Is.EqualTo(new[]
            {
                "Ctrl+C — stopping",
                "the stop was not over 1 s after it was asked for — ending the process; what was being written is left uncommitted",
            }));
        }

        [Test]
        public void ThePortsAreLetGoOfFirst_BeforeTheHostHearsTheStop_AndOnce()
        {
            // An app that starts while the host is stopping must not find it answering (host-launcher.js would take it for
            // one it can use, and have none when it ends a few seconds on), so the ports go before anything else does.
            int released = 0;
            bool heardTheStopFirst = false;
            Stopping? stopping = null;
            stopping = new Stopping(TimeSpan.FromSeconds(1), () =>
            {
                heardTheStopFirst |= stopping!.Stop.IsSet;
                Interlocked.Increment(ref released);
            });

            stopping.Host.Ask("Ctrl+C");
            stopping.Host.Ask("--exit-after 10 s");

            Assert.That(stopping.Stop.IsSet, Is.True);
            Assert.That(released, Is.EqualTo(1), "once, however often the stop is asked for");
            Assert.That(heardTheStopFirst, Is.False, "before the stop is woken");
            Assert.That(stopping.Ended.Wait(5000), Is.True);
        }

        [Test]
        public void APortsReleaseThatThrowsOrHangsDoesNotKeepTheHostFromStopping()
        {
            var grace = TimeSpan.FromSeconds(1);
            var throwing = new Stopping(grace, () => throw new InvalidOperationException("the listener is gone"));

            Assert.DoesNotThrow(() => throwing.Host.Ask("Ctrl+C"));

            Assert.That(throwing.Stop.IsSet, Is.True, "the host is still told to stop");
            Assert.That(throwing.Ended.Wait(5000), Is.True, "and still ended at the deadline");

            // One that never returns: the clock was started before it, so the process is ended all the same.
            using var hang = new ManualResetEventSlim();
            var hanging = new Stopping(grace, () => hang.Wait());
            new Thread(() => hanging.Host.Ask("Ctrl+C")) { IsBackground = true, Name = "asker" }.Start();
            try
            {
                Assert.That(hanging.Ended.Wait(5000), Is.True, "the deadline does not wait for the release");
            }
            finally
            {
                hang.Set();
            }
        }

        [Test]
        public void AStopAskedForAfterTheEventIsDisposedStillEndsTheProcess()
        {
            // The host does not dispose of it, for this reason; should anything, the stop is still asked for.
            var stopping = new Stopping(TimeSpan.FromSeconds(1));
            stopping.Stop.Dispose();

            Assert.DoesNotThrow(() => stopping.Host.Ask("the app that started this host (pid 1) has gone"));
            Assert.That(stopping.Ended.Wait(5000), Is.True);
        }
    }
}
