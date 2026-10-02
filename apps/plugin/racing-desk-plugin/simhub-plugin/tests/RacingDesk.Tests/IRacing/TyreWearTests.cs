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
    /// direction, fails here: new tyres read 100 and warn nowhere, worn tyres read low and warn everywhere. A corner
    /// whose tyre was changed (a stop with it ticked, or a reset to the pits) reads a new set's 100, flagged in
    /// <c>RacingDesk.Plugin.TyreNewSetFlags</c>, until the sim measures it (TyreSetMask).
    /// </summary>
    [TestFixture]
    public class TyreWearTests
    {
        private const string FL = "DataCorePlugin.GameData.TyreWearFrontLeft";
        private const string FR = "DataCorePlugin.GameData.TyreWearFrontRight";
        private const string RL = "DataCorePlugin.GameData.TyreWearRearLeft";
        private const string RR = "DataCorePlugin.GameData.TyreWearRearRight";
        private const string NewSet = "RacingDesk.Plugin.TyreNewSetFlags";

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
            public string OpponentName(object opponent) => null;

            public FakeSimHub Raw(string name, object value) { Props["DataCorePlugin.GameRawData.Telemetry." + name] = value; return this; }
        }

        private static TelemetrySnapshot ThroughTheHost(FakeSdk sdk)
        {
            var source = new IRacingTelemetrySource(sdk);
            source.Update();
            return TelemetryCapture.Capture(source);
        }

        /// <param name="newSet">TyreNewSetFlags as the mask would have set them: the corners whose 100 is a new set's, not measured (0x01 FL … 0x08 RR).</param>
        private static TelemetrySnapshot Snap(double? fl, double? fr = 100, double? rl = 100, double? rr = 100,
            bool inPitLane = false, bool inStall = false, int pitSvFlags = 0, int laps = 0, double speed = 150, int newSet = 0)
            => new TelemetrySnapshot
            {
                GameRunning = true, GameName = "IRacing", SessionState = 4, SessionTypeName = "Race",
                TyreWearFL = fl, TyreWearFR = fr, TyreWearRL = rl, TyreWearRR = rr, TyreNewSetFlags = newSet,
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
                Assert.That((int)body[NewSet], Is.EqualTo(0), "no tyre has been changed: every number is the sim's own, and the key says so");
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
        public void AnUnchangedValueIsNotNewsAndANewSetIsHealthyButNotNews()
        {
            var t = new TireTracker();
            t.UpdateFrame(Snap(15));
            Assert.That(t.TireHealthState, Is.EqualTo(2));
            t.UpdateFrame(Snap(15));
            Assert.That(t.NewMeasurement, Is.False, "the same value again: not a measurement");
            Assert.That(t.TireHealthState, Is.EqualTo(2), "but what was measured stands");

            // The changed tyre arrives as a new set's 100, flagged (TyreSetMask): healthy, and not a measurement
            t.UpdateFrame(Snap(100, 100, 100, 100, newSet: TelemetrySnapshot.PIT_SV_LF_TIRE));
            Assert.That(t.NewMeasurement, Is.False, "a corner going to a new set's 100 is an assumption, not a measurement");
            Assert.That(t.TireHealthState, Is.EqualTo(0), "the removed set's reading is not held against the new one: a new set is healthy");
            Assert.That(t.EstimatedLapsRemaining, Is.EqualTo(99));
            Assert.That(t.TreadRemaining[0], Is.EqualTo(100), "the rings' number");
            Assert.That(t.Evaluate(new StintData()), Is.Null, "and nothing is said of it");
            t.OnNewStint();
            Assert.That(t.TireHealthState, Is.EqualTo(0));

            t.UpdateFrame(Snap(91));
            Assert.That(t.NewMeasurement, Is.True, "the sim measured the new set");
            Assert.That(t.TireHealthState, Is.EqualTo(0));
            t.UpdateFrame(Snap(18));
            Assert.That(t.TireHealthState, Is.EqualTo(2), "and critical again when it measures so");
            t.OnNewStint();
            Assert.That(t.TireHealthState, Is.EqualTo(2), "a stop that changed nothing: what it measured stands");

            // A corner that goes to null (never measured, no set to hold) is not a measurement either
            t.UpdateFrame(Snap(null, 100, 100, 100));
            Assert.That(t.NewMeasurement, Is.False, "a corner going to null is not a measurement");
            Assert.That(t.TireHealthState, Is.EqualTo(0), "and the rest rate the car");
            Assert.That(t.TreadRemaining[0], Is.Null);

            t.Reset();
            Assert.That(t.TireHealthState, Is.EqualTo(0));
            Assert.That(t.TreadRemaining, Is.EqualTo(new double?[] { null, null, null, null }), "a reset forgets");
            t.UpdateFrame(Snap(18));
            Assert.That(t.NewMeasurement, Is.True, "and the next frame is measured afresh");
            Assert.That(t.TireHealthState, Is.EqualTo(2));
        }

        [Test]
        public void ANewSetBesideACriticalCornerKeepsTheVerdictAndDoesNotCallItAgain()
        {
            // Two lefts at a stop, the right rear at 15 left on: the verdict stands for the pit box's offer, but the frame the
            // lefts became new is not a measurement of the right rear, so the call made at pit entry is not made again.
            var t = new TireTracker();
            t.UpdateFrame(Snap(40, 50, 45, 15, inPitLane: true));
            Assert.That(t.TireHealthState, Is.EqualTo(2));
            Assert.That(t.Evaluate(new StintData()), Is.Not.Null, "the call, on the measurement's own frame");
            const int lefts = TelemetrySnapshot.PIT_SV_LF_TIRE | TelemetrySnapshot.PIT_SV_LR_TIRE;   // 0x05
            t.UpdateFrame(Snap(100, 50, 100, 15, newSet: lefts));
            t.OnNewStint();
            Assert.That(t.NewMeasurement, Is.False, "two corners went to a new set's 100: not a measurement");
            Assert.That(t.TireHealthState, Is.EqualTo(2), "the right rear is still at 15: the pit box still offers the change");
            Assert.That(t.Worst(), Is.EqualTo(15));
            Assert.That(t.TreadRemaining, Is.EqualTo(new double?[] { 100, 50, 100, 15 }));

            var fresh = new TireTracker();   // no cooldown spent: the gate alone must hold the call back
            fresh.UpdateFrame(Snap(40, 50, 45, 15));
            fresh.UpdateFrame(Snap(100, 50, 100, 15, newSet: lefts));
            Assert.That(fresh.Evaluate(new StintData()), Is.Null, "no wear call from a frame that measured nothing");
            for (int lap = 1; lap <= 5; lap++) fresh.OnLapCompleted(new StintData(), Snap(100, 50, 100, 15, laps: lap, newSet: lefts), 2.0);
            Assert.That(fresh.Evaluate(new StintData()), Is.Null, "nor at a lap crossing");
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
            Assert.That(c.CurrentLabel, Is.EqualTo("Tyres"));
            Assert.That(c.CurrentText, Does.Contain("measured at 15% tread").And.Contain("Take tyres at this stop"));

            // Out of the pits on four new tyres: the runtime has put a new set's 100 on the snapshot, flagged (the mask is
            // its own tests'), so the corners arrive as 100; the verdict goes with the old reading and does not come back
            c.Update(Snap(15, 16, 60, 62, inPitLane: true, inStall: true, pitSvFlags: 0x0F, laps: 20, speed: 0), entry);
            c.Update(Snap(100, 100, 100, 100, inPitLane: false, laps: 20, speed: 80, newSet: 0x0F), entry);
            Assert.That(c.StintCount, Is.EqualTo(2));
            Assert.That(c.Tires.TireHealthState, Is.EqualTo(0), "the old reading is not held against the new set: a new set is healthy");
            Assert.That(c.Tires.NewMeasurement, Is.False, "and the 100 is not a measurement");
            Assert.That(c.Tires.TreadRemaining, Is.EqualTo(new double?[] { 100, 100, 100, 100 }));
            for (int lap = 21; lap <= 25; lap++) c.Update(Snap(100, 100, 100, 100, laps: lap, newSet: 0x0F), prev);
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
        private const double New = TyreWear.NewPercent;   // what a changed corner reads until the sim measures it: 100

        /// <summary>One frame through the mask, as the runtime does it: the snapshot comes back with the changed corners at a new set's 100, flagged.</summary>
        private static TelemetrySnapshot Through(TyreSetMask mask, TelemetrySnapshot s)
        {
            mask.Apply(s);
            return s;
        }

        private static double?[] Corners(TelemetrySnapshot s) => new[] { s.TyreWearFL, s.TyreWearFR, s.TyreWearRL, s.TyreWearRR };

        [Test]
        public void ANewSetReads100()
        {
            Assert.That(TyreWear.NewPercent, Is.EqualTo(100.0), "a new set's tread: what a changed corner reads until the sim measures it");
            Assert.That(TyreWear.IsWorn(TyreWear.NewPercent), Is.False, "and it never warns");
            Assert.That(TyreWear.DisplayPercent(TyreWear.NewPercent), Is.EqualTo(100));
            var s = Snap(100, 100, 100, 100, newSet: 0x05);
            Assert.That(new[] { s.IsTyreNewSet(0), s.IsTyreNewSet(1), s.IsTyreNewSet(2), s.IsTyreNewSet(3) }, Is.EqualTo(new[] { true, false, true, false }),
                "the flags are PitSvFlags' bits: 0x01 FL, 0x02 FR, 0x04 RL, 0x08 RR");
        }

        [Test]
        public void AStopWithTyresReadsANewSetUntilTheSimMeasuresAgain()
        {
            var mask = new TyreSetMask();
            Through(mask, Snap(95, 95, 95, 95, laps: 5));
            var entry = Through(mask, Snap(15, 16, 60, 62, inPitLane: true, laps: 6, speed: 60));
            Assert.That(Corners(entry), Is.EqualTo(new double?[] { 15, 16, 60, 62 }), "the measurement at pit entry is what the sim says of the set that is on the car");
            Assert.That(entry.TyreNewSetFlags, Is.EqualTo(0));
            Assert.That(Corners(Through(mask, Snap(15, 16, 60, 62, inPitLane: true, inStall: true, pitSvFlags: AllFour, laps: 6, speed: 0))),
                Is.EqualTo(new double?[] { 15, 16, 60, 62 }), "in the stall the old set is still on the car");
            Assert.That(Corners(Through(mask, Snap(15, 16, 60, 62, inPitLane: true, inStall: true, pitSvFlags: 0, laps: 6, speed: 0))),
                Is.EqualTo(new double?[] { 15, 16, 60, 62 }), "the service done and the checkboxes clear: still on pit road");

            var fresh = Through(mask, Snap(15, 16, 60, 62, laps: 6, speed: 80));
            Assert.That(Corners(fresh), Is.EqualTo(new double?[] { New, New, New, New }),
                "out on four new tyres: the sim still shows the set that came off, which is not a reading of this car; a new set reads 100");
            Assert.That(fresh.TyreNewSetFlags, Is.EqualTo(AllFour), "and the snapshot says which corners read so by assumption");
            Assert.That(fresh.TyreWearWorst, Is.EqualTo(New));
            for (int lap = 7; lap <= 12; lap++)
            {
                var s = Through(mask, Snap(15, 16, 60, 62, laps: lap));
                Assert.That(Corners(s), Is.EqualTo(new double?[] { New, New, New, New }), "for the whole stint");
                Assert.That(s.TyreNewSetFlags, Is.EqualTo(AllFour));
            }

            // The next pit entry: the sim measures the new set, FL first
            var first = Through(mask, Snap(91, 16, 60, 62, inPitLane: true, laps: 13, speed: 60));
            Assert.That(Corners(first), Is.EqualTo(new double?[] { 91, New, New, New }), "a corner's own number comes back when the sim shows it differently, and not before");
            Assert.That(first.TyreNewSetFlags, Is.EqualTo(AllFour & ~TelemetrySnapshot.PIT_SV_LF_TIRE), "the front left is measured; the others still read the new set's 100");
            var all = Through(mask, Snap(91, 90, 92, 93, inPitLane: true, laps: 13, speed: 60));
            Assert.That(Corners(all), Is.EqualTo(new double?[] { 91, 90, 92, 93 }));
            Assert.That(all.TyreNewSetFlags, Is.EqualTo(0), "every number is the sim's own again");
        }

        [Test]
        public void AResetToThePitsFitsANewSetThatReads100UntilTheSimMeasuresIt()
        {
            // His own case (every change in his newest 64 sessions): on track, a reset puts the car in its stall with his default
            // pit settings (tyres ticked) and a new set goes on, while the sim's readings keep the old set's. The counters
            // (LFTiresUsed, TireSetsUsed) do not count it; the stall and the checkboxes do.
            var mask = new TyreSetMask();
            var tracker = new TireTracker();
            for (int lap = 1; lap <= 5; lap++) tracker.UpdateFrame(Through(mask, Snap(62, 60, 65, 63, laps: lap)));
            Assert.That(tracker.TireHealthState, Is.EqualTo(0));

            // The reset: straight into the stall, no pit road before it, the defaults ticked
            tracker.UpdateFrame(Through(mask, Snap(62, 60, 65, 63, inPitLane: true, inStall: true, pitSvFlags: AllFour | TelemetrySnapshot.PIT_SV_FUEL, laps: 5, speed: 0)));
            tracker.UpdateFrame(Through(mask, Snap(62, 60, 65, 63, inPitLane: true, inStall: true, pitSvFlags: AllFour | TelemetrySnapshot.PIT_SV_FUEL, laps: 5, speed: 0)));
            // And out, on four new tyres the sim has not measured
            var outAgain = Through(mask, Snap(62, 60, 65, 63, laps: 5, speed: 80));
            tracker.UpdateFrame(outAgain);
            tracker.OnNewStint();
            Assert.That(Corners(outAgain), Is.EqualTo(new double?[] { New, New, New, New }), "a new set: 100, not the old set's 62");
            Assert.That(outAgain.TyreNewSetFlags, Is.EqualTo(AllFour));
            Assert.That(tracker.TireHealthState, Is.EqualTo(0), "the strategist: a new set is healthy");
            Assert.That(tracker.NewMeasurement, Is.False, "and not news");
            Assert.That(tracker.Evaluate(new StintData()), Is.Null, "no warning, no offer");
            for (int lap = 6; lap <= 20; lap++)
            {
                var s = Through(mask, Snap(62, 60, 65, 63, laps: lap));
                Assert.That(Corners(s), Is.EqualTo(new double?[] { New, New, New, New }), "laps later, the same old readings: still the new set's 100");
                Assert.That(s.TyreNewSetFlags, Is.EqualTo(AllFour));
            }

            // The first real stop: the sim measures the set that is on the car
            var measured = Through(mask, Snap(84, 83, 86, 85, inPitLane: true, laps: 21, speed: 60));
            tracker.UpdateFrame(measured);
            Assert.That(Corners(measured), Is.EqualTo(new double?[] { 84, 83, 86, 85 }), "the measured value replaces the 100");
            Assert.That(measured.TyreNewSetFlags, Is.EqualTo(0));
            Assert.That(tracker.NewMeasurement, Is.True, "that is a measurement");
            Assert.That(tracker.TireHealthState, Is.EqualTo(0));

            // A reset onto a set the sim already reads as 100 (fresh, measured at the start) has nothing to replace: it is not
            // held and not flagged, so the page does not say "new set" of a number that is the sim's own (the next test)
            var fromNew = new TyreSetMask();
            Through(fromNew, Snap(100, 100, 100, 100, laps: 1));
            Through(fromNew, Snap(100, 100, 100, 100, inPitLane: true, inStall: true, pitSvFlags: AllFour, laps: 1, speed: 0));
            var s2 = Through(fromNew, Snap(100, 100, 100, 100, laps: 1, speed: 80));
            Assert.That(Corners(s2), Is.EqualTo(new double?[] { 100, 100, 100, 100 }));
            Assert.That(s2.TyreNewSetFlags, Is.EqualTo(0));
            var s3 = Through(fromNew, Snap(88, 87, 90, 91, inPitLane: true, laps: 12, speed: 60));
            Assert.That(Corners(s3), Is.EqualTo(new double?[] { 88, 87, 90, 91 }));
            Assert.That(s3.TyreNewSetFlags, Is.EqualTo(0));
        }

        [Test]
        public void AFreshSetThatTheSimAlreadyReadsAs100IsNotHeldOrFlaggedButTheNextChangeIs()
        {
            // His sessions that start with tyres ticked in his default pit settings: the stall's first exit, with the sim at 100.00 on
            // every corner and PitSvFlags 0x1f from the first frame (one of his 64 newest: it would have said "New set" for 88.8 %
            // of its time on track). The 100 is the sim's own there, so nothing is replaced and nothing is flagged.
            var mask = new TyreSetMask();
            var tracker = new TireTracker();
            const int ticked = AllFour | TelemetrySnapshot.PIT_SV_FUEL;
            tracker.UpdateFrame(Through(mask, Snap(100, 100, 100, 100, inPitLane: true, inStall: true, pitSvFlags: ticked, speed: 0)));
            var first = Through(mask, Snap(100, 100, 100, 100, laps: 1, speed: 80));
            tracker.UpdateFrame(first);
            Assert.That(Corners(first), Is.EqualTo(new double?[] { 100, 100, 100, 100 }));
            Assert.That(first.TyreNewSetFlags, Is.EqualTo(0), "the first exit from the stall: the sim already says a new set, so the page says nothing of one");
            Assert.That(new[] { mask.IsMasked(0), mask.IsMasked(1), mask.IsMasked(2), mask.IsMasked(3) }, Is.EqualTo(new[] { false, false, false, false }));
            Assert.That(tracker.TireHealthState, Is.EqualTo(0));
            for (int lap = 2; lap <= 12; lap++)
                Assert.That(Through(mask, Snap(100, 100, 100, 100, laps: lap)).TyreNewSetFlags, Is.EqualTo(0), "and for the whole stint");

            // What his recordings start at (99.98, 100.00) prints as 100 as well: not held either
            var start = new TyreSetMask();
            Through(start, Snap(99.98, 99.98, 100, 100, inPitLane: true, inStall: true, pitSvFlags: ticked, speed: 0));
            var printed = Through(start, Snap(99.98, 99.98, 100, 100, speed: 80));
            Assert.That(Corners(printed), Is.EqualTo(new double?[] { 99.98, 99.98, 100, 100 }), "the sim's own numbers, as they are");
            Assert.That(printed.TyreNewSetFlags, Is.EqualTo(0));

            // A reading that prints as less than 100 is a set that is replaced: 99.4 reads 99, so that corner is a new set
            var worn = new TyreSetMask();
            Through(worn, Snap(99.4, 99.98, 100, 100, inPitLane: true, inStall: true, pitSvFlags: ticked, speed: 0));
            var one = Through(worn, Snap(99.4, 99.98, 100, 100, speed: 80));
            Assert.That(Corners(one), Is.EqualTo(new double?[] { New, 99.98, 100, 100 }));
            Assert.That(one.TyreNewSetFlags, Is.EqualTo(TelemetrySnapshot.PIT_SV_LF_TIRE), "only the corner whose number was replaced");

            // The next real stop still changes the set and is held: the sim measures it at 70 on pit entry, the tyres are
            // ticked in the stall, and leaving makes the four a new set until the sim measures again
            Through(mask, Snap(70, 71, 72, 73, inPitLane: true, laps: 13, speed: 60));
            Through(mask, Snap(70, 71, 72, 73, inPitLane: true, inStall: true, pitSvFlags: ticked, laps: 13, speed: 0));
            var after = Through(mask, Snap(70, 71, 72, 73, laps: 13, speed: 80));
            Assert.That(Corners(after), Is.EqualTo(new double?[] { New, New, New, New }), "70 was the set that came off");
            Assert.That(after.TyreNewSetFlags, Is.EqualTo(AllFour));
            var measured = Through(mask, Snap(98, 99, 97, 98, inPitLane: true, laps: 26, speed: 60));
            Assert.That(Corners(measured), Is.EqualTo(new double?[] { 98, 99, 97, 98 }));
            Assert.That(measured.TyreNewSetFlags, Is.EqualTo(0));
        }

        [Test]
        public void TheNewSetFlagsAreZeroInTheDemoOnBothWires()
        {
            // The demo's tread is made up and nothing in it is held: the key says 0 however the live snapshot's mask stands
            var s = Snap(100, 50, 100, 15, newSet: 0x05);
            Assert.That((int)TelemetryFrame.BuildDict(s, demo: false)[NewSet], Is.EqualTo(0x05), "live: the mask's flags");
            Assert.That((int)TelemetryFrame.BuildDict(s, demo: true)[NewSet], Is.EqualTo(0), "demo: 0 on the WebSocket frame");

            string dataDir = Path.Combine(Path.GetTempPath(), "racing-desk-tyre-demo-" + Guid.NewGuid().ToString("N"));
            int httpPort = FreePort();
            var runtime = new RacingDeskRuntime(new Settings { DemoMode = true }, new RacingDeskRuntime.Options
            {
                AssemblyDirectory = dataDir, PluginsDataDirectory = dataDir,
                HttpPort = httpPort, WsPort = FreePort(),
                EnableHardware = false, EnableSdkBridge = false, LoopbackOnly = true,
            });
            var sdk = new FakeSdk().Tread(0.90f, 0.90f, 0.90f, 0.90f).Car(false, false, 0, 150);
            var source = new IRacingTelemetrySource(sdk);
            using var http = new HttpClient();
            void Frames(int n = 14) { for (int i = 0; i < n; i++) { source.Update(); runtime.Tick(source); } }
            try
            {
                runtime.Start();
                Frames();
                sdk.Tread(0.15f, 0.16f, 0.60f, 0.62f).Car(true, false, 0, 60);
                Frames();
                sdk.Car(true, true, AllFour, 0);
                Frames();
                sdk.Car(false, false, 0, 80);
                Frames();
                Assert.That(runtime._current.TyreNewSetFlags, Is.EqualTo(AllFour), "the live mask still holds the four corners behind the demo");
                var wire = JObject.Parse(http.GetStringAsync($"http://127.0.0.1:{httpPort}/racing-desk/").Result);
                Assert.That((int)wire[NewSet], Is.EqualTo(0), "demo: 0 on the HTTP wire, and the page and the sidecar ignore it there too");
            }
            finally
            {
                runtime.Stop();
                try { Directory.Delete(dataDir, true); } catch { }
            }
        }

        [Test]
        public void ATwoTyreStopReadsANewSetOnTheTwoAndLeavesTheOthersAsMeasured()
        {
            var mask = new TyreSetMask();
            var tracker = new TireTracker();
            const int lefts = TelemetrySnapshot.PIT_SV_LF_TIRE | TelemetrySnapshot.PIT_SV_LR_TIRE;   // 0x05
            tracker.UpdateFrame(Through(mask, Snap(40, 50, 45, 15, inPitLane: true, laps: 6, speed: 60)));
            Assert.That(tracker.TireHealthState, Is.EqualTo(2), "the right rear at 15");
            Assert.That(tracker.Evaluate(new StintData()), Is.Not.Null, "the call for it, on the measurement's frame");
            tracker.UpdateFrame(Through(mask, Snap(40, 50, 45, 15, inPitLane: true, inStall: true, pitSvFlags: lefts, speed: 0)));
            var gone = Through(mask, Snap(40, 50, 45, 15, laps: 6, speed: 80));
            tracker.UpdateFrame(gone);
            tracker.OnNewStint();
            Assert.That(Corners(gone), Is.EqualTo(new double?[] { New, 50, New, 15 }), "the lefts are a new set at 100, the rights are the set that was measured");
            Assert.That(gone.TyreNewSetFlags, Is.EqualTo(lefts), "0x05: the two lefts");
            Assert.That(tracker.TireHealthState, Is.EqualTo(2), "the right rear is still at 15: its verdict stands, the pit box still offers the change");
            Assert.That(tracker.Worst(), Is.EqualTo(15));
            Assert.That(tracker.NewMeasurement, Is.False, "the lefts' 100 is not a measurement");
            Assert.That(tracker.Evaluate(new StintData()), Is.Null, "and the right rear is not called again for it");

            var fronts = new TyreSetMask();
            const int frontsOnly = TelemetrySnapshot.PIT_SV_LF_TIRE | TelemetrySnapshot.PIT_SV_RF_TIRE;   // 0x03
            Through(fronts, Snap(70, 60, 55, 18, inPitLane: true, speed: 60));
            Through(fronts, Snap(70, 60, 55, 18, inPitLane: true, inStall: true, pitSvFlags: frontsOnly, speed: 0));
            var two = Through(fronts, Snap(70, 60, 55, 18, speed: 80));
            Assert.That(Corners(two), Is.EqualTo(new double?[] { New, New, 55, 18 }));
            Assert.That(two.TyreNewSetFlags, Is.EqualTo(frontsOnly));
        }

        [Test]
        public void AStopThatChangedNoTyreHoldsNothing()
        {
            var mask = new TyreSetMask();
            Through(mask, Snap(15, 16, 60, 62, inPitLane: true, speed: 60));
            Through(mask, Snap(15, 16, 60, 62, inPitLane: true, inStall: true, pitSvFlags: TelemetrySnapshot.PIT_SV_FUEL, speed: 0));
            var fuelOnly = Through(mask, Snap(15, 16, 60, 62, speed: 80));
            Assert.That(Corners(fuelOnly), Is.EqualTo(new double?[] { 15, 16, 60, 62 }), "fuel only: the set is the one that was measured");
            Assert.That(fuelOnly.TyreNewSetFlags, Is.EqualTo(0), "nothing is a new set");

            // Tyres ticked on pit road and the stall never reached (a drive-through): nothing was changed
            var through = new TyreSetMask();
            Through(through, Snap(15, 16, 60, 62, inPitLane: true, pitSvFlags: AllFour, speed: 60));
            var driveThrough = Through(through, Snap(15, 16, 60, 62, speed: 80));
            Assert.That(Corners(driveThrough), Is.EqualTo(new double?[] { 15, 16, 60, 62 }));
            Assert.That(driveThrough.TyreNewSetFlags, Is.EqualTo(0));
        }

        [Test]
        public void ASimThatMeasuresInTheStallAfterTheChangeIsNotHeld()
        {
            var mask = new TyreSetMask();
            Through(mask, Snap(15, 16, 60, 62, inPitLane: true, speed: 60));
            Through(mask, Snap(15, 16, 60, 62, inPitLane: true, inStall: true, pitSvFlags: AllFour, speed: 0));
            Through(mask, Snap(98, 99, 97, 98, inPitLane: true, inStall: true, pitSvFlags: AllFour, speed: 0));   // the sim refreshed with the new set on
            var s = Through(mask, Snap(98, 99, 97, 98, speed: 80));
            Assert.That(Corners(s), Is.EqualTo(new double?[] { 98, 99, 97, 98 }), "that reading is the new set's: shown");
            Assert.That(s.TyreNewSetFlags, Is.EqualTo(0), "measured, not assumed");
        }

        [Test]
        public void ACornerNotYetMeasuredIsNeverHeldAndAResetForgets()
        {
            var mask = new TyreSetMask();
            Through(mask, Snap(null, 16, 60, 62, inPitLane: true, speed: 60));
            Through(mask, Snap(null, 16, 60, 62, inPitLane: true, inStall: true, pitSvFlags: AllFour, speed: 0));
            var s = Through(mask, Snap(null, 16, 60, 62, speed: 80));
            Assert.That(Corners(s), Is.EqualTo(new double?[] { null, New, New, New }), "the three that were measured read the new set's 100; the front left has nothing to hold");
            Assert.That(mask.IsMasked(0), Is.False, "nothing was shown for the front left, so there was nothing to hold back");
            Assert.That(s.TyreNewSetFlags, Is.EqualTo(AllFour & ~TelemetrySnapshot.PIT_SV_LF_TIRE));
            Assert.That(Corners(Through(mask, Snap(80, 16, 60, 62, speed: 80))), Is.EqualTo(new double?[] { 80, New, New, New }), "its first measurement is shown");

            mask.Reset();
            var forgot = Through(mask, Snap(80, 16, 60, 62, speed: 80));
            Assert.That(Corners(forgot), Is.EqualTo(new double?[] { 80, 16, 60, 62 }), "a new session or another car: nothing is held back");
            Assert.That(forgot.TyreNewSetFlags, Is.EqualTo(0));
            Assert.That(Through(mask, new TelemetrySnapshot { GameRunning = false, TyreWearFL = 5 }).TyreWearFL, Is.EqualTo(5), "with no game running the snapshot is left alone");
        }

        /// <summary>The whole stop, from iRacing's variables to every reader: the HTTP wire, the WebSocket frame, the commentary's trigger and the strategist.</summary>
        [Test]
        public void ANewSetReads100OnTheWireInTheTriggerAndInTheStrategistUntilTheSimMeasuresAgain()
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
                var stint = Wire();
                Assert.That(OnTheWire(stint), Is.EqualTo(new double?[] { 90, 90, 90, 90 }).Within(0.01), "a stint on a set measured at 90");
                Assert.That((int)stint[NewSet], Is.EqualTo(0), "the sim's own numbers: no corner is a new set");

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
                var stall = Wire();
                Assert.That(OnTheWire(stall), Is.EqualTo(new double?[] { 15, 16, 60, 62 }).Within(0.01));
                Assert.That((int)stall[NewSet], Is.EqualTo(0));

                // Out on four new tyres. The sim goes on showing the set that came off (15, 16, 60, 62) for the whole stint.
                sdk.Car(false, false, 0, 80);
                Frames();
                var fresh = Wire();
                Assert.That(OnTheWire(fresh), Is.EqualTo(new double?[] { 100, 100, 100, 100 }), "the HTTP wire: a new set, 100, never the removed set's number and not a null");
                Assert.That((int)fresh[NewSet], Is.EqualTo(AllFour), "and the wire says which corners read so: all four, 0x0F");
                var frame = TelemetryFrame.BuildDict(runtime._current, demo: false);
                Assert.That((double)frame[FL], Is.EqualTo(100.0), "the WebSocket frame: the same");
                Assert.That((double)frame[RR], Is.EqualTo(100.0));
                Assert.That((int)frame[NewSet], Is.EqualTo(AllFour));
                Assert.That(runtime._current.TyreWearWorst, Is.EqualTo(100.0));
                Assert.That(Fires(topic, runtime._current), Is.False, "the commentary's trigger sees nothing worn: a new set never fires it");
                Assert.That((int)fresh["RacingDesk.Plugin.Strategy.TireHealthState"], Is.EqualTo(0), "the strategist: a new set is healthy, the verdict goes with the old reading");
                Assert.That(runtime._strategy.Tires.NewMeasurement, Is.False, "and the 100 is not a measurement: no call is made from it");
                Assert.That(runtime._strategy.Tires.GripScore, Is.EqualTo(0));

                // A lap, two, on the same readings
                for (int lap = 4; lap <= 6; lap++) { sdk.Values["LapCompleted"] = lap; sdk.Values["Lap"] = lap + 1; sdk.Values["LapLastLapTime"] = 92f; Frames(); }
                var later = Wire();
                Assert.That(OnTheWire(later), Is.EqualTo(new double?[] { 100, 100, 100, 100 }), "laps later, the same old readings: still the new set's 100");
                Assert.That((int)later[NewSet], Is.EqualTo(AllFour));
                Assert.That(Fires(topic, runtime._current), Is.False);
                Assert.That((int)later["RacingDesk.Plugin.Strategy.TireHealthState"], Is.EqualTo(0));

                // The next pit entry: the sim measures the new set
                sdk.Tread(0.88f, 0.87f, 0.90f, 0.91f).Car(true, false, 0, 60);
                Frames();
                var next = Wire();
                Assert.That(OnTheWire(next), Is.EqualTo(new double?[] { 88, 87, 90, 91 }).Within(0.01), "measured again: the real number replaces the 100");
                Assert.That((int)next[NewSet], Is.EqualTo(0), "and no corner is a new set by assumption any more");
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
