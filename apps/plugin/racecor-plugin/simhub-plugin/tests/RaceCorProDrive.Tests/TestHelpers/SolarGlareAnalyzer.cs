using System;
using System.Collections.Generic;

namespace RaceCorProDrive.Tests.TestHelpers
{
    /// <summary>
    /// Computes real-time solar glare severity for a driver based on:
    ///   - Track real-world GPS coordinates (latitude/longitude)
    ///   - Session time of day (seconds since midnight)
    ///   - Day of year (for solar declination)
    ///   - Driver heading (yaw angle from telemetry)
    ///
    /// Uses standard NOAA solar position algorithms (no external API).
    /// Standalone reimplementation for testing — no SimHub dependencies.
    /// </summary>
    public class SolarGlareAnalyzer
    {
        // ── Constants ───────────────────────────────────────────────────────
        private const double DegToRad = Math.PI / 180.0;
        private const double RadToDeg = 180.0 / Math.PI;

        /// <summary>
        /// Sun must be above this elevation (degrees) to produce meaningful glare.
        /// Below ~2° the atmosphere scatters most direct light.
        /// </summary>
        public const double MinSunElevation = 2.0;

        /// <summary>
        /// Maximum sun elevation (degrees) where glare is still a problem.
        /// Above ~45° the sun is too high to blind through a windscreen.
        /// </summary>
        public const double MaxGlareElevation = 45.0;

        /// <summary>
        /// Half-width (degrees) of the angular cone centered on the driver's
        /// forward view where the sun produces direct glare.
        /// ±30° covers the full windscreen field of view.
        /// </summary>
        public const double GlareHalfAngle = 30.0;

        /// <summary>Cooldown between glare calls in seconds.</summary>
        public const double CooldownSeconds = 300.0; // 5 minutes

        /// <summary>Display duration for a glare strategy call in seconds.</summary>
        public const double CallDisplaySeconds = 12.0;

        // ── Track coordinate database ───────────────────────────────────────
        private readonly Dictionary<string, TrackCoordinate> _trackCoordinates;

        // ── Cooldown state ──────────────────────────────────────────────────
        private DateTime _lastCallTime = DateTime.MinValue;

        // ── Public output state ─────────────────────────────────────────────

        /// <summary>Glare severity: 0.0 = none, 1.0 = maximum (sun dead ahead, low angle).</summary>
        public double GlareSeverity { get; private set; }

        /// <summary>Human-readable glare direction relative to driver: "ahead", "ahead-left", "ahead-right".</summary>
        public string GlareDirection { get; private set; } = "";

        /// <summary>Current solar elevation angle in degrees (0° = horizon, 90° = zenith).</summary>
        public double SunElevation { get; private set; }

        /// <summary>Current solar azimuth angle in degrees from north (0° = N, 90° = E, 180° = S, 270° = W).</summary>
        public double SunAzimuth { get; private set; }

        /// <summary>Angular distance between driver heading and sun azimuth (0° = dead ahead).</summary>
        public double AngleToSun { get; private set; }

        // ═══════════════════════════════════════════════════════════════════
        //  CONSTRUCTION
        // ═══════════════════════════════════════════════════════════════════

        public SolarGlareAnalyzer()
            : this(TrackCoordinateDatabase.GetDefaultCoordinates()) { }

        public SolarGlareAnalyzer(Dictionary<string, TrackCoordinate> trackCoordinates)
        {
            _trackCoordinates = trackCoordinates ?? throw new ArgumentNullException(nameof(trackCoordinates));
        }

        // ═══════════════════════════════════════════════════════════════════
        //  SOLAR POSITION (NOAA / Meeus algorithm)
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>
        /// Calculates solar declination for a given day of year.
        /// Uses the simplified approximation: δ = -23.45° × cos(360/365 × (d + 10))
        /// Accuracy: within ~1° of true value (sufficient for glare detection).
        /// </summary>
        public static double SolarDeclination(int dayOfYear)
        {
            if (dayOfYear < 1 || dayOfYear > 366)
                throw new ArgumentOutOfRangeException(nameof(dayOfYear), "Day of year must be 1-366");

            return -23.45 * Math.Cos(DegToRad * (360.0 / 365.0) * (dayOfYear + 10));
        }

        /// <summary>
        /// Calculates the hour angle in degrees for a given time of day.
        /// Hour angle = 0° at solar noon, +15° per hour afternoon, -15° per hour morning.
        /// </summary>
        /// <param name="timeOfDaySeconds">Seconds since midnight (local solar time).</param>
        /// <param name="longitudeDeg">Longitude in degrees (east positive).</param>
        /// <returns>Hour angle in degrees.</returns>
        public static double HourAngle(double timeOfDaySeconds, double longitudeDeg)
        {
            // Solar noon occurs when the sun crosses the local meridian.
            // For simplicity, we approximate: solar noon ≈ 12:00 local solar time
            // adjusted by longitude offset from the time zone meridian.
            // iRacing sessions use local track time, so longitude correction
            // is already embedded in the session time.
            double solarHours = timeOfDaySeconds / 3600.0;
            return 15.0 * (solarHours - 12.0);
        }

        /// <summary>
        /// Calculates solar elevation angle (altitude above horizon) in degrees.
        /// α = arcsin(sin(φ) × sin(δ) + cos(φ) × cos(δ) × cos(H))
        /// </summary>
        /// <param name="latitudeDeg">Observer latitude in degrees.</param>
        /// <param name="declinationDeg">Solar declination in degrees.</param>
        /// <param name="hourAngleDeg">Hour angle in degrees.</param>
        /// <returns>Solar elevation in degrees (-90 to +90). Negative = below horizon.</returns>
        public static double SolarElevation(double latitudeDeg, double declinationDeg, double hourAngleDeg)
        {
            double lat = latitudeDeg * DegToRad;
            double dec = declinationDeg * DegToRad;
            double ha  = hourAngleDeg * DegToRad;

            double sinElev = Math.Sin(lat) * Math.Sin(dec)
                           + Math.Cos(lat) * Math.Cos(dec) * Math.Cos(ha);

            // Clamp to [-1, 1] to avoid NaN from floating point drift
            sinElev = Math.Max(-1.0, Math.Min(1.0, sinElev));
            return Math.Asin(sinElev) * RadToDeg;
        }

        /// <summary>
        /// Calculates solar azimuth (compass bearing from north, clockwise) in degrees.
        /// A = arccos((sin(δ) − sin(α) × sin(φ)) / (cos(α) × cos(φ)))
        /// Corrected to 0–360 range based on hour angle sign.
        /// </summary>
        public static double SolarAzimuth(double latitudeDeg, double declinationDeg,
                                           double hourAngleDeg, double elevationDeg)
        {
            double lat   = latitudeDeg * DegToRad;
            double dec   = declinationDeg * DegToRad;
            double elev  = elevationDeg * DegToRad;

            double cosElev = Math.Cos(elev);
            if (Math.Abs(cosElev) < 1e-10)
                return 0.0; // Sun is directly overhead (zenith), azimuth undefined

            double cosAz = (Math.Sin(dec) - Math.Sin(elev) * Math.Sin(lat))
                         / (cosElev * Math.Cos(lat));

            // Clamp for floating-point safety
            cosAz = Math.Max(-1.0, Math.Min(1.0, cosAz));
            double azimuth = Math.Acos(cosAz) * RadToDeg;

            // Afternoon: azimuth is in [180, 360] range
            if (hourAngleDeg > 0)
                azimuth = 360.0 - azimuth;

            return azimuth;
        }

        // ═══════════════════════════════════════════════════════════════════
        //  GLARE ANALYSIS
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>
        /// Computes the shortest angular distance between two compass bearings.
        /// Returns a signed angle: positive = sun is to the right, negative = to the left.
        /// Magnitude is always ≤ 180°.
        /// </summary>
        public static double SignedAngleDifference(double fromDeg, double toDeg)
        {
            double diff = ((toDeg - fromDeg) % 360.0 + 540.0) % 360.0 - 180.0;
            return diff;
        }

        /// <summary>
        /// Converts iRacing yaw (radians, 0 = north, positive = clockwise)
        /// to compass bearing in degrees (0 = north, clockwise).
        /// </summary>
        public static double YawToCompassBearing(double yawRadians)
        {
            double degrees = yawRadians * RadToDeg;
            return ((degrees % 360.0) + 360.0) % 360.0;
        }

        /// <summary>
        /// Computes glare severity (0–1) based on angular distance to sun and sun elevation.
        ///
        /// Glare is worst when:
        ///   - Sun is dead ahead (angle = 0°)
        ///   - Sun is low on the horizon (elevation 5–15°)
        ///
        /// Glare falls off:
        ///   - Linearly with angle from dead ahead (0 at ±GlareHalfAngle)
        ///   - With a ramp at low elevation (0 below MinSunElevation)
        ///   - With a ramp at high elevation (0 above MaxGlareElevation, peak at 5–15°)
        /// </summary>
        public static double ComputeGlareSeverity(double angleToSunDeg, double sunElevationDeg)
        {
            // Sun below horizon or below minimum elevation: no glare
            if (sunElevationDeg < MinSunElevation)
                return 0.0;

            // Sun above maximum glare elevation: no glare through windscreen
            if (sunElevationDeg > MaxGlareElevation)
                return 0.0;

            // Absolute angle from dead ahead
            double absAngle = Math.Abs(angleToSunDeg);
            if (absAngle > GlareHalfAngle)
                return 0.0;

            // Angular factor: 1.0 when dead ahead, linear ramp to 0 at GlareHalfAngle
            double angleFactor = 1.0 - (absAngle / GlareHalfAngle);

            // Elevation factor: peak at 5-15°, ramp down to 0 at MinSunElevation and MaxGlareElevation
            double elevFactor;
            if (sunElevationDeg < 5.0)
            {
                // Ramp up from MinSunElevation to 5°
                elevFactor = (sunElevationDeg - MinSunElevation) / (5.0 - MinSunElevation);
            }
            else if (sunElevationDeg <= 15.0)
            {
                // Peak zone: full severity
                elevFactor = 1.0;
            }
            else
            {
                // Ramp down from 15° to MaxGlareElevation
                elevFactor = 1.0 - (sunElevationDeg - 15.0) / (MaxGlareElevation - 15.0);
            }

            elevFactor = Math.Max(0.0, Math.Min(1.0, elevFactor));
            return angleFactor * elevFactor;
        }

        /// <summary>
        /// Determines the human-readable glare direction based on signed angle.
        /// </summary>
        public static string GetGlareDirection(double signedAngleDeg)
        {
            double abs = Math.Abs(signedAngleDeg);
            if (abs > GlareHalfAngle) return "";

            if (abs < 8.0)
                return "ahead";
            if (signedAngleDeg > 0)
                return "ahead-right";
            return "ahead-left";
        }

        // ═══════════════════════════════════════════════════════════════════
        //  FRAME UPDATE
        // ═══════════════════════════════════════════════════════════════════

        /// <summary>
        /// Per-frame update: computes solar position and glare severity from telemetry.
        /// </summary>
        /// <param name="current">Current telemetry frame.</param>
        /// <param name="dayOfYear">Day of year (1-366). Passed explicitly for testability.</param>
        public void UpdateFrame(TelemetrySnapshot current, int dayOfYear)
        {
            // Reset output
            GlareSeverity  = 0.0;
            GlareDirection = "";
            SunElevation   = 0.0;
            SunAzimuth     = 0.0;
            AngleToSun     = 0.0;

            if (current == null || !current.GameRunning) return;

            // Look up track coordinates
            if (string.IsNullOrEmpty(current.TrackId)) return;
            if (!_trackCoordinates.TryGetValue(current.TrackId, out var coord)) return;

            // Need valid time of day
            if (current.SessionTimeOfDay <= 0) return;

            // Compute solar position
            double declination = SolarDeclination(dayOfYear);
            double hourAngle   = HourAngle(current.SessionTimeOfDay, coord.Longitude);
            double elevation   = SolarElevation(coord.Latitude, declination, hourAngle);
            double azimuth     = SolarAzimuth(coord.Latitude, declination, hourAngle, elevation);

            SunElevation = elevation;
            SunAzimuth   = azimuth;

            // Convert driver yaw to compass bearing
            double driverBearing = YawToCompassBearing(current.Yaw);

            // Signed angle from driver heading to sun
            double signedAngle = SignedAngleDifference(driverBearing, azimuth);
            AngleToSun = signedAngle;

            // Compute glare
            GlareSeverity  = ComputeGlareSeverity(signedAngle, elevation);
            GlareDirection = GlareSeverity > 0 ? GetGlareDirection(signedAngle) : "";
        }

        /// <summary>
        /// Evaluates whether a glare strategy call should fire.
        /// Returns null if no call needed (severity too low or cooldown active).
        /// </summary>
        public StrategyCall EvaluateGlare(DateTime now)
        {
            if (GlareSeverity < 0.3)
                return null;

            if ((now - _lastCallTime).TotalSeconds < CooldownSeconds)
                return null;

            _lastCallTime = now;

            int severity = GlareSeverity >= 0.7 ? 3 : 2;
            string direction = string.IsNullOrEmpty(GlareDirection) ? "ahead" : GlareDirection;
            string message = severity >= 3
                ? $"Strong sun glare {direction} — brake markers may be hard to see"
                : $"Sun glare {direction} — be aware of reduced visibility";

            return new StrategyCall
            {
                Label       = "GLARE",
                Message     = message,
                Severity    = severity,
                DisplayedAt = now
            };
        }

        /// <summary>Resets cooldown state (for testing).</summary>
        public void ResetCooldown()
        {
            _lastCallTime = DateTime.MinValue;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  TRACK COORDINATES
    // ═══════════════════════════════════════════════════════════════════════

    /// <summary>GPS coordinates for a track's real-world location.</summary>
    public class TrackCoordinate
    {
        public double Latitude  { get; set; }
        public double Longitude { get; set; }

        /// <summary>UTC offset in hours for the track's local timezone.</summary>
        public double UtcOffset { get; set; }

        public TrackCoordinate(double latitude, double longitude, double utcOffset = 0)
        {
            Latitude  = latitude;
            Longitude = longitude;
            UtcOffset = utcOffset;
        }
    }

    /// <summary>Strategy call emitted by analysis modules.</summary>
    public class StrategyCall
    {
        public string   Label       { get; set; } = "";
        public string   Message     { get; set; } = "";
        public int      Severity    { get; set; }
        public DateTime DisplayedAt { get; set; }
    }

    /// <summary>
    /// Default track coordinate database covering all iRacing tracks.
    /// Coordinates are real-world GPS positions of each circuit.
    /// </summary>
    public static class TrackCoordinateDatabase
    {
        public static Dictionary<string, TrackCoordinate> GetDefaultCoordinates()
        {
            return new Dictionary<string, TrackCoordinate>(StringComparer.OrdinalIgnoreCase)
            {
                // ── Europe ──────────────────────────────────────────────
                ["spa-francorchamps"]       = new TrackCoordinate(50.4372, 5.9714, 1),
                ["silverstone"]             = new TrackCoordinate(52.0786, -1.0169, 0),
                ["monza"]                   = new TrackCoordinate(45.6156, 9.2811, 1),
                ["nurburgring"]             = new TrackCoordinate(50.3356, 6.9475, 1),
                ["nurburgring-nordschleife"] = new TrackCoordinate(50.3356, 6.9475, 1),
                ["barcelona"]               = new TrackCoordinate(41.5700, 2.2611, 1),
                ["hungaroring"]             = new TrackCoordinate(47.5789, 19.2486, 1),
                ["red-bull-ring"]           = new TrackCoordinate(47.2197, 14.7647, 1),
                ["imola"]                   = new TrackCoordinate(44.3439, 11.7167, 1),
                ["brands-hatch"]            = new TrackCoordinate(51.3569, 0.2631, 0),
                ["donington"]               = new TrackCoordinate(52.8306, -1.3747, 0),
                ["knockhill"]               = new TrackCoordinate(56.1297, -3.5172, 0),
                ["oulton-park"]             = new TrackCoordinate(53.1778, -2.6128, 0),
                ["snetterton"]              = new TrackCoordinate(52.4622, 0.9464, 0),
                ["zandvoort"]               = new TrackCoordinate(52.3888, 4.5409, 1),
                ["portimao"]                = new TrackCoordinate(37.2272, -8.6267, 0),
                ["mugello"]                 = new TrackCoordinate(43.9975, 11.3719, 1),
                ["hockenheim"]              = new TrackCoordinate(49.3278, 8.5656, 1),

                // ── North America ───────────────────────────────────────
                ["daytona"]                 = new TrackCoordinate(29.1853, -81.0706, -5),
                ["indianapolis"]            = new TrackCoordinate(39.7950, -86.2350, -5),
                ["road-america"]            = new TrackCoordinate(43.7978, -87.9892, -6),
                ["watkins-glen"]            = new TrackCoordinate(42.3369, -76.9272, -5),
                ["laguna-seca"]             = new TrackCoordinate(36.5842, -121.7531, -8),
                ["road-atlanta"]            = new TrackCoordinate(34.1464, -83.8114, -5),
                ["sebring"]                 = new TrackCoordinate(27.4544, -81.3481, -5),
                ["cota"]                    = new TrackCoordinate(30.1328, -97.6411, -6),
                ["long-beach"]              = new TrackCoordinate(33.7653, -118.1892, -8),
                ["mid-ohio"]                = new TrackCoordinate(40.6847, -82.6353, -5),
                ["mosport"]                 = new TrackCoordinate(44.0475, -78.6756, -5),
                ["lime-rock"]               = new TrackCoordinate(41.9283, -73.3822, -5),
                ["sonoma"]                  = new TrackCoordinate(38.1614, -122.4550, -8),
                ["virginia-international"]  = new TrackCoordinate(38.0264, -79.2092, -5),
                ["charlotte"]               = new TrackCoordinate(35.3522, -80.6828, -5),
                ["talladega"]               = new TrackCoordinate(33.5667, -86.0636, -6),
                ["bristol"]                 = new TrackCoordinate(36.5153, -82.2569, -5),
                ["phoenix"]                 = new TrackCoordinate(33.3753, -112.3108, -7),
                ["michigan"]                = new TrackCoordinate(42.0650, -84.2403, -5),
                ["pocono"]                  = new TrackCoordinate(41.0558, -75.5097, -5),
                ["dover"]                   = new TrackCoordinate(39.1900, -75.5300, -5),
                ["homestead"]               = new TrackCoordinate(25.4517, -80.4078, -5),
                ["texas-motor-speedway"]    = new TrackCoordinate(33.0372, -97.2811, -6),
                ["iowa"]                    = new TrackCoordinate(41.6794, -93.0086, -6),
                ["richmond"]                = new TrackCoordinate(37.5933, -77.4197, -5),
                ["martinsville"]            = new TrackCoordinate(36.6339, -79.8506, -5),
                ["kansas"]                  = new TrackCoordinate(39.1156, -94.8308, -6),
                ["las-vegas"]               = new TrackCoordinate(36.2717, -115.0100, -8),
                ["new-hampshire"]           = new TrackCoordinate(43.3633, -71.4611, -5),
                ["chicago"]                 = new TrackCoordinate(41.4758, -88.0578, -6),
                ["atlanta"]                 = new TrackCoordinate(33.3867, -84.3167, -5),

                // ── Asia / Oceania ──────────────────────────────────────
                ["suzuka"]                  = new TrackCoordinate(34.8431, 136.5406, 9),
                ["fuji"]                    = new TrackCoordinate(35.3725, 138.9269, 9),
                ["mount-panorama"]          = new TrackCoordinate(-33.4439, 149.5583, 10),
                ["phillip-island"]          = new TrackCoordinate(-38.5000, 145.2333, 10),

                // ── Middle East ─────────────────────────────────────────
                ["bahrain"]                 = new TrackCoordinate(26.0325, 50.5106, 3),
                ["yas-marina"]              = new TrackCoordinate(24.4672, 54.6031, 4),
                ["jeddah"]                  = new TrackCoordinate(21.6319, 39.1044, 3),

                // ── South America ───────────────────────────────────────
                ["interlagos"]              = new TrackCoordinate(-23.7014, -46.6972, -3),

                // ── Africa ──────────────────────────────────────────────
                ["kyalami"]                 = new TrackCoordinate(-25.9911, 28.0722, 2),
            };
        }
    }
}
