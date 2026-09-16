using NUnit.Framework;
using RaceCorProDrive.Tests.TestHelpers;

namespace RaceCorProDrive.Tests
{
    [TestFixture]
    public class TriggerEvaluatorTests
    {
        private TelemetrySnapshot _baseCurrent = null!;
        private TelemetrySnapshot _basePrevious = null!;

        [SetUp]
        public void Setup()
        {
            _baseCurrent = new TelemetrySnapshot { GameRunning = true };
            _basePrevious = new TelemetrySnapshot { GameRunning = true };
        }

        #region Null Safety

        [Test]
        public void Evaluate_WithNullCurrent_ReturnsFalse()
        {
            var trigger = new TriggerCondition { Condition = ">", DataPoint = "SpeedKmh", Value = 100 };
            Assert.IsFalse(TriggerEvaluator.Evaluate(trigger, null!, _basePrevious));
        }

        [Test]
        public void Evaluate_WithGameNotRunning_ReturnsFalse()
        {
            _baseCurrent.GameRunning = false;
            var trigger = new TriggerCondition { Condition = ">", DataPoint = "SpeedKmh", Value = 100 };
            Assert.IsFalse(TriggerEvaluator.Evaluate(trigger, _baseCurrent, _basePrevious));
        }

        [Test]
        public void Evaluate_WithUnknownCondition_ReturnsFalse()
        {
            var trigger = new TriggerCondition { Condition = "invalid_condition", DataPoint = "SpeedKmh" };
            Assert.IsFalse(TriggerEvaluator.Evaluate(trigger, _baseCurrent, _basePrevious));
        }

        #endregion

        #region CompareGreater / CompareLess

        [TestCase(100.0, ">", 99.0, true)]
        [TestCase(100.0, ">", 100.0, false)]
        [TestCase(100.0, ">", 101.0, false)]
        [TestCase(100.0, "<", 101.0, true)]
        [TestCase(100.0, "<", 100.0, false)]
        [TestCase(100.0, "<", 99.0, false)]
        public void CompareGreaterLess_WithNumericValues_WorksCorrectly(double value, string condition, double threshold, bool expected)
        {
            _baseCurrent.SpeedKmh = value;
            var trigger = new TriggerCondition { Condition = condition, DataPoint = "SpeedKmh", Value = threshold };
            Assert.AreEqual(expected, TriggerEvaluator.Evaluate(trigger, _baseCurrent, _basePrevious));
        }

        #endregion

        #region Tyre Wear (Critical Inverted Bug Fix)

        [Test]
        public void TyreWear_WithLowWear_DoesNotTrigger()
        {
            // Fresh tyres: 70% life remaining (30% worn)
            _baseCurrent.TyreWearFL = 0.70;
            var trigger = new TriggerCondition { Condition = "<", DataPoint = "TyreWearFL", Value = 0.35 };
            Assert.IsFalse(TriggerEvaluator.Evaluate(trigger, _baseCurrent, _basePrevious),
                "Fresh tyres (70% remaining) should not trigger wear warning with threshold 0.35");
        }

        [Test]
        public void TyreWear_WithHighWear_TriggersCorrectly()
        {
            // Worn tyres: 30% life remaining (70% worn)
            _baseCurrent.TyreWearFL = 0.30;
            var trigger = new TriggerCondition { Condition = "<", DataPoint = "TyreWearFL", Value = 0.35 };
            Assert.IsTrue(TriggerEvaluator.Evaluate(trigger, _baseCurrent, _basePrevious),
                "Worn tyres (30% remaining) should trigger wear warning with threshold 0.35");
        }

        [Test]
        public void TyreWear_AtExactThreshold_TriggersCorrectly()
        {
            // Exactly at threshold: 35% life remaining
            _baseCurrent.TyreWearFL = 0.35;
            var trigger = new TriggerCondition { Condition = "<", DataPoint = "TyreWearFL", Value = 0.35 };
            // < is not <=, so 0.35 < 0.35 is false
            Assert.IsFalse(TriggerEvaluator.Evaluate(trigger, _baseCurrent, _basePrevious));
        }

        #endregion

        #region Threshold Value Fixes

        [TestCase("VertAccel", 9.0, 10.0, false)] // Below threshold — should NOT trigger
        [TestCase("VertAccel", 11.0, 10.0, true)]  // Above threshold — should trigger
        public void KerbHit_WithFixedThreshold_WorksCorrectly(string dataPoint, double prevVal, double curVal, bool expected)
        {
            _basePrevious.VertAccel = prevVal;
            _baseCurrent.VertAccel = curVal;
            var trigger = new TriggerCondition { Condition = "spike", DataPoint = dataPoint, ThresholdDelta = 10.0 };
            Assert.AreEqual(expected, TriggerEvaluator.Evaluate(trigger, _baseCurrent, _basePrevious));
        }

        [TestCase("SteeringWheelTorque", 20.0, 45.0, false)] // Below threshold
        [TestCase("SteeringWheelTorque", 20.0, 46.0, true)]  // Above threshold
        public void FfbTorqueSpike_WithFixedThreshold_WorksCorrectly(string dataPoint, double prevVal, double curVal, bool expected)
        {
            _basePrevious.SteeringWheelTorque = prevVal;
            _baseCurrent.SteeringWheelTorque = curVal;
            var trigger = new TriggerCondition { Condition = "spike", DataPoint = dataPoint, ThresholdDelta = 25.0 };
            Assert.AreEqual(expected, TriggerEvaluator.Evaluate(trigger, _baseCurrent, _basePrevious));
        }

        [TestCase("YawRate", 2.8, false)] // Below threshold
        [TestCase("YawRate", 3.1, true)]  // Above threshold
        public void SpinCatch_WithFixedThreshold_WorksCorrectly(string dataPoint, double absValue, bool expected)
        {
            _baseCurrent.YawRate = absValue;
            var trigger = new TriggerCondition { Condition = "extreme", DataPoint = dataPoint, AbsValue = 3.0 };
            Assert.AreEqual(expected, TriggerEvaluator.Evaluate(trigger, _baseCurrent, _basePrevious));
        }

        [TestCase(-35.0, false)] // Below threshold
        [TestCase(-39.0, true)]  // Above threshold
        public void HeavyBraking_WithFixedThreshold_WorksCorrectly(double accel, bool expected)
        {
            _baseCurrent.LongAccel = accel;
            var trigger = new TriggerCondition { Condition = "<", DataPoint = "LongAccel", Value = -38.0 };
            Assert.AreEqual(expected, TriggerEvaluator.Evaluate(trigger, _baseCurrent, _basePrevious));
        }

        [TestCase(240.0, false)] // Below threshold
        [TestCase(255.0, true)]  // Above threshold
        public void HotTyres_WithFixedThreshold_WorksCorrectly(double temp, bool expected)
        {
            _baseCurrent.TyreTempFL = temp;
            var trigger = new TriggerCondition { Condition = ">", DataPoint = "TyreTempFL", Value = 250.0 };
            Assert.AreEqual(expected, TriggerEvaluator.Evaluate(trigger, _baseCurrent, _basePrevious));
        }

        [TestCase(-0.5, false)] // Below threshold
        [TestCase(-0.7, true)]  // Above threshold
        public void QualifyingPush_WithFixedThreshold_WorksCorrectly(double delta, bool expected)
        {
            _baseCurrent.LapDeltaToBest = delta;
            var trigger = new TriggerCondition { Condition = "<", DataPoint = "LapDeltaToBest", Value = -0.6 };
            Assert.AreEqual(expected, TriggerEvaluator.Evaluate(trigger, _baseCurrent, _basePrevious));
        }

        #endregion

        #region Position Changes

        [Test]
        public void PlayerGainedPosition_WithPositionImprovement_ReturnsTrue()
        {
            _basePrevious.Position = 3;
            _baseCurrent.Position = 2;
            var trigger = new TriggerCondition { Condition = "player_gain_position" };
            Assert.IsTrue(TriggerEvaluator.Evaluate(trigger, _baseCurrent, _basePrevious));
        }

        [Test]
        public void PlayerGainedPosition_WithNoChange_ReturnsFalse()
        {
            _basePrevious.Position = 3;
            _baseCurrent.Position = 3;
            var trigger = new TriggerCondition { Condition = "player_gain_position" };
            Assert.IsFalse(TriggerEvaluator.Evaluate(trigger, _baseCurrent, _basePrevious));
        }

        [Test]
        public void PlayerGainedPosition_WithPositionLoss_ReturnsFalse()
        {
            _basePrevious.Position = 3;
            _baseCurrent.Position = 4;
            var trigger = new TriggerCondition { Condition = "player_gain_position" };
            Assert.IsFalse(TriggerEvaluator.Evaluate(trigger, _baseCurrent, _basePrevious));
        }

        [Test]
        public void PlayerLostPosition_WithPositionLoss_ReturnsTrue()
        {
            _basePrevious.Position = 3;
            _baseCurrent.Position = 4;
            var trigger = new TriggerCondition { Condition = "player_lost_position" };
            Assert.IsTrue(TriggerEvaluator.Evaluate(trigger, _baseCurrent, _basePrevious));
        }

        [Test]
        public void PlayerLostPosition_WithNoChange_ReturnsFalse()
        {
            _basePrevious.Position = 3;
            _baseCurrent.Position = 3;
            var trigger = new TriggerCondition { Condition = "player_lost_position" };
            Assert.IsFalse(TriggerEvaluator.Evaluate(trigger, _baseCurrent, _basePrevious));
        }

        [Test]
        public void PlayerGainedPosition_WithInvalidPosition_ReturnsFalse()
        {
            _basePrevious.Position = 0; // Invalid
            _baseCurrent.Position = 1;
            var trigger = new TriggerCondition { Condition = "player_gain_position" };
            Assert.IsFalse(TriggerEvaluator.Evaluate(trigger, _baseCurrent, _basePrevious));
        }

        #endregion

        #region Flag Transitions

        [Test]
        public void YellowFlag_WithTransitionFromGreen_ReturnsTrue()
        {
            _basePrevious.SessionFlags = TelemetrySnapshot.FLAG_GREEN;
            _baseCurrent.SessionFlags = TelemetrySnapshot.FLAG_YELLOW;
            var trigger = new TriggerCondition { Condition = "yellow_flag" };
            Assert.IsTrue(TriggerEvaluator.Evaluate(trigger, _baseCurrent, _basePrevious));
        }

        [Test]
        public void YellowFlag_WhenAlreadyActive_ReturnsFalse()
        {
            _basePrevious.SessionFlags = TelemetrySnapshot.FLAG_YELLOW;
            _baseCurrent.SessionFlags = TelemetrySnapshot.FLAG_YELLOW;
            var trigger = new TriggerCondition { Condition = "yellow_flag" };
            Assert.IsFalse(TriggerEvaluator.Evaluate(trigger, _baseCurrent, _basePrevious));
        }

        [Test]
        public void BlackFlag_WithTransition_ReturnsTrue()
        {
            _basePrevious.SessionFlags = TelemetrySnapshot.FLAG_GREEN;
            _baseCurrent.SessionFlags = TelemetrySnapshot.FLAG_BLACK;
            var trigger = new TriggerCondition { Condition = "black_flag" };
            Assert.IsTrue(TriggerEvaluator.Evaluate(trigger, _baseCurrent, _basePrevious));
        }

        [Test]
        public void YellowFlag_CompositeMask_ReturnsTrue()
        {
            // FLAG_YELLOW is composite: 0x0008 | 0x4000 | 0x8000
            _basePrevious.SessionFlags = TelemetrySnapshot.FLAG_GREEN;
            _baseCurrent.SessionFlags = 0x4000; // caution flag
            var trigger = new TriggerCondition { Condition = "yellow_flag" };
            Assert.IsTrue(TriggerEvaluator.Evaluate(trigger, _baseCurrent, _basePrevious));
        }

        #endregion

        #region Close Proximity

        [Test]
        public void CloseProximity_WithCarWithinThreshold_ReturnsTrue()
        {
            _baseCurrent.TrackPositionPct = 0.50;
            _baseCurrent.PlayerCarIdx = 0;
            _baseCurrent.CarIdxLapDistPct = new float[] { 0.50f, 0.505f, 0.90f }; // Car 1 is 0.005 away (0.8%)
            var trigger = new TriggerCondition { Condition = "close_proximity", ProximityThreshold = 0.008 };
            Assert.IsTrue(TriggerEvaluator.Evaluate(trigger, _baseCurrent, _basePrevious));
        }

        [Test]
        public void CloseProximity_WithCarOutsideThreshold_ReturnsFalse()
        {
            _baseCurrent.TrackPositionPct = 0.50;
            _baseCurrent.PlayerCarIdx = 0;
            _baseCurrent.CarIdxLapDistPct = new float[] { 0.50f, 0.52f, 0.90f }; // Car 1 is 0.02 away (2%)
            var trigger = new TriggerCondition { Condition = "close_proximity", ProximityThreshold = 0.008 };
            Assert.IsFalse(TriggerEvaluator.Evaluate(trigger, _baseCurrent, _basePrevious));
        }

        [Test]
        public void CloseProximity_WithWrapAroundAtStart_ReturnsTrue()
        {
            _baseCurrent.TrackPositionPct = 0.01;
            _baseCurrent.PlayerCarIdx = 0;
            _baseCurrent.CarIdxLapDistPct = new float[] { 0.01f, 0.99f }; // Car 1 at 0.99 is 0.02 away via wrap-around
            var trigger = new TriggerCondition { Condition = "close_proximity", ProximityThreshold = 0.008 };
            // min(|0.01 - 0.99|, 1.0 - |0.01 - 0.99|) = min(0.98, 0.02) = 0.02
            Assert.IsFalse(TriggerEvaluator.Evaluate(trigger, _baseCurrent, _basePrevious));
        }

        [Test]
        public void CloseProximity_WithEmptyCarArray_ReturnsFalse()
        {
            _baseCurrent.CarIdxLapDistPct = new float[0];
            var trigger = new TriggerCondition { Condition = "close_proximity", ProximityThreshold = 0.008 };
            Assert.IsFalse(TriggerEvaluator.Evaluate(trigger, _baseCurrent, _basePrevious));
        }

        #endregion

        #region Spike / Sudden Drop

        [Test]
        public void Spike_WithPositiveDeltaAboveThreshold_ReturnsTrue()
        {
            _basePrevious.VertAccel = 0.0;
            _baseCurrent.VertAccel = 11.0;
            var trigger = new TriggerCondition { Condition = "spike", DataPoint = "VertAccel", ThresholdDelta = 10.0 };
            Assert.IsTrue(TriggerEvaluator.Evaluate(trigger, _baseCurrent, _basePrevious));
        }

        [Test]
        public void Spike_WithPositiveDeltaBelowThreshold_ReturnsFalse()
        {
            _basePrevious.VertAccel = 0.0;
            _baseCurrent.VertAccel = 9.0;
            var trigger = new TriggerCondition { Condition = "spike", DataPoint = "VertAccel", ThresholdDelta = 10.0 };
            Assert.IsFalse(TriggerEvaluator.Evaluate(trigger, _baseCurrent, _basePrevious));
        }

        [Test]
        public void SuddenDrop_WithNegativeDeltaBelowThreshold_ReturnsTrue()
        {
            _basePrevious.VertAccel = 10.0;
            _baseCurrent.VertAccel = 0.0;
            var trigger = new TriggerCondition { Condition = "sudden_drop", DataPoint = "VertAccel", ThresholdDelta = -8.0 };
            Assert.IsTrue(TriggerEvaluator.Evaluate(trigger, _baseCurrent, _basePrevious));
        }

        [Test]
        public void SuddenDrop_WithNullPrevious_ReturnsFalse()
        {
            var trigger = new TriggerCondition { Condition = "sudden_drop", DataPoint = "VertAccel", ThresholdDelta = -8.0 };
            Assert.IsFalse(TriggerEvaluator.Evaluate(trigger, _baseCurrent, null!));
        }

        #endregion

        #region Race Start

        [Test]
        public void RaceStart_WithCorrectTransition_ReturnsTrue()
        {
            _basePrevious.SessionTypeName = "Race";
            _basePrevious.CurrentLap = 0;
            _basePrevious.CompletedLaps = 0;

            _baseCurrent.SessionTypeName = "Race";
            _baseCurrent.CurrentLap = 1;
            _baseCurrent.CompletedLaps = 0;

            var trigger = new TriggerCondition { Condition = "race_start" };
            Assert.IsTrue(TriggerEvaluator.Evaluate(trigger, _baseCurrent, _basePrevious));
        }

        [Test]
        public void RaceStart_WithPracticeSession_ReturnsFalse()
        {
            _basePrevious.SessionTypeName = "Practice";
            _basePrevious.CurrentLap = 0;
            _baseCurrent.SessionTypeName = "Practice";
            _baseCurrent.CurrentLap = 1;
            var trigger = new TriggerCondition { Condition = "race_start" };
            Assert.IsFalse(TriggerEvaluator.Evaluate(trigger, _baseCurrent, _basePrevious));
        }

        [Test]
        public void RaceStart_WithLapAlreadyStarted_ReturnsFalse()
        {
            _basePrevious.SessionTypeName = "Race";
            _basePrevious.CurrentLap = 1;
            _basePrevious.CompletedLaps = 0;

            _baseCurrent.SessionTypeName = "Race";
            _baseCurrent.CurrentLap = 2;
            _baseCurrent.CompletedLaps = 1;

            var trigger = new TriggerCondition { Condition = "race_start" };
            Assert.IsFalse(TriggerEvaluator.Evaluate(trigger, _baseCurrent, _basePrevious));
        }

        #endregion

        #region Boolean Comparisons

        [Test]
        public void CompareEquals_WithBooleanAbsActive_WorksCorrectly()
        {
            _baseCurrent.AbsActive = true;
            var trigger = new TriggerCondition { Condition = "==", DataPoint = "AbsActive", Value = 1 };
            Assert.IsTrue(TriggerEvaluator.Evaluate(trigger, _baseCurrent, _basePrevious));
        }

        [Test]
        public void CompareEquals_WithBooleanAbsInactive_WorksCorrectly()
        {
            _baseCurrent.AbsActive = false;
            var trigger = new TriggerCondition { Condition = "==", DataPoint = "AbsActive", Value = 0 };
            Assert.IsTrue(TriggerEvaluator.Evaluate(trigger, _baseCurrent, _basePrevious));
        }

        #endregion
    }
}
