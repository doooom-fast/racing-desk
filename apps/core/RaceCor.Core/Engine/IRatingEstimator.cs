// ═══════════════════════════════════════════════════════════════
// K10 Motorsports — iRating Change Estimator
//
// Reads opponent iRatings from iRacing's session data (via SimHub's
// Opponents collection) and estimates the player's iRating gain/loss
// using the Elo-based formula that iRacing uses.
//
// Also reads iRating + Safety Rating directly from iRacing's memory-
// mapped file as a fallback when IRacingExtraProperties isn't available.
// ═══════════════════════════════════════════════════════════════

using System;
using System.Collections.Generic;
using System.IO.MemoryMappedFiles;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;

namespace RaceCorProDrive.Plugin.Engine
{
    /// <summary>
    /// Estimates iRating change based on current race position and opponent iRatings.
    /// Uses the Elo-based formula: for each opponent, calculate expected score
    /// E = 1 / (1 + 10^((their_iR - your_iR) / 1600)), then sum across all opponents.
    /// Delta = (field_size - 1) * (actual_wins - expected_wins) / (field_size / 2).
    /// </summary>
    public class IRatingEstimator
    {
        // ── iRacing Shared Memory Constants ──
        private const string IRSDK_MEMMAPFILENAME = "Local\\IRSDKMemMapFileName";

        // Header offsets (from iRacing SDK irsdk_header struct)
        private const int HEADER_VER_OFFSET        = 0;
        private const int HEADER_STATUS_OFFSET      = 4;
        private const int HEADER_TICK_RATE_OFFSET    = 8;
        private const int HEADER_SESSION_INFO_UPDATE = 12;
        private const int HEADER_SESSION_INFO_LEN    = 16;
        private const int HEADER_SESSION_INFO_OFFSET = 20;

        // State
        private int _lastSessionInfoUpdate = -1;
        private string _sessionYaml = null;
        private readonly Dictionary<int, int> _driverIRatings = new Dictionary<int, int>();
        private int _playerCarIdx = -1;
        private int _playerIRating = 0;
        private double _playerSafetyRating = 0;
        private bool _isStandingStart = false;

        // Last computed estimate
        public int EstimatedDelta { get; private set; }
        public int PlayerIRating => _playerIRating;
        public double PlayerSafetyRating => _playerSafetyRating;
        public int FieldSize => _driverIRatings.Count;
        public bool IsStandingStart => _isStandingStart;

        /// <summary>
        /// Try to read iRacing session YAML from shared memory.
        /// Returns true if new data was read.
        /// </summary>
        public bool TryReadSessionInfo()
        {
            try
            {
                using (var mmf = MemoryMappedFile.OpenExisting(IRSDK_MEMMAPFILENAME))
                using (var accessor = mmf.CreateViewAccessor(0, 0, MemoryMappedFileAccess.Read))
                {
                    int status = accessor.ReadInt32(HEADER_STATUS_OFFSET);
                    if (status == 0) return false; // iRacing not running

                    int sessionInfoUpdate = accessor.ReadInt32(HEADER_SESSION_INFO_UPDATE);
                    if (sessionInfoUpdate == _lastSessionInfoUpdate && _sessionYaml != null)
                        return false; // No change since last read

                    int sessionInfoLen = accessor.ReadInt32(HEADER_SESSION_INFO_LEN);
                    int sessionInfoOffset = accessor.ReadInt32(HEADER_SESSION_INFO_OFFSET);

                    if (sessionInfoLen <= 0 || sessionInfoOffset <= 0)
                        return false;

                    // Read the session info YAML string
                    byte[] buffer = new byte[sessionInfoLen];
                    accessor.ReadArray(sessionInfoOffset, buffer, 0, sessionInfoLen);

                    // Find null terminator
                    int nullIdx = Array.IndexOf(buffer, (byte)0);
                    int strLen = nullIdx >= 0 ? nullIdx : sessionInfoLen;

                    _sessionYaml = Encoding.GetEncoding(28591).GetString(buffer, 0, strLen);
                    _lastSessionInfoUpdate = sessionInfoUpdate;

                    ParseDriverInfo(_sessionYaml);
                    ParseWeekendOptions(_sessionYaml);
                    ParseSplitTimeInfo(_sessionYaml);
                    return true;
                }
            }
            catch
            {
                // Shared memory not available (iRacing not running, or on wrong platform)
                return false;
            }
        }

        /// <summary>
        /// Parse the DriverInfo section from the session YAML to extract
        /// PlayerCarIdx and all driver iRatings.
        /// </summary>
        private void ParseDriverInfo(string yaml)
        {
            if (string.IsNullOrEmpty(yaml)) return;

            _driverIRatings.Clear();

            // Extract PlayerCarIdx
            var playerCarIdxLine = FindYamlValue(yaml, "PlayerCarIdx:");
            if (playerCarIdxLine != null)
                int.TryParse(playerCarIdxLine.Trim(), out _playerCarIdx);

            // Find DriverInfo.Drivers section and parse each driver's iRating
            int driversStart = yaml.IndexOf("Drivers:", StringComparison.Ordinal);
            if (driversStart < 0) return;

            string driversSection = yaml.Substring(driversStart);
            int pos = 0;

            while (true)
            {
                // Find next "- CarIdx:" entry
                int carIdxStart = driversSection.IndexOf("CarIdx:", pos, StringComparison.Ordinal);
                if (carIdxStart < 0) break;

                int carIdxValueStart = carIdxStart + "CarIdx:".Length;
                int carIdxLineEnd = driversSection.IndexOf('\n', carIdxValueStart);
                if (carIdxLineEnd < 0) break;

                string carIdxStr = driversSection.Substring(carIdxValueStart, carIdxLineEnd - carIdxValueStart).Trim();
                if (!int.TryParse(carIdxStr, out int carIdx))
                {
                    pos = carIdxLineEnd;
                    continue;
                }

                // Find iRating for this driver (within next ~500 chars, before next CarIdx)
                int nextCarIdx = driversSection.IndexOf("CarIdx:", carIdxLineEnd, StringComparison.Ordinal);
                int searchEnd = nextCarIdx > 0 ? nextCarIdx : Math.Min(carIdxLineEnd + 500, driversSection.Length);
                string driverBlock = driversSection.Substring(carIdxLineEnd, searchEnd - carIdxLineEnd);

                int irStart = driverBlock.IndexOf("IRating:", StringComparison.Ordinal);
                if (irStart >= 0)
                {
                    int irValueStart = irStart + "IRating:".Length;
                    int irLineEnd = driverBlock.IndexOf('\n', irValueStart);
                    if (irLineEnd < 0) irLineEnd = driverBlock.Length;
                    string irStr = driverBlock.Substring(irValueStart, irLineEnd - irValueStart).Trim();
                    if (int.TryParse(irStr, out int irating) && irating > 0)
                    {
                        _driverIRatings[carIdx] = irating;

                        if (carIdx == _playerCarIdx)
                            _playerIRating = irating;
                    }
                }

                // Also try to get Safety Rating for the player
                if (carIdx == _playerCarIdx)
                {
                    int srStart = driverBlock.IndexOf("LicString:", StringComparison.Ordinal);
                    if (srStart >= 0)
                    {
                        int srValueStart = srStart + "LicString:".Length;
                        int srLineEnd = driverBlock.IndexOf('\n', srValueStart);
                        if (srLineEnd < 0) srLineEnd = driverBlock.Length;
                        string licStr = driverBlock.Substring(srValueStart, srLineEnd - srValueStart).Trim();
                        // LicString format: "A 3.41" or "B2.99"
                        if (licStr.Length >= 2)
                        {
                            string numPart = licStr.Substring(1).Trim();
                            if (double.TryParse(numPart, System.Globalization.NumberStyles.Float,
                                System.Globalization.CultureInfo.InvariantCulture, out double sr))
                                _playerSafetyRating = sr;
                        }
                    }
                }

                pos = carIdxLineEnd;
            }
        }

        /// <summary>
        /// Estimate the iRating change for the player at their current position.
        /// Call this on every telemetry tick with the current race position.
        /// </summary>
        /// <param name="currentPosition">Player's current race position (1-based)</param>
        /// <param name="fieldSize">Total cars in the race (0 = use detected field size)</param>
        public void Update(int currentPosition, int fieldSize = 0)
        {
            if (_playerIRating <= 0 || _driverIRatings.Count < 2 || currentPosition <= 0)
            {
                EstimatedDelta = 0;
                return;
            }

            int n = fieldSize > 0 ? fieldSize : _driverIRatings.Count;
            if (n < 2)
            {
                EstimatedDelta = 0;
                return;
            }

            // Get all opponent iRatings (exclude player)
            var opponentRatings = _driverIRatings
                .Where(kv => kv.Key != _playerCarIdx && kv.Value > 0)
                .Select(kv => kv.Value)
                .ToList();

            if (opponentRatings.Count == 0)
            {
                EstimatedDelta = 0;
                return;
            }

            EstimatedDelta = CalculateEstimatedDelta(
                _playerIRating, currentPosition, opponentRatings, n);
        }

        /// <summary>
        /// Core Elo-based iRating estimation.
        /// For each opponent, expected score = 1 / (1 + 10^((their_iR - my_iR) / 1600)).
        /// Actual score: 1 if I'm ahead, 0 if behind.
        /// Delta scaled by field size factor.
        /// </summary>
        public static int CalculateEstimatedDelta(
            int playerIR, int playerPosition, List<int> opponentRatings, int fieldSize)
        {
            double expectedWins = 0;
            double actualWins = 0;
            int opponentPosition = 0;

            // Sort opponents by rating descending to assign approximate positions
            // In reality we'd need actual positions, but for estimation we compare pairwise
            foreach (int oppIR in opponentRatings)
            {
                // Expected probability of beating this opponent
                double expected = 1.0 / (1.0 + Math.Pow(10.0, (oppIR - playerIR) / 1600.0));
                expectedWins += expected;

                // Actual result: we beat them if our position is better (lower number)
                // Since we don't have individual opponent positions, approximate:
                // assume opponents are roughly distributed across the field
                opponentPosition++;
                // Simple model: opponent at position `opponentPosition` adjusted for player
                int oppPos = opponentPosition >= playerPosition ? opponentPosition + 1 : opponentPosition;
                actualWins += (playerPosition < oppPos) ? 1.0 : 0.0;
            }

            // Scale factor: adjusts the raw delta to realistic iRating swings
            // Community-derived K-factor: approximately (fieldSize - 1) / (fieldSize / 2)
            // which simplifies to ~2.0 for most field sizes, but we use a more accurate model
            double kFactor = (fieldSize > 1) ? (double)(fieldSize - 1) / (fieldSize / 2.0) : 1.0;

            // Raw delta
            double rawDelta = kFactor * (actualWins - expectedWins);

            // Scale to realistic iRating range (community-derived scaling factor)
            // Typical iRating swings are ~50-200 iR for a full race
            double scaleFactor = 200.0 / Math.Max(1, opponentRatings.Count);
            int delta = (int)Math.Round(rawDelta * scaleFactor);

            // Clamp to realistic bounds
            return Math.Max(-300, Math.Min(300, delta));
        }

        /// <summary>
        /// Parse WeekendOptions from session YAML to detect standing starts.
        /// iRacing YAML contains: WeekendOptions:\n  StandingStart: 1\n
        /// </summary>
        private void ParseWeekendOptions(string yaml)
        {
            var val = FindYamlValue(yaml, "StandingStart:");
            if (val != null)
            {
                _isStandingStart = val.Trim() == "1";
            }
        }

        /// <summary>
        /// Parsed sector boundaries from iRacing SplitTimeInfo YAML.
        /// SectorStartPct[0] = S1 start (always 0), [1] = S2 start, [2] = S3 start.
        /// </summary>
        public double SectorS2Start { get; private set; }
        public double SectorS3Start { get; private set; }
        public bool HasSectorBoundaries { get; private set; }

        /// <summary>
        /// Parse the SplitTimeInfo section from session YAML.
        /// Format:
        ///   SplitTimeInfo:
        ///    Sectors:
        ///    - SectorNum: 0
        ///      SectorStartPct: 0.000000
        ///    - SectorNum: 1
        ///      SectorStartPct: 0.326471
        ///    - SectorNum: 2
        ///      SectorStartPct: 0.687412
        /// </summary>
        private void ParseSplitTimeInfo(string yaml)
        {
            int splitStart = yaml.IndexOf("SplitTimeInfo:", StringComparison.Ordinal);
            if (splitStart < 0) return;

            // Find all SectorStartPct values after SplitTimeInfo:
            var pcts = new System.Collections.Generic.List<double>();
            int searchFrom = splitStart;
            while (true)
            {
                int pctIdx = yaml.IndexOf("SectorStartPct:", searchFrom, StringComparison.Ordinal);
                if (pctIdx < 0) break;

                // Don't go past the next top-level YAML section
                int nextSection = yaml.IndexOf("\n\n", splitStart + 15, StringComparison.Ordinal);
                if (nextSection > 0 && pctIdx > nextSection) break;

                string val = FindYamlValue(yaml, "SectorStartPct:");
                // FindYamlValue searches from the beginning, so use substring
                int valStart = pctIdx + "SectorStartPct:".Length;
                int valEnd = yaml.IndexOf('\n', valStart);
                if (valEnd < 0) valEnd = yaml.Length;
                string pctStr = yaml.Substring(valStart, valEnd - valStart).Trim();

                if (double.TryParse(pctStr, System.Globalization.NumberStyles.Float,
                    System.Globalization.CultureInfo.InvariantCulture, out double pct))
                {
                    pcts.Add(pct);
                }
                searchFrom = valEnd;
            }

            // iRacing typically has 3 sectors: S0 (start=0.0), S1 (start=~0.33), S2 (start=~0.67)
            if (pcts.Count >= 3)
            {
                SectorS2Start = pcts[1];
                SectorS3Start = pcts[2];
                HasSectorBoundaries = true;
            }
        }

        /// <summary>
        /// Simple YAML value finder (no full YAML parser needed for iRacing's simple format).
        /// </summary>
        private static string FindYamlValue(string yaml, string key)
        {
            int idx = yaml.IndexOf(key, StringComparison.Ordinal);
            if (idx < 0) return null;
            int start = idx + key.Length;
            int end = yaml.IndexOf('\n', start);
            if (end < 0) end = yaml.Length;
            return yaml.Substring(start, end - start);
        }
    }
}
