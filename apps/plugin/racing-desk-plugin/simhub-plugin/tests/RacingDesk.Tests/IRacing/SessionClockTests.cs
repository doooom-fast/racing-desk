using System.Collections.Generic;
using NUnit.Framework;
using RacingDesk.Plugin.Engine;
using RacingDesk.Plugin.Transport;

namespace RacingDesk.Tests.IRacing
{
    /// <summary>
    /// The sim's own clock — iRacing's <c>SessionNum</c> and <c>SessionTime</c> — as the HUD's payload carries it
    /// for the recording's telemetry sidecar, which stores them on every frame so a moment can be found again in
    /// the sim's replay. Sent only where the sim said them, iRacing's alone, and never in demo.
    /// </summary>
    [TestFixture]
    public class SessionClockTests
    {
        private const string NumKey = "DataCorePlugin.GameRawData.Telemetry.SessionNum";
        private const string TimeKey = "DataCorePlugin.GameRawData.Telemetry.SessionTime";

        private sealed class Source : ITelemetrySource
        {
            public readonly Dictionary<string, object> Values = new Dictionary<string, object>();
            public string Game = "IRacing";
            public bool GameRunning => true;
            public string GameName => Game;
            public object NewData => new object();
            public object GetPropertyValue(string fullName) => Values.TryGetValue(fullName, out var v) ? v : null;
        }

        private static Source With(object num, object time)
        {
            var source = new Source();
            if (num != null) source.Values[NumKey] = num;
            if (time != null) source.Values[TimeKey] = time;
            return source;
        }

        [Test]
        public void TheKeysAreTheNamesSimHubGivesTheVariables()
        {
            Assert.That(TelemetryFrame.SessionNumKey, Is.EqualTo(NumKey));
            Assert.That(TelemetryFrame.SessionTimeKey, Is.EqualTo(TimeKey));
        }

        [Test]
        public void TheClockIsReadHoweverTheSourceHoldsIt()
        {
            Assert.That(TelemetryCapture.SessionNum(With(2, null)), Is.EqualTo(2));
            Assert.That(TelemetryCapture.SessionNum(With(0, null)), Is.EqualTo(0), "the first session is number 0, and is believed");
            Assert.That(TelemetryCapture.SessionNum(With(2.0, null)), Is.EqualTo(2));
            Assert.That(TelemetryCapture.SessionNum(With("3", null)), Is.EqualTo(3));
            Assert.That(TelemetryCapture.SessionTime(With(null, 1234.5678)), Is.EqualTo(1234.5678).Within(1e-9));
            Assert.That(TelemetryCapture.SessionTime(With(null, 12.5f)), Is.EqualTo(12.5).Within(1e-6));
            Assert.That(TelemetryCapture.SessionTime(With(null, "0.25")), Is.EqualTo(0.25));
            Assert.That(TelemetryCapture.SessionTime(With(null, 0)), Is.EqualTo(0.0), "the start of a session is a time too");
        }

        [Test]
        public void WhatIsNotAClockIsNotMadeOne()
        {
            Assert.That(TelemetryCapture.SessionNum(With(null, null)), Is.Null, "the sim did not say");
            Assert.That(TelemetryCapture.SessionNum(With(true, null)), Is.Null);
            Assert.That(TelemetryCapture.SessionNum(With(1.5, null)), Is.Null, "a session number is whole");
            Assert.That(TelemetryCapture.SessionNum(With(-1, null)), Is.Null);
            Assert.That(TelemetryCapture.SessionNum(With("two", null)), Is.Null);
            Assert.That(TelemetryCapture.SessionTime(With(null, null)), Is.Null);
            Assert.That(TelemetryCapture.SessionTime(With(null, double.NaN)), Is.Null);
            Assert.That(TelemetryCapture.SessionTime(With(null, -3.0)), Is.Null);
            Assert.That(TelemetryCapture.SessionTime(With(null, "soon")), Is.Null);
            Assert.That(TelemetryCapture.SessionTime(With(null, new object())), Is.Null);
        }

        [Test]
        public void OnlyIRacingsClockIsTaken()
        {
            var other = With(2, 100.0);
            other.Game = "AssettoCorsaCompetizione";
            var s = TelemetryCapture.Capture(other);
            Assert.That(s.SessionNum, Is.Null);
            Assert.That(s.SessionTime, Is.Null);

            other.Game = "IRacing";
            s = TelemetryCapture.Capture(other);
            Assert.That(s.SessionNum, Is.EqualTo(2));
            Assert.That(s.SessionTime, Is.EqualTo(100.0));
        }

        [Test]
        public void TheKeysAreSentOnlyWhereTheSimSaidAndNeverInDemo()
        {
            var said = new TelemetrySnapshot { GameRunning = true, SessionState = 4 };
            Assert.That(TelemetryFrame.BuildDict(said, demo: false).ContainsKey(NumKey), Is.False, "no key: the sim did not say");
            Assert.That(TelemetryFrame.BuildDict(said, demo: false).ContainsKey(TimeKey), Is.False);

            said.SessionNum = 2;
            said.SessionTime = 1234.5;
            var dict = TelemetryFrame.BuildDict(said, demo: false);
            Assert.That(dict[NumKey], Is.EqualTo(2));
            Assert.That(dict[TimeKey], Is.EqualTo(1234.5));

            Assert.That(TelemetryFrame.BuildDict(said, demo: true).ContainsKey(NumKey), Is.False, "a demo's clock is made up");
            Assert.That(TelemetryFrame.BuildDict(said, demo: true).ContainsKey(TimeKey), Is.False);

            said.GameRunning = false;
            Assert.That(TelemetryFrame.BuildDict(said, demo: false).ContainsKey(NumKey), Is.False, "a sim that is not running has no clock");
        }
    }
}
