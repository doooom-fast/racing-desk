using System;
using System.Collections.Generic;
using System.Reflection;
using System.Text.RegularExpressions;
using GameReaderCommon;
using SimHub.Plugins;

namespace RaceCorProDrive.Plugin.Engine
{
    /// <summary>
    /// SimHub-dependent capture logic for TelemetrySnapshot.
    /// Kept separate so the data class can be shared with the test runner.
    /// </summary>
    public partial class TelemetrySnapshot
    {
        // ── Game detection ───────────────────────────────────────────────────────
        private enum GameId { Unknown, IRacing, ACC, AC, ACEvo, ACRally, RaceRoom, EAWRC, Forza }

        private static GameId DetectGame(string gameName)
        {
            if (string.IsNullOrEmpty(gameName)) return GameId.Unknown;
            var g = gameName.ToLowerInvariant();
            if (g.Contains("iracing")) return GameId.IRacing;
            if (g.Contains("assettocorsacompetizione") || g == "acc") return GameId.ACC;
            if (g.Contains("assettocorsaevo")) return GameId.ACEvo;
            if (g.Contains("assettocorsarally")) return GameId.ACRally;
            if (g.Contains("assettocorsa") || g == "ac") return GameId.AC;
            if (g.Contains("raceroom") || g == "rrre" || g == "r3e") return GameId.RaceRoom;
            if (g.Contains("wrc") || g.Contains("eawrc")) return GameId.EAWRC;
            if (g.Contains("forza")) return GameId.Forza;
            return GameId.Unknown;
        }

        // ── ERS detection: track whether the car has ever shown ERS activity ────
        private static string _ersDetectCarModel = "";
        private static bool   _sessionHasErs     = false;

        // ── Car-specific adjustment detection ────────────────────────────────
        // Track which dc* variables have been non-zero to determine what the car supports.
        // Reset on car change (same pattern as ERS detection).
        private static string _adjDetectCarModel = "";
        private static bool _hasTC = false, _hasABS = false;
        private static bool _hasARBF = false, _hasARBR = false;
        private static bool _hasEng = false, _hasFuelMix = false;
        private static bool _hasWJL = false, _hasWJR = false;
        private static bool _hasWingF = false, _hasWingR = false;

        // ── iRacing SDK bridge (set by Plugin.Init, used as primary data source) ──
        internal static IRacingSdkBridge _sdkBridge;

        // ── iRating estimator (legacy shared memory reader, kept as fallback) ────
        private static IRatingEstimator _irEstimator;
        private static SectorTracker _sectorTracker = new SectorTracker();
        private static string _lastSectorTrackId = "";

        // ── Fix #2: Caching for iRating / SR / license string ──────────────────
        // iRating and SR don't change mid-session, so caching last non-zero is safe.
        // Prevents intermittent "—" flashes when the priority chain returns 0.
        private static int    _lastKnownIRating = 0;
        private static double _lastKnownSR = 0;
        private static string _lastKnownLicense = "";

        // ── Fix #15: Gap driver name caching ────────────────────────────────────
        // Opponents list takes 2-3s to populate. Cache last known names.
        private static string _lastAheadName = "";
        private static string _lastBehindName = "";

        // ── Lap validity tracking ────────────────────────────────────────────────
        private static int _prevLapForValidity = 0;
        private static int _lapStartIncidentCount = 0;

        public static TelemetrySnapshot Capture(PluginManager pm, ref GameData data)
        {
            var s = new TelemetrySnapshot();
            s.GameRunning = data.GameRunning;
            s.GameName    = data.GameName ?? "";

            if (!data.GameRunning || data.NewData == null)
                return s;

            var d = data.NewData;

            // ── Normalized fields (all games) ────────────────────────────────
            s.SpeedKmh         = d.SpeedKmh;
            s.Rpms             = d.Rpms;
            s.MaxRpm           = d.MaxRpm;
            s.Gear             = d.Gear ?? "N";
            s.Throttle         = d.Throttle;
            s.Brake            = d.Brake;
            s.Clutch           = d.Clutch;
            s.FuelLevel        = d.Fuel;
            s.FuelPercent      = d.FuelPercent;
            s.CurrentLap       = d.CurrentLap;
            s.CompletedLaps    = d.CompletedLaps;
            s.TrackPositionPct = d.TrackPositionPercent;
            s.Position         = d.Position;
            s.IsInPit          = d.IsInPit != 0;
            s.IsInPitLane      = d.IsInPitLane != 0;
            s.SessionTypeName  = d.SessionTypeName ?? "";
            s.CarModel         = d.CarModel ?? "";
            s.TrackName        = GetPluginProp<string>(pm, "DataCorePlugin.GameData.TrackName") ?? "";
            s.TyreWearFL       = d.TyreWearFrontLeft;
            s.TyreWearFR       = d.TyreWearFrontRight;
            s.TyreWearRL       = d.TyreWearRearLeft;
            s.TyreWearRR       = d.TyreWearRearRight;

            // Fallback for iRacing: GameData.TyreWear* is only updated after a
            // full lap, so the bars stay at 0 until then. Fall back to the raw
            // per-zone wear telemetry values (LFwearL/M/R etc.) which ARE live.
            // IMPORTANT: iRacing raw wear values use 1.0=new, 0.0=worn convention
            // but our internal convention is 0.0=new, 1.0=fully worn. We must
            // invert when using the raw telemetry fallback.
            if (s.TyreWearFL == 0)
            {
                float wL = GetRaw<float>(pm, "LFwearL");
                float wM = GetRaw<float>(pm, "LFwearM");
                float wR = GetRaw<float>(pm, "LFwearR");
                if (wL > 0 || wM > 0 || wR > 0) s.TyreWearFL = 1.0 - ((wL + wM + wR) / 3f);
            }
            if (s.TyreWearFR == 0)
            {
                float wL = GetRaw<float>(pm, "RFwearL");
                float wM = GetRaw<float>(pm, "RFwearM");
                float wR = GetRaw<float>(pm, "RFwearR");
                if (wL > 0 || wM > 0 || wR > 0) s.TyreWearFR = 1.0 - ((wL + wM + wR) / 3f);
            }
            if (s.TyreWearRL == 0)
            {
                float wL = GetRaw<float>(pm, "LRwearL");
                float wM = GetRaw<float>(pm, "LRwearM");
                float wR = GetRaw<float>(pm, "LRwearR");
                if (wL > 0 || wM > 0 || wR > 0) s.TyreWearRL = 1.0 - ((wL + wM + wR) / 3f);
            }
            if (s.TyreWearRR == 0)
            {
                float wL = GetRaw<float>(pm, "RRwearL");
                float wM = GetRaw<float>(pm, "RRwearM");
                float wR = GetRaw<float>(pm, "RRwearR");
                if (wL > 0 || wM > 0 || wR > 0) s.TyreWearRR = 1.0 - ((wL + wM + wR) / 3f);
            }

            // ── Physics: iRacing raw → normalized fallback ───────────────────
            // Fix #14: iRacing reports acceleration in m/s²; dashboard expects G.
            // SimHub normalized values are already in G, so only convert iRacing raw.
            const float MsToG = 1f / 9.80665f;
            float rawLat, rawLong, rawVert;

            rawLat  = GetRaw<float>(pm, "LatAccel");
            rawLong = GetRaw<float>(pm, "LongAccel");
            rawVert = GetRaw<float>(pm, "VertAccel");

            // If raw values are present (non-zero), they're from iRacing in m/s² → convert to G
            s.LatAccel  = rawLat  != 0 ? rawLat  * MsToG : GetNorm<float>(d, "AccelerationSway");
            s.LongAccel = rawLong != 0 ? rawLong * MsToG : GetNorm<float>(d, "AccelerationSurge");
            s.VertAccel = rawVert != 0 ? rawVert * MsToG : GetNorm<float>(d, "AccelerationHeave");

            // YawRate: try game-specific, then fallback to normalized
            float yawRateRaw = GetRaw<float>(pm, "YawRate");
            s.YawRate = yawRateRaw != 0 ? yawRateRaw : GetNorm<float>(d, "YawVelocity");

            // ── Driver aids ──────────────────────────────────────────────────
            s.AbsActive = GetRaw<bool>(pm, "BrakeABSactive") || GetNorm<bool>(d, "ABSActive");
            s.TcActive  = GetNorm<bool>(d, "TCActive");

            // ── Tyre temps ───────────────────────────────────────────────────
            s.TyreTempFL = Coalesce(GetNorm<float>(d, "TyreTempFrontLeft"),  GetNorm<float>(d, "TyreTemperatureFrontLeft"));
            s.TyreTempFR = Coalesce(GetNorm<float>(d, "TyreTempFrontRight"), GetNorm<float>(d, "TyreTemperatureFrontRight"));
            s.TyreTempRL = Coalesce(GetNorm<float>(d, "TyreTempRearLeft"),   GetNorm<float>(d, "TyreTemperatureRearLeft"));
            s.TyreTempRR = Coalesce(GetNorm<float>(d, "TyreTempRearRight"),  GetNorm<float>(d, "TyreTemperatureRearRight"));

            // ── Environment ──────────────────────────────────────────────────
            s.TrackTemp     = Coalesce(GetRaw<float>(pm, "TrackTemp"), GetNorm<float>(d, "RoadTemperature"));
            s.AirTemp       = Coalesce(GetRaw<float>(pm, "AirTemp"),   GetNorm<float>(d, "AirTemperature"));
            bool iRacingWet = GetRaw<bool>(pm, "WeatherDeclaredWet");
            float rainInt   = GetNorm<float>(d, "RainIntensity");
            s.WeatherWet    = iRacingWet || rainInt > 0.1f;

            // ── Display units (iRacing user preference) ──────────────────
            // iRacing telemetry var: DisplayUnits  0=imperial, 1=metric
            int rawUnits = GetRaw<int>(pm, "DisplayUnits");
            s.DisplayUnits = rawUnits;  // 0 if not available (default metric via property init)

            // ── Lap timing: iRacing raw → normalized fallback ────────────────
            s.LapCurrentTime    = Coalesce(GetRaw<float>(pm, "LapCurrentLapTime"),  GetNorm<float>(d, "CurrentLapTime"));
            s.LapLastTime       = Coalesce(GetRaw<float>(pm, "LapLastLapTime"),     GetNorm<float>(d, "LastLapTime"));
            s.LapBestTime       = Coalesce(GetRaw<float>(pm, "LapBestLapTime"),     GetNorm<float>(d, "BestLapTime"));
            s.LapDeltaToBest    = Coalesce(GetRaw<float>(pm, "LapDeltaToBestLap"),  GetNorm<float>(d, "DeltaToSessionBestLap"));
            s.SessionTimeRemain = Coalesce(GetRaw<double>(pm, "SessionTimeRemain"), GetNorm<double>(d, "SessionTimeLeft"));
            // Fix #13: Session laps remaining — use SessionLapsRemainEx (avoids off-by-one)
            s.SessionLapsRemaining = GetRaw<int>(pm, "SessionLapsRemainEx");
            if (s.SessionLapsRemaining == 0)
                s.SessionLapsRemaining = (int)GetPluginProp<double>(pm, "DataCorePlugin.GameData.RemainingLaps");
            s.SessionLapsTotal = GetRaw<int>(pm, "SessionLapsTotal");
            if (s.SessionLapsTotal == 0)
                s.SessionLapsTotal = (int)GetPluginProp<double>(pm, "DataCorePlugin.GameData.TotalLaps");

            // ── Sector splits (cloud-configured count, equal fractions) ──
            // Reset sector tracker when the track changes and fetch cloud sector count
            string trackIdForSectors = GetPluginProp<string>(pm, "DataCorePlugin.GameData.TrackName") ?? "";
            if (!string.IsNullOrEmpty(trackIdForSectors) && trackIdForSectors != _lastSectorTrackId)
            {
                _lastSectorTrackId = trackIdForSectors;
                _sectorTracker.Reset();
                // Fetch cloud-configured sector count for this track
                var (cloudSectors, customBoundaries) = FetchCloudSectorConfig(trackIdForSectors);
                if (cloudSectors >= 2)
                {
                    if (customBoundaries != null && customBoundaries.Length == cloudSectors - 1)
                    {
                        // Use custom boundary percentages from database
                        _sectorTracker.SetBoundaries(customBoundaries, cloudSectors);
                    }
                    else
                    {
                        // Fall back to equal-fraction boundaries
                        var boundaries = new double[cloudSectors - 1];
                        for (int bi = 0; bi < cloudSectors - 1; bi++)
                            boundaries[bi] = (double)(bi + 1) / cloudSectors;
                        _sectorTracker.SetBoundaries(boundaries, cloudSectors);
                    }
                }
            }
            // Fallback: if no cloud config resolved, use equal thirds
            if (!_sectorTracker.HasNativeBoundaries)
            {
                _sectorTracker.SetBoundaries(1.0 / 3.0, 2.0 / 3.0);
            }
            _sectorTracker.Update(s.TrackPositionPct, s.LapCurrentTime, s.CompletedLaps);
            s.CurrentSector  = _sectorTracker.CurrentSector;
            s.SectorCount    = _sectorTracker.SectorCount;
            // Legacy 3-sector properties (backward compat)
            s.SectorSplitS1  = _sectorTracker.SplitS1;
            s.SectorSplitS2  = _sectorTracker.SplitS2;
            s.SectorSplitS3  = _sectorTracker.SplitS3;
            s.SectorDeltaS1  = _sectorTracker.DeltaS1;
            s.SectorDeltaS2  = _sectorTracker.DeltaS2;
            s.SectorDeltaS3  = _sectorTracker.DeltaS3;
            s.SectorStateS1  = _sectorTracker.StateS1;
            s.SectorS2StartPct = _sectorTracker.Sector2StartPct;
            s.SectorS3StartPct = _sectorTracker.Sector3StartPct;
            s.SectorStateS2  = _sectorTracker.StateS2;
            s.SectorStateS3  = _sectorTracker.StateS3;
            // N-sector arrays
            var sc = _sectorTracker.SectorCount;
            s.SectorSplits     = new double[sc];
            s.SectorDeltas     = new double[sc];
            s.SectorStates     = new int[sc];
            s.SectorBests      = new double[sc];
            s.SectorBoundaries = _sectorTracker.Boundaries;
            for (int si = 0; si < sc; si++)
            {
                s.SectorSplits[si] = _sectorTracker.GetSplit(si);
                s.SectorDeltas[si] = _sectorTracker.GetDelta(si);
                s.SectorStates[si] = _sectorTracker.GetState(si);
                s.SectorBests[si]  = _sectorTracker.GetBest(si);
            }

            // ── Player name (needed before opponents loop for IsPlayer matching) ──
            try
            {
                var nameProp = d.GetType().GetProperty("PlayerName",
                    BindingFlags.Public | BindingFlags.Instance | BindingFlags.FlattenHierarchy);
                s.PlayerName = nameProp?.GetValue(d) as string ?? "";
            }
            catch (Exception ex)
            {
                SimHub.Logging.Current.Warn($"[RaceCorProDrive] Player name extraction failed: {ex.Message}");
            }

            // ── Nearest opponents (by race position) ─────────────────────────
            // Also extract: player's own iRating/SR, and gap data for ahead/behind
            // as fallback when IRacingExtraProperties plugin is unavailable.
            double _fallbackGapAhead  = 0;
            double _fallbackGapBehind = 0;
            int    _fallbackIRating   = 0;
            double _fallbackSR        = 0;
            try
            {
                var oppsProp = d.GetType().GetProperty("Opponents",
                    BindingFlags.Public | BindingFlags.Instance | BindingFlags.FlattenHierarchy);
                var opps = oppsProp?.GetValue(d) as System.Collections.IEnumerable;
                if (opps != null)
                {
                    foreach (var opp in opps)
                    {
                        var t = opp.GetType();
                        int   pos    = Convert.ToInt32(t.GetProperty("Position")?.GetValue(opp) ?? 0);
                        string name  = t.GetProperty("Name")?.GetValue(opp) as string ?? "";
                        int   irating = 0;
                        var irProp = t.GetProperty("IRating") ?? t.GetProperty("Irating");
                        if (irProp != null) { var v = irProp.GetValue(opp); if (v != null) irating = Convert.ToInt32(v); }

                        // Try to read gap-to-player from the opponent object
                        double gapToPlayer = 0;
                        try
                        {
                            // SimHub exposes several gap properties — try the most common ones
                            var gapProp = t.GetProperty("RelativeGapToPlayer")
                                       ?? t.GetProperty("GapToPlayer")
                                       ?? t.GetProperty("Gap");
                            if (gapProp != null)
                            {
                                var gv = gapProp.GetValue(opp);
                                if (gv != null)
                                {
                                    if (gv is TimeSpan gts) gapToPlayer = Math.Abs(gts.TotalSeconds);
                                    else if (gv is IConvertible) gapToPlayer = Math.Abs(Convert.ToDouble(gv));
                                }
                            }
                        }
                        catch (Exception ex)
                        {
                            SimHub.Logging.Current.Warn($"[RaceCorProDrive] Gap data extraction failed: {ex.Message}");
                        }

                        if (pos == s.Position - 1)
                        {
                            s.NearestAheadName = name;
                            s.NearestAheadRating = irating;
                            _fallbackGapAhead = gapToPlayer;
                        }
                        if (pos == s.Position + 1)
                        {
                            s.NearestBehindName = name;
                            s.NearestBehindRating = irating;
                            _fallbackGapBehind = gapToPlayer;
                        }

                        // Detect if this opponent is the player — extract their iRating/SR
                        bool isPlayer = false;
                        try
                        {
                            var isPlayerProp = t.GetProperty("IsPlayer");
                            if (isPlayerProp != null)
                                isPlayer = Convert.ToBoolean(isPlayerProp.GetValue(opp) ?? false);
                            else if (!string.IsNullOrEmpty(s.PlayerName) && !string.IsNullOrEmpty(name))
                                isPlayer = name.Equals(s.PlayerName, StringComparison.OrdinalIgnoreCase);
                        }
                        catch (Exception ex)
                        {
                            SimHub.Logging.Current.Warn($"[RaceCorProDrive] IsPlayer detection failed: {ex.Message}");
                        }

                        if (isPlayer && irating > 0)
                        {
                            _fallbackIRating = irating;
                            // Try to read LicenseLevel / SafetyRating from opponent
                            try
                            {
                                var srProp = t.GetProperty("LicenseSafetyRating")
                                          ?? t.GetProperty("SafetyRating");
                                if (srProp != null)
                                {
                                    var sv = srProp.GetValue(opp);
                                    if (sv != null && sv is IConvertible)
                                        _fallbackSR = Convert.ToDouble(sv);
                                }
                            }
                            catch (Exception ex)
                            {
                                SimHub.Logging.Current.Warn($"[RaceCorProDrive] SafetyRating extraction failed: {ex.Message}");
                            }
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                SimHub.Logging.Current.Warn($"[RaceCorProDrive] Opponent extraction failed: {ex.Message}");
            }

            // ── World velocity (for track map dead reckoning) ─────────────────
            // iRacing: reads raw directly
            // Other games: try normalized motion properties if available, else 0
            GameId detectedGame = DetectGame(s.GameName);
            if (detectedGame == GameId.IRacing)
            {
                s.VelocityX = GetRaw<float>(pm, "VelocityX");
                s.VelocityZ = GetRaw<float>(pm, "VelocityZ");
                s.Yaw       = GetRaw<float>(pm, "Yaw");
            }
            else
            {
                s.VelocityX = GetNorm<float>(d, "VelocityX");
                s.VelocityZ = GetNorm<float>(d, "VelocityZ");
                s.Yaw       = GetNorm<float>(d, "Yaw");
            }

            // ── Game-aware driver controls and telemetry ─────────────────────
            // Steering angle: game-specific raw → iRacing radians, ACC degrees
            if (detectedGame == GameId.ACC || detectedGame == GameId.AC || detectedGame == GameId.ACEvo || detectedGame == GameId.ACRally)
            {
                // ACC/AC: convert degrees to radians
                float steerDeg = GetRaw<float>(pm, "Physics.SteerAngle", "DataCorePlugin.GameRawData.");
                s.SteeringWheelAngle = steerDeg * (float)Math.PI / 180f;
            }
            else
            {
                // iRacing and others: default to iRacing raw
                s.SteeringWheelAngle = GetRaw<float>(pm, "SteeringWheelAngle");
            }

            // Brake bias: game-specific (percentage 0-100)
            s.BrakeBias = GetGameBrakeBias(pm, detectedGame);

            // Traction control & ABS settings
            s.TractionControlSetting = GetGameTC(pm, detectedGame);
            s.AbsSetting = GetGameABS(pm, detectedGame);

            // Fix #12: Steering torque — cross-game
            if (detectedGame == GameId.ACC || detectedGame == GameId.AC || detectedGame == GameId.ACEvo || detectedGame == GameId.ACRally)
                s.SteeringWheelTorque = GetRaw<float>(pm, "Physics.WheelsTorque", "DataCorePlugin.GameRawData.");
            else
                s.SteeringWheelTorque = GetRaw<float>(pm, "SteeringWheelTorque");

            // Fix #6: Frame rate — cross-game via SimHub's universal property
            s.FrameRate = GetRaw<float>(pm, "FrameRate");
            if (s.FrameRate == 0)
                s.FrameRate = GetPluginProp<double>(pm, "DataCorePlugin.GameData.FramesPerSecond");

            // Session flags: game-aware
            s.SessionFlags = GetGameSessionFlags(pm, detectedGame);

            // Incident count
            s.IncidentCount = GetGameIncidentCount(pm, detectedGame);

            // ── Lap validity (single source of truth — overlay should not recompute) ──
            int currentLap = s.CompletedLaps;
            if (currentLap > 0 && currentLap != _prevLapForValidity)
            {
                _lapStartIncidentCount = s.IncidentCount;
                _prevLapForValidity = currentLap;
            }
            s.LapStartIncidents = _lapStartIncidentCount;
            s.IsLapInvalid = s.IncidentCount > _lapStartIncidentCount;

            // Fix #12: DRS status — cross-game
            if (detectedGame == GameId.ACC || detectedGame == GameId.AC || detectedGame == GameId.ACEvo || detectedGame == GameId.ACRally)
            {
                bool drsAvail = GetRaw<bool>(pm, "Graphics.DrsAvailable", "DataCorePlugin.GameRawData.");
                bool drsOn    = GetRaw<bool>(pm, "Graphics.DrsEnabled", "DataCorePlugin.GameRawData.");
                s.DrsStatus = drsOn ? 2 : drsAvail ? 1 : 0; // 0=none, 1=available, 2=active
            }
            else
                s.DrsStatus = GetRaw<int>(pm, "DrsStatus");

            // ERS / Hybrid energy (game-aware)
            s.ErsBattery = GetGameErsBattery(pm, detectedGame);
            s.MgukPower = GetRaw<float>(pm, "PowerMGUK"); // MGUK is iRacing-specific

            // Pit limiter (game-aware)
            s.PitLimiterOn = GetGamePitLimiter(pm, detectedGame);
            // Fix #12: Pit speed limit — cross-game
            double pitLimitMs = GetRaw<float>(pm, "PitSpeedLimit"); // iRacing: m/s
            if (pitLimitMs > 0)
            {
                s.PitSpeedLimitKmh = pitLimitMs * 3.6;
            }
            else if (detectedGame == GameId.ACC || detectedGame == GameId.AC || detectedGame == GameId.ACEvo || detectedGame == GameId.ACRally)
            {
                // ACC StaticInfo.PitSpeedLimit is already in km/h
                s.PitSpeedLimitKmh = GetRaw<float>(pm, "StaticInfo.PitSpeedLimit", "DataCorePlugin.GameRawData.");
            }
            else if (detectedGame == GameId.RaceRoom)
            {
                // R3E: SessionPitSpeedLimit in m/s
                float r3ePitLimit = GetRaw<float>(pm, "SessionPitSpeedLimit", "DataCorePlugin.GameRawData.");
                s.PitSpeedLimitKmh = r3ePitLimit > 0 ? r3ePitLimit * 3.6 : 0;
            }

            // Track whether this car actually has an ERS system.
            // Non-hybrid cars report 0.0 permanently; reset detection on car change.
            if (s.CarModel != _ersDetectCarModel)
            {
                _ersDetectCarModel = s.CarModel;
                _sessionHasErs = false;
            }
            if (s.ErsBattery > 0.02 || s.MgukPower > 0.0)
                _sessionHasErs = true;
            s.HasErs = _sessionHasErs;

            // Player car index and multi-car arrays
            if (detectedGame == GameId.IRacing)
            {
                s.PlayerCarIdx = GetRaw<int>(pm, "PlayerCarIdx");
                s.CarIdxLapDistPct = GetRawArray<float>(pm, "CarIdxLapDistPct");
                s.CarIdxOnPitRoad = GetRawArray<bool>(pm, "CarIdxOnPitRoad");
                s.CarIdxLapCompleted = GetRawArray<int>(pm, "CarIdxLapCompleted");
            }
            else
            {
                s.PlayerCarIdx = 0;
                s.CarIdxLapDistPct = new float[0];
                s.CarIdxOnPitRoad = new bool[0];
                s.CarIdxLapCompleted = new int[0];
            }

            // ── iRating / Safety Rating ─────────────────────────────────────
            // Priority chain:
            // 1. IRacingSdkBridge (IRSDKSharper — direct SDK with proper YAML parsing)
            // 2. IRacingExtraProperties plugin properties
            // 3. SimHub normalized properties
            // 4. iRacing raw telemetry via SimHub
            // 5. Opponents collection fallback

            // Try SDK bridge first (most reliable — proper SDK with parsed YAML)
            if (_sdkBridge != null && _sdkBridge.IsConnected)
            {
                s.IRating = _sdkBridge.PlayerIRating;
                s.SafetyRating = _sdkBridge.PlayerSafetyRating;
                s.LicenseString = _sdkBridge.PlayerLicenseString ?? "";
                s.IsStandingStart = _sdkBridge.IsStandingStart;
                s.IncidentLimitPenalty = _sdkBridge.IncidentLimitPenalty;
                s.IncidentLimitDQ = _sdkBridge.IncidentLimitDQ;
                s.IRatingFieldSize = _sdkBridge.FieldSize;

                // Sector boundaries from SDK
                if (_sdkBridge.HasSectorBoundaries)
                {
                    s.SectorS2StartPct = _sdkBridge.SectorS2StartPct;
                    s.SectorS3StartPct = _sdkBridge.SectorS3StartPct;
                }

                // Track country from SDK
                if (!string.IsNullOrEmpty(_sdkBridge.TrackCountry))
                    s.TrackCountry = _sdkBridge.TrackCountry;
            }

            // Fallback: legacy IRatingEstimator (hand-rolled shared memory reader)
            if (s.IRating == 0)
            {
                if (_irEstimator == null) _irEstimator = new IRatingEstimator();
                _irEstimator.TryReadSessionInfo();
                s.IRating = _irEstimator.PlayerIRating;
                if (s.IsStandingStart == false)
                    s.IsStandingStart = _irEstimator.IsStandingStart;
            }
            if (s.SafetyRating == 0 && _irEstimator != null)
                s.SafetyRating = _irEstimator.PlayerSafetyRating;

            // Fallback: IRacingExtraProperties plugin
            if (s.IRating == 0)
                s.IRating = GetPluginProp<int>(pm, "IRacingExtraProperties.iRacing_DriverInfo_IRating");
            if (s.IRating == 0)
                s.IRating = GetPluginProp<int>(pm, "DataCorePlugin.GameData.IRating");
            if (s.IRating == 0)
                s.IRating = GetRaw<int>(pm, "PlayerCarDriverIRating");
            if (s.IRating == 0)
                s.IRating = _fallbackIRating;

            if (s.SafetyRating == 0)
                s.SafetyRating = GetPluginProp<double>(pm, "IRacingExtraProperties.iRacing_DriverInfo_SafetyRating");
            if (s.SafetyRating == 0)
                s.SafetyRating = GetPluginProp<double>(pm, "DataCorePlugin.GameData.SafetyRating");
            if (s.SafetyRating == 0)
                s.SafetyRating = _fallbackSR;

            // Fix #2: Cache last known iRating / SR / license to prevent intermittent "—"
            // iRating and SR don't change mid-session, so caching the last non-zero value is safe.
            if (s.IRating > 0)
                _lastKnownIRating = s.IRating;
            else if (_lastKnownIRating > 0)
                s.IRating = _lastKnownIRating;

            if (s.SafetyRating > 0)
                _lastKnownSR = s.SafetyRating;
            else if (_lastKnownSR > 0)
                s.SafetyRating = _lastKnownSR;

            if (!string.IsNullOrEmpty(s.LicenseString))
                _lastKnownLicense = s.LicenseString;
            else if (!string.IsNullOrEmpty(_lastKnownLicense))
                s.LicenseString = _lastKnownLicense;

            // Fix #3: Estimated iRating change — use int.MinValue as sentinel for "no data"
            // so that JS can distinguish "delta is 0" (valid) from "no data yet" (show —)
            s.EstimatedIRatingDelta = int.MinValue; // sentinel: no data
            if (s.Position > 0 && s.IRating > 0)
            {
                if (_sdkBridge != null && _sdkBridge.IsConnected)
                {
                    int delta = _sdkBridge.EstimateIRatingDelta(s.Position);
                    // EstimateIRatingDelta returns 0 for both "no data" and "actual zero"
                    // — if we have field data (FieldSize >= 2), treat 0 as a valid result
                    if (_sdkBridge.FieldSize >= 2)
                        s.EstimatedIRatingDelta = delta;
                    s.IRatingFieldSize = _sdkBridge.FieldSize;
                }
                else if (_irEstimator != null)
                {
                    _irEstimator.Update(s.Position, s.TotalCars > 0 ? s.TotalCars : _irEstimator.FieldSize);
                    if (_irEstimator.FieldSize >= 2)
                        s.EstimatedIRatingDelta = _irEstimator.EstimatedDelta;
                    s.IRatingFieldSize = _irEstimator.FieldSize;
                }
            }

            // ── Gap times ───────────────────────────────────────────────────
            // Primary: IRacingExtraProperties plugin
            // Fallback: gap-to-player from the Opponents collection
            // Fix #7: When gap is 0 and CarIdxLapDistPct available, compute from track position
            s.GapAhead = GetPluginProp<double>(pm, "IRacingExtraProperties.iRacing_Opponent_Ahead_Gap");
            if (s.GapAhead == 0 && _fallbackGapAhead > 0)
                s.GapAhead = _fallbackGapAhead;

            s.GapBehind = GetPluginProp<double>(pm, "IRacingExtraProperties.iRacing_Opponent_Behind_Gap");
            if (s.GapBehind == 0 && _fallbackGapBehind > 0)
                s.GapBehind = _fallbackGapBehind;

            // Fix #7: When gap is still 0 (caution, pace laps), estimate from track position delta.
            // Uses: (playerDistPct - otherDistPct) × estimatedLapTime
            if (s.GapAhead <= 0 && s.CarIdxLapDistPct != null && s.CarIdxLapDistPct.Length > 0 && s.Position > 1)
            {
                double estLap = s.LapBestTime > 0 ? s.LapBestTime : (s.LapLastTime > 0 ? s.LapLastTime : 0);
                if (estLap > 0)
                {
                    // Find the car ahead by looking at Opponents already identified
                    // Use NearestAheadRating as a proxy — if we have a name, we had their position
                    // We scan CarIdxLapDistPct for the closest car ahead on track
                    double myPct = s.TrackPositionPct;
                    double bestDelta = double.MaxValue;
                    for (int i = 0; i < s.CarIdxLapDistPct.Length; i++)
                    {
                        if (i == s.PlayerCarIdx || s.CarIdxLapDistPct[i] <= 0) continue;
                        double otherPct = s.CarIdxLapDistPct[i];
                        double delta = otherPct - myPct;
                        if (delta < 0) delta += 1.0; // wrap around s/f line
                        if (delta > 0 && delta < bestDelta)
                            bestDelta = delta;
                    }
                    if (bestDelta < 1.0)
                        s.GapAhead = bestDelta * estLap;
                }
            }

            // Fix #15: Cache gap driver names — Opponents list takes 2-3s to populate
            if (!string.IsNullOrEmpty(s.NearestAheadName))
                _lastAheadName = s.NearestAheadName;
            else if (!string.IsNullOrEmpty(_lastAheadName))
                s.NearestAheadName = _lastAheadName;

            if (!string.IsNullOrEmpty(s.NearestBehindName))
                _lastBehindName = s.NearestBehindName;
            else if (!string.IsNullOrEmpty(_lastBehindName))
                s.NearestBehindName = _lastBehindName;

            // ── Fuel computation (from SimHub computed properties) ───────────
            s.FuelPerLap    = GetPluginProp<double>(pm, "DataCorePlugin.Computed.Fuel_LitersPerLap");
            s.RemainingLaps = GetPluginProp<double>(pm, "DataCorePlugin.GameData.RemainingLaps");

            // ── Grid / Formation state ────────────────────────────────────
            s.SessionState = GetRaw<int>(pm, "SessionState");
            s.PaceMode     = GetRaw<int>(pm, "PaceMode");
            // Track country — only use SimHub fallback if SDK bridge didn't already provide it
            if (string.IsNullOrEmpty(s.TrackCountry))
            {
                try
                {
                    string country = GetPluginProp<string>(pm, "DataCorePlugin.GameData.TrackCountry") ?? "";
                    if (string.IsNullOrEmpty(country))
                        country = GetRaw<string>(pm, "WeekendInfo.TrackCountry") ?? "";
                    if (!string.IsNullOrEmpty(country))
                        s.TrackCountry = NormalizeCountryCode(country);
                }
                catch (Exception ex)
                {
                    SimHub.Logging.Current.Warn($"[RaceCorProDrive] Track country lookup failed: {ex.Message}");
                }
            }

            // Count gridded cars: cars NOT on pit road from CarIdxOnPitRoad array
            if (s.CarIdxOnPitRoad != null && s.CarIdxOnPitRoad.Length > 0)
            {
                int total = 0, gridded = 0;
                // CarIdxLapDistPct > 0 means the car slot is in use
                for (int i = 0; i < s.CarIdxOnPitRoad.Length; i++)
                {
                    bool inUse = s.CarIdxLapDistPct != null
                              && i < s.CarIdxLapDistPct.Length
                              && s.CarIdxLapDistPct[i] > 0;
                    if (inUse)
                    {
                        total++;
                        if (!s.CarIdxOnPitRoad[i]) gridded++;
                    }
                }
                s.TotalCars   = total;
                s.GriddedCars = gridded;
            }

            // ── In-car adjustments (driver controls) ────────────────────────
            // iRacing raw telemetry: dc* = driver control values
            // Note: BrakeBias, TractionControlSetting, and AbsSetting are already set above
            // with game-aware logic, so we only set the ARB values here (iRacing-only)
            s.ArbFront               = GetRaw<float>(pm, "dcAntiRollFront");
            s.ArbRear                = GetRaw<float>(pm, "dcAntiRollRear");

            // Additional car adjustments (iRacing dc* variables)
            s.EnginePower            = GetRaw<float>(pm, "dcEnginePower");
            s.FuelMixture            = GetRaw<float>(pm, "dcFuelMixture");
            s.WeightJackerLeft       = GetRaw<float>(pm, "dcWeightJackerLeft");
            s.WeightJackerRight      = GetRaw<float>(pm, "dcWeightJackerRight");
            s.WingFront              = GetRaw<float>(pm, "dcWingFront");
            s.WingRear               = GetRaw<float>(pm, "dcWingRear");

            // ── Car-specific adjustment detection ─────────────────────────
            // Reset on car change; accumulate "seen non-zero" flags.
            // BB is always available so we don't track it.
            if (s.CarModel != _adjDetectCarModel)
            {
                _adjDetectCarModel = s.CarModel;
                _hasTC = false; _hasABS = false;
                _hasARBF = false; _hasARBR = false;
                _hasEng = false; _hasFuelMix = false;
                _hasWJL = false; _hasWJR = false;
                _hasWingF = false; _hasWingR = false;
            }
            if (s.TractionControlSetting != 0) _hasTC = true;
            if (s.AbsSetting != 0)             _hasABS = true;
            if (s.ArbFront != 0)               _hasARBF = true;
            if (s.ArbRear != 0)                _hasARBR = true;
            if (s.EnginePower != 0)            _hasEng = true;
            if (s.FuelMixture != 0)            _hasFuelMix = true;
            if (s.WeightJackerLeft != 0)       _hasWJL = true;
            if (s.WeightJackerRight != 0)      _hasWJR = true;
            if (s.WingFront != 0)              _hasWingF = true;
            if (s.WingRear != 0)               _hasWingR = true;

            // Fix #16: ACC cars always have TC and ABS — the iRacing dc* detection
            // never triggers for ACC because ACC uses different property paths (Graphics.TC/ABS).
            if (detectedGame == GameId.ACC || detectedGame == GameId.ACEvo || detectedGame == GameId.AC || detectedGame == GameId.ACRally)
            {
                _hasTC = true;
                _hasABS = true;
            }

            s.HasTC = _hasTC;       s.HasABS = _hasABS;
            s.HasARBFront = _hasARBF; s.HasARBRear = _hasARBR;
            s.HasEnginePower = _hasEng; s.HasFuelMixture = _hasFuelMix;
            s.HasWeightJackerL = _hasWJL; s.HasWeightJackerR = _hasWJR;
            s.HasWingFront = _hasWingF; s.HasWingRear = _hasWingR;

            // ── Pit stop selections ─────────────────────────────────────────
            if (detectedGame == GameId.IRacing)
            {
                s.PitSvFlags             = GetRaw<int>(pm, "PitSvFlags");
                s.PitSvFuel              = GetRaw<float>(pm, "PitSvFuel");
                s.PitSvLFP               = GetRaw<float>(pm, "PitSvLFP");
                s.PitSvRFP               = GetRaw<float>(pm, "PitSvRFP");
                s.PitSvLRP               = GetRaw<float>(pm, "PitSvLRP");
                s.PitSvRRP               = GetRaw<float>(pm, "PitSvRRP");
                s.PitSvTireCompound      = GetRaw<int>(pm, "PitSvTireCompound");
                s.PitSvFastRepair        = GetRaw<int>(pm, "dpFastRepair");
                s.PitSvWindshieldTearoff = GetRaw<int>(pm, "dpWindshieldTearoff");
            }
            // Fix #5: ACC pit menu selections from Graphics.Mfd* properties
            else if (detectedGame == GameId.ACC || detectedGame == GameId.ACEvo)
            {
                float accFuel = GetRaw<float>(pm, "Graphics.MfdFuelToAdd", "DataCorePlugin.GameRawData.");
                s.PitSvFuel = accFuel;
                s.PitSvLFP  = GetRaw<float>(pm, "Graphics.MfdTyrePressureLF", "DataCorePlugin.GameRawData.");
                s.PitSvRFP  = GetRaw<float>(pm, "Graphics.MfdTyrePressureRF", "DataCorePlugin.GameRawData.");
                s.PitSvLRP  = GetRaw<float>(pm, "Graphics.MfdTyrePressureLR", "DataCorePlugin.GameRawData.");
                s.PitSvRRP  = GetRaw<float>(pm, "Graphics.MfdTyrePressureRR", "DataCorePlugin.GameRawData.");
                s.PitSvTireCompound = GetRaw<int>(pm, "Graphics.MfdTyreSet", "DataCorePlugin.GameRawData.");
                // Synthesise PitSvFlags bitmask from non-zero values
                int accPitFlags = 0;
                if (accFuel > 0) accPitFlags |= 0x10; // PIT_SV_FUEL
                if (s.PitSvLFP > 0) accPitFlags |= 0x01;
                if (s.PitSvRFP > 0) accPitFlags |= 0x02;
                if (s.PitSvLRP > 0) accPitFlags |= 0x04;
                if (s.PitSvRRP > 0) accPitFlags |= 0x08;
                s.PitSvFlags = accPitFlags;
                // Fast repair is iRacing-only — not applicable for ACC
            }

            return s;
        }

        // ── Game-specific raw data helpers ──────────────────────────────────────
        private static float GetGameBrakeBias(PluginManager pm, GameId game)
        {
            switch (game)
            {
                case GameId.ACC:
                case GameId.AC:
                case GameId.ACEvo:
                case GameId.ACRally:
                    return GetRaw<float>(pm, "Physics.BrakeBias", "DataCorePlugin.GameRawData.") * 100f;
                case GameId.RaceRoom:
                    return GetRaw<float>(pm, "BrakeBias", "DataCorePlugin.GameRawData.") * 100f;
                case GameId.IRacing:
                default:
                    return GetRaw<float>(pm, "dcBrakeBias");
            }
        }

        private static float GetGameTC(PluginManager pm, GameId game)
        {
            switch (game)
            {
                case GameId.ACC:
                case GameId.AC:
                case GameId.ACEvo:
                case GameId.ACRally:
                    return GetRaw<float>(pm, "Graphics.TC", "DataCorePlugin.GameRawData.");
                case GameId.RaceRoom:
                    return GetRaw<float>(pm, "TractionControl", "DataCorePlugin.GameRawData.");
                case GameId.IRacing:
                default:
                    return GetRaw<float>(pm, "dcTractionControl");
            }
        }

        private static float GetGameABS(PluginManager pm, GameId game)
        {
            switch (game)
            {
                case GameId.ACC:
                case GameId.AC:
                case GameId.ACEvo:
                case GameId.ACRally:
                    return GetRaw<float>(pm, "Graphics.ABS", "DataCorePlugin.GameRawData.");
                case GameId.RaceRoom:
                    return GetRaw<float>(pm, "ABS", "DataCorePlugin.GameRawData.");
                case GameId.IRacing:
                default:
                    return GetRaw<float>(pm, "dcABS");
            }
        }

        private static int GetGameSessionFlags(PluginManager pm, GameId game)
        {
            switch (game)
            {
                case GameId.ACC:
                case GameId.AC:
                case GameId.ACEvo:
                case GameId.ACRally:
                    // Fix #4: Map ACC flags to iRacing bitmask — add type 4 (white) and type 6 (penalty)
                    int accFlag = GetRaw<int>(pm, "Graphics.Flag", "DataCorePlugin.GameRawData.");
                    // ACC_FLAG_TYPE: 0=none, 1=blue, 2=yellow, 3=black, 4=white, 5=checkered, 6=penalty
                    int irMask = 0;
                    if (accFlag == 1) irMask |= 0x0020;    // blue
                    if (accFlag == 2) irMask |= 0x0008;    // yellow → caution
                    if (accFlag == 3) irMask |= 0x00010000; // black
                    if (accFlag == 4) irMask |= 0x0002;    // white
                    if (accFlag == 5) irMask |= 0x0001;    // checkered
                    if (accFlag == 6) irMask |= 0x00010000; // penalty → black flag bit
                    return irMask;
                case GameId.RaceRoom:
                    // Fix #9: RaceRoom flag expansion — add green, white, checkered
                    int r3eMask = 0;
                    if (GetRaw<bool>(pm, "Flags.Yellow", "DataCorePlugin.GameRawData."))    r3eMask |= 0x0008;
                    if (GetRaw<bool>(pm, "Flags.Blue", "DataCorePlugin.GameRawData."))      r3eMask |= 0x0020;
                    if (GetRaw<bool>(pm, "Flags.Black", "DataCorePlugin.GameRawData."))     r3eMask |= 0x00010000;
                    if (GetRaw<bool>(pm, "Flags.Green", "DataCorePlugin.GameRawData."))     r3eMask |= 0x0004;
                    if (GetRaw<bool>(pm, "Flags.White", "DataCorePlugin.GameRawData."))     r3eMask |= 0x0002;
                    if (GetRaw<bool>(pm, "Flags.Checkered", "DataCorePlugin.GameRawData.")) r3eMask |= 0x0001;
                    return r3eMask;
                case GameId.IRacing:
                default:
                    return GetRaw<int>(pm, "SessionFlags");
            }
        }

        private static int GetGameIncidentCount(PluginManager pm, GameId game)
        {
            switch (game)
            {
                case GameId.ACC:
                case GameId.ACEvo:
                    // ACC doesn't expose incident count directly; use penalties as proxy
                    return GetRaw<int>(pm, "Graphics.Penalties", "DataCorePlugin.GameRawData.");
                // Fix #11: Non-iRacing incident counts
                case GameId.RaceRoom:
                    return GetRaw<int>(pm, "CutTrackWarnings", "DataCorePlugin.GameRawData.");
                case GameId.IRacing:
                default:
                    return GetRaw<int>(pm, "PlayerCarMyIncidentCount");
            }
        }

        private static float GetGameErsBattery(PluginManager pm, GameId game)
        {
            switch (game)
            {
                case GameId.ACC:
                case GameId.ACEvo:
                    return GetRaw<float>(pm, "Physics.KersCharge", "DataCorePlugin.GameRawData.");
                case GameId.IRacing:
                default:
                    return GetRaw<float>(pm, "EnergyERSBattery");
            }
        }

        private static bool GetGamePitLimiter(PluginManager pm, GameId game)
        {
            switch (game)
            {
                case GameId.ACC:
                case GameId.AC:
                case GameId.ACEvo:
                case GameId.ACRally:
                    return GetRaw<bool>(pm, "Physics.PitLimiterOn", "DataCorePlugin.GameRawData.");
                case GameId.IRacing:
                default:
                    return GetRaw<bool>(pm, "dcPitSpeedLimiterToggle");
            }
        }

        private static T Coalesce<T>(T primary, T fallback) where T : IComparable<T>
            => primary.CompareTo(default(T)) != 0 ? primary : fallback;

        private static T GetRaw<T>(PluginManager pm, string name, string prefix = null)
        {
            try
            {
                string fullPath;
                if (prefix != null)
                {
                    fullPath = prefix + name;
                }
                else
                {
                    fullPath = "DataCorePlugin.GameRawData.Telemetry." + name;
                }
                var val = pm.GetPropertyValue(fullPath);
                if (val is T typed) return typed;
                if (val is IConvertible) return (T)Convert.ChangeType(val, typeof(T));
            }
            catch { }
            return default(T);
        }

        /// <summary>Read a SimHub plugin property by its full name (e.g. IRacingExtraProperties.*).</summary>
        private static T GetPluginProp<T>(PluginManager pm, string fullName)
        {
            try
            {
                var val = pm.GetPropertyValue(fullName);
                if (val is T typed) return typed;
                if (val is IConvertible) return (T)Convert.ChangeType(val, typeof(T));
            }
            catch { }
            return default(T);
        }

        private static T[] GetRawArray<T>(PluginManager pm, string name)
        {
            try
            {
                var val = pm.GetPropertyValue("DataCorePlugin.GameRawData.Telemetry." + name);
                if (val is T[] arr) return arr;
            }
            catch { }
            return new T[0];
        }

        private static T GetNorm<T>(object d, string propName)
        {
            if (d == null) return default(T);
            try
            {
                var prop = d.GetType().GetProperty(propName,
                    BindingFlags.Public | BindingFlags.Instance | BindingFlags.FlattenHierarchy);
                if (prop == null) return default(T);
                var val = prop.GetValue(d);
                if (val is T typed) return typed;
                // TimeSpan → numeric: extract TotalSeconds so lap-time properties work
                // for non-iRacing games where the normalized API returns TimeSpan.
                if (val is TimeSpan ts)
                {
                    if (typeof(T) == typeof(float))  return (T)(object)(float)ts.TotalSeconds;
                    if (typeof(T) == typeof(double)) return (T)(object)ts.TotalSeconds;
                }
                // Guard: only attempt conversion if the value supports IConvertible
                // (e.g. TimeSpan does NOT, and Convert.ChangeType throws InvalidCastException)
                if (val is IConvertible) return (T)Convert.ChangeType(val, typeof(T));
            }
            catch { }
            return default(T);
        }

        // ── Cloud sector config cache ──
        private static readonly Dictionary<string, (int count, double[] boundaries)> _cloudSectorCache
            = new Dictionary<string, (int, double[])>();
        private static readonly object _cloudSectorLock = new object();

        /// <summary>
        /// Fetch sector config (count + optional custom boundaries) from the K10 cloud API.
        /// Caches results to avoid repeated HTTP calls.
        /// Returns (sectorCount, boundaries) where boundaries may be null for equal-fraction splits.
        /// </summary>
        private static (int count, double[] boundaries) FetchCloudSectorConfig(string trackName)
        {
            if (string.IsNullOrEmpty(trackName)) return (0, null);

            lock (_cloudSectorLock)
            {
                if (_cloudSectorCache.TryGetValue(trackName, out var cached))
                    return cached;
            }

            try
            {
                string url = "https://prodrive.racecor.io/api/tracks?trackName=" +
                    Uri.EscapeDataString(trackName.Trim());
                var request = (System.Net.HttpWebRequest)System.Net.WebRequest.Create(url);
                request.Method = "GET";
                request.Timeout = 3000;
                request.UserAgent = "RaceCorProDrive-Plugin";

                using (var response = (System.Net.HttpWebResponse)request.GetResponse())
                using (var reader = new System.IO.StreamReader(response.GetResponseStream()))
                {
                    string json = reader.ReadToEnd();

                    // Parse sectorCount
                    var countMatch = Regex.Match(json, @"""sectorCount""\s*:\s*(\d+)");
                    int count = countMatch.Success ? int.Parse(countMatch.Groups[1].Value) : 0;

                    // Parse sectorBoundaries (JSON array of doubles, e.g. [0.14, 0.28, ...])
                    double[] boundaries = null;
                    var boundMatch = Regex.Match(json, @"""sectorBoundaries""\s*:\s*\[([^\]]+)\]");
                    if (boundMatch.Success)
                    {
                        var parts = boundMatch.Groups[1].Value.Split(',');
                        var parsed = new List<double>();
                        foreach (var part in parts)
                        {
                            if (double.TryParse(part.Trim(),
                                System.Globalization.NumberStyles.Float,
                                System.Globalization.CultureInfo.InvariantCulture, out double val))
                                parsed.Add(val);
                        }
                        if (parsed.Count > 0) boundaries = parsed.ToArray();
                    }

                    var result = (count, boundaries);
                    lock (_cloudSectorLock) { _cloudSectorCache[trackName] = result; }
                    return result;
                }
            }
            catch
            {
                lock (_cloudSectorLock) { _cloudSectorCache[trackName] = (0, null); }
                return (0, null);
            }
        }
    }
}
