namespace RaceCorProDrive.Plugin.Engine.Moza
{
    /// <summary>
    /// Cached settings state for a connected Moza wheelbase (R5, R9, R12, R16, R21).
    /// Values are populated by polling via MozaSerialManager and can be written back
    /// to hardware via write commands.
    /// </summary>
    public class MozaWheelbaseSettings
    {
        // ── Force Feedback ────────────────────────────────────────────
        /// <summary>FFB strength percentage (0–100).</summary>
        public int FfbStrength { get; set; } = -1;

        /// <summary>Max torque percentage (0–100+, model-dependent).</summary>
        public int MaxTorque { get; set; } = -1;

        /// <summary>Road/surface detail intensity (0–100).</summary>
        public int RoadSensitivity { get; set; } = -1;

        /// <summary>Speed-dependent damping (0–100).</summary>
        public int SpeedDamping { get; set; } = -1;

        // ── Rotation ──────────────────────────────────────────────────
        /// <summary>Left rotation limit in degrees (negative, e.g., -900).</summary>
        public int MinRotationAngle { get; set; } = 0;

        /// <summary>Right rotation limit in degrees (positive, e.g., 900).</summary>
        public int MaxRotationAngle { get; set; } = 0;

        /// <summary>Total rotation range derived from min/max angles.</summary>
        public int RotationRange => MaxRotationAngle - MinRotationAngle;

        /// <summary>Software rotation stop enabled (0/1).</summary>
        public int SoftLock { get; set; } = -1;

        // ── Damping & Feel ────────────────────────────────────────────
        /// <summary>Constant friction force (0–100).</summary>
        public int Friction { get; set; } = -1;

        /// <summary>Center spring strength (0–100).</summary>
        public int Spring { get; set; } = -1;

        /// <summary>Velocity-based resistance (0–100).</summary>
        public int Damper { get; set; } = -1;

        /// <summary>Mass simulation weight (0–100).</summary>
        public int Inertia { get; set; } = -1;

        // ── EQ (6-band) ──────────────────────────────────────────────
        /// <summary>EQ bands 1–6 (0–200, center=100).</summary>
        public int[] EqBands { get; set; } = new int[] { -1, -1, -1, -1, -1, -1 };

        // ── Protection ────────────────────────────────────────────────
        /// <summary>Thermal cutoff enabled (0/1).</summary>
        public int TempProtection { get; set; } = -1;

        /// <summary>Hands-off FFB reduction enabled (0/1).</summary>
        public int HandsOffProtection { get; set; } = -1;

        /// <summary>Wheelbase model name derived from USB descriptor (e.g., "R9").</summary>
        public string Model { get; set; } = "";

        /// <summary>True if at least one setting has been successfully read from hardware.</summary>
        public bool HasData => FfbStrength >= 0;

        /// <summary>
        /// Applies a read response value to the appropriate setting field.
        /// </summary>
        public void ApplyValue(byte commandId, int value)
        {
            switch (commandId)
            {
                case MozaDeviceRegistry.WheelbaseCmd.FfbStrength: FfbStrength = value; break;
                case MozaDeviceRegistry.WheelbaseCmd.MaxTorque: MaxTorque = value; break;
                case MozaDeviceRegistry.WheelbaseCmd.RoadSensitivity: RoadSensitivity = value; break;
                case MozaDeviceRegistry.WheelbaseCmd.SpeedDamping: SpeedDamping = value; break;
                case MozaDeviceRegistry.WheelbaseCmd.MinRotationAngle: MinRotationAngle = (short)value; break;
                case MozaDeviceRegistry.WheelbaseCmd.MaxRotationAngle: MaxRotationAngle = (short)value; break;
                case MozaDeviceRegistry.WheelbaseCmd.SoftLock: SoftLock = value; break;
                case MozaDeviceRegistry.WheelbaseCmd.Friction: Friction = value; break;
                case MozaDeviceRegistry.WheelbaseCmd.Spring: Spring = value; break;
                case MozaDeviceRegistry.WheelbaseCmd.Damper: Damper = value; break;
                case MozaDeviceRegistry.WheelbaseCmd.Inertia: Inertia = value; break;
                case MozaDeviceRegistry.WheelbaseCmd.EqBand1: EqBands[0] = value; break;
                case MozaDeviceRegistry.WheelbaseCmd.EqBand2: EqBands[1] = value; break;
                case MozaDeviceRegistry.WheelbaseCmd.EqBand3: EqBands[2] = value; break;
                case MozaDeviceRegistry.WheelbaseCmd.EqBand4: EqBands[3] = value; break;
                case MozaDeviceRegistry.WheelbaseCmd.EqBand5: EqBands[4] = value; break;
                case MozaDeviceRegistry.WheelbaseCmd.EqBand6: EqBands[5] = value; break;
                case MozaDeviceRegistry.WheelbaseCmd.TempProtection: TempProtection = value; break;
                case MozaDeviceRegistry.WheelbaseCmd.HandsOffProtection: HandsOffProtection = value; break;
            }
        }
    }
}
