using System;
using System.Collections.Generic;

namespace RaceCorProDrive.Plugin.Engine
{
    /// <summary>
    /// Provides the curated demo sequence for demo mode.
    /// Each step specifies the topic to fire, a fake TelemetrySnapshot with
    /// realistic data values (used for {value} substitution in event expositions),
    /// and a delay to wait after the *previous* event before firing this one.
    ///
    /// The sequence is designed to:
    ///   • Cover all five severity levels and all background colors.
    ///   • Include two deliberate interruption moments (a higher-severity event fires
    ///     while a lower-severity one is still on screen).
    ///   • Simulate a plausible race arc: start → battle → incidents → recovery → pit.
    ///   • Loop continuously so the dashboard stays animated.
    /// </summary>
    public static class DemoSequence
    {
        // ── Base snapshot representing a mid-race car in reasonable condition ────
        private static TelemetrySnapshot Base() => new TelemetrySnapshot
        {
            GameRunning        = true,
            SessionTypeName    = "Race",
            Position           = 4,
            CurrentLap         = 8,
            CompletedLaps      = 7,
            FuelLevel          = 18.4,
            FuelPercent        = 0.41,
            SpeedKmh           = 187.0,
            Throttle           = 0.82,
            Brake              = 0.0,
            LatAccel           = 1.8,
            LongAccel          = -4.2,
            VertAccel          = 1.1,
            YawRate            = 0.4,
            TyreTempFL         = 196.0,
            TyreTempFR         = 199.0,
            TyreTempRL         = 190.0,
            TyreTempRR         = 192.0,
            TyreWearFL         = 0.38,
            TyreWearFR         = 0.41,
            TyreWearRL         = 0.34,
            TyreWearRR         = 0.35,
            TrackTemp          = 36.0,
            LapDeltaToBest     = 0.12,
            LapBestTime        = 92.410,
            LapLastTime        = 92.590,
            LapCurrentTime     = 47.3,
            SessionTimeRemain  = 1820.0,
            SessionFlags       = 0,
            IncidentCount      = 0,
            DrsStatus          = 0,
            ErsBattery         = 0.72,
            NearestAheadName   = "A. Martinez",
            NearestAheadRating = 2847,
            NearestBehindName  = "J. Williams",
            NearestBehindRating = 3214,
            CarIdxLapDistPct   = new float[0],
            CarIdxOnPitRoad    = new bool[0],
            PlayerCarIdx       = 0,
        };

        public struct Step
        {
            public string TopicId;
            public TelemetrySnapshot Snapshot;

            /// <summary>
            /// Seconds to wait after the previous step fires before attempting this one.
            /// Capped at 30 in practice. Steps marked as interruptions use a short delay
            /// so they fire while the previous prompt is still visible.
            /// </summary>
            public double DelaySeconds;

            /// <summary>
            /// When true, this step is expected to interrupt the previous one
            /// (its severity is higher than the previous step's severity).
            /// </summary>
            public bool IsInterrupt;
        }

        /// <summary>
        /// Returns the full demo sequence. The list loops — after the last step the
        /// engine wraps back to step 0.
        /// </summary>
        public static List<Step> Build()
        {
            var steps = new List<Step>();

            // ── 1. RACE START — severity 4, amber ────────────────────────────────
            // Fires immediately when demo mode activates.
            var raceStart = Base();
            raceStart.CurrentLap    = 1;
            raceStart.CompletedLaps = 0;
            raceStart.FuelPercent   = 1.0;
            raceStart.FuelLevel     = 45.0;
            raceStart.Position      = 4;
            raceStart.SpeedKmh      = 48.0;   // ~30 mph — rolling start grid
            raceStart.Throttle      = 0.40;
            steps.Add(new Step { TopicId = "race_start", Snapshot = raceStart, DelaySeconds = 0 });

            // ── 2. TC INTERVENTION — severity 1, slate grey ──────────────────────
            // Shows the ambient/informational colour. Fires after race_start expires.
            var tcFire = Base();
            tcFire.TcActive    = true;
            tcFire.CurrentLap  = 1;
            tcFire.Position    = 4;
            tcFire.SpeedKmh    = 95.0;    // ~59 mph — mid-corner TC kick
            tcFire.Throttle    = 0.65;
            tcFire.LatAccel    = 3.2;
            steps.Add(new Step { TopicId = "tc_intervention", Snapshot = tcFire, DelaySeconds = 18 });

            // ── 3. HIGH CORNERING LOAD — severity 2, blue ────────────────────────
            var highG = Base();
            highG.LatAccel   = 4.3;
            highG.CurrentLap = 3;
            highG.SpeedKmh   = 72.0;    // ~45 mph — slow-speed hairpin
            highG.Throttle   = 0.30;
            highG.Brake      = 0.0;
            steps.Add(new Step { TopicId = "high_cornering_load", Snapshot = highG, DelaySeconds = 14 });

            // ── 4. CLOSE BATTLE — severity 3, orange ────────────────────────────
            // Show orange while blue is still clearing — sev 3 > sev 2 → INTERRUPT.
            var close = Base();
            close.Position = 4;
            close.CurrentLap = 4;
            // Fake proximity array: one car very close
            close.CarIdxLapDistPct = new float[] { 0.0f, 0.412f, 0.411f };
            close.PlayerCarIdx     = 1;
            steps.Add(new Step
            {
                TopicId = "close_battle", Snapshot = close,
                DelaySeconds = 6, IsInterrupt = true   // fires while high_cornering_load is still showing
            });

            // ── 5. POSITION GAINED — severity 4, amber ──────────────────────────
            var passedFwd = Base();
            passedFwd.Position   = 3;   // moved up from 4
            passedFwd.CurrentLap = 5;
            passedFwd.SpeedKmh   = 241.0;  // ~150 mph — DRS straight overtake
            passedFwd.Throttle   = 1.0;
            passedFwd.Brake      = 0.0;
            steps.Add(new Step { TopicId = "position_gained", Snapshot = passedFwd, DelaySeconds = 20 });

            // ── 6. BRAKE BIAS CHANGE — severity 1, slate grey ───────────────────
            // Driver shifts bias forward to stabilise entry on a tight section.
            var bbChange = Base();
            bbChange.BrakeBias  = 57.0;
            bbChange.CurrentLap = 7;
            bbChange.Position   = 4;
            steps.Add(new Step { TopicId = "brake_bias_change", Snapshot = bbChange, DelaySeconds = 18 });

            // ── 7. TC SETTING CHANGE — severity 1, slate grey ──────────────────
            // As the tyres warm up, the driver dials TC down for more control.
            var tcChange = Base();
            tcChange.TractionControlSetting = 3;
            tcChange.CurrentLap = 8;
            tcChange.Position   = 4;
            steps.Add(new Step { TopicId = "tc_setting_change", Snapshot = tcChange, DelaySeconds = 16 });

            // ── 8. HOT TYRES — severity 3, orange ───────────────────────────────
            var hotTyres = Base();
            hotTyres.TyreTempFL = 245.0;
            hotTyres.TyreTempFR = 250.0;
            hotTyres.CurrentLap = 10;
            steps.Add(new Step { TopicId = "hot_tyres", Snapshot = hotTyres, DelaySeconds = 25 });

            // ── 7. WALL CONTACT — severity 5, red ───────────────────────────────
            // Deliberate major interruption: crashes in while hot_tyres is still showing.
            var crash = Base();
            crash.VertAccel    = 17.3;
            crash.SpeedKmh     = 0.0;
            crash.IncidentCount = 4;
            crash.CurrentLap    = 10;
            steps.Add(new Step
            {
                TopicId = "wall_contact", Snapshot = crash,
                DelaySeconds = 7, IsInterrupt = true   // fires while hot_tyres is still showing
            });

            // ── 8. INCIDENT SPIKE — severity 4, amber ───────────────────────────
            var incident = Base();
            incident.IncidentCount = 6;
            incident.CurrentLap = 10;
            steps.Add(new Step { TopicId = "incident_spike", Snapshot = incident, DelaySeconds = 18 });

            // ── 9. YELLOW FLAG — severity 4, amber ──────────────────────────────
            var yellow = Base();
            yellow.SessionFlags = TelemetrySnapshot.FLAG_YELLOW;
            yellow.CurrentLap   = 11;
            steps.Add(new Step { TopicId = "yellow_flag", Snapshot = yellow, DelaySeconds = 20 });

            // ── 10. GREEN FLAG — clears the caution (flag overlay handles this) ──
            var greenRestart = Base();
            greenRestart.SessionFlags = TelemetrySnapshot.FLAG_GREEN;
            greenRestart.CurrentLap   = 12;
            steps.Add(new Step { TopicId = "abs_activation", Snapshot = greenRestart, DelaySeconds = 12 });

            // ── 11. ABS ACTIVATION — severity 1, slate grey ────────────────────
            // Back to ambient colour after the green flag clears.
            var abs = Base();
            abs.AbsActive  = true;
            abs.CurrentLap = 12;
            steps.Add(new Step { TopicId = "abs_activation", Snapshot = abs, DelaySeconds = 10 });

            // ── 11. SPIN CATCH — severity 5, red ─────────────────────────────────
            // Second major interrupt — fires while ABS (sev 1) is still on screen.
            var spin = Base();
            spin.YawRate    = 3.1;
            spin.CurrentLap = 12;
            spin.SpeedKmh   = 25.0;   // ~16 mph — slow-speed spin recovery
            spin.Throttle   = 0.0;
            spin.Brake      = 0.60;
            steps.Add(new Step
            {
                TopicId = "spin_catch", Snapshot = spin,
                DelaySeconds = 5, IsInterrupt = true
            });

            // ── 12. TYRE WEAR HIGH — severity 2, blue ────────────────────────────
            var tyreWear = Base();
            tyreWear.TyreWearFL = 0.71;
            tyreWear.TyreWearFR = 0.68;
            tyreWear.CurrentLap = 14;
            steps.Add(new Step { TopicId = "tyre_wear_high", Snapshot = tyreWear, DelaySeconds = 20 });

            // ── 13. DEBRIS ON TRACK — severity 3, orange ─────────────────────────
            var debris = Base();
            debris.SessionFlags = TelemetrySnapshot.FLAG_DEBRIS;
            debris.CurrentLap   = 14;
            steps.Add(new Step { TopicId = "debris_on_track", Snapshot = debris, DelaySeconds = 18 });

            // ── 14. PIT ENTRY — severity 3, orange ───────────────────────────────
            var pitEntry = Base();
            pitEntry.IsInPitLane = true;
            pitEntry.CurrentLap  = 15;
            pitEntry.FuelPercent = 0.22;
            pitEntry.SpeedKmh   = 60.0;   // ~37 mph — pit lane speed limit
            pitEntry.Throttle   = 0.20;
            pitEntry.Brake      = 0.15;
            steps.Add(new Step { TopicId = "pit_entry", Snapshot = pitEntry, DelaySeconds = 22 });

            // ── 16. ABS SETTING CHANGE — severity 1, slate grey ─────────────────
            // Out of pits on fresh tyres — the driver reduces ABS for better feel.
            var absChange = Base();
            absChange.AbsSetting = 2;
            absChange.CurrentLap = 16;
            steps.Add(new Step { TopicId = "abs_setting_change", Snapshot = absChange, DelaySeconds = 14 });

            // ── 17. FFB TORQUE SPIKE — severity 3, orange ────────────────────────
            var ffb = Base();
            ffb.SteeringWheelTorque = 23.4;
            ffb.CurrentLap = 16;
            steps.Add(new Step { TopicId = "ffb_torque_spike", Snapshot = ffb, DelaySeconds = 20 });

            // ── 16. DRS ACTIVE — severity 2, blue ────────────────────────────────
            var drs = Base();
            drs.DrsStatus  = 2;
            drs.CurrentLap = 16;
            steps.Add(new Step { TopicId = "drs_active", Snapshot = drs, DelaySeconds = 18 });

            // ── 17. POSITION LOST — severity 4, amber ────────────────────────────
            // Passes {behind} while DRS is still showing → interrupt (sev 4 > sev 2).
            var passedBack = Base();
            passedBack.Position = 5;
            passedBack.CurrentLap = 17;
            steps.Add(new Step
            {
                TopicId = "position_lost", Snapshot = passedBack,
                DelaySeconds = 8, IsInterrupt = true
            });

            // ── 18. LOW FUEL — severity 3, orange ────────────────────────────────
            var lowFuel = Base();
            lowFuel.FuelPercent = 0.09;
            lowFuel.FuelLevel   = 4.1;
            lowFuel.CurrentLap  = 19;
            steps.Add(new Step { TopicId = "low_fuel", Snapshot = lowFuel, DelaySeconds = 30 });

            // ── 19. PERSONAL BEST — severity 3, orange ───────────────────────────
            // Positive event — good moment after the fuel scare.
            var pb = Base();
            pb.LapLastTime  = 91.880;
            pb.LapBestTime  = 92.410;
            pb.CurrentLap   = 20;
            pb.FuelPercent  = 0.07;
            steps.Add(new Step { TopicId = "personal_best", Snapshot = pb, DelaySeconds = 20 });

            // ── 20. CHECKERED FLAG (race control) ───────────────────────────────
            // Shows the "CHECKERED FLAG — Race complete" race control banner.
            var checker = Base();
            checker.SessionFlags = TelemetrySnapshot.FLAG_CHECKERED;
            checker.CurrentLap   = 21;
            checker.Position     = 3;
            steps.Add(new Step { TopicId = "car_balance_sustained", Snapshot = checker, DelaySeconds = 16 });

            // ── 21. CAR BALANCE SUSTAINED — severity 1, slate grey ───────────────
            // Calm ending — back to ambient before the loop restarts.
            var hooked = Base();
            hooked.LatAccel   = 3.8;
            hooked.CurrentLap = 21;
            steps.Add(new Step { TopicId = "car_balance_sustained", Snapshot = hooked, DelaySeconds = 14 });

            return steps;
        }
    }
}
