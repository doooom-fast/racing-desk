using System;
using System.Collections.Generic;
using System.IO;
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
            public IRacingSdkSessionInfo SessionInfo { get; set; } = SessionInfoYaml.Parse(Yaml);
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

    /// <summary>
    /// The SimHub plugin's own path, which the host's tests above do not go through: its capture reads SimHub's properties,
    /// where the fuel is in the display units (gallons for him) and iRacing's raw FuelLevel and SimHub's
    /// Fuel_LitersPerLap are litres. The laps are worked out from the two whose units are known (litres over litres), and
    /// not taken from SimHub's own Fuel_RemainingLaps, whose units for a driver in gallons nothing has checked.
    /// </summary>
    [TestFixture]
    public class FuelOnTheSimHubPathTests
    {
        private const string Raw = "DataCorePlugin.GameRawData.Telemetry.";

        private sealed class SimHubSource : ITelemetrySource
        {
            public readonly Dictionary<string, object> Values = new Dictionary<string, object>();
            public object Normalized { get; set; }
            public bool GameRunning => true;
            public string GameName => "IRacing";
            public object NewData => Normalized;
            public object GetPropertyValue(string fullName) => Values.TryGetValue(fullName, out var v) ? v : null;
        }

        // 15.3 gallons (57.9 litres) of a 65.8 % full tank, at 3.8 litres a lap; SimHub's own laps of fuel says 4.0 (what a
        // quarter of the laps looks like, if it works in the units of GameData.Fuel).
        private static SimHubSource Gallons(double perLap, double simHubLaps, bool rawLitres = true)
        {
            var source = new SimHubSource { Normalized = new { Fuel = 15.3, FuelPercent = 65.8 } };
            source.Values[Raw + "DisplayUnits"] = 0;
            if (rawLitres) source.Values[Raw + "FuelLevel"] = 57.9f;
            source.Values["DataCorePlugin.Computed.Fuel_LitersPerLap"] = perLap;
            source.Values["DataCorePlugin.Computed.Fuel_RemainingLaps"] = simHubLaps;
            return source;
        }

        [Test]
        public void ADriverInGallonsGetsLitresOverLitresNotSimHubsOwnFigure()
        {
            var s = TelemetryCapture.Capture(Gallons(perLap: 3.8, simHubLaps: 4.0));
            Assert.That(s.FuelLevel, Is.EqualTo(15.3).Within(1e-9), "SimHub's GameData.Fuel is in the display units");
            Assert.That(s.FuelLevelLitres, Is.EqualTo(57.9).Within(1e-3));
            Assert.That(s.FuelLapsRemaining, Is.EqualTo(57.9 / 3.8).Within(1e-3), "15.2 laps: the litres over the litres a lap costs");
            Assert.That(s.FuelLapsRemaining, Is.Not.EqualTo(4.0).Within(1.0), "not SimHub's figure in the other unit");
            Assert.That((double)TelemetryFrame.BuildDict(s, demo: false)["RacingDesk.Plugin.DS.FuelLapsRemaining"], Is.EqualTo(57.9 / 3.8).Within(1e-3));
        }

        [Test]
        public void NotKnownIsNoughtWhateverSimHubSays()
        {
            // The fuel per lap not yet learnt: a dash on the page, which is a 0 on the wire, also if SimHub's laps say a number.
            var s = TelemetryCapture.Capture(Gallons(perLap: 0, simHubLaps: 4.0));
            Assert.That(s.FuelLapsRemaining, Is.EqualTo(0));
            Assert.That((double)TelemetryFrame.BuildDict(s, demo: false)["RacingDesk.Plugin.DS.FuelLapsRemaining"], Is.EqualTo(0));
        }

        [Test]
        public void ASimWithNoRawLitresGetsSimHubsOwnFigure()
        {
            // Not iRacing (no FuelLevel in litres): SimHub's laps are all there is, and taken as they are.
            var s = TelemetryCapture.Capture(Gallons(perLap: 3.8, simHubLaps: 11.6, rawLitres: false));
            Assert.That(s.FuelLevelLitres, Is.EqualTo(0));
            Assert.That(s.FuelLapsRemaining, Is.EqualTo(11.6).Within(1e-9));
        }
    }

    /// <summary>
    /// What a lap costs is the car's at the circuit's. The host lives as long as the app, across sessions and cars, and
    /// kept the burn it had learnt: the next car's litres over the last car's burn were its laps of fuel from its first
    /// frame, a number where there should have been a dash.
    /// </summary>
    [TestFixture]
    public class FuelPerLapIsTheCarsTests
    {
        private const string Mx5 = @"---
WeekendInfo:
 TrackName: synthetic circuit
 TrackID: 1
 TrackDisplayName: Synthetic Circuit
 TrackConfigName: Full
 TrackLength: 4.00 km
 SubSessionID: 1001
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

        // Another car at the same circuit; the same car at another; and the same car and circuit in another session.
        private static readonly string Gt3 = Mx5.Replace("mx5 mx52016", "ferrari296gt3").Replace("Mazda MX-5", "Ferrari 296 GT3");
        private static readonly string Mx5Elsewhere = Mx5.Replace("TrackID: 1", "TrackID: 2");
        private static readonly string Mx5Later = Mx5.Replace("SubSessionID: 1001", "SubSessionID: 1002");

        private sealed class Sdk : IRawTelemetry
        {
            public readonly Dictionary<string, object> Values = new Dictionary<string, object>();
            public bool IsConnected => true;
            public IRacingSdkSessionInfo SessionInfo { get; set; }
            public object GetValue(string name) => Values.TryGetValue(name, out var v) ? v : null;
            public Sdk(string yaml)
            {
                SessionInfo = SessionInfoYaml.Parse(yaml);
                Values["IsOnTrack"] = true; Values["SessionNum"] = 0; Values["SessionTime"] = 100.0; Values["SessionState"] = 4;
                Values["Speed"] = 40f; Values["OnPitRoad"] = false; Values["DisplayUnits"] = 1;
            }
            public Sdk At(int lapCompleted, float litres)
            {
                Values["LapCompleted"] = lapCompleted; Values["Lap"] = lapCompleted + 1;
                Values["FuelLevel"] = litres; Values["FuelLevelPct"] = litres / 100f;
                return this;
            }
        }

        private static double Prop(IRacingTelemetrySource source, string name) => Convert.ToDouble(source.GetPropertyValue(name) ?? 0.0);
        private static double PerLap(IRacingTelemetrySource source) => Prop(source, "DataCorePlugin.Computed.Fuel_LitersPerLap");
        private static double Laps(IRacingTelemetrySource source) => Prop(source, "DataCorePlugin.Computed.Fuel_RemainingLaps");

        // A host that has learnt 4.0 litres a lap in the MX-5 at the synthetic circuit.
        private static (Sdk sdk, IRacingTelemetrySource source) Learnt()
        {
            var sdk = new Sdk(Mx5).At(2, 60f);
            var source = new IRacingTelemetrySource(sdk);
            source.Update();
            sdk.At(3, 56f);
            source.Update();
            Assert.That(PerLap(source), Is.EqualTo(4.0).Within(1e-4), "a green lap said what a lap costs");
            Assert.That(Laps(source), Is.EqualTo(14.0).Within(1e-3));
            return (sdk, source);
        }

        [Test]
        public void AnotherCarDoesNotGetTheLastCarsBurn()
        {
            var (sdk, source) = Learnt();
            sdk.SessionInfo = SessionInfoYaml.Parse(Gt3);
            sdk.At(0, 100f);   // the new session's first frame: the new car, a full tank
            source.Update();
            Assert.That(PerLap(source), Is.EqualTo(0), "nothing is known of the new car");
            Assert.That(Laps(source), Is.EqualTo(0), "so no laps of fuel: a dash, not 100 litres over 4");
            // A green lap of its own: known again, from its own burn.
            sdk.At(1, 92f);
            source.Update();
            Assert.That(PerLap(source), Is.EqualTo(8.0).Within(1e-4));
            Assert.That(Laps(source), Is.EqualTo(11.5).Within(1e-3));
        }

        [Test]
        public void AnotherCircuitDoesNotGetItEither()
        {
            var (sdk, source) = Learnt();
            sdk.SessionInfo = SessionInfoYaml.Parse(Mx5Elsewhere);
            sdk.At(0, 100f);
            source.Update();
            Assert.That(PerLap(source), Is.EqualTo(0));
            Assert.That(Laps(source), Is.EqualTo(0));
        }

        [Test]
        public void TheSameCarAtTheSameCircuitKeepsItAcrossSessions()
        {
            var (sdk, source) = Learnt();
            sdk.SessionInfo = SessionInfoYaml.Parse(Mx5Later);   // the next session of the weekend, or the next weekend
            sdk.Values["SessionNum"] = 1;
            sdk.At(0, 90f);
            source.Update();
            Assert.That(PerLap(source), Is.EqualTo(4.0).Within(1e-4), "the car's burn at the circuit is what it was");
            Assert.That(Laps(source), Is.EqualTo(22.5).Within(1e-3));
        }

        [Test]
        public void AFrameThatDoesNotSayWhichCarForgetsNothing()
        {
            // The session's names can be missing for a frame (a YAML read in two parts): nothing learnt is lost to it.
            var (sdk, source) = Learnt();
            sdk.SessionInfo = SessionInfoYaml.Parse(Mx5.Replace("   CarPath: mx5 mx52016\n", ""));
            sdk.At(3, 55f);
            source.Update();
            Assert.That(PerLap(source), Is.EqualTo(4.0).Within(1e-4));
            sdk.SessionInfo = SessionInfoYaml.Parse(Mx5);
            sdk.At(3, 55f);
            source.Update();
            Assert.That(PerLap(source), Is.EqualTo(4.0).Within(1e-4), "and the same car again is the same car");
        }
    }

    /// <summary>
    /// A session with no end (a practice, a test drive: no count of laps, which iRacing says as 32767, and no end in
    /// time, which it says as a week) has no flag for the strategist to make it to. It read the 32767 as laps to the
    /// finish and, with no count at all, assumed 99, so its fuel call was up in every practice once a lap had been
    /// driven: "Stop · ~N laps" over the pit box on the iPad.
    /// </summary>
    [TestFixture]
    public class NoFlagToMakeItToTests
    {
        // A stint of laps at 3.2 litres each, 38 in the tank: 11.9 laps of fuel.
        private static FuelComputer AfterTwoLaps(TelemetrySnapshot s, out StintData stint)
        {
            var fuel = new FuelComputer();
            stint = new StintData { StartFuel = 45 };
            stint.LapTimes.Add(92.1);
            stint.LapTimes.Add(92.3);
            fuel.UpdateFrame(s);
            fuel.OnLapCompleted(stint, s, 3.2);
            fuel.OnLapCompleted(stint, s, 3.2);
            return fuel;
        }

        private static TelemetrySnapshot Session(int lapsRemaining, double timeRemaining, double remainingLaps = 0) => new TelemetrySnapshot
        {
            FuelLevel = 38.0, CompletedLaps = 2, LapLastTime = 92.3, SessionLapsRemaining = lapsRemaining, SessionTimeRemain = timeRemaining, RemainingLaps = remainingLaps,
        };

        [Test]
        public void APracticeWithNoCountAndNoEndIsNotAFuelCall()
        {
            foreach (var s in new[]
            {
                Session(lapsRemaining: 32767, timeRemaining: 604800),   // iRacing's own words for a session with no end
                Session(lapsRemaining: 0, timeRemaining: 604800),
                Session(lapsRemaining: 0, timeRemaining: 0),             // nothing said at all
                Session(lapsRemaining: 32767, timeRemaining: 0, remainingLaps: 32767),
            })
            {
                var fuel = AfterTwoLaps(s, out var stint);
                string what = $"laps {s.SessionLapsRemaining}, time {s.SessionTimeRemain}";
                Assert.That(fuel.FuelHealthState, Is.EqualTo(0), what);
                Assert.That(fuel.CanMakeItToEnd, Is.True, what);
                Assert.That(fuel.PitWindowClose, Is.EqualTo(0), what);
                Assert.That(fuel.RaceLapsRemaining, Is.EqualTo(0), "no flag: no laps to it");
                Assert.That(fuel.FuelLapsRemaining, Is.EqualTo(38.0 / 3.2).Within(1e-9), "the laps of fuel are still known");
                Assert.That(fuel.Evaluate(stint, s), Is.Null, what);
            }
        }

        [Test]
        public void ARaceToALapCountOrToATimeStillMakesTheCall()
        {
            // 20 laps to go on 11.9 laps of fuel: a stop is needed, and said.
            var laps = AfterTwoLaps(Session(lapsRemaining: 20, timeRemaining: 604800), out var lapsStint);
            Assert.That(laps.RaceLapsRemaining, Is.EqualTo(20));
            Assert.That(laps.FuelHealthState, Is.EqualTo(2));
            Assert.That(laps.CanMakeItToEnd, Is.False);
            // A race to time: 30 minutes at 92.3 s a lap is 19.5 laps, and the 32767 of its count of laps is no count.
            var timed = AfterTwoLaps(Session(lapsRemaining: 32767, timeRemaining: 1800), out var timedStint);
            Assert.That(timed.RaceLapsRemaining, Is.EqualTo(1800 / 92.3).Within(1e-9));
            Assert.That(timed.FuelHealthState, Is.EqualTo(2));
            // A 24-hour race is a race to a time: its day is not "no end".
            var endurance = AfterTwoLaps(Session(lapsRemaining: 32767, timeRemaining: 86400), out var enduranceStint);
            Assert.That(endurance.RaceLapsRemaining, Is.EqualTo(86400 / 92.3).Within(1e-9));
        }

        private sealed class RawSource : ITelemetrySource
        {
            public readonly Dictionary<string, object> Values = new Dictionary<string, object>();
            public bool GameRunning => true;
            public string GameName => "IRacing";
            public object NewData { get; } = new { Fuel = 38.0 };
            public object GetPropertyValue(string fullName) => Values.TryGetValue(fullName, out var v) ? v : null;
        }

        [Test]
        public void CaptureTakesIRacings32767ForNoCountOfLaps()
        {
            var source = new RawSource();
            source.Values["DataCorePlugin.GameRawData.Telemetry.SessionLapsRemainEx"] = 32767;
            Assert.That(TelemetryCapture.Capture(source).SessionLapsRemaining, Is.EqualTo(0), "no count, not 32767 laps to go");
            source.Values["DataCorePlugin.GameRawData.Telemetry.SessionLapsRemainEx"] = 14;
            Assert.That(TelemetryCapture.Capture(source).SessionLapsRemaining, Is.EqualTo(14));
            source.Values["DataCorePlugin.GameRawData.Telemetry.SessionLapsRemainEx"] = 0;
            source.Values["DataCorePlugin.GameData.RemainingLaps"] = 32767.0;
            Assert.That(TelemetryCapture.Capture(source).SessionLapsRemaining, Is.EqualTo(0), "SimHub's, from the other path, the same");
        }

        /// <summary>
        /// Over his own newest test drive, which has no end: the strategist, fed what the host reads of it, never says the
        /// fuel is critical or calls a stop. (Read only; nothing of the session is printed.)
        /// </summary>
        [Test]
        public void HisNewestTestDriveNeverMakesAFuelCall()
        {
            FileInfo file = null;
            foreach (var f in IbtFileTests.NewestIbt(300))
            {
                if (f.Length < 3_000_000) continue;
                try
                {
                    using var probe = new IbtFile(f.FullName);
                    if (probe.SessionInfo?.WeekendInfo?.EventType == "Test" && probe.LapCount >= 6) { file = f; break; }
                }
                catch { /* try the next one */ }
            }
            Assume.That(file, Is.Not.Null, "no test drive of six laps in the history on this machine");

            using var ibt = new IbtFile(file.FullName);
            var raw = new IbtRawTelemetry(ibt);
            var source = new IRacingTelemetrySource(raw);
            var coordinator = new StrategyCoordinator();
            TelemetrySnapshot previous = null;
            int frames = 0, withBurn = 0, state2 = 0, calls = 0;
            double longestTime = 0;
            const int step = 10;   // six frames a second
            for (int i = 0; i < ibt.RecordCount; i += step)
            {
                if (!raw.Seek(i)) break;
                source.Update();
                var s = TelemetryCapture.Capture(source);
                coordinator.Update(s, previous);
                previous = s;
                frames++;
                longestTime = Math.Max(longestTime, s.SessionTimeRemain);
                if (coordinator.Fuel.AvgBurnPerLap > 0.01) withBurn++;
                if (coordinator.Fuel.FuelHealthState == 2) state2++;
                if (coordinator.IsVisible && coordinator.CurrentLabel == "FUEL") calls++;
            }
            Assume.That(withBurn, Is.GreaterThan(0), "no lap of the test drive was costed, so there is nothing to ask of the strategist");
            Assert.That(state2, Is.EqualTo(0), $"fuel critical in {state2} of {frames} frames of a session with no end (time remaining read up to {longestTime:F0} s)");
            Assert.That(calls, Is.EqualTo(0), "a fuel call in a session with no end");
        }
    }
}
