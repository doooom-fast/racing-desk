namespace RaceCorProDrive.Plugin.Engine.Moza
{
    /// <summary>
    /// Cached settings state for a connected Moza steering wheel.
    /// Covers both the primary device (0x15 — buttons, paddles) and
    /// extended device (0x17 — RGB lighting, display).
    /// Note: RGB color settings are WRITE-ONLY (firmware limitation);
    /// cached values reflect last-written state only.
    /// </summary>
    public class MozaWheelSettings
    {
        // ── Primary (Device 0x15) — Buttons & Paddles ─────────────────
        /// <summary>Paddle function assignment mode.</summary>
        public int PaddleMode { get; set; } = -1;

        /// <summary>Clutch engagement point percentage (0–100).</summary>
        public int ClutchBitePoint { get; set; } = -1;

        /// <summary>Adaptive paddle response enabled (0/1).</summary>
        public int AdaptivePaddles { get; set; } = -1;

        // ── Extended (Device 0x17) — RGB & Display ────────────────────
        /// <summary>Idle LED animation mode.</summary>
        public int IdleAnimation { get; set; } = -1;

        /// <summary>Global LED brightness (0–100).</summary>
        public int Brightness { get; set; } = -1;

        /// <summary>Telemetry display mode.</summary>
        public int TelemetryMode { get; set; } = -1;

        // ── Cached write-only RGB state ───────────────────────────────
        /// <summary>Last-written RPM zone colors (RGB triplets, write-only from firmware).</summary>
        public byte[] LastRpmZoneColors { get; set; }

        /// <summary>Last-written button colors (RGB triplets, write-only from firmware).</summary>
        public byte[] LastButtonColors { get; set; }

        /// <summary>Last-written flag indicator colors (RGB triplets, write-only from firmware).</summary>
        public byte[] LastFlagColors { get; set; }

        /// <summary>True if at least one setting has been read from hardware.</summary>
        public bool HasData => PaddleMode >= 0 || ClutchBitePoint >= 0 || Brightness >= 0;

        /// <summary>
        /// Applies a read response from the primary wheel device (0x15).
        /// </summary>
        public void ApplyPrimaryValue(byte commandId, int value)
        {
            switch (commandId)
            {
                case MozaDeviceRegistry.WheelCmd.PaddleMode: PaddleMode = value; break;
                case MozaDeviceRegistry.WheelCmd.ClutchBitePoint: ClutchBitePoint = value; break;
                case MozaDeviceRegistry.WheelCmd.AdaptivePaddles: AdaptivePaddles = value; break;
            }
        }

        /// <summary>
        /// Applies a read response from the extended wheel device (0x17).
        /// </summary>
        public void ApplyExtendedValue(byte commandId, int value)
        {
            switch (commandId)
            {
                case MozaDeviceRegistry.WheelCmd.IdleAnimation: IdleAnimation = value; break;
                case MozaDeviceRegistry.WheelCmd.Brightness: Brightness = value; break;
                case MozaDeviceRegistry.WheelCmd.TelemetryMode: TelemetryMode = value; break;
            }
        }
    }
}
