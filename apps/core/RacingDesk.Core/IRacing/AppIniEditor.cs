using System;
using System.Globalization;
using System.Text;

namespace RacingDesk.Plugin.IRacing
{
    /// <summary>
    /// One value of iRacing's <c>app.ini</c> read or changed, and nothing else of the file. The sim writes each value with
    /// six decimals, padded with spaces to a column, then a tab and a comment:
    /// <c>driverHeightAdj=-0.020000               \t; Range -0.050m to 0.050m</c>. A change puts the new number where the
    /// old one was and pads it to the same width, so the line, and every other byte of the file, is as it was; a number
    /// that would not fit is refused rather than moving the comment. The file is plain ASCII with Windows line ends, and
    /// is handled as bytes (Latin-1 maps each byte to one character and back), so nothing is re-encoded.
    ///
    /// The value must be in the section named, once: a key that is not there, or is there twice (somebody's edit), is
    /// refused, with why. This is the only way Racing Desk changes the file (docs/view-and-pedals-plan.md): the driver
    /// height, put back to the starting height every car launches with, while the sim is closed.
    /// </summary>
    public static class AppIniEditor
    {
        private static readonly Encoding Bytes = Encoding.GetEncoding(28591);   // Latin-1: one byte, one character

        /// <summary>A value as the sim writes it: six decimals, a point whatever the locale, no "-0".</summary>
        public static string Format(double value)
        {
            double rounded = Math.Round(value, 6, MidpointRounding.AwayFromZero);
            if (Math.Abs(rounded) < 5e-7) rounded = 0;
            return rounded.ToString("0.000000", CultureInfo.InvariantCulture);
        }

        /// <summary>The value of <paramref name="key"/> in <paramref name="section"/>, when it is there once and is a number.</summary>
        public static bool TryReadValue(byte[] file, string section, string key, out double value)
        {
            value = 0;
            if (!TryFind(file, section, key, out var spot, out _)) return false;
            string text = Bytes.GetString(file, spot.ValueStart, spot.ValueEnd - spot.ValueStart).Trim();
            return double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out value)
                && !double.IsNaN(value) && !double.IsInfinity(value);
        }

        /// <summary>
        /// A copy of the file with <paramref name="key"/> in <paramref name="section"/> set to <paramref name="value"/>, in
        /// the width the old value had. False, with why, when the key is not there exactly once or the number would not fit.
        /// </summary>
        public static bool TrySetValue(byte[] file, string section, string key, double value, out byte[] edited, out string why)
        {
            edited = null;
            if (double.IsNaN(value) || double.IsInfinity(value)) { why = "the value is not a number"; return false; }
            if (!TryFind(file, section, key, out var spot, out why)) return false;

            int width = spot.ValueEnd - spot.ValueStart;
            string number = Format(value);
            if (number.Length > width)
            {
                why = $"{number} is wider than the {width} characters the value has on its line";
                return false;
            }
            byte[] padded = Bytes.GetBytes(number.PadRight(width, ' '));
            var copy = (byte[])file.Clone();
            Buffer.BlockCopy(padded, 0, copy, spot.ValueStart, width);
            for (int i = 0; i < copy.Length; i++)
                if (copy[i] != file[i] && (i < spot.ValueStart || i >= spot.ValueEnd)) { why = "the edit reached past the value"; return false; }
            edited = copy;
            why = null;
            return true;
        }

        /// <summary>
        /// The value of <paramref name="key"/> as the file spells it (trimmed of its padding), when it is in <paramref name="section"/>
        /// once: for a switch such as <c>LFEEnabled=1</c>, which the sim writes as a whole number and not with six decimals.
        /// </summary>
        public static bool TryReadText(byte[] file, string section, string key, out string text)
        {
            text = null;
            if (!TryFind(file, section, key, out var spot, out _)) return false;
            text = Bytes.GetString(file, spot.ValueStart, spot.ValueEnd - spot.ValueStart).Trim();
            return text.Length > 0;
        }

        /// <summary>
        /// A copy of the file with <paramref name="key"/> in <paramref name="section"/> spelled <paramref name="text"/> and nothing
        /// else changed: the value goes where the old one was and is padded to the same width, so the line keeps its form (<c>1</c>
        /// stays a whole number, the tab and the comment stay where they are). A word that would not fit, or that has a tab, a
        /// semicolon, an equals sign or a line break in it, is refused.
        /// </summary>
        public static bool TrySetText(byte[] file, string section, string key, string text, out byte[] edited, out string why)
        {
            edited = null;
            if (string.IsNullOrWhiteSpace(text) || text.IndexOfAny(new[] { '\t', ';', '=', '\r', '\n', '[', ']' }) >= 0) { why = "the value is not one that fits on a line of the file"; return false; }
            if (!TryFind(file, section, key, out var spot, out why)) return false;
            text = text.Trim();
            int width = spot.ValueEnd - spot.ValueStart;
            if (text.Length > width) { why = $"{text} is wider than the {width} characters the value has on its line"; return false; }
            byte[] padded = Bytes.GetBytes(text.PadRight(width, ' '));
            var copy = (byte[])file.Clone();
            Buffer.BlockCopy(padded, 0, copy, spot.ValueStart, width);
            for (int i = 0; i < copy.Length; i++)
                if (copy[i] != file[i] && (i < spot.ValueStart || i >= spot.ValueEnd)) { why = "the edit reached past the value"; return false; }
            edited = copy;
            why = null;
            return true;
        }

        private struct Spot
        {
            public int ValueStart, ValueEnd;   // the value and the spaces padding it, up to the tab, the comment or the line's end
        }

        private static bool TryFind(byte[] file, string section, string key, out Spot spot, out string why)
        {
            spot = default;
            why = null;
            if (file == null || file.Length == 0) { why = "the file is empty"; return false; }
            if (string.IsNullOrWhiteSpace(section) || string.IsNullOrWhiteSpace(key)) { why = "no section or key"; return false; }
            // Only what a byte can be read as: a file with anything outside ASCII lines is still read, by byte.
            string text = Bytes.GetString(file);
            string header = "[" + section.Trim() + "]";
            bool inSection = false;
            int found = 0;
            int pos = 0;
            while (pos < text.Length)
            {
                int end = text.IndexOf('\n', pos);
                if (end < 0) end = text.Length;
                int lineEnd = end > pos && text[end - 1] == '\r' ? end - 1 : end;
                string line = text.Substring(pos, lineEnd - pos);
                string trimmed = line.TrimStart();
                if (trimmed.StartsWith("[", StringComparison.Ordinal))
                {
                    // iRacing writes each section once; a second of the same name is read as the same section, as ViewSettings does.
                    inSection = trimmed.StartsWith(header, StringComparison.OrdinalIgnoreCase);
                }
                else if (inSection && trimmed.Length > 0 && trimmed[0] != ';')
                {
                    int equals = line.IndexOf('=');
                    if (equals > 0 && string.Equals(line.Substring(0, equals).Trim(), key.Trim(), StringComparison.OrdinalIgnoreCase))
                    {
                        found++;
                        int start = pos + equals + 1;
                        int stop = start;
                        // The value runs to the tab before the comment, or to the comment, or to the line's end.
                        while (stop < lineEnd && text[stop] != '\t' && text[stop] != ';') stop++;
                        spot = new Spot { ValueStart = start, ValueEnd = stop };
                    }
                }
                pos = end + 1;
            }
            if (found == 0) { why = $"{key} is not in [{section}]"; return false; }
            if (found > 1) { why = $"{key} is in [{section}] {found} times, and which one the sim reads is not known"; return false; }
            if (spot.ValueEnd <= spot.ValueStart) { why = $"{key} has no value to change"; return false; }
            return true;
        }
    }
}
