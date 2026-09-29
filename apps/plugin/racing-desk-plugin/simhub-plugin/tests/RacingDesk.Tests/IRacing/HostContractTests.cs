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
                var body = JObject.Parse(http.GetStringAsync($"http://localhost:{httpPort}/racing-desk/").Result);
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
                    .Where(k => k != "RacingDesk.Plugin.CarControls") // what the car has by the canonical list: sent for a car the list has
                    .ToList();
                Assert.That(missing, Is.Empty, "keys the plugin serves that the host doesn't (hardware keys excluded)");
                Assert.That(extra, Is.Empty, "keys the host serves that the plugin doesn't (per-track sector keys excluded)");

                Assert.That((int)body["DataCorePlugin.GameRunning"], Is.EqualTo(1));
                Assert.That((string)body["RacingDesk.Plugin.GameId"], Is.EqualTo("IRacing"));
                Assert.That((string)body["RacingDesk.Plugin.TrackMap.TrackSlug"], Is.EqualTo(ibt.SessionInfo.WeekendInfo.TrackName));
                Assert.That((int)body["DataCorePlugin.GameData.CurrentLap"], Is.GreaterThan(0));
                Assert.That((int)body["DataCorePlugin.GameRawData.Telemetry.IsOnTrack"], Is.EqualTo(1), "in the car, in the middle of a race");
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
