using System.Reflection;
using System.Text;
using NUnit.Framework;
using RacingDesk.Core.Cars;
using static RacingDesk.Tests.Cars.CarListTests;

namespace RacingDesk.Tests.Cars
{
    /// <summary>
    /// What the check of the car list hands on, so that it can be kept: which thing each remark is (the check
    /// already said each once per car under a key of its own), the name of the list it was said against, and when.
    /// Keeping them is <c>RacingDesk.Data</c>'s (IRacing/CarListRemarksTests.cs); this is the follower's side of it.
    /// </summary>
    [TestFixture]
    public class CarListRemarksTests
    {
        private static readonly DateTime Noon = new DateTime(2026, 9, 29, 12, 0, 0, DateTimeKind.Utc);

        // ── The list's name ──

        [Test]
        public void AListIsNamedByItsBytes()
        {
            var list = List();
            Assert.That(list.Hash, Does.Match("^[0-9a-f]{12}$"));
            Assert.That(CarList.Parse(Fixture).Hash, Is.EqualTo(list.Hash), "the same text is the same list");
            Assert.That(list.Hash, Is.EqualTo(CarList.HashOf(Encoding.UTF8.GetBytes(Fixture))));

            Assert.That(CarList.Parse(Fixture.Replace("\"BB\"", "\"BBAL\"")).Hash, Is.Not.EqualTo(list.Hash), "a label changed");
            Assert.That(CarList.Parse(Fixture + " ").Hash, Is.Not.EqualTo(list.Hash), "any byte at all");
            Assert.That(CarList.Parse(@"{ ""cars"": [] }").Hash, Does.Match("^[0-9a-f]{12}$"), "a list with no cars in it is still a list");
        }

        [Test]
        public void AListWithNothingInItIsNamedForThat()
        {
            Assert.That(CarList.Empty.Hash, Is.EqualTo(CarList.EmptyHash));
            Assert.That(CarList.Parse("").Hash, Is.EqualTo(CarList.EmptyHash));
            Assert.That(CarList.Parse("   ").Hash, Is.EqualTo(CarList.EmptyHash));
            Assert.That(CarList.EmptyHash, Is.Not.Match("^[0-9a-f]{12}$"), "no list's bytes can come to it");
        }

        [Test]
        public void TheListABuildCarriesIsNamedByTheBytesItCarries()
        {
            using var stream = typeof(CarList).GetTypeInfo().Assembly.GetManifestResourceStream(CarList.ResourceName);
            if (stream == null)
            {
                Assert.That(CarList.Default.Hash, Is.EqualTo(CarList.EmptyHash), "a tree without the file builds without a list");
                return;
            }
            using var copy = new MemoryStream();
            stream.CopyTo(copy);
            Assert.That(CarList.Default.Hash, Is.EqualTo(CarList.HashOf(copy.ToArray())));
        }

        // ── What is handed on ──

        [Test]
        public void ARemarkSaysWhichThingItWas()
        {
            var check = new CarListCheck("porsche963gtp", List().Find("porsche963gtp"));
            var frames = new List<CarRemark>();
            for (int i = 0; i < 120; i++) frames.AddRange(check.Take(Porsche963().Read, true));

            Assert.That(frames.Select(r => (r.About, r.CarPath, r.Text)), Is.EqualTo(new[]
            {
                ("unlisted", "porsche963gtp", "the car publishes dcBrakeMisc, which the list gives to no control"),
            }));
            Assert.That(frames[0].Line, Is.EqualTo("porsche963gtp the car publishes dcBrakeMisc, which the list gives to no control"),
                "the log has the car and the words, as before");
            Assert.That(check.Said, Is.EqualTo(frames));
            Assert.That(check.Remarks, Is.EqualTo(new[] { frames[0].Line }));
        }

        [Test]
        public void EachThingHasItsOwnKey()
        {
            var unknown = new CarListCheck("ferrari499p", null);
            Assert.That(unknown.Said.Select(r => r.About), Is.EqualTo(new[] { "unknown" }));

            var car = new Car { ["dcABS"] = 3f, ["dcTractionControl"] = 2f, ["dcBrakeBias"] = 50f, ["BrakeABSactive"] = true };
            var list = CarList.Parse(@"{ ""cars"": [ { ""path"": ""x"", ""abs"": ""none"", ""tc"": ""none"", ""brakeBias"": ""none"" } ] }");
            var check = new CarListCheck("x", list.Find("x"));
            for (int i = 0; i < 120; i++) check.See(car.Read, true);
            car["dcBrakeBias"] = 51f;
            for (int i = 0; i < 5; i++) check.See(car.Read, true);
            Assert.That(check.Said.Select(r => r.About), Is.EqualTo(new[] { "unlisted", "abs:dial", "tc:dial", "abs:working", "bias:moved" }));

            var gt3 = Gt3();
            gt3["dcABS"] = 13f;
            gt3.Remove("dcThrottleShape");
            var range = new CarListCheck("madeup gt3", List().Find("madeup gt3"));
            for (int i = 0; i < 120; i++) range.See(gt3.Read, true);
            Assert.That(range.Said.Select(r => r.About), Is.EqualTo(new[] { "absent:dcThrottleShape", "value:dcABS" }));

            var wrong = CarList.Parse(@"{ ""cars"": [ { ""path"": ""y"", ""abs"": ""none"", ""controls"": [ { ""id"": ""abs"", ""var"": ""dcABS"" } ] } ] }");
            Assert.That(new CarListCheck("y", wrong.Find("y")).Said.Select(r => r.About), Is.EqualTo(new[] { "list:abs" }));
        }

        [Test]
        public void TheFollowerHandsEachRemarkOnWithTheListItWasSaidAgainstAndWhenAndTheLogHasEachOnce()
        {
            var said = new List<CarRemark>();
            var log = new List<string>();
            var list = List();
            var follower = new CarControlsFollower(list, log.Add, () => Noon);
            follower.Said += said.Add;

            var gt3 = Gt3();
            gt3.Remove("dcABS");
            for (int i = 0; i < 100; i++) follower.See("madeup gt3", gt3.Property, false, true);
            for (int i = 0; i < 100; i++) follower.See("ferrari499p", gt3.Property, false, true);
            for (int i = 0; i < 100; i++) follower.See("MADEUP GT3", gt3.Property, false, true);

            // Each thing is said the first time, and again in each later drive of the car that finds it still so.
            Assert.That(said.Select(r => (r.CarPath, r.About, r.Again)), Is.EqualTo(new[]
            {
                ("madeup gt3", "absent:dcABS", false), ("ferrari499p", "unknown", false), ("madeup gt3", "absent:dcABS", true),
            }), "he was in the Made-up GT3 again");
            Assert.That(said.Select(r => r.ListHash), Is.All.EqualTo(list.Hash));
            Assert.That(said.Select(r => r.SaidAtUtc), Is.All.EqualTo(Noon));
            Assert.That(log, Is.EqualTo(said.Where(r => !r.Again).Select(r => r.Line)), "and the log has what it always had: each once");
            Assert.That(follower.Remarks["madeup gt3"], Is.EqualTo(new[] { "madeup gt3 the list gives abs as dcABS, which the car does not publish" }),
                "as does this run's, which is by what was said and not by how often");
        }

        [Test]
        public void EveryDriveOfACarSaysAgainWhatIsStillSoAndNoDriveSaysItTwice()
        {
            // Last seen is when he last drove the car and found it so: not when the app was started. The app is kept
            // open across sessions, so one follower — one check for each car — sees the car for hours and days.
            var now = Noon;
            var said = new List<CarRemark>();
            var log = new List<string>();
            var follower = new CarControlsFollower(List(), log.Add, () => now);
            follower.Said += said.Add;
            var gt3 = Gt3();
            gt3.Remove("dcABS");
            void Drive(string car, int frames, bool? inCar = true)
            {
                for (int i = 0; i < frames; i++) follower.See(car, gt3.Property, false, inCar);
            }
            (string, string, bool, DateTime)[] Heard() => said.Select(r => (r.CarPath, r.About, r.Again, r.SaidAtUtc)).ToArray();

            // A long drive is one drive: what is found is said once in it.
            Drive("madeup gt3", 600);
            Drive("ferrari499p", 5, inCar: false);   // the garage, in a car the list has not got: said as soon as it is known
            Assert.That(Heard(), Is.EqualTo(new[] { ("madeup gt3", "absent:dcABS", false, Noon), ("ferrari499p", "unknown", false, Noon) }));

            // Out of the car and back in it, in the same car, two hours later.
            now = Noon.AddHours(2);
            Drive("madeup gt3", 30, inCar: false);
            Drive("madeup gt3", 100);
            // Into the car he was not in, from the car that was not in the list.
            now = Noon.AddHours(4);
            Drive("ferrari499p", 100);
            Assert.That(Heard().Skip(2), Is.EqualTo(new[]
            {
                ("madeup gt3", "absent:dcABS", true, Noon.AddHours(2)),
                ("ferrari499p", "unknown", true, Noon.AddHours(4)),
            }), "the same thing, said again: a check is one for each car for the run, and it still is");

            // The sim gone and back: no car at all in between.
            now = Noon.AddHours(6);
            follower.See("", gt3.Property, false, true);
            follower.See(null, gt3.Property, false, null);
            Drive("madeup gt3", 100);
            Assert.That(Heard().Skip(4), Is.EqualTo(new[] { ("madeup gt3", "absent:dcABS", true, Noon.AddHours(6)) }));

            // From a source that never says whether he is in the car: getting into the car from another is a drive.
            now = Noon.AddHours(8);
            Drive("ferrari499p", 100, inCar: null);
            now = Noon.AddHours(9);
            Drive("madeup gt3", 100, inCar: null);
            Assert.That(Heard().Skip(5), Is.EqualTo(new[]
            {
                ("ferrari499p", "unknown", true, Noon.AddHours(8)), ("madeup gt3", "absent:dcABS", true, Noon.AddHours(9)),
            }));

            // Nothing more when nothing was a drive of it: the frames of one go on.
            int before = said.Count;
            now = Noon.AddDays(1);
            Drive("madeup gt3", 2000);
            Assert.That(said, Has.Count.EqualTo(before));

            // The log had each thing once, all through.
            Assert.That(log, Is.EqualTo(new[]
            {
                "madeup gt3 the list gives abs as dcABS, which the car does not publish",
                "ferrari499p is not in the list: its controls are shown as they were before there was one",
            }));
        }

        [Test]
        public void AThingThatIsNoLongerSoIsNotSaidAgain()
        {
            var now = Noon;
            var said = new List<CarRemark>();
            var follower = new CarControlsFollower(List(), _ => { }, () => now);
            follower.Said += said.Add;
            void Drive(Car car, int frames = 100) { for (int i = 0; i < frames; i++) follower.See("madeup gt3", car.Property, false, true); }
            void GetOut() { for (int i = 0; i < 5; i++) follower.See("madeup gt3", Gt3().Property, false, false); }

            // The first drive: the car does not publish what the list says, and a dial reads outside its range.
            var first = Gt3();
            first.Remove("dcABS");
            first["dcTractionControl"] = 30f;
            Drive(first);
            Assert.That(said.Select(r => r.About), Is.EqualTo(new[] { "absent:dcABS", "value:dcTractionControl" }));

            // The second: the list has been put right for it, or the car has — what was found is not found, and not said.
            now = Noon.AddHours(1);
            GetOut();
            Drive(Gt3());
            Assert.That(said, Has.Count.EqualTo(2), "nothing is said of what is not so");

            // The third: the dial is out of its range again, and that is said again; the car still publishes dcABS.
            now = Noon.AddHours(2);
            GetOut();
            var third = Gt3();
            third["dcTractionControl"] = 31f;
            Drive(third);
            Assert.That(said.Skip(2).Select(r => (r.About, r.Again, r.SaidAtUtc)), Is.EqualTo(new[] { ("value:dcTractionControl", true, Noon.AddHours(2)) }));
            Assert.That(said.Skip(2).Single().Text, Does.Contain("31"), "as it was found this time");
        }

        [Test]
        public void ThingsSaidAgainDoNotComeInTheLogOrInThisRunsRemarks()
        {
            var log = new List<string>();
            var follower = new CarControlsFollower(List(), log.Add, () => Noon);
            var gt3 = Gt3();
            gt3.Remove("dcABS");
            for (int drive = 0; drive < 4; drive++)
            {
                for (int i = 0; i < 5; i++) follower.See("madeup gt3", gt3.Property, false, false);
                for (int i = 0; i < 100; i++) follower.See("madeup gt3", gt3.Property, false, true);
            }
            Assert.That(log, Has.Count.EqualTo(1));
            Assert.That(follower.Remarks["madeup gt3"], Has.Count.EqualTo(1));
        }

        [Test]
        public void ARemarkIsStampedWhenItWasSaidNotWhenItWasRead()
        {
            var now = Noon;
            var said = new List<CarRemark>();
            var follower = new CarControlsFollower(List(), _ => { }, () => now);
            follower.Said += said.Add;
            follower.See("ferrari499p", Gt3().Property, false, true);
            now = Noon.AddHours(2);
            var car = Gt3();
            car.Remove("dcABS");
            for (int i = 0; i < 100; i++) follower.See("madeup gt3", car.Property, false, true);

            Assert.That(said.Select(r => (r.About, r.SaidAtUtc)), Is.EqualTo(new[] { ("unknown", Noon), ("absent:dcABS", Noon.AddHours(2)) }));
        }

        [Test]
        public void NoOneToTellIsNoTrouble()
        {
            var follower = new CarControlsFollower(List(), _ => { });
            Assert.That(follower.See("ferrari499p", Gt3().Property, false, true), Is.Null);
            Assert.That(follower.Remarks["ferrari499p"], Has.Count.EqualTo(1));
        }

        [Test]
        public void AHandlerThatThrowsHoldsUpNeitherTheFrameNorTheOthers()
        {
            var said = new List<CarRemark>();
            var follower = new CarControlsFollower(List(), _ => { });
            follower.Said += _ => throw new InvalidOperationException("the queue is broken");
            follower.Said += said.Add;

            string? json = follower.See("madeup gt3", Gt3().Property, false, true);
            Assert.That(json, Is.Not.Null, "the frame is sent whatever a listener does");
            Assert.That((string?)Newtonsoft.Json.Linq.JObject.Parse(json!)["car"], Is.EqualTo("madeup gt3"));

            var missing = Gt3();
            missing.Remove("dcABS");
            for (int i = 0; i < 100; i++) follower.See("madeup gt3", missing.Property, false, true);
            follower.See("ferrari499p", missing.Property, false, true);
            Assert.That(said.Select(r => r.About), Is.EqualTo(new[] { "absent:dcABS", "unknown" }), "the second listener heard both");
        }

        [Test]
        public void AHandlerMayAskTheFollowerAQuestion()
        {
            // Told after the frame's lock is let go, so that a listener that looks at what has been said, from
            // another thread that waits for it, cannot hold the telemetry up.
            var follower = new CarControlsFollower(List(), _ => { });
            int heard = 0;
            bool answered = false;
            // What a listener throws is not heard of, so what it found is looked at after.
            follower.Said += _ =>
            {
                heard++;
                answered = Task.Run(() => follower.Remarks.Count).Wait(2000);
            };
            follower.See("ferrari499p", Gt3().Property, false, true);
            Assert.That(heard, Is.EqualTo(1));
            Assert.That(answered, Is.True, "another thread was answered while the listener was being told: the frame's lock was let go");
        }

        [Test]
        public void ABuildWithNoListHasNothingToKeep()
        {
            var said = new List<CarRemark>();
            var follower = new CarControlsFollower(CarList.Empty, _ => { });
            follower.Said += said.Add;
            for (int i = 0; i < 200; i++) follower.See("madeup gt3", Gt3().Property, false, true);
            Assert.That(said, Is.Empty);
        }
    }
}
