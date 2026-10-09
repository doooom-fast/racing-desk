using System;
using System.Collections.Generic;
using System.Linq;

namespace RacingDesk.Data.Restore
{
    /// <summary>
    /// The settled numbers of putting back each car's seat height and brakes (docs/view-and-pedals-plan.md), in one place:
    /// his decisions of 2026-10-02, and the limits the critique of the plan asked for.
    /// </summary>
    public static class RestorePolicy
    {
        /// <summary>S: the height every car launches with, app.ini's driverHeightAdj. His decision: -0.020, his height then.</summary>
        public const double StartHeight = -0.020;

        /// <summary>The day S was decided, and by whom: kept with it in the store.</summary>
        public static readonly DateTime DecidedAtUtc = new DateTime(2026, 10, 2, 12, 0, 0, DateTimeKind.Utc);
        public const string DecidedBy = "Kevin, 2026-10-02";

        /// <summary>How a camera file is saved for a car that has none, said the one way everywhere: the Cars page and host.log.</summary>
        public const string SaveACameraFile = "out of the car, in replay, press Ctrl+F12, choose Save Car and name it car.cam";

        /// <summary>A change of height smaller than this is no change (the sim's steps are 0.005 m).</summary>
        public const double SmallestChange = 0.0005;

        /// <summary>The cockpit camera's Z is kept within this until a test shows the camera takes more (critique H7).</summary>
        public const double MaxCockpitZ = 0.05;

        /// <summary>The cockpit's vertical shift (+84) is kept within this; only undo writes it now, and only back to what it was.</summary>
        public const double MaxVerticalShift = 0.25;

        /// <summary>The key Racing Desk sends, and the only one it ever may: bound in SmartControl Live to its switch profile.</summary>
        public const string SwitchKey = "F24";

        /// <summary>Live's preset the binding is written into: his "Default" (id 1), where his five keys are.</summary>
        public const long LivePreset = 1;
        public const string LivePresetName = "Default";

        /// <summary>The switch profile's own name, before a car's is copied into it ("Racing Desk: Porsche 963 GTP" after, <see cref="SwitchRowName"/>).</summary>
        public const string SwitchProfileName = "Racing Desk";

        /// <summary>
        /// What SmartControl's list shows of Racing Desk's rows. A car's own profile ends in "· Racing Desk" and is named for the
        /// car ("Porsche 963 GTP · Racing Desk"): the one he tunes in the editor. The switch profile, the one SmartControl Live
        /// loads on F24, names the car it holds now ("Racing Desk: Porsche 963 GTP"), so that Live's voice says which car.
        /// </summary>
        public static string CarRowName(string car) => (car ?? "").Trim() + " · Racing Desk";

        public static string SwitchRowName(string car) => "Racing Desk: " + (car ?? "").Trim();

        /// <summary>
        /// A name no other profile in SmartControl has (it keeps them unique, case aside): <paramref name="wanted"/>, else with the
        /// car's folder after it ("Mazda MX-5 Cup · Racing Desk (mx5 mx52016)") for two cars of one name, and a number if even that is taken.
        /// </summary>
        public static string Unique(string wanted, IEnumerable<string> taken, string folder)
        {
            var names = new HashSet<string>((taken ?? new string[0]).Where(n => n != null).Select(n => n.Trim()), StringComparer.OrdinalIgnoreCase);
            string name = (wanted ?? "").Trim();
            if (!names.Contains(name)) return name;
            string marked = name + " (" + (folder ?? "").Trim() + ")";
            for (int i = 2; names.Contains(marked); i++) marked = name + " (" + (folder ?? "").Trim() + " " + i + ")";
            return marked;
        }

        /// <summary>A force within this of another is the same force (SmartControl's are whole kilograms; the editor may write 70.0).</summary>
        public const double SameForce = 0.01;

        /// <summary>The profile the switch profile starts as a copy of, before the first car is written into it.</summary>
        public const string SwitchProfileFrom = "Default";

        /// <summary>SmartControl's database, as its version 1 lays it out: any other is refused and said.</summary>
        public const long SmartControlDatabaseVersion = 1;

        /// <summary>The copies of SmartControl's database kept from before Racing Desk writes it (the last ones; older ones go).</summary>
        public const int BackupsKept = 10;

        /// <summary>
        /// Whether SmartControl Live has what was written to its database at <paramref name="writtenUtc"/>: it reads its keys when it
        /// starts, so it has them when it started at or after the write. False when when it started is not known.
        /// </summary>
        public static bool LiveHasWrite(DateTime? liveStartedUtc, DateTime writtenUtc) => liveStartedUtc.HasValue && liveStartedUtc.Value >= writtenUtc;

        // ── His brake-force keys on Right Ctrl (his decision of 2026-10-09: "Move brake keys to Right Ctrl+F1..F4") ──
        // Assetto Corsa's F1, F2 and F3 cameras are built into the game, so his set-force keys move to a chord no sim uses.

        /// <summary>
        /// Live's own name for Right Ctrl, the first key his set-force keys move to: <c>VK_RCONTROL</c> in Live's list of the keys a
        /// binding's first key can be (beside <c>VK_LCONTROL</c>, <c>VK_ZOOM</c>), stored without its <c>VK_</c> as the vendor's own
        /// first-run setup stores <c>LCONTROL</c> for its Default preset's Ctrl+D.
        /// </summary>
        public const string BrakeKeysHeld = "RCONTROL";

        /// <summary>The keys whose set-force bindings move: F1–F4. Up and Down (+5 / −5) stay as they are; they clash with nothing.</summary>
        public static readonly IReadOnlyList<string> BrakeKeysMoved = new[] { "F1", "F2", "F3", "F4" };

        /// <summary>What the desk says until SmartControl Live has started again after the move (it reads its keys when it starts).</summary>
        public const string BrakeKeysRestart = "Restart SmartControl Live (or the PC) to use Right Ctrl + F1–F4 for brake force.";

        /// <summary>The same after the move is undone.</summary>
        public const string BrakeKeysRestartUndone = "Restart SmartControl Live (or the PC) to use F1–F4 for brake force again.";

        /// <summary>The bases' own forces, his decision for a car whose force he never set: LightBrake 45 kg, Default 80 kg.</summary>
        public static readonly IReadOnlyDictionary<string, int> BaseForces = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase)
        {
            ["LightBrake"] = 45, ["Default"] = 80,
        };

        // ── When he is parked: the only moment the brakes are switched ──

        /// <summary>Stationary means slower than this, m/s.</summary>
        public const double StillBelowMs = 0.3;

        /// <summary>For at least this long, so that a profile is never put on the pedals as he moves off.</summary>
        public static readonly TimeSpan StillFor = TimeSpan.FromSeconds(1);

        /// <summary>The frame the parked rule is asked of, right before a key, is no older than this.</summary>
        public static readonly TimeSpan FactsFreshFor = TimeSpan.FromSeconds(3);

        /// <summary>The brake released: below this fraction of its travel. A new force under his foot would jump the brake.</summary>
        public const double BrakeReleasedBelow = 0.02;

        /// <summary>While he stays parked and his car's brakes have not gone on yet, they are tried again this often.</summary>
        public static readonly TimeSpan TryAgainEvery = TimeSpan.FromSeconds(5);
    }
}
