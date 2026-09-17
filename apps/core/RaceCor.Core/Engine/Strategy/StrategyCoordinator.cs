using System;
using System.Collections.Generic;

namespace RaceCorProDrive.Plugin.Engine.Strategy
{
    /// <summary>
    /// Orchestrates all strategy modules: maintains stint lifecycle,
    /// runs per-frame and per-lap updates, collects strategy calls,
    /// and surfaces the highest-priority recommendation.
    /// </summary>
    public class StrategyCoordinator
    {
        // ── Category color for strategy calls (warm amber, distinct from flags) ──
        public const string StrategyColor     = "D4A017";    // amber/gold
        public const string StrategyTextColor = "#FFFFF176"; // light amber, WCAG AA

        // ── Modules ─────────────────────────────────────────────────────
        public TireTracker  Tires { get; } = new TireTracker();
        public FuelComputer Fuel  { get; } = new FuelComputer();

        // ── Stint management ────────────────────────────────────────────
        public StintData CurrentStint { get; private set; }
        public List<StintData> CompletedStints { get; } = new List<StintData>();
        private int _stintCounter;

        // ── Lap tracking ────────────────────────────────────────────────
        private int    _lastCompletedLaps = -1;
        private double _fuelAtLapStart;
        private bool   _wasInPitLane;

        // ── Current strategy call ───────────────────────────────────────
        private StrategyCall _currentCall;
        private DateTime     _callDisplayedAt = DateTime.MinValue;
        private const double CallDisplaySeconds = 12.0;

        // ── Module cooldown tracking (prevents same module from rapid-fire) ──
        private readonly Dictionary<string, DateTime> _moduleCooldowns
            = new Dictionary<string, DateTime>();

        // ── Public state (read by Plugin.cs, sent to dashboard) ─────────

        /// <summary>Current strategy message text, or "" if none active.</summary>
        public string CurrentText => IsVisible ? (_currentCall?.Message ?? "") : "";

        /// <summary>Current strategy label (e.g. "FUEL", "TYRES").</summary>
        public string CurrentLabel => IsVisible ? (_currentCall?.Label ?? "") : "";

        /// <summary>Current strategy severity (1-5).</summary>
        public int CurrentSeverity => IsVisible ? (_currentCall?.Severity ?? 0) : 0;

        /// <summary>True if a strategy call is currently being displayed.</summary>
        public bool IsVisible => _currentCall != null
            && (DateTime.UtcNow - _callDisplayedAt).TotalSeconds < CallDisplaySeconds;

        /// <summary>Seconds remaining on current call display.</summary>
        public double SecondsRemaining
        {
            get
            {
                if (!IsVisible) return 0;
                return Math.Max(0, CallDisplaySeconds - (DateTime.UtcNow - _callDisplayedAt).TotalSeconds);
            }
        }

        /// <summary>Number of completed stints this session.</summary>
        public int StintCount => _stintCounter;

        // ═══════════════════════════════════════════════════════════════
        //  LIFECYCLE
        // ═══════════════════════════════════════════════════════════════

        /// <summary>
        /// Call once per frame from Plugin.DataUpdate(). Manages stint lifecycle,
        /// runs module frame updates, detects lap crossings, and evaluates calls.
        /// </summary>
        public void Update(TelemetrySnapshot current, TelemetrySnapshot previous)
        {
            if (current == null || !current.GameRunning) return;

            // ── Stint lifecycle: detect pit stop → new stint ────────────
            bool inPit = current.IsInPitLane;
            if (_wasInPitLane && !inPit && current.SpeedKmh > 10)
            {
                // Just left pit lane — start a new stint
                StartNewStint(current);
            }
            _wasInPitLane = inPit;

            // Auto-create first stint if we don't have one yet
            if (CurrentStint == null && current.SessionState >= 3 && !inPit)
            {
                StartNewStint(current);
            }

            // ── Per-frame module updates ────────────────────────────────
            Tires.UpdateFrame(current);
            Fuel.UpdateFrame(current);

            // ── Lap crossing detection ──────────────────────────────────
            if (current.CompletedLaps > _lastCompletedLaps && _lastCompletedLaps >= 0)
            {
                OnLapCompleted(current);
            }
            _lastCompletedLaps = current.CompletedLaps;

            // Track fuel at lap start for delta calculation
            if (current.CompletedLaps != _lastCompletedLaps)
            {
                _fuelAtLapStart = current.FuelLevel;
            }
        }

        /// <summary>
        /// Reset all state for a new session.
        /// </summary>
        public void Reset()
        {
            CurrentStint = null;
            CompletedStints.Clear();
            _stintCounter = 0;
            _lastCompletedLaps = -1;
            _fuelAtLapStart = 0;
            _wasInPitLane = false;
            _currentCall = null;
            _moduleCooldowns.Clear();
            Tires.OnNewStint();
            Fuel.OnNewStint();
        }

        // ═══════════════════════════════════════════════════════════════
        //  INTERNALS
        // ═══════════════════════════════════════════════════════════════

        private void StartNewStint(TelemetrySnapshot s)
        {
            // Archive previous stint
            if (CurrentStint != null && CurrentStint.LapsCompleted > 0)
                CompletedStints.Add(CurrentStint);

            _stintCounter++;
            CurrentStint = new StintData
            {
                StintNumber = _stintCounter,
                StartLap = s.CompletedLaps,
                StartFuel = s.FuelLevel
            };

            _fuelAtLapStart = s.FuelLevel;
            Tires.OnNewStint();
            Fuel.OnNewStint();
        }

        private void OnLapCompleted(TelemetrySnapshot s)
        {
            if (CurrentStint == null) return;

            // Skip pit in/out laps
            if (s.IsInPitLane || s.IsInPit) return;

            // Fuel used this lap
            double fuelUsed = Math.Max(0, _fuelAtLapStart - s.FuelLevel);
            _fuelAtLapStart = s.FuelLevel;

            // Record lap time (skip invalid laps)
            if (s.LapLastTime > 10 && s.LapLastTime < 600)
                CurrentStint.LapTimes.Add(s.LapLastTime);

            // Update modules
            Tires.OnLapCompleted(CurrentStint, s, fuelUsed);
            Fuel.OnLapCompleted(CurrentStint, s, fuelUsed);

            // Evaluate all modules and pick highest-priority call
            EvaluateAndEmit(s);
        }

        private void EvaluateAndEmit(TelemetrySnapshot s)
        {
            var candidates = new List<StrategyCall>();
            var now = DateTime.UtcNow;

            // Collect calls from all modules
            var tireCall = Tires.Evaluate(CurrentStint);
            if (tireCall != null) candidates.Add(tireCall);

            var fuelCall = Fuel.Evaluate(CurrentStint, s);
            if (fuelCall != null) candidates.Add(fuelCall);

            // Future: add pit optimizer, opponent intel, etc.

            if (candidates.Count == 0) return;

            // Pick highest severity, break ties by module priority (fuel > tire)
            candidates.Sort((a, b) =>
            {
                int sev = b.Severity.CompareTo(a.Severity);
                if (sev != 0) return sev;
                return ModulePriority(b.Module).CompareTo(ModulePriority(a.Module));
            });

            var best = candidates[0];

            // Check module cooldown
            if (_moduleCooldowns.TryGetValue(best.Module, out var lastFire))
            {
                if ((now - lastFire).TotalSeconds < best.CooldownSeconds)
                {
                    // Try next candidate
                    for (int i = 1; i < candidates.Count; i++)
                    {
                        var alt = candidates[i];
                        if (!_moduleCooldowns.TryGetValue(alt.Module, out var altLast)
                            || (now - altLast).TotalSeconds >= alt.CooldownSeconds)
                        {
                            best = alt;
                            break;
                        }
                    }
                    // If all on cooldown, skip
                    if (_moduleCooldowns.TryGetValue(best.Module, out lastFire)
                        && (now - lastFire).TotalSeconds < best.CooldownSeconds)
                        return;
                }
            }

            // Severity-based interruption: higher severity can override current
            if (IsVisible && _currentCall != null && best.Severity <= _currentCall.Severity)
                return; // don't interrupt with equal or lower severity

            // Emit the call
            _currentCall = best;
            _callDisplayedAt = now;
            _moduleCooldowns[best.Module] = now;
        }

        private static int ModulePriority(string module)
        {
            switch (module)
            {
                case "fuel": return 3;
                case "tire": return 2;
                case "pit":  return 4;
                default:     return 1;
            }
        }
    }
}
