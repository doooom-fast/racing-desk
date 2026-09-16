using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using RaceCorProDrive.Plugin.Models;
using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;

namespace RaceCorProDrive.Plugin.Engine
{
    /// <summary>
    /// Core commentary logic. Evaluates telemetry triggers, enforces cooldowns,
    /// selects prompts, manages severity-based interruption, and controls the
    /// display lifecycle.
    /// </summary>
    public class CommentaryEngine
    {
        // ── Category → color mapping ────────────────────────────────────────
        // Color encodes event TYPE (category). Avoids all flag colors:
        // red, yellow/amber, blue, orange, black.
        private static readonly Dictionary<string, string> CategoryColors =
            new Dictionary<string, string>
            {
                { "hardware",          "00ACC1" },  // cyan — equipment / FFB
                { "game_feel",         "AB47BC" },  // purple — sim-specific observations
                { "car_response",      "66BB6A" },  // green — grip, wear, temps, balance
                { "racing_experience", "EC407A" },  // magenta/pink — drivers, flags, incidents
            };

        // ── Category → WCAG text color (bright same-shade for dark backgrounds) ─
        // High-contrast, fully opaque text colors in the same hue family.
        // Meet WCAG AA (4.5:1) against the translucent overlay on black.
        private static readonly Dictionary<string, string> CategoryTextColors =
            new Dictionary<string, string>
            {
                { "hardware",          "#FFB2EBF2" },  // light cyan
                { "game_feel",         "#FFCE93D8" },  // light purple
                { "car_response",      "#FFA5D6A7" },  // light green
                { "racing_experience", "#FFF48FB1" },  // light pink
            };

        // ── Severity → alpha (opacity) mapping ──────────────────────────────
        // Higher severity = more opaque overlay. Alpha as hex string.
        private static readonly Dictionary<int, string> SeverityAlphas =
            new Dictionary<int, string>
            {
                { 1, "66" },  // 40% — ambient / informational
                { 2, "8C" },  // 55% — notable
                { 3, "B3" },  // 70% — significant
                { 4, "D9" },  // 85% — urgent
                { 5, "FF" },  // 100% — critical
            };

        private static readonly Dictionary<int, string> SeverityLabels =
            new Dictionary<int, string>
            {
                { 1, "Info" },
                { 2, "Notable" },
                { 3, "Significant" },
                { 4, "Urgent" },
                { 5, "Critical" },
            };

        // ── Sentiment → category mapping (retained for non-event-only mode) ─
        private static readonly Dictionary<string, string[]> CategorySentiments =
            new Dictionary<string, string[]>
            {
                { "hardware",          new[] { "technical_analytical", "car_praise" } },
                { "game_feel",         new[] { "sim_comparison", "technical_analytical" } },
                { "car_response",      new[] { "excitement_positive", "frustration_negative", "technical_analytical" } },
                { "racing_experience", new[] { "neutral_narrative", "excitement_positive", "frustration_negative", "self_deprecating" } },
            };

        // ── State ─────────────────────────────────────────────────────────────
        private List<CommentaryTopic> _topics = new List<CommentaryTopic>();
        private Dictionary<string, string> _sentimentColors = new Dictionary<string, string>();
        private Dictionary<string, string> _sentimentLabels = new Dictionary<string, string>();
        private readonly Random _rng = new Random();
        private readonly FragmentAssembler _fragmentAssembler = new FragmentAssembler();

        // ── Track commentary data ───────────────────────────────────────────
        private Dictionary<string, TrackCommentaryData> _trackData = new Dictionary<string, TrackCommentaryData>();
        private TrackCommentaryData _currentTrackData;
        private string _resolvedTrackId = "";

        // ── Car & manufacturer commentary data ─────────────────────────────
        private Dictionary<string, CarCommentaryData> _carData = new Dictionary<string, CarCommentaryData>();
        private Dictionary<string, ManufacturerCommentaryData> _manufacturerData = new Dictionary<string, ManufacturerCommentaryData>();
        private CarCommentaryData _currentCarData;
        private ManufacturerCommentaryData _currentManufacturerData;
        private string _resolvedCarModel = "";

        // Per-topic last trigger time
        private readonly Dictionary<string, DateTime> _topicLastTrigger = new Dictionary<string, DateTime>();
        // Anti-spam: minimum seconds between any two prompts (only for same-or-lower severity)
        private DateTime _lastPromptFireTime = DateTime.MinValue;
        private const double AntiSpamSeconds = 8.0;

        // Topics that bypass cooldowns and fire immediately (incidents, crashes, contacts)
        private static readonly HashSet<string> ImmediateTopics = new HashSet<string>
        {
            "incident_spike",
            "wall_contact",
            "spin_catch",
            "off_track",
            "car_contact"
        };

        // Current displayed prompt
        private volatile string _currentText           = "";
        private volatile string _currentCategory       = "";
        private volatile string _currentTitle          = "";
        private volatile string _currentTopicId        = "";
        private volatile string _currentSentimentLabel = "";
        private volatile string _currentSentimentColor = "#FF000000";
        private volatile string _currentTextColor      = "#FFFFFFFF";
        private volatile string _currentEventExposition = "";
        private volatile string _currentTrackImage      = "";
        private volatile string _currentCarImage        = "";
        private DateTime _promptDisplayedAt             = DateTime.MinValue;
        private int _currentSeverity                    = 0;

        // ── Demo mode state ──────────────────────────────────────────────────
        private List<DemoSequence.Step> _demoSteps;
        private int      _demoIndex      = 0;
        private DateTime _demoNextFireAt = DateTime.MinValue;
        private bool     _demoPrev       = false; // tracks DemoMode on→off transitions
        private DateTime _demoLastTick   = DateTime.MinValue;

        /// <summary>
        /// Provides smoothly-animated fake telemetry during demo mode.
        /// Plugin.cs reads these values to populate the Demo.* dashboard properties.
        /// </summary>
        public DemoTelemetryProvider DemoTelemetry { get; } = new DemoTelemetryProvider();

        /// <summary>Session flags from the most recent demo sequence step (0 when no flag).</summary>
        public int CurrentDemoFlags { get; private set; }

        // ── Settings (set by plugin from Settings object) ────────────────────
        public double DisplaySeconds      { get; set; } = 15.0;
        public HashSet<string> EnabledCategories { get; set; }
        public bool EventOnlyMode { get; set; } = false;
        public bool DemoMode      { get; set; } = false;

        /// <summary>Driver's first name — auto-populated from iRacing, falls back to "the driver".</summary>
        public string DriverFirstName { get; set; } = "";

        /// <summary>Driver's last name — auto-populated from iRacing, falls back to "the driver".</summary>
        public string DriverLastName { get; set; } = "";

        /// <summary>
        /// Optional hook — returns a cooldown multiplier for a given topic ID.
        /// Supplied by the plugin from FeedbackEngine. Default: no adjustment.
        /// </summary>
        public Func<string, double> GetCooldownMultiplier { get; set; } = _ => 1.0;

        // ── Public state (read by plugin, passed to dashboard) ───────────────
        public string CurrentText           => _currentText;
        public string CurrentCategory       => _currentCategory;
        public string CurrentTitle          => _currentTitle;
        public string CurrentTopicId        => _currentTopicId;
        public string CurrentSentimentLabel => _currentSentimentLabel;
        public string CurrentSentimentColor => _currentSentimentColor;
        public string CurrentTextColor      => _currentTextColor;
        public string CurrentEventExposition => _currentEventExposition;
        public string CurrentTrackImage     => _currentTrackImage;
        public string CurrentCarImage       => _currentCarImage;
        public int    CurrentSeverity       => _currentSeverity;
        public bool   IsVisible       => _currentText.Length > 0
                                         && (DateTime.UtcNow - _promptDisplayedAt).TotalSeconds < DisplaySeconds;
        public double SecondsRemaining
        {
            get
            {
                double elapsed = (DateTime.UtcNow - _promptDisplayedAt).TotalSeconds;
                return Math.Max(0, DisplaySeconds - elapsed);
            }
        }

        // ── Initialise ──────────────────────────────────────────────────────

        /// <summary>
        /// Shows a brief placeholder prompt so the dashboard is visible on startup
        /// before any game session begins. Auto-clears after DisplaySeconds.
        /// </summary>
        public void ShowDemoPrompt()
        {
            _currentText           = "Media Broadcaster is active. Prompts will appear here when telemetry events fire during your session.";
            _currentCategory       = "hardware";
            _currentTitle          = "Media Broadcaster Ready";
            _currentSentimentColor = "#6637474F"; // neutral dark slate, low alpha (AARRGGBB)
            _currentTextColor      = "#FFFFFFFF"; // default white text
            _currentSeverity       = 1;
            _promptDisplayedAt     = DateTime.UtcNow;
        }

        public void LoadTopics(string jsonPath)
        {
            if (!File.Exists(jsonPath))
            {
                SimHub.Logging.Current.Warn($"[RaceCorProDrive] Topics file not found: {jsonPath}");
                LoadBuiltinTopics();
                return;
            }

            try
            {
                string json = File.ReadAllText(jsonPath);
                var settings = new JsonSerializerSettings
                {
                    ContractResolver = new CamelCasePropertyNamesContractResolver()
                };
                var file = JsonConvert.DeserializeObject<CommentaryTopicsFile>(json, settings);
                _topics = file?.Topics ?? new List<CommentaryTopic>();
                SimHub.Logging.Current.Info($"[RaceCorProDrive] Loaded {_topics.Count} topics from {jsonPath}");
            }
            catch (Exception ex)
            {
                SimHub.Logging.Current.Error($"[RaceCorProDrive] Failed to load topics: {ex.Message}");
                LoadBuiltinTopics();
            }
        }

        public void LoadSentiments(string jsonPath)
        {
            if (!File.Exists(jsonPath))
            {
                SimHub.Logging.Current.Warn($"[RaceCorProDrive] Sentiments file not found: {jsonPath}");
                return;
            }

            try
            {
                string json = File.ReadAllText(jsonPath);
                var settings = new JsonSerializerSettings
                {
                    ContractResolver = new CamelCasePropertyNamesContractResolver()
                };
                var file = JsonConvert.DeserializeObject<SentimentsFile>(json, settings);
                if (file?.Sentiments != null)
                {
                    _sentimentColors.Clear();
                    _sentimentLabels.Clear();
                    foreach (var s in file.Sentiments)
                    {
                        if (string.IsNullOrEmpty(s.Id)) continue;
                        if (!string.IsNullOrEmpty(s.Color))
                            _sentimentColors[s.Id] = NormalizeColor(s.Color);
                        if (!string.IsNullOrEmpty(s.Label))
                            _sentimentLabels[s.Id] = s.Label;
                    }
                }
                SimHub.Logging.Current.Info($"[RaceCorProDrive] Loaded {_sentimentColors.Count} sentiment colors");
            }
            catch (Exception ex)
            {
                SimHub.Logging.Current.Error($"[RaceCorProDrive] Failed to load sentiments: {ex.Message}");
            }
        }

        public void LoadFragments(string jsonPath)
        {
            _fragmentAssembler.ResolveDriverName = () => ResolveDriverName();
            _fragmentAssembler.LoadFragments(jsonPath);
        }

        /// <summary>
        /// Loads track-specific commentary data from commentary_tracks.json.
        /// Provides {track}, {trackNickname}, {corner}, and {trackFact} placeholders.
        /// </summary>
        public void LoadTrackData(string jsonPath)
        {
            if (!File.Exists(jsonPath))
            {
                SimHub.Logging.Current.Warn($"[RaceCorProDrive] Track commentary file not found: {jsonPath}");
                return;
            }

            try
            {
                string json = File.ReadAllText(jsonPath);
                var settings = new JsonSerializerSettings
                {
                    ContractResolver = new CamelCasePropertyNamesContractResolver()
                };
                var file = JsonConvert.DeserializeObject<CommentaryTracksFile>(json, settings);
                _trackData = file?.Tracks ?? new Dictionary<string, TrackCommentaryData>();
                SimHub.Logging.Current.Info($"[RaceCorProDrive] Loaded {_trackData.Count} track commentary entries from {jsonPath}");
            }
            catch (Exception ex)
            {
                SimHub.Logging.Current.Error($"[RaceCorProDrive] Failed to load track data: {ex.Message}");
            }
        }

        /// <summary>
        /// Loads car and manufacturer commentary data from commentary_cars.json.
        /// Provides {carFact}, {carCharacter}, {engineSpec}, {carNickname},
        /// {manufacturerFact}, {racingPhilosophy} placeholders.
        /// </summary>
        public void LoadCarData(string jsonPath)
        {
            if (!File.Exists(jsonPath))
            {
                SimHub.Logging.Current.Warn($"[RaceCorProDrive] Car commentary file not found: {jsonPath}");
                return;
            }

            try
            {
                string json = File.ReadAllText(jsonPath);
                var settings = new JsonSerializerSettings
                {
                    ContractResolver = new CamelCasePropertyNamesContractResolver()
                };
                var file = JsonConvert.DeserializeObject<CommentaryCarsFile>(json, settings);
                _carData = file?.Cars ?? new Dictionary<string, CarCommentaryData>();
                _manufacturerData = file?.Manufacturers ?? new Dictionary<string, ManufacturerCommentaryData>();
                SimHub.Logging.Current.Info($"[RaceCorProDrive] Loaded {_carData.Count} car + {_manufacturerData.Count} manufacturer commentary entries from {jsonPath}");
            }
            catch (Exception ex)
            {
                SimHub.Logging.Current.Error($"[RaceCorProDrive] Failed to load car data: {ex.Message}");
            }
        }

        private void LoadBuiltinTopics()
        {
            _topics = new List<CommentaryTopic>
            {
                new CommentaryTopic
                {
                    Id = "car_balance_fallback",
                    Category = "car_response",
                    Title = "Car Balance",
                    Severity = 2,
                    EventExposition = "Lateral load at {value}G — car working hard through the corner",
                    CommentaryPrompts = new List<string>
                    {
                        "Talk about how the car is feeling right now — is it balanced or fighting you?",
                        "What does the car need right now to go faster?"
                    },
                    Triggers = new List<TriggerCondition>
                    {
                        new TriggerCondition { DataPoint = "LatAccel", Condition = ">", Value = 2.5 }
                    },
                    CooldownMinutes = 2
                },
                new CommentaryTopic
                {
                    Id = "fuel_fallback",
                    Category = "racing_experience",
                    Title = "Fuel Strategy",
                    Severity = 3,
                    EventExposition = "Fuel at {value}% — running low on this stint",
                    CommentaryPrompts = new List<string>
                    {
                        "Talk about your fuel situation — how many laps do you have left?"
                    },
                    Triggers = new List<TriggerCondition>
                    {
                        new TriggerCondition { DataPoint = "FuelPercent", Condition = "<", Value = 0.25 }
                    },
                    CooldownMinutes = 3
                }
            };
        }

        // ── Main update loop ────────────────────────────────────────────────

        /// <summary>
        /// Called once per DataUpdate frame. Branches into demo mode if enabled,
        /// otherwise evaluates real telemetry triggers. Supports severity-based
        /// interruption: higher-severity events override lower ones immediately.
        /// Thread-safe via volatile writes.
        /// </summary>
        public void Update(TelemetrySnapshot current, TelemetrySnapshot previous)
        {
            if (DemoMode)
            {
                UpdateDemo();
                return;
            }

            // When demo mode is turned off, reset demo state and clear any demo prompt
            if (_demoPrev)
            {
                _demoSteps      = null;
                _demoIndex      = 0;
                _demoNextFireAt = DateTime.MinValue;
                _demoLastTick   = DateTime.MinValue;
                _demoPrev       = false;
                ClearPrompt();
            }

            // Auto-clear expired prompts
            if (!IsVisible && _currentText.Length > 0)
                ClearPrompt();

            if (!current.GameRunning) return;

            // Evaluate topics in severity-descending order so the most important fires first,
            // then randomize within the same severity tier.
            var ordered = _topics
                .OrderByDescending(t => t.Severity)
                .ThenBy(_ => _rng.Next())
                .ToList();

            // Pre-race detection: race session, lap 0, not yet racing
            bool isPreRace = IsRaceSession(current.SessionTypeName) && current.CompletedLaps == 0 && current.CurrentLap <= 1;

            foreach (var topic in ordered)
            {
                if (!IsTopicEnabled(topic, current.SessionTypeName)) continue;

                // During pre-race, only allow pre-race-specific and formation/start topics
                if (isPreRace)
                {
                    bool allowedPreRace = topic.Id == "formation_lap" || topic.Id == "race_start"
                        || topic.Id == "prerace_track" || topic.Id == "prerace_car"
                        || topic.Id == "prerace_circuit_detail" || topic.Id == "prerace_manufacturer";
                    if (!allowedPreRace) continue;
                }

                // Block pre-race topics once the race is underway
                if (!isPreRace && topic.Id != null && topic.Id.StartsWith("prerace_"))
                    continue;

                if (!IsTopicCooledDown(topic)) continue;
                if (!AnyTriggerFires(topic, current, previous)) continue;

                // Severity-based interruption logic:
                // If a prompt is currently visible, only replace it if the new topic
                // has strictly higher severity.
                if (IsVisible)
                {
                    if (topic.Severity <= _currentSeverity)
                        continue; // skip — current prompt is same or higher severity

                    // Higher-severity event: interrupt immediately
                    SimHub.Logging.Current.Info(
                        $"[RaceCorProDrive] Interrupting [{_currentTitle}] (sev {_currentSeverity}) with [{topic.Title}] (sev {topic.Severity})");
                }
                else
                {
                    // No prompt visible: enforce anti-spam for non-critical events
                    double elapsed = (DateTime.UtcNow - _lastPromptFireTime).TotalSeconds;
                    if (elapsed < AntiSpamSeconds && topic.Severity < 4)
                        continue;
                }

                ShowPrompt(topic, current);
                return; // one prompt per evaluation
            }
        }

        /// <summary>
        /// Demo mode update path. Fires curated steps from DemoSequence in order,
        /// respecting each step's delay (capped at 30 s). Interruption steps fire
        /// while the previous prompt is still visible, demonstrating the severity system.
        /// Loops continuously so the dashboard stays animated.
        /// </summary>
        private void UpdateDemo()
        {
            _demoPrev = true;

            // Tick the telemetry simulation (smooth animation between events)
            if (_demoLastTick == DateTime.MinValue) _demoLastTick = DateTime.UtcNow;
            double dt = (DateTime.UtcNow - _demoLastTick).TotalSeconds;
            _demoLastTick = DateTime.UtcNow;
            if (dt > 0 && dt < 1.0) DemoTelemetry.Tick(dt);

            // Auto-clear expired prompts
            if (!IsVisible && _currentText.Length > 0)
                ClearPrompt();

            // Initialise sequence on first entry
            if (_demoSteps == null)
            {
                _demoSteps      = DemoSequence.Build();
                _demoIndex      = 0;
                _demoNextFireAt = DateTime.UtcNow; // fire first step immediately
                DemoTelemetry.Reset();
                _demoLastTick   = DateTime.UtcNow;
            }

            if (DateTime.UtcNow < _demoNextFireAt) return;

            // Find the topic for this step
            int safeIndex = _demoIndex % _demoSteps.Count;
            var step = _demoSteps[safeIndex];
            _demoIndex++;

            CommentaryTopic topic = _topics.Find(t => t.Id == step.TopicId);
            if (topic == null)
            {
                // Topic not found (e.g., filtered out) — skip and schedule next
                double skipDelay = Math.Min(step.DelaySeconds, 30.0);
                _demoNextFireAt = DateTime.UtcNow.AddSeconds(Math.Max(skipDelay, 3.0));
                return;
            }

            // Schedule the NEXT step before firing this one
            double nextDelay = safeIndex + 1 < _demoSteps.Count
                ? _demoSteps[safeIndex + 1].DelaySeconds
                : _demoSteps[0].DelaySeconds;
            _demoNextFireAt = DateTime.UtcNow.AddSeconds(Math.Min(nextDelay, 30.0));

            // In demo mode, severity-based interruption logic still applies so viewers see it live.
            if (IsVisible && topic.Severity <= _currentSeverity)
            {
                // This step would be blocked — advance immediately so the sequence keeps moving
                _demoNextFireAt = DateTime.UtcNow.AddSeconds(2.0);
                return;
            }

            if (step.IsInterrupt && IsVisible)
                SimHub.Logging.Current.Info(
                    $"[RaceCorProDrive][Demo] Interrupting [{_currentTitle}] (sev {_currentSeverity}) with [{topic.Title}] (sev {topic.Severity})");

            // Sync telemetry provider with this step's event-driven state
            DemoTelemetry.ApplyDemoStep(step.Snapshot);
            // Persist flag state: only update if the new step has a flag, or clear
            // when a non-flag step fires (flag lasts for the duration of its step)
            if (step.Snapshot.SessionFlags != 0)
                CurrentDemoFlags = step.Snapshot.SessionFlags;
            else
                CurrentDemoFlags = 0;

            ShowPrompt(topic, step.Snapshot);
        }

        public void ClearPrompt()
        {
            _currentText            = "";
            _currentCategory        = "";
            _currentTitle           = "";
            _currentTopicId         = "";
            _currentSentimentLabel  = "";
            _currentSentimentColor  = "#FF000000";
            _currentTextColor       = "#FFFFFFFF";
            _currentEventExposition = "";
            _currentTrackImage      = "";
            _currentCarImage        = "";
            _currentSeverity        = 0;
        }

        // ── Helpers ─────────────────────────────────────────────────────────

        private bool IsTopicEnabled(CommentaryTopic topic, string sessionTypeName)
        {
            if (EnabledCategories != null && EnabledCategories.Count > 0)
                if (!EnabledCategories.Contains(topic.Category)) return false;

            // Session type filter: if topic specifies session types, enforce them
            if (topic.SessionTypes != null && topic.SessionTypes.Count > 0)
            {
                string sn = (sessionTypeName ?? "").ToLowerInvariant();
                bool matched = false;
                foreach (var st in topic.SessionTypes)
                {
                    if (sn.Contains(st.ToLowerInvariant())) { matched = true; break; }
                }
                if (!matched) return false;
            }

            return true;
        }

        private static bool IsRaceSession(string sessionTypeName)
        {
            if (string.IsNullOrEmpty(sessionTypeName)) return false;
            var s = sessionTypeName.ToLowerInvariant();
            return s.Contains("race") && !s.Contains("practice") && !s.Contains("qualify") && !s.Contains("warmup");
        }

        private bool IsTopicCooledDown(CommentaryTopic topic)
        {
            // Incident and crash topics bypass cooldowns entirely
            if (ImmediateTopics.Contains(topic.Id))
                return true;

            if (!_topicLastTrigger.TryGetValue(topic.Id, out DateTime last))
                return true;
            double multiplier = GetCooldownMultiplier(topic.Id);
            return (DateTime.UtcNow - last).TotalMinutes >= topic.CooldownMinutes * multiplier;
        }

        private bool AnyTriggerFires(CommentaryTopic topic, TelemetrySnapshot cur, TelemetrySnapshot prev)
        {
            foreach (var trigger in topic.Triggers)
            {
                if (TriggerEvaluator.Evaluate(trigger, cur, prev))
                    return true;
            }
            return false;
        }

        /// <summary>
        /// Resolves the overlay color for a topic.
        /// Color (RGB) comes from the topic's CATEGORY — avoids flag color collisions.
        /// Alpha (opacity) comes from the topic's SEVERITY — higher = more opaque.
        /// Returns #AARRGGBB format.
        /// </summary>
        private string ResolveSentimentColor(CommentaryTopic topic)
        {
            // Get RGB from category
            string rgb = CategoryColors.TryGetValue(topic.Category ?? "", out var catRgb)
                ? catRgb
                : "37474F"; // fallback slate grey

            // Get alpha from severity
            string alpha = SeverityAlphas.TryGetValue(topic.Severity, out var a)
                ? a
                : "B3"; // fallback 70%

            return $"#{alpha}{rgb}";
        }

        /// <summary>
        /// Resolves the WCAG-compliant text color for a topic.
        /// Same hue family as the overlay, but bright enough for AA contrast
        /// against the translucent overlay on a dark/black background.
        /// Returns #AARRGGBB (fully opaque).
        /// </summary>
        private string ResolveTextColor(CommentaryTopic topic)
        {
            return CategoryTextColors.TryGetValue(topic.Category ?? "", out var textColor)
                ? textColor
                : "#FFFFFFFF"; // fallback white
        }

        private void ShowPrompt(CommentaryTopic topic, TelemetrySnapshot context)
        {
            // Try to assemble from fragments first; fall back to static prompts if not available
            string prompt = _fragmentAssembler.Assemble(topic.Id, context);

            if (prompt == null)
            {
                // Fallback to static commentary prompts
                if (topic.CommentaryPrompts == null || topic.CommentaryPrompts.Count == 0) return;

                prompt = topic.CommentaryPrompts[_rng.Next(topic.CommentaryPrompts.Count)];

                // Substitute driver-name placeholders if opponent data is available
                if (context != null)
                {
                    prompt = prompt.Replace("{ahead}",  FormatDriver(context.NearestAheadName,  context.NearestAheadRating));
                    prompt = prompt.Replace("{behind}", FormatDriver(context.NearestBehindName, context.NearestBehindRating));
                }
            }

            // Substitute {driver} with randomly-chosen first or last name
            prompt = prompt.Replace("{driver}", ResolveDriverName());

            // Substitute car-specific placeholders
            prompt = prompt.Replace("{car}", ResolveCar("{car}", context));
            prompt = prompt.Replace("{manufacturer}", ResolveCar("{manufacturer}", context));
            prompt = prompt.Replace("{class}", ResolveCar("{class}", context));

            // Substitute track-specific placeholders
            prompt = ResolveTrackPlaceholders(prompt, context);

            // Substitute car/manufacturer-specific placeholders
            prompt = ResolveCarPlaceholders(prompt, context);

            // Build event exposition text (used in event-only mode)
            string exposition = BuildEventExposition(topic, context);

            // Resolve colors — category determines hue, severity determines opacity
            string sentimentColor = ResolveSentimentColor(topic);
            string textColor      = ResolveTextColor(topic);
            string sentimentLabel = SeverityLabels.TryGetValue(topic.Severity, out var sl)
                ? sl
                : (!string.IsNullOrEmpty(topic.Sentiment) && _sentimentLabels.TryGetValue(topic.Sentiment, out var l) ? l : "");

            // Pick a random track image if this is a track-related topic
            string trackImage = "";
            if (_currentTrackData?.Images != null && _currentTrackData.Images.Count > 0
                && (topic.Id.Contains("track") || topic.Id.Contains("circuit")))
            {
                trackImage = _currentTrackData.Images[_rng.Next(_currentTrackData.Images.Count)];
            }

            // Pick a random car image if this is a car/manufacturer-related topic
            string carImage = "";
            if (_currentCarData?.Images != null && _currentCarData.Images.Count > 0
                && (topic.Id.Contains("car") || topic.Id.Contains("manufacturer")
                    || topic.Id.Contains("prerace_car") || topic.Id.Contains("race_car")))
            {
                carImage = _currentCarData.Images[_rng.Next(_currentCarData.Images.Count)];
            }

            _currentText            = prompt;
            _currentCategory        = topic.Category;
            _currentTitle           = topic.Title;
            _currentTopicId         = topic.Id;
            _currentSentimentLabel  = sentimentLabel;
            _currentSentimentColor  = sentimentColor;
            _currentTextColor       = textColor;
            _currentEventExposition = exposition;
            _currentTrackImage      = trackImage;
            _currentCarImage        = carImage;
            _currentSeverity        = topic.Severity;
            _promptDisplayedAt      = DateTime.UtcNow;

            _topicLastTrigger[topic.Id] = DateTime.UtcNow;
            _lastPromptFireTime = DateTime.UtcNow;

            SimHub.Logging.Current.Info($"[RaceCorProDrive] Prompt shown: [{topic.Title}] (sev {topic.Severity}) {prompt}");
        }

        /// <summary>
        /// Builds a concise, on-air-readable exposition string for event-only mode.
        /// Uses the topic's EventExposition template if present, otherwise generates
        /// a default from the topic title and trigger data.
        /// </summary>
        private string BuildEventExposition(CommentaryTopic topic, TelemetrySnapshot context)
        {
            string template = topic.EventExposition;

            if (string.IsNullOrEmpty(template))
            {
                // Generate a sensible default from the topic title + severity
                string sevTag = SeverityLabels.TryGetValue(topic.Severity, out var s) ? s.ToUpper() : "";
                return $"[{sevTag}] {topic.Title}";
            }

            // Substitute {value} with the primary trigger's current value
            if (context != null && topic.Triggers.Count > 0)
            {
                var primaryTrigger = topic.Triggers[0];
                double val = TriggerEvaluator.GetValuePublic(context, primaryTrigger.DataPoint);
                template = template.Replace("{value}", FormatValue(val, primaryTrigger.DataPoint));
            }

            // Substitute driver-name placeholders
            if (context != null)
            {
                template = template.Replace("{ahead}",  FormatDriver(context.NearestAheadName,  context.NearestAheadRating));
                template = template.Replace("{behind}", FormatDriver(context.NearestBehindName, context.NearestBehindRating));
            }

            // Substitute {driver} with randomly-chosen first or last name
            template = template.Replace("{driver}", ResolveDriverName());

            // Substitute car-specific placeholders
            template = template.Replace("{car}", ResolveCar("{car}", context));
            template = template.Replace("{manufacturer}", ResolveCar("{manufacturer}", context));
            template = template.Replace("{class}", ResolveCar("{class}", context));

            // Substitute track-specific placeholders
            template = ResolveTrackPlaceholders(template, context);

            // Substitute car/manufacturer-specific placeholders
            template = ResolveCarPlaceholders(template, context);

            return template;
        }

        private static string FormatValue(double val, string dataPoint)
        {
            string dp = (dataPoint ?? "").ToLower();
            // Percentage fields: display as integer percent
            if (dp.Contains("pct") || dp.Contains("percent") || dp == "fuelpercent" || dp == "fuellevelpct")
                return $"{val * 100:0}";
            // Temperatures
            if (dp.Contains("temp"))
                return $"{val:0.0}";
            // Accel / rates: one decimal
            if (dp.Contains("accel") || dp.Contains("yaw") || dp.Contains("torque"))
                return $"{val:0.0}";
            // Lap times: display as seconds
            if (dp.Contains("laptime") || dp.Contains("delta"))
                return $"{val:0.000}";
            // Default: sensible rounding
            return Math.Abs(val) >= 100 ? $"{val:0}" : $"{val:0.0}";
        }

        private static string FormatDriver(string name, int rating)
        {
            if (string.IsNullOrEmpty(name)) return "the car";
            return rating > 0 ? $"{name} ({rating:N0} iR)" : name;
        }

        /// <summary>
        /// Randomly resolves {driver} placeholder to the driver's first or last name.
        /// If only one name is configured, uses that. Falls back to "the driver".
        /// </summary>
        private string ResolveDriverName()
        {
            bool hasFirst = !string.IsNullOrWhiteSpace(DriverFirstName);
            bool hasLast  = !string.IsNullOrWhiteSpace(DriverLastName);

            if (hasFirst && hasLast)
                return _rng.Next(2) == 0 ? DriverFirstName.Trim() : DriverLastName.Trim();
            if (hasFirst) return DriverFirstName.Trim();
            if (hasLast)  return DriverLastName.Trim();
            return "the driver";
        }

        /// <summary>
        /// Resolves car-specific placeholders: {car}, {manufacturer}, {class}.
        /// {car} → full car model name (e.g., "McLaren 570S")
        /// {manufacturer} → brand only (e.g., "McLaren")
        /// {class} → car class (e.g., "the GT3 car")
        /// </summary>
        private string ResolveCar(string placeholder, TelemetrySnapshot context)
        {
            if (context == null || string.IsNullOrEmpty(context.CarModel))
                return "the car";

            string carModel = context.CarModel.Trim();

            if (placeholder == "{car}")
            {
                // Return full car model name as-is (brand names are proper nouns)
                return carModel;
            }

            if (placeholder == "{manufacturer}")
            {
                // Extract first word as manufacturer (e.g., "McLaren" from "McLaren 570S")
                string[] parts = carModel.Split(new[] { ' ' }, System.StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length > 0)
                {
                    return parts[0];
                }
                return "the car";
            }

            if (placeholder == "{class}")
            {
                // Detect class from car model string
                string carLower = carModel.ToLowerInvariant();

                if (carLower.Contains("gt3")) return "the GT3 car";
                if (carLower.Contains("gt4")) return "the GT4 car";
                if (carLower.Contains("gte")) return "the GTE car";
                if (carLower.Contains("lmp2")) return "the LMP2 car";
                if (carLower.Contains("lmdh")) return "the LMDh car";
                if (carLower.Contains("formula") || carLower.Contains("f1")) return "the Formula car";
                if (carLower.Contains("stock") || carLower.Contains("nascar")) return "the stock car";
                if (carLower.Contains("truck")) return "the truck";
                if (carLower.Contains("prototype")) return "the prototype";

                return "the car";
            }

            return "the car";
        }

        /// <summary>
        /// Resolves the current track's commentary data from the track database.
        /// Uses fuzzy matching: normalizes the track name to lowercase and checks
        /// for substring matches against the database keys.
        /// </summary>
        private void ResolveCurrentTrack(TelemetrySnapshot context)
        {
            if (context == null || string.IsNullOrEmpty(context.TrackName)) return;

            string trackName = context.TrackName.Trim();
            if (trackName == _resolvedTrackId) return; // already resolved

            _resolvedTrackId = trackName;
            _currentTrackData = null;

            string lower = trackName.ToLowerInvariant()
                .Replace(" ", "-")
                .Replace("_", "-");

            // Exact match first
            if (_trackData.TryGetValue(lower, out var exact))
            {
                _currentTrackData = exact;
                return;
            }

            // Substring match: find the best match where the key is contained in
            // the track name or vice versa
            foreach (var kvp in _trackData)
            {
                if (lower.Contains(kvp.Key) || kvp.Key.Contains(lower))
                {
                    _currentTrackData = kvp.Value;
                    return;
                }
            }

            // Partial word match: try matching significant parts of the name
            string[] words = lower.Split(new[] { '-', ' ' }, StringSplitOptions.RemoveEmptyEntries);
            foreach (var kvp in _trackData)
            {
                foreach (var word in words)
                {
                    if (word.Length >= 4 && kvp.Key.Contains(word))
                    {
                        _currentTrackData = kvp.Value;
                        return;
                    }
                }
            }
        }

        /// <summary>
        /// Resolves track-specific placeholders in a text string:
        /// {track} → display name, {trackNickname} → nickname or display name,
        /// {corner} → random famous corner, {trackFact} → random talking point.
        /// </summary>
        private string ResolveTrackPlaceholders(string text, TelemetrySnapshot context)
        {
            if (string.IsNullOrEmpty(text)) return text;
            if (!text.Contains("{track")) return text; // fast path: no track placeholders

            ResolveCurrentTrack(context);

            if (_currentTrackData != null)
            {
                text = text.Replace("{track}", _currentTrackData.DisplayName);
                text = text.Replace("{trackNickname}",
                    !string.IsNullOrEmpty(_currentTrackData.Nickname)
                        ? _currentTrackData.Nickname
                        : _currentTrackData.DisplayName);

                if (text.Contains("{corner}"))
                {
                    string corner = _currentTrackData.FamousCorners?.Count > 0
                        ? _currentTrackData.FamousCorners[_rng.Next(_currentTrackData.FamousCorners.Count)]
                        : "the next corner";
                    text = text.Replace("{corner}", corner);
                }

                if (text.Contains("{trackFact}"))
                {
                    string fact = _currentTrackData.TalkingPoints?.Count > 0
                        ? _currentTrackData.TalkingPoints[_rng.Next(_currentTrackData.TalkingPoints.Count)]
                        : "this circuit has a fascinating history in motorsport";
                    text = text.Replace("{trackFact}", fact);
                }
            }
            else
            {
                // Fallback when track data isn't available
                string trackName = !string.IsNullOrEmpty(context?.TrackName) ? context.TrackName : "this circuit";
                text = text.Replace("{track}", trackName);
                text = text.Replace("{trackNickname}", trackName);
                text = text.Replace("{corner}", "the next corner");
                text = text.Replace("{trackFact}", "this circuit has a fascinating history in motorsport");
            }

            return text;
        }

        /// <summary>
        /// Resolves the current car's commentary data from the car database.
        /// Uses fuzzy matching: normalizes the car model to lowercase and checks
        /// for substring matches against the database keys.
        /// </summary>
        private void ResolveCurrentCar(TelemetrySnapshot context)
        {
            if (context == null || string.IsNullOrEmpty(context.CarModel)) return;

            string carModel = context.CarModel.Trim();
            if (carModel == _resolvedCarModel) return; // already resolved

            _resolvedCarModel = carModel;
            _currentCarData = null;
            _currentManufacturerData = null;

            string lower = carModel.ToLowerInvariant();

            // Exact match first
            if (_carData.TryGetValue(lower, out var exact))
            {
                _currentCarData = exact;
                ResolveManufacturer(exact.Manufacturer);
                return;
            }

            // Substring match: find the best match where the key is contained in
            // the car model or vice versa. Prefer longer keys (more specific matches).
            string bestKey = null;
            int bestLen = 0;
            foreach (var kvp in _carData)
            {
                if (lower.Contains(kvp.Key) || kvp.Key.Contains(lower))
                {
                    if (kvp.Key.Length > bestLen)
                    {
                        bestKey = kvp.Key;
                        bestLen = kvp.Key.Length;
                    }
                }
            }

            if (bestKey != null)
            {
                _currentCarData = _carData[bestKey];
                ResolveManufacturer(_currentCarData.Manufacturer);
                return;
            }

            // Partial word match: try matching significant parts of the name
            string[] words = lower.Split(new[] { ' ', '-', '_' }, StringSplitOptions.RemoveEmptyEntries);
            foreach (var kvp in _carData)
            {
                foreach (var word in words)
                {
                    if (word.Length >= 3 && kvp.Key.Contains(word))
                    {
                        _currentCarData = kvp.Value;
                        ResolveManufacturer(_currentCarData.Manufacturer);
                        return;
                    }
                }
            }
        }

        /// <summary>
        /// Resolves the manufacturer data by looking up the manufacturer name in the database.
        /// </summary>
        private void ResolveManufacturer(string manufacturer)
        {
            if (string.IsNullOrEmpty(manufacturer)) return;

            string lower = manufacturer.ToLowerInvariant();
            if (_manufacturerData.TryGetValue(lower, out var mfr))
            {
                _currentManufacturerData = mfr;
                return;
            }

            // Substring fallback
            foreach (var kvp in _manufacturerData)
            {
                if (lower.Contains(kvp.Key) || kvp.Key.Contains(lower))
                {
                    _currentManufacturerData = kvp.Value;
                    return;
                }
            }
        }

        /// <summary>
        /// Resolves car-specific placeholders in a text string:
        /// {carFact} → random talking point, {carCharacter} → driving character trait,
        /// {engineSpec} → engine specification, {carNickname} → nickname or display name,
        /// {manufacturerFact} → manufacturer talking point, {racingPhilosophy} → racing philosophy.
        /// </summary>
        private string ResolveCarPlaceholders(string text, TelemetrySnapshot context)
        {
            if (string.IsNullOrEmpty(text)) return text;
            // Fast path: skip if no car/manufacturer placeholders present
            if (!text.Contains("{car") && !text.Contains("{engine") && !text.Contains("{manufacturer") && !text.Contains("{racing")
                && !text.Contains("{carDesigner}") && !text.Contains("{carDriver}"))
                return text;

            ResolveCurrentCar(context);

            if (_currentCarData != null)
            {
                if (text.Contains("{carNickname}"))
                {
                    text = text.Replace("{carNickname}",
                        !string.IsNullOrEmpty(_currentCarData.Nickname)
                            ? _currentCarData.Nickname
                            : _currentCarData.DisplayName);
                }

                if (text.Contains("{carFact}"))
                {
                    string fact = _currentCarData.TalkingPoints?.Count > 0
                        ? _currentCarData.TalkingPoints[_rng.Next(_currentCarData.TalkingPoints.Count)]
                        : "this is a competitive machine in its class";
                    text = text.Replace("{carFact}", fact);
                }

                if (text.Contains("{carCharacter}"))
                {
                    string character = _currentCarData.DrivingCharacter?.Count > 0
                        ? _currentCarData.DrivingCharacter[_rng.Next(_currentCarData.DrivingCharacter.Count)]
                        : "it has its own unique character on track";
                    text = text.Replace("{carCharacter}", character);
                }

                if (text.Contains("{engineSpec}"))
                {
                    text = text.Replace("{engineSpec}",
                        !string.IsNullOrEmpty(_currentCarData.EngineSpec)
                            ? _currentCarData.EngineSpec
                            : "a potent powertrain");
                }

                if (text.Contains("{carDesigner}"))
                {
                    text = text.Replace("{carDesigner}",
                        !string.IsNullOrEmpty(_currentCarData.Designer)
                            ? _currentCarData.Designer
                            : "the engineering team");
                }

                if (text.Contains("{carDriver}"))
                {
                    string driver = _currentCarData.NotableDrivers?.Count > 0
                        ? _currentCarData.NotableDrivers[_rng.Next(_currentCarData.NotableDrivers.Count)]
                        : "some of the best drivers in the business";
                    text = text.Replace("{carDriver}", driver);
                }
            }
            else
            {
                // Fallbacks when car data isn't available
                text = text.Replace("{carNickname}", context?.CarModel ?? "this car");
                text = text.Replace("{carFact}", "this is a competitive machine in its class");
                text = text.Replace("{carCharacter}", "it has its own unique character on track");
                text = text.Replace("{engineSpec}", "a potent powertrain");
                text = text.Replace("{carDesigner}", "the engineering team");
                text = text.Replace("{carDriver}", "some of the best drivers in the business");
            }

            // Manufacturer placeholders
            if (_currentManufacturerData != null)
            {
                if (text.Contains("{manufacturerFact}"))
                {
                    string fact = _currentManufacturerData.TalkingPoints?.Count > 0
                        ? _currentManufacturerData.TalkingPoints[_rng.Next(_currentManufacturerData.TalkingPoints.Count)]
                        : "a manufacturer with a proud racing heritage";
                    text = text.Replace("{manufacturerFact}", fact);
                }

                if (text.Contains("{racingPhilosophy}"))
                {
                    text = text.Replace("{racingPhilosophy}",
                        !string.IsNullOrEmpty(_currentManufacturerData.RacingPhilosophy)
                            ? _currentManufacturerData.RacingPhilosophy
                            : "a philosophy built around performance and competition");
                }

                if (text.Contains("{manufacturerFounder}"))
                {
                    text = text.Replace("{manufacturerFounder}",
                        !string.IsNullOrEmpty(_currentManufacturerData.Founder)
                            ? _currentManufacturerData.Founder
                            : "its founders");
                }
            }
            else
            {
                text = text.Replace("{manufacturerFact}", "a manufacturer with a proud racing heritage");
                text = text.Replace("{racingPhilosophy}", "a philosophy built around performance and competition");
                text = text.Replace("{manufacturerFounder}", "its founders");
            }

            return text;
        }

        /// <summary>
        /// Converts a color string to #AARRGGBB format for SimHub dashboard compatibility.
        /// Accepts #RGB, #RRGGBB, or #AARRGGBB input.
        /// </summary>
        public static string NormalizeColor(string color)
        {
            if (string.IsNullOrEmpty(color)) return "#FF000000";
            color = color.Trim();
            if (!color.StartsWith("#")) color = "#" + color;

            // Already in #AARRGGBB format (9 chars)
            // Special case: #00000000 (all zeros) → opaque black
            if (color.Length == 9 && color.Equals("#00000000", System.StringComparison.OrdinalIgnoreCase))
                return "#FF000000";
            if (color.Length == 9) return color.ToUpper();

            // #RRGGBB format (7 chars) — prepend FF alpha
            if (color.Length == 7) return "#FF" + color.Substring(1).ToUpper();

            // #RGB shorthand (4 chars)
            if (color.Length == 4)
            {
                char r = color[1], g = color[2], b = color[3];
                return $"#FF{r}{r}{g}{g}{b}{b}".ToUpper();
            }

            return "#FF000000";
        }
    }
}
