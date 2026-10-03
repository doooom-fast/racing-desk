using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json.Linq;
using RacingDesk.Plugin;

namespace RacingDesk.Core.Cars
{
    /// <summary>One in-car adjustment or status a car has, as the canonical list gives it.</summary>
    public sealed class CarControl
    {
        /// <summary>
        /// Ours: abs, tc, tc2, brakeBias, brakeMigration, arbFront, arbRear, mode, drs, p2p and the rest. Compared
        /// case-blind; one the code has not met is carried as it is.
        /// </summary>
        public string Id { get; internal set; }

        /// <summary>The telemetry variable carrying its value; null when the car publishes none.</summary>
        public string Var { get; internal set; }

        /// <summary>What the car's own dash or black box calls it: its short label, words in sentence case and the
        /// car's own abbreviations (TCLO, BBAL) as the car shows them.</summary>
        public string Label { get; internal set; }

        /// <summary>
        /// Optional, ours: the control in words, where what it does in this car is known ("Traction slip", "Bias",
        /// "Front rollbar"). The HUD shows it where it fits and the short label where it does not; null where the list
        /// gives none, and then the label is all there is.
        /// </summary>
        public string Words { get; internal set; }

        /// <summary>The value that means off, where the list gives one.</summary>
        public double? Off { get; internal set; }

        /// <summary>The list says that no value of this control is off (<c>"off": false</c>).</summary>
        public bool NeverOff { get; internal set; }

        /// <summary>Lowest and highest value, where the list gives them.</summary>
        public double? Min { get; internal set; }
        public double? Max { get; internal set; }

        /// <summary>Names of positions, by value, for a control that is a mode and not a number. Never null.</summary>
        public IReadOnlyList<KeyValuePair<double, string>> Positions { get; internal set; } = Array.Empty<KeyValuePair<double, string>>();

        /// <summary>
        /// The positions are an ordered scale and not names of modes: two or more, each named by a number (a percent
        /// sign after it allowed: the McLaren MP4-30's 25%, 50%, 75%) or <c>off</c> at either end, the numbers rising or
        /// falling with the values. Only then does a position fill a bar, by its place among them; TRACK / SPORT /
        /// NORMAL, OFF / MDM / ON, DRY / WET name modes, and the number behind them is not a quantity.
        /// </summary>
        public bool PositionsAreAScale { get; internal set; }

        public string Note { get; internal set; }

        /// <summary>
        /// Optional, ours: whether a fixed setup locks this control. Null where the list does not say, and then
        /// <see cref="CarControls.LockedByAFixedSetup"/> goes by the control's id.
        /// </summary>
        public bool? LockedWhenFixed { get; internal set; }

        /// <summary>
        /// Optional, ours: for a mode, which of abs, tc and brakeBias it stands for. Null where the list does not
        /// say; a mode then stands for each of the three the car has and lists no control of its own for.
        /// </summary>
        public IReadOnlyList<string> Covers { get; internal set; }

        /// <summary>Optional, ours: decimal places the value is shown with. Null: one for brake bias, as few as it takes otherwise.</summary>
        public int? Decimals { get; internal set; }

        /// <summary>The name the list has for a value, or null.</summary>
        public string PositionAt(double value)
        {
            foreach (var p in Positions)
                if (Math.Abs(p.Key - value) < 0.0005) return p.Value;
            return null;
        }
    }

    /// <summary>One car of the canonical list.</summary>
    public sealed class CarEntry
    {
        public const string None = "none", Fixed = "fixed", Adjustable = "adjustable";

        /// <summary>The sim's folder for the car, e.g. "porsche963gtp", "mx5 mx52016".</summary>
        public string Path { get; internal set; }
        public string Name { get; internal set; }

        /// <summary>formula, prototype, gt, touring, stock, dirt, rally, truck or other; null where the list does not say.</summary>
        public string Kind { get; internal set; }

        /// <summary>none, fixed (it has it, the driver cannot turn it) or adjustable; null where the list does not say.</summary>
        public string Abs { get; internal set; }
        public string Tc { get; internal set; }

        /// <summary>none or adjustable; null where the list does not say.</summary>
        public string BrakeBias { get; internal set; }

        /// <summary>Every in-car adjustment and status the car has, in the order the HUD shows them. Never null.</summary>
        public IReadOnlyList<CarControl> Controls { get; internal set; } = Array.Empty<CarControl>();

        /// <summary>telemetry: compared with what the car publishes on the rig. written: from what is written about the car.</summary>
        public string Checked { get; internal set; }

        /// <summary>The first control with this id, or null.</summary>
        public CarControl Control(string id)
        {
            foreach (var c in Controls)
                if (string.Equals(c.Id, id, StringComparison.OrdinalIgnoreCase)) return c;
            return null;
        }
    }

    /// <summary>
    /// The canonical list of cars: what each has for the driver to turn and what its dash calls it. Written by
    /// hand (<c>packages/car-list/cars.json</c>) and carried inside this assembly, so the host and the SimHub
    /// plugin read the same one. A car that is not in it is simply not known: nothing is guessed.
    /// </summary>
    public sealed class CarList
    {
        /// <summary>The name the list is embedded under.</summary>
        public const string ResourceName = "RacingDesk.Core.Cars.cars.json";

        /// <summary>What <see cref="Hash"/> is for a list with nothing in it: no list in the build, or one that could not be read.</summary>
        public const string EmptyHash = "empty";

        public static readonly CarList Empty = new CarList(0, new List<CarEntry>(), new List<string>(), EmptyHash);

        private static readonly Lazy<CarList> Embedded = new Lazy<CarList>(LoadEmbedded);

        private readonly Dictionary<string, CarEntry> _byPath = new Dictionary<string, CarEntry>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, CarEntry> _byFolded = new Dictionary<string, CarEntry>(StringComparer.Ordinal);

        public int Version { get; }
        public IReadOnlyList<CarEntry> Cars { get; }

        /// <summary>
        /// A short name for the exact bytes this list was read from (twelve hex digits of their SHA-256), which
        /// changes when anybody changes the list. What the check said is kept against it, so that a remark about
        /// a list since corrected is not taken for one about the list in use. <see cref="EmptyHash"/> for a list
        /// with nothing in it.
        /// </summary>
        public string Hash { get; }

        /// <summary>What was wrong with the text the list was read from, entry by entry. Empty for a list with nothing wrong.</summary>
        public IReadOnlyList<string> Problems { get; }

        private CarList(int version, List<CarEntry> cars, List<string> problems, string hash)
        {
            Version = version;
            Cars = cars;
            Problems = problems;
            Hash = hash;
            foreach (var car in cars)
            {
                if (!_byPath.ContainsKey(car.Path)) _byPath[car.Path] = car;
                string folded = Fold(car.Path);
                if (!_byFolded.ContainsKey(folded)) _byFolded[folded] = car;
            }
        }

        /// <summary>The list this build carries; empty for a build made before there was one.</summary>
        public static CarList Default => Embedded.Value;

        /// <summary>
        /// The car with this folder, compared case-blind; failing that, with spaces, hyphens and underscores
        /// taken as the same. Null for a car the list does not have.
        /// </summary>
        public CarEntry Find(string carPath)
        {
            if (string.IsNullOrWhiteSpace(carPath)) return null;
            string path = carPath.Trim();
            if (_byPath.TryGetValue(path, out var car)) return car;
            return _byFolded.TryGetValue(Fold(path), out car) ? car : null;
        }

        /// <summary>A car's folder as <see cref="Find"/> compares it: case, hyphens, underscores and spaces folded away.</summary>
        public static string Fold(string path) =>
            (path ?? "").Trim().ToLowerInvariant().Replace('-', ' ').Replace('_', ' ');

        /// <summary>
        /// Reads a list. Whatever it does not know it leaves, whatever is not what it should be it takes as not
        /// said, and an entry with no path is passed over: a list with a mistake in one car is still the list
        /// for the others. Throws only for text that is not JSON at all.
        /// </summary>
        public static CarList Parse(string json) =>
            Parse(json, string.IsNullOrWhiteSpace(json) ? EmptyHash : HashOf(Encoding.UTF8.GetBytes(json)));

        private static CarList Parse(string json, string hash)
        {
            if (string.IsNullOrWhiteSpace(json)) return Empty;
            var root = JToken.Parse(json) as JObject;
            var problems = new List<string>();
            var cars = new List<CarEntry>();
            if (root == null)
            {
                problems.Add("the list is not an object");
                return new CarList(0, cars, problems, hash);
            }

            int version = (int)(Number(root["version"]) ?? 0);
            if (!(root["cars"] is JArray list))
            {
                problems.Add("the list has no cars");
                return new CarList(version, cars, problems, hash);
            }

            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            int index = -1;
            foreach (var token in list)
            {
                index++;
                if (!(token is JObject o))
                {
                    problems.Add($"entry {index} is not a car");
                    continue;
                }
                string path = Text(o["path"]);
                if (path == null)
                {
                    problems.Add($"entry {index} has no path");
                    continue;
                }
                if (!seen.Add(path))
                {
                    problems.Add($"{path} is in the list twice; the first is used");
                    continue;
                }
                var car = new CarEntry
                {
                    Path = path,
                    Name = Text(o["name"]),
                    Kind = Lower(o["kind"]),
                    Abs = Having(o["abs"], path, "abs", problems, CarEntry.None, CarEntry.Fixed, CarEntry.Adjustable),
                    Tc = Having(o["tc"], path, "tc", problems, CarEntry.None, CarEntry.Fixed, CarEntry.Adjustable),
                    BrakeBias = Having(o["brakeBias"], path, "brakeBias", problems, CarEntry.None, CarEntry.Adjustable),
                    Checked = Lower(o["checked"]),
                };
                var controls = new List<CarControl>();
                if (o["controls"] is JArray cs)
                {
                    foreach (var c in cs)
                    {
                        var control = c is JObject co ? Control(co) : null;
                        if (control == null) problems.Add($"{path}: a control with no id");
                        else controls.Add(control);
                    }
                }
                else if (o["controls"] != null && o["controls"].Type != JTokenType.Null)
                {
                    problems.Add($"{path}: controls is not a list");
                }
                car.Controls = controls;
                cars.Add(car);
            }
            return new CarList(version, cars, problems, hash);
        }

        /// <summary>The first twelve hex digits of the SHA-256 of these bytes: <see cref="Hash"/> of a list read from them.</summary>
        public static string HashOf(byte[] bytes)
        {
            using (var sha = SHA256.Create())
            {
                byte[] digest = sha.ComputeHash(bytes ?? new byte[0]);
                var text = new StringBuilder(12);
                for (int i = 0; i < 6; i++) text.Append(digest[i].ToString("x2", CultureInfo.InvariantCulture));
                return text.ToString();
            }
        }

        private static CarControl Control(JObject o)
        {
            string id = Text(o["id"]);
            if (id == null) return null;
            var control = new CarControl
            {
                Id = id,
                Var = Text(o["var"]),
                Label = Text(o["label"]),
                Words = Text(o["words"]),
                Note = Text(o["note"]),
                Off = Number(o["off"]),
                NeverOff = o["off"] != null && o["off"].Type == JTokenType.Boolean && !(bool)o["off"],
                LockedWhenFixed = o["lockedWhenFixed"] != null && o["lockedWhenFixed"].Type == JTokenType.Boolean ? (bool)o["lockedWhenFixed"] : (bool?)null,
            };

            if (o["range"] is JArray range && range.Count == 2)
            {
                double? low = Number(range[0]), high = Number(range[1]);
                if (low.HasValue && high.HasValue && high.Value >= low.Value)
                {
                    control.Min = low;
                    control.Max = high;
                }
            }

            if (o["positions"] is JObject positions)
            {
                var named = new List<KeyValuePair<double, string>>();
                foreach (var p in positions.Properties())
                {
                    string name = Text(p.Value);
                    if (name != null && double.TryParse(p.Name.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out double at))
                        named.Add(new KeyValuePair<double, string>(at, name));
                }
                named.Sort((a, b) => a.Key.CompareTo(b.Key));
                control.Positions = named;
                control.PositionsAreAScale = IsAScale(named);
            }

            if (o["covers"] is JArray covers)
            {
                var ids = new List<string>();
                foreach (var c in covers)
                {
                    string covered = Text(c);
                    if (covered != null) ids.Add(covered);
                }
                control.Covers = ids;
            }

            double? decimals = Number(o["decimals"]);
            if (decimals.HasValue && decimals.Value >= 0 && decimals.Value <= 3) control.Decimals = (int)decimals.Value;
            return control;
        }

        // Positions in the order of their values: a scale when every name is a number (a percent sign allowed after it),
        // or off at either end, and the numbers run one way.
        private static bool IsAScale(List<KeyValuePair<double, string>> positions)
        {
            if (positions.Count < 2) return false;
            var numbers = new List<double>();
            for (int i = 0; i < positions.Count; i++)
            {
                string name = positions[i].Value.Trim();
                if (string.Equals(name, "off", StringComparison.OrdinalIgnoreCase))
                {
                    if (i != 0 && i != positions.Count - 1) return false;
                    continue;
                }
                if (name.EndsWith("%", StringComparison.Ordinal)) name = name.Substring(0, name.Length - 1).TrimEnd();
                if (!double.TryParse(name, NumberStyles.Float, CultureInfo.InvariantCulture, out double n)) return false;
                numbers.Add(n);
            }
            if (numbers.Count < 2) return false;
            int direction = 0;
            for (int i = 1; i < numbers.Count; i++)
            {
                int step = Math.Sign(numbers[i] - numbers[i - 1]);
                if (step == 0 || (direction != 0 && step != direction)) return false;
                direction = step;
            }
            return true;
        }

        private static string Having(JToken token, string path, string what, List<string> problems, params string[] allowed)
        {
            string value = Lower(token);
            if (value == null)
            {
                if (token != null && token.Type != JTokenType.Null && token.Type != JTokenType.String)
                    problems.Add($"{path}: {what} is not a word; it is one of {string.Join(", ", allowed)}");
                return null;
            }
            foreach (string a in allowed)
                if (value == a) return a;
            problems.Add($"{path}: {what} is \"{value}\", which is none of {string.Join(", ", allowed)}");
            return null;
        }

        private static string Text(JToken token)
        {
            if (token == null || token.Type != JTokenType.String) return null;
            string text = ((string)token).Trim();
            return text.Length == 0 ? null : text;
        }

        private static string Lower(JToken token) => Text(token)?.ToLowerInvariant();

        private static double? Number(JToken token)
        {
            if (token == null || (token.Type != JTokenType.Integer && token.Type != JTokenType.Float)) return null;
            double value = (double)token;
            return double.IsNaN(value) || double.IsInfinity(value) ? (double?)null : value;
        }

        private static CarList LoadEmbedded()
        {
            try
            {
                using (var stream = typeof(CarList).GetTypeInfo().Assembly.GetManifestResourceStream(ResourceName))
                {
                    if (stream == null) return Empty;
                    byte[] bytes;
                    using (var copy = new MemoryStream())
                    {
                        stream.CopyTo(copy);
                        bytes = copy.ToArray();
                    }
                    using (var reader = new StreamReader(new MemoryStream(bytes)))
                    {
                        var list = Parse(reader.ReadToEnd(), HashOf(bytes));
                        foreach (string problem in list.Problems) Log.Warn("[RacingDesk] car list: " + problem);
                        return list;
                    }
                }
            }
            catch (Exception ex)
            {
                // A list that cannot be read is no list: the HUD shows what it showed before there was one.
                Log.Warn("[RacingDesk] car list: not read — " + ex.Message);
                return Empty;
            }
        }
    }
}
