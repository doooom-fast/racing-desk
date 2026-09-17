using System;
using System.Collections.Concurrent;
using System.Collections.Generic;

namespace RaceCor.Data
{
    /// <summary>
    /// Serves stored track outlines to the runtime's track map as (X east, Z, LapDistPct). Z is south so the
    /// map's SVG (y grows downward) renders north-up. Lookups are cached per track name; missing tracks are
    /// cached too, so the store is queried at most once per track per run.
    /// </summary>
    public sealed class TrackOutlines
    {
        private readonly string _dbPath;
        private readonly ConcurrentDictionary<string, IReadOnlyList<(double X, double Z, double Pct)>> _cache =
            new ConcurrentDictionary<string, IReadOnlyList<(double X, double Z, double Pct)>>(StringComparer.OrdinalIgnoreCase);

        public TrackOutlines(string dbPath) => _dbPath = dbPath;

        public IReadOnlyList<(double X, double Z, double Pct)> ForTrack(string trackName)
        {
            if (string.IsNullOrEmpty(trackName)) return null;
            return _cache.GetOrAdd(trackName, name =>
            {
                try
                {
                    using var store = new ProDriveStore(_dbPath);
                    return ToOutline(store.GetGeometryByTrackName(name));
                }
                catch
                {
                    return null;
                }
            });
        }

        public static IReadOnlyList<(double X, double Z, double Pct)> ToOutline(TrackGeometryRecord g)
        {
            if (g?.Points == null || g.Points.Length < 30) return null;
            int bins = g.Points.Length / 3;
            var outline = new (double X, double Z, double Pct)[bins];
            for (int b = 0; b < bins; b++)
                outline[b] = (g.Points[b * 3], -g.Points[b * 3 + 1], (double)b / bins);
            return outline;
        }
    }
}
