using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using RacingDesk.Core.Cars;

namespace RacingDesk.Tests.Cars
{
    /// <summary>
    /// The bar behind every control the HUD shows (he asked on 2026-10-02 for "background scaling for all of these
    /// adjustments"): where the value stands in that control's range for that car, which the host works out from the
    /// list (<see cref="CarControls.FillOf"/>) and sends as <c>fill</c>. A range in the list says where it came from
    /// (a manual, release notes, the lowest and highest in his own files), a control without one has no bar, and
    /// named positions fill only where they are a scale.
    /// </summary>
    [TestFixture]
    public class CarControlsFillTests
    {
        private static CarControl ControlOf(string json) => CarList.Parse(@"{ ""cars"": [ { ""path"": ""a"", ""controls"": [ " + json + " ] } ] }").Find("a").Controls[0];

        // ── The list this build carries ──

        private static IEnumerable<(CarEntry Car, CarControl Control)> Ranged() =>
            from car in CarList.Default.Cars
            from control in car.Controls
            where control.Min.HasValue && control.Max.HasValue
            select (car, control);

        [Test]
        public void EveryRangeOfTheListFillsFromNoughtToOneAndHoldsAtItsEnds()
        {
            var ranged = Ranged().ToList();
            Assert.That(ranged.Count, Is.GreaterThanOrEqualTo(205), "the list's ranges (105 before 2026-10-02)");
            int bars = 0;
            foreach (var (car, c) in ranged)
            {
                string who = $"{car.Path} {c.Id} [{c.Min}, {c.Max}]";
                double lo = c.Min.Value, hi = c.Max.Value;
                if (c.Positions.Count > 0 && !c.PositionsAreAScale)
                {
                    // Names of modes: no bar, whatever the range.
                    foreach (double v in new[] { lo, (lo + hi) / 2, hi })
                        Assert.That(CarControls.FillOf(c, v), Is.Null, who + ": positions that are names fill nothing");
                    continue;
                }
                if (!(hi > lo))
                {
                    // A placeholder (a bias that is published and fixed): nothing to fill.
                    Assert.That(CarControls.FillOf(c, lo), Is.Null, who);
                    continue;
                }
                bars++;
                Assert.That(CarControls.FillOf(c, lo), Is.EqualTo(0).Within(1e-9), who + " at its lowest");
                Assert.That(CarControls.FillOf(c, hi), Is.EqualTo(1).Within(1e-9), who + " at its highest");
                double last = -1;
                for (int i = 0; i <= 10; i++)
                {
                    double v = lo + (hi - lo) * i / 10.0;
                    double? f = CarControls.FillOf(c, v);
                    Assert.That(f, Is.Not.Null.And.InRange(0, 1), $"{who} at {v}");
                    Assert.That(f.Value, Is.GreaterThanOrEqualTo(last), $"{who}: the bar rises with the value");
                    last = f.Value;
                }
                double span = hi - lo;
                Assert.That(CarControls.FillOf(c, lo - span), Is.EqualTo(0), who + ": below its lowest the bar is empty");
                Assert.That(CarControls.FillOf(c, hi + span), Is.EqualTo(1), who + ": above its highest the bar is full");
            }
            Assert.That(bars, Is.GreaterThanOrEqualTo(192), "controls with a bar");
        }

        // What a note must name for its range: a manual or guide, release notes, an article, a third party, or what was
        // seen in his own files.
        private static readonly Regex Source = new Regex(@"\b(manual|guide|release notes|notes|article|third party|seen|files?)\b", RegexOptions.IgnoreCase);

        // Two ranges written on 2026-09-29, when the list was, from the source the entries cite (the Gen 3 Supercars
        // manual of 2025-06) and whose notes do not say so. That manual is over 10 MB, too large to fetch and read again
        // on 2026-10-02, so the source is not put into the notes unchecked. Nothing may be added to this.
        private static readonly HashSet<string> WrittenBeforeWithoutASource = new HashSet<string>
        {
            "supercars chevycamarogen3 throttleMap", "supercars fordmustanggen3 throttleMap",
        };

        [Test]
        public void EveryRangeOfTheListSaysWhereItComesFrom()
        {
            var missing = Ranged().Where(r => string.IsNullOrWhiteSpace(r.Control.Note) || !Source.IsMatch(r.Control.Note))
                .Select(r => $"{r.Car.Path} {r.Control.Id}").ToList();
            Assert.That(missing.Where(m => !WrittenBeforeWithoutASource.Contains(m)), Is.Empty,
                "a range whose note does not say where it came from:\n" + string.Join("\n", missing));
        }

        [Test]
        public void ARangeTakenFromHisFilesHoldsWhatHisFilesShowed()
        {
            // The notes of the ranges read from his .ibt files say so in one form ("Range from his files: seen 46 to 55
            // in 55 files to 2026-10-02": the lowest and highest values he held for half a second or more in the car,
            // outward to two places), and the range is the seen pair itself.
            var seen = new Regex(@"Range from his files: seen (-?[\d.]+) to (-?[\d.]+) in (\d+) files? to (\d{4}-\d{2}-\d{2})");
            int n = 0;
            foreach (var (car, c) in Ranged())
            {
                var m = seen.Match(c.Note ?? "");
                if (!m.Success) continue;
                n++;
                Assert.That(double.Parse(m.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture), Is.EqualTo(c.Min.Value), $"{car.Path} {c.Id}");
                Assert.That(double.Parse(m.Groups[2].Value, System.Globalization.CultureInfo.InvariantCulture), Is.EqualTo(c.Max.Value), $"{car.Path} {c.Id}");
                Assert.That(int.Parse(m.Groups[3].Value), Is.GreaterThan(0));
            }
            Assert.That(n, Is.GreaterThan(80), "ranges from his files");
        }

        // ── Positions ──

        [Test]
        public void PositionsThatAreAScaleFillByTheirPlaceAndNamesOfModesFillNothing()
        {
            // The McLaren MP4-30's target charge: 25%, 50%, 75%, a scale; a value between them goes by the range.
            var soc = ControlOf(@"{ ""id"": ""mguDeploy"", ""var"": ""v"", ""range"": [25, 75], ""positions"": { ""25"": ""25%"", ""50"": ""50%"", ""75"": ""75%"" } }");
            Assert.That(soc.PositionsAreAScale, Is.True);
            Assert.That(new[] { 25.0, 50, 75 }.Select(v => CarControls.FillOf(soc, v)), Is.EqualTo(new double?[] { 0, 0.5, 1 }));
            Assert.That(CarControls.FillOf(soc, 60), Is.EqualTo(0.7).Within(1e-9));

            // A scale with its off at the bottom: the place among all of them.
            var counted = ControlOf(@"{ ""id"": ""x"", ""positions"": { ""0"": ""OFF"", ""1"": ""1"", ""2"": ""2"", ""3"": ""3"" } }");
            Assert.That(counted.PositionsAreAScale, Is.True);
            Assert.That(CarControls.FillOf(counted, 2), Is.EqualTo(2 / 3.0).Within(1e-9));
            Assert.That(CarControls.FillOf(counted, 7), Is.Null, "a value that is no position, and no range to go by");
            Assert.That(ControlOf(@"{ ""id"": ""x"", ""positions"": { ""1"": ""3"", ""2"": ""2"", ""3"": ""1"" } }").PositionsAreAScale, Is.True, "numbers that fall with the values");

            // The 570S's TRACK / SPORT / NORMAL with the range the list gives it, an M2's OFF / MDM / ON, a switch, an off
            // in the middle, two that read the same: names, not a scale.
            var modes = ControlOf(@"{ ""id"": ""mode"", ""var"": ""dcABS"", ""range"": [0, 2], ""positions"": { ""0"": ""TRACK"", ""1"": ""SPORT"", ""2"": ""NORMAL"" } }");
            Assert.That(modes.PositionsAreAScale, Is.False);
            Assert.That(new[] { 0.0, 1, 2 }.Select(v => CarControls.FillOf(modes, v)), Is.All.Null);
            foreach (string positions in new[]
            {
                @"{ ""0"": ""OFF"", ""1"": ""MDM"", ""2"": ""ON"" }", @"{ ""0"": ""OFF"", ""1"": ""ON"" }", @"{ ""1"": ""1"", ""2"": ""OFF"", ""3"": ""3"" }",
                @"{ ""1"": ""1"", ""2"": ""1"" }", @"{ ""3"": ""LINEAR"" }", @"{ ""1"": ""2"" }",
            })
                Assert.That(ControlOf(@"{ ""id"": ""x"", ""positions"": " + positions + " }").PositionsAreAScale, Is.False, positions);

            // In the list this build carries.
            var list = CarList.Default;
            Assert.That(list.Find("mclarenmp430").Control("mguDeploy").PositionsAreAScale, Is.True);
            Assert.That(list.Find("mclaren570sgt4").Control("mode").PositionsAreAScale, Is.False);
            Assert.That(list.Find("hyundaielantracn7").Control("abs").PositionsAreAScale, Is.False, "DRY, DAMP, WET, SAFETY CAR, LIMP");
            Assert.That(list.Find("bmwm2csr").Control("tc").PositionsAreAScale, Is.False, "OFF, MDM, ON");
        }

        [Test]
        public void ANamedPositionIsSentWithoutABarAndAScaleWithOne()
        {
            var list = CarList.Default;
            var mode = JObject.Parse(CarControls.Read(list.Find("mclaren570sgt4"), new CarListTests.Car { ["dcABS"] = 1f }.Read, false).ToJson());
            Assert.That((string)mode["more"][0]["text"], Is.EqualTo("SPORT"));
            Assert.That(mode["more"][0]["fill"], Is.Null, "SPORT is a mode, not a quantity");

            var soc = CarControls.Read(list.Find("mclarenmp430"), new CarListTests.Car { ["dcMGUKDeployMode"] = 50f }.Read, false);
            var deploy = soc.More.Single(m => m.Id == "mguDeploy");
            Assert.That((deploy.Text, deploy.Fill), Is.EqualTo(("50%", (double?)0.5)));
        }

        // ── Live ──

        [Test]
        public void TheBarFollowsTheValueAsHeTurnsTheDial()
        {
            // The 963 of the list's fixture: brake migration from -6 to 6. Each frame is read afresh, so each click moves
            // the bar the HUD is sent.
            var car = CarListTests.List().Find("porsche963gtp");
            var telemetry = CarListTests.Porsche963();
            var fills = new List<double?>();
            foreach (float migration in new[] { -2f, -1f, 0f, 3f, 6f, 7f })
            {
                telemetry["dcABS"] = migration;
                var json = JObject.Parse(CarControls.Read(car, telemetry.Read, false).ToJson());
                fills.Add((double?)json["more"].First(m => (string)m["id"] == "brakeMigration")["fill"]);
            }
            Assert.That(fills, Is.EqualTo(new double?[] { 0.333, 0.417, 0.5, 0.75, 1, 1 }));

            // And in the list this build carries: the 963's bias, from what his files show of it.
            var real = CarList.Default.Find("porsche963gtp");
            var bias = real.Control("brakeBias");
            Assert.That((bias.Min, bias.Max), Is.EqualTo(((double?)46, (double?)55)));
            var one = CarControls.Read(real, new CarListTests.Car { ["dcBrakeBias"] = 48.25f }.Read, false).BrakeBias.Fill;
            var two = CarControls.Read(real, new CarListTests.Car { ["dcBrakeBias"] = 50.5f }.Read, false).BrakeBias.Fill;
            Assert.That(one, Is.EqualTo(0.25).Within(1e-6));
            Assert.That(two, Is.EqualTo(0.5).Within(1e-6));
        }
    }
}
