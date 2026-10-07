using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Threading;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using RacingDesk.Plugin;
using RacingDesk.Plugin.Engine;
using RacingDesk.Plugin.Transport;

namespace RacingDesk.Tests.Transport
{
    /// <summary>
    /// What the runtime builds for its readers, and how often. The telemetry answer on <c>:8889</c> was built again for
    /// every request (the HUD, the iPad view, OBS and the desk each ask), and the WebSocket frame was built and packed
    /// every frame with nobody connected to <c>:8890</c>. Now the answer is built once for each data update and every
    /// request in it is served the same bytes, and the frame is built only while a client is connected.
    /// </summary>
    [TestFixture]
    public class BuiltOncePerUpdateTests
    {
        private string _dir = "";

        [SetUp]
        public void SetUp() => Directory.CreateDirectory(_dir = Path.Combine(Path.GetTempPath(), "racing-desk-once-" + Guid.NewGuid().ToString("N")));

        [TearDown]
        public void TearDown() { try { Directory.Delete(_dir, true); } catch { } }

        private static int FreePort()
        {
            var l = new TcpListener(IPAddress.Loopback, 0);
            l.Start();
            int port = ((IPEndPoint)l.LocalEndpoint).Port;
            l.Stop();
            return port;
        }

        private sealed class NoGame : ITelemetrySource
        {
            public bool GameRunning => false;
            public string GameName => "";
            public object NewData => null!;
            public object GetPropertyValue(string fullName) => null!;
            public string OpponentName(object opponent) => null!;
        }

        private RacingDeskRuntime NewRuntime(out int httpPort, out int wsPort)
        {
            httpPort = FreePort();
            int ws;
            do ws = FreePort(); while (ws == httpPort);
            wsPort = ws;
            return new RacingDeskRuntime(new Settings(), new RacingDeskRuntime.Options
            {
                AssemblyDirectory = _dir,
                PluginsDataDirectory = _dir,
                HttpPort = httpPort,
                WsPort = wsPort,
                EnableHardware = false,
                EnableSdkBridge = false,
                LoopbackOnly = true,
            });
        }

        [Test]
        public void TheAnswerIsBuiltOnceForEachUpdate_HoweverManyAskInIt()
        {
            var runtime = NewRuntime(out int httpPort, out _);
            // An answer is kept for as long as no update comes, up to this; long here, so a slow machine is not a new update.
            runtime.AnswerMaxAge = TimeSpan.FromMinutes(5);
            var source = new NoGame();
            try
            {
                runtime.Start();
                using var http = new HttpClient();
                string url = $"http://127.0.0.1:{httpPort}/racing-desk/";
                runtime.Tick(source);

                int before = runtime.AnswersBuilt;
                var bodies = Enumerable.Range(0, 12).Select(_ => http.GetByteArrayAsync(url).Result).ToList();
                Assert.That(runtime.AnswersBuilt, Is.EqualTo(before + 1), "twelve requests in one update: one build");
                foreach (var body in bodies) Assert.That(body, Is.EqualTo(bodies[0]));
                var json = JObject.Parse(System.Text.Encoding.UTF8.GetString(bodies[0]));
                Assert.That(json.Count, Is.GreaterThan(100), "the whole answer");
                Assert.That(json.ContainsKey("DataCorePlugin.GameRunning"), Is.True);

                // The next update: built again, once, for the first request in it.
                runtime.Tick(source);
                runtime.Tick(source);
                var next = Enumerable.Range(0, 5).Select(_ => http.GetByteArrayAsync(url).Result).ToList();
                Assert.That(runtime.AnswersBuilt, Is.EqualTo(before + 2));
                Assert.That(next[0].Length, Is.EqualTo(bodies[0].Length).Within(64), "the same buffer, the answer of now");

                // With no update for longer than an answer is kept, the next request builds it again.
                runtime.AnswerMaxAge = TimeSpan.Zero;
                http.GetByteArrayAsync(url).Wait();
                Assert.That(runtime.AnswersBuilt, Is.EqualTo(before + 3));
            }
            finally
            {
                runtime.Stop();
            }
        }

        [Test]
        public void NoWebSocketFrameIsBuiltOrPackedWithNobodyConnected()
        {
            var runtime = NewRuntime(out _, out int wsPort);
            var source = new NoGame();
            try
            {
                runtime.Start();
                for (int i = 0; i < 30; i++) runtime.Tick(source);
                Assert.That(runtime._wsPublisher, Is.Not.Null, "the :8890 feed is up");
                Assert.That(runtime.WsFramesBuilt, Is.EqualTo(0));
                Assert.That(runtime._wsPublisher!.Packed, Is.EqualTo(0));

                // A client connects: frames are built and sent to it.
                using var client = new ClientWebSocket();
                client.ConnectAsync(new Uri($"ws://127.0.0.1:{wsPort}/racing-desk"), CancellationToken.None).Wait(TimeSpan.FromSeconds(10));
                for (int i = 0; i < 200 && !runtime._wsPublisher.HasClients; i++) Thread.Sleep(10);
                Assert.That(runtime._wsPublisher.HasClients, Is.True);
                runtime.Tick(source);
                Assert.That(runtime.WsFramesBuilt, Is.EqualTo(1));
                Assert.That(runtime._wsPublisher.Packed, Is.EqualTo(1), "the client's first frame");
            }
            finally
            {
                runtime.Stop();
            }
        }

        private sealed class Conn : IWsConnection
        {
            public Guid Id { get; } = Guid.NewGuid();
            public bool IsOpen => true;
            public int Sent;
            public byte[]? Last;
            public void Send(byte[] data) { Sent++; Last = data; }
        }

        private sealed class Sink : IWsConnectionSink
        {
            private Action<IWsConnection>? _on, _off;
            public readonly List<Conn> Conns = new List<Conn>();
            public Conn Connect() { var c = new Conn(); Conns.Add(c); _on?.Invoke(c); return c; }
            public void Disconnect(Conn c) { Conns.Remove(c); _off?.Invoke(c); }
            public IWsConnection[] GetConnections() => Conns.ToArray<IWsConnection>();
            public void OnClientConnected(Action<IWsConnection> handler) => _on = handler;
            public void OnClientDisconnected(Action<IWsConnection> handler) => _off = handler;
        }

        [Test]
        public void ThePublisherPacksNothingForNobody_AndOneSnapshotForEveryoneDueOne()
        {
            var now = new DateTime(2026, 10, 7, 12, 0, 0, DateTimeKind.Utc);
            var sink = new Sink();
            var publisher = new WsTelemetryPublisher(sink, () => now);
            var frame = new Dictionary<string, object> { ["a"] = 1, ["b"] = "x" };

            for (int i = 0; i < 10; i++) publisher.Tick(frame);
            Assert.That(publisher.HasClients, Is.False);
            Assert.That(publisher.Packed, Is.EqualTo(0), "no client, no packing");

            var one = sink.Connect();
            var two = sink.Connect();
            Assert.That(publisher.HasClients, Is.True);
            publisher.Tick(frame);
            Assert.That((one.Sent, two.Sent), Is.EqualTo((1, 1)), "each client's first frame");
            int packed = publisher.Packed;

            // Nothing changed and no snapshot due: nothing packed.
            now = now.AddSeconds(2);
            publisher.Tick(frame);
            Assert.That(publisher.Packed, Is.EqualTo(packed));

            // A snapshot due to both: packed once, the same bytes to each.
            now = now.AddSeconds(4);
            publisher.Tick(frame);
            Assert.That(publisher.Packed, Is.EqualTo(packed + 1));
            Assert.That((one.Sent, two.Sent), Is.EqualTo((2, 2)));
            Assert.That(one.Last, Is.SameAs(two.Last));

            // Both gone: nothing packed again.
            sink.Disconnect(one);
            sink.Disconnect(two);
            Assert.That(publisher.HasClients, Is.False);
            now = now.AddSeconds(10);
            publisher.Tick(new Dictionary<string, object> { ["a"] = 2 });
            Assert.That(publisher.Packed, Is.EqualTo(packed + 1));
        }
    }
}
