using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace RacingDesk.Host
{
    /// <summary>A rectangle on the virtual screen, in physical pixels.</summary>
    internal readonly struct ScreenRect
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
    }

    /// <summary>
    /// Where the sim's window is: the window itself, and the monitor Windows has most of it on, both in physical pixels.
    /// </summary>
    internal sealed class SimWindowInfo
    {
        /// <summary>The sim's process, by name: iRacingSim64DX11 or iRacingSim64.</summary>
        public string Process { get; set; }

        public ScreenRect Window { get; set; }

        public ScreenRect Monitor { get; set; }
    }

    /// <summary>Finds the sim's window. The real one asks Windows; tests give another, so no window is looked up.</summary>
    internal interface ISimWindowSource
    {
        /// <summary>The sim's window, or null when the sim is not running or has no window on screen.</summary>
        SimWindowInfo Find();
    }

    /// <summary>
    /// The answer to <c>GET /racing-desk/data/simwindow</c>, which the app's HUD asks so that it is drawn on the screen
    /// the sim is on: Electron cannot see another program's windows. Read-only, and nothing of the window but where it is.
    /// </summary>
    internal static class SimWindowApi
    {
        /// <summary>
        /// <c>{ "process", "window": { x, y, width, height }, "monitor": { x, y, width, height } }</c>, in physical
        /// pixels; JSON <c>null</c> when the sim is not running, is minimized or has no window on screen.
        /// </summary>
        public static void Write(Utf8JsonWriter json, SimWindowInfo info)
        {
            if (info == null || !info.Window.IsUsable)
            {
                json.WriteNullValue();
                return;
            }
            json.WriteStartObject();
            json.WriteString("process", info.Process);
            WriteRect(json, "window", info.Window);
            if (info.Monitor.IsUsable) WriteRect(json, "monitor", info.Monitor);
            else json.WriteNull("monitor");
            json.WriteEndObject();
        }

        private static void WriteRect(Utf8JsonWriter json, string name, ScreenRect rect)
        {
            json.WriteStartObject(name);
            json.WriteNumber("x", rect.X);
            json.WriteNumber("y", rect.Y);
            json.WriteNumber("width", rect.Width);
            json.WriteNumber("height", rect.Height);
            json.WriteEndObject();
        }
    }

    /// <summary>
    /// The sim's main window, from Windows. This host is not DPI-aware, so a call made as it is would be given
    /// coordinates scaled down to what a program of the old kind sees; the thread asking is made per-monitor aware
    /// for the length of the call, which is what gives physical pixels on a rig with screens of different scales.
    /// </summary>
    internal sealed class Win32SimWindowSource : ISimWindowSource
    {
        // The sim's executables, the DX11 one first. iRacingUI.exe is the launcher, not the sim.
        private static readonly string[] ProcessNames = { "iRacingSim64DX11", "iRacingSim64" };

        public SimWindowInfo Find()
        {
            foreach (string name in ProcessNames)
            {
                Process[] found;
                try { found = Process.GetProcessesByName(name); }
                catch (Exception) { continue; }
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

            IntPtr before = IntPtr.Zero;
            bool changed = false;
            try
            {
                try
                {
                    before = SetThreadDpiAwarenessContext(PerMonitorAwareV2);
                    changed = before != IntPtr.Zero;
                }
                catch (EntryPointNotFoundException) { /* Windows before 10 1607: the numbers are what they are */ }

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
            finally
            {
                if (changed) SetThreadDpiAwarenessContext(before);
            }
        }

        private const int ExtendedFrameBounds = 9;                  // DWMWA_EXTENDED_FRAME_BOUNDS: the frame without its shadow
        private const uint MonitorDefaultToNearest = 2;             // MONITOR_DEFAULTTONEAREST: the one with most of the window
        private static readonly IntPtr PerMonitorAwareV2 = new IntPtr(-4);   // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2

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

        [DllImport("user32.dll")]
        private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);

        [DllImport("dwmapi.dll")]
        private static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out RECT value, int size);
    }
}
