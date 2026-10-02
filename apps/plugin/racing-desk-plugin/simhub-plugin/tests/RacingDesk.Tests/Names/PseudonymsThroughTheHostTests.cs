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
        public void ATeamRaceIsStoredUnderHisIdWithOnlyHisOwnEntryFlaggedWhoeverIsAtTheWheel()
        {
            // The session lists his car twice, as a team's drivers are: the teammate first, then him. The recorder used to take
            // the first entry for his car as him, and flag every entry of the car as the player's.
            using var raw = new FileRaw(WriteIbt(SyntheticField.Yaml(teamRace: true)));
            var record = new SessionRecord { SessionNum = 0 };
            SessionAccumulator.ApplySessionInfo(record, raw.SessionInfo);
            Assert.That(record.DriverCustId, Is.EqualTo(SyntheticField.PlayerCustId));
            Assert.That(record.DriverName, Is.EqualTo(SyntheticField.PlayerName));
            var flagged = record.Grid.Where(g => g.IsPlayer).ToList();
            Assert.That(flagged, Has.Count.EqualTo(1), "one player");
            Assert.That(flagged[0].CustId, Is.EqualTo(SyntheticField.PlayerCustId));
            Assert.That(flagged[0].Name, Is.EqualTo(SyntheticField.PlayerName));
            var teammate = record.Grid.Single(g => g.CustId == SyntheticField.TeammateCustId);
            Assert.That(teammate.IsPlayer, Is.False);
            Assert.That(TestNames.Book.List.ContainsShown(teammate.Name), Is.True, "his teammate is a character in the store");
            SyntheticField.AssertNoRivalIn(string.Join("|", record.Grid.Select(g => g.Name)), "the stored grid of a team race");

            // The session that lists only the teammate, in his car: the id is still his (DriverUserID), and nothing of the
            // teammate's name is in the record.
            using var driving = new FileRaw(WriteIbt(SyntheticField.Yaml(teammateDriving: true), "teammate.ibt"));
            var other = new SessionRecord { SessionNum = 0 };
            SessionAccumulator.ApplySessionInfo(other, driving.SessionInfo);
            Assert.That(other.DriverCustId, Is.EqualTo(SyntheticField.PlayerCustId), "his id, not the teammate's at the wheel");
            SyntheticField.AssertNoRivalIn(other.DriverName + "|" + string.Join("|", other.Grid.Select(g => g.Name)), "the record with the teammate in his car");
        }

        [Test]
        public void ASpectatorIsRenamedToo()
        {
            using var raw = new FileRaw(WriteIbt(SyntheticField.Yaml(spectator: true)));
            var si = raw.SessionInfo;
            var spectator = si.DriverInfo.Drivers.Single(d => d.CarIdx == SyntheticField.SpectatorCarIdx);
            Assert.That(TestNames.Book.List.ContainsShown(spectator.UserName), Is.True, spectator.UserName);
            SyntheticField.AssertNoRivalIn(spectator.UserName + "|" + spectator.AbbrevName + "|" + spectator.Initials + "|" + spectator.TeamName, "the spectator");
            var everyone = si.DriverInfo.Drivers.Where(d => d.CarIsPaceCar == 0).Select(d => d.UserName).ToList();
            Assert.That(everyone.Distinct().Count(), Is.EqualTo(everyone.Count));

            var source = new IRacingTelemetrySource(raw);
            source.Update();
            var data = (IRacingTelemetrySource.NormalizedData)source.NewData;
            Assert.That(data.Opponents.Select(o => o.Name), Does.Not.Contain(spectator.UserName), "a spectator is no opponent");
        }

        [Test]
        public void TheSessionNamingRenamesANewObjectTheSameObjectRefilledAndEveryoneWhoAsksAtOnce()
        {
            var naming = new SessionNaming(() => TestNames.Book);
            Assert.That(naming.Named(null, 0), Is.Null);

            // A new object: renamed in place, and the same object comes back.
            var first = SessionInfoYaml.Parse(SyntheticField.Yaml());
            Assert.That(ReferenceEquals(naming.Named(first, 1), first), Is.True);
            AssertRenamed(first);

            // The same object at the same update: it has been seen, and is left as it is.
            var rival = first.DriverInfo.Drivers.Single(d => d.CarIdx == SyntheticField.Rivals[0].CarIdx);
            string character = rival.UserName;
            rival.UserName = "Tampered Name";
            Assert.That(naming.Named(first, 1).DriverInfo.Drivers.Single(d => d.CarIdx == rival.CarIdx).UserName, Is.EqualTo("Tampered Name"), "not named twice");

            // The same object filled again by the SDK (its update count moves on, and its drivers have their real names back):
            // renamed again, to the same characters.
            foreach (var r in SyntheticField.Rivals) first.DriverInfo.Drivers.Single(d => d.CarIdx == r.CarIdx).UserName = r.Name;
            Assert.That(naming.Named(first, 2), Is.SameAs(first));
            AssertRenamed(first);
            Assert.That(first.DriverInfo.Drivers.Single(d => d.CarIdx == rival.CarIdx).UserName, Is.EqualTo(character));

            // A new object at an update count already seen: renamed, for it is not the one that was.
            var second = SessionInfoYaml.Parse(SyntheticField.Yaml(reverse: true));
            Assert.That(naming.Named(second, 2), Is.SameAs(second));
            AssertRenamed(second);
            Assert.That(second.DriverInfo.Drivers.Single(d => d.CarIdx == rival.CarIdx).UserName, Is.EqualTo(character), "the same field in another order, the same names");

            // Everyone who asks at once, for an object nobody has named: each comes back with it renamed, and one table of
            // names stands behind them all.
            for (int round = 0; round < 20; round++)
            {
                var fresh = SessionInfoYaml.Parse(SyntheticField.Yaml(sessionId: 7000 + round, subSessionId: 9000 + round));
                var racing = new SessionNaming(() => TestNames.Book);
                using var start = new System.Threading.ManualResetEventSlim(false);
                var leaks = new System.Collections.Concurrent.ConcurrentBag<string>();
                var threads = Enumerable.Range(0, 8).Select(_ => new System.Threading.Thread(() =>
                {
                    start.Wait();
                    var got = racing.Named(fresh, 5);
                    foreach (var r in SyntheticField.Rivals)
                        if (got.DriverInfo.Drivers.Single(d => d.CarIdx == r.CarIdx).UserName == r.Name) leaks.Add(r.Name);
                })).ToList();
                threads.ForEach(t => t.Start());
                start.Set();
                threads.ForEach(t => t.Join());
                Assert.That(leaks, Is.Empty, "a reader got the model before it was renamed");
                AssertRenamed(fresh);
            }

            static void AssertRenamed(IRacingSdkSessionInfo si)
            {
                foreach (var r in SyntheticField.Rivals)
                {
                    var d = si.DriverInfo.Drivers.Single(x => x.CarIdx == r.CarIdx);
                    Assert.That(TestNames.Book.List.ContainsShown(d.UserName), Is.True, $"car #{r.Number}: {d.UserName}");
                }
                Assert.That(si.DriverInfo.Drivers.Single(d => d.CarIdx == SyntheticField.PlayerCarIdx).UserName, Is.EqualTo(SyntheticField.PlayerName));
            }
        }

        [Test]
        public void NothingThatReadsAnIbtFileCanGetTheRawSessionYamlWithEveryRealNameInIt()
        {
            string path = WriteIbt(SyntheticField.Yaml(), "raw.ibt");
            foreach (var type in new[] { typeof(IbtFile), typeof(IbtHeader) })
            {
                var exposed = type.GetMembers(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.Static)
                    .Where(m => m.Name.IndexOf("Yaml", StringComparison.OrdinalIgnoreCase) >= 0).Select(m => m.Name).ToList();
                Assert.That(exposed, Is.Empty, $"{type.Name} hands out the raw session YAML: {string.Join(", ", exposed)}");
            }

            // What a header-only pass is for is still there, from the text, without the text.
            var header = IbtFile.ReadHeader(path);
            Assert.That(header.DriverCars.Select(c => c.CarPath), Does.Contain("mx5 mx52016"));

            // And the file lets its text go once the model is parsed and renamed.
            using var file = new IbtFile(path);
            var field = typeof(IbtFile).GetField("_sessionInfoYaml", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)!;
            Assert.That(field.GetValue(file), Is.Not.Null, "held until it is needed");
            Assert.That(file.SessionInfo.DriverInfo.Drivers, Is.Not.Empty);
            Assert.That(field.GetValue(file), Is.Null, "and let go");
            SyntheticField.AssertNoRivalIn(string.Join("|", file.SessionInfo.DriverInfo.Drivers.Select(d => d.UserName)), "the parsed file");
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
