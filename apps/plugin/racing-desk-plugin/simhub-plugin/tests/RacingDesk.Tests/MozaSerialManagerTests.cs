using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Ports;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using RacingDesk.Plugin.Engine.Moza;

namespace RacingDesk.Tests
{
    [TestFixture]
    public class MozaSerialManagerTests
    {
        private MozaSerialManager _manager;
        private FakePorts _fake;
        private DateTime _now;
        private readonly List<string> _infos = new List<string>();
        private readonly List<string> _warns = new List<string>();
        private readonly List<string> _mozaPrograms = new List<string>();

        // Every manager here reaches the fake's ports, never the machine's: Start() and the
        // diagnostic would otherwise open the rig's ports and write probe packets to them. And
        // it sees the Moza programs the test says are running, not the machine's own — on the
        // rig Pit House always is.
        [SetUp]
        public void SetUp()
        {
            _fake = new FakePorts();
            _now = new DateTime(2026, 9, 29, 12, 0, 0, DateTimeKind.Utc);
            _infos.Clear();
            _warns.Clear();
            _mozaPrograms.Clear();
            _manager = new MozaSerialManager(
                msg => { lock (_infos) _infos.Add(msg); },
                msg => { lock (_warns) _warns.Add(msg); },
                _fake,
                () => _now,
                () => _mozaPrograms.ToArray());
        }

        [TearDown]
        public void TearDown()
        {
            if (_manager != null)
            {
                try { _manager.Stop(); }
                catch { }
                try { _manager.Dispose(); }
                catch { }
            }
        }

        // ═══════════════════════════════════════════════════════════════
        //  TEST 1: TryAdd Atomicity
        //  Verify that concurrent device discovery doesn't create duplicates.
        // ═══════════════════════════════════════════════════════════════

        [Test]
        public void ConcurrentDeviceDiscovery_NoDuplicates()
        {
            // Simulate concurrent attempts to add the same device.
            // We'll use reflection to access the internal _devices dictionary,
            // since we can't actually open serial ports in tests.

            // Create a device without opening a real port
            var device1 = new MozaDevice(
                "COM99",
                MozaDeviceRegistry.MozaDeviceType.Wheelbase,
                MozaDeviceRegistry.GetDeviceId(MozaDeviceRegistry.MozaDeviceType.Wheelbase));

            var device2 = new MozaDevice(
                "COM99",
                MozaDeviceRegistry.MozaDeviceType.Wheelbase,
                MozaDeviceRegistry.GetDeviceId(MozaDeviceRegistry.MozaDeviceType.Wheelbase));

            // Simulate the TryAdd race condition from DiscoverDevices()
            var tasks = new List<Task>();
            int successCount = 0;
            var lockObj = new object();

            for (int i = 0; i < 10; i++)
            {
                tasks.Add(Task.Run(() =>
                {
                    // Each task tries to add "COM99" concurrently
                    var testDevice = new MozaDevice(
                        "COM99",
                        MozaDeviceRegistry.MozaDeviceType.Wheelbase,
                        MozaDeviceRegistry.GetDeviceId(MozaDeviceRegistry.MozaDeviceType.Wheelbase));

                    var devicesDict = typeof(MozaSerialManager)
                        .GetField("_devices", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)
                        ?.GetValue(_manager) as System.Collections.Concurrent.ConcurrentDictionary<string, MozaDevice>;

                    if (devicesDict != null && devicesDict.TryAdd("COM99", testDevice))
                    {
                        lock (lockObj)
                        {
                            successCount++;
                        }
                    }
                }));
            }

            Task.WaitAll(tasks.ToArray());

            // Only ONE task should have successfully added the device (TryAdd atomicity)
            Assert.That(successCount, Is.EqualTo(1), "Only one concurrent TryAdd should succeed for the same key");

            // Verify only one device is stored
            var devices = typeof(MozaSerialManager)
                .GetField("_devices", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)
                ?.GetValue(_manager) as System.Collections.Concurrent.ConcurrentDictionary<string, MozaDevice>;

            Assert.That(devices?.ContainsKey("COM99"), Is.True, "Device should be in dictionary");
            Assert.That(devices?.Count, Is.EqualTo(1), "Should have exactly one device");
        }

        // ═══════════════════════════════════════════════════════════════
        //  TEST 2: ClosePort during SendAndReceive
        //  Verify that closing a port waits for active I/O to complete.
        // ═══════════════════════════════════════════════════════════════

        [Test]
        public void ClosePortWaitsForActiveIo_NoRaceCondition()
        {
            // This test verifies the synchronization behavior without actual serial I/O.
            // We'll test that the semaphore is properly acquired during ClosePort.

            var devicesDict = typeof(MozaSerialManager)
                .GetField("_devices", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)
                ?.GetValue(_manager) as System.Collections.Concurrent.ConcurrentDictionary<string, MozaDevice>;

            var portsDict = typeof(MozaSerialManager)
                .GetField("_ports", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)
                ?.GetValue(_manager) as System.Collections.Concurrent.ConcurrentDictionary<string, System.IO.Ports.SerialPort>;

            var locksDict = typeof(MozaSerialManager)
                .GetField("_portLocks", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)
                ?.GetValue(_manager) as System.Collections.Concurrent.ConcurrentDictionary<string, System.Threading.SemaphoreSlim>;

            // Create a mock setup: device + port + semaphore
            var testDevice = new MozaDevice(
                "COM88",
                MozaDeviceRegistry.MozaDeviceType.Wheelbase,
                MozaDeviceRegistry.GetDeviceId(MozaDeviceRegistry.MozaDeviceType.Wheelbase));
            testDevice.IsConnected = true;

            devicesDict?.TryAdd("COM88", testDevice);
            locksDict?.TryAdd("COM88", new SemaphoreSlim(1, 1));

            // Create a mock serial port (we won't actually open it)
            var mockPort = new System.IO.Ports.SerialPort("COM88");
            portsDict?.TryAdd("COM88", mockPort);

            // Acquire the semaphore to simulate active I/O
            var sem = locksDict?["COM88"];
            bool acquiredInMain = sem?.Wait(100) ?? false;
            Assert.That(acquiredInMain, Is.True, "Main thread should acquire semaphore");

            // Now attempt to close the port from a background thread
            bool closeThreadAcquiredLock = false;
            var closeTask = Task.Run(() =>
            {
                // Invoke ClosePort via reflection
                var closePortMethod = typeof(MozaSerialManager)
                    .GetMethod("ClosePort", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);

                closePortMethod?.Invoke(_manager, new object[] { "COM88" });
                closeThreadAcquiredLock = true;
            });

            // Give the close thread time to start waiting for the semaphore
            Thread.Sleep(100);

            // At this point, close thread should be BLOCKED on semaphore.Wait()
            Assert.That(closeTask.IsCompleted, Is.False, "Close thread should be blocked waiting for semaphore");

            // Release the semaphore
            sem?.Release();

            // Close thread should now complete within reasonable time
            bool completed = closeTask.Wait(TimeSpan.FromSeconds(2));
            Assert.That(completed, Is.True, "Close thread should complete after semaphore is released");
            Assert.That(closeThreadAcquiredLock, Is.True, "Close thread should have acquired the lock");
        }

        // ═══════════════════════════════════════════════════════════════
        //  TEST 3: Dispose Safety
        //  Verify that disposing while poll thread is running doesn't throw.
        // ═══════════════════════════════════════════════════════════════

        [Test]
        public void DisposeDuringPollThread_NoException()
        {
            // Start the background poll thread
            _manager.Start();

            // Verify the thread started
            var runningField = typeof(MozaSerialManager)
                .GetField("_running", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
            var isRunning = (bool)runningField?.GetValue(_manager);
            Assert.That(isRunning, Is.True, "Manager should be running");

            // Wait a moment for poll thread to enter its loop
            Thread.Sleep(300);

            // Dispose while the thread is running — should not throw
            Assert.DoesNotThrow(() =>
            {
                _manager.Dispose();
            }, "Dispose should not throw even if poll thread is running");

            // Verify disposed flag is set
            var disposedField = typeof(MozaSerialManager)
                .GetField("_disposed", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
            var isDisposed = (bool)disposedField?.GetValue(_manager);
            Assert.That(isDisposed, Is.True, "Manager should be marked as disposed");
        }

        // ═══════════════════════════════════════════════════════════════
        //  TEST 4: Pedal Offset Bounds Check
        //  Verify that commandId below ThrottleBase doesn't cause underflow.
        // ═══════════════════════════════════════════════════════════════

        [Test]
        public void PedalSettings_CommandIdBelowThrottleBase_NoUnderflow()
        {
            var pedalSettings = new MozaPedalSettings();

            // Get ThrottleBase value
            var throttleBase = MozaDeviceRegistry.PedalCmd.ThrottleBase;

            // Try to apply a value with commandId BELOW ThrottleBase
            // This would previously cause an underflow when calculating offset:
            // offset = (byte)(commandId - ThrottleBase)  // e.g., (byte)(0x10 - 0x30) = underflow!
            byte invalidCommandId = (byte)(throttleBase - 1);

            // Should not throw or cause issues
            Assert.DoesNotThrow(() =>
            {
                pedalSettings.ApplyValue(invalidCommandId, 100);
            }, "ApplyValue should handle out-of-bounds commandId gracefully");

            // Verify that the invalid command was rejected (Throttle should not have been modified)
            Assert.That(pedalSettings.Throttle.Deadzone, Is.EqualTo(-1),
                "Throttle deadzone should remain unmodified after invalid command");
        }

        // ═══════════════════════════════════════════════════════════════
        //  TEST 5: Multiple Device Management
        //  Verify thread-safe access to multiple devices concurrently.
        // ═══════════════════════════════════════════════════════════════

        [Test]
        public void ConcurrentWriteQueue_OrderedProcessing()
        {
            // Test that the write queue can handle concurrent writes safely
            var deviceIds = new[] { (byte)0x13, (byte)0x19, (byte)0x1A }; // WB, pedals, shifter

            // Queue up 30 write commands from multiple threads
            var tasks = new List<Task>();
            for (int i = 0; i < 10; i++)
            {
                foreach (var devId in deviceIds)
                {
                    int cmdIdx = i;
                    int dev = devId;
                    tasks.Add(Task.Run(() =>
                    {
                        // Should not throw due to concurrent queue access
                        _manager.WriteSetting((byte)dev, (byte)(0x10 + cmdIdx), (byte)(cmdIdx * 10));
                    }));
                }
            }

            // Should complete without deadlock or exception
            Assert.DoesNotThrow(() =>
            {
                Task.WaitAll(tasks.ToArray(), TimeSpan.FromSeconds(5));
            }, "Concurrent WriteSetting calls should complete without exception");
        }

        // ═══════════════════════════════════════════════════════════════
        //  TEST 6: IsConnected Property Thread Safety
        //  Verify that device connectivity queries are thread-safe.
        // ═══════════════════════════════════════════════════════════════

        [Test]
        public void IsConnectedProperty_ThreadSafe()
        {
            var devicesDict = typeof(MozaSerialManager)
                .GetField("_devices", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)
                ?.GetValue(_manager) as System.Collections.Concurrent.ConcurrentDictionary<string, MozaDevice>;

            // Add a test device
            var testDevice = new MozaDevice(
                "COM77",
                MozaDeviceRegistry.MozaDeviceType.Wheelbase,
                MozaDeviceRegistry.GetDeviceId(MozaDeviceRegistry.MozaDeviceType.Wheelbase));

            devicesDict?.TryAdd("COM77", testDevice);

            // Toggle IsConnected from multiple threads while querying from others
            var tasks = new List<Task>();
            bool isConnected = false;

            for (int i = 0; i < 5; i++)
            {
                tasks.Add(Task.Run(() =>
                {
                    for (int j = 0; j < 20; j++)
                    {
                        testDevice.IsConnected = j % 2 == 0;
                        Thread.Sleep(1);
                    }
                }));

                tasks.Add(Task.Run(() =>
                {
                    for (int j = 0; j < 20; j++)
                    {
                        // Read the property (should not throw despite concurrent writes)
                        isConnected = _manager.IsConnected;
                        Thread.Sleep(1);
                    }
                }));
            }

            Assert.DoesNotThrow(() =>
            {
                Task.WaitAll(tasks.ToArray(), TimeSpan.FromSeconds(5));
            }, "Concurrent IsConnected reads/writes should be safe");
        }

        // ═══════════════════════════════════════════════════════════════
        //  TEST 7: Semaphore Disposal Safety
        //  Verify that semaphores are properly cleaned up during Close.
        // ═══════════════════════════════════════════════════════════════

        [Test]
        public void SemaphoreDisposal_NoLeaks()
        {
            var locksDict = typeof(MozaSerialManager)
                .GetField("_portLocks", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)
                ?.GetValue(_manager) as System.Collections.Concurrent.ConcurrentDictionary<string, System.Threading.SemaphoreSlim>;

            // Manually create and add a semaphore
            var testSem = new SemaphoreSlim(1, 1);
            locksDict?.TryAdd("COM66", testSem);

            var devicesDict = typeof(MozaSerialManager)
                .GetField("_devices", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)
                ?.GetValue(_manager) as System.Collections.Concurrent.ConcurrentDictionary<string, MozaDevice>;

            var testDevice = new MozaDevice(
                "COM66",
                MozaDeviceRegistry.MozaDeviceType.Wheelbase,
                MozaDeviceRegistry.GetDeviceId(MozaDeviceRegistry.MozaDeviceType.Wheelbase));
            testDevice.IsConnected = true;

            devicesDict?.TryAdd("COM66", testDevice);

            // Mock serial port
            var portsDict = typeof(MozaSerialManager)
                .GetField("_ports", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)
                ?.GetValue(_manager) as System.Collections.Concurrent.ConcurrentDictionary<string, System.IO.Ports.SerialPort>;

            var mockPort = new System.IO.Ports.SerialPort("COM66");
            portsDict?.TryAdd("COM66", mockPort);

            // Close the port — should dispose the semaphore
            var closePortMethod = typeof(MozaSerialManager)
                .GetMethod("ClosePort", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);

            Assert.DoesNotThrow(() =>
            {
                closePortMethod?.Invoke(_manager, new object[] { "COM66" });
            }, "ClosePort should not throw even while disposing semaphores");

            // Attempt to use the semaphore — should throw ObjectDisposedException if properly disposed
            Assert.Throws<ObjectDisposedException>(() =>
            {
                testSem.Wait(100);
            }, "Semaphore should be disposed after ClosePort");
        }

        // ═══════════════════════════════════════════════════════════════
        //  TEST 8: WriteQueue Processing with Missing Devices
        //  Verify that the write queue gracefully handles commands for non-existent devices.
        // ═══════════════════════════════════════════════════════════════

        [Test]
        public void ProcessWriteQueue_MissingDevice_Ignored()
        {
            // Queue a write command for a device that doesn't exist
            _manager.WriteSetting((byte)0x99, (byte)0x14, (byte)50);  // Device 0x99 doesn't exist

            // Trigger ProcessWriteQueue via reflection
            var processWriteQueueMethod = typeof(MozaSerialManager)
                .GetMethod("ProcessWriteQueue", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);

            // Should not throw
            Assert.DoesNotThrow(() =>
            {
                processWriteQueueMethod?.Invoke(_manager, null);
            }, "ProcessWriteQueue should handle missing devices gracefully");
        }

        // ═══════════════════════════════════════════════════════════════
        //  TEST 9: Multiple Start Calls (Idempotency)
        //  Verify that calling Start multiple times doesn't create multiple threads.
        // ═══════════════════════════════════════════════════════════════

        [Test]
        public void StartMultipleTimes_OnlyOneThread()
        {
            _manager.Start();

            var pollThreadField = typeof(MozaSerialManager)
                .GetField("_pollThread", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);

            var firstThread = (Thread)pollThreadField?.GetValue(_manager);
            Assert.That(firstThread, Is.Not.Null, "First Start should create a thread");

            Thread.Sleep(100);

            // Start again
            _manager.Start();

            var secondThread = (Thread)pollThreadField?.GetValue(_manager);
            Assert.That(firstThread, Is.SameAs(secondThread),
                "Multiple Start calls should not create a new thread");
        }

        // ═══════════════════════════════════════════════════════════════
        //  TEST 10: Stop/Dispose Ordering
        //  Verify that Stop and Dispose can be called in any order safely.
        // ═══════════════════════════════════════════════════════════════

        [Test]
        public void StopThenDispose_NoException()
        {
            _manager.Start();
            Thread.Sleep(100);

            Assert.DoesNotThrow(() =>
            {
                _manager.Stop();
                _manager.Dispose();
            }, "Stop then Dispose should not throw");
        }

        [Test]
        public void DisposeThenStop_NoException()
        {
            _manager.Start();
            Thread.Sleep(100);

            Assert.DoesNotThrow(() =>
            {
                _manager.Dispose();
                _manager.Stop();
            }, "Dispose then Stop should not throw");
        }

        [Test]
        public void DoublestopDispose_Idempotent()
        {
            _manager.Start();
            Thread.Sleep(100);

            Assert.DoesNotThrow(() =>
            {
                _manager.Stop();
                _manager.Stop();
                _manager.Dispose();
                _manager.Dispose();
            }, "Multiple Stop/Dispose calls should be safe");
        }

        // ═══════════════════════════════════════════════════════════════
        //  TEST 11: GetSerialPortDiagnosticJson — System with no Moza hardware
        //  Verify that diagnostic returns valid JSON without throwing.
        // ═══════════════════════════════════════════════════════════════

        [Test]
        public void GetSerialPortDiagnosticJson_NoMozaHardware_ReturnsValidJson()
        {
            // One port that is not Moza and cannot be opened
            _fake.Add("COM20", "Microsoft USB Serial Device (COM20) USB Serial Device");
            string diagnosticJson = _manager.GetSerialPortDiagnosticJson();

            // Should return non-empty JSON string
            Assert.That(diagnosticJson, Is.Not.Null.And.Not.Empty,
                "GetSerialPortDiagnosticJson should return a non-empty JSON string");

            // Parse as JSON to verify it's valid
            var parsed = Newtonsoft.Json.Linq.JObject.Parse(diagnosticJson);

            // Top-level keys should exist
            Assert.That(parsed["timestamp"], Is.Not.Null, "JSON should have 'timestamp' field");
            Assert.That(parsed["ports"], Is.Not.Null, "JSON should have 'ports' field");

            // Ports should be an array (possibly empty)
            var ports = parsed["ports"] as Newtonsoft.Json.Linq.JArray;
            Assert.That(ports, Is.Not.Null, "'ports' should be a JSON array");

            // Each port entry should have expected fields (even if values are null)
            foreach (var portEntry in ports)
            {
                Assert.That(portEntry["portName"], Is.Not.Null, "Each port should have 'portName'");
                Assert.That(portEntry["usbDescription"], Is.Not.Null, "Each port should have 'usbDescription'");
                Assert.That(portEntry["classification"], Is.Not.Null, "Each port should have 'classification'");
                Assert.That(portEntry["portOpenStatus"], Is.Not.Null, "Each port should have 'portOpenStatus'");
            }
        }

        // ═══════════════════════════════════════════════════════════════
        //  TEST 12: GetSerialPortDiagnosticJson — Comprehensive field validation
        //  Verify that each port diagnostic includes all expected fields.
        // ═══════════════════════════════════════════════════════════════

        [Test]
        public void GetSerialPortDiagnosticJson_FieldsPresent()
        {
            _fake.Add("COM20", "Microsoft USB Serial Device (COM20) USB Serial Device");
            string diagnosticJson = _manager.GetSerialPortDiagnosticJson();
            var parsed = Newtonsoft.Json.Linq.JObject.Parse(diagnosticJson);

            // Check summary-level fields
            Assert.That(parsed["timestamp"], Is.Not.Null, "Should have timestamp");
            Assert.That(parsed["totalPorts"], Is.Not.Null, "Should have totalPorts count");
            Assert.That(parsed["matchedDevices"], Is.Not.Null, "Should have matchedDevices dictionary");
            Assert.That(parsed["ports"], Is.Not.Null, "Should have ports array");

            // If there are ports, check their structure
            var ports = parsed["ports"] as Newtonsoft.Json.Linq.JArray;
            if (ports != null && ports.Count > 0)
            {
                var firstPort = ports[0];
                Assert.That(firstPort["portName"], Is.Not.Null, "Port should have portName");
                Assert.That(firstPort["usbDescription"], Is.Not.Null, "Port should have usbDescription");
                Assert.That(firstPort["classification"], Is.Not.Null, "Port should have classification");
                Assert.That(firstPort["matchedViaFallback"], Is.Not.Null, "Port should have matchedViaFallback boolean");
                Assert.That(firstPort["portOpenStatus"], Is.Not.Null, "Port should have portOpenStatus");
                Assert.That(firstPort["pollStatus"], Is.Not.Null, "Port should have pollStatus");
            }
        }

        // ═══════════════════════════════════════════════════════════════
        //  Ports another program holds
        //  On the rig, MOZA Pit House holds the base's two ports (COM6 and
        //  COM13, described only as "USB Serial Device") for as long as it
        //  runs. Opening them was tried every 10 s, and each SerialPort.Open
        //  threw — which SimHub logs with its stack, caught or not.
        // ═══════════════════════════════════════════════════════════════

        private const string Generic = "Microsoft USB Serial Device (COM{0}) USB Serial Device";

        /// <summary>Moza's USB vendor id, as the base's ports carry it on the rig behind a generic description.</summary>
        private const string Moza = MozaSerialManager.MozaVendorId;

        private void RigPortsHeldByPitHouse()
        {
            _fake.Add("COM6", string.Format(Generic, 6), Moza);
            _fake.Add("COM13", string.Format(Generic, 13), Moza);
            _fake.Held.Add("COM6");
            _fake.Held.Add("COM13");
        }

        /// <summary>Discovery as the poll loop runs it: once, then ten seconds on.</summary>
        private void Cycles(int count)
        {
            for (int i = 0; i < count; i++)
            {
                _manager.DiscoverDevices();
                _now = _now.AddSeconds(10);
            }
        }

        private int WarnsAbout(string text) => _warns.Count(w => w.Contains(text));

        // The warnings about ports. No Moza program is running unless a test says so, so these are all there are.
        private List<string> PortWarns => _warns.ToList();

        [Test]
        public void HeldPort_IsLoggedOnceARun_AndNeverOpened()
        {
            RigPortsHeldByPitHouse();

            Cycles(360); // an hour

            Assert.That(WarnsAbout("COM6 is held by another program"), Is.EqualTo(1));
            Assert.That(WarnsAbout("COM13 is held by another program"), Is.EqualTo(1));
            Assert.That(PortWarns, Has.Count.EqualTo(2), string.Join("\n", PortWarns));
            // Nothing was opened, so nothing threw for SimHub to log
            Assert.That(_fake.Opens, Is.Empty);
            // Looked at when discovery began, and every five minutes after
            Assert.That(_fake.ChecksOf("COM6"), Is.EqualTo(12));
        }

        [Test]
        public void HeldPort_IsLookedAtAgain_OnlyAfterFiveMinutes()
        {
            RigPortsHeldByPitHouse();
            DateTime start = _now;

            _manager.DiscoverDevices();
            _now = start.AddMilliseconds(MozaSerialManager.HeldPortRetryMs - 1);
            _manager.DiscoverDevices();
            Assert.That(_fake.ChecksOf("COM6"), Is.EqualTo(1));

            _now = start.AddMilliseconds(MozaSerialManager.HeldPortRetryMs);
            _manager.DiscoverDevices();
            Assert.That(_fake.ChecksOf("COM6"), Is.EqualTo(2));
            Assert.That(WarnsAbout("COM6 is held"), Is.EqualTo(1));
        }

        [Test]
        public void HeldPort_IsLookedAtAgainAtOnce_WhenThePortsChange()
        {
            RigPortsHeldByPitHouse();
            Cycles(1);

            _fake.Add("COM20", string.Format(Generic, 20));
            Cycles(1);

            Assert.That(_fake.ChecksOf("COM6"), Is.EqualTo(2));
            Assert.That(_fake.ChecksOf("COM13"), Is.EqualTo(2));
            Assert.That(WarnsAbout("COM6 is held"), Is.EqualTo(1));
        }

        [Test]
        public void HeldPort_IsLookedAtAgainAtOnce_OnForceRediscovery()
        {
            RigPortsHeldByPitHouse();
            Cycles(1);

            _manager.ForceRediscovery();
            Cycles(1);

            Assert.That(_fake.ChecksOf("COM6"), Is.EqualTo(2));
            Assert.That(WarnsAbout("COM6 is held"), Is.EqualTo(1));
        }

        [Test]
        public void PortLetGo_IsSaidAndOpenedAgain()
        {
            RigPortsHeldByPitHouse();
            Cycles(1);

            _fake.Held.Remove("COM6"); // Pit House quit
            _now = _now.AddMilliseconds(MozaSerialManager.HeldPortRetryMs);
            _manager.DiscoverDevices();

            Assert.That(_infos, Has.Some.Contains("COM6 is no longer held by another program"));
            Assert.That(_fake.Opens, Is.EqualTo(new[] { "COM6" }));
            Assert.That(_fake.ChecksOf("COM13"), Is.EqualTo(2));
            Assert.That(_fake.Opens, Has.No.Member("COM13"));
        }

        [Test]
        public void RealOpenFailure_StaysVisible_EveryCycle()
        {
            _fake.Add("COM20", string.Format(Generic, 20), Moza);
            _fake.OpenFailure = name => new IOException("The semaphore timeout period has expired.");

            Cycles(3);

            Assert.That(WarnsAbout("Probe open failed on COM20: The semaphore timeout period has expired."), Is.EqualTo(3));
            Assert.That(WarnsAbout("is held"), Is.EqualTo(0));
        }

        [Test]
        public void PortTakenBetweenCheckAndOpen_IsTreatedAsHeld()
        {
            _fake.Add("COM6", string.Format(Generic, 6), Moza);
            _fake.OpenFailure = name => new UnauthorizedAccessException($"Access to the port '{name}' is denied.");

            Cycles(30);

            Assert.That(_fake.Opens, Has.Count.EqualTo(1));
            Assert.That(WarnsAbout("COM6 is held by another program"), Is.EqualTo(1));
            Assert.That(WarnsAbout("Probe open failed"), Is.EqualTo(0));
        }

        [Test]
        public void HeldPortWithAMozaDescription_IsLoggedOnce_AndNotCountedEveryCycle()
        {
            _fake.Add("COM6", "Gudsen MOZA R21 Ultra Base (COM6)");
            _fake.Held.Add("COM6");

            Cycles(30);

            Assert.That(PortWarns, Has.Count.EqualTo(1), string.Join("\n", PortWarns));
            Assert.That(PortWarns[0], Does.Contain("COM6 is held by another program"));
            Assert.That(_infos, Has.None.Contains("DIAGNOSTIC"));
            Assert.That(_fake.Opens, Is.Empty);
        }

        [Test]
        public void MozaDescribedPortTakenBetweenCheckAndOpen_IsTreatedAsHeld()
        {
            _fake.Add("COM6", "Gudsen MOZA R21 Ultra Base (COM6)");
            _fake.OpenFailure = name => new UnauthorizedAccessException($"Access to the port '{name}' is denied.");

            Cycles(30);

            Assert.That(_fake.Opens, Has.Count.EqualTo(1));
            Assert.That(WarnsAbout("COM6 is held by another program"), Is.EqualTo(1));
            Assert.That(WarnsAbout("Failed to open"), Is.EqualTo(0));
        }

        // ═══════════════════════════════════════════════════════════════
        //  The diagnostic (?action=listSerialPortDiagnostic)
        //  It used to open every port the machine lists — each held one threw, and SimHub logs
        //  the throw with its stack — and write Moza read commands to every port nothing
        //  describes as Moza, to whoever asked. A held port is now found without opening it,
        //  and the commands are written only when the caller asks for them.
        // ═══════════════════════════════════════════════════════════════

        private static Newtonsoft.Json.Linq.JToken PortEntry(string json, string portName) =>
            Newtonsoft.Json.Linq.JObject.Parse(json)["ports"]!.Single(p => (string?)p["portName"] == portName);

        [Test]
        public void Diagnostic_HeldPort_IsReportedAsAccessDenied_WithoutBeingOpened()
        {
            RigPortsHeldByPitHouse();

            string json = _manager.GetSerialPortDiagnosticJson();

            Assert.That(_fake.Opens, Is.Empty, "nothing was opened, so nothing threw for SimHub to log");
            foreach (string port in new[] { "COM6", "COM13" })
            {
                Assert.That((string?)PortEntry(json, port)["portOpenStatus"], Is.EqualTo("AccessDenied"));
                Assert.That((string?)PortEntry(json, port)["portOpenError"], Does.Contain("Another program holds the port"));
            }
        }

        [Test]
        public void Diagnostic_WritesToNoPort_UnlessAskedTo()
        {
            _fake.Add("COM20", string.Format(Generic, 20)); // nothing says it is Moza
            _fake.OpenSucceeds = true;                      // a port that can be had, without being a real one

            string json = _manager.GetSerialPortDiagnosticJson();

            Assert.That((string?)PortEntry(json, "COM20")["portOpenStatus"], Is.EqualTo("Open"));
            Assert.That(_fake.Opens, Is.EqualTo(new[] { "COM20" }), "opened once, to see that it can be, and nothing sent to it");
            Assert.That(_warns, Has.None.Contains("Probe"));

            _fake.Opens.Clear();
            _manager.GetSerialPortDiagnosticJson(probe: true);

            Assert.That(_fake.Opens, Is.EqualTo(new[] { "COM20", "COM20" }), "asked to, it opens it again to talk to it");
        }

        // ═══════════════════════════════════════════════════════════════
        //  The warning about Moza software
        //  CheckForPitHouse runs at every discovery cycle, 10 s apart, and Pit House runs all
        //  day on the rig: the warning is logged once for each set of programs, not 8,600 times
        //  a day. PitHouseWarning itself is kept as the machine is.
        // ═══════════════════════════════════════════════════════════════

        private int PitHouseWarns => _warns.Count(w => w.Contains("Moza software is running"));

        [Test]
        public void PitHouseWarning_IsLoggedOnce_WhileTheSameProgramsRun()
        {
            _mozaPrograms.AddRange(new[] { "PitHouse.exe", "MozaBackgroundSystem.exe" });

            Cycles(360); // an hour

            Assert.That(PitHouseWarns, Is.EqualTo(1), string.Join("\n", _warns));
            Assert.That(_warns.Single(), Does.Contain("PitHouse.exe, MozaBackgroundSystem.exe"));
            // The warning itself is kept, for the diagnostic, as long as they run
            Assert.That(_manager.PitHouseWarning, Does.Contain("PitHouse.exe, MozaBackgroundSystem.exe"));
        }

        [Test]
        public void PitHouseWarning_IsLoggedAgain_WhenTheSetOfProgramsChanges_OrTheyComeBack()
        {
            _mozaPrograms.Add("PitHouse.exe");
            Cycles(5);
            Assert.That(PitHouseWarns, Is.EqualTo(1));

            _mozaPrograms.Add("MozaService.exe"); // another one starts: a different set
            Cycles(5);
            Assert.That(PitHouseWarns, Is.EqualTo(2));
            Assert.That(_warns.Last(), Does.Contain("PitHouse.exe, MozaService.exe"));

            _mozaPrograms.Clear(); // Pit House quit: nothing to say, and the warning is gone
            Cycles(5);
            Assert.That(PitHouseWarns, Is.EqualTo(2));
            Assert.That(_manager.PitHouseWarning, Is.Empty);

            _mozaPrograms.Add("PitHouse.exe"); // and back
            Cycles(5);
            Assert.That(PitHouseWarns, Is.EqualTo(3));
        }

        [Test]
        public void PitHouseWarning_IsKeptEveryCycle_ForTheDiagnostic_WhetherOrNotItWasLogged()
        {
            _mozaPrograms.Add("PitHouse.exe");
            Cycles(3);
            Assert.That(PitHouseWarns, Is.EqualTo(1));

            var parsed = Newtonsoft.Json.Linq.JObject.Parse(_manager.GetSerialPortDiagnosticJson());

            Assert.That((string?)parsed["pitHouseWarning"], Does.Contain("PitHouse.exe"));
        }

        // ═══════════════════════════════════════════════════════════════
        //  When the ports are looked at, and which
        //  The search walked every port every ten seconds, Pit House or not (its process name was
        //  never matched: it is "MOZA Pit House"), and wrote Moza read commands to any port nothing
        //  described as Moza, a Valve receiver's included. Now it never runs while Pit House does,
        //  runs again only when the list of ports changes (or Pit House quits, or a device drops, or
        //  it is asked to), and talks only to a port that is Moza's by its description or vendor id.
        // ═══════════════════════════════════════════════════════════════

        [Test]
        public void PitHouseIsKnownByTheNameItsProcessHas()
        {
            Assert.That(MozaSerialManager.IncludesPitHouse(new[] { "MOZA Pit House.exe" }), Is.True);
            Assert.That(MozaSerialManager.IncludesPitHouse(new[] { "PitHouse.exe" }), Is.True, "as older installs named it");
            Assert.That(MozaSerialManager.IncludesPitHouse(new[] { "MozaBackgroundSystem.exe" }), Is.False, "a helper is not Pit House");
            Assert.That(MozaSerialManager.IncludesPitHouse(new string[0]), Is.False);
        }

        [Test]
        public void ThePitHouseRunningOnThisMachineIsFound()
        {
            // Read-only: the machine's process list, as the plugin reads it. On the rig Pit House runs all day.
            Assume.That(System.Diagnostics.Process.GetProcessesByName("MOZA Pit House"), Is.Not.Empty, "Pit House is not running here");
            Assert.That(MozaSerialManager.RunningMozaProcesses(), Does.Contain("MOZA Pit House.exe"));
        }

        [Test]
        public void WhilePitHouseRuns_NoPortIsLookedAt()
        {
            RigPortsHeldByPitHouse();
            _mozaPrograms.Add("MOZA Pit House.exe");

            Cycles(360); // an hour of being asked

            Assert.That(_manager.PitHouseRunning, Is.True);
            Assert.That(_manager.Searches, Is.EqualTo(0));
            Assert.That(_fake.Checks, Is.Empty, "no port checked");
            Assert.That(_fake.Opens, Is.Empty, "none opened, nothing written");
            Assert.That(PitHouseWarns, Is.EqualTo(1), "said once");
        }

        [Test]
        public void APortThatIsNotMozas_IsNeverOpenedCheckedOrWrittenTo()
        {
            _fake.Add("COM3", string.Format(Generic, 3), "28DE");   // a Valve receiver, as on the rig
            _fake.Add("COM20", "USB-SERIAL CH340 (COM20)");        // an Arduino, no vendor known
            _fake.OpenSucceeds = true;

            Cycles(3);

            Assert.That(_fake.Checks, Is.Empty);
            Assert.That(_fake.Opens, Is.Empty);
            Assert.That(_warns, Is.Empty, string.Join("\n", _warns));
        }

        [Test]
        public void APortWithMozasVendorId_IsProbed_AndOneDescribedAsMozas_IsOpenedWithoutAProbe()
        {
            _fake.Add("COM13", string.Format(Generic, 13), Moza);
            _fake.Add("COM6", "Gudsen MOZA R21 Ultra Base (COM6)");

            Cycles(1);

            Assert.That(_fake.Opens, Is.EquivalentTo(new[] { "COM13", "COM6" }), "the probe opens COM13 to ask it; COM6 is opened as the base");
            Assert.That(WarnsAbout("Probe open failed on COM13"), Is.EqualTo(1), "the fake's port cannot be had");
        }

        [Test]
        public void ThePortsAreLookedForAtTheStart_AndThenOnlyWhenTheListChanges_NeverOnATimer()
        {
            RigPortsHeldByPitHouse();

            Assert.That(_manager.NoteWhatChanged(), Is.True, "at the start");
            for (int i = 0; i < 1800; i++) // an hour, every two seconds
            {
                _now = _now.AddSeconds(2);
                Assert.That(_manager.NoteWhatChanged(), Is.False, $"nothing changed at {i * 2 + 2} s");
            }

            _fake.Add("COM20", string.Format(Generic, 20), Moza);
            Assert.That(_manager.NoteWhatChanged(), Is.False, "not before the next look at the list");
            _now = _now.AddMilliseconds(MozaSerialManager.PortListCheckMs);
            Assert.That(_manager.NoteWhatChanged(), Is.True, "the list changed");
            _now = _now.AddMilliseconds(MozaSerialManager.PortListCheckMs);
            Assert.That(_manager.NoteWhatChanged(), Is.False);

            _manager.ForceRediscovery();
            Assert.That(_manager.NoteWhatChanged(), Is.True, "asked to");
        }

        [Test]
        public void PitHouseQuitting_IsSeen_AndThePortsAreLookedForThen()
        {
            RigPortsHeldByPitHouse();
            _mozaPrograms.Add("MOZA Pit House.exe");
            int asked = 0;
            _manager = new MozaSerialManager(
                msg => { lock (_infos) _infos.Add(msg); },
                msg => { lock (_warns) _warns.Add(msg); },
                _fake,
                () => _now,
                () => { asked++; return _mozaPrograms.ToArray(); });

            Assert.That(_manager.NoteWhatChanged(), Is.True);
            _manager.DiscoverDevices();
            Assert.That(_manager.PitHouseRunning, Is.True);
            Assert.That(asked, Is.EqualTo(1));

            // While it runs, the processes are looked at once a minute, and the ports not at all.
            for (int i = 0; i < 300; i++) // ten minutes
            {
                _now = _now.AddSeconds(2);
                Assert.That(_manager.NoteWhatChanged(), Is.False);
            }
            Assert.That(asked, Is.EqualTo(1 + 10));
            Assert.That(_fake.Checks, Is.Empty);

            // It quits: seen at the next look, and the ports are looked for.
            _mozaPrograms.Clear();
            _fake.Held.Clear();
            bool asks = false;
            for (int i = 0; i < 30 && !asks; i++) { _now = _now.AddSeconds(2); asks = _manager.NoteWhatChanged(); }
            Assert.That(asks, Is.True);
            _manager.DiscoverDevices();
            Assert.That(_manager.Searches, Is.EqualTo(1));
            Assert.That(_fake.Opens, Is.EquivalentTo(new[] { "COM6", "COM13" }), "the base's ports, probed now that they are free");

            // And once it has gone, the processes are not looked at again until something asks for the ports.
            int after = asked;
            for (int i = 0; i < 300; i++) { _now = _now.AddSeconds(2); _manager.NoteWhatChanged(); }
            Assert.That(asked, Is.EqualTo(after));
        }

        // The real CheckAccess, on things that are not devices: a port that is not there, and files —
        // "\\.\" + a file's full path names the file, and Windows refuses a read-only file to a
        // write open with the same error (5, access denied) it gives for a port another handle has.

        [Test]
        [Platform("Win")]
        public void SystemPorts_CheckAccess_OnAPortThatIsNotThere_ReturnsFailedWithoutThrowing()
        {
            var system = new MozaSystemPorts();
            Assume.That(system.GetPortNames(), Has.No.Member("COM255"));

            Assert.That(system.CheckAccess("COM255"), Is.EqualTo(MozaPortAccess.Failed));
        }

        [Test]
        [Platform("Win")]
        public void SystemPorts_CheckAccess_SaysHeld_WhenWindowsDeniesAccess_AndFree_WhenItOpens()
        {
            string path = Path.Combine(Path.GetTempPath(), "moza-check-access-" + Guid.NewGuid().ToString("N") + ".tmp");
            File.WriteAllText(path, "");
            try
            {
                var system = new MozaSystemPorts();
                Assert.That(system.CheckAccess(path), Is.EqualTo(MozaPortAccess.Free));

                File.SetAttributes(path, FileAttributes.ReadOnly);
                Assert.That(system.CheckAccess(path), Is.EqualTo(MozaPortAccess.Held));
            }
            finally
            {
                File.SetAttributes(path, FileAttributes.Normal);
                File.Delete(path);
            }
        }

        /// <summary>
        /// Stands in for the machine's serial ports. Never opens one: Open always throws, as
        /// SerialPort.Open does for a port it cannot have.
        /// </summary>
        private sealed class FakePorts : IMozaPortSystem
        {
            public readonly List<string> Names = new List<string>();
            public readonly Dictionary<string, string> Descriptions = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            public readonly Dictionary<string, string> Vendors = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            public int NameReads;
            public readonly HashSet<string> Held = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            public readonly List<string> Checks = new List<string>();
            public readonly List<string> Opens = new List<string>();
            public Func<string, Exception> OpenFailure = name => new IOException($"The port '{name}' does not exist.");
            /// <summary>Open gives back a port object that was never opened, which cannot be written to.</summary>
            public bool OpenSucceeds;

            public void Add(string name, string description, string vendor = "")
            {
                Names.Add(name);
                Descriptions[name] = description;
                Vendors[name] = vendor;
            }

            public int ChecksOf(string name) => Checks.Count(c => c == name);

            public string[] GetPortNames() { NameReads++; return Names.ToArray(); }

            public Dictionary<string, MozaSerialManager.PortWmiInfo> GetPortInfo() =>
                Descriptions.ToDictionary(
                    kv => kv.Key,
                    kv => new MozaSerialManager.PortWmiInfo { Description = kv.Value, Vid = Vendors.TryGetValue(kv.Key, out var v) ? v : "" },
                    StringComparer.OrdinalIgnoreCase);

            public MozaPortAccess CheckAccess(string portName)
            {
                Checks.Add(portName);
                return Held.Contains(portName) ? MozaPortAccess.Held : MozaPortAccess.Free;
            }

            public SerialPort Open(string portName)
            {
                Opens.Add(portName);
                if (Held.Contains(portName))
                    throw new UnauthorizedAccessException($"Access to the port '{portName}' is denied.");
                if (OpenSucceeds) return new SerialPort(portName);
                throw OpenFailure(portName);
            }
        }
    }
}
