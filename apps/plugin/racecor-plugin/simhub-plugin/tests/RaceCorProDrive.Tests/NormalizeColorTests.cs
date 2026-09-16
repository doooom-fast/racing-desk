using NUnit.Framework;
using RaceCorProDrive.Tests.TestHelpers;

namespace RaceCorProDrive.Tests
{
    [TestFixture]
    public class NormalizeColorTests
    {
        #region Standard Formats

        [TestCase("#FF000000", "#FF000000")]
        [TestCase("#FFFFFFFF", "#FFFFFFFF")]
        [TestCase("#FF00FF00", "#FF00FF00")]
        public void NormalizeColor_With9CharAlphaFormat_ReturnedAsIs(string input, string expected)
        {
            Assert.AreEqual(expected, CommentaryColorResolver.NormalizeColor(input));
        }

        [TestCase("#000000", "#FF000000")]
        [TestCase("#FFFFFF", "#FFFFFFFF")]
        [TestCase("#00FF00", "#FF00FF00")]
        [TestCase("#FF0000", "#FFFF0000")]
        public void NormalizeColor_With7CharHexFormat_PrependsFFAlpha(string input, string expected)
        {
            Assert.AreEqual(expected, CommentaryColorResolver.NormalizeColor(input));
        }

        [TestCase("#000", "#FF000000")]
        [TestCase("#FFF", "#FFFFFFFF")]
        [TestCase("#F0F", "#FFFF00FF")]
        public void NormalizeColor_With4CharShorthand_ExpandsToFull(string input, string expected)
        {
            Assert.AreEqual(expected, CommentaryColorResolver.NormalizeColor(input));
        }

        #endregion

        #region Case Handling

        [TestCase("#ff000000", "#FF000000")]
        [TestCase("#Ff00Ff00", "#FF00FF00")]
        [TestCase("#ffffff", "#FFFFFFFF")]
        public void NormalizeColor_WithLowercaseHex_ReturnsUppercase(string input, string expected)
        {
            Assert.AreEqual(expected, CommentaryColorResolver.NormalizeColor(input));
        }

        #endregion

        #region Missing Hash Prefix

        [TestCase("000000", "#FF000000")]
        [TestCase("FFFFFF", "#FFFFFFFF")]
        [TestCase("00FF00", "#FF00FF00")]
        public void NormalizeColor_WithoutHashPrefix_AddsItAutomatically(string input, string expected)
        {
            Assert.AreEqual(expected, CommentaryColorResolver.NormalizeColor(input));
        }

        #endregion

        #region Edge Cases

        [Test]
        public void NormalizeColor_WithNull_ReturnsFallback()
        {
            Assert.AreEqual("#FF000000", CommentaryColorResolver.NormalizeColor(null));
        }

        [Test]
        public void NormalizeColor_WithEmptyString_ReturnsFallback()
        {
            Assert.AreEqual("#FF000000", CommentaryColorResolver.NormalizeColor(""));
        }

        [Test]
        public void NormalizeColor_WithWhitespaceOnly_ReturnsFallback()
        {
            Assert.AreEqual("#FF000000", CommentaryColorResolver.NormalizeColor("   "));
        }

        [Test]
        public void NormalizeColor_WithInvalidLength_ReturnsFallback()
        {
            Assert.AreEqual("#FF000000", CommentaryColorResolver.NormalizeColor("#12"));
            Assert.AreEqual("#FF000000", CommentaryColorResolver.NormalizeColor("#12345"));
            Assert.AreEqual("#FF000000", CommentaryColorResolver.NormalizeColor("#1234567"));
        }

        [Test]
        public void NormalizeColor_WithWhitespaceAroundValue_IsTrimmed()
        {
            Assert.AreEqual("#FF000000", CommentaryColorResolver.NormalizeColor("  #000000  "));
            Assert.AreEqual("#FF000000", CommentaryColorResolver.NormalizeColor("  000000  "));
        }

        #endregion

        #region Comprehensive Test Cases

        [TestCase("#CCRRGGBB", "#CCRRGGBB")] // 8-digit preserved
        [TestCase("#ccrrggbb", "#CCRRGGBB")] // 8-digit case insensitive
        [TestCase("#00AABBCC", "#00AABBCC")] // Full alpha range
        [TestCase("#FF123456", "#FF123456")] // Fully opaque
        [TestCase("#00000000", "#FF000000")] // Black is normalized
        public void NormalizeColor_ComprehensiveAlphaTests(string input, string expected)
        {
            Assert.AreEqual(expected, CommentaryColorResolver.NormalizeColor(input));
        }

        #endregion
    }
}
