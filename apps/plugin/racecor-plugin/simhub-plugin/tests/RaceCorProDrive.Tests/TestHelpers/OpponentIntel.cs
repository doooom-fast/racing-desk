using System;
using System.Collections.Generic;
using System.Linq;

namespace RaceCorProDrive.Tests.TestHelpers
{
    /// <summary>
    /// Opponent intelligence engine.
    ///
    /// Builds driver profiles from historical race data:
    ///   1. Reputation scoring (incident rate, safety rating proxy)
    ///   2. Rivalry detection (shared races + mutual incidents)
    ///   3. Pace prediction (lap time degradation over stints)
    ///   4. Driving style classification (aggressive / defensive / clean)
    ///
    /// Standalone reimplementation for testing — no SimHub dependencies.
    /// Reuses StrategyCall from SolarGlareAnalyzer.cs (same namespace).
    /// </summary>
    public class OpponentIntel
    {
        // ═══════════════════════════════════════════════════════════════════
        //  CONSTANTS
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>Minimum shared races before rivalry detection activates.</summary>
        public const int MinSharedRaces = 3;

        /// <summary>Minimum races for a driver to have a meaningful profile.</summary>
        public const int MinRacesForProfile = 3;

        /// <summary>Incident rate threshold above which a driver is flagged as "caution".</summary>
        public const double CautionIncidentRate = 0.25; // per lap

        /// <summary>High incident rate threshold — "danger" classification.</summary>
        public const double DangerIncidentRate = 0.5;

        /// <summary>Rivalry threshold: mutual incidents / shared races.</summary>
        public const double RivalryIncidentThreshold = 0.5; // incidents in 50%+ of shared races

        /// <summary>Minimum lap count for pace prediction.</summary>
        public const int MinLapsForPacePrediction = 10;

        /// <summary>Cooldown between opponent intel calls in seconds.</summary>
        public const double CooldownSeconds = 60.0;

        // ═══════════════════════════════════════════════════════════════════
        //  DRIVING STYLE
        // ═══════════════════════════════════════════════════════════════════

        public enum DrivingStyle
        {
            Unknown = 0,
            Clean = 1,
            Defensive = 2,
            Aggressive = 3,
            Erratic = 4
        }

        // ═══════════════════════════════════════════════════════════════════
        //  RACE RECORD — one entry per shared race
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>Record of an opponent's performance in a single race.</summary>
        public class RaceRecord
        {
            public string SessionId { get; set; } = "";
            public DateTime RaceDate { get; set; }
            public string TrackId { get; set; } = "";
            public int FinishPosition { get; set; }
            public int FieldSize { get; set; }
            public int Incidents { get; set; }
            public int LapsCompleted { get; set; }
            public int IRatingBefore { get; set; }
            public int IRatingAfter { get; set; }
            public double AverageLapTime { get; set; }
            public double BestLapTime { get; set; }
            public int PositionsGained { get; set; }
            public int PositionsLost { get; set; }
            public bool HadContactWithPlayer { get; set; }

            /// <summary>Lap time degradation: avg of last 5 laps minus avg of first 5 laps (positive = slower).</summary>
            public double LapTimeDegradation { get; set; }

            public double IncidentRate => LapsCompleted > 0 ? (double)Incidents / LapsCompleted : 0.0;
            public int IRatingDelta => IRatingAfter - IRatingBefore;
        }

        // ═══════════════════════════════════════════════════════════════════
        //  DRIVER PROFILE — aggregated opponent intelligence
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>Complete intelligence profile for a single opponent.</summary>
        public class DriverProfile
        {
            public string DriverName { get; set; } = "";
            public int DriverId { get; set; }
            public int CurrentIRating { get; set; }
            public List<RaceRecord> Races { get; set; } = new List<RaceRecord>();

            // ── Computed stats ──────────────────────────────────────────
            public int TotalRaces => Races.Count;
            public bool HasSufficientData => TotalRaces >= MinRacesForProfile;

            public double MeanIncidentRate => Races.Count > 0
                ? Races.Average(r => r.IncidentRate) : 0.0;

            public double MeanLapTimeDegradation => Races.Count > 0
                ? Races.Where(r => r.LapsCompleted >= MinLapsForPacePrediction)
                       .Select(r => r.LapTimeDegradation)
                       .DefaultIfEmpty(0.0)
                       .Average()
                : 0.0;

            public int TotalPositionsGained => Races.Sum(r => r.PositionsGained);
            public int TotalPositionsLost => Races.Sum(r => r.PositionsLost);
            public int SharedRacesWithContact => Races.Count(r => r.HadContactWithPlayer);

            public double IRatingTrend
            {
                get
                {
                    if (Races.Count < 2) return 0.0;
                    var sorted = Races.OrderBy(r => r.RaceDate).ToList();
                    int recentCount = Math.Max(1, sorted.Count / 3);
                    double recentAvg = sorted.Skip(sorted.Count - recentCount)
                        .Average(r => (double)r.IRatingAfter);
                    double earlyAvg = sorted.Take(recentCount)
                        .Average(r => (double)r.IRatingBefore);
                    return recentAvg - earlyAvg;
                }
            }

            public DrivingStyle Style { get; set; } = DrivingStyle.Unknown;
            public double ReputationScore { get; set; }
        }

        // ═══════════════════════════════════════════════════════════════════
        //  RIVALRY
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>Detected rivalry between the player and an opponent.</summary>
        public class Rivalry
        {
            public string OpponentName { get; set; } = "";
            public int SharedRaces { get; set; }
            public int MutualIncidents { get; set; }
            public double IncidentRate => SharedRaces > 0 ? (double)MutualIncidents / SharedRaces : 0.0;
        }

        // ═══════════════════════════════════════════════════════════════════
        //  STATE
        // ═══════════════════════════════════════════════════════════════════

        private readonly Dictionary<int, DriverProfile> _profiles = new Dictionary<int, DriverProfile>();
        private DateTime _lastCallTime = DateTime.MinValue;

        public IReadOnlyDictionary<int, DriverProfile> Profiles => _profiles;

        // ═══════════════════════════════════════════════════════════════════
        //  RACE RECORDING
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>Records a race result for an opponent.</summary>
        public void RecordRace(int driverId, string driverName, RaceRecord record)
        {
            if (record == null || record.LapsCompleted <= 0) return;

            if (!_profiles.TryGetValue(driverId, out var profile))
            {
                profile = new DriverProfile { DriverId = driverId, DriverName = driverName };
                _profiles[driverId] = profile;
            }

            profile.Races.Add(record);
            profile.CurrentIRating = record.IRatingAfter;
        }

        // ═══════════════════════════════════════════════════════════════════
        //  REPUTATION SCORING
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>
        /// Computes a reputation score (0–1) for a driver.
        /// 1.0 = perfectly clean and improving. 0.0 = dangerous and declining.
        ///
        /// Weighted: 50% incident rate (inverted), 30% iRating trend, 20% position gains.
        /// </summary>
        public static double ComputeReputationScore(DriverProfile profile)
        {
            if (!profile.HasSufficientData) return 0.5; // Neutral for unknowns

            // Incident rate score: 0 incidents = 1.0, DangerIncidentRate+ = 0.0
            double irScore = Math.Max(0.0, 1.0 - profile.MeanIncidentRate / DangerIncidentRate);

            // iRating trend: normalize to -1..+1 range (±200 iRating = full range)
            double trendNorm = Math.Max(-1.0, Math.Min(1.0, profile.IRatingTrend / 200.0));
            double trendScore = (trendNorm + 1.0) / 2.0; // Map to 0..1

            // Position gain tendency: net gains / total races, clamped
            int netGains = profile.TotalPositionsGained - profile.TotalPositionsLost;
            double gainRate = (double)netGains / profile.TotalRaces;
            double gainScore = Math.Max(0.0, Math.Min(1.0, (gainRate + 3.0) / 6.0)); // -3..+3 → 0..1

            return 0.5 * irScore + 0.3 * trendScore + 0.2 * gainScore;
        }

        // ═══════════════════════════════════════════════════════════════════
        //  DRIVING STYLE CLASSIFICATION
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>
        /// Classifies a driver's style based on their race history.
        ///
        /// Aggressive: high position gains, high incidents
        /// Defensive: low position changes, low incidents
        /// Clean: moderate gains, very low incidents
        /// Erratic: high incidents, inconsistent results
        /// </summary>
        public static DrivingStyle ClassifyStyle(DriverProfile profile)
        {
            if (!profile.HasSufficientData) return DrivingStyle.Unknown;

            double ir = profile.MeanIncidentRate;
            double netGainPerRace = (double)(profile.TotalPositionsGained - profile.TotalPositionsLost) / profile.TotalRaces;

            // Erratic: very high incidents regardless of other factors
            if (ir >= DangerIncidentRate) return DrivingStyle.Erratic;

            // Aggressive: gains positions frequently but has incidents
            if (netGainPerRace > 1.5 && ir >= CautionIncidentRate * 0.5)
                return DrivingStyle.Aggressive;

            // Clean: low incidents, moderate gains
            if (ir < CautionIncidentRate * 0.5)
                return DrivingStyle.Clean;

            // Defensive: few position changes, moderate incidents
            if (Math.Abs(netGainPerRace) < 1.0)
                return DrivingStyle.Defensive;

            return DrivingStyle.Defensive;
        }

        // ═══════════════════════════════════════════════════════════════════
        //  RIVALRY DETECTION
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>
        /// Detects rivalries: opponents with repeated contact in shared races.
        /// </summary>
        public List<Rivalry> DetectRivalries()
        {
            var rivalries = new List<Rivalry>();

            foreach (var profile in _profiles.Values)
            {
                if (profile.TotalRaces < MinSharedRaces) continue;

                int contactRaces = profile.SharedRacesWithContact;
                if (contactRaces == 0) continue;

                double contactRate = (double)contactRaces / profile.TotalRaces;
                if (contactRate >= RivalryIncidentThreshold)
                {
                    rivalries.Add(new Rivalry
                    {
                        OpponentName = profile.DriverName,
                        SharedRaces = profile.TotalRaces,
                        MutualIncidents = contactRaces
                    });
                }
            }

            return rivalries.OrderByDescending(r => r.IncidentRate).ToList();
        }

        // ═══════════════════════════════════════════════════════════════════
        //  PACE PREDICTION
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>
        /// Predicts an opponent's expected lap time degradation per 10 laps
        /// at a specific track, based on their history.
        /// Returns 0.0 if insufficient data.
        /// </summary>
        public static double PredictDegradation(DriverProfile profile, string trackId)
        {
            var trackRaces = profile.Races
                .Where(r => r.TrackId == trackId && r.LapsCompleted >= MinLapsForPacePrediction)
                .ToList();

            if (trackRaces.Count == 0)
            {
                // Fall back to all-track average
                var longRaces = profile.Races
                    .Where(r => r.LapsCompleted >= MinLapsForPacePrediction)
                    .ToList();
                return longRaces.Count > 0 ? longRaces.Average(r => r.LapTimeDegradation) : 0.0;
            }

            return trackRaces.Average(r => r.LapTimeDegradation);
        }

        // ═══════════════════════════════════════════════════════════════════
        //  PROFILE COMPUTATION
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>Recomputes style and reputation for all profiles.</summary>
        public void ComputeAllProfiles()
        {
            foreach (var profile in _profiles.Values)
            {
                profile.Style = ClassifyStyle(profile);
                profile.ReputationScore = ComputeReputationScore(profile);
            }
        }

        // ═══════════════════════════════════════════════════════════════════
        //  STRATEGY CALL EVALUATION
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>
        /// Evaluates whether a spotter call should fire for a nearby opponent.
        /// </summary>
        public StrategyCall Evaluate(int nearbyDriverId, double gapSeconds, DateTime now)
        {
            if ((now - _lastCallTime).TotalSeconds < CooldownSeconds) return null;
            if (!_profiles.TryGetValue(nearbyDriverId, out var profile)) return null;
            if (!profile.HasSufficientData) return null;

            // Only fire when opponent is close
            if (Math.Abs(gapSeconds) > 3.0) return null;

            ComputeAllProfiles();

            // Priority 1: Dangerous driver nearby
            if (profile.MeanIncidentRate >= DangerIncidentRate)
            {
                _lastCallTime = now;
                return new StrategyCall
                {
                    Label = "SPOT",
                    Message = $"{profile.DriverName} nearby — {profile.MeanIncidentRate:F1}x incident rate. Give extra room.",
                    Severity = 3,
                    DisplayedAt = now
                };
            }

            // Priority 2: Rivalry warning
            var rivalries = DetectRivalries();
            var rivalry = rivalries.FirstOrDefault(r => r.OpponentName == profile.DriverName);
            if (rivalry != null)
            {
                _lastCallTime = now;
                return new StrategyCall
                {
                    Label = "RIVAL",
                    Message = $"History with {profile.DriverName}: contact in {rivalry.MutualIncidents} of {rivalry.SharedRaces} shared races. Stay clean.",
                    Severity = 2,
                    DisplayedAt = now
                };
            }

            // Priority 3: Caution-level driver
            if (profile.MeanIncidentRate >= CautionIncidentRate)
            {
                _lastCallTime = now;
                return new StrategyCall
                {
                    Label = "SPOT",
                    Message = $"{profile.DriverName} has elevated incident rate. Be aware.",
                    Severity = 2,
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
            _profiles.Clear();
            _lastCallTime = DateTime.MinValue;
        }
    }
}
