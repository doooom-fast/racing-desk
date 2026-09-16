using System;
using System.Collections.Generic;

namespace RaceCorProDrive.Tests.TestHelpers
{
    /// <summary>
    /// Extracted color logic from CommentaryEngine. Provides sentiment color resolution,
    /// text color resolution, and color normalization for SimHub dashboard compatibility.
    /// </summary>
    public static class CommentaryColorResolver
    {
        // Category → color mapping
        // Color encodes event TYPE (category). Avoids all flag colors:
        // red, yellow/amber, blue, orange, black.
        private static readonly Dictionary<string, string> CategoryColors =
            new Dictionary<string, string>
            {
                { "hardware",          "00ACC1" },  // cyan
                { "game_feel",         "AB47BC" },  // purple
                { "car_response",      "66BB6A" },  // green
                { "racing_experience", "EC407A" },  // magenta/pink
            };

        // Category → WCAG text color
        private static readonly Dictionary<string, string> CategoryTextColors =
            new Dictionary<string, string>
            {
                { "hardware",          "#FFB2EBF2" },  // light cyan
                { "game_feel",         "#FFCE93D8" },  // light purple
                { "car_response",      "#FFA5D6A7" },  // light green
                { "racing_experience", "#FFF48FB1" },  // light pink
            };

        // Severity → alpha mapping (opacity)
        private static readonly Dictionary<int, string> SeverityAlphas =
            new Dictionary<int, string>
            {
                { 1, "66" },  // 40%
                { 2, "8C" },  // 55%
                { 3, "B3" },  // 70%
                { 4, "D9" },  // 85%
                { 5, "FF" },  // 100%
            };

        /// <summary>
        /// Resolves the overlay color for a topic.
        /// Color (RGB) comes from the topic's CATEGORY — avoids flag color collisions.
        /// Alpha (opacity) comes from the topic's SEVERITY — higher = more opaque.
        /// Returns #AARRGGBB format.
        /// </summary>
        public static string ResolveSentimentColor(string category, int severity)
        {
            // Get RGB from category
            string rgb = CategoryColors.TryGetValue(category ?? "", out var catRgb)
                ? catRgb
                : "37474F"; // fallback slate grey

            // Get alpha from severity
            string alpha = SeverityAlphas.TryGetValue(severity, out var a)
                ? a
                : "B3"; // fallback 70%

            return $"#{alpha}{rgb}";
        }

        /// <summary>
        /// Resolves the WCAG-compliant text color for a topic.
        /// Same hue family as the overlay, but bright enough for AA contrast
        /// against the translucent overlay on a dark/black background.
        /// Returns #AARRGGBB (fully opaque).
        /// </summary>
        public static string ResolveTextColor(string category)
        {
            return CategoryTextColors.TryGetValue(category ?? "", out var textColor)
                ? textColor
                : "#FFFFFFFF"; // fallback white
        }

        /// <summary>
        /// Converts a color string to #AARRGGBB format for SimHub dashboard compatibility.
        /// Accepts #RGB, #RRGGBB, or #AARRGGBB input.
        /// </summary>
        public static string NormalizeColor(string color)
        {
            if (string.IsNullOrEmpty(color)) return "#FF000000";
            color = color.Trim();
            if (!color.StartsWith("#")) color = "#" + color;

            // Already in #AARRGGBB format (9 chars)
            // Special case: #00000000 (all zeros) → opaque black
            if (color.Length == 9 && color.Equals("#00000000", StringComparison.OrdinalIgnoreCase))
                return "#FF000000";
            if (color.Length == 9) return color.ToUpper();

            // #RRGGBB format (7 chars) — prepend FF alpha
            if (color.Length == 7) return "#FF" + color.Substring(1).ToUpper();

            // #RGB shorthand (4 chars)
            if (color.Length == 4)
            {
                char r = color[1], g = color[2], b = color[3];
                return $"#FF{r}{r}{g}{g}{b}{b}".ToUpper();
            }

            return "#FF000000";
        }
    }
}
