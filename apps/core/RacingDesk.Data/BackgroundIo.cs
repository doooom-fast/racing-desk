using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace RacingDesk.Data
{
    /// <summary>
    /// Puts the calling thread into Windows' background processing mode (low I/O and memory priority) for
    /// the lifetime of the returned handle, so bulk reads yield to the sim.
    /// </summary>
    public static class BackgroundIo
    {
        private const int ThreadModeBackgroundBegin = 0x00010000;
        private const int ThreadModeBackgroundEnd = 0x00020000;

        [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentThread();
        [DllImport("kernel32.dll")] private static extern bool SetThreadPriority(IntPtr thread, int priority);

        public static IDisposable Enter()
        {
            bool entered = OperatingSystem.IsWindows() && SetThreadPriority(GetCurrentThread(), ThreadModeBackgroundBegin);
            return new Scope(entered);
        }

        /// <summary>
        /// True while any sim on the rig is running — iRacing, Assetto Corsa, Assetto Corsa EVO or Competizione
        /// (<see cref="RacingDesk.Core.Sims.SimProcesses.All"/>). The heavy work waits on this whatever he is driving: it
        /// knew iRacing alone until 2026-10-09, and would have read the .ibt history while he raced in Assetto Corsa.
        /// </summary>
        public static bool SimRunning() => SimRunning(ProcessIsRunning);

        /// <summary>The same, asking <paramref name="running"/> for each of the sims' process names (a test's fake).</summary>
        public static bool SimRunning(Func<string, bool> running) => RacingDesk.Core.Sims.SimProcesses.AnyRunning(RacingDesk.Core.Sims.SimProcesses.All, running);

        private static bool ProcessIsRunning(string name)
        {
            Process[] found;
            try { found = Process.GetProcessesByName(name); }
            catch (Exception) { return true; }     // not being able to ask is not the sim being away: wait, as a guard should
            foreach (var p in found) p.Dispose();
            return found.Length > 0;
        }

        private sealed class Scope : IDisposable
        {
            private bool _entered;
            public Scope(bool entered) => _entered = entered;
            public void Dispose()
            {
                if (_entered) SetThreadPriority(GetCurrentThread(), ThreadModeBackgroundEnd);
                _entered = false;
            }
        }
    }
}
