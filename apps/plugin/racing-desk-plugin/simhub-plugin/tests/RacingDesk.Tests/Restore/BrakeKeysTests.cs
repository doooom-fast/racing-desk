using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using Microsoft.Data.Sqlite;
using NUnit.Framework;
using RacingDesk.Data.Pedals;
using RacingDesk.Data.Restore;

namespace RacingDesk.Tests.Restore
{
    /// <summary>
    /// His brake-force keys moved from F1–F4 to Right Ctrl + F1–F4 (his decision of 2026-10-09), on a made-up database shaped as
    /// SmartControl Live keeps his (<see cref="RestoreRig.SmartControlAsHisIs"/>), in a folder of the test's own: only those four
    /// rows' first key, with the editor closed, a copy first, read back, once, and undone exactly.
    /// </summary>
    [TestFixture]
    public class BrakeKeysTests
    {
        private RestoreRig _rig;
        private RestoreContext _ctx;
        private DateTime _clock;
        private string _before;

        private static readonly long[] Moved = { 6, 7, 8, 12 };

        [SetUp]
        public void SetUp()
        {
            _rig = new RestoreRig();
            _rig.SmartControlAsHisIs();
            _clock = new DateTime(2026, 10, 9, 10, 0, 0, DateTimeKind.Utc);
            _ctx = _rig.Context();
            _ctx.Now = () => _clock;
            _rig.Probe.Live = true;
            _rig.Probe.LiveStarted = _clock.AddHours(-1);       // since Windows started: before anything Racing Desk writes
            _rig.Probe.Editor = false;
            _before = _rig.SmartControlRows();
        }

        [TearDown] public void TearDown() => _rig.Dispose();

        private string RecordFile => Path.Combine(_rig.Dir, "brake-keys.json");
        private BrakeKeyMove Keys() => new BrakeKeyMove(_ctx, RecordFile);

        private Dictionary<long, string> FirstKeys() => SmartControl.Read(_rig.SmartControlDb).Keys.ToDictionary(k => k.BindingId, k => k.FirstKey);

        private string SmartControlBackups => Path.Combine(_rig.Backups, "smartcontrol");

        /// <summary>The database as it was, with these rows' first key as given: what a write of only those should leave.</summary>
        private string BeforeWith(string first, params long[] ids)
        {
            var lines = _before.Split('\n').ToList();
            int table = lines.IndexOf("[keyboard_binding]");
            for (int i = table + 1; i < lines.Count && !lines[i].StartsWith("[", StringComparison.Ordinal); i++)
            {
                var cells = lines[i].Split('|');
                if (cells.Length > 3 && ids.Contains(long.Parse(cells[0]))) { cells[3] = first; lines[i] = string.Join("|", cells); }
            }
            return string.Join("\n", lines);
        }

        // ------------------------------------------------------------------ the move

        [Test]
        public void TheMove_SetsTheFirstKeyOfHisF1ToF4_ToLivesRightCtrl_AndNothingElse()
        {
            var r = Keys().Move(asked: false);
            Assert.That(r.Ok, Is.True, r.Text);
            var first = FirstKeys();
            Assert.That(Moved.Select(id => first[id]), Is.All.EqualTo("RCONTROL"), "Live's own name for Right Ctrl");
            Assert.That((first[9], first[10], first[13]), Is.EqualTo(("ZOOM", "ZOOM", "F24")), "Up, Down and Racing Desk's F24 are as they were");
            Assert.That(_rig.SmartControlRows(), Is.EqualTo(BeforeWith("RCONTROL", Moved)),
                "every other column of every row of the five tables is as it was: profiles, presets, links, the version");

            var record = Keys().Record();
            Assert.That((record.Done, record.State), Is.EqualTo((true, BrakeKeysRecord.Moved)));
            Assert.That(record.Rows.Select(x => (x.BindingId, x.ActionValue, x.SecondKey, x.Before, x.After)), Is.EquivalentTo(new[]
            {
                (6L, "50", "F2", "ZOOM", "RCONTROL"), (7L, "30", "F1", "ZOOM", "RCONTROL"), (8L, "80", "F3", "ZOOM", "RCONTROL"), (12L, "100", "F4", "ZOOM", "RCONTROL"),
            }), "what each row held is kept, for undo");
            Assert.That(record.WrittenAtUtc, Is.EqualTo(_clock));
        }

        [Test]
        public void NothingIsWritten_WhileTheEditorRuns_AndTheMoveIsMadeOnceItHasClosed()
        {
            _rig.Probe.Editor = true;
            var keys = Keys();
            Assert.That(keys.Move(asked: false).Refused, Is.True);
            Assert.That(keys.WaitingForEditor, Is.EqualTo("Waiting for the SmartControl editor to close, to move the brake-force keys to Right Ctrl + F1–F4."));
            Assert.That(keys.Move(asked: true).Why, Is.EqualTo("SmartControl was left as it is: close the SmartControl editor, then press it again"));
            Assert.That(_rig.SmartControlRows(), Is.EqualTo(_before));
            Assert.That(Directory.Exists(_rig.Backups), Is.False, "not even a copy is taken");
            Assert.That(keys.Record().Done, Is.False, "still to be made");
            Assert.That(keys.Status().Said, Is.EqualTo(keys.WaitingForEditor));

            _rig.Probe.Editor = false;
            Assert.That(keys.Move(asked: false).Ok, Is.True);
            Assert.That(keys.WaitingForEditor, Is.Null);
            Assert.That(Moved.Select(id => FirstKeys()[id]), Is.All.EqualTo("RCONTROL"));
        }

        [Test]
        public void ACopyIsTakenFirst_AndWithoutOneNothingIsWritten()
        {
            string atCopy = null;
            _ctx.BackUpSmartControl = why => "the disk is full";
            var keys = Keys();
            Assert.That(keys.Move(asked: true).Why, Does.Contain("couldn't be copied first, so nothing was written (the disk is full)"));
            Assert.That(_rig.SmartControlRows(), Is.EqualTo(_before));
            Assert.That(keys.Record().Done, Is.False, "tried again at the next start");

            // The real copy, and what the database held at the moment it was taken.
            _ctx.BackUpSmartControl = why =>
            {
                atCopy = _rig.SmartControlRows();
                var plain = _rig.Context();         // the same folders, with no stand-in: SQLite's backup, checked
                plain.Now = _ctx.Now;
                return plain.BackUpBeforeWrite(why);
            };
            Assert.That(keys.Move(asked: false).Ok, Is.True);
            Assert.That(atCopy, Is.EqualTo(_before), "the copy was taken before anything was written");
            var copies = Directory.GetFiles(SmartControlBackups, "before-write-*-brakekeys.db");
            Assert.That(copies, Has.Length.EqualTo(1), "a timestamped copy named for the step, among the last ten kept");
            Assert.That(_rig.SmartControlRows(copies[0]), Is.EqualTo(_before), "and it holds the database as it was, his F1–F4 on ZOOM");
            Assert.That(_rig.SmartControlRows(Path.Combine(SmartControlBackups, "before-racing-desk.db")), Is.EqualTo(_before), "the first copy ever is kept for good");
        }

        [Test]
        public void TheWriteIsReadBack_AndARowNotAsItWasReadIsNotWritten_NorAreTheOthers()
        {
            var writer = new SmartControlWriter(_rig.SmartControlDb);
            BrakeKeyChange Change(long id, string value, string second) => new BrakeKeyChange { BindingId = id, ActionValue = value, SecondKey = second, From = "ZOOM", To = "RCONTROL" };
            var changes = new List<BrakeKeyChange> { Change(7, "30", "F1"), Change(6, "50", "F2"), Change(8, "80", "F3"), Change(12, "90", "F4") };
            var refused = writer.SetBrakeKeysFirstKey(changes, 1, "Default");
            Assert.That(refused.Ok, Is.False);
            Assert.That(refused.Why, Is.EqualTo("the key in row 12 is not as Racing Desk read it; it is left as it is"), "F4 sets 100, not 90");
            Assert.That(_rig.SmartControlRows(), Is.EqualTo(_before), "every row or none: the three before it were rolled back");

            changes[3] = Change(12, "100", "F4");
            var written = writer.SetBrakeKeysFirstKey(changes, 1, "Default");
            Assert.That(written.Ok, Is.True, written.Why);
            Assert.That(_rig.SmartControlRows(), Is.EqualTo(BeforeWith("RCONTROL", Moved)));

            // The orchestrator's own read-back sees every key and profile: a row that is not what was written is said.
            var before = SmartControl.Read(_rig.SmartControlDb);
            _rig.SetFirstKey(9, "LCONTROL");
            var rows = new[] { new BrakeKeyRow { BindingId = 7, ActionValue = "30", SecondKey = "F1", Before = "RCONTROL", After = "RCONTROL" } };
            Assert.That(BrakeKeyMove.ReadBack(before, SmartControl.Read(_rig.SmartControlDb), rows, toAfter: true), Is.EqualTo("the keys did not read back as written"));
            _rig.SetFirstKey(9, "ZOOM");
            Assert.That(BrakeKeyMove.ReadBack(before, SmartControl.Read(_rig.SmartControlDb), rows, toAfter: true), Is.Null);
        }

        [Test]
        public void AChordThatIsTakenAlready_LeavesTheKeysOnF1ToF4_AndSaysWhy()
        {
            using (var db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = _rig.SmartControlDb, Pooling = false }.ToString()))
            {
                db.Open();
                RestoreRig.Run(db, "INSERT INTO keyboard_binding (id, action_type, action_value, first_key, second_key) VALUES (20, 1, 'x', 'RCONTROL', 'F3');" +
                                   "INSERT INTO profile_smartcontrol_live_keyboard_binding (fk_profile_smartcontrol_live_id, fk_keyboard_binding_id) VALUES (1, 20)");
            }
            string before = _rig.SmartControlRows();
            var keys = Keys();
            var r = keys.Move(asked: false);
            Assert.That(r.Ok, Is.False);
            Assert.That(_rig.SmartControlRows(), Is.EqualTo(before));
            var record = keys.Record();
            Assert.That((record.Done, record.State, record.Rows.Count), Is.EqualTo((true, (string)null, 0)), "not tried again by itself");
            Assert.That(record.Note, Is.EqualTo("The brake-force keys were left on F1–F4: Right Ctrl + F3 is bound already in SmartControl Live's Default preset."));
            Assert.That(keys.Status().Said, Is.EqualTo(record.Note));
            Assert.That(keys.Status().Move, Is.True, "he can ask again once he has freed it");
        }

        [Test]
        public void HisOtherKeys_ProfilesAndPresets_AreRefused_WhateverIsAsked()
        {
            var writer = new SmartControlWriter(_rig.SmartControlDb);
            var asks = new[]
            {
                new BrakeKeyChange { BindingId = 9, ActionType = 9, ActionValue = "5", SecondKey = "UP", From = "ZOOM", To = "RCONTROL" },           // Up: +5
                new BrakeKeyChange { BindingId = 10, ActionType = 10, ActionValue = "5", SecondKey = "DOWN", From = "ZOOM", To = "RCONTROL" },       // Down: −5
                new BrakeKeyChange { BindingId = 13, ActionType = 1, ActionValue = RestoreRig.SwitchId, SecondKey = "", From = "F24", To = "RCONTROL" }, // F24
                new BrakeKeyChange { BindingId = 7, ActionValue = "30", SecondKey = "F1", From = "ZOOM", To = "LCONTROL" },                         // another chord
                new BrakeKeyChange { BindingId = 7, ActionValue = "30", SecondKey = "ZOOM", From = "ZOOM", To = "RCONTROL" },
                new BrakeKeyChange { BindingId = 99, ActionValue = "30", SecondKey = "F1", From = "ZOOM", To = "RCONTROL" },                        // no such row
            };
            foreach (var ask in asks)
                Assert.That(writer.SetBrakeKeysFirstKey(new[] { ask }, 1, "Default").Ok, Is.False, $"row {ask.BindingId} {ask.From} → {ask.To}");
            Assert.That(writer.SetBrakeKeysFirstKey(new[] { new BrakeKeyChange { BindingId = 7, ActionValue = "30", SecondKey = "F1", From = "ZOOM", To = "RCONTROL" } }, 0, "(empty)").Why,
                Does.Contain("not in Live's (empty) preset alone"), "a row of another preset");
            Assert.That(writer.SetBrakeKeysFirstKey(new[] { new BrakeKeyChange { BindingId = 7, ActionValue = "30", SecondKey = "F1", From = "ZOOM", To = "RCONTROL" } }, 1, "Rain").Why,
                Does.Contain("not \"Rain\""));
            Assert.That(_rig.SmartControlRows(), Is.EqualTo(_before));

            // The move itself: Up, Down, F24 and Live's preset shortcut stay, and the profiles are byte for byte as they were.
            Keys().Move(asked: false);
            var read = SmartControl.Read(_rig.SmartControlDb);
            Assert.That(read.Keys.Where(k => !Moved.Contains(k.BindingId)).Select(k => (k.BindingId, k.FirstKey, k.SecondKey, k.ActionValue)),
                Is.EqualTo(new[] { (9L, "ZOOM", "UP", "5"), (10L, "ZOOM", "DOWN", "5"), (13L, "F24", "", RestoreRig.SwitchId) }));
            Assert.That(_rig.SmartControlRows(), Is.EqualTo(BeforeWith("RCONTROL", Moved)));
        }

        // ------------------------------------------------------------------ undo

        [Test]
        public void Undo_PutsBackExactlyWhatWasThere()
        {
            var keys = Keys();
            Assert.That(keys.Move(asked: false).Ok, Is.True);
            _clock = _clock.AddMinutes(5);
            var undone = keys.Undo();
            Assert.That(undone.Ok, Is.True, undone.Text);
            Assert.That(undone.Did, Is.EqualTo(new[] { "the brake-force keys are on F1–F4 again, as before Racing Desk moved them" }));
            Assert.That(_rig.SmartControlRows(), Is.EqualTo(_before), "every row of the five tables as it was, to the byte");
            Assert.That(new SmartControlWriter(_rig.SmartControlDb).Check(Path.Combine(SmartControlBackups, "before-racing-desk.db")), Is.Null,
                "the database holds what the copy taken before Racing Desk's first write holds");
            Assert.That(Directory.GetFiles(SmartControlBackups, "before-write-*-brakekeysundo.db"), Has.Length.EqualTo(1), "a copy first, again");
            var record = keys.Record();
            Assert.That((record.State, record.Done, record.WrittenAtUtc), Is.EqualTo((BrakeKeysRecord.Undone, true, (DateTime?)_clock)));
            Assert.That(keys.Undo().Refused, Is.True, "once");
        }

        [Test]
        public void Undo_LeavesARowHeChangedSince_AndPutsBackTheOthers()
        {
            var keys = Keys();
            keys.Move(asked: false);
            _rig.SetFirstKey(7, "LCONTROL");        // he moved F1 to Left Ctrl in Live since
            var undone = keys.Undo();
            Assert.That(undone.Ok, Is.True, undone.Text);
            Assert.That(undone.Saw, Has.Some.EqualTo("The key for 30 kg (F1) was changed in SmartControl Live since, so it was left as you set it"));
            var first = FirstKeys();
            Assert.That((first[6], first[7], first[8], first[12]), Is.EqualTo(("ZOOM", "LCONTROL", "ZOOM", "ZOOM")));
        }

        [Test]
        public void Undo_WaitsForTheEditor_AndIsNotQueued()
        {
            var keys = Keys();
            keys.Move(asked: false);
            string moved = _rig.SmartControlRows();
            _rig.Probe.Editor = true;
            var r = keys.Undo();
            Assert.That((r.Refused, r.Why), Is.EqualTo((true, "SmartControl was left as it is: close the SmartControl editor, then press Undo again")));
            Assert.That(_rig.SmartControlRows(), Is.EqualTo(moved));
        }

        // ------------------------------------------------------------------ once

        [Test]
        public void TheMoveIsMadeOnce_ByItself()
        {
            var keys = Keys();
            Assert.That(keys.Move(asked: false).Ok, Is.True);
            // He puts F1 back on its own in Live: Racing Desk does not move it again, at this start or any later one.
            _rig.SetFirstKey(7, "ZOOM");
            string his = _rig.SmartControlRows();
            Assert.That(Keys().Move(asked: false), Is.Null);
            Assert.That(_rig.SmartControlRows(), Is.EqualTo(his));

            // After an undo neither.
            Assert.That(Keys().Undo().Ok, Is.True);
            string undone = _rig.SmartControlRows();
            Assert.That(Keys().Move(asked: false), Is.Null);
            Assert.That(_rig.SmartControlRows(), Is.EqualTo(undone));

            // On his word, from the desk, it is made again.
            Assert.That(Keys().Status().Move, Is.True);
            Assert.That(Keys().Move(asked: true).Ok, Is.True);
            Assert.That(Moved.Select(id => FirstKeys()[id]), Is.All.EqualTo("RCONTROL"));
        }

        [Test]
        public void KeysPutBackOnF1ToF4SinceTheMove_AreSaid_AndAreMovedAgainOnlyOnHisWord()
        {
            var keys = Keys();
            keys.Move(asked: false);
            foreach (long id in Moved) _rig.SetFirstKey(id, "ZOOM");      // set back in SmartControl, by him or by Live
            var s = keys.Status();
            Assert.That((s.State, s.Undo, s.Move), Is.EqualTo(("changed", false, true)));
            Assert.That(s.Said, Is.EqualTo("The brake-force keys were changed in SmartControl since Racing Desk moved them."));
            Assert.That(keys.Move(asked: false), Is.Null, "not by itself");
            Assert.That(_rig.SmartControlRows(), Is.EqualTo(_before));
            Assert.That(keys.Move(asked: true).Ok, Is.True);
            Assert.That(Moved.Select(id => FirstKeys()[id]), Is.All.EqualTo("RCONTROL"));
        }

        [Test]
        public void KeysOnRightCtrlAlready_AreLeft_AndTheMoveIsDone()
        {
            foreach (long id in Moved) _rig.SetFirstKey(id, "RCONTROL");
            string before = _rig.SmartControlRows();
            var keys = Keys();
            var r = keys.Move(asked: false);
            Assert.That(r.Ok, Is.True);
            Assert.That(r.Saw, Is.EqualTo(new[] { "The brake-force keys are on Right Ctrl already, so nothing was moved" }));
            Assert.That(_rig.SmartControlRows(), Is.EqualTo(before));
            Assert.That(Directory.Exists(_rig.Backups), Is.False, "nothing to write, nothing copied");
            var record = keys.Record();
            Assert.That((record.Done, record.State, record.Note), Is.EqualTo((true, (string)null, (string)null)));
            Assert.That(keys.Status().Undo, Is.False, "Racing Desk changed nothing, so there is nothing to undo");
        }

        [Test]
        public void AWriteThatAStopCutShort_IsSettledFromTheDatabase()
        {
            // The record was kept as "moving", and the host stopped before the database was written.
            var keys = Keys();
            new BrakeKeysRecord
            {
                State = BrakeKeysRecord.Moving,
                Rows = Moved.Select(id => new BrakeKeyRow { BindingId = id, ActionValue = "x", SecondKey = "F1", Before = "ZOOM", After = "RCONTROL" }).ToList(),
            }.Save(RecordFile);
            Assert.That(keys.Move(asked: false).Ok, Is.True, "not moved yet: made now");
            Assert.That(keys.Record().State, Is.EqualTo(BrakeKeysRecord.Moved));

            // Moving again, and the database was written before the stop: it is moved.
            var record = keys.Record();
            record.State = BrakeKeysRecord.Moving;
            record.Done = false;
            record.Save(RecordFile);
            Assert.That(keys.Move(asked: false), Is.Null, "nothing to do: settled as moved");
            Assert.That(keys.Record().State, Is.EqualTo(BrakeKeysRecord.Moved));
            Assert.That(keys.Record().Done, Is.True);
        }

        // ------------------------------------------------------------------ Live, and what the desk says

        [Test]
        public void UntilLiveStartsAgain_TheDeskSaysToRestartIt_AndTheKeysLiveHasAreTheOldOnes()
        {
            var keys = Keys();
            keys.Move(asked: false);
            var s = keys.Status();
            Assert.That(s.Restart, Is.EqualTo("Restart SmartControl Live (or the PC) to use Right Ctrl + F1–F4 for brake force."));
            Assert.That(s.Text, Is.EqualTo("F1, F2, F3, F4 set 30, 50, 80, 100 kg; Up adds 5 kg; Down takes off 5 kg."), "what Live acts on now");
            Assert.That((s.State, s.Undo, s.Move), Is.EqualTo(("moved", true, false)));
            var live = keys.AsLiveHasThem(SmartControl.Read(_rig.SmartControlDb));
            Assert.That(live.Keys.Where(k => Moved.Contains(k.BindingId)).Select(k => k.FirstKey), Is.All.EqualTo("ZOOM"));
            Assert.That(new LiveKeyWatcher(live.Keys).Watched, Is.EqualTo(new[] { 0x26, 0x28, 0x70, 0x71, 0x72, 0x73 }), "the follower watches F1–F4 alone, as Live does");

            // Live starts again: it has Right Ctrl + F1–F4 now.
            _clock = _clock.AddMinutes(2);
            _rig.Probe.LiveStarted = _clock;
            s = keys.Status();
            Assert.That(s.Restart, Is.Null);
            Assert.That(s.Text, Is.EqualTo("Right Ctrl + F1, F2, F3, F4 set 30, 50, 80, 100 kg; Up adds 5 kg; Down takes off 5 kg."));
            live = keys.AsLiveHasThem(SmartControl.Read(_rig.SmartControlDb));
            Assert.That(new LiveKeyWatcher(live.Keys).Watched, Is.EqualTo(new[] { 0x26, 0x28, 0x70, 0x71, 0x72, 0x73, 0xA3 }));

            // Undone: Live has Right Ctrl until it starts again.
            _clock = _clock.AddMinutes(2);
            keys.Undo();
            s = keys.Status();
            Assert.That(s.Restart, Is.EqualTo("Restart SmartControl Live (or the PC) to use F1–F4 for brake force again."));
            Assert.That(s.Text, Does.StartWith("Right Ctrl + F1, F2, F3, F4 set"));
            Assert.That((s.State, s.Undo, s.Move), Is.EqualTo(("undone", false, true)));

            // Live not running: it reads what the database holds when it starts, and there is nothing to restart.
            _rig.Probe.Live = false;
            s = keys.Status();
            Assert.That(s.Restart, Is.Null);
            Assert.That(s.Text, Is.EqualTo("F1, F2, F3, F4 set 30, 50, 80, 100 kg; Up adds 5 kg; Down takes off 5 kg."));
        }

        [Test]
        public void WithLiveStartedAfterTheMove_NothingIsSaidOfARestart()
        {
            _rig.Probe.Live = false;
            var r = Keys().Move(asked: false);
            Assert.That(r.Saw, Is.Empty, "Live was not running: it has the keys from its start");
            _rig.Probe.Live = true;
            _rig.Probe.LiveStarted = _clock.AddSeconds(30);
            Assert.That(Keys().Status().Restart, Is.Null);
        }

        // ------------------------------------------------------------------ in the host's director

        [Test]
        public void AtTheHostsStart_TheKeysMove_AndWithTheEditorOpen_WhenItCloses_Once()
        {
            // The brakes part is off here: its own setup is LiveBrakesTests'.
            new RestoreSwitches { Brakes = false, Height = false }.Save(Path.Combine(_rig.Dir, "restore.json"));
            _rig.Probe.Editor = true;
            var d = new RestoreDirector(_ctx, Path.Combine(_rig.Dir, "restore.json")) { EditorLookEvery = TimeSpan.FromMilliseconds(40) };
            d.HostStarted();
            Assert.That(d.Settled().Wait(TimeSpan.FromSeconds(30)), Is.True);
            Assert.That(_rig.SmartControlRows(), Is.EqualTo(_before), "nothing while the editor is open");
            Assert.That(d.KeysStatus().Said, Is.EqualTo("Waiting for the SmartControl editor to close, to move the brake-force keys to Right Ctrl + F1–F4."));
            Assert.That(File.Exists(RecordFile), Is.False);

            _rig.Probe.Editor = false;
            var until = DateTime.UtcNow.AddSeconds(10);
            while (DateTime.UtcNow < until && !Keys().Record().Done) Thread.Sleep(20);
            Assert.That(d.Settled().Wait(TimeSpan.FromSeconds(30)), Is.True);
            Assert.That(Keys().Record().State, Is.EqualTo(BrakeKeysRecord.Moved), "moved once the editor closed, with no start needed");
            Assert.That(Moved.Select(id => FirstKeys()[id]), Is.All.EqualTo("RCONTROL"));

            // The next start, with F1 put back on its own by hand: done is done.
            _rig.SetFirstKey(7, "ZOOM");
            string his = _rig.SmartControlRows();
            var again = new RestoreDirector(_ctx, Path.Combine(_rig.Dir, "restore.json"));
            again.HostStarted();
            Assert.That(again.Settled().Wait(TimeSpan.FromSeconds(30)), Is.True);
            Assert.That(_rig.SmartControlRows(), Is.EqualTo(his));

            // Undo from the desk, through the director's one-command-at-a-time.
            var undone = again.UndoBrakeKeys();
            Assert.That(undone.Ok, Is.True, undone.Text);
            Assert.That(undone.Saw, Has.Some.Contains("(F1) was changed in SmartControl Live since"));
            Assert.That(FirstKeys()[6], Is.EqualTo("ZOOM"));
        }
    }
}
