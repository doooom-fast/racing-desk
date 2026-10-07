using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using NUnit.Framework;
using RacingDesk.Plugin.Engine;

namespace RacingDesk.Tests.IRacing
{
    /// <summary>
    /// The SimHub plugin asks the app's host for the track's outline. With the app closed nobody answers, and the plugin
    /// asked every five seconds all the same, each ask a failed connection whose exceptions SimHub logs with their stacks.
    /// Now it looks first whether anything listens at the host's port (and asks nobody if not), and asks less often each
    /// time it finds no host — five seconds, then twice as long each time, up to two minutes — and says so once.
    /// </summary>
    [TestFixture]
    public class OutlineBackOffTests
    {
        private sealed class NoHost : IOutlineSource, IOutlineSourceReachability
        {
            public bool Listening;
            public int Asked, Looked;
            public bool Reachable() { Interlocked.Increment(ref Looked); return Listening; }
            public TrackOutline Get(int trackId)
            {
                Interlocked.Increment(ref Asked);
                throw new System.Net.Http.HttpRequestException("refused");
            }
        }

        private static void Settle(TrackMapProvider map, Func<int> looked, int want)
        {
            for (int i = 0; i < 1000; i++)
            {
                map.Update(0.1, new float[0], new bool[0], 0, 1);
                if (looked() >= want && !map.Asking) break;
                Thread.Sleep(10);
            }
            map.Update(0.1, new float[0], new bool[0], 0, 1);
        }

        [Test]
        public void WithNoHostTheAsksComeLessOftenUpToTwoMinutes_AndNothingIsThrown()
        {
            var clock = new DateTime(2026, 10, 7, 20, 0, 0, DateTimeKind.Utc);
            var source = new NoHost();
            var map = new TrackMapProvider { Outlines = source, Clock = () => clock };
            var lines = new List<string>();
            var was = RacingDesk.Plugin.Log.Sink;
            RacingDesk.Plugin.Log.Sink = (level, text) => { lock (lines) lines.Add(text); };
            try
            {
                map.OnTrackChanged(777, "square");
                Settle(map, () => Volatile.Read(ref source.Looked), 1);
                Assert.That(map.Status, Is.EqualTo(TrackMapProvider.StatusNoHost));

                foreach (int expected in new[] { 5, 10, 20, 40, 80, 120, 120, 120 })
                {
                    int looked = source.Looked;
                    // Not asked a second before it is due…
                    clock = clock.AddSeconds(expected - 1);
                    map.Update(0.1, new float[0], new bool[0], 0, 1);
                    Assert.That(source.Looked, Is.EqualTo(looked), $"not asked before {expected} s");
                    // …and asked when it is.
                    clock = clock.AddSeconds(1);
                    Settle(map, () => Volatile.Read(ref source.Looked), looked + 1);
                    Assert.That(source.Looked, Is.EqualTo(looked + 1), map.Trace);
                }
                Assert.That(source.Asked, Is.EqualTo(0), "with nothing listening nobody is asked, so nothing is thrown");
                lock (lines)
                    Assert.That(lines.Count(l => l.Contains("the host did not answer")), Is.EqualTo(1), string.Join("\n", lines));

                // Something listens at the port: it is asked.
                source.Listening = true;
                clock = clock.AddSeconds(120);
                Settle(map, () => Volatile.Read(ref source.Asked), 1);
                Assert.That(source.Asked, Is.EqualTo(1), "asked once it listens (and it throws: no host after all)");
            }
            finally
            {
                RacingDesk.Plugin.Log.Sink = was;
            }
        }

        [Test]
        public void TheBackOffDoublesFromFiveSecondsToTwoMinutes()
        {
            var waits = Enumerable.Range(1, 9).Select(n => TrackMapProvider.NoHostBackOff(n).TotalSeconds).ToArray();
            Assert.That(waits, Is.EqualTo(new double[] { 5, 10, 20, 40, 80, 120, 120, 120, 120 }));
            Assert.That(TrackMapProvider.NoHostBackOff(int.MaxValue), Is.EqualTo(TimeSpan.FromMinutes(2)));
        }

        [Test]
        public void ANewLayoutIsAskedForAtOnce_AndStartsFromFiveSeconds()
        {
            var clock = new DateTime(2026, 10, 7, 20, 0, 0, DateTimeKind.Utc);
            var source = new NoHost();
            var map = new TrackMapProvider { Outlines = source, Clock = () => clock };
            map.OnTrackChanged(777, "square");
            for (int i = 1; i <= 4; i++)
            {
                Settle(map, () => Volatile.Read(ref source.Looked), i);
                clock = clock.AddSeconds(TrackMapProvider.NoHostBackOff(i).TotalSeconds);
            }
            int looked = source.Looked;
            map.OnTrackChanged(778, "elsewhere");
            Settle(map, () => Volatile.Read(ref source.Looked), looked + 1);
            Assert.That(source.Looked, Is.EqualTo(looked + 1), "asked at once for the new layout");
            clock = clock.AddSeconds(5);
            Settle(map, () => Volatile.Read(ref source.Looked), looked + 2);
            Assert.That(source.Looked, Is.EqualTo(looked + 2), "and again five seconds on");
        }

        private static int FreePort()
        {
            var l = new TcpListener(IPAddress.Loopback, 0);
            l.Start();
            int port = ((IPEndPoint)l.LocalEndpoint).Port;
            l.Stop();
            return port;
        }

        [Test]
        public void TheHostSourceSeesWhetherAnythingListensAtItsPort_WithoutAsking()
        {
            int port = FreePort();
            using var source = new HostOutlineSource($"http://127.0.0.1:{port}");
            Assert.That(source.Reachable(), Is.False, "nothing listens");

            using (var listener = new HttpListener())
            {
                listener.Prefixes.Add($"http://127.0.0.1:{port}/racing-desk/data/");
                listener.Start();
                Assert.That(source.Reachable(), Is.True, "the host's HTTP.sys listener");
                listener.Stop();
            }
            Assert.That(source.Reachable(), Is.False, "and gone again");

            var tcp = new TcpListener(IPAddress.Loopback, port);
            tcp.Start();
            try
            {
                using var byName = new HostOutlineSource($"http://localhost:{port}");
                Assert.That(byName.Reachable(), Is.True, "localhost names this machine too");
            }
            finally { tcp.Stop(); }

            // An address elsewhere: only asking can tell.
            using var elsewhere = new HostOutlineSource("http://192.0.2.1:28889");
            Assert.That(elsewhere.Reachable(), Is.True);
        }
    }
}
