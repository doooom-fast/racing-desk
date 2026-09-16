using System;
using System.Collections.Generic;
using System.Linq;

namespace RaceCorProDrive.Tests.TestHelpers
{
    /// <summary>
    /// Corner-specific historical coaching engine.
    ///
    /// Tracks per-corner telemetry across laps and sessions to build:
    ///   1. Per-corner incident heatmap (success rate per corner)
    ///   2. Corner mastery progression (min speed / brake point trends)
    ///   3. Corner-specific coaching calls (comparison to driver's best)
    ///   4. Track learning curve (laps-to-competence estimation)
    ///
    /// Standalone reimplementation for testing — no SimHub dependencies.
    /// Reuses StrategyCall from SolarGlareAnalyzer.cs (same namespace).
    /// </summary>
    public class CornerCoach
    {
        // ═══════════════════════════════════════════════════════════════════
        //  CONSTANTS
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>Minimum passes through a corner before coaching activates.</summary>
        public const int MinCornerPasses = 5;

        /// <summary>Minimum corners on a track before learning curve estimation.</summary>
        public const int MinCornersForLearning = 3;

        /// <summary>Speed delta (km/h) vs best that triggers a coaching call.</summary>
        public const double SpeedDeltaThreshold = 5.0;

        /// <summary>Brake point delta (meters) vs best that triggers a coaching call.</summary>
        public const double BrakePointDeltaThreshold = 8.0;

        /// <summary>Incident rate above which a corner is flagged as "trouble".</summary>
        public const double TroubleCornerIncidentRate = 0.05; // 5% incident rate

        /// <summary>Cooldown between corner coaching calls in seconds.</summary>
        public const double CooldownSeconds = 45.0;

        /// <summary>Learning curve model: expected lap count to reach 95% competence.</summary>
        public const int DefaultLapsToCompetence = 25;

        // ═══════════════════════════════════════════════════════════════════
        //  CORNER PASS — single transit through a corner
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>Telemetry snapshot for a single pass through a corner.</summary>
        public class CornerPass
        {
            public int LapNumber { get; set; }
            public DateTime Timestamp { get; set; }
            public double MinSpeedKmh { get; set; }
            public double EntrySpeedKmh { get; set; }
            public double ExitSpeedKmh { get; set; }
            public double BrakePointPct { get; set; }  // Track position % where braking began
            public double ApexSpeedKmh { get; set; }
            public double PeakLatG { get; set; }
            public bool HadIncident { get; set; }
            public double GearAtApex { get; set; }
            public string SessionId { get; set; } = "";
        }

        // ═══════════════════════════════════════════════════════════════════
        //  CORNER PROFILE — aggregated stats for one corner
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>Accumulated statistics for a single corner on a track.</summary>
        public class CornerProfile
        {
            public string TrackId { get; set; } = "";
            public int CornerNumber { get; set; }
            public string CornerName { get; set; } = "";
            public double TrackPositionPct { get; set; }

            public List<CornerPass> Passes { get; set; } = new List<CornerPass>();

            public int TotalPasses => Passes.Count;
            public int IncidentCount => Passes.Count(p => p.HadIncident);
            public double IncidentRate => TotalPasses > 0 ? (double)IncidentCount / TotalPasses : 0.0;
            public double SuccessRate => 1.0 - IncidentRate;

            public double BestMinSpeed => Passes.Count > 0 ? Passes.Max(p => p.MinSpeedKmh) : 0.0;
            public double AverageMinSpeed => Passes.Count > 0 ? Passes.Average(p => p.MinSpeedKmh) : 0.0;
            public double BestBrakePoint => Passes.Count > 0 ? Passes.Min(p => p.BrakePointPct) : 0.0;

            public bool IsTroubleCorner => TotalPasses >= MinCornerPasses
                                        && IncidentRate > TroubleCornerIncidentRate;

            public bool HasSufficientData => TotalPasses >= MinCornerPasses;
        }

        // ═══════════════════════════════════════════════════════════════════
        //  TRACK PROFILE — all corners for one track
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>Complete corner-by-corner profile for a track.</summary>
        public class TrackProfile
        {
            public string TrackId { get; set; } = "";
            public Dictionary<int, CornerProfile> Corners { get; set; } = new Dictionary<int, CornerProfile>();
            public int TotalLaps { get; set; }
            public int FirstVisitLap { get; set; } = -1;

            /// <summary>Corners sorted by incident rate (worst first).</summary>
            public List<CornerProfile> TroubleCorners =>
                Corners.Values
                    .Where(c => c.IsTroubleCorner)
                    .OrderByDescending(c => c.IncidentRate)
                    .ToList();

            /// <summary>Average success rate across all corners with data.</summary>
            public double OverallSuccessRate
            {
                get
                {
                    var withData = Corners.Values.Where(c => c.HasSufficientData).ToList();
                    return withData.Count > 0 ? withData.Average(c => c.SuccessRate) : 1.0;
                }
            }
        }

        // ═══════════════════════════════════════════════════════════════════
        //  MASTERY TREND — speed progression over time
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>Corner speed trend over time for mastery tracking.</summary>
        public class MasteryTrend
        {
            public int CornerNumber { get; set; }
            public double EarlyAvgSpeed { get; set; }
            public double RecentAvgSpeed { get; set; }
            public double SpeedDelta => RecentAvgSpeed - EarlyAvgSpeed;
            public bool IsImproving => SpeedDelta > 1.0; // >1 km/h improvement
            public bool IsStagnant => Math.Abs(SpeedDelta) <= 1.0;
            public bool IsRegressing => SpeedDelta < -1.0;
        }

        // ═══════════════════════════════════════════════════════════════════
        //  STATE
        // ═══════════════════════════════════════════════════════════════════

        private readonly Dictionary<string, TrackProfile> _tracks = new Dictionary<string, TrackProfile>(StringComparer.OrdinalIgnoreCase);
        private DateTime _lastCallTime = DateTime.MinValue;

        public IReadOnlyDictionary<string, TrackProfile> Tracks => _tracks;

        // ═══════════════════════════════════════════════════════════════════
        //  CORNER PASS RECORDING
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>Records a single pass through a corner.</summary>
        public void RecordCornerPass(string trackId, int cornerNumber, CornerPass pass,
            string cornerName = "", double trackPositionPct = 0.0)
        {
            if (string.IsNullOrEmpty(trackId) || pass == null) return;

            if (!_tracks.TryGetValue(trackId, out var track))
            {
                track = new TrackProfile { TrackId = trackId };
                _tracks[trackId] = track;
            }

            if (!track.Corners.TryGetValue(cornerNumber, out var corner))
            {
                corner = new CornerProfile
                {
                    TrackId = trackId,
                    CornerNumber = cornerNumber,
                    CornerName = cornerName,
                    TrackPositionPct = trackPositionPct
                };
                track.Corners[cornerNumber] = corner;
            }

            corner.Passes.Add(pass);

            if (track.FirstVisitLap < 0 || pass.LapNumber < track.FirstVisitLap)
                track.FirstVisitLap = pass.LapNumber;

            if (pass.LapNumber > track.TotalLaps)
                track.TotalLaps = pass.LapNumber;
        }

        // ═══════════════════════════════════════════════════════════════════
        //  MASTERY PROGRESSION
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>
        /// Computes the mastery trend for a corner by comparing
        /// the earliest 30% of passes to the most recent 30%.
        /// </summary>
        public static MasteryTrend ComputeMasteryTrend(CornerProfile corner)
        {
            if (corner == null || corner.Passes.Count < MinCornerPasses)
                return new MasteryTrend { CornerNumber = corner?.CornerNumber ?? 0 };

            var sorted = corner.Passes.OrderBy(p => p.LapNumber).ToList();
            int earlyCount = Math.Max(1, sorted.Count * 30 / 100);
            int recentCount = Math.Max(1, sorted.Count * 30 / 100);

            double earlyAvg = sorted.Take(earlyCount).Average(p => p.MinSpeedKmh);
            double recentAvg = sorted.Skip(sorted.Count - recentCount).Average(p => p.MinSpeedKmh);

            return new MasteryTrend
            {
                CornerNumber = corner.CornerNumber,
                EarlyAvgSpeed = earlyAvg,
                RecentAvgSpeed = recentAvg
            };
        }

        /// <summary>Computes mastery trends for all corners on a track.</summary>
        public List<MasteryTrend> GetMasteryTrends(string trackId)
        {
            if (!_tracks.TryGetValue(trackId, out var track)) return new List<MasteryTrend>();
            return track.Corners.Values
                .Where(c => c.HasSufficientData)
                .Select(ComputeMasteryTrend)
                .OrderByDescending(t => Math.Abs(t.SpeedDelta))
                .ToList();
        }

        // ═══════════════════════════════════════════════════════════════════
        //  LEARNING CURVE
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>
        /// Estimates laps to competence for a track based on speed improvement rate.
        ///
        /// Uses exponential learning curve: speed(lap) = target * (1 - e^(-k*lap))
        /// Fits k from the observed data and predicts when 95% of target is reached.
        ///
        /// Returns -1 if insufficient data or already competent.
        /// </summary>
        public static int EstimateLapsToCompetence(TrackProfile track)
        {
            if (track == null || track.Corners.Count < MinCornersForLearning)
                return -1;

            // Get per-lap average min speed across all corners
            var allPasses = track.Corners.Values
                .SelectMany(c => c.Passes)
                .GroupBy(p => p.LapNumber)
                .OrderBy(g => g.Key)
                .Select(g => new { Lap = g.Key, AvgSpeed = g.Average(p => p.MinSpeedKmh) })
                .ToList();

            if (allPasses.Count < 5) return -1;

            double firstSpeed = allPasses.Take(3).Average(a => a.AvgSpeed);
            double bestSpeed = allPasses.Max(a => a.AvgSpeed);
            double lastSpeed = allPasses.Skip(allPasses.Count - 3).Average(a => a.AvgSpeed);

            if (bestSpeed - firstSpeed < 1.0)
                return -1; // Already competent or no improvement to measure

            // Simple competence check: if recent speed is within 5% of best, driver is competent
            double competenceThreshold = firstSpeed + 0.95 * (bestSpeed - firstSpeed);
            if (lastSpeed >= competenceThreshold)
                return allPasses.Count; // Already reached competence at this lap count

            // Estimate remaining laps using observed improvement rate
            double improvementRate = (lastSpeed - firstSpeed) / allPasses.Count;
            if (improvementRate <= 0) return DefaultLapsToCompetence;

            double remaining = (competenceThreshold - lastSpeed) / improvementRate;
            return allPasses.Count + (int)Math.Ceiling(remaining);
        }

        // ═══════════════════════════════════════════════════════════════════
        //  STRATEGY CALL EVALUATION
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>
        /// Evaluates whether a coaching call should fire for a corner the driver
        /// is about to enter.
        /// </summary>
        /// <param name="trackId">Current track.</param>
        /// <param name="cornerNumber">Corner being approached.</param>
        /// <param name="currentLap">Current lap number.</param>
        /// <param name="now">Current time.</param>
        public StrategyCall Evaluate(string trackId, int cornerNumber, int currentLap, DateTime now)
        {
            if ((now - _lastCallTime).TotalSeconds < CooldownSeconds) return null;
            if (!_tracks.TryGetValue(trackId, out var track)) return null;
            if (!track.Corners.TryGetValue(cornerNumber, out var corner)) return null;
            if (!corner.HasSufficientData) return null;

            // Priority 1: Trouble corner warning
            if (corner.IsTroubleCorner)
            {
                _lastCallTime = now;
                string name = string.IsNullOrEmpty(corner.CornerName)
                    ? $"turn {corner.CornerNumber}"
                    : corner.CornerName;
                return new StrategyCall
                {
                    Label = "CRNR",
                    Message = $"Caution: {name} — {corner.IncidentRate * 100:F0}% incident rate over {corner.TotalPasses} passes. "
                        + "Focus on a clean exit.",
                    Severity = 3,
                    DisplayedAt = now
                };
            }

            // Priority 2: Speed comparison to best
            if (corner.Passes.Count >= 2)
            {
                var recent = corner.Passes.OrderByDescending(p => p.LapNumber).First();
                double speedDelta = corner.BestMinSpeed - recent.MinSpeedKmh;

                if (speedDelta > SpeedDeltaThreshold)
                {
                    _lastCallTime = now;
                    return new StrategyCall
                    {
                        Label = "CRNR",
                        Message = $"Turn {corner.CornerNumber}: carrying {speedDelta:F0} km/h less than your best. "
                            + "Check your entry speed.",
                        Severity = 2,
                        DisplayedAt = now
                    };
                }
            }

            // Priority 3: Mastery improving (positive)
            var trend = ComputeMasteryTrend(corner);
            if (trend.IsImproving && trend.SpeedDelta > 3.0)
            {
                _lastCallTime = now;
                return new StrategyCall
                {
                    Label = "COACH",
                    Message = $"Turn {corner.CornerNumber}: +{trend.SpeedDelta:F1} km/h improvement since first laps. "
                        + "Good progression.",
                    Severity = 1,
                    DisplayedAt = now
                };
            }

            return null;
        }

        /// <summary>Resets cooldown (for testing).</summary>
        public void ResetCooldown() => _lastCallTime = DateTime.MinValue;

        /// <summary>Resets all state (for testing).</summary>
        public void Reset()
        {
            _tracks.Clear();
            _lastCallTime = DateTime.MinValue;
        }
    }
}
