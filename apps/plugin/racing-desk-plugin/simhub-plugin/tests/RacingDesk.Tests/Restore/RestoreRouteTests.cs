using System;
using System.Collections.Generic;
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
using NUnit.Framework.Constraints;
using RacingDesk.Data;
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
            Assert.That(steps, Is.EqualTo(new[] { "0a", "0b", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "C1" }));
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
        public void TheRouteSaysWhatIsOwed_AndWhyTheBrakesPartFailed()
        {
            var director = Director();
            var (_, quiet) = Ask(director, HttpMethod.Get, "restore");
            Assert.That((bool)quiet["closing"]["owed"], Is.False, "no key has gone");
            Assert.That(quiet["closing"]["eeprom"].Type, Is.EqualTo(JTokenType.Null));
            Assert.That(quiet["gate"]["brakes"]["failed"].Type, Is.EqualTo(JTokenType.Null));

            // F24 went, and then the look at the pedals' memory showed Racing Desk's profile with his old values.
            var pressed = new DateTime(2026, 10, 2, 20, 0, 0, DateTimeKind.Utc);
            using (var store = new RacingDeskStore(_rig.Store))
            {
                store.SaveSmartControlSwitch(new SmartControlSwitch { ProfileId = "ab", ProfileName = "Racing Desk", Key = "F24", BindingId = 7, MadeAtUtc = pressed, SentAtUtc = pressed });
                store.NoteCheckRan(RestoreClosing.Id, false, "the pedals kept the id", pressed.AddMinutes(5));
            }
            var (_, owed) = Ask(director, HttpMethod.Get, "restore");
            var closing = owed["closing"];
            Assert.That(((bool)closing["owed"], (string)closing["eeprom"], (bool)closing["eepromFresh"]), Is.EqualTo((true, "id", true)));
            Assert.That((string)closing["owedWords"], Does.StartWith("C1 is owed"));
            Assert.That((string)closing["failed"], Does.Contain("The brakes part has failed").And.Contain("keep the profile id"));
            Assert.That((string)owed["gate"]["brakes"]["failed"], Is.EqualTo((string)closing["failed"]));
            Assert.That(((bool)owed["gate"]["brakes"]["proven"], (string)owed["gate"]["brakes"]["eeprom"]), Is.EqualTo((false, "id")));
            Assert.That(owed["firstRun"]["steps"].Last["actions"].Select(a => (string)a["id"]), Is.EqualTo(new[] { "C1-own", "C1-id", "C1-values", "C1" }));
        }

        [Test]
        public void TheTestRowUndo_IsACommand_AndEveryAnswerSaysWhetherRacingDeskWasBusy()
        {
            var director = Director();
            var undo = Ask(director, HttpMethod.Post, "restore", "{\"undo\":\"test\"}");
            Assert.That(undo.Status, Is.EqualTo(HttpStatusCode.OK));
            Assert.That(((string)undo.Body["action"], (bool)undo.Body["busy"], (bool)undo.Body["ok"]), Is.EqualTo(("undo-test", false, true)));
            var step = Ask(director, HttpMethod.Post, "restore", "{\"step\":\"A1\"}");
            Assert.That((bool)step.Body["busy"], Is.False);
            Assert.That(Ask(director, HttpMethod.Post, "restore", "{\"undo\":\"everything\"}").Status, Is.EqualTo(HttpStatusCode.BadRequest));
        }

        [Test]
        public void TheRouteIsOnTheHostsList()
        {
            Assert.That(LocalDataApi.Routes, Does.Contain("restore"), "so DataRoutesThisMachineTests asks it of every kind of asker");
        }
    }

    /// <summary>
    /// The one place in the repo that sends a key is the host's KeySender, and it sends F24 and no other key. Anything else that
    /// sends a key or a click to another program — the HUD, the desk, main.js, another C# class, a script — fails here, whatever
    /// way it does it: <c>SendInput</c>, <c>keybd_event</c>, <c>mouse_event</c>, <c>SendKeys</c>, an <c>InputSimulator</c>, or
    /// <c>PostMessage</c> / <c>SendMessage</c> with a key message (<c>WM_KEYDOWN</c>, <c>WM_KEYUP</c>). The scan is of the apps, the
    /// packages and the scripts. (The overlay's own tests hold main.js and the TV shots to pressing nothing.)
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

        private static readonly string[] Roots = { "apps", "packages", "scripts" };
        private static readonly string[] Extensions = { ".cs", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".py", ".ps1", ".psm1", ".bat", ".cmd", ".vbs", ".sh", ".ahk" };
        private static readonly Regex Skip = new Regex(@"[\\/](node_modules|bin|obj|dist|\.git|\.worktrees|publish|win-unpacked)[\\/]", RegexOptions.IgnoreCase);

        /// <summary>Every way a program sends a key or a click to another, by the name it is called by.</summary>
        private static readonly (string Name, Regex Pattern)[] Senders =
        {
            ("SendInput", new Regex(@"\bSendInput\b")),
            ("keybd_event", new Regex(@"\bkeybd_event\b")),
            ("mouse_event", new Regex(@"\bmouse_event\b")),
            ("SendKeys", new Regex(@"\bSendKeys\b")),
            ("InputSimulator", new Regex(@"\bInputSimulator\b")),
        };

        private static readonly Regex PostsAMessage = new Regex(@"\b(PostMessage|SendMessage)\w*\b");
        private static readonly Regex AKeyMessage = new Regex(@"\bWM_(SYS)?KEY(DOWN|UP)\b");

        private static IReadOnlyList<string> Scanned(string root, params string[] leave)
        {
            var skip = new HashSet<string>(leave, StringComparer.OrdinalIgnoreCase);
            return Roots.Select(r => Path.Combine(root, r)).Where(Directory.Exists)
                .SelectMany(r => Directory.EnumerateFiles(r, "*.*", SearchOption.AllDirectories))
                .Where(f => !Skip.IsMatch(f.Substring(root.Length)))
                .Where(f => Extensions.Contains(Path.GetExtension(f).ToLowerInvariant()))
                .Where(f => !skip.Contains(f))
                .ToList();
        }

        [Test]
        public void AKeyIsSentFromKeySenderAlone_ByAnyOfTheWaysAProgramSendsOne()
        {
            string root = RepoRoot();
            string sender = Path.Combine(root, "apps", "host", "RacingDesk.Host", "KeySender.cs");
            // Two files name the ways in order to forbid them: this one, and the overlay's wiring test that holds main.js to pressing nothing.
            string self = Path.Combine(root, "apps", "plugin", "racing-desk-plugin", "simhub-plugin", "tests", "RacingDesk.Tests", "Restore", "RestoreRouteTests.cs");
            string forbids = Path.Combine(root, "apps", "overlay", "tests", "unit", "hud-main-wiring.spec.mjs");
            var files = Scanned(root, self, forbids);
            Assert.That(files, Has.Count.GreaterThan(100), "the scan reached the repo's files");
            Assert.That(files.Any(f => f.StartsWith(Path.Combine(root, "scripts") + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)), Is.True, "and its scripts");

            var text = files.ToDictionary(f => f, f => File.ReadAllText(f), StringComparer.OrdinalIgnoreCase);
            foreach (var (name, pattern) in Senders)
            {
                var found = text.Where(kv => pattern.IsMatch(kv.Value)).Select(kv => kv.Key).ToList();
                Assert.That(found, name == "SendInput" ? (IResolveConstraint)Is.EqualTo(new[] { sender }) : Is.Empty,
                    $"{name}: the key sender is the one place a key is sent from");
            }
            var messages = text.Where(kv => PostsAMessage.IsMatch(kv.Value) && AKeyMessage.IsMatch(kv.Value)).Select(kv => kv.Key).ToList();
            Assert.That(messages, Is.Empty, "PostMessage / SendMessage with WM_KEYDOWN or WM_KEYUP");

            string code = text[sender];
            Assert.That(Regex.Matches(code, @"wVk = \w+").Cast<Match>().Select(m => m.Value).Distinct(), Is.EqualTo(new[] { "wVk = VkF24" }), "F24 and no other key");
            Assert.That(code, Does.Contain("private const ushort VkF24 = 0x87;"));
        }

        [Test]
        public void TheScan_SeesEachWayItLooksFor()
        {
            // The patterns are what the scan stands on: each is shown to match the way it is written, and not a longer word.
            foreach (var (name, pattern) in Senders)
            {
                Assert.That(pattern.IsMatch($"[DllImport] static extern uint {name}(1, x, 2);"), Is.True, name);
                Assert.That(pattern.IsMatch($"my{name}Helper()"), Is.False, name + " inside another word");
            }
            Assert.That(PostsAMessage.IsMatch("PostMessageW(hwnd, WM_KEYDOWN, 0x87, 0)") && AKeyMessage.IsMatch("PostMessageW(hwnd, WM_KEYDOWN, 0x87, 0)"), Is.True);
            Assert.That(PostsAMessage.IsMatch("SendMessageTimeout(h, WM_SYSKEYUP, 0, 0)") && AKeyMessage.IsMatch("SendMessageTimeout(h, WM_SYSKEYUP, 0, 0)"), Is.True);
            Assert.That(AKeyMessage.IsMatch("WM_KEYBOARDLAYOUT"), Is.False);
        }
    }
}
