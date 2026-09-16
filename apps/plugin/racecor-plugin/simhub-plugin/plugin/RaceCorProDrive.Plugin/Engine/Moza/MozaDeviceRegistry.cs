using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace RaceCorProDrive.Plugin.Engine.Moza
{
    /// <summary>
    /// Central registry of Moza device IDs, command definitions, and USB detection patterns.
    /// All command IDs and payload specifications are derived from the Boxflat project's
    /// reverse-engineered protocol (https://github.com/Lawstorant/boxflat).
    /// </summary>
    public static class MozaDeviceRegistry
    {
        // ═══════════════════════════════════════════════════════════════
        //  DEVICE IDs
        // ═══════════════════════════════════════════════════════════════

        public const byte DeviceUniversalHub = 0x12;
        public const byte DeviceWheelbase = 0x13;
        public const byte DeviceDashboard = 0x14;
        public const byte DeviceSteeringWheelPrimary = 0x15;
        public const byte DeviceSteeringWheelExtended = 0x17;
        public const byte DevicePedals = 0x19;
        public const byte DeviceShifter = 0x1A;
        public const byte DeviceHandbrake = 0x1B;
        public const byte DeviceEStop = 0x1C;

        // ═══════════════════════════════════════════════════════════════
        //  DEVICE TYPE ENUM
        // ═══════════════════════════════════════════════════════════════

        public enum MozaDeviceType
        {
            Unknown,
            UniversalHub,
            Wheelbase,
            Dashboard,
            SteeringWheel,
            Pedals,
            Shifter,
            Handbrake,
            EStop
        }

        // ═══════════════════════════════════════════════════════════════
        //  DEVICE TYPE → ID MAPPING
        // ═══════════════════════════════════════════════════════════════

        private static readonly Dictionary<MozaDeviceType, byte> DeviceTypeToId = new Dictionary<MozaDeviceType, byte>
        {
            { MozaDeviceType.UniversalHub, DeviceUniversalHub },
            { MozaDeviceType.Wheelbase, DeviceWheelbase },
            { MozaDeviceType.Dashboard, DeviceDashboard },
            { MozaDeviceType.SteeringWheel, DeviceSteeringWheelPrimary },
            { MozaDeviceType.Pedals, DevicePedals },
            { MozaDeviceType.Shifter, DeviceShifter },
            { MozaDeviceType.Handbrake, DeviceHandbrake },
            { MozaDeviceType.EStop, DeviceEStop },
        };

        /// <summary>Get the primary device ID for a device type.</summary>
        public static byte GetDeviceId(MozaDeviceType type)
        {
            return DeviceTypeToId.TryGetValue(type, out byte id) ? id : (byte)0x00;
        }

        // ═══════════════════════════════════════════════════════════════
        //  USB DETECTION PATTERNS
        // ═══════════════════════════════════════════════════════════════

        /// <summary>
        /// USB descriptor patterns for identifying connected Moza devices.
        /// Match against the product/description string from WMI Win32_PnPEntity.
        /// All patterns are case-insensitive.
        ///
        /// Note: The WMI full description is "{Manufacturer} {Name} {Description}".
        /// Older Moza firmware uses "Gudsen" as the manufacturer; newer firmware
        /// (late 2025+) reports "MOZA" or "MOZA Racing". Patterns must accept both.
        /// </summary>
        public static readonly DevicePattern[] UsbPatterns = new[]
        {
            // ── Wheelbases ──────────────────────────────────────────────
            // Matches: "Gudsen MOZA R9 Base", "MOZA R12 Ultra Base",
            //          "MOZA Racing R21 Base", "MOZA R5 Racing Wheel and Pedals"
            new DevicePattern(MozaDeviceType.Wheelbase,
                new Regex(@"(?:gudsen|moza(?:\s+racing)?)\s+(?:moza\s+)?r\d{1,2}\s+(ultra\s+base|base|racing\s+wheel\s+and\s+pedals)", RegexOptions.IgnoreCase | RegexOptions.Compiled)),

            // ── Pedals ──────────────────────────────────────────────────
            // Matches: "Gudsen MOZA SRP Pedals", "MOZA CRP2 Pedals",
            //          "MOZA SR-P Lite Pedals", "MOZA FSR Pedals"
            new DevicePattern(MozaDeviceType.Pedals,
                new Regex(@"(?:gudsen\s+)?(?:moza(?:\s+racing)?\s+)?(srp|sr-p|crp|fsr)\d?(?:\s+\w+)?\s+pedals", RegexOptions.IgnoreCase | RegexOptions.Compiled)),
            // Broader pedal fallback: any "moza" string with "pedal" in it
            new DevicePattern(MozaDeviceType.Pedals,
                new Regex(@"moza\s+.*pedal", RegexOptions.IgnoreCase | RegexOptions.Compiled)),

            // ── Shifters ────────────────────────────────────────────────
            new DevicePattern(MozaDeviceType.Shifter,
                new Regex(@"hgp\s+shifter", RegexOptions.IgnoreCase | RegexOptions.Compiled),
                "HPattern"),
            new DevicePattern(MozaDeviceType.Shifter,
                new Regex(@"sgp\s+shifter", RegexOptions.IgnoreCase | RegexOptions.Compiled),
                "Sequential"),
            // Broader: "MOZA ... shifter"
            new DevicePattern(MozaDeviceType.Shifter,
                new Regex(@"moza\s+.*shifter", RegexOptions.IgnoreCase | RegexOptions.Compiled)),

            // ── Handbrake ───────────────────────────────────────────────
            new DevicePattern(MozaDeviceType.Handbrake,
                new Regex(@"hbp\s+handbrake", RegexOptions.IgnoreCase | RegexOptions.Compiled)),
            // Broader: "MOZA ... handbrake"
            new DevicePattern(MozaDeviceType.Handbrake,
                new Regex(@"moza\s+.*handbrake", RegexOptions.IgnoreCase | RegexOptions.Compiled)),

            // ── Universal Hub ───────────────────────────────────────────
            new DevicePattern(MozaDeviceType.UniversalHub,
                new Regex(@"(?:gudsen|moza(?:\s+racing)?)\s+universal\s+hub", RegexOptions.IgnoreCase | RegexOptions.Compiled)),

            // ── Dashboard ───────────────────────────────────────────────
            // Moza dashboards (CM, RM) — no pattern existed before
            new DevicePattern(MozaDeviceType.Dashboard,
                new Regex(@"moza\s+.*dashboard", RegexOptions.IgnoreCase | RegexOptions.Compiled)),

            // ── Steering Wheels ─────────────────────────────────────────
            // CS V2, KS, GS, etc. — distinguish from wheelbases by "wheel" without "base"
            new DevicePattern(MozaDeviceType.SteeringWheel,
                new Regex(@"moza\s+(?:cs|ks|gs|es|fsr)\s*v?\d?\s+(?:steering\s+)?wheel", RegexOptions.IgnoreCase | RegexOptions.Compiled)),

            // ── E-Stop ──────────────────────────────────────────────────
            new DevicePattern(MozaDeviceType.EStop,
                new Regex(@"moza\s+.*e-?stop", RegexOptions.IgnoreCase | RegexOptions.Compiled)),

            // ── Fallback: any Gudsen/Moza device not matching above ─────
            new DevicePattern(MozaDeviceType.Unknown,
                new Regex(@"gudsen|moza", RegexOptions.IgnoreCase | RegexOptions.Compiled)),
        };

        // ═══════════════════════════════════════════════════════════════
        //  WHEELBASE COMMAND IDs (Device 0x13)
        // ═══════════════════════════════════════════════════════════════

        public static class WheelbaseCmd
        {
            // Force Feedback
            public const byte FfbStrength = 0x14;
            public const byte MaxTorque = 0x15;
            public const byte RoadSensitivity = 0x16;
            public const byte SpeedDamping = 0x17;

            // Rotation
            public const byte MinRotationAngle = 0x18; // 2 bytes, signed
            public const byte MaxRotationAngle = 0x19; // 2 bytes, signed
            public const byte SoftLock = 0x1A;

            // Damping & Feel
            public const byte Friction = 0x1B;
            public const byte Spring = 0x1C;
            public const byte Damper = 0x1D;
            public const byte Inertia = 0x1E;

            // EQ (6-band)
            public const byte EqBand1 = 0x20;
            public const byte EqBand2 = 0x21;
            public const byte EqBand3 = 0x22;
            public const byte EqBand4 = 0x23;
            public const byte EqBand5 = 0x24;
            public const byte EqBand6 = 0x25;

            // Protection
            public const byte TempProtection = 0x30;
            public const byte HandsOffProtection = 0x31;

            /// <summary>All single-byte readable wheelbase commands for polling.</summary>
            public static readonly byte[] PollCommands = new byte[]
            {
                FfbStrength, MaxTorque, RoadSensitivity, SpeedDamping,
                SoftLock, Friction, Spring, Damper, Inertia,
                EqBand1, EqBand2, EqBand3, EqBand4, EqBand5, EqBand6,
                TempProtection, HandsOffProtection
            };

            /// <summary>Wheelbase commands that use 2-byte (16-bit) payloads.</summary>
            public static readonly byte[] TwoByteCommands = new byte[]
            {
                MinRotationAngle, MaxRotationAngle
            };
        }

        // ═══════════════════════════════════════════════════════════════
        //  PEDAL COMMAND IDs (Device 0x19)
        //  Offsets: Throttle base + 0x00, Brake base + 0x10, Clutch base + 0x20
        // ═══════════════════════════════════════════════════════════════

        public static class PedalCmd
        {
            // Base offsets per axis
            public const byte ThrottleBase = 0x30;
            public const byte BrakeBase = 0x40;
            public const byte ClutchBase = 0x50;

            // Per-axis offsets (add to base)
            public const byte CalibrationMin = 0x00; // 2 bytes
            public const byte CalibrationMax = 0x01; // 2 bytes
            public const byte Deadzone = 0x02;
            public const byte CurveY1 = 0x03;
            public const byte CurveY2 = 0x04;
            public const byte CurveY3 = 0x05;
            public const byte CurveY4 = 0x06;
            public const byte CurveY5 = 0x07;
            public const byte HidSource = 0x08;

            /// <summary>Get the command ID for a specific axis and setting.</summary>
            public static byte GetCommand(PedalAxis axis, byte offset)
            {
                byte baseAddr = axis == PedalAxis.Throttle ? ThrottleBase
                    : axis == PedalAxis.Brake ? BrakeBase
                    : ClutchBase;
                return (byte)(baseAddr + offset);
            }

            /// <summary>Commands that use 2-byte (16-bit) payloads.</summary>
            public static readonly byte[] TwoByteOffsets = new byte[]
            {
                CalibrationMin, CalibrationMax
            };
        }

        public enum PedalAxis { Throttle, Brake, Clutch }

        // ═══════════════════════════════════════════════════════════════
        //  HANDBRAKE COMMAND IDs (Device 0x1B)
        // ═══════════════════════════════════════════════════════════════

        public static class HandbrakeCmd
        {
            public const byte CalibrationMin = 0x30; // 2 bytes
            public const byte CalibrationMax = 0x31; // 2 bytes
            public const byte Deadzone = 0x32;
            public const byte CurveY1 = 0x33;
            public const byte CurveY2 = 0x34;
            public const byte CurveY3 = 0x35;
            public const byte CurveY4 = 0x36;
            public const byte CurveY5 = 0x37;
            public const byte ButtonThreshold = 0x38;
            public const byte OutputMode = 0x39; // 0=analog, 1=button, 2=dual

            public static readonly byte[] PollCommands = new byte[]
            {
                Deadzone, CurveY1, CurveY2, CurveY3, CurveY4, CurveY5,
                ButtonThreshold, OutputMode
            };

            public static readonly byte[] TwoByteCommands = new byte[]
            {
                CalibrationMin, CalibrationMax
            };
        }

        // ═══════════════════════════════════════════════════════════════
        //  SHIFTER COMMAND IDs (Device 0x1A)
        // ═══════════════════════════════════════════════════════════════

        public static class ShifterCmd
        {
            public const byte Direction = 0x30;
            public const byte HidMode = 0x31; // 0=joypad, 1=keyboard
            public const byte Brightness = 0x32; // SGP only

            public static readonly byte[] PollCommands = new byte[]
            {
                Direction, HidMode, Brightness
            };
        }

        // ═══════════════════════════════════════════════════════════════
        //  DASHBOARD COMMAND IDs (Device 0x14)
        // ═══════════════════════════════════════════════════════════════

        public static class DashboardCmd
        {
            public const byte RpmDisplayMode = 0x30; // 0=analog, 1=LED bar, 2=digital
            public const byte Brightness = 0x31;
            public const byte UpdateInterval = 0x32;
            public const byte TelemetryEnable = 0x33;

            public static readonly byte[] PollCommands = new byte[]
            {
                RpmDisplayMode, Brightness, UpdateInterval, TelemetryEnable
            };
        }

        // ═══════════════════════════════════════════════════════════════
        //  STEERING WHEEL COMMAND IDs (Device 0x15 primary, 0x17 extended)
        // ═══════════════════════════════════════════════════════════════

        public static class WheelCmd
        {
            // Primary (0x15) — buttons & paddles
            public const byte PaddleMode = 0x30;
            public const byte ClutchBitePoint = 0x31;
            public const byte AdaptivePaddles = 0x32;

            // Extended (0x17) — RGB & display
            public const byte IdleAnimation = 0x40;
            public const byte Brightness = 0x41;
            public const byte TelemetryMode = 0x42;

            public static readonly byte[] PrimaryPollCommands = new byte[]
            {
                PaddleMode, ClutchBitePoint, AdaptivePaddles
            };

            public static readonly byte[] ExtendedPollCommands = new byte[]
            {
                IdleAnimation, Brightness, TelemetryMode
            };
        }

        // ═══════════════════════════════════════════════════════════════
        //  UNIVERSAL HUB COMMAND IDs (Device 0x12)
        // ═══════════════════════════════════════════════════════════════

        public static class HubCmd
        {
            public const byte CompatibilityMode = 0x30;
            public const byte LedStatus = 0x31;
            public const byte Interpolation = 0x32;
            public const byte SpringGain = 0x33;
            public const byte DamperGain = 0x34;
            public const byte InertiaGain = 0x35;
            public const byte FrictionGain = 0x36;

            public static readonly byte[] PollCommands = new byte[]
            {
                CompatibilityMode, LedStatus, Interpolation,
                SpringGain, DamperGain, InertiaGain, FrictionGain
            };
        }

        /// <summary>
        /// Checks whether a given command ID uses a 2-byte (16-bit) payload for a specific device.
        /// </summary>
        public static bool IsTwoByteCommand(byte deviceId, byte commandId)
        {
            if (deviceId == DeviceWheelbase)
                return System.Array.IndexOf(WheelbaseCmd.TwoByteCommands, commandId) >= 0;
            if (deviceId == DeviceHandbrake)
                return System.Array.IndexOf(HandbrakeCmd.TwoByteCommands, commandId) >= 0;
            if (deviceId == DevicePedals)
            {
                byte offset = (byte)(commandId & 0x0F);
                return System.Array.IndexOf(PedalCmd.TwoByteOffsets, offset) >= 0;
            }
            return false;
        }
    }

    /// <summary>
    /// USB descriptor pattern for matching a Moza device type.
    /// </summary>
    public class DevicePattern
    {
        public MozaDeviceRegistry.MozaDeviceType DeviceType { get; }
        public Regex Pattern { get; }
        /// <summary>Sub-type hint (e.g., "HPattern" vs "Sequential" for shifters).</summary>
        public string SubType { get; }

        public DevicePattern(MozaDeviceRegistry.MozaDeviceType deviceType, Regex pattern, string subType = null)
        {
            DeviceType = deviceType;
            Pattern = pattern;
            SubType = subType;
        }
    }
}
