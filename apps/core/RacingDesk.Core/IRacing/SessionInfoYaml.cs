using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.RegularExpressions;
using IRSDKSharper;
using YamlDotNet.Serialization;

namespace RacingDesk.Plugin.IRacing
{
    /// <summary>One driver's car, as <c>DriverInfo: Drivers:</c> lists it.</summary>
    public sealed class DriverCar
    {
        public int CarIdx { get; internal set; }
        /// <summary>iRacing's folder name for the car, e.g. "mx5 mx52016" — also the name of its paint folder.</summary>
        public string CarPath { get; internal set; }
        public string CarScreenName { get; internal set; }
        public string CarScreenNameShort { get; internal set; }
        public int CarID { get; internal set; }
    }

    /// <summary>Parses iRacing's session-info YAML into IRSDKSharper's typed model.</summary>
    public static class SessionInfoYaml
    {
        private static readonly IDeserializer Deserializer =
            new DeserializerBuilder().IgnoreUnmatchedProperties().Build();

        // iRacing writes free-text values unquoted, so names like "O'Brien: Racing" or "#1 Fan"
        // break a strict YAML parser. Quote the string fields that carry user- or track-authored text.
        private static readonly Regex FreeText = new Regex(
            @"^(\s*(?:- )?(?:UserName|AbbrevName|Initials|TeamName|CarDesignStr|HelmetDesignStr|SuitDesignStr|" +
            @"CarNumberDesignStr|CarSponsor_1|CarSponsor_2|ClubName|DivisionName|FlairName|DriverSetupName|" +
            @"SessionName|ReasonOutStr|TrackDisplayName|TrackDisplayShortName|TrackConfigName|TrackCity|" +
            @"TrackCountry|CarScreenName|CarScreenNameShort|CarClassShortName|LicString|CarNumber):[ \t])(.*?)\r?$",
            RegexOptions.Multiline | RegexOptions.Compiled);

        public static IRacingSdkSessionInfo Parse(string yaml)
        {
            if (string.IsNullOrEmpty(yaml)) return null;
            return Deserializer.Deserialize<IRacingSdkSessionInfo>(Sanitize(yaml));
        }

        internal static string Sanitize(string yaml) =>
            FreeText.Replace(yaml, m =>
            {
                string value = m.Groups[2].Value;
                if (value.Length == 0 || (value.Length >= 2 && value[0] == '"' && value[value.Length - 1] == '"'))
                    return m.Value;
                return m.Groups[1].Value + "'" + value.Replace("'", "''") + "'";
            });

        /// <summary>
        /// Every driver's car from the typed model: the pace car and spectators left out, the driver's own
        /// entry always kept (it is the car the session is stored under).
        /// </summary>
        public static List<DriverCar> DriverCars(IRacingSdkSessionInfo info)
        {
            var cars = new List<DriverCar>();
            var di = info?.DriverInfo;
            if (di?.Drivers == null) return cars;
            foreach (var d in di.Drivers)
            {
                if (d == null || string.IsNullOrEmpty(d.CarPath) || d.CarIsPaceCar != 0) continue;
                if (d.IsSpectator != 0 && d.CarIdx != di.DriverCarIdx) continue;
                // Sanitize quotes free text whole, so a name iRacing wrote with a space after it still has it.
                cars.Add(new DriverCar
                {
                    CarIdx = d.CarIdx,
                    CarPath = d.CarPath.Trim(),
                    CarScreenName = d.CarScreenName?.Trim(),
                    CarScreenNameShort = d.CarScreenNameShort?.Trim(),
                    CarID = d.CarID,
                });
            }
            return cars;
        }

        /// <summary>
        /// The same list as <see cref="DriverCars"/>, read straight from the text. Building the typed model
        /// costs tens of milliseconds a file; a pass over a whole .ibt history only wants these few lines.
        /// </summary>
        public static List<DriverCar> ParseDriverCars(string yaml)
        {
            var cars = new List<DriverCar>();
            if (string.IsNullOrEmpty(yaml)) return cars;

            // 0: before DriverInfo, 1: inside it, 2: inside its Drivers list.
            int state = 0, listIndent = 0, itemIndent = -1, ownCarIdx = -1;
            DriverEntry entry = null;

            int pos = 0;
            while (pos < yaml.Length)
            {
                int end = yaml.IndexOf('\n', pos);
                if (end < 0) end = yaml.Length;
                int start = pos;
                pos = end + 1;
                if (end > start && yaml[end - 1] == '\r') end--;

                int indent = 0;
                while (start + indent < end && yaml[start + indent] == ' ') indent++;
                if (start + indent >= end) continue; // blank

                if (indent == 0)
                {
                    // A top-level key: DriverInfo begins here, or whatever we were in has ended.
                    if (state != 0) break;
                    if (string.CompareOrdinal(yaml, start, "DriverInfo:", 0, 11) == 0) state = 1;
                    continue;
                }
                if (state == 0) continue;

                int text = start + indent;
                bool item = end - text >= 2 && yaml[text] == '-' && yaml[text + 1] == ' ';
                if (state == 1)
                {
                    if (!Field(yaml, text, end, out string key, out string value)) continue;
                    if (key == "DriverCarIdx") ownCarIdx = Int(value, -1);
                    else if (key == "Drivers") { state = 2; listIndent = indent; }
                    continue;
                }

                if (item && (itemIndent < 0 || indent == itemIndent))
                {
                    if (indent < listIndent) break;
                    Add(cars, entry, ownCarIdx);
                    entry = new DriverEntry();
                    itemIndent = indent;
                    text += 2;
                    while (text < end && yaml[text] == ' ') text++;
                }
                else if (indent <= Math.Max(listIndent, itemIndent))
                {
                    break; // a sibling of Drivers: the list is over
                }
                else if (indent != itemIndent + 2)
                {
                    continue; // something nested inside a driver's entry
                }
                if (entry == null || !Field(yaml, text, end, out string name, out string field)) continue;
                switch (name)
                {
                    case "CarIdx": entry.Car.CarIdx = Int(field, -1); break;
                    case "CarPath": entry.Car.CarPath = field; break;
                    case "CarScreenName": entry.Car.CarScreenName = field; break;
                    case "CarScreenNameShort": entry.Car.CarScreenNameShort = field; break;
                    case "CarID": entry.Car.CarID = Int(field, 0); break;
                    case "CarIsPaceCar": entry.PaceCar = Int(field, 0) != 0; break;
                    case "IsSpectator": entry.Spectator = Int(field, 0) != 0; break;
                }
            }
            Add(cars, entry, ownCarIdx);
            return cars;
        }

        private sealed class DriverEntry
        {
            public readonly DriverCar Car = new DriverCar { CarIdx = -1 };
            public bool PaceCar, Spectator;
        }

        private static void Add(List<DriverCar> cars, DriverEntry entry, int ownCarIdx)
        {
            if (entry == null || string.IsNullOrEmpty(entry.Car.CarPath) || entry.PaceCar) return;
            if (entry.Spectator && entry.Car.CarIdx != ownCarIdx) return;
            cars.Add(entry.Car);
        }

        /// <summary>Splits "Key: value"; the value comes back without the quotes iRacing or Sanitize put round it.</summary>
        private static bool Field(string yaml, int start, int end, out string key, out string value)
        {
            key = value = null;
            int colon = yaml.IndexOf(':', start, end - start);
            if (colon <= start) return false;
            key = yaml.Substring(start, colon - start);
            value = yaml.Substring(colon + 1, end - colon - 1).Trim();
            if (value.Length >= 2 && value[0] == '"' && value[value.Length - 1] == '"')
                value = value.Substring(1, value.Length - 2).Replace("\\\"", "\"");
            else if (value.Length >= 2 && value[0] == '\'' && value[value.Length - 1] == '\'')
                value = value.Substring(1, value.Length - 2).Replace("''", "'");
            return true;
        }

        private static int Int(string value, int fallback) =>
            int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out int n) ? n : fallback;
    }
}
