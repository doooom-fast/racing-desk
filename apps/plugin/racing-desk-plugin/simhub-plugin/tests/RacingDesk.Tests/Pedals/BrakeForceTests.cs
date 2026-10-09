using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using Microsoft.Data.Sqlite;
using NUnit.Framework;
using RacingDesk.Core.Cars;
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
        private const string Honda = "hondacivictyper", F4 = "formulair04", Mx5 = "mx5 mx52016", Gr86 = "toyotagr86";
        private const string Gtp = "porsche963gtp", Lmp2 = "dallarap217";
        private const string Gt3 = "bmwm4gt3", Vee = "formulavee", Touring = "toyotagr86";

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

        /// <summary>A keyboard and a clock: the keys that are down, every key anyone asked about, and the time.</summary>
        private sealed class Keys
        {
            public readonly HashSet<int> Down = new HashSet<int>();
            public readonly HashSet<int> Tapped = new HashSet<int>();      // down and up again since last asked
            public readonly HashSet<int> Asked = new HashSet<int>();
            public DateTime Now = June;

            public short State(int key)
            {
                Asked.Add(key);
                int state = (Down.Contains(key) ? 0x8000 : 0) | (Tapped.Remove(key) ? 1 : 0);
                return unchecked((short)state);
            }

            /// <summary>A frame later.</summary>
            public void Tick(int milliseconds = 16) => Now = Now.AddMilliseconds(milliseconds);

            public LiveKeyWatcher Watcher(IEnumerable<LiveKey> keys) => new LiveKeyWatcher(keys, State, () => Now);
        }

        private static LivePresses Look(LiveKeyWatcher watcher, Keys board)
        {
            board.Tick();
            return watcher.Poll();
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

            force.Doubt();
            Assert.That(force.ForceKg, Is.Null, "a number that may be wrong is not a number to keep");
            force.Press(keys[2]);
            Assert.That(force.ForceKg, Is.EqualTo(80));
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
            var watcher = board.Watcher(bound);

            Assert.That(watcher.Watched, Is.EqualTo(new[] { Pause, PageUp, PageDown, Up, Down, RightCtrl }));
            for (int i = 0; i < 5; i++) Look(watcher, board);
            Assert.That(board.Asked, Is.EquivalentTo(watcher.Watched), "and no other key, F5 among them");
        }

        [TestCase("A", "")]
        [TestCase("7", "")]
        [TestCase("SPACE", "")]
        [TestCase("RETURN", "")]
        [TestCase("NUMPAD5", "")]
        [TestCase("OEM_COMMA", "")]
        [TestCase("RCONTROL", "B")]
        [TestCase("Q", "UP")]
        public void AKeyThatIsTypedWithIsNeverAskedAboutWhateverLiveHasBound(string first, string second)
        {
            var board = new Keys();
            var watcher = board.Watcher(new[] { new LiveKey { Action = LiveAction.SetBrakeForce, Value = 40, FirstKey = first, SecondKey = second } });
            Assert.That(watcher.Watched, Is.Empty);
            Assert.That(watcher.NotWatched.Count, Is.EqualTo(1));
            Look(watcher, board);
            Look(watcher, board);
            Assert.That(board.Asked, Is.Empty);
        }

        [Test]
        public void APressIsAKeyGoingDownAndAKeyHeldIsOnePress()
        {
            var board = new Keys();
            var watcher = board.Watcher(RigKeys());
            Assert.That(Look(watcher, board).Pressed, Is.Empty);

            board.Down.Add(PageUp);
            Assert.That(Look(watcher, board).Pressed.Select(k => k.Value), Is.EqualTo(new[] { 50.0 }));
            for (int i = 0; i < 60; i++)
            {
                var held = Look(watcher, board);
                Assert.That(held.Pressed, Is.Empty, "still held");
                Assert.That(held.HeldToRepeat, Is.False, "a key that sets a force sets the same one however long it is held");
            }

            board.Down.Clear();
            Assert.That(Look(watcher, board).Pressed, Is.Empty);
            board.Down.Add(PageUp);
            Assert.That(Look(watcher, board).Pressed.Count, Is.EqualTo(1), "pressed again");
        }

        [Test]
        public void AKeyDownAndUpAgainBetweenTwoLooksIsAPress()
        {
            var board = new Keys();
            var watcher = board.Watcher(RigKeys());
            Look(watcher, board);

            // The Pause key, on some keyboards, is never seen down: it says it went down and came up at once.
            board.Tapped.Add(Pause);
            Assert.That(Look(watcher, board).Pressed.Select(k => k.Value), Is.EqualTo(new[] { 80.0 }));
            Assert.That(Look(watcher, board).Pressed, Is.Empty, "once");
        }

        [Test]
        public void WhatWasPressedWhileNobodyWasLookingIsNotCounted()
        {
            var board = new Keys();
            board.Down.Add(Pause);
            var watcher = board.Watcher(RigKeys());
            Assert.That(Look(watcher, board).Pressed, Is.Empty, "already down when watching began");
            Assert.That(Look(watcher, board).Pressed, Is.Empty);
            board.Down.Clear();
            Look(watcher, board);

            // The sim stops sending for a while — at its menus, or stuttering — and keys are pressed meanwhile.
            board.Tick(5000);
            board.Tapped.Add(PageUp);
            board.Down.Add(PageDown);
            Assert.That(watcher.Poll().Pressed, Is.Empty);
            Assert.That(Look(watcher, board).Pressed, Is.Empty, "nor on the look after");

            board.Down.Clear();
            Look(watcher, board);
            board.Down.Add(PageDown);
            Assert.That(Look(watcher, board).Pressed.Select(k => k.Value), Is.EqualTo(new[] { 30.0 }), "watching again");
        }

        [Test]
        public void APairIsItsSecondKeyPressedWhileItsFirstIsHeld()
        {
            var board = new Keys();
            var watcher = board.Watcher(RigKeys());
            Look(watcher, board);

            board.Down.Add(Up);
            Assert.That(Look(watcher, board).Pressed, Is.Empty, "Up alone is bound to nothing");
            board.Down.Clear();
            Look(watcher, board);

            board.Down.Add(RightCtrl);
            Assert.That(Look(watcher, board).Pressed, Is.Empty, "nor is Right Ctrl alone");
            board.Down.Add(Up);
            Assert.That(Look(watcher, board).Pressed.Select(k => k.Action), Is.EqualTo(new[] { LiveAction.RaiseBrakeForce }));

            // Right Ctrl kept down, Up tapped twice more, then Down once.
            for (int i = 0; i < 2; i++)
            {
                board.Down.Remove(Up);
                Look(watcher, board);
                board.Down.Add(Up);
                Assert.That(Look(watcher, board).Pressed.Count, Is.EqualTo(1));
            }
            board.Down.Remove(Up);
            board.Down.Add(Down);
            Assert.That(Look(watcher, board).Pressed.Select(k => k.Action), Is.EqualTo(new[] { LiveAction.LowerBrakeForce }));
        }

        [Test]
        public void AStepKeyHeldUntilItRepeatsIsSaidOnce()
        {
            var board = new Keys();
            var watcher = board.Watcher(RigKeys());
            Look(watcher, board);
            board.Down.Add(RightCtrl);
            board.Down.Add(Up);
            Assert.That(Look(watcher, board).Pressed.Count, Is.EqualTo(1));

            var said = new List<bool>();
            for (int i = 0; i < 40; i++) said.Add(Look(watcher, board).HeldToRepeat);      // 640 ms
            Assert.That(said.Count(s => s), Is.EqualTo(1));
            Assert.That(said.IndexOf(true) * 16, Is.InRange(200, 300), "when Windows would first have repeated it");

            board.Down.Remove(Up);
            Look(watcher, board);
            board.Down.Add(Up);
            Assert.That(Look(watcher, board).HeldToRepeat, Is.False, "a tap is a tap");
        }

        [Test]
        public void AKeyBoundAloneIsNotAlsoPressedWhenItsPairIs()
        {
            var bound = RigKeys();
            bound.Add(new LiveKey { Action = LiveAction.SetBrakeForce, Value = 60, FirstKey = "UP", SecondKey = "" });
            var board = new Keys();
            var watcher = board.Watcher(bound);
            Look(watcher, board);

            board.Down.Add(Up);
            Assert.That(Look(watcher, board).Pressed.Select(k => k.Value), Is.EqualTo(new[] { 60.0 }));
            board.Down.Clear();
            Look(watcher, board);
            board.Down.Add(RightCtrl);
            Look(watcher, board);
            board.Down.Add(Up);
            Assert.That(Look(watcher, board).Pressed.Select(k => k.Action), Is.EqualTo(new[] { LiveAction.RaiseBrakeForce }));
        }

        [Test]
        public void ABindingThatCannotBeWatchedIsLeftOut()
        {
            var bound = new List<LiveKey>
            {
                new LiveKey { Action = LiveAction.SetBrakeForce, Value = 40, FirstKey = "WHEEL_BUTTON_3", SecondKey = "" },
                new LiveKey { Action = LiveAction.SetBrakeForce, Value = 50, FirstKey = "RCONTROL", SecondKey = "NOPE" },
                new LiveKey { Action = LiveAction.SetBrakeForce, Value = 0, FirstKey = "HOME", SecondKey = "" },
                new LiveKey { Action = LiveAction.RaiseBrakeForce, Value = -5, FirstKey = "END", SecondKey = "" },
                new LiveKey { Action = LiveAction.SetBrakeForce, Value = 60, FirstKey = "f7", SecondKey = null },
            };
            var watcher = new Keys().Watcher(bound);
            Assert.That(watcher.NotWatched.Select(k => k.Value), Is.EqualTo(new[] { 40.0, 50.0, 0.0, -5.0 }),
                "a name not known, and a force that is none: SmartControl wrote it some way that is not read here");
            Assert.That(watcher.Watched, Is.EqualTo(new[] { 0x76 }));
            Assert.That(new Keys().Watcher(null).Watched, Is.Empty);
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
        [TestCase("ZOOM")]
        public void AndNotByAnyOther(string name) =>
            Assert.That(LiveKeyWatcher.VirtualKey(name), Is.Null);

        // ------------------------------------------------------------------ his keys, as Live keeps them

        private const int KeyF1 = 0x70, KeyF2 = 0x71, KeyF3 = 0x72, KeyF4 = 0x73, Zoom = 0xFB;

        /// <summary>
        /// His keys read from a database shaped as SmartControl Live keeps his (made-up profiles): a key on its own is stored as
        /// ZOOM + the key. Moved: F1–F4 with Live's RCONTROL as their first key, as Racing Desk leaves them.
        /// </summary>
        private static IReadOnlyList<LiveKey> HisKeys(bool moved)
        {
            using var rig = new RacingDesk.Tests.Restore.RestoreRig();
            rig.SmartControlAsHisIs();
            if (moved) foreach (long id in new long[] { 6, 7, 8, 12 }) rig.SetFirstKey(id, "RCONTROL");
            return SmartControl.Read(rig.SmartControlDb).Keys;
        }

        [TestCase("ZOOM", true)]
        [TestCase("VK_ZOOM", true)]
        [TestCase(" zoom ", true)]
        [TestCase("RCONTROL", false)]
        [TestCase("", false)]
        [TestCase(null, false)]
        public void ZoomIsLivesNameForNoKey(string name, bool none) => Assert.That(LiveKeyWatcher.IsNoKey(name), Is.EqualTo(none));

        [Test]
        public void HisKeysAsLiveKeepsThem_AreWatched_AndF1AloneSetsTheForce()
        {
            var board = new Keys();
            var watcher = board.Watcher(HisKeys(moved: false));
            Assert.That(watcher.NotWatched, Is.Empty, "every one of his force keys is watched (F24 is a profile key, never one)");
            Assert.That(watcher.Watched, Is.EqualTo(new[] { Up, Down, KeyF1, KeyF2, KeyF3, KeyF4 }));
            Look(watcher, board);

            board.Down.Add(KeyF1);
            Assert.That(Look(watcher, board).Pressed.Select(k => k.Value), Is.EqualTo(new[] { 30.0 }), "ZOOM + F1 is F1 alone");
            board.Down.Clear();
            Look(watcher, board);
            board.Down.Add(Up);
            Assert.That(Look(watcher, board).Pressed.Select(k => (k.Action, k.Value)), Is.EqualTo(new[] { (LiveAction.RaiseBrakeForce, 5.0) }), "Up alone: 5 kg more");
            Assert.That(board.Asked, Has.No.Member(Zoom), "the placeholder is never asked about");
        }

        [Test]
        public void AfterTheMove_RightCtrlWithF1SetsTheForce_AndF1AloneDoesNot()
        {
            var board = new Keys();
            var watcher = board.Watcher(HisKeys(moved: true));
            Assert.That(watcher.NotWatched, Is.Empty);
            Assert.That(watcher.Watched, Is.EqualTo(new[] { Up, Down, KeyF1, KeyF2, KeyF3, KeyF4, RightCtrl }));
            Look(watcher, board);

            board.Down.Add(KeyF1);
            Assert.That(Look(watcher, board).Pressed, Is.Empty, "F1 alone is the sim's camera now, and nothing of Live's");
            board.Down.Clear();
            Look(watcher, board);
            board.Down.Add(RightCtrl);
            Assert.That(Look(watcher, board).Pressed, Is.Empty);
            board.Down.Add(KeyF4);
            Assert.That(Look(watcher, board).Pressed.Select(k => k.Value), Is.EqualTo(new[] { 100.0 }), "Right Ctrl + F4");
            board.Down.Clear();
            Look(watcher, board);
            board.Down.Add(Down);
            Assert.That(Look(watcher, board).Pressed.Select(k => k.Action), Is.EqualTo(new[] { LiveAction.LowerBrakeForce }), "Up and Down stay as they were");
        }

        [Test]
        public void BrakeMax_FillsFromHisKeys_BeforeAndAfterTheMove()
        {
            foreach (bool moved in new[] { false, true })
            {
                var run = new Run(HisKeys(moved));
                run.GetIn(Gtp);
                Assert.That(run.Recorder.Now.ForceKg, Is.Null, "a dash until a key sets a force");
                if (moved) run.Tap(Gtp, RightCtrl, KeyF2); else run.Tap(Gtp, KeyF2);
                Assert.That(run.Recorder.Now.ForceKg, Is.EqualTo(50), moved ? "Right Ctrl + F2" : "F2");
                run.Tap(Gtp, Up);
                Assert.That(run.Recorder.Now.ForceKg, Is.EqualTo(55));
                run.Recorder.SimGone();
                Assert.That(run.Saved.Single().ForceKg, Is.EqualTo(55), "and the car keeps it");
            }
        }

        // ------------------------------------------------------------------ a run in a car

        private sealed class Run
        {
            public readonly Keys Board = new Keys();
            public readonly List<PedalsSeen> Saved = new List<PedalsSeen>();
            public readonly List<string> Log = new List<string>();
            public int Reads;
            public bool Live = true;
            public Func<SmartControlSnapshot> Read;
            public readonly CarPedalsRecorder Recorder;

            public Run(IReadOnlyList<LiveKey> keys)
            {
                var snapshot = Made(keys);
                Read = () => snapshot;
                Recorder = new CarPedalsRecorder(() => { Reads++; return Read(); }, bound => Board.Watcher(bound), () => Live, () => Board.Now,
                    seen => { lock (Saved) Saved.Add(seen); }, line => { lock (Log) Log.Add(line); });
            }

            /// <summary>A frame in the car, a frame later.</summary>
            public void Frame(string car, bool absSetting = false, bool absWorking = false, int laps = 0, bool driving = true, bool prototype = false)
            {
                Board.Tick();
                Recorder.See(car, absSetting, absWorking, laps, driving, prototype);
            }

            /// <summary>Gets in: frames until SmartControl has been read, on its own thread, and its keys are watched.</summary>
            public void GetIn(string car, bool absSetting = false)
            {
                var until = DateTime.UtcNow.AddSeconds(10);
                do
                {
                    Frame(car, absSetting);
                    if (Recorder.Watched.Count == 0) Thread.Sleep(5);
                } while (Recorder.Watched.Count == 0 && DateTime.UtcNow < until);
                Frame(car, absSetting);
            }

            public void Tap(string car, params int[] keys)
            {
                foreach (int k in keys) Board.Down.Add(k);
                Frame(car);
                Board.Down.Clear();
                Frame(car);
            }

            /// <summary>What was handed over, once what is saved off the thread has been.</summary>
            public List<PedalsSeen> Handed(int count)
            {
                var until = DateTime.UtcNow.AddSeconds(10);
                while (DateTime.UtcNow < until)
                {
                    lock (Saved) if (Saved.Count >= count) break;
                    Thread.Sleep(5);
                }
                lock (Saved) return Saved.ToList();
            }
        }

        // The snapshot's setters are internal to the data assembly's own reader, so one is made the way the app makes one: read.
        private static SmartControlSnapshot Made(IReadOnlyList<LiveKey> keys, params (string Id, string Name, int Kg)[] profiles)
        {
            if (profiles.Length == 0) profiles = new[] { ("d1", "Default", 80), ("l2", "LightBrake", 45) };
            string dir = Path.Combine(Path.GetTempPath(), "racing-desk-brake-keys-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(dir);
            try
            {
                string path = SmartControlTests.Database(Path.Combine(dir, "Heusinkveld.db"), db =>
                {
                    foreach (var (id, name, kg) in profiles)
                        SmartControlTests.AddProfile(db, id, name, Encoding.UTF8.GetBytes(SmartControlTests.ProfileXml(kg)));
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
            run.GetIn(Honda);
            run.Tap(Honda, PageUp);
            run.Tap(Honda, RightCtrl, Down);
            Assert.That(run.Saved, Is.Empty, "nothing is kept while the car is being driven");

            run.Recorder.SimGone();

            Assert.That(run.Saved.Count, Is.EqualTo(1), "handed over before SimGone returns: the host may be stopping");
            Assert.That((run.Saved[0].CarPath, run.Saved[0].ForceKg, run.Saved[0].Presses), Is.EqualTo((Honda, (double?)45, 2)));
            Assert.That(run.Reads, Is.EqualTo(1), "SmartControl is read once a car, not once a frame");

            run.Recorder.SimGone();
            Assert.That(run.Saved.Count, Is.EqualTo(1), "and the sim going twice is going once");
            Assert.That(run.Recorder.Watched, Is.Empty, "the keys are let go with the sim");
        }

        [Test]
        public void ACarsBrakesPutOnByRacingDesk_AreTheForceHisKeysCountFrom_AndWhatTheyLeaveIsKeptForTheCar()
        {
            var run = new Run(RigKeys());
            run.GetIn(Gtp);
            Assert.That(run.Recorder.Now.ForceKg, Is.Null, "nothing has said a force yet");

            // Racing Desk put the 963's brakes on: 70 kg. His +5 counts from it, and 75 is kept for the car.
            run.Recorder.ForceIs(Gtp, 70);
            Assert.That(run.Recorder.Now.ForceKg, Is.EqualTo(70));
            run.Tap(Gtp, RightCtrl, Up);
            Assert.That(run.Recorder.Now.ForceKg, Is.EqualTo(75));
            Assert.That(run.Recorder.PressesThisRun, Is.EqualTo(1), "only his own keys are counted as presses");

            run.Recorder.SimGone();
            var left = run.Saved.Single();
            Assert.That((left.ForceKg, left.Presses), Is.EqualTo(((double?)75, 1)));
            Assert.That(run.Log, Has.Some.EqualTo("pedals: brake force 70 kg, put on by Racing Desk with the car's brakes"));
        }

        [Test]
        public void AForceForAnotherCar_IsNotTaken()
        {
            var run = new Run(RigKeys());
            run.GetIn(Gtp);
            run.Recorder.ForceIs(Honda, 45);
            Assert.That(run.Recorder.Now.ForceKg, Is.Null, "the car being followed is the 963");
        }

        [Test]
        public void TheLogHasTheForceAndNeverTheKey()
        {
            var run = new Run(RigKeys());
            run.GetIn(Honda);
            run.Tap(Honda, PageUp);
            run.Tap(Honda, RightCtrl, Down);
            run.Recorder.SimGone();

            Assert.That(run.Log, Is.EqualTo(new[] { "pedals: brake force 50 kg", "pedals: brake force 45 kg" }));
            foreach (string name in new[] { "PRIOR", "NEXT", "PAUSE", "RCONTROL", "UP", "DOWN", "Page", "Ctrl" })
                Assert.That(run.Log, Has.None.Contains(name));
        }

        [Test]
        public void NoKeyIsAskedAboutUntilThereIsACarAndNoneOnceTheSimHasGone()
        {
            var run = new Run(RigKeys());
            run.Frame(null);
            run.Frame("  ");
            Assert.That(run.Board.Asked, Is.Empty);
            Assert.That(run.Reads, Is.Zero, "nor is SmartControl read");

            run.GetIn(Honda);
            Assert.That(run.Board.Asked, Is.Not.Empty);

            run.Recorder.SimGone();
            run.Board.Asked.Clear();
            Thread.Sleep(50);
            Assert.That(run.Board.Asked, Is.Empty, "there is no clock in it: no frame, no question");
        }

        [Test]
        public void AKeyLiveIsNotThereToHearDidNothing()
        {
            var run = new Run(RigKeys());
            run.GetIn(Honda);
            run.Live = false;
            run.Tap(Honda, PageUp);
            run.Tap(Honda, PageDown);
            run.Live = true;
            run.Tap(Honda, RightCtrl, Up);
            run.Recorder.SimGone();

            Assert.That((run.Saved[0].ForceKg, run.Saved[0].ChangeKg, run.Saved[0].Presses), Is.EqualTo(((double?)null, 5.0, 1)));
            Assert.That(run.Log.Count(l => l.Contains("SmartControl Live is not running")), Is.EqualTo(1), "said once, not once a key");
        }

        [Test]
        public void AStepKeyHeldUntilItRepeatsLeavesAForceNobodyKnows()
        {
            var run = new Run(RigKeys());
            run.GetIn(Honda);
            run.Tap(Honda, Pause);

            run.Board.Down.Add(RightCtrl);
            run.Board.Down.Add(Up);
            for (int i = 0; i < 30; i++) run.Frame(Honda);
            run.Board.Down.Clear();
            run.Frame(Honda);
            run.Recorder.SimGone();

            Assert.That(run.Saved[0].ForceKg, Is.Null, "85, or 90, or 95: whatever Live made of the repeats");
            Assert.That(run.Saved[0].Presses, Is.EqualTo(2));
            Assert.That(run.Log, Has.Some.Contains("held until it repeated"));
        }

        [Test]
        public void TheForceGoesWithThePedalsFromCarToCarButIsKeptOnlyForTheCarItWasSetIn()
        {
            var run = new Run(RigKeys());
            run.GetIn(Honda);
            run.Tap(Honda, Pause);

            run.GetIn(Mx5);
            Assert.That(run.Handed(1).Select(s => (s.CarPath, s.ForceKg, s.Presses)), Is.EqualTo(new[] { (Honda, (double?)80, 1) }));

            run.Tap(Mx5, RightCtrl, Up);
            run.Recorder.SimGone();
            var mx5 = run.Handed(2)[1];
            Assert.That((mx5.CarPath, mx5.ForceKg, mx5.Presses), Is.EqualTo((Mx5, (double?)85, 1)), "raised from the 80 the pedals were left at");
        }

        [Test]
        public void ABreakInTheTelemetryIsTheSameRunAndALongOneIsNot()
        {
            var run = new Run(RigKeys());
            run.GetIn(Honda);
            run.Tap(Honda, Pause);
            run.Recorder.SimGone();

            // The sim stuttered, or changed session: frames again within the minute.
            run.Board.Tick(20000);
            run.GetIn(Honda);
            run.Tap(Honda, RightCtrl, Down);
            run.Recorder.SimGone();
            Assert.That(run.Saved[1].ForceKg, Is.EqualTo(75), "lowered from the 80 it was known to be at");

            // The next day the pedals may have been set with the sim away.
            run.Board.Tick(24 * 3600 * 1000);
            run.GetIn(Honda);
            run.Tap(Honda, RightCtrl, Up);
            run.Recorder.SimGone();
            Assert.That((run.Saved[2].ForceKg, run.Saved[2].ChangeKg), Is.EqualTo(((double?)null, 5.0)));
        }

        [Test]
        public void WhatARunShowsOfTheAbsAndHowManyLapsItWas()
        {
            var run = new Run(RigKeys());

            run.Frame(Honda, absSetting: true);
            run.Recorder.SimGone();
            Assert.That((run.Saved.Last().AbsSeen, run.Saved.Last().Laps), Is.EqualTo((true, 0)), "it publishes an ABS setting");

            run.Frame(Gr86, laps: 4);
            run.Frame(Gr86, absWorking: true, laps: 4);
            run.Frame(Gr86, laps: 5);
            run.Recorder.SimGone();
            Assert.That((run.Saved.Last().AbsSeen, run.Saved.Last().Laps), Is.EqualTo((true, 1)), "no setting, but the ABS worked");

            // Practice, qualifying, race: the sim counts each from nothing, and they are all laps driven.
            run.Frame(Mx5, laps: 7);
            run.Frame(Mx5, laps: 9);
            run.Frame(Mx5, laps: 0);
            run.Frame(Mx5, laps: 2);
            run.Frame(Mx5, laps: 0);
            run.Frame(Mx5, laps: 1);
            run.Recorder.SimGone();
            Assert.That((run.Saved.Last().AbsSeen, run.Saved.Last().Laps), Is.EqualTo((false, 5)));
        }

        [Test]
        public void LapsAndAbsCountOnlyWhileHeIsInTheCar()
        {
            var run = new Run(RigKeys());
            run.Frame(Mx5, laps: 0);
            run.Frame(Mx5, laps: 1);
            // Out of the car, watching: a replay of someone's laps, their ABS working.
            run.Frame(Mx5, absWorking: true, laps: 6, driving: false);
            run.Frame(Mx5, laps: 6);
            run.Frame(Mx5, laps: 7);
            run.Recorder.SimGone();
            Assert.That((run.Saved[0].AbsSeen, run.Saved[0].Laps), Is.EqualTo((false, 2)));
        }

        [Test]
        public void WithoutSmartControlTheCarIsStillFollowedAndNoKeyIsAsked()
        {
            var run = new Run(RigKeys()) { Read = () => null };
            for (int i = 0; i < 20 && !run.Log.Any(); i++) { run.Frame(Honda, absSetting: true); Thread.Sleep(5); }
            run.Recorder.SimGone();
            Assert.That(run.Board.Asked, Is.Empty);
            Assert.That((run.Saved[0].AbsSeen, run.Saved[0].Presses, run.Saved[0].ForceKg), Is.EqualTo((true, 0, (double?)null)));
            Assert.That(run.Log, Has.Some.Contains("SmartControl is not on this machine"));
        }

        [Test]
        public void SmartControlHeldByItsOwnerIsAskedAgainAndTheFrameNeverWaits()
        {
            var run = new Run(RigKeys());
            var good = run.Read;
            var held = new ManualResetEventSlim(false);
            run.Read = () => { held.Wait(); throw new InvalidOperationException("database is locked"); };
            run.Recorder.ReadAgainAfter = TimeSpan.FromSeconds(2);

            var started = DateTime.UtcNow;
            for (int i = 0; i < 100; i++) run.Frame(Honda);
            Assert.That(DateTime.UtcNow - started, Is.LessThan(TimeSpan.FromSeconds(1)), "a hundred frames, none of them waiting");

            held.Set();
            for (int i = 0; i < 200 && !run.Log.Any(); i++) { run.Frame(Honda); Thread.Sleep(5); }
            Assert.That(run.Log, Has.Some.Contains("could not be read — database is locked"));
            Assert.That(run.Recorder.Watched, Is.Empty);

            run.Read = good;
            run.Frame(Honda);
            Assert.That(run.Reads, Is.EqualTo(1), "not asked again at once");
            run.Board.Tick(2500);
            run.GetIn(Honda);
            Assert.That(run.Recorder.Watched, Is.Not.Empty, "but asked again");
        }

        [Test]
        public void ASaveThatFailsIsSaidAndNothingIsThrown()
        {
            var log = new List<string>();
            var board = new Keys();
            var recorder = new CarPedalsRecorder(() => null, bound => board.Watcher(bound), () => true, () => board.Now,
                seen => throw new IOException("disk full"), log.Add);
            recorder.See(Honda, true, false, 0);
            Assert.DoesNotThrow(() => recorder.SimGone());
            Assert.That(log, Has.Some.Contains("not kept — disk full"));
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

        private static PedalsSeen Seen(string car, bool abs, int laps = 0, double? force = null, int presses = 0, double change = 0, int day = 0,
            bool prototype = false) =>
            new PedalsSeen
            {
                CarPath = car, AbsSeen = abs, Laps = laps, ForceKg = force, Presses = presses, ChangeKg = change, SeenAtUtc = June.AddDays(day),
                Prototype = prototype,
            };

        private static Func<SmartControlSnapshot> Rig() { var s = Made(RigKeys()); return () => s; }

        /// <summary>
        /// The rule at the end of a run, by the list a test gives it and never by the one this build carries: a test
        /// that gives none is the rule for a car the list has not met, whatever the list has come to hold.
        /// </summary>
        private static string Keep(RacingDeskStore store, Func<SmartControlSnapshot> smartControl, PedalsSeen seen, CarList list = null) =>
            CarPedalsKeeper.Keep(store, smartControl, seen, list ?? CarList.Empty);

        [Test]
        public void ACarIsGivenAProfileOfItsOwnByTheDriversRule()
        {
            Assert.That(CarPedalsKeeper.BaseFor(hasAbs: true, formula: false), Is.EqualTo("LightBrake"));
            Assert.That(CarPedalsKeeper.BaseFor(hasAbs: true, formula: true), Is.EqualTo("Default"));
            Assert.That(CarPedalsKeeper.BaseFor(hasAbs: false, formula: false), Is.EqualTo("Default"));
            Assert.That(CarPedalsKeeper.BaseFor(hasAbs: false, formula: true), Is.EqualTo("Default"));

            using var store = Store();
            var smartControl = Rig();

            string honda = Keep(store, smartControl, Seen(Honda, true, 0, 45, 2));
            string f4 = Keep(store, smartControl, Seen(F4, false, 1));
            string mx5 = Keep(store, smartControl, Seen(Mx5, false, 3));

            Assert.That(honda, Is.EqualTo("pedals: hondacivictyper — its own profile, from LightBrake (ABS); brake force 45 kg"));
            Assert.That(f4, Is.EqualTo("pedals: formulair04 — its own profile, from Default (a formula car)"),
                "a formula car starts from Default whatever its ABS, so a lap is enough");
            Assert.That(mx5, Is.EqualTo("pedals: mx5 mx52016 — its own profile, from Default (no ABS)"));

            var kept = store.CarPedalsOf(Honda);
            Assert.That((kept.ProfileName, kept.ProfileId, kept.BrakeForceKg), Is.EqualTo(("LightBrake", "l2", (double?)45)));
            Assert.That(kept.Profile, Is.EqualTo(smartControl().Profiles.Single(p => p.Name == "LightBrake").Data), "byte for byte");

            var known = store.CarPedalFactsOf(Honda);
            Assert.That((known.GivenBy, known.GivenWhy, known.ForceKg, known.ForceAtUtc, known.HasAbs),
                Is.EqualTo(("rule", "ABS", (double?)45, (DateTime?)June, (bool?)true)), "who gave it and why is kept, to be shown");
            Assert.That(store.CarPedalFactsOf(F4).ForceKg, Is.Null, "no key was pressed in it: the profile's own force stands");
            Assert.That(store.CarPedalFactsOf(Mx5).GivenWhy, Is.EqualTo("no ABS"));
        }

        [Test]
        public void AForceSetByKeyIsKeptWhateverElseIsNotKnown()
        {
            using var store = Store();

            // Two laps in a car with no ABS setting: too few to give it a profile. The force is the car's all the same.
            Assert.That(Keep(store, Rig(), Seen(Mx5, false, 2, 80, 1)),
                Is.EqualTo("pedals: mx5 mx52016 — too short a run to say whether it has ABS; no profile yet; brake force 80 kg"));
            Assert.That(store.CarPedalFactsOf(Mx5).ForceKg, Is.EqualTo(80));
            Assert.That(store.CarPedalsOf(Mx5), Is.Null);

            // A car the store has not had in a session yet — changed to in mid-run — is a car all the same.
            Assert.That(Keep(store, Rig(), Seen("newcar", true, 0, 50, 1)),
                Is.EqualTo("pedals: newcar — its own profile, from LightBrake (ABS); brake force 50 kg"));
            Assert.That(store.CarPedalFactsOf("newcar").ForceKg, Is.EqualTo(50));

            // SmartControl unreadable; the base renamed.
            Assert.That(Keep(store, () => throw new IOException("database is locked"), Seen(Honda, true, 0, 45, 1)),
                Is.EqualTo("pedals: hondacivictyper — SmartControl could not be read (database is locked); no profile yet; brake force 45 kg"));
            Assert.That(store.CarPedalFactsOf(Honda).ForceKg, Is.EqualTo(45));
            var renamed = Made(RigKeys(), ("d1", "Standard", 80));
            Assert.That(Keep(store, () => renamed, Seen(Honda, true, 0, 55, 1)),
                Is.EqualTo("pedals: hondacivictyper — would start from LightBrake, which SmartControl does not have; no profile; brake force 55 kg"));
            Assert.That(store.CarPedalFactsOf(Honda).ForceKg, Is.EqualTo(55));
            Assert.That(store.CarPedalsList().Select(p => p.CarPath), Is.EqualTo(new[] { "newcar" }));
        }

        [Test]
        public void LapsAddUpAcrossRunsUntilACarCanBeSaidToHaveNoAbs()
        {
            using var store = Store();
            Assert.That(Keep(store, Rig(), Seen(Mx5, false, 2)), Does.Contain("too short a run"));
            Assert.That(Keep(store, Rig(), Seen(Mx5, false, 0, day: 1)), Does.Contain("too short a run"));
            Assert.That(store.CarPedalFactsOf(Mx5).HasAbs, Is.Null);

            Assert.That(Keep(store, Rig(), Seen(Mx5, false, 1, day: 2)),
                Is.EqualTo("pedals: mx5 mx52016 — its own profile, from Default (no ABS)"));
            Assert.That((store.CarPedalFactsOf(Mx5).LapsWithoutAbs, store.CarPedalFactsOf(Mx5).HasAbs), Is.EqualTo((3, (bool?)false)));
        }

        [Test]
        public void ACarTakenToHaveNoAbsIsPutRightWhenItsAbsIsSeen()
        {
            using var store = Store();
            Save(store, Gr86, "Toyota GR86", "SportsCar", 6);
            // Three gentle laps: its ABS cannot be adjusted, and never worked.
            Assert.That(Keep(store, Rig(), Seen(Gr86, false, 3)), Does.Contain("from Default (no ABS)"));

            Assert.That(Keep(store, Rig(), Seen(Gr86, true, 5, day: 1)),
                Is.EqualTo("pedals: toyotagr86 — its ABS has been seen working, so its profile is from LightBrake now, not Default"));
            Assert.That(store.CarPedalsOf(Gr86).ProfileName, Is.EqualTo("LightBrake"));
            Assert.That((store.CarPedalFactsOf(Gr86).GivenBy, store.CarPedalFactsOf(Gr86).GivenWhy), Is.EqualTo(("rule", "ABS")));
            Assert.That(Keep(store, Rig(), Seen(Gr86, true, 5, day: 2)), Is.Null, "once");
        }

        [Test]
        public void APrototypeWithAbsStartsFromDefault()
        {
            Assert.That(CarPedalsKeeper.BaseFor(hasAbs: true, formula: false, prototype: true), Is.EqualTo("Default"));
            Assert.That(CarPedalsKeeper.BaseFor(hasAbs: false, formula: false, prototype: true), Is.EqualTo("Default"));
            Assert.That(CarPedalsKeeper.BaseFor(hasAbs: true, formula: false, prototype: false), Is.EqualTo("LightBrake"));

            using var store = Store();
            Save(store, Gtp, "Porsche 963 GTP", "SportsCar", 6);
            Save(store, Lmp2, "Dallara P217 LMP2", "SportsCar", 7);

            Assert.That(Keep(store, Rig(), Seen(Gtp, true, 0, prototype: true)),
                Is.EqualTo("pedals: porsche963gtp — its own profile, from Default (a prototype)"));
            Assert.That(store.CarPedalsOf(Gtp).ProfileName, Is.EqualTo("Default"));
            Assert.That((store.CarPedalFactsOf(Gtp).GivenBy, store.CarPedalFactsOf(Gtp).GivenWhy), Is.EqualTo(("rule", "a prototype")));

            // Without ABS it is given Default for that, as any car is, and only once enough has been driven to say so.
            Assert.That(Keep(store, Rig(), Seen(Lmp2, false, 1, prototype: true)), Does.Contain("too short a run"));
            Assert.That(Keep(store, Rig(), Seen(Lmp2, false, 2, day: 1, prototype: true)),
                Is.EqualTo("pedals: dallarap217 — its own profile, from Default (no ABS)"));
        }

        [Test]
        public void ACarTakenForASportsCarIsPutRightWhenItIsSeenToBeAPrototype()
        {
            using var store = Store();
            Save(store, Gtp, "Porsche 963 GTP", "SportsCar", 6);
            // Given by a build that could not tell.
            Assert.That(Keep(store, Rig(), Seen(Gtp, true)), Does.Contain("from LightBrake (ABS)"));

            Assert.That(Keep(store, Rig(), Seen(Gtp, true, 4, day: 1, prototype: true)),
                Is.EqualTo("pedals: porsche963gtp — it is a prototype, so its profile is from Default now, not LightBrake"));
            Assert.That(store.CarPedalsOf(Gtp).ProfileName, Is.EqualTo("Default"));
            Assert.That(store.CarPedalFactsOf(Gtp).GivenWhy, Is.EqualTo("a prototype"));

            // A run in which it was not seen says nothing, and takes nothing back.
            Assert.That(Keep(store, Rig(), Seen(Gtp, true, 4, day: 2)), Is.Null);
            Assert.That(store.CarPedalsOf(Gtp).ProfileName, Is.EqualTo("Default"));
        }

        [Test]
        public void AProfileTheDriverGaveAPrototypeIsHis()
        {
            using var store = Store();
            Save(store, Gtp, "Porsche 963 GTP", "SportsCar", 6);
            store.BindCarPedals(new CarPedals { CarPath = Gtp, ProfileId = "l2", ProfileName = "LightBrake", Profile = new byte[] { 2 }, BoundAtUtc = June });
            store.NotePedalsGiven(Gtp, "driver", null, June);
            Assert.That(Keep(store, Rig(), Seen(Gtp, true, 4, prototype: true)), Is.Null);
            Assert.That(store.CarPedalsOf(Gtp).ProfileName, Is.EqualTo("LightBrake"));
        }

        [Test]
        public void WhatOnlyAPrototypePublishesIsSeenOnAnyFrameOfTheRun()
        {
            var run = new Run(RigKeys());
            run.Frame(Gtp, absSetting: true);
            run.Frame(Gtp, absSetting: true, prototype: true, driving: false);
            run.Frame(Gtp, absSetting: true);
            run.Frame(Honda, absSetting: true);
            run.Recorder.SimGone();
            var by = run.Handed(2).ToDictionary(s => s.CarPath, s => s.Prototype);
            Assert.That((by[Gtp], by[Honda]), Is.EqualTo((true, false)), "and it is the car's, not the next car's");
        }

        [Test]
        public void AProfileTheDriverGaveOrChoseNotToHaveIsHis()
        {
            using var store = Store();
            var at = June;

            // Given on the desk: the rule leaves it, and a wrong "no ABS" is nothing to it.
            store.BindCarPedals(new CarPedals { CarPath = Honda, ProfileId = "d1", ProfileName = "Default", Profile = new byte[] { 1 }, BoundAtUtc = at });
            store.NotePedalsGiven(Honda, "driver", null, at);
            Assert.That(Keep(store, Rig(), Seen(Honda, true, 9, 55, 3)), Is.EqualTo("pedals: hondacivictyper — brake force 55 kg"));
            var kept = store.CarPedalsOf(Honda);
            Assert.That((kept.ProfileName, kept.BrakeForceKg), Is.EqualTo(("Default", (double?)55)));

            // A run with no key pressed says nothing and changes nothing; nor does a force carried from another car.
            Assert.That(Keep(store, Rig(), Seen(Honda, true, 1, 80, 0)), Is.Null);
            Assert.That(store.CarPedalFactsOf(Honda).ForceKg, Is.EqualTo(55));

            // He chose that the MX-5 has none.
            store.NotePedalsGiven(Mx5, "none", null, at);
            Assert.That(Keep(store, Rig(), Seen(Mx5, false, 9)), Is.Null);
            Assert.That(store.CarPedalsOf(Mx5), Is.Null);

            // And a profile given on the desk while the rule was making up its mind is not written over.
            Assert.That(store.GiveCarPedals(new CarPedals { CarPath = Honda, ProfileId = "l2", ProfileName = "LightBrake", Profile = new byte[] { 2 }, BoundAtUtc = at }), Is.False);
            Assert.That(store.CarPedalsOf(Honda).ProfileName, Is.EqualTo("Default"));
        }

        [Test]
        public void AForceNobodyKnowsIsSaidAndNotKept()
        {
            using var store = Store();
            Assert.That(Keep(store, Rig(), Seen(Mx5, false, 3, null, 2, -10)),
                Is.EqualTo("pedals: mx5 mx52016 — its own profile, from Default (no ABS); the force was changed by -10 kg from one that is not known, " +
                           "or a step key was held; press a key that sets a force and it will be known"));
            Assert.That(store.CarPedalFactsOf(Mx5).ForceKg, Is.Null);
            Assert.That(Keep(store, Rig(), null), Is.Null);
            Assert.That(Keep(store, Rig(), Seen(" ", true)), Is.Null);
        }

        // ------------------------------------------------------------------ the canonical list

        // A small list of a test's own. The Honda and the Lmp2 are not in it; the last four entries leave out the ABS
        // or the kind.
        private static readonly CarList Cars = CarList.Parse(@"{ ""version"": 1, ""cars"": [
  { ""path"": ""bmwm4gt3"",      ""kind"": ""gt"",        ""abs"": ""adjustable"" },
  { ""path"": ""porsche963gtp"", ""kind"": ""prototype"", ""abs"": ""adjustable"" },
  { ""path"": ""formulavee"",    ""kind"": ""formula"",   ""abs"": ""adjustable"" },
  { ""path"": ""toyotagr86"",    ""kind"": ""touring"",   ""abs"": ""none"" },
  { ""path"": ""mx5 mx52016"",   ""kind"": ""stock"",     ""abs"": ""fixed"" },
  { ""path"": ""formulair04"",   ""kind"": ""formula"",   ""abs"": ""none"" },
  { ""path"": ""touringabs"",    ""kind"": ""touring"",   ""abs"": ""adjustable"" },
  { ""path"": ""nokind"",        ""abs"": ""adjustable"" },
  { ""path"": ""noabs"",         ""kind"": ""gt"" },
  { ""path"": ""formulaonly"",   ""kind"": ""formula"" },
  { ""path"": ""noneonly"",      ""abs"": ""none"" }
] }");

        [Test]
        public void ACarTheListHasIsGivenItsProfileAtTheEndOfItsFirstRun()
        {
            Assert.That(Cars.Problems, Is.Empty);
            using var store = Store();

            // No laps, no ABS seen, no prototype seen: the list is what answers.
            Assert.That(Keep(store, Rig(), Seen(Gt3, false, 0), Cars),
                Is.EqualTo("pedals: bmwm4gt3 — its own profile, from LightBrake (ABS, from the list)"));
            Assert.That(Keep(store, Rig(), Seen(Gtp, false, 0), Cars),
                Is.EqualTo("pedals: porsche963gtp — its own profile, from Default (a prototype, from the list)"),
                "a prototype with ABS gets Default");
            Assert.That(Keep(store, Rig(), Seen(Vee, false, 0), Cars),
                Is.EqualTo("pedals: formulavee — its own profile, from Default (a formula car, from the list)"),
                "a formula car with ABS gets Default");
            Assert.That(Keep(store, Rig(), Seen(Mx5, false, 0), Cars),
                Is.EqualTo("pedals: mx5 mx52016 — its own profile, from LightBrake (ABS, from the list)"),
                "an ABS it cannot turn is still ABS");

            Assert.That(store.CarPedalsOf(Gt3).ProfileName, Is.EqualTo("LightBrake"));
            Assert.That(store.CarPedalsOf(Gtp).ProfileName, Is.EqualTo("Default"));
            Assert.That(store.CarPedalsOf(Vee).ProfileName, Is.EqualTo("Default"));
            // What is kept is one of the four reasons as they were: "from the list" is for the log.
            Assert.That(new[] { Gt3, Gtp, Vee, Mx5 }.Select(c => (store.CarPedalFactsOf(c).GivenBy, store.CarPedalFactsOf(c).GivenWhy)),
                Is.EqualTo(new[] { ("rule", "ABS"), ("rule", "a prototype"), ("rule", "a formula car"), ("rule", "ABS") }));
            Assert.That(store.CarPedalFactsOf(Gt3).HasAbs, Is.Null, "what the car showed is not what was gone by");
        }

        [Test]
        public void ACarTheListSaysHasNoAbsIsGivenDefaultWhateverItPublished()
        {
            using var store = Store();
            Save(store, Touring, "Toyota GR86", "SportsCar", 6);

            // Its ABS was seen working, five laps of it, and the list says it has none: the list is gone by, and the
            // disagreement is in the line.
            string line = Keep(store, Rig(), Seen(Touring, true, 5), Cars);
            Assert.That(line, Is.EqualTo("pedals: toyotagr86 — its own profile, from Default (no ABS, from the list); " +
                                         "the car published an ABS setting or its ABS was seen working, though the list says it has none, and the rule goes by the list"));
            Assert.That((store.CarPedalsOf(Touring).ProfileName, store.CarPedalFactsOf(Touring).GivenWhy), Is.EqualTo(("Default", "no ABS")));
            Assert.That(store.CarPedalFactsOf(Touring).HasAbs, Is.True, "what the car showed is kept as it was");

            // Said where the rule acts, so once.
            Assert.That(Keep(store, Rig(), Seen(Touring, true, 5, day: 1), Cars), Is.Null);

            // A formula car without ABS is a formula car: no laps to wait for.
            Assert.That(Keep(store, Rig(), Seen(F4, false, 0), Cars),
                Is.EqualTo("pedals: formulair04 — its own profile, from Default (a formula car, from the list)"));
        }

        [Test]
        public void ACarTheListDoesNotHaveIsGivenItsProfileByWhatItShowed()
        {
            using var store = Store();

            // The Honda is not in the list: today's rule, and no "from the list".
            Assert.That(Keep(store, Rig(), Seen(Honda, true, 0, 45, 2), Cars),
                Is.EqualTo("pedals: hondacivictyper — its own profile, from LightBrake (ABS); brake force 45 kg"));

            // Laps to say it has no ABS, and a prototype by what the car published.
            Assert.That(Keep(store, Rig(), Seen(Lmp2, false, 2, prototype: true), Cars), Does.Contain("too short a run"));
            Assert.That(Keep(store, Rig(), Seen(Lmp2, false, 1, day: 1, prototype: true), Cars),
                Is.EqualTo("pedals: dallarap217 — its own profile, from Default (no ABS)"));
            Assert.That(Keep(store, Rig(), Seen("newproto", true, 0, prototype: true), Cars),
                Is.EqualTo("pedals: newproto — its own profile, from Default (a prototype)"));

            // A formula car by a session in the category.
            Assert.That(Keep(store, Rig(), Seen("newformula", false, 1), Cars), Does.Contain("too short a run"));
            Save(store, "newformula", "New Formula", "Formula", 8);
            Assert.That(Keep(store, Rig(), Seen("newformula", false, 1, day: 1), Cars),
                Is.EqualTo("pedals: newformula — its own profile, from Default (a formula car)"));
        }

        [Test]
        public void TheListsKindIsGoneByWhateverTheCarShowedOfIt()
        {
            using var store = Store();

            // The list says a GT car; the car published what only a prototype does. The list wins: it has ABS, so
            // LightBrake — and not Default, which is what a prototype would be given.
            Assert.That(Keep(store, Rig(), Seen(Gt3, true, 0, prototype: true), Cars),
                Is.EqualTo("pedals: bmwm4gt3 — its own profile, from LightBrake (ABS, from the list)"));
            Assert.That(store.CarPedalFactsOf(Gt3).GivenWhy, Is.EqualTo("ABS"));

            // The list says a touring car; a session in it ran in the category Formula. The list wins again.
            Save(store, "touringabs", "Touring With ABS", "Formula", 6);
            Assert.That(store.CarRanIn("touringabs", "Formula"), Is.True);
            Assert.That(Keep(store, Rig(), Seen("touringabs", false, 0), Cars),
                Is.EqualTo("pedals: touringabs — its own profile, from LightBrake (ABS, from the list)"));
            Assert.That(store.CarPedalsOf("touringabs").ProfileName, Is.EqualTo("LightBrake"));
        }

        [Test]
        public void WhatAnEntryLeavesOutIsLeftToTheDataAndNoMore()
        {
            using var store = Store();

            // The kind, without the ABS: the ABS is what the car showed, and waits for laps as it did.
            Assert.That(Keep(store, Rig(), Seen("noabs", false, 1), Cars), Does.Contain("too short a run"));
            Assert.That(Keep(store, Rig(), Seen("noabs", true, 1, day: 1), Cars),
                Is.EqualTo("pedals: noabs — its own profile, from LightBrake (ABS, from the list and what the car showed)"));

            // The ABS, without the kind: the ABS is the list's, so no laps to wait for; the kind is what the car showed.
            Assert.That(Keep(store, Rig(), Seen("nokind", false, 0), Cars),
                Is.EqualTo("pedals: nokind — its own profile, from LightBrake (ABS, from the list and what the car showed)"));
            Save(store, "nokindformula", "Formula Without A Kind", "Formula", 6);
            var formulaWithoutKind = CarList.Parse(@"{ ""cars"": [ { ""path"": ""nokindformula"", ""abs"": ""adjustable"" } ] }");
            Assert.That(Keep(store, Rig(), Seen("nokindformula", false, 0), formulaWithoutKind),
                Is.EqualTo("pedals: nokindformula — its own profile, from Default (a formula car, from the list and what the car showed)"));

            // A formula car with no ABS in its entry is a formula car: Default at once, whatever the data has of its ABS.
            Assert.That(Keep(store, Rig(), Seen("formulaonly", true, 0), Cars),
                Is.EqualTo("pedals: formulaonly — its own profile, from Default (a formula car, from the list)"));

            // No ABS in the list is no ABS, whatever the kind and whatever the car published.
            Assert.That(Keep(store, Rig(), Seen("noneonly", false, 0), Cars),
                Is.EqualTo("pedals: noneonly — its own profile, from Default (no ABS, from the list)"));
            var seenAbs = Keep(store, Rig(), Seen("noneonlyabs", true, 4), CarList.Parse(@"{ ""cars"": [ { ""path"": ""noneonlyabs"", ""abs"": ""none"" } ] }"));
            Assert.That(seenAbs, Is.EqualTo("pedals: noneonlyabs — its own profile, from Default (no ABS, from the list); " +
                "the car published an ABS setting or its ABS was seen working, though the list says it has none, and the rule goes by the list"));

            // A misspelt ABS is left out by the loader and is a problem in the list; the kind it has is still gone by.
            var typo = CarList.Parse(@"{ ""cars"": [ { ""path"": ""hondacivictyper"", ""kind"": ""formula"", ""abs"": ""adjustible"" } ] }");
            Assert.That(typo.Problems, Has.Count.EqualTo(1));
            Assert.That(typo.Find(Honda).Abs, Is.Null);
            Assert.That(Keep(store, Rig(), Seen(Honda, true, 0), typo),
                Is.EqualTo("pedals: hondacivictyper — its own profile, from Default (a formula car, from the list)"),
                "the Honda ran in no formula session, and had ABS: the data alone would have given it LightBrake");
        }

        [Test]
        public void AProfileGivenForAKindTheListSaysTheCarIsNotIsGivenAgain()
        {
            using var store = Store();
            Save(store, Gtp, "Porsche 963 GTP", "SportsCar", 6);

            // Given by the data, for a prototype; a list that says it is a touring car (and says no more) says it is
            // not one: with the ABS the car showed, it is LightBrake's.
            Assert.That(Keep(store, Rig(), Seen(Gtp, true, 4, prototype: true)), Does.Contain("from Default (a prototype)"));
            var touring = CarList.Parse(@"{ ""cars"": [ { ""path"": ""porsche963gtp"", ""kind"": ""touring"" } ] }");
            Assert.That(Keep(store, Rig(), Seen(Gtp, true, 0, day: 1, prototype: true), touring),
                Is.EqualTo("pedals: porsche963gtp — the list says its kind is touring, so its profile is from LightBrake now, not Default"));
            Assert.That((store.CarPedalsOf(Gtp).ProfileName, store.CarPedalFactsOf(Gtp).GivenWhy), Is.EqualTo(("LightBrake", "ABS")));
            Assert.That(Keep(store, Rig(), Seen(Gtp, true, 0, day: 2, prototype: true), touring), Is.Null, "once");
        }

        [Test]
        public void AProfileTheRuleGaveAndTheListContradictsIsGivenAgainOnce()
        {
            using var store = Store();
            Save(store, Touring, "Toyota GR86", "SportsCar", 6);
            Save(store, Gtp, "Porsche 963 GTP", "SportsCar", 7);

            // Given by the data, before the list had the cars.
            Assert.That(Keep(store, Rig(), Seen(Touring, true, 5)), Does.Contain("from LightBrake (ABS)"));
            Assert.That(Keep(store, Rig(), Seen(Mx5, false, 3)), Does.Contain("from Default (no ABS)"));
            Assert.That(Keep(store, Rig(), Seen(Gtp, true, 4, prototype: true)), Does.Contain("from Default (a prototype)"));

            // The list says the GR86 has no ABS, and the MX-5 has it. The line says why.
            Assert.That(Keep(store, Rig(), Seen(Touring, false, 0, day: 1), Cars),
                Is.EqualTo("pedals: toyotagr86 — the list says it has no ABS, so its profile is from Default now, not LightBrake; " +
                           "the car published an ABS setting or its ABS was seen working, though the list says it has none, and the rule goes by the list"));
            Assert.That(Keep(store, Rig(), Seen(Mx5, false, 0, day: 1), Cars),
                Is.EqualTo("pedals: mx5 mx52016 — the list says it has ABS, so its profile is from LightBrake now, not Default"));
            Assert.That(store.CarPedalsOf(Touring).ProfileName, Is.EqualTo("Default"));
            Assert.That(store.CarPedalsOf(Mx5).ProfileName, Is.EqualTo("LightBrake"));
            Assert.That((store.CarPedalFactsOf(Touring).GivenBy, store.CarPedalFactsOf(Touring).GivenWhy), Is.EqualTo(("rule", "no ABS")));
            Assert.That((store.CarPedalFactsOf(Mx5).GivenBy, store.CarPedalFactsOf(Mx5).GivenWhy), Is.EqualTo(("rule", "ABS")));

            // Once: what it went by is now what the list says.
            Assert.That(Keep(store, Rig(), Seen(Touring, false, 0, day: 2), Cars), Is.Null);
            Assert.That(Keep(store, Rig(), Seen(Mx5, false, 0, day: 2), Cars), Is.Null);

            // The 963 was given Default for being a prototype; a list that says it is one and has no ABS starts it
            // from the same profile. What it went by is put right and the profile is left as it was.
            var before = store.CarPedalsOf(Gtp);
            var noAbs = CarList.Parse(@"{ ""cars"": [ { ""path"": ""porsche963gtp"", ""kind"": ""prototype"", ""abs"": ""none"" } ] }");
            Assert.That(Keep(store, Rig(), Seen(Gtp, false, 0, day: 3), noAbs),
                Is.EqualTo("pedals: porsche963gtp — the list says it has no ABS; its profile stays from Default (no ABS); " +
                           "the car published an ABS setting or its ABS was seen working, though the list says it has none, and the rule goes by the list"));
            Assert.That(store.CarPedalFactsOf(Gtp).GivenWhy, Is.EqualTo("no ABS"));
            Assert.That((store.CarPedalsOf(Gtp).ProfileName, store.CarPedalsOf(Gtp).BoundAtUtc), Is.EqualTo((before.ProfileName, before.BoundAtUtc)));
            Assert.That(Keep(store, Rig(), Seen(Gtp, false, 0, day: 4), noAbs), Is.Null, "once");

            // A list that agrees with what the data gave leaves it alone.
            Assert.That(Keep(store, Rig(), Seen(Gt3, true, 4)), Does.Contain("from LightBrake (ABS)"));
            Assert.That(Keep(store, Rig(), Seen(Gt3, true, 4, day: 1), Cars), Is.Null);
        }

        [Test]
        public void AProfileTheDriverGaveOrChoseNotToHaveIsHisWhateverTheListSays()
        {
            using var store = Store();
            Save(store, Gt3, "BMW M4 GT3", "SportsCar", 6);

            // He gave the GT3 Default on the desk; the list would give it LightBrake.
            store.BindCarPedals(new CarPedals { CarPath = Gt3, ProfileId = "d1", ProfileName = "Default", Profile = new byte[] { 1 }, BoundAtUtc = June });
            store.NotePedalsGiven(Gt3, "driver", null, June);
            Assert.That(Keep(store, Rig(), Seen(Gt3, true, 4), Cars), Is.Null);
            Assert.That(store.CarPedalsOf(Gt3).ProfileName, Is.EqualTo("Default"));
            Assert.That(store.CarPedalFactsOf(Gt3).GivenBy, Is.EqualTo("driver"));

            // A list corrected to say the car is a formula car with no ABS: still his.
            var formula = CarList.Parse(@"{ ""cars"": [ { ""path"": ""bmwm4gt3"", ""kind"": ""formula"", ""abs"": ""none"" } ] }");
            Assert.That(Keep(store, Rig(), Seen(Gt3, true, 4, day: 1), formula), Is.Null);
            Assert.That(store.CarPedalsOf(Gt3).ProfileName, Is.EqualTo("Default"));
            Assert.That(store.CarPedalFactsOf(Gt3).GivenBy, Is.EqualTo("driver"));
            Assert.That(store.CarPedalFactsOf(Gt3).GivenWhy, Is.Null, "no reason was put on it");

            // He chose that the MX-5 has none, and the list has it with ABS.
            store.NotePedalsGiven(Mx5, "none", null, June);
            Assert.That(Keep(store, Rig(), Seen(Mx5, false, 9), Cars), Is.Null);
            Assert.That(store.CarPedalsOf(Mx5), Is.Null);

            // What the list says of a car does not hold up a force: it is kept as it was.
            Assert.That(Keep(store, Rig(), Seen(Gt3, true, 4, 55, 2, day: 2), Cars), Is.EqualTo("pedals: bmwm4gt3 — brake force 55 kg"));
        }

        // The desk is another connection to the same store, and the rule reads SmartControl's database — file IO, and
        // long enough — between looking at a car and writing to it. What the driver chooses in that time is his.
        private RacingDeskStore Desk() => new RacingDeskStore(Path.Combine(_dir, "racing-desk.db"));

        private static Func<SmartControlSnapshot> WhileReading(Func<SmartControlSnapshot> smartControl, Action onTheDesk) =>
            () => { onTheDesk(); return smartControl(); };

        private static CarPedals His(string car, string id, string name, int day) =>
            new CarPedals { CarPath = car, ProfileId = id, ProfileName = name, Profile = new byte[] { 9 }, BoundAtUtc = June.AddDays(day) };

        [Test]
        public void AProfileTheDriverChoosesWhileTheRuleIsReadingSmartControlIsNotWrittenOver()
        {
            using var store = Store();
            using var desk = Desk();
            Save(store, Touring, "Toyota GR86", "SportsCar", 6);
            Save(store, Gtp, "Porsche 963 GTP", "SportsCar", 7);
            Assert.That(Keep(store, Rig(), Seen(Touring, true, 5)), Does.Contain("from LightBrake (ABS)"));
            Assert.That(Keep(store, Rig(), Seen(Gtp, true, 4, prototype: true)), Does.Contain("from Default (a prototype)"));

            // The rule is about to give the GR86 Default, because the list says it has no ABS; on the desk he picks
            // his own profile in the meantime, and both of the desk's writes are done.
            var mine = His(Touring, "h3", "HeavyBrake", 9);
            Assert.That(Keep(store, WhileReading(Rig(), () => { desk.BindCarPedals(mine); desk.NotePedalsGiven(Touring, "driver", null, mine.BoundAtUtc); }),
                Seen(Touring, false, 0, day: 1), Cars), Is.Null);
            Assert.That(store.CarPedalsOf(Touring).ProfileName, Is.EqualTo("HeavyBrake"));
            Assert.That(store.CarPedalsOf(Touring).BoundAtUtc, Is.EqualTo(mine.BoundAtUtc));
            Assert.That(store.CarPedalFactsOf(Touring).GivenBy, Is.EqualTo("driver"));
            Assert.That(store.CarPedalFactsOf(Touring).GivenWhy, Is.Null);

            // The desk writes the profile and then who gave it: between the two he is not yet down as having.
            var hers = His(Gtp, "h3", "HeavyBrake", 9);
            Assert.That(Keep(store, WhileReading(Rig(), () => desk.BindCarPedals(hers)), Seen(Gtp, false, 0, day: 1), CarList.Parse(
                @"{ ""cars"": [ { ""path"": ""porsche963gtp"", ""kind"": ""touring"", ""abs"": ""adjustable"" } ] }")), Is.Null);
            Assert.That(store.CarPedalsOf(Gtp).ProfileName, Is.EqualTo("HeavyBrake"), "the rule looked at a profile that is no longer there");
        }

        [Test]
        public void AChoiceTheDriverMakesWhileTheRuleIsGivingACarItsFirstProfileStands()
        {
            using var store = Store();
            using var desk = Desk();
            Save(store, Gt3, "BMW M4 GT3", "SportsCar", 6);

            // He picks a profile for the GT3 while the rule is reading SmartControl: it is his, and is not relabelled.
            var mine = His(Gt3, "h3", "HeavyBrake", 9);
            Assert.That(Keep(store, WhileReading(Rig(), () => { desk.BindCarPedals(mine); desk.NotePedalsGiven(Gt3, "driver", null, mine.BoundAtUtc); }),
                Seen(Gt3, true, 0), Cars), Is.Null);
            Assert.That(store.CarPedalsOf(Gt3).ProfileName, Is.EqualTo("HeavyBrake"));
            Assert.That(store.CarPedalFactsOf(Gt3).GivenBy, Is.EqualTo("driver"));

            // He chooses that the MX-5 has none: no profile is made for it after all.
            Assert.That(Keep(store, WhileReading(Rig(), () => desk.NotePedalsGiven(Mx5, "none", null, June)), Seen(Mx5, false, 0), Cars), Is.Null);
            Assert.That(store.CarPedalsOf(Mx5), Is.Null);
            Assert.That(store.CarPedalFactsOf(Mx5).GivenBy, Is.EqualTo("none"));
        }

        [Test]
        public void TheRulePutsRightWhatItWentByOnlyWhileTheProfileIsStillTheOneItGave()
        {
            using var store = Store();
            using var desk = Desk();
            Save(store, Gtp, "Porsche 963 GTP", "SportsCar", 6);
            Assert.That(Keep(store, Rig(), Seen(Gtp, true, 4, prototype: true)), Does.Contain("from Default (a prototype)"));
            var read = store.CarPedalsOf(Gtp);

            // Chosen on the desk since the rule looked: the reason is not the rule's to put on it.
            desk.BindCarPedals(His(Gtp, "d1", "Default", 9));
            desk.NotePedalsGiven(Gtp, "driver", null, June.AddDays(9));
            Assert.That(store.NoteRuleReason(Gtp, "no ABS", read.BoundAtUtc), Is.False);
            Assert.That(store.CarPedalFactsOf(Gtp).GivenBy, Is.EqualTo("driver"));
            Assert.That(store.CarPedalFactsOf(Gtp).GivenWhy, Is.Null);

            // And after he chose that it has none.
            var chosen = store.CarPedalsOf(Gtp);
            desk.UnbindCarPedals(Gtp);
            desk.NotePedalsGiven(Gtp, "none", null, June.AddDays(10));
            Assert.That(store.NoteRuleReason(Gtp, "no ABS", chosen.BoundAtUtc), Is.False);
            Assert.That(store.CarPedalFactsOf(Gtp).GivenBy, Is.EqualTo("none"));
            Assert.That(store.CarPedalsOf(Gtp), Is.Null);

            // And the profile the rule read, given again, is the one it read: not one that has been given since.
            Assert.That(store.RegiveCarPedalsByRule(His(Gtp, "l2", "LightBrake", 11), read.BoundAtUtc, "ABS", June.AddDays(11)), Is.False);
            Assert.That(store.CarPedalsOf(Gtp), Is.Null);
        }

        [Test]
        public void TheStoreKeepsAForceAndWhatItIsToldOfTheAbs()
        {
            using var store = Store();
            Assert.That(store.SetCarBrakeForce(Honda, 45), Is.True, "with or without a profile");
            Assert.That(store.SetCarBrakeForce(Honda, -1), Is.False);
            Assert.That(store.SetCarBrakeForce(Honda, double.NaN), Is.False);
            Assert.That(store.SetCarBrakeForce(" ", 45), Is.False);
            Assert.That(store.CarPedalFactsOf(Honda).ForceKg, Is.EqualTo(45));
            Assert.That(store.CarPedalFactsOf("no such car"), Is.Null);

            // A force that is not given leaves the one that is kept; ABS once seen stays seen.
            var known = store.NotePedals(Honda, null, true, 4, June.AddDays(1));
            Assert.That((known.ForceKg, known.AbsSeen, known.LapsWithoutAbs), Is.EqualTo(((double?)45, true, 0)));
            known = store.NotePedals(Honda, 50, false, 4, June.AddDays(2));
            Assert.That((known.ForceKg, known.ForceAtUtc, known.AbsSeen, known.LapsWithoutAbs),
                Is.EqualTo(((double?)50, (DateTime?)June.AddDays(2), true, 0)));

            // The force is kept beside the profile too, where an earlier build reads it.
            store.BindCarPedals(new CarPedals { CarPath = Honda, ProfileId = "l2", ProfileName = "LightBrake", Profile = new byte[] { 1 }, BoundAtUtc = June });
            store.SetCarBrakeForce(Honda, 60);
            Assert.That(store.CarPedalsOf(Honda).BrakeForceKg, Is.EqualTo(60));

            Assert.That(store.CarRanIn(F4, "formula"), Is.True);
            Assert.That(store.CarRanIn(Honda, "Formula"), Is.False);
            Assert.That(store.CarRanIn("no such car", "Formula"), Is.False);
            Assert.That(store.CarPedalFactsList().Select(f => (f.CarPath, f.CarName)), Is.EqualTo(new[] { (Honda, "Honda Civic Type R TCR") }));
        }
    }
}
