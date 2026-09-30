using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace RacingDesk.Host
{
    /// <summary>One monitor Windows has, as it is laid out on the virtual screen, in physical pixels.</summary>
    internal sealed class MonitorInfo
    {
        public ScreenRect Bounds { get; set; }

        /// <summary>Whether Windows has it as the main one (the one at the origin).</summary>
        public bool Primary { get; set; }
    }

    /// <summary>Lists the monitors. The real one asks Windows; tests give another, so no monitor is looked up.</summary>
    internal interface IMonitorSource
    {
        /// <summary>Every monitor Windows has now; empty when it has none to report. Throws when it cannot look.</summary>
        IReadOnlyList<MonitorInfo> List();
    }

    /// <summary>
    /// The answer to <c>GET /racing-desk/data/monitors</c>, which the app's HUD asks so that a screen is named by the size
    /// it really has: Electron gives a screen's size in device-independent pixels, rounded up, and at 175 % that cannot be
    /// turned back into the panel's own (823 wide is 1440 physical here, but 1439 is 823 wide too). Read-only, and
    /// nothing of the monitors but where they are.
    /// </summary>
    internal static class MonitorsApi
    {
        /// <summary><c>[ { "x", "y", "width", "height", "primary" } ]</c>, in physical pixels, a monitor with no size left out.</summary>
        public static void Write(Utf8JsonWriter json, IReadOnlyList<MonitorInfo> monitors)
        {
            json.WriteStartArray();
            if (monitors != null)
            {
                foreach (var monitor in monitors)
                {
                    if (monitor == null || !monitor.Bounds.IsUsable) continue;
                    json.WriteStartObject();
                    json.WriteNumber("x", monitor.Bounds.X);
                    json.WriteNumber("y", monitor.Bounds.Y);
                    json.WriteNumber("width", monitor.Bounds.Width);
                    json.WriteNumber("height", monitor.Bounds.Height);
                    json.WriteBoolean("primary", monitor.Primary);
                    json.WriteEndObject();
                }
            }
            json.WriteEndArray();
        }
    }

    /// <summary>The monitors, from Windows (<c>EnumDisplayMonitors</c>), in physical pixels: the look is made per-monitor aware.</summary>
    internal sealed class Win32MonitorSource : IMonitorSource
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

            using (new PerMonitorAwareScope())
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
