using System;
using System.Collections.Generic;
using System.Linq;
using MessagePack;
using static SimHub.Logging;

namespace RaceCorProDrive.Plugin.Transport
{
    /// <summary>
    /// Manages per-client telemetry state and publishes snapshots + deltas.
    /// Runs on SimHub's data thread (no async calls).
    /// Thread-safe via per-client locking.
    /// </summary>
    public class WsTelemetryPublisher
    {
        private readonly IWsConnectionSink _sink;
        private readonly Func<DateTime> _clock;
        private readonly Dictionary<Guid, ClientState> _clientState = new Dictionary<Guid, ClientState>();
        private readonly object _clientStateLock = new object();

        // MessagePack serialization settings.
        // TypelessContractlessStandardResolver is required for serializing object-typed members
        // containing Dictionary<string, object> with mixed primitive values.
        //
        // CRITICAL: Wrapped in Lazy<T> so the MessagePack runtime is NOT
        // touched at type-load time. The previous direct field initializer
        // ran during JIT'd type-init when SimHub called Assembly.GetTypes()
        // on our DLL, dragged MessagePack's static init in, and tripped
        // the System.Buffers 4.0.3 vs 4.0.4 binding mismatch (see csproj
        // build warning). The resulting TypeInitializationException
        // bubbled up as ReflectionTypeLoadException on GetTypes(), which
        // SimHub's plugin enumerator caught around the whole foreach loop
        // - so EVERY plugin (bundled + ours) silently vanished from the
        // settings list. Lazy<T> defers the throw to first SerializeFull/
        // SerializeDelta call so the assembly loads cleanly and SimHub's
        // enumerator finishes.
        private static readonly Lazy<MessagePackSerializerOptions> _serializerOptions =
            new Lazy<MessagePackSerializerOptions>(() =>
                MessagePackSerializerOptions.Standard
                    .WithResolver(MessagePack.Resolvers.TypelessContractlessStandardResolver.Instance));

        public WsTelemetryPublisher(IWsConnectionSink sink, Func<DateTime> clock = null)
        {
            _sink = sink ?? throw new ArgumentNullException(nameof(sink));
            _clock = clock ?? (() => DateTime.UtcNow);

            // Register connection callbacks
            _sink.OnClientConnected(OnClientConnected);
            _sink.OnClientDisconnected(OnClientDisconnected);
        }

        /// <summary>Called when a new client connects.</summary>
        private void OnClientConnected(IWsConnection conn)
        {
            lock (_clientStateLock)
            {
                if (!_clientState.ContainsKey(conn.Id))
                {
                    _clientState[conn.Id] = new ClientState
                    {
                        Connection = conn,
                        LastSent = new Dictionary<string, object>(),
                        LastFullSent = _clock(),
                    };

                    Current.Info($"[RaceCorProDrive.WsTelemetryPublisher] Tracking client {conn.Id}");
                }
            }
        }

        /// <summary>Called when a client disconnects.</summary>
        private void OnClientDisconnected(IWsConnection conn)
        {
            lock (_clientStateLock)
            {
                _clientState.Remove(conn.Id);
                Current.Info($"[RaceCorProDrive.WsTelemetryPublisher] Removed client {conn.Id}");
            }
        }

        /// <summary>
        /// Called each frame after TelemetrySnapshot is updated.
        /// Sends full snapshot on connect and every 5 seconds; sends deltas in between.
        /// </summary>
        public void Tick(Dictionary<string, object> currentDict)
        {
            if (currentDict == null) return;

            var now = _clock();
            var snapshotPayload = SerializeSnapshot(currentDict);

            lock (_clientStateLock)
            {
                foreach (var clientEntry in _clientState)
                {
                    var clientId = clientEntry.Key;
                    var state = clientEntry.Value;

                    if (!state.Connection.IsOpen)
                    {
                        continue;  // Skip if connection is closed; will be cleaned up by OnClientDisconnected
                    }

                    // Decide: send full snapshot or delta?
                    bool sendSnapshot = (now - state.LastFullSent).TotalSeconds >= 5.0;

                    if (sendSnapshot)
                    {
                        // Send full snapshot + resync
                        try
                        {
                            state.Connection.Send(snapshotPayload);
                            state.LastSent = new Dictionary<string, object>(currentDict);
                            state.LastFullSent = now;
                        }
                        catch (Exception ex)
                        {
                            Current.Warn($"[RaceCorProDrive.WsTelemetryPublisher] Failed to send snapshot to {clientId}: {ex.Message}");
                        }
                    }
                    else
                    {
                        // Compute delta and send if changed
                        var delta = ComputeDelta(currentDict, state.LastSent);

                        if (delta.Count > 0)
                        {
                            try
                            {
                                var deltaPayload = SerializeDelta(delta);
                                state.Connection.Send(deltaPayload);

                                // Update lastSent with changed keys only
                                foreach (var kvp in delta)
                                {
                                    state.LastSent[kvp.Key] = kvp.Value;
                                }
                            }
                            catch (Exception ex)
                            {
                                Current.Warn($"[RaceCorProDrive.WsTelemetryPublisher] Failed to send delta to {clientId}: {ex.Message}");
                            }
                        }
                        // Empty deltas are NOT sent
                    }
                }
            }
        }

        /// <summary>
        /// Compute the delta: keys where current value differs from last sent.
        /// </summary>
        private Dictionary<string, object> ComputeDelta(Dictionary<string, object> current, Dictionary<string, object> lastSent)
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

        /// <summary>
        /// Safely compare two objects for equality.
        /// </summary>
        private static bool ObjectEquals(object a, object b)
        {
            if (ReferenceEquals(a, b)) return true;
            if (a == null || b == null) return false;
            return a.Equals(b);
        }

        /// <summary>
        /// Serialize a snapshot envelope to MessagePack bytes.
        /// </summary>
        private byte[] SerializeSnapshot(Dictionary<string, object> dict)
        {
            var envelope = new Envelope
            {
                t = Tag.Snapshot,
                v = 1,
                d = dict
            };

            return MessagePackSerializer.Serialize(envelope, _serializerOptions.Value);
        }

        /// <summary>
        /// Serialize a delta envelope to MessagePack bytes.
        /// </summary>
        private byte[] SerializeDelta(Dictionary<string, object> dict)
        {
            var envelope = new Envelope
            {
                t = Tag.Delta,
                v = 1,
                d = dict
            };

            return MessagePackSerializer.Serialize(envelope, _serializerOptions.Value);
        }

        /// <summary>
        /// Per-client state.
        /// </summary>
        private class ClientState
        {
            public IWsConnection Connection { get; set; }
            public Dictionary<string, object> LastSent { get; set; }
            public DateTime LastFullSent { get; set; }
        }
    }
}
