namespace RaceCorProDrive.Tests.TestHelpers
{
    /// <summary>
    /// Single frame of telemetry data for trigger evaluation.
    /// Pure data class — no SimHub dependencies.
    /// </summary>
    public class TelemetrySnapshot
    {
        // ── Normalized (game-agnostic) ──────────────────────────────────────
        public bool   GameRunning       { get; set; }
        public string GameName          { get; set; }
        public double SpeedKmh          { get; set; }
        public double Rpms              { get; set; }
        public string Gear              { get; set; }
        public double Throttle          { get; set; }
        public double Brake             { get; set; }
        public double FuelLevel         { get; set; }
        public double FuelPercent       { get; set; }
        public int    CurrentLap        { get; set; }
        public int    CompletedLaps     { get; set; }
        public double TrackPositionPct  { get; set; }
        public int    Position          { get; set; }
        public bool   IsInPit           { get; set; }
        public bool   IsInPitLane       { get; set; }
        public string SessionTypeName   { get; set; }
        public double TyreWearFL        { get; set; }
        public double TyreWearFR        { get; set; }
        public double TyreWearRL        { get; set; }
        public double TyreWearRR        { get; set; }

        // ── Physics — iRacing raw, with cross-game normalized fallback ───────
        public double LatAccel          { get; set; }
        public double LongAccel         { get; set; }
        public double VertAccel         { get; set; }
        public double YawRate           { get; set; }

        // ── Driver aids — cross-game where supported ─────────────────────────
        public bool   AbsActive         { get; set; }
        public bool   TcActive          { get; set; }

        // ── Tyre temperatures — cross-game where supported ───────────────────
        public double TyreTempFL        { get; set; }
        public double TyreTempFR        { get; set; }
        public double TyreTempRL        { get; set; }
        public double TyreTempRR        { get; set; }

        // ── Environment — cross-game where supported ─────────────────────────
        public double TrackTemp         { get; set; }
        public double AirTemp           { get; set; }
        public bool   WeatherWet        { get; set; }

        // ── Lap timing — iRacing raw, with cross-game normalized fallback ────
        public double LapDeltaToBest    { get; set; }
        public double LapCurrentTime    { get; set; }
        public double LapLastTime       { get; set; }
        public double LapBestTime       { get; set; }
        public double SessionTimeRemain { get; set; }

        // ── World-space — heading and velocity ──────────────────────────────
        public double Yaw               { get; set; }   // heading angle (radians, 0 = north, CW positive)
        public double VelocityX         { get; set; }
        public double VelocityZ         { get; set; }

        // ── Session time — for solar calculations ───────────────────────────
        /// <summary>Session time of day in seconds since midnight (iRacing: SessionTimeOfDay).</summary>
        public double SessionTimeOfDay  { get; set; }

        // ── Track identity — slug for coordinate lookups ────────────────────
        public string TrackId           { get; set; } = "";

        // ── iRacing-only ─────────────────────────────────────────────────────
        public double SteeringWheelTorque { get; set; }
        public double SteeringWheelAngle  { get; set; }
        public int    SessionFlags        { get; set; }
        public int    IncidentCount       { get; set; }
        public int    DrsStatus           { get; set; }
        public double ErsBattery          { get; set; }
        public double MgukPower           { get; set; }
        public float[] CarIdxLapDistPct   { get; set; } = new float[0];
        public bool[]  CarIdxOnPitRoad    { get; set; } = new bool[0];
        public int     PlayerCarIdx       { get; set; }

        // ── Nearest opponents (populated from Opponents list) ────────────────
        public string NearestAheadName   { get; set; } = "";
        public int    NearestAheadRating { get; set; }
        public string NearestBehindName  { get; set; } = "";
        public int    NearestBehindRating { get; set; }

        // ── Gap times (seconds) — from IRacingExtraProperties plugin ───────
        public double GapAhead  { get; set; }
        public double GapBehind { get; set; }

        // ── Fuel computation — from SimHub computed properties ──────────────
        public double FuelPerLap     { get; set; }
        public double RemainingLaps  { get; set; }

        // ── Player identity — from game data ────────────────────────────────
        public string PlayerName { get; set; } = "";

        // ── Grid / Formation lap state ─────────────────────────────────────
        public int    SessionState      { get; set; }
        public int    GriddedCars       { get; set; }
        public int    TotalCars         { get; set; }
        public int    PaceMode          { get; set; }
        public string TrackCountry { get; set; } = "";

        // ── iRacing flag bitmasks (from irsdk_Flags enum) ────────────────────
        public const int FLAG_CHECKERED = 0x0001;
        public const int FLAG_WHITE     = 0x0002;
        public const int FLAG_GREEN     = 0x0004;
        public const int FLAG_YELLOW    = 0x0008 | 0x4000 | 0x8000;
        public const int FLAG_RED       = 0x0010;
        public const int FLAG_BLUE      = 0x0020;
        public const int FLAG_DEBRIS    = 0x0040;
        public const int FLAG_BLACK     = 0x00010000;

        // ── Derived flags ────────────────────────────────────────────────────
        public bool IsDebrisFlag => (SessionFlags & FLAG_DEBRIS) != 0;
    }
}
