using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json;
using RaceCorProDrive.Plugin.Models;

namespace RaceCorProDrive.Plugin.Engine
{
    /// <summary>
    /// Core engine for the Incident Coach system. Tracks driver incidents,
    /// attributes blame, maintains a threat ledger, computes rage scores,
    /// and manages cool-down interventions.
    ///
    /// Lifecycle: Init() → Update() per frame → End() on shutdown.
    /// Thread safety: volatile fields for overlay-read properties.
    /// </summary>
    public class IncidentCoachEngine
    {
        // ── Constants ────────────────────────────────────────────────────

        /// <summary>Minimum attribution score to tag a driver as primary suspect.</summary>
        private const double PrimarySuspectThreshold = 40.0;

        /// <summary>Minimum attribution score to flag as possible contributor.</summary>
        private const double ContributorThreshold = 25.0;

        /// <summary>Seconds after incident before rage score fully decays.</summary>
        private const double RageDecayWindowSeconds = 30.0;

        /// <summary>Frustration cascade multiplier per incident (from Abou-Zeid 2011).</summary>
        private const double CascadeDecayFactor = 0.85;

        /// <summary>Default gap target during cool-down (from Kerwin following-distance research).</summary>
        private const double DefaultCooldownGapTarget = 2.5;

        /// <summary>Minimum cool-down duration in seconds.</summary>
        private const double MinCooldownSeconds = 20.0;

        /// <summary>Rage score threshold to exit cool-down.</summary>
        private const double CooldownExitRageThreshold = 30.0;

        /// <summary>Maximum drivers to include in a proximity snapshot.</summary>
        private const int MaxNearbyDrivers = 6;

        // ── Alert range thresholds (seconds of gap) by threat level ─────
        private static readonly Dictionary<ThreatLevel, double> AlertRanges =
            new Dictionary<ThreatLevel, double>
            {
                { ThreatLevel.Watch, 1.5 },
                { ThreatLevel.Caution, 2.5 },
                { ThreatLevel.Danger, 3.5 }
            };

        // ── State ────────────────────────────────────────────────────────
        private IIncidentDetector _detector;
        private readonly Dictionary<string, DriverThreatEntry> _threatLedger =
            new Dictionary<string, DriverThreatEntry>(StringComparer.OrdinalIgnoreCase);
        private readonly List<ProximitySnapshot> _incidentHistory =
            new List<ProximitySnapshot>();
        private readonly BehaviorMetrics _behavior = new BehaviorMetrics();

        private DateTime _lastIncidentTime = DateTime.MinValue;
        private int _sessionIncidentCount;
        private double _currentRageScore;
        private bool _cooldownActive;
        private DateTime _cooldownStartTime;
        private DateTime _lastRageSpikeStart = DateTime.MinValue;
        private bool _inRageSpike;
        private int _lastKnownLap;
        private string _sessionId = "";

        // ── Rage computation state ───────────────────────────────────────
        private double _throttleAggressionAccum;
        private double _steeringErraticismAccum;
        private double _brakingAggressionAccum;
        private double _proximityChaseAccum;
        private readonly Queue<double> _recentSteeringAngles = new Queue<double>();
        private const int SteeringWindowSize = 30; // ~1 second at 30fps

        // ── Volatile outputs (read by Plugin.cs for HTTP API) ────────────
        private volatile string _threatDriversJson = "[]";
        private volatile string _activeAlertJson = "{}";
        private volatile string _sessionBehaviorJson = "{}";

        // ── Settings ─────────────────────────────────────────────────────

        /// <summary>Master enable/disable for the entire system.</summary>
        public bool Enabled { get; set; }

        /// <summary>Whether voice coaching prompts should be generated.</summary>
        public bool VoiceEnabled { get; set; } = true;

        /// <summary>Rage score threshold for automatic cool-down activation (40–90).</summary>
        public int CooldownThreshold { get; set; } = 70;

        /// <summary>Alert sensitivity multiplier. Low=0.7, Medium=1.0, High=1.3.</summary>
        public double AlertSensitivity { get; set; } = 1.0;

        // ── Public read-only state ───────────────────────────────────────

        /// <summary>Current rage score (0–100).</summary>
        public double RageScore => _currentRageScore;

        /// <summary>Whether cool-down mode is currently active.</summary>
        public bool IsCooldownActive => _cooldownActive;

        /// <summary>JSON array of DriverThreatEntry objects for overlay consumption.</summary>
        public string ThreatDriversJson => _threatDriversJson;

        /// <summary>JSON object describing the current active alert (if any).</summary>
        public string ActiveAlertJson => _activeAlertJson;

        /// <summary>JSON object with cumulative session behavior metrics.</summary>
        public string SessionBehaviorJson => _sessionBehaviorJson;

        /// <summary>Lap number of the most recent incident.</summary>
        public int LastIncidentLap { get; private set; }

        /// <summary>The full list of incident snapshots this session.</summary>
        public IReadOnlyList<ProximitySnapshot> IncidentHistory => _incidentHistory;

        /// <summary>The current behavior metrics (for post-session report).</summary>
        public BehaviorMetrics Behavior => _behavior;

        /// <summary>Total incidents detected this session.</summary>
        public int SessionIncidentCount => _sessionIncidentCount;

        // ── Lifecycle ────────────────────────────────────────────────────

        /// <summary>Initialize the engine. Called once from Plugin.Init().</summary>
        public void Init()
        {
            _detector = new IRacingIncidentDetector();
            _sessionId = Guid.NewGuid().ToString("N").Substring(0, 8);
            SimHub.Logging.Current.Info("[RaceCorProDrive] IncidentCoachEngine initialized (session: " + _sessionId + ")");
        }

        /// <summary>
        /// Main update loop. Called every frame from Plugin.DataUpdate().
        /// Handles incident detection, attribution, rage scoring, and alert generation.
        /// </summary>
        public void Update(TelemetrySnapshot current, TelemetrySnapshot previous)
        {
            if (!Enabled || current == null || !current.GameRunning) return;
            if (previous == null) return;

            // Detect new session (track or session type changed)
            DetectSessionReset(current, previous);

            // Track lap changes for behavior metrics
            TrackLapChange(current);

            // Step 1: Incident detection
            if (_detector.IsIncidentDetected(current, previous))
            {
                HandleIncident(current);
            }

            // Step 2: Rage score computation
            UpdateRageScore(current, previous);

            // Step 3: Cool-down management
            UpdateCooldown(current);

            // Step 4: Proximity alerts for flagged drivers
            UpdateProximityAlerts(current);

            // Step 5: Behavior metrics
            UpdateBehaviorMetrics(current, previous);

            // Step 6: Serialize state for overlay
            SerializeState();
        }

        /// <summary>Cleanup on plugin shutdown.</summary>
        public void End()
        {
            _threatLedger.Clear();
            _incidentHistory.Clear();
            SimHub.Logging.Current.Info("[RaceCorProDrive] IncidentCoachEngine shutdown");
        }

        /// <summary>Manually trigger cool-down mode (e.g., from keyboard shortcut).</summary>
        public void TriggerManualCooldown()
        {
            if (!Enabled) return;
            if (!_cooldownActive)
            {
                _cooldownActive = true;
                _cooldownStartTime = DateTime.UtcNow;
                _behavior.CooldownsTriggered++;
                SimHub.Logging.Current.Info("[RaceCorProDrive] Manual cool-down triggered");
            }
        }

        // ── Session management ───────────────────────────────────────────

        private void DetectSessionReset(TelemetrySnapshot current, TelemetrySnapshot previous)
        {
            // Reset on track change or session type change
            bool trackChanged = !string.IsNullOrEmpty(current.TrackName) &&
                                !string.IsNullOrEmpty(previous.TrackName) &&
                                current.TrackName != previous.TrackName;

            bool sessionChanged = !string.IsNullOrEmpty(current.SessionTypeName) &&
                                  !string.IsNullOrEmpty(previous.SessionTypeName) &&
                                  current.SessionTypeName != previous.SessionTypeName;

            if (trackChanged || sessionChanged)
            {
                ResetSession();
            }
        }

        private void ResetSession()
        {
            _threatLedger.Clear();
            _incidentHistory.Clear();
            _sessionIncidentCount = 0;
            _currentRageScore = 0;
            _cooldownActive = false;
            _inRageSpike = false;
            _lastIncidentTime = DateTime.MinValue;
            _lastKnownLap = 0;

            if (_detector is IRacingIncidentDetector iracing)
            {
                iracing.Reset();
            }

            _sessionId = Guid.NewGuid().ToString("N").Substring(0, 8);
            SimHub.Logging.Current.Info("[RaceCorProDrive] IncidentCoach session reset (new: " + _sessionId + ")");
        }

        private void TrackLapChange(TelemetrySnapshot current)
        {
            int currentLap = current.CurrentLap;
            if (currentLap > _lastKnownLap && _lastKnownLap > 0)
            {
                _behavior.TotalLaps++;

                // Check if the completed lap was clean (no incidents since last lap change)
                double secondsSinceIncident = (DateTime.UtcNow - _lastIncidentTime).TotalSeconds;
                if (secondsSinceIncident > 90) // ~1 lap minimum without incident
                {
                    _behavior.CleanLaps++;
                }
            }
            _lastKnownLap = currentLap;
        }

        // ── Incident handling ────────────────────────────────────────────

        private void HandleIncident(TelemetrySnapshot current)
        {
            int severity = _detector.GetIncidentSeverity();
            _sessionIncidentCount++;
            _lastIncidentTime = DateTime.UtcNow;
            LastIncidentLap = current.CurrentLap;

            // Build proximity snapshot
            var nearby = _detector.GetNearbyDrivers(current);
            var snapshot = new ProximitySnapshot
            {
                Timestamp = DateTime.UtcNow,
                PlayerCarIdx = current.PlayerCarIdx,
                PlayerLapDistPct = current.TrackPositionPct,
                PlayerSpeed = current.SpeedKmh,
                PlayerLatAccel = current.LatAccel,
                PlayerLongAccel = current.LongAccel,
                PlayerYawRate = current.YawRate,
                IncidentDelta = severity,
                Lap = current.CurrentLap,
                NearbyDrivers = nearby
            };

            // Score each nearby driver
            foreach (var driver in snapshot.NearbyDrivers)
            {
                driver.AttributionScore = ScoreAttribution(driver, snapshot);
            }

            _incidentHistory.Add(snapshot);

            // Attribute to highest-scoring driver
            var suspect = snapshot.NearbyDrivers
                .OrderByDescending(d => d.AttributionScore)
                .FirstOrDefault();

            if (suspect != null && suspect.AttributionScore >= PrimarySuspectThreshold)
            {
                UpdateThreatLedger(suspect, severity, current.CurrentLap);
                SimHub.Logging.Current.Info(
                    "[RaceCorProDrive] Incident attributed to " + suspect.Name +
                    " (score: " + suspect.AttributionScore.ToString("F1") +
                    ", severity: " + severity + "x, lap: " + current.CurrentLap + ")");
            }
            else
            {
                SimHub.Logging.Current.Info(
                    "[RaceCorProDrive] Incident detected (" + severity +
                    "x) but no driver met attribution threshold. Nearby: " +
                    snapshot.NearbyDrivers.Count);
            }
        }

        // ── Attribution algorithm ────────────────────────────────────────

        /// <summary>
        /// Score a nearby driver for incident attribution.
        /// Returns 0–100 based on proximity, relative position, and behavioral context.
        /// </summary>
        private double ScoreAttribution(NearbyDriver driver, ProximitySnapshot snapshot)
        {
            double score = 0;

            // ── Proximity Score (0–40) ───────────────────────────────────
            double absGap = Math.Abs(driver.GapToPlayer);
            if (absGap <= 0.2) score += 40;
            else if (absGap <= 0.5) score += 30;
            else if (absGap <= 1.0) score += 15;
            // Beyond 1.0s = bystander (0 points)

            // ── Relative Position Score (0–30) ───────────────────────────
            // For 2x/4x (car contact), use physics to determine direction of impact
            if (snapshot.IncidentDelta >= 2)
            {
                // Rear-ended or brake-checked: favor car behind
                if (snapshot.PlayerLongAccel < -0.5 && driver.GapToPlayer < 0)
                {
                    score += 25;
                }
                // Pushed sideways: favor car on the side
                else if (Math.Abs(snapshot.PlayerLatAccel) > 0.5)
                {
                    // Car alongside (very small gap, either side)
                    if (absGap < 0.5) score += 20;
                }
                // Spin: favor car with highest closing speed
                else if (Math.Abs(snapshot.PlayerYawRate) > 2.0)
                {
                    if (driver.RelativeSpeed > 10) score += 25;
                    else if (driver.RelativeSpeed > 0) score += 15;
                }
                else
                {
                    // Generic proximity bonus for contact incidents
                    if (absGap < 0.3) score += 15;
                }
            }
            else
            {
                // 1x incident — likely off-track from proximity pressure
                if (absGap < 0.5) score += 10;
            }

            // ── Behavioral Context Score (0–30) ──────────────────────────

            // Repeat offender bonus
            if (_threatLedger.ContainsKey(driver.Name))
            {
                score += 15;
            }

            // Braking zone incident: favor car behind (dive-bomb / brake-check)
            if (snapshot.PlayerLongAccel < -0.3 && driver.GapToPlayer < 0)
            {
                score += 10;
            }

            // High closing speed
            if (driver.RelativeSpeed > 20)
            {
                score += 10;
            }

            return Math.Min(score, 100);
        }

        // ── Threat ledger ────────────────────────────────────────────────

        private void UpdateThreatLedger(NearbyDriver suspect, int severity, int lap)
        {
            if (!_threatLedger.TryGetValue(suspect.Name, out var entry))
            {
                entry = new DriverThreatEntry
                {
                    CarIdx = suspect.CarIdx,
                    Name = suspect.Name,
                    IRating = suspect.IRating
                };
                _threatLedger[suspect.Name] = entry;
            }

            entry.IncidentCount++;
            entry.TotalIncidentPoints += severity;
            entry.IncidentLaps.Add(lap);
            entry.LastIncidentTime = DateTime.UtcNow;

            // Escalate threat level (never decreases)
            ThreatLevel newLevel = ComputeThreatLevel(entry);
            if (newLevel > entry.Level)
            {
                entry.Level = newLevel;
                SimHub.Logging.Current.Info(
                    "[RaceCorProDrive] " + suspect.Name + " escalated to " + newLevel);
            }
        }

        private static ThreatLevel ComputeThreatLevel(DriverThreatEntry entry)
        {
            // Danger: 3+ incidents OR 2+ heavy (4x)
            if (entry.IncidentCount >= 3 || entry.TotalIncidentPoints >= 8)
                return ThreatLevel.Danger;

            // Caution: 2+ incidents OR 1 heavy (4x)
            if (entry.IncidentCount >= 2 || entry.TotalIncidentPoints >= 4)
                return ThreatLevel.Caution;

            // Watch: 1 incident
            if (entry.IncidentCount >= 1)
                return ThreatLevel.Watch;

            return ThreatLevel.None;
        }

        // ── Rage score ───────────────────────────────────────────────────

        private void UpdateRageScore(TelemetrySnapshot current, TelemetrySnapshot previous)
        {
            double secondsSinceIncident = (DateTime.UtcNow - _lastIncidentTime).TotalSeconds;

            // No rage computation if no incidents have occurred or decay window passed
            if (_lastIncidentTime == DateTime.MinValue || secondsSinceIncident > RageDecayWindowSeconds * 2)
            {
                _currentRageScore = Math.Max(0, _currentRageScore - 2); // Gentle decay to zero
                UpdateRageSpikeTracking();
                return;
            }

            // ── Throttle Aggression (0–25) ───────────────────────────────
            // Sustained full-throttle within decay window of an incident
            if (secondsSinceIncident < RageDecayWindowSeconds && current.Throttle > 95)
            {
                _throttleAggressionAccum = Math.Min(25, _throttleAggressionAccum + 0.5);
            }
            else
            {
                _throttleAggressionAccum = Math.Max(0, _throttleAggressionAccum - 0.3);
            }

            // ── Steering Erraticism (0–20) ───────────────────────────────
            // High-frequency steering input changes vs rolling average
            _recentSteeringAngles.Enqueue(current.SteeringWheelAngle);
            while (_recentSteeringAngles.Count > SteeringWindowSize)
                _recentSteeringAngles.Dequeue();

            if (_recentSteeringAngles.Count >= 2 && secondsSinceIncident < RageDecayWindowSeconds)
            {
                var angles = _recentSteeringAngles.ToArray();
                double sumDelta = 0;
                for (int i = 1; i < angles.Length; i++)
                {
                    sumDelta += Math.Abs(angles[i] - angles[i - 1]);
                }
                double avgDelta = sumDelta / (angles.Length - 1);

                // Threshold calibration: normal steering ~2-5 degrees/frame, erratic > 8
                _steeringErraticismAccum = Math.Min(20, Math.Max(0, (avgDelta - 5) * 2));
            }
            else
            {
                _steeringErraticismAccum = Math.Max(0, _steeringErraticismAccum - 0.5);
            }

            // ── Braking Aggression (0–20) ────────────────────────────────
            if (secondsSinceIncident < RageDecayWindowSeconds && current.Brake > 90)
            {
                _brakingAggressionAccum = Math.Min(20, _brakingAggressionAccum + 0.4);
            }
            else
            {
                _brakingAggressionAccum = Math.Max(0, _brakingAggressionAccum - 0.3);
            }

            // ── Proximity Chasing (0–25) ─────────────────────────────────
            // Are we actively closing on a flagged driver?
            if (secondsSinceIncident < RageDecayWindowSeconds)
            {
                bool chasingFlaggedDriver = false;
                double closestFlaggedGap = double.MaxValue;

                foreach (var entry in _threatLedger.Values)
                {
                    // Check if this driver is the nearest ahead or behind
                    if (entry.Name.Equals(current.NearestAheadName, StringComparison.OrdinalIgnoreCase))
                    {
                        closestFlaggedGap = Math.Min(closestFlaggedGap, current.GapAhead);
                        chasingFlaggedDriver = true;
                    }
                    else if (entry.Name.Equals(current.NearestBehindName, StringComparison.OrdinalIgnoreCase))
                    {
                        closestFlaggedGap = Math.Min(closestFlaggedGap, current.GapBehind);
                    }
                }

                if (chasingFlaggedDriver && closestFlaggedGap < 2.0)
                {
                    _proximityChaseAccum = Math.Min(25, _proximityChaseAccum + 0.8);
                }
                else
                {
                    _proximityChaseAccum = Math.Max(0, _proximityChaseAccum - 0.2);
                }
            }
            else
            {
                _proximityChaseAccum = Math.Max(0, _proximityChaseAccum - 0.3);
            }

            // ── Recency Decay ────────────────────────────────────────────
            double recencyMultiplier = 1.0;
            if (secondsSinceIncident > RageDecayWindowSeconds)
            {
                // Linear decay from 1.0 to 0.3 over the second decay window
                double t = (secondsSinceIncident - RageDecayWindowSeconds) / RageDecayWindowSeconds;
                recencyMultiplier = Math.Max(0.3, 1.0 - (0.7 * t));
            }

            // ── Frustration Cascade (Abou-Zeid 2011) ─────────────────────
            // Each incident in the session amplifies the rage score
            double cascadeMultiplier = 1.0 + (0.15 * Math.Min(_sessionIncidentCount - 1, 5));

            // ── Composite Score ──────────────────────────────────────────
            double rawScore = (_throttleAggressionAccum +
                               _steeringErraticismAccum +
                               _brakingAggressionAccum +
                               _proximityChaseAccum) * recencyMultiplier * cascadeMultiplier;

            _currentRageScore = Math.Min(100, Math.Max(0, rawScore));

            // Track rage spikes for behavior metrics
            UpdateRageSpikeTracking();
        }

        private void UpdateRageSpikeTracking()
        {
            if (_currentRageScore > 50 && !_inRageSpike)
            {
                _inRageSpike = true;
                _lastRageSpikeStart = DateTime.UtcNow;
                _behavior.RageSpikes++;
            }
            else if (_currentRageScore <= 30 && _inRageSpike)
            {
                _inRageSpike = false;
                double recoverySeconds = (DateTime.UtcNow - _lastRageSpikeStart).TotalSeconds;
                _behavior.TotalRageRecoverySeconds += recoverySeconds;
                _behavior.RageRecoveryCount++;
            }
        }

        // ── Cool-down ────────────────────────────────────────────────────

        private void UpdateCooldown(TelemetrySnapshot current)
        {
            // Auto-trigger cool-down when rage exceeds threshold
            if (!_cooldownActive && _currentRageScore >= CooldownThreshold)
            {
                _cooldownActive = true;
                _cooldownStartTime = DateTime.UtcNow;
                _behavior.CooldownsTriggered++;
                SimHub.Logging.Current.Info(
                    "[RaceCorProDrive] Auto cool-down triggered (rage: " +
                    _currentRageScore.ToString("F1") + ")");
            }

            // Check cool-down exit conditions
            if (_cooldownActive)
            {
                double elapsed = (DateTime.UtcNow - _cooldownStartTime).TotalSeconds;
                bool minTimeElapsed = elapsed >= MinCooldownSeconds;
                bool rageSubsided = _currentRageScore < CooldownExitRageThreshold;

                // Check gap to any flagged driver
                bool gapEstablished = true;
                foreach (var entry in _threatLedger.Values)
                {
                    if (entry.Level >= ThreatLevel.Caution)
                    {
                        if (entry.Name.Equals(current.NearestAheadName, StringComparison.OrdinalIgnoreCase) &&
                            current.GapAhead < DefaultCooldownGapTarget)
                        {
                            gapEstablished = false;
                        }
                        if (entry.Name.Equals(current.NearestBehindName, StringComparison.OrdinalIgnoreCase) &&
                            current.GapBehind < DefaultCooldownGapTarget)
                        {
                            gapEstablished = false;
                        }
                    }
                }

                if (minTimeElapsed && rageSubsided && gapEstablished)
                {
                    _cooldownActive = false;
                    SimHub.Logging.Current.Info("[RaceCorProDrive] Cool-down ended (rage: " +
                        _currentRageScore.ToString("F1") + ")");
                }
            }
        }

        // ── Proximity alerts ─────────────────────────────────────────────

        private IncidentAlert _currentAlert = new IncidentAlert();

        private void UpdateProximityAlerts(TelemetrySnapshot current)
        {
            _currentAlert = new IncidentAlert(); // Reset each frame

            foreach (var entry in _threatLedger.Values)
            {
                if (entry.Level == ThreatLevel.None) continue;

                double alertRange = AlertRanges[entry.Level] * AlertSensitivity;
                bool isAhead = false;
                double gap = double.MaxValue;

                // Check if this driver is nearby
                if (entry.Name.Equals(current.NearestAheadName, StringComparison.OrdinalIgnoreCase))
                {
                    gap = current.GapAhead;
                    isAhead = true;
                }
                else if (entry.Name.Equals(current.NearestBehindName, StringComparison.OrdinalIgnoreCase))
                {
                    gap = current.GapBehind;
                    isAhead = false;
                }

                if (gap < alertRange)
                {
                    // Pick the highest-threat alert if multiple flagged drivers are nearby
                    if (entry.Level > _currentAlert.ThreatLevel ||
                        (entry.Level == _currentAlert.ThreatLevel && gap < _currentAlert.GapSeconds))
                    {
                        _currentAlert.Active = true;
                        _currentAlert.DriverName = entry.Name;
                        _currentAlert.ThreatLevel = entry.Level;
                        _currentAlert.GapSeconds = gap;
                        _currentAlert.IsAhead = isAhead;
                        _currentAlert.TargetGap = DefaultCooldownGapTarget;

                        // Set voice priority based on threat level and rage score
                        _currentAlert.VoicePriority = ComputeVoicePriority(entry.Level);
                        _currentAlert.VoicePromptKey = ComputeVoicePromptKey(entry.Level, gap);
                    }
                }
            }

            // Track retaliation attempts
            if (_currentAlert.Active && _currentAlert.IsAhead &&
                _currentRageScore > 50 && _currentAlert.ThreatLevel >= ThreatLevel.Caution)
            {
                _behavior.RetaliationAttempts++;
            }
        }

        private int ComputeVoicePriority(ThreatLevel level)
        {
            if (_currentRageScore >= 85) return 5; // Critical
            if (_currentRageScore >= 70) return 4; // Urgent

            switch (level)
            {
                case ThreatLevel.Danger: return 3;
                case ThreatLevel.Caution: return 2;
                default: return 1;
            }
        }

        private string ComputeVoicePromptKey(ThreatLevel level, double gap)
        {
            if (_cooldownActive) return "cooldown_active";
            if (_currentRageScore >= 85) return "rage_critical";
            if (_currentRageScore >= 70) return "rage_warning";

            switch (level)
            {
                case ThreatLevel.Danger:
                    return gap < 1.0 ? "danger_close" : "danger_approaching";
                case ThreatLevel.Caution:
                    return "caution_approaching";
                default:
                    return "watch_info";
            }
        }

        // ── Behavior metrics ─────────────────────────────────────────────

        private void UpdateBehaviorMetrics(TelemetrySnapshot current, TelemetrySnapshot previous)
        {
            // Hard braking near another car
            if (current.Brake > 90 && (current.GapAhead < 1.0 || current.GapBehind < 1.0))
            {
                _behavior.HardBrakingEvents++;
            }

            // Tailgating detection (within 0.5s of car ahead for sustained period)
            if (current.GapAhead > 0 && current.GapAhead < 0.5)
            {
                // Approximate: each update at ~30fps adds ~0.033 seconds
                _behavior.TailgatingSeconds += 0.033;
            }

            // Off-track detection
            if (Math.Abs(current.VertAccel) > 8.0 && Math.Abs(previous.VertAccel) <= 8.0)
            {
                _behavior.OffTrackCount++;
            }

            // Spin detection
            if (Math.Abs(current.YawRate) > 5.0 && Math.Abs(previous.YawRate) <= 5.0)
            {
                _behavior.SpinCount++;
            }
        }

        // ── Serialization ────────────────────────────────────────────────

        private int _serializeFrameCounter;

        private void SerializeState()
        {
            // Serialize every 10 frames (~3x per second) to reduce overhead
            _serializeFrameCounter++;
            if (_serializeFrameCounter % 10 != 0) return;

            try
            {
                // Threat drivers
                var threats = _threatLedger.Values
                    .Where(t => t.Level > ThreatLevel.None)
                    .OrderByDescending(t => t.Level)
                    .ThenByDescending(t => t.TotalIncidentPoints)
                    .ToList();
                _threatDriversJson = JsonConvert.SerializeObject(threats);

                // Active alert
                _activeAlertJson = JsonConvert.SerializeObject(_currentAlert);

                // Behavior summary
                _sessionBehaviorJson = JsonConvert.SerializeObject(_behavior);
            }
            catch (Exception ex)
            {
                SimHub.Logging.Current.Warn("[RaceCorProDrive] IncidentCoach serialization error: " + ex.Message);
            }
        }
    }
}
