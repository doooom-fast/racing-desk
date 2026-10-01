using System;
using System.Collections.Generic;
using System.Linq;

namespace RacingDesk.Plugin.Engine.Strategy
{
    /// <summary>
    /// Tracks per-stint telemetry history: fuel burn, tire wear, lap times,
    /// grip indicators, and driver aid activations. A new StintData is created
    /// each time the car leaves pit lane.
    /// </summary>
    public class StintData
    {
        public int    StintNumber  { get; set; }
        public int    StartLap    { get; set; }
        public double StartFuel   { get; set; }

        /// <summary>Per-lap fuel consumption (liters). Index 0 = first lap of stint.</summary>
        public List<double> FuelPerLap { get; } = new List<double>();

        /// <summary>
        /// Per-lap tread lost [FL, FR, RL, RR], in points of percent remaining (<see cref="TyreWear"/>). iRacing
        /// measures tread in the pits only, so between stops every entry is nought there.
        /// </summary>
        public List<double[]> WearPerLap { get; } = new List<double[]>();

        /// <summary>Per-lap tire temperatures [FL, FR, RL, RR] (average over the lap).</summary>
        public List<double[]> TempPerLap { get; } = new List<double[]>();

        /// <summary>Raw lap times (seconds). Excludes pit in/out laps.</summary>
        public List<double> LapTimes { get; } = new List<double>();

        /// <summary>Peak lateral G recorded each lap (proxy for grip).</summary>
        public List<double> PeakLatG { get; } = new List<double>();

        /// <summary>ABS activation count per lap.</summary>
        public List<int> AbsActivationsPerLap { get; } = new List<int>();

        /// <summary>TC activation count per lap.</summary>
        public List<int> TcActivationsPerLap { get; } = new List<int>();

        // ── Computed properties ──────────────────────────────────────────

        public int LapsCompleted => LapTimes.Count;

        /// <summary>Average fuel burn (liters/lap), excluding outliers.</summary>
        public double AvgFuelPerLap
        {
            get
            {
                if (FuelPerLap.Count == 0) return 0;
                if (FuelPerLap.Count <= 2) return FuelPerLap.Average();
                // Trim top/bottom 10% to remove safety car and off-track laps
                var sorted = FuelPerLap.OrderBy(v => v).ToList();
                int trim = Math.Max(1, sorted.Count / 10);
                return sorted.Skip(trim).Take(sorted.Count - 2 * trim).Average();
            }
        }

        /// <summary>Standard deviation of fuel burn (liters/lap).</summary>
        public double FuelBurnStdDev
        {
            get
            {
                if (FuelPerLap.Count < 3) return 0;
                double avg = AvgFuelPerLap;
                double sumSq = FuelPerLap.Sum(v => (v - avg) * (v - avg));
                return Math.Sqrt(sumSq / FuelPerLap.Count);
            }
        }

        /// <summary>
        /// Linear regression slope of lap times over the stint.
        /// Positive = getting slower (tire deg), negative = getting faster.
        /// </summary>
        public double LapTimeTrend
        {
            get
            {
                if (LapTimes.Count < 3) return 0;
                // Simple least-squares slope
                int n = LapTimes.Count;
                double sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
                for (int i = 0; i < n; i++)
                {
                    sumX += i;
                    sumY += LapTimes[i];
                    sumXY += i * LapTimes[i];
                    sumX2 += i * i;
                }
                double denom = n * sumX2 - sumX * sumX;
                return denom != 0 ? (n * sumXY - sumX * sumY) / denom : 0;
            }
        }

        /// <summary>
        /// Laps before any tyre is down to <paramref name="criticalPercent"/> of tread, extrapolated from the tread lost
        /// over the last five laps. 99 where no tyre has been seen losing tread (iRacing between stops) or none is
        /// measured; 0 for a tyre already at or under the critical tread.
        /// </summary>
        public double EstimateLapsToCritical(double?[] treadRemaining, double criticalPercent)
        {
            if (WearPerLap.Count < 2 || treadRemaining == null) return 99;

            // Use last 5 laps for recent wear rate
            int window = Math.Min(5, WearPerLap.Count);
            double minLapsRemaining = double.MaxValue;

            for (int tire = 0; tire < 4 && tire < treadRemaining.Length; tire++)
            {
                if (!treadRemaining[tire].HasValue) continue; // not measured: nothing to extrapolate from

                double recentRate = 0;
                for (int i = WearPerLap.Count - window; i < WearPerLap.Count; i++)
                    recentRate += WearPerLap[i][tire];
                recentRate /= window;

                if (recentRate <= 0.01) continue; // not seen losing tread (under a hundredth of a point a lap)

                double tread = treadRemaining[tire].Value;
                double laps = tread > criticalPercent ? (tread - criticalPercent) / recentRate : 0;
                minLapsRemaining = Math.Min(minLapsRemaining, laps);
            }

            return minLapsRemaining == double.MaxValue ? 99 : minLapsRemaining;
        }
    }
}
