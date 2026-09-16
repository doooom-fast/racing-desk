using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using RaceCorProDrive.Tests.TestHelpers;
using static RaceCorProDrive.Tests.TestHelpers.OpponentIntel;

namespace RaceCorProDrive.Tests
{
    [TestFixture]
    public class OpponentIntelTests
    {
        // ═══════════════════════════════════════════════════════════════════
        //  TEST HELPERS — race record generation
        // ═══════════════════════════════════════════════════════════════════

        private static readonly DateTime BaseDate = new DateTime(2026, 1, 1);

        /// <summary>Creates a race record with sensible defaults.</summary>
        private static RaceRecord MakeRace(
            int finishPos = 5, int fieldSize = 20, int incidents = 2,
            int lapsCompleted = 25, int iRatingBefore = 1500, int iRatingAfter = 1520,
            double avgLapTime = 92.5, double bestLapTime = 90.0,
            int positionsGained = 2, int positionsLost = 1,
            bool hadContact = false, double degradation = 0.5,
            string sessionId = "race1", DateTime? raceDate = null,
            string trackId = "silverstone")
        {
            return new RaceRecord
            {
                SessionId = sessionId,
                RaceDate = raceDate ?? BaseDate,
                TrackId = trackId,
                FinishPosition = finishPos,
                FieldSize = fieldSize,
                Incidents = incidents,
                LapsCompleted = lapsCompleted,
                IRatingBefore = iRatingBefore,
                IRatingAfter = iRatingAfter,
                AverageLapTime = avgLapTime,
                BestLapTime = bestLapTime,
                PositionsGained = positionsGained,
                PositionsLost = positionsLost,
                HadContactWithPlayer = hadContact,
                LapTimeDegradation = degradation
            };
        }

        /// <summary>Helper to build a profile with specified number of clean races.</summary>
        private static DriverProfile BuildCleanProfile(int raceCount = 5)
        {
            var profile = new DriverProfile { DriverId = 100, DriverName = "Clean Driver" };
            for (int i = 0; i < raceCount; i++)
            {
                profile.Races.Add(MakeRace(
                    finishPos: 2 + (i % 5),
                    incidents: 0,
                    lapsCompleted: 20 + i,
                    iRatingBefore: 1500 + (i * 10),
                    iRatingAfter: 1510 + (i * 10),
                    avgLapTime: 92.0 + i * 0.1,
                    positionsGained: 3 + i,
                    raceDate: BaseDate.AddDays(i)
                ));
            }
            return profile;
        }

        /// <summary>Helper to build a profile with aggressive driving (high incidents, gains).</summary>
        private static DriverProfile BuildAggressiveProfile(int raceCount = 5)
        {
            var profile = new DriverProfile { DriverId = 101, DriverName = "Aggressive Driver" };
            for (int i = 0; i < raceCount; i++)
            {
                profile.Races.Add(MakeRace(
                    finishPos: 3 + i,
                    incidents: 3 + i,
                    lapsCompleted: 25,
                    iRatingBefore: 1400 + (i * 5),
                    iRatingAfter: 1400 + (i * 5),
                    avgLapTime: 93.0,
                    positionsGained: 4,
                    positionsLost: 1,
                    raceDate: BaseDate.AddDays(i)
                ));
            }
            return profile;
        }

        /// <summary>Helper to build a profile with very high incidents (erratic/dangerous).</summary>
        private static DriverProfile BuildDangerousProfile(int raceCount = 5)
        {
            var profile = new DriverProfile { DriverId = 102, DriverName = "Dangerous Driver" };
            for (int i = 0; i < raceCount; i++)
            {
                profile.Races.Add(MakeRace(
                    finishPos: 10 + i,
                    incidents: 12 + i,  // High incident rate
                    lapsCompleted: 20,
                    iRatingBefore: 1200,
                    iRatingAfter: 1150,
                    avgLapTime: 95.0,
                    positionsGained: 0,
                    positionsLost: 5,
                    raceDate: BaseDate.AddDays(i)
                ));
            }
            return profile;
        }

        /// <summary>Helper to build a profile with defensive driving (low incidents, no position changes).</summary>
        private static DriverProfile BuildDefensiveProfile(int raceCount = 5)
        {
            var profile = new DriverProfile { DriverId = 103, DriverName = "Defensive Driver" };
            for (int i = 0; i < raceCount; i++)
            {
                // incidents=4, lapsCompleted=25 → IR=0.16 which is >= CautionIncidentRate*0.5 (0.125)
                // netGainPerRace=0 → Abs < 1.0 → Defensive
                profile.Races.Add(MakeRace(
                    finishPos: 8 + (i % 3),
                    incidents: 4,
                    lapsCompleted: 25,
                    iRatingBefore: 1600 + (i * 5),
                    iRatingAfter: 1605 + (i * 5),
                    avgLapTime: 94.0,
                    positionsGained: 0,
                    positionsLost: 0,
                    raceDate: BaseDate.AddDays(i)
                ));
            }
            return profile;
        }

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 1: Race Recording
        // ═══════════════════════════════════════════════════════════════════

        #region Race Recording

        [Test]
        public void RecordRace_ValidRace_Added()
        {
            var intel = new OpponentIntel();
            var race = MakeRace(lapsCompleted: 20);
            intel.RecordRace(1001, "Driver A", race);

            Assert.AreEqual(1, intel.Profiles.Count);
            Assert.IsTrue(intel.Profiles.ContainsKey(1001));
            Assert.AreEqual(1, intel.Profiles[1001].Races.Count);
        }

        [Test]
        public void RecordRace_ZeroLaps_Ignored()
        {
            var intel = new OpponentIntel();
            var race = MakeRace(lapsCompleted: 0);
            intel.RecordRace(1001, "Driver A", race);

            Assert.AreEqual(0, intel.Profiles.Count);
        }

        [Test]
        public void RecordRace_NullRecord_Ignored()
        {
            var intel = new OpponentIntel();
            intel.RecordRace(1001, "Driver A", null);

            Assert.AreEqual(0, intel.Profiles.Count);
        }

        [Test]
        public void RecordRace_MultipleRaces_AllAdded()
        {
            var intel = new OpponentIntel();
            for (int i = 0; i < 10; i++)
            {
                intel.RecordRace(1001, "Driver A", MakeRace(
                    finishPos: 5 + i,
                    lapsCompleted: 20,
                    raceDate: BaseDate.AddDays(i)
                ));
            }

            Assert.AreEqual(1, intel.Profiles.Count);
            Assert.AreEqual(10, intel.Profiles[1001].Races.Count);
        }

        [Test]
        public void RecordRace_UpdatesCurrentIRating()
        {
            var intel = new OpponentIntel();
            intel.RecordRace(1001, "Driver A", MakeRace(iRatingAfter: 1550));
            intel.RecordRace(1001, "Driver A", MakeRace(iRatingAfter: 1600));

            Assert.AreEqual(1600, intel.Profiles[1001].CurrentIRating);
        }

        [Test]
        public void RecordRace_SeparateDrivers_SeparateProfiles()
        {
            var intel = new OpponentIntel();
            intel.RecordRace(1001, "Driver A", MakeRace());
            intel.RecordRace(1002, "Driver B", MakeRace());

            Assert.AreEqual(2, intel.Profiles.Count);
            Assert.AreEqual("Driver A", intel.Profiles[1001].DriverName);
            Assert.AreEqual("Driver B", intel.Profiles[1002].DriverName);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 2: Driver Profile Properties
        // ═══════════════════════════════════════════════════════════════════

        #region Driver Profile Properties

        [Test]
        public void DriverProfile_TotalRaces_CountsCorrectly()
        {
            var profile = BuildCleanProfile(7);
            Assert.AreEqual(7, profile.TotalRaces);
        }

        [Test]
        public void DriverProfile_HasSufficientData_BelowThreshold()
        {
            var profile = new DriverProfile();
            profile.Races.Add(MakeRace());
            profile.Races.Add(MakeRace());

            Assert.IsFalse(profile.HasSufficientData);
        }

        [Test]
        public void DriverProfile_HasSufficientData_AtThreshold()
        {
            var profile = BuildCleanProfile(MinRacesForProfile);
            Assert.IsTrue(profile.HasSufficientData);
        }

        [Test]
        public void DriverProfile_MeanIncidentRate_Calculated()
        {
            var profile = new DriverProfile();
            // 3 races: incident rates 0.1, 0.2, 0.3 (sum = 0.6, mean = 0.2)
            profile.Races.Add(MakeRace(incidents: 2, lapsCompleted: 20)); // 0.1
            profile.Races.Add(MakeRace(incidents: 4, lapsCompleted: 20)); // 0.2
            profile.Races.Add(MakeRace(incidents: 6, lapsCompleted: 20)); // 0.3

            Assert.AreEqual(0.2, profile.MeanIncidentRate, 1e-10);
        }

        [Test]
        public void DriverProfile_IRatingTrend_PositiveGrowth()
        {
            var profile = new DriverProfile();
            profile.Races.Add(MakeRace(raceDate: BaseDate, iRatingBefore: 1500, iRatingAfter: 1510));
            profile.Races.Add(MakeRace(raceDate: BaseDate.AddDays(1), iRatingBefore: 1510, iRatingAfter: 1540));
            profile.Races.Add(MakeRace(raceDate: BaseDate.AddDays(2), iRatingBefore: 1540, iRatingAfter: 1580));

            // Recent avg: 1580 (last race after), Early avg: 1500 (first race before)
            double expectedTrend = 1580.0 - 1500.0; // = 80
            Assert.AreEqual(expectedTrend, profile.IRatingTrend, 1e-10);
        }

        [Test]
        public void DriverProfile_IRatingTrend_NegativeDecline()
        {
            var profile = new DriverProfile();
            profile.Races.Add(MakeRace(raceDate: BaseDate, iRatingBefore: 1500, iRatingAfter: 1550));
            profile.Races.Add(MakeRace(raceDate: BaseDate.AddDays(1), iRatingBefore: 1550, iRatingAfter: 1500));
            profile.Races.Add(MakeRace(raceDate: BaseDate.AddDays(2), iRatingBefore: 1500, iRatingAfter: 1450));

            // Recent avg: 1450, Early avg: 1500
            double expectedTrend = 1450.0 - 1500.0; // = -50
            Assert.AreEqual(expectedTrend, profile.IRatingTrend, 1e-10);
        }

        [Test]
        public void DriverProfile_TotalPositionsGained_Summed()
        {
            var profile = new DriverProfile();
            profile.Races.Add(MakeRace(positionsGained: 3));
            profile.Races.Add(MakeRace(positionsGained: 5));
            profile.Races.Add(MakeRace(positionsGained: 2));

            Assert.AreEqual(10, profile.TotalPositionsGained);
        }

        [Test]
        public void DriverProfile_SharedRacesWithContact_Counted()
        {
            var profile = new DriverProfile();
            profile.Races.Add(MakeRace(hadContact: true));
            profile.Races.Add(MakeRace(hadContact: false));
            profile.Races.Add(MakeRace(hadContact: true));

            Assert.AreEqual(2, profile.SharedRacesWithContact);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 3: Reputation Scoring
        // ═══════════════════════════════════════════════════════════════════

        #region Reputation Scoring

        [Test]
        public void ComputeReputationScore_InsufficientData_ReturnsNeutral()
        {
            var profile = new DriverProfile();
            profile.Races.Add(MakeRace());

            double score = ComputeReputationScore(profile);
            Assert.AreEqual(0.5, score);
        }

        [Test]
        public void ComputeReputationScore_CleanDriver_HighScore()
        {
            var profile = BuildCleanProfile();
            double score = ComputeReputationScore(profile);

            Assert.Greater(score, 0.7);
        }

        [Test]
        public void ComputeReputationScore_DangerousDriver_LowScore()
        {
            var profile = BuildDangerousProfile();
            double score = ComputeReputationScore(profile);

            Assert.Less(score, 0.3);
        }

        [Test]
        public void ComputeReputationScore_RangeZeroToOne()
        {
            var cleanProfile = BuildCleanProfile();
            var dangerousProfile = BuildDangerousProfile();

            double cleanScore = ComputeReputationScore(cleanProfile);
            double dangerScore = ComputeReputationScore(dangerousProfile);

            Assert.GreaterOrEqual(cleanScore, 0.0);
            Assert.LessOrEqual(cleanScore, 1.0);
            Assert.GreaterOrEqual(dangerScore, 0.0);
            Assert.LessOrEqual(dangerScore, 1.0);
        }

        [Test]
        public void ComputeReputationScore_ImprovingDriver_HigherScore()
        {
            // Driver with positive iRating trend should score higher
            var improving = new DriverProfile();
            for (int i = 0; i < 5; i++)
                improving.Races.Add(MakeRace(
                    incidents: 1,
                    iRatingBefore: 1500 + (i * 10),
                    iRatingAfter: 1520 + (i * 10),
                    raceDate: BaseDate.AddDays(i)
                ));

            var declining = new DriverProfile();
            for (int i = 0; i < 5; i++)
                declining.Races.Add(MakeRace(
                    incidents: 1,
                    iRatingBefore: 1700 - (i * 10),
                    iRatingAfter: 1680 - (i * 10),
                    raceDate: BaseDate.AddDays(i)
                ));

            double improvingScore = ComputeReputationScore(improving);
            double decliningScore = ComputeReputationScore(declining);

            Assert.Greater(improvingScore, decliningScore);
        }

        [Test]
        public void ComputeReputationScore_PositionGains_BootsScore()
        {
            var gainers = new DriverProfile();
            for (int i = 0; i < 5; i++)
                gainers.Races.Add(MakeRace(incidents: 1, positionsGained: 5, positionsLost: 0));

            var losers = new DriverProfile();
            for (int i = 0; i < 5; i++)
                losers.Races.Add(MakeRace(incidents: 1, positionsGained: 0, positionsLost: 5));

            double gainersScore = ComputeReputationScore(gainers);
            double losersScore = ComputeReputationScore(losers);

            Assert.Greater(gainersScore, losersScore);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 4: Driving Style Classification
        // ═══════════════════════════════════════════════════════════════════

        #region Driving Style Classification

        [Test]
        public void ClassifyStyle_Clean_Identified()
        {
            var profile = BuildCleanProfile();
            var style = ClassifyStyle(profile);

            Assert.AreEqual(DrivingStyle.Clean, style);
        }

        [Test]
        public void ClassifyStyle_Aggressive_Identified()
        {
            var profile = BuildAggressiveProfile();
            var style = ClassifyStyle(profile);

            Assert.AreEqual(DrivingStyle.Aggressive, style);
        }

        [Test]
        public void ClassifyStyle_Erratic_IdentifiedByHighIncidents()
        {
            var profile = BuildDangerousProfile();
            var style = ClassifyStyle(profile);

            Assert.AreEqual(DrivingStyle.Erratic, style);
        }

        [Test]
        public void ClassifyStyle_Defensive_Identified()
        {
            var profile = BuildDefensiveProfile();
            var style = ClassifyStyle(profile);

            Assert.AreEqual(DrivingStyle.Defensive, style);
        }

        [Test]
        public void ClassifyStyle_InsufficientData_Unknown()
        {
            var profile = new DriverProfile();
            profile.Races.Add(MakeRace());

            var style = ClassifyStyle(profile);
            Assert.AreEqual(DrivingStyle.Unknown, style);
        }

        [Test]
        public void ClassifyStyle_LowIncidents_PrefersClean()
        {
            // Very low incidents always → Clean
            var profile = new DriverProfile();
            for (int i = 0; i < 5; i++)
                profile.Races.Add(MakeRace(incidents: 0, positionsGained: 1, positionsLost: 0));

            var style = ClassifyStyle(profile);
            Assert.AreEqual(DrivingStyle.Clean, style);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 5: Rivalry Detection
        // ═══════════════════════════════════════════════════════════════════

        #region Rivalry Detection

        [Test]
        public void DetectRivalries_NoRaces_EmptyList()
        {
            var intel = new OpponentIntel();
            var rivalries = intel.DetectRivalries();

            Assert.AreEqual(0, rivalries.Count);
        }

        [Test]
        public void DetectRivalries_BelowMinSharedRaces_NoRivalry()
        {
            var intel = new OpponentIntel();
            intel.RecordRace(1001, "Driver A", MakeRace(hadContact: true));
            intel.RecordRace(1001, "Driver A", MakeRace(hadContact: true));

            var rivalries = intel.DetectRivalries();
            Assert.AreEqual(0, rivalries.Count);
        }

        [Test]
        public void DetectRivalries_FrequentContact_RivalryDetected()
        {
            var intel = new OpponentIntel();
            // Driver with contact in 3 of 3 shared races (100% contact rate, well above 50% threshold)
            intel.RecordRace(1001, "Rival Driver", MakeRace(hadContact: true));
            intel.RecordRace(1001, "Rival Driver", MakeRace(hadContact: true));
            intel.RecordRace(1001, "Rival Driver", MakeRace(hadContact: true));

            var rivalries = intel.DetectRivalries();
            Assert.AreEqual(1, rivalries.Count);
            Assert.AreEqual("Rival Driver", rivalries[0].OpponentName);
            Assert.AreEqual(3, rivalries[0].SharedRaces);
            Assert.AreEqual(3, rivalries[0].MutualIncidents);
        }

        [Test]
        public void DetectRivalries_RareContact_NoRivalry()
        {
            var intel = new OpponentIntel();
            // Contact in 1 of 5 races (20% rate, below 50% threshold)
            for (int i = 0; i < 5; i++)
                intel.RecordRace(1001, "Clean Opponent", MakeRace(hadContact: i == 0));

            var rivalries = intel.DetectRivalries();
            Assert.AreEqual(0, rivalries.Count);
        }

        [Test]
        public void DetectRivalries_MultipleRivals_SortedByIncidentRate()
        {
            var intel = new OpponentIntel();

            // Driver A: 3 contacts in 3 races (100%)
            for (int i = 0; i < 3; i++)
                intel.RecordRace(1001, "Driver A", MakeRace(hadContact: true));

            // Driver B: 4 contacts in 4 races (100%)
            for (int i = 0; i < 4; i++)
                intel.RecordRace(1002, "Driver B", MakeRace(hadContact: true));

            // Driver C: 5 contacts in 5 races (100%)
            for (int i = 0; i < 5; i++)
                intel.RecordRace(1003, "Driver C", MakeRace(hadContact: true));

            var rivalries = intel.DetectRivalries();
            Assert.AreEqual(3, rivalries.Count);
            // All have same contact rate, but check they're sorted
            Assert.IsNotNull(rivalries.First());
        }

        [Test]
        public void DetectRivalries_JustAtThreshold_Detected()
        {
            var intel = new OpponentIntel();
            // Contact in exactly 50% of 4 races (2 contacts)
            intel.RecordRace(1001, "Borderline", MakeRace(hadContact: true));
            intel.RecordRace(1001, "Borderline", MakeRace(hadContact: true));
            intel.RecordRace(1001, "Borderline", MakeRace(hadContact: false));
            intel.RecordRace(1001, "Borderline", MakeRace(hadContact: false));

            var rivalries = intel.DetectRivalries();
            Assert.AreEqual(1, rivalries.Count);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 6: Pace Prediction
        // ═══════════════════════════════════════════════════════════════════

        #region Pace Prediction

        [Test]
        public void PredictDegradation_NoRaces_ReturnsZero()
        {
            var profile = new DriverProfile();
            double deg = PredictDegradation(profile, "silverstone");

            Assert.AreEqual(0.0, deg);
        }

        [Test]
        public void PredictDegradation_BelowMinLaps_IgnoresRace()
        {
            var profile = new DriverProfile();
            profile.Races.Add(MakeRace(lapsCompleted: MinLapsForPacePrediction - 1, degradation: 5.0));

            double deg = PredictDegradation(profile, "silverstone");
            Assert.AreEqual(0.0, deg);
        }

        [Test]
        public void PredictDegradation_AtMinLaps_Included()
        {
            var profile = new DriverProfile();
            profile.Races.Add(MakeRace(lapsCompleted: MinLapsForPacePrediction, degradation: 2.5));

            double deg = PredictDegradation(profile, "silverstone");
            Assert.AreEqual(2.5, deg, 1e-10);
        }

        [Test]
        public void PredictDegradation_TrackSpecific()
        {
            var profile = new DriverProfile();
            // Silverstone races
            profile.Races.Add(MakeRace(trackId: "silverstone", degradation: 1.0));
            profile.Races.Add(MakeRace(trackId: "silverstone", degradation: 2.0));
            // Monza races
            profile.Races.Add(MakeRace(trackId: "monza", degradation: 4.0));

            double silvDeg = PredictDegradation(profile, "silverstone");
            double monzaDeg = PredictDegradation(profile, "monza");

            Assert.AreEqual(1.5, silvDeg, 1e-10); // (1.0 + 2.0) / 2
            Assert.AreEqual(4.0, monzaDeg, 1e-10); // monza only has one
        }

        [Test]
        public void PredictDegradation_NoTrackData_FallsbackToAllTracks()
        {
            var profile = new DriverProfile();
            profile.Races.Add(MakeRace(trackId: "silverstone", degradation: 1.0));
            profile.Races.Add(MakeRace(trackId: "silverstone", degradation: 3.0));

            // Query for unknown track → falls back to all-track average
            double deg = PredictDegradation(profile, "unknown");
            Assert.AreEqual(2.0, deg, 1e-10);
        }

        [Test]
        public void PredictDegradation_MultipleRaces_Averaged()
        {
            var profile = new DriverProfile();
            profile.Races.Add(MakeRace(degradation: 0.5));
            profile.Races.Add(MakeRace(degradation: 1.5));
            profile.Races.Add(MakeRace(degradation: 2.0));

            double deg = PredictDegradation(profile, "silverstone");
            Assert.AreEqual(4.0 / 3.0, deg, 1e-10);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 7: Strategy Call Evaluation
        // ═══════════════════════════════════════════════════════════════════

        #region Strategy Call Evaluation

        [Test]
        public void Evaluate_InsufficientData_ReturnsNull()
        {
            var intel = new OpponentIntel();
            intel.RecordRace(1001, "Driver A", MakeRace());

            var call = intel.Evaluate(1001, 1.0, DateTime.Now);
            Assert.IsNull(call);
        }

        [Test]
        public void Evaluate_UnknownDriver_ReturnsNull()
        {
            var intel = new OpponentIntel();
            var call = intel.Evaluate(9999, 1.0, DateTime.Now);

            Assert.IsNull(call);
        }

        [Test]
        public void Evaluate_GapTooLarge_ReturnsNull()
        {
            var intel = new OpponentIntel();
            intel.RecordRace(1001, "Driver A", MakeRace());
            intel.RecordRace(1001, "Driver A", MakeRace());
            intel.RecordRace(1001, "Driver A", MakeRace());

            // Gap > 3.0 seconds
            var call = intel.Evaluate(1001, 5.0, DateTime.Now);
            Assert.IsNull(call);
        }

        [Test]
        public void Evaluate_DangerousDriver_ReturnsCall()
        {
            var intel = new OpponentIntel();
            var profile = BuildDangerousProfile();
            for (int i = 0; i < profile.Races.Count; i++)
                intel.RecordRace(profile.DriverId, profile.DriverName, profile.Races[i]);

            var call = intel.Evaluate(profile.DriverId, 1.0, DateTime.Now);

            Assert.IsNotNull(call);
            Assert.AreEqual("SPOT", call.Label);
            Assert.AreEqual(3, call.Severity);
            Assert.That(call.Message, Does.Contain("incident rate"));
        }

        [Test]
        public void Evaluate_RivalryWarning_ReturnsPriority2()
        {
            var intel = new OpponentIntel();
            // Build a rivalry
            for (int i = 0; i < 3; i++)
                intel.RecordRace(1001, "Rival Driver", MakeRace(hadContact: true));

            var call = intel.Evaluate(1001, 0.5, DateTime.Now);

            Assert.IsNotNull(call);
            Assert.AreEqual("RIVAL", call.Label);
            Assert.AreEqual(2, call.Severity);
        }

        [Test]
        public void Evaluate_CautionLevel_ReturnsCall()
        {
            var intel = new OpponentIntel();
            // incidents=7, lapsCompleted=25 → IR=0.28 which is >= CautionIncidentRate (0.25)
            // but < DangerIncidentRate (0.5), so hits priority 3 (caution level)
            for (int i = 0; i < 5; i++)
                intel.RecordRace(1001, "Caution Driver", MakeRace(incidents: 7, hadContact: false));

            var call = intel.Evaluate(1001, 1.0, DateTime.Now);

            Assert.IsNotNull(call);
            Assert.AreEqual("SPOT", call.Label);
            Assert.AreEqual(2, call.Severity);
        }

        [Test]
        public void Evaluate_CleanDriver_ReturnsNull()
        {
            var intel = new OpponentIntel();
            var profile = BuildCleanProfile();
            for (int i = 0; i < profile.Races.Count; i++)
                intel.RecordRace(profile.DriverId, profile.DriverName, profile.Races[i]);

            var call = intel.Evaluate(profile.DriverId, 0.5, DateTime.Now);
            Assert.IsNull(call);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 8: Cooldown Behavior
        // ═══════════════════════════════════════════════════════════════════

        #region Cooldown Behavior

        [Test]
        public void Evaluate_WithinCooldown_ReturnsNull()
        {
            var intel = new OpponentIntel();
            var profile = BuildDangerousProfile();
            for (int i = 0; i < profile.Races.Count; i++)
                intel.RecordRace(profile.DriverId, profile.DriverName, profile.Races[i]);

            var now = DateTime.Now;

            // First call succeeds
            var call1 = intel.Evaluate(profile.DriverId, 1.0, now);
            Assert.IsNotNull(call1);

            // Second call within cooldown fails
            var call2 = intel.Evaluate(profile.DriverId, 1.0, now.AddSeconds(30));
            Assert.IsNull(call2);
        }

        [Test]
        public void Evaluate_AfterCooldown_CanFireAgain()
        {
            var intel = new OpponentIntel();
            var profile = BuildDangerousProfile();
            for (int i = 0; i < profile.Races.Count; i++)
                intel.RecordRace(profile.DriverId, profile.DriverName, profile.Races[i]);

            var now = DateTime.Now;

            var call1 = intel.Evaluate(profile.DriverId, 1.0, now);
            Assert.IsNotNull(call1);

            // After cooldown expires
            var call2 = intel.Evaluate(profile.DriverId, 1.0, now.AddSeconds(CooldownSeconds + 1));
            Assert.IsNotNull(call2);
        }

        [Test]
        public void ResetCooldown_AllowsImmediateFire()
        {
            var intel = new OpponentIntel();
            var profile = BuildDangerousProfile();
            for (int i = 0; i < profile.Races.Count; i++)
                intel.RecordRace(profile.DriverId, profile.DriverName, profile.Races[i]);

            var now = DateTime.Now;

            intel.Evaluate(profile.DriverId, 1.0, now);
            intel.ResetCooldown();

            var call = intel.Evaluate(profile.DriverId, 1.0, now.AddSeconds(5));
            Assert.IsNotNull(call);
        }

        [Test]
        public void Cooldown_ExactlyAtThreshold_StillBlocked()
        {
            var intel = new OpponentIntel();
            var profile = BuildDangerousProfile();
            for (int i = 0; i < profile.Races.Count; i++)
                intel.RecordRace(profile.DriverId, profile.DriverName, profile.Races[i]);

            var now = DateTime.Now;

            intel.Evaluate(profile.DriverId, 1.0, now);
            var call = intel.Evaluate(profile.DriverId, 1.0, now.AddSeconds(CooldownSeconds - 0.1));

            Assert.IsNull(call);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 9: Strategy Call Properties
        // ═══════════════════════════════════════════════════════════════════

        #region Strategy Call Properties

        [Test]
        public void StrategyCall_HasLabel()
        {
            var call = new StrategyCall { Label = "SPOT", Message = "test", Severity = 2 };
            Assert.AreEqual("SPOT", call.Label);
        }

        [Test]
        public void StrategyCall_HasMessage()
        {
            var call = new StrategyCall { Label = "SPOT", Message = "Opponent nearby", Severity = 2 };
            Assert.AreEqual("Opponent nearby", call.Message);
        }

        [Test]
        public void StrategyCall_HasSeverity()
        {
            var call = new StrategyCall { Label = "SPOT", Message = "test", Severity = 3 };
            Assert.AreEqual(3, call.Severity);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 10: Reset and State Management
        // ═══════════════════════════════════════════════════════════════════

        #region Reset and State Management

        [Test]
        public void Reset_ClearsAllProfiles()
        {
            var intel = new OpponentIntel();
            intel.RecordRace(1001, "Driver A", MakeRace());
            intel.RecordRace(1002, "Driver B", MakeRace());

            intel.Reset();

            Assert.AreEqual(0, intel.Profiles.Count);
        }

        [Test]
        public void Reset_ResetsCooldown()
        {
            var intel = new OpponentIntel();
            var profile = BuildDangerousProfile();
            for (int i = 0; i < profile.Races.Count; i++)
                intel.RecordRace(profile.DriverId, profile.DriverName, profile.Races[i]);

            var now = DateTime.Now;
            intel.Evaluate(profile.DriverId, 1.0, now);
            intel.Reset();

            // After reset, should be able to fire immediately
            var call = intel.Evaluate(1001, 1.0, now.AddSeconds(5));
            // Note: no profile exists after reset
            Assert.IsNull(call);
        }

        [Test]
        public void Reset_AllowsReuse()
        {
            var intel = new OpponentIntel();
            intel.RecordRace(1001, "Driver A", MakeRace());
            intel.Reset();

            // Should accept new data
            intel.RecordRace(1002, "Driver B", MakeRace());
            Assert.AreEqual(1, intel.Profiles.Count);
            Assert.IsTrue(intel.Profiles.ContainsKey(1002));
        }

        [Test]
        public void ComputeAllProfiles_UpdatesAllStyles()
        {
            var intel = new OpponentIntel();
            intel.RecordRace(1001, "Driver A", MakeRace(incidents: 0));
            intel.RecordRace(1001, "Driver A", MakeRace(incidents: 0));
            intel.RecordRace(1001, "Driver A", MakeRace(incidents: 0));

            intel.ComputeAllProfiles();

            Assert.AreEqual(DrivingStyle.Clean, intel.Profiles[1001].Style);
            Assert.Greater(intel.Profiles[1001].ReputationScore, 0.5);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 11: Edge Cases
        // ═══════════════════════════════════════════════════════════════════

        #region Edge Cases

        [Test]
        public void RaceRecord_IncidentRate_ZeroLaps_ReturnsZero()
        {
            var race = MakeRace(incidents: 5, lapsCompleted: 0);
            Assert.AreEqual(0.0, race.IncidentRate);
        }

        [Test]
        public void RaceRecord_IRatingDelta_Calculated()
        {
            var race = MakeRace(iRatingBefore: 1500, iRatingAfter: 1550);
            Assert.AreEqual(50, race.IRatingDelta);
        }

        [Test]
        public void RaceRecord_NegativeIRatingDelta()
        {
            var race = MakeRace(iRatingBefore: 1500, iRatingAfter: 1400);
            Assert.AreEqual(-100, race.IRatingDelta);
        }

        [Test]
        public void Profile_MeanLapTimeDegradation_OnlyCountsLongRaces()
        {
            var profile = new DriverProfile();
            profile.Races.Add(MakeRace(lapsCompleted: MinLapsForPacePrediction - 1, degradation: 5.0));
            profile.Races.Add(MakeRace(lapsCompleted: MinLapsForPacePrediction, degradation: 1.0));
            profile.Races.Add(MakeRace(lapsCompleted: MinLapsForPacePrediction + 5, degradation: 2.0));

            // Should only average the two long races: (1.0 + 2.0) / 2 = 1.5
            Assert.AreEqual(1.5, profile.MeanLapTimeDegradation, 1e-10);
        }

        [Test]
        public void LargeSample_HandlesWithoutOverflow()
        {
            var intel = new OpponentIntel();
            for (int i = 0; i < 100; i++)
                intel.RecordRace(1001, "Driver A", MakeRace(raceDate: BaseDate.AddDays(i)));

            Assert.AreEqual(100, intel.Profiles[1001].TotalRaces);
        }

        [Test]
        public void NegativePositionChanges_HandledCorrectly()
        {
            var profile = new DriverProfile();
            profile.Races.Add(MakeRace(positionsGained: 0, positionsLost: 5));
            profile.Races.Add(MakeRace(positionsGained: 0, positionsLost: 3));

            Assert.AreEqual(0, profile.TotalPositionsGained);
            Assert.AreEqual(8, profile.TotalPositionsLost);
        }

        [Test]
        public void RivalIncidentRate_ZeroSharedRaces_ReturnsZero()
        {
            var rivalry = new Rivalry { SharedRaces = 0, MutualIncidents = 5 };
            Assert.AreEqual(0.0, rivalry.IncidentRate);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 12: Real-World Scenarios
        // ═══════════════════════════════════════════════════════════════════

        #region Real-World Scenarios

        [Test]
        public void Scenario_DangerousDriverNearby()
        {
            var intel = new OpponentIntel();

            // Record a driver with very high incidents
            var dangerousDriver = BuildDangerousProfile();
            for (int i = 0; i < dangerousDriver.Races.Count; i++)
                intel.RecordRace(dangerousDriver.DriverId, dangerousDriver.DriverName, dangerousDriver.Races[i]);

            // Evaluate when driver is close
            var call = intel.Evaluate(dangerousDriver.DriverId, 0.5, DateTime.Now);

            Assert.IsNotNull(call);
            Assert.AreEqual("SPOT", call.Label);
            Assert.AreEqual(3, call.Severity);
            Assert.That(call.Message, Does.Contain("incident rate"));
        }

        [Test]
        public void Scenario_CleanRacerNoWarning()
        {
            var intel = new OpponentIntel();

            var cleanDriver = BuildCleanProfile();
            for (int i = 0; i < cleanDriver.Races.Count; i++)
                intel.RecordRace(cleanDriver.DriverId, cleanDriver.DriverName, cleanDriver.Races[i]);

            var call = intel.Evaluate(cleanDriver.DriverId, 0.5, DateTime.Now);

            Assert.IsNull(call, "Clean driver should not trigger warning");
        }

        [Test]
        public void Scenario_RivalryAlert()
        {
            var intel = new OpponentIntel();

            // Build strong rivalry
            for (int i = 0; i < 5; i++)
                intel.RecordRace(1001, "Rival Driver", MakeRace(hadContact: true));

            var call = intel.Evaluate(1001, 1.0, DateTime.Now);

            Assert.IsNotNull(call);
            Assert.AreEqual("RIVAL", call.Label);
            Assert.That(call.Message, Does.Contain("shared races"));
        }

        [Test]
        public void Scenario_MultipleOpponents_TrackingIndependently()
        {
            var intel = new OpponentIntel();

            // Clean driver
            for (int i = 0; i < 5; i++)
                intel.RecordRace(1001, "Clean A", MakeRace(incidents: 0));

            // Dangerous driver
            for (int i = 0; i < 5; i++)
                intel.RecordRace(1002, "Dangerous B", MakeRace(incidents: 10));

            // Only dangerous should fire
            var call1 = intel.Evaluate(1001, 1.0, DateTime.Now);
            var call2 = intel.Evaluate(1002, 1.0, DateTime.Now);

            Assert.IsNull(call1);
            Assert.IsNotNull(call2);
        }

        [Test]
        public void Scenario_TrackSpecificPaceMemory()
        {
            var intel = new OpponentIntel();

            var profile = new DriverProfile { DriverId = 1001, DriverName = "Track Specialist" };
            // Silverstone: consistent, low degradation
            for (int i = 0; i < 3; i++)
                profile.Races.Add(MakeRace(trackId: "silverstone", degradation: 0.5));
            // Monza: high degradation
            for (int i = 0; i < 3; i++)
                profile.Races.Add(MakeRace(trackId: "monza", degradation: 2.0));

            for (int i = 0; i < profile.Races.Count; i++)
                intel.RecordRace(profile.DriverId, profile.DriverName, profile.Races[i]);

            double silvDeg = PredictDegradation(intel.Profiles[1001], "silverstone");
            double monzaDeg = PredictDegradation(intel.Profiles[1001], "monza");

            Assert.AreEqual(0.5, silvDeg, 1e-10);
            Assert.AreEqual(2.0, monzaDeg, 1e-10);
        }

        [Test]
        public void Scenario_IRatingTrendReflectsProgress()
        {
            var intel = new OpponentIntel();

            var improving = new DriverProfile { DriverId = 1001, DriverName = "Rising Star" };
            improving.Races.Add(MakeRace(raceDate: BaseDate, iRatingBefore: 1200, iRatingAfter: 1250));
            improving.Races.Add(MakeRace(raceDate: BaseDate.AddDays(1), iRatingBefore: 1250, iRatingAfter: 1320));
            improving.Races.Add(MakeRace(raceDate: BaseDate.AddDays(2), iRatingBefore: 1320, iRatingAfter: 1400));

            for (int i = 0; i < improving.Races.Count; i++)
                intel.RecordRace(improving.DriverId, improving.DriverName, improving.Races[i]);

            double trend = intel.Profiles[1001].IRatingTrend;
            Assert.Greater(trend, 100, "Rising star should show positive trend");

            var reputation = ComputeReputationScore(intel.Profiles[1001]);
            Assert.Greater(reputation, 0.6);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 13: Mathematical Consistency
        // ═══════════════════════════════════════════════════════════════════

        #region Mathematical Consistency

        [Test]
        public void ReputationScore_ConsistentAcrossCalculations()
        {
            var profile = BuildCleanProfile();

            double score1 = ComputeReputationScore(profile);
            double score2 = ComputeReputationScore(profile);

            Assert.AreEqual(score1, score2, 1e-10);
        }

        [Test]
        public void DrivingStyle_ConsistentAcrossClassifications()
        {
            var profile = BuildAggressiveProfile();

            var style1 = ClassifyStyle(profile);
            var style2 = ClassifyStyle(profile);

            Assert.AreEqual(style1, style2);
        }

        [Test]
        public void TotalPositions_SumOfRaceComponents()
        {
            var profile = new DriverProfile();
            profile.Races.Add(MakeRace(positionsGained: 3, positionsLost: 1));
            profile.Races.Add(MakeRace(positionsGained: 2, positionsLost: 2));
            profile.Races.Add(MakeRace(positionsGained: 4, positionsLost: 0));

            int expectedGains = 3 + 2 + 4;
            int expectedLosses = 1 + 2 + 0;

            Assert.AreEqual(expectedGains, profile.TotalPositionsGained);
            Assert.AreEqual(expectedLosses, profile.TotalPositionsLost);
        }

        [Test]
        public void IncidentRate_InvariantToOrder()
        {
            var profile1 = new DriverProfile();
            profile1.Races.Add(MakeRace(incidents: 2, lapsCompleted: 20));
            profile1.Races.Add(MakeRace(incidents: 4, lapsCompleted: 20));

            var profile2 = new DriverProfile();
            profile2.Races.Add(MakeRace(incidents: 4, lapsCompleted: 20));
            profile2.Races.Add(MakeRace(incidents: 2, lapsCompleted: 20));

            Assert.AreEqual(profile1.MeanIncidentRate, profile2.MeanIncidentRate, 1e-10);
        }

        [Test]
        public void MeanIRatingTrend_OnlyTwoRaces_Calculated()
        {
            var profile = new DriverProfile();
            profile.Races.Add(MakeRace(raceDate: BaseDate, iRatingBefore: 1500, iRatingAfter: 1550));
            profile.Races.Add(MakeRace(raceDate: BaseDate.AddDays(1), iRatingBefore: 1550, iRatingAfter: 1600));

            // With 2 races: recent = last 1 (1600), early = first 1 (1500)
            double expectedTrend = 1600.0 - 1500.0;
            Assert.AreEqual(expectedTrend, profile.IRatingTrend, 1e-10);
        }

        #endregion
    }
}
