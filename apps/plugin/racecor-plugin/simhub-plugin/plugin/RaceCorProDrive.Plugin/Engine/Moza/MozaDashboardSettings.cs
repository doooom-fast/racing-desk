namespace RaceCorProDrive.Plugin.Engine.Moza
{
    /// <summary>
    /// Cached settings state for a connected Moza dashboard display.
    /// </summary>
    public class MozaDashboardSettings
    {
        /// <summary>RPM display mode: 0=analog, 1=LED bar, 2=digital.</summary>
        public int RpmDisplayMode { get; set; } = -1;

        /// <summary>Display brightness (0–100).</summary>
        public int Brightness { get; set; } = -1;

        /// <summary>Refresh rate / update interval.</summary>
        public int UpdateInterval { get; set; } = -1;

        /// <summary>Telemetry data transmission enabled (0/1).</summary>
        public int TelemetryEnable { get; set; } = -1;

        /// <summary>True if at least one setting has been read from hardware.</summary>
        public bool HasData => RpmDisplayMode >= 0 || Brightness >= 0;

        /// <summary>
        /// Applies a read response value to the appropriate setting.
        /// </summary>
        public void ApplyValue(byte commandId, int value)
        {
            switch (commandId)
            {
                case MozaDeviceRegistry.DashboardCmd.RpmDisplayMode: RpmDisplayMode = value; break;
                case MozaDeviceRegistry.DashboardCmd.Brightness: Brightness = value; break;
                case MozaDeviceRegistry.DashboardCmd.UpdateInterval: UpdateInterval = value; break;
                case MozaDeviceRegistry.DashboardCmd.TelemetryEnable: TelemetryEnable = value; break;
            }
        }
    }
}
