using System;
using System.Collections.Generic;
using System.Globalization;

namespace RacingDesk.Core.Cars
{
    /// <summary>One thing the check has said of one car.</summary>
    public sealed class CarRemark
    {
        /// <summary>The car, as the sim names its folder.</summary>
        public string CarPath { get; internal set; }

        /// <summary>
        /// Which thing was said: <c>unknown</c>, <c>list:abs</c>, <c>absent:dcABS</c>, <c>unlisted</c>, <c>abs:dial</c>,
        /// <c>tc:dial</c>, <c>abs:working</c>, <c>bias:moved</c>, <c>value:dcABS</c>… A car and this key name one
        /// remark, however often it is seen: the log has it once, and each later drive of the car that finds it still
        /// so says it again (<see cref="Again"/>) for whoever keeps when it was last seen.
        /// </summary>
        public string About { get; internal set; }

        /// <summary>What was said, without the car: <c>the list gives abs as dcABS, which the car does not publish</c>.</summary>
        public string Text { get; internal set; }

        /// <summary>The name of the list it was said against (<see cref="CarList.Hash"/>); set by the follower.</summary>
        public string ListHash { get; internal set; }

        /// <summary>When it was said; set by the follower.</summary>
        public DateTime SaidAtUtc { get; internal set; }

        /// <summary>
        /// True where this thing was said before, in an earlier drive of the car, and is said again because it is
        /// still so in this one. It is for keeping — it moves when the thing was last seen — and not for the log,
        /// which has each thing once.
        /// </summary>
        public bool Again { get; internal set; }

        /// <summary>As the log has it: the car, then what was said.</summary>
        public string Line => CarPath + " " + Text;

        public override string ToString() => Line;
    }

    /// <summary>
    /// A check on the list, and not a detector: where what the car publishes disagrees with what the list says of
    /// it, that is said — in the log once per car for each thing, and again in each later drive that finds it still
    /// so, for whoever keeps when it was last seen — so the list gets corrected. Nothing found here changes what the
    /// HUD shows: that is the list's, right or wrong, until somebody puts the list right.
    /// </summary>
    public sealed class CarListCheck
    {
        /// <summary>
        /// The sim's variables that hold an in-car adjustment. Its vocabulary and no car's: which of them a car
        /// publishes is asked of the car. Switches and buttons hold no setting and are not here.
        /// </summary>
        public static readonly IReadOnlyList<string> Dials = new[]
        {
            "dcABS", "dcTractionControl", "dcTractionControl2", "dcTractionControl3", "dcTractionControl4",
            "dcBrakeBias", "dcBrakeBiasFine", "dcPeakBrakeBias", "dcBrakeMisc",
            "dcAntiRollFront", "dcAntiRollRear",
            "dcThrottleShape", "dcBoostLevel", "dcFuelMixture", "dcEnginePower", "dcEngineBraking", "dcFuelCutPosition",
            "dcDiffEntry", "dcDiffMiddle", "dcDiffExit", "dcDiffPreload",
            "dcMGUKDeployMode", "dcMGUKDeployFixed", "dcMGUKRegenGain",
            "dcPowerSteering", "dcLaunchRPM",
            "dcWeightJackerLeft", "dcWeightJackerRight", "dcWingFront", "dcWingRear",
            CarControls.DrsStatus,
        };

        /// <summary>The ABS is cutting brake pressure at this moment. Published by every car, with ABS or without.</summary>
        public const string AbsWorking = "BrakeABSactive";

        private const string BrakeBias = "dcBrakeBias";

        /// <summary>Frames in the car before what it publishes is compared: a second at 60 a second.</summary>
        internal int Settle = 60;

        private readonly string _carPath;
        private readonly CarEntry _car;
        // What has been said in this drive of the car, so that each thing is said once in it; and what has been said
        // at all, in the order it was first said, which is what the log and this run's remarks are.
        private readonly HashSet<string> _said = new HashSet<string>(StringComparer.Ordinal);
        private readonly List<CarRemark> _remarks = new List<CarRemark>();
        // What is to be handed over: each thing the first time it is said, and again in each later drive it is still so.
        private readonly List<CarRemark> _pending = new List<CarRemark>();
        private int _frames;
        private bool _compared;
        private double? _biasAtFirst;

        /// <param name="carPath">The sim's folder for the car the driver is in.</param>
        /// <param name="car">Its entry in the list; null for a car the list does not have.</param>
        public CarListCheck(string carPath, CarEntry car)
        {
            _carPath = carPath ?? "";
            _car = car;
            if (car == null)
            {
                Say("unknown", "is not in the list: its controls are shown as they were before there was one");
                return;
            }
            Consistent();
        }

        /// <summary>What has been said of this car, in the order it was said, as the log has it.</summary>
        public IReadOnlyList<string> Remarks
        {
            get
            {
                lock (_remarks)
                {
                    var lines = new string[_remarks.Count];
                    for (int i = 0; i < lines.Length; i++) lines[i] = _remarks[i].Line;
                    return lines;
                }
            }
        }

        /// <summary>What has been said of this car, in the order it was said, with which thing each was.</summary>
        public IReadOnlyList<CarRemark> Said
        {
            get { lock (_remarks) return _remarks.ToArray(); }
        }

        /// <summary>
        /// One frame. Returns what has been said and not yet been handed over, for the log; mostly nothing. Each
        /// thing is in the log once, however many times he drives the car.
        /// </summary>
        /// <param name="variable">A telemetry variable by name; null for one the car does not publish.</param>
        /// <param name="inCar">The driver is in the car. Null from a source that does not say: taken as in.</param>
        public IReadOnlyList<string> See(Func<string, object> variable, bool? inCar)
        {
            var lines = new List<string>();
            foreach (var remark in Take(variable, inCar))
                if (!remark.Again) lines.Add(remark.Line);
            return lines.Count == 0 ? Array.Empty<string>() : lines.ToArray();
        }

        /// <summary>
        /// He is driving this car again: he got back into it after being out of it, or into it from another car, or
        /// the sim was gone and is back. What the check found is looked for afresh — the car is compared with the list
        /// again after its first second in it, and a thing seen happening is seen again or not — so that a thing
        /// still so is said again (<see cref="CarRemark.Again"/>) and one that is no longer so is not. What the list
        /// says of itself, and that the car is not in it, stands as it was and is said again at once.
        /// </summary>
        internal void BeginDrive()
        {
            _frames = 0;
            _compared = false;
            _biasAtFirst = null;
            _said.Clear();
            lock (_remarks)
                foreach (var said in _remarks)
                    if (Stands(said.About))
                    {
                        _said.Add(said.About);
                        _pending.Add(Repeat(said, said.Text));
                    }
        }

        // What is true of the list whoever is in the car: said at the moment the car is known, not by watching it.
        private static bool Stands(string about) =>
            about == "unknown" || about.StartsWith("list:", StringComparison.Ordinal);

        private static CarRemark Repeat(CarRemark said, string text) =>
            new CarRemark { CarPath = said.CarPath, About = said.About, Text = text, Again = true };

        /// <summary><see cref="See"/>, handing over what was said as remarks and not as lines of the log.</summary>
        internal IReadOnlyList<CarRemark> Take(Func<string, object> variable, bool? inCar)
        {
            if (variable != null && inCar != false)
            {
                _frames++;
                if (!_compared && _frames >= Settle)
                {
                    _compared = true;
                    if (_car != null) Published(variable);
                }
                if (_car != null && _compared)
                {
                    Working(variable);
                    Moved(variable);
                    Values(variable);
                }
            }
            return Pending();
        }

        // The list against itself: said as soon as the car is known.
        private void Consistent()
        {
            Consistent(CarControls.AbsId, _car.Abs, "anti-lock");
            Consistent(CarControls.TcId, _car.Tc, "traction control");
            Consistent(CarControls.BrakeBiasId, _car.BrakeBias, "brake bias");
        }

        private void Consistent(string id, string having, string what)
        {
            var control = _car.Control(id);
            if (having == CarEntry.None && control != null)
                Say("list:" + id, $"the list says no {what} and gives the car a control called {id}");
            else if (having == CarEntry.Adjustable && control == null && CarControls.ModeFor(_car, id) == null)
                Say("list:" + id, $"the list says the {what} can be turned and gives no control for it, nor a mode that stands for it");
            else if (having == CarEntry.Adjustable && control != null && string.IsNullOrEmpty(control.Var))
                Say("list:" + id, $"the list says the {what} can be turned and gives no variable to read it from");
        }

        // What the car publishes against what the list gives it.
        private void Published(Func<string, object> variable)
        {
            var listed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var control in _car.Controls)
            {
                string name = control.Var;
                if (string.IsNullOrEmpty(name))
                {
                    if (string.Equals(control.Id, CarControls.DrsId, StringComparison.OrdinalIgnoreCase)) name = CarControls.DrsStatus;
                    else continue;
                }
                listed.Add(name);
                if (variable(name) == null)
                    Say("absent:" + name, $"the list gives {control.Id} as {name}, which the car does not publish");
            }

            var unlisted = new List<string>();
            foreach (string name in Dials)
            {
                if (listed.Contains(name) || variable(name) == null) continue;
                // Published by cars whose bias cannot be changed from the seat, where it never moves: only a
                // bias that moves is one the list has missed (Moved).
                if (name == BrakeBias && _car.BrakeBias == CarEntry.None) continue;
                unlisted.Add(name);
            }
            if (unlisted.Count > 0)
                Say("unlisted", $"the car publishes {string.Join(", ", unlisted)}, which the list gives to no control");

            if (_car.Abs == CarEntry.None && unlisted.Contains("dcABS"))
                Say("abs:dial", "the list says no anti-lock and the car publishes dcABS; in some cars that is another dial under that name");
            if (_car.Tc == CarEntry.None && unlisted.Contains("dcTractionControl"))
                Say("tc:dial", "the list says no traction control and the car publishes dcTractionControl");
        }

        private void Working(Func<string, object> variable)
        {
            if (_car.Abs != CarEntry.None || _said.Contains("abs:working")) return;
            double? working = CarControls.Number(variable(AbsWorking));
            if (working.HasValue && working.Value > 0.5) Say("abs:working", "the list says no anti-lock and the anti-lock has been seen working");
        }

        private void Moved(Func<string, object> variable)
        {
            if (_car.BrakeBias != CarEntry.None || _said.Contains("bias:moved")) return;
            foreach (var control in _car.Controls)
                if (string.Equals(control.Var, BrakeBias, StringComparison.OrdinalIgnoreCase)) return;
            double? bias = CarControls.Number(variable(BrakeBias));
            if (!bias.HasValue) return;
            if (!_biasAtFirst.HasValue) _biasAtFirst = bias;
            else if (Math.Abs(bias.Value - _biasAtFirst.Value) > 0.01)
                Say("bias:moved", $"the list says the brake bias cannot be changed and dcBrakeBias has gone from {Show(_biasAtFirst.Value)} to {Show(bias.Value)}");
        }

        private void Values(Func<string, object> variable)
        {
            foreach (var control in _car.Controls)
            {
                if (string.IsNullOrEmpty(control.Var) || _said.Contains("value:" + control.Var)) continue;
                double? read = CarControls.Number(variable(control.Var));
                if (!read.HasValue) continue;
                double value = read.Value;
                if (control.Min.HasValue && control.Max.HasValue)
                {
                    bool off = control.Off.HasValue && Math.Abs(control.Off.Value - value) < 0.0005;
                    if (!off && control.PositionAt(value) == null && (value < control.Min.Value - 0.0005 || value > control.Max.Value + 0.0005))
                        Say("value:" + control.Var, $"{control.Var} reads {Show(value)}, outside the list's {Show(control.Min.Value)} to {Show(control.Max.Value)} for {control.Id}");
                }
                else if (control.Positions.Count > 0 && control.PositionAt(value) == null)
                {
                    bool off = control.Off.HasValue && Math.Abs(control.Off.Value - value) < 0.0005;
                    if (!off) Say("value:" + control.Var, $"{control.Var} reads {Show(value)}, a position of {control.Id} the list has no name for");
                }
            }
        }

        private static string Show(double value) => Math.Round(value, 3).ToString("0.###", CultureInfo.InvariantCulture);

        // Each thing once in a drive. The first time it is ever said it is what the log has; said again in a later
        // drive it is handed over as it was said before, to be kept as seen again.
        private void Say(string about, string remark)
        {
            if (!_said.Add(about)) return;
            lock (_remarks)
            {
                var before = _remarks.Find(r => r.About == about);
                if (before == null)
                {
                    var first = new CarRemark { CarPath = _carPath, About = about, Text = remark };
                    _remarks.Add(first);
                    _pending.Add(first);
                }
                else _pending.Add(Repeat(before, remark));
            }
        }

        // What has been said and not yet handed over.
        private IReadOnlyList<CarRemark> Pending()
        {
            lock (_remarks)
            {
                if (_pending.Count == 0) return Array.Empty<CarRemark>();
                var fresh = _pending.ToArray();
                _pending.Clear();
                return fresh;
            }
        }
    }
}
