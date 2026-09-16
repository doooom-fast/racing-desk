using System;
using System.Collections.Generic;

namespace RaceCorProDrive.Tests.TestHelpers
{
    // ═══════════════════════════════════════════════════════════════
    //  Standalone reimplementation of Moza protocol logic for testing.
    //  Mirrors: MozaPacketBuilder, MozaResponseParser, MozaDeviceRegistry
    //  from the plugin's Engine/Moza/ directory.
    // ═══════════════════════════════════════════════════════════════

    public static class MozaPacketBuilder
    {
        public const byte StartByte = 0x7E;
        public const byte GroupRead = 0x21;
        public const byte GroupWrite = 0x22;
        public const int ChecksumMagic = 13;

        public static byte[] BuildReadPacket(byte deviceId, byte commandId)
        {
            return BuildReadPacket(deviceId, new[] { commandId });
        }

        public static byte[] BuildReadPacket(byte deviceId, byte[] commandId)
        {
            if (commandId == null || commandId.Length == 0)
                throw new ArgumentException("Command ID must not be empty.");

            int length = 1 + 1 + commandId.Length + 1; // +1 for checksum
            if (length < 2 || length > 11)
                throw new ArgumentException($"Payload length {length} out of valid range 2–11.");

            var packet = new List<byte> { StartByte, (byte)length, GroupRead, deviceId };
            packet.AddRange(commandId);
            packet.Add(CalculateChecksum(packet.ToArray()));
            return packet.ToArray();
        }

        public static byte[] BuildWritePacket(byte deviceId, byte commandId, byte value)
        {
            return BuildWritePacket(deviceId, new[] { commandId }, new[] { value });
        }

        public static byte[] BuildWritePacket(byte deviceId, byte commandId, ushort value)
        {
            return BuildWritePacket(deviceId, new[] { commandId }, ToBigEndian16(value));
        }

        public static byte[] BuildWritePacket(byte deviceId, byte[] commandId, byte[] payload)
        {
            if (commandId == null || commandId.Length == 0)
                throw new ArgumentException("Command ID must not be empty.");
            if (payload == null)
                throw new ArgumentNullException(nameof(payload));

            int length = 1 + 1 + commandId.Length + payload.Length + 1; // +1 for checksum
            if (length < 2 || length > 11)
                throw new ArgumentException($"Payload length {length} out of valid range 2–11.");

            var packet = new List<byte> { StartByte, (byte)length, GroupWrite, deviceId };
            packet.AddRange(commandId);
            packet.AddRange(payload);
            packet.Add(CalculateChecksum(packet.ToArray()));
            return packet.ToArray();
        }

        public static byte CalculateChecksum(byte[] packetWithoutChecksum)
        {
            int sum = ChecksumMagic;
            for (int i = 0; i < packetWithoutChecksum.Length; i++)
                sum += packetWithoutChecksum[i];
            return (byte)(sum % 256);
        }

        public static byte[] ToBigEndian16(ushort value)
        {
            return new byte[] { (byte)(value >> 8), (byte)(value & 0xFF) };
        }

        public static ushort FromBigEndian16(byte[] data, int offset = 0)
        {
            if (data == null || offset + 2 > data.Length)
                throw new ArgumentException("Need at least 2 bytes for a 16-bit value.");
            return (ushort)((data[offset] << 8) | data[offset + 1]);
        }
    }

    public static class MozaResponseParser
    {
        public const byte GroupReadResponse = 0xA1;
        public const byte GroupWriteResponse = 0xA2;

        public static byte SwapNibbles(byte b)
        {
            return (byte)(((b & 0x0F) << 4) | ((b & 0xF0) >> 4));
        }

        public static List<MozaResponse> ParseResponses(byte[] buffer)
        {
            var results = new List<MozaResponse>();
            if (buffer == null || buffer.Length < 4) return results;

            int i = 0;
            while (i < buffer.Length)
            {
                if (buffer[i] != MozaPacketBuilder.StartByte) { i++; continue; }
                if (i + 1 >= buffer.Length) break;

                int length = buffer[i + 1];
                if (length < 2 || length > 11) { i++; continue; }

                int totalSize = 2 + length; // start(1) + length_field(1) + length_value (includes checksum)
                if (i + totalSize > buffer.Length) break;

                byte[] packetWithoutChecksum = new byte[totalSize - 1];
                Array.Copy(buffer, i, packetWithoutChecksum, 0, totalSize - 1);
                byte expected = MozaPacketBuilder.CalculateChecksum(packetWithoutChecksum);
                byte actual = buffer[i + totalSize - 1];

                if (expected != actual) { i++; continue; }

                byte group = buffer[i + 2];
                byte swappedDeviceId = buffer[i + 3];
                byte originalDeviceId = SwapNibbles(swappedDeviceId);

                bool isRead = group == GroupReadResponse;
                bool isWrite = group == GroupWriteResponse;
                if (!isRead && !isWrite) { i += totalSize; continue; }

                int dataLen = length - 3; // length minus group(1) + deviceId(1) + checksum(1)
                byte[] data = new byte[dataLen];
                if (dataLen > 0) Array.Copy(buffer, i + 4, data, 0, dataLen);

                results.Add(new MozaResponse
                {
                    IsReadResponse = isRead,
                    DeviceId = originalDeviceId,
                    SwappedDeviceId = swappedDeviceId,
                    CommandAndPayload = data
                });

                i += totalSize;
            }

            return results;
        }

        public static byte GetCommandId(MozaResponse response)
        {
            if (response.CommandAndPayload == null || response.CommandAndPayload.Length == 0)
                throw new InvalidOperationException("No command data.");
            return response.CommandAndPayload[0];
        }

        public static byte GetValueByte(MozaResponse response)
        {
            if (response.CommandAndPayload == null || response.CommandAndPayload.Length < 2)
                throw new InvalidOperationException("No value byte.");
            return response.CommandAndPayload[1];
        }

        public static ushort GetValueUInt16(MozaResponse response)
        {
            if (response.CommandAndPayload == null || response.CommandAndPayload.Length < 3)
                throw new InvalidOperationException("No 16-bit value.");
            return MozaPacketBuilder.FromBigEndian16(response.CommandAndPayload, 1);
        }
    }

    public class MozaResponse
    {
        public bool IsReadResponse { get; set; }
        public byte DeviceId { get; set; }
        public byte SwappedDeviceId { get; set; }
        public byte[] CommandAndPayload { get; set; }
    }

    /// <summary>Subset of device registry constants needed for tests.</summary>
    public static class MozaDeviceIds
    {
        public const byte UniversalHub = 0x12;
        public const byte Wheelbase = 0x13;
        public const byte Dashboard = 0x14;
        public const byte SteeringWheelPrimary = 0x15;
        public const byte SteeringWheelExtended = 0x17;
        public const byte Pedals = 0x19;
        public const byte Shifter = 0x1A;
        public const byte Handbrake = 0x1B;
        public const byte EStop = 0x1C;
    }
}
