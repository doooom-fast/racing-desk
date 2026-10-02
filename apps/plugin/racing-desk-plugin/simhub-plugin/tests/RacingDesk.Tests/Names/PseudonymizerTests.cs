using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using RacingDesk.Core.Names;
using RacingDesk.Plugin.IRacing;

namespace RacingDesk.Tests.Names
{
    /// <summary>
    /// How a driver gets a name: by a salted hash of their customer id, the same every time on this machine, never the same
    /// as another driver's in the session, and never their own. The salt is made once and kept; the real name goes nowhere.
    /// A name is chosen by rendezvous hashing, so it does not depend on the order or the length of the list; a field named
    /// at once is served in an order of its own, racers before spectators, so a contested name goes the same way whatever
    /// order the field is listed in.
    /// </summary>
    [TestFixture]
    public class PseudonymizerTests
    {
        private static PseudonymBook Book => TestNames.Book;

        private static readonly PseudonymList Three = ListOf("Ann One", "Bo Two", "Cy Three");

        /// <summary>A list of made-up names in the order given, each from one made-up source.</summary>
        internal static PseudonymList ListOf(params string[] names) => ListOf(names.Select(n => (n, (string?)null)));

        internal static PseudonymList ListOf(IEnumerable<(string Name, string? Shown)> names) =>
            PseudonymList.Parse(new JObject
            {
                ["version"] = 1,
                ["sources"] = new JArray(new JObject { ["id"] = "t", ["title"] = "T" }),
                ["names"] = new JArray(names.Select(n =>
                {
                    var o = new JObject { ["name"] = n.Name, ["from"] = "t" };
                    if (n.Shown != null) o["shown"] = n.Shown;
                    return o;
                })),
            }.ToString());

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

        // ── Rendezvous: a driver's choice is the id's and the name's, not the list's order or length ──

        [Test]
        public void ADriversChoiceDoesNotDependOnTheOrderOfTheList()
        {
            var salt = SyntheticField.SaltFromSeed(31);
            var entries = Book.List.Entries.Select(e => (Name: e.Name, Shown: (string?)e.Shown)).ToList();
            var forward = new PseudonymBook(ListOf(entries), salt);
            var backward = new PseudonymBook(ListOf(Enumerable.Reverse(entries)), salt);
            var rotated = new PseudonymBook(ListOf(entries.Skip(97).Concat(entries.Take(97))), salt);
            for (int i = 0; i < 300; i++)
            {
                long id = 710000 + i;
                string a = forward.NewSession().For(id, "x");
                Assert.That(backward.NewSession().For(id, "x"), Is.EqualTo(a), $"id {id}, the list reversed");
                Assert.That(rotated.NewSession().For(id, "x"), Is.EqualTo(a), $"id {id}, the list rotated");
            }
        }

        [Test]
        public void AddingANameToTheListOnlyMovesTheDriversWhoPreferIt()
        {
            var salt = SyntheticField.SaltFromSeed(47);
            var entries = Book.List.Entries.Select(e => (Name: e.Name, Shown: (string?)e.Shown)).ToList();
            var added = entries[entries.Count - 1];
            var without = new PseudonymBook(ListOf(entries.Take(entries.Count - 1)), salt);
            var with = new PseudonymBook(ListOf(entries), salt);
            int moved = 0;
            for (int i = 0; i < 600; i++)
            {
                long id = 720000 + i;
                string before = without.NewSession().For(id, "x");
                string after = with.NewSession().For(id, "x");
                if (after == before) continue;
                moved++;
                Assert.That(after, Is.EqualTo(added.Shown), $"id {id} changed to a name it had not been offered before");
            }
            Assert.That(moved, Is.LessThan(30), "of 600 drivers about 600 / the list's length prefer the new name");
        }

        [Test]
        public void AContestedNameGoesTheSameWayWhateverOrderTheFieldIsNamedIn()
        {
            for (int seed = 1; seed <= 40; seed++)
            {
                var book = new PseudonymBook(Three, SyntheticField.SaltFromSeed(seed));
                var drivers = new[] { new KeyValuePair<long, string>(11, "a"), new KeyValuePair<long, string>(12, "b"), new KeyValuePair<long, string>(13, "c") };
                var expected = Name(book, drivers);
                foreach (var order in new[] { new[] { 2, 1, 0 }, new[] { 1, 2, 0 }, new[] { 0, 2, 1 }, new[] { 1, 0, 2 } })
                    Assert.That(Name(book, order.Select(i => drivers[i]).ToArray()), Is.EqualTo(expected), $"salt {seed}, order {string.Join("", order)}");
                Assert.That(expected.Values.Distinct().Count(), Is.EqualTo(3), "three drivers, three names, whatever their first choices");
                Assert.That(expected.Values, Is.SubsetOf(new[] { "A. One", "B. Two", "C. Three" }));
            }

            static Dictionary<long, string> Name(PseudonymBook book, KeyValuePair<long, string>[] drivers)
            {
                var names = book.NewSession().ForMany(drivers);
                return drivers.Select((d, i) => (d.Key, names[i])).ToDictionary(x => x.Key, x => x.Item2);
            }
        }

        [Test]
        public void ASessionListedInAnotherOrderIsNamedTheSameEvenWhereFirstChoicesClash()
        {
            // Four names for seven others: most first choices clash, and every driver but three gets a numbered form. Who gets
            // which depends on the order the drivers are served in, which is the ids' own and not the order of the listing.
            var four = ListOf("Ann One", "Bo Two", "Cy Three", "Di Four");
            for (int seed = 1; seed <= 25; seed++)
            {
                var book = new PseudonymBook(four, SyntheticField.SaltFromSeed(seed));
                var forward = book.NewSession().Apply(SessionInfoYaml.Parse(SyntheticField.Yaml()));
                var backward = book.NewSession().Apply(SessionInfoYaml.Parse(SyntheticField.Yaml(reverse: true)));
                foreach (var r in SyntheticField.Rivals)
                    Assert.That(backward.DriverInfo.Drivers.Single(d => d.CarIdx == r.CarIdx).UserName,
                        Is.EqualTo(forward.DriverInfo.Drivers.Single(d => d.CarIdx == r.CarIdx).UserName), $"salt {seed}, car #{r.Number}");
            }
        }

        [Test]
        public void RacersAreNamedBeforeSpectatorsSoASpectatorNeverTakesARacersFirstChoice()
        {
            var rival = SyntheticField.Rivals[2];
            var book = new PseudonymBook(Book.List, SyntheticField.SaltWhereTheSpectatorWantsARivalsName(Book.List, rival));
            string firstChoice = book.NewSession().For(rival.CustId, "x");
            Assert.That(book.NewSession().For(SyntheticField.SpectatorCustId, "x"), Is.EqualTo(firstChoice), "the premise: both want one name");

            // The spectator is listed first in the session, as iRacing may list them; the racer still has the name.
            foreach (bool reverse in new[] { false, true })
            {
                var si = book.NewSession().Apply(SessionInfoYaml.Parse(SyntheticField.Yaml(reverse: reverse, spectator: true)));
                var racer = si.DriverInfo.Drivers.Single(d => d.CarIdx == rival.CarIdx);
                var spectator = si.DriverInfo.Drivers.Single(d => d.CarIdx == SyntheticField.SpectatorCarIdx);
                Assert.That(racer.UserName, Is.EqualTo(firstChoice), "the racer has the name they would have had alone");
                Assert.That(spectator.UserName, Is.Not.EqualTo(firstChoice));
                Assert.That(book.List.ContainsShown(spectator.UserName), Is.True, "and the spectator is a character too");
                SyntheticField.AssertNoRivalIn(spectator.UserName + "|" + spectator.AbbrevName + "|" + spectator.Initials + "|" + spectator.TeamName, "the spectator");
                var all = si.DriverInfo.Drivers.Where(d => d.CarIsPaceCar == 0).Select(d => d.UserName).ToList();
                Assert.That(all.Distinct().Count(), Is.EqualTo(all.Count));
            }
        }

        // ── Uniqueness, to the last name and past it ──

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
        }

        [Test]
        public void WhenEveryNameIsInUseTheNextDriverGetsANumberedFormAndNeverAnotherDriversName()
        {
            var tiny = new PseudonymBook(Three, SyntheticField.SaltFromSeed(3));
            var names = tiny.NewSession();
            var given = Enumerable.Range(11, 8).Select(id => names.For(id, "Dee Four " + id)).ToList();
            Assert.That(given.Distinct().Count(), Is.EqualTo(8), string.Join(", ", given));
            Assert.That(given.Take(3), Is.SubsetOf(new[] { "A. One", "B. Two", "C. Three" }), "the list first");
            foreach (string numbered in given.Skip(3))
            {
                Assert.That(numbered, Does.Match(@"^[ABC]\. (One|Two|Three) (II|III)$"), numbered);
                Assert.That(Pseudonymizer.BaseOf(numbered), Is.AnyOf("A. One", "B. Two", "C. Three"));
                Assert.That(Pseudonymizer.Initials(numbered), Is.AnyOf("AO", "BT", "CT"), "a numbering is no word");
            }
            foreach (string name in given) Assert.That(name, Does.Not.Contain("Dee Four"));

            // A numbered form stored by a session is taken back as it is, once, and nobody else's.
            var later = tiny.NewSession();
            string numberedForm = given[5];
            Assert.That(later.Keep(500, numberedForm), Is.True);
            Assert.That(later.Keep(501, numberedForm), Is.False, "once");
            Assert.That(later.For(500, "x"), Is.EqualTo(numberedForm));
            Assert.That(later.For(501, "y"), Is.Not.EqualTo(numberedForm));
        }

        [Test]
        public void ASessionWithMoreDriversThanNamesStillGivesEveryoneADifferentOne()
        {
            var book = new PseudonymBook(Book.List, SyntheticField.SaltFromSeed(5));
            int n = Book.List.Count + 40;
            var drivers = Enumerable.Range(0, n).Select(i => new KeyValuePair<long, string>(900000 + i, "nobody " + i)).ToList();
            var given = book.NewSession().ForMany(drivers);
            Assert.That(given.Distinct().Count(), Is.EqualTo(n), "no name twice, however many drivers");
            Assert.That(given.Count(g => book.List.ContainsShown(g)), Is.EqualTo(Book.List.Count), "the whole list is used before any numbering");
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
        public void WithoutAListEveryOtherDriverIsDriverAndANumberAndNoTwoShareOne()
        {
            var none = new PseudonymBook(PseudonymList.Empty, SyntheticField.SaltFromSeed(1)).NewSession();
            string shown = none.For(700001, "Marguerite Ashdown-Kell");
            Assert.That(shown, Does.Match(@"^Driver \d{4}$"));
            Assert.That(none.For(700001, "x"), Is.EqualTo(shown));
            var many = Enumerable.Range(0, 300).Select(i => none.For(800000 + i, "x")).ToList();
            Assert.That(many.Distinct().Count(), Is.EqualTo(300), "a four-digit number may not be given twice in a session");
        }

        // ── The session model ──

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
            Assert.That(me.TeamName, Is.EqualTo(SyntheticField.PlayerName), "his own team, in a session without teams, is his name");

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
                // Without teams a driver's team is the driver, however iRacing wrote it: a team of its own, a team named after
                // them, or one with their name inside a longer one is the character, and never what it was.
                Assert.That(d.TeamName, Is.EqualTo(d.UserName), $"car #{r.Number}");
            }
            Assert.That(shownNames.Distinct().Count(), Is.EqualTo(SyntheticField.Rivals.Length));
        }

        [Test]
        public void ATeamRacesTeamsAreLabelsMadeFromTheirIdsAndNoTeamKeepsItsOwnName()
        {
            var si = SessionInfoYaml.Parse(SyntheticField.Yaml(teamRace: true));
            Book.NewSession().Apply(si);
            var drivers = si.DriverInfo.Drivers;
            foreach (var d in drivers.Where(d => d.CarIsPaceCar == 0))
            {
                Assert.That(d.TeamName, Does.StartWith("Team "), $"car {d.CarIdx}, user {d.UserID}");
                SyntheticField.AssertNoRivalIn(d.TeamName + "|" + d.UserName + "|" + d.AbbrevName, $"car {d.CarIdx}'s team and name");
                Assert.That(d.TeamName, Does.Not.Contain(SyntheticField.PlayerName));
            }
            var mine = drivers.Single(d => d.UserID == SyntheticField.PlayerCustId);
            var teammate = drivers.Single(d => d.UserID == SyntheticField.TeammateCustId);
            Assert.That(mine.UserName, Is.EqualTo(SyntheticField.PlayerName), "his own name stays his");
            Assert.That(Book.List.ContainsShown(teammate.UserName), Is.True, "his teammate is a character, though in his car");
            Assert.That(teammate.TeamName, Is.EqualTo(mine.TeamName), "one team, one label");

            // The same team, the same label, next time.
            var again = SessionInfoYaml.Parse(SyntheticField.Yaml(teamRace: true, sessionId: 6002, subSessionId: 80020004));
            Book.NewSession().Apply(again);
            foreach (var d in drivers.Where(d => d.CarIsPaceCar == 0))
                Assert.That(again.DriverInfo.Drivers.Single(x => x.UserID == d.UserID).TeamName, Is.EqualTo(d.TeamName));

            // And applying it again changes nothing.
            var twice = Book.NewSession().Apply(SessionInfoYaml.Parse(SyntheticField.Yaml(teamRace: true)));
            Book.NewSession().Apply(twice);
            foreach (var d in drivers.Where(d => d.CarIsPaceCar == 0))
                Assert.That(twice.DriverInfo.Drivers.Single(x => x.UserID == d.UserID).TeamName, Is.EqualTo(d.TeamName));
        }

        [Test]
        public void ATeammateDrivingHisCarIsAnotherDriverAndIsRenamed()
        {
            // A team race: the session's entry for his car is whoever is in it. With his teammate in it, it is not his.
            var si = SessionInfoYaml.Parse(SyntheticField.Yaml(teammateDriving: true));
            var car = si.DriverInfo.Drivers.Single(d => d.CarIdx == SyntheticField.PlayerCarIdx);
            Assert.That(Pseudonymizer.IsHim(si.DriverInfo, car), Is.False, "his car, not him");
            Book.NewSession().Apply(si);
            Assert.That(Book.List.ContainsShown(car.UserName), Is.True, car.UserName);
            Assert.That(car.UserID, Is.EqualTo(SyntheticField.TeammateCustId));
            Assert.That(car.TeamName, Is.EqualTo(car.UserName), "a team of its own is the driver's character here, too");
            SyntheticField.AssertNoRivalIn(car.UserName + "|" + car.AbbrevName + "|" + car.Initials + "|" + car.TeamName, "his car with the teammate in it");
            var names = si.DriverInfo.Drivers.Where(d => d.CarIsPaceCar == 0).Select(d => d.UserName).ToList();
            Assert.That(names.Distinct().Count(), Is.EqualTo(names.Count), "the teammate is a different character from every rival");

            // And with him in it, as in every other test: his own.
            var mine = SessionInfoYaml.Parse(SyntheticField.Yaml());
            var me = mine.DriverInfo.Drivers.Single(d => d.CarIdx == SyntheticField.PlayerCarIdx);
            Assert.That(Pseudonymizer.IsHim(mine.DriverInfo, me), Is.True);
            Book.NewSession().Apply(mine);
            Assert.That(me.UserName, Is.EqualTo(SyntheticField.PlayerName));
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
        [TestCase("H. Incandenza II", "HI")]
        [TestCase("Sick Boy III", "SB")]
        public void InitialsAreTheFirstLetters(string shown, string initials) => Assert.That(Pseudonymizer.Initials(shown), Is.EqualTo(initials));

        [TestCase("H. Incandenza", "Incandenza")]
        [TestCase("J. van Dyne", "van Dyne")]
        [TestCase("Sick Boy", "Sick Boy")]
        [TestCase("Lyle", "Lyle")]
        public void ASurnameIsWhatFollowsTheInitial(string shown, string surname) => Assert.That(Pseudonymizer.SurnameOf(shown), Is.EqualTo(surname));

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
