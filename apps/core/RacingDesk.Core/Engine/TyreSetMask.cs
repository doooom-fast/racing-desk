using System;

namespace RacingDesk.Plugin.Engine
{
    /// <summary>
    /// A reading that describes a set that is no longer on the car is taken off the wire here, once, per corner, so
    /// every reader (the pit box's rings, the commentary's trigger and quad, the strategist, the recording's sidecar)
    /// agrees without each of them having to know. iRacing measures tread in the pits and nowhere else, and after a
    /// change it keeps showing the readings of the set that came off until it measures again at the next stop
    /// (reported by others: niklam/iracedeck issue 1108; none of his own sessions has changed tyres, so this is the one
    /// part not seen on his data). A new set is therefore <c>null</c> — not measured — from the moment the car leaves
    /// pit road until the sim shows that corner's tread differently, and a warning from the old set's number cannot
    /// fire on the new one anywhere.
    ///
    /// Per corner, from the pit service's own checkboxes (<c>PitSvFlags</c>, the pit box's own source for "tyres
    /// requested"): a corner whose tyre is asked for while the car is in its stall is <i>asked</i>, remembering the
    /// reading the sim shows then; leaving pit road makes it <i>masked</i>. A masked corner stays null until the sim's
    /// reading moves off the remembered one (the next stop's measurement), and a corner the sim measures again while it
    /// is only asked for (a sim that refreshes in the stall) is not masked at all. A stop without tyres masks nothing,
    /// and a stop with two (<c>0x05</c>) masks those two corners and leaves the others as measured.
    ///
    /// Not seen, so not handled: a stall visit where tyres were asked for and the driver left without them. That
    /// masks the corners until the next stop's measurement, which is the safe side (nothing warns from a number that
    /// may not be this set's).
    /// </summary>
    public sealed class TyreSetMask
    {
        private const double Epsilon = 1e-6;

        private readonly double?[] _shown = new double?[4];   // the sim's reading when the corner's tyre was asked for
        private readonly bool[] _asked = new bool[4];         // asked for in the stall; the car has not left pit road yet
        private readonly bool[] _masked = new bool[4];        // the set changed: the sim still shows the set that came off
        private readonly bool[] _settled = new bool[4];       // the sim measured it in the stall: not asked again until the stall is left
        private bool _wasOnPitRoad;

        /// <summary>True where the corner's reading (0 FL, 1 FR, 2 RL, 3 RR) is the removed set's and is held back.</summary>
        public bool IsMasked(int corner) => _masked[corner];

        /// <summary>Everything forgotten: a new session, or another car.</summary>
        public void Reset()
        {
            for (int i = 0; i < 4; i++)
            {
                _shown[i] = null;
                _asked[i] = false;
                _masked[i] = false;
                _settled[i] = false;
            }
            _wasOnPitRoad = false;
        }

        /// <summary>
        /// Takes this frame's reading off the snapshot, in place, for every corner whose set has changed since it was
        /// measured. Called once per frame, before anything reads the snapshot.
        /// </summary>
        public void Apply(TelemetrySnapshot s)
        {
            if (s == null || !s.GameRunning) return;

            double?[] sim = { s.TyreWearFL, s.TyreWearFR, s.TyreWearRL, s.TyreWearRR };
            bool[] requested = { s.PitTireLF, s.PitTireRF, s.PitTireLR, s.PitTireRR };
            bool inStall = s.IsInPit;
            bool onPitRoad = s.IsInPitLane;
            bool leftPitRoad = _wasOnPitRoad && !onPitRoad;
            _wasOnPitRoad = onPitRoad;

            for (int i = 0; i < 4; i++)
            {
                if (!inStall) _settled[i] = false;

                bool moved = sim[i].HasValue && _shown[i].HasValue && Math.Abs(sim[i].Value - _shown[i].Value) > Epsilon;
                if (moved && _masked[i])
                {
                    _masked[i] = false;                          // the sim measured this corner again: a reading of what is on the car
                }
                else if (moved && _asked[i])
                {
                    _asked[i] = false;                           // measured in the stall, after the change: this reading is the new set's
                    _settled[i] = true;
                }

                if (inStall && requested[i] && !_masked[i] && !_asked[i] && !_settled[i] && sim[i].HasValue)
                {
                    _asked[i] = true;                            // a tyre is asked for here: remember what the sim shows for the set on the car
                    _shown[i] = sim[i];
                }

                if (leftPitRoad && _asked[i])
                {
                    _asked[i] = false;                           // out of the pits on whatever was fitted
                    _masked[i] = true;
                }
            }

            if (_masked[0]) s.TyreWearFL = null;
            if (_masked[1]) s.TyreWearFR = null;
            if (_masked[2]) s.TyreWearRL = null;
            if (_masked[3]) s.TyreWearRR = null;
        }
    }
}
