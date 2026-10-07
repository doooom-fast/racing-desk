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
using RacingDesk.Host;
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
                "restartdemo",
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
        private Action<Log.Level, string>? _previousSink;
        private readonly List<string> _logged = new List<string>();

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
            // The log, for the lines that say what was refused.
            _logged.Clear();
            _previousSink = Log.Sink;
            Log.Sink = (level, message) => { lock (_logged) _logged.Add(message); };
            _runtime = new RacingDeskRuntime(new Settings(), new RacingDeskRuntime.Options
            {
                AssemblyDirectory = _dir,
                PluginsDataDirectory = _dir,
                HttpPort = _httpPort,
                WsPort = wsPort,
                EnableHardware = false,   // the real Moza manager and the real pedal profiles are never made...
                EnableSdkBridge = false,
                LoopbackOnly = true,
                // The host's own routes, as the host has them: its data API, over a store there is none of. They are what the
                // runtime hands a request to before the actions are looked at, if the check is not made first.
                ExtraRoutes = new LocalDataApi(Path.Combine(_dir, "no-store.db")).TryHandle,
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
            Log.Sink = _previousSink!;
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
        private static readonly (string Name, Action<HttpRequestMessage> Shape)[] OtherMachines =
        {
            ("a device on the LAN, by the rig's address", r => r.Headers.Host = "192.168.1.20:8889"),
            ("a name another site has pointed at the rig", r => r.Headers.Host = "evil.example:8889"),
            ("a page in a browser, naming its origin", r => r.Headers.Add("Origin", "http://192.168.1.20:3000")),
            ("a page with an origin of null", r => r.Headers.Add("Origin", "null")),
            // What a page can do without an Origin, from a link, an image or a form: no script, no header of its own to add,
            // and the browser says what the request is for all the same.
            ("an image on a page, which has a Referer", r => r.Headers.Referrer = new Uri("http://192.168.1.20:3000/page")),
            ("a link on another site", r => r.Headers.Add("Sec-Fetch-Site", "cross-site")),
            ("an image", r => r.Headers.Add("Sec-Fetch-Dest", "image")),
        };

        private void NothingHappened()
        {
            Assert.That(_moza!.PendingWrites, Is.EqualTo(0), "nothing was queued for the hardware");
            Assert.That(_moza.RediscoveryAsked, Is.False, "no rediscovery of the ports was asked for");
            Assert.That(_ports.Touched, Is.Empty, "no serial port was looked at, let alone opened");
            Assert.That(_pedals!.ActiveProfile.Id, Is.EqualTo("a"), "the pedal profile was not changed");
            Assert.That(File.Exists(Path.Combine(_dir, "PedalProfiles", "_bindings.json")), Is.False, "no car was bound to a profile");
        }

        // ── Another machine ──────────────────────────────────────────

        /// <summary>
        /// One case for each action the runtime has, as many as are in its source: an action added there is asked for here
        /// the next run, from every way another machine looks, and fails unless it is behind the check.
        /// </summary>
        [TestCaseSource(nameof(Actions))]
        public void AnAction_IsRefusedToAnotherMachine_AndNothingHappens(string action)
        {
            foreach (var (name, looksLike) in OtherMachines)
            {
                var (status, body, openToPages) = Ask(Query(action), looksLike);

                Assert.That(status, Is.EqualTo(HttpStatusCode.Forbidden), $"{action}, from {name}");
                Assert.That(JObject.Parse(body)["error"]!.ToString(), Does.Contain("this machine"), $"{action}, from {name}");
                Assert.That(openToPages, Is.False, $"{action}, from {name}: a page that is refused is not told in a way it may read");
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
                "/racing-desk/?x=1&action=restartdemo&y=2",          // not the first parameter
                "/racing-desk/?ACTION=restartdemo",                  // in capitals: the dispatch is exact, the check is not
                "/racing-desk/?%61ction=restartdemo",                // spelt in percent-encoding
                "/racing-desk/action=restartdemo",                   // in the path
                "/racing-desk/data/status?action=setMozaPedalSetting&key=brake.deadzone&value=9",
            })
            {
                var (status, _, _) = Ask(target, r => r.Headers.Host = "192.168.1.20:8889");
                Assert.That(status, Is.EqualTo(HttpStatusCode.Forbidden), target);
            }
            NothingHappened();
        }

        /// <summary>
        /// The host's own routes (the data API) are handed a request before the runtime's actions are, unless the check comes
        /// first: a request that names an action must be refused to another machine there too, and not answered with the
        /// store's status, its path and the rest. The data API never reads an action, so nothing is lost by it.
        /// </summary>
        [TestCase("/racing-desk/data/status?action=setMozaPedalSetting&key=brake.deadzone&value=9")]
        [TestCase("/racing-desk/data/controls?action=restartdemo")]
        [TestCase("/racing-desk/data/sessions?x=1&action=mozaReconnect")]
        [TestCase("/racing-desk/data/pedals?ACTION=setPedalProfile&id=b")]
        [TestCase("/racing-desk/data/cars?%61ction=listSerialPortDiagnostic&probe=1")]
        public void ARouteOfTheHost_ThatNamesAnAction_IsRefusedToAnotherMachine_BeforeTheHostSeesIt(string target)
        {
            foreach (var (name, looksLike) in OtherMachines)
            {
                var (status, body, openToPages) = Ask(target, looksLike);

                Assert.That(status, Is.EqualTo(HttpStatusCode.Forbidden), $"{target}, from {name}: {body}");
                Assert.That(JObject.Parse(body)["error"]!.ToString(), Does.Contain("this machine"), $"{target}, from {name}");
                Assert.That(openToPages, Is.False, $"{target}, from {name}: the host's own CORS header was not sent");
            }
            NothingHappened();
        }

        [Test]
        public void TheHostsReads_AreAnsweredToThisMachine_WhoNamesNoAction_AndToThisOne_WhoDoes_AndToNoOtherMachine_NorToAPage()
        {
            // What a program on this machine reads (the desk's reads are the app's main process's): no action in them.
            // The reads have a rule of their own, and every route of them is asked of every kind of asker in DataRoutesThisMachineTests.
            string here = "127.0.0.1:" + _httpPort;
            foreach (var (target, looksLike) in new (string, Action<HttpRequestMessage>?)[]
            {
                ("/racing-desk/data/controls", null),
                ("/racing-desk/data/controls", r => r.Headers.Host = here),
            })
            {
                var (status, body, openToPages) = Ask(target, looksLike);

                Assert.That(status, Is.EqualTo(HttpStatusCode.OK), $"{target}: {body}");
                Assert.That(openToPages, Is.False, "a program is sent no CORS header, and nobody the wildcard");
            }

            // A page, the app's own (a file says Origin: null) included, is refused: the desk asks through the app.
            var (page, pageSaid, openToPage) = Ask("/racing-desk/data/controls", r => r.Headers.Add("Origin", "null"));
            Assert.That(page, Is.EqualTo(HttpStatusCode.Forbidden), pageSaid);
            Assert.That(openToPage, Is.False);

            // Another machine's read is refused before the host looks at the store, whatever it names.
            var (refused, said, openToThem) = Ask("/racing-desk/data/status", r => r.Headers.Host = "192.168.1.20:8889");
            Assert.That(refused, Is.EqualTo(HttpStatusCode.Forbidden));
            Assert.That(said, Does.Contain("this machine").And.Not.Contain("no local store"));
            Assert.That(openToThem, Is.False);

            // A program on this machine that names an action on one of the host's routes is not refused (the host ignores it).
            Assert.That(Ask("/racing-desk/data/controls?action=listMozaDevices").Status, Is.EqualTo(HttpStatusCode.OK));
        }

        // ── What the log says of what was refused ────────────────────

        private List<string> Refusals()
        {
            lock (_logged) return _logged.Where(l => l.Contains("?action=") && l.Contains(" refused")).ToList();
        }

        [Test]
        public void TheLog_KeepsALineForEachAction_WhateverMadeUpNamesWereRefusedBeforeIt()
        {
            // A device on the network makes up names until the budget for them is gone; a line for a name that is made up is
            // no use to anyone, and the ones that are not must not be silenced by them.
            for (int i = 0; i < 200; i++)
                Assert.That(Ask($"/racing-desk/?action=madeUp{i}", r => r.Headers.Host = "192.168.1.20:8889").Status, Is.EqualTo(HttpStatusCode.Forbidden));
            Assert.That(Refusals().Count, Is.EqualTo(RacingDeskRuntime.UnknownActionsLogged), "the made-up names are written down up to the budget, and no more");

            // Every action the runtime has, as its source has them, is asked twice and written down once.
            foreach (string action in Actions())
            {
                Ask(Query(action), r => r.Headers.Host = "192.168.1.20:8889");
                Ask(Query(action), r => r.Headers.Host = "192.168.1.20:8889");
            }
            foreach (string action in Actions())
                Assert.That(Refusals().Count(l => l.Contains($"?action={action} ")), Is.EqualTo(1), $"{action} has a line, and one");
        }

        [Test]
        public void TheLog_WritesAnAppsRefusalOnThisMachine_AsItsOwnLine_AndOnlyOnce()
        {
            // The connection is this machine's, and a browser's marks are on it: an app from before the check, as it sends it.
            Ask("/racing-desk/?action=restartdemo", r => r.Headers.Add("Origin", "null"));
            Ask("/racing-desk/?action=restartdemo", r => r.Headers.Add("Origin", "null"));

            var lines = Refusals();
            Assert.That(lines.Count, Is.EqualTo(1));
            Assert.That(lines[0], Does.Contain("?action=restartdemo refused").And.Contain("this machine's"));
        }

        [Test]
        public void ARefusalIsWrittenOncePerKindOfAsker_AndOnlyTheNamesNobodyHasHeardOfAreCounted()
        {
            var runtime = _runtime!;

            // A device on the network asked for restartdemo first; an app on this machine that asks for it is not left without its line.
            Assert.That(runtime.NoteRefusal("restartdemo", fromThisMachine: false), Is.True);
            Assert.That(runtime.NoteRefusal("restartdemo", fromThisMachine: false), Is.False);
            Assert.That(runtime.NoteRefusal("restartdemo", fromThisMachine: true), Is.True);
            Assert.That(runtime.NoteRefusal("restartdemo", fromThisMachine: true), Is.False);

            int written = 0;
            for (int i = 0; i < 1000; i++)
                if (runtime.NoteRefusal("madeUp" + i, fromThisMachine: false)) written++;
            Assert.That(written, Is.EqualTo(RacingDeskRuntime.UnknownActionsLogged));

            // The budget is spent; a name the runtime has a route for is written all the same, and a made-up one is not.
            Assert.That(runtime.NoteRefusal("mozaReconnect", fromThisMachine: false), Is.True);
            Assert.That(runtime.NoteRefusal("madeUpAfterAll", fromThisMachine: true), Is.False);
        }

        // ── This machine ─────────────────────────────────────────────

        [TestCaseSource(nameof(Actions))]
        public void AnAction_StillWorksForAProgramOnThisMachine(string action)
        {
            var (status, body, _) = Ask(Query(action));
            Assert.That(status, Is.EqualTo(HttpStatusCode.OK), $"{action}: {body}");
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

            // Node's own fetch says Sec-Fetch-Mode and no more of what a browser says: it is a program.
            Assert.That(Ask("/racing-desk/?action=listMozaDevices", r => r.Headers.Add("Sec-Fetch-Mode", "cors")).Status, Is.EqualTo(HttpStatusCode.OK));
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
