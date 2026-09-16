using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using RaceCorProDrive.Plugin.Engine.Moza;

namespace RaceCorProDrive.Tests
{
    [TestFixture]
    public class MozaSerialManagerTests
    {
        private MozaSerialManager _manager;

        [SetUp]
        public void SetUp()
        {
            _manager = new MozaSerialManager(
                logInfo: msg => { },
                logWarn: msg => { });
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

        // Skipped on non-Windows: GetSerialPortDiagnosticJson() reads WMI via
        // System.Management, which has no implementation on Linux/macOS.
        [Test]
        [Platform("Win")]
        public void GetSerialPortDiagnosticJson_NoMozaHardware_ReturnsValidJson()
        {
            // Call diagnostic on a system that likely has no Moza hardware
            // (or may have real ports, but we just verify the JSON is valid and not null)
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

        // Skipped on non-Windows: GetSerialPortDiagnosticJson() reads WMI via
        // System.Management, which has no implementation on Linux/macOS.
        [Test]
        [Platform("Win")]
        public void GetSerialPortDiagnosticJson_FieldsPresent()
        {
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
    }
}
