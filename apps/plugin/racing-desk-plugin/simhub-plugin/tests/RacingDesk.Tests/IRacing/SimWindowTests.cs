using System;
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
    /// is on. Windows is never asked here: the source is a fake that says what the test tells it, and counts the times
    /// it is asked.
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

        private static int FreePort()
        {
            var l = new TcpListener(IPAddress.Loopback, 0);
            l.Start();
            int port = ((IPEndPoint)l.LocalEndpoint).Port;
            l.Stop();
            return port;
        }

        /// <summary>One request through the host's data API, with no store behind it, as the runtime hands it requests.</summary>
        private static (HttpStatusCode Status, string Body) Request(ISimWindowSource source, string method = "GET", string route = "simwindow")
        {
            int port = FreePort();
            using var listener = new HttpListener();
            listener.Prefixes.Add($"http://127.0.0.1:{port}/racing-desk/");
            listener.Start();
            var api = new LocalDataApi(Path.Combine(Path.GetTempPath(), "racing-desk-no-store-" + Guid.NewGuid().ToString("N") + ".db")) { SimWindows = source };
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
