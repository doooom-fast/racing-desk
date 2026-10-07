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
    /// to call each (ITelemetrySource.OpponentName); the plugin's source asks <see cref="SimHubNaming"/> — the class the
    /// plugin itself calls, so these tests run its code — which asks the SDK bridge, which has read the session YAML and
    /// named every car by its customer id. The same field through this path shows the same characters as through the host's,
    /// a car the session does not list is still a character, and until the session has been read nobody is named.
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

        /// <summary>
        /// SimHub's Opponent, as far as the engine reads it by property name: the names and types GameReaderCommon gives
        /// them (SimHubOpponentTests reads them from SimHub's own assembly).
        /// </summary>
        public sealed class Opponent
        {
            public string Name { get; set; } = "";
            public string CarNumber { get; set; } = "";
            public int Position { get; set; }
            public double? IRacing_IRating { get; set; }
            public double? GaptoPlayer { get; set; }
            public TimeSpan BestLapTime { get; set; }
            public TimeSpan LastLapTime { get; set; }
            public bool IsCarInPit { get; set; }
            public bool IsCarInPitLane { get; set; }
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
        /// The plugin's source: SimHub's game data, its property bag, and the naming the plugin does (SimHubNaming, with the
        /// bridge), asked for every opponent's name as SimHubTelemetrySource asks it (by car number, name and SimHub's IsPlayer).
        /// </summary>
        private sealed class FakeSimHub : ITelemetrySource, IPlayerNameSource
        {
            public readonly GameData Data = new GameData();
            public readonly Dictionary<string, object> Props = new Dictionary<string, object>();
            public readonly SimHubNaming Naming = new SimHubNaming(() => TestNames.Book);
            public IRacingSdkBridge? Bridge { get => Naming.Bridge; set => Naming.Bridge = value; }
            public string Game = "IRacing";
            public bool GameRunning => true;
            public string GameName => Game;
            public object NewData => Data;
            public object GetPropertyValue(string fullName) => Props.TryGetValue(fullName, out var v) ? v : null;

            public string? OpponentName(object opponent) =>
                opponent is Opponent o ? Naming.Opponent(GameName, o.CarNumber, o.Name, o.IsPlayer) : null;

            public string PlayerName(string given) => Naming.Player(GameName, given);

            public FakeSimHub()
            {
                Data.PlayerName = SyntheticField.PlayerName;
                Data.Position = SyntheticField.PlayerPosition;
                Data.Opponents.Add(new Opponent { Name = SyntheticField.PlayerName, CarNumber = SyntheticField.PlayerNumber, Position = SyntheticField.PlayerPosition, IRacing_IRating = 1500, IsPlayer = true });
                foreach (var r in SyntheticField.Rivals)
                    Data.Opponents.Add(new Opponent
                    {
                        Name = r.Name, CarNumber = r.Number, Position = r.Position, IRacing_IRating = r.IRating,
                        GaptoPlayer = (r.Position - SyntheticField.PlayerPosition) * 1.8,
                        IsCarInPitLane = ReferenceEquals(r, SyntheticField.Behind),
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

            // The bridge before it has read the session: nobody is named, and nothing it is told is passed back.
            var cold = new IRacingSdkBridge();
            Assert.That(cold.FieldNamed, Is.False);
            Assert.That(cold.OpponentName("", "Zebedee Quorntalk", false), Is.Null);
            Assert.That(cold.OpponentName(SyntheticField.PlayerNumber, SyntheticField.TeammateName, true), Is.Null, "not even for the car SimHub says is his");
            Assert.That(cold.PlayerName(SyntheticField.TeammateName), Is.EqualTo(""), "the name in Settings stands in for it");
            Assert.That(bridge.FieldNamed, Is.True);

            // Nothing public on the bridge says a rival's name.
            string everything = string.Join("|", typeof(IRacingSdkBridge).GetProperties().Select(p => Convert.ToString(p.GetValue(bridge))));
            SyntheticField.AssertNoRivalIn(everything, "the bridge's properties");
            Assert.That(typeof(IRacingSdkBridge).GetMethod("GetSessionInfoYaml"), Is.Null, "the raw YAML, every name in it, is handed out no more");
        }

        [Test]
        public void HisOwnNameIsHisWhateverItsCaseSpacingOrAccents()
        {
            // He said on 2026-10-03: "don't change my name in the leaderboard". SimHub's name for him need not be the
            // session's to the letter: its case, spacing and accents may differ, and it is his all the same. A different
            // name in his car is another driver (SimHubFlaggingAnotherCarAsThePlayerIsNotTakenAsHim, the team race tests).
            var bridge = new IRacingSdkBridge();
            bridge.ApplySessionInfo(SessionInfoYaml.Parse(SyntheticField.Yaml()));
            string simHubs = "  " + SyntheticField.PlayerName.ToUpperInvariant().Replace(" ", "   ").Replace("E", "É") + " ";
            Assert.That(bridge.PlayerName(simHubs), Is.EqualTo(simHubs), "the player is him");
            Assert.That(bridge.OpponentName(SyntheticField.PlayerNumber, simHubs, true), Is.EqualTo(simHubs), "his row");
            Assert.That(bridge.OpponentName("", simHubs, false), Is.EqualTo(simHubs), "whatever SimHub's flag or number says");
            Assert.That(bridge.PlayerName(SyntheticField.PlayerName + " Jr"), Is.Not.EqualTo(SyntheticField.PlayerName + " Jr"), "another name is another driver");
            // A rival's real name is still a character's, even said of the player.
            var rival = SyntheticField.Rivals.First();
            Assert.That(bridge.PlayerName(rival.Name), Is.Not.EqualTo(rival.Name));
            Assert.That(TestNames.Book.List.ContainsShown(bridge.PlayerName(rival.Name)), Is.True);
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
            Assert.That(bridge.FieldNamed, Is.False);
            Assert.That(bridge.OpponentName("12", "Somebody New", false), Is.Null, "a car number from the old session names nobody from it");
            Assert.That(bridge.PlayerName(SyntheticField.PlayerName), Is.EqualTo(""));
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
                    else
                    {
                        var rival = SyntheticField.Rivals.Single(r => r.Position == pos);
                        Assert.That(name, Is.EqualTo(expected[rival.Number]), $"P{pos}");
                        // Read by SimHub's own names: the iRating, the gap and the pit lane, which used to read 0.
                        Assert.That((int)row[2]!, Is.EqualTo(rival.IRating), $"P{pos} iRating");
                        Assert.That((double)row[5]!, Is.EqualTo((pos - SyntheticField.PlayerPosition) * 1.8).Within(0.006), $"P{pos} gap");
                        Assert.That((int)row[6]!, Is.EqualTo(ReferenceEquals(rival, SyntheticField.Behind) ? 1 : 0), $"P{pos} in the pits");
                    }
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
        public void ATeammateInHisCarIsACharacterOnThePluginsPathToo()
        {
            var bridge = new IRacingSdkBridge();
            bridge.ApplySessionInfo(SessionInfoYaml.Parse(SyntheticField.Yaml(teammateDriving: true)));
            string shown = bridge.OpponentName(SyntheticField.PlayerNumber, SyntheticField.TeammateName, true);
            Assert.That(TestNames.Book.List.ContainsShown(shown), Is.True, shown);
            Assert.That(bridge.PlayerName(SyntheticField.TeammateName), Is.EqualTo(shown), "SimHub's PlayerName, the teammate's: the same character");
            Assert.That(bridge.OpponentName("#" + SyntheticField.PlayerNumber, SyntheticField.TeammateName, false), Is.EqualTo(shown),
                "found by the number, as SimHub may write it");

            // The capture: SimHub says the player is the teammate, and the source says who that is to be shown as.
            var simhub = new FakeSimHub { Bridge = bridge };
            simhub.Data.PlayerName = SyntheticField.TeammateName;
            simhub.Data.Opponents[0].Name = SyntheticField.TeammateName;
            var s = TelemetryCapture.Capture(simhub);
            Assert.That(s.PlayerName, Is.EqualTo(shown));
            SyntheticField.AssertNoRivalIn(s.PlayerName + "|" + s.NearestAheadName + "|" + s.NearestBehindName, "the capture");

            // Him back in his car: his own name again, from both.
            bridge.ApplySessionInfo(SessionInfoYaml.Parse(SyntheticField.Yaml()));
            Assert.That(bridge.PlayerName(SyntheticField.PlayerName), Is.EqualTo(SyntheticField.PlayerName));
            Assert.That(bridge.OpponentName(SyntheticField.PlayerNumber, SyntheticField.PlayerName, true), Is.EqualTo(SyntheticField.PlayerName));
        }

        [Test]
        public void IRacingWithoutTheBridgeNamesNobodyAndAnotherSimNamesEveryoneAsACharacter()
        {
            // iRacing but no bridge to read its session: nobody can be told from anybody, so nobody is shown.
            var simhub = new FakeSimHub { Bridge = null };
            var s = TelemetryCapture.Capture(simhub);
            Assert.That(s.PlayerName, Is.EqualTo(""));
            // (The capture keeps the last gap names it had, which are characters from an earlier moment, never SimHub's.)
            SyntheticField.AssertNoRivalIn(s.NearestAheadName + "|" + s.NearestBehindName, "the gaps with no bridge");

            // Another sim has no session to read: his own is SimHub's word, every other driver a character keyed on the name.
            var other = new FakeSimHub { Bridge = null, Game = "AssettoCorsaCompetizione" };
            var o = TelemetryCapture.Capture(other);
            Assert.That(o.PlayerName, Is.EqualTo(SyntheticField.PlayerName));
            Assert.That(TestNames.Book.List.ContainsShown(o.NearestAheadName), Is.True, o.NearestAheadName);
            Assert.That(TestNames.Book.List.ContainsShown(o.NearestBehindName), Is.True, o.NearestBehindName);
            Assert.That(o.NearestAheadName, Is.Not.EqualTo(o.NearestBehindName));
            SyntheticField.AssertNoRivalIn(o.NearestAheadName + "|" + o.NearestBehindName, "the gaps");
        }

        [Test]
        public void UntilTheSessionIsReadNoOneIsNamedAndSimHubsWordForThePlayerIsNotTrusted()
        {
            // SimHub's data arrives first, in a team race with his teammate in his car: the player is the teammate, whose real
            // name is in SimHub's PlayerName and in the opponent flagged as the player. Nothing of it may be shown.
            var bridge = new IRacingSdkBridge();
            var simhub = new FakeSimHub { Bridge = bridge };
            simhub.Data.PlayerName = SyntheticField.TeammateName;
            simhub.Data.Opponents[0].Name = SyntheticField.TeammateName;
            var before = TelemetryCapture.Capture(simhub);
            Assert.That(before.PlayerName, Is.EqualTo(""), "the commentary then says the name in Settings");
            SyntheticField.AssertNoRivalIn(before.PlayerName + "|" + before.NearestAheadName + "|" + before.NearestBehindName, "the capture before the session is read");

            int httpPort = FreePort();
            int wsPort;
            do wsPort = FreePort(); while (wsPort == httpPort);
            var runtime = NewRuntime(_dir, httpPort, wsPort);
            var cold = new FakeSimHub { Bridge = runtime._sdkBridge };
            cold.Data.PlayerName = SyntheticField.TeammateName;
            cold.Data.Opponents[0].Name = SyntheticField.TeammateName;
            try
            {
                runtime.Start();
                for (int i = 0; i < 5; i++) runtime.Tick(cold);
                Assert.That(runtime._leaderboardJson, Is.EqualTo("[]"), "no row is shown nameless: they are left out until they can be named");
                using var http = new HttpClient();
                SyntheticField.AssertNoRivalIn(http.GetStringAsync($"http://127.0.0.1:{httpPort}/racing-desk/").Result, "the :8889 JSON before the session is read");

                // Then the session is read, and every row is there, each a character, his own his: nobody changes name.
                runtime._sdkBridge.ApplySessionInfo(SessionInfoYaml.Parse(SyntheticField.Yaml(teammateDriving: true)));
                var expected = HostsNames();
                for (int i = 0; i < 5; i++) runtime.Tick(cold);
                var board = JArray.Parse(runtime._leaderboardJson);
                Assert.That(board, Has.Count.EqualTo(SyntheticField.Rivals.Length + 1));
                foreach (var row in board)
                {
                    string name = (string)row[1]!;
                    Assert.That(TestNames.Book.List.ContainsShown(name), Is.True, name);
                    if ((int)row[0]! != SyntheticField.PlayerPosition)
                        Assert.That(name, Is.EqualTo(expected[SyntheticField.Rivals.Single(r => r.Position == (int)row[0]!).Number]));
                }
                SyntheticField.AssertNoRivalIn(runtime._leaderboardJson + "|" + runtime._current.PlayerName, "the leaderboard after");
            }
            finally
            {
                runtime.Stop();
            }
        }

        [Test]
        public void SimHubFlaggingAnotherCarAsThePlayerIsNotTakenAsHim()
        {
            var bridge = new IRacingSdkBridge();
            bridge.ApplySessionInfo(SessionInfoYaml.Parse(SyntheticField.Yaml()));
            var expected = HostsNames();

            // A camera on a rival (a replay, spectating): SimHub says the rival is the player. He is not.
            var rival = SyntheticField.Rivals[1];
            string shown = bridge.OpponentName(rival.Number, rival.Name, true);
            Assert.That(shown, Is.EqualTo(expected[rival.Number]), "the rival's character, whatever SimHub flags");
            Assert.That(bridge.PlayerName(rival.Name), Is.EqualTo(expected[rival.Number]), "and SimHub's PlayerName for him likewise");
            SyntheticField.AssertNoRivalIn(shown + "|" + bridge.PlayerName(rival.Name), "the flagged rival");

            // His own, flagged or not, in the case SimHub writes it: his.
            Assert.That(bridge.OpponentName(SyntheticField.PlayerNumber, "TEST DRIVER ", true), Is.EqualTo("TEST DRIVER "));
            Assert.That(bridge.PlayerName(SyntheticField.PlayerName), Is.EqualTo(SyntheticField.PlayerName));

            // A teammate SimHub says is the player while the session still says he is in his car (the two reading the sim a
            // moment apart): a character, never the teammate's name.
            string teammate = bridge.OpponentName(SyntheticField.PlayerNumber, SyntheticField.TeammateName, true);
            Assert.That(TestNames.Book.List.ContainsShown(teammate), Is.True, teammate);
            Assert.That(bridge.PlayerName(SyntheticField.TeammateName), Is.EqualTo(teammate));
            SyntheticField.AssertNoRivalIn(teammate, "the teammate before the session knows");
        }

        [Test]
        public void ATeamRaceWithBothDriversListedNamesTheOneAtTheWheelByTheNameSimHubGives()
        {
            var bridge = new IRacingSdkBridge();
            bridge.ApplySessionInfo(SessionInfoYaml.Parse(SyntheticField.Yaml(teamRace: true)));
            // Him at the wheel: SimHub's player is him, whatever the session says of his teammate in the same car.
            Assert.That(bridge.PlayerName(SyntheticField.PlayerName), Is.EqualTo(SyntheticField.PlayerName));
            Assert.That(bridge.OpponentName(SyntheticField.PlayerNumber, SyntheticField.PlayerName, true), Is.EqualTo(SyntheticField.PlayerName));
            // The teammate at the wheel: a character, the same on both paths.
            var host = TestNames.Book.NewSession().Apply(SessionInfoYaml.Parse(SyntheticField.Yaml(teamRace: true)));
            string teammateShown = host.DriverInfo.Drivers.Single(d => d.UserID == SyntheticField.TeammateCustId).UserName;
            Assert.That(bridge.PlayerName(SyntheticField.TeammateName), Is.EqualTo(teammateShown));
            Assert.That(bridge.OpponentName(SyntheticField.PlayerNumber, SyntheticField.TeammateName, true), Is.EqualTo(teammateShown));
        }

        [Test]
        public void ForAnotherSimNoTwoDriversShareACharacterAndEachKeepsTheirs()
        {
            var naming = new SimHubNaming(() => TestNames.Book);
            const string game = "AssettoCorsaCompetizione";
            var names = Enumerable.Range(0, 60).Select(i => "Madeup Driver " + i).ToList();
            var given = names.Select(n => naming.Opponent(game, "", n, false)).ToList();
            Assert.That(given.Distinct().Count(), Is.EqualTo(names.Count), "one table for as long as the plugin runs, so no two are alike");
            foreach (string g in given) Assert.That(TestNames.Book.List.ContainsShown(g), Is.True, g);
            for (int i = 0; i < names.Count; i++)
                Assert.That(naming.Opponent(game, "7", names[i], false), Is.EqualTo(given[i]), "asked again, at another moment");
            Assert.That(naming.Opponent(game, "1", "Madeup Player", true), Is.EqualTo("Madeup Player"), "his own, as the sim says");
            Assert.That(naming.Player(game, "Madeup Player"), Is.EqualTo("Madeup Player"));
            Assert.That(naming.Player("IRacing", "Madeup Player"), Is.EqualTo(""), "no bridge, no word");

            // A table that has used up the list starts again rather than numbering: every name is still a character's.
            var small = new SimHubNaming(() => new PseudonymBook(PseudonymizerTests.ListOf("Ann One", "Bo Two", "Cy Three"), SyntheticField.SaltFromSeed(2)));
            var many = Enumerable.Range(0, 20).Select(i => small.Opponent(game, "", "Madeup Driver " + i, false)).ToList();
            Assert.That(many.Distinct(), Is.SubsetOf(new[] { "A. One", "B. Two", "C. Three" }));
        }

        [Test]
        public void ThePluginsOwnSourceAsksTheNamingForEveryNameAndTheBridgeIsHandedToIt()
        {
            // The plugin project is SimHub's and is not built with these tests, so what is checked here is its text: the one
            // place it reads an opponent's name hands it to SimHubNaming, with SimHub's game name, and the plugin gives the
            // source the bridge.
            string root = RepoRoot();
            string pluginDir = Path.Combine(root, "apps", "plugin", "racing-desk-plugin", "simhub-plugin", "plugin", "RacingDesk.Plugin");
            string source = File.ReadAllText(Path.Combine(pluginDir, "SimHubTelemetrySource.cs"));
            string plugin = File.ReadAllText(Path.Combine(pluginDir, "Plugin.cs"));

            Assert.That(source, Does.Contain("private readonly SimHubNaming _naming = new SimHubNaming();"));
            Assert.That(source, Does.Contain("_naming.Opponent(GameName, opp.CarNumber, opp.Name, opp.IsPlayer)"));
            Assert.That(source, Does.Contain("_naming.Player(GameName, given)"));
            Assert.That(source, Does.Contain("public IRacingSdkBridge Names { get => _naming.Bridge; set => _naming.Bridge = value; }"));
            Assert.That(System.Text.RegularExpressions.Regex.Matches(source, @"\bopp\.Name\b").Count, Is.EqualTo(1),
                "an opponent's name is read once, to be handed to SimHubNaming, and nowhere else");
            Assert.That(System.Text.RegularExpressions.Regex.IsMatch(source, @"\.PlayerName\b"), Is.False, "nor SimHub's PlayerName");
            Assert.That(plugin, Does.Contain("_source.Names = _rt._sdkBridge;"));
            Assert.That(plugin.IndexOf("_source.Names = _rt._sdkBridge;", StringComparison.Ordinal), Is.GreaterThan(plugin.IndexOf("_rt = new RacingDeskRuntime", StringComparison.Ordinal)),
                "after the runtime that owns the bridge is made");
            Assert.That(System.Text.RegularExpressions.Regex.Matches(plugin, @"_source\.Names\b").Count, Is.EqualTo(1));
        }

        private static string RepoRoot()
        {
            for (var dir = new DirectoryInfo(TestContext.CurrentContext.TestDirectory); dir != null; dir = dir.Parent)
                if (File.Exists(Path.Combine(dir.FullName, "racing-desk.sln"))) return dir.FullName;
            throw new InvalidOperationException("racing-desk.sln not found above the test directory");
        }
    }
}
