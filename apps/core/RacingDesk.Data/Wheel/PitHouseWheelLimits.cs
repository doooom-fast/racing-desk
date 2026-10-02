using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Text.Json;
using RacingDesk.Plugin.Engine.Moza;

namespace RacingDesk.Data.Wheel
{
    /// <summary>
    /// The wheel's maximum torque, for the HUD's datastream ("max wheel Nm"): the base's max-torque setting in per cent
    /// of the rated peak of its model, as a number of Nm. Where the number comes from, in the order it is trusted:
    /// the base itself (<see cref="WheelbaseReading"/>: what the plugin's poll last read, which runs only while Pit
    /// House has let go of the base's serial ports) and Pit House's own saved preset for the base
    /// (<see cref="PitHouseWheelLimits"/>). Neither is known: a dash, never a number made up.
    /// </summary>
    public sealed class WheelLimit
    {
        /// <summary><c>base</c>: read from the wheel base; <c>pithouse</c>: Pit House's saved preset for it.</summary>
        public string Source { get; set; }

        /// <summary>The model ("R21 Ultra"), as the base's description or Pit House names it.</summary>
        public string Model { get; set; }

        /// <summary>The max-torque setting, per cent of the model's rated peak.</summary>
        public double? MaxPercent { get; set; }

        /// <summary>The model's rated peak torque in Nm, or null for a model not in the table.</summary>
        public double? RatedNm { get; set; }

        /// <summary>The maximum torque in Nm: the setting of the rating; null where either is not known.</summary>
        public double? MaxNm => MaxPercent.HasValue && RatedNm.HasValue ? MaxPercent.Value * RatedNm.Value / 100.0 : (double?)null;

        /// <summary>How many MOZA motor presets Pit House has as last used (one for each base it has met); 1 for a reading from the base.</summary>
        public int Candidates { get; set; }

        /// <summary>When the preset was last saved (UTC), for a reading from Pit House.</summary>
        public DateTime? SavedAtUtc { get; set; }

        /// <summary>
        /// The base's own reading where it has one and its model has a rating, else Pit House's saved preset, else null.
        /// </summary>
        public static WheelLimit Resolve(WheelbaseReading live, WheelLimit pitHouse)
        {
            if (live != null && live.MaxTorquePercent >= 0)
            {
                double? rated = MozaWheelbaseModels.RatedNm(live.Model);
                if (rated.HasValue)
                    return new WheelLimit { Source = "base", Model = live.Model, MaxPercent = live.MaxTorquePercent, RatedNm = rated, Candidates = 1 };
            }
            return pitHouse;
        }
    }

    /// <summary>
    /// Pit House's own saved preset for the wheel base, read and never written. Pit House keeps, under
    /// <c>Documents\MOZA Pit House\Presets</c>, a <c>config.ini</c> whose <c>[LastUsedPreset]</c> maps each device it has
    /// met to the preset it last used, and one <c>.mzpreset</c> for each preset in <c>Motor\</c> — an ordinary zip of a
    /// <c>preset.json</c> and a <c>metadata.json</c>. The motor preset says which device it is for (<c>devices</c>, "R21
    /// Ultra") and what its limits are (<c>deviceParams.maximumTorque</c>, per cent of the model's rated peak).
    ///
    /// Everything is opened for reading with the sharing Pit House's own writes need (<c>FileShare.ReadWrite</c>), so a
    /// running Pit House is never in the way and this is never in Pit House's. Nothing is created, changed or deleted, and
    /// nothing is sent to Pit House or the base; no serial port is opened.
    ///
    /// <b>What this is not.</b> A saved preset is what Pit House last loaded into the base, not necessarily what the base
    /// is set to now (a slider moved in Pit House and not saved is not in the file), and Pit House does not say which of
    /// the bases it has met is the one attached: with more than one motor preset in <c>[LastUsedPreset]</c> the one saved
    /// last is taken, and <see cref="WheelLimit.Candidates"/> says how many there were.
    /// </summary>
    public sealed class PitHouseWheelLimits
    {
        private const string FolderName = "MOZA Pit House";
        private static readonly TimeSpan Keep = TimeSpan.FromSeconds(5);
        private const int MaxPresetBytes = 512 * 1024;

        private readonly string _documents;
        private readonly Func<DateTime> _now;
        private readonly Action<string> _log;
        private readonly object _gate = new object();
        private WheelLimit _last;
        private DateTime _at = DateTime.MinValue;
        private string _said = "";

        /// <param name="documents">The user's Documents folder (null: Windows's own).</param>
        /// <param name="now">The clock (null: the real one).</param>
        /// <param name="log">Where a line goes when the files are not what is expected (null: nowhere).</param>
        public PitHouseWheelLimits(string documents = null, Func<DateTime> now = null, Action<string> log = null)
        {
            _documents = documents ?? Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
            _now = now ?? (() => DateTime.UtcNow);
            _log = log ?? (_ => { });
        }

        /// <summary>The limit from Pit House's preset, or null: Pit House is not on this machine, or has no motor preset it says it used. Kept for a few seconds.</summary>
        public WheelLimit Read()
        {
            lock (_gate)
            {
                DateTime now = _now();
                if (now - _at < Keep && now >= _at) return _last;
                _at = now;
                try
                {
                    _last = ReadOnce(_documents, Say);
                }
                catch (Exception ex)
                {
                    Say("Pit House's presets could not be read: " + ex.GetType().Name + ": " + ex.Message);
                    _last = null;
                }
                return _last;
            }
        }

        // A line the log has not had, once: a file that stays wrong is said once, not every few seconds.
        private void Say(string line)
        {
            if (line == _said) return;
            _said = line;
            _log("wheel limit: " + line);
        }

        /// <summary>One look, with no memory: what the files hold now.</summary>
        internal static WheelLimit ReadOnce(string documents, Action<string> say)
        {
            string presets = Path.Combine(documents ?? "", FolderName, "Presets");
            string ini = Path.Combine(presets, "config.ini");
            if (!File.Exists(ini)) return null;

            var candidates = new List<(string Name, string Model, double Percent, DateTime Saved)>();
            foreach (Guid id in LastUsedPresets(ReadAllText(ini)))
            {
                string file = Path.Combine(presets, "Motor", id.ToString("D") + ".mzpreset");
                if (!File.Exists(file)) continue;
                try
                {
                    var read = ReadPreset(file);
                    if (read.HasValue) candidates.Add(read.Value);
                }
                catch (Exception ex) when (ex is IOException || ex is InvalidDataException || ex is JsonException || ex is UnauthorizedAccessException)
                {
                    say?.Invoke("a motor preset could not be read (" + ex.GetType().Name + ")");
                }
            }
            if (candidates.Count == 0) return null;

            // The preset saved last: Pit House does not say which of its bases is the one attached.
            var chosen = candidates.OrderByDescending(c => c.Saved).First();
            return new WheelLimit
            {
                Source = "pithouse",
                Model = chosen.Model,
                MaxPercent = chosen.Percent,
                RatedNm = MozaWheelbaseModels.RatedNm(chosen.Model),
                Candidates = candidates.Count,
                SavedAtUtc = chosen.Saved,
            };
        }

        /// <summary>The preset ids <c>[LastUsedPreset]</c> lists: the right-hand side of each line of that section that is a GUID.</summary>
        internal static IEnumerable<Guid> LastUsedPresets(string ini)
        {
            bool inSection = false;
            var seen = new HashSet<Guid>();
            foreach (string raw in (ini ?? "").Split('\n'))
            {
                string line = raw.Trim();
                if (line.Length == 0 || line[0] == ';' || line[0] == '#') continue;
                if (line[0] == '[')
                {
                    inSection = string.Equals(line, "[LastUsedPreset]", StringComparison.OrdinalIgnoreCase);
                    continue;
                }
                if (!inSection) continue;
                int eq = line.IndexOf('=');
                if (eq < 0) continue;
                if (Guid.TryParseExact(line.Substring(eq + 1).Trim(), "D", out Guid id) && seen.Add(id)) yield return id;
            }
        }

        // A motor preset's name, the model it is for and its max torque, or null where the file is not a motor preset
        // with a usable one. The model is the device's name as Pit House writes it ("R21 Ultra"), a string or the first of
        // a list; the setting is a per cent above nought and up to a hundred.
        private static (string Name, string Model, double Percent, DateTime Saved)? ReadPreset(string path)
        {
            using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            using (var zip = new ZipArchive(stream, ZipArchiveMode.Read))
            {
                ZipArchiveEntry entry = zip.Entries.FirstOrDefault(e => string.Equals(e.FullName, "preset.json", StringComparison.OrdinalIgnoreCase));
                if (entry == null || entry.Length > MaxPresetBytes) return null;
                using (var json = JsonDocument.Parse(entry.Open()))
                {
                    JsonElement root = json.RootElement;
                    if (root.ValueKind != JsonValueKind.Object) return null;
                    if (!root.TryGetProperty("deviceType", out JsonElement type) || type.ValueKind != JsonValueKind.String
                        || !string.Equals(type.GetString(), "Motor", StringComparison.OrdinalIgnoreCase)) return null;

                    string model = null;
                    if (root.TryGetProperty("devices", out JsonElement devices))
                    {
                        if (devices.ValueKind == JsonValueKind.String) model = devices.GetString();
                        else if (devices.ValueKind == JsonValueKind.Array && devices.GetArrayLength() > 0 && devices[0].ValueKind == JsonValueKind.String) model = devices[0].GetString();
                    }
                    if (string.IsNullOrWhiteSpace(model)) return null;

                    if (!root.TryGetProperty("deviceParams", out JsonElement parameters) || parameters.ValueKind != JsonValueKind.Object) return null;
                    if (!parameters.TryGetProperty("maximumTorque", out JsonElement torque) || torque.ValueKind != JsonValueKind.Number) return null;
                    double percent = torque.GetDouble();
                    if (!(percent > 0 && percent <= 100)) return null;

                    string name = root.TryGetProperty("name", out JsonElement n) && n.ValueKind == JsonValueKind.String ? n.GetString() : "";
                    // "2026-09-30T16:57:42" — local time, no zone. Where it is not there, the file's own time.
                    DateTime saved = root.TryGetProperty("lastModified", out JsonElement lm) && lm.ValueKind == JsonValueKind.String
                        && DateTime.TryParse(lm.GetString(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal | DateTimeStyles.AdjustToUniversal, out DateTime parsed)
                        ? parsed
                        : File.GetLastWriteTimeUtc(path);
                    return (name, model.Trim(), percent, saved);
                }
            }
        }

        private static string ReadAllText(string path)
        {
            using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            using (var reader = new StreamReader(stream, Encoding.UTF8, true))
                return stream.Length > 256 * 1024 ? "" : reader.ReadToEnd();
        }
    }
}
