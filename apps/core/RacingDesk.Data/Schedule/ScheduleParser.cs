using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;

namespace RacingDesk.Data.Schedule
{
    /// <summary>
    /// Reads iRacing's published season schedule PDF (as laid-out text — see <see cref="PdfLayout"/>) into
    /// <see cref="SeasonSchedule"/>. The document is a run of series blocks:
    /// <code>
    /// SPORTS CAR                                     ← category
    /// D Class Series (SPORTS CAR)                    ← licence class
    /// Caterham Academy Challenge - 2026 Season 4     ← series
    /// Caterham Academy                               ← car(s)
    /// Rookie (4.0) --> Pro/WC (4.0)                  ← licence range
    /// Races every hour at :00                        ← when races run
    /// Min entries for official: 6 | Split at: 24 | Drops: 4
    /// No incident DT penalties. DQ at 17 incidents.
    /// Week 1 (2026-09-15) Oulton Park Circuit - Fosters   69°F/20°C, Rain chance None, 15 mins
    ///                   (2026-09-19 12:00 1x)             Standing start, Cautions disabled,
    /// </code>
    /// </summary>
    public static class ScheduleParser
    {
        private static readonly Regex ClassHeader = new Regex(@"^(?<class>[RDCBA])\s+Class\s+Series\s+\((?<category>[A-Z ]+)\)$", RegexOptions.IgnoreCase);
        private static readonly Regex LicenseRange = new Regex(@"^(?<class>[A-Za-z][A-Za-z/ ]*?)\s*\((?<level>\d+(?:\.\d+)?)\)\s*-->", RegexOptions.IgnoreCase);
        // A title can read "2026 Season 4", "2026 Season" or "AMSOIL USAC Sprint Car 2026 - Season 4".
        private static readonly Regex SeasonInTitle = new Regex(@"\s*-?\s*\b(?<year>\d{4})\s*-?\s*Season(?:\s+(?<n>\d+))?\b", RegexOptions.IgnoreCase);
        private static readonly Regex WeekRow = new Regex(@"^Week\s+(?<n>\d+)\s+\((?<date>\d{4}-\d{2}-\d{2})\)\s+(?<rest>.+)$", RegexOptions.IgnoreCase);
        private static readonly Regex Entries = new Regex(@"Min\s+entries\s+for\s+official:\s*(?<min>\d+)(?:\s*\|\s*Split\s+at:\s*(?<split>\d+))?(?:\s*\|\s*Drops:\s*(?<drops>\d+))?", RegexOptions.IgnoreCase);
        // "No incident DT penalties. DQ at 17 incidents." / "Penalty every 17 incidents. DQ at 25 incidents." /
        // "Penalty at 50 incidents, and every 20 after. No incident DQ."
        private static readonly Regex IncidentRule = new Regex(@"\bincidents?\b.*$|^No incident", RegexOptions.IgnoreCase);
        private static readonly Regex IncidentLimit = new Regex(@"DQ\s+at\s+(?<limit>\d+)\s+incidents", RegexOptions.IgnoreCase);
        private static readonly Regex RaceLength = new Regex(@"(?<n>\d+)\s*(?<unit>mins?|minutes?|laps?)\s*$", RegexOptions.IgnoreCase);
        // The in-sim date, time of day and time multiplier, e.g. "(2026-09-19 12:00 1x)". It is typeset under
        // the track, but a long conditions column pushes it along the line, so it is matched anywhere.
        private static readonly Regex SimTime = new Regex(@"\((?<when>\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}[^)]*)\)");
        private static readonly Regex HeatToken = new Regex(@"\b[HCF]:\d+L\b", RegexOptions.IgnoreCase);
        // Every week row carries exactly one weather cell, and it is where the right-hand columns begin.
        private static readonly Regex Weather = new Regex(@"\s+(?=\d{1,3}°[FC]/|Constant weather)", RegexOptions.IgnoreCase);
        private static readonly Regex Columns = new Regex(@"\s{2,}");
        private const string PageHeader = "Current iRacing Race Schedule";

        public static SeasonSchedule Parse(IEnumerable<string> lines, string sourceFile = null)
        {
            var schedule = new SeasonSchedule { SourceFile = sourceFile, ParsedAtUtc = DateTime.UtcNow };
            string category = null, licenseClass = null;
            var pending = new List<string>();
            var seasons = new List<string>();
            ScheduleSeries series = null;

            foreach (string raw in lines)
            {
                string line = raw ?? "";
                string text = PdfLayout.Tidy(line);
                if (text.Length == 0 || text == PdfLayout.PageBreak) continue;
                // The title repeats at the top of every page.
                if (text.StartsWith(PageHeader, StringComparison.OrdinalIgnoreCase)) continue;
                // Contents pages: every entry is padded out with dot leaders. The series entries are indented
                // past the category and class headings, and are the set the body has to reproduce.
                if (text.Contains(". . "))
                {
                    // The entry ends in dot leaders and a page number, and the dots can run into it ("... 1.95").
                    string entry = PdfLayout.Tidy(Regex.Replace(text, @"\s*(\.\s+)+.*$", ""));
                    if (line.StartsWith("      ", StringComparison.Ordinal) && !ClassHeader.IsMatch(entry) && entry.Length > 0)
                        schedule.ContentsSeries.Add(SeriesName(entry));
                    continue;
                }
                // Page numbers sit alone at the foot of a page.
                if (Regex.IsMatch(text, @"^\d{1,3}$")) continue;

                var classHeader = ClassHeader.Match(text);
                if (classHeader.Success)
                {
                    licenseClass = classHeader.Groups["class"].Value.ToUpperInvariant();
                    category = Category(classHeader.Groups["category"].Value);
                    pending.Clear();
                    continue;
                }
                if (BareCategory(text) != null)
                {
                    category = BareCategory(text);
                    pending.Clear();
                    continue;
                }

                var license = LicenseRange.Match(text);
                if (license.Success && pending.Count > 0)
                {
                    series = StartSeries(schedule, pending, category, licenseClass, license, seasons);
                    pending.Clear();
                    continue;
                }

                if (series != null && series.Timing == null && IsTimingLine(text))
                {
                    // "Races on every hour on the hour | Qualifying every hour at :30" — the race part is first.
                    series.Timing = RaceTimingParser.Parse(text.Split('|')[0]);
                    continue;
                }

                if (series != null)
                {
                    var entries = Entries.Match(text);
                    if (entries.Success)
                    {
                        series.MinEntriesForOfficial = Int(entries.Groups["min"]);
                        series.SplitAt = Int(entries.Groups["split"]);
                        series.Drops = Int(entries.Groups["drops"]);
                        continue;
                    }
                    if (series.Weeks.Count == 0 && IncidentRule.IsMatch(text) && text.IndexOf("incident", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        var limit = IncidentLimit.Match(text);
                        series.IncidentLimit = limit.Success ? Int(limit.Groups["limit"]) : 0;
                        // A series either takes drive-throughs for incidents or says it doesn't.
                        series.DriveThroughPenalties = Regex.IsMatch(text, @"\bpenalt", RegexOptions.IgnoreCase) &&
                                                       text.IndexOf("No incident DT", StringComparison.OrdinalIgnoreCase) < 0;
                        continue;
                    }
                }

                // Week rows and their continuations are read from the raw line: the gaps between columns are the
                // only thing separating the track from the weather and the race length.
                var week = WeekRow.Match(line.TrimStart());
                if (week.Success && series != null)
                {
                    ResolveWrappedLength(series);
                    series.Weeks.Add(ReadWeek(week));
                    pending.Clear();
                    continue;
                }

                // Continuation of the week above: the in-sim time of day, a rotating car, or more conditions.
                if (series != null && series.Weeks.Count > 0 && line.Length > 0 && char.IsWhiteSpace(line[0]))
                {
                    var last = series.Weeks[series.Weeks.Count - 1];
                    string first = FirstColumn(line);
                    var simTime = SimTime.Match(text);
                    if (simTime.Success && last.SimTimeOfDay == null) last.SimTimeOfDay = PdfLayout.Tidy(simTime.Groups["when"].Value);

                    // The leftmost column of a continuation belongs to the track: the time stamp, this week's car
                    // for a rotating series, or the rest of a track config too long for its column.
                    bool consumedFirst = SimTime.IsMatch(first);
                    if (!consumedFirst && IsCarName(first))
                    {
                        if (series.CarsVaryByWeek && last.Cars.Count == 0)
                        {
                            foreach (string car in first.Split(',')) last.Cars.Add(PdfLayout.Tidy(car));
                            consumedFirst = true;
                        }
                        else if (last.ConfigWrapped)
                        {
                            last.TrackConfig = string.IsNullOrEmpty(last.TrackConfig)
                                ? PdfLayout.Tidy(first)
                                : PdfLayout.Tidy(last.TrackConfig + " " + first);
                            last.ConfigWrapped = false;
                            consumedFirst = true;
                        }
                    }
                    string extra = consumedFirst ? Rest(line) : text;
                    if (extra.Length > 0) last.Conditions = Conditions(last.Conditions, extra);
                    last.Tails.Add(LastToken(text));
                    continue;
                }

                // Anything else at the left margin belongs to the next series' header block.
                ResolveWrappedLength(series);
                pending.Add(text);
                // Long enough to hold a multiclass series' whole car list above its title.
                if (pending.Count > 40) pending.RemoveAt(0);
            }

            ResolveWrappedLength(series);
            // Most series carry the season in their title; the year-long championships say just "2026 Season".
            schedule.Season = seasons.Count > 0
                ? seasons.GroupBy(s => s).OrderByDescending(g => g.Count()).First().Key
                : null;
            return schedule;
        }

        /// <summary>
        /// The line saying when races run. Most start with "Races", but iRacing also writes "Every hour on the
        /// :30", "5 Timeslots Per Week", and day-and-hour lists in GMT.
        /// </summary>
        private static bool IsTimingLine(string text) =>
            Regex.IsMatch(text, @"^(races?\b|every\b|\d+\s+timeslots?\b)", RegexOptions.IgnoreCase) ||
            Regex.IsMatch(text, @"\bGMT\b");

        /// <summary>A rotating series prints that week's car above the conditions; rules text never reads like one.</summary>
        private static bool IsCarName(string text) =>
            text.Length > 2 &&
            !Regex.IsMatch(text, @"\b(start|cautions?|qual|scrutiny|tire|fuel|drivers?|laps?|mins?|lucky|penalt)\b", RegexOptions.IgnoreCase);

        private static ScheduleSeries StartSeries(SeasonSchedule schedule, List<string> pending, string category, string licenseClass, Match license, List<string> seasons)
        {
            // The title is the line that carries the season; the lines between it and the licence range are cars.
            int titleIndex = pending.FindLastIndex(p => SeasonInTitle.IsMatch(p));
            if (titleIndex < 0) titleIndex = 0;
            string title = pending[titleIndex];
            var season = SeasonInTitle.Match(title);
            if (season.Success)
            {
                seasons.Add(season.Groups["n"].Success
                    ? $"{season.Groups["year"].Value} Season {season.Groups["n"].Value}"
                    : $"{season.Groups["year"].Value} Season");
            }

            var series = new ScheduleSeries
            {
                Name = SeriesName(title),
                Category = category,
                LicenseClass = licenseClass,
                MinLicenseClass = PdfLayout.Tidy(license.Groups["class"].Value),
                MinLicenseLevel = double.Parse(license.Groups["level"].Value, CultureInfo.InvariantCulture),
                FixedSetup = Regex.IsMatch(title, @"\bfixed\b", RegexOptions.IgnoreCase),
            };
            // A car list wraps across lines mid-name, so join the lines before splitting on commas.
            string carText = PdfLayout.Tidy(string.Join(" ", pending.Skip(titleIndex + 1)));
            if (carText.StartsWith("See race week", StringComparison.OrdinalIgnoreCase))
            {
                series.CarsVaryByWeek = true;
            }
            else
            {
                foreach (string one in carText.Split(','))
                {
                    string name = PdfLayout.Tidy(one);
                    if (name.Length > 0) series.Cars.Add(name);
                }
            }
            series.Multiclass = series.Cars.Count > 1;
            schedule.Series.Add(series);
            return series;
        }

        /// <summary>
        /// Takes the race length from the wrapped right-hand column once a week's block has been read: a bare
        /// number at the end of one line and its unit at the end of a later one.
        /// </summary>
        private static void ResolveWrappedLength(ScheduleSeries series)
        {
            if (series == null || series.Weeks.Count == 0) return;
            var week = series.Weeks[series.Weeks.Count - 1];
            if (week.RaceMinutes > 0 || week.RaceLaps > 0 || week.Tails.Count == 0) return;

            // Dirt heat racing prints its format in that column instead: a heat, a consolation and a feature.
            var heats = week.Tails
                .Select(t => Regex.Match(t.Trim(',', '.'), @"^(?<part>[HCF]):(?<laps>\d+)L$", RegexOptions.IgnoreCase))
                .Where(m => m.Success)
                .ToList();
            if (heats.Count > 0)
            {
                week.HeatFormat = string.Join(" ", heats.Select(m => m.Value));
                var feature = heats.LastOrDefault(m => m.Groups["part"].Value.Equals("F", StringComparison.OrdinalIgnoreCase));
                if (feature != null) week.RaceLaps = int.Parse(feature.Groups["laps"].Value, CultureInfo.InvariantCulture);
                if (week.RaceLaps > 0) return;
            }

            int number = 0;
            foreach (string tail in week.Tails)
            {
                string token = tail.Trim(',', '.', ';', ':');
                if (Regex.IsMatch(token, @"^\d{1,4}$"))
                {
                    number = int.Parse(token, CultureInfo.InvariantCulture);
                    continue;
                }
                if (number == 0) continue;
                if (Regex.IsMatch(token, @"^(mins?|minutes?)$", RegexOptions.IgnoreCase))
                {
                    week.RaceMinutes = number;
                    week.Conditions = WithoutLength(week.Conditions, number, token);
                    return;
                }
                if (Regex.IsMatch(token, @"^laps?$", RegexOptions.IgnoreCase))
                {
                    week.RaceLaps = number;
                    week.Conditions = WithoutLength(week.Conditions, number, token);
                    return;
                }
            }
        }

        /// <summary>
        /// Appends a line of the conditions column, leaving out what belongs to other columns: the in-sim time
        /// stamp and the race length or heat format, both of which are typeset inside the sentence.
        /// </summary>
        private static string Conditions(string existing, string addition)
        {
            string text = SimTime.Replace(addition, "");
            text = HeatToken.Replace(text, "");
            text = Regex.Replace(text, @"\b\d{1,4}\s*(mins?|laps?)\b", "", RegexOptions.IgnoreCase);
            text = PdfLayout.Tidy(text);
            return text.Length == 0 ? existing : PdfLayout.Tidy((existing + " " + text).Trim());
        }

        /// <summary>
        /// Takes the length column's two tokens out of the conditions sentence they were typeset inside, so
        /// "Grid by 240 class, Rolling start, Local enforced mins cautions" reads as iRacing wrote it.
        /// </summary>
        private static string WithoutLength(string conditions, int number, string unit)
        {
            if (string.IsNullOrEmpty(conditions)) return conditions;
            string text = Regex.Replace(conditions, $@"\s*\b{number}\b", "", RegexOptions.None);
            text = Regex.Replace(text, $@"\s*\b{Regex.Escape(unit)}\b", "", RegexOptions.IgnoreCase);
            return PdfLayout.Tidy(text);
        }

        private static string LastToken(string text)
        {
            var parts = text.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
            return parts.Length > 0 ? parts[parts.Length - 1] : "";
        }

        private static ScheduleWeek ReadWeek(Match week)
        {
            string rest = week.Groups["rest"].Value;
            string trackCell, conditions;

            // The row is cut at the weather: every week row carries exactly one temperature pair (or "Constant
            // weather") and it begins the right-hand columns. Column gaps are no help — they shrink to a single
            // space between the track and the weather, and grow to two inside a track's own name.
            var weather = Weather.Match(rest);
            if (weather.Success)
            {
                trackCell = PdfLayout.Tidy(rest.Substring(0, weather.Index));
                conditions = PdfLayout.Tidy(rest.Substring(weather.Index));
            }
            else
            {
                var cells = Columns.Split(rest).Where(c => c.Trim().Length > 0).Select(c => c.Trim()).ToList();
                trackCell = cells.Count > 0 ? PdfLayout.Tidy(cells[0]) : "";
                conditions = PdfLayout.Tidy(string.Join(" ", cells.Skip(1)));
            }

            // "Autodromo Internazionale Enzo e Dino Ferrari -" with nothing after it: the config was too long
            // for the column and continues on the next line.
            bool configWrapped = trackCell.EndsWith("-", StringComparison.Ordinal);
            if (configWrapped) trackCell = trackCell.TrimEnd('-', ' ');

            var parts = trackCell.Split(new[] { " - " }, 2, StringSplitOptions.None);
            var record = new ScheduleWeek
            {
                ConfigWrapped = configWrapped,
                WeekNumber = int.Parse(week.Groups["n"].Value, CultureInfo.InvariantCulture),
                TrackName = PdfLayout.Tidy(parts[0]),
                TrackConfig = parts.Length > 1 ? PdfLayout.Tidy(parts[1]) : null,
                Conditions = Conditions(null, conditions),
            };
            if (PdfLayout.TryDate(week.Groups["date"].Value, out var start)) record.StartsOnUtc = start;

            record.Tails.Add(LastToken(PdfLayout.Tidy(rest)));
            var length = RaceLength.Match(PdfLayout.Tidy(rest));
            if (length.Success)
            {
                int n = int.Parse(length.Groups["n"].Value, CultureInfo.InvariantCulture);
                if (length.Groups["unit"].Value.StartsWith("lap", StringComparison.OrdinalIgnoreCase)) record.RaceLaps = n;
                else record.RaceMinutes = n;
            }
            return record;
        }

        /// <summary>
        /// "Caterham Academy Challenge - 2026 Season 4" → "Caterham Academy Challenge". The season and the setup
        /// marker become fields, so they come out of the name — and iRacing writes the marker in more than one
        /// place at once ("NASCAR Tour Modified Series - Fixed - 2026 Season 4 - Fixed").
        /// </summary>
        public static string SeriesName(string title)
        {
            string name = SeasonInTitle.Replace(PdfLayout.Tidy(title), " ");
            // The setup marker can appear twice, with or without a dash. Keep exactly one, at the end: it is part
            // of how iRacing names a series, and it is what tells the fixed and open variants apart.
            bool fixedSetup = Regex.IsMatch(name, @"\bfixed\b", RegexOptions.IgnoreCase);
            bool open = Regex.IsMatch(name, @"\bopen\b", RegexOptions.IgnoreCase);
            name = Regex.Replace(name, @"\s*-?\s*\b(Fixed|Open)\b", "", RegexOptions.IgnoreCase);
            name = Regex.Replace(name, @"\s*-\s*$", "");
            name = Regex.Replace(name, @"^\s*-\s*", "");
            name = PdfLayout.Tidy(name);
            if (fixedSetup) name += " - Fixed";
            else if (open) name += " - Open";
            return name;
        }

        private static string BareCategory(string text)
        {
            string tidy = PdfLayout.Tidy(text).ToUpperInvariant();
            switch (tidy)
            {
                case "OVAL": return "oval";
                case "SPORTS CAR": return "sports_car";
                case "FORMULA CAR": return "formula_car";
                case "DIRT OVAL": return "dirt_oval";
                case "DIRT ROAD": return "dirt_road";
                default: return null;
            }
        }

        private static string Category(string printed)
        {
            string tidy = PdfLayout.Tidy(printed).ToUpperInvariant();
            return BareCategory(tidy) ?? (tidy == "UNRANKED" ? "unranked" : tidy.ToLowerInvariant().Replace(' ', '_'));
        }

        /// <summary>The leftmost column of a line, ignoring the indentation that puts it there.</summary>
        private static string FirstColumn(string text)
        {
            var cells = Columns.Split(text.TrimStart());
            return cells.Length > 0 ? cells[0].Trim() : text.Trim();
        }

        private static string Rest(string text)
        {
            var cells = Columns.Split(text.TrimStart());
            return cells.Length > 1 ? PdfLayout.Tidy(string.Join(" ", cells.Skip(1))) : "";
        }

        private static int Int(Group group) =>
            group.Success && int.TryParse(group.Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out int n) ? n : 0;
    }
}
