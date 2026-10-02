using System;

namespace RacingDesk.Plugin.Engine
{
    /// <summary>
    /// A reading that describes a set that is no longer on the car is replaced here, once, per corner, so
    /// every reader (the pit box's rings, the commentary's trigger and quad, the strategist, the recording's sidecar)
    /// agrees without each of them having to know. iRacing measures tread in the pits and nowhere else, and after a
    /// change it keeps showing the readings of the set that came off until it measures again at the next stop
    /// (reported by others: niklam/iracedeck issue 1108; on his own data every change was a reset to the pits, which
    /// fits a new set with his default pit settings while the readings keep the old set's). A changed corner therefore
    /// reads <b>a new set's tread, <see cref="TyreWear.NewPercent"/> (100)</b> from the moment the car leaves pit road
    /// until the sim shows that corner's tread differently, and the snapshot's <see cref="TelemetrySnapshot.TyreNewSetFlags"/>
    /// says which corners read so by assumption (the page writes "new set" under the rings; the strategist takes the
    /// 100 as healthy and not as news). He chose the 100 over a dash on 2026-10-01 ("100%, new set"): on his newest 64
    /// sessions a dash would have stood for 6 to 93 % of his time on track in 9 of them. A warning from the old set's
    /// number cannot fire on the new one anywhere, and a new set never warns.
    ///
    /// Per corner, from the pit service's own checkboxes (<c>PitSvFlags</c>, the pit box's own source for "tyres
    /// requested"): a corner whose tyre is asked for while the car is in its stall is <i>asked</i>, remembering the
    /// reading the sim shows then; leaving pit road makes it <i>new</i>. A new corner reads 100 until the sim's
    /// reading moves off the remembered one (the next stop's measurement), and a corner the sim measures again while it
    /// is only asked for (a sim that refreshes in the stall) is not held at all. A stop without tyres holds nothing,
    /// and a stop with two (<c>0x05</c>) holds those two corners and leaves the others as measured. A reset to the pits
    /// is a stall visit like any other: the car is in its stall with tyres ticked, and leaves.
    ///
    /// A corner whose remembered reading already prints as a new set's 100 (<see cref="TyreWear.DisplayPercent"/>: a
    /// session that starts on a fresh set, and a set the sim last measured fresh) has nothing to replace, so it is not held
    /// and not flagged: the 100 on the page is then the sim's own, and the page says "new set" only where the engine put
    /// the 100 there. (His sessions that start with tyres ticked in his default pit settings leave the stall on their first
    /// exit with readings of 100, and without this the whole session would have read "New set · not measured".)
    ///
    /// Not seen, so not handled: a stall visit where tyres were asked for and the driver left without them. That
    /// reads 100 on the corners until the next stop's measurement, which is the safe side (nothing warns from a number
    /// that may not be this set's). A corner the sim had never measured when its tyre was changed has nothing to
    /// hold: it stays null until the sim first measures it.
    /// </summary>
    public sealed class TyreSetMask
    {
        private const double Epsilon = 1e-6;

        private readonly double?[] _shown = new double?[4];   // the sim's reading when the corner's tyre was asked for
        private readonly bool[] _asked = new bool[4];         // asked for in the stall; the car has not left pit road yet
        private readonly bool[] _masked = new bool[4];        // the set changed: the sim still shows the set that came off
        private readonly bool[] _settled = new bool[4];       // the sim measured it in the stall: not asked again until the stall is left
        private bool _wasOnPitRoad;

        /// <summary>
        /// True where the corner's reading (0 FL, 1 FR, 2 RL, 3 RR) is the removed set's and is held back: the corner
        /// reads a new set's tread (<see cref="TyreWear.NewPercent"/>) and is flagged in <see cref="TelemetrySnapshot.TyreNewSetFlags"/>.
        /// </summary>
        public bool IsMasked(int corner) => _masked[corner];

        /// <summary>The corners held back, one bit each, as <see cref="TelemetrySnapshot.TyreNewSetFlags"/> carries them (0x01 FL … 0x08 RR).</summary>
        public int NewSetFlags
        {
            get
            {
                int flags = 0;
                for (int i = 0; i < 4; i++) if (_masked[i]) flags |= 1 << i;
                return flags;
            }
        }

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
        /// Puts a new set's tread on the snapshot, in place, for every corner whose set has changed since it was
        /// measured, and says which in <see cref="TelemetrySnapshot.TyreNewSetFlags"/>. Called once per frame, before
        /// anything reads the snapshot.
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
                    _masked[i] = !ReadsAsNewSet(_shown[i]);      // a reading that is a new set's already has nothing to replace
                }
            }

            // The set that came off is not this car's reading: a new set, 100, until the sim says otherwise
            if (_masked[0]) s.TyreWearFL = TyreWear.NewPercent;
            if (_masked[1]) s.TyreWearFR = TyreWear.NewPercent;
            if (_masked[2]) s.TyreWearRL = TyreWear.NewPercent;
            if (_masked[3]) s.TyreWearRR = TyreWear.NewPercent;
            s.TyreNewSetFlags = NewSetFlags;
        }

        /// <summary>True where the sim's reading already prints as a new set's tread, so replacing it with 100 changes nothing.</summary>
        private static bool ReadsAsNewSet(double? reading) =>
            reading.HasValue && TyreWear.DisplayPercent(reading.Value) >= TyreWear.DisplayPercent(TyreWear.NewPercent);
    }
}
