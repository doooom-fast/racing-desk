using System;
using System.IO;
using System.Linq;
using NUnit.Framework;
using RacingDesk.Plugin.Engine;

namespace RacingDesk.Tests.IRacing
{
    /// <summary>The maps earlier builds recorded are moved out of the folders the map read, into a dated folder, and never deleted.</summary>
    [TestFixture]
    public class TrackMapSetAsideTests
    {
        private string _dir;

        [SetUp]
        public void SetUp() => Directory.CreateDirectory(_dir = Path.Combine(Path.GetTempPath(), "racing-desk-setaside-" + Guid.NewGuid().ToString("N")));

        [TearDown]
        public void TearDown()
        {
            try { Directory.Delete(_dir, true); } catch { }
        }

        [Test]
        public void MovesEveryCsvOutOfTheFoldersTheMapReadIntoADatedFolderAndLeavesTheRest()
        {
            string simhub = Path.Combine(_dir, "SimHub");
            string nested = Path.Combine(simhub, "racingdesk-data", "trackmaps");
            string flat = Path.Combine(simhub, "trackmaps");
            string data = Path.Combine(_dir, "PluginsData", "RacingDesk", "TrackMaps");
            Directory.CreateDirectory(nested);
            Directory.CreateDirectory(flat);
            Directory.CreateDirectory(data);
            File.WriteAllText(Path.Combine(nested, "algarve gp.csv"), "1,2,0.1\n");
            File.WriteAllText(Path.Combine(nested, "notes.txt"), "not a map");
            File.WriteAllText(Path.Combine(flat, "bathurst.csv"), "3,4,0.2\n");
            File.WriteAllText(Path.Combine(data, "algarve gp.csv"), "5,6,0.3\n");
            File.WriteAllText(Path.Combine(Path.Combine(simhub, "racingdesk-data"), "commentary_topics.json"), "{}");
            string root = Path.Combine(_dir, "set-aside");
            var when = new DateTime(2026, 9, 30, 21, 5, 7);

            var said = TrackMapSetAside.Run("simhub", TrackMapSetAside.FoldersOf(simhub, Path.Combine(_dir, "PluginsData", "RacingDesk")), root, when);

            string dest = Path.Combine(root, "2026-09-30_210507", "simhub");
            Assert.That(said, Has.Count.EqualTo(1));
            Assert.That(said[0], Is.EqualTo($"3 old track maps set aside, out of the folders the map used to read, into {dest}"));
            Assert.That(File.ReadAllText(Path.Combine(dest, "racingdesk-data_trackmaps", "algarve gp.csv")), Is.EqualTo("1,2,0.1\n"));
            Assert.That(File.ReadAllText(Path.Combine(dest, "trackmaps", "bathurst.csv")), Is.EqualTo("3,4,0.2\n"));
            Assert.That(File.ReadAllText(Path.Combine(dest, "TrackMaps", "algarve gp.csv")), Is.EqualTo("5,6,0.3\n"));
            Assert.That(Directory.GetFiles(nested).Select(Path.GetFileName), Is.EqualTo(new[] { "notes.txt" }), "only the maps are moved");
            Assert.That(Directory.GetFiles(flat), Is.Empty);
            Assert.That(Directory.GetFiles(data), Is.Empty);
            Assert.That(File.Exists(Path.Combine(simhub, "racingdesk-data", "commentary_topics.json")), Is.True);

            // Nothing left to move: nothing said, and no folder made.
            Assert.That(TrackMapSetAside.Run("simhub", TrackMapSetAside.FoldersOf(simhub, Path.Combine(_dir, "PluginsData", "RacingDesk")), root, when.AddMinutes(1)), Is.Empty);
            Assert.That(Directory.Exists(Path.Combine(root, "2026-09-30_210607")), Is.False);
            // Folders that are not there are nothing to say either.
            Assert.That(TrackMapSetAside.Run("host", TrackMapSetAside.FoldersOf(Path.Combine(_dir, "nowhere"), Path.Combine(_dir, "nowhere either")), root, when), Is.Empty);
        }

        [Test]
        public void AFileHeldOpenIsSaidAndTriedAgainNextTime()
        {
            string folder = Path.Combine(_dir, "TrackMaps");
            Directory.CreateDirectory(folder);
            string held = Path.Combine(folder, "held.csv");
            File.WriteAllText(held, "1,2,0.1\n");
            File.WriteAllText(Path.Combine(folder, "free.csv"), "1,2,0.1\n");
            string root = Path.Combine(_dir, "set-aside");
            using (new FileStream(held, FileMode.Open, FileAccess.Read, FileShare.None))
            {
                var said = TrackMapSetAside.Run("host", new[] { folder }, root, new DateTime(2026, 9, 30, 21, 5, 7));
                Assert.That(said[0], Does.StartWith("1 old track map set aside"));
                Assert.That(said[1], Does.StartWith("old track map held.csv in ").And.Contain("tried again at the next start"));
            }
            Assert.That(File.Exists(held), Is.True);
            var again = TrackMapSetAside.Run("host", new[] { folder }, root, new DateTime(2026, 9, 30, 21, 6, 7));
            Assert.That(again, Has.Count.EqualTo(1));
            Assert.That(File.Exists(held), Is.False);
            Assert.That(File.Exists(Path.Combine(root, "2026-09-30_210607", "host", "TrackMaps", "held.csv")), Is.True);
        }
    }
}
