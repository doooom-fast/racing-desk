using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using NUnit.Framework;
using RacingDesk.Data;
using RacingDesk.Host;
using RacingDesk.Plugin.Engine;

namespace RacingDesk.Tests.IRacing
{
    /// <summary>
    /// SimHub's shared map as the interim outline: the one file with the session's exact name, read read-only and
    /// checked, served as an outline marked crowd until his own first clean lap replaces it; nothing written anywhere.
    /// The maps here are made up by the test, in the shape of SimHub's files, in a folder of the test's own.
    /// </summary>
    [TestFixture]
    public class CrowdMapsTests
    {
        private static readonly DateTime March = new DateTime(2026, 3, 1, 9, 0, 0, DateTimeKind.Utc);
        private string _dir;
        private string _simhub;

        [SetUp]
        public void SetUp()
        {
            Directory.CreateDirectory(_dir = Path.Combine(Path.GetTempPath(), "racing-desk-crowd-" + Guid.NewGuid().ToString("N")));
            Directory.CreateDirectory(_simhub = Path.Combine(_dir, "MapRecordsCloud"));
        }

        [TearDown]
        public void TearDown()
        {
            SqliteConnection.ClearAllPools();
            try { Directory.Delete(_dir, true); } catch { }
        }

        private string Db => Path.Combine(_dir, "racing-desk.db");

        // The synthetic layout's names, as its session YAML has them (SyntheticLaps.Yaml): the file SimHub would name.
        private static string LengthKm => (SyntheticLaps.OfficialMeters / 1000).ToString("F2", CultureInfo.InvariantCulture) + " km";
        private static string SyntheticFile => CrowdMaps.FileNameFor("synthetic full", "Full", LengthKm);
        // How many points an outline of his own has on this layout, and so how many a shared map is made into when it has more.
        private static int Bins => GeometryAccumulator.BinsFor(SyntheticLaps.OfficialMeters);

        /// <summary>
        /// A map in the shape of SimHub's: gzip of a lap record whose CarCoordinates are points round the synthetic
        /// circuit — Value [x east, altitude, z south] in metres from the line, p the fraction of the lap, Key the
        /// point's index as a time, the filler [0, 0, 0] at p 1 last — and the rest of the record empty.
        /// </summary>
        private static byte[] Shtl(int n = 1500, double scale = 1.0, Action<List<(double X, double Z, double P)>> bend = null, int records = 120, bool filler = true)
        {
            var points = new List<(double X, double Z, double P)>();
            for (int i = 0; i < n; i++)
            {
                double p = (double)i / n;
                var (x, y) = SyntheticLaps.Circuit(p, scale);
                points.Add((x, -y, p));   // y is north; SimHub's z is south
            }
            bend?.Invoke(points);
            return Pack(Json(points, records, filler));
        }

        private static string Json(List<(double X, double Z, double P)> points, int records = 120, bool filler = true)
        {
            var sb = new StringBuilder();
            sb.Append("{\"TrackDisplayName\":null,\"ReportedTrackLength\":0.0,\"GameCode\":null,\"GameReader\":null,\"TrackConfig\":null,")
              .Append("\"IsReplay\":false,\"IsSimplified\":false,\"Id\":0,\"Version\":6,\"SourceRecordsUsedCount\":").Append(records)
              .Append(",\"SourceRecordsAvailableCount\":").Append(records).Append(",\"HasRelativeCarCoordinates\":true,\"CarCoordinates\":[");
            for (int i = 0; i < points.Count; i++)
            {
                var (x, z, p) = points[i];
                if (i > 0) sb.Append(',');
                sb.Append("{\"Key\":\"").Append(TimeSpan.FromSeconds(i).ToString(@"hh\:mm\:ss")).Append("\",\"Value\":[")
                  .Append(x.ToString("0.##", CultureInfo.InvariantCulture)).Append(',').Append((12.5 + i % 7).ToString("0.##", CultureInfo.InvariantCulture)).Append(',')
                  .Append(z.ToString("0.##", CultureInfo.InvariantCulture)).Append("],\"CurrentSector\":").Append(p < 0.35 ? 1 : p < 0.7 ? 2 : 3)
                  .Append(",\"p\":").Append(p.ToString("R", CultureInfo.InvariantCulture)).Append('}');
            }
            if (filler) sb.Append(points.Count > 0 ? "," : "").Append("{\"Key\":\"").Append(TimeSpan.FromSeconds(points.Count).ToString(@"hh\:mm\:ss")).Append("\",\"Value\":[0,0,0],\"CurrentSector\":3,\"p\":1}");
            sb.Append("],\"LapId\":\"aafe52e0-282a-49b9-a81b-c8bb4fe1dafa\",\"LapNumber\":0,\"LapTime\":\"00:00:00\",\"S1Time\":null,\"S2Time\":null,\"S3Time\":null,")
              .Append("\"SectorDetails\":null,\"MaxSpeed\":0,\"MinSpeed\":999,\"StartPosition\":0,\"EndPosition\":0,\"StartFuel\":0,\"EndFuel\":0,\"Overtakes\":0,")
              .Append("\"Overtaken\":0,\"FuelConsumption\":0,\"AvgSpeed\":0,\"DataPoints\":0,\"HasPitStop\":false,\"RecordDate\":\"0001-01-01T00:00:00\",")
              .Append("\"SessionId\":\"9766d175-dc8b-43a2-b8df-7c326a525047\",\"SessionStartDate\":\"0001-01-01T00:00:00\",\"CarModel\":null,\"CarId\":null,\"TrackName\":null,\"IsDiscarded\":false}");
            return sb.ToString();
        }

        private static byte[] Pack(string json)
        {
            using var packed = new MemoryStream();
            using (var gz = new GZipStream(packed, CompressionLevel.Optimal, leaveOpen: true))
            {
                var bytes = Encoding.UTF8.GetBytes(json);
                gz.Write(bytes, 0, bytes.Length);
            }
            return packed.ToArray();
        }

        private string Put(string name, byte[] bytes, DateTime? written = null)
        {
            string path = Path.Combine(_simhub, name);
            File.WriteAllBytes(path, bytes);
            File.SetLastWriteTimeUtc(path, written ?? March.AddMinutes(-10));
            return path;
        }

        private (string Name, long Length, DateTime Written, byte[] Bytes)[] Folder() =>
            new DirectoryInfo(_simhub).GetFiles().OrderBy(f => f.Name, StringComparer.Ordinal)
                .Select(f => (f.Name, f.Length, f.LastWriteTimeUtc, File.ReadAllBytes(f.FullName))).ToArray();

        // ── The name ──

        [Test]
        public void TheFileNameIsTheSessionsThreeNamesAsSimHubJoinsThemAndNothingElse()
        {
            // Of the 85 files on his machine, 81 made again exactly from the YAML of his .ibt files by this rule (none
            // differed); the other four have no .ibt of his to check against.
            Assert.That(CrowdMaps.FileNameFor("algarve gp", "Grand Prix", "4.5789 km"), Is.EqualTo("algarve gp-Grand Prix-4578.9.shtl"));
            Assert.That(CrowdMaps.FileNameFor("bathurst", "", "6.1441 km"), Is.EqualTo("bathurst-6144.1.shtl"), "no configuration name: no middle");
            Assert.That(CrowdMaps.FileNameFor("bathurst", null, "6.1441 km"), Is.EqualTo("bathurst-6144.1.shtl"));
            Assert.That(CrowdMaps.FileNameFor("crandon full", "Crandon Off-Road Full", "2.3600 km"), Is.EqualTo("crandon full-Crandon Off-Road Full-2360.shtl"), "a whole number of metres has no .0");
            Assert.That(CrowdMaps.FileNameFor("watkinsglen 2021 cupcircuit", "Cup", "3.8930 km"), Is.EqualTo("watkinsglen 2021 cupcircuit-Cup-3893.shtl"));
            Assert.That(CrowdMaps.FileNameFor("barcelona historic", "Historic Circa  95", "4.6751 km"), Is.EqualTo("barcelona historic-Historic Circa  95-4675.1.shtl"), "iRacing's two spaces are kept");
            Assert.That(CrowdMaps.FileNameFor("barcelona rallycross", "RallyX", "1.0925 km"), Is.EqualTo("barcelona rallycross-RallyX-1092.5.shtl"));
            Assert.That(CrowdMaps.FileNameFor("nurburgring combinedlong", "", "25.6550 km"), Is.EqualTo("nurburgring combinedlong-25655.shtl"));
            Assert.That(CrowdMaps.FileNameFor("lagunaseca 2026", "", "3.5558 km"), Is.EqualTo("lagunaseca 2026-3555.8.shtl"));
            // Nothing is trimmed, folded or cased: the name is the YAML's to the letter.
            Assert.That(CrowdMaps.FileNameFor("Lagunaseca 2026", "", "3.5558 km"), Is.EqualTo("Lagunaseca 2026-3555.8.shtl"));
            Assert.That(CrowdMaps.FileNameFor("lagunaseca 2026 ", "", "3.5558 km"), Is.EqualTo("lagunaseca 2026 -3555.8.shtl"));
            // No name, or no length: no file to look for.
            Assert.That(CrowdMaps.FileNameFor("", "Grand Prix", "4.5789 km"), Is.Null);
            Assert.That(CrowdMaps.FileNameFor("algarve gp", "Grand Prix", null), Is.Null);
            Assert.That(CrowdMaps.FileNameFor("algarve gp", "Grand Prix", "soon"), Is.Null);
        }

        // ── The file ──

        [Test]
        public void AFileInSimHubsShapeIsReadIntoTheOutlinesOwnFrameAndMarkedCrowd()
        {
            string path = Put("real-shape.shtl", Shtl(n: 2000, records: 120), March.AddMinutes(-3));
            var outline = CrowdMaps.Read(path, 778, SyntheticLaps.OfficialMeters, out string why, out int records);
            Assert.That(outline, Is.Not.Null, why);
            Assert.That(why, Is.Null);
            Assert.That(records, Is.EqualTo(120));
            Assert.That((outline.TrackId, outline.Crowd, outline.Provisional, outline.CleanLaps), Is.EqualTo((778, true, true, 0)));
            Assert.That(outline.UpdatedAtUtc, Is.EqualTo(March.AddMinutes(-3)));
            Assert.That(outline.OfficialLengthMeters, Is.EqualTo(SyntheticLaps.OfficialMeters));
            Assert.That(outline.LengthMeters, Is.EqualTo(SyntheticLaps.CircuitLength()).Within(SyntheticLaps.CircuitLength() * 0.01));
            // The filler at p 1 is dropped; what is left runs from the line, in order of p, and starts at the origin. The
            // file has more points than an outline of his own (2000 against 1000 here), so it is served at his density.
            Assert.That(outline.Points.Count, Is.EqualTo(Bins));
            Assert.That(outline.Points[0], Is.EqualTo((0.0, 0.0, 0.0)));
            Assert.That(outline.Points.Last().Pct, Is.LessThan(1).And.GreaterThan(0.99));
            for (int i = 1; i < outline.Points.Count; i++) Assert.That(outline.Points[i].Pct, Is.GreaterThan(outline.Points[i - 1].Pct));
            // The frame an outline of his own is in: X east, Z south. A quarter of the way round the synthetic circuit,
            // which runs clockwise from the line at its top, is east and south (as OutlineRouteTests holds the store's to).
            var quarter = outline.Points[Bins / 4];
            Assert.That(quarter.Pct, Is.EqualTo(0.25));
            Assert.That(quarter.X, Is.GreaterThan(100));
            Assert.That(quarter.Z, Is.GreaterThan(100));
            var own = TrackOutlines.ToOutline(IbtIngest.IngestGeometryOnly(
                SyntheticLaps.Write(Path.Combine(_dir, "own.ibt"), SyntheticLaps.Yaml(), SyntheticLaps.Laps(1), March), 777));
            var ownQuarter = own.Points[250];
            Assert.That(quarter.X, Is.EqualTo(ownQuarter.X).Within(3), "the same place as his own outline has it");
            Assert.That(quarter.Z, Is.EqualTo(ownQuarter.Z).Within(3));
        }

        [Test]
        public void AFileThatIsNotAMapIsRefusedAndSaysWhy()
        {
            TrackOutline Try(string json, out string why) => CrowdMaps.Parse(json, 778, SyntheticLaps.OfficialMeters, March, out why, out _);
            string why;
            Assert.That(Try("not json", out why), Is.Null); Assert.That(why, Is.EqualTo("not JSON"));
            Assert.That(Try("[1,2,3]", out why), Is.Null); Assert.That(why, Does.Contain("not a map"));
            Assert.That(Try("{\"Version\":6}", out why), Is.Null); Assert.That(why, Does.Contain("no CarCoordinates"));
            Assert.That(Try("{\"CarCoordinates\":[{\"Key\":\"00:00:00\",\"p\":0}]}", out why), Is.Null); Assert.That(why, Does.Contain("without p or Value"));
            Assert.That(Try("{\"CarCoordinates\":[{\"Value\":[0,0,0],\"p\":1.5}]}", out why), Is.Null); Assert.That(why, Does.Contain("outside 0 to 1"));

            // Points that are there but do not make a lap.
            var full = new List<(double X, double Z, double P)>();
            for (int i = 0; i < 1500; i++) { var (x, y) = SyntheticLaps.Circuit(i / 1500.0); full.Add((x, -y, i / 1500.0)); }
            Assert.That(Try(Json(full.Take(50).ToList()), out why), Is.Null); Assert.That(why, Does.Contain("50 points, fewer than"));
            Assert.That(Try(Json(full.Skip(200).ToList()), out why), Is.Null); Assert.That(why, Does.Contain("does not start at the line"));
            Assert.That(Try(Json(full.Take(1300).ToList()), out why), Is.Null); Assert.That(why, Does.Contain("does not reach the line"));
            Assert.That(Try(Json(full.Where((p, i) => i < 600 || i > 660).ToList()), out why), Is.Null); Assert.That(why, Does.Contain("a hole of 4"));
            var zeroed = full.Select((p, i) => i == 700 ? (0.0, 0.0, p.P) : p).ToList();
            Assert.That(Try(Json(zeroed), out why), Is.Null); Assert.That(why, Does.Contain("a jump of"));
            var open = full.Select(p => (p.P * 2000, p.P * 100, p.P)).ToList();   // a line, not a loop
            Assert.That(Try(Json(open), out why), Is.Null); Assert.That(why, Does.Contain("does not close"));
            var big = new List<(double X, double Z, double P)>();
            for (int i = 0; i < 1500; i++) { var (x, y) = SyntheticLaps.Circuit(i / 1500.0, 1.2); big.Add((x, -y, i / 1500.0)); }
            Assert.That(Try(Json(big), out why), Is.Null); Assert.That(why, Does.Contain("m round, where the session says"));
            // With no length from the session, the length is not judged.
            Assert.That(CrowdMaps.Parse(Json(big), 778, 0, March, out why, out _), Is.Not.Null, why);
            // And the real file's p 1 filler is not a second point at the line: without it the map is as good.
            Assert.That(Try(Json(full, filler: false), out why), Is.Not.Null, why);
        }

        [Test]
        public void AFileDenserThanHisOwnOutlinesIsMadeEvenlySpacedInPctAtTheirDensity()
        {
            // 2800 points, a point to every metre of the 2.8 km circuit (the most a layout this long may have), at
            // a pct that is not evenly spaced: SimHub's p runs a little fast and a little slow round the lap. The
            // points are on the circuit at their own p.
            int n = 2800;
            double official = SyntheticLaps.OfficialMeters;
            Assert.That(n, Is.LessThanOrEqualTo((int)official), "a point to a metre at most");
            var dense = new List<(double X, double Z, double P)>();
            for (int i = 0; i < n; i++)
            {
                double u = (double)i / n;
                double p = u + 0.012 * Math.Sin(2 * Math.PI * u);   // still rising: the slope is 1 ± 0.075
                var (x, y) = SyntheticLaps.Circuit(p);
                dense.Add((x, -y, p));
            }
            var outline = CrowdMaps.Parse(Json(dense), 778, official, March, out string why, out _);
            Assert.That(outline, Is.Not.Null, why);
            Assert.That(outline.Points.Count, Is.EqualTo(Bins), "his own outlines' density, not SimHub's");
            Assert.That(Bins, Is.LessThan(n));
            for (int b = 0; b < Bins; b++)
            {
                var point = outline.Points[b];
                Assert.That(point.Pct, Is.EqualTo((double)b / Bins).Within(1e-12), "evenly spaced in pct, as his own are");
                // On the circuit where the lap is b / Bins of the way round, in the frame the map is in (X east, Z south).
                var (x, y) = SyntheticLaps.Circuit((double)b / Bins);
                Assert.That(Math.Abs(point.X - dense[0].X - x), Is.LessThan(0.5), $"point {b}");
                Assert.That(Math.Abs(point.Z - dense[0].Z + y), Is.LessThan(0.5), $"point {b}");
            }
            Assert.That(outline.Points[0], Is.EqualTo((0.0, 0.0, 0.0)));
            // The length is the file's own, from every one of its points, not what is left of them.
            Assert.That(outline.LengthMeters, Is.EqualTo(SyntheticLaps.CircuitLength()).Within(SyntheticLaps.CircuitLength() * 0.002));

            // And the path the HUD is sent is what his own outline's is: a point to a bin, not to a metre.
            var map = new TrackMapProvider();
            map.OnTrackChanged(778, "synthetic full");
            map.Apply(outline, TrackMapProvider.StatusCrowd);
            Assert.That(map.Status, Is.EqualTo(TrackMapProvider.StatusCrowd));
            Assert.That(map.SvgPath.Split(new[] { " C " }, StringSplitOptions.None).Length - 1, Is.EqualTo(Bins), "a curve to each point");

            // A file with fewer points than that is served as it is: no points made up, none moved.
            var kept = CrowdMaps.Parse(Json(dense.Where((p, i) => i % 4 == 0).ToList()), 778, official, March, out why, out _);
            Assert.That(kept, Is.Not.Null, why);
            Assert.That(kept.Points.Count, Is.EqualTo(700), "fewer than his outline's bins: left as it is");
            Assert.That(kept.Points[1].Pct, Is.EqualTo(dense[4].P), "at the file's own p");
        }

        [Test]
        public void AFileWithMoreMapThanALayoutCanHoldIsRefusedBeforeItsPointsAreRead()
        {
            string why;
            double official = SyntheticLaps.OfficialMeters;
            // Fine points all round the circuit: closed, no hole, no jump, the right length — and more than a point to a
            // metre. Everything else about it would pass, and it is not taken.
            int n = (int)official + 200;
            var dense = new List<(double X, double Z, double P)>();
            for (int i = 0; i < n; i++) { var (x, y) = SyntheticLaps.Circuit((double)i / n); dense.Add((x, -y, (double)i / n)); }
            Assert.That(CrowdMaps.Parse(Json(dense), 778, official, March, out why, out _), Is.Null);
            Assert.That(why, Is.EqualTo($"{n + 1} points, more than the {(int)official} a layout this long has"), "counted with the filler at p 1 the file ends with");
            Assert.That(CrowdMaps.Parse(Json(dense), 778, 0, March, out why, out _), Is.Not.Null, "with no length to judge by, only the most any layout has: " + why);

            // However long the layout: no more than MaxRawPoints, and counted before anything is made of them.
            var tiny = new StringBuilder("{\"CarCoordinates\":[");
            for (int i = 0; i <= CrowdMaps.MaxRawPoints; i++) tiny.Append(i > 0 ? "," : "").Append("{\"Value\":[0,0,0],\"p\":0.5}");
            tiny.Append("]}");
            Assert.That(CrowdMaps.Parse(tiny.ToString(), 778, 40000, March, out why, out _), Is.Null);
            Assert.That(why, Is.EqualTo($"{CrowdMaps.MaxRawPoints + 1} points, more than the {CrowdMaps.MaxRawPoints} a layout this long has"));
            Assert.That(CrowdMaps.Parse(tiny.ToString(), 778, 0, March, out why, out _), Is.Null);
            Assert.That(why, Does.StartWith($"{CrowdMaps.MaxRawPoints + 1} points, more than"));

            // A short layout is not refused for its length: the least allowed is MinRawPointsAllowed.
            var some = new List<(double X, double Z, double P)>();
            for (int i = 0; i < 1500; i++) { var (x, y) = SyntheticLaps.Circuit(i / 1500.0); some.Add((x, -y, i / 1500.0)); }
            Assert.That(CrowdMaps.Parse(Json(some), 778, 300, March, out why, out _), Is.Null);
            Assert.That(why, Does.Contain("m round, where the session says"), "judged by its length, not refused for its count");

            // A number too big to be one is not a point, and nothing is thrown for it.
            Assert.That(CrowdMaps.Parse("{\"CarCoordinates\":[{\"Value\":[1e999,0,0],\"p\":0.5}]}", 778, official, March, out why, out _), Is.Null);
            Assert.That(why, Is.EqualTo("a point that is not a number"));
        }

        /// <summary>A stream whose length is not what it has in it: the file SimHub is writing, between a look and a read.</summary>
        private sealed class ClaimedStream : Stream
        {
            private readonly long _claimed;
            private readonly long _has;
            public long Delivered;
            public ClaimedStream(long claimed, long has) { _claimed = claimed; _has = has; }
            public override bool CanRead => true;
            public override bool CanSeek => false;
            public override bool CanWrite => false;
            public override long Length => _claimed;
            public override long Position { get => Delivered; set => throw new NotSupportedException(); }
            public override int Read(byte[] buffer, int offset, int count)
            {
                int n = (int)Math.Min(count, _has - Delivered);
                for (int i = 0; i < n; i++) buffer[offset + i] = 0x1f;
                Delivered += n;
                return n;
            }
            public override void Flush() { }
            public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
            public override void SetLength(long value) => throw new NotSupportedException();
            public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        }

        [Test]
        public void ThePackedCapIsOnTheBytesOfTheOpenFileNotOnTheSizeSeenBeforeItWasOpened()
        {
            // The length of the open file is over the cap: nothing of it is read, and it is said how big it is.
            using (var big = new ClaimedStream(CrowdMaps.MaxPackedBytes + 1, long.MaxValue))
            {
                Assert.That(CrowdMaps.ReadPacked(big, out string why), Is.Null);
                Assert.That(why, Is.EqualTo("2049 KB packed, over the 2048 KB a map can be"));
                Assert.That(big.Delivered, Is.Zero, "not a byte of it read");
            }
            // The length when it was opened was small and the file has grown since (SimHub writing it, or a swap):
            // no more than that length is taken, and it is said to have changed, whatever is still coming.
            using (var grown = new ClaimedStream(1000, 60L << 20))
            {
                Assert.That(CrowdMaps.ReadPacked(grown, out string why), Is.Null);
                Assert.That(why, Is.EqualTo("the file changed while it was read"));
                Assert.That(grown.Delivered, Is.LessThanOrEqualTo(1001), "the 1000 bytes it had and the one that showed it had more");
            }
            // One that is shorter than it said (it shrank): what there is, which gzip will not take as a map.
            using (var shrunk = new ClaimedStream(1000, 200))
            {
                var bytes = CrowdMaps.ReadPacked(shrunk, out string why);
                Assert.That(bytes, Has.Length.EqualTo(200));
                Assert.That(why, Is.Null);
            }
            // And a file as it is, whole.
            var packed = Shtl(n: 800);
            using (var whole = new MemoryStream(packed))
            {
                Assert.That(CrowdMaps.ReadPacked(whole, out string why), Is.EqualTo(packed));
                Assert.That(why, Is.Null);
            }
            // Through the file the folder holds, too: one that is over the cap is refused with no bytes of it kept.
            string path = Put("big.shtl", new byte[CrowdMaps.MaxPackedBytes + 1]);
            Assert.That(CrowdMaps.Read(path, 778, SyntheticLaps.OfficialMeters, out string whyBig, out _), Is.Null);
            Assert.That(whyBig, Is.EqualTo("2049 KB packed, over the 2048 KB a map can be"));
        }

        [Test]
        public void WhateverAFileDoesTheNextLookIsMadeAndANewLayoutsMapIsStillFound()
        {
            var now = March;
            var log = new List<string>();
            var crowd = new CrowdMaps(_simhub, log.Add, () => now);
            string name = SyntheticFile;
            Put(name, Shtl(n: 800));
            // A read that throws what nobody foresaw: said once, with the kind of exception and no more; the file is
            // not read again until it changes, and the look is not left set.
            crowd.Reader = (string path, int trackId, double official, out string why, out int records) => throw new InvalidOperationException("secret path " + path);
            crowd.Seen(778, "synthetic full", "Full", LengthKm);
            Assert.That(crowd.Current(778), Is.Null);
            Assert.That(log, Is.EqualTo(new[] { $"shared map {name}: not used, could not be read (InvalidOperationException)" }));
            Assert.That(log.Any(l => l.Contains("secret") || l.Contains(_simhub)), Is.False);
            now = now.AddSeconds(30);
            Assert.That(crowd.Current(778), Is.Null);
            Assert.That(crowd.Looks, Is.EqualTo(2), "looked at again");
            Assert.That(log, Has.Count.EqualTo(1), "the same file is not read, or said, again");

            // The next session, with the file read properly: the map is found. Nothing was stuck.
            crowd.Reader = CrowdMaps.Read;
            crowd.Gone();
            crowd.Seen(778, "synthetic full", "Full", LengthKm);
            Assert.That(crowd.Current(778), Is.Not.Null, string.Join(" | ", log));
        }

        [Test]
        public void ACorruptOrOversizedFileIsRefusedOnceAndNotReadAgainUntilItChanges()
        {
            var now = March;
            var log = new List<string>();
            var crowd = new CrowdMaps(_simhub, log.Add, () => now);
            string name = SyntheticFile;

            void Session()
            {
                crowd.Gone();
                crowd.Seen(778, "synthetic full", "Full", LengthKm);
            }
            void LooksFor(TimeSpan span)
            {
                var end = now + span;
                while (now < end) { now = now.AddSeconds(1); crowd.Current(778); }
            }

            // Empty: the download that did not finish.
            Put(name, new byte[0]);
            Session();
            Assert.That(crowd.Current(778), Is.Null);
            Assert.That(log, Is.EqualTo(new[] { $"shared map {name}: not used, the file is empty" }));
            LooksFor(TimeSpan.FromMinutes(3));
            Assert.That(log, Has.Count.EqualTo(1), "the same file is not read, or said, again: " + string.Join(" | ", log));
            Assert.That(crowd.Looks, Is.GreaterThan(10), "though the folder was looked at");

            // Not gzip.
            log.Clear();
            Put(name, Encoding.UTF8.GetBytes("{\"CarCoordinates\":[]}"), March.AddMinutes(-9));
            Session();
            Assert.That(crowd.Current(778), Is.Null);
            Assert.That(log, Is.EqualTo(new[] { $"shared map {name}: not used, not a gzip file" }));

            // Gzip that is broken.
            log.Clear();
            var broken = Shtl();
            for (int i = 40; i < broken.Length - 8; i += 3) broken[i] ^= 0x5a;
            Put(name, broken, March.AddMinutes(-8));
            Session();
            Assert.That(crowd.Current(778), Is.Null);
            Assert.That(log, Has.Count.EqualTo(1));
            // The gzip's checks catch it, or what came out of it is not JSON: either way, not used.
            Assert.That(log[0], Does.StartWith($"shared map {name}: not used, ").And.Match("the gzip is broken|not JSON|not a map"));

            // Too big packed: not even opened.
            log.Clear();
            Put(name, new byte[CrowdMaps.MaxPackedBytes + 1], March.AddMinutes(-7));
            Session();
            Assert.That(crowd.Current(778), Is.Null);
            Assert.That(log, Is.EqualTo(new[] { $"shared map {name}: not used, 2049 KB packed, over the 2048 KB a map can be" }));

            // Too big unpacked: a small gzip of a great deal of nothing, stopped at the cap.
            log.Clear();
            Put(name, Pack(new string(' ', (int)CrowdMaps.MaxUnpackedBytes + 1000)), March.AddMinutes(-6));
            Session();
            Assert.That(crowd.Current(778), Is.Null);
            Assert.That(log, Is.EqualTo(new[] { $"shared map {name}: not used, over 8 MB unpacked" }));

            // Changed into a good one (SimHub downloaded it again): read again, and taken.
            log.Clear();
            Put(name, Shtl(), March.AddMinutes(-5));
            LooksFor(TimeSpan.FromSeconds(40));
            Assert.That(crowd.Current(778), Is.Not.Null, string.Join(" | ", log));
            Assert.That(log, Is.EqualTo(new[] { $"shared map {name}: SimHub's, from 120 drivers' laps, {Bins} points; the map until the first clean lap" }));
            Assert.That(log.Any(l => l.Contains(_simhub)), Is.False, "no path beyond the file's name");

            // A map that fails its checks: said once, with why.
            log.Clear();
            Put(name, Shtl(scale: 1.2), March.AddMinutes(-4));
            Session();
            LooksFor(TimeSpan.FromMinutes(2));
            Assert.That(crowd.Current(778), Is.Null);
            Assert.That(log, Has.Count.EqualTo(1));
            Assert.That(log[0], Does.StartWith($"shared map {name}: not used, ").And.Contain("m round, where the session says"));
        }

        // ── The looking ──

        [Test]
        public void OnlyTheFileWithTheSessionsExactNameIsTakenNeverANearOneAndNeverAnOldScansUnderALikeName()
        {
            // Two layouts with names like each other, and a map of each (the synthetic circuit stretched to each one's
            // length): Laguna Seca as it was, and the 2026 rescan. Each has fewer points than an outline of his own has
            // (a thousand), so they are served as they are and told apart by how many.
            Put("lagunaseca-3565.2.shtl", Shtl(n: 900, scale: 3565.2 / SyntheticLaps.CircuitLength()));
            Put("lagunaseca 2026-3555.8.shtl", Shtl(n: 800, scale: 3555.8 / SyntheticLaps.CircuitLength()));
            var now = March;
            var crowd = new CrowdMaps(_simhub, null, () => now);
            TrackOutline For(int trackId, string trackName, string config, string length)
            {
                crowd.Gone();
                crowd.Seen(trackId, trackName, config, length);
                return crowd.Current(trackId);
            }
            double official = IbtIngest.ParseMeters("3.5558 km");
            Assert.That(official, Is.EqualTo(3555.8).Within(1e-6));

            // The sessions' own names take their own files, told apart by their points.
            Assert.That(For(99, "lagunaseca 2026", "", "3.5558 km")?.Points.Count, Is.EqualTo(800));
            Assert.That(For(98, "lagunaseca", "", "3.5652 km")?.Points.Count, Is.EqualTo(900));
            Assert.That(crowd.FileName, Is.EqualTo("lagunaseca-3565.2.shtl"));
            // A rescan with the same name and another length, a near name, another configuration: nothing.
            Assert.That(For(97, "lagunaseca 2026", "", "3.5652 km"), Is.Null, "a rescanned layout never takes an old scan's map");
            Assert.That(For(96, "lagunaseca", "", "3.5558 km"), Is.Null, "the old name with the new length is neither");
            Assert.That(For(95, "lagunaseca 20", "", "3.5558 km"), Is.Null, "not a prefix");
            Assert.That(For(94, "lagunaseca 2026", "Full", "3.5558 km"), Is.Null, "a configuration the file does not name");
            Assert.That(For(93, "Lagunaseca 2026", "", "3.5558 km"), Is.Null, "Windows would find the file whatever its case; this does not");
            Assert.That(For(92, "lagunaseca2026", "", "3.5558 km"), Is.Null, "spaces are not stripped");
            Assert.That(For(91, "lagunaseca 2026", "", "3.5559 km"), Is.Null, "the length is to the decimetre");
            // The layout asked for is the one being driven, and no other.
            crowd.Gone();
            crowd.Seen(99, "lagunaseca 2026", "", "3.5558 km");
            Assert.That(crowd.Current(98), Is.Null);
            Assert.That(crowd.Current(99), Is.Not.Null);
            Assert.That(crowd.Current(99).TrackId, Is.EqualTo(99));
        }

        [Test]
        public void AFileNotThereYetIsLookedForEveryFiveSecondsForAMinuteThenEveryHalfMinuteAndTakenWhenItComes()
        {
            var now = March;
            var log = new List<string>();
            var crowd = new CrowdMaps(_simhub, log.Add, () => now);
            crowd.Seen(778, "synthetic full", "Full", LengthKm);
            Assert.That(crowd.FileName, Is.EqualTo(SyntheticFile));

            // The sim connects; SimHub has not downloaded the map yet.
            Assert.That(crowd.Current(778), Is.Null);
            Assert.That(crowd.Looks, Is.EqualTo(1));
            now = now.AddSeconds(2);
            crowd.Current(778);
            Assert.That(crowd.Looks, Is.EqualTo(1), "not looked for again within five seconds");
            now = now.AddSeconds(3);
            crowd.Current(778);
            Assert.That(crowd.Looks, Is.EqualTo(2));
            // Every five seconds through the first minute: twelve looks in it.
            for (int s = 0; s < 55; s++) { now = now.AddSeconds(1); crowd.Current(778); }
            Assert.That(crowd.Looks, Is.EqualTo(13), "at 0, 5, 10 … 60 s");
            // Then every thirty: at 90 s and 120 s, not between.
            for (int s = 0; s < 29; s++) { now = now.AddSeconds(1); crowd.Current(778); }
            Assert.That(crowd.Looks, Is.EqualTo(13));
            now = now.AddSeconds(1);
            crowd.Current(778);
            Assert.That(crowd.Looks, Is.EqualTo(14), "at 90 s");
            Assert.That(log, Is.Empty, "a file that is not there is nothing to say");

            // SimHub's download lands: the next look takes it, and after that the folder is left alone.
            Put(SyntheticFile, Shtl(n: 1800));
            Assert.That(crowd.Current(778), Is.Null, "not until the next look is due");
            now = now.AddSeconds(30);
            var outline = crowd.Current(778);
            Assert.That(outline, Is.Not.Null);
            Assert.That((outline.TrackId, outline.Crowd, outline.Points.Count), Is.EqualTo((778, true, Bins)));
            Assert.That(crowd.Looks, Is.EqualTo(15));
            now = now.AddMinutes(10);
            Assert.That(crowd.Current(778), Is.SameAs(outline));
            Assert.That(crowd.Looks, Is.EqualTo(15), "kept in memory for the session");
            Assert.That(log, Is.EqualTo(new[] { $"shared map {SyntheticFile}: SimHub's, from 120 drivers' laps, {Bins} points; the map until the first clean lap" }));

            // The sim gone, and back at the same layout: the folder is read again, not remembered.
            crowd.Gone();
            Assert.That(crowd.Current(778), Is.Null);
            crowd.Seen(778, "synthetic full", "Full", LengthKm);
            Assert.That(crowd.Current(778), Is.Not.Null.And.Not.SameAs(outline));
            Assert.That(crowd.Looks, Is.EqualTo(16));
        }

        // ── Where it stands among his own ──

        private sealed class FakeSource : IOutlineSource
        {
            public Func<int, TrackOutline> Answer;
            public int Asked;
            public TrackOutline Get(int trackId) { Interlocked.Increment(ref Asked); return Answer?.Invoke(trackId); }
        }

        private static void Settle(TrackMapProvider map, FakeSource source, int asked)
        {
            for (int i = 0; i < 1000; i++)
            {
                map.Update(0.1, new float[0], new bool[0], 0, 1);
                if (Volatile.Read(ref source.Asked) >= asked && !map.Asking) break;
                Thread.Sleep(10);
            }
            map.Update(0.1, new float[0], new bool[0], 0, 1);
        }

        [Test]
        public void HisOwnOutlineReplacesTheSharedMapWithinTheSessionAndIsNeverReplacedByIt()
        {
            // The session's file, the sim writing it; the shared map of the same layout already in SimHub's folder.
            var frames = SyntheticLaps.Laps(2);
            byte[] whole = SyntheticLaps.Bytes(SyntheticLaps.Yaml(), frames, March, claimedFrames: 0);
            int framesOffset = whole.Length - frames.Count * SyntheticLaps.FrameSize;
            int perLap = frames.Count / 2;
            string telemetry = Path.Combine(_dir, "telemetry");
            Directory.CreateDirectory(telemetry);
            string path = Path.Combine(telemetry, "mx5 mx52016_synthetic full 2026-03-01 09-00-00.ibt");
            Put(SyntheticFile, Shtl(n: 1600));
            var before = Folder();

            var now = March;
            var log = new List<string>();
            using var follower = new IbtFollower(telemetry, Db, log.Add, () => now);
            var crowd = new CrowdMaps(_simhub, log.Add, () => now);
            var outlines = new TrackOutlines(Db, () => now) { Live = follower.Current, Crowd = crowd.Current };
            follower.Outlined += outline => outlines.Forget(outline.TrackId);

            var clock = March;
            var source = new FakeSource { Answer = outlines.ForTrack };
            var map = new TrackMapProvider { Outlines = source, Clock = () => clock };
            map.OnTrackChanged(777, "synthetic full");

            using (var writing = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.ReadWrite))
            {
                void Written(int frameCount)
                {
                    long have = writing.Position, want = framesOffset + (long)frameCount * SyntheticLaps.FrameSize;
                    writing.Write(whole, (int)have, (int)(want - have));
                    writing.Flush();
                    File.SetLastWriteTimeUtc(path, now);
                }

                // Half a lap in: nothing of his own, so the outlines serve the shared map, and the map draws it, says so,
                // and asks again in five seconds, not sixty.
                Written(perLap / 2);
                follower.Seen(777);
                crowd.Seen(777, "synthetic full", "Full", LengthKm);
                follower.Look();
                var served = outlines.ForTrack(777);
                Assert.That(served, Is.Not.Null);
                Assert.That((served.Crowd, served.CleanLaps, served.Points.Count), Is.EqualTo((true, 0, Bins)));
                Settle(map, source, 1);
                Assert.That(map.IsReady, Is.True, map.Trace);
                Assert.That(map.Status, Is.EqualTo(TrackMapProvider.StatusCrowd));
                Assert.That(map.Outline.Crowd, Is.True);
                Assert.That(map.SvgPath, Does.StartWith("M ").And.EndWith(" Z"));
                clock = clock.AddSeconds(4);
                map.Update(0.1, new float[0], new bool[0], 0, 1);
                Assert.That(source.Asked, Is.EqualTo(1));
                clock = clock.AddSeconds(2);
                Settle(map, source, 2);
                Assert.That(source.Asked, Is.EqualTo(2), "asked again within six seconds with the shared map up");
                Assert.That(map.Status, Is.EqualTo(TrackMapProvider.StatusCrowd), "and the same shared map stays");

                // His first clean lap closes: the follower's outline is what the outlines serve now, and within the next
                // ask the map is his own.
                now = now.AddSeconds(45);
                Written(perLap + 300);
                follower.Seen(777);
                follower.Look();
                Assert.That(follower.Current(777), Is.Not.Null, follower.Trace);
                served = outlines.ForTrack(777);
                Assert.That((served.Crowd, served.CleanLaps, served.Provisional), Is.EqualTo((false, 1, true)));
                clock = clock.AddSeconds(6);
                Settle(map, source, 3);
                Assert.That(map.Status, Is.EqualTo(TrackMapProvider.StatusReady));
                Assert.That((map.Outline.Crowd, map.Outline.CleanLaps), Is.EqualTo((false, 1)));

                // The shared map offered again (a slow answer from before, say) is not taken over his own.
                map.Apply(crowd.Current(777), TrackMapProvider.StatusCrowd);
                Assert.That(map.Status, Is.EqualTo(TrackMapProvider.StatusReady));
                Assert.That(map.Outline.Crowd, Is.False);
                // And with his own up the map asks again in a minute, as it always did.
                clock = clock.AddSeconds(30);
                map.Update(0.1, new float[0], new bool[0], 0, 1);
                Assert.That(source.Asked, Is.EqualTo(3));
            }

            // The store has his outline, provisional; the shared map was never written to it, nor anywhere.
            SqliteConnection.ClearAllPools();
            using (var store = RacingDeskStore.OpenReadOnly(Db))
            {
                var kept = store.GetGeometry(777);
                Assert.That((kept.CleanLaps, kept.Provisional), Is.EqualTo((1, true)));
                Assert.That(kept.SourceIbt, Is.EqualTo(path));
                Assert.That(store.Scalar<long>("SELECT COUNT(*) FROM track_geometry"), Is.EqualTo(1));
            }
            Assert.That(Folder(), Is.EqualTo(before), "SimHub's folder is as it was: nothing written, nothing touched");
            Assert.That(new DirectoryInfo(_dir).GetFiles().Select(f => f.Name), Is.EquivalentTo(new[] { "racing-desk.db" }).Or.EquivalentTo(new[] { "racing-desk.db", "racing-desk.db-wal", "racing-desk.db-shm" }));
            Assert.That(log.Any(l => l.Contains("900001") || l.Contains("Test Driver") || l.Contains(_simhub)), Is.False, "no id, no name, no path in the log");

            // A layout the store has a whole outline for is served the store's, whatever SimHub has.
            string finished = SyntheticLaps.Write(Path.Combine(_dir, "finished.ibt"), SyntheticLaps.Yaml(trackId: 779), SyntheticLaps.Laps(2), March);
            using (var store = new RacingDeskStore(Db)) store.MergeGeometry(IbtIngest.IngestGeometryOnly(finished, 779));
            SqliteConnection.ClearAllPools();
            crowd.Gone();
            crowd.Seen(779, "synthetic full", "Full", LengthKm);
            Assert.That(crowd.Current(779), Is.Not.Null, "SimHub has a map of it");
            var stored = outlines.ForTrack(779);
            Assert.That((stored.Crowd, stored.CleanLaps, stored.Provisional), Is.EqualTo((false, 2, false)));
        }

        [Test]
        public void TheSharedMapIsServedToThePluginMarkedCrowdAndNothingIsWrittenForIt()
        {
            Put(SyntheticFile, Shtl(n: 1400, records: 77));
            var before = Folder();
            var now = March;
            var crowd = new CrowdMaps(_simhub, null, () => now);
            crowd.Seen(778, "synthetic full", "Full", LengthKm);
            var outlines = new TrackOutlines(Db, () => now) { Crowd = crowd.Current };
            var api = new LocalDataApi(Db) { Outlines = outlines };

            int port = FreePort();
            using var listener = new HttpListener();
            listener.Prefixes.Add($"http://127.0.0.1:{port}/racing-desk/");
            listener.Start();
            var serving = Task.Run(() => { while (listener.IsListening) { try { api.TryHandle(listener.GetContext()); } catch { break; } } });
            try
            {
                using var http = new HttpClient();
                using var response = http.GetAsync($"http://127.0.0.1:{port}/racing-desk/data/outline?track=778").Result;
                Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK));
                string body = response.Content.ReadAsStringAsync().Result;
                using var json = JsonDocument.Parse(body);
                var root = json.RootElement;
                Assert.That(root.GetProperty("crowd").GetBoolean(), Is.True);
                Assert.That(root.GetProperty("provisional").GetBoolean(), Is.True);
                Assert.That(root.GetProperty("cleanLaps").GetInt32(), Is.Zero);
                Assert.That(root.GetProperty("trackId").GetInt32(), Is.EqualTo(778));
                Assert.That(root.GetProperty("officialLengthM").GetDouble(), Is.EqualTo(SyntheticLaps.OfficialMeters));
                Assert.That(root.GetProperty("points").GetArrayLength(), Is.EqualTo(Bins));
                Assert.That(body, Does.Not.Contain(".shtl").And.Not.Contain("MapRecords"));

                // The plugin's source reads it as it reads his own, with the mark.
                using var source = new HostOutlineSource($"http://127.0.0.1:{port}");
                var outline = source.Get(778);
                Assert.That((outline.TrackId, outline.Crowd, outline.CleanLaps, outline.Points.Count), Is.EqualTo((778, true, 0, Bins)));
                Assert.That(source.Get(777), Is.Null, "another layout: 404");
                // And an outline of his own comes without the mark.
                Assert.That(HostOutlineSource.Parse("{\"trackId\":1,\"cleanLaps\":2,\"points\":[[0,0,0],[1,1,0.1],[2,2,0.2],[3,3,0.3],[4,4,0.4],[5,5,0.5],[6,6,0.6],[7,7,0.7],[8,8,0.8],[9,9,0.9]]}").Crowd, Is.False);
            }
            finally
            {
                listener.Stop();
                serving.Wait(TimeSpan.FromSeconds(5));
            }
            Assert.That(File.Exists(Db), Is.False, "no store was made for it");
            Assert.That(Folder(), Is.EqualTo(before));
            Assert.That(new DirectoryInfo(_dir).GetFiles(), Is.Empty);
        }

        private static int FreePort()
        {
            var l = new TcpListener(IPAddress.Loopback, 0);
            l.Start();
            int port = ((IPEndPoint)l.LocalEndpoint).Port;
            l.Stop();
            return port;
        }
    }
}
