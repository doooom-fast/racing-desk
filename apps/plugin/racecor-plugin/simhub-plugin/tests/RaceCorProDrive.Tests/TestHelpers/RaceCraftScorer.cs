using System;
using System.Collections.Generic;
using System.Linq;

namespace RaceCorProDrive.Tests.TestHelpers
{
    /// <summary>
    /// Race craft scoring engine.
    ///
    /// Measures *how* a driver races — distinct from speed (iRating) and
    /// cleanliness (Safety Rating). Components:
    ///   1. Overtake quality score (clean passes vs divebombs)
    ///   2. Defensive driving score (holding position cleanly)
    ///   3. Race awareness index (reaction to nearby cars)
    ///   4. Composite race craft rating (single number 0-100)
    ///
    /// Standalone reimplementation for testing — no SimHub dependencies.
    /// Reuses StrategyCall from SolarGlareAnalyzer.cs (same namespace).
    /// </summary>
    public class RaceCraftScorer
    {
        // ═══════════════════════════════════════════════════════════════════
        //  CONSTANTS
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>Points for a clean overtake (no incident, no proximity warning).</summary>
        public const double CleanOvertakePoints = 2.0;

        /// <summary>Points for an overtake with proximity warning but no contact.</summary>
        public const double TightOvertakePoints = 1.0;

        /// <summary>Points deducted for an overtake with contact.</summary>
        public const double ContactOvertakePoints = -3.0;

        /// <summary>Points deducted for a divebomb (late lunge with very close proximity).</summary>
        public const double DivebombPoints = -4.0;

        /// <summary>Points for each lap defending successfully (held position, no incident).</summary>
        public const double CleanDefensePoints = 1.5;

        /// <summary>Points deducted for defensive weaving.</summary>
        public const double WeavingPenalty = -2.0;

        /// <summary>Points for early reaction to nearby cars (gave space proactively).</summary>
        public const double AwarenessPoints = 1.0;

        /// <summary>Points deducted for late reaction (near-miss or surprised by car alongside).</summary>
        public const double LateReactionPenalty = -1.5;

        /// <summary>Minimum events before a meaningful craft score can be computed.</summary>
        public const int MinEvents = 5;

        /// <summary>Minimum proximity (seconds gap) that counts as "racing nearby".</summary>
        public const double ProximityThreshold = 2.0;

        /// <summary>Cooldown between craft calls in seconds.</summary>
        public const double CooldownSeconds = 120.0;

        // ═══════════════════════════════════════════════════════════════════
        //  RACING EVENT TYPES
        // ═══════════════════════════════════════════════════════════════════

        public enum EventType
        {
            CleanOvertake,
            TightOvertake,
            ContactOvertake,
            Divebomb,
            CleanDefense,
            DefensiveWeaving,
            EarlyReaction,
            LateReaction,
            PositionLost,
            NearMiss
        }

        // ═══════════════════════════════════════════════════════════════════
        //  RACING EVENT
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>A single race craft event.</summary>
        public class RacingEvent
        {
            public EventType Type { get; set; }
            public int LapNumber { get; set; }
            public DateTime Timestamp { get; set; }
            public string OpponentName { get; set; } = "";
            public double GapSeconds { get; set; }
            public double ClosestProximitySeconds { get; set; }
            public string SessionId { get; set; } = "";

            public double Points => Type switch
            {
                EventType.CleanOvertake => CleanOvertakePoints,
                EventType.TightOvertake => TightOvertakePoints,
                EventType.ContactOvertake => ContactOvertakePoints,
                EventType.Divebomb => DivebombPoints,
                EventType.CleanDefense => CleanDefensePoints,
                EventType.DefensiveWeaving => WeavingPenalty,
                EventType.EarlyReaction => AwarenessPoints,
                EventType.LateReaction => LateReactionPenalty,
                EventType.PositionLost => 0.0, // Neutral — losing position isn't bad craft
                EventType.NearMiss => -0.5,
                _ => 0.0
            };
        }

        // ═══════════════════════════════════════════════════════════════════
        //  RACE SESSION SUMMARY
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>Craft score breakdown for a single race session.</summary>
        public class SessionCraft
        {
            public string SessionId { get; set; } = "";
            public DateTime RaceDate { get; set; }
            public List<RacingEvent> Events { get; set; } = new List<RacingEvent>();

            public double OvertakeScore => ComputeSubScore(Events, new[]
            {
                EventType.CleanOvertake, EventType.TightOvertake,
                EventType.ContactOvertake, EventType.Divebomb
            });

            public double DefenseScore => ComputeSubScore(Events, new[]
            {
                EventType.CleanDefense, EventType.DefensiveWeaving
            });

            public double AwarenessScore => ComputeSubScore(Events, new[]
            {
                EventType.EarlyReaction, EventType.LateReaction, EventType.NearMiss
            });

            public double TotalPoints => Events.Sum(e => e.Points);

            public int CleanOvertakes => Events.Count(e => e.Type == EventType.CleanOvertake);
            public int DirtyOvertakes => Events.Count(e =>
                e.Type == EventType.ContactOvertake || e.Type == EventType.Divebomb);

            private static double ComputeSubScore(List<RacingEvent> events, EventType[] types)
            {
                var relevant = events.Where(e => types.Contains(e.Type)).ToList();
                if (relevant.Count == 0) return 50.0; // Neutral
                double points = relevant.Sum(e => e.Points);
                // Normalize: 50 = neutral, 0 = terrible, 100 = perfect
                return Math.Max(0, Math.Min(100, 50.0 + points * 10.0));
            }
        }

        // ═══════════════════════════════════════════════════════════════════
        //  STATE
        // ═══════════════════════════════════════════════════════════════════

        private readonly List<SessionCraft> _sessions = new List<SessionCraft>();
        private SessionCraft _currentSession;
        private DateTime _lastCallTime = DateTime.MinValue;

        public IReadOnlyList<SessionCraft> Sessions => _sessions;
        public SessionCraft CurrentSession => _currentSession;

        // ═══════════════════════════════════════════════════════════════════
        //  SESSION MANAGEMENT
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>Starts a new race session for craft tracking.</summary>
        public void StartSession(string sessionId, DateTime raceDate)
        {
            if (_currentSession != null && _currentSession.Events.Count > 0)
                _sessions.Add(_currentSession);

            _currentSession = new SessionCraft
            {
                SessionId = sessionId,
                RaceDate = raceDate
            };
        }

        /// <summary>Ends the current session and archives it.</summary>
        public void EndSession()
        {
            if (_currentSession != null)
            {
                _sessions.Add(_currentSession);
                _currentSession = null;
            }
        }

        // ═══════════════════════════════════════════════════════════════════
        //  EVENT RECORDING
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>Records a racing event in the current session.</summary>
        public void RecordEvent(RacingEvent evt)
        {
            if (evt == null) return;
            if (_currentSession == null)
                StartSession(Guid.NewGuid().ToString("N"), DateTime.Now);

            _currentSession.Events.Add(evt);
        }

        /// <summary>Convenience: record a clean overtake.</summary>
        public void RecordCleanOvertake(int lap, string opponent, double closestGap = 0.8)
        {
            RecordEvent(new RacingEvent
            {
                Type = EventType.CleanOvertake,
                LapNumber = lap,
                Timestamp = DateTime.Now,
                OpponentName = opponent,
                ClosestProximitySeconds = closestGap
            });
        }

        /// <summary>Convenience: record a contact overtake.</summary>
        public void RecordContactOvertake(int lap, string opponent)
        {
            RecordEvent(new RacingEvent
            {
                Type = EventType.ContactOvertake,
                LapNumber = lap,
                Timestamp = DateTime.Now,
                OpponentName = opponent,
                ClosestProximitySeconds = 0.0
            });
        }

        // ═══════════════════════════════════════════════════════════════════
        //  COMPOSITE RATING
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>
        /// Computes the composite race craft rating (0-100).
        ///
        /// Weighted: 40% overtake quality, 30% defense, 30% awareness.
        /// Averaged across all sessions with events.
        /// </summary>
        public double ComputeCompositeRating()
        {
            var allEvents = _sessions.SelectMany(s => s.Events).ToList();
            if (_currentSession != null)
                allEvents.AddRange(_currentSession.Events);

            if (allEvents.Count < MinEvents) return 50.0; // Neutral for insufficient data

            var combined = new SessionCraft { Events = allEvents };
            return 0.4 * combined.OvertakeScore
                 + 0.3 * combined.DefenseScore
                 + 0.3 * combined.AwarenessScore;
        }

        /// <summary>
        /// Computes the rating trend (recent sessions vs early sessions).
        /// Positive = improving.
        /// </summary>
        public double ComputeRatingTrend()
        {
            if (_sessions.Count < 4) return 0.0;

            int half = _sessions.Count / 2;
            var early = _sessions.Take(half)
                .Where(s => s.Events.Count > 0)
                .Select(s => s.TotalPoints / Math.Max(1, s.Events.Count))
                .ToList();
            var recent = _sessions.Skip(half)
                .Where(s => s.Events.Count > 0)
                .Select(s => s.TotalPoints / Math.Max(1, s.Events.Count))
                .ToList();

            if (early.Count == 0 || recent.Count == 0) return 0.0;
            return recent.Average() - early.Average();
        }

        // ═══════════════════════════════════════════════════════════════════
        //  OVERTAKE ANALYSIS
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>
        /// Computes the clean overtake percentage across all sessions.
        /// Returns 0-100%.
        /// </summary>
        public double CleanOvertakePercentage()
        {
            var overtakes = GetAllEvents()
                .Where(e => e.Type == EventType.CleanOvertake
                         || e.Type == EventType.TightOvertake
                         || e.Type == EventType.ContactOvertake
                         || e.Type == EventType.Divebomb)
                .ToList();

            if (overtakes.Count == 0) return 100.0;

            int clean = overtakes.Count(e =>
                e.Type == EventType.CleanOvertake || e.Type == EventType.TightOvertake);
            return 100.0 * clean / overtakes.Count;
        }

        // ═══════════════════════════════════════════════════════════════════
        //  STRATEGY CALL EVALUATION
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>
        /// Evaluates whether a craft-related strategy call should fire.
        /// </summary>
        public StrategyCall Evaluate(DateTime now)
        {
            if ((now - _lastCallTime).TotalSeconds < CooldownSeconds) return null;
            if (_currentSession == null) return null;
            if (_currentSession.Events.Count < 3) return null;

            var events = _currentSession.Events;
            int recentCount = Math.Min(5, events.Count);
            var recent = events.Skip(events.Count - recentCount).ToList();

            // Priority 1: Multiple contact events recently
            int recentContacts = recent.Count(e =>
                e.Type == EventType.ContactOvertake || e.Type == EventType.Divebomb);
            if (recentContacts >= 2)
            {
                _lastCallTime = now;
                return new StrategyCall
                {
                    Label = "CRAFT",
                    Message = "Multiple contact passes — patience will gain you more positions than aggression.",
                    Severity = 3,
                    DisplayedAt = now
                };
            }

            // Priority 2: Clean racing streak (positive)
            int recentClean = recent.Count(e =>
                e.Type == EventType.CleanOvertake || e.Type == EventType.CleanDefense
                || e.Type == EventType.EarlyReaction);
            if (recentClean >= 3 && recentContacts == 0)
            {
                _lastCallTime = now;
                return new StrategyCall
                {
                    Label = "CRAFT",
                    Message = "Clean racing — good race craft this stint. Keep the discipline.",
                    Severity = 1,
                    DisplayedAt = now
                };
            }

            // Priority 3: Late reactions pattern
            int lateReactions = recent.Count(e => e.Type == EventType.LateReaction);
            if (lateReactions >= 2)
            {
                _lastCallTime = now;
                return new StrategyCall
                {
                    Label = "AWARE",
                    Message = "Check mirrors more often — you've had multiple late reactions to nearby cars.",
                    Severity = 2,
                    DisplayedAt = now
                };
            }

            return null;
        }

        // ═══════════════════════════════════════════════════════════════════
        //  HELPERS
        // ═══════════════════════════════════════════════════════════════════

        private List<RacingEvent> GetAllEvents()
        {
            var all = _sessions.SelectMany(s => s.Events).ToList();
            if (_currentSession != null)
                all.AddRange(_currentSession.Events);
            return all;
        }

        /// <summary>Resets cooldown (for testing).</summary>
        public void ResetCooldown() => _lastCallTime = DateTime.MinValue;

        /// <summary>Resets all state (for testing).</summary>
        public void Reset()
        {
            _sessions.Clear();
            _currentSession = null;
            _lastCallTime = DateTime.MinValue;
        }
    }
}
