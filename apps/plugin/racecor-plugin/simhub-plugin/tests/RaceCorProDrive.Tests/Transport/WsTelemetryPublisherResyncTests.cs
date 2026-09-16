using System;
using System.Collections.Generic;
using NUnit.Framework;
using RaceCorProDrive.Plugin.Transport;

namespace RaceCorProDrive.Tests.Transport
{
    // Skipped on non-Windows: WsTelemetryPublisher.OnClientConnected logs via
    // SimHub.Logging.dll, a Windows-only assembly that can't be loaded on the
    // ubuntu-latest CI runner. Tests run on Windows installs.
    [TestFixture]
    [Platform("Win")]
    public class WsTelemetryPublisherResyncTests
    {
        private FakeWsConnectionSink _sink;
        private DateTime _fakeNow;

        [SetUp]
        public void Setup()
        {
            _sink = new FakeWsConnectionSink();
            _fakeNow = DateTime.UtcNow;
        }

        /// <summary>
        /// Test that after 5+ seconds without a snapshot, the next tick sends a full snapshot (resync).
        /// </summary>
        [Test]
        public void ResyncAfter5Seconds()
        {
            var clock = new FakeClock { Now = _fakeNow };
            var publisher = new WsTelemetryPublisher(_sink, () => clock.Now);
            var conn = _sink.AddFakeConnection();

            var dict1 = new Dictionary<string, object> { { "key1", 42 } };

            // Tick 1: snapshot
            clock.Now = _fakeNow;
            publisher.Tick(dict1);
            Assert.AreEqual(1, conn.SentMessages.Count);
            Assert.AreEqual(FakeWsConnection.MessageType.Snapshot, conn.SentMessages[0].Type);

            // Tick 2 (0.1s later): delta (no change in data)
            conn.SentMessages.Clear();
            clock.Now = _fakeNow.AddSeconds(0.1);
            publisher.Tick(dict1);
            Assert.AreEqual(0, conn.SentMessages.Count, "No message for unchanged data at 0.1s");

            // Tick 3 (5.1s later): snapshot (resync)
            conn.SentMessages.Clear();
            clock.Now = _fakeNow.AddSeconds(5.1);
            publisher.Tick(dict1);
            Assert.AreEqual(1, conn.SentMessages.Count, "Should resync with snapshot at 5.1s");
            Assert.AreEqual(FakeWsConnection.MessageType.Snapshot, conn.SentMessages[0].Type);
        }

        /// <summary>
        /// Test that lastFullSent timestamp is updated after a snapshot.
        /// </summary>
        [Test]
        public void LastFullSentUpdated()
        {
            var clock = new FakeClock { Now = _fakeNow };
            var publisher = new WsTelemetryPublisher(_sink, () => clock.Now);
            var conn = _sink.AddFakeConnection();

            var dict = new Dictionary<string, object> { { "key1", 42 } };

            // Initial snapshot
            clock.Now = _fakeNow;
            publisher.Tick(dict);
            clock.Now = _fakeNow.AddSeconds(3);
            publisher.Tick(dict);
            // No change, so still within 5 second window
            clock.Now = _fakeNow.AddSeconds(6);
            publisher.Tick(dict);
            // Now we should see a resync
            Assert.AreEqual(1, conn.SentMessages.Count);
        }

        /// <summary>
        /// Test that deltas resume after a resync snapshot.
        /// </summary>
        [Test]
        public void DeltasResumeAfterResync()
        {
            var clock = new FakeClock { Now = _fakeNow };
            var publisher = new WsTelemetryPublisher(_sink, () => clock.Now);
            var conn = _sink.AddFakeConnection();

            var dict1 = new Dictionary<string, object> { { "key1", 42 } };
            var dict2 = new Dictionary<string, object> { { "key1", 100 } };

            // Tick 1: snapshot
            clock.Now = _fakeNow;
            publisher.Tick(dict1);
            Assert.AreEqual(FakeWsConnection.MessageType.Snapshot, conn.SentMessages[0].Type);

            // Tick 2 (5.1s later): resync snapshot
            conn.SentMessages.Clear();
            clock.Now = _fakeNow.AddSeconds(5.1);
            publisher.Tick(dict1);
            Assert.AreEqual(FakeWsConnection.MessageType.Snapshot, conn.SentMessages[0].Type);

            // Tick 3 (5.2s): delta (data changed)
            conn.SentMessages.Clear();
            clock.Now = _fakeNow.AddSeconds(5.2);
            publisher.Tick(dict2);
            Assert.AreEqual(1, conn.SentMessages.Count);
            Assert.AreEqual(FakeWsConnection.MessageType.Delta, conn.SentMessages[0].Type);
        }

        /// <summary>
        /// Fake clock for testing time-dependent behavior.
        /// </summary>
        private class FakeClock
        {
            public DateTime Now { get; set; }
        }

        /// <summary>
        /// Fake connection.
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
                var type = MessageType.Snapshot;
                if (data?.Length > 0)
                {
                    var str = System.Text.Encoding.UTF8.GetString(data);
                    if (str.Contains("delta")) type = MessageType.Delta;
                    else if (str.Contains("snapshot")) type = MessageType.Snapshot;
                }
                SentMessages.Add(new Message { Type = type, Data = data });
            }
        }

        /// <summary>
        /// Fake connection sink.
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
                return new List<IWsConnection>(_connections.Values).ToArray();
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
