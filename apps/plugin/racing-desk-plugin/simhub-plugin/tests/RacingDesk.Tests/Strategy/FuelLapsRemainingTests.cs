using System;
using System.Collections.Generic;
using IRSDKSharper;
using NUnit.Framework;
using RacingDesk.Plugin.Engine;
using RacingDesk.Plugin.Engine.Strategy;
using RacingDesk.Plugin.IRacing;
using RacingDesk.Plugin.Transport;
using RacingDesk.Tests.IRacing;

namespace RacingDesk.Tests.Strategy
{
    /// <summary>
    /// The laps of fuel left, on every path that says it — <c>DS.FuelLapsRemaining</c> (the snapshot's), the demo's and
    /// the strategist's <c>Strategy.FuelLapsRemaining</c> — is 0 until a lap has said what a lap costs, and the real
    /// number after. It was 99 on all three, which the laps panel on the iPad showed as "99.0 laps" for the whole of a
    /// session whose fuel per lap it never learnt (he asked on 2026-10-01: "The fuel in the sector area on iPad shows 99
    /// laps always"). A number that is not known is not a number. Once known it is SimHub's (or the host's) own laps of
    /// fuel, worked out in one unit: the snapshot's fuel is in the display units (gallons for him) and the fuel per lap is
    /// not, so the one over the other was a quarter of the laps.
    /// </summary>
    [TestFixture]
    public class FuelLapsRemainingTests
    {
        [Test]
        public void TheSnapshotSaysNoughtUntilTheLapsAreKnownAndSimHubsOwnLapsAfter()
        {
            var s = new TelemetrySnapshot { FuelLevel = 28.4, FuelPerLap = 0, FuelLapsComputed = 0, DisplayUnits = 1 };
            Assert.That(s.FuelLapsRemaining, Is.EqualTo(0), "no lap has said what a lap costs");
            s.FuelLapsComputed = double.NaN;
            Assert.That(s.FuelLapsRemaining, Is.EqualTo(0), "not a number is not laps");
            s.FuelLapsComputed = double.PositiveInfinity;
            Assert.That(s.FuelLapsRemaining, Is.EqualTo(0));
            s.FuelPerLap = 3.12;
            s.FuelLapsComputed = 28.4 / 3.12;
            Assert.That(s.FuelLapsRemaining, Is.EqualTo(28.4 / 3.12).Within(1e-9));
            Assert.That(s.FuelLapsRemaining, Is.LessThan(99));
        }

        [Test]
        public void ADriverInGallonsGetsTheLapsTheFuelLasts()
        {
            // 15.3 gallons (57.9 litres) in the tank, the fuel per lap in litres as Fuel_LitersPerLap is: the laps are the
            // engine's own, litres over litres (15.2), not 15.3 / 3.8 (4.0), which is what the snapshot said.
            var s = new TelemetrySnapshot { DisplayUnits = 0, FuelLevel = 15.3, FuelLevelLitres = 57.9, FuelPerLap = 3.8, FuelLapsComputed = 57.9 / 3.8 };
            Assert.That(s.FuelLapsRemaining, Is.EqualTo(57.9 / 3.8).Within(1e-9));
            Assert.That(s.FuelLapsRemaining, Is.Not.EqualTo(15.3 / 3.8).Within(0.5));
            s.FuelLapsComputed = 0;
            Assert.That(s.FuelLapsRemaining, Is.EqualTo(0), "it is not worked out from FuelLevel / FuelPerLap, in two units");
        }

        [Test]
        public void TheFuelAndTheTankAreInTheDisplayUnitsOnce()
        {
            // In gallons: the litres the sim says, shown in gallons once (it showed FuelLevel, already gallons, made gallons
            // again: 4.0 for 15.3), and the tank the litres over the fraction of it they are (FuelPercent is 0-100; taken
            // as a fraction it made the tank the fuel in it).
            var gal = new TelemetrySnapshot { DisplayUnits = 0, FuelLevel = 15.3, FuelLevelLitres = 57.9, FuelPercent = 65.8 };
            Assert.That(gal.FuelFormatted, Is.EqualTo((57.9 * 0.264172).ToString("F1")));
            Assert.That(gal.FuelFormatted, Is.EqualTo(15.3.ToString("F1")));
            Assert.That(gal.MaxFuelLitres, Is.EqualTo(57.9 / 0.658).Within(1e-6));

            var litres = new TelemetrySnapshot { DisplayUnits = 1, FuelLevel = 57.9, FuelLevelLitres = 57.9, FuelPercent = 65.8 };
            Assert.That(litres.FuelFormatted, Is.EqualTo(57.9.ToString("F1")));
            Assert.That(litres.MaxFuelLitres, Is.EqualTo(57.9 / 0.658).Within(1e-6));

            // A sim that does not say its litres: the fuel as it is (in the display units), the tank in litres from it.
            var noRaw = new TelemetrySnapshot { DisplayUnits = 0, FuelLevel = 15.3, FuelPercent = 50 };
            Assert.That(noRaw.FuelFormatted, Is.EqualTo(15.3.ToString("F1")));
            Assert.That(noRaw.MaxFuelLitres, Is.EqualTo(15.3 / 0.264172 / 0.5).Within(1e-6));

            Assert.That(new TelemetrySnapshot { FuelLevel = 0, FuelPercent = 0 }.FuelFormatted, Is.EqualTo("—"));
            Assert.That(new TelemetrySnapshot { FuelLevelLitres = 10, FuelPercent = 0 }.MaxFuelLitres, Is.EqualTo(0), "no fraction, no tank");

            // On the wire: the tank in litres, which the page shows in the display units.
            var dict = TelemetryFrame.BuildDict(gal, demo: false);
            Assert.That((double)dict["DataCorePlugin.GameData.MaxFuel"], Is.EqualTo(57.9 / 0.658).Within(1e-6));
            Assert.That((double)dict["DataCorePlugin.GameData.MaxFuel"], Is.Not.EqualTo(15.3).Within(1), "not the fuel in it");
        }

        [Test]
        public void ThePitSuggestionSaysNothingWhileTheLapsAreNotKnown()
        {
            var s = new TelemetrySnapshot { FuelLevel = 28.4, FuelPerLap = 0, RemainingLaps = 8 };
            Assert.That(s.PitSuggestion, Is.EqualTo(""));
            s.FuelLapsComputed = 5.68;   // 8 to go
            Assert.That(s.PitSuggestion, Is.EqualTo("PIT in ~6 laps"));
            s.FuelLapsComputed = 9.47;   // enough
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
    /// The host's fuel: what it learns a lap costs (<c>Computed.Fuel_LitersPerLap</c>, litres, from iRacing's own litres),
    /// the laps that lasts (<c>Computed.Fuel_RemainingLaps</c>, litres over litres, whatever the display units), and the
    /// session's laps to go (<c>GameData.RemainingLaps</c>, which is SimHub's word for those, not for the laps of fuel the
    /// host said there: the laps panel's "to go" and the clock's laps were the laps of fuel).
    /// </summary>
    [TestFixture]
    public class FuelOnTheHostTests
    {
        // A session of nobody's: the fixtures' customer id, a made-up circuit.
        private const string Yaml = @"---
WeekendInfo:
 TrackName: synthetic circuit
 TrackID: 1
 TrackDisplayName: Synthetic Circuit
 TrackConfigName: Full
 TrackLength: 4.00 km
 WeekendOptions:
  IsFixedSetup: 0
DriverInfo:
 DriverCarIdx: 0
 DriverCarRedLine: 7200.000
 Drivers:
 - CarIdx: 0
   UserName: Test Driver
   UserID: 424242
   CarPath: mx5 mx52016
   CarScreenName: Mazda MX-5
   IRating: 1500
   LicString: A 2.00
SessionInfo:
 Sessions:
 - SessionNum: 0
   SessionType: Race
";

        private sealed class FakeSdk : IRawTelemetry
        {
            public readonly Dictionary<string, object> Values = new Dictionary<string, object>();
            public bool IsConnected => true;
            public IRacingSdkSessionInfo SessionInfo { get; } = SessionInfoYaml.Parse(Yaml);
            public object GetValue(string name) => Values.TryGetValue(name, out var v) ? v : null;

            public FakeSdk(int displayUnits)
            {
                Values["IsOnTrack"] = true;
                Values["SessionNum"] = 0;
                Values["SessionTime"] = 100.0;
                Values["SessionState"] = 4;
                Values["Speed"] = 40f;
                Values["OnPitRoad"] = false;
                Values["DisplayUnits"] = displayUnits;
            }

            /// <summary>A frame: the lap he has completed, the litres in the tank, and the fraction of the tank they are.</summary>
            public FakeSdk At(int lapCompleted, float litres, float pct)
            {
                Values["LapCompleted"] = lapCompleted;
                Values["Lap"] = lapCompleted + 1;
                Values["FuelLevel"] = litres;
                Values["FuelLevelPct"] = pct;
                return this;
            }
        }

        private static double Prop(IRacingTelemetrySource source, string name) => Convert.ToDouble(source.GetPropertyValue(name) ?? 0.0);

        [Test]
        public void TheLapsOfFuelAreLitresOverLitresForADriverInGallons()
        {
            var sdk = new FakeSdk(displayUnits: 0).At(2, 61.7f, 0.70f);
            sdk.Values["SessionLapsRemainEx"] = 20;
            var source = new IRacingTelemetrySource(sdk);
            source.Update();
            Assert.That(Prop(source, "DataCorePlugin.Computed.Fuel_LitersPerLap"), Is.EqualTo(0), "no lap costed yet");
            Assert.That(Prop(source, "DataCorePlugin.Computed.Fuel_RemainingLaps"), Is.EqualTo(0), "not known: nought");
            var before = TelemetryCapture.Capture(source);
            Assert.That(before.FuelLapsRemaining, Is.EqualTo(0));
            Assert.That((double)TelemetryFrame.BuildDict(before, demo: false)["RacingDesk.Plugin.DS.FuelLapsRemaining"], Is.EqualTo(0), "the wire says nought, not 99");

            // A green lap of 3.8 litres.
            sdk.At(3, 57.9f, 0.658f);
            sdk.Values["SessionLapsRemainEx"] = 19;
            source.Update();
            Assert.That(Prop(source, "DataCorePlugin.Computed.Fuel_LitersPerLap"), Is.EqualTo(3.8).Within(1e-4));
            Assert.That(Prop(source, "DataCorePlugin.Computed.Fuel_RemainingLaps"), Is.EqualTo(57.9 / 3.8).Within(1e-3));

            var s = TelemetryCapture.Capture(source);
            Assert.That(s.FuelLevel, Is.EqualTo(57.9 * 0.264172).Within(1e-3), "the normalized fuel is in gallons, as SimHub's");
            Assert.That(s.FuelLevelLitres, Is.EqualTo(57.9).Within(1e-3));
            Assert.That(s.FuelLapsRemaining, Is.EqualTo(57.9 / 3.8).Within(1e-3), "15.2 laps, not 15.3 gallons over 3.8 litres (4.0)");
            Assert.That(s.FuelFormatted, Is.EqualTo((57.9 * 0.264172).ToString("F1")), "the fuel in gallons, once");
            Assert.That(s.RemainingLaps, Is.EqualTo(19), "the laps to go, not the laps of fuel");

            var dict = TelemetryFrame.BuildDict(s, demo: false);
            Assert.That((double)dict["RacingDesk.Plugin.DS.FuelLapsRemaining"], Is.EqualTo(57.9 / 3.8).Within(1e-3));
            Assert.That((double)dict["DataCorePlugin.GameData.RemainingLaps"], Is.EqualTo(19));
            Assert.That((double)dict["DataCorePlugin.GameData.MaxFuel"], Is.EqualTo(57.9 / 0.658).Within(0.01), "the tank, in litres");
        }

        [Test]
        public void TheLapsToGoAreTheSessionsAndNoughtWhereItHasNoCount()
        {
            var sdk = new FakeSdk(displayUnits: 1).At(2, 40f, 0.5f);
            var source = new IRacingTelemetrySource(sdk);
            sdk.Values["SessionLapsRemainEx"] = 8;
            source.Update();
            Assert.That(Prop(source, "DataCorePlugin.GameData.RemainingLaps"), Is.EqualTo(8));
            sdk.Values["SessionLapsRemainEx"] = 32767;   // iRacing's "unlimited": a session run to time, a practice
            source.Update();
            Assert.That(Prop(source, "DataCorePlugin.GameData.RemainingLaps"), Is.EqualTo(0));
            sdk.Values.Remove("SessionLapsRemainEx");
            source.Update();
            Assert.That(Prop(source, "DataCorePlugin.GameData.RemainingLaps"), Is.EqualTo(0));
        }

        /// <summary>
        /// Over his newest race (read only; nothing of the session is printed): not known at the start, known once a
        /// green lap has been driven, and the laps of fuel it gives are a number of laps, never 99.
        /// </summary>
        [Test]
        public void TheHostLearnsTheFuelPerLapFromHisLapsAndTheLapsOfFuelAreANumber()
        {
            var race = IbtFileTests.NewestRace();
            Assume.That(race, Is.Not.Null, "no .ibt race history on this machine");
            using var ibt = new IbtFile(race.FullName);
            var raw = new IbtRawTelemetry(ibt);
            var source = new IRacingTelemetrySource(raw);

            double PerLap() => Prop(source, "DataCorePlugin.Computed.Fuel_LitersPerLap");

            Assert.That(raw.Seek(0), Is.True);
            source.Update();
            Assert.That(PerLap(), Is.EqualTo(0), "nothing is known at the first frame");
            Assert.That(Prop(source, "DataCorePlugin.Computed.Fuel_RemainingLaps"), Is.EqualTo(0));

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
            float litres = Convert.ToSingle(raw.GetValue("FuelLevel"));
            double laps = Prop(source, "DataCorePlugin.Computed.Fuel_RemainingLaps");
            Assert.That(laps, Is.EqualTo(litres / perLap).Within(1e-6), "litres over litres");
            Assert.That(laps, Is.GreaterThan(0));
            Assert.That(laps, Is.LessThan(99));
            var s = TelemetryCapture.Capture(source);
            Assert.That(s.FuelLapsRemaining, Is.EqualTo(laps).Within(1e-6), "the snapshot says the host's own laps, whatever his display units");
        }
    }
}
