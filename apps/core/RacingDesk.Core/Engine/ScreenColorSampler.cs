using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Threading;
using RacingDesk.Core.Screens;

namespace RacingDesk.Plugin.Engine
{
    /// <summary>
    /// Lightweight screen color sampler using GDI+ Graphics.CopyFromScreen().
    /// Captures a small region of the monitor the sim is on and averages the color: the monitor Windows has most of the
    /// sim's window on, found as the host's simwindow route finds it, and the primary monitor while the sim has no
    /// window on screen (<see cref="SimMonitor"/>). It was the primary, always, which on a rig whose sim runs on
    /// another screen is not the picture the HUD sits over. The region is set as ratios of that monitor.
    /// Runs on a background thread at ~4 FPS to avoid blocking the main plugin tick. It runs in the app's host and in
    /// the SimHub plugin alike.
    ///
    /// Replaces the Electron desktopCapturer pipeline which caused GPU→CPU readback
    /// stalls that froze all Windows animations and mouse movement.
    /// </summary>
    public class ScreenColorSampler : IDisposable
    {
        // Capture region as ratios of screen dimensions (0-1)
        private double _rectX, _rectY, _rectW, _rectH;
        private bool _hasRect;

        // Output color (0-255), read by Plugin.cs each tick
        private int _r, _g, _b;
        private bool _hasColor;

        // Background thread
        private Thread _thread;
        private volatile bool _running;
        private readonly object _lock = new object();

        // Downscale large regions to this size before averaging
        private const int MAX_SAMPLE = 64;

        // Which monitor is looked at; only the capture thread asks it.
        private readonly SimMonitor _screen;

        public ScreenColorSampler() : this(new SimMonitor())
        {
        }

        /// <summary>Looks at the monitor <paramref name="screen"/> gives: tests give one with fake sources.</summary>
        internal ScreenColorSampler(SimMonitor screen)
        {
            _screen = screen ?? new SimMonitor();
        }

        /// <summary>Current averaged red component (0-255).</summary>
        public int R => _r;
        /// <summary>Current averaged green component (0-255).</summary>
        public int G => _g;
        /// <summary>Current averaged blue component (0-255).</summary>
        public int B => _b;
        /// <summary>True once at least one color sample has been captured.</summary>
        public bool HasColor => _hasColor;
        /// <summary>True if a capture region has been set.</summary>
        public bool HasRect => _hasRect;

        /// <summary>
        /// Set the capture region as ratios of the monitor's size (0-1).
        /// </summary>
        public void SetRect(double x, double y, double w, double h)
        {
            lock (_lock)
            {
                _rectX = x;
                _rectY = y;
                _rectW = w;
                _rectH = h;
                _hasRect = true;
            }
        }

        /// <summary>
        /// Start the background capture thread (~4 FPS).
        /// </summary>
        public void Start()
        {
            if (_running) return;
            _running = true;
            _thread = new Thread(CaptureLoop)
            {
                Name = "K10-ScreenColorSampler",
                IsBackground = true,
                Priority = ThreadPriority.BelowNormal
            };
            _thread.Start();
            Log.Info("[RacingDesk] ScreenColorSampler started");
        }

        /// <summary>
        /// Stop the background capture thread.
        /// </summary>
        public void Stop()
        {
            _running = false;
            _hasColor = false;
            if (_thread != null && _thread.IsAlive)
            {
                _thread.Join(1000);
                _thread = null;
            }
            Log.Info("[RacingDesk] ScreenColorSampler stopped");
        }

        private void CaptureLoop()
        {
            int frameCount = 0;
            var clock = Stopwatch.StartNew();
            string said = null;
            bool failing = false;   // the last capture failed: the monitor has been looked for again once already

            while (_running)
            {
                // The monitor is found and captured in physical pixels, on this thread and in the same awareness: a
                // lookup made in one and a capture in another would miss each other on screens of different scales.
                var aware = PerMonitorAwareScope.Enter();
                try
                {
                    // ~4 FPS (250ms interval) — matches the old Electron capture rate
                    Thread.Sleep(250);

                    if (!_hasRect) continue;

                    // The monitor the sim is on, else the primary; looked for again every couple of seconds
                    ScreenRect monitor = _screen.Current(clock.ElapsedMilliseconds);
                    string where = Where(monitor, _screen.Why);
                    if (where != said)
                    {
                        said = where;
                        Log.Info($"[RacingDesk] ScreenColor: {where}");
                    }
                    if (!monitor.IsUsable) continue;

                    // Compute the pixel region from the ratios, on that monitor
                    ScreenRect region;
                    lock (_lock)
                    {
                        region = Region(monitor, _rectX, _rectY, _rectW, _rectH);
                    }
                    if (!region.IsUsable) continue;

                    int srcX = region.X, srcY = region.Y, srcW = region.Width, srcH = region.Height;

                    // Determine sample size (downscale large regions)
                    int sampleW = Math.Min(srcW, MAX_SAMPLE);
                    int sampleH = Math.Min(srcH, MAX_SAMPLE);

                    // Capture the screen region and optionally downscale
                    using (var captureBmp = new Bitmap(srcW, srcH, PixelFormat.Format32bppArgb))
                    {
                        using (var captureGfx = Graphics.FromImage(captureBmp))
                        {
                            captureGfx.CopyFromScreen(srcX, srcY, 0, 0,
                                new Size(srcW, srcH), CopyPixelOperation.SourceCopy);
                        }

                        Bitmap sampleBmp;
                        bool needsDispose = false;

                        if (srcW > MAX_SAMPLE || srcH > MAX_SAMPLE)
                        {
                            // Downscale to sample size for faster averaging
                            sampleBmp = new Bitmap(sampleW, sampleH, PixelFormat.Format32bppArgb);
                            needsDispose = true;
                            using (var g = Graphics.FromImage(sampleBmp))
                            {
                                g.InterpolationMode = InterpolationMode.Low;
                                g.CompositingQuality = CompositingQuality.HighSpeed;
                                g.DrawImage(captureBmp, 0, 0, sampleW, sampleH);
                            }
                        }
                        else
                        {
                            sampleBmp = captureBmp;
                            sampleW = srcW;
                            sampleH = srcH;
                        }

                        // Average the pixel colors using LockBits for speed
                        AverageColor(sampleBmp, sampleW, sampleH, out int avgR, out int avgG, out int avgB);

                        if (needsDispose) sampleBmp.Dispose();

                        _r = avgR;
                        _g = avgG;
                        _b = avgB;
                        _hasColor = true;
                    }
                    failing = false;

                    frameCount++;
                    if (frameCount <= 3 || frameCount % 100 == 0)
                    {
                        Log.Info(
                            $"[RacingDesk] ScreenColor frame #{frameCount}: " +
                            $"RGB({_r},{_g},{_b}) region=({srcX},{srcY},{srcW}x{srcH})");
                    }
                }
                catch (Exception ex)
                {
                    // Don't crash the thread on transient GDI errors (e.g. locked screen). The screens may have
                    // changed under the monitor that was found: it is looked for again at the next frame — once. A
                    // capture that goes on failing (the screen locked, a UAC prompt up) waits on the usual 2 s.
                    if (!failing) _screen.Forget();
                    failing = true;
                    frameCount++;
                    if (frameCount % 100 == 0)
                    {
                        Log.Warn(
                            $"[RacingDesk] ScreenColor capture error: {ex.Message}");
                    }
                }
                finally
                {
                    aware.Dispose();
                }
            }
        }

        /// <summary>
        /// The region to capture, on the virtual screen in physical pixels: the ratios (0-1) of the monitor's size,
        /// from its own corner, kept on it and at least a pixel each way. Not usable when the monitor is not.
        /// </summary>
        internal static ScreenRect Region(ScreenRect monitor, double x, double y, double w, double h)
        {
            if (!monitor.IsUsable) return new ScreenRect();
            int screenW = monitor.Width;
            int screenH = monitor.Height;

            int srcX = (int)(x * screenW);
            int srcY = (int)(y * screenH);
            int srcW = Math.Max(1, (int)(w * screenW));
            int srcH = Math.Max(1, (int)(h * screenH));

            // Clamp to the monitor
            srcX = Math.Max(0, Math.Min(srcX, screenW - 1));
            srcY = Math.Max(0, Math.Min(srcY, screenH - 1));
            srcW = Math.Min(srcW, screenW - srcX);
            srcH = Math.Min(srcH, screenH - srcY);

            return new ScreenRect(monitor.X + srcX, monitor.Y + srcY, srcW, srcH);
        }

        // What is being sampled, for the log: said once each time it changes.
        internal static string Where(ScreenRect monitor, SimMonitor.Reason why)
        {
            switch (why)
            {
                case SimMonitor.Reason.Sim: return $"sampling the monitor iRacing is on, {monitor}";
                case SimMonitor.Reason.Primary: return $"sampling the primary monitor, {monitor}: iRacing's window was not found";
                default: return "no monitor to sample: Windows listed none";
            }
        }

        private static void AverageColor(Bitmap bmp, int w, int h, out int avgR, out int avgG, out int avgB)
        {
            var data = bmp.LockBits(
                new Rectangle(0, 0, w, h),
                ImageLockMode.ReadOnly,
                PixelFormat.Format32bppArgb);

            long rSum = 0, gSum = 0, bSum = 0;
            int count = w * h;
            int stride = data.Stride;
            IntPtr scan0 = data.Scan0;

            unsafe
            {
                byte* ptr = (byte*)scan0;
                for (int y = 0; y < h; y++)
                {
                    byte* row = ptr + y * stride;
                    for (int x = 0; x < w; x++)
                    {
                        int offset = x * 4;
                        bSum += row[offset];     // B
                        gSum += row[offset + 1]; // G
                        rSum += row[offset + 2]; // R
                    }
                }
            }

            bmp.UnlockBits(data);

            if (count > 0)
            {
                avgR = (int)(rSum / count);
                avgG = (int)(gSum / count);
                avgB = (int)(bSum / count);
            }
            else
            {
                avgR = avgG = avgB = 0;
            }
        }

        public void Dispose()
        {
            Stop();
        }
    }
}
