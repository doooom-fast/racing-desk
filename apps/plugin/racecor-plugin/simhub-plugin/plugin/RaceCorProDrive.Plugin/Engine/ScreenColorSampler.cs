using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Threading;

namespace RaceCorProDrive.Plugin.Engine
{
    /// <summary>
    /// Lightweight screen color sampler using GDI+ Graphics.CopyFromScreen().
    /// Captures a small region of the primary screen and averages the color.
    /// Runs on a background thread at ~4 FPS to avoid blocking the main plugin tick.
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
        /// Set the capture region as ratios of screen size (0-1).
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
            SimHub.Logging.Current.Info("[RaceCorProDrive] ScreenColorSampler started");
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
            SimHub.Logging.Current.Info("[RaceCorProDrive] ScreenColorSampler stopped");
        }

        private void CaptureLoop()
        {
            int frameCount = 0;

            while (_running)
            {
                try
                {
                    // ~4 FPS (250ms interval) — matches the old Electron capture rate
                    Thread.Sleep(250);

                    if (!_hasRect) continue;

                    // Read screen dimensions
                    var screenBounds = System.Windows.Forms.Screen.PrimaryScreen.Bounds;
                    int screenW = screenBounds.Width;
                    int screenH = screenBounds.Height;

                    // Compute pixel region from ratios
                    int srcX, srcY, srcW, srcH;
                    lock (_lock)
                    {
                        srcX = (int)(_rectX * screenW);
                        srcY = (int)(_rectY * screenH);
                        srcW = Math.Max(1, (int)(_rectW * screenW));
                        srcH = Math.Max(1, (int)(_rectH * screenH));
                    }

                    // Clamp to screen bounds
                    srcX = Math.Max(0, Math.Min(srcX, screenW - 1));
                    srcY = Math.Max(0, Math.Min(srcY, screenH - 1));
                    srcW = Math.Min(srcW, screenW - srcX);
                    srcH = Math.Min(srcH, screenH - srcY);

                    if (srcW <= 0 || srcH <= 0) continue;

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

                    frameCount++;
                    if (frameCount <= 3 || frameCount % 100 == 0)
                    {
                        SimHub.Logging.Current.Info(
                            $"[RaceCorProDrive] ScreenColor frame #{frameCount}: " +
                            $"RGB({_r},{_g},{_b}) region=({srcX},{srcY},{srcW}x{srcH})");
                    }
                }
                catch (Exception ex)
                {
                    // Don't crash the thread on transient GDI errors (e.g. locked screen)
                    frameCount++;
                    if (frameCount % 100 == 0)
                    {
                        SimHub.Logging.Current.Warn(
                            $"[RaceCorProDrive] ScreenColor capture error: {ex.Message}");
                    }
                }
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
