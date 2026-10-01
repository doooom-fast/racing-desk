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

        /// <summary>A file written in the last two minutes may still be the sim's: it is left for later.</summary>
        public static readonly TimeSpan SettleTime = TimeSpan.FromMinutes(2);

        /// <summary>Whether a file is one to read now: settled, and not read before at this length and time.</summary>
        public bool WantsFile(FileInfo f, DateTime nowUtc, bool force = false) =>
            nowUtc - f.LastWriteTimeUtc >= SettleTime && (force || !_store.IsIngested(f.FullName, f.Length, f.LastWriteTimeUtc));

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
                // The file as it is now, not as it was when the folder was listed: a pass over the history takes
                // long enough for the sim to have written more files, and more of a file, since.
                try { f.Refresh(); } catch { /* read as listed */ }
                if (!f.Exists) { summary.FilesSkipped++; continue; }
                if (!WantsFile(f, DateTime.UtcNow, force))
                {
                    summary.FilesSkipped++;
                    continue;
                }
                long length = f.Length;
                DateTime mtime = f.LastWriteTimeUtc;

                try
                {
                    var result = IngestFile(f.FullName, frameStep, ct);
                    if (ct.IsCancellationRequested) break;
                    // Written to while it was read: what was read is not the file, and it is read again next time.
                    var after = new FileInfo(f.FullName);
                    if (after.Exists && (after.Length != length || after.LastWriteTimeUtc != mtime))
                    {
                        _log($"{f.Name} was being written while it was read; left for the next pass");
                        summary.FilesSkipped++;
                        continue;
                    }
                    _store.SaveIngestedFile(f.FullName, length, mtime, result.Sessions, null, result.Cars, result.RecordedAtUtc);
                    if (KeepGeometry(result.Geometry, f.Name)) summary.GeometryUpdates++;
                    summary.FilesIngested++;
                    summary.Sessions += result.Sessions.Count;
                    summary.Laps += result.Sessions.Sum(s => s.Laps.Count);
                    summary.BytesRead += length;
                }
                catch (Exception ex) when (!(ex is OperationCanceledException))
                {
                    summary.FilesFailed++;
                    _log($"skip {f.Name}: {ex.GetType().Name}: {ex.Message}");
                    _store.SaveIngestedFile(f.FullName, length, mtime, Array.Empty<SessionRecord>(), ex.GetType().Name + ": " + ex.Message);
                }

                if ((summary.FilesIngested + summary.FilesFailed) % 100 == 0 && summary.FilesIngested > 0)
                    _log($"{summary.FilesIngested + summary.FilesFailed} files, {summary.Sessions} sessions, {summary.BytesRead / 1e9:F1} GB, {clock.Elapsed.TotalSeconds:F0}s");
            }

            summary.Elapsed = clock.Elapsed;
            return summary;
        }

        /// <summary>A file's outline into the store, with the file's name in the log line and no more.</summary>
        private bool KeepGeometry(TrackGeometryRecord geometry, string fileName)
        {
            if (geometry == null) return false;
            var did = _store.MergeGeometry(geometry);
            if (did == GeometryMerge.Kept) return false;
            string what = did == GeometryMerge.New ? "outline made" : did == GeometryMerge.Averaged ? "outline averaged in" : "outline replaced";
            _log($"{what}: {geometry.TrackName}, {geometry.CleanLaps} clean laps, from {fileName}");
            return true;
        }

        /// <summary>Clean laps enough for an outline; a layout's older files are not read past this.</summary>
        public const int EnoughCleanLaps = 12;

        /// <summary>
        /// Builds again every outline the store holds that was built with fewer checks than this build's, from the
        /// layout's files newest first — the newest file's laps win, older files are averaged in only where they
        /// agree, and no more files are read once there are laps enough. Geometry only: the sessions are as they
        /// were. Low I/O priority, paused while the sim runs, one line per layout, and a layout no file gives a
        /// clean lap for keeps the outline it had, marked looked at.
        /// </summary>
        public int RebuildGeometry(CancellationToken ct = default, Func<bool> pause = null, int frameStep = 3)
        {
            var layouts = _store.TrackIdsNeedingRebuild();
            if (layouts.Count == 0) return 0;
            using var lowIo = BackgroundIo.Enter();
            int rebuilt = 0;
            _log($"{layouts.Count} outlines to build again with this build's checks");
            foreach (var (trackId, name) in layouts)
            {
                if (ct.IsCancellationRequested) break;
                TrackGeometryRecord running = null;
                int filesRead = 0, filesWithLaps = 0;
                foreach (string path in _store.IbtPathsForTrack(trackId))
                {
                    if (ct.IsCancellationRequested) break;
                    if (pause != null && pause())
                    {
                        _log("outlines: paused while iRacing is running");
                        while (pause() && !ct.IsCancellationRequested) ct.WaitHandle.WaitOne(TimeSpan.FromSeconds(10));
                        if (ct.IsCancellationRequested) break;
                        _log("outlines: resumed");
                    }
                    if (!File.Exists(path)) continue;
                    TrackGeometryRecord one;
                    try
                    {
                        one = IngestGeometryOnly(path, trackId, frameStep, ct);
                        filesRead++;
                    }
                    catch (Exception ex) when (!(ex is OperationCanceledException))
                    {
                        _log($"outlines: skip {Path.GetFileName(path)}: {ex.GetType().Name}: {ex.Message}");
                        continue;
                    }
                    if (one == null) continue;
                    filesWithLaps++;
                    if (running == null) running = one;
                    else if (GeometryAccumulator.Agree(running, one)) running = GeometryAccumulator.Merge(running, one);
                    // Else the older file is of another place (a rescan, a north fix): the newer laps stand.
                    if (running.CleanLaps >= EnoughCleanLaps) break;
                }
                if (ct.IsCancellationRequested) break;
                if (running != null)
                {
                    _store.ReplaceGeometry(running);
                    rebuilt++;
                    _log($"outline rebuilt: {running.TrackName ?? name}, {running.CleanLaps} clean laps of {filesWithLaps} files ({filesRead} read)");
                }
                else
                {
                    _store.StampGeometryChecks(trackId);
                    _log($"outline kept as it was: {name}, no file gave a clean lap under this build's checks ({filesRead} read)");
                }
            }
            return rebuilt;
        }

        /// <summary>
        /// Every minute while the sim is closed, reads the files written since the last pass: a session's file goes
        /// in the same evening, not at the next start. Returns when <paramref name="ct"/> is cancelled.
        /// </summary>
        public void WatchFinished(string directory, CancellationToken ct, Func<bool> pause = null, int frameStep = 3, TimeSpan? every = null)
        {
            var period = every ?? TimeSpan.FromSeconds(60);
            while (!ct.IsCancellationRequested)
            {
                if (ct.WaitHandle.WaitOne(period)) return;
                try
                {
                    if (pause != null && pause()) continue;
                    if (!Directory.Exists(directory)) continue;
                    var now = DateTime.UtcNow;
                    bool any = new DirectoryInfo(directory).EnumerateFiles("*.ibt").Any(f => WantsFile(f, now));
                    if (!any) continue;
                    var summary = Run(directory, frameStep, int.MaxValue, ct, pause: pause);
                    if (summary.FilesIngested > 0 || summary.FilesFailed > 0)
                        _log($"{summary.FilesIngested} new files, {summary.Sessions} sessions, {summary.FilesFailed} unreadable, {summary.Elapsed.TotalSeconds:F0}s");
                }
                catch (Exception ex) when (!(ex is OperationCanceledException))
                {
                    _log("watch: " + ex.Message);
                }
            }
        }

        /// <summary>
        /// A file's outline and nothing else, for a layout: null when the file is of another layout, carries no
        /// position, or has no clean lap in it.
        /// </summary>
        public static TrackGeometryRecord IngestGeometryOnly(string path, int trackId, int frameStep = 3, CancellationToken ct = default)
        {
            using var ibt = new IbtFile(path);
            var wi = ibt.SessionInfo?.WeekendInfo;
            if (wi == null || wi.TrackID != trackId) return null;
            if (!ibt.Vars.ContainsKey("Lat") || !ibt.Vars.ContainsKey("Lon")) return null;
            var geometry = new GeometryAccumulator(wi.TrackID, wi.TrackDisplayName, ParseMeters(wi.TrackLength));
            using var reader = new IbtSequentialReader(ibt, frameStep);
            while (reader.MoveNext())
            {
                if ((reader.FrameIndex & 0xFFF) == 0 && ct.IsCancellationRequested) return null;
                geometry.Feed(reader);
            }
            var sectors = ibt.SessionInfo?.SplitTimeInfo?.Sectors?.OrderBy(s => s.SectorNum).Select(s => (double)s.SectorStartPct).ToArray();
            return geometry.Result(path, sectors);
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

        /// <summary>"4.02 km" → 4020; 0 when the YAML gives none.</summary>
        public static double ParseMeters(string trackLength)
        {
            if (string.IsNullOrEmpty(trackLength)) return 0;
            return double.TryParse(trackLength.Split(' ')[0], System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out double km) ? km * 1000 : 0;
        }
    }
}
