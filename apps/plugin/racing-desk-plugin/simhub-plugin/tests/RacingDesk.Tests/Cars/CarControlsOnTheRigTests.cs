using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using RacingDesk.Core.Cars;
using RacingDesk.Plugin.Engine;
using RacingDesk.Plugin.IRacing;
using RacingDesk.Tests.IRacing;

namespace RacingDesk.Tests.Cars
{
    /// <summary>
    /// The same reading, fed from the rig's own recordings through the host's reader: that the car is named by
    /// its folder, that the session says whether its setup is fixed, and that a variable the car does not
    /// publish reads as not there. Skipped on a machine with no recording of the car. Nothing of the recording
    /// is kept, and nothing of a person is read from it.
    /// </summary>
    [TestFixture]
    public class CarControlsOnTheRigTests
    {
        /// <summary>The newest recording of a car, of a size that is quick to open; null when there is none.</summary>
        private static FileInfo Newest(string carPath)
        {
            if (!Directory.Exists(IbtFileTests.TelemetryDir)) return null;
            return new DirectoryInfo(IbtFileTests.TelemetryDir).EnumerateFiles(carPath + "_*.ibt")
                .Where(f => f.Length > 2_000_000 && f.LastWriteTimeUtc < DateTime.UtcNow.AddMinutes(-2))
                .OrderByDescending(f => f.LastWriteTimeUtc).FirstOrDefault();
        }

        /// <summary>The car's controls on the frame he is first in the car, by the fixture's list.</summary>
        private static (JObject Sent, List<string> Said, IbtFile File) Read(FileInfo recording, string carPath)
        {
            var file = new IbtFile(recording.FullName);
            var raw = new IbtRawTelemetry(file);
            var source = new IRacingTelemetrySource(raw);
            var said = new List<string>();
            var follower = new CarControlsFollower(CarList.Parse(CarListTests.Fixture), said.Add);

            string sent = null;
            int seen = 0;
            for (int i = 0; i < file.RecordCount && seen < 90; i += 2)
            {
                Assert.That(raw.Seek(i), Is.True);
                source.Update();
                bool? inCar = TelemetryCapture.InCar(source);
                if (inCar != true) continue;
                seen++;
                Assert.That(source.CarPath, Is.EqualTo(carPath), "the car is named by its folder");
                sent = follower.See(source.CarPath, source.GetPropertyValue, source.FixedSetup, inCar);
            }
            Assume.That(sent, Is.Not.Null, "he is never in the car in this recording");
            return (JObject.Parse(sent), said, file);
        }

        [Test]
        public void ACarWhoseDialIsAModeReadsAsItsMode()
        {
            var recording = Newest("mclaren570sgt4");
            Assume.That(recording, Is.Not.Null, "no recording of the car on this machine");
            var (sent, said, file) = Read(recording, "mclaren570sgt4");
            using (file)
            {
                Assert.That((string)sent["car"], Is.EqualTo("mclaren570sgt4"));
                Assert.That((bool)sent["fixedSetup"], Is.EqualTo(file.SessionInfo.WeekendInfo.WeekendOptions.IsFixedSetup == 1));
                Assert.That((string)sent["abs"]["state"], Is.EqualTo("mode"));
                Assert.That((string)sent["tc"]["state"], Is.EqualTo("mode"));
                Assert.That((string)sent["bb"]["state"], Is.EqualTo("none"));
                var mode = sent["more"].Single();
                Assert.That((string)mode["text"], Is.AnyOf("TRACK", "SPORT", "NORMAL"));
                Assert.That(said, Is.Empty, "the car publishes what the list says it does: " + string.Join(" | ", said));
            }
        }

        [Test]
        public void ACarWithNothingToTurnReadsAsNoneAndItsAbsAsOn()
        {
            var recording = Newest("mx5 mx52016");
            Assume.That(recording, Is.Not.Null, "no recording of the car on this machine");
            var (sent, said, file) = Read(recording, "mx5 mx52016");
            using (file)
            {
                Assert.That(((string)sent["abs"]["state"], (string)sent["tc"]["state"], (string)sent["bb"]["state"]), Is.EqualTo(("on", "none", "none")));
                Assert.That(sent["more"], Is.Null);
                Assert.That(said, Is.Empty, string.Join(" | ", said));
            }
        }

        [Test]
        public void AGtpCarsAbsDialReadsAsItsBrakeMigration()
        {
            var recording = Newest("porsche963gtp");
            Assume.That(recording, Is.Not.Null, "no recording of the car on this machine");
            var (sent, said, file) = Read(recording, "porsche963gtp");
            using (file)
            {
                Assert.That((string)sent["abs"]["state"], Is.EqualTo("none"));
                Assert.That((string)sent["tc"]["label"], Is.EqualTo("TCLO"));
                Assert.That((double)sent["bb"]["value"], Is.InRange(40, 60));
                var more = sent["more"].ToDictionary(m => (string)m["id"], m => m);
                Assert.That(more.Keys, Is.EquivalentTo(new[] { "brakeMigration", "tc2", "arbFront", "arbRear" }));
                Assert.That((double)more["brakeMigration"]["value"], Is.InRange(-6, 6));
                // The fixture leaves the car's brake target out, which is what the check is for.
                Assert.That(said, Is.EqualTo(new[] { "porsche963gtp the car publishes dcBrakeMisc, which the list gives to no control" }));
            }
        }
    }
}
