using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using IRSDKSharper;
using Microsoft.Data.Sqlite;
using NUnit.Framework;
using RacingDesk.Data;
using RacingDesk.Data.Schedule;
using RacingDesk.Host;
using RacingDesk.Plugin.IRacing;

namespace RacingDesk.Tests.IRacing
{
    /// <summary>One entry of a synthetic session's <c>DriverInfo: Drivers:</c>. The drivers are made up.</summary>
    internal sealed class Entrant
    {
        public int CarIdx;
        public string Driver = "Test Driver";
        public string CarPath = "";
        public string Name = "";
        public string ShortName = "";
        public int CarId;
        public bool PaceCar, Spectator;

        public Entrant(int carIdx, string carPath, string name, string shortName, int carId)
        {
            CarIdx = carIdx;
            CarPath = carPath;
            Name = name;
            ShortName = shortName;
            CarId = carId;
        }
    }

    /// <summary>
    /// A minimal .ibt laid out as iRacing writes them — header, variable table, session YAML, frames — with just
    /// the variables the session accumulator needs to see a session and its laps.
    /// </summary>
    internal sealed class SyntheticIbt
    {
        private const int HeaderSize = 144, VarHeaderSize = 144, FrameSize = 16;

        private static readonly (string Name, IRacingSdkEnum.VarType Type, int Offset)[] Vars =
        {
            ("SessionNum", IRacingSdkEnum.VarType.Int, 0),
            ("SessionTime", IRacingSdkEnum.VarType.Double, 4),
            ("LapCompleted", IRacingSdkEnum.VarType.Int, 12),
        };

        public byte[] Bytes { get; }
        public int YamlOffset { get; }
        public int YamlLength { get; }
        public int FramesOffset { get; }

        /// <param name="frames">Frames the file holds, at 60 Hz.</param>
        /// <param name="claimedFrames">Frames the header says it holds, when that differs.</param>
        /// <param name="lapSeconds">A lap is completed every this many seconds; 0 for none.</param>
        public SyntheticIbt(string yaml, DateTime recordedUtc, int frames = 120, int? claimedFrames = null, double lapSeconds = 0)
        {
            byte[] text = Encoding.GetEncoding("ISO-8859-1").GetBytes(yaml);
            YamlOffset = HeaderSize + Vars.Length * VarHeaderSize;
            YamlLength = text.Length + 1; // NUL-terminated
            FramesOffset = YamlOffset + YamlLength;
            Bytes = new byte[FramesOffset + frames * FrameSize];

            Put(0, 2);                          // version
            Put(4, 1);                          // status
            Put(8, 60);                         // tick rate
            Put(16, YamlLength);
            Put(20, YamlOffset);
            Put(24, Vars.Length);
            Put(28, HeaderSize);                // variable table
            Put(32, 1);                         // buffers
            Put(36, FrameSize);
            Put(52, FramesOffset);
            BitConverter.GetBytes(new DateTimeOffset(recordedUtc).ToUnixTimeSeconds()).CopyTo(Bytes, 112);
            BitConverter.GetBytes(0.0).CopyTo(Bytes, 120);
            BitConverter.GetBytes(frames / 60.0).CopyTo(Bytes, 128);
            Put(136, lapSeconds > 0 ? (int)(frames / 60.0 / lapSeconds) : 0);
            Put(140, claimedFrames ?? frames);

            for (int i = 0; i < Vars.Length; i++)
            {
                int o = HeaderSize + i * VarHeaderSize;
                Put(o, (int)Vars[i].Type);
                Put(o + 4, Vars[i].Offset);
                Put(o + 8, 1);
                Encoding.ASCII.GetBytes(Vars[i].Name).CopyTo(Bytes, o + 16);
            }

            text.CopyTo(Bytes, YamlOffset);

            for (int i = 0; i < frames; i++)
            {
                int o = FramesOffset + i * FrameSize;
                double t = i / 60.0;
                Put(o, 0);
                BitConverter.GetBytes(t).CopyTo(Bytes, o + 4);
                Put(o + 12, lapSeconds > 0 ? (int)(t / lapSeconds) : 0);
            }
        }

        /// <summary>
        /// Writes the file, or only its first <paramref name="length"/> bytes, dated an hour ago — ingest leaves
        /// a file written in the last two minutes for later, as one iRacing may still be writing.
        /// </summary>
        public string Write(string path, int? length = null)
        {
            using (var file = File.Create(path))
                file.Write(Bytes, 0, length ?? Bytes.Length);
            File.SetLastWriteTimeUtc(path, DateTime.UtcNow.AddHours(-1));
            return path;
        }

        private void Put(int offset, int value) => BitConverter.GetBytes(value).CopyTo(Bytes, offset);

        /// <summary>Session YAML as iRacing writes it: free text unquoted, one-space indents, lists level with their key.</summary>
        public static string Yaml(int ownCarIdx, params Entrant[] entrants)
        {
            var y = new StringBuilder();
            y.Append("---\n")
             .Append("WeekendInfo:\n")
             .Append(" TrackName: limerock 2019 gp\n")
             .Append(" TrackID: 352\n")
             .Append(" TrackLength: 2.41 km\n")
             .Append(" TrackDisplayName: Lime Rock Park\n")
             .Append(" TrackConfigName: Grand Prix\n")
             .Append(" SeriesID: 139\n")
             .Append(" SubSessionID: 70010001\n")
             .Append(" EventType: Race\n")
             .Append(" Category: SportsCar\n")
             .Append(" Official: 1\n")
             .Append(" NumCarClasses: 1\n")
             .Append("SessionInfo:\n")
             .Append(" Sessions:\n")
             .Append(" - SessionNum: 0\n")
             .Append("   SessionType: Race\n")
             .Append("DriverInfo:\n")
             .Append(" DriverCarIdx: ").Append(ownCarIdx).Append('\n')
             .Append(" DriverUserID: 900001\n")
             .Append(" DriverTires:\n")
             .Append(" - TireIndex: 0\n")
             .Append("   TireCompoundType: \"Hard\"\n")
             .Append(" Drivers:\n");
            foreach (var e in entrants)
            {
                y.Append(" - CarIdx: ").Append(e.CarIdx).Append('\n')
                 .Append("   UserName: ").Append(e.Driver).Append('\n')
                 .Append("   UserID: ").Append(900000 + e.CarIdx).Append('\n')
                 .Append("   CarPath: ").Append(e.CarPath).Append('\n')
                 .Append("   CarClassID: 74\n")
                 .Append("   CarID: ").Append(e.CarId).Append('\n')
                 .Append("   CarIsPaceCar: ").Append(e.PaceCar ? 1 : 0).Append('\n')
                 .Append("   CarScreenName: ").Append(e.Name).Append('\n')
                 .Append("   CarScreenNameShort: ").Append(e.ShortName).Append('\n')
                 .Append("   IRating: 1500\n")
                 .Append("   LicString: C 3.10\n")
                 .Append("   IsSpectator: ").Append(e.Spectator ? 1 : 0).Append('\n');
            }
            y.Append("SplitTimeInfo:\n")
             .Append(" Sectors:\n")
             .Append(" - SectorNum: 0\n")
             .Append("   SectorStartPct: 0.000000\n")
             .Append(" - SectorNum: 1\n")
             .Append("   SectorStartPct: 0.500000\n")
             .Append("...\n");
            return y.ToString();
        }
    }

    /// <summary>
    /// Car names: every entrant's car out of the session YAML, into the store's <c>cars</c> table, and out again
    /// at /racing-desk/data/cars. Synthetic files, temp folders and temp databases throughout.
    /// </summary>
    [TestFixture]
    public class CarsTests
    {
        private const string Mx5 = "mx5 mx52016";

        private static readonly DateTime February = new DateTime(2026, 2, 1, 10, 0, 0, DateTimeKind.Utc);
        private static readonly DateTime May = new DateTime(2026, 5, 1, 10, 0, 0, DateTimeKind.Utc);

        private string _dir = "";

        [SetUp]
        public void SetUp() => Directory.CreateDirectory(_dir = Path.Combine(Path.GetTempPath(), "racing-desk-cars-" + Guid.NewGuid().ToString("N")));

        [TearDown]
        public void TearDown()
        {
            SqliteConnection.ClearAllPools();
            try { Directory.Delete(_dir, true); } catch { }
        }

        private string Db => Path.Combine(_dir, "racing-desk.db");

        private static Entrant PaceCar() => new Entrant(0, "safety pcporsche911cup", "Pace Car", "Pace Car", 120) { Driver = "Pace Car", PaceCar = true };
        private static Entrant Mazda(int carIdx, string name = "Mazda MX-5 Cup", string shortName = "MX-5 Cup") => new Entrant(carIdx, Mx5, name, shortName, 67);
        private static Entrant Lotus(int carIdx) => new Entrant(carIdx, "lotus79", "Lotus 79", "Lotus 79", 42);
        private static Entrant Porsche(int carIdx) => new Entrant(carIdx, "porsche992cup", "Porsche 911 GT3 Cup (992)", "911 Cup: 992", 143);

        private static string[] Describe(IEnumerable<DriverCar> cars) =>
            cars.Select(c => $"{c.CarIdx}|{c.CarPath}|{c.CarScreenName}|{c.CarScreenNameShort}|{c.CarID}").ToArray();

        // ── The session YAML ──

        [Test]
        public void ReadsEveryDriversCarButNotThePaceCarOrSpectators()
        {
            string yaml = SyntheticIbt.Yaml(1,
                PaceCar(),
                Mazda(1),
                Mazda(2),
                Lotus(3),
                new Entrant(4, "dallarair18", "Dallara IR18", "IR18", 99) { Driver = "A Spectator", Spectator = true },
                Porsche(5),
                new Entrant(6, "legends ford34c", "[Legacy] Legends Ford '34 Coupe #1", "Legends: '34", 5),
                // iRacing writes this one with a space after it.
                new Entrant(7, "nissangtpzxt", "Nissan GTP ZX-T ", "Nissan GTP ZX-T", 77));

            var cars = SessionInfoYaml.ParseDriverCars(yaml);

            Assert.That(Describe(cars), Is.EqualTo(new[]
            {
                "1|mx5 mx52016|Mazda MX-5 Cup|MX-5 Cup|67",
                "2|mx5 mx52016|Mazda MX-5 Cup|MX-5 Cup|67",
                "3|lotus79|Lotus 79|Lotus 79|42",
                "5|porsche992cup|Porsche 911 GT3 Cup (992)|911 Cup: 992|143",
                "6|legends ford34c|[Legacy] Legends Ford '34 Coupe #1|Legends: '34|5",
                "7|nissangtpzxt|Nissan GTP ZX-T|Nissan GTP ZX-T|77",
            }));
            Assert.That(Describe(SessionInfoYaml.DriverCars(SessionInfoYaml.Parse(yaml))), Is.EqualTo(Describe(cars)),
                "the typed model, which ingest and live capture use, has to list the same cars");

            Assert.That(CarRecord.Distinct(cars).Select(c => c.CarPath), Is.EqualTo(new[] { Mx5, "lotus79", "porsche992cup", "legends ford34c", "nissangtpzxt" }),
                "each car once, however many drivers were in it");
        }

        [Test]
        public void ReadsTheNameACarHadInEachSession()
        {
            var before = SessionInfoYaml.ParseDriverCars(SyntheticIbt.Yaml(1, PaceCar(), Mazda(1)));
            var after = SessionInfoYaml.ParseDriverCars(SyntheticIbt.Yaml(1, PaceCar(), Mazda(1, "Global Mazda MX-5 Cup", "Global MX-5")));

            Assert.That(before.Single().CarPath, Is.EqualTo(after.Single().CarPath));
            Assert.That(before.Single().CarScreenName, Is.EqualTo("Mazda MX-5 Cup"));
            Assert.That(after.Single().CarScreenName, Is.EqualTo("Global Mazda MX-5 Cup"));
            Assert.That(after.Single().CarScreenNameShort, Is.EqualTo("Global MX-5"));
        }

        [Test]
        public void KeepsTheDriversOwnCarAndReadsQuotedAndWindowsText()
        {
            // Watching a session leaves the driver's own entry flagged a spectator; the session is still stored under its car.
            string yaml = SyntheticIbt.Yaml(2, PaceCar(), Mazda(1), new Entrant(2, "lotus79", "'Lotus ''79'", "\"Lotus 79\"", 42) { Spectator = true })
                .Replace("\n", "\r\n");

            var cars = SessionInfoYaml.ParseDriverCars(yaml);

            Assert.That(Describe(cars), Is.EqualTo(new[] { "1|mx5 mx52016|Mazda MX-5 Cup|MX-5 Cup|67", "2|lotus79|Lotus '79|Lotus 79|42" }));
            Assert.That(SessionInfoYaml.ParseDriverCars(null), Is.Empty);
            Assert.That(SessionInfoYaml.ParseDriverCars("---\nWeekendInfo:\n TrackID: 352\n...\n"), Is.Empty);
        }

        /// <summary>Against the rig's own history where there is some: headers only, nothing written.</summary>
        [Test]
        public void ReadsTheSameCarsAsTheTypedModelAcrossRecentHistory()
        {
            var files = IbtFileTests.NewestIbt(40).ToList();
            Assume.That(files, Is.Not.Empty, "no .ibt history on this machine");

            int compared = 0;
            foreach (var f in files)
            {
                IbtHeader header;
                try { header = IbtFile.ReadHeader(f.FullName); }
                catch (InvalidDataException) { continue; } // truncated file — the pass skips these
                var typed = SessionInfoYaml.DriverCars(SessionInfoYaml.Parse(header.SessionInfoYamlText));
                Assert.That(Describe(SessionInfoYaml.ParseDriverCars(header.SessionInfoYamlText)), Is.EqualTo(Describe(typed)), f.Name);
                compared++;
            }
            Assert.That(compared, Is.GreaterThan(0));
        }

        // ── The store ──

        private static SessionRecord Session(DateTime startedAt, params Entrant[] entrants)
        {
            var s = new SessionRecord
            {
                Source = "live", SessionNum = 0, StartedAtUtc = startedAt, SessionType = "Race",
                CarPath = entrants[0].CarPath, CarScreenName = entrants[0].Name, CarId = entrants[0].CarId,
            };
            s.Cars.AddRange(CarRecord.Distinct(SessionInfoYaml.ParseDriverCars(SyntheticIbt.Yaml(entrants[0].CarIdx, entrants))));
            return s;
        }

        private static CarSummary Car(RacingDeskStore store, string carPath) => store.Cars().Single(c => c.CarPath == carPath);

        [Test]
        public void CountsACarOncePerSessionAndKeepsItsNewestName()
        {
            using var store = new RacingDeskStore(Db);

            // Newest first, the way a backfill can meet them.
            store.SaveSession(Session(May, Mazda(1, "Global Mazda MX-5 Cup", "Global MX-5"), Mazda(2, "Global Mazda MX-5 Cup", "Global MX-5")));
            store.SaveSession(Session(February, Mazda(1), Mazda(2), Mazda(3), Lotus(4)));

            var mazda = Car(store, Mx5);
            Assert.That(mazda.Name, Is.EqualTo("Global Mazda MX-5 Cup"), "the newest session names the car, whichever was stored last");
            Assert.That(mazda.ShortName, Is.EqualTo("Global MX-5"));
            Assert.That(mazda.CarId, Is.EqualTo(67));
            Assert.That(mazda.Seen, Is.EqualTo(2), "two sessions, five drivers");
            Assert.That(mazda.Driven, Is.EqualTo(2));
            Assert.That(store.Scalar<string>("SELECT first_seen_at FROM cars WHERE car_path = 'mx5 mx52016'"), Is.EqualTo("2026-02-01T10:00:00.000Z"));
            Assert.That(store.Scalar<string>("SELECT last_seen_at FROM cars WHERE car_path = 'mx5 mx52016'"), Is.EqualTo("2026-05-01T10:00:00.000Z"));

            var lotus = Car(store, "lotus79");
            Assert.That(lotus.Seen, Is.EqualTo(1));
            Assert.That(lotus.Driven, Is.Zero);
        }

        [Test]
        public void SavingASessionAgainDoesNotCountItAgain()
        {
            using var store = new RacingDeskStore(Db);

            // A live session is saved at every lap and once more when it ends; the field can change in between.
            store.SaveSession(Session(February, Mazda(1), Lotus(2)));
            store.SaveSession(Session(February, Mazda(1), Lotus(2)));
            store.SaveSession(Session(February, Mazda(1), Lotus(2), Porsche(3)));
            Assert.That(store.Cars().Select(c => (c.CarPath, c.Seen)), Is.EquivalentTo(new[] { (Mx5, 1), ("lotus79", 1), ("porsche992cup", 1) }));
            Assert.That(store.Scalar<long>("SELECT COUNT(*) FROM sessions"), Is.EqualTo(1));

            store.SaveSession(Session(February, Mazda(1), Porsche(3)));
            Assert.That(Car(store, "lotus79").Seen, Is.Zero, "no stored session has it any more; its name is still its name");
            Assert.That(Car(store, Mx5).Seen, Is.EqualTo(1));
        }

        // ── A store from before there were cars ──

        internal const string Version3Schema = @"
CREATE TABLE sessions (
  id                        INTEGER PRIMARY KEY,
  source_key                TEXT NOT NULL UNIQUE,
  source                    TEXT NOT NULL,
  ibt_path                  TEXT,
  session_num               INTEGER NOT NULL,
  subsession_id             INTEGER, session_id INTEGER, series_id INTEGER, season_id INTEGER, race_week INTEGER,
  event_type                TEXT, session_type TEXT, official INTEGER, category TEXT,
  track_id                  INTEGER, track_name TEXT, track_display_name TEXT, track_config TEXT, track_length_km REAL,
  car_path                  TEXT, car_id INTEGER, car_screen_name TEXT, car_class_id INTEGER,
  started_at                TEXT NOT NULL,
  duration_s                REAL,
  driver_cust_id            INTEGER, driver_name TEXT, irating INTEGER, license TEXT, safety_rating REAL,
  laps_completed            INTEGER, best_lap_s REAL, incidents INTEGER,
  start_position            INTEGER, finish_position INTEGER, finish_position_in_class INTEGER,
  field_size                INTEGER, sof INTEGER,
  saved_at                  TEXT NOT NULL
);
CREATE INDEX sessions_started_at ON sessions(started_at);
CREATE INDEX sessions_track ON sessions(track_id, car_path);
CREATE INDEX sessions_series ON sessions(series_id, race_week);
CREATE TABLE laps (
  session_id                INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  lap                       INTEGER NOT NULL,
  lap_time_s                REAL, clean INTEGER, incidents INTEGER, fuel_used_l REAL, pitted INTEGER,
  start_session_time        REAL, position INTEGER,
  PRIMARY KEY (session_id, lap)
);
CREATE TABLE incidents (
  session_id                INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  session_time              REAL NOT NULL, lap INTEGER, lap_dist_pct REAL, points INTEGER
);
CREATE INDEX incidents_session ON incidents(session_id);
CREATE TABLE grid_entries (
  session_id                INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  car_idx                   INTEGER NOT NULL,
  cust_id INTEGER, name TEXT, irating INTEGER, license TEXT, car_class_id INTEGER, car_screen_name TEXT,
  finish_position INTEGER, class_position INTEGER, laps_complete INTEGER, fastest_lap_s REAL, incidents INTEGER,
  reason_out TEXT, is_player INTEGER,
  PRIMARY KEY (session_id, car_idx)
);
CREATE TABLE track_geometry (
  track_id                  INTEGER PRIMARY KEY,
  track_name TEXT, length_m REAL, official_length_m REAL, clean_laps INTEGER, source_ibt TEXT,
  origin_lat REAL, origin_lon REAL, points BLOB NOT NULL, sector_starts TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE ingested_files (
  path TEXT PRIMARY KEY, length INTEGER, mtime TEXT, sessions INTEGER, error TEXT, ingested_at TEXT NOT NULL
);
CREATE TABLE schema_version (version INTEGER NOT NULL);
INSERT INTO schema_version (version) VALUES (3);
";

        /// <summary>A store as version 3 of the host left it: sessions that name only the driver's own car.</summary>
        internal sealed class Version3Store : IDisposable
        {
            private readonly SqliteConnection _db;

            public Version3Store(string path)
            {
                _db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = path }.ToString());
                _db.Open();
                Run(Version3Schema);
                Run(ScheduleStore.Schema);
            }

            public void Session(string source, string? ibtPath, int num, string startedAt, string? carPath, int carId, string? carName)
            {
                string key = source == "ibt" ? $"ibt|{ibtPath}|{num}" : $"{source}|{startedAt}|{num}";
                Run(@"INSERT INTO sessions (source_key, source, ibt_path, session_num, session_type, car_path, car_id, car_screen_name, started_at, saved_at)
VALUES ($key, $source, $ibt, $num, 'Race', $path, $id, $name, $at, $at)",
                    ("$key", key), ("$source", source), ("$ibt", ibtPath), ("$num", num), ("$path", carPath), ("$id", carId), ("$name", carName), ("$at", startedAt));
            }

            public void Ingested(string path, int sessions, string? error = null) =>
                Run("INSERT INTO ingested_files VALUES ($p, 1024, '2026-02-01T11:00:00.000Z', $n, $e, '2026-09-01T08:00:00.000Z')",
                    ("$p", path), ("$n", sessions), ("$e", error));

            public void Run(string sql, params (string Name, object? Value)[] args)
            {
                using var cmd = _db.CreateCommand();
                cmd.CommandText = sql;
                foreach (var (name, value) in args) cmd.Parameters.AddWithValue(name, value ?? DBNull.Value);
                cmd.ExecuteNonQuery();
            }

            public void Dispose() => _db.Dispose();
        }

        [Test]
        public void MigratesAVersion3StoreAndNamesTheCarsItsSessionsAlreadyKnow()
        {
            using (var v3 = new Version3Store(Db))
            {
                v3.Session("ibt", @"C:\telemetry\a.ibt", 0, "2026-02-01T10:00:00.000Z", Mx5, 67, "Mazda MX-5 Cup");
                v3.Session("ibt", @"C:\telemetry\a.ibt", 1, "2026-02-01T10:20:00.000Z", Mx5, 67, "Mazda MX-5 Cup");
                v3.Session("live", null, 0, "2026-06-01T09:00:00.000Z", Mx5, 67, "Global Mazda MX-5 Cup "); // as the YAML had it
                v3.Session("live", null, 0, "2026-01-15T09:00:00.000Z", Mx5, 67, "");
                v3.Session("ibt", @"C:\telemetry\e.ibt", 0, "2026-03-01T10:00:00.000Z", "lotus79", 0, "Lotus 79");
                v3.Session("live", null, 0, "2026-04-01T09:00:00.000Z", "neverNamed", 7, null);
                v3.Session("live", null, 0, "2026-04-02T09:00:00.000Z", null, 0, null);
                v3.Ingested(@"C:\telemetry\a.ibt", 2);
                v3.Ingested(@"C:\telemetry\e.ibt", 1);
            }

            // The data API opens the store read-only and must not trip over one that hasn't been migrated yet.
            using (var old = RacingDeskStore.OpenReadOnly(Db))
            {
                Assert.That(old.CarCount(), Is.Zero);
                Assert.That(old.Cars(), Is.Empty);
                Assert.That(CarsJson(old), Is.EqualTo("[]"));
            }
            SqliteConnection.ClearAllPools();

            using (var store = new RacingDeskStore(Db))
            {
                Assert.That(store.Scalar<long>("SELECT MAX(version) FROM schema_version"), Is.EqualTo(RacingDeskStore.SchemaVersion));
                Assert.That(store.Cars().Select(c => c.CarPath), Is.EqualTo(new[] { Mx5, "lotus79" }), "a car no session names has no row");

                var mazda = Car(store, Mx5);
                Assert.That(mazda.Name, Is.EqualTo("Global Mazda MX-5 Cup"), "its newest name");
                Assert.That(mazda.ShortName, Is.Null, "sessions never kept the short name; the header pass brings it");
                Assert.That(mazda.CarId, Is.EqualTo(67));
                Assert.That(mazda.Driven, Is.EqualTo(4));
                Assert.That(mazda.Seen, Is.EqualTo(4), "the driver's own car was in the entry list of every session driven in it");
                Assert.That(store.Scalar<string>("SELECT first_seen_at FROM cars WHERE car_path = 'mx5 mx52016'"), Is.EqualTo("2026-01-15T09:00:00.000Z"));
                Assert.That(store.Scalar<string>("SELECT last_seen_at FROM cars WHERE car_path = 'mx5 mx52016'"), Is.EqualTo("2026-06-01T09:00:00.000Z"));

                var lotus = Car(store, "lotus79");
                Assert.That(lotus.CarId, Is.Null, "0 is iRacing not saying");
                Assert.That(lotus.Seen, Is.EqualTo(1));

                Assert.That(store.FilesNeedingCarScan(), Is.EqualTo(new[] { @"C:\telemetry\a.ibt", @"C:\telemetry\e.ibt" }),
                    "every file ingested before is still to be read for its cars");
                Assert.That(store.Scalar<long>("SELECT COUNT(*) FROM sessions"), Is.EqualTo(7), "nothing else moved");
            }

            using (var again = new RacingDeskStore(Db))
            {
                Assert.That(again.Scalar<string>("SELECT GROUP_CONCAT(version) FROM (SELECT version FROM schema_version ORDER BY version)"), Is.EqualTo("3,4,5,6,7"));
                Assert.That(Car(again, Mx5).Seen, Is.EqualTo(4), "opening it again seeds nothing twice");
            }
        }

        [Test]
        public void AFreshStoreHasTheCarsTables()
        {
            using var store = new RacingDeskStore(Db);
            Assert.That(store.Scalar<long>("SELECT MAX(version) FROM schema_version"), Is.EqualTo(RacingDeskStore.SchemaVersion));
            Assert.That(store.Scalar<long>("SELECT COUNT(*) FROM sqlite_master WHERE name IN ('cars', 'session_cars')"), Is.EqualTo(2));
            Assert.That(store.Scalar<long>("SELECT COUNT(*) FROM sqlite_master WHERE name IN ('car_scans', 'car_views', 'car_pedals', 'car_pedal_facts', 'car_list_remarks')"), Is.EqualTo(5));
            Assert.That(store.Scalar<long>("SELECT COUNT(*) FROM pragma_table_info('ingested_files')"), Is.EqualTo(6), "as every host since the first has known it");
            Assert.That(store.CarCount(), Is.Zero);
            Assert.That(CarsJson(store), Is.EqualTo("[]"));
        }

        private static void Sql(SqliteConnection db, string sql)
        {
            using var cmd = db.CreateCommand();
            cmd.CommandText = sql;
            cmd.ExecuteNonQuery();
        }

        [Test]
        public void TwoOpenersMeetingAVersion3StoreBothOpenIt()
        {
            using (var v3 = new Version3Store(Db))
            {
                v3.Session("ibt", @"C:\telemetry\a.ibt", 0, "2026-02-01T10:00:00.000Z", Mx5, 67, "Mazda MX-5 Cup");
                v3.Ingested(@"C:\telemetry\a.ibt", 1);
            }
            SqliteConnection.ClearAllPools();

            // The host, and a `cars` or `ingest` run started beside it. The store is in WAL mode, as the real one
            // is, where a writer holds no reader up: both read version 3 and queue behind it for the write lock.
            Task<long>[] openers;
            using (var writer = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = Db, Pooling = false }.ToString()))
            {
                writer.Open();
                Sql(writer, "PRAGMA journal_mode=WAL");
                Sql(writer, "BEGIN IMMEDIATE");
                openers = Enumerable.Range(0, 2).Select(_ => Task.Run(() =>
                {
                    using var store = new RacingDeskStore(Db);
                    return store.Scalar<long>("SELECT MAX(version) FROM schema_version");
                })).ToArray();
                Thread.Sleep(600);
                Assert.That(openers.Any(o => o.IsCompleted), Is.False, "both wait for the writer");
                Sql(writer, "COMMIT");
            }

            Assert.That(() => Task.WaitAll(openers), Throws.Nothing, "the one that waited finds the step taken, and takes none");
            Assert.That(openers.Select(o => o.Result), Is.EqualTo(new[] { (long)RacingDeskStore.SchemaVersion, RacingDeskStore.SchemaVersion }));

            using var after = new RacingDeskStore(Db);
            Assert.That(after.Scalar<string>("SELECT GROUP_CONCAT(version) FROM (SELECT version FROM schema_version ORDER BY version)"), Is.EqualTo("3,4,5,6,7"));
            Assert.That(after.Cars().Select(c => (c.CarPath, c.Seen)), Is.EqualTo(new[] { (Mx5, 1) }));
        }

        [Test]
        public void AStoreThatCannotBeOpenedLetsGoOfItsFile()
        {
            File.WriteAllText(Db, "Not a database, and longer than the header of one: " + new string('x', 200));

            Assert.That(() => new RacingDeskStore(Db), Throws.InstanceOf<SqliteException>());

            SqliteConnection.ClearAllPools();
            Assert.That(() => File.Delete(Db), Throws.Nothing, "nothing of the failed open still holds the file");
            Assert.That(File.Exists(Db), Is.False);
        }

        // ── The header pass ──

        [Test]
        public void HeaderPassNamesEveryCarWithoutReadingAFrame()
        {
            string whole = Path.Combine(_dir, "whole.ibt");
            string noFrames = Path.Combine(_dir, "no-frames.ibt");
            string cutShort = Path.Combine(_dir, "cut-short.ibt");
            string gone = Path.Combine(_dir, "gone.ibt");

            new SyntheticIbt(SyntheticIbt.Yaml(1, PaceCar(), Mazda(1), Mazda(2), Lotus(3)), February).Write(whole);

            // The header promises a thousand frames; the file stops eight bytes into the first.
            var truncated = new SyntheticIbt(SyntheticIbt.Yaml(1, PaceCar(), Mazda(1, "Global Mazda MX-5 Cup", "Global MX-5"), Porsche(2)), May, frames: 1, claimedFrames: 1000);
            truncated.Write(noFrames, truncated.FramesOffset + 8);
            Assert.That(new FileInfo(noFrames).Length, Is.LessThan(truncated.FramesOffset + 16));

            var broken = new SyntheticIbt(SyntheticIbt.Yaml(1, PaceCar(), new Entrant(1, "dallarair18", "Dallara IR18", "IR18", 99)), May);
            broken.Write(cutShort, broken.YamlOffset + broken.YamlLength / 2);

            using (var v3 = new Version3Store(Db))
            {
                // Practice and race from the whole file; the others gave the ingest nothing to store.
                v3.Session("ibt", whole, 0, "2026-02-01T10:00:00.000Z", Mx5, 67, "Mazda MX-5 Cup");
                v3.Session("ibt", whole, 1, "2026-02-01T10:20:00.000Z", Mx5, 67, "Mazda MX-5 Cup");
                v3.Ingested(whole, 2);
                v3.Ingested(noFrames, 0);
                v3.Ingested(cutShort, 0, "InvalidDataException: truncated");
                v3.Ingested(gone, 0);
            }

            using var store = new RacingDeskStore(Db);
            Assert.That(store.Cars().Select(c => (c.CarPath, c.Seen)), Is.EqualTo(new[] { (Mx5, 2) }), "what the migration knew");

            var log = new List<string>();
            var ingest = new IbtIngest(store, log.Add);
            var scan = ingest.ScanCars();

            Assert.That(scan.FilesScanned, Is.EqualTo(2));
            Assert.That(scan.FilesFailed, Is.EqualTo(1));
            Assert.That(scan.FilesMissing, Is.EqualTo(1));
            Assert.That(scan.FilesLeft, Is.Zero);
            Assert.That(scan.Cars, Is.EqualTo(3));
            Assert.That(log.Single(), Does.Contain("cut-short.ibt"));

            var mazda = Car(store, Mx5);
            Assert.That(mazda.Seen, Is.EqualTo(2), "the sessions the migration counted are not counted again");
            Assert.That(mazda.Name, Is.EqualTo("Global Mazda MX-5 Cup"), "named by the newer file, the one with no frames");
            Assert.That(mazda.ShortName, Is.EqualTo("Global MX-5"));
            Assert.That(Car(store, "lotus79").Seen, Is.EqualTo(2), "in both sessions stored from its file");
            Assert.That(Car(store, "porsche992cup").Seen, Is.Zero, "named, though its file yielded no session to count it in");
            Assert.That(Car(store, "porsche992cup").Name, Is.EqualTo("Porsche 911 GT3 Cup (992)"));
            Assert.That(store.Cars().Select(c => c.CarPath), Is.EquivalentTo(new[] { Mx5, "lotus79", "porsche992cup" }),
                "not the pace car, and nothing from the file that couldn't be read");

            Assert.That(store.FilesNeedingCarScan(), Is.Empty, "read or not, every file is marked");
            Assert.That(store.Scalar<long>("SELECT COUNT(*) FROM car_scans"), Is.EqualTo(4));
            Assert.That(store.Scalar<string>("SELECT error FROM ingested_files WHERE path LIKE '%cut-short.ibt'"), Does.StartWith("InvalidDataException"),
                "what ingest recorded about the file is left alone");

            var second = ingest.ScanCars();
            Assert.That(second.FilesScanned + second.FilesFailed + second.FilesMissing, Is.Zero, "once per file");
            Assert.That(Car(store, Mx5).Seen, Is.EqualTo(2));
        }

        [Test]
        public void HeaderReadNeedsNothingPastTheYaml()
        {
            var ibt = new SyntheticIbt(SyntheticIbt.Yaml(1, Mazda(1)), February, frames: 0, claimedFrames: 5000);
            string path = ibt.Write(Path.Combine(_dir, "header-only.ibt"), ibt.FramesOffset);

            var header = IbtFile.ReadHeader(path);
            Assert.That(header.SessionStartUtc, Is.EqualTo(February));
            Assert.That(SessionInfoYaml.ParseDriverCars(header.SessionInfoYamlText).Single().CarPath, Is.EqualTo(Mx5));

            ibt.Write(path, ibt.FramesOffset - 2);
            Assert.That(() => IbtFile.ReadHeader(path), Throws.InstanceOf<InvalidDataException>());
            ibt.Write(path, 100);
            Assert.That(() => IbtFile.ReadHeader(path), Throws.InstanceOf<InvalidDataException>());
        }

        [Test]
        public void HeaderPassWaitsWhileTheSimRuns()
        {
            string path = new SyntheticIbt(SyntheticIbt.Yaml(1, Mazda(1)), February).Write(Path.Combine(_dir, "a.ibt"));
            using (var v3 = new Version3Store(Db)) v3.Ingested(path, 0);
            using var store = new RacingDeskStore(Db);

            int asked = 0;
            var log = new List<string>();
            var scan = new IbtIngest(store, log.Add).ScanCars(pause: () => ++asked < 2);

            Assert.That(asked, Is.EqualTo(2), "asked, waited, asked again");
            Assert.That(log, Is.EqualTo(new[] { "car names: paused while iRacing is running", "car names: resumed" }));
            Assert.That(scan.FilesScanned, Is.EqualTo(1));
        }

        [Test]
        public void HeaderPassComesBackToAFileItCouldNotReach()
        {
            string held = new SyntheticIbt(SyntheticIbt.Yaml(1, PaceCar(), Mazda(1), Porsche(2)), February).Write(Path.Combine(_dir, "held.ibt"));
            string away = Path.Combine(_dir, "another-drive", "away.ibt");
            string gone = Path.Combine(_dir, "gone.ibt");
            using (var v3 = new Version3Store(Db))
            {
                v3.Session("ibt", held, 0, "2026-02-01T10:00:00.000Z", Mx5, 67, "Mazda MX-5 Cup");
                v3.Ingested(held, 1);
                v3.Ingested(away, 0);
                v3.Ingested(gone, 0);
            }

            using var store = new RacingDeskStore(Db);
            var log = new List<string>();
            var ingest = new IbtIngest(store, log.Add);

            // Another program has the first file to itself, and the folder the second was in is not there. Neither
            // says anything about the file, where a file gone from a folder that is there is gone.
            CarScanSummary first;
            using (new FileStream(held, FileMode.Open, FileAccess.Read, FileShare.None))
                first = ingest.ScanCars();

            Assert.That(first.FilesScanned, Is.Zero);
            Assert.That(first.FilesFailed, Is.Zero);
            Assert.That(first.FilesMissing, Is.EqualTo(1));
            Assert.That(first.FilesLeft, Is.EqualTo(2));
            Assert.That(store.FilesNeedingCarScan(), Is.EquivalentTo(new[] { held, away }), "only the file that is gone is marked");
            Assert.That(log, Has.Count.EqualTo(1), "one line for the pass, not one for every file");
            Assert.That(log[0], Does.StartWith("car names: 2 files left for the next pass").And.Contain("held.ibt").And.Contain("IOException"));
            Assert.That(store.Cars().Select(c => c.CarPath), Is.EqualTo(new[] { Mx5 }), "what the migration knew");

            Directory.CreateDirectory(Path.GetDirectoryName(away)!);
            new SyntheticIbt(SyntheticIbt.Yaml(1, Lotus(1)), May).Write(away);
            log.Clear();
            var second = ingest.ScanCars();

            Assert.That(second.FilesScanned, Is.EqualTo(2));
            Assert.That(second.FilesLeft, Is.Zero);
            Assert.That(log, Is.Empty);
            Assert.That(store.FilesNeedingCarScan(), Is.Empty);
            Assert.That(store.Cars().Select(c => (c.CarPath, c.Seen)), Is.EquivalentTo(new[] { (Mx5, 1), ("porsche992cup", 1), ("lotus79", 0) }));
        }

        // ── Ingest and live capture ──

        [Test]
        public void IngestStoresEachFilesCarsWithItsSessions()
        {
            string telemetry = Path.Combine(_dir, "telemetry");
            Directory.CreateDirectory(telemetry);
            new SyntheticIbt(SyntheticIbt.Yaml(1, PaceCar(), Mazda(1), Mazda(2), Lotus(3)), February).Write(Path.Combine(telemetry, "february.ibt"));
            // Another race: with February's subsession it would be February's race, written to a second file.
            string may = SyntheticIbt.Yaml(1, PaceCar(), Mazda(1, "Global Mazda MX-5 Cup", "Global MX-5")).Replace("SubSessionID: 70010001", "SubSessionID: 70050005");
            new SyntheticIbt(may, May).Write(Path.Combine(telemetry, "may.ibt"));
            new SyntheticIbt(SyntheticIbt.Yaml(1, PaceCar(), Porsche(1)), May, frames: 0).Write(Path.Combine(telemetry, "never-left-the-garage.ibt"));

            using var store = new RacingDeskStore(Db);
            var ingest = new IbtIngest(store);
            var summary = ingest.Run(telemetry);

            Assert.That(summary.FilesIngested, Is.EqualTo(3));
            Assert.That(summary.Sessions, Is.EqualTo(2));
            Assert.That(store.Cars().Select(c => (c.CarPath, c.Name, c.Driven, c.Seen)), Is.EquivalentTo(new[]
            {
                (Mx5, "Global Mazda MX-5 Cup", 2, 2),
                ("lotus79", "Lotus 79", 0, 1),
                ("porsche992cup", "Porsche 911 GT3 Cup (992)", 0, 0),
            }));
            Assert.That(store.Scalar<string>("SELECT car_path FROM sessions ORDER BY started_at LIMIT 1"), Is.EqualTo(Mx5));
            Assert.That(store.FilesNeedingCarScan(), Is.Empty, "a file ingested from now on needs no header pass");
            Assert.That(ingest.ScanCars().FilesScanned, Is.Zero);

            ingest.Run(telemetry, force: true);
            Assert.That(store.Cars().Select(c => (c.CarPath, c.Seen)), Is.EquivalentTo(new[] { (Mx5, 2), ("lotus79", 1), ("porsche992cup", 0) }),
                "reading the files again counts nothing twice");
        }

        [Test]
        public void AFileThatFailsToIngestIsStillReadForItsCarsOnce()
        {
            string path = Path.Combine(_dir, "a.ibt");
            new SyntheticIbt(SyntheticIbt.Yaml(1, Mazda(1)), February).Write(path);
            var info = new FileInfo(path);

            using var store = new RacingDeskStore(Db);
            store.SaveIngestedFile(path, info.Length, info.LastWriteTimeUtc, Array.Empty<SessionRecord>(), "YamlException: boom");
            Assert.That(store.FilesNeedingCarScan(), Is.EqualTo(new[] { path }));

            Assert.That(new IbtIngest(store).ScanCars().FilesScanned, Is.EqualTo(1));
            Assert.That(Car(store, Mx5).Seen, Is.Zero);

            // Ingest tries a failed file again on every run; that must not send the header pass back to it.
            store.SaveIngestedFile(path, info.Length, info.LastWriteTimeUtc, Array.Empty<SessionRecord>(), "YamlException: boom");
            Assert.That(store.FilesNeedingCarScan(), Is.Empty);

            store.SaveIngestedFile(path, info.Length + 1, info.LastWriteTimeUtc, Array.Empty<SessionRecord>(), "YamlException: boom");
            Assert.That(store.FilesNeedingCarScan(), Is.EqualTo(new[] { path }), "a different file under the same name is read again");
        }

        [Test]
        public void TheHostIngestsNewFilesThoughTheHeaderPassFails()
        {
            Assume.That(BackgroundIo.SimRunning(), Is.False, "the host's background thread waits while the sim runs");

            string telemetry = Path.Combine(_dir, "telemetry");
            Directory.CreateDirectory(telemetry);
            string before = new SyntheticIbt(SyntheticIbt.Yaml(1, PaceCar(), Mazda(1)), February).Write(Path.Combine(_dir, "before.ibt"));
            new SyntheticIbt(SyntheticIbt.Yaml(1, PaceCar(), Lotus(1), Mazda(2)), May).Write(Path.Combine(telemetry, "new.ibt"));
            using (var v3 = new Version3Store(Db)) v3.Ingested(before, 0);
            SqliteConnection.ClearAllPools();
            using (new RacingDeskStore(Db)) { }

            // The store refuses what the header pass writes, and nothing else.
            using (var db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = Db, Pooling = false }.ToString()))
            {
                db.Open();
                Sql(db, "CREATE TRIGGER refuse_the_header_pass BEFORE INSERT ON car_scans WHEN NEW.path LIKE '%before.ibt' BEGIN SELECT RAISE(ABORT, 'refused'); END");
            }

            using var stop = new ManualResetEventSlim();
            RacingDesk.Host.Program.BackgroundIngest(HostOptions.Parse(new[] { "--db", Db, "--dir", telemetry }), stop);

            using var store = RacingDeskStore.OpenReadOnly(Db);
            Assert.That(store.Scalar<long>("SELECT COUNT(*) FROM car_scans WHERE path LIKE '%before.ibt'"), Is.Zero, "the header pass did fail");
            Assert.That(store.Scalar<long>("SELECT COUNT(*) FROM sessions WHERE ibt_path LIKE '%new.ibt'"), Is.EqualTo(1));
            Assert.That(store.Cars().Select(c => c.CarPath), Is.EquivalentTo(new[] { "lotus79", Mx5 }));
        }

        [Test]
        public void LiveCaptureStoresTheFieldsCarsOnceHoweverOftenItCheckpoints()
        {
            string path = new SyntheticIbt(SyntheticIbt.Yaml(1, PaceCar(), Mazda(1), Lotus(2)), February, frames: 60 * 65, lapSeconds: 20)
                .Write(Path.Combine(_dir, "live.ibt"));

            using var store = new RacingDeskStore(Db);
            using var ibt = new IbtFile(path);
            var raw = new IbtRawTelemetry(ibt);
            var recorder = new LiveRecorder(store, "live", t => ibt.SessionStartUtc.AddSeconds(t));
            int checkpointed = 0;
            for (int i = 0; i < ibt.RecordCount; i++)
            {
                raw.Seek(i);
                recorder.Feed(raw);
                if (checkpointed == 0 && store.Scalar<long>("SELECT COUNT(*) FROM sessions") > 0) checkpointed = i;
            }
            Assert.That(checkpointed, Is.GreaterThan(0).And.LessThan(ibt.RecordCount - 1), "saved at a lap, before the session ended");
            recorder.Flush();

            Assert.That(store.Scalar<long>("SELECT COUNT(*) FROM sessions"), Is.EqualTo(1));
            Assert.That(store.Scalar<long>("SELECT laps_completed FROM sessions"), Is.EqualTo(3));
            Assert.That(store.Cars().Select(c => (c.CarPath, c.Driven, c.Seen)), Is.EquivalentTo(new[] { (Mx5, 1, 1), ("lotus79", 0, 1) }));
        }

        // ── /racing-desk/data/cars ──

        private static string CarsJson(RacingDeskStore store)
        {
            using var buffer = new MemoryStream();
            using (var json = new Utf8JsonWriter(buffer)) store.WriteCarsJson(json);
            return Encoding.UTF8.GetString(buffer.ToArray());
        }

        private static int FreePort()
        {
            var l = new TcpListener(IPAddress.Loopback, 0);
            l.Start();
            int port = ((IPEndPoint)l.LocalEndpoint).Port;
            l.Stop();
            return port;
        }

        /// <summary>One GET through the host's data API, served the way the runtime hands it requests.</summary>
        private static (HttpStatusCode Status, string Body) Get(string dbPath, string route)
        {
            int port = FreePort();
            using var listener = new HttpListener();
            listener.Prefixes.Add($"http://127.0.0.1:{port}/racing-desk/"); // not localhost: HTTP.sys binds that on every address
            listener.Start();
            var api = new LocalDataApi(dbPath);
            var claimed = Task.Run(() => api.TryHandle(listener.GetContext()));

            using var http = new HttpClient();
            using var response = http.GetAsync($"http://127.0.0.1:{port}/racing-desk/data/{route}").Result;
            string body = response.Content.ReadAsStringAsync().Result;
            Assert.That(claimed.Result, Is.True, "the data API claims /data/ routes");
            return (response.StatusCode, body);
        }

        [Test]
        public void ServesTheCarsContract()
        {
            using (var store = new RacingDeskStore(Db))
                store.SaveSession(Session(February, Mazda(1), Mazda(2)));

            var (status, body) = Get(Db, "cars");

            Assert.That(status, Is.EqualTo(HttpStatusCode.OK));
            Assert.That(body, Is.EqualTo(
                "[{\"car_path\":\"mx5 mx52016\",\"name\":\"Mazda MX-5 Cup\",\"short_name\":\"MX-5 Cup\",\"car_id\":67,\"driven\":1,\"seen\":1}]"));
        }

        [Test]
        public void ServesCarsByNameWhateverItsCase()
        {
            using (var store = new RacingDeskStore(Db))
            {
                store.SaveSession(Session(February, Mazda(1), Lotus(2), Porsche(3),
                    new Entrant(4, "bmwm4gt3", "BMW M4 GT3", "M4 GT3", 132),
                    new Entrant(5, "bmwm2csr", "bmw M2 CS Racing", "", 0),
                    new Entrant(6, "astonmartin dbr9", "Aston Martin DBR9 GT1", "DBR9", 18)));
                store.SaveSession(Session(May, Mazda(1), Lotus(2)));
            }

            var (status, body) = Get(Db, "cars");
            Assert.That(status, Is.EqualTo(HttpStatusCode.OK));

            using var json = JsonDocument.Parse(body);
            var cars = json.RootElement.EnumerateArray().ToList();
            Assert.That(cars.Select(c => c.GetProperty("name").GetString()), Is.EqualTo(new[]
            {
                "Aston Martin DBR9 GT1", "bmw M2 CS Racing", "BMW M4 GT3", "Lotus 79", "Mazda MX-5 Cup", "Porsche 911 GT3 Cup (992)",
            }));
            foreach (var car in cars)
                Assert.That(car.EnumerateObject().Select(p => p.Name), Is.EqualTo(new[] { "car_path", "name", "short_name", "car_id", "driven", "seen" }));

            var mazda = cars.Single(c => c.GetProperty("car_path").GetString() == Mx5);
            Assert.That(mazda.GetProperty("driven").GetInt32(), Is.EqualTo(2));
            Assert.That(mazda.GetProperty("seen").GetInt32(), Is.EqualTo(2));
            var lotus = cars.Single(c => c.GetProperty("car_path").GetString() == "lotus79");
            Assert.That(lotus.GetProperty("driven").GetInt32(), Is.Zero, "0, not null, for a car never driven");
            Assert.That(lotus.GetProperty("seen").GetInt32(), Is.EqualTo(2));
            var bmw = cars.Single(c => c.GetProperty("car_path").GetString() == "bmwm2csr");
            Assert.That(bmw.GetProperty("short_name").ValueKind, Is.EqualTo(JsonValueKind.Null));
            Assert.That(bmw.GetProperty("car_id").ValueKind, Is.EqualTo(JsonValueKind.Null));

            var (_, statusBody) = Get(Db, "status");
            using var statusJson = JsonDocument.Parse(statusBody);
            Assert.That(statusJson.RootElement.GetProperty("cars").GetInt32(), Is.EqualTo(6));
            Assert.That(statusJson.RootElement.GetProperty("schemaVersion").GetInt32(), Is.EqualTo(RacingDeskStore.SchemaVersion));
        }

        // ── RacingDesk.Host cars ──

        [Test]
        public void CarsCommandScansAndListsNamePathDrivenAndSeen()
        {
            string whole = new SyntheticIbt(SyntheticIbt.Yaml(1, PaceCar(), Mazda(1), Lotus(2)), February).Write(Path.Combine(_dir, "whole.ibt"));
            using (var v3 = new Version3Store(Db))
            {
                v3.Session("ibt", whole, 0, "2026-02-01T10:00:00.000Z", Mx5, 67, "Mazda MX-5 Cup");
                v3.Ingested(whole, 1);
            }
            SqliteConnection.ClearAllPools();

            var listed = new StringWriter();
            Assert.That(CarsCommand.Run(HostOptions.Parse(new[] { "cars", "--db", Db }), listed), Is.Zero);
            var lines = listed.ToString().Split('\n').Select(l => l.Trim()).Where(l => l.Length > 0).ToList();
            Assert.That(lines[0], Does.StartWith("1 cars in "));
            Assert.That(lines[1], Does.Match(@"^Mazda MX-5 Cup\s+mx5 mx52016\s+1 driven\s+1 seen$"));
            SqliteConnection.ClearAllPools();

            var scanned = new StringWriter();
            Assert.That(CarsCommand.Run(HostOptions.Parse(new[] { "cars", "--scan", "--now", "--db", Db }), scanned), Is.Zero);
            lines = scanned.ToString().Split('\n').Select(l => l.Trim()).Where(l => l.Length > 0).ToList();
            Assert.That(lines[0], Does.StartWith("car names: 1 headers read, 2 cars, 0 files gone, 0 unreadable"));
            Assert.That(lines[1], Does.StartWith("2 cars in "));
            Assert.That(lines[2], Does.Match(@"^Lotus 79\s+lotus79\s+0 driven\s+1 seen$"));
            Assert.That(lines[3], Does.Match(@"^Mazda MX-5 Cup\s+mx5 mx52016\s+1 driven\s+1 seen$"));
        }
    }
}
