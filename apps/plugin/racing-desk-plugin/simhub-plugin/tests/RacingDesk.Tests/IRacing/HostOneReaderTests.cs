using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using IRSDKSharper;
using NUnit.Framework;
using RacingDesk.Host;
using RacingDesk.Plugin;
using RacingDesk.Plugin.Engine;
using RacingDesk.Plugin.IRacing;
using RacingDesk.Tests.Names;
using HostProgram = RacingDesk.Host.Program;

namespace RacingDesk.Tests.IRacing
{
    /// <summary>
    /// RacingDesk.Host reads iRacing once: the runtime's SDK bridge is fed from the host's own reader instead of reading the sim
    /// again (the session YAML parsed once, not twice), and beside SimHub (<c>--beside-simhub</c>, which the app gives a host it
    /// starts on :18889) a frame follows the car and builds nothing for the HUD, which reads SimHub's plugin. No sim here: the
    /// reader's events are raised by hand, and nothing listens on any address but loopback.
    /// </summary>
    [TestFixture]
    public class HostOneReaderTests
    {
        private string _dir = "";

        [SetUp]
        public void SetUp()
        {
            _dir = Path.Combine(Path.GetTempPath(), "racing-desk-one-reader-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(_dir);
        }

        [TearDown]
        public void TearDown()
        {
            try { Directory.Delete(_dir, true); } catch { }
        }

        [Test]
        public void TheHostStartsNoReaderOfItsOwnInTheRuntime_AndTakesTheBesideSimHubFlag()
        {
            var live = HostProgram.RuntimeOptions(HostOptions.Parse(new[] { "--http-port", "18889", "--ws-port", "18890" }), _dir, Path.Combine(_dir, "none.db"));
            Assert.That(live.EnableSdkBridge, Is.False, "live, the bridge is fed from the host's one reader (FollowSdk), never a second");
            Assert.That(live.EnableHardware, Is.True, "and nothing else about the live host changes");

            Assert.That(HostOptions.Parse(new string[0]).BesideSimHub, Is.False, "a host started by hand, or on :8889, builds its telemetry as it did");
            Assert.That(HostOptions.Parse(new[] { "--http-port", "18889", "--ws-port", "18890", "--no-hardware", "--beside-simhub", "--parent-pid", "4" }).BesideSimHub, Is.True);
        }

        [Test]
        public void TheBridgeFollowsTheHostsReader_ConnectedTheSessionsFactsAndGone()
        {
            using var raw = new SdkRawTelemetry();
            var bridge = new IRacingSdkBridge();
            bridge.Follow(raw);
            object sdk = typeof(SdkRawTelemetry).GetField("_sdk", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(raw);

            Raise(sdk, typeof(IRacingSdk), "OnConnected");
            Assert.That(bridge.IsConnected, Is.True, "connected when the host's reader is");
            Assert.That(bridge.IsStarted, Is.False, "and no reader of its own was started");

            Raise(raw, typeof(SdkRawTelemetry), "SessionInfoRead", SessionInfoYaml.Parse(SyntheticField.Yaml()));
            Assert.That(bridge.PlayerIRating, Is.EqualTo(1500));
            Assert.That(bridge.PlayerLicenseString, Is.EqualTo("A 2.37"));
            Assert.That(bridge.PlayerCarPath, Is.EqualTo("mx5 mx52016"));
            Assert.That(bridge.TrackId, Is.EqualTo(777));
            Assert.That(bridge.IncidentLimitDQ, Is.EqualTo(17));
            Assert.That(bridge.FieldSize, Is.GreaterThanOrEqualTo(7), "his and the six rivals' ratings, for the iRating estimate");
            Assert.That(bridge.FieldNamed, Is.True);

            Raise(sdk, typeof(IRacingSdk), "OnDisconnected");
            Assert.That(bridge.IsConnected, Is.False);
            Assert.That(bridge.TrackId, Is.Zero, "the session of the sim that went is not the next one's");
            Assert.That(bridge.FieldNamed, Is.False);
        }

        [Test]
        public void BesideSimHub_AFrameFollowsTheCar_AndBuildsNothingForTheHud()
        {
            var raw = new Raw();
            var source = new IRacingTelemetrySource(raw);
            var runtime = new RacingDeskRuntime(new Settings(), new RacingDeskRuntime.Options
            {
                AssemblyDirectory = _dir, PluginsDataDirectory = _dir,
                HttpPort = FreePort(), WsPort = FreePort(),
                EnableHardware = false, EnableSdkBridge = false, LoopbackOnly = true,
            });
            try
            {
                runtime.Start();
                for (int i = 0; i < 12; i++) HostProgram.Frame(source, runtime, telemetry: false);
                Assert.That(source.CarPath, Is.EqualTo("mx5 mx52016"), "which car he is in, for the recorders, the restore and the car list");
                Assert.That(HostProgram.SeatOf(source).CarPath, Is.EqualTo("mx5 mx52016"), "the restore's facts: the car");
                Assert.That(HostProgram.SeatOf(source).IsOnTrack, Is.True, "and the sim's own variables, read as they are asked");
                Assert.That(TelemetryCapture.Cars.CarPath, Is.EqualTo("mx5 mx52016"), "the car list's check follows the car, for the desk's remarks");
                Assert.That(runtime._current.GameRunning, Is.False, "no snapshot, leaderboard or WebSocket frame: SimHub's plugin is what the HUD reads");
                Assert.That(runtime._frameCount, Is.Zero, "and no engine has run");

                HostProgram.Frame(source, runtime, telemetry: true);
                Assert.That(runtime._current.GameRunning, Is.True, "a host on :8889 builds the whole frame, as it always did");
                Assert.That(runtime._current.CarModel, Is.Not.Empty);
            }
            finally
            {
                runtime.Stop();
            }
        }

        // An event's delegate, raised as its owner would raise it.
        private static void Raise(object target, Type type, string field, params object[] args)
        {
            var handlers = (Delegate)type.GetField(field, BindingFlags.Instance | BindingFlags.NonPublic).GetValue(target);
            Assert.That(handlers, Is.Not.Null, field + " has a handler");
            handlers.DynamicInvoke(args);
        }

        private static int FreePort()
        {
            var l = new TcpListener(IPAddress.Loopback, 0);
            l.Start();
            int port = ((IPEndPoint)l.LocalEndpoint).Port;
            l.Stop();
            return port;
        }

        /// <summary>The sim as the host reads it: the synthetic field's session, him in his car on track.</summary>
        private sealed class Raw : IRawTelemetry
        {
            private readonly Dictionary<string, object> _values = new Dictionary<string, object>
            {
                ["IsOnTrack"] = true, ["IsReplayPlaying"] = false, ["SessionNum"] = 0, ["SessionState"] = 4,
                ["Lap"] = 3, ["LapCompleted"] = 2, ["Speed"] = 40f, ["PlayerTrackSurface"] = 3,
            };

            public bool IsConnected => true;
            public IRacingSdkSessionInfo SessionInfo { get; } = SessionInfoYaml.Parse(SyntheticField.Yaml());
            public object GetValue(string name) => _values.TryGetValue(name, out var v) ? v : null;
        }
    }
}
