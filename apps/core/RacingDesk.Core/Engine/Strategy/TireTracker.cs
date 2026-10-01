using System;
using System.Collections.Generic;
using System.Linq;

namespace RacingDesk.Plugin.Engine.Strategy
{
    /// <summary>
    /// Tracks tire lifecycle across a stint: tread as the sim measures it, grip degradation, temperature window,
    /// and what tire life is left. Produces strategy calls when tires are overheating, losing grip, or measured
    /// at the worn end.
    ///
    /// Tyre wear here is what it is everywhere else: <b>tread remaining, 0..100 %, 100 = new</b>, null where not
    /// measured (<see cref="TyreWear"/>). iRacing measures tread <b>in the pits and nowhere else</b> — the value sits
    /// still for a whole stint and moves on pit road — so the wear health is rated when a measurement comes in, a
    /// value that has not changed is not news, and a new set is not judged by the readings of the set that came off.
    /// New tyres (100) never warn.
    /// </summary>
    public class TireTracker
    {
        // ── Temperature window (typical GT3/GTE ranges) ─────────────────
        private const double TempOptimalLow  = 78.0;   // °C
        private const double TempOptimalHigh = 102.0;   // °C
        private const double TempOverheatWarn = 108.0;  // °C
        private const double TempColdWarn     = 70.0;   // °C

        // ── Grip degradation tracking ───────────────────────────────────
        private double _peakLatGThisLap;
        private int    _absCountThisLap;
        private int    _tcCountThisLap;
        private bool   _absWasActive;
        private bool   _tcWasActive;

        // ── Wear: the measurement, and what it was at the last lap crossing ──
        private readonly double?[] _treadAtLastLap = new double?[4];
        private bool _inPitLane;

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
        /// <summary>
        /// Tread remaining [FL, FR, RL, RR] as the sim last measured it, 0..100 % (100 = new); null where it has not
        /// been measured. The number the HUD's rings show, never converted.
        /// </summary>
        public double?[] TreadRemaining { get; } = new double?[4];

        /// <summary>
        /// True for the frame a measurement came in on — a corner's value changed, or was first said since the last
        /// <see cref="Reset"/> — and false on every other frame. The coordinator evaluates the tyre calls on it.
        /// </summary>
        public bool NewMeasurement { get; private set; }

        /// <summary>Current tire temps [FL, FR, RL, RR] (°C).</summary>
        public double[] CurrentTemp { get; private set; } = new double[4];

        /// <summary>
        /// Laps of tire life left before the critical tread, where the tread has been seen to go down lap by lap;
        /// 0 once a tyre has measured critical; 99 where there is nothing to say (iRacing, between pit stops).
        /// </summary>
        public double EstimatedLapsRemaining { get; private set; } = 99;

        /// <summary>
        /// Tire health from the last measurement: 0 = fine, 1 = worn (a tyre under <see cref="TyreWear.WarnBelowPercent"/>),
        /// 2 = critical (under <see cref="TyreWear.CriticalBelowPercent"/>; the pit box offers a change). Cleared at a
        /// stop where a tyre was asked for, until the sim measures again.
        /// </summary>
        public int TireHealthState { get; private set; }

        /// <summary>Grip degradation score: 0 = full grip, 1 = no grip. Composite metric.</summary>
        public double GripScore { get; private set; }

        /// <summary>Temperature state: 0 = cold, 1 = optimal, 2 = hot.</summary>
        public int[] TempState { get; private set; } = new int[4];

        // ═══════════════════════════════════════════════════════════════
        //  UPDATE (called every frame)
        // ═══════════════════════════════════════════════════════════════

        /// <summary>
        /// Per-frame update. Tracks grip indicators within the current lap, and takes a tread measurement when the
        /// sim gives one.
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
            _inPitLane = s.IsInPitLane;

            // ── Tread: a measurement, taken as it is ─────────────────────
            // No clamp to 0..1 (the value is 0..100), no spike filter: the step at pit entry is the measurement, and a
            // filter that held it back would hold back the one true reading there is.
            double?[] measured = { s.TyreWearFL, s.TyreWearFR, s.TyreWearRL, s.TyreWearRR };
            bool changed = false;
            for (int i = 0; i < 4; i++)
            {
                if (Same(measured[i], TreadRemaining[i])) continue;
                TreadRemaining[i] = measured[i];
                changed = true;
            }
            NewMeasurement = changed && TreadRemaining.Any(t => t.HasValue);
            if (NewMeasurement) RateHealth();
            else if (changed) { TireHealthState = 0; EstimatedLapsRemaining = 99; } // the sim stopped saying

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

            // Tread lost this lap per corner, in points of percent: nought where the sim has not measured again
            // (iRacing measures in the pits, so a sim with live wear is the only one this moves for).
            double[] lost = new double[4];
            for (int i = 0; i < 4; i++)
            {
                if (TreadRemaining[i].HasValue && _treadAtLastLap[i].HasValue)
                    lost[i] = Math.Max(0, _treadAtLastLap[i].Value - TreadRemaining[i].Value);
                _treadAtLastLap[i] = TreadRemaining[i];
            }

            stint.WearPerLap.Add(lost);
            stint.PeakLatG.Add(_peakLatGThisLap);
            stint.AbsActivationsPerLap.Add(_absCountThisLap);
            stint.TcActivationsPerLap.Add(_tcCountThisLap);
            stint.TempPerLap.Add((double[])CurrentTemp.Clone());

            // Estimate remaining tire life; a tyre measured critical has none
            EstimatedLapsRemaining = TireHealthState == 2
                ? 0
                : stint.EstimateLapsToCritical(TreadRemaining, TyreWear.CriticalBelowPercent);

            // The health is rated from a measurement (UpdateFrame), not here: an unchanged value is not news.

            // Compute grip degradation score (composite)
            ComputeGripScore(stint);

            // Reset per-lap accumulators
            _peakLatGThisLap = 0;
            _absCountThisLap = 0;
            _tcCountThisLap = 0;
        }

        /// <summary>
        /// Everything forgotten: a session reset, or the first stint of a session. The next frame's tread is taken as a
        /// measurement and rated.
        /// </summary>
        public void Reset()
        {
            ResetLapAccumulators();
            for (int i = 0; i < 4; i++) { TreadRemaining[i] = null; _treadAtLastLap[i] = null; }
            NewMeasurement = false;
            GripScore = 0;
            TireHealthState = 0;
            EstimatedLapsRemaining = 99;
        }

        /// <summary>
        /// A new stint after a stop. <paramref name="tyresChanged"/>: a tyre was asked for at the stop, so the set may be
        /// another and the reading the sim shows may be the set that came off (iRacing shows the removed set's readings
        /// after a change) — the health is cleared until the sim measures again. Otherwise the set is the one that was
        /// measured, and what it measured stands.
        /// </summary>
        public void OnNewStint(bool tyresChanged)
        {
            ResetLapAccumulators();
            GripScore = 0;
            for (int i = 0; i < 4; i++) _treadAtLastLap[i] = null;
            if (tyresChanged)
            {
                TireHealthState = 0;
                EstimatedLapsRemaining = 99;
            }
        }

        private void ResetLapAccumulators()
        {
            _peakLatGThisLap = 0;
            _absCountThisLap = 0;
            _tcCountThisLap = 0;
            _absWasActive = false;
            _tcWasActive = false;
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
            double? worst = Worst();

            // ── Critical: a tyre measured under the critical tread ──────
            if (TireHealthState == 2 && worst.HasValue && (now - _lastWearCall).TotalSeconds >= WearCooldownSec)
            {
                _lastWearCall = now;
                double trend = stint?.LapTimeTrend ?? 0;
                string paceNote = trend > 0.15
                    ? $" — pace dropping {trend:F1}s/lap"
                    : "";
                string act = _inPitLane ? "Take tyres at this stop." : "Pit for tyres at the first chance.";
                return new StrategyCall
                {
                    Module = "tire",
                    Severity = 4,
                    Label = "TYRES",
                    Message = $"{WorstTireLabel()} measured at {worst.Value:0}% tread{paceNote}. {act}",
                    CooldownSeconds = WearCooldownSec
                };
            }

            // ── Worn: a tyre measured under the warning tread ───────────
            if (TireHealthState == 1 && worst.HasValue && (now - _lastWearCall).TotalSeconds >= WearCooldownSec)
            {
                _lastWearCall = now;
                string lapsNote = EstimatedLapsRemaining > 0 && EstimatedLapsRemaining < 99
                    ? $" — about {EstimatedLapsRemaining:F0} laps before they fall off"
                    : "";
                return new StrategyCall
                {
                    Module = "tire",
                    Severity = 2,
                    Label = "TYRES",
                    Message = $"{WorstTireLabel()} measured at {worst.Value:0}% tread{lapsNote}. Think about tyres at the next stop.",
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
            if (anyCold && stint != null && stint.LapsCompleted <= 2
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

        /// <summary>The worst corner's tread remaining of those measured, or null where none is.</summary>
        public double? Worst() => TyreWear.Worst(TreadRemaining[0], TreadRemaining[1], TreadRemaining[2], TreadRemaining[3]);

        private void RateHealth()
        {
            double? worst = Worst();
            TireHealthState = TyreWear.IsCritical(worst) ? 2 : TyreWear.IsWorn(worst) ? 1 : 0;
            if (TireHealthState == 2) EstimatedLapsRemaining = 0;
            else if (EstimatedLapsRemaining <= 0) EstimatedLapsRemaining = 99;
        }

        private static bool Same(double? a, double? b) =>
            a.HasValue == b.HasValue && (!a.HasValue || Math.Abs(a.Value - b.Value) < 1e-6);

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

            // Factor 4: the tread gone from the worst corner, where it has been measured (a new tyre adds nothing)
            double? worst = Worst();
            if (worst.HasValue)
            {
                score += (100.0 - worst.Value) / 100.0;
                factors++;
            }

            GripScore = factors > 0 ? Math.Min(1.0, score / factors) : 0;
        }

        private string WorstTireLabel()
        {
            double? worst = Worst();
            int idx = 0;
            for (int i = 0; i < 4; i++)
            {
                if (TreadRemaining[i].HasValue && worst.HasValue && TreadRemaining[i].Value <= worst.Value) { idx = i; break; }
            }
            return new[] { "Front-left", "Front-right", "Rear-left", "Rear-right" }[idx];
        }
    }
}
