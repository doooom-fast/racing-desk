using System;
using System.Collections.Generic;

namespace RaceCorProDrive.Plugin.Engine.Moza
{
    /// <summary>
    /// Constructs Moza serial protocol packets for reading and writing device settings.
    /// All packets follow the fixed frame: [0x7E][Length][Group][DeviceID][CommandID...][Payload...][Checksum]
    /// </summary>
    public static class MozaPacketBuilder
    {
        /// <summary>Start byte for every packet.</summary>
        public const byte StartByte = 0x7E;

        /// <summary>Read command group byte.</summary>
        public const byte GroupRead = 0x21;

        /// <summary>Write command group byte.</summary>
        public const byte GroupWrite = 0x22;

        /// <summary>
        /// Magic constant added to checksum calculation.
        /// Derived from USB endpoint data (endpoint 0x02, transfer type 0x03, message length 0x08: 2+3+8=13).
        /// DO NOT CHANGE — an incorrect checksum causes the device to silently ignore the packet.
        /// </summary>
        public const int ChecksumMagic = 13;

        /// <summary>
        /// Builds a read-request packet for a single setting on a device.
        /// </summary>
        /// <param name="deviceId">Target device ID (e.g., 0x13 for wheelbase).</param>
        /// <param name="commandId">Command ID byte(s) for the setting to read.</param>
        /// <returns>Complete packet including start byte and checksum.</returns>
        public static byte[] BuildReadPacket(byte deviceId, byte[] commandId)
        {
            if (commandId == null || commandId.Length == 0)
                throw new ArgumentException("Command ID must not be empty.", nameof(commandId));

            // Length = group(1) + deviceId(1) + commandId(N) + checksum(1)
            // Per Boxflat protocol: length counts all bytes after start+length, including checksum
            int length = 1 + 1 + commandId.Length + 1;
            if (length < 2 || length > 11)
                throw new ArgumentException($"Payload length {length} out of valid range 2–11.");

            var packet = new List<byte>(length + 2); // start + length + payload + checksum
            packet.Add(StartByte);
            packet.Add((byte)length);
            packet.Add(GroupRead);
            packet.Add(deviceId);
            packet.AddRange(commandId);

            packet.Add(CalculateChecksum(packet.ToArray()));
            return packet.ToArray();
        }

        /// <summary>
        /// Builds a read-request packet for a single-byte command ID.
        /// </summary>
        public static byte[] BuildReadPacket(byte deviceId, byte commandId)
        {
            return BuildReadPacket(deviceId, new[] { commandId });
        }

        /// <summary>
        /// Builds a write-command packet to set a value on a device.
        /// </summary>
        /// <param name="deviceId">Target device ID.</param>
        /// <param name="commandId">Command ID byte(s).</param>
        /// <param name="payload">Value to write (big-endian for multi-byte values).</param>
        /// <returns>Complete packet including start byte and checksum.</returns>
        public static byte[] BuildWritePacket(byte deviceId, byte[] commandId, byte[] payload)
        {
            if (commandId == null || commandId.Length == 0)
                throw new ArgumentException("Command ID must not be empty.", nameof(commandId));
            if (payload == null)
                throw new ArgumentNullException(nameof(payload));

            // Length = group(1) + deviceId(1) + commandId(N) + payload(M) + checksum(1)
            int length = 1 + 1 + commandId.Length + payload.Length + 1;
            if (length < 2 || length > 11)
                throw new ArgumentException($"Payload length {length} out of valid range 2–11.");

            var packet = new List<byte>(length + 3);
            packet.Add(StartByte);
            packet.Add((byte)length);
            packet.Add(GroupWrite);
            packet.Add(deviceId);
            packet.AddRange(commandId);
            packet.AddRange(payload);

            packet.Add(CalculateChecksum(packet.ToArray()));
            return packet.ToArray();
        }

        /// <summary>
        /// Builds a write-command packet for a single-byte command ID with a single-byte value.
        /// </summary>
        public static byte[] BuildWritePacket(byte deviceId, byte commandId, byte value)
        {
            return BuildWritePacket(deviceId, new[] { commandId }, new[] { value });
        }

        /// <summary>
        /// Builds a write-command packet for a single-byte command ID with a 16-bit big-endian value.
        /// </summary>
        public static byte[] BuildWritePacket(byte deviceId, byte commandId, ushort value)
        {
            byte[] payload = ToBigEndian16(value);
            return BuildWritePacket(deviceId, new[] { commandId }, payload);
        }

        /// <summary>
        /// Calculates the Moza checksum for a packet (excluding the checksum byte itself).
        /// Formula: (MAGIC + sum_of_all_bytes) % 256
        /// </summary>
        /// <param name="packetWithoutChecksum">All packet bytes except the final checksum.</param>
        public static byte CalculateChecksum(byte[] packetWithoutChecksum)
        {
            int sum = ChecksumMagic;
            for (int i = 0; i < packetWithoutChecksum.Length; i++)
                sum += packetWithoutChecksum[i];
            return (byte)(sum % 256);
        }

        /// <summary>
        /// Converts a 16-bit unsigned integer to a 2-byte big-endian array.
        /// (.NET BitConverter is little-endian on Windows, so we reverse manually.)
        /// </summary>
        public static byte[] ToBigEndian16(ushort value)
        {
            return new byte[] { (byte)(value >> 8), (byte)(value & 0xFF) };
        }

        /// <summary>
        /// Converts a 2-byte big-endian array to a 16-bit unsigned integer.
        /// </summary>
        public static ushort FromBigEndian16(byte[] data, int offset = 0)
        {
            if (data == null || offset + 2 > data.Length)
                throw new ArgumentException("Need at least 2 bytes for a 16-bit value.");
            return (ushort)((data[offset] << 8) | data[offset + 1]);
        }
    }
}
