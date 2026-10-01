using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using RacingDesk.Host;
using RacingDesk.Plugin;
using RacingDesk.Plugin.IRacing;

namespace RacingDesk.Tests.Transport
{
    /// <summary>
    /// The host's replay route (<c>/racing-desk/data/replay</c>, ReplayApi): iRacing's replay and cameras for the app's
    /// TV shots, driven through <see cref="IReplayControl"/>. It is for a program on this machine and no other — the
    /// check the runtime's <c>?action=</c> routes make — and sends nothing while the sim is not connected. The control
    /// here is a fake that writes down what it was asked; the real SDK is never touched, so no message ever reaches
    /// iRacing from this test.
    /// </summary>
    [TestFixture]
    public class ReplayRouteTests
    {
        private string _dir = "";
        private RacingDeskRuntime? _runtime;
        private LocalDataApi? _api;
        private FakeReplay _replay = new FakeReplay();
        private int _httpPort;

        private static int FreePort()
        {
            var l = new TcpListener(IPAddress.Loopback, 0);
            l.Start();
            int port = ((IPEndPoint)l.LocalEndpoint).Port;
            l.Stop();
            return port;
        }

        [SetUp]
        public void StartRuntime()
        {
            _dir = Path.Combine(Path.GetTempPath(), "racing-desk-replay-route-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(_dir);
            _httpPort = FreePort();
            int wsPort;
            do wsPort = FreePort(); while (wsPort == _httpPort);
            _replay = new FakeReplay();
            _api = new LocalDataApi(Path.Combine(_dir, "no-store.db"));
            _api.Replay.Replay = _replay;
            _runtime = new RacingDeskRuntime(new Settings(), new RacingDeskRuntime.Options
            {
                AssemblyDirectory = _dir,
                PluginsDataDirectory = _dir,
                HttpPort = _httpPort,
                WsPort = wsPort,
                EnableHardware = false,
                EnableSdkBridge = false,
                LoopbackOnly = true,
                ExtraRoutes = _api.TryHandle,
            });
            _runtime.Start();
        }

        [TearDown]
        public void StopRuntime()
        {
            _runtime?.Stop();
            try { Directory.Delete(_dir, true); } catch { }
        }

        private (HttpStatusCode Status, string Body, bool OpenToPages) Ask(HttpMethod method, string? body = null, Action<HttpRequestMessage>? shape = null)
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
            using var request = new HttpRequestMessage(method, $"http://127.0.0.1:{_httpPort}/racing-desk/data/replay");
            if (body != null) request.Content = new StringContent(body, Encoding.UTF8, "application/json");
            shape?.Invoke(request);
            using var response = http.Send(request);
            return (response.StatusCode, new StreamReader(response.Content.ReadAsStream()).ReadToEnd(), response.Headers.Contains("Access-Control-Allow-Origin"));
        }

        private static readonly (string Name, Action<HttpRequestMessage> Shape)[] OtherMachines =
        {
            ("a device on the LAN, by the rig's address", r => r.Headers.Host = "192.168.1.20:8889"),
            ("a name another site has pointed at the rig", r => r.Headers.Host = "evil.example:8889"),
            ("a page in a browser, naming its origin", r => r.Headers.Add("Origin", "http://192.168.1.20:3000")),
            ("a page with an origin of null (the desk's own page)", r => r.Headers.Add("Origin", "null")),
            ("an image on a page, which has a Referer", r => r.Headers.Referrer = new Uri("http://192.168.1.20:3000/page")),
            ("a link on another site", r => r.Headers.Add("Sec-Fetch-Site", "cross-site")),
            ("a form", r => r.Headers.Add("Sec-Fetch-User", "?1")),
        };

        [Test]
        public void TheRoute_IsRefusedToAnotherMachineAndToPages_ReadAndWriteAlike_AndNothingReachesTheSim()
        {
            _replay.Connected = true;
            foreach (var (name, looksLike) in OtherMachines)
            {
                var (status, body, openToPages) = Ask(HttpMethod.Get, null, looksLike);
                Assert.That(status, Is.EqualTo(HttpStatusCode.Forbidden), $"GET from {name}");
                Assert.That(JObject.Parse(body)["error"]!.ToString(), Does.Contain("this machine"), $"GET from {name}");
                Assert.That(openToPages, Is.False, $"GET from {name}: not told in a way a page may read");

                (status, body, openToPages) = Ask(HttpMethod.Post, "{\"command\":\"seek\",\"sessionNum\":2,\"sessionTime\":100}", looksLike);
                Assert.That(status, Is.EqualTo(HttpStatusCode.Forbidden), $"POST from {name}");
                Assert.That(openToPages, Is.False, $"POST from {name}");
            }
            Assert.That(_replay.Calls, Is.Empty, "nothing was sent to the sim");
        }

        [Test]
        public void WithTheSimNotConnected_TheStatusSaysSo_AndACommandIsRefused_AndNothingIsSent()
        {
            _replay.Connected = false;
            var (status, body, _) = Ask(HttpMethod.Get);
            Assert.That(status, Is.EqualTo(HttpStatusCode.OK));
            var json = JObject.Parse(body);
            Assert.That((bool)json["available"]!, Is.False);
            Assert.That((bool)json["connected"]!, Is.False);
            Assert.That(json["reason"]!.ToString(), Does.Contain("iRacing is not running"));

            (status, body, _) = Ask(HttpMethod.Post, "{\"command\":\"seek\",\"sessionNum\":2,\"sessionTime\":100}");
            Assert.That(status, Is.EqualTo(HttpStatusCode.Conflict));
            Assert.That(JObject.Parse(body)["error"]!.ToString(), Does.Contain("iRacing is not running"));
            Assert.That(_replay.Calls, Is.Empty);
        }

        [Test]
        public void AHostReplayingAFile_HasNoReplayToDrive_AndSaysSo()
        {
            _api!.Replay.Replay = null;
            var (status, body, _) = Ask(HttpMethod.Get);
            Assert.That(status, Is.EqualTo(HttpStatusCode.OK));
            Assert.That(JObject.Parse(body)["reason"]!.ToString(), Does.Contain("replaying a file"));
            (status, body, _) = Ask(HttpMethod.Post, "{\"command\":\"speed\",\"speed\":1}");
            Assert.That(status, Is.EqualTo(HttpStatusCode.Conflict));
            Assert.That(JObject.Parse(body)["error"]!.ToString(), Does.Contain("replaying a file"));
        }

        [Test]
        public void TheStatus_SaysWhereTheReplayAndTheCamerasStand_AndWhichGroupsTheSessionHas()
        {
            _replay.Connected = true;
            var (status, body, openToPages) = Ask(HttpMethod.Get);
            Assert.That(status, Is.EqualTo(HttpStatusCode.OK));
            Assert.That(openToPages, Is.False, "a program's route, not a page's: no CORS header");
            var json = JObject.Parse(body);
            Assert.That((bool)json["available"]!, Is.True);
            Assert.That((bool)json["replayPlaying"]!, Is.True);
            Assert.That((bool)json["onTrack"]!, Is.False);
            Assert.That((int)json["sessionNum"]!, Is.EqualTo(2));
            Assert.That((int)json["replay"]!["sessionNum"]!, Is.EqualTo(2));
            Assert.That((double)json["replay"]!["sessionTime"]!, Is.EqualTo(1234.5));
            Assert.That((int)json["replay"]!["frame"]!, Is.EqualTo(74070));
            Assert.That((int)json["camera"]!["group"]!, Is.EqualTo(5));
            Assert.That((int)json["camera"]!["state"]!, Is.EqualTo(16));
            Assert.That(json["weekend"]!["trackDisplayName"]!.ToString(), Is.EqualTo("Circuit Zandvoort"));
            Assert.That((int)json["weekend"]!["subSessionId"]!, Is.EqualTo(71234567));
            Assert.That(json["player"]!["carNumber"]!.ToString(), Is.EqualTo("42"));
            Assert.That((int)json["player"]!["carNumberRaw"]!, Is.EqualTo(42));
            var groups = (JArray)json["groups"]!;
            Assert.That(groups.Count, Is.EqualTo(3));
            Assert.That(groups[1]["name"]!.ToString(), Is.EqualTo("TV1"));
            Assert.That((int)groups[1]["num"]!, Is.EqualTo(5));
        }

        [Test]
        public void AProgramOnThisMachine_DrivesTheReplay_ByTheFourCommands()
        {
            _replay.Connected = true;
            foreach (string host in new[] { "localhost:" + _httpPort, "127.0.0.1:" + _httpPort })
            {
                var (status, body, _) = Ask(HttpMethod.Post, "{\"command\":\"seek\",\"sessionNum\":2,\"sessionTime\":1234.5}", r => r.Headers.Host = host);
                Assert.That(status, Is.EqualTo(HttpStatusCode.OK), host + ": " + body);
                Assert.That((bool)JObject.Parse(body)["ok"]!, Is.True);
            }
            Assert.That(Ask(HttpMethod.Post, "{\"command\":\"speed\",\"speed\":0}").Status, Is.EqualTo(HttpStatusCode.OK));
            Assert.That(Ask(HttpMethod.Post, "{\"command\":\"speed\",\"speed\":1,\"slowMotion\":true}").Status, Is.EqualTo(HttpStatusCode.OK));
            Assert.That(Ask(HttpMethod.Post, "{\"command\":\"position\",\"from\":\"end\",\"frame\":-600}").Status, Is.EqualTo(HttpStatusCode.OK));
            Assert.That(Ask(HttpMethod.Post, "{\"command\":\"camera\",\"group\":5}").Status, Is.EqualTo(HttpStatusCode.OK));
            Assert.That(Ask(HttpMethod.Post, "{\"command\":\"camera\",\"focus\":\"leader\",\"group\":5,\"camera\":2}").Status, Is.EqualTo(HttpStatusCode.OK));
            Assert.That(Ask(HttpMethod.Post, "{\"command\":\"camera\",\"carNumber\":42,\"group\":6}").Status, Is.EqualTo(HttpStatusCode.OK));
            Assert.That(Ask(HttpMethod.Post, "{\"command\":\"cameraState\",\"state\":24}").Status, Is.EqualTo(HttpStatusCode.OK));
            // Node's fetch says Sec-Fetch-Mode and no more: a program.
            Assert.That(Ask(HttpMethod.Post, "{\"command\":\"speed\",\"speed\":1}", r => r.Headers.Add("Sec-Fetch-Mode", "cors")).Status, Is.EqualTo(HttpStatusCode.OK));

            Assert.That(_replay.Calls, Is.EqualTo(new[]
            {
                "SearchSessionTime(2, 1234500)", "SearchSessionTime(2, 1234500)",
                "SetPlaySpeed(0, False)", "SetPlaySpeed(1, True)",
                "SetPlayPosition(End, -600)",
                "SwitchCamera(Driver, 5, 0)", "SwitchCamera(Leader, 5, 2)",
                "SwitchCameraToCar(42, 6, 0)",
                "SetCameraState(24)",
                "SetPlaySpeed(1, False)",
            }));
        }

        [Test]
        public void WhileTheDriverIsOnTrack_EveryCommandIsRefused_AndNothingIsSent_ButTheStatusStillAnswers()
        {
            // A take that was under way when he got in the car, a program that never looked: the replay and the cameras are
            // his while the sim says he is on track.
            _replay.Connected = true;
            _replay.OnTrack = true;
            foreach (string body in new[]
            {
                "{\"command\":\"seek\",\"sessionNum\":2,\"sessionTime\":100}",
                "{\"command\":\"speed\",\"speed\":1}",
                "{\"command\":\"position\",\"from\":\"end\",\"frame\":-600}",
                "{\"command\":\"camera\",\"group\":5}",
                "{\"command\":\"camera\",\"carNumber\":42,\"group\":6}",
                "{\"command\":\"cameraState\",\"state\":8}",
            })
            {
                var (status, answer, _) = Ask(HttpMethod.Post, body);
                Assert.That(status, Is.EqualTo(HttpStatusCode.Conflict), body + ": " + answer);
                Assert.That(JObject.Parse(answer)["error"]!.ToString(), Does.Contain("in the car"), body);
            }
            Assert.That(_replay.Calls, Is.Empty, "nothing reached the sim");
            var (getStatus, getBody, _) = Ask(HttpMethod.Get);
            Assert.That(getStatus, Is.EqualTo(HttpStatusCode.OK));
            Assert.That((bool)JObject.Parse(getBody)["onTrack"]!, Is.True, "the status says why");

            // Out of the car again, the same command goes through.
            _replay.OnTrack = false;
            Assert.That(Ask(HttpMethod.Post, "{\"command\":\"speed\",\"speed\":1}").Status, Is.EqualTo(HttpStatusCode.OK));
            Assert.That(_replay.Calls, Is.EqualTo(new[] { "SetPlaySpeed(1, False)" }));
        }

        [Test]
        public void ACommandThatIsNotOne_IsRefusedInWords_AndNothingIsSent()
        {
            _replay.Connected = true;
            foreach (string body in new[]
            {
                "not json", "[]", "{}", "{\"command\":\"quit\"}",
                "{\"command\":\"seek\"}", "{\"command\":\"seek\",\"sessionNum\":\"2\",\"sessionTime\":1}", "{\"command\":\"seek\",\"sessionNum\":2,\"sessionTime\":-1}",
                "{\"command\":\"seek\",\"sessionNum\":2.5,\"sessionTime\":1}",
                "{\"command\":\"speed\"}", "{\"command\":\"speed\",\"speed\":99}",
                "{\"command\":\"position\",\"from\":\"middle\"}",
                "{\"command\":\"camera\"}", "{\"command\":\"camera\",\"group\":1,\"focus\":\"me\"}",
                "{\"command\":\"cameraState\"}", "{\"command\":\"cameraState\",\"state\":-1}", "{\"command\":\"cameraState\",\"state\":512}",
            })
            {
                var (status, answer, _) = Ask(HttpMethod.Post, body);
                Assert.That(status, Is.EqualTo(HttpStatusCode.BadRequest), body + ": " + answer);
                Assert.That(JObject.Parse(answer)["error"], Is.Not.Null, body);
            }
            Assert.That(Ask(HttpMethod.Put, "{\"command\":\"speed\",\"speed\":1}").Status, Is.EqualTo(HttpStatusCode.MethodNotAllowed));
            Assert.That(_replay.Calls, Is.Empty);
        }

        [Test]
        public void TheRoute_TakesNoActionQuery_SoTheRuntimesCheckNeverLetsItThroughToAnotherMachine()
        {
            // A request naming an action on this route is refused before the host sees it, like every other route of the host's.
            // The route would refuse this one too (it is not from this machine), with the same 403: what tells the two apart
            // is the words. The runtime's say "a program" (RefuseActionNotFromThisMachine), the route's own say "the app"
            // (ReplayApi), so the test fails if the runtime's check is not the one that answered. The action named is one the
            // runtime has (the map reset it once had is gone, and a name it has not heard of would do as well).
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
            using var request = new HttpRequestMessage(HttpMethod.Get, $"http://127.0.0.1:{_httpPort}/racing-desk/data/replay?action=restartdemo");
            request.Headers.Host = "192.168.1.20:8889";
            using var response = http.Send(request);
            Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.Forbidden));
            string body = new StreamReader(response.Content.ReadAsStream()).ReadToEnd();
            Assert.That(JObject.Parse(body)["error"]!.ToString(), Is.EqualTo("this is for a program on this machine"), "the runtime's refusal answered, not the route's own");
            Assert.That(_replay.Calls, Is.Empty, "nothing was sent to the sim");
        }

        /// <summary>A replay control that writes down what it was asked, and reaches no sim.</summary>
        private sealed class FakeReplay : IReplayControl
        {
            public bool Connected;
            public bool OnTrack;
            public readonly List<string> Calls = new List<string>();

            public bool IsConnected => Connected;

            public ReplayStatus Status()
            {
                if (!Connected) return null;
                var s = new ReplayStatus
                {
                    IsReplayPlaying = true, IsOnTrack = OnTrack, SessionNum = 2, SessionTime = 1500.25,
                    ReplaySessionNum = 2, ReplaySessionTime = 1234.5, ReplayFrameNum = 74070, ReplayFrameNumEnd = 90000, ReplayPlaySpeed = 0,
                    CamGroupNumber = 5, CamCameraNumber = 1, CamCarIdx = 7, CamCameraState = 16, PlayerCarIdx = 7, PlayerCarNumber = "42", PlayerCarNumberRaw = 42,
                    TrackName = "zandvoort full", TrackDisplayName = "Circuit Zandvoort", SubSessionId = 71234567,
                };
                s.Groups.Add(new ReplayCameraGroup { Num = 1, Name = "Cockpit", Cameras = 1 });
                s.Groups.Add(new ReplayCameraGroup { Num = 5, Name = "TV1", Cameras = 12 });
                s.Groups.Add(new ReplayCameraGroup { Num = 6, Name = "TV2", Cameras = 10 });
                return s;
            }

            public void SearchSessionTime(int sessionNum, int sessionTimeMs) => Calls.Add($"SearchSessionTime({sessionNum}, {sessionTimeMs})");
            public void SetPlaySpeed(int speed, bool slowMotion) => Calls.Add($"SetPlaySpeed({speed}, {slowMotion})");
            public void SetPlayPosition(ReplayPositionFrom from, int frame) => Calls.Add($"SetPlayPosition({from}, {frame})");
            public void SwitchCamera(ReplayCameraFocus focus, int group, int camera) => Calls.Add($"SwitchCamera({focus}, {group}, {camera})");
            public void SwitchCameraToCar(int carNumberRaw, int group, int camera) => Calls.Add($"SwitchCameraToCar({carNumberRaw}, {group}, {camera})");
            public void SetCameraState(int state) => Calls.Add($"SetCameraState({state})");
        }
    }
}
