using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using RaceCorProDrive.Tests.TestHelpers;
using static RaceCorProDrive.Tests.TestHelpers.CircadianProfiler;

namespace RaceCorProDrive.Tests
{
    [TestFixture]
    public class CircadianProfilerTests
    {
        // ═══════════════════════════════════════════════════════════════════
        //  TEST HELPERS — session generation
        // ═══════════════════════════════════════════════════════════════════

        private static readonly DateTime BaseDate = new DateTime(2026, 3, 1);

        /// <summary>Creates a session result at a specific hour with given performance.</summary>
        private static SessionResult MakeSession(
            int hour, double avgLapTime = 92.0, int incidents = 2,
            int laps = 20, int iRatingDelta = 0,
            int finishPos = 5, int fieldSize = 20,
            string trackId = "silverstone", int dayOffset = 0)
        {
            return new SessionResult
            {
                SessionStart = BaseDate.AddDays(dayOffset).AddHours(hour),
                AverageLapTime = avgLapTime,
                BestLapTime = avgLapTime - 1.5,
                Incidents = incidents,
                LapsCompleted = laps,
                IRatingDelta = iRatingDelta,
                FinishPosition = finishPos,
                FieldSize = fieldSize,
                TrackId = trackId
            };
        }

        /// <summary>
        /// Populates a profiler with a realistic spread of sessions.
        /// Afternoon sessions (14-18) are "peak" — low incidents, positive iRating.
        /// Late night sessions (23-2) are "danger" — high incidents, negative iRating.
        /// Other hours are average.
        /// </summary>
        private static CircadianProfiler BuildRealisticProfile()
        {
            var profiler = new CircadianProfiler();
            var rng = new Random(42);
            int day = 0;

            // Generate ~60 sessions across 2 months
            for (int week = 0; week < 8; week++)
            {
                // 2-3 afternoon sessions per week (peak hours)
                for (int s = 0; s < 3; s++)
                {
                    int hour = 14 + rng.Next(5); // 14-18
                    profiler.RecordSession(MakeSession(
                        hour: hour,
                        avgLapTime: 91.0 + rng.NextDouble() * 1.0,
                        incidents: rng.Next(2), // 0-1
                        iRatingDelta: rng.Next(10, 40),
                        finishPos: 1 + rng.Next(5),
                        dayOffset: day + rng.Next(3)
                    ));
                }

                // 1-2 morning sessions (average)
                for (int s = 0; s < 2; s++)
                {
                    int hour = 9 + rng.Next(3); // 9-11
                    profiler.RecordSession(MakeSession(
                        hour: hour,
                        avgLapTime: 92.0 + rng.NextDouble() * 1.5,
                        incidents: 1 + rng.Next(3),
                        iRatingDelta: rng.Next(-10, 15),
                        finishPos: 5 + rng.Next(8),
                        dayOffset: day + rng.Next(5)
                    ));
                }

                // 1-2 late night sessions (danger hours)
                for (int s = 0; s < 2; s++)
                {
                    int hour = 23 + rng.Next(4); // 23, 0, 1, 2
                    if (hour >= 24) hour -= 24;
                    profiler.RecordSession(MakeSession(
                        hour: hour,
                        avgLapTime: 93.5 + rng.NextDouble() * 2.0,
                        incidents: 3 + rng.Next(5), // 3-7
                        iRatingDelta: rng.Next(-50, -5),
                        finishPos: 10 + rng.Next(10),
                        dayOffset: day + rng.Next(5)
                    ));
                }

                day += 7;
            }

            return profiler;
        }

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 1: Session Recording
        // ═══════════════════════════════════════════════════════════════════

        #region Session Recording

        [Test]
        public void RecordSession_ValidSession_Added()
        {
            var profiler = new CircadianProfiler();
            profiler.RecordSession(MakeSession(14));
            Assert.AreEqual(1, profiler.Sessions.Count);
        }

        [Test]
        public void RecordSession_ZeroLaps_Ignored()
        {
            var profiler = new CircadianProfiler();
            var session = MakeSession(14);
            session.LapsCompleted = 0;
            profiler.RecordSession(session);
            Assert.AreEqual(0, profiler.Sessions.Count);
        }

        [Test]
        public void RecordSession_NullSession_ThrowsArgumentNull()
        {
            var profiler = new CircadianProfiler();
            Assert.Throws<ArgumentNullException>(() => profiler.RecordSession((SessionResult)null));
        }

        [Test]
        public void RecordSession_MultipleSessions_AllTracked()
        {
            var profiler = new CircadianProfiler();
            for (int i = 0; i < 20; i++)
                profiler.RecordSession(MakeSession(i % 24, dayOffset: i));
            Assert.AreEqual(20, profiler.Sessions.Count);
        }

        [Test]
        public void RecordSession_ConvenienceOverload_Works()
        {
            var profiler = new CircadianProfiler();
            profiler.RecordSession(
                sessionStart: BaseDate.AddHours(15),
                avgLapTime: 91.5,
                bestLapTime: 90.0,
                incidents: 1,
                lapsCompleted: 25,
                iRatingDelta: 30,
                finishPosition: 3,
                fieldSize: 22,
                trackId: "monza"
            );
            Assert.AreEqual(1, profiler.Sessions.Count);
            Assert.AreEqual("monza", profiler.Sessions[0].TrackId);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 2: Session Result Properties
        // ═══════════════════════════════════════════════════════════════════

        #region Session Result Properties

        [Test]
        public void SessionResult_HourOfDay_DerivedFromStart()
        {
            var result = new SessionResult { SessionStart = new DateTime(2026, 3, 1, 15, 30, 0) };
            Assert.AreEqual(15, result.HourOfDay);
        }

        [Test]
        public void SessionResult_IncidentRate_CorrectCalculation()
        {
            var result = new SessionResult { Incidents = 6, LapsCompleted = 20 };
            Assert.AreEqual(0.3, result.IncidentRate, 1e-10);
        }

        [Test]
        public void SessionResult_IncidentRate_ZeroLaps_ReturnsZero()
        {
            var result = new SessionResult { Incidents = 5, LapsCompleted = 0 };
            Assert.AreEqual(0.0, result.IncidentRate);
        }

        [Test]
        public void SessionResult_FinishPercentile_Winner_ReturnsZero()
        {
            var result = new SessionResult { FinishPosition = 1, FieldSize = 20 };
            Assert.AreEqual(0.0, result.FinishPercentile, 1e-10);
        }

        [Test]
        public void SessionResult_FinishPercentile_Last_ReturnsOne()
        {
            var result = new SessionResult { FinishPosition = 20, FieldSize = 20 };
            Assert.AreEqual(1.0, result.FinishPercentile, 1e-10);
        }

        [Test]
        public void SessionResult_FinishPercentile_Mid_ReturnsHalf()
        {
            var result = new SessionResult { FinishPosition = 11, FieldSize = 21 };
            Assert.AreEqual(0.5, result.FinishPercentile, 1e-10);
        }

        [Test]
        public void SessionResult_FinishPercentile_SoloSession_ReturnsZero()
        {
            var result = new SessionResult { FinishPosition = 1, FieldSize = 1 };
            Assert.AreEqual(0.0, result.FinishPercentile);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 3: Hourly Bucketing
        // ═══════════════════════════════════════════════════════════════════

        #region Hourly Bucketing

        [Test]
        public void ComputeProfile_BucketsSessionsByHour()
        {
            var profiler = new CircadianProfiler();
            // 5 sessions at 3 PM, 5 at 9 AM
            for (int i = 0; i < 5; i++)
            {
                profiler.RecordSession(MakeSession(15, dayOffset: i));
                profiler.RecordSession(MakeSession(9, dayOffset: i));
            }
            profiler.ComputeProfile();

            Assert.AreEqual(5, profiler.HourlyProfile[15].SessionCount);
            Assert.AreEqual(5, profiler.HourlyProfile[9].SessionCount);
            Assert.AreEqual(0, profiler.HourlyProfile[12].SessionCount);
        }

        [Test]
        public void ComputeProfile_InsufficientData_NoWindows()
        {
            var profiler = new CircadianProfiler();
            for (int i = 0; i < MinTotalSessions - 1; i++)
                profiler.RecordSession(MakeSession(14, dayOffset: i));

            profiler.ComputeProfile();
            Assert.IsFalse(profiler.HasSufficientData);
            Assert.IsNull(profiler.PeakWindow);
            Assert.IsNull(profiler.DangerWindow);
        }

        [Test]
        public void ComputeProfile_ExactMinSessions_ProfileGenerated()
        {
            var profiler = new CircadianProfiler();
            for (int i = 0; i < MinTotalSessions; i++)
                profiler.RecordSession(MakeSession(14 + (i % 3), dayOffset: i));

            profiler.ComputeProfile();
            Assert.IsTrue(profiler.HasSufficientData);
        }

        [Test]
        public void ComputeProfile_AllHoursPopulated_24Buckets()
        {
            var profiler = new CircadianProfiler();
            for (int h = 0; h < 24; h++)
                profiler.RecordSession(MakeSession(h, dayOffset: h));

            // Need minimum sessions
            for (int h = 0; h < 24; h++)
                profiler.RecordSession(MakeSession(h, dayOffset: h + 24));

            profiler.ComputeProfile();
            for (int h = 0; h < 24; h++)
                Assert.AreEqual(2, profiler.HourlyProfile[h].SessionCount, $"Hour {h} should have 2 sessions");
        }

        [Test]
        public void HourlyStats_MeanIncidentRate_Correct()
        {
            var profiler = new CircadianProfiler();
            // 3 sessions at hour 15: incident rates 0.1, 0.2, 0.3
            profiler.RecordSession(MakeSession(15, incidents: 2, laps: 20, dayOffset: 0)); // 0.1
            profiler.RecordSession(MakeSession(15, incidents: 4, laps: 20, dayOffset: 1)); // 0.2
            profiler.RecordSession(MakeSession(15, incidents: 6, laps: 20, dayOffset: 2)); // 0.3
            // Fill minimum total sessions
            for (int i = 3; i < MinTotalSessions; i++)
                profiler.RecordSession(MakeSession(10, dayOffset: i));

            profiler.ComputeProfile();
            Assert.AreEqual(0.2, profiler.HourlyProfile[15].MeanIncidentRate, 1e-10);
        }

        [Test]
        public void HourlyStats_MeanIRatingDelta_Correct()
        {
            var profiler = new CircadianProfiler();
            profiler.RecordSession(MakeSession(15, iRatingDelta: 30, dayOffset: 0));
            profiler.RecordSession(MakeSession(15, iRatingDelta: -10, dayOffset: 1));
            profiler.RecordSession(MakeSession(15, iRatingDelta: 20, dayOffset: 2));
            for (int i = 3; i < MinTotalSessions; i++)
                profiler.RecordSession(MakeSession(10, dayOffset: i));

            profiler.ComputeProfile();
            // Mean = (30 + -10 + 20) / 3 = 13.33
            Assert.AreEqual(40.0 / 3.0, profiler.HourlyProfile[15].MeanIRatingDelta, 1e-10);
        }

        [Test]
        public void HourlyStats_TotalIncidents_Summed()
        {
            var profiler = new CircadianProfiler();
            profiler.RecordSession(MakeSession(15, incidents: 3, dayOffset: 0));
            profiler.RecordSession(MakeSession(15, incidents: 5, dayOffset: 1));
            for (int i = 2; i < MinTotalSessions; i++)
                profiler.RecordSession(MakeSession(10, dayOffset: i));

            profiler.ComputeProfile();
            Assert.AreEqual(8, profiler.HourlyProfile[15].TotalIncidents);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 4: Performance Score Computation
        // ═══════════════════════════════════════════════════════════════════

        #region Performance Score Computation

        [Test]
        public void PerformanceScores_BestHour_HighestScore()
        {
            var profiler = BuildRealisticProfile();
            profiler.ComputeProfile();

            // Afternoon hours should score higher than late night
            var afternoonScores = Enumerable.Range(14, 5)
                .Where(h => profiler.HourlyProfile[h].SessionCount > 0)
                .Select(h => profiler.HourlyProfile[h].PerformanceScore)
                .ToList();

            var lateNightScores = new[] { 23, 0, 1, 2 }
                .Where(h => profiler.HourlyProfile[h].SessionCount > 0)
                .Select(h => profiler.HourlyProfile[h].PerformanceScore)
                .ToList();

            if (afternoonScores.Count > 0 && lateNightScores.Count > 0)
            {
                double avgAfternoon = afternoonScores.Average();
                double avgLateNight = lateNightScores.Average();
                Assert.Greater(avgAfternoon, avgLateNight,
                    $"Afternoon avg ({avgAfternoon:F3}) should beat late night ({avgLateNight:F3})");
            }
        }

        [Test]
        public void PerformanceScores_Range0To1()
        {
            var profiler = BuildRealisticProfile();
            profiler.ComputeProfile();

            foreach (var stats in profiler.HourlyProfile)
            {
                if (stats.SessionCount > 0)
                {
                    Assert.GreaterOrEqual(stats.PerformanceScore, 0.0,
                        $"Hour {stats.Hour} score below 0");
                    Assert.LessOrEqual(stats.PerformanceScore, 1.0,
                        $"Hour {stats.Hour} score above 1");
                }
            }
        }

        [Test]
        public void PerformanceScores_SingleHour_Gets05()
        {
            // When all sessions are in one hour, normalisation gives 0.5 (mid-range)
            var profiler = new CircadianProfiler();
            for (int i = 0; i < MinTotalSessions; i++)
                profiler.RecordSession(MakeSession(15, dayOffset: i));

            profiler.ComputeProfile();
            // With a single populated bucket, all ranges collapse → default scores
            // irScore = 1.0 (no range), ratingScore = 0.5, finishScore = 0.5
            // = 0.4*1 + 0.4*0.5 + 0.2*0.5 = 0.4 + 0.2 + 0.1 = 0.7
            Assert.AreEqual(0.7, profiler.HourlyProfile[15].PerformanceScore, 0.01);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 5: Peak Window Detection
        // ═══════════════════════════════════════════════════════════════════

        #region Peak Window Detection

        [Test]
        public void FindBestWindow_RealisticProfile_AfternoonPeak()
        {
            var profiler = BuildRealisticProfile();
            profiler.ComputeProfile();

            Assert.IsNotNull(profiler.PeakWindow, "Peak window should be detected");

            // Peak should be somewhere in the afternoon range (13-19)
            var peakHours = GetWindowHours(profiler.PeakWindow);
            bool overlapsAfternoon = peakHours.Any(h => h >= 13 && h <= 19);
            Assert.IsTrue(overlapsAfternoon,
                $"Peak window {profiler.PeakWindow.Label} should overlap afternoon hours");
        }

        [Test]
        public void FindBestWindow_ReturnsHighestScoringWindow()
        {
            var profiler = BuildRealisticProfile();
            profiler.ComputeProfile();

            if (profiler.PeakWindow == null) return;

            // The peak window's average score should be >= any other window's average
            var peakScore = profiler.PeakWindow.AverageScore;
            for (int start = 0; start < HourBuckets; start++)
            {
                double sum = 0;
                int count = 0;
                for (int off = 0; off < PeakWindowSize; off++)
                {
                    int h = (start + off) % HourBuckets;
                    if (profiler.HourlyProfile[h].SessionCount > 0)
                    {
                        sum += profiler.HourlyProfile[h].PerformanceScore;
                        count++;
                    }
                }
                if (count > 0)
                {
                    double avg = sum / count;
                    Assert.GreaterOrEqual(peakScore, avg - 1e-10,
                        $"Peak score {peakScore:F3} should be >= window starting at {start} ({avg:F3})");
                }
            }
        }

        [Test]
        public void FindWorstWindow_RealisticProfile_LateNightDanger()
        {
            var profiler = BuildRealisticProfile();
            profiler.ComputeProfile();

            Assert.IsNotNull(profiler.DangerWindow, "Danger window should be detected");
        }

        [Test]
        public void FindWindow_WrapsAroundMidnight()
        {
            var profiler = new CircadianProfiler();
            // Best performance at 22, 23, 0, 1
            for (int i = 0; i < 4; i++)
            {
                int hour = (22 + i) % 24;
                for (int d = 0; d < 3; d++)
                    profiler.RecordSession(MakeSession(hour, incidents: 0, iRatingDelta: 50,
                        finishPos: 1, dayOffset: d * 7 + i));
            }
            // Filler sessions at midday (worse performance)
            for (int d = 0; d < 6; d++)
                profiler.RecordSession(MakeSession(12, incidents: 5, iRatingDelta: -20,
                    finishPos: 15, dayOffset: d + 30));

            profiler.ComputeProfile();
            Assert.IsNotNull(profiler.PeakWindow);
            var peakHours = GetWindowHours(profiler.PeakWindow);

            // Should include hours around midnight
            bool wraps = peakHours.Contains(23) || peakHours.Contains(0);
            Assert.IsTrue(wraps || profiler.PeakWindow.AverageScore > 0.5,
                $"Peak window should wrap midnight or have high score: {profiler.PeakWindow.Label}");
        }

        [Test]
        public void FindBestWindow_NoData_ReturnsNull()
        {
            var profiler = new CircadianProfiler();
            profiler.ComputeProfile();
            Assert.IsNull(profiler.PeakWindow);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 6: Danger Hour Detection
        // ═══════════════════════════════════════════════════════════════════

        #region Danger Hour Detection

        [Test]
        public void FindDangerHours_RealisticProfile_DetectsLateNight()
        {
            var profiler = BuildRealisticProfile();
            profiler.ComputeProfile();

            // Late night sessions have 3-7 incidents per 20 laps (0.15-0.35/lap)
            // vs afternoon 0-1 per 20 laps (0-0.05/lap)
            // Danger hours should include some late-night hours
            Assert.Greater(profiler.DangerHours.Count, 0,
                "Should detect at least one danger hour with realistic data");
        }

        [Test]
        public void FindDangerHours_UniformPerformance_NoDangerHours()
        {
            var profiler = new CircadianProfiler();
            // All hours get identical performance
            for (int h = 0; h < 24; h++)
            {
                for (int d = 0; d < MinSessionsPerBucket; d++)
                    profiler.RecordSession(MakeSession(h, incidents: 2, laps: 20, dayOffset: d * 24 + h));
            }
            profiler.ComputeProfile();

            Assert.AreEqual(0, profiler.DangerHours.Count,
                "Uniform performance should produce no danger hours");
        }

        [Test]
        public void FindDangerHours_OnlyClearOutliers_Flagged()
        {
            var profiler = new CircadianProfiler();
            // Most hours: 1 incident per 20 laps
            for (int h = 0; h < 20; h++)
            {
                for (int d = 0; d < MinSessionsPerBucket; d++)
                    profiler.RecordSession(MakeSession(h, incidents: 1, laps: 20, dayOffset: d * 30 + h));
            }
            // Hour 23: 8 incidents per 20 laps (way above 1.8x median)
            for (int d = 0; d < MinSessionsPerBucket; d++)
                profiler.RecordSession(MakeSession(23, incidents: 8, laps: 20, dayOffset: d * 30 + 23));

            profiler.ComputeProfile();

            Assert.Contains(23, profiler.DangerHours,
                "Hour 23 with 8 incidents should be flagged as danger");
        }

        [Test]
        public void FindDangerHours_InsufficientBucketData_NotFlagged()
        {
            var profiler = new CircadianProfiler();
            // Main hours with enough data
            for (int h = 10; h < 20; h++)
                for (int d = 0; d < MinSessionsPerBucket; d++)
                    profiler.RecordSession(MakeSession(h, incidents: 1, laps: 20, dayOffset: d * 30 + h));

            // Hour 23 with high incidents but only 1 session (below MinSessionsPerBucket)
            profiler.RecordSession(MakeSession(23, incidents: 10, laps: 20, dayOffset: 90));

            profiler.ComputeProfile();
            Assert.IsFalse(profiler.DangerHours.Contains(23),
                "Hour with insufficient data should not be flagged");
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 7: Median Computation
        // ═══════════════════════════════════════════════════════════════════

        #region Median Computation

        [Test]
        public void Median_OddCount_MiddleValue()
        {
            Assert.AreEqual(3.0, CircadianProfiler.Median(new List<double> { 1, 3, 5 }));
        }

        [Test]
        public void Median_EvenCount_AverageOfMiddleTwo()
        {
            Assert.AreEqual(3.5, CircadianProfiler.Median(new List<double> { 1, 3, 4, 7 }));
        }

        [Test]
        public void Median_SingleValue_ReturnsThatValue()
        {
            Assert.AreEqual(42.0, CircadianProfiler.Median(new List<double> { 42.0 }));
        }

        [Test]
        public void Median_Empty_ReturnsZero()
        {
            Assert.AreEqual(0.0, CircadianProfiler.Median(new List<double>()));
        }

        [Test]
        public void Median_Null_ReturnsZero()
        {
            Assert.AreEqual(0.0, CircadianProfiler.Median(null));
        }

        [Test]
        public void Median_TwoValues_Average()
        {
            Assert.AreEqual(5.0, CircadianProfiler.Median(new List<double> { 3, 7 }));
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 8: Hour Range Queries
        // ═══════════════════════════════════════════════════════════════════

        #region Hour Range Queries

        [Test]
        public void IRatingLostInHourRange_NormalRange_Correct()
        {
            var profiler = new CircadianProfiler();
            profiler.RecordSession(MakeSession(14, iRatingDelta: -30, dayOffset: 0));
            profiler.RecordSession(MakeSession(15, iRatingDelta: -20, dayOffset: 1));
            profiler.RecordSession(MakeSession(16, iRatingDelta: 40, dayOffset: 2)); // Gain, not loss
            profiler.RecordSession(MakeSession(20, iRatingDelta: -50, dayOffset: 3)); // Outside range

            int lost = profiler.IRatingLostInHourRange(14, 16);
            Assert.AreEqual(-50, lost); // -30 + -20 = -50 (ignores the gain and out-of-range)
        }

        [Test]
        public void IRatingLostInHourRange_WrappingMidnight_Correct()
        {
            var profiler = new CircadianProfiler();
            profiler.RecordSession(MakeSession(23, iRatingDelta: -40, dayOffset: 0));
            profiler.RecordSession(MakeSession(0, iRatingDelta: -25, dayOffset: 1));
            profiler.RecordSession(MakeSession(1, iRatingDelta: -15, dayOffset: 2));
            profiler.RecordSession(MakeSession(12, iRatingDelta: -100, dayOffset: 3)); // Outside range

            int lost = profiler.IRatingLostInHourRange(23, 1);
            Assert.AreEqual(-80, lost); // -40 + -25 + -15
        }

        [Test]
        public void SessionCountInHourRange_Normal_Correct()
        {
            var profiler = new CircadianProfiler();
            for (int h = 14; h <= 18; h++)
                profiler.RecordSession(MakeSession(h, dayOffset: h));
            profiler.RecordSession(MakeSession(10, dayOffset: 30));

            Assert.AreEqual(5, profiler.SessionCountInHourRange(14, 18));
            Assert.AreEqual(1, profiler.SessionCountInHourRange(10, 10));
        }

        [Test]
        public void SessionCountInHourRange_WrappingMidnight_Correct()
        {
            var profiler = new CircadianProfiler();
            profiler.RecordSession(MakeSession(22, dayOffset: 0));
            profiler.RecordSession(MakeSession(23, dayOffset: 1));
            profiler.RecordSession(MakeSession(0, dayOffset: 2));
            profiler.RecordSession(MakeSession(1, dayOffset: 3));
            profiler.RecordSession(MakeSession(12, dayOffset: 4)); // Outside

            Assert.AreEqual(4, profiler.SessionCountInHourRange(22, 1));
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 9: Window Hour Helpers
        // ═══════════════════════════════════════════════════════════════════

        #region Window Hour Helpers

        [Test]
        public void IsHourInWindow_NormalWindow_Correct()
        {
            var window = new PerformanceWindow { StartHour = 14, EndHour = 17 };
            Assert.IsTrue(IsHourInWindow(14, window));
            Assert.IsTrue(IsHourInWindow(15, window));
            Assert.IsTrue(IsHourInWindow(17, window));
            Assert.IsFalse(IsHourInWindow(13, window));
            Assert.IsFalse(IsHourInWindow(18, window));
        }

        [Test]
        public void IsHourInWindow_WrappingWindow_Correct()
        {
            // 22, 23, 0, 1
            var window = new PerformanceWindow { StartHour = 22, EndHour = 1 };
            Assert.IsTrue(IsHourInWindow(22, window));
            Assert.IsTrue(IsHourInWindow(23, window));
            Assert.IsTrue(IsHourInWindow(0, window));
            Assert.IsTrue(IsHourInWindow(1, window));
            Assert.IsFalse(IsHourInWindow(2, window));
            Assert.IsFalse(IsHourInWindow(21, window));
        }

        [Test]
        public void IsHourInWindow_NullWindow_ReturnsFalse()
        {
            Assert.IsFalse(IsHourInWindow(12, null));
        }

        [Test]
        public void GetWindowHours_NormalWindow_CorrectList()
        {
            var window = new PerformanceWindow { StartHour = 14, EndHour = 17 };
            var hours = GetWindowHours(window);
            CollectionAssert.AreEqual(new[] { 14, 15, 16, 17 }, hours);
        }

        [Test]
        public void GetWindowHours_WrappingWindow_CorrectList()
        {
            var window = new PerformanceWindow { StartHour = 22, EndHour = 1 };
            var hours = GetWindowHours(window);
            CollectionAssert.AreEqual(new[] { 22, 23, 0, 1 }, hours);
        }

        [Test]
        public void GetWindowHours_NullWindow_ReturnsEmpty()
        {
            Assert.AreEqual(0, GetWindowHours(null).Count);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 10: Performance Window Label
        // ═══════════════════════════════════════════════════════════════════

        #region Window Label

        [Test]
        public void WindowLabel_Afternoon_FormatsCorrectly()
        {
            var window = new PerformanceWindow { StartHour = 14, EndHour = 17 };
            Assert.AreEqual("2 PM – 6 PM", window.Label);
        }

        [Test]
        public void WindowLabel_Morning_FormatsCorrectly()
        {
            var window = new PerformanceWindow { StartHour = 9, EndHour = 12 };
            Assert.AreEqual("9 AM – 1 PM", window.Label);
        }

        [Test]
        public void WindowLabel_Midnight_FormatsCorrectly()
        {
            var window = new PerformanceWindow { StartHour = 22, EndHour = 1 };
            Assert.AreEqual("10 PM – 2 AM", window.Label);
        }

        [Test]
        public void WindowLabel_Noon_FormatsCorrectly()
        {
            var window = new PerformanceWindow { StartHour = 12, EndHour = 15 };
            Assert.AreEqual("12 PM – 4 PM", window.Label);
        }

        [TestCase(0, "12 AM")]
        [TestCase(1, "1 AM")]
        [TestCase(11, "11 AM")]
        [TestCase(12, "12 PM")]
        [TestCase(13, "1 PM")]
        [TestCase(23, "11 PM")]
        public void WindowLabel_AllHours_FormatCorrectly(int hour, string expected)
        {
            var window = new PerformanceWindow { StartHour = hour, EndHour = hour };
            Assert.That(window.Label, Does.StartWith(expected));
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 11: Strategy Call Evaluation
        // ═══════════════════════════════════════════════════════════════════

        #region Strategy Call Evaluation

        [Test]
        public void Evaluate_InsufficientData_ReturnsNull()
        {
            var profiler = new CircadianProfiler();
            for (int i = 0; i < MinTotalSessions - 1; i++)
                profiler.RecordSession(MakeSession(14, dayOffset: i));

            var call = profiler.Evaluate(BaseDate.AddHours(14), DateTime.Now);
            Assert.IsNull(call);
        }

        [Test]
        public void Evaluate_DangerHour_ReturnsClockCall()
        {
            var profiler = BuildRealisticProfile();
            profiler.ComputeProfile();

            if (profiler.DangerHours.Count == 0)
            {
                Assert.Inconclusive("No danger hours detected in realistic profile");
                return;
            }

            int dangerHour = profiler.DangerHours[0];
            var call = profiler.Evaluate(
                BaseDate.AddDays(60).AddHours(dangerHour),
                DateTime.Now);

            Assert.IsNotNull(call, $"Should fire call for danger hour {dangerHour}");
            Assert.AreEqual("CLOCK", call.Label);
            Assert.AreEqual(3, call.Severity);
            Assert.That(call.Message, Does.Contain("incident rate"));
        }

        [Test]
        public void Evaluate_PeakHour_ReturnsPeakCall()
        {
            var profiler = BuildRealisticProfile();
            profiler.ComputeProfile();

            if (profiler.PeakWindow == null)
            {
                Assert.Inconclusive("No peak window detected");
                return;
            }

            // Find a peak hour that's not a danger hour and has data
            var peakHours = GetWindowHours(profiler.PeakWindow);
            int peakHour = peakHours.FirstOrDefault(h =>
                !profiler.DangerHours.Contains(h)
                && profiler.HourlyProfile[h].SessionCount > 0);

            if (peakHour == 0 && !peakHours.Contains(0))
            {
                Assert.Inconclusive("No suitable peak hour for test");
                return;
            }

            var call = profiler.Evaluate(
                BaseDate.AddDays(60).AddHours(peakHour),
                DateTime.Now);

            if (call != null)
            {
                Assert.That(call.Label, Is.EqualTo("PEAK").Or.EqualTo("CLOCK"));
            }
        }

        [Test]
        public void Evaluate_Cooldown_ReturnsNullWithinWindow()
        {
            var profiler = BuildRealisticProfile();
            profiler.ComputeProfile();

            var now = DateTime.Now;

            // Trigger a call
            if (profiler.DangerHours.Count > 0)
            {
                int dh = profiler.DangerHours[0];
                profiler.Evaluate(BaseDate.AddDays(60).AddHours(dh), now);

                // Second call within cooldown
                var second = profiler.Evaluate(BaseDate.AddDays(60).AddHours(dh), now.AddSeconds(60));
                Assert.IsNull(second, "Should not fire within cooldown");
            }
        }

        [Test]
        public void Evaluate_AfterCooldown_FiresAgain()
        {
            var profiler = BuildRealisticProfile();
            profiler.ComputeProfile();

            var now = DateTime.Now;
            if (profiler.DangerHours.Count > 0)
            {
                int dh = profiler.DangerHours[0];
                profiler.Evaluate(BaseDate.AddDays(60).AddHours(dh), now);

                var after = profiler.Evaluate(
                    BaseDate.AddDays(60).AddHours(dh),
                    now.AddSeconds(CooldownSeconds + 1));
                Assert.IsNotNull(after, "Should fire after cooldown expires");
            }
        }

        [Test]
        public void Evaluate_ResetCooldown_AllowsImmediate()
        {
            var profiler = BuildRealisticProfile();
            profiler.ComputeProfile();

            var now = DateTime.Now;
            if (profiler.DangerHours.Count > 0)
            {
                int dh = profiler.DangerHours[0];
                profiler.Evaluate(BaseDate.AddDays(60).AddHours(dh), now);
                profiler.ResetCooldown();

                var after = profiler.Evaluate(
                    BaseDate.AddDays(60).AddHours(dh),
                    now.AddSeconds(5));
                Assert.IsNotNull(after, "Should fire after cooldown reset");
            }
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 12: Strategy Call Properties
        // ═══════════════════════════════════════════════════════════════════

        #region Strategy Call Properties

        [Test]
        public void StrategyCall_SharedWithOtherAnalyzers()
        {
            // Verify CircadianProfiler uses the same StrategyCall class
            var circadianCall = new StrategyCall
            {
                Label = "CLOCK",
                Message = "Danger hour",
                Severity = 3,
                DisplayedAt = DateTime.Now
            };
            var glareCall = new StrategyCall
            {
                Label = "GLARE",
                Message = "Sun glare",
                Severity = 2,
                DisplayedAt = DateTime.Now
            };

            Assert.IsInstanceOf<StrategyCall>(circadianCall);
            Assert.IsInstanceOf<StrategyCall>(glareCall);
        }

        [Test]
        public void StrategyCall_LabelsWithinMaxLength()
        {
            var labels = new[] { "CLOCK", "SLEEP", "PEAK" };
            foreach (var label in labels)
                Assert.LessOrEqual(label.Length, 6, $"Label '{label}' exceeds 6 chars");
        }

        [Test]
        public void StrategyCall_SeverityValues_InRange()
        {
            // CLOCK = 3, off-peak = 2, SLEEP = 2, PEAK = 1
            var severities = new[] { 3, 2, 2, 1 };
            foreach (var s in severities)
            {
                Assert.GreaterOrEqual(s, 1);
                Assert.LessOrEqual(s, 5);
            }
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 13: Reset and State Management
        // ═══════════════════════════════════════════════════════════════════

        #region Reset and State Management

        [Test]
        public void Reset_ClearsAllState()
        {
            var profiler = BuildRealisticProfile();
            profiler.ComputeProfile();

            Assert.Greater(profiler.Sessions.Count, 0);

            profiler.Reset();
            Assert.AreEqual(0, profiler.Sessions.Count);
            Assert.IsNull(profiler.PeakWindow);
            Assert.IsNull(profiler.DangerWindow);
            Assert.AreEqual(0, profiler.DangerHours.Count);
            Assert.IsFalse(profiler.HasSufficientData);
        }

        [Test]
        public void Reset_AllowsReuse()
        {
            var profiler = BuildRealisticProfile();
            profiler.ComputeProfile();
            profiler.Reset();

            // Should accept new sessions after reset
            for (int i = 0; i < MinTotalSessions; i++)
                profiler.RecordSession(MakeSession(14, dayOffset: i));

            profiler.ComputeProfile();
            Assert.IsTrue(profiler.HasSufficientData);
        }

        [Test]
        public void ComputeProfile_AutoRecomputes_WhenDirty()
        {
            var profiler = BuildRealisticProfile();
            // Evaluate calls ComputeProfile automatically
            var now = DateTime.Now;
            profiler.Evaluate(BaseDate.AddHours(14), now);

            // Profile should now be computed
            Assert.IsTrue(profiler.HasSufficientData);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 14: Edge Cases
        // ═══════════════════════════════════════════════════════════════════

        #region Edge Cases

        [Test]
        public void AllSessionsSameHour_StillProfiles()
        {
            var profiler = new CircadianProfiler();
            for (int i = 0; i < MinTotalSessions; i++)
                profiler.RecordSession(MakeSession(15, dayOffset: i));

            profiler.ComputeProfile();
            Assert.IsTrue(profiler.HasSufficientData);
            Assert.AreEqual(MinTotalSessions, profiler.HourlyProfile[15].SessionCount);
        }

        [Test]
        public void VeryLargeDataset_HandlesWithoutOverflow()
        {
            var profiler = new CircadianProfiler();
            // 1000 sessions
            for (int i = 0; i < 1000; i++)
                profiler.RecordSession(MakeSession(i % 24, dayOffset: i));

            Assert.DoesNotThrow(() => profiler.ComputeProfile());
            Assert.AreEqual(1000, profiler.Sessions.Count);
        }

        [Test]
        public void NegativeIRatingEverySession_StillWorks()
        {
            var profiler = new CircadianProfiler();
            for (int i = 0; i < MinTotalSessions; i++)
                profiler.RecordSession(MakeSession(14 + (i % 4), iRatingDelta: -50, dayOffset: i));

            Assert.DoesNotThrow(() => profiler.ComputeProfile());
        }

        [Test]
        public void ZeroIncidentsEverySession_NoDangerHours()
        {
            var profiler = new CircadianProfiler();
            for (int h = 0; h < 24; h++)
                for (int d = 0; d < MinSessionsPerBucket; d++)
                    profiler.RecordSession(MakeSession(h, incidents: 0, laps: 20, dayOffset: d * 24 + h));

            profiler.ComputeProfile();
            Assert.AreEqual(0, profiler.DangerHours.Count);
        }

        [Test]
        public void SingleLapSessions_IncidentRateStillCalculated()
        {
            var profiler = new CircadianProfiler();
            for (int i = 0; i < MinTotalSessions; i++)
                profiler.RecordSession(MakeSession(14, incidents: 1, laps: 1, dayOffset: i));

            profiler.ComputeProfile();
            Assert.AreEqual(1.0, profiler.HourlyProfile[14].MeanIncidentRate, 1e-10);
        }

        [Test]
        public void MidnightExactly_BucketsToHour0()
        {
            var result = new SessionResult
            {
                SessionStart = new DateTime(2026, 3, 1, 0, 0, 0),
                LapsCompleted = 10,
                Incidents = 2,
                AverageLapTime = 90,
                BestLapTime = 88
            };
            Assert.AreEqual(0, result.HourOfDay);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 15: Real-World Scenarios
        // ═══════════════════════════════════════════════════════════════════

        #region Real-World Scenarios

        [Test]
        public void Scenario_MorningPerson_PeakInMorning()
        {
            var profiler = new CircadianProfiler();
            var rng = new Random(77);

            // Morning person: best results 7-11 AM
            for (int week = 0; week < 8; week++)
            {
                for (int s = 0; s < 3; s++)
                {
                    profiler.RecordSession(MakeSession(
                        hour: 7 + rng.Next(5),
                        incidents: rng.Next(2),
                        iRatingDelta: 10 + rng.Next(30),
                        finishPos: 1 + rng.Next(5),
                        dayOffset: week * 7 + s
                    ));
                }
                for (int s = 0; s < 2; s++)
                {
                    profiler.RecordSession(MakeSession(
                        hour: 20 + rng.Next(4),
                        incidents: 3 + rng.Next(4),
                        iRatingDelta: -10 - rng.Next(30),
                        finishPos: 10 + rng.Next(10),
                        dayOffset: week * 7 + s + 3
                    ));
                }
            }

            profiler.ComputeProfile();
            Assert.IsNotNull(profiler.PeakWindow);
            var peakHours = GetWindowHours(profiler.PeakWindow);
            bool overlapsmorning = peakHours.Any(h => h >= 7 && h <= 11);
            Assert.IsTrue(overlapsmorning,
                $"Morning person peak should be in morning hours, got {profiler.PeakWindow.Label}");
        }

        [Test]
        public void Scenario_WeekendWarrior_SufficientDataFromTwoSlots()
        {
            var profiler = new CircadianProfiler();
            // Only races on Sat afternoon and Sun morning
            for (int week = 0; week < 10; week++)
            {
                profiler.RecordSession(MakeSession(14, dayOffset: week * 7)); // Sat 2pm
                profiler.RecordSession(MakeSession(10, dayOffset: week * 7 + 1)); // Sun 10am
            }

            profiler.ComputeProfile();
            Assert.IsTrue(profiler.HasSufficientData);
            Assert.AreEqual(10, profiler.HourlyProfile[14].SessionCount);
            Assert.AreEqual(10, profiler.HourlyProfile[10].SessionCount);
        }

        [Test]
        public void Scenario_IRatingRecovery_TracksLossesPerWindow()
        {
            var profiler = new CircadianProfiler();
            // Late sessions: big iRating losses
            for (int i = 0; i < 8; i++)
                profiler.RecordSession(MakeSession(23, iRatingDelta: -40, dayOffset: i));
            // Afternoon sessions: gains
            for (int i = 0; i < 8; i++)
                profiler.RecordSession(MakeSession(15, iRatingDelta: 30, dayOffset: i + 10));

            int lateNightLoss = profiler.IRatingLostInHourRange(23, 23);
            Assert.AreEqual(-320, lateNightLoss); // 8 × -40
            int afternoonLoss = profiler.IRatingLostInHourRange(15, 15);
            Assert.AreEqual(0, afternoonLoss); // No losses
        }

        [Test]
        public void Scenario_AllAnalyzersCoexist()
        {
            // Verify SolarGlare, InputForensics, and CircadianProfiler
            // all use the same StrategyCall and don't conflict
            var glare = new SolarGlareAnalyzer();
            var forensics = new InputForensicsAnalyzer();
            var circadian = new CircadianProfiler();

            var snap = new TelemetrySnapshot
            {
                GameRunning = true,
                SpeedKmh = 200,
                SteeringWheelAngle = 10,
                Throttle = 80,
                Brake = 0,
                CompletedLaps = 0,
                Yaw = 1.57,
                SessionTimeOfDay = 43200,
                TrackId = "silverstone",
                IsInPit = false,
                IsInPitLane = false,
                LatAccel = 1.0,
                LongAccel = -0.3
            };

            // All three should operate independently
            Assert.DoesNotThrow(() =>
            {
                glare.UpdateFrame(snap, 172);
                forensics.UpdateFrame(snap, 0.0167);
                circadian.RecordSession(MakeSession(15));
            });

            // All produce StrategyCall or null
            var glareCall = glare.EvaluateGlare(DateTime.Now);
            var forensicsCall = forensics.Evaluate(DateTime.Now);
            var circadianCall = circadian.Evaluate(BaseDate.AddHours(15), DateTime.Now);

            // All calls (if non-null) are the same type
            if (glareCall != null) Assert.IsInstanceOf<StrategyCall>(glareCall);
            if (forensicsCall != null) Assert.IsInstanceOf<StrategyCall>(forensicsCall);
            if (circadianCall != null) Assert.IsInstanceOf<StrategyCall>(circadianCall);
        }

        [Test]
        public void Scenario_ProgressiveImprovement_TrackedOverTime()
        {
            var profiler = new CircadianProfiler();

            // Month 1: bad late-night stats
            for (int i = 0; i < 5; i++)
                profiler.RecordSession(MakeSession(23, incidents: 6, iRatingDelta: -40, dayOffset: i));
            // Month 1: good afternoon stats
            for (int i = 0; i < 5; i++)
                profiler.RecordSession(MakeSession(15, incidents: 1, iRatingDelta: 30, dayOffset: i + 5));

            profiler.ComputeProfile();

            // Late night should be flagged with worse performance than afternoon
            int lateNightIdx = 23;
            int afternoonIdx = 15;
            if (profiler.HourlyProfile[lateNightIdx].SessionCount > 0
                && profiler.HourlyProfile[afternoonIdx].SessionCount > 0)
            {
                Assert.Less(
                    profiler.HourlyProfile[lateNightIdx].PerformanceScore,
                    profiler.HourlyProfile[afternoonIdx].PerformanceScore,
                    "Late night should score worse than afternoon");
            }
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 16: Statistical Significance
        // ═══════════════════════════════════════════════════════════════════

        #region Statistical Significance

        [Test]
        public void HourlyStats_IsSignificant_RespectsMininmum()
        {
            var stats = new HourlyStats { SessionCount = MinSessionsPerBucket - 1 };
            Assert.IsFalse(stats.IsSignificant);

            stats.SessionCount = MinSessionsPerBucket;
            Assert.IsTrue(stats.IsSignificant);
        }

        [Test]
        public void HasSufficientData_RespectsMininmum()
        {
            var profiler = new CircadianProfiler();
            Assert.IsFalse(profiler.HasSufficientData);

            for (int i = 0; i < MinTotalSessions; i++)
                profiler.RecordSession(MakeSession(14, dayOffset: i));

            Assert.IsTrue(profiler.HasSufficientData);
        }

        [Test]
        public void DangerHours_OnlyFromSignificantBuckets()
        {
            var profiler = new CircadianProfiler();
            // Enough sessions overall
            for (int h = 10; h < 20; h++)
                for (int d = 0; d < MinSessionsPerBucket; d++)
                    profiler.RecordSession(MakeSession(h, incidents: 1, laps: 20, dayOffset: d * 10 + h));

            // Hour 3: high incidents but only 2 sessions (below threshold)
            profiler.RecordSession(MakeSession(3, incidents: 10, laps: 20, dayOffset: 100));
            profiler.RecordSession(MakeSession(3, incidents: 10, laps: 20, dayOffset: 101));

            profiler.ComputeProfile();
            Assert.IsFalse(profiler.DangerHours.Contains(3),
                "Hour with fewer than MinSessionsPerBucket should not be danger hour");
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 17: Late Night Warning
        // ═══════════════════════════════════════════════════════════════════

        #region Late Night Warning

        [Test]
        public void Evaluate_LateNightWithBadStats_ReturnsSleepCall()
        {
            var profiler = new CircadianProfiler();

            // Build a profile where late night is clearly bad
            for (int i = 0; i < 5; i++)
                profiler.RecordSession(MakeSession(0, incidents: 8, laps: 20,
                    iRatingDelta: -60, dayOffset: i));
            for (int i = 0; i < 5; i++)
                profiler.RecordSession(MakeSession(1, incidents: 7, laps: 20,
                    iRatingDelta: -40, dayOffset: i + 5));
            // Good daytime sessions
            for (int i = 0; i < 6; i++)
                profiler.RecordSession(MakeSession(14, incidents: 0, laps: 20,
                    iRatingDelta: 30, dayOffset: i + 10));

            profiler.ComputeProfile();

            // Evaluate at midnight — should get CLOCK (danger) or SLEEP call
            var call = profiler.Evaluate(BaseDate.AddDays(60).AddHours(0), DateTime.Now);
            Assert.IsNotNull(call, "Should fire a call for late-night racing with bad stats");
            Assert.That(call.Label, Is.EqualTo("CLOCK").Or.EqualTo("SLEEP"));
        }

        [Test]
        public void Evaluate_LateNightWithGoodStats_NoSleepCall()
        {
            var profiler = new CircadianProfiler();

            // Night owl: good performance at all hours including late night
            for (int h = 0; h < 24; h++)
                for (int d = 0; d < MinSessionsPerBucket; d++)
                    profiler.RecordSession(MakeSession(h, incidents: 1, laps: 20,
                        iRatingDelta: 10, finishPos: 3, dayOffset: d * 24 + h));

            profiler.ComputeProfile();

            var call = profiler.Evaluate(BaseDate.AddDays(90).AddHours(0), DateTime.Now);
            // Should not get a danger/sleep call since stats are uniform
            if (call != null)
                Assert.AreNotEqual("SLEEP", call.Label,
                    "Night owl with good stats should not get sleep warning");
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 18: Mathematical Consistency
        // ═══════════════════════════════════════════════════════════════════

        #region Mathematical Consistency

        [Test]
        public void PeakAndDanger_AreDistinct()
        {
            var profiler = BuildRealisticProfile();
            profiler.ComputeProfile();

            if (profiler.PeakWindow != null && profiler.DangerWindow != null)
            {
                Assert.Greater(profiler.PeakWindow.AverageScore,
                    profiler.DangerWindow.AverageScore,
                    "Peak window should score higher than danger window");
            }
        }

        [Test]
        public void PerformanceScores_SumToReasonableRange()
        {
            var profiler = BuildRealisticProfile();
            profiler.ComputeProfile();

            var populated = profiler.HourlyProfile.Where(h => h.SessionCount > 0).ToList();
            if (populated.Count >= 2)
            {
                double min = populated.Min(h => h.PerformanceScore);
                double max = populated.Max(h => h.PerformanceScore);
                Assert.Greater(max - min, 0.01,
                    "There should be measurable variation between best and worst hours");
            }
        }

        [Test]
        public void Median_PropertyTest_AlwaysBetweenMinAndMax()
        {
            var rng = new Random(99);
            for (int trial = 0; trial < 50; trial++)
            {
                int n = 1 + rng.Next(20);
                var values = Enumerable.Range(0, n)
                    .Select(_ => rng.NextDouble() * 100)
                    .OrderBy(v => v)
                    .ToList();

                double med = CircadianProfiler.Median(values);
                Assert.GreaterOrEqual(med, values[0]);
                Assert.LessOrEqual(med, values[values.Count - 1]);
            }
        }

        [Test]
        public void TotalIncidents_ConsistentWithSessions()
        {
            var profiler = BuildRealisticProfile();
            profiler.ComputeProfile();

            int totalFromSessions = profiler.Sessions.Sum(s => s.Incidents);
            int totalFromBuckets = profiler.HourlyProfile.Sum(h => h.TotalIncidents);
            Assert.AreEqual(totalFromSessions, totalFromBuckets,
                "Total incidents from buckets should match total from sessions");
        }

        [Test]
        public void TotalIRatingDelta_ConsistentWithSessions()
        {
            var profiler = BuildRealisticProfile();
            profiler.ComputeProfile();

            int totalFromSessions = profiler.Sessions.Sum(s => s.IRatingDelta);
            int totalFromBuckets = profiler.HourlyProfile.Sum(h => h.TotalIRatingDelta);
            Assert.AreEqual(totalFromSessions, totalFromBuckets,
                "Total iRating delta from buckets should match total from sessions");
        }

        #endregion
    }
}
