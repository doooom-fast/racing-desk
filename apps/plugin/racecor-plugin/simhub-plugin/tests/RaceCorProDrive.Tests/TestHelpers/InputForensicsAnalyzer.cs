using System;
using System.Collections.Generic;
using System.Linq;

namespace RaceCorProDrive.Tests.TestHelpers
{
    /// <summary>
    /// Analyses the *shape* of driver inputs (steering, brake, throttle) to produce
    /// technique scores and strategy calls.
    ///
    /// Three sub-analysers:
    ///   1. Steering smoothness   — second derivative of SteeringWheelAngle.
    ///   2. Trail braking grade   — brake taper shape correlated with steering increase.
    ///   3. Throttle discipline   — sawtooth / oscillation detection on throttle trace.
    ///
    /// Standalone reimplementation for testing — no SimHub dependencies.
    /// Reuses StrategyCall from SolarGlareAnalyzer.cs (same namespace).
    /// </summary>
    public class InputForensicsAnalyzer
    {
        // ═══════════════════════════════════════════════════════════════════
        //  CONSTANTS
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>Minimum samples required in a braking zone to grade trail braking.</summary>
        public const int MinBrakeSamples = 5;

        /// <summary>Minimum samples required for steering smoothness calculation.</summary>
        public const int MinSteeringSamples = 10;

        /// <summary>Minimum samples in a throttle zone for oscillation detection.</summary>
        public const int MinThrottleSamples = 8;

        /// <summary>
        /// Throttle percentage below which we consider the driver "off throttle".
        /// Used as the baseline for detecting sawtooth oscillation.
        /// </summary>
        public const double ThrottleOnThreshold = 20.0;

        /// <summary>
        /// Minimum throttle swing (peak-to-trough %) that counts as an oscillation.
        /// Prevents micro-jitter from counting as a genuine lift.
        /// </summary>
        public const double ThrottleOscillationMinSwing = 15.0;

        /// <summary>Brake percentage above which the driver is "on brake".</summary>
        public const double BrakeOnThreshold = 5.0;

        /// <summary>Steering angle (degrees) above which the driver is "turning".</summary>
        public const double SteeringActiveThreshold = 5.0;

        /// <summary>Cooldown between forensics calls in seconds.</summary>
        public const double CooldownSeconds = 120.0;

        /// <summary>Display duration for a forensics strategy call in seconds.</summary>
        public const double CallDisplaySeconds = 10.0;

        /// <summary>Speed (km/h) below which we ignore samples (pit lane, gridding).</summary>
        public const double MinSpeedKmh = 30.0;

        // ═══════════════════════════════════════════════════════════════════
        //  INPUT SAMPLE
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>A single time-stamped snapshot of driver inputs.</summary>
        public class InputSample
        {
            public double TimestampSeconds { get; set; }
            public double SteeringAngleDeg { get; set; }
            public double ThrottlePct { get; set; }  // 0-100
            public double BrakePct { get; set; }      // 0-100
            public double SpeedKmh { get; set; }
            public double LatAccel { get; set; }
        }

        // ═══════════════════════════════════════════════════════════════════
        //  TRAIL BRAKING GRADES
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>Letter grade for a braking zone's trail braking quality.</summary>
        public enum TrailBrakeGrade
        {
            /// <summary>Textbook trail braking: firm initial bite tapering linearly with steering.</summary>
            A = 0,
            /// <summary>Good trail braking with minor imperfections.</summary>
            B = 1,
            /// <summary>Some trail braking but inconsistent taper.</summary>
            C = 2,
            /// <summary>Threshold braking (flat rectangle) — fast but no trail.</summary>
            D = 3,
            /// <summary>Lift-and-coast or very weak braking.</summary>
            E = 4,
            /// <summary>Erratic or no meaningful braking detected.</summary>
            F = 5
        }

        // ═══════════════════════════════════════════════════════════════════
        //  PER-LAP RESULTS
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>Aggregated technique scores for a single completed lap.</summary>
        public class LapForensics
        {
            public int LapNumber { get; set; }

            /// <summary>Steering smoothness 0.0 (worst) – 1.0 (perfectly smooth).</summary>
            public double SteeringSmoothness { get; set; }

            /// <summary>Average trail braking grade across all braking zones.</summary>
            public TrailBrakeGrade AverageTrailGrade { get; set; }

            /// <summary>Total throttle oscillations detected during corner exits.</summary>
            public int ThrottleOscillations { get; set; }

            /// <summary>Throttle discipline 0.0 (worst) – 1.0 (no oscillations).</summary>
            public double ThrottleDiscipline { get; set; }

            /// <summary>Number of braking zones analysed.</summary>
            public int BrakingZoneCount { get; set; }

            /// <summary>Number of corner-exit zones analysed.</summary>
            public int CornerExitCount { get; set; }
        }

        // ═══════════════════════════════════════════════════════════════════
        //  STATE
        // ═══════════════════════════════════════════════════════════════════

        private readonly List<InputSample> _currentLapSamples = new List<InputSample>();
        private readonly List<LapForensics> _completedLaps = new List<LapForensics>();

        private int _lastCompletedLap = -1;
        private DateTime _lastCallTime = DateTime.MinValue;
        private double _frameTimestamp = 0.0;

        // ── Public output state ─────────────────────────────────────────

        /// <summary>Completed lap forensics history.</summary>
        public IReadOnlyList<LapForensics> CompletedLaps => _completedLaps;

        /// <summary>Current lap's sample count (for diagnostics).</summary>
        public int CurrentLapSampleCount => _currentLapSamples.Count;

        /// <summary>Rolling smoothness score (last completed lap). 0 = no data.</summary>
        public double LastSmoothness { get; private set; }

        /// <summary>Rolling trail brake grade (last completed lap).</summary>
        public TrailBrakeGrade LastTrailGrade { get; private set; }

        /// <summary>Rolling throttle discipline (last completed lap). 0 = no data.</summary>
        public double LastThrottleDiscipline { get; private set; }

        // ═══════════════════════════════════════════════════════════════════
        //  STEERING SMOOTHNESS — Second Derivative
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>
        /// Computes a smoothness score (0–1) from a series of steering angle samples.
        ///
        /// The second derivative of steering angle over time measures how *jerky*
        /// the driver's hands are. A perfectly smooth driver has near-zero second
        /// derivative; a driver sawing at the wheel has huge spikes.
        ///
        /// Score = 1.0 / (1.0 + k * RMS(d²θ/dt²))
        ///
        /// where k is a normalisation constant tuned so that typical human jerk
        /// maps to the 0.3–0.8 range.
        /// </summary>
        /// <param name="samples">Time-ordered input samples.</param>
        /// <returns>Smoothness score 0–1, or 1.0 if insufficient data.</returns>
        public static double ComputeSteeringSmoothness(IList<InputSample> samples)
        {
            if (samples == null || samples.Count < MinSteeringSamples)
                return 1.0; // Not enough data — assume smooth

            // Compute first derivatives (steering rate, °/s)
            var firstDerivatives = new List<double>();
            var firstDerivTimes = new List<double>();
            for (int i = 1; i < samples.Count; i++)
            {
                double dt = samples[i].TimestampSeconds - samples[i - 1].TimestampSeconds;
                if (dt <= 0.0) continue;
                double dTheta = samples[i].SteeringAngleDeg - samples[i - 1].SteeringAngleDeg;
                firstDerivatives.Add(dTheta / dt);
                firstDerivTimes.Add((samples[i].TimestampSeconds + samples[i - 1].TimestampSeconds) / 2.0);
            }

            if (firstDerivatives.Count < 3)
                return 1.0;

            // Compute second derivatives (steering jerk, °/s²)
            var secondDerivatives = new List<double>();
            for (int i = 1; i < firstDerivatives.Count; i++)
            {
                double dt = firstDerivTimes[i] - firstDerivTimes[i - 1];
                if (dt <= 0.0) continue;
                double dRate = firstDerivatives[i] - firstDerivatives[i - 1];
                secondDerivatives.Add(dRate / dt);
            }

            if (secondDerivatives.Count == 0)
                return 1.0;

            // RMS of second derivative
            double rms = ComputeRms(secondDerivatives);

            // Normalisation: k = 0.000005 maps typical jerk range to 0-1 at 60fps.
            // Second derivatives are amplified by 1/dt² (~3600 at 60fps), so k must be
            // very small. At 0 jerk → 1.0; smooth sine → ~0.85; heavy noise → <0.3.
            const double k = 0.000005;
            double score = 1.0 / (1.0 + k * rms);

            return Math.Max(0.0, Math.Min(1.0, score));
        }

        /// <summary>Compute RMS (root mean square) of a list of doubles.</summary>
        public static double ComputeRms(IList<double> values)
        {
            if (values == null || values.Count == 0) return 0.0;
            double sumSquares = 0.0;
            for (int i = 0; i < values.Count; i++)
                sumSquares += values[i] * values[i];
            return Math.Sqrt(sumSquares / values.Count);
        }

        // ═══════════════════════════════════════════════════════════════════
        //  TRAIL BRAKING — Brake Taper Shape Analysis
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>
        /// Identifies braking zones from a lap of samples.
        /// A braking zone starts when brake > BrakeOnThreshold and ends when brake
        /// drops below BrakeOnThreshold (or speed drops below MinSpeedKmh).
        /// Returns a list of sample slices, one per braking zone.
        /// </summary>
        public static List<List<InputSample>> ExtractBrakingZones(IList<InputSample> samples)
        {
            var zones = new List<List<InputSample>>();
            List<InputSample> currentZone = null;

            for (int i = 0; i < samples.Count; i++)
            {
                bool braking = samples[i].BrakePct > BrakeOnThreshold
                            && samples[i].SpeedKmh >= MinSpeedKmh;

                if (braking)
                {
                    if (currentZone == null)
                        currentZone = new List<InputSample>();
                    currentZone.Add(samples[i]);
                }
                else if (currentZone != null)
                {
                    if (currentZone.Count >= MinBrakeSamples)
                        zones.Add(currentZone);
                    currentZone = null;
                }
            }

            // Close any trailing zone
            if (currentZone != null && currentZone.Count >= MinBrakeSamples)
                zones.Add(currentZone);

            return zones;
        }

        /// <summary>
        /// Grades a single braking zone for trail braking quality.
        ///
        /// Trail braking pattern (grade A):
        ///   - Peak brake in the first 30% of the zone
        ///   - Brake pressure tapers (decreases) through the remaining 70%
        ///   - Steering angle increases as brake tapers
        ///
        /// Threshold braking (grade D):
        ///   - Brake pressure stays roughly constant, then releases abruptly
        ///
        /// Scoring is based on:
        ///   1. Taper ratio: how much of the zone has decreasing brake
        ///   2. Brake-steer correlation: negative correlation = ideal trail brake
        /// </summary>
        public static TrailBrakeGrade GradeBrakingZone(IList<InputSample> zone)
        {
            if (zone == null || zone.Count < MinBrakeSamples)
                return TrailBrakeGrade.F;

            // Find peak brake position
            double maxBrake = 0;
            int peakIdx = 0;
            for (int i = 0; i < zone.Count; i++)
            {
                if (zone[i].BrakePct > maxBrake)
                {
                    maxBrake = zone[i].BrakePct;
                    peakIdx = i;
                }
            }

            // Very weak braking = lift and coast
            if (maxBrake < 20.0)
                return TrailBrakeGrade.E;

            // Peak should be in the first half for good trail braking
            double peakPosition = (double)peakIdx / zone.Count;

            // Analyse the taper phase (everything after peak)
            int taperStart = peakIdx;
            int taperLength = zone.Count - taperStart;

            if (taperLength < 3)
            {
                // All braking at the end = abrupt, no trail
                return TrailBrakeGrade.D;
            }

            // Count how many consecutive samples have decreasing or stable brake
            int decreasingCount = 0;
            for (int i = taperStart + 1; i < zone.Count; i++)
            {
                if (zone[i].BrakePct <= zone[i - 1].BrakePct + 2.0) // allow 2% tolerance
                    decreasingCount++;
            }
            double taperRatio = (double)decreasingCount / (taperLength - 1);

            // Detect flat-then-release (threshold braking):
            // If most of the taper phase has brake pressure within 15% of peak,
            // the driver is holding constant pressure then dumping the brake.
            int flatCount = 0;
            for (int i = taperStart; i < zone.Count; i++)
            {
                if (zone[i].BrakePct >= maxBrake * 0.70) // within 30% of peak
                    flatCount++;
            }
            double flatRatio = (double)flatCount / taperLength;
            if (flatRatio > 0.60)
                return TrailBrakeGrade.D; // Threshold braking — flat then release

            // Compute brake-steer correlation in the taper phase
            // Ideal trail braking: brake goes down while steering goes up → negative correlation
            double correlation = ComputeBrakeSteerCorrelation(zone, taperStart);

            // Scoring matrix
            if (peakPosition <= 0.35 && taperRatio >= 0.75 && correlation <= -0.3)
                return TrailBrakeGrade.A;
            if (peakPosition <= 0.5 && taperRatio >= 0.6 && correlation <= -0.1)
                return TrailBrakeGrade.B;
            if (taperRatio >= 0.5 || correlation <= -0.2)
                return TrailBrakeGrade.C;
            if (taperRatio < 0.3 && correlation > 0.1)
                return TrailBrakeGrade.D;

            return TrailBrakeGrade.C; // Middle ground
        }

        /// <summary>
        /// Pearson correlation between brake pressure and absolute steering angle
        /// in the taper phase of a braking zone.
        /// Returns value in [-1, +1]. Negative = ideal (brake down, steer up).
        /// Returns 0 if insufficient data or zero variance.
        /// </summary>
        public static double ComputeBrakeSteerCorrelation(IList<InputSample> zone, int startIdx)
        {
            int n = zone.Count - startIdx;
            if (n < 3) return 0.0;

            double sumBrake = 0, sumSteer = 0;
            for (int i = startIdx; i < zone.Count; i++)
            {
                sumBrake += zone[i].BrakePct;
                sumSteer += Math.Abs(zone[i].SteeringAngleDeg);
            }
            double meanBrake = sumBrake / n;
            double meanSteer = sumSteer / n;

            double cov = 0, varBrake = 0, varSteer = 0;
            for (int i = startIdx; i < zone.Count; i++)
            {
                double db = zone[i].BrakePct - meanBrake;
                double ds = Math.Abs(zone[i].SteeringAngleDeg) - meanSteer;
                cov += db * ds;
                varBrake += db * db;
                varSteer += ds * ds;
            }

            double denom = Math.Sqrt(varBrake * varSteer);
            if (denom < 1e-10) return 0.0;

            return cov / denom;
        }

        /// <summary>
        /// Averages a list of trail brake grades into a single representative grade.
        /// </summary>
        public static TrailBrakeGrade AverageGrades(IList<TrailBrakeGrade> grades)
        {
            if (grades == null || grades.Count == 0) return TrailBrakeGrade.F;
            double sum = grades.Sum(g => (int)g);
            double avg = sum / grades.Count;
            return (TrailBrakeGrade)Math.Min((int)Math.Round(avg), 5);
        }

        // ═══════════════════════════════════════════════════════════════════
        //  THROTTLE DISCIPLINE — Sawtooth / Oscillation Detection
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>
        /// Extracts corner-exit zones: periods where the driver is applying throttle
        /// (>ThrottleOnThreshold) and not braking, following a braking zone.
        /// </summary>
        public static List<List<InputSample>> ExtractCornerExitZones(IList<InputSample> samples)
        {
            var zones = new List<List<InputSample>>();
            List<InputSample> currentZone = null;
            bool wasBraking = false;

            for (int i = 0; i < samples.Count; i++)
            {
                bool braking = samples[i].BrakePct > BrakeOnThreshold;
                bool onThrottle = samples[i].ThrottlePct > ThrottleOnThreshold
                               && samples[i].SpeedKmh >= MinSpeedKmh;

                if (braking)
                {
                    wasBraking = true;
                    if (currentZone != null)
                    {
                        if (currentZone.Count >= MinThrottleSamples)
                            zones.Add(currentZone);
                        currentZone = null;
                    }
                }
                else if (onThrottle && wasBraking)
                {
                    if (currentZone == null)
                        currentZone = new List<InputSample>();
                    currentZone.Add(samples[i]);
                }
                else if (!onThrottle && !braking)
                {
                    // Coasting — close any open zone
                    if (currentZone != null)
                    {
                        if (currentZone.Count >= MinThrottleSamples)
                            zones.Add(currentZone);
                        currentZone = null;
                    }
                    // Keep wasBraking true so the next throttle application counts
                }
            }

            if (currentZone != null && currentZone.Count >= MinThrottleSamples)
                zones.Add(currentZone);

            return zones;
        }

        /// <summary>
        /// Counts throttle oscillations in a corner-exit zone.
        ///
        /// An oscillation is a sequence: throttle rises above a local peak,
        /// drops by at least ThrottleOscillationMinSwing, then rises again.
        /// This is the classic "sawtooth" pattern of overdriving corner exit.
        /// </summary>
        public static int CountThrottleOscillations(IList<InputSample> zone)
        {
            if (zone == null || zone.Count < MinThrottleSamples)
                return 0;

            int oscillations = 0;
            double localMax = zone[0].ThrottlePct;
            double localMin = zone[0].ThrottlePct;
            bool seekingTrough = true; // Start by looking for a drop

            for (int i = 1; i < zone.Count; i++)
            {
                double val = zone[i].ThrottlePct;

                if (seekingTrough)
                {
                    // Track the peak
                    if (val > localMax)
                        localMax = val;

                    // Significant drop from peak = found a trough
                    if (localMax - val >= ThrottleOscillationMinSwing)
                    {
                        localMin = val;
                        seekingTrough = false;
                    }
                }
                else
                {
                    // Track the trough
                    if (val < localMin)
                        localMin = val;

                    // Significant rise from trough = completed one oscillation
                    if (val - localMin >= ThrottleOscillationMinSwing)
                    {
                        oscillations++;
                        localMax = val;
                        seekingTrough = true;
                    }
                }
            }

            return oscillations;
        }

        /// <summary>
        /// Converts total oscillation count across corner exits into a discipline
        /// score (0–1). 0 oscillations = 1.0 (perfect), exponential decay.
        ///
        /// Score = exp(-0.5 * oscillations / cornerCount)
        ///
        /// This normalises by the number of corners so a track with 20 corners
        /// isn't penalised more than one with 6.
        /// </summary>
        public static double ComputeThrottleDiscipline(int totalOscillations, int cornerExitCount)
        {
            if (cornerExitCount <= 0) return 1.0;
            double rate = (double)totalOscillations / cornerExitCount;
            return Math.Exp(-0.5 * rate);
        }

        // ═══════════════════════════════════════════════════════════════════
        //  FRAME UPDATE — per-frame accumulation
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>
        /// Per-frame update: accumulates input samples and triggers lap analysis
        /// when a new lap is completed.
        /// </summary>
        /// <param name="current">Current telemetry snapshot.</param>
        /// <param name="timestamp">Monotonic session time in seconds (for dt calculation).</param>
        public void UpdateFrame(TelemetrySnapshot current, double timestamp)
        {
            if (current == null || !current.GameRunning) return;
            if (current.SpeedKmh < MinSpeedKmh) return;
            if (current.IsInPit || current.IsInPitLane) return;

            _frameTimestamp = timestamp;

            // Accumulate sample
            _currentLapSamples.Add(new InputSample
            {
                TimestampSeconds = timestamp,
                SteeringAngleDeg = current.SteeringWheelAngle,
                ThrottlePct = current.Throttle,
                BrakePct = current.Brake,
                SpeedKmh = current.SpeedKmh,
                LatAccel = current.LatAccel
            });

            // Detect lap completion
            if (current.CompletedLaps > _lastCompletedLap && _lastCompletedLap >= 0)
            {
                FinaliseLap(current.CompletedLaps);
            }

            _lastCompletedLap = current.CompletedLaps;
        }

        /// <summary>
        /// Analyses and stores the current lap's samples, then resets for the next lap.
        /// </summary>
        private void FinaliseLap(int lapNumber)
        {
            if (_currentLapSamples.Count < MinSteeringSamples)
            {
                _currentLapSamples.Clear();
                return;
            }

            var forensics = AnalyseLap(_currentLapSamples, lapNumber);
            _completedLaps.Add(forensics);

            LastSmoothness = forensics.SteeringSmoothness;
            LastTrailGrade = forensics.AverageTrailGrade;
            LastThrottleDiscipline = forensics.ThrottleDiscipline;

            _currentLapSamples.Clear();
        }

        /// <summary>
        /// Performs full forensic analysis on a completed lap's samples.
        /// Public for direct testing.
        /// </summary>
        public static LapForensics AnalyseLap(IList<InputSample> samples, int lapNumber)
        {
            // Steering smoothness
            double smoothness = ComputeSteeringSmoothness(samples);

            // Trail braking
            var brakingZones = ExtractBrakingZones(samples);
            var grades = brakingZones.Select(GradeBrakingZone).ToList();
            var avgGrade = AverageGrades(grades);

            // Throttle discipline
            var exitZones = ExtractCornerExitZones(samples);
            int totalOscillations = exitZones.Sum(CountThrottleOscillations);
            double discipline = ComputeThrottleDiscipline(totalOscillations, exitZones.Count);

            return new LapForensics
            {
                LapNumber = lapNumber,
                SteeringSmoothness = smoothness,
                AverageTrailGrade = avgGrade,
                ThrottleOscillations = totalOscillations,
                ThrottleDiscipline = discipline,
                BrakingZoneCount = brakingZones.Count,
                CornerExitCount = exitZones.Count
            };
        }

        // ═══════════════════════════════════════════════════════════════════
        //  STRATEGY CALL EVALUATION
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>
        /// Evaluates whether an input forensics strategy call should fire.
        /// Checks completed laps for notable events.
        /// Returns null if no call needed or cooldown active.
        /// </summary>
        public StrategyCall Evaluate(DateTime now)
        {
            if (_completedLaps.Count == 0) return null;

            if ((now - _lastCallTime).TotalSeconds < CooldownSeconds)
                return null;

            var latest = _completedLaps[_completedLaps.Count - 1];

            // Priority 1: Sawing detected (very low smoothness)
            if (latest.SteeringSmoothness < 0.4)
            {
                _lastCallTime = now;
                return new StrategyCall
                {
                    Label = "STEER",
                    Message = $"Steering inputs are rough — smoothness {latest.SteeringSmoothness:F2}. Focus on progressive hand movements.",
                    Severity = 3,
                    DisplayedAt = now
                };
            }

            // Priority 2: Throttle oscillation (poor discipline)
            if (latest.ThrottleDiscipline < 0.5 && latest.ThrottleOscillations >= 3)
            {
                _lastCallTime = now;
                return new StrategyCall
                {
                    Label = "THRTL",
                    Message = $"{latest.ThrottleOscillations} throttle corrections detected — ease on power earlier at corner exit.",
                    Severity = 3,
                    DisplayedAt = now
                };
            }

            // Priority 3: Technique degrading (compare to earlier laps)
            if (_completedLaps.Count >= 3)
            {
                var recentAvg = _completedLaps.Skip(_completedLaps.Count - 2)
                    .Average(l => l.SteeringSmoothness);
                var earlyAvg = _completedLaps.Take(Math.Min(3, _completedLaps.Count - 2))
                    .Average(l => l.SteeringSmoothness);

                if (earlyAvg - recentAvg > 0.15)
                {
                    _lastCallTime = now;
                    return new StrategyCall
                    {
                        Label = "FOCUS",
                        Message = "Technique degrading — smoothness dropping compared to earlier laps. Fatigue?",
                        Severity = 2,
                        DisplayedAt = now
                    };
                }
            }

            // Priority 4: Smooth lap (positive reinforcement)
            if (latest.SteeringSmoothness >= 0.85 && latest.ThrottleDiscipline >= 0.85
                && (int)latest.AverageTrailGrade <= (int)TrailBrakeGrade.B)
            {
                _lastCallTime = now;
                return new StrategyCall
                {
                    Label = "CLEAN",
                    Message = "Great technique this lap — smooth inputs, solid trail braking. Keep it up.",
                    Severity = 1,
                    DisplayedAt = now
                };
            }

            // Priority 5: Trail braking improving
            if (_completedLaps.Count >= 2)
            {
                var prev = _completedLaps[_completedLaps.Count - 2];
                if ((int)latest.AverageTrailGrade < (int)prev.AverageTrailGrade
                    && (int)latest.AverageTrailGrade <= (int)TrailBrakeGrade.B)
                {
                    _lastCallTime = now;
                    return new StrategyCall
                    {
                        Label = "BRAKE",
                        Message = $"Trail braking improved to grade {latest.AverageTrailGrade}. Good progression.",
                        Severity = 1,
                        DisplayedAt = now
                    };
                }
            }

            return null;
        }

        /// <summary>Resets cooldown state (for testing).</summary>
        public void ResetCooldown()
        {
            _lastCallTime = DateTime.MinValue;
        }

        /// <summary>Resets all state (for testing).</summary>
        public void Reset()
        {
            _currentLapSamples.Clear();
            _completedLaps.Clear();
            _lastCompletedLap = -1;
            _lastCallTime = DateTime.MinValue;
            _frameTimestamp = 0.0;
            LastSmoothness = 0.0;
            LastTrailGrade = TrailBrakeGrade.F;
            LastThrottleDiscipline = 0.0;
        }
    }
}
