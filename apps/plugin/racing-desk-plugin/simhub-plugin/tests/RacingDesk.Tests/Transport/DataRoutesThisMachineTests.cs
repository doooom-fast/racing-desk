using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using RacingDesk.Core.Screens;
using RacingDesk.Data;
using RacingDesk.Host;
using RacingDesk.Plugin;

namespace RacingDesk.Tests.Transport
{
    /// <summary>
    /// The host's data reads (<c>/racing-desk/data/…</c>) are for programs on this machine. :8889 answers every address, and
    /// the sessions carry the driver's customer id and the status the store's path, so a read is answered only to a request
    /// from a loopback connection whose Host names this machine at this port and that no browser sent. A page says an
    /// Origin, and so does the app's own (a file says <c>null</c>, as does a web site's page that is redirected, sandboxed or
    /// opened from disk: the host cannot tell them apart), and a browser's other requests (an image, a no-cors fetch, a link)
    /// carry <c>Sec-Fetch-*</c>; so no page reads the host, and nothing is sent a CORS header. The desk asks the app's main
    /// process, which asks as a program does. Anything else is a 403 with no CORS header.
    ///
    /// The list of routes is the host's own (<see cref="LocalDataApi.Routes"/>), and a test reads the dispatch's source to
    /// see that it is complete: a route added to the dispatch and not to the list fails there, and a route on the list is
    /// asked of every kind of asker here, over a real socket on 127.0.0.1 (HTTP.sys). The customer id in the store is
    /// 424242, which is not a real one.
    /// </summary>
    [TestFixture]
    public class DataRoutesThisMachineTests
    {
        private const string CustomerId = "424242";
        private const string DataSource = "apps/host/RacingDesk.Host/LocalDataApi.cs";

        // ── The routes, as the host has them ─────────────────────────

        public static IEnumerable<string> RouteNames() => LocalDataApi.Routes;

        /// <summary>What a route is asked with so that it answers rather than says what it wants.</summary>
        private static string Target(string route)
        {
            switch (route)
            {
                case "session": return "session?id=1";
                case "outline": return "outline?track=777";
                default: return route;
            }
        }

        private static string ReadSource()
        {
            for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir != null; dir = dir.Parent)
            {
                string candidate = Path.Combine(dir.FullName, DataSource.Replace('/', Path.DirectorySeparatorChar));
                if (File.Exists(candidate)) return File.ReadAllText(candidate);
            }
            // Loud on purpose: a test that finds no routes would pass for none.
            throw new FileNotFoundException($"{DataSource} was not found above {AppContext.BaseDirectory}: this test reads the routes from it.");
        }

        [Test]
        public void TheListOfRoutes_IsTheDispatchsOwn_SoAnotherRouteIsAskedForHereTheNextRun()
        {
            // The dispatch compares `route == "name"` and has a `case "name":` for each of the store's. A route added in
            // either is a route the check below was not asked of, unless it is on the list: the list is what is asked.
            string code = Regex.Replace(ReadSource(), @"//[^\r\n]*", "");
            var found = Regex.Matches(code, @"\broute\s*==\s*""([A-Za-z0-9_]+)""|\bcase\s+""([A-Za-z0-9_]+)""\s*:")
                .Cast<Match>().Select(m => m.Groups[1].Success ? m.Groups[1].Value : m.Groups[2].Value).Distinct().OrderBy(n => n, StringComparer.Ordinal).ToList();

            Assert.That(found, Is.Not.Empty, "the dispatch was not read");
            Assert.That(LocalDataApi.Routes.OrderBy(n => n, StringComparer.Ordinal), Is.EqualTo(found),
                "every route the dispatch has is on LocalDataApi.Routes, and nothing is on it that the dispatch has not");
            Assert.That(LocalDataApi.Routes, Is.Unique);

            // The ones that carry something the driver would not hand to a stranger are certainly among them.
            Assert.That(found, Is.SupersetOf(new[]
            {
                "status", "sessions", "session", "schedule", "cars", "views", "pedals", "controls", "simwindow", "monitors", "outline", "replay",
            }));
        }

        // ── A runtime on 127.0.0.1, with the host's data API over a store that has a session in it ──

        private string _dir = "";
        private RacingDeskRuntime? _runtime;
        private int _httpPort;
        private Action<Log.Level, string>? _previousSink;
        private readonly List<string> _logged = new List<string>();

        private string Db => Path.Combine(_dir, "racing-desk.db");

        private static int FreePort()
        {
            var l = new TcpListener(IPAddress.Loopback, 0);
            l.Start();
            int port = ((IPEndPoint)l.LocalEndpoint).Port;
            l.Stop();
            return port;
        }

        private sealed class NoWindow : ISimWindowSource
        {
            public SimWindowInfo Find() => null!;
        }

        private sealed class NoMonitors : IMonitorSource
        {
            public IReadOnlyList<MonitorInfo> List() => new List<MonitorInfo>();
        }

        [SetUp]
        public void StartRuntime()
        {
            _dir = Path.Combine(Path.GetTempPath(), "racing-desk-data-local-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(_dir);
            using (var store = new RacingDeskStore(Db))
            {
                var session = new SessionRecord
                {
                    Source = "live", SessionNum = 0, SubsessionId = 0, StartedAtUtc = new DateTime(2026, 6, 1, 9, 0, 0, DateTimeKind.Utc), SessionType = "Race",
                    CarPath = "mx5 mx52016", CarScreenName = "Mazda MX-5 Cup", DriverCustId = long.Parse(CustomerId),
                };
                session.Cars.Add(new CarRecord { CarPath = "mx5 mx52016", Name = "Mazda MX-5 Cup" });
                store.SaveSession(session);
            }
            SqliteConnection.ClearAllPools();

            _httpPort = FreePort();
            int wsPort;
            do wsPort = FreePort(); while (wsPort == _httpPort);
            _logged.Clear();
            _previousSink = Log.Sink;
            Log.Sink = (level, message) => { lock (_logged) _logged.Add(message); };
            var api = new LocalDataApi(Db, Path.Combine(_dir, "not-installed.db")) { SimWindows = new NoWindow(), Monitors = new NoMonitors() };
            _runtime = new RacingDeskRuntime(new Settings(), new RacingDeskRuntime.Options
            {
                AssemblyDirectory = _dir,
                PluginsDataDirectory = _dir,
                HttpPort = _httpPort,
                WsPort = wsPort,
                EnableHardware = false,
                EnableSdkBridge = false,
                LoopbackOnly = true,
                ExtraRoutes = api.TryHandle,
            });
            _runtime.Start();
            Assert.That(_runtime.HttpListening, Is.True);
        }

        [TearDown]
        public void StopRuntime()
        {
            _runtime?.Stop();
            Log.Sink = _previousSink!;
            SqliteConnection.ClearAllPools();
            try { Directory.Delete(_dir, true); } catch { }
        }

        private sealed class Answer
        {
            public HttpStatusCode Status;
            public string Body = "";
            public List<string> HeaderNames = new List<string>();
            public Dictionary<string, string> Headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

            public bool HasCors => HeaderNames.Any(n => n.StartsWith("Access-Control-", StringComparison.OrdinalIgnoreCase));
            public string? Header(string name) => Headers.TryGetValue(name, out var v) ? v : null;
        }

        private Answer Ask(string method, string pathAndQuery, Action<HttpRequestMessage>? shape = null)
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
            using var request = new HttpRequestMessage(new HttpMethod(method), $"http://127.0.0.1:{_httpPort}{pathAndQuery}");
            if (method == "POST" || method == "PUT") request.Content = new StringContent("{}", Encoding.UTF8, "application/json");
            shape?.Invoke(request);
            using var response = http.Send(request);
            var answer = new Answer { Status = response.StatusCode, Body = new StreamReader(response.Content.ReadAsStream()).ReadToEnd() };
            foreach (var h in response.Headers.Concat(response.Content.Headers))
            {
                answer.HeaderNames.Add(h.Key);
                answer.Headers[h.Key] = string.Join(", ", h.Value);
            }
            return answer;
        }

        private string DataUrl(string route) => "/racing-desk/data/" + Target(route);

        // ── Who is refused ───────────────────────────────────────────

        /// <summary>
        /// What a request that is not the app's looks like, as far as a request on 127.0.0.1 can look it: the connection's own
        /// address cannot be changed from here (the unit cases at the end of this file do that), so it is the Host and the Origin.
        /// </summary>
        private (string Name, Action<HttpRequestMessage> Shape)[] Strangers() => new (string, Action<HttpRequestMessage>)[]
        {
            ("a device on the LAN, by the rig's address", r => r.Headers.Host = "192.168.1.20:" + _httpPort),
            ("a name another site has pointed at the rig", r => r.Headers.Host = "evil.example:" + _httpPort),
            ("a name another site has pointed at the rig, with no port", r => r.Headers.Host = "evil.example"),
            ("this machine, at a port that is not this one", r => r.Headers.Host = "localhost:" + (_httpPort + 1)),
            ("this machine, with no port at all", r => r.Headers.Host = "localhost"),
            ("a web site's page, which names its origin", r => r.Headers.Add("Origin", "https://evil.example")),
            ("a page of a site on the rig itself, which is another origin", r => r.Headers.Add("Origin", "http://localhost:3000")),
            ("a page served by the host's own port", r => r.Headers.Add("Origin", $"http://127.0.0.1:{_httpPort}")),
            ("a page of a site on the LAN", r => r.Headers.Add("Origin", "http://192.168.1.20:3000")),
            ("a page whose origin is null, and another's after it", r => { r.Headers.Add("Origin", "null"); r.Headers.Add("Origin", "https://evil.example"); }),
            ("a page that says its origin in capitals", r => r.Headers.Add("Origin", "Null")),
            // null is what the app's own page says, and what a web site's page says once its fetch has been redirected here (the
            // browser taints it), when it is in a sandboxed frame, or when it is a file opened from disk: no page of the three is told apart.
            ("the app's own page (a file), or a web site's page by a redirect or a sandboxed frame: origin null", r => r.Headers.Add("Origin", "null")),
            ("the app's own page as Chromium sends it", DesksPage),
            // What a browser sends without an Origin: an image, a script, a no-cors fetch, a link, a form.
            ("a no-cors fetch or a script of a web site", r => r.Headers.TryAddWithoutValidation("Sec-Fetch-Site", "cross-site")),
            ("an image of a web site", r => { r.Headers.TryAddWithoutValidation("Sec-Fetch-Site", "cross-site"); r.Headers.TryAddWithoutValidation("Sec-Fetch-Dest", "image"); }),
            ("a link or a form of a web site", r => { r.Headers.TryAddWithoutValidation("Sec-Fetch-Site", "cross-site"); r.Headers.TryAddWithoutValidation("Sec-Fetch-User", "?1"); }),
            ("a page that says where it came from, and no more", r => r.Headers.TryAddWithoutValidation("Referer", "https://evil.example/page")),
        };

        [TestCaseSource(nameof(RouteNames))]
        public void ARoute_IsRefusedToALanHost_AnotherName_AndAWebSite_ReadAndWriteAlike_AndSaysNothingOfWhatItHolds(string route)
        {
            foreach (var (name, looksLike) in Strangers())
                foreach (string method in new[] { "GET", "POST" })
                {
                    var answer = Ask(method, DataUrl(route), looksLike);

                    Assert.That(answer.Status, Is.EqualTo(HttpStatusCode.Forbidden), $"{method} {route}, from {name}: {answer.Body}");
                    Assert.That(JObject.Parse(answer.Body)["error"]!.ToString(), Does.Contain("this machine"), $"{method} {route}, from {name}");
                    Assert.That(answer.HasCors, Is.False, $"{method} {route}, from {name}: a page that is refused is not told in a way it may read ({string.Join(", ", answer.HeaderNames)})");
                    Assert.That(answer.Body, Does.Not.Contain(CustomerId).And.Not.Contain(_dir).And.Not.Contain("racing-desk.db"), $"{method} {route}, from {name}");
                }
        }

        [Test]
        public void ARouteNobodyHasHeardOf_IsRefusedToo_NotAnswered404_AndSoIsTheCaseItWasAskedIn()
        {
            foreach (string target in new[]
            {
                "/racing-desk/data/somethingNew",       // a route added tomorrow, below the check
                "/racing-desk/data/",                    // no route
                "/racing-desk/data/status/",             // a slash after it
                "/racing-desk/DATA/Sessions",            // in capitals: the claim is not case-sensitive, so neither is the check
                "/racing-desk/data/sessions?since=2020-01-01&x=1",
                "/racing-desk/data/session?id=1",
            })
                foreach (var (name, looksLike) in Strangers())
                {
                    var answer = Ask("GET", target, looksLike);
                    Assert.That(answer.Status, Is.EqualTo(HttpStatusCode.Forbidden), $"{target}, from {name}");
                    Assert.That(answer.Body, Does.Not.Contain(CustomerId), $"{target}, from {name}");
                }

            // To this machine the same address is the route's own 404, so the 403 above was the check and not the route.
            Assert.That(Ask("GET", "/racing-desk/data/somethingNew").Status, Is.EqualTo(HttpStatusCode.NotFound));
        }

        [Test]
        public void TheCustomerIdAndTheStoresPath_AreNotInAnythingARefusedRequestGets()
        {
            // The two routes the issue was about, as the stranger the check is for asks them.
            var sessions = Ask("GET", "/racing-desk/data/sessions", r => r.Headers.Host = "192.168.1.20:" + _httpPort);
            var status = Ask("GET", "/racing-desk/data/status", r => r.Headers.Add("Origin", "https://evil.example"));
            foreach (var answer in new[] { sessions, status })
                Assert.That(answer.Body, Does.Not.Contain(CustomerId).And.Not.Contain(Path.GetTempPath()).And.Not.Contain("racing-desk.db"));

            // And to this machine, they are there: the refusals above are not an empty store. (The sessions carry no customer
            // id at all now, his own or a teammate's: nothing reads it, and the session's row is the car and the result.)
            var mine = Ask("GET", "/racing-desk/data/sessions").Body;
            Assert.That(mine, Does.Contain("mx5 mx52016").And.Not.Contain(CustomerId));
            Assert.That(Ask("GET", "/racing-desk/data/status").Body, Does.Contain("racing-desk.db"));
        }

        // ── Who is answered ──────────────────────────────────────────

        /// <summary>What each route says to this machine in a store with one session in it and no outlines; the replay says the sim is not there.</summary>
        private static HttpStatusCode Expected(string route) => route == "outline" ? HttpStatusCode.NotFound : HttpStatusCode.OK;

        [TestCaseSource(nameof(RouteNames))]
        public void ARoute_IsAnsweredToAProgramOnThisMachine_ByEveryNameItHas_WithNoCorsHeader_AndSendsOneToNobody(string route)
        {
            // (Not [::1]: HTTP.sys turns that Host away itself on a listener that is bound to 127.0.0.1, before the host is asked;
            // the rule's own cases at the end of this file have it.)
            foreach (string host in new[] { "127.0.0.1:" + _httpPort, "localhost:" + _httpPort, "LOCALHOST:" + _httpPort })
            {
                var answer = Ask("GET", DataUrl(route), r => r.Headers.Host = host);

                Assert.That(answer.Status, Is.EqualTo(Expected(route)), $"{route} by {host}: {answer.Body}");
                Assert.That(answer.HasCors, Is.False, $"{route} by {host}: a program is sent no CORS header, and the wildcard is not sent to anyone");
            }
        }

        [TestCaseSource(nameof(RouteNames))]
        public void ARoute_IsRefusedToTheAppsOwnPage_TooAndSaysNothingItMayRead(string route)
        {
            // The desk's page: a file, which says Origin: null. It is refused as every page is, because the host cannot tell it from a
            // web site's page that says the same; the desk asks the app's main process instead (the readers test, below).
            var answer = Ask("GET", DataUrl(route), DesksPage);

            Assert.That(answer.Status, Is.EqualTo(HttpStatusCode.Forbidden), $"{route}: {answer.Body}");
            Assert.That(answer.HasCors, Is.False, $"{route}: nothing is sent a CORS header, not even the origin null ({string.Join(", ", answer.HeaderNames)})");
            Assert.That(answer.Body, Does.Not.Contain(CustomerId).And.Not.Contain("racing-desk.db"), route);
        }

        /// <summary>Chromium's own request, from a page that is a file to a host on this machine, as the desk's <c>fetch(…, { cache: 'no-store' })</c> was: refused now, for the desk does not ask this way any more.</summary>
        private void DesksPage(HttpRequestMessage r)
        {
            r.Headers.Host = "localhost:" + _httpPort;
            r.Headers.Add("Origin", "null");
            r.Headers.TryAddWithoutValidation("Sec-Fetch-Site", "cross-site");
            r.Headers.TryAddWithoutValidation("Sec-Fetch-Mode", "cors");
            r.Headers.TryAddWithoutValidation("Sec-Fetch-Dest", "empty");
            r.Headers.TryAddWithoutValidation("Cache-Control", "no-cache");
            r.Headers.TryAddWithoutValidation("Pragma", "no-cache");
            r.Headers.TryAddWithoutValidation("Accept", "*/*");
        }

        [Test]
        public void TheReadersOfTheApp_AllGetTheirAnswers()
        {
            // The desk (status, sessions, schedule and one session) asks the app's main process (desk:read, modules/js/desk-reads.js),
            // which asks by Node's http.get: a Host and nothing more. The page is not the asker, so no CORS answer is needed or sent.
            foreach (string route in new[] { "status", "sessions", "schedule", "session?id=1" })
            {
                var answer = Ask("GET", "/racing-desk/data/" + route, r => r.Headers.Host = "localhost:" + _httpPort);
                Assert.That(answer.Status, Is.EqualTo(HttpStatusCode.OK), route);
                Assert.That(answer.HasCors, Is.False, route);
            }

            // The app's main process, the rest of it: Node's fetch (Host and Sec-Fetch-Mode, and no Origin) for the replay, the car names, the sim's
            // window and the monitors, the rig's reads and probes (http.get: a Host and nothing more), and the SimHub plugin's
            // outlines (HttpClient on 127.0.0.1, in OutlineRouteTests, which runs through the runtime with this check).
            foreach (string route in new[] { "status", "sessions", "schedule", "session?id=1", "cars", "views", "pedals", "controls", "simwindow", "monitors", "replay", "brakeforce", "wheelmax" })
            {
                var viaFetch = Ask("GET", "/racing-desk/data/" + route, r =>
                {
                    r.Headers.Host = "localhost:" + _httpPort;
                    r.Headers.TryAddWithoutValidation("Sec-Fetch-Mode", "cors");
                });
                Assert.That(viaFetch.Status, Is.EqualTo(HttpStatusCode.OK), "Node's fetch: " + route);

                var viaHttpGet = Ask("GET", "/racing-desk/data/" + route, r => r.Headers.Host = "localhost:" + _httpPort);
                Assert.That(viaHttpGet.Status, Is.EqualTo(HttpStatusCode.OK), "Node's http.get: " + route);
            }

            // The app's one write, by Node, as rig-api.js sends it: the host's own check of it is the one RigTests has.
            var bind = Ask("POST", "/racing-desk/data/pedals", r => r.Headers.Host = "localhost:" + _httpPort);
            Assert.That(bind.Status, Is.Not.EqualTo(HttpStatusCode.Forbidden), "a program's write reaches the route: " + bind.Body);
        }

        // ── Preflight ────────────────────────────────────────────────

        private static void Preflight(HttpRequestMessage r, string origin)
        {
            r.Headers.Add("Origin", origin);
            r.Headers.TryAddWithoutValidation("Access-Control-Request-Method", "GET");
            r.Headers.TryAddWithoutValidation("Access-Control-Request-Private-Network", "true");
        }

        [TestCaseSource(nameof(RouteNames))]
        public void APreflight_IsRefusedToEveryPage_AndIsNotAnsweredWithTheWildcard(string route)
        {
            // The app's own page (origin null) and a web site's, from this machine's own Host and from the strangers': 403, and nothing
            // that tells a page it may ask — not the runtime's `*` that the telemetry's preflight is answered with.
            foreach (string origin in new[] { "null", "https://evil.example", "http://localhost:3000" })
            {
                var own = Ask("OPTIONS", DataUrl(route), r => { r.Headers.Host = "localhost:" + _httpPort; Preflight(r, origin); });
                Assert.That(own.Status, Is.EqualTo(HttpStatusCode.Forbidden), $"{route}, from {origin}");
                Assert.That(own.HasCors, Is.False, $"{route}, from {origin}: {string.Join(", ", own.HeaderNames)}");
            }

            foreach (var (name, looksLike) in Strangers())
            {
                var theirs = Ask("OPTIONS", DataUrl(route), r => { Preflight(r, "https://evil.example"); looksLike(r); });
                Assert.That(theirs.Status, Is.EqualTo(HttpStatusCode.Forbidden), $"{route}, {name}");
                Assert.That(theirs.HasCors, Is.False, $"{route}, {name}");
            }

            // Not even a preflight with no Origin (no program sends one): a preflight is a browser's.
            var bare = Ask("OPTIONS", DataUrl(route), r => r.Headers.Host = "localhost:" + _httpPort);
            Assert.That(bare.Status, Is.EqualTo(HttpStatusCode.Forbidden), route);
            Assert.That(bare.HasCors, Is.False, route);
        }

        [Test]
        public void ThePreflightOfTheTelemetry_IsTheRuntimesOwn_AsItWas()
        {
            // The telemetry (GET /racing-desk/ with no action) is read-only and the iPad's path; not part of this change.
            var telemetry = Ask("OPTIONS", "/racing-desk/", r => Preflight(r, "https://some.page.example"));
            Assert.That(telemetry.Status, Is.EqualTo(HttpStatusCode.NoContent));
            Assert.That(telemetry.Header("Access-Control-Allow-Origin"), Is.EqualTo("*"));
            Assert.That(Ask("GET", "/racing-desk/", r => r.Headers.Host = "192.168.1.20:" + _httpPort).Status, Is.EqualTo(HttpStatusCode.OK));
        }

        // ── What the log says ────────────────────────────────────────

        private List<string> Refusals(string route)
        {
            lock (_logged) return _logged.Where(l => l.Contains($"data/{route} refused")).ToList();
        }

        [Test]
        public void TheLog_WritesOneLineForEachRoute_AndKindOfAsker_AndNothingTheAskerSaid()
        {
            foreach (string route in LocalDataApi.Routes)
                for (int i = 0; i < 3; i++)
                {
                    Ask("GET", DataUrl(route), r => r.Headers.Host = "192.168.1.20:" + _httpPort);               // another host
                    Ask("GET", DataUrl(route), r => r.Headers.Add("Origin", "https://evil.example"));            // a web site
                    Ask("GET", DataUrl(route), r => r.Headers.Add("Origin", "null"));                            // the app's page, or a web site's that says null: the same kind
                    Ask("GET", DataUrl(route), r => r.Headers.TryAddWithoutValidation("Sec-Fetch-Dest", "image")); // a browser, with no Origin
                }

            foreach (string route in LocalDataApi.Routes)
            {
                var lines = Refusals(route);
                Assert.That(lines.Count, Is.EqualTo(3), $"{route}: a line for each kind of asker, and one: " + string.Join(" | ", lines));
                Assert.That(lines.Count(l => l.Contains("another machine") || l.Contains("host other than")), Is.EqualTo(1), route);
                Assert.That(lines.Count(l => l.Contains("names an origin")), Is.EqualTo(1), route);
                Assert.That(lines.Count(l => l.Contains("a browser sent it")), Is.EqualTo(1), route);
            }
            lock (_logged)
                Assert.That(_logged.Where(l => l.Contains("refused")), Has.None.Contains("evil.example").And.None.Contains("192.168."), "what the asker said is not written down");
        }

        [Test]
        public void TheLog_GivesMadeUpNamesOneNameBetweenThem_SoADeviceOnTheNetworkCannotFillIt()
        {
            for (int i = 0; i < 200; i++)
                Assert.That(Ask("GET", $"/racing-desk/data/madeUp{i}", r => r.Headers.Host = "192.168.1.20:" + _httpPort).Status, Is.EqualTo(HttpStatusCode.Forbidden));

            lock (_logged)
                Assert.That(_logged.Count(l => l.Contains("data/") && l.Contains("refused")), Is.EqualTo(1), "one line for all of them");
            lock (_logged)
                Assert.That(_logged.Single(l => l.Contains("refused")), Does.Not.Contain("madeUp"));
        }

        [Test]
        public void TheLog_HasTheReplayAndPedalsRefusalsOfAPageToo()
        {
            // The two routes that were stricter are behind the same check now, and a page's request to them is written down like the rest.
            Ask("GET", "/racing-desk/data/replay", r => { r.Headers.Host = "localhost:" + _httpPort; r.Headers.Add("Origin", "null"); });
            Ask("GET", "/racing-desk/data/replay", r => { r.Headers.Host = "localhost:" + _httpPort; r.Headers.Add("Origin", "null"); });
            Ask("POST", "/racing-desk/data/pedals", r => { r.Headers.Host = "localhost:" + _httpPort; r.Headers.Add("Origin", "null"); });
            Ask("POST", "/racing-desk/data/pedals", r => { r.Headers.Host = "localhost:" + _httpPort; r.Headers.TryAddWithoutValidation("Referer", "https://evil.example/"); });

            Assert.That(Refusals("replay").Count, Is.EqualTo(1));
            Assert.That(Refusals("pedals").Count, Is.EqualTo(2), "an Origin and a Referer alone are two kinds of asker");
            Assert.That(Refusals("replay")[0], Does.Contain("names an origin"));
        }

        // ── The rule itself, where the connection can be made not to be this machine's ──

        private static NameValueCollection Headers(string? host, string? origin, params (string Name, string Value)[] more)
        {
            var h = new NameValueCollection();
            if (host != null) h.Add("Host", host);
            if (origin != null) h.Add("Origin", origin);
            foreach (var (name, value) in more) h.Add(name, value);
            return h;
        }

        [TestCase(true, "localhost:8889", null, 8889, "None", TestName = "a program by the name localhost")]
        [TestCase(true, "127.0.0.1:18889", null, 18889, "None", TestName = "a program by 127.0.0.1, at the port beside SimHub")]
        [TestCase(true, "[::1]:8889", null, 8889, "None", TestName = "a program by the IPv6 loopback")]
        [TestCase(true, "LocalHost:8889", "", 8889, "None", TestName = "an empty Origin is no Origin")]
        [TestCase(true, "localhost:8889", "null", 8889, "AWebSite", TestName = "the app's own page, a file: no page reads the host, for a web site's can say null too")]
        [TestCase(false, "localhost:8889", null, 8889, "AnotherMachine", TestName = "a device on the network that says Host: localhost")]
        [TestCase(false, "192.168.1.20:8889", "https://evil.example", 8889, "AnotherMachine", TestName = "a device on the network, by the rig's address")]
        [TestCase(true, "192.168.1.20:8889", null, 8889, "AnotherHost", TestName = "the rig's own address on the network")]
        [TestCase(true, "evil.example:8889", null, 8889, "AnotherHost", TestName = "a name another site has pointed at the rig")]
        [TestCase(true, "localhost:8890", null, 8889, "AnotherHost", TestName = "this machine at another port")]
        [TestCase(true, "localhost", null, 8889, "AnotherHost", TestName = "this machine with no port")]
        [TestCase(true, "localhost:", null, 8889, "AnotherHost", TestName = "an empty port")]
        [TestCase(true, "localhost:8889:1", null, 8889, "AnotherHost", TestName = "a port that is not one")]
        [TestCase(true, "localhost:+8889", null, 8889, "AnotherHost", TestName = "a port with a sign")]
        [TestCase(true, "localhost.:8889", null, 8889, "AnotherHost", TestName = "a name that only looks like localhost")]
        [TestCase(true, "[::1", null, 8889, "AnotherHost", TestName = "an address that is not closed")]
        [TestCase(true, null, null, 8889, "AnotherHost", TestName = "no Host")]
        [TestCase(true, "localhost:8889", null, 0, "AnotherHost", TestName = "a connection with no port to compare")]
        [TestCase(true, "localhost:8889", "https://evil.example", 8889, "AWebSite", TestName = "a web site's page")]
        [TestCase(true, "localhost:8889", "http://localhost:3000", 8889, "AWebSite", TestName = "a page of another site on the rig")]
        [TestCase(true, "localhost:8889", "Null", 8889, "AWebSite", TestName = "Null is not null")]
        [TestCase(true, "localhost:8889", "null, https://evil.example", 8889, "AWebSite", TestName = "two origins, one of them null")]
        [TestCase(false, "evil.example", "https://evil.example", 8889, "AnotherMachine", TestName = "everything wrong: the connection is the first thing said")]
        [TestCase(true, "evil.example:8889", "https://evil.example", 8889, "AnotherHost", TestName = "the host is said before the origin")]
        public void TheRule(bool isLocal, string? host, string? origin, int port, string expected)
        {
            Assert.That(LocalRequest.RefusalOfRead(isLocal, Headers(host, origin), port).ToString(), Is.EqualTo(expected));
        }

        [TestCase("Sec-Fetch-Site", "cross-site", TestName = "a no-cors fetch, a script or an image of a web site")]
        [TestCase("Sec-Fetch-Site", "same-origin", TestName = "a request that says it is of the same origin")]
        [TestCase("Sec-Fetch-Dest", "image", TestName = "an image")]
        [TestCase("Sec-Fetch-Dest", "document", TestName = "a navigation")]
        [TestCase("Sec-Fetch-User", "?1", TestName = "a link a person clicked")]
        [TestCase("Referer", "https://evil.example/page", TestName = "a request that says the page it was made from")]
        public void TheRule_RefusesWhatABrowserSent_EvenWithNoOrigin(string header, string value)
        {
            Assert.That(LocalRequest.RefusalOfRead(true, Headers("localhost:8889", null, (header, value)), 8889), Is.EqualTo(LocalRequest.Refusal.ABrowser));
            // The browser's marks are said after the connection and the host, as the origin is.
            Assert.That(LocalRequest.RefusalOfRead(false, Headers("localhost:8889", null, (header, value)), 8889), Is.EqualTo(LocalRequest.Refusal.AnotherMachine));
            Assert.That(LocalRequest.RefusalOfRead(true, Headers("evil.example:8889", null, (header, value)), 8889), Is.EqualTo(LocalRequest.Refusal.AnotherHost));
            Assert.That(LocalRequest.RefusalOfRead(true, Headers("localhost:8889", "https://evil.example", (header, value)), 8889), Is.EqualTo(LocalRequest.Refusal.AWebSite));
        }

        [Test]
        public void TheRule_AnswersWhatNodeSends_AndNothingMoreThanThat()
        {
            // Node's fetch says Sec-Fetch-Mode and no more; http.get says a Host; the plugin's HttpClient a Host and a user agent.
            Assert.That(LocalRequest.RefusalOfRead(true, Headers("localhost:8889", null, ("Sec-Fetch-Mode", "cors")), 8889), Is.EqualTo(LocalRequest.Refusal.None));
            Assert.That(LocalRequest.RefusalOfRead(true, Headers("127.0.0.1:8889", null, ("User-Agent", "node"), ("Accept", "application/json")), 8889), Is.EqualTo(LocalRequest.Refusal.None));
        }

        [Test]
        public void TheRule_RefusesWhatIsNotThere()
        {
            Assert.That(LocalRequest.RefusalOfRead(null), Is.EqualTo(LocalRequest.Refusal.AnotherMachine));
            Assert.That(LocalRequest.RefusalOfRead(true, null!, 8889), Is.EqualTo(LocalRequest.Refusal.AnotherMachine));
        }

        [Test]
        public void TheHostParsing_ThatTheActionRoutesUse_IsAsItWas()
        {
            // NamesThisMachine is the check the ?action= routes make; the read's rule was made out of its parts.
            foreach (string host in new[] { "localhost", "localhost:8889", "127.0.0.1", "127.0.0.1:1", "[::1]", "[::1]:8889", " localhost:8889 ", "LOCALHOST" })
                Assert.That(LocalRequest.NamesThisMachine(host), Is.True, host);
            foreach (string host in new[] { null!, "", " ", "evil.example", "evil.example:8889", "192.168.1.20", "localhost.evil.example", "[::1]x", "[::1", "::1" })
                Assert.That(LocalRequest.NamesThisMachine(host), Is.False, host ?? "(none)");
        }
    }
}
