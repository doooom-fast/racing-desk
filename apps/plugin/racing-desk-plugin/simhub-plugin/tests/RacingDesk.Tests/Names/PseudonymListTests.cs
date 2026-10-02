using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using RacingDesk.Core.Names;

namespace RacingDesk.Tests.Names
{
    /// <summary>
    /// The list of names other drivers are shown under (packages/pseudonyms/names.json, embedded in RacingDesk.Core): real
    /// names from the works and bands asked for, each with its source, unique in both forms, in the HUD's style.
    /// </summary>
    [TestFixture]
    public class PseudonymListTests
    {
        [Test]
        public void TheAssemblyCarriesTheListWholeAndWithoutProblems()
        {
            var list = PseudonymList.Default;
            Assert.That(list.IsEmpty, Is.False, "the list is embedded at build time from packages/pseudonyms/names.json");
            Assert.That(list.Problems, Is.Empty, string.Join("\n", list.Problems));
            Assert.That(list.Count, Is.GreaterThanOrEqualTo(330), "the works and the bands give some 330 names: the fewer there are, the more first choices clash");
            Assert.That(list.Version, Is.EqualTo(1));
        }

        [Test]
        public void EveryNameHasOneOfTheSourcesAskedFor()
        {
            var list = PseudonymList.Default;
            var asked = new[]
            {
                "infinite-jest", "broom-of-the-system", "pale-king", "girl-with-curious-hair", "brief-interviews", "oblivion",
                "trainspotting", "sunn-o", "black-sabbath", "type-o-negative", "tool", "the-cure",
            };
            Assert.That(list.Sources.Keys, Is.EquivalentTo(asked), "the sources are the works and bands he named, no more");
            foreach (var e in list.Entries) Assert.That(asked, Does.Contain(e.From), e.Name);
            foreach (string source in asked)
                Assert.That(list.Entries.Count(e => e.From == source), Is.GreaterThan(0), source + " gives no names");
            // The bands, whole: their line-ups are short and known.
            Assert.That(list.Entries.Where(e => e.From == "type-o-negative").Select(e => e.Name),
                Is.EquivalentTo(new[] { "Peter Steele", "Kenny Hickey", "Josh Silver", "Johnny Kelly", "Sal Abruscato" }));
            Assert.That(list.Entries.Where(e => e.From == "tool").Select(e => e.Name),
                Is.EquivalentTo(new[] { "Maynard James Keenan", "Adam Jones", "Danny Carey", "Justin Chancellor", "Paul D'Amour" }));
        }

        [Test]
        public void BothFormsOfEveryNameAreUnique()
        {
            var list = PseudonymList.Default;
            Assert.That(list.Entries.Select(e => e.Name).Distinct(StringComparer.OrdinalIgnoreCase).Count(), Is.EqualTo(list.Count));
            Assert.That(list.Entries.Select(e => e.Shown).Distinct(StringComparer.OrdinalIgnoreCase).Count(), Is.EqualTo(list.Count),
                "two characters shortened to the same name would be one name on the HUD");
            foreach (var e in list.Entries)
            {
                Assert.That(list.Contains(e.Name), Is.True);
                Assert.That(list.ContainsShown(e.Shown), Is.True);
            }
        }

        [TestCase("Hal Incandenza", false, "H. Incandenza")]
        [TestCase("Joelle van Dyne", false, "J. van Dyne")]
        [TestCase("Ruth van Cleve", false, "R. van Cleve")]
        [TestCase("Aubrey deLint", false, "A. deLint")]
        [TestCase("Maynard James Keenan", false, "M. Keenan")]
        [TestCase("Ronnie James Dio", false, "R. Dio")]
        [TestCase("Drew-Lynn Eberhardt", false, "D. Eberhardt")]
        [TestCase("Stephen O'Malley", false, "S. O'Malley")]
        [TestCase("Lyle", false, "Lyle")]
        [TestCase("Sick Boy", true, "Sick Boy")]
        [TestCase("Second Prize", true, "Second Prize")]
        [TestCase("  Don  Gately ", false, "D. Gately")]
        [TestCase("", false, "")]
        public void TheShownFormIsTheHudsStyle(string name, bool nickname, string expected)
        {
            Assert.That(PseudonymList.ShownForm(name, nickname), Is.EqualTo(expected));
        }

        [Test]
        public void NicknamesAreShownWholeAndAnEntryMaySayItsOwnShownForm()
        {
            var list = PseudonymList.Default;
            foreach (string nick in new[] { "Sick Boy", "Spud", "Begbie", "Second Prize", "Seeker", "Sick Puppy", "Bob Death" })
            {
                var e = list.Entries.Single(x => x.Name == nick);
                Assert.That(e.Nickname, Is.True, nick);
                Assert.That(e.Shown, Is.EqualTo(nick));
            }
            Assert.That(list.Entries.Single(x => x.Name == "J.D. Steelritter").Shown, Is.EqualTo("J.D. Steelritter"));
            Assert.That(list.Entries.Single(x => x.Name == "Mark Renton").Shown, Is.EqualTo("M. Renton"));
            // A full first and last name is shown in the HUD's style, with no override of its own.
            Assert.That(list.Entries.Single(x => x.Name == "Sissee Nar").Shown, Is.EqualTo("S. Nar"));
            Assert.That(list.Entries.Single(x => x.Name == "MerriEloise Prout").Shown, Is.EqualTo("M. Prout"));
            Assert.That(list.Entries.Single(x => x.Name == "Colin van der Hingle").Shown, Is.EqualTo("C. van der Hingle"));
        }

        [Test]
        public void OnlyANameThatIsNotInTheHudsStyleSaysItsOwnShownForm()
        {
            // The shown form is the rule's, so an entry that overrides it needs a reason: here, a first name that is initials.
            var raw = Newtonsoft.Json.Linq.JObject.Parse(System.IO.File.ReadAllText(System.IO.Path.Combine(RepoRoot(), "packages", "pseudonyms", "names.json")));
            var overridden = raw["names"]!.Where(n => n["shown"] != null).Select(n => (string)n["name"]!).ToList();
            Assert.That(overridden, Is.EquivalentTo(new[] { "J.D. Steelritter" }));
        }

        [Test]
        public void TheBandsAreTheirMembersAndNoOneWhoOnlyPlayedWithThem()
        {
            var list = PseudonymList.Default;
            Assert.That(list.Entries.Where(e => e.From == "sunn-o").Select(e => e.Name),
                Is.EquivalentTo(new[] { "Stephen O'Malley", "Greg Anderson", "Joe Preston", "Attila Csihar", "Daniel O'Sullivan", "Stuart Dahlquist" }),
                "Sunn O)))'s members past and present, as its article lists them");
            // Collaborators, session players and touring players of Sunn O))) and Black Sabbath are not members.
            var notMembers = new[]
            {
                "Tos Nieuwenhuizen", "Steve Moore", "Tim Midyett", "Oren Ambarchi", "Rex Ritter",
                "Bob Daisley", "Laurence Cottle", "Jo Burt", "Terry Chimes", "Adam Wakeman", "Tommy Clufetos",
            };
            foreach (string name in notMembers) Assert.That(list.Contains(name), Is.False, name + " is a guest, session or touring player, not a member");
            Assert.That(list.Sources["black-sabbath"], Is.EqualTo("Black Sabbath"));
            var raw = Newtonsoft.Json.Linq.JObject.Parse(System.IO.File.ReadAllText(System.IO.Path.Combine(RepoRoot(), "packages", "pseudonyms", "names.json")));
            Assert.That(raw["sources"]!.Single(x => (string)x["id"]! == "black-sabbath")["kind"]!.ToString(), Does.Not.Contain("touring"));
        }

        [Test]
        public void NoNameIsOneOfAPublicFigureOutsideTheWorks()
        {
            // The names the README says were left out because a person publicly known shares them.
            var list = PseudonymList.Default;
            foreach (string name in new[]
            {
                "Hester Thrale", "Andrew Lang", "Johnny Gentle", "Julie Smith", "John Wayne", "Lyndon Johnson", "Alex Trebek", "Pat Sajak",
                "Vivienne Dick", "Neil Hartigan", "Amy Johnson", "Robert Monroe", "Bob Francis", "Robert Atkins", "Eloise Prout",
            })
                Assert.That(list.Contains(name), Is.False, name);
        }

        private static string RepoRoot()
        {
            for (var dir = new System.IO.DirectoryInfo(TestContext.CurrentContext.TestDirectory); dir != null; dir = dir.Parent)
                if (System.IO.File.Exists(System.IO.Path.Combine(dir.FullName, "racing-desk.sln"))) return dir.FullName;
            throw new InvalidOperationException("racing-desk.sln not found above the test directory");
        }

        [Test]
        public void TheDemosRivalsAreOnTheList()
        {
            var list = PseudonymList.Default;
            Assert.That(list.ContainsShown(DemoNames.Ahead), Is.True, DemoNames.Ahead);
            Assert.That(list.ContainsShown(DemoNames.Behind), Is.True, DemoNames.Behind);
            foreach (string name in DemoNames.Field) Assert.That(list.ContainsShown(name), Is.True, name);
            var all = DemoNames.Field.Concat(new[] { DemoNames.Ahead, DemoNames.Behind }).ToList();
            Assert.That(all.Distinct().Count(), Is.EqualTo(all.Count), "the demo's rows are distinct people");
        }

        [Test]
        public void AFileWithProblemsStillGivesTheNamesItHas()
        {
            var list = PseudonymList.Parse(@"{ ""version"": 1, ""sources"": [{ ""id"": ""x"", ""title"": ""X"" }],
                ""names"": [ { ""name"": ""Ann One"", ""from"": ""x"" }, { ""name"": ""Ann One"", ""from"": ""x"" },
                             { ""name"": ""Al One"", ""from"": ""x"" }, { ""name"": ""Bo Two"", ""from"": ""y"" }, { ""nickname"": true }, 7 ] }");
            Assert.That(list.Entries.Select(e => e.Shown), Is.EqualTo(new[] { "A. One", "B. Two" }),
                "the second Ann is a repeat, Al shortens to the same as Ann, and the last two have no name; Bo's source is wrong but Bo is a name");
            Assert.That(list.Problems, Has.Count.EqualTo(5), string.Join("\n", list.Problems));
            Assert.That(list.Problems.Any(p => p.Contains("Al One") && p.Contains("A. One")), Is.True, string.Join("\n", list.Problems));
            Assert.That(list.Problems.Any(p => p.Contains("Bo Two") && p.Contains("'y'")), Is.True);

            Assert.That(PseudonymList.Parse("").IsEmpty, Is.True);
            Assert.That(PseudonymList.Parse("not json").IsEmpty, Is.True);
            Assert.That(PseudonymList.Parse("[1,2]").Problems, Is.Not.Empty);
            Assert.That(PseudonymList.Parse("{}").Problems, Is.Not.Empty);
        }
    }
}
