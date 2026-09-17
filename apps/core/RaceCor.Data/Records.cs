using System;
using System.Collections.Generic;

namespace RaceCor.Data
{
    /// <summary>One driven session (practice, qualifying, race, test…) as stored locally.</summary>
    public sealed class SessionRecord
    {
        public long Id { get; set; }
        public string Source { get; set; }          // "ibt" | "live"
        public string IbtPath { get; set; }
        public int SessionNum { get; set; }
        public long SubsessionId { get; set; }
        public long SessionId { get; set; }
        public int SeriesId { get; set; }
        public int SeasonId { get; set; }
        public int RaceWeek { get; set; }
        public string EventType { get; set; }
        public string SessionType { get; set; }
        public bool Official { get; set; }
        public int TrackId { get; set; }
        public string TrackName { get; set; }
        public string TrackDisplayName { get; set; }
        public string TrackConfig { get; set; }
        public double TrackLengthKm { get; set; }
        public string CarPath { get; set; }
        public int CarId { get; set; }
        public string CarScreenName { get; set; }
        public int CarClassId { get; set; }
        public DateTime StartedAtUtc { get; set; }
        public double DurationSeconds { get; set; }
        public long DriverCustId { get; set; }
        public string DriverName { get; set; }
        public int IRating { get; set; }
        public string License { get; set; }
        public double SafetyRating { get; set; }
        public int LapsCompleted { get; set; }
        public double BestLapSeconds { get; set; }
        public int Incidents { get; set; }
        public int StartPosition { get; set; }
        public int FinishPosition { get; set; }
        public int FinishPositionInClass { get; set; }
        public int FieldSize { get; set; }
        public int StrengthOfField { get; set; }

        public List<LapRecord> Laps { get; } = new List<LapRecord>();
        public List<IncidentRecord> IncidentEvents { get; } = new List<IncidentRecord>();
        public List<GridEntryRecord> Grid { get; } = new List<GridEntryRecord>();
    }

    public sealed class LapRecord
    {
        public int Lap { get; set; }
        public double LapTimeSeconds { get; set; }
        /// <summary>No incidents, never off track, never on pit road.</summary>
        public bool Clean { get; set; }
        public int Incidents { get; set; }
        public double FuelUsedLiters { get; set; }
        public bool Pitted { get; set; }
        public double StartSessionTime { get; set; }
        public int Position { get; set; }
    }

    public sealed class IncidentRecord
    {
        public double SessionTime { get; set; }
        public int Lap { get; set; }
        public double LapDistPct { get; set; }
        public int Points { get; set; }
    }

    public sealed class GridEntryRecord
    {
        public int CarIdx { get; set; }
        public long CustId { get; set; }
        public string Name { get; set; }
        public int IRating { get; set; }
        public string License { get; set; }
        public int CarClassId { get; set; }
        public string CarScreenName { get; set; }
        public int FinishPosition { get; set; }
        public int ClassPosition { get; set; }
        public int LapsComplete { get; set; }
        public double FastestLapSeconds { get; set; }
        public int Incidents { get; set; }
        public string ReasonOut { get; set; }
        public bool IsPlayer { get; set; }
    }

    /// <summary>A track outline derived from the user's own Lat/Lon telemetry.</summary>
    public sealed class TrackGeometryRecord
    {
        public int TrackId { get; set; }
        public string TrackName { get; set; }
        public double LengthMeters { get; set; }
        public double OfficialLengthMeters { get; set; }
        public int CleanLaps { get; set; }
        public string SourceIbt { get; set; }
        public double OriginLat { get; set; }
        public double OriginLon { get; set; }
        /// <summary>x (east, m), y (north, m), z (altitude, m) per LapDistPct bin.</summary>
        public float[] Points { get; set; }
        public double[] SectorStartPcts { get; set; }
        public DateTime UpdatedAtUtc { get; set; }
    }
}
