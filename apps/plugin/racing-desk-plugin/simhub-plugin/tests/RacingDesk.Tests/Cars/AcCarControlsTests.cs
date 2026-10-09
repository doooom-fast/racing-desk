using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using RacingDesk.Core.Cars;
using RacingDesk.Plugin.Engine;
using RacingDesk.Plugin.Transport;

namespace RacingDesk.Tests.Cars
{
    /// <summary>
    /// The HUD in Assetto Corsa and Assetto Corsa EVO through SimHub (asked for 2026-10-09): the three cells from the
    /// shared memory, nothing of iRacing's made up for another sim, and the frame the HUD is sent. The source is a fake
    /// shaped as SimHub's data is: a normalized object read by property name, and raw properties by their full names.
    /// </summary>
    [TestFixture]
    public class AcCarControlsTests
    {
        private const string Raw = "DataCorePlugin.GameRawData.";
        private const string ControlsKey = "RacingDesk.Plugin.CarControls";
        private const string InCarKey = "DataCorePlugin.GameRawData.Telemetry.IsOnTrack";

        /// <summary>SimHub's normalized game data, as far as the capture reads it.</summary>
        private sealed class Normalized
        {
            public string CarModel { get; set; } = "";
            public double SpeedKmh { get; set; }
            public double Rpms { get; set; }
            public string Gear { get; set; } = "3";
            public string SessionTypeName { get; set; } = "Practice";
            public string PlayerName { get; set; } = "";
            public bool IsReplayPlaying { get; set; }
            public IEnumerable<object> Opponents { get; set; } = null;
        }

        private sealed class Source : ITelemetrySource
        {
            public readonly Dictionary<string, object> Values = new Dictionary<string, object>();
            public Normalized Data = new Normalized();
            public string Game = "AssettoCorsa";
            public bool GameRunning => true;
            public string GameName => Game;
            public object NewData => Data;
            public object GetPropertyValue(string fullName) => Values.TryGetValue(fullName, out var v) ? v : null;
            public string OpponentName(object opponent) => null;
        }

        private static Source Assetto(string car = "ks_porsche_911_gt3_r_2016", string game = "AssettoCorsa")
        {
            var s = new Source { Game = game };
            s.Data.CarModel = car;
            s.Values[Raw + "Graphics.Status"] = 2;   // AC_LIVE
            return s;
        }

        private static JObject Controls(TelemetrySnapshot s)
        {
            Assert.That(s.CarControlsJson, Is.Not.Null.And.Not.Empty, "the three cells are sent");
            return JObject.Parse(s.CarControlsJson);
        }

        [SetUp]
        public void FreshMemory()
        {
            TelemetryCapture._acControls = new AcCarControls();
        }

        [Test]
        public void TheBiasIsThePhysicsPagesToOnePlace_AndTheAidsAreADashUntilSeenWorking()
        {
            var source = Assetto();
            source.Values[Raw + "Physics.BrakeBias"] = 0.572f;
            source.Values[Raw + "Physics.Abs"] = 0f;
            source.Values[Raw + "Physics.TC"] = 0f;

            var cc = Controls(TelemetryCapture.Capture(source));
            Assert.That((string)cc["car"], Is.EqualTo("ks_porsche_911_gt3_r_2016"));
            Assert.That((string)cc["bb"]["state"], Is.EqualTo("value"));
            Assert.That((double)cc["bb"]["value"], Is.EqualTo(57.2).Within(0.001));
            Assert.That((string)cc["bb"]["words"], Is.EqualTo("Bias"));
            Assert.That(cc["bb"]["fill"], Is.Null, "no range is known for the car, so no bar is made up");
            Assert.That((string)cc["abs"]["state"], Is.EqualTo("unread"), "nothing has said the car has anti-lock");
            Assert.That((string)cc["abs"]["words"], Is.EqualTo("Anti-lock"));
            Assert.That((string)cc["abs"]["label"], Is.EqualTo("ABS"));
            Assert.That((string)cc["tc"]["state"], Is.EqualTo("unread"));
            Assert.That((string)cc["tc"]["words"], Is.EqualTo("Traction"));
            Assert.That(cc["more"], Is.Null, "no other controls are known");
            Assert.That(cc["drs"], Is.Null);
        }

        [Test]
        public void AnAidSeenWorkingIsOn_AndStaysSoForTheCar()
        {
            var source = Assetto();
            source.Values[Raw + "Physics.Abs"] = 0f;
            source.Values[Raw + "Physics.TC"] = 0f;
            var first = TelemetryCapture.Capture(source);
            Assert.That(first.HasABS, Is.False);
            Assert.That(first.HasTC, Is.False);

            source.Values[Raw + "Physics.Abs"] = 0.35f;     // braking hard into the hairpin
            var braking = TelemetryCapture.Capture(source);
            var cc = Controls(braking);
            Assert.That((string)cc["abs"]["state"], Is.EqualTo("on"));
            Assert.That((string)cc["abs"]["text"], Is.EqualTo("On"));
            Assert.That((string)cc["abs"]["var"], Is.EqualTo("Physics.Abs"));
            Assert.That((string)cc["tc"]["state"], Is.EqualTo("unread"), "traction has not shown itself");
            Assert.That(braking.HasABS, Is.True);
            Assert.That(braking.HasTC, Is.False);

            source.Values[Raw + "Physics.Abs"] = 0f;        // the straight
            source.Values[Raw + "Physics.TC"] = 0.6f;
            cc = Controls(TelemetryCapture.Capture(source));
            Assert.That((string)cc["abs"]["state"], Is.EqualTo("on"), "the car has it: seen once is enough");
            Assert.That((string)cc["tc"]["state"], Is.EqualTo("on"));

            // Off is never said in Assetto Corsa: the memory has no level, and no intervention is not the aid being off.
            Assert.That(cc.ToString(), Does.Not.Contain("\"off\""));
        }

        [Test]
        public void TheAidsAreReadUnderTheSpellingsSimHubMayGiveThem()
        {
            var source = Assetto();
            source.Values[Raw + "Physics.abs"] = 0.2;        // the lower-case field name
            source.Values[Raw + "Physics.tc"] = "0.4";       // as text
            source.Values[Raw + "Physics.brakeBias"] = 0.61;
            var cc = Controls(TelemetryCapture.Capture(source));
            Assert.That((string)cc["abs"]["state"], Is.EqualTo("on"));
            Assert.That((string)cc["tc"]["state"], Is.EqualTo("on"));
            Assert.That((double)cc["bb"]["value"], Is.EqualTo(61).Within(0.001));
        }

        [Test]
        public void WhatIsNotANumberIsNotRead_AndABiasAlreadyInPercentIsTakenAsOne()
        {
            var source = Assetto();
            source.Values[Raw + "Physics.BrakeBias"] = "front";
            source.Values[Raw + "Physics.Abs"] = "working";
            var cc = Controls(TelemetryCapture.Capture(source));
            Assert.That((string)cc["bb"]["state"], Is.EqualTo("unread"));
            Assert.That((string)cc["abs"]["state"], Is.EqualTo("unread"));

            source.Values[Raw + "Physics.BrakeBias"] = 57.2;
            cc = Controls(TelemetryCapture.Capture(source));
            Assert.That((double)cc["bb"]["value"], Is.EqualTo(57.2).Within(0.001));

            source.Values[Raw + "Physics.BrakeBias"] = 0.0;
            cc = Controls(TelemetryCapture.Capture(source));
            Assert.That((string)cc["bb"]["state"], Is.EqualTo("unread"), "nought is a frame of nothing, not a bias");
        }

        [Test]
        public void AnotherCarStartsFromNothingKnown()
        {
            var source = Assetto("ks_ferrari_488_gt3");
            source.Values[Raw + "Physics.Abs"] = 0.3f;
            Assert.That((string)Controls(TelemetryCapture.Capture(source))["abs"]["state"], Is.EqualTo("on"));

            source.Data.CarModel = "ks_lotus_49";
            source.Values[Raw + "Physics.Abs"] = 0f;
            var cc = Controls(TelemetryCapture.Capture(source));
            Assert.That((string)cc["car"], Is.EqualTo("ks_lotus_49"));
            Assert.That((string)cc["abs"]["state"], Is.EqualTo("unread"), "a 1967 car: nothing says it has anti-lock, and nothing says it has not");
        }

        [Test]
        public void NoCarNoCells()
        {
            var source = Assetto("");
            var s = TelemetryCapture.Capture(source);
            Assert.That(s.CarControlsJson, Is.Null);
            Assert.That(TelemetryFrame.BuildDict(s, demo: false).ContainsKey(ControlsKey), Is.False);
        }

        [Test]
        public void EvoShowsItsLevels_OffOnlyOnceTheCarIsKnownToHaveTheAid()
        {
            var source = Assetto("ks_bmw_m4_gt3", "AssettoCorsaEVO");
            source.Values[Raw + "Graphics.electronics.abs_level"] = 3;
            source.Values[Raw + "Graphics.electronics.tc_level"] = 0;
            source.Values[Raw + "Physics.brake_bias"] = 0.548;

            var s = TelemetryCapture.Capture(source);
            var cc = Controls(s);
            Assert.That((string)cc["abs"]["state"], Is.EqualTo("value"));
            Assert.That((int)cc["abs"]["value"], Is.EqualTo(3));
            Assert.That((string)cc["abs"]["var"], Is.EqualTo("Graphics.electronics.abs_level"));
            Assert.That((string)cc["tc"]["state"], Is.EqualTo("unread"), "a level of nought on a car not known to have the dial is not Off");
            Assert.That((double)cc["bb"]["value"], Is.EqualTo(54.8).Within(0.001));
            Assert.That(s.AbsSetting, Is.EqualTo(3), "the level is the setting the old keys carry too");
            Assert.That(s.TractionControlSetting, Is.EqualTo(0));
            Assert.That(s.HasABS, Is.True);
            Assert.That(s.HasTC, Is.False);

            source.Values[Raw + "Graphics.tc_active"] = true;    // the traction control cuts in: the car has it
            cc = Controls(TelemetryCapture.Capture(source));
            Assert.That((string)cc["tc"]["state"], Is.EqualTo("off"), "a level of nought on a car known to have it");
            Assert.That((string)cc["tc"]["text"], Is.EqualTo("Off"));

            source.Values[Raw + "Graphics.electronics.tc_level"] = 5;
            source.Values[Raw + "Graphics.tc_active"] = false;
            cc = Controls(TelemetryCapture.Capture(source));
            Assert.That((int)cc["tc"]["value"], Is.EqualTo(5));
            Assert.That((string)cc["tc"]["state"], Is.EqualTo("value"));
        }

        [Test]
        public void EvoWithoutItsLevelsGoesByTheAidWorking_AsAssettoCorsaDoes()
        {
            var source = Assetto("ks_porsche_992_gt3_cup", "AssettoCorsaEVO");
            source.Values[Raw + "Physics.abs"] = 0f;
            var cc = Controls(TelemetryCapture.Capture(source));
            Assert.That((string)cc["abs"]["state"], Is.EqualTo("unread"));

            source.Values[Raw + "Physics.abs"] = 0.5f;
            cc = Controls(TelemetryCapture.Capture(source));
            Assert.That((string)cc["abs"]["state"], Is.EqualTo("on"));
        }

        [Test]
        public void TheFrameTheHudIsSentInAssettoCorsa()
        {
            var source = Assetto();
            source.Values[Raw + "Physics.BrakeBias"] = 0.55f;
            var s = TelemetryCapture.Capture(source);
            var dict = TelemetryFrame.BuildDict(s, demo: false);

            Assert.That(dict["RacingDesk.Plugin.GameId"], Is.EqualTo("AssettoCorsa"));
            Assert.That(dict[InCarKey], Is.EqualTo(1), "in the car: the graphics page's status is live");
            Assert.That(dict.ContainsKey(ControlsKey), Is.True);
            Assert.That(dict.ContainsKey(TelemetryFrame.SessionFlagsKey), Is.False, "iRacing's flag field is not made up for another sim");
            Assert.That(dict.ContainsKey(TelemetryFrame.SessionNumKey), Is.False);
            Assert.That(dict.ContainsKey(TelemetryFrame.SessionTimeKey), Is.False);
            Assert.That(dict["IRacingExtraProperties.iRacing_DriverInfo_IRating"], Is.EqualTo(0));
            Assert.That(dict["RacingDesk.Plugin.DS.IncidentCount"], Is.EqualTo(0));

            source.Values[Raw + "Graphics.Status"] = 1;   // a replay
            dict = TelemetryFrame.BuildDict(TelemetryCapture.Capture(source), demo: false);
            Assert.That(dict[InCarKey], Is.EqualTo(0));
        }

        [Test]
        public void AnIRatingKnownFromIRacingIsNotShownInAssettoCorsa()
        {
            // The capture keeps the last known iRating so that a frame without it does not flash a dash; one SimHub run
            // may hold an iRacing session and then an Assetto Corsa one, and the number is iRacing's alone.
            var iracing = new Source { Game = "IRacing" };
            iracing.Data.CarModel = "porsche992cup";
            iracing.Values["IRacingExtraProperties.iRacing_DriverInfo_IRating"] = 2847;
            iracing.Values["IRacingExtraProperties.iRacing_DriverInfo_SafetyRating"] = 3.21;
            var before = TelemetryCapture.Capture(iracing);
            Assert.That(before.IRating, Is.EqualTo(2847));

            var s = TelemetryCapture.Capture(Assetto());
            Assert.That(s.IRating, Is.EqualTo(0));
            Assert.That(s.SafetyRating, Is.EqualTo(0));
            Assert.That(s.LicenseString, Is.Empty);
            Assert.That(s.EstimatedIRatingDelta, Is.EqualTo(int.MinValue), "no data: the HUD shows a dash");

            // Back in iRacing the cache is what it was.
            iracing.Values.Remove("IRacingExtraProperties.iRacing_DriverInfo_IRating");
            Assert.That(TelemetryCapture.Capture(iracing).IRating, Is.EqualTo(2847));
        }

        [Test]
        public void IRacingIsAsItWas_TheListsCellsAndNotTheseForItsCars()
        {
            var iracing = new Source { Game = "IRacing" };
            iracing.Data.CarModel = "porsche992cup";
            iracing.Values[Raw + "Physics.Abs"] = 0.5f;   // another sim's key, if it were ever there
            var s = TelemetryCapture.Capture(iracing);
            // No car identity source and no SDK bridge in this test: the list cannot be asked, and nothing of Assetto Corsa's fills in.
            Assert.That(s.CarControlsJson, Is.Null);
        }
    }
}
