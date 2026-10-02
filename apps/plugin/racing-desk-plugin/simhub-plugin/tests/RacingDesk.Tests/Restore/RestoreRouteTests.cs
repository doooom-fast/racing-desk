using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using RacingDesk.Data.Restore;
using RacingDesk.Host;

namespace RacingDesk.Tests.Restore
{
    /// <summary>
    /// <c>/racing-desk/data/restore</c> over a real listener on 127.0.0.1: what it says, the commands it takes from a program on
    /// this machine, and what it refuses a page. (Every route's refusals to the LAN, another name and a browser are
    /// DataRoutesThisMachineTests'.)
    /// </summary>
    [TestFixture]
    public class RestoreRouteTests
    {
        private RestoreRig _rig;

        [SetUp]
        public void SetUp()
        {
            _rig = new RestoreRig();
            _rig.AppIni(-0.02);
            _rig.CameraIni(("porsche963gtp", ""));
            _rig.Cam("porsche963gtp", -0.11f, 0f);
            _rig.SmartControl();
            _rig.StoreWithCars(("porsche963gtp", "Porsche 963 GTP", -0.02, true, 0.0, "Default", RestoreRig.DefaultId, 70.0, "rule"));
        }

        [TearDown] public void TearDown() => _rig.Dispose();

        private static int FreePort()
        {
            var l = new TcpListener(IPAddress.Loopback, 0);
            l.Start();
            int port = ((IPEndPoint)l.LocalEndpoint).Port;
            l.Stop();
            return port;
        }

        private (HttpStatusCode Status, JObject Body) Ask(RestoreDirector director, HttpMethod method, string target, string body = null, Action<HttpRequestMessage> shape = null)
        {
            int port = FreePort();
            using var listener = new HttpListener();
            listener.Prefixes.Add($"http://127.0.0.1:{port}/racing-desk/");
            listener.Start();
            var api = new LocalDataApi(_rig.Store, _rig.SmartControlDb);
            api.Restore.Director = director;
            var claimed = Task.Run(() => api.TryHandle(listener.GetContext()));
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
            using var request = new HttpRequestMessage(method, $"http://127.0.0.1:{port}/racing-desk/data/{target}");
            if (body != null) request.Content = new StringContent(body, Encoding.UTF8, "application/json");
            shape?.Invoke(request);
            using var response = http.Send(request);
            string text = new StreamReader(response.Content.ReadAsStream(), Encoding.UTF8).ReadToEnd();
            Assert.That(claimed.Result, Is.True);
            return (response.StatusCode, text.Length > 0 ? JObject.Parse(text) : null);
        }

        private RestoreDirector Director() => new RestoreDirector(_rig.Context(), Path.Combine(_rig.Dir, "restore.json"));

        [Test]
        public void AHostWithNoDirector_SaysItHasNone()
        {
            var (status, body) = Ask(null, HttpMethod.Get, "restore");
            Assert.That(status, Is.EqualTo(HttpStatusCode.OK));
            Assert.That((bool)body["available"], Is.False);
            Assert.That(Ask(null, HttpMethod.Post, "restore", "{\"step\":\"A1\"}").Status, Is.EqualTo(HttpStatusCode.Conflict));
        }

        [Test]
        public void TheRouteSays_Trial_TheSwitches_TheGate_EachCar_AndTheFirstRun()
        {
            var director = Director();
            for (int i = 0; i < 3; i++) director.See(new SeatFacts { CarPath = "porsche963gtp", CarName = "Porsche 963 GTP", IsInGarage = true, SimMode = "full", AtUtc = DateTime.UtcNow });
            director.Settled().Wait(TimeSpan.FromSeconds(20));
            var (status, body) = Ask(director, HttpMethod.Get, "restore");
            Assert.That(status, Is.EqualTo(HttpStatusCode.OK));
            Assert.That(((bool)body["available"], (string)body["mode"], (bool)body["acting"]), Is.EqualTo((true, "trial", false)));
            Assert.That((double)body["startHeight"], Is.EqualTo(-0.02));
            Assert.That(((bool)body["switches"]["height"], (bool)body["switches"]["brakes"], (bool)body["switches"]["horizon"]), Is.EqualTo((true, true, false)));
            Assert.That(body["gate"]["brakes"]["needs"].Select(t => (string)t), Is.EqualTo(new[] { "A4", "A5", "A6", "B2" }));
            Assert.That((bool)body["gate"]["brakes"]["acts"], Is.False);
            Assert.That(body["lines"].Select(l => (string)l["text"]), Has.Some.EqualTo("Trial: brakes Porsche 963 GTP · 70 kg"));
            var car = body["cars"].Single(c => (string)c["car"] == "porsche963gtp");
            Assert.That((string)car["pedals"]["state"], Is.EqualTo("would-make"));
            Assert.That((double)car["pedals"]["kg"], Is.EqualTo(70));
            Assert.That((string)car["view"]["state"], Is.EqualTo("already"));
            var steps = body["firstRun"]["steps"].Select(s => (string)s["id"]).ToList();
            Assert.That(steps, Is.EqualTo(new[] { "0a", "0b", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8" }));
            Assert.That((string)body["now"]["place"], Is.EqualTo("garage screen"));

            long seq = (long)body["seq"];
            var (_, since) = Ask(director, HttpMethod.Get, "restore?since=" + seq);
            Assert.That(since["lines"], Is.Empty, "nothing after the newest");
            Assert.That(since["cars"], Is.Null, "the HUD's poll is not sent the dry run");
        }

        [Test]
        public void ACommand_FromAProgram_IsTaken_AndFromAPage_IsRefused()
        {
            var director = Director();
            var (status, body) = Ask(director, HttpMethod.Post, "restore", "{\"switches\":{\"brakes\":false}}");
            Assert.That(status, Is.EqualTo(HttpStatusCode.OK));
            Assert.That((bool)body["switches"]["brakes"], Is.False);
            Assert.That(director.Switches.Brakes, Is.False);

            var step = Ask(director, HttpMethod.Post, "restore", "{\"step\":\"A1\"}");
            Assert.That(step.Status, Is.EqualTo(HttpStatusCode.OK));
            Assert.That((string)step.Body["step"], Is.EqualTo("A1"));
            Assert.That((bool)step.Body["ok"], Is.False, "Live is running in the made-up rig");
            Assert.That(Ask(director, HttpMethod.Post, "restore", "{\"mark\":\"A1\",\"state\":\"passed\"}").Status, Is.EqualTo(HttpStatusCode.OK));
            Assert.That(Ask(director, HttpMethod.Post, "restore", "{\"mark\":\"A1\",\"state\":\"sure\"}").Status, Is.EqualTo(HttpStatusCode.BadRequest));
            Assert.That(Ask(director, HttpMethod.Post, "restore", "{\"step\":\"Z9\"}").Status, Is.EqualTo(HttpStatusCode.BadRequest));
            Assert.That(Ask(director, HttpMethod.Post, "restore", "{\"undo\":\"everything\"}").Status, Is.EqualTo(HttpStatusCode.BadRequest));
            Assert.That(Ask(director, HttpMethod.Post, "restore", "[1]").Status, Is.EqualTo(HttpStatusCode.BadRequest));

            // A page: refused by the data API's check before the route, and nothing changes.
            var page = Ask(director, HttpMethod.Post, "restore", "{\"switches\":{\"brakes\":true}}", r => r.Headers.Add("Origin", "null"));
            Assert.That(page.Status, Is.EqualTo(HttpStatusCode.Forbidden));
            var marked = Ask(director, HttpMethod.Post, "restore", "{\"switches\":{\"brakes\":true}}", r => r.Headers.TryAddWithoutValidation("Sec-Fetch-Site", "cross-site"));
            Assert.That(marked.Status, Is.EqualTo(HttpStatusCode.Forbidden));
            Assert.That(director.Switches.Brakes, Is.False);
            Assert.That(_rig.Keys.Sent, Is.Zero);
        }

        [Test]
        public void TheRouteIsOnTheHostsList()
        {
            Assert.That(LocalDataApi.Routes, Does.Contain("restore"), "so DataRoutesThisMachineTests asks it of every kind of asker");
        }
    }

    /// <summary>
    /// The one place in the repo that sends a key is the host's KeySender: SendInput anywhere else — the HUD, the desk, main.js,
    /// another C# class — fails here. (The overlay's own tests hold main.js and the TV shots to pressing nothing.)
    /// </summary>
    [TestFixture]
    public class SendInputOnlyHereTests
    {
        private static string RepoRoot()
        {
            for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir != null; dir = dir.Parent)
                if (File.Exists(Path.Combine(dir.FullName, "racing-desk.sln"))) return dir.FullName;
            throw new DirectoryNotFoundException("racing-desk.sln was not found above " + AppContext.BaseDirectory);
        }

        [Test]
        public void SendInput_IsCalledByKeySenderAlone()
        {
            string root = RepoRoot();
            string allowed = Path.Combine(root, "apps", "host", "RacingDesk.Host", "KeySender.cs");
            string self = Path.Combine(root, "apps", "plugin", "racing-desk-plugin", "simhub-plugin", "tests", "RacingDesk.Tests", "Restore", "RestoreRouteTests.cs");
            var skip = new Regex(@"[\\/](node_modules|bin|obj|dist|\.git|\.worktrees|publish|win-unpacked)[\\/]", RegexOptions.IgnoreCase);
            var found = Directory.EnumerateFiles(Path.Combine(root, "apps"), "*.*", SearchOption.AllDirectories)
                .Concat(Directory.EnumerateFiles(Path.Combine(root, "packages"), "*.*", SearchOption.AllDirectories))
                .Where(f => !skip.IsMatch(f.Substring(root.Length)))
                .Where(f => new[] { ".cs", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".py", ".ps1" }.Contains(Path.GetExtension(f).ToLowerInvariant()))
                .Where(f => !string.Equals(f, self, StringComparison.OrdinalIgnoreCase))
                .Where(f => Regex.IsMatch(File.ReadAllText(f), @"\bSendInput\b"))
                .ToList();
            Assert.That(found, Is.EqualTo(new[] { allowed }), "the key sender is the one place a key is sent from");
            string sender = File.ReadAllText(allowed);
            Assert.That(Regex.Matches(sender, @"wVk = \w+").Cast<Match>().Select(m => m.Value).Distinct(), Is.EqualTo(new[] { "wVk = VkF24" }), "F24 and no other key");
            Assert.That(sender, Does.Contain("private const ushort VkF24 = 0x87;"));
        }
    }
}
