# WebSocket Telemetry Protocol (v1)

This document specifies the binary WebSocket protocol between the RaceCor Pro Drive C# SimHub plugin (server) and the Electron overlay client.

## Overview

The protocol replaces the HTTP polling mechanism for real-time telemetry delivery. The server broadcasts telemetry snapshots and deltas to connected WebSocket clients at ~60fps (or per-tick from SimHub).

**Status**: PR 1 implements snapshot and delta messages only. Request, response, and event messages are defined but not yet wired (reserved for PR 3).

## Connection Details

- **Server URL**: `ws://0.0.0.0:8890/racecor` (PR 1; PR 5 migrates to port 8889 after HTTP retires)
- **Protocol**: Binary MessagePack encoding
- **Polling Rate**: ~60fps on SimHub data thread
- **Client Limit**: No hard limit; each client maintains its own state

## Message Format

All messages follow this MessagePack-serialized structure:

```csharp
{
  "t": string,     // Tag: "snapshot", "delta", "request", "response", "event"
  "v": uint8,      // Schema version (currently 1)
  "d": object      // Payload (varies by tag)
}
```

## Message Tags

### Snapshot (`t = "snapshot"`)

Full telemetry state. Sent:
- Once on client connection
- Every 5 seconds (resync floor to handle out-of-sync clients)

**Payload** (`d`):
```csharp
Dictionary<string, object> {
  "DataCorePlugin.GameRunning": 0 or 1,
  "DataCorePlugin.GameData.Rpms": double,
  "DataCorePlugin.GameData.Gear": string,
  ... (100+ keys matching HTTP JSON output)
}
```

**Example wire keys** (non-exhaustive):
- `DataCorePlugin.GameRunning` (int: 0|1)
- `DataCorePlugin.GameData.Rpms` (double)
- `DataCorePlugin.GameData.Gear` (string)
- `DataCorePlugin.GameData.SpeedMph` (double)
- `DataCorePlugin.GameData.Throttle` (double, 0–1)
- `DataCorePlugin.GameData.Brake` (double, 0–1)
- `DataCorePlugin.GameData.Clutch` (double, 0–1)
- `DataCorePlugin.GameData.Fuel` (double)
- `DataCorePlugin.GameData.TyreTempFrontLeft` (double, °C)
- `DataCorePlugin.GameData.Position` (int)
- `DataCorePlugin.GameData.CurrentLap` (int)
- `DataCorePlugin.GameData.BestLapTime` (double, seconds)
- `RaceCorProDrive.Plugin.CommentaryText` (string)
- `RaceCorProDrive.Plugin.CommentarySentimentColor` (string, hex)
- `RaceCorProDrive.Plugin.Strategy.Visible` (int: 0|1)
- ... (see Plugin.HttpServerLoop() for the authoritative list)

The set of wire keys **MUST match the HTTP JSON keys exactly**. This is the contract between the overlay and the plugin.

### Delta (`t = "delta"`)

Changed telemetry keys since last send to **this specific client**. Sent between snapshots if data has changed.

**Payload** (`d`):
```csharp
Dictionary<string, object> {
  "key_that_changed_1": new_value,
  "key_that_changed_2": new_value,
  ... (only keys with new values)
}
```

**Important**: Empty deltas (no changes) MUST NOT be sent. If all fields are identical to the last snapshot, no message is transmitted.

**Removed keys** are not represented in v1 deltas. If a key was in the snapshot but is not in the next delta, assume no change has occurred.

### Request (`t = "request"`)

Client → Server action request (e.g., adjust pit box settings).

**Payload** (`d`):
```csharp
{
  "id": string,              // Unique request ID
  "action": string,          // Action name (e.g., "setTC", "setPitFuel")
  "params": object           // Action parameters (key-value map)
}
```

**Status in PR 1**: Defined but not wired. Server ignores incoming requests. PR 3 will implement action handlers.

### Response (`t = "response"`)

Server → Client result for a request.

**Payload** (`d`):
```csharp
{
  "id": string,              // Mirrors request ID
  "ok": bool,                // Success flag
  "result": object,          // Optional result (if ok=true)
  "error": string            // Optional error message (if ok=false)
}
```

**Status in PR 1**: Defined but not generated. PR 3 will wire responses.

### Event (`t = "event"`)

Server → Client notification (e.g., session ended, incident).

**Payload** (`d`):
```csharp
{
  "name": string,            // Event name (e.g., "sessionEnded", "incidentOccurred")
  "payload": object          // Event data (key-value map)
}
```

**Status in PR 1**: Defined but not generated. PR 3 will wire events.

## Server Behavior

1. **On client connect** (WebSocket handshake completes):
   - Server registers the client in its connection pool.
   - Next `Tick()` call sends a full snapshot envelope.

2. **On every plugin tick** (SimHub DataUpdate, ~60fps):
   - Call `WsTelemetryPublisher.Tick(currentDict)`.
   - For each connected client:
     - If `now - lastFullSent >= 5s`: send full snapshot, update `lastFullSent = now`.
     - Else: compute delta (keys where value != lastSent[key]). If delta is non-empty, send it. If empty, send nothing.
   - Per-client state (lastSent, lastFullSent) is locked for thread safety.

3. **On client disconnect**:
   - Server removes the client from its pool.
   - Per-client state is freed.

## Wire Format Notes

- **Byte order**: MessagePack (platform-neutral).
- **Strings**: UTF-8 encoded within MessagePack.
- **Numbers**: IEEE 754 double (floating-point) or signed integer.
- **Serializer**: .NET MessagePack 2.5.187 (on server) / equivalent (on client).

## Per-Client Isolation

Each client maintains independent state:
- `lastSent`: The last snapshot/delta values sent to this client.
- `lastFullSent`: Timestamp of the last snapshot sent.

Mutations to one client's state do not affect other clients. This allows slow clients to "catch up" with a 5-second resync even if fast clients are receiving deltas continuously.

## Schema Versioning

The `v` field is currently `1`. If the wire format changes in a future PR (e.g., new required fields, removal of deprecated keys), increment `v`. Client-side implementation should:
- Accept and process `v=1` snapshots/deltas.
- Log a warning if `v != 1`.
- In PR 2, decide whether to reject, downgrade-parse, or handle version mismatches.

## Roadmap

- **PR 1** (current): Snapshot + Delta messages, WebSocket server on port 8890.
- **PR 2**: Overlay WebSocket client, MessagePack deserialization, rendering parity with HTTP.
- **PR 3**: Request/Response messages; pit box actions wired.
- **PR 4**: Event messages; session lifecycle notifications.
- **PR 5**: Retire HTTP server; move WebSocket to port 8889.

## Compatibility

- **Target .NET**: Plugin targets net48 (Windows). Uses Fleck 1.2.0 (pure-managed).
- **Overlay** (Electron): Will use a JavaScript WebSocket library + a MessagePack deserializer (e.g., msgpackr).
- **Breaking changes**: None expected within v1. The HTTP output and WebSocket output must remain wire-compatible.

## References

- Plugin code: `racecor-plugin/simhub-plugin/plugin/RaceCorProDrive.Plugin/Transport/`
- Tests: `racecor-plugin/simhub-plugin/tests/RaceCorProDrive.Tests/Transport/`
- MessagePack spec: https://msgpack.org/
