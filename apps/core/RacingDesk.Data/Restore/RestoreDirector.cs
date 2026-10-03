using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using RacingDesk.Data.Pedals;

namespace RacingDesk.Data.Restore
{
    /// <summary>
    /// Putting back each car's seat height and brakes (docs/view-and-pedals-plan.md), in the host, by itself:
    /// <list type="bullet">
    /// <item><b>Brakes</b>: once, Racing Desk adds its own SmartControl profile and binds F24 to it in Live's Default preset
    /// (<see cref="EnsureSetup"/>, with the SmartControl editor closed). When he is parked in a car — garage screen or pit
    /// stall, still, brake released, on fresh frames, not a replay — and that car's brakes are not on the pedals yet, its base
    /// at its force is written into that profile and F24 is pressed once (<see cref="PutBrakesOn"/>), only with the editor
    /// closed, Live running and started after the binding was written, and iRacing in front and not elevated.</item>
    /// <item><b>Seat height</b>: when the sim has gone, what he changed in the car (app.ini above S) is folded into the car's
    /// camera file and app.ini goes back to S (<see cref="Fold"/>), so iRacing puts it back itself next time. Once, the heights
    /// he chose before go into the cars' camera files the same way (<see cref="MoveRemembered"/>). When the sim next starts,
    /// app.ini is read: if it does not hold what Racing Desk left there, something else writes it, and the height part turns
    /// itself off and puts each camera file back (<see cref="SelfCheck"/>).</item>
    /// </list>
    /// <see cref="See"/> is called on every telemetry frame and keeps to cheap decisions under a short lock; anything that
    /// touches a file, the store or SmartControl's database is queued for the director's own worker, one thing at a time, in
    /// order, and what it throws is logged and goes no further.
    /// </summary>
    public sealed class RestoreDirector
    {
        private readonly RestoreContext _ctx;
        private readonly string _switchesFile;
        private readonly object _gate = new object();
        private readonly object _commandGate = new object();      // one command at a time: a switch, undo
        private readonly ParkedRule _parked = new ParkedRule();
        private RestoreSwitches _switches;
        private Task _work = Task.CompletedTask;
        private Run _run;
        private ParkedNow _parkedNow;
        private bool _simSeen;              // a frame has come since the host started or the sim last went: the self-check is made at the first
        private string _brakesWaiting;      // why the last try did not put the brakes on, for the status; null once they went on
        private DateTime _setupTriedAt = DateTime.MinValue;

        /// <summary>How long a setup that could not be made waits before a look at the desk tries it again.</summary>
        public TimeSpan SetupTryAgainAfter { get; set; } = TimeSpan.FromSeconds(30);

        // The plan, kept for a little: the desk asks every time it shows a car, and it reads files and two databases.
        private RestorePlan _plan;
        private DateTime _planAt = DateTime.MinValue;
        public TimeSpan PlanKeptFor { get; set; } = TimeSpan.FromSeconds(15);

        private sealed class Run
        {
            public string Car, Name;
            public bool FlagsLogged, WasParked;

            /// <summary>The car's brakes went on, or were on already, or need not go on (his key won, none for this car): nothing more in this car load.</summary>
            public bool Done;

            /// <summary>A try is queued or under way, and when the last one was asked for (by the frame's time).</summary>
            public bool Trying;
            public DateTime TriedAt = DateTime.MinValue;
        }

        /// <param name="switchesFile">restore.json, beside the host's settings; null keeps them in memory (a test's).</param>
        public RestoreDirector(RestoreContext ctx, string switchesFile)
        {
            _ctx = ctx ?? throw new ArgumentNullException(nameof(ctx));
            _switchesFile = switchesFile;
            _switches = RestoreSwitches.Load(switchesFile);
            _ctx.Parked = () => { lock (_gate) return _parkedNow; };
        }

        public RestoreContext Context => _ctx;

        public RestoreSwitches Switches
        {
            get { lock (_gate) return _switches.Copy(); }
        }

        /// <summary>Waits for what has been queued so far (tests, and the host's stop).</summary>
        public Task Settled()
        {
            lock (_gate) return _work;
        }

        private Task Queue(Action work)
        {
            lock (_gate)
            {
                _work = _work.ContinueWith(_ =>
                {
                    try { work(); }
                    catch (Exception ex) { _ctx.Log("restore: " + ex.GetType().Name + " — " + ex.Message.Trim()); }
                }, TaskScheduler.Default);
                return _work;
            }
        }

        private void Save(RestoreSwitches now)
        {
            if (!now.Save(_switchesFile) && _switchesFile != null) _ctx.Log("restore: restore.json was not written");
        }

        // ── The host's start ──

        /// <summary>
        /// The host has started. With the sim closed: a write of the view files that a stop cut short is put back, never finished;
        /// a put-back the self-check owes is made; the heights he chose before go into the cars' camera files, once. Then the
        /// brakes' profile and key are made, if they are not there yet.
        /// </summary>
        public void HostStarted()
        {
            Queue(() =>
            {
                foreach (var note in _ctx.Files.Settle())
                {
                    if (note.State == "info") _ctx.Log($"restore: {note.Car} — {note.Text}");
                    else _ctx.Say(note.Car, "height", note.State, note.Text);
                }
                using (var store = _ctx.OpenStore())
                {
                    if (!store.HasRestoreTables) return;
                    if (store.ViewBaselineRow() == null)
                        store.SaveViewBaseline(new ViewBaseline { StartHeight = _ctx.StartHeight, DecidedAtUtc = RestorePolicy.DecidedAtUtc, DecidedBy = RestorePolicy.DecidedBy });
                }
                var switches = Switches;
                if (switches.HeightPutBackOwed) PutBackOwed();
                else if (switches.Height) MoveRemembered(null);
                if (switches.Brakes) Setup();
            });
        }

        // ── Every frame ──

        /// <summary>The frame's facts. Cheap: a parked moment queues a try at the brakes, and nothing waits on it.</summary>
        public void See(SeatFacts f)
        {
            if (f == null || string.IsNullOrWhiteSpace(f.CarPath)) return;
            Run run, attempt = null;
            bool selfCheck = false, carLoaded = false;
            string flags = null;
            lock (_gate)
            {
                if (!_simSeen) { _simSeen = true; selfCheck = true; }
                if (_run == null || !string.Equals(_run.Car, f.CarPath.Trim(), StringComparison.OrdinalIgnoreCase))
                {
                    _run = new Run { Car = f.CarPath.Trim(), Name = string.IsNullOrWhiteSpace(f.CarName) ? f.CarPath.Trim() : f.CarName.Trim() };
                    _parked.Reset();
                    _parkedNow = null;
                    carLoaded = true;
                }
                run = _run;
                if (!run.FlagsLogged && !f.IsOnTrack)
                {
                    run.FlagsLogged = true;
                    flags = f.Flags();
                }
                // Asked of every frame, so that the second he has been still is counted from the frames themselves, and the newest
                // answer is what the key is checked against right before it goes.
                bool parked = _parked.Parked(f, out string place, out string whyNot);
                _parkedNow = new ParkedNow { Parked = parked, Place = place, Why = whyNot, FactsAtUtc = f.AtUtc };
                // A try when he has just parked, and again every few seconds while he stays parked and they have not gone on.
                if (parked && !run.Done && !run.Trying && _switches.Brakes && (!run.WasParked || f.AtUtc - run.TriedAt >= RestorePolicy.TryAgainEvery))
                {
                    run.Trying = true;
                    run.TriedAt = f.AtUtc;
                    attempt = run;
                }
                run.WasParked = parked;
            }
            if (selfCheck) Queue(SelfCheck);
            if (flags != null) { string car = run.Car; Queue(() => _ctx.Log($"restore: {car} — out of the car, the sim says {flags}")); }
            if (carLoaded) Queue(() => CarLoaded(run));
            if (attempt != null)
                Queue(() =>
                {
                    try { PutBrakesOn(attempt); }
                    finally { lock (_gate) attempt.Trying = false; }
                });
        }

        /// <summary>
        /// The sim has stopped sending: the next car, or the same car again, is a car load of its own, and the next frame is the
        /// sim's start (the self-check). The last frame goes with it, so that nothing acts on a previous session's frame.
        /// </summary>
        public void SimGone()
        {
            lock (_gate)
            {
                _run = null;
                _parkedNow = null;
                _parked.Reset();
                _simSeen = false;
                _brakesWaiting = null;      // what a car waited for goes with it
            }
        }

        private void CarLoaded(Run run)
        {
            using (var store = _ctx.OpenStore())
                if (store.HasRestoreTables) run.Name = RestorePlanner.NameOf(store, run.Car, run.Name);
            // The profile and the key are made as soon as they can be: Live has them only from its next start.
            if (Switches.Brakes) Setup();
        }

        // ── Brakes ──

        private sealed class SetupState
        {
            public bool Ready;
            public string Waiting;
            public string Stopped;
            public SmartControlSwitch Switch;
        }

        private void Setup()
        {
            var state = EnsureSetup();
            if (state.Stopped != null) TurnBrakesOff(state.Stopped);
            else if (state.Waiting != null) _brakesWaiting = state.Waiting;
        }

        /// <summary>
        /// Racing Desk's own SmartControl profile ("Racing Desk", a copy of Default) and F24 · Set profile bound to it in Live's
        /// Default preset, as SmartControl itself writes them: made once, made again if he deleted either, only with the
        /// SmartControl editor closed and the database backed up first. Live reads its keys when it starts, so a binding written
        /// now works from its next start. Ready when both are there in the database.
        /// </summary>
        private SetupState EnsureSetup()
        {
            _setupTriedAt = _ctx.Now();
            var writer = _ctx.Writer;
            if (!File.Exists(writer.DatabasePath)) return new SetupState { Stopped = "SmartControl's database isn't on this PC" };
            long? version = writer.DatabaseVersion();
            if (version == null) return new SetupState { Waiting = "Waiting for SmartControl's database, which couldn't be read." };
            if (version != RestorePolicy.SmartControlDatabaseVersion) return new SetupState { Stopped = $"SmartControl's database is version {version}, which Racing Desk doesn't know" };
            var before = _ctx.ReadSmartControl();
            if (before == null) return new SetupState { Waiting = "Waiting for SmartControl's database, which couldn't be read." };

            using var store = _ctx.OpenStore();
            if (!store.HasRestoreTables) return new SetupState { Waiting = "Waiting for Racing Desk's store." };
            var sw = store.SmartControlSwitchRow();
            bool profileThere = sw != null && before.Profiles.Any(p => p.Id == sw.ProfileId);
            bool keyThere = profileThere && sw.BindingId.HasValue && KeyIsThere(before, sw);
            if (profileThere && keyThere) return new SetupState { Ready = true, Switch = sw };

            if (_ctx.Probe.EditorRunning())
                return new SetupState
                {
                    Waiting = sw == null ? "Waiting for the SmartControl editor to close, to add Racing Desk's own profile and its F24 key."
                                         : "Waiting for the SmartControl editor to close, to put Racing Desk's profile and its F24 key back.",
                };
            string notCopied = _ctx.BackUpBeforeWrite("setup");
            if (notCopied != null) return new SetupState { Waiting = "Waiting: SmartControl's database couldn't be copied first, so nothing was written (" + notCopied + ")." };

            var writes = new List<string>();
            var ours = store.RacingDeskProfileIds();
            var oursAll = new HashSet<string>(ours, StringComparer.OrdinalIgnoreCase);      // every id that was Racing Desk's in this, for the check of his rows
            if (sw != null && !profileThere)
            {
                // He deleted Racing Desk's profile in SmartControl: its key goes with it (only while it is still Racing Desk's), and both are made again.
                if (sw.BindingId.HasValue)
                {
                    var unbound = writer.Unbind(sw.BindingId.Value, sw.LinkId, ours);
                    if (!unbound.Ok) _ctx.Log("restore: the old F24 key was left — " + unbound.Why);
                }
                store.ForgetSmartControlSwitch();
                sw = null;
            }
            if (sw == null)
            {
                var source = before.Profiles.FirstOrDefault(p => string.Equals(p.Name?.Trim(), RestorePolicy.SwitchProfileFrom, StringComparison.OrdinalIgnoreCase));
                if (source == null) return new SetupState { Stopped = $"SmartControl has no profile named {RestorePolicy.SwitchProfileFrom} to start Racing Desk's own from" };
                var made = writer.InsertProfile(RestorePolicy.SwitchProfileName, source.Data);
                if (!made.Ok) return new SetupState { Waiting = "Waiting: Racing Desk's own profile couldn't be added (" + made.Why + ")." };
                sw = new SmartControlSwitch
                {
                    ProfileId = made.ProfileId, ProfileName = RestorePolicy.SwitchProfileName, Key = RestorePolicy.SwitchKey, MadeAtUtc = _ctx.Now(),
                    WrittenSha = made.Sha, WrittenAtUtc = _ctx.Now(),
                };
                store.SaveSmartControlSwitch(sw);   // from here the row is Racing Desk's, and undo knows it
                ours = store.RacingDeskProfileIds();
                writes.Add($"its own profile '{RestorePolicy.SwitchProfileName}', a copy of {RestorePolicy.SwitchProfileFrom}");
            }
            if (!KeyIsThere(_ctx.ReadSmartControl() ?? before, sw))
            {
                var bound = writer.BindProfileKey(sw.ProfileId, RestorePolicy.SwitchKey, RestorePolicy.LivePreset, RestorePolicy.LivePresetName, ours);
                if (!bound.Ok)
                {
                    string why = bound.Why ?? "";
                    if (why.Contains("bound already")) return new SetupState { Stopped = $"{RestorePolicy.SwitchKey} is already used in SmartControl Live's {RestorePolicy.LivePresetName} preset" };
                    if (why.StartsWith("Live has no preset") || why.StartsWith("Live's preset")) return new SetupState { Stopped = $"SmartControl Live has no preset named {RestorePolicy.LivePresetName} where Racing Desk expects it" };
                    return new SetupState { Waiting = "Waiting: the F24 key couldn't be added (" + why + ")." };
                }
                sw.BindingId = bound.BindingId;
                sw.LinkId = bound.LinkId;
                sw.PresetId = RestorePolicy.LivePreset;
                sw.BoundAtUtc = _ctx.Now();
                sw.PedalsAtUtc = null;
                store.SaveSmartControlSwitch(sw);
                writes.Add($"{RestorePolicy.SwitchKey} · Set profile in SmartControl Live's {RestorePolicy.LivePresetName} preset");
            }
            // His own rows, compared before and after: a write of Racing Desk's must leave every one of them as it was.
            oursAll.UnionWith(store.RacingDeskProfileIds());
            string changed = HisRowsChanged(before, _ctx.ReadSmartControl(), oursAll, sw.BindingId);
            if (changed != null) _ctx.Say(null, "setup", "failed", "SmartControl: " + changed + " after Racing Desk wrote its own rows; its backups are in " + _ctx.SmartControlBackups + ".");
            if (writes.Count > 0)
                _ctx.Say(null, "setup", "done", "Racing Desk added " + string.Join(" and ", writes) + "; the brakes start working the next time SmartControl Live starts.");
            return new SetupState { Ready = true, Switch = sw };
        }

        private static bool KeyIsThere(SmartControlSnapshot snapshot, SmartControlSwitch sw) =>
            sw?.BindingId != null && snapshot.Keys.Any(k => k.BindingId == sw.BindingId && k.Action == LiveAction.SetProfile && k.ProfileId == sw.ProfileId
                && string.Equals(k.FirstKey, RestorePolicy.SwitchKey, StringComparison.OrdinalIgnoreCase) && string.IsNullOrEmpty(k.SecondKey) && k.PresetId == RestorePolicy.LivePreset);

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
            bool His(LiveKey k) => k.BindingId != ourBinding && !(k.Action == LiveAction.SetProfile && k.ProfileId != null && ours.Contains(k.ProfileId));
            var keysBefore = before.Keys.Where(His).Select(Key).ToList();
            var keysAfter = after.Keys.Where(His).Select(Key).ToList();
            if (!keysBefore.SequenceEqual(keysAfter)) return "his keys changed";
            return null;
        }

        /// <summary>When Live has F24: it is running and started after the binding was written. Null when it has; else what it waits for.</summary>
        private string LiveWaits(SmartControlSwitch sw)
        {
            if (!_ctx.Probe.LiveRunning()) return "Waiting for SmartControl Live to run: it usually starts with Windows.";
            DateTime? started = _ctx.Probe.LiveStartedAtUtc();
            DateTime bound = sw.BoundAtUtc ?? sw.MadeAtUtc;
            if (started == null) return "Waiting: Racing Desk can't tell when SmartControl Live started, so it can't tell whether Live has the F24 key.";
            if (started.Value < bound) return "Starts working the next time SmartControl Live starts: quit it from its tray icon and start it again, or restart the PC.";
            return null;
        }

        /// <summary>Why he is not parked on the newest frame, in words; null when he is, on a frame no older than three seconds.</summary>
        private string NotParked(ParkedNow park)
        {
            if (park == null) return "no frame has come from the sim to say you are parked";
            double age = (_ctx.Now() - park.FactsAtUtc).TotalSeconds;
            if (age > RestorePolicy.FactsFreshFor.TotalSeconds) return $"the sim's last frame is {age:0} s old";
            if (!park.Parked) return "you are not parked (" + park.Why + ")";
            return null;
        }

        /// <summary>Whether iRacing is in front and not elevated, as a key needs: null when it is; else why not.</summary>
        private string NotInFront()
        {
            string front = _ctx.Probe.ForegroundProcess();
            if (front == null || !WindowsRigProbe.SimProcesses.Contains(front, StringComparer.OrdinalIgnoreCase)) return "iRacing isn't the window in front";
            if (_ctx.Probe.ForegroundElevated() != false) return "iRacing runs as administrator, and Windows would drop a key sent to it";
            return null;
        }

        private void Wait(Run run, string why)
        {
            _brakesWaiting = why;
            _ctx.Log($"restore: {run.Car} — brakes not put on yet: {why}");
        }

        /// <summary>
        /// He is parked in a car whose brakes have not gone on in this car load: its base at its force goes into Racing Desk's
        /// profile and F24 is pressed once, after every check holds; or nothing is done, and why is kept for the status. Nothing
        /// of Apply, Save or Restore in SmartControl, nothing of the pedals' memory, no key but F24.
        /// </summary>
        private void PutBrakesOn(Run run)
        {
            if (!Switches.Brakes || run.Done) return;
            string car = run.Car;

            // His key wins: a force he set in this car before the brakes went on is left as he set it.
            if (_ctx.PressesThisRun() > 0)
            {
                run.Done = true;
                _ctx.Log($"restore: {car} — you set the brake force with your keys before Racing Desk put the brakes on, so it leaves them");
                return;
            }
            string notParked = NotParked(_ctx.Parked());
            if (notParked != null) { Wait(run, "Waiting: " + notParked + "."); return; }

            var setup = EnsureSetup();
            if (setup.Stopped != null) { TurnBrakesOff(setup.Stopped); return; }
            if (!setup.Ready) { Wait(run, setup.Waiting); return; }
            var sw = setup.Switch;
            string live = LiveWaits(sw);
            if (live != null) { Wait(run, live); return; }
            if (_ctx.Probe.PedalsConnected() == false) { Wait(run, "Waiting for the pedals: Windows doesn't list them."); return; }

            BrakesPlan plan;
            using (var store = _ctx.OpenStore())
            {
                run.Name = RestorePlanner.NameOf(store, car, run.Name);
                plan = RestorePlanner.PlanBrakes(store, car, run.Name, _ctx.ReadSmartControl());
                sw = store.SmartControlSwitchRow() ?? sw;
            }
            if (plan.State != "on")
            {
                // Nothing to put on in this car: his choice of none, or no base yet, or none that could be made. Said once, in the log.
                run.Done = true;
                _brakesWaiting = null;
                _ctx.Log($"restore: {car} — {plan.Words}");
                return;
            }

            // On the pedals already: the same car's same bytes, pressed since they were written, nothing moved since, Live not
            // started again since. Nothing to press; the force is the car's all the same.
            DateTime? liveStarted = _ctx.Probe.LiveStartedAtUtc();
            if (sw.PedalsAtUtc.HasValue && string.Equals(sw.WrittenFor, car, StringComparison.OrdinalIgnoreCase) && sw.WrittenSha == plan.Sha
                && liveStarted.HasValue && liveStarted.Value <= sw.PedalsAtUtc.Value)
            {
                run.Done = true;
                _brakesWaiting = null;
                _ctx.ForceIs(car, plan.Kg.Value);
                _ctx.Log($"restore: {car} — its brakes are on the pedals already ({plan.BaseName}, {plan.Kg} kg)");
                return;
            }

            if (_ctx.Probe.EditorRunning()) { Wait(run, $"Waiting for the SmartControl editor to close, to put the {run.Name}'s brakes on."); return; }
            string front = NotInFront();
            if (front != null) { Wait(run, $"Waiting to put the {run.Name}'s brakes on: {front}."); return; }

            if (!(string.Equals(sw.WrittenFor, car, StringComparison.OrdinalIgnoreCase) && sw.WrittenSha == plan.Sha))
            {
                string notCopied = _ctx.BackUpBeforeWrite("brakes");
                if (notCopied != null) { Wait(run, "Waiting: SmartControl's database couldn't be copied first, so nothing was written (" + notCopied + ")."); return; }
                using var store = _ctx.OpenStore();
                string name = $"{RestorePolicy.SwitchProfileName} – {run.Name}";
                var written = _ctx.Writer.UpdateProfile(sw.ProfileId, name, plan.Bytes, store.RacingDeskProfileIds());
                if (!written.Ok) { Wait(run, $"Waiting: the {run.Name}'s brakes couldn't be written ({written.Why})."); return; }
                sw.ProfileName = name;
                sw.WrittenSha = written.Sha;
                sw.WrittenFor = car;
                sw.WrittenAtUtc = _ctx.Now();
                sw.PedalsAtUtc = null;
                store.SaveSmartControlSwitch(sw);
            }

            // Right before the key: asked again, on what is so now — the write can take a moment, and he may have moved off.
            notParked = NotParked(_ctx.Parked());
            if (notParked != null) { Wait(run, "Waiting: " + notParked + "."); return; }
            if (!_ctx.Probe.SimRunning()) { Wait(run, "Waiting: iRacing isn't running."); return; }
            front = NotInFront();
            if (front != null) { Wait(run, $"Waiting to put the {run.Name}'s brakes on: {front}."); return; }
            live = LiveWaits(sw);
            if (live != null) { Wait(run, live); return; }

            // The press is written down first, so that nothing after it can lose that the pedals may be on this row.
            DateTime? sentBefore = sw.SentAtUtc;
            using (var store = _ctx.OpenStore())
            {
                sw.SentAtUtc = _ctx.Now();
                store.SaveSmartControlSwitch(sw);
            }
            if (!_ctx.Keys.SendF24())
            {
                using var store = _ctx.OpenStore();
                sw.SentAtUtc = sentBefore;
                store.SaveSmartControlSwitch(sw);
                Wait(run, "Waiting: Windows didn't take the F24 key.");
                return;
            }
            using (var store = _ctx.OpenStore())
            {
                sw.PedalsAtUtc = _ctx.Now();
                store.SaveSmartControlSwitch(sw);
            }
            run.Done = true;
            _brakesWaiting = null;
            // The force is the car's now: his +5 and -5 count from it.
            _ctx.ForceIs(car, plan.Kg.Value);
            _ctx.Say(car, "brakes", "done", $"The {run.Name}'s brakes went on: {plan.BaseName} at {plan.Kg} kg.");
        }

        /// <summary>
        /// What a run left of the pedals: a key he pressed in the car moved the force away from what Racing Desk put on, so the
        /// row is not on the pedals as written any more, and the next car load presses again.
        /// </summary>
        public void PedalsLeft(PedalsSeen seen)
        {
            if (seen == null || string.IsNullOrWhiteSpace(seen.CarPath) || seen.Presses <= 0) return;
            Queue(() =>
            {
                using var store = _ctx.OpenStore();
                var sw = store.SmartControlSwitchRow();
                if (sw?.PedalsAtUtc == null) return;
                sw.PedalsAtUtc = null;
                store.SaveSmartControlSwitch(sw);
            });
        }

        private void TurnBrakesOff(string why)
        {
            RestoreSwitches now;
            lock (_gate)
            {
                if (!_switches.Brakes) return;
                _switches.Brakes = false;
                _switches.BrakesOffWhy = why;
                _switches.BrakesOffAtUtc = _ctx.Now();
                now = _switches.Copy();
            }
            Save(now);
            _ctx.Say(null, "brakes", "off", "The brakes part turned itself off: " + why + ".");
        }

        // ── Seat height ──

        /// <summary>
        /// The sim has started (its first frame): app.ini should hold what Racing Desk last wrote into it. If it holds something
        /// else, something writes its own value back over it, and the heights Racing Desk keeps would be counted twice: the height
        /// part turns itself off, and each camera file is put back once iRacing has closed.
        /// </summary>
        private void SelfCheck()
        {
            var switches = Switches;
            if (!switches.Height) return;
            double? h = _ctx.Files.AppIniHeight();
            ViewBaseline b;
            using (var store = _ctx.OpenStore())
            {
                if (!store.HasRestoreTables) return;
                store.NoteLaunch(h, _ctx.Now());
                b = store.ViewBaselineRow();
            }
            if (h == null || b?.IniHeightWritten == null) return;     // nothing Racing Desk wrote to hold it to
            if (switches.HeightOnSinceUtc.HasValue && (b.IniWrittenAtUtc == null || b.IniWrittenAtUtc.Value < switches.HeightOnSinceUtc.Value)) return;
            if (Math.Abs(h.Value - b.IniHeightWritten.Value) < RestorePolicy.SmallestChange) return;

            string why = $"app.ini's seat height was {Words.Cm(h.Value)} when iRacing started, not the {Words.Cm(b.IniHeightWritten.Value)} Racing Desk left there, so something else writes it";
            RestoreSwitches now;
            lock (_gate)
            {
                _switches.Height = false;
                _switches.HeightOffWhy = why;
                _switches.HeightOffAtUtc = _ctx.Now();
                _switches.HeightPutBackOwed = true;
                now = _switches.Copy();
            }
            Save(now);
            _ctx.Say(null, "height", "off", "The seat height part turned itself off: " + why + "; each car's camera file is put back when iRacing closes.");
        }

        /// <summary>The self-check's put-back, with the sim closed: each camera file's cockpit Z as it was, where it still holds Racing Desk's value.</summary>
        private void PutBackOwed()
        {
            if (_ctx.Probe.SimRunning()) return;
            var r = new RestoreResult { Action = "put-back", Ok = true };
            RestoreUndo.Heights(_ctx, r, iniToo: false);
            if (!r.Ok) { _ctx.Say(null, "height", "failed", "Each car's camera file was to be put back: " + r.Text); return; }
            RestoreSwitches now;
            lock (_gate)
            {
                _switches.HeightPutBackOwed = false;
                now = _switches.Copy();
            }
            Save(now);
            _ctx.Say(null, "height", "done", "Each car's camera file was put back as it was before Racing Desk. " + r.Text);
        }

        /// <summary>
        /// A run's view, as the recorder saw it once the sim had gone (both of its names, and app.ini written): what he changed in
        /// the car is folded into its camera file and app.ini goes back to S. A put-back the self-check owes is made instead.
        /// </summary>
        public void ViewRunEnded(ViewRun run)
        {
            if (run?.View == null || string.IsNullOrWhiteSpace(run.CarPath)) return;
            Queue(() =>
            {
                var switches = Switches;
                if (switches.HeightPutBackOwed) { PutBackOwed(); return; }
                if (!switches.Height) return;
                MoveRemembered(run.CarPath.Trim());
                Fold(run);
            });
        }

        /// <summary>
        /// One run's fold, with the sim closed. The height he left the car with is app.ini's: what is above S goes into the car's
        /// camera file (new cockpit Z = its Z + app.ini − S) and app.ini goes back to S, both backed up first and read back after,
        /// app.ini first with the pair's intent kept in the store (a stop between the two puts app.ini back at the next start).
        /// A run that did not start at S and in which he changed nothing (a leftover) keeps nothing and puts app.ini back to S
        /// (the critique's H2). A car without a camera file Racing Desk can write keeps its height in the store only; one whose Z
        /// would go beyond ±5 cm keeps nothing; both say so.
        /// </summary>
        internal void Fold(ViewRun run)
        {
            double? end = run.View.DriverHeight;
            if (end == null) return;
            string car = run.CarPath.Trim();
            double s = _ctx.StartHeight;
            double? start = run.Before?.DriverHeight;
            bool atS = start.HasValue && Math.Abs(start.Value - s) < RestorePolicy.SmallestChange;
            bool changed = start.HasValue ? Math.Abs(end.Value - start.Value) >= RestorePolicy.SmallestChange : Math.Abs(end.Value - s) >= RestorePolicy.SmallestChange;
            bool endAtS = Math.Abs(end.Value - s) < RestorePolicy.SmallestChange;
            string name;
            CarViewKeep keep;
            using (var store = _ctx.OpenStore())
            {
                name = RestorePlanner.NameOf(store, car);
                keep = store.CarViewKeepOf(car);
            }
            if (endAtS) return;                         // app.ini holds S: nothing to keep, nothing to put back
            if (!changed)
            {
                if (atS) return;
                var back = _ctx.Files.Apply(new ViewChange { IniHeight = s, ExpectIniHeight = end, Why = "app.ini back to S: a leftover height he did not change" });
                if (back.Ok) _ctx.Log($"restore: {car} — app.ini held {Words.Cm(end.Value)} from before, unchanged in this car; put back to {Words.Cm(s)}");
                else _ctx.Say(car, "height", "failed", $"app.ini couldn't be put back to {Words.Cm(s)}: {back.Why}.");
                return;
            }

            var cam = _ctx.Files.Cam(car);
            if (cam == null || !cam.Exists || !cam.Writable)
            {
                var back = _ctx.Files.Apply(new ViewChange { IniHeight = s, ExpectIniHeight = end, Why = "app.ini back to S: the car's height is kept in the store only" });
                string only = cam?.Exists == true ? "its camera file isn't one Racing Desk can write" : "it has no camera file";
                _ctx.Say(car, "height", back.Ok ? "done" : "failed", $"The {name}'s seat height, {Words.Cm(end.Value)}, is kept here only: {only}."
                    + (back.Ok ? "" : $" app.ini couldn't be put back to {Words.Cm(s)}: {back.Why}."));
                return;
            }
            double z = cam.Z ?? 0;
            double newZ = Math.Round(z + end.Value - s, 4);
            if (Math.Abs(newZ) > RestorePolicy.MaxCockpitZ + 1e-9)
            {
                var back = _ctx.Files.Apply(new ViewChange { IniHeight = s, ExpectIniHeight = end, Why = "app.ini back to S: the car's height is beyond the limit" });
                _ctx.Say(car, "height", "refused", $"The {name}'s seat height wasn't kept: it would need {Words.Cm(newZ)} in its camera file, beyond the ±{Words.Cm(RestorePolicy.MaxCockpitZ).TrimStart('+')} Racing Desk keeps to."
                    + (back.Ok ? "" : $" app.ini couldn't be put back to {Words.Cm(s)}: {back.Why}."));
                return;
            }

            // His own Z: what the file held before Racing Desk first wrote it, unless he has saved the file since (then it is his).
            bool stillRacingDesks = keep?.WrittenZ != null && string.Equals(keep.CamFile, cam.RelativePath, StringComparison.OrdinalIgnoreCase) && ViewFiles.HoldsFloat(cam.Z, keep.WrittenZ.Value);
            double own = stillRacingDesks ? keep.OwnZ ?? z : z;
            var result = _ctx.Files.Apply(new ViewChange
            {
                CarPath = car, CamFile = cam.RelativePath, CockpitZ = newZ, ExpectCockpitZ = cam.Z, IniHeight = s, ExpectIniHeight = end,
                Why = "the seat height he left the car with, into its camera file",
            });
            if (!result.Ok) { _ctx.Say(car, "height", "failed", $"The {name}'s seat height wasn't kept: {result.Why}."); return; }
            KeepWritten(car, cam, own, newZ, result.CamSha);
            _ctx.Say(car, "height", "done", $"The {name}'s seat height, {Words.Cm(end.Value)}, was kept in its camera file for next time.");
        }

        private void KeepWritten(string car, CamFileState cam, double own, double newZ, string sha)
        {
            using var store = _ctx.OpenStore();
            var keep = store.CarViewKeepOf(car) ?? new CarViewKeep { CarPath = car };
            keep.CamFile = cam.RelativePath;
            keep.OwnZ = own;
            keep.AddedZ = Math.Round(newZ - own, 6);
            keep.WrittenZ = newZ;
            keep.WrittenSha = sha;
            keep.WrittenAtUtc = _ctx.Now();
            keep.OriginalBackup = keep.OriginalBackup ?? _ctx.Files.Original(cam.RelativePath);
            keep.PendingD = null;
            keep.PendingAtUtc = null;
            keep.SeenAtUtc = _ctx.Now();
            store.SaveCarViewKeep(keep);
        }

        /// <summary>
        /// Once, with the sim closed: the heights he chose in cars before this build (the store's car_views) go into their camera
        /// files the same way a fold does — cockpit Z + the height he chose − S — and app.ini to S if it does not hold it. A car
        /// beyond ±5 cm, without a camera file, or with one Racing Desk cannot write keeps its height in the store. <paramref name="except"/>
        /// is the car a run has just ended in: its own fold follows, from what that run left.
        /// </summary>
        private void MoveRemembered(string except)
        {
            ViewBaseline b;
            List<ViewPlan> moves;
            using (var store = _ctx.OpenStore())
            {
                if (!store.HasRestoreTables) return;
                b = store.ViewBaselineRow();
                if (b?.MigratedAtUtc != null) return;
                if (_ctx.Probe.SimRunning()) return;
                var keeps = store.CarViewKeeps().ToDictionary(k => k.CarPath, StringComparer.OrdinalIgnoreCase);
                moves = store.CarViewsList()
                    .Where(v => except == null || !string.Equals(v.CarPath, except, StringComparison.OrdinalIgnoreCase))
                    .Select(v => RestorePlanner.PlanView(v, RestorePlanner.NameOf(store, v.CarPath), _ctx.Files, _ctx.StartHeight, keeps.TryGetValue(v.CarPath, out var k) ? k : null))
                    .Where(p => p.State == "to-move")
                    .ToList();
            }
            int moved = 0;
            var failed = new List<string>();
            foreach (var p in moves)
            {
                var cam = _ctx.Files.CamAt(p.CamFile, p.FromLastCarSet);
                var result = _ctx.Files.Apply(new ViewChange { CarPath = p.Car, CamFile = p.CamFile, CockpitZ = p.NewZ, ExpectCockpitZ = p.FileZ, Why = "the seat height he chose before, into its camera file" });
                if (!result.Ok) { failed.Add($"{p.Name} ({result.Why})"); continue; }
                KeepWritten(p.Car, cam, p.FileZ ?? 0, p.NewZ.Value, result.CamSha);
                moved++;
            }
            double? ini = _ctx.Files.AppIniHeight();
            if (ini.HasValue && Math.Abs(ini.Value - _ctx.StartHeight) >= RestorePolicy.SmallestChange && except == null)
            {
                var back = _ctx.Files.Apply(new ViewChange { IniHeight = _ctx.StartHeight, ExpectIniHeight = ini, Why = "app.ini to S, with the heights in the camera files" });
                if (!back.Ok) failed.Add("app.ini (" + back.Why + ")");
            }
            if (failed.Count > 0 && moved == 0 && moves.Count > 0)
            {
                // Nothing went: tried again at the next chance rather than marked done.
                _ctx.Say(null, "height", "failed", "The seat heights you chose before couldn't go into the cars' camera files: " + string.Join("; ", failed) + ".");
                return;
            }
            using (var store = _ctx.OpenStore()) store.NoteHeightsMoved(_ctx.Now());
            if (moved > 0 || failed.Count > 0)
                _ctx.Say(null, "height", failed.Count == 0 ? "done" : "failed", $"The seat heights you chose before went into {moved} car{(moved == 1 ? "'s camera file" : "s' camera files")}"
                    + (failed.Count > 0 ? "; not into " + string.Join("; ", failed) : "") + ".");
        }

        // ── For the desk ──

        /// <summary>What is kept for each car, made at most every <see cref="PlanKeptFor"/>; on the asker's thread.</summary>
        public RestorePlan Plan(bool fresh = false)
        {
            lock (_gate)
                if (!fresh && _plan != null && _ctx.Now() - _planAt < PlanKeptFor) return _plan;
            RestorePlan plan;
            using (var store = _ctx.OpenStore())
                plan = RestorePlanner.Plan(store, _ctx.Files, _ctx.ReadSmartControl(), _ctx.StartHeight, _ctx.Now());
            lock (_gate)
            {
                _plan = plan;
                _planAt = _ctx.Now();
            }
            return plan;
        }

        /// <summary>How each part stands, in a sentence each, for Settings → Cars. Cheap: the store, and a look at which programs run.</summary>
        public (RestoreStatus Brakes, RestoreStatus Height) Status()
        {
            var switches = Switches;
            SmartControlSwitch sw;
            CarViewKeep lastKept;
            ViewBaseline b;
            string brakesCar = null, heightCar = null;
            using (var store = _ctx.OpenStore())
            {
                sw = store.HasRestoreTables ? store.SmartControlSwitchRow() : null;
                lastKept = store.HasRestoreTables ? store.CarViewKeeps().Where(k => k.WrittenAtUtc.HasValue).OrderByDescending(k => k.WrittenAtUtc).FirstOrDefault() : null;
                b = store.HasRestoreTables ? store.ViewBaselineRow() : null;
                if (sw?.WrittenFor != null) brakesCar = RestorePlanner.NameOf(store, sw.WrittenFor);
                if (lastKept != null) heightCar = RestorePlanner.NameOf(store, lastKept.CarPath);
            }

            RestoreStatus brakes;
            if (!switches.Brakes)
                brakes = switches.BrakesOffWhy != null ? RestoreStatus.Of("stopped", "Turned itself off: " + switches.BrakesOffWhy + ".") : RestoreStatus.Of("off", "Off.");
            else if (sw?.BindingId == null)
            {
                brakes = RestoreStatus.Of("waiting", _brakesWaiting ?? "Getting ready: Racing Desk adds its own SmartControl profile and its F24 key.");
                if (_ctx.Now() - _setupTriedAt >= SetupTryAgainAfter) { _setupTriedAt = _ctx.Now(); Queue(Setup); }
            }
            else
            {
                string live = LiveWaits(sw);
                if (live != null) brakes = RestoreStatus.Of("waiting", live);
                else if (_brakesWaiting != null) brakes = RestoreStatus.Of("waiting", _brakesWaiting);
                else if (sw.PedalsAtUtc.HasValue && brakesCar != null) brakes = RestoreStatus.Of("working", $"Working: the last brakes it put on were the {brakesCar}'s.");
                else brakes = RestoreStatus.Of("working", "Working: a car's brakes go on when you get in and stop with the brake released.");
            }

            RestoreStatus height;
            if (!switches.Height)
                height = switches.HeightOffWhy != null
                    ? RestoreStatus.Of("stopped", "Turned itself off: " + switches.HeightOffWhy + (switches.HeightPutBackOwed ? "; each car's camera file is put back when iRacing closes." : "; each car's camera file was put back."))
                    : RestoreStatus.Of("off", "Off.");
            else if (b?.MigratedAtUtc == null)
                height = RestoreStatus.Of("waiting", "Waiting for iRacing to close, to put the seat heights you chose before into the cars' camera files.");
            else if (heightCar != null)
                height = RestoreStatus.Of("working", $"Working: the last seat height it kept was the {heightCar}'s.");
            else
                height = RestoreStatus.Of("working", "Working: the seat height you leave a car with is kept for it when iRacing closes.");
            return (brakes, height);
        }

        /// <summary>Whether Racing Desk has changed anything that undo would put back.</summary>
        public bool AnythingToUndo()
        {
            using var store = _ctx.OpenStore();
            if (!store.HasRestoreTables) return false;
            var b = store.ViewBaselineRow();
            return store.SmartControlSwitchRow() != null || store.CarSmartControls().Count > 0 || store.CarViewKeeps().Count > 0
                   || b?.IniOriginal != null || b?.VanishYOriginal != null;
        }

        /// <summary>
        /// Runs one command, and only one at a time, on the director's own worker (after what the live loop has queued): a second
        /// that comes while one runs is told Racing Desk is busy at once, and is not queued.
        /// </summary>
        private RestoreResult Exclusive(string action, Func<RestoreResult> run)
        {
            if (!Monitor.TryEnter(_commandGate))
                return new RestoreResult { Action = action, Refused = true, Busy = true, Why = "Racing Desk is busy with another command: wait for it to finish, then try again" };
            try
            {
                RestoreResult result = null;
                string stopped = null;
                var done = Queue(() =>
                {
                    try { result = run(); }
                    catch (Exception ex) { stopped = ex.Message.Trim(); throw; }
                });
                if (!done.Wait(TimeSpan.FromSeconds(25)))
                    return new RestoreResult { Action = action, Why = "it is taking a while, and may still finish: look again in a moment" };
                lock (_gate) _plan = null;
                return result ?? new RestoreResult { Action = action, Why = "it stopped: " + (stopped ?? "see host.log") };
            }
            finally
            {
                Monitor.Exit(_commandGate);
            }
        }

        /// <summary>The switches as Settings → Cars has them; each left as it is where null. Kept in restore.json.</summary>
        public RestoreResult SetSwitches(bool? brakes, bool? height) => Exclusive("switches", () =>
        {
            RestoreSwitches was, now;
            lock (_gate)
            {
                was = _switches.Copy();
                if (brakes.HasValue && brakes.Value != _switches.Brakes)
                {
                    _switches.Brakes = brakes.Value;
                    _switches.BrakesOffWhy = null;
                    _switches.BrakesOffAtUtc = null;
                }
                if (height.HasValue && height.Value != _switches.Height)
                {
                    _switches.Height = height.Value;
                    _switches.HeightOffWhy = null;
                    _switches.HeightOffAtUtc = null;
                    if (height.Value)
                    {
                        // On again: what the camera files hold stays, and the self-check starts afresh from Racing Desk's next write.
                        _switches.HeightOnSinceUtc = _ctx.Now();
                        _switches.HeightPutBackOwed = false;
                    }
                }
                now = _switches.Copy();
            }
            if (was.Brakes != now.Brakes || was.Height != now.Height || was.BrakesOffWhy != now.BrakesOffWhy || was.HeightOffWhy != now.HeightOffWhy)
            {
                Save(now);
                _ctx.Say(null, "setup", "done", $"Switches: brakes {(now.Brakes ? "on" : "off")}, seat height {(now.Height ? "on" : "off")}.");
            }
            if (now.Brakes && !was.Brakes) { _brakesWaiting = null; Setup(); }
            if (now.Height && !was.Height) MoveRemembered(null);
            return new RestoreResult { Action = "switches", Ok = true };
        });

        /// <summary>
        /// "Undo what Racing Desk changed": both parts off first, so that nothing is made again, then SmartControl's rows and the
        /// view files put back (<see cref="RestoreUndo.Everything"/>).
        /// </summary>
        public RestoreResult UndoEverything() => Exclusive("undo", () =>
        {
            RestoreSwitches now;
            lock (_gate)
            {
                _switches.Brakes = false;
                _switches.Height = false;
                _switches.BrakesOffWhy = _switches.HeightOffWhy = null;
                _switches.BrakesOffAtUtc = _switches.HeightOffAtUtc = null;
                _switches.HeightPutBackOwed = false;
                now = _switches.Copy();
                if (_run != null) _run.Done = true;
            }
            Save(now);
            _brakesWaiting = null;
            return RestoreUndo.Everything(_ctx);
        });
    }
}
