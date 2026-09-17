namespace RaceCorProDrive.Plugin.Engine.Moza
{
    /// <summary>
    /// Cached settings state for a connected Moza handbrake (HBP series).
    /// </summary>
    public class MozaHandbrakeSettings
    {
        /// <summary>Minimum raw calibration value (0–65535).</summary>
        public int CalibrationMin { get; set; } = -1;

        /// <summary>Maximum raw calibration value (0–65535).</summary>
        public int CalibrationMax { get; set; } = -1;

        /// <summary>Bottom deadzone percentage (0–100).</summary>
        public int Deadzone { get; set; } = -1;

        /// <summary>5-point response curve (output at 20%, 40%, 60%, 80%, 100% input). Values 0–100.</summary>
        public int[] Curve { get; set; } = new int[] { -1, -1, -1, -1, -1 };

        /// <summary>Analog value threshold that triggers button output (0–100).</summary>
        public int ButtonThreshold { get; set; } = -1;

        /// <summary>Output mode: 0=analog, 1=button, 2=dual.</summary>
        public int OutputMode { get; set; } = -1;

        /// <summary>True if at least one setting has been read from hardware.</summary>
        public bool HasData => Deadzone >= 0 || CalibrationMin >= 0;

        /// <summary>
        /// Applies a read response value to the appropriate setting.
        /// </summary>
        public void ApplyValue(byte commandId, int value)
        {
            switch (commandId)
            {
                case MozaDeviceRegistry.HandbrakeCmd.CalibrationMin: CalibrationMin = value; break;
                case MozaDeviceRegistry.HandbrakeCmd.CalibrationMax: CalibrationMax = value; break;
                case MozaDeviceRegistry.HandbrakeCmd.Deadzone: Deadzone = value; break;
                case MozaDeviceRegistry.HandbrakeCmd.CurveY1: Curve[0] = value; break;
                case MozaDeviceRegistry.HandbrakeCmd.CurveY2: Curve[1] = value; break;
                case MozaDeviceRegistry.HandbrakeCmd.CurveY3: Curve[2] = value; break;
                case MozaDeviceRegistry.HandbrakeCmd.CurveY4: Curve[3] = value; break;
                case MozaDeviceRegistry.HandbrakeCmd.CurveY5: Curve[4] = value; break;
                case MozaDeviceRegistry.HandbrakeCmd.ButtonThreshold: ButtonThreshold = value; break;
                case MozaDeviceRegistry.HandbrakeCmd.OutputMode: OutputMode = value; break;
            }
        }
    }
}
