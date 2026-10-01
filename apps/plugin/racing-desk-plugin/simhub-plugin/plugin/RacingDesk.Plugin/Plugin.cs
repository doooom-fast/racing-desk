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
using RacingDesk.Plugin.Engine;
using RacingDesk.Plugin.Engine.Moza;
using SimHub.Plugins;

namespace RacingDesk.Plugin
{
    [PluginDescription("Broadcast-grade sim racing HUD with real-time telemetry, AI commentary, race strategy, WebGL effects, and HomeKit smart lighting.")]
    [PluginAuthor("The Racing Desk")]
    [PluginName("The Racing Desk")]
    public class Plugin : IPlugin, IDataPlugin, IWPFSettingsV2
    {
        public Settings Settings => _rt?.Settings;
        public PluginManager PluginManager { get; set; }

        public ImageSource PictureIcon => new BitmapImage(new Uri(
            "pack://application:,,,/RacingDesk;component/icon.png"));
        public string LeftMenuTitle => "The Racing Desk";

#if CROSS_PLATFORM
        // Cross-platform build: settings panel excluded (no XAML compiler on Linux/macOS).
        // Return null — SimHub shows default settings when the plugin has no WPF panel.
        public System.Windows.Controls.Control GetWPFSettingsControl(PluginManager pluginManager) => null;
#endif

        // Host-agnostic engine + :8889/:8890 servers (RacingDesk.Core). This class adapts SimHub to it.
        private RacingDeskRuntime _rt;
        private readonly SimHubTelemetrySource _source = new SimHubTelemetrySource();

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
            // RacingDesk.Core logs through a host-agnostic facade; route it into SimHub's log.
            Log.Sink = (level, message) =>
            {
                if (level == Log.Level.Error) SimHub.Logging.Current.Error(message);
                else if (level == Log.Level.Warn) SimHub.Logging.Current.Warn(message);
                else SimHub.Logging.Current.Info(message);
            };

            SimHub.Logging.Current.Info("[RacingDesk] Initialising RacingDesk plugin");

            // Load settings
            var settings = this.ReadCommonSettings<Settings>("GeneralSettings", () => new Settings());

            // The plugin DLL is installed into the SimHub root, next to racingdesk-data\. The track map's outlines
            // are the app's host's, asked over loopback: the plugin reads no file of the driver's and no store.
            _rt = new RacingDeskRuntime(settings, new RacingDeskRuntime.Options
            {
                AssemblyDirectory = Path.GetDirectoryName(typeof(Plugin).Assembly.Location) ?? "",
                PluginsDataDirectory = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
                    "SimHub", "PluginsData", "RacingDesk"),
                Outlines = new HostOutlineSource(settings.HostUrl),
                Host = "simhub",
            });
            _rt.NewCommentaryPrompt += () => this.TriggerEvent("NewCommentaryPrompt");

            // ── Register dashboard properties ─────────────────────────────────

            // The full commentary prompt text (or event exposition in event-only mode)
            this.AttachDelegate("CommentaryText", () => _rt.BuildDisplayText());

            // Boolean: whether the panel should be visible
            this.AttachDelegate("CommentaryVisible", () => _rt._engine.IsVisible ? 1 : 0);

            // Category with severity/sentiment label, e.g. "car_response — Urgent"
            this.AttachDelegate("CommentaryCategory", () =>
            {
                string cat = _rt._engine.CurrentCategory;
                string label = _rt._engine.CurrentSentimentLabel;
                return string.IsNullOrEmpty(label) ? cat : cat + " — " + label;
            });

            // Track position: sector + lap distance percentage
            this.AttachDelegate("CommentaryTrackPosition", () =>
            {
                if (!_rt._current.GameRunning) return "";
                int pct = (int)Math.Round(_rt._current.TrackPositionPct * 100);
                return $"Lap {_rt._current.CurrentLap} · {pct}%";
            });

            // Short topic title
            this.AttachDelegate("CommentaryTopicTitle", () => _rt._engine.CurrentTitle);

            // Topic ID (snake_case) for icon lookup in dashboard
            this.AttachDelegate("CommentaryTopicId", () => _rt._engine.CurrentTopicId);

            // Seconds remaining until auto-clear (integer for clean display)
            this.AttachDelegate("CommentarySecondsRemaining", () => (int)Math.Round(_rt._engine.SecondsRemaining));

            // Overlay color: category determines hue, severity determines opacity (#AARRGGBB)
            this.AttachDelegate("CommentarySentimentColor", () => _rt._engine.CurrentSentimentColor);

            // WCAG-compliant text color — same shade as overlay, bright for readability (#AARRGGBB)
            this.AttachDelegate("CommentaryTextColor", () => _rt._engine.CurrentTextColor);

            // Severity level (1-5) for the current prompt, 0 when no prompt visible.
            // Dashboard uses this to toggle per-severity background elements.
            this.AttachDelegate("CommentarySeverity", () => _rt._engine.IsVisible ? _rt._engine.CurrentSeverity : 0);

            // Track image URL (Creative Commons) — set when track-related commentary fires
            this.AttachDelegate("CommentaryTrackImage", () => _rt._engine.CurrentTrackImage);

            // Car image URL (Creative Commons) — set when car/manufacturer-related commentary fires
            this.AttachDelegate("CommentaryCarImage", () => _rt._engine.CurrentCarImage);

            // Flag state for Homebridge and dashboard — priority order, most urgent first.
            // All iRacing flags are now exposed so lights respond correctly.
            // "meatball" = repair required (iRacing 0x100000)
            // "orange" = car ahead is being blue-flagged for us (we are lapping them)
            this.AttachDelegate("CurrentFlagState", () =>
            {
                if (!_rt._current.GameRunning) return "none";
                int f = _rt._current.SessionFlags;
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
                if (RacingDeskRuntime.IsLappingCarAhead(_rt._current)) return "orange";
                return "none";
            });

            // ── Demo mode flag — dashboard reads this to swap data sources ─────
            this.AttachDelegate("DemoMode", () => Settings.DemoMode ? 1 : 0);

            // ── Demo telemetry properties — populated by DemoTelemetryProvider ──
            // When DemoMode == 1, the dashboard reads these instead of GameData
            var dt = _rt._engine.DemoTelemetry; // shorthand

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
            this.AttachDelegate("TrackMap.Ready", () => _rt._trackMap.IsReady ? 1 : 0);
            this.AttachDelegate("TrackMap.TrackName", () => _rt._trackMap.TrackName ?? "");
            this.AttachDelegate("TrackMap.TrackSlug", () => _rt._lastRawTrackSlug ?? "");
            this.AttachDelegate("TrackMap.SvgPath", () => _rt._trackMap.SvgPath);
            this.AttachDelegate("TrackMap.PlayerX", () => _rt._trackMap.PlayerX);
            this.AttachDelegate("TrackMap.PlayerY", () => _rt._trackMap.PlayerY);
            this.AttachDelegate("TrackMap.Opponents", () => _rt._trackMap.OpponentData);
            this.AttachDelegate("TrackMap.OpponentCount", () => _rt._trackMap.OpponentCount);
            // Why there is or is not a map: ready, crowd (drawn, on SimHub's shared map until his first clean lap),
            // first-lap (the host has no outline of this layout yet), no-host (the app is not running beside SimHub:
            // the maps are the app's), none.
            this.AttachDelegate("TrackMap.Status", () => _rt._trackMap.Status);

            // Nearest car distance fraction for proximity-based lighting
            this.AttachDelegate("NearestCarDistance", () =>
            {
                if (!_rt._current.GameRunning || _rt._current.CarIdxLapDistPct == null || _rt._current.CarIdxLapDistPct.Length == 0)
                    return 1.0;
                double playerPos = _rt._current.TrackPositionPct;
                int playerIdx = _rt._current.PlayerCarIdx;
                double minDist = 1.0;
                for (int i = 0; i < _rt._current.CarIdxLapDistPct.Length; i++)
                {
                    if (i == playerIdx) continue;
                    double otherPos = _rt._current.CarIdxLapDistPct[i];
                    if (otherPos <= 0) continue;
                    double delta = Math.Abs(playerPos - otherPos);
                    delta = Math.Min(delta, 1.0 - delta);
                    if (delta < minDist) minDist = delta;
                }
                return minDist;
            });

            // ── Incident Coach properties ─────────────────────────────────────
            this.AttachDelegate("DS.IncidentCoach.Active", () => _rt._incidentCoach?.Enabled == true ? 1 : 0);
            this.AttachDelegate("DS.IncidentCoach.LastIncidentLap", () => _rt._incidentCoach?.LastIncidentLap ?? 0);
            this.AttachDelegate("DS.IncidentCoach.ThreatDrivers", () => _rt._incidentCoach?.ThreatDriversJson ?? "[]");
            this.AttachDelegate("DS.IncidentCoach.ActiveAlert", () => _rt._incidentCoach?.ActiveAlertJson ?? "{}");
            this.AttachDelegate("DS.IncidentCoach.RageScore", () => (int)(_rt._incidentCoach?.RageScore ?? 0));
            this.AttachDelegate("DS.IncidentCoach.CooldownActive", () => _rt._incidentCoach?.IsCooldownActive == true ? 1 : 0);
            this.AttachDelegate("DS.IncidentCoach.SessionBehavior", () => _rt._incidentCoach?.SessionBehaviorJson ?? "{}");

            // ── Actions ───────────────────────────────────────────────────────

            // Pitbox wheel button actions — bind in SimHub Control Mapper
            this.AddAction("RacingDesk.CyclePitboxTab", (a, b) => { _rt._pitboxTabCycle++; });
            this.AddAction("RacingDesk.CyclePitboxTabBack", (a, b) => { _rt._pitboxTabCycleBack++; });
            this.AddAction("RacingDesk.PitboxNext", (a, b) => { _rt._pitboxNext++; });
            this.AddAction("RacingDesk.PitboxPrev", (a, b) => { _rt._pitboxPrev++; });
            this.AddAction("RacingDesk.PitboxIncrement", (a, b) => { _rt._pitboxIncrement++; });
            this.AddAction("RacingDesk.PitboxDecrement", (a, b) => { _rt._pitboxDecrement++; });
            this.AddAction("RacingDesk.PitboxToggle", (a, b) => { _rt._pitboxToggle++; });

            // Incident Coach cool-down action
            this.AddAction("RacingDesk.TriggerCooldown", (a, b) => _rt._incidentCoach?.TriggerManualCooldown());

            // Expose pitbox counters so dashboard can detect changes
            this.AttachDelegate("DS.PitboxTabCycle", () => _rt._pitboxTabCycle);
            this.AttachDelegate("DS.PitboxTabCycleBack", () => _rt._pitboxTabCycleBack);
            this.AttachDelegate("DS.PitboxNext", () => _rt._pitboxNext);
            this.AttachDelegate("DS.PitboxPrev", () => _rt._pitboxPrev);
            this.AttachDelegate("DS.PitboxIncrement", () => _rt._pitboxIncrement);
            this.AttachDelegate("DS.PitboxDecrement", () => _rt._pitboxDecrement);
            this.AttachDelegate("DS.PitboxToggle", () => _rt._pitboxToggle);

            // ── Events ────────────────────────────────────────────────────────
            this.AddEvent("NewCommentaryPrompt");

            _rt.Start();

            SimHub.Logging.Current.Info("[RacingDesk] Initialisation complete");
        }

        public void DataUpdate(PluginManager pluginManager, ref GameData data)
        {
            _source.PluginManager = pluginManager;
            _source.Data = data;
            _rt.Tick(_source);
        }

        public void End(PluginManager pluginManager)
        {
            _rt.Stop();
            this.SaveCommonSettings("GeneralSettings", _rt.Settings);
            SimHub.Logging.Current.Info("[RacingDesk] Plugin stopped, settings saved");
        }

        public void ApplySettings() => _rt?.ApplySettings();

    }
}
