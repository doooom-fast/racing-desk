using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace RacingDesk.Data.Pedals
{
    /// <summary>What one run in one car left to be kept about its pedals.</summary>
    public sealed class PedalsSeen
    {
        public string CarPath { get; set; }

        /// <summary>The brake force the run ended on; null when no key that sets one was pressed.</summary>
        public double? ForceKg { get; set; }

        /// <summary>What raising and lowering added up to while the force was not known.</summary>
        public double ChangeKg { get; set; }

        /// <summary>How many of Live's brake-force keys were pressed in this car.</summary>
        public int Presses { get; set; }

        /// <summary>Whether the car has ABS; null when the run was too short to say it has none.</summary>
        public bool? HasAbs { get; set; }

        public DateTime SeenAtUtc { get; set; }
    }

    /// <summary>
    /// Follows the pedals per car while the sim runs, and writes nothing of SmartControl's. The brake force is
    /// followed from SmartControl Live's own keys (<see cref="LiveKeyWatcher"/>); whether the car has ABS is
    /// read off the telemetry. What a run leaves is handed over when the car changes or the sim goes.
    /// </summary>
    public sealed class CarPedalsRecorder
    {
        /// <summary>Laps without the ABS ever working, after which a car with no ABS setting is taken to have none.</summary>
        public const int LapsToSayNoAbs = 3;

        private readonly Func<SmartControlSnapshot> _smartControl;
        private readonly Func<int, short> _keyState;
        private readonly Action<PedalsSeen> _save;
        private readonly Action<string> _log;
        private readonly object _gate = new object();

        private string _carPath;
        private LiveKeyWatcher _keys;
        private BrakeForceTracker _force;
        private bool _absSetting, _absWorked;
        private int _lapsAtStart = -1, _laps;

        /// <param name="smartControl">Reads SmartControl's database (<see cref="SmartControl.Read"/>); null from it means no SmartControl.</param>
        /// <param name="keyState">Windows' GetAsyncKeyState.</param>
        public CarPedalsRecorder(Func<SmartControlSnapshot> smartControl, Func<int, short> keyState,
            Action<PedalsSeen> save, Action<string> log = null)
        {
            _smartControl = smartControl ?? throw new ArgumentNullException(nameof(smartControl));
            _keyState = keyState ?? throw new ArgumentNullException(nameof(keyState));
            _save = save ?? throw new ArgumentNullException(nameof(save));
            _log = log ?? (_ => { });
        }

        /// <summary>The keys being asked about, for saying so. Empty when none are.</summary>
        public IReadOnlyList<int> Watched
        {
            get { lock (_gate) return _keys?.Watched ?? Array.Empty<int>(); }
        }

        /// <summary>
        /// The car the driver is in, on every frame. <paramref name="absSetting"/>: the car publishes an ABS
        /// setting; <paramref name="absWorking"/>: the ABS is working at this moment.
        /// </summary>
        public void See(string carPath, bool absSetting, bool absWorking, int lapsCompleted)
        {
            if (string.IsNullOrWhiteSpace(carPath)) return;
            carPath = carPath.Trim();
            PedalsSeen left = null;
            lock (_gate)
            {
                if (!string.Equals(carPath, _carPath, StringComparison.OrdinalIgnoreCase))
                {
                    left = Leave();
                    Enter(carPath, left?.ForceKg);
                }
                _absSetting |= absSetting;
                _absWorked |= absWorking;
                if (_lapsAtStart < 0) _lapsAtStart = lapsCompleted;
                _laps = Math.Max(_laps, lapsCompleted - _lapsAtStart);

                if (_keys != null)
                {
                    foreach (var key in _keys.Poll())
                    {
                        _force.Press(key);
                        _log("pedals: " + Describe(key) + " — brake force " + Show(_force));
                    }
                }
            }
            if (left != null) _save(left);
        }

        /// <summary>The sim has stopped sending: what the run left is handed over, and the keys are let go.</summary>
        public void SimGone()
        {
            PedalsSeen left;
            lock (_gate) left = Leave();
            if (left != null) _save(left);
        }

        private void Enter(string carPath, double? knownKg)
        {
            _carPath = carPath;
            _absSetting = _absWorked = false;
            _lapsAtStart = -1;
            _laps = 0;
            // The pedals keep their force from car to car, so what was known in the last car is known in this one.
            _force = new BrakeForceTracker(knownKg);
            _keys = null;
            try
            {
                var snapshot = _smartControl();
                if (snapshot == null)
                {
                    _log("pedals: SmartControl is not on this machine; nothing is watched");
                    return;
                }
                _keys = new LiveKeyWatcher(snapshot.Keys, _keyState);
                foreach (var key in _keys.NotWatched) _log("pedals: " + Describe(key) + " is a key this does not know; not watched");
                if (_keys.Watched.Count == 0)
                {
                    _keys = null;
                    _log("pedals: SmartControl Live has no brake-force keys; nothing is watched");
                }
            }
            catch (Exception ex)
            {
                // SmartControl's database is its own, and may be anything. The car is still followed for its ABS.
                _log("pedals: SmartControl could not be read — " + ex.Message.Trim());
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
                HasAbs = _absSetting || _absWorked ? true : _laps >= LapsToSayNoAbs ? false : (bool?)null,
                SeenAtUtc = DateTime.UtcNow,
            };
            _carPath = null;
            _keys = null;
            return left;
        }

        internal static string Describe(LiveKey key)
        {
            string keys = string.IsNullOrWhiteSpace(key.SecondKey) ? key.FirstKey : key.FirstKey + " + " + key.SecondKey;
            string kg = key.Value.ToString("0.#", CultureInfo.InvariantCulture);
            switch (key.Action)
            {
                case LiveAction.SetBrakeForce: return $"{keys} (set {kg} kg)";
                case LiveAction.RaiseBrakeForce: return $"{keys} (+{kg} kg)";
                case LiveAction.LowerBrakeForce: return $"{keys} (−{kg} kg)";
                default: return keys;
            }
        }

        private static string Show(BrakeForceTracker force) => force.ForceKg.HasValue
            ? force.ForceKg.Value.ToString("0.#", CultureInfo.InvariantCulture) + " kg"
            : "not known yet, " + force.ChangeKg.ToString("+0.#;−0.#;0", CultureInfo.InvariantCulture) + " kg from where it was";
    }

    /// <summary>
    /// A car's pedals in the store: which of SmartControl's profiles it starts from, and the force it is driven
    /// with. A car with none is given one by the driver's rule the first time enough is known about it.
    /// </summary>
    public static class CarPedalsKeeper
    {
        /// <summary>The driver's own profiles that a car's starts as a copy of.</summary>
        public const string Light = "LightBrake", Default = "Default";

        /// <summary>"light for touring and sports cars with abs, default for formula and cars without abs".</summary>
        public static string BaseFor(bool hasAbs, bool formula) => hasAbs && !formula ? Light : Default;

        /// <summary>Keeps what a run left. Returns a line saying what was kept, for the log.</summary>
        public static string Keep(RacingDeskStore store, SmartControlSnapshot smartControl, PedalsSeen seen)
        {
            if (store == null) throw new ArgumentNullException(nameof(store));
            if (seen == null || string.IsNullOrWhiteSpace(seen.CarPath)) return null;
            string car = seen.CarPath.Trim();
            var has = store.CarPedalsOf(car);
            string made = "";

            if (has == null)
            {
                if (!store.HasCar(car)) return $"pedals: {car} — the store has no such car yet; nothing kept";
                if (seen.HasAbs == null) return $"pedals: {car} — too short a run to say whether it has ABS; no profile yet";
                bool formula = store.CarRanIn(car, "Formula");
                string name = BaseFor(seen.HasAbs.Value, formula);
                var from = smartControl?.Profiles.FirstOrDefault(p => string.Equals(p.Name?.Trim(), name, StringComparison.OrdinalIgnoreCase));
                if (from == null) return $"pedals: {car} — would start from {name}, which SmartControl does not have; nothing kept";

                has = new CarPedals
                {
                    CarPath = car, ProfileId = from.Id, ProfileName = from.Name, Profile = from.Data, BoundAtUtc = seen.SeenAtUtc,
                };
                store.BindCarPedals(has);
                made = $" its own profile, from {from.Name} (" +
                       (formula ? "a formula car" : seen.HasAbs.Value ? "ABS" : "no ABS") + ");";
            }

            if (seen.Presses > 0 && seen.ForceKg.HasValue)
            {
                store.SetCarBrakeForce(car, seen.ForceKg.Value);
                return $"pedals: {car} —{made} brake force {seen.ForceKg.Value.ToString("0.#", CultureInfo.InvariantCulture)} kg";
            }
            if (seen.Presses > 0)
                return $"pedals: {car} —{made} the force was changed by " +
                       seen.ChangeKg.ToString("+0.#;−0.#;0", CultureInfo.InvariantCulture) +
                       " kg from one that is not known; press a key that sets a force and it will be";
            return made.Length > 0 ? $"pedals: {car} —{made.TrimEnd(';')}" : null;
        }
    }
}
