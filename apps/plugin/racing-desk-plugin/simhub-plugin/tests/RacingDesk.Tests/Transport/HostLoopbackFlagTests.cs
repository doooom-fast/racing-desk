using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using NUnit.Framework;
using RacingDesk.Host;
using RacingDesk.Plugin;
using HostProgram = RacingDesk.Host.Program;

namespace RacingDesk.Tests.Transport
{
    /// <summary>
    /// RacingDesk.Host takes <c>--loopback-only</c>, so a replay or a parity probe started by hand listens on 127.0.0.1 and
    /// on no other address (the repo documents both commands, and until the flag there was no way to run them without
    /// putting a listener on the network). The shipped host, which the app starts, never has it: the iPad view needs the LAN.
    /// Nothing here listens on any address but loopback.
    /// </summary>
    [TestFixture]
    public class HostLoopbackFlagTests
    {
        private string _dir = "";
        private string _ibt = "";

        [SetUp]
        public void SetUp()
        {
            _dir = Path.Combine(Path.GetTempPath(), "racing-desk-loopback-flag-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(_dir);
            // HostOptions.Parse wants the file to be there; a replay is what keeps the hardware and the SDK bridge off.
            _ibt = Path.Combine(_dir, "replay.ibt");
            File.WriteAllBytes(_ibt, new byte[0]);
        }

        [TearDown]
        public void TearDown()
        {
            try { Directory.Delete(_dir, true); } catch { }
        }

        private RacingDeskRuntime.Options OptionsFor(params string[] args) =>
            HostProgram.RuntimeOptions(HostOptions.Parse(args), _dir, Path.Combine(_dir, "none.db"));

        [Test]
        public void TheDefaultIsEveryAddress_AndTheFlagAsksForLoopbackAlone()
        {
            Assert.That(HostOptions.Parse(new string[0]).LoopbackOnly, Is.False);
            Assert.That(OptionsFor("--http-port", "18889", "--ws-port", "18890").LoopbackOnly, Is.False,
                "the host the app starts, and a host started by hand with no flag, listen as they always did");

            var options = OptionsFor("--http-port", "18889", "--ws-port", "18890", "--no-hardware", "--no-record", "--loopback-only");
            Assert.That(options.LoopbackOnly, Is.True);
            Assert.That(options.HttpPort, Is.EqualTo(18889));
            Assert.That(options.WsPort, Is.EqualTo(18890));
            Assert.That(OptionsFor("--loopback-only", "--parent-pid", "4").LoopbackOnly, Is.True, "wherever it comes among the others");
        }

        [Test]
        public void AReplayIsNotLoopbackOnlyUnlessItSaysSo()
        {
            // The flag is asked for, in the commands the repo documents; a replay does not imply it.
            Assert.That(OptionsFor("--ibt", _ibt).LoopbackOnly, Is.False);
            var options = OptionsFor("--ibt", _ibt, "--loopback-only");
            Assert.That(options.LoopbackOnly, Is.True);
            Assert.That(options.EnableHardware, Is.False, "a replay never touches the hardware");
            Assert.That(options.EnableSdkBridge, Is.False);
        }

        [Test]
        public void TheHostsOwnOptionsWithTheFlag_PutBothPortsOnLoopbackAlone()
        {
            int httpPort = FreePort(), wsPort;
            do wsPort = FreePort(); while (wsPort == httpPort);
            var options = OptionsFor("--ibt", _ibt, "--http-port", httpPort.ToString(), "--ws-port", wsPort.ToString(), "--loopback-only");
            var runtime = new RacingDeskRuntime(new Settings(), options);
            runtime.Start();
            try
            {
                Assert.That(runtime.HttpListening, Is.True);
                var listeners = IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners();
                foreach (int port in new[] { httpPort, wsPort })
                {
                    var bound = listeners.Where(e => e.Port == port).Select(e => e.Address).ToList();
                    Assert.That(bound, Is.Not.Empty, $":{port} is listened on");
                    Assert.That(bound, Is.All.EqualTo(IPAddress.Loopback), $":{port} is bound to 127.0.0.1 alone");
                }
            }
            finally
            {
                runtime.Stop();
            }
        }

        private static int FreePort()
        {
            var l = new TcpListener(IPAddress.Loopback, 0);
            l.Start();
            int port = ((IPEndPoint)l.LocalEndpoint).Port;
            l.Stop();
            return port;
        }
    }
}
