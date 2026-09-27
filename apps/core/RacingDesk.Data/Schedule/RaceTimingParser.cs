using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;

namespace RacingDesk.Data.Schedule
{
    /// <summary>
    /// Reads the one line each series gives for when its races run. iRacing writes these by hand, so the same
    /// meaning arrives many ways: "Races every hour at :00", "Races hourly at the top of the hour",
    /// "Races every odd 2 hours on the hour", "Races Thur &amp; Sat at 10, 19 GMT &amp; Fri &amp; Sun at 1,4 GMT".
    /// </summary>
    public static class RaceTimingParser
    {
        private static readonly Regex EveryNHours = new Regex(@"every (?:(?<odd>odd|even) )?(?<n>\d+|other|two|three|four|six) hours?", RegexOptions.IgnoreCase);
        private static readonly Regex EveryNMinutes = new Regex(@"every (?<n>\d+|thirty|fifteen) minutes?", RegexOptions.IgnoreCase);
        private static readonly Regex ColonOffset = new Regex(@":(?<m>\d{1,2})\b", RegexOptions.IgnoreCase);
        private static readonly Regex BarePastOffset = new Regex(@"\b(?<m>\d{1,2}) past\b", RegexOptions.IgnoreCase);

        private static readonly Dictionary<string, DayOfWeek> Days = new Dictionary<string, DayOfWeek>(StringComparer.OrdinalIgnoreCase)
        {
            ["mon"] = DayOfWeek.Monday, ["monday"] = DayOfWeek.Monday, ["mondays"] = DayOfWeek.Monday,
            ["tue"] = DayOfWeek.Tuesday, ["tues"] = DayOfWeek.Tuesday, ["tuesday"] = DayOfWeek.Tuesday, ["tuesdays"] = DayOfWeek.Tuesday,
            ["wed"] = DayOfWeek.Wednesday, ["weds"] = DayOfWeek.Wednesday, ["wednesday"] = DayOfWeek.Wednesday, ["wednesdays"] = DayOfWeek.Wednesday,
            ["thu"] = DayOfWeek.Thursday, ["thur"] = DayOfWeek.Thursday, ["thurs"] = DayOfWeek.Thursday, ["thursday"] = DayOfWeek.Thursday, ["thursdays"] = DayOfWeek.Thursday,
            ["fri"] = DayOfWeek.Friday, ["friday"] = DayOfWeek.Friday, ["fridays"] = DayOfWeek.Friday,
            ["sat"] = DayOfWeek.Saturday, ["saturday"] = DayOfWeek.Saturday, ["saturdays"] = DayOfWeek.Saturday,
            ["sun"] = DayOfWeek.Sunday, ["sunday"] = DayOfWeek.Sunday, ["sundays"] = DayOfWeek.Sunday,
        };

        private static readonly Dictionary<string, int> Numbers = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase)
        {
            ["other"] = 2, ["two"] = 2, ["three"] = 3, ["four"] = 4, ["six"] = 6, ["thirty"] = 30, ["fifteen"] = 15,
        };

        public static RaceTiming Parse(string line)
        {
            var timing = new RaceTiming { Text = PdfLayout.Tidy(line) };
            string text = timing.Text;
            if (string.IsNullOrEmpty(text)) return timing;

            // ── Fixed weekly slots: "Saturdays 9 and 19 GMT and Sundays 17 GMT" ──
            ReadWeeklySlots(text, timing);
            if (timing.WeeklySlots.Count > 0)
            {
                timing.AlternateWeeks = text.IndexOf("every other", StringComparison.OrdinalIgnoreCase) >= 0;
                return timing;
            }

            // ── Clock-repeating: an interval and the minutes past the hour ──
            var minutes = EveryNMinutes.Match(text);
            var hours = EveryNHours.Match(text);
            if (minutes.Success) timing.RepeatMinutes = Value(minutes.Groups["n"].Value);
            else if (hours.Success)
            {
                timing.RepeatMinutes = 60 * Math.Max(1, Value(hours.Groups["n"].Value));
                if (hours.Groups["odd"].Success) timing.HourParity = hours.Groups["odd"].Value.ToLowerInvariant();
            }
            else if (Regex.IsMatch(text, @"\b(hourly|every hour|each hour)\b", RegexOptions.IgnoreCase)) timing.RepeatMinutes = 60;

            foreach (Match m in ColonOffset.Matches(text)) AddOffset(timing, int.Parse(m.Groups["m"].Value, CultureInfo.InvariantCulture));
            foreach (Match m in BarePastOffset.Matches(text)) AddOffset(timing, int.Parse(m.Groups["m"].Value, CultureInfo.InvariantCulture));
            if (Regex.IsMatch(text, @"half past", RegexOptions.IgnoreCase)) AddOffset(timing, 30);
            if (Regex.IsMatch(text, @"(on the hour|top of the hour)", RegexOptions.IgnoreCase)) AddOffset(timing, 0);
            if (timing.MinuteOffsets.Count == 0 && timing.RepeatMinutes > 0) AddOffset(timing, 0);
            timing.MinuteOffsets.Sort();

            // Two offsets half an hour apart on an hourly series is a race every 30 minutes.
            if (timing.RepeatMinutes == 60 && timing.MinuteOffsets.Count == 2 &&
                timing.MinuteOffsets[1] - timing.MinuteOffsets[0] == 30)
            {
                timing.RepeatMinutes = 30;
            }
            return timing;
        }

        private static void AddOffset(RaceTiming timing, int minute)
        {
            if (minute >= 0 && minute < 60 && !timing.MinuteOffsets.Contains(minute)) timing.MinuteOffsets.Add(minute);
        }

        private static int Value(string token) =>
            int.TryParse(token, NumberStyles.Integer, CultureInfo.InvariantCulture, out int n) ? n
            : Numbers.TryGetValue(token, out int word) ? word
            : 0;

        /// <summary>
        /// Walks the line collecting day names, then the hours that follow them, flushing a slot set at each
        /// "GMT". "Thur &amp; Sat at 10, 19 GMT &amp; Fri &amp; Sun at 1,4 GMT" is two sets of days and hours.
        /// </summary>
        private static void ReadWeeklySlots(string text, RaceTiming timing)
        {
            if (text.IndexOf("GMT", StringComparison.OrdinalIgnoreCase) < 0 &&
                !Days.Keys.Any(d => Regex.IsMatch(text, $@"\b{d}\b", RegexOptions.IgnoreCase)))
            {
                return;
            }

            var days = new List<DayOfWeek>();
            var lastDays = new List<DayOfWeek>();
            var times = new List<(int Hour, int Minute)>();
            foreach (string token in Regex.Split(text, @"[\s,&]+").Where(t => t.Length > 0))
            {
                string word = token.Trim('.', ';');
                if (Days.TryGetValue(word, out var day))
                {
                    // A new day after times have been collected starts a fresh set.
                    if (times.Count > 0) Flush(days, times, timing);
                    if (!days.Contains(day)) days.Add(day);
                    continue;
                }
                if (word.Equals("GMT", StringComparison.OrdinalIgnoreCase) || word.Equals("UTC", StringComparison.OrdinalIgnoreCase))
                {
                    if (days.Count > 0) lastDays = new List<DayOfWeek>(days);
                    Flush(days, times, timing);
                    continue;
                }
                var clock = Regex.Match(word, @"^(?<h>\d{1,2})(?::(?<m>\d{2}))?$");
                // "Sunday at 0 GMT, 20 GMT" — a time after a flush still belongs to the day last named.
                if (clock.Success && days.Count == 0 && lastDays.Count > 0) days.AddRange(lastDays);
                if (clock.Success && days.Count > 0)
                {
                    int hour = int.Parse(clock.Groups["h"].Value, CultureInfo.InvariantCulture);
                    int minute = clock.Groups["m"].Success ? int.Parse(clock.Groups["m"].Value, CultureInfo.InvariantCulture) : 0;
                    if (hour < 24 && minute < 60) times.Add((hour, minute));
                }
            }
            Flush(days, times, timing);
        }

        private static void Flush(List<DayOfWeek> days, List<(int Hour, int Minute)> times, RaceTiming timing)
        {
            if (days.Count > 0 && times.Count > 0)
            {
                foreach (var day in days)
                    foreach (var (hour, minute) in times)
                    {
                        var slot = new WeeklySlot(day, hour, minute);
                        if (!timing.WeeklySlots.Contains(slot)) timing.WeeklySlots.Add(slot);
                    }
                days.Clear();
            }
            times.Clear();
        }
    }
}
