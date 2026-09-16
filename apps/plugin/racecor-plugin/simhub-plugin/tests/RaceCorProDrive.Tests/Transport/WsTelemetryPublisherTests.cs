using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using RaceCorProDrive.Plugin.Transport;

namespace RaceCorProDrive.Tests.Transport
{
    // Skipped on non-Windows: WsTelemetryPublisher.OnClientConnected logs via
    // SimHub.Logging.dll, a Windows-only assembly that can't be loaded on the
    // ubuntu-latest CI runner. Tests run on Windows installs.
    [TestFixture]
    [Platform("Win")]
    public class WsTelemetryPublisherTests
    {
        private FakeWsConnectionSink _sink;
        private WsTelemetryPublisher _publisher;

        [SetUp]
        public void Setup()
        {
            _sink = new FakeWsConnectionSink();
            _publisher = new WsTelemetryPublisher(_sink);
        }

        /// <summary>
        /// Test that on client connect, a snapshot is sent immediately.
        /// </summary>
        [Test]
        public void OnConnectSendsSnapshot()
        {
            var conn = _sink.AddFakeConnection();
            var dict = new Dictionary<string, object> { { "key1", 42 } };

            _publisher.Tick(dict);

            // Snapshot is queued but not sent until Tick is called after connect
            // Let's verify the snapshot was marked for sending by checking client state
            Assert.AreEqual(1, conn.SentMessages.Count, "Should have sent 1 message on Tick after connect");
            Assert.AreEqual(FakeWsConnection.MessageType.Snapshot, conn.SentMessages[0].Type);
        }

        /// <summary>
        /// Test that no delta is sent when telemetry hasn't changed.
        /// </summary>
        [Test]
        public void NoChangeNoMessage()
        {
            var conn = _sink.AddFakeConnection();
            var dict = new Dictionary<string, object> { { "key1", 42 } };

            // First tick: send snapshot
            _publisher.Tick(dict);
            Assert.AreEqual(1, conn.SentMessages.Count);

            // Second tick with same data: no message
            conn.SentMessages.Clear();
            _publisher.Tick(dict);
            Assert.AreEqual(0, conn.SentMessages.Count, "No message should be sent when data hasn't changed");
        }

        /// <summary>
        /// Test that a delta is sent when telemetry changes.
        /// </summary>
        [Test]
        public void ChangeSendsDelta()
        {
            var conn = _sink.AddFakeConnection();
            var dict1 = new Dictionary<string, object> { { "key1", 42 } };
            var dict2 = new Dictionary<string, object> { { "key1", 100 } };

            // First tick: send snapshot
            _publisher.Tick(dict1);
            Assert.AreEqual(1, conn.SentMessages.Count);
            Assert.AreEqual(FakeWsConnection.MessageType.Snapshot, conn.SentMessages[0].Type);

            // Second tick with changed data: send delta
            conn.SentMessages.Clear();
            _publisher.Tick(dict2);
            Assert.AreEqual(1, conn.SentMessages.Count, "Should send delta when key1 changes");
            Assert.AreEqual(FakeWsConnection.MessageType.Delta, conn.SentMessages[0].Type);
        }

        /// <summary>
        /// Test that two clients with different lastSent state remain isolated.
        /// </summary>
        [Test]
        public void MultiClientIsolation()
        {
            var conn1 = _sink.AddFakeConnection();
            var conn2 = _sink.AddFakeConnection();

            var dict1 = new Dictionary<string, object> { { "key1", 42 } };

            // Both clients connect and receive snapshot
            _publisher.Tick(dict1);
            Assert.AreEqual(1, conn1.SentMessages.Count);
            Assert.AreEqual(1, conn2.SentMessages.Count);

            // Simulate conn1 being updated but conn2 being disconnected
            conn1.SentMessages.Clear();
            conn2.SentMessages.Clear();
            _sink.RemoveConnection(conn2.Id);

            var dict2 = new Dictionary<string, object> { { "key1", 100 } };
            _publisher.Tick(dict2);

            // conn1 should have received a delta
            Assert.AreEqual(1, conn1.SentMessages.Count);
            // conn2 should not have received anything (it's disconnected)
            Assert.AreEqual(0, conn2.SentMessages.Count);
        }

        /// <summary>
        /// Test helper for fake WebSocket connections.
        /// </summary>
        private class FakeWsConnection : IWsConnection
        {
            public enum MessageType { Snapshot, Delta, Request, Response, Event }
            public class Message { public MessageType Type { get; set; } public byte[] Data { get; set; } }

            public Guid Id { get; }
            public bool IsOpen { get; set; } = true;
            public List<Message> SentMessages { get; } = new List<Message>();

            public FakeWsConnection(Guid id)
            {
                Id = id;
            }

            public void Send(byte[] data)
            {
                // Peek at the first few bytes to determine message type
                var type = MessageType.Snapshot; // default
                if (data?.Length > 0)
                {
                    // MessagePack fixmap with key "t" as first element
                    // This is a simplified heuristic; real parsing would deserialize fully
                    if (data.Length > 10)
                    {
                        // Check if we can extract "delta" vs "snapshot" from the serialized data
                        var str = System.Text.Encoding.UTF8.GetString(data);
                        if (str.Contains("delta")) type = MessageType.Delta;
                        else if (str.Contains("snapshot")) type = MessageType.Snapshot;
                    }
                }

                SentMessages.Add(new Message { Type = type, Data = data });
            }
        }

        /// <summary>
        /// Fake connection sink for testing.
        /// </summary>
        private class FakeWsConnectionSink : IWsConnectionSink
        {
            private Dictionary<Guid, FakeWsConnection> _connections = new Dictionary<Guid, FakeWsConnection>();
            private Action<IWsConnection> _onConnect;
            private Action<IWsConnection> _onDisconnect;

            public FakeWsConnection AddFakeConnection()
            {
                var conn = new FakeWsConnection(Guid.NewGuid());
                _connections[conn.Id] = conn;
                _onConnect?.Invoke(conn);
                return conn;
            }

            public void RemoveConnection(Guid id)
            {
                if (_connections.TryGetValue(id, out var conn))
                {
                    _connections.Remove(id);
                    _onDisconnect?.Invoke(conn);
                }
            }

            public IWsConnection[] GetConnections()
            {
                return _connections.Values.Cast<IWsConnection>().ToArray();
            }

            public void OnClientConnected(Action<IWsConnection> handler)
            {
                _onConnect = handler;
            }

            public void OnClientDisconnected(Action<IWsConnection> handler)
            {
                _onDisconnect = handler;
            }
        }
    }
}
