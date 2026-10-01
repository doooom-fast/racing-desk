using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using NUnit.Framework;
using RacingDesk.Core.Names;
using RacingDesk.Plugin.IRacing;

namespace RacingDesk.Tests.Names
{
    /// <summary>
    /// How a driver gets a name: by a salted hash of their customer id, the same every time on this machine, never the same
    /// as another driver's in the session, and never their own. The salt is made once and kept; the real name goes nowhere.
    /// </summary>
    [TestFixture]
    public class PseudonymizerTests
    {
        private static PseudonymBook Book => TestNames.Book;

        private static readonly PseudonymList Three = PseudonymList.Parse(@"{ ""version"": 1, ""sources"": [{ ""id"": ""t"", ""title"": ""T"" }],
            ""names"": [ { ""name"": ""Ann One"", ""from"": ""t"" }, { ""name"": ""Bo Two"", ""from"": ""t"" }, { ""name"": ""Cy Three"", ""from"": ""t"" } ] }");

        [Test]
        public void ADriverIsNamedFromTheListAndNeverByTheirOwnName()
        {
            var names = Book.NewSession();
            foreach (var r in SyntheticField.Rivals)
            {
                string shown = names.For(r.CustId, r.Name);
                Assert.That(Book.List.ContainsShown(shown), Is.True, shown);
                foreach (string leak in SyntheticField.Leaks(r)) Assert.That(shown, Is.Not.EqualTo(leak));
            }
        }

        [Test]
        public void TheSameCustomerIdGetsTheSameNameInEverySessionAndWhateverTheyAreCalled()
        {
            var first = Book.NewSession();
            first.BeginSession("5001:1");
            var second = Book.NewSession();
            second.BeginSession("5002:2");
            foreach (var r in SyntheticField.Rivals)
            {
                string a = first.For(r.CustId, r.Name);
                string b = second.For(r.CustId, "Somebody Else");
                Assert.That(b, Is.EqualTo(a), $"car #{r.Number}: the id is the key, not the name");
                Assert.That(first.For(r.CustId, r.Name), Is.EqualTo(a), "asked again in the same session");
            }
            // Alone in a session, a rival is still who they were in the field: the first choice is the id's own.
            foreach (var r in SyntheticField.Rivals)
                Assert.That(Book.NewSession().For(r.CustId, r.Name), Is.EqualTo(first.For(r.CustId, r.Name)));
        }

        [Test]
        public void AnotherSaltGivesOtherNamesSoTheMappingIsThisMachinesAlone()
        {
            var other = new PseudonymBook(Book.List, SyntheticField.SaltFromSeed(987654));
            int same = 0;
            foreach (var r in SyntheticField.Rivals)
                if (Book.NewSession().For(r.CustId, r.Name) == other.NewSession().For(r.CustId, r.Name)) same++;
            Assert.That(same, Is.LessThan(SyntheticField.Rivals.Length), "six of six the same under another salt would be no salt at all");
        }

        [Test]
        public void NoTwoDriversInASessionShareANameAndTheTieBreakIsSteady()
        {
            var tiny = new PseudonymBook(Three, SyntheticField.SaltFromSeed(3));
            var names = tiny.NewSession();
            var given = new[] { names.For(11, "a"), names.For(12, "b"), names.For(13, "c") };
            Assert.That(given.Distinct().Count(), Is.EqualTo(3), "three drivers, three names, whatever their first choices");
            Assert.That(given, Is.SubsetOf(new[] { "A. One", "B. Two", "C. Three" }));

            var again = tiny.NewSession();
            Assert.That(new[] { again.For(11, "a"), again.For(12, "b"), again.For(13, "c") }, Is.EqualTo(given), "the same field, the same way");

            // A fourth driver with no name left: one of the three again rather than nothing, and still never his own.
            string fourth = names.For(14, "Dee Four");
            Assert.That(fourth, Is.Not.EqualTo("Dee Four"));
            Assert.That(new[] { "A. One", "B. Two", "C. Three" }, Does.Contain(fourth));
        }

        [Test]
        public void ANameOnceGivenIsKeptForTheSessionAndForgottenWithIt()
        {
            var names = Book.NewSession();
            names.BeginSession("1:1");
            string a = names.For(700001, "x");
            Assert.That(names.Named, Is.EqualTo(1));
            names.BeginSession("1:1");
            Assert.That(names.Named, Is.EqualTo(1), "the same key changes nothing");
            names.BeginSession("2:2");
            Assert.That(names.Named, Is.EqualTo(0), "another session forgets the table");
            Assert.That(names.For(700001, "x"), Is.EqualTo(a), "and the id's first choice is the same");
        }

        [Test]
        public void ADriverWithNoCustomerIdIsKeyedOnTheNameSaltedAndStillShownAsACharacter()
        {
            var names = Book.NewSession();
            string shown = names.For(0, "Zebedee Quorntalk");
            Assert.That(Book.List.ContainsShown(shown), Is.True);
            Assert.That(shown, Does.Not.Contain("Quorntalk"));
            Assert.That(names.For(0, "zebedee quorntalk "), Is.EqualTo(shown), "the key is the name, trimmed and in one case");
            Assert.That(names.For(-1, "Zebedee Quorntalk"), Is.EqualTo(shown));
            // Applied again to a name that is already one of this session's: it stays.
            Assert.That(names.For(0, shown), Is.EqualTo(shown));
            Assert.That(names.For(0, ""), Is.Not.Empty, "a car with neither id nor name is still called something");
        }

        [Test]
        public void WithoutAListEveryOtherDriverIsDriverAndANumber()
        {
            var none = new PseudonymBook(PseudonymList.Empty, SyntheticField.SaltFromSeed(1)).NewSession();
            string shown = none.For(700001, "Marguerite Ashdown-Kell");
            Assert.That(shown, Does.Match(@"^Driver \d{4}$"));
            Assert.That(none.For(700001, "x"), Is.EqualTo(shown));
        }

        [Test]
        public void ApplyRenamesEveryOtherDriverInTheSessionModelAndLeavesHisOwnEntry()
        {
            var si = SessionInfoYaml.Parse(SyntheticField.Yaml());
            var names = Book.NewSession();
            Assert.That(ReferenceEquals(names.Apply(si), si), Is.True, "the model itself, renamed in place");
            Assert.That(names.SessionKey, Is.EqualTo("5001:70010003"));

            var me = si.DriverInfo.Drivers.Single(d => d.CarIdx == SyntheticField.PlayerCarIdx);
            Assert.That(me.UserName, Is.EqualTo(SyntheticField.PlayerName));
            Assert.That(me.UserID, Is.EqualTo(SyntheticField.PlayerCustId));
            Assert.That(me.TeamName, Is.EqualTo(SyntheticField.PlayerName));

            var pace = si.DriverInfo.Drivers.Single(d => d.CarIdx == SyntheticField.PaceCarIdx);
            Assert.That(pace.UserName, Is.EqualTo("Pace Car"), "not a person");

            var shownNames = new List<string>();
            foreach (var r in SyntheticField.Rivals)
            {
                var d = si.DriverInfo.Drivers.Single(x => x.CarIdx == r.CarIdx);
                Assert.That(Book.List.ContainsShown(d.UserName), Is.True, d.UserName);
                Assert.That(d.AbbrevName, Is.EqualTo(d.UserName));
                Assert.That(d.Initials, Is.EqualTo(Pseudonymizer.Initials(d.UserName)));
                Assert.That(d.UserID, Is.EqualTo(r.CustId), "the id stays: cars, iRating and licence are not names");
                Assert.That(d.IRating, Is.EqualTo(r.IRating));
                Assert.That(d.LicString, Is.EqualTo("A 2.37"));
                Assert.That(d.CarNumber, Is.EqualTo(r.Number));
                shownNames.Add(d.UserName);
                SyntheticField.AssertNoRivalIn(d.UserName + "|" + d.AbbrevName + "|" + d.Initials + "|" + d.TeamName, $"car #{r.Number}");
            }
            Assert.That(shownNames.Distinct().Count(), Is.EqualTo(SyntheticField.Rivals.Length));

            // Teams: named after the driver → the character; a team of its own → kept; the driver's name inside → replaced.
            var first = si.DriverInfo.Drivers.Single(x => x.CarIdx == SyntheticField.Rivals[0].CarIdx);
            Assert.That(first.TeamName, Is.EqualTo("Nowhere Motorsport"));
            var second = si.DriverInfo.Drivers.Single(x => x.CarIdx == SyntheticField.Rivals[1].CarIdx);
            Assert.That(second.TeamName, Is.EqualTo(second.UserName));
            var last = si.DriverInfo.Drivers.Single(x => x.CarIdx == SyntheticField.Rivals[SyntheticField.Rivals.Length - 1].CarIdx);
            Assert.That(last.TeamName, Is.EqualTo(last.UserName + " Racing"));
        }

        [Test]
        public void ApplyTwiceChangesNothingAndTwoSessionsAgree()
        {
            var once = Book.NewSession().Apply(SessionInfoYaml.Parse(SyntheticField.Yaml()));
            var twice = Book.NewSession().Apply(SessionInfoYaml.Parse(SyntheticField.Yaml()));
            Book.NewSession().Apply(twice);
            Book.NewSession().Apply(twice);
            var other = Book.NewSession().Apply(SessionInfoYaml.Parse(SyntheticField.Yaml(sessionId: 6002, subSessionId: 80020004)));
            var reversed = Book.NewSession().Apply(SessionInfoYaml.Parse(SyntheticField.Yaml(reverse: true)));
            foreach (var r in SyntheticField.Rivals)
            {
                string a = once.DriverInfo.Drivers.Single(d => d.CarIdx == r.CarIdx).UserName;
                Assert.That(twice.DriverInfo.Drivers.Single(d => d.CarIdx == r.CarIdx).UserName, Is.EqualTo(a), "applied three times");
                Assert.That(other.DriverInfo.Drivers.Single(d => d.CarIdx == r.CarIdx).UserName, Is.EqualTo(a), "the next session");
                Assert.That(reversed.DriverInfo.Drivers.Single(d => d.CarIdx == r.CarIdx).UserName, Is.EqualTo(a), "listed in another order");
            }
        }

        [Test]
        public void ApplyCopesWithAModelThatHasNoDrivers()
        {
            Assert.That(Book.NewSession().Apply(null), Is.Null);
            var si = SessionInfoYaml.Parse("---\nWeekendInfo:\n TrackID: 1\n");
            Assert.That(ReferenceEquals(Book.NewSession().Apply(si), si), Is.True);
        }

        [TestCase("H. Incandenza", "HI")]
        [TestCase("Sick Boy", "SB")]
        [TestCase("J. van Dyne", "JVD")]
        [TestCase("Lyle", "L")]
        public void InitialsAreTheFirstLetters(string shown, string initials) => Assert.That(Pseudonymizer.Initials(shown), Is.EqualTo(initials));

        [Test]
        public void TheSaltIsMadeOnceAndReadBackEveryTimeAfter()
        {
            string dir = Path.Combine(Path.GetTempPath(), "racing-desk-salt-" + Guid.NewGuid().ToString("N"));
            string path = Path.Combine(dir, "pseudonyms.salt");
            try
            {
                var warnings = new List<string>();
                var first = PseudonymBook.LoadSalt(path, out bool kept, warnings.Add);
                Assert.That(kept, Is.True);
                Assert.That(first, Has.Length.EqualTo(PseudonymBook.SaltLength));
                Assert.That(File.Exists(path), Is.True);
                Assert.That(Directory.GetFiles(dir), Has.Length.EqualTo(1), "no temporary file left behind");

                var second = PseudonymBook.LoadSalt(path, out kept, warnings.Add);
                Assert.That(kept, Is.True);
                Assert.That(second, Is.EqualTo(first), "the same bytes: the names stay the same");
                Assert.That(warnings, Is.Empty);

                var elsewhere = PseudonymBook.LoadSalt(Path.Combine(dir, "another.salt"), out _, warnings.Add);
                Assert.That(elsewhere, Is.Not.EqualTo(first), "a new file is a new salt");

                // A file that is not a salt is not trusted, and not overwritten.
                string odd = Path.Combine(dir, "odd.salt");
                File.WriteAllText(odd, "short");
                var fallback = PseudonymBook.LoadSalt(odd, out kept, warnings.Add);
                Assert.That(kept, Is.False);
                Assert.That(fallback, Has.Length.EqualTo(PseudonymBook.SaltLength));
                Assert.That(File.ReadAllText(odd), Is.EqualTo("short"));
                Assert.That(warnings, Has.Count.EqualTo(1));
                Assert.That(warnings[0], Does.Contain("this run only"));
            }
            finally
            {
                try { Directory.Delete(dir, true); } catch { }
            }
        }

        [Test]
        public void TheDefaultSaltLivesInTheAppsDataFolder()
        {
            Assert.That(PseudonymBook.DefaultSaltPath, Does.EndWith(Path.Combine("Racing Desk", "pseudonyms.salt")));
            Assert.That(PseudonymBook.DataFolderName, Is.EqualTo(RacingDesk.Data.DataFolder.Name), "the one folder, named twice");
        }
    }
}
