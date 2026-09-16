using System;
using System.Collections.Generic;
using NUnit.Framework;
using RaceCorProDrive.Tests.TestHelpers;

namespace RaceCorProDrive.Tests
{
    [TestFixture]
    public class MozaProtocolTests
    {
        // ═══════════════════════════════════════════════════════════════
        //  CHECKSUM CALCULATION
        // ═══════════════════════════════════════════════════════════════

        [Test]
        public void Checksum_MagicConstant_Is13()
        {
            Assert.That(MozaPacketBuilder.ChecksumMagic, Is.EqualTo(13));
        }

        [Test]
        public void Checksum_EmptyPacket_ReturnsMagic()
        {
            byte result = MozaPacketBuilder.CalculateChecksum(Array.Empty<byte>());
            Assert.That(result, Is.EqualTo(13));
        }

        [Test]
        public void Checksum_KnownPacket_MatchesExpected()
        {
            // From protocol doc: Read wheelbase FFB strength
            // Packet: 7E 04 21 13 14 → checksum should be 0xD7 (215)
            byte[] packet = new byte[] { 0x7E, 0x04, 0x21, 0x13, 0x14 };
            byte checksum = MozaPacketBuilder.CalculateChecksum(packet);
            // (13 + 126 + 4 + 33 + 19 + 20) % 256 = 215 = 0xD7
            Assert.That(checksum, Is.EqualTo(0xD7));
        }

        [Test]
        public void Checksum_Wraps_At256()
        {
            // Force a sum > 256 to verify modulo
            byte[] packet = new byte[] { 0xFF, 0xFF, 0xFF };
            byte checksum = MozaPacketBuilder.CalculateChecksum(packet);
            // (13 + 255 + 255 + 255) % 256 = 778 % 256 = 10
            Assert.That(checksum, Is.EqualTo((byte)((13 + 255 * 3) % 256)));
        }

        // ═══════════════════════════════════════════════════════════════
        //  NIBBLE SWAP
        // ═══════════════════════════════════════════════════════════════

        [TestCase((byte)0x13, (byte)0x31, TestName = "Wheelbase_0x13_to_0x31")]
        [TestCase((byte)0x19, (byte)0x91, TestName = "Pedals_0x19_to_0x91")]
        [TestCase((byte)0x1A, (byte)0xA1, TestName = "Shifter_0x1A_to_0xA1")]
        [TestCase((byte)0x1B, (byte)0xB1, TestName = "Handbrake_0x1B_to_0xB1")]
        [TestCase((byte)0x12, (byte)0x21, TestName = "Hub_0x12_to_0x21")]
        [TestCase((byte)0x00, (byte)0x00, TestName = "Zero_unchanged")]
        [TestCase((byte)0xFF, (byte)0xFF, TestName = "0xFF_unchanged")]
        [TestCase((byte)0xAB, (byte)0xBA, TestName = "0xAB_to_0xBA")]
        public void SwapNibbles_ReturnsExpected(byte input, byte expected)
        {
            Assert.That(MozaResponseParser.SwapNibbles(input), Is.EqualTo(expected));
        }

        [Test]
        public void SwapNibbles_IsOwnInverse()
        {
            // Swapping twice should return the original
            for (int i = 0; i <= 255; i++)
            {
                byte b = (byte)i;
                Assert.That(MozaResponseParser.SwapNibbles(MozaResponseParser.SwapNibbles(b)), Is.EqualTo(b),
                    $"SwapNibbles is not its own inverse for 0x{b:X2}");
            }
        }

        // ═══════════════════════════════════════════════════════════════
        //  BIG-ENDIAN CONVERSION
        // ═══════════════════════════════════════════════════════════════

        [TestCase((ushort)0, new byte[] { 0x00, 0x00 }, TestName = "Zero")]
        [TestCase((ushort)256, new byte[] { 0x01, 0x00 }, TestName = "256")]
        [TestCase((ushort)900, new byte[] { 0x03, 0x84 }, TestName = "900_rotation")]
        [TestCase((ushort)65535, new byte[] { 0xFF, 0xFF }, TestName = "MaxUInt16")]
        public void ToBigEndian16_CorrectBytes(ushort value, byte[] expected)
        {
            byte[] result = MozaPacketBuilder.ToBigEndian16(value);
            Assert.That(result, Is.EqualTo(expected));
        }

        [Test]
        public void FromBigEndian16_RoundTrips()
        {
            ushort[] testValues = { 0, 1, 255, 256, 900, 1800, 65535 };
            foreach (var val in testValues)
            {
                byte[] encoded = MozaPacketBuilder.ToBigEndian16(val);
                ushort decoded = MozaPacketBuilder.FromBigEndian16(encoded);
                Assert.That(decoded, Is.EqualTo(val), $"Round-trip failed for {val}");
            }
        }

        [Test]
        public void FromBigEndian16_WithOffset()
        {
            byte[] data = { 0x00, 0x03, 0x84 }; // offset 1 → 0x0384 = 900
            ushort result = MozaPacketBuilder.FromBigEndian16(data, 1);
            Assert.That(result, Is.EqualTo(900));
        }

        [Test]
        public void FromBigEndian16_TooShort_Throws()
        {
            Assert.Throws<ArgumentException>(() => MozaPacketBuilder.FromBigEndian16(new byte[] { 0x01 }));
        }

        // ═══════════════════════════════════════════════════════════════
        //  PACKET BUILDING — READ
        // ═══════════════════════════════════════════════════════════════

        [Test]
        public void BuildReadPacket_WheelbaseFfb_MatchesProtocolDoc()
        {
            byte[] packet = MozaPacketBuilder.BuildReadPacket(MozaDeviceIds.Wheelbase, 0x14);

            // Expected from protocol doc: 7E 04 21 13 14 D7
            Assert.That(packet, Is.EqualTo(new byte[] { 0x7E, 0x04, 0x21, 0x13, 0x14, 0xD7 }),
                "Packet should match protocol doc example exactly");
        }

        [Test]
        public void BuildReadPacket_EmptyCommand_Throws()
        {
            Assert.Throws<ArgumentException>(() =>
                MozaPacketBuilder.BuildReadPacket(MozaDeviceIds.Wheelbase, Array.Empty<byte>()));
        }

        // ═══════════════════════════════════════════════════════════════
        //  PACKET BUILDING — WRITE
        // ═══════════════════════════════════════════════════════════════

        [Test]
        public void BuildWritePacket_SingleByte_CorrectStructure()
        {
            byte[] packet = MozaPacketBuilder.BuildWritePacket(MozaDeviceIds.Wheelbase, 0x14, (byte)85);

            Assert.That(packet[0], Is.EqualTo(0x7E), "Start byte");
            Assert.That(packet[2], Is.EqualTo(MozaPacketBuilder.GroupWrite), "Group = Write");
            Assert.That(packet[3], Is.EqualTo(MozaDeviceIds.Wheelbase), "Device ID");
            Assert.That(packet[4], Is.EqualTo(0x14), "Command ID");
            Assert.That(packet[5], Is.EqualTo(85), "Value");

            // Verify checksum
            byte[] withoutChecksum = new byte[packet.Length - 1];
            Array.Copy(packet, withoutChecksum, packet.Length - 1);
            Assert.That(packet[packet.Length - 1], Is.EqualTo(MozaPacketBuilder.CalculateChecksum(withoutChecksum)));
        }

        [Test]
        public void BuildWritePacket_16Bit_BigEndianPayload()
        {
            byte[] packet = MozaPacketBuilder.BuildWritePacket(MozaDeviceIds.Wheelbase, 0x19, (ushort)900);

            // Payload should be big-endian: 0x03, 0x84
            Assert.That(packet[5], Is.EqualTo(0x03), "High byte of 900");
            Assert.That(packet[6], Is.EqualTo(0x84), "Low byte of 900");
        }

        // ═══════════════════════════════════════════════════════════════
        //  RESPONSE PARSING
        // ═══════════════════════════════════════════════════════════════

        [Test]
        public void ParseResponse_ValidReadResponse_Parsed()
        {
            // Simulate response: read wheelbase FFB = 100 (0x64)
            // Response: 7E 05 A1 31 14 64 [checksum]
            // length = group(A1) + device(31) + cmd(14) + value(64) + checksum = 5
            byte[] pkt = { 0x7E, 0x05, 0xA1, 0x31, 0x14, 0x64, 0x00 };
            // Calculate and set correct checksum
            byte[] withoutCk = new byte[pkt.Length - 1];
            Array.Copy(pkt, withoutCk, pkt.Length - 1);
            pkt[pkt.Length - 1] = MozaPacketBuilder.CalculateChecksum(withoutCk);

            var responses = MozaResponseParser.ParseResponses(pkt);

            Assert.That(responses.Count, Is.EqualTo(1));
            var resp = responses[0];
            Assert.That(resp.IsReadResponse, Is.True);
            Assert.That(resp.DeviceId, Is.EqualTo(MozaDeviceIds.Wheelbase), "Unswapped device ID");
            Assert.That(resp.SwappedDeviceId, Is.EqualTo(0x31), "Raw swapped ID");
            Assert.That(MozaResponseParser.GetCommandId(resp), Is.EqualTo(0x14));
            Assert.That(MozaResponseParser.GetValueByte(resp), Is.EqualTo(100));
        }

        [Test]
        public void ParseResponse_InvalidChecksum_Skipped()
        {
            byte[] pkt = { 0x7E, 0x05, 0xA1, 0x31, 0x14, 0x64, 0x00 }; // bad checksum

            var responses = MozaResponseParser.ParseResponses(pkt);
            Assert.That(responses.Count, Is.EqualTo(0));
        }

        [Test]
        public void ParseResponse_NullBuffer_ReturnsEmpty()
        {
            Assert.That(MozaResponseParser.ParseResponses(null).Count, Is.EqualTo(0));
        }

        [Test]
        public void ParseResponse_ShortBuffer_ReturnsEmpty()
        {
            Assert.That(MozaResponseParser.ParseResponses(new byte[] { 0x7E }).Count, Is.EqualTo(0));
        }

        [Test]
        public void ParseResponse_WriteResponse_Parsed()
        {
            // Write response: Group = 0xA2, length includes checksum
            byte[] pkt = { 0x7E, 0x05, 0xA2, 0x31, 0x14, 0x55, 0x00 };
            byte[] withoutCk = new byte[pkt.Length - 1];
            Array.Copy(pkt, withoutCk, pkt.Length - 1);
            pkt[pkt.Length - 1] = MozaPacketBuilder.CalculateChecksum(withoutCk);

            var responses = MozaResponseParser.ParseResponses(pkt);
            Assert.That(responses.Count, Is.EqualTo(1));
            Assert.That(responses[0].IsReadResponse, Is.False);
        }

        [Test]
        public void ParseResponse_16BitValue_Extracted()
        {
            // Simulate: read max rotation angle = 900 (0x0384)
            // Response: 7E 06 A1 31 19 03 84 [checksum] — length=6 (group+device+cmd+val_hi+val_lo+checksum)
            byte[] pkt = { 0x7E, 0x06, 0xA1, 0x31, 0x19, 0x03, 0x84, 0x00 };
            byte[] withoutCk = new byte[pkt.Length - 1];
            Array.Copy(pkt, withoutCk, pkt.Length - 1);
            pkt[pkt.Length - 1] = MozaPacketBuilder.CalculateChecksum(withoutCk);

            var responses = MozaResponseParser.ParseResponses(pkt);
            Assert.That(responses.Count, Is.EqualTo(1));
            Assert.That(MozaResponseParser.GetValueUInt16(responses[0]), Is.EqualTo(900));
        }

        [Test]
        public void ParseResponse_MultiplePackets_AllParsed()
        {
            // Build two valid response packets back-to-back
            byte[] pkt1 = BuildTestResponse(0xA1, 0x31, 0x14, new byte[] { 0x64 });
            byte[] pkt2 = BuildTestResponse(0xA1, 0x91, 0x30, new byte[] { 0x0A });

            byte[] combined = new byte[pkt1.Length + pkt2.Length];
            Array.Copy(pkt1, 0, combined, 0, pkt1.Length);
            Array.Copy(pkt2, 0, combined, pkt1.Length, pkt2.Length);

            var responses = MozaResponseParser.ParseResponses(combined);
            Assert.That(responses.Count, Is.EqualTo(2));
        }

        [Test]
        public void ParseResponse_GarbageBeforePacket_StillParsed()
        {
            byte[] validPacket = BuildTestResponse(0xA1, 0x31, 0x14, new byte[] { 0x64 });
            byte[] withGarbage = new byte[3 + validPacket.Length];
            withGarbage[0] = 0xAA;
            withGarbage[1] = 0xBB;
            withGarbage[2] = 0xCC;
            Array.Copy(validPacket, 0, withGarbage, 3, validPacket.Length);

            var responses = MozaResponseParser.ParseResponses(withGarbage);
            Assert.That(responses.Count, Is.EqualTo(1));
            Assert.That(responses[0].DeviceId, Is.EqualTo(MozaDeviceIds.Wheelbase));
        }

        // ═══════════════════════════════════════════════════════════════
        //  DEVICE ID MAPPING
        // ═══════════════════════════════════════════════════════════════

        [Test]
        public void DeviceIds_AllUnique()
        {
            var ids = new HashSet<byte>
            {
                MozaDeviceIds.UniversalHub, MozaDeviceIds.Wheelbase,
                MozaDeviceIds.Dashboard, MozaDeviceIds.SteeringWheelPrimary,
                MozaDeviceIds.SteeringWheelExtended, MozaDeviceIds.Pedals,
                MozaDeviceIds.Shifter, MozaDeviceIds.Handbrake, MozaDeviceIds.EStop
            };
            Assert.That(ids.Count, Is.EqualTo(9), "All device IDs should be unique");
        }

        [TestCase(MozaDeviceIds.Wheelbase, (byte)0x31, TestName = "Wheelbase response device ID")]
        [TestCase(MozaDeviceIds.Pedals, (byte)0x91, TestName = "Pedals response device ID")]
        [TestCase(MozaDeviceIds.Shifter, (byte)0xA1, TestName = "Shifter response device ID")]
        [TestCase(MozaDeviceIds.Handbrake, (byte)0xB1, TestName = "Handbrake response device ID")]
        [TestCase(MozaDeviceIds.Dashboard, (byte)0x41, TestName = "Dashboard response device ID")]
        public void ResponseDeviceId_MatchesSwap(byte requestId, byte expectedResponseId)
        {
            Assert.That(MozaResponseParser.SwapNibbles(requestId), Is.EqualTo(expectedResponseId));
        }

        // ═══════════════════════════════════════════════════════════════
        //  END-TO-END: BUILD REQUEST → PARSE RESPONSE
        // ═══════════════════════════════════════════════════════════════

        [Test]
        public void RoundTrip_ReadWheelbaseFfb_CorrectResponse()
        {
            // Build a read request
            byte[] request = MozaPacketBuilder.BuildReadPacket(MozaDeviceIds.Wheelbase, 0x14);

            // Simulate device response (FFB = 85%)
            byte responseGroup = (byte)(request[2] + 0x80); // 0x21 → 0xA1
            byte responseDeviceId = MozaResponseParser.SwapNibbles(request[3]); // 0x13 → 0x31
            byte[] response = BuildTestResponse(responseGroup, responseDeviceId, 0x14, new byte[] { 85 });

            var parsed = MozaResponseParser.ParseResponses(response);
            Assert.That(parsed.Count, Is.EqualTo(1));
            Assert.That(parsed[0].DeviceId, Is.EqualTo(MozaDeviceIds.Wheelbase));
            Assert.That(MozaResponseParser.GetValueByte(parsed[0]), Is.EqualTo(85));
        }

        [Test]
        public void RoundTrip_WritePedalDeadzone_CorrectPacket()
        {
            // Build a write packet for pedal throttle deadzone = 5
            byte cmdId = (byte)(0x30 + 0x02); // ThrottleBase + Deadzone offset
            byte[] packet = MozaPacketBuilder.BuildWritePacket(MozaDeviceIds.Pedals, cmdId, (byte)5);

            Assert.That(packet[2], Is.EqualTo(MozaPacketBuilder.GroupWrite));
            Assert.That(packet[3], Is.EqualTo(MozaDeviceIds.Pedals));
            Assert.That(packet[4], Is.EqualTo(cmdId));
            Assert.That(packet[5], Is.EqualTo(5));
        }

        // ═══════════════════════════════════════════════════════════════
        //  HELPERS
        // ═══════════════════════════════════════════════════════════════

        /// <summary>Builds a valid response packet with correct checksum.</summary>
        private static byte[] BuildTestResponse(byte group, byte swappedDeviceId, byte commandId, byte[] payload)
        {
            // length = group(1) + deviceId(1) + cmd(1) + payload(N) + checksum(1)
            int length = 1 + 1 + 1 + payload.Length + 1;
            var pkt = new List<byte> { 0x7E, (byte)length, group, swappedDeviceId, commandId };
            pkt.AddRange(payload);
            byte[] withoutCk = pkt.ToArray();
            pkt.Add(MozaPacketBuilder.CalculateChecksum(withoutCk));
            return pkt.ToArray();
        }
    }
}
