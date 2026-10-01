using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using RacingDesk.Core.Cars;
using RacingDesk.Host;
using RacingDesk.Plugin.Engine;
using RacingDesk.Plugin.Transport;

namespace RacingDesk.Tests.Cars
{
    /// <summary>
    /// The canonical list of cars, and what is made of it for the HUD. What a car has is the list's to say;
    /// the telemetry is asked for the value a control has now, for whether the setup is fixed, and — as a
    /// check that changes nothing on the HUD — whether what the car publishes agrees with the list.
    ///
    /// The list here is a fixture of the list's shape. Four of its cars are as they were found on the rig
    /// (docs/car-controls-findings.md); the rest are made up to hold a case.
    /// </summary>
    [TestFixture]
    public class CarListTests
    {
        internal const string Fixture = @"{
  ""version"": 1,
  ""cars"": [
    { ""path"": ""porsche963gtp"", ""name"": ""Porsche 963 GTP"", ""kind"": ""prototype"",
      ""abs"": ""none"", ""tc"": ""adjustable"", ""brakeBias"": ""adjustable"",
      ""controls"": [
        { ""id"": ""brakeBias"", ""var"": ""dcBrakeBias"", ""label"": ""BB"", ""range"": [40, 60], ""decimals"": 2 },
        { ""id"": ""brakeMigration"", ""var"": ""dcABS"", ""label"": ""MIG"", ""range"": [-6, 6] },
        { ""id"": ""tc"", ""var"": ""dcTractionControl"", ""label"": ""TCLO"", ""range"": [1, 12] },
        { ""id"": ""tc2"", ""var"": ""dcTractionControl2"", ""label"": ""TCLA"", ""range"": [1, 12] },
        { ""id"": ""arbFront"", ""var"": ""dcAntiRollFront"", ""label"": ""FARB"" },
        { ""id"": ""arbRear"", ""var"": ""dcAntiRollRear"", ""label"": ""RARB"" }
      ],
      ""checked"": ""telemetry"" },
    { ""path"": ""mclaren570sgt4"", ""name"": ""McLaren 570S GT4"", ""kind"": ""gt"",
      ""abs"": ""adjustable"", ""tc"": ""adjustable"", ""brakeBias"": ""none"",
      ""controls"": [
        { ""id"": ""mode"", ""var"": ""dcABS"", ""label"": ""ESC"", ""positions"": { ""0"": ""TRACK"", ""1"": ""SPORT"", ""2"": ""NORMAL"" } }
      ],
      ""checked"": ""telemetry"" },
    { ""path"": ""mx5 mx52016"", ""name"": ""Mazda MX-5 Cup"", ""kind"": ""touring"",
      ""abs"": ""fixed"", ""tc"": ""none"", ""brakeBias"": ""none"", ""controls"": [], ""checked"": ""telemetry"" },
    { ""path"": ""bmwm2csr"", ""name"": ""BMW M2 CS Racing"", ""kind"": ""touring"",
      ""abs"": ""fixed"", ""tc"": ""adjustable"", ""brakeBias"": ""none"",
      ""controls"": [
        { ""id"": ""tc"", ""var"": ""dcTractionControl"", ""label"": ""DSC"", ""positions"": { ""0"": ""OFF"", ""1"": ""MDM"", ""2"": ""ON"" } }
      ],
      ""checked"": ""telemetry"" },
    { ""path"": ""madeup gt3"", ""name"": ""Made-up GT3"", ""kind"": ""gt"",
      ""abs"": ""adjustable"", ""tc"": ""adjustable"", ""brakeBias"": ""adjustable"",
      ""controls"": [
        { ""id"": ""brakeBias"", ""var"": ""dcBrakeBias"", ""label"": ""BB"", ""range"": [45, 65] },
        { ""id"": ""tc"", ""var"": ""dcTractionControl"", ""label"": ""TC1"", ""off"": 0, ""range"": [0, 12] },
        { ""id"": ""abs"", ""var"": ""dcABS"", ""label"": ""ABS"", ""range"": [1, 12] },
        { ""id"": ""throttleMap"", ""var"": ""dcThrottleShape"", ""label"": ""MAP"", ""off"": false }
      ],
      ""checked"": ""written"" },
    { ""path"": ""madeup formula"", ""name"": ""Made-up Formula"", ""kind"": ""formula"",
      ""abs"": ""none"", ""tc"": ""none"", ""brakeBias"": ""adjustable"",
      ""controls"": [
        { ""id"": ""brakeBias"", ""var"": ""dcBrakeBias"", ""label"": ""BBAL"" },
        { ""id"": ""drs"", ""var"": ""DRS_Status"", ""label"": ""DRS"" },
        { ""id"": ""p2p"", ""var"": ""P2P_Status"", ""label"": ""OT"" }
      ],
      ""checked"": ""written"" }
  ]
}";

        private const string Raw = "DataCorePlugin.GameRawData.Telemetry.";

        internal static CarList List() => CarList.Parse(Fixture);

        /// <summary>A car's telemetry: only what it publishes is here.</summary>
        internal sealed class Car : Dictionary<string, object>
        {
            public object Read(string name) => TryGetValue(name, out var v) ? v : null;
            public object Property(string fullName) => fullName.StartsWith(Raw, StringComparison.Ordinal) ? Read(fullName.Substring(Raw.Length)) : null;
        }

        internal static Car Porsche963() => new Car
        {
            ["dcBrakeBias"] = 48.25f, ["dcABS"] = -2f, ["dcBrakeMisc"] = 0f, ["dcTractionControl"] = 5f, ["dcTractionControl2"] = 4f,
            ["dcAntiRollFront"] = 1f, ["dcAntiRollRear"] = 15f, ["BrakeABSactive"] = false, ["P2P_Status"] = false, ["P2P_Count"] = 0,
        };

        internal static Car Mclaren570S(float mode = 0) => new Car { ["dcABS"] = mode, ["dcBrakeBias"] = 49f, ["BrakeABSactive"] = false };

        internal static Car Gt3() => new Car
        {
            ["dcBrakeBias"] = 56.2f, ["dcTractionControl"] = 4f, ["dcABS"] = 3f, ["dcThrottleShape"] = 0f, ["BrakeABSactive"] = false,
        };

        // ── The list ──

        [Test]
        public void TheListIsReadAsItIsWritten()
        {
            var list = List();
            Assert.That(list.Version, Is.EqualTo(1));
            Assert.That(list.Cars.Select(c => c.Path), Is.EqualTo(new[] { "porsche963gtp", "mclaren570sgt4", "mx5 mx52016", "bmwm2csr", "madeup gt3", "madeup formula" }));
            Assert.That(list.Problems, Is.Empty);

            var porsche = list.Find("porsche963gtp");
            Assert.That((porsche.Name, porsche.Kind, porsche.Abs, porsche.Tc, porsche.BrakeBias, porsche.Checked),
                Is.EqualTo(("Porsche 963 GTP", "prototype", "none", "adjustable", "adjustable", "telemetry")));
            Assert.That(porsche.Controls.Select(c => c.Id), Is.EqualTo(new[] { "brakeBias", "brakeMigration", "tc", "tc2", "arbFront", "arbRear" }),
                "in the list's order, which is the HUD's");

            var migration = porsche.Control("brakeMigration");
            Assert.That((migration.Var, migration.Label, migration.Min, migration.Max), Is.EqualTo(("dcABS", "MIG", (double?)-6, (double?)6)));
            Assert.That(porsche.Control("brakeBias").Decimals, Is.EqualTo(2));

            var mode = list.Find("mclaren570sgt4").Control("mode");
            Assert.That(mode.Positions.Select(p => (p.Key, p.Value)), Is.EqualTo(new[] { (0d, "TRACK"), (1d, "SPORT"), (2d, "NORMAL") }));
            Assert.That(mode.PositionAt(1), Is.EqualTo("SPORT"));
            Assert.That(mode.PositionAt(3), Is.Null);

            var gt3 = list.Find("madeup gt3");
            Assert.That(gt3.Control("tc").Off, Is.EqualTo(0));
            Assert.That(gt3.Control("abs").Off, Is.Null, "not said");
            Assert.That(gt3.Control("throttleMap").NeverOff, Is.True, "\"off\": false says no value of it is off");
        }

        [Test]
        public void ACarIsFoundByItsFolderCaseBlind()
        {
            var list = List();
            Assert.That(list.Find("PORSCHE963GTP")?.Path, Is.EqualTo("porsche963gtp"));
            Assert.That(list.Find("  mx5 mx52016 ")?.Name, Is.EqualTo("Mazda MX-5 Cup"));
            Assert.That(list.Find("mx5-mx52016")?.Path, Is.EqualTo("mx5 mx52016"), "as the paint library names the folder");
            Assert.That(list.Find("MX5_MX52016")?.Path, Is.EqualTo("mx5 mx52016"));
        }

        [Test]
        public void ACarThatIsNotInTheListIsNotKnown()
        {
            var list = List();
            Assert.That(list.Find("ferrari499p"), Is.Null);
            Assert.That(list.Find("porsche963"), Is.Null, "part of a folder is not the folder");
            Assert.That(list.Find(""), Is.Null);
            Assert.That(list.Find(null), Is.Null);
            Assert.That(CarList.Empty.Find("porsche963gtp"), Is.Null);
        }

        [Test]
        public void WhatTheListDoesNotKnowOrGetsWrongIsLeftAndTheRestIsRead()
        {
            var list = CarList.Parse(@"{
  ""version"": 3, ""written"": ""by hand"", ""unknown"": { ""a"": [1, 2] },
  ""cars"": [
    { ""name"": ""No folder"" },
    ""not a car"",
    { ""path"": ""a"", ""abs"": ""sometimes"", ""tc"": 4, ""brakeBias"": ""ADJUSTABLE"", ""kind"": ""GT"", ""engine"": ""V8"",
      ""controls"": [
        { ""label"": ""no id"" },
        { ""id"": ""tc"", ""var"": 7, ""range"": [12, 1], ""off"": ""zero"", ""positions"": { ""one"": ""A"", ""2"": ""B"", ""3"": 4 }, ""future"": true },
        { ""id"": ""abs"", ""range"": [1], ""decimals"": 9, ""lockedWhenFixed"": ""yes"", ""covers"": ""abs"" },
        { ""id"": ""mode"", ""var"": null, ""covers"": [""abs"", 3, ""tc""], ""lockedWhenFixed"": false }
      ] },
    { ""path"": ""A"", ""name"": ""again"" },
    { ""path"": ""b"", ""controls"": ""none"" },
    { ""path"": ""c"" }
  ] }");

            Assert.That(list.Version, Is.EqualTo(3));
            Assert.That(list.Cars.Select(c => c.Path), Is.EqualTo(new[] { "a", "b", "c" }));

            var a = list.Find("a");
            Assert.That((a.Abs, a.Tc, a.BrakeBias, a.Kind, a.Name), Is.EqualTo(((string)null, (string)null, "adjustable", "gt", (string)null)),
                "a word that is none of the three is not said; the case of one that is does not matter");
            Assert.That(a.Controls.Select(c => c.Id), Is.EqualTo(new[] { "tc", "abs", "mode" }));

            var tc = a.Control("tc");
            Assert.That((tc.Var, tc.Min, tc.Max, tc.Off, tc.NeverOff), Is.EqualTo(((string)null, (double?)null, (double?)null, (double?)null, false)));
            Assert.That(tc.Positions.Select(p => (p.Key, p.Value)), Is.EqualTo(new[] { (2d, "B") }));

            var abs = a.Control("abs");
            Assert.That((abs.Min, abs.Decimals, abs.LockedWhenFixed, abs.Covers), Is.EqualTo(((double?)null, (int?)null, (bool?)null, (IReadOnlyList<string>)null)));

            var mode = a.Control("mode");
            Assert.That(mode.Covers, Is.EqualTo(new[] { "abs", "tc" }));
            Assert.That(mode.LockedWhenFixed, Is.False);

            Assert.That(list.Find("c").Controls, Is.Empty);
            Assert.That(list.Problems, Has.Count.EqualTo(7), string.Join(" | ", list.Problems));
            Assert.That(list.Problems, Has.Some.Contains("twice"));
            Assert.That(list.Problems, Has.Some.Contains("no path"));
            Assert.That(list.Problems, Has.Some.Contains("\"sometimes\""));
        }

        [Test]
        public void TextThatIsNoListIsAnEmptyListOrSaysSo()
        {
            Assert.That(CarList.Parse(""), Is.SameAs(CarList.Empty));
            Assert.That(CarList.Parse(null), Is.SameAs(CarList.Empty));
            Assert.That(CarList.Parse("[]").Cars, Is.Empty);
            Assert.That(CarList.Parse("{}").Problems, Has.Some.Contains("no cars"));
            Assert.That(() => CarList.Parse("{ not json"), Throws.InstanceOf<Newtonsoft.Json.JsonException>());
        }

        [Test]
        public void TheListThisBuildCarriesIsReadWithoutComplaint()
        {
            // The file comes from packages/car-list; a tree without it builds with no list, and no car is known.
            var list = CarList.Default;
            Assert.That(list, Is.Not.Null);
            Assert.That(list.Problems, Is.Empty, string.Join(" | ", list.Problems));
            foreach (var car in list.Cars)
            {
                Assert.That(list.Find(car.Path), Is.SameAs(car), car.Path);
                // An id stands on its own; a folder's digits run on from its letters (mx52016, camarozl12018).
                Assert.That(car.Path, Does.Not.Match(@"(^|[^A-Za-z0-9])\d{5,}($|[^A-Za-z0-9])"), "a folder, not an id");
                foreach (var control in car.Controls)
                    Assert.That(control.Id, Is.Not.Empty, car.Path);
            }
        }

        // ── NONE, OFF, ON, or a value with the car's own label ──

        [Test]
        public void ACarWithoutAbsShowsNoneWhateverItPublishes()
        {
            // The 963 publishes dcABS, and the sim calls it "In car abs adjustment". It is the brake migration.
            var state = CarControls.Read(List().Find("porsche963gtp"), Porsche963().Read, fixedSetup: false);

            Assert.That((state.Abs.State, state.Abs.Text, state.Abs.Number), Is.EqualTo(("none", "NONE", (double?)null)));
            var migration = state.More.Single(m => m.Id == "brakeMigration");
            Assert.That((migration.Label, migration.State, migration.Number, migration.Text, migration.Var), Is.EqualTo(("MIG", "value", (double?)-2, "-2", "dcABS")));
            Assert.That(migration.Fill, Is.EqualTo(4 / 12.0).Within(1e-9), "between the list's lowest and highest");
        }

        [Test]
        public void AValueCarriesTheCarsOwnLabel()
        {
            var state = CarControls.Read(List().Find("porsche963gtp"), Porsche963().Read, fixedSetup: false);

            Assert.That((state.Tc.Label, state.Tc.State, state.Tc.Number, state.Tc.Text), Is.EqualTo(("TCLO", "value", (double?)5, "5")));
            Assert.That((state.BrakeBias.Label, state.BrakeBias.Text), Is.EqualTo(("BB", "48.25")), "to the places the list asks for");
            Assert.That(state.More.Select(m => (m.Id, m.Label, m.Text)), Is.EqualTo(new[]
            {
                ("brakeMigration", "MIG", "-2"), ("tc2", "TCLA", "4"), ("arbFront", "FARB", "1"), ("arbRear", "RARB", "15"),
            }));
            Assert.That(state.More.Single(m => m.Id == "arbFront").Fill, Is.Null, "no range in the list, no bar to fill");
            Assert.That((state.CarPath, state.Name, state.Kind, state.FixedSetup), Is.EqualTo(("porsche963gtp", "Porsche 963 GTP", "prototype", (bool?)false)));
        }

        [Test]
        public void BrakeBiasIsShownToOnePlaceUnlessTheListSays()
        {
            var state = CarControls.Read(List().Find("madeup gt3"), Gt3().Read, null);
            Assert.That((state.BrakeBias.Text, state.BrakeBias.Number), Is.EqualTo(("56.2", (double?)56.2f)));
            Assert.That(state.BrakeBias.Fill, Is.EqualTo((56.2f - 45) / 20).Within(1e-6));

            var car = Gt3();
            car["dcBrakeBias"] = 55f;
            Assert.That(CarControls.Read(List().Find("madeup gt3"), car.Read, null).BrakeBias.Text, Is.EqualTo("55.0"));
        }

        [Test]
        public void NoughtIsOffForAbsAndTractionControl()
        {
            var car = Gt3();
            car["dcTractionControl"] = 0f;      // the list says 0 is off
            car["dcABS"] = 0f;                  // the list says nothing: nought is off, by the driver's rule
            var state = CarControls.Read(List().Find("madeup gt3"), car.Read, false);

            Assert.That((state.Tc.State, state.Tc.Text, state.Tc.Label, state.Tc.Number), Is.EqualTo(("off", "OFF", "TC1", (double?)0)));
            Assert.That((state.Abs.State, state.Abs.Text), Is.EqualTo(("off", "OFF")));
        }

        [Test]
        public void NoughtIsNotOffWhereTheListSaysSoOrForAnythingElse()
        {
            var state = CarControls.Read(List().Find("madeup gt3"), Gt3().Read, false);
            var map = state.More.Single(m => m.Id == "throttleMap");
            Assert.That((map.State, map.Text), Is.EqualTo(("value", "0")), "\"off\": false");

            var porsche = Porsche963();
            porsche["dcABS"] = 0f;
            porsche["dcAntiRollFront"] = 0f;
            var gtp = CarControls.Read(List().Find("porsche963gtp"), porsche.Read, false);
            Assert.That(gtp.More.Single(m => m.Id == "brakeMigration").State, Is.EqualTo("value"), "a migration of nought is a migration");
            Assert.That(gtp.More.Single(m => m.Id == "arbFront").Text, Is.EqualTo("0"));
        }

        [Test]
        public void AbsThatIsOffInAFixedSetupShowsOffAndIsHeld()
        {
            var car = Gt3();
            car["dcABS"] = 0f;
            var state = CarControls.Read(List().Find("madeup gt3"), car.Read, fixedSetup: true);

            Assert.That((state.Abs.State, state.Abs.Text, state.Abs.Locked), Is.EqualTo(("off", "OFF", true)));
            Assert.That((state.Tc.Text, state.Tc.Locked), Is.EqualTo(("4", true)));
            Assert.That(state.BrakeBias.Locked, Is.False, "the bias is his to move under any setup");
            Assert.That(state.More.Single(m => m.Id == "throttleMap").Locked, Is.False);
            Assert.That(state.FixedSetup, Is.True);
        }

        [Test]
        public void WhatAFixedSetupHoldsIsAbsAndTractionControlUnlessTheListSays()
        {
            var gtp = CarControls.Read(List().Find("porsche963gtp"), Porsche963().Read, fixedSetup: true);
            Assert.That(gtp.Tc.Locked, Is.True);
            Assert.That(gtp.More.Single(m => m.Id == "tc2").Locked, Is.True);
            Assert.That(gtp.More.Single(m => m.Id == "brakeMigration").Locked, Is.False, "it rides on dcABS and is not the ABS");

            Assert.That(CarControls.LockedByAFixedSetup("abs"), Is.True);
            Assert.That(CarControls.LockedByAFixedSetup("TC3"), Is.True);
            Assert.That(CarControls.LockedByAFixedSetup("tcMode"), Is.False);
            Assert.That(CarControls.LockedByAFixedSetup("brakeBias"), Is.False);
            Assert.That(CarControls.LockedByAFixedSetup((string)null), Is.False);

            var said = CarList.Parse(@"{ ""cars"": [ { ""path"": ""x"", ""tc"": ""adjustable"", ""brakeBias"": ""adjustable"", ""controls"": [
                { ""id"": ""tc"", ""var"": ""dcTractionControl"", ""lockedWhenFixed"": false },
                { ""id"": ""brakeBias"", ""var"": ""dcBrakeBias"", ""lockedWhenFixed"": true } ] } ] }").Find("x");
            var state = CarControls.Read(said, Gt3().Read, fixedSetup: true);
            Assert.That((state.Tc.Locked, state.BrakeBias.Locked), Is.EqualTo((false, true)));
            Assert.That(CarControls.Read(said, Gt3().Read, fixedSetup: null).BrakeBias.Locked, Is.False, "the sim has not said the setup is fixed");
        }

        [Test]
        public void AbsTheDriverCannotTurnIsOn()
        {
            var mx5 = CarControls.Read(List().Find("mx5 mx52016"), new Car { ["BrakeABSactive"] = true }.Read, false);
            Assert.That((mx5.Abs.State, mx5.Abs.Text, mx5.Abs.Label, mx5.Abs.Number), Is.EqualTo(("on", "ON", "ABS", (double?)null)));
            Assert.That((mx5.Tc.State, mx5.Tc.Text), Is.EqualTo(("none", "NONE")));
            Assert.That((mx5.BrakeBias.State, mx5.BrakeBias.Label), Is.EqualTo(("none", "BB")));
            Assert.That(mx5.More, Is.Empty);
        }

        [Test]
        public void ACarWhoseDialIsAModeShowsItsMode()
        {
            var list = List();
            var track = CarControls.Read(list.Find("mclaren570sgt4"), Mclaren570S(0).Read, false);

            var mode = track.More.Single();
            Assert.That((mode.Id, mode.Label, mode.State, mode.Text, mode.Number), Is.EqualTo(("mode", "ESC", "value", "TRACK", (double?)0)),
                "nought has a name: it is not off");
            Assert.That((track.Abs.State, track.Abs.By), Is.EqualTo(("mode", "ESC")), "the ABS is inside the mode");
            Assert.That((track.Tc.State, track.Tc.By), Is.EqualTo(("mode", "ESC")));
            Assert.That(track.BrakeBias.State, Is.EqualTo("none"), "published, at 49 in every file, and not his to change");

            Assert.That(CarControls.Read(list.Find("mclaren570sgt4"), Mclaren570S(2).Read, false).More.Single().Text, Is.EqualTo("NORMAL"));
            Assert.That(CarControls.Read(list.Find("mclaren570sgt4"), Mclaren570S(3).Read, false).More.Single().Text, Is.EqualTo("3"),
                "a position the list has no name for is its number");
        }

        [Test]
        public void AModeStandsOnlyForWhatItIsSaidToCover()
        {
            var car = CarList.Parse(@"{ ""cars"": [ { ""path"": ""x"", ""abs"": ""adjustable"", ""tc"": ""adjustable"", ""brakeBias"": ""none"", ""controls"": [
                { ""id"": ""mode"", ""var"": ""dcTractionControl"", ""label"": ""DSC"", ""covers"": [""tc""] } ] } ] }").Find("x");
            var state = CarControls.Read(car, Gt3().Read, false);

            Assert.That((state.Tc.State, state.Tc.By), Is.EqualTo(("mode", "DSC")));
            Assert.That(state.Abs, Is.Null, "the list says it can be turned and gives nothing to read it from: nothing true to say");
        }

        [Test]
        public void ANamedPositionThatIsOffIsOff()
        {
            var list = List();
            var off = CarControls.Read(list.Find("bmwm2csr"), new Car { ["dcTractionControl"] = 0f }.Read, false);
            Assert.That((off.Tc.Label, off.Tc.State, off.Tc.Text), Is.EqualTo(("DSC", "off", "OFF")));

            var mdm = CarControls.Read(list.Find("bmwm2csr"), new Car { ["dcTractionControl"] = 1f }.Read, false);
            Assert.That((mdm.Tc.State, mdm.Tc.Text), Is.EqualTo(("value", "MDM")));
            Assert.That((mdm.Abs.State, mdm.Abs.Text), Is.EqualTo(("on", "ON")), "it has ABS and no dial for it");
        }

        [Test]
        public void WhatCannotBeReadIsNotSaid()
        {
            var car = Gt3();
            car.Remove("dcABS");                           // the list gives a variable the car does not publish
            car["dcTractionControl"] = float.NaN;          // a frame of garbage
            car["dcThrottleShape"] = 1.6e34f;
            var state = CarControls.Read(List().Find("madeup gt3"), car.Read, false);

            Assert.That(state.Abs, Is.Null);
            Assert.That(state.Tc, Is.Null);
            Assert.That(state.More, Is.Empty);
            Assert.That(state.BrakeBias.Text, Is.EqualTo("56.2"));
        }

        [Test]
        public void AValueIsReadHoweverTheSourceHoldsIt()
        {
            // The SDK gives floats, ints and booleans; SimHub may give doubles or text.
            Assert.That(CarControls.Number(4f), Is.EqualTo(4));
            Assert.That(CarControls.Number(4.5), Is.EqualTo(4.5));
            Assert.That(CarControls.Number(3), Is.EqualTo(3));
            Assert.That(CarControls.Number(true), Is.EqualTo(1));
            Assert.That(CarControls.Number("2"), Is.EqualTo(2));
            Assert.That(CarControls.Number("False"), Is.EqualTo(0));
            Assert.That(CarControls.Number((short)7), Is.EqualTo(7));
            Assert.That(CarControls.Number(null), Is.Null);
            Assert.That(CarControls.Number("TRACK"), Is.Null);
            Assert.That(CarControls.Number(double.PositiveInfinity), Is.Null);
            Assert.That(CarControls.Number(-2124934497), Is.Null, "no dial holds two thousand million");
            Assert.That(CarControls.Number(new float[] { 1, 2 }), Is.Null);
        }

        // ── DRS and push-to-pass ──

        [TestCase(0, "off", "OFF", false)]
        [TestCase(1, "value", "NEXT", false)]
        [TestCase(2, "value", "READY", false)]
        [TestCase(3, "value", "OPEN", true)]
        public void DrsIsShownByItsFourStates(int status, string state, string text, bool open)
        {
            var car = new Car { ["dcBrakeBias"] = 55f, ["DRS_Status"] = status, ["P2P_Status"] = false, ["P2P_Count"] = 0 };
            var drs = CarControls.Read(List().Find("madeup formula"), car.Read, false).Drs;
            Assert.That((drs.Id, drs.Label, drs.State, drs.Text, drs.Active, drs.Number), Is.EqualTo(("drs", "DRS", state, text, (bool?)open, (double?)status)));
        }

        [Test]
        public void PushToPassIsOnOrTheSecondsLeft()
        {
            var formula = List().Find("madeup formula");
            var car = new Car { ["dcBrakeBias"] = 55f, ["P2P_Status"] = false, ["P2P_Count"] = 65 };

            var waiting = CarControls.Read(formula, car.Read, false).PushToPass;
            Assert.That((waiting.Label, waiting.State, waiting.Text, waiting.Count, waiting.Active), Is.EqualTo(("OT", "off", "65", (int?)65, (bool?)false)));

            car["P2P_Status"] = true;
            car["P2P_Count"] = 64;
            var on = CarControls.Read(formula, car.Read, false).PushToPass;
            Assert.That((on.State, on.Text, on.Count, on.Active), Is.EqualTo(("value", "ON", (int?)64, (bool?)true)));

            car["P2P_Status"] = false;
            car["P2P_Count"] = 999;
            var practice = CarControls.Read(formula, car.Read, false).PushToPass;
            Assert.That((practice.Text, practice.Count), Is.EqualTo(("OFF", (int?)null)), "999 is no limit, not a count");

            car["P2P_Count"] = -2124934497;
            Assert.That(CarControls.Read(formula, car.Read, false).PushToPass.Count, Is.Null, "a frame of garbage");
        }

        [Test]
        public void ACarGivenNoDrsShowsNone()
        {
            // Every car publishes the push-to-pass variables; that they are there says nothing.
            var state = CarControls.Read(List().Find("porsche963gtp"), Porsche963().Read, false);
            Assert.That(state.Drs, Is.Null);
            Assert.That(state.PushToPass, Is.Null);

            var formula = CarControls.Read(List().Find("madeup formula"), new Car { ["dcBrakeBias"] = 55f, ["P2P_Status"] = false }.Read, false);
            Assert.That(formula.Drs, Is.Null, "listed, and this car is not publishing it: nothing to show, and the check says so");
            Assert.That(formula.BrakeBias.Label, Is.EqualTo("BBAL"));
        }

        // ── What the HUD is sent ──

        [Test]
        public void TheHudIsSentOneObject()
        {
            var car = Porsche963();
            var json = JObject.Parse(CarControls.Read(List().Find("porsche963gtp"), car.Read, fixedSetup: true).ToJson());

            Assert.That((string)json["car"], Is.EqualTo("porsche963gtp"));
            Assert.That((string)json["name"], Is.EqualTo("Porsche 963 GTP"));
            Assert.That((string)json["kind"], Is.EqualTo("prototype"));
            Assert.That((bool)json["fixedSetup"], Is.True);
            Assert.That(json["abs"].ToString(Newtonsoft.Json.Formatting.None), Is.EqualTo(@"{""id"":""abs"",""label"":""ABS"",""state"":""none"",""text"":""NONE""}"));
            Assert.That(json["tc"].ToString(Newtonsoft.Json.Formatting.None),
                Is.EqualTo(@"{""id"":""tc"",""label"":""TCLO"",""state"":""value"",""value"":5,""text"":""5"",""fill"":0.364,""locked"":true,""var"":""dcTractionControl""}"));
            Assert.That((string)json["bb"]["text"], Is.EqualTo("48.25"));
            Assert.That(json["bb"]["locked"], Is.Null, "said only when it is");
            Assert.That(json["more"].Select(m => (string)m["id"]), Is.EqualTo(new[] { "brakeMigration", "tc2", "arbFront", "arbRear" }));
            Assert.That((double)json["more"][0]["value"], Is.EqualTo(-2));
            Assert.That(json["drs"], Is.Null);
            Assert.That(json["p2p"], Is.Null);

            var mx5 = JObject.Parse(CarControls.Read(List().Find("mx5 mx52016"), new Car().Read, null).ToJson());
            Assert.That(mx5["fixedSetup"], Is.Null, "the sim has not said");
            Assert.That(mx5["more"], Is.Null);
            Assert.That((string)mx5["abs"]["state"], Is.EqualTo("on"));
        }

        [Test]
        public void ALabelIsSentAsItIsWritten()
        {
            var car = CarList.Parse(@"{ ""cars"": [ { ""path"": ""x"", ""name"": ""A \""quoted\"" name\\"", ""tc"": ""adjustable"", ""controls"": [
                { ""id"": ""tc"", ""var"": ""dcTractionControl"", ""label"": ""TC1 & TC2"" } ] } ] }").Find("x");
            var json = JObject.Parse(CarControls.Read(car, Gt3().Read, null).ToJson());
            Assert.That((string)json["name"], Is.EqualTo("A \"quoted\" name\\"));
            Assert.That((string)json["tc"]["label"], Is.EqualTo("TC1 & TC2"));
        }

        [Test]
        public void TheKeyIsSentOnlyWhereThereIsSomethingToSay()
        {
            var snapshot = new TelemetrySnapshot { GameRunning = true, GameName = "IRacing" };
            Assert.That(TelemetryFrame.BuildDict(snapshot, demo: false).ContainsKey(TelemetryFrame.CarControlsKey), Is.False,
                "a car the list does not have: the HUD shows what it showed before there was a list");

            snapshot.CarControlsJson = CarControls.Read(List().Find("mx5 mx52016"), new Car().Read, false).ToJson();
            Assert.That(TelemetryFrame.BuildDict(snapshot, demo: false)[TelemetryFrame.CarControlsKey], Is.EqualTo(snapshot.CarControlsJson));
            Assert.That(TelemetryFrame.BuildDict(snapshot, demo: true).ContainsKey(TelemetryFrame.CarControlsKey), Is.False,
                "the demo's car is not the car in the sim");
            Assert.That(TelemetryFrame.CarControlsKey, Is.EqualTo("RacingDesk.Plugin.CarControls"));
        }

        // ── Following the car ──

        [Test]
        public void TheCarHeIsInIsFollowed()
        {
            var said = new List<string>();
            var follower = new CarControlsFollower(List(), said.Add);

            Assert.That(follower.See(null, Gt3().Property, false, true), Is.Null, "no car yet");
            Assert.That(follower.See("ferrari499p", Gt3().Property, false, true), Is.Null, "a car the list does not have");
            Assert.That(follower.CarPath, Is.EqualTo("ferrari499p"));

            var gt3 = JObject.Parse(follower.See("MADEUP GT3", Gt3().Property, false, true));
            Assert.That(((string)gt3["car"], (string)gt3["tc"]["text"]), Is.EqualTo(("madeup gt3", "4")));

            var car = Gt3();
            car["dcTractionControl"] = 6f;
            Assert.That((string)JObject.Parse(follower.See("madeup gt3", car.Property, false, true))["tc"]["text"], Is.EqualTo("6"), "he turned it");

            var mx5 = JObject.Parse(follower.See("mx5 mx52016", new Car().Property, true, true));
            Assert.That(((string)mx5["car"], (bool)mx5["fixedSetup"]), Is.EqualTo(("mx5 mx52016", true)));
            Assert.That(follower.See("", new Car().Property, true, true), Is.Null);
            Assert.That(follower.CarPath, Is.Null);
        }

        [Test]
        public void ReadingTheCarNeverThrows()
        {
            var follower = new CarControlsFollower(List(), _ => { });
            Assert.That(follower.See("madeup gt3", name => throw new InvalidOperationException("the source broke"), false, true), Is.Null);
            Assert.That(follower.See("madeup gt3", null, false, true), Is.Null);
            Assert.That(follower.See("madeup gt3", Gt3().Property, false, true), Is.Not.Null, "and the frame after it is read");
        }

        [Test]
        public void TheSourceSaysWhichCarWhereItCan()
        {
            var was = TelemetryCapture._carControls;
            try
            {
                TelemetryCapture._carControls = new CarControlsFollower(List(), _ => { });
                var source = new Source { Path = "bmwm2csr", Fixed = true };
                source.Car["dcTractionControl"] = 2f;

                var json = JObject.Parse(TelemetryCapture.CarControls(source, inCar: true));
                Assert.That(((string)json["car"], (string)json["tc"]["text"], (bool)json["tc"]["locked"], (bool)json["fixedSetup"]),
                    Is.EqualTo(("bmwm2csr", "ON", true, true)));

                source.Path = null;
                Assert.That(TelemetryCapture.CarControls(source, inCar: true), Is.Null, "before the session has named the car");
                Assert.That(TelemetryCapture.CarControls(new Anonymous(), inCar: true), Is.Null,
                    "a source that cannot say, and no SDK bridge connected to ask");
            }
            finally
            {
                TelemetryCapture._carControls = was;
            }
        }

        private sealed class Source : ITelemetrySource, ICarIdentity
        {
            public readonly Car Car = new Car();
            public string Path;
            public bool? Fixed;
            public string CarPath => Path;
            public bool? FixedSetup => Fixed;
            public bool GameRunning => true;
            public string GameName => "IRacing";
            public object NewData => null;
            public object GetPropertyValue(string fullName) => Car.Property(fullName);
        }

        private sealed class Anonymous : ITelemetrySource
        {
            public bool GameRunning => true;
            public string GameName => "IRacing";
            public object NewData => null;
            public object GetPropertyValue(string fullName) => null;
        }

        // ── The check ──

        private static List<string> Drive(CarListCheck check, Car car, int frames = 120, bool? inCar = true)
        {
            var said = new List<string>();
            for (int i = 0; i < frames; i++) said.AddRange(check.See(car.Read, inCar));
            return said;
        }

        [Test]
        public void ACarThatAgreesWithTheListHasNothingSaidOfIt()
        {
            var list = List();
            Assert.That(Drive(new CarListCheck("mclaren570sgt4", list.Find("mclaren570sgt4")), Mclaren570S()), Is.Empty,
                "dcBrakeBias is published and the list says no bias: it never moves, and that is known of it");
            Assert.That(Drive(new CarListCheck("mx5 mx52016", list.Find("mx5 mx52016")), new Car { ["BrakeABSactive"] = true }), Is.Empty);

            var porsche = Porsche963();
            porsche.Remove("dcBrakeMisc");
            Assert.That(Drive(new CarListCheck("porsche963gtp", list.Find("porsche963gtp")), porsche), Is.Empty,
                "dcABS is published by a car with no ABS, and the list gives it to the brake migration");
        }

        [Test]
        public void ACarThatIsNotInTheListIsSaidOnce()
        {
            var check = new CarListCheck("ferrari499p", null);
            var said = Drive(check, Porsche963());
            Assert.That(said, Has.Count.EqualTo(1));
            Assert.That(said[0], Is.EqualTo("ferrari499p is not in the list: its controls are shown as they were before there was one"));
            Assert.That(check.Remarks, Is.EqualTo(said));
        }

        [Test]
        public void AListedVariableTheCarDoesNotPublishIsSaid()
        {
            var car = Gt3();
            car.Remove("dcABS");
            var said = Drive(new CarListCheck("madeup gt3", List().Find("madeup gt3")), car);
            Assert.That(said, Is.EqualTo(new[] { "madeup gt3 the list gives abs as dcABS, which the car does not publish" }));

            var formula = Drive(new CarListCheck("madeup formula", List().Find("madeup formula")), new Car { ["dcBrakeBias"] = 55f, ["P2P_Status"] = false });
            Assert.That(formula, Is.EqualTo(new[] { "madeup formula the list gives drs as DRS_Status, which the car does not publish" }));
        }

        [Test]
        public void ADialTheListDoesNotHaveIsSaid()
        {
            // The whole of the 963 as it publishes: dcBrakeMisc is its brake target, and the fixture has left it out.
            var said = Drive(new CarListCheck("porsche963gtp", List().Find("porsche963gtp")), Porsche963());
            Assert.That(said, Is.EqualTo(new[] { "porsche963gtp the car publishes dcBrakeMisc, which the list gives to no control" }));
        }

        [Test]
        public void AnAbsDialInACarListedWithoutAbsIsSaid()
        {
            var car = new Car { ["dcABS"] = 3f, ["dcTractionControl"] = 2f, ["dcBrakeBias"] = 50f, ["BrakeABSactive"] = false };
            var said = Drive(new CarListCheck("mx5 mx52016", CarList.Parse(
                @"{ ""cars"": [ { ""path"": ""mx5 mx52016"", ""abs"": ""none"", ""tc"": ""none"", ""brakeBias"": ""none"" } ] }").Find("mx5 mx52016")), car);

            Assert.That(said, Is.EqualTo(new[]
            {
                "mx5 mx52016 the car publishes dcABS, dcTractionControl, which the list gives to no control",
                "mx5 mx52016 the list says no ABS and the car publishes dcABS; in some cars that is another dial under ABS's name",
                "mx5 mx52016 the list says no traction control and the car publishes dcTractionControl",
            }));
        }

        [Test]
        public void AbsSeenWorkingInACarListedWithoutItIsSaid()
        {
            var check = new CarListCheck("porsche963gtp", List().Find("porsche963gtp"));
            var car = Porsche963();
            car.Remove("dcBrakeMisc");
            Assert.That(Drive(check, car), Is.Empty);

            car["BrakeABSactive"] = true;
            Assert.That(Drive(check, car, frames: 30), Is.EqualTo(new[] { "porsche963gtp the list says no ABS and the ABS has been seen working" }));
            Assert.That(Drive(check, car, frames: 300), Is.Empty, "once");
        }

        [Test]
        public void ABiasThatMovesInACarListedWithoutOneIsSaid()
        {
            var check = new CarListCheck("mclaren570sgt4", List().Find("mclaren570sgt4"));
            var car = Mclaren570S();
            Assert.That(Drive(check, car), Is.Empty);

            car["dcBrakeBias"] = 49.5f;
            Assert.That(Drive(check, car, frames: 5), Is.EqualTo(new[]
            {
                "mclaren570sgt4 the list says the brake bias cannot be changed and dcBrakeBias has gone from 49 to 49.5",
            }));
        }

        [Test]
        public void AValueOutsideTheListsRangeOrWithoutANameIsSaid()
        {
            var gt3 = Gt3();
            gt3["dcABS"] = 13f;
            Assert.That(Drive(new CarListCheck("madeup gt3", List().Find("madeup gt3")), gt3),
                Is.EqualTo(new[] { "madeup gt3 dcABS reads 13, outside the list's 1 to 12 for abs" }));

            Assert.That(Drive(new CarListCheck("mclaren570sgt4", List().Find("mclaren570sgt4")), Mclaren570S(3)),
                Is.EqualTo(new[] { "mclaren570sgt4 dcABS reads 3, a position of mode the list has no name for" }));

            var off = Gt3();
            off["dcTractionControl"] = 0f;
            Assert.That(Drive(new CarListCheck("madeup gt3", List().Find("madeup gt3")), off), Is.Empty, "the value that is off is in the list");
        }

        [Test]
        public void AListThatDisagreesWithItselfIsSaidAtOnce()
        {
            var car = CarList.Parse(@"{ ""cars"": [ { ""path"": ""x"", ""abs"": ""none"", ""tc"": ""adjustable"", ""brakeBias"": ""adjustable"", ""controls"": [
                { ""id"": ""abs"", ""var"": ""dcABS"" }, { ""id"": ""brakeBias"", ""label"": ""BB"" } ] } ] }").Find("x");
            var check = new CarListCheck("x", car);

            Assert.That(check.See(null, null), Is.EqualTo(new[]
            {
                "x the list says no ABS and gives the car a control called abs",
                "x the list says the traction control can be turned and gives no control for it, nor a mode that stands for it",
                "x the list says the brake bias can be turned and gives no variable to read it from",
            }), "before a frame has been seen");
        }

        [Test]
        public void NothingIsComparedWhileHeIsOutOfTheCar()
        {
            var car = Gt3();
            car.Remove("dcABS");
            var check = new CarListCheck("madeup gt3", List().Find("madeup gt3"));

            Assert.That(Drive(check, car, frames: 600, inCar: false), Is.Empty, "the garage, a replay: what is published there is not the car's");
            Assert.That(Drive(check, car, frames: 59), Is.Empty, "and not in his first second in it");
            Assert.That(Drive(check, car, frames: 1), Has.Count.EqualTo(1));
            Assert.That(Drive(new CarListCheck("madeup gt3", List().Find("madeup gt3")), car, frames: 60, inCar: null), Has.Count.EqualTo(1),
                "a source that does not say where he is: taken as in");
        }

        [Test]
        public void EachThingIsSaidOncePerCarHoweverOftenHeGetsIn()
        {
            var said = new List<string>();
            var follower = new CarControlsFollower(List(), said.Add);
            var gt3 = Gt3();
            gt3.Remove("dcABS");

            for (int i = 0; i < 100; i++) follower.See("madeup gt3", gt3.Property, false, true);
            for (int i = 0; i < 100; i++) follower.See("ferrari499p", gt3.Property, false, true);
            for (int i = 0; i < 100; i++) follower.See("madeup gt3", gt3.Property, false, true);
            for (int i = 0; i < 100; i++) follower.See("FERRARI499P", gt3.Property, false, true);

            Assert.That(said, Is.EqualTo(new[]
            {
                "madeup gt3 the list gives abs as dcABS, which the car does not publish",
                "ferrari499p is not in the list: its controls are shown as they were before there was one",
            }));
            Assert.That(follower.Remarks.Keys, Is.EquivalentTo(new[] { "madeup gt3", "ferrari499p" }));
            Assert.That(follower.Remarks["Madeup GT3"], Has.Count.EqualTo(1));
        }

        [Test]
        public void ABuildWithNoListSaysNothingOfAnyCar()
        {
            var said = new List<string>();
            var follower = new CarControlsFollower(CarList.Empty, said.Add);
            for (int i = 0; i < 200; i++) Assert.That(follower.See("madeup gt3", Gt3().Property, false, true), Is.Null);
            Assert.That(said, Is.Empty, "every car would be missing from it");
        }

        // ── /racing-desk/data/controls ──

        private static int FreePort()
        {
            var l = new TcpListener(IPAddress.Loopback, 0);
            l.Start();
            int port = ((IPEndPoint)l.LocalEndpoint).Port;
            l.Stop();
            return port;
        }

        private static (HttpStatusCode Status, JObject Body) Get(CarControlsFollower cars, string route)
        {
            int port = FreePort();
            using var listener = new HttpListener();
            listener.Prefixes.Add($"http://127.0.0.1:{port}/racing-desk/"); // not localhost: HTTP.sys binds that on every address
            listener.Start();
            // No store: the list is the assembly's, and is served before there is one.
            var api = new LocalDataApi(Path.Combine(Path.GetTempPath(), "racing-desk-no-store-" + Guid.NewGuid().ToString("N") + ".db")) { Cars = cars };
            var claimed = Task.Run(() => api.TryHandle(listener.GetContext()));

            using var http = new HttpClient();
            using var request = new HttpRequestMessage(HttpMethod.Get, $"http://127.0.0.1:{port}/racing-desk/data/{route}");
            using var response = http.Send(request);
            string text = new StreamReader(response.Content.ReadAsStream(), Encoding.UTF8).ReadToEnd();
            Assert.That(claimed.Result, Is.True);
            return (response.StatusCode, text.Length > 0 ? JObject.Parse(text) : null);
        }

        [Test]
        public void TheListIsServedWithWhatTheCheckHasSaid()
        {
            var follower = new CarControlsFollower(List(), _ => { });
            var gt3 = Gt3();
            gt3.Remove("dcABS");
            for (int i = 0; i < 100; i++) follower.See("madeup gt3", gt3.Property, false, true);

            var (status, body) = Get(follower, "controls");
            Assert.That(status, Is.EqualTo(HttpStatusCode.OK));
            Assert.That(((int)body["version"], (int)body["count"], (string)body["following"]), Is.EqualTo((1, 6, "madeup gt3")));
            Assert.That(body["cars"].Select(c => (string)c["path"]), Does.Contain("porsche963gtp"));
            Assert.That(body["problems"], Is.Empty);
            Assert.That((string)body["remarks"]["madeup gt3"][0], Does.Contain("does not publish"));

            var porsche = body["cars"].Single(c => (string)c["path"] == "porsche963gtp");
            Assert.That(((string)porsche["abs"], (string)porsche["kind"], (string)porsche["checked"]), Is.EqualTo(("none", "prototype", "telemetry")));
            var migration = porsche["controls"].Single(c => (string)c["id"] == "brakeMigration");
            Assert.That(((string)migration["var"], (string)migration["label"], (bool)migration["lockedWhenFixed"]), Is.EqualTo(("dcABS", "MIG", false)));
            Assert.That(migration["range"].Select(n => (double)n), Is.EqualTo(new[] { -6d, 6d }));
            Assert.That((bool)porsche["controls"].Single(c => (string)c["id"] == "tc")["lockedWhenFixed"], Is.True);
            var mode = body["cars"].Single(c => (string)c["path"] == "mclaren570sgt4")["controls"][0];
            Assert.That((string)mode["positions"]["1"], Is.EqualTo("SPORT"));
        }

        [Test]
        public void OneCarIsServedByItsFolder()
        {
            var follower = new CarControlsFollower(List(), _ => { });
            for (int i = 0; i < 100; i++) follower.See("ferrari499p", Gt3().Property, false, true);

            var (status, known) = Get(follower, "controls?car=MX5%20MX52016");
            Assert.That(status, Is.EqualTo(HttpStatusCode.OK));
            Assert.That(((string)known["car"]["path"], (string)known["car"]["abs"]), Is.EqualTo(("mx5 mx52016", "fixed")));
            Assert.That(known["remarks"], Is.Empty);
            Assert.That(known["cars"], Is.Null);

            var (_, unknown) = Get(follower, "controls?car=ferrari499p");
            Assert.That(unknown["car"].Type, Is.EqualTo(JTokenType.Null), "a car the list does not have");
            Assert.That((string)unknown["remarks"][0], Does.Contain("is not in the list"));
        }
    }
}
