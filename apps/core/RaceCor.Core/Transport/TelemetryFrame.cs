using System;
using System.Collections.Generic;
using RaceCorProDrive.Plugin.Engine;

namespace RaceCorProDrive.Plugin.Transport
{
    /// <summary>
    /// Builds a flat telemetry dictionary from a TelemetrySnapshot.
    /// The wire keys MUST match the HTTP JSON output exactly — this is the overlay's contract.
    /// </summary>
    public static class TelemetryFrame
    {
        /// <summary>
        /// Converts a TelemetrySnapshot to a flat Dictionary<string, object>.
        /// This mirrors the Jp() calls in Plugin.HttpServerLoop() to ensure wire format parity.
        /// </summary>
        /// <param name="s">Telemetry snapshot (required — cannot be null).</param>
        /// <param name="demo">Demo mode flag (uses demo telemetry if true).</param>
        /// <param name="engine">Commentary engine (for visible/text).</param>
        /// <param name="strategy">Strategy coordinator (for strategy state).</param>
        /// <param name="incidentCoach">Incident coach (for threat drivers, alerts, etc.).</param>
        /// <param name="trackMap">Track map provider (for track map state).</param>
        /// <param name="pitboxCounters">Pitbox button counters (array of 7 volatile ints).</param>
        /// <param name="leaderboardJson">Leaderboard JSON (pre-serialized).</param>
        /// <param name="screenColorSampler">Screen color sampler (for ambient light).</param>
        /// <param name="mozaSerial">Moza hardware manager (nullable).</param>
        /// <param name="pedalProfiles">Pedal profile manager (nullable).</param>
        /// <param name="lightsPhase">Formation-lights phase (0=off, 1-5=building reds, 6=all-red, 7=green, 8=fade). Tracked at plugin scope, not on the snapshot.</param>
        /// <param name="trackSlug">Raw SimHub TrackId (e.g. "nurburgring gp"). Tracked at plugin scope, not on the snapshot.</param>
        /// <returns>Flat dictionary of wire keys → values.</returns>
        public static Dictionary<string, object> BuildDict(
            TelemetrySnapshot s,
            bool demo,
            Engine.CommentaryEngine engine = null,
            Engine.Strategy.StrategyCoordinator strategy = null,
            Engine.IncidentCoachEngine incidentCoach = null,
            Engine.TrackMapProvider trackMap = null,
            int[] pitboxCounters = null,
            string leaderboardJson = null,
            Engine.ScreenColorSampler screenColorSampler = null,
            Engine.Moza.MozaSerialManager mozaSerial = null,
            Engine.PedalProfileManager pedalProfiles = null,
            int lightsPhase = 0,
            string trackSlug = null)
        {
            if (s == null) throw new ArgumentNullException(nameof(s));

            var ic = System.Globalization.CultureInfo.InvariantCulture;
            var dict = new Dictionary<string, object>(512);

            // Handle null defaults and demo telemetry reference
            pitboxCounters = pitboxCounters ?? new int[7];
            leaderboardJson = leaderboardJson ?? "[]";

            // Demo telemetry reference. Field surface differs from TelemetrySnapshot
            // (e.g. Rpm vs. Rpms, Fuel vs. FuelLevel, LatG vs. LatAccel) — Demo wire keys
            // below MUST use DemoTelemetryProvider's names to match the HTTP path.
            var dt = engine?.DemoTelemetry ?? new Engine.DemoTelemetryProvider();

            // ── Game data (live telemetry from snapshot) ──
            dict["DataCorePlugin.GameRunning"] = (demo || s.GameRunning) ? 1 : 0;
            dict["RaceCorProDrive.Plugin.GameId"] = demo ? "iRacing" : Escape(s.GameName ?? "");
            dict["RaceCorProDrive.Plugin.SessionTypeName"] = Escape(s.SessionTypeName ?? "");
            dict["DataCorePlugin.GameData.Gear"] = Escape(s.Gear ?? "N");
            dict["DataCorePlugin.GameData.Rpms"] = s.Rpms;
            dict["DataCorePlugin.GameData.CarSettings_MaxRPM"] = s.MaxRpm;
            dict["DataCorePlugin.GameData.SpeedMph"] = s.SpeedKmh * 0.621371;
            dict["DataCorePlugin.GameData.Throttle"] = s.Throttle;
            dict["DataCorePlugin.GameData.Brake"] = s.Brake;
            dict["DataCorePlugin.GameData.Clutch"] = s.Clutch;
            dict["DataCorePlugin.GameData.Fuel"] = s.FuelLevel;
            double fuelPct = Math.Max(0.01, Math.Min(1.0, s.FuelPercent));
            dict["DataCorePlugin.GameData.MaxFuel"] = s.FuelLevel > 0 ? s.FuelLevel / fuelPct : 0;
            dict["DataCorePlugin.Computed.Fuel_LitersPerLap"] = s.FuelPerLap;
            dict["DataCorePlugin.GameData.RemainingLaps"] = s.RemainingLaps;
            dict["DataCorePlugin.GameData.TyreTempFrontLeft"] = s.TyreTempFL;
            dict["DataCorePlugin.GameData.TyreTempFrontRight"] = s.TyreTempFR;
            dict["DataCorePlugin.GameData.TyreTempRearLeft"] = s.TyreTempRL;
            dict["DataCorePlugin.GameData.TyreTempRearRight"] = s.TyreTempRR;
            dict["DataCorePlugin.GameData.TyreWearFrontLeft"] = s.TyreWearFL;
            dict["DataCorePlugin.GameData.TyreWearFrontRight"] = s.TyreWearFR;
            dict["DataCorePlugin.GameData.TyreWearRearLeft"] = s.TyreWearRL;
            dict["DataCorePlugin.GameData.TyreWearRearRight"] = s.TyreWearRR;
            dict["DataCorePlugin.GameRawData.Telemetry.dcBrakeBias"] = s.BrakeBias;
            dict["DataCorePlugin.GameRawData.Telemetry.dcTractionControl"] = s.TractionControlSetting;
            dict["DataCorePlugin.GameRawData.Telemetry.dcABS"] = s.AbsSetting;
            dict["DataCorePlugin.GameRawData.Telemetry.dcAntiRollFront"] = s.ArbFront;
            dict["DataCorePlugin.GameRawData.Telemetry.dcAntiRollRear"] = s.ArbRear;
            dict["DataCorePlugin.GameRawData.Telemetry.dcEnginePower"] = s.EnginePower;
            dict["DataCorePlugin.GameRawData.Telemetry.dcFuelMixture"] = s.FuelMixture;
            dict["DataCorePlugin.GameRawData.Telemetry.dcWeightJackerLeft"] = s.WeightJackerLeft;
            dict["DataCorePlugin.GameRawData.Telemetry.dcWeightJackerRight"] = s.WeightJackerRight;
            dict["DataCorePlugin.GameRawData.Telemetry.dcWingFront"] = s.WingFront;
            dict["DataCorePlugin.GameRawData.Telemetry.dcWingRear"] = s.WingRear;

            // Pit stop selections
            dict["RaceCorProDrive.Plugin.PitBox.PitSvFlags"] = s.PitSvFlags;
            dict["RaceCorProDrive.Plugin.PitBox.PitSvFuel"] = s.PitSvFuel;
            dict["RaceCorProDrive.Plugin.PitBox.PitSvLFP"] = s.PitSvLFP;
            dict["RaceCorProDrive.Plugin.PitBox.PitSvRFP"] = s.PitSvRFP;
            dict["RaceCorProDrive.Plugin.PitBox.PitSvLRP"] = s.PitSvLRP;
            dict["RaceCorProDrive.Plugin.PitBox.PitSvRRP"] = s.PitSvRRP;
            dict["RaceCorProDrive.Plugin.PitBox.TireCompound"] = s.PitSvTireCompound;
            dict["RaceCorProDrive.Plugin.PitBox.FastRepair"] = s.PitSvFastRepair;
            dict["RaceCorProDrive.Plugin.PitBox.Windshield"] = s.PitSvWindshieldTearoff;
            dict["RaceCorProDrive.Plugin.PitBox.TireLF"] = s.PitTireLF ? 1 : 0;
            dict["RaceCorProDrive.Plugin.PitBox.TireRF"] = s.PitTireRF ? 1 : 0;
            dict["RaceCorProDrive.Plugin.PitBox.TireLR"] = s.PitTireLR ? 1 : 0;
            dict["RaceCorProDrive.Plugin.PitBox.TireRR"] = s.PitTireRR ? 1 : 0;
            dict["RaceCorProDrive.Plugin.PitBox.TiresRequested"] = s.PitTiresRequested ? 1 : 0;
            dict["RaceCorProDrive.Plugin.PitBox.FuelRequested"] = s.PitFuelRequested ? 1 : 0;
            dict["RaceCorProDrive.Plugin.PitBox.FastRepairRequested"] = s.PitFastRepairRequested ? 1 : 0;
            dict["RaceCorProDrive.Plugin.PitBox.WindshieldRequested"] = s.PitWindshieldRequested ? 1 : 0;
            dict["RaceCorProDrive.Plugin.PitBox.FuelDisplay"] = Escape(s.PitFuelDisplay);
            dict["RaceCorProDrive.Plugin.PitBox.PressureLF"] = Escape(s.PitPressureLFDisplay);
            dict["RaceCorProDrive.Plugin.PitBox.PressureRF"] = Escape(s.PitPressureRFDisplay);
            dict["RaceCorProDrive.Plugin.PitBox.PressureLR"] = Escape(s.PitPressureLRDisplay);
            dict["RaceCorProDrive.Plugin.PitBox.PressureRR"] = Escape(s.PitPressureRRDisplay);
            dict["RaceCorProDrive.Plugin.PitBox.HasTC"] = s.HasTC ? 1 : 0;
            dict["RaceCorProDrive.Plugin.PitBox.HasABS"] = s.HasABS ? 1 : 0;
            dict["RaceCorProDrive.Plugin.PitBox.HasARBFront"] = s.HasARBFront ? 1 : 0;
            dict["RaceCorProDrive.Plugin.PitBox.HasARBRear"] = s.HasARBRear ? 1 : 0;
            dict["RaceCorProDrive.Plugin.PitBox.HasEnginePower"] = s.HasEnginePower ? 1 : 0;
            dict["RaceCorProDrive.Plugin.PitBox.HasFuelMixture"] = s.HasFuelMixture ? 1 : 0;
            dict["RaceCorProDrive.Plugin.PitBox.HasWeightJackerL"] = s.HasWeightJackerL ? 1 : 0;
            dict["RaceCorProDrive.Plugin.PitBox.HasWeightJackerR"] = s.HasWeightJackerR ? 1 : 0;
            dict["RaceCorProDrive.Plugin.PitBox.HasWingFront"] = s.HasWingFront ? 1 : 0;
            dict["RaceCorProDrive.Plugin.PitBox.HasWingRear"] = s.HasWingRear ? 1 : 0;

            dict["DataCorePlugin.GameData.Position"] = s.Position;
            dict["DataCorePlugin.GameData.CurrentLap"] = s.CurrentLap;
            dict["DataCorePlugin.GameData.BestLapTime"] = s.LapBestTime;
            dict["DataCorePlugin.GameData.CurrentLapTime"] = s.LapCurrentTime;
            dict["DataCorePlugin.GameData.LastLapTime"] = s.LapLastTime;

            double avgLap = s.LapBestTime > 0 ? s.LapBestTime : (s.LapLastTime > 0 ? s.LapLastTime : 90);
            double sessionElapsed = s.LapCurrentTime + s.CompletedLaps * avgLap;
            dict["DataCorePlugin.GameData.SessionTimeSpan"] = sessionElapsed;
            dict["DataCorePlugin.GameData.RemainingTime"] = s.SessionTimeRemain;
            dict["RaceCorProDrive.Plugin.DS.SessionLapsRemaining"] = s.SessionLapsRemaining;
            dict["DataCorePlugin.GameData.TotalLaps"] = s.SessionLapsTotal;
            dict["DataCorePlugin.GameData.CarModel"] = Escape(s.CarModel ?? "");

            // Session summary
            dict["RaceCorProDrive.Plugin.Session.Mode"] = (int)s.SessionMode;
            dict["RaceCorProDrive.Plugin.Session.ModeName"] = Escape(s.SessionMode.ToString());
            dict["RaceCorProDrive.Plugin.Session.IsLapRace"] = s.IsLapRace ? 1 : 0;
            dict["RaceCorProDrive.Plugin.Session.TrackName"] = Escape(s.TrackName ?? "");
            dict["RaceCorProDrive.Plugin.Session.LapsTotal"] = s.SessionLapsTotal;
            dict["RaceCorProDrive.Plugin.Session.LapsRemaining"] = s.SessionLapsRemaining;
            dict["RaceCorProDrive.Plugin.Session.TimeRemaining"] = s.SessionTimeRemain;
            dict["IRacingExtraProperties.iRacing_DriverInfo_IRating"] = s.IRating;
            dict["IRacingExtraProperties.iRacing_DriverInfo_SafetyRating"] = s.SafetyRating;
            dict["RaceCorProDrive.Plugin.DS.EstimatedIRatingDelta"] = s.EstimatedIRatingDelta;
            dict["RaceCorProDrive.Plugin.DS.IRatingFieldSize"] = s.IRatingFieldSize;
            dict["IRacingExtraProperties.iRacing_Opponent_Ahead_Gap"] = s.GapAhead;
            dict["IRacingExtraProperties.iRacing_Opponent_Behind_Gap"] = s.GapBehind;
            dict["IRacingExtraProperties.iRacing_Opponent_Ahead_Name"] = Escape(s.NearestAheadName ?? "");
            dict["IRacingExtraProperties.iRacing_Opponent_Behind_Name"] = Escape(s.NearestBehindName ?? "");
            dict["IRacingExtraProperties.iRacing_Opponent_Ahead_IRating"] = s.NearestAheadRating;
            dict["IRacingExtraProperties.iRacing_Opponent_Behind_IRating"] = s.NearestBehindRating;

            // Datastream (advanced physics/performance)
            dict["RaceCorProDrive.Plugin.DS.LatG"] = s.LatAccel;
            dict["RaceCorProDrive.Plugin.DS.LongG"] = s.LongAccel;
            dict["RaceCorProDrive.Plugin.DS.YawRate"] = s.YawRate;
            dict["RaceCorProDrive.Plugin.DS.SteerTorque"] = s.SteeringWheelTorque;
            dict["RaceCorProDrive.Plugin.DS.TrackTemp"] = s.TrackTemp;
            dict["RaceCorProDrive.Plugin.DS.AirTemp"] = s.AirTemp;
            dict["RaceCorProDrive.Plugin.DS.WeatherWet"] = s.WeatherWet ? 1 : 0;
            dict["RaceCorProDrive.Plugin.DS.DisplayUnits"] = s.DisplayUnits;
            dict["RaceCorProDrive.Plugin.DS.PitboxTabCycle"] = pitboxCounters[0];
            dict["RaceCorProDrive.Plugin.DS.PitboxTabCycleBack"] = pitboxCounters[1];
            dict["RaceCorProDrive.Plugin.DS.PitboxNext"] = pitboxCounters[2];
            dict["RaceCorProDrive.Plugin.DS.PitboxPrev"] = pitboxCounters[3];
            dict["RaceCorProDrive.Plugin.DS.PitboxIncrement"] = pitboxCounters[4];
            dict["RaceCorProDrive.Plugin.DS.PitboxDecrement"] = pitboxCounters[5];
            dict["RaceCorProDrive.Plugin.DS.PitboxToggle"] = pitboxCounters[6];
            dict["RaceCorProDrive.Plugin.DS.IncidentCount"] = s.IncidentCount;
            dict["RaceCorProDrive.Plugin.DS.IncidentLimitPenalty"] = s.IncidentLimitPenalty;
            dict["RaceCorProDrive.Plugin.DS.IncidentLimitDQ"] = s.IncidentLimitDQ;
            dict["RaceCorProDrive.Plugin.DS.LicenseString"] = Escape(s.LicenseString ?? "");
            dict["RaceCorProDrive.Plugin.DS.AbsActive"] = s.AbsActive ? 1 : 0;
            dict["RaceCorProDrive.Plugin.DS.TcActive"] = s.TcActive ? 1 : 0;
            dict["RaceCorProDrive.Plugin.DS.TrackPct"] = s.TrackPositionPct;
            dict["RaceCorProDrive.Plugin.DS.LapDelta"] = s.LapDeltaToBest;

            // Sector splits
            dict["RaceCorProDrive.Plugin.DS.CurrentSector"] = s.CurrentSector;
            dict["RaceCorProDrive.Plugin.DS.SectorCount"] = s.SectorCount;
            dict["RaceCorProDrive.Plugin.DS.SectorSplitS1"] = s.SectorSplitS1;
            dict["RaceCorProDrive.Plugin.DS.SectorSplitS2"] = s.SectorSplitS2;
            dict["RaceCorProDrive.Plugin.DS.SectorSplitS3"] = s.SectorSplitS3;
            dict["RaceCorProDrive.Plugin.DS.SectorDeltaS1"] = s.SectorDeltaS1;
            dict["RaceCorProDrive.Plugin.DS.SectorDeltaS2"] = s.SectorDeltaS2;
            dict["RaceCorProDrive.Plugin.DS.SectorDeltaS3"] = s.SectorDeltaS3;
            dict["RaceCorProDrive.Plugin.DS.SectorStateS1"] = s.SectorStateS1;
            dict["RaceCorProDrive.Plugin.DS.SectorStateS2"] = s.SectorStateS2;
            dict["RaceCorProDrive.Plugin.DS.SectorStateS3"] = s.SectorStateS3;
            dict["RaceCorProDrive.Plugin.DS.SectorS2StartPct"] = s.SectorS2StartPct;
            dict["RaceCorProDrive.Plugin.DS.SectorS3StartPct"] = s.SectorS3StartPct;

            // Extended individual sector properties (S4+)
            if (s.SectorSplits != null && s.SectorSplits.Length > 3)
            {
                for (int si = 3; si < s.SectorSplits.Length; si++)
                {
                    int sn = si + 1;
                    dict["RaceCorProDrive.Plugin.DS.SectorSplitS" + sn] = s.SectorSplits[si];
                    dict["RaceCorProDrive.Plugin.DS.SectorDeltaS" + sn] = s.SectorDeltas[si];
                    dict["RaceCorProDrive.Plugin.DS.SectorStateS" + sn] = s.SectorStates[si];
                }
            }

            // N-sector arrays (CSV strings)
            if (s.SectorSplits != null)
            {
                var sectorSplitsStr = string.Join(",", Array.ConvertAll(s.SectorSplits, x => x.ToString("F3", ic)));
                dict["RaceCorProDrive.Plugin.DS.SectorSplits"] = sectorSplitsStr;

                var sectorDeltasStr = string.Join(",", Array.ConvertAll(s.SectorDeltas, x => x.ToString("F3", ic)));
                dict["RaceCorProDrive.Plugin.DS.SectorDeltas"] = sectorDeltasStr;

                var sectorStatesStr = string.Join(",", s.SectorStates);
                dict["RaceCorProDrive.Plugin.DS.SectorStates"] = sectorStatesStr;

                var sectorBestsStr = s.SectorBests != null ? string.Join(",", Array.ConvertAll(s.SectorBests, x => x.ToString("F3", ic))) : "";
                dict["RaceCorProDrive.Plugin.DS.SectorBests"] = sectorBestsStr;

                var sectorBoundaryStr = s.SectorBoundaries != null ? string.Join(",", Array.ConvertAll(s.SectorBoundaries, x => x.ToString("F6", ic))) : "";
                dict["RaceCorProDrive.Plugin.DS.SectorBoundaryPcts"] = sectorBoundaryStr;
            }

            dict["RaceCorProDrive.Plugin.DS.CompletedLaps"] = s.CompletedLaps;
            dict["RaceCorProDrive.Plugin.DS.IsInPitLane"] = s.IsInPitLane ? 1 : 0;
            dict["RaceCorProDrive.Plugin.DS.SpeedKmh"] = s.SpeedKmh;
            dict["RaceCorProDrive.Plugin.DS.PitLimiterOn"] = s.PitLimiterOn ? 1 : 0;
            dict["RaceCorProDrive.Plugin.DS.PitSpeedLimitKmh"] = s.PitSpeedLimitKmh;

            // Computed DS.*
            dict["RaceCorProDrive.Plugin.DS.ThrottleNorm"] = s.ThrottleNorm;
            dict["RaceCorProDrive.Plugin.DS.BrakeNorm"] = s.BrakeNorm;
            dict["RaceCorProDrive.Plugin.DS.ClutchNorm"] = s.ClutchNorm;
            dict["RaceCorProDrive.Plugin.DS.RpmRatio"] = s.RpmRatio;
            dict["RaceCorProDrive.Plugin.DS.FuelPct"] = s.FuelPct;
            dict["RaceCorProDrive.Plugin.DS.FuelLapsRemaining"] = s.FuelLapsRemaining;
            dict["RaceCorProDrive.Plugin.DS.SpeedMph"] = s.SpeedMph;
            dict["RaceCorProDrive.Plugin.DS.PitSpeedLimitMph"] = s.PitSpeedLimitMph;
            dict["RaceCorProDrive.Plugin.DS.IsPitSpeeding"] = s.IsPitSpeeding ? 1 : 0;
            dict["RaceCorProDrive.Plugin.DS.IsNonRaceSession"] = s.IsNonRaceSession ? 1 : 0;
            dict["RaceCorProDrive.Plugin.DS.SessionMode"] = (int)s.SessionMode;
            dict["RaceCorProDrive.Plugin.DS.SessionModeName"] = Escape(s.SessionMode.ToString());
            dict["RaceCorProDrive.Plugin.DS.IsLapRace"] = s.IsLapRace ? 1 : 0;
            dict["RaceCorProDrive.Plugin.DS.IsLapInvalid"] = s.IsLapInvalid ? 1 : 0;
            dict["RaceCorProDrive.Plugin.DS.IsTimedRace"] = s.IsTimedRace ? 1 : 0;
            dict["RaceCorProDrive.Plugin.DS.IsEndOfRace"] = s.IsEndOfRace ? 1 : 0;
            dict["RaceCorProDrive.Plugin.DS.PositionDelta"] = s.PositionDelta;
            dict["RaceCorProDrive.Plugin.DS.StartPosition"] = s.StartPosition;
            dict["RaceCorProDrive.Plugin.DS.RemainingTimeFormatted"] = Escape(s.RemainingTimeFormatted ?? "");
            dict["RaceCorProDrive.Plugin.DS.SpeedDisplay"] = Escape(s.SpeedDisplay);
            dict["RaceCorProDrive.Plugin.DS.RpmDisplay"] = Escape(s.RpmDisplay);
            dict["RaceCorProDrive.Plugin.DS.FuelFormatted"] = Escape(s.FuelFormatted);
            dict["RaceCorProDrive.Plugin.DS.FuelPerLapFormatted"] = Escape(s.FuelPerLapFormatted);
            dict["RaceCorProDrive.Plugin.DS.PitSuggestion"] = Escape(s.PitSuggestion ?? "");
            dict["RaceCorProDrive.Plugin.DS.BBNorm"] = s.BBNorm;
            dict["RaceCorProDrive.Plugin.DS.TCNorm"] = s.TCNorm;
            dict["RaceCorProDrive.Plugin.DS.ABSNorm"] = s.ABSNorm;
            dict["RaceCorProDrive.Plugin.DS.PositionDeltaDisplay"] = Escape(s.PositionDeltaDisplay ?? "");
            dict["RaceCorProDrive.Plugin.DS.LapDeltaDisplay"] = Escape(s.LapDeltaDisplay ?? "");
            dict["RaceCorProDrive.Plugin.DS.SafetyRatingDisplay"] = Escape(s.SafetyRatingDisplay);
            dict["RaceCorProDrive.Plugin.DS.GapAheadFormatted"] = Escape(s.GapAheadFormatted);
            dict["RaceCorProDrive.Plugin.DS.GapBehindFormatted"] = Escape(s.GapBehindFormatted);

            dict["DataCorePlugin.GameRawData.Telemetry.FrameRate"] = s.FrameRate;
            dict["DataCorePlugin.GameRawData.Telemetry.SteeringWheelAngle"] = s.SteeringWheelAngle;

            // Commentary
            if (engine != null)
            {
                dict["RaceCorProDrive.Plugin.CommentaryVisible"] = engine.IsVisible ? 1 : 0;
                dict["RaceCorProDrive.Plugin.CommentaryText"] = Escape(engine.CurrentText ?? "");
                dict["RaceCorProDrive.Plugin.CommentaryTopicTitle"] = Escape(engine.CurrentTitle ?? "");
                dict["RaceCorProDrive.Plugin.CommentaryTopicId"] = Escape(engine.CurrentTopicId ?? "");
                string cat = engine.CurrentCategory ?? "";
                string label = engine.CurrentSentimentLabel ?? "";
                string category = string.IsNullOrEmpty(label) ? cat : cat + " — " + label;
                dict["RaceCorProDrive.Plugin.CommentaryCategory"] = Escape(category);
                dict["RaceCorProDrive.Plugin.CommentarySentimentColor"] = Escape(engine.CurrentSentimentColor ?? "#FF000000");
                dict["RaceCorProDrive.Plugin.CommentarySeverity"] = engine.IsVisible ? engine.CurrentSeverity : 0;
                dict["RaceCorProDrive.Plugin.CommentaryTrackImage"] = Escape(engine.CurrentTrackImage ?? "");
                dict["RaceCorProDrive.Plugin.CommentaryCarImage"] = Escape(engine.CurrentCarImage ?? "");
            }
            else
            {
                dict["RaceCorProDrive.Plugin.CommentaryVisible"] = 0;
                dict["RaceCorProDrive.Plugin.CommentaryText"] = "";
                dict["RaceCorProDrive.Plugin.CommentaryTopicTitle"] = "";
                dict["RaceCorProDrive.Plugin.CommentaryTopicId"] = "";
                dict["RaceCorProDrive.Plugin.CommentaryCategory"] = "";
                dict["RaceCorProDrive.Plugin.CommentarySentimentColor"] = "#FF000000";
                dict["RaceCorProDrive.Plugin.CommentarySeverity"] = 0;
                dict["RaceCorProDrive.Plugin.CommentaryTrackImage"] = "";
                dict["RaceCorProDrive.Plugin.CommentaryCarImage"] = "";
            }

            // Strategy
            if (strategy != null)
            {
                dict["RaceCorProDrive.Plugin.Strategy.Visible"] = strategy.IsVisible ? 1 : 0;
                dict["RaceCorProDrive.Plugin.Strategy.Text"] = Escape(strategy.CurrentText ?? "");
                dict["RaceCorProDrive.Plugin.Strategy.Label"] = Escape(strategy.CurrentLabel ?? "");
                dict["RaceCorProDrive.Plugin.Strategy.Severity"] = strategy.CurrentSeverity;
                dict["RaceCorProDrive.Plugin.Strategy.Color"] = Escape("#0084FF");
                dict["RaceCorProDrive.Plugin.Strategy.TextColor"] = Escape("#FFFFFFFF");
                dict["RaceCorProDrive.Plugin.Strategy.FuelLapsRemaining"] = strategy.Fuel.FuelLapsRemaining;
                dict["RaceCorProDrive.Plugin.Strategy.FuelHealthState"] = strategy.Fuel.FuelHealthState;
                dict["RaceCorProDrive.Plugin.Strategy.CanMakeItToEnd"] = strategy.Fuel.CanMakeItToEnd ? 1 : 0;
                dict["RaceCorProDrive.Plugin.Strategy.PitWindowOpen"] = strategy.Fuel.PitWindowOpen;
                dict["RaceCorProDrive.Plugin.Strategy.PitWindowClose"] = strategy.Fuel.PitWindowClose;
                dict["RaceCorProDrive.Plugin.Strategy.TireHealthState"] = strategy.Tires.TireHealthState;
                dict["RaceCorProDrive.Plugin.Strategy.TireLapsRemaining"] = strategy.Tires.EstimatedLapsRemaining;
                dict["RaceCorProDrive.Plugin.Strategy.GripScore"] = strategy.Tires.GripScore;
                dict["RaceCorProDrive.Plugin.Strategy.StintNumber"] = strategy.StintCount;
                dict["RaceCorProDrive.Plugin.Strategy.StintLaps"] = strategy.CurrentStint != null ? strategy.CurrentStint.LapsCompleted : 0;
            }
            else
            {
                dict["RaceCorProDrive.Plugin.Strategy.Visible"] = 0;
                dict["RaceCorProDrive.Plugin.Strategy.Text"] = "";
                dict["RaceCorProDrive.Plugin.Strategy.Label"] = "";
                dict["RaceCorProDrive.Plugin.Strategy.Severity"] = 0;
                dict["RaceCorProDrive.Plugin.Strategy.Color"] = "#0084FF";
                dict["RaceCorProDrive.Plugin.Strategy.TextColor"] = "#FFFFFFFF";
                dict["RaceCorProDrive.Plugin.Strategy.FuelLapsRemaining"] = 0.0;
                dict["RaceCorProDrive.Plugin.Strategy.FuelHealthState"] = 0;
                dict["RaceCorProDrive.Plugin.Strategy.CanMakeItToEnd"] = 0;
                dict["RaceCorProDrive.Plugin.Strategy.PitWindowOpen"] = 0;
                dict["RaceCorProDrive.Plugin.Strategy.PitWindowClose"] = 0;
                dict["RaceCorProDrive.Plugin.Strategy.TireHealthState"] = 0;
                dict["RaceCorProDrive.Plugin.Strategy.TireLapsRemaining"] = 0.0;
                dict["RaceCorProDrive.Plugin.Strategy.GripScore"] = 0.0;
                dict["RaceCorProDrive.Plugin.Strategy.StintNumber"] = 0;
                dict["RaceCorProDrive.Plugin.Strategy.StintLaps"] = 0;
            }

            // Incident Coach
            if (incidentCoach != null)
            {
                dict["RaceCorProDrive.Plugin.DS.IncidentCoach.Active"] = incidentCoach.Enabled ? 1 : 0;
                dict["RaceCorProDrive.Plugin.DS.IncidentCoach.LastIncidentLap"] = incidentCoach.LastIncidentLap;
                dict["RaceCorProDrive.Plugin.DS.IncidentCoach.ThreatDrivers"] = incidentCoach.ThreatDriversJson ?? "[]";
                dict["RaceCorProDrive.Plugin.DS.IncidentCoach.ActiveAlert"] = incidentCoach.ActiveAlertJson ?? "{}";
                dict["RaceCorProDrive.Plugin.DS.IncidentCoach.RageScore"] = incidentCoach.RageScore;
                dict["RaceCorProDrive.Plugin.DS.IncidentCoach.CooldownActive"] = incidentCoach.IsCooldownActive ? 1 : 0;
                dict["RaceCorProDrive.Plugin.DS.IncidentCoach.SessionBehavior"] = incidentCoach.SessionBehaviorJson ?? "{}";
            }
            else
            {
                dict["RaceCorProDrive.Plugin.DS.IncidentCoach.Active"] = 0;
                dict["RaceCorProDrive.Plugin.DS.IncidentCoach.LastIncidentLap"] = 0;
                dict["RaceCorProDrive.Plugin.DS.IncidentCoach.ThreatDrivers"] = "[]";
                dict["RaceCorProDrive.Plugin.DS.IncidentCoach.ActiveAlert"] = "{}";
                dict["RaceCorProDrive.Plugin.DS.IncidentCoach.RageScore"] = 0;
                dict["RaceCorProDrive.Plugin.DS.IncidentCoach.CooldownActive"] = 0;
                dict["RaceCorProDrive.Plugin.DS.IncidentCoach.SessionBehavior"] = "{}";
            }

            // Demo mode
            dict["RaceCorProDrive.Plugin.DemoMode"] = demo ? 1 : 0;
            dict["RaceCorProDrive.Plugin.Demo.Gear"] = Escape(dt.Gear ?? "N");
            dict["RaceCorProDrive.Plugin.Demo.Rpm"] = dt.Rpm;
            dict["RaceCorProDrive.Plugin.Demo.MaxRpm"] = dt.MaxRpm;
            dict["RaceCorProDrive.Plugin.Demo.SpeedMph"] = dt.SpeedMph;
            dict["RaceCorProDrive.Plugin.Demo.Throttle"] = dt.Throttle * 100;
            dict["RaceCorProDrive.Plugin.Demo.Brake"] = dt.Brake * 100;
            dict["RaceCorProDrive.Plugin.Demo.Clutch"] = dt.Clutch * 100;
            dict["RaceCorProDrive.Plugin.Demo.Fuel"] = dt.Fuel;
            dict["RaceCorProDrive.Plugin.Demo.MaxFuel"] = dt.MaxFuel;
            dict["RaceCorProDrive.Plugin.Demo.FuelPerLap"] = dt.FuelPerLap;
            dict["RaceCorProDrive.Plugin.Demo.RemainingLaps"] = dt.RemainingLaps;
            dict["RaceCorProDrive.Plugin.Demo.TyreTempFL"] = dt.TyreTempFL;
            dict["RaceCorProDrive.Plugin.Demo.TyreTempFR"] = dt.TyreTempFR;
            dict["RaceCorProDrive.Plugin.Demo.TyreTempRL"] = dt.TyreTempRL;
            dict["RaceCorProDrive.Plugin.Demo.TyreTempRR"] = dt.TyreTempRR;
            dict["RaceCorProDrive.Plugin.Demo.TyreWearFL"] = dt.TyreWearFL;
            dict["RaceCorProDrive.Plugin.Demo.TyreWearFR"] = dt.TyreWearFR;
            dict["RaceCorProDrive.Plugin.Demo.TyreWearRL"] = dt.TyreWearRL;
            dict["RaceCorProDrive.Plugin.Demo.TyreWearRR"] = dt.TyreWearRR;
            dict["RaceCorProDrive.Plugin.Demo.BrakeBias"] = dt.BrakeBias;
            dict["RaceCorProDrive.Plugin.Demo.TC"] = dt.TC;
            dict["RaceCorProDrive.Plugin.Demo.ABS"] = dt.ABS;
            dict["RaceCorProDrive.Plugin.Demo.SessionTypeName"] = Escape(dt.SessionTypeName ?? "");
            dict["RaceCorProDrive.Plugin.Demo.SessionMode"] = (int)dt.SessionMode;
            dict["RaceCorProDrive.Plugin.Demo.SessionModeName"] = Escape(dt.SessionMode.ToString());
            dict["RaceCorProDrive.Plugin.Demo.Position"] = dt.Position;
            dict["RaceCorProDrive.Plugin.Demo.CurrentLap"] = dt.CurrentLap;
            dict["RaceCorProDrive.Plugin.Demo.BestLapTime"] = dt.BestLapTime;
            dict["RaceCorProDrive.Plugin.Demo.CurrentLapTime"] = dt.CurrentLapTime;
            dict["RaceCorProDrive.Plugin.Demo.CarModel"] = Escape(dt.CarModel ?? "");
            dict["RaceCorProDrive.Plugin.Demo.SessionTime"] = dt.SessionTime;
            dict["RaceCorProDrive.Plugin.Demo.LastLapTime"] = dt.LastLapTime;
            dict["RaceCorProDrive.Plugin.Demo.RemainingTime"] = dt.RemainingTime;
            dict["RaceCorProDrive.Plugin.Demo.TotalLaps"] = dt.TotalLaps;
            dict["RaceCorProDrive.Plugin.Demo.IRating"] = dt.IRating;
            dict["RaceCorProDrive.Plugin.Demo.SafetyRating"] = dt.SafetyRating;
            dict["RaceCorProDrive.Plugin.Demo.GapAhead"] = dt.GapAhead;
            dict["RaceCorProDrive.Plugin.Demo.GapBehind"] = dt.GapBehind;
            dict["RaceCorProDrive.Plugin.Demo.DriverAhead"] = Escape(dt.DriverAhead ?? "");
            dict["RaceCorProDrive.Plugin.Demo.DriverBehind"] = Escape(dt.DriverBehind ?? "");
            dict["RaceCorProDrive.Plugin.Demo.IRAhead"] = dt.IRAhead;
            dict["RaceCorProDrive.Plugin.Demo.IRBehind"] = dt.IRBehind;

            // Demo Datastream
            dict["RaceCorProDrive.Plugin.Demo.DS.LatG"] = dt.LatG;
            dict["RaceCorProDrive.Plugin.Demo.DS.LongG"] = dt.LongG;
            dict["RaceCorProDrive.Plugin.Demo.DS.YawRate"] = dt.YawRate;
            dict["RaceCorProDrive.Plugin.Demo.DS.SteerTorque"] = dt.SteerTorque;
            dict["RaceCorProDrive.Plugin.Demo.DS.TrackTemp"] = dt.TrackTemp;
            dict["RaceCorProDrive.Plugin.Demo.DS.IncidentCount"] = dt.IncidentCount;
            dict["RaceCorProDrive.Plugin.Demo.DS.AbsActive"] = dt.AbsActive ? 1 : 0;
            dict["RaceCorProDrive.Plugin.Demo.DS.TcActive"] = dt.TcActive ? 1 : 0;
            dict["RaceCorProDrive.Plugin.Demo.DS.LapDelta"] = dt.LapDelta;
            dict["RaceCorProDrive.Plugin.Demo.DS.IsInPitLane"] = dt.IsInPitLane ? 1 : 0;
            dict["RaceCorProDrive.Plugin.Demo.DS.SessionMode"] = (int)dt.SessionMode;
            dict["RaceCorProDrive.Plugin.Demo.DS.SessionModeName"] = Escape(dt.SessionMode.ToString());
            dict["RaceCorProDrive.Plugin.Demo.DS.IsLapRace"] = dt.IsLapRace ? 1 : 0;
            dict["RaceCorProDrive.Plugin.Demo.DS.IsLapInvalid"] = dt.IsLapInvalid ? 1 : 0;
            dict["RaceCorProDrive.Plugin.Demo.DS.SectorBests"] = "";
            dict["RaceCorProDrive.Plugin.Demo.DS.SpeedKmh"] = dt.SpeedKmh;
            dict["RaceCorProDrive.Plugin.Demo.DS.PitLimiterOn"] = dt.IsInPitLane ? 1 : 0;
            dict["RaceCorProDrive.Plugin.Demo.DS.PitSpeedLimitKmh"] = 72.0;

            // Demo Computed DS.*
            dict["RaceCorProDrive.Plugin.Demo.DS.ThrottleNorm"] = dt.ThrottleNorm;
            dict["RaceCorProDrive.Plugin.Demo.DS.BrakeNorm"] = dt.BrakeNorm;
            dict["RaceCorProDrive.Plugin.Demo.DS.ClutchNorm"] = dt.ClutchNorm;
            dict["RaceCorProDrive.Plugin.Demo.DS.RpmRatio"] = dt.RpmRatio;
            dict["RaceCorProDrive.Plugin.Demo.DS.FuelPct"] = dt.FuelPct;
            dict["RaceCorProDrive.Plugin.Demo.DS.FuelLapsRemaining"] = dt.FuelLapsRemaining;
            dict["RaceCorProDrive.Plugin.Demo.DS.SpeedMph"] = dt.SpeedMph;
            dict["RaceCorProDrive.Plugin.Demo.DS.PitSpeedLimitMph"] = dt.PitSpeedLimitMph;
            dict["RaceCorProDrive.Plugin.Demo.DS.IsPitSpeeding"] = dt.IsPitSpeeding ? 1 : 0;
            dict["RaceCorProDrive.Plugin.Demo.DS.IsNonRaceSession"] = dt.IsNonRaceSession ? 1 : 0;

            // Grid state
            dict["RaceCorProDrive.Plugin.Grid.SessionState"] = s.SessionState;
            dict["RaceCorProDrive.Plugin.Grid.GriddedCars"] = s.GriddedCars;
            dict["RaceCorProDrive.Plugin.Grid.TotalCars"] = s.TotalCars;
            dict["RaceCorProDrive.Plugin.Grid.PaceMode"] = s.PaceMode;
            dict["RaceCorProDrive.Plugin.Grid.LightsPhase"] = lightsPhase;
            dict["RaceCorProDrive.Plugin.Grid.StartType"] = Escape(s.IsStandingStart ? "standing" : "rolling");
            dict["RaceCorProDrive.Plugin.Grid.TrackCountry"] = Escape(s.TrackCountry ?? "");

            // Demo Grid state
            dict["RaceCorProDrive.Plugin.Demo.Grid.SessionState"] = dt.SessionState;
            dict["RaceCorProDrive.Plugin.Demo.Grid.GriddedCars"] = dt.GriddedCars;
            dict["RaceCorProDrive.Plugin.Demo.Grid.TotalCars"] = dt.TotalCars;
            dict["RaceCorProDrive.Plugin.Demo.Grid.PaceMode"] = dt.PaceMode;
            dict["RaceCorProDrive.Plugin.Demo.Grid.LightsPhase"] = dt.LightsPhase;
            dict["RaceCorProDrive.Plugin.Demo.Grid.StartType"] = Escape(dt.IsStandingStart ? "standing" : "rolling");
            dict["RaceCorProDrive.Plugin.Demo.Grid.TrackCountry"] = Escape(dt.TrackCountry ?? "");

            // Driver name
            string playerName = s.PlayerName ?? "";
            if (!string.IsNullOrEmpty(playerName))
            {
                var nameParts = playerName.Trim().Split(new[] { ' ' }, 2);
                dict["RaceCorProDrive.Plugin.DriverFirstName"] = Escape(nameParts[0]);
                dict["RaceCorProDrive.Plugin.DriverLastName"] = Escape(nameParts.Length > 1 ? nameParts[1] : "");
            }

            // Track map
            if (trackMap != null)
            {
                dict["RaceCorProDrive.Plugin.TrackMap.Ready"] = trackMap.IsReady ? 1 : 0;
                dict["RaceCorProDrive.Plugin.TrackMap.TrackName"] = Escape(trackMap.TrackName ?? "");
                dict["RaceCorProDrive.Plugin.TrackMap.TrackSlug"] = Escape(trackSlug ?? "");
                dict["RaceCorProDrive.Plugin.TrackMap.SvgPath"] = Escape(trackMap.SvgPath ?? "");
                dict["RaceCorProDrive.Plugin.TrackMap.PlayerX"] = trackMap.PlayerX;
                dict["RaceCorProDrive.Plugin.TrackMap.PlayerY"] = trackMap.PlayerY;
                dict["RaceCorProDrive.Plugin.TrackMap.PlayerHeading"] = trackMap.PlayerHeadingDeg;
                dict["RaceCorProDrive.Plugin.TrackMap.Opponents"] = Escape(trackMap.OpponentData ?? "");
            }
            else
            {
                dict["RaceCorProDrive.Plugin.TrackMap.Ready"] = 0;
                dict["RaceCorProDrive.Plugin.TrackMap.TrackName"] = "";
                dict["RaceCorProDrive.Plugin.TrackMap.TrackSlug"] = Escape(trackSlug ?? "");
                dict["RaceCorProDrive.Plugin.TrackMap.SvgPath"] = "";
                dict["RaceCorProDrive.Plugin.TrackMap.PlayerX"] = 0.0;
                dict["RaceCorProDrive.Plugin.TrackMap.PlayerY"] = 0.0;
                dict["RaceCorProDrive.Plugin.TrackMap.PlayerHeading"] = 0.0;
                dict["RaceCorProDrive.Plugin.TrackMap.Opponents"] = "";
            }

            // Leaderboard
            dict["RaceCorProDrive.Plugin.Leaderboard"] = leaderboardJson ?? "[]";

            // Extra (homebridge / legacy)
            dict["currentFlagState"] = Escape(GetFlagState(s, demo));
            double nearestDist = CalculateNearestCarDistance(s);
            dict["nearestCarDistance"] = nearestDist;

            // Ambient light
            if (screenColorSampler != null)
            {
                dict["RaceCorProDrive.Plugin.DS.AmbientR"] = screenColorSampler.HasColor ? screenColorSampler.R : 0;
                dict["RaceCorProDrive.Plugin.DS.AmbientG"] = screenColorSampler.HasColor ? screenColorSampler.G : 0;
                dict["RaceCorProDrive.Plugin.DS.AmbientB"] = screenColorSampler.HasColor ? screenColorSampler.B : 0;
                dict["RaceCorProDrive.Plugin.DS.AmbientHasData"] = screenColorSampler.HasColor ? 1 : 0;
            }
            else
            {
                dict["RaceCorProDrive.Plugin.DS.AmbientR"] = 0;
                dict["RaceCorProDrive.Plugin.DS.AmbientG"] = 0;
                dict["RaceCorProDrive.Plugin.DS.AmbientB"] = 0;
                dict["RaceCorProDrive.Plugin.DS.AmbientHasData"] = 0;
            }

            return dict;
        }

        private static string GetFlagState(TelemetrySnapshot s, bool demo)
        {
            if (!s.GameRunning && !demo) return "none";

            int f = s.SessionFlags;
            if ((f & TelemetrySnapshot.FLAG_RED) != 0) return "red";
            if ((f & TelemetrySnapshot.FLAG_REPAIR) != 0) return "meatball";
            if ((f & TelemetrySnapshot.FLAG_BLACK) != 0) return "black";
            if ((f & TelemetrySnapshot.FLAG_YELLOW) != 0) return "yellow";
            if ((f & TelemetrySnapshot.FLAG_BLUE) != 0) return "blue";
            if ((f & TelemetrySnapshot.FLAG_DEBRIS) != 0) return "debris";
            if ((f & TelemetrySnapshot.FLAG_WHITE) != 0) return "white";
            if ((f & TelemetrySnapshot.FLAG_CHECKERED) != 0) return "checkered";
            if ((f & TelemetrySnapshot.FLAG_GREEN) != 0) return "green";
            return "none";
        }

        private static double CalculateNearestCarDistance(TelemetrySnapshot s)
        {
            double nearestDist = 1.0;
            if (s.GameRunning && s.CarIdxLapDistPct != null && s.CarIdxLapDistPct.Length > 0)
            {
                double playerPos = s.TrackPositionPct;
                int playerIdx = s.PlayerCarIdx;
                for (int i = 0; i < s.CarIdxLapDistPct.Length; i++)
                {
                    if (i == playerIdx) continue;
                    double other = s.CarIdxLapDistPct[i];
                    if (other <= 0) continue;
                    double d = Math.Abs(playerPos - other);
                    d = Math.Min(d, 1.0 - d);
                    if (d < nearestDist) nearestDist = d;
                }
            }
            return nearestDist;
        }

        private static string Escape(string s)
        {
            if (s == null) return "";
            return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", "\\n").Replace("\r", "");
        }
    }
}
