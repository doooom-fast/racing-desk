using System;
using System.Collections.Generic;
using System.Linq;

namespace RaceCorProDrive.Plugin.Engine.Strategy
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

        /// <summary>Per-lap tire wear deltas [FL, FR, RL, RR]. Each entry is wear lost that lap.</summary>
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
        /// Current tire wear average across all four tires (0 = new, 1 = gone).
        /// Computed from cumulative wear deltas.
        /// </summary>
        public double[] CumulativeWear
        {
            get
            {
                double[] total = new double[4];
                foreach (var w in WearPerLap)
                    for (int i = 0; i < 4 && i < w.Length; i++)
                        total[i] += w[i];
                return total;
            }
        }

        /// <summary>
        /// Estimates laps remaining before any tire reaches the given wear threshold.
        /// Uses linear extrapolation from recent wear rate.
        /// </summary>
        public double EstimateLapsToWearThreshold(double[] currentWear, double threshold = 0.85)
        {
            if (WearPerLap.Count < 2) return 99;

            // Use last 5 laps for recent wear rate
            int window = Math.Min(5, WearPerLap.Count);
            double minLapsRemaining = double.MaxValue;

            for (int tire = 0; tire < 4; tire++)
            {
                double recentRate = 0;
                for (int i = WearPerLap.Count - window; i < WearPerLap.Count; i++)
                    recentRate += WearPerLap[i][tire];
                recentRate /= window;

                if (recentRate <= 0.0001) continue; // tire not wearing

                double remaining = currentWear[tire] < threshold
                    ? (threshold - currentWear[tire]) / recentRate
                    : 0;
                minLapsRemaining = Math.Min(minLapsRemaining, remaining);
            }

            return minLapsRemaining == double.MaxValue ? 99 : minLapsRemaining;
        }
    }
}
