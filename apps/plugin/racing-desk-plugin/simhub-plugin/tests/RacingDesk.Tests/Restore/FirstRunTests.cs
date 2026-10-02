using System;
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
        public void AHeight_IsPutBackFromTheOriginal_OrHisSaveKeptLessWhatWasAdded()
        {
            byte[] cam = File.ReadAllBytes(_rig.CamPath(Car));
            _director.RunStep("0b");
            Assert.That(_director.RunStep("B1").Ok, Is.True);
            Assert.That(_director.RunStep("B4").Ok, Is.True);
            Assert.That(_rig.CamZ(Car), Is.EqualTo(-0.02f));
            _rig.Probe.Sim = true;
            Assert.That(_director.UndoHeights(Car).Refused, Is.True);
            _rig.Probe.Sim = false;
            Assert.That(_director.UndoHeights(Car).Ok, Is.True);
            Assert.That(File.ReadAllBytes(_rig.CamPath(Car)), Is.EqualTo(cam));

            // He saves the file himself after Racing Desk wrote it: his save stays, less the 2 cm Racing Desk had added.
            Assert.That(_director.RunStep("B4").Ok, Is.True);
            _rig.Cam(Car, -0.15f, -0.01f);
            var undone = _director.UndoHeights();
            Assert.That(undone.Ok, Is.True, undone.Text);
            Assert.That(_rig.CamZ(Car), Is.EqualTo(0.01f).Within(1e-6));
            Assert.That(_rig.Files().AppIniHeight(), Is.EqualTo(-0.035).Within(1e-9), "all of it: app.ini's height as it was before Racing Desk");
        }
    }
}
