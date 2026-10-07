using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace RacingDesk.Core.Screens
{
    /// <summary>One monitor Windows has, as it is laid out on the virtual screen, in physical pixels.</summary>
    public sealed class MonitorInfo
    {
        public ScreenRect Bounds { get; set; }

        /// <summary>Whether Windows has it as the main one (the one at the origin).</summary>
        public bool Primary { get; set; }
    }

    /// <summary>Lists the monitors. The real one asks Windows; tests give another, so no monitor is looked up.</summary>
    public interface IMonitorSource
    {
        /// <summary>Every monitor Windows has now; empty when it has none to report. Throws when it cannot look.</summary>
        IReadOnlyList<MonitorInfo> List();
    }

    /// <summary>
    /// The monitors, from Windows (<c>EnumDisplayMonitors</c>), in physical pixels: the look is made per-monitor aware.
    /// The host's <c>/racing-desk/data/monitors</c> route answers with them.
    /// </summary>
    public sealed class Win32MonitorSource : IMonitorSource
    {
        private const uint PrimaryMonitor = 1;   // MONITORINFOF_PRIMARY

        public IReadOnlyList<MonitorInfo> List()
        {
            var found = new List<MonitorInfo>();
            MonitorEnumProc callback = (IntPtr monitor, IntPtr dc, ref RECT clip, IntPtr data) =>
            {
                var info = new MONITORINFO { cbSize = Marshal.SizeOf<MONITORINFO>() };
                if (GetMonitorInfo(monitor, ref info))
                {
                    found.Add(new MonitorInfo
                    {
                        Bounds = new ScreenRect(info.rcMonitor.Left, info.rcMonitor.Top, info.rcMonitor.Right - info.rcMonitor.Left, info.rcMonitor.Bottom - info.rcMonitor.Top),
                        Primary = (info.dwFlags & PrimaryMonitor) != 0,
                    });
                }
                return true;
            };

            using (PerMonitorAwareScope.Enter())
            {
                if (!EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, callback, IntPtr.Zero))
                    throw new InvalidOperationException("Windows would not list the monitors");
            }
            GC.KeepAlive(callback);
            return found;
        }

        private delegate bool MonitorEnumProc(IntPtr monitor, IntPtr dc, ref RECT clip, IntPtr data);

        [StructLayout(LayoutKind.Sequential)]
        private struct RECT
        {
            public int Left, Top, Right, Bottom;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MONITORINFO
        {
            public int cbSize;
            public RECT rcMonitor;
            public RECT rcWork;
            public uint dwFlags;
        }

        [DllImport("user32.dll")]
        private static extern bool EnumDisplayMonitors(IntPtr dc, IntPtr clip, MonitorEnumProc callback, IntPtr data);

        [DllImport("user32.dll")]
        private static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
    }
}
