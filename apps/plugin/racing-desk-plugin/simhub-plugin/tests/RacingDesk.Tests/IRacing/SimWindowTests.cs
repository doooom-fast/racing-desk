using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using RacingDesk.Host;

namespace RacingDesk.Tests.IRacing
{
    /// <summary>
    /// <c>GET /racing-desk/data/simwindow</c>: where the sim's window is, so that the HUD is drawn on the screen the sim
    /// is on; and <c>GET /racing-desk/data/monitors</c>: the monitors' rectangles in physical pixels, so that a screen is
    /// named by the size it really has. Windows is never asked here: the sources are fakes that say what the test tells
    /// them, and count the times they are asked.
    /// </summary>
    [TestFixture]
    public class SimWindowTests
    {
        private sealed class FakeSimWindow : ISimWindowSource
        {
            public SimWindowInfo? Answer;
            public Exception? Throws;
            public int Asked;

            public SimWindowInfo Find()
            {
                Asked++;
                if (Throws != null) throw Throws;
                return Answer!;
            }
        }

        // The rig's ultrawide as Windows lays the screens out: the primary is 1440 wide, so the ultrawide begins there.
        private static SimWindowInfo OnTheUltrawide() => new SimWindowInfo
        {
            Process = "iRacingSim64DX11",
            Window = new ScreenRect(1440, 0, 3440, 1440),
            Monitor = new ScreenRect(1440, 0, 3440, 1440),
        };

        private sealed class FakeMonitors : IMonitorSource
        {
            public List<MonitorInfo> Answer = new List<MonitorInfo>();
            public Exception? Throws;
            public int Asked;

            public IReadOnlyList<MonitorInfo> List()
            {
                Asked++;
                if (Throws != null) throw Throws;
                return Answer;
            }
        }

        // The rig as Windows lays it out (read on 2026-09-29 by a query that changed nothing): the ultrawide is the
        // primary at the origin, and the small 175 % screen is to its left, 1440 × 1080 physical.
        private static List<MonitorInfo> TheRig() => new List<MonitorInfo>
        {
            new MonitorInfo { Bounds = new ScreenRect(-1440, 0, 1440, 1080), Primary = false },
            new MonitorInfo { Bounds = new ScreenRect(0, 0, 3440, 1440), Primary = true },
        };

        private static int FreePort()
        {
            var l = new TcpListener(IPAddress.Loopback, 0);
            l.Start();
            int port = ((IPEndPoint)l.LocalEndpoint).Port;
            l.Stop();
            return port;
        }

        /// <summary>One request through the host's data API, with no store behind it, as the runtime hands it requests.</summary>
        private static (HttpStatusCode Status, string Body) Request(ISimWindowSource source, string method = "GET", string route = "simwindow", IMonitorSource? monitors = null)
        {
            int port = FreePort();
            using var listener = new HttpListener();
            listener.Prefixes.Add($"http://127.0.0.1:{port}/racing-desk/");
            listener.Start();
            var api = new LocalDataApi(Path.Combine(Path.GetTempPath(), "racing-desk-no-store-" + Guid.NewGuid().ToString("N") + ".db")) { SimWindows = source, Monitors = monitors ?? new FakeMonitors() };
            var claimed = Task.Run(() => api.TryHandle(listener.GetContext()));

            using var http = new HttpClient();
            using var request = new HttpRequestMessage(new HttpMethod(method), $"http://127.0.0.1:{port}/racing-desk/data/{route}");
            if (method == "POST") request.Content = new StringContent("{}", Encoding.UTF8, "application/json");
            using var response = http.Send(request);
            string text = new StreamReader(response.Content.ReadAsStream(), Encoding.UTF8).ReadToEnd();
            Assert.That(claimed.Result, Is.True, "the data API claims /data/ routes");
            return (response.StatusCode, text);
        }

        [Test]
        public void SaysWhereTheSimsWindowIsInPhysicalPixels()
        {
            var source = new FakeSimWindow { Answer = OnTheUltrawide() };
            var (status, body) = Request(source);

            Assert.That(status, Is.EqualTo(HttpStatusCode.OK), body);
            var json = JObject.Parse(body);
            Assert.That((string?)json["process"], Is.EqualTo("iRacingSim64DX11"));
            Assert.That(((int)json["window"]!["x"]!, (int)json["window"]!["y"]!, (int)json["window"]!["width"]!, (int)json["window"]!["height"]!),
                Is.EqualTo((1440, 0, 3440, 1440)));
            Assert.That(((int)json["monitor"]!["x"]!, (int)json["monitor"]!["width"]!, (int)json["monitor"]!["height"]!),
                Is.EqualTo((1440, 3440, 1440)));
            Assert.That(source.Asked, Is.EqualTo(1));
        }

        [Test]
        public void ANegativePositionIsKept_ScreensLeftOfThePrimaryHaveOne()
        {
            var source = new FakeSimWindow
            {
                Answer = new SimWindowInfo
                {
                    Process = "iRacingSim64",
                    Window = new ScreenRect(-2560, -8, 2576, 1456),   // a maximized window's frame runs past the screen's edge
                    Monitor = new ScreenRect(-2560, 0, 2560, 1440),
                },
            };
            var json = JObject.Parse(Request(source).Body);
            Assert.That(((int)json["window"]!["x"]!, (int)json["window"]!["y"]!), Is.EqualTo((-2560, -8)));
            Assert.That((int)json["monitor"]!["x"]!, Is.EqualTo(-2560));
        }

        [Test]
        public void IsNullWhenTheSimIsNotRunning()
        {
            var source = new FakeSimWindow { Answer = null };
            var (status, body) = Request(source);
            Assert.That(status, Is.EqualTo(HttpStatusCode.OK));
            Assert.That(JToken.Parse(body).Type, Is.EqualTo(JTokenType.Null));
            Assert.That(source.Asked, Is.EqualTo(1));
        }

        [Test]
        public void IsNullForAWindowWithNoSize_AMinimizedOneIsNotWhereItLooksToBe()
        {
            var source = new FakeSimWindow { Answer = new SimWindowInfo { Process = "iRacingSim64DX11", Window = new ScreenRect(-32000, -32000, 0, 0) } };
            Assert.That(JToken.Parse(Request(source).Body).Type, Is.EqualTo(JTokenType.Null));
        }

        [Test]
        public void SaysNullForTheMonitorWhenWindowsDidNotSayWhichIt_AndStillSaysTheWindow()
        {
            var source = new FakeSimWindow { Answer = new SimWindowInfo { Process = "iRacingSim64DX11", Window = new ScreenRect(0, 0, 1920, 1080) } };
            var json = JObject.Parse(Request(source).Body);
            Assert.That((int)json["window"]!["width"]!, Is.EqualTo(1920));
            Assert.That(json["monitor"]!.Type, Is.EqualTo(JTokenType.Null));
        }

        [Test]
        public void ALookThatFailsIsAnErrorAndNotNull_TheHudTakesTheOneForNotKnownAndTheOtherForClosed()
        {
            var source = new FakeSimWindow { Throws = new InvalidOperationException("the process has exited") };
            var (status, _) = Request(source);
            Assert.That(status, Is.EqualTo(HttpStatusCode.InternalServerError));
            Assert.That(source.Asked, Is.EqualTo(1));
        }

        [Test]
        public void SaysTheMonitorsInPhysicalPixels_TheSmallOneLeftOfThePrimaryHasANegativePosition()
        {
            var monitors = new FakeMonitors { Answer = TheRig() };
            var (status, body) = Request(new FakeSimWindow(), "GET", "monitors", monitors);

            Assert.That(status, Is.EqualTo(HttpStatusCode.OK), body);
            var json = JArray.Parse(body);
            Assert.That(json, Has.Count.EqualTo(2));
            Assert.That(((int)json[0]["x"]!, (int)json[0]["y"]!, (int)json[0]["width"]!, (int)json[0]["height"]!, (bool)json[0]["primary"]!),
                Is.EqualTo((-1440, 0, 1440, 1080, false)));
            Assert.That(((int)json[1]["x"]!, (int)json[1]["width"]!, (int)json[1]["height"]!, (bool)json[1]["primary"]!),
                Is.EqualTo((0, 3440, 1440, true)));
            Assert.That(monitors.Asked, Is.EqualTo(1));
        }

        [Test]
        public void SaysNoMonitorsAsAnEmptyList_AndLeavesOutOneWithNoSize()
        {
            Assert.That(JArray.Parse(Request(new FakeSimWindow(), "GET", "monitors", new FakeMonitors()).Body), Is.Empty);

            var odd = TheRig();
            odd.Add(new MonitorInfo { Bounds = new ScreenRect(0, 0, 0, 0) });
            odd.Add(null!);
            var json = JArray.Parse(Request(new FakeSimWindow(), "GET", "monitors", new FakeMonitors { Answer = odd }).Body);
            Assert.That(json, Has.Count.EqualTo(2));
        }

        [Test]
        public void AMonitorListThatCannotBeMadeIsAnErrorAndNotAnEmptyList()
        {
            var monitors = new FakeMonitors { Throws = new InvalidOperationException("Windows would not list the monitors") };
            var (status, _) = Request(new FakeSimWindow(), "GET", "monitors", monitors);
            Assert.That(status, Is.EqualTo(HttpStatusCode.InternalServerError));
            Assert.That(monitors.Asked, Is.EqualTo(1));
        }

        [Test]
        public void MonitorsAreOnlyReadAndOnlyOnTheirOwnRoute()
        {
            var monitors = new FakeMonitors { Answer = TheRig() };
            Assert.That(Request(new FakeSimWindow(), "POST", "monitors", monitors).Status, Is.Not.EqualTo(HttpStatusCode.OK));
            Request(new FakeSimWindow(), "GET", "simwindow", monitors);
            Request(new FakeSimWindow(), "GET", "controls", monitors);
            Assert.That(monitors.Asked, Is.EqualTo(0), "nothing is listed for a request that is not a read of the monitors");
        }

        [Test]
        public void OnlyAReadAnswers()
        {
            var source = new FakeSimWindow { Answer = OnTheUltrawide() };
            var (status, _) = Request(source, "POST");
            Assert.That(status, Is.Not.EqualTo(HttpStatusCode.OK));
            Assert.That(source.Asked, Is.EqualTo(0), "nothing is looked up for a request that is not a read");
        }

        [Test]
        public void NoOtherRouteLooksTheWindowUp()
        {
            var source = new FakeSimWindow { Answer = OnTheUltrawide() };
            Request(source, "GET", "status");
            Request(source, "GET", "controls");
            Assert.That(source.Asked, Is.EqualTo(0));
        }
    }
}
