using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Microsoft.Data.Sqlite;
using NUnit.Framework;
using RacingDesk.Data;
using RacingDesk.Plugin.Engine;
using RacingDesk.Plugin.IRacing;

namespace RacingDesk.Tests.IRacing
{
    /// <summary>
    /// The session being driven, followed through the file the sim is writing: the file grows, its header says
    /// nothing of its records, and from the first clean lap there is a provisional outline for the map.
    /// </summary>
    [TestFixture]
    public class IbtFollowerTests
    {
        private static readonly DateTime March = new DateTime(2026, 3, 1, 9, 0, 0, DateTimeKind.Utc);
        private string _dir;

        [SetUp]
        public void SetUp() => Directory.CreateDirectory(_dir = Path.Combine(Path.GetTempPath(), "racing-desk-follow-" + Guid.NewGuid().ToString("N")));

        [TearDown]
        public void TearDown()
        {
            SqliteConnection.ClearAllPools();
            try { Directory.Delete(_dir, true); } catch { }
        }

        private string Db => Path.Combine(_dir, "racing-desk.db");

        [Test]
        public void AGrowingFileCountsItsRecordsFromItsLengthAndTheReaderCarriesOn()
        {
            var frames = SyntheticLaps.Laps(1);
            byte[] whole = SyntheticLaps.Bytes(SyntheticLaps.Yaml(), frames, March, claimedFrames: 0);
            int framesOffset = whole.Length - frames.Count * SyntheticLaps.FrameSize;
            string path = Path.Combine(_dir, "growing.ibt");
            // The sim has written the header, the YAML and a hundred and a half frames so far.
            using (var writing = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.ReadWrite))
            {
                writing.Write(whole, 0, framesOffset + 100 * SyntheticLaps.FrameSize + 20);
                writing.Flush();

                using var finished = new IbtFile(path);
                Assert.That(finished.RecordCount, Is.Zero, "opened as finished, the header's word is taken: none");
                using var growing = new IbtFile(path, growing: true);
                Assert.That(growing.Growing, Is.True);
                Assert.That(growing.RecordCount, Is.EqualTo(100), "the partial last record is left out");
                using var reader = new IbtSequentialReader(growing, 1);
                int read = 0;
                while (reader.MoveNext()) read++;
                Assert.That(read, Is.EqualTo(100));
                Assert.That(reader.NextFrame, Is.EqualTo(100));

                writing.Write(whole, framesOffset + 100 * SyntheticLaps.FrameSize + 20, 50 * SyntheticLaps.FrameSize - 20);
                writing.Flush();
                Assert.That(growing.RecordCount, Is.EqualTo(100), "until it is asked again");
                Assert.That(growing.Refresh(), Is.EqualTo(150));
                int more = 0;
                while (reader.MoveNext()) { more++; Assert.That(reader.GetValue("Lap"), Is.EqualTo(1)); }
                Assert.That(more, Is.EqualTo(50));
                Assert.That((float)reader.GetValue("LapDistPct"), Is.EqualTo(149f / frames.Count).Within(1e-4).Or.EqualTo(149f / (frames.Count - 1)).Within(1e-4));
            }
        }

        [Test]
        public void TheAccumulatorFedInTwoReadsOfAGrowingFileHasEveryLap()
        {
            var frames = SyntheticLaps.Laps(3);
            byte[] whole = SyntheticLaps.Bytes(SyntheticLaps.Yaml(), frames, March, claimedFrames: 0);
            int framesOffset = whole.Length - frames.Count * SyntheticLaps.FrameSize;
            int perLap = frames.Count / 3;
            string path = Path.Combine(_dir, "two-reads.ibt");
            using var writing = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.ReadWrite);
            writing.Write(whole, 0, framesOffset + (perLap / 2) * SyntheticLaps.FrameSize);
            writing.Flush();
            using var file = new IbtFile(path, growing: true);
            using var reader = new IbtSequentialReader(file, 3);
            var acc = new GeometryAccumulator(777, "Synthetic Circuit", SyntheticLaps.OfficialMeters);
            while (reader.MoveNext()) acc.Feed(reader);
            Assert.That(acc.CleanLaps, Is.Zero);
            writing.Write(whole, (int)writing.Position, (perLap + 10) * SyntheticLaps.FrameSize - (perLap / 2) * SyntheticLaps.FrameSize);
            writing.Flush();
            Assert.That(file.Refresh(), Is.EqualTo(perLap + 10));
            while (reader.MoveNext()) acc.Feed(reader);
            Assert.That(acc.CleanLaps, Is.EqualTo(1), string.Join(", ", acc.Rejected.Select(r => r.Key + " " + r.Value)));
            Assert.That(acc.Result(path, null, provisional: true).CleanLaps, Is.EqualTo(1));
            writing.Write(whole, (int)writing.Position, (int)(whole.Length - writing.Position));
            writing.Flush();
            Assert.That(file.Refresh(), Is.EqualTo(frames.Count));
            int read = 0;
            while (reader.MoveNext()) { acc.Feed(reader); read++; }
            Assert.That(read, Is.GreaterThan(1000), "the rest of the file was read");
            Assert.That(acc.CleanLaps, Is.EqualTo(3), string.Join(", ", acc.Rejected.Select(r => r.Key + " " + r.Value)));
        }

        [Test]
        public void TheFirstCleanLapGivesAProvisionalOutlineAndEachLapAfterRefinesIt()
        {
            var frames = SyntheticLaps.Laps(3);
            byte[] whole = SyntheticLaps.Bytes(SyntheticLaps.Yaml(), frames, March, claimedFrames: 0);
            int framesOffset = whole.Length - frames.Count * SyntheticLaps.FrameSize;
            int perLap = frames.Count / 3;
            string path = Path.Combine(_dir, "mx5 mx52016_synthetic full 2026-03-01 09-00-00.ibt");
            var now = March;
            var log = new List<string>();
            var outlined = new List<TrackOutline>();
            using var follower = new IbtFollower(_dir, Db, log.Add, () => now);
            follower.Outlined += outlined.Add;

            using (var writing = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.ReadWrite))
            {
                void Written(int frameCount)
                {
                    long have = writing.Position, want = framesOffset + (long)frameCount * SyntheticLaps.FrameSize;
                    writing.Write(whole, (int)have, (int)(want - have));
                    writing.Flush();
                    File.SetLastWriteTimeUtc(path, now);
                }

                // Half a lap written, the sim sending: looked at, nothing yet.
                Written(perLap / 2);
                follower.Seen(777);
                follower.Look();
                Assert.That(follower.Current(777), Is.Null);
                Assert.That(log, Has.Some.StartsWith("following mx5 mx52016_synthetic full 2026-03-01 09-00-00.ibt for an outline of Synthetic Circuit"));

                // The first lap closed (the frame after it is the next lap's): an outline, provisional, of one lap.
                now = now.AddSeconds(45);
                Written(perLap + 10);
                follower.Seen(777);
                follower.Look();
                var first = follower.Current(777);
                Assert.That(first, Is.Not.Null);
                Assert.That((first.TrackId, first.CleanLaps, first.Provisional), Is.EqualTo((777, 1, true)));
                Assert.That(first.Points.Count, Is.EqualTo(1000));
                Assert.That(outlined, Has.Count.EqualTo(1));
                Assert.That(log, Has.Some.EqualTo("outline from the session being driven: Synthetic Circuit, 1 clean lap"));
                using (var store = RacingDeskStore.OpenReadOnly(Db))
                {
                    var kept = store.GetGeometry(777);
                    Assert.That((kept.CleanLaps, kept.Provisional, kept.Checks), Is.EqualTo((1, true, GeometryAccumulator.ChecksVersion)));
                    Assert.That(kept.SourceIbt, Is.EqualTo(path));
                }
                SqliteConnection.ClearAllPools();

                // Nothing new: nothing said again.
                follower.Look();
                Assert.That(outlined, Has.Count.EqualTo(1));

                // Two laps more: refined, and said again.
                now = now.AddSeconds(90);
                Written(frames.Count);
                follower.Seen(777);
                follower.Look();
                Assert.That(follower.Current(777).CleanLaps, Is.EqualTo(3), follower.Trace);
                Assert.That(outlined, Has.Count.EqualTo(2));
                using (var store = RacingDeskStore.OpenReadOnly(Db))
                    Assert.That(store.GetGeometry(777).CleanLaps, Is.EqualTo(3));
                SqliteConnection.ClearAllPools();

                // The host's outlines prefer the live one while the store's is provisional.
                var outlines = new TrackOutlines(Db, () => now) { Live = follower.Current };
                Assert.That(outlines.ForTrack(777), Is.SameAs(follower.Current(777)));
            }

            // The sim gone: the file is let go of, and the map's outline is the store's provisional one until the
            // finished file is ingested and replaces it.
            now = now.AddSeconds(30);
            follower.Look();
            Assert.That(follower.Current(777), Is.Null);
            var ingest = new IbtIngest(new RacingDeskStore(Db), log.Add);
            File.SetLastWriteTimeUtc(path, now.AddHours(-1));
            File.WriteAllBytes(path, SyntheticLaps.Bytes(SyntheticLaps.Yaml(), frames, March));
            File.SetLastWriteTimeUtc(path, DateTime.UtcNow.AddHours(-1));
            ingest.Run(_dir, frameStep: 3);
            using (var store = RacingDeskStore.OpenReadOnly(Db))
            {
                var kept = store.GetGeometry(777);
                Assert.That((kept.CleanLaps, kept.Provisional), Is.EqualTo((3, false)));
            }
            Assert.That(log, Has.Some.StartsWith("outline replaced: Synthetic Circuit, 3 clean laps"));
            Assert.That(log.Any(l => l.Contains("900001") || l.Contains("Test Driver")), Is.False, "no id and no name in the log");
        }

        [Test]
        public void ALayoutTheStoreHasAWholeOutlineForIsNotFollowed()
        {
            var frames = SyntheticLaps.Laps(1);
            string path = SyntheticLaps.Write(Path.Combine(_dir, "whole.ibt"), SyntheticLaps.Yaml(), frames, March);
            using (var store = new RacingDeskStore(Db))
                store.MergeGeometry(IbtIngest.IngestGeometryOnly(path, 777));
            SqliteConnection.ClearAllPools();
            var now = March;
            var log = new List<string>();
            using var follower = new IbtFollower(_dir, Db, log.Add, () => now);
            File.SetLastWriteTimeUtc(path, now);
            follower.Seen(777);
            follower.Look();
            Assert.That(follower.Current(777), Is.Null);
            Assert.That(log, Is.Empty);
            // A file of another layout than the one the sim says is not read either.
            follower.Seen(778);
            follower.Look();
            Assert.That(follower.Current(778), Is.Null);
            Assert.That(log, Is.Empty);
        }
    }
}
