using System;
using System.Collections.Generic;

namespace RaceCorProDrive.Plugin.Models
{
    /// <summary>Threat level assigned to a driver based on attributed incident history.</summary>
    public enum ThreatLevel
    {
        /// <summary>No attributed incidents with this driver.</summary>
        None = 0,
        /// <summary>One minor incident (1x-2x). Informational only.</summary>
        Watch = 1,
        /// <summary>Two or more incidents, or one heavy (4x). Active warnings triggered.</summary>
        Caution = 2,
        /// <summary>Three or more incidents, or two or more heavy. Full intervention mode.</summary>
        Danger = 3
    }

    /// <summary>
    /// A nearby driver captured at the moment of an incident event.
    /// Used by the attribution algorithm to determine who caused contact.
    /// </summary>
    public class NearbyDriver
    {
        /// <summary>iRacing car index (position in CarIdx arrays).</summary>
        public int CarIdx { get; set; }

        /// <summary>Driver name as reported by the sim.</summary>
        public string Name { get; set; } = "";

        /// <summary>Driver's iRating (0 if unavailable).</summary>
        public int IRating { get; set; }

        /// <summary>Track position as fraction (0.0–1.0) from CarIdxLapDistPct.</summary>
        public double LapDistPct { get; set; }

        /// <summary>Gap to player in seconds. Positive = ahead, negative = behind.</summary>
        public double GapToPlayer { get; set; }

        /// <summary>Closing speed relative to player in km/h. Positive = approaching.</summary>
        public double RelativeSpeed { get; set; }

        /// <summary>Whether this driver is currently on pit road.</summary>
        public bool OnPitRoad { get; set; }

        /// <summary>Attribution score assigned by the scoring algorithm (0–100).</summary>
        public double AttributionScore { get; set; }
    }

    /// <summary>
    /// Snapshot of all nearby cars at the moment an incident is detected.
    /// Captured when IncidentCount increments between telemetry frames.
    /// </summary>
    public class ProximitySnapshot
    {
        /// <summary>Timestamp when the incident was detected.</summary>
        public DateTime Timestamp { get; set; }

        /// <summary>Player's car index in iRacing.</summary>
        public int PlayerCarIdx { get; set; }

        /// <summary>Player's track position (0.0–1.0).</summary>
        public double PlayerLapDistPct { get; set; }

        /// <summary>Player speed in km/h at moment of incident.</summary>
        public double PlayerSpeed { get; set; }

        /// <summary>Player lateral acceleration in G at moment of incident.</summary>
        public double PlayerLatAccel { get; set; }

        /// <summary>Player longitudinal acceleration in G at moment of incident.</summary>
        public double PlayerLongAccel { get; set; }

        /// <summary>Player yaw rate at moment of incident (spin detection).</summary>
        public double PlayerYawRate { get; set; }

        /// <summary>Incident point delta (1, 2, or 4 for iRacing).</summary>
        public int IncidentDelta { get; set; }

        /// <summary>Current lap number when incident occurred.</summary>
        public int Lap { get; set; }

        /// <summary>All drivers within detection range at moment of incident.</summary>
        public List<NearbyDriver> NearbyDrivers { get; set; } = new List<NearbyDriver>();
    }

    /// <summary>
    /// Persistent per-session record of a driver who has been attributed incidents.
    /// Threat level only escalates within a session — never decreases.
    /// </summary>
    public class DriverThreatEntry
    {
        /// <summary>iRacing car index.</summary>
        public int CarIdx { get; set; }

        /// <summary>Driver name.</summary>
        public string Name { get; set; } = "";

        /// <summary>Driver iRating.</summary>
        public int IRating { get; set; }

        /// <summary>Number of incidents attributed to this driver.</summary>
        public int IncidentCount { get; set; }

        /// <summary>Sum of incident points (1x + 2x + 4x) attributed.</summary>
        public int TotalIncidentPoints { get; set; }

        /// <summary>Lap numbers where incidents with this driver occurred.</summary>
        public List<int> IncidentLaps { get; set; } = new List<int>();

        /// <summary>Timestamp of most recent incident with this driver.</summary>
        public DateTime LastIncidentTime { get; set; }

        /// <summary>Current threat level. Only escalates within a session.</summary>
        public ThreatLevel Level { get; set; } = ThreatLevel.None;
    }

    /// <summary>
    /// Active alert state broadcast to the overlay via HTTP API.
    /// Describes the current proximity warning for a flagged driver.
    /// </summary>
    public class IncidentAlert
    {
        /// <summary>Whether an alert is currently active.</summary>
        public bool Active { get; set; }

        /// <summary>Name of the flagged driver triggering the alert.</summary>
        public string DriverName { get; set; } = "";

        /// <summary>Threat level of the alerting driver.</summary>
        public ThreatLevel ThreatLevel { get; set; }

        /// <summary>Current gap to the flagged driver in seconds.</summary>
        public double GapSeconds { get; set; }

        /// <summary>Whether the driver is ahead or behind. True = ahead.</summary>
        public bool IsAhead { get; set; }

        /// <summary>Recommended target gap in seconds (2.5s default).</summary>
        public double TargetGap { get; set; } = 2.5;

        /// <summary>Priority level for voice coaching (1–5).</summary>
        public int VoicePriority { get; set; } = 1;

        /// <summary>Suggested voice prompt key for the overlay.</summary>
        public string VoicePromptKey { get; set; } = "";
    }

    /// <summary>
    /// Cumulative behavior metrics tracked throughout a session.
    /// Used for both real-time coaching and post-session debrief.
    /// </summary>
    public class BehaviorMetrics
    {
        // ── Aggression ───────────────────────────────────────────────────

        /// <summary>Count of hard braking events (>90%) within 1s of a nearby car.</summary>
        public int HardBrakingEvents { get; set; }

        /// <summary>Number of passes completed within 0.3s gap.</summary>
        public int ClosePassCount { get; set; }

        /// <summary>Cumulative seconds spent less than 0.5s behind another car.</summary>
        public double TailgatingSeconds { get; set; }

        // ── Consistency ──────────────────────────────────────────────────

        /// <summary>Number of off-track events (VertAccel spike).</summary>
        public int OffTrackCount { get; set; }

        /// <summary>Number of spin events (YawRate spike).</summary>
        public int SpinCount { get; set; }

        /// <summary>Laps completed without any incident.</summary>
        public int CleanLaps { get; set; }

        /// <summary>Total laps completed.</summary>
        public int TotalLaps { get; set; }

        // ── Composure ────────────────────────────────────────────────────

        /// <summary>Number of times rage score exceeded 50.</summary>
        public int RageSpikes { get; set; }

        /// <summary>Number of cool-down activations (manual or automatic).</summary>
        public int CooldownsTriggered { get; set; }

        /// <summary>Number of detected retaliation approaches (closing on flagged driver while rage > 50).</summary>
        public int RetaliationAttempts { get; set; }

        /// <summary>Sum of all rage recovery durations in seconds (for averaging).</summary>
        public double TotalRageRecoverySeconds { get; set; }

        /// <summary>Number of rage recovery events (for averaging).</summary>
        public int RageRecoveryCount { get; set; }
    }
}
