using System;
using System.Collections.Generic;

namespace RaceCorProDrive.Plugin.Engine.Moza
{
    /// <summary>
    /// Parses Moza serial protocol responses.
    /// Responses mirror requests with: Group + 0x80, Device ID nibbles swapped.
    /// </summary>
    public static class MozaResponseParser
    {
        /// <summary>Read-response group byte (0x21 + 0x80).</summary>
        public const byte GroupReadResponse = 0xA1;

        /// <summary>Write-response group byte (0x22 + 0x80).</summary>
        public const byte GroupWriteResponse = 0xA2;

        /// <summary>
        /// Swaps the upper and lower nibbles of a byte.
        /// Used to match response device IDs back to request device IDs.
        /// E.g., 0x13 (wheelbase) → 0x31, 0x19 (pedals) → 0x91
        /// </summary>
        public static byte SwapNibbles(byte b)
        {
            return (byte)(((b & 0x0F) << 4) | ((b & 0xF0) >> 4));
        }

        /// <summary>
        /// Attempts to parse one or more responses from a raw byte buffer.
        /// Returns all valid parsed responses found.
        /// </summary>
        /// <param name="buffer">Raw bytes received from serial port.</param>
        /// <returns>List of parsed response frames.</returns>
        public static List<MozaResponse> ParseResponses(byte[] buffer)
        {
            var results = new List<MozaResponse>();
            if (buffer == null || buffer.Length < 4) return results;

            int i = 0;
            while (i < buffer.Length)
            {
                // Scan for start byte
                if (buffer[i] != MozaPacketBuilder.StartByte)
                {
                    i++;
                    continue;
                }

                // Need at least: start + length + group + device + checksum = 5 bytes minimum
                if (i + 1 >= buffer.Length) break;

                int length = buffer[i + 1];
                if (length < 2 || length > 11)
                {
                    i++;
                    continue;
                }

                // Total packet size: start(1) + length_field(1) + length_value (includes checksum as last byte)
                int totalSize = 2 + length;
                if (i + totalSize > buffer.Length) break;

                // Extract packet bytes (without checksum) for validation
                // Checksum is the last byte of the length-counted region
                byte[] packetWithoutChecksum = new byte[totalSize - 1];
                Array.Copy(buffer, i, packetWithoutChecksum, 0, totalSize - 1);
                byte expectedChecksum = MozaPacketBuilder.CalculateChecksum(packetWithoutChecksum);
                byte actualChecksum = buffer[i + totalSize - 1];

                if (expectedChecksum != actualChecksum)
                {
                    i++;
                    continue;
                }

                // Parse the response frame
                byte group = buffer[i + 2];
                byte swappedDeviceId = buffer[i + 3];
                byte originalDeviceId = SwapNibbles(swappedDeviceId);

                bool isReadResponse = group == GroupReadResponse;
                bool isWriteResponse = group == GroupWriteResponse;

                if (!isReadResponse && !isWriteResponse)
                {
                    i += totalSize;
                    continue;
                }

                // Remaining bytes after group + deviceId are command + payload
                // length = group(1) + deviceId(1) + command(N) + payload(M) + checksum(1)
                // So command+payload bytes = length - 3
                int dataLen = length - 3;
                byte[] data = new byte[dataLen];
                if (dataLen > 0)
                    Array.Copy(buffer, i + 4, data, 0, dataLen);

                results.Add(new MozaResponse
                {
                    IsReadResponse = isReadResponse,
                    DeviceId = originalDeviceId,
                    SwappedDeviceId = swappedDeviceId,
                    CommandAndPayload = data,
                    RawPacket = ExtractBytes(buffer, i, totalSize)
                });

                i += totalSize;
            }

            return results;
        }

        /// <summary>
        /// Extracts the command ID byte from a parsed response.
        /// For single-byte commands, this is the first byte of CommandAndPayload.
        /// </summary>
        public static byte GetCommandId(MozaResponse response)
        {
            if (response.CommandAndPayload == null || response.CommandAndPayload.Length == 0)
                throw new InvalidOperationException("Response has no command data.");
            return response.CommandAndPayload[0];
        }

        /// <summary>
        /// Extracts the payload value as a single byte from a parsed response.
        /// Assumes a single-byte command ID followed by a single-byte value.
        /// </summary>
        public static byte GetValueByte(MozaResponse response)
        {
            if (response.CommandAndPayload == null || response.CommandAndPayload.Length < 2)
                throw new InvalidOperationException("Response does not contain a value byte.");
            return response.CommandAndPayload[1];
        }

        /// <summary>
        /// Extracts the payload value as a 16-bit big-endian unsigned integer.
        /// Assumes a single-byte command ID followed by two payload bytes.
        /// </summary>
        public static ushort GetValueUInt16(MozaResponse response)
        {
            if (response.CommandAndPayload == null || response.CommandAndPayload.Length < 3)
                throw new InvalidOperationException("Response does not contain a 16-bit value.");
            return MozaPacketBuilder.FromBigEndian16(response.CommandAndPayload, 1);
        }

        private static byte[] ExtractBytes(byte[] source, int offset, int count)
        {
            byte[] result = new byte[count];
            Array.Copy(source, offset, result, 0, count);
            return result;
        }
    }

    /// <summary>
    /// Represents a single parsed Moza serial response frame.
    /// </summary>
    public class MozaResponse
    {
        /// <summary>True if this is a read response (group 0xA1), false if write response (0xA2).</summary>
        public bool IsReadResponse { get; set; }

        /// <summary>Original (un-swapped) device ID — matches the request device ID.</summary>
        public byte DeviceId { get; set; }

        /// <summary>Nibble-swapped device ID as it appeared in the response.</summary>
        public byte SwappedDeviceId { get; set; }

        /// <summary>Command ID + payload bytes (everything after group + deviceId in the frame).</summary>
        public byte[] CommandAndPayload { get; set; }

        /// <summary>Complete raw packet bytes (for debugging).</summary>
        public byte[] RawPacket { get; set; }
    }
}
