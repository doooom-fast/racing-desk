using System;
using System.Globalization;

namespace RacingDesk.Data.Restore
{
    /// <summary>
    /// What one telemetry frame says of where the driver is, as far as switching the brakes goes: read by the host from the
    /// SDK's own variables on every frame (cheap: no file, no lock held long).
    /// </summary>
    public sealed class SeatFacts
    {
        /// <summary>iRacing's folder for the car ("porsche963gtp"), and its name ("Porsche 963 GTP").</summary>
        public string CarPath { get; set; }
        public string CarName { get; set; }

        public bool IsOnTrack { get; set; }
        public bool IsReplayPlaying { get; set; }
        public bool IsInGarage { get; set; }
        public bool IsGarageVisible { get; set; }

        /// <summary>PlayerTrackSurface: -1 not in the world, 0 off track, 1 in the pit stall, 2 approaching the pits, 3 on track.</summary>
        public int TrackSurface { get; set; } = -1;
        public bool OnPitRoad { get; set; }

        public double SpeedMs { get; set; }

        /// <summary>The brake pedal, 0 to 1.</summary>
        public double Brake { get; set; }

        /// <summary>The session's SimMode: "full" when driving, "replay" for a replay file.</summary>
        public string SimMode { get; set; }

        public DateTime AtUtc { get; set; }

        public const int InPitStall = 1;

        /// <summary>The flags, as host.log and the first run's B2 write them down.</summary>
        public string Flags() => string.Format(CultureInfo.InvariantCulture,
            "IsOnTrack {0}, IsInGarage {1}, IsGarageVisible {2}, IsReplayPlaying {3}, PlayerTrackSurface {4}, OnPitRoad {5}, SimMode {6}, speed {7:0.0} m/s, brake {8:0}%",
            B(IsOnTrack), B(IsInGarage), B(IsGarageVisible), B(IsReplayPlaying), TrackSurface, B(OnPitRoad), SimMode ?? "?", SpeedMs, Brake * 100);

        private static int B(bool v) => v ? 1 : 0;
    }

    /// <summary>Whether he is parked at the newest frame, by the parked rule, and how old that frame is: asked right before a key is sent.</summary>
    public sealed class ParkedNow
    {
        public bool Parked { get; set; }

        /// <summary>"garage screen" or "pit stall" when parked; the place he is in otherwise, if it is one.</summary>
        public string Place { get; set; }

        /// <summary>What is not so, in words, when he is not parked.</summary>
        public string Why { get; set; }

        /// <summary>When the frame these facts are from came.</summary>
        public DateTime FactsAtUtc { get; set; }
    }

    /// <summary>
    /// When he is parked, which is the only moment the brakes may be switched (docs/view-and-pedals-plan.md, the critique's
    /// B4 and B5): on the garage screen or in the pit stall; never on track, in the pit lane or in a replay file; still for at
    /// least a second; the brake released. Which flags the garage screen really raises is written down in the first run (B2):
    /// out of the car the sim may say a replay is playing behind the garage screen, so a replay is told by the session's
    /// SimMode, not by IsReplayPlaying.
    /// </summary>
    public sealed class ParkedRule
    {
        private DateTime? _stillSince;

        /// <summary>Where he is, if it is a place the brakes may be switched in: "garage screen", "pit stall"; null otherwise, with why.</summary>
        public static string Place(SeatFacts f, out string why)
        {
            why = null;
            if (f == null) { why = "no telemetry"; return null; }
            if (string.Equals(f.SimMode, "replay", StringComparison.OrdinalIgnoreCase)) { why = "a replay file"; return null; }
            if (f.IsOnTrack)
            {
                if (f.TrackSurface == SeatFacts.InPitStall) return "pit stall";
                why = f.OnPitRoad ? "in the pit lane" : "on track";
                return null;
            }
            if (f.IsInGarage || f.IsGarageVisible) return "garage screen";
            why = f.IsReplayPlaying ? "watching a replay" : "out of the car";
            return null;
        }

        /// <summary>
        /// Whether, at this frame, he has been parked long enough: the place is one of the two, he has been slower than
        /// 0.3 m/s for a second, and the brake is released. <paramref name="why"/> says what is not so.
        /// </summary>
        public bool Parked(SeatFacts f, out string place, out string why)
        {
            place = Place(f, out why);
            bool still = f != null && f.SpeedMs < RestorePolicy.StillBelowMs;
            if (place == null || !still)
            {
                _stillSince = null;
                if (place != null) why = "moving";
                return false;
            }
            if (_stillSince == null || f.AtUtc < _stillSince.Value) _stillSince = f.AtUtc;
            if (f.AtUtc - _stillSince.Value < RestorePolicy.StillFor) { why = "not still for a second yet"; return false; }
            if (f.Brake >= RestorePolicy.BrakeReleasedBelow) { why = "the brake is pressed"; return false; }
            why = null;
            return true;
        }

        public void Reset() => _stillSince = null;
    }
}
