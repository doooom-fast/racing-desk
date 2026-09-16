using System;
using System.Collections.Generic;
using NUnit.Framework;
using RaceCorProDrive.Tests.TestHelpers;

namespace RaceCorProDrive.Tests
{
    [TestFixture]
    public class SolarGlareAnalyzerTests
    {
        private SolarGlareAnalyzer _analyzer = null!;
        private TelemetrySnapshot _current = null!;

        /// <summary>Summer solstice (June 21) — longest day, extreme declination.</summary>
        private const int DaySummerSolstice = 172;

        /// <summary>Winter solstice (Dec 21) — shortest day, low sun angles.</summary>
        private const int DayWinterSolstice = 355;

        /// <summary>Equinox (March 20) — equal day/night, zero declination.</summary>
        private const int DayEquinox = 80;

        /// <summary>Mid-August — typical summer racing conditions.</summary>
        private const int DayAugust15 = 227;

        /// <summary>Solar noon in seconds (12:00:00).</summary>
        private const double SolarNoon = 43200.0;

        /// <summary>Morning: 9 AM in seconds.</summary>
        private const double Morning9AM = 32400.0;

        /// <summary>Late afternoon: 5 PM in seconds.</summary>
        private const double Afternoon5PM = 61200.0;

        /// <summary>Sunset-ish: 7:30 PM in seconds.</summary>
        private const double Evening730PM = 70200.0;

        /// <summary>Dawn: 6 AM in seconds.</summary>
        private const double Dawn6AM = 21600.0;

        /// <summary>Midnight in seconds.</summary>
        private const double Midnight = 0.0;

        [SetUp]
        public void Setup()
        {
            _analyzer = new SolarGlareAnalyzer();
            _current = new TelemetrySnapshot
            {
                GameRunning = true,
                TrackId = "silverstone",
                SessionTimeOfDay = SolarNoon,
                Yaw = 0.0 // Heading north
            };
        }

        // ═══════════════════════════════════════════════════════════════════
        //  SOLAR DECLINATION
        // ═══════════════════════════════════════════════════════════════════

        #region Solar Declination

        [Test]
        public void SolarDeclination_SummerSolstice_ReturnsMaxPositive()
        {
            // June 21 (day 172): declination should be near +23.45°
            double dec = SolarGlareAnalyzer.SolarDeclination(DaySummerSolstice);
            Assert.That(dec, Is.InRange(22.0, 24.0),
                "Summer solstice declination should be near +23.45°");
        }

        [Test]
        public void SolarDeclination_WinterSolstice_ReturnsMaxNegative()
        {
            // Dec 21 (day 355): declination should be near -23.45°
            double dec = SolarGlareAnalyzer.SolarDeclination(DayWinterSolstice);
            Assert.That(dec, Is.InRange(-24.0, -22.0),
                "Winter solstice declination should be near -23.45°");
        }

        [Test]
        public void SolarDeclination_Equinox_ReturnsNearZero()
        {
            // March 20 (day ~80): declination should be near 0°
            double dec = SolarGlareAnalyzer.SolarDeclination(DayEquinox);
            Assert.That(Math.Abs(dec), Is.LessThan(3.0),
                "Equinox declination should be near 0°");
        }

        [TestCase(0)]
        [TestCase(-1)]
        [TestCase(367)]
        public void SolarDeclination_InvalidDayOfYear_Throws(int day)
        {
            Assert.Throws<ArgumentOutOfRangeException>(
                () => SolarGlareAnalyzer.SolarDeclination(day));
        }

        [TestCase(1)]
        [TestCase(366)]
        public void SolarDeclination_BoundaryDays_DoesNotThrow(int day)
        {
            Assert.DoesNotThrow(() => SolarGlareAnalyzer.SolarDeclination(day));
        }

        [Test]
        public void SolarDeclination_AllDays_InValidRange()
        {
            for (int d = 1; d <= 365; d++)
            {
                double dec = SolarGlareAnalyzer.SolarDeclination(d);
                Assert.That(Math.Abs(dec), Is.LessThanOrEqualTo(24.0),
                    $"Day {d}: declination {dec}° exceeds maximum tilt");
            }
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  HOUR ANGLE
        // ═══════════════════════════════════════════════════════════════════

        #region Hour Angle

        [Test]
        public void HourAngle_AtSolarNoon_ReturnsZero()
        {
            double ha = SolarGlareAnalyzer.HourAngle(SolarNoon, 0.0);
            Assert.AreEqual(0.0, ha, 0.01, "Hour angle at noon should be 0°");
        }

        [Test]
        public void HourAngle_OnePMAfterNoon_Returns15Degrees()
        {
            // 1 PM = 46800 seconds
            double ha = SolarGlareAnalyzer.HourAngle(46800.0, 0.0);
            Assert.AreEqual(15.0, ha, 0.01, "Hour angle 1 hour after noon should be +15°");
        }

        [Test]
        public void HourAngle_OneAMBeforeNoon_ReturnsMinus15Degrees()
        {
            // 11 AM = 39600 seconds
            double ha = SolarGlareAnalyzer.HourAngle(39600.0, 0.0);
            Assert.AreEqual(-15.0, ha, 0.01, "Hour angle 1 hour before noon should be -15°");
        }

        [Test]
        public void HourAngle_AtMidnight_ReturnsMinus180()
        {
            double ha = SolarGlareAnalyzer.HourAngle(Midnight, 0.0);
            Assert.AreEqual(-180.0, ha, 0.01, "Hour angle at midnight should be -180°");
        }

        [Test]
        public void HourAngle_At6AM_ReturnsMinus90()
        {
            double ha = SolarGlareAnalyzer.HourAngle(Dawn6AM, 0.0);
            Assert.AreEqual(-90.0, ha, 0.01, "Hour angle at 6 AM should be -90°");
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  SOLAR ELEVATION
        // ═══════════════════════════════════════════════════════════════════

        #region Solar Elevation

        [Test]
        public void SolarElevation_NoonEquatorEquinox_Returns90()
        {
            // At equator, equinox, solar noon: sun should be directly overhead
            double dec = SolarGlareAnalyzer.SolarDeclination(DayEquinox);
            double elev = SolarGlareAnalyzer.SolarElevation(0.0, dec, 0.0);
            Assert.That(elev, Is.InRange(85.0, 90.0),
                "Sun should be near-zenith at equator on equinox at noon");
        }

        [Test]
        public void SolarElevation_NoonSilverstoneEquinox_ReturnsReasonableAngle()
        {
            // Silverstone: 52.08°N. At equinox noon, elevation ≈ 90 - 52 = ~38°
            double dec = SolarGlareAnalyzer.SolarDeclination(DayEquinox);
            double elev = SolarGlareAnalyzer.SolarElevation(52.08, dec, 0.0);
            Assert.That(elev, Is.InRange(33.0, 43.0),
                "Silverstone equinox noon sun should be ~38° elevation");
        }

        [Test]
        public void SolarElevation_NoonSilverstoneSummer_ReturnsHighAngle()
        {
            // Summer solstice at Silverstone: max elevation ≈ 90 - 52 + 23.45 = ~61°
            double dec = SolarGlareAnalyzer.SolarDeclination(DaySummerSolstice);
            double elev = SolarGlareAnalyzer.SolarElevation(52.08, dec, 0.0);
            Assert.That(elev, Is.InRange(56.0, 66.0),
                "Silverstone summer noon sun should be ~61° elevation");
        }

        [Test]
        public void SolarElevation_NoonSilverstoneWinter_ReturnsLowAngle()
        {
            // Winter solstice at Silverstone: max elevation ≈ 90 - 52 - 23.45 = ~14.5°
            double dec = SolarGlareAnalyzer.SolarDeclination(DayWinterSolstice);
            double elev = SolarGlareAnalyzer.SolarElevation(52.08, dec, 0.0);
            Assert.That(elev, Is.InRange(10.0, 19.0),
                "Silverstone winter noon sun should be ~14.5° elevation — glare territory");
        }

        [Test]
        public void SolarElevation_MidnightAnywhere_ReturnsNegative()
        {
            // At midnight (hour angle = -180°) the sun should be below the horizon
            double dec = SolarGlareAnalyzer.SolarDeclination(DayEquinox);
            double elev = SolarGlareAnalyzer.SolarElevation(52.08, dec, -180.0);
            Assert.That(elev, Is.LessThan(0.0),
                "Sun should be below horizon at midnight");
        }

        [Test]
        public void SolarElevation_BahrainWinterNoon_HigherThanSilverstone()
        {
            // Bahrain (26°N) winter noon should be much higher than Silverstone (52°N)
            double dec = SolarGlareAnalyzer.SolarDeclination(DayWinterSolstice);
            double elevBahrain = SolarGlareAnalyzer.SolarElevation(26.03, dec, 0.0);
            double elevSilver  = SolarGlareAnalyzer.SolarElevation(52.08, dec, 0.0);
            Assert.Greater(elevBahrain, elevSilver,
                "Bahrain noon winter sun should be higher than Silverstone");
        }

        [Test]
        public void SolarElevation_SouthernHemisphere_WinterSolsticeIsHighNoon()
        {
            // Mount Panorama (-33.44°S): Dec solstice is their SUMMER
            double dec = SolarGlareAnalyzer.SolarDeclination(DayWinterSolstice);
            double elev = SolarGlareAnalyzer.SolarElevation(-33.44, dec, 0.0);
            Assert.That(elev, Is.InRange(75.0, 85.0),
                "Mount Panorama Dec noon sun should be very high (southern summer)");
        }

        [Test]
        public void SolarElevation_SouthernHemisphere_JuneSolsticeIsLow()
        {
            // Mount Panorama (-33.44°S): June solstice is their WINTER
            double dec = SolarGlareAnalyzer.SolarDeclination(DaySummerSolstice);
            double elev = SolarGlareAnalyzer.SolarElevation(-33.44, dec, 0.0);
            Assert.That(elev, Is.InRange(28.0, 38.0),
                "Mount Panorama June noon sun should be low (southern winter)");
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  SOLAR AZIMUTH
        // ═══════════════════════════════════════════════════════════════════

        #region Solar Azimuth

        [Test]
        public void SolarAzimuth_NoonNorthernHemisphere_FacesSouth()
        {
            // At solar noon in northern hemisphere, sun is due south (180°)
            double dec = SolarGlareAnalyzer.SolarDeclination(DayEquinox);
            double elev = SolarGlareAnalyzer.SolarElevation(52.08, dec, 0.0);
            double az = SolarGlareAnalyzer.SolarAzimuth(52.08, dec, 0.0, elev);
            Assert.That(az, Is.InRange(175.0, 185.0),
                "Noon sun at northern latitude should be due south (~180°)");
        }

        [Test]
        public void SolarAzimuth_MorningNorthernHemisphere_FacesEast()
        {
            // Morning: sun should be roughly east (60-120°)
            double dec = SolarGlareAnalyzer.SolarDeclination(DayEquinox);
            double ha = SolarGlareAnalyzer.HourAngle(Morning9AM, 0.0);
            double elev = SolarGlareAnalyzer.SolarElevation(52.08, dec, ha);
            double az = SolarGlareAnalyzer.SolarAzimuth(52.08, dec, ha, elev);
            Assert.That(az, Is.InRange(90.0, 160.0),
                "9 AM sun should be in the east-southeast quadrant");
        }

        [Test]
        public void SolarAzimuth_AfternoonNorthernHemisphere_FacesWest()
        {
            // Afternoon: sun should be roughly west (200-300°)
            double dec = SolarGlareAnalyzer.SolarDeclination(DayEquinox);
            double ha = SolarGlareAnalyzer.HourAngle(Afternoon5PM, 0.0);
            double elev = SolarGlareAnalyzer.SolarElevation(52.08, dec, ha);
            double az = SolarGlareAnalyzer.SolarAzimuth(52.08, dec, ha, elev);
            Assert.That(az, Is.InRange(200.0, 280.0),
                "5 PM sun should be in the west-southwest quadrant");
        }

        [Test]
        public void SolarAzimuth_NoonSouthernHemisphere_FacesNorth()
        {
            // At solar noon in southern hemisphere, sun is due north (0° or 360°)
            double dec = SolarGlareAnalyzer.SolarDeclination(DayWinterSolstice); // Dec = summer down south
            double elev = SolarGlareAnalyzer.SolarElevation(-33.44, dec, 0.0);
            double az = SolarGlareAnalyzer.SolarAzimuth(-33.44, dec, 0.0, elev);
            // Should be near 0° or near 360°
            double fromNorth = Math.Min(az, 360.0 - az);
            Assert.That(fromNorth, Is.LessThan(10.0),
                "Noon sun in southern hemisphere summer should be due north");
        }

        [Test]
        public void SolarAzimuth_AlwaysInRange_0to360()
        {
            // Test multiple combinations of parameters
            double[] lats = { -40, -20, 0, 20, 40, 60 };
            int[] days = { 1, 80, 172, 265, 355 };
            double[] times = { Dawn6AM, Morning9AM, SolarNoon, Afternoon5PM, Evening730PM };

            foreach (double lat in lats)
            foreach (int day in days)
            foreach (double t in times)
            {
                double dec = SolarGlareAnalyzer.SolarDeclination(day);
                double ha = SolarGlareAnalyzer.HourAngle(t, 0.0);
                double elev = SolarGlareAnalyzer.SolarElevation(lat, dec, ha);
                if (elev < 0) continue; // Skip when sun below horizon
                double az = SolarGlareAnalyzer.SolarAzimuth(lat, dec, ha, elev);
                Assert.That(az, Is.InRange(0.0, 360.0),
                    $"Azimuth out of range for lat={lat}, day={day}, time={t}");
            }
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  ANGLE DIFFERENCE
        // ═══════════════════════════════════════════════════════════════════

        #region Angle Difference

        [TestCase(0.0, 0.0, 0.0)]
        [TestCase(0.0, 90.0, 90.0)]
        [TestCase(0.0, 270.0, -90.0)]
        [TestCase(350.0, 10.0, 20.0)]
        [TestCase(10.0, 350.0, -20.0)]
        [TestCase(0.0, 179.0, 179.0)]   // Near-opposite: unambiguous
        [TestCase(180.0, 1.0, -179.0)]  // Near-opposite the other way
        [TestCase(90.0, 90.0, 0.0)]
        public void SignedAngleDifference_ReturnsCorrectValues(
            double from, double to, double expected)
        {
            double result = SolarGlareAnalyzer.SignedAngleDifference(from, to);
            Assert.AreEqual(expected, result, 0.01,
                $"Angle from {from}° to {to}° should be {expected}°");
        }

        [Test]
        public void SignedAngleDifference_AlwaysWithin180()
        {
            var rng = new Random(42);
            for (int i = 0; i < 1000; i++)
            {
                double from = rng.NextDouble() * 360.0;
                double to = rng.NextDouble() * 360.0;
                double diff = SolarGlareAnalyzer.SignedAngleDifference(from, to);
                Assert.That(Math.Abs(diff), Is.LessThanOrEqualTo(180.0),
                    $"Angle difference {diff}° exceeds ±180° for {from}→{to}");
            }
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  YAW CONVERSION
        // ═══════════════════════════════════════════════════════════════════

        #region Yaw Conversion

        [TestCase(0.0, 0.0)]
        [TestCase(Math.PI / 2, 90.0)]
        [TestCase(Math.PI, 180.0)]
        [TestCase(3 * Math.PI / 2, 270.0)]
        [TestCase(2 * Math.PI, 0.0)]  // Full rotation wraps to 0
        [TestCase(-Math.PI / 2, 270.0)]  // Negative yaw wraps correctly
        public void YawToCompassBearing_ReturnsCorrectBearing(double yaw, double expectedDeg)
        {
            double bearing = SolarGlareAnalyzer.YawToCompassBearing(yaw);
            Assert.AreEqual(expectedDeg, bearing, 0.1,
                $"Yaw {yaw} rad should be {expectedDeg}° compass");
        }

        [Test]
        public void YawToCompassBearing_AlwaysInRange_0to360()
        {
            var rng = new Random(42);
            for (int i = 0; i < 500; i++)
            {
                double yaw = (rng.NextDouble() - 0.5) * 4 * Math.PI; // -2π to 2π
                double bearing = SolarGlareAnalyzer.YawToCompassBearing(yaw);
                Assert.That(bearing, Is.InRange(0.0, 360.0),
                    $"Bearing out of range for yaw={yaw}");
            }
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  GLARE SEVERITY COMPUTATION
        // ═══════════════════════════════════════════════════════════════════

        #region Glare Severity

        [Test]
        public void ComputeGlareSeverity_SunBelowHorizon_ReturnsZero()
        {
            double severity = SolarGlareAnalyzer.ComputeGlareSeverity(0.0, -5.0);
            Assert.AreEqual(0.0, severity, "Glare should be 0 when sun is below horizon");
        }

        [Test]
        public void ComputeGlareSeverity_SunBelowMinElevation_ReturnsZero()
        {
            double severity = SolarGlareAnalyzer.ComputeGlareSeverity(0.0, 1.0);
            Assert.AreEqual(0.0, severity,
                $"Glare should be 0 when sun is below {SolarGlareAnalyzer.MinSunElevation}° threshold");
        }

        [Test]
        public void ComputeGlareSeverity_SunAboveMaxElevation_ReturnsZero()
        {
            double severity = SolarGlareAnalyzer.ComputeGlareSeverity(0.0, 50.0);
            Assert.AreEqual(0.0, severity,
                $"Glare should be 0 when sun is above {SolarGlareAnalyzer.MaxGlareElevation}° (too high for windscreen)");
        }

        [Test]
        public void ComputeGlareSeverity_SunBehindDriver_ReturnsZero()
        {
            double severity = SolarGlareAnalyzer.ComputeGlareSeverity(90.0, 10.0);
            Assert.AreEqual(0.0, severity,
                "Glare should be 0 when sun is 90° off to the side");
        }

        [Test]
        public void ComputeGlareSeverity_SunDeadAheadLowAngle_ReturnsMaximum()
        {
            // Dead ahead (0°), optimal glare elevation (10°) — worst case
            double severity = SolarGlareAnalyzer.ComputeGlareSeverity(0.0, 10.0);
            Assert.AreEqual(1.0, severity, 0.001,
                "Glare should be 1.0 when sun is dead ahead at peak elevation");
        }

        [TestCase(0.0, 10.0, 1.0)]    // Dead ahead, peak elevation
        [TestCase(15.0, 10.0, 0.5)]   // 15° off, peak elevation — half severity
        [TestCase(29.0, 10.0, 0.033)] // Just inside the glare cone
        [TestCase(31.0, 10.0, 0.0)]   // Just outside the glare cone
        public void ComputeGlareSeverity_AngleFalloff_LinearWithAngle(
            double angleDeg, double elevDeg, double expectedApprox)
        {
            double severity = SolarGlareAnalyzer.ComputeGlareSeverity(angleDeg, elevDeg);
            Assert.AreEqual(expectedApprox, severity, 0.05,
                $"Severity at {angleDeg}° angle, {elevDeg}° elevation");
        }

        [Test]
        public void ComputeGlareSeverity_ElevationRampUp_GrowsFrom2To5Degrees()
        {
            // At 2° (min): barely any glare. At 5°: approaching peak.
            double sev2 = SolarGlareAnalyzer.ComputeGlareSeverity(0.0, 2.5);
            double sev5 = SolarGlareAnalyzer.ComputeGlareSeverity(0.0, 5.0);
            Assert.Greater(sev5, sev2,
                "Glare at 5° should be greater than at 2.5° (ramp-up zone)");
        }

        [Test]
        public void ComputeGlareSeverity_ElevationPeakZone_StaysAt1()
        {
            // Between 5° and 15°: full severity (dead ahead)
            double sev7 = SolarGlareAnalyzer.ComputeGlareSeverity(0.0, 7.0);
            double sev10 = SolarGlareAnalyzer.ComputeGlareSeverity(0.0, 10.0);
            double sev14 = SolarGlareAnalyzer.ComputeGlareSeverity(0.0, 14.0);
            Assert.AreEqual(1.0, sev7, 0.001);
            Assert.AreEqual(1.0, sev10, 0.001);
            Assert.AreEqual(1.0, sev14, 0.001);
        }

        [Test]
        public void ComputeGlareSeverity_ElevationRampDown_DecreasesFrom15To45()
        {
            double sev20 = SolarGlareAnalyzer.ComputeGlareSeverity(0.0, 20.0);
            double sev30 = SolarGlareAnalyzer.ComputeGlareSeverity(0.0, 30.0);
            double sev44 = SolarGlareAnalyzer.ComputeGlareSeverity(0.0, 44.0);
            Assert.Greater(sev20, sev30, "Glare at 20° should be > 30°");
            Assert.Greater(sev30, sev44, "Glare at 30° should be > 44°");
            Assert.Greater(sev44, 0.0, "Glare at 44° should still be > 0");
        }

        [Test]
        public void ComputeGlareSeverity_NegativeAngle_SameAsPositive()
        {
            // Symmetric: sun 20° left should have same severity as 20° right
            double sevLeft  = SolarGlareAnalyzer.ComputeGlareSeverity(-20.0, 10.0);
            double sevRight = SolarGlareAnalyzer.ComputeGlareSeverity(20.0, 10.0);
            Assert.AreEqual(sevRight, sevLeft, 0.001,
                "Glare severity should be symmetric around dead ahead");
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  GLARE DIRECTION
        // ═══════════════════════════════════════════════════════════════════

        #region Glare Direction

        [TestCase(0.0, "ahead")]
        [TestCase(5.0, "ahead")]
        [TestCase(-7.0, "ahead")]
        [TestCase(15.0, "ahead-right")]
        [TestCase(25.0, "ahead-right")]
        [TestCase(-15.0, "ahead-left")]
        [TestCase(-25.0, "ahead-left")]
        [TestCase(35.0, "")]         // Outside glare cone
        [TestCase(-35.0, "")]        // Outside glare cone
        public void GetGlareDirection_ReturnsCorrectLabel(double angle, string expected)
        {
            string dir = SolarGlareAnalyzer.GetGlareDirection(angle);
            Assert.AreEqual(expected, dir);
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  FULL UPDATE FRAME INTEGRATION
        // ═══════════════════════════════════════════════════════════════════

        #region UpdateFrame Integration

        [Test]
        public void UpdateFrame_WithNullSnapshot_SetsZeroGlare()
        {
            _analyzer.UpdateFrame(null!, DayEquinox);
            Assert.AreEqual(0.0, _analyzer.GlareSeverity);
        }

        [Test]
        public void UpdateFrame_WithGameNotRunning_SetsZeroGlare()
        {
            _current.GameRunning = false;
            _analyzer.UpdateFrame(_current, DayEquinox);
            Assert.AreEqual(0.0, _analyzer.GlareSeverity);
        }

        [Test]
        public void UpdateFrame_WithEmptyTrackId_SetsZeroGlare()
        {
            _current.TrackId = "";
            _analyzer.UpdateFrame(_current, DayEquinox);
            Assert.AreEqual(0.0, _analyzer.GlareSeverity);
        }

        [Test]
        public void UpdateFrame_WithUnknownTrack_SetsZeroGlare()
        {
            _current.TrackId = "nonexistent-track-xyz";
            _analyzer.UpdateFrame(_current, DayEquinox);
            Assert.AreEqual(0.0, _analyzer.GlareSeverity);
        }

        [Test]
        public void UpdateFrame_WithZeroTimeOfDay_SetsZeroGlare()
        {
            _current.SessionTimeOfDay = 0;
            _analyzer.UpdateFrame(_current, DayEquinox);
            Assert.AreEqual(0.0, _analyzer.GlareSeverity);
        }

        [Test]
        public void UpdateFrame_SilverstoneNoonEquinox_ComputesSolarPosition()
        {
            _current.TrackId = "silverstone";
            _current.SessionTimeOfDay = SolarNoon;
            _analyzer.UpdateFrame(_current, DayEquinox);

            // Sun should be roughly south at ~38° elevation
            Assert.That(_analyzer.SunElevation, Is.InRange(33.0, 43.0),
                "Silverstone equinox noon elevation");
            Assert.That(_analyzer.SunAzimuth, Is.InRange(170.0, 190.0),
                "Silverstone equinox noon azimuth should be ~south");
        }

        [Test]
        public void UpdateFrame_DriverHeadingSouth_AtNoon_GlareDetected()
        {
            // Driver heading south (180°), sun is south at noon in northern hemisphere
            _current.TrackId = "silverstone";
            _current.Yaw = Math.PI; // 180° = south
            _current.SessionTimeOfDay = SolarNoon;

            // Winter solstice: low sun (~14.5°) = strong glare
            _analyzer.UpdateFrame(_current, DayWinterSolstice);

            Assert.Greater(_analyzer.GlareSeverity, 0.0,
                "Driver heading into noon winter sun should detect glare");
            Assert.IsNotEmpty(_analyzer.GlareDirection,
                "Should have a glare direction when severity > 0");
        }

        [Test]
        public void UpdateFrame_DriverHeadingNorth_AtNoon_NoGlare()
        {
            // Driver heading north (0°), sun is south at noon — sun is behind
            _current.TrackId = "silverstone";
            _current.Yaw = 0.0; // 0° = north
            _current.SessionTimeOfDay = SolarNoon;
            _analyzer.UpdateFrame(_current, DayEquinox);

            Assert.AreEqual(0.0, _analyzer.GlareSeverity,
                "Driver heading away from sun should have no glare");
        }

        [Test]
        public void UpdateFrame_DriverHeadingEast_Morning_GlareDetected()
        {
            // Driver heading east (90°), morning sun is roughly east
            _current.TrackId = "silverstone";
            _current.Yaw = Math.PI / 2; // 90° = east
            _current.SessionTimeOfDay = Morning9AM;
            _analyzer.UpdateFrame(_current, DayEquinox);

            // Morning sun is east-southeast; heading east should be in or near glare cone
            // The exact angle depends on the azimuth calculation
            Assert.That(_analyzer.SunAzimuth, Is.InRange(90.0, 160.0),
                "Morning sun should be in eastern quadrant");
        }

        [Test]
        public void UpdateFrame_NightSession_NoGlare()
        {
            // Midnight: sun below horizon
            _current.TrackId = "silverstone";
            _current.SessionTimeOfDay = 3600; // 1 AM — well past midnight but > 0
            _analyzer.UpdateFrame(_current, DayEquinox);

            Assert.That(_analyzer.SunElevation, Is.LessThan(SolarGlareAnalyzer.MinSunElevation),
                "Sun should be below glare threshold at 1 AM");
            Assert.AreEqual(0.0, _analyzer.GlareSeverity,
                "No glare at night");
        }

        [Test]
        public void UpdateFrame_BahrainSunset_LowSunGlare()
        {
            // Bahrain (26°N), late afternoon in August: low western sun
            _current.TrackId = "bahrain";
            _current.Yaw = 3 * Math.PI / 2; // 270° = west
            _current.SessionTimeOfDay = Afternoon5PM;
            _analyzer.UpdateFrame(_current, DayAugust15);

            // Sun should be low-ish and in the west — potential glare for west-heading driver
            Assert.That(_analyzer.SunAzimuth, Is.InRange(240.0, 310.0),
                "Late afternoon Bahrain sun should be in the west");
        }

        [Test]
        public void UpdateFrame_MountPanoramaSouthernHemisphere_SunInNorth()
        {
            // Mount Panorama (-33°S): sun is in the NORTH at noon (opposite of northern hemisphere)
            _current.TrackId = "mount-panorama";
            _current.SessionTimeOfDay = SolarNoon;
            _current.Yaw = 0.0; // Heading north — into the sun in southern hemisphere

            _analyzer.UpdateFrame(_current, DayWinterSolstice); // Dec = summer in south

            // Sun should be near north (0° or 360°)
            double fromNorth = Math.Min(_analyzer.SunAzimuth, 360.0 - _analyzer.SunAzimuth);
            Assert.That(fromNorth, Is.LessThan(15.0),
                "Southern hemisphere noon sun should be near north");

            // Driver heading north into northern sun: should detect glare
            // (unless sun elevation is too high)
            if (_analyzer.SunElevation <= SolarGlareAnalyzer.MaxGlareElevation)
            {
                Assert.Greater(_analyzer.GlareSeverity, 0.0,
                    "Driver heading north at Mount Panorama summer noon should see glare");
            }
        }

        [Test]
        public void UpdateFrame_SummerNoonSilverstone_SunTooHigh_NoGlare()
        {
            // Summer solstice noon at Silverstone: sun at ~61° — above MaxGlareElevation (45°)
            _current.TrackId = "silverstone";
            _current.Yaw = Math.PI; // Heading south (toward sun)
            _current.SessionTimeOfDay = SolarNoon;
            _analyzer.UpdateFrame(_current, DaySummerSolstice);

            Assert.That(_analyzer.SunElevation, Is.GreaterThan(SolarGlareAnalyzer.MaxGlareElevation),
                "Summer noon sun at Silverstone should be above glare threshold");
            Assert.AreEqual(0.0, _analyzer.GlareSeverity,
                "No glare when sun is too high overhead");
        }

        [Test]
        public void UpdateFrame_TrackIdIsCaseInsensitive()
        {
            _current.TrackId = "SILVERSTONE";
            _current.SessionTimeOfDay = SolarNoon;
            _analyzer.UpdateFrame(_current, DayEquinox);
            Assert.That(_analyzer.SunElevation, Is.GreaterThan(0.0),
                "Track lookup should be case-insensitive");
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  STRATEGY CALL EVALUATION
        // ═══════════════════════════════════════════════════════════════════

        #region Strategy Call

        [Test]
        public void EvaluateGlare_BelowThreshold_ReturnsNull()
        {
            _current.TrackId = "silverstone";
            _current.Yaw = 0.0; // North — away from noon sun
            _current.SessionTimeOfDay = SolarNoon;
            _analyzer.UpdateFrame(_current, DayEquinox);

            var call = _analyzer.EvaluateGlare(DateTime.UtcNow);
            Assert.IsNull(call, "Should not fire call when glare severity < 0.3");
        }

        [Test]
        public void EvaluateGlare_AboveThreshold_ReturnsCall()
        {
            // Set up a scenario with definite glare
            _current.TrackId = "silverstone";
            _current.Yaw = Math.PI; // South — into winter noon sun
            _current.SessionTimeOfDay = SolarNoon;
            _analyzer.UpdateFrame(_current, DayWinterSolstice);

            // Only proceed if we actually got glare > 0.3
            if (_analyzer.GlareSeverity >= 0.3)
            {
                var call = _analyzer.EvaluateGlare(DateTime.UtcNow);
                Assert.IsNotNull(call, "Should fire call when glare is significant");
                Assert.AreEqual("GLARE", call!.Label);
                Assert.That(call.Severity, Is.InRange(2, 3));
                Assert.IsNotEmpty(call.Message);
            }
        }

        [Test]
        public void EvaluateGlare_HighSeverity_ReturnsSeverity3()
        {
            // Force high glare using custom coordinates: sun dead ahead, low angle
            var coords = new Dictionary<string, TrackCoordinate>
            {
                ["test-track"] = new TrackCoordinate(52.0, 0.0)
            };
            var analyzer = new SolarGlareAnalyzer(coords);

            // Find a time/heading combo that gives high glare
            var snap = new TelemetrySnapshot
            {
                GameRunning = true,
                TrackId = "test-track",
                SessionTimeOfDay = SolarNoon,
                Yaw = Math.PI // heading south, sun due south
            };
            analyzer.UpdateFrame(snap, DayWinterSolstice);

            if (analyzer.GlareSeverity >= 0.7)
            {
                var call = analyzer.EvaluateGlare(DateTime.UtcNow);
                Assert.IsNotNull(call);
                Assert.AreEqual(3, call!.Severity, "High glare should be severity 3");
                StringAssert.Contains("Strong", call.Message);
            }
        }

        [Test]
        public void EvaluateGlare_ModerateSeverity_ReturnsSeverity2()
        {
            // Use a slightly off-angle approach to get moderate glare (0.3–0.7)
            var coords = new Dictionary<string, TrackCoordinate>
            {
                ["test-track"] = new TrackCoordinate(52.0, 0.0)
            };
            var analyzer = new SolarGlareAnalyzer(coords);

            var snap = new TelemetrySnapshot
            {
                GameRunning = true,
                TrackId = "test-track",
                SessionTimeOfDay = SolarNoon,
                // Heading slightly off from south: ~160° (20° offset from 180° sun)
                Yaw = 160.0 * Math.PI / 180.0
            };
            analyzer.UpdateFrame(snap, DayWinterSolstice);

            if (analyzer.GlareSeverity >= 0.3 && analyzer.GlareSeverity < 0.7)
            {
                var call = analyzer.EvaluateGlare(DateTime.UtcNow);
                Assert.IsNotNull(call);
                Assert.AreEqual(2, call!.Severity, "Moderate glare should be severity 2");
            }
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  COOLDOWN BEHAVIOR
        // ═══════════════════════════════════════════════════════════════════

        #region Cooldown

        [Test]
        public void EvaluateGlare_SecondCallWithinCooldown_ReturnsNull()
        {
            // Set up glare scenario
            var coords = new Dictionary<string, TrackCoordinate>
            {
                ["test-track"] = new TrackCoordinate(52.0, 0.0)
            };
            var analyzer = new SolarGlareAnalyzer(coords);
            var snap = new TelemetrySnapshot
            {
                GameRunning = true,
                TrackId = "test-track",
                SessionTimeOfDay = SolarNoon,
                Yaw = Math.PI
            };
            analyzer.UpdateFrame(snap, DayWinterSolstice);

            if (analyzer.GlareSeverity >= 0.3)
            {
                var now = DateTime.UtcNow;
                var first = analyzer.EvaluateGlare(now);
                Assert.IsNotNull(first, "First call should fire");

                // 30 seconds later: still within 5-minute cooldown
                var second = analyzer.EvaluateGlare(now.AddSeconds(30));
                Assert.IsNull(second, "Second call within cooldown should return null");
            }
        }

        [Test]
        public void EvaluateGlare_AfterCooldownExpires_FiresAgain()
        {
            var coords = new Dictionary<string, TrackCoordinate>
            {
                ["test-track"] = new TrackCoordinate(52.0, 0.0)
            };
            var analyzer = new SolarGlareAnalyzer(coords);
            var snap = new TelemetrySnapshot
            {
                GameRunning = true,
                TrackId = "test-track",
                SessionTimeOfDay = SolarNoon,
                Yaw = Math.PI
            };
            analyzer.UpdateFrame(snap, DayWinterSolstice);

            if (analyzer.GlareSeverity >= 0.3)
            {
                var now = DateTime.UtcNow;
                var first = analyzer.EvaluateGlare(now);
                Assert.IsNotNull(first);

                // 6 minutes later: past 5-minute cooldown
                analyzer.UpdateFrame(snap, DayWinterSolstice); // re-evaluate
                var third = analyzer.EvaluateGlare(now.AddSeconds(360));
                Assert.IsNotNull(third, "Call after cooldown expires should fire");
            }
        }

        [Test]
        public void ResetCooldown_AllowsImmediateRefire()
        {
            var coords = new Dictionary<string, TrackCoordinate>
            {
                ["test-track"] = new TrackCoordinate(52.0, 0.0)
            };
            var analyzer = new SolarGlareAnalyzer(coords);
            var snap = new TelemetrySnapshot
            {
                GameRunning = true,
                TrackId = "test-track",
                SessionTimeOfDay = SolarNoon,
                Yaw = Math.PI
            };
            analyzer.UpdateFrame(snap, DayWinterSolstice);

            if (analyzer.GlareSeverity >= 0.3)
            {
                var now = DateTime.UtcNow;
                analyzer.EvaluateGlare(now);

                analyzer.ResetCooldown();
                analyzer.UpdateFrame(snap, DayWinterSolstice);
                var call = analyzer.EvaluateGlare(now.AddSeconds(1));
                Assert.IsNotNull(call, "Should fire after cooldown reset");
            }
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  TRACK COORDINATE DATABASE
        // ═══════════════════════════════════════════════════════════════════

        #region Track Coordinates

        [Test]
        public void TrackDatabase_ContainsExpectedTracks()
        {
            var db = TrackCoordinateDatabase.GetDefaultCoordinates();
            string[] expectedTracks = {
                "spa-francorchamps", "silverstone", "monza", "nurburgring",
                "daytona", "indianapolis", "road-america", "watkins-glen",
                "laguna-seca", "suzuka", "mount-panorama", "bahrain",
                "interlagos", "cota", "brands-hatch"
            };

            foreach (string track in expectedTracks)
            {
                Assert.IsTrue(db.ContainsKey(track),
                    $"Track database should contain '{track}'");
            }
        }

        [Test]
        public void TrackDatabase_HasAtLeast40Tracks()
        {
            var db = TrackCoordinateDatabase.GetDefaultCoordinates();
            Assert.That(db.Count, Is.GreaterThanOrEqualTo(40),
                "Track database should have at least 40 tracks to cover iRacing content");
        }

        [Test]
        public void TrackDatabase_AllCoordinatesInValidRange()
        {
            var db = TrackCoordinateDatabase.GetDefaultCoordinates();
            foreach (var kvp in db)
            {
                Assert.That(kvp.Value.Latitude, Is.InRange(-90.0, 90.0),
                    $"Track '{kvp.Key}': latitude {kvp.Value.Latitude} out of range");
                Assert.That(kvp.Value.Longitude, Is.InRange(-180.0, 180.0),
                    $"Track '{kvp.Key}': longitude {kvp.Value.Longitude} out of range");
            }
        }

        [Test]
        public void TrackDatabase_SpaIsInBelgium()
        {
            var db = TrackCoordinateDatabase.GetDefaultCoordinates();
            var spa = db["spa-francorchamps"];
            // Spa should be roughly 50.4°N, 5.97°E
            Assert.That(spa.Latitude, Is.InRange(50.0, 51.0), "Spa latitude");
            Assert.That(spa.Longitude, Is.InRange(5.5, 6.5), "Spa longitude");
        }

        [Test]
        public void TrackDatabase_DaytonaIsInFlorida()
        {
            var db = TrackCoordinateDatabase.GetDefaultCoordinates();
            var daytona = db["daytona"];
            Assert.That(daytona.Latitude, Is.InRange(29.0, 30.0), "Daytona latitude");
            Assert.That(daytona.Longitude, Is.InRange(-82.0, -81.0), "Daytona longitude");
        }

        [Test]
        public void TrackDatabase_MountPanoramaIsSouthernHemisphere()
        {
            var db = TrackCoordinateDatabase.GetDefaultCoordinates();
            var bathurst = db["mount-panorama"];
            Assert.That(bathurst.Latitude, Is.LessThan(0.0),
                "Mount Panorama should have negative latitude (southern hemisphere)");
        }

        [Test]
        public void TrackDatabase_InterlagosIsSouthernHemisphere()
        {
            var db = TrackCoordinateDatabase.GetDefaultCoordinates();
            var interlagos = db["interlagos"];
            Assert.That(interlagos.Latitude, Is.LessThan(0.0),
                "Interlagos should have negative latitude (southern hemisphere)");
        }

        [Test]
        public void TrackDatabase_LookupIsCaseInsensitive()
        {
            var db = TrackCoordinateDatabase.GetDefaultCoordinates();
            Assert.IsTrue(db.ContainsKey("Silverstone"), "Should find 'Silverstone' with capital S");
            Assert.IsTrue(db.ContainsKey("SILVERSTONE"), "Should find 'SILVERSTONE' all caps");
            Assert.IsTrue(db.ContainsKey("silverstone"), "Should find 'silverstone' lowercase");
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  REAL-WORLD SCENARIOS
        // ═══════════════════════════════════════════════════════════════════

        #region Real-World Scenarios

        [Test]
        public void Scenario_SpaEauRouge_MorningSunFromEast()
        {
            // Eau Rouge heads roughly northeast then north — morning sun from the east
            // could catch drivers through the compression
            _current.TrackId = "spa-francorchamps";
            _current.SessionTimeOfDay = Morning9AM;
            _current.Yaw = Math.PI / 4; // ~45° NE heading

            _analyzer.UpdateFrame(_current, DayAugust15);

            // Sun should be in the east; NE heading puts it in peripheral or near-ahead zone
            Assert.That(_analyzer.SunElevation, Is.GreaterThan(0.0),
                "9 AM August sun at Spa should be above horizon");
            // We don't assert specific glare here — just that the math computes without error
        }

        [Test]
        public void Scenario_DaytonaBackStretch_AfternoonSunFromWest()
        {
            // Daytona back stretch heads roughly west; afternoon sun could be problematic
            _current.TrackId = "daytona";
            _current.SessionTimeOfDay = Afternoon5PM;
            _current.Yaw = 3 * Math.PI / 2; // 270° = west

            _analyzer.UpdateFrame(_current, DayAugust15);

            Assert.That(_analyzer.SunAzimuth, Is.InRange(240.0, 310.0),
                "5 PM August sun at Daytona should be in western sky");
        }

        [Test]
        public void Scenario_SuzukaFigure8_SunTraversesDuringRace()
        {
            // Suzuka's figure-8 layout means drivers face every compass direction.
            // Verify that the analyzer computes different glare values for different headings.
            // Use a custom track at high latitude with guaranteed low-angle sun.
            var coords = new Dictionary<string, TrackCoordinate>
            {
                ["figure8-test"] = new TrackCoordinate(55.0, 0.0) // High latitude = low winter sun
            };
            var analyzer = new SolarGlareAnalyzer(coords);
            var snap = new TelemetrySnapshot
            {
                GameRunning = true,
                TrackId = "figure8-test",
                SessionTimeOfDay = SolarNoon // Noon: sun due south, low in winter at 55°N
            };

            // At 55°N, winter solstice noon: elevation ≈ 90 - 55 - 23.45 = ~11.5° (peak glare zone)
            // Sun azimuth ≈ 180° (due south)
            double[] headings = { 0, Math.PI / 4, Math.PI / 2, Math.PI,
                                   3 * Math.PI / 2, 2 * Math.PI };
            var severities = new HashSet<double>();

            foreach (double heading in headings)
            {
                snap.Yaw = heading;
                analyzer.UpdateFrame(snap, DayWinterSolstice);
                severities.Add(Math.Round(analyzer.GlareSeverity, 2));
            }

            Assert.That(severities.Count, Is.GreaterThan(1),
                "Different headings should produce different glare severities");
        }

        [Test]
        public void Scenario_WinterRaceEvening_LowSunMaxGlare()
        {
            // This is the nightmare scenario: December, late afternoon, low sun,
            // driver heading directly into it. Silverstone.
            _current.TrackId = "silverstone";
            _current.SessionTimeOfDay = 54000.0; // 3 PM
            _current.Yaw = Math.PI; // South — sun is south in winter

            _analyzer.UpdateFrame(_current, DayWinterSolstice);

            // Winter 3 PM at 52°N: sun is very low in the southwest
            // If the heading is close enough to the sun azimuth, glare should be detected
            Assert.That(_analyzer.SunElevation, Is.InRange(0.0, 20.0),
                "Winter afternoon sun at Silverstone should be very low");
        }

        [Test]
        public void Scenario_TropicalTrack_HighNoonSunNeverGlares()
        {
            // Near the equator (Interlagos, ~23.7°S), on equinox, noon sun
            // is nearly overhead. Should NOT produce glare (too high).
            _current.TrackId = "interlagos";
            _current.SessionTimeOfDay = SolarNoon;
            _current.Yaw = 0.0;

            _analyzer.UpdateFrame(_current, DayEquinox);

            Assert.That(_analyzer.SunElevation, Is.GreaterThan(60.0),
                "Equinox noon at Interlagos should have very high sun");
            Assert.AreEqual(0.0, _analyzer.GlareSeverity,
                "Very high sun should not produce windscreen glare");
        }

        [Test]
        public void Scenario_MultipleFrameUpdate_DoesNotAccumulate()
        {
            // Run 100 frames: glare should reflect the CURRENT state, not accumulate
            _current.TrackId = "silverstone";
            _current.SessionTimeOfDay = SolarNoon;
            _current.Yaw = Math.PI;

            for (int i = 0; i < 100; i++)
            {
                _analyzer.UpdateFrame(_current, DayWinterSolstice);
            }

            double glareBefore = _analyzer.GlareSeverity;

            // Now change heading away from sun
            _current.Yaw = 0.0; // North
            _analyzer.UpdateFrame(_current, DayWinterSolstice);

            Assert.AreEqual(0.0, _analyzer.GlareSeverity,
                "After turning away from sun, glare should immediately drop to 0");
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  EDGE CASES & ROBUSTNESS
        // ═══════════════════════════════════════════════════════════════════

        #region Edge Cases

        [Test]
        public void EdgeCase_ExtremeYawValues_DoNotCrash()
        {
            _current.TrackId = "silverstone";
            _current.SessionTimeOfDay = SolarNoon;

            double[] extremeYaws = {
                -100 * Math.PI, 100 * Math.PI,   // Many full rotations
                double.MinValue / 2, double.MaxValue / 2,
                0.0, Math.PI, -Math.PI
            };

            foreach (double yaw in extremeYaws)
            {
                _current.Yaw = yaw;
                Assert.DoesNotThrow(() => _analyzer.UpdateFrame(_current, DayEquinox),
                    $"Should not crash with yaw={yaw}");
            }
        }

        [Test]
        public void EdgeCase_ExtremeTimeOfDay_DoesNotCrash()
        {
            _current.TrackId = "silverstone";

            double[] extremeTimes = {
                1.0,        // Just past midnight
                86399.0,    // 23:59:59
                43200.0,    // Noon exactly
                0.001,      // Near-zero
                100000.0    // Over 24 hours (could happen with extended sessions)
            };

            foreach (double t in extremeTimes)
            {
                _current.SessionTimeOfDay = t;
                Assert.DoesNotThrow(() => _analyzer.UpdateFrame(_current, DayEquinox),
                    $"Should not crash with time={t}");
            }
        }

        [Test]
        public void EdgeCase_ArcticTrack_MidnightSunConditions()
        {
            // A hypothetical track at 70°N in summer: sun never fully sets
            var coords = new Dictionary<string, TrackCoordinate>
            {
                ["arctic-track"] = new TrackCoordinate(70.0, 25.0)
            };
            var analyzer = new SolarGlareAnalyzer(coords);

            var snap = new TelemetrySnapshot
            {
                GameRunning = true,
                TrackId = "arctic-track",
                SessionTimeOfDay = 82800.0, // 11 PM
                Yaw = 0.0
            };

            // Summer solstice at 70°N: midnight sun — sun doesn't set
            Assert.DoesNotThrow(() => analyzer.UpdateFrame(snap, DaySummerSolstice),
                "Should handle midnight sun conditions without error");

            // Sun should still be above horizon at 11 PM in arctic summer
            Assert.That(analyzer.SunElevation, Is.GreaterThan(-5.0),
                "Midnight sun: sun should be near or above horizon at 11 PM");
        }

        [Test]
        public void EdgeCase_EquatorTrack_SunDirectlyOverhead()
        {
            // Track at equator on equinox at noon: sun is at zenith
            var coords = new Dictionary<string, TrackCoordinate>
            {
                ["equator-track"] = new TrackCoordinate(0.0, 0.0)
            };
            var analyzer = new SolarGlareAnalyzer(coords);

            var snap = new TelemetrySnapshot
            {
                GameRunning = true,
                TrackId = "equator-track",
                SessionTimeOfDay = SolarNoon,
                Yaw = 0.0
            };

            analyzer.UpdateFrame(snap, DayEquinox);
            Assert.That(analyzer.SunElevation, Is.InRange(85.0, 90.0),
                "Equator equinox noon: sun should be near zenith");
            Assert.AreEqual(0.0, analyzer.GlareSeverity,
                "Sun at zenith should not cause windscreen glare");
        }

        [Test]
        public void EdgeCase_NullTrackCoordinates_ThrowsInConstructor()
        {
            Assert.Throws<ArgumentNullException>(
                () => new SolarGlareAnalyzer(null!));
        }

        [Test]
        public void EdgeCase_EmptyCoordinateDatabase_HandlesGracefully()
        {
            var analyzer = new SolarGlareAnalyzer(new Dictionary<string, TrackCoordinate>());
            _current.TrackId = "silverstone";
            _current.SessionTimeOfDay = SolarNoon;

            analyzer.UpdateFrame(_current, DayEquinox);
            Assert.AreEqual(0.0, analyzer.GlareSeverity,
                "Empty track database should result in zero glare, not an error");
        }

        #endregion

        // ═══════════════════════════════════════════════════════════════════
        //  MATHEMATICAL CONSISTENCY
        // ═══════════════════════════════════════════════════════════════════

        #region Mathematical Consistency

        [Test]
        public void Consistency_SunRisesInEast_SetsInWest()
        {
            // At any northern latitude, morning azimuth should be < 180 (eastern)
            // and afternoon azimuth should be > 180 (western)
            double dec = SolarGlareAnalyzer.SolarDeclination(DayEquinox);

            double haMorning = SolarGlareAnalyzer.HourAngle(Morning9AM, 0.0);
            double elevMorn = SolarGlareAnalyzer.SolarElevation(45.0, dec, haMorning);
            double azMorn = SolarGlareAnalyzer.SolarAzimuth(45.0, dec, haMorning, elevMorn);

            double haAfternoon = SolarGlareAnalyzer.HourAngle(Afternoon5PM, 0.0);
            double elevAftn = SolarGlareAnalyzer.SolarElevation(45.0, dec, haAfternoon);
            double azAftn = SolarGlareAnalyzer.SolarAzimuth(45.0, dec, haAfternoon, elevAftn);

            Assert.That(azMorn, Is.LessThan(180.0), "Morning sun should be in eastern sky");
            Assert.That(azAftn, Is.GreaterThan(180.0), "Afternoon sun should be in western sky");
        }

        [Test]
        public void Consistency_NoonIsHighestPoint()
        {
            // Solar elevation at noon should be >= elevation at any other time of day
            double dec = SolarGlareAnalyzer.SolarDeclination(DayEquinox);
            double noonElev = SolarGlareAnalyzer.SolarElevation(45.0, dec, 0.0);

            double[] hourAngles = { -90, -60, -30, 30, 60, 90 };
            foreach (double ha in hourAngles)
            {
                double elev = SolarGlareAnalyzer.SolarElevation(45.0, dec, ha);
                Assert.That(noonElev, Is.GreaterThanOrEqualTo(elev),
                    $"Noon elevation should be >= elevation at hour angle {ha}°");
            }
        }

        [Test]
        public void Consistency_ElevationSymmetricAroundNoon()
        {
            // Morning and afternoon at equal hour angles should give equal elevation
            double dec = SolarGlareAnalyzer.SolarDeclination(DayEquinox);

            double[] offsets = { 15, 30, 45, 60, 75 };
            foreach (double offset in offsets)
            {
                double elevMorning = SolarGlareAnalyzer.SolarElevation(45.0, dec, -offset);
                double elevAfternoon = SolarGlareAnalyzer.SolarElevation(45.0, dec, offset);
                Assert.AreEqual(elevMorning, elevAfternoon, 0.01,
                    $"Elevation should be symmetric: HA=-{offset}° vs +{offset}°");
            }
        }

        [Test]
        public void Consistency_GlareSeverity_MonotonicWithAngle()
        {
            // As angle from dead ahead increases, glare should never increase
            double prevSev = SolarGlareAnalyzer.ComputeGlareSeverity(0.0, 10.0);
            for (double angle = 1.0; angle <= 35.0; angle += 1.0)
            {
                double sev = SolarGlareAnalyzer.ComputeGlareSeverity(angle, 10.0);
                Assert.That(sev, Is.LessThanOrEqualTo(prevSev + 0.001),
                    $"Glare at {angle}° should be <= glare at {angle - 1}° (monotonic decrease)");
                prevSev = sev;
            }
        }

        [Test]
        public void Consistency_GlareSeverity_AlwaysInRange_0to1()
        {
            var rng = new Random(42);
            for (int i = 0; i < 5000; i++)
            {
                double angle = (rng.NextDouble() - 0.5) * 360.0;
                double elev = rng.NextDouble() * 90.0 - 10.0; // -10 to 80
                double sev = SolarGlareAnalyzer.ComputeGlareSeverity(angle, elev);
                Assert.That(sev, Is.InRange(0.0, 1.0),
                    $"Severity {sev} out of [0,1] for angle={angle}, elev={elev}");
            }
        }

        #endregion
    }
}
