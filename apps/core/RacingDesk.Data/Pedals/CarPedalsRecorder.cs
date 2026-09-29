using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Linq;
using System.Threading.Tasks;
using RacingDesk.Core.Cars;

namespace RacingDesk.Data.Pedals
{
    /// <summary>What one run in one car left to be kept about its pedals.</summary>
    public sealed class PedalsSeen
    {
        public string CarPath { get; set; }

        /// <summary>The brake force the run ended on; null when it is not known.</summary>
        public double? ForceKg { get; set; }

        /// <summary>What raising and lowering added up to while the force was not known.</summary>
        public double ChangeKg { get; set; }

        /// <summary>How many of Live's brake-force keys were pressed in this car.</summary>
        public int Presses { get; set; }

        /// <summary>The car published an ABS setting, or its ABS was seen working, in this run.</summary>
        public bool AbsSeen { get; set; }

        /// <summary>Laps driven in the run.</summary>
        public int Laps { get; set; }

        /// <summary>
        /// The car published what a prototype has and a GT or touring car does not: a hybrid system, brake
        /// migration, a front anti-roll bar set from the seat.
        /// </summary>
        public bool Prototype { get; set; }

        public DateTime SeenAtUtc { get; set; }
    }

    /// <summary>
    /// Follows the pedals per car while the sim runs, and writes nothing of SmartControl's. The brake force is
    /// followed from SmartControl Live's own keys (<see cref="LiveKeyWatcher"/>); whether the car has ABS is
    /// read off the telemetry. What a run leaves is handed over when the car changes or the sim goes.
    /// </summary>
    public sealed class CarPedalsRecorder
    {
        /// <summary>SmartControl Live, by the name of its process.</summary>
        public const string LiveProcess = "SmartControl Live";

        /// <summary>
        /// A break in the telemetry shorter than this is the same run: the sim stuttered, or changed session. The
        /// force known before it is known after it.
        /// </summary>
        internal TimeSpan SameRun = TimeSpan.FromSeconds(60);

        /// <summary>How long after SmartControl could not be read it is asked again.</summary>
        internal TimeSpan ReadAgainAfter = TimeSpan.FromSeconds(15);

        private readonly Func<SmartControlSnapshot> _smartControl;
        private readonly Func<IEnumerable<LiveKey>, LiveKeyWatcher> _watch;
        private readonly Func<bool> _liveRunning;
        private readonly Func<DateTime> _now;
        private readonly Action<PedalsSeen> _save;
        private readonly Action<string> _log;
        private readonly object _gate = new object();

        private string _carPath;
        private LiveKeyWatcher _keys;
        private Task<SmartControlSnapshot> _reading;
        private DateTime _readAgain = DateTime.MinValue;
        private BrakeForceTracker _force;
        private bool _absSetting, _absWorked, _prototype;
        private int _lapsAt = -1, _laps;
        private bool _saidLiveIsNotRunning;

        // What the run before left, and when, in case this one is the same run after a break.
        private double? _leftKg;
        private DateTime _leftAt = DateTime.MinValue;

        /// <param name="smartControl">Reads SmartControl's database (<see cref="SmartControl.Read"/>); null from it means no SmartControl.</param>
        public CarPedalsRecorder(Func<SmartControlSnapshot> smartControl, Action<PedalsSeen> save, Action<string> log = null)
            : this(smartControl, keys => new LiveKeyWatcher(keys), LiveIsRunning, () => DateTime.UtcNow, save, log) { }

        internal CarPedalsRecorder(Func<SmartControlSnapshot> smartControl, Func<IEnumerable<LiveKey>, LiveKeyWatcher> watch,
            Func<bool> liveRunning, Func<DateTime> now, Action<PedalsSeen> save, Action<string> log = null)
        {
            _smartControl = smartControl ?? throw new ArgumentNullException(nameof(smartControl));
            _watch = watch ?? throw new ArgumentNullException(nameof(watch));
            _liveRunning = liveRunning ?? throw new ArgumentNullException(nameof(liveRunning));
            _now = now ?? throw new ArgumentNullException(nameof(now));
            _save = save ?? throw new ArgumentNullException(nameof(save));
            _log = log ?? (_ => { });
        }

        /// <summary>The keys being asked about, for saying so. Empty when none are.</summary>
        public IReadOnlyList<int> Watched
        {
            get { lock (_gate) return _keys?.Watched ?? Array.Empty<int>(); }
        }

        /// <summary>
        /// The car the driver's is, on every frame. <paramref name="absSetting"/>: the car publishes an ABS
        /// setting; <paramref name="absWorking"/>: the ABS is working at this moment; <paramref name="driving"/>:
        /// he is in the car, and not watching it from the garage or in a replay — laps and ABS count only then;
        /// <paramref name="prototype"/>: the car publishes what only a prototype has.
        /// The keys count wherever he is: they reach the pedals all the same. Never throws, and never waits on a
        /// file: it is called on the thread the telemetry arrives on.
        /// </summary>
        public void See(string carPath, bool absSetting, bool absWorking, int lapsCompleted, bool driving = true, bool prototype = false)
        {
            if (string.IsNullOrWhiteSpace(carPath)) return;
            carPath = carPath.Trim();
            PedalsSeen left = null;
            try
            {
                lock (_gate)
                {
                    if (!string.Equals(carPath, _carPath, StringComparison.OrdinalIgnoreCase))
                    {
                        left = Leave();
                        Enter(carPath);
                    }
                    _absSetting |= absSetting;
                    _prototype |= prototype;
                    if (driving)
                    {
                        _absWorked |= absWorking;
                        // The count is a session's: it starts again with each, and what was driven before still was.
                        if (_lapsAt < 0 || lapsCompleted < _lapsAt) _lapsAt = lapsCompleted;
                        if (lapsCompleted > _lapsAt)
                        {
                            _laps += lapsCompleted - _lapsAt;
                            _lapsAt = lapsCompleted;
                        }
                    }
                    else
                    {
                        _lapsAt = -1;       // laps that pass while he is out of the car are not his
                    }
                    Watch();
                }
            }
            catch (Exception ex)
            {
                _log("pedals: not followed on this frame — " + ex.Message.Trim());
            }
            // Off this thread: the store is a file.
            if (left != null) Task.Run(() => Save(left));
        }

        /// <summary>
        /// The sim has stopped sending, or the host is stopping: what the run left is handed over before this
        /// returns, and the keys are let go.
        /// </summary>
        public void SimGone()
        {
            PedalsSeen left;
            lock (_gate) left = Leave();
            if (left != null) Save(left);
        }

        private void Save(PedalsSeen left)
        {
            try { _save(left); }
            catch (Exception ex) { _log("pedals: not kept — " + ex.Message.Trim()); }
        }

        private void Enter(string carPath)
        {
            _carPath = carPath;
            _absSetting = _absWorked = _prototype = false;
            _lapsAt = -1;
            _laps = 0;
            _saidLiveIsNotRunning = false;
            // The pedals keep their force from car to car and through a break in the telemetry, so what was
            // known a moment ago is known now. After longer it is not: they may have been set with the sim away.
            bool sameRun = _leftAt != DateTime.MinValue && _now() - _leftAt <= SameRun && _now() >= _leftAt;
            _force = new BrakeForceTracker(sameRun ? _leftKg : null);
            _keys = null;
            _reading = null;
            _readAgain = DateTime.MinValue;
        }

        // SmartControl's database is read on a thread of its own and its keys watched once it has been: it is
        // SmartControl's file, and may be held.
        private void Watch()
        {
            if (_keys == null)
            {
                if (_reading == null)
                {
                    if (_now() < _readAgain) return;
                    _reading = Task.Run(_smartControl);
                    return;
                }
                if (!_reading.IsCompleted) return;
                var read = _reading;
                _reading = null;
                if (read.IsFaulted || read.IsCanceled)
                {
                    _readAgain = _now() + ReadAgainAfter;
                    _log("pedals: SmartControl could not be read — " + (read.Exception?.GetBaseException().Message.Trim() ?? "cancelled"));
                    return;
                }
                if (read.Result == null)
                {
                    _readAgain = DateTime.MaxValue;
                    _log("pedals: SmartControl is not on this machine; nothing is watched");
                    return;
                }
                var keys = _watch(read.Result.Keys);
                foreach (var key in keys.NotWatched) _log("pedals: " + Describe(key) + " is not a key this watches");
                if (keys.Watched.Count == 0)
                {
                    _readAgain = DateTime.MaxValue;
                    _log("pedals: SmartControl Live has no brake-force keys; nothing is watched");
                    return;
                }
                _keys = keys;
            }

            var seen = _keys.Poll();
            if (seen.Pressed.Count == 0 && !seen.HeldToRepeat) return;

            // A key Live is not there to hear did nothing to the pedals.
            if (!_liveRunning())
            {
                if (!_saidLiveIsNotRunning) _log("pedals: SmartControl Live is not running, so its keys do nothing; not counted");
                _saidLiveIsNotRunning = true;
                return;
            }
            _saidLiveIsNotRunning = false;

            double? before = _force.ForceKg;
            foreach (var key in seen.Pressed) _force.Press(key);
            if (seen.HeldToRepeat)
            {
                _force.Doubt();
                _log("pedals: a step key was held until it repeated; the brake force is not known until a key sets one");
            }
            else if (_force.ForceKg != before || !_force.ForceKg.HasValue)
            {
                // The force, and not the key: what is kept is what was agreed to be kept.
                _log("pedals: brake force " + Show(_force));
            }
        }

        private PedalsSeen Leave()
        {
            if (_carPath == null) return null;
            var left = new PedalsSeen
            {
                CarPath = _carPath,
                ForceKg = _force.ForceKg,
                ChangeKg = _force.ChangeKg,
                Presses = _force.Presses,
                AbsSeen = _absSetting || _absWorked,
                Laps = _laps,
                Prototype = _prototype,
                SeenAtUtc = _now(),
            };
            _leftKg = _force.ForceKg;
            _leftAt = left.SeenAtUtc;
            _carPath = null;
            _keys = null;
            _reading = null;
            return left;
        }

        private static bool LiveIsRunning()
        {
            try
            {
                var found = Process.GetProcessesByName(LiveProcess);
                foreach (var p in found) p.Dispose();
                return found.Length > 0;
            }
            catch (Exception)
            {
                // Not being able to ask is not Live being away.
                return true;
            }
        }

        internal static string Describe(LiveKey key)
        {
            string keys = string.IsNullOrWhiteSpace(key.SecondKey) ? key.FirstKey : key.FirstKey + " + " + key.SecondKey;
            string kg = key.Value.ToString("0.#", CultureInfo.InvariantCulture);
            switch (key.Action)
            {
                case LiveAction.SetBrakeForce: return $"{keys} (set {kg} kg)";
                case LiveAction.RaiseBrakeForce: return $"{keys} (+{kg} kg)";
                case LiveAction.LowerBrakeForce: return $"{keys} (-{kg} kg)";
                default: return keys;
            }
        }

        private static string Show(BrakeForceTracker force) => force.ForceKg.HasValue
            ? CarPedalsKeeper.Kg(force.ForceKg.Value)
            : "not known yet, " + CarPedalsKeeper.Change(force.ChangeKg) + " from where it was";
    }

    /// <summary>
    /// A car's pedals in the store: which of SmartControl's profiles it starts from, and the force it is driven
    /// with. A car with none is given one by the driver's rule the first time enough is known about it.
    /// </summary>
    public static class CarPedalsKeeper
    {
        /// <summary>The driver's own profiles that a car's starts as a copy of.</summary>
        public const string Light = "LightBrake", Default = "Default";

        /// <summary>What the rule went by, as it is kept and shown.</summary>
        public const string WhyAbs = "ABS", WhyNoAbs = "no ABS", WhyFormula = "a formula car", WhyPrototype = "a prototype";

        // The kinds of the canonical list the rule is about.
        private const string KindFormula = "formula", KindPrototype = "prototype";

        /// <summary>
        /// "light for touring and sports cars with abs, default for formula and cars without abs", and
        /// "a proto with abs gets default".
        /// </summary>
        public static string BaseFor(bool hasAbs, bool formula, bool prototype = false) =>
            hasAbs && !formula && !prototype ? Light : Default;

        internal static string Kg(double kg) => kg.ToString("0.#", CultureInfo.InvariantCulture) + " kg";

        internal static string Change(double kg) =>
            (kg > 0 ? "+" : kg < 0 ? "-" : "") + Math.Abs(kg).ToString("0.#", CultureInfo.InvariantCulture) + " kg";

        /// <summary>
        /// Keeps what a run left, and returns a line saying what was kept, for the log; null when there was
        /// nothing to say. The force is kept first and whatever else happens: it is the car's with or without a
        /// profile. SmartControl is read only if a profile has to be made.
        /// </summary>
        /// <param name="list">
        /// The canonical list of cars (null: the one this build carries). What it says of a car's kind and ABS is
        /// gone by, and a car it says both of is given its profile at the end of its first run; what an entry leaves
        /// out, and any car it does not have, is left to what the car showed.
        /// </param>
        public static string Keep(RacingDeskStore store, Func<SmartControlSnapshot> smartControl, PedalsSeen seen, CarList list = null)
        {
            if (store == null) throw new ArgumentNullException(nameof(store));
            if (seen == null || string.IsNullOrWhiteSpace(seen.CarPath)) return null;
            string car = seen.CarPath.Trim();

            bool set = seen.Presses > 0 && seen.ForceKg.HasValue;
            var known = store.NotePedals(car, set ? seen.ForceKg : null, seen.AbsSeen, seen.Laps, seen.SeenAtUtc);
            if (known == null) return $"pedals: {car} — this store keeps no pedals; nothing kept";

            string force = set ? $" brake force {Kg(seen.ForceKg.Value)}"
                : seen.Presses > 0 ? $" the force was changed by {Change(seen.ChangeKg)} from one that is not known, or a step key was held; " +
                                     "press a key that sets a force and it will be known"
                : "";
            string profile = Profile(store, smartControl, car, known, seen.Prototype, seen.SeenAtUtc, (list ?? CarList.Default).Find(car));

            if (profile.Length == 0 && force.Length == 0) return null;
            return $"pedals: {car} —" + profile + (profile.Length > 0 && force.Length > 0 ? ";" : "") + force;
        }

        // The car's profile: made by the rule if it has none and enough is known, and made again if what the rule
        // went by has turned out not to be so. One the driver gave, or chose not to have, is his.
        //
        // Each fact is the list's where the list gives it and the data's where it does not: an entry that leaves out
        // its ABS still says what the car is, and one that leaves out its kind still says whether it has ABS.
        //
        // The list answers for a car, at once, with no laps to wait for and whatever the car published, when what it
        // gives is enough to say the profile: both the kind and the ABS, or a formula car, or no ABS (a formula car and
        // a car without ABS start from Default whatever else is so). What the rule went by is then not so when it is
        // not what the list gives now — the list was put right in a later build, or the data gave the profile before
        // the list had the car. It is made again once, and what it went by is then what the list gives. A car the list
        // cannot answer for is gone by from what it showed, in what the list leaves out: it was given for no ABS and
        // ABS has been seen since, or for ABS and the car has shown itself a prototype. What a listed kind says is
        // gone by all the same: a profile given for a kind the list says the car is not is made again.
        //
        // Being a prototype changes what a car with ABS is given and nothing else, so it is the reason only
        // then: a car without ABS is given Default for that, whatever else it publishes. By the data it is gone by
        // only when seen — a run in which it was not seen says nothing, and takes nothing back.
        //
        // What is written is written only if the driver has not chosen since the rule looked (he may, on the desk,
        // while SmartControl's database is being read): the store decides that in the write.
        private static string Profile(RacingDeskStore store, Func<SmartControlSnapshot> smartControl, string car, CarPedalFacts known,
            bool prototypeSeen, DateTime at, CarEntry listed)
        {
            var has = store.CarPedalsOf(car);
            bool kindListed = listed?.Kind != null, absListed = listed?.Abs != null;
            bool formula = kindListed ? listed.Kind == KindFormula : store.CarRanIn(car, "Formula");
            bool prototype = kindListed ? listed.Kind == KindPrototype : prototypeSeen;
            bool? hasAbs = absListed ? listed.Abs != CarEntry.None : known.HasAbs;
            bool abs = hasAbs == true;
            prototype = prototype && abs && !formula;
            string why = formula ? WhyFormula : prototype ? WhyPrototype : abs ? WhyAbs : WhyNoAbs;

            bool byList = kindListed && absListed || kindListed && formula || absListed && !abs;
            string source = byList ? ", from the list" : kindListed || absListed ? ", from the list and what the car showed" : "";
            string says = kindListed && formula ? "the list says it is a formula car"
                : kindListed && prototype ? "the list says it is a prototype"
                : absListed ? "the list says it " + (abs ? "has ABS" : "has no ABS")
                : kindListed ? "the list says its kind is " + listed.Kind
                : null;

            // What makes the reason the rule gave no longer so, in the log line's words; null while it stands.
            string contradiction = null;
            if (has != null && known.GivenBy == "rule")
            {
                if (byList)
                    contradiction = known.GivenWhy != why ? says : null;
                else if (known.GivenWhy == WhyNoAbs && abs && !formula)
                    contradiction = absListed ? says : "its ABS has been seen working";
                else if (known.GivenWhy == WhyAbs && prototype)
                    contradiction = kindListed ? says : "it is a prototype";
                else if (kindListed && (known.GivenWhy == WhyPrototype && listed.Kind != KindPrototype || known.GivenWhy == WhyFormula && !formula))
                    contradiction = says;
            }
            bool mistaken = contradiction != null;
            if (has != null && !mistaken) return "";
            if (has == null && known.GivenBy == "none") return "";
            // A formula car starts from Default whatever its ABS, so there is nothing to wait for.
            if (!formula && hasAbs == null) return " too short a run to say whether it has ABS; no profile yet";

            string name = BaseFor(abs, formula, prototype);
            // Said where the rule acts, so once: the check in the log says the same of a car every run. What was seen is
            // an ABS setting published or the ABS working; in some cars a setting under that name is another dial.
            string against = absListed && listed.Abs == CarEntry.None && known.AbsSeen
                ? "; the car published an ABS setting or its ABS was seen working, though the list says it has none, and the rule goes by the list" : "";

            if (mistaken && string.Equals(has.ProfileName?.Trim(), name, StringComparison.OrdinalIgnoreCase))
            {
                // What it went by has changed and where it starts from has not: only the reason is put right.
                if (!store.NoteRuleReason(car, why, has.BoundAtUtc)) return "";
                return $" {contradiction}; its profile stays from {has.ProfileName} ({why})" + against;
            }

            SmartControlSnapshot snapshot;
            try { snapshot = smartControl?.Invoke(); }
            catch (Exception ex) { return $" SmartControl could not be read ({ex.Message.Trim()}); no profile yet"; }
            var from = snapshot?.Profiles.FirstOrDefault(p => string.Equals(p.Name?.Trim(), name, StringComparison.OrdinalIgnoreCase));
            if (from == null) return $" would start from {name}, which SmartControl does not have; no profile";

            var given = new CarPedals
            {
                CarPath = car, ProfileId = from.Id, ProfileName = from.Name, Profile = from.Data, BoundAtUtc = at,
                BrakeForceKg = known.ForceKg,       // beside the profile too, where an earlier build reads it
            };
            if (mistaken)
            {
                // Given by the rule and never touched since: the rule's to give again, if it is still so.
                if (!store.RegiveCarPedalsByRule(given, has.BoundAtUtc, why, at)) return "";
                return $" {contradiction}, so its profile is from {from.Name} now, not {has.ProfileName}" + against;
            }
            // Only if it still has none: a profile given on the desk in the meantime, or his choice that it has none,
            // is the driver's, and stays.
            if (!store.GiveCarPedalsByRule(given, why, at)) return "";
            return $" its own profile, from {from.Name} ({why}{source})" + against;
        }
    }
}
