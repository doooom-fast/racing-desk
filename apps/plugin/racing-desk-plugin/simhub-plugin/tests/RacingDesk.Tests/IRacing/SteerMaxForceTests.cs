using System.Collections.Generic;
using System.IO;
using System.Linq;
using NUnit.Framework;
using RacingDesk.Plugin.Engine;
using RacingDesk.Plugin.IRacing;
using RacingDesk.Plugin.Transport;

namespace RacingDesk.Tests.IRacing
{
    /// <summary>
    /// The wheel's full-output force, for the HUD's datastream: iRacing's own <c>SteeringWheelMaxForceNm</c> (the
    /// strength slider in Nm, set per car), sent as <c>RacingDesk.Plugin.DS.SteerMaxForceNm</c> only where the sim
    /// says it, and never in demo. Nothing is read from the wheel base for it, and the HUD shows a dash without it.
    /// </summary>
    [TestFixture]
    public class SteerMaxForceTests
    {
        private const string Variable = "DataCorePlugin.GameRawData.Telemetry.SteeringWheelMaxForceNm";
        private const string Key = "RacingDesk.Plugin.DS.SteerMaxForceNm";

        private sealed class Source : ITelemetrySource
        {
            public readonly Dictionary<string, object> Values = new Dictionary<string, object>();
            public string Game = "IRacing";
            public bool GameRunning => true;
            public string GameName => Game;
            public object NewData => new object();
            public object GetPropertyValue(string fullName) => Values.TryGetValue(fullName, out var v) ? v : null;
            public string OpponentName(object opponent) => null;
        }

        private static double? Read(object value)
        {
            var source = new Source();
            if (value != null) source.Values[Variable] = value;
            return TelemetryCapture.SteeringWheelMaxForceNm(source);
        }

        [Test]
        public void TheVariableAndTheKeyAreNamed()
        {
            Assert.That(TelemetryFrame.SteerMaxForceNmVariable, Is.EqualTo(Variable), "the name SimHub gives iRacing's variable");
            Assert.That(TelemetryFrame.SteerMaxForceNmKey, Is.EqualTo(Key));
        }

        [Test]
        public void TheForceIsReadHoweverTheSourceHoldsIt()
        {
            Assert.That(Read(29.7f), Is.EqualTo(29.7f).Within(1e-6));
            Assert.That(Read(36.05), Is.EqualTo(36.05));
            Assert.That(Read("27.3"), Is.EqualTo(27.3));
            Assert.That(Read(21), Is.EqualTo(21));
        }

        [Test]
        public void WhatIsNotAForceIsNotMadeOne()
        {
            Assert.That(Read(null), Is.Null, "the sim did not say");
            Assert.That(Read(0f), Is.Null, "no wheel is driven to nothing: the variable absent, or a frame of nothing");
            Assert.That(Read(-5), Is.Null);
            Assert.That(Read(double.NaN), Is.Null);
            Assert.That(Read(true), Is.Null);
            Assert.That(Read("strong"), Is.Null);
            Assert.That(Read(new object()), Is.Null);
        }

        [Test]
        public void OnlyIRacingsIsTaken()
        {
            var source = new Source { Game = "AssettoCorsaCompetizione" };
            source.Values[Variable] = 29.7f;
            Assert.That(TelemetryCapture.Capture(source).SteeringWheelMaxForceNm, Is.Null, "another sim's wheel is not read by iRacing's name");

            source.Game = "IRacing";
            Assert.That(TelemetryCapture.Capture(source).SteeringWheelMaxForceNm, Is.EqualTo(29.7f).Within(1e-6));

            source.Values.Remove(Variable);
            Assert.That(TelemetryCapture.Capture(source).SteeringWheelMaxForceNm, Is.Null, "iRacing not saying it: nothing is sent");
        }

        [Test]
        public void TheKeyIsSentOnlyWhereTheSimSaid()
        {
            var said = new TelemetrySnapshot { GameRunning = true, SessionState = 4 };
            Assert.That(TelemetryFrame.BuildDict(said, demo: false).ContainsKey(Key), Is.False, "no force: no key, and none made up");

            said.SteeringWheelMaxForceNm = 29.7;
            var dict = TelemetryFrame.BuildDict(said, demo: false);
            Assert.That(dict.ContainsKey(Key), Is.True);
            Assert.That(dict[Key], Is.EqualTo(29.7));
            Assert.That(dict.ContainsKey("RacingDesk.Plugin.DS.SteerTorque"), Is.True, "beside the live torque, which is as it was");

            Assert.That(TelemetryFrame.BuildDict(said, demo: true).ContainsKey(Key), Is.False, "the demo has no wheel");
            said.GameRunning = false;
            Assert.That(TelemetryFrame.BuildDict(said, demo: false).ContainsKey(Key), Is.False, "a sim that is not running says nothing");
        }

        [Test]
        public void TheHostsReaderCarriesTheSimsOwnNumber()
        {
            // The rig's newest recording of a car, through the host's reader: the number the sim wrote, between what a
            // wheel can do. Skipped on a machine with no recordings. Nothing of the recording is kept or printed.
            var recording = IbtFileTests.NewestIbt(20).FirstOrDefault(f => f.Length > 2_000_000);
            Assume.That(recording, Is.Not.Null, "no recording on this machine");
            using var file = new IbtFile(recording.FullName);
            var raw = new IbtRawTelemetry(file);
            var source = new IRacingTelemetrySource(raw);
            Assume.That(raw.Seek(file.RecordCount / 2), Is.True);
            source.Update();

            double? sim = TelemetryCapture.SteeringWheelMaxForceNm(source);
            Assume.That(sim, Is.Not.Null, "a recording from before the sim wrote the variable");
            Assert.That(sim.Value, Is.InRange(1, 100), "newton-metres, the strength slider");
            Assert.That(TelemetryCapture.Capture(source).SteeringWheelMaxForceNm, Is.EqualTo(sim));
            Assert.That(TelemetryCapture.Capture(source).SteeringWheelTorque, Is.Not.NaN);
        }
    }
}
