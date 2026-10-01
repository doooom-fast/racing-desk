using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using IRSDKSharper;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Newtonsoft.Json.Serialization;
using NUnit.Framework;
using RacingDesk.Plugin;
using RacingDesk.Plugin.Engine;
using RacingDesk.Plugin.Engine.Strategy;
using RacingDesk.Plugin.IRacing;
using RacingDesk.Plugin.Models;
using RacingDesk.Plugin.Transport;

namespace RacingDesk.Tests.IRacing
{
    /// <summary>
    /// Tyre wear has one meaning, on the wire and in the code: tread remaining, per corner, 0..100 %, 100 = new,
    /// null where the sim has not measured it (Engine/TyreWear.cs; root CLAUDE.md, Tyre wear). It is converted
    /// once at each source and nowhere else, and every warning fires at the worn end. These tests hold the whole
    /// chain — a raw SDK value through the host's source to the wire, SimHub's property through the plugin's
    /// capture, the commentary trigger, the strategist, the demo — so that a flip anywhere along it, in either
    /// direction, fails here: new tyres read 100 and warn nowhere, worn tyres read low and warn everywhere.
    /// </summary>
    [TestFixture]
    public class TyreWearTests
    {
        private const string FL = "DataCorePlugin.GameData.TyreWearFrontLeft";
        private const string FR = "DataCorePlugin.GameData.TyreWearFrontRight";
        private const string RL = "DataCorePlugin.GameData.TyreWearRearLeft";
        private const string RR = "DataCorePlugin.GameData.TyreWearRearRight";

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
SplitTimeInfo:
 Sectors:
 - SectorNum: 0
   SectorStartPct: 0.000000
 - SectorNum: 1
   SectorStartPct: 0.500000
";

        /// <summary>iRacing's SDK as the host reads it: variables by name, a session, the three tread bands per corner.</summary>
        private sealed class FakeSdk : IRawTelemetry
        {
            public readonly Dictionary<string, object> Values = new Dictionary<string, object>();
            public bool IsConnected => true;
            public IRacingSdkSessionInfo SessionInfo { get; } = SessionInfoYaml.Parse(Yaml);
            public object GetValue(string name) => Values.TryGetValue(name, out var v) ? v : null;

            public FakeSdk()
            {
                Values["IsOnTrack"] = true;
                Values["SessionNum"] = 0;
                Values["SessionTime"] = 100.0;
                Values["SessionState"] = 4;
                Values["Lap"] = 3;
                Values["LapCompleted"] = 2;
                Values["Speed"] = 40f;
            }

            /// <summary>The sim's three bands for a corner, each a fraction remaining (1 = new).</summary>
            public FakeSdk Bands(string corner, float left, float middle, float right)
            {
                Values[corner + "wearL"] = left;
                Values[corner + "wearM"] = middle;
                Values[corner + "wearR"] = right;
                return this;
            }

            public FakeSdk NewTyres()
            {
                foreach (var c in new[] { "LF", "RF", "LR", "RR" }) Bands(c, 1f, 1f, 1f);
                return this;
            }
        }

        /// <summary>SimHub, as the plugin's capture sees it: its own GameData object and its property bag.</summary>
        private sealed class FakeSimHub : ITelemetrySource
        {
            public sealed class GameData
            {
                public double TyreWearFrontLeft { get; set; }
                public double TyreWearFrontRight { get; set; }
                public double TyreWearRearLeft { get; set; }
                public double TyreWearRearRight { get; set; }
            }

            public readonly GameData Data = new GameData();
            public readonly Dictionary<string, object> Props = new Dictionary<string, object>();
            public bool GameRunning => true;
            public string GameName => "IRacing";
            public object NewData => Data;
            public object GetPropertyValue(string fullName) => Props.TryGetValue(fullName, out var v) ? v : null;

            public FakeSimHub Raw(string name, object value) { Props["DataCorePlugin.GameRawData.Telemetry." + name] = value; return this; }
        }

        private static TelemetrySnapshot ThroughTheHost(FakeSdk sdk)
        {
            var source = new IRacingTelemetrySource(sdk);
            source.Update();
            return TelemetryCapture.Capture(source);
        }

        private static TelemetrySnapshot Snap(double? fl, double? fr = 100, double? rl = 100, double? rr = 100,
            bool inPitLane = false, bool inStall = false, int pitSvFlags = 0, int laps = 0, double speed = 150)
            => new TelemetrySnapshot
            {
                GameRunning = true, GameName = "IRacing", SessionState = 4, SessionTypeName = "Race",
                TyreWearFL = fl, TyreWearFR = fr, TyreWearRL = rl, TyreWearRR = rr,
                IsInPitLane = inPitLane, IsInPit = inStall, PitSvFlags = pitSvFlags,
                CompletedLaps = laps, CurrentLap = laps + 1, SpeedKmh = speed, FuelLevel = 30,
                TyreTempFL = 90, TyreTempFR = 90, TyreTempRL = 90, TyreTempRR = 90,
            };

        // ── The conversion, once ───────────────────────────────────────────────────────────────────────────

        [Test]
        public void TheBandsBecomeOneCornerInPercentRemaining()
        {
            Assert.That(TyreWear.FromBands(1f, 1f, 1f), Is.EqualTo(100.0).Within(1e-9), "new tyres are 100");
            Assert.That(TyreWear.FromBands(0.15f, 0.14f, 0.16f), Is.EqualTo(15.0).Within(0.01), "the mean of the three bands");
            Assert.That(TyreWear.FromBands(0.9998f, 0.9998f, 0.9998f), Is.EqualTo(99.98).Within(0.01), "what his recordings have at the start");
            Assert.That(TyreWear.FromBands(0f, 0f, 0f), Is.Null, "all three at nought: nothing measured, not a bald tyre");
            Assert.That(TyreWear.FromBands(float.NaN, 1f, 1f), Is.Null);
            Assert.That(TyreWear.FromBands(1.2f, 1.2f, 1.2f), Is.EqualTo(100.0), "clamped");
        }

        [Test]
        public void SimHubsPropertyIsPercentRemainingAlready()
        {
            Assert.That(TyreWear.FromSimHub(98.5), Is.EqualTo(98.5));
            Assert.That(TyreWear.FromSimHub(100), Is.EqualTo(100.0));
            Assert.That(TyreWear.FromSimHub(0), Is.Null, "0 is what SimHub publishes while it has nothing");
            Assert.That(TyreWear.FromSimHub(-1), Is.Null);
            Assert.That(TyreWear.FromSimHub(double.NaN), Is.Null);
            Assert.That(TyreWear.FromSimHub(250), Is.EqualTo(100.0), "clamped");
        }

        [Test]
        public void TheThresholdsAreAtTheWornEnd()
        {
            Assert.That(TyreWear.WarnBelowPercent, Is.EqualTo(35));
            Assert.That(TyreWear.CriticalBelowPercent, Is.EqualTo(20));
            Assert.That(TyreWear.IsWorn(100), Is.False, "new tyres never warn");
            Assert.That(TyreWear.IsCritical(100), Is.False);
            Assert.That(TyreWear.IsWorn(35), Is.False);
            Assert.That(TyreWear.IsWorn(34.9), Is.True);
            Assert.That(TyreWear.IsCritical(34.9), Is.False);
            Assert.That(TyreWear.IsCritical(19.9), Is.True);
            Assert.That(TyreWear.IsWorn(null), Is.False, "not measured is never worn");
            Assert.That(TyreWear.IsCritical(null), Is.False);
            Assert.That(TyreWear.Worst(100, 30, null, 60), Is.EqualTo(30));
            Assert.That(TyreWear.Worst(null, null, null, null), Is.Null);
        }

        // ── The host: a raw SDK value, through the source and the capture, to the wire ────────────────────

        [Test]
        public void NewTyresThroughTheHostAre100OnTheWire()
        {
            var s = ThroughTheHost(new FakeSdk().NewTyres());
            Assert.That(s.TyreWearFL, Is.EqualTo(100.0).Within(1e-9));
            Assert.That(s.TyreWearFR, Is.EqualTo(100.0).Within(1e-9));
            Assert.That(s.TyreWearRL, Is.EqualTo(100.0).Within(1e-9));
            Assert.That(s.TyreWearRR, Is.EqualTo(100.0).Within(1e-9));
            Assert.That(s.TyreWearWorst, Is.EqualTo(100.0).Within(1e-9));

            var dict = TelemetryFrame.BuildDict(s, demo: false);
            Assert.That((double)dict[FL], Is.EqualTo(100.0).Within(1e-9), "the WebSocket frame carries the number as it is");
            Assert.That((double)dict[RR], Is.EqualTo(100.0).Within(1e-9));
        }

        [Test]
        public void WornTyresThroughTheHostReadLowOnTheWire()
        {
            var sdk = new FakeSdk().NewTyres().Bands("RF", 0.15f, 0.14f, 0.16f).Bands("LR", 0.30f, 0.30f, 0.30f);
            var s = ThroughTheHost(sdk);
            Assert.That(s.TyreWearFL, Is.EqualTo(100.0).Within(1e-9));
            Assert.That(s.TyreWearFR, Is.EqualTo(15.0).Within(0.01), "the mean of its bands, in percent");
            Assert.That(s.TyreWearRL, Is.EqualTo(30.0).Within(0.01));
            Assert.That(s.TyreWearWorst, Is.EqualTo(15.0).Within(0.01));
            Assert.That(TyreWear.IsCritical(s.TyreWearFR), Is.True);
            Assert.That(TyreWear.IsWorn(s.TyreWearRL), Is.True);
            Assert.That(TyreWear.IsWorn(s.TyreWearFL), Is.False);

            var dict = TelemetryFrame.BuildDict(s, demo: false);
            Assert.That((double)dict[FR], Is.EqualTo(15.0).Within(0.01));
            Assert.That((double)dict[RL], Is.EqualTo(30.0).Within(0.01));
        }

        [Test]
        public void ASimThatHasNotMeasuredSendsNullNotNought()
        {
            var s = ThroughTheHost(new FakeSdk());
            Assert.That(s.TyreWearFL, Is.Null, "no bands: nothing measured");
            Assert.That(s.TyreWearWorst, Is.Null);

            var dict = TelemetryFrame.BuildDict(s, demo: false);
            Assert.That(dict.ContainsKey(FL), Is.True, "the key is always there");
            Assert.That(dict[FL], Is.Null, "and is null until the sim measures, never 0");

            var zero = ThroughTheHost(new FakeSdk().Bands("LF", 0f, 0f, 0f));
            Assert.That(zero.TyreWearFL, Is.Null, "three bands at nought is nothing measured too");
        }

        [Test]
        public void TheHttpWireCarriesTheNumberAndTheNull()
        {
            string dataDir = Path.Combine(Path.GetTempPath(), "racing-desk-tyre-wear-" + Guid.NewGuid().ToString("N"));
            int httpPort = FreePort();
            var runtime = new RacingDeskRuntime(new Settings(), new RacingDeskRuntime.Options
            {
                AssemblyDirectory = dataDir, PluginsDataDirectory = dataDir,
                HttpPort = httpPort, WsPort = FreePort(),
                EnableHardware = false, EnableSdkBridge = false, LoopbackOnly = true,
            });
            var sdk = new FakeSdk().NewTyres().Bands("RF", 0.15f, 0.14f, 0.16f);
            sdk.Values.Remove("LRwearL"); sdk.Values.Remove("LRwearM"); sdk.Values.Remove("LRwearR");
            var source = new IRacingTelemetrySource(sdk);
            try
            {
                runtime.Start();
                for (int i = 0; i < 12; i++) { source.Update(); runtime.Tick(source); }
                using var http = new HttpClient();
                var body = JObject.Parse(http.GetStringAsync($"http://127.0.0.1:{httpPort}/racing-desk/").Result);
                Assert.That((double)body[FL], Is.EqualTo(100.0).Within(1e-9), "new tyres: 100 on the HTTP wire");
                Assert.That((double)body[FR], Is.EqualTo(15.0).Within(0.01), "worn: the mean of the bands in percent");
                Assert.That(body[RL].Type, Is.EqualTo(JTokenType.Null), "not measured: null, the key still there");
                Assert.That((double)body[RR], Is.EqualTo(100.0).Within(1e-9));
                Assert.That((int)body["RacingDesk.Plugin.Strategy.TireHealthState"], Is.EqualTo(2), "a tyre measured at 15: the strategist's critical state goes out with it");
            }
            finally
            {
                runtime.Stop();
                try { Directory.Delete(dataDir, true); } catch { }
            }
        }

        // ── The SimHub plugin: SimHub's property, then the sim's bands, through the capture ────────────────

        [Test]
        public void SimHubsPropertyIsTakenAsItIs()
        {
            var simhub = new FakeSimHub();
            simhub.Data.TyreWearFrontLeft = 98;
            simhub.Data.TyreWearFrontRight = 100;
            simhub.Data.TyreWearRearLeft = 15;
            simhub.Data.TyreWearRearRight = 64.5;
            var s = TelemetryCapture.Capture(simhub);
            Assert.That(s.TyreWearFL, Is.EqualTo(98.0));
            Assert.That(s.TyreWearFR, Is.EqualTo(100.0), "new tyres: 100, not 1 and not 0");
            Assert.That(s.TyreWearRL, Is.EqualTo(15.0));
            Assert.That(s.TyreWearRR, Is.EqualTo(64.5), "never clamped to 1 and never inverted");

            var dict = TelemetryFrame.BuildDict(s, demo: false);
            Assert.That((double)dict[FL], Is.EqualTo(98.0));
            Assert.That((double)dict[RR], Is.EqualTo(64.5));
        }

        [Test]
        public void WhereSimHubHasNothingTheSimsOwnBandsAreAskedTheSameWay()
        {
            var simhub = new FakeSimHub().Raw("LFwearL", 0.5f).Raw("LFwearM", 0.5f).Raw("LFwearR", 0.5f)
                .Raw("RFwearL", 1f).Raw("RFwearM", 1f).Raw("RFwearR", 1f);
            var s = TelemetryCapture.Capture(simhub);
            Assert.That(s.TyreWearFL, Is.EqualTo(50.0).Within(0.01), "SimHub's 0 is nothing; the bands say 50");
            Assert.That(s.TyreWearFR, Is.EqualTo(100.0).Within(1e-9), "new tyres from the bands are 100, not 0 (the inversion that was here)");
            Assert.That(s.TyreWearRL, Is.Null, "SimHub's 0 and no bands: not measured");
            Assert.That(s.TyreWearRR, Is.Null);

            simhub.Data.TyreWearFrontLeft = 72;
            Assert.That(TelemetryCapture.Capture(simhub).TyreWearFL, Is.EqualTo(72.0), "SimHub's own number first, where it has one");
        }

        [Test]
        public void TheHostAndThePluginAgreeToTheNumber()
        {
            // The same tyre, read by the host from the bands and by the plugin from SimHub's property (which is the
            // bands' mean in percent, as SimHub computes it): one number on the wire.
            var host = ThroughTheHost(new FakeSdk().NewTyres().Bands("LF", 0.70f, 0.64f, 0.60f));
            var simhub = new FakeSimHub();
            simhub.Data.TyreWearFrontLeft = (0.70 + 0.64 + 0.60) / 3.0 * 100.0;
            var plugin = TelemetryCapture.Capture(simhub);
            Assert.That(host.TyreWearFL, Is.EqualTo(plugin.TyreWearFL.Value).Within(0.01));
            Assert.That(host.TyreWearFL, Is.EqualTo(64.67).Within(0.01));
        }

        // ── The commentary trigger, from the real topics file ────────────────────────────────────────────

        private static CommentaryTopic TyreWearHigh()
        {
            string path = FindUp(Path.Combine("apps", "plugin", "racing-desk-plugin", "simhub-plugin", "racingdesk-data", "commentary_topics.json"));
            Assume.That(path, Is.Not.Null, "commentary_topics.json not found above the test directory");
            var settings = new JsonSerializerSettings { ContractResolver = new CamelCasePropertyNamesContractResolver() };
            var file = JsonConvert.DeserializeObject<CommentaryTopicsFile>(File.ReadAllText(path), settings);
            var topic = file.Topics.FirstOrDefault(t => t.Id == "tyre_wear_high");
            Assert.That(topic, Is.Not.Null, "the tyre_wear_high topic");
            return topic;
        }

        private static bool Fires(CommentaryTopic topic, TelemetrySnapshot cur) =>
            topic.Triggers.Any(t => TriggerEvaluator.Evaluate(t, cur, Snap(100)));

        [Test]
        public void TheTopicFiresAtTheWornEndOnlyAndForEveryCorner()
        {
            var topic = TyreWearHigh();
            foreach (var t in topic.Triggers)
            {
                Assert.That(t.Condition, Is.EqualTo("<"), "worn is low tread remaining");
                Assert.That(t.Value, Is.EqualTo(TyreWear.WarnBelowPercent), "percent, the engine's own threshold, not a fraction");
                Assert.That(t.DataPoint.ToLowerInvariant(), Does.StartWith("tyrewear"));
            }
            Assert.That(topic.Triggers.Any(t => t.DataPoint.Equals("TyreWearWorst", StringComparison.OrdinalIgnoreCase)), Is.True,
                "the worst corner of the four is what fires it: every corner counts, the rear right included");

            Assert.That(Fires(topic, Snap(100, 100, 100, 100)), Is.False, "new tyres never fire it");
            Assert.That(Fires(topic, Snap(60, 55, 70, 65)), Is.False, "a stint's wear does not either");
            Assert.That(Fires(topic, Snap(35, 100, 100, 100)), Is.False, "at the threshold, not under it");
            Assert.That(Fires(topic, Snap(34.9, 100, 100, 100)), Is.True);
            Assert.That(Fires(topic, Snap(100, 30, 100, 100)), Is.True, "front right");
            Assert.That(Fires(topic, Snap(100, 100, 30, 100)), Is.True, "rear left");
            Assert.That(Fires(topic, Snap(100, 100, 100, 30)), Is.True, "rear right, which had no trigger before");
            Assert.That(Fires(topic, Snap(null, null, null, null)), Is.False, "not measured is never worn");
            Assert.That(Fires(topic, Snap(null, 100, 100, 100)), Is.False);
            Assert.That(Fires(topic, Snap(0.98, 0.95, 0.99, 0.97)), Is.True,
                "a fraction (the old 0..1) reads as a bald tyre: the wire is percent, and a flip upstream shows here");
        }

        [Test]
        public void TheTopicFiresOnWhatTheHostSends()
        {
            var topic = TyreWearHigh();
            Assert.That(Fires(topic, ThroughTheHost(new FakeSdk().NewTyres())), Is.False, "new tyres, raw SDK through the host: no commentary");
            Assert.That(Fires(topic, ThroughTheHost(new FakeSdk().NewTyres().Bands("RR", 0.2f, 0.2f, 0.2f))), Is.True, "a worn rear right: commentary");
            Assert.That(Fires(topic, ThroughTheHost(new FakeSdk())), Is.False, "nothing measured: no commentary");
        }

        [Test]
        public void TheExpositionPrintsThePercentWhole()
        {
            Assert.That(TriggerEvaluator.GetValuePublic(Snap(100, 30.4, 100, 100), "TyreWearWorst"), Is.EqualTo(30.4));
            Assert.That(double.IsNaN(TriggerEvaluator.GetValuePublic(Snap(null, null, null, null), "TyreWearFL")), Is.True);
            Assert.That(CommentaryEngine.FormatValue(30.4, "TyreWearWorst"), Is.EqualTo("30"), "'30% tread', not '0.3' and not '3040'");
            Assert.That(CommentaryEngine.FormatValue(100, "TyreWearFL"), Is.EqualTo("100"));
            Assert.That(CommentaryEngine.FormatValue(double.NaN, "TyreWearFL"), Is.EqualTo("—"));
        }

        // ── The strategist: health from a measurement, calls at the worn end ─────────────────────────────

        [Test]
        public void NewTyresNeverWarnInTheStrategist()
        {
            var t = new TireTracker();
            t.UpdateFrame(Snap(100, 100, 100, 100));
            Assert.That(t.NewMeasurement, Is.True, "the first value is a measurement");
            Assert.That(t.TireHealthState, Is.EqualTo(0));
            Assert.That(t.TreadRemaining, Is.EqualTo(new double?[] { 100, 100, 100, 100 }));
            Assert.That(t.Evaluate(new StintData()), Is.Null, "no call for new tyres");
            Assert.That(t.EstimatedLapsRemaining, Is.EqualTo(99));
            Assert.That(t.GripScore, Is.EqualTo(0));
        }

        [Test]
        public void WornAndCriticalMeasurementsWarnAndNothingElseDoes()
        {
            var t = new TireTracker();
            t.UpdateFrame(Snap(100, 30, 100, 100));
            Assert.That(t.TireHealthState, Is.EqualTo(1), "a tyre measured under 35: worn");
            var worn = t.Evaluate(new StintData());
            Assert.That(worn, Is.Not.Null);
            Assert.That(worn.Severity, Is.EqualTo(2));
            Assert.That(worn.Message, Does.Contain("Front-right measured at 30% tread"));

            t = new TireTracker();
            t.UpdateFrame(Snap(100, 100, 100, 15));
            Assert.That(t.TireHealthState, Is.EqualTo(2), "a tyre measured under 20: critical");
            Assert.That(t.EstimatedLapsRemaining, Is.EqualTo(0));
            var critical = t.Evaluate(new StintData());
            Assert.That(critical, Is.Not.Null);
            Assert.That(critical.Severity, Is.EqualTo(4));
            Assert.That(critical.Message, Does.Contain("Rear-right measured at 15% tread").And.Contain("Pit for tyres"));

            t = new TireTracker();
            t.UpdateFrame(Snap(100, 100, 100, 15, inPitLane: true));
            Assert.That(t.Evaluate(new StintData()).Message, Does.Contain("Take tyres at this stop"), "measured on pit road: the call is for this stop");

            t = new TireTracker();
            t.UpdateFrame(Snap(null, null, null, null));
            Assert.That(t.NewMeasurement, Is.False, "nothing measured is not a measurement");
            Assert.That(t.TireHealthState, Is.EqualTo(0));
            Assert.That(t.Evaluate(new StintData()), Is.Null);

            t = new TireTracker();
            t.UpdateFrame(Snap(0.98, 0.95, 0.99, 0.97));
            Assert.That(t.TireHealthState, Is.EqualTo(2), "a fraction reads as bald: the wire is percent, and a flip upstream shows here");
        }

        [Test]
        public void AnUnchangedValueIsNotNewsAndAStopWithTyresClearsTheHealth()
        {
            var t = new TireTracker();
            t.UpdateFrame(Snap(15));
            Assert.That(t.TireHealthState, Is.EqualTo(2));
            t.UpdateFrame(Snap(15));
            Assert.That(t.NewMeasurement, Is.False, "the same value again: not a measurement");
            Assert.That(t.TireHealthState, Is.EqualTo(2), "but what was measured stands");

            t.OnNewStint(tyresChanged: true);
            Assert.That(t.TireHealthState, Is.EqualTo(0), "a tyre was asked for at the stop: the reading may be the set that came off");
            Assert.That(t.EstimatedLapsRemaining, Is.EqualTo(99));
            t.UpdateFrame(Snap(15));
            Assert.That(t.NewMeasurement, Is.False, "the sim still shows the old reading: no news, no alarm");
            Assert.That(t.TireHealthState, Is.EqualTo(0));
            Assert.That(t.TreadRemaining[0], Is.EqualTo(15), "the number itself is still what the sim says");
            t.UpdateFrame(Snap(100));
            Assert.That(t.NewMeasurement, Is.True, "the sim measured again");
            Assert.That(t.TireHealthState, Is.EqualTo(0));
            t.UpdateFrame(Snap(18));
            Assert.That(t.TireHealthState, Is.EqualTo(2), "and critical again when it measures so");

            t.OnNewStint(tyresChanged: false);
            Assert.That(t.TireHealthState, Is.EqualTo(2), "no tyre asked for: the set is the one measured, and what it measured stands");

            t.Reset();
            Assert.That(t.TireHealthState, Is.EqualTo(0));
            Assert.That(t.TreadRemaining, Is.EqualTo(new double?[] { null, null, null, null }), "a reset forgets");
            t.UpdateFrame(Snap(18));
            Assert.That(t.NewMeasurement, Is.True, "and the next frame is measured afresh");
            Assert.That(t.TireHealthState, Is.EqualTo(2));
        }

        [Test]
        public void TheCoordinatorCallsOnTheMeasurementNotOnTheLap()
        {
            var c = new StrategyCoordinator();
            var prev = Snap(100);
            c.Update(Snap(100), null);
            Assert.That(c.CurrentStint, Is.Not.Null, "a race under way: a stint");
            Assert.That(c.Tires.TireHealthState, Is.EqualTo(0));
            Assert.That(c.IsVisible, Is.False, "new tyres: nothing to say");

            // Twenty laps on the same reading: iRacing does not measure on the track
            for (int lap = 1; lap <= 20; lap++)
            {
                var s = Snap(100, laps: lap);
                c.Update(s, prev);
                prev = s;
            }
            Assert.That(c.IsVisible, Is.False, "a value that has not changed is not news");
            Assert.That(c.Tires.EstimatedLapsRemaining, Is.EqualTo(99), "nothing to extrapolate from");

            // Pit road: the sim measures, the fronts at 15
            var entry = Snap(15, 16, 60, 62, inPitLane: true, laps: 20, speed: 60);
            c.Update(entry, prev);
            Assert.That(c.Tires.TireHealthState, Is.EqualTo(2));
            Assert.That(c.IsVisible, Is.True, "the call comes with the measurement, on pit road");
            Assert.That(c.CurrentLabel, Is.EqualTo("TYRES"));
            Assert.That(c.CurrentText, Does.Contain("measured at 15% tread").And.Contain("Take tyres at this stop"));

            // In the stall, tyres asked for; then out, at speed: a new stint on a set that may be another
            c.Update(Snap(15, 16, 60, 62, inPitLane: true, inStall: true, pitSvFlags: 0x0F, laps: 20, speed: 0), entry);
            c.Update(Snap(15, 16, 60, 62, inPitLane: false, laps: 20, speed: 80), entry);
            Assert.That(c.StintCount, Is.EqualTo(2));
            Assert.That(c.Tires.TireHealthState, Is.EqualTo(0), "the old reading is not held against the new set");
            for (int lap = 21; lap <= 25; lap++) c.Update(Snap(15, 16, 60, 62, laps: lap), prev);
            Assert.That(c.Tires.TireHealthState, Is.EqualTo(0), "and lap crossings on the same reading do not bring it back");
        }

        [Test]
        public void AStopWithoutTyresKeepsTheMeasurementAndItsVerdict()
        {
            var c = new StrategyCoordinator();
            c.Update(Snap(100), null);
            var entry = Snap(100, 100, 18, 100, inPitLane: true, laps: 10, speed: 60);
            c.Update(entry, Snap(100, laps: 10));
            Assert.That(c.Tires.TireHealthState, Is.EqualTo(2));
            c.Update(Snap(100, 100, 18, 100, inPitLane: true, inStall: true, pitSvFlags: 0x10, laps: 10, speed: 0), entry); // fuel only
            c.Update(Snap(100, 100, 18, 100, laps: 10, speed: 80), entry);
            Assert.That(c.StintCount, Is.EqualTo(2));
            Assert.That(c.Tires.TireHealthState, Is.EqualTo(2), "the same set, measured at 18: still critical, the pit box still offers the change");
        }

        [Test]
        public void TheEstimateIsInLapsOfTreadLeft()
        {
            var stint = new StintData();
            var tread = new double?[] { 60, 100, 100, 100 };
            Assert.That(stint.EstimateLapsToCritical(tread, 20), Is.EqualTo(99), "nothing seen yet");
            for (int i = 0; i < 5; i++) stint.WearPerLap.Add(new[] { 4.0, 0, 0, 0 }); // four points a lap off the front left
            Assert.That(stint.EstimateLapsToCritical(tread, 20), Is.EqualTo(10).Within(1e-9), "(60 - 20) / 4");
            Assert.That(stint.EstimateLapsToCritical(new double?[] { 20, 100, 100, 100 }, 20), Is.EqualTo(0), "at the critical tread already");
            Assert.That(stint.EstimateLapsToCritical(new double?[] { null, 100, 100, 100 }, 20), Is.EqualTo(99), "not measured: nothing to say");
            for (int i = 0; i < 5; i++) stint.WearPerLap.Add(new[] { 0.0, 0, 0, 0 }); // iRacing between stops: nought a lap
            Assert.That(stint.EstimateLapsToCritical(tread, 20), Is.EqualTo(99));
        }

        // ── The demo ──────────────────────────────────────────────────────────────────────────────────────

        [Test]
        public void TheDemoIsPercentRemainingAndGoesDown()
        {
            var dt = new DemoTelemetryProvider();
            Assert.That(dt.TyreWearFL, Is.EqualTo(82), "a part-worn set, in percent, as the live keys are");
            Assert.That(dt.TyreWearFR, Is.EqualTo(79));
            Assert.That(dt.TyreWearRL, Is.EqualTo(86));
            Assert.That(dt.TyreWearRR, Is.EqualTo(85));
            double before = dt.TyreWearFL;
            for (int i = 0; i < 2000; i++) dt.Tick(0.1); // over two demo laps
            Assert.That(dt.TyreWearFL, Is.LessThan(before), "tread goes down, lap by lap");
            Assert.That(dt.TyreWearFL, Is.GreaterThanOrEqualTo(10).And.LessThanOrEqualTo(100));
            for (int i = 0; i < 40000; i++) dt.Tick(0.1);
            Assert.That(dt.TyreWearFR, Is.EqualTo(10).Within(1e-9), "and stops at the floor");
            dt.Reset();
            Assert.That(dt.TyreWearFL, Is.EqualTo(82));

            var dict = TelemetryFrame.BuildDict(new TelemetrySnapshot { GameRunning = false }, demo: true);
            Assert.That((double)dict["RacingDesk.Plugin.Demo.TyreWearFL"], Is.InRange(10.0, 100.0), "the demo's keys carry the same percent");
        }

        [Test]
        public void TheDemoSequenceSaysHighWearWithLowTread()
        {
            var steps = DemoSequence.Build();
            var step = steps.First(s => s.TopicId == "tyre_wear_high");
            Assert.That(step.Snapshot.TyreWearWorst, Is.LessThan(TyreWear.WarnBelowPercent), "the step's tread is under the topic's threshold");
            Assert.That(Fires(TyreWearHigh(), step.Snapshot), Is.True, "and the topic would fire on it");
            foreach (var other in steps.Where(s => s.TopicId != "tyre_wear_high"))
            {
                Assert.That(other.Snapshot.TyreWearWorst, Is.GreaterThanOrEqualTo(TyreWear.WarnBelowPercent), $"{other.TopicId}: a base set with a stint on it, none of it worn");
                Assert.That(other.Snapshot.TyreWearWorst, Is.LessThanOrEqualTo(100));
            }
        }

        // ── Helpers ───────────────────────────────────────────────────────────────────────────────────────

        private static int FreePort()
        {
            var l = new TcpListener(IPAddress.Loopback, 0);
            l.Start();
            int port = ((IPEndPoint)l.LocalEndpoint).Port;
            l.Stop();
            return port;
        }

        private static string FindUp(string relative)
        {
            for (var dir = new DirectoryInfo(TestContext.CurrentContext.TestDirectory); dir != null; dir = dir.Parent)
            {
                string candidate = Path.Combine(dir.FullName, relative);
                if (File.Exists(candidate)) return candidate;
            }
            return null;
        }
    }
}
