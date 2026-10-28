using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using RacingDesk.Data.Pedals;
using RacingDesk.Host;

namespace RacingDesk.Tests.Pedals
{
    /// <summary>
    /// The brake force the pedals are at now, for the HUD's datastream: what the recorder says of it
    /// (<see cref="CarPedalsRecorder.Now"/>), and the host's <c>/racing-desk/data/brakeforce</c> that serves it to the
    /// app's main process. Known from a key that sets a force and from nothing else; null, never a number, otherwise.
    /// </summary>
    [TestFixture]
    public class BrakeForceRouteTests
    {
        private const int PageUp = 0x21, PageDown = 0x22, RightCtrl = 0xA3, Up = 0x26;
        private const string Honda = "hondacivictyper", Mx5 = "mx5 mx52016";
        private static readonly DateTime June = new DateTime(2026, 6, 1, 9, 0, 0, DateTimeKind.Utc);

        private static List<LiveKey> RigKeys() => new List<LiveKey>
        {
            new LiveKey { Action = LiveAction.SetBrakeForce, Value = 50, FirstKey = "PRIOR", SecondKey = "" },
            new LiveKey { Action = LiveAction.SetBrakeForce, Value = 30, FirstKey = "NEXT", SecondKey = "" },
            new LiveKey { Action = LiveAction.RaiseBrakeForce, Value = 5, FirstKey = "RCONTROL", SecondKey = "UP" },
        };

        /// <summary>A keyboard and a clock, as BrakeForceTests has them.</summary>
        private sealed class Keys
        {
            public readonly HashSet<int> Down = new HashSet<int>();
            public DateTime Now = June;
            public short State(int key) => unchecked((short)(Down.Contains(key) ? 0x8000 : 0));
            public void Tick(int milliseconds = 16) => Now = Now.AddMilliseconds(milliseconds);
        }

        private sealed class Run
        {
            public readonly Keys Board = new Keys();
            public readonly CarPedalsRecorder Recorder;

            public Run()
            {
                var snapshot = new SmartControlSnapshot { Keys = RigKeys() };
                Recorder = new CarPedalsRecorder(() => snapshot, bound => new LiveKeyWatcher(bound, Board.State, () => Board.Now), () => true, () => Board.Now, _ => { }, _ => { });
            }

            public void Frame(string car) { Board.Tick(); Recorder.See(car, false, false, 0); }

            public void GetIn(string car)
            {
                var until = DateTime.UtcNow.AddSeconds(10);
                do
                {
                    Frame(car);
                    if (Recorder.Watched.Count == 0) Thread.Sleep(5);
                } while (Recorder.Watched.Count == 0 && DateTime.UtcNow < until);
                Frame(car);
            }

            public void Tap(string car, params int[] keys)
            {
                foreach (int k in keys) Board.Down.Add(k);
                Frame(car);
                Board.Down.Clear();
                Frame(car);
            }
        }

        [Test]
        public void TheForceNowIsKnownFromAKeyThatSetsOneAndFromNothingElse()
        {
            var run = new Run();
            Assert.That(run.Recorder.Now.CarPath, Is.Null, "no car yet");
            Assert.That(run.Recorder.Now.ForceKg, Is.Null);

            run.GetIn(Honda);
            Assert.That(run.Recorder.Now.CarPath, Is.EqualTo(Honda));
            Assert.That(run.Recorder.Now.ForceKg, Is.Null, "no key has set a force: nothing is made up");
            Assert.That(run.Recorder.Now.Why, Is.EqualTo(BrakeForceNow.NotSet));

            run.Tap(Honda, RightCtrl, Up);
            Assert.That(run.Recorder.Now.ForceKg, Is.Null, "raised from a force nobody knows");

            run.Tap(Honda, PageUp);
            Assert.That(run.Recorder.Now.ForceKg, Is.EqualTo(50), "Page Up sets 50");
            run.Tap(Honda, RightCtrl, Up);
            Assert.That(run.Recorder.Now.ForceKg, Is.EqualTo(55));

            // The pedals keep their force from car to car: the next car starts where this one left off.
            run.GetIn(Mx5);
            Assert.That((run.Recorder.Now.CarPath, run.Recorder.Now.ForceKg), Is.EqualTo((Mx5, (double?)55)));
            run.Tap(Mx5, PageDown);
            Assert.That(run.Recorder.Now.ForceKg, Is.EqualTo(30));

            // A step key held until Windows repeats it (a quarter of a second, frame by frame: looks further apart than
            // a fifth of a second are not one watch): the force is not known again until a key sets one.
            run.Board.Down.Add(RightCtrl);
            run.Board.Down.Add(Up);
            for (int i = 0; i < 25; i++) run.Frame(Mx5);
            run.Board.Down.Clear();
            run.Frame(Mx5);
            Assert.That(run.Recorder.Now.ForceKg, Is.Null, "a number that may be wrong is not a number to show");
            run.Tap(Mx5, PageUp);
            Assert.That(run.Recorder.Now.ForceKg, Is.EqualTo(50));

            // The sim gone: between cars, nothing is being followed.
            run.Recorder.SimGone();
            Assert.That(run.Recorder.Now.CarPath, Is.Null);
            Assert.That(run.Recorder.Now.ForceKg, Is.Null);
        }

        // ── /racing-desk/data/brakeforce ──

        private static int FreePort()
        {
            var l = new TcpListener(IPAddress.Loopback, 0);
            l.Start();
            int port = ((IPEndPoint)l.LocalEndpoint).Port;
            l.Stop();
            return port;
        }

        private static (HttpStatusCode Status, JObject Body) Get(Func<BrakeForceNow> force)
        {
            int port = FreePort();
            using var listener = new HttpListener();
            listener.Prefixes.Add($"http://127.0.0.1:{port}/racing-desk/"); // not localhost: HTTP.sys binds that on every address
            listener.Start();
            // No store: the force is the recorder's, and is served before there is one.
            var api = new LocalDataApi(Path.Combine(Path.GetTempPath(), "racing-desk-no-store-" + Guid.NewGuid().ToString("N") + ".db")) { BrakeForce = force };
            var claimed = Task.Run(() => api.TryHandle(listener.GetContext()));

            using var http = new HttpClient();
            using var request = new HttpRequestMessage(HttpMethod.Get, $"http://127.0.0.1:{port}/racing-desk/data/brakeforce");
            using var response = http.Send(request);
            string text = new StreamReader(response.Content.ReadAsStream(), Encoding.UTF8).ReadToEnd();
            Assert.That(claimed.Result, Is.True);
            return (response.StatusCode, text.Length > 0 ? JObject.Parse(text) : null);
        }

        [Test]
        public void TheRouteServesTheForceNowAndSaysNotKnownOtherwise()
        {
            var (status, known) = Get(() => new BrakeForceNow { CarPath = Mx5, ForceKg = 45 });
            Assert.That(status, Is.EqualTo(HttpStatusCode.OK));
            Assert.That(((string)known["car"], (double)known["force_kg"]), Is.EqualTo((Mx5, 45.0)));
            Assert.That(known["why"].Type, Is.EqualTo(JTokenType.Null), "known: there is nothing to explain");

            var (_, unknown) = Get(() => new BrakeForceNow { CarPath = Honda, ForceKg = null, Why = BrakeForceNow.Held });
            Assert.That((string)unknown["car"], Is.EqualTo(Honda));
            Assert.That(unknown["force_kg"].Type, Is.EqualTo(JTokenType.Null), "not known: null, never a number");
            Assert.That((string)unknown["why"], Is.EqualTo("held"), "and why, for the HUD to say");

            var (_, both) = Get(() => new BrakeForceNow { CarPath = Honda, ForceKg = 50, Why = BrakeForceNow.Held });
            Assert.That(both["why"].Type, Is.EqualTo(JTokenType.Null), "a reason is never sent beside a number");

            var (_, none) = Get(() => null);
            Assert.That(none["car"].Type, Is.EqualTo(JTokenType.Null), "a host with no recorder");
            Assert.That(none["force_kg"].Type, Is.EqualTo(JTokenType.Null));
            Assert.That(none["why"].Type, Is.EqualTo(JTokenType.Null), "and no reason it can give");

            var (noReader, body) = Get(null);
            Assert.That(noReader, Is.EqualTo(HttpStatusCode.OK));
            Assert.That(body["force_kg"].Type, Is.EqualTo(JTokenType.Null));
        }

        [Test]
        public void TheRouteIsOnTheHostsList()
        {
            Assert.That(LocalDataApi.Routes, Does.Contain("brakeforce"), "so DataRoutesThisMachineTests asks it of every kind of asker");
        }
    }
}
