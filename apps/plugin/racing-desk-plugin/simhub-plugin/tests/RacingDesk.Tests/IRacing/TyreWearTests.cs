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

            /// <summary>All four corners at one reading, a fraction remaining (the three bands the same).</summary>
            public FakeSdk Tread(float fl, float fr, float rl, float rr)
            {
                Bands("LF", fl, fl, fl); Bands("RF", fr, fr, fr); Bands("LR", rl, rl, rl); Bands("RR", rr, rr, rr);
                return this;
            }

            /// <summary>Where the car is: on pit road or not, in its stall or not, the pit service's checkboxes, its speed.</summary>
            public FakeSdk Car(bool onPitRoad, bool inStall, int pitSvFlags, double kmh)
            {
                Values["OnPitRoad"] = onPitRoad;
                Values["PlayerTrackSurface"] = inStall ? 1 /* InPitStall */ : onPitRoad ? 2 /* AproachingPits */ : 3 /* OnTrack */;
                Values["PitSvFlags"] = pitSvFlags;
                Values["Speed"] = (float)(kmh / 3.6);
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
        public void ThePrintedPercentNeverRoundsAcrossAThreshold()
        {
            Assert.That(TyreWear.DisplayPercent(100), Is.EqualTo(100));
            Assert.That(TyreWear.DisplayPercent(99.98), Is.EqualTo(100), "his fresh tyres read 100, not 99");
            Assert.That(TyreWear.DisplayPercent(64.4), Is.EqualTo(64));
            Assert.That(TyreWear.DisplayPercent(35), Is.EqualTo(35), "at the threshold: not worn, and says 35");
            Assert.That(TyreWear.DisplayPercent(34.6), Is.EqualTo(34), "worn (under 35) and never printed as 35");
            Assert.That(TyreWear.DisplayPercent(34.5), Is.EqualTo(34));
            Assert.That(TyreWear.DisplayPercent(20), Is.EqualTo(20));
            Assert.That(TyreWear.DisplayPercent(19.7), Is.EqualTo(19), "critical (under 20) and never printed as 20");
            Assert.That(TyreWear.DisplayPercent(15.4), Is.EqualTo(15));
            Assert.That(TyreWear.DisplayPercent(0), Is.EqualTo(0));
            Assert.That(TyreWear.DisplayPercent(250), Is.EqualTo(100), "clamped");
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
        public void ThePluginReadsTheSimsBandsFirstAndSimHubOnlyWhereThereAreNone()
        {
            // SimHub's own property lags (it was seen at 0 until a lap was done) and, for iRacing, is the middle band alone:
            // so the sim's own bands win, and SimHub's number is for a game that has none.
            var simhub = new FakeSimHub().Raw("LFwearL", 0.5f).Raw("LFwearM", 0.5f).Raw("LFwearR", 0.5f)
                .Raw("RFwearL", 1f).Raw("RFwearM", 1f).Raw("RFwearR", 1f);
            simhub.Data.TyreWearFrontLeft = 100;   // stale: SimHub has not caught up with the pit entry's measurement
            simhub.Data.TyreWearFrontRight = 40;   // not the bands' number either
            simhub.Data.TyreWearRearLeft = 72;     // no bands for this corner: SimHub's own number, as it is
            var s = TelemetryCapture.Capture(simhub);
            Assert.That(s.TyreWearFL, Is.EqualTo(50.0).Within(0.01), "the bands say 50; SimHub's stale 100 does not hide it");
            Assert.That(s.TyreWearFR, Is.EqualTo(100.0).Within(1e-9), "new tyres from the bands are 100, not 0 and not SimHub's 40");
            Assert.That(s.TyreWearRL, Is.EqualTo(72.0), "no bands: SimHub's number");
            Assert.That(s.TyreWearRR, Is.Null, "SimHub's 0 and no bands: not measured");
        }

        [Test]
        public void TheHostAndThePluginAgreeToTheNumberWhateverSimHubSays()
        {
            // The same tyre, read by the host from the bands and by the plugin from the bands too (SimHub's own property for
            // it is the middle band alone, 64, and is not what either shows): one number on the wire.
            var host = ThroughTheHost(new FakeSdk().NewTyres().Bands("LF", 0.70f, 0.64f, 0.60f));
            var simhub = new FakeSimHub().Raw("LFwearL", 0.70f).Raw("LFwearM", 0.64f).Raw("LFwearR", 0.60f);
            simhub.Data.TyreWearFrontLeft = 64;
            var plugin = TelemetryCapture.Capture(simhub);
            Assert.That(host.TyreWearFL, Is.EqualTo(plugin.TyreWearFL.Value).Within(1e-9), "the same number to the last digit");
            Assert.That(host.TyreWearFL, Is.EqualTo(64.67).Within(0.01));

            // And with the sim's bands unreadable, the plugin still has SimHub's number to show
            var blind = new FakeSimHub();
            blind.Data.TyreWearFrontLeft = 64;
            Assert.That(TelemetryCapture.Capture(blind).TyreWearFL, Is.EqualTo(64.0));
        }

        // ── The commentary trigger, from the real topics file ────────────────────────────────────────────

        private static CommentaryTopic TyreWearHigh()
        {
            string path = FindUp(Path.Combine("apps", "plugin", "racing-desk-plugin", "simhub-plugin", "racingdesk-data", "commentary_topics.json"));
            Assert.That(path, Is.Not.Null, "commentary_topics.json not found above the test directory");
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
        public void TheFragmentsSayWornNotCriticalBecauseTheTopicFiresAtWorn()
        {
            string path = FindUp(Path.Combine("apps", "plugin", "racing-desk-plugin", "simhub-plugin", "racingdesk-data", "commentary_fragments.json"));
            Assert.That(path, Is.Not.Null, "commentary_fragments.json not found above the test directory");
            var entry = JObject.Parse(File.ReadAllText(path)).Descendants().OfType<JObject>().First(o => (string)o["topicId"] == "tyre_wear_high");
            var texts = ((JObject)entry["fragments"]!).Descendants().OfType<JValue>().Select(v => (string)v.Value).Where(t => !string.IsNullOrEmpty(t)).ToList();
            Assert.That(texts, Is.Not.Empty);
            // The topic fires under 35, where the strategist only says "think about tyres at the next stop"; a card that says
            // critical, shot or time to stop is for a tyre under 20, and fragments are what the engine prints (before the prompts)
            foreach (var word in new[] { "critical", "shot", "time to stop" })
                Assert.That(texts.Any(t => t.IndexOf(word, StringComparison.OrdinalIgnoreCase) >= 0), Is.False, $"a fragment says '{word}'");
        }

        [Test]
        public void TheExpositionPrintsThePercentWhole()
        {
            Assert.That(TriggerEvaluator.GetValuePublic(Snap(100, 30.4, 100, 100), "TyreWearWorst"), Is.EqualTo(30.4));
            Assert.That(double.IsNaN(TriggerEvaluator.GetValuePublic(Snap(null, null, null, null), "TyreWearFL")), Is.True);
            Assert.That(CommentaryEngine.FormatValue(30.4, "TyreWearWorst"), Is.EqualTo("30"), "'30% tread', not '0.3' and not '3040'");
            Assert.That(CommentaryEngine.FormatValue(34.6, "TyreWearWorst"), Is.EqualTo("34"), "worn is under 35: not printed as 35");
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
        public void AnUnchangedValueIsNotNewsAndACornerThatGoesNullIsRatedWithoutIt()
        {
            var t = new TireTracker();
            t.UpdateFrame(Snap(15));
            Assert.That(t.TireHealthState, Is.EqualTo(2));
            t.UpdateFrame(Snap(15));
            Assert.That(t.NewMeasurement, Is.False, "the same value again: not a measurement");
            Assert.That(t.TireHealthState, Is.EqualTo(2), "but what was measured stands");

            // The changed tyre's reading is taken off the snapshot (TyreSetMask): the corner is null, and the rest rate the car
            t.UpdateFrame(Snap(null, 100, 100, 100));
            Assert.That(t.NewMeasurement, Is.False, "a corner going to null is not a measurement");
            Assert.That(t.TireHealthState, Is.EqualTo(0), "the removed set's reading is not held against the new one");
            Assert.That(t.EstimatedLapsRemaining, Is.EqualTo(99));
            Assert.That(t.TreadRemaining[0], Is.Null);
            t.OnNewStint();
            Assert.That(t.TireHealthState, Is.EqualTo(0));

            t.UpdateFrame(Snap(100));
            Assert.That(t.NewMeasurement, Is.True, "the sim measured the new set");
            Assert.That(t.TireHealthState, Is.EqualTo(0));
            t.UpdateFrame(Snap(18));
            Assert.That(t.TireHealthState, Is.EqualTo(2), "and critical again when it measures so");
            t.OnNewStint();
            Assert.That(t.TireHealthState, Is.EqualTo(2), "a stop that changed nothing: what it measured stands");

            t.Reset();
            Assert.That(t.TireHealthState, Is.EqualTo(0));
            Assert.That(t.TreadRemaining, Is.EqualTo(new double?[] { null, null, null, null }), "a reset forgets");
            t.UpdateFrame(Snap(18));
            Assert.That(t.NewMeasurement, Is.True, "and the next frame is measured afresh");
            Assert.That(t.TireHealthState, Is.EqualTo(2));
        }

        [Test]
        public void TheWearCallsComeWithTheMeasurementAndNotAgainAtEveryLap()
        {
            // The measurement is the news. A tracker that has not been asked for its call yet must still not make one from a
            // value that has not changed since (without the gate it would: nothing has used its cooldown).
            foreach (double worn in new[] { 30.0, 15.0 })
            {
                var t = new TireTracker();
                var stint = new StintData();
                t.UpdateFrame(Snap(100, 100, worn, 100));                     // the measurement, on the frame it came in
                Assert.That(t.TireHealthState, Is.GreaterThan(0));
                t.UpdateFrame(Snap(100, 100, worn, 100));                     // nothing new
                for (int lap = 1; lap <= 10; lap++)
                {
                    t.OnLapCompleted(stint, Snap(100, 100, worn, 100, laps: lap), 2.0);
                    Assert.That(t.Evaluate(stint), Is.Null, $"{worn}: lap {lap} on a value that has not changed makes no wear call");
                }
                Assert.That(t.TireHealthState, Is.GreaterThan(0), "the verdict stands for the pit box's offer");

                var again = new TireTracker();
                again.UpdateFrame(Snap(100, 100, worn, 100));
                Assert.That(again.Evaluate(stint), Is.Not.Null, $"{worn}: on the measurement's own frame the call is made");
            }
        }

        [Test]
        public void TheTyreCallsAreWordedForWhereTheCarIs()
        {
            var t = new TireTracker();
            t.UpdateFrame(Snap(100, 100, 30, 100, inPitLane: true));
            Assert.That(t.Evaluate(new StintData()).Message, Does.Contain("Think about tyres at this stop"), "measured on pit road: this stop");
            t = new TireTracker();
            t.UpdateFrame(Snap(100, 100, 30, 100));
            Assert.That(t.Evaluate(new StintData()).Message, Does.Contain("Think about tyres at the next stop"));
            t = new TireTracker();
            t.UpdateFrame(Snap(34.6, 100, 100, 100));
            Assert.That(t.Evaluate(new StintData()).Message, Does.Contain("measured at 34% tread"), "worn is under 35: never printed as 35");
            t = new TireTracker();
            t.UpdateFrame(Snap(19.7, 100, 100, 100));
            Assert.That(t.Evaluate(new StintData()).Message, Does.Contain("measured at 19% tread"), "critical is under 20: never printed as 20");
        }

        [Test]
        public void TheTreadIsNotAGripFactor()
        {
            // A reading of the tread (15, or 38) is rated once, from the measurement. It must not also become a grip score
            // from the third lap of a stint, where it is the only factor there is: that put a "grip" call on a fresh set.
            foreach (double reading in new[] { 15.0, 38.0 })
            {
                var t = new TireTracker();
                var stint = new StintData();
                t.UpdateFrame(Snap(reading, 100, 100, 100));
                for (int lap = 1; lap <= 6; lap++)
                {
                    stint.LapTimes.Add(94.0 - lap * 0.1);            // getting quicker, as an out-lap into a stint does
                    t.OnLapCompleted(stint, Snap(reading, 100, 100, 100, laps: lap), 2.0);
                    Assert.That(t.GripScore, Is.EqualTo(0), $"{reading}: lap {lap}, nothing in the driving says grip is going");
                }
            }
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

            // Out of the pits on four new tyres: the runtime has taken the removed set's readings off the snapshot (the
            // mask is its own tests'), so the corners arrive as null; the verdict goes with them and does not come back
            c.Update(Snap(null, null, null, null, inPitLane: true, inStall: true, pitSvFlags: 0x0F, laps: 20, speed: 0), entry);
            c.Update(Snap(null, null, null, null, inPitLane: false, laps: 20, speed: 80), entry);
            Assert.That(c.StintCount, Is.EqualTo(2));
            Assert.That(c.Tires.TireHealthState, Is.EqualTo(0), "the old reading is not held against the new set");
            for (int lap = 21; lap <= 25; lap++) c.Update(Snap(null, null, null, null, laps: lap), prev);
            Assert.That(c.Tires.TireHealthState, Is.EqualTo(0), "and lap crossings do not bring it back");
            Assert.That(c.Tires.GripScore, Is.EqualTo(0));
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

        // ── The set that came off: one rule, at the source, per corner ───────────────────────────────────────

        private const int AllFour = 0x0F;

        /// <summary>One frame through the mask, as the runtime does it: the snapshot comes back with the changed corners null.</summary>
        private static TelemetrySnapshot Through(TyreSetMask mask, TelemetrySnapshot s)
        {
            mask.Apply(s);
            return s;
        }

        private static double?[] Corners(TelemetrySnapshot s) => new[] { s.TyreWearFL, s.TyreWearFR, s.TyreWearRL, s.TyreWearRR };

        [Test]
        public void AStopWithTyresTakesTheRemovedSetsReadingOffUntilTheSimMeasuresAgain()
        {
            var mask = new TyreSetMask();
            Through(mask, Snap(95, 95, 95, 95, laps: 5));
            Assert.That(Corners(Through(mask, Snap(15, 16, 60, 62, inPitLane: true, laps: 6, speed: 60))), Is.EqualTo(new double?[] { 15, 16, 60, 62 }),
                "the measurement at pit entry is what the sim says of the set that is on the car");
            Assert.That(Corners(Through(mask, Snap(15, 16, 60, 62, inPitLane: true, inStall: true, pitSvFlags: AllFour, laps: 6, speed: 0))),
                Is.EqualTo(new double?[] { 15, 16, 60, 62 }), "in the stall the old set is still on the car");
            Assert.That(Corners(Through(mask, Snap(15, 16, 60, 62, inPitLane: true, inStall: true, pitSvFlags: 0, laps: 6, speed: 0))),
                Is.EqualTo(new double?[] { 15, 16, 60, 62 }), "the service done and the checkboxes clear: still on pit road");

            Assert.That(Corners(Through(mask, Snap(15, 16, 60, 62, laps: 6, speed: 80))), Is.EqualTo(new double?[] { null, null, null, null }),
                "out on four new tyres: the sim still shows the set that came off, and that is not a reading of this car");
            for (int lap = 7; lap <= 12; lap++)
                Assert.That(Corners(Through(mask, Snap(15, 16, 60, 62, laps: lap))), Is.EqualTo(new double?[] { null, null, null, null }), "for the whole stint");

            // The next pit entry: the sim measures the new set, FL first
            Assert.That(Corners(Through(mask, Snap(91, 16, 60, 62, inPitLane: true, laps: 13, speed: 60))), Is.EqualTo(new double?[] { 91, null, null, null }),
                "a corner comes back when the sim shows it differently, and not before");
            Assert.That(Corners(Through(mask, Snap(91, 90, 92, 93, inPitLane: true, laps: 13, speed: 60))), Is.EqualTo(new double?[] { 91, 90, 92, 93 }));
        }

        [Test]
        public void ATwoTyreStopMasksTheTwoAndLeavesTheOthersAsMeasured()
        {
            var mask = new TyreSetMask();
            var tracker = new TireTracker();
            const int lefts = TelemetrySnapshot.PIT_SV_LF_TIRE | TelemetrySnapshot.PIT_SV_LR_TIRE;   // 0x05
            tracker.UpdateFrame(Through(mask, Snap(40, 50, 45, 15, inPitLane: true, laps: 6, speed: 60)));
            Assert.That(tracker.TireHealthState, Is.EqualTo(2), "the right rear at 15");
            tracker.UpdateFrame(Through(mask, Snap(40, 50, 45, 15, inPitLane: true, inStall: true, pitSvFlags: lefts, speed: 0)));
            var gone = Through(mask, Snap(40, 50, 45, 15, laps: 6, speed: 80));
            tracker.UpdateFrame(gone);
            tracker.OnNewStint();
            Assert.That(Corners(gone), Is.EqualTo(new double?[] { null, 50, null, 15 }), "the lefts are new, the rights are the set that was measured");
            Assert.That(tracker.TireHealthState, Is.EqualTo(2), "the right rear is still at 15: its verdict stands, the pit box still offers the change");
            Assert.That(tracker.Worst(), Is.EqualTo(15));
            Assert.That(tracker.NewMeasurement, Is.False);

            var fronts = new TyreSetMask();
            const int frontsOnly = TelemetrySnapshot.PIT_SV_LF_TIRE | TelemetrySnapshot.PIT_SV_RF_TIRE;   // 0x03
            Through(fronts, Snap(70, 60, 55, 18, inPitLane: true, speed: 60));
            Through(fronts, Snap(70, 60, 55, 18, inPitLane: true, inStall: true, pitSvFlags: frontsOnly, speed: 0));
            Assert.That(Corners(Through(fronts, Snap(70, 60, 55, 18, speed: 80))), Is.EqualTo(new double?[] { null, null, 55, 18 }));
        }

        [Test]
        public void AStopThatChangedNoTyreMasksNothing()
        {
            var mask = new TyreSetMask();
            Through(mask, Snap(15, 16, 60, 62, inPitLane: true, speed: 60));
            Through(mask, Snap(15, 16, 60, 62, inPitLane: true, inStall: true, pitSvFlags: TelemetrySnapshot.PIT_SV_FUEL, speed: 0));
            Assert.That(Corners(Through(mask, Snap(15, 16, 60, 62, speed: 80))), Is.EqualTo(new double?[] { 15, 16, 60, 62 }), "fuel only: the set is the one that was measured");

            // Tyres ticked on pit road and the stall never reached (a drive-through): nothing was changed
            var through = new TyreSetMask();
            Through(through, Snap(15, 16, 60, 62, inPitLane: true, pitSvFlags: AllFour, speed: 60));
            Assert.That(Corners(Through(through, Snap(15, 16, 60, 62, speed: 80))), Is.EqualTo(new double?[] { 15, 16, 60, 62 }));
        }

        [Test]
        public void ASimThatMeasuresInTheStallAfterTheChangeIsNotMasked()
        {
            var mask = new TyreSetMask();
            Through(mask, Snap(15, 16, 60, 62, inPitLane: true, speed: 60));
            Through(mask, Snap(15, 16, 60, 62, inPitLane: true, inStall: true, pitSvFlags: AllFour, speed: 0));
            Through(mask, Snap(98, 99, 97, 98, inPitLane: true, inStall: true, pitSvFlags: AllFour, speed: 0));   // the sim refreshed with the new set on
            Assert.That(Corners(Through(mask, Snap(98, 99, 97, 98, speed: 80))), Is.EqualTo(new double?[] { 98, 99, 97, 98 }), "that reading is the new set's: shown");
        }

        [Test]
        public void ACornerNotYetMeasuredIsNeverMaskedAndAResetForgets()
        {
            var mask = new TyreSetMask();
            Through(mask, Snap(null, 16, 60, 62, inPitLane: true, speed: 60));
            Through(mask, Snap(null, 16, 60, 62, inPitLane: true, inStall: true, pitSvFlags: AllFour, speed: 0));
            Assert.That(Corners(Through(mask, Snap(null, 16, 60, 62, speed: 80))), Is.EqualTo(new double?[] { null, null, null, null }));
            Assert.That(mask.IsMasked(0), Is.False, "nothing was shown for the front left, so there was nothing to hold back");
            Assert.That(Corners(Through(mask, Snap(80, 16, 60, 62, speed: 80))), Is.EqualTo(new double?[] { 80, null, null, null }), "its first measurement is shown");

            mask.Reset();
            Assert.That(Corners(Through(mask, Snap(80, 16, 60, 62, speed: 80))), Is.EqualTo(new double?[] { 80, 16, 60, 62 }), "a new session or another car: nothing is held back");
            Assert.That(Through(mask, new TelemetrySnapshot { GameRunning = false, TyreWearFL = 5 }).TyreWearFL, Is.EqualTo(5), "with no game running the snapshot is left alone");
        }

        /// <summary>The whole stop, from iRacing's variables to every reader: the HTTP wire, the WebSocket frame, the commentary's trigger and the strategist.</summary>
        [Test]
        public void ANewSetIsNotMeasuredOnTheWireInTheTriggerOrInTheStrategistUntilTheSimMeasuresAgain()
        {
            string dataDir = Path.Combine(Path.GetTempPath(), "racing-desk-tyre-set-" + Guid.NewGuid().ToString("N"));
            int httpPort = FreePort();
            var runtime = new RacingDeskRuntime(new Settings(), new RacingDeskRuntime.Options
            {
                AssemblyDirectory = dataDir, PluginsDataDirectory = dataDir,
                HttpPort = httpPort, WsPort = FreePort(),
                EnableHardware = false, EnableSdkBridge = false, LoopbackOnly = true,
            });
            var sdk = new FakeSdk().Tread(0.90f, 0.90f, 0.90f, 0.90f).Car(false, false, 0, 150);
            var source = new IRacingTelemetrySource(sdk);
            var topic = TyreWearHigh();
            using var http = new HttpClient();
            JObject Wire() => JObject.Parse(http.GetStringAsync($"http://127.0.0.1:{httpPort}/racing-desk/").Result);
            void Frames(int n = 14) { for (int i = 0; i < n; i++) { source.Update(); runtime.Tick(source); } }
            double?[] OnTheWire(JObject b) => new[] { FL, FR, RL, RR }.Select(k => b[k].Type == JTokenType.Null ? (double?)null : (double)b[k]).ToArray();

            try
            {
                runtime.Start();
                Frames();
                Assert.That(OnTheWire(Wire()), Is.EqualTo(new double?[] { 90, 90, 90, 90 }).Within(0.01), "a stint on a set measured at 90");

                // Pit entry: the sim measures — fronts 15 and 16 — and the strategist says take tyres at this stop
                sdk.Tread(0.15f, 0.16f, 0.60f, 0.62f).Car(true, false, 0, 60);
                Frames();
                var entry = Wire();
                Assert.That(OnTheWire(entry), Is.EqualTo(new double?[] { 15, 16, 60, 62 }).Within(0.01));
                Assert.That((int)entry["RacingDesk.Plugin.Strategy.TireHealthState"], Is.EqualTo(2));
                Assert.That((string)entry["RacingDesk.Plugin.Strategy.Text"], Does.Contain("Take tyres at this stop"));
                Assert.That(Fires(topic, runtime._current), Is.True, "the set on the car is worn: the commentary may say so");

                // In the stall with four tyres asked for: the old set is still on the car
                sdk.Car(true, true, AllFour, 0);
                Frames();
                Assert.That(OnTheWire(Wire()), Is.EqualTo(new double?[] { 15, 16, 60, 62 }).Within(0.01));

                // Out on four new tyres. The sim goes on showing the set that came off (15, 16, 60, 62) for the whole stint.
                sdk.Car(false, false, 0, 80);
                Frames();
                var fresh = Wire();
                Assert.That(OnTheWire(fresh), Is.EqualTo(new double?[] { null, null, null, null }), "the HTTP wire: not measured, null, never the removed set's number");
                Assert.That(fresh[FL].Type, Is.EqualTo(JTokenType.Null));
                Assert.That(OnTheWire(fresh), Is.All.Null);
                var frame = TelemetryFrame.BuildDict(runtime._current, demo: false);
                Assert.That(frame[FL], Is.Null, "the WebSocket frame: the same");
                Assert.That(frame[RR], Is.Null);
                Assert.That(runtime._current.TyreWearWorst, Is.Null);
                Assert.That(Fires(topic, runtime._current), Is.False, "the commentary's trigger sees nothing to be worn");
                Assert.That((int)fresh["RacingDesk.Plugin.Strategy.TireHealthState"], Is.EqualTo(0), "the strategist's verdict goes with it");
                Assert.That(runtime._strategy.Tires.GripScore, Is.EqualTo(0));

                // A lap, two, on the same readings
                for (int lap = 4; lap <= 6; lap++) { sdk.Values["LapCompleted"] = lap; sdk.Values["Lap"] = lap + 1; sdk.Values["LapLastLapTime"] = 92f; Frames(); }
                Assert.That(OnTheWire(Wire()), Is.All.Null, "laps later, the same readings, still not this set's");
                Assert.That(Fires(topic, runtime._current), Is.False);

                // The next pit entry: the sim measures the new set
                sdk.Tread(0.88f, 0.87f, 0.90f, 0.91f).Car(true, false, 0, 60);
                Frames();
                var next = Wire();
                Assert.That(OnTheWire(next), Is.EqualTo(new double?[] { 88, 87, 90, 91 }).Within(0.01), "measured again: shown");
                Assert.That((int)next["RacingDesk.Plugin.Strategy.TireHealthState"], Is.EqualTo(0));
                Assert.That(Fires(topic, runtime._current), Is.False);
            }
            finally
            {
                runtime.Stop();
                try { Directory.Delete(dataDir, true); } catch { }
            }
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
        public void TheDemoStepThatSaysHighWearHasTheRingsAndTheQuadSayItToo()
        {
            var steps = DemoSequence.Build();
            var dt = new DemoTelemetryProvider();
            dt.ApplyDemoStep(steps.First(s => s.TopicId == "tyre_wear_high").Snapshot);
            Assert.That(dt.TyreWearFL, Is.EqualTo(29), "the step's words say 29 tread: the provider's tread, which the rings and the quad read, says it too");
            Assert.That(dt.TyreWearFR, Is.EqualTo(32));
            Assert.That(dt.TyreWearRL, Is.EqualTo(86), "the corners the step does not call worn are as they were");
            Assert.That(dt.TyreWearRR, Is.EqualTo(85));

            var other = new DemoTelemetryProvider();
            foreach (var step in steps.Where(s => s.TopicId != "tyre_wear_high")) other.ApplyDemoStep(step.Snapshot);
            Assert.That(new[] { other.TyreWearFL, other.TyreWearFR, other.TyreWearRL, other.TyreWearRR }, Is.EqualTo(new double[] { 82, 79, 86, 85 }),
                "a base set with a stint on it leaves the provider's tread alone");
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
