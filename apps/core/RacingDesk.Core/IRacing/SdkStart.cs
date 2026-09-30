using System.Reflection;
using IRSDKSharper;

namespace RacingDesk.Plugin.IRacing
{
    /// <summary>
    /// Starts IRSDKSharper without the wait in its <c>Start()</c> that can last for ever.
    /// </summary>
    /// <remarks>
    /// In 1.1.4, <c>Start()</c> starts the connection loop on a thread of its own and then spins
    /// (<c>Thread.Sleep(0)</c>) until it sees the loop's <c>connectionLoopRunning</c> set. The loop sets it on
    /// entry and clears it on the way out, and it goes out as soon as it has connected: on its first pass, when
    /// iRacing's shared memory is already there — as it is, sim running or not, once iRacing has run while SimHub is
    /// up, since SimHub holds it open. A caller that is not scheduled in that moment never sees the flag set, and spins
    /// for good on a core of its own.
    /// That is how the host started at 19:28:34 on 2026-09-29 never got past <c>raw.Start()</c> to the loop that
    /// watches for the app going, and outlived the app. Setting the flag before <c>Start()</c> lets that wait through
    /// on its first look and changes nothing else: the loop sets it again on entry and clears it on the way out, and
    /// <c>Stop()</c> waits for the clearing as it did.
    /// </remarks>
    internal static class SdkStart
    {
        internal static readonly FieldInfo LoopRunning =
            typeof(IRacingSdk).GetField("connectionLoopRunning", BindingFlags.Instance | BindingFlags.NonPublic);

        internal static readonly FieldInfo KeepThreadsAlive =
            typeof(IRacingSdk).GetField("keepThreadsAlive", BindingFlags.Instance | BindingFlags.NonPublic);

        /// <summary>Starts <paramref name="sdk"/>, once; what it does after is its own.</summary>
        public static void Start(IRacingSdk sdk)
        {
            Prepare(sdk);
            sdk.Start();
        }

        /// <summary>
        /// Sets the flag <c>Start()</c> waits for, on an SDK that has not been started: once its loop has run, the
        /// flag is the loop's, and one set here would never be cleared. A build of IRSDKSharper without these fields
        /// is left alone (see the test that pins them).
        /// </summary>
        internal static void Prepare(IRacingSdk sdk)
        {
            if (LoopRunning?.FieldType != typeof(bool) || KeepThreadsAlive?.FieldType != typeof(int)) return;
            if (sdk.IsStarted || (int)KeepThreadsAlive.GetValue(sdk) != 0) return;
            LoopRunning.SetValue(sdk, true);
        }
    }
}
