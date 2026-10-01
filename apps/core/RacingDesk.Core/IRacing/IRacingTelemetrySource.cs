using System;
using System.Collections.Generic;
using System.Globalization;
using IRSDKSharper;
using RacingDesk.Plugin.Engine;

namespace RacingDesk.Plugin.IRacing
{
    /// <summary>
    /// Presents raw iRacing telemetry in SimHub's vocabulary so <see cref="TelemetryCapture"/> runs unchanged
    /// without SimHub: normalized GameData fields, DataCorePlugin.GameRawData.Telemetry.* pass-through, and
    /// the handful of GameData / Computed / IRacingExtraProperties values capture reads.
    ///
    /// Call <see cref="Update"/> once per frame before handing the source to the runtime.
    ///
    /// Conventions were checked against SimHub 9.12 during a live session (npm run parity, 2026-09-17): TrackName
    /// is iRacing's internal track name; normalized fuel and tyre temperatures follow the display units (gallons
    /// and °F when imperial) while Computed.Fuel_LitersPerLap stays in litres; tyre wear is percent remaining.
    /// </summary>
    public sealed class IRacingTelemetrySource : ITelemetrySource, RacingDesk.Core.Cars.ICarIdentity
    {
        private const string RawPrefix = "DataCorePlugin.GameRawData.Telemetry.";

        private readonly IRawTelemetry _raw;
        private readonly NormalizedData _data = new NormalizedData();
        private readonly FuelPerLap _fuel = new FuelPerLap();

        private IRacingSdkSessionInfo _indexedSession;
        private readonly Dictionary<int, IRacingSdkSessionInfo.DriverInfoModel.DriverModel> _driversByCarIdx = new Dictionary<int, IRacingSdkSessionInfo.DriverInfoModel.DriverModel>();
        private IRacingSdkSessionInfo.DriverInfoModel.DriverModel _me;

        public IRacingTelemetrySource(IRawTelemetry raw)
        {
            _raw = raw ?? throw new ArgumentNullException(nameof(raw));
        }

        public bool GameRunning => _raw.IsConnected && _raw.SessionInfo != null;
        public string GameName => "IRacing";

        /// <summary>
        /// iRacing's folder name for the car the driver is in, e.g. "mx5 mx52016"; null until a frame has been
        /// read. Unlike the car's name it is the same whatever iRacing calls the car this season.
        /// </summary>
        public string CarPath => GameRunning ? _me?.CarPath?.Trim() : null;

        /// <summary>iRacing's TrackID: the exact layout. 0 until the session says.</summary>
        public int TrackId => GameRunning ? _raw.SessionInfo?.WeekendInfo?.TrackID ?? 0 : 0;

        /// <summary>The session runs a fixed setup: the garage's values are the series'. Null until the session says.</summary>
        public bool? FixedSetup
        {
            get
            {
                var options = GameRunning ? _raw.SessionInfo?.WeekendInfo?.WeekendOptions : null;
                return options == null ? (bool?)null : options.IsFixedSetup == 1;
            }
        }

        /// <summary>
        /// The car publishes an ABS setting the driver can turn. A car publishes only the controls it has, so
        /// this says the car has ABS; a car without the setting may still have ABS that cannot be adjusted,
        /// which shows as <see cref="AbsWorking"/>.
        /// </summary>
        public bool HasAbsSetting => GameRunning && _raw.GetValue("dcABS") != null;

        /// <summary>
        /// What a prototype gives its driver and a GT or touring car does not: a hybrid system, brake
        /// migration, a front anti-roll bar set from the seat. The sim has no word for what kind of car a car
        /// is — its class has no name in a test session, and the car's own in others — so the car is known by
        /// what it publishes.
        /// </summary>
        public static readonly string[] PrototypeControls = { "EnergyERSBattery", "dcBrakeMisc", "dcAntiRollFront" };

        /// <summary>The car publishes one of <see cref="PrototypeControls"/>.</summary>
        public bool HasPrototypeControls
        {
            get
            {
                if (!GameRunning) return false;
                foreach (string name in PrototypeControls)
                    if (_raw.GetValue(name) != null) return true;
                return false;
            }
        }

        /// <summary>The ABS is holding the brakes at this moment.</summary>
        public bool AbsWorking => GameRunning && Bool("BrakeABSactive");

        public int LapsCompleted => GameRunning ? Math.Max(0, Int("LapCompleted")) : 0;

        /// <summary>The driver is in the car, and not in the garage, at the menus or watching a replay.</summary>
        public bool Driving => GameRunning && Bool("IsOnTrack") && !Bool("IsReplayPlaying");

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
            bool imperial = Int("DisplayUnits") == 0;
            int lapCompleted = Int("LapCompleted");
            int sessionNum = Int("SessionNum");

            _data.SpeedKmh = Float("Speed") * 3.6;
            _data.Rpms = Float("RPM");
            _data.MaxRpm = si.DriverInfo?.DriverCarRedLine ?? 0;
            _data.Gear = gear < 0 ? "R" : gear == 0 ? "N" : gear.ToString(CultureInfo.InvariantCulture);
            _data.Throttle = Float("Throttle") * 100.0;
            _data.Brake = Float("Brake") * 100.0;
            _data.Clutch = (1.0 - Float("Clutch")) * 100.0; // iRacing: 1 = pedal up; SimHub: 0 = pedal up
            _data.Fuel = imperial ? fuel * LitresToGallons : fuel;
            _data.FuelPercent = Float("FuelLevelPct") * 100.0;
            _data.CurrentLap = Int("Lap");
            _data.CompletedLaps = lapCompleted;
            _data.TrackPositionPercent = Float("LapDistPct");
            _data.Position = Int("PlayerCarPosition");
            _data.IsInPit = Int("PlayerTrackSurface") == (int)IRacingSdkEnum.TrkLoc.InPitStall ? 1 : 0;
            _data.IsInPitLane = Bool("OnPitRoad") ? 1 : 0;
            _data.SessionTypeName = SessionType(si, sessionNum);
            _data.CarModel = _me?.CarScreenName ?? "";
            _data.PlayerName = _me?.UserName ?? "";
            _data.TyreWearFrontLeft = WearRemainingPercent("LF");
            _data.TyreWearFrontRight = WearRemainingPercent("RF");
            _data.TyreWearRearLeft = WearRemainingPercent("LR");
            _data.TyreWearRearRight = WearRemainingPercent("RR");

            _data.BestLapTime = Float("LapBestLapTime");
            _data.LastLapTime = Float("LapLastLapTime");
            _data.CurrentLapTime = Float("LapCurrentLapTime");
            _data.DeltaToSessionBestLap = Float("LapDeltaToSessionBestLap");
            _data.SessionTimeLeft = Double("SessionTimeRemain");
            _data.AirTemperature = Float("AirTemp");
            _data.RoadTemperature = Float("TrackTempCrew");
            _data.ABSActive = Bool("BrakeABSactive");
            _data.YawVelocity = Float("YawRate");
            _data.TyreTempFrontLeft = Temp(Float("LFtempCM"), imperial);
            _data.TyreTempFrontRight = Temp(Float("RFtempCM"), imperial);
            _data.TyreTempRearLeft = Temp(Float("LRtempCM"), imperial);
            _data.TyreTempRearRight = Temp(Float("RRtempCM"), imperial);

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
                case "DataCorePlugin.GameData.TrackName": return si.WeekendInfo?.TrackName;
                case "DataCorePlugin.GameData.TrackId": return si.WeekendInfo?.TrackName;
                case "DataCorePlugin.GameData.TrackConfig": return si.WeekendInfo?.TrackConfigName;
                case "DataCorePlugin.GameData.TrackCountry": return si.WeekendInfo?.TrackCountry;
                case "DataCorePlugin.GameData.FramesPerSecond": return (double)Float("FrameRate");
                case TelemetryCapture.TrackDisplayNameProperty: return si.WeekendInfo?.TrackDisplayName;
                case TelemetryCapture.TrackIdProperty: return si.WeekendInfo?.TrackID ?? 0;
                case TelemetryCapture.SectorBoundariesProperty:
                {
                    var sectors = si.SplitTimeInfo?.Sectors;
                    if (sectors == null) return null;
                    var starts = new List<double>();
                    foreach (var sector in sectors)
                        if (sector.SectorStartPct > 0 && sector.SectorStartPct < 1) starts.Add(sector.SectorStartPct);
                    starts.Sort();
                    return starts.ToArray();
                }

                case "DataCorePlugin.GameData.IRating":
                case "IRacingExtraProperties.iRacing_DriverInfo_IRating":
                    return _me?.IRating ?? 0;
                case "DataCorePlugin.GameData.SafetyRating":
                case "IRacingExtraProperties.iRacing_DriverInfo_SafetyRating":
                    return ParseSafetyRating(_me?.LicString);

                // The IRacingExtraProperties plugin isn't part of a SimHub install, so these read as absent there too;
                // capture then falls back to the opponents' gap-to-player.

                case "DataCorePlugin.Computed.Fuel_LitersPerLap": return _fuel.LitersPerLap;
                case "DataCorePlugin.GameData.RemainingLaps":
                    return _fuel.LitersPerLap > 0 ? Float("FuelLevel") / _fuel.LitersPerLap : 0.0;
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
            if (positions == null) return;

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
            }
        }

        private const double LitresToGallons = 0.264172;

        private static float Temp(float celsius, bool imperial) => imperial ? celsius * 9f / 5f + 32f : celsius;

        /// <summary>Average of the inner / middle / outer wear readings, as percent remaining.</summary>
        private double WearRemainingPercent(string corner)
        {
            float l = Float(corner + "wearL"), m = Float(corner + "wearM"), r = Float(corner + "wearR");
            return l + m + r > 0 ? (l + m + r) / 3.0 * 100.0 : 0.0;
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
