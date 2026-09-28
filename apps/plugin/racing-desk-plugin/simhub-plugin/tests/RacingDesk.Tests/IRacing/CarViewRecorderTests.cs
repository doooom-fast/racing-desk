using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using NUnit.Framework;
using RacingDesk.Data;

namespace RacingDesk.Tests.IRacing
{
    [TestFixture]
    public class CarViewRecorderTests
    {
        private string _documents;
        private List<CarView> _saved;
        private List<string> _log;
        private volatile bool _simRunning;

        [SetUp]
        public void SetUp()
        {
            _documents = Path.Combine(Path.GetTempPath(), "racing-desk-view-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(_documents);
            _saved = new List<CarView>();
            _log = new List<string>();
            _simRunning = false;
        }

        [TearDown]
        public void TearDown()
        {
            try { Directory.Delete(_documents, recursive: true); } catch (IOException) { }
        }

        private CarViewRecorder Recorder() =>
            new CarViewRecorder(_documents, () => _simRunning, v => { lock (_saved) _saved.Add(v); }, m => { lock (_log) _log.Add(m); })
            {
                Poll = TimeSpan.FromMilliseconds(10),
                ExitTimeout = TimeSpan.FromMilliseconds(400),
                WriteTimeout = TimeSpan.FromMilliseconds(100),
            };

        /// <summary>The sim's file, as it writes it on the way out. Each write is later than the last.</summary>
        private void AppIni(double height, double vanishY = 0, double headHorizon = 0, double fov = 69)
        {
            string path = Path.Combine(_documents, "app.ini");
            DateTime last = File.Exists(path) ? File.GetLastWriteTimeUtc(path) : DateTime.UtcNow.AddMinutes(-10);
            File.WriteAllText(path, FormattableString.Invariant(
                $"[Graphics]\r\nfoo=1\r\n\r\n[View]\r\nDriverHeadHorizon={headHorizon:0.000000}   \t; tilt\r\ndriverHeightAdj={height:0.000000}   \t; Range\r\ndrivingCamFOV={fov:0.000000}\r\nDrivingVanishY={vanishY:0.000000}\r\n"));
            File.SetLastWriteTimeUtc(path, last.AddSeconds(5));
        }

        private void CarCam(string folder, float x, float y, float z)
        {
            string dir = Path.Combine(_documents, "cameras", "cars", folder);
            Directory.CreateDirectory(dir);
            File.WriteAllBytes(Path.Combine(dir, "car.cam"), CarCamFileTests.CarCam(14, x, y, z));
        }

        [Test]
        public void RecordsWhatTheDriverLeftTheCarWith()
        {
            AppIni(height: -0.06);
            CarCam(Path.Combine("mx5", "mx52016"), -0.13f, 0f, 0.02f);
            var recorder = Recorder();

            _simRunning = true;
            recorder.SeeCar("mx5 mx52016");
            AppIni(height: -0.02, vanishY: 0.1);
            _simRunning = false;
            recorder.SimGone().Wait();

            Assert.That(_saved, Has.Count.EqualTo(1));
            var view = _saved[0];
            Assert.That(view.CarPath, Is.EqualTo("mx5 mx52016"));
            Assert.That(view.DriverHeight, Is.EqualTo(-0.02).Within(1e-9));
            Assert.That(view.VanishY, Is.EqualTo(0.1).Within(1e-9));
            Assert.That(view.HeadHorizon, Is.EqualTo(0));
            Assert.That(view.Fov, Is.EqualTo(69));
            Assert.That(view.SeatX, Is.EqualTo(-0.13).Within(1e-6));
            Assert.That(view.SeatZ, Is.EqualTo(0.02).Within(1e-6));
            Assert.That(view.Chosen, Is.True);
            Assert.That(view.SeenAtUtc, Is.EqualTo(DateTime.UtcNow).Within(TimeSpan.FromSeconds(30)));
            Assert.That(_log.Single(), Does.Contain("mx5 mx52016").And.Contain("changed in this car"));
        }

        [Test]
        public void AViewNobodyTouchedIsRecordedAsInherited()
        {
            AppIni(height: -0.06);
            var recorder = Recorder();

            recorder.SeeCar("lotus79");
            AppIni(height: -0.06, fov: 75); // the sim rewrote the file; only the field of view moved
            recorder.SimGone().Wait();

            Assert.That(_saved.Single().Chosen, Is.False);
            Assert.That(_saved.Single().DriverHeight, Is.EqualTo(-0.06).Within(1e-9));
            Assert.That(_saved.Single().SeatX, Is.Null, "no car.cam for this car");
        }

        [Test]
        public void WaitsForTheSimToGoAndWriteItsFile()
        {
            AppIni(height: -0.06);
            var recorder = Recorder();
            // Neither limit is reached: each wait ends as soon as what it waits for has happened.
            recorder.ExitTimeout = recorder.WriteTimeout = TimeSpan.FromSeconds(20);
            _simRunning = true;
            recorder.SeeCar("lotus79");

            var done = recorder.SimGone();
            Thread.Sleep(60);
            Assert.That(_saved, Is.Empty, "the sim is still up");
            _simRunning = false;
            Thread.Sleep(30);
            AppIni(height: 0.01);
            done.Wait();

            Assert.That(_saved.Single().DriverHeight, Is.EqualTo(0.01).Within(1e-9));
            Assert.That(_saved.Single().Chosen, Is.True);
        }

        [Test]
        public void RecordsNothingWhileTheSimStaysUp()
        {
            AppIni(height: -0.06);
            var recorder = Recorder();
            _simRunning = true;
            recorder.SeeCar("lotus79");

            recorder.SimGone().Wait();

            Assert.That(_saved, Is.Empty);
            Assert.That(_log.Single(), Does.Contain("still running"));
        }

        [Test]
        public void FramesAgainMeanTheSimHadNotGone()
        {
            AppIni(height: -0.06);
            var recorder = Recorder();
            _simRunning = true;
            recorder.SeeCar("lotus79");

            var done = recorder.SimGone();
            recorder.SeeCar("lotus79");
            done.Wait();
            Assert.That(_saved, Is.Empty);
            Assert.That(_log, Is.Empty);

            // And the run is still the one that began at -0.06.
            AppIni(height: 0.03);
            _simRunning = false;
            recorder.SimGone().Wait();
            Assert.That(_saved.Single().Chosen, Is.True);
        }

        [Test]
        public void TheNextRunStartsFromWhatThisOneLeft()
        {
            AppIni(height: -0.06);
            var recorder = Recorder();

            recorder.SeeCar("lotus79");
            AppIni(height: 0.02);
            recorder.SimGone().Wait();

            recorder.SeeCar("mx5 mx52016");
            AppIni(height: 0.02);
            recorder.SimGone().Wait();

            Assert.That(_saved.Select(v => v.CarPath), Is.EqualTo(new[] { "lotus79", "mx5 mx52016" }));
            Assert.That(_saved[0].Chosen, Is.True);
            Assert.That(_saved[1].Chosen, Is.False, "0.02 was the Lotus's; the MX-5 only inherited it");
            Assert.That(_saved[1].DriverHeight, Is.EqualTo(0.02).Within(1e-9));
        }

        [Test]
        public void NoCarOrNoFileIsNothingToRecord()
        {
            var recorder = Recorder();

            recorder.SimGone().Wait();
            recorder.SeeCar("  ");
            recorder.SimGone().Wait();
            recorder.SeeCar("lotus79"); // no app.ini at all
            recorder.SimGone().Wait();

            Assert.That(_saved, Is.Empty);
        }

        [Test]
        public void ACarsCameraFileIsAFolderDeeperForEachSpaceInItsName()
        {
            string cars = Path.Combine(_documents, "cameras", "cars");

            Assert.That(CarViewRecorder.CarCamPath(_documents, "lotus79"), Is.EqualTo(Path.Combine(cars, "lotus79", "car.cam")));
            Assert.That(CarViewRecorder.CarCamPath(_documents, " mx5  mx52016 "), Is.EqualTo(Path.Combine(cars, "mx5", "mx52016", "car.cam")));
            Assert.That(CarViewRecorder.CarCamPath(_documents, ".. .. secrets"), Is.Null);
            Assert.That(CarViewRecorder.CarCamPath(_documents, @"..\..\secrets"), Is.Null);
            Assert.That(CarViewRecorder.CarCamPath(_documents, "c:thing"), Is.Null);
            Assert.That(CarViewRecorder.CarCamPath(_documents, ""), Is.Null);
        }
    }
}
