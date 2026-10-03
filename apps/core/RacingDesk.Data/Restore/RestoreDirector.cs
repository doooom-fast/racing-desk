using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using RacingDesk.Data.Pedals;

namespace RacingDesk.Data.Restore
{
    /// <summary>
    /// Putting back each car's driver height and brakes (docs/view-and-pedals-plan.md), in the host. In this build the loop
    /// is in <b>trial</b>, whatever the switches and the first run's marks say (<see cref="RestorePolicy.ActingBuilt"/>): at car
    /// load, when he is parked, when the sim has gone and when the host starts it works out what it would do and says it — on
    /// the desk, in host.log, and on the HUD at his first moment in the car — and writes and presses nothing. What does write
    /// is the first-run panel's buttons (<see cref="FirstRun"/>) and undo (<see cref="RestoreUndo"/>), each on his click.
    ///
    /// <see cref="See"/> is called on every telemetry frame and keeps to cheap decisions under a short lock; anything that
    /// touches a file, the store or SmartControl's database is queued for the director's own worker, one thing at a time, in
    /// order, and what it throws is logged and goes no further.
    /// </summary>
    public sealed class RestoreDirector
    {
        private readonly RestoreContext _ctx;
        private readonly string _switchesFile;
        private readonly object _gate = new object();
        private readonly object _commandGate = new object();      // one command at a time: held by RunStep and every undo
        private readonly ParkedRule _parked = new ParkedRule();
        private RestoreSwitches _switches;
        private Task _work = Task.CompletedTask;
        private Run _run;
        private SeatFacts _last;
        private ParkedNow _parkedNow;

        // The dry run, kept for a little: the desk asks every time it shows a car, and it reads files and two databases.
        private RestorePlan _plan;
        private DateTime _planAt = DateTime.MinValue;
        public TimeSpan PlanKeptFor { get; set; } = TimeSpan.FromSeconds(15);

        private sealed class Run
        {
            public string Car, Name;
            public bool FlagsLogged, ParkedSaid;
            public ViewPlan View;
            public BrakesPlan Brakes;
        }

        /// <param name="switchesFile">restore.json, beside the host's settings; null keeps them in memory (a test's).</param>
        public RestoreDirector(RestoreContext ctx, string switchesFile)
        {
            _ctx = ctx ?? throw new ArgumentNullException(nameof(ctx));
            _switchesFile = switchesFile;
            _switches = RestoreSwitches.Load(switchesFile);
            _ctx.Switches = () => Switches;
            _ctx.LastFacts = () => { lock (_gate) return _last; };
            _ctx.Parked = () => { lock (_gate) return _parkedNow; };
            FirstRun = new FirstRun(_ctx);
        }

        public RestoreContext Context => _ctx;
        public FirstRun FirstRun { get; }

        public RestoreSwitches Switches
        {
            get { lock (_gate) return _switches.Copy(); }
        }

        /// <summary>The switches as Settings → Cars has them; each left as it is where null. Kept in restore.json.</summary>
        public RestoreSwitches SetSwitches(bool? height, bool? brakes, bool? horizon)
        {
            RestoreSwitches now;
            bool changed;
            lock (_gate)
            {
                var was = _switches.Copy();
                if (height.HasValue) _switches.Height = height.Value;
                if (brakes.HasValue) _switches.Brakes = brakes.Value;
                if (horizon.HasValue) _switches.Horizon = horizon.Value;
                now = _switches.Copy();
                changed = was.Height != now.Height || was.Brakes != now.Brakes || was.Horizon != now.Horizon;
            }
            if (changed)
            {
                now.Save(_switchesFile);
                Queue(() => _ctx.Say(null, "setup", "done",
                    $"Switches: height {(now.Height ? "on" : "off")}, brakes {(now.Brakes ? "on" : "off")}, horizon {(now.Horizon ? "on" : "off")} — in trial: saying what it would do, writing and pressing nothing."));
            }
            return now;
        }

        /// <summary>Waits for what has been queued so far (tests, and the host's stop).</summary>
        public Task Settled()
        {
            lock (_gate) return _work;
        }

        private void Queue(Action work)
        {
            lock (_gate)
            {
                _work = _work.ContinueWith(_ =>
                {
                    try { work(); }
                    catch (Exception ex) { _ctx.Log("restore: " + ex.GetType().Name + " — " + ex.Message.Trim()); }
                }, TaskScheduler.Default);
            }
        }

        // ── The host's start ──

        /// <summary>
        /// The host has started. A write of the view files that a stop cut short is put back, never finished (with the sim
        /// closed), the starting height is written down, and what app.ini holds is compared with it: trial says what it would put back.
        /// </summary>
        public void HostStarted()
        {
            Queue(() =>
            {
                // A step that a stop cut short is put back, not finished (ViewFiles.Settle): what is only in the way of nothing is
                // logged; a step put back, or left, or one that could not be put back, is a line on the desk as well.
                foreach (var note in _ctx.Files.Settle())
                {
                    if (note.State == "info") _ctx.Log($"restore: {note.Car} — {note.Text}");
                    else _ctx.Say(note.Car, "settle", note.State, note.Text);
                }
                using (var store = _ctx.OpenStore())
                {
                    if (!store.HasRestoreTables) return;
                    if (store.ViewBaselineRow() == null)
                        store.SaveViewBaseline(new ViewBaseline { StartHeight = _ctx.StartHeight, DecidedAtUtc = RestorePolicy.DecidedAtUtc, DecidedBy = RestorePolicy.DecidedBy });
                }
                if (!Switches.Height || _ctx.Probe.SimRunning()) return;
                double? h = _ctx.Files.AppIniHeight();
                if (h == null) _ctx.Say(null, "height", "trial", "Trial: app.ini's height could not be read.");
                else if (Math.Abs(h.Value - _ctx.StartHeight) >= RestorePolicy.SmallestChange)
                    _ctx.Say(null, "height", "trial", $"Trial: app.ini's height is {Words.Cm(h.Value)}; would put it back to {Words.Cm(_ctx.StartHeight)}, the height every car starts at.");
            });
        }

        // ── Every frame ──

        /// <summary>The frame's facts. Cheap: a new car or a parked moment queues the work it brings, and nothing waits on it.</summary>
        public void See(SeatFacts f)
        {
            if (f == null || string.IsNullOrWhiteSpace(f.CarPath)) return;
            Run started = null, parkedRun = null;
            string flags = null, place = null, car;
            lock (_gate)
            {
                _last = f;
                if (_run == null || !string.Equals(_run.Car, f.CarPath.Trim(), StringComparison.OrdinalIgnoreCase))
                {
                    _run = new Run { Car = f.CarPath.Trim(), Name = string.IsNullOrWhiteSpace(f.CarName) ? f.CarPath.Trim() : f.CarName.Trim() };
                    _parked.Reset();
                    _parkedNow = null;
                    started = _run;
                }
                car = _run.Car;
                if (!_run.FlagsLogged && !f.IsOnTrack)
                {
                    _run.FlagsLogged = true;
                    flags = f.Flags();
                }
                // Asked of every frame, so that the second he has been still is counted from the frames themselves, and the newest
                // answer is what a key is checked against right before it goes (a click's frame is seconds old by then).
                bool parked = _parked.Parked(f, out place, out string whyNot);
                _parkedNow = new ParkedNow { Parked = parked, Place = place, Why = whyNot, FactsAtUtc = f.AtUtc };
                if (!_run.ParkedSaid && parked)
                {
                    _run.ParkedSaid = true;
                    parkedRun = _run;
                }
            }
            if (started != null) Queue(() => CarLoaded(started));
            // Which flags the garage screen really raises is the first run's to settle (B2): written down once a run.
            if (flags != null) Queue(() => _ctx.Log($"restore: {car} — out of the car, the sim says {flags}"));
            if (parkedRun != null) { string at = place; Queue(() => Parked(parkedRun, at)); }
        }

        /// <summary>
        /// The sim has stopped sending: the next car, or the same car again, is a run of its own. The last frame goes with it, so
        /// that nothing acts on a previous session's frame (B2's flags and its switch go by the frame, and a stale one is a lie).
        /// </summary>
        public void SimGone()
        {
            lock (_gate)
            {
                _run = null;
                _last = null;
                _parkedNow = null;
                _parked.Reset();
            }
        }

        private void CarLoaded(Run run)
        {
            var switches = Switches;
            if (!switches.Brakes && !switches.Height) return;
            using var store = _ctx.OpenStore();
            if (!store.HasRestoreTables) return;
            string name = store.Cars().FirstOrDefault(c => string.Equals(c.CarPath, run.Car, StringComparison.OrdinalIgnoreCase))?.Name ?? run.Name;
            run.Name = name;

            if (switches.Brakes)
            {
                var bound = store.CarPedalsOf(run.Car);
                var snapshot = _ctx.ReadSmartControl();
                if (bound == null)
                {
                    var facts = store.CarPedalFactsOf(run.Car);
                    _ctx.Say(run.Car, "brakes", "trial", facts?.GivenBy == "none"
                        ? "Trial: you chose that this car has no profile of its own; the brakes would be left as they are."
                        : "Trial: no base profile for this car yet (the rule gives it one at the end of its first run); the brakes would be left as they are.");
                }
                else
                {
                    var plan = RestorePlanner.PlanBrakes(bound, store.CarPedalFactsOf(run.Car), store.CarSmartControlOf(run.Car), name, snapshot,
                        snapshot?.Profiles.Select(p => p.Name) ?? Enumerable.Empty<string>());
                    run.Brakes = plan;
                    if (plan.State == "would-make" || plan.State == "made")
                    {
                        string make = plan.State == "would-make" ? $"would make its own SmartControl profile '{plan.ProfileName}' from {plan.BaseName} at {plan.Kg} kg, " : "";
                        _ctx.Say(run.Car, "brakes", "trial",
                            $"Trial: {make}would copy it into the Racing Desk profile now, and press F24 once you are parked with the brake released: brakes {plan.Kg} kg.");
                        _ctx.Say(run.Car, "brakes", "trial", $"Trial: brakes {name} · {plan.Kg} kg", hud: true);
                    }
                    else _ctx.Say(run.Car, "brakes", "trial", plan.Words);
                }
            }

            if (switches.Height)
            {
                var view = store.CarViewOf(run.Car);
                var keep = store.CarViewKeepOf(run.Car);
                var cam = _ctx.Files.Cam(run.Car);
                if (cam == null || !cam.Exists)
                {
                    _ctx.Say(run.Car, "height", "trial", $"Trial: {name} has no camera file, so iRacing cannot put its height back: it would start at {Words.Cm(_ctx.StartHeight)}. Save one once: {RestorePolicy.SaveACameraFile}.");
                    _ctx.Say(run.Car, "height", "trial", $"Trial: no camera file for the {name} yet", hud: true);
                }
                else
                {
                    var plan = view == null ? null : RestorePlanner.PlanView(view, name, _ctx.Files, _ctx.StartHeight, keep);
                    run.View = plan;
                    // The Z the plan would give is used only where the plan would move it there or finds it there already: a height
                    // the plan refuses ("beyond", say) is not the height he would start at.
                    double? plannedZ = plan != null && (plan.State == "would-move" || plan.State == "already") ? plan.NewZ : null;
                    double z = keep?.WrittenZ ?? plannedZ ?? cam.Z ?? 0;
                    double eff = _ctx.StartHeight + z;
                    _ctx.Say(run.Car, "height", "trial",
                        $"Trial: with app.ini at {Words.Cm(_ctx.StartHeight)} and its camera file's cockpit Z at {Words.Cm(z)}, {name} would start at {Words.Cm(eff)}"
                        + (cam.FromLastCarSet ? " (the file camera.ini's LastCarSet names)." : "."));
                    _ctx.Say(run.Car, "height", "trial", $"Trial: height {name} · {Words.Cm(eff)} (its camera file)", hud: true);
                }
            }
        }

        private void Parked(Run run, string place)
        {
            if (!Switches.Brakes) return;
            var plan = run.Brakes;
            if (plan == null || (plan.State != "would-make" && plan.State != "made")) return;
            var reasons = new List<string>();
            if (!_ctx.Probe.LiveRunning()) reasons.Add("SmartControl Live isn't running — the pedals are as they were");
            if (_ctx.Probe.PedalsConnected() == false) reasons.Add("the pedals aren't connected");
            if (_ctx.PressesThisRun() > 0) reasons.Add("you set the force with your own keys in this car, and your key wins");
            bool? elevated = _ctx.Probe.ForegroundElevated();
            if (elevated != false) reasons.Add("the window in front may be elevated, and Windows would drop the key");
            _ctx.Say(run.Car, "brakes", "trial", reasons.Count == 0
                ? $"Trial: parked ({place}, still for a second, brake released): would press F24 now — brakes to {run.Name} · {plan.Kg} kg."
                : $"Trial: parked ({place}), and would not switch the brakes: {string.Join("; ", reasons)}.");
        }

        // ── When the sim has gone ──

        /// <summary>
        /// A run's view, as the recorder saw it once the sim had gone: trial says what it would keep in the car's camera file
        /// and what it would put app.ini back to (the critique's H2 rule for a run that did not start at S).
        /// </summary>
        public void ViewRunEnded(ViewRun run)
        {
            if (run?.View == null || string.IsNullOrWhiteSpace(run.CarPath)) return;
            Queue(() =>
            {
                if (!Switches.Height) return;
                string text = FoldWords(run, _ctx.Files.Cam(run.CarPath), _ctx.StartHeight, Switches.Horizon);
                if (text != null) _ctx.Say(run.CarPath, "height", "trial", text);
            });
        }

        /// <summary>The fold of one run, in words, as trial says it; null when there is nothing to say.</summary>
        public static string FoldWords(ViewRun run, CamFileState cam, double s, bool horizon)
        {
            double? start = run.Before?.DriverHeight, end = run.View.DriverHeight;
            if (end == null) return null;
            bool atS = start.HasValue && Math.Abs(start.Value - s) < RestorePolicy.SmallestChange;
            bool changed = start.HasValue && Math.Abs(end.Value - start.Value) >= RestorePolicy.SmallestChange;
            string back = $"app.ini back to {Words.Cm(s)}";
            string horizonWords = horizon && run.Before?.VanishY != null && run.View.VanishY != null && Math.Abs(run.View.VanishY.Value - run.Before.VanishY.Value) > 1e-6
                ? $" Horizon: would keep {run.View.VanishY.Value - run.Before.VanishY.Value:+0.00;-0.00} in its cockpit's vertical shift, once the first run shows the two add."
                : "";
            if (cam == null || !cam.Exists)
                return atS && !changed && Math.Abs(end.Value - s) < RestorePolicy.SmallestChange ? null
                    : $"Trial: you left it at {Words.Cm(end.Value)}; it has no camera file, so that is kept here only; would put {back}." + horizonWords;
            if (!cam.Writable) return $"Trial: its camera file is not one Racing Desk writes ({cam.Why}); would put {back}." + horizonWords;
            double z = cam.Z ?? 0;
            if (atS)
            {
                double d = end.Value - start.Value;
                if (Math.Abs(d) < RestorePolicy.SmallestChange) return horizonWords.Length > 0 ? "Trial: the height did not change." + horizonWords : null;
                double nz = Math.Round(z + d, 4);
                return Math.Abs(nz) > RestorePolicy.MaxCockpitZ + 1e-9
                    ? $"Trial: you changed the height by {Words.Cm(d)}, which would take its cockpit Z to {Words.Cm(nz)}, beyond ±{Words.Cm(RestorePolicy.MaxCockpitZ)}: nothing would be kept; would put {back}." + horizonWords
                    : $"Trial: would keep {Words.Cm(d)} in its camera file (cockpit Z {Words.Cm(z)} → {Words.Cm(nz)}); {back}." + horizonWords;
            }
            // The run did not start at S: something else wrote app.ini (critique H2). What he last saw is kept if he changed it.
            string from = start.HasValue ? $"app.ini held {Words.Cm(start.Value)} at the start, not {Words.Cm(s)}" : "app.ini could not be read at the start";
            if (changed)
            {
                double nz = Math.Round(end.Value + z - s, 4);
                return Math.Abs(nz) > RestorePolicy.MaxCockpitZ + 1e-9
                    ? $"Trial: {from}; what you last saw, {Words.Cm(end.Value + z)}, would need a cockpit Z of {Words.Cm(nz)}, beyond the limit: nothing would be kept; {back}." + horizonWords
                    : $"Trial: {from}; you changed it, so would keep what you last saw: cockpit Z {Words.Cm(z)} → {Words.Cm(nz)}; {back}." + horizonWords;
            }
            return $"Trial: {from}, a leftover you did not change: nothing would be kept; would put {back}." + horizonWords;
        }

        /// <summary>
        /// What a run left of the pedals: a force his keys set becomes, in trial, the force that would be written into the car's
        /// own profile at exit — or wait, if the SmartControl editor is open, for it to be closed.
        /// </summary>
        public void PedalsLeft(PedalsSeen seen)
        {
            if (seen == null || string.IsNullOrWhiteSpace(seen.CarPath)) return;
            Queue(() =>
            {
                if (!Switches.Brakes || seen.Presses <= 0) return;
                int? kg = RestorePlanner.Usable(seen.ForceKg);
                if (kg == null)
                {
                    _ctx.Say(seen.CarPath, "brakes", "trial", "Trial: the force your keys left is not known (a step key from an unknown force, or one held), so nothing would be written into its profile.");
                    return;
                }
                // The force is the car's all the same (the store keeps it); whether there is a profile of its own to write it into
                // depends on the car: one he chose to have none for, one with no base yet, and one he deleted have no such profile.
                string why = null;
                using (var store = _ctx.OpenStore())
                {
                    var facts = store.CarPedalFactsOf(seen.CarPath);
                    var mine = store.CarSmartControlOf(seen.CarPath);
                    if (facts?.GivenBy == "none") why = "you chose that this car has no profile of its own";
                    else if (mine?.State == "gone") why = "its profile was deleted in SmartControl, and it has none until you ask for one again";
                    else if (mine == null && store.CarPedalsOf(seen.CarPath) == null) why = "it has no base profile yet, so none could be made for it";
                }
                if (why != null)
                {
                    _ctx.Say(seen.CarPath, "brakes", "trial", $"Trial: {why}, so the {kg} kg your keys left is kept as its force and nothing would be written into SmartControl.");
                    return;
                }
                bool editor = _ctx.Probe.EditorRunning();
                _ctx.Say(seen.CarPath, "brakes", "trial", editor
                    ? $"Trial: would write {kg} kg into its own profile once the SmartControl editor is closed (it would save its own copy over it); the next switch uses {kg} kg anyway."
                    : $"Trial: would write {kg} kg, the force your keys left, into its own SmartControl profile.");
            });
        }

        // ── For the desk ──

        /// <summary>The dry run, made at most every <see cref="PlanKeptFor"/>; on the asker's thread.</summary>
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

        /// <summary>The car being driven now, and where the parked rule has him.</summary>
        public (string Car, string Name, string Place, string Flags)? Now()
        {
            lock (_gate)
            {
                if (_run == null || _last == null) return null;
                string place = ParkedRule.Place(_last, out string why) ?? "not parked: " + why;
                return (_run.Car, _run.Name, place, _last.Flags());
            }
        }

        /// <summary>
        /// Runs one command, and only one at a time: a first-run button or an undo. A second that comes while one is running — a
        /// double click, a retry after the app's own 30 seconds, the Cars page's undo beside a step — is told Racing Desk is busy
        /// at once, and is not queued: two A2s at once would both insert a "Racing Desk" profile, and one would be a row nobody
        /// could take away. The dry run is made again after it.
        /// </summary>
        private StepResult Exclusive(string action, Func<StepResult> run)
        {
            if (!Monitor.TryEnter(_commandGate))
                return new StepResult { Action = action, Refused = true, Busy = true, Why = "Racing Desk is busy with another command: wait for it to finish, then try again" };
            try
            {
                var result = run();
                lock (_gate) _plan = null;
                return result;
            }
            finally
            {
                Monitor.Exit(_commandGate);
            }
        }

        /// <summary>Runs one of the first run's buttons, on his click.</summary>
        public StepResult RunStep(string actionId) => Exclusive(actionId, () => FirstRun.Run(actionId));

        public bool Mark(string step, string mark)
        {
            if (RestoreGate.Step(step) == null) return false;
            using var store = _ctx.OpenStore();
            bool ok = store.MarkCheck(RestoreGate.Step(step).Id, mark, _ctx.Now());
            if (ok) _ctx.Log($"restore: first run {step} marked {mark ?? "not said"}");
            return ok;
        }

        public StepResult UndoBrakes() => Exclusive("undo-brakes", () => RestoreUndo.Brakes(_ctx));

        public StepResult UndoHeights(string car = null) => Exclusive(car == null ? "undo-heights" : "undo-height", () => RestoreUndo.Heights(_ctx, car));

        /// <summary>Removes A7's "RD test 65" row on its own, leaving the Racing Desk profile and F24.</summary>
        public StepResult UndoTestRow() => Exclusive("undo-test", () => RestoreUndo.TestRow(_ctx));
    }
}
