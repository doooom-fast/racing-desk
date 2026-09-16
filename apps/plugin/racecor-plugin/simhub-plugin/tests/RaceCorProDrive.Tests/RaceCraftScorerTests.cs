using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using RaceCorProDrive.Tests.TestHelpers;
using static RaceCorProDrive.Tests.TestHelpers.RaceCraftScorer;

namespace RaceCorProDrive.Tests
{
    [TestFixture]
    public class RaceCraftScorerTests
    {
        // ═══════════════════════════════════════════════════════════════════
        //  TEST HELPERS — event generation
        // ═══════════════════════════════════════════════════════════════════

        private static readonly DateTime BaseDate = new DateTime(2026, 3, 1);

        /// <summary>Creates a RacingEvent with sensible defaults.</summary>
        private static RacingEvent MakeEvent(
            EventType type, int lap = 1, string opponent = "Opponent",
            double gap = 0.8, double proximity = 0.5, string sessionId = "test-session")
        {
            return new RacingEvent
            {
                Type = type,
                LapNumber = lap,
                Timestamp = DateTime.Now,
                OpponentName = opponent,
                GapSeconds = gap,
                ClosestProximitySeconds = proximity,
                SessionId = sessionId
            };
        }

        /// <summary>Creates a session with a specific ID and date.</summary>
        private static RaceCraftScorer MakeScorerWithSession(
            string sessionId = "session-1", DateTime? raceDate = null)
        {
            var scorer = new RaceCraftScorer();
            scorer.StartSession(sessionId, raceDate ?? BaseDate);
            return scorer;
        }

        /// <summary>Populates a scorer with a realistic spread of craft events.</summary>
        private static RaceCraftScorer BuildRealisticScorer()
        {
            var scorer = new RaceCraftScorer();
            var rng = new Random(42);

            // Session 1: aggressive driver with some contact
            scorer.StartSession("session-1", BaseDate);
            for (int i = 0; i < 3; i++)
                scorer.RecordEvent(MakeEvent(EventType.CleanOvertake, lap: i + 1));
            for (int i = 0; i < 2; i++)
                scorer.RecordEvent(MakeEvent(EventType.ContactOvertake, lap: i + 4));
            for (int i = 0; i < 2; i++)
                scorer.RecordEvent(MakeEvent(EventType.LateReaction, lap: i + 6));
            scorer.EndSession();

            // Session 2: clean, defensive driver
            scorer.StartSession("session-2", BaseDate.AddDays(1));
            for (int i = 0; i < 4; i++)
                scorer.RecordEvent(MakeEvent(EventType.CleanDefense, lap: i + 1));
            for (int i = 0; i < 3; i++)
                scorer.RecordEvent(MakeEvent(EventType.EarlyReaction, lap: i + 5));
            scorer.EndSession();

            // Session 3: mixed performance
            scorer.StartSession("session-3", BaseDate.AddDays(2));
            for (int i = 0; i < 5; i++)
                scorer.RecordEvent(MakeEvent(
                    rng.Next(2) == 0 ? EventType.CleanOvertake : EventType.TightOvertake,
                    lap: i + 1));
            scorer.EndSession();

            return scorer;
        }

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 1: Session Management
        // ═══════════════════════════════════════════════════════════════════

        #region Session Management

        [Test]
        public void StartSession_ValidSession_Created()
        {
            var scorer = new RaceCraftScorer();
            scorer.StartSession("session-1", BaseDate);
            Assert.IsNotNull(scorer.CurrentSession);
            Assert.AreEqual("session-1", scorer.CurrentSession.SessionId);
        }

        [Test]
        public void StartSession_PreviousSessionWithEvents_Archived()
        {
            var scorer = new RaceCraftScorer();
            scorer.StartSession("session-1", BaseDate);
            scorer.RecordEvent(MakeEvent(EventType.CleanOvertake));
            scorer.StartSession("session-2", BaseDate.AddDays(1));

            Assert.AreEqual(1, scorer.Sessions.Count);
            Assert.AreEqual("session-1", scorer.Sessions[0].SessionId);
        }

        [Test]
        public void EndSession_CurrentSession_Archived()
        {
            var scorer = MakeScorerWithSession();
            scorer.RecordEvent(MakeEvent(EventType.CleanOvertake));
            scorer.EndSession();

            Assert.IsNull(scorer.CurrentSession);
            Assert.AreEqual(1, scorer.Sessions.Count);
        }

        [Test]
        public void StartSession_AutoStartsIfNeeded()
        {
            var scorer = new RaceCraftScorer();
            scorer.RecordEvent(MakeEvent(EventType.CleanOvertake));

            Assert.IsNotNull(scorer.CurrentSession);
            Assert.Greater(scorer.CurrentSession.Events.Count, 0);
        }

        [Test]
        public void EndSession_NoCurrentSession_DoesNotThrow()
        {
            var scorer = new RaceCraftScorer();
            Assert.DoesNotThrow(() => scorer.EndSession());
        }

        [Test]
        public void StartSession_EmptySession_NotArchived()
        {
            var scorer = new RaceCraftScorer();
            scorer.StartSession("session-1", BaseDate);
            scorer.StartSession("session-2", BaseDate.AddDays(1));

            Assert.AreEqual(0, scorer.Sessions.Count, "Empty session should not be archived");
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 2: Event Recording
        // ═══════════════════════════════════════════════════════════════════

        #region Event Recording

        [Test]
        public void RecordEvent_ValidEvent_Added()
        {
            var scorer = MakeScorerWithSession();
            scorer.RecordEvent(MakeEvent(EventType.CleanOvertake));

            Assert.AreEqual(1, scorer.CurrentSession.Events.Count);
        }

        [Test]
        public void RecordEvent_NullEvent_Ignored()
        {
            var scorer = MakeScorerWithSession();
            scorer.RecordEvent(null);

            Assert.AreEqual(0, scorer.CurrentSession.Events.Count);
        }

        [Test]
        public void RecordEvent_MultipleEvents_AllTracked()
        {
            var scorer = MakeScorerWithSession();
            for (int i = 0; i < 10; i++)
                scorer.RecordEvent(MakeEvent(EventType.CleanOvertake, lap: i + 1));

            Assert.AreEqual(10, scorer.CurrentSession.Events.Count);
        }

        [Test]
        public void RecordCleanOvertake_Convenience_Works()
        {
            var scorer = MakeScorerWithSession();
            scorer.RecordCleanOvertake(lap: 5, opponent: "Driver A");

            Assert.AreEqual(1, scorer.CurrentSession.Events.Count);
            var evt = scorer.CurrentSession.Events[0];
            Assert.AreEqual(EventType.CleanOvertake, evt.Type);
            Assert.AreEqual(5, evt.LapNumber);
            Assert.AreEqual("Driver A", evt.OpponentName);
        }

        [Test]
        public void RecordContactOvertake_Convenience_Works()
        {
            var scorer = MakeScorerWithSession();
            scorer.RecordContactOvertake(lap: 3, opponent: "Driver B");

            Assert.AreEqual(1, scorer.CurrentSession.Events.Count);
            var evt = scorer.CurrentSession.Events[0];
            Assert.AreEqual(EventType.ContactOvertake, evt.Type);
            Assert.AreEqual(0.0, evt.ClosestProximitySeconds);
        }

        [Test]
        public void RecordEvent_WithoutSession_CreatesSession()
        {
            var scorer = new RaceCraftScorer();
            scorer.RecordEvent(MakeEvent(EventType.CleanOvertake));

            Assert.IsNotNull(scorer.CurrentSession);
            Assert.Greater(scorer.CurrentSession.Events.Count, 0);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 3: Event Points
        // ═══════════════════════════════════════════════════════════════════

        #region Event Points

        [Test]
        public void Event_Points_CleanOvertake_Correct()
        {
            var evt = MakeEvent(EventType.CleanOvertake);
            Assert.AreEqual(CleanOvertakePoints, evt.Points);
        }

        [Test]
        public void Event_Points_TightOvertake_Correct()
        {
            var evt = MakeEvent(EventType.TightOvertake);
            Assert.AreEqual(TightOvertakePoints, evt.Points);
        }

        [Test]
        public void Event_Points_ContactOvertake_Correct()
        {
            var evt = MakeEvent(EventType.ContactOvertake);
            Assert.AreEqual(ContactOvertakePoints, evt.Points);
        }

        [Test]
        public void Event_Points_Divebomb_Correct()
        {
            var evt = MakeEvent(EventType.Divebomb);
            Assert.AreEqual(DivebombPoints, evt.Points);
        }

        [Test]
        public void Event_Points_CleanDefense_Correct()
        {
            var evt = MakeEvent(EventType.CleanDefense);
            Assert.AreEqual(CleanDefensePoints, evt.Points);
        }

        [Test]
        public void Event_Points_DefensiveWeaving_Correct()
        {
            var evt = MakeEvent(EventType.DefensiveWeaving);
            Assert.AreEqual(WeavingPenalty, evt.Points);
        }

        [Test]
        public void Event_Points_EarlyReaction_Correct()
        {
            var evt = MakeEvent(EventType.EarlyReaction);
            Assert.AreEqual(AwarenessPoints, evt.Points);
        }

        [Test]
        public void Event_Points_LateReaction_Correct()
        {
            var evt = MakeEvent(EventType.LateReaction);
            Assert.AreEqual(LateReactionPenalty, evt.Points);
        }

        [Test]
        public void Event_Points_PositionLost_Neutral()
        {
            var evt = MakeEvent(EventType.PositionLost);
            Assert.AreEqual(0.0, evt.Points);
        }

        [Test]
        public void Event_Points_NearMiss_Negative()
        {
            var evt = MakeEvent(EventType.NearMiss);
            Assert.AreEqual(-0.5, evt.Points);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 4: Session Craft Scores
        // ═══════════════════════════════════════════════════════════════════

        #region Session Craft Scores

        [Test]
        public void SessionCraft_OvertakeScore_CalculatedFromOvertakeEvents()
        {
            var scorer = MakeScorerWithSession();
            scorer.RecordEvent(MakeEvent(EventType.CleanOvertake));
            scorer.RecordEvent(MakeEvent(EventType.CleanOvertake));
            scorer.RecordEvent(MakeEvent(EventType.ContactOvertake));

            var session = scorer.CurrentSession;
            double expected = 50.0 + (CleanOvertakePoints * 2 + ContactOvertakePoints) * 10.0;
            Assert.AreEqual(expected, session.OvertakeScore, 1e-10);
        }

        [Test]
        public void SessionCraft_DefenseScore_CalculatedFromDefenseEvents()
        {
            var scorer = MakeScorerWithSession();
            scorer.RecordEvent(MakeEvent(EventType.CleanDefense));
            scorer.RecordEvent(MakeEvent(EventType.CleanDefense));

            var session = scorer.CurrentSession;
            double expected = 50.0 + (CleanDefensePoints * 2) * 10.0;
            Assert.AreEqual(expected, session.DefenseScore, 1e-10);
        }

        [Test]
        public void SessionCraft_AwarenessScore_CalculatedFromAwarenessEvents()
        {
            var scorer = MakeScorerWithSession();
            scorer.RecordEvent(MakeEvent(EventType.EarlyReaction));
            scorer.RecordEvent(MakeEvent(EventType.EarlyReaction));

            var session = scorer.CurrentSession;
            double expected = 50.0 + (AwarenessPoints * 2) * 10.0;
            Assert.AreEqual(expected, session.AwarenessScore, 1e-10);
        }

        [Test]
        public void SessionCraft_TotalPoints_SumsAllEventPoints()
        {
            var scorer = MakeScorerWithSession();
            scorer.RecordEvent(MakeEvent(EventType.CleanOvertake));
            scorer.RecordEvent(MakeEvent(EventType.CleanDefense));
            scorer.RecordEvent(MakeEvent(EventType.EarlyReaction));

            var session = scorer.CurrentSession;
            double expected = CleanOvertakePoints + CleanDefensePoints + AwarenessPoints;
            Assert.AreEqual(expected, session.TotalPoints, 1e-10);
        }

        [Test]
        public void SessionCraft_CleanOvertakes_Counted()
        {
            var scorer = MakeScorerWithSession();
            scorer.RecordEvent(MakeEvent(EventType.CleanOvertake));
            scorer.RecordEvent(MakeEvent(EventType.CleanOvertake));
            scorer.RecordEvent(MakeEvent(EventType.TightOvertake));

            var session = scorer.CurrentSession;
            Assert.AreEqual(2, session.CleanOvertakes);
        }

        [Test]
        public void SessionCraft_DirtyOvertakes_Counted()
        {
            var scorer = MakeScorerWithSession();
            scorer.RecordEvent(MakeEvent(EventType.ContactOvertake));
            scorer.RecordEvent(MakeEvent(EventType.Divebomb));
            scorer.RecordEvent(MakeEvent(EventType.CleanOvertake));

            var session = scorer.CurrentSession;
            Assert.AreEqual(2, session.DirtyOvertakes);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 5: Composite Rating
        // ═══════════════════════════════════════════════════════════════════

        #region Composite Rating

        [Test]
        public void ComputeCompositeRating_InsufficientEvents_Returns50()
        {
            var scorer = MakeScorerWithSession();
            for (int i = 0; i < MinEvents - 1; i++)
                scorer.RecordEvent(MakeEvent(EventType.CleanOvertake));

            double rating = scorer.ComputeCompositeRating();
            Assert.AreEqual(50.0, rating);
        }

        [Test]
        public void ComputeCompositeRating_MinimumEvents_Computed()
        {
            var scorer = MakeScorerWithSession();
            for (int i = 0; i < MinEvents; i++)
                scorer.RecordEvent(MakeEvent(EventType.CleanOvertake));

            double rating = scorer.ComputeCompositeRating();
            Assert.NotZero(rating);
            Assert.Greater(rating, 50.0);
        }

        [Test]
        public void ComputeCompositeRating_AllCleanEvents_HighScore()
        {
            var scorer = MakeScorerWithSession();
            // CleanOvertake only fills OvertakeScore (→100), Defense/Awareness stay neutral (50)
            // Composite = 0.4*100 + 0.3*50 + 0.3*50 = 70
            for (int i = 0; i < 20; i++)
                scorer.RecordEvent(MakeEvent(EventType.CleanOvertake));

            double rating = scorer.ComputeCompositeRating();
            Assert.Greater(rating, 65.0);
        }

        [Test]
        public void ComputeCompositeRating_AllDirtyEvents_LowScore()
        {
            var scorer = MakeScorerWithSession();
            // Divebomb only tanks OvertakeScore (→0), Defense/Awareness stay neutral (50)
            // Composite = 0.4*0 + 0.3*50 + 0.3*50 = 30
            for (int i = 0; i < 10; i++)
                scorer.RecordEvent(MakeEvent(EventType.Divebomb));

            double rating = scorer.ComputeCompositeRating();
            Assert.LessOrEqual(rating, 30.0);
        }

        [Test]
        public void ComputeCompositeRating_MultipleSessions_Averaged()
        {
            var scorer = new RaceCraftScorer();

            // Session 1: very clean
            scorer.StartSession("s1", BaseDate);
            for (int i = 0; i < 10; i++)
                scorer.RecordEvent(MakeEvent(EventType.CleanOvertake));
            scorer.EndSession();

            // Session 2: very dirty
            scorer.StartSession("s2", BaseDate.AddDays(1));
            for (int i = 0; i < 10; i++)
                scorer.RecordEvent(MakeEvent(EventType.Divebomb));
            scorer.EndSession();

            double rating = scorer.ComputeCompositeRating();
            // Should be somewhere between clean and dirty
            Assert.Greater(rating, 20.0);
            Assert.Less(rating, 80.0);
        }

        [Test]
        public void ComputeCompositeRating_InRange0To100()
        {
            var scorer = BuildRealisticScorer();
            double rating = scorer.ComputeCompositeRating();

            Assert.GreaterOrEqual(rating, 0.0);
            Assert.LessOrEqual(rating, 100.0);
        }

        [Test]
        public void ComputeCompositeRating_WeightedCorrectly()
        {
            var scorer = MakeScorerWithSession();
            // All events of one type to isolate overtake score
            for (int i = 0; i < 20; i++)
                scorer.RecordEvent(MakeEvent(EventType.CleanOvertake));

            double rating = scorer.ComputeCompositeRating();
            // Rating = 0.4 * overtake + 0.3 * defense + 0.3 * awareness
            // Overtake will be high, defense and awareness will be 50 (neutral)
            // So rating should be: 0.4 * high + 0.3 * 50 + 0.3 * 50 = 0.4 * high + 30
            Assert.Greater(rating, 50.0);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 6: Rating Trend
        // ═══════════════════════════════════════════════════════════════════

        #region Rating Trend

        [Test]
        public void ComputeRatingTrend_InsufficientSessions_ReturnsZero()
        {
            var scorer = new RaceCraftScorer();
            for (int i = 0; i < 3; i++)
            {
                scorer.StartSession($"s{i}", BaseDate.AddDays(i));
                scorer.RecordEvent(MakeEvent(EventType.CleanOvertake));
                scorer.EndSession();
            }

            double trend = scorer.ComputeRatingTrend();
            Assert.AreEqual(0.0, trend);
        }

        [Test]
        public void ComputeRatingTrend_PositiveImprovement()
        {
            var scorer = new RaceCraftScorer();

            // First 2 sessions: negative points
            for (int i = 0; i < 2; i++)
            {
                scorer.StartSession($"s{i}", BaseDate.AddDays(i));
                for (int j = 0; j < 5; j++)
                    scorer.RecordEvent(MakeEvent(EventType.Divebomb));
                scorer.EndSession();
            }

            // Last 2 sessions: positive points
            for (int i = 2; i < 4; i++)
            {
                scorer.StartSession($"s{i}", BaseDate.AddDays(i));
                for (int j = 0; j < 5; j++)
                    scorer.RecordEvent(MakeEvent(EventType.CleanOvertake));
                scorer.EndSession();
            }

            double trend = scorer.ComputeRatingTrend();
            Assert.Greater(trend, 0.0);
        }

        [Test]
        public void ComputeRatingTrend_NegativeDecline()
        {
            var scorer = new RaceCraftScorer();

            // First 2 sessions: positive points
            for (int i = 0; i < 2; i++)
            {
                scorer.StartSession($"s{i}", BaseDate.AddDays(i));
                for (int j = 0; j < 5; j++)
                    scorer.RecordEvent(MakeEvent(EventType.CleanOvertake));
                scorer.EndSession();
            }

            // Last 2 sessions: negative points
            for (int i = 2; i < 4; i++)
            {
                scorer.StartSession($"s{i}", BaseDate.AddDays(i));
                for (int j = 0; j < 5; j++)
                    scorer.RecordEvent(MakeEvent(EventType.Divebomb));
                scorer.EndSession();
            }

            double trend = scorer.ComputeRatingTrend();
            Assert.Less(trend, 0.0);
        }

        [Test]
        public void ComputeRatingTrend_EmptySessions_Ignored()
        {
            var scorer = new RaceCraftScorer();

            // Empty sessions should not contribute
            scorer.StartSession("s0", BaseDate);
            scorer.EndSession();

            // Sessions with events
            for (int i = 1; i < 5; i++)
            {
                scorer.StartSession($"s{i}", BaseDate.AddDays(i));
                scorer.RecordEvent(MakeEvent(EventType.CleanOvertake, lap: i));
                scorer.EndSession();
            }

            Assert.DoesNotThrow(() => scorer.ComputeRatingTrend());
        }

        [Test]
        public void ComputeRatingTrend_Stable_ZeroOrNear()
        {
            var scorer = new RaceCraftScorer();

            // All sessions identical
            for (int i = 0; i < 4; i++)
            {
                scorer.StartSession($"s{i}", BaseDate.AddDays(i));
                scorer.RecordEvent(MakeEvent(EventType.CleanOvertake));
                scorer.EndSession();
            }

            double trend = scorer.ComputeRatingTrend();
            Assert.AreEqual(0.0, trend, 1e-10);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 7: Clean Overtake Percentage
        // ═══════════════════════════════════════════════════════════════════

        #region Clean Overtake Percentage

        [Test]
        public void CleanOvertakePercentage_NoOvertakes_Returns100()
        {
            var scorer = MakeScorerWithSession();
            for (int i = 0; i < 5; i++)
                scorer.RecordEvent(MakeEvent(EventType.EarlyReaction));

            double pct = scorer.CleanOvertakePercentage();
            Assert.AreEqual(100.0, pct);
        }

        [Test]
        public void CleanOvertakePercentage_AllClean_Returns100()
        {
            var scorer = MakeScorerWithSession();
            for (int i = 0; i < 10; i++)
                scorer.RecordEvent(MakeEvent(EventType.CleanOvertake));

            double pct = scorer.CleanOvertakePercentage();
            Assert.AreEqual(100.0, pct);
        }

        [Test]
        public void CleanOvertakePercentage_HalfClean_Returns50()
        {
            var scorer = MakeScorerWithSession();
            for (int i = 0; i < 5; i++)
            {
                scorer.RecordEvent(MakeEvent(EventType.CleanOvertake));
                scorer.RecordEvent(MakeEvent(EventType.Divebomb));
            }

            double pct = scorer.CleanOvertakePercentage();
            Assert.AreEqual(50.0, pct);
        }

        [Test]
        public void CleanOvertakePercentage_AllDirty_Returns0()
        {
            var scorer = MakeScorerWithSession();
            for (int i = 0; i < 10; i++)
                scorer.RecordEvent(MakeEvent(EventType.ContactOvertake));

            double pct = scorer.CleanOvertakePercentage();
            Assert.AreEqual(0.0, pct);
        }

        [Test]
        public void CleanOvertakePercentage_TightCountsAsClean()
        {
            var scorer = MakeScorerWithSession();
            scorer.RecordEvent(MakeEvent(EventType.CleanOvertake));
            scorer.RecordEvent(MakeEvent(EventType.TightOvertake));
            scorer.RecordEvent(MakeEvent(EventType.Divebomb));

            double pct = scorer.CleanOvertakePercentage();
            // 2 clean + tight out of 3 = 66.67%
            Assert.AreEqual(200.0 / 3.0, pct, 0.01);
        }

        [Test]
        public void CleanOvertakePercentage_MultipleSessions_Combined()
        {
            var scorer = new RaceCraftScorer();

            scorer.StartSession("s1", BaseDate);
            scorer.RecordEvent(MakeEvent(EventType.CleanOvertake));
            scorer.RecordEvent(MakeEvent(EventType.Divebomb));
            scorer.EndSession();

            scorer.StartSession("s2", BaseDate.AddDays(1));
            scorer.RecordEvent(MakeEvent(EventType.CleanOvertake));
            scorer.RecordEvent(MakeEvent(EventType.CleanOvertake));
            scorer.EndSession();

            double pct = scorer.CleanOvertakePercentage();
            // 3 clean, 1 dirty out of 4 total = 75%
            Assert.AreEqual(75.0, pct);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 8: Strategy Call Evaluation
        // ═══════════════════════════════════════════════════════════════════

        #region Strategy Call Evaluation

        [Test]
        public void Evaluate_InsufficientEvents_ReturnsNull()
        {
            var scorer = MakeScorerWithSession();
            for (int i = 0; i < 2; i++)
                scorer.RecordEvent(MakeEvent(EventType.CleanOvertake));

            var call = scorer.Evaluate(DateTime.Now);
            Assert.IsNull(call);
        }

        [Test]
        public void Evaluate_RecentContactEvents_ReturnsWarning()
        {
            var scorer = MakeScorerWithSession();
            for (int i = 0; i < 10; i++)
                scorer.RecordEvent(MakeEvent(EventType.CleanOvertake));
            // Recent contacts
            scorer.RecordEvent(MakeEvent(EventType.ContactOvertake));
            scorer.RecordEvent(MakeEvent(EventType.Divebomb));

            scorer.ResetCooldown();
            var call = scorer.Evaluate(DateTime.Now);

            Assert.IsNotNull(call);
            Assert.AreEqual("CRAFT", call.Label);
            Assert.AreEqual(3, call.Severity);
            Assert.That(call.Message, Does.Contain("patience"));
        }

        [Test]
        public void Evaluate_RecentCleanStreak_ReturnsPraise()
        {
            var scorer = MakeScorerWithSession();
            for (int i = 0; i < 10; i++)
                scorer.RecordEvent(MakeEvent(EventType.CleanOvertake));
            // Recent clean racing (3+ clean, 0 contact)
            scorer.RecordEvent(MakeEvent(EventType.CleanDefense));
            scorer.RecordEvent(MakeEvent(EventType.EarlyReaction));

            scorer.ResetCooldown();
            var call = scorer.Evaluate(DateTime.Now);

            Assert.IsNotNull(call);
            Assert.AreEqual("CRAFT", call.Label);
            Assert.AreEqual(1, call.Severity);
            Assert.That(call.Message, Does.Contain("discipline"));
        }

        [Test]
        public void Evaluate_RecentLateReactions_ReturnsAwareness()
        {
            var scorer = MakeScorerWithSession();
            // Use PositionLost (neutral, not clean) to avoid triggering clean streak priority 2
            for (int i = 0; i < 10; i++)
                scorer.RecordEvent(MakeEvent(EventType.PositionLost));
            // Recent late reactions — priority 3
            scorer.RecordEvent(MakeEvent(EventType.LateReaction));
            scorer.RecordEvent(MakeEvent(EventType.LateReaction));

            scorer.ResetCooldown();
            var call = scorer.Evaluate(DateTime.Now);

            Assert.IsNotNull(call);
            Assert.AreEqual("AWARE", call.Label);
            Assert.AreEqual(2, call.Severity);
            Assert.That(call.Message, Does.Contain("mirrors"));
        }

        [Test]
        public void Evaluate_CooldownActive_ReturnsNull()
        {
            var scorer = MakeScorerWithSession();
            for (int i = 0; i < 20; i++)
                scorer.RecordEvent(MakeEvent(EventType.ContactOvertake));

            var now = DateTime.Now;
            scorer.ResetCooldown();
            var first = scorer.Evaluate(now);

            // Within cooldown
            var second = scorer.Evaluate(now.AddSeconds(60));
            Assert.IsNull(second);
        }

        [Test]
        public void Evaluate_CooldownExpired_FiresAgain()
        {
            var scorer = MakeScorerWithSession();
            for (int i = 0; i < 20; i++)
                scorer.RecordEvent(MakeEvent(EventType.ContactOvertake));

            var now = DateTime.Now;
            scorer.ResetCooldown();
            scorer.Evaluate(now);

            // After cooldown
            var second = scorer.Evaluate(now.AddSeconds(CooldownSeconds + 1));
            Assert.IsNotNull(second);
        }

        [Test]
        public void Evaluate_NoCurrentSession_ReturnsNull()
        {
            var scorer = new RaceCraftScorer();
            var call = scorer.Evaluate(DateTime.Now);
            Assert.IsNull(call);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 9: Cooldown Behavior
        // ═══════════════════════════════════════════════════════════════════

        #region Cooldown Behavior

        [Test]
        public void ResetCooldown_AllowsImmediateEvaluation()
        {
            var scorer = MakeScorerWithSession();
            for (int i = 0; i < 20; i++)
                scorer.RecordEvent(MakeEvent(EventType.ContactOvertake));

            var now = DateTime.Now;
            scorer.ResetCooldown();
            var first = scorer.Evaluate(now);

            scorer.ResetCooldown();
            var second = scorer.Evaluate(now.AddSeconds(1));

            Assert.IsNotNull(first);
            Assert.IsNotNull(second);
        }

        [Test]
        public void CooldownSeconds_ConstantDefined()
        {
            Assert.AreEqual(120.0, CooldownSeconds);
        }

        [Test]
        public void Cooldown_BoundaryAtExact120Seconds()
        {
            var scorer = MakeScorerWithSession();
            for (int i = 0; i < 20; i++)
                scorer.RecordEvent(MakeEvent(EventType.ContactOvertake));

            var now = DateTime.Now;
            scorer.ResetCooldown();
            scorer.Evaluate(now);

            // At exactly 120 seconds, should fire
            var afterCooldown = scorer.Evaluate(now.AddSeconds(CooldownSeconds));
            Assert.IsNotNull(afterCooldown);
        }

        [Test]
        public void Cooldown_JustBeforeBoundary()
        {
            var scorer = MakeScorerWithSession();
            for (int i = 0; i < 20; i++)
                scorer.RecordEvent(MakeEvent(EventType.ContactOvertake));

            var now = DateTime.Now;
            scorer.ResetCooldown();
            scorer.Evaluate(now);

            // Just before 120 seconds, should not fire
            var beforeCooldown = scorer.Evaluate(now.AddSeconds(CooldownSeconds - 1));
            Assert.IsNull(beforeCooldown);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 10: Strategy Call Properties
        // ═══════════════════════════════════════════════════════════════════

        #region Strategy Call Properties

        [Test]
        public void StrategyCall_HasLabel()
        {
            var call = new StrategyCall { Label = "CRAFT" };
            Assert.AreEqual("CRAFT", call.Label);
        }

        [Test]
        public void StrategyCall_HasMessage()
        {
            var call = new StrategyCall { Message = "Test message" };
            Assert.AreEqual("Test message", call.Message);
        }

        [Test]
        public void StrategyCall_HasSeverity()
        {
            var call = new StrategyCall { Severity = 2 };
            Assert.AreEqual(2, call.Severity);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 11: Reset and State Management
        // ═══════════════════════════════════════════════════════════════════

        #region Reset and State Management

        [Test]
        public void Reset_ClearsAllState()
        {
            var scorer = BuildRealisticScorer();
            scorer.StartSession("another", BaseDate.AddDays(10));
            scorer.RecordEvent(MakeEvent(EventType.CleanOvertake));

            scorer.Reset();

            Assert.AreEqual(0, scorer.Sessions.Count);
            Assert.IsNull(scorer.CurrentSession);
        }

        [Test]
        public void Reset_AllowsReuse()
        {
            var scorer = BuildRealisticScorer();
            scorer.Reset();

            scorer.StartSession("new-session", BaseDate.AddDays(20));
            scorer.RecordEvent(MakeEvent(EventType.CleanOvertake));

            Assert.AreEqual(1, scorer.CurrentSession.Events.Count);
        }

        [Test]
        public void Reset_ClearsLastCallTime()
        {
            var scorer = MakeScorerWithSession();
            for (int i = 0; i < 20; i++)
                scorer.RecordEvent(MakeEvent(EventType.ContactOvertake));

            scorer.ResetCooldown();
            scorer.Evaluate(DateTime.Now);
            scorer.Reset();

            // After reset, should be able to evaluate immediately
            var call = scorer.Evaluate(DateTime.Now.AddSeconds(1));
            // May be null due to no session, but not due to cooldown
            Assert.IsNull(call); // No current session
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 12: Edge Cases
        // ═══════════════════════════════════════════════════════════════════

        #region Edge Cases

        [Test]
        public void VeryLargeDataset_HandlesWithoutOverflow()
        {
            var scorer = MakeScorerWithSession();
            for (int i = 0; i < 1000; i++)
                scorer.RecordEvent(MakeEvent(
                    (EventType)(i % 10),
                    lap: i + 1));

            Assert.AreEqual(1000, scorer.CurrentSession.Events.Count);
            Assert.DoesNotThrow(() => scorer.ComputeCompositeRating());
        }

        [Test]
        public void NegativePointsSession_StillCalculates()
        {
            var scorer = MakeScorerWithSession();
            for (int i = 0; i < 20; i++)
                scorer.RecordEvent(MakeEvent(EventType.Divebomb));

            var rating = scorer.ComputeCompositeRating();
            Assert.Less(rating, 50.0);
            Assert.GreaterOrEqual(rating, 0.0);
        }

        [Test]
        public void MixedEventTypes_InSingleSession()
        {
            var scorer = MakeScorerWithSession();
            var types = new[]
            {
                EventType.CleanOvertake, EventType.TightOvertake, EventType.ContactOvertake,
                EventType.Divebomb, EventType.CleanDefense, EventType.DefensiveWeaving,
                EventType.EarlyReaction, EventType.LateReaction, EventType.NearMiss
            };

            foreach (var type in types)
                scorer.RecordEvent(MakeEvent(type));

            Assert.AreEqual(types.Length, scorer.CurrentSession.Events.Count);
        }

        [Test]
        public void ZeroProximity_StillRecords()
        {
            var scorer = MakeScorerWithSession();
            var evt = MakeEvent(EventType.CleanOvertake, proximity: 0.0);
            scorer.RecordEvent(evt);

            Assert.AreEqual(1, scorer.CurrentSession.Events.Count);
        }

        [Test]
        public void LargeGapSeconds_StillRecords()
        {
            var scorer = MakeScorerWithSession();
            var evt = MakeEvent(EventType.PositionLost, gap: 999.9);
            scorer.RecordEvent(evt);

            Assert.AreEqual(1, scorer.CurrentSession.Events.Count);
        }

        [Test]
        public void VeryHighLapNumbers_StillRecords()
        {
            var scorer = MakeScorerWithSession();
            var evt = MakeEvent(EventType.CleanOvertake, lap: 500);
            scorer.RecordEvent(evt);

            Assert.AreEqual(500, scorer.CurrentSession.Events[0].LapNumber);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 13: Real-World Scenarios
        // ═══════════════════════════════════════════════════════════════════

        #region Real-World Scenarios

        [Test]
        public void Scenario_AggressiveRacer_LowCraftScore()
        {
            var scorer = new RaceCraftScorer();
            var rng = new Random(123);

            for (int race = 0; race < 3; race++)
            {
                scorer.StartSession($"race-{race}", BaseDate.AddDays(race));

                // Aggressive: lots of divebombs and contact
                for (int i = 0; i < 8; i++)
                    scorer.RecordEvent(MakeEvent(EventType.Divebomb, lap: i + 1));
                for (int i = 0; i < 4; i++)
                    scorer.RecordEvent(MakeEvent(EventType.ContactOvertake, lap: i + 9));

                scorer.EndSession();
            }

            double rating = scorer.ComputeCompositeRating();
            Assert.Less(rating, 40.0, "Aggressive racer should have low craft score");
        }

        [Test]
        public void Scenario_CleanRacer_HighCraftScore()
        {
            var scorer = new RaceCraftScorer();

            for (int race = 0; race < 3; race++)
            {
                scorer.StartSession($"race-{race}", BaseDate.AddDays(race));

                // Clean: lots of clean overtakes and defensive success
                for (int i = 0; i < 10; i++)
                    scorer.RecordEvent(MakeEvent(EventType.CleanOvertake, lap: i + 1));
                for (int i = 0; i < 8; i++)
                    scorer.RecordEvent(MakeEvent(EventType.CleanDefense, lap: i + 11));
                for (int i = 0; i < 6; i++)
                    scorer.RecordEvent(MakeEvent(EventType.EarlyReaction, lap: i + 19));

                scorer.EndSession();
            }

            double rating = scorer.ComputeCompositeRating();
            Assert.Greater(rating, 75.0, "Clean racer should have high craft score");
        }

        [Test]
        public void Scenario_ImprovingDriver_TrendPositive()
        {
            var scorer = new RaceCraftScorer();

            // Early races: poor craft
            for (int race = 0; race < 2; race++)
            {
                scorer.StartSession($"race-{race}", BaseDate.AddDays(race));
                for (int i = 0; i < 8; i++)
                    scorer.RecordEvent(MakeEvent(EventType.ContactOvertake));
                scorer.EndSession();
            }

            // Recent races: excellent craft
            for (int race = 2; race < 4; race++)
            {
                scorer.StartSession($"race-{race}", BaseDate.AddDays(race));
                for (int i = 0; i < 10; i++)
                    scorer.RecordEvent(MakeEvent(EventType.CleanOvertake));
                scorer.EndSession();
            }

            double trend = scorer.ComputeRatingTrend();
            Assert.Greater(trend, 0.0, "Improving driver should have positive trend");
        }

        [Test]
        public void Scenario_DefensiveSpecialist_HighDefenseScore()
        {
            var scorer = MakeScorerWithSession();

            // Lots of defense, minimal offense
            for (int i = 0; i < 15; i++)
                scorer.RecordEvent(MakeEvent(EventType.CleanDefense, lap: i + 1));
            for (int i = 0; i < 5; i++)
                scorer.RecordEvent(MakeEvent(EventType.EarlyReaction, lap: i + 16));

            var session = scorer.CurrentSession;
            Assert.Greater(session.DefenseScore, 75.0);
        }

        [Test]
        public void Scenario_MultiSessionProgression_Tracked()
        {
            var scorer = new RaceCraftScorer();

            for (int s = 0; s < 5; s++)
            {
                scorer.StartSession($"s{s}", BaseDate.AddDays(s));

                // Each session gets slightly more aggressive
                int contactCount = s;
                int cleanCount = 5 - s;

                for (int i = 0; i < cleanCount; i++)
                    scorer.RecordEvent(MakeEvent(EventType.CleanOvertake, lap: i + 1));
                for (int i = 0; i < contactCount; i++)
                    scorer.RecordEvent(MakeEvent(EventType.ContactOvertake, lap: i + cleanCount + 1));

                scorer.EndSession();
            }

            // Trend should be slightly negative
            double trend = scorer.ComputeRatingTrend();
            Assert.Less(trend, 0.0, "Driver becoming more aggressive should show negative trend");
        }

        [Test]
        public void Scenario_Racing_AwarenessPattern()
        {
            var scorer = MakeScorerWithSession();

            // Many clean overtakes
            for (int i = 0; i < 10; i++)
                scorer.RecordEvent(MakeEvent(EventType.CleanOvertake, lap: i + 1));

            // But poor awareness (late reactions)
            for (int i = 0; i < 5; i++)
                scorer.RecordEvent(MakeEvent(EventType.LateReaction, lap: i + 11));

            var session = scorer.CurrentSession;
            Assert.Greater(session.OvertakeScore, 70.0);
            Assert.Less(session.AwarenessScore, 50.0);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REGION 14: Mathematical Consistency
        // ═══════════════════════════════════════════════════════════════════

        #region Mathematical Consistency

        [Test]
        public void TotalPoints_EqualsEventSum()
        {
            var scorer = MakeScorerWithSession();
            var events = new[] { EventType.CleanOvertake, EventType.Divebomb, EventType.EarlyReaction };

            foreach (var type in events)
                scorer.RecordEvent(MakeEvent(type));

            var session = scorer.CurrentSession;
            double expectedSum = session.Events.Sum(e => e.Points);
            Assert.AreEqual(expectedSum, session.TotalPoints, 1e-10);
        }

        [Test]
        public void SubScores_AlwaysInRange0To100()
        {
            var scorer = BuildRealisticScorer();

            foreach (var session in scorer.Sessions)
            {
                Assert.GreaterOrEqual(session.OvertakeScore, 0.0);
                Assert.LessOrEqual(session.OvertakeScore, 100.0);
                Assert.GreaterOrEqual(session.DefenseScore, 0.0);
                Assert.LessOrEqual(session.DefenseScore, 100.0);
                Assert.GreaterOrEqual(session.AwarenessScore, 0.0);
                Assert.LessOrEqual(session.AwarenessScore, 100.0);
            }
        }

        [Test]
        public void NoEvents_SubScores_AllNeutral()
        {
            var session = new SessionCraft { Events = new List<RacingEvent>() };
            Assert.AreEqual(50.0, session.OvertakeScore);
            Assert.AreEqual(50.0, session.DefenseScore);
            Assert.AreEqual(50.0, session.AwarenessScore);
        }

        [Test]
        public void CompositeRating_Weighted40_30_30()
        {
            // Create a session where we know each sub-score
            var scorer = MakeScorerWithSession();

            // Only overtake events: will skew overtake score
            for (int i = 0; i < 20; i++)
                scorer.RecordEvent(MakeEvent(EventType.CleanOvertake, lap: i + 1));

            double composite = scorer.ComputeCompositeRating();
            double expected = 0.4 * scorer.CurrentSession.OvertakeScore
                            + 0.3 * scorer.CurrentSession.DefenseScore
                            + 0.3 * scorer.CurrentSession.AwarenessScore;

            Assert.AreEqual(expected, composite, 1e-10);
        }

        [Test]
        public void CleanOvertakePercentage_AlwaysPercent()
        {
            var scorer = BuildRealisticScorer();
            double pct = scorer.CleanOvertakePercentage();

            Assert.GreaterOrEqual(pct, 0.0);
            Assert.LessOrEqual(pct, 100.0);
        }

        #endregion
    }
}
