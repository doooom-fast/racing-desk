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
            Assert.That(store.Scalar<string>("SELECT error FROM ingested_files WHERE path = '" + bad.Replace("'", "''") + "'"), Does.StartWith("InvalidDataException"),
                "why it could not be read is kept");

            // The next pass, and the watch's look for something to read: nothing.
            Assert.That(new DirectoryInfo(Telemetry).EnumerateFiles("*.ibt").Any(f => ingest.WantsFile(f, DateTime.UtcNow)), Is.False,
                "the watch finds nothing to read, so it starts no pass");
            log.Clear();
            var second = ingest.Run(Telemetry, frameStep: 3);
            Assert.That((second.FilesIngested, second.FilesFailed, second.FilesSkipped), Is.EqualTo((0, 0, 2)));
            Assert.That(log, Is.Empty, "nothing read, nothing said");

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
        public void ThePassAsksAboutTheSimBeforeAFileIsRead_NotBeforeEveryFile()
        {
            for (int i = 0; i < 5; i++) Good($"old-{i}.ibt", 10 - i);
            using var store = new RacingDeskStore(Db);
            var ingest = new IbtIngest(store);
            int asked = 0;
            bool Pause() { asked++; return false; }

            var first = ingest.Run(Telemetry, frameStep: 3, pause: Pause);
            Assert.That(first.FilesIngested, Is.EqualTo(5));
            Assert.That(asked, Is.InRange(1, 5), "before the files it reads, and no more often than every couple of seconds");

            // Nothing to read: the pass looks every file up in the store and asks Windows for its processes not once.
            asked = 0;
            var second = ingest.Run(Telemetry, frameStep: 3, pause: Pause);
            Assert.That((second.FilesIngested, second.FilesSkipped), Is.EqualTo((0, 5)));
            Assert.That(asked, Is.Zero);

            // One new file among the old: asked once, before it is read.
            Good("new.ibt", 1);
            asked = 0;
            var third = ingest.Run(Telemetry, frameStep: 3, pause: Pause);
            Assert.That(third.FilesIngested, Is.EqualTo(1));
            Assert.That(asked, Is.EqualTo(1));
        }

        [Test]
        public void ThePassStillWaitsForTheSim_BeforeTheFileItWouldRead()
        {
            Good("first.ibt", 3);
            Good("second.ibt", 2);
            var log = new List<string>();
            using var store = new RacingDeskStore(Db);
            var ingest = new IbtIngest(store, log.Add);
            using var cts = new System.Threading.CancellationTokenSource();
            // The sim is running: the pass waits before reading anything, and stops waiting when it is cancelled.
            var summary = ingest.Run(Telemetry, frameStep: 3, ct: cts.Token, pause: () => { cts.Cancel(); return true; });
            Assert.That(summary.FilesIngested, Is.Zero, "nothing read while the sim runs");
            Assert.That(log, Has.Some.EqualTo("paused while iRacing is running"));
            Assert.That(store.Scalar<long>("SELECT COUNT(*) FROM ingested_files"), Is.Zero);
        }
    }
}
