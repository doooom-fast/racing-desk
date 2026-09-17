using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json;

namespace RaceCorProDrive.Plugin.Engine
{
    /// <summary>
    /// Manages pedal response curve profiles: per-car storage, active profile
    /// selection, and Moza Pithouse integration.
    /// Profiles are stored as JSON in the SimHub plugin data directory.
    /// </summary>
    public class PedalProfileManager
    {
        private readonly string _profileDir;
        private readonly Dictionary<string, PedalProfile> _profiles = new Dictionary<string, PedalProfile>();
        private readonly Dictionary<string, string> _carBindings = new Dictionary<string, string>(); // carModel → profileId
        private PedalProfile _active;
        private PedalProfile _global; // fallback profile when no car-specific one exists
        private string _currentCarModel = "";

        // ── Moza Pit House paths (try both "MOZA Pit House" and legacy "Pithouse") ──
        private static readonly string[] MozaPithouseSearchPaths = new[]
        {
            @"C:\Program Files (x86)\MOZA Pit House",
            @"C:\Program Files\MOZA Pit House",
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MOZA Pit House"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "MOZA Pit House"),
            // Legacy paths (older installer naming)
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Pithouse"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Pithouse"),
            @"C:\Program Files\Pithouse",
            @"C:\Program Files (x86)\Pithouse",
        };

        /// <summary>True if Moza Pithouse was detected on this system.</summary>
        public bool MozaDetected { get; private set; }

        /// <summary>Path to the detected Moza Pithouse data directory, or null.</summary>
        public string MozaPithousePath { get; private set; }

        /// <summary>Currently active profile (never null — falls back to default).</summary>
        public PedalProfile ActiveProfile => _active ?? _global ?? CreateDefaultProfile();

        /// <summary>All saved profiles.</summary>
        public IReadOnlyCollection<PedalProfile> Profiles => _profiles.Values.ToList().AsReadOnly();

        // ═══════════════════════════════════════════════════════════════
        //  INITIALIZATION
        // ═══════════════════════════════════════════════════════════════

        public PedalProfileManager(string pluginDataDir)
        {
            _profileDir = Path.Combine(pluginDataDir, "PedalProfiles");
            Directory.CreateDirectory(_profileDir);

            _global = CreateDefaultProfile();
            _active = _global;
        }

        /// <summary>
        /// Load all saved profiles and car bindings from disk.
        /// Call once at plugin Init().
        /// </summary>
        public void Load()
        {
            // Load profiles
            foreach (var file in Directory.GetFiles(_profileDir, "*.json"))
            {
                if (Path.GetFileName(file).StartsWith("_")) continue; // skip meta files
                try
                {
                    var json = File.ReadAllText(file);
                    var profile = JsonConvert.DeserializeObject<PedalProfile>(json);
                    if (profile != null && !string.IsNullOrEmpty(profile.Id))
                        _profiles[profile.Id] = profile;
                }
                catch { /* skip corrupt profiles */ }
            }

            // Load car bindings (carModel string → profileId)
            var bindingsFile = Path.Combine(_profileDir, "_bindings.json");
            if (File.Exists(bindingsFile))
            {
                try
                {
                    var json = File.ReadAllText(bindingsFile);
                    var bindings = JsonConvert.DeserializeObject<Dictionary<string, string>>(json);
                    if (bindings != null)
                    {
                        foreach (var kv in bindings)
                            _carBindings[kv.Key] = kv.Value;
                    }
                }
                catch { /* start fresh */ }
            }

            // Ensure global default exists
            if (!_profiles.Values.Any(p => string.IsNullOrEmpty(p.CarModel)))
            {
                _global = CreateDefaultProfile();
                _profiles[_global.Id] = _global;
                SaveProfile(_global);
            }
            else
            {
                _global = _profiles.Values.First(p => string.IsNullOrEmpty(p.CarModel));
            }

            // Detect Moza Pithouse and auto-import if found
            DetectMoza();
            if (MozaDetected)
            {
                AutoImportFromMoza();
            }
        }

        // ═══════════════════════════════════════════════════════════════
        //  CAR CHANGE — AUTO-SELECT PROFILE
        // ═══════════════════════════════════════════════════════════════

        /// <summary>
        /// Called when the car changes. Selects the appropriate profile
        /// and optionally pushes it to Moza Pithouse.
        /// </summary>
        public void OnCarChanged(string carModel, string carName)
        {
            _currentCarModel = carModel ?? "";

            if (!string.IsNullOrEmpty(_currentCarModel)
                && _carBindings.TryGetValue(_currentCarModel, out var profileId)
                && _profiles.TryGetValue(profileId, out var profile))
            {
                _active = profile;

                // Auto-push to Moza if detected
                if (MozaDetected)
                    PushToMoza(_active);
            }
            else
            {
                // No car-specific profile — use global
                _active = _global;
            }
        }

        // ═══════════════════════════════════════════════════════════════
        //  PROFILE CRUD
        // ═══════════════════════════════════════════════════════════════

        /// <summary>Save or update a profile.</summary>
        public void SaveProfile(PedalProfile profile)
        {
            profile.LastModified = DateTime.UtcNow;
            _profiles[profile.Id] = profile;

            var path = Path.Combine(_profileDir, profile.Id + ".json");
            var json = JsonConvert.SerializeObject(profile, Formatting.Indented);
            File.WriteAllText(path, json);
        }

        /// <summary>Delete a profile (cannot delete the global default).</summary>
        public bool DeleteProfile(string profileId)
        {
            if (!_profiles.TryGetValue(profileId, out var profile)) return false;
            if (string.IsNullOrEmpty(profile.CarModel) && profile == _global) return false;

            _profiles.Remove(profileId);
            var path = Path.Combine(_profileDir, profileId + ".json");
            if (File.Exists(path)) File.Delete(path);

            // Remove any car bindings pointing to this profile
            var toRemove = _carBindings.Where(kv => kv.Value == profileId).Select(kv => kv.Key).ToList();
            foreach (var car in toRemove)
                _carBindings.Remove(car);
            SaveBindings();

            return true;
        }

        /// <summary>Bind a profile to a car model string.</summary>
        public void BindProfileToCar(string profileId, string carModel, string carName)
        {
            if (!_profiles.ContainsKey(profileId)) return;
            if (string.IsNullOrEmpty(carModel)) return;

            _carBindings[carModel] = profileId;
            SaveBindings();

            // Update profile's car info
            var profile = _profiles[profileId];
            if (string.IsNullOrEmpty(profile.CarModel) || profile.CarModel == carModel)
            {
                profile.CarModel = carModel;
                profile.CarName = carName;
                SaveProfile(profile);
            }
        }

        /// <summary>Switch active profile manually (overrides car binding for this session).</summary>
        public void SetActiveProfile(string profileId)
        {
            if (_profiles.TryGetValue(profileId, out var profile))
            {
                _active = profile;
                if (MozaDetected) PushToMoza(_active);
            }
        }

        private void SaveBindings()
        {
            var path = Path.Combine(_profileDir, "_bindings.json");
            var json = JsonConvert.SerializeObject(_carBindings, Formatting.Indented);
            File.WriteAllText(path, json);
        }

        // ═══════════════════════════════════════════════════════════════
        //  MOZA PITHOUSE INTEGRATION
        // ═══════════════════════════════════════════════════════════════

        private void DetectMoza()
        {
            foreach (var searchPath in MozaPithouseSearchPaths)
            {
                if (Directory.Exists(searchPath))
                {
                    MozaPithousePath = searchPath;
                    MozaDetected = true;
                    return;
                }
            }
            MozaDetected = false;
        }

        /// <summary>
        /// Import pedal curves from Moza Pithouse configuration.
        /// Returns a new PedalProfile populated from Pithouse data, or null if unavailable.
        /// </summary>
        public PedalProfile ImportFromMoza()
        {
            if (!MozaDetected || string.IsNullOrEmpty(MozaPithousePath)) return null;

            try
            {
                // Moza Pithouse stores pedal config in JSON files under the data directory.
                // Structure: Pithouse/profiles/*.json or Pithouse/DeviceConfig/*.json
                var configDir = Path.Combine(MozaPithousePath, "DeviceConfig");
                if (!Directory.Exists(configDir))
                    configDir = Path.Combine(MozaPithousePath, "profiles");
                if (!Directory.Exists(configDir)) return null;

                // Find the most recently modified config file
                var configFiles = Directory.GetFiles(configDir, "*.json")
                    .OrderByDescending(f => File.GetLastWriteTimeUtc(f))
                    .ToList();

                if (configFiles.Count == 0) return null;

                var json = File.ReadAllText(configFiles[0]);
                var config = JsonConvert.DeserializeObject<Dictionary<string, object>>(json);
                if (config == null) return null;

                var profile = new PedalProfile
                {
                    Name = "Moza Import (" + Path.GetFileNameWithoutExtension(configFiles[0]) + ")",
                    Source = "moza"
                };

                // Parse Moza curve format: arrays of [input%, output%] normalized 0-100
                profile.ThrottleCurvePoints = ParseMozaCurve(config, "throttleCurve", "throttle_curve");
                profile.BrakeCurvePoints = ParseMozaCurve(config, "brakeCurve", "brake_curve");
                profile.ClutchCurvePoints = ParseMozaCurve(config, "clutchCurve", "clutch_curve");

                // Parse deadzone values
                profile.ThrottleDeadzone = ParseMozaScalar(config, "throttleDeadzone", "throttle_deadzone") / 100.0;
                profile.BrakeDeadzone = ParseMozaScalar(config, "brakeDeadzone", "brake_deadzone") / 100.0;
                profile.ClutchDeadzone = ParseMozaScalar(config, "clutchDeadzone", "clutch_deadzone") / 100.0;

                return profile;
            }
            catch
            {
                return null;
            }
        }

        /// <summary>
        /// Auto-import from Moza on startup. Imports if no Moza-sourced profile
        /// exists yet, or refreshes the existing one if the Pithouse config file
        /// is newer than the last import.
        /// </summary>
        private void AutoImportFromMoza()
        {
            try
            {
                var existing = _profiles.Values.FirstOrDefault(p => p.Source == "moza");

                // Check if Pithouse config has been updated since last import
                var configFile = GetNewestMozaConfigFile();
                if (configFile == null) return;

                var configModified = File.GetLastWriteTimeUtc(configFile);
                if (existing != null && existing.LastModified >= configModified)
                    return; // already up to date

                var imported = ImportFromMoza();
                if (imported == null) return;

                // If updating an existing Moza profile, keep the same ID
                if (existing != null)
                    imported.Id = existing.Id;

                SaveProfile(imported);
                _profiles[imported.Id] = imported;

                // Make it active if no other profile is explicitly active
                if (_active == null || _active == _global || (_active.Source == "moza"))
                    _active = imported;
            }
            catch { /* silent — don't break startup */ }
        }

        /// <summary>
        /// Returns the newest Moza Pithouse config file, or null.
        /// </summary>
        private string GetNewestMozaConfigFile()
        {
            if (!MozaDetected || string.IsNullOrEmpty(MozaPithousePath)) return null;

            var configDir = Path.Combine(MozaPithousePath, "DeviceConfig");
            if (!Directory.Exists(configDir))
                configDir = Path.Combine(MozaPithousePath, "profiles");
            if (!Directory.Exists(configDir)) return null;

            return Directory.GetFiles(configDir, "*.json")
                .OrderByDescending(f => File.GetLastWriteTimeUtc(f))
                .FirstOrDefault();
        }

        /// <summary>
        /// Push a pedal profile to Moza Pithouse so it takes effect immediately.
        /// Returns true on success.
        /// </summary>
        public bool PushToMoza(PedalProfile profile)
        {
            if (!MozaDetected || string.IsNullOrEmpty(MozaPithousePath)) return false;

            try
            {
                var configDir = Path.Combine(MozaPithousePath, "DeviceConfig");
                if (!Directory.Exists(configDir))
                    configDir = Path.Combine(MozaPithousePath, "profiles");
                if (!Directory.Exists(configDir))
                    Directory.CreateDirectory(configDir);

                // Build Moza-format config
                var mozaConfig = new Dictionary<string, object>
                {
                    ["throttle_curve"] = ProfileCurveToMozaFormat(profile.GetThrottleCurveDisplay()),
                    ["brake_curve"] = ProfileCurveToMozaFormat(profile.GetBrakeCurveDisplay()),
                    ["clutch_curve"] = ProfileCurveToMozaFormat(profile.GetClutchCurveDisplay()),
                    ["throttle_deadzone"] = (int)(profile.ThrottleDeadzone * 100),
                    ["brake_deadzone"] = (int)(profile.BrakeDeadzone * 100),
                    ["clutch_deadzone"] = (int)(profile.ClutchDeadzone * 100),
                    ["source"] = "RaceCor",
                    ["timestamp"] = DateTime.UtcNow.ToString("o")
                };

                var outputPath = Path.Combine(configDir, "k10_active_profile.json");
                var json = JsonConvert.SerializeObject(mozaConfig, Formatting.Indented);
                File.WriteAllText(outputPath, json);

                return true;
            }
            catch
            {
                return false;
            }
        }

        // ── Moza format helpers ───────────────────────────────────────

        private static List<double[]> ParseMozaCurve(Dictionary<string, object> config,
            params string[] keys)
        {
            foreach (var key in keys)
            {
                if (!config.ContainsKey(key)) continue;
                try
                {
                    var raw = JsonConvert.DeserializeObject<double[][]>(config[key].ToString());
                    if (raw == null || raw.Length < 2) continue;

                    // Moza uses 0-100 scale, we use 0-1
                    return raw.Select(p => new[] { p[0] / 100.0, p[1] / 100.0 }).ToList();
                }
                catch { continue; }
            }
            return new List<double[]>();
        }

        private static double ParseMozaScalar(Dictionary<string, object> config, params string[] keys)
        {
            foreach (var key in keys)
            {
                if (!config.ContainsKey(key)) continue;
                if (double.TryParse(config[key].ToString(), out double val))
                    return val;
            }
            return 0;
        }

        private static int[][] ProfileCurveToMozaFormat(double[][] curve)
        {
            // Convert 0-1 back to 0-100 for Moza
            return curve.Select(p => new[] { (int)(p[0] * 100), (int)(p[1] * 100) }).ToArray();
        }

        // ═══════════════════════════════════════════════════════════════
        //  DATA SOURCE SERIALIZATION (for dashboard HTTP bridge)
        // ═══════════════════════════════════════════════════════════════

        /// <summary>
        /// Returns a compact JSON object with the active profile's curve data
        /// for the dashboard to render. Called each HTTP poll.
        /// </summary>
        public string GetDashboardJson()
        {
            var p = ActiveProfile;
            // Only send curve data when a real profile has been imported.
            // The built-in fallback global profile (source "manual", no car)
            // should not cause curves to render — "no profile = no curves".
            bool hasRealProfile = _profiles.Values.Any(pr => pr.Source != "manual"
                || !string.IsNullOrEmpty(pr.CarModel));
            var data = new Dictionary<string, object>
            {
                ["profileName"] = hasRealProfile ? p.Name : "",
                ["carName"] = hasRealProfile ? p.CarName : "",
                ["source"] = hasRealProfile ? p.Source : "",
                ["mozaDetected"] = MozaDetected,
                ["throttleCurve"] = hasRealProfile ? p.GetThrottleCurveDisplay() : null,
                ["brakeCurve"] = hasRealProfile ? p.GetBrakeCurveDisplay() : null,
                ["clutchCurve"] = hasRealProfile ? p.GetClutchCurveDisplay() : null,
                ["throttleDeadzone"] = p.ThrottleDeadzone,
                ["brakeDeadzone"] = p.BrakeDeadzone,
                ["throttleGamma"] = p.ThrottleGamma,
                ["brakeGamma"] = p.BrakeGamma,
            };
            return JsonConvert.SerializeObject(data);
        }

        /// <summary>
        /// Returns a JSON array of all profile summaries for the settings UI.
        /// </summary>
        public string GetProfileListJson()
        {
            var list = _profiles.Values.Select(p => new
            {
                id = p.Id,
                name = p.Name,
                carModel = p.CarModel,
                carName = p.CarName,
                source = p.Source,
                isActive = p.Id == ActiveProfile.Id,
                lastModified = p.LastModified.ToString("o")
            }).OrderBy(p => p.carName).ThenBy(p => p.name);

            return JsonConvert.SerializeObject(list);
        }

        private PedalProfile CreateDefaultProfile()
        {
            return new PedalProfile
            {
                Name = "Linear (Default)",
                CarModel = "",
                CarName = "Global",
                Source = "manual",
                ThrottleGamma = 1.0,
                BrakeGamma = 1.0,
                ClutchGamma = 1.0,
            };
        }
    }
}
