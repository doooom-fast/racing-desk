using System;
using System.Collections.Generic;

namespace RacingDesk.Data
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
        /// <summary>iRacing's WeekendInfo.Category: Road, SportsCar, Formula, Oval, DirtRoad, DirtOval.</summary>
        public string Category { get; set; }
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
        /// <summary>Each car in the entry list once, the driver's own included. Stored in <c>cars</c>.</summary>
        public List<CarRecord> Cars { get; } = new List<CarRecord>();
    }

    /// <summary>A car as a session's entry list names it: iRacing's folder name for it, and what it calls it.</summary>
    public sealed class CarRecord
    {
        public string CarPath { get; set; }
        public string Name { get; set; }
        public string ShortName { get; set; }
        public int CarId { get; set; }

        /// <summary>One record per car from a list of drivers' cars; a car without a name is left out.</summary>
        public static List<CarRecord> Distinct(IEnumerable<RacingDesk.Plugin.IRacing.DriverCar> drivers)
        {
            var cars = new List<CarRecord>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var d in drivers)
            {
                if (string.IsNullOrWhiteSpace(d.CarPath) || string.IsNullOrWhiteSpace(d.CarScreenName) || !seen.Add(d.CarPath)) continue;
                cars.Add(new CarRecord
                {
                    CarPath = d.CarPath,
                    Name = d.CarScreenName.Trim(),
                    ShortName = string.IsNullOrWhiteSpace(d.CarScreenNameShort) ? null : d.CarScreenNameShort.Trim(),
                    CarId = d.CarID,
                });
            }
            return cars;
        }
    }

    /// <summary>What is known of a car's pedals beside its profile.</summary>
    public sealed class CarPedalFacts
    {
        /// <summary>Laps without the ABS ever working, after which a car is taken to have none.</summary>
        public const int LapsToSayNoAbs = 3;

        public string CarPath { get; set; }
        public string CarName { get; set; }

        /// <summary>The brake force the car was last driven with, kilograms; null while none is known.</summary>
        public double? ForceKg { get; set; }
        public DateTime? ForceAtUtc { get; set; }

        /// <summary>The car has published an ABS setting, or its ABS has been seen working.</summary>
        public bool AbsSeen { get; set; }

        /// <summary>Laps driven before any ABS was seen.</summary>
        public int LapsWithoutAbs { get; set; }

        /// <summary>
        /// Yes once seen; no after enough laps of none — which a later sight of it puts right; null until then.
        /// </summary>
        public bool? HasAbs => AbsSeen ? true : LapsWithoutAbs >= LapsToSayNoAbs ? false : (bool?)null;

        /// <summary>"rule", "driver", or "none" when the driver chose that the car has no profile; null when nobody has.</summary>
        public string GivenBy { get; set; }

        /// <summary>What the rule went by: "ABS", "no ABS", "a formula car", "a prototype".</summary>
        public string GivenWhy { get; set; }

        public DateTime SeenAtUtc { get; set; }
    }

    /// <summary>What the header pass made of one ingested .ibt file.</summary>
    public sealed class ScannedFile
    {
        public string Path { get; set; }
        /// <summary>The cars in its entry list; null for a file that could not be read or is no longer there.</summary>
        public IReadOnlyList<CarRecord> Cars { get; set; }
        /// <summary>When it was recorded, for the cars it names without a stored session.</summary>
        public DateTime RecordedAtUtc { get; set; }
    }

    /// <summary>Which of SmartControl's pedal profiles a car is driven with.</summary>
    public sealed class CarPedals
    {
        public string CarPath { get; set; }
        /// <summary>What the sim calls the car, when the store has been told; read, never stored with the pedals.</summary>
        public string CarName { get; set; }
        public string ProfileId { get; set; }
        public string ProfileName { get; set; }
        /// <summary>The profile as SmartControl had it when the car was given it, byte for byte.</summary>
        public byte[] Profile { get; set; }
        /// <summary>The brake force the car was last driven with, when that is known; null until it is.</summary>
        public double? BrakeForceKg { get; set; }
        public DateTime BoundAtUtc { get; set; }
    }

    /// <summary>A row of the <c>cars</c> table with how often the driver's own sessions were in that car.</summary>
    public sealed class CarSummary
    {
        public string CarPath { get; set; }
        public string Name { get; set; }
        public string ShortName { get; set; }
        public int? CarId { get; set; }
        public int Driven { get; set; }
        public int Seen { get; set; }
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
        /// <summary>First lap after getting in the car (standing start, pit exit, tow). Not stored.</summary>
        public bool OutLap { get; set; }
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
