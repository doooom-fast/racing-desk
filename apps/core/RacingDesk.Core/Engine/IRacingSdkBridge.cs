// ═══════════════════════════════════════════════════════════════
// The Racing Desk — iRacing SDK Bridge
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
using RacingDesk.Core.Names;
using RacingDesk.Plugin.IRacing;

namespace RacingDesk.Plugin.Engine
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

        /// <summary>The sim's folder for the car the driver is in, e.g. "mx5 mx52016"; null until the session says.</summary>
        public string PlayerCarPath { get; private set; }

        /// <summary>The session runs a fixed setup; null until the session says.</summary>
        public bool? IsFixedSetup { get; private set; }
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

        // ── Other drivers' names (root CLAUDE.md, Other drivers' names) ──
        // The plugin's path: SimHub hands the engine its opponents with their real names, and the engine asks the source what
        // to call each (SimHubTelemetrySource, through Names/SimHubNaming, which asks this bridge). The session YAML, read
        // here, names every other car by its customer id (Names/Pseudonymizer.NameField, the field as a whole), and the car
        // is found again by the name SimHub gives it, or failing that by its number — a lookup that stays inside this
        // bridge. Until the YAML has been read nobody is named (null): SimHub's word for who is who is not trusted, since a
        // teammate may be driving his car and a camera may be on another. The real names are held nowhere else and leave by
        // no property of this class.
        private Pseudonymizer _names;
        private readonly Dictionary<string, string> _nameByCarNumber = new Dictionary<string, string>(StringComparer.Ordinal);
        private readonly Dictionary<string, string> _nameByRealName = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        private bool _fieldNamed;
        private string _playerRealName;
        // His car's name while a teammate drives it (a team race): the teammate is another driver.
        private string _playerCarShown;
        // His car's number while he is the one in it (the session says so: Pseudonymizer.IsHim). His own car with him in it
        // is his, whatever SimHub calls him: a SimHub name not quite the session's is not another driver (he said on
        // 2026-10-03: "don't change my name in the leaderboard").
        private string _playerCarNumber;
        private System.Diagnostics.Stopwatch _unnamedFor;
        private bool _unnamedWarned;

        /// <summary>Whether the session YAML has been read and the field named: before it, no one can be named.</summary>
        public bool FieldNamed { get { lock (_lock) return _fieldNamed; } }

        /// <summary>
        /// What a SimHub opponent is called: his own name when it is the name the session gives him, and for every other
        /// the character's — by the session's customer id for the car with this name or, failing that, this number; for a
        /// car the session does not list, by the name itself, salted. Never another driver's real name: not in his own car
        /// when a teammate is the one driving it, and not on a car SimHub flags as the player's that is not his (the
        /// player's own is told by the name, not by SimHub's flag). Null until the session has been read.
        /// </summary>
        public string OpponentName(string carNumber, string name, bool isPlayer)
        {
            lock (_lock)
            {
                if (!_fieldNamed) { NoteUnnamed(); return null; }
                string trimmedName = (name ?? "").Trim();
                if (IsHisName(trimmedName)) return name;
                string number = CarNumberKey(carNumber);
                if (_playerCarNumber != null && number.Length > 0 && number == _playerCarNumber) return trimmedName.Length > 0 ? name : (_playerRealName ?? "");
                if (trimmedName.Length > 0 && _nameByRealName.TryGetValue(trimmedName, out string byName)) return byName;
                if (number.Length > 0 && _nameByCarNumber.TryGetValue(number, out string byNumber)) return byNumber;
                if (isPlayer && _playerCarShown != null) return _playerCarShown;
                return (_names ?? (_names = PseudonymBook.Default.NewSession())).For(0, trimmedName);
            }
        }

        /// <summary>
        /// What the player is called: <paramref name="given"/> (SimHub's PlayerName) when it is the name the session gives
        /// him; when it is not — a teammate driving his car — the character's. Empty until the session has been read, so
        /// that the name in Settings stands in for it.
        /// </summary>
        public string PlayerName(string given)
        {
            lock (_lock)
            {
                if (!_fieldNamed) { NoteUnnamed(); return ""; }
                string g = (given ?? "").Trim();
                if (g.Length == 0 || IsHisName(g)) return given ?? "";
                if (_nameByRealName.TryGetValue(g, out string byName)) return byName;
                if (_playerCarShown != null) return _playerCarShown;
                // He is in his car: the player is him, whatever SimHub calls him.
                if (_playerCarNumber != null) return given;
                return (_names ?? (_names = PseudonymBook.Default.NewSession())).For(0, g);
            }
        }

        private bool IsHisName(string trimmedName) =>
            trimmedName.Length > 0 && _playerRealName != null &&
            string.Equals(trimmedName, _playerRealName, StringComparison.OrdinalIgnoreCase);

        // iRacing is on and asked for names, and the session has not been read: said once if it stays so, for it means the
        // bridge cannot read the sim and no other driver is shown at all.
        private void NoteUnnamed()
        {
            if (_unnamedWarned) return;
            if (_unnamedFor == null) { _unnamedFor = System.Diagnostics.Stopwatch.StartNew(); return; }
            if (_unnamedFor.Elapsed < TimeSpan.FromSeconds(30)) return;
            _unnamedWarned = true;
            Log.Warn("[RacingDesk] names: iRacing's session has not been read for 30 s, so no other driver can be named and none is shown");
        }

        // Called with _lock held.
        private void NameTheField(IRacingSdkSessionInfo si)
        {
            var names = _names ?? (_names = PseudonymBook.Default.NewSession());
            names.BeginSession(Pseudonymizer.SessionKeyOf(si));
            _nameByCarNumber.Clear();
            _nameByRealName.Clear();
            _playerRealName = null;
            _playerCarShown = null;
            _playerCarNumber = null;
            var di = si.DriverInfo;
            var drivers = di?.Drivers;
            if (drivers != null)
            {
                foreach (var d in drivers)
                {
                    if (d == null || d.CarIsPaceCar != 0 || !Pseudonymizer.IsHim(di, d)) continue;
                    string real = (d.UserName ?? "").Trim();
                    _playerRealName = real.Length > 0 ? real : null;
                    _playerCarNumber = CarNumberKey(d.CarNumber);
                    if (_playerCarNumber.Length == 0) _playerCarNumber = null;
                }
                foreach (var named in names.NameField(si))
                {
                    var d = named.Driver;
                    string real = (d.UserName ?? "").Trim();
                    string shown = named.Shown;
                    if (d.CarIdx == di.DriverCarIdx) _playerCarShown = shown;
                    string number = CarNumberKey(d.CarNumber);
                    if (number.Length > 0) _nameByCarNumber[number] = shown;
                    if (real.Length > 0) _nameByRealName[real] = shown;
                }
            }
            _fieldNamed = true;
            _unnamedFor = null;
            _unnamedWarned = false;
        }

        // A car number as both sides write it: SimHub's "#12" and the session's "12" are one car ("007" and "7" are two).
        private static string CarNumberKey(string number) => (number ?? "").Trim().TrimStart('#').Trim();

        private void ForgetTheField()
        {
            lock (_lock)
            {
                _nameByCarNumber.Clear();
                _nameByRealName.Clear();
                _playerRealName = null;
                _playerCarShown = null;
                _playerCarNumber = null;
                _fieldNamed = false;
                _unnamedFor = null;
                _unnamedWarned = false;
            }
        }

        // Track info
        public string TrackCountry { get; private set; } = "";
        public string TrackDisplayName { get; private set; } = "";
        /// <summary>
        /// iRacing's TrackID, the exact layout: what the track map is keyed by. 0 until the session says, and again
        /// from the moment the sim goes: the session of the sim that has closed is not the one the next will have.
        /// </summary>
        public int TrackId { get; internal set; }
        /// <summary>The layout's length as the session YAML gives it ("4.02 km"), in metres; 0 until the session says.</summary>
        public double TrackLengthMeters { get; internal set; }

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

            // Not _sdk.Start() alone: its wait can last for ever, and this is the host's main thread, or SimHub's
            // plugin Init (IRacing/SdkStart.cs).
            SdkStart.Start(_sdk);
            IsStarted = true;

            Log.Info("[RacingDesk] IRacingSdkBridge started");
        }

        /// <summary>
        /// Takes its facts from the host's own reader of the sim instead of a reader of its own (<see cref="Start"/> is not
        /// called): connected and gone as that reader is, and the session as it parses it, every other driver renamed. One
        /// reader of iRacing in the host, and the session YAML parsed once — at 63 cars it is some 30 ms and 13 MB a time.
        /// </summary>
        public void Follow(SdkRawTelemetry raw)
        {
            if (raw == null) throw new ArgumentNullException(nameof(raw));
            raw.Connected += OnConnected;
            raw.Disconnected += OnDisconnected;
            raw.SessionInfoRead += si =>
            {
                try
                {
                    ParseSessionInfo(si);
                }
                catch (Exception ex)
                {
                    Log.Error("[RacingDesk] Error parsing session info: " + ex.Message);
                }
            };
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
                Log.Error("[RacingDesk] Error stopping SDK: " + ex.Message);
            }

            IsStarted = false;
            IsConnected = false;
            TrackId = 0;
            TrackLengthMeters = 0;
            ForgetTheField();

            Log.Info("[RacingDesk] IRacingSdkBridge stopped");
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

        // The raw session YAML (GetSessionInfoYaml) is no longer handed out: it carries every driver's real name, and
        // nothing read it. What the YAML says comes out of this class as the parsed facts below, with the names replaced.

        // ═══════════════════════════════════════════════════════════════
        //  EVENT HANDLERS (called from IRSDKSharper background thread)
        // ═══════════════════════════════════════════════════════════════

        internal void OnConnected()
        {
            IsConnected = true;
            Log.Info("[RacingDesk] iRacing SDK connected");
        }

        internal void OnDisconnected()
        {
            IsConnected = false;
            // The layout the sim had is not the layout the next sim will have, and the session of the next is not
            // parsed until a moment after it connects: until then the map has no layout to ask for, not the old one.
            TrackId = 0;
            TrackLengthMeters = 0;
            ForgetTheField();
            Log.Info("[RacingDesk] iRacing SDK disconnected");
        }

        private void OnSessionInfo()
        {
            try
            {
                ParseSessionInfo(_sdk?.Data?.SessionInfo);
            }
            catch (Exception ex)
            {
                Log.Error("[RacingDesk] Error parsing session info: " + ex.Message);
            }
        }

        /// <summary>Reads a session as the SDK would hand it over: for tests, which have no sim.</summary>
        internal void ApplySessionInfo(IRacingSdkSessionInfo si) => ParseSessionInfo(si);

        // ═══════════════════════════════════════════════════════════════
        //  SESSION INFO PARSING
        // ═══════════════════════════════════════════════════════════════

        private void ParseSessionInfo(IRacingSdkSessionInfo si)
        {
            if (si == null) return;

            // ── Sector boundaries (SplitTimeInfo) ──
            var sectors = si.SplitTimeInfo?.Sectors;
            if (sectors != null && sectors.Count >= 2)
            {
                var starts = new List<double>();
                foreach (var sector in sectors)
                    if (sector.SectorStartPct > 0 && sector.SectorStartPct < 1) starts.Add(sector.SectorStartPct);
                starts.Sort();
                SectorBoundaries = starts.ToArray();
                SectorCount = starts.Count + 1;
                SectorS2StartPct = starts.Count > 0 ? starts[0] : 0;
                SectorS3StartPct = starts.Count > 1 ? starts[1] : 0;
                HasSectorBoundaries = starts.Count > 0;
            }

            // ── Player car index ──
            if (si.DriverInfo != null)
            {
                PlayerCarIdx = si.DriverInfo.DriverCarIdx;

                // ── Driver ratings, and the names the other drivers go by ──
                lock (_lock)
                {
                    _driverIRatings.Clear();
                    NameTheField(si);

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
                                PlayerCarPath = string.IsNullOrWhiteSpace(driver.CarPath) ? null : driver.CarPath.Trim();
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
                    IsFixedSetup = opts.IsFixedSetup == 1;

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
                TrackDisplayName = si.WeekendInfo.TrackDisplayName ?? "";
                TrackId = si.WeekendInfo.TrackID;
                string length = si.WeekendInfo.TrackLength ?? "";
                TrackLengthMeters = double.TryParse(length.Split(' ')[0], NumberStyles.Float, CultureInfo.InvariantCulture, out double km) ? km * 1000 : 0;
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
