using System;
using System.Collections.Generic;
using System.Linq;

namespace RacingDesk.Data.Restore
{
    /// <summary>
    /// What Racing Desk has kept in one car's camera file (schema v9, <c>car_view_keep</c>): the cockpit camera's height,
    /// split into his own (what the file held before Racing Desk first wrote it, or after he saved it himself since) and
    /// what Racing Desk has added on top, so that the view kept for the car never counts the same height twice and undo
    /// can tell the two apart. A write under way is written down first (<see cref="Intent"/>), so that a host that stops
    /// half-way puts it back, by value, at its next start (it is never finished behind his back).
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

        /// <summary>app.ini's driverHeightAdj before Racing Desk first wrote it, the first backup of the file, and when Racing Desk last wrote it.</summary>
        public double? IniOriginal { get; set; }
        public string IniBackup { get; set; }
        public DateTime? IniWrittenAtUtc { get; set; }

        /// <summary>
        /// The same for DrivingVanishY: its value before Racing Desk first wrote it. And the value each of the two was last
        /// given by Racing Desk, whichever step wrote it: undo puts a value back only while the file still holds that one.
        /// </summary>
        public double? VanishYOriginal { get; set; }
        public double? IniHeightWritten { get; set; }
        public double? VanishYWritten { get; set; }

        /// <summary>When the one-time move of the heights he chose before into the cars' camera files was made; it is made once.</summary>
        public DateTime? MigratedAtUtc { get; set; }

        /// <summary>What app.ini held when the sim last started (the self-check), and when.</summary>
        public double? LaunchHeight { get; set; }
        public DateTime? LaunchAtUtc { get; set; }
    }

    /// <summary>
    /// A SmartControl profile of a car's own (schema v9, <c>car_smartcontrol</c>), known by its id, never by what it says of
    /// itself or by its name (he may rename it): made the first time the car loads, holding his rule's base at the car's force,
    /// and the one he tunes in the SmartControl editor. It is never loaded on the pedals itself: at the switch it is copied, as
    /// it stands, into the switch profile (<see cref="SmartControlSwitch"/>), and F24 loads that. The writer may change it and
    /// undo takes it away.
    /// </summary>
    public sealed class CarSmartControl
    {
        public string CarPath { get; set; }
        public string ProfileId { get; set; }

        /// <summary>The name Racing Desk gave it; the row may have been renamed since.</summary>
        public string ProfileName { get; set; }
        public string BaseName { get; set; }
        public string BaseId { get; set; }
        public DateTime MadeAtUtc { get; set; }

        /// <summary>
        /// SHA-256 of the bytes Racing Desk last wrote (made, made again, or the force put in): a row that differs has been
        /// changed in SmartControl since.
        /// </summary>
        public string WrittenSha { get; set; }

        /// <summary>
        /// The force the row held when Racing Desk last wrote or looked at it: a row that holds another force now has had its
        /// force changed in SmartControl, and that force is the car's (his edit wins; it is taken into the store).
        /// </summary>
        public double WrittenKg { get; set; }
        public DateTime WrittenAtUtc { get; set; }

        /// <summary>Not used by the cars' own profiles: a force the store holds that the row does not is simply waiting to be written.</summary>
        public double? WaitingKg { get; set; }
        public DateTime? WaitingAtUtc { get; set; }

        /// <summary>"made" (as Racing Desk wrote it, so a base he chooses for the car later makes it again) or "edited" (he has changed it: it is his now).</summary>
        public string State { get; set; } = "made";

        /// <summary>When it was last copied into the switch profile.</summary>
        public DateTime? SwitchedAtUtc { get; set; }
    }

    /// <summary>
    /// The one profile Racing Desk switches the pedals to, with F24 bound to it in his "Default" Live preset (schema v9,
    /// <c>smartcontrol_switch</c>, one row): the car's own profile is copied into it, as it stands, when he is parked in that
    /// car, and F24 is sent once.
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

        /// <summary>When the binding was written: SmartControl Live reads its keys when it starts, so one that started before this has not got F24.</summary>
        public DateTime? BoundAtUtc { get; set; }

        /// <summary>What the row holds: the bytes' SHA-256, the car they are for (its folder), and when they were written.</summary>
        public string WrittenSha { get; set; }
        public string WrittenFor { get; set; }
        public DateTime? WrittenAtUtc { get; set; }

        /// <summary>The last F24 Racing Desk sent. Once one has gone the pedals may be on this row, so it is never taken from under them.</summary>
        public DateTime? SentAtUtc { get; set; }

        /// <summary>
        /// When what the row holds went on the pedals; null while that is not known — the row written since, or his keys moved
        /// the force since. Live starting again since then makes it not known too (asked of Live, not kept).
        /// </summary>
        public DateTime? PedalsAtUtc { get; set; }
    }

    /// <summary>A line of what was done (schema v9, <c>restore_events</c>), kept beside host.log's. Its id is the order lines came in.</summary>
    public sealed class RestoreEvent
    {
        public long Id { get; set; }
        public DateTime AtUtc { get; set; }
        public string CarPath { get; set; }

        /// <summary>"height", "brakes", "setup", "undo".</summary>
        public string What { get; set; }

        /// <summary>"done", "waiting", "refused", "failed", "off".</summary>
        public string State { get; set; }
        public string Text { get; set; }
    }

    /// <summary>What a command did (undo, a switch), or why it did nothing.</summary>
    public sealed class RestoreResult
    {
        public string Action { get; set; }
        public bool Ok { get; set; }

        /// <summary>Nothing was done: a condition of the command did not hold (iRacing running, the SmartControl editor open).</summary>
        public bool Refused { get; set; }

        /// <summary>Refused because another command is still running: one at a time, and a second is told so rather than queued.</summary>
        public bool Busy { get; set; }
        public string Why { get; set; }
        public List<string> Did { get; } = new List<string>();
        public List<string> Saw { get; } = new List<string>();

        public string Text =>
            string.Join(" ", new[] { Why }.Concat(Did).Concat(Saw).Where(s => !string.IsNullOrWhiteSpace(s)).Select(s => s.TrimEnd().EndsWith(".") ? s.TrimEnd() : s.TrimEnd() + "."));

        internal static RestoreResult No(string action, string why) => new RestoreResult { Action = action, Refused = true, Why = why };
    }

    /// <summary>
    /// How one part stands, in a sentence for Settings → Cars: "working", "waiting" (for what, said), "stopped" (it turned itself
    /// off, and why), or "off" (he switched it off).
    /// </summary>
    public sealed class RestoreStatus
    {
        public string State { get; set; }
        public string Text { get; set; }

        public static RestoreStatus Of(string state, string text) => new RestoreStatus { State = state, Text = text };
    }
}
