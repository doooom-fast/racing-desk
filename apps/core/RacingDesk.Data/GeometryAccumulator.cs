using System;
using System.Collections.Generic;
using System.Linq;
using RacingDesk.Plugin.IRacing;

namespace RacingDesk.Data
{
    /// <summary>
    /// Derives a track outline from Lat/Lon/Alt in disk telemetry: keeps the laps that are whole and clean, resamples
    /// each into LapDistPct bins of about 5 m, averages the laps that agree with each other, and projects the mean
    /// to local metres. Phase 0 found an outline made this way within 0.01–0.28% of the YAML TrackLength; the
    /// length is a warning and never a gate (Okayama's YAML is 4% out, and a GPS lap cannot be wrong in scale).
    ///
    /// A lap is in only when it is whole: from the line to the line, never on pit road, on the track surface but
    /// for a few frames, with a position at every sample, never slower than walking pace after its first second (a
    /// stop, a spin to a halt, a tow), with no step between samples a car could not have driven (a reset), closed
    /// (its two ends as near as their fractions of the lap say), and in agreement with the laps already in: a
    /// rescan, or iRacing's north fix, moves a layout's Lat/Lon between files that share a name, and those laps are
    /// never averaged together.
    /// </summary>
    public sealed class GeometryAccumulator
    {
        /// <summary>The checks an outline was built with. A stored outline built with fewer is built again.</summary>
        public const int ChecksVersion = 1;

        private const int OnTrack = 3;
        private const int MaxOffTrackFrames = 6;   // tolerate brief surface flickers
        private const double EarthRadius = 6371008.8;

        /// <summary>Under this, after the lap's first second, the car stopped: a spin to a halt, a tow, a reset.</summary>
        public const double MinSpeedMs = 3.0;
        /// <summary>A step between consecutive samples no car drove: a reset or a tow.</summary>
        public const double MaxStepMeters = 15.0;
        /// <summary>The lap's two ends may be this far apart beyond what their fractions of the lap say.</summary>
        public const double CloseGapMeters = 10.0;
        /// <summary>A lap agrees with the laps before it when it is within these of their mean, bin by bin.</summary>
        public const double AgreeMedianMeters = 8.0;
        public const double AgreeP95Meters = 25.0;
        /// <summary>Past this, the YAML's length and the outline's are said to differ. Said, not acted on.</summary>
        public const double LengthWarnFraction = 0.01;

        private readonly int _bins;
        private readonly double[] _x, _y, _z;     // sums, metres from the origin
        private double _weight;                     // laps summed: this run's, and the record merged into
        private bool _hasOrigin;
        private double _lat0, _lon0, _kx, _ky;

        private readonly List<Sample> _lapSamples = new List<Sample>(8000);
        private int _currentLap = int.MinValue;
        private bool _lapPitted, _lapNoPosition;
        private int _lapOffTrack;
        private readonly Dictionary<string, int> _rejected = new Dictionary<string, int>(StringComparer.Ordinal);

        public int TrackId { get; }
        public string TrackName { get; }
        public double OfficialLengthMeters { get; }

        /// <summary>Clean laps this accumulator was fed; the record merged into is not counted here.</summary>
        public int CleanLaps { get; private set; }

        /// <summary>Laps that were not whole or clean, by what put them out: for the log, never for the HUD.</summary>
        public IReadOnlyDictionary<string, int> Rejected => _rejected;

        /// <summary>Set by <see cref="Result"/> when the outline's length and the YAML's differ by more than a hundredth.</summary>
        public string LengthWarning { get; private set; }

        /// <param name="mergeInto">An outline already kept for the layout: its laps are in the average, in its frame.</param>
        public GeometryAccumulator(int trackId, string trackName, double officialLengthMeters, TrackGeometryRecord mergeInto = null)
        {
            TrackId = trackId;
            TrackName = trackName;
            OfficialLengthMeters = officialLengthMeters;
            _bins = BinsFor(officialLengthMeters);
            _x = new double[_bins];
            _y = new double[_bins];
            _z = new double[_bins];
            if (mergeInto?.Points != null && mergeInto.CleanLaps > 0)
            {
                SetOrigin(mergeInto.OriginLat, mergeInto.OriginLon);
                var points = Resampled(mergeInto, _bins);
                for (int b = 0; b < _bins; b++)
                {
                    _x[b] = points[b * 3] * mergeInto.CleanLaps;
                    _y[b] = points[b * 3 + 1] * mergeInto.CleanLaps;
                    _z[b] = points[b * 3 + 2] * mergeInto.CleanLaps;
                }
                _weight = mergeInto.CleanLaps;
            }
        }

        public static int BinsFor(double lengthMeters) => Math.Max(1000, (int)Math.Round(lengthMeters / 5.0));

        public void Feed(IRawTelemetry raw)
        {
            if (!(raw.GetValue("Lat") is double lat) || !(raw.GetValue("Lon") is double lon)) return;
            int lap = raw.GetValue("Lap") is int l ? l : 0;
            if (lap != _currentLap)
            {
                CloseLap();
                _currentLap = lap;
                _lapPitted = false;
                _lapNoPosition = false;
                _lapOffTrack = 0;
            }
            if (raw.GetValue("OnPitRoad") is bool pit && pit) _lapPitted = true;
            if (!(raw.GetValue("PlayerTrackSurface") is int surface) || surface != OnTrack) _lapOffTrack++;
            // A sample with no position is not skipped: the lap is not whole, and is out.
            if (lat == 0 && lon == 0) _lapNoPosition = true;
            float pct = raw.GetValue("LapDistPct") is float p ? p : -1;
            if (pct < 0) return;
            float alt = raw.GetValue("Alt") is float a ? a : 0;
            float speed = raw.GetValue("Speed") is float s ? s : float.NaN;
            double t = raw.GetValue("SessionTime") is double st ? st : double.NaN;
            _lapSamples.Add(new Sample(pct, lat, lon, alt, speed, t));
        }

        /// <summary>
        /// The averaged outline, or null when no clean lap was seen (and nothing was merged into). The length is
        /// compared with the YAML's and the difference noted in <see cref="LengthWarning"/>; the outline is kept
        /// either way.
        /// </summary>
        public TrackGeometryRecord Result(string sourceIbt, double[] sectorStartPcts, bool provisional = false)
        {
            CloseLap();
            if (CleanLaps == 0 || _weight <= 0) return null;

            var points = new float[_bins * 3];
            double length = 0, px = 0, py = 0;
            for (int b = 0; b < _bins; b++)
            {
                double x = _x[b] / _weight, y = _y[b] / _weight;
                points[b * 3] = (float)x;
                points[b * 3 + 1] = (float)y;
                points[b * 3 + 2] = (float)(_z[b] / _weight);
                if (b > 0) length += Math.Sqrt((x - px) * (x - px) + (y - py) * (y - py));
                px = x; py = y;
            }
            length += Math.Sqrt((px - points[0]) * (px - points[0]) + (py - points[1]) * (py - points[1])); // close the loop

            LengthWarning = null;
            if (OfficialLengthMeters > 0 && Math.Abs(length - OfficialLengthMeters) / OfficialLengthMeters > LengthWarnFraction)
                LengthWarning = string.Format(System.Globalization.CultureInfo.InvariantCulture,
                    "outline {0:F0} m, the session says {1:F0} m ({2:+0.0;-0.0}%)", length, OfficialLengthMeters, (length - OfficialLengthMeters) / OfficialLengthMeters * 100);

            return new TrackGeometryRecord
            {
                TrackId = TrackId,
                TrackName = TrackName,
                LengthMeters = length,
                OfficialLengthMeters = OfficialLengthMeters,
                CleanLaps = (int)Math.Round(_weight),
                SourceIbt = sourceIbt,
                OriginLat = _lat0,
                OriginLon = _lon0,
                Points = points,
                SectorStartPcts = sectorStartPcts ?? Array.Empty<double>(),
                UpdatedAtUtc = DateTime.UtcNow,
                Checks = ChecksVersion,
                Provisional = provisional,
            };
        }

        private void Reject(string why)
        {
            _rejected.TryGetValue(why, out int n);
            _rejected[why] = n + 1;
        }

        private void CloseLap()
        {
            var ss = _lapSamples;
            try
            {
                if (ss.Count < 200) { if (ss.Count > 0) Reject("short"); return; }
                if (_lapPitted) { Reject("pit road"); return; }
                if (_lapOffTrack > MaxOffTrackFrames) { Reject("off track"); return; }
                if (_lapNoPosition) { Reject("no position"); return; }
                if (ss[0].Pct > 0.01 || ss[ss.Count - 1].Pct < 0.99) { Reject("not from the line"); return; }
                int backward = 0;
                for (int i = 1; i < ss.Count; i++) if (ss[i].Pct < ss[i - 1].Pct - 1e-4) backward++;
                if (backward > 2) { Reject("backwards"); return; }

                // Metres, provisionally from the lap's own first sample, for the checks that are in metres.
                double lat0 = _hasOrigin ? _lat0 : ss[0].Lat, lon0 = _hasOrigin ? _lon0 : ss[0].Lon;
                double kx = Math.Cos(lat0 * Math.PI / 180) * EarthRadius * Math.PI / 180, ky = EarthRadius * Math.PI / 180;
                double X(Sample s) => (s.Lon - lon0) * kx;
                double Y(Sample s) => (s.Lat - lat0) * ky;

                double t0 = ss[0].Time;
                for (int i = 1; i < ss.Count; i++)
                {
                    bool afterFirstSecond = double.IsNaN(t0) || double.IsNaN(ss[i].Time) ? i > 20 : ss[i].Time - t0 > 1.0;
                    if (afterFirstSecond && !float.IsNaN(ss[i].Speed) && ss[i].Speed < MinSpeedMs) { Reject("stopped"); return; }
                    double dx = X(ss[i]) - X(ss[i - 1]), dy = Y(ss[i]) - Y(ss[i - 1]);
                    if (dx * dx + dy * dy > MaxStepMeters * MaxStepMeters) { Reject("jump"); return; }
                }

                // Closed: the gap between the lap's ends is what their fractions of the lap make it, give or take.
                double lapLength = OfficialLengthMeters;
                if (lapLength <= 0)
                    for (int i = 1; i < ss.Count; i++)
                    {
                        double dx = X(ss[i]) - X(ss[i - 1]), dy = Y(ss[i]) - Y(ss[i - 1]);
                        lapLength += Math.Sqrt(dx * dx + dy * dy);
                    }
                var first = ss[0];
                var last = ss[ss.Count - 1];
                double endGap = Math.Sqrt(Math.Pow(X(last) - X(first), 2) + Math.Pow(Y(last) - Y(first), 2));
                double allowed = (1 - last.Pct + first.Pct) * lapLength * 1.5 + CloseGapMeters;
                if (endGap > allowed) { Reject("not closed"); return; }

                // Resample into the bins, in degrees, then into metres from the origin — the record's, or the first
                // clean lap's own line, so that every lap is summed in one frame.
                var lat = new double[_bins];
                var lon = new double[_bins];
                var alt = new double[_bins];
                int j = 0;
                for (int b = 0; b < _bins; b++)
                {
                    double target = (double)b / _bins;
                    while (j < ss.Count - 2 && ss[j + 1].Pct < target) j++;
                    var s0 = ss[j];
                    var s1 = ss[j + 1];
                    double span = s1.Pct - s0.Pct;
                    double f = span <= 0 ? 0 : Math.Clamp((target - s0.Pct) / span, 0, 1);
                    lat[b] = s0.Lat + (s1.Lat - s0.Lat) * f;
                    lon[b] = s0.Lon + (s1.Lon - s0.Lon) * f;
                    alt[b] = s0.Alt + (s1.Alt - s0.Alt) * f;
                }
                if (!_hasOrigin) SetOrigin(lat[0], lon[0]);

                var bx = new double[_bins];
                var by = new double[_bins];
                for (int b = 0; b < _bins; b++)
                {
                    bx[b] = (lon[b] - _lon0) * _kx;
                    by[b] = (lat[b] - _lat0) * _ky;
                }

                if (_weight > 0)
                {
                    var dev = new double[_bins];
                    for (int b = 0; b < _bins; b++)
                    {
                        double dx = bx[b] - _x[b] / _weight, dy = by[b] - _y[b] / _weight;
                        dev[b] = Math.Sqrt(dx * dx + dy * dy);
                    }
                    var (median, p95) = Spread(dev);
                    if (median > AgreeMedianMeters || p95 > AgreeP95Meters) { Reject("disagrees"); return; }
                }

                for (int b = 0; b < _bins; b++)
                {
                    _x[b] += bx[b];
                    _y[b] += by[b];
                    _z[b] += alt[b];
                }
                _weight += 1;
                CleanLaps++;
            }
            finally
            {
                ss.Clear();
            }
        }

        private void SetOrigin(double lat0, double lon0)
        {
            _lat0 = lat0;
            _lon0 = lon0;
            _kx = Math.Cos(lat0 * Math.PI / 180) * EarthRadius * Math.PI / 180;
            _ky = EarthRadius * Math.PI / 180;
            _hasOrigin = true;
        }

        private static (double Median, double P95) Spread(double[] values)
        {
            var sorted = (double[])values.Clone();
            Array.Sort(sorted);
            return (sorted[sorted.Length / 2], sorted[Math.Min(sorted.Length - 1, (int)(sorted.Length * 0.95))]);
        }

        // ── Two outlines of one layout: the same place, or not ──

        /// <summary>
        /// How far apart two outlines of a layout are, bin by bin, with the second brought into the first's frame:
        /// the median and the 95th percentile, in metres.
        /// </summary>
        public static (double Median, double P95) Deviation(TrackGeometryRecord a, TrackGeometryRecord b)
        {
            int bins = a.Points.Length / 3;
            var pb = Resampled(b, bins);
            double kx = Math.Cos(a.OriginLat * Math.PI / 180) * EarthRadius * Math.PI / 180, ky = EarthRadius * Math.PI / 180;
            double shiftX = (b.OriginLon - a.OriginLon) * kx, shiftY = (b.OriginLat - a.OriginLat) * ky;
            var dev = new double[bins];
            for (int i = 0; i < bins; i++)
            {
                double dx = pb[i * 3] + shiftX - a.Points[i * 3];
                double dy = pb[i * 3 + 1] + shiftY - a.Points[i * 3 + 1];
                dev[i] = Math.Sqrt(dx * dx + dy * dy);
            }
            return Spread(dev);
        }

        /// <summary>The two outlines are of the same place: within a few metres of each other along the lap.</summary>
        public static bool Agree(TrackGeometryRecord a, TrackGeometryRecord b)
        {
            if (a?.Points == null || b?.Points == null || a.Points.Length < 30 || b.Points.Length < 30) return false;
            var (median, p95) = Deviation(a, b);
            return median <= AgreeMedianMeters && p95 <= AgreeP95Meters;
        }

        /// <summary>
        /// One outline from two that agree: the mean of their bins weighted by their clean laps, in the first's
        /// frame. The source named is the newer file's; the sectors are the newer's where it has them.
        /// </summary>
        public static TrackGeometryRecord Merge(TrackGeometryRecord into, TrackGeometryRecord add)
        {
            int bins = into.Points.Length / 3;
            var pb = Resampled(add, bins);
            double kx = Math.Cos(into.OriginLat * Math.PI / 180) * EarthRadius * Math.PI / 180, ky = EarthRadius * Math.PI / 180;
            double shiftX = (add.OriginLon - into.OriginLon) * kx, shiftY = (add.OriginLat - into.OriginLat) * ky;
            double wa = Math.Max(1, into.CleanLaps), wb = Math.Max(1, add.CleanLaps), w = wa + wb;
            var points = new float[bins * 3];
            double length = 0, px = 0, py = 0;
            for (int i = 0; i < bins; i++)
            {
                double x = (into.Points[i * 3] * wa + (pb[i * 3] + shiftX) * wb) / w;
                double y = (into.Points[i * 3 + 1] * wa + (pb[i * 3 + 1] + shiftY) * wb) / w;
                points[i * 3] = (float)x;
                points[i * 3 + 1] = (float)y;
                points[i * 3 + 2] = (float)((into.Points[i * 3 + 2] * wa + pb[i * 3 + 2] * wb) / w);
                if (i > 0) length += Math.Sqrt((x - px) * (x - px) + (y - py) * (y - py));
                px = x; py = y;
            }
            length += Math.Sqrt((px - points[0]) * (px - points[0]) + (py - points[1]) * (py - points[1]));
            bool addIsNewer = string.CompareOrdinal(add.SourceIbt ?? "", into.SourceIbt ?? "") > 0 || add.UpdatedAtUtc > into.UpdatedAtUtc;
            var newer = addIsNewer ? add : into;
            return new TrackGeometryRecord
            {
                TrackId = into.TrackId,
                TrackName = newer.TrackName ?? into.TrackName,
                LengthMeters = length,
                OfficialLengthMeters = newer.OfficialLengthMeters > 0 ? newer.OfficialLengthMeters : into.OfficialLengthMeters,
                CleanLaps = into.CleanLaps + add.CleanLaps,
                SourceIbt = newer.SourceIbt ?? into.SourceIbt,
                OriginLat = into.OriginLat,
                OriginLon = into.OriginLon,
                Points = points,
                SectorStartPcts = newer.SectorStartPcts?.Length > 0 ? newer.SectorStartPcts : into.SectorStartPcts ?? Array.Empty<double>(),
                UpdatedAtUtc = DateTime.UtcNow,
                Checks = Math.Min(into.Checks, add.Checks),
                Provisional = into.Provisional && add.Provisional,
            };
        }

        /// <summary>A record's points at another bin count, by the fraction of the lap each bin is at.</summary>
        internal static float[] Resampled(TrackGeometryRecord g, int bins)
        {
            int have = g.Points.Length / 3;
            if (have == bins) return g.Points;
            var points = new float[bins * 3];
            for (int b = 0; b < bins; b++)
            {
                double pos = (double)b / bins * have;
                int i0 = (int)Math.Floor(pos) % have, i1 = (i0 + 1) % have;
                float f = (float)(pos - Math.Floor(pos));
                for (int c = 0; c < 3; c++) points[b * 3 + c] = g.Points[i0 * 3 + c] + (g.Points[i1 * 3 + c] - g.Points[i0 * 3 + c]) * f;
            }
            return points;
        }

        private readonly struct Sample
        {
            public Sample(float pct, double lat, double lon, float alt, float speed, double time)
            {
                Pct = pct; Lat = lat; Lon = lon; Alt = alt; Speed = speed; Time = time;
            }
            public float Pct { get; }
            public double Lat { get; }
            public double Lon { get; }
            public float Alt { get; }
            public float Speed { get; }
            public double Time { get; }
        }
    }
}
