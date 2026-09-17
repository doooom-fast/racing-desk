using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace RaceCor.Data
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

        /// <summary>True while iRacing's simulator process is running.</summary>
        public static bool SimRunning() => Process.GetProcessesByName("iRacingSim64DX11").Length > 0;

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
