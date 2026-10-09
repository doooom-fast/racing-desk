using System.Collections.Generic;
using NUnit.Framework;
using RacingDesk.Plugin.Engine;
using RacingDesk.Plugin.Transport;

namespace RacingDesk.Tests.IRacing
{
    /// <summary>
    /// Whether the driver is in the car, as the telemetry says it to the HUD — which is on screen only then. It
    /// is said only where the sim says it: a key that is sent is believed, so one that is made up hides the HUD.
    /// </summary>
    [TestFixture]
    public class InCarTests
    {
        private const string Key = "DataCorePlugin.GameRawData.Telemetry.IsOnTrack";
        private const string Raw = "DataCorePlugin.GameRawData.Telemetry.";

        private sealed class Source : ITelemetrySource
        {
            public readonly Dictionary<string, object> Values = new Dictionary<string, object>();
            public string Game = "IRacing";
            public object Data = null;
            public bool GameRunning => true;
            public string GameName => Game;
            public object NewData => Data;
            public object GetPropertyValue(string fullName) => Values.TryGetValue(fullName, out var v) ? v : null;
            public string OpponentName(object opponent) => null;
        }

        /// <summary>SimHub's normalized data as far as this reads it: whether a replay is playing.</summary>
        private sealed class Normalized
        {
            public bool IsReplayPlaying { get; set; }
        }

        private const string AssettoStatus = "DataCorePlugin.GameRawData.Graphics.Status";

        private static bool? InAssetto(string game, object status = null, string statusKey = AssettoStatus, object data = null, object onTrack = null)
        {
            var source = new Source { Game = game, Data = data };
            if (status != null) source.Values[statusKey] = status;
            if (onTrack != null) source.Values[Raw + "IsOnTrack"] = onTrack;
            return TelemetryCapture.InCar(source);
        }

        private enum FakeStatus { AC_OFF = 0, AC_REPLAY = 1, AC_LIVE = 2, AC_PAUSE = 3 }

        private static bool? InCar(object onTrack, object replay = null)
        {
            var source = new Source();
            if (onTrack != null) source.Values[Raw + "IsOnTrack"] = onTrack;
            if (replay != null) source.Values[Raw + "IsReplayPlaying"] = replay;
            return TelemetryCapture.InCar(source);
        }

        [Test]
        public void InTheCarIsOnTrackAndNotAReplay()
        {
            Assert.That(InCar(true, false), Is.True);
            Assert.That(InCar(true), Is.True, "a sim that says nothing of replays is not playing one");
            Assert.That(InCar(false, false), Is.False, "the garage screen, the sim's menus inside a session");
            Assert.That(InCar(true, true), Is.False, "watching a replay of himself on track");
            Assert.That(InCar(false, true), Is.False);
        }

        [Test]
        public void TheFlagIsReadHoweverTheSourceHoldsIt()
        {
            // The SDK gives booleans; SimHub may give numbers or text.
            Assert.That(InCar(1, 0), Is.True);
            Assert.That(InCar(0), Is.False);
            Assert.That(InCar(1.0, 1.0), Is.False);
            Assert.That(InCar("True", "False"), Is.True);
            Assert.That(InCar("1"), Is.True);
            Assert.That(InCar("no"), Is.False);
        }

        [Test]
        public void ASimThatDoesNotSayIsNotMadeToSay()
        {
            Assert.That(InCar(null), Is.Null);
            Assert.That(InCar(null, true), Is.Null);
        }

        // ── Assetto Corsa and Assetto Corsa EVO, through SimHub (2026-10-09) ──

        [Test]
        public void AssettoCorsaIsInTheCarWhileTheGraphicsStatusIsLive()
        {
            foreach (string game in new[] { "AssettoCorsa", "AssettoCorsaEVO" })
            {
                // SimHub hands the status over as its enum (named), an int or text: the name first, the number after.
                Assert.That(InAssetto(game, FakeStatus.AC_LIVE), Is.True, game + ": live, by name");
                Assert.That(InAssetto(game, FakeStatus.AC_REPLAY), Is.False, game + ": a replay");
                Assert.That(InAssetto(game, FakeStatus.AC_PAUSE), Is.False, game + ": paused — the setup screen, the menu over the car");
                Assert.That(InAssetto(game, FakeStatus.AC_OFF), Is.False, game + ": off, loading");
                Assert.That(InAssetto(game, 2), Is.True, game + ": live, by number");
                Assert.That(InAssetto(game, 1), Is.False);
                Assert.That(InAssetto(game, 3), Is.False);
                Assert.That(InAssetto(game, 0), Is.False);
                Assert.That(InAssetto(game, "AC_LIVE"), Is.True, game + ": live, as text");
                Assert.That(InAssetto(game, "2"), Is.True);
                Assert.That(InAssetto(game, "AC_REPLAY"), Is.False);
                Assert.That(InAssetto(game, 2.0), Is.True);
                Assert.That(InAssetto(game, 2, "DataCorePlugin.GameRawData.Graphics.status"), Is.True, game + ": the lower-case spelling SimHub may use");
            }
        }

        [Test]
        public void AssettoCorsaGoesByItsOwnStatus_NotByIRacingsKey()
        {
            // A source that says both: the status decides; iRacing's IsOnTrack is another sim's word.
            Assert.That(InAssetto("AssettoCorsa", FakeStatus.AC_REPLAY, onTrack: true), Is.False);
            Assert.That(InAssetto("AssettoCorsa", FakeStatus.AC_LIVE, onTrack: false), Is.True);
            // iRacing is as it was: IsOnTrack, and nothing of a status.
            var source = new Source();
            source.Values[AssettoStatus] = FakeStatus.AC_LIVE;
            Assert.That(TelemetryCapture.InCar(source), Is.Null, "iRacing with no IsOnTrack says nothing, whatever a status key says");
            source.Values[Raw + "IsOnTrack"] = true;
            Assert.That(TelemetryCapture.InCar(source), Is.True);
        }

        [Test]
        public void WithoutTheStatus_TheGameRunningAndNotAReplayIsInTheCar_AndNothingAtAllSaysNothing()
        {
            // The spellings were read from SimHub's assembly and not yet seen live: if neither is there, SimHub's own flag
            // for a replay is the next best, so the HUD is not hidden for good by a name.
            Assert.That(InAssetto("AssettoCorsa", data: new Normalized { IsReplayPlaying = false }), Is.True);
            Assert.That(InAssetto("AssettoCorsa", data: new Normalized { IsReplayPlaying = true }), Is.False);
            Assert.That(InAssetto("AssettoCorsaEVO", data: new Normalized { IsReplayPlaying = false }), Is.True);
            Assert.That(InAssetto("AssettoCorsa", data: new object()), Is.Null, "normalized data with no such flag: nothing is said");
            Assert.That(InAssetto("AssettoCorsa"), Is.Null, "no data at all");
        }

        [Test]
        public void TheKeyIsSentOnlyWhereTheSimSaid()
        {
            var said = new TelemetrySnapshot { GameRunning = true, SessionState = 4 };
            Assert.That(TelemetryFrame.BuildDict(said, demo: false).ContainsKey(Key), Is.False,
                "no key: the HUD goes on the session being under way, as it did");

            said.InCar = false;
            Assert.That(TelemetryFrame.BuildDict(said, demo: false)[Key], Is.EqualTo(0), "at the garage screen, in a session");
            said.InCar = true;
            Assert.That(TelemetryFrame.BuildDict(said, demo: false)[Key], Is.EqualTo(1));
        }
    }
}
