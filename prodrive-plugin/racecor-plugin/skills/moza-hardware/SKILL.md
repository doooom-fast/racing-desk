---
name: moza-hardware
description: Direct Moza racing hardware integration via serial protocol — no Pit House required. Use this skill whenever building, modifying, or debugging the Moza serial API in the SimHub plugin. Covers wheelbase, pedals, handbrake, sequential/H-pattern shifters, dashboard, steering wheel, and universal hub. Trigger on any mention of Moza hardware, Moza settings, FFB configuration, pedal curves, wheelbase parameters, direct hardware communication, serial protocol, or replacing Pit House dependency. Also use when working on device detection, the Moza HTTP endpoints, or the MozaSerialManager.
---

# Moza Racing Hardware — Direct Serial Integration

This skill contains everything needed to build and maintain a **direct serial API** to Moza racing hardware from the SimHub plugin, completely bypassing Pit House. The protocol knowledge comes from the [Boxflat](https://github.com/Lawstorant/boxflat) open-source project, which reverse-engineered the Moza serial protocol.

## Context: What Exists Today vs. What We're Building

### Current State (Pit House dependency)
The plugin currently manages Moza pedal profiles through `PedalProfileManager.cs`, which:
- Searches 8 filesystem paths for Pit House installation
- Reads/writes Moza config JSON files from `DeviceConfig/` directories
- Never talks to hardware directly — only to Pit House's saved files
- Breaks when Pit House isn't installed, paths change, or configs are stale

### Target State (Direct serial)
A `MozaSerialManager` (or similar) that:
- Discovers connected Moza devices by scanning serial ports
- Communicates directly over CDC ACM serial at 115200 baud
- Reads and writes all device settings in real-time
- Exposes Moza hardware state through the existing HTTP API on port 8889
- Works on any machine with Moza hardware connected — no Pit House needed

## Architecture

```
Moza USB Hardware (wheelbase, pedals, etc.)
  → CDC ACM virtual serial port (/dev/ttyACM* or COM*)
  → MozaSerialManager (new C# class in plugin)
    → MozaPacketBuilder (construct command packets)
    → MozaResponseParser (parse device responses)
    → MozaDeviceRegistry (device IDs, command definitions)
  → Integrated into Plugin.cs DataUpdate loop
  → HTTP API on port 8889 (existing, extended with Moza endpoints)
  → Overlay consumes via polling (existing pattern)
```

### Key Design Decisions

1. **Use System.IO.Ports.SerialPort** in C# — the .NET 4.8 equivalent of Python's pyserial
2. **Thread-safe command queue** — serial port access must be synchronized; use a dedicated read/write thread pair
3. **Polling-based reads** — query device state every 2 seconds (matches Boxflat's approach and is sufficient for settings; telemetry comes from SimHub)
4. **Graceful degradation** — if no Moza hardware is detected, the plugin continues normally; Moza features just report as unavailable
5. **Extend, don't replace** — keep PedalProfileManager for backward compatibility; MozaSerialManager is a parallel path that's preferred when hardware is present

## The Moza Serial Protocol

Read `references/moza-protocol.md` for the complete packet specification, device IDs, and command registry. Key points summarized here:

### Packet Format

Every message follows this fixed frame:

| Field | Bytes | Description |
|-------|-------|-------------|
| Start | 1 | Always `0x7E` |
| Length | 1 | Payload length (range 2–11) |
| Group | 1 | `0x21` = read, `0x22` = write |
| Device ID | 1 | Target device (see device table) |
| Command ID | 1+ | What setting to read/write |
| Payload | 0+ | Value to write (big-endian) |
| Checksum | 1 | `(sum_of_all_bytes + 13) % 256` |

The magic constant **13** in the checksum is critical and non-negotiable. Devices silently ignore packets with wrong checksums.

### Response Format

Responses mirror requests with two transforms:
- **Group byte**: adds `0x80` (read `0x21` → response `0xA1`)
- **Device ID**: nibbles swapped (e.g., `0x19` → `0x91`)

### Racing Device IDs

| Device | ID (decimal) | ID (hex) |
|--------|-------------|----------|
| Universal Hub / Main | 18 | 0x12 |
| Wheelbase (R5, R9, R12, R16, R21) | 19 | 0x13 |
| Dashboard | 20 | 0x14 |
| Steering Wheel | 21, 23 | 0x15, 0x17 |
| Pedals (SRP, CRP) | 25 | 0x19 |
| Shifter (H-pattern & Sequential) | 26 | 0x1A |
| Handbrake | 27 | 0x1B |
| E-Stop | 28 | 0x1C |

### Device Discovery

Moza devices appear as CDC ACM virtual serial ports. On Windows, they show as `COM*` ports. Discovery approach:

1. Enumerate serial ports via `SerialPort.GetPortNames()`
2. For each port, query WMI or registry for USB VID/PID and device description
3. Match against Moza patterns: manufacturer "Gudsen", product names matching `moza|gudsen` patterns
4. Classify device type from description string (see `references/moza-protocol.md` for regex patterns)
5. Open serial connection at 115200 baud

On Windows (our target), you can also use `System.Management.ManagementObjectSearcher` to query `Win32_PnPEntity` for USB device descriptions matching Moza patterns.

## Implementation Guidance

### File Organization

New files should go in the plugin's Engine directory alongside existing managers:

```
simhub-plugin/plugin/RaceCorProDrive.Plugin/Engine/
├── PedalProfileManager.cs          (existing — keep for backward compat)
├── PedalProfile.cs                 (existing)
├── Moza/
│   ├── MozaSerialManager.cs        (device discovery, lifecycle, polling)
│   ├── MozaPacketBuilder.cs        (packet construction, checksum)
│   ├── MozaResponseParser.cs       (response validation, value extraction)
│   ├── MozaDeviceRegistry.cs       (device IDs, command definitions)
│   ├── MozaDevice.cs               (per-device state, settings cache)
│   ├── MozaWheelbaseSettings.cs    (wheelbase-specific settings model)
│   ├── MozaPedalSettings.cs        (pedal-specific settings model)
│   ├── MozaHandbrakeSettings.cs    (handbrake settings model)
│   ├── MozaShifterSettings.cs      (shifter settings model)
│   ├── MozaDashboardSettings.cs    (dashboard settings model)
│   └── MozaWheelSettings.cs        (steering wheel / RGB settings model)
```

### Serial Communication Pattern (C#)

```csharp
// Core communication — use System.IO.Ports.SerialPort
// Baud: 115200, DataBits: 8, StopBits: One, Parity: None
// Timeout: 500ms read, 500ms write
// Use a dedicated background thread for read loop
// Use a ConcurrentQueue<byte[]> for outbound commands
// Protect port access with a SemaphoreSlim for exclusive operations
```

### Checksum Implementation

```csharp
public static byte CalculateChecksum(byte[] packet)
{
    const int MAGIC = 13; // 0x0D — derived from USB endpoint data, DO NOT CHANGE
    int sum = MAGIC;
    for (int i = 0; i < packet.Length; i++)
        sum += packet[i];
    return (byte)(sum % 256);
}
```

### Nibble Swap (for response device ID matching)

```csharp
public static byte SwapNibbles(byte b)
{
    return (byte)(((b & 0x0F) << 4) | ((b & 0xF0) >> 4));
}
```

### HTTP API Extensions

Add these endpoints to the existing HTTP server loop in `Plugin.cs`:

| Action | Params | Returns |
|--------|--------|---------|
| `listMozaDevices` | — | Array of connected devices with type, port, firmware status |
| `getMozaWheelbaseSettings` | — | Current wheelbase FFB, rotation, damping settings |
| `setMozaWheelbaseSetting` | `key=<setting>&value=<val>` | Writes setting directly to hardware |
| `getMozaPedalSettings` | — | Current pedal calibration, curves, deadzones |
| `setMozaPedalSetting` | `key=<setting>&value=<val>` | Writes pedal setting to hardware |
| `getMozaHandbrakeSettings` | — | Current handbrake calibration |
| `setMozaHandbrakeSetting` | `key=<setting>&value=<val>` | Writes handbrake setting |
| `getMozaShifterSettings` | — | Current shifter configuration |
| `getMozaDashboardSettings` | — | Current dashboard display config |
| `getMozaWheelSettings` | — | Steering wheel RGB, buttons, telemetry mode |
| `mozaRefresh` | — | Force re-poll all device settings |
| `mozaReconnect` | — | Re-run device discovery |

Additionally, include a summary in the main poll response:

```json
{
  "MozaConnected": true,
  "MozaDeviceCount": 3,
  "MozaWheelbaseConnected": true,
  "MozaPedalsConnected": true,
  "MozaHandbrakeConnected": false,
  "MozaWheelbaseFFBStrength": 85,
  "MozaWheelbaseRotationRange": 900,
  "MozaWheelbaseModel": "R9"
}
```

### Settings Per Device Type

Consult `references/moza-protocol.md` for the complete command registry. The key settings by device:

**Wheelbase (ID 19)**: FFB strength, max torque, rotation range (min/max angle), friction, spring, damper, inertia, EQ (6-band), temperature monitoring, speed-dependent damping, road sensitivity, protection settings

**Pedals (ID 25)**: Per-axis (throttle/brake/clutch) calibration min/max, 5-point response curves (Y1-Y5), deadzone, HID source mapping

**Handbrake (ID 27)**: Calibration min/max, 5-point response curve, button threshold, output mode (analog/button/dual), deadzone

**Shifter (ID 26)**: Direction mapping, gear dead zones, HID mode (joypad/keyboard), shift response timing

**Dashboard (ID 20)**: RPM display mode, indicator colors, brightness, timing intervals, telemetry enable/disable

**Steering Wheel (ID 21/23)**: RGB lighting (RPM zones, button colors, flag colors, idle animation), brightness, telemetry mode, paddle configuration, clutch bite point

**Universal Hub (ID 18)**: Compatibility mode, LED status, interpolation (polling rate smoothing), per-port connection status

### Testing Strategy

1. **Unit test packet building** — verify checksum calculation, packet assembly, and response parsing against known Boxflat examples
2. **Unit test nibble swap** — edge cases: 0x00, 0xFF, 0x19→0x91, 0x25→0x52
3. **Mock serial port** — create an `IMozaTransport` interface so tests can inject a mock serial stream
4. **Integration test with real hardware** — manual test checklist (cannot run in CI)
5. **Test graceful degradation** — ensure plugin works normally when no Moza hardware present

Add NUnit tests in the existing test project structure.

### Known Gotchas

1. **Checksum magic 13 is non-negotiable** — changing it silently breaks all communication
2. **Wheel LED colors are write-only** — firmware doesn't support reading back color state; cache last-written values
3. **CDC ACM driver required** — on Windows this is usually automatic, but some installs may need the Moza USB driver
4. **Multiple devices on same hub** — device detection relies on port enumeration order; handle gracefully
5. **No firmware version query** — cannot read firmware version from devices; classify by USB descriptor strings only
6. **Multi-byte values are big-endian** — C# `BitConverter` is little-endian on Windows; reverse bytes manually
7. **Settings validation is caller's responsibility** — devices may silently ignore out-of-range values
8. **Pit House conflict** — if Pit House is running and has the serial port open, the plugin can't connect; detect and warn

## Relationship to Other Projects

- **Overlay** (`racecor-overlay/`): Consumes Moza data through the HTTP API poll. See the overlay's `moza-api` skill for how to build the UI.
- **PedalProfileManager**: Continues to work for file-based import/export. The new MozaSerialManager supplements it with live hardware access. When both are available, prefer direct hardware reads.
- **Homebridge Plugin**: Could eventually consume Moza RGB state for light mapping, but that's a future extension.

## Reference

For the complete protocol specification, command registry, device detection patterns, and packet examples, read:
- `references/moza-protocol.md` — Full protocol spec with every command ID and payload format
