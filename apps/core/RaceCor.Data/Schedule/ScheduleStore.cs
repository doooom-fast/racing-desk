using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json;
using Microsoft.Data.Sqlite;

namespace RaceCor.Data.Schedule
{
    /// <summary>
    /// The parsed season schedule in the local store (schema v3). The desk reads it back as JSON in the shape
    /// it was parsed in; turning that into what the calc engines want is done in packages/calc, not here.
    /// </summary>
    public static class ScheduleStore
    {
        internal const string Schema = @"
CREATE TABLE schedule_source (
  path TEXT PRIMARY KEY, source_url TEXT, season TEXT, length INTEGER, mtime TEXT,
  fetched_at TEXT, parsed_at TEXT, series INTEGER, weeks INTEGER
);

CREATE TABLE schedule_series (
  id                INTEGER PRIMARY KEY,
  season            TEXT NOT NULL,
  name              TEXT NOT NULL,
  category          TEXT, license_class TEXT, min_license_class TEXT, min_license_level REAL,
  fixed_setup       INTEGER, multiclass INTEGER, cars_vary_by_week INTEGER, cars TEXT,
  timing_text       TEXT, repeat_minutes INTEGER, minute_offsets TEXT, hour_parity TEXT,
  weekly_slots      TEXT, alternate_weeks INTEGER,
  min_entries       INTEGER, split_at INTEGER, drops INTEGER, incident_limit INTEGER, dt_penalties INTEGER,
  UNIQUE (season, name)
);

CREATE TABLE schedule_weeks (
  series_id         INTEGER NOT NULL REFERENCES schedule_series(id) ON DELETE CASCADE,
  week              INTEGER NOT NULL,
  starts_on         TEXT,
  track_name        TEXT, track_config TEXT,
  race_minutes      INTEGER, race_laps INTEGER, heat_format TEXT,
  cars              TEXT, sim_time TEXT, conditions TEXT,
  PRIMARY KEY (series_id, week)
);
CREATE INDEX schedule_weeks_start ON schedule_weeks(starts_on);
";

        /// <summary>Replaces everything stored for this season and records the file it came from.</summary>
        public static void Save(ProDriveStore store, SeasonSchedule schedule, string sourceUrl = null)
        {
            if (schedule == null || schedule.Series.Count == 0) throw new ArgumentException("nothing parsed", nameof(schedule));
            using var tx = store.Begin();
            store.Exec("DELETE FROM schedule_series WHERE season = $season", tx, ("$season", schedule.Season));

            foreach (var series in schedule.Series)
            {
                long id;
                using (var insert = store.Command(@"
INSERT INTO schedule_series (season, name, category, license_class, min_license_class, min_license_level,
  fixed_setup, multiclass, cars_vary_by_week, cars, timing_text, repeat_minutes, minute_offsets, hour_parity,
  weekly_slots, alternate_weeks, min_entries, split_at, drops, incident_limit, dt_penalties)
VALUES ($season, $name, $category, $class, $minclass, $minlevel, $fixed, $multi, $vary, $cars, $timing, $repeat,
  $offsets, $parity, $slots, $alt, $entries, $split, $drops, $inc, $dt);
SELECT last_insert_rowid();", tx))
                {
                    var timing = series.Timing;
                    ProDriveStore.Bind(insert, "$season", schedule.Season);
                    ProDriveStore.Bind(insert, "$name", series.Name);
                    ProDriveStore.Bind(insert, "$category", series.Category);
                    ProDriveStore.Bind(insert, "$class", series.LicenseClass);
                    ProDriveStore.Bind(insert, "$minclass", series.MinLicenseClass);
                    ProDriveStore.Bind(insert, "$minlevel", series.MinLicenseLevel);
                    ProDriveStore.Bind(insert, "$fixed", series.FixedSetup ? 1 : 0);
                    ProDriveStore.Bind(insert, "$multi", series.Multiclass ? 1 : 0);
                    ProDriveStore.Bind(insert, "$vary", series.CarsVaryByWeek ? 1 : 0);
                    ProDriveStore.Bind(insert, "$cars", string.Join(" | ", series.Cars));
                    ProDriveStore.Bind(insert, "$timing", timing?.Text);
                    ProDriveStore.Bind(insert, "$repeat", timing?.RepeatMinutes ?? 0);
                    ProDriveStore.Bind(insert, "$offsets", timing == null ? "" : string.Join(",", timing.MinuteOffsets));
                    ProDriveStore.Bind(insert, "$parity", timing?.HourParity);
                    ProDriveStore.Bind(insert, "$slots", timing == null ? "" : string.Join(",", timing.WeeklySlots.Select(SlotText)));
                    ProDriveStore.Bind(insert, "$alt", timing != null && timing.AlternateWeeks ? 1 : 0);
                    ProDriveStore.Bind(insert, "$entries", series.MinEntriesForOfficial);
                    ProDriveStore.Bind(insert, "$split", series.SplitAt);
                    ProDriveStore.Bind(insert, "$drops", series.Drops);
                    ProDriveStore.Bind(insert, "$inc", series.IncidentLimit);
                    ProDriveStore.Bind(insert, "$dt", series.DriveThroughPenalties ? 1 : 0);
                    id = (long)insert.ExecuteScalar();
                }

                foreach (var week in series.Weeks)
                {
                    store.Exec(@"
INSERT OR REPLACE INTO schedule_weeks (series_id, week, starts_on, track_name, track_config, race_minutes,
  race_laps, heat_format, cars, sim_time, conditions)
VALUES ($id, $week, $start, $track, $config, $mins, $laps, $heat, $cars, $sim, $conditions);", tx,
                        ("$id", id),
                        ("$week", week.WeekNumber),
                        ("$start", week.StartsOnUtc == default ? null : week.StartsOnUtc.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)),
                        ("$track", week.TrackName),
                        ("$config", week.TrackConfig),
                        ("$mins", week.RaceMinutes),
                        ("$laps", week.RaceLaps),
                        ("$heat", week.HeatFormat),
                        ("$cars", string.Join(" | ", week.Cars)),
                        ("$sim", week.SimTimeOfDay),
                        ("$conditions", week.Conditions));
                }
            }

            var file = schedule.SourceFile != null ? new FileInfo(schedule.SourceFile) : null;
            store.Exec(@"
INSERT OR REPLACE INTO schedule_source (path, source_url, season, length, mtime, fetched_at, parsed_at, series, weeks)
VALUES ($path, $url, $season, $length, $mtime, $fetched, $parsed, $series, $weeks);", tx,
                ("$path", schedule.SourceFile),
                ("$url", sourceUrl),
                ("$season", schedule.Season),
                ("$length", file != null && file.Exists ? file.Length : 0),
                ("$mtime", file != null && file.Exists ? file.LastWriteTimeUtc.ToString("o", CultureInfo.InvariantCulture) : null),
                ("$fetched", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture)),
                ("$parsed", schedule.ParsedAtUtc.ToString("o", CultureInfo.InvariantCulture)),
                ("$series", schedule.Series.Count),
                ("$weeks", schedule.Series.Sum(s => s.Weeks.Count)));
            tx.Commit();
        }

        private static string SlotText(WeeklySlot slot) =>
            $"{slot.Day.ToString().Substring(0, 3)} {slot.Hour:00}:{slot.Minute:00}";

        private static readonly Dictionary<string, DayOfWeek> ShortDays = new Dictionary<string, DayOfWeek>(StringComparer.OrdinalIgnoreCase)
        {
            ["Mon"] = DayOfWeek.Monday, ["Tue"] = DayOfWeek.Tuesday, ["Wed"] = DayOfWeek.Wednesday,
            ["Thu"] = DayOfWeek.Thursday, ["Fri"] = DayOfWeek.Friday, ["Sat"] = DayOfWeek.Saturday, ["Sun"] = DayOfWeek.Sunday,
        };

        /// <summary>Parses "Sat 07:00" back into a slot.</summary>
        public static bool TrySlot(string text, out WeeklySlot slot)
        {
            slot = default;
            var parts = (text ?? "").Trim().Split(' ');
            if (parts.Length != 2 || !ShortDays.TryGetValue(parts[0], out var day)) return false;
            var clock = parts[1].Split(':');
            if (clock.Length != 2 || !int.TryParse(clock[0], out int hour) || !int.TryParse(clock[1], out int minute)) return false;
            slot = new WeeklySlot(day, hour, minute);
            return true;
        }

        /// <summary>The stored schedule as JSON, for the desk.</summary>
        internal static void WriteJson(ProDriveStore store, Utf8JsonWriter json)
        {
            json.WriteStartObject();
            using (var source = store.Command("SELECT path, source_url, season, fetched_at, parsed_at, series, weeks FROM schedule_source ORDER BY parsed_at DESC LIMIT 1"))
            using (var r = source.ExecuteReader())
            {
                if (r.Read())
                {
                    json.WriteString("season", Str(r, 2));
                    json.WriteString("sourceFile", Str(r, 0));
                    json.WriteString("sourceUrl", Str(r, 1));
                    json.WriteString("fetchedAt", Str(r, 3));
                    json.WriteString("parsedAt", Str(r, 4));
                }
                else
                {
                    json.WriteNull("season");
                }
            }

            // Weeks first, so one pass over each table is enough.
            var weeks = new Dictionary<long, List<Week>>();
            using (var cmd = store.Command(@"SELECT series_id, week, starts_on, track_name, track_config, race_minutes,
  race_laps, heat_format, cars, sim_time, conditions FROM schedule_weeks ORDER BY series_id, week"))
            using (var r = cmd.ExecuteReader())
            {
                while (r.Read())
                {
                    long id = r.GetInt64(0);
                    if (!weeks.TryGetValue(id, out var list)) weeks[id] = list = new List<Week>();
                    list.Add(new Week
                    {
                        Number = (int)r.GetInt64(1),
                        StartsOn = Str(r, 2),
                        TrackName = Str(r, 3),
                        TrackConfig = Str(r, 4),
                        RaceMinutes = r.IsDBNull(5) ? 0 : (int)r.GetInt64(5),
                        RaceLaps = r.IsDBNull(6) ? 0 : (int)r.GetInt64(6),
                        HeatFormat = Str(r, 7),
                        Cars = Str(r, 8),
                        SimTime = Str(r, 9),
                        Conditions = Str(r, 10),
                    });
                }
            }

            json.WritePropertyName("series");
            json.WriteStartArray();
            using (var cmd = store.Command(@"SELECT id, season, name, category, license_class, min_license_class, min_license_level,
  fixed_setup, multiclass, cars_vary_by_week, cars, timing_text, repeat_minutes, minute_offsets, hour_parity,
  weekly_slots, alternate_weeks, min_entries, split_at, drops, incident_limit, dt_penalties
FROM schedule_series ORDER BY category, license_class, name"))
            using (var r = cmd.ExecuteReader())
            {
                while (r.Read())
                {
                    long id = r.GetInt64(0);
                    json.WriteStartObject();
                    json.WriteNumber("id", id);
                    json.WriteString("season", Str(r, 1));
                    json.WriteString("name", Str(r, 2));
                    json.WriteString("category", Str(r, 3));
                    json.WriteString("licenseClass", Str(r, 4));
                    json.WriteString("minLicenseClass", Str(r, 5));
                    json.WriteNumber("minLicenseLevel", r.IsDBNull(6) ? 0 : r.GetDouble(6));
                    json.WriteBoolean("fixedSetup", Flag(r, 7));
                    json.WriteBoolean("multiclass", Flag(r, 8));
                    json.WriteBoolean("carsVaryByWeek", Flag(r, 9));
                    WriteList(json, "cars", Str(r, 10), " | ");
                    json.WriteString("timingText", Str(r, 11));
                    json.WriteNumber("repeatMinutes", r.IsDBNull(12) ? 0 : r.GetInt64(12));
                    WriteNumbers(json, "minuteOffsets", Str(r, 13));
                    json.WriteString("hourParity", Str(r, 14));
                    WriteList(json, "weeklySlots", Str(r, 15), ",");
                    json.WriteBoolean("alternateWeeks", Flag(r, 16));
                    json.WriteNumber("minEntries", r.IsDBNull(17) ? 0 : r.GetInt64(17));
                    json.WriteNumber("splitAt", r.IsDBNull(18) ? 0 : r.GetInt64(18));
                    json.WriteNumber("drops", r.IsDBNull(19) ? 0 : r.GetInt64(19));
                    json.WriteNumber("incidentLimit", r.IsDBNull(20) ? 0 : r.GetInt64(20));
                    json.WriteBoolean("driveThroughPenalties", Flag(r, 21));

                    json.WritePropertyName("weeks");
                    json.WriteStartArray();
                    foreach (var week in weeks.TryGetValue(id, out var list) ? list : Enumerable.Empty<Week>())
                    {
                        json.WriteStartObject();
                        json.WriteNumber("week", week.Number);
                        json.WriteString("startsOn", week.StartsOn);
                        json.WriteString("trackName", week.TrackName);
                        json.WriteString("trackConfig", week.TrackConfig);
                        json.WriteNumber("raceMinutes", week.RaceMinutes);
                        json.WriteNumber("raceLaps", week.RaceLaps);
                        json.WriteString("heatFormat", week.HeatFormat);
                        WriteList(json, "cars", week.Cars, " | ");
                        json.WriteString("simTimeOfDay", week.SimTime);
                        json.WriteString("conditions", week.Conditions);
                        json.WriteEndObject();
                    }
                    json.WriteEndArray();
                    json.WriteEndObject();
                }
            }
            json.WriteEndArray();
            json.WriteEndObject();
        }

        private sealed class Week
        {
            public int Number;
            public string StartsOn, TrackName, TrackConfig, HeatFormat, Cars, SimTime, Conditions;
            public int RaceMinutes, RaceLaps;
        }

        private static string Str(SqliteDataReader r, int i) => r.IsDBNull(i) ? null : r.GetString(i);
        private static bool Flag(SqliteDataReader r, int i) => !r.IsDBNull(i) && r.GetInt64(i) != 0;

        private static void WriteList(Utf8JsonWriter json, string name, string joined, string separator)
        {
            json.WritePropertyName(name);
            json.WriteStartArray();
            foreach (string part in (joined ?? "").Split(new[] { separator }, StringSplitOptions.RemoveEmptyEntries))
            {
                string value = part.Trim();
                if (value.Length > 0) json.WriteStringValue(value);
            }
            json.WriteEndArray();
        }

        private static void WriteNumbers(Utf8JsonWriter json, string name, string joined)
        {
            json.WritePropertyName(name);
            json.WriteStartArray();
            foreach (string part in (joined ?? "").Split(','))
            {
                if (int.TryParse(part.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out int value)) json.WriteNumberValue(value);
            }
            json.WriteEndArray();
        }
    }
}
