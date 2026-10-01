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
    /// mean of its three bands, times a hundred — which is what SimHub publishes for the same tyre, so the host and
    /// the plugin agree to the number.</item>
    /// <item><see cref="FromSimHub"/>: SimHub's <c>GameData.TyreWear*</c>, which for iRacing is that percent already
    /// (checked live beside SimHub 9.12 on 2026-09-17 and 2026-10-01; SimHub's bundled dashes read it as
    /// <c>100 - [TyreWearFrontLeft]</c>) and reads 0 while SimHub has nothing — so 0 is not a measurement.</item>
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
        /// One corner's tread remaining, 0..100 %, from iRacing's three bands (each a fraction remaining, 1 = new): their
        /// mean, times a hundred. Null where all three are 0 or absent — the sim has not said, which is not a bald tyre.
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
