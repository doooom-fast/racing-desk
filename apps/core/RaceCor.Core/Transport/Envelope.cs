using MessagePack;

namespace RaceCorProDrive.Plugin.Transport
{
    /// <summary>
    /// WebSocket message envelope: all messages follow this structure.
    /// Serialized as MessagePack (binary).
    /// </summary>
    [MessagePackObject(keyAsPropertyName: true)]
    public class Envelope
    {
        /// <summary>Message tag: "snapshot", "delta", "request", "response", "event".</summary>
        public string t { get; set; }

        /// <summary>Schema version. Currently 1.</summary>
        public byte v { get; set; }

        /// <summary>
        /// Payload. Type varies by tag:
        /// - snapshot.d: Dictionary<string, object> (flat telemetry map)
        /// - delta.d: Dictionary<string, object> (changed keys only)
        /// - request.d: RequestPayload
        /// - response.d: ResponsePayload
        /// - event.d: EventPayload
        /// </summary>
        public object d { get; set; }
    }

    /// <summary>
    /// Request payload (client → server).
    /// Used for actions like pit box adjustments.
    /// </summary>
    [MessagePackObject(keyAsPropertyName: true)]
    public class RequestPayload
    {
        /// <summary>Unique request identifier (UUID or sequence number).</summary>
        public string id { get; set; }

        /// <summary>Action name (e.g., "adjustTC", "setPitFuel").</summary>
        public string action { get; set; }

        /// <summary>Action parameters (key-value map).</summary>
        public object @params { get; set; }
    }

    /// <summary>
    /// Response payload (server → client).
    /// Mirrors request ID for correlation.
    /// </summary>
    [MessagePackObject(keyAsPropertyName: true)]
    public class ResponsePayload
    {
        /// <summary>Request ID being responded to.</summary>
        public string id { get; set; }

        /// <summary>Success flag.</summary>
        public bool ok { get; set; }

        /// <summary>Optional result data (only if ok=true).</summary>
        public object result { get; set; }

        /// <summary>Optional error message (only if ok=false).</summary>
        public string error { get; set; }
    }

    /// <summary>
    /// Event payload (server → client).
    /// For server-initiated notifications (e.g., session ended, incident occurred).
    /// </summary>
    [MessagePackObject(keyAsPropertyName: true)]
    public class EventPayload
    {
        /// <summary>Event name (e.g., "sessionEnded", "incidentOccurred").</summary>
        public string name { get; set; }

        /// <summary>Event data (key-value map).</summary>
        public object payload { get; set; }
    }

    /// <summary>
    /// Static tag constants for message routing.
    /// </summary>
    public static class Tag
    {
        public const string Snapshot = "snapshot";
        public const string Delta = "delta";
        public const string Request = "request";
        public const string Response = "response";
        public const string Event = "event";
    }
}
