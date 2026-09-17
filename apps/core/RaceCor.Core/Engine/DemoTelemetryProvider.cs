using System;

namespace RaceCorProDrive.Plugin.Engine
{
    /// <summary>
    /// Simulates realistic race telemetry for demo mode so the full HUD is populated.
    /// Generates smoothly-animated speed, RPM, gear, pedals, fuel, tyres, and positions
    /// by simulating a car driving a track with corners and straights.
    /// The DemoSequence overlays event-specific state (position changes, flags, incidents).
    /// </summary>
    public class DemoTelemetryProvider
    {
        private readonly Random _rng = new Random();

        // ── Track profile: position → target speed (mph) keyframes ──────────
        // Simulates a ~2km road course with tight corners and fast straights.
        private static readonly double[] TrackPos   = { 0.00, 0.08, 0.14, 0.22, 0.34, 0.42, 0.50, 0.58, 0.65, 0.74, 0.84, 0.92, 1.00 };
        private static readonly double[] TrackSpeed = { 148,  56,   95,   168,  72,   105,  178,  52,   88,   162,  68,   132,  148  };

        // ── Gear thresholds (mph) ───────────────────────────────────────────
        private static readonly double[] GearMinSpeeds = { 0, 0, 35, 62, 95, 128, 155 };

        // ── Simulation time ─────────────────────────────────────────────────
        private double _elapsed  = 0;
        private double _lapTime  = 88.0;  // seconds per lap
        private double _trackPos = 0;
        private double _prevSpeed = 120;

        /// <summary>Current track position (0–1 fraction) for map animation.</summary>
        public double TrackPosition => _trackPos;

        /// <summary>Total elapsed demo time in seconds.</summary>
        public double Elapsed => _elapsed;

        // ── Exposed state (read by Plugin.cs via properties) ────────────────
        public string Gear     { get; private set; } = "3";
        public double Rpm      { get; private set; } = 4200;
        public double MaxRpm   { get; private set; } = 8500;
        public double SpeedMph { get; private set; } = 120;

        public double Throttle { get; private set; } = 0.5;
        public double Brake    { get; private set; } = 0;
        public double Clutch   { get; private set; } = 0;

        public double Fuel         { get; private set; } = 38.0;
        public double MaxFuel      { get; private set; } = 45.0;
        public double FuelPerLap   { get; private set; } = 2.85;
        public int    RemainingLaps { get; private set; } = 12;

        // ── Computed DS.* equivalents (mirror TelemetrySnapshot computed props) ──
        public double ThrottleNorm      => Throttle;              // already 0–1
        public double BrakeNorm         => Brake;                 // already 0–1
        public double ClutchNorm        => Clutch;                // already 0–1
        public double RpmRatio          => MaxRpm > 0 ? Math.Min(1.0, Rpm / MaxRpm) : 0;
        public double FuelPct           => MaxFuel > 0 ? (Fuel / MaxFuel) * 100.0 : 0;
        public double FuelLapsRemaining => FuelPerLap > 0.01 ? Fuel / FuelPerLap : 99;
        public double SpeedMphComputed  => SpeedKmh * 0.621371;   // alias (SpeedMph is already set in Tick)
        public double PitSpeedLimitMph  => 72.0 * 0.621371;       // demo pit limit = 72 km/h
        public bool   IsPitSpeeding     => IsInPitLane && SpeedKmh > 72.0;
        public bool   IsNonRaceSession  => false;                  // demo is always Race
        public TelemetrySnapshot.SessionModeEnum SessionMode => TelemetrySnapshot.SessionModeEnum.Race;
        public bool   IsLapRace         => !IsTimedRace;           // demo: lap-limited if not timed
        public bool   IsLapInvalid      => false;                  // demo: lap always valid
        public double[] SectorBests     => null;                   // demo: no sector bests
        public bool   IsTimedRace       => RemainingTime > 0;
        public bool   IsEndOfRace       => false;                  // demo never ends
        public int    StartPosition     { get; private set; } = 4;
        public int    PositionDelta     => StartPosition > 0 ? StartPosition - Position : 0;
        public string RemainingTimeFormatted
        {
            get
            {
                if (RemainingTime <= 0) return "";
                int totalSec = (int)RemainingTime;
                int h = totalSec / 3600;
                int m = (totalSec % 3600) / 60;
                int s = totalSec % 60;
                return h > 0
                    ? string.Format("{0}:{1:D2}:{2:D2}", h, m, s)
                    : string.Format("{0}:{1:D2}", m, s);
            }
        }

        // ── Display-ready strings (mirror TelemetrySnapshot) ──────────────
        public string SpeedDisplay => SpeedKmh > 0 ? ((int)Math.Round(SpeedKmh)).ToString() : "0";
        public string RpmDisplay => Rpm > 0 ? ((int)Math.Round(Rpm)).ToString() : "0";
        public string FuelFormatted => Fuel > 0 ? Fuel.ToString("F1") : "\u2014";
        public string FuelPerLapFormatted => FuelPerLap > 0 ? FuelPerLap.ToString("F2") : "\u2014";
        public string PitSuggestion
        {
            get
            {
                double lapsEst = FuelLapsRemaining;
                if (lapsEst <= 0 || lapsEst >= 99 || RemainingLaps <= 0) return "";
                if (lapsEst < RemainingLaps)
                    return "PIT in ~" + ((int)Math.Ceiling(lapsEst)).ToString() + " laps";
                return "";
            }
        }
        public double BBNorm => Math.Min(1.0, Math.Max(0.0, (BrakeBias - 30.0) / 40.0));
        public double TCNorm => Math.Min(1.0, TractionControlSetting / 12.0);
        public double ABSNorm => Math.Min(1.0, AbsSettingVal / 12.0);
        public string PositionDeltaDisplay
        {
            get
            {
                int d = PositionDelta;
                if (d > 0) return "\u25B2 " + d.ToString();
                if (d < 0) return "\u25BC " + Math.Abs(d).ToString();
                return "";
            }
        }
        public string LapDeltaDisplay
        {
            get
            {
                if (LastLapTime <= 0 || BestLapTime <= 0) return "";
                double delta = LastLapTime - BestLapTime;
                return (delta >= 0 ? "+" : "") + delta.ToString("F3");
            }
        }
        public string SafetyRatingDisplay => SafetyRating > 0 ? SafetyRating.ToString("F2") : "\u2014";
        public string GapAheadFormatted => GapAhead > 0 ? "-" + GapAhead.ToString("F2") : "\u2014";
        public string GapBehindFormatted => GapBehind > 0 ? "+" + GapBehind.ToString("F2") : "\u2014";

        // ── Driver aids (not simulated in detail, but exposed for DS.*) ────
        public double TractionControlSetting { get; private set; } = 4;
        public double AbsSettingVal          { get; private set; } = 3;

        public double TyreTempFL { get; private set; } = 196;
        public double TyreTempFR { get; private set; } = 199;
        public double TyreTempRL { get; private set; } = 190;
        public double TyreTempRR { get; private set; } = 192;

        public double TyreWearFL { get; private set; } = 0.82;
        public double TyreWearFR { get; private set; } = 0.79;
        public double TyreWearRL { get; private set; } = 0.86;
        public double TyreWearRR { get; private set; } = 0.85;

        public double BrakeBias { get; private set; } = 56.2;
        public double TC        { get; private set; } = 4;
        public double ABS       { get; private set; } = 3;

        public int    Position       { get; private set; } = 4;
        public int    CurrentLap     { get; private set; } = 1;
        public double BestLapTime    { get; private set; } = 92.410;
        public double CurrentLapTime => _trackPos * _lapTime;
        public string CarModel       { get; private set; } = "BMW M4 GT3";

        // Cycle through different car models in demo to exercise the logo system
        private static readonly string[] _demoCarModels = new[]
        {
            "BMW M4 GT3", "Porsche 911 GT3 R", "Ferrari 296 GT3",
            "Mercedes-AMG GT3", "McLaren 720S GT3", "Audi R8 LMS GT3",
            "Lamborghini Huracan GT3", "Chevrolet Corvette Z06 GT3.R",
            "Ford Mustang GT3", "Aston Martin Vantage GT3"
        };
        private int _demoCarIdx = 0;

        public double LastLapTime    { get; private set; } = 92.590;
        public double SessionTime    { get; private set; } = 0;
        public double RemainingTime  { get; private set; } = 1820;
        public int    TotalLaps      { get; private set; } = 25;

        public string SessionTypeName { get; private set; } = "Race";

        public int    IRating        { get; private set; } = 2673;
        public double SafetyRating   { get; private set; } = 3.24;

        public double GapAhead       { get; private set; } = 5.4;
        public double GapBehind      { get; private set; } = 6.2;
        public string DriverAhead    { get; private set; } = "A. Martinez";
        public string DriverBehind   { get; private set; } = "J. Williams";
        public int    IRAhead        { get; private set; } = 2847;
        public int    IRBehind       { get; private set; } = 3214;

        // ── Datastream (advanced physics) ──
        public double LatG           { get; private set; } = 0;
        public double LongG          { get; private set; } = 0;
        public double YawRate        { get; private set; } = 0;
        public double SteerTorque    { get; private set; } = 0;
        public double TrackTemp      { get; private set; } = 34.2;
        public int    IncidentCount  { get; private set; } = 0;
        public bool   AbsActive      { get; private set; } = false;
        public bool   TcActive       { get; private set; } = false;
        public double LapDelta       { get; private set; } = 0;
        public bool   IsInPitLane    { get; private set; } = false;
        public double SpeedKmh       { get; private set; } = 0;

        // ── Grid / Formation demo state ──
        public int    SessionState    { get; private set; } = 1; // start in GetInCar
        public int    GriddedCars     { get; private set; } = 0;
        public int    TotalCars       { get; private set; } = 24;
        public int    PaceMode        { get; private set; } = 0;
        /// <summary>Start lights phase: 0=off, 1-5=red lights building, 6=all red, 7=green (go!), 8=done.</summary>
        public int    LightsPhase     { get; private set; } = 0;
        public bool   IsStandingStart { get; private set; } = false;
        public string TrackCountry  { get; private set; } = "DE"; // Germany as demo default

        // ── Formation lap demo cycle ──
        private double _formationTimer   = 0;
        private bool   _formationCycleDone = false; // start with formation sequence active
        private int    _formationLightsStep = 0;
        private double _formationLightsTimer = 0;

        /// <summary>
        /// Advance simulation by dt seconds (~0.1s at 6-frame eval cadence at 60fps).
        /// </summary>
        public void Tick(double dt)
        {
            _elapsed += dt;
            SessionTime += dt;
            RemainingTime = Math.Max(0, RemainingTime - dt);

            // Advance track position (wraps at 1.0 = one lap)
            _trackPos += dt / _lapTime;
            if (_trackPos >= 1.0)
            {
                _trackPos -= 1.0;
                CurrentLap++;
                LastLapTime = _lapTime + (_rng.NextDouble() - 0.5) * 3.0;  // vary ~±1.5s
                Fuel = Math.Max(0.5, Fuel - FuelPerLap);

                // Cycle car model every 2 laps
                if (CurrentLap % 2 == 0)
                {
                    _demoCarIdx = (_demoCarIdx + 1) % _demoCarModels.Length;
                    CarModel = _demoCarModels[_demoCarIdx];
                }
                RemainingLaps = Math.Max(0, RemainingLaps - 1);

                // Simulate position: P4→P1 (climb), hold P1, drop to P4, repeat
                // One position change per lap, always ±1, never jumps.
                // Laps  0-2:  climb  P4→P3→P2
                // Lap   3:    arrive P1  (gold animation fires here)
                // Laps  4-5:  hold   P1
                // Laps  6-8:  drop   P2→P3→P4
                // Lap   9:    hold   P4  (brief pause before climbing again)
                int cycle = (CurrentLap - 1) % 10;
                if (cycle < 3)
                    Position = 4 - cycle;               // 4,3,2
                else if (cycle == 3)
                    Position = 1;                        // arrive at P1
                else if (cycle <= 5)
                    Position = 1;                        // hold P1
                else if (cycle <= 8)
                    Position = 1 + (cycle - 5);          // 2,3,4
                else
                    Position = 4;                        // hold P4

                // Simulate in-car adjustment changes at specific laps
                // (triggers commentary topics for brake_bias_change, tc_setting_change, abs_setting_change)
                if (cycle == 1)
                    BrakeBias = 57.0;   // shift bias forward mid-climb
                else if (cycle == 4)
                    TC = 3;             // reduce TC while leading
                else if (cycle == 5)
                    ABS = 2;            // reduce ABS at P1 — more feel
                else if (cycle == 7)
                {
                    BrakeBias = 55.5;   // shift bias rearward as tyres degrade
                    TC = 5;             // increase TC on worn tyres
                }
                else if (cycle == 9)
                {
                    // Reset for next cycle
                    BrakeBias = 56.2;
                    TC = 4;
                    ABS = 3;
                }

                // Wear degrades slightly each lap
                TyreWearFL = Math.Max(0.10, TyreWearFL - 0.018 - _rng.NextDouble() * 0.006);
                TyreWearFR = Math.Max(0.10, TyreWearFR - 0.020 - _rng.NextDouble() * 0.006);
                TyreWearRL = Math.Max(0.10, TyreWearRL - 0.014 - _rng.NextDouble() * 0.004);
                TyreWearRR = Math.Max(0.10, TyreWearRR - 0.015 - _rng.NextDouble() * 0.004);
            }

            // Interpolate target speed from track profile
            double targetSpeed = InterpolateSpeed(_trackPos);

            // Smooth toward target (low-pass filter)
            double lerpRate = 3.5 * dt;
            SpeedMph = SpeedMph + (targetSpeed - SpeedMph) * Math.Min(1.0, lerpRate);
            SpeedKmh = SpeedMph * 1.60934;

            // Speed delta for pedal derivation
            double speedDelta = SpeedMph - _prevSpeed;
            _prevSpeed = SpeedMph;

            // Pedals from speed change
            if (speedDelta > 0.5)
            {
                Throttle = Math.Min(1.0, 0.3 + speedDelta * 0.08);
                Brake = 0;
            }
            else if (speedDelta < -1.5)
            {
                Throttle = 0;
                Brake = Math.Min(1.0, Math.Abs(speedDelta) * 0.06);
            }
            else
            {
                // Coast / maintenance throttle
                Throttle = 0.15 + _rng.NextDouble() * 0.10;
                Brake = 0;
            }
            Clutch = 0; // rarely used in race

            // Gear from speed
            int g = 1;
            for (int i = 6; i >= 1; i--)
            {
                if (SpeedMph >= GearMinSpeeds[i]) { g = i; break; }
            }
            Gear = g.ToString();

            // RPM: sawtooth within gear range
            double gMin = GearMinSpeeds[g];
            double gMax = g < 6 ? GearMinSpeeds[g + 1] : 200;
            double gFrac = (gMax > gMin) ? (SpeedMph - gMin) / (gMax - gMin) : 0.5;
            gFrac = Math.Max(0, Math.Min(1, gFrac));
            Rpm = 3200 + gFrac * (MaxRpm - 3500) + (_rng.NextDouble() - 0.5) * 80;

            // Tyre temps: base + cornering heat (higher in corners where speed is lower)
            double cornerFactor = Math.Max(0, 1.0 - SpeedMph / 180.0);
            double heatNoise = (_rng.NextDouble() - 0.5) * 3.0;
            TyreTempFL = 175 + cornerFactor * 55 + heatNoise + (1 - TyreWearFL) * 15;
            TyreTempFR = 178 + cornerFactor * 58 + heatNoise + (1 - TyreWearFR) * 15;
            TyreTempRL = 170 + cornerFactor * 40 + heatNoise + (1 - TyreWearRL) * 10;
            TyreTempRR = 172 + cornerFactor * 42 + heatNoise + (1 - TyreWearRR) * 10;

            // ── Datastream physics simulation ──
            // Lateral G: higher in corners (when speed is lower), sign alternates with track section
            double cornerIntensity = Math.Max(0, 1.0 - SpeedMph / 180.0);
            double latSign = Math.Sin(_trackPos * Math.PI * 8); // alternating L/R turns
            LatG = cornerIntensity * 2.2 * latSign + (_rng.NextDouble() - 0.5) * 0.15;

            // Longitudinal G: positive under braking, negative under accel
            LongG = speedDelta < -1.5
                ? Math.Abs(speedDelta) * 0.12 + (_rng.NextDouble() - 0.5) * 0.08   // braking
                : speedDelta > 1.0
                    ? -speedDelta * 0.06 + (_rng.NextDouble() - 0.5) * 0.05         // accel
                    : (_rng.NextDouble() - 0.5) * 0.05;                              // coast

            // Yaw rate: derivative of lateral, spikes in transitions
            YawRate = LatG * 0.35 + (_rng.NextDouble() - 0.5) * 0.08;

            // Steering torque: correlates with lat G and speed
            SteerTorque = Math.Abs(LatG) * 12.0 + SpeedMph * 0.06 + (_rng.NextDouble() - 0.5) * 2.0;

            // Track temp drifts slowly over session
            if (_rng.NextDouble() < 0.01)
                TrackTemp += (_rng.NextDouble() - 0.48) * 0.3;
            TrackTemp = Math.Max(20, Math.Min(55, TrackTemp));

            // ABS/TC active: fire during heavy braking/accel respectively
            AbsActive = Brake > 0.7 && (_rng.NextDouble() < 0.4);
            TcActive  = Throttle > 0.85 && cornerIntensity > 0.3 && (_rng.NextDouble() < 0.3);

            // Lap delta: oscillates around zero, trends negative when gaining, positive when losing
            LapDelta += (_rng.NextDouble() - 0.502) * 0.04;
            LapDelta = Math.Max(-2.5, Math.Min(2.5, LapDelta));
            if (_trackPos < 0.02) LapDelta = 0; // reset at lap start

            // Incident count: occasionally increments (simulates 1x from off-tracks)
            if (_rng.NextDouble() < 0.0002)
                IncidentCount = Math.Min(17, IncidentCount + 1);

            // Gaps drift with mean-reversion toward ~5s, occasional close battles
            if (_rng.NextDouble() < 0.08)
            {
                double driftA = (_rng.NextDouble() - 0.50) * 0.6;
                double driftB = (_rng.NextDouble() - 0.50) * 0.6;
                // Gentle pull back toward cruising gap (~5s)
                driftA += (5.0 - GapAhead)  * 0.04;
                driftB += (5.0 - GapBehind) * 0.04;
                // Rare close encounter: ~2% chance to slam gap down
                if (_rng.NextDouble() < 0.02) driftA = -(GapAhead * 0.6);
                if (_rng.NextDouble() < 0.02) driftB = -(GapBehind * 0.6);
                GapAhead  = Math.Max(0.3, Math.Min(12.0, GapAhead  + driftA));
                GapBehind = Math.Max(0.3, Math.Min(12.0, GapBehind + driftB));
            }

            // ── Formation / pre-race demo sequence ──
            // Runs at startup: GetInCar → Warmup → Formation → Lights → Race
            // Then repeats every ~3 minutes during the race simulation
            if (_formationCycleDone && _elapsed > 60 && ((int)_elapsed % 180) < 1)
            {
                // Re-trigger formation sequence periodically during race
                _formationCycleDone = false;
                _formationTimer = 0;
                SessionState = 1; // GetInCar
                GriddedCars = 0;
                PaceMode = 0;
                LightsPhase = 0;
                _formationLightsStep = 0;
                _formationLightsTimer = 0;
            }

            if (!_formationCycleDone)
            {
                _formationTimer += dt;

                if (SessionState == 1) // GetInCar — 3 seconds
                {
                    if (_formationTimer > 3.0)
                    {
                        SessionState = 2; // Warmup
                    }
                }
                else if (SessionState == 2) // Warmup — 4 seconds
                {
                    if (_formationTimer > 7.0) // 3s GetInCar + 4s Warmup
                    {
                        SessionState = 3; // ParadeLaps (Formation)
                        PaceMode = 1;
                    }
                }
                else if (SessionState == 3) // Formation/Parade
                {
                    double formPhaseTime = _formationTimer - 7.0; // time since formation started
                    // Cars gridding over 10 seconds
                    GriddedCars = Math.Min(TotalCars, (int)(formPhaseTime / 10.0 * TotalCars));
                    PaceMode = formPhaseTime < 5 ? 1 : (formPhaseTime < 10 ? 2 : 3);

                    // After 12s of formation, transition to lights sequence
                    if (formPhaseTime > 12)
                    {
                        SessionState = 4; // Racing (lights sequence begins)
                        GriddedCars = TotalCars;
                        LightsPhase = 1;
                        _formationLightsStep = 1;
                        _formationLightsTimer = 0;
                    }
                }
                else if (LightsPhase >= 1 && LightsPhase < 6) // Lights building (1-5)
                {
                    _formationLightsTimer += dt;
                    if (_formationLightsTimer > 1.0) // 1 second per light
                    {
                        _formationLightsTimer = 0;
                        _formationLightsStep++;
                        LightsPhase = _formationLightsStep;
                        if (_formationLightsStep >= 6)
                        {
                            LightsPhase = 6; // All red, hold
                            _formationLightsTimer = 0;
                        }
                    }
                }
                else if (LightsPhase == 6) // All red hold
                {
                    _formationLightsTimer += dt;
                    // Hold all-red for 1.5-3s then green
                    if (_formationLightsTimer > 2.0)
                    {
                        LightsPhase = 7; // GREEN!
                        _formationLightsTimer = 0;
                    }
                }
                else if (LightsPhase == 7) // Green — GO!
                {
                    _formationLightsTimer += dt;
                    if (_formationLightsTimer > 3.0) // Show green for 3s
                    {
                        LightsPhase = 8; // Done
                        _formationLightsTimer = 0;
                    }
                }
                else if (LightsPhase == 8) // Fade out
                {
                    _formationLightsTimer += dt;
                    if (_formationLightsTimer > 2.0)
                    {
                        // Sequence complete — race begins
                        _formationCycleDone = true;
                        LightsPhase = 0;
                        PaceMode = 0;
                    }
                }
            }
        }

        /// <summary>
        /// Called when a DemoSequence step fires, to sync event-driven state
        /// (position, driver names, flags, etc.) with the telemetry animation.
        /// </summary>
        public void ApplyDemoStep(TelemetrySnapshot snap)
        {
            if (snap == null) return;

            Position     = snap.Position;
            CurrentLap   = snap.CurrentLap > 0 ? snap.CurrentLap : CurrentLap;

            if (!string.IsNullOrEmpty(snap.NearestAheadName))
            {
                DriverAhead = snap.NearestAheadName;
                IRAhead     = snap.NearestAheadRating;
            }
            if (!string.IsNullOrEmpty(snap.NearestBehindName))
            {
                DriverBehind = snap.NearestBehindName;
                IRBehind     = snap.NearestBehindRating;
            }
            if (snap.FuelPercent > 0 && snap.FuelPercent < 1)
            {
                Fuel = snap.FuelPercent * MaxFuel;
            }
            if (snap.IncidentCount > IncidentCount)
            {
                IncidentCount = snap.IncidentCount;
            }
            IsInPitLane = snap.IsInPitLane;
            if (snap.IsInPitLane)
            {
                SpeedMph = 45;
                SpeedKmh = 45 * 1.60934;
                Throttle = 0.2;
                Brake = 0;
                Gear = "2";
                Rpm = 3800;
            }
        }

        /// <summary>
        /// Reset to initial state (called when demo mode is toggled on).
        /// </summary>
        public void Reset()
        {
            _elapsed   = 0;
            _trackPos  = 0;
            _prevSpeed = 120;
            CurrentLap = 1;
            Position   = 4;
            Fuel       = 38.0;
            SessionTime   = 0;
            RemainingTime = 1820;
            LastLapTime   = 92.590;
            TyreWearFL = 0.82;
            TyreWearFR = 0.79;
            TyreWearRL = 0.86;
            TyreWearRR = 0.85;
            GapAhead   = 5.4;
            GapBehind  = 6.2;
            DriverAhead  = "A. Martinez";
            DriverBehind = "J. Williams";
            IRAhead  = 2847;
            IRBehind = 3214;
            // Start with pre-race sequence
            SessionState         = 1; // GetInCar
            GriddedCars          = 0;
            TotalCars            = 24;
            PaceMode             = 0;
            LightsPhase          = 0;
            IsStandingStart      = (_rng.NextDouble() < 0.4); // choose once at reset, keep consistent
            _formationCycleDone  = false; // sequence runs at startup
            _formationTimer      = 0;
            _formationLightsStep = 0;
            _formationLightsTimer = 0;
            TrackCountry = "DE"; // Nürburgring default
        }

        // ── Helpers ─────────────────────────────────────────────────────────

        private static double InterpolateSpeed(double pos)
        {
            pos = pos % 1.0;
            for (int i = 0; i < TrackPos.Length - 1; i++)
            {
                if (pos >= TrackPos[i] && pos <= TrackPos[i + 1])
                {
                    double frac = (pos - TrackPos[i]) / (TrackPos[i + 1] - TrackPos[i]);
                    // Smooth step for more natural acceleration/braking curves
                    frac = frac * frac * (3 - 2 * frac);
                    return TrackSpeed[i] + (TrackSpeed[i + 1] - TrackSpeed[i]) * frac;
                }
            }
            return TrackSpeed[0];
        }
    }
}
