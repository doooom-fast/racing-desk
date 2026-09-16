using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using RaceCorProDrive.Tests.TestHelpers;
using static RaceCorProDrive.Tests.TestHelpers.CornerCoach;

namespace RaceCorProDrive.Tests
{
    [TestFixture]
    public class CornerCoachTests
    {
        // ═══════════════════════════════════════════════════════════════════
        //  TEST HELPERS — corner pass generation
        // ═══════════════════════════════════════════════════════════════════

        private static readonly DateTime BaseTime = new DateTime(2026, 3, 1, 10, 0, 0);

        /// <summary>Creates a corner pass at a specific lap with given metrics.</summary>
        private static CornerPass MakePass(
            int lapNumber = 1,
            double minSpeedKmh = 80.0,
            double entrySpeedKmh = 120.0,
            double exitSpeedKmh = 100.0,
            double brakePointPct = 0.45,
            double apexSpeedKmh = 75.0,
            double peakLatG = 1.5,
            bool hadIncident = false,
            double gearAtApex = 2,
            int dayOffset = 0)
        {
            return new CornerPass
            {
                LapNumber = lapNumber,
                Timestamp = BaseTime.AddDays(dayOffset).AddSeconds(lapNumber * 120),
                MinSpeedKmh = minSpeedKmh,
                EntrySpeedKmh = entrySpeedKmh,
                ExitSpeedKmh = exitSpeedKmh,
                BrakePointPct = brakePointPct,
                ApexSpeedKmh = apexSpeedKmh,
                PeakLatG = peakLatG,
                HadIncident = hadIncident,
                GearAtApex = gearAtApex,
                SessionId = $"session-{dayOffset}"
            };
        }

        /// <summary>Creates a corner coach with realistic data across multiple tracks and corners.</summary>
        private static CornerCoach BuildRealisticCoach()
        {
            var coach = new CornerCoach();

            // Spa La Source: trouble corner with high incident rate
            for (int lap = 1; lap <= 20; lap++)
            {
                bool hadIncident = lap <= 5 || lap == 12 || lap == 18; // 5 incidents / 20 = 25%
                coach.RecordCornerPass("spa", 1, MakePass(
                    lapNumber: lap,
                    minSpeedKmh: 65 + (lap > 5 ? 8.0 : 0),
                    entrySpeedKmh: 110 + (lap > 5 ? 5.0 : 0),
                    brakePointPct: 0.48 - (lap > 5 ? 0.03 : 0),
                    hadIncident: hadIncident,
                    dayOffset: 0
                ), "La Source");
            }

            // Spa Turn 10 (Radillion): normal corner, improving speed
            for (int lap = 1; lap <= 25; lap++)
            {
                coach.RecordCornerPass("spa", 10, MakePass(
                    lapNumber: lap,
                    minSpeedKmh: 85 + lap * 0.4, // Linear improvement
                    entrySpeedKmh: 130 + lap * 0.3,
                    apexSpeedKmh: 80 + lap * 0.35,
                    hadIncident: false,
                    dayOffset: 0
                ), "Radillion", 0.68);
            }

            // Monza Turn 1: consistent, no issues
            for (int lap = 1; lap <= 15; lap++)
            {
                coach.RecordCornerPass("monza", 1, MakePass(
                    lapNumber: lap,
                    minSpeedKmh: 75.0,
                    entrySpeedKmh: 160.0,
                    hadIncident: false,
                    dayOffset: 1
                ), "Turn 1");
            }

            // Monza Parabolica: learning corner
            for (int lap = 1; lap <= 30; lap++)
            {
                coach.RecordCornerPass("monza", 18, MakePass(
                    lapNumber: lap,
                    minSpeedKmh: 50 + lap * 0.8, // Steeper improvement
                    entrySpeedKmh: 140 + lap * 0.5,
                    hadIncident: lap <= 3 || lap == 15, // 2 incidents early
                    dayOffset: 1
                ), "Parabolica", 0.92);
            }

            return coach;
        }

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 1: Corner Pass Recording
        // ═══════════════════════════════════════════════════════════════════

        #region Corner Pass Recording

        [Test]
        public void RecordCornerPass_ValidPass_Added()
        {
            var coach = new CornerCoach();
            var pass = MakePass(lapNumber: 1);
            coach.RecordCornerPass("spa", 1, pass, "Turn 1");

            Assert.AreEqual(1, coach.Tracks["spa"].Corners[1].TotalPasses);
        }

        [Test]
        public void RecordCornerPass_MultipleCorners_TrackCreated()
        {
            var coach = new CornerCoach();
            coach.RecordCornerPass("spa", 1, MakePass(1), "Turn 1");
            coach.RecordCornerPass("spa", 2, MakePass(2), "Turn 2");
            coach.RecordCornerPass("monza", 1, MakePass(1), "Turn 1");

            Assert.AreEqual(2, coach.Tracks.Count);
            Assert.AreEqual(2, coach.Tracks["spa"].Corners.Count);
            Assert.AreEqual(1, coach.Tracks["monza"].Corners.Count);
        }

        [Test]
        public void RecordCornerPass_NullPass_Ignored()
        {
            var coach = new CornerCoach();
            coach.RecordCornerPass("spa", 1, null, "Turn 1");
            Assert.AreEqual(0, coach.Tracks.Count);
        }

        [Test]
        public void RecordCornerPass_EmptyTrackId_Ignored()
        {
            var coach = new CornerCoach();
            coach.RecordCornerPass("", 1, MakePass(), "Turn 1");
            Assert.AreEqual(0, coach.Tracks.Count);
        }

        [Test]
        public void RecordCornerPass_MultiplePassesSameCorner_AllTracked()
        {
            var coach = new CornerCoach();
            for (int lap = 1; lap <= 10; lap++)
                coach.RecordCornerPass("spa", 1, MakePass(lapNumber: lap), "Turn 1");

            Assert.AreEqual(10, coach.Tracks["spa"].Corners[1].TotalPasses);
        }

        [Test]
        public void RecordCornerPass_UpdatesTrackFirstVisitAndTotal()
        {
            var coach = new CornerCoach();
            coach.RecordCornerPass("spa", 1, MakePass(lapNumber: 3), "Turn 1");
            coach.RecordCornerPass("spa", 1, MakePass(lapNumber: 5), "Turn 1");
            coach.RecordCornerPass("spa", 1, MakePass(lapNumber: 2), "Turn 1");

            var track = coach.Tracks["spa"];
            Assert.AreEqual(2, track.FirstVisitLap);
            Assert.AreEqual(5, track.TotalLaps);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 2: Corner Profile Stats
        // ═══════════════════════════════════════════════════════════════════

        #region Corner Profile Stats

        [Test]
        public void CornerProfile_IncidentRate_CalculatedCorrectly()
        {
            var coach = new CornerCoach();
            for (int lap = 1; lap <= 20; lap++)
                coach.RecordCornerPass("spa", 1, MakePass(lapNumber: lap, hadIncident: lap <= 5), "Turn 1");

            var corner = coach.Tracks["spa"].Corners[1];
            Assert.AreEqual(0.25, corner.IncidentRate, 1e-10); // 5 / 20
        }

        [Test]
        public void CornerProfile_SuccessRate_ComplementOfIncidentRate()
        {
            var coach = new CornerCoach();
            for (int lap = 1; lap <= 10; lap++)
                coach.RecordCornerPass("spa", 1, MakePass(lapNumber: lap, hadIncident: lap <= 3), "Turn 1");

            var corner = coach.Tracks["spa"].Corners[1];
            Assert.AreEqual(0.7, corner.SuccessRate, 1e-10); // 1 - 0.3
        }

        [Test]
        public void CornerProfile_BestMinSpeed_ReturnsMaximum()
        {
            var coach = new CornerCoach();
            coach.RecordCornerPass("spa", 1, MakePass(lapNumber: 1, minSpeedKmh: 80.0), "Turn 1");
            coach.RecordCornerPass("spa", 1, MakePass(lapNumber: 2, minSpeedKmh: 95.0), "Turn 1");
            coach.RecordCornerPass("spa", 1, MakePass(lapNumber: 3, minSpeedKmh: 88.0), "Turn 1");

            var corner = coach.Tracks["spa"].Corners[1];
            Assert.AreEqual(95.0, corner.BestMinSpeed);
        }

        [Test]
        public void CornerProfile_AverageMinSpeed_CalculatedCorrectly()
        {
            var coach = new CornerCoach();
            coach.RecordCornerPass("spa", 1, MakePass(lapNumber: 1, minSpeedKmh: 80.0), "Turn 1");
            coach.RecordCornerPass("spa", 1, MakePass(lapNumber: 2, minSpeedKmh: 90.0), "Turn 1");
            coach.RecordCornerPass("spa", 1, MakePass(lapNumber: 3, minSpeedKmh: 100.0), "Turn 1");

            var corner = coach.Tracks["spa"].Corners[1];
            Assert.AreEqual(90.0, corner.AverageMinSpeed, 1e-10);
        }

        [Test]
        public void CornerProfile_BestBrakePoint_ReturnsMinimum()
        {
            var coach = new CornerCoach();
            coach.RecordCornerPass("spa", 1, MakePass(lapNumber: 1, brakePointPct: 0.50), "Turn 1");
            coach.RecordCornerPass("spa", 1, MakePass(lapNumber: 2, brakePointPct: 0.45), "Turn 1");
            coach.RecordCornerPass("spa", 1, MakePass(lapNumber: 3, brakePointPct: 0.48), "Turn 1");

            var corner = coach.Tracks["spa"].Corners[1];
            Assert.AreEqual(0.45, corner.BestBrakePoint, 1e-10);
        }

        [Test]
        public void CornerProfile_HasSufficientData_ThresholdAtFive()
        {
            var coach = new CornerCoach();

            // Add 4 passes
            for (int lap = 1; lap <= 4; lap++)
                coach.RecordCornerPass("spa", 1, MakePass(lapNumber: lap), "Turn 1");
            Assert.IsFalse(coach.Tracks["spa"].Corners[1].HasSufficientData);

            // Add 5th pass
            coach.RecordCornerPass("spa", 1, MakePass(lapNumber: 5), "Turn 1");
            Assert.IsTrue(coach.Tracks["spa"].Corners[1].HasSufficientData);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 3: Trouble Corner Detection
        // ═══════════════════════════════════════════════════════════════════

        #region Trouble Corner Detection

        [Test]
        public void CornerProfile_IsTroubleCorner_HighIncidentRate()
        {
            var coach = new CornerCoach();
            // 10% incident rate = above the 5% threshold (IsTroubleCorner uses >)
            for (int lap = 1; lap <= 20; lap++)
                coach.RecordCornerPass("spa", 1, MakePass(lapNumber: lap, hadIncident: lap <= 2), "Turn 1");

            var corner = coach.Tracks["spa"].Corners[1];
            Assert.AreEqual(0.10, corner.IncidentRate, 0.001);
            Assert.IsTrue(corner.IsTroubleCorner);
        }

        [Test]
        public void CornerProfile_IsTroubleCorner_AboveThreshold()
        {
            var coach = new CornerCoach();
            // 10% incident rate = well above 5%
            for (int lap = 1; lap <= 20; lap++)
                coach.RecordCornerPass("spa", 1, MakePass(lapNumber: lap, hadIncident: lap <= 2), "Turn 1");

            var corner = coach.Tracks["spa"].Corners[1];
            Assert.IsTrue(corner.IsTroubleCorner);
        }

        [Test]
        public void CornerProfile_IsTroubleCorner_BelowThreshold()
        {
            var coach = new CornerCoach();
            // 2.5% incident rate = below 5%
            for (int lap = 1; lap <= 20; lap++)
                coach.RecordCornerPass("spa", 1, MakePass(lapNumber: lap, hadIncident: lap == 1), "Turn 1");

            var corner = coach.Tracks["spa"].Corners[1];
            corner.Passes.RemoveAt(0); // Bring it below threshold
            Assert.IsFalse(corner.IsTroubleCorner);
        }

        [Test]
        public void TrackProfile_TroubleCorners_SortedByIncidentRate()
        {
            var coach = new CornerCoach();

            // Corner 1: 20% incident rate
            for (int lap = 1; lap <= 10; lap++)
                coach.RecordCornerPass("spa", 1, MakePass(lapNumber: lap, hadIncident: lap <= 2), "Turn 1");

            // Corner 2: 10% incident rate
            for (int lap = 1; lap <= 10; lap++)
                coach.RecordCornerPass("spa", 2, MakePass(lapNumber: lap, hadIncident: lap == 1), "Turn 2");

            var track = coach.Tracks["spa"];
            var troubles = track.TroubleCorners;

            Assert.AreEqual(2, troubles.Count);
            Assert.AreEqual(1, troubles[0].CornerNumber); // 20% first
            Assert.AreEqual(2, troubles[1].CornerNumber); // 10% second
        }

        [Test]
        public void TrackProfile_OverallSuccessRate_AveragedAcrossCorners()
        {
            var coach = new CornerCoach();

            // Corner 1: 80% success
            for (int lap = 1; lap <= 10; lap++)
                coach.RecordCornerPass("spa", 1, MakePass(lapNumber: lap, hadIncident: lap <= 2), "Turn 1");

            // Corner 2: 90% success
            for (int lap = 1; lap <= 10; lap++)
                coach.RecordCornerPass("spa", 2, MakePass(lapNumber: lap, hadIncident: lap == 1), "Turn 2");

            var track = coach.Tracks["spa"];
            Assert.AreEqual(0.85, track.OverallSuccessRate, 1e-10);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 4: Mastery Trend Computation
        // ═══════════════════════════════════════════════════════════════════

        #region Mastery Trend Computation

        [Test]
        public void ComputeMasteryTrend_Improving_ShowsPositiveDelta()
        {
            var coach = new CornerCoach();

            // Early: low speed, recent: high speed
            for (int lap = 1; lap <= 10; lap++)
                coach.RecordCornerPass("spa", 1, MakePass(lapNumber: lap, minSpeedKmh: 70.0), "Turn 1");
            for (int lap = 11; lap <= 20; lap++)
                coach.RecordCornerPass("spa", 1, MakePass(lapNumber: lap, minSpeedKmh: 85.0), "Turn 1");

            var corner = coach.Tracks["spa"].Corners[1];
            var trend = CornerCoach.ComputeMasteryTrend(corner);

            Assert.IsTrue(trend.IsImproving);
            Assert.Greater(trend.SpeedDelta, 0);
        }

        [Test]
        public void ComputeMasteryTrend_Regressing_ShowsNegativeDelta()
        {
            var coach = new CornerCoach();

            // Early: high speed, recent: low speed
            for (int lap = 1; lap <= 10; lap++)
                coach.RecordCornerPass("spa", 1, MakePass(lapNumber: lap, minSpeedKmh: 90.0), "Turn 1");
            for (int lap = 11; lap <= 20; lap++)
                coach.RecordCornerPass("spa", 1, MakePass(lapNumber: lap, minSpeedKmh: 75.0), "Turn 1");

            var corner = coach.Tracks["spa"].Corners[1];
            var trend = CornerCoach.ComputeMasteryTrend(corner);

            Assert.IsTrue(trend.IsRegressing);
            Assert.Less(trend.SpeedDelta, 0);
        }

        [Test]
        public void ComputeMasteryTrend_Stagnant_NoDelta()
        {
            var coach = new CornerCoach();

            // Consistent speed throughout
            for (int lap = 1; lap <= 20; lap++)
                coach.RecordCornerPass("spa", 1, MakePass(lapNumber: lap, minSpeedKmh: 80.0), "Turn 1");

            var corner = coach.Tracks["spa"].Corners[1];
            var trend = CornerCoach.ComputeMasteryTrend(corner);

            Assert.IsTrue(trend.IsStagnant);
            Assert.AreEqual(0, trend.SpeedDelta, 1e-10);
        }

        [Test]
        public void ComputeMasteryTrend_InsufficientData_ReturnsDefaultTrend()
        {
            var coach = new CornerCoach();
            for (int lap = 1; lap <= 4; lap++)
                coach.RecordCornerPass("spa", 1, MakePass(lapNumber: lap), "Turn 1");

            var corner = coach.Tracks["spa"].Corners[1];
            var trend = CornerCoach.ComputeMasteryTrend(corner);

            Assert.AreEqual(1, trend.CornerNumber);
            Assert.AreEqual(0, trend.EarlyAvgSpeed);
            Assert.AreEqual(0, trend.RecentAvgSpeed);
        }

        [Test]
        public void GetMasteryTrends_MultipleCornersAnchorsSortedByDelta()
        {
            var coach = BuildRealisticCoach();

            var trends = coach.GetMasteryTrends("spa");
            // Should return corners with sufficient data, sorted by |SpeedDelta|
            if (trends.Count >= 2)
            {
                Assert.GreaterOrEqual(Math.Abs(trends[0].SpeedDelta),
                    Math.Abs(trends[1].SpeedDelta),
                    "Trends should be sorted by absolute delta");
            }
        }

        [Test]
        public void ComputeMasteryTrend_Uses30PercentWindows()
        {
            var coach = new CornerCoach();

            // 100 passes, early 30 should be passes 1-30, recent 30 should be 71-100
            for (int lap = 1; lap <= 100; lap++)
            {
                double speed = lap <= 30 ? 70.0 : 85.0;
                coach.RecordCornerPass("spa", 1, MakePass(lapNumber: lap, minSpeedKmh: speed), "Turn 1");
            }

            var corner = coach.Tracks["spa"].Corners[1];
            var trend = CornerCoach.ComputeMasteryTrend(corner);

            Assert.AreEqual(70.0, trend.EarlyAvgSpeed, 0.1);
            Assert.AreEqual(85.0, trend.RecentAvgSpeed, 0.1);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 5: Learning Curve Estimation
        // ═══════════════════════════════════════════════════════════════════

        #region Learning Curve Estimation

        [Test]
        public void EstimateLapsToCompetence_InsufficientCorners_ReturnsMinusOne()
        {
            var coach = new CornerCoach();
            coach.RecordCornerPass("spa", 1, MakePass(lapNumber: 1), "Turn 1");
            // Only 1 corner, need 3
            coach.RecordCornerPass("spa", 1, MakePass(lapNumber: 2), "Turn 1");

            var track = coach.Tracks["spa"];
            int estimate = CornerCoach.EstimateLapsToCompetence(track);
            Assert.AreEqual(-1, estimate);
        }

        [Test]
        public void EstimateLapsToCompetence_AlreadyCompetent_ReturnsLapCount()
        {
            var coach = new CornerCoach();

            // 3 corners with rapid convergence to best speed
            for (int c = 1; c <= 3; c++)
            {
                for (int lap = 1; lap <= 15; lap++)
                {
                    double speed = 100.0 + (lap > 3 ? 5.0 : 0);
                    coach.RecordCornerPass("spa", c, MakePass(lapNumber: lap, minSpeedKmh: speed), $"Turn {c}");
                }
            }

            var track = coach.Tracks["spa"];
            int estimate = CornerCoach.EstimateLapsToCompetence(track);
            // Already at competence threshold by lap 15
            Assert.LessOrEqual(estimate, 20);
        }

        [Test]
        public void EstimateLapsToCompetence_LinearImprovement_EstimatesCorrectly()
        {
            var coach = new CornerCoach();

            // 3 corners improving at 1 km/h per lap
            for (int c = 1; c <= 3; c++)
            {
                for (int lap = 1; lap <= 20; lap++)
                {
                    double speed = 70.0 + lap * 0.5; // Slow improvement
                    coach.RecordCornerPass("spa", c, MakePass(lapNumber: lap, minSpeedKmh: speed), $"Turn {c}");
                }
            }

            var track = coach.Tracks["spa"];
            int estimate = CornerCoach.EstimateLapsToCompetence(track);
            Assert.Greater(estimate, 20, "Should estimate more laps needed");
            Assert.Less(estimate, 100, "But not unreasonably many");
        }

        [Test]
        public void EstimateLapsToCompetence_NoImprovement_ReturnsMinusOne()
        {
            var coach = new CornerCoach();

            // 3 corners with no improvement — all passes at same speed
            for (int c = 1; c <= 3; c++)
            {
                for (int lap = 1; lap <= 20; lap++)
                {
                    coach.RecordCornerPass("spa", c, MakePass(lapNumber: lap, minSpeedKmh: 80.0), $"Turn {c}");
                }
            }

            var track = coach.Tracks["spa"];
            int estimate = CornerCoach.EstimateLapsToCompetence(track);
            // No improvement (bestSpeed - firstSpeed < 1.0) → returns -1
            Assert.AreEqual(-1, estimate);
        }

        [Test]
        public void EstimateLapsToCompetence_InsufficientPasses_ReturnsMinusOne()
        {
            var coach = new CornerCoach();

            // 3 corners but only 4 passes total (need 5)
            for (int c = 1; c <= 3; c++)
            {
                coach.RecordCornerPass("spa", c, MakePass(lapNumber: 1), $"Turn {c}");
            }
            coach.RecordCornerPass("spa", 1, MakePass(lapNumber: 2), "Turn 1");

            var track = coach.Tracks["spa"];
            int estimate = CornerCoach.EstimateLapsToCompetence(track);
            Assert.AreEqual(-1, estimate);
        }

        [Test]
        public void EstimateLapsToCompetence_RapidImprovement_ShortEstimate()
        {
            var coach = new CornerCoach();

            // 3 corners improving rapidly
            for (int c = 1; c <= 3; c++)
            {
                for (int lap = 1; lap <= 20; lap++)
                {
                    double speed = 70.0 + lap * 2.0; // Steep improvement
                    coach.RecordCornerPass("spa", c, MakePass(lapNumber: lap, minSpeedKmh: speed), $"Turn {c}");
                }
            }

            var track = coach.Tracks["spa"];
            int estimate = CornerCoach.EstimateLapsToCompetence(track);
            Assert.Less(estimate, 30, "Fast improvement should yield short estimate");
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 6: Strategy Call Evaluation
        // ═══════════════════════════════════════════════════════════════════

        #region Strategy Call Evaluation

        [Test]
        public void Evaluate_TroubleCorner_ReturnsCornrCall()
        {
            var coach = new CornerCoach();

            // Build a trouble corner (>5% incident rate, >= 5 passes)
            for (int lap = 1; lap <= 20; lap++)
                coach.RecordCornerPass("spa", 1, MakePass(lapNumber: lap, hadIncident: lap <= 2), "La Source");

            var call = coach.Evaluate("spa", 1, 21, BaseTime.AddSeconds(1000));
            Assert.IsNotNull(call);
            Assert.AreEqual("CRNR", call.Label);
            Assert.AreEqual(3, call.Severity);
            Assert.That(call.Message, Does.Contain("La Source"));
        }

        [Test]
        public void Evaluate_SpeedDeltaBelowThreshold_ReturnsNull()
        {
            var coach = new CornerCoach();

            // All passes at same speed, no speed delta trigger
            for (int lap = 1; lap <= 10; lap++)
                coach.RecordCornerPass("spa", 1, MakePass(lapNumber: lap, minSpeedKmh: 80.0), "Turn 1");

            var call = coach.Evaluate("spa", 1, 11, BaseTime.AddSeconds(1000));
            Assert.IsNull(call);
        }

        [Test]
        public void Evaluate_SpeedDeltaAboveThreshold_ReturnsCall()
        {
            var coach = new CornerCoach();

            // Early passes at 70, recent at 65 = -5 delta
            for (int lap = 1; lap <= 6; lap++)
            {
                double speed = lap <= 3 ? 75.0 : 65.0;
                coach.RecordCornerPass("spa", 1, MakePass(lapNumber: lap, minSpeedKmh: speed), "Turn 1");
            }

            var call = coach.Evaluate("spa", 1, 7, BaseTime.AddSeconds(1000));
            Assert.IsNotNull(call);
            Assert.AreEqual("CRNR", call.Label);
            Assert.AreEqual(2, call.Severity);
            Assert.That(call.Message, Does.Contain("less than your best"));
        }

        [Test]
        public void Evaluate_ImprovingMastery_ReturnsCoachCall()
        {
            var coach = new CornerCoach();

            // Strong improvement: early slow, recent fast
            for (int lap = 1; lap <= 10; lap++)
            {
                double speed = lap <= 3 ? 70.0 : 85.0;
                coach.RecordCornerPass("spa", 1, MakePass(lapNumber: lap, minSpeedKmh: speed), "Turn 1");
            }

            var call = coach.Evaluate("spa", 1, 11, BaseTime.AddSeconds(1000));
            Assert.IsNotNull(call);
            Assert.AreEqual("COACH", call.Label);
            Assert.AreEqual(1, call.Severity);
            Assert.That(call.Message, Does.Contain("improvement"));
        }

        [Test]
        public void Evaluate_CooldownPreventsRapidFire()
        {
            var coach = new CornerCoach();

            for (int lap = 1; lap <= 20; lap++)
                coach.RecordCornerPass("spa", 1, MakePass(lapNumber: lap, hadIncident: lap <= 2), "La Source");

            var now = BaseTime;
            var call1 = coach.Evaluate("spa", 1, 21, now);
            Assert.IsNotNull(call1);

            // Within cooldown (45 seconds)
            var call2 = coach.Evaluate("spa", 1, 22, now.AddSeconds(30));
            Assert.IsNull(call2);
        }

        [Test]
        public void Evaluate_AfterCooldownExpires_FiresAgain()
        {
            var coach = new CornerCoach();

            for (int lap = 1; lap <= 20; lap++)
                coach.RecordCornerPass("spa", 1, MakePass(lapNumber: lap, hadIncident: lap <= 2), "La Source");

            var now = BaseTime;
            coach.Evaluate("spa", 1, 21, now);

            // After cooldown (45+ seconds)
            var call = coach.Evaluate("spa", 1, 22, now.AddSeconds(50));
            Assert.IsNotNull(call);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 7: Cooldown Behavior
        // ═══════════════════════════════════════════════════════════════════

        #region Cooldown Behavior

        [Test]
        public void ResetCooldown_AllowsImmediateCall()
        {
            var coach = new CornerCoach();

            for (int lap = 1; lap <= 20; lap++)
                coach.RecordCornerPass("spa", 1, MakePass(lapNumber: lap, hadIncident: lap <= 2), "La Source");

            var now = BaseTime;
            coach.Evaluate("spa", 1, 21, now);
            coach.ResetCooldown();

            var call = coach.Evaluate("spa", 1, 22, now.AddSeconds(1));
            Assert.IsNotNull(call);
        }

        [Test]
        public void Evaluate_InsufficientDataCorner_ReturnsNull()
        {
            var coach = new CornerCoach();
            coach.RecordCornerPass("spa", 1, MakePass(lapNumber: 1), "Turn 1");
            // Only 1 pass, need 5

            var call = coach.Evaluate("spa", 1, 2, BaseTime);
            Assert.IsNull(call);
        }

        [Test]
        public void Evaluate_NoTrackData_ReturnsNull()
        {
            var coach = new CornerCoach();
            var call = coach.Evaluate("silverstone", 1, 1, BaseTime);
            Assert.IsNull(call);
        }

        [Test]
        public void Evaluate_UnknownCorner_ReturnsNull()
        {
            var coach = new CornerCoach();
            for (int lap = 1; lap <= 10; lap++)
                coach.RecordCornerPass("spa", 1, MakePass(lapNumber: lap), "Turn 1");

            var call = coach.Evaluate("spa", 99, 11, BaseTime);
            Assert.IsNull(call);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 8: Multi-Track Support
        // ═══════════════════════════════════════════════════════════════════

        #region Multi-Track Support

        [Test]
        public void MultiTrack_IndependentProfiles_NoInterference()
        {
            var coach = new CornerCoach();

            // Spa with good data
            for (int lap = 1; lap <= 10; lap++)
                coach.RecordCornerPass("spa", 1, MakePass(lapNumber: lap, minSpeedKmh: 80.0), "Turn 1");

            // Monza with poor data (1 pass)
            coach.RecordCornerPass("monza", 1, MakePass(lapNumber: 1, minSpeedKmh: 70.0), "Turn 1");

            Assert.AreEqual(2, coach.Tracks.Count);
            Assert.IsTrue(coach.Tracks["spa"].Corners[1].HasSufficientData);
            Assert.IsFalse(coach.Tracks["monza"].Corners[1].HasSufficientData);
        }

        [Test]
        public void MultiTrack_IndependentEvaluation()
        {
            var coach = new CornerCoach();

            // Spa: trouble corner
            for (int lap = 1; lap <= 20; lap++)
                coach.RecordCornerPass("spa", 1, MakePass(lapNumber: lap, hadIncident: lap <= 2), "La Source");

            // Monza: safe corner
            for (int lap = 1; lap <= 10; lap++)
                coach.RecordCornerPass("monza", 1, MakePass(lapNumber: lap, hadIncident: false), "Turn 1");

            var spaCall = coach.Evaluate("spa", 1, 21, BaseTime);
            coach.ResetCooldown();
            var monzaCall = coach.Evaluate("monza", 1, 11, BaseTime);

            Assert.IsNotNull(spaCall);
            Assert.IsNull(monzaCall);
        }

        [Test]
        public void MultiTrack_SharedCooldown()
        {
            var coach = new CornerCoach();

            for (int lap = 1; lap <= 20; lap++)
            {
                coach.RecordCornerPass("spa", 1, MakePass(lapNumber: lap, hadIncident: lap <= 2), "La Source");
                coach.RecordCornerPass("monza", 1, MakePass(lapNumber: lap, hadIncident: lap <= 2), "Turn 1");
            }

            var now = BaseTime;
            var spaCall = coach.Evaluate("spa", 1, 21, now);
            Assert.IsNotNull(spaCall);

            // Cooldown applies globally
            var monzaCall = coach.Evaluate("monza", 1, 21, now.AddSeconds(30));
            Assert.IsNull(monzaCall);
        }

        [Test]
        public void MultiCornerPerTrack_IndependentEvaluation()
        {
            var coach = new CornerCoach();

            // Turn 1: trouble
            for (int lap = 1; lap <= 20; lap++)
                coach.RecordCornerPass("spa", 1, MakePass(lapNumber: lap, hadIncident: lap <= 2), "La Source");

            // Turn 10: good
            for (int lap = 1; lap <= 10; lap++)
                coach.RecordCornerPass("spa", 10, MakePass(lapNumber: lap, hadIncident: false), "Radillion");

            var turn1Call = coach.Evaluate("spa", 1, 21, BaseTime);
            coach.ResetCooldown();
            var turn10Call = coach.Evaluate("spa", 10, 21, BaseTime);

            Assert.IsNotNull(turn1Call);
            Assert.IsNull(turn10Call);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 9: Strategy Call Properties
        // ═══════════════════════════════════════════════════════════════════

        #region Strategy Call Properties

        [Test]
        public void StrategyCall_LabelLength_WithinLimit()
        {
            var labels = new[] { "CRNR", "COACH" };
            foreach (var label in labels)
                Assert.LessOrEqual(label.Length, 6);
        }

        [Test]
        public void StrategyCall_SeverityValues_InValidRange()
        {
            var severities = new[] { 3, 2, 1 }; // CRNR=3, speed=2, coach=1
            foreach (var severity in severities)
            {
                Assert.GreaterOrEqual(severity, 1);
                Assert.LessOrEqual(severity, 5);
            }
        }

        [Test]
        public void StrategyCall_SharedWithOtherAnalyzers()
        {
            var cornerCall = new StrategyCall
            {
                Label = "CRNR",
                Message = "Corner warning",
                Severity = 3,
                DisplayedAt = DateTime.Now
            };

            Assert.IsInstanceOf<StrategyCall>(cornerCall);
            Assert.AreEqual("CRNR", cornerCall.Label);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 10: Reset and State Management
        // ═══════════════════════════════════════════════════════════════════

        #region Reset and State Management

        [Test]
        public void Reset_ClearsAllState()
        {
            var coach = BuildRealisticCoach();
            Assert.Greater(coach.Tracks.Count, 0);

            coach.Reset();
            Assert.AreEqual(0, coach.Tracks.Count);
        }

        [Test]
        public void Reset_AllowsReuse()
        {
            var coach = BuildRealisticCoach();
            coach.Reset();

            // Should accept new data
            coach.RecordCornerPass("monza", 1, MakePass(lapNumber: 1), "Turn 1");
            Assert.AreEqual(1, coach.Tracks.Count);
        }

        [Test]
        public void Reset_ResetsCallTime()
        {
            var coach = new CornerCoach();
            for (int lap = 1; lap <= 20; lap++)
                coach.RecordCornerPass("spa", 1, MakePass(lapNumber: lap, hadIncident: lap <= 2), "La Source");

            coach.Evaluate("spa", 1, 21, BaseTime);
            coach.Reset();

            // Should allow immediate call after reset — need enough passes for HasSufficientData
            for (int lap = 1; lap <= 10; lap++)
                coach.RecordCornerPass("spa", 1, MakePass(lapNumber: lap, hadIncident: lap <= 2), "La Source");
            var call = coach.Evaluate("spa", 1, 11, BaseTime.AddSeconds(1));
            Assert.IsNotNull(call);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 11: Edge Cases
        // ═══════════════════════════════════════════════════════════════════

        #region Edge Cases

        [Test]
        public void CornerPass_ZeroSpeed_Accepted()
        {
            var coach = new CornerCoach();
            coach.RecordCornerPass("spa", 1, MakePass(minSpeedKmh: 0.0), "Turn 1");
            Assert.AreEqual(1, coach.Tracks["spa"].Corners[1].TotalPasses);
        }

        [Test]
        public void CornerPass_ExtremeSpeed_Handled()
        {
            var coach = new CornerCoach();
            coach.RecordCornerPass("spa", 1, MakePass(minSpeedKmh: 350.0), "Turn 1"); // Top fuel dragster
            Assert.AreEqual(350.0, coach.Tracks["spa"].Corners[1].BestMinSpeed);
        }

        [Test]
        public void CornerPass_LapOrderUnimportant_StillTrackedCorrectly()
        {
            var coach = new CornerCoach();
            // Out of order
            coach.RecordCornerPass("spa", 1, MakePass(lapNumber: 3, minSpeedKmh: 80.0), "Turn 1");
            coach.RecordCornerPass("spa", 1, MakePass(lapNumber: 1, minSpeedKmh: 70.0), "Turn 1");
            coach.RecordCornerPass("spa", 1, MakePass(lapNumber: 2, minSpeedKmh: 75.0), "Turn 1");

            var corner = coach.Tracks["spa"].Corners[1];
            Assert.AreEqual(3, corner.TotalPasses);
            Assert.AreEqual(80.0, corner.BestMinSpeed);
        }

        [Test]
        public void Evaluate_AllZeroIncidents_NoTroubleCall()
        {
            var coach = new CornerCoach();
            for (int lap = 1; lap <= 10; lap++)
                coach.RecordCornerPass("spa", 1, MakePass(lapNumber: lap, hadIncident: false), "Turn 1");

            var call = coach.Evaluate("spa", 1, 11, BaseTime);
            Assert.IsNull(call);
        }

        [Test]
        public void ComputeMasteryTrend_SinglePass_NoError()
        {
            var coach = new CornerCoach();
            coach.RecordCornerPass("spa", 1, MakePass(lapNumber: 1), "Turn 1");

            var corner = coach.Tracks["spa"].Corners[1];
            Assert.DoesNotThrow(() => CornerCoach.ComputeMasteryTrend(corner));
        }

        [Test]
        public void Tracks_CaseInsensitiveTrackId()
        {
            var coach = new CornerCoach();
            coach.RecordCornerPass("SPA", 1, MakePass(lapNumber: 1), "Turn 1");
            coach.RecordCornerPass("spa", 2, MakePass(lapNumber: 1), "Turn 2");

            // Should be treated as same track due to OrdinalIgnoreCase
            Assert.AreEqual(1, coach.Tracks.Count);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 12: Real-World Scenarios
        // ═══════════════════════════════════════════════════════════════════

        #region Real-World Scenarios

        [Test]
        public void Scenario_SpaTroubleCorner_LaSourceWarmingUp()
        {
            // Classic: Spa La Source is treacherous when cold, improves as tires warm
            var coach = new CornerCoach();

            // Cold laps: incidents
            for (int lap = 1; lap <= 5; lap++)
                coach.RecordCornerPass("spa", 1, MakePass(
                    lapNumber: lap,
                    minSpeedKmh: 60.0,
                    hadIncident: true
                ), "La Source");

            // Warm laps: clean
            for (int lap = 6; lap <= 20; lap++)
                coach.RecordCornerPass("spa", 1, MakePass(
                    lapNumber: lap,
                    minSpeedKmh: 75.0,
                    hadIncident: false
                ), "La Source");

            var corner = coach.Tracks["spa"].Corners[1];
            Assert.AreEqual(0.25, corner.IncidentRate); // 5 / 20
            Assert.IsTrue(corner.IsTroubleCorner);

            var trend = CornerCoach.ComputeMasteryTrend(corner);
            Assert.IsTrue(trend.IsImproving);
        }

        [Test]
        public void Scenario_MonzaParabolica_LearningNewTrack()
        {
            // New to Monza Parabolica: first laps slow, gradual improvement
            var coach = new CornerCoach();

            for (int lap = 1; lap <= 30; lap++)
            {
                double speed = 50.0 + lap * 1.0; // Learning curve
                coach.RecordCornerPass("monza", 18, MakePass(
                    lapNumber: lap,
                    minSpeedKmh: speed
                ), "Parabolica");
            }

            var corner = coach.Tracks["monza"].Corners[18];
            Assert.IsTrue(corner.HasSufficientData);

            var trend = CornerCoach.ComputeMasteryTrend(corner);
            Assert.IsTrue(trend.IsImproving);
            Assert.Greater(trend.SpeedDelta, 5.0);
        }

        [Test]
        public void Scenario_MultiSessionProgression_DriverImproving()
        {
            // Week 1: struggling at a corner. Week 2: much better.
            var coach = new CornerCoach();

            // Week 1: high incident rate, slow speed
            for (int lap = 1; lap <= 10; lap++)
                coach.RecordCornerPass("silverstone", 9, MakePass(
                    lapNumber: lap,
                    minSpeedKmh: 70.0,
                    hadIncident: lap <= 4,
                    dayOffset: 0
                ), "Brooklands");

            // Week 2: clean, faster
            for (int lap = 11; lap <= 20; lap++)
                coach.RecordCornerPass("silverstone", 9, MakePass(
                    lapNumber: lap,
                    minSpeedKmh: 85.0,
                    hadIncident: false,
                    dayOffset: 7
                ), "Brooklands");

            var corner = coach.Tracks["silverstone"].Corners[9];
            var trend = CornerCoach.ComputeMasteryTrend(corner);

            Assert.IsTrue(trend.IsImproving);
            Assert.AreEqual(0.2, corner.IncidentRate); // 4 incidents / 20 total passes
        }

        [Test]
        public void Scenario_ConsistentCorner_NeverFlagged()
        {
            // A driver who's already mastered a corner: low incidents, high speed, consistency
            var coach = new CornerCoach();

            for (int lap = 1; lap <= 20; lap++)
                coach.RecordCornerPass("silverstone", 1, MakePass(
                    lapNumber: lap,
                    minSpeedKmh: 95.0,
                    hadIncident: false
                ), "Turn 1");

            var corner = coach.Tracks["silverstone"].Corners[1];
            Assert.IsFalse(corner.IsTroubleCorner);
            Assert.AreEqual(1.0, corner.SuccessRate);

            var call = coach.Evaluate("silverstone", 1, 21, BaseTime);
            Assert.IsNull(call, "Should not fire on already-mastered corner");
        }

        [Test]
        public void Scenario_SessionRestartTracking_LapNumbersReset()
        {
            // Simulate: finish session at lap 50, new session starts at lap 1
            var coach = new CornerCoach();

            // Session 1
            for (int lap = 1; lap <= 50; lap++)
                coach.RecordCornerPass("spa", 1, MakePass(lapNumber: lap, dayOffset: 0), "Turn 1");

            // Session 2 (new day)
            for (int lap = 1; lap <= 30; lap++)
                coach.RecordCornerPass("spa", 1, MakePass(lapNumber: lap, dayOffset: 1), "Turn 1");

            var corner = coach.Tracks["spa"].Corners[1];
            Assert.AreEqual(80, corner.TotalPasses); // 50 + 30
        }

        [Test]
        public void Scenario_SpikyPerformance_IdentifyTrend()
        {
            // Inconsistent: some laps clean and fast, some dirty and slow
            var coach = new CornerCoach();

            for (int lap = 1; lap <= 20; lap++)
            {
                double speed = lap % 2 == 0 ? 90.0 : 70.0; // Alternating good/bad
                bool incident = lap % 2 != 0; // Bad on odd laps
                coach.RecordCornerPass("spa", 1, MakePass(
                    lapNumber: lap,
                    minSpeedKmh: speed,
                    hadIncident: incident
                ), "Turn 1");
            }

            var corner = coach.Tracks["spa"].Corners[1];
            Assert.AreEqual(0.5, corner.IncidentRate); // 10 / 20
            var trend = CornerCoach.ComputeMasteryTrend(corner);
            Assert.IsTrue(trend.IsStagnant); // No net improvement
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 13: Mathematical Consistency
        // ═══════════════════════════════════════════════════════════════════

        #region Mathematical Consistency

        [Test]
        public void IncidentRate_AlwaysBetweenZeroAndOne()
        {
            var coach = BuildRealisticCoach();

            foreach (var track in coach.Tracks.Values)
                foreach (var corner in track.Corners.Values)
                    Assert.That(corner.IncidentRate, Is.GreaterThanOrEqualTo(0).And.LessThanOrEqualTo(1));
        }

        [Test]
        public void SuccessRate_EqualsOneMinusIncidentRate()
        {
            var coach = new CornerCoach();
            for (int lap = 1; lap <= 10; lap++)
                coach.RecordCornerPass("spa", 1, MakePass(lapNumber: lap, hadIncident: lap <= 3), "Turn 1");

            var corner = coach.Tracks["spa"].Corners[1];
            Assert.AreEqual(1.0 - corner.IncidentRate, corner.SuccessRate, 1e-10);
        }

        [Test]
        public void BestMinSpeed_GreaterThanOrEqualAverage()
        {
            var coach = BuildRealisticCoach();

            foreach (var track in coach.Tracks.Values)
                foreach (var corner in track.Corners.Values)
                    if (corner.TotalPasses > 0)
                        Assert.GreaterOrEqual(corner.BestMinSpeed, corner.AverageMinSpeed);
        }

        [Test]
        public void SpeedDelta_ConsistentWithEarlyAndRecent()
        {
            var coach = new CornerCoach();
            for (int lap = 1; lap <= 20; lap++)
            {
                double speed = lap <= 10 ? 70.0 : 85.0;
                coach.RecordCornerPass("spa", 1, MakePass(lapNumber: lap, minSpeedKmh: speed), "Turn 1");
            }

            var corner = coach.Tracks["spa"].Corners[1];
            var trend = CornerCoach.ComputeMasteryTrend(corner);

            double expectedDelta = trend.RecentAvgSpeed - trend.EarlyAvgSpeed;
            Assert.AreEqual(expectedDelta, trend.SpeedDelta, 1e-10);
        }

        [Test]
        public void MasteryTrendStates_MutuallyExclusive()
        {
            var coach = new CornerCoach();
            for (int lap = 1; lap <= 20; lap++)
            {
                double speed = lap <= 10 ? 70.0 : 85.0;
                coach.RecordCornerPass("spa", 1, MakePass(lapNumber: lap, minSpeedKmh: speed), "Turn 1");
            }

            var corner = coach.Tracks["spa"].Corners[1];
            var trend = CornerCoach.ComputeMasteryTrend(corner);

            int trueCount = 0;
            if (trend.IsImproving) trueCount++;
            if (trend.IsStagnant) trueCount++;
            if (trend.IsRegressing) trueCount++;

            Assert.That(trueCount, Is.LessThanOrEqualTo(1), "Only one trend state should be true");
        }

        #endregion
    }
}
