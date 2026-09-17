using System;
using System.Collections.Generic;

namespace RaceCorProDrive.Plugin.Engine
{
    /// <summary>
    /// Single frame of telemetry data for trigger evaluation.
    /// Pure data class — no SimHub dependencies.
    /// Capture logic lives in TelemetrySnapshot.Capture.cs.
    /// </summary>
    public partial class TelemetrySnapshot
    {
        // ── Normalized (game-agnostic) ──────────────────────────────────────
        public bool   GameRunning       { get; set; }
        public string GameName          { get; set; }
        public double SpeedKmh          { get; set; }
        public double Rpms              { get; set; }
        public double MaxRpm            { get; set; }
        public string Gear              { get; set; }
        public double Throttle          { get; set; }
        public double Brake             { get; set; }
        public double Clutch            { get; set; }
        public double FuelLevel         { get; set; }
        public double FuelPercent       { get; set; }
        public int    CurrentLap        { get; set; }
        public int    CompletedLaps     { get; set; }
        public double TrackPositionPct  { get; set; }
        public int    Position          { get; set; }
        public bool   IsInPit           { get; set; }
        public bool   IsInPitLane       { get; set; }
        public bool   PitLimiterOn      { get; set; }
        public double PitSpeedLimitKmh  { get; set; }
        public string SessionTypeName   { get; set; }
        public string CarModel          { get; set; } = "";
        public string TrackName         { get; set; } = "";
        public double TyreWearFL        { get; set; }
        public double TyreWearFR        { get; set; }
        public double TyreWearRL        { get; set; }
        public double TyreWearRR        { get; set; }

        // ── Physics — iRacing raw, with cross-game normalized fallback ───────
        // Available: iRacing, AC, ACC, AMS2 (via SimHub motion physics)
        public double LatAccel          { get; set; }
        public double LongAccel         { get; set; }
        public double VertAccel         { get; set; }
        public double YawRate           { get; set; }

        // ── Driver aids — cross-game where supported ─────────────────────────
        // AbsActive:  iRacing, AC, ACC, AMS2
        // TcActive:   AC, ACC, AMS2 (iRacing exposes TC differently)
        public bool   AbsActive         { get; set; }
        public bool   TcActive          { get; set; }

        // ── Tyre temperatures — cross-game where supported ───────────────────
        // Available: AC, ACC, AMS2; partially in iRacing
        public double TyreTempFL        { get; set; }
        public double TyreTempFR        { get; set; }
        public double TyreTempRL        { get; set; }
        public double TyreTempRR        { get; set; }

        // ── Environment — cross-game where supported ─────────────────────────
        // TrackTemp:  iRacing, AC, ACC, AMS2
        // WeatherWet: iRacing (flag), AC/AMS2 (RainIntensity > threshold)
        public double TrackTemp         { get; set; }
        public double AirTemp           { get; set; }
        public bool   WeatherWet        { get; set; }

        // ── Display units (iRacing user preference) ──────────────────────────
        // 0 = imperial (gallons, °F, mph), 1 = metric (liters, °C, km/h)
        // Default to metric — most SimHub data arrives in metric.
        public int    DisplayUnits      { get; set; } = 1;

        // ── Lap timing — iRacing raw, with cross-game normalized fallback ────
        // All fields available in most SimHub-supported games
        public double LapDeltaToBest    { get; set; }
        public double LapCurrentTime    { get; set; }
        public double LapLastTime       { get; set; }
        public double LapBestTime       { get; set; }
        public double SessionTimeRemain { get; set; }
        /// <summary>Laps remaining in session (iRacing SessionLapsRemainEx, avoids off-by-one).</summary>
        public int    SessionLapsRemaining { get; set; }
        /// <summary>Total laps in session (iRacing SessionLapsTotal, 0 for timed races).</summary>
        public int    SessionLapsTotal { get; set; }

        // ── World-space velocity (for track map dead reckoning) ──────────────
        // iRacing: VelocityX (lateral, car-local), VelocityZ (forward, car-local)
        // Yaw = heading angle (radians) — needed to convert local → world frame.
        public double VelocityX { get; set; }
        public double VelocityZ { get; set; }
        public double Yaw       { get; set; }

        // ── iRacing-only ─────────────────────────────────────────────────────
        public double SteeringWheelTorque { get; set; } // torque (Nm), not angle
        public double SteeringWheelAngle { get; set; } // angle (radians)
        public double FrameRate           { get; set; } // game render FPS
        public int    SessionFlags        { get; set; } // yellow/black/etc. bitmask
        public int    IncidentCount       { get; set; } // iRacing incident points
        /// <summary>Incident count at which a slowdown/drivethrough penalty is issued. 0 = unknown.</summary>
        public int    IncidentLimitPenalty { get; set; }
        /// <summary>Incident count at which the driver is disqualified. 0 = unknown.</summary>
        public int    IncidentLimitDQ     { get; set; }
        /// <summary>Whether the current lap has been invalidated by an incident.</summary>
        public bool IsLapInvalid { get; set; }

        /// <summary>Incident count at the start of the current lap.</summary>
        public int LapStartIncidents { get; set; }
        /// <summary>Player's license class string from iRacing (e.g. "A 3.41").</summary>
        public string LicenseString       { get; set; } = "";
        public int    DrsStatus           { get; set; }
        public double ErsBattery          { get; set; }
        public double MgukPower           { get; set; }
        /// <summary>True when the car has demonstrated ERS capability (battery seen > 0).</summary>
        public bool   HasErs              { get; set; }
        public int    IRating             { get; set; }
        public double SafetyRating        { get; set; }
        /// <summary>Estimated iRating change at current position (positive = gaining).</summary>
        public int    EstimatedIRatingDelta { get; set; }
        /// <summary>Number of cars in the field (for iRating estimation).</summary>
        public int    IRatingFieldSize     { get; set; }

        // ── Sector splits (computed by SectorTracker) ──────────────────────
        public int    CurrentSector      { get; set; } = 1;
        /// <summary>Number of sectors for this track (from iRacing SplitTimeInfo).</summary>
        public int    SectorCount        { get; set; } = 3;
        public double SectorSplitS1      { get; set; }
        public double SectorSplitS2      { get; set; }
        public double SectorSplitS3      { get; set; }
        public double SectorDeltaS1      { get; set; }
        public double SectorDeltaS2      { get; set; }
        public double SectorDeltaS3      { get; set; }
        /// <summary>0=none, 1=pb, 2=faster, 3=slower</summary>
        public int    SectorStateS1      { get; set; }
        // Sector boundary LapDistPct values (from iRacing SplitTimeInfo)
        public double SectorS2StartPct   { get; set; }
        public double SectorS3StartPct   { get; set; }
        public int    SectorStateS2      { get; set; }
        public int    SectorStateS3      { get; set; }

        // ── N-sector arrays (for tracks with >3 sectors) ─────────────────
        /// <summary>Split times for all sectors (N elements, 0-indexed).</summary>
        public double[] SectorSplits     { get; set; }
        /// <summary>Delta to best for all sectors (N elements, 0-indexed).</summary>
        public double[] SectorDeltas     { get; set; }
        /// <summary>State for all sectors: 0=none, 1=pb, 3=slower (N elements, 0-indexed).</summary>
        public int[]    SectorStates     { get; set; }
        /// <summary>Best split times for all sectors (N elements, 0-indexed).</summary>
        public double[] SectorBests      { get; set; }
        /// <summary>Sector boundary start percentages (N-1 elements, for sectors 2..N).</summary>
        public double[] SectorBoundaries { get; set; }

        // ── In-car adjustments (driver controls) ───────────────────────────
        // These change when the driver adjusts settings via button box / black box.
        // iRacing: dcBrakeBias, dcTractionControl, dcABS, dcAntiRollFront, dcAntiRollRear
        public double BrakeBias           { get; set; }
        public double TractionControlSetting { get; set; }
        public double AbsSetting          { get; set; }
        public double ArbFront            { get; set; }
        public double ArbRear             { get; set; }
        // Additional car adjustments (iRacing dc* variables)
        public double EnginePower         { get; set; }  // dcEnginePower
        public double FuelMixture         { get; set; }  // dcFuelMixture
        public double WeightJackerLeft    { get; set; }  // dcWeightJackerLeft
        public double WeightJackerRight   { get; set; }  // dcWeightJackerRight
        public double WingFront           { get; set; }  // dcWingFront (Gurney flap)
        public double WingRear            { get; set; }  // dcWingRear

        // ── Car-specific adjustment availability ─────────────────────────
        // True once the dc* variable has been seen non-zero during the session.
        // Resets on car change. Used to hide irrelevant rows in the pit box panel.
        public bool HasTC              { get; set; }
        public bool HasABS             { get; set; }
        public bool HasARBFront        { get; set; }
        public bool HasARBRear         { get; set; }
        public bool HasEnginePower     { get; set; }
        public bool HasFuelMixture     { get; set; }
        public bool HasWeightJackerL   { get; set; }
        public bool HasWeightJackerR   { get; set; }
        public bool HasWingFront       { get; set; }
        public bool HasWingRear        { get; set; }

        // ── Pit stop selections (iRacing read-only telemetry) ────────────
        // These reflect the driver's current pit menu selections.
        /// <summary>Bitmask of pit services requested (PitSvFlags enum).</summary>
        public int    PitSvFlags          { get; set; }
        /// <summary>Fuel to add in liters (pit menu selection).</summary>
        public double PitSvFuel           { get; set; }
        /// <summary>Left-front tire pressure in kPa (pit menu).</summary>
        public double PitSvLFP            { get; set; }
        /// <summary>Right-front tire pressure in kPa (pit menu).</summary>
        public double PitSvRFP            { get; set; }
        /// <summary>Left-rear tire pressure in kPa (pit menu).</summary>
        public double PitSvLRP            { get; set; }
        /// <summary>Right-rear tire pressure in kPa (pit menu).</summary>
        public double PitSvRRP            { get; set; }
        /// <summary>Tire compound selected for pit stop.</summary>
        public int    PitSvTireCompound   { get; set; }
        /// <summary>Fast repair requested (0 or 1).</summary>
        public int    PitSvFastRepair     { get; set; }
        /// <summary>Windshield tearoff requested (0 or 1).</summary>
        public int    PitSvWindshieldTearoff { get; set; }
        public float[] CarIdxLapDistPct   { get; set; } = new float[0];
        public bool[]  CarIdxOnPitRoad    { get; set; } = new bool[0];
        public int[]   CarIdxLapCompleted { get; set; } = new int[0];
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
        // SessionState: iRacing → 0=Invalid, 1=GetInCar, 2=Warmup, 3=ParadeLaps, 4=Racing, 5=Checkered, 6=Cooldown
        public int    SessionState      { get; set; }
        /// <summary>Number of cars that have left pit road and are on track.</summary>
        public int    GriddedCars       { get; set; }
        /// <summary>Total car count in the session.</summary>
        public int    TotalCars         { get; set; }
        /// <summary>iRacing PaceMode: 0=NotPacing, 1=Pacing, 2=Approaching, 3=FieldCrossSF.</summary>
        public int    PaceMode          { get; set; }
        /// <summary>True if the session uses a standing start (from iRacing WeekendOptions).</summary>
        public bool   IsStandingStart   { get; set; }
        /// <summary>ISO country code of the track location (e.g. "DE", "US", "GB").</summary>
        public string TrackCountry { get; set; } = "";

        // ── Country name → ISO 3166-1 alpha-2 code mapping ──────────────────
        // iRacing sends full country names (e.g. "USA", "Belgium"); we need
        // 2-letter ISO codes for the dashboard flags.json lookup.
        private static readonly Dictionary<string, string> CountryNameToISO =
            new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            // iRacing track countries (all current content)
            { "USA",                  "US" },
            { "United States",        "US" },
            { "United Kingdom",       "GB" },
            { "Great Britain",        "GB" },
            { "England",              "GB" },
            { "Belgium",              "BE" },
            { "France",               "FR" },
            { "Italy",                "IT" },
            { "Germany",              "DE" },
            { "Japan",                "JP" },
            { "Australia",            "AU" },
            { "Brazil",               "BR" },
            { "Spain",                "ES" },
            { "Portugal",             "PT" },
            { "Netherlands",          "NL" },
            { "The Netherlands",      "NL" },
            { "Austria",              "AT" },
            { "Hungary",              "HU" },
            { "Canada",               "CA" },
            { "Mexico",               "MX" },
            { "Bahrain",              "BH" },
            { "United Arab Emirates", "AE" },
            { "UAE",                  "AE" },
            { "Saudi Arabia",         "SA" },
            { "Singapore",            "SG" },
            { "Monaco",               "MC" },
            { "South Africa",         "ZA" },
            { "China",                "CN" },
            { "Qatar",                "QA" },
            { "South Korea",          "KR" },
            { "Korea",                "KR" },
            { "Malaysia",             "MY" },
            { "New Zealand",          "NZ" },
            { "Finland",              "FI" },
            { "Sweden",               "SE" },
            { "Norway",               "NO" },
            { "Denmark",              "DK" },
            { "Switzerland",          "CH" },
            { "Czech Republic",       "CZ" },
            { "Czechia",              "CZ" },
            { "Poland",               "PL" },
            { "Ireland",              "IE" },
            { "Argentina",            "AR" },
            { "India",                "IN" },
            { "Russia",               "RU" },
            { "Turkey",               "TR" },
            { "Romania",              "RO" },
            { "Scotland",             "GB" },
            { "Wales",                "GB" },
        };

        /// <summary>
        /// Normalizes a country string to a 2-letter ISO code.
        /// Handles iRacing full names ("USA", "Belgium"), existing ISO codes ("US", "BE"),
        /// and SimHub formats.
        /// </summary>
        public static string NormalizeCountryCode(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return "";
            string trimmed = raw.Trim();

            // Already a 2-letter ISO code?
            if (trimmed.Length == 2)
                return trimmed.ToUpperInvariant();

            // Already a 3-letter ISO code? Map common ones.
            if (trimmed.Length == 3)
            {
                string upper = trimmed.ToUpperInvariant();
                if (upper == "USA") return "US";
                if (upper == "GBR") return "GB";
                if (upper == "BEL") return "BE";
                if (upper == "FRA") return "FR";
                if (upper == "ITA") return "IT";
                if (upper == "DEU" || upper == "GER") return "DE";
                if (upper == "JPN") return "JP";
                if (upper == "AUS") return "AU";
                if (upper == "BRA") return "BR";
                if (upper == "ESP") return "ES";
                if (upper == "PRT") return "PT";
                if (upper == "NLD") return "NL";
                if (upper == "AUT") return "AT";
                if (upper == "HUN") return "HU";
                if (upper == "CAN") return "CA";
                if (upper == "MEX") return "MX";
                if (upper == "BHR") return "BH";
                if (upper == "ARE") return "AE";
                if (upper == "SAU") return "SA";
                if (upper == "SGP") return "SG";
                if (upper == "MCO") return "MC";
                if (upper == "ZAF") return "ZA";
                if (upper == "CHN") return "CN";
                if (upper == "QAT") return "QA";
                if (upper == "KOR") return "KR";
                if (upper == "MYS") return "MY";
                if (upper == "NZL") return "NZ";
                if (upper == "FIN") return "FI";
                if (upper == "SWE") return "SE";
                if (upper == "NOR") return "NO";
                if (upper == "DNK") return "DK";
                if (upper == "CHE") return "CH";
                if (upper == "CZE") return "CZ";
                if (upper == "POL") return "PL";
                if (upper == "IRL") return "IE";
                if (upper == "ARG") return "AR";
                if (upper == "IND") return "IN";
                if (upper == "RUS") return "RU";
                if (upper == "TUR") return "TR";
                if (upper == "ROU") return "RO";
            }

            // Full country name lookup
            if (CountryNameToISO.TryGetValue(trimmed, out string code))
                return code;

            // Last resort: return first 2 chars uppercased (better than nothing)
            return trimmed.Length >= 2
                ? trimmed.Substring(0, 2).ToUpperInvariant()
                : trimmed.ToUpperInvariant();
        }

        // ── iRacing flag bitmasks (from irsdk_Flags enum) ────────────────────
        public const int FLAG_CHECKERED = 0x0001;
        public const int FLAG_WHITE     = 0x0002;
        public const int FLAG_GREEN     = 0x0004;
        public const int FLAG_YELLOW    = 0x0008 | 0x4000 | 0x8000; // yellow | caution | caution_waving
        public const int FLAG_RED       = 0x0010;
        public const int FLAG_BLUE      = 0x0020;
        public const int FLAG_DEBRIS    = 0x0040;
        public const int FLAG_BLACK     = 0x00010000;
        public const int FLAG_REPAIR    = 0x100000;   // meatball flag — mechanical issue, pit for repairs

        // ── Start position (captured once at race start for delta) ──────────
        public int    StartPosition     { get; set; }

        // ── Derived flags ────────────────────────────────────────────────────
        public bool IsDebrisFlag  => (SessionFlags & FLAG_DEBRIS) != 0;
        public bool IsRepairFlag  => (SessionFlags & FLAG_REPAIR) != 0;

        // ═══════════════════════════════════════════════════════════════════════
        //  COMPUTED DS.* PROPERTIES — server-side calculations
        //  These replace client-side JS math, reducing per-frame overhead.
        // ═══════════════════════════════════════════════════════════════════════

        /// <summary>Throttle normalized 0–1 (SimHub reports 0–100).</summary>
        public double ThrottleNorm => Throttle / 100.0;

        /// <summary>Brake normalized 0–1 (SimHub reports 0–100).</summary>
        public double BrakeNorm => Brake / 100.0;

        /// <summary>Clutch normalized 0–1 (SimHub reports 0–100).</summary>
        public double ClutchNorm => Clutch / 100.0;

        /// <summary>RPM ratio 0–1 (clamped).</summary>
        public double RpmRatio => MaxRpm > 0 ? System.Math.Min(1.0, Rpms / MaxRpm) : 0;

        /// <summary>Fuel percentage 0–100.</summary>
        public double FuelPct => FuelPercent;

        /// <summary>Estimated laps of fuel remaining.</summary>
        public double FuelLapsRemaining => FuelPerLap > 0.01 ? FuelLevel / FuelPerLap : 99;

        /// <summary>Speed in miles per hour.</summary>
        public double SpeedMph => SpeedKmh * 0.621371;

        /// <summary>Pit speed limit in mph.</summary>
        public double PitSpeedLimitMph => PitSpeedLimitKmh * 0.621371;

        /// <summary>True when in pit lane and exceeding the speed limit.</summary>
        public bool IsPitSpeeding => IsInPitLane && PitSpeedLimitKmh > 0 && SpeedKmh > PitSpeedLimitKmh;

        /// <summary>Canonical session mode — single source of truth for all consumers.</summary>
        public enum SessionModeEnum
        {
            Unknown = 0,
            Practice = 1,
            Qualifying = 2,
            Warmup = 3,
            Race = 4
        }

        /// <summary>
        /// Computed session mode from SessionTypeName string.
        /// Single source of truth — overlay and web dashboard should use this
        /// instead of parsing SessionTypeName independently.
        /// </summary>
        public SessionModeEnum SessionMode
        {
            get
            {
                if (string.IsNullOrEmpty(SessionTypeName)) return SessionModeEnum.Unknown;
                var s = SessionTypeName.ToLowerInvariant();
                if (s.Contains("practice") || s.Contains("test")) return SessionModeEnum.Practice;
                if (s.Contains("qualify") || s.Contains("qual")) return SessionModeEnum.Qualifying;
                if (s.Contains("warmup") || s.Contains("warm up")) return SessionModeEnum.Warmup;
                if (s.Length > 0) return SessionModeEnum.Race;
                return SessionModeEnum.Unknown;
            }
        }

        /// <summary>Whether this is a lap-limited race (not timed).</summary>
        public bool IsLapRace => SessionMode == SessionModeEnum.Race
            && SessionLapsTotal > 0 && SessionLapsTotal <= 9999;

        /// <summary>True for practice, qualifying, test, or warmup sessions.</summary>
        public bool IsNonRaceSession
        {
            get
            {
                if (string.IsNullOrEmpty(SessionTypeName)) return false;
                var s = SessionTypeName.ToLowerInvariant();
                return s.Contains("practice") || s.Contains("qualify") || s.Contains("test")
                    || s.Contains("warmup") || s.Contains("warm up");
            }
        }

        /// <summary>True when SessionTimeRemain is actively counting down (timed race).</summary>
        public bool IsTimedRace => SessionTimeRemain > 0;

        /// <summary>True when checkered flag is out.</summary>
        public bool IsEndOfRace => (SessionFlags & FLAG_CHECKERED) != 0;

        /// <summary>Positions gained since start (positive = gained, negative = lost).</summary>
        public int PositionDelta => StartPosition > 0 && Position > 0 ? StartPosition - Position : 0;

        /// <summary>Session remaining time formatted as H:MM:SS or M:SS.</summary>
        public string RemainingTimeFormatted
        {
            get
            {
                if (SessionTimeRemain <= 0) return "";
                int totalSec = (int)SessionTimeRemain;
                int h = totalSec / 3600;
                int m = (totalSec % 3600) / 60;
                int s = totalSec % 60;
                return h > 0
                    ? string.Format("{0}:{1:D2}:{2:D2}", h, m, s)
                    : string.Format("{0}:{1:D2}", m, s);
            }
        }

        // ═══════════════════════════════════════════════════════════════════════
        //  DISPLAY-READY STRINGS — avoid client-side Math.round / toFixed
        // ═══════════════════════════════════════════════════════════════════════

        /// <summary>Speed rounded to integer string, or "0".</summary>
        public string SpeedDisplay => SpeedKmh > 0 ? ((int)System.Math.Round(SpeedKmh)).ToString() : "0";

        /// <summary>RPM rounded to integer string, or "0".</summary>
        public string RpmDisplay => Rpms > 0 ? ((int)System.Math.Round(Rpms)).ToString() : "0";

        // ── Unit conversions ──
        private bool IsImperial => DisplayUnits == 0;
        private static double LitersToGallons(double l) => l * 0.264172;
        private string FuelUnitLabel => IsImperial ? "gal" : "L";

        /// <summary>Fuel level formatted to 1 decimal with unit, or "—".</summary>
        public string FuelFormatted => FuelLevel > 0
            ? (IsImperial ? LitersToGallons(FuelLevel) : FuelLevel).ToString("F1")
            : "\u2014";

        /// <summary>Fuel per lap formatted to 2 decimals, or "—".</summary>
        public string FuelPerLapFormatted => FuelPerLap > 0
            ? (IsImperial ? LitersToGallons(FuelPerLap) : FuelPerLap).ToString("F2")
            : "\u2014";

        /// <summary>Pit fuel suggestion like "PIT in ~5 laps", or empty if not applicable.</summary>
        public string PitSuggestion
        {
            get
            {
                double lapsEst = FuelLapsRemaining;
                if (lapsEst <= 0 || lapsEst >= 99 || RemainingLaps <= 0) return "";
                if (lapsEst < RemainingLaps)
                    return "PIT in ~" + ((int)System.Math.Ceiling(lapsEst)).ToString() + " laps";
                return "";
            }
        }

        /// <summary>Brake bias normalized 0–1 (maps 30–70% to 0–1).</summary>
        public double BBNorm => System.Math.Min(1.0, System.Math.Max(0.0, (BrakeBias - 30.0) / 40.0));

        /// <summary>Traction control setting normalized 0–1 (0–12 scale).</summary>
        public double TCNorm => System.Math.Min(1.0, TractionControlSetting / 12.0);

        /// <summary>ABS setting normalized 0–1 (0–12 scale).</summary>
        public double ABSNorm => System.Math.Min(1.0, AbsSetting / 12.0);

        /// <summary>Position delta as display string: "▲ 2", "▼ 1", or empty.</summary>
        public string PositionDeltaDisplay
        {
            get
            {
                int d = PositionDelta;
                if (d > 0) return "\u25B2 " + d.ToString();
                if (d < 0) return "\u25BC " + System.Math.Abs(d).ToString();
                return "";
            }
        }

        /// <summary>Lap delta to best as "+0.123" / "-0.456", or empty.</summary>
        public string LapDeltaDisplay
        {
            get
            {
                if (LapLastTime <= 0 || LapBestTime <= 0) return "";
                double delta = LapLastTime - LapBestTime;
                return (delta >= 0 ? "+" : "") + delta.ToString("F3");
            }
        }

        /// <summary>Safety rating formatted to 2 decimals, or "—".</summary>
        public string SafetyRatingDisplay => SafetyRating > 0 ? SafetyRating.ToString("F2") : "\u2014";

        /// <summary>Gap to car ahead, formatted with sign: "-1.23", or "—".</summary>
        public string GapAheadFormatted => GapAhead > 0 ? "-" + GapAhead.ToString("F2") : "\u2014";

        /// <summary>Gap to car behind, formatted with sign: "+1.23", or "—".</summary>
        public string GapBehindFormatted => GapBehind > 0 ? "+" + GapBehind.ToString("F2") : "\u2014";

        // ═══════════════════════════════════════════════════════════════════════
        //  PIT BOX — computed display properties for pit stop panel
        // ═══════════════════════════════════════════════════════════════════════

        // iRacing PitSvFlags bitmask constants
        public const int PIT_SV_LF_TIRE   = 0x01;
        public const int PIT_SV_RF_TIRE   = 0x02;
        public const int PIT_SV_LR_TIRE   = 0x04;
        public const int PIT_SV_RR_TIRE   = 0x08;
        public const int PIT_SV_FUEL      = 0x10;
        public const int PIT_SV_WINDSHIELD = 0x20;
        public const int PIT_SV_FAST_REPAIR = 0x40;

        /// <summary>True when left-front tire change is selected.</summary>
        public bool PitTireLF => (PitSvFlags & PIT_SV_LF_TIRE) != 0;
        /// <summary>True when right-front tire change is selected.</summary>
        public bool PitTireRF => (PitSvFlags & PIT_SV_RF_TIRE) != 0;
        /// <summary>True when left-rear tire change is selected.</summary>
        public bool PitTireLR => (PitSvFlags & PIT_SV_LR_TIRE) != 0;
        /// <summary>True when right-rear tire change is selected.</summary>
        public bool PitTireRR => (PitSvFlags & PIT_SV_RR_TIRE) != 0;
        /// <summary>True when any tire change is selected.</summary>
        public bool PitTiresRequested => (PitSvFlags & 0x0F) != 0;
        /// <summary>True when fuel fill is selected.</summary>
        public bool PitFuelRequested => (PitSvFlags & PIT_SV_FUEL) != 0;
        /// <summary>True when fast repair is selected.</summary>
        public bool PitFastRepairRequested => (PitSvFlags & PIT_SV_FAST_REPAIR) != 0;
        /// <summary>True when windshield tearoff is selected.</summary>
        public bool PitWindshieldRequested => (PitSvFlags & PIT_SV_WINDSHIELD) != 0;

        /// <summary>Pit fuel formatted with user's unit preference, or "—".</summary>
        public string PitFuelDisplay => PitFuelRequested && PitSvFuel > 0
            ? (IsImperial ? LitersToGallons(PitSvFuel) : PitSvFuel).ToString("F1") + " " + FuelUnitLabel
            : "\u2014";

        /// <summary>Convert kPa to PSI for display.</summary>
        private static double KpaToPsi(double kpa) => kpa * 0.14503773773;
        private string PressureUnitLabel => IsImperial ? "psi" : "kPa";

        /// <summary>Format pit pressure in user's unit (psi for imperial, kPa for metric).</summary>
        private string FormatPitPressure(bool changing, double kpa)
        {
            if (!changing || kpa <= 0) return "\u2014";
            return IsImperial ? KpaToPsi(kpa).ToString("F1") : kpa.ToString("F0");
        }

        /// <summary>LF pit pressure formatted, or "—".</summary>
        public string PitPressureLFDisplay => FormatPitPressure(PitTireLF, PitSvLFP);
        /// <summary>RF pit pressure formatted, or "—".</summary>
        public string PitPressureRFDisplay => FormatPitPressure(PitTireRF, PitSvRFP);
        /// <summary>LR pit pressure formatted, or "—".</summary>
        public string PitPressureLRDisplay => FormatPitPressure(PitTireLR, PitSvLRP);
        /// <summary>RR pit pressure formatted, or "—".</summary>
        public string PitPressureRRDisplay => FormatPitPressure(PitTireRR, PitSvRRP);
    }
}
