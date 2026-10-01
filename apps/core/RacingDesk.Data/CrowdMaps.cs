using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text.Json;
using RacingDesk.Plugin.Engine;

namespace RacingDesk.Data
{
    /// <summary>
    /// SimHub's shared map of the layout being driven: the interim outline, until his first clean lap gives one of
    /// his own. SimHub downloads a crowd-sourced map of the layout a second after the sim connects, into
    /// <c>Program Files (x86)\SimHub\PluginsData\IRacing\MapRecordsCloud\</c>. This reads that one file, read-only,
    /// keeps what it parsed in memory for the session, and writes nothing anywhere — not the store, not a cache, not
    /// a file, nothing in SimHub's folder. The host's own outline (the follower's, or the store's) is always taken
    /// before it (<see cref="TrackOutlines"/>), so the moment his first clean lap closes the shared map is gone.
    ///
    /// He asked for this on 2026-09-30 ("Simhub using crowd maps yes").
    ///
    /// <para><b>The file</b> (one of them read on 2026-10-01, and the eighty on this machine surveyed; nothing
    /// here is documented by SimHub):</para>
    /// <list type="bullet">
    ///   <item>Its name is SimHub's track id for the layout, which is the session YAML's <c>WeekendInfo</c> as it
    ///   is: <c>TrackName</c>, then <c>TrackConfigName</c> when it is not empty, then <c>TrackLength</c> in metres,
    ///   joined with '-', and ".shtl". "algarve gp-Grand Prix-4578.9.shtl" for TrackName "algarve gp",
    ///   TrackConfigName "Grand Prix", TrackLength "4.5789 km"; "bathurst-6144.1.shtl" for a layout with no
    ///   configuration name; "crandon full-Crandon Off-Road Full-2360.shtl" for "2.3600 km" (a whole number of
    ///   metres has no ".0"). The names are the YAML's to the letter, the two spaces of "Historic Circa  95"
    ///   included (they are iRacing's own). The eighty files' names were every one made again from his .ibt files'
    ///   YAML by that rule and no other, so that rule is all that is normalised, and nothing is matched loosely:
    ///   "lagunaseca 2026-3555.8.shtl" is not "lagunaseca-3565.2.shtl", and a rescanned layout under a name like an
    ///   old one takes no old map.</item>
    ///   <item>It is gzip (1f 8b) of one JSON object, 10 to 290 KB packed and 50 KB to 1.2 MB unpacked: a SimHub
    ///   lap record with most of its fields empty (TrackName, CarModel, LapTime, the sector times: null or 0),
    ///   <c>Version</c> 6, <c>SourceRecordsUsedCount</c> and <c>SourceRecordsAvailableCount</c> (how many
    ///   drivers' laps went into it: 120 at Algarve), <c>HasRelativeCarCoordinates</c> true, and
    ///   <c>CarCoordinates</c>: an array of <c>{ Key: "00:38:09", Value: [x, y, z], CurrentSector: 3, p: 0.9995 }</c>.
    ///   <c>Key</c> is the point's index written as a time (one "second" to a point); <c>Value</c> is metres with the
    ///   start/finish line at the origin, x east, y up (the altitude), z south; <c>p</c> is LapDistPct. About one
    ///   point every two metres (548 for a 1.1 km rallycross, 12,800 for the 25.7 km Nordschleife combined), in
    ///   order of p from 0 to 1; the first is always [0, altitude, 0] at p 0, and the last [0, 0, 0] (to 3 cm) at
    ///   p 1, a filler, which is dropped. One file on this machine is empty (0 bytes: a download that did not
    ///   finish), which is refused once and left alone until it changes.</item>
    ///   <item>Against his own GPS lap at Algarve the map fits at scale 1.0009, rotated 0.2°, with x east and z
    ///   south (the fit needed z reflected against north; RMS 5.7 m, worst point 23.8 m): the frame an outline of
    ///   his own is in (<see cref="TrackOutline"/>: X east, Z south, north-up on the screen, pct 0 at the line), so
    ///   it is served as one is. Its polyline is within 1 % of the length in its name on every file here (the worst,
    ///   a rallycross, 0.95 % short) and closes to within 5 m on all but two off-road layouts (39 m at Crandon).</item>
    /// </list>
    /// </summary>
    public sealed class CrowdMaps
    {
        /// <summary>Where SimHub keeps the maps it downloads.</summary>
        public static string DefaultDirectory => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "SimHub", "PluginsData", "IRacing", "MapRecordsCloud");

        /// <summary>For the first minute of a session the file is looked for this often: SimHub may still be downloading it.</summary>
        public static readonly TimeSpan LookOften = TimeSpan.FromSeconds(5);
        public static readonly TimeSpan LookOftenFor = TimeSpan.FromMinutes(1);
        /// <summary>After the first minute, this often.</summary>
        public static readonly TimeSpan LookSeldom = TimeSpan.FromSeconds(30);

        /// <summary>A file bigger than this packed is not read (the biggest here is 290 KB).</summary>
        public const long MaxPackedBytes = 2L << 20;
        /// <summary>Unpacking stops, and the file is refused, past this (the biggest here is 1.2 MB).</summary>
        public const long MaxUnpackedBytes = 8L << 20;
        public const int MinPoints = 100;
        /// <summary>The widest hole, as a fraction of the lap, between one point and the next (the files have 0.002 at most).</summary>
        public const double MaxGapPct = 0.02;
        /// <summary>The longest step between one point and the next (the files have 7 m at most).</summary>
        public const double MaxStepMeters = 50;
        /// <summary>How far the last point may be from the first (the files have 39 m at most, 5 m but for two).</summary>
        public const double MaxCloseMeters = 50;
        /// <summary>How far the polyline's length may be from the session's TrackLength (the files are within 1 %).</summary>
        public const double MaxLengthFraction = 0.05;

        private readonly string _directory;
        private readonly Action<string> _log;
        private readonly Func<DateTime> _now;
        private readonly object _gate = new object();

        // The layout being driven, as the telemetry thread last said it.
        private int _trackId;
        private string _trackName, _trackConfigName, _trackLength;
        private string _fileName;
        private double _officialMeters;
        private DateTime _since;
        private DateTime _due;
        private TrackOutline _current;
        private bool _looking;                             // a look is under way, outside the lock: one at a time
        private (long Length, DateTime Written)? _tried;   // the file as it was when last read: an unchanged one is not read again
        private string _said;                              // what was last said of this layout's file, said once

        /// <param name="directory">SimHub's folder, or a test's.</param>
        public CrowdMaps(string directory, Action<string> log = null, Func<DateTime> now = null)
        {
            _directory = directory;
            _log = log ?? (_ => { });
            _now = now ?? (() => DateTime.UtcNow);
        }

        /// <summary>How many times the folder has been looked at, for a test.</summary>
        public int Looks { get; private set; }

        /// <summary>The file the layout being driven would be in, or null while no layout is; for a test and the log.</summary>
        public string FileName { get { lock (_gate) return _fileName; } }

        /// <summary>
        /// The telemetry thread, each frame: the layout the sim says, with the three names SimHub names its file by
        /// (the session YAML's TrackName, TrackConfigName and TrackLength). Cheap while nothing changes.
        /// </summary>
        public void Seen(int trackId, string trackName, string trackConfigName, string trackLength)
        {
            if (trackId <= 0) return;
            lock (_gate)
            {
                if (trackId == _trackId && string.Equals(trackName, _trackName, StringComparison.Ordinal)
                    && string.Equals(trackConfigName, _trackConfigName, StringComparison.Ordinal)
                    && string.Equals(trackLength, _trackLength, StringComparison.Ordinal))
                    return;
                _trackId = trackId;
                _trackName = trackName;
                _trackConfigName = trackConfigName;
                _trackLength = trackLength;
                _fileName = FileNameFor(trackName, trackConfigName, trackLength);
                _officialMeters = IbtIngest.ParseMeters(trackLength);
                _since = _due = _now();
                _current = null;
                _tried = null;
                _said = null;
            }
        }

        /// <summary>The sim has gone: the session is over, and with it the map. The next session reads the folder again.</summary>
        public void Gone()
        {
            lock (_gate)
            {
                _trackId = 0;
                _trackName = _trackConfigName = _trackLength = null;
                _fileName = null;
                _current = null;
                _tried = null;
                _said = null;
            }
        }

        /// <summary>
        /// The shared map of a layout, for <see cref="TrackOutlines.Crowd"/>: the one read this session, or the
        /// folder looked at when a look is due. Null for any other layout, and while there is nothing. The folder
        /// and the file are read outside the lock, one look at a time, so the telemetry thread's <see cref="Seen"/>
        /// never waits on a file; what the look found is kept only if the layout is still the one it was for.
        /// </summary>
        public TrackOutline Current(int trackId)
        {
            string fileName;
            int wanted;
            double official;
            (long, DateTime)? tried;
            lock (_gate)
            {
                if (trackId <= 0 || trackId != _trackId) return null;
                if (_current != null) return _current;
                if (_fileName == null || _looking) return null;
                var now = _now();
                if (now < _due) return null;
                Looks++;
                _due = now + (now - _since < LookOftenFor ? LookOften : LookSeldom);
                _looking = true;
                fileName = _fileName;
                wanted = _trackId;
                official = _officialMeters;
                tried = _tried;
            }
            var look = Look(fileName, wanted, official, tried);
            lock (_gate)
            {
                _looking = false;
                if (wanted != _trackId || fileName != _fileName) return null;   // another session by now: nothing of this look is kept
                if (look.Stamp != null) _tried = look.Stamp;
                if (look.Said != null) Say(look.Said);
                if (look.Outline != null) _current = look.Outline;
                return _current;
            }
        }

        /// <summary>
        /// SimHub's name for a layout's file: the YAML's TrackName, the TrackConfigName when there is one, and the
        /// TrackLength in metres with no trailing nought, joined with '-'. Null when the session gives no name.
        /// </summary>
        public static string FileNameFor(string trackName, string trackConfigName, string trackLength)
        {
            if (string.IsNullOrEmpty(trackName)) return null;
            double meters = IbtIngest.ParseMeters(trackLength);
            if (meters <= 0) return null;
            string length = Math.Round(meters, 2).ToString("0.##", CultureInfo.InvariantCulture);
            return string.IsNullOrEmpty(trackConfigName)
                ? trackName + "-" + length + ".shtl"
                : trackName + "-" + trackConfigName + "-" + length + ".shtl";
        }

        /// <summary>One look at the folder, outside the lock: what was found, the file's stamp if it was read, and what to say.</summary>
        private (TrackOutline Outline, (long, DateTime)? Stamp, string Said) Look(string fileName, int trackId, double officialMeters, (long, DateTime)? tried)
        {
            FileInfo file;
            try
            {
                var folder = new DirectoryInfo(_directory);
                if (!folder.Exists) return (null, null, null);
                // The file with the name, to the letter: Windows would find it whatever its case, and this does not.
                file = folder.EnumerateFiles(fileName).FirstOrDefault(f => string.Equals(f.Name, fileName, StringComparison.Ordinal));
                if (file == null) return (null, null, null);
            }
            catch (Exception ex)
            {
                // A name Windows will not have as a file's: there is no file to find.
                return (null, null, $"shared map {fileName}: not looked for ({ex.GetType().Name})");
            }
            var stamp = (file.Length, file.LastWriteTimeUtc);
            if (tried != null && tried.Value == stamp) return (null, null, null);   // the same file as was refused: not read again
            var outline = Read(file.FullName, trackId, officialMeters, out string why, out int records);
            if (outline == null) return (null, stamp, $"shared map {fileName}: not used, {why}");
            return (outline, stamp, $"shared map {fileName}: SimHub's, from {records} drivers' laps, {outline.Points.Count} points; the map until the first clean lap");
        }

        private void Say(string what)
        {
            if (what == _said) return;
            _said = what;
            _log(what);
        }

        /// <summary>
        /// Reads one of SimHub's files as an outline: read-only, the packed and unpacked sizes capped, the points
        /// checked. Null, and <paramref name="why"/> says why, for a file that is not to be used.
        /// </summary>
        public static TrackOutline Read(string path, int trackId, double officialLengthMeters, out string why, out int records)
        {
            records = 0;
            byte[] packed;
            DateTime written;
            try
            {
                var info = new FileInfo(path);
                if (info.Length > MaxPackedBytes)
                {
                    why = $"{(info.Length + 1023) / 1024} KB packed, over the {MaxPackedBytes / 1024} KB a map can be";
                    return null;
                }
                written = info.LastWriteTimeUtc;
                using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 1 << 16, FileOptions.SequentialScan);
                packed = new byte[stream.Length];
                int read = 0, n;
                while (read < packed.Length && (n = stream.Read(packed, read, packed.Length - read)) > 0) read += n;
                if (read < packed.Length) Array.Resize(ref packed, read);
            }
            catch (Exception ex)
            {
                why = "not readable (" + ex.GetType().Name + ")";
                return null;
            }
            string json = Unpack(packed, out why);
            if (json == null) return null;
            return Parse(json, trackId, officialLengthMeters, written, out why, out records);
        }

        /// <summary>The JSON out of a .shtl's gzip, or null (and why) when it is not gzip, is broken, or unpacks past the cap.</summary>
        public static string Unpack(byte[] packed, out string why)
        {
            if (packed == null || packed.Length < 18 || packed[0] != 0x1f || packed[1] != 0x8b)
            {
                why = packed == null || packed.Length == 0 ? "the file is empty" : "not a gzip file";
                return null;
            }
            try
            {
                using var gz = new GZipStream(new MemoryStream(packed, writable: false), CompressionMode.Decompress);
                using var unpacked = new MemoryStream();
                var buffer = new byte[64 << 10];
                long total = 0;
                int n;
                while ((n = gz.Read(buffer, 0, buffer.Length)) > 0)
                {
                    total += n;
                    if (total > MaxUnpackedBytes)
                    {
                        why = $"over {MaxUnpackedBytes >> 20} MB unpacked";
                        return null;
                    }
                    unpacked.Write(buffer, 0, n);
                }
                why = null;
                return System.Text.Encoding.UTF8.GetString(unpacked.GetBuffer(), 0, (int)unpacked.Length);
            }
            catch (Exception ex)
            {
                why = "the gzip is broken (" + ex.GetType().Name + ")";
                return null;
            }
        }

        /// <summary>
        /// The JSON as an outline, checked: every point has p in 0..1 and finite metres; there are enough of them;
        /// sorted by p they run from the line (p ≤ 0.01) back to it (p ≥ 0.99) with no hole wider than
        /// <see cref="MaxGapPct"/>; no step between points is longer than <see cref="MaxStepMeters"/>; the loop closes
        /// within <see cref="MaxCloseMeters"/>; and the polyline is within <see cref="MaxLengthFraction"/> of the
        /// session's TrackLength when one is given. The filler at p 1 is dropped, and the first point is made the
        /// origin. Null, and why, when any of that fails.
        /// </summary>
        public static TrackOutline Parse(string json, int trackId, double officialLengthMeters, DateTime writtenUtc, out string why, out int records)
        {
            records = 0;
            var raw = new List<(double X, double Z, double Pct)>();
            try
            {
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;
                if (root.ValueKind != JsonValueKind.Object) { why = "not a map (no object in it)"; return null; }
                if (root.TryGetProperty("SourceRecordsUsedCount", out var used) && used.ValueKind == JsonValueKind.Number && used.TryGetInt32(out int n)) records = n;
                if (!root.TryGetProperty("CarCoordinates", out var coords) || coords.ValueKind != JsonValueKind.Array) { why = "no CarCoordinates in it"; return null; }
                raw.Capacity = coords.GetArrayLength();
                foreach (var point in coords.EnumerateArray())
                {
                    if (point.ValueKind != JsonValueKind.Object
                        || !point.TryGetProperty("p", out var pe) || pe.ValueKind != JsonValueKind.Number
                        || !point.TryGetProperty("Value", out var value) || value.ValueKind != JsonValueKind.Array || value.GetArrayLength() < 3
                        || value[0].ValueKind != JsonValueKind.Number || value[2].ValueKind != JsonValueKind.Number)
                    {
                        why = "a point without p or Value [x, y, z]";
                        return null;
                    }
                    double p = pe.GetDouble(), x = value[0].GetDouble(), z = value[2].GetDouble();
                    if (!double.IsFinite(p) || !double.IsFinite(x) || !double.IsFinite(z)) { why = "a point that is not a number"; return null; }
                    if (p < 0 || p > 1) { why = $"a point at p {p.ToString("0.###", CultureInfo.InvariantCulture)}, outside 0 to 1"; return null; }
                    raw.Add((x, z, p));
                }
            }
            catch (JsonException)
            {
                why = "not JSON";
                return null;
            }

            // In order of p, the filler at p 1 and any second point at the same p dropped.
            var points = new List<(double X, double Z, double Pct)>(raw.Count);
            foreach (var q in raw.OrderBy(r => r.Pct))
            {
                if (q.Pct >= 1) continue;
                if (points.Count > 0 && points[points.Count - 1].Pct == q.Pct) continue;
                points.Add(q);
            }
            if (points.Count < MinPoints) { why = $"{points.Count} points, fewer than the {MinPoints} a map has"; return null; }
            if (points[0].Pct > 0.01) { why = $"does not start at the line (its first point is at p {points[0].Pct.ToString("0.###", CultureInfo.InvariantCulture)})"; return null; }
            if (points[points.Count - 1].Pct < 0.99) { why = $"does not reach the line (its last point is at p {points[points.Count - 1].Pct.ToString("0.###", CultureInfo.InvariantCulture)})"; return null; }

            double x0 = points[0].X, z0 = points[0].Z;
            double length = 0, maxGap = 0, maxStep = 0;
            for (int i = 0; i < points.Count; i++)
            {
                points[i] = (points[i].X - x0, points[i].Z - z0, points[i].Pct);
                if (i == 0) continue;
                double gap = points[i].Pct - points[i - 1].Pct;
                double step = Dist(points[i], points[i - 1]);
                if (gap > maxGap) maxGap = gap;
                if (step > maxStep) maxStep = step;
                length += step;
            }
            double close = Dist(points[points.Count - 1], points[0]);
            length += close;
            if (maxGap > MaxGapPct) { why = $"a hole of {(maxGap * 100).ToString("0.#", CultureInfo.InvariantCulture)} % of the lap between two points"; return null; }
            if (maxStep > MaxStepMeters) { why = $"a jump of {maxStep.ToString("0", CultureInfo.InvariantCulture)} m between two points"; return null; }
            if (close > MaxCloseMeters) { why = $"does not close ({close.ToString("0", CultureInfo.InvariantCulture)} m between its ends)"; return null; }
            if (officialLengthMeters > 0 && Math.Abs(length - officialLengthMeters) / officialLengthMeters > MaxLengthFraction)
            {
                why = $"{length.ToString("0", CultureInfo.InvariantCulture)} m round, where the session says {officialLengthMeters.ToString("0", CultureInfo.InvariantCulture)} m";
                return null;
            }

            why = null;
            return new TrackOutline
            {
                TrackId = trackId,
                CleanLaps = 0,
                LengthMeters = length,
                OfficialLengthMeters = officialLengthMeters,
                Provisional = true,
                Crowd = true,
                UpdatedAtUtc = writtenUtc,
                Points = points.ToArray(),
            };
        }

        private static double Dist((double X, double Z, double Pct) a, (double X, double Z, double Pct) b) =>
            Math.Sqrt((a.X - b.X) * (a.X - b.X) + (a.Z - b.Z) * (a.Z - b.Z));
    }
}
