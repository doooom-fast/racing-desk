using System;
using System.Collections.Generic;
using NUnit.Framework;
using RacingDesk.Core.Screens;
using RacingDesk.Plugin.Engine;

namespace RacingDesk.Tests.Screens
{
    /// <summary>
    /// Which monitor the ambient sampler looks at (<see cref="SimMonitor"/>): the one the sim's window is on, found as the
    /// host's simwindow route finds it, else the primary — and the region it captures there
    /// (<see cref="ScreenColorSampler.Region"/>). It was the primary, always. Windows is never asked here: the sources are
    /// fakes that say what the test tells them and count the times they are asked, and nothing is captured.
    /// </summary>
    [TestFixture]
    public class SimMonitorTests
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

        // His rig in physical pixels, both ways Windows has had it. Until 2026-09-29 the small 1440 × 1080 screen (175 %)
        // was the primary at the origin and the 3440 × 1440 ultrawide, where iRacing runs, began at x = 1440; since, the
        // ultrawide is the primary and the small screen is to its left, at x = -1440.
        private static readonly ScreenRect SmallMain = new ScreenRect(0, 0, 1440, 1080);
        private static readonly ScreenRect UltrawideBeside = new ScreenRect(1440, 0, 3440, 1440);
        private static readonly ScreenRect UltrawideMain = new ScreenRect(0, 0, 3440, 1440);
        private static readonly ScreenRect SmallLeft = new ScreenRect(-1440, 0, 1440, 1080);

        private static FakeMonitors SmallIsPrimary() => new FakeMonitors
        {
            Answer =
            {
                new MonitorInfo { Bounds = SmallMain, Primary = true },
                new MonitorInfo { Bounds = UltrawideBeside, Primary = false },
            },
        };

        private static FakeMonitors UltrawideIsPrimary() => new FakeMonitors
        {
            Answer =
            {
                new MonitorInfo { Bounds = SmallLeft, Primary = false },
                new MonitorInfo { Bounds = UltrawideMain, Primary = true },
            },
        };

        private static FakeSimWindow SimOn(ScreenRect monitor) => new FakeSimWindow
        {
            Answer = new SimWindowInfo { Process = "iRacingSim64DX11", Window = monitor, Monitor = monitor },
        };

        private static void AssertRect(ScreenRect actual, int x, int y, int width, int height)
        {
            Assert.That((actual.X, actual.Y, actual.Width, actual.Height), Is.EqualTo((x, y, width, height)));
        }

        // ── Which monitor ────────────────────────────────────────────────────────────────────────────────────────

        [Test]
        public void TheSimOnTheUltrawide_IsSampledThere_NotOnThePrimary()
        {
            var sim = SimOn(UltrawideBeside);
            var monitors = SmallIsPrimary();

            AssertRect(SimMonitor.Choose(sim, monitors, out var why), 1440, 0, 3440, 1440);
            Assert.That(why, Is.EqualTo(SimMonitor.Reason.Sim));
            // The monitor the sim's window is on is taken as the source gives it: the list is not asked.
            Assert.That(monitors.Asked, Is.EqualTo(0));
        }

        [Test]
        public void TheSimOnTheSmallScreen_ToTheLeftOfThePrimary_IsSampledThere()
        {
            AssertRect(SimMonitor.Choose(SimOn(SmallLeft), UltrawideIsPrimary(), out var why), -1440, 0, 1440, 1080);
            Assert.That(why, Is.EqualTo(SimMonitor.Reason.Sim));
        }

        [Test]
        public void NoSimWindow_IsThePrimary_WhicheverScreenThatIs()
        {
            var closed = new FakeSimWindow { Answer = null };

            AssertRect(SimMonitor.Choose(closed, SmallIsPrimary(), out var why), 0, 0, 1440, 1080);
            Assert.That(why, Is.EqualTo(SimMonitor.Reason.Primary));

            AssertRect(SimMonitor.Choose(closed, UltrawideIsPrimary(), out why), 0, 0, 3440, 1440);
            Assert.That(why, Is.EqualTo(SimMonitor.Reason.Primary));
        }

        [Test]
        public void ASimLookThatCannotBeMade_IsThePrimary_AndGoesNoFurther()
        {
            var failing = new FakeSimWindow { Throws = new InvalidOperationException("no process list") };

            AssertRect(SimMonitor.Choose(failing, UltrawideIsPrimary(), out var why), 0, 0, 3440, 1440);
            Assert.That(why, Is.EqualTo(SimMonitor.Reason.Primary));
        }

        [Test]
        public void ASimWindowWithNoSize_IsNoWindow()
        {
            var nothing = new FakeSimWindow
            {
                Answer = new SimWindowInfo { Process = "iRacingSim64DX11", Window = new ScreenRect(-32000, -32000, 0, 0), Monitor = UltrawideBeside },
            };

            AssertRect(SimMonitor.Choose(nothing, SmallIsPrimary(), out var why), 0, 0, 1440, 1080);
            Assert.That(why, Is.EqualTo(SimMonitor.Reason.Primary));
        }

        [Test]
        public void ASimWindowWhoseMonitorIsNotSaid_IsOnTheListedMonitorThatHoldsMostOfIt()
        {
            // Mostly on the ultrawide, a strip of it over the edge onto the small screen.
            var straddling = new FakeSimWindow
            {
                Answer = new SimWindowInfo { Process = "iRacingSim64DX11", Window = new ScreenRect(1200, 0, 3000, 1400), Monitor = new ScreenRect() },
            };

            AssertRect(SimMonitor.Choose(straddling, SmallIsPrimary(), out var why), 1440, 0, 3440, 1440);
            Assert.That(why, Is.EqualTo(SimMonitor.Reason.Sim));

            // On no monitor at all: the primary.
            straddling.Answer!.Window = new ScreenRect(9000, 9000, 800, 600);
            AssertRect(SimMonitor.Choose(straddling, SmallIsPrimary(), out why), 0, 0, 1440, 1080);
            Assert.That(why, Is.EqualTo(SimMonitor.Reason.Primary));
        }

        [Test]
        public void NoMonitorToFallBackTo_IsNone_NotAMadeUpScreen()
        {
            var closed = new FakeSimWindow { Answer = null };

            var none = SimMonitor.Choose(closed, new FakeMonitors(), out var why);
            Assert.That(none.IsUsable, Is.False);
            Assert.That(why, Is.EqualTo(SimMonitor.Reason.None));

            var noPrimary = new FakeMonitors { Answer = { new MonitorInfo { Bounds = SmallMain, Primary = false } } };
            Assert.That(SimMonitor.Choose(closed, noPrimary, out why).IsUsable, Is.False);
            Assert.That(why, Is.EqualTo(SimMonitor.Reason.None));

            var failing = new FakeMonitors { Throws = new InvalidOperationException("Windows would not list the monitors") };
            Assert.That(SimMonitor.Choose(closed, failing, out why).IsUsable, Is.False);
            Assert.That(why, Is.EqualTo(SimMonitor.Reason.None));

            var odd = new FakeMonitors { Answer = { null!, new MonitorInfo { Bounds = new ScreenRect(0, 0, 0, 0), Primary = true } } };
            Assert.That(SimMonitor.Choose(closed, odd, out why).IsUsable, Is.False);
            Assert.That(why, Is.EqualTo(SimMonitor.Reason.None));

            Assert.That(SimMonitor.Choose(null!, null!, out why).IsUsable, Is.False);
            Assert.That(why, Is.EqualTo(SimMonitor.Reason.None));
        }

        // ── How often it is looked for ───────────────────────────────────────────────────────────────────────────

        [Test]
        public void WhatIsFound_IsKeptForTwoSeconds_ThenLookedForAgain()
        {
            var sim = SimOn(UltrawideBeside);
            var screen = new SimMonitor(sim, SmallIsPrimary());

            AssertRect(screen.Current(0), 1440, 0, 3440, 1440);
            Assert.That(screen.Why, Is.EqualTo(SimMonitor.Reason.Sim));
            // Four times a second, for two seconds: one look.
            for (long at = 250; at < SimMonitor.LookEveryMs; at += 250) screen.Current(at);
            Assert.That(sim.Asked, Is.EqualTo(1));

            // The sim closes: the next look finds the primary.
            sim.Answer = null;
            AssertRect(screen.Current(1999), 1440, 0, 3440, 1440);
            AssertRect(screen.Current(SimMonitor.LookEveryMs), 0, 0, 1440, 1080);
            Assert.That(screen.Why, Is.EqualTo(SimMonitor.Reason.Primary));
            Assert.That(sim.Asked, Is.EqualTo(2));
        }

        [Test]
        public void AfterForget_OrAClockThatWentBack_ItIsLookedForAtOnce()
        {
            var sim = SimOn(UltrawideBeside);
            var screen = new SimMonitor(sim, SmallIsPrimary());

            screen.Current(5000);
            screen.Forget();
            screen.Current(5001);
            Assert.That(sim.Asked, Is.EqualTo(2));

            screen.Current(100);
            Assert.That(sim.Asked, Is.EqualTo(3));
        }

        [Test]
        public void TheSimMovingToTheOtherScreen_IsFollowedAtTheNextLook()
        {
            var sim = SimOn(UltrawideMain);
            var screen = new SimMonitor(sim, UltrawideIsPrimary());

            AssertRect(screen.Current(0), 0, 0, 3440, 1440);
            sim.Answer = new SimWindowInfo { Process = "iRacingSim64DX11", Window = SmallLeft, Monitor = SmallLeft };
            AssertRect(screen.Current(SimMonitor.LookEveryMs), -1440, 0, 1440, 1080);
            Assert.That(screen.Why, Is.EqualTo(SimMonitor.Reason.Sim));
        }

        // ── The region captured there ────────────────────────────────────────────────────────────────────────────

        [Test]
        public void TheRegion_IsTheRatiosOfTheSimsMonitor_FromItsOwnCorner()
        {
            // The top-left quarter of the ultrawide beside the small primary: it begins at x = 1440, not at 0.
            AssertRect(ScreenColorSampler.Region(UltrawideBeside, 0, 0, 0.5, 0.5), 1440, 0, 1720, 720);
            // A strip across the middle of the small screen to the left of the primary: x is negative.
            AssertRect(ScreenColorSampler.Region(SmallLeft, 0.25, 0.4, 0.5, 0.2), -1080, 432, 720, 216);
            // The whole of it.
            AssertRect(ScreenColorSampler.Region(UltrawideMain, 0, 0, 1, 1), 0, 0, 3440, 1440);
        }

        [Test]
        public void TheRegion_IsKeptOnTheMonitor_AndIsAtLeastAPixel()
        {
            // A region running past the edge is cut there; one that begins off the monitor is moved onto it (a corner,
            // at least a pixel). Nothing is read from the screen beside it.
            AssertRect(ScreenColorSampler.Region(UltrawideBeside, 0.9, 0.9, 0.5, 0.5), 1440 + 3096, 1296, 344, 144);
            AssertRect(ScreenColorSampler.Region(SmallLeft, -0.5, -0.5, 0.25, 0.25), -1440, 0, 360, 270);
            AssertRect(ScreenColorSampler.Region(SmallLeft, 1.5, 1.5, 0.25, 0.25), -1, 1079, 1, 1);
            AssertRect(ScreenColorSampler.Region(SmallMain, 0.5, 0.5, 0.0001, 0.0001), 720, 540, 1, 1);
        }

        [Test]
        public void NoMonitor_IsNoRegion()
        {
            Assert.That(ScreenColorSampler.Region(new ScreenRect(), 0, 0, 1, 1).IsUsable, Is.False);
        }

        [Test]
        public void TheLog_SaysWhichMonitorIsSampled_AndWhy()
        {
            Assert.That(ScreenColorSampler.Where(UltrawideBeside, SimMonitor.Reason.Sim),
                Is.EqualTo("sampling the monitor iRacing is on, 3440x1440 at (1440, 0)"));
            Assert.That(ScreenColorSampler.Where(SmallMain, SimMonitor.Reason.Primary),
                Is.EqualTo("sampling the primary monitor, 1440x1080 at (0, 0): iRacing's window was not found"));
            Assert.That(ScreenColorSampler.Where(new ScreenRect(), SimMonitor.Reason.None),
                Is.EqualTo("no monitor to sample: Windows listed none"));
        }

        [Test]
        public void TheSampler_IsMadeWithoutLookingAtAnything()
        {
            var sim = SimOn(UltrawideBeside);
            var monitors = SmallIsPrimary();
            using (var sampler = new ScreenColorSampler(new SimMonitor(sim, monitors)))
            {
                sampler.SetRect(0, 0, 0.1, 0.1);
                Assert.That(sampler.HasColor, Is.False);
            }
            // Not started: nothing was looked for.
            Assert.That(sim.Asked + monitors.Asked, Is.EqualTo(0));
        }
    }
}
