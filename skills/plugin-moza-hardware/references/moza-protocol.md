# Moza Serial Protocol — Complete Reference

Source: Reverse-engineered by the [Boxflat](https://github.com/Lawstorant/boxflat) project (GPL-3.0).
Boxflat repo: `https://github.com/Lawstorant/boxflat`
Key source files: `serial_handler.py`, `moza_command.py`, `connection_manager.py`, `hid_handler.py`, `data/serial.yml`

## Table of Contents

1. [Packet Format](#packet-format)
2. [Checksum Calculation](#checksum-calculation)
3. [Response Format](#response-format)
4. [Multi-Command Batching](#multi-command-batching)
5. [Device IDs](#device-ids)
6. [Device Discovery](#device-discovery)
7. [Serial Connection Parameters](#serial-connection-parameters)
8. [Connection Lifecycle](#connection-lifecycle)
9. [Command Registry: Wheelbase](#command-registry-wheelbase)
10. [Command Registry: Pedals](#command-registry-pedals)
11. [Command Registry: Handbrake](#command-registry-handbrake)
12. [Command Registry: Shifter](#command-registry-shifter)
13. [Command Registry: Dashboard](#command-registry-dashboard)
14. [Command Registry: Steering Wheel](#command-registry-steering-wheel)
15. [Command Registry: Universal Hub](#command-registry-universal-hub)
16. [HID Axis Mapping](#hid-axis-mapping)
17. [Preset File Format](#preset-file-format)
18. [Known Limitations](#known-limitations)

---

## Packet Format

Every serial message uses this fixed frame structure:

```
┌──────────┬────────┬───────┬───────────┬────────────┬─────────┬──────────┐
│ Start    │ Length │ Group │ Device ID │ Command ID │ Payload │ Checksum │
│ 1 byte   │ 1 byte │ 1 byte│ 1 byte    │ 1+ bytes   │ 0+ bytes│ 1 byte   │
│ 0x7E     │ 2-11   │       │           │            │         │          │
└──────────┴────────┴───────┴───────────┴────────────┴─────────┴──────────┘
```

### Field Details

**Start byte**: Always `0x7E` (126 decimal). Marks the beginning of every packet.

**Length**: Number of bytes from Group through Payload (inclusive). Valid range: 2–11. Does NOT include Start, Length, or Checksum bytes.

**Group**: Request type.
- `0x21` = Read (query a setting value)
- `0x22` = Write (change a setting value)

**Device ID**: Target device. See [Device IDs](#device-ids).

**Command ID**: Which setting to access. Can be a single byte or a multi-byte array depending on the command. See command registries below.

**Payload**: For write commands, the value to set. For read commands, this field is absent. All multi-byte values are **big-endian**.

**Checksum**: `(sum_of_all_bytes_in_packet + 13) % 256`. See [Checksum Calculation](#checksum-calculation).

---

## Checksum Calculation

```
MAGIC_CONSTANT = 13  (0x0D)

checksum = MAGIC_CONSTANT
for each byte in [start, length, group, device_id, command_id..., payload...]:
    checksum += byte
checksum = checksum % 256
```

The magic constant 13 is derived from USB endpoint data (endpoint 0x02, transfer type 0x03, message length 0x08: 2 + 3 + 8 = 13). This value is **critical** — an incorrect checksum causes the device to silently ignore the entire packet. No error response is sent.

### Example: Read wheelbase FFB strength

```
Packet: 7E 04 21 13 14
        Start=7E, Length=04, Group=21(read), Device=13(wheelbase), Cmd=14(ffb_strength)

Checksum: (13 + 0x7E + 0x04 + 0x21 + 0x13 + 0x14) % 256
        = (13 + 126 + 4 + 33 + 19 + 20) % 256
        = 215 % 256
        = 215
        = 0xD7

Full packet: 7E 04 21 13 14 D7
```

---

## Response Format

Responses echo the request structure with two transformations:

1. **Group byte**: Original group + `0x80`
   - Read request `0x21` → response `0xA1`
   - Write request `0x22` → response `0xA2`

2. **Device ID**: Nibbles swapped (upper and lower 4 bits exchanged)
   - `0x13` (wheelbase) → response shows `0x31`
   - `0x19` (pedals) → response shows `0x91`
   - `0x1A` (shifter) → response shows `0xA1`
   - `0x1B` (handbrake) → response shows `0xB1`

### Example: Response to FFB strength read

```
Request:  7E 04 21 13 14 D7
Response: 7E 05 A1 31 14 64 [checksum]
          Start=7E, Length=05, Group=A1(read_response), Device=31(swapped 13), Cmd=14, Value=64(100%)
```

### Response Matching

Match responses to pending requests using:
- `(response_group - 0x80) == request_group`
- `swap_nibbles(response_device_id) == request_device_id`
- `response_command_id == request_command_id`

---

## Multi-Command Batching

Multiple commands can be sent in a single packet. The device processes them in order and returns all responses concatenated in a single response frame.

```
Request:  7E 08 21 13 14 21 13 15 [checksum]
          (Read FFB strength AND read max torque from wheelbase)

Response: 7E 0A A1 31 14 64 31 15 C8 [checksum]
          (FFB=100(0x64), MaxTorque=200(0xC8))
```

There is no explicit message ID — ordering is implicit. Commands are processed and responded to in the order they appear in the packet.

---

## Device IDs

### Racing Hardware Only

| Device | Decimal | Hex | Notes |
|--------|---------|-----|-------|
| Universal Hub / Main | 18 | 0x12 | Central hub, connection status |
| Wheelbase | 19 | 0x13 | R5, R9, R12, R16, R21 models |
| Dashboard | 20 | 0x14 | RPM display, indicators |
| Steering Wheel (primary) | 21 | 0x15 | Buttons, paddles |
| Steering Wheel (extended) | 23 | 0x17 | RGB, telemetry display |
| Pedals | 25 | 0x19 | SRP, SR-P, CRP series |
| Shifter | 26 | 0x1A | Both H-pattern (HGP) and Sequential (SGP) |
| Handbrake | 27 | 0x1B | HBP series |
| E-Stop | 28 | 0x1C | Emergency stop (rarely used directly) |

---

## Device Discovery

### USB Device Detection

Moza devices enumerate as CDC ACM serial ports with identifiable USB descriptors.

**Manufacturer string**: Contains "Gudsen"

**Product string patterns** (regex, case-insensitive):

| Device | Pattern |
|--------|---------|
| Wheelbase | `gudsen (moza )?r[0-9]{1,2} (ultra base\|base\|racing wheel and pedals)` |
| Pedals | `gudsen moza (srp\|sr-p\|crp)[0-9]? pedals` |
| H-Pattern Shifter | `hgp shifter` |
| Sequential Shifter | `sgp shifter` |
| Handbrake | `hbp handbrake` |
| Universal Hub | `gudsen universal hub` |
| Multi-Function Stalk | `moza multi-function stalk` |

### Windows-Specific Discovery

On Windows, enumerate USB serial devices via:

```
WMI: SELECT * FROM Win32_PnPEntity WHERE Name LIKE '%COM%'
     Filter by Manufacturer containing "Gudsen" or Description matching patterns above

Registry: HKLM\SYSTEM\CurrentControlSet\Enum\USB
          Look for VID/PID matching Gudsen devices

SerialPort.GetPortNames() for enumeration, then WMI for classification
```

### Linux Discovery (Boxflat approach)

Scans `/dev/serial/by-id/` for symlinks matching device patterns, resolving to `/dev/ttyACM*`.

---

## Serial Connection Parameters

| Parameter | Value |
|-----------|-------|
| Baud Rate | 115200 |
| Data Bits | 8 |
| Stop Bits | 1 |
| Parity | None |
| Read Timeout | 500ms |
| Write Timeout | 500ms |
| Flow Control | None |

### Connection Behavior

- Clear input/output buffers on successful connection
- Retry connection every 200ms if port unavailable
- Detect disconnection on failed read/write operations
- Only one application can hold a serial port at a time (Pit House conflict)

---

## Connection Lifecycle

### Startup

1. Enumerate serial ports and classify connected Moza devices
2. Open serial connections to discovered devices
3. Spawn dedicated read and write threads per device
4. Send initial read commands to populate settings cache
5. Begin 2-second polling cycle for ongoing state queries

### Polling

- Every 2 seconds, send read commands for registered settings
- Parse responses and update cached device state
- Notify subscribers of changed values

### Disconnection

- Detected on serial read/write failure (IOException, TimeoutException)
- Stop read/write threads for affected device
- Remove device from active registry
- Continue operating with remaining devices
- Attempt reconnection on next discovery scan

### Reconnection

- Periodically (every 5–10 seconds) re-scan for new serial ports
- Connect to newly discovered devices
- Re-initialize settings cache

---

## Command Registry: Wheelbase

Device ID: 19 (0x13)

Each command specifies: Command ID, Read Group, Write Group, Payload Size, Data Type

### Force Feedback

| Setting | Cmd ID | R/W | Payload | Type | Range | Notes |
|---------|--------|-----|---------|------|-------|-------|
| FFB Strength | 0x14 | R/W | 1 byte | int | 0–100 | Percentage of max force |
| Max Torque | 0x15 | R/W | 1 byte | int | 0–100+ | Model-dependent maximum |
| Road Sensitivity | 0x16 | R/W | 1 byte | int | 0–100 | Surface detail intensity |
| Speed Damping | 0x17 | R/W | 1 byte | int | 0–100 | Speed-dependent damping |

### Rotation

| Setting | Cmd ID | R/W | Payload | Type | Range | Notes |
|---------|--------|-----|---------|------|-------|-------|
| Min Rotation Angle | 0x18 | R/W | 2 bytes | int | -1800–0 | Left limit in degrees |
| Max Rotation Angle | 0x19 | R/W | 2 bytes | int | 0–1800 | Right limit in degrees |
| Soft Lock | 0x1A | R/W | 1 byte | int | 0/1 | Enable software rotation stop |

### Damping & Feel

| Setting | Cmd ID | R/W | Payload | Type | Range | Notes |
|---------|--------|-----|---------|------|-------|-------|
| Friction | 0x1B | R/W | 1 byte | int | 0–100 | Constant friction force |
| Spring | 0x1C | R/W | 1 byte | int | 0–100 | Center spring strength |
| Damper | 0x1D | R/W | 1 byte | int | 0–100 | Velocity-based resistance |
| Inertia | 0x1E | R/W | 1 byte | int | 0–100 | Mass simulation weight |

### EQ (6-band Equalizer)

| Setting | Cmd ID | R/W | Payload | Type | Range | Notes |
|---------|--------|-----|---------|------|-------|-------|
| EQ Band 1–6 | 0x20–0x25 | R/W | 1 byte | int | 0–200 | Center=100 |

### Protection

| Setting | Cmd ID | R/W | Payload | Type | Range | Notes |
|---------|--------|-----|---------|------|-------|-------|
| Temp Protection | 0x30 | R/W | 1 byte | int | 0/1 | Enable thermal cutoff |
| Hands-Off Protection | 0x31 | R/W | 1 byte | int | 0/1 | Reduce FFB when hands detected off |

> **Note**: Exact command IDs above are illustrative. Consult the `serial.yml` file from Boxflat (`https://github.com/Lawstorant/boxflat/blob/main/data/serial.yml`) for the authoritative command ID mapping. The structure and field types are accurate; specific hex values may differ per firmware version.

---

## Command Registry: Pedals

Device ID: 25 (0x19)

### Per-Axis Settings (Throttle, Brake, Clutch)

Each axis has its own set of command IDs. The pattern repeats for throttle (T), brake (B), and clutch (C) with offset command IDs.

| Setting | R/W | Payload | Type | Range | Notes |
|---------|-----|---------|------|-------|-------|
| Calibration Min | R/W | 2 bytes | int | 0–65535 | Minimum raw ADC value |
| Calibration Max | R/W | 2 bytes | int | 0–65535 | Maximum raw ADC value |
| Deadzone | R/W | 1 byte | int | 0–100 | Percentage deadzone at bottom |
| Response Curve Y1 | R/W | 1 byte | int | 0–100 | Curve point at 20% input |
| Response Curve Y2 | R/W | 1 byte | int | 0–100 | Curve point at 40% input |
| Response Curve Y3 | R/W | 1 byte | int | 0–100 | Curve point at 60% input |
| Response Curve Y4 | R/W | 1 byte | int | 0–100 | Curve point at 80% input |
| Response Curve Y5 | R/W | 1 byte | int | 0–100 | Curve point at 100% input |
| HID Source | R/W | 1 byte | int | varies | Which axis this pedal maps to |

### Curve Format

The 5-point response curve defines output at fixed 20% input intervals:
- Input 0% → Output 0% (implicit, always 0)
- Input 20% → Output Y1%
- Input 40% → Output Y2%
- Input 60% → Output Y3%
- Input 80% → Output Y4%
- Input 100% → Output Y5%

Interpolate linearly between points. The existing `PedalProfile.cs` 21-point format can be downsampled to this 5-point format for hardware writes, or the 5-point hardware curves can be upsampled to 21 points for display.

---

## Command Registry: Handbrake

Device ID: 27 (0x1B)

| Setting | R/W | Payload | Type | Range | Notes |
|---------|-----|---------|------|-------|-------|
| Calibration Min | R/W | 2 bytes | int | 0–65535 | Minimum raw value |
| Calibration Max | R/W | 2 bytes | int | 0–65535 | Maximum raw value |
| Deadzone | R/W | 1 byte | int | 0–100 | Bottom deadzone % |
| Response Curve Y1–Y5 | R/W | 1 byte each | int | 0–100 | Same curve format as pedals |
| Button Threshold | R/W | 1 byte | int | 0–100 | Analog value that triggers button output |
| Output Mode | R/W | 1 byte | int | 0–2 | 0=analog, 1=button, 2=dual |

---

## Command Registry: Shifter

Device ID: 26 (0x1A)

Both H-pattern (HGP) and Sequential (SGP) shifters share device ID 26. Differentiate by USB descriptor string during discovery.

| Setting | R/W | Payload | Type | Range | Notes |
|---------|-----|---------|------|-------|-------|
| Direction | R/W | 1 byte | int | 0/1 | Swap shift direction |
| HID Mode | R/W | 1 byte | int | 0/1 | 0=joypad, 1=keyboard emulation |
| Brightness | R/W | 1 byte | int | 0–100 | LED brightness (SGP only) |

### H-Pattern Specific
| Setting | R/W | Payload | Type | Range | Notes |
|---------|-----|---------|------|-------|-------|
| Per-Gear Deadzone | R/W | 1 byte | int | 0–100 | Dead zone per gear position |

### Sequential Specific
| Setting | R/W | Payload | Type | Range | Notes |
|---------|-----|---------|------|-------|-------|
| Paddle Sync | R/W | 1 byte | int | 0/1 | Sync with wheel paddles |
| Shift Timing | R/W | 1 byte | int | varies | Response timing |

---

## Command Registry: Dashboard

Device ID: 20 (0x14)

| Setting | R/W | Payload | Type | Range | Notes |
|---------|-----|---------|------|-------|-------|
| RPM Display Mode | R/W | 1 byte | int | 0–2 | 0=analog, 1=LED bar, 2=digital |
| Brightness | R/W | 1 byte | int | 0–100 | Display brightness |
| Update Interval | R/W | 1 byte | int | varies | Refresh rate |
| Telemetry Enable | R/W | 1 byte | int | 0/1 | Enable data transmission |

### Indicator Colors

Dashboard indicator colors (shift light, fuel low, temp warning) are written as RGB arrays. Format is typically 3 bytes (R, G, B) per indicator.

---

## Command Registry: Steering Wheel

Device IDs: 21 (0x15) primary, 23 (0x17) extended

### Buttons & Paddles (ID 21)

| Setting | R/W | Payload | Type | Range | Notes |
|---------|-----|---------|------|-------|-------|
| Paddle Mode | R/W | 1 byte | int | varies | Paddle function assignment |
| Clutch Bite Point | R/W | 1 byte | int | 0–100 | Clutch engagement point % |
| Adaptive Paddles | R/W | 1 byte | int | 0/1 | Enable adaptive paddle response |

### RGB Lighting (ID 23)

| Setting | R/W | Payload | Type | Range | Notes |
|---------|-----|---------|------|-------|-------|
| RPM Zone Colors | **W only** | 3 bytes × N | array | 0–255 per channel | RGB per RPM zone |
| Button Colors | **W only** | 3 bytes × N | array | 0–255 per channel | RGB per button |
| Flag Colors | **W only** | 3 bytes × N | array | 0–255 per channel | Racing flag indicator colors |
| Idle Animation | R/W | 1 byte | int | varies | Animation mode when idle |
| Brightness | R/W | 1 byte | int | 0–100 | Global LED brightness |
| Telemetry Mode | R/W | 1 byte | int | varies | What data the wheel display shows |

> **Important**: RGB color settings are WRITE-ONLY. The firmware does not support reading back color state. Cache the last-written values in your application.

---

## Command Registry: Universal Hub

Device ID: 18 (0x12)

| Setting | R/W | Payload | Type | Range | Notes |
|---------|-----|---------|------|-------|-------|
| Compatibility Mode | R/W | 1 byte | int | varies | BLE config / work mode |
| LED Status | R/W | 1 byte | int | 0/1 | Hub status LED on/off |
| Interpolation | R/W | 1 byte | int | varies | Polling rate smoothing |
| Spring Gain | R/W | 1 byte | int | 0–100 | Global spring gain |
| Damper Gain | R/W | 1 byte | int | 0–100 | Global damper gain |
| Inertia Gain | R/W | 1 byte | int | 0–100 | Global inertia gain |
| Friction Gain | R/W | 1 byte | int | 0–100 | Global friction gain |

---

## HID Axis Mapping

When Moza devices appear as HID game controllers, these are the standard axis assignments:

### Pedals
| Physical | HID Axis | Code |
|----------|----------|------|
| Throttle | ABS_RX | 0x03 |
| Brake | ABS_RY | 0x04 |
| Clutch | ABS_RZ | 0x05 |

### Wheelbase / Steering
| Physical | HID Axis | Code |
|----------|----------|------|
| Steering | ABS_X | 0x00 |
| Combined Paddles | ABS_Y | 0x01 |
| Left Paddle | ABS_RY | 0x04 |
| Right Paddle | ABS_RX | 0x03 |

### Handbrake
| Physical | HID Axis | Code |
|----------|----------|------|
| Handbrake (analog) | ABS_RUDDER | 0x07 |

---

## Preset File Format

Boxflat uses YAML presets for saving/loading complete device configurations. Our implementation should use JSON to match the existing plugin conventions, but the structure is equivalent:

```json
{
  "name": "Sprint Race Setup",
  "version": 1,
  "source": "racecor",
  "linkedProcess": "iRacingSim64DX11.exe",
  "timestamp": "2026-04-15T12:00:00Z",
  "base": {
    "ffbStrength": 85,
    "maxTorque": 100,
    "minAngle": -900,
    "maxAngle": 900,
    "friction": 15,
    "spring": 0,
    "damper": 30,
    "inertia": 20,
    "roadSensitivity": 50
  },
  "pedals": {
    "throttleMin": 0,
    "throttleMax": 65535,
    "throttleCurve": [20, 40, 60, 80, 100],
    "throttleDeadzone": 2,
    "brakeMin": 0,
    "brakeMax": 65535,
    "brakeCurve": [15, 35, 60, 85, 100],
    "brakeDeadzone": 3,
    "clutchMin": 0,
    "clutchMax": 65535,
    "clutchCurve": [20, 40, 60, 80, 100],
    "clutchDeadzone": 2
  },
  "handbrake": {
    "min": 0,
    "max": 65535,
    "curve": [20, 40, 60, 80, 100],
    "buttonThreshold": 50,
    "outputMode": 0,
    "deadzone": 2
  },
  "shifter": {
    "direction": 0,
    "hidMode": 0
  }
}
```

---

## Known Limitations

1. **Checksum magic constant (13)** is non-negotiable — reverse-engineered from USB endpoint data. Any change causes silent communication failure.

2. **Wheel LED colors are write-only** — firmware constraint. You must cache colors application-side.

3. **No firmware version query** — cannot read device firmware version. Classify devices by USB descriptor strings only.

4. **Settings validation is caller-side** — devices may silently ignore out-of-range values. No error response is sent for invalid payloads.

5. **Pit House serial port conflict** — only one application can hold a CDC ACM port. If Pit House is running, the plugin cannot connect. Detect this condition (serial port open failure) and surface a clear warning to the user.

6. **Multi-byte values are big-endian** — on Windows/.NET, `BitConverter` uses little-endian. Reverse byte arrays manually when converting to/from multi-byte command payloads.

7. **2-second polling minimum** — Boxflat uses a 2-second polling cycle for settings. This is appropriate for configuration reads but not for real-time telemetry (which comes from SimHub, not from the serial protocol).

8. **Multiple same-type devices** — if two sets of pedals are connected, port enumeration order determines which is "primary". No robust multi-device addressing exists in the protocol.

9. **CDC ACM driver dependency** — Windows usually loads this automatically for Moza devices, but some systems may need the official Moza USB driver installed.

10. **Command IDs may vary by firmware** — the command registry above is based on Boxflat's `serial.yml` as of early 2026. Always cross-reference against the latest Boxflat source for updates. The packet format and checksum are stable; specific command IDs may shift with firmware updates.

---

## Authoritative Source

The single source of truth for command IDs and payload specifications is Boxflat's `data/serial.yml`:
`https://github.com/Lawstorant/boxflat/blob/main/data/serial.yml`

When implementing specific commands, fetch and parse this YAML file to get the exact command IDs, read/write group codes, payload sizes, and data types for each device setting.
