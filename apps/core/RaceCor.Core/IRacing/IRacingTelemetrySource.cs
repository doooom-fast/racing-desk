using System;
using System.Collections.Generic;
using System.Globalization;
using IRSDKSharper;
using RaceCorProDrive.Plugin.Engine;

namespace RaceCorProDrive.Plugin.IRacing
{
    /// <summary>
    /// Presents raw iRacing telemetry in SimHub's vocabulary so <see cref="TelemetryCapture"/> runs unchanged
    /// without SimHub: normalized GameData fields, DataCorePlugin.GameRawData.Telemetry.* pass-through, and
    /// the handful of GameData / Computed / IRacingExtraProperties values capture reads.
    ///
    /// Call <see cref="Update"/> once per frame before handing the source to the runtime.
    ///
    /// Where SimHub's exact convention for iRacing is unverified the choice is marked "parity:" — confirm by
    /// running the standalone host beside SimHub during a live session and diffing the :8889 payloads.
    /// </summary>
    public sealed class IRacingTelemetrySource : ITelemetrySource
    {
        private const string RawPrefix = "DataCorePlugin.GameRawData.Telemetry.";

        private readonly IRawTelemetry _raw;
        private readonly NormalizedData _data = new NormalizedData();
        private readonly FuelPerLap _fuel = new FuelPerLap();

        private IRacingSdkSessionInfo _indexedSession;
        private readonly Dictionary<int, IRacingSdkSessionInfo.DriverInfoModel.DriverModel> _driversByCarIdx = new Dictionary<int, IRacingSdkSessionInfo.DriverInfoModel.DriverModel>();
        private IRacingSdkSessionInfo.DriverInfoModel.DriverModel _me;
        private double _gapAhead, _gapBehind;

        public IRacingTelemetrySource(IRawTelemetry raw)
        {
            _raw = raw ?? throw new ArgumentNullException(nameof(raw));
        }

        public bool GameRunning => _raw.IsConnected && _raw.SessionInfo != null;
        public string GameName => "IRacing";
        public object NewData => GameRunning ? _data : null;

        /// <summary>Recompute normalized data and derived values for the current frame.</summary>
        public void Update()
        {
            if (!GameRunning) return;
            var si = _raw.SessionInfo;
            IndexDrivers(si);

            int myIdx = si.DriverInfo?.DriverCarIdx ?? -1;
            int gear = Int("Gear");
            float fuel = Float("FuelLevel");
            int lapCompleted = Int("LapCompleted");
            int sessionNum = Int("SessionNum");

            _data.SpeedKmh = Float("Speed") * 3.6;
            _data.Rpms = Float("RPM");
            _data.MaxRpm = si.DriverInfo?.DriverCarRedLine ?? 0;
            _data.Gear = gear < 0 ? "R" : gear == 0 ? "N" : gear.ToString(CultureInfo.InvariantCulture);
            _data.Throttle = Float("Throttle") * 100.0;
            _data.Brake = Float("Brake") * 100.0;
            _data.Clutch = (1.0 - Float("Clutch")) * 100.0; // iRacing: 1 = pedal up; SimHub: 0 = pedal up
            _data.Fuel = fuel;
            _data.FuelPercent = Float("FuelLevelPct") * 100.0;
            _data.CurrentLap = Int("Lap");
            _data.CompletedLaps = lapCompleted;
            _data.TrackPositionPercent = Float("LapDistPct");
            _data.Position = Int("PlayerCarPosition");
            _data.IsInPit = Int("PlayerTrackSurface") == (int)IRacingSdkEnum.TrkLoc.InPitStall ? 1 : 0;
            _data.IsInPitLane = Bool("OnPitRoad") ? 1 : 0;
            _data.SessionTypeName = SessionType(si, sessionNum);
            _data.CarModel = _me?.CarScreenName ?? ""; // parity: SimHub may use CarPath or a friendlier name
            _data.PlayerName = _me?.UserName ?? "";
            // Tyre wear is left at 0 so capture uses its raw per-zone iRacing wear fallback.

            _data.BestLapTime = Float("LapBestLapTime");
            _data.LastLapTime = Float("LapLastLapTime");
            _data.CurrentLapTime = Float("LapCurrentLapTime");
            _data.DeltaToSessionBestLap = Float("LapDeltaToSessionBestLap");
            _data.SessionTimeLeft = Double("SessionTimeRemain");
            _data.AirTemperature = Float("AirTemp");
            _data.RoadTemperature = Float("TrackTempCrew");
            _data.ABSActive = Bool("BrakeABSactive");
            _data.VelocityX = Float("VelocityX");
            _data.VelocityZ = Float("VelocityZ");
            _data.Yaw = Float("Yaw");
            _data.YawVelocity = Float("YawRate");
            _data.TyreTempFrontLeft = Float("LFtempCM");
            _data.TyreTempFrontRight = Float("RFtempCM");
            _data.TyreTempRearLeft = Float("LRtempCM");
            _data.TyreTempRearRight = Float("RRtempCM");

            BuildOpponents(myIdx);
            _fuel.Update(lapCompleted, fuel, Bool("OnPitRoad"));
        }

        public object GetPropertyValue(string fullName)
        {
            if (!GameRunning || string.IsNullOrEmpty(fullName)) return null;
            if (fullName.StartsWith(RawPrefix, StringComparison.Ordinal))
                return _raw.GetValue(fullName.Substring(RawPrefix.Length));

            var si = _raw.SessionInfo;
            switch (fullName)
            {
                // parity: SimHub's iRacing TrackName is assumed to be the display name, TrackId the internal name.
                case "DataCorePlugin.GameData.TrackName": return si.WeekendInfo?.TrackDisplayName;
                case "DataCorePlugin.GameData.TrackId": return si.WeekendInfo?.TrackName;
                case "DataCorePlugin.GameData.TrackConfig": return si.WeekendInfo?.TrackConfigName;
                case "DataCorePlugin.GameData.TrackCountry": return si.WeekendInfo?.TrackCountry;
                case "DataCorePlugin.GameData.FramesPerSecond": return (double)Float("FrameRate");

                case "DataCorePlugin.GameData.IRating":
                case "IRacingExtraProperties.iRacing_DriverInfo_IRating":
                    return _me?.IRating ?? 0;
                case "DataCorePlugin.GameData.SafetyRating":
                case "IRacingExtraProperties.iRacing_DriverInfo_SafetyRating":
                    return ParseSafetyRating(_me?.LicString);

                case "IRacingExtraProperties.iRacing_Opponent_Ahead_Gap": return _gapAhead;
                case "IRacingExtraProperties.iRacing_Opponent_Behind_Gap": return _gapBehind;

                case "DataCorePlugin.Computed.Fuel_LitersPerLap": return _fuel.LitersPerLap;
                case "DataCorePlugin.GameData.RemainingLaps":
                    return _fuel.LitersPerLap > 0 ? _data.Fuel / _fuel.LitersPerLap : 0.0;
                case "DataCorePlugin.GameData.TotalLaps":
                {
                    int total = Int("SessionLapsTotal");
                    return total > 0 && total < 32767 ? (double)total : 0.0; // 32767 = unlimited
                }
                default:
                    return null;
            }
        }

        private void IndexDrivers(IRacingSdkSessionInfo si)
        {
            if (ReferenceEquals(si, _indexedSession)) return;
            _indexedSession = si;
            _driversByCarIdx.Clear();
            var drivers = si.DriverInfo?.Drivers;
            if (drivers != null)
                foreach (var d in drivers) _driversByCarIdx[d.CarIdx] = d;
            int myIdx = si.DriverInfo?.DriverCarIdx ?? -1;
            _driversByCarIdx.TryGetValue(myIdx, out _me);
        }

        private void BuildOpponents(int myIdx)
        {
            var positions = _raw.GetValue("CarIdxPosition") as int[];
            var f2 = _raw.GetValue("CarIdxF2Time") as float[];
            var best = _raw.GetValue("CarIdxBestLapTime") as float[];
            var last = _raw.GetValue("CarIdxLastLapTime") as float[];
            var onPit = _raw.GetValue("CarIdxOnPitRoad") as bool[];

            _data.Opponents.Clear();
            _gapAhead = _gapBehind = 0;
            if (positions == null) return;

            int myPos = _data.Position;
            float myF2 = f2 != null && myIdx >= 0 && myIdx < f2.Length ? f2[myIdx] : 0;

            foreach (var kv in _driversByCarIdx)
            {
                int idx = kv.Key;
                var d = kv.Value;
                if (d.IsSpectator != 0 || d.CarIsPaceCar != 0 || idx < 0 || idx >= positions.Length) continue;
                int pos = positions[idx];
                if (pos <= 0) continue;

                double gap = f2 != null && idx < f2.Length ? Math.Abs(f2[idx] - myF2) : 0;
                var opp = new OpponentData
                {
                    CarIdx = idx,
                    Position = pos,
                    Name = d.UserName ?? "",
                    IRating = d.IRating,
                    LicenseSafetyRating = ParseSafetyRating(d.LicString),
                    GapToPlayer = gap,
                    BestLapTime = Seconds(best, idx),
                    LastLapTime = Seconds(last, idx),
                    IsInPit = onPit != null && idx < onPit.Length && onPit[idx],
                    IsPlayer = idx == myIdx,
                };
                _data.Opponents.Add(opp);
                if (myPos > 0 && pos == myPos - 1) _gapAhead = gap;
                if (myPos > 0 && pos == myPos + 1) _gapBehind = gap;
            }
        }

        private static TimeSpan Seconds(float[] arr, int idx) =>
            arr != null && idx < arr.Length && arr[idx] > 0 ? TimeSpan.FromSeconds(arr[idx]) : TimeSpan.Zero;

        private static string SessionType(IRacingSdkSessionInfo si, int sessionNum)
        {
            var sessions = si.SessionInfo?.Sessions;
            if (sessions == null) return "";
            foreach (var s in sessions)
                if (s.SessionNum == sessionNum) return s.SessionType ?? "";
            return "";
        }

        /// <summary>"A 3.41" → 3.41</summary>
        internal static double ParseSafetyRating(string licString)
        {
            if (string.IsNullOrEmpty(licString)) return 0;
            int space = licString.IndexOf(' ');
            string num = space >= 0 ? licString.Substring(space + 1) : licString;
            return double.TryParse(num, NumberStyles.Float, CultureInfo.InvariantCulture, out double sr) ? sr : 0;
        }

        private int Int(string name) { var v = _raw.GetValue(name); return v is int i ? i : v is bool b ? (b ? 1 : 0) : 0; }
        private float Float(string name) { var v = _raw.GetValue(name); return v is float f ? f : v is double d ? (float)d : v is int i ? i : 0f; }
        private double Double(string name) { var v = _raw.GetValue(name); return v is double d ? d : v is float f ? f : 0.0; }
        private bool Bool(string name) { var v = _raw.GetValue(name); return v is bool b ? b : v is int i && i != 0; }

        /// <summary>Normalized game data, named after SimHub's StatusDataBase so capture reads it by name.</summary>
        public sealed class NormalizedData
        {
            public double SpeedKmh { get; set; }
            public double Rpms { get; set; }
            public double MaxRpm { get; set; }
            public string Gear { get; set; } = "N";
            public double Throttle { get; set; }
            public double Brake { get; set; }
            public double Clutch { get; set; }
            public double Fuel { get; set; }
            public double FuelPercent { get; set; }
            public int CurrentLap { get; set; }
            public int CompletedLaps { get; set; }
            public double TrackPositionPercent { get; set; }
            public int Position { get; set; }
            public int IsInPit { get; set; }
            public int IsInPitLane { get; set; }
            public string SessionTypeName { get; set; } = "";
            public string CarModel { get; set; } = "";
            public string PlayerName { get; set; } = "";
            public double TyreWearFrontLeft { get; set; }
            public double TyreWearFrontRight { get; set; }
            public double TyreWearRearLeft { get; set; }
            public double TyreWearRearRight { get; set; }
            public float BestLapTime { get; set; }
            public float LastLapTime { get; set; }
            public float CurrentLapTime { get; set; }
            public float DeltaToSessionBestLap { get; set; }
            public double SessionTimeLeft { get; set; }
            public float AirTemperature { get; set; }
            public float RoadTemperature { get; set; }
            public bool ABSActive { get; set; }
            public bool TCActive { get; set; }
            public float VelocityX { get; set; }
            public float VelocityZ { get; set; }
            public float Yaw { get; set; }
            public float YawVelocity { get; set; }
            public float TyreTempFrontLeft { get; set; }
            public float TyreTempFrontRight { get; set; }
            public float TyreTempRearLeft { get; set; }
            public float TyreTempRearRight { get; set; }
            public List<OpponentData> Opponents { get; } = new List<OpponentData>();
        }

        public sealed class OpponentData
        {
            public int CarIdx { get; set; }
            public int Position { get; set; }
            public string Name { get; set; }
            public int IRating { get; set; }
            public double LicenseSafetyRating { get; set; }
            public double GapToPlayer { get; set; }
            public TimeSpan BestLapTime { get; set; }
            public TimeSpan LastLapTime { get; set; }
            public bool IsInPit { get; set; }
            public bool IsPlayer { get; set; }
        }

        /// <summary>Rolling average of fuel used per green lap (last 5), ignoring laps where fuel was added.</summary>
        private sealed class FuelPerLap
        {
            private readonly Queue<double> _laps = new Queue<double>();
            private int _lastLap = -1;
            private double _fuelAtLapStart;
            private bool _pittedThisLap;

            public double LitersPerLap { get; private set; }

            public void Update(int lapCompleted, double fuel, bool onPitRoad)
            {
                if (onPitRoad) _pittedThisLap = true;
                if (_lastLap < 0 || lapCompleted < _lastLap)
                {
                    _lastLap = lapCompleted;
                    _fuelAtLapStart = fuel;
                    _pittedThisLap = onPitRoad;
                    return;
                }
                if (lapCompleted == _lastLap) return;

                double used = _fuelAtLapStart - fuel;
                if (!_pittedThisLap && used > 0)
                {
                    _laps.Enqueue(used);
                    while (_laps.Count > 5) _laps.Dequeue();
                    double sum = 0;
                    foreach (var l in _laps) sum += l;
                    LitersPerLap = sum / _laps.Count;
                }
                _lastLap = lapCompleted;
                _fuelAtLapStart = fuel;
                _pittedThisLap = onPitRoad;
            }
        }
    }
}
