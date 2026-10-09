using System;
using System.Globalization;
using System.Reflection;
using System.Text;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using RacingDesk.Plugin;

namespace RacingDesk.Tests.Runtime
{
    /// <summary>
    /// He said on 2026-10-09, of Assetto Corsa through SimHub: "It shows one frame of data and nothing else". A number
    /// that is not finite (NaN, Infinity), written as it is, made the whole telemetry answer something no JSON reader
    /// takes, and the HUD kept the one frame it had read before it. Such a number is null on the wire.
    /// </summary>
    [TestFixture]
    public class AnswerNumbersTests
    {
        private static string Write(double value)
        {
            var jp = typeof(RacingDeskRuntime).GetMethod("Jp", BindingFlags.NonPublic | BindingFlags.Static, null,
                new[] { typeof(StringBuilder), typeof(string), typeof(double), typeof(CultureInfo) }, null);
            Assert.That(jp, Is.Not.Null, "the answer's number writer");
            var sb = new StringBuilder();
            jp.Invoke(null, new object[] { sb, "RacingDesk.Plugin.Test", value, CultureInfo.InvariantCulture });
            return sb.ToString();
        }

        private static JToken Read(string written) => JObject.Parse("{" + written.TrimEnd('\n', ',') + "}")["RacingDesk.Plugin.Test"];

        [TestCase(double.NaN)]
        [TestCase(double.PositiveInfinity)]
        [TestCase(double.NegativeInfinity)]
        public void ANumberThatIsNotFiniteIsNullAndTheAnswerStaysReadable(double value)
        {
            var token = Read(Write(value));
            Assert.That(token.Type, Is.EqualTo(JTokenType.Null));
        }

        [Test]
        public void AFiniteNumberIsWrittenAsBefore()
        {
            Assert.That(Read(Write(12.5)).Value<double>(), Is.EqualTo(12.5));
            Assert.That(Read(Write(-0.001)).Value<double>(), Is.EqualTo(-0.001));
        }
    }
}
