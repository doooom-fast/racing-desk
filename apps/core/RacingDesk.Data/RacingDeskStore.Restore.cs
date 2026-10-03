using System;
using System.Collections.Generic;
using System.Globalization;
using Microsoft.Data.Sqlite;
using RacingDesk.Data.Restore;

namespace RacingDesk.Data
{
    /// <summary>
    /// Schema v9: putting back each car's seat height and brakes (docs/view-and-pedals-plan.md). Five tables of their
    /// own, added to a store and nothing in it changed, so an earlier build still records and ingests into a store this one
    /// has opened. Every reader here answers "none" for a store from before v9 (a read-only open does not migrate).
    /// </summary>
    public sealed partial class RacingDeskStore
    {
        private const string RestoreSchema = @"
CREATE TABLE IF NOT EXISTS car_view_keep (
  car_path TEXT PRIMARY KEY COLLATE NOCASE,
  cam_file TEXT NOT NULL,
  own_z REAL, added_z REAL NOT NULL DEFAULT 0, written_z REAL, written_sha TEXT, written_at TEXT,
  own_vy REAL, added_vy REAL NOT NULL DEFAULT 0, written_vy REAL,
  original_backup TEXT,
  pending_d REAL, pending_at TEXT,
  intent TEXT, intent_at TEXT,
  seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS view_baseline (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  start_height REAL NOT NULL, decided_at TEXT NOT NULL, decided_by TEXT,
  ini_original REAL, ini_backup TEXT, ini_written_at TEXT,
  migrated_at TEXT,
  launch_height REAL, launch_at TEXT,
  vy_original REAL, ini_height_written REAL, vy_written REAL
);

CREATE TABLE IF NOT EXISTS car_smartcontrol (
  car_path TEXT PRIMARY KEY COLLATE NOCASE,
  profile_id TEXT NOT NULL UNIQUE, profile_name TEXT NOT NULL,
  base_name TEXT NOT NULL, base_id TEXT,
  made_at TEXT NOT NULL,
  written_sha TEXT NOT NULL, written_kg REAL NOT NULL, written_at TEXT NOT NULL,
  waiting_kg REAL, waiting_at TEXT,
  state TEXT NOT NULL DEFAULT 'made',
  switched_at TEXT
);

CREATE TABLE IF NOT EXISTS smartcontrol_switch (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  profile_id TEXT NOT NULL UNIQUE, profile_name TEXT NOT NULL,
  binding_id INTEGER, link_id INTEGER, preset_id INTEGER,
  key TEXT NOT NULL,
  made_at TEXT NOT NULL,
  written_sha TEXT, written_for TEXT, written_at TEXT,
  sent_at TEXT,
  bound_at TEXT, pedals_at TEXT
);

CREATE TABLE IF NOT EXISTS restore_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  car_path TEXT,
  what TEXT NOT NULL,
  state TEXT NOT NULL,
  text TEXT NOT NULL
);
";

        /// <summary>How many lines of what was done are kept; older ones go as new ones come.</summary>
        public const int RestoreEventsKept = 500;

        /// <summary>Whether the store has v9's tables: a store last opened by an earlier build, read-only, has none.</summary>
        public bool HasRestoreTables => HasTable("restore_events") && HasTable("car_view_keep") && HasTable("car_smartcontrol");

        /// <summary>Every car's recorded view (<c>car_views</c>), by the car's folder; none from a store that keeps none.</summary>
        public IReadOnlyList<CarView> CarViewsList()
        {
            var list = new List<CarView>();
            if (!HasTable("car_views")) return list;
            using var cmd = Cmd("SELECT car_path, driver_height, vanish_y, head_horizon, fov, seat_x, seat_y, seat_z, chosen, seen_at FROM car_views ORDER BY car_path");
            using var r = cmd.ExecuteReader();
            while (r.Read())
                list.Add(new CarView
                {
                    CarPath = r.GetString(0), DriverHeight = Real(r, 1), VanishY = Real(r, 2), HeadHorizon = Real(r, 3), Fov = Real(r, 4),
                    SeatX = Real(r, 5), SeatY = Real(r, 6), SeatZ = Real(r, 7), Chosen = r.GetInt64(8) != 0, SeenAtUtc = Utc(r.GetString(9)),
                });
            return list;
        }

        // ── car_view_keep ──

        public CarViewKeep CarViewKeepOf(string carPath)
        {
            if (string.IsNullOrWhiteSpace(carPath) || !HasTable("car_view_keep")) return null;
            using var cmd = Cmd(CarViewKeepQuery + " WHERE car_path = $car");
            P(cmd, "$car", carPath.Trim());
            using var r = cmd.ExecuteReader();
            return r.Read() ? ReadCarViewKeep(r) : null;
        }

        public IReadOnlyList<CarViewKeep> CarViewKeeps()
        {
            var list = new List<CarViewKeep>();
            if (!HasTable("car_view_keep")) return list;
            using var cmd = Cmd(CarViewKeepQuery + " ORDER BY car_path");
            using var r = cmd.ExecuteReader();
            while (r.Read()) list.Add(ReadCarViewKeep(r));
            return list;
        }

        private const string CarViewKeepQuery = @"SELECT car_path, cam_file, own_z, added_z, written_z, written_sha, written_at,
  own_vy, added_vy, written_vy, original_backup, pending_d, pending_at, intent, intent_at, seen_at FROM car_view_keep";

        private static CarViewKeep ReadCarViewKeep(SqliteDataReader r) => new CarViewKeep
        {
            CarPath = r.GetString(0), CamFile = r.GetString(1),
            OwnZ = Real(r, 2), AddedZ = r.IsDBNull(3) ? 0 : r.GetDouble(3), WrittenZ = Real(r, 4),
            WrittenSha = Str(r, 5), WrittenAtUtc = When(r, 6),
            OwnVerticalShift = Real(r, 7), AddedVerticalShift = r.IsDBNull(8) ? 0 : r.GetDouble(8), WrittenVerticalShift = Real(r, 9),
            OriginalBackup = Str(r, 10), PendingD = Real(r, 11), PendingAtUtc = When(r, 12),
            Intent = Str(r, 13), IntentAtUtc = When(r, 14), SeenAtUtc = Utc(r.GetString(15)),
        };

        /// <summary>Keeps a car's row as given, whole. False for a row with no car or no file, or a store without the table.</summary>
        public bool SaveCarViewKeep(CarViewKeep row)
        {
            if (row == null || string.IsNullOrWhiteSpace(row.CarPath) || string.IsNullOrWhiteSpace(row.CamFile) || !HasTable("car_view_keep")) return false;
            Exec(@"
INSERT INTO car_view_keep (car_path, cam_file, own_z, added_z, written_z, written_sha, written_at, own_vy, added_vy, written_vy,
  original_backup, pending_d, pending_at, intent, intent_at, seen_at)
VALUES ($car, $file, $own, $added, $wz, $sha, $wat, $ovy, $avy, $wvy, $orig, $pd, $pat, $intent, $iat, $seen)
ON CONFLICT(car_path) DO UPDATE SET cam_file = excluded.cam_file, own_z = excluded.own_z, added_z = excluded.added_z,
  written_z = excluded.written_z, written_sha = excluded.written_sha, written_at = excluded.written_at,
  own_vy = excluded.own_vy, added_vy = excluded.added_vy, written_vy = excluded.written_vy,
  original_backup = COALESCE(car_view_keep.original_backup, excluded.original_backup),
  pending_d = excluded.pending_d, pending_at = excluded.pending_at, intent = excluded.intent, intent_at = excluded.intent_at,
  seen_at = excluded.seen_at", null,
                ("$car", row.CarPath.Trim()), ("$file", row.CamFile), ("$own", row.OwnZ), ("$added", row.AddedZ), ("$wz", row.WrittenZ),
                ("$sha", row.WrittenSha), ("$wat", IsoOrNull(row.WrittenAtUtc)), ("$ovy", row.OwnVerticalShift), ("$avy", row.AddedVerticalShift),
                ("$wvy", row.WrittenVerticalShift), ("$orig", row.OriginalBackup), ("$pd", row.PendingD), ("$pat", IsoOrNull(row.PendingAtUtc)),
                ("$intent", row.Intent), ("$iat", IsoOrNull(row.IntentAtUtc)), ("$seen", Iso(row.SeenAtUtc == default ? DateTime.UtcNow : row.SeenAtUtc)));
            return true;
        }

        /// <summary>Takes a car's row away: undo has put its file back as it was before Racing Desk.</summary>
        public bool ForgetCarViewKeep(string carPath)
        {
            if (string.IsNullOrWhiteSpace(carPath) || !HasTable("car_view_keep")) return false;
            using var cmd = Cmd("DELETE FROM car_view_keep WHERE car_path = $car");
            P(cmd, "$car", carPath.Trim());
            return cmd.ExecuteNonQuery() > 0;
        }

        // ── view_baseline ──

        /// <summary>The columns a v9 store made by an earlier build of it may not have yet: app.ini's values, and the switch's two times.</summary>
        private static readonly (string Table, string Column, string Type)[] LaterColumns =
        {
            ("view_baseline", "vy_original", "REAL"), ("view_baseline", "ini_height_written", "REAL"), ("view_baseline", "vy_written", "REAL"),
            ("smartcontrol_switch", "bound_at", "TEXT"), ("smartcontrol_switch", "pedals_at", "TEXT"),
        };

        private bool HasColumn(string table, string column)
        {
            using var cmd = Cmd("SELECT 1 FROM pragma_table_info('" + table + "') WHERE name = $c");
            P(cmd, "$c", column);
            return cmd.ExecuteScalar() != null;
        }

        /// <summary>Adds the columns a v9 store made earlier lacks; a read-write open does it, a read-only one reads without them.</summary>
        private void EnsureRestoreColumns()
        {
            foreach (var (table, column, type) in LaterColumns)
            {
                if (!HasTable(table) || HasColumn(table, column)) continue;
                try { Exec("ALTER TABLE " + table + " ADD COLUMN " + column + " " + type); }
                catch (SqliteException ex) when (ex.Message.IndexOf("duplicate column", StringComparison.OrdinalIgnoreCase) >= 0) { /* another opener was first */ }
            }
        }

        public ViewBaseline ViewBaselineRow()
        {
            if (!HasTable("view_baseline")) return null;
            // A store opened read-only by a build that did not migrate it may not have the later columns: they read as none.
            string Col(string c) => HasColumn("view_baseline", c) ? c : "NULL";
            using var cmd = Cmd(@"SELECT start_height, decided_at, decided_by, ini_original, ini_backup, ini_written_at, migrated_at,
  launch_height, launch_at, " + Col("vy_original") + ", " + Col("ini_height_written") + ", " + Col("vy_written") + " FROM view_baseline WHERE id = 1");
            using var r = cmd.ExecuteReader();
            if (!r.Read()) return null;
            return new ViewBaseline
            {
                StartHeight = r.GetDouble(0), DecidedAtUtc = Utc(r.GetString(1)), DecidedBy = Str(r, 2),
                IniOriginal = Real(r, 3), IniBackup = Str(r, 4), IniWrittenAtUtc = When(r, 5), MigratedAtUtc = When(r, 6),
                LaunchHeight = Real(r, 7), LaunchAtUtc = When(r, 8),
                VanishYOriginal = Real(r, 9), IniHeightWritten = Real(r, 10), VanishYWritten = Real(r, 11),
            };
        }

        /// <summary>
        /// Keeps what Racing Desk has done to app.ini's two values, whatever wrote them: the value of each before Racing Desk's
        /// first write of it (kept, never replaced), the value it last wrote (replaced) and when (<paramref name="atUtc"/>, kept
        /// with a written value). A value that is null leaves what is kept as it is. The row is made, with S and the day it was
        /// decided, if there is none yet.
        /// </summary>
        public bool NoteIniValues(double? heightBefore, double? heightWritten, double? vanishYBefore, double? vanishYWritten, DateTime atUtc)
        {
            if (!HasTable("view_baseline")) return false;
            EnsureRestoreColumns();
            bool wrote = heightWritten.HasValue || vanishYWritten.HasValue;
            Exec(@"
INSERT INTO view_baseline (id, start_height, decided_at, decided_by, ini_original, vy_original, ini_height_written, vy_written, ini_written_at)
VALUES (1, $s, $at, $by, $ho, $vo, $hw, $vw, $wat)
ON CONFLICT(id) DO UPDATE SET
  ini_original = COALESCE(view_baseline.ini_original, excluded.ini_original),
  vy_original = COALESCE(view_baseline.vy_original, excluded.vy_original),
  ini_height_written = COALESCE(excluded.ini_height_written, view_baseline.ini_height_written),
  vy_written = COALESCE(excluded.vy_written, view_baseline.vy_written),
  ini_written_at = COALESCE(excluded.ini_written_at, view_baseline.ini_written_at)", null,
                ("$s", RestorePolicy.StartHeight), ("$at", Iso(RestorePolicy.DecidedAtUtc)), ("$by", RestorePolicy.DecidedBy),
                ("$ho", heightBefore), ("$vo", vanishYBefore), ("$hw", heightWritten), ("$vw", vanishYWritten), ("$wat", wrote ? Iso(atUtc) : null));
            return true;
        }

        /// <summary>app.ini's values are Racing Desk's no longer (undo has put back what it could): the next first write is a first.</summary>
        public bool ForgetIniValues()
        {
            if (!HasTable("view_baseline")) return false;
            EnsureRestoreColumns();
            using var cmd = Cmd("UPDATE view_baseline SET ini_original = NULL, vy_original = NULL, ini_height_written = NULL, vy_written = NULL, ini_written_at = NULL WHERE id = 1");
            return cmd.ExecuteNonQuery() > 0;
        }

        /// <summary>When the one-time move of his earlier heights was made (null: owed again). The row is made, with S, if there is none.</summary>
        public bool NoteHeightsMoved(DateTime? atUtc) => NoteBaseline("migrated_at = $v", ("$v", IsoOrNull(atUtc)));

        /// <summary>What app.ini held when the sim last started, and when (the self-check).</summary>
        public bool NoteLaunch(double? height, DateTime atUtc) => NoteBaseline("launch_height = $v, launch_at = $w", ("$v", height), ("$w", Iso(atUtc)));

        private bool NoteBaseline(string set, params (string, object)[] values)
        {
            if (!HasTable("view_baseline")) return false;
            Exec("INSERT INTO view_baseline (id, start_height, decided_at, decided_by) VALUES (1, $s, $at, $by) ON CONFLICT(id) DO NOTHING", null,
                ("$s", RestorePolicy.StartHeight), ("$at", Iso(RestorePolicy.DecidedAtUtc)), ("$by", RestorePolicy.DecidedBy));
            Exec("UPDATE view_baseline SET " + set + " WHERE id = 1", null, values);
            return true;
        }

        public bool SaveViewBaseline(ViewBaseline b)
        {
            if (b == null || double.IsNaN(b.StartHeight) || double.IsInfinity(b.StartHeight) || !HasTable("view_baseline")) return false;
            Exec(@"
INSERT INTO view_baseline (id, start_height, decided_at, decided_by, ini_original, ini_backup, ini_written_at, migrated_at, launch_height, launch_at)
VALUES (1, $s, $at, $by, $orig, $bak, $wat, $mig, $lh, $lat)
ON CONFLICT(id) DO UPDATE SET start_height = excluded.start_height, decided_at = excluded.decided_at, decided_by = excluded.decided_by,
  ini_original = COALESCE(view_baseline.ini_original, excluded.ini_original),
  ini_backup = COALESCE(view_baseline.ini_backup, excluded.ini_backup),
  ini_written_at = excluded.ini_written_at, migrated_at = excluded.migrated_at,
  launch_height = excluded.launch_height, launch_at = excluded.launch_at", null,
                ("$s", b.StartHeight), ("$at", Iso(b.DecidedAtUtc == default ? DateTime.UtcNow : b.DecidedAtUtc)), ("$by", b.DecidedBy),
                ("$orig", b.IniOriginal), ("$bak", b.IniBackup), ("$wat", IsoOrNull(b.IniWrittenAtUtc)), ("$mig", IsoOrNull(b.MigratedAtUtc)),
                ("$lh", b.LaunchHeight), ("$lat", IsoOrNull(b.LaunchAtUtc)));
            return true;
        }

        // ── car_smartcontrol, smartcontrol_switch ──

        private const string CarSmartControlQuery = @"SELECT car_path, profile_id, profile_name, base_name, base_id, made_at, written_sha,
  written_kg, written_at, waiting_kg, waiting_at, state, switched_at FROM car_smartcontrol";

        public CarSmartControl CarSmartControlOf(string carPath)
        {
            if (string.IsNullOrWhiteSpace(carPath) || !HasTable("car_smartcontrol")) return null;
            using var cmd = Cmd(CarSmartControlQuery + " WHERE car_path = $car");
            P(cmd, "$car", carPath.Trim());
            using var r = cmd.ExecuteReader();
            return r.Read() ? ReadCarSmartControl(r) : null;
        }

        public IReadOnlyList<CarSmartControl> CarSmartControls()
        {
            var list = new List<CarSmartControl>();
            if (!HasTable("car_smartcontrol")) return list;
            using var cmd = Cmd(CarSmartControlQuery + " ORDER BY car_path");
            using var r = cmd.ExecuteReader();
            while (r.Read()) list.Add(ReadCarSmartControl(r));
            return list;
        }

        private static CarSmartControl ReadCarSmartControl(SqliteDataReader r) => new CarSmartControl
        {
            CarPath = r.GetString(0), ProfileId = r.GetString(1), ProfileName = r.GetString(2), BaseName = r.GetString(3), BaseId = Str(r, 4),
            MadeAtUtc = Utc(r.GetString(5)), WrittenSha = r.GetString(6), WrittenKg = r.GetDouble(7), WrittenAtUtc = Utc(r.GetString(8)),
            WaitingKg = Real(r, 9), WaitingAtUtc = When(r, 10), State = Str(r, 11) ?? "made", SwitchedAtUtc = When(r, 12),
        };

        public bool SaveCarSmartControl(CarSmartControl row)
        {
            if (row == null || string.IsNullOrWhiteSpace(row.CarPath) || string.IsNullOrWhiteSpace(row.ProfileId) || !HasTable("car_smartcontrol")) return false;
            Exec(@"
INSERT INTO car_smartcontrol (car_path, profile_id, profile_name, base_name, base_id, made_at, written_sha, written_kg, written_at,
  waiting_kg, waiting_at, state, switched_at)
VALUES ($car, $id, $name, $base, $baseid, $made, $sha, $kg, $wat, $wkg, $wwat, $state, $sw)
ON CONFLICT(car_path) DO UPDATE SET profile_id = excluded.profile_id, profile_name = excluded.profile_name, base_name = excluded.base_name,
  base_id = excluded.base_id, made_at = excluded.made_at, written_sha = excluded.written_sha, written_kg = excluded.written_kg,
  written_at = excluded.written_at, waiting_kg = excluded.waiting_kg, waiting_at = excluded.waiting_at, state = excluded.state,
  switched_at = excluded.switched_at", null,
                ("$car", row.CarPath.Trim()), ("$id", row.ProfileId), ("$name", row.ProfileName), ("$base", row.BaseName), ("$baseid", row.BaseId),
                ("$made", Iso(row.MadeAtUtc)), ("$sha", row.WrittenSha), ("$kg", row.WrittenKg), ("$wat", Iso(row.WrittenAtUtc)),
                ("$wkg", row.WaitingKg), ("$wwat", IsoOrNull(row.WaitingAtUtc)), ("$state", row.State ?? "made"), ("$sw", IsoOrNull(row.SwitchedAtUtc)));
            return true;
        }

        public bool ForgetCarSmartControl(string carPath)
        {
            if (string.IsNullOrWhiteSpace(carPath) || !HasTable("car_smartcontrol")) return false;
            using var cmd = Cmd("DELETE FROM car_smartcontrol WHERE car_path = $car");
            P(cmd, "$car", carPath.Trim());
            return cmd.ExecuteNonQuery() > 0;
        }

        public SmartControlSwitch SmartControlSwitchRow()
        {
            if (!HasTable("smartcontrol_switch")) return null;
            // A store opened read-only by a build that did not migrate it may not have the later columns: they read as none.
            string Col(string c) => HasColumn("smartcontrol_switch", c) ? c : "NULL";
            using var cmd = Cmd(@"SELECT profile_id, profile_name, binding_id, link_id, preset_id, key, made_at, written_sha, written_for,
  written_at, sent_at, " + Col("bound_at") + ", " + Col("pedals_at") + " FROM smartcontrol_switch WHERE id = 1");
            using var r = cmd.ExecuteReader();
            if (!r.Read()) return null;
            return new SmartControlSwitch
            {
                ProfileId = r.GetString(0), ProfileName = r.GetString(1),
                BindingId = r.IsDBNull(2) ? (long?)null : r.GetInt64(2), LinkId = r.IsDBNull(3) ? (long?)null : r.GetInt64(3),
                PresetId = r.IsDBNull(4) ? (long?)null : r.GetInt64(4), Key = r.GetString(5), MadeAtUtc = Utc(r.GetString(6)),
                WrittenSha = Str(r, 7), WrittenFor = Str(r, 8), WrittenAtUtc = When(r, 9), SentAtUtc = When(r, 10),
                BoundAtUtc = When(r, 11), PedalsAtUtc = When(r, 12),
            };
        }

        public bool SaveSmartControlSwitch(SmartControlSwitch row)
        {
            if (row == null || string.IsNullOrWhiteSpace(row.ProfileId) || !HasTable("smartcontrol_switch")) return false;
            EnsureRestoreColumns();
            Exec(@"
INSERT INTO smartcontrol_switch (id, profile_id, profile_name, binding_id, link_id, preset_id, key, made_at, written_sha, written_for, written_at,
  sent_at, bound_at, pedals_at)
VALUES (1, $id, $name, $bind, $link, $preset, $key, $made, $sha, $for, $wat, $sent, $bat, $pat)
ON CONFLICT(id) DO UPDATE SET profile_id = excluded.profile_id, profile_name = excluded.profile_name, binding_id = excluded.binding_id,
  link_id = excluded.link_id, preset_id = excluded.preset_id, key = excluded.key, made_at = excluded.made_at,
  written_sha = excluded.written_sha, written_for = excluded.written_for, written_at = excluded.written_at, sent_at = excluded.sent_at,
  bound_at = excluded.bound_at, pedals_at = excluded.pedals_at", null,
                ("$id", row.ProfileId), ("$name", row.ProfileName), ("$bind", row.BindingId), ("$link", row.LinkId), ("$preset", row.PresetId),
                ("$key", row.Key ?? "F24"), ("$made", Iso(row.MadeAtUtc)), ("$sha", row.WrittenSha), ("$for", row.WrittenFor),
                ("$wat", IsoOrNull(row.WrittenAtUtc)), ("$sent", IsoOrNull(row.SentAtUtc)), ("$bat", IsoOrNull(row.BoundAtUtc)),
                ("$pat", IsoOrNull(row.PedalsAtUtc)));
            return true;
        }

        public bool ForgetSmartControlSwitch()
        {
            if (!HasTable("smartcontrol_switch")) return false;
            using var cmd = Cmd("DELETE FROM smartcontrol_switch WHERE id = 1");
            return cmd.ExecuteNonQuery() > 0;
        }

        /// <summary>
        /// The ids of every SmartControl row Racing Desk made — the cars' profiles and the switch profile. The writer changes
        /// these and no others: his profiles, presets and keys are refused whatever is asked.
        /// </summary>
        public ISet<string> RacingDeskProfileIds()
        {
            var ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var car in CarSmartControls()) if (!string.IsNullOrWhiteSpace(car.ProfileId)) ids.Add(car.ProfileId.Trim());
            var sw = SmartControlSwitchRow();
            if (sw != null && !string.IsNullOrWhiteSpace(sw.ProfileId)) ids.Add(sw.ProfileId.Trim());
            return ids;
        }

        // ── restore_events ──

        /// <summary>Adds a line and returns its id (the order lines are told in); 0 for a store without the table.</summary>
        public long AddRestoreEvent(RestoreEvent e)
        {
            if (e == null || string.IsNullOrWhiteSpace(e.Text) || !HasTable("restore_events")) return 0;
            using var tx = _db.BeginTransaction();
            long id;
            using (var cmd = Cmd("INSERT INTO restore_events (at, car_path, what, state, text) VALUES ($at, $car, $what, $state, $text); SELECT last_insert_rowid();", tx))
            {
                P(cmd, "$at", Iso(e.AtUtc == default ? DateTime.UtcNow : e.AtUtc)); P(cmd, "$car", e.CarPath); P(cmd, "$what", e.What ?? "");
                P(cmd, "$state", e.State ?? ""); P(cmd, "$text", e.Text);
                id = (long)cmd.ExecuteScalar();
            }
            Exec("DELETE FROM restore_events WHERE id <= $cut", tx, ("$cut", id - RestoreEventsKept));
            tx.Commit();
            e.Id = id;
            return id;
        }

        /// <summary>The lines after <paramref name="afterId"/>, oldest first, at most <paramref name="limit"/> of the newest.</summary>
        public IReadOnlyList<RestoreEvent> RestoreEvents(long afterId = 0, int limit = 100)
        {
            var list = new List<RestoreEvent>();
            if (!HasTable("restore_events")) return list;
            using var cmd = Cmd(@"SELECT id, at, car_path, what, state, text FROM
  (SELECT * FROM restore_events WHERE id > $after ORDER BY id DESC LIMIT $limit) ORDER BY id");
            P(cmd, "$after", afterId); P(cmd, "$limit", Math.Max(1, limit));
            using var r = cmd.ExecuteReader();
            while (r.Read())
                list.Add(new RestoreEvent { Id = r.GetInt64(0), AtUtc = Utc(r.GetString(1)), CarPath = Str(r, 2), What = r.GetString(3), State = r.GetString(4), Text = r.GetString(5) });
            return list;
        }

        // ── helpers ──

        private static double? Real(SqliteDataReader r, int i) => r.IsDBNull(i) ? (double?)null : r.GetDouble(i);
        private static DateTime? When(SqliteDataReader r, int i) => r.IsDBNull(i) ? (DateTime?)null : Utc(r.GetString(i));
        private static string IsoOrNull(DateTime? utc) => utc.HasValue ? Iso(utc.Value) : null;
    }
}
