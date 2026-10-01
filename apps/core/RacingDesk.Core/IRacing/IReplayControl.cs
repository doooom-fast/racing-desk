using System.Collections.Generic;

namespace RacingDesk.Plugin.IRacing
{
    /// <summary>
    /// iRacing's replay and cameras, driven through the SDK's own broadcast messages (ReplaySearchSessionTime,
    /// ReplaySetPlaySpeed, ReplaySetPlayPosition, CamSwitchPos, CamSwitchNum) — what the TV shots are made with: a moment
    /// in a recording's telemetry sidecar is found again in the replay by its SessionNum and SessionTime, and recorded
    /// from a TV camera. The live reader (<see cref="SdkRawTelemetry"/>) is the one implementation that reaches the sim;
    /// a replay of an .ibt has none, and the tests use fakes, so no message is ever sent to iRacing from a test.
    /// Every call is a request to the sim and returns at once; <see cref="Status"/> says what the sim has done.
    /// </summary>
    public interface IReplayControl
    {
        /// <summary>The sim is running and its telemetry readable.</summary>
        bool IsConnected { get; }

        /// <summary>Where the replay and the cameras stand, or null when the sim is not connected.</summary>
        ReplayStatus Status();

        /// <summary>Seek the replay to a session's time (ReplaySearchSessionTime: the session number, and milliseconds into it).</summary>
        void SearchSessionTime(int sessionNum, int sessionTimeMs);

        /// <summary>Play at a speed (1 is real time, 0 is paused, negative is backwards; <paramref name="slowMotion"/> divides).</summary>
        void SetPlaySpeed(int speed, bool slowMotion);

        /// <summary>Jump to a frame counted from the start, the current position or the end (ReplaySetPlayPosition).</summary>
        void SetPlayPosition(ReplayPositionFrom from, int frame);

        /// <summary>Switch the camera to a focus — the player's own car, the leader, the incident, the car exiting — in a camera group.</summary>
        void SwitchCamera(ReplayCameraFocus focus, int group, int camera);

        /// <summary>Switch the camera to a car by its number (CamSwitchNum), in a camera group.</summary>
        void SwitchCameraToCar(int carNumberRaw, int group, int camera);
    }

    public enum ReplayPositionFrom { Begin, Current, End }

    public enum ReplayCameraFocus { Driver, Leader, Incident, Exiting }

    /// <summary>A camera group of the session (CameraInfo.Groups): its number, as the switch takes it, and its name ("TV1", "Cockpit").</summary>
    public sealed class ReplayCameraGroup
    {
        public int Num { get; set; }
        public string Name { get; set; }
        public int Cameras { get; set; }
    }

    /// <summary>What the sim says of its replay and cameras, as the telemetry has it.</summary>
    public sealed class ReplayStatus
    {
        public bool IsReplayPlaying { get; set; }
        public bool IsOnTrack { get; set; }
        public int SessionNum { get; set; }
        public double SessionTime { get; set; }
        public int ReplaySessionNum { get; set; }
        public double ReplaySessionTime { get; set; }
        public int ReplayFrameNum { get; set; }
        public int ReplayFrameNumEnd { get; set; }
        public int ReplayPlaySpeed { get; set; }
        public bool ReplayPlaySlowMotion { get; set; }
        public int CamGroupNumber { get; set; }
        public int CamCameraNumber { get; set; }
        public int CamCarIdx { get; set; }
        public int PlayerCarIdx { get; set; }
        public string PlayerCarNumber { get; set; }
        public int PlayerCarNumberRaw { get; set; }
        public List<ReplayCameraGroup> Groups { get; } = new List<ReplayCameraGroup>();
    }
}
