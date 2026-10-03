using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using NUnit.Framework;
using RacingDesk.Data;
using RacingDesk.Data.Pedals;
using RacingDesk.Data.Restore;

namespace RacingDesk.Tests.Restore
{
    /// <summary>
    /// The first run's buttons, each running only its step of the real code path, against made-up copies in a folder of the
    /// test's, a probe that says what the test says, and a key sender that counts and sends nothing.
    /// </summary>
    [TestFixture]
    public class FirstRunTests
    {
        private RestoreRig _rig;
        private RestoreDirector _director;
        private const string Car = RestoreGate.TestCar;

        [SetUp]
        public void SetUp()
        {
            _rig = new RestoreRig();
            _rig.AppIni(-0.035);
            _rig.CameraIni((Car, ""));
            _rig.Cam(Car, -0.11f, 0f, 0.01f);
            _rig.SmartControl();
            _rig.StoreWithCars((Car, "Porsche 963 GTP", -0.02, true, 0.0, "Default", RestoreRig.DefaultId, 70.0, "rule"));
            _director = new RestoreDirector(_rig.Context(), Path.Combine(_rig.Dir, "restore.json"));
        }

        [TearDown] public void TearDown() => _rig.Dispose();

        private StepResult Step(string id) => _director.RunStep(id);

        private void Closed() { _rig.Probe.Editor = false; _rig.Probe.Live = false; }

        [Test]
        public void PartA_MakesTheSwitchAndTheKey_SendsF24_AndLeavesHisRowsAsTheyWere()
        {
            var before = SmartControl.Read(_rig.SmartControlDb);
            Assert.That(Step("0a").Ok, Is.True);
            Assert.That(Step("A2").Refused, Is.True, "with Live running");
            Closed();
            Assert.That(Step("A2").Why, Does.Contain("back everything up first"), "0b comes first");
            var backup = Step("0b");
            Assert.That(backup.Ok, Is.True, backup.Text);
            Assert.That(File.Exists(Path.Combine(_rig.Backups, "smartcontrol", "before-racing-desk.db")), Is.True);
            Assert.That(Step("A1").Ok, Is.True);

            var made = Step("A2");
            Assert.That(made.Ok, Is.True, made.Text);
            Assert.That(made.Saw, Has.Some.Contains("profiles and 5 keys are as they were"));
            var after = SmartControl.Read(_rig.SmartControlDb);
            Assert.That(FirstRun.HisRowsChanged(before, after, new System.Collections.Generic.HashSet<string>(after.Profiles.Where(p => p.Name == "Racing Desk").Select(p => p.Id)), after.Keys.Single(k => k.FirstKey == "F24").BindingId), Is.Null);
            var sw = after.Profiles.Single(p => p.Name == "Racing Desk");
            Assert.That(sw.Data, Is.EqualTo(before.Profiles.Single(p => p.Name == "Default").Data), "a copy of Default");
            Assert.That(Step("A2").Ok, Is.True, "made once: running it again makes nothing more");
            Assert.That(SmartControl.Read(_rig.SmartControlDb).Profiles.Count(p => p.Name == "Racing Desk"), Is.EqualTo(1));

            Assert.That(Step("A3").Ok, Is.False, "Live is not started yet");
            _rig.Probe.Live = true;
            Assert.That(Step("A3").Ok, Is.True);

            _rig.Probe.Elevated = true;
            var refused = Step("A4");
            Assert.That(refused.Ok, Is.False);
            Assert.That(refused.Why, Does.Contain("Windows would drop the key"));
            Assert.That(_rig.Keys.Sent, Is.Zero, "nothing is sent to a window above Racing Desk");
            _rig.Probe.Elevated = false;
            Assert.That(Step("A4").Ok, Is.True);
            Assert.That(_rig.Keys.Sent, Is.EqualTo(1));

            var a5 = Step("A5");
            Assert.That(a5.Ok, Is.True, a5.Text);
            var row = SmartControl.Read(_rig.SmartControlDb).Profiles.Single(p => p.Id == sw.Id);
            Assert.That(row.Name, Is.EqualTo("Racing Desk – A5 LightBrake 40 kg"));
            Assert.That(row.Brake.MaxForceKg, Is.EqualTo(40));
            Assert.That(SmartControlProfileEditor.HashHolds(row.Data), Is.True);
            Assert.That(_rig.Keys.Sent, Is.EqualTo(2));
            Assert.That(Step("A6").Ok, Is.True);
            Assert.That(SmartControl.Read(_rig.SmartControlDb).Profiles.Single(p => p.Id == sw.Id).Brake.MaxForceKg, Is.EqualTo(65));

            Assert.That(Step("A7").Refused, Is.True, "the editor is not open");
            _rig.Probe.Editor = true;
            Assert.That(Step("A7").Ok, Is.True);
            Assert.That(Step("A7-check").Refused, Is.True, "the editor is still open");
            _rig.Probe.Editor = false;
            Assert.That(Step("A7-check").Ok, Is.True);
            Assert.That(SmartControl.Read(_rig.SmartControlDb).Profiles.Single(p => p.Name == "RD test 65").Brake.MaxForceKg, Is.EqualTo(65));

            // His three profiles and five keys, through all of it.
            var end = SmartControl.Read(_rig.SmartControlDb);
            foreach (var his in before.Profiles) Assert.That(end.Profiles.Single(p => p.Id == his.Id).Data, Is.EqualTo(his.Data), his.Name);
            Assert.That(end.Keys.Where(k => k.Action != LiveAction.SetProfile).Select(k => k.FirstKey + k.SecondKey + k.Value), Is.EqualTo(before.Keys.Select(k => k.FirstKey + k.SecondKey + k.Value)));
        }

        [Test]
        public void B1_SaysWhenItChangesNoValue_AndB1CheckSaysWhetherAppIniWasWrittenAgain()
        {
            // As on the rig today: app.ini already holds S, so B1 proves nothing of an edit surviving a launch, and says so.
            _rig.AppIni(RestorePolicy.StartHeight);
            Assert.That(Step("0b").Ok, Is.True);
            var b1 = Step("B1");
            Assert.That(b1.Ok, Is.True, b1.Text);
            Assert.That(b1.Saw, Has.Some.Contains("changes no value"));
            Assert.That(b1.Saw, Has.Some.Contains("B5, two centimetres lower, shows that"));

            _rig.Probe.Sim = true;
            var check = Step("B1-check");
            Assert.That(check.Ok, Is.True, check.Text);
            Assert.That(check.Saw, Has.Some.EqualTo("app.ini has not been written since B1"));

            // Something writes the file again before the garage screen: said, whatever the number in it.
            string ini = Path.Combine(_rig.Documents, "app.ini");
            File.SetLastWriteTimeUtc(ini, File.GetLastWriteTimeUtc(ini).AddMinutes(1));
            check = Step("B1-check");
            Assert.That(check.Ok, Is.True, "the height is still S");
            Assert.That(check.Saw, Has.Some.StartsWith("app.ini was written again after B1, at "));
        }

        [Test]
        public void B1_ThatMovesTheHeight_SaysNothingOfAWriteThatChangedNoValue()
        {
            Assert.That(Step("0b").Ok, Is.True);
            var b1 = Step("B1");
            Assert.That(b1.Ok, Is.True, b1.Text);
            Assert.That(b1.Saw, Has.None.Contains("changes no value"), "app.ini held -0.035 in this rig");
        }

        [Test]
        public void PartB_WritesTheViewFilesOnlyWithTheSimClosed_AndPutsThemBack()
        {
            byte[] ini = _rig.AppIniBytes(), cam = File.ReadAllBytes(_rig.CamPath(Car));
            _rig.Probe.Sim = true;
            Assert.That(Step("B1").Refused, Is.True);
            _rig.Probe.Sim = false;
            Assert.That(Step("0b").Ok, Is.True);
            Assert.That(Step("B1").Ok, Is.True);
            Assert.That(_rig.Files().AppIniHeight(), Is.EqualTo(RestorePolicy.StartHeight).Within(1e-9));
            using (var store = new RacingDeskStore(_rig.Store))
                Assert.That(store.ViewBaselineRow().IniOriginal, Is.EqualTo(-0.035).Within(1e-9), "what it held before Racing Desk first wrote it");

            Assert.That(Step("B1-check").Refused, Is.True, "the sim is not running");
            _rig.Probe.Sim = true;
            Assert.That(Step("B1-check").Ok, Is.True);
            Assert.That(Step("B4").Refused, Is.True, "exit the sim first");
            _rig.Probe.Sim = false;

            var b4 = Step("B4");
            Assert.That(b4.Ok, Is.True, b4.Text);
            Assert.That(_rig.CamZ(Car), Is.EqualTo(-0.02f), "Z 0 two centimetres lower");
            using (var store = new RacingDeskStore(_rig.Store))
            {
                var keep = store.CarViewKeepOf(Car);
                Assert.That((keep.OwnZ, keep.AddedZ), Is.EqualTo(((double?)0.0, -0.02)), "his own Z kept apart from what Racing Desk added");
            }
            Assert.That(Step("B5").Ok, Is.True);
            Assert.That(_rig.CamZ(Car), Is.EqualTo(0f));
            Assert.That(_rig.Files().AppIniHeight(), Is.EqualTo(-0.04).Within(1e-9));

            Assert.That(Step("B6").Ok, Is.True);
            Assert.That(_rig.CamShift(Car), Is.EqualTo(0.03f).Within(1e-6), "the horizon pair: the cockpit's shift 0.01 + 0.02");
            Assert.That(Step("B6-b").Ok, Is.True);
            Assert.That(_rig.Files().AppIniValue("DrivingVanishY"), Is.EqualTo(0.21).Within(1e-9));
            Assert.That(Step("B6-b").Ok, Is.True);
            Assert.That(Step("B6-b").Ok, Is.True);
            Assert.That(_rig.Files().AppIniValue("DrivingVanishY"), Is.EqualTo(0.21).Within(1e-9), "the original plus 0.02, the same however many times it is pressed");

            Assert.That(Step("B7").Ok, Is.True, "the FOV is as it was");
            var back = Step("B7-restore");
            Assert.That(back.Ok, Is.True, back.Text);
            Assert.That(File.ReadAllBytes(_rig.CamPath(Car)), Is.EqualTo(cam), "the camera file as it was before the run");
            Assert.That(_rig.Files().AppIniHeight(), Is.EqualTo(-0.035).Within(1e-9));
            Assert.That(_rig.Files().AppIniValue("DrivingVanishY"), Is.EqualTo(0.19).Within(1e-9));
            Assert.That(_rig.AppIniBytes(), Is.EqualTo(ini), "this made-up app.ini, which no sim rewrote, is byte for byte as it was");
            Assert.That(_rig.Keys.Sent, Is.Zero, "Part B's files press nothing");
        }

        [Test]
        public void B2_WritesTheCarsProfile_AndSendsF24_OnlyWithIRacingInFront()
        {
            Closed();
            Step("0b");
            Assert.That(Step("A2").Ok, Is.True);
            _rig.Probe.Live = true;
            Assert.That(Step("B2").Refused, Is.True, "the sim is not running");
            _rig.Probe.Sim = true;
            _director.See(new SeatFacts { CarPath = Car, CarName = "Porsche 963 GTP", IsInGarage = true, SimMode = "full", AtUtc = DateTime.UtcNow });
            Assert.That(Step("B2-flags").Ok, Is.True);

            _rig.Probe.Front = "notepad";
            var b2 = Step("B2");
            Assert.That(b2.Ok, Is.False);
            Assert.That(b2.Why, Does.Contain("not iRacing"));
            Assert.That(_rig.Keys.Sent, Is.Zero);
            _rig.Probe.Front = "iRacingSim64DX11";
            b2 = Step("B2");
            Assert.That(b2.Ok, Is.True, b2.Text);
            Assert.That(_rig.Keys.Sent, Is.EqualTo(1));
            var profiles = SmartControl.Read(_rig.SmartControlDb).Profiles;
            var own = profiles.Single(p => p.Name == "Porsche 963 GTP");
            Assert.That(own.Brake.MaxForceKg, Is.EqualTo(70), "its own, at the force he set in it");
            Assert.That(own.Data, Is.Not.EqualTo(profiles.Single(p => p.Name == "Default").Data));
            Assert.That(Encoding.UTF8.GetString(own.Data), Does.Contain("Made by Racing Desk for Porsche 963 GTP from Default"));
            var sw = profiles.Single(p => p.Name == "Racing Desk – Porsche 963 GTP");
            Assert.That(sw.Data, Is.EqualTo(own.Data), "the car's bytes in the switch row");
            using var store = new RacingDeskStore(_rig.Store);
            Assert.That(store.CarSmartControlOf(Car).ProfileId, Is.EqualTo(own.Id));
        }

        [Test]
        public void TheMarks_AreHis_AndOnlyForSteps()
        {
            Assert.That(_director.Mark("A4", "passed"), Is.True);
            Assert.That(_director.Mark("A4-nonsense", "passed"), Is.False);
            Assert.That(_director.RunStep("Z9").Refused, Is.True);
            using var store = new RacingDeskStore(_rig.Store);
            Assert.That(store.RestoreChecks().Single(c => c.Step == "A4").Mark, Is.EqualTo("passed"));
        }

        [Test]
        public void B8_ChecksTheCameraFilesHeSaved()
        {
            Assert.That(Step("B8").Ok, Is.False);
            _rig.Cam("dallaraf3", 0f, 0f, version: 15);
            var b8 = Step("B8");
            Assert.That(b8.Ok, Is.True);
            Assert.That(b8.Saw, Has.Some.Contains("dallaraf3").And.Some.Contains("Racing Desk can keep its height"));
        }
    }

    /// <summary>Undo: only what Racing Desk made or wrote, and only while the program that would undo it in turn is closed.</summary>
    [TestFixture]
    public class RestoreUndoTests
    {
        private RestoreRig _rig;
        private RestoreDirector _director;
        private const string Car = RestoreGate.TestCar;

        [SetUp]
        public void SetUp()
        {
            _rig = new RestoreRig();
            _rig.AppIni(-0.035);
            _rig.CameraIni((Car, ""));
            _rig.Cam(Car, -0.11f, 0f);
            _rig.SmartControl();
            _rig.StoreWithCars((Car, "Porsche 963 GTP", -0.02, true, 0.0, "Default", RestoreRig.DefaultId, 70.0, "rule"));
            _director = new RestoreDirector(_rig.Context(), null);
        }

        [TearDown] public void TearDown() => _rig.Dispose();

        [Test]
        public void TheBrakeProfilesRacingDeskMade_GoByTheirIds_AndHisStay()
        {
            var before = SmartControl.Read(_rig.SmartControlDb);
            _rig.Probe.Live = false;
            _director.RunStep("0b");
            Assert.That(_director.RunStep("A2").Ok, Is.True);
            _rig.Probe.Editor = true;
            Assert.That(_director.RunStep("A7").Ok, Is.True);
            Assert.That(_director.UndoBrakes().Refused, Is.True, "the editor is open");
            _rig.Probe.Editor = false;
            var undone = _director.UndoBrakes();
            Assert.That(undone.Ok, Is.True, undone.Text);
            var after = SmartControl.Read(_rig.SmartControlDb);
            Assert.That(after.Profiles.Select(p => p.Id), Is.EquivalentTo(before.Profiles.Select(p => p.Id)));
            Assert.That(after.Keys.Count, Is.EqualTo(5));
            using var store = new RacingDeskStore(_rig.Store);
            Assert.That(store.RacingDeskProfileIds(), Is.Empty);
        }

        [Test]
        public void AHeight_IsPutBackByItsFourBytes_AndWhatHeSavedBeforeItsWriteStays()
        {
            byte[] cam = File.ReadAllBytes(_rig.CamPath(Car));
            _director.RunStep("0b");
            Assert.That(_director.RunStep("B1").Ok, Is.True);
            Assert.That(_director.RunStep("B4").Ok, Is.True);
            Assert.That(_rig.CamZ(Car), Is.EqualTo(-0.02f));
            _rig.Probe.Sim = true;
            Assert.That(_director.UndoHeights(Car).Refused, Is.True);
            _rig.Probe.Sim = false;
            var undone = _director.UndoHeights(Car);
            Assert.That(undone.Ok, Is.True, undone.Text);
            Assert.That(File.ReadAllBytes(_rig.CamPath(Car)), Is.EqualTo(cam), "the file is as it was, to the byte");
            using (var store = new RacingDeskStore(_rig.Store)) Assert.That(store.CarViewKeepOf(Car), Is.Null);

            // He saves the file after 0b copied it and before Racing Desk wrote it (his seat moved): undo puts back what it held
            // when Racing Desk wrote — his seat save stays. (A put back of the 0b copy would have taken it away.)
            _rig.Cam(Car, -0.15f, 0.0f, 0.01f);
            byte[] saved = File.ReadAllBytes(_rig.CamPath(Car));
            Assert.That(_director.RunStep("B4").Ok, Is.True);
            Assert.That(_rig.CamZ(Car), Is.EqualTo(-0.02f));
            Assert.That(_director.UndoHeights(Car).Ok, Is.True);
            Assert.That(File.ReadAllBytes(_rig.CamPath(Car)), Is.EqualTo(saved), "his save stays: only Racing Desk's four bytes were changed back");
            Assert.That(BitConverter.ToSingle(File.ReadAllBytes(_rig.CamPath(Car)), 12 + 8 * 184 + 52), Is.EqualTo(-0.15f), "the seat he moved");
        }

        [Test]
        public void AFileHeSavedAfterRacingDeskWroteIt_IsLeftAsItIs_WithTheCopysPathSaid()
        {
            _director.RunStep("0b");
            Assert.That(_director.RunStep("B1").Ok, Is.True);
            Assert.That(_director.RunStep("B4").Ok, Is.True);
            _rig.Cam(Car, -0.15f, -0.01f);
            byte[] his = File.ReadAllBytes(_rig.CamPath(Car));
            var undone = _director.UndoHeights();
            Assert.That(undone.Ok, Is.True, undone.Text);
            Assert.That(File.ReadAllBytes(_rig.CamPath(Car)), Is.EqualTo(his), "touched not at all");
            Assert.That(undone.Text, Does.Contain("you saved its camera file since Racing Desk wrote it; it is left as it is"));
            Assert.That(undone.Text, Does.Contain(Path.Combine("backups", "view", "original", "cameras", "cars", "porsche963gtp", "car.cam")), "with the copy's path");
            using var store = new RacingDeskStore(_rig.Store);
            Assert.That(store.CarViewKeepOf(Car), Is.Null, "and it is his now");
        }

        [Test]
        public void UndoEverything_PutsAppInisTwoValuesBack_FromBeforeRacingDesksFirstWriteOfEach_WhicheverStepMadeIt()
        {
            byte[] ini = _rig.AppIniBytes();
            _director.RunStep("0b");
            // No B1: B5 is the first to write the height, and B6-b the first to write the horizon.
            Assert.That(_director.RunStep("B5").Ok, Is.True);
            Assert.That(_director.RunStep("B6-b").Ok, Is.True);
            Assert.That(_rig.Files().AppIniHeight(), Is.EqualTo(-0.04).Within(1e-9));
            Assert.That(_rig.Files().AppIniValue("DrivingVanishY"), Is.EqualTo(0.21).Within(1e-9));
            var undone = _director.UndoHeights();
            Assert.That(undone.Ok, Is.True, undone.Text);
            Assert.That(_rig.AppIniBytes(), Is.EqualTo(ini), "both values as they were before Racing Desk first wrote them");
            Assert.That(undone.Text, Does.Contain("driver height is −3.5 cm").And.Contain("horizon is 0.190"));
            using var store = new RacingDeskStore(_rig.Store);
            Assert.That(store.ViewBaselineRow().IniOriginal, Is.Null, "and what was kept of them is let go: the next write is a first");
        }

        [Test]
        public void UndoEverything_LeavesAnAppIniValueHeChangedSince()
        {
            _director.RunStep("0b");
            Assert.That(_director.RunStep("B5").Ok, Is.True);
            // The sim ran, he moved the height in the car, and iRacing wrote app.ini at its exit.
            _rig.AppIni(-0.05, vanishY: 0.19);
            byte[] his = _rig.AppIniBytes();
            var undone = _director.UndoHeights();
            Assert.That(_rig.AppIniBytes(), Is.EqualTo(his));
            Assert.That(undone.Text, Does.Contain("app.ini's driver height is −5.0 cm now, not what Racing Desk wrote").And.Contain("left as it is"));
        }
    }

    /// <summary>
    /// C1, his own profile and force again: owed after any F24 that went, until he says they are back; the look at the pedals'
    /// memory comes first, and after the last press; and what it shows can fail the brakes part. Racing Desk presses nothing and
    /// writes nothing in it.
    /// </summary>
    [TestFixture]
    public class ClosingTests
    {
        private RestoreRig _rig;
        private RestoreDirector _director;
        private DateTime _clock;
        private const string Car = RestoreGate.TestCar;

        [SetUp]
        public void SetUp()
        {
            _rig = new RestoreRig();
            _rig.AppIni(-0.035);
            _rig.CameraIni((Car, ""));
            _rig.Cam(Car, -0.11f, 0f, 0.01f);
            _rig.SmartControl();
            _rig.StoreWithCars((Car, "Porsche 963 GTP", -0.02, true, 0.0, "Default", RestoreRig.DefaultId, 70.0, "rule"));
            _clock = new DateTime(2026, 10, 2, 20, 0, 0, DateTimeKind.Utc);
            var ctx = _rig.Context();
            ctx.Now = () => _clock = _clock.AddSeconds(1);      // every look at the clock is a second later: what came after what is certain
            _director = new RestoreDirector(ctx, null);
            _rig.Probe.Live = false;
            _rig.Probe.Editor = false;
            Assert.That(_director.RunStep("0b").Ok, Is.True);
            Assert.That(_director.RunStep("A2").Ok, Is.True);
            _rig.Probe.Live = true;
        }

        [TearDown] public void TearDown() => _rig.Dispose();

        private StepResult Step(string id) => _director.RunStep(id);

        private ClosingState Closing()
        {
            using var store = new RacingDeskStore(_rig.Store);
            return RestoreClosing.Of(store);
        }

        private IReadOnlyList<RestoreCheck> Checks()
        {
            using var store = new RacingDeskStore(_rig.Store);
            return store.RestoreChecks();
        }

        /// <summary>The look at the pedals: Live quit, the pedals plugged back in, SmartControl open.</summary>
        private void Looking() { _rig.Probe.Live = false; _rig.Probe.Editor = true; _rig.Probe.Pedals = true; }

        /// <summary>His own profile picked and his force set: SmartControl closed, Live started.</summary>
        private void Back() { _rig.Probe.Live = true; _rig.Probe.Editor = false; }

        [Test]
        public void IsOwedFromTheFirstF24_UntilHeSaysHisOwnAreBack_ThenAgainAfterTheNext()
        {
            Assert.That(Closing().Owed, Is.False, "A2 sends no key: nothing is owed yet");
            Assert.That(Step("A4").Ok, Is.True);
            var owed = Closing();
            Assert.That((owed.Owed, owed.EepromFresh, owed.DoneAtUtc), Is.EqualTo((true, false, (DateTime?)null)));

            // The word that they are back comes after the look at the pedals' memory, and the look after the last press.
            var early = Step("C1");
            Assert.That(early.Refused, Is.True);
            Assert.That(early.Why, Does.Contain("say first what SmartControl showed"));

            _rig.Probe.Editor = true;
            var withLive = Step("C1-own");
            Assert.That(withLive.Refused, Is.True, "Live is running: it may send a profile when the pedals come back");
            Assert.That(withLive.Why, Does.Contain("quit it from its tray icon"));
            _rig.Probe.Live = false;
            _rig.Probe.Editor = false;
            Assert.That(Step("C1-own").Why, Does.Contain("open SmartControl and look"), "SmartControl is not open to look at");
            _rig.Probe.Editor = true;
            _rig.Probe.Pedals = false;
            Assert.That(Step("C1-own").Why, Does.Contain("Windows does not list the pedals"));
            Looking();
            var seen = Step("C1-own");
            Assert.That(seen.Ok, Is.True, seen.Text);
            var looked = Closing();
            Assert.That((looked.Eeprom, looked.EepromFresh, looked.Failed, looked.Owed), Is.EqualTo(("own", true, (string)null, true)), "looked, but still owed until he says they are back");

            // He picks his own profile, closes SmartControl, starts Live and sets his force.
            Assert.That(Step("C1").Why, Does.Contain("close SmartControl first"));
            _rig.Probe.Editor = false;
            Assert.That(Step("C1").Why, Does.Contain("start SmartControl Live"));
            _rig.Probe.Live = true;
            var closed = Step("C1");
            Assert.That(closed.Ok, Is.True, closed.Text);
            Assert.That(closed.Saw, Has.Some.Contains("this is your word"));
            Assert.That(Closing().Owed, Is.False);

            // A refusal afterwards does not undo it.
            _rig.Probe.Live = false;
            Assert.That(Step("C1").Refused, Is.True);
            _rig.Probe.Live = true;
            Assert.That(Closing().Owed, Is.False, "a refused press records nothing");
            Assert.That(Checks().Single(c => c.Step == "C1").RanOk, Is.True);

            // The next F24 owes it again, and the look he made before it is about the press before.
            Assert.That(Step("A5").Ok, Is.True);
            var again = Closing();
            Assert.That((again.Owed, again.EepromFresh, again.Eeprom), Is.EqualTo((true, false, "own")));
            Assert.That(Step("C1").Why, Does.Contain("say first what SmartControl showed"));
        }

        [Test]
        public void APressThatWentNowhere_OwesNothing_AndKeepsTheOneBefore()
        {
            _rig.Keys.Takes = false;
            var none = Step("A4");
            Assert.That(none.Ok, Is.False);
            Assert.That(none.Why, Does.Contain("Windows took no part of the key"));
            Assert.That(Closing().Owed, Is.False, "nothing went");
            Assert.That(Closing().PressedAtUtc, Is.Null);

            _rig.Keys.Takes = true;
            Assert.That(Step("A4").Ok, Is.True);
            var pressed = Closing().PressedAtUtc;
            Assert.That(pressed, Is.Not.Null);
            _rig.Keys.Takes = false;
            Assert.That(Step("A5").Ok, Is.False);
            Assert.That(Closing().PressedAtUtc, Is.EqualTo(pressed), "the press that did not go is not counted, and the one before stays");
            Assert.That(Closing().Owed, Is.True);
        }

        [Test]
        public void TheDebtIsWrittenDown_BeforeTheKeyGoes()
        {
            bool owedAsItWent = false;
            _rig.Keys.OnSend = () => owedAsItWent = Closing().Owed;
            Assert.That(Step("A4").Ok, Is.True);
            Assert.That(owedAsItWent, Is.True, "a crash after the key must not lose what it owes");
        }

        [Test]
        public void WhatThePedalsKept_FailsTheBrakesPart_PlainlyUntilALaterLookSaysOtherwise()
        {
            Assert.That(Step("A4").Ok, Is.True);
            foreach (string step in new[] { "A4", "A5", "A6", "B2" }) _director.Mark(step, "passed");
            Looking();

            var id = Step("C1-id");
            Assert.That(id.Ok, Is.False);
            Assert.That(id.Refused, Is.False, "it was looked at, and answered");
            Assert.That(id.Why, Does.Contain("The brakes part has failed").And.Contain("keep the profile id they are sent").And.Contain("cannot switch the brakes this way"));
            Assert.That(RestoreGate.BrakesFailed(Checks()), Is.EqualTo(id.Why));
            Assert.That(RestoreGate.BrakesProven(Checks()), Is.False, "his marks passed, and it is not proven");

            var values = Step("C1-values");
            Assert.That(values.Why, Does.Contain("saved what F24 sent"));
            Assert.That(Closing().Eeprom, Is.EqualTo("values"), "the newest look is the answer");

            // It still closes: his own profile is back, and the part stays failed.
            Back();
            var closed = Step("C1");
            Assert.That(closed.Ok, Is.True, closed.Text);
            Assert.That(closed.Saw, Has.Some.Contains("The brakes part stays failed"));
            Assert.That(Closing().Owed, Is.False);
            Assert.That(RestoreGate.BrakesProven(Checks()), Is.False);

            // A later look that shows his own clears it.
            Assert.That(Step("A4").Ok, Is.True);
            Looking();
            Assert.That(Step("C1-own").Ok, Is.True);
            Assert.That(RestoreGate.BrakesFailed(Checks()), Is.Null);
            Assert.That(RestoreGate.BrakesProven(Checks()), Is.True, "A4–A6 and B2 passed, and the pedals kept nothing");
        }

        [Test]
        public void TheBrakeProfiles_AreNotRemoved_WhileC1IsOwed_BecauseThePedalsMayBeOnOne()
        {
            Assert.That(Step("A4").Ok, Is.True);
            var refused = _director.UndoBrakes();
            Assert.That(refused.Refused, Is.True);
            Assert.That(refused.Why, Is.EqualTo(RestoreClosing.UndoRefusal));
            Assert.That(SmartControl.Read(_rig.SmartControlDb).Profiles.Select(p => p.Name), Has.Member("Racing Desk"), "nothing was removed");

            Looking();
            Assert.That(Step("C1-own").Ok, Is.True);
            Back();
            Assert.That(Step("C1").Ok, Is.True);
            var done = _director.UndoBrakes();
            Assert.That(done.Ok, Is.True, done.Text);
            Assert.That(SmartControl.Read(_rig.SmartControlDb).Profiles.Select(p => p.Name), Has.None.EqualTo("Racing Desk"));
        }

        [Test]
        public void TheBrakeProfiles_CanBeRemoved_WhenNoKeyWasEverSent()
        {
            var done = _director.UndoBrakes();
            Assert.That(done.Ok, Is.True, done.Text);
            Assert.That(_rig.Keys.Sent, Is.Zero);
        }

        [Test]
        public void C1_PressesNothing_AndWritesNothing_ButHisAnswers()
        {
            Assert.That(Step("A4").Ok, Is.True);
            int sent = _rig.Keys.Sent;
            string db = _rig.FileSha(_rig.SmartControlDb);
            byte[] ini = _rig.AppIniBytes(), cam = File.ReadAllBytes(_rig.CamPath(Car));
            Looking();
            Assert.That(Step("C1-id").Ok, Is.False);
            Assert.That(Step("C1-own").Ok, Is.True);
            Back();
            Assert.That(Step("C1").Ok, Is.True);
            Assert.That(_rig.Keys.Sent, Is.EqualTo(sent), "no key");
            Assert.That(_rig.FileSha(_rig.SmartControlDb), Is.EqualTo(db), "SmartControl's database, to the byte");
            Assert.That(_rig.AppIniBytes(), Is.EqualTo(ini));
            Assert.That(File.ReadAllBytes(_rig.CamPath(Car)), Is.EqualTo(cam));
        }

        [Test]
        public void TheRunEndsWithC1_AndHasNoA8()
        {
            Assert.That(RestoreGate.Steps.Select(s => s.Id), Does.Not.Contain("A8"));
            Assert.That(RestoreGate.Steps.Last().Id, Is.EqualTo("C1"));
            Assert.That(RestoreGate.StepOfAction("C1-id").Id, Is.EqualTo("C1"));
            Assert.That(RestoreGate.Step("C1").Actions.Select(a => a.Id), Is.EqualTo(new[] { "C1-own", "C1-id", "C1-values", "C1" }));
            Assert.That(RestoreGate.Step("C1").Actions.Any(a => a.Writes || a.Presses), Is.False, "it presses and writes nothing");
            Assert.That(_director.RunStep("A8").Refused, Is.True);
        }
    }
}
