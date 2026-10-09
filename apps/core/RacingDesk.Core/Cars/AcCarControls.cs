using System;
using System.Globalization;
using RacingDesk.Plugin.Engine;

namespace RacingDesk.Core.Cars
{
    /// <summary>
    /// The HUD's three cells — anti-lock, traction, bias — in Assetto Corsa and Assetto Corsa EVO, through SimHub's raw data,
    /// until there is a car list for either game (the plan's step 5). What each cell says is only what the shared memory says
    /// (asked for on 2026-10-09; "never made up"):
    /// <list type="bullet">
    /// <item><b>Bias</b>: the physics page's brake bias, 0..1, shown as a percentage to one place. Nought is unread: a car that
    /// has no bias to show, or a frame with nothing in it.</item>
    /// <item><b>Anti-lock and traction in Assetto Corsa</b>: the physics page has no level — only <c>abs</c> and <c>tc</c>, "in
    /// action", 0..1 while the aid is working. So the cell is On once the aid has been seen working in this car this run (the
    /// car has it, and it is on), and a dash before that; the glow the datastream already gives the cell says when it works.
    /// A level he cycles with the A and T keys is not in the memory, so it is never shown, and Off is never said: no
    /// intervention is a car with the aid off, a car without it, or a lap with no hard braking yet.</item>
    /// <item><b>In EVO</b>: the graphics page's <c>electronics</c> block carries <c>abs_level</c> and <c>tc_level</c> where SimHub
    /// decodes it. A level above nought is the value; a level of nought is Off only once the car is known to have the aid
    /// (a level above nought, or the aid seen working, earlier in this run) — a level of nought on a car with no such dial
    /// is not Off. Without the level, as in Assetto Corsa.</item>
    /// </list>
    /// The property names SimHub gives these fields were read from its reader's assembly and not yet seen live: each is
    /// asked for under the spellings it may have, and the parity run on the rig will settle them.
    /// </summary>
    public sealed class AcCarControls
    {
        public enum Game { AssettoCorsa, AssettoCorsaEvo }

        private const string Raw = "DataCorePlugin.GameRawData.";

        // Assetto Corsa's physics page (Content Manager's AcSharedPhysics: BrakeBias, Abs, TC) under the spellings SimHub may give them.
        internal static readonly string[] BrakeBiasPaths = { "Physics.BrakeBias", "Physics.brakeBias", "Physics.brake_bias" };
        internal static readonly string[] AbsActionPaths = { "Physics.Abs", "Physics.abs", "Physics.ABS" };
        internal static readonly string[] TcActionPaths = { "Physics.TC", "Physics.tc", "Physics.Tc" };

        // EVO's electronics block (SMEvoElectronics: abs_level, tc_level) and its "in action" flags.
        internal static readonly string[] EvoAbsLevelPaths = { "Graphics.electronics.abs_level", "Graphics.Electronics.abs_level", "Graphics.electronics.AbsLevel", "Graphics.Electronics.AbsLevel" };
        internal static readonly string[] EvoTcLevelPaths = { "Graphics.electronics.tc_level", "Graphics.Electronics.tc_level", "Graphics.electronics.TcLevel", "Graphics.Electronics.TcLevel" };
        internal static readonly string[] EvoAbsActivePaths = { "Graphics.abs_active", "Graphics.AbsActive", "Physics.absInAction", "Physics.absinAction", "Physics.abs_in_action" };
        internal static readonly string[] EvoTcActivePaths = { "Graphics.tc_active", "Graphics.TcActive", "Physics.tcInAction", "Physics.tcinAction", "Physics.tc_in_action" };

        private string _car;
        private Game? _game;
        private bool _absKnown, _tcKnown;

        /// <summary>The car is known to have anti-lock: the aid was seen working, or a level above nought was read, in this car this run.</summary>
        public bool HasAbs => _absKnown;

        /// <summary>The car is known to have traction control, by the same two signs.</summary>
        public bool HasTc => _tcKnown;

        /// <summary>EVO's anti-lock level as last read (0 is off); null in Assetto Corsa, and where SimHub does not give it.</summary>
        public double? AbsLevel { get; private set; }

        /// <summary>EVO's traction level as last read; null as above.</summary>
        public double? TcLevel { get; private set; }

        /// <summary>
        /// The three cells for this frame, or null where there is no car to speak of (no model: the menus). The memory of
        /// what the car has is per car and per game, and is let go when either changes.
        /// </summary>
        public CarControlsState See(ITelemetrySource pm, Game game, string carModel)
        {
            if (pm == null) throw new ArgumentNullException(nameof(pm));
            if (string.IsNullOrWhiteSpace(carModel))
            {
                Reset(null, null);
                return null;
            }
            if (!string.Equals(_car, carModel, StringComparison.Ordinal) || _game != game) Reset(carModel, game);

            var state = new CarControlsState { CarPath = carModel, Name = carModel, Kind = "" };
            state.BrakeBias = Bias(pm);
            if (game == Game.AssettoCorsaEvo)
            {
                state.Abs = Evo(pm, CarControls.AbsId, "ABS", "Anti-lock", EvoAbsLevelPaths, EvoAbsActivePaths, AbsActionPaths, ref _absKnown, out double? absLevel);
                state.Tc = Evo(pm, CarControls.TcId, "TC", "Traction", EvoTcLevelPaths, EvoTcActivePaths, TcActionPaths, ref _tcKnown, out double? tcLevel);
                AbsLevel = absLevel;
                TcLevel = tcLevel;
            }
            else
            {
                state.Abs = InAction(pm, CarControls.AbsId, "ABS", "Anti-lock", AbsActionPaths, ref _absKnown);
                state.Tc = InAction(pm, CarControls.TcId, "TC", "Traction", TcActionPaths, ref _tcKnown);
                AbsLevel = null;
                TcLevel = null;
            }
            return state;
        }

        private void Reset(string car, Game? game)
        {
            _car = car;
            _game = game;
            _absKnown = false;
            _tcKnown = false;
            AbsLevel = null;
            TcLevel = null;
        }

        private static ControlReading Bias(ITelemetrySource pm)
        {
            var r = new ControlReading { Id = CarControls.BrakeBiasId, Label = "BB", Words = "Bias", State = ControlReading.Unread };
            double? bias = Number(pm, BrakeBiasPaths, out string path);
            r.Var = path;
            if (!bias.HasValue || bias.Value <= 0 || bias.Value > 100) return r;
            // 0..1 in the shared memory; a source that already says a percentage is taken as one.
            double percent = bias.Value <= 1.0 ? bias.Value * 100.0 : bias.Value;
            r.State = ControlReading.Value;
            r.Number = Math.Round(percent, 1);
            return r;
        }

        // Assetto Corsa: the aid "in action". Seen once, the car has it and it is on.
        private static ControlReading InAction(ITelemetrySource pm, string id, string label, string words, string[] actionPaths, ref bool known)
        {
            var r = new ControlReading { Id = id, Label = label, Words = words, State = ControlReading.Unread };
            double? acting = Number(pm, actionPaths, out string path);
            r.Var = path;
            if (acting.HasValue && acting.Value > 0) known = true;
            if (known)
            {
                r.State = ControlReading.On;
                r.Text = CarControls.OnText;
            }
            return r;
        }

        // EVO: the level where SimHub gives it; the Assetto Corsa rule where it does not.
        private static ControlReading Evo(ITelemetrySource pm, string id, string label, string words, string[] levelPaths, string[] activePaths, string[] actionPaths, ref bool known, out double? level)
        {
            level = Number(pm, levelPaths, out string levelPath);
            bool acting = IsOn(pm, activePaths) || IsOn(pm, actionPaths);
            if (acting || (level.HasValue && level.Value > 0)) known = true;
            if (!level.HasValue) return InAction(pm, id, label, words, actionPaths, ref known);

            var r = new ControlReading { Id = id, Label = label, Words = words, Var = levelPath };
            if (level.Value > 0)
            {
                r.State = ControlReading.Value;
                r.Number = Math.Round(level.Value);
            }
            else if (known)
            {
                r.State = ControlReading.Off;
                r.Number = 0;
                r.Text = CarControls.OffText;
            }
            else
            {
                r.State = ControlReading.Unread;
            }
            return r;
        }

        private static bool IsOn(ITelemetrySource pm, string[] paths)
        {
            double? n = Number(pm, paths, out _);
            return n.HasValue && n.Value > 0;
        }

        /// <summary>
        /// The first of <paramref name="paths"/> the source holds a number under (a float, an int, a bool, an enum or text that
        /// is a number), and which path it was; null where none is there or none is a number.
        /// </summary>
        internal static double? Number(ITelemetrySource pm, string[] paths, out string path)
        {
            foreach (string p in paths)
            {
                object raw;
                try { raw = pm.GetPropertyValue(Raw + p); }
                catch { continue; }
                if (raw == null) continue;
                double? n = AsNumber(raw);
                if (n.HasValue)
                {
                    path = p;
                    return n;
                }
            }
            path = null;
            return null;
        }

        internal static double? AsNumber(object raw)
        {
            if (raw == null) return null;
            if (raw is bool b) return b ? 1 : 0;
            if (raw is string text)
            {
                if (double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out double parsed) && !double.IsNaN(parsed) && !double.IsInfinity(parsed)) return parsed;
                if (bool.TryParse(text, out bool flag)) return flag ? 1 : 0;
                return null;
            }
            if (raw is IConvertible c)
            {
                try
                {
                    double d = c.ToDouble(CultureInfo.InvariantCulture);
                    return double.IsNaN(d) || double.IsInfinity(d) ? (double?)null : d;
                }
                catch (FormatException) { return null; }
                catch (InvalidCastException) { return null; }
                catch (OverflowException) { return null; }
            }
            return null;
        }
    }
}
