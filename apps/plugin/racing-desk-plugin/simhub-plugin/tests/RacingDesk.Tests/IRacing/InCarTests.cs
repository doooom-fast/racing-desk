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
            public bool GameRunning => true;
            public string GameName => "IRacing";
            public object NewData => null;
            public object GetPropertyValue(string fullName) => Values.TryGetValue(fullName, out var v) ? v : null;
        }

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
