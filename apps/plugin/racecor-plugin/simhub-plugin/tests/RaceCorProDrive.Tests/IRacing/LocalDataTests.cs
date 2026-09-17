using System;
using System.IO;
using System.Linq;
using NUnit.Framework;
using RaceCor.Data;
using RaceCorProDrive.Plugin.IRacing;

namespace RaceCorProDrive.Tests.IRacing
{
    [TestFixture]
    public class LocalDataTests
    {
        private string _dir;

        [SetUp]
        public void SetUp() => Directory.CreateDirectory(_dir = Path.Combine(Path.GetTempPath(), "racecor-data-" + Guid.NewGuid().ToString("N")));

        [TearDown]
        public void TearDown()
        {
            Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
            try { Directory.Delete(_dir, true); } catch { }
        }

        [Test]
        public void StrengthOfFieldMatchesIRacingFormula()
        {
            Assert.That(SessionAccumulator.StrengthOfField(new[] { 2000, 2000, 2000 }), Is.EqualTo(2000));
            // 1600/ln2 · ln(2 / (e^(-1000·ln2/1600) + e^(-3000·ln2/1600))) = 1790 — log-weighted, below the 2000 mean.
            Assert.That(SessionAccumulator.StrengthOfField(new[] { 1000, 3000 }), Is.EqualTo(1790));
            Assert.That(SessionAccumulator.StrengthOfField(new int[0]), Is.EqualTo(0));
        }

        [Test]
        public void RaceIngestProducesPlausibleSessionLapsGridAndGeometry()
        {
            var race = IbtFileTests.NewestRace();
            Assume.That(race, Is.Not.Null, "no .ibt race history on this machine");

            var result = IbtIngest.IngestFile(race.FullName, frameStep: 3);
            var s = result.Sessions.Single(x => x.SessionType == "Race");
            using var ibt = new IbtFile(race.FullName);

            Assert.That(s.TrackId, Is.EqualTo(ibt.SessionInfo.WeekendInfo.TrackID));
            Assert.That(s.Laps.Count, Is.GreaterThanOrEqualTo(3));
            Assert.That(s.BestLapSeconds, Is.GreaterThan(20));
            Assert.That(s.FinishPosition, Is.GreaterThan(0));
            Assert.That(s.FieldSize, Is.GreaterThan(1));
            Assert.That(s.StrengthOfField, Is.GreaterThan(0));
            Assert.That(s.Grid.Count(g => g.IsPlayer), Is.EqualTo(1));

            var clean = s.Laps.Where(l => l.Clean).ToList();
            Assert.That(clean, Is.Not.Empty);
            foreach (var l in clean)
                Assert.That(l.LapTimeSeconds, Is.InRange(s.BestLapSeconds - 0.01, s.BestLapSeconds * 1.5), $"lap {l.Lap}");

            var g = result.Geometry;
            Assert.That(g, Is.Not.Null);
            Assert.That(Math.Abs(g.LengthMeters - g.OfficialLengthMeters) / g.OfficialLengthMeters, Is.LessThan(0.01), "outline within 1% of official length");
        }

        [Test]
        public void StoreRoundTripsAndReplacesInsteadOfDuplicating()
        {
            var race = IbtFileTests.NewestRace();
            Assume.That(race, Is.Not.Null, "no .ibt race history on this machine");
            var result = IbtIngest.IngestFile(race.FullName);

            using (var store = new ProDriveStore(Path.Combine(_dir, "prodrive.db")))
            {
                var info = new FileInfo(race.FullName);
                store.SaveIngestedFile(info.FullName, info.Length, info.LastWriteTimeUtc, result.Sessions, null);
                store.SaveIngestedFile(info.FullName, info.Length, info.LastWriteTimeUtc, result.Sessions, null);
                Assert.That(store.IsIngested(info.FullName, info.Length, info.LastWriteTimeUtc), Is.True);
                Assert.That(store.Scalar<long>("SELECT COUNT(*) FROM sessions"), Is.EqualTo(result.Sessions.Count));

                var race0 = result.Sessions.Single(x => x.SessionType == "Race");
                var stored = store.RecentSessions(50, "Race").Single();
                Assert.That(stored.BestLapSeconds, Is.EqualTo(race0.BestLapSeconds).Within(1e-3));
                Assert.That(store.Laps(stored.Id).Select(l => l.LapTimeSeconds), Is.EqualTo(race0.Laps.Select(l => l.LapTimeSeconds)).Within(1e-6));

                Assert.That(store.SaveGeometryIfBetter(result.Geometry), Is.True);
                Assert.That(store.SaveGeometryIfBetter(result.Geometry), Is.False, "same clean-lap count is not an improvement");
                var geo = store.GetGeometry(result.Geometry.TrackId);
                Assert.That(geo.Points, Is.EqualTo(result.Geometry.Points));
            }
        }

        [Test]
        public void LiveCaptureMatchesBackfillForTheSameRace()
        {
            var race = IbtFileTests.NewestRace();
            Assume.That(race, Is.Not.Null, "no .ibt race history on this machine");

            var backfill = IbtIngest.IngestFile(race.FullName, frameStep: 1).Sessions.Single(x => x.SessionType == "Race");

            using var store = new ProDriveStore(Path.Combine(_dir, "live.db"));
            using var ibt = new IbtFile(race.FullName);
            var raw = new IbtRawTelemetry(ibt);
            var recorder = new LiveRecorder(store, "replay", t => ibt.SessionStartUtc.AddSeconds(t - ibt.SessionStartTime));
            for (int i = 0; i < ibt.RecordCount; i++)
            {
                raw.Seek(i);
                recorder.Feed(raw);
            }
            recorder.Flush();

            var live = store.RecentSessions(50, "Race").Single();
            Assert.That(live.Source, Is.EqualTo("replay"));
            Assert.That(live.LapsCompleted, Is.EqualTo(backfill.LapsCompleted));
            Assert.That(live.Incidents, Is.EqualTo(backfill.Incidents));
            Assert.That(live.FinishPosition, Is.EqualTo(backfill.FinishPosition));
            Assert.That(store.Laps(live.Id).Select(l => l.LapTimeSeconds), Is.EqualTo(backfill.Laps.Select(l => l.LapTimeSeconds)).Within(1e-6));
        }
    }
}
