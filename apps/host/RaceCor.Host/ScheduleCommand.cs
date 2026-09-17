using System;
using System.IO;
using System.Linq;
using RaceCor.Data.Schedule;

namespace RaceCor.Host
{
    /// <summary>
    /// `RaceCor.Host schedule` — the season schedule from iRacing's official PDF. `--dump` prints the PDF as
    /// laid-out text, which is how the parser sees it.
    /// </summary>
    internal static class ScheduleCommand
    {
        public static string DefaultDirectory => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RaceCor", "schedule");

        /// <summary>The newest PDF in the schedule directory, or null.</summary>
        public static string NewestPdf(string directory) =>
            Directory.Exists(directory)
                ? new DirectoryInfo(directory).EnumerateFiles("*.pdf").OrderByDescending(f => f.LastWriteTimeUtc).Select(f => f.FullName).FirstOrDefault()
                : null;

        /// <summary>Where iRacing published the current season's PDF; overridden by --url or settings.json.</summary>
        public const string DefaultUrl = "https://us.v-cdn.net/6034148/uploads/597LPPDHT83M/2026s4.pdf";

        private static string Trim(string text, int n) =>
            string.IsNullOrEmpty(text) ? "" : text.Length <= n ? text : text.Substring(0, n - 1) + "…";

        public static int Run(HostOptions o)
        {
            string directory = o.ScheduleDir ?? DefaultDirectory;
            if (o.Fetch)
            {
                using var store = new RaceCor.Data.ProDriveStore(o.Db ?? RaceCor.Data.ProDriveStore.DefaultPath);
                string url = o.ScheduleUrl ?? DefaultUrl;
                Console.WriteLine(RaceCor.Data.Schedule.ScheduleFetcher.Refresh(store, url, directory, m => Console.WriteLine("  " + m)));
                return 0;
            }

            string pdf = o.Pdf ?? NewestPdf(directory);
            if (pdf == null)
            {
                Console.Error.WriteLine($"no schedule PDF in {o.ScheduleDir ?? DefaultDirectory} (pass --pdf <file>)");
                return 2;
            }

            var lines = PdfLayout.Lines(pdf);
            if (o.Dump)
            {
                if (o.Out != null)
                {
                    File.WriteAllLines(o.Out, lines);
                    Console.WriteLine($"{Path.GetFileName(pdf)} → {o.Out} ({lines.Count} lines)");
                }
                else
                {
                    foreach (var line in lines) Console.WriteLine(line);
                }
                return 0;
            }

            var schedule = ScheduleParser.Parse(lines, pdf);
            if (o.Store)
            {
                using var store = new RaceCor.Data.ProDriveStore(o.Db ?? RaceCor.Data.ProDriveStore.DefaultPath);
                RaceCor.Data.Schedule.ScheduleStore.Save(store, schedule, o.ScheduleUrl);
                Console.WriteLine($"stored {schedule.Season}: {schedule.Series.Count} series, " +
                                  $"{schedule.Series.Sum(s => s.Weeks.Count)} series-weeks → {store.Path}");
                return 0;
            }

            if (o.Json != null)
            {
                File.WriteAllText(o.Json, System.Text.Json.JsonSerializer.Serialize(schedule,
                    new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
                Console.WriteLine($"{Path.GetFileName(pdf)} → {o.Json} ({schedule.Series.Count} series)");
                return 0;
            }
            Console.WriteLine($"{Path.GetFileName(pdf)}: {schedule.Season}, {schedule.Series.Count} series, " +
                              $"{schedule.Series.Sum(s => s.Weeks.Count)} series-weeks");
            foreach (var group in schedule.Series.GroupBy(s => s.Category))
                Console.WriteLine($"  {group.Key,-12} {group.Count(),3} series, weeks {group.Min(s => s.Weeks.Count)}-{group.Max(s => s.Weeks.Count)}, " +
                                  $"{group.Count(s => s.Timing != null && s.Timing.RepeatMinutes > 0)} clock-repeating, " +
                                  $"{group.Count(s => s.Timing != null && s.Timing.WeeklySlots.Count > 0)} scheduled-day");
            var noTiming = schedule.Series.Where(s => s.Timing == null || (s.Timing.RepeatMinutes == 0 && s.Timing.WeeklySlots.Count == 0)).ToList();
            var noWeeks = schedule.Series.Where(s => s.Weeks.Count == 0).ToList();
            var noCars = schedule.Series.Where(s => s.Cars.Count == 0).ToList();
            var noLength = schedule.Series.SelectMany(s => s.Weeks.Select(w => (s, w))).Where(x => x.w.RaceMinutes == 0 && x.w.RaceLaps == 0).ToList();
            var body = new System.Collections.Generic.HashSet<string>(schedule.Series.Select(s => s.Name), StringComparer.OrdinalIgnoreCase);
            var contents = new System.Collections.Generic.HashSet<string>(schedule.ContentsSeries, StringComparer.OrdinalIgnoreCase);
            var missing = contents.Where(c => !body.Contains(c)).OrderBy(c => c).ToList();
            var extra = body.Where(b => !contents.Contains(b)).OrderBy(b => b).ToList();
            Console.WriteLine($"  contents lists {contents.Count} series; body parsed {body.Count} — {missing.Count} missing, {extra.Count} not in contents");
            foreach (var m in missing.Take(10)) Console.WriteLine($"    missing:   {m}");
            foreach (var e in extra.Take(10)) Console.WriteLine($"    unlisted:  {e}");
            Console.WriteLine($"  gaps: {noTiming.Count} without timing, {noWeeks.Count} without weeks, {noCars.Count} without cars, {noLength.Count} weeks without a race length");
            foreach (var s in noTiming.Take(5)) Console.WriteLine($"    no timing: {s.Name} ({s.Timing?.Text ?? "no line"})");
            foreach (var s in noWeeks.Take(5)) Console.WriteLine($"    no weeks:  {s.Name}");
            foreach (var s in noCars.Take(5)) Console.WriteLine($"    no cars:   {s.Name}");
            foreach (var group in noLength.GroupBy(x => x.s.Name).OrderByDescending(g => g.Count()).Take(8))
                Console.WriteLine($"    no length: {group.Count(),3} weeks — {group.Key} (e.g. {group.First().w.TrackName}: {Trim(group.First().w.Conditions, 90)})");

            if (o.Series != null)
            {
                foreach (var s in schedule.Series.Where(s => s.Name.IndexOf(o.Series, StringComparison.OrdinalIgnoreCase) >= 0))
                {
                    Console.WriteLine();
                    Console.WriteLine($"{s.Name}  [{s.Category} {s.LicenseClass}{(s.FixedSetup ? " fixed" : "")}]  cars: {string.Join(", ", s.Cars)}");
                    Console.WriteLine($"  min {s.MinLicenseClass} {s.MinLicenseLevel:F1} · min entries {s.MinEntriesForOfficial} · split {s.SplitAt} · drops {s.Drops} · DQ {s.IncidentLimit}x");
                    Console.WriteLine($"  timing: \"{s.Timing?.Text}\" → every {s.Timing?.RepeatMinutes}m at :{string.Join(",:", s.Timing?.MinuteOffsets ?? new System.Collections.Generic.List<int>())}" +
                                      $"{(s.Timing != null && s.Timing.HourParity != null ? " (" + s.Timing.HourParity + " hours)" : "")}" +
                                      $"{(s.Timing != null && s.Timing.WeeklySlots.Count > 0 ? " slots " + string.Join(", ", s.Timing.WeeklySlots.Select(w => $"{w.Day} {w.Hour:00}:{w.Minute:00}")) : "")}");
                    foreach (var w in s.Weeks)
                        Console.WriteLine($"  W{w.WeekNumber,-2} {w.StartsOnUtc:yyyy-MM-dd}  {w.TrackName}{(w.TrackConfig != null ? " — " + w.TrackConfig : "")}  " +
                                          $"{(w.RaceLaps > 0 ? w.RaceLaps + " laps" : w.RaceMinutes + " mins")}  [{w.SimTimeOfDay}]");
                }
            }
            return 0;
        }
    }
}
