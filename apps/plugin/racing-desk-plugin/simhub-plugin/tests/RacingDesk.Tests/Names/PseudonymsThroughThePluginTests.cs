using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using RacingDesk.Core.Names;
using RacingDesk.Plugin;
using RacingDesk.Plugin.Engine;
using RacingDesk.Plugin.IRacing;
using RacingDesk.Plugin.Transport;

namespace RacingDesk.Tests.Names
{
    /// <summary>
    /// The plugin's path: SimHub hands the engine its opponents with their real names, and the engine asks the source what
    /// to call each (ITelemetrySource.OpponentName); the plugin's source asks the SDK bridge, which has read the session
    /// YAML and named every car by its customer id. The same field through this path shows the same characters as through
    /// the host's, and a car the session does not list is still a character.
    /// </summary>
    [TestFixture]
    public class PseudonymsThroughThePluginTests
    {
        private string _dir = "";

        [SetUp]
        public void SetUp() => Directory.CreateDirectory(_dir = Path.Combine(Path.GetTempPath(), "racing-desk-names-plugin-" + Guid.NewGuid().ToString("N")));

        [TearDown]
        public void TearDown() { try { Directory.Delete(_dir, true); } catch { } }

        private static int FreePort()
        {
            var l = new TcpListener(IPAddress.Loopback, 0);
            l.Start();
            int port = ((IPEndPoint)l.LocalEndpoint).Port;
            l.Stop();
            return port;
        }

        /// <summary>SimHub's Opponent, as far as the engine reads it by property name.</summary>
        public sealed class Opponent
        {
            public string Name { get; set; } = "";
            public string CarNumber { get; set; } = "";
            public int Position { get; set; }
            public int IRating { get; set; }
            public double GapToPlayer { get; set; }
            public TimeSpan BestLapTime { get; set; }
            public TimeSpan LastLapTime { get; set; }
            public bool IsInPit { get; set; }
            public bool IsPlayer { get; set; }
        }

        /// <summary>SimHub's StatusDataBase, as far as the engine reads it by property name.</summary>
        public sealed class GameData
        {
            public string PlayerName { get; set; } = "";
            public List<Opponent> Opponents { get; } = new List<Opponent>();
            public int Position { get; set; }
            public string SessionTypeName { get; set; } = "Race";
            public int CurrentLap { get; set; } = 9;
            public int CompletedLaps { get; set; } = 8;
            public double SpeedKmh { get; set; } = 150;
        }

        /// <summary>
        /// The plugin's source: SimHub's game data, its property bag, and the bridge, asked for every opponent's name as
        /// SimHubTelemetrySource asks it (by car number, name and SimHub's IsPlayer).
        /// </summary>
        private sealed class FakeSimHub : ITelemetrySource
        {
            public readonly GameData Data = new GameData();
            public readonly Dictionary<string, object> Props = new Dictionary<string, object>();
            public IRacingSdkBridge? Bridge;
            public bool GameRunning => true;
            public string GameName => "IRacing";
            public object NewData => Data;
            public object GetPropertyValue(string fullName) => Props.TryGetValue(fullName, out var v) ? v : null;

            public string? OpponentName(object opponent)
            {
                if (!(opponent is Opponent o)) return null;
                return Bridge == null ? TestNames.Book.NewSession().For(0, o.Name) : Bridge.OpponentName(o.CarNumber, o.Name, o.IsPlayer);
            }

            public FakeSimHub()
            {
                Data.PlayerName = SyntheticField.PlayerName;
                Data.Position = SyntheticField.PlayerPosition;
                Data.Opponents.Add(new Opponent { Name = SyntheticField.PlayerName, CarNumber = SyntheticField.PlayerNumber, Position = SyntheticField.PlayerPosition, IRating = 1500, IsPlayer = true });
                foreach (var r in SyntheticField.Rivals)
                    Data.Opponents.Add(new Opponent
                    {
                        Name = r.Name, CarNumber = r.Number, Position = r.Position, IRating = r.IRating,
                        GapToPlayer = (r.Position - SyntheticField.PlayerPosition) * 1.8,
                        BestLapTime = TimeSpan.FromSeconds(92 + r.Position * 0.3), LastLapTime = TimeSpan.FromSeconds(92.4 + r.Position * 0.3),
                    });
                const string raw = "DataCorePlugin.GameRawData.Telemetry.";
                Props[raw + "IsOnTrack"] = true;
                Props[raw + "SessionNum"] = 0;
                Props[raw + "SessionTime"] = 640.0;
                Props[raw + "SessionState"] = 4;
                Props[raw + "SessionFlags"] = 0x4;
                Props[raw + "PlayerCarIdx"] = SyntheticField.PlayerCarIdx;
                Props["DataCorePlugin.GameData.TrackName"] = "synthetic full";
            }
        }

        private static RacingDeskRuntime NewRuntime(string dir, int httpPort, int wsPort) =>
            new RacingDeskRuntime(new Settings(), new RacingDeskRuntime.Options
            {
                AssemblyDirectory = dir,
                PluginsDataDirectory = dir,
                HttpPort = httpPort,
                WsPort = wsPort,
                EnableHardware = false,
                EnableSdkBridge = false,
                LoopbackOnly = true,
            });

        /// <summary>The names the host's path gives the same field: what the plugin's must agree with.</summary>
        private static Dictionary<string, string> HostsNames()
        {
            var si = TestNames.Book.NewSession().Apply(SessionInfoYaml.Parse(SyntheticField.Yaml()));
            return SyntheticField.Rivals.ToDictionary(r => r.Number, r => si.DriverInfo.Drivers.Single(d => d.CarIdx == r.CarIdx).UserName);
        }

        [Test]
        public void TheBridgeNamesEachCarByItsCustomerIdAndKeepsTheRealNamesToItself()
        {
            var bridge = new IRacingSdkBridge();
            bridge.ApplySessionInfo(SessionInfoYaml.Parse(SyntheticField.Yaml()));
            var expected = HostsNames();
            foreach (var r in SyntheticField.Rivals)
            {
                Assert.That(bridge.OpponentName(r.Number, r.Name, false), Is.EqualTo(expected[r.Number]), $"car #{r.Number} by its number");
                Assert.That(bridge.OpponentName("", r.Name, false), Is.EqualTo(expected[r.Number]), $"car #{r.Number} by its name alone");
                Assert.That(bridge.OpponentName(r.Number, "", false), Is.EqualTo(expected[r.Number]), $"car #{r.Number} by its number alone");
            }
            Assert.That(bridge.OpponentName(SyntheticField.PlayerNumber, SyntheticField.PlayerName, true), Is.EqualTo(SyntheticField.PlayerName), "his own, as SimHub says");
            Assert.That(bridge.OpponentName("", SyntheticField.PlayerName, false), Is.EqualTo(SyntheticField.PlayerName), "his own, as the session says, whatever SimHub says");

            // A car the session does not list: still a character, by the name, and the same next time.
            string stranger = bridge.OpponentName("99", "Zebedee Quorntalk", false);
            Assert.That(TestNames.Book.List.ContainsShown(stranger), Is.True, stranger);
            Assert.That(stranger, Does.Not.Contain("Quorntalk"));
            Assert.That(bridge.OpponentName("99", "Zebedee Quorntalk", false), Is.EqualTo(stranger));
            Assert.That(expected.Values, Does.Not.Contain(stranger), "and not one of the field's");

            // Another sim, or the bridge not yet up: a character all the same.
            var cold = new IRacingSdkBridge();
            string shown = cold.OpponentName("", "Zebedee Quorntalk", false);
            Assert.That(TestNames.Book.List.ContainsShown(shown), Is.True);
            Assert.That(shown, Does.Not.Contain("Quorntalk"));

            // Nothing public on the bridge says a rival's name.
            string everything = string.Join("|", typeof(IRacingSdkBridge).GetProperties().Select(p => Convert.ToString(p.GetValue(bridge))));
            SyntheticField.AssertNoRivalIn(everything, "the bridge's properties");
            Assert.That(typeof(IRacingSdkBridge).GetMethod("GetSessionInfoYaml"), Is.Null, "the raw YAML, every name in it, is handed out no more");
        }

        [Test]
        public void TheNextSessionForgetsTheFieldButNotTheRule()
        {
            var bridge = new IRacingSdkBridge();
            bridge.ApplySessionInfo(SessionInfoYaml.Parse(SyntheticField.Yaml()));
            var first = SyntheticField.Rivals.ToDictionary(r => r.Number, r => bridge.OpponentName(r.Number, r.Name, false));
            bridge.ApplySessionInfo(SessionInfoYaml.Parse(SyntheticField.Yaml(sessionId: 6002, subSessionId: 80020004, reverse: true)));
            foreach (var r in SyntheticField.Rivals)
                Assert.That(bridge.OpponentName(r.Number, r.Name, false), Is.EqualTo(first[r.Number]), $"car #{r.Number} next time");
            bridge.OnDisconnected();
            string afterwards = bridge.OpponentName("12", "Somebody New", false);
            Assert.That(TestNames.Book.List.ContainsShown(afterwards), Is.True, "a car number from the old session names nobody from it");
            Assert.That(afterwards, Is.Not.EqualTo(first["12"]).Or.EqualTo(TestNames.Book.NewSession().For(0, "Somebody New")));
        }

        [Test]
        public void EveryReaderOfTheRuntimeShowsTheCharactersAndNeverSimHubsNames()
        {
            int httpPort = FreePort();
            int wsPort;
            do wsPort = FreePort(); while (wsPort == httpPort);
            var runtime = NewRuntime(_dir, httpPort, wsPort);
            var simhub = new FakeSimHub { Bridge = runtime._sdkBridge };
            runtime._sdkBridge.ApplySessionInfo(SessionInfoYaml.Parse(SyntheticField.Yaml()));
            var expected = HostsNames();
            try
            {
                runtime.Start();
                for (int i = 0; i < 20; i++)
                {
                    simhub.Props["DataCorePlugin.GameRawData.Telemetry.SessionTime"] = 640.0 + i / 60.0;
                    runtime.Tick(simhub);
                }

                var s = runtime._current;
                Assert.That(s.PlayerName, Is.EqualTo(SyntheticField.PlayerName));
                Assert.That(s.NearestAheadName, Is.EqualTo(expected[SyntheticField.Ahead.Number]), "the same character as the host's path");
                Assert.That(s.NearestBehindName, Is.EqualTo(expected[SyntheticField.Behind.Number]));
                Assert.That(s.NearestBehindRating, Is.EqualTo(SyntheticField.Behind.IRating));

                var board = JArray.Parse(runtime._leaderboardJson);
                Assert.That(board, Has.Count.EqualTo(SyntheticField.Rivals.Length + 1));
                foreach (var row in board)
                {
                    int pos = (int)row[0]!;
                    string name = (string)row[1]!;
                    if (pos == SyntheticField.PlayerPosition) Assert.That(name, Is.EqualTo(SyntheticField.PlayerName));
                    else Assert.That(name, Is.EqualTo(expected[SyntheticField.Rivals.Single(r => r.Position == pos).Number]), $"P{pos}");
                }

                using var http = new HttpClient();
                string body = http.GetStringAsync($"http://127.0.0.1:{httpPort}/racing-desk/").Result;
                var json = JObject.Parse(body);
                Assert.That((string)json["IRacingExtraProperties.iRacing_Opponent_Ahead_Name"]!, Is.EqualTo(expected[SyntheticField.Ahead.Number]));
                Assert.That((string)json["RacingDesk.Plugin.DriverFirstName"]!, Is.EqualTo("Test"));
                SyntheticField.AssertNoRivalIn(body, "the :8889 JSON");

                var frame = TelemetryFrame.BuildDict(s, false, runtime._engine, runtime._strategy, runtime._incidentCoach, runtime._trackMap,
                    null, runtime._leaderboardJson);
                string wire = string.Join("\n", frame.Select(kv => kv.Key + "=" + Convert.ToString(kv.Value, System.Globalization.CultureInfo.InvariantCulture)));
                SyntheticField.AssertNoRivalIn(wire, "the WebSocket frame");
            }
            finally
            {
                runtime.Stop();
            }
        }

        [Test]
        public void WithoutTheBridgeTheSourceStillNamesNobodyByTheirOwnName()
        {
            var simhub = new FakeSimHub { Bridge = null };
            var s = TelemetryCapture.Capture(simhub);
            Assert.That(TestNames.Book.List.ContainsShown(s.NearestAheadName), Is.True, s.NearestAheadName);
            Assert.That(TestNames.Book.List.ContainsShown(s.NearestBehindName), Is.True, s.NearestBehindName);
            SyntheticField.AssertNoRivalIn(s.NearestAheadName + "|" + s.NearestBehindName, "the gaps");
        }
    }
}
