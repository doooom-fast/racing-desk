using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using IRSDKSharper;
using RacingDesk.Plugin.IRacing;

namespace RacingDesk.Data
{
    /// <summary>
    /// Turns a stream of iRacing telemetry frames into session, lap, incident and grid records. The same code
    /// runs over a recorded .ibt (backfill) and over live frames (capture), so both produce identical rows.
    /// </summary>
    public sealed class SessionAccumulator
    {
        private const int OffTrack = 0;          // irsdk_TrkLoc
        private const int InPitStall = 1;
        private const int RacingState = 4;       // irsdk_SessionState.Racing
        private const double LapTimeSettleSeconds = 3.0;
        private const int MaxIncidentPoints = 25;
        private const float MaxLapSeconds = 3600;

        private readonly string _source;
        private readonly string _ibtPath;
        private readonly Func<double, DateTime> _clock;

        private SessionRecord _cur;
        private IRacingSdkSessionInfo _lastInfo;
        private double _firstTime, _lastTime;
        private int _lastLapCompleted = -1;
        private int _lastIncidents;
        private float _lastBestLap;
        private int _lastPosition;
        private LapInProgress _lap;
        private PendingLap _pending;

        /// <param name="source">"ibt" or "live".</param>
        /// <param name="ibtPath">Source file, for idempotent re-ingest (null for live).</param>
        /// <param name="clock">Maps SessionTime (s) to wall-clock UTC.</param>
        public SessionAccumulator(string source, string ibtPath, Func<double, DateTime> clock)
        {
            _source = source;
            _ibtPath = ibtPath;
            _clock = clock;
        }

        /// <summary>Feeds one frame. Returns a finished session when this frame starts a new one.</summary>
        public SessionRecord Feed(IRawTelemetry raw)
        {
            if (!raw.IsConnected) return null;
            var info = raw.SessionInfo;
            if (info == null) return null;

            int sessionNum = I(raw, "SessionNum");
            double t = D(raw, "SessionTime");
            // Corrupt frames carry garbage; only accept a session the YAML knows about at a sane time.
            if (double.IsNaN(t) || double.IsInfinity(t) || t < 0) return null;
            var known = info.SessionInfo?.Sessions;
            if (known != null && known.Count > 0 && !known.Any(x => x.SessionNum == sessionNum)) return null;
            SessionRecord finished = null;
            if (_cur == null || sessionNum != _cur.SessionNum || t < _lastTime - 1)
            {
                finished = Finish();
                Begin(sessionNum, t);
            }
            _lastInfo = info;
            _lastTime = t;

            int lapCompleted = I(raw, "LapCompleted");
            int incidents = I(raw, "PlayerCarMyIncidentCount");
            float lastLap = F(raw, "LapLastLapTime");
            float fuel = F(raw, "FuelLevel");
            bool onPit = B(raw, "OnPitRoad");
            int surface = I(raw, "PlayerTrackSurface");
            int position = I(raw, "PlayerCarPosition");
            int state = I(raw, "SessionState");

            if (_cur.StartPosition == 0 && state == RacingState && position > 0) _cur.StartPosition = position;
            if (position > 0) _lastPosition = position;
            float best = F(raw, "LapBestLapTime");
            if (best > 0 && best < MaxLapSeconds) _lastBestLap = best;

            // A lap posted at the line may get its official time a few frames later.
            if (_pending != null && (lastLap != _pending.LastLapAtCrossing || t - _pending.CrossedAt >= LapTimeSettleSeconds))
            {
                if (lastLap >= MinLapSeconds(info) && lastLap < MaxLapSeconds) _pending.Record.LapTimeSeconds = lastLap;
                _pending = null;
            }

            if (_lap == null)
            {
                // A capture can begin mid-lap (rejoining a race writes a new .ibt): only iRacing's own lap time
                // is trustworthy for that lap, and it's an out lap only if the car starts in the pits.
                _lap = new LapInProgress(t, fuel, outLap: onPit || surface == InPitStall, startObserved: false);
                _lastLapCompleted = lapCompleted;
                _lastIncidents = incidents;
            }

            // Corrupt frames can carry garbage counters; a real incident is at most a few points.
            if (incidents > _lastIncidents && incidents - _lastIncidents <= MaxIncidentPoints)
            {
                int points = incidents - _lastIncidents;
                _cur.IncidentEvents.Add(new IncidentRecord { SessionTime = t, Lap = I(raw, "Lap"), LapDistPct = F(raw, "LapDistPct"), Points = points });
                _lap.Incidents += points;
                _lap.Dirty = true;
            }
            if (incidents >= _lastIncidents && incidents - _lastIncidents <= MaxIncidentPoints) _lastIncidents = incidents;
            if (surface == OffTrack) _lap.Dirty = true;
            if (onPit) { _lap.Pitted = true; _lap.Dirty = true; }

            if (lapCompleted > _lastLapCompleted && _lastLapCompleted >= 0)
            {
                var rec = new LapRecord
                {
                    Lap = lapCompleted,
                    LapTimeSeconds = _lap.StartObserved ? t - _lap.StartTime : 0,
                    Clean = !_lap.Dirty && !_lap.OutLap && _lap.StartObserved,
                    Incidents = _lap.Incidents,
                    FuelUsedLiters = _lap.StartObserved ? Math.Max(0, _lap.StartFuel - fuel) : 0,
                    Pitted = _lap.Pitted,
                    StartSessionTime = _lap.StartTime,
                    Position = position,
                    OutLap = _lap.OutLap,
                };
                _cur.Laps.Add(rec);
                _pending = new PendingLap { Record = rec, CrossedAt = t, LastLapAtCrossing = lastLap };
                _lap = new LapInProgress(t, fuel, outLap: false, startObserved: true) { Pitted = onPit, Dirty = onPit };
            }
            else if (lapCompleted >= 0 && _lastLapCompleted < 0)
            {
                // Before a race start iRacing reports -1 laps completed; the count starting is lap 1 starting.
                _lap = new LapInProgress(t, fuel, outLap: false, startObserved: true);
            }
            else if (lapCompleted >= 0 && lapCompleted < _lastLapCompleted)
            {
                _lap = new LapInProgress(t, fuel, outLap: true, startObserved: false); // reset / tow
            }
            _lastLapCompleted = lapCompleted;
            return finished;
        }

        /// <summary>The session in progress, or null.</summary>
        public SessionRecord Current => _cur;

        /// <summary>A completed copy of the session in progress, without ending it (for checkpoints).</summary>
        public SessionRecord Snapshot()
        {
            if (_cur == null) return null;
            var s = new SessionRecord
            {
                Source = _cur.Source, IbtPath = _cur.IbtPath, SessionNum = _cur.SessionNum,
                StartedAtUtc = _cur.StartedAtUtc, StartPosition = _cur.StartPosition,
            };
            s.Laps.AddRange(_cur.Laps);
            s.IncidentEvents.AddRange(_cur.IncidentEvents);
            Complete(s);
            return s;
        }

        /// <summary>Closes and returns the session in progress (null if none).</summary>
        public SessionRecord Finish()
        {
            var s = _cur;
            if (s == null) return null;
            _cur = null;
            if (_pending != null) _pending = null;

            Complete(s);

            _lap = null;
            _lastLapCompleted = -1;
            _lastIncidents = 0;
            _lastBestLap = 0;
            _lastPosition = 0;
            return s;
        }

        private void Complete(SessionRecord s)
        {
            s.DurationSeconds = Math.Max(0, _lastTime - _firstTime);
            // Per capture, not iRacing's session-cumulative counters: one session driven across several .ibt
            // files (leaving and re-entering the car) must not count the same laps and incidents twice.
            ApplySessionInfo(s, _lastInfo);
            // A lap "completed" right after a reset or tow can carry a time of a fraction of a second.
            double minLap = MinLapSeconds(_lastInfo);
            foreach (var lap in s.Laps)
                if (lap.LapTimeSeconds < minLap || lap.LapTimeSeconds >= MaxLapSeconds) lap.LapTimeSeconds = 0;
            s.LapsCompleted = s.Laps.Count;
            s.Incidents = s.IncidentEvents.Sum(i => i.Points);
            // Best lap: iRacing's results table, then its running best, then our own laps. Incidents don't
            // disqualify a lap (race laps rarely count as clean); out laps and pit laps do.
            double resultsBest = s.Grid.Where(g => g.IsPlayer).Select(g => g.FastestLapSeconds).DefaultIfEmpty(0).First();
            double ownBest = s.Laps.Where(l => !l.OutLap && !l.Pitted && l.LapTimeSeconds > 0).Select(l => l.LapTimeSeconds).DefaultIfEmpty(0).Min();
            s.BestLapSeconds = resultsBest >= minLap ? resultsBest : _lastBestLap >= minLap ? _lastBestLap : ownBest;
            if (s.FinishPosition == 0 && IsRace(s)) s.FinishPosition = _lastPosition;
        }

        private void Begin(int sessionNum, double t)
        {
            _cur = new SessionRecord { Source = _source, IbtPath = _ibtPath, SessionNum = sessionNum, StartedAtUtc = _clock(t) };
            _firstTime = t;
            _lastTime = t;
            _lap = null;
            _pending = null;
        }

        /// <summary>Nothing laps a kilometre in under ten seconds.</summary>
        private static double MinLapSeconds(IRacingSdkSessionInfo info) =>
            Math.Max(10, ParseKm(info?.WeekendInfo?.TrackLength) * 10);

        private static bool IsRace(SessionRecord s) => string.Equals(s.SessionType, "Race", StringComparison.OrdinalIgnoreCase);

        internal static void ApplySessionInfo(SessionRecord s, IRacingSdkSessionInfo info)
        {
            if (info == null) return;
            var w = info.WeekendInfo;
            if (w != null)
            {
                s.SubsessionId = w.SubSessionID;
                s.SessionId = w.SessionID;
                s.SeriesId = w.SeriesID;
                s.SeasonId = w.SeasonID;
                s.RaceWeek = w.RaceWeek;
                s.EventType = w.EventType;
                s.Category = w.Category;
                s.Official = w.Official != 0;
                s.TrackId = w.TrackID;
                s.TrackName = w.TrackName;
                s.TrackDisplayName = w.TrackDisplayName;
                s.TrackConfig = w.TrackConfigName;
                s.TrackLengthKm = ParseKm(w.TrackLength);
            }

            var session = info.SessionInfo?.Sessions?.FirstOrDefault(x => x.SessionNum == s.SessionNum);
            s.SessionType = session?.SessionType ?? s.SessionType;

            var di = info.DriverInfo;
            var drivers = di?.Drivers ?? new List<IRacingSdkSessionInfo.DriverInfoModel.DriverModel>();
            // Who he is: the entry that is him (his customer id, DriverUserID) in his car, else his entry wherever it is, else
            // the entry for his car. In a team race the entry for his car may be a teammate's, and neither his customer id
            // nor the grid's is_player flag may go to a teammate: the store tells him from the others by them.
            var me = (di != null && di.DriverUserID > 0
                    ? drivers.FirstOrDefault(d => d.UserID == di.DriverUserID && d.CarIdx == di.DriverCarIdx)
                      ?? drivers.FirstOrDefault(d => d.UserID == di.DriverUserID)
                    : null)
                ?? drivers.FirstOrDefault(d => di != null && d.CarIdx == di.DriverCarIdx);
            if (me != null)
            {
                s.DriverCustId = di.DriverUserID > 0 ? di.DriverUserID : me.UserID;
                s.DriverName = me.UserName;
                s.IRating = me.IRating;
                s.License = me.LicString;
                s.SafetyRating = IRacingTelemetrySourceSafety(me.LicString);
                s.CarPath = me.CarPath;
                s.CarId = me.CarID;
                s.CarScreenName = me.CarScreenName;
                s.CarClassId = me.CarClassID;
            }

            var results = (session?.ResultsPositions ?? new List<IRacingSdkSessionInfo.SessionInfoModel.SessionModel.PositionModel>())
                .ToDictionary(r => r.CarIdx, r => r);

            s.Grid.Clear();
            foreach (var d in drivers)
            {
                if (d.IsSpectator != 0 || d.CarIsPaceCar != 0) continue;
                results.TryGetValue(d.CarIdx, out var r);
                s.Grid.Add(new GridEntryRecord
                {
                    CarIdx = d.CarIdx,
                    CustId = d.UserID,
                    Name = d.UserName,
                    IRating = d.IRating,
                    License = d.LicString,
                    CarClassId = d.CarClassID,
                    CarScreenName = d.CarScreenName,
                    FinishPosition = r?.Position ?? 0,
                    ClassPosition = r != null ? r.ClassPosition + 1 : 0,
                    LapsComplete = r?.LapsComplete ?? 0,
                    FastestLapSeconds = r != null && r.FastestTime > 0 ? r.FastestTime : 0,
                    Incidents = r?.Incidents ?? 0,
                    ReasonOut = r?.ReasonOutStr,
                    IsPlayer = me != null && ReferenceEquals(d, me),
                });
                if (me != null && d.CarIdx == me.CarIdx && r != null)
                {
                    s.FinishPosition = r.Position;
                    s.FinishPositionInClass = r.ClassPosition + 1;
                }
            }

            s.Cars.Clear();
            s.Cars.AddRange(CarRecord.Distinct(SessionInfoYaml.DriverCars(info)));

            var field = w != null && w.NumCarClasses > 1 && me != null
                ? s.Grid.Where(g => g.CarClassId == me.CarClassID).ToList()
                : s.Grid;
            s.FieldSize = field.Count;
            s.StrengthOfField = StrengthOfField(field.Select(g => g.IRating));
        }

        /// <summary>iRacing's strength-of-field estimate over the ratings in a split / class.</summary>
        internal static int StrengthOfField(IEnumerable<int> ratings)
        {
            var rs = ratings.Where(r => r > 1).ToList(); // unrated / AI entries report 0 or 1
            if (rs.Count == 0) return 0;
            double k = 1600.0 / Math.Log(2);
            double sum = rs.Sum(r => Math.Exp(-r / k));
            return (int)Math.Round(k * Math.Log(rs.Count / sum));
        }

        private static double IRacingTelemetrySourceSafety(string lic)
        {
            if (string.IsNullOrEmpty(lic)) return 0;
            int space = lic.IndexOf(' ');
            return double.TryParse(space >= 0 ? lic.Substring(space + 1) : lic, NumberStyles.Float, CultureInfo.InvariantCulture, out double sr) ? sr : 0;
        }

        private static double ParseKm(string s)
        {
            if (string.IsNullOrEmpty(s)) return 0;
            var num = s.Split(' ')[0];
            return double.TryParse(num, NumberStyles.Float, CultureInfo.InvariantCulture, out double km) ? km : 0;
        }

        private static int I(IRawTelemetry r, string n) { var v = r.GetValue(n); return v is int i ? i : v is bool b ? (b ? 1 : 0) : 0; }
        private static float F(IRawTelemetry r, string n) { var v = r.GetValue(n); return v is float f ? f : v is double d ? (float)d : 0f; }
        private static double D(IRawTelemetry r, string n) { var v = r.GetValue(n); return v is double d ? d : v is float f ? f : 0.0; }
        private static bool B(IRawTelemetry r, string n) { var v = r.GetValue(n); return v is bool b ? b : v is int i && i != 0; }

        private sealed class LapInProgress
        {
            public LapInProgress(double startTime, double startFuel, bool outLap, bool startObserved)
            {
                StartTime = startTime;
                StartFuel = startFuel;
                OutLap = outLap;
                StartObserved = startObserved;
            }
            /// <summary>The lap began at the line while we were watching, so its measured time is whole.</summary>
            public bool StartObserved { get; }
            public double StartTime { get; }
            public double StartFuel { get; }
            public bool OutLap { get; }
            public bool Dirty { get; set; }
            public bool Pitted { get; set; }
            public int Incidents { get; set; }
        }

        private sealed class PendingLap
        {
            public LapRecord Record;
            public double CrossedAt;
            public float LastLapAtCrossing;
        }
    }
}
