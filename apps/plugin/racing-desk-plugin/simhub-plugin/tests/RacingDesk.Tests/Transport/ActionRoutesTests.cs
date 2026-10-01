using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Ports;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using RacingDesk.Plugin;
using RacingDesk.Plugin.Engine;
using RacingDesk.Plugin.Engine.Moza;

namespace RacingDesk.Tests.Transport
{
    /// <summary>
    /// The runtime's <c>?action=</c> routes write to the wheel base and the pedals, change the pedal profiles and the
    /// runtime's own state, and several of the reads ask the hardware over serial — and :8889 answers every address, so
    /// that the iPad view can read the telemetry. So they are for a program on this machine and no other, and the check is
    /// made once, before any of them is looked at.
    ///
    /// The list of actions is read from the runtime's own source, not kept here: an action added to it is asked for here
    /// the next run, and fails unless it is behind the check.
    /// </summary>
    [TestFixture]
    public class ActionRoutesTests
    {
        // ── The actions, as the runtime's source has them ────────────

        private const string HttpSource = "apps/core/RacingDesk.Core/Runtime/RacingDeskRuntime.Http.cs";

        private static readonly Regex Compared = new Regex(@"\baction\s*==\s*""([A-Za-z0-9_]+)""");

        private static string ReadRuntimeSource()
        {
            for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir != null; dir = dir.Parent)
            {
                string candidate = Path.Combine(dir.FullName, HttpSource.Replace('/', Path.DirectorySeparatorChar));
                if (File.Exists(candidate)) return File.ReadAllText(candidate);
            }
            // Loud on purpose: a test that finds no actions would pass for none.
            throw new FileNotFoundException($"{HttpSource} was not found above {AppContext.BaseDirectory}: this test reads the runtime's actions from it.");
        }

        /// <summary>Every action the runtime compares the request's action with, by name.</summary>
        public static IEnumerable<string> Actions() =>
            Compared.Matches(ReadRuntimeSource()).Cast<Match>().Select(m => m.Groups[1].Value).Distinct().OrderBy(a => a, StringComparer.Ordinal).ToList();

        [Test]
        public void TheListIsTheRuntimesOwn_AndNothingElseLooksAtTheAction()
        {
            var found = Actions().ToList();

            // The ones that write to the hardware and the pedal profiles are certainly among them.
            Assert.That(found, Is.SupersetOf(new[]
            {
                "resetmap", "listtracks", "restartdemo", "setrect",
                "listPedalProfiles", "setPedalProfile", "bindPedalProfile", "importMozaPedals",
                "listMozaDevices", "getMozaWheelbaseSettings", "setMozaWheelbaseSetting", "getMozaPedalSettings",
                "setMozaPedalSetting", "getMozaHandbrakeSettings", "setMozaHandbrakeSetting", "getMozaShifterSettings",
                "getMozaDashboardSettings", "getMozaWheelSettings", "mozaRefresh", "mozaReconnect", "listSerialPortDiagnostic",
            }));

            // The scan reads `action == "name"`. If the runtime comes to look at the action in another way (a switch, a
            // StartsWith, a table), that route is one this test cannot see — so it says so, rather than pass for fewer.
            // What is inside a string or a character is not code, and neither is a comment.
            string code = Regex.Replace(
                ReadRuntimeSource(), @"'(?:[^'\\\r\n]|\\.)'|""(?:[^""\\\r\n]|\\.)*""", m => m.Value[0] == '\'' ? "''" : "\"\"");
            code = Regex.Replace(code, @"//[^\r\n]*", "");
            var elsewhere = Regex.Matches(code, @"\baction\b(?!\s*==\s*""""|\s*=[^=])").Cast<Match>().Select(m => code.Substring(m.Index, Math.Min(40, code.Length - m.Index)).Split('\n')[0]).ToList();
            Assert.That(elsewhere, Is.Empty, "the runtime looks at `action` in a way this test does not read; teach the test to find those routes");
        }

        // ── A runtime on 127.0.0.1, with the hardware as fakes ───────

        private string _dir = "";
        private RacingDeskRuntime? _runtime;
        private NoPorts _ports = new NoPorts();
        private MozaSerialManager? _moza;
        private PedalProfileManager? _pedals;
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
            _dir = Path.Combine(Path.GetTempPath(), "racing-desk-actions-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(_dir);
            _httpPort = FreePort();
            int wsPort;
            do wsPort = FreePort(); while (wsPort == _httpPort);
            _ports = new NoPorts();
            _runtime = new RacingDeskRuntime(new Settings(), new RacingDeskRuntime.Options
            {
                AssemblyDirectory = _dir,
                PluginsDataDirectory = _dir,
                HttpPort = _httpPort,
                WsPort = wsPort,
                EnableHardware = false,   // the real Moza manager and the real pedal profiles are never made...
                EnableSdkBridge = false,
                LoopbackOnly = true,
            });
            // ...and the ones the routes reach are fakes: a Moza manager that is never started, over no ports (a write is
            // queued and stays queued), and pedal profiles kept in the temp folder, Pit House never looked for.
            _moza = new MozaSerialManager(_ => { }, _ => { }, _ports, () => DateTime.UtcNow, () => new string[0]);
            _pedals = new PedalProfileManager(_dir);
            _pedals.SaveProfile(new PedalProfile { Id = "a", Name = "Profile A" });
            _pedals.SaveProfile(new PedalProfile { Id = "b", Name = "Profile B" });
            _pedals.SetActiveProfile("a");
            _runtime._mozaSerial = _moza;
            _runtime._pedalProfiles = _pedals;
            _runtime.Start();
        }

        [TearDown]
        public void StopRuntime()
        {
            _runtime?.Stop();
            try { Directory.Delete(_dir, true); } catch { }
        }

        private (HttpStatusCode Status, string Body, bool OpenToPages) Ask(string pathAndQuery, Action<HttpRequestMessage>? shape = null)
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
            using var request = new HttpRequestMessage(HttpMethod.Get, $"http://127.0.0.1:{_httpPort}{pathAndQuery}");
            shape?.Invoke(request);
            using var response = http.Send(request);
            return (response.StatusCode, new StreamReader(response.Content.ReadAsStream()).ReadToEnd(), response.Headers.Contains("Access-Control-Allow-Origin"));
        }

        /// <summary>Every parameter any action takes, so that a route that was let through would do what it does.</summary>
        private static string Query(string action) =>
            $"/racing-desk/?action={action}&key=ffbstrength&value=100&id=b&car=mx5&x=0.1&y=0.1&w=0.5&h=0.5&probe=1";

        /// <summary>The ways a request that is not from a program on this machine looks, as far as a request on 127.0.0.1 can look it.</summary>
        public static IEnumerable<TestCaseData> OtherMachines()
        {
            yield return new TestCaseData((Action<HttpRequestMessage>)(r => r.Headers.Host = "192.168.1.20:8889")).SetName("a device on the LAN, by the rig's address");
            yield return new TestCaseData((Action<HttpRequestMessage>)(r => r.Headers.Host = "evil.example:8889")).SetName("a name another site has pointed at the rig");
            yield return new TestCaseData((Action<HttpRequestMessage>)(r => r.Headers.Add("Origin", "http://192.168.1.20:3000"))).SetName("a page in a browser, naming its origin");
            yield return new TestCaseData((Action<HttpRequestMessage>)(r => r.Headers.Add("Origin", "null"))).SetName("a page with an origin of null");
        }

        private void NothingHappened()
        {
            Assert.That(_moza!.PendingWrites, Is.EqualTo(0), "nothing was queued for the hardware");
            Assert.That(_moza.RediscoveryAsked, Is.False, "no rediscovery of the ports was asked for");
            Assert.That(_ports.Touched, Is.Empty, "no serial port was looked at, let alone opened");
            Assert.That(_pedals!.ActiveProfile.Id, Is.EqualTo("a"), "the pedal profile was not changed");
            Assert.That(File.Exists(Path.Combine(_dir, "PedalProfiles", "_bindings.json")), Is.False, "no car was bound to a profile");
        }

        // ── Another machine ──────────────────────────────────────────

        [TestCaseSource(nameof(OtherMachines))]
        public void EveryAction_IsRefusedToAnotherMachine_AndNothingHappens(Action<HttpRequestMessage> looksLike)
        {
            var actions = Actions().ToList();
            Assert.That(actions, Is.Not.Empty);

            foreach (string action in actions)
            {
                var (status, body, openToPages) = Ask(Query(action), looksLike);

                Assert.That(status, Is.EqualTo(HttpStatusCode.Forbidden), action);
                Assert.That(JObject.Parse(body)["error"]!.ToString(), Does.Contain("this machine"), action);
                Assert.That(openToPages, Is.False, $"{action}: a page that is refused is not told in a way it may read");
            }
            NothingHappened();
        }

        [Test]
        public void AnActionNobodyHasHeardOf_IsRefusedToAnotherMachine_AndIsNotAnsweredWithTheTelemetry()
        {
            foreach (string target in new[]
            {
                "/racing-desk/?action=somethingNew",                // a route added tomorrow, below the check
                "/racing-desk/?action=",                             // an action with no name
                "/racing-desk/?x=1&action=resetmap&y=2",             // not the first parameter
                "/racing-desk/?ACTION=resetmap",                     // in capitals: the dispatch is exact, the check is not
                "/racing-desk/?%61ction=resetmap",                   // spelt in percent-encoding
                "/racing-desk/action=resetmap",                      // in the path
                "/racing-desk/data/status?action=setMozaPedalSetting&key=brake.deadzone&value=9",
            })
            {
                var (status, _, _) = Ask(target, r => r.Headers.Host = "192.168.1.20:8889");
                Assert.That(status, Is.EqualTo(HttpStatusCode.Forbidden), target);
            }
            NothingHappened();
        }

        // ── This machine ─────────────────────────────────────────────

        [Test]
        public void EveryAction_StillWorksForAProgramOnThisMachine()
        {
            foreach (string action in Actions())
            {
                var (status, body, _) = Ask(Query(action));
                Assert.That(status, Is.EqualTo(HttpStatusCode.OK), $"{action}: {body}");
            }
        }

        [Test]
        public void AProgramOnThisMachine_DoesWhatTheActionsAreFor()
        {
            Assert.That(Ask("/racing-desk/?action=setMozaWheelbaseSetting&key=ffbStrength&value=50").Status, Is.EqualTo(HttpStatusCode.OK));
            Assert.That(_moza!.PendingWrites, Is.EqualTo(1), "a write is queued for the hardware");

            Assert.That(Ask("/racing-desk/?action=mozaReconnect").Status, Is.EqualTo(HttpStatusCode.OK));
            Assert.That(_moza.RediscoveryAsked, Is.True);

            Assert.That(Ask("/racing-desk/?action=setPedalProfile&id=b").Status, Is.EqualTo(HttpStatusCode.OK));
            Assert.That(_pedals!.ActiveProfile.Id, Is.EqualTo("b"));

            Assert.That(Ask("/racing-desk/?action=bindPedalProfile&id=b&car=mx5").Status, Is.EqualTo(HttpStatusCode.OK));
            Assert.That(File.Exists(Path.Combine(_dir, "PedalProfiles", "_bindings.json")), Is.True);

            var (status, body, _) = Ask("/racing-desk/?action=listPedalProfiles");
            Assert.That(status, Is.EqualTo(HttpStatusCode.OK));
            Assert.That(JArray.Parse(body).Select(p => (string?)p["id"]), Is.EquivalentTo(new[] { "a", "b" }));

            (status, body, _) = Ask("/racing-desk/?action=listMozaDevices");
            Assert.That(status, Is.EqualTo(HttpStatusCode.OK));
            Assert.That(JArray.Parse(body), Is.Empty, "no device is connected to a manager that was never started");
        }

        [Test]
        public void ARequestThatNamesLocalhost_ButHasNoOrigin_IsAProgramOnThisMachine()
        {
            // What the Stream Deck's Node, curl and PowerShell send: Host is the address they were given, and nothing more.
            foreach (string host in new[] { "localhost:" + _httpPort, "127.0.0.1:" + _httpPort })
                Assert.That(Ask("/racing-desk/?action=listMozaDevices", r => r.Headers.Host = host).Status, Is.EqualTo(HttpStatusCode.OK), host);
        }

        // ── What is read, as the iPad view reads it ──────────────────

        [Test]
        public void TheTelemetryIsStillAnsweredToAnyone_WhoAsksForNoAction()
        {
            // The app on the rig asks on the iPad's behalf, from this machine, with no query; the telemetry is read-only, and a
            // page in a browser reads it by CORS as the HUD does. None of these names an action.
            foreach (var (target, looksLike) in new (string, Action<HttpRequestMessage>?)[]
            {
                ("/racing-desk/", null),
                ("/racing-desk/", r => r.Headers.Host = "192.168.1.20:8889"),
                ("/racing-desk/", r => r.Headers.Add("Origin", "null")),
                ("/racing-desk/?", r => r.Headers.Host = "192.168.1.20:8889"),
                ("/racing-desk/?x=1", r => r.Headers.Host = "evil.example"),
            })
            {
                var (status, body, openToPages) = Ask(target, looksLike);

                Assert.That(status, Is.EqualTo(HttpStatusCode.OK), target);
                Assert.That(JObject.Parse(body).ContainsKey("DataCorePlugin.GameRunning"), Is.True, target);
                Assert.That(openToPages, Is.True, "the HUD's own page reads it by CORS");
            }
        }

        /// <summary>Serial ports there are none of; every look at one is written down.</summary>
        private sealed class NoPorts : IMozaPortSystem
        {
            public readonly List<string> Touched = new List<string>();

            public string[] GetPortNames() { Touched.Add("GetPortNames"); return new string[0]; }

            public Dictionary<string, MozaSerialManager.PortWmiInfo> GetPortInfo()
            {
                Touched.Add("GetPortInfo");
                return new Dictionary<string, MozaSerialManager.PortWmiInfo>(StringComparer.OrdinalIgnoreCase);
            }

            public MozaPortAccess CheckAccess(string portName) { Touched.Add("CheckAccess " + portName); return MozaPortAccess.Free; }

            public SerialPort Open(string portName)
            {
                Touched.Add("Open " + portName);
                throw new IOException($"The port '{portName}' does not exist.");
            }
        }
    }
}
