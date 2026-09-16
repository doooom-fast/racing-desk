// ═══════════════════════════════════════════════════════════════
// K10 Motorsports — iRacing SDK Bridge
//
// Thin wrapper around IRSDKSharper that runs a background connection
// to iRacing's shared memory, providing direct access to:
//   • Real-time telemetry variables (speed, RPM, incidents, flags, etc.)
//   • Session info YAML (iRating, SR, incident limits, sector boundaries)
//   • Per-car arrays (CarIdxLapDistPct, CarIdxOnPitRoad, etc.)
//
// Replaces the hand-rolled MemoryMappedFile approach in IRatingEstimator
// which was unreliable (iRating/SR never got populated).
//
// Lifecycle: Start() in Plugin.Init(), Stop() in Plugin.End().
// Thread safety: telemetry reads happen on the SimHub DataUpdate thread;
// IRSDKSharper's background thread fires events that update cached state.
// ═══════════════════════════════════════════════════════════════

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using IRSDKSharper;

namespace RaceCorProDrive.Plugin.Engine
{
    /// <summary>
    /// Bridge to the iRacing SDK via IRSDKSharper.
    /// Provides direct telemetry reads and parsed session info.
    /// </summary>
    public sealed class IRacingSdkBridge : IDisposable
    {
        private IRacingSdk _sdk;
        private readonly object _lock = new object();

        // ── Connection state ──
        public bool IsConnected { get; private set; }
        public bool IsStarted { get; private set; }

        // ── Session info (parsed from YAML on OnSessionInfo events) ──
        public int PlayerCarIdx { get; private set; } = -1;
        public int PlayerIRating { get; private set; }
        public double PlayerSafetyRating { get; private set; }
        public string PlayerLicenseString { get; private set; } = "";
        public bool IsStandingStart { get; private set; }
        public int IncidentLimitPenalty { get; private set; }
        public int IncidentLimitDQ { get; private set; }

        // Sector boundaries from SplitTimeInfo
        public double SectorS2StartPct { get; private set; }
        public double SectorS3StartPct { get; private set; }
        public bool HasSectorBoundaries { get; private set; }

        /// <summary>All sector boundary percentages from iRacing SplitTimeInfo (sorted ascending).</summary>
        public double[] SectorBoundaries { get; private set; } = Array.Empty<double>();
        /// <summary>Number of sectors defined by iRacing for this track.</summary>
        public int SectorCount { get; private set; } = 3;

        // Driver ratings for iRating estimation
        private readonly Dictionary<int, int> _driverIRatings = new Dictionary<int, int>();
        public IReadOnlyDictionary<int, int> DriverIRatings => _driverIRatings;
        public int FieldSize => _driverIRatings.Count;

        // Track info
        public string TrackCountry { get; private set; } = "";

        // ═══════════════════════════════════════════════════════════════
        //  LIFECYCLE
        // ═══════════════════════════════════════════════════════════════

        /// <summary>
        /// Initialise the SDK and start listening for iRacing.
        /// Call once from Plugin.Init().
        /// </summary>
        public void Start()
        {
            if (IsStarted) return;

            _sdk = new IRacingSdk();

            // Wire up events
            _sdk.OnConnected += OnConnected;
            _sdk.OnDisconnected += OnDisconnected;
            _sdk.OnSessionInfo += OnSessionInfo;

            // We don't use OnTelemetryData — we read telemetry synchronously
            // from the SimHub DataUpdate thread for tighter timing.
            // The SDK keeps the memory mapped view open so reads are always fresh.

            _sdk.Start();
            IsStarted = true;

            SimHub.Logging.Current.Info("[RaceCorProDrive] IRacingSdkBridge started");
        }

        /// <summary>
        /// Stop the SDK background threads. Call from Plugin.End().
        /// </summary>
        public void Stop()
        {
            if (!IsStarted) return;

            try
            {
                _sdk.Stop();
            }
            catch (Exception ex)
            {
                SimHub.Logging.Current.Error("[RaceCorProDrive] Error stopping SDK: " + ex.Message);
            }

            IsStarted = false;
            IsConnected = false;

            SimHub.Logging.Current.Info("[RaceCorProDrive] IRacingSdkBridge stopped");
        }

        public void Dispose()
        {
            Stop();
        }

        // ═══════════════════════════════════════════════════════════════
        //  TELEMETRY READS (called from DataUpdate thread)
        // ═══════════════════════════════════════════════════════════════

        /// <summary>
        /// Read an integer telemetry variable. Returns 0 if not connected or not found.
        /// </summary>
        public int GetInt(string name)
        {
            if (!IsConnected || _sdk?.Data == null) return 0;
            try { return _sdk.Data.GetInt(name); }
            catch { return 0; }
        }

        /// <summary>
        /// Read a float telemetry variable. Returns 0f if not connected or not found.
        /// </summary>
        public float GetFloat(string name)
        {
            if (!IsConnected || _sdk?.Data == null) return 0f;
            try { return _sdk.Data.GetFloat(name); }
            catch { return 0f; }
        }

        /// <summary>
        /// Read a double telemetry variable. Returns 0.0 if not connected or not found.
        /// </summary>
        public double GetDouble(string name)
        {
            if (!IsConnected || _sdk?.Data == null) return 0.0;
            try { return _sdk.Data.GetDouble(name); }
            catch { return 0.0; }
        }

        /// <summary>
        /// Read a boolean telemetry variable. Returns false if not connected or not found.
        /// </summary>
        public bool GetBool(string name)
        {
            if (!IsConnected || _sdk?.Data == null) return false;
            try { return _sdk.Data.GetBool(name); }
            catch { return false; }
        }

        /// <summary>
        /// Read a float array telemetry variable (e.g. CarIdxLapDistPct).
        /// Returns empty array if not connected or not found.
        /// </summary>
        public float[] GetFloatArray(string name, int count)
        {
            if (!IsConnected || _sdk?.Data == null) return new float[0];
            try
            {
                var arr = new float[count];
                _sdk.Data.GetFloatArray(name, arr, 0, count);
                return arr;
            }
            catch { return new float[0]; }
        }

        /// <summary>
        /// Read an int array telemetry variable (e.g. CarIdxLapCompleted).
        /// Returns empty array if not connected or not found.
        /// </summary>
        public int[] GetIntArray(string name, int count)
        {
            if (!IsConnected || _sdk?.Data == null) return new int[0];
            try
            {
                var arr = new int[count];
                _sdk.Data.GetIntArray(name, arr, 0, count);
                return arr;
            }
            catch { return new int[0]; }
        }

        /// <summary>
        /// Read a bool array telemetry variable (e.g. CarIdxOnPitRoad).
        /// Returns empty array if not connected or not found.
        /// </summary>
        public bool[] GetBoolArray(string name, int count)
        {
            if (!IsConnected || _sdk?.Data == null) return new bool[0];
            try
            {
                var arr = new bool[count];
                _sdk.Data.GetBoolArray(name, arr, 0, count);
                return arr;
            }
            catch { return new bool[0]; }
        }

        /// <summary>
        /// Get the raw session info YAML string (for advanced parsing).
        /// </summary>
        public string GetSessionInfoYaml()
        {
            if (!IsConnected || _sdk?.Data == null) return null;
            try { return _sdk.Data.SessionInfoYaml; }
            catch { return null; }
        }

        // ═══════════════════════════════════════════════════════════════
        //  EVENT HANDLERS (called from IRSDKSharper background thread)
        // ═══════════════════════════════════════════════════════════════

        private void OnConnected()
        {
            IsConnected = true;
            SimHub.Logging.Current.Info("[RaceCorProDrive] iRacing SDK connected");
        }

        private void OnDisconnected()
        {
            IsConnected = false;
            SimHub.Logging.Current.Info("[RaceCorProDrive] iRacing SDK disconnected");
        }

        private void OnSessionInfo()
        {
            try
            {
                ParseSessionInfo();
            }
            catch (Exception ex)
            {
                SimHub.Logging.Current.Error("[RaceCorProDrive] Error parsing session info: " + ex.Message);
            }
        }

        // ═══════════════════════════════════════════════════════════════
        //  SESSION INFO PARSING
        // ═══════════════════════════════════════════════════════════════

        private void ParseSessionInfo()
        {
            if (_sdk?.Data?.SessionInfo == null) return;

            var si = _sdk.Data.SessionInfo;

            // ── Player car index ──
            if (si.DriverInfo != null)
            {
                PlayerCarIdx = si.DriverInfo.DriverCarIdx;

                // ── Driver ratings ──
                lock (_lock)
                {
                    _driverIRatings.Clear();

                    if (si.DriverInfo.Drivers != null)
                    {
                        foreach (var driver in si.DriverInfo.Drivers)
                        {
                            if (driver.IRating > 0)
                            {
                                _driverIRatings[driver.CarIdx] = driver.IRating;
                            }

                            // Player's own data
                            if (driver.CarIdx == PlayerCarIdx)
                            {
                                PlayerIRating = driver.IRating;
                                PlayerLicenseString = driver.LicString ?? "";

                                // Parse safety rating from license string (e.g. "A 3.41")
                                if (!string.IsNullOrEmpty(driver.LicString) && driver.LicString.Length >= 2)
                                {
                                    string numPart = driver.LicString.Substring(1).Trim();
                                    if (double.TryParse(numPart, NumberStyles.Float,
                                        CultureInfo.InvariantCulture, out double sr))
                                    {
                                        PlayerSafetyRating = sr;
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // ── Weekend options ──
            if (si.WeekendInfo != null)
            {
                // Standing start
                var opts = si.WeekendInfo.WeekendOptions;
                if (opts != null)
                {
                    IsStandingStart = opts.StandingStart == 1;

                    // Incident limits — iRacing returns "unlimited" or a number string
                    // IncidentLimit is the DQ threshold (e.g. "25" or "unlimited")
                    // There's no separate penalty/warn field in the SDK; iRacing
                    // only exposes the DQ limit. For higher DQ limits (>= 20),
                    // iRacing also enforces a penalty (drive-through) at ~68% —
                    // e.g. DQ 25 → penalty at 17. For lower limits (e.g. DQ 17),
                    // iRacing typically has DQ only with no separate penalty tier.
                    if (!string.IsNullOrEmpty(opts.IncidentLimit) &&
                        int.TryParse(opts.IncidentLimit, out int dqLimit) && dqLimit > 0)
                    {
                        IncidentLimitDQ = dqLimit;

                        if (dqLimit >= 20)
                        {
                            // Standard iRacing penalty threshold: ~68% of DQ limit, rounded to nearest odd
                            // e.g. 25 → 17
                            IncidentLimitPenalty = (int)Math.Round(dqLimit * 0.68);
                            if (IncidentLimitPenalty % 2 == 0) IncidentLimitPenalty--;
                            if (IncidentLimitPenalty < 1) IncidentLimitPenalty = 1;
                        }
                        else
                        {
                            // Lower DQ limits (e.g. 17, 8) — DQ only, no separate penalty
                            IncidentLimitPenalty = 0;
                        }
                    }
                    else
                    {
                        // "unlimited" or unparseable — no incident limits
                        IncidentLimitDQ = 0;
                        IncidentLimitPenalty = 0;
                    }
                }

                // Track country
                TrackCountry = TelemetrySnapshot.NormalizeCountryCode(si.WeekendInfo.TrackCountry ?? "");
            }

            // ── Sector boundaries ──
            // Don't hardcode sector boundaries here — let TelemetrySnapshot.Capture
            // resolve the cloud-configured sector count for this track.
            // Only set legacy 3-sector defaults as fallback display values.
            SectorS2StartPct = 1.0 / 3.0;
            SectorS3StartPct = 2.0 / 3.0;
        }

        // ═══════════════════════════════════════════════════════════════
        //  iRATING ESTIMATION (reused from IRatingEstimator logic)
        // ═══════════════════════════════════════════════════════════════

        /// <summary>
        /// Estimate the iRating change for the player at their current position.
        /// Uses the Elo-based formula from the original IRatingEstimator.
        /// </summary>
        public int EstimateIRatingDelta(int currentPosition)
        {
            if (PlayerIRating <= 0 || currentPosition <= 0)
                return 0;

            List<int> opponentRatings;
            int n;

            lock (_lock)
            {
                if (_driverIRatings.Count < 2) return 0;

                opponentRatings = _driverIRatings
                    .Where(kv => kv.Key != PlayerCarIdx && kv.Value > 0)
                    .Select(kv => kv.Value)
                    .ToList();

                n = _driverIRatings.Count;
            }

            if (opponentRatings.Count == 0) return 0;

            return IRatingEstimator.CalculateEstimatedDelta(
                PlayerIRating, currentPosition, opponentRatings, n);
        }
    }
}
