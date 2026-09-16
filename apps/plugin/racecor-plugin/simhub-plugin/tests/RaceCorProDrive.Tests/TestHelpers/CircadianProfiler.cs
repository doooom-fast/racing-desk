using System;
using System.Collections.Generic;
using System.Linq;

namespace RaceCorProDrive.Tests.TestHelpers
{
    /// <summary>
    /// Builds a personal circadian performance profile from historical session data.
    ///
    /// Tracks lap times, incident rates, and iRating deltas bucketed by hour-of-day
    /// over weeks/months. Detects peak performance windows and danger hours.
    /// Fires strategy calls when the driver is racing outside their optimal window.
    ///
    /// Based on sleep-lab research showing 9-34% cognitive performance variation
    /// by time of day, modulated by individual chronotype.
    ///
    /// Standalone reimplementation for testing — no SimHub dependencies.
    /// Reuses StrategyCall from SolarGlareAnalyzer.cs (same namespace).
    /// </summary>
    public class CircadianProfiler
    {
        // ═══════════════════════════════════════════════════════════════════
        //  CONSTANTS
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>Number of hourly buckets (0-23).</summary>
        public const int HourBuckets = 24;

        /// <summary>Minimum sessions in an hour bucket before it's statistically meaningful.</summary>
        public const int MinSessionsPerBucket = 3;

        /// <summary>Minimum total sessions before any profiling is attempted.</summary>
        public const int MinTotalSessions = 10;

        /// <summary>
        /// Incident rate multiplier threshold for "danger hours".
        /// If an hour's incident rate exceeds the driver's median by this factor,
        /// it's flagged as a danger hour.
        /// </summary>
        public const double DangerIncidentMultiplier = 1.8;

        /// <summary>
        /// Lap time delta (seconds) above the driver's best-hour average that
        /// defines "off-peak" performance.
        /// </summary>
        public const double OffPeakLapTimeDelta = 0.3;

        /// <summary>Cooldown between circadian calls in seconds.</summary>
        public const double CooldownSeconds = 600.0; // 10 minutes

        /// <summary>Display duration for a circadian strategy call in seconds.</summary>
        public const double CallDisplaySeconds = 15.0;

        /// <summary>
        /// Number of contiguous peak hours to identify as the "performance window".
        /// We look for the best run of this many consecutive hours.
        /// </summary>
        public const int PeakWindowSize = 4;

        // ═══════════════════════════════════════════════════════════════════
        //  SESSION RESULT — one per completed race/session
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>
        /// A single historical session result for circadian analysis.
        /// </summary>
        public class SessionResult
        {
            /// <summary>When the session started (local time).</summary>
            public DateTime SessionStart { get; set; }

            /// <summary>Hour of day (0-23) the session started. Derived from SessionStart.</summary>
            public int HourOfDay => SessionStart.Hour;

            /// <summary>Average lap time in seconds for this session.</summary>
            public double AverageLapTime { get; set; }

            /// <summary>Best lap time in seconds for this session.</summary>
            public double BestLapTime { get; set; }

            /// <summary>Number of incidents in this session.</summary>
            public int Incidents { get; set; }

            /// <summary>Number of laps completed.</summary>
            public int LapsCompleted { get; set; }

            /// <summary>iRating change from this session (can be negative).</summary>
            public int IRatingDelta { get; set; }

            /// <summary>Finishing position.</summary>
            public int FinishPosition { get; set; }

            /// <summary>Number of cars in the session.</summary>
            public int FieldSize { get; set; }

            /// <summary>Track ID for normalizing lap times across tracks.</summary>
            public string TrackId { get; set; } = "";

            /// <summary>Incidents per lap for this session.</summary>
            public double IncidentRate => LapsCompleted > 0
                ? (double)Incidents / LapsCompleted
                : 0.0;

            /// <summary>Finishing position as a percentile (0 = won, 1 = last).</summary>
            public double FinishPercentile => FieldSize > 1
                ? (double)(FinishPosition - 1) / (FieldSize - 1)
                : 0.0;
        }

        // ═══════════════════════════════════════════════════════════════════
        //  HOURLY BUCKET — aggregated stats for one hour of day
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>
        /// Aggregated performance statistics for a single hour-of-day bucket.
        /// </summary>
        public class HourlyStats
        {
            public int Hour { get; set; }
            public int SessionCount { get; set; }
            public double MeanIncidentRate { get; set; }
            public double MeanIRatingDelta { get; set; }
            public double MeanFinishPercentile { get; set; }
            public int TotalIncidents { get; set; }
            public int TotalLaps { get; set; }
            public int TotalIRatingDelta { get; set; }

            /// <summary>Whether this bucket has enough data to be statistically meaningful.</summary>
            public bool IsSignificant => SessionCount >= MinSessionsPerBucket;

            /// <summary>
            /// Composite performance score (0 = worst, 1 = best).
            /// Weighted combination of incident rate (lower=better),
            /// iRating trend (higher=better), and finish percentile (lower=better).
            /// </summary>
            public double PerformanceScore { get; set; }
        }

        // ═══════════════════════════════════════════════════════════════════
        //  PERFORMANCE WINDOW
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>
        /// A contiguous window of hours representing peak or danger performance.
        /// </summary>
        public class PerformanceWindow
        {
            /// <summary>Starting hour (0-23).</summary>
            public int StartHour { get; set; }

            /// <summary>Ending hour (0-23), inclusive.</summary>
            public int EndHour { get; set; }

            /// <summary>Average performance score across the window.</summary>
            public double AverageScore { get; set; }

            /// <summary>Human-readable label: "3 PM – 7 PM".</summary>
            public string Label => $"{FormatHour(StartHour)} – {FormatHour((EndHour + 1) % 24)}";

            private static string FormatHour(int hour)
            {
                if (hour == 0) return "12 AM";
                if (hour < 12) return $"{hour} AM";
                if (hour == 12) return "12 PM";
                return $"{hour - 12} PM";
            }
        }

        // ═══════════════════════════════════════════════════════════════════
        //  STATE
        // ═══════════════════════════════════════════════════════════════════

        private readonly List<SessionResult> _sessions = new List<SessionResult>();
        private readonly HourlyStats[] _hourlyStats = new HourlyStats[HourBuckets];
        private DateTime _lastCallTime = DateTime.MinValue;
        private bool _profileDirty = true;

        // ── Public output state ─────────────────────────────────────────

        /// <summary>All recorded sessions.</summary>
        public IReadOnlyList<SessionResult> Sessions => _sessions;

        /// <summary>Hourly performance statistics (index 0 = midnight, 23 = 11 PM).</summary>
        public IReadOnlyList<HourlyStats> HourlyProfile => _hourlyStats;

        /// <summary>Best contiguous performance window, or null if insufficient data.</summary>
        public PerformanceWindow PeakWindow { get; private set; }

        /// <summary>Worst contiguous performance window (danger hours), or null.</summary>
        public PerformanceWindow DangerWindow { get; private set; }

        /// <summary>Hours where incident rate exceeds DangerIncidentMultiplier × median.</summary>
        public List<int> DangerHours { get; private set; } = new List<int>();

        /// <summary>Whether enough data exists for meaningful profiling.</summary>
        public bool HasSufficientData => _sessions.Count >= MinTotalSessions;

        // ═══════════════════════════════════════════════════════════════════
        //  CONSTRUCTION
        // ═══════════════════════════════════════════════════════════════════

        public CircadianProfiler()
        {
            for (int i = 0; i < HourBuckets; i++)
                _hourlyStats[i] = new HourlyStats { Hour = i };
        }

        // ═══════════════════════════════════════════════════════════════════
        //  SESSION RECORDING
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>
        /// Records a completed session result for circadian analysis.
        /// </summary>
        public void RecordSession(SessionResult result)
        {
            if (result == null) throw new ArgumentNullException(nameof(result));
            if (result.LapsCompleted <= 0) return; // Skip empty sessions

            _sessions.Add(result);
            _profileDirty = true;
        }

        /// <summary>
        /// Convenience method to record a session with individual parameters.
        /// </summary>
        public void RecordSession(DateTime sessionStart, double avgLapTime, double bestLapTime,
            int incidents, int lapsCompleted, int iRatingDelta,
            int finishPosition = 1, int fieldSize = 1, string trackId = "")
        {
            RecordSession(new SessionResult
            {
                SessionStart = sessionStart,
                AverageLapTime = avgLapTime,
                BestLapTime = bestLapTime,
                Incidents = incidents,
                LapsCompleted = lapsCompleted,
                IRatingDelta = iRatingDelta,
                FinishPosition = finishPosition,
                FieldSize = fieldSize,
                TrackId = trackId
            });
        }

        // ═══════════════════════════════════════════════════════════════════
        //  PROFILE COMPUTATION
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>
        /// Recomputes the full circadian profile from all recorded sessions.
        /// Called automatically when needed, but can be invoked explicitly.
        /// </summary>
        public void ComputeProfile()
        {
            // Reset hourly stats
            for (int h = 0; h < HourBuckets; h++)
            {
                _hourlyStats[h] = new HourlyStats { Hour = h };
            }

            if (_sessions.Count < MinTotalSessions)
            {
                PeakWindow = null;
                DangerWindow = null;
                DangerHours.Clear();
                _profileDirty = false;
                return;
            }

            // Bucket sessions by hour
            var buckets = new List<SessionResult>[HourBuckets];
            for (int h = 0; h < HourBuckets; h++)
                buckets[h] = new List<SessionResult>();

            foreach (var s in _sessions)
                buckets[s.HourOfDay].Add(s);

            // Compute per-hour aggregates
            for (int h = 0; h < HourBuckets; h++)
            {
                var bucket = buckets[h];
                var stats = _hourlyStats[h];
                stats.SessionCount = bucket.Count;

                if (bucket.Count == 0) continue;

                stats.TotalIncidents = bucket.Sum(s => s.Incidents);
                stats.TotalLaps = bucket.Sum(s => s.LapsCompleted);
                stats.TotalIRatingDelta = bucket.Sum(s => s.IRatingDelta);
                stats.MeanIncidentRate = bucket.Average(s => s.IncidentRate);
                stats.MeanIRatingDelta = bucket.Average(s => (double)s.IRatingDelta);
                stats.MeanFinishPercentile = bucket.Average(s => s.FinishPercentile);
            }

            // Compute composite performance scores
            ComputePerformanceScores();

            // Find peak and danger windows
            PeakWindow = FindBestWindow(PeakWindowSize);
            DangerWindow = FindWorstWindow(PeakWindowSize);

            // Find individual danger hours (high incident rate)
            DangerHours = FindDangerHours();

            _profileDirty = false;
        }

        /// <summary>
        /// Computes a normalised composite performance score for each hour.
        /// Score = weighted combination of:
        ///   - Incident rate (40% weight, inverted — lower is better)
        ///   - iRating delta (40% weight — higher is better)
        ///   - Finish percentile (20% weight, inverted — lower is better)
        /// All normalised to 0-1 range across the populated buckets.
        /// </summary>
        internal void ComputePerformanceScores()
        {
            var populated = _hourlyStats.Where(h => h.SessionCount > 0).ToList();
            if (populated.Count == 0) return;

            // Find ranges for normalisation
            double minIR = populated.Min(h => h.MeanIncidentRate);
            double maxIR = populated.Max(h => h.MeanIncidentRate);
            double minRating = populated.Min(h => h.MeanIRatingDelta);
            double maxRating = populated.Max(h => h.MeanIRatingDelta);
            double minFinish = populated.Min(h => h.MeanFinishPercentile);
            double maxFinish = populated.Max(h => h.MeanFinishPercentile);

            foreach (var stats in populated)
            {
                // Normalise each metric to 0-1 (higher = better performance)
                double irScore = (maxIR - minIR) > 1e-10
                    ? 1.0 - (stats.MeanIncidentRate - minIR) / (maxIR - minIR)
                    : 1.0;
                double ratingScore = (maxRating - minRating) > 1e-10
                    ? (stats.MeanIRatingDelta - minRating) / (maxRating - minRating)
                    : 0.5;
                double finishScore = (maxFinish - minFinish) > 1e-10
                    ? 1.0 - (stats.MeanFinishPercentile - minFinish) / (maxFinish - minFinish)
                    : 0.5;

                stats.PerformanceScore = 0.4 * irScore + 0.4 * ratingScore + 0.2 * finishScore;
            }
        }

        /// <summary>
        /// Finds the best contiguous window of `windowSize` hours by average performance score.
        /// Wraps around midnight (e.g., 11 PM – 3 AM is valid).
        /// Only considers hours with data.
        /// </summary>
        public PerformanceWindow FindBestWindow(int windowSize)
        {
            return FindWindow(windowSize, best: true);
        }

        /// <summary>
        /// Finds the worst contiguous window of `windowSize` hours.
        /// </summary>
        public PerformanceWindow FindWorstWindow(int windowSize)
        {
            return FindWindow(windowSize, best: false);
        }

        private PerformanceWindow FindWindow(int windowSize, bool best)
        {
            if (windowSize < 1 || windowSize > HourBuckets) return null;

            double bestScore = best ? -1.0 : 2.0;
            int bestStart = -1;

            for (int start = 0; start < HourBuckets; start++)
            {
                double sum = 0;
                int validCount = 0;

                for (int offset = 0; offset < windowSize; offset++)
                {
                    int h = (start + offset) % HourBuckets;
                    if (_hourlyStats[h].SessionCount > 0)
                    {
                        sum += _hourlyStats[h].PerformanceScore;
                        validCount++;
                    }
                }

                if (validCount == 0) continue;

                double avg = sum / validCount;
                bool isBetter = best ? (avg > bestScore) : (avg < bestScore);
                if (isBetter)
                {
                    bestScore = avg;
                    bestStart = start;
                }
            }

            if (bestStart < 0) return null;

            return new PerformanceWindow
            {
                StartHour = bestStart,
                EndHour = (bestStart + windowSize - 1) % HourBuckets,
                AverageScore = bestScore
            };
        }

        /// <summary>
        /// Identifies hours where the incident rate exceeds the median by
        /// DangerIncidentMultiplier.
        /// </summary>
        public List<int> FindDangerHours()
        {
            var populatedRates = _hourlyStats
                .Where(h => h.SessionCount >= MinSessionsPerBucket)
                .Select(h => h.MeanIncidentRate)
                .OrderBy(r => r)
                .ToList();

            if (populatedRates.Count < 2) return new List<int>();

            double median = Median(populatedRates);
            double threshold = median * DangerIncidentMultiplier;

            var danger = new List<int>();
            for (int h = 0; h < HourBuckets; h++)
            {
                if (_hourlyStats[h].SessionCount >= MinSessionsPerBucket
                    && _hourlyStats[h].MeanIncidentRate > threshold)
                {
                    danger.Add(h);
                }
            }
            return danger;
        }

        /// <summary>Computes the median of a sorted list of doubles.</summary>
        public static double Median(IList<double> sorted)
        {
            if (sorted == null || sorted.Count == 0) return 0.0;
            int mid = sorted.Count / 2;
            if (sorted.Count % 2 == 0)
                return (sorted[mid - 1] + sorted[mid]) / 2.0;
            return sorted[mid];
        }

        // ═══════════════════════════════════════════════════════════════════
        //  STATISTICS HELPERS
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>
        /// Computes the total iRating lost during sessions in the given hour range.
        /// </summary>
        public int IRatingLostInHourRange(int startHour, int endHour)
        {
            int lost = 0;
            foreach (var s in _sessions)
            {
                bool inRange;
                if (startHour <= endHour)
                    inRange = s.HourOfDay >= startHour && s.HourOfDay <= endHour;
                else // wraps midnight
                    inRange = s.HourOfDay >= startHour || s.HourOfDay <= endHour;

                if (inRange && s.IRatingDelta < 0)
                    lost += s.IRatingDelta; // negative number
            }
            return lost;
        }

        /// <summary>
        /// Returns the number of sessions in a given hour range.
        /// </summary>
        public int SessionCountInHourRange(int startHour, int endHour)
        {
            int count = 0;
            foreach (var s in _sessions)
            {
                bool inRange;
                if (startHour <= endHour)
                    inRange = s.HourOfDay >= startHour && s.HourOfDay <= endHour;
                else
                    inRange = s.HourOfDay >= startHour || s.HourOfDay <= endHour;

                if (inRange) count++;
            }
            return count;
        }

        // ═══════════════════════════════════════════════════════════════════
        //  STRATEGY CALL EVALUATION
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>
        /// Evaluates whether a circadian strategy call should fire for the current
        /// session. Should be called at session start or early in the session.
        /// </summary>
        /// <param name="currentSessionStart">When this session started.</param>
        /// <param name="now">Current time (for cooldown tracking).</param>
        /// <returns>Strategy call, or null if no advisory needed.</returns>
        public StrategyCall Evaluate(DateTime currentSessionStart, DateTime now)
        {
            if (_profileDirty) ComputeProfile();

            if (!HasSufficientData) return null;

            if ((now - _lastCallTime).TotalSeconds < CooldownSeconds)
                return null;

            int currentHour = currentSessionStart.Hour;
            var currentStats = _hourlyStats[currentHour];

            // Priority 1: Racing in a danger hour (high incident rate)
            if (DangerHours.Contains(currentHour) && currentStats.IsSignificant)
            {
                _lastCallTime = now;
                string incidentMsg = $"Your incident rate at this hour is {currentStats.MeanIncidentRate:F1}x per lap — "
                    + $"{DangerIncidentMultiplier:F0}x higher than your median. Extra caution advised.";

                return new StrategyCall
                {
                    Label = "CLOCK",
                    Message = incidentMsg,
                    Severity = 3,
                    DisplayedAt = now
                };
            }

            // Priority 2: Racing outside peak window
            if (PeakWindow != null)
            {
                bool inPeakWindow = IsHourInWindow(currentHour, PeakWindow);
                if (!inPeakWindow && currentStats.SessionCount > 0)
                {
                    // Check if performance is meaningfully worse
                    var peakHours = GetWindowHours(PeakWindow);
                    double peakAvgScore = peakHours
                        .Where(h => _hourlyStats[h].SessionCount > 0)
                        .Average(h => _hourlyStats[h].PerformanceScore);

                    if (currentStats.PerformanceScore < peakAvgScore - 0.15)
                    {
                        _lastCallTime = now;
                        return new StrategyCall
                        {
                            Label = "CLOCK",
                            Message = $"You're racing outside your peak window ({PeakWindow.Label}). "
                                + "Set realistic expectations — consistency over pace today.",
                            Severity = 2,
                            DisplayedAt = now
                        };
                    }
                }
            }

            // Priority 3: Late night warning (universal circadian low)
            if (currentHour >= 23 || currentHour <= 4)
            {
                // Check if the driver actually has bad late-night stats
                var lateNightSessions = _sessions.Where(s =>
                    s.HourOfDay >= 23 || s.HourOfDay <= 4).ToList();

                if (lateNightSessions.Count >= MinSessionsPerBucket)
                {
                    double lateIR = lateNightSessions.Average(s => s.IncidentRate);
                    double overallIR = _sessions.Average(s => s.IncidentRate);

                    if (lateIR > overallIR * 1.5)
                    {
                        _lastCallTime = now;
                        int totalLost = lateNightSessions
                            .Where(s => s.IRatingDelta < 0)
                            .Sum(s => s.IRatingDelta);

                        return new StrategyCall
                        {
                            Label = "SLEEP",
                            Message = totalLost < -50
                                ? $"Late session — you've lost {Math.Abs(totalLost)} iRating in late-night races. "
                                  + "Your incident rate is elevated. Consider saving this one for tomorrow."
                                : "Late session — your stats show elevated incident rate after 11 PM. Stay extra focused.",
                            Severity = 2,
                            DisplayedAt = now
                        };
                    }
                }
            }

            // Priority 4: Positive reinforcement — racing in peak window
            if (PeakWindow != null && IsHourInWindow(currentHour, PeakWindow))
            {
                _lastCallTime = now;
                return new StrategyCall
                {
                    Label = "PEAK",
                    Message = $"You're in your peak performance window ({PeakWindow.Label}). "
                        + "Conditions are right — trust your inputs and push.",
                    Severity = 1,
                    DisplayedAt = now
                };
            }

            return null;
        }

        // ═══════════════════════════════════════════════════════════════════
        //  HELPERS
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>Checks if an hour falls within a performance window (handles midnight wrap).</summary>
        public static bool IsHourInWindow(int hour, PerformanceWindow window)
        {
            if (window == null) return false;
            if (window.StartHour <= window.EndHour)
                return hour >= window.StartHour && hour <= window.EndHour;
            // Wraps midnight
            return hour >= window.StartHour || hour <= window.EndHour;
        }

        /// <summary>Returns all hours in a performance window.</summary>
        public static List<int> GetWindowHours(PerformanceWindow window)
        {
            var hours = new List<int>();
            if (window == null) return hours;
            for (int i = 0; i < PeakWindowSize; i++)
                hours.Add((window.StartHour + i) % HourBuckets);
            return hours;
        }

        /// <summary>Resets cooldown state (for testing).</summary>
        public void ResetCooldown()
        {
            _lastCallTime = DateTime.MinValue;
        }

        /// <summary>Resets all state (for testing).</summary>
        public void Reset()
        {
            _sessions.Clear();
            for (int h = 0; h < HourBuckets; h++)
                _hourlyStats[h] = new HourlyStats { Hour = h };
            PeakWindow = null;
            DangerWindow = null;
            DangerHours.Clear();
            _lastCallTime = DateTime.MinValue;
            _profileDirty = true;
        }
    }
}
