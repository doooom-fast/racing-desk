using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace RacingDesk.Data.Pedals
{
    /// <summary>
    /// The hash SmartControl keeps in each device's section of a profile: SHA-512, in upper-case hex, of the UTF-8 of the
    /// section's values joined with nothing between them, in a fixed order per pedal — the throttle's bottom deadzone, its
    /// top deadzone, its six curve points; the brake's bottom deadzone, its six curve points, its force; the clutch's like
    /// the throttle's. No id, name or salt goes in. Found from his own profiles: it holds on all 20 sections SmartControl
    /// wrote (Default, Rain, HeavyBrake, super light, F1); only LightBrake, Heusinkveld's own starter profile shipped
    /// inside its library, carries hashes of other values, and loads all the same (scratch rule_check.py, 2026-10-02).
    /// </summary>
    public static class SmartControlHash
    {
        private static readonly string[] Curve =
        {
            "ZeroPercentage", "TwentyPercentage", "FourtyPercentage", "SixtyPercentage", "EightyPercentage", "HundredPercentage",
        };

        /// <summary>The hash of a section (<c>SimPedalsUltimate</c>, …) as SmartControl computes it, from its values as written.</summary>
        public static string Of(XElement section)
        {
            if (section == null) throw new ArgumentNullException(nameof(section));
            var values = new StringBuilder();
            foreach (var pedal in section.Elements())
            {
                if (pedal.Name.LocalName == "Hash") continue;
                values.Append(Text(pedal, "DeadzoneBottomPercentage"));
                if (Child(pedal, "DeadzoneTopPercentage") != null) values.Append(Text(pedal, "DeadzoneTopPercentage"));
                foreach (string point in Curve) values.Append(Text(pedal, point));
                if (Child(pedal, "MaximumCalibratedForceInKilogram") != null) values.Append(Text(pedal, "MaximumCalibratedForceInKilogram"));
            }
            using var sha = SHA512.Create();
            byte[] hash = sha.ComputeHash(Encoding.UTF8.GetBytes(values.ToString()));
            var hex = new StringBuilder(hash.Length * 2);
            foreach (byte b in hash) hex.Append(b.ToString("X2", CultureInfo.InvariantCulture));
            return hex.ToString();
        }

        private static XElement Child(XElement e, string name) => e.Elements().FirstOrDefault(c => c.Name.LocalName == name);
        private static string Text(XElement e, string name) => Child(e, name)?.Value ?? "";
    }

    /// <summary>
    /// A car's own SmartControl profile, made from his base (LightBrake, Default, or the one he chose on the desk) the way
    /// docs/view-and-pedals-plan.md settles it: the base's bytes, with three spans changed and nothing else — the
    /// Ultimate pedals' brake force, that section's hash (by <see cref="SmartControlHash"/>), and the Description where the
    /// base has one (LightBrake, in its older format, has none, and none is added: Racing Desk's rows are known by their
    /// id, not by what they say of themselves). Every other byte, the odd first line that says utf-16 over UTF-8 bytes
    /// included, stays as SmartControl wrote it. An edit that would change anything else, or that does not read back as
    /// what was asked for, is refused with why.
    /// </summary>
    public static class SmartControlProfileEditor
    {
        /// <summary>The section that belongs to the pedals on the rig.</summary>
        public const string Section = SmartControl.Pedals;

        /// <summary>The forces Racing Desk writes: whole kilograms, as SmartControl and Live's keys set them.</summary>
        public const int MinKg = 15, MaxKg = 100;

        private static readonly Regex SectionSpan = new Regex("<" + Section + ">.*?</" + Section + ">", RegexOptions.Singleline | RegexOptions.CultureInvariant);
        private static readonly Regex BrakeSpan = new Regex("<BrakeProfile>.*?</BrakeProfile>", RegexOptions.Singleline | RegexOptions.CultureInvariant);
        private static readonly Regex ForceSpan = new Regex("<MaximumCalibratedForceInKilogram>([^<]*)</MaximumCalibratedForceInKilogram>", RegexOptions.CultureInvariant);
        private static readonly Regex HashSpan = new Regex("<Hash>([^<]*)</Hash>", RegexOptions.CultureInvariant);
        private static readonly Regex DescriptionSpan = new Regex(@"<Description(?:\s[^>]*)?(?:/>|>[^<]*</Description>)", RegexOptions.CultureInvariant);

        /// <summary>The Ultimate pedals' brake force a profile holds, in kg, when it holds one as a number.</summary>
        public static bool TryReadForce(byte[] data, out double kg)
        {
            kg = 0;
            if (!TryText(data, out string text, out _, out _)) return false;
            var section = SectionSpan.Match(text);
            if (!section.Success) return false;
            var brake = BrakeSpan.Match(section.Value);
            if (!brake.Success) return false;
            var force = ForceSpan.Match(brake.Value);
            return force.Success && double.TryParse(force.Groups[1].Value.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out kg)
                && !double.IsNaN(kg) && !double.IsInfinity(kg);
        }

        /// <summary>Whether a profile's Ultimate section's hash is the one its values give.</summary>
        public static bool HashHolds(byte[] data)
        {
            if (!TryText(data, out string text, out _, out _)) return false;
            var section = SectionSpan.Match(text);
            if (!section.Success) return false;
            try
            {
                var parsed = XElement.Parse(section.Value);
                return parsed.Elements().FirstOrDefault(e => e.Name.LocalName == "Hash")?.Value == SmartControlHash.Of(parsed);
            }
            catch (System.Xml.XmlException)
            {
                return false;
            }
        }

        /// <summary>
        /// The base's bytes with the Ultimate brake force set to <paramref name="forceKg"/>, its hash made to match, and
        /// the Description (where the base has one) set to <paramref name="description"/> (null leaves it).
        /// </summary>
        public static bool TryEdit(byte[] baseData, int forceKg, string description, out byte[] edited, out string why)
        {
            edited = null;
            if (forceKg < MinKg || forceKg > MaxKg) { why = $"{forceKg} kg is outside {MinKg}–{MaxKg} kg"; return false; }
            if (!TryText(baseData, out string text, out byte[] bom, out why)) return false;

            var sections = SectionSpan.Matches(text);
            if (sections.Count != 1) { why = sections.Count == 0 ? $"the profile has no {Section} section" : $"the profile has {sections.Count} {Section} sections"; return false; }
            var section = sections[0];

            // The force: in the brake's part of the section, once.
            var brakes = BrakeSpan.Matches(section.Value);
            if (brakes.Count != 1) { why = "the pedals' section has no single brake"; return false; }
            var forces = ForceSpan.Matches(brakes[0].Value);
            if (forces.Count != 1) { why = "the brake has no single force"; return false; }
            var force = forces[0].Groups[1];
            int forceAt = section.Index + brakes[0].Index + force.Index;
            string forceText = forceKg.ToString(CultureInfo.InvariantCulture);
            string withForce = text.Substring(0, forceAt) + forceText + text.Substring(forceAt + force.Length);

            // The hash, from the section as it now is: the first child of the section, once.
            var newSection = SectionSpan.Match(withForce);
            XElement parsed;
            try { parsed = XElement.Parse(newSection.Value); }
            catch (System.Xml.XmlException ex) { why = "the pedals' section is not XML: " + ex.Message; return false; }
            var hashes = HashSpan.Matches(newSection.Value);
            if (hashes.Count != 1 || parsed.Elements().Count(e => e.Name.LocalName == "Hash") != 1) { why = "the pedals' section has no single hash"; return false; }
            string hash = SmartControlHash.Of(parsed);
            var hashGroup = hashes[0].Groups[1];
            int hashAt = newSection.Index + hashGroup.Index;
            string withHash = withForce.Substring(0, hashAt) + hash + withForce.Substring(hashAt + hashGroup.Length);

            // The Description, where there is one and only one, and outside the devices' sections.
            string result = withHash;
            if (description != null)
            {
                var descriptions = DescriptionSpan.Matches(withHash);
                if (descriptions.Count > 1) { why = "the profile has more than one Description"; return false; }
                if (descriptions.Count == 1)
                    result = withHash.Substring(0, descriptions[0].Index) + "<Description>" + Escape(description) + "</Description>"
                        + withHash.Substring(descriptions[0].Index + descriptions[0].Length);
            }

            // Read back: it is XML, the force and the hash are what was asked for, and only the three spans moved.
            if (!ReadsBack(result, forceKg, hash, out why)) return false;
            if (!OnlySpansDiffer(text, result, out why)) return false;
            edited = Concat(bom, Encoding.UTF8.GetBytes(result));
            why = null;
            return true;
        }

        private static bool ReadsBack(string text, int forceKg, string hash, out string why)
        {
            why = null;
            try
            {
                var root = XDocument.Parse(text).Root;
                var section = root?.Elements().FirstOrDefault(e => e.Name.LocalName == Section);
                var brake = section?.Elements().FirstOrDefault(e => e.Name.LocalName == "BrakeProfile");
                string kg = brake?.Elements().FirstOrDefault(e => e.Name.LocalName == "MaximumCalibratedForceInKilogram")?.Value;
                if (kg != forceKg.ToString(CultureInfo.InvariantCulture)) { why = "the force does not read back"; return false; }
                if (section.Elements().First(e => e.Name.LocalName == "Hash").Value != hash || SmartControlHash.Of(section) != hash) { why = "the hash does not read back"; return false; }
                return true;
            }
            catch (System.Xml.XmlException ex)
            {
                why = "the edited profile is not XML: " + ex.Message;
                return false;
            }
        }

        // Outside the three spans the two must be the same text, to the character: blank the spans out of both and compare.
        private static bool OnlySpansDiffer(string before, string after, out string why)
        {
            why = null;
            if (Blank(before) == Blank(after)) return true;
            why = "the edit changed something besides the force, the hash and the Description";
            return false;
        }

        private static string Blank(string text)
        {
            string s = SectionSpan.Replace(text, m =>
            {
                string sec = HashSpan.Replace(m.Value, "<Hash></Hash>", 1);
                return BrakeSpan.Replace(sec, b => ForceSpan.Replace(b.Value, "<MaximumCalibratedForceInKilogram></MaximumCalibratedForceInKilogram>", 1), 1);
            }, 1);
            return DescriptionSpan.Replace(s, "<Description/>", 1);
        }

        private static string Escape(string text) =>
            new XText(text ?? "").ToString().Replace("\r", "&#xD;").Replace("\n", "&#xA;");

        /// <summary>
        /// The bytes as text, and the byte order mark they began with: the bytes must come back the same from the text, or
        /// the profile is not one this edits (a profile that really is UTF-16 is not one SmartControl writes).
        /// </summary>
        private static bool TryText(byte[] data, out string text, out byte[] bom, out string why)
        {
            text = null;
            bom = Array.Empty<byte>();
            why = null;
            if (data == null || data.Length == 0) { why = "the profile is empty"; return false; }
            int skip = data.Length >= 3 && data[0] == 0xEF && data[1] == 0xBB && data[2] == 0xBF ? 3 : 0;
            bom = skip == 3 ? new byte[] { 0xEF, 0xBB, 0xBF } : Array.Empty<byte>();
            try
            {
                text = new UTF8Encoding(false, throwOnInvalidBytes: true).GetString(data, skip, data.Length - skip);
            }
            catch (DecoderFallbackException)
            {
                why = "the profile is not UTF-8";
                return false;
            }
            byte[] again = Encoding.UTF8.GetBytes(text);
            if (again.Length != data.Length - skip || !again.AsSpan().SequenceEqual(data.AsSpan(skip)))
            {
                why = "the profile does not come back the same from its text";
                return false;
            }
            return true;
        }

        private static byte[] Concat(byte[] a, byte[] b)
        {
            var all = new byte[a.Length + b.Length];
            Buffer.BlockCopy(a, 0, all, 0, a.Length);
            Buffer.BlockCopy(b, 0, all, a.Length, b.Length);
            return all;
        }

        /// <summary>The words a car's profile says of itself, where its base has a Description.</summary>
        public static string DescriptionFor(string carName, string baseName) =>
            $"Made by Racing Desk for {carName} from {baseName}. Racing Desk keeps the force you set with your keys here.";

        /// <summary>His profiles' names, for a name that must not be one of them.</summary>
        public static string UniqueName(string wanted, IEnumerable<string> taken)
        {
            var names = new HashSet<string>((taken ?? Enumerable.Empty<string>()).Where(n => n != null).Select(n => n.Trim()), StringComparer.OrdinalIgnoreCase);
            string name = (wanted ?? "").Trim();
            if (name.Length == 0) name = "Racing Desk car";
            if (!names.Contains(name)) return name;
            string marked = name + " (Racing Desk)";
            for (int i = 2; names.Contains(marked); i++) marked = $"{name} (Racing Desk {i})";
            return marked;
        }
    }
}
