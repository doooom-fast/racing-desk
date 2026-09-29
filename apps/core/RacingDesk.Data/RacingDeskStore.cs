using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using Microsoft.Data.Sqlite;

namespace RacingDesk.Data
{
    /// <summary>
    /// The local store: %LOCALAPPDATA%\RacingDesk\racing-desk.db. Single writer (the host), WAL so the Electron app
    /// can read concurrently. Sessions are keyed by <c>source_key</c>, so re-ingesting a file or re-saving a
    /// live session replaces its rows instead of duplicating them.
    /// </summary>
    public sealed class RacingDeskStore : IDisposable
    {
        public const int SchemaVersion = 6;

        // Car names by iRacing's folder name for the car (schema v4). session_cars is which stored session had
        // which car in its entry list. cars.seen counts the sessions among them, not the rows: a session is
        // stored once as it is driven and once more for each .ibt file it was written to (see EventOf).
        private const string CarsSchema = @"
CREATE TABLE cars (
  car_path TEXT PRIMARY KEY, name TEXT NOT NULL, short_name TEXT, car_id INTEGER,
  seen INTEGER NOT NULL DEFAULT 0, first_seen_at TEXT, last_seen_at TEXT
);

CREATE TABLE session_cars (
  session_id                INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  car_path                  TEXT NOT NULL,
  PRIMARY KEY (session_id, car_path)
);
CREATE INDEX session_cars_car ON session_cars(car_path);
CREATE INDEX sessions_ibt_path ON sessions(ibt_path);
";

        // The cars the driver has driven are named by the sessions already stored.
        private const string SeedCars = @"
INSERT INTO cars (car_path, name, car_id, seen, first_seen_at, last_seen_at)
SELECT s.car_path,
  (SELECT TRIM(n.car_screen_name) FROM sessions n WHERE n.car_path = s.car_path AND TRIM(COALESCE(n.car_screen_name, '')) <> ''
    ORDER BY n.started_at DESC, n.id DESC LIMIT 1),
  (SELECT NULLIF(n.car_id, 0) FROM sessions n WHERE n.car_path = s.car_path AND TRIM(COALESCE(n.car_screen_name, '')) <> ''
    ORDER BY n.started_at DESC, n.id DESC LIMIT 1),
  0, NULL, NULL
FROM sessions s
WHERE TRIM(COALESCE(s.car_path, '')) <> '' AND TRIM(COALESCE(s.car_screen_name, '')) <> ''
GROUP BY s.car_path;

INSERT INTO session_cars (session_id, car_path)
SELECT id, car_path FROM sessions WHERE car_path IN (SELECT car_path FROM cars);

UPDATE cars SET
  seen = (SELECT COUNT(*) FROM session_cars sc WHERE sc.car_path = cars.car_path),
  first_seen_at = (SELECT MIN(s.started_at) FROM sessions s WHERE s.car_path = cars.car_path),
  last_seen_at = (SELECT MAX(s.started_at) FROM sessions s WHERE s.car_path = cars.car_path);
";

        // Which session of which event a row of `sessions s` is, as the desk's calc layer has it. A session driven
        // live and then read from its .ibt is two rows, and one written to several files (a tow, a rejoin) is
        // one a file: all the same session. An offline session has no subsession id, and each row stands alone.
        private const string EventOf =
            "CASE WHEN s.subsession_id > 0 THEN s.subsession_id || ':' || s.session_num ELSE 'row:' || s.id END";

        private const string SeenCount =
            "(SELECT COUNT(DISTINCT " + EventOf + ") FROM session_cars sc JOIN sessions s ON s.id = sc.session_id WHERE sc.car_path = ";

        private const string CarsQuery = @"SELECT c.car_path, c.name, c.short_name, c.car_id, COALESCE(d.driven, 0) AS driven, c.seen
FROM cars c LEFT JOIN (SELECT s.car_path, COUNT(DISTINCT " + EventOf + @") AS driven FROM sessions s GROUP BY s.car_path) d
  ON d.car_path = c.car_path
ORDER BY c.name COLLATE NOCASE, c.car_path";

        // Which files the header pass has read (schema v5), by what the file was when it did: a file that has
        // changed since is read again. A table of its own, so ingested_files stays as every host since the first
        // has known it, and an earlier build can still ingest into a store a later one has opened.
        private const string CarScansSchema = @"
CREATE TABLE car_scans (path TEXT PRIMARY KEY, length INTEGER, mtime TEXT);
";

        // What is remembered per car for the rig (schema v5).
        //
        // car_views: the view a car was driven with. iRacing keeps one height and horizon for every car, so a
        // value nobody touched may only be what the last car left behind; chosen is 1 once the driver has changed
        // the view while in this car, and a chosen view is not replaced by one that was merely inherited. The
        // seat is the cockpit camera's offset in the car's own car.cam, which is per car already.
        //
        // car_pedals: which of SmartControl's profiles a car is driven with, and that profile byte for byte as
        // it was when the car was given it.
        private const string RigSchema = @"
CREATE TABLE car_views (
  car_path TEXT PRIMARY KEY,
  driver_height REAL, vanish_y REAL, head_horizon REAL, fov REAL,
  seat_x REAL, seat_y REAL, seat_z REAL,
  chosen INTEGER NOT NULL DEFAULT 0, chosen_at TEXT, seen_at TEXT NOT NULL
);

CREATE TABLE car_pedals (
  car_path TEXT PRIMARY KEY,
  profile_id TEXT, profile_name TEXT NOT NULL, profile BLOB,
  brake_force_kg REAL, bound_at TEXT NOT NULL
);
";

        // What is known of a car's pedals beside its profile (schema v6). A force is the car's whether or not
        // it has a profile yet, so it is kept here and not only in car_pedals, which cannot hold one without.
        // abs_seen is 1 once the car has published an ABS setting or its ABS has been seen working, and
        // laps_without counts the laps driven before that: three of them and the car is taken to have none,
        // until it is seen after all. given_by is who gave the car its profile — 'rule', 'driver', or 'none'
        // when the driver chose that it has none — and given_why what the rule went by.
        private const string PedalFactsSchema = @"
CREATE TABLE car_pedal_facts (
  car_path TEXT PRIMARY KEY,
  force_kg REAL, force_at TEXT,
  abs_seen INTEGER NOT NULL DEFAULT 0, laps_without INTEGER NOT NULL DEFAULT 0,
  given_by TEXT, given_why TEXT,
  seen_at TEXT NOT NULL
);
";

        private readonly SqliteConnection _db;

        // Statements the header pass runs tens of thousands of times: prepared once, kept until the store closes.
        private readonly Dictionary<string, SqliteCommand> _kept = new Dictionary<string, SqliteCommand>(StringComparer.Ordinal);

        public string Path { get; }

        public static string DefaultPath => DataFolder.DbPath;

        public RacingDeskStore(string path) : this(path, readOnly: false) { }

        private RacingDeskStore(string path, bool readOnly)
        {
            Path = path;
            if (!readOnly) Directory.CreateDirectory(System.IO.Path.GetDirectoryName(path));
            _db = new SqliteConnection(new SqliteConnectionStringBuilder
            {
                DataSource = path,
                Mode = readOnly ? SqliteOpenMode.ReadOnly : SqliteOpenMode.ReadWriteCreate,
            }.ToString());
            try
            {
                _db.Open();
                if (readOnly) return;
                Exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;");
                Migrate();
            }
            catch
            {
                // Nobody gets a store to dispose of, so the connection would hold the file for as long as the
                // process lives.
                _db.Dispose();
                throw;
            }
        }

        /// <summary>A reader for queries (the data API); never migrates or writes.</summary>
        public static RacingDeskStore OpenReadOnly(string path) => new RacingDeskStore(path, readOnly: true);

        public void Dispose()
        {
            foreach (var cmd in _kept.Values) cmd.Dispose();
            _kept.Clear();
            _db.Dispose();
        }

        private const string StoredVersion = "SELECT COALESCE(MAX(version), 0) FROM schema_version";

        private void Migrate()
        {
            Exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
            long current = Scalar<long>(StoredVersion);
            if (current >= SchemaVersion) return;

            // One step per version, so a store from any earlier version catches up in one open.
            while (current > 0 && current < SchemaVersion)
            {
                using var step = _db.BeginTransaction();
                // The version is only certain once the write lock is held: another opener — a `cars` or `ingest`
                // run beside the host — may have taken this step while this one waited for the lock.
                long held = Scalar<long>(StoredVersion, step);
                if (held != current)
                {
                    current = held;
                    continue;
                }
                switch (current)
                {
                    case 1:
                        // Session category. Rows ingested under v1 get it on the next 'ingest'.
                        Exec("ALTER TABLE sessions ADD COLUMN category TEXT", step);
                        break;
                    case 2:
                        // The season schedule, parsed from iRacing's published PDF.
                        Exec(Schedule.ScheduleStore.Schema, step);
                        break;
                    case 3:
                        // Car names. Everyone else's cars come from the headers of the files already
                        // ingested (IbtIngest.ScanCars), which is what cars_scanned keeps track of.
                        Exec(CarsSchema, step);
                        Exec("ALTER TABLE ingested_files ADD COLUMN cars_scanned INTEGER NOT NULL DEFAULT 0", step);
                        Exec(SeedCars, step);
                        break;
                    case 4:
                        // The header pass's marks move to a table of their own and ingested_files goes back to
                        // what it was; cars are counted by session, not by row; the view and the pedals per car.
                        Exec(CarScansSchema, step);
                        Exec("INSERT INTO car_scans (path, length, mtime) SELECT path, length, mtime FROM ingested_files WHERE cars_scanned = 1", step);
                        Exec("ALTER TABLE ingested_files DROP COLUMN cars_scanned", step);
                        Exec("UPDATE cars SET seen = " + SeenCount + "cars.car_path)", step);
                        Exec(RigSchema, step);
                        break;
                    case 5:
                        // What is known of a car's pedals beside its profile. The profiles there are were
                        // given on the desk, and a force kept with one is the car's still.
                        Exec(PedalFactsSchema, step);
                        Exec(@"INSERT INTO car_pedal_facts (car_path, force_kg, force_at, given_by, seen_at)
SELECT car_path, brake_force_kg, CASE WHEN brake_force_kg IS NOT NULL THEN bound_at END, 'driver', bound_at FROM car_pedals", step);
                        break;
                }
                current++;
                Exec("INSERT INTO schema_version(version) VALUES (" + current + ")", step);
                step.Commit();
            }
            if (current >= SchemaVersion) return;

            using var tx = _db.BeginTransaction();
            if (Scalar<long>(StoredVersion, tx) > 0)
            {
                // Created by another opener in the meantime; whatever version it made, carry on from there.
                tx.Rollback();
                Migrate();
                return;
            }
            Exec(@"
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
", tx);
            Exec(Schedule.ScheduleStore.Schema, tx);
            Exec(CarsSchema, tx);
            Exec(CarScansSchema, tx);
            Exec(RigSchema, tx);
            Exec(PedalFactsSchema, tx);
            Exec("INSERT INTO schema_version(version) VALUES (" + SchemaVersion + ")", tx);
            tx.Commit();
        }

        /// <summary>The stored season schedule as JSON (see RacingDesk.Data.Schedule.ScheduleStore).</summary>
        public void WriteScheduleJson(System.Text.Json.Utf8JsonWriter json) => Schedule.ScheduleStore.WriteJson(this, json);

        public static string SourceKey(SessionRecord s) =>
            s.Source == "ibt"
                ? "ibt|" + s.IbtPath + "|" + s.SessionNum.ToString(CultureInfo.InvariantCulture)
                : s.Source + "|" + s.StartedAtUtc.ToString("o", CultureInfo.InvariantCulture) + "|" + s.SessionNum.ToString(CultureInfo.InvariantCulture);

        /// <summary>Inserts or replaces a session with its laps, incidents and grid. Returns its row id.</summary>
        public long SaveSession(SessionRecord s)
        {
            using var tx = _db.BeginTransaction();
            var cars = new HashSet<string>(StringComparer.Ordinal);
            long id = SaveSession(s, tx, cars);
            RecountCars(cars, tx);
            tx.Commit();
            return id;
        }

        /// <param name="cars">Collects the cars whose count this changes, for <see cref="RecountCars"/>.</param>
        private long SaveSession(SessionRecord s, SqliteTransaction tx, HashSet<string> cars)
        {
            string key = SourceKey(s);
            CarsOfSessions("s.source_key = $k", cars, tx, ("$k", key));
            Exec("DELETE FROM sessions WHERE source_key = $k", tx, ("$k", key));

            using (var cmd = Cmd(@"
INSERT INTO sessions (source_key, source, ibt_path, session_num, subsession_id, session_id, series_id, season_id, race_week,
  event_type, session_type, official, category, track_id, track_name, track_display_name, track_config, track_length_km,
  car_path, car_id, car_screen_name, car_class_id, started_at, duration_s, driver_cust_id, driver_name, irating, license,
  safety_rating, laps_completed, best_lap_s, incidents, start_position, finish_position, finish_position_in_class,
  field_size, sof, saved_at)
VALUES ($key, $source, $ibt, $num, $sub, $sid, $series, $season, $week, $event, $stype, $official, $category, $track, $tname, $tdisp,
  $tconf, $tlen, $carpath, $carid, $carname, $carclass, $started, $dur, $cust, $driver, $ir, $lic, $sr, $laps, $best,
  $inc, $startpos, $finpos, $finclass, $field, $sof, $saved);
SELECT last_insert_rowid();", tx))
            {
                P(cmd, "$key", key); P(cmd, "$source", s.Source); P(cmd, "$ibt", s.IbtPath); P(cmd, "$num", s.SessionNum);
                P(cmd, "$sub", s.SubsessionId); P(cmd, "$sid", s.SessionId); P(cmd, "$series", s.SeriesId); P(cmd, "$season", s.SeasonId);
                P(cmd, "$week", s.RaceWeek); P(cmd, "$event", s.EventType); P(cmd, "$stype", s.SessionType); P(cmd, "$official", s.Official ? 1 : 0); P(cmd, "$category", s.Category);
                P(cmd, "$track", s.TrackId); P(cmd, "$tname", s.TrackName); P(cmd, "$tdisp", s.TrackDisplayName); P(cmd, "$tconf", s.TrackConfig);
                P(cmd, "$tlen", s.TrackLengthKm); P(cmd, "$carpath", s.CarPath); P(cmd, "$carid", s.CarId); P(cmd, "$carname", s.CarScreenName);
                P(cmd, "$carclass", s.CarClassId); P(cmd, "$started", Iso(s.StartedAtUtc)); P(cmd, "$dur", s.DurationSeconds);
                P(cmd, "$cust", s.DriverCustId); P(cmd, "$driver", s.DriverName); P(cmd, "$ir", s.IRating); P(cmd, "$lic", s.License);
                P(cmd, "$sr", s.SafetyRating); P(cmd, "$laps", s.LapsCompleted); P(cmd, "$best", s.BestLapSeconds); P(cmd, "$inc", s.Incidents);
                P(cmd, "$startpos", s.StartPosition); P(cmd, "$finpos", s.FinishPosition); P(cmd, "$finclass", s.FinishPositionInClass);
                P(cmd, "$field", s.FieldSize); P(cmd, "$sof", s.StrengthOfField); P(cmd, "$saved", Iso(DateTime.UtcNow));
                s.Id = (long)cmd.ExecuteScalar();
            }

            using (var cmd = Cmd("INSERT INTO laps VALUES ($s, $lap, $t, $clean, $inc, $fuel, $pit, $start, $pos)", tx))
            {
                foreach (var name in new[] { "$s", "$lap", "$t", "$clean", "$inc", "$fuel", "$pit", "$start", "$pos" }) cmd.Parameters.Add(new SqliteParameter(name, null));
                foreach (var l in s.Laps.GroupBy(x => x.Lap).Select(g => g.Last()))
                {
                    Set(cmd, s.Id, l.Lap, l.LapTimeSeconds, l.Clean ? 1 : 0, l.Incidents, l.FuelUsedLiters, l.Pitted ? 1 : 0, l.StartSessionTime, l.Position);
                    cmd.ExecuteNonQuery();
                }
            }
            using (var cmd = Cmd("INSERT INTO incidents VALUES ($s, $t, $lap, $pct, $pts)", tx))
            {
                foreach (var name in new[] { "$s", "$t", "$lap", "$pct", "$pts" }) cmd.Parameters.Add(new SqliteParameter(name, null));
                foreach (var i in s.IncidentEvents)
                {
                    Set(cmd, s.Id, i.SessionTime, i.Lap, i.LapDistPct, i.Points);
                    cmd.ExecuteNonQuery();
                }
            }
            using (var cmd = Cmd("INSERT INTO grid_entries VALUES ($s, $idx, $cust, $name, $ir, $lic, $cls, $car, $fin, $clspos, $laps, $fast, $inc, $out, $me)", tx))
            {
                foreach (var name in new[] { "$s", "$idx", "$cust", "$name", "$ir", "$lic", "$cls", "$car", "$fin", "$clspos", "$laps", "$fast", "$inc", "$out", "$me" }) cmd.Parameters.Add(new SqliteParameter(name, null));
                foreach (var g in s.Grid)
                {
                    Set(cmd, s.Id, g.CarIdx, g.CustId, g.Name, g.IRating, g.License, g.CarClassId, g.CarScreenName, g.FinishPosition,
                        g.ClassPosition, g.LapsComplete, g.FastestLapSeconds, g.Incidents, g.ReasonOut, g.IsPlayer ? 1 : 0);
                    cmd.ExecuteNonQuery();
                }
            }
            string startedAt = Iso(s.StartedAtUtc);
            foreach (var car in s.Cars)
            {
                if (!SaveCar(car, startedAt, startedAt, tx)) continue;
                ExecKept("INSERT OR IGNORE INTO session_cars VALUES ($s, $p)", tx, ("$s", s.Id), ("$p", car.CarPath));
                cars.Add(car.CarPath);
            }
            return s.Id;
        }

        /// <summary>
        /// Names a car. The newest sighting names it — iRacing renames cars — whatever order the sessions are
        /// stored in, and first and last seen only ever widen. False for a car with no folder name or no name.
        /// </summary>
        /// <param name="firstSeenAt">When the earliest of the sessions it is being stored with started.</param>
        /// <param name="lastSeenAt">When the latest of them did.</param>
        private bool SaveCar(CarRecord car, string firstSeenAt, string lastSeenAt, SqliteTransaction tx)
        {
            if (car == null || string.IsNullOrWhiteSpace(car.CarPath) || string.IsNullOrWhiteSpace(car.Name)) return false;
            ExecKept(@"
INSERT INTO cars (car_path, name, short_name, car_id, seen, first_seen_at, last_seen_at)
VALUES ($path, $name, $short, $id, 0, $first, $last)
ON CONFLICT(car_path) DO UPDATE SET
  name = CASE WHEN excluded.last_seen_at >= COALESCE(cars.last_seen_at, '') THEN excluded.name ELSE cars.name END,
  short_name = CASE WHEN excluded.last_seen_at >= COALESCE(cars.last_seen_at, '')
    THEN COALESCE(excluded.short_name, cars.short_name) ELSE COALESCE(cars.short_name, excluded.short_name) END,
  car_id = CASE WHEN excluded.last_seen_at >= COALESCE(cars.last_seen_at, '')
    THEN COALESCE(excluded.car_id, cars.car_id) ELSE COALESCE(cars.car_id, excluded.car_id) END,
  first_seen_at = MIN(COALESCE(cars.first_seen_at, excluded.first_seen_at), excluded.first_seen_at),
  last_seen_at = MAX(COALESCE(cars.last_seen_at, excluded.last_seen_at), excluded.last_seen_at)", tx,
                ("$path", car.CarPath), ("$name", car.Name), ("$short", string.IsNullOrWhiteSpace(car.ShortName) ? null : car.ShortName),
                ("$id", car.CarId > 0 ? (object)car.CarId : null), ("$first", firstSeenAt), ("$last", lastSeenAt));
            return true;
        }

        /// <summary>Adds the cars of the sessions matching <paramref name="where"/> (over <c>sessions s</c>).</summary>
        private void CarsOfSessions(string where, HashSet<string> cars, SqliteTransaction tx, params (string, object)[] args)
        {
            using var cmd = Cmd("SELECT DISTINCT sc.car_path FROM session_cars sc JOIN sessions s ON s.id = sc.session_id WHERE " + where, tx);
            foreach (var (n, v) in args) P(cmd, n, v);
            using var r = cmd.ExecuteReader();
            while (r.Read()) cars.Add(r.GetString(0));
        }

        private void RecountCars(IEnumerable<string> carPaths, SqliteTransaction tx)
        {
            foreach (string path in carPaths)
                ExecKept("UPDATE cars SET seen = " + SeenCount + "$p) WHERE car_path = $p", tx, ("$p", path));
        }

        public bool IsIngested(string path, long length, DateTime mtimeUtc)
        {
            using var cmd = Cmd("SELECT 1 FROM ingested_files WHERE path = $p AND length = $l AND mtime = $m AND error IS NULL");
            P(cmd, "$p", path); P(cmd, "$l", length); P(cmd, "$m", Iso(mtimeUtc));
            return cmd.ExecuteScalar() != null;
        }

        /// <summary>Stores a file's sessions and marks it ingested, atomically.</summary>
        /// <param name="cars">The cars in the file's header: named even when the file yields no session.</param>
        /// <param name="recordedAtUtc">When the file was recorded, for cars it names without a session.</param>
        public void SaveIngestedFile(string path, long length, DateTime mtimeUtc, IReadOnlyList<SessionRecord> sessions, string error,
            IReadOnlyList<CarRecord> cars = null, DateTime? recordedAtUtc = null)
        {
            using var tx = _db.BeginTransaction();
            var recount = new HashSet<string>(StringComparer.Ordinal);
            // Replace everything previously read from this file, including sessions it no longer yields.
            CarsOfSessions("s.source = 'ibt' AND s.ibt_path = $p", recount, tx, ("$p", path));
            Exec("DELETE FROM sessions WHERE source = 'ibt' AND ibt_path = $p", tx, ("$p", path));
            foreach (var s in sessions) SaveSession(s, tx, recount);
            if (sessions.Count == 0 && cars != null)
            {
                string recordedAt = Iso(recordedAtUtc ?? mtimeUtc);
                foreach (var car in cars) SaveCar(car, recordedAt, recordedAt, tx);
            }
            RecountCars(recount, tx);
            Exec("INSERT OR REPLACE INTO ingested_files (path, length, mtime, sessions, error, ingested_at) VALUES ($p, $l, $m, $n, $e, $at)", tx,
                ("$p", path), ("$l", length), ("$m", Iso(mtimeUtc)), ("$n", sessions.Count), ("$e", error), ("$at", Iso(DateTime.UtcNow)));
            // A file that was read has its cars stored with its sessions, so the header pass has nothing to add.
            // One that failed keeps what that pass made of it, for as long as it is the same file.
            if (error == null)
                Exec("INSERT OR REPLACE INTO car_scans (path, length, mtime) VALUES ($p, $l, $m)", tx,
                    ("$p", path), ("$l", length), ("$m", Iso(mtimeUtc)));
            tx.Commit();
        }

        /// <summary>
        /// Files whose headers are still to be read, oldest first: ingested before the store kept cars, or by a
        /// build from before it did, or changed since they were read.
        /// </summary>
        public IReadOnlyList<string> FilesNeedingCarScan()
        {
            using var cmd = Cmd(@"SELECT f.path FROM ingested_files f
LEFT JOIN car_scans c ON c.path = f.path AND c.length IS f.length AND c.mtime IS f.mtime
WHERE c.path IS NULL ORDER BY f.mtime, f.path");
            using var r = cmd.ExecuteReader();
            var list = new List<string>();
            while (r.Read()) list.Add(r.GetString(0));
            return list;
        }

        /// <summary>
        /// What the header pass made of some files: names their cars, counts them into every session stored from
        /// the file they were in, and marks each file scanned, read or not — atomically, and in one write, which
        /// is what keeps the pass to seconds while its thread is at background I/O priority.
        /// </summary>
        public void SaveScannedCars(IReadOnlyList<ScannedFile> files)
        {
            using var tx = _db.BeginTransaction();
            using var sessions = Cmd("SELECT MIN(started_at), MAX(started_at) FROM sessions WHERE ibt_path = $p AND source = 'ibt'", tx);
            sessions.Parameters.Add(new SqliteParameter("$p", null));
            var recount = new HashSet<string>(StringComparer.Ordinal);
            foreach (var file in files)
            {
                if (file.Cars != null && file.Cars.Count > 0)
                {
                    bool stored;
                    string first, last;
                    sessions.Parameters[0].Value = file.Path;
                    using (var r = sessions.ExecuteReader())
                    {
                        stored = r.Read() && !r.IsDBNull(0);
                        first = stored ? r.GetString(0) : Iso(file.RecordedAtUtc);
                        last = stored ? r.GetString(1) : first;
                    }
                    foreach (var car in file.Cars)
                    {
                        if (!SaveCar(car, first, last, tx) || !stored) continue;
                        ExecKept("INSERT OR IGNORE INTO session_cars (session_id, car_path) SELECT id, $c FROM sessions WHERE ibt_path = $p AND source = 'ibt'", tx,
                            ("$c", car.CarPath), ("$p", file.Path));
                        recount.Add(car.CarPath);
                    }
                }
                ExecKept("INSERT OR REPLACE INTO car_scans (path, length, mtime) SELECT path, length, mtime FROM ingested_files WHERE path = $p", tx,
                    ("$p", file.Path));
            }
            RecountCars(recount, tx);
            tx.Commit();
        }

        /// <summary>False for a store last opened by a version that kept no cars (a read-only open doesn't migrate).</summary>
        private bool HasCars => Scalar<long>("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'cars'") > 0;

        public long CarCount() => HasCars ? Scalar<long>("SELECT COUNT(*) FROM cars") : 0;

        /// <summary>
        /// Every car with a name, by name: <c>driven</c> is the driver's own stored sessions in it, <c>seen</c> the
        /// stored sessions it was entered in.
        /// </summary>
        public IReadOnlyList<CarSummary> Cars()
        {
            var list = new List<CarSummary>();
            if (!HasCars) return list;
            using var cmd = Cmd(CarsQuery);
            using var r = cmd.ExecuteReader();
            while (r.Read())
                list.Add(new CarSummary
                {
                    CarPath = r.GetString(0), Name = r.GetString(1), ShortName = Str(r, 2),
                    CarId = r.IsDBNull(3) ? (int?)null : r.GetInt32(3), Driven = r.GetInt32(4), Seen = r.GetInt32(5),
                });
            return list;
        }

        /// <summary>The same rows as JSON, keyed by column name — what the desk's Paints page reads.</summary>
        public void WriteCarsJson(System.Text.Json.Utf8JsonWriter json)
        {
            if (HasCars)
            {
                WriteJson(json, CarsQuery);
                return;
            }
            json.WriteStartArray();
            json.WriteEndArray();
        }

        private bool HasTable(string name)
        {
            using var cmd = Cmd("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = $n");
            P(cmd, "$n", name);
            return cmd.ExecuteScalar() != null;
        }

        /// <summary>
        /// Remembers the view a car was driven with. A view the driver chose in this car replaces what is there;
        /// one that was only inherited fills in for a car that has none of its own, and never replaces a chosen
        /// one. The seat is the car's own either way. False for a view with no car.
        /// </summary>
        public bool SaveCarView(CarView view)
        {
            if (view == null || string.IsNullOrWhiteSpace(view.CarPath)) return false;
            Exec(@"
INSERT INTO car_views (car_path, driver_height, vanish_y, head_horizon, fov, seat_x, seat_y, seat_z, chosen, chosen_at, seen_at)
VALUES ($car, $height, $vanish, $horizon, $fov, $x, $y, $z, $chosen, CASE WHEN $chosen = 1 THEN $at END, $at)
ON CONFLICT(car_path) DO UPDATE SET
  driver_height = CASE WHEN excluded.chosen = 1 OR car_views.chosen = 0 THEN excluded.driver_height ELSE car_views.driver_height END,
  vanish_y = CASE WHEN excluded.chosen = 1 OR car_views.chosen = 0 THEN excluded.vanish_y ELSE car_views.vanish_y END,
  head_horizon = CASE WHEN excluded.chosen = 1 OR car_views.chosen = 0 THEN excluded.head_horizon ELSE car_views.head_horizon END,
  fov = excluded.fov, seat_x = excluded.seat_x, seat_y = excluded.seat_y, seat_z = excluded.seat_z,
  chosen = MAX(car_views.chosen, excluded.chosen),
  chosen_at = COALESCE(excluded.chosen_at, car_views.chosen_at),
  seen_at = excluded.seen_at", null,
                ("$car", view.CarPath.Trim()), ("$height", view.DriverHeight), ("$vanish", view.VanishY), ("$horizon", view.HeadHorizon),
                ("$fov", view.Fov), ("$x", view.SeatX), ("$y", view.SeatY), ("$z", view.SeatZ),
                ("$chosen", view.Chosen ? 1 : 0), ("$at", Iso(view.SeenAtUtc)));
            return true;
        }

        private const string CarViewsQuery = @"SELECT v.car_path, c.name, v.driver_height, v.vanish_y, v.head_horizon, v.fov,
  v.seat_x, v.seat_y, v.seat_z, v.chosen, v.chosen_at, v.seen_at
FROM car_views v LEFT JOIN cars c ON c.car_path = v.car_path
ORDER BY COALESCE(c.name, v.car_path) COLLATE NOCASE, v.car_path";

        /// <summary>The view remembered for each car, by the car's name; [] from a store that keeps none yet.</summary>
        public void WriteCarViewsJson(System.Text.Json.Utf8JsonWriter json)
        {
            if (HasTable("car_views") && HasCars)
            {
                WriteJson(json, CarViewsQuery);
                return;
            }
            json.WriteStartArray();
            json.WriteEndArray();
        }

        public CarView CarViewOf(string carPath)
        {
            if (string.IsNullOrWhiteSpace(carPath) || !HasTable("car_views")) return null;
            using var cmd = Cmd(@"SELECT car_path, driver_height, vanish_y, head_horizon, fov, seat_x, seat_y, seat_z, chosen, seen_at
FROM car_views WHERE car_path = $car");
            P(cmd, "$car", carPath.Trim());
            using var r = cmd.ExecuteReader();
            if (!r.Read()) return null;
            double? Real(int i) => r.IsDBNull(i) ? (double?)null : r.GetDouble(i);
            return new CarView
            {
                CarPath = r.GetString(0), DriverHeight = Real(1), VanishY = Real(2), HeadHorizon = Real(3), Fov = Real(4),
                SeatX = Real(5), SeatY = Real(6), SeatZ = Real(7), Chosen = r.GetInt32(8) != 0,
                SeenAtUtc = DateTime.Parse(r.GetString(9), CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal),
            };
        }

        /// <summary>
        /// Gives a car one of SmartControl's profiles, kept as it is now, in place of the one it had. The brake
        /// force the car was driven with stays: it is the car's, whichever profile it starts from. False without
        /// a car or a profile's name.
        /// </summary>
        public bool BindCarPedals(CarPedals pedals)
        {
            if (pedals == null || string.IsNullOrWhiteSpace(pedals.CarPath) || string.IsNullOrWhiteSpace(pedals.ProfileName)) return false;
            Exec(@"
INSERT INTO car_pedals (car_path, profile_id, profile_name, profile, brake_force_kg, bound_at)
VALUES ($car, $id, $name, $profile, $force, $at)
ON CONFLICT(car_path) DO UPDATE SET
  profile_id = excluded.profile_id, profile_name = excluded.profile_name, profile = excluded.profile,
  brake_force_kg = COALESCE(excluded.brake_force_kg, car_pedals.brake_force_kg), bound_at = excluded.bound_at", null,
                ("$car", pedals.CarPath.Trim()), ("$id", pedals.ProfileId), ("$name", pedals.ProfileName.Trim()),
                ("$profile", pedals.Profile), ("$force", pedals.BrakeForceKg), ("$at", Iso(pedals.BoundAtUtc)));
            return true;
        }

        /// <summary>
        /// What a run in a car showed of its pedals: the force it ended on, if one is known, and whether the
        /// car has ABS. The force is the car's whether or not it has a profile. Returns what is now known.
        /// </summary>
        /// <param name="forceKg">Null leaves the force that is kept as it is.</param>
        /// <param name="absSeen">The car published an ABS setting, or its ABS was seen working.</param>
        /// <param name="laps">Laps driven in the run; they count towards "no ABS" while none has been seen.</param>
        public CarPedalFacts NotePedals(string carPath, double? forceKg, bool absSeen, int laps, DateTime atUtc)
        {
            if (string.IsNullOrWhiteSpace(carPath) || !HasTable("car_pedal_facts")) return null;
            if (forceKg.HasValue && (double.IsNaN(forceKg.Value) || double.IsInfinity(forceKg.Value) || forceKg.Value < 0)) forceKg = null;
            string car = carPath.Trim();
            bool profiles = HasTable("car_pedals");
            using (var tx = _db.BeginTransaction())
            {
                Exec(@"
INSERT INTO car_pedal_facts (car_path, force_kg, force_at, abs_seen, laps_without, seen_at)
VALUES ($car, $force, CASE WHEN $force IS NOT NULL THEN $at END, $abs, CASE WHEN $abs = 1 THEN 0 ELSE $laps END, $at)
ON CONFLICT(car_path) DO UPDATE SET
  force_kg = COALESCE(excluded.force_kg, car_pedal_facts.force_kg),
  force_at = CASE WHEN excluded.force_kg IS NOT NULL THEN excluded.seen_at ELSE car_pedal_facts.force_at END,
  abs_seen = MAX(car_pedal_facts.abs_seen, excluded.abs_seen),
  laps_without = CASE WHEN MAX(car_pedal_facts.abs_seen, excluded.abs_seen) = 1 THEN car_pedal_facts.laps_without
                      ELSE car_pedal_facts.laps_without + excluded.laps_without END,
  seen_at = excluded.seen_at", tx,
                    ("$car", car), ("$force", forceKg), ("$abs", absSeen ? 1 : 0), ("$laps", Math.Max(0, laps)), ("$at", Iso(atUtc)));
                // An earlier build reads the force beside the profile, where there is one.
                if (forceKg.HasValue && profiles)
                    Exec("UPDATE car_pedals SET brake_force_kg = $force WHERE car_path = $car", tx, ("$force", forceKg), ("$car", car));
                tx.Commit();
            }
            return CarPedalFactsOf(car);
        }

        /// <summary>The brake force a car was last driven with, in kilograms. False for what is not a force.</summary>
        public bool SetCarBrakeForce(string carPath, double kilograms)
        {
            if (string.IsNullOrWhiteSpace(carPath) || double.IsNaN(kilograms) || double.IsInfinity(kilograms) || kilograms < 0) return false;
            return NotePedals(carPath, kilograms, false, 0, DateTime.UtcNow) != null;
        }

        /// <summary>
        /// Who gave a car its profile, and what they went by: "rule" with its reason, "driver", or "none" when
        /// the driver chose that the car has no profile of its own — which the rule then leaves alone.
        /// </summary>
        public void NotePedalsGiven(string carPath, string by, string why, DateTime atUtc)
        {
            if (string.IsNullOrWhiteSpace(carPath) || !HasTable("car_pedal_facts")) return;
            WritePedalsGiven(carPath, by, why, atUtc, null);
        }

        private void WritePedalsGiven(string carPath, string by, string why, DateTime atUtc, SqliteTransaction tx) =>
            Exec(@"
INSERT INTO car_pedal_facts (car_path, given_by, given_why, seen_at) VALUES ($car, $by, $why, $at)
ON CONFLICT(car_path) DO UPDATE SET given_by = excluded.given_by, given_why = excluded.given_why", tx,
                ("$car", carPath.Trim()), ("$by", by), ("$why", why), ("$at", Iso(atUtc)));

        private const string PedalFactsQuery = @"SELECT f.car_path, c.name, f.force_kg, f.force_at, f.abs_seen, f.laps_without, f.given_by, f.given_why, f.seen_at
FROM car_pedal_facts f LEFT JOIN cars c ON c.car_path = f.car_path";

        public CarPedalFacts CarPedalFactsOf(string carPath)
        {
            if (string.IsNullOrWhiteSpace(carPath) || !HasTable("car_pedal_facts")) return null;
            using var cmd = Cmd(PedalFactsQuery + " WHERE f.car_path = $car");
            P(cmd, "$car", carPath.Trim());
            using var r = cmd.ExecuteReader();
            return r.Read() ? ReadPedalFacts(r) : null;
        }

        /// <summary>What is known of each car's pedals; none from a store that keeps none yet.</summary>
        public IReadOnlyList<CarPedalFacts> CarPedalFactsList()
        {
            var list = new List<CarPedalFacts>();
            if (!HasTable("car_pedal_facts")) return list;
            using var cmd = Cmd(PedalFactsQuery + " ORDER BY COALESCE(c.name, f.car_path) COLLATE NOCASE, f.car_path");
            using var r = cmd.ExecuteReader();
            while (r.Read()) list.Add(ReadPedalFacts(r));
            return list;
        }

        private static CarPedalFacts ReadPedalFacts(SqliteDataReader r) => new CarPedalFacts
        {
            CarPath = r.GetString(0), CarName = Str(r, 1),
            ForceKg = r.IsDBNull(2) ? (double?)null : r.GetDouble(2),
            ForceAtUtc = r.IsDBNull(3) ? (DateTime?)null : Utc(r.GetString(3)),
            AbsSeen = r.GetInt64(4) != 0, LapsWithoutAbs = (int)r.GetInt64(5),
            GivenBy = Str(r, 6), GivenWhy = Str(r, 7),
            SeenAtUtc = Utc(r.GetString(8)),
        };

        private static DateTime Utc(string iso) =>
            DateTime.Parse(iso, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal);

        /// <summary>
        /// Gives a car a profile only if it has none: what the rule does, which must never take the place of a
        /// profile given on the desk in the meantime. False if the car had one.
        /// </summary>
        public bool GiveCarPedals(CarPedals pedals)
        {
            if (pedals == null || string.IsNullOrWhiteSpace(pedals.CarPath) || string.IsNullOrWhiteSpace(pedals.ProfileName)) return false;
            using var cmd = Cmd(@"
INSERT INTO car_pedals (car_path, profile_id, profile_name, profile, brake_force_kg, bound_at)
VALUES ($car, $id, $name, $profile, $force, $at) ON CONFLICT(car_path) DO NOTHING");
            P(cmd, "$car", pedals.CarPath.Trim()); P(cmd, "$id", pedals.ProfileId); P(cmd, "$name", pedals.ProfileName.Trim());
            P(cmd, "$profile", pedals.Profile); P(cmd, "$force", pedals.BrakeForceKg); P(cmd, "$at", Iso(pedals.BoundAtUtc));
            return cmd.ExecuteNonQuery() > 0;
        }

        // The rule reads a car's pedals, then SmartControl's database, then writes; the driver may choose on the desk in
        // between, from another connection. What the rule writes is therefore written only if the car is still as the
        // rule read it, decided by the write itself and not by a look beforehand.

        /// <summary>
        /// The rule gives a car its first profile, and says what it went by: only if the car has none and the driver has
        /// not chosen since the rule looked — neither a profile of his own nor that the car has none. False if he has,
        /// and nothing is written.
        /// </summary>
        public bool GiveCarPedalsByRule(CarPedals pedals, string why, DateTime atUtc)
        {
            if (pedals == null || string.IsNullOrWhiteSpace(pedals.CarPath) || string.IsNullOrWhiteSpace(pedals.ProfileName)) return false;
            if (!HasTable("car_pedals") || !HasTable("car_pedal_facts")) return false;
            using var tx = _db.BeginTransaction();
            using (var cmd = Cmd(@"
INSERT INTO car_pedals (car_path, profile_id, profile_name, profile, brake_force_kg, bound_at)
SELECT $car, $id, $name, $profile, $force, $at
WHERE NOT EXISTS (SELECT 1 FROM car_pedal_facts WHERE car_path = $car AND given_by IN ('driver', 'none'))
ON CONFLICT(car_path) DO NOTHING", tx))
            {
                P(cmd, "$car", pedals.CarPath.Trim()); P(cmd, "$id", pedals.ProfileId); P(cmd, "$name", pedals.ProfileName.Trim());
                P(cmd, "$profile", pedals.Profile); P(cmd, "$force", pedals.BrakeForceKg); P(cmd, "$at", Iso(pedals.BoundAtUtc));
                if (cmd.ExecuteNonQuery() == 0)
                {
                    tx.Rollback();
                    return false;
                }
            }
            WritePedalsGiven(pedals.CarPath, "rule", why, atUtc, tx);
            tx.Commit();
            return true;
        }

        /// <summary>
        /// The rule gives a car a profile again, in place of the one it gave: only if that is still the profile the
        /// rule read, bound at <paramref name="wasBoundAtUtc"/>, and the rule is still down as having given it. False if
        /// the driver has chosen since — a profile, or that the car has none — and nothing is written. The brake force
        /// the car was driven with stays.
        /// </summary>
        public bool RegiveCarPedalsByRule(CarPedals pedals, DateTime wasBoundAtUtc, string why, DateTime atUtc)
        {
            if (pedals == null || string.IsNullOrWhiteSpace(pedals.CarPath) || string.IsNullOrWhiteSpace(pedals.ProfileName)) return false;
            if (!HasTable("car_pedals") || !HasTable("car_pedal_facts")) return false;
            using var tx = _db.BeginTransaction();
            using (var cmd = Cmd(@"
UPDATE car_pedals SET profile_id = $id, profile_name = $name, profile = $profile,
  brake_force_kg = COALESCE($force, brake_force_kg), bound_at = $at
WHERE car_path = $car AND bound_at = $was
  AND EXISTS (SELECT 1 FROM car_pedal_facts WHERE car_path = $car AND given_by = 'rule')", tx))
            {
                P(cmd, "$car", pedals.CarPath.Trim()); P(cmd, "$id", pedals.ProfileId); P(cmd, "$name", pedals.ProfileName.Trim());
                P(cmd, "$profile", pedals.Profile); P(cmd, "$force", pedals.BrakeForceKg); P(cmd, "$at", Iso(pedals.BoundAtUtc));
                P(cmd, "$was", Iso(wasBoundAtUtc));
                if (cmd.ExecuteNonQuery() == 0)
                {
                    tx.Rollback();
                    return false;
                }
            }
            WritePedalsGiven(pedals.CarPath, "rule", why, atUtc, tx);
            tx.Commit();
            return true;
        }

        /// <summary>
        /// Puts right what the rule went by for the profile it gave, and leaves the profile as it was: only if that is
        /// still the profile the rule read, bound at <paramref name="wasBoundAtUtc"/>, and the rule is still down as having
        /// given it. False if the driver has chosen since, and nothing is written.
        /// </summary>
        public bool NoteRuleReason(string carPath, string why, DateTime wasBoundAtUtc)
        {
            if (string.IsNullOrWhiteSpace(carPath) || !HasTable("car_pedals") || !HasTable("car_pedal_facts")) return false;
            using var cmd = Cmd(@"
UPDATE car_pedal_facts SET given_why = $why
WHERE car_path = $car AND given_by = 'rule'
  AND EXISTS (SELECT 1 FROM car_pedals WHERE car_path = $car AND bound_at = $was)");
            P(cmd, "$car", carPath.Trim()); P(cmd, "$why", why); P(cmd, "$was", Iso(wasBoundAtUtc));
            return cmd.ExecuteNonQuery() > 0;
        }

        /// <summary>
        /// Whether any session in this car ran in a category — "Formula", "SportsCar", "Road", "Oval", as the sim
        /// names them. A test session is "Road" whatever the car, so only an answer of yes says anything.
        /// </summary>
        public bool CarRanIn(string carPath, string category)
        {
            if (string.IsNullOrWhiteSpace(carPath) || string.IsNullOrWhiteSpace(category)) return false;
            using var cmd = Cmd("SELECT 1 FROM sessions WHERE car_path = $car AND category = $category COLLATE NOCASE LIMIT 1");
            P(cmd, "$car", carPath.Trim());
            P(cmd, "$category", category.Trim());
            return cmd.ExecuteScalar() != null;
        }

        /// <summary>The car goes back to having no pedals of its own. False if it had none.</summary>
        public bool UnbindCarPedals(string carPath)
        {
            if (string.IsNullOrWhiteSpace(carPath)) return false;
            using var cmd = Cmd("DELETE FROM car_pedals WHERE car_path = $car");
            P(cmd, "$car", carPath.Trim());
            return cmd.ExecuteNonQuery() > 0;
        }

        private const string CarPedalsQuery = @"SELECT p.car_path, c.name, p.profile_id, p.profile_name, p.profile, p.brake_force_kg, p.bound_at
FROM car_pedals p LEFT JOIN cars c ON c.car_path = p.car_path";

        /// <summary>Each car's pedal profile, by the car's name; none from a store that keeps none yet.</summary>
        public IReadOnlyList<CarPedals> CarPedalsList()
        {
            var list = new List<CarPedals>();
            if (!HasTable("car_pedals") || !HasCars) return list;
            using var cmd = Cmd(CarPedalsQuery + " ORDER BY COALESCE(c.name, p.car_path) COLLATE NOCASE, p.car_path");
            using var r = cmd.ExecuteReader();
            while (r.Read()) list.Add(ReadCarPedals(r));
            return list;
        }

        public CarPedals CarPedalsOf(string carPath)
        {
            if (string.IsNullOrWhiteSpace(carPath) || !HasTable("car_pedals") || !HasCars) return null;
            using var cmd = Cmd(CarPedalsQuery + " WHERE p.car_path = $car");
            P(cmd, "$car", carPath.Trim());
            using var r = cmd.ExecuteReader();
            return r.Read() ? ReadCarPedals(r) : null;
        }

        private static CarPedals ReadCarPedals(SqliteDataReader r) => new CarPedals
        {
            CarPath = r.GetString(0), CarName = Str(r, 1), ProfileId = Str(r, 2), ProfileName = r.GetString(3),
            Profile = r.IsDBNull(4) ? null : (byte[])r.GetValue(4),
            BrakeForceKg = r.IsDBNull(5) ? (double?)null : r.GetDouble(5),
            BoundAtUtc = DateTime.Parse(r.GetString(6), CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal),
        };

        /// <summary>Whether the store has a name for the car — that is, whether it has ever been in a session.</summary>
        public bool HasCar(string carPath)
        {
            if (string.IsNullOrWhiteSpace(carPath) || !HasCars) return false;
            using var cmd = Cmd("SELECT 1 FROM cars WHERE car_path = $car");
            P(cmd, "$car", carPath.Trim());
            return cmd.ExecuteScalar() != null;
        }

        public IReadOnlyList<string> IbtPathsMissingCategory()
        {
            using var cmd = Cmd("SELECT DISTINCT ibt_path FROM sessions WHERE source = 'ibt' AND category IS NULL AND ibt_path IS NOT NULL");
            using var r = cmd.ExecuteReader();
            var list = new List<string>();
            while (r.Read()) list.Add(r.GetString(0));
            return list;
        }

        public int SetCategory(string ibtPath, string category)
        {
            using var cmd = Cmd("UPDATE sessions SET category = $c WHERE source = 'ibt' AND ibt_path = $p AND category IS NULL");
            P(cmd, "$c", category); P(cmd, "$p", ibtPath);
            return cmd.ExecuteNonQuery();
        }

        public TrackGeometryRecord GetGeometry(int trackId)
        {
            using var cmd = Cmd("SELECT track_id, track_name, length_m, official_length_m, clean_laps, source_ibt, origin_lat, origin_lon, points, sector_starts, updated_at FROM track_geometry WHERE track_id = $t");
            P(cmd, "$t", trackId);
            using var r = cmd.ExecuteReader();
            if (!r.Read()) return null;
            var blob = (byte[])r["points"];
            var points = new float[blob.Length / 4];
            Buffer.BlockCopy(blob, 0, points, 0, blob.Length);
            return new TrackGeometryRecord
            {
                TrackId = r.GetInt32(0), TrackName = r.IsDBNull(1) ? null : r.GetString(1), LengthMeters = r.GetDouble(2),
                OfficialLengthMeters = r.GetDouble(3), CleanLaps = r.GetInt32(4), SourceIbt = r.IsDBNull(5) ? null : r.GetString(5),
                OriginLat = r.GetDouble(6), OriginLon = r.GetDouble(7), Points = points,
                SectorStartPcts = r.IsDBNull(9) || r.GetString(9).Length == 0 ? Array.Empty<double>()
                    : r.GetString(9).Split(',').Select(x => double.Parse(x, CultureInfo.InvariantCulture)).ToArray(),
                UpdatedAtUtc = DateTime.Parse(r.GetString(10), CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal),
            };
        }

        /// <summary>The stored outline for a track, found by iRacing's internal track name (e.g. "virginia 2022 full").</summary>
        public TrackGeometryRecord GetGeometryByTrackName(string trackName)
        {
            if (string.IsNullOrEmpty(trackName)) return null;
            using var cmd = Cmd("SELECT track_id FROM sessions WHERE track_name = $n ORDER BY started_at DESC LIMIT 1");
            P(cmd, "$n", trackName);
            var id = cmd.ExecuteScalar();
            return id is long trackId && trackId > 0 ? GetGeometry((int)trackId) : null;
        }

        /// <summary>Keeps the outline built from the most clean laps.</summary>
        public bool SaveGeometryIfBetter(TrackGeometryRecord g)
        {
            if (g == null || g.CleanLaps == 0) return false;
            long existing = Scalar<long>("SELECT COALESCE((SELECT clean_laps FROM track_geometry WHERE track_id = " + g.TrackId + "), 0)");
            if (existing >= g.CleanLaps) return false;
            var blob = new byte[g.Points.Length * 4];
            Buffer.BlockCopy(g.Points, 0, blob, 0, blob.Length);
            Exec("INSERT OR REPLACE INTO track_geometry VALUES ($t, $n, $len, $off, $laps, $src, $lat, $lon, $pts, $sec, $at)", null,
                ("$t", g.TrackId), ("$n", g.TrackName), ("$len", g.LengthMeters), ("$off", g.OfficialLengthMeters), ("$laps", g.CleanLaps),
                ("$src", g.SourceIbt), ("$lat", g.OriginLat), ("$lon", g.OriginLon), ("$pts", blob),
                ("$sec", string.Join(",", g.SectorStartPcts.Select(x => x.ToString("R", CultureInfo.InvariantCulture)))), ("$at", Iso(g.UpdatedAtUtc)));
            return true;
        }

        public IReadOnlyList<SessionRecord> RecentSessions(int limit, string sessionType = null)
        {
            using var cmd = Cmd(@"SELECT id, source, ibt_path, session_num, subsession_id, series_id, event_type, session_type, official, track_id,
  track_display_name, track_config, car_screen_name, started_at, duration_s, irating, safety_rating, laps_completed, best_lap_s,
  incidents, start_position, finish_position, field_size, sof
FROM sessions WHERE ($type IS NULL OR session_type = $type) ORDER BY started_at DESC LIMIT $limit");
            P(cmd, "$type", sessionType); P(cmd, "$limit", limit);
            var list = new List<SessionRecord>();
            using var r = cmd.ExecuteReader();
            while (r.Read())
            {
                list.Add(new SessionRecord
                {
                    Id = r.GetInt64(0), Source = r.GetString(1), IbtPath = Str(r, 2), SessionNum = r.GetInt32(3), SubsessionId = r.GetInt64(4),
                    SeriesId = r.GetInt32(5), EventType = Str(r, 6), SessionType = Str(r, 7), Official = r.GetInt32(8) != 0, TrackId = r.GetInt32(9),
                    TrackDisplayName = Str(r, 10), TrackConfig = Str(r, 11), CarScreenName = Str(r, 12),
                    StartedAtUtc = DateTime.Parse(r.GetString(13), CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal),
                    DurationSeconds = r.GetDouble(14), IRating = r.GetInt32(15), SafetyRating = r.GetDouble(16), LapsCompleted = r.GetInt32(17),
                    BestLapSeconds = r.GetDouble(18), Incidents = r.GetInt32(19), StartPosition = r.GetInt32(20), FinishPosition = r.GetInt32(21),
                    FieldSize = r.GetInt32(22), StrengthOfField = r.GetInt32(23),
                });
            }
            return list;
        }

        public IReadOnlyList<LapRecord> Laps(long sessionId)
        {
            using var cmd = Cmd("SELECT lap, lap_time_s, clean, incidents, fuel_used_l, pitted, start_session_time, position FROM laps WHERE session_id = $s ORDER BY lap");
            P(cmd, "$s", sessionId);
            var list = new List<LapRecord>();
            using var r = cmd.ExecuteReader();
            while (r.Read())
                list.Add(new LapRecord { Lap = r.GetInt32(0), LapTimeSeconds = r.GetDouble(1), Clean = r.GetInt32(2) != 0, Incidents = r.GetInt32(3),
                    FuelUsedLiters = r.GetDouble(4), Pitted = r.GetInt32(5) != 0, StartSessionTime = r.GetDouble(6), Position = r.GetInt32(7) });
            return list;
        }

        /// <summary>
        /// Runs a read-only query and writes the rows as a JSON array of objects keyed by column name.
        /// </summary>
        public void WriteJson(System.Text.Json.Utf8JsonWriter json, string sql, params (string Name, object Value)[] args)
        {
            using var cmd = Cmd(sql);
            foreach (var (n, v) in args) P(cmd, n, v);
            using var r = cmd.ExecuteReader();
            json.WriteStartArray();
            while (r.Read())
            {
                json.WriteStartObject();
                for (int i = 0; i < r.FieldCount; i++)
                {
                    string name = r.GetName(i);
                    if (r.IsDBNull(i)) { json.WriteNull(name); continue; }
                    switch (r.GetValue(i))
                    {
                        case long l: json.WriteNumber(name, l); break;
                        case double d: if (double.IsFinite(d)) json.WriteNumber(name, d); else json.WriteNull(name); break;
                        case string str: json.WriteString(name, str); break;
                        case byte[] bytes: json.WriteBase64String(name, bytes); break;
                        default: json.WriteString(name, Convert.ToString(r.GetValue(i), CultureInfo.InvariantCulture)); break;
                    }
                }
                json.WriteEndObject();
            }
            json.WriteEndArray();
        }

        public T Scalar<T>(string sql) => Scalar<T>(sql, null);

        private T Scalar<T>(string sql, SqliteTransaction tx)
        {
            using var cmd = Cmd(sql, tx);
            var v = cmd.ExecuteScalar();
            return v == null || v is DBNull ? default : (T)Convert.ChangeType(v, typeof(T), CultureInfo.InvariantCulture);
        }

        private static string Iso(DateTime utc) => DateTime.SpecifyKind(utc, DateTimeKind.Utc).ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture);
        private static string Str(SqliteDataReader r, int i) => r.IsDBNull(i) ? null : r.GetString(i);

        // ── For the schedule tables, which live in RacingDesk.Data.Schedule ──
        internal SqliteTransaction Begin() => _db.BeginTransaction();
        internal SqliteCommand Command(string sql, SqliteTransaction tx = null) => Cmd(sql, tx);
        internal static void Bind(SqliteCommand cmd, string name, object value) => P(cmd, name, value);

        private SqliteCommand Cmd(string sql, SqliteTransaction tx = null)
        {
            var cmd = _db.CreateCommand();
            cmd.CommandText = sql;
            cmd.Transaction = tx;
            return cmd;
        }

        internal void Exec(string sql, SqliteTransaction tx = null, params (string, object)[] args)
        {
            using var cmd = Cmd(sql, tx);
            foreach (var (n, v) in args) P(cmd, n, v);
            cmd.ExecuteNonQuery();
        }

        private void ExecKept(string sql, SqliteTransaction tx, params (string Name, object Value)[] args)
        {
            if (!_kept.TryGetValue(sql, out var cmd))
            {
                _kept[sql] = cmd = Cmd(sql);
                foreach (var (name, _) in args) cmd.Parameters.Add(new SqliteParameter(name, null));
            }
            cmd.Transaction = tx;
            for (int i = 0; i < args.Length; i++) cmd.Parameters[i].Value = Db(args[i].Value);
            cmd.ExecuteNonQuery();
        }

        private static void P(SqliteCommand cmd, string name, object value) => cmd.Parameters.AddWithValue(name, Db(value));

        // SQLite rejects NaN / Infinity, which corrupt telemetry can produce; store them as NULL.
        private static object Db(object value) =>
            value == null ? DBNull.Value
            : value is double d && !double.IsFinite(d) ? DBNull.Value
            : value is float f && !float.IsFinite(f) ? DBNull.Value
            : value;

        private static void Set(SqliteCommand cmd, params object[] values)
        {
            for (int i = 0; i < values.Length; i++) cmd.Parameters[i].Value = Db(values[i]);
        }
    }
}
