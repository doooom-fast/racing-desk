using System;
using System.Collections.Generic;

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

        /// <summary>The switch profile's own name, before a car's is written into it ("Racing Desk – Porsche 963 GTP" after).</summary>
        public const string SwitchProfileName = "Racing Desk";

        /// <summary>The profile the switch profile starts as a copy of, before the first car is written into it.</summary>
        public const string SwitchProfileFrom = "Default";

        /// <summary>SmartControl's database, as its version 1 lays it out: any other is refused and said.</summary>
        public const long SmartControlDatabaseVersion = 1;

        /// <summary>The copies of SmartControl's database kept from before Racing Desk writes it (the last ones; older ones go).</summary>
        public const int BackupsKept = 10;

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
