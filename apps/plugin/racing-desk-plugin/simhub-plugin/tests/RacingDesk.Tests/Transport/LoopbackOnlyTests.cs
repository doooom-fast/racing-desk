using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using RacingDesk.Plugin;

namespace RacingDesk.Tests.Transport
{
    /// <summary>
    /// A runtime started with <see cref="RacingDeskRuntime.Options.LoopbackOnly"/> serves its contract and its
    /// WebSocket on 127.0.0.1 and on no other address of the machine: tests and probes never listen on the LAN.
    /// </summary>
    [TestFixture]
    public class LoopbackOnlyTests
    {
        private string _dataDir = "";
        private RacingDeskRuntime? _runtime;
        private int _httpPort;
        private int _wsPort;

        private static int FreePort()
        {
            var l = new TcpListener(IPAddress.Loopback, 0);
            l.Start();
            int port = ((IPEndPoint)l.LocalEndpoint).Port;
            l.Stop();
            return port;
        }

        [OneTimeSetUp]
        public void StartRuntime()
        {
            _dataDir = Path.Combine(Path.GetTempPath(), "racing-desk-loopback-" + Guid.NewGuid().ToString("N"));
            _httpPort = FreePort();
            do _wsPort = FreePort(); while (_wsPort == _httpPort);
            _runtime = new RacingDeskRuntime(new Settings(), new RacingDeskRuntime.Options
            {
                AssemblyDirectory = _dataDir,
                PluginsDataDirectory = _dataDir,
                HttpPort = _httpPort,
                WsPort = _wsPort,
                EnableHardware = false,
                EnableSdkBridge = false,
                LoopbackOnly = true,
            });
            _runtime.Start();
        }

        [OneTimeTearDown]
        public void StopRuntime()
        {
            _runtime?.Stop();
            try { Directory.Delete(_dataDir, true); } catch { }
        }

        /// <summary>Whether a TCP connection to the address is accepted. One that is, on this machine, is at once.</summary>
        private static bool Connects(IPAddress address, int port)
        {
            using var client = new TcpClient(address.AddressFamily);
            try { return client.ConnectAsync(address, port).Wait(TimeSpan.FromSeconds(1)) && client.Connected; }
            catch (AggregateException) { return false; }
        }

        [Test]
        public void ListensOnLoopbackAndNothingElse()
        {
            Assert.That(_runtime!.HttpListening, Is.True);
            var listeners = IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners();
            foreach (int port in new[] { _httpPort, _wsPort })
            {
                var bound = listeners.Where(e => e.Port == port).Select(e => e.Address).ToList();
                Assert.That(bound, Is.Not.Empty, $":{port} is listened on");
                Assert.That(bound, Is.All.EqualTo(IPAddress.Loopback), $":{port} is bound to 127.0.0.1 alone");
            }

            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
            var body = JObject.Parse(http.GetStringAsync($"http://127.0.0.1:{_httpPort}/racing-desk/").Result);
            Assert.That(body.ContainsKey("DataCorePlugin.GameRunning"), Is.True, "the contract is served on 127.0.0.1");
            Assert.That(Connects(IPAddress.Loopback, _wsPort), Is.True, "the WebSocket answers on 127.0.0.1");
        }

        [Test]
        public void IsNotReachableOnTheMachinesOtherAddresses()
        {
            var others = NetworkInterface.GetAllNetworkInterfaces()
                .Where(n => n.OperationalStatus == OperationalStatus.Up && n.NetworkInterfaceType != NetworkInterfaceType.Loopback)
                .SelectMany(n => n.GetIPProperties().UnicastAddresses)
                .Select(u => u.Address)
                .Where(a => !IPAddress.IsLoopback(a))
                .Where(a => a.AddressFamily == AddressFamily.InterNetwork || a.AddressFamily == AddressFamily.InterNetworkV6)
                .ToList();
            Assume.That(others, Is.Not.Empty, "this machine has no address but loopback");

            int[] ports = { _httpPort, _wsPort };
            Assert.That(ports.Select(p => Connects(IPAddress.Loopback, p)), Is.All.True, "the probe reaches both on 127.0.0.1");

            var probes = (from address in others
                          from port in ports
                          select (Where: new IPEndPoint(address, port), Reached: Task.Run(() => Connects(address, port)))).ToList();
            var reached = probes.Where(p => p.Reached.Result).Select(p => p.Where.ToString()).ToList();
            Assert.That(reached, Is.Empty, $"reached on an address that is not loopback (tried {string.Join(", ", others)})");
        }
    }
}
