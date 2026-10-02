using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Text;
using Newtonsoft.Json.Linq;
using RacingDesk.Plugin;

namespace RacingDesk.Core.Names
{
    /// <summary>One name another driver may be shown under: a character's, or a band member's (packages/pseudonyms).</summary>
    public sealed class Pseudonym
    {
        public Pseudonym(string name, string shown, string from, bool nickname)
        {
            Name = name;
            Shown = shown;
            From = from;
            Nickname = nickname;
        }

        /// <summary>The name as the work gives it: "Hal Incandenza", "Sick Boy".</summary>
        public string Name { get; }
        /// <summary>The name as the HUD shows it: "H. Incandenza", "Sick Boy" (<see cref="PseudonymList.ShownForm"/>).</summary>
        public string Shown { get; }
        /// <summary>The work or band it is from: a source id of the list.</summary>
        public string From { get; }
        /// <summary>A character known by a nickname alone, shown whole.</summary>
        public bool Nickname { get; }
    }

    /// <summary>
    /// The list of names other drivers are shown under, read once from the assembly (<c>packages/pseudonyms/names.json</c>,
    /// embedded at build time). Both forms of every name are unique across the list. The file's order and length do not
    /// decide who gets which name (<see cref="PseudonymBook.Rank"/> scores each name by itself), so names may be added or
    /// the file re-sorted: only a driver who prefers an added name to the one they had is renamed.
    /// </summary>
    public sealed class PseudonymList
    {
        public const string ResourceName = "RacingDesk.Core.Names.names.json";

        public static readonly PseudonymList Empty =
            new PseudonymList(0, new List<Pseudonym>(), new Dictionary<string, string>(), new List<string>());

        private static readonly Lazy<PseudonymList> Loaded = new Lazy<PseudonymList>(LoadEmbedded);

        /// <summary>The list the assembly carries; <see cref="Empty"/> in a tree without the file.</summary>
        public static PseudonymList Default => Loaded.Value;

        private readonly HashSet<string> _shown;
        private readonly HashSet<string> _names;

        private PseudonymList(int version, List<Pseudonym> entries, Dictionary<string, string> sources, List<string> problems)
        {
            Version = version;
            Entries = entries;
            Sources = sources;
            Problems = problems;
            _shown = new HashSet<string>(StringComparer.Ordinal);
            _names = new HashSet<string>(StringComparer.Ordinal);
            foreach (var e in entries)
            {
                _shown.Add(e.Shown);
                _names.Add(e.Name);
            }
        }

        public int Version { get; }
        /// <summary>Every name, in the file's order.</summary>
        public IReadOnlyList<Pseudonym> Entries { get; }
        /// <summary>Source id to title, as the file's <c>sources</c> give them.</summary>
        public IReadOnlyDictionary<string, string> Sources { get; }
        /// <summary>What was wrong with the file, one line each; empty for a file as it should be.</summary>
        public IReadOnlyList<string> Problems { get; }
        public int Count => Entries.Count;
        public bool IsEmpty => Entries.Count == 0;

        /// <summary>Whether this is one of the list's names as shown ("H. Incandenza", "Sick Boy").</summary>
        public bool ContainsShown(string shown) => shown != null && _shown.Contains(shown.Trim());

        /// <summary>Whether this is one of the list's names, in either form.</summary>
        public bool Contains(string nameOrShown)
        {
            if (nameOrShown == null) return false;
            string s = nameOrShown.Trim();
            return _shown.Contains(s) || _names.Contains(s);
        }

        /// <summary>
        /// The HUD's style for a name: the first initial, a dot, and the surname with any lowercase particle before it
        /// ("Hal Incandenza" → "H. Incandenza", "Joelle van Dyne" → "J. van Dyne", "Maynard James Keenan" → "M. Keenan").
        /// A single word and a nickname are shown whole.
        /// </summary>
        public static string ShownForm(string name, bool nickname)
        {
            if (name == null) return "";
            string trimmed = name.Trim();
            if (nickname || trimmed.Length == 0) return trimmed;
            var words = trimmed.Split(new[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
            if (words.Length <= 1) return trimmed;
            string last = words[words.Length - 1];
            for (int i = words.Length - 2; i >= 1 && char.IsLower(words[i][0]); i--)
                last = words[i] + " " + last;
            return char.ToUpperInvariant(words[0][0]) + ". " + last;
        }

        /// <summary>Reads the list from its JSON. A file with problems still yields the names it does have.</summary>
        public static PseudonymList Parse(string json)
        {
            var problems = new List<string>();
            var entries = new List<Pseudonym>();
            var sources = new Dictionary<string, string>(StringComparer.Ordinal);
            if (string.IsNullOrWhiteSpace(json)) return Empty;

            JObject root;
            try { root = JToken.Parse(json) as JObject; }
            catch (Exception ex)
            {
                problems.Add("the list is not JSON: " + ex.Message);
                return new PseudonymList(0, entries, sources, problems);
            }
            if (root == null)
            {
                problems.Add("the list is not an object");
                return new PseudonymList(0, entries, sources, problems);
            }

            int version = root["version"] != null && root["version"].Type == JTokenType.Integer ? (int)root["version"] : 0;
            if (root["sources"] is JArray srcs)
                foreach (var s in srcs)
                    if (s is JObject so && so["id"] != null && so["id"].Type == JTokenType.String)
                        sources[(string)so["id"]] = so["title"] != null && so["title"].Type == JTokenType.String ? (string)so["title"] : (string)so["id"];

            if (!(root["names"] is JArray list))
            {
                problems.Add("the list has no names");
                return new PseudonymList(version, entries, sources, problems);
            }

            var seenNames = new HashSet<string>(StringComparer.Ordinal);
            var seenShown = new HashSet<string>(StringComparer.Ordinal);
            int index = -1;
            foreach (var token in list)
            {
                index++;
                if (!(token is JObject o) || o["name"] == null || o["name"].Type != JTokenType.String)
                {
                    problems.Add($"entry {index} has no name");
                    continue;
                }
                string name = ((string)o["name"]).Trim();
                if (name.Length == 0) { problems.Add($"entry {index} has an empty name"); continue; }
                bool nickname = o["nickname"] != null && o["nickname"].Type == JTokenType.Boolean && (bool)o["nickname"];
                string shown = o["shown"] != null && o["shown"].Type == JTokenType.String && !string.IsNullOrWhiteSpace((string)o["shown"])
                    ? ((string)o["shown"]).Trim()
                    : ShownForm(name, nickname);
                string from = o["from"] != null && o["from"].Type == JTokenType.String ? (string)o["from"] : null;
                if (from == null || !sources.ContainsKey(from)) problems.Add($"{name}: its source '{from ?? "(none)"}' is not one of the list's");
                if (!seenNames.Add(name)) { problems.Add($"{name}: listed twice"); continue; }
                if (!seenShown.Add(shown)) { problems.Add($"{name}: shown as '{shown}', which another name already is"); continue; }
                entries.Add(new Pseudonym(name, shown, from ?? "", nickname));
            }
            return new PseudonymList(version, entries, sources, problems);
        }

        private static PseudonymList LoadEmbedded()
        {
            try
            {
                using (var stream = typeof(PseudonymList).GetTypeInfo().Assembly.GetManifestResourceStream(ResourceName))
                {
                    if (stream == null)
                    {
                        Log.Warn("[RacingDesk] names: the assembly carries no list; other drivers are shown as Driver and a number");
                        return Empty;
                    }
                    using (var reader = new StreamReader(stream, Encoding.UTF8))
                    {
                        var list = Parse(reader.ReadToEnd());
                        foreach (string problem in list.Problems) Log.Warn("[RacingDesk] names: " + problem);
                        return list;
                    }
                }
            }
            catch (Exception ex)
            {
                Log.Warn("[RacingDesk] names: the list was not read — " + ex.Message);
                return Empty;
            }
        }
    }
}
