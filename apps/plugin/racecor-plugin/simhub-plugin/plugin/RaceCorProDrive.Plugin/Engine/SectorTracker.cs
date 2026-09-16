using System;

namespace RaceCorProDrive.Plugin.Engine
{
    /// <summary>
    /// Tracks N-sector split times using iRacing's native sector boundaries
    /// (from SplitTimeInfo.Sectors[].SectorStartPct in the session YAML).
    /// Falls back to equal thirds (3 sectors) if native boundaries aren't available.
    /// </summary>
    public class SectorTracker
    {
        // Boundaries: array of LapDistPct values where each sector starts (excluding sector 1 which starts at 0)
        // For 3 sectors: [s2Start, s3Start]. For 5 sectors: [s2Start, s3Start, s4Start, s5Start].
        private double[] _boundaries = new double[] { 0.333, 0.667 };
        private bool _hasNativeBoundaries;

        // Dynamic arrays sized to sector count
        private double[] _bestSplits;   // best split time per sector
        private double[] _lastSplits;   // last completed split time per sector
        private double[] _deltas;       // delta to best per sector
        private int[]    _states;       // 0=none, 1=pb, 2=faster, 3=slower

        // Current lap state
        private double _sectorEntryTime;
        private int _prevSector;
        private int _prevCompletedLaps;

        /// <summary>Number of sectors for this track.</summary>
        public int SectorCount { get; private set; } = 3;

        /// <summary>Current sector the player is in (1-based).</summary>
        public int CurrentSector { get; private set; } = 1;

        /// <summary>Whether native iRacing sector boundaries are loaded.</summary>
        public bool HasNativeBoundaries => _hasNativeBoundaries;

        // ── Legacy 3-sector properties (backward compat) ──
        public double Sector2StartPct => _boundaries.Length >= 1 ? _boundaries[0] : 0.333;
        public double Sector3StartPct => _boundaries.Length >= 2 ? _boundaries[1] : 0.667;

        public double SplitS1 => GetSplit(0);
        public double SplitS2 => GetSplit(1);
        public double SplitS3 => GetSplit(2);
        public double BestS1  => GetBest(0);
        public double BestS2  => GetBest(1);
        public double BestS3  => GetBest(2);
        public double DeltaS1 => GetDelta(0);
        public double DeltaS2 => GetDelta(1);
        public double DeltaS3 => GetDelta(2);
        public int    StateS1 => GetState(0);
        public int    StateS2 => GetState(1);
        public int    StateS3 => GetState(2);

        // ── N-sector array accessors ──
        /// <summary>Get the last completed split time for sector index (0-based).</summary>
        public double GetSplit(int idx) => _lastSplits != null && idx < _lastSplits.Length ? _lastSplits[idx] : 0;
        /// <summary>Get the best split time for sector index (0-based).</summary>
        public double GetBest(int idx)  => _bestSplits != null && idx < _bestSplits.Length ? _bestSplits[idx] : 0;
        /// <summary>Get the delta to best for sector index (0-based).</summary>
        public double GetDelta(int idx) => _deltas != null && idx < _deltas.Length ? _deltas[idx] : 0;
        /// <summary>Get the state for sector index (0-based). 0=none, 1=pb, 2=faster, 3=slower</summary>
        public int    GetState(int idx) => _states != null && idx < _states.Length ? _states[idx] : 0;

        /// <summary>Get the sector boundary start percentages (excludes sector 1 which starts at 0).</summary>
        public double[] Boundaries => _boundaries;

        public SectorTracker()
        {
            AllocArrays(3);
        }

        private void AllocArrays(int count)
        {
            SectorCount = count;
            _bestSplits = new double[count];
            _lastSplits = new double[count];
            _deltas     = new double[count];
            _states     = new int[count];
        }

        /// <summary>
        /// Set sector boundaries from iRacing's SplitTimeInfo YAML.
        /// Pass the SectorStartPct values for sectors 2..N (sector 1 starts at 0).
        /// </summary>
        public void SetBoundaries(double[] boundaries, int sectorCount)
        {
            if (boundaries == null || boundaries.Length == 0 || sectorCount < 2) return;

            // Validate monotonically increasing and in range (0,1)
            double prev = 0;
            foreach (var b in boundaries)
            {
                if (b <= prev || b >= 1) return;
                prev = b;
            }

            _boundaries = boundaries;
            _hasNativeBoundaries = true;
            AllocArrays(sectorCount);
            ResetState();
        }

        /// <summary>
        /// Legacy 2-boundary overload for backward compatibility.
        /// </summary>
        public void SetBoundaries(double s2StartPct, double s3StartPct)
        {
            if (s2StartPct > 0 && s2StartPct < 1 && s3StartPct > s2StartPct && s3StartPct < 1)
            {
                SetBoundaries(new[] { s2StartPct, s3StartPct }, 3);
            }
        }

        /// <summary>
        /// Call every tick with the player's track position and current lap time.
        /// </summary>
        public void Update(double trackPct, double currentLapTime, int completedLaps)
        {
            if (trackPct < 0 || trackPct > 1.01) return;

            // Determine current sector (1-based)
            int sector = SectorCount; // default to last sector
            for (int i = 0; i < _boundaries.Length; i++)
            {
                if (trackPct < _boundaries[i])
                {
                    sector = i + 1;
                    break;
                }
            }

            // New lap detection
            if (completedLaps > _prevCompletedLaps || (sector == 1 && _prevSector == SectorCount))
            {
                if (_prevSector == SectorCount)
                {
                    double splitTime = currentLapTime > 0
                        ? currentLapTime - _sectorEntryTime : 0;
                    if (splitTime > 0.1)
                        RecordSplit(SectorCount, splitTime);
                }
                _sectorEntryTime = 0;
                _prevCompletedLaps = completedLaps;
            }

            // Sector transition
            if (sector != _prevSector && _prevSector > 0)
            {
                double splitTime = currentLapTime - _sectorEntryTime;
                if (splitTime > 0.1)
                    RecordSplit(_prevSector, splitTime);
                _sectorEntryTime = currentLapTime;
            }

            if (_prevSector == 0)
                _sectorEntryTime = currentLapTime;

            _prevSector = sector;
            CurrentSector = sector;
        }

        private void RecordSplit(int sector, double splitTime)
        {
            int idx = sector - 1;
            if (idx < 0 || idx >= SectorCount) return;

            _lastSplits[idx] = splitTime;
            if (_bestSplits[idx] <= 0 || splitTime < _bestSplits[idx])
            {
                _bestSplits[idx] = splitTime;
                _deltas[idx] = 0;
                _states[idx] = 1; // PB
            }
            else
            {
                _deltas[idx] = splitTime - _bestSplits[idx];
                _states[idx] = _deltas[idx] < 0.01 ? 1 : 3; // within 0.01s = still PB, else slower
            }
        }

        /// <summary>Reset all sector data (session change, track change).</summary>
        public void Reset()
        {
            _hasNativeBoundaries = false;
            _boundaries = null;
            AllocArrays(3); // revert to default 3 sectors until new boundaries arrive
            ResetState();
        }

        private void ResetState()
        {
            _sectorEntryTime = 0;
            _prevSector = 0;
            _prevCompletedLaps = 0;
            CurrentSector = 1;
        }
    }
}
