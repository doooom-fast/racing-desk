using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.IO;
using System.IO.Ports;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using RacingDesk.Plugin;
using RacingDesk.Plugin.Engine.Moza;

namespace RacingDesk.Tests.Transport
{
    /// <summary>
    /// <c>?action=listSerialPortDiagnostic</c> opens the machine's serial ports and, when asked to, writes Moza read
    /// commands to the ones nothing describes as Moza. :8889 answers every address (the iPad view needs it), and HTTP.sys
    /// hands a localhost prefix any request that says <c>Host: localhost</c>, wherever it came from — so the route is for a
    /// program on this machine and no other. The ports here are a fake: nothing opens one of the rig's own.
    /// </summary>
    [TestFixture]
    public class SerialDiagnosticRouteTests
    {
        // ── Who may ask ──────────────────────────────────────────────

        [TestCase(true, "localhost:8889", null, true, TestName = "a program on this machine, by name")]
        [TestCase(true, "127.0.0.1:8889", null, true, TestName = "a program on this machine, by its address")]
        [TestCase(true, "[::1]:8889", null, true, TestName = "a program on this machine, over IPv6")]
        [TestCase(true, "LOCALHOST", null, true, TestName = "case and a missing port do not matter")]
        [TestCase(true, "localhost:8889", "", true, TestName = "an empty Origin is no Origin")]
        [TestCase(false, "localhost:8889", null, false, TestName = "a device on the LAN that says Host: localhost")]
        [TestCase(false, "127.0.0.1", null, false, TestName = "a device on the LAN that says Host: 127.0.0.1")]
        [TestCase(true, "localhost:8889", "http://evil.example", false, TestName = "a page in a browser, which names an Origin")]
        [TestCase(true, "localhost:8889", "null", false, TestName = "a page in a browser, with an Origin of null")]
        [TestCase(true, "evil.example:8889", null, false, TestName = "a name another site has pointed at this machine")]
        [TestCase(true, "192.168.1.20:8889", null, false, TestName = "the machine's own LAN address is not localhost")]
        [TestCase(true, "localhost.evil.example", null, false, TestName = "a name that only starts with localhost")]
        [TestCase(true, "127.0.0.1.evil.example:80", null, false, TestName = "a name that only starts with an address")]
        [TestCase(true, "[::1]x", null, false, TestName = "a bracketed address with something after it")]
        [TestCase(true, "[::1", null, false, TestName = "a bracket never closed")]
        [TestCase(true, null, null, false, TestName = "no Host at all")]
        [TestCase(true, "  ", null, false, TestName = "a blank Host")]
        public void OnlyAProgramOnThisMachineMayAsk(bool isLocal, string? host, string? origin, bool allowed)
        {
            var headers = new NameValueCollection();
            if (host != null) headers.Add("Host", host);
            if (origin != null) headers.Add("Origin", origin);
            Assert.That(LocalRequest.IsFromThisMachine(isLocal, headers), Is.EqualTo(allowed));
        }

        // What a browser says of a request that a page's script cannot give one (a link, an image, a form): where it is from
        // and what it is for. Node's own fetch says Sec-Fetch-Mode and nothing else, and is a program.
        [TestCase("Referer", "http://evil.example/page", false, TestName = "an image on a page, which has a Referer")]
        [TestCase("Sec-Fetch-Site", "cross-site", false, TestName = "a link on another site")]
        [TestCase("Sec-Fetch-Site", "none", false, TestName = "an address typed into a browser")]
        [TestCase("Sec-Fetch-Dest", "image", false, TestName = "an image")]
        [TestCase("Sec-Fetch-User", "?1", false, TestName = "a click")]
        [TestCase("Sec-Fetch-Mode", "cors", true, TestName = "Node's own fetch is a program")]
        [TestCase("User-Agent", "curl/8.4.0", true, TestName = "curl is a program")]
        [TestCase("Referer", "", true, TestName = "an empty Referer is none")]
        public void ARequestAPageMadeWithoutAnOriginIsNotAProgram(string header, string value, bool allowed)
        {
            var headers = new NameValueCollection { { "Host", "localhost:8889" }, { header, value } };
            Assert.That(LocalRequest.IsFromThisMachine(true, headers), Is.EqualTo(allowed));
        }

        // ── The route, over a real socket on 127.0.0.1 ───────────────

        private string _dir = "";
        private RacingDeskRuntime? _runtime;
        private FakeSerialPorts _ports = new FakeSerialPorts();
        private int _httpPort;

        private static int FreePort()
        {
            var l = new TcpListener(IPAddress.Loopback, 0);
            l.Start();
            int port = ((IPEndPoint)l.LocalEndpoint).Port;
            l.Stop();
            return port;
        }

        [SetUp]
        public void StartRuntime()
        {
            _dir = Path.Combine(Path.GetTempPath(), "racing-desk-serial-diagnostic-" + Guid.NewGuid().ToString("N"));
            _httpPort = FreePort();
            int wsPort;
            do wsPort = FreePort(); while (wsPort == _httpPort);
            _ports = new FakeSerialPorts();
            _ports.Add("COM6", "Microsoft USB Serial Device (COM6) USB Serial Device");
            _ports.Held.Add("COM6");
            _ports.Add("COM20", "Microsoft USB Serial Device (COM20) USB Serial Device");
            _runtime = new RacingDeskRuntime(new Settings(), new RacingDeskRuntime.Options
            {
                AssemblyDirectory = _dir,
                PluginsDataDirectory = _dir,
                HttpPort = _httpPort,
                WsPort = wsPort,
                EnableHardware = false,   // the real Moza manager is never made...
                EnableSdkBridge = false,
                LoopbackOnly = true,
            });
            // ...and the one the route reaches is made from the fake ports, and never started.
            _runtime._mozaSerial = new MozaSerialManager(_ => { }, _ => { }, _ports, () => DateTime.UtcNow, () => new string[0]);
            _runtime.Start();
        }

        [TearDown]
        public void StopRuntime()
        {
            _runtime?.Stop();
            try { Directory.Delete(_dir, true); } catch { }
        }

        private (HttpStatusCode Status, string Body) Ask(string query, Action<HttpRequestMessage>? shape = null)
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
            using var request = new HttpRequestMessage(HttpMethod.Get, $"http://127.0.0.1:{_httpPort}/racing-desk/?action=listSerialPortDiagnostic{query}");
            shape?.Invoke(request);
            using var response = http.Send(request);
            return (response.StatusCode, new StreamReader(response.Content.ReadAsStream()).ReadToEnd());
        }

        [Test]
        public void AProgramOnThisMachineGetsTheDiagnostic_WithoutTalkingToAnyPort()
        {
            var (status, body) = Ask("");

            Assert.That(status, Is.EqualTo(HttpStatusCode.OK));
            var ports = JObject.Parse(body)["ports"]!;
            Assert.That(ports.Select(p => (string?)p["portName"]), Is.EquivalentTo(new[] { "COM6", "COM20" }));
            Assert.That(ports.Single(p => (string?)p["portName"] == "COM6")["portOpenStatus"]!.ToString(), Is.EqualTo("AccessDenied"));
            Assert.That(_ports.Opens, Is.EqualTo(new[] { "COM20" }), "the held port was not opened, and the free one only to see that it can be");
        }

        [Test]
        public void ItTalksToThePortsOnlyWhenTheQueryAsksForIt()
        {
            _ports.OpenSucceeds = true;

            Ask("&probe=0");
            Assert.That(_ports.Opens, Is.EqualTo(new[] { "COM20" }));

            _ports.Opens.Clear();
            var (status, _) = Ask("&probe=1");

            Assert.That(status, Is.EqualTo(HttpStatusCode.OK));
            Assert.That(_ports.Opens, Is.EqualTo(new[] { "COM20", "COM20" }), "the port is opened again to be talked to");
        }

        [Test]
        public void APageInABrowser_ThatNamesAnOrigin_IsRefused_AndNothingIsOpened()
        {
            _ports.OpenSucceeds = true;

            var (status, body) = Ask("&probe=1", r => r.Headers.Add("Origin", "http://evil.example"));

            Assert.That(status, Is.EqualTo(HttpStatusCode.Forbidden));
            Assert.That(JObject.Parse(body)["error"]!.ToString(), Does.Contain("this machine"));
            Assert.That(_ports.Opens, Is.Empty);
            Assert.That(_ports.Checks, Is.Empty, "not even asked whether a port is held");
        }

        [Test]
        public void ARequestThatNamesAnotherHost_IsRefused_AndNothingIsOpened()
        {
            _ports.OpenSucceeds = true;

            // Reaches the route as a name another site has pointed at this machine would: from here, with another Host.
            var (status, _) = Ask("&probe=1", r => r.Headers.Host = "evil.example");

            Assert.That(status, Is.EqualTo(HttpStatusCode.Forbidden));
            Assert.That(_ports.Opens, Is.Empty);
            Assert.That(_ports.Checks, Is.Empty);
        }

        /// <summary>Stands in for the machine's serial ports: Open throws, or gives back a port that was never opened.</summary>
        private sealed class FakeSerialPorts : IMozaPortSystem
        {
            private readonly List<string> _names = new List<string>();
            private readonly Dictionary<string, string> _descriptions = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            public readonly HashSet<string> Held = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            public readonly List<string> Checks = new List<string>();
            public readonly List<string> Opens = new List<string>();
            public bool OpenSucceeds;

            public void Add(string name, string description)
            {
                _names.Add(name);
                _descriptions[name] = description;
            }

            public string[] GetPortNames() => _names.ToArray();

            public Dictionary<string, MozaSerialManager.PortWmiInfo> GetPortInfo() =>
                _descriptions.ToDictionary(
                    kv => kv.Key,
                    kv => new MozaSerialManager.PortWmiInfo { Description = kv.Value },
                    StringComparer.OrdinalIgnoreCase);

            public MozaPortAccess CheckAccess(string portName)
            {
                Checks.Add(portName);
                return Held.Contains(portName) ? MozaPortAccess.Held : MozaPortAccess.Free;
            }

            public SerialPort Open(string portName)
            {
                Opens.Add(portName);
                if (Held.Contains(portName))
                    throw new UnauthorizedAccessException($"Access to the port '{portName}' is denied.");
                if (OpenSucceeds) return new SerialPort(portName);
                throw new IOException($"The port '{portName}' does not exist.");
            }
        }
    }
}
