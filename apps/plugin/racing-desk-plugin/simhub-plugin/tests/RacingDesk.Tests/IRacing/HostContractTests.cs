using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using RacingDesk.Plugin;
using RacingDesk.Plugin.IRacing;

namespace RacingDesk.Tests.IRacing
{
    /// <summary>
    /// The runtime, fed straight from iRacing data (no SimHub), must serve the same :8889 contract as the
    /// SimHub plugin. The reference key set is a payload captured from the installed plugin.
    /// </summary>
    [TestFixture]
    public class HostContractTests
    {
        private static int FreePort()
        {
            var l = new TcpListener(IPAddress.Loopback, 0);
            l.Start();
            int port = ((IPEndPoint)l.LocalEndpoint).Port;
            l.Stop();
            return port;
        }

        private static string FindFixture()
        {
            for (var dir = new DirectoryInfo(TestContext.CurrentContext.TestDirectory); dir != null; dir = dir.Parent)
            {
                string candidate = Path.Combine(dir.FullName, "apps", "overlay", "tests", "golden", "fixtures", "base-payload.json");
                if (File.Exists(candidate)) return candidate;
            }
            return null;
        }

        // SessionFlags as the recording has it for the frame the raw source is on: the SDK hands a bitfield over as an int.
        private static long RecordedFlags(IbtRawTelemetry raw) => unchecked((uint)(int)raw.GetValue("SessionFlags"));

        // The one word as it has always been made from the bits (FLAG_YELLOW is a local yellow and a full-course caution).
        private static string WordFor(long flags)
            => (flags & 0x10) != 0 ? "red" : (flags & 0x100000) != 0 ? "meatball" : (flags & 0x10000) != 0 ? "black"
                : (flags & (0x8 | 0x4000 | 0x8000)) != 0 ? "yellow" : (flags & 0x20) != 0 ? "blue" : (flags & 0x40) != 0 ? "debris"
                : (flags & 0x2) != 0 ? "white" : (flags & 0x1) != 0 ? "checkered" : (flags & 0x4) != 0 ? "green" : "none";

        private static int FrameWithAFlagOut(IbtRawTelemetry raw, int from, int to)
        {
            for (int i = Math.Max(0, from); i < to; i += 15)
            {
                if (!raw.Seek(i)) return -1;
                if (WordFor(RecordedFlags(raw)) != "none") return i;
            }
            return -1;
        }

        private static void AssertFlagsAreTheRecordings(JObject body, IbtRawTelemetry raw)
        {
            var flagKey = body["DataCorePlugin.GameRawData.Telemetry.SessionFlags"];
            Assert.That(flagKey, Is.Not.Null, "the recording says its SessionFlags, so the host sends them");
            Assert.That(flagKey.Type, Is.EqualTo(JTokenType.Integer));
            long recorded = RecordedFlags(raw);
            long sent = (long)flagKey;
            Assert.That(sent, Is.InRange(0L, (long)uint.MaxValue));
            Assert.That(sent, Is.EqualTo(recorded), $"the key is the recording's SessionFlags for this frame, 0x{recorded:X}");
            string word = (string)body["currentFlagState"];
            if (word != "orange") // the car ahead being lapped is not in the field
                Assert.That(word, Is.EqualTo(WordFor(recorded)), $"currentFlagState for the recording's SessionFlags 0x{recorded:X}");
        }

        [Test]
        public void IbtFedRuntimeServesThePluginContract()
        {
            var race = IbtFileTests.NewestRace();
            Assume.That(race, Is.Not.Null, "no .ibt race history on this machine");
            string fixturePath = FindFixture();
            Assume.That(fixturePath, Is.Not.Null, "plugin payload fixture not found");

            string dataDir = Path.Combine(Path.GetTempPath(), "racing-desk-contract-" + Guid.NewGuid().ToString("N"));
            int httpPort = FreePort();
            var runtime = new RacingDeskRuntime(new Settings(), new RacingDeskRuntime.Options
            {
                AssemblyDirectory = dataDir,
                PluginsDataDirectory = dataDir,
                HttpPort = httpPort,
                WsPort = FreePort(),
                EnableHardware = false,
                EnableSdkBridge = false,
                LoopbackOnly = true,
            });

            using var ibt = new IbtFile(race.FullName);
            var raw = new IbtRawTelemetry(ibt);
            var source = new IRacingTelemetrySource(raw);
            try
            {
                runtime.Start();
                int start = Math.Min(ibt.RecordCount - 700, ibt.RecordCount / 2);
                for (int i = start; i < start + 600; i++)
                {
                    Assert.That(raw.Seek(i), Is.True);
                    source.Update();
                    runtime.Tick(source);
                }

                using var http = new HttpClient();
                var body = JObject.Parse(http.GetStringAsync($"http://127.0.0.1:{httpPort}/racing-desk/").Result);
                var fixture = JObject.Parse(File.ReadAllText(fixturePath));

                var hostKeys = body.Properties().Select(p => p.Name).ToHashSet();
                var pluginKeys = fixture.Properties().Select(p => p.Name).ToHashSet();

                var missing = pluginKeys.Except(hostKeys)
                    .Where(k => !k.StartsWith("RacingDesk.Plugin.DS.Moza") && k != "RacingDesk.Plugin.DS.PedalProfile")
                    .ToList();
                var extra = hostKeys.Except(pluginKeys)
                    .Where(k => !k.StartsWith("RacingDesk.Plugin.DS.Sector"))
                    .Where(k => k != "RacingDesk.Plugin.TrackMap.TrackDisplayName") // added in Phase 3, after the fixture was captured
                    .Where(k => k != "DataCorePlugin.GameRawData.Telemetry.IsOnTrack") // whether he is in the car: what the HUD is shown by
                    .Where(k => k != "DataCorePlugin.GameRawData.Telemetry.SessionFlags") // iRacing's flag field, whole: sent where the sim says it
                    .Where(k => k != "RacingDesk.Plugin.CarControls") // what the car has by the canonical list: sent for a car the list has
                    .ToList();
                Assert.That(missing, Is.Empty, "keys the plugin serves that the host doesn't (hardware keys excluded)");
                Assert.That(extra, Is.Empty, "keys the host serves that the plugin doesn't (per-track sector keys excluded)");

                Assert.That((int)body["DataCorePlugin.GameRunning"], Is.EqualTo(1));
                Assert.That((string)body["RacingDesk.Plugin.GameId"], Is.EqualTo("IRacing"));
                Assert.That((string)body["RacingDesk.Plugin.TrackMap.TrackSlug"], Is.EqualTo(ibt.SessionInfo.WeekendInfo.TrackName));
                Assert.That((int)body["DataCorePlugin.GameData.CurrentLap"], Is.GreaterThan(0));
                Assert.That((int)body["DataCorePlugin.GameRawData.Telemetry.IsOnTrack"], Is.EqualTo(1), "in the car, in the middle of a race");

                // iRacing's flag field is sent whole, as an unsigned number, and is the recording's own: the value of the frame
                // the host was just given, which the test reads from the recording itself. (In the middle of a race the real
                // value is usually 0x10040000, with no flag bit and the word none: a host that always sent 0, or a stale value,
                // must not pass, which is why the second look, below, is at a frame where a flag was out.)
                AssertFlagsAreTheRecordings(body, raw);

                // And again where something was out: the first frame after the window whose old word is not none. The key
                // has to follow the recording there too, and the word is made from the same bits.
                int probe = FrameWithAFlagOut(raw, start + 600, ibt.RecordCount);
                if (probe < 0) probe = FrameWithAFlagOut(raw, 0, start);
                if (probe >= 0)
                {
                    for (int i = Math.Max(0, probe - 2); i <= probe + 2 && i < ibt.RecordCount; i++)
                    {
                        Assert.That(raw.Seek(i), Is.True);
                        source.Update();
                        runtime.Tick(source);
                    }
                    TestContext.WriteLine($"SessionFlags checked again at frame {probe} of {ibt.RecordCount}: 0x{RecordedFlags(raw):X}");
                    var there = JObject.Parse(http.GetStringAsync($"http://127.0.0.1:{httpPort}/racing-desk/").Result);
                    AssertFlagsAreTheRecordings(there, raw);
                }
                Assert.That((string)body["RacingDesk.Plugin.TrackMap.TrackDisplayName"], Is.EqualTo(ibt.SessionInfo.WeekendInfo.TrackDisplayName));
                Assert.That((int)body["RacingDesk.Plugin.DS.SectorCount"], Is.EqualTo(ibt.SessionInfo.SplitTimeInfo.Sectors.Count), "sectors from SplitTimeInfo");
            }
            finally
            {
                runtime.Stop();
                try { Directory.Delete(dataDir, true); } catch { }
            }
        }
    }
}
