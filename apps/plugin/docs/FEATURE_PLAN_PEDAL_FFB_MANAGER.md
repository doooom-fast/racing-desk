# Feature Plan: Pedal & FFB Setup Manager

**Status:** Planning  
**Date:** 2026-04-15  
**Scope:** Plugin (C#), Overlay (JS), Car Data (JSON)  
**Feature name (working):** "Setup Manager" or "Feel Manager"

---

## Overview

A unified system for managing pedal curves and wheelbase FFB settings per car, with intelligent defaults, progressive disclosure, and an in-race strategist that suggests adjustments. Replaces the current Pit House file-dependent workflow with a self-contained, hardware-aware experience.

### Design Principles

1. **Beautiful by default** — the first screen is a clean, glanceable curve visualization with the active car name. No clutter.
2. **Progressive disclosure** — basic controls (FFB strength, brake curve shape preset) are always visible. Advanced controls (per-point curve editing, EQ bands, gamma) are one tap deeper.
3. **Car-aware from session load** — the moment iRacing loads a car, the plugin looks up the binding, applies the profile, and pushes to hardware. Zero user action required.
4. **Smart when empty** — when a driver enters a car with no saved profile, the system generates a sensible default from a deterministic car-class heuristic table, applies it, and labels it "Suggested."
5. **Race-aware coaching** — the strategist watches ABS/TC activations, pedal aggression, and lap trends, then surfaces one-line coaching suggestions via a toast the driver can accept or dismiss with a single tap.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  PLUGIN (C# .NET 4.8)                                              │
│                                                                     │
│  CarSetupManager (NEW — replaces PedalProfileManager scope)        │
│    ├─ CarSetupProfile (pedal curves + FFB settings per car)        │
│    ├─ CarClassHeuristics (deterministic suggestion engine)          │
│    ├─ CarClassDatabase (JSON lookup: car_id → class, ABS, etc.)    │
│    └─ MozaSerialManager (direct hardware writes — future)          │
│                                                                     │
│  PedalStrategist (NEW — plugs into StrategyCoordinator)            │
│    ├─ Monitors ABS/TC activations, pedal input patterns            │
│    ├─ Detects lockups, wheelspin, over-braking trends              │
│    └─ Emits StrategyCall suggestions with accept/dismiss actions   │
│                                                                     │
│  HTTP API (port 8889, extended)                                     │
│    ├─ Existing: listPedalProfiles, setPedalProfile, etc.           │
│    └─ New: getCarSetup, setCarSetup, suggestCarSetup,              │
│           acceptStrategySuggestion, listCarClasses                  │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ HTTP poll + action fetches
┌──────────────────────────▼──────────────────────────────────────────┐
│  OVERLAY (Electron, vanilla JS)                                     │
│                                                                     │
│  Setup Manager Panel (NEW settings tab)                             │
│    ├─ Level 0: Glanceable — car name, curve preview, "Suggested" tag│
│    ├─ Level 1: Quick — FFB strength, brake/throttle shape presets   │
│    ├─ Level 2: Custom — interactive curve editor, per-point drag    │
│    └─ Level 3: Expert — EQ bands, gamma, sensitivity, raw values   │
│                                                                     │
│  Strategy Toast (extends existing toast system)                     │
│    ├─ Suggestion text + severity color                              │
│    ├─ "Apply" button (one-tap accept)                               │
│    └─ Auto-dismiss after 10s                                        │
│                                                                     │
│  HUD Integration                                                    │
│    ├─ Existing curve overlay on pedal histogram (enhanced)          │
│    └─ Tiny "suggested" badge when running on defaults               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Data Model & Profile System (Plugin)

### 1.1 CarSetupProfile — The New Data Model

Extends the existing `PedalProfile` to include wheelbase settings. This is the single unit of "feel" that gets saved and loaded per car.

**File:** `Engine/CarSetupProfile.cs` (new, replaces/extends PedalProfile)

```
CarSetupProfile
├── Id (GUID)
├── Name (string)
├── CarModel (string — iRacing car model ID)
├── CarName (string — display name)
├── Source ("manual" | "suggested" | "moza" | "accepted-suggestion")
├── LastModified (DateTime)
├── CreatedAt (DateTime)
├── SuggestionConfidence (0-1, only if Source == "suggested")
│
├── Pedals
│   ├── Throttle
│   │   ├── Deadzone (0-1)
│   │   ├── Gamma (double, 1.0 = linear)
│   │   ├── Sensitivity (0-1, max output cap)
│   │   └── CurvePoints (List<double[]> — [input, output] pairs, 0-1)
│   ├── Brake
│   │   ├── Deadzone, Gamma, Sensitivity, CurvePoints (same structure)
│   │   └── MaxPressurePercent (0-100, safety cap for no-ABS cars)
│   └── Clutch
│       └── Deadzone, Gamma, CurvePoints
│
├── Wheelbase
│   ├── FFBStrength (0-100)
│   ├── RotationRange (degrees, e.g. 900)
│   ├── Friction (0-100)
│   ├── Spring (0-100)
│   ├── Damper (0-100)
│   ├── Inertia (0-100)
│   ├── RoadSensitivity (0-100)
│   └── SpeedDamping (0-100)
│
└── Metadata
    ├── CarClass (string — "GT3", "Formula", etc.)
    ├── HasABS (bool)
    ├── Notes (string — user notes)
    └── BasedOn (string — profileId this was derived from, if any)
```

**Migration:** On first load, existing `PedalProfile` JSON files are auto-migrated to `CarSetupProfile` with wheelbase fields set to null (indicating "not yet configured"). The migration is non-destructive — old files are preserved as `.bak`.

### 1.2 CarSetupManager — The New Manager

**File:** `Engine/CarSetupManager.cs` (new, replaces PedalProfileManager)

Responsibilities:
- CRUD for `CarSetupProfile` objects (stored as `{id}.json` in `PluginsData/RaceCorProDrive/CarSetups/`)
- Car binding: `Dictionary<string, string>` mapping `carModel → profileId` (in `_bindings.json`)
- Auto-switch on car change (called from `Plugin.cs DataUpdate()`)
- Auto-suggest when no profile exists for a car (calls CarClassHeuristics)
- Push to Moza hardware when available (via MozaSerialManager, or fall back to Pit House file write)
- Profile comparison (diff two profiles for the strategist "apply suggestion" flow)

**Key methods:**
```csharp
CarSetupProfile GetOrCreateForCar(string carModel, string carName)
// Returns bound profile if exists, otherwise generates a suggested one

void OnCarChanged(string carModel, string carName)
// Look up binding → apply profile → push to hardware
// If no binding: generate suggestion, apply it, mark as "suggested"
// Fires CarSetupChanged event for overlay to pick up

CarSetupProfile GenerateSuggestion(string carModel, string carName)
// Uses CarClassHeuristics to build a profile from the car class database
// Sets Source = "suggested", SuggestionConfidence from heuristic

void ApplyStrategySuggestion(string suggestionId)
// Applies a pending strategist suggestion (curve tweak) to the active profile
// Saves immediately, pushes to hardware

void SaveAndPush(CarSetupProfile profile)
// Save to disk + push to Moza hardware (if connected) in one call
```

### 1.3 Profile Auto-Load Timing

The critical UX requirement: profiles must load as early as possible when a session starts.

**Current flow (Plugin.cs DataUpdate):**
```
Every frame: check if carModel != lastCarModel → OnCarChanged()
```

This already fires the moment the car model string appears in telemetry, which is during the loading screen before the driver is on track. This timing is ideal — the profile is active before the first lap.

**Enhancement:** Add a `SessionStarting` event that fires when `SessionState` transitions to indicate a new session loading. This lets us pre-fetch the profile even before the car model changes (in case the driver is re-entering the same car in a new session).

---

## Phase 2: Car Class Database & Heuristics (Plugin)

### 2.1 Car Class Database

**File:** `Engine/Data/car-classes.json` (new, bundled as embedded resource)

A JSON lookup table mapping iRacing car IDs to class metadata:

```json
{
  "version": 1,
  "lastUpdated": "2026-04-15",
  "cars": {
    "132": {
      "name": "Porsche 911 GT3 R (992)",
      "class": "GT3",
      "hasABS": true,
      "isTurbo": true,
      "powerHP": 565,
      "weightKG": 1300,
      "downforce": "high",
      "brakeType": "carbon"
    },
    "107": {
      "name": "Dallara IR-04",
      "class": "Formula",
      "hasABS": false,
      "isTurbo": false,
      "powerHP": 175,
      "weightKG": 570,
      "downforce": "medium",
      "brakeType": "steel"
    }
  },
  "classDefaults": {
    "GT3":     { "hasABS": true,  "isTurbo": true,  "downforce": "high",   "brakeType": "carbon" },
    "GT4":     { "hasABS": true,  "isTurbo": false, "downforce": "medium", "brakeType": "steel" },
    "GTP":     { "hasABS": false, "isTurbo": true,  "downforce": "high",   "brakeType": "carbon" },
    "Formula": { "hasABS": false, "isTurbo": false, "downforce": "high",   "brakeType": "carbon" },
    "NASCAR":  { "hasABS": false, "isTurbo": false, "downforce": "low",    "brakeType": "steel" },
    "Oval":    { "hasABS": false, "isTurbo": false, "downforce": "low",    "brakeType": "steel" },
    "Touring": { "hasABS": true,  "isTurbo": false, "downforce": "medium", "brakeType": "steel" }
  }
}
```

**Maintenance:** This file ships with the plugin and is updated with each release. It doesn't need to cover every car — `classDefaults` provides reasonable fallbacks for any car whose class is known but whose specific ID isn't in the table. Unknown cars fall back to a conservative "Touring" profile.

**Car class detection:** When a car isn't in the lookup table, attempt to classify by name pattern matching:
- Name contains "GT3" → GT3
- Name contains "GT4" → GT4
- Name contains "LMP" or "GTP" or "Prototype" → GTP
- Name contains "Formula" or "FR" or "F4" or "IndyCar" → Formula
- Name contains "NASCAR" or "Cup" or "Xfinity" or "Truck" → NASCAR
- Default → Touring

### 2.2 CarClassHeuristics — The Suggestion Engine

**File:** `Engine/CarClassHeuristics.cs` (new)

A pure, deterministic function: `(CarClassInfo) → CarSetupProfile`

No AI, no network calls, no randomness. A decision tree that maps car properties to curves and FFB settings.

**Decision logic:**

```
INPUT: { class, hasABS, isTurbo, powerHP, weightKG, downforce, brakeType }

BRAKE CURVE:
  GT3 (ABS):
    → Progressive: [0, 12, 35, 68, 100] at 20/40/60/80/100% input
    → Deadzone: 0.02, Gamma: 0.85
    → Rationale: ABS protects against lockup; progressive entry lets driver feel the threshold
    
  Formula / GTP (no ABS):
    → Aggressive progressive: [0, 20, 50, 80, 95] 
    → Deadzone: 0.01, Gamma: 0.75
    → MaxPressurePercent: 85 (safety cap — hard to accidentally lock)
    → Rationale: Must trail-brake precisely; cap prevents panic-locks
    
  GT4 / Touring (ABS):
    → Moderate progressive: [0, 15, 40, 72, 100]
    → Deadzone: 0.02, Gamma: 0.9
    
  NASCAR / Oval:
    → Linear: [0, 20, 40, 80, 100]
    → Deadzone: 0.0, Gamma: 1.0
    → Rationale: Muscle memory, consistent feel

THROTTLE CURVE:
  Turbo cars (GT3, GTP):
    → Progressive: [0, 10, 30, 65, 100]
    → Deadzone: 0.01, Gamma: 1.15
    → Rationale: Turbo lag + sudden power delivery; smooth application on exit
    
  NA cars (Formula, GT4, Oval):
    → Linear-ish: [0, 18, 42, 75, 100]
    → Deadzone: 0.01, Gamma: 1.0

CLUTCH: Always linear, deadzone 0.02

FFB SETTINGS:
  High downforce (GT3, GTP, Formula):
    → FFBStrength: 80, Damper: 15, Friction: 10, Spring: 0, Inertia: 10
    → RotationRange: class == Formula ? 480 : 900
    → RoadSensitivity: 60

  Medium downforce (GT4, Touring):
    → FFBStrength: 75, Damper: 10, Friction: 8, Spring: 5, Inertia: 8
    → RotationRange: 900
    → RoadSensitivity: 50

  Low downforce (NASCAR, Oval):
    → FFBStrength: 70, Damper: 8, Friction: 5, Spring: 5, Inertia: 5
    → RotationRange: 900
    → RoadSensitivity: 40

CONFIDENCE:
  Exact car in database:     0.85
  Class known, car not in DB: 0.65
  Fallback to Touring:       0.40
```

**Output:** A complete `CarSetupProfile` with `Source = "suggested"` and `SuggestionConfidence` set.

---

## Phase 3: HTTP API Extensions (Plugin)

New endpoints added to `Plugin.cs HttpServerLoop`:

| Action | Params | Returns | Notes |
|--------|--------|---------|-------|
| `getCarSetup` | `car` (optional, defaults to current) | Full `CarSetupProfile` JSON | Used by overlay settings panel |
| `setCarSetup` | POST body: partial profile JSON | `{"ok": true}` | Merges provided fields into active profile, saves, pushes |
| `suggestCarSetup` | `car` (optional) | Suggested profile JSON | Generates but doesn't apply |
| `applyCarSetup` | `id` | `{"ok": true}` | Apply a profile (suggested or saved) |
| `acceptStrategySuggestion` | `suggestionId` | `{"ok": true}` | Apply a pending strategist tweak |
| `dismissStrategySuggestion` | `suggestionId` | `{"ok": true}` | Dismiss without applying |
| `listCarClasses` | — | Car class database summary | For debug/settings display |
| `duplicateCarSetup` | `id`, `name` | New profile JSON | Clone a profile for editing |

**Poll response additions** (included every frame):

```json
{
  "CarSetup.Active": true,
  "CarSetup.ProfileName": "GT3 Progressive",
  "CarSetup.Source": "suggested",
  "CarSetup.Confidence": 0.85,
  "CarSetup.CarClass": "GT3",
  "CarSetup.HasABS": true,
  "CarSetup.FFBStrength": 80,
  "CarSetup.RotationRange": 900,
  "CarSetup.ThrottleCurve": [[0,0],[0.2,0.1],[0.4,0.3],[0.6,0.65],[0.8,0.88],[1,1]],
  "CarSetup.BrakeCurve": [[0,0],[0.2,0.12],[0.4,0.35],[0.6,0.68],[0.8,0.92],[1,1]],
  "CarSetup.ThrottleDeadzone": 0.01,
  "CarSetup.BrakeDeadzone": 0.02,

  "CarSetup.Suggestion.Pending": true,
  "CarSetup.Suggestion.Id": "guid-string",
  "CarSetup.Suggestion.Text": "Soften brake curve — you've triggered ABS 12 times in the last 3 laps",
  "CarSetup.Suggestion.Severity": 2,
  "CarSetup.Suggestion.Label": "BRAKE",
  "CarSetup.Suggestion.Delta": "BrakeGamma: 0.85 → 0.92"
}
```

**Backward compatibility:** The existing `PedalProfile` poll properties and endpoints continue to work. They read from the pedal portion of the active `CarSetupProfile`. Old overlays that don't know about `CarSetup.*` properties are unaffected.

---

## Phase 4: Overlay UI — Setup Manager Panel

### 4.1 Progressive Disclosure Levels

The settings panel uses an accordion/expandable structure. Each level adds detail:

**Level 0 — Glanceable (always visible in the pedals settings area)**

What the driver sees when they glance at the HUD's pedal area:
- Curve overlays on the pedal histogram (existing, enhanced)
- Car name + profile source badge ("Suggested", "Custom", "Moza ⚡")
- If source is "suggested": subtle pulsing badge inviting the driver to review

**Level 1 — Quick Controls (settings tab, top section)**

The first thing visible when opening the Setup Manager tab:
- **Car name & class** (auto-detected, read-only)
- **FFB Strength** slider (0–100) — the single most-changed FFB setting
- **Rotation Range** slider (degrees)
- **Brake Feel** preset selector: "Linear", "Progressive", "Aggressive", "Custom"
- **Throttle Feel** preset selector: same presets
- **Curve preview** (200×200 canvas, read-only at this level)
- **"Save as Custom"** button (appears when changes are made to a suggested profile)
- **"Reset to Suggested"** button

This level satisfies 80% of users. A driver can switch their brake feel from Progressive to Aggressive and adjust FFB strength without ever seeing a gamma value or a deadzone slider.

**Level 2 — Custom Curves (expandable section)**

Revealed by tapping "Customize Curves" or selecting "Custom" as a preset:
- **Interactive 5-point curve editor** per axis (throttle, brake, clutch)
  - 200×200 canvas with draggable control points
  - Grid background with 20% intervals
  - Real-time curve preview updates as points are dragged
  - Live pedal position dot (shows where current input maps)
- **Deadzone slider** per axis (0–10%)
- **Sensitivity cap** for throttle and brake (50–100%)
- **Brake max pressure** for no-ABS cars (50–100%)

**Level 3 — Expert (collapsed by default, "Show Advanced" toggle)**

- **Gamma** per axis (0.5–2.0, with live curve preview impact)
- **FFB Damping, Friction, Spring, Inertia** sliders
- **FFB Road Sensitivity** slider
- **FFB Speed Damping** slider
- **EQ Bands** (6-band equalizer, if wheelbase supports it)
- **Raw curve points** (editable numeric table)
- **Profile JSON export/import** buttons
- **"Based on" lineage** (which profile/suggestion this was derived from)

### 4.2 File Organization

```
modules/
├── js/
│   ├── pedal-curves.js              (MODIFIED — delegates to setup-manager for data)
│   ├── setup-manager.js             (NEW — main panel logic, disclosure levels)
│   ├── setup-curve-editor.js        (NEW — interactive 5-point curve editor component)
│   ├── setup-presets.js             (NEW — preset definitions & switching logic)
│   └── setup-strategist-toast.js    (NEW — strategist suggestion toast handler)
├── styles/
│   ├── setup-manager.css            (NEW — panel layout, disclosure animations)
│   └── setup-curve-editor.css       (NEW — curve editor canvas, drag handles)
├── components/
│   └── range-slider.js              (NEW — reusable styled slider with value readout)
```

### 4.3 Preset Definitions

Presets map human-friendly names to curve parameters. They're defined in the overlay (not the plugin) so the UI can show previews without a server round-trip:

```javascript
const BRAKE_PRESETS = {
  linear:      { gamma: 1.0,  points: null, label: "Linear",      desc: "1:1 pedal to brake" },
  progressive: { gamma: 0.85, points: null, label: "Progressive",  desc: "Gentle initial, strong deep" },
  aggressive:  { gamma: 0.70, points: null, label: "Aggressive",   desc: "Heavy initial bite" },
  custom:      { gamma: null, points: null, label: "Custom",       desc: "Your curve" }
};
// When points is null, the curve is generated from gamma at render time
// When preset is "custom", the user's manual curve points are used
```

### 4.4 Curve Editor Interaction Design

The interactive curve editor is the visual centerpiece:

- **Canvas size:** 200×200px in settings, with 20px padding for labels
- **Background:** Subtle grid at 20% intervals, diagonal reference line (linear)
- **5 control points** at fixed X positions (20%, 40%, 60%, 80%, 100%) — user drags Y only
- **Drag interaction:** Touch/mouse drag vertically; point snaps to 1% increments; haptic-style cursor change
- **Live preview:** As points move, the smooth interpolated curve redraws in real time
- **Pedal position indicator:** A dot that slides along the curve showing where the driver's current real-time pedal input maps to output — so they can press the brake and see the mapping live
- **Color coding:** Throttle green (#4CAF50), Brake red (#F44336), Clutch blue (#42A5F5) — matches existing
- **Reset button** per axis: returns to the current preset's curve

### 4.5 Strategy Toast Enhancement

Extends the existing `_showDMToast()` in `drive-mode.js` with an action button:

```javascript
function showStrategySuggestion(suggestion) {
  const toast = createToast({
    label: suggestion.label,         // "BRAKE"
    text: suggestion.text,           // "Soften brake curve — 12 ABS triggers in 3 laps"
    severity: suggestion.severity,   // 2
    delta: suggestion.delta,         // "Gamma: 0.85 → 0.92"
    actions: [
      { label: "Apply", onclick: () => acceptSuggestion(suggestion.id) },
    ],
    autoDismissMs: 10000
  });
}
```

**Visual treatment:**
- Same toast position and animation as existing strategy toasts
- Amber accent color (matches strategy system)
- "Apply" button is a small pill on the right side of the toast
- After applying: brief green flash confirmation, toast slides away
- After dismissing (timeout or swipe): toast slides away, no action taken
- Suggestion toast has **lower priority** than critical strategy calls (fuel/tire severity 4-5 can interrupt it)

### 4.6 HUD Enhancements

Minimal additions to the always-visible HUD:

- **"Suggested" badge** — small pill next to the profile name when running on a suggested (unconfirmed) profile. Uses design system token for muted accent color.
- **Curve overlay enhancement** — existing 240×80 curve canvas gets a subtle glow or opacity boost when the strategist has a pending suggestion, drawing the driver's attention to check curves at the next safe moment.

---

## Phase 5: PedalStrategist — In-Race Coaching (Plugin)

### 5.1 Architecture

**File:** `Engine/Strategy/PedalStrategist.cs` (new)

Plugs into the existing `StrategyCoordinator` exactly like `TireTracker` and `FuelComputer`:

```csharp
// In StrategyCoordinator.cs:
public PedalStrategist Pedals { get; } = new PedalStrategist();

// In Update():
Pedals.UpdateFrame(current, ActiveCarSetup);

// In OnLapCompleted():
Pedals.OnLapCompleted(CurrentStint, snapshot);

// In EvaluateAndEmit():
var pedalCall = Pedals.Evaluate(CurrentStint, ActiveCarSetup);
if (pedalCall != null) candidates.Add(pedalCall);
```

### 5.2 Per-Frame Tracking

Each frame, accumulate:
- **ABS activation count** (rising edge of `AbsActive`)
- **TC activation count** (rising edge of `TcActive`)
- **Brake input histogram** — bucket brake pedal values into 10 bins (0–10%, 10–20%, etc.) to detect where the driver lives on the pedal
- **Throttle aggression** — rate of change of throttle input (d(throttle)/dt)
- **Brake-to-coast transitions** — how abruptly the driver releases the brake (snap vs trail)

### 5.3 Per-Lap Analysis

At each lap completion, compute:
- **ABS activations per lap** (and rolling 3-lap average)
- **TC activations per lap** (and rolling 3-lap average)
- **Trend direction** — ABS count increasing, stable, or decreasing across recent laps
- **Brake zone analysis** — what percentage of braking time is spent in the top 20% of pedal travel (indicates whether the curve's upper range is calibrated well)
- **Throttle zone analysis** — time spent in the 0–20% throttle range on exit (too much = too aggressive, spinning tires)

### 5.4 Suggestion Triggers

| Trigger | Condition | Suggestion | Severity | Cooldown |
|---------|-----------|------------|----------|----------|
| **Excessive lockups** | ABS count > 8/lap for 3 consecutive laps | "Soften brake curve — consistent lockups detected" | 2 | 90s |
| **Increasing lockups** | ABS trend rising >50% over 3 laps | "Brake lockups increasing — consider reducing brake gamma" | 2 | 90s |
| **Excessive wheelspin** | TC count > 10/lap for 3 consecutive laps | "Smooth throttle application — traction control overworking" | 2 | 90s |
| **Over-braking** | >40% of brake time in top 20% of travel | "You're deep in the pedal travel often — try a more progressive curve" | 1 | 120s |
| **Under-braking** | <5% of brake time above 60% travel, slow lap | "You may be under-braking — consider an aggressive curve for more bite" | 1 | 120s |
| **Snap throttle** | Throttle d/dt exceeds threshold >5x/lap | "Gradual throttle on exit — try a progressive throttle curve" | 1 | 120s |
| **FFB clipping** | SteeringWheelTorque consistently at max | "FFB may be clipping — try reducing strength 5-10%" | 2 | 180s |

### 5.5 Suggestion Payload

When a trigger fires, the strategist creates both the human-readable message and a concrete `CarSetupDelta`:

```csharp
public class PedalStrategySuggestion
{
    public string Id { get; set; }                // GUID
    public string Text { get; set; }              // Human message
    public string Label { get; set; }             // "BRAKE", "THROTTLE", "FFB"
    public int Severity { get; set; }             // 1-2 (coaching, not critical)
    public string DeltaDescription { get; set; }  // "BrakeGamma: 0.85 → 0.92"
    public CarSetupDelta Delta { get; set; }      // The actual change to apply
}

public class CarSetupDelta
{
    // Only non-null fields are applied as changes
    public double? BrakeGamma { get; set; }
    public double? ThrottleGamma { get; set; }
    public double? FFBStrength { get; set; }
    // ... etc
}
```

When the driver taps "Apply" in the toast, the overlay calls `?action=acceptStrategySuggestion&suggestionId=...`, and the plugin:
1. Applies the delta to the active profile
2. Saves to disk
3. Pushes to hardware (Moza serial or Pit House file)
4. Clears the pending suggestion
5. Logs the change with timestamp for the driver to review post-session

### 5.6 Suggestion Quality Constraints

- **Maximum 1 pedal/FFB suggestion per 90 seconds** (global cooldown across all trigger types)
- **Never during first 3 laps** of a stint (let the driver warm up and the data stabilize)
- **Never when strategy has a severity 3+ call active** (don't distract from critical pit/fuel/tire calls)
- **Suppress if driver just made a manual change** (60-second grace period after any `setCarSetup` call)
- **Trend-based, not spike-based** — require 3+ laps of consistent data before suggesting

---

## Phase 6: Implementation Order

### Sprint 1: Foundation (Plugin)

1. Create `CarSetupProfile.cs` data model
2. Create `CarSetupManager.cs` with CRUD, car binding, auto-load on car change
3. Migrate existing `PedalProfile` data on first load
4. Add `car-classes.json` with top 40 most-popular iRacing cars
5. Create `CarClassHeuristics.cs` suggestion engine
6. Add HTTP endpoints: `getCarSetup`, `setCarSetup`, `suggestCarSetup`, `applyCarSetup`
7. Add `CarSetup.*` properties to poll response
8. **Tests:** Unit test heuristics (given GT3 properties → expected curves), test migration, test car change auto-load

### Sprint 2: Overlay UI — Quick Controls

1. Add "Setup Manager" settings tab in `dashboard.html`
2. Build `setup-manager.js` — Level 0 (glanceable) and Level 1 (quick controls)
3. Build `setup-presets.js` — preset definitions and switching
4. Build `range-slider.js` component
5. Wire FFB strength and rotation sliders to `setCarSetup` endpoint
6. Wire brake/throttle preset selectors
7. Show "Suggested" badge on HUD when running defaults
8. **Tests:** Playwright tests for panel rendering, preset switching, slider interaction

### Sprint 3: Overlay UI — Curve Editor

1. Build `setup-curve-editor.js` — interactive 5-point canvas editor
2. Add Level 2 (custom curves) expandable section
3. Add Level 3 (expert) collapsed section
4. Wire curve changes to `setCarSetup` endpoint with 200ms debounce
5. Live pedal position dot on curve editor
6. Profile duplication and naming
7. **Tests:** Playwright tests for curve editor drag, live dot, preset-to-custom transition

### Sprint 4: In-Race Strategist

1. Create `PedalStrategist.cs` — per-frame tracking, per-lap analysis
2. Integrate into `StrategyCoordinator` evaluation loop
3. Implement trigger conditions (lockup, wheelspin, over-braking, FFB clipping)
4. Add `CarSetup.Suggestion.*` properties to poll response
5. Build `setup-strategist-toast.js` — toast with "Apply" button
6. Wire `acceptStrategySuggestion` / `dismissStrategySuggestion` endpoints
7. Add suggestion history logging for post-session review
8. **Tests:** Unit test trigger conditions with mock telemetry, Playwright test toast interaction

### Sprint 5: Polish & Moza Direct Integration

1. Connect `MozaSerialManager` (from moza-hardware skill) to `CarSetupManager.SaveAndPush()`
2. Hardware writes for pedal curves and wheelbase FFB via direct serial
3. Expand `car-classes.json` to cover all ~170 iRacing cars
4. Add name-based classification fallback for unrecognized cars
5. Profile export/import (JSON file)
6. Post-session summary of strategist suggestions applied
7. **Tests:** End-to-end profile lifecycle test, Moza mock serial test

---

## Key Technical Decisions

**Why deterministic heuristics, not AI-generated suggestions:**
The car class → curve mapping is a pure function with no network dependency, no latency, and no variability. It produces the same result every time for the same car, which means a driver can trust that re-entering a car will always start from the same baseline. AI-generated suggestions would introduce variance and require network access that may not be available at the track.

**Why extend PedalProfile rather than start fresh:**
Migration cost is lower, and the existing overlay code can continue reading `PedalProfile` poll properties while the new `CarSetup.*` properties are adopted. Zero downtime during the transition.

**Why 5-point curves in the editor (not 21):**
The Moza hardware accepts 5-point curves (Y values at 20/40/60/80/100% input). The existing 21-point display format is great for visualization but too granular for manual editing — dragging 21 points is tedious. The editor uses 5 points for input; the display interpolates to 21 for smooth rendering. If the driver needs finer control, they use gamma/sensitivity in expert mode.

**Why toast + one-tap (not voice or pit board):**
A toast is minimally intrusive during racing and follows the existing strategy notification pattern. The driver already knows how strategy toasts work (they see tire and fuel calls). Adding an "Apply" button is the smallest possible addition to an established UX pattern. Voice could be a future enhancement layered on top.

**Why the strategist lives in the plugin, not an MCP agent:**
The strategist needs per-frame telemetry data (ABS active, TC active, pedal positions) at 30fps. Routing this through an external process adds latency and complexity. The plugin already has the StrategyCoordinator pattern for exactly this kind of per-frame analysis. The MCP agents are better suited for non-real-time tasks like session analysis and setup research.
