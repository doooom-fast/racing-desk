using System;
using System.Collections.Generic;
using System.Globalization;

namespace RacingDesk.Core.Cars
{
    /// <summary>
    /// A check on the list, and not a detector: where what the car publishes disagrees with what the list says of
    /// it, that is said — once per car for each thing — so the list gets corrected. Nothing found here changes
    /// what the HUD shows: that is the list's, right or wrong, until somebody puts the list right.
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
        private readonly HashSet<string> _said = new HashSet<string>(StringComparer.Ordinal);
        private readonly List<string> _remarks = new List<string>();
        private int _frames, _handed;
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

        /// <summary>What has been said of this car, in the order it was said.</summary>
        public IReadOnlyList<string> Remarks
        {
            get { lock (_remarks) return _remarks.ToArray(); }
        }

        /// <summary>
        /// One frame. Returns what has been said and not yet been handed over, for the log; mostly nothing.
        /// </summary>
        /// <param name="variable">A telemetry variable by name; null for one the car does not publish.</param>
        /// <param name="inCar">The driver is in the car. Null from a source that does not say: taken as in.</param>
        public IReadOnlyList<string> See(Func<string, object> variable, bool? inCar)
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
            Consistent(CarControls.AbsId, _car.Abs, "ABS");
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
                Say("abs:dial", "the list says no ABS and the car publishes dcABS; in some cars that is another dial under ABS's name");
            if (_car.Tc == CarEntry.None && unlisted.Contains("dcTractionControl"))
                Say("tc:dial", "the list says no traction control and the car publishes dcTractionControl");
        }

        private void Working(Func<string, object> variable)
        {
            if (_car.Abs != CarEntry.None || _said.Contains("abs:working")) return;
            double? working = CarControls.Number(variable(AbsWorking));
            if (working.HasValue && working.Value > 0.5) Say("abs:working", "the list says no ABS and the ABS has been seen working");
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

        private void Say(string about, string remark)
        {
            if (!_said.Add(about)) return;
            lock (_remarks) _remarks.Add(_carPath + " " + remark);
        }

        // What has been said and not yet handed over for the log.
        private IReadOnlyList<string> Pending()
        {
            lock (_remarks)
            {
                if (_remarks.Count <= _handed) return Array.Empty<string>();
                var fresh = _remarks.GetRange(_handed, _remarks.Count - _handed);
                _handed = _remarks.Count;
                return fresh;
            }
        }
    }
}
