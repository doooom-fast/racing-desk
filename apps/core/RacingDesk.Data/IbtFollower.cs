using System;
using System.IO;
using System.Linq;
using System.Threading;
using RacingDesk.Plugin.Engine;
using RacingDesk.Plugin.IRacing;

namespace RacingDesk.Data
{
    /// <summary>
    /// The first session at a layout, followed as it is driven: the sim writes the session's .ibt as it goes, so the
    /// file is read behind it — on a thread of its own, at background I/O priority, a few seconds' worth of frames at
    /// a time — and from the first clean lap on there is an outline, provisional, for the map. Each clean lap after
    /// refines it. The finished file, ingested whole, replaces it. Nothing here touches the sim's file but to read it.
    ///
    /// The telemetry thread only says which layout is being driven (<see cref="Seen"/>); the work is this thread's,
    /// and whatever goes wrong in it is logged and goes no further.
    /// </summary>
    public sealed class IbtFollower : IDisposable
    {
        /// <summary>How often the file is looked at while the sim is sending.</summary>
        public static readonly TimeSpan LookEvery = TimeSpan.FromSeconds(10);
        /// <summary>A file written this recently is the sim's current one.</summary>
        public static readonly TimeSpan CurrentWithin = TimeSpan.FromMinutes(2);
        /// <summary>Frames not seen for this long: the sim has gone, and so has the session.</summary>
        public static readonly TimeSpan GoneAfter = TimeSpan.FromSeconds(20);
        /// <summary>
        /// A file opened part-way through the session (the host started late) is read from this far back from its
        /// end, not from its start: the laps worth an outline are the ones just driven, and a whole stint is hundreds
        /// of megabytes. A lap that began before this is out for not being from the line, and the next is whole.
        /// </summary>
        public static readonly TimeSpan LookBack = TimeSpan.FromMinutes(5);

        private readonly string _directory;
        private readonly string _dbPath;
        private readonly Action<string> _log;
        private readonly Func<DateTime> _now;
        private readonly int _frameStep;
        private readonly TimeSpan _currentWithin;
        private readonly object _gate = new object();
        private readonly ManualResetEventSlim _stop = new ManualResetEventSlim();
        private readonly AutoResetEvent _wake = new AutoResetEvent(false);
        private Thread _thread;

        private volatile int _wantedTrackId;
        private long _lastFrameTicks;

        // The file being followed, and where in it the reading has got to.
        private string _path;
        private IbtFile _file;
        private IbtSequentialReader _reader;
        private GeometryAccumulator _geometry;
        private int _lapsSaid;
        private bool _hasWhole;        // the store has a whole outline for the layout: nothing to do
        private int _wholeFor;
        private string _declined;      // a file looked at and left alone (of another layout, or no position in it): not opened again
        private string _lastProblem;   // what was last logged as going wrong: said once, not at every look

        private TrackOutline _current;

        /// <param name="dbPath">The store the provisional outline is kept in, through a connection of this thread's own.</param>
        /// <param name="currentWithin">How recently a file must have been written to be the sim's current one (for tests).</param>
        public IbtFollower(string directory, string dbPath, Action<string> log = null, Func<DateTime> now = null, int frameStep = 3, TimeSpan? currentWithin = null)
        {
            _directory = directory;
            _dbPath = dbPath;
            _log = log ?? (_ => { });
            _now = now ?? (() => DateTime.UtcNow);
            _frameStep = Math.Max(1, frameStep);
            _currentWithin = currentWithin ?? CurrentWithin;
        }

        /// <summary>Raised on the follower's thread with each new provisional outline.</summary>
        public event Action<TrackOutline> Outlined;

        /// <summary>The outline made so far of the layout being driven, or null; for <see cref="TrackOutlines.Live"/>.</summary>
        public TrackOutline Current(int trackId)
        {
            lock (_gate) return _current != null && _current.TrackId == trackId ? _current : null;
        }

        /// <summary>Where the following has got to, for a test: the file's records, the next frame to read, the laps.</summary>
        public string Trace =>
            _file == null ? "not following" :
            $"records {_file.RecordCount}, next frame {_reader.NextFrame}, clean laps {_geometry.CleanLaps}, said {_lapsSaid}, out: " +
            string.Join(", ", _geometry.Rejected.Select(r => r.Key + " " + r.Value));

        /// <summary>The telemetry thread, each frame: the layout the sim says, 0 when it does not.</summary>
        public void Seen(int trackId)
        {
            Interlocked.Exchange(ref _lastFrameTicks, _now().Ticks);
            if (trackId > 0 && trackId != _wantedTrackId)
            {
                _wantedTrackId = trackId;
                _wake.Set();
            }
        }

        public void Start()
        {
            if (_thread != null) return;
            _thread = new Thread(Loop) { IsBackground = true, Priority = ThreadPriority.BelowNormal, Name = "ibt-follower" };
            _thread.Start();
        }

        public void Dispose()
        {
            _stop.Set();
            _wake.Set();
            try { _thread?.Join(TimeSpan.FromSeconds(5)); } catch { }
            Close();
            _wake.Dispose();
            _stop.Dispose();
        }

        private void Loop()
        {
            using var lowIo = BackgroundIo.Enter();
            while (!_stop.IsSet)
            {
                _wake.WaitOne(LookEvery);
                if (_stop.IsSet) return;
                LookQuietly();
            }
        }

        /// <summary>
        /// A look that says what goes wrong in it once and carries on: a file that cannot be read is the same
        /// problem at every look until the sim writes another, and one line says it.
        /// </summary>
        internal void LookQuietly()
        {
            try
            {
                Look();
                _lastProblem = null;
            }
            catch (Exception ex)
            {
                string said = "follower: " + ex.Message;
                if (said != _lastProblem) _log(said);
                _lastProblem = said;
            }
        }

        /// <summary>One look at the sim's file. Public for tests; the thread calls it every <see cref="LookEvery"/>.</summary>
        public void Look()
        {
            int trackId = _wantedTrackId;
            var now = _now();
            bool simSending = now.Ticks - Interlocked.Read(ref _lastFrameTicks) < GoneAfter.Ticks;
            if (trackId <= 0 || !simSending)
            {
                if (!simSending && _file != null) Close();
                if (!simSending) _declined = null;
                return;
            }

            if (_hasWhole && _wholeFor == trackId) return;
            if (_wholeFor != trackId)
            {
                _wholeFor = trackId;
                _hasWhole = StoreHasWhole(trackId);
                _declined = null;
                if (_hasWhole) { Close(); return; }
            }

            string path = CurrentFile(now);
            if (path == null) return;
            if (path != _path)
            {
                if (string.Equals(path, _declined, StringComparison.OrdinalIgnoreCase)) return;
                Close();
                var file = new IbtFile(path, growing: true);
                var wi = file.SessionInfo?.WeekendInfo;
                if (wi == null)
                {
                    // The sim has made the file and not yet written its session: the next look finds it whole.
                    file.Dispose();
                    return;
                }
                if (wi.TrackID != trackId || !file.Vars.ContainsKey("Lat") || !file.Vars.ContainsKey("Lon"))
                {
                    file.Dispose();
                    _declined = path;
                    _log($"not following {Path.GetFileName(path)}: " + (wi.TrackID != trackId ? "it is of another layout than the one being driven" : "it carries no position"));
                    return;
                }
                // A file already well under way is read from its last minutes, not from its start (from a frame the
                // reading steps through, as a whole file is read).
                int start = Math.Max(0, file.RecordCount - (int)(LookBack.TotalSeconds * Math.Max(1, file.TickRate)));
                start -= start % _frameStep;
                _path = path;
                _file = file;
                _reader = new IbtSequentialReader(file, _frameStep, start);
                _geometry = new GeometryAccumulator(wi.TrackID, wi.TrackDisplayName, IbtIngest.ParseMeters(wi.TrackLength));
                _lapsSaid = 0;
                _log($"following {Path.GetFileName(path)} for an outline of {wi.TrackDisplayName}" + (start > 0 ? $", from {start} frames in" : ""));
            }

            _file.Refresh();
            while (_reader.MoveNext()) _geometry.Feed(_reader);
            if (_geometry.CleanLaps <= _lapsSaid) return;

            // A clean lap more: a provisional outline, kept for the map and in the store. The laps so far stay in
            // the accumulator, so the record is of all of them. The lap being driven is not judged: it goes on.
            var sectors = _file.SessionInfo?.SplitTimeInfo?.Sectors?.OrderBy(s => s.SectorNum).Select(s => (double)s.SectorStartPct).ToArray();
            var record = _geometry.Result(_path, sectors, provisional: true, closeOpenLap: false);
            if (record == null) return;
            _lapsSaid = _geometry.CleanLaps;
            var outline = TrackOutlines.ToOutline(record);
            lock (_gate) _current = outline;
            _log($"outline from the session being driven: {record.TrackName}, {record.CleanLaps} clean lap{(record.CleanLaps == 1 ? "" : "s")}" +
                 (_geometry.LengthWarning != null ? "; " + _geometry.LengthWarning : ""));
            try
            {
                using var store = new RacingDeskStore(_dbPath);
                store.MergeGeometry(record);
            }
            catch (Exception ex)
            {
                _log("follower: outline not kept in the store: " + ex.Message);
            }
            Outlined?.Invoke(outline);
        }

        private bool StoreHasWhole(int trackId)
        {
            try
            {
                if (!File.Exists(_dbPath)) return false;
                using var store = RacingDeskStore.OpenReadOnly(_dbPath);
                var g = store.GetGeometry(trackId);
                return g != null && !g.Provisional && g.Checks >= GeometryAccumulator.ChecksVersion;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// The file the sim is writing: the newest .ibt in the folder, written in the last two minutes — or the one
        /// being followed, for as long as it is the newest.
        ///
        /// The folder's listing cannot say when a file the sim holds open was last written: Windows keeps the time
        /// the file was made, and a length of nought, in the listing until the file is closed or someone asks for the
        /// file by its path. So the listing only names the newest few, and each of those is asked for itself; a
        /// follower that went by the listing stopped two minutes after the sim made the file, with the stint
        /// still going.
        /// </summary>
        private string CurrentFile(DateTime now)
        {
            if (!Directory.Exists(_directory)) return null;
            var newest3 = new DirectoryInfo(_directory).EnumerateFiles("*.ibt")
                .OrderByDescending(f => f.CreationTimeUtc > f.LastWriteTimeUtc ? f.CreationTimeUtc : f.LastWriteTimeUtc)
                .Take(3).ToList();
            FileInfo newest = null;
            foreach (var f in newest3)
            {
                try { f.Refresh(); } catch (IOException) { continue; }
                if (!f.Exists) continue;
                if (newest == null || f.LastWriteTimeUtc > newest.LastWriteTimeUtc) newest = f;
            }
            if (newest == null) return null;
            // The sim is sending and the file it is writing is still the newest: it is the current one, whatever its
            // time says (a stint is longer than the window).
            if (_path != null && string.Equals(newest.FullName, _path, StringComparison.OrdinalIgnoreCase)) return _path;
            return now - newest.LastWriteTimeUtc <= _currentWithin ? newest.FullName : null;
        }

        private void Close()
        {
            _reader?.Dispose();
            _file?.Dispose();
            _reader = null;
            _file = null;
            _geometry = null;
            _path = null;
            lock (_gate) _current = null;
        }
    }
}
