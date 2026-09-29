using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using Microsoft.Data.Sqlite;
using NUnit.Framework;
using RacingDesk.Data;
using RacingDesk.Data.Pedals;

namespace RacingDesk.Tests.Pedals
{
    /// <summary>
    /// The brake force per car, followed from SmartControl Live's keys: which keys are asked about, what a press
    /// is, what the force comes to, and what is kept for the car. No key is asked of Windows here.
    /// </summary>
    [TestFixture]
    public class BrakeForceTests
    {
        private const int PageUp = 0x21, PageDown = 0x22, Pause = 0x13, RightCtrl = 0xA3, Up = 0x26, Down = 0x28;
        private const string Honda = "hondacivictyper", F4 = "formulair04", Mx5 = "mx5 mx52016";

        private static readonly DateTime June = new DateTime(2026, 6, 1, 9, 0, 0, DateTimeKind.Utc);

        /// <summary>Live's keys as they are bound on the rig.</summary>
        private static List<LiveKey> RigKeys() => new List<LiveKey>
        {
            new LiveKey { Action = LiveAction.SetBrakeForce, Value = 50, FirstKey = "PRIOR", SecondKey = "" },
            new LiveKey { Action = LiveAction.SetBrakeForce, Value = 30, FirstKey = "NEXT", SecondKey = "" },
            new LiveKey { Action = LiveAction.SetBrakeForce, Value = 80, FirstKey = "PAUSE", SecondKey = "" },
            new LiveKey { Action = LiveAction.RaiseBrakeForce, Value = 5, FirstKey = "RCONTROL", SecondKey = "UP" },
            new LiveKey { Action = LiveAction.LowerBrakeForce, Value = 5, FirstKey = "RCONTROL", SecondKey = "DOWN" },
        };

        /// <summary>A keyboard: the keys that are down, and every key anyone asked about.</summary>
        private sealed class Keys
        {
            public readonly HashSet<int> Down = new HashSet<int>();
            public readonly HashSet<int> Asked = new HashSet<int>();

            public short State(int key)
            {
                Asked.Add(key);
                return Down.Contains(key) ? unchecked((short)0x8000) : (short)0;
            }
        }

        private string _dir = "";

        [SetUp]
        public void SetUp() => Directory.CreateDirectory(_dir = Path.Combine(Path.GetTempPath(), "racing-desk-brake-" + Guid.NewGuid().ToString("N")));

        [TearDown]
        public void TearDown()
        {
            SqliteConnection.ClearAllPools();
            try { Directory.Delete(_dir, true); } catch { }
        }

        // ------------------------------------------------------------------ the force

        [Test]
        public void TheForceIsKnownFromTheFirstKeyThatSetsOne()
        {
            var keys = RigKeys();
            var force = new BrakeForceTracker();

            force.Press(keys[3]);
            force.Press(keys[3]);
            Assert.That(force.ForceKg, Is.Null, "raised from a force nobody knows");
            Assert.That(force.ChangeKg, Is.EqualTo(10));

            force.Press(keys[0]);
            force.Press(keys[4]);
            Assert.That(force.ForceKg, Is.EqualTo(45), "Page Up, then Right Ctrl + Down: the Honda's");
            Assert.That(force.ChangeKg, Is.EqualTo(0));
            Assert.That(force.Presses, Is.EqualTo(4));
        }

        [Test]
        public void AForceIsNeverLessThanNoneAndAKeyThatIsNotForTheBrakeIsNotAPress()
        {
            var force = new BrakeForceTracker(knownKg: 5);
            var lower = RigKeys()[4];
            force.Press(lower);
            force.Press(lower);
            Assert.That(force.ForceKg, Is.EqualTo(0));

            force.Press(new LiveKey { Action = LiveAction.Other, Value = 3, FirstKey = "F1" });
            force.Press(null);
            Assert.That(force.Presses, Is.EqualTo(2));
        }

        // ------------------------------------------------------------------ the keys

        [Test]
        public void OnlyLivesBrakeForceKeysAreEverAskedAbout()
        {
            var board = new Keys();
            var bound = RigKeys();
            bound.Add(new LiveKey { Action = LiveAction.Other, Value = 0, FirstKey = "F5", SecondKey = "" });
            var watcher = new LiveKeyWatcher(bound, board.State);

            Assert.That(watcher.Watched, Is.EqualTo(new[] { Pause, PageUp, PageDown, Up, Down, RightCtrl }));
            for (int i = 0; i < 5; i++) watcher.Poll();
            Assert.That(board.Asked, Is.EquivalentTo(watcher.Watched), "and no other key, F5 among them");
        }

        [Test]
        public void APressIsAKeyGoingDownAndAKeyHeldIsOnePress()
        {
            var board = new Keys();
            var watcher = new LiveKeyWatcher(RigKeys(), board.State);
            Assert.That(watcher.Poll(), Is.Empty);

            board.Down.Add(PageUp);
            Assert.That(watcher.Poll().Select(k => k.Value), Is.EqualTo(new[] { 50.0 }));
            Assert.That(watcher.Poll(), Is.Empty, "still held");
            Assert.That(watcher.Poll(), Is.Empty);

            board.Down.Clear();
            Assert.That(watcher.Poll(), Is.Empty);
            board.Down.Add(PageUp);
            Assert.That(watcher.Poll().Count, Is.EqualTo(1), "pressed again");
        }

        [Test]
        public void AKeyAlreadyDownWhenWatchingBeganWasNotPressedInIt()
        {
            var board = new Keys();
            board.Down.Add(Pause);
            var watcher = new LiveKeyWatcher(RigKeys(), board.State);
            Assert.That(watcher.Poll(), Is.Empty);
            Assert.That(watcher.Poll(), Is.Empty);
        }

        [Test]
        public void APairIsItsSecondKeyPressedWhileItsFirstIsHeld()
        {
            var board = new Keys();
            var watcher = new LiveKeyWatcher(RigKeys(), board.State);
            watcher.Poll();

            board.Down.Add(Up);
            Assert.That(watcher.Poll(), Is.Empty, "Up alone is bound to nothing");
            board.Down.Clear();
            watcher.Poll();

            board.Down.Add(RightCtrl);
            Assert.That(watcher.Poll(), Is.Empty, "nor is Right Ctrl alone");
            board.Down.Add(Up);
            Assert.That(watcher.Poll().Select(k => k.Action), Is.EqualTo(new[] { LiveAction.RaiseBrakeForce }));

            // Right Ctrl kept down, Up tapped twice more, then Down once.
            for (int i = 0; i < 2; i++)
            {
                board.Down.Remove(Up);
                watcher.Poll();
                board.Down.Add(Up);
                Assert.That(watcher.Poll().Count, Is.EqualTo(1));
            }
            board.Down.Remove(Up);
            board.Down.Add(Down);
            Assert.That(watcher.Poll().Select(k => k.Action), Is.EqualTo(new[] { LiveAction.LowerBrakeForce }));
        }

        [Test]
        public void AKeyBoundAloneIsNotAlsoPressedWhenItsPairIs()
        {
            var bound = RigKeys();
            bound.Add(new LiveKey { Action = LiveAction.SetBrakeForce, Value = 60, FirstKey = "UP", SecondKey = "" });
            var board = new Keys();
            var watcher = new LiveKeyWatcher(bound, board.State);
            watcher.Poll();

            board.Down.Add(Up);
            Assert.That(watcher.Poll().Select(k => k.Value), Is.EqualTo(new[] { 60.0 }));
            board.Down.Clear();
            watcher.Poll();
            board.Down.Add(RightCtrl);
            watcher.Poll();
            board.Down.Add(Up);
            Assert.That(watcher.Poll().Select(k => k.Action), Is.EqualTo(new[] { LiveAction.RaiseBrakeForce }));
        }

        [Test]
        public void AKeyWithANameNotKnownIsLeftOutAndSaidSo()
        {
            var bound = new List<LiveKey>
            {
                new LiveKey { Action = LiveAction.SetBrakeForce, Value = 40, FirstKey = "WHEEL_BUTTON_3", SecondKey = "" },
                new LiveKey { Action = LiveAction.SetBrakeForce, Value = 50, FirstKey = "RCONTROL", SecondKey = "NOPE" },
                new LiveKey { Action = LiveAction.SetBrakeForce, Value = 60, FirstKey = "f7", SecondKey = null },
            };
            var watcher = new LiveKeyWatcher(bound, new Keys().State);
            Assert.That(watcher.NotWatched.Select(k => k.Value), Is.EqualTo(new[] { 40.0, 50.0 }));
            Assert.That(watcher.Watched, Is.EqualTo(new[] { 0x76 }));
            Assert.That(new LiveKeyWatcher(null, new Keys().State).Watched, Is.Empty);
        }

        [TestCase("PRIOR", 0x21)]
        [TestCase("next", 0x22)]
        [TestCase(" PAUSE ", 0x13)]
        [TestCase("RCONTROL", 0xA3)]
        [TestCase("VK_UP", 0x26)]
        [TestCase("A", 0x41)]
        [TestCase("7", 0x37)]
        [TestCase("F1", 0x70)]
        [TestCase("F24", 0x87)]
        [TestCase("NUMPAD5", 0x65)]
        public void AKeyIsKnownByWindowsNameForIt(string name, int key) =>
            Assert.That(LiveKeyWatcher.VirtualKey(name), Is.EqualTo(key));

        [TestCase("")]
        [TestCase(null)]
        [TestCase("F25")]
        [TestCase("F0")]
        [TestCase("PAGEUP")]
        [TestCase("é")]
        public void AndNotByAnyOther(string name) =>
            Assert.That(LiveKeyWatcher.VirtualKey(name), Is.Null);

        // ------------------------------------------------------------------ a run in a car

        private sealed class Run
        {
            public readonly Keys Board = new Keys();
            public readonly List<PedalsSeen> Saved = new List<PedalsSeen>();
            public readonly List<string> Log = new List<string>();
            public int Reads;
            public SmartControlSnapshot Snapshot = new SmartControlSnapshot();
            public readonly CarPedalsRecorder Recorder;

            public Run(IReadOnlyList<LiveKey> keys)
            {
                Snapshot = Made(keys);
                Recorder = new CarPedalsRecorder(() => { Reads++; return Snapshot; }, Board.State, Saved.Add, Log.Add);
            }

            public void Tap(string car, params int[] keys)
            {
                foreach (int k in keys) Board.Down.Add(k);
                Recorder.See(car, false, false, 0);
                Board.Down.Clear();
                Recorder.See(car, false, false, 0);
            }
        }

        // The snapshot's setters are internal to the data assembly, so one is made the way the app makes one: read.
        private static SmartControlSnapshot Made(IReadOnlyList<LiveKey> keys)
        {
            string dir = Path.Combine(Path.GetTempPath(), "racing-desk-brake-keys-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(dir);
            try
            {
                string path = SmartControlTests.Database(Path.Combine(dir, "Heusinkveld.db"), db =>
                {
                    SmartControlTests.AddProfile(db, "d1", "Default", Encoding.UTF8.GetBytes(SmartControlTests.ProfileXml(80)));
                    SmartControlTests.AddProfile(db, "l2", "LightBrake", Encoding.UTF8.GetBytes(SmartControlTests.ProfileXml(45)));
                    foreach (var k in keys)
                        SmartControlTests.AddKey(db, k.Action == LiveAction.SetBrakeForce ? 8 : k.Action == LiveAction.RaiseBrakeForce ? 9 : k.Action == LiveAction.LowerBrakeForce ? 10 : 1,
                            k.Value.ToString(System.Globalization.CultureInfo.InvariantCulture), k.FirstKey, k.SecondKey ?? "");
                });
                return SmartControl.Read(path);
            }
            finally
            {
                SqliteConnection.ClearAllPools();
                try { Directory.Delete(dir, true); } catch { }
            }
        }

        [Test]
        public void ARunLeavesTheForceItEndedOnWhenTheSimGoes()
        {
            var run = new Run(RigKeys());
            run.Recorder.See(Honda, false, false, 0);
            run.Tap(Honda, PageUp);
            run.Tap(Honda, RightCtrl, Down);
            Assert.That(run.Saved, Is.Empty, "nothing is kept while the car is being driven");

            run.Recorder.SimGone();

            Assert.That(run.Saved.Count, Is.EqualTo(1));
            Assert.That((run.Saved[0].CarPath, run.Saved[0].ForceKg, run.Saved[0].Presses), Is.EqualTo((Honda, (double?)45, 2)));
            Assert.That(run.Log.Count(l => l.Contains("brake force")), Is.EqualTo(2));
            Assert.That(run.Log[0], Is.EqualTo("pedals: PRIOR (set 50 kg) — brake force 50 kg"));
            Assert.That(run.Reads, Is.EqualTo(1), "SmartControl is read once a car, not once a frame");

            run.Recorder.SimGone();
            Assert.That(run.Saved.Count, Is.EqualTo(1), "and the sim going twice is going once");
            Assert.That(run.Recorder.Watched, Is.Empty, "the keys are let go with the sim");
        }

        [Test]
        public void NoKeyIsAskedAboutUntilThereIsACarAndNoneAfterTheSimHasGone()
        {
            var run = new Run(RigKeys());
            run.Recorder.See(null, false, false, 0);
            run.Recorder.See("  ", false, false, 0);
            Assert.That(run.Board.Asked, Is.Empty);

            run.Recorder.See(Honda, false, false, 0);
            Assert.That(run.Board.Asked, Is.Not.Empty);

            run.Recorder.SimGone();
            run.Board.Asked.Clear();
            run.Recorder.SimGone();
            Assert.That(run.Board.Asked, Is.Empty);
        }

        [Test]
        public void TheForceGoesWithThePedalsFromCarToCarButIsKeptOnlyForTheCarItWasSetIn()
        {
            var run = new Run(RigKeys());
            run.Recorder.See(Honda, false, false, 0);
            run.Tap(Honda, Pause);

            run.Recorder.See(Mx5, false, false, 0);
            Assert.That(run.Saved.Select(s => (s.CarPath, s.ForceKg, s.Presses)), Is.EqualTo(new[] { (Honda, (double?)80, 1) }));

            run.Tap(Mx5, RightCtrl, Up);
            run.Recorder.SimGone();
            Assert.That((run.Saved[1].CarPath, run.Saved[1].ForceKg, run.Saved[1].Presses), Is.EqualTo((Mx5, (double?)85, 1)),
                "raised from the 80 the pedals were left at");

            // The next run of the sim starts from nothing known: the pedals may have been set outside it.
            run.Recorder.See(F4, false, false, 0);
            run.Tap(F4, RightCtrl, Up);
            run.Recorder.SimGone();
            Assert.That((run.Saved[2].ForceKg, run.Saved[2].ChangeKg), Is.EqualTo(((double?)null, 5.0)));
        }

        [Test]
        public void WhetherACarHasAbsIsReadOffTheRun()
        {
            var run = new Run(RigKeys());

            run.Recorder.See(Honda, absSetting: true, absWorking: false, lapsCompleted: 0);
            run.Recorder.SimGone();
            Assert.That(run.Saved.Last().HasAbs, Is.True, "it publishes an ABS setting");

            run.Recorder.See("toyotagr86", false, false, 4);
            run.Recorder.See("toyotagr86", false, true, 4);
            run.Recorder.See("toyotagr86", false, false, 5);
            run.Recorder.SimGone();
            Assert.That(run.Saved.Last().HasAbs, Is.True, "no setting, but the ABS worked");

            run.Recorder.See(Mx5, false, false, 10);
            run.Recorder.See(Mx5, false, false, 12);
            run.Recorder.SimGone();
            Assert.That(run.Saved.Last().HasAbs, Is.Null, "two laps are too few to say it has none");

            run.Recorder.See(Mx5, false, false, 10);
            run.Recorder.See(Mx5, false, false, 13);
            run.Recorder.SimGone();
            Assert.That(run.Saved.Last().HasAbs, Is.False);
        }

        [Test]
        public void WithoutSmartControlTheCarIsStillFollowedAndNoKeyIsAsked()
        {
            var board = new Keys();
            var saved = new List<PedalsSeen>();
            var log = new List<string>();
            var none = new CarPedalsRecorder(() => null, board.State, saved.Add, log.Add);
            none.See(Honda, true, false, 0);
            none.SimGone();
            Assert.That(board.Asked, Is.Empty);
            Assert.That((saved[0].HasAbs, saved[0].Presses, saved[0].ForceKg), Is.EqualTo(((bool?)true, 0, (double?)null)));
            Assert.That(log, Has.Some.Contains("SmartControl is not on this machine"));

            var broken = new CarPedalsRecorder(() => throw new InvalidOperationException("locked"), board.State, saved.Add, log.Add);
            broken.See(Honda, true, false, 0);
            broken.SimGone();
            Assert.That(saved.Count, Is.EqualTo(2));
            Assert.That(log, Has.Some.Contains("could not be read — locked"));
        }

        // ------------------------------------------------------------------ what is kept

        private RacingDeskStore Store()
        {
            var store = new RacingDeskStore(Path.Combine(_dir, "racing-desk.db"));
            Save(store, Honda, "Honda Civic Type R TCR", "SportsCar", 1);
            Save(store, Honda, "Honda Civic Type R TCR", "Road", 2);
            Save(store, F4, "FIA F4", "Road", 3);
            Save(store, F4, "FIA F4", "Formula", 4);
            Save(store, Mx5, "Mazda MX-5 Cup", "SportsCar", 5);
            return store;
        }

        private static void Save(RacingDeskStore store, string car, string name, string category, int day)
        {
            var s = new SessionRecord
            {
                Source = "live", SessionNum = 0, SubsessionId = 70000000 + day, StartedAtUtc = June.AddDays(day), SessionType = "Race",
                CarPath = car, CarScreenName = name, Category = category,
            };
            s.Cars.Add(new CarRecord { CarPath = car, Name = name });
            store.SaveSession(s);
        }

        private static PedalsSeen Seen(string car, bool? abs, double? force = null, int presses = 0, double change = 0) =>
            new PedalsSeen { CarPath = car, HasAbs = abs, ForceKg = force, Presses = presses, ChangeKg = change, SeenAtUtc = June };

        [Test]
        public void ACarIsGivenAProfileOfItsOwnByTheDriversRule()
        {
            Assert.That(CarPedalsKeeper.BaseFor(hasAbs: true, formula: false), Is.EqualTo("LightBrake"));
            Assert.That(CarPedalsKeeper.BaseFor(hasAbs: true, formula: true), Is.EqualTo("Default"));
            Assert.That(CarPedalsKeeper.BaseFor(hasAbs: false, formula: false), Is.EqualTo("Default"));
            Assert.That(CarPedalsKeeper.BaseFor(hasAbs: false, formula: true), Is.EqualTo("Default"));

            using var store = Store();
            var smartControl = Made(RigKeys());

            string honda = CarPedalsKeeper.Keep(store, smartControl, Seen(Honda, true, 45, 2));
            string f4 = CarPedalsKeeper.Keep(store, smartControl, Seen(F4, true));
            string mx5 = CarPedalsKeeper.Keep(store, smartControl, Seen(Mx5, false));

            Assert.That(honda, Is.EqualTo("pedals: hondacivictyper — its own profile, from LightBrake (ABS); brake force 45 kg"));
            Assert.That(f4, Is.EqualTo("pedals: formulair04 — its own profile, from Default (a formula car)"));
            Assert.That(mx5, Is.EqualTo("pedals: mx5 mx52016 — its own profile, from Default (no ABS)"));

            var kept = store.CarPedalsOf(Honda);
            Assert.That((kept.ProfileName, kept.ProfileId, kept.BrakeForceKg), Is.EqualTo(("LightBrake", "l2", (double?)45)));
            Assert.That(kept.Profile, Is.EqualTo(smartControl.Profiles.Single(p => p.Name == "LightBrake").Data), "byte for byte");
            Assert.That(store.CarPedalsOf(F4).BrakeForceKg, Is.Null, "no key was pressed in it: the profile's own force stands");
        }

        [Test]
        public void ACarThatHasAProfileKeepsItAndTakesTheNewForce()
        {
            using var store = Store();
            var smartControl = Made(RigKeys());
            store.BindCarPedals(new CarPedals { CarPath = Honda, ProfileId = "d1", ProfileName = "Default", Profile = new byte[] { 1 }, BoundAtUtc = June });

            Assert.That(CarPedalsKeeper.Keep(store, smartControl, Seen(Honda, true, 55, 3)),
                Is.EqualTo("pedals: hondacivictyper — brake force 55 kg"));
            var kept = store.CarPedalsOf(Honda);
            Assert.That((kept.ProfileName, kept.BrakeForceKg), Is.EqualTo(("Default", (double?)55)), "the rule is for a car with no profile");

            // A run with no key pressed says nothing and changes nothing; nor does a force carried from another car.
            Assert.That(CarPedalsKeeper.Keep(store, smartControl, Seen(Honda, true, 80, 0)), Is.Null);
            Assert.That(store.CarPedalsOf(Honda).BrakeForceKg, Is.EqualTo(55));
        }

        [Test]
        public void WhatIsNotKnownIsNotKept()
        {
            using var store = Store();
            var smartControl = Made(RigKeys());

            Assert.That(CarPedalsKeeper.Keep(store, smartControl, Seen(Mx5, null, 50, 1)), Does.Contain("too short a run"));
            Assert.That(CarPedalsKeeper.Keep(store, smartControl, Seen("no such car", true, 50, 1)), Does.Contain("no such car yet"));
            Assert.That(CarPedalsKeeper.Keep(store, null, Seen(Mx5, false)), Does.Contain("which SmartControl does not have"));
            Assert.That(store.CarPedalsList(), Is.Empty);

            Assert.That(CarPedalsKeeper.Keep(store, smartControl, Seen(Mx5, false, null, 2, -10)),
                Is.EqualTo("pedals: mx5 mx52016 — its own profile, from Default (no ABS); the force was changed by −10 kg from one that is not known; press a key that sets a force and it will be"));
            Assert.That(store.CarPedalsOf(Mx5).BrakeForceKg, Is.Null);
            Assert.That(CarPedalsKeeper.Keep(store, smartControl, null), Is.Null);
        }

        [Test]
        public void TheStoreTakesAForceOnlyForACarThatHasPedalsAndOnlyAForce()
        {
            using var store = Store();
            Assert.That(store.SetCarBrakeForce(Honda, 45), Is.False, "no pedals of its own yet");
            store.BindCarPedals(new CarPedals { CarPath = Honda, ProfileId = "l2", ProfileName = "LightBrake", Profile = new byte[] { 1 }, BoundAtUtc = June });

            Assert.That(store.SetCarBrakeForce(Honda, 45), Is.True);
            Assert.That(store.SetCarBrakeForce(Honda, -1), Is.False);
            Assert.That(store.SetCarBrakeForce(Honda, double.NaN), Is.False);
            Assert.That(store.SetCarBrakeForce(" ", 45), Is.False);
            Assert.That(store.CarPedalsOf(Honda).BrakeForceKg, Is.EqualTo(45));

            Assert.That(store.CarRanIn(F4, "formula"), Is.True);
            Assert.That(store.CarRanIn(Honda, "Formula"), Is.False);
            Assert.That(store.CarRanIn("no such car", "Formula"), Is.False);
        }
    }
}
