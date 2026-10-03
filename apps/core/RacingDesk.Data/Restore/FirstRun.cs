using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using RacingDesk.Data.Pedals;
using RacingDesk.Plugin.IRacing;

namespace RacingDesk.Data.Restore
{
    /// <summary>What one press of a first-run button did, saw, or why it did nothing.</summary>
    public sealed class StepResult
    {
        public string Action { get; set; }
        public string Step { get; set; }
        public bool Ok { get; set; }

        /// <summary>Nothing was done: a condition of the step did not hold (the sim running, a program open, a step before it not run).</summary>
        public bool Refused { get; set; }
        public string Why { get; set; }
        public List<string> Did { get; } = new List<string>();
        public List<string> Saw { get; } = new List<string>();

        public string Text =>
            string.Join(" ", new[] { Why }.Concat(Did.Select(d => d.EndsWith(".") ? d : d + ".")).Concat(Saw.Select(s => s.EndsWith(".") ? s : s + ".")).Where(s => !string.IsNullOrWhiteSpace(s)));

        internal static StepResult No(string action, string why) => new StepResult { Action = action, Refused = true, Why = why };
    }

    /// <summary>
    /// The supervised first run (the critique's corrected run, <see cref="RestoreGate.Steps"/>): one method per button, each running
    /// only that step's part of the real code path, and only when he clicks it. A step whose conditions do not hold does nothing
    /// and says why. What each saw is kept in <c>restore_checks</c> beside his mark, and said on the desk and in host.log.
    /// Nothing here runs by itself: the live loop stays in trial.
    /// </summary>
    public sealed class FirstRun
    {
        private readonly RestoreContext _ctx;

        public FirstRun(RestoreContext ctx)
        {
            _ctx = ctx ?? throw new ArgumentNullException(nameof(ctx));
        }

        /// <summary>
        /// The steps of Part A that write SmartControl's database or send F24: for the sim closed. A profile or a key sent while he
        /// drives would reach the pedals under his foot (Live loads the row as soon as the key is heard), so they refuse while it runs.
        /// </summary>
        private static readonly string[] ForTheSimClosed = { "A2", "A4", "A5", "A6", "A7" };

        public StepResult Run(string actionId)
        {
            var step = RestoreGate.StepOfAction(actionId ?? "");
            if (step == null) return StepResult.No(actionId, "there is no such step");
            string action = step.Actions.First(a => string.Equals(a.Id, actionId, StringComparison.OrdinalIgnoreCase)).Id;
            // A step for the sim closed is refused before it does anything, and before it is asked anything else.
            StepResult r = ForTheSimClosed.Contains(action) && _ctx.Probe.SimRunning()
                ? StepResult.No(action, $"iRacing is running: {action} is a step for the sim closed, because a profile or a key sent now would reach the pedals under your foot. Exit the sim first")
                : null;
            try
            {
                r = r ?? action switch
                {
                    "0a" => WhatWouldMove(),
                    "0b" => BackUpEverything(),
                    "A1" => BothClosed(),
                    "A2" => MakeTheSwitch(),
                    "A3" => LiveHasTheKey(),
                    "A4" => Send(action, needSim: false),
                    "A5" => Rewrite(action, "LightBrake", RestoreGate.A5Kg),
                    "A6" => Rewrite(action, "Default", RestoreGate.A6Kg),
                    "A7" => WriteWithTheEditorOpen(),
                    "A7-check" => CheckAfterTheEditor(),
                    "B1" => IniToStart(),
                    "B1-check" => IniAtTheGarage(),
                    "B2-flags" => GarageFlags(),
                    "B2" => SwitchToTheTestCar(),
                    "B3" => Noted(action, ForceWords()),
                    "B4" => TestCarLower(),
                    "B5" => IniLower(),
                    "B6" => ShiftUp(),
                    "B6-b" => HorizonUp(),
                    "B7" => FovAsBefore(),
                    "B7-restore" => PutBack(),
                    "B8" => NewCameraFiles(),
                    RestoreClosing.Own => PedalsMemory(action, "own"),
                    RestoreClosing.Id => PedalsMemory(action, "id"),
                    RestoreClosing.Values => PedalsMemory(action, "values"),
                    RestoreClosing.Confirm => OwnAgain(),
                    _ => StepResult.No(action, "this step has nothing to run"),
                };
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException || ex is Microsoft.Data.Sqlite.SqliteException || ex is InvalidOperationException)
            {
                r = new StepResult { Why = "it stopped: " + ex.Message.Trim() };
            }
            r.Action = action;
            r.Step = step.Id;
            // A refusal of C1's says only that something it needs was not so. It must not undo an answer given before, or a
            // confirmation, so it is not kept: what C1 owes is worked out from these records.
            if (!(r.Refused && RestoreClosing.IsClosingAction(action)))
            {
                try
                {
                    using var store = _ctx.OpenStore();
                    store.NoteCheckRan(action, r.Ok, r.Text, _ctx.Now());
                }
                catch (Exception ex) when (ex is Microsoft.Data.Sqlite.SqliteException || ex is IOException)
                {
                    _ctx.Log("restore: what the step saw was not kept — " + ex.Message.Trim());
                }
            }
            _ctx.Say(null, "check", r.Ok ? "done" : r.Refused ? "refused" : "failed", $"First run, {action}: {r.Text}");
            return r;
        }

        // ── 0a, 0b ──

        private StepResult WhatWouldMove()
        {
            using var store = _ctx.OpenStore();
            var plan = RestorePlanner.Plan(store, _ctx.Files, _ctx.ReadSmartControl(), _ctx.StartHeight, _ctx.Now());
            var r = new StepResult { Ok = true };
            r.Saw.AddRange(plan.Lines);
            return r;
        }

        private StepResult BackUpEverything()
        {
            if (_ctx.Probe.SimRunning()) return StepResult.No("0b", "iRacing is running: close it first, so that its files are not being written while they are copied");
            var r = new StepResult();
            string stamp = "first-run-" + _ctx.Now().ToLocalTime().ToString("yyyy-MM-dd_HHmmss", CultureInfo.InvariantCulture);

            string db = File.Exists(_ctx.BeforeRacingDesk) ? Path.Combine(_ctx.SmartControlBackups, stamp + ".db") : _ctx.BeforeRacingDesk;
            string bad = _ctx.Writer.Backup(db);
            if (bad != null) { r.Why = "SmartControl's database: " + bad; return r; }
            var copy = SmartControl.Read(db);
            r.Did.Add($"SmartControl's database copied to {Path.GetFileName(db)}");
            r.Saw.Add($"the copy opens and passes its check: {copy?.Profiles.Count ?? 0} profiles, {copy?.Keys.Count ?? 0} keys");

            int cams = 0;
            var files = new List<string> { "app.ini", "camera.ini" };
            files.AddRange(_ctx.Files.CarsWithCamFiles().Select(ViewFiles.DefaultCamFile));
            foreach (string rel in files)
            {
                string full = Path.Combine(_ctx.Files.Documents, rel);
                byte[] bytes = ViewFiles.ReadShared(full);
                if (bytes == null) { r.Saw.Add(rel + " is not there"); continue; }
                string path = _ctx.Files.Backup(full, rel, stamp, bytes, out string why);
                if (path == null) { r.Why = rel + ": " + why; return r; }
                byte[] back = File.ReadAllBytes(path);
                if (rel.EndsWith(".cam", StringComparison.OrdinalIgnoreCase))
                {
                    if (!CarCamFile.TryReadCockpit(back, out _)) { r.Why = rel + ": its copy does not read as a camera file"; return r; }
                    cams++;
                }
                else if (rel == "app.ini" && !AppIniEditor.TryReadValue(back, "View", "driverHeightAdj", out _)) { r.Why = "app.ini: its copy has no driver height"; return r; }
            }
            r.Did.Add($"app.ini, camera.ini and {cams} camera files copied to backups\\view\\{stamp}; the first original of each is kept in backups\\view\\original");
            r.Saw.Add("each copy reads back");
            r.Ok = true;
            return r;
        }

        // ── A: the pedals, with the sim closed ──

        private StepResult BothClosed()
        {
            bool editor = _ctx.Probe.EditorRunning(), live = _ctx.Probe.LiveRunning();
            var r = new StepResult { Ok = !editor && !live };
            r.Saw.Add("the SmartControl editor is " + (editor ? "running" : "closed"));
            r.Saw.Add("SmartControl Live is " + (live ? "running" : "closed"));
            if (!r.Ok) r.Why = "Quit " + (editor && live ? "both" : editor ? "the editor" : "Live") + " from the tray icon, then check again.";
            return r;
        }

        private StepResult MakeTheSwitch()
        {
            if (_ctx.Probe.EditorRunning() || _ctx.Probe.LiveRunning()) return StepResult.No("A2", "the SmartControl editor or Live is running: quit both first (A1); Live reads its keys when it starts");
            if (!File.Exists(_ctx.BeforeRacingDesk)) return StepResult.No("A2", "back everything up first (0b)");
            var writer = _ctx.Writer;
            if (writer.DatabaseVersion() != RestorePolicy.SmartControlDatabaseVersion) return StepResult.No("A2", "SmartControl's database is not the version Racing Desk knows");
            var before = _ctx.ReadSmartControl();
            if (before == null) return StepResult.No("A2", "SmartControl's database could not be read");

            var r = new StepResult();
            using var store = _ctx.OpenStore();
            var sw = store.SmartControlSwitchRow();
            if (sw == null)
            {
                var source = before.Profiles.FirstOrDefault(p => string.Equals(p.Name?.Trim(), "Default", StringComparison.OrdinalIgnoreCase));
                if (source == null) return StepResult.No("A2", "SmartControl has no profile named Default to copy");
                var made = writer.InsertProfile(RestorePolicy.SwitchProfileName, source.Data);
                if (!made.Ok) { r.Why = made.Why; return r; }
                sw = new SmartControlSwitch
                {
                    ProfileId = made.ProfileId, ProfileName = RestorePolicy.SwitchProfileName, Key = RestorePolicy.SwitchKey,
                    MadeAtUtc = _ctx.Now(), WrittenSha = made.Sha, WrittenFor = "Default", WrittenAtUtc = _ctx.Now(),
                };
                store.SaveSmartControlSwitch(sw);   // from here the row is Racing Desk's, and undo knows it
                r.Did.Add($"profile '{RestorePolicy.SwitchProfileName}' made, a copy of Default");
            }
            else r.Saw.Add($"the profile '{sw.ProfileName}' was made before");
            if (sw.BindingId == null)
            {
                var bound = writer.BindProfileKey(sw.ProfileId, RestorePolicy.SwitchKey, RestorePolicy.LivePreset, RestorePolicy.LivePresetName, store.RacingDeskProfileIds());
                if (!bound.Ok) { r.Why = "the key was not bound: " + bound.Why; return r; }
                sw.BindingId = bound.BindingId;
                sw.LinkId = bound.LinkId;
                sw.PresetId = RestorePolicy.LivePreset;
                store.SaveSmartControlSwitch(sw);
                r.Did.Add($"{RestorePolicy.SwitchKey} · Set profile '{RestorePolicy.SwitchProfileName}' bound in Live's {RestorePolicy.LivePresetName} preset");
            }
            else r.Saw.Add($"{RestorePolicy.SwitchKey} was bound before");

            var after = _ctx.ReadSmartControl();
            var ours = store.RacingDeskProfileIds();
            string changed = HisRowsChanged(before, after, ours, sw.BindingId);
            if (changed != null) { r.Why = changed; return r; }
            r.Saw.Add($"his {before.Profiles.Count(p => !ours.Contains(p.Id))} profiles and {before.Keys.Count(k => k.BindingId != sw.BindingId)} keys are as they were");
            r.Ok = true;
            return r;
        }

        /// <summary>His own profiles and keys, compared before and after a write: null when every one is as it was.</summary>
        internal static string HisRowsChanged(SmartControlSnapshot before, SmartControlSnapshot after, ISet<string> ours, long? ourBinding)
        {
            if (after == null) return "SmartControl's database could not be read back";
            foreach (var p in before.Profiles.Where(p => !ours.Contains(p.Id)))
            {
                var now = after.Profiles.FirstOrDefault(x => x.Id == p.Id);
                if (now == null) return $"his profile '{p.Name}' is not there any more";
                if (now.Name != p.Name || !now.Data.AsSpan().SequenceEqual(p.Data)) return $"his profile '{p.Name}' changed";
            }
            string Key(LiveKey k) => $"{k.BindingId}|{k.Action}|{k.Value}|{k.ProfileId}|{k.FirstKey}|{k.SecondKey}|{k.PresetId}";
            var keysBefore = before.Keys.Where(k => k.BindingId != ourBinding).Select(Key).ToList();
            var keysAfter = after.Keys.Where(k => k.BindingId != ourBinding).Select(Key).ToList();
            if (!keysBefore.SequenceEqual(keysAfter)) return "his keys changed";
            return null;
        }

        private StepResult LiveHasTheKey()
        {
            using var store = _ctx.OpenStore();
            var sw = store.SmartControlSwitchRow();
            if (sw?.BindingId == null) return StepResult.No("A3", "make the Racing Desk profile and bind F24 first (A2)");
            var r = new StepResult();
            bool live = _ctx.Probe.LiveRunning();
            var keys = _ctx.ReadSmartControl()?.Keys ?? Array.Empty<LiveKey>();
            bool bound = keys.Any(k => k.Action == LiveAction.SetProfile && k.ProfileId == sw.ProfileId && string.Equals(k.FirstKey, RestorePolicy.SwitchKey, StringComparison.OrdinalIgnoreCase)
                                       && k.PresetId == RestorePolicy.LivePreset);
            r.Saw.Add("SmartControl Live is " + (live ? "running" : "not running"));
            r.Saw.Add(bound ? $"the database binds {RestorePolicy.SwitchKey} to Set profile '{sw.ProfileName}' in the Default preset" : $"the database has no {RestorePolicy.SwitchKey} binding");
            r.Ok = live && bound;
            if (!live) r.Why = "Start SmartControl Live from the Start menu, then check again.";
            return r;
        }

        /// <summary>
        /// Sends F24, <see cref="RestoreContext.SendDelay"/> after his click, so that he can put Notepad (A4–A6) or iRacing (B2)
        /// in front first; refused when Live is not running or the window in front is above Racing Desk (Windows would drop it).
        /// </summary>
        private StepResult Send(string action, bool needSim, StepResult r = null)
        {
            r = r ?? new StepResult();
            using (var store = _ctx.OpenStore())
            {
                var sw = store.SmartControlSwitchRow();
                if (sw?.BindingId == null) { r.Refused = r.Did.Count == 0; r.Why = "make the Racing Desk profile and bind F24 first (A2)"; return r; }
            }
            if (!_ctx.Probe.LiveRunning()) { r.Refused = r.Did.Count == 0; r.Why = "SmartControl Live is not running: the key would do nothing"; return r; }
            _ctx.Sleep(_ctx.SendDelay);
            // The wait is for putting a window in front, and a lot can happen in it: the sim is asked again.
            bool simUp = _ctx.Probe.SimRunning();
            if (!needSim && simUp) { r.Why = $"iRacing started while Racing Desk waited: {action} is for the sim closed, and nothing was sent"; return r; }
            if (needSim && !simUp) { r.Why = "the sim is not running any more: nothing was sent"; return r; }
            string front = _ctx.Probe.ForegroundProcess();
            bool? elevated = _ctx.Probe.ForegroundElevated();
            if (front == null) { r.Why = "no window was in front: nothing was sent"; return r; }
            if (elevated != false) { r.Why = $"{front} is in front and Racing Desk cannot tell that it is not elevated: Windows would drop the key, so nothing was sent"; return r; }
            if (needSim && !WindowsRigProbe.SimProcesses.Contains(front, StringComparer.OrdinalIgnoreCase)) { r.Why = $"{front} was in front, not iRacing: nothing was sent"; return r; }
            if (!_ctx.Probe.LiveRunning()) { r.Why = "SmartControl Live stopped: nothing was sent"; return r; }
            // In the sim, only parked: the frames are asked once more now, after the wait, not the click's.
            if (needSim)
            {
                string notParked = NotParked(_ctx.Parked());
                if (notParked != null) { r.Why = notParked + ": nothing was sent"; return r; }
            }
            // C1 is owed from the moment the key goes: it is written down first, so that nothing after the press can lose it.
            DateTime? before;
            using (var store = _ctx.OpenStore())
            {
                var sw = store.SmartControlSwitchRow();
                before = sw.SentAtUtc;
                sw.SentAtUtc = _ctx.Now();
                store.SaveSmartControlSwitch(sw);
            }
            if (!_ctx.Keys.SendF24())
            {
                // Nothing went, so nothing is owed for it.
                using var store = _ctx.OpenStore();
                var sw = store.SmartControlSwitchRow();
                sw.SentAtUtc = before;
                store.SaveSmartControlSwitch(sw);
                r.Why = "Windows took no part of the key";
                return r;
            }
            // A profile was switched under the pedals: the force his keys had been followed to is not the pedals' now.
            _ctx.ForceNotKnown();
            r.Did.Add($"{RestorePolicy.SwitchKey} sent, {_ctx.SendDelay.TotalSeconds:0} s after the click, with {front} in front");
            r.Ok = true;
            return r;
        }

        /// <summary>
        /// Why he is not parked on the newest frame, in words; null when he is: the frame is fresh, and the parked rule — a place
        /// the brakes may be switched in, still for a second, the brake released — holds on it.
        /// </summary>
        private string NotParked(ParkedNow park)
        {
            if (park == null) return "no frame has come from the sim to say you are parked";
            double age = (_ctx.Now() - park.FactsAtUtc).TotalSeconds;
            if (age > RestorePolicy.FactsFreshFor.TotalSeconds) return $"the sim's last frame is {age:0} s old, so it cannot say you are parked";
            if (!park.Parked) return $"you are not parked ({park.Why})";
            return null;
        }

        private StepResult Rewrite(string action, string baseName, int kg)
        {
            using var store = _ctx.OpenStore();
            var sw = store.SmartControlSwitchRow();
            if (sw?.BindingId == null) return StepResult.No(action, "make the Racing Desk profile and bind F24 first (A2)");
            if (!_ctx.Probe.LiveRunning()) return StepResult.No(action, "SmartControl Live is not running");
            var source = _ctx.ReadSmartControl()?.Profiles.FirstOrDefault(p => string.Equals(p.Name?.Trim(), baseName, StringComparison.OrdinalIgnoreCase));
            if (source == null) return StepResult.No(action, $"SmartControl has no {baseName}");
            if (!SmartControlProfileEditor.TryEdit(source.Data, kg, null, out byte[] bytes, out string why)) return StepResult.No(action, $"{baseName} at {kg} kg could not be made: {why}");
            var r = new StepResult();
            string name = $"{RestorePolicy.SwitchProfileName} – {action} {baseName} {kg} kg";
            var written = _ctx.Writer.UpdateProfile(sw.ProfileId, name, bytes, store.RacingDeskProfileIds());
            if (!written.Ok) { r.Why = written.Why; return r; }
            sw.ProfileName = name;
            sw.WrittenSha = written.Sha;
            sw.WrittenFor = $"{action}: {baseName} {kg} kg";
            sw.WrittenAtUtc = _ctx.Now();
            store.SaveSmartControlSwitch(sw);
            r.Did.Add($"the Racing Desk row is now '{name}' ({baseName} at {kg} kg, its hash made to match), read back");
            return Send(action, needSim: false, r);
        }

        private const string A7Car = "(first run) RD test 65";

        private StepResult WriteWithTheEditorOpen()
        {
            if (!_ctx.Probe.EditorRunning()) return StepResult.No("A7", "open the SmartControl editor first: this step is about writing while it is open");
            using var store = _ctx.OpenStore();
            var sw = store.SmartControlSwitchRow();
            if (sw == null) return StepResult.No("A7", "make the Racing Desk profile first (A2)");
            var source = _ctx.ReadSmartControl()?.Profiles.FirstOrDefault(p => string.Equals(p.Name?.Trim(), "Default", StringComparison.OrdinalIgnoreCase));
            if (source == null) return StepResult.No("A7", "SmartControl has no Default");
            if (!SmartControlProfileEditor.TryEdit(source.Data, RestoreGate.A7Kg, null, out byte[] bytes, out string why)) return StepResult.No("A7", why);
            var r = new StepResult();
            var writer = _ctx.Writer;
            var test = store.CarSmartControlOf(A7Car);
            if (test == null)
            {
                var made = writer.InsertProfile("RD test 65", bytes);
                if (!made.Ok) { r.Why = made.Why; return r; }
                store.SaveCarSmartControl(new CarSmartControl
                {
                    CarPath = A7Car, ProfileId = made.ProfileId, ProfileName = "RD test 65", BaseName = "Default", BaseId = source.Id,
                    MadeAtUtc = _ctx.Now(), WrittenSha = made.Sha, WrittenKg = RestoreGate.A7Kg, WrittenAtUtc = _ctx.Now(), State = "test",
                });
                r.Did.Add("row 'RD test 65' added (Default at 65 kg)");
            }
            else r.Saw.Add("row 'RD test 65' was added before");
            string name = $"{RestorePolicy.SwitchProfileName} – A7 Default {RestoreGate.A7Kg} kg";
            var rewritten = writer.UpdateProfile(sw.ProfileId, name, bytes, store.RacingDeskProfileIds());
            if (!rewritten.Ok) { r.Why = rewritten.Why; return r; }
            sw.ProfileName = name;
            sw.WrittenSha = rewritten.Sha;
            sw.WrittenFor = "A7";
            sw.WrittenAtUtc = _ctx.Now();
            store.SaveSmartControlSwitch(sw);
            r.Did.Add($"the Racing Desk row rewritten as '{name}'");
            r.Saw.Add("now close the editor without editing, then check");
            r.Ok = true;
            return r;
        }

        private StepResult CheckAfterTheEditor()
        {
            if (_ctx.Probe.EditorRunning()) return StepResult.No("A7-check", "close the SmartControl editor first, without editing anything");
            using var store = _ctx.OpenStore();
            var sw = store.SmartControlSwitchRow();
            var test = store.CarSmartControlOf(A7Car);
            if (sw == null || test == null) return StepResult.No("A7-check", "run A7's write first");
            var writer = _ctx.Writer;
            var r = new StepResult { Ok = true };
            foreach (var (id, sha, label) in new[] { (sw.ProfileId, sw.WrittenSha, "the Racing Desk row"), (test.ProfileId, test.WrittenSha, "'RD test 65'") })
            {
                var now = writer.ReadProfile(id);
                bool same = now != null && ViewFiles.Sha(now.Value.Data) == sha;
                r.Saw.Add(label + (now == null ? " is not there" : same ? " is as written" : " was changed when the editor closed"));
                r.Ok &= same;
            }
            return r;
        }

        private StepResult Noted(string action, string said)
        {
            var r = new StepResult { Ok = true };
            r.Saw.Add(said);
            return r;
        }

        private string ForceWords()
        {
            var force = _ctx.Force();
            return force?.ForceKg == null ? "The key watcher has no force: none of Live's set keys was pressed since the car was loaded."
                                          : $"The key watcher has the brake force at {Words.Kg(force.ForceKg.Value)}.";
        }

        // ── C: his own profile and force again ──

        /// <summary>
        /// What SmartControl showed after the pedals were unplugged: the check of their memory. Racing Desk presses nothing and
        /// writes nothing; it checks what it can see (Live closed, SmartControl open to look at, the pedals plugged in) and keeps
        /// his answer. "Racing Desk's profile with my old values" or "Racing Desk's values" fails the brakes part.
        /// </summary>
        private StepResult PedalsMemory(string action, string answer)
        {
            if (_ctx.Probe.LiveRunning())
                return StepResult.No(action, "SmartControl Live is running: quit it from its tray icon first. It may send a profile to the pedals when they are plugged back in, and then what SmartControl shows is not what the pedals kept");
            if (!_ctx.Probe.EditorRunning())
                return StepResult.No(action, "open SmartControl and look at what it shows first, and only look: do not press Apply, Save or Restore");
            if (_ctx.Probe.PedalsConnected() == false)
                return StepResult.No(action, "Windows does not list the pedals: plug them back in, and look again");
            var r = new StepResult { Ok = answer == "own" };
            if (answer == "own")
                r.Saw.Add("you saw your own profile and your force from before the run: the pedals kept nothing of Racing Desk's");
            else
            {
                r.Why = RestoreClosing.FailedWords(answer);
                r.Saw.Add("pick your own profile in SmartControl now, as you normally do, close SmartControl, start SmartControl Live, set your force with your own keys, and confirm the last button of this step");
            }
            return r;
        }

        /// <summary>
        /// His word that his own profile is picked and his force is set again. Racing Desk cannot see either (nothing on the PC
        /// records which profile the pedals hold, or their force), so it checks what it can: the look at the pedals' memory was
        /// made after the last F24, SmartControl is closed and Live is running again. It presses and writes nothing.
        /// </summary>
        private StepResult OwnAgain()
        {
            ClosingState closing;
            using (var store = _ctx.OpenStore()) closing = RestoreClosing.Of(store);
            if (!closing.EepromFresh)
                return StepResult.No(RestoreClosing.Confirm, "say first what SmartControl showed after the pedals were unplugged (the first three buttons of this step): that look comes before you pick anything, and it has to come after the last F24");
            if (_ctx.Probe.EditorRunning())
                return StepResult.No(RestoreClosing.Confirm, "close SmartControl first, once you have picked your own profile in it");
            if (!_ctx.Probe.LiveRunning())
                return StepResult.No(RestoreClosing.Confirm, "start SmartControl Live, then set your usual force with your own keys, and confirm");
            if (_ctx.Probe.PedalsConnected() == false)
                return StepResult.No(RestoreClosing.Confirm, "Windows does not list the pedals: plug them in");
            var r = new StepResult { Ok = true };
            r.Saw.Add("Racing Desk cannot see which profile the pedals hold or what their force is: this is your word that your own profile is picked and your force is set");
            if (closing.Failed != null) r.Saw.Add(closing.Failed + " The brakes part stays failed.");
            return r;
        }

        // ── B: in the sim ──

        private StepResult IniToStart()
        {
            if (_ctx.Probe.SimRunning()) return StepResult.No("B1", "iRacing is running: this is written with the sim closed (the iRacing UI may be open)");
            double? was = _ctx.Files.AppIniHeight();
            var change = _ctx.Files.Apply(new ViewChange { IniHeight = _ctx.StartHeight, Why = "first run B1" });
            var r = new StepResult { Ok = change.Ok, Why = change.Ok ? null : change.Why };
            r.Did.AddRange(change.Did);
            if (change.Ok)
            {
                using var store = _ctx.OpenStore();
                // What app.ini held before Racing Desk's first write is kept by the writer itself, whichever step makes it.
                var b = store.ViewBaselineRow() ?? new ViewBaseline { StartHeight = _ctx.StartHeight, DecidedAtUtc = RestorePolicy.DecidedAtUtc, DecidedBy = RestorePolicy.DecidedBy };
                b.IniBackup = b.IniBackup ?? change.IniBackup;
                // The file's own time, which B1-check compares with: whether anything wrote app.ini again before the garage screen.
                b.IniWrittenAtUtc = AppIniWrittenAtUtc() ?? _ctx.Now();
                store.SaveViewBaseline(b);
                r.Saw.Add($"app.ini held {Fmt(was)} before; it holds {AppIniEditor.Format(_ctx.StartHeight)} now");
                // On the rig today app.ini already holds S: the write changes no value, and the check after the launch cannot
                // tell an edit that survived from one put back by the same number. B5 moves app.ini two centimetres and is the
                // test of that; B1-check still says whether the file was written again.
                if (was.HasValue && Math.Abs(was.Value - _ctx.StartHeight) < RestorePolicy.SmallestChange)
                    r.Saw.Add("it held that already, so this write changes no value: B1-check can show only whether something wrote app.ini again before the garage screen, not that an edit survives a launch — B5, two centimetres lower, shows that");
            }
            return r;
        }

        private StepResult IniAtTheGarage()
        {
            if (!_ctx.Probe.SimRunning()) return StepResult.No("B1-check", "start the test drive first and stop at the garage screen");
            double? h = _ctx.Files.AppIniHeight();
            var r = new StepResult { Ok = h.HasValue && Math.Abs(h.Value - _ctx.StartHeight) < RestorePolicy.SmallestChange };
            r.Saw.Add($"app.ini holds {Fmt(h)} with the sim running" + (r.Ok ? ": the edit survived the launch" : $", not {AppIniEditor.Format(_ctx.StartHeight)}"));
            DateTime? written;
            using (var store = _ctx.OpenStore()) written = store.ViewBaselineRow()?.IniWrittenAtUtc;
            DateTime? now = AppIniWrittenAtUtc();
            if (written.HasValue && now.HasValue)
                r.Saw.Add(now.Value > written.Value.AddSeconds(1)
                    ? $"app.ini was written again after B1, at {now.Value.ToLocalTime():HH:mm:ss}: by the iRacing UI or the sim"
                    : "app.ini has not been written since B1");
            return r;
        }

        /// <summary>When app.ini was last written, by its file's own time; null when there is none to ask.</summary>
        private DateTime? AppIniWrittenAtUtc()
        {
            string path = Path.Combine(_ctx.Files.Documents, "app.ini");
            return File.Exists(path) ? File.GetLastWriteTimeUtc(path) : (DateTime?)null;
        }

        private StepResult GarageFlags()
        {
            if (!_ctx.Probe.SimRunning()) return StepResult.No("B2-flags", "the sim is not running");
            var facts = _ctx.LastFacts();
            bool? elevated = _ctx.Probe.SimElevated();
            var r = new StepResult { Ok = facts != null && elevated == false };
            r.Saw.Add(facts == null ? "no telemetry has come from the sim yet" : $"{facts.CarPath}: {facts.Flags()}");
            r.Saw.Add(elevated == null ? "whether iRacing is elevated could not be asked" : elevated.Value ? "iRacing runs elevated: Windows would drop a key sent to it" : "iRacing is not elevated");
            if (facts != null) r.Saw.Add("parked by the rule: " + (ParkedRule.Place(facts, out string why) ?? "no (" + why + ")"));
            return r;
        }

        private StepResult SwitchToTheTestCar()
        {
            string car = RestoreGate.TestCar;
            if (!_ctx.Probe.SimRunning()) return StepResult.No("B2", "start the test drive in the Porsche 963 first");
            var facts = _ctx.LastFacts();
            if (facts == null || !string.Equals(facts.CarPath, car, StringComparison.OrdinalIgnoreCase))
                return StepResult.No("B2", $"the sim is not in the {car} (it says {facts?.CarPath ?? "nothing yet"})");
            if (!_ctx.Probe.LiveRunning()) return StepResult.No("B2", "SmartControl Live is not running");
            string early = NotParked(_ctx.Parked());
            if (early != null) return StepResult.No("B2", early + ": nothing was written or sent");
            var r = new StepResult();
            using var store = _ctx.OpenStore();
            var sw = store.SmartControlSwitchRow();
            if (sw?.BindingId == null) return StepResult.No("B2", "make the Racing Desk profile and bind F24 first (A2)");
            var snapshot = _ctx.ReadSmartControl();
            var writer = _ctx.Writer;
            var mine = store.CarSmartControlOf(car);
            byte[] bytes;
            string name;
            if (mine == null || mine.State != "made")
            {
                var bound = store.CarPedalsOf(car);
                if (bound == null) return StepResult.No("B2", "the 963 has no base profile in the store");
                var plan = RestorePlanner.PlanBrakes(bound, store.CarPedalFactsOf(car), null, facts.CarName ?? "Porsche 963 GTP", snapshot, snapshot?.Profiles.Select(p => p.Name) ?? Enumerable.Empty<string>());
                if (plan.State != "would-make") return StepResult.No("B2", plan.Words);
                var from = snapshot.Profiles.First(p => p.Id == plan.BaseId);
                if (!SmartControlProfileEditor.TryEdit(from.Data, plan.Kg.Value, SmartControlProfileEditor.DescriptionFor(plan.Name, plan.BaseName), out bytes, out string why))
                    return StepResult.No("B2", why);
                var made = writer.InsertProfile(plan.ProfileName, bytes);
                if (!made.Ok) { r.Why = made.Why; return r; }
                mine = new CarSmartControl
                {
                    CarPath = car, ProfileId = made.ProfileId, ProfileName = plan.ProfileName, BaseName = plan.BaseName, BaseId = plan.BaseId,
                    MadeAtUtc = _ctx.Now(), WrittenSha = made.Sha, WrittenKg = plan.Kg.Value, WrittenAtUtc = _ctx.Now(), State = "made",
                };
                store.SaveCarSmartControl(mine);
                r.Did.Add($"its own profile '{plan.ProfileName}' made from {plan.BaseName} at {plan.Kg} kg");
                name = plan.Name;
            }
            else
            {
                var row = writer.ReadProfile(mine.ProfileId);
                if (row == null) return StepResult.No("B2", "its profile is not in SmartControl any more");
                bytes = row.Value.Data;
                name = facts.CarName ?? mine.ProfileName;
                r.Saw.Add($"its own profile '{mine.ProfileName}' was made before");
            }
            string switchName = $"{RestorePolicy.SwitchProfileName} – {name}";
            var copied = writer.UpdateProfile(sw.ProfileId, switchName, bytes, store.RacingDeskProfileIds());
            if (!copied.Ok) { r.Why = copied.Why; return r; }
            sw.ProfileName = switchName;
            sw.WrittenSha = copied.Sha;
            sw.WrittenFor = car;
            sw.WrittenAtUtc = _ctx.Now();
            store.SaveSmartControlSwitch(sw);
            r.Did.Add($"copied into the Racing Desk row as '{switchName}'");
            var sent = Send("B2", needSim: true, r);
            if (sent.Ok)
            {
                mine.SwitchedAtUtc = _ctx.Now();
                store.SaveCarSmartControl(mine);
            }
            return sent;
        }

        /// <summary>The 963's own cockpit Z: what Racing Desk found in its file before it first wrote it.</summary>
        private (CamFileState Cam, CarViewKeep Keep, double OwnZ, double OwnShift)? TestCarFile(string action, out StepResult refused)
        {
            refused = null;
            string car = RestoreGate.TestCar;
            if (_ctx.Probe.SimRunning()) { refused = StepResult.No(action, "iRacing is running: exit the sim first"); return null; }
            var cam = _ctx.Files.Cam(car);
            if (cam == null || !cam.Exists || !cam.Writable) { refused = StepResult.No(action, $"the 963's camera file is not one Racing Desk writes ({cam?.Why ?? "no file"})"); return null; }
            using var store = _ctx.OpenStore();
            var keep = store.CarViewKeepOf(car);
            double own = keep?.OwnZ ?? cam.Z ?? 0;
            double shift = keep?.OwnVerticalShift ?? cam.VerticalShift ?? 0;
            return (cam, keep, own, shift);
        }

        private StepResult WriteTestCar(string action, ViewChange change, double ownZ, double ownShift, double addedZ, double addedShift)
        {
            var file = TestCarFile(action, out var refused);
            if (file == null) return refused;
            var result = _ctx.Files.Apply(change);
            var r = new StepResult { Ok = result.Ok, Why = result.Ok ? null : result.Why };
            r.Did.AddRange(result.Did);
            if (!result.Ok) return r;
            using var store = _ctx.OpenStore();
            var keep = store.CarViewKeepOf(RestoreGate.TestCar) ?? new CarViewKeep { CarPath = RestoreGate.TestCar };
            keep.CamFile = file.Value.Cam.RelativePath;
            keep.OwnZ = ownZ;
            keep.AddedZ = addedZ;
            keep.WrittenZ = change.CockpitZ ?? ownZ + addedZ;
            keep.OwnVerticalShift = ownShift;
            keep.AddedVerticalShift = addedShift;
            keep.WrittenVerticalShift = change.CockpitShift ?? ownShift + addedShift;
            keep.WrittenSha = result.CamSha ?? keep.WrittenSha;
            keep.WrittenAtUtc = _ctx.Now();
            keep.OriginalBackup = keep.OriginalBackup ?? _ctx.Files.Original(file.Value.Cam.RelativePath);
            keep.SeenAtUtc = _ctx.Now();
            store.SaveCarViewKeep(keep);
            return r;
        }

        private StepResult TestCarLower()
        {
            var file = TestCarFile("B4", out var refused);
            if (file == null) return refused;
            var (_, _, own, shift) = file.Value;
            var r = WriteTestCar("B4", new ViewChange { CarPath = RestoreGate.TestCar, CockpitZ = own + RestoreGate.TestShift, IniHeight = _ctx.StartHeight, Why = "first run B4" },
                own, shift, RestoreGate.TestShift, 0);
            if (r.Ok) r.Saw.Add($"relaunch the 963: screenshot B should be {Words.Cm(-RestoreGate.TestShift).TrimStart('+')} lower than A if the file is applied");
            return r;
        }

        private StepResult IniLower()
        {
            var file = TestCarFile("B5", out var refused);
            if (file == null) return refused;
            var (_, _, own, shift) = file.Value;
            var r = WriteTestCar("B5", new ViewChange { CarPath = RestoreGate.TestCar, CockpitZ = own, IniHeight = _ctx.StartHeight + RestoreGate.TestShift, Why = "first run B5" },
                own, shift, 0, 0);
            if (r.Ok) r.Saw.Add("relaunch: screenshot C should match B");
            return r;
        }

        private StepResult ShiftUp()
        {
            var file = TestCarFile("B6", out var refused);
            if (file == null) return refused;
            var (_, _, own, shift) = file.Value;
            return WriteTestCar("B6", new ViewChange { CarPath = RestoreGate.TestCar, CockpitShift = shift + 0.02, Why = "first run B6" }, own, shift, file.Value.Keep?.AddedZ ?? 0, 0.02);
        }

        private StepResult HorizonUp()
        {
            var file = TestCarFile("B6-b", out var refused);
            if (file == null) return refused;
            var (_, _, own, shift) = file.Value;
            double? vy = _ctx.Files.AppIniValue(ViewFiles.VanishYKey);
            if (vy == null) return StepResult.No("B6-b", "app.ini has no DrivingVanishY");
            // The original plus 0.02, however many times it is pressed: the value it held before Racing Desk's first write of it,
            // else the one it holds now (this is that first write).
            double was;
            using (var store = _ctx.OpenStore()) was = store.ViewBaselineRow()?.VanishYOriginal ?? vy.Value;
            var r = WriteTestCar("B6-b", new ViewChange { CarPath = RestoreGate.TestCar, CockpitShift = shift, IniVanishY = was + 0.02, Why = "first run B6" }, own, shift, file.Value.Keep?.AddedZ ?? 0, 0);
            if (r.Ok) r.Saw.Add($"DrivingVanishY is {AppIniEditor.Format(was)} + 0.02, however many times this is pressed");
            return r;
        }

        private StepResult FovAsBefore()
        {
            double? fov = _ctx.Files.AppIniValue("drivingCamFOV");
            byte[] original = ViewFiles.ReadShared(_ctx.Files.Original("app.ini"));
            double? was = original != null && AppIniEditor.TryReadValue(original, "View", "drivingCamFOV", out double f) ? f : (double?)null;
            var r = new StepResult { Ok = fov.HasValue && (was == null ? Math.Abs(fov.Value - 70) < 1e-6 : Math.Abs(fov.Value - was.Value) < 1e-6) };
            r.Saw.Add($"drivingCamFOV is {Fmt(fov)}" + (was.HasValue ? $"; before the first run it was {Fmt(was)}" : ""));
            return r;
        }

        private StepResult PutBack()
        {
            if (_ctx.Probe.SimRunning()) return StepResult.No("B7-restore", "iRacing is running: exit the sim first");
            var r = new StepResult { Ok = true };
            using var store = _ctx.OpenStore();
            // The same as undo: app.ini's two values, and the 963's cockpit, each back to what it held before Racing Desk wrote
            // it and only while it still holds what Racing Desk wrote. The whole-file copies are not put back by this.
            RestoreUndo.PutBackIni(_ctx, store, r);
            var keep = store.CarViewKeepOf(RestoreGate.TestCar);
            if (keep != null) RestoreUndo.PutBackCam(_ctx, store, keep, r);
            else r.Saw.Add("Racing Desk has written nothing into the 963's camera file");
            if (r.Did.Count == 0 && r.Saw.Count == 0) r.Saw.Add("Racing Desk has written nothing into app.ini");
            return r;
        }

        /// <summary>The cars he drives most that had no camera file: Dallara F3, Lotus 79, Caterham 420R.</summary>
        public static readonly IReadOnlyList<string> CarsWithoutFiles = new[] { "dallaraf3", "lotus79", "caterham caterham420r" };

        private StepResult NewCameraFiles()
        {
            var r = new StepResult();
            int good = 0;
            foreach (string car in CarsWithoutFiles)
            {
                var cam = _ctx.Files.Cam(car);
                if (cam == null || !cam.Exists) { r.Saw.Add($"{car}: no camera file yet"); continue; }
                if (cam.Writable) { good++; r.Saw.Add($"{car}: {cam.RelativePath}, 1,668 bytes, version 14 or 15 — Racing Desk can keep its height"); }
                else r.Saw.Add($"{car}: {cam.RelativePath} is not one Racing Desk writes ({cam.Why})");
            }
            r.Ok = good > 0;
            if (!r.Ok) r.Why = "No new camera file is one Racing Desk can write yet.";
            return r;
        }

        private static string Fmt(double? v) => v.HasValue ? AppIniEditor.Format(v.Value) : "nothing it could read";
    }
}
