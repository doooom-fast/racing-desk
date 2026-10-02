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
            Assert.That(list.Count, Is.GreaterThanOrEqualTo(240), "the works and the bands give some 250 names");
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
            foreach (string nick in new[] { "Sick Boy", "Spud", "Begbie", "Second Prize", "Seeker", "Sick Puppy" })
            {
                var e = list.Entries.Single(x => x.Name == nick);
                Assert.That(e.Nickname, Is.True, nick);
                Assert.That(e.Shown, Is.EqualTo(nick));
            }
            Assert.That(list.Entries.Single(x => x.Name == "J.D. Steelritter").Shown, Is.EqualTo("J.D. Steelritter"));
            Assert.That(list.Entries.Single(x => x.Name == "Mark Renton").Shown, Is.EqualTo("M. Renton"));
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
