using System;
using System.Collections.Generic;

namespace RaceCorProDrive.Plugin.Engine
{
    /// <summary>
    /// Represents a pedal response curve profile. Stores the curve points
    /// for throttle, brake, and clutch, plus metadata for car association.
    /// </summary>
    public class PedalProfile
    {
        /// <summary>Unique profile ID (GUID string).</summary>
        public string Id { get; set; } = Guid.NewGuid().ToString("N");

        /// <summary>Human-readable profile name (e.g. "GT3 Aggressive Brake").</summary>
        public string Name { get; set; } = "Default";

        /// <summary>Car model string this profile is bound to, or "" for global.</summary>
        public string CarModel { get; set; } = "";

        /// <summary>Car display name for the settings UI.</summary>
        public string CarName { get; set; } = "";

        /// <summary>When this profile was last modified.</summary>
        public DateTime LastModified { get; set; } = DateTime.UtcNow;

        /// <summary>Source of the profile: "manual", "moza", "fanatec", etc.</summary>
        public string Source { get; set; } = "manual";

        // ── Throttle curve ────────────────────────────────────────────
        /// <summary>Throttle deadzone (0-1, portion of travel that produces no output).</summary>
        public double ThrottleDeadzone { get; set; }

        /// <summary>Throttle gamma/linearity (1.0 = linear, &lt;1 = aggressive, &gt;1 = progressive).</summary>
        public double ThrottleGamma { get; set; } = 1.0;

        /// <summary>Throttle sensitivity (0-1, max output level).</summary>
        public double ThrottleSensitivity { get; set; } = 1.0;

        /// <summary>Custom throttle curve points [input, output] pairs, 0-1 range.
        /// If non-empty, overrides deadzone/gamma/sensitivity.</summary>
        public List<double[]> ThrottleCurvePoints { get; set; } = new List<double[]>();

        // ── Brake curve ───────────────────────────────────────────────
        /// <summary>Brake deadzone (0-1).</summary>
        public double BrakeDeadzone { get; set; }

        /// <summary>Brake gamma (1.0 = linear, &lt;1 = aggressive early bite, &gt;1 = progressive).</summary>
        public double BrakeGamma { get; set; } = 1.0;

        /// <summary>Brake sensitivity (0-1).</summary>
        public double BrakeSensitivity { get; set; } = 1.0;

        /// <summary>Custom brake curve points [input, output] pairs.</summary>
        public List<double[]> BrakeCurvePoints { get; set; } = new List<double[]>();

        // ── Clutch curve ──────────────────────────────────────────────
        /// <summary>Clutch deadzone (0-1).</summary>
        public double ClutchDeadzone { get; set; }

        /// <summary>Clutch gamma.</summary>
        public double ClutchGamma { get; set; } = 1.0;

        /// <summary>Custom clutch curve points.</summary>
        public List<double[]> ClutchCurvePoints { get; set; } = new List<double[]>();

        // ── Curve evaluation ──────────────────────────────────────────

        /// <summary>
        /// Evaluate the throttle response curve for a given raw input (0-1).
        /// Returns the mapped output (0-1).
        /// </summary>
        public double EvalThrottle(double raw)
            => EvalCurve(raw, ThrottleDeadzone, ThrottleGamma, ThrottleSensitivity, ThrottleCurvePoints);

        /// <summary>Evaluate brake response curve.</summary>
        public double EvalBrake(double raw)
            => EvalCurve(raw, BrakeDeadzone, BrakeGamma, BrakeSensitivity, BrakeCurvePoints);

        /// <summary>Evaluate clutch response curve.</summary>
        public double EvalClutch(double raw)
            => EvalCurve(raw, ClutchDeadzone, ClutchGamma, 1.0, ClutchCurvePoints);

        private static double EvalCurve(double raw, double deadzone, double gamma,
            double sensitivity, List<double[]> curvePoints)
        {
            raw = Math.Max(0.0, Math.Min(1.0, raw));

            // Custom curve takes priority
            if (curvePoints != null && curvePoints.Count >= 2)
                return InterpolateCurve(curvePoints, raw);

            // Apply deadzone
            if (raw <= deadzone) return 0.0;
            double normalized = (raw - deadzone) / (1.0 - deadzone);

            // Apply gamma
            double curved = Math.Pow(normalized, gamma);

            // Apply sensitivity cap
            return Math.Min(sensitivity, curved);
        }

        /// <summary>
        /// Linearly interpolate through a set of curve points.
        /// Points must be sorted by input (X) value ascending.
        /// </summary>
        private static double InterpolateCurve(List<double[]> points, double x)
        {
            if (points.Count == 0) return x;
            if (x <= points[0][0]) return points[0][1];
            if (x >= points[points.Count - 1][0]) return points[points.Count - 1][1];

            for (int i = 1; i < points.Count; i++)
            {
                if (x <= points[i][0])
                {
                    double x0 = points[i - 1][0], y0 = points[i - 1][1];
                    double x1 = points[i][0], y1 = points[i][1];
                    double t = (x1 - x0) > 0.0001 ? (x - x0) / (x1 - x0) : 0;
                    return y0 + t * (y1 - y0);
                }
            }
            return points[points.Count - 1][1];
        }

        /// <summary>
        /// Generate a 21-point representation of the throttle curve for dashboard visualization.
        /// Returns array of [input, output] pairs at 5% intervals.
        /// </summary>
        public double[][] GetThrottleCurveDisplay()
            => GenerateDisplayCurve(p => EvalThrottle(p));

        /// <summary>Generate brake curve for display.</summary>
        public double[][] GetBrakeCurveDisplay()
            => GenerateDisplayCurve(p => EvalBrake(p));

        /// <summary>Generate clutch curve for display.</summary>
        public double[][] GetClutchCurveDisplay()
            => GenerateDisplayCurve(p => EvalClutch(p));

        private static double[][] GenerateDisplayCurve(Func<double, double> eval)
        {
            var pts = new double[21][];
            for (int i = 0; i <= 20; i++)
            {
                double x = i / 20.0;
                pts[i] = new[] { x, eval(x) };
            }
            return pts;
        }
    }
}
