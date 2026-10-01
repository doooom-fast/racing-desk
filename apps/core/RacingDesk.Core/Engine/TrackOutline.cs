using System;
using System.Collections.Generic;

namespace RacingDesk.Plugin.Engine
{
    /// <summary>
    /// A layout's outline as the track map draws it: one point per LapDistPct bin, in metres east (X) and south
    /// (Z, so that an SVG whose y grows downward comes out north-up), with the fraction of the lap each point is
    /// at. Derived from the driver's own Lat/Lon telemetry, never from anything of iRacing's; keyed by the sim's
    /// TrackID, which is the exact layout.
    /// </summary>
    public sealed class TrackOutline
    {
        public int TrackId { get; set; }

        /// <summary>How many clean laps were averaged into it.</summary>
        public int CleanLaps { get; set; }

        public double LengthMeters { get; set; }

        /// <summary>The length the session YAML gives the layout, 0 when it gave none.</summary>
        public double OfficialLengthMeters { get; set; }

        /// <summary>Made from the session being driven, from its first clean lap on; a finished file replaces it.</summary>
        public bool Provisional { get; set; }

        /// <summary>
        /// Not his: SimHub's shared (crowd-sourced) map of the layout, read from SimHub's folder by the host as the
        /// interim until his first clean lap gives an outline of his own, which always replaces it. Never stored.
        /// </summary>
        public bool Crowd { get; set; }

        public DateTime UpdatedAtUtc { get; set; }

        public IReadOnlyList<(double X, double Z, double Pct)> Points { get; set; } = Array.Empty<(double, double, double)>();

        /// <summary>The same outline, by what the map goes on: more laps in it, or a later build of it.</summary>
        public bool SameAs(TrackOutline other) =>
            other != null && other.TrackId == TrackId && other.CleanLaps == CleanLaps && other.Provisional == Provisional
            && other.Crowd == Crowd && other.UpdatedAtUtc == UpdatedAtUtc && other.Points.Count == Points.Count;
    }

    /// <summary>
    /// Where the track map gets a layout's outline. The host's is its own store (and the session being driven);
    /// the SimHub plugin's asks the host over loopback. Asked on a pool thread, never on the telemetry thread.
    /// </summary>
    public interface IOutlineSource
    {
        /// <summary>The outline for a layout, or null while there is none yet. Throws when the source cannot be reached.</summary>
        TrackOutline Get(int trackId);
    }

    /// <summary>An outline source over a function: the host's own store, or a test's.</summary>
    public sealed class LocalOutlineSource : IOutlineSource
    {
        private readonly Func<int, TrackOutline> _get;
        public LocalOutlineSource(Func<int, TrackOutline> get) => _get = get ?? throw new ArgumentNullException(nameof(get));
        public TrackOutline Get(int trackId) => _get(trackId);
    }
}
