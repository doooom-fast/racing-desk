using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Microsoft.Data.Sqlite;
using NUnit.Framework;
using RacingDesk.Data;

namespace RacingDesk.Tests.IRacing
{
    /// <summary>
    /// What a pass of the .ibt ingest costs when there is little or nothing to read: a file it cannot read is read once and kept
    /// as done until it changes (the watch's pass is every minute, and three of his files had been read again at every one), a
    /// file that could not be opened is left for the next pass as it always was, and the sim is asked about before a file is
    /// read, not before every file the pass looks up.
    /// </summary>
    [TestFixture]
    public class IngestPassTests
    {
        private static readonly DateTime March = new DateTime(2026, 3, 1, 9, 0, 0, DateTimeKind.Utc);
        private string _dir;

        [SetUp]
        public void SetUp() => Directory.CreateDirectory(_dir = Path.Combine(Path.GetTempPath(), "racing-desk-ingest-pass-" + Guid.NewGuid().ToString("N")));

        [TearDown]
        public void TearDown()
        {
            SqliteConnection.ClearAllPools();
            try { Directory.Delete(_dir, true); } catch { }
        }

        private string Db => Path.Combine(_dir, "racing-desk.db");
        private string Telemetry => Directory.CreateDirectory(Path.Combine(_dir, "telemetry")).FullName;

        private string Settled(string path, double hoursAgo)
        {
            File.SetLastWriteTimeUtc(path, DateTime.UtcNow.AddHours(-hoursAgo));
            return path;
        }

        private string Good(string name, double hoursAgo) =>
            Settled(SyntheticLaps.Write(Path.Combine(Telemetry, name), SyntheticLaps.Yaml(), SyntheticLaps.Laps(2), March), hoursAgo);

        private string Garbage(string name, double hoursAgo)
        {
            string path = Path.Combine(Telemetry, name);
            File.WriteAllBytes(path, Enumerable.Repeat((byte)0x5A, 4096).ToArray());
            return Settled(path, hoursAgo);
        }

        [Test]
        public void AFileThatCannotBeRead_IsReadOnce_AndNotAgainUntilItChanges()
        {
            string bad = Garbage("cut-short.ibt", 3);
            Good("good.ibt", 2);
            var log = new List<string>();
            using var store = new RacingDeskStore(Db);
            var ingest = new IbtIngest(store, log.Add);

            var first = ingest.Run(Telemetry, frameStep: 3);
            Assert.That((first.FilesIngested, first.FilesFailed), Is.EqualTo((1, 1)));
            Assert.That(log.Count(l => l.StartsWith("skip cut-short.ibt: InvalidDataException")), Is.EqualTo(1));
            string kept = store.Scalar<string>("SELECT error FROM ingested_files WHERE path = '" + bad.Replace("'", "''") + "'");
            Assert.That(kept, Does.StartWith("InvalidDataException"), "why it could not be read is kept");
            Assert.That(kept, Does.EndWith(IbtIngest.FinalMark), "and by which build");

            // The next pass, and the watch's look for something to read: nothing.
            Assert.That(new DirectoryInfo(Telemetry).EnumerateFiles("*.ibt").Any(f => ingest.WantsFile(f, DateTime.UtcNow)), Is.False,
                "the watch finds nothing to read, so it starts no pass");
            log.Clear();
            var second = ingest.Run(Telemetry, frameStep: 3);
            Assert.That((second.FilesIngested, second.FilesFailed, second.FilesSkipped), Is.EqualTo((0, 0, 2)));
            Assert.That(log, Is.Empty, "nothing read, nothing said");

            // Found wrong by another build (his store's three rows have no build at all): read once more by this one.
            store.Exec("UPDATE ingested_files SET error = 'InvalidDataException: cut short' WHERE error IS NOT NULL");
            Assert.That(ingest.WantsFile(new FileInfo(bad), DateTime.UtcNow), Is.True, "a later build may read it");
            var again = ingest.Run(Telemetry, frameStep: 3);
            Assert.That((again.FilesIngested, again.FilesFailed, again.FilesSkipped), Is.EqualTo((0, 1, 1)));
            Assert.That(ingest.WantsFile(new FileInfo(bad), DateTime.UtcNow), Is.False, "and then this build is done with it too");

            // Changed (the sim, or he, wrote it again): read again, and this time it is a good file.
            SyntheticLaps.Write(bad, SyntheticLaps.Yaml(), SyntheticLaps.Laps(2), March.AddDays(1));
            Settled(bad, 1);
            Assert.That(ingest.WantsFile(new FileInfo(bad), DateTime.UtcNow), Is.True);
            var third = ingest.Run(Telemetry, frameStep: 3);
            Assert.That((third.FilesIngested, third.FilesFailed), Is.EqualTo((1, 0)));
            Assert.That(store.Scalar<long>("SELECT COUNT(*) FROM ingested_files WHERE error IS NOT NULL"), Is.Zero);

            // And --force reads everything again, the files found unreadable included.
            Garbage("another.ibt", 1);
            ingest.Run(Telemetry, frameStep: 3);
            var forced = ingest.Run(Telemetry, frameStep: 3, force: true);
            Assert.That((forced.FilesIngested, forced.FilesFailed), Is.EqualTo((2, 1)));
        }

        [Test]
        public void AFileThatCouldNotBeOpened_IsLeftForTheNextPass()
        {
            string held = Good("held.ibt", 2);
            var log = new List<string>();
            using var store = new RacingDeskStore(Db);
            var ingest = new IbtIngest(store, log.Add);

            // Another program holds it, sharing nothing: that says nothing of the file.
            IngestSummary first;
            using (new FileStream(held, FileMode.Open, FileAccess.Read, FileShare.None))
                first = ingest.Run(Telemetry, frameStep: 3);
            Assert.That((first.FilesIngested, first.FilesFailed, first.FilesSkipped), Is.EqualTo((0, 0, 1)));
            Assert.That(log, Has.Some.StartsWith("held.ibt couldn't be opened (IOException"));
            Assert.That(store.Scalar<long>("SELECT COUNT(*) FROM ingested_files"), Is.Zero, "not marked: not read, and not unreadable");

            var second = ingest.Run(Telemetry, frameStep: 3);
            Assert.That(second.FilesIngested, Is.EqualTo(1), "read at the next pass, once it can be opened");
        }

        [Test]
        public void OnlyAFileFoundWrongByThisBuild_IsDone()
        {
            Assert.That(IbtIngest.FoundWrong(new InvalidDataException()) && IbtIngest.FoundWrong(new EndOfStreamException()), Is.True);
            Assert.That(IbtIngest.FoundWrong(new NullReferenceException()) || IbtIngest.FoundWrong(new InvalidOperationException())
                || IbtIngest.FoundWrong(new SqliteException("busy", 5)), Is.False, "a bug or the store says nothing final of the file");

            using var store = new RacingDeskStore(Db);
            string path = @"C:\telemetry\a.ibt";
            void Kept(string error) => store.SaveIngestedFile(path, 1024, March, Array.Empty<RacingDesk.Data.SessionRecord>(), error);
            bool Done() => store.IsIngested(path, 1024, March, IbtIngest.FinalMark);

            Kept(null);
            Assert.That(Done(), Is.True, "read");
            Kept("InvalidDataException: cut short" + IbtIngest.FinalMark);
            Assert.That(Done(), Is.True, "found wrong by this build");
            Kept("InvalidDataException: cut short");
            Assert.That(Done(), Is.False, "found wrong by an earlier build: read once more");
            Kept("SqliteException: database is locked");
            Assert.That(Done(), Is.False, "the outline could not be kept, or the store was busy: read again at the next pass, its sessions put back");
            Assert.That(store.IsIngested(path, 1024, March), Is.False, "and without the mark, only a file read is done");
        }

        [Test]
        public void ThePassAsksAboutTheSimOnce_AndBeforeEveryFileItReads_NotBeforeEveryFileItLooksUp()
        {
            for (int i = 0; i < 5; i++) Good($"old-{i}.ibt", 10 - i);
            using var store = new RacingDeskStore(Db);
            var ingest = new IbtIngest(store);
            int asked = 0;
            bool Pause() { asked++; return false; }

            var first = ingest.Run(Telemetry, frameStep: 3, pause: Pause);
            Assert.That(first.FilesIngested, Is.EqualTo(5));
            Assert.That(asked, Is.EqualTo(1 + 5), "once before the pass looks anything up, and before every file it reads");

            // Nothing to read: the pass looks every file up in the store and asks Windows for its processes once.
            asked = 0;
            var second = ingest.Run(Telemetry, frameStep: 3, pause: Pause);
            Assert.That((second.FilesIngested, second.FilesSkipped), Is.EqualTo((0, 5)));
            Assert.That(asked, Is.EqualTo(1));

            // One new file among the old: and once more, before it is read.
            Good("new.ibt", 1);
            asked = 0;
            var third = ingest.Run(Telemetry, frameStep: 3, pause: Pause);
            Assert.That(third.FilesIngested, Is.EqualTo(1));
            Assert.That(asked, Is.EqualTo(2));
        }

        [Test]
        public void ThePassStillWaitsForTheSim_BeforeItLooksAnythingUp()
        {
            Good("first.ibt", 3);
            Good("second.ibt", 2);
            var log = new List<string>();
            using var store = new RacingDeskStore(Db);
            var ingest = new IbtIngest(store, log.Add);
            using var cts = new System.Threading.CancellationTokenSource();
            // The sim is running (the host started while he drives): the pass waits before it touches the disk, and stops
            // waiting when it is cancelled.
            var summary = ingest.Run(Telemetry, frameStep: 3, ct: cts.Token, pause: () => { cts.Cancel(); return true; });
            Assert.That((summary.FilesSeen, summary.FilesIngested), Is.EqualTo((0, 0)), "nothing looked up, nothing read while the sim runs");
            Assert.That(log, Has.Some.EqualTo("paused while iRacing is running"));
            Assert.That(store.Scalar<long>("SELECT COUNT(*) FROM ingested_files"), Is.Zero);
        }

        [Test]
        public void TheSimStartingBetweenTwoFiles_StopsThePassBeforeTheSecond()
        {
            Good("first.ibt", 3);
            Good("second.ibt", 2);
            using var store = new RacingDeskStore(Db);
            var ingest = new IbtIngest(store);
            using var cts = new System.Threading.CancellationTokenSource();
            int asked = 0;
            // Not running at the start of the pass, nor before the first file; running before the second.
            var summary = ingest.Run(Telemetry, frameStep: 3, ct: cts.Token, pause: () =>
            {
                if (++asked < 3) return false;
                cts.Cancel();
                return true;
            });
            Assert.That(summary.FilesIngested, Is.EqualTo(1), "the second file is not read, however soon after the first");
            Assert.That(store.Scalar<long>("SELECT COUNT(*) FROM ingested_files"), Is.EqualTo(1));
        }
    }
}
