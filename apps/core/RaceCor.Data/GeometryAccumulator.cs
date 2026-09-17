using System;
using System.Collections.Generic;
using System.Linq;
using RaceCorProDrive.Plugin.IRacing;

namespace RaceCor.Data
{
    /// <summary>
    /// Derives a track outline from Lat/Lon/Alt in disk telemetry: keep clean laps, resample each into
    /// LapDistPct bins of ~5 m, average across laps, project to local metres. Validated in Phase 0 to within
    /// 0.01–0.28% of iRacing's official track length.
    /// </summary>
    public sealed class GeometryAccumulator
    {
        private const int OnTrack = 3;
        private const int MaxOffTrackFrames = 6;   // tolerate brief surface flickers
        private const double EarthRadius = 6371008.8;

        private readonly int _bins;
        private readonly double[] _lat, _lon, _alt;
        private readonly List<Sample> _lapSamples = new List<Sample>(8000);
        private int _currentLap = int.MinValue;
        private bool _lapPitted;
        private int _lapOffTrack;

        public int TrackId { get; }
        public string TrackName { get; }
        public double OfficialLengthMeters { get; }
        public int CleanLaps { get; private set; }

        public GeometryAccumulator(int trackId, string trackName, double officialLengthMeters)
        {
            TrackId = trackId;
            TrackName = trackName;
            OfficialLengthMeters = officialLengthMeters;
            _bins = Math.Max(1000, (int)Math.Round(officialLengthMeters / 5.0));
            _lat = new double[_bins];
            _lon = new double[_bins];
            _alt = new double[_bins];
        }

        public void Feed(IRawTelemetry raw)
        {
            if (raw.GetValue("Lat") is not double lat || raw.GetValue("Lon") is not double lon) return;
            int lap = raw.GetValue("Lap") is int l ? l : 0;
            if (lap != _currentLap)
            {
                CloseLap();
                _currentLap = lap;
                _lapPitted = false;
                _lapOffTrack = 0;
            }
            if (raw.GetValue("OnPitRoad") is bool pit && pit) _lapPitted = true;
            if (!(raw.GetValue("PlayerTrackSurface") is int surface) || surface != OnTrack) _lapOffTrack++;
            float pct = raw.GetValue("LapDistPct") is float p ? p : -1;
            float alt = raw.GetValue("Alt") is float a ? a : 0;
            if (pct < 0 || (lat == 0 && lon == 0)) return;
            _lapSamples.Add(new Sample(pct, lat, lon, alt));
        }

        /// <summary>The averaged outline, or null if no clean lap was seen.</summary>
        public TrackGeometryRecord Result(string sourceIbt, double[] sectorStartPcts)
        {
            CloseLap();
            if (CleanLaps == 0) return null;

            double lat0 = _lat[0] / CleanLaps, lon0 = _lon[0] / CleanLaps;
            double kx = Math.Cos(lat0 * Math.PI / 180) * EarthRadius * Math.PI / 180;
            double ky = EarthRadius * Math.PI / 180;
            var points = new float[_bins * 3];
            double length = 0, px = 0, py = 0;
            for (int b = 0; b < _bins; b++)
            {
                double x = (_lon[b] / CleanLaps - lon0) * kx;
                double y = (_lat[b] / CleanLaps - lat0) * ky;
                points[b * 3] = (float)x;
                points[b * 3 + 1] = (float)y;
                points[b * 3 + 2] = (float)(_alt[b] / CleanLaps);
                if (b > 0) length += Math.Sqrt((x - px) * (x - px) + (y - py) * (y - py));
                px = x; py = y;
            }
            length += Math.Sqrt(px * px + py * py); // close the loop back to bin 0

            return new TrackGeometryRecord
            {
                TrackId = TrackId,
                TrackName = TrackName,
                LengthMeters = length,
                OfficialLengthMeters = OfficialLengthMeters,
                CleanLaps = CleanLaps,
                SourceIbt = sourceIbt,
                OriginLat = lat0,
                OriginLon = lon0,
                Points = points,
                SectorStartPcts = sectorStartPcts ?? Array.Empty<double>(),
                UpdatedAtUtc = DateTime.UtcNow,
            };
        }

        private void CloseLap()
        {
            var ss = _lapSamples;
            try
            {
                if (ss.Count < 200 || _lapPitted || _lapOffTrack > MaxOffTrackFrames) return;
                if (ss[0].Pct > 0.01 || ss[ss.Count - 1].Pct < 0.99) return;
                int backward = 0;
                for (int i = 1; i < ss.Count; i++) if (ss[i].Pct < ss[i - 1].Pct - 1e-4) backward++;
                if (backward > 2) return;

                int j = 0;
                for (int b = 0; b < _bins; b++)
                {
                    double target = (double)b / _bins;
                    while (j < ss.Count - 2 && ss[j + 1].Pct < target) j++;
                    var s0 = ss[j];
                    var s1 = ss[j + 1];
                    double span = s1.Pct - s0.Pct;
                    double f = span <= 0 ? 0 : Math.Clamp((target - s0.Pct) / span, 0, 1);
                    _lat[b] += s0.Lat + (s1.Lat - s0.Lat) * f;
                    _lon[b] += s0.Lon + (s1.Lon - s0.Lon) * f;
                    _alt[b] += s0.Alt + (s1.Alt - s0.Alt) * f;
                }
                CleanLaps++;
            }
            finally
            {
                ss.Clear();
            }
        }

        private readonly struct Sample
        {
            public Sample(float pct, double lat, double lon, float alt) { Pct = pct; Lat = lat; Lon = lon; Alt = alt; }
            public float Pct { get; }
            public double Lat { get; }
            public double Lon { get; }
            public float Alt { get; }
        }
    }
}
