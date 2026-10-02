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

        [Test]
        public void TheSimStartingBetweenTheTwoFiles_PutsAppIniBack_OrLeavesItForTheNextStart()
        {
            byte[] ini = _rig.AppIniBytes();
            var probe = new SimStartsAfter(asked: 4, _rig.Probe);
            var files = new ViewFiles(_rig.Documents, Path.Combine(_rig.Backups, "view"), probe, _rig.Store);
            var r = files.Apply(new ViewChange { CarPath = Car, IniHeight = -0.02, CockpitZ = -0.005 });
            Assert.That(r.Ok, Is.False);
            Assert.That(r.Why, Does.Contain("iRacing started"));
            Assert.That(_rig.CamZ(Car), Is.EqualTo(0f), "the camera file was not written");
            // The sim is up: app.ini cannot be put back now, and its record says what to do at the next start.
            using (var store = new RacingDeskStore(_rig.Store)) Assert.That(store.CarViewKeepOf(Car).Intent, Is.Not.Null);

            // The next start, with the sim closed: the write is finished.
            var said = _rig.Files().Settle();
            Assert.That(said.Single(), Does.Contain("finished"));
            Assert.That(_rig.CamZ(Car), Is.EqualTo(-0.005f));
            Assert.That(_rig.Files().AppIniHeight(), Is.EqualTo(-0.02).Within(1e-9));
            using (var store = new RacingDeskStore(_rig.Store)) Assert.That(store.CarViewKeepOf(Car).Intent, Is.Null);
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
        public void AFileIsPutBack_FromABackup_OnlyAsAFileOfItsKind()
        {
            var files = _rig.Files();
            byte[] cam = File.ReadAllBytes(_rig.CamPath(Car));
            files.Apply(new ViewChange { CarPath = Car, CockpitZ = 0.03 });
            string rel = ViewFiles.DefaultCamFile(Car);
            Assert.That(files.Restore(rel, files.Original(rel)).Ok, Is.True);
            Assert.That(File.ReadAllBytes(_rig.CamPath(Car)), Is.EqualTo(cam));
            string junk = Path.Combine(_rig.Dir, "junk.cam");
            File.WriteAllBytes(junk, new byte[] { 1, 2, 3 });
            Assert.That(files.Restore(rel, junk).Why, Does.Contain("not a camera file"));
            Assert.That(files.Restore(@"..\outside.ini", files.Original("app.ini") ?? junk).Why, Does.Contain("not a file of iRacing's view"));
        }
    }

    /// <summary>Schema v9: six tables added, and nothing else of the store changed.</summary>
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
        public void AStoreFromV8_GainsTheSixTables_AndKeepsWhatItHad()
        {
            _rig.StoreWithCars(("porsche963gtp", "Porsche 963 GTP", -0.02, true, 0.0, "Default", RestoreRig.DefaultId, 70.0, "rule"));
            // Back to v8, as an earlier build left it.
            using (var db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = _rig.Store, Pooling = false }.ToString()))
            {
                db.Open();
                // A store made fresh says its version once; an earlier build's says 8.
                RestoreRig.Run(db, "DROP TABLE car_view_keep; DROP TABLE view_baseline; DROP TABLE car_smartcontrol; DROP TABLE smartcontrol_switch; DROP TABLE restore_events; DROP TABLE restore_checks; UPDATE schema_version SET version = 8 WHERE version = 9;");
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
            Assert.That(Tables(_rig.Store), Is.SupersetOf(new[] { "car_view_keep", "view_baseline", "car_smartcontrol", "smartcontrol_switch", "restore_events", "restore_checks", "car_views", "car_pedals" }));
        }

        [Test]
        public void TheRowsGoInAndComeBack()
        {
            using var store = new RacingDeskStore(_rig.Store);
            var at = new DateTime(2026, 10, 2, 20, 0, 0, DateTimeKind.Utc);
            Assert.That(store.SaveCarSmartControl(new CarSmartControl { CarPath = "porsche963gtp", ProfileId = "ab", ProfileName = "Porsche 963 GTP", BaseName = "Default", MadeAtUtc = at, WrittenSha = "S", WrittenKg = 70, WrittenAtUtc = at }), Is.True);
            Assert.That(store.SaveSmartControlSwitch(new SmartControlSwitch { ProfileId = "cd", ProfileName = "Racing Desk", Key = "F24", BindingId = 12, LinkId = 12, PresetId = 1, MadeAtUtc = at }), Is.True);
            Assert.That(store.RacingDeskProfileIds(), Is.EquivalentTo(new[] { "ab", "cd" }));
            Assert.That(store.CarSmartControlOf("PORSCHE963GTP").WrittenKg, Is.EqualTo(70), "a car's folder without regard to case, as the list has it");

            long first = store.AddRestoreEvent(new RestoreEvent { CarPath = "porsche963gtp", What = "brakes", State = "trial", Text = "one", Hud = true, AtUtc = at });
            long second = store.AddRestoreEvent(new RestoreEvent { What = "height", State = "trial", Text = "two", AtUtc = at });
            Assert.That(store.RestoreEvents().Select(e => (e.Text, e.Hud)), Is.EqualTo(new[] { ("one", true), ("two", false) }));
            Assert.That(store.RestoreEvents(first).Single().Id, Is.EqualTo(second));

            Assert.That(store.NoteCheckRan("A2", true, "made", at), Is.True);
            Assert.That(store.MarkCheck("A2", "passed", at), Is.True);
            Assert.That(store.MarkCheck("A2", "sure", at), Is.False);
            var check = store.RestoreChecks().Single();
            Assert.That((check.Step, check.RanOk, check.RanResult, check.Mark), Is.EqualTo(("A2", (bool?)true, "made", "passed")));
            store.NoteCheckRan("A2", false, "again", at);
            Assert.That(store.RestoreChecks().Single().Mark, Is.EqualTo("passed"), "running a step again leaves his mark");

            Assert.That(store.SaveViewBaseline(new ViewBaseline { StartHeight = -0.02, DecidedAtUtc = at, DecidedBy = "Kevin", IniOriginal = -0.035 }), Is.True);
            store.SaveViewBaseline(new ViewBaseline { StartHeight = -0.02, DecidedAtUtc = at, IniOriginal = -0.01 });
            Assert.That(store.ViewBaselineRow().IniOriginal, Is.EqualTo(-0.035), "what app.ini held before Racing Desk first wrote it is kept, not replaced");
        }

        [Test]
        public void OldLinesGo_AsNewOnesCome()
        {
            using var store = new RacingDeskStore(_rig.Store);
            for (int i = 0; i < RacingDeskStore.RestoreEventsKept + 20; i++) store.AddRestoreEvent(new RestoreEvent { What = "x", State = "trial", Text = "line " + i });
            Assert.That(store.Scalar<long>("SELECT COUNT(*) FROM restore_events"), Is.EqualTo(RacingDeskStore.RestoreEventsKept));
            Assert.That(store.RestoreEvents(0, 1).Single().Text, Is.EqualTo("line " + (RacingDeskStore.RestoreEventsKept + 19)));
        }
    }
}
