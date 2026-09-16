using System;

namespace RaceCorProDrive.Plugin.Engine.Moza
{
    /// <summary>
    /// Represents a single connected Moza device with its serial port, device type,
    /// and cached settings state. Each physical device gets one MozaDevice instance.
    /// </summary>
    public class MozaDevice
    {
        /// <summary>Serial port name (e.g., "COM3" on Windows, "/dev/ttyACM0" on Linux).</summary>
        public string PortName { get; set; }

        /// <summary>Device type determined during discovery.</summary>
        public MozaDeviceRegistry.MozaDeviceType DeviceType { get; set; }

        /// <summary>Primary device ID byte for serial commands.</summary>
        public byte DeviceId { get; set; }

        /// <summary>Sub-type hint from USB descriptor (e.g., "HPattern", "Sequential").</summary>
        public string SubType { get; set; } = "";

        /// <summary>USB product/description string from WMI.</summary>
        public string UsbDescription { get; set; } = "";

        /// <summary>True if the serial port is currently open and responsive.</summary>
        public bool IsConnected { get; set; }

        /// <summary>When the device was last successfully polled.</summary>
        public DateTime LastPollTime { get; set; } = DateTime.MinValue;

        /// <summary>When the device was first discovered this session.</summary>
        public DateTime DiscoveredAt { get; set; } = DateTime.UtcNow;

        /// <summary>Consecutive communication failures (reset on success).</summary>
        public int FailureCount { get; set; }

        /// <summary>Max consecutive failures before marking disconnected.</summary>
        public const int MaxFailures = 3;

        // ── Settings caches (only the matching one is populated) ──────

        /// <summary>Wheelbase settings (non-null only for wheelbase devices).</summary>
        public MozaWheelbaseSettings WheelbaseSettings { get; set; }

        /// <summary>Pedal settings (non-null only for pedal devices).</summary>
        public MozaPedalSettings PedalSettings { get; set; }

        /// <summary>Handbrake settings (non-null only for handbrake devices).</summary>
        public MozaHandbrakeSettings HandbrakeSettings { get; set; }

        /// <summary>Shifter settings (non-null only for shifter devices).</summary>
        public MozaShifterSettings ShifterSettings { get; set; }

        /// <summary>Dashboard settings (non-null only for dashboard devices).</summary>
        public MozaDashboardSettings DashboardSettings { get; set; }

        /// <summary>Steering wheel settings (non-null only for wheel devices).</summary>
        public MozaWheelSettings WheelSettings { get; set; }

        /// <summary>
        /// Creates a new MozaDevice and initializes the appropriate settings cache
        /// based on device type.
        /// </summary>
        public MozaDevice(string portName, MozaDeviceRegistry.MozaDeviceType deviceType, byte deviceId, string subType = "")
        {
            PortName = portName;
            DeviceType = deviceType;
            DeviceId = deviceId;
            SubType = subType ?? "";

            switch (deviceType)
            {
                case MozaDeviceRegistry.MozaDeviceType.Wheelbase:
                    WheelbaseSettings = new MozaWheelbaseSettings();
                    break;
                case MozaDeviceRegistry.MozaDeviceType.Pedals:
                    PedalSettings = new MozaPedalSettings();
                    break;
                case MozaDeviceRegistry.MozaDeviceType.Handbrake:
                    HandbrakeSettings = new MozaHandbrakeSettings();
                    break;
                case MozaDeviceRegistry.MozaDeviceType.Shifter:
                    ShifterSettings = new MozaShifterSettings { ShifterType = subType ?? "" };
                    break;
                case MozaDeviceRegistry.MozaDeviceType.Dashboard:
                    DashboardSettings = new MozaDashboardSettings();
                    break;
                case MozaDeviceRegistry.MozaDeviceType.SteeringWheel:
                    WheelSettings = new MozaWheelSettings();
                    break;
            }
        }

        /// <summary>Record a successful poll.</summary>
        public void RecordSuccess()
        {
            FailureCount = 0;
            LastPollTime = DateTime.UtcNow;
            IsConnected = true;
        }

        /// <summary>Record a communication failure. Returns true if the device should be marked disconnected.</summary>
        public bool RecordFailure()
        {
            FailureCount++;
            if (FailureCount >= MaxFailures)
            {
                IsConnected = false;
                return true;
            }
            return false;
        }

        /// <summary>Human-readable device label for logging and UI.</summary>
        public string DisplayName
        {
            get
            {
                string name = DeviceType.ToString();
                if (!string.IsNullOrEmpty(SubType))
                    name += $" ({SubType})";
                return $"Moza {name} on {PortName}";
            }
        }
    }
}
