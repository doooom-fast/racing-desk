using System;
using System.Collections.Generic;
using System.IO.Ports;
using System.Management;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;

namespace RacingDesk.Plugin.Engine.Moza
{
    /// <summary>What <see cref="IMozaPortSystem.CheckAccess"/> found.</summary>
    internal enum MozaPortAccess
    {
        /// <summary>The port could be opened just now.</summary>
        Free,
        /// <summary>Another handle has the port (access denied): Windows gives a serial port to one handle at a time.</summary>
        Held,
        /// <summary>Anything else — the port is gone, the device does not answer. Opening it will say what.</summary>
        Failed,
    }

    /// <summary>
    /// The machine's serial ports, as <see cref="MozaSerialManager"/> reaches them. Tests stand in for it,
    /// because a test must never open a real port: on the rig, two of them are the Moza base.
    /// </summary>
    internal interface IMozaPortSystem
    {
        /// <summary>The ports Windows lists.</summary>
        string[] GetPortNames();

        /// <summary>What WMI says of each port it knows, by port name. May throw.</summary>
        Dictionary<string, MozaSerialManager.PortWmiInfo> GetPortInfo();

        /// <summary>Whether the port could be opened now, found out without throwing.</summary>
        MozaPortAccess CheckAccess(string portName);

        /// <summary>Opens the port with the Moza line settings. Throws as <see cref="SerialPort.Open"/> does.</summary>
        SerialPort Open(string portName);
    }

    /// <summary>The real serial ports: <see cref="SerialPort"/>, WMI, and kernel32 for the access check.</summary>
    internal sealed class MozaSystemPorts : IMozaPortSystem
    {
        public string[] GetPortNames() => SerialPort.GetPortNames() ?? new string[0];

        public Dictionary<string, MozaSerialManager.PortWmiInfo> GetPortInfo()
        {
            var result = new Dictionary<string, MozaSerialManager.PortWmiInfo>(StringComparer.OrdinalIgnoreCase);

            using (var searcher = new ManagementObjectSearcher(
                "SELECT Name, Description, Manufacturer, HardwareID FROM Win32_PnPEntity WHERE Name LIKE '%(COM%'"))
            {
                foreach (ManagementObject obj in searcher.Get())
                {
                    string name = obj["Name"]?.ToString() ?? "";
                    string desc = obj["Description"]?.ToString() ?? "";
                    string manufacturer = obj["Manufacturer"]?.ToString() ?? "";

                    // HardwareID in WMI is typically a string[] — the first entry
                    // holds the VID/PID token (e.g. "USB\VID_346E&PID_0005&REV_0100").
                    // Join all entries so downstream matching never loses data.
                    string hardwareId = "";
                    if (obj["HardwareID"] is string[] hids && hids.Length > 0)
                    {
                        hardwareId = string.Join(";", hids);
                    }
                    else
                    {
                        hardwareId = obj["HardwareID"]?.ToString() ?? "";
                    }

                    // Extract COM port number from name like "Gudsen MOZA R9 Base (COM3)"
                    var comMatch = Regex.Match(name, @"\(COM(\d+)\)");
                    if (!comMatch.Success) continue;

                    string portName = "COM" + comMatch.Groups[1].Value;
                    string fullDesc = $"{manufacturer} {name} {desc}".Trim();

                    var vidMatch = Regex.Match(hardwareId, @"VID_([0-9A-F]{4})", RegexOptions.IgnoreCase);
                    var pidMatch = Regex.Match(hardwareId, @"PID_([0-9A-F]{4})", RegexOptions.IgnoreCase);

                    result[portName] = new MozaSerialManager.PortWmiInfo
                    {
                        Description = fullDesc,
                        HardwareId = hardwareId,
                        Vid = vidMatch.Success ? vidMatch.Groups[1].Value.ToUpperInvariant() : "",
                        Pid = pidMatch.Success ? pidMatch.Groups[1].Value.ToUpperInvariant() : "",
                    };
                }
            }

            return result;
        }

        private const uint GenericRead = 0x80000000;
        private const uint GenericWrite = 0x40000000;
        private const uint OpenExisting = 3;
        private const uint FileFlagOverlapped = 0x40000000;
        private const int ErrorAccessDenied = 5;

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern SafeFileHandle CreateFile(string fileName, uint desiredAccess, uint shareMode,
            IntPtr securityAttributes, uint creationDisposition, uint flagsAndAttributes, IntPtr templateFile);

        /// <summary>
        /// Asks Windows for the port as <see cref="SerialPort.Open"/> does — read and write, not shared,
        /// overlapped — and closes the handle at once: no line settings, nothing written. Unlike
        /// <see cref="SerialPort.Open"/> it does not throw when the port is held, which matters under SimHub:
        /// SimHub logs every exception thrown in its process, caught or not, with its stack.
        /// </summary>
        public MozaPortAccess CheckAccess(string portName)
        {
            using (var handle = CreateFile(@"\\.\" + portName, GenericRead | GenericWrite, 0,
                IntPtr.Zero, OpenExisting, FileFlagOverlapped, IntPtr.Zero))
            {
                if (!handle.IsInvalid) return MozaPortAccess.Free;
                return Marshal.GetLastWin32Error() == ErrorAccessDenied ? MozaPortAccess.Held : MozaPortAccess.Failed;
            }
        }

        public SerialPort Open(string portName)
        {
            var port = new SerialPort(portName, MozaSerialManager.BaudRate, MozaSerialManager.SerialParity,
                MozaSerialManager.DataBits, MozaSerialManager.SerialStopBits)
            {
                ReadTimeout = MozaSerialManager.ReadTimeoutMs,
                WriteTimeout = MozaSerialManager.WriteTimeoutMs,
                Handshake = Handshake.None
            };
            try
            {
                port.Open();
                port.DiscardInBuffer();
                port.DiscardOutBuffer();
                return port;
            }
            catch
            {
                port.Dispose();
                throw;
            }
        }
    }
}
