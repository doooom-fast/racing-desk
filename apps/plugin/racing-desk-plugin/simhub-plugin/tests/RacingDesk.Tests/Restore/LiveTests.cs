using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using Microsoft.Data.Sqlite;
using NUnit.Framework;
using RacingDesk.Data;
using RacingDesk.Data.Pedals;
using RacingDesk.Data.Restore;
using RacingDesk.Plugin.IRacing;

namespace RacingDesk.Tests.Restore
{
    /// <summary>
    /// A made-up rig in a folder of the test's own (app.ini, camera files, SmartControl's database, the store), a probe that says
    /// what the test says, a key sender that sends nothing and counts, and a clock the test holds.
    /// </summary>
    public abstract class LiveRig
    {
        private protected RestoreRig _rig;
        protected RestoreContext _ctx;
        protected DateTime _clock;
        protected const double S = RestorePolicy.StartHeight;
        protected const string Gtp = "porsche963gtp", GtpName = "Porsche 963 GTP";

        [SetUp]
        public void MakeTheRig()
        {
            _rig = new RestoreRig();
            _rig.AppIni(S);
            _rig.CameraIni((Gtp, ""), ("hondacivictyper", @"cars\hondacivictyper\car.cam"));
            _rig.Cam(Gtp, -0.11f, 0f);
            _rig.Cam("hondacivictyper", 0f, -0.04f);
            _rig.Cam("mx5 mx52016", 0f, 0f);
            _rig.Cam("porsche9922cup", -0.09f, -0.04f);
            _rig.Cam("formulair04", -0.1f, 0.01f);
            _rig.SmartControl();
            _rig.StoreWithCars(
                (Gtp, GtpName, S, false, 0.0, "Default", RestoreRig.DefaultId, 70.0, "rule"),
                ("hondacivictyper", "Honda Civic Type R TCR", 0.02, true, -0.04, "LightBrake", RestoreRig.LightId, null, "driver"),
                ("mx5 mx52016", "Mazda MX-5 Cup", 0.015, true, 0.0, "LightBrake", RestoreRig.LightId, 35.0, "rule"),
                ("porsche9922cup", "Porsche 911 Cup (992.2)", -0.015, false, -0.04, "LightBrake", RestoreRig.LightId, null, "rule"),
                ("dallaraf3", "Dallara F312 F3", 0.0, true, null, "Default", RestoreRig.DefaultId, 90.0, "rule"),
                ("formulair04", "FIA F4", 0.06, true, 0.01, "Default", RestoreRig.DefaultId, 85.0, "rule"));
            _clock = new DateTime(2026, 10, 2, 20, 0, 0, DateTimeKind.Utc);
            _ctx = _rig.Context();
            _ctx.Now = () => _clock;
            _rig.Probe.Sim = false;
            _rig.Probe.Editor = false;
            _rig.Probe.Live = true;
            _rig.Probe.LiveStarted = _clock.AddHours(-1);     // since Windows started, before anything Racing Desk wrote
        }

        [TearDown] public void TearDownTheRig() => _rig.Dispose();

        protected RestoreDirector Director() => new RestoreDirector(_ctx, Path.Combine(_rig.Dir, "restore.json"));

        protected static void Settle(RestoreDirector d) => Assert.That(d.Settled().Wait(TimeSpan.FromSeconds(30)), Is.True, "the director's work finished");

        /// <summary>The host starts with iRacing closed (the profile and F24 are made), and then SmartControl Live starts again.</summary>
        protected RestoreDirector Started()
        {
            var d = Director();
            d.HostStarted();
            Settle(d);
            _clock = _clock.AddMinutes(1);
            _rig.Probe.LiveStarted = _clock;
            _clock = _clock.AddMinutes(1);
            return d;
        }

        protected SeatFacts Garage(string car = Gtp, string name = GtpName, double speed = 0, double brake = 0, string mode = "full") => new SeatFacts
        {
            CarPath = car, CarName = name, IsOnTrack = false, IsInGarage = true, IsReplayPlaying = true, TrackSurface = -1, SimMode = mode,
            SpeedMs = speed, Brake = brake, AtUtc = _clock,
        };

        protected SeatFacts OnTrack(string car = Gtp, string name = GtpName) => new SeatFacts
        {
            CarPath = car, CarName = name, IsOnTrack = true, TrackSurface = 3, SimMode = "full", SpeedMs = 40, AtUtc = _clock,
        };

        /// <summary>Frames every 50 ms for <paramref name="seconds"/>, the sim in front, then what they queued is waited for.</summary>
        protected void Drive(RestoreDirector d, double seconds, Func<SeatFacts> frame = null)
        {
            _rig.Probe.Sim = true;
            if (_rig.Probe.Front == "notepad") _rig.Probe.Front = "iRacingSim64DX11";
            int frames = (int)Math.Round(seconds / 0.05);
            for (int i = 0; i <= frames; i++)
            {
                d.See(frame?.Invoke() ?? Garage());
                if (i < frames) _clock = _clock.AddMilliseconds(50);
                if (i % 20 == 0) Settle(d);
            }
            Settle(d);
        }

        protected RacingDeskStore Store() => new RacingDeskStore(_rig.Store);

        protected SmartControlSwitch Switch()
        {
            using var store = Store();
            return store.SmartControlSwitchRow();
        }

        protected List<string> Lines()
        {
            using var store = Store();
            return store.RestoreEvents(0, 500).Select(e => e.Text).ToList();
        }

        protected SmartControlProfile Row(string id) => SmartControl.Read(_rig.SmartControlDb).Profiles.SingleOrDefault(p => p.Id == id);

        protected ViewRun Run(string car, double start, double end) => new ViewRun
        {
            CarPath = car,
            Before = ViewSettings.Parse(RestoreRig.AppIniText(start)),
            View = new CarView { CarPath = car, DriverHeight = end, VanishY = 0.19, Chosen = Math.Abs(end - start) > 1e-9 },
        };

        /// <summary>The sim has gone, and wrote app.ini with the height he left the car with: the recorder hands the run on.</summary>
        protected void Exit(RestoreDirector d, string car, double start, double end)
        {
            d.SimGone();
            _rig.Probe.Sim = false;
            _rig.AppIni(end);
            d.ViewRunEnded(Run(car, start, end));
            Settle(d);
        }
    }

    /// <summary>The brakes: the live loop writes the car's brakes into Racing Desk's profile and presses F24 once, parked, and only then.</summary>
    [TestFixture]
    public class LiveBrakesTests : LiveRig
    {
        [Test]
        public void AtACarLoad_Parked_TheCarsBrakesAreWrittenAndF24IsPressedOnce()
        {
            var before = SmartControl.Read(_rig.SmartControlDb);
            var d = Director();
            d.HostStarted();
            Settle(d);
            var sw = Switch();
            Assert.That(sw, Is.Not.Null, "the profile and the key were made at the host's start, with the editor closed");
            Assert.That(sw.BindingId, Is.Not.Null);
            Assert.That(sw.BoundAtUtc, Is.EqualTo(_clock));
            Assert.That(d.Status().Brakes.Text, Is.EqualTo("Starts working the next time SmartControl Live starts: quit it from its tray icon and start it again, or restart the PC."));
            Assert.That(Lines(), Has.Some.EqualTo("Racing Desk added its own profile 'Racing Desk', a copy of Default and F24 · Set profile in SmartControl Live's Default preset; the brakes start working the next time SmartControl Live starts."));
            var keys = SmartControl.Read(_rig.SmartControlDb).Keys;
            Assert.That(keys.Count(k => k.Action == LiveAction.SetProfile && k.FirstKey == "F24" && k.ProfileId == sw.ProfileId && k.PresetId == 1), Is.EqualTo(1));

            // Live starts again (it reads its keys then); he gets in the 963 and sits at the garage screen.
            _clock = _clock.AddMinutes(1);
            _rig.Probe.LiveStarted = _clock;
            _clock = _clock.AddMinutes(1);
            Drive(d, 1.5);

            Assert.That(_rig.Keys.Sent, Is.EqualTo(1));
            sw = Switch();
            Assert.That((sw.WrittenFor, sw.ProfileName), Is.EqualTo((Gtp, "Racing Desk: Porsche 963 GTP")), "named for the car, so that Live's voice says which");
            Assert.That(sw.SentAtUtc, Is.Not.Null);
            Assert.That(sw.PedalsAtUtc, Is.Not.Null);
            var row = Row(sw.ProfileId);
            Assert.That(SmartControlProfileEditor.TryReadForce(row.Data, out double kg) ? kg : -1, Is.EqualTo(70), "Default, at the force he last set in it");
            Assert.That(SmartControlProfileEditor.HashHolds(row.Data), Is.True, "with the hash by the rule");
            Assert.That(ViewFiles.Sha(row.Data), Is.EqualTo(sw.WrittenSha), "read back as written");
            Assert.That(_rig.Seeded, Is.EqualTo(new[] { (Gtp, 70.0) }), "his +5 and -5 count from the car's force");
            Assert.That(Lines(), Has.Some.EqualTo("The Porsche 963 GTP's brakes went on: its own profile, from Default, at 70 kg."));
            Assert.That(d.Status().Brakes, Has.Property("State").EqualTo("working").And.Property("Text").EqualTo("Working: the last brakes it put on were the Porsche 963 GTP's."));

            // The car has a profile of its own, made when it loaded, and the switch profile holds a copy of it, byte for byte.
            using (var store = Store())
            {
                var own = store.CarSmartControlOf(Gtp);
                Assert.That((own.ProfileName, own.BaseName, own.WrittenKg, own.State), Is.EqualTo(("Porsche 963 GTP · Racing Desk", "Default", 70.0, "made")));
                Assert.That(Row(own.ProfileId).Data, Is.EqualTo(row.Data));
                Assert.That(own.ProfileId, Is.Not.EqualTo(sw.ProfileId));
            }
            Assert.That(Lines(), Has.Some.EqualTo("Racing Desk added the Porsche 963 GTP's own profile in SmartControl, Porsche 963 GTP · Racing Desk: Default at 70 kg. Change its curve or force there and Racing Desk keeps it."));

            // Once per car load: more parked frames press nothing more.
            Drive(d, 12);
            Assert.That(_rig.Keys.Sent, Is.EqualTo(1));

            // His own profiles and keys are as they were; the database was copied first, and the first copy is kept for good.
            var after = SmartControl.Read(_rig.SmartControlDb);
            foreach (var p in before.Profiles) Assert.That(after.Profiles.Single(x => x.Id == p.Id).Data, Is.EqualTo(p.Data), p.Name);
            Assert.That(after.Keys.Where(k => k.Action != LiveAction.SetProfile).Select(k => k.FirstKey + k.SecondKey), Is.EqualTo(before.Keys.Select(k => k.FirstKey + k.SecondKey)));
            Assert.That(File.Exists(Path.Combine(_rig.Backups, "smartcontrol", "before-racing-desk.db")), Is.True);
            Assert.That(Directory.GetFiles(Path.Combine(_rig.Backups, "smartcontrol"), "before-write-*.db"), Has.Length.EqualTo(3),
                "one before the setup, one before the car's own profile, one before it was copied into the switch profile");
        }

        [Test]
        public void NothingIsPressed_WhileHeMoves_OnTrack_OrInAReplay()
        {
            var d = Started();
            Drive(d, 3, () => Garage(speed: 2));
            Drive(d, 3, () => OnTrack());
            Drive(d, 3, () => Garage(brake: 0.4));
            d.SimGone();
            Drive(d, 3, () => Garage(mode: "replay"));
            Assert.That(_rig.Keys.Sent, Is.Zero);
            Assert.That(Switch().WrittenFor, Is.Null, "and nothing was written into the profile");
        }

        [Test]
        public void WithTheEditorOpen_NothingIsWrittenOrPressed_UntilItCloses()
        {
            var d = Started();
            _rig.Probe.Editor = true;
            Drive(d, 2);
            Assert.That((_rig.Keys.Sent, Switch().WrittenFor), Is.EqualTo((0, (string)null)));
            Assert.That(d.Status().Brakes.Text, Is.EqualTo("Waiting for the SmartControl editor to close, to add the Porsche 963 GTP's own profile."));

            _rig.Probe.Editor = false;
            Drive(d, 6);      // still parked: tried again every five seconds
            Assert.That(_rig.Keys.Sent, Is.EqualTo(1));
        }

        [Test]
        public void WithTheEditorOpenOnlyWhenHeIsParked_TheCopyIntoTheSwitchProfileWaitsForIt()
        {
            var d = Started();
            d.See(Garage());          // the car's own profile is made at the load, with the editor closed
            Settle(d);
            _rig.Probe.Editor = true;
            Drive(d, 2);
            Assert.That((_rig.Keys.Sent, Switch().WrittenFor), Is.EqualTo((0, (string)null)));
            Assert.That(d.Status().Brakes.Text, Is.EqualTo("Waiting for the SmartControl editor to close, to put the Porsche 963 GTP's brakes on."));

            _rig.Probe.Editor = false;
            Drive(d, 6);
            Assert.That(_rig.Keys.Sent, Is.EqualTo(1));
        }

        [Test]
        public void WhileTheEditorStaysOpen_TheTriesLookAtTheProcessesAndNotAtTheDatabases()
        {
            var d = Started();
            d.See(Garage());
            Settle(d);
            _rig.Probe.Editor = true;
            Drive(d, 2);      // the first try reads as it always did, and finds the editor open
            const string waiting = "Waiting for the SmartControl editor to close, to put the Porsche 963 GTP's brakes on.";
            Assert.That(d.Status().Brakes.Text, Is.EqualTo(waiting));

            // SmartControl's database taken away while the editor stays open: a try that read it would find it gone, and turn
            // the brakes off for good (its database isn't on this PC). Parked, a try is made every five seconds.
            string aside = _rig.SmartControlDb + ".aside";
            File.Move(_rig.SmartControlDb, aside);
            try
            {
                Drive(d, 16);
            }
            finally
            {
                File.Move(aside, _rig.SmartControlDb);
            }
            Assert.That(d.Switches.Brakes, Is.True, "the database was not looked at while the editor stayed open");
            Assert.That(d.Status().Brakes.Text, Is.EqualTo(waiting), "and the wait is what it was");
            Assert.That(_rig.Keys.Sent, Is.Zero);

            _rig.Probe.Editor = false;
            Drive(d, 6);      // closed: the next try is made in full
            Assert.That(_rig.Keys.Sent, Is.EqualTo(1));
            Assert.That(Switch().WrittenFor, Is.EqualTo(Gtp));
        }

        [Test]
        public void WithTheKeyGone_ItIsMadeAgain_AndNothingIsPressedUntilLiveStartsAgain()
        {
            var d = Started();
            long binding = Switch().BindingId.Value;
            using (var db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = _rig.SmartControlDb, Pooling = false }.ToString()))
            {
                db.Open();
                RestoreRig.Run(db, $"DELETE FROM profile_smartcontrol_live_keyboard_binding WHERE fk_keyboard_binding_id = {binding}; DELETE FROM keyboard_binding WHERE id = {binding};");
            }
            Drive(d, 2);
            Assert.That(_rig.Keys.Sent, Is.Zero, "Live has not got the new key");
            var sw = Switch();
            Assert.That(sw.BindingId, Is.Not.EqualTo(binding), "made again, with the editor closed");
            Assert.That(sw.BoundAtUtc, Is.GreaterThan(_rig.Probe.LiveStarted));
            Assert.That(d.Status().Brakes.Text, Does.StartWith("Starts working the next time SmartControl Live starts"));

            _rig.Probe.LiveStarted = _clock.AddSeconds(1);
            _clock = _clock.AddSeconds(2);
            Drive(d, 6);
            Assert.That(_rig.Keys.Sent, Is.EqualTo(1));
        }

        [Test]
        public void WithLiveStartedBeforeTheKeyWasWritten_NothingIsPressed()
        {
            var d = Director();
            d.HostStarted();
            Settle(d);
            _clock = _clock.AddMinutes(5);          // Live has run since Windows started: before the key was written
            Drive(d, 7);
            Assert.That(_rig.Keys.Sent, Is.Zero);
            Assert.That(Switch().WrittenFor, Is.Null);
            Assert.That(d.Status().Brakes.State, Is.EqualTo("waiting"));
        }

        [Test]
        public void WithIRacingNotInFront_OrHisKeyFirst_NothingIsWrittenOrPressed()
        {
            var d = Started();
            _rig.Probe.Front = "Racing Desk";
            Drive(d, 2);
            Assert.That((_rig.Keys.Sent, Switch().WrittenFor), Is.EqualTo((0, (string)null)));
            Assert.That(d.Status().Brakes.Text, Is.EqualTo("Waiting to put the Porsche 963 GTP's brakes on: iRacing isn't the window in front."));
            _rig.Probe.Front = "iRacingSim64DX11";
            _rig.Probe.Elevated = true;
            Drive(d, 6);
            Assert.That(_rig.Keys.Sent, Is.Zero, "a key to an elevated window would be dropped");

            _rig.Probe.Elevated = false;
            _rig.Presses = 1;                       // he set the force with his own keys before Racing Desk could
            Drive(d, 6);
            Assert.That(_rig.Keys.Sent, Is.Zero, "his key wins");
        }

        [Test]
        public void TheSameCarAgain_IsNotPressedAgain_UnlessLiveStartedSince_OrHisKeysMovedTheForce()
        {
            var d = Started();
            Drive(d, 1.5);
            Assert.That(_rig.Keys.Sent, Is.EqualTo(1));

            // The next session, same car, same force: on the pedals already. The force is the car's all the same.
            d.SimGone();
            _clock = _clock.AddMinutes(2);
            Drive(d, 1.5);
            Assert.That(_rig.Keys.Sent, Is.EqualTo(1));
            Assert.That(_rig.Seeded, Is.EqualTo(new[] { (Gtp, 70.0), (Gtp, 70.0) }));

            // His keys moved the force in that run (+5 to 75, kept for the car): the next car load presses again, at 75. The store
            // has the force before the director is told, as the host does it.
            using (var store = Store()) store.NotePedals(Gtp, 75, true, 0, _clock);
            d.PedalsLeft(new PedalsSeen { CarPath = Gtp, ForceKg = 75, Presses = 1, SeenAtUtc = _clock });
            d.SimGone();
            Settle(d);
            Assert.That(Switch().PedalsAtUtc, Is.Null);
            _clock = _clock.AddMinutes(2);
            Drive(d, 1.5);
            Assert.That(_rig.Keys.Sent, Is.EqualTo(2));
            Assert.That(SmartControlProfileEditor.TryReadForce(Row(Switch().ProfileId).Data, out double kg) ? kg : -1, Is.EqualTo(75));

            // Live started again since (the PC restarted): the pedals may hold anything, so it is pressed again.
            d.SimGone();
            _rig.Probe.LiveStarted = _clock.AddSeconds(1);
            _clock = _clock.AddMinutes(2);
            Drive(d, 1.5);
            Assert.That(_rig.Keys.Sent, Is.EqualTo(3));
        }

        [Test]
        public void ACarItHasNoBaseFor_OrOneHeChoseNoneFor_IsLeftAsItIs()
        {
            var d = Started();
            using (var store = Store())
            {
                store.UnbindCarPedals(Gtp);
                store.NotePedalsGiven(Gtp, "none", null, _clock);
            }
            Drive(d, 2);
            Assert.That(_rig.Keys.Sent, Is.Zero);
            d.SimGone();
            Drive(d, 2, () => Garage("somethingnew", "Something New"));
            Assert.That(_rig.Keys.Sent, Is.Zero, "not in the list and not driven yet: its brakes are worked out at the end of its first drive");
        }

        [Test]
        public void OffMeansOff()
        {
            var d = Started();
            Assert.That(d.SetSwitches(false, null).Ok, Is.True);
            Drive(d, 7);
            Assert.That(_rig.Keys.Sent, Is.Zero);
            Assert.That(d.Status().Brakes.Text, Is.EqualTo("Off."));
            Assert.That(RestoreSwitches.Load(Path.Combine(_rig.Dir, "restore.json")).Brakes, Is.False, "kept in restore.json");
        }

        [Test]
        public void ADatabaseItDoesNotKnow_TurnsTheBrakesPartOffByItself_AndSaysWhy()
        {
            using (var db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = _rig.SmartControlDb, Pooling = false }.ToString()))
            {
                db.Open();
                RestoreRig.Run(db, "UPDATE database_version SET version_number = 2");
            }
            string sha = _rig.FileSha(_rig.SmartControlDb);
            var d = Director();
            d.HostStarted();
            Settle(d);
            Assert.That(d.Switches.Brakes, Is.False);
            Assert.That(d.Status().Brakes, Has.Property("State").EqualTo("stopped")
                .And.Property("Text").EqualTo("Turned itself off: SmartControl's database is version 2, which Racing Desk doesn't know."));
            Assert.That(_rig.FileSha(_rig.SmartControlDb), Is.EqualTo(sha), "and nothing was written");
            Assert.That(d.SetSwitches(true, null).Ok, Is.True);
            Settle(d);
            Assert.That(d.Status().Brakes.State, Is.EqualTo("stopped"), "on again, it looks again, and turns itself off again");
        }

        [Test]
        public void TheParkedRule_IsTheGarageScreenOrThePitStall_StillForASecond_TheBrakeReleased()
        {
            var at = new DateTime(2026, 10, 2, 20, 0, 0, DateTimeKind.Utc);
            SeatFacts F(double t, bool onTrack = false, bool garage = true, int surface = -1, bool pitRoad = false, double speed = 0, double brake = 0, string mode = "full", bool replay = true) =>
                new SeatFacts { CarPath = Gtp, IsOnTrack = onTrack, IsInGarage = garage, IsReplayPlaying = replay, TrackSurface = surface, OnPitRoad = pitRoad, SpeedMs = speed, Brake = brake, SimMode = mode, AtUtc = at.AddSeconds(t) };

            Assert.That(ParkedRule.Place(F(0), out _), Is.EqualTo("garage screen"), "a replay may play behind the garage screen: SimMode says it is not a replay file");
            Assert.That(ParkedRule.Place(F(0, mode: "replay"), out string why), Is.Null);
            Assert.That(why, Is.EqualTo("a replay file"));
            Assert.That(ParkedRule.Place(F(0, onTrack: true, garage: false, surface: 1, pitRoad: true, replay: false), out _), Is.EqualTo("pit stall"));
            Assert.That(ParkedRule.Place(F(0, onTrack: true, garage: false, surface: 3, pitRoad: true, replay: false), out why), Is.Null);
            Assert.That(why, Is.EqualTo("in the pit lane"));
            Assert.That(ParkedRule.Place(F(0, onTrack: true, garage: false, surface: 3, replay: false), out why), Is.Null);
            Assert.That(why, Is.EqualTo("on track"));

            var rule = new ParkedRule();
            Assert.That(rule.Parked(F(0), out _, out why), Is.False);
            Assert.That(why, Is.EqualTo("not still for a second yet"));
            Assert.That(rule.Parked(F(1.1, brake: 0.3), out _, out why), Is.False);
            Assert.That(why, Is.EqualTo("the brake is pressed"));
            Assert.That(rule.Parked(F(1.2), out string place, out _), Is.True);
            Assert.That(place, Is.EqualTo("garage screen"));
            Assert.That(rule.Parked(F(1.3, speed: 2), out _, out _), Is.False, "moving off starts the second again");
            Assert.That(rule.Parked(F(1.4), out _, out _), Is.False);
        }

        [Test]
        public void ACarsBrakes_AreItsBaseAtItsForce_OrAtTheBasesOwn_ByTheListBeforeItHasOne()
        {
            using var store = Store();
            var snapshot = SmartControl.Read(_rig.SmartControlDb);
            BrakesPlan Plan(string car, string name) => RestorePlanner.PlanBrakes(store, car, name, snapshot);

            var gtp = Plan(Gtp, GtpName);
            Assert.That((gtp.State, gtp.BaseName, gtp.Kg, gtp.KgFrom, gtp.BaseFrom), Is.EqualTo(("on", "Default", (int?)70, "saved", "store")));
            Assert.That(gtp.Words, Is.EqualTo("Put on when you get in and stop with the brake released: Default at 70 kg, the force you last set in it."));
            var honda = Plan("hondacivictyper", "Honda Civic Type R TCR");
            Assert.That((honda.BaseName, honda.Kg, honda.KgFrom), Is.EqualTo(("LightBrake", (int?)45, "base")), "never set in this car: LightBrake's own 45 kg");
            Assert.That(honda.Words, Does.EndWith("LightBrake at 45 kg, its own force, as you haven't set one in this car."));
            var gt3 = Plan("mclaren720sgt3", "McLaren 720S GT3 EVO");
            Assert.That((gt3.State, gt3.BaseName, gt3.Kg, gt3.BaseFrom), Is.EqualTo(("on", "LightBrake", (int?)45, "list")), "not driven yet: the rule by the list");
            var lotus = Plan("lotus79", "Lotus 79");
            Assert.That((lotus.BaseName, lotus.Kg), Is.EqualTo(("Default", (int?)80)), "a formula car: Default, at 80");
            Assert.That(Plan("somethingnew", "Something New").State, Is.EqualTo("no-base"));
            store.UnbindCarPedals("mx5 mx52016");
            store.NotePedalsGiven("mx5 mx52016", "none", null, DateTime.UtcNow);
            Assert.That(Plan("mx5 mx52016", "Mazda MX-5 Cup").State, Is.EqualTo("none"));
            store.NotePedals("porsche9922cup", 140, true, 0, DateTime.UtcNow);
            Assert.That(Plan("porsche9922cup", "Porsche 911 Cup (992.2)").Kg, Is.EqualTo(45), "140 kg is not one Racing Desk writes: the base's own");
        }

        [Test]
        public void ASecondCommand_WhileOneRuns_IsToldBusy_AndNothingIsQueued()
        {
            var d = Started();
            Drive(d, 1.5);
            _rig.Probe.Sim = false;
            var release = new ManualResetEventSlim();
            _ctx.BackUpSmartControl = _ => { release.Wait(TimeSpan.FromSeconds(20)); return null; };
            RestoreResult first = null;
            var running = new Thread(() => first = d.UndoEverything());
            running.Start();
            Thread.Sleep(300);
            var second = d.SetSwitches(true, true);
            Assert.That((second.Busy, second.Refused), Is.EqualTo((true, true)));
            Assert.That(second.Why, Does.Contain("busy"));
            release.Set();
            running.Join(TimeSpan.FromSeconds(30));
            Assert.That(first?.Ok, Is.True, first?.Text);
            Assert.That(d.SetSwitches(true, null).Busy, Is.False, "and the next one goes");
        }
    }

    /// <summary>The seat height: folded into the car's camera file once the sim has gone, the earlier ones moved once, and the self-check.</summary>
    [TestFixture]
    public class LiveHeightTests : LiveRig
    {
        private RestoreDirector Moved()
        {
            var d = Director();
            using (var store = Store()) store.NoteHeightsMoved(_clock);      // the one-time move made: each test starts from its own run
            return d;
        }

        [Test]
        public void AtExit_WhatHeChangedGoesIntoTheCarsCameraFile_AndAppIniBackToS_BothBackedUpAndReadBack()
        {
            var d = Moved();
            Exit(d, Gtp, S, S + 0.005);
            Assert.That(_rig.CamZ(Gtp), Is.EqualTo(0.005f), "cockpit Z 0 + (−1.5 cm − −2.0 cm)");
            Assert.That(_rig.Files().AppIniHeight(), Is.EqualTo(S).Within(1e-9));
            Assert.That(Lines(), Has.Some.EqualTo("The Porsche 963 GTP's seat height, −1.5 cm, was kept in its camera file for next time."));
            var copies = Directory.GetDirectories(Path.Combine(_rig.Backups, "view")).Where(x => !x.EndsWith("original")).ToList();
            Assert.That(copies, Has.Count.EqualTo(1));
            Assert.That(File.Exists(Path.Combine(copies[0], "app.ini")) && File.Exists(Path.Combine(copies[0], ViewFiles.DefaultCamFile(Gtp))), Is.True, "both files copied first");
            using var store = Store();
            var keep = store.CarViewKeepOf(Gtp);
            Assert.That((keep.OwnZ, keep.WrittenZ), Is.EqualTo(((double?)0, (double?)0.005)));
            Assert.That(keep.Intent, Is.Null, "the pair's record let go once both were written");
            Assert.That(store.ViewBaselineRow().IniHeightWritten, Is.EqualTo(S).Within(1e-9));

            // And again in the same car: on top of what is there, his own Z kept apart.
            Exit(d, Gtp, S, S - 0.01);
            Assert.That(_rig.CamZ(Gtp), Is.EqualTo(-0.005f).Within(1e-6));
            using var again = Store();
            Assert.That(again.CarViewKeepOf(Gtp).OwnZ, Is.EqualTo(0), "his own Z is what it was before Racing Desk");
        }

        [Test]
        public void ACarBeyondTheLimit_OrWithoutACameraFile_KeepsNothingInIt_AndSaysSo()
        {
            var d = Moved();
            byte[] cup = File.ReadAllBytes(_rig.CamPath("porsche9922cup"));
            Exit(d, "porsche9922cup", S, S - 0.02);
            Assert.That(File.ReadAllBytes(_rig.CamPath("porsche9922cup")), Is.EqualTo(cup), "−4.0 cm and −2.0 cm more is −6.0 cm: beyond ±5 cm");
            Assert.That(_rig.Files().AppIniHeight(), Is.EqualTo(S).Within(1e-9));
            Assert.That(Lines(), Has.Some.EqualTo("The Porsche 911 Cup (992.2)'s seat height wasn't kept: it would need −6.0 cm in its camera file, beyond the ±5.0 cm Racing Desk keeps to."));

            Exit(d, "dallaraf3", S, S + 0.01);
            Assert.That(_rig.Files().AppIniHeight(), Is.EqualTo(S).Within(1e-9));
            Assert.That(Lines(), Has.Some.EqualTo("The Dallara F312 F3's seat height, −1.0 cm, is kept here only: it has no camera file."));
            using var store = Store();
            var plan = RestorePlanner.Plan(store, _rig.Files(), SmartControl.Read(_rig.SmartControlDb));
            Assert.That(plan.Views.Single(v => v.Car == "dallaraf3").Words, Does.EndWith("save one once, " + RestorePolicy.SaveACameraFile + "."), "the Cars page says how, for that car only");
            Assert.That(plan.Views.Where(v => v.Words != null).Select(v => v.Car), Is.EquivalentTo(new[] { "dallaraf3", "formulair04" }), "the F4 is beyond the limit; the others have nothing to say");
        }

        [Test]
        public void ALeftoverHeChangedNothingOf_KeepsNothing_AndAppIniGoesBackToS()
        {
            var d = Moved();
            byte[] cam = File.ReadAllBytes(_rig.CamPath(Gtp));
            Exit(d, Gtp, S - 0.015, S - 0.015);
            Assert.That(File.ReadAllBytes(_rig.CamPath(Gtp)), Is.EqualTo(cam));
            Assert.That(_rig.Files().AppIniHeight(), Is.EqualTo(S).Within(1e-9));
        }

        [Test]
        public void NothingIsWritten_WhileTheSimRuns_OrWithTheHeightPartOff()
        {
            var d = Moved();
            d.SimGone();
            _rig.AppIni(S + 0.005);
            byte[] ini = _rig.AppIniBytes();
            _rig.Probe.Sim = true;                   // started again before the run was handed on
            d.ViewRunEnded(Run(Gtp, S, S + 0.005));
            Settle(d);
            Assert.That((_rig.AppIniBytes(), _rig.CamZ(Gtp)), Is.EqualTo((ini, 0f)));
            Assert.That(d.SetSwitches(null, false).Ok, Is.True);
            Exit(d, Gtp, S, S + 0.005);
            Assert.That((_rig.AppIniBytes(), _rig.CamZ(Gtp)), Is.EqualTo((ini, 0f)));
        }

        [Test]
        public void WhenSomethingWritesAppIniBack_TheHeightPartTurnsItselfOff_AndPutsEachCameraFileBack()
        {
            var d = Moved();
            Exit(d, Gtp, S, S + 0.005);
            Assert.That(_rig.CamZ(Gtp), Is.EqualTo(0.005f));

            // The sim starts with app.ini holding what Racing Desk left there: all is well.
            Drive(d, 0.2);
            Assert.That(d.Switches.Height, Is.True);

            // It exits, Racing Desk writes S, and something writes its own value back before the next start.
            Exit(d, Gtp, S, S + 0.005);
            Assert.That(_rig.CamZ(Gtp), Is.EqualTo(0.01f));
            _rig.AppIni(S + 0.005);
            // A session file from before Racing Desk's last write of app.ini is no session in between.
            using (var written = Store()) _rig.Ibt("earlier.ibt", written.ViewBaselineRow().IniWrittenAtUtc.Value.AddHours(-5));
            Drive(d, 0.2);
            var switches = d.Switches;
            Assert.That((switches.Height, switches.HeightPutBackOwed), Is.EqualTo((false, true)));
            Assert.That(d.Status().Height, Has.Property("State").EqualTo("stopped").And.Property("Text").EqualTo(
                "Turned itself off: app.ini's seat height was −1.5 cm when iRacing started, not the −2.0 cm Racing Desk left there, so something else writes it; each car's camera file is put back when iRacing closes."));
            Assert.That(_rig.CamZ(Gtp), Is.EqualTo(0.01f), "not with the sim running");

            // iRacing closes: each camera file back as it was where it still holds Racing Desk's value; app.ini is left as it is.
            Exit(d, Gtp, S + 0.005, S + 0.005);
            Assert.That(_rig.CamZ(Gtp), Is.EqualTo(0f));
            Assert.That(_rig.Files().AppIniHeight(), Is.EqualTo(S + 0.005).Within(1e-9), "app.ini is what something else keeps writing: left");
            Assert.That(d.Switches.HeightPutBackOwed, Is.False);
            Assert.That(d.Status().Height.Text, Does.EndWith("; each car's camera file was put back."));
            using var store = Store();
            Assert.That(store.CarViewKeeps(), Is.Empty);
            Assert.That(Lines(), Has.Some.StartWith("The seat height part turned itself off: app.ini's seat height was −1.5 cm when iRacing started"));
        }

        [Test]
        public void ASessionThatRanWithoutRacingDesk_IsIRacingsOwnWrite_NotSomethingThatWritesOverRacingDesks()
        {
            var d = Moved();
            Exit(d, Gtp, S, S + 0.005);
            Assert.That(_rig.CamZ(Gtp), Is.EqualTo(0.005f));
            DateTime wrote;
            using (var store = Store()) wrote = store.ViewBaselineRow().IniWrittenAtUtc.Value;

            // Racing Desk was not running for the next session: iRacing wrote the height he ended it with into app.ini, and left its
            // telemetry file. The sim starts again with Racing Desk running.
            _rig.AppIni(S + 0.015);
            _rig.Ibt("session-without-racing-desk.ibt", wrote.AddHours(3));
            Drive(d, 0.2);
            var switches = d.Switches;
            Assert.That((switches.Height, switches.HeightPutBackOwed, switches.HeightOffWhy), Is.EqualTo((true, false, (string)null)), "not turned off");
            Assert.That(_rig.CamZ(Gtp), Is.EqualTo(0.005f), "and no camera file was put back");
            Assert.That(_rig.Logged, Has.Some.Matches<string>(m => m.Contains("app.ini's seat height is −0.5 cm, not the −2.0 cm Racing Desk left there")
                && m.Contains("a session ran since without Racing Desk (session-without-racing-desk.ibt") && m.EndsWith("iRacing wrote it, so the seat height part stays on")));
            using (var store = Store()) Assert.That(store.ViewBaselineRow().LaunchHeight, Is.EqualTo(S + 0.015).Within(1e-9), "what the sim started with is kept all the same");

            // The fold at the next exit keeps what he ends with: the run started at a height that was not S, and he changed it.
            Exit(d, Gtp, S + 0.015, S + 0.02);
            Assert.That(_rig.CamZ(Gtp), Is.EqualTo(0.025f).Within(1e-6), "0.5 cm already, and the 2.0 cm he ended at above S");
            Assert.That(_rig.Files().AppIniHeight(), Is.EqualTo(S).Within(1e-9));
            Assert.That(d.Switches.Height, Is.True);
        }

        [Test]
        public void TheTelemetryFolder_IsLookedAtForNamesAndTimesAlone()
        {
            var since = new DateTime(2026, 10, 2, 12, 0, 0, DateTimeKind.Utc);
            Assert.That(_ctx.SessionSince(since), Is.Null, "no folder");
            _rig.Ibt("old.ibt", since.AddHours(-1));
            string other = Path.Combine(_rig.Telemetry, "notes.txt");
            File.WriteAllText(other, "not a session");
            File.SetCreationTimeUtc(other, since.AddHours(9));
            File.SetLastWriteTimeUtc(other, since.AddHours(9));
            Assert.That(_ctx.SessionSince(since), Is.Null, "an older session, and a file that is not one");

            _rig.Ibt("new.ibt", since.AddHours(2));
            _rig.Ibt("newest.ibt", since.AddHours(4));
            var found = _ctx.SessionSince(since);
            Assert.That((found.Value.Name, found.Value.AtUtc), Is.EqualTo(("newest.ibt", since.AddHours(4))));
            _ctx.TelemetryDir = null;
            Assert.That(_ctx.SessionSince(since), Is.Null, "and none where the folder is not known");
        }

        [Test]
        public void TheHeightsHeChoseBefore_GoIntoTheCarsCameraFiles_Once()
        {
            var d = Director();
            d.HostStarted();
            Settle(d);
            Assert.That(_rig.CamZ("mx5 mx52016"), Is.EqualTo(0.035f).Within(1e-6), "+1.5 cm chosen, on S of −2.0 cm: Z 0 + 3.5 cm");
            Assert.That(_rig.CamZ("hondacivictyper"), Is.EqualTo(0f).Within(1e-6), "+2.0 cm on its own −4.0 cm: the file camera.ini names");
            Assert.That(_rig.CamZ("formulair04"), Is.EqualTo(0.01f), "+9 cm would be beyond the limit: left");
            Assert.That(_rig.CamZ(Gtp), Is.EqualTo(0f), "never changed in the 963: left");
            Assert.That(Lines(), Has.Some.EqualTo("The seat heights you chose before went into 2 cars' camera files."));
            using (var store = Store()) Assert.That(store.ViewBaselineRow().MigratedAtUtc, Is.Not.Null);
            Assert.That(d.Status().Height.Text, Is.EqualTo("Working: the last seat height it kept was the Mazda MX-5 Cup's.").Or.EqualTo("Working: the last seat height it kept was the Honda Civic Type R TCR's."));

            var again = Director();
            again.HostStarted();
            Settle(again);
            Assert.That(_rig.CamZ("mx5 mx52016"), Is.EqualTo(0.035f).Within(1e-6), "once");
        }
    }

    /// <summary>"Undo what Racing Desk changed": both parts off, SmartControl's rows and the view files put back.</summary>
    [TestFixture]
    public class LiveUndoTests : LiveRig
    {
        [Test]
        public void Undo_TurnsBothOff_TakesItsKeyAndRowsAway_LeavesTheProfileThePedalsMayBeOn_AndPutsTheHeightsBack()
        {
            var d = Started();
            Drive(d, 1.5);
            Exit(d, Gtp, S, S + 0.005);
            Assert.That(_rig.CamZ(Gtp), Is.EqualTo(0.005f));
            string id = Switch().ProfileId;

            var undone = d.UndoEverything();
            Assert.That(undone.Ok, Is.True, undone.Text);
            Assert.That((d.Switches.Brakes, d.Switches.Height), Is.EqualTo((false, false)), "nothing is made again behind it");
            var after = SmartControl.Read(_rig.SmartControlDb);
            Assert.That(after.Keys.Any(k => k.FirstKey == "F24"), Is.False);
            Assert.That(after.Keys, Has.Count.EqualTo(5), "his five keys stay");
            Assert.That(after.Profiles.Any(p => p.Id == id), Is.True, "F24 went, so the pedals may be on it: left");
            Assert.That(undone.Saw, Has.Some.EqualTo("To finish, pick one of your own profiles in SmartControl, then delete the profile 'Racing Desk: Porsche 963 GTP' there"));
            Assert.That(undone.Did, Has.Some.EqualTo("SmartControl's profile 'Porsche 963 GTP · Racing Desk' removed"), "the car's own profile goes too");
            Assert.That(after.Profiles.Count(p => p.Name.Contains("Racing Desk")), Is.EqualTo(1), "and only the switch profile is left");
            Assert.That(_rig.CamZ(Gtp), Is.EqualTo(0f));
            Assert.That(_rig.Files().AppIniHeight(), Is.EqualTo(S + 0.005).Within(1e-9), "app.ini as it was before Racing Desk first wrote it");
            using var store = Store();
            Assert.That(store.CarSmartControls(), Is.Empty);
            Assert.That((store.SmartControlSwitchRow(), store.CarViewKeeps().Count), Is.EqualTo(((SmartControlSwitch)null, 0)));
            Assert.That(d.AnythingToUndo(), Is.False);
        }

        [Test]
        public void Undo_RemovesTheProfile_WhenNoKeyWasEverSent_AndWaitsForTheEditorAndTheSim()
        {
            var d = Started();
            string id = Switch().ProfileId;
            Exit(d, Gtp, S, S + 0.005);
            _rig.Probe.Editor = true;
            _rig.Probe.Sim = true;
            var held = d.UndoEverything();
            Assert.That(held.Ok, Is.False);
            Assert.That(held.Saw, Is.EqualTo(new[]
            {
                "SmartControl was left as it is: close the SmartControl editor, then press undo again",
                "The seat heights were left as they are: close iRacing, then press undo again",
            }));
            _rig.Probe.Editor = false;
            _rig.Probe.Sim = false;
            var undone = d.UndoEverything();
            Assert.That(undone.Ok, Is.True, undone.Text);
            Assert.That(SmartControl.Read(_rig.SmartControlDb).Profiles.Any(p => p.Id == id), Is.False);
            Assert.That(undone.Did, Has.Some.EqualTo("SmartControl's profile 'Racing Desk' removed"));
            Assert.That(_rig.CamZ(Gtp), Is.EqualTo(0f));
        }
    }

    /// <summary>
    /// A profile of its own for each car in SmartControl (his words: "I thought you'd be making new Heusinkveld profiles for each car
    /// as needed"): made the first time the car loads, the one he tunes, copied as it stands into the switch profile at the switch,
    /// and given the force his keys leave in the car when he leaves it.
    /// </summary>
    [TestFixture]
    public class LiveCarProfileTests : LiveRig
    {
        private const string Honda = "hondacivictyper", HondaName = "Honda Civic Type R TCR";

        private string OwnId(string car = Gtp)
        {
            using var store = Store();
            return store.CarSmartControlOf(car)?.ProfileId;
        }

        private int Backups() => Directory.GetFiles(Path.Combine(_rig.Backups, "smartcontrol"), "before-write-*.db").Length;

        private static byte[] Force(byte[] profile, int kg)
        {
            Assert.That(SmartControlProfileEditor.TryEdit(profile, kg, null, out byte[] edited, out string why), Is.True, why);
            return edited;
        }

        /// <summary>What he does in the SmartControl editor: a softer curve in the brake of the Ultimate pedals (the hash is SmartControl's to make).</summary>
        private static byte[] Curve(byte[] profile)
        {
            string text = Encoding.UTF8.GetString(profile);
            string curved = Regex.Replace(text, @"(<SimPedalsUltimate>.*?<BrakeProfile>.*?<TwentyPercentage>)20(</TwentyPercentage>)", "${1}25${2}", RegexOptions.Singleline);
            Assert.That(curved, Is.Not.EqualTo(text));
            return Encoding.UTF8.GetBytes(curved);
        }

        [Test]
        public void EachCarGetsAProfileOfItsOwn_WhenItFirstLoads_NamedForIt_WithEveryNameUnique()
        {
            // A profile of his own that has the name the 963's would get: the 963's takes another, and his is left as it is.
            byte[] his = Encoding.UTF8.GetBytes(RestoreRig.NewFormatProfile(60, 5, nilDescription: false));
            _rig.AddProfile("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "Porsche 963 GTP · Racing Desk", his);
            var d = Started();

            d.See(Garage(Gtp, GtpName));         // one frame: he is not parked yet, and the profile is made all the same
            Settle(d);
            d.SimGone();
            d.See(Garage(Honda, HondaName));
            Settle(d);
            d.SimGone();
            d.See(Garage("somethingnew", "Something New"));
            Settle(d);

            using var store = Store();
            var own = store.CarSmartControls().ToDictionary(c => c.CarPath);
            Assert.That(own.Keys, Is.EquivalentTo(new[] { Gtp, Honda }), "not for a car it has no base for");
            Assert.That(own[Gtp].ProfileName, Is.EqualTo("Porsche 963 GTP · Racing Desk (porsche963gtp)"), "his own name for a profile is not taken");
            Assert.That(own[Honda].ProfileName, Is.EqualTo("Honda Civic Type R TCR · Racing Desk"));
            Assert.That((own[Honda].BaseName, own[Honda].WrittenKg), Is.EqualTo(("LightBrake", 45.0)), "its base at the base's own force: he never set one");
            Assert.That(SmartControlProfileEditor.TryReadForce(Row(own[Gtp].ProfileId).Data, out double kg) ? kg : -1, Is.EqualTo(70));

            var all = SmartControl.Read(_rig.SmartControlDb).Profiles;
            Assert.That(all.Select(p => p.Name.ToLowerInvariant()), Is.Unique, "SmartControl needs the names to differ");
            Assert.That(all.Single(p => p.Id == "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").Data, Is.EqualTo(his), "his own profile is as it was");
            Assert.That(all.Count(p => p.Name.Contains("Racing Desk")), Is.EqualTo(4), "his, the two cars' and the switch profile");
            Assert.That(_rig.Keys.Sent, Is.Zero, "nothing was pressed: he was not parked");

            // The Cars page says where the car's profile is, in the sentence it has for the brakes.
            var plan = RestorePlanner.PlanBrakes(store, Gtp, GtpName, SmartControl.Read(_rig.SmartControlDb));
            Assert.That(plan.Words, Is.EqualTo("Put on when you get in and stop with the brake released: Default at 70 kg, the force you last set in it. "
                + "Its own profile in SmartControl is Porsche 963 GTP · Racing Desk (porsche963gtp): change its curve or force there and Racing Desk keeps it."));
        }

        [Test]
        public void WithTheEditorOpen_ItsProfileWaitsForTheEditor_AndIsMadeAtTheNextLoad()
        {
            var d = Started();
            _rig.Probe.Editor = true;
            d.See(Garage());
            Settle(d);
            Assert.That(OwnId(), Is.Null);
            Assert.That(d.Status().Brakes, Has.Property("State").EqualTo("waiting").And.Property("Text").EqualTo("Waiting for the SmartControl editor to close, to add the Porsche 963 GTP's own profile."));

            _rig.Probe.Editor = false;
            d.SimGone();
            d.See(Garage());
            Settle(d);
            Assert.That(OwnId(), Is.Not.Null);
        }

        [Test]
        public void AtTheSwitch_ItIsCopiedAsItStands_WithTheCurveAndTheForceHeSetInSmartControl()
        {
            var d = Started();
            Drive(d, 1.5);
            string ownId = OwnId();
            byte[] his = Curve(Force(Row(ownId).Data, 65));       // a softer curve and 65 kg, saved in the editor, which he has closed
            _rig.EditProfile(ownId, his);

            d.SimGone();
            _clock = _clock.AddMinutes(2);
            Drive(d, 1.5);

            Assert.That(_rig.Keys.Sent, Is.EqualTo(2), "it is not what is on the pedals: pressed again");
            Assert.That(Row(Switch().ProfileId).Data, Is.EqualTo(his), "the switch profile holds his profile byte for byte, curve included");
            Assert.That(Row(ownId).Data, Is.EqualTo(his), "and his own is not rewritten");
            Assert.That(_rig.Seeded.Last(), Is.EqualTo((Gtp, 65.0)), "his +5 and -5 count from the force he set");
            using var store = Store();
            Assert.That(store.CarPedalFactsOf(Gtp).ForceKg, Is.EqualTo(65), "the car's force in the store is his now");
            var own = store.CarSmartControlOf(Gtp);
            Assert.That((own.State, own.WrittenKg, own.SwitchedAtUtc.HasValue), Is.EqualTo(("edited", 65.0, true)));
            Assert.That(Lines(), Has.Some.EqualTo("You set the Porsche 963 GTP's brake force to 65 kg in its own SmartControl profile, so that is its force now."));
        }

        [Test]
        public void TheForceHisKeysLeaveInTheCar_IsWrittenIntoItsProfile_WhenHeLeavesIt_BackedUpFirst_WithTheHashByTheRule()
        {
            var d = Started();
            Drive(d, 1.5);
            string ownId = OwnId();
            byte[] before = Row(ownId).Data;
            int backups = Backups();

            using (var store = Store()) store.NotePedals(Gtp, 75, false, 0, _clock);      // the host keeps the force first, then tells the director
            d.PedalsLeft(new PedalsSeen { CarPath = Gtp, ForceKg = 75, Presses = 1, SeenAtUtc = _clock });
            Settle(d);

            byte[] after = Row(ownId).Data;
            Assert.That(after, Is.EqualTo(Force(before, 75)), "the force and its hash moved by the rule, and no other byte");
            Assert.That(SmartControlProfileEditor.HashHolds(after), Is.True);
            Assert.That(Backups(), Is.EqualTo(backups + 1), "a copy of SmartControl's database first");
            using (var store = Store())
            {
                var own = store.CarSmartControlOf(Gtp);
                Assert.That((own.WrittenKg, own.WrittenSha), Is.EqualTo((75.0, ViewFiles.Sha(after))));
            }
            Assert.That(SmartControlProfileEditor.TryReadForce(Row(Switch().ProfileId).Data, out double kg) ? kg : -1, Is.EqualTo(70), "the switch profile is written at the next switch");
            Assert.That(Switch().PedalsAtUtc, Is.Null, "and the pedals are not as written any more");
            Assert.That(Lines(), Has.Some.EqualTo("The Porsche 963 GTP's brake force, 75 kg, was kept in its own profile in SmartControl."));
            Assert.That(_rig.Keys.Sent, Is.EqualTo(1), "nothing was pressed at the exit");
        }

        [Test]
        public void WithTheEditorOpenWhenHeLeaves_TheForceWaits_AndIsWrittenOnceItCloses()
        {
            var d = Started();
            Drive(d, 1.5);
            string ownId = OwnId();
            byte[] before = Row(ownId).Data;

            _rig.Probe.Editor = true;
            using (var store = Store()) store.NotePedals(Gtp, 75, false, 0, _clock);
            d.PedalsLeft(new PedalsSeen { CarPath = Gtp, ForceKg = 75, Presses = 1, SeenAtUtc = _clock });
            Settle(d);
            Assert.That(Row(ownId).Data, Is.EqualTo(before), "nothing is written under the open editor");
            Assert.That(d.Status().Brakes, Has.Property("State").EqualTo("waiting")
                .And.Property("Text").EqualTo("Waiting for the SmartControl editor to close, to keep the Porsche 963 GTP's brake force in its own profile."));

            _rig.Probe.Editor = false;
            _clock = _clock.AddSeconds(31);
            d.Status();                              // a look at the desk that finds it has waited a while asks again
            Settle(d);
            Assert.That(SmartControlProfileEditor.TryReadForce(Row(ownId).Data, out double kg) ? kg : -1, Is.EqualTo(75));
            Assert.That(d.Status().Brakes.State, Is.EqualTo("working"));
        }

        [Test]
        public void AForceHeSetInSmartControl_WinsOverHisKeysOfTheSameRun()
        {
            var d = Started();
            Drive(d, 1.5);
            string ownId = OwnId();
            byte[] his = Force(Row(ownId).Data, 65);
            _rig.EditProfile(ownId, his);

            using (var store = Store()) store.NotePedals(Gtp, 75, false, 0, _clock);
            d.PedalsLeft(new PedalsSeen { CarPath = Gtp, ForceKg = 75, Presses = 1, SeenAtUtc = _clock });
            Settle(d);

            Assert.That(Row(ownId).Data, Is.EqualTo(his), "his profile is left as he saved it");
            using var again = Store();
            Assert.That(again.CarPedalFactsOf(Gtp).ForceKg, Is.EqualTo(65));
        }

        [Test]
        public void ANewBaseHeChoseForTheCar_MakesItsProfileAgain_UnlessHeHasChangedIt()
        {
            var d = Started();
            Drive(d, 1.5);
            string ownId = OwnId();
            void Choose(string name, string id)
            {
                using var store = Store();
                store.BindCarPedals(new CarPedals { CarPath = Gtp, ProfileId = id, ProfileName = name, BoundAtUtc = _clock });
                store.NotePedalsGiven(Gtp, "driver", null, _clock);
            }

            Choose("LightBrake", RestoreRig.LightId);
            d.SimGone();
            _clock = _clock.AddMinutes(2);
            Drive(d, 1.5);
            BrakesPlan plan;
            using (var store = Store()) plan = RestorePlanner.PlanBrakes(store, Gtp, GtpName, SmartControl.Read(_rig.SmartControlDb));
            Assert.That(Row(ownId).Data, Is.EqualTo(plan.Bytes), "made again from LightBrake, at the car's force");
            Assert.That(SmartControlProfileEditor.TryReadForce(plan.Bytes, out double kg) ? kg : -1, Is.EqualTo(70));
            Assert.That(Row(Switch().ProfileId).Data, Is.EqualTo(plan.Bytes));
            Assert.That(_rig.Keys.Sent, Is.EqualTo(2));
            using (var store = Store())
            {
                var own = store.CarSmartControlOf(Gtp);
                Assert.That((own.BaseName, own.BaseId, own.ProfileId), Is.EqualTo(("LightBrake", RestoreRig.LightId, ownId)), "the same row");
            }
            Assert.That(Lines(), Has.Some.EqualTo("The Porsche 963 GTP's own profile in SmartControl was made again from LightBrake, the profile you chose for it."));

            // Once he has changed it, it is his: a base chosen after that does not make it again.
            byte[] his = Curve(Row(ownId).Data);
            _rig.EditProfile(ownId, his);
            Choose("Default", RestoreRig.DefaultId);
            d.SimGone();
            _clock = _clock.AddMinutes(2);
            Drive(d, 1.5);
            Assert.That(Row(ownId).Data, Is.EqualTo(his));
            Assert.That(Row(Switch().ProfileId).Data, Is.EqualTo(his));
            using (var store = Store()) Assert.That(store.CarSmartControlOf(Gtp).State, Is.EqualTo("edited"));
        }

        [Test]
        public void IfHeDeletesItsProfile_ItIsMadeAgainWhenTheCarNextLoads()
        {
            var d = Started();
            Drive(d, 1.5);
            string first = OwnId();
            _rig.DeleteProfile(first);

            d.SimGone();
            d.See(Garage());
            Settle(d);
            string second = OwnId();
            Assert.That(second, Is.Not.Null.And.Not.EqualTo(first));
            Assert.That(Row(second), Is.Not.Null);
            Assert.That(Row(Switch().ProfileId), Is.Not.Null, "the switch profile is not his to lose by this");
        }

        [Test]
        public void Undo_TakesTheCarsProfilesToo_AndSaysWhichHadChangesOfHis()
        {
            var d = Started();
            Drive(d, 1.5);
            d.SimGone();
            _clock = _clock.AddMinutes(2);
            Drive(d, 1.5, () => Garage(Honda, HondaName));
            _rig.EditProfile(OwnId(Honda), Curve(Row(OwnId(Honda)).Data));
            _rig.Probe.Sim = false;

            var undone = d.UndoEverything();
            Assert.That(undone.Ok, Is.True, undone.Text);
            Assert.That(undone.Did, Has.Some.EqualTo("SmartControl's 2 profiles for cars removed"));
            Assert.That(undone.Saw, Has.Some.StartWith("One of them had changes of yours; SmartControl's database as it was just before is kept in "));
            var left = SmartControl.Read(_rig.SmartControlDb).Profiles;
            Assert.That(left.Where(p => p.Name.Contains("Racing Desk")).Select(p => p.Name), Is.EqualTo(new[] { "Racing Desk: Honda Civic Type R TCR" }),
                "F24 has been sent, so the switch profile stays for him to finish by hand");
            Assert.That(left.Select(p => p.Name), Is.SupersetOf(new[] { "Default", "LightBrake", "Rain" }));
            using var store = Store();
            Assert.That(store.CarSmartControls(), Is.Empty);
        }
    }

    /// <summary>What he reads: plain sentences, no step codes, no trial, no capitals but names and acronyms, no customer id.</summary>
    [TestFixture]
    public class LiveWordsTests : LiveRig
    {
        [Test]
        public void EverySentenceIsPlain()
        {
            var d = Started();
            var said = new List<string> { d.Status().Brakes.Text, d.Status().Height.Text };
            _rig.Probe.Editor = true;
            Drive(d, 1.5);
            said.Add(d.Status().Brakes.Text);
            _rig.Probe.Editor = false;
            Drive(d, 6);
            said.Add(d.Status().Brakes.Text);
            using (var store = Store()) store.NotePedals(Gtp, 75, false, 0, _clock);
            _rig.Probe.Editor = true;
            d.PedalsLeft(new PedalsSeen { CarPath = Gtp, ForceKg = 75, Presses = 1, SeenAtUtc = _clock });
            Settle(d);
            said.Add(d.Status().Brakes.Text);        // the force waits for the editor
            _rig.Probe.Editor = false;
            Exit(d, Gtp, S, S + 0.005);
            Exit(d, "dallaraf3", S, S + 0.01);
            Exit(d, "porsche9922cup", S, S - 0.02);
            said.Add(d.Status().Height.Text);
            using (var store = Store())
            {
                var plan = RestorePlanner.Plan(store, _rig.Files(), SmartControl.Read(_rig.SmartControlDb));
                said.AddRange(plan.Views.Select(v => v.Words).Where(w => w != null));
                said.AddRange(plan.Brakes.Select(b => b.Words));
            }
            said.AddRange(Lines());
            said.AddRange(d.UndoEverything().Saw);
            said.Add(d.Status().Brakes.Text);

            foreach (string s in said)
            {
                Assert.That(s, Does.Not.Match(@"(?i)\btrial\b"), s);
                Assert.That(s, Does.Not.Match(@"\b(0a|0b|[ABC]\d{1,2})\b"), s);
                Assert.That(s, Does.Not.Contain("424242"), s);
                Assert.That(s, Does.Not.Match(@"\bABS\b|\bTC\b|\bBB\b|\bARB\b"), s);
                Assert.That(char.IsUpper(s[0]) || s.StartsWith("app.ini"), Is.True, "a sentence: " + s);
            }
        }
    }
}
