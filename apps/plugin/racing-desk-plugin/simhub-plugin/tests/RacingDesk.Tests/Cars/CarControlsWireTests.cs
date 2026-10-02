using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using RacingDesk.Core.Cars;

namespace RacingDesk.Tests.Cars
{
    /// <summary>
    /// What the host puts on the wire for the HUD (<c>RacingDesk.Plugin.CarControls</c>), held to what the HUD's
    /// tests read. The HUD's spec (<c>apps/overlay/tests/unit/car-controls.spec.mjs</c>) builds its cars from
    /// <c>apps/overlay/tests/unit/fixtures/car-controls-wire.json</c>; this file is where that fixture is checked
    /// against the C# that writes it, so the two sides cannot drift apart while each passes its own tests.
    ///
    /// The fixture's cars are the list fixture's (CarListTests.Fixture). To rewrite it after a deliberate change to
    /// what the host sends: <c>UPDATE_CAR_CONTROLS_WIRE=1 dotnet test --filter CarControlsWireTests</c>.
    /// </summary>
    [TestFixture]
    public class CarControlsWireTests
    {
        private const string UpdateVariable = "UPDATE_CAR_CONTROLS_WIRE";

        /// <summary>
        /// Each fixture car as the host sends it, for a reading chosen to show a state. A key is the car's folder, and
        /// after a space what the reading is where the same car is there more than once.
        /// </summary>
        private static SortedDictionary<string, JObject> Built()
        {
            var list = CarListTests.List();
            JObject Sent(string path, CarListTests.Car car, bool? fixedSetup) =>
                JObject.Parse(CarControls.Read(list.Find(path), car.Read, fixedSetup).ToJson());

            var gt3 = CarListTests.Gt3();
            gt3["dcABS"] = 0f;              // off, and held by the fixed setup
            gt3["dcThrottleShape"] = 2f;

            // The same car in a session where it publishes neither its ABS nor its throttle map: both unread.
            var gt3Unread = CarListTests.Gt3();
            gt3Unread.Remove("dcABS");
            gt3Unread.Remove("dcThrottleShape");

            CarListTests.Car M2(float dsc) => new CarListTests.Car { ["dcTractionControl"] = dsc };
            CarListTests.Car Formula(int drs = 0, bool p2p = false, int count = 65) =>
                new CarListTests.Car { ["dcBrakeBias"] = 55f, ["DRS_Status"] = drs, ["P2P_Status"] = p2p, ["P2P_Count"] = count };

            return new SortedDictionary<string, JObject>(StringComparer.Ordinal)
            {
                // ABS none (dcABS is the brake migration), the car's own names, the bars, a fixed setup.
                ["porsche963gtp"] = Sent("porsche963gtp", CarListTests.Porsche963(), true),
                // One dial for ABS, traction and stability, by its name; no brake bias to turn.
                ["mclaren570sgt4"] = Sent("mclaren570sgt4", CarListTests.Mclaren570S(0), false),
                // Nothing to turn: ABS on, the rest none.
                ["mx5 mx52016"] = Sent("mx5 mx52016", new CarListTests.Car { ["BrakeABSactive"] = true }, true),
                // A dial that is a word: DSC's ON, MDM and OFF. ABS has no dial and is on.
                ["bmwm2csr"] = Sent("bmwm2csr", M2(2), false),
                ["bmwm2csr mdm"] = Sent("bmwm2csr", M2(1), false),
                ["bmwm2csr off"] = Sent("bmwm2csr", M2(0), false),
                // ABS off; traction control and the throttle map with values.
                ["madeup gt3"] = Sent("madeup gt3", gt3, true),
                // The same car not publishing its ABS or its throttle map: the label of each and no value (unread).
                ["madeup gt3 unread"] = Sent("madeup gt3", gt3Unread, false),
                // No ABS, no TC, a bias with a name of its own; DRS not yet, push-to-pass waiting with 65 seconds.
                ["madeup formula"] = Sent("madeup formula", Formula(), false),
                // DRS as it goes: detected, in the zone, open. Push-to-pass on with a second gone, and used up.
                ["madeup formula drs 1"] = Sent("madeup formula", Formula(drs: 1), false),
                ["madeup formula drs 2"] = Sent("madeup formula", Formula(drs: 2), false),
                ["madeup formula drs 3"] = Sent("madeup formula", Formula(drs: 3), false),
                ["madeup formula p2p on"] = Sent("madeup formula", Formula(p2p: true, count: 64), false),
                ["madeup formula p2p empty"] = Sent("madeup formula", Formula(count: 0), false),
            };
        }

        private static string FixturePath()
        {
            for (var dir = new DirectoryInfo(TestContext.CurrentContext.TestDirectory); dir != null; dir = dir.Parent)
            {
                string tests = Path.Combine(dir.FullName, "apps", "overlay", "tests", "unit");
                if (Directory.Exists(tests)) return Path.Combine(tests, "fixtures", "car-controls-wire.json");
            }
            return null;
        }

        private static JObject Everything(SortedDictionary<string, JObject> cars)
        {
            var all = new JObject();
            foreach (var car in cars) all[car.Key] = car.Value;
            return all;
        }

        [Test]
        public void TheHudsFixtureIsWhatTheHostSends()
        {
            string path = FixturePath();
            Assume.That(path, Is.Not.Null, "the overlay's tests are not in this tree");
            var built = Everything(Built());

            if (Environment.GetEnvironmentVariable(UpdateVariable) == "1")
            {
                Directory.CreateDirectory(Path.GetDirectoryName(path));
                File.WriteAllText(path, built.ToString(Formatting.Indented) + "\n");
            }
            Assert.That(File.Exists(path), Is.True, $"the HUD's fixture is missing: {UpdateVariable}=1 writes it");

            var fixture = JObject.Parse(File.ReadAllText(path));
            Assert.That(fixture.Properties().Select(p => p.Name), Is.EquivalentTo(built.Properties().Select(p => p.Name)));
            foreach (var car in built.Properties())
                Assert.That(JToken.DeepEquals(fixture[car.Name], car.Value), Is.True,
                    $"{car.Name}: the HUD's fixture is not what the host sends now. The host sends\n{car.Value.ToString(Formatting.Indented)}\n" +
                    $"({UpdateVariable}=1 rewrites the fixture)");
        }

        [Test]
        public void TheFixtureHoldsEveryStateTheHudDraws()
        {
            var cars = Built().Values.ToList();
            var primary = cars.SelectMany(c => new[] { c["abs"], c["tc"], c["bb"] }).Where(t => t != null).ToList();
            Assert.That(primary.Select(t => (string)t["state"]).Distinct(), Is.EquivalentTo(new[] { "none", "on", "off", "value", "mode", "unread" }));
            Assert.That(primary.Any(t => (bool?)t["locked"] == true), Is.True, "a control the fixed setup holds");
            Assert.That(primary.Any(t => t["fill"] != null), Is.True, "a bar to fill");

            var more = cars.SelectMany(c => c["more"] is JArray a ? a.Cast<JToken>() : Enumerable.Empty<JToken>()).ToList();
            Assert.That(more.Select(m => (string)m["id"]), Is.SupersetOf(new[] { "brakeMigration", "tc2", "arbFront", "arbRear", "mode", "throttleMap" }));
            Assert.That(more.Any(m => (string)m["state"] == "unread" && m["value"] == null && m["text"] == null), Is.True, "a dial the car is not publishing: its label and no value");
            Assert.That(cars.Select(c => (string)c["drs"]?["text"]).Where(t => t != null).Distinct(), Is.EquivalentTo(new[] { "Off", "Next", "Ready", "Open" }));
            Assert.That(cars.Select(c => (bool?)c["p2p"]?["active"]).Where(a => a != null).Distinct(), Is.EquivalentTo(new bool?[] { false, true }));
            Assert.That(cars.Select(c => (string)c["tc"]?["text"]), Is.SupersetOf(new[] { "MDM", "Off", "On", "None" }), "a dial that is a word");
            Assert.That(cars.SelectMany(c => new[] { c["abs"], c["tc"], c["bb"] }).Concat(cars.SelectMany(c => c["more"] is JArray a ? a.Cast<JToken>() : Enumerable.Empty<JToken>()))
                .Where(t => t != null).Select(t => (string)t["text"]).Where(t => t != null).Where(t => t.Length > 1 && t == t.ToUpperInvariant() && t.Any(char.IsLetter) && t != "MDM"), Is.Empty,
                "no word the host sends is in capitals but an acronym (he asked on 2026-10-02)");
            Assert.That(cars.Select(c => (string)c["tc"]?["words"]).Where(w => w != null), Is.SupersetOf(new[] { "Traction slip", "Stability" }), "the words the list gives go with the label");
            Assert.That(cars.Any(c => c["fixedSetup"] == null), Is.False, "the fixture's readings all came with the session's word on the setup");
        }

        // ── The list this build carries, against itself ──

        [Test]
        public void TheListThisBuildCarriesAgreesWithItself()
        {
            // The check's first half needs no telemetry: a car listed as having no ABS with a control called abs,
            // or as adjustable with nothing to read it from. Said of every car of the real list, so that a slip in
            // the hand-written file is found where it is written and not in the log on the night. Empty until the
            // list is in the tree.
            var list = CarList.Default;
            var said = new List<string>();
            foreach (var car in list.Cars)
                said.AddRange(new CarListCheck(car.Path, car).Remarks);
            Assert.That(said, Is.Empty, string.Join("\n", said));

            foreach (var car in list.Cars)
            {
                foreach (string singular in new[] { CarControls.AbsId, CarControls.TcId, CarControls.BrakeBiasId, CarControls.DrsId, CarControls.PushToPassId })
                    Assert.That(car.Controls.Count(c => string.Equals(c.Id, singular, StringComparison.OrdinalIgnoreCase)), Is.LessThanOrEqualTo(1),
                        $"{car.Path} lists {singular} twice");
                Assert.That(car.Name, Is.Not.Null.And.Not.Empty, $"{car.Path} has no name");
                Assert.That(car.Kind, Is.Not.Null, $"{car.Path} has no kind");
                foreach (var control in car.Controls.Where(c => !string.IsNullOrEmpty(c.Var)))
                    Assert.That(control.Var, Does.Not.Contain(" "), $"{car.Path}: {control.Id}'s variable");
            }
        }

        [Test]
        public void TheListThisBuildCarriesHasItsWordsWhereTheMeaningIsKnown()
        {
            // He asked on 2026-10-02 for words instead of acronyms where they fit, and gave his own for the common ones:
            // ABS anti-lock, BB bias, TC traction, MIG migration, ARB rollbar. The list carries them as `words`, and its
            // labels are the cars' own short forms in sentence case: no word in capitals but an abbreviation the car shows.
            var list = CarList.Default;
            Assume.That(list.Cars, Is.Not.Empty, "the list is not in this tree");
            var wrong = new List<string>();
            foreach (var car in list.Cars)
                foreach (var c in car.Controls)
                {
                    string? expected = c.Id switch
                    {
                        "brakeBias" => "Bias",
                        "brakeMigration" => "Migration",
                        "arbFront" => "Front rollbar",
                        "arbRear" => "Rear rollbar",
                        _ => null,
                    };
                    string? words = c.Words ?? c.Label;
                    if (expected != null && words != expected) wrong.Add($"{car.Path} {c.Id}: \"{words}\", not \"{expected}\"");
                    if (c.Id == "abs" && c.Label == "ABS" && c.Words != "Anti-lock") wrong.Add($"{car.Path} abs: \"{c.Words}\", not \"Anti-lock\"");
                    if (c.Id == "tc" && c.Label == "TC" && c.Words != "Traction") wrong.Add($"{car.Path} tc: \"{c.Words}\", not \"Traction\"");
                    if (c.Words != null && c.Words.Split(' ').Any(w => w.Length > 1 && w.All(ch => !char.IsLetter(ch) || char.IsUpper(ch)) && w.Any(char.IsLetter)))
                        wrong.Add($"{car.Path} {c.Id}: the words \"{c.Words}\" have a word in capitals");
                    foreach (var p in c.Positions)
                        if (p.Value.Length > 1 && p.Value == p.Value.ToUpperInvariant() && p.Value.Any(char.IsLetter) && p.Value != "MDM")
                            wrong.Add($"{car.Path} {c.Id}: the position \"{p.Value}\" is in capitals");
                }
            Assert.That(wrong, Is.Empty, string.Join("\n", wrong));

            // TCLO is the car's own word for its traction slip, as its garage says; the BMW's TCLON is not settled.
            var porsche = list.Find("porsche963gtp");
            Assert.That((porsche.Control("tc").Label, porsche.Control("tc").Words, porsche.Control("tc2").Words), Is.EqualTo(("TCLO", "Traction slip", "Traction gain")));
            Assert.That(list.Find("bmwlmdh").Control("tc").Words, Is.Null, "what TCLON does is not settled, so the car's label is all there is");
        }

        [Test]
        public void ADialTheListGivesAndTheCarDoesNotPublishStillLeavesWhatIsKnown()
        {
            // Fixed ABS with a variable nobody publishes: it has ABS, the driver cannot turn it, so it is ON — and
            // a control the driver can turn, with nothing to read it from, is sent as unread, with the car's own
            // label and no value, so the HUD shows the label and a dash and never a number.
            var car = CarList.Parse(@"{ ""cars"": [
                { ""path"": ""a"", ""abs"": ""fixed"", ""tc"": ""adjustable"", ""brakeBias"": ""adjustable"", ""controls"": [
                    { ""id"": ""abs"", ""var"": ""dcABS"" },
                    { ""id"": ""tc"", ""var"": ""dcTractionControl"" },
                    { ""id"": ""brakeBias"", ""var"": ""dcBrakeBias"", ""label"": ""BBAL"" } ] } ] }").Find("a");
            var state = CarControls.Read(car, new CarListTests.Car().Read, null);

            Assert.That((state.Abs.State, state.Abs.Text), Is.EqualTo(("on", "On")));
            Assert.That((state.Tc.State, state.Tc.Label, state.Tc.Number, state.Tc.Text), Is.EqualTo(("unread", "TC", (double?)null, (string)null)));
            Assert.That((state.BrakeBias.State, state.BrakeBias.Label), Is.EqualTo(("unread", "BBAL")));
            var json = JObject.Parse(state.ToJson());
            Assert.That(json["tc"].ToString(Formatting.None), Is.EqualTo(@"{""id"":""tc"",""label"":""TC"",""state"":""unread"",""var"":""dcTractionControl""}"));
            Assert.That(json["bb"]["value"], Is.Null);
        }

        [Test]
        public void EveryControlOfACarIsReadInTheOrderTheListGivesThem()
        {
            var car = CarListTests.List().Find("porsche963gtp");
            var state = CarControls.Read(car, CarListTests.Porsche963().Read, true);
            var listed = car.Controls.Select(c => c.Id).Where(id => id != "brakeBias" && id != "tc").ToList();
            Assert.That(state.More.Select(m => m.Id), Is.EqualTo(listed), "the HUD's row is the list's order");
        }
    }
}
