namespace RaceCorProDrive.Plugin.Engine.Moza
{
    /// <summary>
    /// Cached settings state for connected Moza pedals (SRP, SR-P, CRP series).
    /// Each axis (throttle, brake, clutch) has independent calibration, response curve,
    /// and deadzone settings. The 5-point response curve maps to fixed 20% input intervals.
    /// </summary>
    public class MozaPedalSettings
    {
        public MozaPedalAxisSettings Throttle { get; set; } = new MozaPedalAxisSettings();
        public MozaPedalAxisSettings Brake { get; set; } = new MozaPedalAxisSettings();
        public MozaPedalAxisSettings Clutch { get; set; } = new MozaPedalAxisSettings();

        /// <summary>True if at least one axis has been successfully read from hardware.</summary>
        public bool HasData => Throttle.HasData || Brake.HasData || Clutch.HasData;

        /// <summary>
        /// Gets the axis settings object for a given PedalAxis enum.
        /// </summary>
        public MozaPedalAxisSettings GetAxis(MozaDeviceRegistry.PedalAxis axis)
        {
            switch (axis)
            {
                case MozaDeviceRegistry.PedalAxis.Throttle: return Throttle;
                case MozaDeviceRegistry.PedalAxis.Brake: return Brake;
                case MozaDeviceRegistry.PedalAxis.Clutch: return Clutch;
                default: return Throttle;
            }
        }

        /// <summary>
        /// Applies a read response to the correct axis and setting based on command ID.
        /// </summary>
        public void ApplyValue(byte commandId, int value)
        {
            // Determine which axis based on command ID range
            MozaPedalAxisSettings axis;
            byte offset;

            if (commandId >= MozaDeviceRegistry.PedalCmd.ClutchBase)
            {
                axis = Clutch;
                if (commandId < MozaDeviceRegistry.PedalCmd.ClutchBase) return; // Bounds check
                offset = (byte)(commandId - MozaDeviceRegistry.PedalCmd.ClutchBase);
            }
            else if (commandId >= MozaDeviceRegistry.PedalCmd.BrakeBase)
            {
                axis = Brake;
                if (commandId < MozaDeviceRegistry.PedalCmd.BrakeBase) return; // Bounds check
                offset = (byte)(commandId - MozaDeviceRegistry.PedalCmd.BrakeBase);
            }
            else
            {
                axis = Throttle;
                if (commandId < MozaDeviceRegistry.PedalCmd.ThrottleBase) return; // Bounds check
                offset = (byte)(commandId - MozaDeviceRegistry.PedalCmd.ThrottleBase);
            }

            axis.ApplyValue(offset, value);
        }
    }

    /// <summary>
    /// Settings for a single pedal axis (throttle, brake, or clutch).
    /// </summary>
    public class MozaPedalAxisSettings
    {
        /// <summary>Minimum raw ADC calibration value (0–65535).</summary>
        public int CalibrationMin { get; set; } = -1;

        /// <summary>Maximum raw ADC calibration value (0–65535).</summary>
        public int CalibrationMax { get; set; } = -1;

        /// <summary>Deadzone percentage (0–100).</summary>
        public int Deadzone { get; set; } = -1;

        /// <summary>5-point response curve (output at 20%, 40%, 60%, 80%, 100% input). Values 0–100.</summary>
        public int[] Curve { get; set; } = new int[] { -1, -1, -1, -1, -1 };

        /// <summary>HID source axis mapping.</summary>
        public int HidSource { get; set; } = -1;

        /// <summary>True if at least one setting has been read from hardware.</summary>
        public bool HasData => CalibrationMin >= 0 || Deadzone >= 0;

        /// <summary>
        /// Applies a value based on the per-axis command offset.
        /// </summary>
        public void ApplyValue(byte offset, int value)
        {
            switch (offset)
            {
                case MozaDeviceRegistry.PedalCmd.CalibrationMin: CalibrationMin = value; break;
                case MozaDeviceRegistry.PedalCmd.CalibrationMax: CalibrationMax = value; break;
                case MozaDeviceRegistry.PedalCmd.Deadzone: Deadzone = value; break;
                case MozaDeviceRegistry.PedalCmd.CurveY1: Curve[0] = value; break;
                case MozaDeviceRegistry.PedalCmd.CurveY2: Curve[1] = value; break;
                case MozaDeviceRegistry.PedalCmd.CurveY3: Curve[2] = value; break;
                case MozaDeviceRegistry.PedalCmd.CurveY4: Curve[3] = value; break;
                case MozaDeviceRegistry.PedalCmd.CurveY5: Curve[4] = value; break;
                case MozaDeviceRegistry.PedalCmd.HidSource: HidSource = value; break;
            }
        }
    }
}
