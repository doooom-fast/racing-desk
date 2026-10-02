using System;

namespace RacingDesk.Data.Restore
{
    /// <summary>
    /// What Racing Desk has kept in one car's camera file (schema v9, <c>car_view_keep</c>): the cockpit camera's height,
    /// split into his own (what the file held before Racing Desk first wrote it, or after he saved it himself since) and
    /// what Racing Desk has added on top, so that the view kept for the car never counts the same height twice and undo
    /// can tell the two apart. A write under way is written down first (<see cref="Intent"/>), so that a host that stops
    /// half-way finishes or rolls it back at its next start.
    /// </summary>
    public sealed class CarViewKeep
    {
        public string CarPath { get; set; }

        /// <summary>The file, from <c>Documents\iRacing</c>: <c>cameras\cars\porsche963gtp\car.cam</c>, or the one camera.ini's LastCarSet names.</summary>
        public string CamFile { get; set; }

        /// <summary>His own cockpit Z, metres: the file's before Racing Desk wrote it, or his own save since.</summary>
        public double? OwnZ { get; set; }

        /// <summary>The height Racing Desk has added on top of <see cref="OwnZ"/>.</summary>
        public double AddedZ { get; set; }

        public double? WrittenZ { get; set; }

        /// <summary>SHA-256 of the file as Racing Desk last wrote it: a file that differs is his own save.</summary>
        public string WrittenSha { get; set; }
        public DateTime? WrittenAtUtc { get; set; }

        /// <summary>The horizon, kept the same way in the cockpit's vertical shift (+84), with its own switch.</summary>
        public double? OwnVerticalShift { get; set; }
        public double AddedVerticalShift { get; set; }
        public double? WrittenVerticalShift { get; set; }

        /// <summary>The first original of the file, kept for ever.</summary>
        public string OriginalBackup { get; set; }

        /// <summary>A change not yet kept; it expires when the car is next driven (it would otherwise be added twice).</summary>
        public double? PendingD { get; set; }
        public DateTime? PendingAtUtc { get; set; }

        /// <summary>A write under way, as JSON (<see cref="ViewIntent"/>), until it is done or rolled back.</summary>
        public string Intent { get; set; }
        public DateTime? IntentAtUtc { get; set; }

        public DateTime SeenAtUtc { get; set; }
    }

    /// <summary>
    /// The starting height every car launches with (schema v9, <c>view_baseline</c>, one row): S, his decision of
    /// 2026-10-02 (-0.020, his height then), and what app.ini held before Racing Desk first put it to S.
    /// </summary>
    public sealed class ViewBaseline
    {
        public double StartHeight { get; set; }
        public DateTime DecidedAtUtc { get; set; }
        public string DecidedBy { get; set; }

        /// <summary>app.ini's driverHeightAdj before Racing Desk first wrote it, and the first backup of the file.</summary>
        public double? IniOriginal { get; set; }
        public string IniBackup { get; set; }
        public DateTime? IniWrittenAtUtc { get; set; }

        /// <summary>When the one-time move of saved heights into the camera files was made; it is made once.</summary>
        public DateTime? MigratedAtUtc { get; set; }

        /// <summary>What app.ini held at the last launch check.</summary>
        public double? LaunchHeight { get; set; }
        public DateTime? LaunchAtUtc { get; set; }
    }

    /// <summary>
    /// A car's own SmartControl profile, made by Racing Desk (schema v9, <c>car_smartcontrol</c>): known by its id, never by
    /// what it says of itself. <see cref="State"/> is "gone" when he deleted it in SmartControl: the car then has none until
    /// he asks for one again, rather than one made behind his back.
    /// </summary>
    public sealed class CarSmartControl
    {
        public string CarPath { get; set; }
        public string ProfileId { get; set; }
        public string ProfileName { get; set; }
        public string BaseName { get; set; }
        public string BaseId { get; set; }
        public DateTime MadeAtUtc { get; set; }

        /// <summary>SHA-256 of the bytes Racing Desk last wrote: a row that differs has been edited in SmartControl.</summary>
        public string WrittenSha { get; set; }
        public double WrittenKg { get; set; }
        public DateTime WrittenAtUtc { get; set; }

        /// <summary>A force kept at the car's exit while the SmartControl editor was open, written once it is closed.</summary>
        public double? WaitingKg { get; set; }
        public DateTime? WaitingAtUtc { get; set; }

        public string State { get; set; } = "made";
        public DateTime? SwitchedAtUtc { get; set; }
    }

    /// <summary>
    /// The one profile Racing Desk switches the pedals to, with F24 bound to it in his "Default" Live preset (schema v9,
    /// <c>smartcontrol_switch</c>, one row): the car's profile is copied into it at car load and F24 is sent once.
    /// </summary>
    public sealed class SmartControlSwitch
    {
        public string ProfileId { get; set; }
        public string ProfileName { get; set; }
        public long? BindingId { get; set; }
        public long? LinkId { get; set; }
        public long? PresetId { get; set; }
        public string Key { get; set; }
        public DateTime MadeAtUtc { get; set; }
        public string WrittenSha { get; set; }
        public string WrittenFor { get; set; }
        public DateTime? WrittenAtUtc { get; set; }
        public DateTime? SentAtUtc { get; set; }
    }

    /// <summary>
    /// A line of what was done, or in trial what would have been (schema v9, <c>restore_events</c>): for the desk, the HUD
    /// (<see cref="Hud"/>) and host.log alike. Its id is the order lines are told in.
    /// </summary>
    public sealed class RestoreEvent
    {
        public long Id { get; set; }
        public DateTime AtUtc { get; set; }
        public string CarPath { get; set; }

        /// <summary>"height", "brakes", "setup", "check", "undo".</summary>
        public string What { get; set; }

        /// <summary>"trial", "done", "waiting", "refused", "failed".</summary>
        public string State { get; set; }
        public string Text { get; set; }

        /// <summary>A line for the HUD, shown at the first moment in the car, never while OBS records.</summary>
        public bool Hud { get; set; }
    }

    /// <summary>
    /// One step of the supervised first run (schema v9, <c>restore_checks</c>): what its code saw when it last ran, and his
    /// mark. The marks are what the live loop leaving trial is gated on (<see cref="RestoreGate"/>).
    /// </summary>
    public sealed class RestoreCheck
    {
        public string Step { get; set; }
        public DateTime? RanAtUtc { get; set; }
        public bool? RanOk { get; set; }
        public string RanResult { get; set; }

        /// <summary>"passed", "failed", or null while he has not said.</summary>
        public string Mark { get; set; }
        public DateTime? MarkedAtUtc { get; set; }
    }
}
