using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using NUnit.Framework;
using RacingDesk.Core.Names;

namespace RacingDesk.Tests.Names
{
    /// <summary>
    /// No fixture, test or demo names a real driver. Every string in the repo's tests, fixtures and sources that is shaped
    /// like a driver's name — an initial, a dot and a surname in quotes, a YAML driver field, a JSON or JS value under a name
    /// key — must be a name from the list of characters, or one of the few made-up names the tests use (listed here, so that
    /// a new one is noticed).
    /// No real name is written here to be refused: the rule is an allowlist, which a real name cannot be on.
    /// </summary>
    [TestFixture]
    public class NoRealNamesInFixturesTests
    {
        private static readonly string[] Roots =
        {
            "apps/overlay/tests", "apps/overlay/modules", "apps/overlay/dashboard.html", "apps/overlay/desk.html", "apps/overlay/main.js",
            "apps/overlay/remote-server.js", "apps/plugin/racing-desk-plugin/simhub-plugin/tests", "apps/plugin/racing-desk-plugin/simhub-plugin/plugin",
            "apps/core", "apps/host", "packages/replay", "packages/pseudonyms", "apps/edit", "CLAUDE.md",
        };

        // The commentary's data (racingdesk-data) speaks of the famous drivers of real cars on purpose, and is not a fixture.
        private static readonly Regex Skip = new Regex(@"(^|[\\/])(node_modules|bin|obj|build|dist|racingdesk-data|\.worktrees)([\\/]|$)|-snapshots", RegexOptions.Compiled);
        private static readonly HashSet<string> Extensions = new HashSet<string>(new[] { ".cs", ".mjs", ".js", ".json", ".html", ".md", ".yaml", ".yml" }, StringComparer.OrdinalIgnoreCase);

        private static readonly Regex[] Shapes =
        {
            // "H. Incandenza", 'J. van Dyne', "J.D. Steelritter"
            new Regex(@"[""']([A-Z]\.(?:[A-Z]\.)? (?:[a-z]+ )*[A-Z][A-Za-z'\-]+)[""']", RegexOptions.Compiled),
            // A session YAML's driver fields, in a test's text
            new Regex(@"^\s*(?:- )?(?:UserName|AbbrevName|TeamName|DriverName): *(.+?)\s*$", RegexOptions.Compiled | RegexOptions.Multiline),
            // A payload's name keys, in JSON or JS
            new Regex(@"(?:UserName|DriverName|DriverAhead|DriverBehind|Opponent_Ahead_Name|Opponent_Behind_Name|TeamName)[""']\s*:\s*[""']([^""']*)[""']", RegexOptions.Compiled),
        };

        /// <summary>The tests' own made-up names: nobody's. A new one goes here, and nowhere else.</summary>
        private static HashSet<string> Allowed()
        {
            var allowed = new HashSet<string>(StringComparer.Ordinal)
            {
                "Test Driver", "Pace Car", "YOU", "O'Brien: Racing #1", "Team: \"\"Fast\"\"", "Team: \"Fast\"",
                "A. Alpha", "B. Bravo", "C. Charlie", "D. Delta",
                "A. Fast", "B. Quick", "C. Swift", "D. Rapid", "E. Slow", "F. Behind", "G. Pitted",
                "Clean Driver", "Aggressive Driver", "Dangerous Driver", "Defensive Driver", "Rival Driver", "Clean Opponent",
                "Caution Driver", "Track Specialist", "Rising Star",
                "Ann One", "Al One", "Bo Two", "Cy Three", "Dee Four", "A. One", "B. Two", "C. Three",
                "Zebedee Quorntalk", "Somebody Else", "Somebody New", "Nowhere Motorsport",
            };
            foreach (var r in SyntheticField.Rivals)
            {
                allowed.Add(r.Name);
                allowed.Add(r.Shortened);
                allowed.Add(r.Name + " Racing");
            }
            return allowed;
        }

        private static string RepoRoot()
        {
            for (var dir = new DirectoryInfo(TestContext.CurrentContext.TestDirectory); dir != null; dir = dir.Parent)
                if (File.Exists(Path.Combine(dir.FullName, "racing-desk.sln"))) return dir.FullName;
            throw new InvalidOperationException("racing-desk.sln not found above the test directory");
        }

        private static IEnumerable<string> Files(string root)
        {
            foreach (string r in Roots)
            {
                string p = Path.Combine(root, r.Replace('/', Path.DirectorySeparatorChar));
                if (File.Exists(p)) { yield return p; continue; }
                if (!Directory.Exists(p)) continue;
                foreach (string f in Directory.EnumerateFiles(p, "*", SearchOption.AllDirectories))
                {
                    if (Skip.IsMatch(f.Substring(root.Length))) continue;
                    if (Extensions.Contains(Path.GetExtension(f))) yield return f;
                }
            }
        }

        [Test]
        public void EveryDriverShapedStringInTheTestsAndFixturesIsACharacterOrOneOfTheTestsOwn()
        {
            string root = RepoRoot();
            var list = PseudonymList.Default;
            var allowed = Allowed();
            var offenders = new SortedDictionary<string, SortedSet<string>>(StringComparer.Ordinal);
            int files = 0;
            foreach (string file in Files(root))
            {
                files++;
                string text = File.ReadAllText(file);
                foreach (var shape in Shapes)
                    foreach (Match m in shape.Matches(text))
                    {
                        string value = m.Groups[1].Value.Trim();
                        if (value.Length == 0 || list.Contains(value) || allowed.Contains(value)) continue;
                        if (!offenders.TryGetValue(value, out var where)) offenders[value] = where = new SortedSet<string>(StringComparer.Ordinal);
                        where.Add(file.Substring(root.Length + 1).Replace('\\', '/'));
                    }
            }
            Assert.That(files, Is.GreaterThan(100), "the scan found the repo");
            Assert.That(offenders, Is.Empty,
                "names that are neither a character's nor one of the tests' own made-up names:\n" +
                string.Join("\n", offenders.Select(o => $"  \"{o.Key}\" in {string.Join(", ", o.Value)}")));
        }

        [Test]
        public void TheAllowlistIsOfNobody()
        {
            // The made-up names are made up: none is on the list of real characters and band members, and none is a real person's
            // by construction (invented surnames, NATO letters, roles). This holds the two sets apart so neither leaks into the other.
            var list = PseudonymList.Default;
            foreach (string name in Allowed())
                Assert.That(list.Contains(name), Is.False, name + " is both a character and a test's placeholder");
        }
    }
}
