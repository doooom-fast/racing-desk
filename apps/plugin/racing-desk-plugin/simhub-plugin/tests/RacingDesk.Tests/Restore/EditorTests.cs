using System;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using NUnit.Framework;
using RacingDesk.Data.Pedals;
using RacingDesk.Plugin.IRacing;

namespace RacingDesk.Tests.Restore
{
    /// <summary>
    /// The three pure editors putting the height and brakes back is built on (docs/view-and-pedals-plan.md): a camera file's
    /// cockpit Z (and vertical shift), one value of app.ini, and a SmartControl profile's three spans with its hash. Each
    /// changes what it is asked to and not a byte more, and refuses anything laid out another way than the rig's files.
    /// </summary>
    [TestFixture]
    public class CarCamEditTests
    {
        private static int Changed(byte[] a, byte[] b) => a.Where((x, i) => x != b[i]).Count();

        [TestCase(14)]
        [TestCase(15)]
        public void TheCockpitZ_IsTheOnlyFourBytesThatChange(int version)
        {
            var file = RestoreRig.CarCam(version, -0.11f, 0f, -0.04f, 0.01f);
            Assert.That(file.Length, Is.EqualTo(CarCamFile.KnownLength).And.EqualTo(1668));

            Assert.That(CarCamFile.TryWriteCockpitZ(file, -0.03f, out var edited, out string why), Is.True, why);
            Assert.That(edited.Length, Is.EqualTo(file.Length));
            Assert.That(CarCamFile.TryReadCockpit(edited, out var seat), Is.True);
            Assert.That((seat.X, seat.Z), Is.EqualTo((-0.11f, -0.03f)), "the seat's fore and aft is his, and stays");
            Assert.That(BitConverter.ToSingle(edited, 12 + 8 * 184 + 60), Is.EqualTo(-0.03f), "at +60 of the last record, the cockpit's");
            Assert.That(Changed(file, edited), Is.LessThanOrEqualTo(4));
            for (int i = 0; i < file.Length; i++)
                if (i < 12 + 8 * 184 + 60 || i >= 12 + 8 * 184 + 64) Assert.That(edited[i], Is.EqualTo(file[i]), $"byte {i}");
            Assert.That(file, Is.EqualTo(RestoreRig.CarCam(version, -0.11f, 0f, -0.04f, 0.01f)), "the file handed in is not touched: the edit is a copy");
        }

        [Test]
        public void TheVerticalShift_IsItsOwnFourBytes()
        {
            var file = RestoreRig.CarCam(14, -0.09f, 0f, -0.04f, 0.01f);
            Assert.That(CarCamFile.TryWriteCockpitVerticalShift(file, 0.03f, out var edited, out _), Is.True);
            Assert.That(CarCamFile.TryReadCockpitVerticalShift(edited, out float shift), Is.True);
            Assert.That(shift, Is.EqualTo(0.03f));
            Assert.That(CarCamFile.TryReadCockpit(edited, out var seat) && seat.Z == -0.04f, Is.True, "the height is not the horizon");
            Assert.That(Changed(file, edited), Is.LessThanOrEqualTo(4));
        }

        [Test]
        public void AFileLaidOutAnotherWay_IsRefused_WithWhy()
        {
            var good = RestoreRig.CarCam(14, 0f, 0f, 0f);
            var newer = RestoreRig.CarCam(16, 0f, 0f, 0f);
            var eight = RestoreRig.CarCam(14, 0f, 0f, 0f, 0f, new[] { "CamNose", "CamGearbox", "CamRoll Bar", "CamLF Susp", "CamLR Susp", "CamGyro", "CamRF Susp", "CamCockpit" });
            var twoCockpits = RestoreRig.CarCam(14, 0f, 0f, 0f, 0f, new[] { "CamNose", "CamGearbox", "CamRoll Bar", "CamLF Susp", "CamCockpit", "CamGyro", "CamRF Susp", "CamRR Susp", "CamCockpit" });
            var noCockpit = RestoreRig.CarCam(14, 0f, 0f, 0f, 0f, new[] { "CamNose", "CamGearbox", "CamRoll Bar", "CamLF Susp", "CamLR Susp", "CamGyro", "CamRF Susp", "CamRR Susp", "CamTV" });
            var magic = (byte[])good.Clone();
            magic[0] = (byte)'X';
            foreach (var (file, name) in new[] { (newer, "version 16"), (eight, "eight cameras"), (twoCockpits, "two cockpits"), (noCockpit, "no cockpit"), (magic, "not MACC"), (new byte[12], "a header alone"), (null, "nothing") })
            {
                Assert.That(CarCamFile.TryWriteCockpitZ(file, -0.01f, out var edited, out string why), Is.False, name);
                Assert.That(edited, Is.Null, name);
                Assert.That(why, Is.Not.Empty, name);
            }
            Assert.That(CarCamFile.TryWriteCockpitZ(good, float.NaN, out _, out _), Is.False, "not a number");
            Assert.That(CarCamFile.TryWriteCockpitZ(good, 12f, out _, out _), Is.False, "metres are not an offset");
            // Eight cameras still read, as before: only writing is held to the rig's exact layout.
            Assert.That(CarCamFile.TryReadCockpit(eight, out _), Is.True);
        }
    }

    [TestFixture]
    public class AppIniEditorTests
    {
        private static byte[] Ini(double height) => Encoding.ASCII.GetBytes(RestoreRig.AppIniText(height));

        [Test]
        public void OneValueChanges_InTheWidthItHad_AndEveryOtherByteIsAsItWas()
        {
            var before = Ini(-0.035);
            Assert.That(AppIniEditor.TrySetValue(before, "View", "driverHeightAdj", -0.02, out var after, out string why), Is.True, why);
            Assert.That(after.Length, Is.EqualTo(before.Length));
            string text = Encoding.ASCII.GetString(after);
            var line = text.Split("\r\n").Single(l => l.StartsWith("driverHeightAdj="));
            Assert.That(line, Is.EqualTo("driverHeightAdj=-0.020000".PadRight(40) + "\t; Range -0.050m to 0.050m  (approx. +/- 2 in.)"),
                "six decimals, padded to the column the sim pads to, the tab and the comment where they were");
            Assert.That(text.Replace(line, ""), Is.EqualTo(Encoding.ASCII.GetString(before).Replace(Encoding.ASCII.GetString(before).Split("\r\n").Single(l => l.StartsWith("driverHeightAdj=")), "")));
            Assert.That(AppIniEditor.TryReadValue(after, "View", "driverHeightAdj", out double read) && read == -0.02, Is.True);
            Assert.That(AppIniEditor.TryReadValue(after, "View", "drivingCamFOV", out double fov) && fov == 70, Is.True, "the FOV is never touched");
        }

        [Test]
        public void AKeyNotThereOrThereTwice_OrANumberTooWide_IsRefused()
        {
            Assert.That(AppIniEditor.TrySetValue(Ini(0), "View", "noSuchKey", 0.01, out _, out string why), Is.False);
            Assert.That(why, Does.Contain("not in [View]"));
            Assert.That(AppIniEditor.TrySetValue(Ini(0), "Graphics", "driverHeightAdj", 0.01, out _, out _), Is.False, "another section's is not this one");

            var twice = Encoding.ASCII.GetBytes(RestoreRig.AppIniText(0) + "\r\n[View]\r\ndriverHeightAdj=0.010000\t; again\r\n");
            Assert.That(AppIniEditor.TrySetValue(twice, "View", "driverHeightAdj", 0.01, out _, out why), Is.False);
            Assert.That(why, Does.Contain("2 times"));

            var narrow = Encoding.ASCII.GetBytes("[View]\r\ndriverHeightAdj=0.0\t; tight\r\n");
            Assert.That(AppIniEditor.TrySetValue(narrow, "View", "driverHeightAdj", -0.02, out _, out why), Is.False, "the comment is not moved");
            Assert.That(why, Does.Contain("wider"));
            Assert.That(AppIniEditor.TrySetValue(Ini(0), "View", "driverHeightAdj", double.NaN, out _, out _), Is.False);
        }

        [Test]
        public void NumbersAreWrittenAsTheSimWritesThem()
        {
            Assert.That(AppIniEditor.Format(-0.02), Is.EqualTo("-0.020000"));
            Assert.That(AppIniEditor.Format(0.0000001), Is.EqualTo("0.000000"), "no -0");
            Assert.That(AppIniEditor.Format(-0.0000001), Is.EqualTo("0.000000"));
            Assert.That(AppIniEditor.Format(0.19), Is.EqualTo("0.190000"));
        }
    }

    [TestFixture]
    public class SmartControlProfileEditorTests
    {
        private static byte[] Utf8(string s) => Encoding.UTF8.GetBytes(s);

        [Test]
        public void TheHash_IsSha512OfTheValuesInTheRulesOrder()
        {
            var section = XDocument.Parse(RestoreRig.NewFormatProfile(80, 5, nilDescription: true)).Root.Elements().First(e => e.Name.LocalName == "SimPedalsUltimate");
            // Throttle: bottom, top, the six points; brake: bottom, the six points, the force; clutch like the throttle.
            Assert.That(SmartControlHash.Of(section), Is.EqualTo(RestoreRig.Hash("55020406080100" + "5020406080100" + "80" + "55020406080100")));
            Assert.That(SmartControlProfileEditor.HashHolds(Utf8(RestoreRig.NewFormatProfile(80, 5, true))), Is.True);
            Assert.That(SmartControlProfileEditor.HashHolds(Utf8(RestoreRig.OldFormatProfile(45, 4))), Is.False, "LightBrake ships with a hash of other values");
        }

        [Test]
        public void ADefaultBasedProfile_ChangesTheForce_TheHash_AndTheDescription_AndNothingElse()
        {
            string baseText = RestoreRig.NewFormatProfile(80, 5, nilDescription: true);
            Assert.That(SmartControlProfileEditor.TryEdit(Utf8(baseText), 70, "Made by Racing Desk for Porsche 963 GTP from Default", out var edited, out string why), Is.True, why);
            string text = Encoding.UTF8.GetString(edited);

            Assert.That(SmartControlProfileEditor.TryReadForce(edited, out double kg) && kg == 70, Is.True);
            Assert.That(SmartControlProfileEditor.HashHolds(edited), Is.True, "the hash is the rule's for the new force");
            Assert.That(text, Does.StartWith("<?xml version=\"1.0\" encoding=\"utf-16\"?>\r\n"), "the odd first line, as SmartControl wrote it");
            Assert.That(text, Does.Contain("<Description>Made by Racing Desk for Porsche 963 GTP from Default</Description>"));
            Assert.That(text, Does.Not.Contain("xsi:nil"));
            // The Sprint section, and its hash, are as they were.
            string Sprint(string s) => Regex.Match(s, "<SimPedalsSprint>.*?</SimPedalsSprint>", RegexOptions.Singleline).Value;
            Assert.That(Sprint(text), Is.EqualTo(Sprint(baseText)));
            // Everything outside the three spans is the base's, to the character.
            string Blank(string s) => Regex.Replace(Regex.Replace(Regex.Replace(s, "<Description[^>]*(/>|>[^<]*</Description>)", "<D/>"),
                "(<SimPedalsUltimate>\\s*<Hash>)[^<]*", "$1"), "(<SimPedalsUltimate>.*?<BrakeProfile>.*?<MaximumCalibratedForceInKilogram>)[^<]*", "$1", RegexOptions.Singleline);
            Assert.That(Blank(text), Is.EqualTo(Blank(baseText)));
        }

        [Test]
        public void ALightBrakeBasedProfile_HasNoDescriptionAdded_AndKeepsItsOlderFormat()
        {
            string baseText = RestoreRig.OldFormatProfile(45, 4);
            Assert.That(SmartControlProfileEditor.TryEdit(Utf8(baseText), 30, "Made by Racing Desk for McLaren 720S GT3 EVO", out var edited, out string why), Is.True, why);
            string text = Encoding.UTF8.GetString(edited);
            Assert.That(text, Does.Not.Contain("Description"), "LightBrake has none, and none is added: Racing Desk's rows are known by their id");
            Assert.That(text, Does.Contain("<Major>1</Major>"));
            Assert.That(SmartControlProfileEditor.TryReadForce(edited, out double kg) && kg == 30, Is.True);
            Assert.That(SmartControlProfileEditor.HashHolds(edited), Is.True, "the Ultimate hash is made right");
            Assert.That(text.Length, Is.EqualTo(baseText.Length - 2 + 2), "45 → 30: the same width; only the force and the hash moved");
        }

        [Test]
        public void ABomIsKept_AndWhatIsNotAProfileItCanEdit_IsRefused()
        {
            var bom = new byte[] { 0xEF, 0xBB, 0xBF }.Concat(Utf8(RestoreRig.NewFormatProfile(80, 5, true))).ToArray();
            Assert.That(SmartControlProfileEditor.TryEdit(bom, 65, null, out var edited, out _), Is.True);
            Assert.That(edited.Take(3), Is.EqualTo(new byte[] { 0xEF, 0xBB, 0xBF }));

            Assert.That(SmartControlProfileEditor.TryEdit(Utf8(RestoreRig.NewFormatProfile(80, 5, true)), 14, null, out _, out string why), Is.False);
            Assert.That(why, Does.Contain("15"));
            Assert.That(SmartControlProfileEditor.TryEdit(Utf8(RestoreRig.NewFormatProfile(80, 5, true)), 101, null, out _, out _), Is.False);
            Assert.That(SmartControlProfileEditor.TryEdit(Utf8("<Profile><SimPedalsSprint/></Profile>"), 50, null, out _, out why), Is.False);
            Assert.That(why, Does.Contain("no SimPedalsUltimate"));
            Assert.That(SmartControlProfileEditor.TryEdit(new byte[] { 0xC3, 0x28, 0x41 }, 50, null, out _, out why), Is.False);
            Assert.That(SmartControlProfileEditor.TryEdit(Encoding.Unicode.GetBytes(RestoreRig.NewFormatProfile(80, 5, true)), 50, null, out _, out _), Is.False, "a profile that really is UTF-16 is not one SmartControl writes");
        }

        [Test]
        public void AName_IsTheCarsUnlessOneOfHisHasIt()
        {
            Assert.That(SmartControlProfileEditor.UniqueName("Porsche 963 GTP", new[] { "Default", "LightBrake" }), Is.EqualTo("Porsche 963 GTP"));
            Assert.That(SmartControlProfileEditor.UniqueName("F1", new[] { "Default", "f1" }), Is.EqualTo("F1 (Racing Desk)"));
            Assert.That(SmartControlProfileEditor.UniqueName("F1", new[] { "F1", "F1 (Racing Desk)" }), Is.EqualTo("F1 (Racing Desk 2)"));
        }
    }
}
