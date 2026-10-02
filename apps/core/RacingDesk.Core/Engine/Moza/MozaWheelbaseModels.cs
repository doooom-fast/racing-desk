using System.Collections.Generic;
using System.Globalization;
using System.Text.RegularExpressions;

namespace RacingDesk.Plugin.Engine.Moza
{
    /// <summary>
    /// What the name of a MOZA wheel base says of it: which model it is (from the USB description or from the device
    /// name Pit House keeps) and the peak torque that model is rated for, so that a maximum-torque setting in per cent
    /// is a number of Nm. Nothing is guessed for a model not in the table: its rating is not known, and the HUD shows a
    /// dash rather than a made-up number.
    /// </summary>
    public static class MozaWheelbaseModels
    {
        // "Gudsen MOZA R9 Base", "MOZA R12 Ultra Base", "MOZA Racing R21 Base", "R21 Ultra".
        private static readonly Regex ModelPattern = new Regex(@"\bR(\d{1,2})(\s+Ultra)?\b",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

        // The rated peak torque, in Nm, by the number in the model's name. The R5 is the one whose name is not its
        // rating. Only the models the plugin's registry recognises, and the R25.
        private static readonly Dictionary<int, double> RatedByNumber = new Dictionary<int, double>
        {
            { 5, 5.5 }, { 9, 9 }, { 12, 12 }, { 16, 16 }, { 21, 21 }, { 25, 25 },
        };

        /// <summary>The model a description names ("R21", "R12 Ultra"), or "" where it names none.</summary>
        public static string ModelFrom(string description)
        {
            if (string.IsNullOrEmpty(description)) return "";
            var m = ModelPattern.Match(description);
            if (!m.Success) return "";
            return "R" + m.Groups[1].Value + (m.Groups[2].Success ? " Ultra" : "");
        }

        /// <summary>The model's rated peak torque in Nm, or null where the model is not one in the table.</summary>
        public static double? RatedNm(string model)
        {
            string named = ModelFrom(model);
            if (named.Length == 0) return null;
            int number = int.Parse(Regex.Match(named, @"\d+").Value, CultureInfo.InvariantCulture);
            return RatedByNumber.TryGetValue(number, out double nm) ? nm : (double?)null;
        }
    }

    /// <summary>
    /// What the wheel base itself said, the last time the poll that runs whenever Pit House lets go of its ports read
    /// it: the model its USB description names ("" where it names none) and its maximum-torque setting in per cent.
    /// </summary>
    public sealed class WheelbaseReading
    {
        public WheelbaseReading(string model, int maxTorquePercent)
        {
            Model = model ?? "";
            MaxTorquePercent = maxTorquePercent;
        }

        public string Model { get; }

        /// <summary>The base's max-torque setting, 0 to 100 (of the model's rated peak).</summary>
        public int MaxTorquePercent { get; }
    }
}
