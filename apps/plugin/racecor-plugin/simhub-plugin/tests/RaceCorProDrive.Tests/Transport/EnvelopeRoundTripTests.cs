using System;
using System.Collections.Generic;
using MessagePack;
using NUnit.Framework;
using RaceCorProDrive.Plugin.Transport;

namespace RaceCorProDrive.Tests.Transport
{
    [TestFixture]
    public class EnvelopeRoundTripTests
    {
        // TypelessContractlessStandardResolver is required for serializing object-typed members
        // containing Dictionary<string, object> with mixed primitive values
        private static readonly MessagePackSerializerOptions _options = MessagePackSerializerOptions.Standard
            .WithResolver(MessagePack.Resolvers.TypelessContractlessStandardResolver.Instance);

        [Test]
        public void SnapshotEnvelopeRoundTrip()
        {
            var dict = new Dictionary<string, object>
            {
                { "key1", 42 },
                { "key2", "value" },
                { "key3", 3.14 }
            };

            var envelope = new Envelope { t = Tag.Snapshot, v = 1, d = dict };
            var bytes = MessagePackSerializer.Serialize(envelope, _options);
            var decoded = MessagePackSerializer.Deserialize<Envelope>(bytes, _options);

            Assert.AreEqual(Tag.Snapshot, decoded.t);
            Assert.AreEqual(1, decoded.v);
            Assert.IsNotNull(decoded.d);
        }

        [Test]
        public void DeltaEnvelopeRoundTrip()
        {
            var delta = new Dictionary<string, object> { { "changed_key", 100 } };
            var envelope = new Envelope { t = Tag.Delta, v = 1, d = delta };

            var bytes = MessagePackSerializer.Serialize(envelope, _options);
            var decoded = MessagePackSerializer.Deserialize<Envelope>(bytes, _options);

            Assert.AreEqual(Tag.Delta, decoded.t);
            Assert.AreEqual(1, decoded.v);
        }

        [Test]
        public void RequestEnvelopeRoundTrip()
        {
            var req = new RequestPayload
            {
                id = "req-123",
                action = "setTC",
                @params = new Dictionary<string, object> { { "value", 5 } }
            };

            var envelope = new Envelope { t = Tag.Request, v = 1, d = req };
            var bytes = MessagePackSerializer.Serialize(envelope, _options);
            var decoded = MessagePackSerializer.Deserialize<Envelope>(bytes, _options);

            Assert.AreEqual(Tag.Request, decoded.t);
            Assert.AreEqual(1, decoded.v);
        }

        [Test]
        public void ResponseEnvelopeRoundTrip()
        {
            var resp = new ResponsePayload
            {
                id = "req-123",
                ok = true,
                result = new { success = true }
            };

            var envelope = new Envelope { t = Tag.Response, v = 1, d = resp };
            var bytes = MessagePackSerializer.Serialize(envelope, _options);
            var decoded = MessagePackSerializer.Deserialize<Envelope>(bytes, _options);

            Assert.AreEqual(Tag.Response, decoded.t);
            Assert.AreEqual(1, decoded.v);
        }

        [Test]
        public void EventEnvelopeRoundTrip()
        {
            var evt = new EventPayload
            {
                name = "sessionEnded",
                payload = new { sessionDuration = 1800 }
            };

            var envelope = new Envelope { t = Tag.Event, v = 1, d = evt };
            var bytes = MessagePackSerializer.Serialize(envelope, _options);
            var decoded = MessagePackSerializer.Deserialize<Envelope>(bytes, _options);

            Assert.AreEqual(Tag.Event, decoded.t);
            Assert.AreEqual(1, decoded.v);
        }

        [Test]
        public void Snapshot_MixedValueDict_RoundTripsCorrectly()
        {
            // Build a realistic mixed-value Dictionary<string, object> mimicking telemetry data
            var mixedDict = new Dictionary<string, object>
            {
                { "GameRunning", true },
                { "Position", 1 },
                { "Rpm", 6500L },
                { "SpeedMph", 142.75 },
                { "Throttle", 0.95 },
                { "DriverName", "Test Driver" },
                { "FuelLevel", null },
                { "SectorSplits", "1.234,1.256,1.245" },
                { "CarModel", "Ferrari 488" }
            };

            var envelope = new Envelope { t = Tag.Snapshot, v = 1, d = mixedDict };
            var bytes = MessagePackSerializer.Serialize(envelope, _options);
            var decoded = MessagePackSerializer.Deserialize<Envelope>(bytes, _options);

            Assert.AreEqual(Tag.Snapshot, decoded.t);
            Assert.AreEqual(1, decoded.v);
            Assert.IsNotNull(decoded.d);

            // Verify round-trip of mixed values
            var decodedDict = decoded.d as Dictionary<string, object>;
            Assert.IsNotNull(decodedDict);
            Assert.AreEqual(mixedDict.Count, decodedDict.Count);
            Assert.AreEqual(true, decodedDict["GameRunning"]);
            Assert.AreEqual(1, decodedDict["Position"]);
            Assert.AreEqual(142.75, decodedDict["SpeedMph"]);
            Assert.AreEqual("Test Driver", decodedDict["DriverName"]);
            Assert.IsNull(decodedDict["FuelLevel"]);
        }
    }
}
