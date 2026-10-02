using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace RacingDesk.Core.Cars
{
    /// <summary>What a telemetry source can say of the car the driver is in, beside its variables.</summary>
    public interface ICarIdentity
    {
        /// <summary>The sim's folder for the car; null until it is known.</summary>
        string CarPath { get; }

        /// <summary>The session runs a fixed setup. Null where the sim has not said.</summary>
        bool? FixedSetup { get; }
    }

    /// <summary>What one control reads at this moment, for the HUD.</summary>
    public sealed class ControlReading
    {
        /// <summary>The car has none.</summary>
        public const string None = "none";
        /// <summary>The car has it and the driver cannot turn it: it is on.</summary>
        public const string On = "on";
        /// <summary>The car has it and it is off.</summary>
        public const string Off = "off";
        /// <summary>It reads a value: a number, or the name of a position.</summary>
        public const string Value = "value";
        /// <summary>The car has it, inside a mode that stands for it: the mode is what there is to show.</summary>
        public const string Mode = "mode";
        /// <summary>
        /// The car has it, by the list, and the sim is not saying what it reads: the list gives no variable, or
        /// one the car is not publishing, or a frame of garbage. The HUD shows its label and a dash, never a number.
        /// </summary>
        public const string Unread = "unread";

        public string Id { get; set; }
        public string Label { get; set; }
        public string State { get; set; }
        public double? Number { get; set; }
        public string Text { get; set; }

        /// <summary>
        /// Where the value stands in the control's range for the car, 0 to 1 (<see cref="CarControls.FillOf"/>); null
        /// where the list gives no range, or names positions that are not a scale.
        /// </summary>
        public double? Fill { get; set; }

        /// <summary>The session's fixed setup holds it where it is.</summary>
        public bool Locked { get; set; }

        public string Var { get; set; }

        /// <summary>For a control inside a mode: the mode's label.</summary>
        public string By { get; set; }

        /// <summary>Push-to-pass: seconds left, where there is a limit.</summary>
        public int? Count { get; set; }

        /// <summary>Push-to-pass and DRS: it is doing its work at this moment.</summary>
        public bool? Active { get; set; }
    }

    /// <summary>The controls of the car the driver is in, each as the list has it and as it reads now.</summary>
    public sealed class CarControlsState
    {
        public string CarPath { get; set; }
        public string Name { get; set; }
        public string Kind { get; set; }
        public bool? FixedSetup { get; set; }

        /// <summary>Null where there is nothing true to say: the list does not say, or the value cannot be read.</summary>
        public ControlReading Abs { get; set; }
        public ControlReading Tc { get; set; }
        public ControlReading BrakeBias { get; set; }

        /// <summary>
        /// The car's other controls, every one the list gives it, in the list's order; one the car is not
        /// publishing reads <see cref="ControlReading.Unread"/>, so the HUD can show it with a dash.
        /// </summary>
        public List<ControlReading> More { get; } = new List<ControlReading>();

        public ControlReading Drs { get; set; }
        public ControlReading PushToPass { get; set; }

        /// <summary>As the HUD is sent it: the value of <c>RacingDesk.Plugin.CarControls</c>.</summary>
        public string ToJson()
        {
            var sb = new StringBuilder(512);
            sb.Append('{');
            bool first = true;
            Text(sb, ref first, "car", CarPath);
            Text(sb, ref first, "name", Name);
            Text(sb, ref first, "kind", Kind);
            if (FixedSetup.HasValue) Raw(sb, ref first, "fixedSetup", FixedSetup.Value ? "true" : "false");
            Reading(sb, ref first, "abs", Abs);
            Reading(sb, ref first, "tc", Tc);
            Reading(sb, ref first, "bb", BrakeBias);
            if (More.Count > 0)
            {
                Name_(sb, ref first, "more");
                sb.Append('[');
                for (int i = 0; i < More.Count; i++)
                {
                    if (i > 0) sb.Append(',');
                    Write(sb, More[i]);
                }
                sb.Append(']');
            }
            Reading(sb, ref first, "drs", Drs);
            Reading(sb, ref first, "p2p", PushToPass);
            sb.Append('}');
            return sb.ToString();
        }

        private static void Reading(StringBuilder sb, ref bool first, string name, ControlReading reading)
        {
            if (reading == null) return;
            Name_(sb, ref first, name);
            Write(sb, reading);
        }

        private static void Write(StringBuilder sb, ControlReading r)
        {
            sb.Append('{');
            bool first = true;
            Text(sb, ref first, "id", r.Id);
            Text(sb, ref first, "label", r.Label);
            Text(sb, ref first, "state", r.State);
            if (r.Number.HasValue) Raw(sb, ref first, "value", Num(r.Number.Value));
            Text(sb, ref first, "text", r.Text);
            if (r.Fill.HasValue) Raw(sb, ref first, "fill", Num(Math.Round(r.Fill.Value, 3)));
            if (r.Locked) Raw(sb, ref first, "locked", "true");
            Text(sb, ref first, "var", r.Var);
            Text(sb, ref first, "by", r.By);
            if (r.Count.HasValue) Raw(sb, ref first, "count", r.Count.Value.ToString(CultureInfo.InvariantCulture));
            if (r.Active.HasValue) Raw(sb, ref first, "active", r.Active.Value ? "true" : "false");
            sb.Append('}');
        }

        private static string Num(double value) => value.ToString("0.####", CultureInfo.InvariantCulture);

        private static void Name_(StringBuilder sb, ref bool first, string name)
        {
            if (!first) sb.Append(',');
            first = false;
            sb.Append('"').Append(name).Append("\":");
        }

        private static void Raw(StringBuilder sb, ref bool first, string name, string json)
        {
            Name_(sb, ref first, name);
            sb.Append(json);
        }

        private static void Text(StringBuilder sb, ref bool first, string name, string value)
        {
            if (value == null) return;
            Name_(sb, ref first, name);
            sb.Append('"');
            foreach (char c in value)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }
    }

    /// <summary>
    /// Reads the controls of a car: what it has is the list's to say, and the telemetry is asked only for the
    /// value each has now and whether the session's setup is fixed. Nothing here finds out what a car has.
    /// </summary>
    public static class CarControls
    {
        public const string AbsId = "abs", TcId = "tc", BrakeBiasId = "brakeBias", ModeId = "mode", DrsId = "drs", PushToPassId = "p2p";

        /// <summary>The sim's own variables for the two systems a car reports and does not set.</summary>
        public const string DrsStatus = "DRS_Status", PushToPassStatus = "P2P_Status", PushToPassCount = "P2P_Count";

        /// <summary>A count at or above this is the sim's way of saying there is no limit (practice).</summary>
        public const int NoLimit = 999;

        /// <summary>No dial holds a number beyond this; one that does is a frame of garbage.</summary>
        private const double Sane = 100000;

        /// <summary>
        /// Whether a fixed setup holds a control where it is. The sim does not say which it locks; on this rig
        /// the ABS and the traction control were never once moved under a fixed setup and the rest were
        /// (docs/car-controls-findings.md, §10). The list may say otherwise for a control.
        /// </summary>
        public static bool LockedByAFixedSetup(CarControl control)
        {
            if (control == null) return false;
            if (control.LockedWhenFixed.HasValue) return control.LockedWhenFixed.Value;
            return LockedByAFixedSetup(control.Id);
        }

        public static bool LockedByAFixedSetup(string id) =>
            id != null && (id.Equals(AbsId, StringComparison.OrdinalIgnoreCase) || id.StartsWith(TcId, StringComparison.OrdinalIgnoreCase) && IsTc(id));

        private static bool IsTc(string id)
        {
            // tc, tc2, tc3, tc4 — and not, say, "tcMode".
            for (int i = 2; i < id.Length; i++)
                if (!char.IsDigit(id[i])) return false;
            return true;
        }

        /// <summary>
        /// A variable's value as a number; null for one the car does not publish, and for what no dial could hold.
        /// </summary>
        public static double? Number(object value)
        {
            double number;
            switch (value)
            {
                case null: return null;
                case bool b: return b ? 1 : 0;
                case float f: number = f; break;
                case double d: number = d; break;
                case int i: number = i; break;
                case string s:
                    if (string.Equals(s, "true", StringComparison.OrdinalIgnoreCase)) return 1;
                    if (string.Equals(s, "false", StringComparison.OrdinalIgnoreCase)) return 0;
                    if (!double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out number)) return null;
                    break;
                case IConvertible c:
                    try { number = c.ToDouble(CultureInfo.InvariantCulture); }
                    catch (Exception) { return null; }
                    break;
                default: return null;
            }
            if (double.IsNaN(number) || double.IsInfinity(number) || Math.Abs(number) > Sane) return null;
            return number;
        }

        /// <param name="car">The car's entry in the list.</param>
        /// <param name="variable">A telemetry variable by the sim's name for it; null for one the car does not publish.</param>
        /// <param name="fixedSetup">Whether the session's setup is fixed; null where the sim has not said.</param>
        public static CarControlsState Read(CarEntry car, Func<string, object> variable, bool? fixedSetup)
        {
            if (car == null) throw new ArgumentNullException(nameof(car));
            if (variable == null) throw new ArgumentNullException(nameof(variable));

            var state = new CarControlsState { CarPath = car.Path, Name = car.Name, Kind = car.Kind, FixedSetup = fixedSetup };
            bool locked = fixedSetup == true;

            state.Abs = Primary(car, AbsId, car.Abs, "ABS", variable, locked);
            state.Tc = Primary(car, TcId, car.Tc, "TC", variable, locked);
            state.BrakeBias = Primary(car, BrakeBiasId, car.BrakeBias, "BB", variable, locked);

            foreach (var control in car.Controls)
            {
                if (Is(control, AbsId) || Is(control, TcId) || Is(control, BrakeBiasId)) continue;
                if (Is(control, DrsId))
                {
                    if (state.Drs == null) state.Drs = Drs(control, variable);
                    continue;
                }
                if (Is(control, PushToPassId))
                {
                    if (state.PushToPass == null) state.PushToPass = PushToPass(control, variable);
                    continue;
                }
                // Every control the list gives the car, read or not: one the car is not publishing goes out as
                // unread, and the HUD shows its label with a dash (he asked for a panel for every adjustment).
                state.More.Add(Dial(control, control.Label ?? control.Id, variable, locked));
            }
            return state;
        }

        private static bool Is(CarControl control, string id) => string.Equals(control.Id, id, StringComparison.OrdinalIgnoreCase);

        // One of the three every car is asked about. What the car has is the list's word — none, fixed,
        // adjustable — and where the list gives the car a control of that name, that control is read.
        private static ControlReading Primary(CarEntry car, string id, string having, string label, Func<string, object> variable, bool locked)
        {
            if (having == CarEntry.None) return new ControlReading { Id = id, Label = label, State = ControlReading.None, Text = "NONE" };

            var control = car.Control(id);
            if (control != null)
            {
                var reading = Dial(control, control.Label ?? label, variable, locked);
                if (reading.State != ControlReading.Unread) return reading;
                // Listed with no variable, or with one the car is not publishing: it cannot be read. What is
                // still true is that the car has it, and whether the driver can turn it: ON where he cannot,
                // and where he can, its label and a dash.
                return having == CarEntry.Fixed ? On(id, control.Label ?? label) : reading;
            }

            if (having == null) return null;
            var mode = ModeFor(car, id);
            if (mode != null) return new ControlReading { Id = id, Label = label, State = ControlReading.Mode, By = mode.Label ?? mode.Id };
            return having == CarEntry.Fixed ? On(id, label) : null;
        }

        private static ControlReading On(string id, string label) =>
            new ControlReading { Id = id, Label = label, State = ControlReading.On, Text = "ON" };

        /// <summary>The mode that stands for one of the three, where the car has one and no control of that name.</summary>
        internal static CarControl ModeFor(CarEntry car, string id)
        {
            foreach (var control in car.Controls)
            {
                if (!Is(control, ModeId)) continue;
                if (control.Covers == null) return control;
                foreach (string covered in control.Covers)
                    if (string.Equals(covered, id, StringComparison.OrdinalIgnoreCase)) return control;
            }
            return null;
        }

        /// <summary>
        /// A dial as it reads now. Never null: a control the list gives no variable for, one the car is not
        /// publishing, or a frame of garbage reads <see cref="ControlReading.Unread"/> — the car has it, and
        /// nothing true can be said of its value.
        /// </summary>
        private static ControlReading Dial(CarControl control, string label, Func<string, object> variable, bool fixedSetup)
        {
            double? read = string.IsNullOrEmpty(control.Var) ? null : Number(variable(control.Var));
            if (!read.HasValue) return new ControlReading { Id = control.Id, Label = label, State = ControlReading.Unread, Var = control.Var };
            double value = read.Value;

            var reading = new ControlReading
            {
                Id = control.Id, Label = label, Var = control.Var, Number = value,
                Locked = fixedSetup && LockedByAFixedSetup(control),
                Fill = FillOf(control, value),
            };

            string named = control.PositionAt(value);
            if (named != null)
            {
                bool off = string.Equals(named, "off", StringComparison.OrdinalIgnoreCase);
                reading.State = off ? ControlReading.Off : ControlReading.Value;
                reading.Text = off ? "OFF" : named;
                return reading;
            }

            if (IsOff(control, value))
            {
                reading.State = ControlReading.Off;
                reading.Text = "OFF";
                return reading;
            }
            reading.State = ControlReading.Value;
            reading.Text = Show(control, value);
            return reading;
        }

        /// <summary>
        /// Where a value stands in its control's range for the car, 0 to 1: the HUD's bar, which follows the value as
        /// he turns the dial. Null where there is nothing true to fill: the list gives the control no range (none is
        /// made up), or its positions are names of modes (TRACK / SPORT / NORMAL, OFF / MDM / ON), whose numbers are
        /// not quantities, whatever range the list gives. Positions that are a scale (25%, 50%, 75%:
        /// <see cref="CarControl.PositionsAreAScale"/>) fill by the position's place among them, and a value between
        /// them by the range. Otherwise the list's range, lowest to highest, a value outside it held at the end.
        /// </summary>
        public static double? FillOf(CarControl control, double value)
        {
            if (control == null) return null;
            if (control.Positions.Count > 0)
            {
                if (!control.PositionsAreAScale) return null;
                for (int i = 0; i < control.Positions.Count; i++)
                    if (Math.Abs(control.Positions[i].Key - value) < 0.0005) return (double)i / (control.Positions.Count - 1);
            }
            if (control.Min.HasValue && control.Max.HasValue && control.Max.Value > control.Min.Value)
                return Math.Max(0, Math.Min(1, (value - control.Min.Value) / (control.Max.Value - control.Min.Value)));
            return null;
        }

        // Off is what the list says is off. Where it says nothing, nought is off for the ABS and the traction
        // control — the driver's rule — and for nothing else.
        private static bool IsOff(CarControl control, double value)
        {
            if (control.NeverOff) return false;
            if (control.Off.HasValue) return Math.Abs(control.Off.Value - value) < 0.0005;
            return LockedByAFixedSetup(control.Id) && Math.Abs(value) < 0.0005;
        }

        internal static string Show(CarControl control, double value)
        {
            if (control.Decimals.HasValue) return value.ToString("F" + control.Decimals.Value, CultureInfo.InvariantCulture);
            if (Is(control, BrakeBiasId)) return value.ToString("F1", CultureInfo.InvariantCulture);
            return Math.Round(value, 2).ToString("0.##", CultureInfo.InvariantCulture);
        }

        // 0 nothing, 1 detected — it will be there in the zone ahead, 2 in the zone and it may be opened, 3 open.
        private static ControlReading Drs(CarControl control, Func<string, object> variable)
        {
            string name = string.IsNullOrEmpty(control.Var) ? DrsStatus : control.Var;
            double? read = Number(variable(name));
            if (!read.HasValue) return null;
            int value = (int)Math.Round(read.Value);
            var reading = new ControlReading { Id = DrsId, Label = control.Label ?? "DRS", Var = name, Number = value, Active = value == 3 };
            string named = control.PositionAt(value);
            if (value <= 0)
            {
                reading.State = ControlReading.Off;
                reading.Text = named ?? "OFF";
                return reading;
            }
            reading.State = ControlReading.Value;
            reading.Text = named ?? (value == 1 ? "NEXT" : value == 2 ? "READY" : value == 3 ? "OPEN" : value.ToString(CultureInfo.InvariantCulture));
            return reading;
        }

        private static ControlReading PushToPass(CarControl control, Func<string, object> variable)
        {
            string name = string.IsNullOrEmpty(control.Var) ? PushToPassStatus : control.Var;
            double? status = Number(variable(name));
            if (!status.HasValue) return null;
            bool active = Math.Abs(status.Value) > 0.0005;
            double? count = Number(variable(PushToPassCount));
            var reading = new ControlReading
            {
                Id = PushToPassId, Label = control.Label ?? "P2P", Var = name, Number = active ? 1 : 0, Active = active,
                State = active ? ControlReading.Value : ControlReading.Off,
            };
            if (count.HasValue && count.Value >= 0 && count.Value < NoLimit) reading.Count = (int)Math.Round(count.Value);
            reading.Text = active ? "ON" : reading.Count.HasValue ? reading.Count.Value.ToString(CultureInfo.InvariantCulture) : "OFF";
            return reading;
        }
    }
}
