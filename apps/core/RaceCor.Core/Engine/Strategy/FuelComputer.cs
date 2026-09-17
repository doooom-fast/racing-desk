using System;
using System.Collections.Generic;
using System.Linq;

namespace RaceCorProDrive.Plugin.Engine.Strategy
{
    /// <summary>
    /// Computes fuel strategy: burn rate variance, minimum fuel to finish,
    /// pit window timing, and fuel-saving projections.
    /// </summary>
    public class FuelComputer
    {
        // ── Configuration ───────────────────────────────────────────────
        /// <summary>Estimated pit lane time loss in seconds (default for road courses).</summary>
        public double PitLaneTimeLoss { get; set; } = 25.0;

        // ── Calibration state ───────────────────────────────────────────
        private bool _calibratingPitTime;
        private double _pitEntryTime;

        // ── Cooldowns ───────────────────────────────────────────────────
        private DateTime _lastFuelCall    = DateTime.MinValue;
        private DateTime _lastPitWinCall  = DateTime.MinValue;
        private DateTime _lastSavingCall  = DateTime.MinValue;
        private const double FuelCooldownSec     = 45.0;
        private const double PitWinCooldownSec   = 90.0;  // pit window changes slowly
        private const double SavingCooldownSec   = 60.0;

        // ── Fuel saving detection ───────────────────────────────────────
        private double _avgBurnEarly;  // average burn from first 5 laps
        private bool _avgBurnEarlySet;

        // ── Validation constants ──────────────────────────────────────────
        /// <summary>Maximum plausible fuel level in liters (largest GT/prototype tanks).</summary>
        private const double MaxFuelCapacity = 200.0;
        /// <summary>Maximum plausible fuel burn per lap in liters (worst-case big-displacement car).</summary>
        private const double MaxBurnPerLap = 25.0;
        /// <summary>Previous frame fuel for delta sanity check.</summary>
        private double _prevFuel = -1;

        // ── Public state for dashboard ──────────────────────────────────

        /// <summary>Fuel remaining in liters.</summary>
        public double FuelRemaining { get; private set; }

        /// <summary>Laps of fuel remaining at current burn rate.</summary>
        public double FuelLapsRemaining { get; private set; }

        /// <summary>Laps remaining in the race (session laps or time-based estimate).</summary>
        public double RaceLapsRemaining { get; private set; }

        /// <summary>Average fuel burn per lap (trimmed mean, liters).</summary>
        public double AvgBurnPerLap { get; private set; }

        /// <summary>Fuel burn standard deviation (liters).</summary>
        public double BurnVariance { get; private set; }

        /// <summary>Minimum fuel needed to finish without pitting (liters).</summary>
        public double MinFuelToFinish { get; private set; }

        /// <summary>True if the driver can make it to the end without another pit stop.</summary>
        public bool CanMakeItToEnd { get; private set; }

        /// <summary>Earliest lap you should pit (fuel will last this many more laps).</summary>
        public int PitWindowOpen { get; private set; }

        /// <summary>Latest lap you can pit without running dry (accounting for pit time loss).</summary>
        public int PitWindowClose { get; private set; }

        /// <summary>Overall fuel state: 0 = comfortable, 1 = marginal, 2 = critical.</summary>
        public int FuelHealthState { get; private set; }

        /// <summary>True if fuel saving mode is detected (recent laps consuming less than early stint).</summary>
        public bool FuelSavingDetected { get; private set; }

        /// <summary>Extra laps gained through fuel saving (if detected).</summary>
        public double FuelSavingLapsGained { get; private set; }

        // ═══════════════════════════════════════════════════════════════
        //  UPDATE (called every frame)
        // ═══════════════════════════════════════════════════════════════

        public void UpdateFrame(TelemetrySnapshot s)
        {
            // ── Validate fuel level ──────────────────────────────────────
            double fuel = s.FuelLevel;
            if (double.IsNaN(fuel) || double.IsInfinity(fuel) || fuel < 0)
                fuel = _prevFuel >= 0 ? _prevFuel : 0;
            fuel = Math.Min(fuel, MaxFuelCapacity);
            _prevFuel = fuel;

            FuelRemaining = fuel;

            // Detect pit lane entry/exit for pit time calibration
            if (s.IsInPitLane && !_calibratingPitTime)
            {
                _calibratingPitTime = true;
                _pitEntryTime = s.LapCurrentTime > 0 ? s.LapCurrentTime : 0;
            }
            else if (!s.IsInPitLane && _calibratingPitTime)
            {
                _calibratingPitTime = false;
                double pitTime = s.LapCurrentTime - _pitEntryTime;
                if (pitTime > 10 && pitTime < 120) // sanity check
                {
                    // Smooth toward observed pit time
                    PitLaneTimeLoss = PitLaneTimeLoss * 0.3 + pitTime * 0.7;
                }
            }
        }

        /// <summary>
        /// Called once per lap crossing. Recomputes all fuel projections.
        /// </summary>
        public void OnLapCompleted(StintData stint, TelemetrySnapshot s, double fuelUsedThisLap)
        {
            if (stint == null) return;

            // ── Validate fuel burn ───────────────────────────────────────
            // Reject negative burns (refueling mid-lap shouldn't count as usage),
            // NaN/Infinity, and impossibly high single-lap burns.
            if (double.IsNaN(fuelUsedThisLap) || double.IsInfinity(fuelUsedThisLap))
                fuelUsedThisLap = 0;
            fuelUsedThisLap = Math.Max(0, Math.Min(MaxBurnPerLap, fuelUsedThisLap));

            // Reject outlier laps: if we have history, reject burns > 3× average
            if (stint.FuelPerLap.Count >= 3)
            {
                double avg = stint.AvgFuelPerLap;
                if (avg > 0.01 && fuelUsedThisLap > avg * 3.0)
                    fuelUsedThisLap = avg; // substitute average for the spike
            }

            stint.FuelPerLap.Add(fuelUsedThisLap);

            // Update burn statistics
            AvgBurnPerLap = stint.AvgFuelPerLap;
            BurnVariance = stint.FuelBurnStdDev;

            // Store early burn rate for fuel saving detection
            if (!_avgBurnEarlySet && stint.FuelPerLap.Count >= 5)
            {
                _avgBurnEarly = stint.FuelPerLap.Take(5).Average();
                _avgBurnEarlySet = true;
            }

            // Race laps remaining
            RaceLapsRemaining = EstimateRaceLapsRemaining(s);

            // Fuel laps remaining
            FuelLapsRemaining = AvgBurnPerLap > 0.01 ? FuelRemaining / AvgBurnPerLap : 99;

            // Can we make it to end?
            double safetyMargin = RaceLapsRemaining > 30 ? 2.0 : 1.0; // more margin for endurance
            MinFuelToFinish = (RaceLapsRemaining + safetyMargin) * AvgBurnPerLap;
            CanMakeItToEnd = FuelRemaining >= MinFuelToFinish;

            // Fuel health state
            double fuelDeficit = MinFuelToFinish - FuelRemaining;
            if (fuelDeficit > AvgBurnPerLap * 2) FuelHealthState = 2;      // need to pit
            else if (fuelDeficit > 0) FuelHealthState = 1;                  // marginal
            else FuelHealthState = 0;                                        // comfortable

            // Pit window calculation
            ComputePitWindow(s, stint);

            // Fuel saving detection
            DetectFuelSaving(stint);
        }

        /// <summary>Reset state for a new stint.</summary>
        public void OnNewStint()
        {
            _avgBurnEarlySet = false;
            FuelSavingDetected = false;
            FuelSavingLapsGained = 0;
            _prevFuel = -1; // reset fuel tracking for spike rejection
        }

        // ═══════════════════════════════════════════════════════════════
        //  STRATEGY CALLS
        // ═══════════════════════════════════════════════════════════════

        public StrategyCall Evaluate(StintData stint, TelemetrySnapshot s)
        {
            if (stint == null || stint.LapsCompleted < 2) return null;
            var now = DateTime.UtcNow;

            // ── Critical: about to run out ──────────────────────────────
            if (FuelLapsRemaining < 3 && !s.IsInPitLane
                && (now - _lastFuelCall).TotalSeconds >= 20)
            {
                _lastFuelCall = now;
                return new StrategyCall
                {
                    Module = "fuel",
                    Severity = FuelLapsRemaining < 1.5 ? 5 : 4,
                    Label = "FUEL",
                    Message = FuelLapsRemaining < 1.5
                        ? $"FUEL CRITICAL — {FuelLapsRemaining:F1} laps remaining. Pit immediately!"
                        : $"Low fuel — {FuelLapsRemaining:F1} laps remaining. Pit within {Math.Max(1, (int)(FuelLapsRemaining - 1))} laps.",
                    CooldownSeconds = 20
                };
            }

            // ── Pit window ──────────────────────────────────────────────
            if (!CanMakeItToEnd && PitWindowClose > 0
                && (now - _lastPitWinCall).TotalSeconds >= PitWinCooldownSec)
            {
                int currentLap = s.CompletedLaps;
                int lapsUntilClose = PitWindowClose - currentLap;

                if (lapsUntilClose <= 5 && lapsUntilClose > 0)
                {
                    _lastPitWinCall = now;
                    return new StrategyCall
                    {
                        Module = "fuel",
                        Severity = lapsUntilClose <= 2 ? 3 : 2,
                        Label = "PIT WINDOW",
                        Message = $"Pit window closes in {lapsUntilClose} laps. Fuel for {FuelLapsRemaining:F1} more laps.",
                        CooldownSeconds = PitWinCooldownSec
                    };
                }
                else if (lapsUntilClose > 5)
                {
                    _lastPitWinCall = now;
                    return new StrategyCall
                    {
                        Module = "fuel",
                        Severity = 1,
                        Label = "FUEL",
                        Message = $"Fuel for {FuelLapsRemaining:F1} laps, need {RaceLapsRemaining:F0} to finish — pit window laps {PitWindowOpen}-{PitWindowClose}.",
                        CooldownSeconds = PitWinCooldownSec
                    };
                }
            }

            // ── Fuel saving working ─────────────────────────────────────
            if (FuelSavingDetected && FuelSavingLapsGained >= 0.5
                && (now - _lastSavingCall).TotalSeconds >= SavingCooldownSec)
            {
                _lastSavingCall = now;
                return new StrategyCall
                {
                    Module = "fuel",
                    Severity = 1,
                    Label = "FUEL",
                    Message = $"Fuel saving is working — you've gained {FuelSavingLapsGained:F1} extra laps of range.",
                    CooldownSeconds = SavingCooldownSec
                };
            }

            // ── High burn variance ──────────────────────────────────────
            if (BurnVariance > AvgBurnPerLap * 0.15 && stint.LapsCompleted >= 5
                && (now - _lastFuelCall).TotalSeconds >= FuelCooldownSec)
            {
                double lastBurn = stint.FuelPerLap.Last();
                if (lastBurn > AvgBurnPerLap * 1.15)
                {
                    _lastFuelCall = now;
                    return new StrategyCall
                    {
                        Module = "fuel",
                        Severity = 1,
                        Label = "FUEL",
                        Message = $"Burning heavy this lap — {lastBurn:F2}L vs avg {AvgBurnPerLap:F2}L.",
                        CooldownSeconds = FuelCooldownSec
                    };
                }
            }

            return null;
        }

        // ═══════════════════════════════════════════════════════════════
        //  INTERNALS
        // ═══════════════════════════════════════════════════════════════

        private double EstimateRaceLapsRemaining(TelemetrySnapshot s)
        {
            // Prefer session laps remaining if available (lap-limited race)
            if (s.SessionLapsRemaining > 0)
                return s.SessionLapsRemaining;

            // Timed race: estimate from session time remaining and recent lap times
            if (s.SessionTimeRemain > 0 && s.LapLastTime > 10)
                return s.SessionTimeRemain / s.LapLastTime;

            // Fallback to SimHub's computed value
            return s.RemainingLaps > 0 ? s.RemainingLaps : 99;
        }

        private void ComputePitWindow(TelemetrySnapshot s, StintData stint)
        {
            if (CanMakeItToEnd || AvgBurnPerLap <= 0.01)
            {
                PitWindowOpen = 0;
                PitWindowClose = 0;
                return;
            }

            int currentLap = s.CompletedLaps;

            // Latest you can pit = laps of fuel remaining minus 1 (need fuel to get to pit)
            int lapsOfFuel = (int)Math.Floor(FuelLapsRemaining);
            PitWindowClose = currentLap + Math.Max(0, lapsOfFuel - 1);

            // Earliest you should pit = when it makes strategic sense
            // (filling up here gives you enough to finish)
            // Assume tank capacity is approximately what we started the stint with
            double tankCapacity = stint.StartFuel > 0 ? stint.StartFuel : FuelRemaining + AvgBurnPerLap * stint.LapsCompleted;
            double lapsOnFullTank = tankCapacity / AvgBurnPerLap;
            double totalLapsNeeded = RaceLapsRemaining;

            // If one more stop gets us to the end
            double lapsAfterPit = Math.Min(lapsOnFullTank, totalLapsNeeded);
            PitWindowOpen = currentLap + Math.Max(0, (int)(FuelLapsRemaining - lapsAfterPit));
        }

        private void DetectFuelSaving(StintData stint)
        {
            if (!_avgBurnEarlySet || stint.FuelPerLap.Count < 8) return;

            // Compare last 3 laps to early stint average
            double recentAvg = stint.FuelPerLap.Skip(stint.FuelPerLap.Count - 3).Average();
            double saving = _avgBurnEarly - recentAvg;

            if (saving > 0.02) // saving at least 20ml/lap
            {
                FuelSavingDetected = true;
                // Extra laps gained = total fuel saved / current burn rate
                FuelSavingLapsGained = (saving * stint.FuelPerLap.Count) / Math.Max(0.01, recentAvg);
            }
            else
            {
                FuelSavingDetected = false;
                FuelSavingLapsGained = 0;
            }
        }
    }
}
