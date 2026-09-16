using NUnit.Framework;
using RaceCorProDrive.Tests.TestHelpers;

namespace RaceCorProDrive.Tests
{
    [TestFixture]
    public class ColorResolverTests
    {
        #region ResolveSentimentColor - Basics

        [TestCase("hardware", 1, "#6600ACC1")]
        [TestCase("hardware", 2, "#8C00ACC1")]
        [TestCase("hardware", 5, "#FF00ACC1")]
        [TestCase("game_feel", 1, "#66AB47BC")]
        [TestCase("game_feel", 5, "#FFAB47BC")]
        [TestCase("car_response", 1, "#6666BB6A")]
        [TestCase("car_response", 5, "#FF66BB6A")]
        [TestCase("racing_experience", 1, "#66EC407A")]
        [TestCase("racing_experience", 5, "#FFEC407A")]
        public void ResolveSentimentColor_WithKnownCategories_ReturnsCorrectColor(string category, int severity, string expected)
        {
            string result = CommentaryColorResolver.ResolveSentimentColor(category, severity);
            Assert.AreEqual(expected, result, $"Category '{category}' with severity {severity} should resolve to {expected}");
        }

        [Test]
        public void ResolveSentimentColor_WithUnknownCategory_ReturnsFallbackWithCorrectSeverity()
        {
            string result = CommentaryColorResolver.ResolveSentimentColor("unknown_category", 3);
            // Fallback color is slate grey with 70% alpha for severity 3
            Assert.AreEqual("#B337474F", result);
        }

        [Test]
        public void ResolveSentimentColor_WithInvalidSeverity_ReturnsFallbackAlpha()
        {
            string result = CommentaryColorResolver.ResolveSentimentColor("hardware", 99);
            // Unknown severity defaults to 70% alpha (B3)
            Assert.AreEqual("#B300ACC1", result);
        }

        [Test]
        public void ResolveSentimentColor_WithNullCategory_UsesFallback()
        {
            string result = CommentaryColorResolver.ResolveSentimentColor(null!, 2);
            // Should use fallback slate grey with 55% alpha
            Assert.AreEqual("#8C37474F", result);
        }

        #endregion

        #region ResolveSentimentColor - Severity Mapping

        [TestCase(1, "66")] // 40%
        [TestCase(2, "8C")] // 55%
        [TestCase(3, "B3")] // 70%
        [TestCase(4, "D9")] // 85%
        [TestCase(5, "FF")] // 100%
        public void ResolveSentimentColor_SeverityAlphaMappings_AreCorrect(int severity, string expectedAlpha)
        {
            string result = CommentaryColorResolver.ResolveSentimentColor("hardware", severity);
            Assert.IsTrue(result.StartsWith("#" + expectedAlpha), $"Severity {severity} should have alpha {expectedAlpha}");
        }

        #endregion

        #region ResolveTextColor

        [TestCase("hardware", "#FFB2EBF2")]
        [TestCase("game_feel", "#FFCE93D8")]
        [TestCase("car_response", "#FFA5D6A7")]
        [TestCase("racing_experience", "#FFF48FB1")]
        public void ResolveTextColor_WithKnownCategories_ReturnsCorrectColor(string category, string expected)
        {
            string result = CommentaryColorResolver.ResolveTextColor(category);
            Assert.AreEqual(expected, result, $"Text color for category '{category}' should be {expected}");
        }

        [Test]
        public void ResolveTextColor_WithUnknownCategory_ReturnsFallback()
        {
            string result = CommentaryColorResolver.ResolveTextColor("unknown_category");
            Assert.AreEqual("#FFFFFFFF", result); // white fallback
        }

        [Test]
        public void ResolveTextColor_WithNullCategory_ReturnsFallback()
        {
            string result = CommentaryColorResolver.ResolveTextColor(null!);
            Assert.AreEqual("#FFFFFFFF", result); // white fallback
        }

        [Test]
        public void ResolveTextColor_AllColorsAreFullyOpaque()
        {
            var categories = new[] { "hardware", "game_feel", "car_response", "racing_experience" };
            foreach (var cat in categories)
            {
                string result = CommentaryColorResolver.ResolveTextColor(cat);
                Assert.IsTrue(result.StartsWith("#FF"), $"Text color for '{cat}' should be fully opaque (FF alpha)");
            }
        }

        #endregion

        #region NormalizeColor - Format Conversions

        [TestCase("#AARRGGBB", "#AARRGGBB")]
        [TestCase("#aarrggbb", "#AARRGGBB")]
        public void NormalizeColor_With8DigitHex_ReturnedUnchangedUppercase(string input, string expected)
        {
            string result = CommentaryColorResolver.NormalizeColor(input);
            Assert.AreEqual(expected, result);
        }

        [TestCase("#RRGGBB", "#FFRRGGBB")]
        [TestCase("#00FF00", "#FF00FF00")]
        [TestCase("#FF0000", "#FFFF0000")]
        public void NormalizeColor_With6DigitHex_PrependsFFAlpha(string input, string expected)
        {
            string result = CommentaryColorResolver.NormalizeColor(input);
            Assert.AreEqual(expected, result);
        }

        [TestCase("#RGB", "#FFRRGGBB")]
        [TestCase("#FFF", "#FFFFFFFF")]
        [TestCase("#000", "#FF000000")]
        public void NormalizeColor_With4DigitHex_ExpandsAndPrependsFF(string input, string expected)
        {
            string result = CommentaryColorResolver.NormalizeColor(input);
            Assert.AreEqual(expected, result);
        }

        [TestCase("RRGGBB", "#FFRRGGBB")] // no # prefix
        [TestCase("00FF00", "#FF00FF00")]
        public void NormalizeColor_WithoutHashPrefix_AddsItAndNormalizes(string input, string expected)
        {
            string result = CommentaryColorResolver.NormalizeColor(input);
            Assert.AreEqual(expected, result);
        }

        [Test]
        public void NormalizeColor_WithEmptyString_ReturnsFallback()
        {
            string result = CommentaryColorResolver.NormalizeColor("");
            Assert.AreEqual("#FF000000", result);
        }

        [Test]
        public void NormalizeColor_WithNull_ReturnsFallback()
        {
            string result = CommentaryColorResolver.NormalizeColor(null!);
            Assert.AreEqual("#FF000000", result);
        }

        [Test]
        public void NormalizeColor_WithInvalidLength_ReturnsFallback()
        {
            string result = CommentaryColorResolver.NormalizeColor("#12");
            Assert.AreEqual("#FF000000", result);
        }

        [Test]
        public void NormalizeColor_WithWhitespace_IsTrimmed()
        {
            string result = CommentaryColorResolver.NormalizeColor("  #FFFFFF  ");
            Assert.AreEqual("#FFFFFFFF", result);
        }

        [Test]
        public void NormalizeColor_ReturnsUppercase()
        {
            string result = CommentaryColorResolver.NormalizeColor("#00ffaa");
            Assert.AreEqual("#FF00FFAA", result);
        }

        #endregion

        #region Color Collision Tests (Regression)

        [Test]
        public void ResolveSentimentColor_DoesNotCollidWithRedFlag()
        {
            // Flag colors: red ≈ 0 (hue 0-15)
            var categories = new[] { "hardware", "game_feel", "car_response", "racing_experience" };
            foreach (var cat in categories)
            {
                string color = CommentaryColorResolver.ResolveSentimentColor(cat, 3);
                // Extract RGB from #AARRGGBB: color[3..9]
                string rgb = color.Substring(3, 6);
                // Red flag: #FF0000, don't use pure red
                Assert.AreNotEqual("FF0000", rgb, $"Category '{cat}' uses red which collides with flag");
            }
        }

        [Test]
        public void ResolveSentimentColor_DoesNotCollidWithYellowFlag()
        {
            // Yellow flag: #FFFF00 (hue ~60)
            var categories = new[] { "hardware", "game_feel", "car_response", "racing_experience" };
            foreach (var cat in categories)
            {
                string color = CommentaryColorResolver.ResolveSentimentColor(cat, 3);
                string rgb = color.Substring(3, 6);
                Assert.AreNotEqual("FFFF00", rgb, $"Category '{cat}' uses yellow which collides with flag");
            }
        }

        [Test]
        public void ResolveSentimentColor_DoesNotCollidWithBlueFlag()
        {
            // Blue flag: #0000FF (hue ~240)
            var categories = new[] { "hardware", "game_feel", "car_response", "racing_experience" };
            foreach (var cat in categories)
            {
                string color = CommentaryColorResolver.ResolveSentimentColor(cat, 3);
                string rgb = color.Substring(3, 6);
                Assert.AreNotEqual("0000FF", rgb, $"Category '{cat}' uses blue which collides with flag");
            }
        }

        #endregion
    }
}
