using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using NUnit.Framework;
using RacingDesk.Data;
using RacingDesk.Host;
using RacingDesk.Tests.Pedals;

namespace RacingDesk.Tests.IRacing
{
    /// <summary>What the store remembers per car for the rig — the view and the pedals — and how it is served.</summary>
    [TestFixture]
    public class RigTests
    {
        private const string Mx5 = "mx5 mx52016";
        private const string Lotus = "lotus79";

        private static readonly DateTime June = new DateTime(2026, 6, 1, 9, 0, 0, DateTimeKind.Utc);

        private string _dir = "";

        [SetUp]
        public void SetUp() => Directory.CreateDirectory(_dir = Path.Combine(Path.GetTempPath(), "racing-desk-rig-" + Guid.NewGuid().ToString("N")));

        [TearDown]
        public void TearDown()
        {
            SqliteConnection.ClearAllPools();
            try { Directory.Delete(_dir, true); } catch { }
        }

        private string Db => Path.Combine(_dir, "racing-desk.db");
        private string SmartControlDb => Path.Combine(_dir, "Heusinkveld.db");

        private static SessionRecord Session(string source, DateTime startedAt, long subsession, string? ibtPath, string carPath, string carName, params CarRecord[] others)
        {
            var s = new SessionRecord
            {
                Source = source, IbtPath = ibtPath, SessionNum = 0, SubsessionId = subsession, StartedAtUtc = startedAt, SessionType = "Race",
                CarPath = carPath, CarScreenName = carName,
            };
            s.Cars.Add(new CarRecord { CarPath = carPath, Name = carName });
            s.Cars.AddRange(others);
            return s;
        }

        private static readonly CarRecord LotusCar = new CarRecord { CarPath = Lotus, Name = "Lotus 79" };

        /// <summary>A store that knows the two cars by name.</summary>
        private RacingDeskStore StoreWithCars()
        {
            var store = new RacingDeskStore(Db);
            store.SaveSession(Session("live", June, 0, null, Mx5, "Mazda MX-5 Cup", LotusCar));
            return store;
        }

        // ── A store as the build before this one left it ──

        private const string Version4Step = @"
CREATE TABLE cars (
  car_path TEXT PRIMARY KEY, name TEXT NOT NULL, short_name TEXT, car_id INTEGER,
  seen INTEGER NOT NULL DEFAULT 0, first_seen_at TEXT, last_seen_at TEXT
);
CREATE TABLE session_cars (
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  car_path   TEXT NOT NULL,
  PRIMARY KEY (session_id, car_path)
);
CREATE INDEX session_cars_car ON session_cars(car_path);
CREATE INDEX sessions_ibt_path ON sessions(ibt_path);
ALTER TABLE ingested_files ADD COLUMN cars_scanned INTEGER NOT NULL DEFAULT 0;
INSERT INTO schema_version (version) VALUES (4);
";

        [Test]
        public void MigratesAVersion4StoreKeepingItsMarksAndCountingSessionsNotRows()
        {
            using (var old = new CarsTests.Version3Store(Db))
            {
                // One race, stored as it was driven and again from each of the two files it was written to.
                old.Session("live", null, 0, "2026-02-01T10:00:03.000Z", Mx5, 67, "Mazda MX-5 Cup");
                old.Session("ibt", @"C:\telemetry\a.ibt", 0, "2026-02-01T10:00:00.000Z", Mx5, 67, "Mazda MX-5 Cup");
                old.Session("ibt", @"C:\telemetry\b.ibt", 0, "2026-02-01T10:31:00.000Z", Mx5, 67, "Mazda MX-5 Cup");
                old.Run("UPDATE sessions SET subsession_id = 70010001");
                // Another race, and two test drives, which have no subsession to be told apart by.
                old.Session("ibt", @"C:\telemetry\c.ibt", 0, "2026-03-01T10:00:00.000Z", Mx5, 67, "Mazda MX-5 Cup");
                old.Run(@"UPDATE sessions SET subsession_id = 70020002 WHERE ibt_path = 'C:\telemetry\c.ibt'");
                old.Session("live", null, 0, "2026-04-01T09:00:00.000Z", Mx5, 67, "Mazda MX-5 Cup");
                old.Session("live", null, 0, "2026-04-02T09:00:00.000Z", Mx5, 67, "Mazda MX-5 Cup");
                old.Run("UPDATE sessions SET subsession_id = 0 WHERE subsession_id IS NULL");
                old.Ingested(@"C:\telemetry\a.ibt", 1);
                old.Ingested(@"C:\telemetry\b.ibt", 1);
                old.Ingested(@"C:\telemetry\c.ibt", 1);

                old.Run(Version4Step);
                old.Run("INSERT INTO cars (car_path, name, seen) VALUES ('mx5 mx52016', 'Mazda MX-5 Cup', 6), ('lotus79', 'Lotus 79', 2)");
                old.Run("INSERT INTO session_cars SELECT id, car_path FROM sessions");
                old.Run(@"INSERT INTO session_cars SELECT id, 'lotus79' FROM sessions WHERE ibt_path IN ('C:\telemetry\a.ibt', 'C:\telemetry\b.ibt')");
                old.Run(@"UPDATE ingested_files SET cars_scanned = 1 WHERE path <> 'C:\telemetry\b.ibt'");
            }
            SqliteConnection.ClearAllPools();

            // The data API reads a store that hasn't been migrated yet, and has nothing to say about the rig.
            using (var unmigrated = RacingDeskStore.OpenReadOnly(Db))
            {
                Assert.That(Json(unmigrated.WriteCarViewsJson), Is.EqualTo("[]"));
                Assert.That(unmigrated.CarPedalsList(), Is.Empty);
                Assert.That(unmigrated.CarViewOf(Mx5), Is.Null);
                Assert.That(unmigrated.CarPedalsOf(Mx5), Is.Null);
                Assert.That(unmigrated.CarPedalFactsList(), Is.Empty);
                Assert.That(unmigrated.CarPedalFactsOf(Mx5), Is.Null);
            }
            SqliteConnection.ClearAllPools();

            using var store = new RacingDeskStore(Db);

            Assert.That(store.Scalar<string>("SELECT GROUP_CONCAT(version) FROM (SELECT version FROM schema_version ORDER BY version)"), Is.EqualTo("3,4,5,6,7,8"));
            Assert.That(store.Scalar<string>("SELECT GROUP_CONCAT(name) FROM pragma_table_info('ingested_files')"),
                Is.EqualTo("path,length,mtime,sessions,error,ingested_at"), "as every host since the first has known it");
            Assert.That(store.Scalar<string>("SELECT GROUP_CONCAT(path || '|' || length || '|' || mtime, ' ') FROM (SELECT * FROM car_scans ORDER BY path)"),
                Is.EqualTo(@"C:\telemetry\a.ibt|1024|2026-02-01T11:00:00.000Z C:\telemetry\c.ibt|1024|2026-02-01T11:00:00.000Z"));
            Assert.That(store.FilesNeedingCarScan(), Is.EqualTo(new[] { @"C:\telemetry\b.ibt" }), "the file the header pass had not reached is still to be read");

            var cars = store.Cars().ToDictionary(c => c.CarPath);
            Assert.That(cars[Mx5].Driven, Is.EqualTo(4), "two races and two test drives, in six rows");
            Assert.That(cars[Mx5].Seen, Is.EqualTo(4));
            Assert.That(cars[Lotus].Seen, Is.EqualTo(1), "in one race, whatever it was written to");
            Assert.That(cars[Lotus].Driven, Is.Zero);
            Assert.That(store.Scalar<long>("SELECT COUNT(*) FROM sessions"), Is.EqualTo(6), "nothing else moved");
            Assert.That(store.Scalar<long>("SELECT COUNT(*) FROM car_views") + store.Scalar<long>("SELECT COUNT(*) FROM car_pedals"), Is.Zero);
        }

        [Test]
        public void ASessionDrivenAndThenReadFromItsFileIsOneSession()
        {
            using var store = new RacingDeskStore(Db);

            store.SaveSession(Session("live", June.AddSeconds(3), 70010001, null, Mx5, "Mazda MX-5 Cup", LotusCar));
            Assert.That(store.Cars().Select(c => (c.CarPath, c.Driven, c.Seen)), Is.EquivalentTo(new[] { (Mx5, 1, 1), (Lotus, 0, 1) }));

            string file = Path.Combine(_dir, "a.ibt");
            store.SaveIngestedFile(file, 1024, June, new[] { Session("ibt", June, 70010001, file, Mx5, "Mazda MX-5 Cup", LotusCar) }, null);

            Assert.That(store.Scalar<long>("SELECT COUNT(*) FROM sessions"), Is.EqualTo(2), "both rows are kept: the desk merges them");
            Assert.That(store.Cars().Select(c => (c.CarPath, c.Driven, c.Seen)), Is.EquivalentTo(new[] { (Mx5, 1, 1), (Lotus, 0, 1) }));

            store.SaveSession(Session("live", June.AddDays(1), 70020002, null, Mx5, "Mazda MX-5 Cup"));
            Assert.That(store.Cars().Select(c => (c.CarPath, c.Driven, c.Seen)), Is.EquivalentTo(new[] { (Mx5, 2, 2), (Lotus, 0, 1) }));
        }

        [Test]
        public void ABuildFromBeforeTheHeaderPassCanStillIngest()
        {
            using var store = new RacingDeskStore(Db);

            // What every host up to version 3 runs when it has read a file.
            using (var db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = Db, Pooling = false }.ToString()))
            {
                db.Open();
                SmartControlTests.Run(db, "INSERT OR REPLACE INTO ingested_files VALUES ($p, $l, $m, $n, $e, $at)",
                    ("$p", @"C:\telemetry\old-build.ibt"), ("$l", 2048), ("$m", "2026-06-01T09:00:00.000Z"), ("$n", 1), ("$e", DBNull.Value), ("$at", "2026-06-01T09:30:00.000Z"));
            }

            Assert.That(store.FilesNeedingCarScan(), Is.EqualTo(new[] { @"C:\telemetry\old-build.ibt" }),
                "and the file's cars are read from its header by the next build that knows how");
        }

        // ── The view ──

        private static CarView View(string car, double height, bool chosen, DateTime at, double? seatX = null, double vanishY = 0) => new CarView
        {
            CarPath = car, DriverHeight = height, VanishY = vanishY, HeadHorizon = 0, Fov = 69,
            SeatX = seatX, SeatY = seatX.HasValue ? 0 : (double?)null, SeatZ = seatX.HasValue ? 0.02 : (double?)null,
            Chosen = chosen, SeenAtUtc = at,
        };

        [Test]
        public void AViewTheDriverChoseIsNotReplacedByOneTheCarOnlyInherited()
        {
            using var store = StoreWithCars();

            Assert.That(store.SaveCarView(View(Mx5, -0.06, chosen: false, June)), Is.True);
            var first = store.CarViewOf(Mx5);
            Assert.That(first.DriverHeight, Is.EqualTo(-0.06));
            Assert.That(first.Chosen, Is.False);
            Assert.That(first.SeatX, Is.Null);

            // Another car's height, left behind: all this car has to go on, until the driver sets its own.
            store.SaveCarView(View(Mx5, 0.03, chosen: false, June.AddDays(1)));
            Assert.That(store.CarViewOf(Mx5).DriverHeight, Is.EqualTo(0.03));

            store.SaveCarView(View(Mx5, -0.02, chosen: true, June.AddDays(2), seatX: -0.13, vanishY: 0.1));
            var chosen = store.CarViewOf(Mx5);
            Assert.That(chosen.DriverHeight, Is.EqualTo(-0.02));
            Assert.That(chosen.VanishY, Is.EqualTo(0.1));
            Assert.That(chosen.Chosen, Is.True);
            Assert.That(chosen.SeatX, Is.EqualTo(-0.13));

            // Driven again with the Lotus's view still in app.ini, and the seat moved in the camera tool.
            store.SaveCarView(View(Mx5, 0.05, chosen: false, June.AddDays(3), seatX: -0.10, vanishY: 0.4));
            var kept = store.CarViewOf(Mx5);
            Assert.That(kept.DriverHeight, Is.EqualTo(-0.02), "the height is still the one chosen for this car");
            Assert.That(kept.VanishY, Is.EqualTo(0.1));
            Assert.That(kept.Chosen, Is.True);
            Assert.That(kept.SeatX, Is.EqualTo(-0.10), "the seat is the car's own whoever drove last");
            Assert.That(kept.SeenAtUtc, Is.EqualTo(June.AddDays(3)));
            Assert.That(store.Scalar<string>("SELECT chosen_at FROM car_views"), Is.EqualTo("2026-06-03T09:00:00.000Z"));

            store.SaveCarView(View(Mx5, -0.04, chosen: true, June.AddDays(4)));
            Assert.That(store.CarViewOf(Mx5).DriverHeight, Is.EqualTo(-0.04), "chosen again");
            Assert.That(store.CarViewOf(Mx5).SeatX, Is.Null, "and its camera file gone");
            Assert.That(store.Scalar<long>("SELECT COUNT(*) FROM car_views"), Is.EqualTo(1));

            Assert.That(store.SaveCarView(null), Is.False);
            Assert.That(store.SaveCarView(View(" ", 0, chosen: true, June)), Is.False);
            Assert.That(store.CarViewOf("never driven"), Is.Null);
        }

        [Test]
        public void ServesTheViewsByTheCarsName()
        {
            using (var store = StoreWithCars())
            {
                store.SaveCarView(View(Mx5, -0.06, chosen: true, June, seatX: -0.13));
                store.SaveCarView(View(Lotus, 0.02, chosen: false, June.AddDays(1)));
                // A car the store has no name for: recorded all the same, and listed by its folder.
                store.SaveCarView(View("audi90gto", 0, chosen: false, June));
            }

            var (status, body) = Request("GET", "views");

            Assert.That(status, Is.EqualTo(HttpStatusCode.OK));
            using var json = JsonDocument.Parse(body);
            var rows = json.RootElement.EnumerateArray().ToList();
            Assert.That(rows.Select(r => r.GetProperty("car_path").GetString()), Is.EqualTo(new[] { "audi90gto", Lotus, Mx5 }));
            Assert.That(rows[0].GetProperty("name").ValueKind, Is.EqualTo(JsonValueKind.Null));
            Assert.That(rows[2].EnumerateObject().Select(p => p.Name), Is.EqualTo(new[]
            {
                "car_path", "name", "driver_height", "vanish_y", "head_horizon", "fov", "seat_x", "seat_y", "seat_z", "chosen", "chosen_at", "seen_at",
            }));
            Assert.That(rows[2].GetProperty("name").GetString(), Is.EqualTo("Mazda MX-5 Cup"));
            Assert.That(rows[2].GetProperty("driver_height").GetDouble(), Is.EqualTo(-0.06));
            Assert.That(rows[2].GetProperty("seat_x").GetDouble(), Is.EqualTo(-0.13));
            Assert.That(rows[2].GetProperty("chosen").GetInt32(), Is.EqualTo(1));
            Assert.That(rows[2].GetProperty("chosen_at").GetString(), Is.EqualTo("2026-06-01T09:00:00.000Z"));
            Assert.That(rows[1].GetProperty("chosen").GetInt32(), Is.Zero);
            Assert.That(rows[1].GetProperty("chosen_at").ValueKind, Is.EqualTo(JsonValueKind.Null));
            Assert.That(rows[1].GetProperty("seat_x").ValueKind, Is.EqualTo(JsonValueKind.Null));
        }

        // ── The pedals ──

        private static CarPedals Pedals(string car, string id, string name, string profile, DateTime at, double? force = null) => new CarPedals
        {
            CarPath = car, ProfileId = id, ProfileName = name, Profile = Encoding.UTF8.GetBytes(profile), BrakeForceKg = force, BoundAtUtc = at,
        };

        [Test]
        public void ACarKeepsItsProfileAsItWasAndItsBrakeForceWhicheverProfileItIsGiven()
        {
            using var store = StoreWithCars();

            Assert.That(store.BindCarPedals(Pedals(Mx5, "a1", "LightBrake", "<Profile>light</Profile>", June, force: 45)), Is.True);
            Assert.That(store.BindCarPedals(Pedals(Lotus, "b2", "HeavyBrake", "<Profile>heavy</Profile>", June)), Is.True);

            var mazda = store.CarPedalsOf(Mx5);
            Assert.That(mazda.ProfileName, Is.EqualTo("LightBrake"));
            Assert.That(mazda.CarName, Is.EqualTo("Mazda MX-5 Cup"));
            Assert.That(Encoding.UTF8.GetString(mazda.Profile), Is.EqualTo("<Profile>light</Profile>"));
            Assert.That(mazda.BrakeForceKg, Is.EqualTo(45));
            Assert.That(mazda.BoundAtUtc, Is.EqualTo(June));

            store.BindCarPedals(Pedals(Mx5, "b2", "HeavyBrake", "<Profile>heavy</Profile>", June.AddDays(1)));
            mazda = store.CarPedalsOf(Mx5);
            Assert.That(mazda.ProfileId, Is.EqualTo("b2"));
            Assert.That(Encoding.UTF8.GetString(mazda.Profile), Is.EqualTo("<Profile>heavy</Profile>"));
            Assert.That(mazda.BrakeForceKg, Is.EqualTo(45), "the force it was driven with is the car's");

            Assert.That(store.CarPedalsList().Select(p => p.CarPath), Is.EqualTo(new[] { Lotus, Mx5 }), "by the car's name");

            Assert.That(store.UnbindCarPedals(Mx5), Is.True);
            Assert.That(store.UnbindCarPedals(Mx5), Is.False);
            Assert.That(store.CarPedalsOf(Mx5), Is.Null);
            Assert.That(store.CarPedalsList().Select(p => p.CarPath), Is.EqualTo(new[] { Lotus }));

            Assert.That(store.BindCarPedals(Pedals(" ", "a1", "LightBrake", "", June)), Is.False);
            Assert.That(store.BindCarPedals(Pedals(Mx5, "a1", " ", "", June)), Is.False);
            Assert.That(store.HasCar(Mx5), Is.True);
            Assert.That(store.HasCar("never driven"), Is.False);
        }

        [Test]
        public void AVersion5StoreKeepsItsProfilesAndTheirForcesAsTheDriversOwn()
        {
            using (var store = StoreWithCars())
            {
                store.BindCarPedals(Pedals(Mx5, "a1", "LightBrake", "<Profile>light</Profile>", June, force: 45));
                store.BindCarPedals(Pedals(Lotus, "b2", "HeavyBrake", "<Profile>heavy</Profile>", June.AddDays(1)));
                // As a version 5 store was: no table of what is known beside the profile.
                store.Exec("DROP TABLE car_pedal_facts; DROP TABLE car_list_remarks; DELETE FROM schema_version WHERE version > 5; " +
                           "INSERT INTO schema_version (version) SELECT 5 WHERE NOT EXISTS (SELECT 1 FROM schema_version WHERE version = 5)");
            }
            SqliteConnection.ClearAllPools();

            using (var unmigrated = RacingDeskStore.OpenReadOnly(Db))
            {
                Assert.That(unmigrated.CarPedalsList().Select(p => p.CarPath), Is.EqualTo(new[] { Lotus, Mx5 }), "the profiles are read as they were");
                Assert.That(unmigrated.CarPedalFactsList(), Is.Empty);
            }
            SqliteConnection.ClearAllPools();

            using var migrated = new RacingDeskStore(Db);
            Assert.That(migrated.Scalar<long>("SELECT MAX(version) FROM schema_version"), Is.EqualTo(8));
            var mazda = migrated.CarPedalFactsOf(Mx5);
            Assert.That((mazda.ForceKg, mazda.ForceAtUtc, mazda.GivenBy, mazda.HasAbs), Is.EqualTo(((double?)45, (DateTime?)June, "driver", (bool?)null)));
            var lotus = migrated.CarPedalFactsOf(Lotus);
            Assert.That((lotus.ForceKg, lotus.ForceAtUtc, lotus.GivenBy), Is.EqualTo(((double?)null, (DateTime?)null, "driver")));
            Assert.That(migrated.CarPedalsOf(Mx5).BrakeForceKg, Is.EqualTo(45), "and car_pedals is as every host since version 5 has known it");
        }

        // ── /racing-desk/data/pedals ──

        private static int FreePort()
        {
            var l = new TcpListener(IPAddress.Loopback, 0);
            l.Start();
            int port = ((IPEndPoint)l.LocalEndpoint).Port;
            l.Stop();
            return port;
        }

        /// <summary>One request through the host's data API, served the way the runtime hands it requests.</summary>
        private (HttpStatusCode Status, string Body) Request(string method, string route, string? body = null, string? origin = null, bool smartControl = true, Action<HttpRequestMessage>? shape = null)
        {
            int port = FreePort();
            using var listener = new HttpListener();
            listener.Prefixes.Add($"http://127.0.0.1:{port}/racing-desk/"); // not localhost: HTTP.sys binds that on every address
            listener.Start();
            var api = new LocalDataApi(Db, smartControl ? SmartControlDb : Path.Combine(_dir, "not-installed.db"));
            var claimed = Task.Run(() => api.TryHandle(listener.GetContext()));

            using var http = new HttpClient();
            using var request = new HttpRequestMessage(new HttpMethod(method), $"http://127.0.0.1:{port}/racing-desk/data/{route}");
            if (body != null) request.Content = new StringContent(body, Encoding.UTF8, "application/json");
            if (origin != null) request.Headers.TryAddWithoutValidation("Origin", origin);
            shape?.Invoke(request);
            using var response = http.Send(request);
            string text = new StreamReader(response.Content.ReadAsStream(), Encoding.UTF8).ReadToEnd();
            Assert.That(claimed.Result, Is.True, "the data API claims /data/ routes");
            return (response.StatusCode, text);
        }

        private static string Json(Action<Utf8JsonWriter> write)
        {
            using var buffer = new MemoryStream();
            using (var json = new Utf8JsonWriter(buffer)) write(json);
            return Encoding.UTF8.GetString(buffer.ToArray());
        }

        private void SmartControlHas(params (string Id, string Name, int BrakeKg)[] profiles)
        {
            if (File.Exists(SmartControlDb))
            {
                SqliteConnection.ClearAllPools();
                File.Delete(SmartControlDb);
            }
            SmartControlTests.Database(SmartControlDb, db =>
            {
                foreach (var (id, name, kg) in profiles) SmartControlTests.AddProfile(db, id, name, Encoding.UTF8.GetBytes(SmartControlTests.ProfileXml(kg)));
                SmartControlTests.AddKey(db, 8, "50", "PRIOR", "");
                SmartControlTests.AddKey(db, 9, "5", "RCONTROL", "UP");
                SmartControlTests.AddKey(db, 10, "5", "RCONTROL", "DOWN");
            });
        }

        private static string Bind(string car, string? profile) =>
            JsonSerializer.Serialize(new Dictionary<string, string?> { ["car_path"] = car, ["profile_id"] = profile });

        [Test]
        public void GivesACarOneOfSmartControlsProfilesAndSaysHowItStandsNow()
        {
            StoreWithCars().Dispose();
            SmartControlHas(("a1", "LightBrake", 45), ("b2", "HeavyBrake", 83));

            var (status, body) = Request("POST", "pedals", Bind(Mx5, "a1"));
            Assert.That(status, Is.EqualTo(HttpStatusCode.OK), body);
            using (var json = JsonDocument.Parse(body))
            {
                var car = json.RootElement.GetProperty("car");
                Assert.That(car.EnumerateObject().Select(p => p.Name), Is.EqualTo(new[]
                {
                    "car_path", "name", "profile_id", "profile_name", "brake_force_kg", "bound_at", "profile_now",
                    "force_at", "has_abs", "given_by", "given_why",
                }));
                Assert.That(car.GetProperty("given_by").GetString(), Is.EqualTo("driver"));
                Assert.That(car.GetProperty("car_path").GetString(), Is.EqualTo(Mx5));
                Assert.That(car.GetProperty("name").GetString(), Is.EqualTo("Mazda MX-5 Cup"));
                Assert.That(car.GetProperty("profile_name").GetString(), Is.EqualTo("LightBrake"));
                Assert.That(car.GetProperty("brake_force_kg").ValueKind, Is.EqualTo(JsonValueKind.Null));
                Assert.That(car.GetProperty("profile_now").GetString(), Is.EqualTo("same"));
            }
            Assert.That(Request("POST", "pedals", Bind(Lotus, "b2")).Status, Is.EqualTo(HttpStatusCode.OK));
            SqliteConnection.ClearAllPools();
            using (var store = RacingDeskStore.OpenReadOnly(Db))
                Assert.That(Encoding.UTF8.GetString(store.CarPedalsOf(Mx5).Profile), Is.EqualTo(SmartControlTests.ProfileXml(45)), "byte for byte");
            SqliteConnection.ClearAllPools();

            // In SmartControl since: the light brake made lighter, the heavy one deleted.
            SmartControlHas(("a1", "LightBrake", 40), ("c3", "Rain", 75));

            (status, body) = Request("GET", "pedals");
            Assert.That(status, Is.EqualTo(HttpStatusCode.OK));
            using (var json = JsonDocument.Parse(body))
            {
                var smartControl = json.RootElement.GetProperty("smartcontrol");
                Assert.That(smartControl.GetProperty("found").GetBoolean(), Is.True);
                var profiles = smartControl.GetProperty("profiles").EnumerateArray().ToList();
                Assert.That(profiles.Select(p => p.GetProperty("name").GetString()), Is.EqualTo(new[] { "LightBrake", "Rain" }));
                Assert.That(profiles[0].GetProperty("id").GetString(), Is.EqualTo("a1"));
                Assert.That(profiles[0].GetProperty("brake").GetRawText(), Is.EqualTo("{\"deadzone_bottom\":8,\"max_force_kg\":40,\"curve\":[0,20,40,60,80,100]}"));
                Assert.That(profiles[0].GetProperty("throttle").GetRawText(), Is.EqualTo("{\"deadzone_bottom\":6,\"deadzone_top\":10,\"curve\":[0,25,50,75,92,100]}"));
                Assert.That(profiles[0].GetProperty("clutch").GetRawText(), Is.EqualTo("{\"deadzone_bottom\":5,\"deadzone_top\":5,\"curve\":[]}"));
                Assert.That(smartControl.GetProperty("keys").GetRawText(), Is.EqualTo(
                    "[{\"action\":\"set\",\"value\":50,\"keys\":[\"PRIOR\"]},{\"action\":\"raise\",\"value\":5,\"keys\":[\"RCONTROL\",\"UP\"]},{\"action\":\"lower\",\"value\":5,\"keys\":[\"RCONTROL\",\"DOWN\"]}]"));

                var cars = json.RootElement.GetProperty("cars").EnumerateArray().ToList();
                Assert.That(cars.Select(c => (c.GetProperty("car_path").GetString(), c.GetProperty("profile_now").GetString())),
                    Is.EqualTo(new[] { (Lotus, "gone"), (Mx5, "changed") }));
            }

            // Taken away again: his choice, which is kept, so that nothing gives the car a profile behind his back.
            (status, body) = Request("POST", "pedals", Bind(Mx5, null));
            Assert.That(status, Is.EqualTo(HttpStatusCode.OK));
            Assert.That(body, Is.EqualTo("{\"car\":null}"));
            (_, body) = Request("GET", "pedals");
            using (var json = JsonDocument.Parse(body))
            {
                Assert.That(json.RootElement.GetProperty("cars").EnumerateArray().Select(c => c.GetProperty("car_path").GetString()), Is.EqualTo(new[] { Lotus }));
                Assert.That(json.RootElement.GetProperty("without_profile").GetRawText(), Is.EqualTo(
                    "[{\"car_path\":\"mx5 mx52016\",\"name\":\"Mazda MX-5 Cup\",\"brake_force_kg\":null,\"force_at\":null,\"has_abs\":null,\"given_by\":\"none\",\"given_why\":null}]"));
            }
        }

        [Test]
        public void ACarWithAForceAndNoProfileIsSaidToo()
        {
            using (var store = StoreWithCars())
            {
                store.BindCarPedals(Pedals(Lotus, "b2", "HeavyBrake", "<Profile/>", June));
                store.NotePedalsGiven(Lotus, "rule", "no ABS", June);
                store.NotePedals(Lotus, 70, false, 3, June.AddHours(1));
                store.NotePedals(Mx5, 80, false, 2, June.AddHours(2));
            }

            var (status, body) = Request("GET", "pedals", smartControl: false);

            Assert.That(status, Is.EqualTo(HttpStatusCode.OK));
            using var json = JsonDocument.Parse(body);
            Assert.That(json.RootElement.GetProperty("cars").GetRawText(), Is.EqualTo(
                "[{\"car_path\":\"lotus79\",\"name\":\"Lotus 79\",\"profile_id\":\"b2\",\"profile_name\":\"HeavyBrake\"," +
                "\"brake_force_kg\":70,\"bound_at\":\"2026-06-01T09:00:00.000Z\",\"profile_now\":\"unknown\"," +
                "\"force_at\":\"2026-06-01T10:00:00.000Z\",\"has_abs\":false,\"given_by\":\"rule\",\"given_why\":\"no ABS\"}]"));
            Assert.That(json.RootElement.GetProperty("without_profile").GetRawText(), Is.EqualTo(
                "[{\"car_path\":\"mx5 mx52016\",\"name\":\"Mazda MX-5 Cup\",\"brake_force_kg\":80," +
                "\"force_at\":\"2026-06-01T11:00:00.000Z\",\"has_abs\":null,\"given_by\":null,\"given_why\":null}]"));
        }

        [Test]
        public void WithoutSmartControlThereAreNoProfilesAndNothingToSayAboutACars()
        {
            using (var store = StoreWithCars())
                store.BindCarPedals(Pedals(Mx5, "a1", "LightBrake", "<Profile/>", June, force: 45));

            var (status, body) = Request("GET", "pedals", smartControl: false);

            Assert.That(status, Is.EqualTo(HttpStatusCode.OK));
            Assert.That(body, Is.EqualTo("{\"smartcontrol\":{\"found\":false,\"profiles\":[],\"keys\":[]},\"cars\":[" +
                "{\"car_path\":\"mx5 mx52016\",\"name\":\"Mazda MX-5 Cup\",\"profile_id\":\"a1\",\"profile_name\":\"LightBrake\"," +
                "\"brake_force_kg\":45,\"bound_at\":\"2026-06-01T09:00:00.000Z\",\"profile_now\":\"unknown\"," +
                "\"force_at\":null,\"has_abs\":null,\"given_by\":null,\"given_why\":null}],\"without_profile\":[]}"));

            (status, body) = Request("POST", "pedals", Bind(Mx5, "a1"), smartControl: false);
            Assert.That(status, Is.EqualTo(HttpStatusCode.BadRequest));
            using var refused = JsonDocument.Parse(body);
            Assert.That(refused.RootElement.GetProperty("error").GetString(), Is.EqualTo("SmartControl's profiles can't be read"));
        }

        [Test]
        public void RefusesAWriteFromAnotherHost_OrOneThatABrowserMadeWithoutAnOrigin()
        {
            StoreWithCars().Dispose();
            SmartControlHas(("a1", "LightBrake", 45));

            // The same check the runtime's ?action= routes make: the connection, the Host it names, and whether a browser sent it.
            var refusals = new (string Why, Action<HttpRequestMessage> Shape)[]
            {
                ("a device on the LAN, by the rig's address", r => r.Headers.Host = "192.168.1.20:18889"),
                ("a name another site has pointed at the rig", r => r.Headers.Host = "evil.example"),
                ("an image or a form on a page, which has a Referer", r => r.Headers.Referrer = new Uri("http://evil.example/page")),
                ("a link on another site", r => r.Headers.TryAddWithoutValidation("Sec-Fetch-Site", "cross-site")),
            };
            foreach (var (why, shape) in refusals)
            {
                var (refused, _) = Request("POST", "pedals", Bind(Mx5, "a1"), shape: shape);
                Assert.That(refused, Is.EqualTo(HttpStatusCode.Forbidden), why);
            }
            SqliteConnection.ClearAllPools();
            using (var store = RacingDeskStore.OpenReadOnly(Db))
                Assert.That(store.CarPedalsList(), Is.Empty, "nothing was written by any of them");

            // A program on this machine says it is: the app's Node, by the name it was given.
            // (at the port the request came in on: the data API's own check names it)
            var (status, body) = Request("POST", "pedals", Bind(Mx5, "a1"), shape: r => r.Headers.Host = "localhost:" + r.RequestUri!.Port);
            Assert.That(status, Is.EqualTo(HttpStatusCode.OK), body);
        }

        [Test]
        public void RefusesAPageInABrowserAndWhatItDoesNotKnow()
        {
            StoreWithCars().Dispose();
            SmartControlHas(("a1", "LightBrake", 45));

            foreach (string origin in new[] { "https://example.com", "http://localhost:3000", "null", "file://" })
            {
                var (refused, why) = Request("POST", "pedals", Bind(Mx5, "a1"), origin);
                Assert.That(refused, Is.EqualTo(HttpStatusCode.Forbidden), origin);
                Assert.That(why, Does.Contain("error"));
            }

            var cases = new (string Body, string Says)[]
            {
                (Bind("never driven", "a1"), "no such car"),
                (Bind(Mx5, "zz"), "no such profile"),
                (Bind(" ", "a1"), "car_path required"),
                ("{\"car_path\":\"mx5 mx52016\"}", "expected"),
                ("{\"car_path\":\"mx5 mx52016\",\"profile_id\":7}", "expected"),
                ("[\"mx5 mx52016\",\"a1\"]", "expected"),
                ("not json", "expected"),
                ("", "expected"),
                ("{\"car_path\":\"mx5 mx52016\",\"profile_id\":\"" + new string('a', 5000) + "\"}", "too long"),
            };
            foreach (var (body, says) in cases)
            {
                var (status, answer) = Request("POST", "pedals", body);
                Assert.That(status, Is.EqualTo(HttpStatusCode.BadRequest), body.Length > 80 ? body.Substring(0, 80) : body);
                Assert.That(answer, Does.Contain(says));
            }

            SqliteConnection.ClearAllPools();
            using var store = RacingDeskStore.OpenReadOnly(Db);
            Assert.That(store.CarPedalsList(), Is.Empty, "nothing was written by any of them");

            // Reading is for programs on this machine, as the rest of the data API is, and for no page: not one of a web site, and
            // not the app's own (a file, which says an Origin of null: the desk asks through the app). DataRoutesThisMachineTests
            // asks every route.
            Assert.That(Request("GET", "pedals").Status, Is.EqualTo(HttpStatusCode.OK));
            Assert.That(Request("GET", "pedals", origin: "null").Status, Is.EqualTo(HttpStatusCode.Forbidden));
            Assert.That(Request("GET", "pedals", origin: "https://example.com").Status, Is.EqualTo(HttpStatusCode.Forbidden));
        }
    }
}
