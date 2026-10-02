using System;
using System.IO;
using System.Linq;
using NUnit.Framework;
using RacingDesk.Data;
using RacingDesk.Data.Pedals;
using RacingDesk.Data.Restore;
using RacingDesk.Plugin.IRacing;

namespace RacingDesk.Tests.Restore
{
    /// <summary>
    /// The dry run (what trial says it would do), the parked rule, and the director in trial: it says, and it writes and presses
    /// nothing — his made-up files, the made-up SmartControl database and the key sender are held to that byte for byte.
    /// </summary>
    [TestFixture]
    public class TrialTests
    {
        private RestoreRig _rig;
        private const double S = RestorePolicy.StartHeight;

        [SetUp]
        public void SetUp()
        {
            _rig = new RestoreRig();
            _rig.AppIni(S);
            _rig.CameraIni(("porsche963gtp", ""), ("hondacivictyper", @"cars\hondacivictyper\car.cam"));
            _rig.Cam("porsche963gtp", -0.11f, 0f, 0.01f);
            _rig.Cam("hondacivictyper", 0f, -0.04f);
            _rig.Cam("mx5 mx52016", 0f, 0f);
            _rig.Cam("porsche9922cup", -0.09f, -0.04f);
            _rig.SmartControl();
            _rig.StoreWithCars(
                ("porsche963gtp", "Porsche 963 GTP", -0.02, true, 0.0, "Default", RestoreRig.DefaultId, 70.0, "rule"),
                ("hondacivictyper", "Honda Civic Type R TCR", 0.02, true, -0.04, "LightBrake", RestoreRig.LightId, null, "driver"),
                ("mx5 mx52016", "Mazda MX-5 Cup", 0.015, true, 0.0, "LightBrake", RestoreRig.LightId, 35.0, "rule"),
                ("porsche9922cup", "Porsche 911 Cup (992.2)", -0.015, false, -0.04, "LightBrake", RestoreRig.LightId, null, "rule"),
                ("dallaraf3", "Dallara F312 F3", 0.0, true, null, "Default", RestoreRig.DefaultId, 90.0, "rule"),
                ("formulair04", "FIA F4", 0.06, true, 0.01, "Default", RestoreRig.DefaultId, 85.0, "rule"));
            _rig.Cam("formulair04", -0.1f, 0.01f);
        }

        [TearDown] public void TearDown() => _rig.Dispose();

        private RestorePlan Plan()
        {
            using var store = new RacingDeskStore(_rig.Store);
            return RestorePlanner.Plan(store, _rig.Files(), SmartControl.Read(_rig.SmartControlDb));
        }

        [Test]
        public void TheDryRun_SaysEachCarsHeightAndProfile_ByHisDecisions()
        {
            var plan = Plan();
            var v = plan.Views.ToDictionary(x => x.Car);
            // new Z = the height he chose + the Z he drove with − S
            Assert.That((v["hondacivictyper"].State, v["hondacivictyper"].NewZ), Is.EqualTo(("would-move", (double?)0.0)), "+2.0 cm with Z −4.0 cm is −2.0 cm in all: Z 0 with app.ini at −2.0 cm");
            Assert.That(v["hondacivictyper"].FromLastCarSet, Is.True);
            Assert.That(v["mx5 mx52016"].NewZ, Is.EqualTo(0.035).Within(1e-9));
            Assert.That(v["porsche963gtp"].State, Is.EqualTo("already"), "−2.0 cm and Z 0: nothing to move");
            Assert.That(v["porsche9922cup"].State, Is.EqualTo("inherited"));
            Assert.That(v["porsche9922cup"].Words, Does.Contain("−6.0 cm"), "its file's −4.0 cm on S: what a car with nothing saved starts at");
            Assert.That(v["dallaraf3"].State, Is.EqualTo("no-file"));
            Assert.That(v["dallaraf3"].Words, Does.Contain("Ctrl+F12"));
            Assert.That(v["formulair04"].State, Is.EqualTo("beyond"), "+6 cm + 1 cm − (−2 cm) is 9 cm: beyond ±5 cm, so nothing");

            var b = plan.Brakes.ToDictionary(x => x.Car);
            Assert.That((b["porsche963gtp"].State, b["porsche963gtp"].Kg, b["porsche963gtp"].KgFrom, b["porsche963gtp"].BaseName), Is.EqualTo(("would-make", (int?)70, "stored", "Default")));
            Assert.That((b["hondacivictyper"].Kg, b["hondacivictyper"].KgFrom), Is.EqualTo(((int?)45, "base")), "never set in this car: LightBrake's own 45 kg");
            Assert.That((b["dallaraf3"].Kg, b["dallaraf3"].KgFrom), Is.EqualTo(((int?)90, "stored")));
            Assert.That(b["porsche9922cup"].Kg, Is.EqualTo(45));
            Assert.That(b["porsche963gtp"].ProfileName, Is.EqualTo("Porsche 963 GTP"), "named for the car");
            Assert.That(plan.Lines.First(), Does.Contain("app.ini holds −2.0 cm"));
            Assert.That(plan.Lines, Has.Some.Contains("F24 · Set profile"), "the switch profile and the key, once, in the first run");
        }

        [Test]
        public void ACarWhoseBaseHeChoseNotToHave_GetsNone_AndAForceOutsideTheLimits_IsTheBases()
        {
            using (var store = new RacingDeskStore(_rig.Store))
            {
                store.UnbindCarPedals("mx5 mx52016");
                store.NotePedalsGiven("mx5 mx52016", "none", null, DateTime.UtcNow);
                store.NotePedals("porsche9922cup", 140, true, 0, DateTime.UtcNow);
            }
            var b = Plan().Brakes.ToDictionary(x => x.Car);
            Assert.That(b["mx5 mx52016"].State, Is.EqualTo("none"));
            Assert.That((b["porsche9922cup"].Kg, b["porsche9922cup"].KgFrom), Is.EqualTo(((int?)45, "base")), "140 kg is not one Racing Desk writes");
        }

        [Test]
        public void TheParkedRule_IsTheGarageScreenOrThePitStall_StillForASecond_TheBrakeReleased()
        {
            var at = new DateTime(2026, 10, 2, 20, 0, 0, DateTimeKind.Utc);
            SeatFacts F(double t, bool onTrack = false, bool garage = true, int surface = -1, bool pitRoad = false, double speed = 0, double brake = 0, string mode = "full", bool replay = true) =>
                new SeatFacts { CarPath = "porsche963gtp", IsOnTrack = onTrack, IsInGarage = garage, IsReplayPlaying = replay, TrackSurface = surface, OnPitRoad = pitRoad, SpeedMs = speed, Brake = brake, SimMode = mode, AtUtc = at.AddSeconds(t) };

            Assert.That(ParkedRule.Place(F(0), out _), Is.EqualTo("garage screen"), "a replay may play behind the garage screen: SimMode says it is not a replay file");
            Assert.That(ParkedRule.Place(F(0, mode: "replay"), out string why), Is.Null);
            Assert.That(why, Is.EqualTo("a replay file"));
            Assert.That(ParkedRule.Place(F(0, onTrack: true, garage: false, surface: 1, pitRoad: true, replay: false), out _), Is.EqualTo("pit stall"));
            Assert.That(ParkedRule.Place(F(0, onTrack: true, garage: false, surface: 3, pitRoad: true, replay: false), out why), Is.Null);
            Assert.That(why, Is.EqualTo("in the pit lane"));
            Assert.That(ParkedRule.Place(F(0, onTrack: true, garage: false, surface: 3, replay: false), out why), Is.Null);
            Assert.That(why, Is.EqualTo("on track"));
            Assert.That(ParkedRule.Place(F(0, garage: false), out why), Is.Null);

            var rule = new ParkedRule();
            Assert.That(rule.Parked(F(0), out _, out why), Is.False);
            Assert.That(why, Is.EqualTo("not still for a second yet"));
            Assert.That(rule.Parked(F(0.6), out _, out _), Is.False);
            Assert.That(rule.Parked(F(1.1, brake: 0.3), out _, out why), Is.False);
            Assert.That(why, Is.EqualTo("the brake is pressed"));
            Assert.That(rule.Parked(F(1.2), out string place, out _), Is.True);
            Assert.That(place, Is.EqualTo("garage screen"));
            Assert.That(rule.Parked(F(1.3, speed: 2), out _, out why), Is.False, "moving off starts the second again");
            Assert.That(rule.Parked(F(1.4), out _, out _), Is.False);
        }

        private RestoreDirector Director() => new RestoreDirector(_rig.Context(), Path.Combine(_rig.Dir, "restore.json"));

        private static SeatFacts Garage(string car, string name, double t = 0) => new SeatFacts
        {
            CarPath = car, CarName = name, IsOnTrack = false, IsInGarage = true, IsReplayPlaying = true, TrackSurface = -1, SimMode = "full",
            AtUtc = new DateTime(2026, 10, 2, 20, 0, 0, DateTimeKind.Utc).AddSeconds(t),
        };

        [Test]
        public void InTrial_TheDirectorSaysWhatItWouldDo_AndWritesAndPressesNothing()
        {
            string dbSha = _rig.FileSha(_rig.SmartControlDb);
            byte[] ini = _rig.AppIniBytes();
            byte[] cam = File.ReadAllBytes(_rig.CamPath("porsche963gtp"));
            var director = Director();
            director.HostStarted();
            for (int i = 0; i <= 30; i++) director.See(Garage("porsche963gtp", "Porsche 963 GTP", i * 0.05));
            director.PedalsLeft(new PedalsSeen { CarPath = "porsche963gtp", ForceKg = 75, Presses = 1, SeenAtUtc = DateTime.UtcNow });
            director.ViewRunEnded(new ViewRun
            {
                CarPath = "porsche963gtp",
                Before = ViewSettings.Parse(RestoreRig.AppIniText(S)),
                View = new CarView { CarPath = "porsche963gtp", DriverHeight = -0.015, VanishY = 0.19 },
            });
            director.SimGone();
            Assert.That(director.Settled().Wait(TimeSpan.FromSeconds(20)), Is.True);

            using var store = new RacingDeskStore(_rig.Store);
            var lines = store.RestoreEvents().Select(e => e.Text).ToList();
            Assert.That(lines, Has.Some.Contains("would make its own SmartControl profile 'Porsche 963 GTP' from Default at 70 kg"));
            Assert.That(lines, Has.Some.EqualTo("Trial: brakes Porsche 963 GTP · 70 kg"), "the HUD's line");
            Assert.That(lines, Has.Some.EqualTo("Trial: height Porsche 963 GTP · −2.0 cm (its camera file)"));
            Assert.That(lines, Has.Some.Contains("parked (garage screen, still for a second, brake released): would press F24 now"));
            Assert.That(lines, Has.Some.Contains("would write 75 kg, the force your keys left"));
            Assert.That(lines, Has.Some.Contains("would keep +0.5 cm in its camera file (cockpit Z 0.0 cm → +0.5 cm)"));
            Assert.That(store.RestoreEvents().Where(e => e.Hud).Select(e => e.Text), Has.All.StartWith("Trial: "));

            // Nothing written, nothing pressed.
            Assert.That(_rig.FileSha(_rig.SmartControlDb), Is.EqualTo(dbSha), "SmartControl's database, to the byte");
            Assert.That(_rig.AppIniBytes(), Is.EqualTo(ini));
            Assert.That(File.ReadAllBytes(_rig.CamPath("porsche963gtp")), Is.EqualTo(cam));
            Assert.That(_rig.Keys.Sent, Is.Zero);
            Assert.That(Directory.Exists(_rig.Backups), Is.False, "nothing was backed up, because nothing was going to be written");
            Assert.That(store.CarSmartControls(), Is.Empty);
            Assert.That(store.SmartControlSwitchRow(), Is.Null);
            Assert.That(store.CarViewKeeps(), Is.Empty);
        }

        [Test]
        public void InTrial_AParkedMomentSaysWhyItWouldNotSwitch()
        {
            _rig.Probe.Live = false;
            var director = Director();
            for (int i = 0; i <= 30; i++) director.See(Garage("mx5 mx52016", "Mazda MX-5 Cup", i * 0.05));
            Assert.That(director.Settled().Wait(TimeSpan.FromSeconds(20)), Is.True);
            using var store = new RacingDeskStore(_rig.Store);
            Assert.That(store.RestoreEvents().Select(e => e.Text), Has.Some.Contains("would not switch the brakes: SmartControl Live isn't running"));
            Assert.That(_rig.Keys.Sent, Is.Zero);
        }

        [Test]
        public void TheFold_InWords_FollowsTheCritiquesRules()
        {
            var cam = new CamFileState { Exists = true, Writable = true, Z = -0.04 };
            ViewRun Run(double start, double end) => new ViewRun
            {
                CarPath = "porsche9922cup",
                Before = ViewSettings.Parse(RestoreRig.AppIniText(start)),
                View = new CarView { DriverHeight = end },
            };
            Assert.That(RestoreDirector.FoldWords(Run(S, S), cam, S, false), Is.Null, "nothing changed, nothing to say");
            Assert.That(RestoreDirector.FoldWords(Run(S, -0.025), cam, S, false), Does.Contain("cockpit Z −4.0 cm → −4.5 cm"));
            Assert.That(RestoreDirector.FoldWords(Run(-0.035, -0.035), cam, S, false), Does.Contain("a leftover you did not change: nothing would be kept"), "H2: a bad start is not folded");
            Assert.That(RestoreDirector.FoldWords(Run(-0.035, -0.03), cam, S, false), Does.Contain("would keep what you last saw: cockpit Z −4.0 cm → −5.0 cm"), "H2: Z = exit + Z − S");
            Assert.That(RestoreDirector.FoldWords(Run(S, -0.04), cam, S, false), Does.Contain("beyond"), "−4.0 cm and −2.0 cm more is −6.0 cm: beyond ±5 cm");
            Assert.That(RestoreDirector.FoldWords(Run(S, -0.01), new CamFileState { Exists = false }, S, false), Does.Contain("no camera file"));
        }

        [Test]
        public void TheSwitchesAreKept_AndOffSaysNothing()
        {
            string file = Path.Combine(_rig.Dir, "restore.json");
            var director = new RestoreDirector(_rig.Context(), file);
            Assert.That((director.Switches.Height, director.Switches.Brakes, director.Switches.Horizon), Is.EqualTo((true, true, false)), "on, in trial; the horizon off");
            director.SetSwitches(false, false, null);
            Assert.That(RestoreSwitches.Load(file).Height, Is.False);
            var again = new RestoreDirector(_rig.Context(), file);
            Assert.That((again.Switches.Height, again.Switches.Brakes), Is.EqualTo((false, false)));
            for (int i = 0; i <= 30; i++) again.See(Garage("porsche963gtp", "Porsche 963 GTP", i * 0.05));
            again.Settled().Wait(TimeSpan.FromSeconds(20));
            director.Settled().Wait(TimeSpan.FromSeconds(20));
            using var store = new RacingDeskStore(_rig.Store);
            Assert.That(store.RestoreEvents().Where(e => e.What != "setup"), Is.Empty, "switched off, nothing is said of a car");
        }

        [Test]
        public void ThisBuildNeverLeavesTrial_WhateverTheMarksSay()
        {
            Assert.That(RestorePolicy.ActingBuilt, Is.False);
            var all = RestoreGate.Steps.Select(s => new RestoreCheck { Step = s.Id, Mark = "passed" }).ToList();
            Assert.That(RestoreGate.BrakesProven(all) && RestoreGate.HeightProven(all), Is.True, "every check passed");
            Assert.That(RestoreGate.Acts(true, true), Is.False, "and still trial: the loop that acts is the next build's");
            Assert.That(RestoreGate.SeedForceAfterSwitch(all), Is.False, "his +5/−5 count from the profile's force only once the switch is proven, in a build that switches");
            Assert.That(RestoreGate.BrakesProven(all.Where(c => c.Step != "A5")), Is.False, "A4–A6 and B2 are what the brakes need");
            Assert.That(RestoreGate.HeightProven(all.Where(c => c.Step != "B4")), Is.False, "B1, B4 and B5 are what the height needs");
        }
    }
}
