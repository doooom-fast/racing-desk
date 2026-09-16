using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Xml.Linq;
using GameReaderCommon;
using Newtonsoft.Json.Linq;
using RaceCorProDrive.Plugin.Engine;
using RaceCorProDrive.Plugin.Engine.Moza;
using SimHub.Plugins;

namespace RaceCorProDrive.Plugin
{
    [PluginDescription("Broadcast-grade sim racing HUD with real-time telemetry, AI commentary, race strategy, WebGL effects, and HomeKit smart lighting.")]
    [PluginAuthor("K10 Motorsports")]
    [PluginName("RaceCor Pro Drive")]
    public class Plugin : IPlugin, IDataPlugin, IWPFSettingsV2
    {
        public Settings Settings { get; private set; }
        public PluginManager PluginManager { get; set; }

        public ImageSource PictureIcon => new BitmapImage(new Uri(
            "pack://application:,,,/RaceCorProDrive;component/icon.png"));
        public string LeftMenuTitle => "RaceCor.io Pro Drive";

#if CROSS_PLATFORM
        // Cross-platform build: settings panel excluded (no XAML compiler on Linux/macOS).
        // Return null — SimHub shows default settings when the plugin has no WPF panel.
        public System.Windows.Controls.Control GetWPFSettingsControl(PluginManager pluginManager) => null;
#endif

        // Engine
        private readonly CommentaryEngine _engine = new CommentaryEngine();
        private readonly TrackMapProvider _trackMap = new TrackMapProvider();
        private readonly Engine.IRacingSdkBridge _sdkBridge = new Engine.IRacingSdkBridge();
        private readonly Engine.Strategy.StrategyCoordinator _strategy = new Engine.Strategy.StrategyCoordinator();
        private IncidentCoachEngine _incidentCoach;
        private PedalProfileManager _pedalProfiles;

        // Moza direct serial hardware manager — bypasses Pit House
        private MozaSerialManager _mozaSerial;

        // iRacing Data API client — reads local cookies / credentials to fetch career data
        private readonly Engine.IRacingDataClient _iracingData = new Engine.IRacingDataClient();

        // Car change detection for pedal profile auto-switch
        private string _lastCarModel = "";

        // Telemetry frames (current + previous for delta calculations)
        private TelemetrySnapshot _current = new TelemetrySnapshot();
        private TelemetrySnapshot _previous = new TelemetrySnapshot();

        // Frame counter — we evaluate triggers every N frames to reduce CPU load
        // at 60fps, every 6 frames = ~100ms evaluation cadence
        private int _frameCount = 0;
        private const int EvalEveryNFrames = 6;

        // Track change detection — triggers map reload
        private string _lastTrackId = "";
        // Raw SimHub TrackId (includes config info, e.g. "nurburgring gp")
        private string _lastRawTrackSlug = "";

        // HTTP state server — exposes plugin state on port 8889 for Homebridge
        private HttpListener _httpListener;
        private Thread _httpThread;

        // WebSocket telemetry server — exposes plugin state on port 8890 for overlay
        private Transport.WsServer _wsServer;
        private Transport.WsTelemetryPublisher _wsPublisher;

        // Pitbox wheel button counters — each incremented by a SimHub action,
        // read by dashboard each poll frame to detect changes.
        private volatile int _pitboxTabCycle = 0;
        private volatile int _pitboxTabCycleBack = 0;
        private volatile int _pitboxNext = 0;
        private volatile int _pitboxPrev = 0;
        private volatile int _pitboxIncrement = 0;
        private volatile int _pitboxDecrement = 0;
        private volatile int _pitboxToggle = 0;

        // Start position tracking — captured once when race goes green
        private int _startPosition = 0;
        private bool _startPositionCaptured = false;

        // Start lights state machine — synthesized from PaceMode/SessionState
        private int _lightsPhase = 0;         // 0=off, 1-5=building reds, 6=all red, 7=green, 8=done
        private int _lightsPrevPaceMode = 0;
        private int _lightsPrevSessionState = 0;
        private int _lightsHoldFrames = 0;    // countdown for timed phases
        private int _lightsStepFrame = 0;     // countdown for building each red

        // Leaderboard: compact JSON string of nearby drivers, updated each eval cycle
        private volatile string _leaderboardJson = "[]";

        // Screen color sampler — replaces Electron desktopCapturer for ambient light
        private readonly ScreenColorSampler _screenColorSampler = new ScreenColorSampler();

        // Week Planner cache — season schedule for next-race-ideas
        private JToken _weekPlannerCache = null;
        private DateTime _weekPlannerCacheTime = DateTime.MinValue;
        private static readonly TimeSpan WeekPlannerCacheDuration = TimeSpan.FromHours(6);

        // ── Track map queries (for settings UI) ─────────────────────────────


        // ── IWPFSettingsV2 ────────────────────────────────────────────────────

#if !CROSS_PLATFORM
        private SettingsControl _settingsControl;
        public System.Windows.Controls.Control GetWPFSettingsControl(PluginManager pluginManager)
            => _settingsControl = new SettingsControl(this);
#endif

        // ── IDataPlugin ───────────────────────────────────────────────────────

        public void Init(PluginManager pluginManager)
        {
            SimHub.Logging.Current.Info("[RaceCorProDrive] Initialising RaceCorProDrive plugin");

            // Load settings
            Settings = this.ReadCommonSettings<Settings>("GeneralSettings", () => new Settings());

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
            TelemetrySnapshot._sdkBridge = _sdkBridge;
            _sdkBridge.Start();

            // Start screen color sampler for ambient lighting
            // (runs at ~4fps on a background thread — zero impact on main loop)
            _screenColorSampler.Start();

            // Initialise pedal profile manager (per-car curves + Moza integration)
            string pedalDataDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
                "SimHub", "PluginsData", "RaceCorProDrive");
            _pedalProfiles = new PedalProfileManager(pedalDataDir);
            _pedalProfiles.Load();
            SimHub.Logging.Current.Info($"[RaceCorProDrive] Pedal profiles loaded — Moza detected: {_pedalProfiles.MozaDetected}, active: {_pedalProfiles.ActiveProfile?.Name ?? "(none)"}, profiles: {_pedalProfiles.Profiles.Count}");

            // Initialise Moza direct serial hardware manager (bypasses Pit House)
            _mozaSerial = new MozaSerialManager(
                msg => SimHub.Logging.Current.Info(msg),
                msg => SimHub.Logging.Current.Warn(msg));
            _mozaSerial.Start();
            SimHub.Logging.Current.Info("[RaceCorProDrive] Moza serial manager started");

            // Initialise track map provider
            // The DLL is output directly into the SimHub root folder (not a Plugins\ subfolder),
            // so the assembly's directory IS the SimHub directory.
            string simhubDir = Path.GetDirectoryName(typeof(Plugin).Assembly.Location) ?? "";
            _trackMap.SetSimHubDirectory(simhubDir);

            // Initialise Incident Coach engine
            _incidentCoach = new IncidentCoachEngine();
            _incidentCoach.Enabled = Settings.IncidentCoachEnabled;
            _incidentCoach.VoiceEnabled = Settings.IncidentCoachVoiceEnabled;
            _incidentCoach.CooldownThreshold = Settings.IncidentCoachCooldownThreshold;
            _incidentCoach.AlertSensitivity = Settings.IncidentCoachAlertSensitivity;
            _incidentCoach.Init();

            // ── Register dashboard properties ─────────────────────────────────

            // The full commentary prompt text (or event exposition in event-only mode)
            this.AttachDelegate("CommentaryText", () => BuildDisplayText());

            // Boolean: whether the panel should be visible
            this.AttachDelegate("CommentaryVisible", () => _engine.IsVisible ? 1 : 0);

            // Category with severity/sentiment label, e.g. "car_response — Urgent"
            this.AttachDelegate("CommentaryCategory", () =>
            {
                string cat = _engine.CurrentCategory;
                string label = _engine.CurrentSentimentLabel;
                return string.IsNullOrEmpty(label) ? cat : cat + " — " + label;
            });

            // Track position: sector + lap distance percentage
            this.AttachDelegate("CommentaryTrackPosition", () =>
            {
                if (!_current.GameRunning) return "";
                int pct = (int)Math.Round(_current.TrackPositionPct * 100);
                return $"Lap {_current.CurrentLap} · {pct}%";
            });

            // Short topic title
            this.AttachDelegate("CommentaryTopicTitle", () => _engine.CurrentTitle);

            // Topic ID (snake_case) for icon lookup in dashboard
            this.AttachDelegate("CommentaryTopicId", () => _engine.CurrentTopicId);

            // Seconds remaining until auto-clear (integer for clean display)
            this.AttachDelegate("CommentarySecondsRemaining", () => (int)Math.Round(_engine.SecondsRemaining));

            // Overlay color: category determines hue, severity determines opacity (#AARRGGBB)
            this.AttachDelegate("CommentarySentimentColor", () => _engine.CurrentSentimentColor);

            // WCAG-compliant text color — same shade as overlay, bright for readability (#AARRGGBB)
            this.AttachDelegate("CommentaryTextColor", () => _engine.CurrentTextColor);

            // Severity level (1-5) for the current prompt, 0 when no prompt visible.
            // Dashboard uses this to toggle per-severity background elements.
            this.AttachDelegate("CommentarySeverity", () => _engine.IsVisible ? _engine.CurrentSeverity : 0);

            // Track image URL (Creative Commons) — set when track-related commentary fires
            this.AttachDelegate("CommentaryTrackImage", () => _engine.CurrentTrackImage);

            // Car image URL (Creative Commons) — set when car/manufacturer-related commentary fires
            this.AttachDelegate("CommentaryCarImage", () => _engine.CurrentCarImage);

            // Flag state for Homebridge and dashboard — priority order, most urgent first.
            // All iRacing flags are now exposed so lights respond correctly.
            // "meatball" = repair required (iRacing 0x100000)
            // "orange" = car ahead is being blue-flagged for us (we are lapping them)
            this.AttachDelegate("CurrentFlagState", () =>
            {
                if (!_current.GameRunning) return "none";
                int f = _current.SessionFlags;
                if ((f & TelemetrySnapshot.FLAG_RED) != 0) return "red";
                if ((f & TelemetrySnapshot.FLAG_REPAIR) != 0) return "meatball";
                if ((f & TelemetrySnapshot.FLAG_BLACK) != 0) return "black";
                if ((f & TelemetrySnapshot.FLAG_YELLOW) != 0) return "yellow";
                if ((f & TelemetrySnapshot.FLAG_BLUE) != 0) return "blue";
                if ((f & TelemetrySnapshot.FLAG_DEBRIS) != 0) return "debris";
                if ((f & TelemetrySnapshot.FLAG_WHITE) != 0) return "white";
                if ((f & TelemetrySnapshot.FLAG_CHECKERED) != 0) return "checkered";
                if ((f & TelemetrySnapshot.FLAG_GREEN) != 0) return "green";
                // Orange flag: detect if we are lapping the car immediately ahead
                if (IsLappingCarAhead(_current)) return "orange";
                return "none";
            });

            // ── Demo mode flag — dashboard reads this to swap data sources ─────
            this.AttachDelegate("DemoMode", () => Settings.DemoMode ? 1 : 0);

            // ── Demo telemetry properties — populated by DemoTelemetryProvider ──
            // When DemoMode == 1, the dashboard reads these instead of GameData
            var dt = _engine.DemoTelemetry; // shorthand

            this.AttachDelegate("Demo.Gear", () => dt.Gear);
            this.AttachDelegate("Demo.Rpm", () => dt.Rpm);
            this.AttachDelegate("Demo.MaxRpm", () => dt.MaxRpm);
            this.AttachDelegate("Demo.SpeedMph", () => dt.SpeedMph);
            this.AttachDelegate("Demo.Throttle", () => dt.Throttle * 100); // 0-100 to match SimHub GameData
            this.AttachDelegate("Demo.Brake", () => dt.Brake * 100);
            this.AttachDelegate("Demo.Clutch", () => dt.Clutch * 100);
            this.AttachDelegate("Demo.Fuel", () => dt.Fuel);
            this.AttachDelegate("Demo.MaxFuel", () => dt.MaxFuel);
            this.AttachDelegate("Demo.FuelPerLap", () => dt.FuelPerLap);
            this.AttachDelegate("Demo.RemainingLaps", () => dt.RemainingLaps);
            this.AttachDelegate("Demo.TyreTempFL", () => dt.TyreTempFL);
            this.AttachDelegate("Demo.TyreTempFR", () => dt.TyreTempFR);
            this.AttachDelegate("Demo.TyreTempRL", () => dt.TyreTempRL);
            this.AttachDelegate("Demo.TyreTempRR", () => dt.TyreTempRR);
            this.AttachDelegate("Demo.TyreWearFL", () => dt.TyreWearFL);
            this.AttachDelegate("Demo.TyreWearFR", () => dt.TyreWearFR);
            this.AttachDelegate("Demo.TyreWearRL", () => dt.TyreWearRL);
            this.AttachDelegate("Demo.TyreWearRR", () => dt.TyreWearRR);
            this.AttachDelegate("Demo.BrakeBias", () => dt.BrakeBias);
            this.AttachDelegate("Demo.TC", () => dt.TC);
            this.AttachDelegate("Demo.ABS", () => dt.ABS);
            this.AttachDelegate("Demo.Position", () => dt.Position);
            this.AttachDelegate("Demo.CurrentLap", () => dt.CurrentLap);
            this.AttachDelegate("Demo.BestLapTime", () => dt.BestLapTime);
            this.AttachDelegate("Demo.CurrentLapTime", () => dt.CurrentLapTime);
            this.AttachDelegate("Demo.CarModel", () => dt.CarModel);
            this.AttachDelegate("Demo.SessionTime", () => dt.SessionTime);
            this.AttachDelegate("Demo.LastLapTime", () => dt.LastLapTime);
            this.AttachDelegate("Demo.RemainingTime", () => dt.RemainingTime);
            this.AttachDelegate("Demo.TotalLaps", () => dt.TotalLaps);
            this.AttachDelegate("Demo.IRating", () => dt.IRating);
            this.AttachDelegate("Demo.SafetyRating", () => dt.SafetyRating);
            this.AttachDelegate("Demo.GapAhead", () => dt.GapAhead);
            this.AttachDelegate("Demo.GapBehind", () => dt.GapBehind);
            this.AttachDelegate("Demo.DriverAhead", () => dt.DriverAhead);
            this.AttachDelegate("Demo.DriverBehind", () => dt.DriverBehind);
            this.AttachDelegate("Demo.IRAhead", () => dt.IRAhead);
            this.AttachDelegate("Demo.IRBehind", () => dt.IRBehind);

            // ── Track map properties — SVG path + car positions ────────────────
            this.AttachDelegate("TrackMap.Ready", () => _trackMap.IsReady ? 1 : 0);
            this.AttachDelegate("TrackMap.TrackName", () => _trackMap.TrackName ?? "");
            this.AttachDelegate("TrackMap.TrackSlug", () => _lastRawTrackSlug ?? "");
            this.AttachDelegate("TrackMap.SvgPath", () => _trackMap.SvgPath);
            this.AttachDelegate("TrackMap.PlayerX", () => _trackMap.PlayerX);
            this.AttachDelegate("TrackMap.PlayerY", () => _trackMap.PlayerY);
            this.AttachDelegate("TrackMap.Opponents", () => _trackMap.OpponentData);
            this.AttachDelegate("TrackMap.OpponentCount", () => _trackMap.OpponentCount);
            this.AttachDelegate("TrackMap.Recording", () => !_trackMap.IsReady ? 1 : 0);

            // Nearest car distance fraction for proximity-based lighting
            this.AttachDelegate("NearestCarDistance", () =>
            {
                if (!_current.GameRunning || _current.CarIdxLapDistPct == null || _current.CarIdxLapDistPct.Length == 0)
                    return 1.0;
                double playerPos = _current.TrackPositionPct;
                int playerIdx = _current.PlayerCarIdx;
                double minDist = 1.0;
                for (int i = 0; i < _current.CarIdxLapDistPct.Length; i++)
                {
                    if (i == playerIdx) continue;
                    double otherPos = _current.CarIdxLapDistPct[i];
                    if (otherPos <= 0) continue;
                    double delta = Math.Abs(playerPos - otherPos);
                    delta = Math.Min(delta, 1.0 - delta);
                    if (delta < minDist) minDist = delta;
                }
                return minDist;
            });

            // ── Incident Coach properties ─────────────────────────────────────
            this.AttachDelegate("DS.IncidentCoach.Active", () => _incidentCoach?.Enabled == true ? 1 : 0);
            this.AttachDelegate("DS.IncidentCoach.LastIncidentLap", () => _incidentCoach?.LastIncidentLap ?? 0);
            this.AttachDelegate("DS.IncidentCoach.ThreatDrivers", () => _incidentCoach?.ThreatDriversJson ?? "[]");
            this.AttachDelegate("DS.IncidentCoach.ActiveAlert", () => _incidentCoach?.ActiveAlertJson ?? "{}");
            this.AttachDelegate("DS.IncidentCoach.RageScore", () => (int)(_incidentCoach?.RageScore ?? 0));
            this.AttachDelegate("DS.IncidentCoach.CooldownActive", () => _incidentCoach?.IsCooldownActive == true ? 1 : 0);
            this.AttachDelegate("DS.IncidentCoach.SessionBehavior", () => _incidentCoach?.SessionBehaviorJson ?? "{}");

            // ── Actions ───────────────────────────────────────────────────────

            // Pitbox wheel button actions — bind in SimHub Control Mapper
            this.AddAction("RaceCorProDrive.CyclePitboxTab", (a, b) => { _pitboxTabCycle++; });
            this.AddAction("RaceCorProDrive.CyclePitboxTabBack", (a, b) => { _pitboxTabCycleBack++; });
            this.AddAction("RaceCorProDrive.PitboxNext", (a, b) => { _pitboxNext++; });
            this.AddAction("RaceCorProDrive.PitboxPrev", (a, b) => { _pitboxPrev++; });
            this.AddAction("RaceCorProDrive.PitboxIncrement", (a, b) => { _pitboxIncrement++; });
            this.AddAction("RaceCorProDrive.PitboxDecrement", (a, b) => { _pitboxDecrement++; });
            this.AddAction("RaceCorProDrive.PitboxToggle", (a, b) => { _pitboxToggle++; });

            // Incident Coach cool-down action
            this.AddAction("RaceCorProDrive.TriggerCooldown", (a, b) => _incidentCoach?.TriggerManualCooldown());

            // Expose pitbox counters so dashboard can detect changes
            this.AttachDelegate("DS.PitboxTabCycle", () => _pitboxTabCycle);
            this.AttachDelegate("DS.PitboxTabCycleBack", () => _pitboxTabCycleBack);
            this.AttachDelegate("DS.PitboxNext", () => _pitboxNext);
            this.AttachDelegate("DS.PitboxPrev", () => _pitboxPrev);
            this.AttachDelegate("DS.PitboxIncrement", () => _pitboxIncrement);
            this.AttachDelegate("DS.PitboxDecrement", () => _pitboxDecrement);
            this.AttachDelegate("DS.PitboxToggle", () => _pitboxToggle);

            // ── Events ────────────────────────────────────────────────────────
            this.AddEvent("NewCommentaryPrompt");

            // Show a brief placeholder so the dashboard is visible before any game starts
            _engine.ShowDemoPrompt();

            // Start local HTTP server for Homebridge integration
            StartHttpServer();

            // Start WebSocket server for overlay (port 8890, PR 5 migrates to 8889)
            try
            {
                _wsServer = new Transport.WsServer(8890, "/racecor");
                _wsServer.Start();
                _wsPublisher = new Transport.WsTelemetryPublisher(_wsServer);
                SimHub.Logging.Current.Info("[RaceCorProDrive] WebSocket telemetry server started on port 8890");
            }
            catch (Exception ex)
            {
                SimHub.Logging.Current.Warn($"[RaceCorProDrive] WebSocket server failed to start: {ex.Message}");
                _wsServer = null;
                _wsPublisher = null;
            }

            SimHub.Logging.Current.Info("[RaceCorProDrive] Initialisation complete");
        }

        /// <summary>
        /// Detect if the player is lapping the car immediately ahead.
        /// Returns true when the nearest car ahead has fewer completed laps
        /// AND is within ~3s gap — meaning they should be yielding (blue flag for them).
        /// The dashboard shows this as an "orange flag" so the player knows the car
        /// ahead is being told to let them through.
        /// </summary>
        private static bool IsLappingCarAhead(TelemetrySnapshot s)
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

        public void DataUpdate(PluginManager pluginManager, ref GameData data)
        {
            // Capture current telemetry every frame (cheap snapshot)
            _previous = _current;
            _current = TelemetrySnapshot.Capture(pluginManager, ref data);

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
                string trackId = GetTrackId(pluginManager);
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
                    SimHub.Logging.Current.Warn($"[RaceCorProDrive] WebSocket telemetry tick failed: {ex.Message}");
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
                else if (_current.GameRunning && data.NewData != null)
                    _leaderboardJson = BuildLeaderboard(data.NewData, _current.Position);
                else
                    _leaderboardJson = "[]";
            }
            catch (Exception ex)
            {
                SimHub.Logging.Current.Warn($"[RaceCorProDrive] Leaderboard build failed: {ex.Message}");
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
                this.TriggerEvent("NewCommentaryPrompt");
        }

        public void End(PluginManager pluginManager)
        {
            _sdkBridge.Stop();
            _screenColorSampler.Dispose();
            _mozaSerial?.Dispose();
            _incidentCoach?.End();
            StopHttpServer();
            _wsServer?.Stop();
            this.SaveCommonSettings("GeneralSettings", Settings);
            SimHub.Logging.Current.Info("[RaceCorProDrive] Plugin stopped, settings saved");
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

        private string BuildDisplayText()
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

        private string GetTrackId(PluginManager pm)
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
                SimHub.Logging.Current.Warn($"[RaceCorProDrive] Track ID lookup failed: {ex.Message}");
            }
            return _current.GameName ?? "";
        }

        /// <summary>
        /// Build leaderboard JSON from SimHub's Opponents list.
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
                SimHub.Logging.Current.Warn($"[RaceCorProDrive] Opponent parsing failed: {ex.Message}");
                return "[]";
            }
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

        private void StartHttpServer()
        {
            // Try binding in order of preference:
            // 1. Wildcard (*) — works if SimHub runs as admin or URL ACL is registered
            // 2. localhost only — always works without admin, sufficient for local overlays
            string[] prefixes = new[]
            {
                "http://*:8889/racecor-io-pro-drive/",
                "http://localhost:8889/racecor-io-pro-drive/"
            };

            foreach (var prefix in prefixes)
            {
                try
                {
                    _httpListener = new HttpListener();
                    _httpListener.Prefixes.Add(prefix);
                    _httpListener.Start();
                    _httpThread = new Thread(HttpServerLoop) { IsBackground = true, Name = "RaceCorProDrive-HTTP" };
                    _httpThread.Start();
                    SimHub.Logging.Current.Info($"[RaceCorProDrive] HTTP state server listening on port 8889 (prefix: {prefix})");
                    return;
                }
                catch (Exception ex)
                {
                    SimHub.Logging.Current.Warn($"[RaceCorProDrive] HTTP server failed with prefix {prefix}: {ex.Message}");
                    try { _httpListener?.Close(); }
                    catch (Exception closeEx)
                    {
                        SimHub.Logging.Current.Warn($"[RaceCorProDrive] HTTP listener close failed: {closeEx.Message}");
                    }
                    _httpListener = null;
                }
            }

            SimHub.Logging.Current.Warn("[RaceCorProDrive] HTTP server could not start on any prefix — dashboard overlay will not receive data");
        }

        private void StopHttpServer()
        {
            try { _httpListener?.Stop(); }
            catch (Exception ex)
            {
                SimHub.Logging.Current.Warn($"[RaceCorProDrive] HTTP listener stop failed: {ex.Message}");
            }
        }

        private void HttpServerLoop()
        {
            var ic = System.Globalization.CultureInfo.InvariantCulture;

            while (_httpListener != null && _httpListener.IsListening)
            {
                HttpListenerContext ctx;
                try { ctx = _httpListener.GetContext(); }
                catch (Exception ex)
                {
                    SimHub.Logging.Current.Warn($"[RaceCorProDrive] HTTP context get failed: {ex.Message}");
                    break;
                }

                try
                {
                    // Handle CORS preflight
                    // Electron 33+ (Chromium 130+) enforces Private Network Access:
                    // file:// → localhost requires Access-Control-Allow-Private-Network
                    if (ctx.Request.HttpMethod == "OPTIONS")
                    {
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
                        ctx.Response.Headers.Add("Access-Control-Allow-Headers", "Content-Type");
                        ctx.Response.Headers.Add("Access-Control-Allow-Private-Network", "true");
                        ctx.Response.StatusCode = 204;
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    // ── Handle action endpoints ──────────────────────────────
                    string rawUrl = ctx.Request.RawUrl ?? "";

                    // Extract action from query string
                    string action = "";
                    int qIdx = rawUrl.IndexOf("action=");
                    if (qIdx >= 0)
                    {
                        int start = qIdx + 7; // "action=".Length
                        int end = rawUrl.IndexOf('&', start);
                        action = end >= 0 ? rawUrl.Substring(start, end - start) : rawUrl.Substring(start);
                    }

                    if (action == "resetmap")
                    {
                        _trackMap.ResetTrackMap();
                        byte[] okBytes = System.Text.Encoding.UTF8.GetBytes("{\"ok\":true}");
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(okBytes, 0, okBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    if (action == "listtracks")
                    {
                        var ids = _trackMap.GetBundledTrackIds();
                        string json = "[" + string.Join(",", ids.ConvertAll(id => "\"" + id.Replace("\"", "\\\"") + "\"")) + "]";
                        byte[] listBytes = System.Text.Encoding.UTF8.GetBytes(json);
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(listBytes, 0, listBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    if (action == "restartdemo")
                    {
                        _engine.DemoTelemetry.Reset();
                        byte[] okBytes = System.Text.Encoding.UTF8.GetBytes("{\"ok\":true}");
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(okBytes, 0, okBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    // ── Ambient capture rect — dashboard sends the region via query params ──
                    if (action == "setrect")
                    {
                        try
                        {
                            // Parse x, y, w, h from query string (ratios 0-1)
                            var qs = ctx.Request.QueryString;
                            double rx = double.Parse(qs["x"] ?? "0", ic);
                            double ry = double.Parse(qs["y"] ?? "0", ic);
                            double rw = double.Parse(qs["w"] ?? "0", ic);
                            double rh = double.Parse(qs["h"] ?? "0", ic);
                            if (rw > 0.01 && rh > 0.01)
                            {
                                _screenColorSampler.SetRect(rx, ry, rw, rh);
                                SimHub.Logging.Current.Info(
                                    $"[RaceCorProDrive] Ambient rect set: x={rx:F3} y={ry:F3} w={rw:F3} h={rh:F3}");
                            }
                        }
                        catch (Exception ex)
                        {
                            SimHub.Logging.Current.Warn($"[RaceCorProDrive] setrect error: {ex.Message}");
                        }
                        byte[] okBytes = System.Text.Encoding.UTF8.GetBytes("{\"ok\":true}");
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(okBytes, 0, okBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    // ── Pedal profile actions ──────────────────────────────────
                    if (action == "listPedalProfiles" && _pedalProfiles != null)
                    {
                        string json = _pedalProfiles.GetProfileListJson();
                        byte[] listBytes = System.Text.Encoding.UTF8.GetBytes(json);
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(listBytes, 0, listBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    if (action == "setPedalProfile" && _pedalProfiles != null)
                    {
                        var qs = ctx.Request.QueryString;
                        string profileId = qs["id"] ?? "";
                        if (!string.IsNullOrEmpty(profileId))
                            _pedalProfiles.SetActiveProfile(profileId);
                        byte[] okBytes = System.Text.Encoding.UTF8.GetBytes("{\"ok\":true}");
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(okBytes, 0, okBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    if (action == "bindPedalProfile" && _pedalProfiles != null)
                    {
                        var qs = ctx.Request.QueryString;
                        string profileId = qs["id"] ?? "";
                        string carModel = qs["car"] ?? _lastCarModel;
                        if (!string.IsNullOrEmpty(profileId) && !string.IsNullOrEmpty(carModel))
                            _pedalProfiles.BindProfileToCar(profileId, carModel, carModel);
                        byte[] okBytes = System.Text.Encoding.UTF8.GetBytes("{\"ok\":true}");
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(okBytes, 0, okBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    if (action == "importMozaPedals" && _pedalProfiles != null)
                    {
                        var imported = _pedalProfiles.ImportFromMoza();
                        string json = imported != null
                            ? "{\"ok\":true,\"name\":\"" + (imported.Name ?? "").Replace("\"", "\\\"") + "\"}"
                            : "{\"ok\":false,\"error\":\"Moza Pithouse not detected or no config found\"}";
                        if (imported != null)
                            _pedalProfiles.SaveProfile(imported);
                        byte[] resultBytes = System.Text.Encoding.UTF8.GetBytes(json);
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(resultBytes, 0, resultBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    // ── Moza direct hardware actions ──────────────────────────
                    if (action == "listMozaDevices" && _mozaSerial != null)
                    {
                        string json = _mozaSerial.GetDeviceListJson();
                        byte[] listBytes = System.Text.Encoding.UTF8.GetBytes(json);
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(listBytes, 0, listBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    if (action == "getMozaWheelbaseSettings" && _mozaSerial != null)
                    {
                        string json = _mozaSerial.GetWheelbaseSettingsJson();
                        byte[] resultBytes = System.Text.Encoding.UTF8.GetBytes(json);
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(resultBytes, 0, resultBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    if (action == "setMozaWheelbaseSetting" && _mozaSerial != null)
                    {
                        var qs = ctx.Request.QueryString;
                        string key = qs["key"] ?? "";
                        string val = qs["value"] ?? "";
                        bool ok = ApplyMozaWheelbaseSetting(key, val);
                        byte[] okBytes = System.Text.Encoding.UTF8.GetBytes(ok ? "{\"ok\":true}" : "{\"ok\":false,\"error\":\"Invalid key or value\"}");
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(okBytes, 0, okBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    if (action == "getMozaPedalSettings" && _mozaSerial != null)
                    {
                        string json = _mozaSerial.GetPedalSettingsJson();
                        byte[] resultBytes = System.Text.Encoding.UTF8.GetBytes(json);
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(resultBytes, 0, resultBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    if (action == "setMozaPedalSetting" && _mozaSerial != null)
                    {
                        var qs = ctx.Request.QueryString;
                        string key = qs["key"] ?? "";
                        string val = qs["value"] ?? "";
                        bool ok = ApplyMozaPedalSetting(key, val);
                        byte[] okBytes = System.Text.Encoding.UTF8.GetBytes(ok ? "{\"ok\":true}" : "{\"ok\":false,\"error\":\"Invalid key or value\"}");
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(okBytes, 0, okBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    if (action == "getMozaHandbrakeSettings" && _mozaSerial != null)
                    {
                        string json = _mozaSerial.GetHandbrakeSettingsJson();
                        byte[] resultBytes = System.Text.Encoding.UTF8.GetBytes(json);
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(resultBytes, 0, resultBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    if (action == "setMozaHandbrakeSetting" && _mozaSerial != null)
                    {
                        var qs = ctx.Request.QueryString;
                        string key = qs["key"] ?? "";
                        string val = qs["value"] ?? "";
                        bool ok = ApplyMozaHandbrakeSetting(key, val);
                        byte[] okBytes = System.Text.Encoding.UTF8.GetBytes(ok ? "{\"ok\":true}" : "{\"ok\":false,\"error\":\"Invalid key or value\"}");
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(okBytes, 0, okBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    if (action == "getMozaShifterSettings" && _mozaSerial != null)
                    {
                        string json = _mozaSerial.GetShifterSettingsJson();
                        byte[] resultBytes = System.Text.Encoding.UTF8.GetBytes(json);
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(resultBytes, 0, resultBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    if (action == "getMozaDashboardSettings" && _mozaSerial != null)
                    {
                        string json = _mozaSerial.GetDashboardSettingsJson();
                        byte[] resultBytes = System.Text.Encoding.UTF8.GetBytes(json);
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(resultBytes, 0, resultBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    if (action == "getMozaWheelSettings" && _mozaSerial != null)
                    {
                        string json = _mozaSerial.GetWheelSettingsJson();
                        byte[] resultBytes = System.Text.Encoding.UTF8.GetBytes(json);
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(resultBytes, 0, resultBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    if (action == "mozaRefresh" && _mozaSerial != null)
                    {
                        _mozaSerial.ForceRefresh();
                        byte[] okBytes = System.Text.Encoding.UTF8.GetBytes("{\"ok\":true}");
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(okBytes, 0, okBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    if (action == "mozaReconnect" && _mozaSerial != null)
                    {
                        _mozaSerial.ForceRediscovery();
                        byte[] okBytes = System.Text.Encoding.UTF8.GetBytes("{\"ok\":true}");
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(okBytes, 0, okBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    if (action == "listSerialPortDiagnostic" && _mozaSerial != null)
                    {
                        string json = _mozaSerial.GetSerialPortDiagnosticJson();
                        byte[] resultBytes = System.Text.Encoding.UTF8.GetBytes(json);
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(resultBytes, 0, resultBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    // ── iRacing Data API — career history import ─────────────
                    if (action == "iracingImport")
                    {
                        // Run on a background thread to avoid blocking the HTTP server
                        string resultJson;
                        try
                        {
                            // Try local cookies first, then fall back to stored credentials
                            if (!_iracingData.IsAuthenticated)
                            {
                                _iracingData.TryLoadLocalCookies();
                            }

                            // If still not authenticated, try stored credentials from settings
                            if (!_iracingData.IsAuthenticated
                                && !string.IsNullOrEmpty(Settings.IRacingEmail)
                                && !string.IsNullOrEmpty(Settings.IRacingPassword))
                            {
                                _iracingData.Authenticate(Settings.IRacingEmail, Settings.IRacingPassword);
                            }

                            if (!_iracingData.IsAuthenticated)
                            {
                                resultJson = "{\"ok\":false,\"error\":\"Not authenticated to iRacing. "
                                    + "Make sure iRacing is running and you're logged in, "
                                    + "or add your iRacing email and password in plugin settings.\"}";
                            }
                            else
                            {
                                var career = _iracingData.ExportFullCareer();
                                if (career != null)
                                {
                                    resultJson = "{\"ok\":true,\"data\":" + career.ToString(Newtonsoft.Json.Formatting.None) + "}";
                                }
                                else
                                {
                                    resultJson = "{\"ok\":false,\"error\":\"" + Escape(_iracingData.LastError ?? "Export failed") + "\"}";
                                }
                            }
                        }
                        catch (Exception ex)
                        {
                            SimHub.Logging.Current.Error($"[RaceCorProDrive] iRacing import error: {ex}");
                            resultJson = "{\"ok\":false,\"error\":\"" + Escape(ex.Message) + "\"}";
                        }

                        byte[] importBytes = Encoding.UTF8.GetBytes(resultJson);
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(importBytes, 0, importBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    // ── iRacing Data API — latest recent races (post-race delta) ──
                    if (action == "iracingLatest")
                    {
                        string resultJson;
                        try
                        {
                            if (!_iracingData.IsAuthenticated)
                            {
                                _iracingData.TryLoadLocalCookies();
                            }
                            if (!_iracingData.IsAuthenticated
                                && !string.IsNullOrEmpty(Settings.IRacingEmail)
                                && !string.IsNullOrEmpty(Settings.IRacingPassword))
                            {
                                _iracingData.Authenticate(Settings.IRacingEmail, Settings.IRacingPassword);
                            }

                            if (!_iracingData.IsAuthenticated)
                            {
                                resultJson = "{\"ok\":false,\"error\":\"Not authenticated to iRacing.\"}";
                            }
                            else
                            {
                                var memberInfo = _iracingData.GetMemberInfo();
                                int custId = memberInfo?.Value<int>("cust_id") ?? 0;
                                string displayName = memberInfo?.Value<string>("display_name") ?? "";

                                var recentRaces = _iracingData.GetRecentRaces(custId);

                                var payload = new Newtonsoft.Json.Linq.JObject
                                {
                                    ["custId"] = custId,
                                    ["displayName"] = displayName,
                                    ["recentRaces"] = recentRaces,
                                    ["fetchedAt"] = DateTime.UtcNow.ToString("o")
                                };

                                resultJson = "{\"ok\":true,\"data\":" + payload.ToString(Newtonsoft.Json.Formatting.None) + "}";
                            }
                        }
                        catch (Exception ex)
                        {
                            SimHub.Logging.Current.Error($"[RaceCorProDrive] iRacing latest fetch error: {ex}");
                            resultJson = "{\"ok\":false,\"error\":\"" + Escape(ex.Message) + "\"}";
                        }

                        byte[] latestBytes = Encoding.UTF8.GetBytes(resultJson);
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(latestBytes, 0, latestBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    // ── Week Planner — cached season schedule for next-race-ideas ──
                    if (action == "weekPlanner")
                    {
                        string resultJson;
                        try
                        {
                            if (_weekPlannerCache != null && (DateTime.UtcNow - _weekPlannerCacheTime) < WeekPlannerCacheDuration)
                            {
                                resultJson = "{\"ok\":true,\"cached\":true,\"data\":" + _weekPlannerCache.ToString(Newtonsoft.Json.Formatting.None) + "}";
                            }
                            else
                            {
                                if (!_iracingData.IsAuthenticated)
                                {
                                    _iracingData.TryLoadLocalCookies();
                                }
                                if (!_iracingData.IsAuthenticated
                                    && !string.IsNullOrEmpty(Settings.IRacingEmail)
                                    && !string.IsNullOrEmpty(Settings.IRacingPassword))
                                {
                                    _iracingData.Authenticate(Settings.IRacingEmail, Settings.IRacingPassword);
                                }

                                if (!_iracingData.IsAuthenticated)
                                {
                                    resultJson = "{\"ok\":false,\"error\":\"Not authenticated to iRacing.\"}";
                                }
                                else
                                {
                                    var seasons = _iracingData.GetSeasonSchedule();
                                    _weekPlannerCache = seasons;
                                    _weekPlannerCacheTime = DateTime.UtcNow;
                                    resultJson = "{\"ok\":true,\"cached\":false,\"data\":" + seasons.ToString(Newtonsoft.Json.Formatting.None) + "}";
                                }
                            }
                        }
                        catch (Exception ex)
                        {
                            SimHub.Logging.Current.Error($"[RaceCorProDrive] weekPlanner fetch error: {ex}");
                            resultJson = "{\"ok\":false,\"error\":\"" + Escape(ex.Message) + "\"}";
                        }

                        byte[] wpBytes = Encoding.UTF8.GetBytes(resultJson);
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.Headers.Add("Access-Control-Allow-Private-Network", "true");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(wpBytes, 0, wpBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    // ── iRacing auth — direct login with email/password ──────
                    if (action == "iracingAuth")
                    {
                        string authResultJson;
                        try
                        {
                            var qs = ctx.Request.QueryString;
                            string email = qs["email"] ?? "";
                            string password = qs["password"] ?? "";

                            if (string.IsNullOrEmpty(email) || string.IsNullOrEmpty(password))
                            {
                                authResultJson = "{\"ok\":false,\"error\":\"Email and password required\"}";
                            }
                            else if (_iracingData.Authenticate(email, password))
                            {
                                // Persist credentials so future sessions auto-authenticate
                                Settings.IRacingEmail = email;
                                Settings.IRacingPassword = password;
                                authResultJson = "{\"ok\":true}";
                            }
                            else
                            {
                                authResultJson = "{\"ok\":false,\"error\":\"" + Escape(_iracingData.LastError ?? "Auth failed") + "\"}";
                            }
                        }
                        catch (Exception ex)
                        {
                            authResultJson = "{\"ok\":false,\"error\":\"" + Escape(ex.Message) + "\"}";
                        }

                        byte[] authBytes = Encoding.UTF8.GetBytes(authResultJson);
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(authBytes, 0, authBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    // ── iRacing auth status ──────────────────────────────────
                    if (action == "iracingStatus")
                    {
                        string statusJson = "{\"authenticated\":" + (_iracingData.IsAuthenticated ? "true" : "false") + "}";
                        byte[] statusBytes = Encoding.UTF8.GetBytes(statusJson);
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                        ctx.Response.StatusCode = 200;
                        ctx.Response.OutputStream.Write(statusBytes, 0, statusBytes.Length);
                        ctx.Response.OutputStream.Close();
                        continue;
                    }

                    // ── Build complete state snapshot ────────────────────────
                    var s = _current; // snapshot reference (safe — replaced atomically in DataUpdate)
                    var dt = _engine.DemoTelemetry;
                    bool demo = Settings.DemoMode;

                    // Flag state — demo flags take priority when in demo mode
                    string flagState = "none";
                    {
                        int f = 0;
                        if (demo && _engine.CurrentDemoFlags != 0)
                            f = _engine.CurrentDemoFlags;
                        else if (s.GameRunning)
                            f = s.SessionFlags;
                        if ((f & TelemetrySnapshot.FLAG_RED) != 0) flagState = "red";
                        else if ((f & TelemetrySnapshot.FLAG_REPAIR) != 0) flagState = "meatball";
                        else if ((f & TelemetrySnapshot.FLAG_BLACK) != 0) flagState = "black";
                        else if ((f & TelemetrySnapshot.FLAG_YELLOW) != 0) flagState = "yellow";
                        else if ((f & TelemetrySnapshot.FLAG_BLUE) != 0) flagState = "blue";
                        else if ((f & TelemetrySnapshot.FLAG_DEBRIS) != 0) flagState = "debris";
                        else if ((f & TelemetrySnapshot.FLAG_WHITE) != 0) flagState = "white";
                        else if ((f & TelemetrySnapshot.FLAG_CHECKERED) != 0) flagState = "checkered";
                        else if ((f & TelemetrySnapshot.FLAG_GREEN) != 0) flagState = "green";
                        else if (!demo && IsLappingCarAhead(s)) flagState = "orange";
                    }

                    // Nearest car distance
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

                    // Commentary state
                    string cat = _engine.CurrentCategory ?? "";
                    string label = _engine.CurrentSentimentLabel ?? "";
                    string category = string.IsNullOrEmpty(label) ? cat : cat + " \u2014 " + label;

                    // Build JSON — flat key-value map matching PROP_KEYS the dashboard expects
                    var sb = new StringBuilder(2048);
                    sb.Append("{\n");

                    // ── Game data (live telemetry from snapshot) ──
                    // Demo mode always reports as iRacing so the dashboard enables
                    // all features (track map, iRating, incidents, etc.) without
                    // requiring a live game connection or Discord gating.
                    Jp(sb, "DataCorePlugin.GameRunning", (demo || s.GameRunning) ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.GameId", demo ? "iRacing" : Escape(s.GameName ?? ""));
                    Jp(sb, "RaceCorProDrive.Plugin.SessionTypeName", Escape(s.SessionTypeName ?? ""));
                    Jp(sb, "DataCorePlugin.GameData.Gear", Escape(s.Gear ?? "N"));
                    Jp(sb, "DataCorePlugin.GameData.Rpms", s.Rpms, ic);
                    Jp(sb, "DataCorePlugin.GameData.CarSettings_MaxRPM", s.MaxRpm, ic);
                    Jp(sb, "DataCorePlugin.GameData.SpeedMph", s.SpeedKmh * 0.621371, ic);
                    Jp(sb, "DataCorePlugin.GameData.Throttle", s.Throttle, ic);
                    Jp(sb, "DataCorePlugin.GameData.Brake", s.Brake, ic);
                    Jp(sb, "DataCorePlugin.GameData.Clutch", s.Clutch, ic);
                    Jp(sb, "DataCorePlugin.GameData.Fuel", s.FuelLevel, ic);
                    double fuelPct = Math.Max(0.01, Math.Min(1.0, s.FuelPercent));
                    Jp(sb, "DataCorePlugin.GameData.MaxFuel", s.FuelLevel > 0 ? s.FuelLevel / fuelPct : 0, ic);
                    Jp(sb, "DataCorePlugin.Computed.Fuel_LitersPerLap", s.FuelPerLap, ic);
                    Jp(sb, "DataCorePlugin.GameData.RemainingLaps", s.RemainingLaps, ic);
                    Jp(sb, "DataCorePlugin.GameData.TyreTempFrontLeft", s.TyreTempFL, ic);
                    Jp(sb, "DataCorePlugin.GameData.TyreTempFrontRight", s.TyreTempFR, ic);
                    Jp(sb, "DataCorePlugin.GameData.TyreTempRearLeft", s.TyreTempRL, ic);
                    Jp(sb, "DataCorePlugin.GameData.TyreTempRearRight", s.TyreTempRR, ic);
                    Jp(sb, "DataCorePlugin.GameData.TyreWearFrontLeft", s.TyreWearFL, ic);
                    Jp(sb, "DataCorePlugin.GameData.TyreWearFrontRight", s.TyreWearFR, ic);
                    Jp(sb, "DataCorePlugin.GameData.TyreWearRearLeft", s.TyreWearRL, ic);
                    Jp(sb, "DataCorePlugin.GameData.TyreWearRearRight", s.TyreWearRR, ic);
                    Jp(sb, "DataCorePlugin.GameRawData.Telemetry.dcBrakeBias", s.BrakeBias, ic);
                    Jp(sb, "DataCorePlugin.GameRawData.Telemetry.dcTractionControl", s.TractionControlSetting, ic);
                    Jp(sb, "DataCorePlugin.GameRawData.Telemetry.dcABS", s.AbsSetting, ic);
                    Jp(sb, "DataCorePlugin.GameRawData.Telemetry.dcAntiRollFront", s.ArbFront, ic);
                    Jp(sb, "DataCorePlugin.GameRawData.Telemetry.dcAntiRollRear", s.ArbRear, ic);
                    // Additional car adjustments
                    Jp(sb, "DataCorePlugin.GameRawData.Telemetry.dcEnginePower", s.EnginePower, ic);
                    Jp(sb, "DataCorePlugin.GameRawData.Telemetry.dcFuelMixture", s.FuelMixture, ic);
                    Jp(sb, "DataCorePlugin.GameRawData.Telemetry.dcWeightJackerLeft", s.WeightJackerLeft, ic);
                    Jp(sb, "DataCorePlugin.GameRawData.Telemetry.dcWeightJackerRight", s.WeightJackerRight, ic);
                    Jp(sb, "DataCorePlugin.GameRawData.Telemetry.dcWingFront", s.WingFront, ic);
                    Jp(sb, "DataCorePlugin.GameRawData.Telemetry.dcWingRear", s.WingRear, ic);
                    // Pit stop selections
                    Jp(sb, "RaceCorProDrive.Plugin.PitBox.PitSvFlags", s.PitSvFlags);
                    Jp(sb, "RaceCorProDrive.Plugin.PitBox.PitSvFuel", s.PitSvFuel, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.PitBox.PitSvLFP", s.PitSvLFP, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.PitBox.PitSvRFP", s.PitSvRFP, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.PitBox.PitSvLRP", s.PitSvLRP, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.PitBox.PitSvRRP", s.PitSvRRP, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.PitBox.TireCompound", s.PitSvTireCompound);
                    Jp(sb, "RaceCorProDrive.Plugin.PitBox.FastRepair", s.PitSvFastRepair);
                    Jp(sb, "RaceCorProDrive.Plugin.PitBox.Windshield", s.PitSvWindshieldTearoff);
                    // Pit box computed display strings
                    Jp(sb, "RaceCorProDrive.Plugin.PitBox.TireLF", s.PitTireLF ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.PitBox.TireRF", s.PitTireRF ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.PitBox.TireLR", s.PitTireLR ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.PitBox.TireRR", s.PitTireRR ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.PitBox.TiresRequested", s.PitTiresRequested ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.PitBox.FuelRequested", s.PitFuelRequested ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.PitBox.FastRepairRequested", s.PitFastRepairRequested ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.PitBox.WindshieldRequested", s.PitWindshieldRequested ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.PitBox.FuelDisplay", Escape(s.PitFuelDisplay));
                    Jp(sb, "RaceCorProDrive.Plugin.PitBox.PressureLF", Escape(s.PitPressureLFDisplay));
                    Jp(sb, "RaceCorProDrive.Plugin.PitBox.PressureRF", Escape(s.PitPressureRFDisplay));
                    Jp(sb, "RaceCorProDrive.Plugin.PitBox.PressureLR", Escape(s.PitPressureLRDisplay));
                    Jp(sb, "RaceCorProDrive.Plugin.PitBox.PressureRR", Escape(s.PitPressureRRDisplay));
                    // Car-specific adjustment availability
                    Jp(sb, "RaceCorProDrive.Plugin.PitBox.HasTC", s.HasTC ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.PitBox.HasABS", s.HasABS ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.PitBox.HasARBFront", s.HasARBFront ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.PitBox.HasARBRear", s.HasARBRear ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.PitBox.HasEnginePower", s.HasEnginePower ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.PitBox.HasFuelMixture", s.HasFuelMixture ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.PitBox.HasWeightJackerL", s.HasWeightJackerL ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.PitBox.HasWeightJackerR", s.HasWeightJackerR ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.PitBox.HasWingFront", s.HasWingFront ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.PitBox.HasWingRear", s.HasWingRear ? 1 : 0);
                    Jp(sb, "DataCorePlugin.GameData.Position", s.Position);
                    Jp(sb, "DataCorePlugin.GameData.CurrentLap", s.CurrentLap);
                    Jp(sb, "DataCorePlugin.GameData.BestLapTime", s.LapBestTime, ic);
                    Jp(sb, "DataCorePlugin.GameData.CurrentLapTime", s.LapCurrentTime, ic);
                    Jp(sb, "DataCorePlugin.GameData.LastLapTime", s.LapLastTime, ic);
                    // Estimate session elapsed: current lap time + completed laps × average lap
                    double avgLap = s.LapBestTime > 0 ? s.LapBestTime : (s.LapLastTime > 0 ? s.LapLastTime : 90);
                    double sessionElapsed = s.LapCurrentTime + s.CompletedLaps * avgLap;
                    Jp(sb, "DataCorePlugin.GameData.SessionTimeSpan", sessionElapsed, ic);
                    Jp(sb, "DataCorePlugin.GameData.RemainingTime", s.SessionTimeRemain, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.SessionLapsRemaining", s.SessionLapsRemaining);
                    Jp(sb, "DataCorePlugin.GameData.TotalLaps", s.SessionLapsTotal);
                    Jp(sb, "DataCorePlugin.GameData.CarModel", Escape(s.CarModel ?? ""));

                    // ── Session summary for web dashboard ──
                    Jp(sb, "RaceCorProDrive.Plugin.Session.Mode", (int)s.SessionMode);
                    Jp(sb, "RaceCorProDrive.Plugin.Session.ModeName", Escape(s.SessionMode.ToString()));
                    Jp(sb, "RaceCorProDrive.Plugin.Session.IsLapRace", s.IsLapRace ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.Session.TrackName", Escape(s.TrackName ?? ""));
                    Jp(sb, "RaceCorProDrive.Plugin.Session.LapsTotal", s.SessionLapsTotal);
                    Jp(sb, "RaceCorProDrive.Plugin.Session.LapsRemaining", s.SessionLapsRemaining);
                    Jp(sb, "RaceCorProDrive.Plugin.Session.TimeRemaining", s.SessionTimeRemain, ic);
                    Jp(sb, "IRacingExtraProperties.iRacing_DriverInfo_IRating", s.IRating);
                    Jp(sb, "IRacingExtraProperties.iRacing_DriverInfo_SafetyRating", s.SafetyRating, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.EstimatedIRatingDelta", s.EstimatedIRatingDelta);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.IRatingFieldSize", s.IRatingFieldSize);
                    Jp(sb, "IRacingExtraProperties.iRacing_Opponent_Ahead_Gap", s.GapAhead, ic);
                    Jp(sb, "IRacingExtraProperties.iRacing_Opponent_Behind_Gap", s.GapBehind, ic);
                    Jp(sb, "IRacingExtraProperties.iRacing_Opponent_Ahead_Name", Escape(s.NearestAheadName ?? ""));
                    Jp(sb, "IRacingExtraProperties.iRacing_Opponent_Behind_Name", Escape(s.NearestBehindName ?? ""));
                    Jp(sb, "IRacingExtraProperties.iRacing_Opponent_Ahead_IRating", s.NearestAheadRating);
                    Jp(sb, "IRacingExtraProperties.iRacing_Opponent_Behind_IRating", s.NearestBehindRating);

                    // ── Datastream (advanced physics/performance) ──
                    Jp(sb, "RaceCorProDrive.Plugin.DS.LatG", s.LatAccel, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.LongG", s.LongAccel, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.YawRate", s.YawRate, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.SteerTorque", s.SteeringWheelTorque, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.TrackTemp", s.TrackTemp, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.AirTemp", s.AirTemp, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.WeatherWet", s.WeatherWet ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.DisplayUnits", s.DisplayUnits);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.PitboxTabCycle", _pitboxTabCycle);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.PitboxTabCycleBack", _pitboxTabCycleBack);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.PitboxNext", _pitboxNext);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.PitboxPrev", _pitboxPrev);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.PitboxIncrement", _pitboxIncrement);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.PitboxDecrement", _pitboxDecrement);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.PitboxToggle", _pitboxToggle);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.IncidentCount", s.IncidentCount);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.IncidentLimitPenalty", s.IncidentLimitPenalty);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.IncidentLimitDQ", s.IncidentLimitDQ);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.LicenseString", Escape(s.LicenseString ?? ""));
                    Jp(sb, "RaceCorProDrive.Plugin.DS.AbsActive", s.AbsActive ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.TcActive", s.TcActive ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.TrackPct", s.TrackPositionPct, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.LapDelta", s.LapDeltaToBest, ic);
                    // Sector splits (legacy 3-sector + N-sector)
                    Jp(sb, "RaceCorProDrive.Plugin.DS.CurrentSector", s.CurrentSector);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.SectorCount", s.SectorCount);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.SectorSplitS1", s.SectorSplitS1, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.SectorSplitS2", s.SectorSplitS2, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.SectorSplitS3", s.SectorSplitS3, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.SectorDeltaS1", s.SectorDeltaS1, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.SectorDeltaS2", s.SectorDeltaS2, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.SectorDeltaS3", s.SectorDeltaS3, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.SectorStateS1", s.SectorStateS1);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.SectorStateS2", s.SectorStateS2);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.SectorStateS3", s.SectorStateS3);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.SectorS2StartPct", s.SectorS2StartPct, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.SectorS3StartPct", s.SectorS3StartPct, ic);
                    // Extended individual sector properties (S4+) for dashboards expecting SectorSplitS{n}
                    if (s.SectorSplits != null && s.SectorSplits.Length > 3)
                    {
                        for (int si = 3; si < s.SectorSplits.Length; si++)
                        {
                            int sn = si + 1; // 1-based sector number
                            Jp(sb, "RaceCorProDrive.Plugin.DS.SectorSplitS" + sn, s.SectorSplits[si], ic);
                            Jp(sb, "RaceCorProDrive.Plugin.DS.SectorDeltaS" + sn, s.SectorDeltas[si], ic);
                            Jp(sb, "RaceCorProDrive.Plugin.DS.SectorStateS" + sn, s.SectorStates[si]);
                        }
                    }
                    // N-sector arrays (always sent — dashboard handles any sector count)
                    if (s.SectorSplits != null)
                    {
                        sb.Append("\"RaceCorProDrive.Plugin.DS.SectorSplits\":\"");
                        for (int si = 0; si < s.SectorSplits.Length; si++)
                        { if (si > 0) sb.Append(','); sb.Append(s.SectorSplits[si].ToString("F3", ic)); }
                        sb.Append("\",");
                        sb.Append("\"RaceCorProDrive.Plugin.DS.SectorDeltas\":\"");
                        for (int si = 0; si < s.SectorDeltas.Length; si++)
                        { if (si > 0) sb.Append(','); sb.Append(s.SectorDeltas[si].ToString("F3", ic)); }
                        sb.Append("\",");
                        sb.Append("\"RaceCorProDrive.Plugin.DS.SectorStates\":\"");
                        for (int si = 0; si < s.SectorStates.Length; si++)
                        { if (si > 0) sb.Append(','); sb.Append(s.SectorStates[si]); }
                        sb.Append("\",");
                        sb.Append("\"RaceCorProDrive.Plugin.DS.SectorBests\":\"");
                        if (s.SectorBests != null)
                        {
                            for (int si = 0; si < s.SectorBests.Length; si++)
                            { if (si > 0) sb.Append(','); sb.Append(s.SectorBests[si].ToString("F3", ic)); }
                        }
                        sb.Append("\",");
                        sb.Append("\"RaceCorProDrive.Plugin.DS.SectorBoundaryPcts\":\"");
                        if (s.SectorBoundaries != null)
                        {
                            for (int si = 0; si < s.SectorBoundaries.Length; si++)
                            { if (si > 0) sb.Append(','); sb.Append(s.SectorBoundaries[si].ToString("F6", ic)); }
                        }
                        sb.Append("\",");
                    }
                    Jp(sb, "RaceCorProDrive.Plugin.DS.CompletedLaps", s.CompletedLaps);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.IsInPitLane", s.IsInPitLane ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.SpeedKmh", s.SpeedKmh, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.PitLimiterOn", s.PitLimiterOn ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.PitSpeedLimitKmh", s.PitSpeedLimitKmh, ic);

                    // ── Computed DS.* — server-side calculations ──
                    Jp(sb, "RaceCorProDrive.Plugin.DS.ThrottleNorm", s.ThrottleNorm, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.BrakeNorm", s.BrakeNorm, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.ClutchNorm", s.ClutchNorm, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.RpmRatio", s.RpmRatio, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.FuelPct", s.FuelPct, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.FuelLapsRemaining", s.FuelLapsRemaining, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.SpeedMph", s.SpeedMph, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.PitSpeedLimitMph", s.PitSpeedLimitMph, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.IsPitSpeeding", s.IsPitSpeeding ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.IsNonRaceSession", s.IsNonRaceSession ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.SessionMode", (int)s.SessionMode);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.SessionModeName", Escape(s.SessionMode.ToString()));
                    Jp(sb, "RaceCorProDrive.Plugin.DS.IsLapRace", s.IsLapRace ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.IsLapInvalid", s.IsLapInvalid ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.IsTimedRace", s.IsTimedRace ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.IsEndOfRace", s.IsEndOfRace ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.PositionDelta", s.PositionDelta);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.StartPosition", s.StartPosition);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.RemainingTimeFormatted", Escape(s.RemainingTimeFormatted ?? ""));
                    Jp(sb, "RaceCorProDrive.Plugin.DS.SpeedDisplay", Escape(s.SpeedDisplay));
                    Jp(sb, "RaceCorProDrive.Plugin.DS.RpmDisplay", Escape(s.RpmDisplay));
                    Jp(sb, "RaceCorProDrive.Plugin.DS.FuelFormatted", Escape(s.FuelFormatted));
                    Jp(sb, "RaceCorProDrive.Plugin.DS.FuelPerLapFormatted", Escape(s.FuelPerLapFormatted));
                    Jp(sb, "RaceCorProDrive.Plugin.DS.PitSuggestion", Escape(s.PitSuggestion ?? ""));
                    Jp(sb, "RaceCorProDrive.Plugin.DS.BBNorm", s.BBNorm, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.TCNorm", s.TCNorm, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.ABSNorm", s.ABSNorm, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.PositionDeltaDisplay", Escape(s.PositionDeltaDisplay ?? ""));
                    Jp(sb, "RaceCorProDrive.Plugin.DS.LapDeltaDisplay", Escape(s.LapDeltaDisplay ?? ""));
                    Jp(sb, "RaceCorProDrive.Plugin.DS.SafetyRatingDisplay", Escape(s.SafetyRatingDisplay));
                    Jp(sb, "RaceCorProDrive.Plugin.DS.GapAheadFormatted", Escape(s.GapAheadFormatted));
                    Jp(sb, "RaceCorProDrive.Plugin.DS.GapBehindFormatted", Escape(s.GapBehindFormatted));

                    Jp(sb, "DataCorePlugin.GameRawData.Telemetry.FrameRate", s.FrameRate, ic);
                    Jp(sb, "DataCorePlugin.GameRawData.Telemetry.SteeringWheelAngle", s.SteeringWheelAngle, ic);

                    // ── Commentary ──
                    Jp(sb, "RaceCorProDrive.Plugin.CommentaryVisible", _engine.IsVisible ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.CommentaryText", Escape(_engine.CurrentText ?? ""));
                    Jp(sb, "RaceCorProDrive.Plugin.CommentaryTopicTitle", Escape(_engine.CurrentTitle ?? ""));
                    Jp(sb, "RaceCorProDrive.Plugin.CommentaryTopicId", Escape(_engine.CurrentTopicId ?? ""));
                    Jp(sb, "RaceCorProDrive.Plugin.CommentaryCategory", Escape(category));
                    Jp(sb, "RaceCorProDrive.Plugin.CommentarySentimentColor", Escape(_engine.CurrentSentimentColor ?? "#FF000000"));
                    Jp(sb, "RaceCorProDrive.Plugin.CommentarySeverity", _engine.IsVisible ? _engine.CurrentSeverity : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.CommentaryTrackImage", Escape(_engine.CurrentTrackImage ?? ""));
                    Jp(sb, "RaceCorProDrive.Plugin.CommentaryCarImage", Escape(_engine.CurrentCarImage ?? ""));

                    // ── Strategy ──
                    Jp(sb, "RaceCorProDrive.Plugin.Strategy.Visible", _strategy.IsVisible ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.Strategy.Text", Escape(_strategy.CurrentText ?? ""));
                    Jp(sb, "RaceCorProDrive.Plugin.Strategy.Label", Escape(_strategy.CurrentLabel ?? ""));
                    Jp(sb, "RaceCorProDrive.Plugin.Strategy.Severity", _strategy.CurrentSeverity);
                    Jp(sb, "RaceCorProDrive.Plugin.Strategy.Color", Escape(Engine.Strategy.StrategyCoordinator.StrategyColor));
                    Jp(sb, "RaceCorProDrive.Plugin.Strategy.TextColor", Escape(Engine.Strategy.StrategyCoordinator.StrategyTextColor));
                    Jp(sb, "RaceCorProDrive.Plugin.Strategy.FuelLapsRemaining", _strategy.Fuel.FuelLapsRemaining, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Strategy.FuelHealthState", _strategy.Fuel.FuelHealthState);
                    Jp(sb, "RaceCorProDrive.Plugin.Strategy.CanMakeItToEnd", _strategy.Fuel.CanMakeItToEnd ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.Strategy.PitWindowOpen", _strategy.Fuel.PitWindowOpen);
                    Jp(sb, "RaceCorProDrive.Plugin.Strategy.PitWindowClose", _strategy.Fuel.PitWindowClose);
                    Jp(sb, "RaceCorProDrive.Plugin.Strategy.TireHealthState", _strategy.Tires.TireHealthState);
                    Jp(sb, "RaceCorProDrive.Plugin.Strategy.TireLapsRemaining", _strategy.Tires.EstimatedLapsRemaining, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Strategy.GripScore", _strategy.Tires.GripScore, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Strategy.StintNumber", _strategy.StintCount);
                    Jp(sb, "RaceCorProDrive.Plugin.Strategy.StintLaps", _strategy.CurrentStint != null ? _strategy.CurrentStint.LapsCompleted : 0);

                    // ── Incident Coach ──
                    Jp(sb, "RaceCorProDrive.Plugin.DS.IncidentCoach.Active", _incidentCoach.Enabled ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.IncidentCoach.LastIncidentLap", _incidentCoach.LastIncidentLap);
                    // Raw JSON objects — NOT string-escaped, injected directly
                    sb.AppendFormat("  \"RaceCorProDrive.Plugin.DS.IncidentCoach.ThreatDrivers\":{0},\n", _incidentCoach.ThreatDriversJson ?? "[]");
                    sb.AppendFormat("  \"RaceCorProDrive.Plugin.DS.IncidentCoach.ActiveAlert\":{0},\n", _incidentCoach.ActiveAlertJson ?? "{}");
                    Jp(sb, "RaceCorProDrive.Plugin.DS.IncidentCoach.RageScore", _incidentCoach.RageScore, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.IncidentCoach.CooldownActive", _incidentCoach.IsCooldownActive ? 1 : 0);
                    sb.AppendFormat("  \"RaceCorProDrive.Plugin.DS.IncidentCoach.SessionBehavior\":{0},\n", _incidentCoach.SessionBehaviorJson ?? "{}");

                    // ── Demo mode ──
                    Jp(sb, "RaceCorProDrive.Plugin.DemoMode", demo ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.Gear", Escape(dt.Gear ?? "N"));
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.Rpm", dt.Rpm, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.MaxRpm", dt.MaxRpm, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.SpeedMph", dt.SpeedMph, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.Throttle", dt.Throttle * 100, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.Brake", dt.Brake * 100, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.Clutch", dt.Clutch * 100, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.Fuel", dt.Fuel, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.MaxFuel", dt.MaxFuel, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.FuelPerLap", dt.FuelPerLap, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.RemainingLaps", dt.RemainingLaps, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.TyreTempFL", dt.TyreTempFL, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.TyreTempFR", dt.TyreTempFR, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.TyreTempRL", dt.TyreTempRL, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.TyreTempRR", dt.TyreTempRR, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.TyreWearFL", dt.TyreWearFL, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.TyreWearFR", dt.TyreWearFR, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.TyreWearRL", dt.TyreWearRL, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.TyreWearRR", dt.TyreWearRR, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.BrakeBias", dt.BrakeBias, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.TC", dt.TC, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.ABS", dt.ABS, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.SessionTypeName", Escape(dt.SessionTypeName ?? ""));
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.SessionMode", (int)dt.SessionMode);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.SessionModeName", Escape(dt.SessionMode.ToString()));
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.Position", dt.Position);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.CurrentLap", dt.CurrentLap);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.BestLapTime", dt.BestLapTime, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.CurrentLapTime", dt.CurrentLapTime, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.CarModel", Escape(dt.CarModel ?? ""));
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.SessionTime", dt.SessionTime, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.LastLapTime", dt.LastLapTime, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.RemainingTime", dt.RemainingTime, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.TotalLaps", dt.TotalLaps);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.IRating", dt.IRating);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.SafetyRating", dt.SafetyRating, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.GapAhead", dt.GapAhead, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.GapBehind", dt.GapBehind, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DriverAhead", Escape(dt.DriverAhead ?? ""));
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DriverBehind", Escape(dt.DriverBehind ?? ""));
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.IRAhead", dt.IRAhead);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.IRBehind", dt.IRBehind);

                    // ── Demo Datastream ──
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.LatG", dt.LatG, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.LongG", dt.LongG, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.YawRate", dt.YawRate, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.SteerTorque", dt.SteerTorque, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.TrackTemp", dt.TrackTemp, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.IncidentCount", dt.IncidentCount);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.AbsActive", dt.AbsActive ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.TcActive", dt.TcActive ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.LapDelta", dt.LapDelta, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.IsInPitLane", dt.IsInPitLane ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.SessionMode", (int)dt.SessionMode);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.SessionModeName", Escape(dt.SessionMode.ToString()));
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.IsLapRace", dt.IsLapRace ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.IsLapInvalid", dt.IsLapInvalid ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.SectorBests", "");
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.SpeedKmh", dt.SpeedKmh, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.PitLimiterOn", dt.IsInPitLane ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.PitSpeedLimitKmh", 72.0, ic);

                    // ── Demo Computed DS.* ──
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.ThrottleNorm", dt.ThrottleNorm, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.BrakeNorm", dt.BrakeNorm, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.ClutchNorm", dt.ClutchNorm, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.RpmRatio", dt.RpmRatio, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.FuelPct", dt.FuelPct, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.FuelLapsRemaining", dt.FuelLapsRemaining, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.SpeedMph", dt.SpeedMph, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.PitSpeedLimitMph", dt.PitSpeedLimitMph, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.IsPitSpeeding", dt.IsPitSpeeding ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.IsNonRaceSession", dt.IsNonRaceSession ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.IsTimedRace", dt.IsTimedRace ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.IsEndOfRace", dt.IsEndOfRace ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.PositionDelta", dt.PositionDelta);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.StartPosition", dt.StartPosition);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.RemainingTimeFormatted", Escape(dt.RemainingTimeFormatted ?? ""));
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.SpeedDisplay", Escape(dt.SpeedDisplay));
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.RpmDisplay", Escape(dt.RpmDisplay));
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.FuelFormatted", Escape(dt.FuelFormatted));
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.FuelPerLapFormatted", Escape(dt.FuelPerLapFormatted));
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.PitSuggestion", Escape(dt.PitSuggestion ?? ""));
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.BBNorm", dt.BBNorm, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.TCNorm", dt.TCNorm, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.ABSNorm", dt.ABSNorm, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.PositionDeltaDisplay", Escape(dt.PositionDeltaDisplay ?? ""));
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.LapDeltaDisplay", Escape(dt.LapDeltaDisplay ?? ""));
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.SafetyRatingDisplay", Escape(dt.SafetyRatingDisplay));
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.GapAheadFormatted", Escape(dt.GapAheadFormatted));
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.DS.GapBehindFormatted", Escape(dt.GapBehindFormatted));

                    // ── Grid / Formation state ──
                    Jp(sb, "RaceCorProDrive.Plugin.Grid.SessionState", s.SessionState);
                    Jp(sb, "RaceCorProDrive.Plugin.Grid.GriddedCars", s.GriddedCars);
                    Jp(sb, "RaceCorProDrive.Plugin.Grid.TotalCars", s.TotalCars);
                    Jp(sb, "RaceCorProDrive.Plugin.Grid.PaceMode", s.PaceMode);
                    // Start type: read from iRacing WeekendOptions via shared memory
                    Jp(sb, "RaceCorProDrive.Plugin.Grid.StartType", Escape(s.IsStandingStart ? "standing" : "rolling"));
                    // Lights phase: synthesized from PaceMode/SessionState transitions
                    Jp(sb, "RaceCorProDrive.Plugin.Grid.LightsPhase", _lightsPhase);
                    Jp(sb, "RaceCorProDrive.Plugin.Grid.TrackCountry", Escape(s.TrackCountry ?? ""));

                    // ── Demo Grid state ──
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.Grid.SessionState", dt.SessionState);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.Grid.GriddedCars", dt.GriddedCars);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.Grid.TotalCars", dt.TotalCars);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.Grid.PaceMode", dt.PaceMode);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.Grid.LightsPhase", dt.LightsPhase);
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.Grid.StartType", Escape(dt.IsStandingStart ? "standing" : "rolling"));
                    Jp(sb, "RaceCorProDrive.Plugin.Demo.Grid.TrackCountry", Escape(dt.TrackCountry ?? ""));

                    // ── Driver name (for leaderboard display) ──
                    // Prefer live player name from game data; fall back to settings
                    string livePlayerName = s.PlayerName ?? "";
                    if (!string.IsNullOrEmpty(livePlayerName))
                    {
                        // Split "First Last" into first/last for dashboard display
                        var nameParts = livePlayerName.Trim().Split(new[] { ' ' }, 2);
                        Jp(sb, "RaceCorProDrive.Plugin.DriverFirstName", Escape(nameParts[0]));
                        Jp(sb, "RaceCorProDrive.Plugin.DriverLastName", Escape(nameParts.Length > 1 ? nameParts[1] : ""));
                    }
                    else
                    {
                        Jp(sb, "RaceCorProDrive.Plugin.DriverFirstName", Escape(Settings.DriverFirstName ?? ""));
                        Jp(sb, "RaceCorProDrive.Plugin.DriverLastName", Escape(Settings.DriverLastName ?? ""));
                    }

                    // ── Track map ──
                    Jp(sb, "RaceCorProDrive.Plugin.TrackMap.Ready", _trackMap.IsReady ? 1 : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.TrackMap.TrackName", Escape(_trackMap.TrackName ?? ""));
                    Jp(sb, "RaceCorProDrive.Plugin.TrackMap.TrackSlug", Escape(_lastRawTrackSlug ?? ""));
                    Jp(sb, "RaceCorProDrive.Plugin.TrackMap.SvgPath", Escape(_trackMap.SvgPath ?? ""));
                    Jp(sb, "RaceCorProDrive.Plugin.TrackMap.PlayerX", _trackMap.PlayerX, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.TrackMap.PlayerY", _trackMap.PlayerY, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.TrackMap.PlayerHeading", _trackMap.PlayerHeadingDeg, ic);
                    Jp(sb, "RaceCorProDrive.Plugin.TrackMap.Opponents", Escape(_trackMap.OpponentData ?? ""));

                    // ── Leaderboard ──
                    // Raw JSON array — NOT string-escaped, injected directly
                    sb.AppendFormat("\"RaceCorProDrive.Plugin.Leaderboard\":{0},\n", _leaderboardJson ?? "[]");

                    // ── Extra (homebridge / legacy) ──
                    Jp(sb, "currentFlagState", Escape(flagState));
                    Jp(sb, "nearestCarDistance", nearestDist, ic);

                    // ── Ambient light — screen color sampled by ScreenColorSampler ──
                    Jp(sb, "RaceCorProDrive.Plugin.DS.AmbientR", _screenColorSampler.HasColor ? _screenColorSampler.R : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.AmbientG", _screenColorSampler.HasColor ? _screenColorSampler.G : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.AmbientB", _screenColorSampler.HasColor ? _screenColorSampler.B : 0);
                    Jp(sb, "RaceCorProDrive.Plugin.DS.AmbientHasData", _screenColorSampler.HasColor ? 1 : 0);

                    // ── Moza hardware summary ──
                    if (_mozaSerial != null)
                    {
                        _mozaSerial.AppendPollSummary(sb, Jp, Jp);
                    }

                    // ── Pedal profile curves (for dashboard visualization) ──
                    if (_pedalProfiles != null)
                    {
                        sb.AppendFormat("\"RaceCorProDrive.Plugin.DS.PedalProfile\":{0},\n",
                            _pedalProfiles.GetDashboardJson());
                    }

                    // Remove trailing comma and close
                    if (sb.Length > 2 && sb[sb.Length - 2] == ',')
                        sb.Remove(sb.Length - 2, 1); // remove last comma
                    sb.Append("}");

                    byte[] buf = Encoding.UTF8.GetBytes(sb.ToString());
                    ctx.Response.ContentType = "application/json";
                    ctx.Response.ContentLength64 = buf.Length;
                    ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                    ctx.Response.OutputStream.Write(buf, 0, buf.Length);
                }
                catch (Exception ex)
                {
                    SimHub.Logging.Current.Warn($"[RaceCorProDrive] HTTP handler error: {ex.Message}");
                }
                finally
                {
                    try { ctx.Response.OutputStream.Close(); }
                    catch (Exception ex)
                    {
                        SimHub.Logging.Current.Warn($"[RaceCorProDrive] Response output stream close failed: {ex.Message}");
                    }
                }
            }
        }

        // JSON property helpers — avoid pulling in Newtonsoft for a simple flat map
        private static void Jp(StringBuilder sb, string key, int val)
            => sb.Append($"  \"{key}\": {val},\n");
        private static void Jp(StringBuilder sb, string key, double val, System.Globalization.CultureInfo ic)
            => sb.Append($"  \"{key}\": {val.ToString("G", ic)},\n");
        private static void Jp(StringBuilder sb, string key, string val)
            => sb.Append($"  \"{key}\": \"{val}\",\n");

        private static string Escape(string s) =>
            s?.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", "\\n").Replace("\r", "") ?? "";

        private string ResolveTopicsPath()
        {
            if (!string.IsNullOrEmpty(Settings.TopicsFilePath) && File.Exists(Settings.TopicsFilePath))
                return Settings.TopicsFilePath;
            return ResolveDatasetFile("commentary_topics.json");
        }

        private string ResolveDatasetFile(string filename)
        {
            string dllDir = Path.GetDirectoryName(typeof(Plugin).Assembly.Location) ?? "";
            string candidate = Path.Combine(dllDir, "racecorprodrive-data", filename);
            if (File.Exists(candidate)) return candidate;

            string pluginsData = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
                "SimHub", "PluginsData", "RaceCorProDrive", filename);
            if (File.Exists(pluginsData)) return pluginsData;

            SimHub.Logging.Current.Warn($"[RaceCorProDrive] {filename} not found in racecorprodrive-data folder");
            return "";
        }

        // ═══════════════════════════════════════════════════════════════
        //  MOZA HARDWARE — HTTP SETTING WRITE HELPERS
        // ═══════════════════════════════════════════════════════════════

        /// <summary>
        /// Parses a key/value pair and writes the corresponding wheelbase setting.
        /// Keys match the property names in MozaWheelbaseSettings.
        /// </summary>
        private bool ApplyMozaWheelbaseSetting(string key, string valueStr)
        {
            if (_mozaSerial == null || string.IsNullOrEmpty(key)) return false;
            if (!int.TryParse(valueStr, out int value)) return false;

            byte deviceId = MozaDeviceRegistry.DeviceWheelbase;
            switch (key.ToLowerInvariant())
            {
                case "ffbstrength": _mozaSerial.WriteSetting(deviceId, MozaDeviceRegistry.WheelbaseCmd.FfbStrength, (byte)value); return true;
                case "maxtorque": _mozaSerial.WriteSetting(deviceId, MozaDeviceRegistry.WheelbaseCmd.MaxTorque, (byte)value); return true;
                case "roadsensitivity": _mozaSerial.WriteSetting(deviceId, MozaDeviceRegistry.WheelbaseCmd.RoadSensitivity, (byte)value); return true;
                case "speeddamping": _mozaSerial.WriteSetting(deviceId, MozaDeviceRegistry.WheelbaseCmd.SpeedDamping, (byte)value); return true;
                case "minrotationangle": _mozaSerial.WriteSetting16(deviceId, MozaDeviceRegistry.WheelbaseCmd.MinRotationAngle, (ushort)value); return true;
                case "maxrotationangle": _mozaSerial.WriteSetting16(deviceId, MozaDeviceRegistry.WheelbaseCmd.MaxRotationAngle, (ushort)value); return true;
                case "softlock": _mozaSerial.WriteSetting(deviceId, MozaDeviceRegistry.WheelbaseCmd.SoftLock, (byte)value); return true;
                case "friction": _mozaSerial.WriteSetting(deviceId, MozaDeviceRegistry.WheelbaseCmd.Friction, (byte)value); return true;
                case "spring": _mozaSerial.WriteSetting(deviceId, MozaDeviceRegistry.WheelbaseCmd.Spring, (byte)value); return true;
                case "damper": _mozaSerial.WriteSetting(deviceId, MozaDeviceRegistry.WheelbaseCmd.Damper, (byte)value); return true;
                case "inertia": _mozaSerial.WriteSetting(deviceId, MozaDeviceRegistry.WheelbaseCmd.Inertia, (byte)value); return true;
                case "tempprotection": _mozaSerial.WriteSetting(deviceId, MozaDeviceRegistry.WheelbaseCmd.TempProtection, (byte)value); return true;
                case "handsoffprotection": _mozaSerial.WriteSetting(deviceId, MozaDeviceRegistry.WheelbaseCmd.HandsOffProtection, (byte)value); return true;
                default: return false;
            }
        }

        /// <summary>
        /// Parses a key/value pair and writes the corresponding pedal setting.
        /// Key format: "{axis}.{setting}" e.g., "throttle.deadzone", "brake.curveY3"
        /// </summary>
        private bool ApplyMozaPedalSetting(string key, string valueStr)
        {
            if (_mozaSerial == null || string.IsNullOrEmpty(key)) return false;
            if (!int.TryParse(valueStr, out int value)) return false;

            var parts = key.Split('.');
            if (parts.Length != 2) return false;

            MozaDeviceRegistry.PedalAxis axis;
            switch (parts[0].ToLowerInvariant())
            {
                case "throttle": axis = MozaDeviceRegistry.PedalAxis.Throttle; break;
                case "brake": axis = MozaDeviceRegistry.PedalAxis.Brake; break;
                case "clutch": axis = MozaDeviceRegistry.PedalAxis.Clutch; break;
                default: return false;
            }

            byte deviceId = MozaDeviceRegistry.DevicePedals;
            byte offset;
            bool isTwoByte = false;
            switch (parts[1].ToLowerInvariant())
            {
                case "calibrationmin": offset = MozaDeviceRegistry.PedalCmd.CalibrationMin; isTwoByte = true; break;
                case "calibrationmax": offset = MozaDeviceRegistry.PedalCmd.CalibrationMax; isTwoByte = true; break;
                case "deadzone": offset = MozaDeviceRegistry.PedalCmd.Deadzone; break;
                case "curvey1": offset = MozaDeviceRegistry.PedalCmd.CurveY1; break;
                case "curvey2": offset = MozaDeviceRegistry.PedalCmd.CurveY2; break;
                case "curvey3": offset = MozaDeviceRegistry.PedalCmd.CurveY3; break;
                case "curvey4": offset = MozaDeviceRegistry.PedalCmd.CurveY4; break;
                case "curvey5": offset = MozaDeviceRegistry.PedalCmd.CurveY5; break;
                case "hidsource": offset = MozaDeviceRegistry.PedalCmd.HidSource; break;
                default: return false;
            }

            byte cmdId = MozaDeviceRegistry.PedalCmd.GetCommand(axis, offset);
            if (isTwoByte)
                _mozaSerial.WriteSetting16(deviceId, cmdId, (ushort)value);
            else
                _mozaSerial.WriteSetting(deviceId, cmdId, (byte)value);
            return true;
        }

        /// <summary>
        /// Parses a key/value pair and writes the corresponding handbrake setting.
        /// </summary>
        private bool ApplyMozaHandbrakeSetting(string key, string valueStr)
        {
            if (_mozaSerial == null || string.IsNullOrEmpty(key)) return false;
            if (!int.TryParse(valueStr, out int value)) return false;

            byte deviceId = MozaDeviceRegistry.DeviceHandbrake;
            switch (key.ToLowerInvariant())
            {
                case "calibrationmin": _mozaSerial.WriteSetting16(deviceId, MozaDeviceRegistry.HandbrakeCmd.CalibrationMin, (ushort)value); return true;
                case "calibrationmax": _mozaSerial.WriteSetting16(deviceId, MozaDeviceRegistry.HandbrakeCmd.CalibrationMax, (ushort)value); return true;
                case "deadzone": _mozaSerial.WriteSetting(deviceId, MozaDeviceRegistry.HandbrakeCmd.Deadzone, (byte)value); return true;
                case "curvey1": _mozaSerial.WriteSetting(deviceId, MozaDeviceRegistry.HandbrakeCmd.CurveY1, (byte)value); return true;
                case "curvey2": _mozaSerial.WriteSetting(deviceId, MozaDeviceRegistry.HandbrakeCmd.CurveY2, (byte)value); return true;
                case "curvey3": _mozaSerial.WriteSetting(deviceId, MozaDeviceRegistry.HandbrakeCmd.CurveY3, (byte)value); return true;
                case "curvey4": _mozaSerial.WriteSetting(deviceId, MozaDeviceRegistry.HandbrakeCmd.CurveY4, (byte)value); return true;
                case "curvey5": _mozaSerial.WriteSetting(deviceId, MozaDeviceRegistry.HandbrakeCmd.CurveY5, (byte)value); return true;
                case "buttonthreshold": _mozaSerial.WriteSetting(deviceId, MozaDeviceRegistry.HandbrakeCmd.ButtonThreshold, (byte)value); return true;
                case "outputmode": _mozaSerial.WriteSetting(deviceId, MozaDeviceRegistry.HandbrakeCmd.OutputMode, (byte)value); return true;
                default: return false;
            }
        }
    }
}
