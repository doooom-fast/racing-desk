using System.Collections.Generic;

namespace RaceCorProDrive.Plugin.Models
{
    public class CommentaryTopicsFile
    {
        public string Version { get; set; }
        public List<CommentaryTopic> Topics { get; set; } = new List<CommentaryTopic>();
    }

    public class CommentaryTopic
    {
        public string Id { get; set; }
        public string Category { get; set; }
        public string Title { get; set; }
        public string Description { get; set; }
        public string Sentiment { get; set; }

        /// <summary>
        /// Event severity 1-5. Higher values can interrupt lower-severity prompts.
        /// 1 = ambient/informational, 2 = notable, 3 = significant, 4 = urgent, 5 = critical.
        /// </summary>
        public int Severity { get; set; } = 2;

        /// <summary>
        /// Short, repeatable on-air description of the event for event-only display mode.
        /// Uses {value} placeholder for the triggering data value.
        /// Example: "Tyre temps over {value}°C — fronts are overheating"
        /// </summary>
        public string EventExposition { get; set; }

        public List<string> SessionTypes { get; set; } = new List<string>();
        public List<TriggerCondition> Triggers { get; set; } = new List<TriggerCondition>();
        public List<string> CommentaryPrompts { get; set; } = new List<string>();
        public double CooldownMinutes { get; set; } = 2.0;
    }

    /// <summary>
    /// Fragment-based composition data for a single topic. Allows assembly of unique
    /// sentences from opener + body + closer fragments at runtime.
    /// </summary>
    public class TopicFragments
    {
        public string TopicId { get; set; }
        public FragmentSet Fragments { get; set; }
    }

    public class FragmentSet
    {
        public List<string> Openers { get; set; } = new List<string>();
        public List<string> Bodies { get; set; } = new List<string>();
        public List<string> Closers { get; set; } = new List<string>();
    }

    /// <summary>
    /// Root object for commentary_fragments.json deserialization.
    /// </summary>
    public class CommentaryFragmentsFile
    {
        public List<TopicFragments> Fragments { get; set; } = new List<TopicFragments>();
    }

    /// <summary>
    /// Root object for commentary_tracks.json deserialization.
    /// Maps track IDs to their commentary metadata (nicknames, corners, talking points).
    /// </summary>
    public class CommentaryTracksFile
    {
        public string Version { get; set; }
        public Dictionary<string, TrackCommentaryData> Tracks { get; set; } = new Dictionary<string, TrackCommentaryData>();
    }

    /// <summary>
    /// Track-specific commentary data for placeholder resolution.
    /// Provides {track}, {trackNickname}, {corner}, and {trackFact} values.
    /// </summary>
    public class TrackCommentaryData
    {
        public string DisplayName { get; set; } = "";
        public string Nickname { get; set; } = "";
        public List<string> FamousCorners { get; set; } = new List<string>();
        public List<string> TalkingPoints { get; set; } = new List<string>();
        public List<string> NotableRaces { get; set; } = new List<string>();
        public List<string> Images { get; set; } = new List<string>();
        public int BuiltYear { get; set; }
    }

    /// <summary>
    /// Root object for commentary_cars.json deserialization.
    /// Maps car model substrings to their commentary metadata.
    /// </summary>
    public class CommentaryCarsFile
    {
        public string Version { get; set; }
        public Dictionary<string, CarCommentaryData> Cars { get; set; } = new Dictionary<string, CarCommentaryData>();
        public Dictionary<string, ManufacturerCommentaryData> Manufacturers { get; set; } = new Dictionary<string, ManufacturerCommentaryData>();
    }

    /// <summary>
    /// Car-specific commentary data for placeholder resolution.
    /// Provides {carFact}, {carCharacter}, {engineSpec}, {carNickname} values.
    /// </summary>
    public class CarCommentaryData
    {
        public string DisplayName { get; set; } = "";
        public string Manufacturer { get; set; } = "";
        public string Class { get; set; } = "";
        public string EngineLayout { get; set; } = "";
        public string EngineSpec { get; set; } = "";
        public string Nickname { get; set; } = "";

        /// <summary>Lead designer or chief engineer behind this car.</summary>
        public string Designer { get; set; } = "";

        public List<string> TalkingPoints { get; set; } = new List<string>();
        public List<string> DrivingCharacter { get; set; } = new List<string>();

        /// <summary>Notable drivers associated with this car (real-world, not sim).</summary>
        public List<string> NotableDrivers { get; set; } = new List<string>();

        /// <summary>Image URLs for this car (Wikimedia Commons, etc.).</summary>
        public List<string> Images { get; set; } = new List<string>();
    }

    /// <summary>
    /// Manufacturer-specific commentary data for placeholder resolution.
    /// Provides {manufacturerFact}, {racingPhilosophy} values.
    /// </summary>
    public class ManufacturerCommentaryData
    {
        public string DisplayName { get; set; } = "";

        /// <summary>ISO 3166-1 alpha-2 country code for flag display (e.g. "GB", "DE", "JP").</summary>
        public string CountryCode { get; set; } = "";

        /// <summary>Founder(s) of the company.</summary>
        public string Founder { get; set; } = "";

        public string RacingPhilosophy { get; set; } = "";
        public List<string> TalkingPoints { get; set; } = new List<string>();
    }

    public class TriggerCondition
    {
        /// <summary>
        /// The telemetry field to watch. See TelemetrySnapshot for supported names.
        /// </summary>
        public string DataPoint { get; set; }

        /// <summary>
        /// Comparison type: >, <, ==, change, increase, decrease, sustained, spike,
        /// sudden_drop, extreme, rapid_change, personal_best, player_gain_position,
        /// player_lost_position, player_entering, off_track, yellow_flag, black_flag,
        /// race_start, close_proximity
        /// </summary>
        public string Condition { get; set; }

        /// <summary>Threshold value for >, <, == comparisons.</summary>
        public double? Value { get; set; }

        /// <summary>Absolute value threshold for "extreme" condition.</summary>
        public double? AbsValue { get; set; }

        /// <summary>Minimum delta for "spike" or "sudden_drop" conditions.</summary>
        public double? ThresholdDelta { get; set; }

        /// <summary>Proximity fraction (0-1) for close_proximity.</summary>
        public double? ProximityThreshold { get; set; }

        public string Context { get; set; }
    }
}
