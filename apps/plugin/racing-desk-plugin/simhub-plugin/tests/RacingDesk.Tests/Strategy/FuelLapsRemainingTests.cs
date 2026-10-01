using System;
using NUnit.Framework;
using RacingDesk.Plugin.Engine;
using RacingDesk.Plugin.Engine.Strategy;
using RacingDesk.Plugin.IRacing;
using RacingDesk.Tests.IRacing;

namespace RacingDesk.Tests.Strategy
{
    /// <summary>
    /// The laps of fuel left, on every path that says it — <c>DS.FuelLapsRemaining</c> (the snapshot's), the demo's and
    /// the strategist's <c>Strategy.FuelLapsRemaining</c> — is 0 until a lap has said what a lap costs, and the real
    /// number after. It was 99 on all three, which the laps panel on the iPad showed as "99.0 laps" for the whole of a
    /// session whose fuel per lap it never learnt (he asked on 2026-10-01: "The fuel in the sector area on iPad shows 99
    /// laps always"). A number that is not known is not a number.
    /// </summary>
    [TestFixture]
    public class FuelLapsRemainingTests
    {
        [Test]
        public void TheSnapshotSaysNoughtUntilTheFuelPerLapIsKnownAndTheRealLapsAfter()
        {
            var s = new TelemetrySnapshot { FuelLevel = 28.4, FuelPerLap = 0 };
            Assert.That(s.FuelLapsRemaining, Is.EqualTo(0), "no lap has said what a lap costs");
            s.FuelPerLap = 0.005;
            Assert.That(s.FuelLapsRemaining, Is.EqualTo(0), "a fuel per lap under a hundredth is noise, not a cost");
            s.FuelPerLap = 3.12;
            Assert.That(s.FuelLapsRemaining, Is.EqualTo(28.4 / 3.12).Within(1e-9));
            Assert.That(s.FuelLapsRemaining, Is.LessThan(99));
        }

        [Test]
        public void ThePitSuggestionSaysNothingWhileTheLapsAreNotKnown()
        {
            var s = new TelemetrySnapshot { FuelLevel = 28.4, FuelPerLap = 0, RemainingLaps = 8 };
            Assert.That(s.PitSuggestion, Is.EqualTo(""));
            s.FuelPerLap = 5.0;   // 5.68 laps of fuel, 8 to go
            Assert.That(s.PitSuggestion, Is.EqualTo("PIT in ~6 laps"));
            s.FuelPerLap = 3.0;   // 9.47 laps: enough
            Assert.That(s.PitSuggestion, Is.EqualTo(""));
        }

        [Test]
        public void TheDemoSaysNoughtForAnUnknownFuelPerLapToo()
        {
            // The demo's fuel per lap is a constant 2.85, so its laps are always a number; the rule is the snapshot's.
            var demo = new DemoTelemetryProvider();
            Assert.That(demo.FuelPerLap, Is.GreaterThan(0.01));
            Assert.That(demo.FuelLapsRemaining, Is.EqualTo(demo.Fuel / demo.FuelPerLap).Within(1e-9));
            Assert.That(demo.FuelLapsRemaining, Is.LessThan(99));
        }

        [Test]
        public void TheStrategistSaysNoughtBeforeItsFirstLapAndNeverCallsFuelCriticalOnIt()
        {
            var fuel = new FuelComputer();
            var stint = new StintData { StartFuel = 40 };
            var s = new TelemetrySnapshot { FuelLevel = 38.0, SessionLapsRemaining = 20, CompletedLaps = 1 };
            fuel.UpdateFrame(s);
            Assert.That(fuel.FuelLapsRemaining, Is.EqualTo(0), "before any lap of the stint");
            Assert.That(fuel.Evaluate(stint, s), Is.Null, "nothing to say with fewer than two laps");

            // Two laps timed, but the burn of each is nought (a lap under caution, a tow): the average is no burn, the
            // laps of fuel are not known, and 0 must not read as "about to run out".
            stint.LapTimes.Add(92.1);
            stint.LapTimes.Add(92.3);
            fuel.OnLapCompleted(stint, s, 0);
            fuel.OnLapCompleted(stint, s, 0);
            Assert.That(fuel.AvgBurnPerLap, Is.EqualTo(0));
            Assert.That(fuel.FuelLapsRemaining, Is.EqualTo(0));
            Assert.That(fuel.PitWindowClose, Is.EqualTo(0));
            Assert.That(fuel.Evaluate(stint, s), Is.Null, "no FUEL CRITICAL for a number that is not known");

            // A stint whose laps cost 3.2 litres each: the real laps of fuel, and the call when they are few. (The
            // average is a trimmed mean, so a lap of 3.2 after two of nought would still be nought.)
            var costed = new FuelComputer();
            var next = new StintData { StartFuel = 40 };
            next.LapTimes.Add(92.1);
            next.LapTimes.Add(92.3);
            costed.UpdateFrame(s);
            costed.OnLapCompleted(next, s, 3.2);
            costed.OnLapCompleted(next, s, 3.2);
            Assert.That(costed.AvgBurnPerLap, Is.EqualTo(3.2).Within(1e-9));
            Assert.That(costed.FuelLapsRemaining, Is.EqualTo(38.0 / 3.2).Within(1e-9));
            Assert.That(costed.FuelLapsRemaining, Is.LessThan(99));

            s.FuelLevel = 5.0;
            costed.UpdateFrame(s);
            costed.OnLapCompleted(next, s, 3.2);
            Assert.That(costed.FuelLapsRemaining, Is.EqualTo(5.0 / 3.2).Within(1e-9));
            var call = costed.Evaluate(next, s);
            Assert.That(call, Is.Not.Null, "under three laps of fuel, known: the call");
            Assert.That(call.Label, Is.EqualTo("FUEL"));
        }
    }

    /// <summary>
    /// The host's own fuel per lap (<c>IRacingTelemetrySource.FuelPerLap</c>, served as
    /// <c>DataCorePlugin.Computed.Fuel_LitersPerLap</c>) over his newest race: it is not known at the start, it is known
    /// once a green lap has been driven, and the laps of fuel it gives are a number of laps, never 99. Reads the file
    /// only; nothing of the session is printed.
    /// </summary>
    [TestFixture]
    public class FuelPerLapOnTheHostTests
    {
        [Test]
        public void TheHostLearnsTheFuelPerLapFromHisLapsAndTheLapsOfFuelAreANumber()
        {
            var race = IbtFileTests.NewestRace();
            Assume.That(race, Is.Not.Null, "no .ibt race history on this machine");
            using var ibt = new IbtFile(race.FullName);
            var raw = new IbtRawTelemetry(ibt);
            var source = new IRacingTelemetrySource(raw);

            double PerLap() => Convert.ToDouble(source.GetPropertyValue("DataCorePlugin.Computed.Fuel_LitersPerLap") ?? 0.0);

            Assert.That(raw.Seek(0), Is.True);
            source.Update();
            Assert.That(PerLap(), Is.EqualTo(0), "nothing is known at the first frame");

            // Every tenth frame (six a second) over the first quarter of the race, until a lap has been costed.
            int firstKnownAt = -1;
            int end = Math.Min(ibt.RecordCount, Math.Max(20000, ibt.RecordCount / 4));
            for (int i = 10; i < end; i += 10)
            {
                if (!raw.Seek(i)) break;
                source.Update();
                if (PerLap() > 0.01) { firstKnownAt = i; break; }
            }
            Assert.That(firstKnownAt, Is.GreaterThan(0), "a green lap off pit road says what a lap costs");

            double perLap = PerLap();
            Assert.That(perLap, Is.InRange(0.1, 25.0), "litres a lap, within what any car of his burns");
            float level = Convert.ToSingle(raw.GetValue("FuelLevel"));
            var snapshot = new TelemetrySnapshot { FuelLevel = level, FuelPerLap = perLap };
            Assert.That(snapshot.FuelLapsRemaining, Is.GreaterThan(0));
            Assert.That(snapshot.FuelLapsRemaining, Is.LessThan(99));
            Assert.That(snapshot.FuelLapsRemaining, Is.EqualTo(level / perLap).Within(1e-6));
        }
    }
}
