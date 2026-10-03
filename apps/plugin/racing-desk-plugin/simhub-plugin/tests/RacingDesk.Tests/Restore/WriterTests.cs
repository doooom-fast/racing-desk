using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using Microsoft.Data.Sqlite;
using NUnit.Framework;
using RacingDesk.Data;
using RacingDesk.Data.Pedals;
using RacingDesk.Data.Restore;

namespace RacingDesk.Tests.Restore
{
    /// <summary>
    /// SmartControl's database written the vendor's way, and only Racing Desk's own rows: a made-up database in the vendor's
    /// schema, in a folder of the test's. His profiles, presets and keys are refused whatever is asked.
    /// </summary>
    [TestFixture]
    public class SmartControlWriterTests
    {
        private RestoreRig _rig;

        [SetUp] public void SetUp() { _rig = new RestoreRig(); _rig.SmartControl(); }
        [TearDown] public void TearDown() => _rig.Dispose();

        private SmartControlWriter Writer => new SmartControlWriter(_rig.SmartControlDb);

        private string Scalar(string sql)
        {
            using var db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = _rig.SmartControlDb, Pooling = false, Mode = SqliteOpenMode.ReadOnly }.ToString());
            db.Open();
            using var cmd = db.CreateCommand();
            cmd.CommandText = sql;
            return Convert.ToString(cmd.ExecuteScalar());
        }

        [Test]
        public void ANewProfile_IsInsertedWithANewId_AndReadsBack()
        {
            var bytes = Encoding.UTF8.GetBytes(RestoreRig.NewFormatProfile(70, 5, true));
            var made = Writer.InsertProfile("Porsche 963 GTP", bytes);
            Assert.That(made.Ok, Is.True, made.Why);
            Assert.That(made.ProfileId, Does.Match("^[0-9a-f]{32}$"), "SmartControl's {0:N}");
            var row = Writer.ReadProfile(made.ProfileId);
            Assert.That(row.Value.Name, Is.EqualTo("Porsche 963 GTP"));
            Assert.That(row.Value.Data, Is.EqualTo(bytes));
            Assert.That(Scalar($"SELECT typeof(data) FROM profile_sim_device WHERE id = '{made.ProfileId}'"), Is.EqualTo("blob"), "a BLOB, as his are");
            Assert.That(Scalar("PRAGMA journal_mode"), Is.EqualTo("delete"), "SmartControl's journal mode is never touched");
            Assert.That(SmartControl.Read(_rig.SmartControlDb).Profiles.Count, Is.EqualTo(4));
        }

        [Test]
        public void HisRows_AreRefused_WhateverIsAsked()
        {
            var ours = new HashSet<string> { "aaaa" };
            var data = Encoding.UTF8.GetBytes("<Profile/>");
            Assert.That(Writer.UpdateProfile(RestoreRig.DefaultId, "Default", data, ours).Ok, Is.False);
            Assert.That(Writer.UpdateProfile(RestoreRig.DefaultId, "Default", data, null).Ok, Is.False);
            Assert.That(Writer.DeleteProfile(RestoreRig.LightId, ours).Ok, Is.False);
            Assert.That(Writer.BindProfileKey(RestoreRig.DefaultId, "F24", 1, "Default", ours).Ok, Is.False, "a key is bound only to one of Racing Desk's own profiles");
            Assert.That(Writer.Unbind(6, 6, new HashSet<string> { RestoreRig.DefaultId }).Ok, Is.False, "his Page Up is not Racing Desk's binding");
            Assert.That(Writer.ReadProfile(RestoreRig.DefaultId).Value.Data, Is.EqualTo(Encoding.UTF8.GetBytes(RestoreRig.NewFormatProfile(80, 5, true))));
            Assert.That(SmartControl.Read(_rig.SmartControlDb).Keys.Count, Is.EqualTo(5));
        }

        [Test]
        public void F24_IsBoundTheVendorsWay_AndTakenAwayAgain_AndHisKeysStay()
        {
            var made = Writer.InsertProfile("Racing Desk", Encoding.UTF8.GetBytes(RestoreRig.NewFormatProfile(80, 5, true)));
            var ours = new HashSet<string> { made.ProfileId };
            var bound = Writer.BindProfileKey(made.ProfileId, "F24", 1, "Default", ours);
            Assert.That(bound.Ok, Is.True, bound.Why);

            var keys = SmartControl.Read(_rig.SmartControlDb).Keys;
            var f24 = keys.Single(k => k.FirstKey == "F24");
            Assert.That((f24.Action, f24.ProfileId, f24.SecondKey, f24.PresetId, f24.BindingId), Is.EqualTo((LiveAction.SetProfile, made.ProfileId, "", 1L, bound.BindingId)),
                "action 1, the profile's id, an empty second key, in his Default preset");
            Assert.That(keys.Count(k => k.Action != LiveAction.SetProfile), Is.EqualTo(5), "his five keys are there");
            Assert.That(new LiveKeyWatcher(keys).Watched, Does.Not.Contain(0x87), "F24 is never watched as a force key");

            Assert.That(Writer.BindProfileKey(made.ProfileId, "F24", 1, "Default", ours).Ok, Is.False, "bound once");
            Assert.That(Writer.BindProfileKey(made.ProfileId, "F23", 1, "Something else", ours).Why, Does.Contain("not \"Something else\""));

            var unbound = Writer.Unbind(bound.BindingId, bound.LinkId, ours);
            Assert.That(unbound.Ok, Is.True, unbound.Why);
            Assert.That(SmartControl.Read(_rig.SmartControlDb).Keys.Select(k => k.FirstKey), Is.EqualTo(new[] { "PRIOR", "NEXT", "PAUSE", "RCONTROL", "RCONTROL" }));
            Assert.That(Scalar("SELECT COUNT(*) FROM profile_smartcontrol_live_keyboard_binding"), Is.EqualTo("5"));
        }

        [Test]
        public void ADatabaseOfAnotherVersion_IsNotWritten()
        {
            _rig.Dispose();
            _rig = new RestoreRig();
            _rig.SmartControl(version: 2);
            var made = Writer.InsertProfile("x", new byte[] { 1 });
            Assert.That(made.Ok, Is.False);
            Assert.That(made.Why, Does.Contain("version 2"));
            Assert.That(SmartControl.Read(_rig.SmartControlDb).Profiles.Count, Is.EqualTo(3));
        }

        [Test]
        public void AWriteWaitsBriefly_ForADatabaseSomebodyHolds_ThenSaysSo()
        {
            using var holder = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = _rig.SmartControlDb, Pooling = false }.ToString());
            holder.Open();
            using var hold = holder.BeginTransaction();
            RestoreRig.Run(holder, "UPDATE database_version SET version_number = 1");   // a write lock, as SmartControl's own save would hold
            var started = DateTime.UtcNow;
            var made = Writer.InsertProfile("x", Encoding.UTF8.GetBytes("<Profile/>"));
            Assert.That(made.Ok, Is.False);
            Assert.That(made.Why, Does.Contain("not written"));
            Assert.That(DateTime.UtcNow - started, Is.LessThan(TimeSpan.FromSeconds(8)), "a short wait, not half a minute");
        }

        [Test]
        public void TheCopyBeforeAStepsWrite_IsTimestamped_Checked_AndOnlyTheLastTenAreKept()
        {
            string folder = Path.Combine(_rig.Backups, "smartcontrol");
            Directory.CreateDirectory(folder);
            File.WriteAllText(Path.Combine(folder, "before-racing-desk.db"), "kept for good");      // a copy of another kind: never pruned
            var at = new DateTime(2026, 10, 2, 20, 0, 0, DateTimeKind.Utc);
            for (int i = 0; i < 13; i++) Assert.That(Writer.BackUpBeforeWrite(folder, "brakes", at.AddMinutes(i), keep: 10), Is.Null);
            var copies = Directory.GetFiles(folder, "before-write-*.db").Select(Path.GetFileName).OrderBy(n => n, StringComparer.Ordinal).ToList();
            Assert.That(copies, Has.Count.EqualTo(10));
            Assert.That(copies.First(), Is.EqualTo("before-write-" + at.AddMinutes(3).ToLocalTime().ToString("yyyy-MM-dd_HHmmss_fff", System.Globalization.CultureInfo.InvariantCulture) + "-brakes.db"),
                "the three oldest went, and the others are named for their time and their step");
            Assert.That(File.ReadAllText(Path.Combine(folder, "before-racing-desk.db")), Is.EqualTo("kept for good"));
            string newest = Path.Combine(folder, copies.Last());
            Assert.That(Writer.Check(newest), Is.Null, "it opens and holds what the database holds");
            Assert.That(SmartControl.Read(newest).Profiles.Select(p => p.Name), Is.EquivalentTo(new[] { "Default", "LightBrake", "Rain" }));
        }

        [Test]
        public void TheCopyBeforeAWrite_SaysWhyWhenItCannotBeMade()
        {
            Directory.CreateDirectory(_rig.Backups);
            string folder = Path.Combine(_rig.Backups, "smartcontrol");
            File.WriteAllText(folder, "a file where the folder of the copies should be");
            var why = Writer.BackUpBeforeWrite(folder, "brakes", DateTime.UtcNow);
            Assert.That(why, Does.Contain("the backup could not be made"));
        }

        [Test]
        public void TheBackup_IsSQLitesOwn_AndChecked()
        {
            string to = Path.Combine(_rig.Backups, "smartcontrol", "before-racing-desk.db");
            Assert.That(Writer.Backup(to), Is.Null);
            Assert.That(SmartControl.Read(to).Profiles.Select(p => p.Name), Is.EquivalentTo(new[] { "Default", "LightBrake", "Rain" }));
            Assert.That(Writer.Check(to), Is.Null);
            Writer.InsertProfile("later", new byte[] { 1, 2 });
            Assert.That(Writer.Check(to), Does.Contain("profile_sim_device"), "a backup that does not hold what the database holds says so");
        }
    }

    /// <summary>
    /// iRacing's view files written only while the sim is closed, backed up first, swapped in and read back; both files changed
    /// together are kept in the store before either is touched, and a write cut short is finished at the next start.
    /// </summary>
    [TestFixture]
    public class ViewFilesTests
    {
        private RestoreRig _rig;
        private const string Car = "porsche963gtp";

        [SetUp]
        public void SetUp()
        {
            _rig = new RestoreRig();
            _rig.AppIni(-0.035);
            _rig.CameraIni((Car, ""));
            _rig.Cam(Car, -0.11f, 0f, 0.01f);
            using var store = new RacingDeskStore(_rig.Store);
        }

        [TearDown] public void TearDown() => _rig.Dispose();

        [Test]
        public void BothFiles_AreBackedUpFirst_WrittenAppIniFirst_AndReadBack()
        {
            byte[] iniBefore = _rig.AppIniBytes(), camBefore = File.ReadAllBytes(_rig.CamPath(Car));
            var files = _rig.Files();
            var r = files.Apply(new ViewChange { CarPath = Car, IniHeight = -0.02, CockpitZ = -0.005 });
            Assert.That(r.Ok, Is.True, r.Why);
            Assert.That(files.AppIniHeight(), Is.EqualTo(-0.02).Within(1e-9));
            Assert.That(_rig.CamZ(Car), Is.EqualTo(-0.005f));
            Assert.That(File.ReadAllBytes(r.IniBackup), Is.EqualTo(iniBefore));
            Assert.That(File.ReadAllBytes(r.CamBackup), Is.EqualTo(camBefore));
            Assert.That(File.ReadAllBytes(files.Original("app.ini")), Is.EqualTo(iniBefore), "the first original is kept for ever");
            files.Apply(new ViewChange { IniHeight = -0.01 });
            Assert.That(File.ReadAllBytes(files.Original("app.ini")), Is.EqualTo(iniBefore), "and not replaced by a later one");
            using var store = new RacingDeskStore(_rig.Store);
            Assert.That(store.CarViewKeepOf(Car)?.Intent, Is.Null, "the record of the write is let go once it is done");
            Assert.That(Directory.GetFiles(Path.GetDirectoryName(_rig.CamPath(Car))), Has.Length.EqualTo(1), "no temp file left beside it");
        }

        [Test]
        public void NothingIsWritten_WhileTheSimRuns_OrBeyondTheLimits_OrToAFileOfAnotherLayout()
        {
            byte[] ini = _rig.AppIniBytes(), cam = File.ReadAllBytes(_rig.CamPath(Car));
            _rig.Probe.Sim = true;
            Assert.That(_rig.Files().Apply(new ViewChange { CarPath = Car, IniHeight = -0.02, CockpitZ = 0f }).Why, Does.Contain("iRacing is running"));
            _rig.Probe.Sim = false;
            Assert.That(_rig.Files().Apply(new ViewChange { CarPath = Car, CockpitZ = 0.06 }).Why, Does.Contain("beyond"));
            Directory.CreateDirectory(Path.GetDirectoryName(_rig.CamPath("dallaraf3")));
            File.WriteAllBytes(_rig.CamPath("dallaraf3"), RestoreRig.CarCam(16, 0f, 0f, 0f));
            Assert.That(_rig.Files().Apply(new ViewChange { CarPath = "dallaraf3", CockpitZ = 0.01 }).Why, Does.Contain("version is 16"));
            Assert.That(_rig.Files().Apply(new ViewChange { CarPath = "caterham caterham420r", CockpitZ = 0.01 }).Why, Does.Contain("no camera file"));
            Assert.That(_rig.AppIniBytes(), Is.EqualTo(ini));
            Assert.That(File.ReadAllBytes(_rig.CamPath(Car)), Is.EqualTo(cam));
            Assert.That(Directory.Exists(_rig.Backups), Is.False, "a write refused before it began backs nothing up");
        }

        /// <summary>A two-file write that the sim starting cuts short: app.ini written, the camera file not, a record left.</summary>
        private ViewWriteResult CutShort(out byte[] ini, out byte[] cam)
        {
            ini = _rig.AppIniBytes();
            cam = File.ReadAllBytes(_rig.CamPath(Car));
            var probe = new SimStartsAfter(asked: 4, _rig.Probe);
            var files = new ViewFiles(_rig.Documents, Path.Combine(_rig.Backups, "view"), probe, _rig.Store);
            return files.Apply(new ViewChange { CarPath = Car, IniHeight = -0.02, CockpitZ = -0.005 });
        }

        [Test]
        public void TheSimStartingBetweenTheTwoFiles_LeavesAppIniForTheNextStart_WhichPutsItBack_AndFinishesNothing()
        {
            var r = CutShort(out byte[] ini, out byte[] cam);
            Assert.That(r.Ok, Is.False);
            Assert.That(r.Why, Does.Contain("iRacing started before the camera file was written"));
            Assert.That(r.Why, Does.Contain("When Racing Desk next starts it puts app.ini back").And.Contain("if nothing else has written app.ini by then"),
                "the message says what the next start does, and on what terms");
            Assert.That(_rig.CamZ(Car), Is.EqualTo(0f), "the camera file was not written");
            Assert.That(_rig.Files().AppIniHeight(), Is.EqualTo(-0.02).Within(1e-9), "app.ini cannot be put back while the sim runs");
            // The sim is up: the record says what was to be done, and the values to put back by.
            ViewIntent intent;
            using (var store = new RacingDeskStore(_rig.Store)) intent = System.Text.Json.JsonSerializer.Deserialize<ViewIntent>(store.CarViewKeepOf(Car).Intent);
            Assert.That((intent.IniHeightBefore, intent.IniHeightAfter, intent.CamFile), Is.EqualTo(((double?)-0.035, (double?)-0.02, ViewFiles.DefaultCamFile(Car))));

            // The next start, with the sim closed: the step was cut short, and app.ini is put back by its value — not finished.
            var note = _rig.Files().Settle().Single();
            Assert.That(note.State, Is.EqualTo("done"));
            Assert.That(note.Text, Does.Contain("was cut short").And.Contain("app.ini was put back").And.Contain("the camera file was not touched"));
            Assert.That(File.ReadAllBytes(_rig.CamPath(Car)), Is.EqualTo(cam), "the camera file is not written by a settling");
            Assert.That(_rig.AppIniBytes(), Is.EqualTo(ini), "this made-up app.ini is byte for byte as it was");
            using (var store = new RacingDeskStore(_rig.Store)) Assert.That(store.CarViewKeepOf(Car), Is.Null, "the row made only to hold the record goes with it");
            Assert.That(_rig.Files().Settle(), Is.Empty, "and it is settled once");
        }

        [Test]
        public void ASettling_WaitsForTheSimToClose_AndTouchesNothingWhileItRuns()
        {
            CutShort(out _, out byte[] cam);
            byte[] cut = _rig.AppIniBytes();
            _rig.Probe.Sim = true;
            Assert.That(_rig.Files().Settle(), Is.Empty);
            Assert.That(_rig.AppIniBytes(), Is.EqualTo(cut));
            using var store = new RacingDeskStore(_rig.Store);
            Assert.That(store.CarViewKeepOf(Car).Intent, Is.Not.Null, "the record waits");
            Assert.That(File.ReadAllBytes(_rig.CamPath(Car)), Is.EqualTo(cam));
        }

        [Test]
        public void ASettling_TouchesNothing_WhenAppIniHoldsNeitherWhatWasWrittenNorWhatItWas()
        {
            CutShort(out _, out byte[] cam);
            // The sim ran, and rewrote app.ini at its exit with a height of its own.
            _rig.AppIni(-0.03);
            byte[] theirs = _rig.AppIniBytes();
            var note = _rig.Files().Settle().Single();
            Assert.That(note.State, Is.EqualTo("left"));
            Assert.That(note.Text, Does.Contain("changed since").And.Contain("both are left as they are"));
            Assert.That(_rig.AppIniBytes(), Is.EqualTo(theirs));
            Assert.That(File.ReadAllBytes(_rig.CamPath(Car)), Is.EqualTo(cam));
            using var store = new RacingDeskStore(_rig.Store);
            Assert.That(store.CarViewKeepOf(Car), Is.Null, "the record is let go all the same");
        }

        [Test]
        public void ASettling_OfAWriteThatWasDone_JustLetsItsRecordGo()
        {
            CutShort(out _, out _);
            // The camera file is written as it was to be (by a hand, or a run that got further): both files hold the new state.
            _rig.Cam(Car, -0.11f, -0.005f, 0.01f);
            byte[] ini = _rig.AppIniBytes(), cam = File.ReadAllBytes(_rig.CamPath(Car));
            var note = _rig.Files().Settle().Single();
            Assert.That((note.State, note.Text), Is.EqualTo(("info", "the write was done; its record let go")));
            Assert.That(_rig.AppIniBytes(), Is.EqualTo(ini));
            Assert.That(File.ReadAllBytes(_rig.CamPath(Car)), Is.EqualTo(cam));
            using var store = new RacingDeskStore(_rig.Store);
            Assert.That(store.CarViewKeepOf(Car), Is.Null);
        }

        [Test]
        public void ASettling_GoesByTheFileTheWriteNamed_NotByWhatCameraIniSaysNow()
        {
            CutShort(out byte[] ini, out byte[] cam);
            // camera.ini now names another file for the car; that file is not the one the write named, and is not looked at.
            string other = Path.Combine(_rig.Documents, "cameras", "cars", "porsche963gtp", "race.cam");
            File.WriteAllBytes(other, RestoreRig.CarCam(15, 0.5f, 0f, 0.04f));
            byte[] otherBytes = File.ReadAllBytes(other);
            _rig.CameraIni((Car, @"cars\porsche963gtp\race.cam"));
            var note = _rig.Files().Settle().Single();
            Assert.That(note.State, Is.EqualTo("done"), "the file the write named is as it was, so app.ini is put back");
            Assert.That(_rig.AppIniBytes(), Is.EqualTo(ini));
            Assert.That(File.ReadAllBytes(_rig.CamPath(Car)), Is.EqualTo(cam));
            Assert.That(File.ReadAllBytes(other), Is.EqualTo(otherBytes), "the file camera.ini names now is never written");
        }

        [Test]
        public void ARecordWithNoValuesOfItsOwn_IsPutBackFromTheBackupsValues_NotTheWholeFile()
        {
            CutShort(out byte[] ini, out _);
            // A record that kept no values (from before they were kept): the values are read from the copy taken first, and
            // only the one that differs is set back.
            using (var store = new RacingDeskStore(_rig.Store))
            {
                var row = store.CarViewKeepOf(Car);
                var intent = System.Text.Json.JsonSerializer.Deserialize<ViewIntent>(row.Intent);
                intent.IniHeightBefore = intent.IniVanishYBefore = intent.IniHeightAfter = intent.IniVanishYAfter = null;
                row.Intent = System.Text.Json.JsonSerializer.Serialize(intent);
                store.SaveCarViewKeep(row);
            }
            var note = _rig.Files().Settle().Single();
            Assert.That(note.State, Is.EqualTo("done"));
            Assert.That(_rig.AppIniBytes(), Is.EqualTo(ini));
            Assert.That(_rig.Files().AppIniValue("DrivingVanishY"), Is.EqualTo(0.19).Within(1e-9));
        }

        [Test]
        public void AWriteThatIsRefusedAfterItsRecordWasKept_LeavesNoRowForUndoToFind()
        {
            var probe = new SimStartsAfter(asked: 1, _rig.Probe);       // the sim is up by the time app.ini is to be written
            var files = new ViewFiles(_rig.Documents, Path.Combine(_rig.Backups, "view"), probe, _rig.Store);
            var r = files.Apply(new ViewChange { CarPath = Car, IniHeight = -0.02, CockpitZ = -0.005 });
            Assert.That(r.Ok, Is.False);
            Assert.That(r.Why, Does.Contain("nothing was written"));
            using var store = new RacingDeskStore(_rig.Store);
            Assert.That(store.CarViewKeepOf(Car), Is.Null);
            Assert.That(store.CarViewKeeps(), Is.Empty);
        }

        [Test]
        public void ARowThatKeepsAHeight_StaysWhenARecordIsLetGo()
        {
            using (var store = new RacingDeskStore(_rig.Store))
                store.SaveCarViewKeep(new CarViewKeep { CarPath = Car, CamFile = ViewFiles.DefaultCamFile(Car), OwnZ = 0, WrittenZ = -0.02, WrittenSha = "x", SeenAtUtc = DateTime.UtcNow });
            Assert.That(_rig.Files().Apply(new ViewChange { CarPath = Car, IniHeight = -0.02, CockpitZ = -0.005 }).Ok, Is.True);
            using var again = new RacingDeskStore(_rig.Store);
            var row = again.CarViewKeepOf(Car);
            Assert.That((row.OwnZ, row.WrittenZ, row.Intent), Is.EqualTo(((double?)0.0, (double?)-0.02, (string)null)));
        }

        [Test]
        public void WhatAppIniHeld_IsKeptByTheWriter_BeforeItsFirstWriteOfEachValue_WhicheverStepMakesIt()
        {
            var files = _rig.Files();
            Assert.That(files.Apply(new ViewChange { IniVanishY = 0.21 }).Ok, Is.True);       // the horizon first, on its own
            Assert.That(files.Apply(new ViewChange { IniHeight = -0.04 }).Ok, Is.True);       // the height later
            Assert.That(files.Apply(new ViewChange { IniHeight = -0.05, IniVanishY = 0.25 }).Ok, Is.True);
            using var store = new RacingDeskStore(_rig.Store);
            var b = store.ViewBaselineRow();
            Assert.That((b.IniOriginal, b.VanishYOriginal), Is.EqualTo(((double?)-0.035, (double?)0.19)), "each as it was before Racing Desk's first write of that value");
            Assert.That((b.IniHeightWritten, b.VanishYWritten), Is.EqualTo(((double?)-0.05, (double?)0.25)), "and each as Racing Desk last wrote it");
        }

        /// <summary>The sim, closed until it has been asked a number of times, then running.</summary>
        private sealed class SimStartsAfter : IRigProbe
        {
            private int _left;
            private readonly IRigProbe _rest;
            public SimStartsAfter(int asked, IRigProbe rest) { _left = asked; _rest = rest; }
            public bool SimRunning() => _left-- <= 0;
            public bool EditorRunning() => _rest.EditorRunning();
            public bool LiveRunning() => _rest.LiveRunning();
            public DateTime? LiveStartedAtUtc() => _rest.LiveStartedAtUtc();
            public bool? ForegroundElevated() => _rest.ForegroundElevated();
            public string ForegroundProcess() => _rest.ForegroundProcess();
            public bool? PedalsConnected() => _rest.PedalsConnected();
            public bool? SimElevated() => _rest.SimElevated();
        }

        [Test]
        public void LastCarSet_NamesTheFile_ThatOneAndNoOther()
        {
            _rig.CameraIni(("mx5 mx52016", @"cars\mx5\mx52016\race.cam"));
            string race = Path.Combine(_rig.Documents, "cameras", "cars", "mx5", "mx52016", "race.cam");
            Directory.CreateDirectory(Path.GetDirectoryName(race));
            File.WriteAllBytes(race, RestoreRig.CarCam(15, 0f, 0f, 0f));
            _rig.Cam("mx5 mx52016", 0f, 0.02f);
            var state = _rig.Files().Cam("mx5 mx52016");
            Assert.That((state.FromLastCarSet, state.RelativePath), Is.EqualTo((true, Path.Combine("cameras", "cars", "mx5", "mx52016", "race.cam"))));
            Assert.That(_rig.Files().Apply(new ViewChange { CarPath = "mx5 mx52016", CockpitZ = 0.015 }).Ok, Is.True);
            Assert.That(BitConverter.ToSingle(File.ReadAllBytes(race), 12 + 8 * 184 + 60), Is.EqualTo(0.015f));
            Assert.That(_rig.CamZ("mx5 mx52016"), Is.EqualTo(0.02f), "car.cam, which iRacing does not load for it, is left");

            _rig.CameraIni(("mx5 mx52016", @"..\..\..\app.ini"));
            Assert.That(_rig.Files().Cam("mx5 mx52016").FromLastCarSet, Is.False, "a name that climbs out of the cameras folder is not followed");
        }

        [Test]
        public void AValueIsPutBack_ByItsFourBytes_AndOnlyWhileItIsWhatRacingDeskWrote()
        {
            var files = _rig.Files();
            string rel = ViewFiles.DefaultCamFile(Car);
            byte[] cam = File.ReadAllBytes(_rig.CamPath(Car));
            Assert.That(files.Apply(new ViewChange { CarPath = Car, CockpitZ = 0.03 }).Ok, Is.True);
            byte[] wrote = File.ReadAllBytes(_rig.CamPath(Car));

            // Still what Racing Desk wrote: back to what it held, four bytes, and the file is as it was to the byte.
            var put = files.Apply(new ViewChange { CamFile = rel, CockpitZ = 0.0, ExpectCockpitZ = 0.03, Restoring = true });
            Assert.That(put.Ok, Is.True, put.Why);
            Assert.That(File.ReadAllBytes(_rig.CamPath(Car)), Is.EqualTo(cam));

            // He saved it since (Z 0.04, his seat moved too): nothing is written, and the file is his.
            _rig.Cam(Car, -0.2f, 0.04f, 0.01f);
            byte[] his = File.ReadAllBytes(_rig.CamPath(Car));
            var refused = files.Apply(new ViewChange { CamFile = rel, CockpitZ = 0.0, ExpectCockpitZ = 0.03, Restoring = true });
            Assert.That(refused.Ok, Is.False);
            Assert.That(refused.Why, Does.Contain("no longer what Racing Desk wrote").And.Contain("you saved the file since"));
            Assert.That(File.ReadAllBytes(_rig.CamPath(Car)), Is.EqualTo(his));
            Assert.That(wrote, Is.Not.EqualTo(his));
        }

        [Test]
        public void AValueThatWasInTheFileBefore_IsPutBack_WhateverTheLimitOfAWrite()
        {
            var files = _rig.Files();
            _rig.Cam(Car, -0.11f, 0.08f, 0.01f);            // his own Z, beyond the 5 cm a write is kept to
            string rel = ViewFiles.DefaultCamFile(Car);
            Assert.That(files.Apply(new ViewChange { CarPath = Car, CockpitZ = 0.04 }).Ok, Is.True);
            Assert.That(files.Apply(new ViewChange { CarPath = Car, CockpitZ = 0.08 }).Why, Does.Contain("beyond"), "a write is held to the limit");
            Assert.That(files.Apply(new ViewChange { CamFile = rel, CockpitZ = 0.08, ExpectCockpitZ = 0.04, Restoring = true }).Ok, Is.True, "a put back is not");
            Assert.That(_rig.CamZ(Car), Is.EqualTo(0.08f));
        }

        [Test]
        public void AnAppIniValue_IsPutBack_OnlyWhileItHoldsWhatWasWritten()
        {
            var files = _rig.Files();
            Assert.That(files.Apply(new ViewChange { IniHeight = -0.04 }).Ok, Is.True);
            var refused = files.Apply(new ViewChange { IniHeight = -0.035, ExpectIniHeight = -0.05, Restoring = true });
            Assert.That(refused.Ok, Is.False);
            Assert.That(refused.Why, Does.Contain("no longer what Racing Desk wrote"));
            Assert.That(files.AppIniHeight(), Is.EqualTo(-0.04).Within(1e-9));
            Assert.That(files.Apply(new ViewChange { IniHeight = -0.035, ExpectIniHeight = -0.04, Restoring = true }).Ok, Is.True);
            Assert.That(files.AppIniHeight(), Is.EqualTo(-0.035).Within(1e-9));
        }

        [Test]
        public void TheFileNamedInTheChange_IsTheOneWritten_AndCameraIniIsNotAskedAgain()
        {
            string race = Path.Combine(_rig.Documents, "cameras", "cars", "porsche963gtp", "race.cam");
            File.WriteAllBytes(race, RestoreRig.CarCam(15, 0.5f, 0f, 0.02f));
            _rig.CameraIni((Car, @"cars\porsche963gtp\race.cam"));       // iRacing would load race.cam now
            byte[] raceBytes = File.ReadAllBytes(race);
            var r = _rig.Files().Apply(new ViewChange { CarPath = Car, CamFile = ViewFiles.DefaultCamFile(Car), CockpitZ = 0.03 });
            Assert.That(r.Ok, Is.True, r.Why);
            Assert.That(_rig.CamZ(Car), Is.EqualTo(0.03f), "car.cam, which the change named");
            Assert.That(File.ReadAllBytes(race), Is.EqualTo(raceBytes), "race.cam, which camera.ini names, was not looked up");
            Assert.That(_rig.Files().Apply(new ViewChange { CarPath = Car, CamFile = @"..\app.ini", CockpitZ = 0.03 }).Why, Does.Contain("not one a camera file is kept under"));
        }
    }

    /// <summary>Schema v9: five tables added, and nothing else of the store changed.</summary>
    [TestFixture]
    public class RestoreStoreTests
    {
        private RestoreRig _rig;
        [SetUp] public void SetUp() => _rig = new RestoreRig();
        [TearDown] public void TearDown() => _rig.Dispose();

        private static IEnumerable<string> Tables(string path)
        {
            using var db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = path, Pooling = false }.ToString());
            db.Open();
            using var cmd = db.CreateCommand();
            cmd.CommandText = "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name";
            using var r = cmd.ExecuteReader();
            var list = new List<string>();
            while (r.Read()) list.Add(r.GetString(0));
            return list;
        }

        [Test]
        public void AStoreFromV8_GainsTheFiveTables_AndKeepsWhatItHad()
        {
            _rig.StoreWithCars(("porsche963gtp", "Porsche 963 GTP", -0.02, true, 0.0, "Default", RestoreRig.DefaultId, 70.0, "rule"));
            // Back to v8, as an earlier build left it.
            using (var db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = _rig.Store, Pooling = false }.ToString()))
            {
                db.Open();
                // A store made fresh says its version once; an earlier build's says 8.
                RestoreRig.Run(db, "DROP TABLE car_view_keep; DROP TABLE view_baseline; DROP TABLE car_smartcontrol; DROP TABLE smartcontrol_switch; DROP TABLE restore_events; UPDATE schema_version SET version = 8 WHERE version = 9;");
            }
            SqliteConnection.ClearAllPools();
            using (var read = RacingDeskStore.OpenReadOnly(_rig.Store))
            {
                Assert.That(read.HasRestoreTables, Is.False);
                Assert.That(read.RestoreEvents(), Is.Empty, "a store from before v9 has none, and is not refused");
                Assert.That(read.CarSmartControls(), Is.Empty);
            }
            using (var store = new RacingDeskStore(_rig.Store))
            {
                Assert.That(store.Scalar<long>("SELECT MAX(version) FROM schema_version"), Is.EqualTo(9));
                Assert.That(store.HasRestoreTables, Is.True);
                Assert.That(store.CarPedalFactsOf("porsche963gtp").ForceKg, Is.EqualTo(70), "what it had stays");
            }
            Assert.That(Tables(_rig.Store), Is.SupersetOf(new[] { "car_view_keep", "view_baseline", "car_smartcontrol", "smartcontrol_switch", "restore_events", "car_views", "car_pedals" }));
            Assert.That(Tables(_rig.Store), Has.No.Member("restore_checks"), "the marks of a first run are not kept");
        }

        [Test]
        public void TheRowsGoInAndComeBack()
        {
            using var store = new RacingDeskStore(_rig.Store);
            var at = new DateTime(2026, 10, 2, 20, 0, 0, DateTimeKind.Utc);
            Assert.That(store.SaveCarSmartControl(new CarSmartControl { CarPath = "porsche963gtp", ProfileId = "ab", ProfileName = "Porsche 963 GTP", BaseName = "Default", MadeAtUtc = at, WrittenSha = "S", WrittenKg = 70, WrittenAtUtc = at }), Is.True);
            Assert.That(store.SaveSmartControlSwitch(new SmartControlSwitch { ProfileId = "cd", ProfileName = "Racing Desk", Key = "F24", BindingId = 12, LinkId = 12, PresetId = 1, MadeAtUtc = at, BoundAtUtc = at.AddSeconds(1), PedalsAtUtc = at.AddSeconds(2) }), Is.True);
            Assert.That(store.RacingDeskProfileIds(), Is.EquivalentTo(new[] { "ab", "cd" }));
            var sw = store.SmartControlSwitchRow();
            Assert.That((sw.BoundAtUtc, sw.PedalsAtUtc), Is.EqualTo(((DateTime?)at.AddSeconds(1), (DateTime?)at.AddSeconds(2))));
            Assert.That(store.CarSmartControlOf("PORSCHE963GTP").WrittenKg, Is.EqualTo(70), "a car's folder without regard to case, as the list has it");

            long first = store.AddRestoreEvent(new RestoreEvent { CarPath = "porsche963gtp", What = "brakes", State = "done", Text = "one", AtUtc = at });
            long second = store.AddRestoreEvent(new RestoreEvent { What = "height", State = "done", Text = "two", AtUtc = at });
            Assert.That(store.RestoreEvents().Select(e => (e.Text, e.CarPath)), Is.EqualTo(new[] { ("one", "porsche963gtp"), ("two", (string)null) }));
            Assert.That(store.RestoreEvents(first).Single().Id, Is.EqualTo(second));

            Assert.That(store.SaveViewBaseline(new ViewBaseline { StartHeight = -0.02, DecidedAtUtc = at, DecidedBy = "Kevin", IniOriginal = -0.035 }), Is.True);
            store.SaveViewBaseline(new ViewBaseline { StartHeight = -0.02, DecidedAtUtc = at, IniOriginal = -0.01 });
            Assert.That(store.ViewBaselineRow().IniOriginal, Is.EqualTo(-0.035), "what app.ini held before Racing Desk first wrote it is kept, not replaced");
            Assert.That(store.NoteHeightsMoved(at), Is.True);
            Assert.That(store.NoteLaunch(-0.025, at.AddMinutes(1)), Is.True);
            var b = store.ViewBaselineRow();
            Assert.That((b.MigratedAtUtc, b.LaunchHeight, b.LaunchAtUtc, b.IniOriginal), Is.EqualTo(((DateTime?)at, (double?)-0.025, (DateTime?)at.AddMinutes(1), (double?)-0.035)), "one value at a time, the rest as they were");
            store.NoteHeightsMoved(null);
            Assert.That(store.ViewBaselineRow().MigratedAtUtc, Is.Null);
        }

        [Test]
        public void AV9StoreMadeBeforeAppInisValuesWereKept_GainsTheirColumns_AndIsReadWithoutThemReadOnly()
        {
            _rig.StoreWithCars(("porsche963gtp", "Porsche 963 GTP", -0.02, true, 0.0, "Default", RestoreRig.DefaultId, 70.0, "rule"));
            // As an earlier build of v9 left it: the baseline table without the three columns.
            using (var db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = _rig.Store, Pooling = false }.ToString()))
            {
                db.Open();
                RestoreRig.Run(db, @"DROP TABLE view_baseline;
CREATE TABLE view_baseline (id INTEGER PRIMARY KEY CHECK (id = 1), start_height REAL NOT NULL, decided_at TEXT NOT NULL, decided_by TEXT,
  ini_original REAL, ini_backup TEXT, ini_written_at TEXT, migrated_at TEXT, launch_height REAL, launch_at TEXT);
INSERT INTO view_baseline (id, start_height, decided_at, ini_original) VALUES (1, -0.02, '2026-10-02T12:00:00.000Z', -0.035)");
            }
            SqliteConnection.ClearAllPools();
            using (var read = RacingDeskStore.OpenReadOnly(_rig.Store))
            {
                var b = read.ViewBaselineRow();
                Assert.That((b.IniOriginal, b.VanishYOriginal, b.IniHeightWritten), Is.EqualTo(((double?)-0.035, (double?)null, (double?)null)), "read as it is, with no columns to read");
            }
            using (var store = new RacingDeskStore(_rig.Store))
            {
                var at = new DateTime(2026, 10, 2, 20, 0, 0, DateTimeKind.Utc);
                Assert.That(store.NoteIniValues(-0.035, -0.02, 0.19, 0.21, at), Is.True);
                var b = store.ViewBaselineRow();
                Assert.That((b.IniOriginal, b.IniHeightWritten, b.VanishYOriginal, b.VanishYWritten), Is.EqualTo(((double?)-0.035, (double?)-0.02, (double?)0.19, (double?)0.21)));
                Assert.That(b.IniWrittenAtUtc, Is.EqualTo(at), "and when Racing Desk wrote it");
                Assert.That(store.NoteIniValues(-0.5, -0.04, 0.5, 0.25, at), Is.True);
                b = store.ViewBaselineRow();
                Assert.That((b.IniOriginal, b.IniHeightWritten, b.VanishYOriginal, b.VanishYWritten), Is.EqualTo(((double?)-0.035, (double?)-0.04, (double?)0.19, (double?)0.25)),
                    "what it held before the first write stays; what it last wrote is replaced");
                Assert.That(store.NoteIniValues(null, null, null, null, at), Is.True);
                Assert.That(store.ViewBaselineRow().IniHeightWritten, Is.EqualTo(-0.04), "nothing given leaves what is kept");
                Assert.That(store.ForgetIniValues(), Is.True);
                var gone = store.ViewBaselineRow();
                Assert.That((gone.IniOriginal, gone.IniHeightWritten, gone.VanishYOriginal, gone.VanishYWritten), Is.EqualTo(((double?)null, (double?)null, (double?)null, (double?)null)));
            }
        }

        [Test]
        public void OldLinesGo_AsNewOnesCome()
        {
            using var store = new RacingDeskStore(_rig.Store);
            for (int i = 0; i < RacingDeskStore.RestoreEventsKept + 20; i++) store.AddRestoreEvent(new RestoreEvent { What = "x", State = "done", Text = "line " + i });
            Assert.That(store.Scalar<long>("SELECT COUNT(*) FROM restore_events"), Is.EqualTo(RacingDeskStore.RestoreEventsKept));
            Assert.That(store.RestoreEvents(0, 1).Single().Text, Is.EqualTo("line " + (RacingDeskStore.RestoreEventsKept + 19)));
        }
    }
}
