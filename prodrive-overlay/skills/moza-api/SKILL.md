---
name: moza-api
description: Moza hardware UI and API consumption for the RaceCor overlay. Use this skill when building, modifying, or debugging the overlay's Moza hardware panels — settings display, pedal curve visualization, wheelbase FFB controls, handbrake calibration, shifter config, dashboard settings, or device connection status. Trigger on any mention of Moza UI in the overlay, Moza settings panel, hardware settings visualization, device management screen, or consuming the Moza HTTP endpoints from the overlay. Also trigger when working on pedal-curves.js Moza features, Moza settings in dashboard.html, or any new Moza-related overlay module.
---

# Moza Hardware API — Overlay Consumer Skill

This skill covers how the Electron overlay consumes Moza hardware data from the SimHub plugin's HTTP API on port 8889. It's the consumer side of the Moza direct hardware integration.

For the protocol and hardware side (the producer), see `racecor-plugin/skills/moza-hardware/SKILL.md`.

## Context: What Exists vs. What We're Building

### Current State

The overlay already has Moza-related UI in `modules/js/pedal-curves.js` and `dashboard.html`:
- Pedal curve visualization (240×80px canvas on HUD, 200×200px in settings)
- Profile selection dropdown
- "Import from Moza" button (calls `importMozaPedals` action on the plugin)
- Moza detection status display
- Debug panel with raw JSON dump

This existing UI reads from the plugin's `PedalProfileManager`, which depends on Pit House files.

### Target State

The overlay gains a comprehensive **Moza Hardware Settings** panel that:
- Shows real-time connection status for all Moza devices
- Displays and edits wheelbase FFB settings (strength, rotation, damping, EQ)
- Displays and edits pedal calibration and response curves
- Displays and edits handbrake configuration
- Shows shifter and dashboard settings
- Shows steering wheel RGB configuration
- All powered by direct hardware reads/writes through the plugin's new Moza serial API — no Pit House

## Architecture

```
Plugin (MozaSerialManager)
  → HTTP API port 8889
    → Main poll: MozaConnected, MozaDeviceCount, key settings summary
    → Action endpoints: listMozaDevices, get/set per-device settings
  → Overlay polls at ~30fps (existing fetchProps pattern)
    → New moza-settings.js module subscribes to Moza properties
    → Settings panel renders current hardware state
    → User changes trigger action fetches to write settings
```

### Data Flow

The overlay follows its established polling pattern (no WebSocket, no push). Moza data arrives two ways:

1. **Main poll response** — every ~33ms, the poll includes summary fields:
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

2. **On-demand action fetches** — when the user opens settings or changes a value:
   ```
   GET http://localhost:8889/racecor-io-pro-drive/?action=getMozaWheelbaseSettings
   GET http://localhost:8889/racecor-io-pro-drive/?action=setMozaWheelbaseSetting&key=ffbStrength&value=90
   ```

## Implementation Guidance

### File Organization

Follow the overlay's module pattern — no build step, vanilla JS, direct HTML imports:

```
modules/
├── js/
│   ├── pedal-curves.js          (existing — extend with direct hardware data)
│   ├── moza-settings.js         (NEW — main Moza settings panel logic)
│   ├── moza-device-status.js    (NEW — device connection status indicators)
│   └── moza-wheelbase.js        (NEW — wheelbase FFB controls if complex enough)
├── styles/
│   ├── settings.css             (existing — extend with Moza hardware styles)
│   └── moza-settings.css        (NEW — if Moza styles grow beyond a few rules)
├── components/
│   └── moza-curve-editor.js     (NEW — reusable 5-point curve editor widget)
```

### Module Pattern

Every new module follows the overlay's subscription pattern:

```javascript
// modules/js/moza-settings.js

// Called by fetchProps() on every poll cycle
export function updateMozaSettings(p) {
    // p contains all poll properties including Moza* fields
    if (!p.MozaConnected) {
        showMozaDisconnectedState();
        return;
    }
    
    updateDeviceStatusIndicators(p);
    updateWheelbaseSummary(p);
    // Don't fetch full device settings on every poll —
    // only when the settings panel is open
}

// Called when user opens the Moza settings tab
export async function loadMozaDeviceSettings() {
    const devices = await fetchAction('listMozaDevices');
    const wheelbase = await fetchAction('getMozaWheelbaseSettings');
    const pedals = await fetchAction('getMozaPedalSettings');
    // ... render full settings
}

// Called when user changes a setting
export async function setMozaSetting(device, key, value) {
    const action = `setMoza${device}Setting`;
    const result = await fetchAction(action, { key, value });
    // Optimistically update UI, confirm on next poll
}
```

### Action Fetch Helper

Use the overlay's existing HTTP fetch pattern:

```javascript
async function fetchAction(action, params = {}) {
    const url = new URL('http://localhost:8889/racecor-io-pro-drive/');
    url.searchParams.set('action', action);
    for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
    }
    const res = await fetch(url);
    return res.json();
}
```

### API Endpoints to Consume

These are exposed by the plugin's `MozaSerialManager` (see plugin skill for details):

| Action | Purpose | When to Call |
|--------|---------|--------------|
| `listMozaDevices` | Get all connected devices with type and port | On settings panel open |
| `getMozaWheelbaseSettings` | Full wheelbase config (FFB, rotation, EQ) | On wheelbase tab open |
| `setMozaWheelbaseSetting` | Write a single wheelbase setting | On user slider/input change |
| `getMozaPedalSettings` | Full pedal config (curves, deadzones, calibration) | On pedals tab open |
| `setMozaPedalSetting` | Write a single pedal setting | On user curve/input change |
| `getMozaHandbrakeSettings` | Handbrake calibration and curves | On handbrake tab open |
| `setMozaHandbrakeSetting` | Write handbrake setting | On user change |
| `getMozaShifterSettings` | Shifter direction and mode | On shifter tab open |
| `getMozaDashboardSettings` | Dashboard display config | On dashboard tab open |
| `getMozaWheelSettings` | Steering wheel RGB and buttons | On wheel tab open |
| `mozaRefresh` | Force re-poll all settings from hardware | Manual refresh button |
| `mozaReconnect` | Re-run device discovery | When user clicks reconnect |

### Settings Panel Structure

Add a new settings tab in `dashboard.html` alongside the existing tabs:

```html
<div class="settings-tab-content" id="settingsTabMozaHardware">
    <!-- Connection Status Bar -->
    <div class="moza-connection-bar">
        <span class="moza-status-dot" id="mozaGlobalStatus"></span>
        <span id="mozaDeviceCountLabel">No devices</span>
        <button class="settings-btn" onclick="mozaReconnect()">Reconnect</button>
        <button class="settings-btn" onclick="mozaRefresh()">Refresh</button>
    </div>

    <!-- Device-specific panels, shown/hidden based on connection -->
    
    <!-- Wheelbase -->
    <div class="moza-device-panel" id="mozaWheelbasePanel" style="display:none">
        <div class="settings-group-label">Wheelbase — <span id="mozaWheelbaseModel">—</span></div>
        <!-- FFB Strength slider -->
        <!-- Rotation Range slider -->
        <!-- Damping controls -->
        <!-- EQ bands -->
    </div>

    <!-- Pedals -->
    <div class="moza-device-panel" id="mozaPedalsPanel" style="display:none">
        <div class="settings-group-label">Pedals</div>
        <!-- Throttle curve editor -->
        <!-- Brake curve editor -->
        <!-- Clutch curve editor -->
        <!-- Deadzone inputs -->
    </div>

    <!-- Handbrake -->
    <div class="moza-device-panel" id="mozaHandbrakePanel" style="display:none">
        <div class="settings-group-label">Handbrake</div>
        <!-- Curve editor -->
        <!-- Button threshold -->
        <!-- Output mode selector -->
    </div>

    <!-- Shifter -->
    <div class="moza-device-panel" id="mozaShifterPanel" style="display:none">
        <div class="settings-group-label">Shifter</div>
        <!-- Direction toggle -->
        <!-- HID mode selector -->
    </div>

    <!-- Dashboard -->
    <div class="moza-device-panel" id="mozaDashboardPanel" style="display:none">
        <div class="settings-group-label">Dashboard</div>
        <!-- RPM display mode -->
        <!-- Brightness -->
    </div>
</div>
```

### UI Components

#### Slider Control (for FFB, rotation, brightness, etc.)

Reuse the overlay's existing settings UI patterns — `<input type="range">` with a numeric readout:

```javascript
function createMozaSlider(label, key, device, min, max, currentValue) {
    // Returns a .settings-row div with:
    // - Label span
    // - Range input (min, max, value)
    // - Numeric display span
    // - onChange: debounced call to setMozaSetting(device, key, newValue)
}
```

Debounce slider changes (200ms) to avoid flooding the serial port with writes while the user drags.

#### 5-Point Curve Editor

For pedal and handbrake response curves. The existing `pedal-curves.js` renders curves as Canvas paths — extend this into a reusable interactive editor:

```javascript
// modules/components/moza-curve-editor.js
export class MozaCurveEditor {
    constructor(canvas, { axis, onCurveChange }) {
        // 200×200 canvas
        // 5 draggable control points at 20%, 40%, 60%, 80%, 100% input
        // Linear interpolation between points
        // Grid background showing input/output percentages
        // onCurveChange callback fires with [y1, y2, y3, y4, y5] array
    }
    
    setCurve(points) { /* Set from hardware read */ }
    getCurve() { /* Return current [y1..y5] */ }
}
```

The hardware uses a 5-point curve (Y values at 20/40/60/80/100% input). The existing 21-point display format can show more detail, but edits should write back the 5-point format the hardware understands.

#### Device Status Indicator

Small colored dots showing connection state per device:

```css
.moza-status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
    margin-right: 6px;
}
.moza-status-dot.connected { background: #22c55e; }
.moza-status-dot.disconnected { background: #6b7280; }
.moza-status-dot.error { background: #ef4444; }
```

### Integration with Existing Pedal Curves

The existing `pedal-curves.js` should detect when direct Moza hardware data is available and prefer it over Pit House file imports:

```javascript
export function updatePedalCurves(p) {
    if (p.MozaConnected && p.MozaPedalsConnected) {
        // Direct hardware curves — more accurate, real-time
        renderCurvesFromHardware(p);
    } else if (p.RaceCorProDrive?.Plugin?.DS?.PedalProfile) {
        // Fall back to existing Pit House file-based profiles
        renderCurvesFromProfile(p);
    }
}
```

### HUD Integration

On the main HUD (not settings), show a minimal Moza status indicator:
- Small icon or dot showing Moza connection state
- Current wheelbase FFB strength as a number (if space permits)
- These come from the main poll response — no extra fetches needed

### Performance Considerations

1. **Don't fetch full device settings on every poll** — the main poll includes summary fields (MozaConnected, FFBStrength, etc.) which are enough for the HUD. Full settings reads only happen when the user opens the settings panel.

2. **Debounce user input** — slider drags and curve point edits should debounce at 200ms before sending write commands to the plugin.

3. **Optimistic UI** — update the UI immediately on user input, then confirm/correct from the next poll cycle. This prevents the 2-second polling lag from feeling sluggish.

4. **Conditional rendering** — hide device panels entirely when that device isn't connected. Don't render empty/placeholder states for every possible device.

### CSS Conventions

Follow the overlay's existing style patterns in `modules/styles/settings.css`:
- Use `.settings-group-label` for section headers
- Use `.settings-row` for label+control pairs
- Use `.settings-btn` for action buttons
- Use CSS custom properties from the design system where applicable
- Keep new Moza styles in the existing `settings.css` unless they exceed ~50 rules, then split to `moza-settings.css`

### Testing

Add Playwright tests for:
- Moza settings panel renders when MozaConnected is true in demo data
- Device panels show/hide based on per-device connection flags
- Slider changes trigger appropriate action fetches (mock the HTTP endpoint)
- Curve editor renders correctly with sample curve data
- Graceful degradation when MozaConnected is false

Tests go in `tests/` following existing Playwright patterns.

## Relationship to Other Projects

- **Plugin** (`racecor-plugin/skills/moza-hardware/`): The producer. Implements `MozaSerialManager` and exposes the HTTP endpoints this overlay consumes. Any new endpoint must be added there first.
- **Existing pedal UI** (`modules/js/pedal-curves.js`): Extend, don't replace. Add hardware-direct mode alongside the existing Pit House file-based mode.
- **Design system** (`web/src/lib/tokens/`): Use design tokens for colors, spacing, and typography in new Moza UI. Don't hardcode values that exist as CSS custom properties.
