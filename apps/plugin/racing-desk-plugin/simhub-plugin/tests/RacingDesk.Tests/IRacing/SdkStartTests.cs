using IRSDKSharper;
using NUnit.Framework;
using RacingDesk.Plugin.IRacing;

namespace RacingDesk.Tests.IRacing
{
    /// <summary>
    /// IRSDKSharper 1.1.4's Start() spins until it sees its connection loop's flag set, and the loop clears the flag as
    /// soon as it has connected — at once when the sim's shared memory is already there. A caller that misses that
    /// moment spins for good: the host of 2026-09-29 19:28 never got past it (see SdkStart). An SDK made here opens
    /// nothing: nothing is started, and iRacing's shared memory is not looked for.
    /// </summary>
    [TestFixture]
    public class SdkStartTests
    {
        [Test]
        public void IRSDKSharperStillHasTheWaitThatSdkStartLetsThrough()
        {
            // If this fails, IRSDKSharper has changed. Read its Start() again: if it no longer waits for the loop's
            // flag, SdkStart can go; if it waits some other way, SdkStart has to follow it.
            Assert.That(typeof(IRacingSdk).Assembly.GetName().Version, Is.EqualTo(new System.Version(1, 1, 4, 0)));
            Assert.That(SdkStart.LoopRunning?.FieldType, Is.EqualTo(typeof(bool)), "IRacingSdk.connectionLoopRunning");
            Assert.That(SdkStart.KeepThreadsAlive?.FieldType, Is.EqualTo(typeof(int)), "IRacingSdk.keepThreadsAlive");
        }

        [Test]
        public void TheWaitIsLetThroughOnItsFirstLook()
        {
            var sdk = new IRacingSdk(false, false);
            Assert.That(SdkStart.LoopRunning!.GetValue(sdk), Is.False, "what Start() would spin on until the loop sets it");

            SdkStart.Prepare(sdk);

            Assert.That(SdkStart.LoopRunning.GetValue(sdk), Is.True);
            Assert.That(sdk.IsStarted, Is.False, "and nothing else is touched: Start() does the rest");
        }

        [Test]
        public void AnSdkAlreadyStartedIsLeftAlone()
        {
            var sdk = new IRacingSdk(false, false);
            SdkStart.KeepThreadsAlive!.SetValue(sdk, 1);    // as Start() leaves it, whether its wait is over or not

            SdkStart.Prepare(sdk);

            Assert.That(SdkStart.LoopRunning!.GetValue(sdk), Is.False,
                "once the loop has run the flag is its own: set here, it would never be cleared, and Stop() would wait on it for good");
        }
    }
}
