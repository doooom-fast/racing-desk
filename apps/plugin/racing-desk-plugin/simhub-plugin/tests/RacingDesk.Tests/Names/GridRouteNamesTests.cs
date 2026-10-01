using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using Microsoft.Data.Sqlite;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using RacingDesk.Core.Names;
using RacingDesk.Core.Screens;
using RacingDesk.Data;
using RacingDesk.Host;
using RacingDesk.Plugin;

namespace RacingDesk.Tests.Names
{
    /// <summary>
    /// The store and its route: a session stored before other drivers were renamed has their names on disk, and
    /// <c>GET /racing-desk/data/session?id=</c> names each entry by the customer id the store kept — the same character the
    /// live session shows — and his own entry by his name. The name on disk goes no further than the store.
    /// </summary>
    [TestFixture]
    public class GridRouteNamesTests
    {
        private string _dir = "";
        private RacingDeskRuntime? _runtime;
        private int _httpPort;
        private long _sessionId;

        private sealed class NoWindow : ISimWindowSource { public SimWindowInfo Find() => null!; }
        private sealed class NoMonitors : IMonitorSource { public System.Collections.Generic.IReadOnlyList<MonitorInfo> List() => new System.Collections.Generic.List<MonitorInfo>(); }

        private static int FreePort()
        {
            var l = new TcpListener(IPAddress.Loopback, 0);
            l.Start();
            int port = ((IPEndPoint)l.LocalEndpoint).Port;
            l.Stop();
            return port;
        }

        [SetUp]
        public void StoreASessionWithRealLookingNamesAndServeIt()
        {
            Directory.CreateDirectory(_dir = Path.Combine(Path.GetTempPath(), "racing-desk-grid-names-" + Guid.NewGuid().ToString("N")));
            string db = Path.Combine(_dir, "racing-desk.db");
            using (var store = new RacingDeskStore(db))
            {
                // As a store from before the names were replaced holds it: every driver by their own name.
                var session = new SessionRecord
                {
                    Source = "ibt", IbtPath = Path.Combine(_dir, "old.ibt"), SessionNum = 0, SubsessionId = 70010003, SessionId = 5001,
                    EventType = "Race", SessionType = "Race", Official = true, Category = "Road", TrackId = 777, TrackName = "synthetic full",
                    TrackDisplayName = "Synthetic Circuit", TrackLengthKm = 4, CarPath = "mx5 mx52016", CarId = 67, CarScreenName = "Mazda MX-5 Cup",
                    StartedAtUtc = new DateTime(2026, 9, 1, 12, 0, 0, DateTimeKind.Utc), DurationSeconds = 1800,
                    DriverCustId = SyntheticField.PlayerCustId, DriverName = SyntheticField.PlayerName, IRating = 1500, License = "A 2.37",
                    LapsCompleted = 12, BestLapSeconds = 92.4, FinishPosition = SyntheticField.PlayerPosition, FieldSize = 7,
                };
                session.Grid.Add(new GridEntryRecord { CarIdx = 0, CustId = SyntheticField.PlayerCustId, Name = SyntheticField.PlayerName, IRating = 1500, License = "A 2.37", CarClassId = 74, CarScreenName = "Mazda MX-5 Cup", FinishPosition = SyntheticField.PlayerPosition, IsPlayer = true });
                foreach (var r in SyntheticField.Rivals)
                    session.Grid.Add(new GridEntryRecord { CarIdx = r.CarIdx, CustId = r.CustId, Name = r.Name, IRating = r.IRating, License = "A 2.37", CarClassId = 74, CarScreenName = "Mazda MX-5 Cup", FinishPosition = r.Position, LapsComplete = 12, FastestLapSeconds = 92.4, Incidents = 2, ReasonOut = "Running" });
                // A row with a name and no id (a store from a session that did not say): named by the name, salted.
                session.Grid.Add(new GridEntryRecord { CarIdx = 9, CustId = 0, Name = "Zebedee Quorntalk", IRating = 1200, FinishPosition = 8 });
                _sessionId = store.SaveSession(session);
            }
            SqliteConnection.ClearAllPools();

            _httpPort = FreePort();
            int wsPort;
            do wsPort = FreePort(); while (wsPort == _httpPort);
            var api = new LocalDataApi(db, Path.Combine(_dir, "not-installed.db")) { SimWindows = new NoWindow(), Monitors = new NoMonitors() };
            _runtime = new RacingDeskRuntime(new Settings(), new RacingDeskRuntime.Options
            {
                AssemblyDirectory = _dir, PluginsDataDirectory = _dir, HttpPort = _httpPort, WsPort = wsPort,
                EnableHardware = false, EnableSdkBridge = false, LoopbackOnly = true, ExtraRoutes = api.TryHandle,
            });
            _runtime.Start();
        }

        [TearDown]
        public void TearDown()
        {
            _runtime?.Stop();
            SqliteConnection.ClearAllPools();
            try { Directory.Delete(_dir, true); } catch { }
        }

        private JObject Session()
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
            using var request = new HttpRequestMessage(HttpMethod.Get, $"http://127.0.0.1:{_httpPort}/racing-desk/data/session?id={_sessionId}");
            using var response = http.Send(request);
            string body = new StreamReader(response.Content.ReadAsStream()).ReadToEnd();
            Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK), body);
            SyntheticField.AssertNoRivalIn(body, "the session route");
            Assert.That(body, Does.Not.Contain("Quorntalk"));
            return JObject.Parse(body);
        }

        [Test]
        public void TheRouteNamesTheGridFromTheStoredCustomerIdsAndKeepsHisOwn()
        {
            var json = Session();
            var grid = (JArray)json["grid"]!;
            Assert.That(grid, Has.Count.EqualTo(SyntheticField.Rivals.Length + 2));

            var mine = grid.Single(g => (int)g["is_player"]! == 1);
            Assert.That((string)mine["name"]!, Is.EqualTo(SyntheticField.PlayerName));

            var live = TestNames.Book.NewSession().Apply(RacingDesk.Plugin.IRacing.SessionInfoYaml.Parse(SyntheticField.Yaml()));
            foreach (var r in SyntheticField.Rivals)
            {
                var row = grid.Single(g => (int)g["car_idx"]! == r.CarIdx);
                string expected = live.DriverInfo.Drivers.Single(d => d.CarIdx == r.CarIdx).UserName;
                Assert.That((string)row["name"]!, Is.EqualTo(expected), $"car #{r.Number}: the character the live session shows");
                Assert.That((int)row["irating"]!, Is.EqualTo(r.IRating));
                Assert.That((int)row["finish_position"]!, Is.EqualTo(r.Position));
                Assert.That(row["cust_id"], Is.Null, "the customer ids are not sent");
            }
            var nameless = grid.Single(g => (int)g["car_idx"]! == 9);
            Assert.That(TestNames.Book.List.ContainsShown((string)nameless["name"]!), Is.True, "no id: named by the name, still a character");
            Assert.That(grid.Select(g => (string)g["name"]!).Distinct().Count(), Is.EqualTo(grid.Count), "each a different person");

            // The other parts of the answer, as they were.
            Assert.That(json["session"], Is.InstanceOf<JArray>());
            Assert.That(json["laps"], Is.InstanceOf<JArray>());
            Assert.That(json["incidents"], Is.InstanceOf<JArray>());
        }

        [Test]
        public void TheStoreHoldsWhatItWasGivenAndTheReadKeepsTheIds()
        {
            using var store = new RacingDeskStore(Path.Combine(_dir, "racing-desk.db"));
            var grid = store.GridEntries(_sessionId);
            Assert.That(grid, Has.Count.EqualTo(SyntheticField.Rivals.Length + 2));
            foreach (var r in SyntheticField.Rivals)
            {
                var g = grid.Single(x => x.CarIdx == r.CarIdx);
                Assert.That(g.CustId, Is.EqualTo(r.CustId));
                Assert.That(g.Name, Is.EqualTo(r.Name), "what is on disk stays as it is; the route does the naming");
            }
            Assert.That(grid.Single(g => g.IsPlayer).Name, Is.EqualTo(SyntheticField.PlayerName));
        }
    }
}
