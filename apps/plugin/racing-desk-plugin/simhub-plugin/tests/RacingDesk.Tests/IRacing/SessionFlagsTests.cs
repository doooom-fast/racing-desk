using System.Collections.Generic;
using NUnit.Framework;
using RacingDesk.Plugin.Engine;
using RacingDesk.Plugin.Transport;

namespace RacingDesk.Tests.IRacing
{
    /// <summary>
    /// iRacing's own flag field, as the HUD is sent it: the whole bitmask, so that a local yellow can be told from a
    /// full-course caution and "one to green", ten and five to go, halfway, green held, the black flag furled,
    /// disqualified and the start lights can be said at all. It is sent only where the sim said it, and the one word
    /// <c>currentFlagState</c> is exactly what it was.
    /// </summary>
    [TestFixture]
    public class SessionFlagsTests
    {
        private const string Key = "DataCorePlugin.GameRawData.Telemetry.SessionFlags";

        private sealed class Source : ITelemetrySource
        {
            public readonly Dictionary<string, object> Values = new Dictionary<string, object>();
            public string Game = "IRacing";
            public bool GameRunning => true;
            public string GameName => Game;
            public object NewData => new object();
            public object GetPropertyValue(string fullName) => Values.TryGetValue(fullName, out var v) ? v : null;
        }

        private static uint? Raw(object value)
        {
            var source = new Source();
            if (value != null) source.Values[Key] = value;
            return TelemetryCapture.SessionFlagsRaw(source);
        }

        [Test]
        public void TheKeyIsTheNameSimHubGivesTheVariable()
        {
            Assert.That(TelemetryFrame.SessionFlagsKey, Is.EqualTo(Key));
        }

        [Test]
        public void TheFieldIsReadWholeHoweverTheSourceHoldsIt()
        {
            // The SDK and SimHub give a bitfield as a signed int; the start lights are its top nibble.
            Assert.That(Raw(0x4008), Is.EqualTo(0x4008u));
            Assert.That(Raw(0), Is.EqualTo(0u), "no flag out is a number too, and is believed");
            Assert.That(Raw(0x0000_0208u), Is.EqualTo(0x208u));
            Assert.That(Raw(unchecked((int)0x8000_0004)), Is.EqualTo(0x8000_0004u), "startGo with the green flag: the sign bit is a flag");
            Assert.That(Raw(0x8000_0004u), Is.EqualTo(0x8000_0004u));
            Assert.That(Raw(0x8000_0004L), Is.EqualTo(0x8000_0004u));
            Assert.That(Raw(4.0), Is.EqualTo(4u));
            Assert.That(Raw("4"), Is.EqualTo(4u));
            Assert.That(Raw(unchecked((int)0xF000_0000)), Is.EqualTo(0xF000_0000u));
        }

        [Test]
        public void WhatIsNotAFlagFieldIsNotMadeOneOf()
        {
            Assert.That(Raw(null), Is.Null, "the sim did not say");
            Assert.That(Raw(true), Is.Null, "a boolean is not a bitmask");
            Assert.That(Raw(1.5), Is.Null);
            Assert.That(Raw(double.NaN), Is.Null);
            Assert.That(Raw("yellow"), Is.Null);
            Assert.That(Raw(""), Is.Null);
            Assert.That(Raw(4294967296L), Is.Null, "wider than the field");
            Assert.That(Raw(-2147483649L), Is.Null);
            Assert.That(Raw(new object()), Is.Null);
        }

        [Test]
        public void OnlyIRacingsFieldIsTaken()
        {
            var source = new Source { Game = "AssettoCorsaCompetizione" };
            source.Values[Key] = 0x8;
            Assert.That(TelemetryCapture.Capture(source).SessionFlagsRaw, Is.Null, "another sim's flags are mapped onto the word, and have nothing to add");

            source.Game = "IRacing";
            Assert.That(TelemetryCapture.Capture(source).SessionFlagsRaw, Is.EqualTo(0x8u));

            source.Values.Remove(Key);
            Assert.That(TelemetryCapture.Capture(source).SessionFlagsRaw, Is.Null, "iRacing not saying it: nothing is sent");
        }

        [Test]
        public void TheKeyIsSentOnlyWhereTheSimSaid()
        {
            var said = new TelemetrySnapshot { GameRunning = true, SessionState = 4 };
            Assert.That(TelemetryFrame.BuildDict(said, demo: false).ContainsKey(Key), Is.False, "no field: no key, and none made up");

            said.SessionFlagsRaw = 0x0000_4208;
            var dict = TelemetryFrame.BuildDict(said, demo: false);
            Assert.That(dict.ContainsKey(Key), Is.True);
            Assert.That(dict[Key], Is.InstanceOf<long>(), "a number the HUD can read, never text");
            Assert.That((long)dict[Key], Is.EqualTo(0x4208L));

            said.SessionFlagsRaw = 0x8000_0004;
            Assert.That((long)TelemetryFrame.BuildDict(said, demo: false)[Key], Is.EqualTo(0x8000_0004L), "the start lights' bit is not turned into a negative number");

            said.SessionFlagsRaw = 0;
            Assert.That((long)TelemetryFrame.BuildDict(said, demo: false)[Key], Is.EqualTo(0L), "nothing out is what the sim said");

            Assert.That(TelemetryFrame.BuildDict(said, demo: true).ContainsKey(Key), Is.False, "a demo's flags are made up");
            said.GameRunning = false;
            Assert.That(TelemetryFrame.BuildDict(said, demo: false).ContainsKey(Key), Is.False, "a sim that is not running says nothing");
        }

        private static string Word(TelemetrySnapshot s, bool demo = false)
            => (string)TelemetryFrame.BuildDict(s, demo)["currentFlagState"];

        [Test]
        public void TheFlagWordIsWhatItWas()
        {
            // A local yellow and a full-course caution are both "yellow" in the word, as they always were: the field is
            // what tells them apart. Sending the field changes nothing the word says.
            foreach (var (flags, word) in new[]
            {
                (0x0008, "yellow"), (0x0100, "none"), (0x0008 | 0x0100, "yellow"), (0x4000, "yellow"), (0x8000, "yellow"),
                (0x4000 | 0x0200, "yellow"), (0x0004, "green"), (0x0004 | 0x0400, "green"), (0x0002, "white"),
                (0x0001, "checkered"), (0x0020, "blue"), (0x0040, "debris"), (0x0010, "red"), (0x10000, "black"),
                (0x100000, "meatball"), (0x0800, "none"), (0x1000, "none"), (0x0080, "none"), (0x80000, "none"),
                (0x20000, "none"), (0x0010 | 0x0008, "red"),
            })
            {
                var without = new TelemetrySnapshot { GameRunning = true, SessionFlags = flags };
                var with = new TelemetrySnapshot { GameRunning = true, SessionFlags = flags, SessionFlagsRaw = (uint)flags };
                Assert.That(Word(without), Is.EqualTo(word), $"0x{flags:X}");
                Assert.That(Word(with), Is.EqualTo(word), $"0x{flags:X}, with the field sent");
            }
        }
    }
}
