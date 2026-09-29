using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using Microsoft.Data.Sqlite;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using RacingDesk.Core.Cars;
using RacingDesk.Data;
using RacingDesk.Host;
using static RacingDesk.Tests.Cars.CarListTests;

namespace RacingDesk.Tests.IRacing
{
    /// <summary>
    /// What the check of the car list has said, kept in the store (schema v7) and served with the list:
    /// the migration, the rows, the writer that keeps them off the telemetry thread, and
    /// <c>GET /racing-desk/data/controls</c>.
    /// </summary>
    [TestFixture]
    public class CarListRemarksStoreTests
    {
        private const string Mx5 = "mx5 mx52016";
        private const string MadeUpGt3 = "madeup gt3";
        private const string Hash = "0123456789ab";
        private const string Other = "ba9876543210";

        private static readonly DateTime June = new DateTime(2026, 6, 1, 9, 0, 0, DateTimeKind.Utc);

        private string _dir = "";

        [SetUp]
        public void SetUp() => Directory.CreateDirectory(_dir = Path.Combine(Path.GetTempPath(), "racing-desk-remarks-" + Guid.NewGuid().ToString("N")));

        [TearDown]
        public void TearDown()
        {
            SqliteConnection.ClearAllPools();
            try { Directory.Delete(_dir, true); } catch { }
        }

        private string Db => Path.Combine(_dir, "racing-desk.db");

        private static CarListRemark Said(string car, string about, string text, DateTime at, string hash = Hash) => new CarListRemark
        {
            CarPath = car, About = about, Text = text, ListHash = hash, FirstSeenUtc = at, LastSeenUtc = at,
        };

        /// <summary>Every row of every table but the ones named, as text: what a migration must leave as it found it.</summary>
        private string Dump(params string[] except)
        {
            SqliteConnection.ClearAllPools();
            using var db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = Db, Pooling = false, Mode = SqliteOpenMode.ReadOnly }.ToString());
            db.Open();
            var tables = new List<string>();
            using (var cmd = db.CreateCommand())
            {
                cmd.CommandText = "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name";
                using var r = cmd.ExecuteReader();
                while (r.Read()) tables.Add(r.GetString(0));
            }
            var text = new StringBuilder();
            foreach (string table in tables.Where(t => !except.Contains(t)))
            {
                text.Append("== ").Append(table).Append('\n');
                using var cmd = db.CreateCommand();
                cmd.CommandText = $"SELECT * FROM \"{table}\" ORDER BY rowid";
                using var r = cmd.ExecuteReader();
                while (r.Read())
                {
                    for (int i = 0; i < r.FieldCount; i++)
                    {
                        object v = r.GetValue(i);
                        text.Append(v is byte[] bytes ? Convert.ToHexString(bytes) : Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture)).Append('|');
                    }
                    text.Append('\n');
                }
            }
            return text.ToString();
        }

        private string Names(bool withoutRemarks = false)
        {
            using var db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = Db, Pooling = false, Mode = SqliteOpenMode.ReadOnly }.ToString());
            db.Open();
            using var cmd = db.CreateCommand();
            cmd.CommandText = "SELECT GROUP_CONCAT(name, ',') FROM (SELECT name FROM sqlite_master WHERE type IN ('table', 'index')"
                + (withoutRemarks ? " AND name NOT LIKE '%car_list_remarks%'" : "") + " ORDER BY name)";
            return (string)cmd.ExecuteScalar()!;
        }

        // ── The migration ──

        [Test]
        public void AVersion6StoreOpensAndGainsTheTableAndNothingElseChanges()
        {
            using (var store = new RacingDeskStore(Db))
            {
                var session = new SessionRecord { Source = "live", SessionNum = 0, SubsessionId = 70010001, StartedAtUtc = June, SessionType = "Race", CarPath = Mx5, CarScreenName = "Mazda MX-5 Cup" };
                session.Cars.Add(new CarRecord { CarPath = Mx5, Name = "Mazda MX-5 Cup" });
                store.SaveSession(session);
                store.SaveCarView(new CarView { CarPath = Mx5, DriverHeight = -0.06, VanishY = 0, HeadHorizon = 0, Fov = 69, Chosen = true, SeenAtUtc = June });
                store.BindCarPedals(new CarPedals { CarPath = Mx5, ProfileId = "a1", ProfileName = "LightBrake", Profile = Encoding.UTF8.GetBytes("<Profile/>"), BoundAtUtc = June });
                store.NotePedals(Mx5, 45, absSeen: true, laps: 2, June);
                // As a version 6 store was: no table of remarks.
                store.Exec("DROP TABLE car_list_remarks; DELETE FROM schema_version; INSERT INTO schema_version (version) VALUES (6)");
            }
            SqliteConnection.ClearAllPools();
            string before = Dump("schema_version");
            string namesBefore = Names();
            Assert.That(before, Does.Contain("Mazda MX-5 Cup"), "there is something in it to be left alone");
            Assert.That(namesBefore, Does.Not.Contain("car_list_remarks"));

            // The data API reads a store that has not been migrated yet, and has nothing kept to say.
            using (var unmigrated = RacingDeskStore.OpenReadOnly(Db))
            {
                Assert.That(unmigrated.CarListRemarksAgainst(Hash), Is.Empty);
                Assert.That(unmigrated.KeepCarListRemarks(new[] { Said(Mx5, "unknown", "x", June) }), Is.Zero, "and it writes nothing");
            }
            SqliteConnection.ClearAllPools();
            Assert.That(Names(), Is.EqualTo(namesBefore));

            using (var migrated = new RacingDeskStore(Db))
            {
                Assert.That(migrated.Scalar<string>("SELECT GROUP_CONCAT(version) FROM (SELECT version FROM schema_version ORDER BY version)"), Is.EqualTo("6,7"));
                Assert.That(migrated.Scalar<long>("SELECT COUNT(*) FROM car_list_remarks"), Is.Zero);
                Assert.That(migrated.Scalar<string>("SELECT GROUP_CONCAT(name || ' ' || type || CASE WHEN \"notnull\" THEN ' not null' ELSE '' END, ', ') FROM pragma_table_info('car_list_remarks')"),
                    Is.EqualTo("car_path TEXT not null, about TEXT not null, list_hash TEXT not null, remark TEXT not null, first_seen_at TEXT not null, last_seen_at TEXT not null"));
            }
            Assert.That(Dump("schema_version", "car_list_remarks"), Is.EqualTo(before), "every row of every other table is as it was");
            Assert.That(Names(withoutRemarks: true), Is.EqualTo(namesBefore), "and no table or index but the one is new");

            // Opened again, it is not migrated again.
            using (var again = new RacingDeskStore(Db))
                Assert.That(again.Scalar<string>("SELECT GROUP_CONCAT(version) FROM (SELECT version FROM schema_version ORDER BY version)"), Is.EqualTo("6,7"));
        }

        [Test]
        public void AFreshStoreHasTheTableAtVersion7()
        {
            Assert.That(RacingDeskStore.SchemaVersion, Is.EqualTo(7));
            using var store = new RacingDeskStore(Db);
            Assert.That(store.Scalar<long>("SELECT MAX(version) FROM schema_version"), Is.EqualTo(7));
            Assert.That(store.Scalar<long>("SELECT COUNT(*) FROM sqlite_master WHERE name = 'car_list_remarks'"), Is.EqualTo(1));
            Assert.That(store.CarListRemarksAgainst(Hash), Is.Empty);
        }

        [Test]
        public void AStoreFromALaterBuildIsNotMigratedAndTakesRemarksInTheTableItHas()
        {
            // A later build's store has this table, since every migration adds and none takes away. Opening it
            // changes nothing in it — it is not migrated, and not made to look like an older one — and what is kept
            // goes into that table as it goes into the others the code shares with it.
            using (var store = new RacingDeskStore(Db))
            {
                store.SaveCarView(new CarView { CarPath = Mx5, DriverHeight = -0.06, VanishY = 0, HeadHorizon = 0, Fov = 69, Chosen = true, SeenAtUtc = June });
                store.KeepCarListRemarks(new[] { Said(Mx5, "unknown", "is not in the list", June) });
                store.Exec("DELETE FROM schema_version; INSERT INTO schema_version (version) VALUES (8)");
            }
            SqliteConnection.ClearAllPools();
            string otherTables = Dump("car_list_remarks");
            string namesBefore = Names();
            Assert.That(namesBefore, Does.Contain("car_list_remarks"));

            using (var later = new RacingDeskStore(Db))
            {
                Assert.That(later.Scalar<long>("SELECT MAX(version) FROM schema_version"), Is.EqualTo(8));
                Assert.That(later.Scalar<long>("SELECT COUNT(*) FROM schema_version"), Is.EqualTo(1), "not migrated");
                Assert.That(later.KeepCarListRemarks(new[]
                {
                    Said(Mx5, "unknown", "is not in the list", June.AddDays(2)),
                    Said(MadeUpGt3, "absent:dcABS", "the list gives abs as dcABS, which the car does not publish", June.AddDays(2)),
                }), Is.EqualTo(2));
                var kept = later.CarListRemarksAgainst(Hash);
                Assert.That(kept.Select(r => (r.CarPath, r.About, r.FirstSeenUtc, r.LastSeenUtc)), Is.EqualTo(new[]
                {
                    (MadeUpGt3, "absent:dcABS", June.AddDays(2), June.AddDays(2)), (Mx5, "unknown", June, June.AddDays(2)),
                }));
            }
            SqliteConnection.ClearAllPools();
            Assert.That(Dump("car_list_remarks"), Is.EqualTo(otherTables), "nothing else in it is touched");
            Assert.That(Names(), Is.EqualTo(namesBefore), "nor is a table or an index added");
            using var again = new RacingDeskStore(Db);
            Assert.That(again.Scalar<long>("SELECT MAX(version) FROM schema_version"), Is.EqualTo(8), "and it is still the version it was");
        }

        [Test]
        public void AStoreWithNoRemarksTableIsLeftAsItIsAndKeepsNothingInIt()
        {
            // A later store that somehow has no such table — this code makes none in a store it does not migrate — is
            // read as having nothing kept and is not written to.
            using (var store = new RacingDeskStore(Db))
                store.Exec("DROP TABLE car_list_remarks; DELETE FROM schema_version; INSERT INTO schema_version (version) VALUES (8)");
            SqliteConnection.ClearAllPools();
            string before = Dump();
            string namesBefore = Names();

            using (var later = new RacingDeskStore(Db))
            {
                Assert.That(later.Scalar<long>("SELECT MAX(version) FROM schema_version"), Is.EqualTo(8));
                Assert.That(later.KeepCarListRemarks(new[] { Said(Mx5, "unknown", "x", June) }), Is.Zero);
                Assert.That(later.CarListRemarksAgainst(Hash), Is.Empty);
            }
            SqliteConnection.ClearAllPools();
            Assert.That(Dump(), Is.EqualTo(before));
            Assert.That(Names(), Is.EqualTo(namesBefore));
        }

        [Test]
        public void AFileThatIsNoStoreIsStillRefused()
        {
            File.WriteAllText(Db, "Not a database, and longer than the header of one: " + new string('x', 200));
            Assert.That(() => new RacingDeskStore(Db), Throws.InstanceOf<SqliteException>());
        }

        // ── The rows ──

        [Test]
        public void ARemarkSaidAgainUnderTheSameListMovesItsLastSightingAndNothingElse()
        {
            using var store = new RacingDeskStore(Db);
            store.KeepCarListRemarks(new[] { Said(MadeUpGt3, "absent:dcABS", "the list gives abs as dcABS, which the car does not publish", June) });
            store.KeepCarListRemarks(new[] { Said(MadeUpGt3, "absent:dcABS", "the list gives abs as dcABS, which the car does not publish", June.AddDays(3)) });
            store.KeepCarListRemarks(new[] { Said(MadeUpGt3, "absent:dcABS", "the list gives abs as dcABS, which the car does not publish", June.AddDays(1)) });

            Assert.That(store.Scalar<long>("SELECT COUNT(*) FROM car_list_remarks"), Is.EqualTo(1), "nothing is duplicated");
            var kept = store.CarListRemarksAgainst(Hash).Single();
            Assert.That((kept.CarPath, kept.About, kept.ListHash), Is.EqualTo((MadeUpGt3, "absent:dcABS", Hash)));
            Assert.That(kept.Text, Is.EqualTo("the list gives abs as dcABS, which the car does not publish"));
            Assert.That(kept.FirstSeenUtc, Is.EqualTo(June), "the first time stays the first");
            Assert.That(kept.LastSeenUtc, Is.EqualTo(June.AddDays(3)), "the last is the latest, however late the one in hand was said");
        }

        [Test]
        public void ARemarkIsPerCarPerThingPerList()
        {
            using var store = new RacingDeskStore(Db);
            store.KeepCarListRemarks(new[]
            {
                Said(MadeUpGt3, "absent:dcABS", "a", June),
                Said(MadeUpGt3, "unlisted", "b", June.AddMinutes(1)),
                Said(Mx5, "absent:dcABS", "c", June.AddMinutes(2)),
                Said(MadeUpGt3, "absent:dcABS", "a, as the list has it now", June.AddDays(9), Other),
                Said("MADEUP GT3", "unlisted", "b again", June.AddDays(2)),
            });

            Assert.That(store.Scalar<long>("SELECT COUNT(*) FROM car_list_remarks"), Is.EqualTo(4), "a car's case is not another car");
            var now = store.CarListRemarksAgainst(Hash);
            Assert.That(now.Select(r => (r.CarPath, r.About)), Is.EqualTo(new[] { (MadeUpGt3, "absent:dcABS"), (MadeUpGt3, "unlisted"), (Mx5, "absent:dcABS") }),
                "by car, then by when it was first said");
            Assert.That(now.Single(r => r.About == "unlisted").Text, Is.EqualTo("b again"), "what was said last is what is kept");
            Assert.That(now.Single(r => r.About == "unlisted").LastSeenUtc, Is.EqualTo(June.AddDays(2)));
            Assert.That(now.Select(r => r.ListHash), Is.All.EqualTo(Hash));

            var then = store.CarListRemarksAgainst(Other);
            Assert.That(then.Select(r => (r.CarPath, r.Text)), Is.EqualTo(new[] { (MadeUpGt3, "a, as the list has it now") }),
                "said against another list: kept, and not what is asked for");
            Assert.That(store.CarListRemarksAgainst("nothing said against this"), Is.Empty);
            Assert.That(store.CarListRemarksAgainst(""), Is.Empty);
        }

        [Test]
        public void WhatIsNotARemarkIsNotKept()
        {
            using var store = new RacingDeskStore(Db);
            int kept = store.KeepCarListRemarks(new[]
            {
                null!, Said("", "a", "x", June), Said(MadeUpGt3, " ", "x", June), Said(MadeUpGt3, "a", "", June), Said(MadeUpGt3, "a", "x", June, hash: " "),
                Said(MadeUpGt3, "kept", "x", June),
            });
            Assert.That(kept, Is.EqualTo(1));
            Assert.That(store.KeepCarListRemarks(null!), Is.Zero);
            Assert.That(store.CarListRemarksAgainst(Hash).Select(r => r.About), Is.EqualTo(new[] { "kept" }));
        }

        [Test]
        public void AllOfABatchIsKeptOrNoneOf()
        {
            using var store = new RacingDeskStore(Db);
            store.Exec("CREATE TRIGGER refuse_the_second BEFORE INSERT ON car_list_remarks WHEN NEW.about = 'second' BEGIN SELECT RAISE(ABORT, 'refused'); END");
            Assert.That(() => store.KeepCarListRemarks(new[] { Said(MadeUpGt3, "first", "x", June), Said(MadeUpGt3, "second", "y", June) }),
                Throws.InstanceOf<SqliteException>());
            Assert.That(store.Scalar<long>("SELECT COUNT(*) FROM car_list_remarks"), Is.Zero);
        }

        // ── The writer ──

        [Test]
        public void TheKeeperWritesWhatItIsGivenOnAnotherThread()
        {
            using (var keeper = new CarListRemarkKeeper(Db))
            {
                keeper.Keep(Remark(MadeUpGt3, "absent:dcABS", "the list gives abs as dcABS, which the car does not publish", Hash, June));
                keeper.Keep(Remark(Mx5, "unknown", "is not in the list", Hash, June.AddHours(1)));
                Assert.That(keeper.Flush(TimeSpan.FromSeconds(10)), Is.True);
            }
            using var store = new RacingDeskStore(Db);
            var kept = store.CarListRemarksAgainst(Hash);
            Assert.That(kept.Select(r => (r.CarPath, r.About, r.FirstSeenUtc, r.LastSeenUtc)), Is.EqualTo(new[]
            {
                (MadeUpGt3, "absent:dcABS", June, June), (Mx5, "unknown", June.AddHours(1), June.AddHours(1)),
            }), "first and last seen are when it was said");
        }

        [Test]
        public void TheTelemetryIsNeverHeldUpByTheStore()
        {
            using (var first = new RacingDeskStore(Db)) { }
            SqliteConnection.ClearAllPools();
            var said = new List<string>();
            using var writer = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = Db, Pooling = false }.ToString());
            writer.Open();
            Run(writer, "PRAGMA journal_mode=WAL");
            Run(writer, "BEGIN IMMEDIATE");   // somebody else is writing, and holds the store

            using var keeper = new CarListRemarkKeeper(Db, said.Add);
            var clock = Stopwatch.StartNew();
            for (int i = 0; i < 200; i++) keeper.Keep(Remark(MadeUpGt3, "about:" + i, "said " + i, Hash, June));
            long took = clock.ElapsedMilliseconds;
            Assert.That(took, Is.LessThan(500), "queued and returned, whatever the store is doing");

            Thread.Sleep(300);
            Assert.That(keeper.Flush(TimeSpan.FromMilliseconds(50)), Is.False, "the write is waiting for the store, on a thread that is not this one");
            Run(writer, "COMMIT");
            Assert.That(keeper.Flush(TimeSpan.FromSeconds(20)), Is.True);

            using var store = new RacingDeskStore(Db);
            Assert.That(store.CarListRemarksAgainst(Hash), Has.Count.EqualTo(200));
            Assert.That(said, Is.Empty);
        }

        [Test]
        public void AStoreThatCannotBeWrittenIsLoggedAndGoesNoFurther()
        {
            var said = new List<string>();
            // A folder where the store's file should be: it cannot be opened as one.
            Directory.CreateDirectory(Db);
            using var keeper = new CarListRemarkKeeper(Db, said.Add);

            Assert.That(() => keeper.Keep(Remark(MadeUpGt3, "a", "x", Hash, June)), Throws.Nothing);
            Assert.That(() => keeper.Keep(null!), Throws.Nothing);
            Assert.That(keeper.Flush(TimeSpan.FromSeconds(10)), Is.True, "and the writer is not left waiting");
            Assert.That(said, Has.Count.EqualTo(1));
            Assert.That(said[0], Does.StartWith("car list remarks not stored: "));

            // Nor is a log that throws anything to the caller.
            using var loud = new CarListRemarkKeeper(Db, _ => throw new InvalidOperationException("the log is broken"));
            Assert.That(() => loud.Keep(Remark(MadeUpGt3, "a", "x", Hash, June)), Throws.Nothing);
            Assert.That(loud.Flush(TimeSpan.FromSeconds(10)), Is.True);
        }

        [Test]
        public void ARemarkSaidAfterTheKeeperIsDisposedIsNotKept()
        {
            var keeper = new CarListRemarkKeeper(Db);
            keeper.Keep(Remark(MadeUpGt3, "before", "x", Hash, June));
            keeper.Dispose();
            keeper.Keep(Remark(MadeUpGt3, "after", "y", Hash, June));
            keeper.Dispose();
            Assert.That(keeper.Flush(TimeSpan.FromSeconds(5)), Is.True);

            using var store = new RacingDeskStore(Db);
            Assert.That(store.CarListRemarksAgainst(Hash).Select(r => r.About), Is.EqualTo(new[] { "before" }), "what was queued is written before it goes");
        }

        [Test]
        public void WhatTheFollowerSaysReachesTheStore()
        {
            var list = List();
            var follower = new CarControlsFollower(list, _ => { }, () => June);
            using var keeper = new CarListRemarkKeeper(Db);
            follower.Said += keeper.Keep;

            var gt3 = Gt3();
            gt3.Remove("dcABS");
            for (int i = 0; i < 100; i++) follower.See(MadeUpGt3, gt3.Property, false, true);
            for (int i = 0; i < 100; i++) follower.See("ferrari499p", gt3.Property, false, true);
            keeper.Flush(TimeSpan.FromSeconds(10));

            using (var store = new RacingDeskStore(Db))
            {
                var kept = store.CarListRemarksAgainst(list.Hash);
                Assert.That(kept.Select(r => (r.CarPath, r.About)), Is.EqualTo(new[] { ("ferrari499p", "unknown"), (MadeUpGt3, "absent:dcABS") }), "by car");
                Assert.That(kept.Select(r => r.FirstSeenUtc), Is.All.EqualTo(June));
            }

            // Another run: the same car, the same list, said again a day later.
            var next = new CarControlsFollower(list, _ => { }, () => June.AddDays(1));
            next.Said += keeper.Keep;
            for (int i = 0; i < 100; i++) next.See(MadeUpGt3, gt3.Property, false, true);
            keeper.Flush(TimeSpan.FromSeconds(10));
            using (var store = new RacingDeskStore(Db))
            {
                var kept = store.CarListRemarksAgainst(list.Hash).Single(r => r.CarPath == MadeUpGt3);
                Assert.That((kept.FirstSeenUtc, kept.LastSeenUtc), Is.EqualTo((June, June.AddDays(1))));
                Assert.That(store.Scalar<long>("SELECT COUNT(*) FROM car_list_remarks"), Is.EqualTo(2));
            }
        }

        [Test]
        public void LastSeenMovesWithEveryDriveOfTheCarInOneRunOfTheHost()
        {
            // The app is kept open across sessions, so the host — one follower, one check for each car — is up for
            // the evening: the same disagreement is seen at six, at eight and at ten, and the store says so.
            var list = List();
            var now = June;
            var follower = new CarControlsFollower(list, _ => { }, () => now);
            using var keeper = new CarListRemarkKeeper(Db);
            follower.Said += keeper.Keep;
            var gt3 = Gt3();
            gt3.Remove("dcABS");
            void Drive(DateTime at)
            {
                now = at;
                for (int i = 0; i < 5; i++) follower.See(MadeUpGt3, gt3.Property, false, false);   // the garage
                for (int i = 0; i < 100; i++) follower.See(MadeUpGt3, gt3.Property, false, true);
                Assert.That(keeper.Flush(TimeSpan.FromSeconds(10)), Is.True);
            }

            Drive(June);
            Drive(June.AddHours(2));
            Drive(June.AddHours(4));

            using var store = new RacingDeskStore(Db);
            var kept = store.CarListRemarksAgainst(list.Hash).Single();
            Assert.That((kept.About, kept.FirstSeenUtc, kept.LastSeenUtc), Is.EqualTo(("absent:dcABS", June, June.AddHours(4))),
                "last seen is the last drive that found it, not the run's first");
            Assert.That(store.Scalar<long>("SELECT COUNT(*) FROM car_list_remarks"), Is.EqualTo(1), "and nothing is duplicated");
        }

        private static CarRemark Remark(string car, string about, string text, string hash, DateTime at) => new CarRemark
        {
            CarPath = car, About = about, Text = text, ListHash = hash, SaidAtUtc = at,
        };

        private static void Run(SqliteConnection db, string sql)
        {
            using var cmd = db.CreateCommand();
            cmd.CommandText = sql;
            cmd.ExecuteNonQuery();
        }

        // ── /racing-desk/data/controls ──

        private static int FreePort()
        {
            var l = new TcpListener(IPAddress.Loopback, 0);
            l.Start();
            int port = ((IPEndPoint)l.LocalEndpoint).Port;
            l.Stop();
            return port;
        }

        private (HttpStatusCode Status, JObject Body) Get(CarControlsFollower cars, string route)
        {
            int port = FreePort();
            using var listener = new HttpListener();
            listener.Prefixes.Add($"http://127.0.0.1:{port}/racing-desk/");
            listener.Start();
            var api = new LocalDataApi(Db) { Cars = cars };
            var claimed = Task.Run(() => api.TryHandle(listener.GetContext()));

            using var http = new HttpClient();
            using var request = new HttpRequestMessage(HttpMethod.Get, $"http://127.0.0.1:{port}/racing-desk/data/{route}");
            using var response = http.Send(request);
            string text = new StreamReader(response.Content.ReadAsStream(), Encoding.UTF8).ReadToEnd();
            Assert.That(claimed.Result, Is.True);
            // A date is text here, as the desk reads it: not turned into a date by the parser.
            using var reader = new Newtonsoft.Json.JsonTextReader(new StringReader(text)) { DateParseHandling = Newtonsoft.Json.DateParseHandling.None };
            return (response.StatusCode, JObject.Load(reader));
        }

        [Test]
        public void TheListIsServedWithWhatTheStoreHasKeptOfItNotOnlyThisRuns()
        {
            var list = List();
            // Kept by the runs before this one: this car's ABS was found missing, and the 570S's mode has a position
            // the list lacks — the second against a list since changed.
            using (var store = new RacingDeskStore(Db))
            {
                store.KeepCarListRemarks(new[]
                {
                    Said(MadeUpGt3, "absent:dcABS", "the list gives abs as dcABS, which the car does not publish", June, list.Hash),
                    Said(MadeUpGt3, "absent:dcABS", "the list gives abs as dcABS, which the car does not publish", June.AddDays(4), list.Hash),
                    Said("ferrari499p", "unknown", "is not in the list: its controls are shown as they were before there was one", June.AddDays(1), list.Hash),
                    Said("mclaren570sgt4", "value:dcABS", "dcABS reads 3, a position of mode the list has no name for", June, Other),
                });
            }
            SqliteConnection.ClearAllPools();
            // This run has said nothing yet.
            var follower = new CarControlsFollower(list, _ => { });
            follower.See(Mx5, new Car().Property, true, true);

            var (status, body) = Get(follower, "controls");
            Assert.That(status, Is.EqualTo(HttpStatusCode.OK));
            Assert.That((string?)body["listHash"], Is.EqualTo(list.Hash));
            Assert.That(((int?)body["version"], (int?)body["count"], (string?)body["following"]), Is.EqualTo(((int?)1, (int?)6, (string?)Mx5)));
            Assert.That(body["remarks"], Is.Empty, "this run's are as they were: strings, by car, and none yet");
            Assert.That(body["cars"], Is.Not.Null);

            var kept = (JObject)body["kept"]!;
            Assert.That(kept.Properties().Select(p => p.Name), Is.EqualTo(new[] { "ferrari499p", MadeUpGt3 }),
                "by car; what was said against another list is not what is true of this one");
            var abs = kept[MadeUpGt3]!.Single();
            Assert.That(abs.ToObject<Dictionary<string, string>>(), Is.EqualTo(new Dictionary<string, string>
            {
                ["about"] = "absent:dcABS",
                ["text"] = "the list gives abs as dcABS, which the car does not publish",
                ["firstSeen"] = "2026-06-01T09:00:00.000Z",
                ["lastSeen"] = "2026-06-05T09:00:00.000Z",
            }));
            Assert.That((string?)kept["ferrari499p"]![0]!["about"], Is.EqualTo("unknown"));
        }

        [Test]
        public void OneCarIsServedWithWhatWasKeptOfIt()
        {
            var list = List();
            using (var store = new RacingDeskStore(Db))
            {
                store.KeepCarListRemarks(new[]
                {
                    Said(MadeUpGt3, "absent:dcABS", "a", June, list.Hash),
                    Said(MadeUpGt3, "unlisted", "b", June.AddHours(1), list.Hash),
                    Said(Mx5, "value:dcABS", "c", June, list.Hash),
                });
            }
            SqliteConnection.ClearAllPools();
            var follower = new CarControlsFollower(list, _ => { });

            var (_, one) = Get(follower, "controls?car=MADEUP-GT3");
            Assert.That((string?)one["car"]!["path"], Is.EqualTo(MadeUpGt3));
            Assert.That(one["kept"]!.Select(k => (string?)k["about"]), Is.EqualTo(new[] { "absent:dcABS", "unlisted" }), "by the list's own folding of a car's folder");
            Assert.That(one["cars"], Is.Null);
            Assert.That((string?)one["listHash"], Is.EqualTo(list.Hash));

            var (_, none) = Get(follower, "controls?car=bmwm2csr");
            Assert.That(none["kept"], Is.Empty);
            var (_, notListed) = Get(follower, "controls?car=ferrari499p");
            Assert.That(notListed["car"]!.Type, Is.EqualTo(JTokenType.Null));
            Assert.That(notListed["kept"], Is.Empty);
        }

        [Test]
        public void WithNoStoreYetNothingIsKeptAndTheListIsServedAllTheSame()
        {
            var follower = new CarControlsFollower(List(), _ => { });
            var (status, body) = Get(follower, "controls");
            Assert.That(status, Is.EqualTo(HttpStatusCode.OK));
            Assert.That(File.Exists(Db), Is.False, "asking does not make one");
            Assert.That(body["kept"]!.Type, Is.EqualTo(JTokenType.Object));
            Assert.That(body["kept"], Is.Empty, "which is true, and not the same as a store that could not be read");
            Assert.That(body["cars"]!.Count(), Is.EqualTo(6));
            Assert.That(Get(follower, "controls?car=" + MadeUpGt3).Body["kept"]!.Type, Is.EqualTo(JTokenType.Array));
        }

        [Test]
        public void AStoreThatCannotBeReadIsSaidAndTheListIsServedAllTheSame()
        {
            File.WriteAllText(Db, "Not a database, and longer than the header of one: " + new string('x', 200));
            var follower = new CarControlsFollower(List(), _ => { });

            var (status, body) = Get(follower, "controls");
            Assert.That(status, Is.EqualTo(HttpStatusCode.OK), "the list does not wait on the store");
            Assert.That(body["kept"]!.Type, Is.EqualTo(JTokenType.Null), "not read: neither none nor some");
            Assert.That(body["cars"]!.Count(), Is.EqualTo(6));
            Assert.That(Get(follower, "controls?car=" + MadeUpGt3).Body["kept"]!.Type, Is.EqualTo(JTokenType.Null));
        }

        [Test]
        public void AStoreWithoutTheTableHasNothingKeptAndIsNotChanged()
        {
            using (var store = new RacingDeskStore(Db))
                store.Exec("DROP TABLE car_list_remarks; DELETE FROM schema_version; INSERT INTO schema_version (version) VALUES (6)");
            SqliteConnection.ClearAllPools();
            string before = Dump();

            var (status, body) = Get(new CarControlsFollower(List(), _ => { }), "controls");
            Assert.That(status, Is.EqualTo(HttpStatusCode.OK));
            Assert.That(body["kept"], Is.Empty);
            Assert.That(Dump(), Is.EqualTo(before), "the route only reads");
        }

        [Test]
        public void TheRouteStaysReadOnlyForTheDesk()
        {
            int port = FreePort();
            using var listener = new HttpListener();
            listener.Prefixes.Add($"http://127.0.0.1:{port}/racing-desk/");
            listener.Start();
            var api = new LocalDataApi(Db) { Cars = new CarControlsFollower(List(), _ => { }) };
            var claimed = Task.Run(() => api.TryHandle(listener.GetContext()));
            using var http = new HttpClient();
            using var response = http.Send(new HttpRequestMessage(HttpMethod.Post, $"http://127.0.0.1:{port}/racing-desk/data/controls")
            {
                Content = new StringContent("{\"kept\":[]}", Encoding.UTF8, "application/json"),
            });
            Assert.That(claimed.Result, Is.True);
            Assert.That((int)response.StatusCode, Is.Not.EqualTo(200), "nothing is written through it");
            Assert.That(File.Exists(Db), Is.False);
        }
    }
}
