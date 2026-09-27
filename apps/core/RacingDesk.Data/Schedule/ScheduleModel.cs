using System;
using System.Collections.Generic;

namespace RacingDesk.Data.Schedule
{
    /// <summary>One season's official series, parsed from iRacing's published schedule PDF.</summary>
    public sealed class SeasonSchedule
    {
        /// <summary>As printed in the PDF, e.g. "2026 Season 4".</summary>
        public string Season { get; set; }
        public string SourceFile { get; set; }
        public DateTime ParsedAtUtc { get; set; }
        public List<ScheduleSeries> Series { get; } = new List<ScheduleSeries>();
        /// <summary>Series names as the contents pages list them — the body must yield the same set.</summary>
        public List<string> ContentsSeries { get; } = new List<string>();
        /// <summary>Lines the parser could not place — empty when the PDF's layout is fully understood.</summary>
        public List<string> Unparsed { get; } = new List<string>();
    }

    public sealed class ScheduleSeries
    {
        public string Name { get; set; }
        /// <summary>Licence category: oval, sports_car, formula_car, dirt_oval, dirt_road — as the store's sessions use.</summary>
        public string Category { get; set; }
        /// <summary>Licence class letter the series is grouped under: R, D, C, B, A.</summary>
        public string LicenseClass { get; set; }
        /// <summary>Lowest licence that can enter, as a level ("Rookie (1.0)" → 1.0 with class R).</summary>
        public string MinLicenseClass { get; set; }
        public double MinLicenseLevel { get; set; }
        public bool FixedSetup { get; set; }
        public bool Multiclass { get; set; }
        /// <summary>"See race week for cars in use that week" — the car is in each week row instead.</summary>
        public bool CarsVaryByWeek { get; set; }
        public List<string> Cars { get; } = new List<string>();
        public RaceTiming Timing { get; set; }
        public int MinEntriesForOfficial { get; set; }
        public int SplitAt { get; set; }
        public int Drops { get; set; }
        /// <summary>Incident points that disqualify, from "DQ at 17 incidents". 0 when the PDF doesn't say.</summary>
        public int IncidentLimit { get; set; }
        public bool DriveThroughPenalties { get; set; }
        public List<ScheduleWeek> Weeks { get; } = new List<ScheduleWeek>();
    }

    public sealed class ScheduleWeek
    {
        public int WeekNumber { get; set; }
        /// <summary>The week's first day as printed (a Tuesday); iRacing rolls weeks at Tuesday 12:00 UTC.</summary>
        public DateTime StartsOnUtc { get; set; }
        public string TrackName { get; set; }
        public string TrackConfig { get; set; }
        public int RaceMinutes { get; set; }
        /// <summary>Race distance in laps. For dirt heat racing this is the feature's laps.</summary>
        public int RaceLaps { get; set; }
        /// <summary>Dirt heat racing as printed: "H:8L C:10L F:50L" — heat, consolation and feature laps.</summary>
        public string HeatFormat { get; set; }
        /// <summary>Weather and session rules as printed, for display.</summary>
        public string Conditions { get; set; }
        /// <summary>The in-sim date and time of day the session runs at, and its time multiplier ("2026-09-19 12:00 1x").</summary>
        public string SimTimeOfDay { get; set; }
        /// <summary>Cars for this week, when a series rotates them; empty means the series list applies.</summary>
        public List<string> Cars { get; } = new List<string>();
        /// <summary>
        /// The last token of each line of this week's block. The race length sits in a narrow right-hand column
        /// which wraps when the conditions run long, leaving "240" and "mins" on different lines.
        /// </summary>
        internal List<string> Tails { get; } = new List<string>();
        /// <summary>The week row ended in a dash, so its track config continues on the next line.</summary>
        internal bool ConfigWrapped { get; set; }
    }

    /// <summary>When a series' races go off, parsed from lines like "Races every 2 hours at :15 past".</summary>
    public sealed class RaceTiming
    {
        public string Text { get; set; }
        /// <summary>Minutes between races for a clock-repeating series; 0 for scheduled-day series.</summary>
        public int RepeatMinutes { get; set; }
        /// <summary>Minutes past the hour races start at, e.g. [15, 45]. Empty means on the hour.</summary>
        public List<int> MinuteOffsets { get; } = new List<int>();
        /// <summary>"odd" or "even" when a 2-hourly series is pinned to odd or even hours.</summary>
        public string HourParity { get; set; }
        /// <summary>Fixed weekly slots (endurance and weekend series), in UTC.</summary>
        public List<WeeklySlot> WeeklySlots { get; } = new List<WeeklySlot>();
        /// <summary>The weekly slots only run on alternate weeks ("every other Saturday").</summary>
        public bool AlternateWeeks { get; set; }
    }

    public struct WeeklySlot
    {
        public WeeklySlot(DayOfWeek day, int hour, int minute)
        {
            Day = day;
            Hour = hour;
            Minute = minute;
        }
        public DayOfWeek Day { get; }
        public int Hour { get; }
        public int Minute { get; }
    }
}
