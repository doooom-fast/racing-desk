using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Threading;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using RacingDesk.Plugin;
using HostProgram = RacingDesk.Host.Program;

namespace RacingDesk.Tests.Transport
{
    /// <summary>
    /// A host that has been asked to stop lets go of its ports at once, not when its orderly stop is over, which can take
    /// up to five seconds. For as long as it answered, an app starting in the meantime (the green-screen toggle relaunches
    /// the app within a second) took it for a host it could use, and had none once it ended: nothing recorded, nothing
    /// for the desk to show. Every runtime here listens on 127.0.0.1 alone, with no hardware and no sim.
    /// </summary>
    [TestFixture]
    public class StopListeningTests
    {
        private readonly List<RacingDeskRuntime> _runtimes = new List<RacingDeskRuntime>();
        private readonly List<string> _dirs = new List<string>();

        [TearDown]
        public void TearDown()
        {
            foreach (var runtime in _runtimes) try { runtime.Stop(); } catch { }
            _runtimes.Clear();
            foreach (var dir in _dirs) try { Directory.Delete(dir, true); } catch { }
            _dirs.Clear();
        }

        private static int FreePort()
        {
            var l = new TcpListener(IPAddress.Loopback, 0);
            l.Start();
            int port = ((IPEndPoint)l.LocalEndpoint).Port;
            l.Stop();
            return port;
        }

        private RacingDeskRuntime StartRuntime(int httpPort, int wsPort)
        {
            string dir = Path.Combine(Path.GetTempPath(), "racing-desk-stop-listening-" + Guid.NewGuid().ToString("N"));
            _dirs.Add(dir);
            var runtime = new RacingDeskRuntime(new Settings(), new RacingDeskRuntime.Options
            {
                AssemblyDirectory = dir,
                PluginsDataDirectory = dir,
                HttpPort = httpPort,
                WsPort = wsPort,
                EnableHardware = false,
                EnableSdkBridge = false,
                LoopbackOnly = true,
            });
            _runtimes.Add(runtime);
            runtime.Start();
            return runtime;
        }

        /// <summary>Whether a TCP connection to 127.0.0.1 is accepted. One that is, on this machine, is at once.</summary>
        private static bool Connects(int port)
        {
            using var client = new TcpClient(AddressFamily.InterNetwork);
            try { return client.ConnectAsync(IPAddress.Loopback, port).Wait(TimeSpan.FromSeconds(1)) && client.Connected; }
            catch (AggregateException) { return false; }
        }

        private static bool ServesTheContract(int httpPort)
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
            try
            {
                var body = JObject.Parse(http.GetStringAsync($"http://127.0.0.1:{httpPort}/racing-desk/").Result);
                return body.ContainsKey("DataCorePlugin.GameRunning");
            }
            catch (AggregateException) { return false; }
        }

        [Test]
        public void StopListeningLetsGoOfBothPorts_AndANewRuntimeTakesThemBeforeTheOldOneHasStopped()
        {
            int httpPort = FreePort(), wsPort;
            do wsPort = FreePort(); while (wsPort == httpPort);
            var old = StartRuntime(httpPort, wsPort);
            Assert.That(old.HttpListening, Is.True);
            Assert.That(ServesTheContract(httpPort), Is.True);
            Assert.That(Connects(wsPort), Is.True);

            old.StopListening();

            Assert.That(old.HttpListening, Is.False);
            Assert.That(Connects(httpPort), Is.False, "nothing answers on the HTTP port, so nothing takes it for a host");
            Assert.That(Connects(wsPort), Is.False, "nor on the WebSocket port");

            // The app that started in the meantime: its host takes both ports while the old one is still stopping.
            var next = StartRuntime(httpPort, wsPort);
            Assert.That(next.HttpListening, Is.True, "the new host got the HTTP port");
            Assert.That(ServesTheContract(httpPort), Is.True);
            Assert.That(Connects(wsPort), Is.True, "and the WebSocket port");

            // The old host's orderly stop comes last, and leaves the new one's ports as they are.
            Assert.DoesNotThrow(() => old.Stop());
            old.StopListening();
            Assert.That(ServesTheContract(httpPort), Is.True);
            Assert.That(Connects(wsPort), Is.True);
        }

        [Test]
        public void StopListeningBeforeStart_AndAfterStop_IsHarmless()
        {
            var never = new RacingDeskRuntime(new Settings(), new RacingDeskRuntime.Options { LoopbackOnly = true, EnableHardware = false, EnableSdkBridge = false });
            Assert.DoesNotThrow(() => never.StopListening());

            int httpPort = FreePort(), wsPort;
            do wsPort = FreePort(); while (wsPort == httpPort);
            var runtime = StartRuntime(httpPort, wsPort);
            runtime.Stop();
            Assert.DoesNotThrow(() => runtime.StopListening());
            Assert.DoesNotThrow(() => runtime.StopListening());
            Assert.That(Connects(httpPort), Is.False);
        }

        [Test]
        public void TheHostsStopLetsGoOfThePorts_WhenItIsAskedFor()
        {
            int httpPort = FreePort(), wsPort;
            do wsPort = FreePort(); while (wsPort == httpPort);
            var runtime = StartRuntime(httpPort, wsPort);
            using var stop = new ManualResetEventSlim();
            using var ended = new ManualResetEventSlim();
            // As Serve makes it, with an end that ends nothing: the runner is the process.
            var stopping = HostProgram.NewStop(runtime, stop, TimeSpan.FromSeconds(1), ended.Set);
            Assert.That(ServesTheContract(httpPort), Is.True);

            stopping.Ask("the app that started this host (pid 1) has gone");

            Assert.That(stop.IsSet, Is.True);
            Assert.That(runtime.HttpListening, Is.False);
            Assert.That(Connects(httpPort), Is.False, "by the time the host's loops are told, the port is free");
            Assert.That(Connects(wsPort), Is.False);
            Assert.That(ended.Wait(5000), Is.True, "and the deadline is still there");
        }
    }
}
