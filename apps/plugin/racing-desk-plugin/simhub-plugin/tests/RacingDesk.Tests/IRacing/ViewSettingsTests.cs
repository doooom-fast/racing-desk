using System;
using System.Text;
using NUnit.Framework;
using RacingDesk.Plugin.IRacing;

namespace RacingDesk.Tests.IRacing
{
    [TestFixture]
    public class ViewSettingsTests
    {
        // The shape of the sim's own file: padded values, a tab, a comment.
        private const string AppIni =
            "[Graphics]\r\n" +
            "drivingCamFOV=120.000000                	; not this one\r\n" +
            "\r\n" +
            "[View]\r\n" +
            "cockpitLookAngle=65.000000              	; Angle in degrees to rotate head when looking left/right\r\n" +
            "DriverHeadHorizon=0.250000              	; Percent to allow the drivers head to stay level with the horizon when the car tilts.\r\n" +
            "driverHeightAdj=-0.060000               	; Range -0.050m to 0.050m  (approx. +/- 2 in.)\r\n" +
            "drivingCamFOV=69.000000                 	; driving camera field of view\r\n" +
            "DrivingVanishY=0.125000                 	; Shift the driving view up/down to make it easier to see the dash.\r\n" +
            "\r\n" +
            "[Replay]\r\n" +
            "driverHeightAdj=0.500000\r\n";

        [Test]
        public void ReadsTheFourFromTheViewSectionAndNoOther()
        {
            var view = ViewSettings.Parse(AppIni);

            Assert.That(view.DriverHeight, Is.EqualTo(-0.06).Within(1e-9));
            Assert.That(view.VanishY, Is.EqualTo(0.125).Within(1e-9));
            Assert.That(view.HeadHorizon, Is.EqualTo(0.25).Within(1e-9));
            Assert.That(view.Fov, Is.EqualTo(69.0).Within(1e-9));
            Assert.That(view.IsEmpty, Is.False);
        }

        [Test]
        public void AValueThatIsMissingOrNotANumberIsNull()
        {
            var view = ViewSettings.Parse("[View]\ndriverHeightAdj=tall ; no\nDrivingVanishY=\ndrivingCamFOV=NaN\n");

            Assert.That(view.DriverHeight, Is.Null);
            Assert.That(view.VanishY, Is.Null);
            Assert.That(view.Fov, Is.Null);
            Assert.That(view.HeadHorizon, Is.Null);
            Assert.That(view.IsEmpty, Is.True);
        }

        [Test]
        public void KeysAndTheSectionNameAreReadWhateverTheirCase()
        {
            var view = ViewSettings.Parse("[VIEW]\nDRIVERHEIGHTADJ = 0.02\ndrivingvanishy=-0.5;x\n");

            Assert.That(view.DriverHeight, Is.EqualTo(0.02).Within(1e-9));
            Assert.That(view.VanishY, Is.EqualTo(-0.5).Within(1e-9));
        }

        [Test]
        public void NothingToReadIsAnEmptyView()
        {
            Assert.That(ViewSettings.Parse(null).IsEmpty, Is.True);
            Assert.That(ViewSettings.Parse("").IsEmpty, Is.True);
            Assert.That(ViewSettings.Parse("driverHeightAdj=0.01\n").IsEmpty, Is.True, "outside any section");
        }
    }

    [TestFixture]
    public class CarCamFileTests
    {
        private static readonly string[] Cameras =
        {
            "CamNose", "CamGearbox", "CamRoll Bar", "CamLF Susp", "CamLR Susp",
            "CamGyro", "CamRF Susp", "CamRR Susp", "CamCockpit",
        };

        /// <summary>A file laid out as the rig's are: a 12-byte header, then 184 bytes a camera.</summary>
        internal static byte[] CarCam(int version, float x, float y, float z, string[] cameras = null)
        {
            cameras = cameras ?? Cameras;
            var file = new byte[12 + cameras.Length * 184];
            Encoding.ASCII.GetBytes("MACC").CopyTo(file, 0);
            BitConverter.GetBytes(version).CopyTo(file, 4);
            BitConverter.GetBytes(cameras.Length * 184).CopyTo(file, 8);
            for (int i = 0; i < cameras.Length; i++)
            {
                int at = 12 + i * 184;
                Encoding.ASCII.GetBytes(cameras[i]).CopyTo(file, at);
                // Every camera has an offset; only the cockpit's is the seat.
                bool cockpit = cameras[i] == "CamCockpit";
                BitConverter.GetBytes(cockpit ? x : 1.5f).CopyTo(file, at + 52);
                BitConverter.GetBytes(cockpit ? y : 1.5f).CopyTo(file, at + 56);
                BitConverter.GetBytes(cockpit ? z : 1.5f).CopyTo(file, at + 60);
            }
            return file;
        }

        [TestCase(14)]
        [TestCase(15)]
        public void ReadsTheCockpitCamerasOffset(int version)
        {
            Assert.That(CarCamFile.TryReadCockpit(CarCam(version, -0.13f, 0.01f, 0.025f), out var offset), Is.True);

            Assert.That(offset.X, Is.EqualTo(-0.13f));
            Assert.That(offset.Y, Is.EqualTo(0.01f));
            Assert.That(offset.Z, Is.EqualTo(0.025f));
            Assert.That(offset.IsZero, Is.False);
        }

        [Test]
        public void AnUntouchedSeatIsZero()
        {
            Assert.That(CarCamFile.TryReadCockpit(CarCam(14, 0f, 0f, 0f), out var offset), Is.True);
            Assert.That(offset.IsZero, Is.True);
        }

        [Test]
        public void ReadsNothingFromAFileLaidOutAnotherWay()
        {
            var good = CarCam(14, -0.13f, 0f, 0f);

            var otherMagic = (byte[])good.Clone();
            otherMagic[0] = (byte)'X';
            var newer = CarCam(16, -0.13f, 0f, 0f);
            var cut = new byte[good.Length - 40];
            Array.Copy(good, cut, cut.Length);
            var longer = new byte[good.Length + 4];
            Array.Copy(good, longer, good.Length);
            var noCockpit = CarCam(14, 0f, 0f, 0f, new[] { "CamNose", "CamGearbox" });
            var metres = CarCam(14, 12f, 0f, 0f);
            var notANumber = CarCam(14, float.NaN, 0f, 0f);

            foreach (var file in new[] { null, new byte[0], new byte[11], otherMagic, newer, cut, longer, noCockpit, metres, notANumber })
            {
                Assert.That(CarCamFile.TryReadCockpit(file, out var offset), Is.False);
                Assert.That(offset, Is.Null);
            }
        }
    }
}
