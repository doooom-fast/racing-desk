using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using RaceCorProDrive.Plugin.IRacing;

namespace RaceCor.Data
{
    public sealed class IngestSummary
    {
        public int FilesSeen, FilesIngested, FilesSkipped, FilesFailed, Sessions, Laps, GeometryUpdates;
        public long BytesRead;
        public TimeSpan Elapsed;
    }

    /// <summary>
    /// Backfills the store from .ibt history. Idempotent: a file is re-read only if its size or mtime changed.
    /// </summary>
    public sealed class IbtIngest
    {
        private readonly ProDriveStore _store;
        private readonly Action<string> _log;

        public IbtIngest(ProDriveStore store, Action<string> log = null)
        {
            _store = store;
            _log = log ?? (_ => { });
        }

        public static string DefaultTelemetryDirectory =>
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "iRacing", "telemetry");

        /// <param name="frameStep">Read every Nth frame (3 = 20 Hz; enough for laps, incidents and geometry).</param>
        public IngestSummary Run(string directory, int frameStep = 3, int limit = int.MaxValue, CancellationToken ct = default)
        {
            var summary = new IngestSummary();
            var clock = Stopwatch.StartNew();
            var files = Directory.Exists(directory)
                ? new DirectoryInfo(directory).EnumerateFiles("*.ibt").OrderBy(f => f.LastWriteTimeUtc).ToList()
                : new List<FileInfo>();

            foreach (var f in files)
            {
                if (ct.IsCancellationRequested || summary.FilesIngested >= limit) break;
                summary.FilesSeen++;
                // A file still being written by iRacing changes size; leave it for the next run.
                if (DateTime.UtcNow - f.LastWriteTimeUtc < TimeSpan.FromMinutes(2) || _store.IsIngested(f.FullName, f.Length, f.LastWriteTimeUtc))
                {
                    summary.FilesSkipped++;
                    continue;
                }

                try
                {
                    var result = IngestFile(f.FullName, frameStep, ct);
                    if (ct.IsCancellationRequested) break;
                    _store.SaveIngestedFile(f.FullName, f.Length, f.LastWriteTimeUtc, result.Sessions, null);
                    if (_store.SaveGeometryIfBetter(result.Geometry)) summary.GeometryUpdates++;
                    summary.FilesIngested++;
                    summary.Sessions += result.Sessions.Count;
                    summary.Laps += result.Sessions.Sum(s => s.Laps.Count);
                    summary.BytesRead += f.Length;
                }
                catch (Exception ex) when (ex is IOException || ex is InvalidDataException || ex is YamlDotNet.Core.YamlException || ex is ArgumentException)
                {
                    summary.FilesFailed++;
                    _log($"skip {f.Name}: {ex.GetType().Name}: {ex.Message}");
                    _store.SaveIngestedFile(f.FullName, f.Length, f.LastWriteTimeUtc, Array.Empty<SessionRecord>(), ex.GetType().Name + ": " + ex.Message);
                }

                if ((summary.FilesIngested + summary.FilesFailed) % 100 == 0 && summary.FilesIngested > 0)
                    _log($"{summary.FilesIngested + summary.FilesFailed} files, {summary.Sessions} sessions, {summary.BytesRead / 1e9:F1} GB, {clock.Elapsed.TotalSeconds:F0}s");
            }

            summary.Elapsed = clock.Elapsed;
            return summary;
        }

        public sealed class FileResult
        {
            public List<SessionRecord> Sessions { get; } = new List<SessionRecord>();
            public TrackGeometryRecord Geometry { get; set; }
        }

        public static FileResult IngestFile(string path, int frameStep = 3, CancellationToken ct = default)
        {
            var result = new FileResult();
            using var ibt = new IbtFile(path);
            var info = ibt.SessionInfo;
            var wi = info?.WeekendInfo;
            DateTime Clock(double sessionTime) => ibt.SessionStartUtc.AddSeconds(Math.Max(0, sessionTime - ibt.SessionStartTime));

            var sessions = new SessionAccumulator("ibt", path, Clock);
            var geometry = wi != null && wi.TrackID > 0
                ? new GeometryAccumulator(wi.TrackID, wi.TrackDisplayName, ParseMeters(wi.TrackLength))
                : null;

            using var reader = new IbtSequentialReader(ibt, frameStep);
            while (reader.MoveNext())
            {
                if ((reader.FrameIndex & 0xFFF) == 0 && ct.IsCancellationRequested) return result;
                var done = sessions.Feed(reader);
                if (done != null) result.Sessions.Add(done);
                geometry?.Feed(reader);
            }
            var last = sessions.Finish();
            if (last != null) result.Sessions.Add(last);

            var sectors = info?.SplitTimeInfo?.Sectors?.OrderBy(s => s.SectorNum).Select(s => (double)s.SectorStartPct).ToArray();
            result.Geometry = geometry?.Result(path, sectors);
            return result;
        }

        private static double ParseMeters(string trackLength)
        {
            if (string.IsNullOrEmpty(trackLength)) return 0;
            return double.TryParse(trackLength.Split(' ')[0], System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out double km) ? km * 1000 : 0;
        }
    }
}
