namespace RaceCorProDrive.Plugin.Engine.Moza
{
    /// <summary>
    /// Cached settings state for a connected Moza shifter (HGP H-pattern or SGP sequential).
    /// </summary>
    public class MozaShifterSettings
    {
        /// <summary>Shifter sub-type from USB descriptor: "HPattern", "Sequential", or "".</summary>
        public string ShifterType { get; set; } = "";

        /// <summary>Swap shift direction (0=normal, 1=reversed).</summary>
        public int Direction { get; set; } = -1;

        /// <summary>HID mode: 0=joypad, 1=keyboard emulation.</summary>
        public int HidMode { get; set; } = -1;

        /// <summary>LED brightness (0–100, SGP only).</summary>
        public int Brightness { get; set; } = -1;

        /// <summary>True if at least one setting has been read from hardware.</summary>
        public bool HasData => Direction >= 0;

        /// <summary>
        /// Applies a read response value to the appropriate setting.
        /// </summary>
        public void ApplyValue(byte commandId, int value)
        {
            switch (commandId)
            {
                case MozaDeviceRegistry.ShifterCmd.Direction: Direction = value; break;
                case MozaDeviceRegistry.ShifterCmd.HidMode: HidMode = value; break;
                case MozaDeviceRegistry.ShifterCmd.Brightness: Brightness = value; break;
            }
        }
    }
}
