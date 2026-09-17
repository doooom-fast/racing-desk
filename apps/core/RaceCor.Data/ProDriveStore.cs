using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using Microsoft.Data.Sqlite;

namespace RaceCor.Data
{
    /// <summary>
    /// The local store: %LOCALAPPDATA%\RaceCor\prodrive.db. Single writer (the host), WAL so the Electron app
    /// can read concurrently. Sessions are keyed by <c>source_key</c>, so re-ingesting a file or re-saving a
    /// live session replaces its rows instead of duplicating them.
    /// </summary>
    public sealed class ProDriveStore : IDisposable
    {
        public const int SchemaVersion = 3;

        private readonly SqliteConnection _db;

        public string Path { get; }

        public static string DefaultPath => System.IO.Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RaceCor", "prodrive.db");

        public ProDriveStore(string path) : this(path, readOnly: false) { }

        private ProDriveStore(string path, bool readOnly)
        {
            Path = path;
            if (!readOnly) Directory.CreateDirectory(System.IO.Path.GetDirectoryName(path));
            _db = new SqliteConnection(new SqliteConnectionStringBuilder
            {
                DataSource = path,
                Mode = readOnly ? SqliteOpenMode.ReadOnly : SqliteOpenMode.ReadWriteCreate,
            }.ToString());
            _db.Open();
            if (readOnly) return;
            Exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;");
            Migrate();
        }

        /// <summary>A reader for queries (the data API); never migrates or writes.</summary>
        public static ProDriveStore OpenReadOnly(string path) => new ProDriveStore(path, readOnly: true);

        public void Dispose() => _db.Dispose();

        private void Migrate()
        {
            Exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
            long current = Scalar<long>("SELECT COALESCE(MAX(version), 0) FROM schema_version");
            if (current >= SchemaVersion) return;

            // One step per version, so a store from any earlier version catches up in one open.
            while (current > 0 && current < SchemaVersion)
            {
                using var step = _db.BeginTransaction();
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
                }
                current++;
                Exec("INSERT INTO schema_version(version) VALUES (" + current + ")", step);
                step.Commit();
            }
            if (current >= SchemaVersion) return;

            using var tx = _db.BeginTransaction();
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
            Exec("INSERT INTO schema_version(version) VALUES (" + SchemaVersion + ")", tx);
            tx.Commit();
        }

        /// <summary>The stored season schedule as JSON (see RaceCor.Data.Schedule.ScheduleStore).</summary>
        public void WriteScheduleJson(System.Text.Json.Utf8JsonWriter json) => Schedule.ScheduleStore.WriteJson(this, json);

        public static string SourceKey(SessionRecord s) =>
            s.Source == "ibt"
                ? "ibt|" + s.IbtPath + "|" + s.SessionNum.ToString(CultureInfo.InvariantCulture)
                : s.Source + "|" + s.StartedAtUtc.ToString("o", CultureInfo.InvariantCulture) + "|" + s.SessionNum.ToString(CultureInfo.InvariantCulture);

        /// <summary>Inserts or replaces a session with its laps, incidents and grid. Returns its row id.</summary>
        public long SaveSession(SessionRecord s)
        {
            using var tx = _db.BeginTransaction();
            long id = SaveSession(s, tx);
            tx.Commit();
            return id;
        }

        private long SaveSession(SessionRecord s, SqliteTransaction tx)
        {
            string key = SourceKey(s);
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
            return s.Id;
        }

        public bool IsIngested(string path, long length, DateTime mtimeUtc)
        {
            using var cmd = Cmd("SELECT 1 FROM ingested_files WHERE path = $p AND length = $l AND mtime = $m AND error IS NULL");
            P(cmd, "$p", path); P(cmd, "$l", length); P(cmd, "$m", Iso(mtimeUtc));
            return cmd.ExecuteScalar() != null;
        }

        /// <summary>Stores a file's sessions and marks it ingested, atomically.</summary>
        public void SaveIngestedFile(string path, long length, DateTime mtimeUtc, IReadOnlyList<SessionRecord> sessions, string error)
        {
            using var tx = _db.BeginTransaction();
            // Replace everything previously read from this file, including sessions it no longer yields.
            Exec("DELETE FROM sessions WHERE source = 'ibt' AND ibt_path = $p", tx, ("$p", path));
            foreach (var s in sessions) SaveSession(s, tx);
            Exec("INSERT OR REPLACE INTO ingested_files VALUES ($p, $l, $m, $n, $e, $at)", tx,
                ("$p", path), ("$l", length), ("$m", Iso(mtimeUtc)), ("$n", sessions.Count), ("$e", error), ("$at", Iso(DateTime.UtcNow)));
            tx.Commit();
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

        public T Scalar<T>(string sql)
        {
            using var cmd = Cmd(sql);
            var v = cmd.ExecuteScalar();
            return v == null || v is DBNull ? default : (T)Convert.ChangeType(v, typeof(T), CultureInfo.InvariantCulture);
        }

        private static string Iso(DateTime utc) => DateTime.SpecifyKind(utc, DateTimeKind.Utc).ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture);
        private static string Str(SqliteDataReader r, int i) => r.IsDBNull(i) ? null : r.GetString(i);

        // ── For the schedule tables, which live in RaceCor.Data.Schedule ──
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
