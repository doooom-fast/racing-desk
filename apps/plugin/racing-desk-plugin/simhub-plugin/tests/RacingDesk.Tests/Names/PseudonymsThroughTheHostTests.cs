using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using IRSDKSharper;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using RacingDesk.Core.Names;
using RacingDesk.Data;
using RacingDesk.Plugin;
using RacingDesk.Plugin.Engine;
using RacingDesk.Plugin.IRacing;
using RacingDesk.Plugin.Transport;
using RacingDesk.Tests.IRacing;

namespace RacingDesk.Tests.Names
{
    /// <summary>
    /// The host's path: a session of made-up drivers, read from an .ibt the way the host reads one (IbtFile parses the YAML
    /// and renames the field as it enters), through IRacingTelemetrySource and the runtime to every reader — the :8889
    /// JSON, the WebSocket frame, the leaderboard, the gaps, the incident coach's nearby drivers, the commentary's
    /// placeholders and the session the recorder stores. No reader shows a rival's real name; his own is his.
    /// </summary>
    [TestFixture]
    public class PseudonymsThroughTheHostTests
    {
        private string _dir = "";

        [SetUp]
        public void SetUp() => Directory.CreateDirectory(_dir = Path.Combine(Path.GetTempPath(), "racing-desk-names-" + Guid.NewGuid().ToString("N")));

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
        /// iRacing as the host reads it: the session from a real IbtFile (the production entry point for a file's names), and
        /// the frame's variables, with the field's positions and gaps, from a dictionary.
        /// </summary>
        private sealed class FileRaw : IRawTelemetry, IDisposable
        {
            private readonly IbtFile _file;
            public readonly Dictionary<string, object> Values = new Dictionary<string, object>();

            public FileRaw(string path)
            {
                _file = new IbtFile(path);
                var positions = SyntheticField.Positions();
                var f2 = new float[8];
                var best = new float[8];
                var last = new float[8];
                for (int i = 0; i < 8; i++) { f2[i] = positions[i] * 1.8f; best[i] = 92f + positions[i] * 0.3f; last[i] = best[i] + 0.4f; }
                Values["IsOnTrack"] = true;
                Values["IsReplayPlaying"] = false;
                Values["SessionNum"] = 0;
                Values["SessionTime"] = 640.0;
                Values["SessionState"] = 4;
                Values["SessionFlags"] = 0x4;
                Values["Lap"] = 9;
                Values["LapCompleted"] = 8;
                Values["LapDistPct"] = 0.42f;
                Values["Speed"] = 41f;
                Values["RPM"] = 5200f;
                Values["Gear"] = 4;
                Values["FuelLevel"] = 22f;
                Values["FuelLevelPct"] = 0.5f;
                Values["PlayerCarPosition"] = SyntheticField.PlayerPosition;
                Values["PlayerCarIdx"] = SyntheticField.PlayerCarIdx;
                Values["PlayerTrackSurface"] = 3;
                Values["OnPitRoad"] = false;
                Values["CarIdxPosition"] = positions;
                Values["CarIdxF2Time"] = f2;
                Values["CarIdxBestLapTime"] = best;
                Values["CarIdxLastLapTime"] = last;
                Values["CarIdxOnPitRoad"] = new bool[8];
                Values["CarIdxLapDistPct"] = new[] { 0.42f, 0.5f, 0.45f, 0.4f, 0.38f, 0.3f, 0.2f, 0f };
                Values["PlayerIncidents"] = 0;
                Values["DisplayUnits"] = 1;
            }

            public bool IsConnected => true;
            public IRacingSdkSessionInfo SessionInfo => _file.SessionInfo;
            public object GetValue(string name) => Values.TryGetValue(name, out var v) ? v : null;
            public void Dispose() => _file.Dispose();
        }

        private string WriteIbt(string yaml, string name = "field.ibt")
        {
            string path = Path.Combine(_dir, name);
            SyntheticLaps.Write(path, yaml, SyntheticLaps.Laps(2), new DateTime(2026, 10, 1, 12, 0, 0, DateTimeKind.Utc));
            return path;
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

        private static Dictionary<string, string> NamesByCar(IRacingSdkSessionInfo si) =>
            SyntheticField.Rivals.ToDictionary(r => r.Number, r => si.DriverInfo.Drivers.Single(d => d.CarIdx == r.CarIdx).UserName);

        [Test]
        public void TheFileRenamesItsFieldAsItIsParsedAndTheSourceNamesOpponentsByIt()
        {
            using var raw = new FileRaw(WriteIbt(SyntheticField.Yaml()));
            var si = raw.SessionInfo;
            var names = NamesByCar(si);
            Assert.That(names.Values.Distinct().Count(), Is.EqualTo(SyntheticField.Rivals.Length));
            foreach (var n in names.Values) Assert.That(TestNames.Book.List.ContainsShown(n), Is.True, n);
            Assert.That(si.DriverInfo.Drivers.Single(d => d.CarIdx == SyntheticField.PlayerCarIdx).UserName, Is.EqualTo(SyntheticField.PlayerName));

            var source = new IRacingTelemetrySource(raw);
            source.Update();
            var data = (IRacingTelemetrySource.NormalizedData)source.NewData;
            Assert.That(data.PlayerName, Is.EqualTo(SyntheticField.PlayerName), "his own name is his");
            Assert.That(data.Opponents, Has.Count.EqualTo(SyntheticField.Rivals.Length + 1), "the field and himself; not the pace car");
            foreach (var opp in data.Opponents)
            {
                string shown = source.OpponentName(opp);
                Assert.That(shown, Is.EqualTo(opp.Name));
                if (opp.IsPlayer) Assert.That(shown, Is.EqualTo(SyntheticField.PlayerName));
                else Assert.That(TestNames.Book.List.ContainsShown(shown), Is.True, shown);
            }
            SyntheticField.AssertNoRivalIn(string.Join("|", data.Opponents.Select(o => o.Name)), "the source's opponents");
            Assert.That(source.OpponentName("not an opponent"), Is.Null);
        }

        [Test]
        public void EveryReaderOfTheRuntimeShowsTheCharactersAndNeverTheInput()
        {
            int httpPort = FreePort();
            int wsPort;
            do wsPort = FreePort(); while (wsPort == httpPort);
            var runtime = NewRuntime(_dir, httpPort, wsPort);
            using var raw = new FileRaw(WriteIbt(SyntheticField.Yaml()));
            var source = new IRacingTelemetrySource(raw);
            try
            {
                runtime.Start();
                for (int i = 0; i < 20; i++)
                {
                    raw.Values["SessionTime"] = 640.0 + i / 60.0;
                    source.Update();
                    runtime.Tick(source);
                }

                var expected = NamesByCar(raw.SessionInfo);

                // The snapshot: the gaps, which the spotter, the commentary and the incident coach read.
                var s = runtime._current;
                Assert.That(s.PlayerName, Is.EqualTo(SyntheticField.PlayerName));
                Assert.That(s.NearestAheadName, Is.EqualTo(expected[SyntheticField.Ahead.Number]));
                Assert.That(s.NearestBehindName, Is.EqualTo(expected[SyntheticField.Behind.Number]));
                Assert.That(s.NearestAheadRating, Is.EqualTo(SyntheticField.Ahead.IRating), "iRating stays");

                // The incident coach's nearby drivers, and the commentary's {ahead}/{behind}.
                var nearby = new IRacingIncidentDetector().GetNearbyDrivers(s);
                Assert.That(nearby.Select(n => n.Name), Is.EquivalentTo(new[] { s.NearestAheadName, s.NearestBehindName }));
                var assembler = new FragmentAssembler();
                string sentence = assembler.PerformSubstitution("{ahead} ahead, {behind} behind", s);
                Assert.That(sentence, Does.Contain(expected[SyntheticField.Ahead.Number]).And.Contain(expected[SyntheticField.Behind.Number]));
                SyntheticField.AssertNoRivalIn(sentence, "the commentary");

                // The leaderboard: every row a character, his own row his, each once.
                var board = JArray.Parse(runtime._leaderboardJson);
                Assert.That(board, Has.Count.EqualTo(SyntheticField.Rivals.Length + 1));
                var rows = board.Select(r => (Pos: (int)r[0], Name: (string)r[1]!, IsPlayer: (int)r[7] == 1)).ToList();
                Assert.That(rows.Single(r => r.IsPlayer).Name, Is.EqualTo(SyntheticField.PlayerName));
                foreach (var row in rows.Where(r => !r.IsPlayer))
                {
                    var rival = SyntheticField.Rivals.Single(r => r.Position == row.Pos);
                    Assert.That(row.Name, Is.EqualTo(expected[rival.Number]), $"P{row.Pos}");
                }
                Assert.That(rows.Select(r => r.Name).Distinct().Count(), Is.EqualTo(rows.Count));

                // The :8889 JSON, whole, and the WebSocket frame, whole: nothing of the input anywhere in them.
                using var http = new HttpClient();
                string body = http.GetStringAsync($"http://127.0.0.1:{httpPort}/racing-desk/").Result;
                var json = JObject.Parse(body);
                Assert.That((string)json["IRacingExtraProperties.iRacing_Opponent_Ahead_Name"]!, Is.EqualTo(expected[SyntheticField.Ahead.Number]));
                Assert.That((string)json["IRacingExtraProperties.iRacing_Opponent_Behind_Name"]!, Is.EqualTo(expected[SyntheticField.Behind.Number]));
                Assert.That((string)json["RacingDesk.Plugin.DriverFirstName"]!, Is.EqualTo("Test"));
                Assert.That((string)json["RacingDesk.Plugin.DriverLastName"]!, Is.EqualTo("Driver"));
                Assert.That(json["RacingDesk.Plugin.Leaderboard"], Is.InstanceOf<JArray>());
                SyntheticField.AssertNoRivalIn(body, "the :8889 JSON");

                var frame = TelemetryFrame.BuildDict(s, false, runtime._engine, runtime._strategy, runtime._incidentCoach, runtime._trackMap,
                    null, runtime._leaderboardJson);
                string wire = string.Join("\n", frame.Select(kv => kv.Key + "=" + Convert.ToString(kv.Value, System.Globalization.CultureInfo.InvariantCulture)));
                Assert.That((string)frame["IRacingExtraProperties.iRacing_Opponent_Ahead_Name"], Is.EqualTo(expected[SyntheticField.Ahead.Number]));
                Assert.That((string)frame["RacingDesk.Plugin.Leaderboard"], Does.Contain(expected[SyntheticField.Behind.Number]));
                SyntheticField.AssertNoRivalIn(wire, "the WebSocket frame");
            }
            finally
            {
                runtime.Stop();
            }
        }

        [Test]
        public void TheRecorderStoresTheCharactersAndHisOwnName()
        {
            using var raw = new FileRaw(WriteIbt(SyntheticField.Yaml()));
            var record = new SessionRecord { SessionNum = 0 };
            SessionAccumulator.ApplySessionInfo(record, raw.SessionInfo);
            Assert.That(record.DriverName, Is.EqualTo(SyntheticField.PlayerName));
            Assert.That(record.DriverCustId, Is.EqualTo(SyntheticField.PlayerCustId));
            Assert.That(record.Grid, Has.Count.EqualTo(SyntheticField.Rivals.Length + 1), "not the pace car");
            var expected = NamesByCar(raw.SessionInfo);
            foreach (var g in record.Grid.Where(g => !g.IsPlayer))
            {
                var rival = SyntheticField.Rivals.Single(r => r.CarIdx == g.CarIdx);
                Assert.That(g.Name, Is.EqualTo(expected[rival.Number]));
                Assert.That(g.CustId, Is.EqualTo(rival.CustId), "the id is kept, so the route can name him the same later");
                Assert.That(g.IRating, Is.EqualTo(rival.IRating));
            }
            Assert.That(record.Grid.Single(g => g.IsPlayer).Name, Is.EqualTo(SyntheticField.PlayerName));
            SyntheticField.AssertNoRivalIn(string.Join("|", record.Grid.Select(g => g.Name)), "the stored grid");
            Assert.That(record.Cars.Select(c => c.CarPath), Is.EquivalentTo(new[] { "mx5 mx52016" }), "cars stay cars");
        }

        [Test]
        public void ATeammateInHisCarIsACharacterOnTheHostsPathAndInTheStore()
        {
            using var raw = new FileRaw(WriteIbt(SyntheticField.Yaml(teammateDriving: true)));
            var source = new IRacingTelemetrySource(raw);
            source.Update();
            var data = (IRacingTelemetrySource.NormalizedData)source.NewData;
            Assert.That(TestNames.Book.List.ContainsShown(data.PlayerName), Is.True, data.PlayerName);
            Assert.That(data.Opponents.Single(o => o.IsPlayer).Name, Is.EqualTo(data.PlayerName));

            var record = new SessionRecord { SessionNum = 0 };
            SessionAccumulator.ApplySessionInfo(record, raw.SessionInfo);
            Assert.That(record.DriverName, Is.EqualTo(data.PlayerName));
            SyntheticField.AssertNoRivalIn(data.PlayerName + "|" + string.Join("|", data.Opponents.Select(o => o.Name)) + "|" +
                string.Join("|", record.Grid.Select(g => g.Name)), "the host's path with the teammate in his car");
        }

        [Test]
        public void TheSameRivalIsTheSameCharacterInTheNextSessionAndWhenHeIsTheOnlyOneThere()
        {
            using var first = new FileRaw(WriteIbt(SyntheticField.Yaml(), "one.ibt"));
            using var second = new FileRaw(WriteIbt(SyntheticField.Yaml(sessionId: 6002, subSessionId: 80020004, reverse: true), "two.ibt"));
            var a = NamesByCar(first.SessionInfo);
            var b = NamesByCar(second.SessionInfo);
            Assert.That(b, Is.EqualTo(a));
            foreach (var r in SyntheticField.Rivals)
                Assert.That(TestNames.Book.NewSession().For(r.CustId, "whoever"), Is.EqualTo(a[r.Number]), $"car #{r.Number} alone");
        }
    }
}
