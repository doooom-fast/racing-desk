using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Xml.Linq;
using Newtonsoft.Json.Linq;
using RaceCorProDrive.Plugin.Engine;
using RaceCorProDrive.Plugin.Engine.Moza;

namespace RaceCorProDrive.Plugin
{
    /// <summary>
    /// The Pro Drive runtime, independent of any host: owns the engines, advances them once per
    /// telemetry frame, and serves the localhost:8889 JSON contract plus the :8890 WebSocket.
    /// Hosts (the SimHub plugin, the standalone RaceCor.Host) supply a <see cref="TelemetrySnapshot"/>
    /// per frame and the few things only they know: where datasets live, the track id, the live
    /// leaderboard.
    /// </summary>
    public sealed partial class ProDriveRuntime
    {
        public sealed class Options
        {
            /// <summary>Directory containing racecorprodrive-data\ and the track-map dataset (SimHub: the SimHub root).</summary>
            public string AssemblyDirectory { get; set; }
            /// <summary>Writable per-machine data directory (SimHub: ProgramData\SimHub\PluginsData\RaceCorProDrive).</summary>
            public string PluginsDataDirectory { get; set; }
            /// <summary>Port for the JSON state contract (the overlay polls :8889).</summary>
            public int HttpPort { get; set; } = 8889;
            /// <summary>Port for the MessagePack WebSocket feed.</summary>
            public int WsPort { get; set; } = 8890;
        }

        private readonly Options _options;

        public Settings Settings { get; set; }

        /// <summary>Raised on the frame a new commentary prompt becomes visible.</summary>
        public event Action NewCommentaryPrompt;

        public ProDriveRuntime(Settings settings, Options options)
        {
            Settings = settings ?? new Settings();
            _options = options ?? new Options();
        }

        // Engine
        internal readonly CommentaryEngine _engine = new CommentaryEngine();
        internal readonly TrackMapProvider _trackMap = new TrackMapProvider();
        internal readonly Engine.IRacingSdkBridge _sdkBridge = new Engine.IRacingSdkBridge();
        internal readonly Engine.Strategy.StrategyCoordinator _strategy = new Engine.Strategy.StrategyCoordinator();
        internal IncidentCoachEngine _incidentCoach;
        internal PedalProfileManager _pedalProfiles;

        // Moza direct serial hardware manager — bypasses Pit House
        internal MozaSerialManager _mozaSerial;

        // iRacing Data API client — reads local cookies / credentials to fetch career data
        internal readonly Engine.IRacingDataClient _iracingData = new Engine.IRacingDataClient();

        // Car change detection for pedal profile auto-switch
        internal string _lastCarModel = "";

        // Telemetry frames (current + previous for delta calculations)
        internal TelemetrySnapshot _current = new TelemetrySnapshot();
        internal TelemetrySnapshot _previous = new TelemetrySnapshot();

        // Frame counter — we evaluate triggers every N frames to reduce CPU load
        // at 60fps, every 6 frames = ~100ms evaluation cadence
        internal int _frameCount = 0;
        internal const int EvalEveryNFrames = 6;

        // Track change detection — triggers map reload
        internal string _lastTrackId = "";
        // Raw SimHub TrackId (includes config info, e.g. "nurburgring gp")
        internal string _lastRawTrackSlug = "";

        // HTTP state server — exposes plugin state on port 8889 for Homebridge
        internal HttpListener _httpListener;
        internal Thread _httpThread;

        // WebSocket telemetry server — exposes plugin state on port 8890 for overlay
        internal Transport.WsServer _wsServer;
        internal Transport.WsTelemetryPublisher _wsPublisher;

        // Pitbox wheel button counters — each incremented by a SimHub action,
        // read by dashboard each poll frame to detect changes.
        internal volatile int _pitboxTabCycle = 0;
        internal volatile int _pitboxTabCycleBack = 0;
        internal volatile int _pitboxNext = 0;
        internal volatile int _pitboxPrev = 0;
        internal volatile int _pitboxIncrement = 0;
        internal volatile int _pitboxDecrement = 0;
        internal volatile int _pitboxToggle = 0;

        // Start position tracking — captured once when race goes green
        internal int _startPosition = 0;
        internal bool _startPositionCaptured = false;

        // Start lights state machine — synthesized from PaceMode/SessionState
        internal int _lightsPhase = 0;         // 0=off, 1-5=building reds, 6=all red, 7=green, 8=done
        internal int _lightsPrevPaceMode = 0;
        internal int _lightsPrevSessionState = 0;
        internal int _lightsHoldFrames = 0;    // countdown for timed phases
        internal int _lightsStepFrame = 0;     // countdown for building each red

        // Leaderboard: compact JSON string of nearby drivers, updated each eval cycle
        internal volatile string _leaderboardJson = "[]";

        // Screen color sampler — replaces Electron desktopCapturer for ambient light
        internal readonly ScreenColorSampler _screenColorSampler = new ScreenColorSampler();

        // Week Planner cache — season schedule for next-race-ideas
        internal JToken _weekPlannerCache = null;
        internal DateTime _weekPlannerCacheTime = DateTime.MinValue;
        private static readonly TimeSpan WeekPlannerCacheDuration = TimeSpan.FromHours(6);

        /// <summary>Loads datasets and starts hardware, samplers and the :8889 / :8890 servers.</summary>
        public void Start()
        {
            ApplySettings();

            // Load topics dataset
            string topicsPath = ResolveTopicsPath();
            _engine.LoadTopics(topicsPath);

            // Load sentiments (for background colors)
            string sentimentsPath = ResolveDatasetFile("sentiments.json");
            _engine.LoadSentiments(sentimentsPath);

            // Load commentary fragments (for sentence composition)
            string fragmentsPath = ResolveDatasetFile("commentary_fragments.json");
            _engine.LoadFragments(fragmentsPath);

            // Load track-specific commentary data (for {track}, {corner}, {trackFact} placeholders)
            string trackDataPath = ResolveDatasetFile("commentary_tracks.json");
            _engine.LoadTrackData(trackDataPath);

            // Load car/manufacturer commentary data (for {carFact}, {carCharacter}, {engineSpec}, etc.)
            string carDataPath = ResolveDatasetFile("commentary_cars.json");
            _engine.LoadCarData(carDataPath);

            // Initialise iRacing SDK bridge (direct shared memory via IRSDKSharper)
            TelemetryCapture._sdkBridge = _sdkBridge;
            _sdkBridge.Start();

            // Start screen color sampler for ambient lighting
            // (runs at ~4fps on a background thread — zero impact on main loop)
            _screenColorSampler.Start();

            // Initialise pedal profile manager (per-car curves + Moza integration)
            string pedalDataDir = _options.PluginsDataDirectory;
            _pedalProfiles = new PedalProfileManager(pedalDataDir);
            _pedalProfiles.Load();
            Log.Info($"[RaceCorProDrive] Pedal profiles loaded — Moza detected: {_pedalProfiles.MozaDetected}, active: {_pedalProfiles.ActiveProfile?.Name ?? "(none)"}, profiles: {_pedalProfiles.Profiles.Count}");

            // Initialise Moza direct serial hardware manager (bypasses Pit House)
            _mozaSerial = new MozaSerialManager(
                msg => Log.Info(msg),
                msg => Log.Warn(msg));
            _mozaSerial.Start();
            Log.Info("[RaceCorProDrive] Moza serial manager started");

            // Initialise track map provider — the host says where the track-map dataset lives
            // (SimHub: the SimHub root, where the plugin DLL is installed).
            string simhubDir = _options.AssemblyDirectory ?? "";
            _trackMap.SetSimHubDirectory(simhubDir);

            // Initialise Incident Coach engine
            _incidentCoach = new IncidentCoachEngine();
            _incidentCoach.Enabled = Settings.IncidentCoachEnabled;
            _incidentCoach.VoiceEnabled = Settings.IncidentCoachVoiceEnabled;
            _incidentCoach.CooldownThreshold = Settings.IncidentCoachCooldownThreshold;
            _incidentCoach.AlertSensitivity = Settings.IncidentCoachAlertSensitivity;
            _incidentCoach.Init();

            // Show a brief placeholder so the dashboard is visible before any game starts
            _engine.ShowDemoPrompt();

            // Start local HTTP server for Homebridge integration
            StartHttpServer();

            // Start WebSocket server for overlay (port 8890, PR 5 migrates to 8889)
            try
            {
                _wsServer = new Transport.WsServer(_options.WsPort, "/racecor");
                _wsServer.Start();
                _wsPublisher = new Transport.WsTelemetryPublisher(_wsServer);
                Log.Info($"[RaceCorProDrive] WebSocket telemetry server started on port {_options.WsPort}");
            }
            catch (Exception ex)
            {
                Log.Warn($"[RaceCorProDrive] WebSocket server failed to start: {ex.Message}");
                _wsServer = null;
                _wsPublisher = null;
            }
        }

        /// <summary>Advances the runtime by one telemetry frame read from <paramref name="source"/>.</summary>
        public void Tick(ITelemetrySource source)
        {
            var next = TelemetryCapture.Capture(source);
            var newData = source.NewData;
            Advance(
                next,
                () => GetTrackId(source),
                newData != null ? (Func<int, string>)(position => BuildLeaderboard(newData, position)) : null);
        }

        /// <param name="next">This frame's snapshot.</param>
        /// <param name="trackIdProvider">Returns the current track id; called only while the game is running.</param>
        /// <param name="liveLeaderboard">Builds the leaderboard JSON for the player's position, or null when unavailable.</param>
        private void Advance(TelemetrySnapshot next, Func<string> trackIdProvider, Func<int, string> liveLeaderboard)
        {
            // Capture current telemetry every frame (cheap snapshot)
            _previous = _current;
            _current = next ?? new TelemetrySnapshot();

            // ── Start position tracking ──
            // Capture the grid position once when the session goes to Racing (state 4)
            // Reset when session state drops back (new race / reconnect).
            if (_current.SessionState == 4 && !_startPositionCaptured && _current.Position > 0)
            {
                _startPosition = _current.Position;
                _startPositionCaptured = true;
            }
            else if (_current.SessionState < 4)
            {
                _startPositionCaptured = false;
                _startPosition = 0;
                _strategy.Reset();
            }
            _current.StartPosition = _startPosition;

            // Detect car changes — switch pedal profile when car model changes
            if (!string.IsNullOrEmpty(_current.CarModel) && _current.CarModel != _lastCarModel)
            {
                _lastCarModel = _current.CarModel;
                _pedalProfiles?.OnCarChanged(_current.CarModel, _current.CarModel);
            }

            // Detect track changes — reload map when track ID changes
            if (_current.GameRunning)
            {
                string trackId = trackIdProvider != null ? trackIdProvider() : (_current.GameName ?? "");
                if (!string.IsNullOrEmpty(trackId) && trackId != _lastTrackId)
                {
                    _lastTrackId = trackId;
                    _trackMap.OnTrackChanged(trackId);
                }

                // Feed velocity + car positions to the track map provider every frame
                // (recording needs high sample rate; interpolation is cheap)
                _trackMap.Update(
                    _current.VelocityX, _current.VelocityZ,
                    _current.Yaw,
                    _current.TrackPositionPct,
                    _current.CarIdxLapDistPct,
                    _current.CarIdxOnPitRoad,
                    _current.PlayerCarIdx,
                    _current.Position,
                    _current.IsInPitLane);
            }

            // Publish telemetry via WebSocket (every frame for real-time overlay)
            if (_wsPublisher != null)
            {
                try
                {
                    var telemetryDict = Transport.TelemetryFrame.BuildDict(
                        _current,
                        Settings.DemoMode,
                        _engine,
                        _strategy,
                        _incidentCoach,
                        _trackMap,
                        new[] { _pitboxTabCycle, _pitboxTabCycleBack, _pitboxNext, _pitboxPrev, _pitboxIncrement, _pitboxDecrement, _pitboxToggle },
                        _leaderboardJson,
                        _screenColorSampler,
                        _mozaSerial,
                        _pedalProfiles,
                        _lightsPhase,
                        _lastRawTrackSlug);
                    _wsPublisher.Tick(telemetryDict);
                }
                catch (Exception ex)
                {
                    Log.Warn($"[RaceCorProDrive] WebSocket telemetry tick failed: {ex.Message}");
                }
            }

            // Only run commentary evaluation every N frames
            _frameCount++;
            if (_frameCount < EvalEveryNFrames) return;
            _frameCount = 0;

            // Update demo track map if in demo mode
            if (Settings.DemoMode)
            {
                var dt = _engine.DemoTelemetry;
                _trackMap.UpdateDemo(dt.TrackPosition, 19, dt.Elapsed); // 19 opponents = 20 car field
            }

            // ── Leaderboard capture ───────────────────────────────────────
            try
            {
                if (Settings.DemoMode)
                    _leaderboardJson = BuildDemoLeaderboard(_engine.DemoTelemetry);
                else if (_current.GameRunning && liveLeaderboard != null)
                    _leaderboardJson = liveLeaderboard(_current.Position);
                else
                    _leaderboardJson = "[]";
            }
            catch (Exception ex)
            {
                Log.Warn($"[RaceCorProDrive] Leaderboard build failed: {ex.Message}");
                _leaderboardJson = "[]";
            }

            // Push live driver name from iRacing into commentary engine
            if (!string.IsNullOrEmpty(_current.PlayerName))
            {
                var parts = _current.PlayerName.Trim().Split(new[] { ' ' }, 2);
                _engine.DriverFirstName = parts[0];
                _engine.DriverLastName = parts.Length > 1 ? parts[1] : "";
            }

            // Synthesize start lights from PaceMode/SessionState
            UpdateLightsPhase();

            bool wasVisible = _engine.IsVisible;
            _engine.Update(_current, _previous);

            // Strategy coordinator — runs per-frame, manages stint lifecycle
            _strategy.Update(_current, _previous);

            // Incident Coach — tracks incidents, threat levels, rage scores
            _incidentCoach?.Update(_current, _previous);

            // Fire event when a new prompt appears
            if (_engine.IsVisible && !wasVisible)
                NewCommentaryPrompt?.Invoke();
        }

        /// <summary>Stops hardware, samplers and servers.</summary>
        public void Stop()
        {
            _sdkBridge.Stop();
            _screenColorSampler.Dispose();
            _mozaSerial?.Dispose();
            _incidentCoach?.End();
            StopHttpServer();
            _wsServer?.Stop();
        }

        /// <summary>
        /// Detect if the player is lapping the car immediately ahead.
        /// Returns true when the nearest car ahead has fewer completed laps
        /// AND is within ~3s gap — meaning they should be yielding (blue flag for them).
        /// The dashboard shows this as an "orange flag" so the player knows the car
        /// ahead is being told to let them through.
        /// </summary>
        internal static bool IsLappingCarAhead(TelemetrySnapshot s)
        {
            if (s.CarIdxLapDistPct == null || s.CarIdxLapDistPct.Length == 0) return false;
            if (s.CarIdxLapCompleted == null || s.CarIdxLapCompleted.Length == 0) return false;
            if (s.PlayerCarIdx < 0 || s.PlayerCarIdx >= s.CarIdxLapCompleted.Length) return false;

            int playerLaps = s.CarIdxLapCompleted[s.PlayerCarIdx];
            if (playerLaps <= 0) return false;

            float playerDist = s.PlayerCarIdx < s.CarIdxLapDistPct.Length
                ? s.CarIdxLapDistPct[s.PlayerCarIdx] : 0;
            if (playerDist <= 0) return false;

            // Find the nearest car ahead on track (by LapDistPct)
            double bestGap = double.MaxValue;
            int bestIdx = -1;
            for (int i = 0; i < s.CarIdxLapDistPct.Length; i++)
            {
                if (i == s.PlayerCarIdx) continue;
                float dist = s.CarIdxLapDistPct[i];
                if (dist <= 0 || dist > 1) continue;
                // Skip cars in pit
                if (s.CarIdxOnPitRoad != null && i < s.CarIdxOnPitRoad.Length && s.CarIdxOnPitRoad[i]) continue;

                // Gap ahead = their dist - our dist (positive = they're ahead)
                double gap = dist - playerDist;
                if (gap < 0) gap += 1.0; // wrap around
                if (gap > 0 && gap < bestGap)
                {
                    bestGap = gap;
                    bestIdx = i;
                }
            }

            if (bestIdx < 0) return false;
            if (bestIdx >= s.CarIdxLapCompleted.Length) return false;

            // The car ahead has fewer laps = they're a lapped car
            int aheadLaps = s.CarIdxLapCompleted[bestIdx];
            if (aheadLaps >= playerLaps) return false;

            // Only show when we're close enough that the blue flag would be shown to them
            // (~3% track distance ≈ within about 3-5 seconds at typical speeds)
            return bestGap < 0.04;
        }

        // ── Internal helpers ──────────────────────────────────────────────────

        /// <summary>
        /// Synthesize F1-style start lights from iRacing PaceMode / SessionState.
        /// Rolling start: PaceMode 2 (Approaching) → build reds, PaceMode 3 (CrossSF) → all red hold,
        /// SessionState 3→4 transition → green. Called every eval cycle (~100ms).
        /// </summary>
        private void UpdateLightsPhase()
        {
            int ss = _current.SessionState;
            int pm = _current.PaceMode;

            // Green flag: session just went to Racing (4) from formation (3)
            if (ss == 4 && _lightsPrevSessionState == 3 && _lightsPhase >= 1 && _lightsPhase <= 6)
            {
                _lightsPhase = 7; // GREEN!
                _lightsHoldFrames = 15; // hold green ~1.5s
            }
            // Green hold → done
            else if (_lightsPhase == 7)
            {
                _lightsHoldFrames--;
                if (_lightsHoldFrames <= 0) _lightsPhase = 8;
            }
            // Done → fade out → reset
            else if (_lightsPhase == 8)
            {
                _lightsHoldFrames--;
                if (_lightsHoldFrames <= -10) _lightsPhase = 0;
            }
            // All red hold — waiting for green
            else if (_lightsPhase == 6)
            {
                // Just hold until green flag (handled above)
            }
            // Building reds 1-5
            else if (_lightsPhase >= 1 && _lightsPhase < 6)
            {
                _lightsStepFrame--;
                if (_lightsStepFrame <= 0)
                {
                    _lightsPhase++;
                    _lightsStepFrame = 8; // ~0.8s per light column
                }
            }
            // Not active — detect start condition
            else if (_lightsPhase == 0)
            {
                // PaceMode transitions to 2+ during formation (SS 3)
                bool pmTransition = ss == 3 && pm >= 2 && _lightsPrevPaceMode < 2;
                // SessionState transitions to 3 while PaceMode already >= 2
                // (rolling starts: PM can already be 2 when SS goes to 3)
                bool ssTransition = ss == 3 && _lightsPrevSessionState != 3 && pm >= 2;

                if (pmTransition || ssTransition)
                {
                    if (pm == 3)
                        _lightsPhase = 6; // jump to all red
                    else
                    {
                        _lightsPhase = 1;
                        _lightsStepFrame = 8;
                    }
                }
                // If we somehow get PaceMode 3 directly
                else if (ss == 3 && pm == 3 && _lightsPrevPaceMode < 3)
                {
                    _lightsPhase = 6; // jump to all red
                }
                // Final fallback: in formation with pace mode >= 3 but somehow never started
                else if (ss == 3 && pm >= 3 && _lightsPrevPaceMode >= 3)
                {
                    _lightsPhase = 6;
                }
                // Catch-all: if session just went to Racing and we never fired lights,
                // show a quick green flash so the driver sees something
                else if (ss == 4 && _lightsPrevSessionState <= 3 && _lightsPrevSessionState >= 1 && _lightsPhase == 0)
                {
                    _lightsPhase = 7; // GREEN!
                    _lightsHoldFrames = 15;
                }
            }

            // If session goes back to non-formation unexpectedly, reset
            if (ss <= 1 && _lightsPhase > 0 && _lightsPhase < 7)
            {
                _lightsPhase = 0;
            }

            _lightsPrevPaceMode = pm;
            _lightsPrevSessionState = ss;
        }

        public void ApplySettings()
        {
            _engine.DisplaySeconds = Settings.PromptDisplaySeconds;
            _engine.EventOnlyMode = Settings.EventOnlyMode;
            _engine.DemoMode = Settings.DemoMode;
            _engine.DriverFirstName = Settings.DriverFirstName ?? "";
            _engine.DriverLastName = Settings.DriverLastName ?? "";
            _trackMap.SetDemoMode(Settings.DemoMode);
            _engine.EnabledCategories = Settings.EnabledCategories?.Count > 0
                ? new System.Collections.Generic.HashSet<string>(Settings.EnabledCategories)
                : null;

        }

        internal string BuildDisplayText()
        {
            if (!_engine.IsVisible) return "";

            // Event-only mode: show concise exposition instead of commentary prompt
            if (Settings.EventOnlyMode)
            {
                string expo = _engine.CurrentEventExposition;
                return string.IsNullOrEmpty(expo)
                    ? _engine.CurrentTitle
                    : expo;
            }

            if (Settings.ShowTopicTitle && !string.IsNullOrEmpty(_engine.CurrentTitle))
                return _engine.CurrentTitle + "\n" + _engine.CurrentText;
            return _engine.CurrentText;
        }

        /// <summary>Build demo leaderboard with fake data around the player.</summary>
        private string BuildDemoLeaderboard(DemoTelemetryProvider dt)
        {
            var ic = System.Globalization.CultureInfo.InvariantCulture;
            int pp = dt.Position;
            var names = new[] { "L. Hamilton", "M. Verstappen", "C. Leclerc", dt.DriverAhead, "YOU",
                                dt.DriverBehind, "S. Vettel", "D. Ricciardo", "L. Norris", "C. Sainz" };
            var iratings = new[] { 5200, 4800, 3900, dt.IRAhead, dt.IRating,
                                   dt.IRBehind, 2400, 2200, 2100, 1900 };
            double baseLap = dt.BestLapTime > 0 ? dt.BestLapTime : 92.4;
            var rng = new Random(42); // deterministic seed

            int windowStart = Math.Max(1, pp - 3);
            var sb = new StringBuilder(512);
            sb.Append("[");
            for (int i = 0; i < 7; i++)
            {
                int pos = windowStart + i;
                if (pos < 1 || pos > 20) continue;
                int nameIdx = i < names.Length ? i : i % names.Length;
                string name = (pos == pp) ? "YOU" : (nameIdx < names.Length ? names[nameIdx] : "Driver " + pos);
                int ir = (nameIdx < iratings.Length) ? iratings[nameIdx] : 2000 + rng.Next(500);
                double best = baseLap + (pos - pp) * 0.4 + rng.NextDouble() * 0.3;
                double last = best + (rng.NextDouble() - 0.3) * 1.5;
                double gap = (pos - pp) * 1.8 + rng.NextDouble() * 0.5;
                bool isPlayer = (pos == pp);
                if (sb.Length > 1) sb.Append(",");
                sb.AppendFormat(ic, "[{0},\"{1}\",{2},{3:F3},{4:F3},{5:F2},{6},{7}]",
                    pos, Escape(name), ir, best, last, gap, 0, isPlayer ? 1 : 0);
            }
            sb.Append("]");
            return sb.ToString();
        }

        private string GetTrackId(ITelemetrySource pm)
        {
            try
            {
                // iRacing: SessionInfo contains track name
                var val = pm.GetPropertyValue("DataCorePlugin.GameData.TrackName")
                       ?? pm.GetPropertyValue("DataCorePlugin.GameData.TrackId");
                // Also capture the raw TrackId (includes config info, e.g. "nurburgring gp")
                // Used by the overlay to pass config hints to the track map API.
                var rawId = pm.GetPropertyValue("DataCorePlugin.GameData.TrackId");
                if (rawId != null)
                {
                    string slug = rawId.ToString().Trim();
                    if (!string.IsNullOrEmpty(slug)) _lastRawTrackSlug = slug;
                }
                if (val != null)
                {
                    string id = val.ToString().Trim();
                    if (!string.IsNullOrEmpty(id)) return id;
                }
            }
            catch (Exception ex)
            {
                Log.Warn($"[RaceCorProDrive] Track ID lookup failed: {ex.Message}");
            }
            return _current.GameName ?? "";
        }

        /// <summary>
        /// Build leaderboard JSON from the source's Opponents list (read by property name).
        /// Returns a window of drivers centred on the player, compact JSON array.
        /// Each entry: [pos, name, irating, bestLap, lastLap, gapToPlayer, inPit]
        /// </summary>
        private string BuildLeaderboard(object newData, int playerPos)
        {
            var ic = System.Globalization.CultureInfo.InvariantCulture;
            try
            {
                var oppsProp = newData.GetType().GetProperty("Opponents",
                    BindingFlags.Public | BindingFlags.Instance | BindingFlags.FlattenHierarchy);
                var opps = oppsProp?.GetValue(newData) as System.Collections.IList;
                if (opps == null || opps.Count == 0) return "[]";

                // Collect all opponent data
                var entries = new System.Collections.Generic.List<string>(opps.Count + 1);
                foreach (var opp in opps)
                {
                    var t = opp.GetType();
                    int pos = Convert.ToInt32(t.GetProperty("Position")?.GetValue(opp) ?? 0);
                    string name = (t.GetProperty("Name")?.GetValue(opp) as string) ?? "";
                    int irating = 0;
                    var irProp = t.GetProperty("IRating") ?? t.GetProperty("Irating");
                    if (irProp != null) { var v = irProp.GetValue(opp); if (v != null) irating = Convert.ToInt32(v); }
                    double best = 0, last = 0;
                    var bestProp = t.GetProperty("BestLapTime");
                    if (bestProp != null) { var v = bestProp.GetValue(opp); if (v is TimeSpan ts && ts.TotalSeconds > 0) best = ts.TotalSeconds; }
                    var lastProp = t.GetProperty("LastLapTime");
                    if (lastProp != null) { var v = lastProp.GetValue(opp); if (v is TimeSpan ts2 && ts2.TotalSeconds > 0) last = ts2.TotalSeconds; }
                    double gapToPlayer = 0;
                    var gapProp = t.GetProperty("GapToPlayer");
                    if (gapProp != null) { var v = gapProp.GetValue(opp); if (v != null) gapToPlayer = Convert.ToDouble(v); }
                    bool inPit = false;
                    var pitProp = t.GetProperty("IsInPit") ?? t.GetProperty("IsInPitLane");
                    if (pitProp != null) { var v = pitProp.GetValue(opp); if (v is bool b) inPit = b; else if (v is int iv) inPit = iv != 0; }
                    bool isPlayer = (pos == playerPos);

                    if (pos <= 0) continue;

                    // Compact: [pos,"name",irating,bestLap,lastLap,gap,inPit,isPlayer]
                    entries.Add(string.Format(ic,
                        "[{0},\"{1}\",{2},{3:F3},{4:F3},{5:F2},{6},{7}]",
                        pos, Escape(name), irating, best, last, gapToPlayer, inPit ? 1 : 0, isPlayer ? 1 : 0));
                }

                // Sort by position
                entries.Sort((a, b) =>
                {
                    // Extract position number from "[pos,..."
                    int pa = int.Parse(a.Substring(1, a.IndexOf(',') - 1));
                    int pb = int.Parse(b.Substring(1, b.IndexOf(',') - 1));
                    return pa.CompareTo(pb);
                });

                // Send all drivers (no windowing — let the JS decide what to display)
                // Limit to a reasonable max (60 drivers) to avoid excessive data transfer
                if (entries.Count > 60) entries = entries.GetRange(0, 60);

                return "[" + string.Join(",", entries) + "]";
            }
            catch (Exception ex)
            {
                Log.Warn($"[RaceCorProDrive] Opponent parsing failed: {ex.Message}");
                return "[]";
            }
        }
    }
}
