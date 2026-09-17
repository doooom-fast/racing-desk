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
        public Settings Settings => _rt?.Settings;
        public PluginManager PluginManager { get; set; }

        public ImageSource PictureIcon => new BitmapImage(new Uri(
            "pack://application:,,,/RaceCorProDrive;component/icon.png"));
        public string LeftMenuTitle => "RaceCor.io Pro Drive";

#if CROSS_PLATFORM
        // Cross-platform build: settings panel excluded (no XAML compiler on Linux/macOS).
        // Return null — SimHub shows default settings when the plugin has no WPF panel.
        public System.Windows.Controls.Control GetWPFSettingsControl(PluginManager pluginManager) => null;
#endif

        // Host-agnostic engine + :8889/:8890 servers (RaceCor.Core). This class adapts SimHub to it.
        private ProDriveRuntime _rt;

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
            // RaceCor.Core logs through a host-agnostic facade; route it into SimHub's log.
            Log.Sink = (level, message) =>
            {
                if (level == Log.Level.Error) SimHub.Logging.Current.Error(message);
                else if (level == Log.Level.Warn) SimHub.Logging.Current.Warn(message);
                else SimHub.Logging.Current.Info(message);
            };

            SimHub.Logging.Current.Info("[RaceCorProDrive] Initialising RaceCorProDrive plugin");

            // Load settings
            var settings = this.ReadCommonSettings<Settings>("GeneralSettings", () => new Settings());

            // The plugin DLL is installed into the SimHub root, next to racecorprodrive-data\.
            _rt = new ProDriveRuntime(settings, new ProDriveRuntime.Options
            {
                AssemblyDirectory = Path.GetDirectoryName(typeof(Plugin).Assembly.Location) ?? "",
                PluginsDataDirectory = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
                    "SimHub", "PluginsData", "RaceCorProDrive"),
            });
            TelemetryCapture._sdkBridge = _rt._sdkBridge;
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
                if (ProDriveRuntime.IsLappingCarAhead(_rt._current)) return "orange";
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
            this.AttachDelegate("TrackMap.Recording", () => !_rt._trackMap.IsReady ? 1 : 0);

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
            this.AddAction("RaceCorProDrive.CyclePitboxTab", (a, b) => { _rt._pitboxTabCycle++; });
            this.AddAction("RaceCorProDrive.CyclePitboxTabBack", (a, b) => { _rt._pitboxTabCycleBack++; });
            this.AddAction("RaceCorProDrive.PitboxNext", (a, b) => { _rt._pitboxNext++; });
            this.AddAction("RaceCorProDrive.PitboxPrev", (a, b) => { _rt._pitboxPrev++; });
            this.AddAction("RaceCorProDrive.PitboxIncrement", (a, b) => { _rt._pitboxIncrement++; });
            this.AddAction("RaceCorProDrive.PitboxDecrement", (a, b) => { _rt._pitboxDecrement++; });
            this.AddAction("RaceCorProDrive.PitboxToggle", (a, b) => { _rt._pitboxToggle++; });

            // Incident Coach cool-down action
            this.AddAction("RaceCorProDrive.TriggerCooldown", (a, b) => _rt._incidentCoach?.TriggerManualCooldown());

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

            SimHub.Logging.Current.Info("[RaceCorProDrive] Initialisation complete");
        }

        public void DataUpdate(PluginManager pluginManager, ref GameData data)
        {
            var next = TelemetryCapture.Capture(pluginManager, ref data);
            var newData = data.NewData;
            _rt.Tick(
                next,
                () => GetTrackId(pluginManager),
                newData != null ? (Func<int, string>)(position => BuildLeaderboard(newData, position)) : null);
        }

        public void End(PluginManager pluginManager)
        {
            _rt.Stop();
            this.SaveCommonSettings("GeneralSettings", _rt.Settings);
            SimHub.Logging.Current.Info("[RaceCorProDrive] Plugin stopped, settings saved");
        }

        public void ApplySettings() => _rt?.ApplySettings();

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
                    if (!string.IsNullOrEmpty(slug)) _rt._lastRawTrackSlug = slug;
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
            return _rt._current.GameName ?? "";
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
                        pos, ProDriveRuntime.Escape(name), irating, best, last, gapToPlayer, inPit ? 1 : 0, isPlayer ? 1 : 0));
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
    }
}
