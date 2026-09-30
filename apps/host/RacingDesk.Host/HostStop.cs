using System;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Threading;

namespace RacingDesk.Host
{
    /// <summary>
    /// Asks the host to stop, and sees that it does. The stop is asked for by Ctrl+C, by --exit-after, or by the app
    /// that started the host going away (--parent-pid); the orderly stop that follows flushes what is being recorded.
    /// From the moment it is asked for, the process has <see cref="Grace"/> to end, and if it is still here after that
    /// it ends itself, whatever holds it up — a start that never returned, a save waiting on a lock, a library's thread
    /// that does not finish. A host whose app has gone must not stay behind holding its ports and its DLLs (on
    /// 2026-09-29 one did, and the next build could not replace e_sqlite3.dll). What was being written when it ends is
    /// left uncommitted: the store is SQLite in WAL mode, and stays as it was at its last commit.
    /// </summary>
    internal sealed class HostStop
    {
        /// <summary>
        /// What the orderly stop is given. Nothing holding it up, it takes tens of milliseconds beside SimHub and a few
        /// hundred with the hardware open (joining the Moza and screen threads), and the stores' writes come first. The
        /// longest wait in it is CarListRemarkKeeper's, up to 5 s for remarks a slow store has not taken — and those are
        /// said again the next time the car is driven.
        /// </summary>
        public static readonly TimeSpan DefaultGrace = TimeSpan.FromSeconds(5);

        private readonly ManualResetEventSlim _stop;
        private readonly Action<string> _log;
        private readonly Action<string> _warn;
        private readonly Action _end;
        private int _asked;
        private volatile bool _stopped;

        public TimeSpan Grace { get; }

        /// <param name="stop">What the host's loops wait on.</param>
        /// <param name="end">Ends the process; by default at once, with nothing run on the way out (tests pass their own).</param>
        public HostStop(ManualResetEventSlim stop, TimeSpan grace, Action<string> log, Action<string> warn = null, Action end = null)
        {
            _stop = stop ?? throw new ArgumentNullException(nameof(stop));
            Grace = grace;
            _log = log ?? (_ => { });
            _warn = warn ?? _log;
            _end = end ?? EndProcess;
        }

        /// <summary>Asks for the stop. The first ask starts the clock; asking again changes nothing.</summary>
        public void Ask(string why)
        {
            if (Interlocked.Exchange(ref _asked, 1) != 0) return;
            _log(why + " — stopping");
            try { _stop.Set(); } catch (ObjectDisposedException) { /* the orderly stop is already over */ }
            new Thread(Deadline) { IsBackground = true, Name = "stop-deadline" }.Start();
        }

        /// <summary>Asks for the stop when process <paramref name="pid"/> exits, or at once when it is not running.</summary>
        public void WatchParent(int pid)
        {
            new Thread(() =>
            {
                try
                {
                    using var parent = Process.GetProcessById(pid);
                    parent.WaitForExit();
                }
                catch (Exception)
                {
                    // Not running (ArgumentException), or not to be asked about: either way there is nothing to wait for.
                }
                Ask($"the app that started this host (pid {pid}) has gone");
            }) { IsBackground = true, Name = "parent-watch" }.Start();
        }

        /// <summary>The orderly stop is over; what is left is for the process's own threads to end.</summary>
        public void Stopped() => _stopped = true;

        private void Deadline()
        {
            Thread.Sleep(Grace);
            string seconds = Grace.TotalSeconds.ToString("0.#", CultureInfo.InvariantCulture) + " s";
            try
            {
                _warn(_stopped
                    ? $"stopped, but the process was still here {seconds} after the stop was asked for — ending it"
                    : $"the stop was not over {seconds} after it was asked for — ending the process; what was being written is left uncommitted");
            }
            catch { /* the log is not what ends the process */ }
            _end();
        }

        [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
        [DllImport("kernel32.dll")] private static extern bool TerminateProcess(IntPtr process, uint exitCode);

        // Not Environment.Exit: that runs the runtime's exit handlers first, and this is for when something is already
        // holding things up. TerminateProcess runs nothing and cannot be held.
        private static void EndProcess()
        {
            try { Console.Out.Flush(); } catch { }
            TerminateProcess(GetCurrentProcess(), 3);
        }
    }
}
