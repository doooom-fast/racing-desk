using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using NUnit.Framework;
using RaceCorProDrive.Plugin.IRacing;

namespace RaceCorProDrive.Tests.IRacing
{
    [TestFixture]
    public class SessionInfoYamlTests
    {
        private const string Yaml = @"---
WeekendInfo:
 TrackName: virginia 2022 full
 TrackID: 465
 TrackDisplayName: Virginia International Raceway
 TrackConfigName: Full Course
 TrackCountry: USA
DriverInfo:
 DriverCarIdx: 1
 DriverCarRedLine: 7200.000
 Drivers:
 - CarIdx: 0
   UserName: O'Brien: Racing #1
   TeamName: Team: ""Fast""
   IRating: 2450
   LicString: B 3.12
 - CarIdx: 1
   UserName: Test Driver
   IRating: 1900
   LicString: A 2.37
SplitTimeInfo:
 Sectors:
 - SectorNum: 0
   SectorStartPct: 0.000000
 - SectorNum: 1
   SectorStartPct: 0.333333
";

        [Test]
        public void ParsesFreeTextValuesThatBreakStrictYaml()
        {
            var si = SessionInfoYaml.Parse(Yaml);
            Assert.That(si.WeekendInfo.TrackID, Is.EqualTo(465));
            Assert.That(si.WeekendInfo.TrackDisplayName, Is.EqualTo("Virginia International Raceway"));
            Assert.That(si.DriverInfo.Drivers[0].UserName, Is.EqualTo("O'Brien: Racing #1"));
            Assert.That(si.DriverInfo.Drivers[1].IRating, Is.EqualTo(1900));
            Assert.That(si.SplitTimeInfo.Sectors.Count, Is.EqualTo(2));
        }

        [TestCase("A 2.37", 2.37)]
        [TestCase("R 0.00", 0.0)]
        [TestCase("", 0.0)]
        [TestCase(null, 0.0)]
        public void ParsesSafetyRatingFromLicenceString(string lic, double expected)
        {
            Assert.That(IRacingTelemetrySource.ParseSafetyRating(lic), Is.EqualTo(expected).Within(1e-9));
        }
    }

    /// <summary>Runs against the rig's real .ibt history; skipped where there is none.</summary>
    [TestFixture]
    public class IbtFileTests
    {
        internal static string TelemetryDir =>
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "iRacing", "telemetry");

        internal static IEnumerable<FileInfo> NewestIbt(int n)
        {
            if (!Directory.Exists(TelemetryDir)) return Enumerable.Empty<FileInfo>();
            return new DirectoryInfo(TelemetryDir).EnumerateFiles("*.ibt")
                .OrderByDescending(f => f.LastWriteTimeUtc).Take(n);
        }

        internal static FileInfo NewestRace()
        {
            foreach (var f in NewestIbt(200))
            {
                if (f.Length < 5_000_000) continue;
                try
                {
                    using var ibt = new IbtFile(f.FullName);
                    var sessions = ibt.SessionInfo?.SessionInfo?.Sessions;
                    // A full race on a normal-length track: enough clean laps for timing and outline checks,
                    // and stable as new (often short) sessions land in the history.
                    string length = ibt.SessionInfo?.WeekendInfo?.TrackLength ?? "";
                    double km = double.TryParse(length.Split(' ')[0], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var k) ? k : 99;
                    if (ibt.LapCount >= 8 && km < 7 && sessions != null && sessions.Any(s => s.SessionType == "Race")) return f;
                }
                catch { /* try the next one */ }
            }
            return null;
        }

        [Test]
        public void ReadsHeaderVarsYamlAndFrames()
        {
            var file = NewestRace();
            Assume.That(file, Is.Not.Null, "no .ibt race history on this machine");

            using var ibt = new IbtFile(file.FullName);
            Assert.That(ibt.TickRate, Is.EqualTo(60));
            Assert.That(ibt.RecordCount, Is.GreaterThan(1000));
            Assert.That(ibt.Vars.Keys, Does.Contain("Speed").And.Contain("Lat").And.Contain("LapDistPct"));
            Assert.That(ibt.SessionInfo.WeekendInfo.TrackID, Is.GreaterThan(0));

            var raw = new IbtRawTelemetry(ibt);
            Assert.That(raw.Seek(ibt.RecordCount / 2), Is.True);
            Assert.That(raw.GetValue("Speed"), Is.TypeOf<float>());
            Assert.That((float)raw.GetValue("LapDistPct"), Is.InRange(0f, 1f));
            Assert.That(raw.GetValue("Lat"), Is.TypeOf<double>());
            Assert.That(raw.GetValue("SessionFlags"), Is.TypeOf<int>(), "bitfields surface as int, like SimHub");
            Assert.That(raw.GetValue("NoSuchVariable"), Is.Null);
        }

        [Test]
        public void SessionYamlParsesAcrossRecentHistory()
        {
            var files = NewestIbt(300).ToList();
            Assume.That(files, Is.Not.Empty, "no .ibt history on this machine");

            var failures = new List<string>();
            foreach (var f in files)
            {
                try
                {
                    using var ibt = new IbtFile(f.FullName);
                    if (ibt.SessionInfo?.WeekendInfo == null) failures.Add(f.Name + ": no WeekendInfo");
                }
                catch (InvalidDataException) { /* truncated file — ingest skips these */ }
                catch (Exception ex) { failures.Add(f.Name + ": " + ex.GetType().Name + " " + ex.Message); }
            }
            Assert.That(failures, Is.Empty);
        }
    }
}
