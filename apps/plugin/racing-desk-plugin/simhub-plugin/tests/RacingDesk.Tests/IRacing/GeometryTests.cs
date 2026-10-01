using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Microsoft.Data.Sqlite;
using NUnit.Framework;
using RacingDesk.Data;
using RacingDesk.Plugin.IRacing;

namespace RacingDesk.Tests.IRacing
{
    /// <summary>
    /// The outline derived from Lat/Lon: which laps are in, which are out and why, how laps and files are averaged,
    /// how the store keeps the result, and how the host serves it. Synthetic laps round a made-up circuit throughout.
    /// </summary>
    [TestFixture]
    public class GeometryTests
    {
        private static readonly DateTime March = new DateTime(2026, 3, 1, 9, 0, 0, DateTimeKind.Utc);
        private string _dir;

        [SetUp]
        public void SetUp() => Directory.CreateDirectory(_dir = Path.Combine(Path.GetTempPath(), "racing-desk-geometry-" + Guid.NewGuid().ToString("N")));

        [TearDown]
        public void TearDown()
        {
            SqliteConnection.ClearAllPools();
            try { Directory.Delete(_dir, true); } catch { }
        }

        private string Db => Path.Combine(_dir, "racing-desk.db");

        private static TrackGeometryRecord Outline(IReadOnlyList<SyntheticLaps.Frame> frames, out GeometryAccumulator acc, double? officialMeters = null, TrackGeometryRecord mergeInto = null)
        {
            string path = Path.Combine(Path.GetTempPath(), "racing-desk-laps-" + Guid.NewGuid().ToString("N") + ".ibt");
            try
            {
                SyntheticLaps.Write(path, SyntheticLaps.Yaml(), frames, March);
                using var ibt = new IbtFile(path);
                acc = new GeometryAccumulator(777, "Synthetic Circuit", officialMeters ?? SyntheticLaps.OfficialMeters, mergeInto);
                using var reader = new IbtSequentialReader(ibt, 3);
                while (reader.MoveNext()) acc.Feed(reader);
                return acc.Result(path, new[] { 0.0, 0.35, 0.7 });
            }
            finally
            {
                try { File.Delete(path); } catch { }
            }
        }

        // ── Which laps are in ──

        [Test]
        public void CleanLapsMakeAnOutlineOfTheRightLengthWithTheLineAtTheFirstBin()
        {
            var g = Outline(SyntheticLaps.Laps(3), out var acc);
            Assert.That(g, Is.Not.Null);
            Assert.That(acc.CleanLaps, Is.EqualTo(3));
            Assert.That(g.CleanLaps, Is.EqualTo(3));
            Assert.That(g.Checks, Is.EqualTo(GeometryAccumulator.ChecksVersion));
            Assert.That(g.Provisional, Is.False);
            double expected = SyntheticLaps.CircuitLength();
            Assert.That(g.LengthMeters, Is.EqualTo(expected).Within(expected * 0.005), "the outline is as long as the circuit");
            Assert.That(g.Points.Length / 3, Is.EqualTo(1000));
            Assert.That(g.Points[0], Is.EqualTo(0).Within(2), "bin 0 is the line: x");
            Assert.That(g.Points[1], Is.EqualTo(0).Within(2), "bin 0 is the line: y");
            Assert.That(g.OriginLat, Is.EqualTo(SyntheticLaps.Lat0).Within(1e-4));
            Assert.That(g.SectorStartPcts, Is.EqualTo(new[] { 0.0, 0.35, 0.7 }));
            Assert.That(acc.LengthWarning, Is.Null);
            // The frame after the last lap begins a lap of one sample: short, and out, as it should be.
            Assert.That(acc.Rejected, Is.EqualTo(new Dictionary<string, int> { ["short"] = 1 }));
        }

        [Test]
        public void ALapWithASampleWithNoPositionIsOutWhole()
        {
            // Lap 2 has one frame at 0,0: the whole lap is out, not the frame.
            var frames = SyntheticLaps.Laps(3, bend: f => { if (f.Lap == 2 && Math.Abs(f.Pct - 0.5f) < 0.001f) { f.Lat = 0; f.Lon = 0; } });
            Outline(frames, out var acc);
            Assert.That(acc.CleanLaps, Is.EqualTo(2));
            Assert.That(acc.Rejected["no position"], Is.EqualTo(1));
        }

        [Test]
        public void ALapWithAStopInItIsOut()
        {
            var frames = SyntheticLaps.Laps(3, bend: f => { if (f.Lap == 2 && f.Pct > 0.4f && f.Pct < 0.45f) f.Speed = 0.5f; });
            Outline(frames, out var acc);
            Assert.That(acc.CleanLaps, Is.EqualTo(2));
            Assert.That(acc.Rejected["stopped"], Is.EqualTo(1));
        }

        [Test]
        public void ALapWithATowInItIsOut()
        {
            // A reset: the car is somewhere else from one sample to the next, and the lap counter is the same.
            var frames = SyntheticLaps.Laps(3, bend: f =>
            {
                if (f.Lap == 2 && f.Pct > 0.6f) { var (lat, lon) = SyntheticLaps.ToLatLon(SyntheticLaps.Circuit(f.Pct).X + 120, SyntheticLaps.Circuit(f.Pct).Y + 120); f.Lat = lat; f.Lon = lon; }
            });
            Outline(frames, out var acc);
            Assert.That(acc.CleanLaps, Is.EqualTo(2));
            Assert.That(acc.Rejected["jump"], Is.EqualTo(1));
        }

        [Test]
        public void ALapThatDoesNotCloseIsOut()
        {
            // The lap's end drifts away from the line: by its last sample the car is 80 m from where it began.
            var frames = SyntheticLaps.Laps(3, bend: f =>
            {
                if (f.Lap == 2 && f.Pct > 0.5f)
                {
                    double drift = (f.Pct - 0.5) / 0.5 * 80;
                    var (lat, lon) = SyntheticLaps.ToLatLon(SyntheticLaps.Circuit(f.Pct).X + drift, SyntheticLaps.Circuit(f.Pct).Y);
                    f.Lat = lat; f.Lon = lon;
                }
            });
            Outline(frames, out var acc);
            Assert.That(acc.CleanLaps, Is.EqualTo(2));
            Assert.That(acc.Rejected["not closed"], Is.EqualTo(1));
        }

        [Test]
        public void ALapOnPitRoadOrOffTheTrackOrNotFromTheLineIsOut()
        {
            var pitted = SyntheticLaps.Laps(2, bend: f => { if (f.Lap == 1 && f.Pct > 0.9f) f.OnPitRoad = true; });
            Outline(pitted, out var acc);
            Assert.That((acc.CleanLaps, acc.Rejected["pit road"]), Is.EqualTo((1, 1)));

            var off = SyntheticLaps.Laps(2, bend: f => { if (f.Lap == 1 && f.Pct > 0.3f && f.Pct < 0.32f) f.Surface = 0; });
            Outline(off, out acc);
            Assert.That((acc.CleanLaps, acc.Rejected["off track"]), Is.EqualTo((1, 1)));

            // A capture begun mid-lap: the first lap starts at 0.4 of the way round.
            var joined = SyntheticLaps.Laps(2).Where(f => f.Lap > 1 || f.Pct >= 0.4f).ToList();
            Outline(joined, out acc);
            Assert.That((acc.CleanLaps, acc.Rejected["not from the line"]), Is.EqualTo((1, 1)));
        }

        [Test]
        public void ALapOnAnotherLineIsNotAveragedIn()
        {
            // Lap 2 is the same circuit 40 m to the east: a rescan, a north fix. It is not the same place as laps 1
            // and 3, and is left out of their average. (Each lap's own frames only: the closing frame a lap ends with
            // belongs to the next lap, and here the next lap has frames of its own.)
            var frames = SyntheticLaps.Laps(1).Where(f => f.Lap == 1).ToList();
            frames.AddRange(SyntheticLaps.Laps(1, shiftX: 40).Where(f => f.Lap == 1).Select(f => { f.Lap += 1; f.Time += 40; return f; }));
            frames.AddRange(SyntheticLaps.Laps(1).Select(f => { f.Lap += 2; f.Time += 80; return f; }));
            var g = Outline(frames, out var acc);
            Assert.That(acc.CleanLaps, Is.EqualTo(2), "laps 1 and 3");
            Assert.That(acc.Rejected["disagrees"], Is.EqualTo(1));
            Assert.That(g.CleanLaps, Is.EqualTo(2));
        }

        [Test]
        public void TheLengthTheSessionGivesIsAWarningAndNotAGate()
        {
            // The YAML says 4% more than the circuit is (as Okayama's does): the outline is kept, and the difference said.
            var g = Outline(SyntheticLaps.Laps(2), out var acc, officialMeters: SyntheticLaps.CircuitLength() * 1.04);
            Assert.That(g, Is.Not.Null);
            Assert.That(g.CleanLaps, Is.EqualTo(2));
            Assert.That(acc.LengthWarning, Does.Contain("the session says").And.Contain("-3.8%").Or.Contain("-3.9%"));
        }

        [Test]
        public void ASingleCleanLapIsAnOutline()
        {
            var g = Outline(SyntheticLaps.Laps(1), out var acc);
            Assert.That(g, Is.Not.Null);
            Assert.That(g.CleanLaps, Is.EqualTo(1));
        }

        [Test]
        public void LapsAreAveragedIntoTheRecordTheyAreMergedIntoInItsFrame()
        {
            var first = Outline(SyntheticLaps.Laps(2), out _);
            // Two more laps, on a line 3 m inside the first: agree, and the mean moves a third of the way.
            var more = Outline(SyntheticLaps.Laps(2, scale: 0.993), out var acc, mergeInto: first);
            Assert.That(acc.CleanLaps, Is.EqualTo(2), "this run's own laps");
            Assert.That(more.CleanLaps, Is.EqualTo(4), "and the record's");
            Assert.That(more.OriginLat, Is.EqualTo(first.OriginLat));
            Assert.That(more.OriginLon, Is.EqualTo(first.OriginLon));
            var (median, _) = GeometryAccumulator.Deviation(first, more);
            Assert.That(median, Is.GreaterThan(0.5).And.LessThan(3), "between the two lines");
        }

        // ── Two outlines of a layout ──

        [Test]
        public void OutlinesOfTheSamePlaceAgreeAndOfAnotherDoNot()
        {
            var a = Outline(SyntheticLaps.Laps(2), out _);
            var b = Outline(SyntheticLaps.Laps(2, scale: 0.995), out _);
            var c = Outline(SyntheticLaps.Laps(2, shiftX: 30, shiftY: -20), out _);
            Assert.That(GeometryAccumulator.Agree(a, b), Is.True);
            Assert.That(GeometryAccumulator.Agree(a, c), Is.False);
            var merged = GeometryAccumulator.Merge(a, b);
            Assert.That(merged.CleanLaps, Is.EqualTo(4));
            Assert.That(merged.Points.Length, Is.EqualTo(a.Points.Length));
            Assert.That(GeometryAccumulator.Deviation(a, merged).Median, Is.LessThan(2));
        }

        // ── The store ──

        [Test]
        public void TheStoreKeepsAnOutlineWithItsChecksAndMergesByTheRules()
        {
            var a = Outline(SyntheticLaps.Laps(2), out _);
            var same = Outline(SyntheticLaps.Laps(3, scale: 0.996), out _);
            var elsewhere = Outline(SyntheticLaps.Laps(2, shiftX: 60), out _);
            using var store = new RacingDeskStore(Db);

            Assert.That(store.MergeGeometry(a), Is.EqualTo(GeometryMerge.New));
            var kept = store.GetGeometry(777);
            Assert.That((kept.CleanLaps, kept.Checks, kept.Provisional), Is.EqualTo((2, GeometryAccumulator.ChecksVersion, false)));
            Assert.That(kept.Points, Is.EqualTo(a.Points));

            Assert.That(store.MergeGeometry(same), Is.EqualTo(GeometryMerge.Averaged));
            Assert.That(store.GetGeometry(777).CleanLaps, Is.EqualTo(5));

            Assert.That(store.MergeGeometry(elsewhere), Is.EqualTo(GeometryMerge.Replaced), "the newer file is of another place: it wins");
            Assert.That(store.GetGeometry(777).CleanLaps, Is.EqualTo(2));
            Assert.That(store.GetGeometry(777).Points, Is.EqualTo(elsewhere.Points));

            // A provisional outline never replaces a whole one; a whole one replaces a provisional.
            var provisional = Outline(SyntheticLaps.Laps(1, shiftX: 60), out _);
            provisional.Provisional = true;
            Assert.That(store.MergeGeometry(provisional), Is.EqualTo(GeometryMerge.Kept));
            Assert.That(store.GetGeometry(777).CleanLaps, Is.EqualTo(2));
            store.ReplaceGeometry(provisional);
            Assert.That(store.GetGeometry(777).Provisional, Is.True);
            Assert.That(store.MergeGeometry(elsewhere), Is.EqualTo(GeometryMerge.Replaced));
            Assert.That(store.GetGeometry(777).Provisional, Is.False);

            // A row built with fewer checks is replaced whatever it says.
            store.Exec("DELETE FROM track_geometry_build WHERE track_id = 777");
            Assert.That(store.TrackIdsNeedingRebuild().Select(t => t.TrackId), Is.EqualTo(new[] { 777 }));
            Assert.That(store.MergeGeometry(a), Is.EqualTo(GeometryMerge.Replaced));
            Assert.That(store.TrackIdsNeedingRebuild(), Is.Empty);
        }

        [Test]
        public void AnOutlineLookedAtWithNoFileToBuildItFromIsNotLookedForAgainAndIsNotTakenForOneTheChecksPassed()
        {
            var a = Outline(SyntheticLaps.Laps(2), out _);
            using var store = new RacingDeskStore(Db);
            store.MergeGeometry(a);
            store.Exec("DELETE FROM track_geometry_build WHERE track_id = 777");
            Assert.That(store.TrackIdsNeedingRebuild().Select(t => t.TrackId), Is.EqualTo(new[] { 777 }));

            store.MarkGeometryLooked(777);
            Assert.That(store.TrackIdsNeedingRebuild(), Is.Empty, "not looked for again");
            var kept = store.GetGeometry(777);
            Assert.That((kept.Checks, kept.Provisional), Is.EqualTo((0, false)), "and still said to be built before these checks");
            Assert.That(kept.Points, Is.EqualTo(a.Points));

            // A file's outline that has passed them replaces it, and says so.
            Assert.That(store.MergeGeometry(a), Is.EqualTo(GeometryMerge.Replaced));
            Assert.That(store.GetGeometry(777).Checks, Is.EqualTo(GeometryAccumulator.ChecksVersion));
        }

        [Test]
        public void AVersion7StoreGainsTheTableOfWhatTheOutlinesWereBuiltWithAndItsOutlinesReadAsBuiltBeforeTheChecks()
        {
            var a = Outline(SyntheticLaps.Laps(2), out _);
            string columns;
            using (var store = new RacingDeskStore(Db))
            {
                store.MergeGeometry(a);
                columns = store.Scalar<string>("SELECT GROUP_CONCAT(name, ',') FROM pragma_table_info('track_geometry')");
                // As a version 7 store was: no table of what the outlines were built with.
                store.Exec("DROP TABLE track_geometry_build; DELETE FROM schema_version; INSERT INTO schema_version (version) VALUES (7)");
            }
            SqliteConnection.ClearAllPools();
            using (var unmigrated = RacingDeskStore.OpenReadOnly(Db))
            {
                var g = unmigrated.GetGeometry(777);
                Assert.That((g.CleanLaps, g.Checks, g.Provisional), Is.EqualTo((2, 0, false)), "read as it is, with nothing made up");
            }
            SqliteConnection.ClearAllPools();
            using (var migrated = new RacingDeskStore(Db))
            {
                Assert.That(migrated.Scalar<long>("SELECT MAX(version) FROM schema_version"), Is.EqualTo(8));
                Assert.That(migrated.Scalar<string>("SELECT GROUP_CONCAT(name, ',') FROM pragma_table_info('track_geometry')"), Is.EqualTo(columns),
                    "the outlines' table is as it was: earlier builds write to it by position");
                Assert.That(columns, Does.EndWith("sector_starts,updated_at"));
                var g = migrated.GetGeometry(777);
                Assert.That((g.CleanLaps, g.Checks, g.Provisional), Is.EqualTo((2, 0, false)));
                Assert.That(migrated.TrackIdsNeedingRebuild().Select(t => t.TrackId), Is.EqualTo(new[] { 777 }), "and is built again");
            }
        }

        [Test]
        public void AnEarlierBuildCanStillWriteAnOutlineIntoAStoreThisOneHasOpened()
        {
            var a = Outline(SyntheticLaps.Laps(3), out _);
            using var store = new RacingDeskStore(Db);
            store.MergeGeometry(a);
            Assert.That(store.GetGeometry(777).Checks, Is.EqualTo(GeometryAccumulator.ChecksVersion));

            // What every build up to the one before this wrote an outline with: eleven values, by position.
            var elsewhere = Outline(SyntheticLaps.Laps(1, shiftX: 60), out _);
            var blob = new byte[elsewhere.Points.Length * 4];
            Buffer.BlockCopy(elsewhere.Points, 0, blob, 0, blob.Length);
            Assert.DoesNotThrow(() => store.Exec(
                "INSERT OR REPLACE INTO track_geometry VALUES ($t, $n, $len, $off, $laps, $src, $lat, $lon, $pts, $sec, $at)", null,
                ("$t", 777), ("$n", "Synthetic Circuit"), ("$len", elsewhere.LengthMeters), ("$off", elsewhere.OfficialLengthMeters), ("$laps", 1),
                ("$src", "older-build.ibt"), ("$lat", elsewhere.OriginLat), ("$lon", elsewhere.OriginLon), ("$pts", blob), ("$sec", "0,0.35,0.7"),
                ("$at", DateTime.UtcNow.AddMinutes(5).ToString("yyyy-MM-ddTHH:mm:ss.fffZ", System.Globalization.CultureInfo.InvariantCulture))));

            // What this build said of the outline it had does not apply to the one the earlier build wrote.
            var g = store.GetGeometry(777);
            Assert.That((g.CleanLaps, g.SourceIbt), Is.EqualTo((1, "older-build.ibt")));
            Assert.That((g.Checks, g.Provisional), Is.EqualTo((0, false)), "built by something that had no checks");
            Assert.That(store.TrackIdsNeedingRebuild().Select(t => t.TrackId), Is.EqualTo(new[] { 777 }));
        }

        // ── The ingest ──

        [Test]
        public void TheIngestKeepsAFilesOutlineAndTheRebuildReadsTheLayoutsFilesNewestFirst()
        {
            string older = SyntheticLaps.Write(Path.Combine(_dir, "older.ibt"), SyntheticLaps.Yaml(), SyntheticLaps.Laps(3, shiftX: 50), March);
            string newer = SyntheticLaps.Write(Path.Combine(_dir, "newer.ibt"), SyntheticLaps.Yaml(), SyntheticLaps.Laps(2), March.AddDays(10));
            string other = SyntheticLaps.Write(Path.Combine(_dir, "other.ibt"), SyntheticLaps.Yaml(trackId: 778, name: "Another"), SyntheticLaps.Laps(2), March.AddDays(5));
            File.SetLastWriteTimeUtc(older, DateTime.UtcNow.AddHours(-3));
            File.SetLastWriteTimeUtc(other, DateTime.UtcNow.AddHours(-2));
            File.SetLastWriteTimeUtc(newer, DateTime.UtcNow.AddHours(-1));

            var log = new List<string>();
            using var store = new RacingDeskStore(Db);
            var ingest = new IbtIngest(store, log.Add);
            var summary = ingest.Run(_dir, frameStep: 3);
            Assert.That(summary.FilesIngested, Is.EqualTo(3));
            Assert.That(summary.GeometryUpdates, Is.EqualTo(3), "the older file's outline, the other layout's, then the newer file's replacing the older's");
            Assert.That(log.Count(l => l.StartsWith("outline made")), Is.EqualTo(2));
            Assert.That(log.Count(l => l.StartsWith("outline replaced")), Is.EqualTo(1), "the newer file disagrees with the older: it wins");
            var kept = store.GetGeometry(777);
            Assert.That(kept.CleanLaps, Is.EqualTo(2));
            Assert.That(kept.SourceIbt, Is.EqualTo(newer));
            Assert.That(store.IbtPathsForTrack(777), Is.EqualTo(new[] { newer, older }), "newest first");

            // Built with fewer checks: the rebuild reads the layout's files newest first, and the newer file's laps
            // stand; the older file, being of another place, is not averaged in.
            store.Exec("DELETE FROM track_geometry_build");
            log.Clear();
            Assert.That(ingest.RebuildGeometry(frameStep: 3), Is.EqualTo(2));
            Assert.That(log, Has.Some.StartsWith("outline rebuilt: Synthetic Circuit, 2 clean laps of 2 files (2 read)"));
            Assert.That(log, Has.Some.StartsWith("outline rebuilt: Another, 2 clean laps of 1 files (1 read)"));
            Assert.That(store.GetGeometry(777).Checks, Is.EqualTo(GeometryAccumulator.ChecksVersion));
            Assert.That(store.TrackIdsNeedingRebuild(), Is.Empty);
            Assert.That(store.Scalar<long>("SELECT COUNT(*) FROM sessions"), Is.EqualTo(3), "the sessions are as they were");

            // A file the ingest already has at this length and time is not read again by the watch.
            Assert.That(new DirectoryInfo(_dir).EnumerateFiles("*.ibt").Any(f => ingest.WantsFile(f, DateTime.UtcNow)), Is.False);
            // One written a moment ago is left to settle; one written an hour ago and not read is wanted.
            string fresh = SyntheticLaps.Write(Path.Combine(_dir, "fresh.ibt"), SyntheticLaps.Yaml(), SyntheticLaps.Laps(1), March.AddDays(20));
            File.SetLastWriteTimeUtc(fresh, DateTime.UtcNow);
            Assert.That(ingest.WantsFile(new FileInfo(fresh), DateTime.UtcNow), Is.False);
            Assert.That(ingest.WantsFile(new FileInfo(fresh), DateTime.UtcNow.AddMinutes(3)), Is.True);
        }

        [Test]
        public void TheHostIngestsTheNewFilesBeforeItRebuildsTheOldOutlines()
        {
            Assume.That(BackgroundIo.SimRunning(), Is.False, "the host's background thread waits while the sim runs");
            // Layout 778's file was ingested before and its outline is from before the checks, so it is built again
            // (on a first run that is every layout's files, tens of gigabytes); layout 777's file is new. The new
            // file goes in first: the rebuild must not keep his last sessions out of the desk.
            string telemetry = Path.Combine(_dir, "telemetry");
            Directory.CreateDirectory(telemetry);
            string old = SyntheticLaps.Write(Path.Combine(telemetry, "old.ibt"), SyntheticLaps.Yaml(trackId: 778, name: "Another"), SyntheticLaps.Laps(2), March);
            File.SetLastWriteTimeUtc(old, DateTime.UtcNow.AddHours(-3));
            using (var store = new RacingDeskStore(Db))
            {
                new IbtIngest(store).Run(telemetry, frameStep: 3);
                store.Exec("DELETE FROM track_geometry_build");
            }
            SqliteConnection.ClearAllPools();
            string fresh = SyntheticLaps.Write(Path.Combine(telemetry, "new.ibt"), SyntheticLaps.Yaml(), SyntheticLaps.Laps(2), March.AddDays(1));
            File.SetLastWriteTimeUtc(fresh, DateTime.UtcNow.AddHours(-1));

            var lines = new List<string>();
            var was = RacingDesk.Plugin.Log.Sink;
            RacingDesk.Plugin.Log.Sink = (level, text) => { lock (lines) lines.Add(text); };
            try
            {
                using var stop = new System.Threading.ManualResetEventSlim();
                RacingDesk.Host.Program.BackgroundIngest(RacingDesk.Host.HostOptions.Parse(new[] { "--db", Db, "--dir", telemetry }), stop);
            }
            finally
            {
                RacingDesk.Plugin.Log.Sink = was;
            }
            string[] seen;
            lock (lines) seen = lines.ToArray();
            int newFiles = Array.FindIndex(seen, l => l.Contains("ingest: 1 new files"));
            int rebuilt = Array.FindIndex(seen, l => l.Contains("outline rebuilt: Another"));
            Assert.That(newFiles, Is.GreaterThanOrEqualTo(0), "the new file went in: " + string.Join(" | ", seen));
            Assert.That(rebuilt, Is.GreaterThan(newFiles), "and the old outline was built again after it: " + string.Join(" | ", seen));
        }

        [Test]
        public void TheRebuildKeepsTheNewestFilesNameAndSectorsWhenTheFilesAgree()
        {
            // Two files of one layout whose laps agree, the newer saying it is called something else (iRacing renames
            // a layout between seasons): the row the rebuild leaves has the newer file's, not the older's.
            string older = SyntheticLaps.Write(Path.Combine(_dir, "zz-older.ibt"), SyntheticLaps.Yaml(name: "Old Name"), SyntheticLaps.Laps(2), March);
            string newer = SyntheticLaps.Write(Path.Combine(_dir, "aa-newer.ibt"), SyntheticLaps.Yaml(name: "New Name"), SyntheticLaps.Laps(2, scale: 0.997), March.AddDays(10));
            File.SetLastWriteTimeUtc(older, DateTime.UtcNow.AddHours(-3));
            File.SetLastWriteTimeUtc(newer, DateTime.UtcNow.AddHours(-1));
            using var store = new RacingDeskStore(Db);
            var ingest = new IbtIngest(store);
            ingest.Run(_dir, frameStep: 3);
            Assert.That(store.GetGeometry(777).CleanLaps, Is.EqualTo(4), "the two files agree and are averaged");

            store.Exec("DELETE FROM track_geometry_build");
            Assert.That(ingest.RebuildGeometry(frameStep: 3), Is.EqualTo(1));
            var rebuilt = store.GetGeometry(777);
            Assert.That(rebuilt.CleanLaps, Is.EqualTo(4));
            Assert.That(rebuilt.TrackName, Is.EqualTo("New Name"), "the newest file's");
            Assert.That(rebuilt.SourceIbt, Is.EqualTo(newer), "the newest file's, though its path sorts before the older's");

            // And merging in the file given, as the store does, takes that one's: the file given is the newer.
            var a = Outline(SyntheticLaps.Laps(2), out _);
            var b = Outline(SyntheticLaps.Laps(2, scale: 0.997), out _);
            a.TrackName = "First"; a.SourceIbt = "z.ibt";
            b.TrackName = "Second"; b.SourceIbt = "a.ibt";
            Assert.That(GeometryAccumulator.Merge(a, b).TrackName, Is.EqualTo("Second"));
            Assert.That(GeometryAccumulator.Merge(a, b, addIsNewer: false).TrackName, Is.EqualTo("First"));
        }

        [Test]
        public void TheWatchReadsAFileWrittenSinceTheLastPassOnceItHasSettled()
        {
            var log = new List<string>();
            using var store = new RacingDeskStore(Db);
            var ingest = new IbtIngest(store, log.Add);
            using var cts = new System.Threading.CancellationTokenSource();
            var watching = System.Threading.Tasks.Task.Run(() => ingest.WatchFinished(_dir, cts.Token, pause: null, frameStep: 3, every: TimeSpan.FromMilliseconds(100)));

            // A file the sim is still writing (written just now) is left alone; one that has settled goes in.
            string fresh = SyntheticLaps.Write(Path.Combine(_dir, "fresh.ibt"), SyntheticLaps.Yaml(), SyntheticLaps.Laps(1), March);
            File.SetLastWriteTimeUtc(fresh, DateTime.UtcNow);
            System.Threading.Thread.Sleep(400);
            Assert.That(store.Scalar<long>("SELECT COUNT(*) FROM ingested_files"), Is.Zero);
            string settled = SyntheticLaps.Write(Path.Combine(_dir, "settled.ibt"), SyntheticLaps.Yaml(), SyntheticLaps.Laps(2), March.AddDays(1));
            for (int i = 0; i < 100 && store.Scalar<long>("SELECT COUNT(*) FROM ingested_files WHERE path = $p".Replace("$p", "'" + settled.Replace("'", "''") + "'")) == 0; i++)
                System.Threading.Thread.Sleep(100);
            Assert.That(store.Scalar<long>("SELECT COUNT(*) FROM ingested_files"), Is.EqualTo(1), "the settled file, and not the fresh one");
            Assert.That(store.GetGeometry(777)?.CleanLaps, Is.EqualTo(2));
            Assert.That(log, Has.Some.StartsWith("1 new files, 1 sessions, 0 unreadable"));

            cts.Cancel();
            Assert.That(watching.Wait(TimeSpan.FromSeconds(5)), Is.True, "stops when asked");
        }

        [Test]
        public void ALayoutNoFileGivesACleanLapForKeepsItsOutlineMarkedLookedAt()
        {
            string path = SyntheticLaps.Write(Path.Combine(_dir, "spun.ibt"), SyntheticLaps.Yaml(),
                SyntheticLaps.Laps(2, bend: f => { if (f.Pct > 0.5f && f.Pct < 0.52f) f.Speed = 0; }), March);
            var old = Outline(SyntheticLaps.Laps(2), out _);
            old.Checks = 0;
            var log = new List<string>();
            using var store = new RacingDeskStore(Db);
            store.ReplaceGeometry(old);
            var ingest = new IbtIngest(store, log.Add);
            ingest.Run(_dir, frameStep: 3);
            Assert.That(store.GetGeometry(777).Checks, Is.Zero, "a file with no clean lap changes nothing");
            Assert.That(ingest.RebuildGeometry(frameStep: 3), Is.Zero);
            Assert.That(log, Has.Some.StartsWith("outline kept as it was: Synthetic Circuit, no file gave a clean lap"));
            Assert.That(store.GetGeometry(777).Checks, Is.Zero, "it is not taken for an outline the checks passed: nothing here built it with them");
            Assert.That(store.GetGeometry(777).Points, Is.EqualTo(old.Points));
            Assert.That(store.TrackIdsNeedingRebuild(), Is.Empty, "but it is not looked for again");
            log.Clear();
            Assert.That(ingest.RebuildGeometry(frameStep: 3), Is.Zero);
            Assert.That(log, Is.Empty, "no file read a second time");
        }

        [Test]
        public void TheFollowerFollowsALayoutWhoseOutlineWasOnlyLookedAtNotOneBuiltWithTheChecks()
        {
            var old = Outline(SyntheticLaps.Laps(2), out _);
            old.Checks = 0;
            using (var store = new RacingDeskStore(Db))
            {
                store.ReplaceGeometry(old);
                store.MarkGeometryLooked(777);
            }
            SqliteConnection.ClearAllPools();

            var frames = SyntheticLaps.Laps(1);
            string path = Path.Combine(_dir, "mx5 mx52016_synthetic full 2026-03-01 09-00-00.ibt");
            File.WriteAllBytes(path, SyntheticLaps.Bytes(SyntheticLaps.Yaml(), frames, March, claimedFrames: 0));
            File.SetLastWriteTimeUtc(path, March);
            var log = new List<string>();
            using var follower = new IbtFollower(_dir, Db, log.Add, () => March);
            follower.Seen(777);
            follower.Look();
            Assert.That(log, Has.Some.StartsWith("following "), "an outline no lap passed the checks for is not a whole one");
            Assert.That(follower.Current(777)?.CleanLaps, Is.EqualTo(1));
        }

        // ── A result taken while a lap is being driven ──

        [Test]
        public void AResultTakenMidLapLeavesTheLapBeingDrivenToCloseAtTheLine()
        {
            var frames = SyntheticLaps.Laps(3);
            string path = Path.Combine(_dir, "mid-lap.ibt");
            SyntheticLaps.Write(path, SyntheticLaps.Yaml(), frames, March);
            int perLap = frames.Count / 3;
            using var ibt = new IbtFile(path);

            TrackGeometryRecord Run(bool closeOpenLap, out GeometryAccumulator acc)
            {
                acc = new GeometryAccumulator(777, "Synthetic Circuit", SyntheticLaps.OfficialMeters);
                using var reader = new IbtSequentialReader(ibt, 3);
                TrackGeometryRecord midLap = null;
                while (reader.MoveNext())
                {
                    acc.Feed(reader);
                    // Ten seconds into the second lap.
                    if (reader.FrameIndex >= perLap + 600 && midLap == null) midLap = acc.Result(path, null, provisional: true, closeOpenLap: closeOpenLap);
                }
                Assert.That(midLap, Is.Not.Null);
                Assert.That(midLap.CleanLaps, Is.EqualTo(1), "the lap that has closed is in");
                return acc.Result(path, null);
            }

            var kept = Run(closeOpenLap: false, out var acc);
            Assert.That(kept.CleanLaps, Is.EqualTo(3), "the lap being driven went on and was whole: " + string.Join(", ", acc.Rejected.Select(r => r.Key + " " + r.Value)));

            // Judged where it stood, its first ten seconds go, and what is left of it is not from the line.
            var lost = Run(closeOpenLap: true, out acc);
            Assert.That(lost.CleanLaps, Is.EqualTo(2));
            Assert.That(acc.Rejected, Does.ContainKey("not from the line"));
        }

        // ── Serving them ──

        [Test]
        public void TrackOutlinesServesTheStoresAsksAgainAfterAMissAndPrefersTheLiveOneToAProvisional()
        {
            var a = Outline(SyntheticLaps.Laps(2), out _);
            var now = March;
            var outlines = new TrackOutlines(Db, () => now);
            Assert.That(outlines.ForTrack(777), Is.Null, "no store yet");

            using (var store = new RacingDeskStore(Db)) store.MergeGeometry(a);
            Assert.That(outlines.ForTrack(777), Is.Null, "a miss is kept for five seconds");
            now = now.AddSeconds(6);
            var served = outlines.ForTrack(777);
            Assert.That(served, Is.Not.Null);
            Assert.That(served.CleanLaps, Is.EqualTo(2));
            Assert.That(served.Points.Count, Is.EqualTo(1000));
            Assert.That(served.Points[0].Pct, Is.Zero);
            Assert.That(served.Points[0].Z, Is.EqualTo(-a.Points[1]).Within(1e-6), "z is south: the map is north-up");
            Assert.That(served.Points[250].X, Is.EqualTo(a.Points[750]).Within(1e-6));

            // More laps in the store: served after the hit's minute, not before.
            var same = Outline(SyntheticLaps.Laps(3, scale: 0.997), out _);
            using (var store = new RacingDeskStore(Db)) store.MergeGeometry(same);
            Assert.That(outlines.ForTrack(777).CleanLaps, Is.EqualTo(2));
            now = now.AddSeconds(61);
            Assert.That(outlines.ForTrack(777).CleanLaps, Is.EqualTo(5));

            // A provisional in the store, and a live one with more laps: the live one; a whole one in the store beats both.
            var provisional = Outline(SyntheticLaps.Laps(1), out _);
            provisional.Provisional = true;
            using (var store = new RacingDeskStore(Db)) store.ReplaceGeometry(provisional);
            outlines.Forget(777);
            var live = TrackOutlines.ToOutline(Outline(SyntheticLaps.Laps(2), out _));
            live.Provisional = true;
            outlines.Live = id => id == 777 ? live : null;
            Assert.That(outlines.ForTrack(777), Is.SameAs(live));
            using (var store = new RacingDeskStore(Db)) store.MergeGeometry(same);
            outlines.Forget(777);
            Assert.That(outlines.ForTrack(777).CleanLaps, Is.EqualTo(3));
            Assert.That(outlines.ForTrack(777).Provisional, Is.False);
            Assert.That(outlines.ForTrack(0), Is.Null);
        }
    }
}
