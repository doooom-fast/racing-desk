using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using NUnit.Framework;
using RaceCor.Data.Schedule;

namespace RaceCorProDrive.Tests.IRacing
{
    /// <summary>
    /// The season-schedule parser. The synthetic fixture reproduces the layout iRacing's PDF uses, including the
    /// awkward parts: a track config too long for its column, a race length whose number and unit land on
    /// different lines, dirt heat racing, and a series whose car changes every week.
    /// </summary>
    [TestFixture]
    public class ScheduleParserTests
    {
        // Column positions matter: the weather column is where the track cell ends.
        private static readonly string[] Fixture =
        {
            "Current iRacing Race Schedule",
            "",
            "      Caterham Academy Challenge - 2026 Season 4 . . . . . . . . . . . . . . . 68",
            "      Big Block Modified Series - 2026 Season 4 . . . . . . . . . . . . . . . . 170",
            "      Ring Meister by LVRY - 2026 Season 4 . . . . . . . . . . . . . . . . . . . 88",
            "",
            "SPORTS CAR",
            "D Class Series (SPORTS CAR)",
            "Caterham Academy Challenge - 2026 Season 4",
            "Caterham Academy",
            "Rookie (4.0) --> Pro/WC (4.0)",
            "Races every hour at :00",
            "Min entries for official: 6 | Split at: 24 | Drops: 4",
            "No incident DT penalties. DQ at 17 incidents.",
            "Week 1 (2026-09-15) Oulton Park Circuit - Fosters    69°F/20°C, Rain chance None, 15 mins",
            "                  (2026-09-19 12:00 1x)              Standing start, Cautions disabled,",
            "                                                     Qual scrutiny - Permissive.",
            "Week 2 (2026-09-22) Autodromo Internazionale Enzo e Dino Ferrari - 65°F/18°C, Rain chance None, 25 mins",
            "                  Grand Prix                         Standing start, Local enforced",
            "                  (2026-09-26 13:40 1x)              cautions.",
            "",
            "C Class Series (SPORTS CAR)",
            "Ring Meister by LVRY - 2026 Season 4",
            "See race week for cars in use that week.",
            "Class D (4.0) --> Pro/WC (4.0)",
            "Races on every hour on the hour | Qualifying every hour at :30",
            "Min entries for official: 6 | Split at: 30 | Drops: 4",
            "Penalty every 17 incidents. DQ at 25 incidents.",
            "Week 1 (2026-09-15) Nürburgring Nordschleife - Industriefahrten 65°F/19°C, Rain chance None,  3 laps",
            "                    Caterham 420R                            Detached qual, Rolling start,",
            "                    (2026-09-19 13:45 1x)                    Qual scrutiny - Strict.",
            "",
            "DIRT OVAL",
            "C Class Series (DIRT OVAL)",
            "Big Block Modified Series - 2026 Season 4",
            "Dirt Big Block Modified",
            "Class D (4.0) --> Pro/WC (4.0), Heat racing",
            "Races hourly at :30",
            "Min entries for official: 6 | Split at: 20 | Drops: 4",
            "No incident DT penalties. DQ at 12 incidents.",
            "Week 1 (2026-09-15) Knoxville Raceway              69°F/21°C, Rain chance None, Rolling H:8L",
            "                 (2026-09-19 19:15 1x)             start, Full course cautions, Cautions C:10L",
            "                                                   laps do not count. F:50L",
            "",
            "SPORTS CAR",
            "B Class Series (SPORTS CAR)",
            "Endurance Trophy - 2026 Season",
            "Porsche 963 GTP, Ferrari 499P",
            "Rookie (4.0) --> Pro/WC (4.0), Team racing",
            "Races on Saturday at 7 & 17:00 GMT & Sunday at 0 & 13 GMT",
            "Min entries for official: 8 | Split at: 60 | Drops: 2",
            "Penalty at 50 incidents, and every 20 after. No incident DQ.",
            "Week 1 (2026-03-21)   Nürburgring Combined  - Gesamtstrecke VLN    67°F/20°C, Rain chance None, Grid by 240",
            "                      (2026-04-01 12:00 1x)                        class, Rolling start, Local enforced mins",
            "                                                                  cautions, Min 1 driver.",
            "                                                        78",
        };

        private static SeasonSchedule Parsed() => ScheduleParser.Parse(Fixture, "fixture.pdf");

        [Test]
        public void ReadsASeriesItsCarsRulesAndWeeks()
        {
            var schedule = Parsed();
            Assert.That(schedule.Season, Is.EqualTo("2026 Season 4"));
            Assert.That(schedule.Series.Select(s => s.Name), Is.EquivalentTo(new[]
            {
                "Caterham Academy Challenge", "Ring Meister by LVRY", "Big Block Modified Series", "Endurance Trophy",
            }));
            // The contents pages are the parser's own check that it found every series in the body.
            Assert.That(schedule.ContentsSeries, Is.SupersetOf(new[] { "Caterham Academy Challenge", "Big Block Modified Series" }));

            var caterham = schedule.Series.Single(s => s.Name == "Caterham Academy Challenge");
            Assert.That(caterham.Category, Is.EqualTo("sports_car"));
            Assert.That(caterham.LicenseClass, Is.EqualTo("D"));
            Assert.That(caterham.MinLicenseClass, Is.EqualTo("Rookie"));
            Assert.That(caterham.MinLicenseLevel, Is.EqualTo(4.0));
            Assert.That(caterham.FixedSetup, Is.False);
            Assert.That(caterham.Cars, Is.EqualTo(new[] { "Caterham Academy" }));
            Assert.That(caterham.MinEntriesForOfficial, Is.EqualTo(6));
            Assert.That(caterham.SplitAt, Is.EqualTo(24));
            Assert.That(caterham.Drops, Is.EqualTo(4));
            Assert.That(caterham.IncidentLimit, Is.EqualTo(17));
            Assert.That(caterham.DriveThroughPenalties, Is.False);
            Assert.That(caterham.Timing.RepeatMinutes, Is.EqualTo(60));
            Assert.That(caterham.Timing.MinuteOffsets, Is.EqualTo(new[] { 0 }));
            Assert.That(caterham.Weeks, Has.Count.EqualTo(2));

            var week1 = caterham.Weeks[0];
            Assert.That(week1.StartsOnUtc, Is.EqualTo(new DateTime(2026, 9, 15, 0, 0, 0, DateTimeKind.Utc)));
            Assert.That(week1.TrackName, Is.EqualTo("Oulton Park Circuit"));
            Assert.That(week1.TrackConfig, Is.EqualTo("Fosters"));
            Assert.That(week1.RaceMinutes, Is.EqualTo(15));
            Assert.That(week1.RaceLaps, Is.Zero);
            Assert.That(week1.SimTimeOfDay, Is.EqualTo("2026-09-19 12:00 1x"));
            Assert.That(week1.Conditions, Does.StartWith("69°F/20°C, Rain chance None").And.Contains("Qual scrutiny - Permissive."));
        }

        [Test]
        public void TakesAConfigThatWrappedOntoTheNextLine()
        {
            var week = Parsed().Series.Single(s => s.Name == "Caterham Academy Challenge").Weeks[1];
            Assert.That(week.TrackName, Is.EqualTo("Autodromo Internazionale Enzo e Dino Ferrari"));
            Assert.That(week.TrackConfig, Is.EqualTo("Grand Prix"), "the row ended in a dash, so the config is on the next line");
            Assert.That(week.RaceMinutes, Is.EqualTo(25));
            Assert.That(week.Conditions, Does.Not.Contain("Grand Prix"));
        }

        [Test]
        public void ReadsARaceLengthWhoseNumberAndUnitLandOnDifferentLines()
        {
            var endurance = Parsed().Series.Single(s => s.Name == "Endurance Trophy");
            var week = endurance.Weeks.Single();
            Assert.That(week.TrackName, Is.EqualTo("Nürburgring Combined"));
            Assert.That(week.TrackConfig, Is.EqualTo("Gesamtstrecke VLN"));
            Assert.That(week.RaceMinutes, Is.EqualTo(240), "\"240\" ends one line and \"mins\" the next");
            // The length column is typeset inside the rules sentence; it shouldn't be left in the text.
            Assert.That(week.Conditions, Does.Contain("Grid by class").And.Not.Contain("240"));
            Assert.That(endurance.Cars, Is.EqualTo(new[] { "Porsche 963 GTP", "Ferrari 499P" }));
            Assert.That(endurance.Multiclass, Is.True);
        }

        [Test]
        public void ReadsDirtHeatRacingAndTheFeatureLength()
        {
            var week = Parsed().Series.Single(s => s.Name == "Big Block Modified Series").Weeks.Single();
            Assert.That(week.HeatFormat, Is.EqualTo("H:8L C:10L F:50L"));
            Assert.That(week.RaceLaps, Is.EqualTo(50), "the feature is the race");
            Assert.That(week.RaceMinutes, Is.Zero);
            Assert.That(week.TrackName, Is.EqualTo("Knoxville Raceway"));
            Assert.That(week.TrackConfig, Is.Null);
        }

        [Test]
        public void ReadsACarThatChangesEveryWeek()
        {
            var series = Parsed().Series.Single(s => s.Name == "Ring Meister by LVRY");
            Assert.That(series.CarsVaryByWeek, Is.True);
            Assert.That(series.Cars, Is.Empty);
            Assert.That(series.Weeks.Single().Cars, Is.EqualTo(new[] { "Caterham 420R" }));
            // "Races on every hour on the hour | Qualifying every hour at :30" — only the race part counts.
            Assert.That(series.Timing.RepeatMinutes, Is.EqualTo(60));
            Assert.That(series.Timing.MinuteOffsets, Is.EqualTo(new[] { 0 }));
            Assert.That(series.IncidentLimit, Is.EqualTo(25));
            Assert.That(series.DriveThroughPenalties, Is.True);
        }

        [Test]
        public void ReadsEnduranceSlotsAndItsPenaltyWording()
        {
            var series = Parsed().Series.Single(s => s.Name == "Endurance Trophy");
            Assert.That(series.Timing.RepeatMinutes, Is.Zero);
            Assert.That(series.Timing.WeeklySlots, Is.EqualTo(new[]
            {
                new WeeklySlot(DayOfWeek.Saturday, 7, 0),
                new WeeklySlot(DayOfWeek.Saturday, 17, 0),
                new WeeklySlot(DayOfWeek.Sunday, 0, 0),
                new WeeklySlot(DayOfWeek.Sunday, 13, 0),
            }));
            Assert.That(series.DriveThroughPenalties, Is.True);
            Assert.That(series.IncidentLimit, Is.Zero, "this series has no DQ limit");
        }

        [TestCase("Races every hour at :00", 60, new[] { 0 })]
        [TestCase("Races hourly at :45", 60, new[] { 45 })]
        [TestCase("Races every hour at :15 past", 60, new[] { 15 })]
        [TestCase("Races hourly at the top of the hour", 60, new[] { 0 })]
        [TestCase("Races every hour at half past", 60, new[] { 30 })]
        [TestCase("Races every 2 hours on the hour", 120, new[] { 0 })]
        [TestCase("Races every 2 hours at :15 past", 120, new[] { 15 })]
        [TestCase("Every hour on the :30", 60, new[] { 30 })]
        [TestCase("Races every 30 minutes at :15 & :45", 30, new[] { 15, 45 })]
        [TestCase("Races every thirty minutes on the hour and :30 past", 30, new[] { 0, 30 })]
        [TestCase("Races 45 past every 2 hours", 120, new[] { 45 })]
        public void ReadsEveryWordingIRacingUsesForRaceTimes(string line, int repeatMinutes, int[] offsets)
        {
            var timing = RaceTimingParser.Parse(line);
            Assert.That(timing.RepeatMinutes, Is.EqualTo(repeatMinutes));
            Assert.That(timing.MinuteOffsets, Is.EqualTo(offsets));
            Assert.That(timing.WeeklySlots, Is.Empty);
        }

        [TestCase("Races every odd 2 hours on the hour", "odd")]
        [TestCase("Races every even 2 hours at :30 past", "even")]
        public void ReadsOddAndEvenHourSeries(string line, string parity)
        {
            var timing = RaceTimingParser.Parse(line);
            Assert.That(timing.RepeatMinutes, Is.EqualTo(120));
            Assert.That(timing.HourParity, Is.EqualTo(parity));
        }

        [Test]
        public void ReadsScheduledDaySeries()
        {
            var timing = RaceTimingParser.Parse("Races Thur & Sat at 10, 19 GMT & Fri & Sun at 1,4 GMT");
            Assert.That(timing.RepeatMinutes, Is.Zero);
            Assert.That(timing.WeeklySlots, Is.EquivalentTo(new[]
            {
                new WeeklySlot(DayOfWeek.Thursday, 10, 0), new WeeklySlot(DayOfWeek.Thursday, 19, 0),
                new WeeklySlot(DayOfWeek.Saturday, 10, 0), new WeeklySlot(DayOfWeek.Saturday, 19, 0),
                new WeeklySlot(DayOfWeek.Friday, 1, 0), new WeeklySlot(DayOfWeek.Friday, 4, 0),
                new WeeklySlot(DayOfWeek.Sunday, 1, 0), new WeeklySlot(DayOfWeek.Sunday, 4, 0),
            }));

            var alternating = RaceTimingParser.Parse("Races every other Saturday at 4 & 15 GMT and Sunday at 0 GMT, 20 GMT");
            Assert.That(alternating.AlternateWeeks, Is.True);
            Assert.That(alternating.WeeklySlots, Has.Count.EqualTo(4));
        }

        [Test]
        public void LeavesAChampionshipSeriesWithoutAClockPattern()
        {
            var timing = RaceTimingParser.Parse("5 Timeslots Per Week");
            Assert.That(timing.RepeatMinutes, Is.Zero);
            Assert.That(timing.WeeklySlots, Is.Empty);
            Assert.That(timing.Text, Is.EqualTo("5 Timeslots Per Week"));
        }

        /// <summary>
        /// The real thing, when a season PDF is on this machine: the contents pages and the body have to agree,
        /// and every week has to come out with a track and a race length.
        /// </summary>
        [Test]
        public void ParsesTheSeasonPdfOnThisMachine()
        {
            string directory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RaceCor", "schedule");
            string pdf = Directory.Exists(directory)
                ? new DirectoryInfo(directory).EnumerateFiles("*.pdf").OrderByDescending(f => f.LastWriteTimeUtc).Select(f => f.FullName).FirstOrDefault()
                : null;
            Assume.That(pdf, Is.Not.Null, "no season schedule PDF in %LOCALAPPDATA%\\RaceCor\\schedule");

            var schedule = ScheduleParser.Parse(PdfLayout.Lines(pdf), pdf);
            Assert.That(schedule.Season, Does.Match(@"^\d{4} Season( \d)?$"));
            Assert.That(schedule.Series, Has.Count.GreaterThan(100));

            var body = schedule.Series.Select(s => s.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
            var contents = schedule.ContentsSeries.ToHashSet(StringComparer.OrdinalIgnoreCase);
            Assert.That(body, Is.EquivalentTo(contents), "every series listed in the contents must be parsed from the body");

            var categories = new[] { "oval", "sports_car", "formula_car", "dirt_oval", "dirt_road", "unranked" };
            foreach (var series in schedule.Series)
            {
                Assert.That(series.Category, Is.AnyOf(categories.Cast<object>().ToArray()), series.Name);
                Assert.That(series.LicenseClass, Is.AnyOf("R", "D", "C", "B", "A"), series.Name);
                Assert.That(series.Weeks, Is.Not.Empty, series.Name);
                foreach (var week in series.Weeks)
                {
                    Assert.That(week.TrackName, Is.Not.Empty, $"{series.Name} week {week.WeekNumber}");
                    Assert.That(week.RaceMinutes + week.RaceLaps, Is.GreaterThan(0), $"{series.Name} week {week.WeekNumber} has no race length");
                    // The right-hand columns must not leak into the track.
                    Assert.That(week.TrackName + " " + week.TrackConfig, Does.Not.Contain("°").And.Not.Contain("Rain chance"),
                        $"{series.Name} week {week.WeekNumber}");
                    Assert.That(week.StartsOnUtc.Year, Is.InRange(2020, 2100), $"{series.Name} week {week.WeekNumber}");
                }
                Assert.That(series.Weeks.Select(w => w.WeekNumber), Is.Unique, series.Name);
            }
        }
    }
}
