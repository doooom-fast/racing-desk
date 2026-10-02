using System;
using System.Collections.Generic;
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
    /// live session shows — and his own entry by his name. The name on disk goes no further than the store. The player flag
    /// of an old team race's grid went to whoever was in his car, so it is believed only for an entry under his own id.
    /// </summary>
    [TestFixture]
    public class GridRouteNamesTests
    {
        private string _dir = "";
        private RacingDeskRuntime? _runtime;
        private int _httpPort;
        private long _sessionId;
        private long _teamSessionId;

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

        private static SessionRecord Old(string dir, string file, long subsession, DateTime at, long driverCustId, string driverName) => new SessionRecord
        {
            Source = "ibt", IbtPath = Path.Combine(dir, file), SessionNum = 0, SubsessionId = subsession, SessionId = 5001,
            EventType = "Race", SessionType = "Race", Official = true, Category = "Road", TrackId = 777, TrackName = "synthetic full",
            TrackDisplayName = "Synthetic Circuit", TrackLengthKm = 4, CarPath = "mx5 mx52016", CarId = 67, CarScreenName = "Mazda MX-5 Cup",
            StartedAtUtc = at, DurationSeconds = 1800,
            DriverCustId = driverCustId, DriverName = driverName, IRating = 1500, License = "A 2.37",
            LapsCompleted = 12, BestLapSeconds = 92.4, FinishPosition = SyntheticField.PlayerPosition, FieldSize = 7,
        };

        [SetUp]
        public void StoreSessionsWithRealLookingNamesAndServeThem()
        {
            Directory.CreateDirectory(_dir = Path.Combine(Path.GetTempPath(), "racing-desk-grid-names-" + Guid.NewGuid().ToString("N")));
            string db = Path.Combine(_dir, "racing-desk.db");
            using (var store = new RacingDeskStore(db))
            {
                // As a store from before the names were replaced holds it: every driver by their own name.
                var session = Old(_dir, "old.ibt", 70010003, new DateTime(2026, 9, 1, 12, 0, 0, DateTimeKind.Utc), SyntheticField.PlayerCustId, SyntheticField.PlayerName);
                session.Grid.Add(new GridEntryRecord { CarIdx = 0, CustId = SyntheticField.PlayerCustId, Name = SyntheticField.PlayerName, IRating = 1500, License = "A 2.37", CarClassId = 74, CarScreenName = "Mazda MX-5 Cup", FinishPosition = SyntheticField.PlayerPosition, IsPlayer = true });
                foreach (var r in SyntheticField.Rivals)
                    session.Grid.Add(new GridEntryRecord { CarIdx = r.CarIdx, CustId = r.CustId, Name = r.Name, IRating = r.IRating, License = "A 2.37", CarClassId = 74, CarScreenName = "Mazda MX-5 Cup", FinishPosition = r.Position, LapsComplete = 12, FastestLapSeconds = 92.4, Incidents = 2, ReasonOut = "Running" });
                // A row with a name and no id (a store from a session that did not say): named by the name, salted.
                session.Grid.Add(new GridEntryRecord { CarIdx = 9, CustId = 0, Name = "Zebedee Quorntalk", IRating = 1200, FinishPosition = 8 });
                _sessionId = store.SaveSession(session);

                // Another of his, so that the store knows which customer id is his.
                var another = Old(_dir, "older.ibt", 70010001, new DateTime(2026, 8, 20, 12, 0, 0, DateTimeKind.Utc), SyntheticField.PlayerCustId, SyntheticField.PlayerName);
                another.Grid.Add(new GridEntryRecord { CarIdx = 0, CustId = SyntheticField.PlayerCustId, Name = SyntheticField.PlayerName, FinishPosition = 1, IsPlayer = true });
                store.SaveSession(another);

                // A team race as the recorder stored it before it told him from his teammates: the entry for his car was whoever
                // was in it at the end — the teammate — so the session is under the teammate's id, and the grid's player flag
                // is on the teammate's entry, under his real name.
                var team = Old(_dir, "team.ibt", 70010007, new DateTime(2026, 9, 10, 12, 0, 0, DateTimeKind.Utc), SyntheticField.TeammateCustId, SyntheticField.TeammateName);
                team.Grid.Add(new GridEntryRecord { CarIdx = 0, CustId = SyntheticField.TeammateCustId, Name = SyntheticField.TeammateName, IRating = 1650, License = "A 2.37", CarClassId = 74, FinishPosition = SyntheticField.PlayerPosition, IsPlayer = true });
                foreach (var r in SyntheticField.Rivals)
                    team.Grid.Add(new GridEntryRecord { CarIdx = r.CarIdx, CustId = r.CustId, Name = r.Name, IRating = r.IRating, License = "A 2.37", CarClassId = 74, FinishPosition = r.Position });
                _teamSessionId = store.SaveSession(team);
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

        private string Get(string path)
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
            using var request = new HttpRequestMessage(HttpMethod.Get, $"http://127.0.0.1:{_httpPort}{path}");
            using var response = http.Send(request);
            string body = new StreamReader(response.Content.ReadAsStream()).ReadToEnd();
            Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK), body);
            return body;
        }

        private JObject Session(long id)
        {
            string body = Get($"/racing-desk/data/session?id={id}");
            SyntheticField.AssertNoRivalIn(body, "the session route");
            Assert.That(body, Does.Not.Contain("Quorntalk"));
            return JObject.Parse(body);
        }

        [Test]
        public void TheRouteNamesTheGridFromTheStoredCustomerIdsAndKeepsHisOwn()
        {
            var json = Session(_sessionId);
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
        public void AnOldTeamRacesPlayerFlagIsOnlyBelievedForHisOwnCustomerId()
        {
            // The flag is on the teammate's entry, under his own real name; the route names him as it names the rivals, and
            // does not send the flag on as if it meant him.
            var json = Session(_teamSessionId);
            var grid = (JArray)json["grid"]!;
            Assert.That(grid, Has.Count.EqualTo(SyntheticField.Rivals.Length + 1), "the six rivals and the teammate");
            Assert.That(grid.Where(g => (int)g["is_player"]! == 1), Is.Empty, "he is not in this grid, and the teammate is not him");
            foreach (var row in grid)
                Assert.That(TestNames.Book.List.ContainsShown((string)row["name"]!), Is.True, (string)row["name"]!);
            Assert.That(grid.Select(g => (string)g["name"]!).Distinct().Count(), Is.EqualTo(grid.Count), "the teammate is a different character from every rival");

            // He is the same character as in a live session of the same field with the teammate in his car.
            var live = TestNames.Book.NewSession().Apply(RacingDesk.Plugin.IRacing.SessionInfoYaml.Parse(SyntheticField.Yaml(teammateDriving: true)));
            string teammateShown = live.DriverInfo.Drivers.Single(d => d.UserID == SyntheticField.TeammateCustId).UserName;
            Assert.That(grid.Single(g => (int)g["car_idx"]! == 0)["name"]!.ToString(), Is.EqualTo(teammateShown), "the character the live session showed");
        }

        [Test]
        public void NoRouteSendsACustomerId()
        {
            string sessions = Get("/racing-desk/data/sessions");
            string session = Get($"/racing-desk/data/session?id={_sessionId}");
            foreach (string body in new[] { sessions, session })
            {
                Assert.That(body, Does.Not.Contain("cust_id"), "no customer id column");
                Assert.That(body, Does.Not.Contain(SyntheticField.PlayerCustId.ToString()));
                Assert.That(body, Does.Not.Contain(SyntheticField.TeammateCustId.ToString()));
                Assert.That(body, Does.Not.Contain(SyntheticField.Rivals[0].CustId.ToString()));
            }
            var row = ((JArray)JObject.Parse(session)["session"]!)[0];
            Assert.That(row["car_path"]!.ToString(), Is.EqualTo("mx5 mx52016"), "the rest of the row is there");
            Assert.That(((JObject)row).Property("driver_cust_id"), Is.Null);
        }

        [Test]
        public void TheStoreKnowsWhichCustomerIdIsHisBecauseMostSessionsAreUnderIt()
        {
            using var store = new RacingDeskStore(Path.Combine(_dir, "racing-desk.db"));
            Assert.That(store.OwnCustomerId(), Is.EqualTo(SyntheticField.PlayerCustId), "two of his, one of his teammate's");
        }

        private static readonly PseudonymList Four = PseudonymizerTests.ListOf("Ann One", "Bo Two", "Cy Three", "Di Four");

        [Test]
        public void AStoredGridIsNamedAsTheLiveSessionNamedItWhateverOrderTheStoreListsIt()
        {
            // Four names and five drivers: first choices clash under most salts, and who gets which depends on the order they
            // are named in. The live session serves its racers in an order of the ids' own; the store lists them by finishing
            // position, or any other way, and names them the same.
            var rows = new[]
            {
                new GridEntryRecord { CarIdx = 3, CustId = 13, Name = "Cee Real", FinishPosition = 1 },
                new GridEntryRecord { CarIdx = 0, CustId = SyntheticField.PlayerCustId, Name = SyntheticField.PlayerName, FinishPosition = 2, IsPlayer = true },
                new GridEntryRecord { CarIdx = 1, CustId = 11, Name = "Ay Real", FinishPosition = 3 },
                new GridEntryRecord { CarIdx = 2, CustId = 12, Name = "Bee Real", FinishPosition = 4 },
                new GridEntryRecord { CarIdx = 4, CustId = 14, Name = "Dee Real", FinishPosition = 5 },
                new GridEntryRecord { CarIdx = 5, CustId = 15, Name = "Eff Real", FinishPosition = 6 },
            };
            for (int seed = 1; seed <= 20; seed++)
            {
                var book = new PseudonymBook(Four, SyntheticField.SaltFromSeed(seed));
                var live = book.NewSession();
                var racers = rows.Where(r => !r.IsPlayer).ToList();
                var liveNames = live.ForMany(racers.Select(r => new KeyValuePair<long, string>(r.CustId, "whoever")).ToList());
                var expected = racers.Select((r, i) => (r.CustId, Name: liveNames[i])).ToDictionary(x => x.CustId, x => x.Name);

                foreach (var order in new[] { rows, rows.Reverse().ToArray(), rows.OrderBy(r => r.CarIdx).ToArray(), rows.OrderByDescending(r => r.CustId).ToArray() })
                {
                    var names = LocalDataApi.GridNames(order, book, SyntheticField.PlayerCustId);
                    for (int i = 0; i < order.Length; i++)
                    {
                        if (order[i].IsPlayer) Assert.That(names[i], Is.Null, "his own entry is not renamed");
                        else Assert.That(names[i], Is.EqualTo(expected[order[i].CustId]), $"salt {seed}, customer {order[i].CustId}");
                    }
                }
            }
        }

        [Test]
        public void AGridStoredSinceTheNamesWereReplacedKeepsTheCharactersItWasGiven()
        {
            var book = TestNames.Book;
            var live = book.NewSession().Apply(RacingDesk.Plugin.IRacing.SessionInfoYaml.Parse(SyntheticField.Yaml()));
            var stored = live.DriverInfo.Drivers.Where(d => d.CarIsPaceCar == 0)
                .Select(d => new GridEntryRecord { CarIdx = d.CarIdx, CustId = d.UserID, Name = d.UserName, IsPlayer = d.CarIdx == SyntheticField.PlayerCarIdx })
                .ToList();
            // As a session that collided would have them: two rivals' characters swapped. The store's word stands.
            var a = stored.Single(g => g.CarIdx == 1);
            var b = stored.Single(g => g.CarIdx == 2);
            (a.Name, b.Name) = (b.Name, a.Name);
            var names = LocalDataApi.GridNames(stored, book, SyntheticField.PlayerCustId);
            for (int i = 0; i < stored.Count; i++)
                if (!stored[i].IsPlayer) Assert.That(names[i], Is.EqualTo(stored[i].Name), $"car {stored[i].CarIdx}");
        }

        [Test]
        public void AFlaggedEntryThatIsNotHimIsNamedLikeTheRestAndOneWithNoIdIsHisOwn()
        {
            var teammate = new GridEntryRecord { CarIdx = 0, CustId = SyntheticField.TeammateCustId, Name = SyntheticField.TeammateName, IsPlayer = true };
            var him = new GridEntryRecord { CarIdx = 0, CustId = SyntheticField.PlayerCustId, Name = SyntheticField.PlayerName, IsPlayer = true };
            var noId = new GridEntryRecord { CarIdx = 0, CustId = 0, Name = SyntheticField.PlayerName, IsPlayer = true };
            var rival = new GridEntryRecord { CarIdx = 1, CustId = SyntheticField.Rivals[0].CustId, Name = SyntheticField.Rivals[0].Name };
            Assert.That(LocalDataApi.IsHim(teammate, SyntheticField.PlayerCustId), Is.False);
            Assert.That(LocalDataApi.IsHim(him, SyntheticField.PlayerCustId), Is.True);
            Assert.That(LocalDataApi.IsHim(noId, SyntheticField.PlayerCustId), Is.True, "an online team race has ids; an entry with none is a drive of his own");
            Assert.That(LocalDataApi.IsHim(him, 0), Is.False, "no id of his is known, so a flagged entry cannot be told from a teammate's: not sent as his");
            Assert.That(LocalDataApi.IsHim(rival, SyntheticField.PlayerCustId), Is.False, "the flag is what says it, too");

            var names = LocalDataApi.GridNames(new[] { teammate, him, noId, rival }, TestNames.Book, SyntheticField.PlayerCustId);
            Assert.That(TestNames.Book.List.ContainsShown(names[0]), Is.True, "the teammate, a character");
            Assert.That(names[1], Is.Null);
            Assert.That(names[2], Is.Null);
            Assert.That(TestNames.Book.List.ContainsShown(names[3]), Is.True);
            Assert.That(names[0], Is.Not.EqualTo(names[3]));
            SyntheticField.AssertNoRivalIn(string.Join("|", names.Where(n => n != null)), "the names");
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
