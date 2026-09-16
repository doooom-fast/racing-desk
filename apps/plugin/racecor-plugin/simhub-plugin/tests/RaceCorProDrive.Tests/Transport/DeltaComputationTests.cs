using System;
using System.Collections.Generic;
using NUnit.Framework;
using RaceCorProDrive.Plugin.Transport;

namespace RaceCorProDrive.Tests.Transport
{
    [TestFixture]
    public class DeltaComputationTests
    {
        /// <summary>
        /// Test that identical dictionaries produce an empty delta.
        /// </summary>
        [Test]
        public void IdenticalDictProducesEmptyDelta()
        {
            var current = new Dictionary<string, object>
            {
                { "key1", 42 },
                { "key2", "value" },
                { "key3", 3.14 }
            };

            var lastSent = new Dictionary<string, object>(current);
            var delta = ComputeDelta(current, lastSent);

            Assert.AreEqual(0, delta.Count, "Delta should be empty for identical dicts");
        }

        /// <summary>
        /// Test that a single changed field appears in the delta.
        /// </summary>
        [Test]
        public void SingleChangedFieldInDelta()
        {
            var current = new Dictionary<string, object>
            {
                { "key1", 42 },
                { "key2", "value" },
                { "key3", 3.14 }
            };

            var lastSent = new Dictionary<string, object>
            {
                { "key1", 42 },
                { "key2", "old_value" },
                { "key3", 3.14 }
            };

            var delta = ComputeDelta(current, lastSent);

            Assert.AreEqual(1, delta.Count, "Delta should contain 1 changed key");
            Assert.IsTrue(delta.ContainsKey("key2"));
            Assert.AreEqual("value", delta["key2"]);
        }

        /// <summary>
        /// Test that multiple changed fields all appear in the delta.
        /// </summary>
        [Test]
        public void MultipleChangedFieldsInDelta()
        {
            var current = new Dictionary<string, object>
            {
                { "key1", 100 },
                { "key2", "new" },
                { "key3", 2.71 }
            };

            var lastSent = new Dictionary<string, object>
            {
                { "key1", 42 },
                { "key2", "old" },
                { "key3", 3.14 }
            };

            var delta = ComputeDelta(current, lastSent);

            Assert.AreEqual(3, delta.Count);
            Assert.AreEqual(100, delta["key1"]);
            Assert.AreEqual("new", delta["key2"]);
            Assert.AreEqual(2.71, delta["key3"]);
        }

        /// <summary>
        /// Test that a new field (not in lastSent) appears in the delta.
        /// </summary>
        [Test]
        public void NewFieldAddedToDelta()
        {
            var current = new Dictionary<string, object>
            {
                { "key1", 42 },
                { "key2", "value" },
                { "key3_new", 99 }
            };

            var lastSent = new Dictionary<string, object>
            {
                { "key1", 42 },
                { "key2", "value" }
            };

            var delta = ComputeDelta(current, lastSent);

            Assert.AreEqual(1, delta.Count);
            Assert.IsTrue(delta.ContainsKey("key3_new"));
            Assert.AreEqual(99, delta["key3_new"]);
        }

        /// <summary>
        /// Test that a removed key is NOT represented in the delta.
        /// (For v1 of the protocol, removed keys are not tracked.)
        /// </summary>
        [Test]
        public void RemovedKeyNotInDelta()
        {
            var current = new Dictionary<string, object>
            {
                { "key1", 42 }
            };

            var lastSent = new Dictionary<string, object>
            {
                { "key1", 42 },
                { "key2", "removed" }
            };

            var delta = ComputeDelta(current, lastSent);

            // key2 is NOT in the delta — v1 doesn't track deletions
            Assert.AreEqual(0, delta.Count);
        }

        /// <summary>
        /// Test that null values are correctly detected as changes.
        /// </summary>
        [Test]
        public void NullValueDetectedAsChange()
        {
            var current = new Dictionary<string, object>
            {
                { "key1", null },
                { "key2", "value" }
            };

            var lastSent = new Dictionary<string, object>
            {
                { "key1", "was_not_null" },
                { "key2", "value" }
            };

            var delta = ComputeDelta(current, lastSent);

            Assert.AreEqual(1, delta.Count);
            Assert.IsTrue(delta.ContainsKey("key1"));
            Assert.IsNull(delta["key1"]);
        }

        /// <summary>
        /// Test that numeric precision differences are properly detected.
        /// </summary>
        [Test]
        public void NumericChangeDetected()
        {
            var current = new Dictionary<string, object>
            {
                { "rpm", 5000.5 }
            };

            var lastSent = new Dictionary<string, object>
            {
                { "rpm", 5000.0 }
            };

            var delta = ComputeDelta(current, lastSent);

            Assert.AreEqual(1, delta.Count);
            Assert.AreEqual(5000.5, delta["rpm"]);
        }

        /// <summary>
        /// Helper: computes delta the same way WsTelemetryPublisher does.
        /// </summary>
        private Dictionary<string, object> ComputeDelta(
            Dictionary<string, object> current,
            Dictionary<string, object> lastSent)
        {
            var delta = new Dictionary<string, object>();

            foreach (var kvp in current)
            {
                object lastValue = null;
                bool exists = lastSent.TryGetValue(kvp.Key, out lastValue);

                if (!exists || !ObjectEquals(kvp.Value, lastValue))
                {
                    delta[kvp.Key] = kvp.Value;
                }
            }

            return delta;
        }

        private static bool ObjectEquals(object a, object b)
        {
            if (ReferenceEquals(a, b)) return true;
            if (a == null || b == null) return false;
            return a.Equals(b);
        }
    }
}
