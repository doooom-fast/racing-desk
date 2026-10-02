using System;

namespace RacingDesk.Plugin.Engine
{
    /// <summary>
    /// Tyre wear has one meaning in The Racing Desk, on the wire and in the code: <b>tread remaining, per corner,
    /// 0..100 percent, 100 = new</b>; <c>null</c> where it has not been measured. Nothing converts it but the
    /// two functions here, called once at each source (root CLAUDE.md, Tyre wear):
    /// <list type="bullet">
    /// <item><see cref="FromBands"/>: iRacing's own variables, <c>LFwearL/M/R</c> and the other corners, a fraction
    /// remaining per tread band (1.0 = new; the header says "percent", the value is a fraction). One corner is the
    /// mean of its three bands, times a hundred. The host and the SimHub plugin both read the bands first, so they
    /// agree to the number (SimHub's own property is the <i>middle</i> band alone: its iRacing reader computes
    /// <c>LFwearM * 100</c>, and was seen to read 0 until a lap was done).</item>
    /// <item><see cref="FromSimHub"/>: SimHub's <c>GameData.TyreWear*</c>, which for iRacing is a percent remaining
    /// (a fresh set read 100 on its wire on 2026-10-01; SimHub's bundled dashes read it as
    /// <c>100 - [TyreWearFrontLeft]</c>) and reads 0 while SimHub has nothing — so 0 is not a measurement. The plugin
    /// asks it only where the bands are absent (another game).</item>
    /// </list>
    /// iRacing measures tread <b>in the pits and nowhere else</b> (his .ibt files: the bands sat at one value for
    /// thirty-one laps and moved on the first frame on pit road), so a value is the last measurement, never live
    /// wear; the strategy engine warns from a measurement and the HUD says what the number is.
    /// The two thresholds every warning uses are here too, at the worn end: a tyre is <b>worn</b> under
    /// <see cref="WarnBelowPercent"/> and <b>critical</b> under <see cref="CriticalBelowPercent"/>. New tyres never warn.
    /// </summary>
    public static class TyreWear
    {
        /// <summary>Under this much tread remaining a tyre is worn: amber on the HUD, the commentary's topic, the strategist's warning.</summary>
        public const double WarnBelowPercent = 35.0;

        /// <summary>Under this much tread remaining a tyre is critical: red on the HUD, the strategist's call for tyres.</summary>
        public const double CriticalBelowPercent = 20.0;

        /// <summary>
        /// The tread of a new set: what a corner whose tyre was changed reads, on the wire and everywhere it is read,
        /// from the change until the sim measures that corner again (<see cref="TyreSetMask"/>; he chose it on
        /// 2026-10-01 over a dash: "100%, new set"). The snapshot's <c>TyreNewSetFlags</c> says which corners read
        /// this by assumption rather than by measurement, so the page can say "new set" and the strategist can know
        /// the 100 is not news. New tyres never warn, so neither does this.
        /// </summary>
        public const double NewPercent = 100.0;

        /// <summary>
        /// One corner's tread remaining, 0..100 %, from iRacing's three bands (each a fraction remaining, 1 = new): their
        /// mean, times a hundred. Null where all three are 0 or absent — the sim has not said, which is not a bald tyre.
        /// (A corner that really is at 0.0 on all three bands reads as not measured too: a variable that is not there
        /// reads 0 the same way, and a false "critical" on a fresh set is the one error this class exists to prevent. The
        /// other corners of a set worn that far are under the threshold as well, and the worst of them warns.)
        /// </summary>
        public static double? FromBands(float left, float middle, float right)
        {
            double sum = (double)left + middle + right;
            if (!(sum > 0)) return null; // 0, or NaN: nothing measured
            return Clamp(sum / 3.0 * 100.0);
        }

        /// <summary>
        /// SimHub's own <c>GameData.TyreWear*</c> for a corner, taken as the percent remaining it is. 0 is what SimHub
        /// publishes while it has nothing (its own dashes read it as unknown), so 0 is null, not a measurement.
        /// </summary>
        public static double? FromSimHub(double value)
        {
            if (!(value > 0) || double.IsInfinity(value)) return null;
            return Clamp(value);
        }

        /// <summary>
        /// A tread remaining as a whole percent, for the words a warning is printed in. It rounds to the nearest, except
        /// that it never rounds across a threshold: 34.6 is worn (under 35) and reads 34, 19.7 is critical (under 20) and
        /// reads 19, so a number printed beside "under 35" is never 35. The page does the same (config.js, tyreWearShown).
        /// </summary>
        public static int DisplayPercent(double remaining)
        {
            double v = Clamp(remaining);
            int shown = (int)Math.Round(v, MidpointRounding.AwayFromZero);
            if (v < CriticalBelowPercent) return Math.Min(shown, (int)CriticalBelowPercent - 1);
            if (v < WarnBelowPercent) return Math.Min(shown, (int)WarnBelowPercent - 1);
            return shown;
        }

        /// <summary>The corner with the least tread of those measured, or null where none is.</summary>
        public static double? Worst(double? fl, double? fr, double? rl, double? rr)
        {
            double? worst = null;
            foreach (var w in new[] { fl, fr, rl, rr })
                if (w.HasValue && (!worst.HasValue || w.Value < worst.Value)) worst = w;
            return worst;
        }

        /// <summary>Measured and under <see cref="WarnBelowPercent"/>. Not measured is never worn.</summary>
        public static bool IsWorn(double? remaining) => remaining.HasValue && remaining.Value < WarnBelowPercent;

        /// <summary>Measured and under <see cref="CriticalBelowPercent"/>. Not measured is never critical.</summary>
        public static bool IsCritical(double? remaining) => remaining.HasValue && remaining.Value < CriticalBelowPercent;

        private static double Clamp(double v) => v < 0 ? 0 : v > 100 ? 100 : v;
    }
}
