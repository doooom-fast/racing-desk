using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
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

                // The first lap closed, and a few seconds of the next one read with it (a look is every ten seconds, and
                // the lap goes on while it is made): an outline, provisional, of one lap.
                now = now.AddSeconds(45);
                Written(perLap + 300);
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

                // Two laps more: refined, and said again — every lap, the one that was being driven when the outline
                // was first made as well as the one after it (a look that threw the open lap away left lap 2 "not from
                // the line", and the outline refined by every other lap).
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
            // A file of another layout than the one the sim says is not read either, and is said to be left alone, once.
            follower.Seen(778);
            follower.Look();
            follower.Look();
            Assert.That(follower.Current(778), Is.Null);
            Assert.That(log, Is.EqualTo(new[] { "not following whole.ibt: it is of another layout than the one being driven" }));
        }

        [Test]
        public void AFileTheSimHoldsOpenIsFollowedPastTheWindowWithoutItsListedTimeEverMoving()
        {
            // The sim holds the file it is writing open, and Windows keeps the time the file was made, and a length of
            // nought, in the folder's listing until the file is closed or somebody asks for it by its path. Nothing here
            // sets the file's time (the other tests do, after every write, which is why they never saw this): the
            // follower has to ask the file itself, and keep to the file it is following while it is the newest.
            var frames = SyntheticLaps.Laps(3);
            byte[] whole = SyntheticLaps.Bytes(SyntheticLaps.Yaml(), frames, March, claimedFrames: 0);
            int framesOffset = whole.Length - frames.Count * SyntheticLaps.FrameSize;
            int perLap = frames.Count / 3;
            string path = Path.Combine(_dir, "mx5 mx52016_synthetic full 2026-03-01 09-00-00.ibt");
            var log = new List<string>();
            // The window is a second, so that the listing's time is out of it after a second and a half of real time.
            using var follower = new IbtFollower(_dir, Db, log.Add, () => DateTime.UtcNow, currentWithin: TimeSpan.FromSeconds(1));

            using var writing = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.ReadWrite);
            void Written(int frameCount)
            {
                long have = writing.Position, want = framesOffset + (long)frameCount * SyntheticLaps.FrameSize;
                writing.Write(whole, (int)have, (int)(want - have));
                writing.Flush();
            }

            // The file was made 1.5 s ago and has just been written to: it is the current one, though its listed time is out of the window.
            Written(perLap / 2);
            Thread.Sleep(1500);
            Written(perLap / 2 + 60);
            follower.Seen(777);
            follower.Look();
            Assert.That(log, Has.Some.StartsWith("following "), "a file written to a moment ago is the sim's, whatever the listing says");

            // And again after the window has run out for the listing once more: still the one being followed, still read.
            Thread.Sleep(1500);
            Written(perLap + 300);
            follower.Seen(777);
            follower.Look();
            Assert.That(follower.Current(777), Is.Not.Null, "the first lap closed while the file was held open: an outline. " + follower.Trace);
            Assert.That(follower.Current(777).Provisional, Is.True);
        }

        [Test]
        public void AFileWellUnderWayWhenItIsFirstOpenedIsReadFromItsLastMinutesAndNotItsStart()
        {
            // Eight laps of forty seconds, five minutes and twenty seconds in all: the look back is five minutes, so the
            // read begins twenty seconds in, half way round the first lap, and the first lap is out for not being from the line.
            var frames = SyntheticLaps.Laps(8);
            string path = Path.Combine(_dir, "mx5 mx52016_synthetic full 2026-03-01 09-00-00.ibt");
            File.WriteAllBytes(path, SyntheticLaps.Bytes(SyntheticLaps.Yaml(), frames, March, claimedFrames: 0));
            File.SetLastWriteTimeUtc(path, March);
            var log = new List<string>();
            using var follower = new IbtFollower(_dir, Db, log.Add, () => March);
            follower.Seen(777);
            follower.Look();
            int start = frames.Count - (int)(IbtFollower.LookBack.TotalSeconds * SyntheticLaps.TickRate);
            Assert.That(start, Is.EqualTo(1201));
            start -= start % 3;   // from a frame the reading of every third steps through: 1200
            Assert.That(log, Has.Some.EqualTo($"following {Path.GetFileName(path)} for an outline of Synthetic Circuit, from {start} frames in"));
            Assert.That(follower.Current(777)?.CleanLaps, Is.EqualTo(7), "the seven laps after the one it began in the middle of. " + follower.Trace);
        }

        [Test]
        public void AFileThatCannotBeReadIsSaidOnceAndAFileOfAnotherLayoutIsSaidOnceAndNotOpenedAgain()
        {
            string bad = Path.Combine(_dir, "cut-short.ibt");
            File.WriteAllBytes(bad, new byte[100]);
            File.SetLastWriteTimeUtc(bad, March);
            var log = new List<string>();
            var now = March;
            using var follower = new IbtFollower(_dir, Db, log.Add, () => now);
            for (int i = 0; i < 4; i++)
            {
                follower.Seen(777);
                follower.LookQuietly();
            }
            Assert.That(log.Count(l => l.StartsWith("follower:")), Is.EqualTo(1), "the same trouble at every look is said once: " + string.Join(" | ", log));

            // The sim then writes a file of another layout: one line says it is left alone, and it is not opened again.
            now = now.AddMinutes(1);
            string other = Path.Combine(_dir, "mx5 mx52016_other 2026-03-01 09-05-00.ibt");
            File.WriteAllBytes(other, SyntheticLaps.Bytes(SyntheticLaps.Yaml(trackId: 778, name: "Another"), SyntheticLaps.Laps(1), March, claimedFrames: 0));
            File.SetLastWriteTimeUtc(other, now);
            for (int i = 0; i < 4; i++)
            {
                follower.Seen(777);
                follower.LookQuietly();
            }
            Assert.That(log.Count(l => l.StartsWith("not following ")), Is.EqualTo(1), string.Join(" | ", log));
            Assert.That(log.Single(l => l.StartsWith("not following ")), Does.Contain("another layout"));
            Assert.That(follower.Current(777), Is.Null);
            Assert.That(log.Any(l => l.Contains("900001") || l.Contains("Test Driver")), Is.False, "no id and no name in the log");
        }
    }
}
