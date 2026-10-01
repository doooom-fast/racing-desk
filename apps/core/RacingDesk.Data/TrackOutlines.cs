using System;
using System.Collections.Concurrent;
using System.IO;
using RacingDesk.Plugin.Engine;

namespace RacingDesk.Data
{
    /// <summary>
    /// Serves the host's track outlines, by the sim's TrackID: the store's whole outline, else the one being made
    /// from the session he is driving (<see cref="Live"/>, the follower's), else the store's provisional one — and
    /// with none of his own, SimHub's shared map of the layout (<see cref="Crowd"/>), the interim until his first
    /// clean lap. A found outline is kept for a minute before the store is asked again (it may have gained laps); a
    /// miss is asked again after five seconds, so a layout whose first file has just been ingested is not missed for
    /// the rest of the run, and the shared map gives way within seconds of the follower's first outline.
    /// </summary>
    public sealed class TrackOutlines
    {
        private static readonly TimeSpan HitFor = TimeSpan.FromSeconds(60);
        private static readonly TimeSpan MissFor = TimeSpan.FromSeconds(5);

        private readonly string _dbPath;
        private readonly Func<DateTime> _now;
        private readonly ConcurrentDictionary<int, (TrackOutline Outline, DateTime At)> _looked =
            new ConcurrentDictionary<int, (TrackOutline, DateTime)>();

        public TrackOutlines(string dbPath, Func<DateTime> now = null)
        {
            _dbPath = dbPath;
            _now = now ?? (() => DateTime.UtcNow);
        }

        /// <summary>The outline of the session being driven, when there is one: consulted before the store.</summary>
        public Func<int, TrackOutline> Live { get; set; }

        /// <summary>
        /// SimHub's shared map of the layout being driven (<see cref="CrowdMaps.Current"/>): consulted last, only
        /// while there is no outline of his own at all, so that his own always wins.
        /// </summary>
        public Func<int, TrackOutline> Crowd { get; set; }

        public TrackOutline ForTrack(int trackId)
        {
            if (trackId <= 0) return null;
            var stored = FromStore(trackId);
            if (stored != null && !stored.Provisional) return stored;
            TrackOutline live = null;
            try { live = Live?.Invoke(trackId); } catch { /* the follower said nothing */ }
            if (live != null || stored != null) return live ?? stored;
            try { return Crowd?.Invoke(trackId); } catch { return null; }
        }

        /// <summary>Forgets what was looked up for a layout, so the next ask reads the store.</summary>
        public void Forget(int trackId) => _looked.TryRemove(trackId, out _);

        private TrackOutline FromStore(int trackId)
        {
            var now = _now();
            if (_looked.TryGetValue(trackId, out var seen) && now - seen.At < (seen.Outline != null ? HitFor : MissFor))
                return seen.Outline;
            TrackOutline outline = null;
            try
            {
                if (File.Exists(_dbPath))
                {
                    using var store = RacingDeskStore.OpenReadOnly(_dbPath);
                    outline = ToOutline(store.GetGeometry(trackId));
                }
            }
            catch
            {
                outline = null;
            }
            _looked[trackId] = (outline, now);
            return outline;
        }

        /// <summary>A stored record as the map takes it: X east, Z south (so an SVG comes out north-up), the fraction of the lap.</summary>
        public static TrackOutline ToOutline(TrackGeometryRecord g)
        {
            if (g?.Points == null || g.Points.Length < 30) return null;
            int bins = g.Points.Length / 3;
            var points = new (double X, double Z, double Pct)[bins];
            for (int b = 0; b < bins; b++)
                points[b] = (g.Points[b * 3], -g.Points[b * 3 + 1], (double)b / bins);
            return new TrackOutline
            {
                TrackId = g.TrackId,
                CleanLaps = g.CleanLaps,
                LengthMeters = g.LengthMeters,
                OfficialLengthMeters = g.OfficialLengthMeters,
                Provisional = g.Provisional,
                UpdatedAtUtc = g.UpdatedAtUtc,
                Points = points,
            };
        }
    }
}
