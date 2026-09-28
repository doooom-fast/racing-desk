using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using RacingDesk.Plugin.IRacing;

namespace RacingDesk.Data
{
    public sealed class IngestSummary
    {
        public int FilesSeen, FilesIngested, FilesSkipped, FilesFailed, Sessions, Laps, GeometryUpdates;
        public long BytesRead;
        public TimeSpan Elapsed;
    }

    public sealed class CarScanSummary
    {
        public int FilesScanned, FilesMissing, FilesFailed, FilesLeft, Cars;
        public TimeSpan Elapsed;
    }

    /// <summary>
    /// Backfills the store from .ibt history. Idempotent: a file is re-read only if its size or mtime changed.
    /// </summary>
    public sealed class IbtIngest
    {
        private const int CarScanBatch = 100;

        private readonly RacingDeskStore _store;
        private readonly Action<string> _log;

        public IbtIngest(RacingDeskStore store, Action<string> log = null)
        {
            _store = store;
            _log = log ?? (_ => { });
        }

        public static string DefaultTelemetryDirectory =>
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "iRacing", "telemetry");

        /// <param name="frameStep">Read every Nth frame (3 = 20 Hz; enough for laps, incidents and geometry).</param>
        /// <param name="force">Re-read files already stored (after an accumulator change).</param>
        /// <param name="pause">Checked before each file; while it returns true, ingest waits (e.g. while iRacing runs).</param>
        /// <summary>
        /// Sessions stored before schema v2 have no category. It lives in the file's session YAML, so fill it in
        /// from the header alone instead of re-reading every frame.
        /// </summary>
        public int BackfillCategories(CancellationToken ct = default)
        {
            int updated = 0;
            foreach (var path in _store.IbtPathsMissingCategory())
            {
                if (ct.IsCancellationRequested) break;
                try
                {
                    if (!File.Exists(path)) continue;
                    using var file = new IbtFile(path);
                    string category = file.SessionInfo?.WeekendInfo?.Category;
                    if (!string.IsNullOrEmpty(category)) updated += _store.SetCategory(path, category);
                }
                catch (Exception ex) when (!(ex is OperationCanceledException))
                {
                    _log($"category unreadable for {Path.GetFileName(path)}: {ex.Message}");
                }
            }
            if (updated > 0) _log($"filled in category for {updated} sessions");
            return updated;
        }

        /// <summary>
        /// Files ingested before the store kept cars carry every entrant's car in their session YAML. Reads each
        /// one's header and YAML — no frames, so the whole history takes seconds, not the ingest's forty minutes —
        /// and marks it, so this happens once per file. A file that is cut short, or gone, is marked too; one that
        /// could not be reached — held by another program, its folder not there — is left for the next pass.
        /// </summary>
        /// <param name="pause">While it returns true the pass waits (e.g. while iRacing runs).</param>
        public CarScanSummary ScanCars(CancellationToken ct = default, Func<bool> pause = null)
        {
            var summary = new CarScanSummary();
            var files = _store.FilesNeedingCarScan();
            if (files.Count == 0) return summary;

            using var lowIo = BackgroundIo.Enter();
            var clock = Stopwatch.StartNew();
            var found = new HashSet<string>(StringComparer.Ordinal);
            // Stored a batch at a time: one write for a hundred files, not a hundred.
            var batch = new List<ScannedFile>(CarScanBatch);
            void Store()
            {
                if (batch.Count > 0) _store.SaveScannedCars(batch);
                batch.Clear();
            }
            // Not reaching a file says nothing about it, and marking it would make a passing failure — a drive that
            // was off, a program holding the file — as final as a corrupt file. One line for the pass, not one a file.
            int unreached = 0;
            var reasons = new List<string>();
            void LeaveForNextPass(string path, string why)
            {
                unreached++;
                if (reasons.Count < 3) reasons.Add($"{Path.GetFileName(path)}: {why}");
            }
            var folders = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
            bool FolderIsThere(string path)
            {
                string folder = Path.GetDirectoryName(path) ?? "";
                if (!folders.TryGetValue(folder, out bool there)) folders[folder] = there = Directory.Exists(folder);
                return there;
            }
            // Asking Windows for its processes costs more than reading a header, so not before every file.
            TimeSpan nextPauseCheck = TimeSpan.Zero;
            int done = 0;
            foreach (string path in files)
            {
                if (ct.IsCancellationRequested) break;
                if (pause != null && clock.Elapsed >= nextPauseCheck)
                {
                    if (pause())
                    {
                        Store();
                        _log("car names: paused while iRacing is running");
                        while (pause() && !ct.IsCancellationRequested) ct.WaitHandle.WaitOne(TimeSpan.FromSeconds(10));
                        if (ct.IsCancellationRequested) break;
                        _log("car names: resumed");
                    }
                    nextPauseCheck = clock.Elapsed + TimeSpan.FromSeconds(2);
                }

                done++;
                var file = new ScannedFile { Path = path };
                try
                {
                    if (File.Exists(path))
                    {
                        var header = IbtFile.ReadHeader(path);
                        file.Cars = CarRecord.Distinct(SessionInfoYaml.ParseDriverCars(header.SessionInfoYamlText));
                        file.RecordedAtUtc = header.SessionStartUtc;
                        foreach (var car in file.Cars) found.Add(car.CarPath);
                        summary.FilesScanned++;
                    }
                    else if (FolderIsThere(path))
                    {
                        summary.FilesMissing++;
                    }
                    else
                    {
                        LeaveForNextPass(path, "its folder is not there");
                        continue;
                    }
                }
                catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
                {
                    LeaveForNextPass(path, $"{ex.GetType().Name}: {ex.Message}");
                    continue;
                }
                catch (Exception ex) when (!(ex is OperationCanceledException))
                {
                    summary.FilesFailed++;
                    _log($"car names: skip {Path.GetFileName(path)}: {ex.GetType().Name}: {ex.Message}");
                }
                batch.Add(file);
                if (batch.Count >= CarScanBatch) Store();
            }
            Store();
            if (unreached > 0)
                _log($"car names: {unreached} files left for the next pass ({string.Join("; ", reasons)}{(unreached > reasons.Count ? "; …" : "")})");

            summary.FilesLeft = files.Count - done + unreached;
            summary.Cars = found.Count;
            summary.Elapsed = clock.Elapsed;
            return summary;
        }

        public IngestSummary Run(string directory, int frameStep = 3, int limit = int.MaxValue, CancellationToken ct = default,
            bool force = false, Func<bool> pause = null)
        {
            var summary = new IngestSummary();
            // Backfill reads ~100 GB; never let it compete with the sim for the disk.
            using var lowIo = BackgroundIo.Enter();
            BackfillCategories(ct);
            var clock = Stopwatch.StartNew();
            var files = Directory.Exists(directory)
                ? new DirectoryInfo(directory).EnumerateFiles("*.ibt").OrderBy(f => f.LastWriteTimeUtc).ToList()
                : new List<FileInfo>();

            foreach (var f in files)
            {
                if (ct.IsCancellationRequested || summary.FilesIngested >= limit) break;
                if (pause != null && pause())
                {
                    _log("paused while iRacing is running");
                    while (pause() && !ct.IsCancellationRequested) ct.WaitHandle.WaitOne(TimeSpan.FromSeconds(10));
                    if (ct.IsCancellationRequested) break;
                    _log("resumed");
                }
                summary.FilesSeen++;
                // A file still being written by iRacing changes size; leave it for the next run.
                if (DateTime.UtcNow - f.LastWriteTimeUtc < TimeSpan.FromMinutes(2) || (!force && _store.IsIngested(f.FullName, f.Length, f.LastWriteTimeUtc)))
                {
                    summary.FilesSkipped++;
                    continue;
                }

                try
                {
                    var result = IngestFile(f.FullName, frameStep, ct);
                    if (ct.IsCancellationRequested) break;
                    _store.SaveIngestedFile(f.FullName, f.Length, f.LastWriteTimeUtc, result.Sessions, null, result.Cars, result.RecordedAtUtc);
                    if (_store.SaveGeometryIfBetter(result.Geometry)) summary.GeometryUpdates++;
                    summary.FilesIngested++;
                    summary.Sessions += result.Sessions.Count;
                    summary.Laps += result.Sessions.Sum(s => s.Laps.Count);
                    summary.BytesRead += f.Length;
                }
                catch (Exception ex) when (!(ex is OperationCanceledException))
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
            /// <summary>The cars in the file's entry list, whether or not it yields a session.</summary>
            public List<CarRecord> Cars { get; } = new List<CarRecord>();
            public DateTime RecordedAtUtc { get; set; }
        }

        public static FileResult IngestFile(string path, int frameStep = 3, CancellationToken ct = default)
        {
            var result = new FileResult();
            using var ibt = new IbtFile(path);
            var info = ibt.SessionInfo;
            var wi = info?.WeekendInfo;
            result.RecordedAtUtc = ibt.SessionStartUtc;
            result.Cars.AddRange(CarRecord.Distinct(SessionInfoYaml.DriverCars(info)));
            DateTime Clock(double sessionTime) => SessionClock(ibt, sessionTime);

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

        /// <summary>Wall-clock time of a frame; corrupt headers can carry nonsense session times.</summary>
        public static DateTime SessionClock(IbtFile ibt, double sessionTime)
        {
            double offset = sessionTime - ibt.SessionStartTime;
            if (double.IsNaN(offset) || offset < 0 || offset > TimeSpan.FromDays(7).TotalSeconds) offset = 0;
            return ibt.SessionStartUtc.AddSeconds(offset);
        }

        private static double ParseMeters(string trackLength)
        {
            if (string.IsNullOrEmpty(trackLength)) return 0;
            return double.TryParse(trackLength.Split(' ')[0], System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out double km) ? km * 1000 : 0;
        }
    }
}
