using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace RacingDesk.Core.Screens
{
    /// <summary>A rectangle on the virtual screen, in physical pixels.</summary>
    public readonly struct ScreenRect
    {
        public ScreenRect(int x, int y, int width, int height)
        {
            X = x;
            Y = y;
            Width = width;
            Height = height;
        }

        public int X { get; }
        public int Y { get; }
        public int Width { get; }
        public int Height { get; }

        public bool IsUsable => Width > 0 && Height > 0;

        public override string ToString() => $"{Width}x{Height} at ({X}, {Y})";
    }

    /// <summary>
    /// Where the sim's window is: the window itself, and the monitor Windows has most of it on, both in physical pixels.
    /// </summary>
    public sealed class SimWindowInfo
    {
        /// <summary>The sim's process, by name: iRacingSim64DX11 or iRacingSim64.</summary>
        public string Process { get; set; }

        public ScreenRect Window { get; set; }

        public ScreenRect Monitor { get; set; }
    }

    /// <summary>Finds the sim's window. The real one asks Windows; tests give another, so no window is looked up.</summary>
    public interface ISimWindowSource
    {
        /// <summary>The sim's window, or null when the sim is not running or has no window on screen.</summary>
        SimWindowInfo Find();
    }

    /// <summary>
    /// For the length of a look at Windows's screens: the thread asking is made per-monitor aware, which is what gives
    /// physical pixels on a rig with screens of different scales. The host is not DPI-aware, and SimHub is what it is,
    /// so a call made as the process is would be given coordinates scaled to what a program of that kind sees. Dispose
    /// puts the thread back as it was. Only the calling thread is changed, and it makes no window while it is.
    /// </summary>
    internal readonly struct PerMonitorAwareScope : IDisposable
    {
        private static readonly IntPtr PerMonitorAwareV2 = new IntPtr(-4);   // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2

        private readonly IntPtr _before;

        private PerMonitorAwareScope(IntPtr before)
        {
            _before = before;
        }

        public static PerMonitorAwareScope Enter()
        {
            try { return new PerMonitorAwareScope(SetThreadDpiAwarenessContext(PerMonitorAwareV2)); }
            catch (EntryPointNotFoundException) { return new PerMonitorAwareScope(IntPtr.Zero); /* Windows before 10 1607: the numbers are what they are */ }
        }

        public void Dispose()
        {
            if (_before != IntPtr.Zero) SetThreadDpiAwarenessContext(_before);
        }

        [DllImport("user32.dll")]
        private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    }

    /// <summary>
    /// The sim's main window, from Windows, in physical pixels (the look is made per-monitor aware, see
    /// <see cref="PerMonitorAwareScope"/>). The host's <c>/racing-desk/data/simwindow</c> route answers with it, for the HUD
    /// to be put on the same screen.
    /// </summary>
    public sealed class Win32SimWindowSource : ISimWindowSource
    {
        // The sim's executables, the DX11 one first. iRacingUI.exe is the launcher, not the sim.
        private static readonly string[] ProcessNames = { "iRacingSim64DX11", "iRacingSim64" };

        public SimWindowInfo Find()
        {
            foreach (string name in ProcessNames)
            {
                // A look that cannot be made throws, and the route answers 500: that is "not known" to the HUD, which
                // is not the same as null, "the sim is not running". A process that goes between being listed and
                // being asked is gone, and Describe says null for it.
                Process[] found = Process.GetProcessesByName(name);
                try
                {
                    foreach (var process in found)
                    {
                        var info = Describe(name, process);
                        if (info != null) return info;
                    }
                }
                finally
                {
                    foreach (var process in found) process.Dispose();
                }
            }
            return null;
        }

        private static SimWindowInfo Describe(string name, Process process)
        {
            IntPtr window;
            try { window = process.MainWindowHandle; }
            catch (Exception) { return null; }   // gone between being listed and being asked
            if (window == IntPtr.Zero || !IsWindowVisible(window) || IsIconic(window)) return null;

            using (PerMonitorAwareScope.Enter())
            {
                RECT rect;
                if (DwmGetWindowAttribute(window, ExtendedFrameBounds, out rect, Marshal.SizeOf<RECT>()) != 0
                    && !GetWindowRect(window, out rect))
                    return null;

                var frame = new ScreenRect(rect.Left, rect.Top, rect.Right - rect.Left, rect.Bottom - rect.Top);
                if (!frame.IsUsable) return null;

                var monitor = new ScreenRect();
                IntPtr handle = MonitorFromWindow(window, MonitorDefaultToNearest);
                var info = new MONITORINFO { cbSize = Marshal.SizeOf<MONITORINFO>() };
                if (handle != IntPtr.Zero && GetMonitorInfo(handle, ref info))
                    monitor = new ScreenRect(info.rcMonitor.Left, info.rcMonitor.Top, info.rcMonitor.Right - info.rcMonitor.Left, info.rcMonitor.Bottom - info.rcMonitor.Top);

                return new SimWindowInfo { Process = name, Window = frame, Monitor = monitor };
            }
        }

        private const int ExtendedFrameBounds = 9;                  // DWMWA_EXTENDED_FRAME_BOUNDS: the frame without its shadow
        private const uint MonitorDefaultToNearest = 2;             // MONITOR_DEFAULTTONEAREST: the one with most of the window

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
        private static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool IsIconic(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

        [DllImport("user32.dll")]
        private static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint flags);

        [DllImport("user32.dll")]
        private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO info);

        [DllImport("dwmapi.dll")]
        private static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out RECT value, int size);
    }
}
