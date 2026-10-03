using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using RacingDesk.Plugin.Engine;

namespace RacingDesk.Tests.IRacing
{
    /// <summary>
    /// The track map on the host's outline: where a fraction of the lap is on it (round the whole loop, the line
    /// included), how the source is asked and answered off the telemetry thread, what the status says, and the
    /// plugin's source over loopback.
    /// </summary>
    [TestFixture]
    public class TrackMapProviderTests
    {
        private static TrackOutline Square(int trackId = 777, int laps = 2, bool provisional = false, DateTime? at = null)
        {
            // A square 400 m a side, the line at its top-left corner, clockwise: 1000 points by the fraction of the lap.
            var points = new (double X, double Z, double Pct)[1000];
            for (int i = 0; i < 1000; i++)
            {
                double pct = i / 1000.0, d = pct * 1600;
                double x, z;
                if (d < 400) { x = d; z = 0; }
                else if (d < 800) { x = 400; z = d - 400; }
                else if (d < 1200) { x = 1200 - d; z = 400; }
                else { x = 0; z = 1600 - d; }
                points[i] = (x, z, pct);
            }
            return new TrackOutline { TrackId = trackId, CleanLaps = laps, LengthMeters = 1600, Provisional = provisional, UpdatedAtUtc = at ?? new DateTime(2026, 3, 1, 0, 0, 0, DateTimeKind.Utc), Points = points };
        }

        private sealed class FakeSource : IOutlineSource
        {
            public TrackOutline Answer;
            public Exception Throws;
            public int Asked;
            public readonly List<int> Threads = new List<int>();
            public TrackOutline Get(int trackId)
            {
                Interlocked.Increment(ref Asked);
                lock (Threads) Threads.Add(Thread.CurrentThread.ManagedThreadId);
                if (Throws != null) throw Throws;
                return Answer != null && Answer.TrackId == trackId ? Answer : null;
            }
        }

        private static void Settle(TrackMapProvider map, FakeSource source, int asked)
        {
            // The ask is on a pool thread, which a loaded machine starts when it can; the answer is taken on the next
            // Update. Updated until the ask has been made and answered, then once more to take the answer.
            for (int i = 0; i < 1000; i++)
            {
                map.Update(0.1, new float[0], new bool[0], 0, 1);
                if (Volatile.Read(ref source.Asked) >= asked && !map.Asking) break;
                Thread.Sleep(10);
            }
            map.Update(0.1, new float[0], new bool[0], 0, 1);
        }

        [Test]
        public void AFractionPastTheLastPointSlidesOnToTheLineAndDoesNotHoldOnTheLastPoint()
        {
            // Four corners and nothing else, the line at the first: a fraction of 0.9 is nine tenths of the way along the
            // last side, between the fourth corner and the first. The old interpolation held it on the fourth corner
            // until the fraction wrapped, which is the jump at the line.
            var outline = new List<(double X, double Y, double Pct)> { (0, 0, 0), (100, 0, 0.25), (100, 100, 0.5), (0, 100, 0.75) };
            var at = TrackMapProvider.InterpolateAlong(outline, 0.9);
            Assert.That(at.X, Is.EqualTo(0).Within(1e-9));
            Assert.That(at.Y, Is.EqualTo(40).Within(1e-9));
            at = TrackMapProvider.InterpolateAlong(outline, 0.999);
            Assert.That(at.Y, Is.EqualTo(0.4).Within(1e-9));
            at = TrackMapProvider.InterpolateAlong(outline, 0.0);
            Assert.That((at.X, at.Y), Is.EqualTo((0.0, 0.0)));
            at = TrackMapProvider.InterpolateAlong(outline, 0.125);
            Assert.That((at.X, at.Y), Is.EqualTo((50.0, 0.0)));
            at = TrackMapProvider.InterpolateAlong(outline, 0.75);
            Assert.That((at.X, at.Y), Is.EqualTo((0.0, 100.0)));
            // An outline whose first point is not at 0 (the old recordings): before it is the closing segment too.
            var shifted = new List<(double X, double Y, double Pct)> { (0, 0, 0.1), (100, 0, 0.35), (100, 100, 0.6), (0, 100, 0.85) };
            at = TrackMapProvider.InterpolateAlong(shifted, 0.05);
            Assert.That(at.Y, Is.EqualTo(20).Within(1e-9), "0.05 is four fifths of the way from the fourth corner round to the first");
        }

        [Test]
        public void CrossingTheLineIsOneMoreStepOnTheMap()
        {
            var map = new TrackMapProvider { Outlines = new LocalOutlineSource(_ => Square()) };
            map.OnTrackChanged(777, "square");
            var source = new FakeSource { Answer = Square() };
            map.Outlines = source;
            map.OnTrackChanged(777, "square");
            Settle(map, source, 1);
            Assert.That(map.IsReady, Is.True, map.Trace + $", asked {source.Asked}");
            Assert.That(map.Status, Is.EqualTo(TrackMapProvider.StatusReady));

            // Drive the last tenth of the lap and over the line, frame by frame; no step is bigger than its neighbours.
            var steps = new List<double>();
            double px = 0, py = 0;
            for (int i = 0; i <= 40; i++)
            {
                double pct = (0.98 + i * 0.001) % 1.0;
                map.Update(pct, new float[0], new bool[0], 0, 1);
                if (i > 5) steps.Add(Math.Sqrt((map.PlayerX - px) * (map.PlayerX - px) + (map.PlayerY - py) * (map.PlayerY - py)));
                px = map.PlayerX; py = map.PlayerY;
            }
            Assert.That(steps.Max(), Is.LessThan(steps.Average() * 1.5), $"steps: {string.Join(" ", steps.Select(s => s.ToString("F2")))}");
            Assert.That(map.SvgPath, Does.StartWith("M ").And.EndWith(" Z"));
        }

        [Test]
        public void TheSourceIsAskedOffTheTelemetryThreadAndTheMapSaysWhatItHasAndWhy()
        {
            var clock = new DateTime(2026, 3, 1, 10, 0, 0, DateTimeKind.Utc);
            var source = new FakeSource();
            var map = new TrackMapProvider { Outlines = source, Clock = () => clock };
            Assert.That(map.Status, Is.EqualTo(TrackMapProvider.StatusNone));

            // No outline yet: first-lap, and asked again every five seconds, never on the thread that updates.
            map.OnTrackChanged(777, "square");
            Assert.That(map.Status, Is.EqualTo(TrackMapProvider.StatusFirstLap));
            Settle(map, source, 1);
            Assert.That(map.IsReady, Is.False);
            Assert.That(map.Status, Is.EqualTo(TrackMapProvider.StatusFirstLap));
            Assert.That(source.Threads, Has.None.EqualTo(Thread.CurrentThread.ManagedThreadId));
            map.Update(0.1, new float[0], new bool[0], 0, 1);
            Assert.That(source.Asked, Is.EqualTo(1), "not asked again within five seconds");
            clock = clock.AddSeconds(6);
            source.Answer = Square(laps: 1, provisional: true);
            Settle(map, source, 2);
            Assert.That(map.IsReady, Is.True, map.Trace + $", asked {source.Asked}");
            Assert.That(map.Status, Is.EqualTo(TrackMapProvider.StatusReady));
            Assert.That(map.Outline.CleanLaps, Is.EqualTo(1));
            Assert.That(map.Outline.Provisional, Is.True);

            // With an outline: asked again after a minute, and swapped when it has gained laps.
            clock = clock.AddSeconds(30);
            map.Update(0.1, new float[0], new bool[0], 0, 1);
            Assert.That(source.Asked, Is.EqualTo(2));
            source.Answer = Square(laps: 3, at: clock);
            clock = clock.AddSeconds(31);
            Settle(map, source, 3);
            Assert.That(map.Outline.CleanLaps, Is.EqualTo(3));
            Assert.That(map.Outline.Provisional, Is.False);

            // The host gone: the map drawn stays, and says it is ready; with none drawn it says there is no host.
            source.Throws = new System.Net.Http.HttpRequestException("refused");
            clock = clock.AddSeconds(61);
            Settle(map, source, 4);
            Assert.That(map.IsReady, Is.True);
            Assert.That(map.Status, Is.EqualTo(TrackMapProvider.StatusReady));
            map.OnTrackChanged(778, "elsewhere");
            Assert.That(map.IsReady, Is.False);
            Settle(map, source, 5);
            Assert.That(map.Status, Is.EqualTo(TrackMapProvider.StatusNoHost));
            Assert.That(map.SvgPath, Is.Empty);

            // An answer for the layout before is not applied to the one now.
            source.Throws = null;
            source.Answer = Square(trackId: 777);
            clock = clock.AddSeconds(6);
            Settle(map, source, 6);
            Assert.That(map.IsReady, Is.False);
            Assert.That(map.TrackId, Is.EqualTo(778));
            Assert.That(map.TrackName, Is.EqualTo("elsewhere"));
        }

        [Test]
        public void TheDemoHasItsOwnCircuitAndIsNotMovedByATrackChange()
        {
            var map = new TrackMapProvider();
            map.SetDemoMode(true);
            Assert.That(map.IsReady, Is.True);
            Assert.That(map.Status, Is.EqualTo(TrackMapProvider.StatusReady));
            string demo = map.SvgPath;
            Assert.That(demo, Does.StartWith("M "));
            map.OnTrackChanged(777, "square");
            Assert.That(map.SvgPath, Is.EqualTo(demo));
            map.UpdateDemo(0.3, 5, 1.0);
            Assert.That(map.OpponentCount, Is.EqualTo(5));
            Assert.That(map.PlayerX, Is.InRange(0, 100));
        }

        [Test]
        public void ABigCircuitIsSentSmoothToAHundredthOfAUnitAndSoAreTheOtherCars()
        {
            // A circle as long as Le Mans (13.5 km), a point every 5 m, as his own outlines are: 90 units across, so a
            // unit is 48 m and the points are 0.105 units apart. The circle turns by 0.13 degrees from one point to the
            // next. To a tenth of a unit (the path before 2026-10-02) its points turned by 45 degrees at the median and
            // some fell on the one before; to a hundredth, 3 at the median and under 8 at the most — what the HUD and
            // the iPad draw at their following map's closest view, where a tenth was 3 px ("very squiggly").
            const int n = 2700;
            double radius = 13500 / (2 * Math.PI);
            var points = new (double X, double Z, double Pct)[n];
            for (int i = 0; i < n; i++)
            {
                double a = 2 * Math.PI * i / n;
                points[i] = (radius * Math.Cos(a), -radius * Math.Sin(a), (double)i / n);
            }
            var map = new TrackMapProvider();
            map.Apply(new TrackOutline { TrackId = 268, CleanLaps = 3, LengthMeters = 13500, Points = points }, TrackMapProvider.StatusReady);
            Assert.That(map.IsReady, Is.True);

            string path = map.SvgPath;
            var numbers = Regex.Matches(path, @"-?\d+(\.\d+)?").Cast<Match>().Select(m => m.Value).ToList();
            Assert.That(numbers.All(v => Regex.IsMatch(v, @"^-?\d+\.\d{2}$")), Is.True, "every number to two decimals: " + string.Join(" ", numbers.Take(12)));
            Assert.That(numbers.Count, Is.EqualTo(2 + 6 * n), "M and a curve to each point");
            // The points the line passes through: M's, then the last pair of each curve.
            var on = new List<(double X, double Y)> { (double.Parse(numbers[0], CultureInfo.InvariantCulture), double.Parse(numbers[1], CultureInfo.InvariantCulture)) };
            for (int c = 0; c < n - 1; c++)
                on.Add((double.Parse(numbers[2 + 6 * c + 4], CultureInfo.InvariantCulture), double.Parse(numbers[2 + 6 * c + 5], CultureInfo.InvariantCulture)));
            var turns = new List<double>();
            for (int i = 0; i < on.Count; i++)
            {
                var a = on[(i - 1 + on.Count) % on.Count]; var b = on[i]; var c = on[(i + 1) % on.Count];
                Assert.That(a != b && b != c, Is.True, $"point {i} is not the one before or after it");
                double t = Math.Abs(Math.Atan2(c.Y - b.Y, c.X - b.X) - Math.Atan2(b.Y - a.Y, b.X - a.X)) * 180 / Math.PI;
                turns.Add(t > 180 ? 360 - t : t);
            }
            turns.Sort();
            Assert.That(turns[turns.Count / 2], Is.LessThan(5), "median turn between neighbouring points, degrees");
            Assert.That(turns[turns.Count - 1], Is.LessThan(10), "largest turn between neighbouring points, degrees");

            // The other cars, the same: a car at three-tenths of the lap is placed to a hundredth.
            map.Update(0.1, new float[] { 0f, 0.3f }, new bool[] { false, false }, 0, 1);
            Assert.That(map.OpponentData, Does.Match(@"^\d+\.\d{2},\d+\.\d{2},0$"));
        }

        // ── The plugin's source: the host over loopback ──

        private static int FreePort()
        {
            var l = new TcpListener(IPAddress.Loopback, 0);
            l.Start();
            int port = ((IPEndPoint)l.LocalEndpoint).Port;
            l.Stop();
            return port;
        }

        [Test]
        public void TheHostSourceReadsTheRouteTakes404AsNoneYetAndThrowsWhenThereIsNoHost()
        {
            int port = FreePort();
            using var listener = new HttpListener();
            listener.Prefixes.Add($"http://127.0.0.1:{port}/racing-desk/data/");
            listener.Start();
            var asked = new List<string>();
            var serving = Task.Run(() =>
            {
                for (int i = 0; i < 2; i++)
                {
                    var ctx = listener.GetContext();
                    asked.Add(ctx.Request.Url.PathAndQuery);
                    string body;
                    int status;
                    if (ctx.Request.QueryString["track"] == "777")
                    {
                        var sb = new StringBuilder("{\"trackId\":777,\"cleanLaps\":4,\"lengthM\":1600.0,\"officialLengthM\":1602.5,\"provisional\":false,\"updatedAt\":\"2026-03-01T10:00:00.000Z\",\"points\":[");
                        var square = Square();
                        for (int p = 0; p < square.Points.Count; p++)
                        {
                            if (p > 0) sb.Append(',');
                            sb.Append('[').Append(square.Points[p].X.ToString("F2", System.Globalization.CultureInfo.InvariantCulture)).Append(',')
                              .Append(square.Points[p].Z.ToString("F2", System.Globalization.CultureInfo.InvariantCulture)).Append(',')
                              .Append(square.Points[p].Pct.ToString("F5", System.Globalization.CultureInfo.InvariantCulture)).Append(']');
                        }
                        body = sb.Append("]}").ToString();
                        status = 200;
                    }
                    else { body = "{\"error\":\"no outline yet\"}"; status = 404; }
                    var bytes = Encoding.UTF8.GetBytes(body);
                    ctx.Response.StatusCode = status;
                    ctx.Response.ContentType = "application/json";
                    ctx.Response.ContentLength64 = bytes.Length;
                    ctx.Response.OutputStream.Write(bytes, 0, bytes.Length);
                    ctx.Response.Close();
                }
            });

            using var source = new HostOutlineSource($"http://127.0.0.1:{port}");
            Assert.That(source.Url(777), Is.EqualTo($"http://127.0.0.1:{port}/racing-desk/data/outline?track=777"));
            var outline = source.Get(777);
            Assert.That(outline, Is.Not.Null);
            Assert.That((outline.TrackId, outline.CleanLaps, outline.Provisional, outline.Points.Count), Is.EqualTo((777, 4, false, 1000)));
            Assert.That(outline.LengthMeters, Is.EqualTo(1600));
            Assert.That(outline.OfficialLengthMeters, Is.EqualTo(1602.5));
            Assert.That(outline.UpdatedAtUtc, Is.EqualTo(new DateTime(2026, 3, 1, 10, 0, 0, DateTimeKind.Utc)));
            Assert.That(outline.Points[250], Is.EqualTo((400.0, 0.0, 0.25)));
            Assert.That(source.Get(778), Is.Null, "404: no outline yet");
            serving.Wait(TimeSpan.FromSeconds(5));
            Assert.That(asked, Is.EqualTo(new[] { "/racing-desk/data/outline?track=777", "/racing-desk/data/outline?track=778" }));
            listener.Stop();

            // Nobody on the port: the ask throws, which the map reads as no host, and the plugin reads no file for it.
            using var nobody = new HostOutlineSource($"http://127.0.0.1:{FreePort()}", TimeSpan.FromSeconds(2));
            Assert.That(() => nobody.Get(777), Throws.InstanceOf<Exception>());
            Assert.That(HostOutlineSource.DefaultHostUrl, Is.EqualTo("http://127.0.0.1:18889"));
            Assert.That(new RacingDesk.Plugin.Settings().HostUrl, Is.EqualTo(HostOutlineSource.DefaultHostUrl));
        }

        [Test]
        public void TheSdkBridgeForgetsTheLayoutWhenTheSimGoesSoTheNextSimIsNotTakenForTheLastOne()
        {
            // The map is keyed by the bridge's TrackID where SimHub does not say one. It is written when the session
            // YAML has been parsed, which is a moment after the SDK connects: a bridge that kept the last layout
            // would show it (and place every car on it) under the new session's name until then.
            var bridge = new IRacingSdkBridge { TrackId = 509, TrackLengthMeters = 4650 };
            bridge.OnConnected();
            bridge.OnDisconnected();
            Assert.That((bridge.IsConnected, bridge.TrackId, bridge.TrackLengthMeters), Is.EqualTo((false, 0, 0.0)));
            bridge.OnConnected();
            Assert.That(bridge.IsConnected, Is.True);
            Assert.That(bridge.TrackId, Is.Zero, "connected, and its session not yet parsed: no layout, not the old one");
            bridge.TrackId = 77;
            bridge.Stop();   // not started: nothing to stop, and the layout is as it was
            Assert.That(bridge.TrackId, Is.EqualTo(77));
        }

        [Test]
        public void ABodyWithTooFewPointsIsNoOutline()
        {
            Assert.That(HostOutlineSource.Parse("{\"trackId\":1,\"points\":[[0,0,0],[1,1,0.5]]}"), Is.Null);
            Assert.That(HostOutlineSource.Parse("{\"trackId\":1}"), Is.Null);
        }
    }
}
