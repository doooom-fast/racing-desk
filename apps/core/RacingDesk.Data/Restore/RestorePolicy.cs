using System;
using System.Collections.Generic;
using System.Linq;

namespace RacingDesk.Data.Restore
{
    /// <summary>
    /// The settled numbers of putting back each car's driver height and brakes (docs/view-and-pedals-plan.md), in one
    /// place: his decisions of 2026-10-02, and the limits the critique of the plan asked for.
    /// </summary>
    public static class RestorePolicy
    {
        /// <summary>S: the height every car launches with, app.ini's driverHeightAdj. His decision: -0.020, his height then.</summary>
        public const double StartHeight = -0.020;

        /// <summary>The day S was decided, and by whom: kept with it in the store.</summary>
        public static readonly DateTime DecidedAtUtc = new DateTime(2026, 10, 2, 12, 0, 0, DateTimeKind.Utc);
        public const string DecidedBy = "Kevin, 2026-10-02";

        /// <summary>How a camera file is saved for a car that has none, said the one way everywhere (B8's): the desk, the HUD and host.log.</summary>
        public const string SaveACameraFile = "out of the car, in replay, Ctrl+F12, Save Car, name car.cam";

        /// <summary>A change of height smaller than this is no change (the sim's steps are 0.005 m).</summary>
        public const double SmallestChange = 0.0005;

        /// <summary>The cockpit camera's Z is kept within this until a test shows the camera takes more (critique H7).</summary>
        public const double MaxCockpitZ = 0.05;

        /// <summary>The cockpit's vertical shift (the horizon, +84) is kept within this; his own files go to -0.16.</summary>
        public const double MaxVerticalShift = 0.25;

        /// <summary>The key Racing Desk sends, and the only one it ever may: bound in SmartControl Live to its switch profile.</summary>
        public const string SwitchKey = "F24";

        /// <summary>Live's preset the binding is written into: his "Default" (id 1), where his five keys are.</summary>
        public const long LivePreset = 1;
        public const string LivePresetName = "Default";

        /// <summary>The switch profile's own name, before a car's is copied into it ("Racing Desk – Porsche 963 GTP" after).</summary>
        public const string SwitchProfileName = "Racing Desk";

        /// <summary>SmartControl's database, as its version 1 lays it out: any other is refused and said.</summary>
        public const long SmartControlDatabaseVersion = 1;

        /// <summary>The copies of SmartControl's database kept from before a step's first write (the last ones; older ones go).</summary>
        public const int StepBackupsKept = 10;

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

        /// <summary>
        /// What builds the live loop has: in this one, none. The first-run panel runs each step's real code on his click,
        /// and the loop that would act at car load and at exit stays in trial — it says what it would do and writes and
        /// presses nothing — whatever the first run's marks say, until the build that acts.
        /// </summary>
        public static readonly bool ActingBuilt = false;
    }

    /// <summary>
    /// One step of the supervised first run (the critique's corrected run: 0a, 0b, A1–A7, B1–B8, and C1, his own profile and
    /// force again), as the panel in Settings → Cars shows it: what he does, what Racing Desk does on his click, and what he
    /// should see.
    /// </summary>
    public sealed class FirstRunStep
    {
        public string Id { get; set; }
        public string Part { get; set; }
        public string Title { get; set; }

        /// <summary>What he does, in the order he does it.</summary>
        public string HeDoes { get; set; }

        /// <summary>The buttons: each runs only that part of the real code path, on his click. Empty for a step with nothing to run.</summary>
        public IReadOnlyList<FirstRunAction> Actions { get; set; } = Array.Empty<FirstRunAction>();

        /// <summary>What he should see or hear, written beside the step.</summary>
        public string Expected { get; set; }

        /// <summary>What passing it settles.</summary>
        public string Settles { get; set; }
    }

    public sealed class FirstRunAction
    {
        public string Id { get; set; }
        public string Label { get; set; }

        /// <summary>Whether the action writes one of his files or presses a key: shown so, and asked again before it does.</summary>
        public bool Writes { get; set; }
        public bool Presses { get; set; }
    }

    /// <summary>
    /// The first run's steps, and which of them have to have passed before each part may leave trial. The steps are the
    /// critique's corrected run (scratch restore-plan/critique.md): 0a and 0b before he sits down, Part A with the sim closed
    /// (the pedals), Part B in the sim, a test drive in the Porsche 963, and C1, his own profile and force again — owed after
    /// any F24 that went, even when he stops the pedals part early.
    /// </summary>
    public static class RestoreGate
    {
        /// <summary>The car Part B is driven in: its camera file has an empty LastCarSet, and its profile is from Default.</summary>
        public const string TestCar = "porsche963gtp";

        /// <summary>How far B4 and B5 move the height between the two screenshots: 2 cm, as the critique has it.</summary>
        public const double TestShift = -0.020;

        /// <summary>The A5 and A6 profiles' forces, and A7's row.</summary>
        public const int A5Kg = 40, A6Kg = 65, A7Kg = 65;

        public static readonly IReadOnlyList<FirstRunStep> Steps = new List<FirstRunStep>
        {
            new FirstRunStep
            {
                Id = "0a", Part = "Before he sits down", Title = "What would move",
                HeDoes = "Reads the heights that would move into camera files and the forces his cars' profiles would start at, and says whether they are right.",
                Actions = new[] { new FirstRunAction { Id = "0a", Label = "Show what would move" } },
                Expected = "The list: each car's height and its camera file, each car's force and its base. The forces are the ones he set (720S GT3 30 kg, Dallara F3 90, F4 85, 963 70, 570S 55, MX-5 35).",
                Settles = "D7: the heights and forces are right before they become files and profiles.",
            },
            new FirstRunStep
            {
                Id = "0b", Part = "Before he sits down", Title = "Back up everything",
                HeDoes = "Nothing: the sim is closed.",
                Actions = new[] { new FirstRunAction { Id = "0b", Label = "Back up and check the backups" } },
                Expected = "SmartControl's database backed up (before-racing-desk.db) and app.ini, camera.ini and every car.cam copied; each backup opens and reads.",
                Settles = "Everything after this can be put back.",
            },
            new FirstRunStep
            {
                Id = "A1", Part = "A · the pedals, sim closed", Title = "SmartControl and Live closed",
                HeDoes = "Quits the SmartControl editor and SmartControl Live from their tray icons.",
                Actions = new[] { new FirstRunAction { Id = "A1", Label = "Check both are closed" } },
                Expected = "Both tray icons gone; Racing Desk sees neither running.",
            },
            new FirstRunStep
            {
                Id = "A2", Part = "A · the pedals, sim closed", Title = "The Racing Desk profile and F24",
                HeDoes = "Nothing; both apps stay closed.",
                Actions = new[] { new FirstRunAction { Id = "A2", Label = "Make the Racing Desk profile and bind F24", Writes = true } },
                Expected = "SmartControl's database has a profile named \"Racing Desk\" (a copy of Default) and F24 · Set profile in his Default Live preset. His six profiles and five keys are as they were.",
            },
            new FirstRunStep
            {
                Id = "A3", Part = "A · the pedals, sim closed", Title = "Live has F24",
                HeDoes = "Starts SmartControl Live from the Start menu and looks at its bindings.",
                Actions = new[] { new FirstRunAction { Id = "A3", Label = "Check Live is running and F24 is bound" } },
                Expected = "\"F24 · Set profile\" (Racing Desk) is in Live's bindings.",
                Settles = "A binding written while Live was closed loads when it starts.",
            },
            new FirstRunStep
            {
                Id = "A4", Part = "A · the pedals, sim closed", Title = "F24 from a program",
                HeDoes = "Puts Notepad in front; after the press, presses Right Ctrl+Up once.",
                Actions = new[] { new FirstRunAction { Id = "A4", Label = "Send F24", Presses = true } },
                Expected = "Live: \"Profile Racing Desk set.\" Then Right Ctrl+Up: \"Brakeforce set to 85 kg\".",
                Settles = "Live acts on a key a program sends (E7).",
            },
            new FirstRunStep
            {
                Id = "A5", Part = "A · the pedals, sim closed", Title = "A LightBrake profile through the same row",
                HeDoes = "Listens; then presses Right Ctrl+Up once.",
                Actions = new[] { new FirstRunAction { Id = "A5", Label = "Rewrite it as LightBrake at 40 kg, then send F24", Writes = true, Presses = true } },
                Expected = "Live names the new profile; Right Ctrl+Up then says 45 kg. 85 kg means Live kept the old profile: stop the brakes part.",
                Settles = "Live re-reads the row at each press, and a LightBrake-based row loads (B2, B3).",
            },
            new FirstRunStep
            {
                Id = "A6", Part = "A · the pedals, sim closed", Title = "A Default profile through the same row",
                HeDoes = "Listens; then presses Right Ctrl+Up once.",
                Actions = new[] { new FirstRunAction { Id = "A6", Label = "Rewrite it as Default at 65 kg, then send F24", Writes = true, Presses = true } },
                Expected = "Live names the profile; Right Ctrl+Up then says 70 kg.",
            },
            new FirstRunStep
            {
                Id = "A7", Part = "A · the pedals, sim closed", Title = "Writing with the editor open",
                HeDoes = "Opens the SmartControl editor first. After the write, closes it without editing, then opens it again.",
                Actions = new[]
                {
                    new FirstRunAction { Id = "A7", Label = "Add a row and rewrite the Racing Desk row", Writes = true },
                    new FirstRunAction { Id = "A7-check", Label = "Check both rows are unchanged" },
                },
                Expected = "Both rows as written after the editor closed; reopened, it lists \"RD test 65\" at 65 kg with no warning.",
                Settles = "The editor saves no stale copy over Racing Desk's rows when it closes unedited.",
            },
            new FirstRunStep
            {
                Id = "B1", Part = "B · in the sim: a test drive in the Porsche 963", Title = "app.ini at S, with the iRacing UI open",
                HeDoes = "Has the iRacing UI open and the sim closed; after the write, starts a test drive in the 963 and stops at the garage screen.",
                Actions = new[]
                {
                    new FirstRunAction { Id = "B1", Label = "Put app.ini's height to S (-0.020)", Writes = true },
                    new FirstRunAction { Id = "B1-check", Label = "At the garage screen: read app.ini" },
                },
                Expected = "At the garage screen app.ini still says -0.020000. Where it held that already, B1 changes no value and B1-check says only whether the file was written again: B5 is the test of an edit surviving a launch.",
                Settles = "An app.ini written with the UI open survives a launch (E1).",
            },
            new FirstRunStep
            {
                Id = "B2", Part = "B · in the sim: a test drive in the Porsche 963", Title = "The garage screen, and F24 with iRacing in front",
                HeDoes = "Stays at the garage screen, iRacing in front.",
                Actions = new[]
                {
                    new FirstRunAction { Id = "B2-flags", Label = "Write down the garage flags and whether iRacing is elevated" },
                    new FirstRunAction { Id = "B2", Label = "Write the 963's profile (70 kg) and send F24", Writes = true, Presses = true },
                },
                Expected = "Live: \"Profile Racing Desk – Porsche 963 GTP set.\"; nothing happens in iRacing.",
                Settles = "The key reaches Live with iRacing in front, and the parked moment's flags (critique B4).",
            },
            new FirstRunStep
            {
                Id = "B3", Part = "B · in the sim: a test drive in the Porsche 963", Title = "In the pit box",
                HeDoes = "Drives to the pit box. Screenshot A. Right Ctrl+Up, then Right Ctrl+Down.",
                Actions = new[] { new FirstRunAction { Id = "B3", Label = "Done" } },
                Expected = "75 kg, then 70; nothing changed in the sim when F24 went (camera, FOV, black box).",
            },
            new FirstRunStep
            {
                Id = "B4", Part = "B · in the sim: a test drive in the Porsche 963", Title = "The camera file 2 cm lower",
                HeDoes = "Exits the sim. After the write, relaunches the 963 and takes screenshot B in the pit box.",
                Actions = new[] { new FirstRunAction { Id = "B4", Label = "Set the 963's cockpit Z 2 cm lower, app.ini at S", Writes = true } },
                Expected = "Screenshot B is 2 cm lower than A: the file is applied with LastCarSet empty (E4).",
            },
            new FirstRunStep
            {
                Id = "B5", Part = "B · in the sim: a test drive in the Porsche 963", Title = "app.ini 2 cm lower instead",
                HeDoes = "Exits the sim. After the write, relaunches and takes screenshot C.",
                Actions = new[] { new FirstRunAction { Id = "B5", Label = "Put the camera file back, app.ini 2 cm lower", Writes = true } },
                Expected = "Screenshot C matches B, the dash's edge within about a pixel: the two add one for one (E5), and an app.ini edit made with the iRacing UI open survives a launch (E1).",
            },
            new FirstRunStep
            {
                Id = "B6", Part = "B · in the sim: a test drive in the Porsche 963", Title = "The horizon pair (only if he wants horizon per car)",
                HeDoes = "Exits between runs and takes a screenshot each time.",
                Actions = new[]
                {
                    new FirstRunAction { Id = "B6", Label = "Cockpit vertical shift +0.02, DrivingVanishY as it is", Writes = true },
                    new FirstRunAction { Id = "B6-b", Label = "Vertical shift back, DrivingVanishY +0.02", Writes = true },
                },
                Expected = "The two screenshots match: the cockpit's vertical shift adds to the horizon (U8).",
            },
            new FirstRunStep
            {
                Id = "B7", Part = "B · in the sim: a test drive in the Porsche 963", Title = "FOV, then the state he chooses",
                HeDoes = "Says which state to keep: what B5 left, or everything as it was.",
                Actions = new[]
                {
                    new FirstRunAction { Id = "B7", Label = "Check app.ini's FOV" },
                    new FirstRunAction { Id = "B7-restore", Label = "Put app.ini and the 963's camera file back as they were", Writes = true },
                },
                Expected = "drivingCamFOV is still 70.000000; the files are as he chose.",
            },
            new FirstRunStep
            {
                Id = "B8", Part = "B · in the sim: a test drive in the Porsche 963", Title = "Camera files for the cars without one",
                HeDoes = "In the Dallara F3, the Lotus 79 or the Caterham 420R: " + RestorePolicy.SaveACameraFile + ".",
                Actions = new[] { new FirstRunAction { Id = "B8", Label = "Check the camera files he saved" } },
                Expected = "Each new file is 1,668 bytes, version 14 or 15.",
            },
            new FirstRunStep
            {
                Id = "C1", Part = "C · your own profile and force again", Title = "Your own profile and force again",
                HeDoes = "Racing Desk presses nothing and writes nothing here: this is yours. First the check, and only look. Quit SmartControl Live from "
                         + "its tray icon, unplug the pedals' USB cable for 5 seconds, plug it back in, and open SmartControl. Do not press Apply, Save or "
                         + "Restore. Say which of the three it shows. Then pick your own profile in SmartControl as you normally do, close SmartControl, "
                         + "start SmartControl Live, set your usual force with your own keys, and say so.",
                Actions = new[]
                {
                    new FirstRunAction { Id = RestoreClosing.Own, Label = "It shows my own profile and my force from before the run" },
                    new FirstRunAction { Id = RestoreClosing.Id, Label = "It shows Racing Desk's profile, with my old values" },
                    new FirstRunAction { Id = RestoreClosing.Values, Label = "It shows Racing Desk's values" },
                    new FirstRunAction { Id = RestoreClosing.Confirm, Label = "My own profile is picked and my force is set again" },
                },
                Expected = "Your own profile and your force from before the run: nothing Racing Desk sent was kept by the pedals. If it shows Racing Desk's "
                           + "profile or values, the brakes part fails and says so, and you still pick your own profile and set your force. This step is owed "
                           + "after any press of F24, even if you stop early, and Racing Desk will not remove its brake profiles until it is done.",
                Settles = "Whether the pedals' memory keeps the profile or the values F24 sent (the EEPROM check), and that your own profile and force are back.",
            },
        };

        public static FirstRunStep Step(string id) => Steps.FirstOrDefault(s => string.Equals(s.Id, id, StringComparison.OrdinalIgnoreCase));

        /// <summary>The step an action belongs to: "A7-check" is A7's.</summary>
        public static FirstRunStep StepOfAction(string actionId) =>
            Steps.FirstOrDefault(s => s.Actions.Any(a => string.Equals(a.Id, actionId, StringComparison.OrdinalIgnoreCase)));

        /// <summary>
        /// The checks each part needs passed before it may leave trial (the critique: A4–A6 and B2; B4–B5). The brakes need one
        /// thing more, which is not a mark: C1's check of the pedals' memory must have shown that they kept nothing of Racing Desk's.
        /// </summary>
        public static readonly IReadOnlyList<string> BrakesNeed = new[] { "A4", "A5", "A6", "B2" };
        public static readonly IReadOnlyList<string> HeightNeeds = new[] { "B1", "B4", "B5" };
        public static readonly IReadOnlyList<string> HorizonNeeds = new[] { "B6" };

        public static bool Passed(IEnumerable<RestoreCheck> checks, IEnumerable<string> needed)
        {
            var marks = (checks ?? Enumerable.Empty<RestoreCheck>()).Where(c => c != null && c.Step != null)
                .GroupBy(c => c.Step, StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key, g => g.Last().Mark, StringComparer.OrdinalIgnoreCase);
            return needed.All(step => marks.TryGetValue(step, out var mark) && mark == "passed");
        }

        /// <summary>
        /// Whether a part has been proven by the first run. Proven or not, the live loop acts only in a build that has it
        /// (<see cref="RestorePolicy.ActingBuilt"/>): until then everything stays in trial.
        /// </summary>
        public static bool BrakesProven(IEnumerable<RestoreCheck> checks) =>
            Passed(checks, BrakesNeed) && RestoreClosing.NewestAnswer(checks)?.Answer == "own";

        /// <summary>
        /// Why the brakes part has failed, in words, when C1's check showed that the pedals kept something of what F24 sent; null
        /// while it has not. A part that has failed is not proven, whatever his marks say, until a later look shows otherwise.
        /// </summary>
        public static string BrakesFailed(IEnumerable<RestoreCheck> checks) => RestoreClosing.FailedWords(RestoreClosing.NewestAnswer(checks)?.Answer);
        public static bool HeightProven(IEnumerable<RestoreCheck> checks) => Passed(checks, HeightNeeds);
        public static bool HorizonProven(IEnumerable<RestoreCheck> checks) => Passed(checks, HorizonNeeds);

        /// <summary>His D6, on his terms: after a switch his +5/-5 keys count from the profile's force only once the switch is proven.</summary>
        public static bool SeedForceAfterSwitch(IEnumerable<RestoreCheck> checks) => RestorePolicy.ActingBuilt && BrakesProven(checks);

        /// <summary>The loop leaves trial for a part only in a build that acts, with the part switched on and proven.</summary>
        public static bool Acts(bool switchedOn, bool proven) => RestorePolicy.ActingBuilt && switchedOn && proven;
    }
}
