using System.Linq;
using NUnit.Framework;
using RaceCorProDrive.Plugin.Engine.Moza;

namespace RaceCorProDrive.Tests
{
    /// <summary>
    /// Tests USB descriptor pattern matching for Moza device detection.
    /// Exercises MozaDeviceRegistry.UsbPatterns against real-world USB descriptor
    /// strings, including both legacy (Gudsen-prefixed) and newer (MOZA-prefixed)
    /// firmware variants.
    /// </summary>
    [TestFixture]
    public class MozaDeviceDetectionTests
    {
        /// <summary>
        /// Helper that mirrors MozaSerialManager.ClassifyDevice() logic —
        /// iterates patterns, skips Unknown on first pass, falls back to Unknown.
        /// </summary>
        private static (MozaDeviceRegistry.MozaDeviceType type, string subType)? Classify(string description)
        {
            if (string.IsNullOrEmpty(description)) return null;

            foreach (var pattern in MozaDeviceRegistry.UsbPatterns)
            {
                if (pattern.Pattern.IsMatch(description))
                {
                    if (pattern.DeviceType == MozaDeviceRegistry.MozaDeviceType.Unknown)
                        continue;
                    return (pattern.DeviceType, pattern.SubType ?? "");
                }
            }

            var fallback = MozaDeviceRegistry.UsbPatterns
                .FirstOrDefault(p => p.DeviceType == MozaDeviceRegistry.MozaDeviceType.Unknown);
            if (fallback != null && fallback.Pattern.IsMatch(description))
                return (MozaDeviceRegistry.MozaDeviceType.Unknown, "");

            return null;
        }

        // ═══════════════════════════════════════════════════════════════
        //  WHEELBASE — LEGACY GUDSEN PREFIX
        // ═══════════════════════════════════════════════════════════════

        [TestCase("Gudsen MOZA R9 Base (COM3) USB Serial Device",
            TestName = "Wheelbase_Gudsen_R9_Base")]
        [TestCase("Gudsen MOZA R12 Ultra Base (COM5)",
            TestName = "Wheelbase_Gudsen_R12_UltraBase")]
        [TestCase("Gudsen R5 Racing Wheel and Pedals (COM4)",
            TestName = "Wheelbase_Gudsen_R5_RacingWheel")]
        [TestCase("Gudsen MOZA R16 Base (COM3)",
            TestName = "Wheelbase_Gudsen_R16_Base")]
        [TestCase("Gudsen MOZA R21 Base (COM6)",
            TestName = "Wheelbase_Gudsen_R21_Base")]
        public void Wheelbase_GudsenPrefix_Detected(string desc)
        {
            var result = Classify(desc);
            Assert.That(result, Is.Not.Null, $"Should detect: {desc}");
            Assert.That(result.Value.type, Is.EqualTo(MozaDeviceRegistry.MozaDeviceType.Wheelbase));
        }

        // ═══════════════════════════════════════════════════════════════
        //  WHEELBASE — NEWER MOZA PREFIX (the fix)
        // ═══════════════════════════════════════════════════════════════

        [TestCase("MOZA R9 Base (COM3) USB Serial Device",
            TestName = "Wheelbase_Moza_R9_Base")]
        [TestCase("MOZA Racing R12 Ultra Base (COM5)",
            TestName = "Wheelbase_MozaRacing_R12_UltraBase")]
        [TestCase("MOZA R5 Racing Wheel and Pedals (COM4)",
            TestName = "Wheelbase_Moza_R5_RacingWheel")]
        [TestCase("MOZA Racing MOZA R21 Base (COM6)",
            TestName = "Wheelbase_MozaRacing_MozaR21_Base")]
        public void Wheelbase_MozaPrefix_Detected(string desc)
        {
            var result = Classify(desc);
            Assert.That(result, Is.Not.Null, $"Should detect: {desc}");
            Assert.That(result.Value.type, Is.EqualTo(MozaDeviceRegistry.MozaDeviceType.Wheelbase));
        }

        // ═══════════════════════════════════════════════════════════════
        //  PEDALS
        // ═══════════════════════════════════════════════════════════════

        [TestCase("Gudsen MOZA SRP Pedals (COM7)",
            TestName = "Pedals_Gudsen_SRP")]
        [TestCase("MOZA CRP2 Pedals (COM8)",
            TestName = "Pedals_Moza_CRP2")]
        [TestCase("MOZA SR-P Lite Pedals (COM9)",
            TestName = "Pedals_Moza_SRP_Lite")]
        [TestCase("MOZA FSR Pedals (COM10)",
            TestName = "Pedals_Moza_FSR")]
        [TestCase("MOZA Racing SRP2 Pedals (COM7)",
            TestName = "Pedals_MozaRacing_SRP2")]
        public void Pedals_Detected(string desc)
        {
            var result = Classify(desc);
            Assert.That(result, Is.Not.Null, $"Should detect: {desc}");
            Assert.That(result.Value.type, Is.EqualTo(MozaDeviceRegistry.MozaDeviceType.Pedals));
        }

        // ═══════════════════════════════════════════════════════════════
        //  SHIFTERS
        // ═══════════════════════════════════════════════════════════════

        [TestCase("HGP Shifter (COM11)", "HPattern",
            TestName = "Shifter_HGP_HPattern")]
        [TestCase("SGP Shifter (COM12)", "Sequential",
            TestName = "Shifter_SGP_Sequential")]
        public void Shifter_Detected_WithSubType(string desc, string expectedSubType)
        {
            var result = Classify(desc);
            Assert.That(result, Is.Not.Null, $"Should detect: {desc}");
            Assert.That(result.Value.type, Is.EqualTo(MozaDeviceRegistry.MozaDeviceType.Shifter));
            Assert.That(result.Value.subType, Is.EqualTo(expectedSubType));
        }

        [TestCase("MOZA Racing HGP Shifter (COM11)",
            TestName = "Shifter_MozaRacing_HGP")]
        public void Shifter_MozaBranded_Detected(string desc)
        {
            var result = Classify(desc);
            Assert.That(result, Is.Not.Null, $"Should detect: {desc}");
            Assert.That(result.Value.type, Is.EqualTo(MozaDeviceRegistry.MozaDeviceType.Shifter));
        }

        // ═══════════════════════════════════════════════════════════════
        //  HANDBRAKE
        // ═══════════════════════════════════════════════════════════════

        [TestCase("HBP Handbrake (COM13)",
            TestName = "Handbrake_HBP")]
        [TestCase("MOZA HBP Handbrake (COM13)",
            TestName = "Handbrake_Moza_HBP")]
        public void Handbrake_Detected(string desc)
        {
            var result = Classify(desc);
            Assert.That(result, Is.Not.Null, $"Should detect: {desc}");
            Assert.That(result.Value.type, Is.EqualTo(MozaDeviceRegistry.MozaDeviceType.Handbrake));
        }

        // ═══════════════════════════════════════════════════════════════
        //  UNIVERSAL HUB
        // ═══════════════════════════════════════════════════════════════

        [TestCase("Gudsen Universal Hub (COM14)",
            TestName = "UniversalHub_Gudsen")]
        [TestCase("MOZA Universal Hub (COM14)",
            TestName = "UniversalHub_Moza")]
        [TestCase("MOZA Racing Universal Hub (COM14)",
            TestName = "UniversalHub_MozaRacing")]
        public void UniversalHub_Detected(string desc)
        {
            var result = Classify(desc);
            Assert.That(result, Is.Not.Null, $"Should detect: {desc}");
            Assert.That(result.Value.type, Is.EqualTo(MozaDeviceRegistry.MozaDeviceType.UniversalHub));
        }

        // ═══════════════════════════════════════════════════════════════
        //  FALLBACK — UNKNOWN MOZA DEVICE
        // ═══════════════════════════════════════════════════════════════

        [TestCase("Gudsen Something New (COM15)",
            TestName = "Unknown_Gudsen_Unrecognized")]
        [TestCase("MOZA Completely New Product (COM16)",
            TestName = "Unknown_Moza_Unrecognized")]
        public void UnrecognizedMozaDevice_DetectedAsUnknown(string desc)
        {
            var result = Classify(desc);
            Assert.That(result, Is.Not.Null, $"Should detect as Unknown: {desc}");
            Assert.That(result.Value.type, Is.EqualTo(MozaDeviceRegistry.MozaDeviceType.Unknown));
        }

        // ═══════════════════════════════════════════════════════════════
        //  NON-MOZA DEVICES — SHOULD NOT MATCH
        // ═══════════════════════════════════════════════════════════════

        [TestCase("Fanatec CSL DD (COM20)",
            TestName = "NonMoza_Fanatec")]
        [TestCase("Thrustmaster T300RS (COM21)",
            TestName = "NonMoza_Thrustmaster")]
        [TestCase("",
            TestName = "NonMoza_EmptyString")]
        [TestCase("USB Serial Device (COM22)",
            TestName = "NonMoza_GenericSerial")]
        public void NonMozaDevice_ReturnsNull(string desc)
        {
            var result = Classify(desc);
            Assert.That(result, Is.Null, $"Should not detect: {desc}");
        }

        // ═══════════════════════════════════════════════════════════════
        //  CASE INSENSITIVITY
        // ═══════════════════════════════════════════════════════════════

        [TestCase("gudsen moza r9 base (COM3)",
            MozaDeviceRegistry.MozaDeviceType.Wheelbase, TestName = "CaseInsensitive_LowerCase")]
        [TestCase("GUDSEN MOZA R9 BASE (COM3)",
            MozaDeviceRegistry.MozaDeviceType.Wheelbase, TestName = "CaseInsensitive_UpperCase")]
        [TestCase("Moza Racing r12 ultra base (COM5)",
            MozaDeviceRegistry.MozaDeviceType.Wheelbase, TestName = "CaseInsensitive_MixedCase")]
        public void Patterns_AreCaseInsensitive(string desc, MozaDeviceRegistry.MozaDeviceType expectedType)
        {
            var result = Classify(desc);
            Assert.That(result, Is.Not.Null);
            Assert.That(result.Value.type, Is.EqualTo(expectedType));
        }

        // ═══════════════════════════════════════════════════════════════
        //  PRIORITY: SPECIFIC BEFORE FALLBACK
        // ═══════════════════════════════════════════════════════════════

        [Test]
        public void SpecificPatterns_MatchBeforeFallback()
        {
            // A wheelbase description should match as Wheelbase, not Unknown
            var result = Classify("MOZA R9 Base (COM3)");
            Assert.That(result, Is.Not.Null);
            Assert.That(result.Value.type, Is.Not.EqualTo(MozaDeviceRegistry.MozaDeviceType.Unknown),
                "Specific patterns should take priority over the generic fallback");
        }
    }
}
