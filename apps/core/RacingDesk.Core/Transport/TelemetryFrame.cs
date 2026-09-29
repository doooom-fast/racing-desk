using System;
using System.Collections.Generic;
using RacingDesk.Plugin.Engine;

namespace RacingDesk.Plugin.Transport
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
            dict["RacingDesk.Plugin.GameId"] = demo ? "iRacing" : Escape(s.GameName ?? "");
            dict["RacingDesk.Plugin.SessionTypeName"] = Escape(s.SessionTypeName ?? "");
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
            dict["RacingDesk.Plugin.PitBox.PitSvFlags"] = s.PitSvFlags;
            dict["RacingDesk.Plugin.PitBox.PitSvFuel"] = s.PitSvFuel;
            dict["RacingDesk.Plugin.PitBox.PitSvLFP"] = s.PitSvLFP;
            dict["RacingDesk.Plugin.PitBox.PitSvRFP"] = s.PitSvRFP;
            dict["RacingDesk.Plugin.PitBox.PitSvLRP"] = s.PitSvLRP;
            dict["RacingDesk.Plugin.PitBox.PitSvRRP"] = s.PitSvRRP;
            dict["RacingDesk.Plugin.PitBox.TireCompound"] = s.PitSvTireCompound;
            dict["RacingDesk.Plugin.PitBox.FastRepair"] = s.PitSvFastRepair;
            dict["RacingDesk.Plugin.PitBox.Windshield"] = s.PitSvWindshieldTearoff;
            dict["RacingDesk.Plugin.PitBox.TireLF"] = s.PitTireLF ? 1 : 0;
            dict["RacingDesk.Plugin.PitBox.TireRF"] = s.PitTireRF ? 1 : 0;
            dict["RacingDesk.Plugin.PitBox.TireLR"] = s.PitTireLR ? 1 : 0;
            dict["RacingDesk.Plugin.PitBox.TireRR"] = s.PitTireRR ? 1 : 0;
            dict["RacingDesk.Plugin.PitBox.TiresRequested"] = s.PitTiresRequested ? 1 : 0;
            dict["RacingDesk.Plugin.PitBox.FuelRequested"] = s.PitFuelRequested ? 1 : 0;
            dict["RacingDesk.Plugin.PitBox.FastRepairRequested"] = s.PitFastRepairRequested ? 1 : 0;
            dict["RacingDesk.Plugin.PitBox.WindshieldRequested"] = s.PitWindshieldRequested ? 1 : 0;
            dict["RacingDesk.Plugin.PitBox.FuelDisplay"] = Escape(s.PitFuelDisplay);
            dict["RacingDesk.Plugin.PitBox.PressureLF"] = Escape(s.PitPressureLFDisplay);
            dict["RacingDesk.Plugin.PitBox.PressureRF"] = Escape(s.PitPressureRFDisplay);
            dict["RacingDesk.Plugin.PitBox.PressureLR"] = Escape(s.PitPressureLRDisplay);
            dict["RacingDesk.Plugin.PitBox.PressureRR"] = Escape(s.PitPressureRRDisplay);
            dict["RacingDesk.Plugin.PitBox.HasTC"] = s.HasTC ? 1 : 0;
            dict["RacingDesk.Plugin.PitBox.HasABS"] = s.HasABS ? 1 : 0;
            dict["RacingDesk.Plugin.PitBox.HasARBFront"] = s.HasARBFront ? 1 : 0;
            dict["RacingDesk.Plugin.PitBox.HasARBRear"] = s.HasARBRear ? 1 : 0;
            dict["RacingDesk.Plugin.PitBox.HasEnginePower"] = s.HasEnginePower ? 1 : 0;
            dict["RacingDesk.Plugin.PitBox.HasFuelMixture"] = s.HasFuelMixture ? 1 : 0;
            dict["RacingDesk.Plugin.PitBox.HasWeightJackerL"] = s.HasWeightJackerL ? 1 : 0;
            dict["RacingDesk.Plugin.PitBox.HasWeightJackerR"] = s.HasWeightJackerR ? 1 : 0;
            dict["RacingDesk.Plugin.PitBox.HasWingFront"] = s.HasWingFront ? 1 : 0;
            dict["RacingDesk.Plugin.PitBox.HasWingRear"] = s.HasWingRear ? 1 : 0;

            dict["DataCorePlugin.GameData.Position"] = s.Position;
            dict["DataCorePlugin.GameData.CurrentLap"] = s.CurrentLap;
            dict["DataCorePlugin.GameData.BestLapTime"] = s.LapBestTime;
            dict["DataCorePlugin.GameData.CurrentLapTime"] = s.LapCurrentTime;
            dict["DataCorePlugin.GameData.LastLapTime"] = s.LapLastTime;

            double avgLap = s.LapBestTime > 0 ? s.LapBestTime : (s.LapLastTime > 0 ? s.LapLastTime : 90);
            double sessionElapsed = s.LapCurrentTime + s.CompletedLaps * avgLap;
            dict["DataCorePlugin.GameData.SessionTimeSpan"] = sessionElapsed;
            dict["DataCorePlugin.GameData.RemainingTime"] = s.SessionTimeRemain;
            dict["RacingDesk.Plugin.DS.SessionLapsRemaining"] = s.SessionLapsRemaining;
            dict["DataCorePlugin.GameData.TotalLaps"] = s.SessionLapsTotal;
            dict["DataCorePlugin.GameData.CarModel"] = Escape(s.CarModel ?? "");

            // Session summary
            dict["RacingDesk.Plugin.Session.Mode"] = (int)s.SessionMode;
            dict["RacingDesk.Plugin.Session.ModeName"] = Escape(s.SessionMode.ToString());
            dict["RacingDesk.Plugin.Session.IsLapRace"] = s.IsLapRace ? 1 : 0;
            dict["RacingDesk.Plugin.Session.TrackName"] = Escape(s.TrackName ?? "");
            dict["RacingDesk.Plugin.Session.LapsTotal"] = s.SessionLapsTotal;
            dict["RacingDesk.Plugin.Session.LapsRemaining"] = s.SessionLapsRemaining;
            dict["RacingDesk.Plugin.Session.TimeRemaining"] = s.SessionTimeRemain;
            dict["IRacingExtraProperties.iRacing_DriverInfo_IRating"] = s.IRating;
            dict["IRacingExtraProperties.iRacing_DriverInfo_SafetyRating"] = s.SafetyRating;
            dict["RacingDesk.Plugin.DS.EstimatedIRatingDelta"] = s.EstimatedIRatingDelta;
            dict["RacingDesk.Plugin.DS.IRatingFieldSize"] = s.IRatingFieldSize;
            dict["IRacingExtraProperties.iRacing_Opponent_Ahead_Gap"] = s.GapAhead;
            dict["IRacingExtraProperties.iRacing_Opponent_Behind_Gap"] = s.GapBehind;
            dict["IRacingExtraProperties.iRacing_Opponent_Ahead_Name"] = Escape(s.NearestAheadName ?? "");
            dict["IRacingExtraProperties.iRacing_Opponent_Behind_Name"] = Escape(s.NearestBehindName ?? "");
            dict["IRacingExtraProperties.iRacing_Opponent_Ahead_IRating"] = s.NearestAheadRating;
            dict["IRacingExtraProperties.iRacing_Opponent_Behind_IRating"] = s.NearestBehindRating;

            // Datastream (advanced physics/performance)
            dict["RacingDesk.Plugin.DS.LatG"] = s.LatAccel;
            dict["RacingDesk.Plugin.DS.LongG"] = s.LongAccel;
            dict["RacingDesk.Plugin.DS.YawRate"] = s.YawRate;
            dict["RacingDesk.Plugin.DS.SteerTorque"] = s.SteeringWheelTorque;
            dict["RacingDesk.Plugin.DS.TrackTemp"] = s.TrackTemp;
            dict["RacingDesk.Plugin.DS.AirTemp"] = s.AirTemp;
            dict["RacingDesk.Plugin.DS.WeatherWet"] = s.WeatherWet ? 1 : 0;
            dict["RacingDesk.Plugin.DS.DisplayUnits"] = s.DisplayUnits;
            dict["RacingDesk.Plugin.DS.PitboxTabCycle"] = pitboxCounters[0];
            dict["RacingDesk.Plugin.DS.PitboxTabCycleBack"] = pitboxCounters[1];
            dict["RacingDesk.Plugin.DS.PitboxNext"] = pitboxCounters[2];
            dict["RacingDesk.Plugin.DS.PitboxPrev"] = pitboxCounters[3];
            dict["RacingDesk.Plugin.DS.PitboxIncrement"] = pitboxCounters[4];
            dict["RacingDesk.Plugin.DS.PitboxDecrement"] = pitboxCounters[5];
            dict["RacingDesk.Plugin.DS.PitboxToggle"] = pitboxCounters[6];
            dict["RacingDesk.Plugin.DS.IncidentCount"] = s.IncidentCount;
            dict["RacingDesk.Plugin.DS.IncidentLimitPenalty"] = s.IncidentLimitPenalty;
            dict["RacingDesk.Plugin.DS.IncidentLimitDQ"] = s.IncidentLimitDQ;
            dict["RacingDesk.Plugin.DS.LicenseString"] = Escape(s.LicenseString ?? "");
            dict["RacingDesk.Plugin.DS.AbsActive"] = s.AbsActive ? 1 : 0;
            dict["RacingDesk.Plugin.DS.TcActive"] = s.TcActive ? 1 : 0;
            dict["RacingDesk.Plugin.DS.TrackPct"] = s.TrackPositionPct;
            dict["RacingDesk.Plugin.DS.LapDelta"] = s.LapDeltaToBest;

            // Sector splits
            dict["RacingDesk.Plugin.DS.CurrentSector"] = s.CurrentSector;
            dict["RacingDesk.Plugin.DS.SectorCount"] = s.SectorCount;
            dict["RacingDesk.Plugin.DS.SectorSplitS1"] = s.SectorSplitS1;
            dict["RacingDesk.Plugin.DS.SectorSplitS2"] = s.SectorSplitS2;
            dict["RacingDesk.Plugin.DS.SectorSplitS3"] = s.SectorSplitS3;
            dict["RacingDesk.Plugin.DS.SectorDeltaS1"] = s.SectorDeltaS1;
            dict["RacingDesk.Plugin.DS.SectorDeltaS2"] = s.SectorDeltaS2;
            dict["RacingDesk.Plugin.DS.SectorDeltaS3"] = s.SectorDeltaS3;
            dict["RacingDesk.Plugin.DS.SectorStateS1"] = s.SectorStateS1;
            dict["RacingDesk.Plugin.DS.SectorStateS2"] = s.SectorStateS2;
            dict["RacingDesk.Plugin.DS.SectorStateS3"] = s.SectorStateS3;
            dict["RacingDesk.Plugin.DS.SectorS2StartPct"] = s.SectorS2StartPct;
            dict["RacingDesk.Plugin.DS.SectorS3StartPct"] = s.SectorS3StartPct;

            // Extended individual sector properties (S4+)
            if (s.SectorSplits != null && s.SectorSplits.Length > 3)
            {
                for (int si = 3; si < s.SectorSplits.Length; si++)
                {
                    int sn = si + 1;
                    dict["RacingDesk.Plugin.DS.SectorSplitS" + sn] = s.SectorSplits[si];
                    dict["RacingDesk.Plugin.DS.SectorDeltaS" + sn] = s.SectorDeltas[si];
                    dict["RacingDesk.Plugin.DS.SectorStateS" + sn] = s.SectorStates[si];
                }
            }

            // N-sector arrays (CSV strings)
            if (s.SectorSplits != null)
            {
                var sectorSplitsStr = string.Join(",", Array.ConvertAll(s.SectorSplits, x => x.ToString("F3", ic)));
                dict["RacingDesk.Plugin.DS.SectorSplits"] = sectorSplitsStr;

                var sectorDeltasStr = string.Join(",", Array.ConvertAll(s.SectorDeltas, x => x.ToString("F3", ic)));
                dict["RacingDesk.Plugin.DS.SectorDeltas"] = sectorDeltasStr;

                var sectorStatesStr = string.Join(",", s.SectorStates);
                dict["RacingDesk.Plugin.DS.SectorStates"] = sectorStatesStr;

                var sectorBestsStr = s.SectorBests != null ? string.Join(",", Array.ConvertAll(s.SectorBests, x => x.ToString("F3", ic))) : "";
                dict["RacingDesk.Plugin.DS.SectorBests"] = sectorBestsStr;

                var sectorBoundaryStr = s.SectorBoundaries != null ? string.Join(",", Array.ConvertAll(s.SectorBoundaries, x => x.ToString("F6", ic))) : "";
                dict["RacingDesk.Plugin.DS.SectorBoundaryPcts"] = sectorBoundaryStr;
            }

            dict["RacingDesk.Plugin.DS.CompletedLaps"] = s.CompletedLaps;
            dict["RacingDesk.Plugin.DS.IsInPitLane"] = s.IsInPitLane ? 1 : 0;
            dict["RacingDesk.Plugin.DS.SpeedKmh"] = s.SpeedKmh;
            dict["RacingDesk.Plugin.DS.PitLimiterOn"] = s.PitLimiterOn ? 1 : 0;
            dict["RacingDesk.Plugin.DS.PitSpeedLimitKmh"] = s.PitSpeedLimitKmh;

            // Computed DS.*
            dict["RacingDesk.Plugin.DS.ThrottleNorm"] = s.ThrottleNorm;
            dict["RacingDesk.Plugin.DS.BrakeNorm"] = s.BrakeNorm;
            dict["RacingDesk.Plugin.DS.ClutchNorm"] = s.ClutchNorm;
            dict["RacingDesk.Plugin.DS.RpmRatio"] = s.RpmRatio;
            dict["RacingDesk.Plugin.DS.FuelPct"] = s.FuelPct;
            dict["RacingDesk.Plugin.DS.FuelLapsRemaining"] = s.FuelLapsRemaining;
            dict["RacingDesk.Plugin.DS.SpeedMph"] = s.SpeedMph;
            dict["RacingDesk.Plugin.DS.PitSpeedLimitMph"] = s.PitSpeedLimitMph;
            dict["RacingDesk.Plugin.DS.IsPitSpeeding"] = s.IsPitSpeeding ? 1 : 0;
            dict["RacingDesk.Plugin.DS.IsNonRaceSession"] = s.IsNonRaceSession ? 1 : 0;
            dict["RacingDesk.Plugin.DS.SessionMode"] = (int)s.SessionMode;
            dict["RacingDesk.Plugin.DS.SessionModeName"] = Escape(s.SessionMode.ToString());
            dict["RacingDesk.Plugin.DS.IsLapRace"] = s.IsLapRace ? 1 : 0;
            dict["RacingDesk.Plugin.DS.IsLapInvalid"] = s.IsLapInvalid ? 1 : 0;
            dict["RacingDesk.Plugin.DS.IsTimedRace"] = s.IsTimedRace ? 1 : 0;
            dict["RacingDesk.Plugin.DS.IsEndOfRace"] = s.IsEndOfRace ? 1 : 0;
            dict["RacingDesk.Plugin.DS.PositionDelta"] = s.PositionDelta;
            dict["RacingDesk.Plugin.DS.StartPosition"] = s.StartPosition;
            dict["RacingDesk.Plugin.DS.RemainingTimeFormatted"] = Escape(s.RemainingTimeFormatted ?? "");
            dict["RacingDesk.Plugin.DS.SpeedDisplay"] = Escape(s.SpeedDisplay);
            dict["RacingDesk.Plugin.DS.RpmDisplay"] = Escape(s.RpmDisplay);
            dict["RacingDesk.Plugin.DS.FuelFormatted"] = Escape(s.FuelFormatted);
            dict["RacingDesk.Plugin.DS.FuelPerLapFormatted"] = Escape(s.FuelPerLapFormatted);
            dict["RacingDesk.Plugin.DS.PitSuggestion"] = Escape(s.PitSuggestion ?? "");
            dict["RacingDesk.Plugin.DS.BBNorm"] = s.BBNorm;
            dict["RacingDesk.Plugin.DS.TCNorm"] = s.TCNorm;
            dict["RacingDesk.Plugin.DS.ABSNorm"] = s.ABSNorm;
            dict["RacingDesk.Plugin.DS.PositionDeltaDisplay"] = Escape(s.PositionDeltaDisplay ?? "");
            dict["RacingDesk.Plugin.DS.LapDeltaDisplay"] = Escape(s.LapDeltaDisplay ?? "");
            dict["RacingDesk.Plugin.DS.SafetyRatingDisplay"] = Escape(s.SafetyRatingDisplay);
            dict["RacingDesk.Plugin.DS.GapAheadFormatted"] = Escape(s.GapAheadFormatted);
            dict["RacingDesk.Plugin.DS.GapBehindFormatted"] = Escape(s.GapBehindFormatted);

            dict["DataCorePlugin.GameRawData.Telemetry.FrameRate"] = s.FrameRate;
            dict["DataCorePlugin.GameRawData.Telemetry.SteeringWheelAngle"] = s.SteeringWheelAngle;

            // Commentary
            if (engine != null)
            {
                dict["RacingDesk.Plugin.CommentaryVisible"] = engine.IsVisible ? 1 : 0;
                dict["RacingDesk.Plugin.CommentaryText"] = Escape(engine.CurrentText ?? "");
                dict["RacingDesk.Plugin.CommentaryTopicTitle"] = Escape(engine.CurrentTitle ?? "");
                dict["RacingDesk.Plugin.CommentaryTopicId"] = Escape(engine.CurrentTopicId ?? "");
                string cat = engine.CurrentCategory ?? "";
                string label = engine.CurrentSentimentLabel ?? "";
                string category = string.IsNullOrEmpty(label) ? cat : cat + " — " + label;
                dict["RacingDesk.Plugin.CommentaryCategory"] = Escape(category);
                dict["RacingDesk.Plugin.CommentarySentimentColor"] = Escape(engine.CurrentSentimentColor ?? "#FF000000");
                dict["RacingDesk.Plugin.CommentarySeverity"] = engine.IsVisible ? engine.CurrentSeverity : 0;
                dict["RacingDesk.Plugin.CommentaryTrackImage"] = Escape(engine.CurrentTrackImage ?? "");
                dict["RacingDesk.Plugin.CommentaryCarImage"] = Escape(engine.CurrentCarImage ?? "");
            }
            else
            {
                dict["RacingDesk.Plugin.CommentaryVisible"] = 0;
                dict["RacingDesk.Plugin.CommentaryText"] = "";
                dict["RacingDesk.Plugin.CommentaryTopicTitle"] = "";
                dict["RacingDesk.Plugin.CommentaryTopicId"] = "";
                dict["RacingDesk.Plugin.CommentaryCategory"] = "";
                dict["RacingDesk.Plugin.CommentarySentimentColor"] = "#FF000000";
                dict["RacingDesk.Plugin.CommentarySeverity"] = 0;
                dict["RacingDesk.Plugin.CommentaryTrackImage"] = "";
                dict["RacingDesk.Plugin.CommentaryCarImage"] = "";
            }

            // Strategy
            if (strategy != null)
            {
                dict["RacingDesk.Plugin.Strategy.Visible"] = strategy.IsVisible ? 1 : 0;
                dict["RacingDesk.Plugin.Strategy.Text"] = Escape(strategy.CurrentText ?? "");
                dict["RacingDesk.Plugin.Strategy.Label"] = Escape(strategy.CurrentLabel ?? "");
                dict["RacingDesk.Plugin.Strategy.Severity"] = strategy.CurrentSeverity;
                dict["RacingDesk.Plugin.Strategy.Color"] = Escape("#0084FF");
                dict["RacingDesk.Plugin.Strategy.TextColor"] = Escape("#FFFFFFFF");
                dict["RacingDesk.Plugin.Strategy.FuelLapsRemaining"] = strategy.Fuel.FuelLapsRemaining;
                dict["RacingDesk.Plugin.Strategy.FuelHealthState"] = strategy.Fuel.FuelHealthState;
                dict["RacingDesk.Plugin.Strategy.CanMakeItToEnd"] = strategy.Fuel.CanMakeItToEnd ? 1 : 0;
                dict["RacingDesk.Plugin.Strategy.PitWindowOpen"] = strategy.Fuel.PitWindowOpen;
                dict["RacingDesk.Plugin.Strategy.PitWindowClose"] = strategy.Fuel.PitWindowClose;
                dict["RacingDesk.Plugin.Strategy.TireHealthState"] = strategy.Tires.TireHealthState;
                dict["RacingDesk.Plugin.Strategy.TireLapsRemaining"] = strategy.Tires.EstimatedLapsRemaining;
                dict["RacingDesk.Plugin.Strategy.GripScore"] = strategy.Tires.GripScore;
                dict["RacingDesk.Plugin.Strategy.StintNumber"] = strategy.StintCount;
                dict["RacingDesk.Plugin.Strategy.StintLaps"] = strategy.CurrentStint != null ? strategy.CurrentStint.LapsCompleted : 0;
            }
            else
            {
                dict["RacingDesk.Plugin.Strategy.Visible"] = 0;
                dict["RacingDesk.Plugin.Strategy.Text"] = "";
                dict["RacingDesk.Plugin.Strategy.Label"] = "";
                dict["RacingDesk.Plugin.Strategy.Severity"] = 0;
                dict["RacingDesk.Plugin.Strategy.Color"] = "#0084FF";
                dict["RacingDesk.Plugin.Strategy.TextColor"] = "#FFFFFFFF";
                dict["RacingDesk.Plugin.Strategy.FuelLapsRemaining"] = 0.0;
                dict["RacingDesk.Plugin.Strategy.FuelHealthState"] = 0;
                dict["RacingDesk.Plugin.Strategy.CanMakeItToEnd"] = 0;
                dict["RacingDesk.Plugin.Strategy.PitWindowOpen"] = 0;
                dict["RacingDesk.Plugin.Strategy.PitWindowClose"] = 0;
                dict["RacingDesk.Plugin.Strategy.TireHealthState"] = 0;
                dict["RacingDesk.Plugin.Strategy.TireLapsRemaining"] = 0.0;
                dict["RacingDesk.Plugin.Strategy.GripScore"] = 0.0;
                dict["RacingDesk.Plugin.Strategy.StintNumber"] = 0;
                dict["RacingDesk.Plugin.Strategy.StintLaps"] = 0;
            }

            // Incident Coach
            if (incidentCoach != null)
            {
                dict["RacingDesk.Plugin.DS.IncidentCoach.Active"] = incidentCoach.Enabled ? 1 : 0;
                dict["RacingDesk.Plugin.DS.IncidentCoach.LastIncidentLap"] = incidentCoach.LastIncidentLap;
                dict["RacingDesk.Plugin.DS.IncidentCoach.ThreatDrivers"] = incidentCoach.ThreatDriversJson ?? "[]";
                dict["RacingDesk.Plugin.DS.IncidentCoach.ActiveAlert"] = incidentCoach.ActiveAlertJson ?? "{}";
                dict["RacingDesk.Plugin.DS.IncidentCoach.RageScore"] = incidentCoach.RageScore;
                dict["RacingDesk.Plugin.DS.IncidentCoach.CooldownActive"] = incidentCoach.IsCooldownActive ? 1 : 0;
                dict["RacingDesk.Plugin.DS.IncidentCoach.SessionBehavior"] = incidentCoach.SessionBehaviorJson ?? "{}";
            }
            else
            {
                dict["RacingDesk.Plugin.DS.IncidentCoach.Active"] = 0;
                dict["RacingDesk.Plugin.DS.IncidentCoach.LastIncidentLap"] = 0;
                dict["RacingDesk.Plugin.DS.IncidentCoach.ThreatDrivers"] = "[]";
                dict["RacingDesk.Plugin.DS.IncidentCoach.ActiveAlert"] = "{}";
                dict["RacingDesk.Plugin.DS.IncidentCoach.RageScore"] = 0;
                dict["RacingDesk.Plugin.DS.IncidentCoach.CooldownActive"] = 0;
                dict["RacingDesk.Plugin.DS.IncidentCoach.SessionBehavior"] = "{}";
            }

            // Demo mode
            dict["RacingDesk.Plugin.DemoMode"] = demo ? 1 : 0;
            dict["RacingDesk.Plugin.Demo.Gear"] = Escape(dt.Gear ?? "N");
            dict["RacingDesk.Plugin.Demo.Rpm"] = dt.Rpm;
            dict["RacingDesk.Plugin.Demo.MaxRpm"] = dt.MaxRpm;
            dict["RacingDesk.Plugin.Demo.SpeedMph"] = dt.SpeedMph;
            dict["RacingDesk.Plugin.Demo.Throttle"] = dt.Throttle * 100;
            dict["RacingDesk.Plugin.Demo.Brake"] = dt.Brake * 100;
            dict["RacingDesk.Plugin.Demo.Clutch"] = dt.Clutch * 100;
            dict["RacingDesk.Plugin.Demo.Fuel"] = dt.Fuel;
            dict["RacingDesk.Plugin.Demo.MaxFuel"] = dt.MaxFuel;
            dict["RacingDesk.Plugin.Demo.FuelPerLap"] = dt.FuelPerLap;
            dict["RacingDesk.Plugin.Demo.RemainingLaps"] = dt.RemainingLaps;
            dict["RacingDesk.Plugin.Demo.TyreTempFL"] = dt.TyreTempFL;
            dict["RacingDesk.Plugin.Demo.TyreTempFR"] = dt.TyreTempFR;
            dict["RacingDesk.Plugin.Demo.TyreTempRL"] = dt.TyreTempRL;
            dict["RacingDesk.Plugin.Demo.TyreTempRR"] = dt.TyreTempRR;
            dict["RacingDesk.Plugin.Demo.TyreWearFL"] = dt.TyreWearFL;
            dict["RacingDesk.Plugin.Demo.TyreWearFR"] = dt.TyreWearFR;
            dict["RacingDesk.Plugin.Demo.TyreWearRL"] = dt.TyreWearRL;
            dict["RacingDesk.Plugin.Demo.TyreWearRR"] = dt.TyreWearRR;
            dict["RacingDesk.Plugin.Demo.BrakeBias"] = dt.BrakeBias;
            dict["RacingDesk.Plugin.Demo.TC"] = dt.TC;
            dict["RacingDesk.Plugin.Demo.ABS"] = dt.ABS;
            dict["RacingDesk.Plugin.Demo.SessionTypeName"] = Escape(dt.SessionTypeName ?? "");
            dict["RacingDesk.Plugin.Demo.SessionMode"] = (int)dt.SessionMode;
            dict["RacingDesk.Plugin.Demo.SessionModeName"] = Escape(dt.SessionMode.ToString());
            dict["RacingDesk.Plugin.Demo.Position"] = dt.Position;
            dict["RacingDesk.Plugin.Demo.CurrentLap"] = dt.CurrentLap;
            dict["RacingDesk.Plugin.Demo.BestLapTime"] = dt.BestLapTime;
            dict["RacingDesk.Plugin.Demo.CurrentLapTime"] = dt.CurrentLapTime;
            dict["RacingDesk.Plugin.Demo.CarModel"] = Escape(dt.CarModel ?? "");
            dict["RacingDesk.Plugin.Demo.SessionTime"] = dt.SessionTime;
            dict["RacingDesk.Plugin.Demo.LastLapTime"] = dt.LastLapTime;
            dict["RacingDesk.Plugin.Demo.RemainingTime"] = dt.RemainingTime;
            dict["RacingDesk.Plugin.Demo.TotalLaps"] = dt.TotalLaps;
            dict["RacingDesk.Plugin.Demo.IRating"] = dt.IRating;
            dict["RacingDesk.Plugin.Demo.SafetyRating"] = dt.SafetyRating;
            dict["RacingDesk.Plugin.Demo.GapAhead"] = dt.GapAhead;
            dict["RacingDesk.Plugin.Demo.GapBehind"] = dt.GapBehind;
            dict["RacingDesk.Plugin.Demo.DriverAhead"] = Escape(dt.DriverAhead ?? "");
            dict["RacingDesk.Plugin.Demo.DriverBehind"] = Escape(dt.DriverBehind ?? "");
            dict["RacingDesk.Plugin.Demo.IRAhead"] = dt.IRAhead;
            dict["RacingDesk.Plugin.Demo.IRBehind"] = dt.IRBehind;

            // Demo Datastream
            dict["RacingDesk.Plugin.Demo.DS.LatG"] = dt.LatG;
            dict["RacingDesk.Plugin.Demo.DS.LongG"] = dt.LongG;
            dict["RacingDesk.Plugin.Demo.DS.YawRate"] = dt.YawRate;
            dict["RacingDesk.Plugin.Demo.DS.SteerTorque"] = dt.SteerTorque;
            dict["RacingDesk.Plugin.Demo.DS.TrackTemp"] = dt.TrackTemp;
            dict["RacingDesk.Plugin.Demo.DS.IncidentCount"] = dt.IncidentCount;
            dict["RacingDesk.Plugin.Demo.DS.AbsActive"] = dt.AbsActive ? 1 : 0;
            dict["RacingDesk.Plugin.Demo.DS.TcActive"] = dt.TcActive ? 1 : 0;
            dict["RacingDesk.Plugin.Demo.DS.LapDelta"] = dt.LapDelta;
            dict["RacingDesk.Plugin.Demo.DS.IsInPitLane"] = dt.IsInPitLane ? 1 : 0;
            dict["RacingDesk.Plugin.Demo.DS.SessionMode"] = (int)dt.SessionMode;
            dict["RacingDesk.Plugin.Demo.DS.SessionModeName"] = Escape(dt.SessionMode.ToString());
            dict["RacingDesk.Plugin.Demo.DS.IsLapRace"] = dt.IsLapRace ? 1 : 0;
            dict["RacingDesk.Plugin.Demo.DS.IsLapInvalid"] = dt.IsLapInvalid ? 1 : 0;
            dict["RacingDesk.Plugin.Demo.DS.SectorBests"] = "";
            dict["RacingDesk.Plugin.Demo.DS.SpeedKmh"] = dt.SpeedKmh;
            dict["RacingDesk.Plugin.Demo.DS.PitLimiterOn"] = dt.IsInPitLane ? 1 : 0;
            dict["RacingDesk.Plugin.Demo.DS.PitSpeedLimitKmh"] = 72.0;

            // Demo Computed DS.*
            dict["RacingDesk.Plugin.Demo.DS.ThrottleNorm"] = dt.ThrottleNorm;
            dict["RacingDesk.Plugin.Demo.DS.BrakeNorm"] = dt.BrakeNorm;
            dict["RacingDesk.Plugin.Demo.DS.ClutchNorm"] = dt.ClutchNorm;
            dict["RacingDesk.Plugin.Demo.DS.RpmRatio"] = dt.RpmRatio;
            dict["RacingDesk.Plugin.Demo.DS.FuelPct"] = dt.FuelPct;
            dict["RacingDesk.Plugin.Demo.DS.FuelLapsRemaining"] = dt.FuelLapsRemaining;
            dict["RacingDesk.Plugin.Demo.DS.SpeedMph"] = dt.SpeedMph;
            dict["RacingDesk.Plugin.Demo.DS.PitSpeedLimitMph"] = dt.PitSpeedLimitMph;
            dict["RacingDesk.Plugin.Demo.DS.IsPitSpeeding"] = dt.IsPitSpeeding ? 1 : 0;
            dict["RacingDesk.Plugin.Demo.DS.IsNonRaceSession"] = dt.IsNonRaceSession ? 1 : 0;

            // Grid state
            dict["RacingDesk.Plugin.Grid.SessionState"] = s.SessionState;
            // Only where the sim says: a key that is sent is believed, and a constant 0 would hide the HUD for good.
            if (s.InCar.HasValue) dict["DataCorePlugin.GameRawData.Telemetry.IsOnTrack"] = s.InCar.Value ? 1 : 0;
            dict["RacingDesk.Plugin.Grid.GriddedCars"] = s.GriddedCars;
            dict["RacingDesk.Plugin.Grid.TotalCars"] = s.TotalCars;
            dict["RacingDesk.Plugin.Grid.PaceMode"] = s.PaceMode;
            dict["RacingDesk.Plugin.Grid.LightsPhase"] = lightsPhase;
            dict["RacingDesk.Plugin.Grid.StartType"] = Escape(s.IsStandingStart ? "standing" : "rolling");
            dict["RacingDesk.Plugin.Grid.TrackCountry"] = Escape(s.TrackCountry ?? "");

            // Demo Grid state
            dict["RacingDesk.Plugin.Demo.Grid.SessionState"] = dt.SessionState;
            dict["RacingDesk.Plugin.Demo.Grid.GriddedCars"] = dt.GriddedCars;
            dict["RacingDesk.Plugin.Demo.Grid.TotalCars"] = dt.TotalCars;
            dict["RacingDesk.Plugin.Demo.Grid.PaceMode"] = dt.PaceMode;
            dict["RacingDesk.Plugin.Demo.Grid.LightsPhase"] = dt.LightsPhase;
            dict["RacingDesk.Plugin.Demo.Grid.StartType"] = Escape(dt.IsStandingStart ? "standing" : "rolling");
            dict["RacingDesk.Plugin.Demo.Grid.TrackCountry"] = Escape(dt.TrackCountry ?? "");

            // Driver name
            string playerName = s.PlayerName ?? "";
            if (!string.IsNullOrEmpty(playerName))
            {
                var nameParts = playerName.Trim().Split(new[] { ' ' }, 2);
                dict["RacingDesk.Plugin.DriverFirstName"] = Escape(nameParts[0]);
                dict["RacingDesk.Plugin.DriverLastName"] = Escape(nameParts.Length > 1 ? nameParts[1] : "");
            }

            // Track map
            if (trackMap != null)
            {
                dict["RacingDesk.Plugin.TrackMap.Ready"] = trackMap.IsReady ? 1 : 0;
                dict["RacingDesk.Plugin.TrackMap.TrackName"] = Escape(trackMap.TrackName ?? "");
                dict["RacingDesk.Plugin.TrackMap.TrackSlug"] = Escape(trackSlug ?? "");
                dict["RacingDesk.Plugin.TrackMap.TrackDisplayName"] = Escape(s.TrackDisplayName ?? "");
                dict["RacingDesk.Plugin.TrackMap.SvgPath"] = Escape(trackMap.SvgPath ?? "");
                dict["RacingDesk.Plugin.TrackMap.PlayerX"] = trackMap.PlayerX;
                dict["RacingDesk.Plugin.TrackMap.PlayerY"] = trackMap.PlayerY;
                dict["RacingDesk.Plugin.TrackMap.PlayerHeading"] = trackMap.PlayerHeadingDeg;
                dict["RacingDesk.Plugin.TrackMap.Opponents"] = Escape(trackMap.OpponentData ?? "");
            }
            else
            {
                dict["RacingDesk.Plugin.TrackMap.Ready"] = 0;
                dict["RacingDesk.Plugin.TrackMap.TrackName"] = "";
                dict["RacingDesk.Plugin.TrackMap.TrackSlug"] = Escape(trackSlug ?? "");
                dict["RacingDesk.Plugin.TrackMap.TrackDisplayName"] = Escape(s.TrackDisplayName ?? "");
                dict["RacingDesk.Plugin.TrackMap.SvgPath"] = "";
                dict["RacingDesk.Plugin.TrackMap.PlayerX"] = 0.0;
                dict["RacingDesk.Plugin.TrackMap.PlayerY"] = 0.0;
                dict["RacingDesk.Plugin.TrackMap.PlayerHeading"] = 0.0;
                dict["RacingDesk.Plugin.TrackMap.Opponents"] = "";
            }

            // Leaderboard
            dict["RacingDesk.Plugin.Leaderboard"] = leaderboardJson ?? "[]";

            // Extra (homebridge / legacy)
            dict["currentFlagState"] = Escape(GetFlagState(s, demo));
            double nearestDist = CalculateNearestCarDistance(s);
            dict["nearestCarDistance"] = nearestDist;

            // Ambient light
            if (screenColorSampler != null)
            {
                dict["RacingDesk.Plugin.DS.AmbientR"] = screenColorSampler.HasColor ? screenColorSampler.R : 0;
                dict["RacingDesk.Plugin.DS.AmbientG"] = screenColorSampler.HasColor ? screenColorSampler.G : 0;
                dict["RacingDesk.Plugin.DS.AmbientB"] = screenColorSampler.HasColor ? screenColorSampler.B : 0;
                dict["RacingDesk.Plugin.DS.AmbientHasData"] = screenColorSampler.HasColor ? 1 : 0;
            }
            else
            {
                dict["RacingDesk.Plugin.DS.AmbientR"] = 0;
                dict["RacingDesk.Plugin.DS.AmbientG"] = 0;
                dict["RacingDesk.Plugin.DS.AmbientB"] = 0;
                dict["RacingDesk.Plugin.DS.AmbientHasData"] = 0;
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
