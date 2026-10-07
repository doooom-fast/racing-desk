using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Threading;

namespace RacingDesk.Plugin.Engine
{
    /// <summary>
    /// The track map: a layout's outline, and every car placed along it each frame.
    ///
    /// The outline is the host's, derived from the driver's own Lat/Lon telemetry and keyed by the sim's TrackID
    /// (<see cref="IOutlineSource"/>: the host's own store in the host, the host over loopback in the SimHub
    /// plugin). Nothing is recorded here any more — no dead reckoning, no files read or written — so a spin on the
    /// first lap, a start from the pit lane or an old recording cannot bend the map. Where the host has no outline
    /// yet the map says so (<see cref="Status"/>), and the first clean lap of the session gives one.
    ///
    ///   1. <see cref="OnTrackChanged"/> clears the map and asks the source, on a pool thread; while there is
    ///      nothing it asks again every 5 s, and with an outline every 60 s, swapping it when it has gained laps.
    ///      An outline marked <see cref="TrackOutline.Crowd"/> is SimHub's shared map, the host's interim until
    ///      his first clean lap: drawn like any other, said to be so (<see cref="StatusCrowd"/>), asked past
    ///      every 5 s, and replaced by his own the moment the host has one; never the other way about.
    ///   2. The outline is normalised to a 0–100 SVG viewBox with 5% padding, and a closed path is built.
    ///   3. Each frame, every car's LapDistPct is interpolated along the outline — round the whole loop, the last
    ///      point back to the first included, so crossing the line is one more step and not a jump.
    ///   4. SvgPath, PlayerX/Y, PlayerHeading and the opponents go out as properties the HUD reads each frame.
    /// </summary>
    public class TrackMapProvider
    {
        // ── What the map goes on ──────────────────────────────────────────
        private IOutlineSource _outlines;
        private int _currentTrackId;
        private string _currentTrackName = "";
        private TrackOutline _applied;
        private bool _ready;
        private string _status = StatusNone;

        // Asking the source: never on the telemetry thread, and one ask at a time.
        private readonly object _askGate = new object();
        private bool _asking;
        private DateTime _askDue = DateTime.MinValue;
        private (int TrackId, TrackOutline Outline, string Status, bool Failed)? _answer;
        private bool _saidNoHost;
        // Asks in a row that the host did not answer: each waits twice as long as the last before the next (NoHostBackOff).
        private int _noHostStreak;
        private Func<DateTime> _now = () => DateTime.UtcNow;

        /// <summary>The map has an outline and places the cars on it.</summary>
        public const string StatusReady = "ready";
        /// <summary>
        /// The map is drawn, on SimHub's shared map of the layout (<see cref="TrackOutline.Crowd"/>): the interim until
        /// the first clean lap gives the host an outline of his own, which the map says is coming.
        /// </summary>
        public const string StatusCrowd = "crowd";
        /// <summary>The host has no outline of this layout yet: the first clean lap of the session gives one.</summary>
        public const string StatusFirstLap = "first-lap";
        /// <summary>The host could not be reached (SimHub without the app running): the maps are the app's.</summary>
        public const string StatusNoHost = "no-host";
        /// <summary>No track, or no source at all.</summary>
        public const string StatusNone = "none";

        private static readonly TimeSpan AskAgainWithout = TimeSpan.FromSeconds(5);
        private static readonly TimeSpan AskAgainWith = TimeSpan.FromSeconds(60);
        internal static readonly TimeSpan NoHostBackOffMax = TimeSpan.FromMinutes(2);

        /// <summary>
        /// How long after the <paramref name="streak"/>th ask in a row that the host did not answer the next ask waits: 5 s,
        /// then twice as long each time, up to two minutes. Something listens at its port and does not answer, and asking
        /// every five seconds changes nothing.
        /// </summary>
        internal static TimeSpan NoHostBackOff(int streak)
        {
            if (streak <= 1) return AskAgainWithout;
            double seconds = AskAgainWithout.TotalSeconds * Math.Pow(2, Math.Min(streak - 1, 10));
            return seconds >= NoHostBackOffMax.TotalSeconds ? NoHostBackOffMax : TimeSpan.FromSeconds(seconds);
        }

        /// <summary>What the map says with the outline it has: ready, or crowd while the outline is SimHub's shared map.</summary>
        private string ReadyStatus => _applied != null && _applied.Crowd ? StatusCrowd : StatusReady;

        // ── The outline, normalised to 0–100 ───────────────────────────────
        private TrackPoint[] _outline = new TrackPoint[0];
        private string _svgPath = "";

        // ── Per-frame car positions ────────────────────────────────────────
        private double _playerX, _playerY;
        private bool _hasPlayerPos;
        private readonly List<OpponentPos> _opponents = new List<OpponentPos>();
        private readonly Dictionary<int, OpponentPos> _oppSmoothed = new Dictionary<int, OpponentPos>();
        private int _oppCleanupCounter = 0;

        // ── Demo track ─────────────────────────────────────────────────────
        private static TrackPoint[] _demoOutline;
        private static string _demoSvgPath;
        private bool _demoMode = false;

        // ── Public read-only state ─────────────────────────────────────────

        /// <summary>True when there is an outline to place the cars on.</summary>
        public bool IsReady => _ready;

        /// <summary>Why there is or is not a map: ready, crowd, first-lap, no-host, none.</summary>
        public string Status => _demoMode ? StatusReady : _status;

        /// <summary>The sim's name for the layout the map is of (the plugin's track slug, e.g. "algarve gp").</summary>
        public string TrackName => _currentTrackName;

        /// <summary>The sim's TrackID the map is keyed by; 0 while none.</summary>
        public int TrackId => _currentTrackId;

        /// <summary>The outline in use: its laps and its age, for the log and for tests.</summary>
        public TrackOutline Outline => _applied;

        /// <summary>SVG path data string for the track outline, in a 0 0 100 100 viewBox.</summary>
        public string SvgPath => _demoMode ? DemoSvgPath : _svgPath;

        /// <summary>Player X position in SVG coords (0–100).</summary>
        public double PlayerX => _playerX;

        /// <summary>Player Y position in SVG coords (0–100).</summary>
        public double PlayerY => _playerY;

        /// <summary>Player heading in degrees (0 = up on the map, clockwise positive), for the local view's rotation.</summary>
        public double PlayerHeadingDeg { get; private set; }

        /// <summary>
        /// Compact opponent string: "x1,y1,p1;x2,y2,p2;..." where p=1 if in pit.
        /// Dashboard parses this to place opponent dots.
        /// </summary>
        public string OpponentData { get; private set; } = "";

        /// <summary>Number of active opponents on the map.</summary>
        public int OpponentCount => _opponents.Count;

        // ── Initialisation ─────────────────────────────────────────────────

        /// <summary>Where outlines come from. Set once by the host; null means the map has none to ask.</summary>
        public IOutlineSource Outlines
        {
            get => _outlines;
            set { _outlines = value; _askDue = DateTime.MinValue; }
        }

        /// <summary>The clock, for tests.</summary>
        internal Func<DateTime> Clock { set => _now = value ?? (() => DateTime.UtcNow); }

        /// <summary>An ask is on its way to the source and not yet answered; for a test.</summary>
        internal bool Asking { get { lock (_askGate) return _asking; } }

        /// <summary>Where the asking has got to, for a test.</summary>
        internal string Trace
        {
            get
            {
                lock (_askGate)
                    return $"source {(_outlines == null ? "none" : _outlines.GetType().Name)}, track {_currentTrackId}, asking {_asking}, due {_askDue:HH:mm:ss}, now {_now():HH:mm:ss}, answer {(_answer == null ? "none" : _answer.Value.Status)}, status {_status}, ready {_ready}";
            }
        }

        /// <summary>
        /// Call when the layout changes. Clears the map and asks the source for the layout's outline.
        /// </summary>
        public void OnTrackChanged(int trackId, string trackName)
        {
            // Don't let a stale track-change event nuke demo mode
            if (_demoMode) return;

            _currentTrackId = trackId;
            _currentTrackName = trackName ?? "";
            _outline = new TrackPoint[0];
            _svgPath = "";
            _ready = false;
            _applied = null;
            _hasPlayerPos = false;
            _playerX = 0; _playerY = 0;
            _opponents.Clear();
            _oppSmoothed.Clear();
            OpponentData = "";
            lock (_askGate) _answer = null;
            _status = _outlines == null || trackId <= 0 ? StatusNone : StatusFirstLap;
            _saidNoHost = false;
            _noHostStreak = 0;
            _askDue = DateTime.MinValue;
            Log.Info($"[RacingDesk] Track map: '{_currentTrackName}' (id {trackId}), asking for its outline");
        }

        /// <summary>
        /// Enable demo mode: the demo's own circuit, and the demo's cars on it.
        /// </summary>
        public void SetDemoMode(bool enabled)
        {
            _demoMode = enabled;
            if (enabled)
            {
                EnsureDemoOutline();
                _ready = true;
            }
        }

        // ── Per-frame update ───────────────────────────────────────────────

        /// <summary>
        /// Called every frame with the driver's and every car's LapDistPct: places each on the outline. Takes the
        /// source's answer when one has arrived, and asks again when it is due.
        /// </summary>
        public void Update(
            double playerLapDistPct,
            float[] carIdxLapDistPct,
            bool[] carIdxOnPitRoad,
            int playerCarIdx,
            int playerPosition,
            bool playerInPitLane = false)
        {
            if (_demoMode) return; // demo positions handled separately

            TakeAnswer();
            AskIfDue();

            if (!_ready || _outline.Length < 4) return;

            // Player position — low-pass filtered. Along a closed loop there is no jump to guard against.
            var pp = InterpolatePosition(playerLapDistPct);
            pp.X = Math.Max(0, Math.Min(100, pp.X));
            pp.Y = Math.Max(0, Math.Min(100, pp.Y));
            if (!_hasPlayerPos)
            {
                _playerX = pp.X;
                _playerY = pp.Y;
                _hasPlayerPos = true;
            }
            else
            {
                _playerX += (pp.X - _playerX) * 0.5;
                _playerY += (pp.Y - _playerY) * 0.5;
            }

            // Heading from a small forward step along the SVG outline, so the local view's rotation is in the
            // map's own space and the car always drives upward.
            double aheadPct = (playerLapDistPct + 0.005) % 1.0;
            var ahead = InterpolatePosition(aheadPct);
            double hdx = ahead.X - pp.X;
            double hdy = ahead.Y - pp.Y;
            if (hdx != 0 || hdy != 0)
            {
                // atan2(dx, -dy): 0° = SVG up (negative Y), clockwise positive
                double angleRad = Math.Atan2(hdx, -hdy);
                PlayerHeadingDeg = angleRad * (180.0 / Math.PI);
            }

            // Opponents, each low-pass filtered on its own. The arrays are as long as the sim's (never a fixed 64).
            var newOpps = new List<OpponentPos>();
            if (carIdxLapDistPct != null)
            {
                for (int i = 0; i < carIdxLapDistPct.Length; i++)
                {
                    if (i == playerCarIdx) continue;
                    float dist = carIdxLapDistPct[i];
                    if (dist <= 0 || dist > 1) continue;

                    var op = InterpolatePosition(dist);
                    op.X = Math.Max(0, Math.Min(100, op.X));
                    op.Y = Math.Max(0, Math.Min(100, op.Y));
                    bool inPit = carIdxOnPitRoad != null && i < carIdxOnPitRoad.Length && carIdxOnPitRoad[i];

                    double sx = op.X, sy = op.Y;
                    if (_oppSmoothed.TryGetValue(i, out var prev))
                    {
                        sx = prev.X + (op.X - prev.X) * 0.4;
                        sy = prev.Y + (op.Y - prev.Y) * 0.4;
                    }
                    _oppSmoothed[i] = new OpponentPos { X = sx, Y = sy, InPit = inPit };

                    newOpps.Add(new OpponentPos { X = sx, Y = sy, InPit = inPit });
                }
            }

            // Clean up smoothing state for cars that are no longer present
            if (_oppCleanupCounter++ > 120) // every ~2s at 60fps
            {
                _oppCleanupCounter = 0;
                var activeIds = new HashSet<int>();
                if (carIdxLapDistPct != null)
                    for (int i = 0; i < carIdxLapDistPct.Length; i++)
                        if (carIdxLapDistPct[i] > 0) activeIds.Add(i);
                var stale = new List<int>();
                foreach (var k in _oppSmoothed.Keys)
                    if (!activeIds.Contains(k)) stale.Add(k);
                foreach (var k in stale) _oppSmoothed.Remove(k);
            }

            _opponents.Clear();
            _opponents.AddRange(newOpps);

            BuildOpponentData();
        }

        /// <summary>
        /// Update demo mode positions based on simulated track positions.
        /// Called from DemoTelemetryProvider.
        /// </summary>
        public void UpdateDemo(double playerTrackPct, int carCount, double elapsed)
        {
            if (!_demoMode) return;

            EnsureDemoOutline();
            var outline = _demoOutline;

            var pp = InterpolateOnOutline(outline, playerTrackPct);
            _playerX = pp.X;
            _playerY = pp.Y;

            // Compute heading from a small forward sample on the outline
            double aheadPct = (playerTrackPct + 0.005) % 1.0;
            var ahead = InterpolateOnOutline(outline, aheadPct);
            double dx = ahead.X - pp.X;
            double dy = ahead.Y - pp.Y;
            if (dx != 0 || dy != 0)
            {
                // atan2 gives angle from positive X axis; convert to compass (0=north, CW positive)
                double angleRad = Math.Atan2(dx, -dy); // -dy because SVG Y increases downward
                PlayerHeadingDeg = angleRad * (180.0 / Math.PI);
            }

            // Simulate opponents spread around the track
            _opponents.Clear();
            for (int i = 0; i < carCount; i++)
            {
                double offset = (double)(i + 1) / (carCount + 1);
                // Add subtle drift so they move at slightly different speeds
                double drift = Math.Sin(elapsed * 0.3 + i * 1.7) * 0.015;
                double pos = (playerTrackPct + offset + drift) % 1.0;
                if (pos < 0) pos += 1.0;
                var op = InterpolateOnOutline(outline, pos);
                _opponents.Add(new OpponentPos { X = op.X, Y = op.Y, InPit = false });
            }

            BuildOpponentData();
        }

        // ── Asking the source ───────────────────────────────────────────────

        private void AskIfDue()
        {
            if (_outlines == null || _currentTrackId <= 0) return;
            var now = _now();
            if (now < _askDue) return;
            lock (_askGate)
            {
                if (_asking) return;
                _asking = true;
            }
            // Not asked again until the answer is in (TakeAnswer sets when); meanwhile _asking holds it.
            _askDue = DateTime.MaxValue;
            int trackId = _currentTrackId;
            var source = _outlines;
            ThreadPool.QueueUserWorkItem(_ => Ask(source, trackId));
        }

        private void Ask(IOutlineSource source, int trackId)
        {
            TrackOutline outline = null;
            string status;
            bool failed = false;
            if (source is IOutlineSourceReachability reach && !reach.Reachable())
            {
                // Nothing listens where the host would be: not asked, so nothing is thrown.
                status = StatusNoHost;
                SayNoHost("nothing listens at the host's address");
            }
            else
                try
                {
                    outline = source.Get(trackId);
                    status = outline == null ? StatusFirstLap : outline.Crowd ? StatusCrowd : StatusReady;
                }
                catch (Exception ex)
                {
                    status = StatusNoHost;
                    failed = true;
                    SayNoHost(ex.GetType().Name);
                }
            lock (_askGate)
            {
                _answer = (trackId, outline, status, failed);
                _asking = false;
            }
        }

        // Once for each layout, and again only after the host has answered: never once for each ask, and never with a stack.
        private void SayNoHost(string why)
        {
            if (_saidNoHost) return;
            _saidNoHost = true;
            Log.Info($"[RacingDesk] Track map: the host did not answer for its outline ({why}); the maps are the app's, and it is asked again, less often while it stays away");
        }

        /// <summary>Takes the source's answer on the telemetry thread. Public so a host can apply one it already has.</summary>
        public void TakeAnswer()
        {
            (int TrackId, TrackOutline Outline, string Status, bool Failed)? answer;
            lock (_askGate)
            {
                answer = _answer;
                _answer = null;
            }
            if (answer == null) return;
            if (answer.Value.TrackId == _currentTrackId) Apply(answer.Value.Outline, answer.Value.Status);
            // Asked again in five seconds while there is nothing, in a minute once there is (it may have gained laps);
            // with SimHub's shared map up, every five seconds still, so his own takes its place within seconds. A host
            // that was asked and did not answer is asked less often each time (NoHostBackOff), up to two minutes; with
            // nothing listening at its port nobody was asked, and the look (Windows' table of listening ports) is taken
            // again every five seconds, so the app's opening is seen within seconds.
            var again = _ready && _applied != null && !_applied.Crowd ? AskAgainWith : AskAgainWithout;
            if (answer.Value.Status == StatusNoHost)
            {
                if (answer.Value.Failed)
                {
                    _noHostStreak++;
                    var backOff = NoHostBackOff(_noHostStreak);
                    if (backOff > again) again = backOff;
                }
                else
                    _noHostStreak = 0;
            }
            else
            {
                if (_noHostStreak > 0) _saidNoHost = false;   // a later absence is said again, once
                _noHostStreak = 0;
            }
            _askDue = _now() + again;
        }

        /// <summary>An outline for the current layout, applied now (a test's, or an answer taken by hand).</summary>
        public void Apply(TrackOutline outline, string status)
        {
            if (outline == null)
            {
                // A map already drawn stays up through a host that is slow to answer, or a miss.
                _status = _ready ? ReadyStatus : status;
                return;
            }
            if (outline.TrackId != _currentTrackId && _currentTrackId > 0) return;
            if (outline.Crowd && _applied != null && !_applied.Crowd)
            {
                // His own outline is never replaced by the shared map.
                _status = StatusReady;
                return;
            }
            if (_applied != null && outline.SameAs(_applied))
            {
                _status = ReadyStatus;
                return;
            }
            if (outline.Points == null || outline.Points.Count < 10)
            {
                _status = _ready ? ReadyStatus : StatusFirstLap;
                return;
            }
            var points = new List<TrackPoint>(outline.Points.Count);
            foreach (var p in outline.Points) points.Add(new TrackPoint { WorldX = p.X, WorldZ = p.Z, LapDistPct = p.Pct });
            points.Sort((a, b) => a.LapDistPct.CompareTo(b.LapDistPct));
            NormaliseAndBuild(points);
            _applied = outline;
            _status = ReadyStatus;
            _hasPlayerPos = false;
            Log.Info(outline.Crowd
                ? $"[RacingDesk] Track map: SimHub's shared map of '{_currentTrackName}', until the first clean lap gives an outline of his own"
                : $"[RacingDesk] Track map: outline of '{_currentTrackName}' from {outline.CleanLaps} clean lap{(outline.CleanLaps == 1 ? "" : "s")}" +
                  (outline.Provisional ? ", from the session being driven" : ""));
        }

        // ── Normalisation ──────────────────────────────────────────────────

        private void NormaliseAndBuild(List<TrackPoint> points)
        {
            double minX = double.MaxValue, maxX = double.MinValue;
            double minZ = double.MaxValue, maxZ = double.MinValue;

            foreach (var p in points)
            {
                if (p.WorldX < minX) minX = p.WorldX;
                if (p.WorldX > maxX) maxX = p.WorldX;
                if (p.WorldZ < minZ) minZ = p.WorldZ;
                if (p.WorldZ > maxZ) maxZ = p.WorldZ;
            }

            double rangeX = maxX - minX;
            double rangeZ = maxZ - minZ;
            if (rangeX < 0.01) rangeX = 1;
            if (rangeZ < 0.01) rangeZ = 1;

            // Uniform scale to fit in 90x90 (with 5% padding on each side)
            double scale = 90.0 / Math.Max(rangeX, rangeZ);
            double offsetX = (100.0 - rangeX * scale) / 2.0;
            double offsetZ = (100.0 - rangeZ * scale) / 2.0;

            _outline = new TrackPoint[points.Count];
            for (int i = 0; i < points.Count; i++)
            {
                _outline[i] = new TrackPoint
                {
                    X = (points[i].WorldX - minX) * scale + offsetX,
                    Y = (points[i].WorldZ - minZ) * scale + offsetZ,
                    LapDistPct = points[i].LapDistPct
                };
            }

            _svgPath = BuildSvgPath(_outline);
            _ready = true;
        }

        // ── SVG path building ──────────────────────────────────────────────

        private static string BuildSvgPath(TrackPoint[] pts)
        {
            if (pts.Length < 2) return "";

            var sb = new StringBuilder(pts.Length * 16);
            sb.Append("M ");
            sb.Append(F(pts[0].X));
            sb.Append(',');
            sb.Append(F(pts[0].Y));

            // Use Catmull-Rom → Cubic Bezier conversion for smooth curves
            for (int i = 0; i < pts.Length; i++)
            {
                int i0 = (i - 1 + pts.Length) % pts.Length;
                int i1 = i;
                int i2 = (i + 1) % pts.Length;
                int i3 = (i + 2) % pts.Length;

                double x1 = pts[i1].X + (pts[i2].X - pts[i0].X) / 6.0;
                double y1 = pts[i1].Y + (pts[i2].Y - pts[i0].Y) / 6.0;
                double x2 = pts[i2].X - (pts[i3].X - pts[i1].X) / 6.0;
                double y2 = pts[i2].Y - (pts[i3].Y - pts[i1].Y) / 6.0;

                sb.Append(" C ");
                sb.Append(F(x1)); sb.Append(','); sb.Append(F(y1));
                sb.Append(' ');
                sb.Append(F(x2)); sb.Append(','); sb.Append(F(y2));
                sb.Append(' ');
                sb.Append(F(pts[i2].X)); sb.Append(','); sb.Append(F(pts[i2].Y));
            }

            sb.Append(" Z");
            return sb.ToString();
        }

        // The map's numbers — the outline's points and control points, the other cars' places — to a hundredth of a unit.
        // A tenth was 6 m at Le Mans, where the outline is 13.5 km and 90 units across, which is more than the 5 m between
        // its points: at the iPad's following map, 30 px to a unit at its closest, the line drawn from it strayed from his
        // real one by 1 to 2 px and turned 40 to 90 degrees from one bit of it to the next ("very squiggly", 2026-10-02),
        // and a car beside him moved in 3 px steps. A hundredth keeps the line within 0.2 px of the true one there; a
        // thousandth would add another byte to every number of a path sent thirty times a second for nothing seen.
        private static string F(double v) => v.ToString("F2", CultureInfo.InvariantCulture);

        // ── Position interpolation ─────────────────────────────────────────

        private TrackPoint InterpolatePosition(double lapDistPct)
        {
            return InterpolateOnOutline(_outline, lapDistPct);
        }

        /// <summary>
        /// Where a fraction of the lap is on the outline. The outline is a loop: the segment from the last point
        /// back to the first is one of its segments, so a fraction past the last point slides on towards the line
        /// and does not hold on the last point until the fraction wraps.
        /// </summary>
        internal static (double X, double Y) InterpolateAlong(IReadOnlyList<(double X, double Y, double Pct)> outline, double lapDistPct)
        {
            var pts = new TrackPoint[outline.Count];
            for (int i = 0; i < pts.Length; i++) pts[i] = new TrackPoint { X = outline[i].X, Y = outline[i].Y, LapDistPct = outline[i].Pct };
            var p = InterpolateOnOutline(pts, lapDistPct);
            return (p.X, p.Y);
        }

        private static TrackPoint InterpolateOnOutline(TrackPoint[] outline, double lapDistPct)
        {
            if (outline == null || outline.Length < 2)
                return new TrackPoint { X = 50, Y = 50 };

            lapDistPct = lapDistPct % 1.0;
            if (lapDistPct < 0) lapDistPct += 1.0;

            int n = outline.Length;
            // Before the first point: on the closing segment, from the last point round to the first.
            if (lapDistPct < outline[0].LapDistPct)
                return OnSegment(outline[n - 1], outline[0], outline[n - 1].LapDistPct, outline[0].LapDistPct + 1.0, lapDistPct + 1.0);

            // The segment whose start is the last point at or before this fraction.
            int lo = 0, hi = n - 1;
            while (lo < hi)
            {
                int mid = (lo + hi + 1) / 2;
                if (outline[mid].LapDistPct <= lapDistPct) lo = mid;
                else hi = mid - 1;
            }
            // Past the last point: on the closing segment too.
            if (lo == n - 1)
                return OnSegment(outline[n - 1], outline[0], outline[n - 1].LapDistPct, outline[0].LapDistPct + 1.0, lapDistPct);

            return OnSegment(outline[lo], outline[lo + 1], outline[lo].LapDistPct, outline[lo + 1].LapDistPct, lapDistPct);
        }

        private static TrackPoint OnSegment(TrackPoint a, TrackPoint b, double pctA, double pctB, double pct)
        {
            double range = pctB - pctA;
            double t = range <= 0 ? 0 : (pct - pctA) / range;
            t = Math.Max(0, Math.Min(1, t));
            return new TrackPoint { X = a.X + (b.X - a.X) * t, Y = a.Y + (b.Y - a.Y) * t };
        }

        // ── Opponent data serialisation ────────────────────────────────────

        private void BuildOpponentData()
        {
            if (_opponents.Count == 0) { OpponentData = ""; return; }

            var sb = new StringBuilder(_opponents.Count * 12);
            for (int i = 0; i < _opponents.Count; i++)
            {
                if (i > 0) sb.Append(';');
                sb.Append(F(_opponents[i].X));
                sb.Append(',');
                sb.Append(F(_opponents[i].Y));
                sb.Append(',');
                sb.Append(_opponents[i].InPit ? '1' : '0');
            }
            OpponentData = sb.ToString();
        }

        // ── Demo track outline ─────────────────────────────────────────────

        private static string DemoSvgPath
        {
            get
            {
                EnsureDemoOutline();
                return _demoSvgPath;
            }
        }

        private static void EnsureDemoOutline()
        {
            if (_demoOutline != null) return;

            // The demo's circuit: 80 points of a loop, normalised to the 0–100 viewBox with 5% padding, with the
            // fraction of the lap each is at. They are Sebring International, sampled from one of the plugin's old
            // recordings (the base of this file said so), and the only trace of a real circuit still carried in the
            // code; whether to keep it for the demo or draw a made-up loop in its place is the driver's to say.
            double[][] raw = new double[][]
            {
                new[]{58.9, 71.8, 0.0481}, new[]{64.0, 72.1, 0.0596}, new[]{69.0, 72.2, 0.0708}, new[]{73.7, 71.2, 0.0805},
                new[]{76.3, 67.1, 0.0900}, new[]{77.0, 62.1, 0.1010}, new[]{76.5, 56.9, 0.1129}, new[]{75.5, 51.8, 0.1251},
                new[]{74.8, 46.5, 0.1374}, new[]{74.9, 41.3, 0.1492}, new[]{74.0, 36.4, 0.1609}, new[]{69.7, 34.5, 0.1720},
                new[]{65.0, 32.4, 0.1840}, new[]{60.3, 31.8, 0.1958}, new[]{57.3, 35.6, 0.2070}, new[]{55.0, 40.1, 0.2187},
                new[]{51.3, 44.0, 0.2311}, new[]{47.3, 46.8, 0.2424}, new[]{42.4, 49.0, 0.2546}, new[]{36.8, 50.2, 0.2679},
                new[]{30.9, 50.4, 0.2815}, new[]{24.8, 50.3, 0.2956}, new[]{18.5, 50.4, 0.3100}, new[]{12.9, 50.4, 0.3230},
                new[]{8.0, 50.4, 0.3344},  new[]{5.1, 47.3, 0.3453},  new[]{7.4, 43.0, 0.3563},  new[]{9.9, 38.7, 0.3680},
                new[]{13.9, 35.1, 0.3804}, new[]{18.8, 32.8, 0.3929}, new[]{23.9, 30.9, 0.4055}, new[]{28.7, 28.9, 0.4176},
                new[]{32.5, 26.2, 0.4284}, new[]{36.0, 22.9, 0.4395}, new[]{39.4, 19.5, 0.4504}, new[]{43.1, 15.7, 0.4628},
                new[]{47.0, 12.7, 0.4743}, new[]{50.9, 14.8, 0.4852}, new[]{54.6, 18.0, 0.4965}, new[]{59.3, 19.2, 0.5079},
                new[]{64.5, 17.8, 0.5203}, new[]{69.0, 16.0, 0.5313}, new[]{73.9, 15.5, 0.5427}, new[]{79.1, 15.5, 0.5549},
                new[]{82.2, 19.0, 0.5662}, new[]{82.1, 24.0, 0.5776}, new[]{81.9, 29.6, 0.5905}, new[]{81.8, 34.5, 0.6018},
                new[]{81.6, 39.5, 0.6133}, new[]{81.3, 44.2, 0.6242}, new[]{81.6, 49.0, 0.6352}, new[]{83.4, 53.7, 0.6467},
                new[]{86.2, 58.4, 0.6592}, new[]{90.2, 62.4, 0.6724}, new[]{93.8, 66.5, 0.6850}, new[]{94.9, 71.1, 0.6958},
                new[]{92.4, 75.4, 0.7070}, new[]{91.2, 80.4, 0.7188}, new[]{89.6, 85.4, 0.7313}, new[]{85.3, 87.4, 0.7422},
                new[]{80.4, 87.0, 0.7535}, new[]{75.1, 86.7, 0.7658}, new[]{70.2, 86.9, 0.7771}, new[]{64.8, 86.9, 0.7894},
                new[]{59.1, 86.8, 0.8027}, new[]{53.1, 86.8, 0.8164}, new[]{46.9, 86.7, 0.8310}, new[]{40.8, 86.8, 0.8448},
                new[]{35.6, 86.8, 0.8569}, new[]{30.4, 86.7, 0.8688}, new[]{25.6, 86.7, 0.8801}, new[]{20.1, 86.5, 0.8929},
                new[]{15.3, 84.8, 0.9043}, new[]{11.4, 81.5, 0.9161}, new[]{10.1, 76.7, 0.9280}, new[]{12.3, 72.5, 0.9391},
                new[]{17.0, 70.8, 0.9508}, new[]{22.1, 70.1, 0.9629}, new[]{27.0, 70.0, 0.9743}, new[]{32.3, 70.2, 0.9866},
            };

            _demoOutline = new TrackPoint[raw.Length];
            for (int i = 0; i < raw.Length; i++)
            {
                _demoOutline[i] = new TrackPoint
                {
                    X = raw[i][0],
                    Y = raw[i][1],
                    LapDistPct = raw[i][2]
                };
            }

            _demoSvgPath = BuildSvgPath(_demoOutline);
        }

        // ── Data types ─────────────────────────────────────────────────────

        private struct TrackPoint
        {
            public double WorldX, WorldZ;  // the outline's own metres
            public double X, Y;            // normalised SVG coordinates (0–100)
            public double LapDistPct;      // 0.0–1.0 fraction around the lap
        }

        private struct OpponentPos
        {
            public double X, Y;
            public bool InPit;
        }
    }
}
