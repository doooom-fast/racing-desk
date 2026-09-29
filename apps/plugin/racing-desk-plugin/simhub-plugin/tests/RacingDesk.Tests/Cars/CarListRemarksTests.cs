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
        public void TheFollowerHandsEachRemarkOnOnceWithTheListItWasSaidAgainstAndWhen()
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

            Assert.That(said.Select(r => (r.CarPath, r.About)), Is.EqualTo(new[] { ("madeup gt3", "absent:dcABS"), ("ferrari499p", "unknown") }),
                "once per car for each thing, however often he gets in");
            Assert.That(said.Select(r => r.ListHash), Is.All.EqualTo(list.Hash));
            Assert.That(said.Select(r => r.SaidAtUtc), Is.All.EqualTo(Noon));
            Assert.That(log, Is.EqualTo(said.Select(r => r.Line)), "and the log has what it always had");
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
