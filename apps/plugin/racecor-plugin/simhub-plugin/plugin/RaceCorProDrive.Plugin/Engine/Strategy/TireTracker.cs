using System;
using System.Collections.Generic;
using System.Linq;

namespace RaceCorProDrive.Plugin.Engine.Strategy
{
    /// <summary>
    /// Tracks tire lifecycle across a stint: wear rate, grip degradation,
    /// temperature window, and predicts remaining tire life.
    /// Produces strategy calls when tires are overheating, losing grip,
    /// or approaching end of life.
    /// </summary>
    public class TireTracker
    {
        // ── Temperature window (typical GT3/GTE ranges) ─────────────────
        private const double TempOptimalLow  = 78.0;   // °C
        private const double TempOptimalHigh = 102.0;   // °C
        private const double TempOverheatWarn = 108.0;  // °C
        private const double TempColdWarn     = 70.0;   // °C

        // ── Wear thresholds ─────────────────────────────────────────────
        private const double WearHealthy     = 0.40;   // 0-1 (0 = new, 1 = gone)
        private const double WearWarning     = 0.65;
        private const double WearCritical    = 0.82;

        // ── Grip degradation tracking ───────────────────────────────────
        private double _peakLatGThisLap;
        private int    _absCountThisLap;
        private int    _tcCountThisLap;
        private bool   _absWasActive;
        private bool   _tcWasActive;

        // ── Per-lap accumulator for tire temps ──────────────────────────
        private double[] _tempAccumFL = new double[0];

        // ── Validation: previous-frame wear for spike rejection ─────────
        private double[] _prevWear = new double[4];
        private bool _prevWearValid;
        /// <summary>Max wear jump per frame before value is rejected as a spike.
        /// At 60 FPS the fastest realistic wear is ~0.02/s → 0.00033/frame.
        /// We allow 15× headroom for physics hiccups and low-FPS scenarios.</summary>
        private const double MaxWearDeltaPerFrame = 0.005;

        // ── Temperature sanity range ────────────────────────────────────
        private const double TempAbsoluteMin = 0.0;    // °C
        private const double TempAbsoluteMax = 300.0;   // °C — above this is sensor garbage

        // ── Cooldowns ───────────────────────────────────────────────────
        private DateTime _lastTempCall  = DateTime.MinValue;
        private DateTime _lastWearCall  = DateTime.MinValue;
        private DateTime _lastGripCall  = DateTime.MinValue;
        private const double TempCooldownSec = 45.0;
        private const double WearCooldownSec = 60.0;
        private const double GripCooldownSec = 45.0;

        // ── Public state for dashboard ──────────────────────────────────
        /// <summary>Current tire wear [FL, FR, RL, RR] (0 = new, 1 = gone).</summary>
        public double[] CurrentWear { get; private set; } = new double[4];

        /// <summary>Current tire temps [FL, FR, RL, RR] (°C).</summary>
        public double[] CurrentTemp { get; private set; } = new double[4];

        /// <summary>Estimated laps of tire life remaining before critical wear.</summary>
        public double EstimatedLapsRemaining { get; private set; } = 99;

        /// <summary>Overall tire health: 0 = green, 1 = yellow (warning), 2 = red (critical).</summary>
        public int TireHealthState { get; private set; }

        /// <summary>Grip degradation score: 0 = full grip, 1 = no grip. Composite metric.</summary>
        public double GripScore { get; private set; }

        /// <summary>Temperature state: 0 = cold, 1 = optimal, 2 = hot.</summary>
        public int[] TempState { get; private set; } = new int[4];

        // ═══════════════════════════════════════════════════════════════
        //  UPDATE (called every frame)
        // ═══════════════════════════════════════════════════════════════

        /// <summary>
        /// Per-frame update. Tracks grip indicators within the current lap.
        /// </summary>
        public void UpdateFrame(TelemetrySnapshot s)
        {
            // Track peak lateral G this lap
            double absLatG = Math.Abs(s.LatAccel);
            if (absLatG > _peakLatGThisLap)
                _peakLatGThisLap = absLatG;

            // Count ABS/TC activations (rising edge detection)
            if (s.AbsActive && !_absWasActive) _absCountThisLap++;
            if (s.TcActive && !_tcWasActive)   _tcCountThisLap++;
            _absWasActive = s.AbsActive;
            _tcWasActive = s.TcActive;

            // ── Validate & update wear values ────────────────────────────
            double[] rawWear = { s.TyreWearFL, s.TyreWearFR, s.TyreWearRL, s.TyreWearRR };
            for (int i = 0; i < 4; i++)
            {
                double w = rawWear[i];

                // Clamp to valid 0-1 range (garbage data or unit mismatch)
                w = Math.Max(0.0, Math.Min(1.0, w));

                // Spike rejection: if we have a prior frame and the jump is
                // impossibly large, hold the previous value instead
                if (_prevWearValid && Math.Abs(w - _prevWear[i]) > MaxWearDeltaPerFrame)
                {
                    // Allow the jump if wear DECREASED (pit stop / tire change)
                    if (w >= _prevWear[i])
                        w = _prevWear[i]; // reject upward spike, hold previous
                }

                CurrentWear[i] = w;
                _prevWear[i] = w;
            }
            _prevWearValid = true;

            // ── Validate & update temperature values ─────────────────────
            double[] rawTemp = { s.TyreTempFL, s.TyreTempFR, s.TyreTempRL, s.TyreTempRR };
            for (int i = 0; i < 4; i++)
            {
                double t = rawTemp[i];
                // Clamp to physically plausible range
                t = Math.Max(TempAbsoluteMin, Math.Min(TempAbsoluteMax, t));
                CurrentTemp[i] = t;
            }

            // Temperature states
            for (int i = 0; i < 4; i++)
            {
                if (CurrentTemp[i] < TempColdWarn) TempState[i] = 0;
                else if (CurrentTemp[i] > TempOverheatWarn) TempState[i] = 2;
                else TempState[i] = 1;
            }
        }

        /// <summary>
        /// Called once per lap crossing. Records stint data and resets per-lap accumulators.
        /// </summary>
        public void OnLapCompleted(StintData stint, TelemetrySnapshot s, double lastLapFuel)
        {
            if (stint == null) return;

            // Use validated wear from CurrentWear (already clamped & spike-filtered by UpdateFrame)
            double[] validatedWear = (double[])CurrentWear.Clone();

            // Record wear delta this lap
            double[] wearDelta = new double[4];
            if (stint.WearPerLap.Count > 0)
            {
                // Wear delta = current wear minus wear at start of this lap
                // Since wear accumulates, we track the difference
                var prevCumulative = stint.CumulativeWear;
                wearDelta[0] = Math.Max(0, validatedWear[0] - (stint.StartLap > 0 ? prevCumulative[0] : 0));
                wearDelta[1] = Math.Max(0, validatedWear[1] - (stint.StartLap > 0 ? prevCumulative[1] : 0));
                wearDelta[2] = Math.Max(0, validatedWear[2] - (stint.StartLap > 0 ? prevCumulative[2] : 0));
                wearDelta[3] = Math.Max(0, validatedWear[3] - (stint.StartLap > 0 ? prevCumulative[3] : 0));
            }

            stint.WearPerLap.Add(wearDelta);
            stint.PeakLatG.Add(_peakLatGThisLap);
            stint.AbsActivationsPerLap.Add(_absCountThisLap);
            stint.TcActivationsPerLap.Add(_tcCountThisLap);
            stint.TempPerLap.Add((double[])CurrentTemp.Clone());

            // Estimate remaining tire life
            EstimatedLapsRemaining = stint.EstimateLapsToWearThreshold(CurrentWear, WearCritical);

            // Compute overall health state
            double maxWear = CurrentWear.Max();
            if (maxWear >= WearCritical) TireHealthState = 2;
            else if (maxWear >= WearWarning) TireHealthState = 1;
            else TireHealthState = 0;

            // Compute grip degradation score (composite)
            ComputeGripScore(stint);

            // Reset per-lap accumulators
            _peakLatGThisLap = 0;
            _absCountThisLap = 0;
            _tcCountThisLap = 0;
        }

        /// <summary>Reset state for a new stint (after pit stop).</summary>
        public void OnNewStint()
        {
            _peakLatGThisLap = 0;
            _absCountThisLap = 0;
            _tcCountThisLap = 0;
            _absWasActive = false;
            _tcWasActive = false;
            GripScore = 0;
            TireHealthState = 0;
            EstimatedLapsRemaining = 99;
            // Reset spike rejection — new tires will have a large wear jump
            _prevWearValid = false;
        }

        // ═══════════════════════════════════════════════════════════════
        //  STRATEGY CALLS
        // ═══════════════════════════════════════════════════════════════

        /// <summary>
        /// Evaluate tire state and produce a strategy call if warranted.
        /// Returns null if no call is needed (everything normal or on cooldown).
        /// </summary>
        public StrategyCall Evaluate(StintData stint)
        {
            var now = DateTime.UtcNow;

            // ── Critical wear ───────────────────────────────────────────
            if (TireHealthState == 2 && (now - _lastWearCall).TotalSeconds >= WearCooldownSec)
            {
                _lastWearCall = now;
                string worst = WorstTireLabel();
                double trend = stint.LapTimeTrend;
                string paceNote = trend > 0.15
                    ? $" — pace dropping {trend:F1}s/lap"
                    : "";
                return new StrategyCall
                {
                    Module = "tire",
                    Severity = 4,
                    Label = "TYRES",
                    Message = $"{worst} critically worn{paceNote}. Pit at the earliest opportunity.",
                    CooldownSeconds = WearCooldownSec
                };
            }

            // ── Warning wear ────────────────────────────────────────────
            if (TireHealthState == 1 && EstimatedLapsRemaining < 10
                && (now - _lastWearCall).TotalSeconds >= WearCooldownSec)
            {
                _lastWearCall = now;
                return new StrategyCall
                {
                    Module = "tire",
                    Severity = 2,
                    Label = "TYRES",
                    Message = $"Tyre life estimate: ~{EstimatedLapsRemaining:F0} laps before they fall off.",
                    CooldownSeconds = WearCooldownSec
                };
            }

            // ── Overheating ─────────────────────────────────────────────
            bool anyHot = TempState.Any(t => t == 2);
            if (anyHot && (now - _lastTempCall).TotalSeconds >= TempCooldownSec)
            {
                _lastTempCall = now;
                var hotTires = new List<string>();
                if (TempState[0] == 2) hotTires.Add("FL");
                if (TempState[1] == 2) hotTires.Add("FR");
                if (TempState[2] == 2) hotTires.Add("RL");
                if (TempState[3] == 2) hotTires.Add("RR");
                return new StrategyCall
                {
                    Module = "tire",
                    Severity = 2,
                    Label = "TYRES",
                    Message = $"{string.Join("+", hotTires)} overheating — ease the inputs to bring temps down.",
                    CooldownSeconds = TempCooldownSec
                };
            }

            // ── Cold tires (outlap) ─────────────────────────────────────
            bool anyCold = TempState.Any(t => t == 0) && CurrentTemp.Any(t => t > 10);
            if (anyCold && stint.LapsCompleted <= 2
                && (now - _lastTempCall).TotalSeconds >= TempCooldownSec)
            {
                _lastTempCall = now;
                return new StrategyCall
                {
                    Module = "tire",
                    Severity = 1,
                    Label = "TYRES",
                    Message = "Tyres still building temperature — be gentle for another lap or two.",
                    CooldownSeconds = TempCooldownSec
                };
            }

            // ── Grip degradation ────────────────────────────────────────
            if (GripScore > 0.6 && (now - _lastGripCall).TotalSeconds >= GripCooldownSec)
            {
                _lastGripCall = now;
                int sev = GripScore > 0.8 ? 3 : 2;
                return new StrategyCall
                {
                    Module = "tire",
                    Severity = sev,
                    Label = "GRIP",
                    Message = GripScore > 0.8
                        ? "Significant grip loss detected — ABS/TC working overtime. Consider pitting."
                        : "Grip starting to fade — you may notice longer braking zones.",
                    CooldownSeconds = GripCooldownSec
                };
            }

            return null;
        }

        // ═══════════════════════════════════════════════════════════════
        //  INTERNALS
        // ═══════════════════════════════════════════════════════════════

        private void ComputeGripScore(StintData stint)
        {
            if (stint.LapsCompleted < 3) { GripScore = 0; return; }

            double score = 0;
            int factors = 0;

            // Factor 1: Peak lat G degradation vs first 3 laps
            if (stint.PeakLatG.Count >= 5)
            {
                double earlyG = stint.PeakLatG.Take(3).Average();
                double recentG = stint.PeakLatG.Skip(stint.PeakLatG.Count - 3).Average();
                if (earlyG > 0.1)
                {
                    double gDrop = Math.Max(0, (earlyG - recentG) / earlyG);
                    score += Math.Min(1.0, gDrop * 3.0); // 33% G drop = 1.0 score
                    factors++;
                }
            }

            // Factor 2: ABS/TC frequency increase
            if (stint.AbsActivationsPerLap.Count >= 5)
            {
                double earlyAbs = stint.AbsActivationsPerLap.Take(3).Average();
                double recentAbs = stint.AbsActivationsPerLap.Skip(stint.AbsActivationsPerLap.Count - 3).Average();
                if (recentAbs > earlyAbs + 3) // significant increase
                {
                    double increase = (recentAbs - earlyAbs) / Math.Max(1, earlyAbs);
                    score += Math.Min(1.0, increase * 0.5);
                    factors++;
                }
            }

            // Factor 3: Lap time trend (positive = getting slower)
            double trend = stint.LapTimeTrend;
            if (trend > 0.05) // more than 50ms/lap degradation
            {
                // Approximate fuel correction: ~0.05s/lap lighter
                double fuelCorrected = trend - 0.05;
                if (fuelCorrected > 0)
                {
                    score += Math.Min(1.0, fuelCorrected * 2.0); // 0.5s/lap = 1.0
                    factors++;
                }
            }

            // Factor 4: Raw wear level
            double maxWear = CurrentWear.Max();
            score += maxWear; // direct 0-1 mapping
            factors++;

            GripScore = factors > 0 ? Math.Min(1.0, score / factors) : 0;
        }

        private string WorstTireLabel()
        {
            double max = 0;
            int idx = 0;
            for (int i = 0; i < 4; i++)
            {
                if (CurrentWear[i] > max) { max = CurrentWear[i]; idx = i; }
            }
            return new[] { "Front-left", "Front-right", "Rear-left", "Rear-right" }[idx];
        }
    }
}
