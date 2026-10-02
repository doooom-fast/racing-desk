using System;
using IRSDKSharper;
using RacingDesk.Core.Names;

namespace RacingDesk.Plugin.IRacing
{
    /// <summary>
    /// <see cref="IRawTelemetry"/> over iRacing's live shared memory (IRSDKSharper), and <see cref="IReplayControl"/>:
    /// the sim's replay and cameras driven through the SDK's broadcast messages. The messages go to the sim's window
    /// and nowhere else; each is sent only while the sim is connected, and only when asked by the host's replay route,
    /// which answers a program on this machine alone.
    /// </summary>
    public sealed class SdkRawTelemetry : IRawTelemetry, IReplayControl, IDisposable
    {
        private readonly IRacingSdk _sdk = new IRacingSdk(false, false);

        /// <summary>Raised on the SDK thread for every telemetry tick (60 Hz while connected).</summary>
        public event Action TelemetryData
        {
            add => _sdk.OnTelemetryData += value;
            remove => _sdk.OnTelemetryData -= value;
        }

        public event Action Connected { add => _sdk.OnConnected += value; remove => _sdk.OnConnected -= value; }
        public event Action Disconnected { add => _sdk.OnDisconnected += value; remove => _sdk.OnDisconnected -= value; }

        /// <summary>Starts reading the sim, and returns at once: see <see cref="SdkStart"/>.</summary>
        public void Start() => SdkStart.Start(_sdk);
        public void Stop() { if (_sdk.IsStarted) _sdk.Stop(); }
        public void Dispose() => Stop();

        public bool IsConnected => _sdk.IsConnected && _sdk.Data.TelemetryDataPropertiesReady;

        // Where other drivers' names enter the host's path, and where they are replaced: the parsed session model is given
        // its characters' names once per session-info update, before anything reads it (Names/SessionNaming, which watches
        // the object and the SDK's update count; the player's entry is left his).
        private readonly SessionNaming _naming = new SessionNaming();

        public IRacingSdkSessionInfo SessionInfo
        {
            get
            {
                if (!IsConnected) return null;
                var data = _sdk.Data;
                return _naming.Named(data.SessionInfo, data.SessionInfoUpdate);
            }
        }

        public object GetValue(string name)
        {
            if (!IsConnected || !_sdk.Data.TelemetryDataProperties.TryGetValue(name, out var datum)) return null;
            var data = _sdk.Data;
            int count = datum.Count;
            if (count <= 1)
            {
                switch (datum.VarType)
                {
                    case IRacingSdkEnum.VarType.Char: return data.GetChar(datum, 0);
                    case IRacingSdkEnum.VarType.Bool: return data.GetBool(datum, 0);
                    case IRacingSdkEnum.VarType.Int: return data.GetInt(datum, 0);
                    case IRacingSdkEnum.VarType.BitField: return unchecked((int)data.GetBitField(datum, 0));
                    case IRacingSdkEnum.VarType.Float: return data.GetFloat(datum, 0);
                    case IRacingSdkEnum.VarType.Double: return data.GetDouble(datum, 0);
                    default: return null;
                }
            }
            switch (datum.VarType)
            {
                case IRacingSdkEnum.VarType.Bool: { var a = new bool[count]; data.GetBoolArray(datum, a, 0, count); return a; }
                case IRacingSdkEnum.VarType.Int: { var a = new int[count]; data.GetIntArray(datum, a, 0, count); return a; }
                case IRacingSdkEnum.VarType.BitField:
                {
                    var u = new uint[count];
                    data.GetBitFieldArray(datum, u, 0, count);
                    var a = new int[count];
                    for (int i = 0; i < count; i++) a[i] = unchecked((int)u[i]);
                    return a;
                }
                case IRacingSdkEnum.VarType.Float: { var a = new float[count]; data.GetFloatArray(datum, a, 0, count); return a; }
                case IRacingSdkEnum.VarType.Double: { var a = new double[count]; data.GetDoubleArray(datum, a, 0, count); return a; }
                default: return null;
            }
        }

        // ── The replay and the cameras (IReplayControl) ──

        public ReplayStatus Status()
        {
            if (!IsConnected) return null;
            var s = new ReplayStatus
            {
                IsReplayPlaying = Bool("IsReplayPlaying"),
                IsOnTrack = Bool("IsOnTrack"),
                SessionNum = Int("SessionNum"),
                SessionTime = Double("SessionTime"),
                ReplaySessionNum = Int("ReplaySessionNum"),
                ReplaySessionTime = Double("ReplaySessionTime"),
                ReplayFrameNum = Int("ReplayFrameNum"),
                ReplayFrameNumEnd = Int("ReplayFrameNumEnd"),
                ReplayPlaySpeed = Int("ReplayPlaySpeed"),
                ReplayPlaySlowMotion = Bool("ReplayPlaySlowMotion"),
                CamGroupNumber = Int("CamGroupNumber"),
                CamCameraNumber = Int("CamCameraNumber"),
                CamCarIdx = Int("CamCarIdx"),
                CamCameraState = Int("CamCameraState"),
                PlayerCarIdx = Int("PlayerCarIdx"),
            };
            var si = SessionInfo;
            s.TrackName = si?.WeekendInfo?.TrackName;
            s.TrackDisplayName = si?.WeekendInfo?.TrackDisplayName;
            s.SubSessionId = si?.WeekendInfo?.SubSessionID ?? 0;
            var drivers = si?.DriverInfo?.Drivers;
            int myIdx = si?.DriverInfo?.DriverCarIdx ?? -1;
            if (drivers != null)
                foreach (var d in drivers)
                    if (d.CarIdx == myIdx) { s.PlayerCarNumber = d.CarNumber; s.PlayerCarNumberRaw = d.CarNumberRaw; }
            var groups = si?.CameraInfo?.Groups;
            if (groups != null)
                foreach (var g in groups)
                    s.Groups.Add(new ReplayCameraGroup { Num = g.GroupNum, Name = g.GroupName, Cameras = g.Cameras?.Count ?? 0 });
            return s;
        }

        public void SearchSessionTime(int sessionNum, int sessionTimeMs)
        {
            if (!IsConnected) return;
            _sdk.ReplaySearchSessionTime(sessionNum, sessionTimeMs);
        }

        public void SetPlaySpeed(int speed, bool slowMotion)
        {
            if (!IsConnected) return;
            _sdk.ReplaySetPlaySpeed(speed, slowMotion);
        }

        public void SetPlayPosition(ReplayPositionFrom from, int frame)
        {
            if (!IsConnected) return;
            var mode = from == ReplayPositionFrom.Begin ? IRacingSdkEnum.RpyPosMode.Begin
                : from == ReplayPositionFrom.End ? IRacingSdkEnum.RpyPosMode.End
                : IRacingSdkEnum.RpyPosMode.Current;
            _sdk.ReplaySetPlayPosition(mode, frame);
        }

        public void SwitchCamera(ReplayCameraFocus focus, int group, int camera)
        {
            if (!IsConnected) return;
            // IRSDKSharper sends the mode's value for every focus but the driver's, and the car position given here for that
            // one — and the position is 0 below, which is no car's position. So the driver's focus is not "the player's own
            // car": it keeps the camera on whichever car it is on. To follow the player's car, SwitchCameraToCar with the
            // player's car number (the replay route takes `carNumber`).
            var mode = focus == ReplayCameraFocus.Leader ? IRacingSdkEnum.CamSwitchMode.FocusAtLeader
                : focus == ReplayCameraFocus.Incident ? IRacingSdkEnum.CamSwitchMode.FocusAtIncident
                : focus == ReplayCameraFocus.Exiting ? IRacingSdkEnum.CamSwitchMode.FocusAtExiting
                : IRacingSdkEnum.CamSwitchMode.FocusAtDriver;
            _sdk.CamSwitchPos(mode, 0, group, camera);
        }

        public void SwitchCameraToCar(int carNumberRaw, int group, int camera)
        {
            if (!IsConnected) return;
            _sdk.CamSwitchNum(IRacingSdkEnum.CamSwitchMode.FocusAtDriver, carNumberRaw, group, camera);
        }

        public void SetCameraState(int state)
        {
            if (!IsConnected) return;
            _sdk.CamSetState((IRacingSdkEnum.CameraState)state);
        }

        private int Int(string name) { var v = GetValue(name); return v is int i ? i : v is bool b ? (b ? 1 : 0) : 0; }
        private double Double(string name) { var v = GetValue(name); return v is double d ? d : v is float f ? f : v is int i ? i : 0.0; }
        private bool Bool(string name) { var v = GetValue(name); return v is bool b ? b : v is int i && i != 0; }
    }
}
