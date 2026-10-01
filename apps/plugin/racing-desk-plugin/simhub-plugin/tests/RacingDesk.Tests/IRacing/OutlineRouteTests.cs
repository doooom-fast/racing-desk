using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using NUnit.Framework;
using RacingDesk.Data;
using RacingDesk.Host;

namespace RacingDesk.Tests.IRacing
{
    /// <summary>The host's outline route: what the SimHub plugin's map asks, answered from the store or the session being driven.</summary>
    [TestFixture]
    public class OutlineRouteTests
    {
        private static readonly DateTime March = new DateTime(2026, 3, 1, 9, 0, 0, DateTimeKind.Utc);
        private string _dir;

        [SetUp]
        public void SetUp() => Directory.CreateDirectory(_dir = Path.Combine(Path.GetTempPath(), "racing-desk-outline-" + Guid.NewGuid().ToString("N")));

        [TearDown]
        public void TearDown()
        {
            SqliteConnection.ClearAllPools();
            try { Directory.Delete(_dir, true); } catch { }
        }

        private string Db => Path.Combine(_dir, "racing-desk.db");

        private static int FreePort()
        {
            var l = new TcpListener(IPAddress.Loopback, 0);
            l.Start();
            int port = ((IPEndPoint)l.LocalEndpoint).Port;
            l.Stop();
            return port;
        }

        private static (HttpStatusCode Status, string Body) Get(LocalDataApi api, string route)
        {
            int port = FreePort();
            using var listener = new HttpListener();
            listener.Prefixes.Add($"http://127.0.0.1:{port}/racing-desk/");
            listener.Start();
            var claimed = Task.Run(() => api.TryHandle(listener.GetContext()));
            using var http = new HttpClient();
            using var response = http.GetAsync($"http://127.0.0.1:{port}/racing-desk/data/{route}").Result;
            string body = response.Content.ReadAsStringAsync().Result;
            Assert.That(claimed.Result, Is.True);
            return (response.StatusCode, body);
        }

        [Test]
        public void ServesTheStoresOutlineByTrackIdAnd404BeforeThereIsOneAnd400WithoutAnId()
        {
            var outlines = new TrackOutlines(Db);
            var api = new LocalDataApi(Db) { Outlines = outlines };

            Assert.That(Get(api, "outline").Status, Is.EqualTo(HttpStatusCode.BadRequest));
            Assert.That(Get(api, "outline?track=algarve").Status, Is.EqualTo(HttpStatusCode.BadRequest));
            var (status, body) = Get(api, "outline?track=777");
            Assert.That(status, Is.EqualTo(HttpStatusCode.NotFound), "no store yet, and that is no outline yet");
            Assert.That(body, Is.EqualTo("{\"error\":\"no outline yet\"}"));

            string path = SyntheticLaps.Write(Path.Combine(_dir, "laps.ibt"), SyntheticLaps.Yaml(), SyntheticLaps.Laps(2), March);
            using (var store = new RacingDeskStore(Db)) store.MergeGeometry(IbtIngest.IngestGeometryOnly(path, 777));
            SqliteConnection.ClearAllPools();
            outlines.Forget(777);

            (status, body) = Get(api, "outline?track=777");
            Assert.That(status, Is.EqualTo(HttpStatusCode.OK));
            using var json = JsonDocument.Parse(body);
            var root = json.RootElement;
            Assert.That(root.GetProperty("trackId").GetInt32(), Is.EqualTo(777));
            Assert.That(root.GetProperty("cleanLaps").GetInt32(), Is.EqualTo(2));
            Assert.That(root.GetProperty("provisional").GetBoolean(), Is.False);
            Assert.That(root.GetProperty("lengthM").GetDouble(), Is.EqualTo(SyntheticLaps.CircuitLength()).Within(20));
            Assert.That(root.GetProperty("officialLengthM").GetDouble(), Is.EqualTo(SyntheticLaps.OfficialMeters));
            Assert.That(root.GetProperty("updatedAt").GetString(), Does.EndWith("Z"));
            var points = root.GetProperty("points");
            Assert.That(points.GetArrayLength(), Is.EqualTo(1000));
            Assert.That(points[0].GetArrayLength(), Is.EqualTo(3));
            Assert.That(points[0][2].GetDouble(), Is.Zero);
            Assert.That(points[500][2].GetDouble(), Is.EqualTo(0.5));
            // z is south: the circuit runs clockwise from the line at its top, so a quarter of the way round it is east and south.
            Assert.That(points[250][0].GetDouble(), Is.GreaterThan(100));
            Assert.That(points[250][1].GetDouble(), Is.GreaterThan(100));
            Assert.That(body, Does.Not.Contain("900001").And.Not.Contain("Test Driver").And.Not.Contain(".ibt"), "nothing of the file or the driver in it");

            // The plugin's source reads exactly this.
            var parsed = RacingDesk.Plugin.Engine.HostOutlineSource.Parse(body);
            Assert.That((parsed.TrackId, parsed.CleanLaps, parsed.Points.Count), Is.EqualTo((777, 2, 1000)));
            Assert.That(Get(api, "outline?track=778").Status, Is.EqualTo(HttpStatusCode.NotFound));
        }

        // ── The address the plugin asks, and the addresses the host answers on ──

        // HTTP.sys matches a prefix that names a host ("localhost") against the Host header of the request, and answers
        // 400 itself to a request for any other name. The host, run by the app and not elevated, can only bind the
        // loopback prefixes, so the plugin's address has to be one of them. These tests are on 127.0.0.1 alone, never on
        // a prefix that names a host (HTTP.sys would bind that one on every address).

        private static string AskedHost()
        {
            var url = new Uri(new RacingDesk.Plugin.Settings().HostUrl);
            Assert.That(new RacingDesk.Plugin.Settings().HostUrl, Is.EqualTo(RacingDesk.Plugin.Engine.HostOutlineSource.DefaultHostUrl));
            return url.Host;
        }

        [Test]
        public void EveryPrefixTheHostMayBindAnswersTheAddressTheSimHubPluginAsks()
        {
            string asked = AskedHost();
            Assert.That(asked, Is.EqualTo("127.0.0.1"));
            var groups = RacingDesk.Plugin.RacingDeskRuntime.HttpPrefixGroups(18889);
            Assert.That(groups.Length, Is.GreaterThanOrEqualTo(2));
            // The groups are tried in order, each alone, until one binds: all but the last resort answer the plugin.
            foreach (var group in groups.Take(groups.Length - 1))
            {
                bool wildcard = group.Any(p => p.StartsWith("http://*:") || p.StartsWith("http://+:"));
                bool names = group.Any(p => !p.Contains("//*") && !p.Contains("//+") && new Uri(p).Host == asked);
                Assert.That(wildcard || names, Is.True,
                    $"the prefixes [{string.Join(", ", group)}] are what the host binds when the ones before them are refused, and a request for {asked} would be answered 400 by HTTP.sys");
            }
            // The last resort, should the address not be given to the user at all, keeps the overlay's own (localhost) working.
            Assert.That(groups.Last(), Is.EqualTo(new[] { "http://localhost:18889/racing-desk/" }));
            // The host's route is under the prefix every group names.
            Assert.That(groups.SelectMany(g => g).All(p => p.EndsWith(":18889/racing-desk/")), Is.True);
        }

        [Test]
        public void TheOutlineIsServedToThePluginsSourceOnThePrefixTheHostBindsForTheAddress()
        {
            var outlines = new TrackOutlines(Db);
            string path = SyntheticLaps.Write(Path.Combine(_dir, "laps.ibt"), SyntheticLaps.Yaml(), SyntheticLaps.Laps(2), March);
            using (var store = new RacingDeskStore(Db)) store.MergeGeometry(IbtIngest.IngestGeometryOnly(path, 777));
            SqliteConnection.ClearAllPools();
            var api = new LocalDataApi(Db) { Outlines = outlines };

            int port = FreePort();
            // The runtime's own prefix for the address the plugin asks, on a port of the test's.
            string prefix = RacingDesk.Plugin.RacingDeskRuntime.HttpPrefixGroups(port)
                .SelectMany(g => g).Distinct().Single(p => p.StartsWith($"http://{AskedHost()}:"));
            using var listener = new HttpListener();
            listener.Prefixes.Add(prefix);
            listener.Start();
            var serving = Task.Run(() => { while (listener.IsListening) { try { api.TryHandle(listener.GetContext()); } catch { break; } } });
            try
            {
                using var source = new RacingDesk.Plugin.Engine.HostOutlineSource($"http://{AskedHost()}:{port}");
                var outline = source.Get(777);
                Assert.That(outline, Is.Not.Null, "the host answers the plugin's source");
                Assert.That((outline.TrackId, outline.CleanLaps, outline.Points.Count), Is.EqualTo((777, 2, 1000)));
                Assert.That(source.Get(778), Is.Null, "and says none yet for a layout it has none for");
            }
            finally
            {
                listener.Stop();
                serving.Wait(TimeSpan.FromSeconds(5));
            }
        }

        [Test]
        public void TheHostUrlIsNeverSavedSoAnOldAddressIsNotKept()
        {
            string saved = Newtonsoft.Json.JsonConvert.SerializeObject(new RacingDesk.Plugin.Settings());
            Assert.That(saved, Does.Not.Contain("HostUrl"));
            var loaded = Newtonsoft.Json.JsonConvert.DeserializeObject<RacingDesk.Plugin.Settings>("{\"HostUrl\":\"http://localhost:1\",\"DemoMode\":true}");
            Assert.That(loaded.DemoMode, Is.True, "the rest of the settings are read");
            Assert.That(loaded.HostUrl, Is.EqualTo(RacingDesk.Plugin.Engine.HostOutlineSource.DefaultHostUrl), "an address kept by an earlier build is not used");
        }
    }
}
