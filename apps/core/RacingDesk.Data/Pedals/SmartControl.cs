using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Xml.Linq;
using Microsoft.Data.Sqlite;

namespace RacingDesk.Data.Pedals
{
    /// <summary>One pedal's response as SmartControl keeps it. Percentages are 0 to 100.</summary>
    public sealed class PedalResponse
    {
        public double? DeadzoneBottom { get; internal set; }

        /// <summary>The throttle and clutch have one; the brake doesn't.</summary>
        public double? DeadzoneTop { get; internal set; }

        /// <summary>Output at 0, 20, 40, 60, 80 and 100 % of travel. Empty when the profile doesn't give all six.</summary>
        public IReadOnlyList<double> Curve { get; internal set; } = Array.Empty<double>();

        /// <summary>The brake only: the force, in kilograms, that reads as full braking.</summary>
        public double? MaxForceKg { get; internal set; }
    }

    public sealed class SmartControlProfile
    {
        public string Id { get; internal set; }
        public string Name { get; internal set; }

        /// <summary>
        /// The profile byte for byte as SmartControl stored it. Each device's section carries a hash of its
        /// values, so a profile is kept and put back whole, never rebuilt from the numbers below.
        /// </summary>
        public byte[] Data { get; internal set; }

        /// <summary>Null when the profile has nothing for these pedals, or couldn't be read.</summary>
        public PedalResponse Throttle { get; internal set; }
        public PedalResponse Brake { get; internal set; }
        public PedalResponse Clutch { get; internal set; }
    }

    /// <summary>
    /// What a key of SmartControl Live's does, of the actions this app knows: set, raise or lower the Ultimate pedals'
    /// brake force (8, 9, 10), or switch the pedals to a profile (1, SetProfile: Heusinkveld's own first-run setup binds
    /// NUMPAD1–4 to four profiles that way). The key watcher follows the force keys alone; a profile key is known, never
    /// watched.
    /// </summary>
    public enum LiveAction { Other, SetBrakeForce, RaiseBrakeForce, LowerBrakeForce, SetProfile }

    /// <summary>A key, or a pair held together, that SmartControl Live acts on.</summary>
    public sealed class LiveKey
    {
        public LiveAction Action { get; internal set; }

        /// <summary>Kilograms: the force to set, or the size of the step. Nought for a profile key.</summary>
        public double Value { get; internal set; }

        /// <summary>For a profile key (<see cref="LiveAction.SetProfile"/>): the id of the profile it switches to, as Live keeps it.</summary>
        public string ProfileId { get; internal set; }

        /// <summary>The binding's own row, and the Live preset it is in where the database says; 0 where it does not.</summary>
        public long BindingId { get; internal set; }
        public long PresetId { get; internal set; }

        /// <summary>Windows' names for the keys, as SmartControl writes them: <c>PRIOR</c> is Page Up.</summary>
        public string FirstKey { get; internal set; }
        public string SecondKey { get; internal set; }
    }

    public sealed class SmartControlSnapshot
    {
        public string DatabasePath { get; internal set; }
        public IReadOnlyList<SmartControlProfile> Profiles { get; internal set; } = Array.Empty<SmartControlProfile>();
        public IReadOnlyList<LiveKey> Keys { get; internal set; } = Array.Empty<LiveKey>();
    }

    /// <summary>
    /// Heusinkveld's SmartControl, read and never written: the pedal profiles and SmartControl Live's keys, from
    /// the database SmartControl keeps under <c>ProgramData</c>. SmartControl is where a value is set; this is
    /// how the desk learns what was set.
    /// </summary>
    public static class SmartControl
    {
        /// <summary>The section of a profile that belongs to the pedals on the rig.</summary>
        public const string Pedals = "SimPedalsUltimate";

        private static readonly string[] CurvePoints =
        {
            "ZeroPercentage", "TwentyPercentage", "FourtyPercentage", // SmartControl's spelling
            "SixtyPercentage", "EightyPercentage", "HundredPercentage",
        };

        public static string DefaultDatabasePath =>
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
                "Heusinkveld", "Database", "Heusinkveld.db");

        /// <summary>
        /// Null when SmartControl isn't installed, or its database isn't where it is expected. A database from
        /// a SmartControl that keeps things elsewhere reads as no profiles and no keys.
        /// </summary>
        public static SmartControlSnapshot Read(string databasePath = null, string pedals = Pedals)
        {
            string path = databasePath ?? DefaultDatabasePath;
            if (!File.Exists(path)) return null;

            // Read-only, and not pooled: no handle on SmartControl's file outlives this call. And not patient:
            // while SmartControl holds its file, this goes away and is asked again, rather than wait half a minute.
            var connection = new SqliteConnectionStringBuilder
            {
                DataSource = path,
                Mode = SqliteOpenMode.ReadOnly,
                Pooling = false,
                DefaultTimeout = 1,
            };
            using var db = new SqliteConnection(connection.ToString());
            db.Open();

            var profiles = new List<SmartControlProfile>();
            if (HasTable(db, "profile_sim_device"))
            {
                using var cmd = db.CreateCommand();
                cmd.CommandText = "SELECT id, name, data FROM profile_sim_device ORDER BY name COLLATE NOCASE";
                using var rows = cmd.ExecuteReader();
                while (rows.Read())
                {
                    var profile = new SmartControlProfile
                    {
                        Id = rows.IsDBNull(0) ? null : Convert.ToString(rows.GetValue(0), CultureInfo.InvariantCulture),
                        Name = rows.IsDBNull(1) ? "" : rows.GetString(1),
                        Data = rows.IsDBNull(2) ? Array.Empty<byte>() : Bytes(rows.GetValue(2)),
                    };
                    Parse(profile, pedals);
                    profiles.Add(profile);
                }
            }

            var keys = new List<LiveKey>();
            if (HasTable(db, "keyboard_binding"))
            {
                using var cmd = db.CreateCommand();
                // The preset a key is in, where the database keeps that (SmartControl Live's presets: his are "(empty)" and
                // "Default", with his five keys in Default); a database without the link table reads each key as in none.
                bool linked = HasTable(db, "profile_smartcontrol_live_keyboard_binding");
                cmd.CommandText = linked
                    ? "SELECT k.action_type, k.action_value, k.first_key, k.second_key, k.id, " +
                      "(SELECT MIN(l.fk_profile_smartcontrol_live_id) FROM profile_smartcontrol_live_keyboard_binding l WHERE l.fk_keyboard_binding_id = k.id) " +
                      "FROM keyboard_binding k ORDER BY k.id"
                    : "SELECT action_type, action_value, first_key, second_key, id, NULL FROM keyboard_binding ORDER BY id";
                using var rows = cmd.ExecuteReader();
                while (rows.Read())
                {
                    var action = rows.IsDBNull(0) ? LiveAction.Other : Action(Convert.ToInt32(rows.GetValue(0), CultureInfo.InvariantCulture));
                    string value = rows.IsDBNull(1) ? null : Convert.ToString(rows.GetValue(1), CultureInfo.InvariantCulture);
                    keys.Add(new LiveKey
                    {
                        Action = action,
                        Value = action == LiveAction.SetProfile || value == null ? 0 : Number(value) ?? 0,
                        ProfileId = action == LiveAction.SetProfile ? value?.Trim() : null,
                        FirstKey = rows.IsDBNull(2) ? "" : rows.GetString(2),
                        SecondKey = rows.IsDBNull(3) ? "" : rows.GetString(3),
                        BindingId = rows.IsDBNull(4) ? 0 : Convert.ToInt64(rows.GetValue(4), CultureInfo.InvariantCulture),
                        PresetId = rows.IsDBNull(5) ? 0 : Convert.ToInt64(rows.GetValue(5), CultureInfo.InvariantCulture),
                    });
                }
            }

            return new SmartControlSnapshot { DatabasePath = path, Profiles = profiles, Keys = keys };
        }

        // SmartControl's own numbers for what a key does (LibHeusinkveld's EActionType): 8 with a force to set, 9 and 10
        // with a step, from his bindings on the rig; 1 with a profile's id, from the vendor's first-run setup (NUMPAD1–4).
        internal static LiveAction Action(int type)
        {
            switch (type)
            {
                case 1: return LiveAction.SetProfile;
                case 8: return LiveAction.SetBrakeForce;
                case 9: return LiveAction.RaiseBrakeForce;
                case 10: return LiveAction.LowerBrakeForce;
                default: return LiveAction.Other;
            }
        }

        /// <summary>Fills in the pedals' values from <see cref="SmartControlProfile.Data"/>; leaves them null if it can't.</summary>
        internal static void Parse(SmartControlProfile profile, string pedals = Pedals)
        {
            profile.Throttle = profile.Brake = profile.Clutch = null;
            if (profile.Data == null || profile.Data.Length == 0) return;

            XElement device;
            try
            {
                // Read as text, not as bytes: SmartControl writes a profile from a string, so most say
                // encoding="utf-16" on their first line and are nothing of the kind on disk, and a reader
                // that believes the line refuses the file. Parsed from a string, the line is not consulted.
                device = XDocument.Parse(Text(profile.Data)).Root?.Elements()
                    .FirstOrDefault(e => e.Name.LocalName == pedals);
            }
            catch (System.Xml.XmlException)
            {
                return;
            }
            if (device == null) return;

            profile.Throttle = Response(device, "ThrottleProfile");
            profile.Brake = Response(device, "BrakeProfile");
            profile.Clutch = Response(device, "ClutchProfile");
        }

        private static PedalResponse Response(XElement device, string name)
        {
            var pedal = device.Elements().FirstOrDefault(e => e.Name.LocalName == name);
            if (pedal == null) return null;

            double? Value(string child) =>
                Number(pedal.Elements().FirstOrDefault(e => e.Name.LocalName == child)?.Value);

            var curve = CurvePoints.Select(Value).ToList();
            return new PedalResponse
            {
                DeadzoneBottom = Value("DeadzoneBottomPercentage"),
                DeadzoneTop = Value("DeadzoneTopPercentage"),
                MaxForceKg = Value("MaximumCalibratedForceInKilogram"),
                Curve = curve.All(p => p.HasValue) ? curve.Select(p => p.Value).ToList() : new List<double>(),
            };
        }

        /// <summary>
        /// A profile's bytes as text, by what the bytes are: a byte order mark says, and failing that a profile
        /// that really is UTF-16 has a zero in every other byte of its first line.
        /// </summary>
        internal static string Text(byte[] data)
        {
            if (data.Length >= 3 && data[0] == 0xEF && data[1] == 0xBB && data[2] == 0xBF)
                return Encoding.UTF8.GetString(data, 3, data.Length - 3);
            if (data.Length >= 2 && data[0] == 0xFF && data[1] == 0xFE)
                return Encoding.Unicode.GetString(data, 2, data.Length - 2);
            if (data.Length >= 2 && data[0] == 0xFE && data[1] == 0xFF)
                return Encoding.BigEndianUnicode.GetString(data, 2, data.Length - 2);
            if (data.Length >= 4 && data[0] != 0 && data[1] == 0 && data[2] != 0 && data[3] == 0)
                return Encoding.Unicode.GetString(data);
            if (data.Length >= 4 && data[0] == 0 && data[1] != 0 && data[2] == 0 && data[3] != 0)
                return Encoding.BigEndianUnicode.GetString(data);
            return Encoding.UTF8.GetString(data);
        }

        private static double? Number(string text) =>
            double.TryParse(text?.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out double n)
            && !double.IsNaN(n) && !double.IsInfinity(n) ? n : (double?)null;

        // The column is a BLOB; a profile imported by hand may have gone in as text.
        private static byte[] Bytes(object value) =>
            value as byte[] ?? Encoding.UTF8.GetBytes(Convert.ToString(value, CultureInfo.InvariantCulture) ?? "");

        private static bool HasTable(SqliteConnection db, string name)
        {
            using var cmd = db.CreateCommand();
            cmd.CommandText = "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = $name";
            cmd.Parameters.AddWithValue("$name", name);
            return cmd.ExecuteScalar() != null;
        }
    }
}
