# Web Components Conversion Plan
## RaceCor Dashboard Overlay Modularization & Reusability

**Status:** Investigation & Proof-of-Concept
**Date:** March 2026
**Goal:** Convert vanilla JS modules to reusable web components that work identically in both the Electron overlay and Next.js web app.

---

## Executive Summary

The RaceCor overlay currently consists of 28+ vanilla JavaScript modules that directly manipulate the DOM, maintain closure-based state, and rely on CSS modules for styling. This architecture works well for performance (~30fps polling, zero build step), but creates barriers to code reuse with the Next.js web app.

This plan outlines a **zero-friction migration path** to Web Components that:
- **Preserves every pixel of visual fidelity** — no layout, color, or animation changes
- **Maintains 30fps polling capability** — lightweight custom elements, Shadow DOM only where beneficial
- **Enables sharing** between the overlay (plain HTML/JS) and web app (React/Next.js)
- **Keeps the overlay zero-build** — components are plain ES modules, bundled optionally for performance
- **Phases the rollout** — convert modules incrementally, run old and new side-by-side during transition

### Key Architectural Decisions

1. **Shadow DOM Strategy:**
   - Use Shadow DOM where components have **isolated styles** (fuel gauge, tire grid, gauge widgets)
   - Use Light DOM where components **inherit cascading styles** (layout containers, position displays)
   - CSS custom properties leak *into* Shadow DOM automatically, allowing theme inheritance

2. **Data Flow:**
   - Components accept telemetry via **properties** (not attributes) for complex data (objects, arrays)
   - A centralized **data bus** (`window._telemetryBus`) dispatches updates to all registered components
   - Poll-engine remains unchanged — it sets `window._latestSnapshot` and fires a custom event
   - Components subscribe to `telemetry-update` events for reactive updates

3. **CSS Theming:**
   - All color, spacing, font tokens remain as CSS custom properties on `:root`
   - Shadow DOM components inherit these variables, so theming is automatic
   - Per-component scoped styles (padding, borders, animations) live in adopted stylesheets within components

4. **Build & Delivery:**
   - **Overlay:** Components load as plain ES modules, no build step. Optional bundling for production performance.
   - **Web App:** Components import via npm/path alias, wrapped in React `<Suspense>` with `ssr: false`
   - **Package:** Components live in `racecor-overlay/modules/components/` and are re-exported from a barrel file for easy import

5. **Lifecycle & Performance:**
   - `connectedCallback()` — initialize DOM, bind event listeners, subscribe to data bus
   - `disconnectedCallback()` — cleanup subscriptions, cancel rAF loops, clear canvases
   - Canvas-based components (`<racecor-pedal-trace>`, `<racecor-datastream>`) manage their own animation loops via `requestAnimationFrame`
   - No impact on 30fps polling loop — components are passive receivers

---

## Architecture Overview

### Current System (Vanilla Modules)

```
poll-engine.js (polling + dispatch)
    ↓
_renderFrame() processes snapshot
    ↓
Functions called globally:
  - updateTacho(rpmRatio)
  - updateFuelBar(pct)
  - updateTyreCell(index, temp, wear)
  - updateLeaderboard(p)
  - updateDatastream(p)
  [28 functions in global scope]
    ↓
DOM writes in each module
    ↓
CSS classes/variables trigger animations
```

### Proposed Web Component System

```
poll-engine.js (unchanged)
    ↓
_renderFrame() sets window._latestSnapshot
    ↓
Fires custom event: window.dispatchEvent(new CustomEvent('telemetry-update', { detail: snapshot }))
    ↓
Component subscriptions in connectedCallback():
    window.addEventListener('telemetry-update', handler)
    handler calls component.updateData(snapshot)
    ↓
Components (Shadow DOM or Light DOM)
    DOM.textContent = value
    DOM.style.setProperty('--var', value)
    Canvas.getContext().draw()
    ↓
Animations (CSS transitions, rAF loops)
```

### Component Registry

Instead of polluting global scope with 28 functions, we define a component registry:

```javascript
// In config.js or new registry.js
window._componentRegistry = {
  'racecor-fuel-gauge': { componentClass: RaceCorFuelGauge, type: 'dom' },
  'racecor-leaderboard': { componentClass: RaceCorLeaderboard, type: 'dom' },
  'racecor-webgl-fx': { componentClass: RaceCorWebGLFX, type: 'webgl' },
  // ... 28 entries
};

// Auto-register on import
for (const [tag, { componentClass }] of Object.entries(window._componentRegistry)) {
  customElements.define(tag, componentClass);
}
```

### CSS Variable Inheritance Across Shadow DOM

CSS custom properties **do** leak across the Shadow DOM boundary, but inherited properties (font-family, color) **do not**.

**Strategy:**
- All **theme tokens** (colors, sizes, fonts, spacing) → CSS custom properties on `:root`
- All **component-specific styles** (padding, borders, animations) → Shadow DOM adopted stylesheets
- Result: Same visual appearance, but styles are scoped to the component

Example:

```css
/* base.css (light DOM) */
:root {
  --bg: hsla(0, 0%, 8%, 0.90);
  --text-primary: hsla(0, 0%, 100%, 1.0);
  --ff: 'Barlow Condensed', sans-serif;
}

/* Inside RaceCorFuelGauge Shadow DOM */
:host {
  display: inline-block;
  background: var(--bg);  /* inherited from :root */
  color: var(--text-primary);
  font-family: var(--ff);
}
.fuel-bar {
  background: linear-gradient(to right, var(--green), var(--red));
}
```

---

## Component Inventory

| Module | Component Tag | Type | Complexity | Status |
|--------|---|---|---|---|
| **Core Gauges** |
| Fuel gauge | `<racecor-fuel-gauge>` | DOM | Simple | Planned |
| Tire grid | `<racecor-tire-grid>` | DOM | Simple | Planned |
| Tachometer | `<racecor-tachometer>` | Canvas/WebGL | Complex | Phase 2 |
| **Data & Visualization** |
| Leaderboard | `<racecor-leaderboard>` | DOM + Canvas sparklines | Moderate | Phase 1 |
| Datastream | `<racecor-datastream>` | DOM + Canvas (g-force, yaw trail) | Moderate | Phase 2 |
| Race Timeline | `<racecor-race-timeline>` | Canvas | Simple | Phase 1 |
| Pedal Curves | `<racecor-pedal-curves>` | Canvas | Moderate | Phase 2 |
| Commentary Viz | `<racecor-commentary-viz>` | Canvas + DOM | Moderate | Phase 3 |
| **Layout & Position** |
| Position/Rating Card | `<racecor-position-card>` | DOM | Simple | Phase 1 |
| Gap Display | `<racecor-gap-display>` | DOM | Simple | Phase 1 |
| Sector Indicator | `<racecor-sector-indicator>` | DOM | Simple | Phase 1 |
| **Secondary Panels** |
| Pitbox Panel | `<racecor-pitbox>` | DOM (tabbed) | Moderate | Phase 2 |
| Incidents Panel | `<racecor-incidents>` | DOM + Canvas | Simple | Phase 1 |
| Spotter Panel | `<racecor-spotter>` | DOM + Canvas | Moderate | Phase 2 |
| Drive HUD | `<racecor-drive-hud>` | DOM + SVG maps | Complex | Phase 3 |
| **Effects & Ambient** |
| WebGL FX Engine | `<racecor-webgl-fx>` | WebGL2 | Complex | Phase 3 |
| Ambient Light | `<racecor-ambient-light>` | CSS variables | Simple | Phase 1 |
| **Layout System** |
| Main Dashboard | `<racecor-dashboard>` | DOM (grid layout) | Moderate | Phase 2 |
| Secondary Container | `<racecor-panel-container>` | DOM (flex layout) | Simple | Phase 1 |
| **Support Modules** |
| Commentary Panel | `<racecor-commentary>` | DOM + Canvas | Moderate | Phase 2 |
| Grid/Start Lights | `<racecor-grid-module>` | DOM + CSS animations | Simple | Phase 1 |
| Race Control Banner | `<racecor-race-control>` | DOM | Simple | Phase 1 |
| Race End Screen | `<racecor-race-end>` | DOM + confetti | Simple | Phase 1 |
| Pit Limiter Banner | `<racecor-pit-limiter>` | DOM | Simple | Phase 1 |
| Driver Profile | `<racecor-driver-profile>` | DOM + Canvas (charts) | Moderate | Phase 3 |
| **System Modules** |
| Poll Engine | N/A (stays vanilla) | Data flow | Core | Keep as-is |
| Config | N/A (stays vanilla) | State mgmt | Core | Extend slightly |
| Game Detect | N/A (stays vanilla) | Feature gating | Core | Keep as-is |
| Connections | N/A (stays vanilla) | Settings | Core | Keep as-is |

### Conversion Complexity Notes

**Simple (DOM-only, no Canvas):**
- Fuel gauge, tire grid, position card, gap display, sector indicator, incidents (basic), ambient light
- No animation loops, straightforward state → DOM mapping
- **Estimate:** 1-2 hours per component

**Moderate (DOM + Canvas, or complex DOM):**
- Leaderboard (Canvas sparklines), race timeline, pedal curves, pitbox, spotter, commentary, datastream
- Manage Canvas lifecycle, handle complex data structures, coordinate with poll loop
- **Estimate:** 2-4 hours per component

**Complex (WebGL, full-screen modes, or heavy orchestration):**
- Tachometer (WebGL bloom), WebGL FX engine, drive HUD (SVG rotation + 3-column layout), commentary viz, driver profile
- Shared GL context management, sophisticated animation, responsive layout
- **Estimate:** 4-6 hours per component

---

## Conversion Strategy Per Module

### `<racecor-fuel-gauge>` (Simple DOM Component)

**Inputs (properties):**
```javascript
component.fuelLevel = 45.2;      // liters (number)
component.maxFuel = 80;          // liters (number)
component.fuelPerLap = 2.3;      // liters/lap (number)
component.lapsRemaining = 15;    // estimated (number)
```

**Internal State:**
- Current fuel percentage (cached for animation)
- Previous values (for flash animation on change)

**Shadow DOM:**
```html
<style>
  :host {
    display: block;
    background: var(--bg-panel);
    padding: var(--pad);
    border-radius: var(--corner-r);
    border: 1px solid var(--border);
  }
  .fuel-bar {
    background: linear-gradient(to right, var(--green), var(--amber), var(--red));
    height: 8px;
    border-radius: 2px;
  }
  .fuel-bar.flash {
    animation: fuelFlash 0.4s ease-out;
  }
  @keyframes fuelFlash {
    0% { box-shadow: inset 0 0 8px var(--green); }
    100% { box-shadow: none; }
  }
</style>

<div class="fuel-label">Fuel</div>
<div class="fuel-value">--</div>
<div class="fuel-bar"></div>
<div class="fuel-stats">
  <span>Avg <span class="val">—</span> L/lap</span>
  <span>Est <span class="val">—</span> laps</span>
</div>
```

**CSS Theming:**
- Inherits `--bg-panel`, `--border`, `--pad`, `--corner-r` from `:root`
- Color variables (`--green`, `--amber`, `--red`) applied to gradient
- Font inherited via `:host { font-family: var(--ff); }`

**Lifecycle:**
```javascript
class RaceCorFuelGauge extends HTMLElement {
  connectedCallback() {
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(template.cloneNode(true));
    this.shadowRoot.adoptedStyleSheets = [sharedStylesheet];
    this.subscribeToData();
  }

  subscribeToData() {
    window.addEventListener('telemetry-update', (e) => {
      this.updateData(e.detail);
    });
  }

  updateData(snapshot) {
    const fuel = snapshot['DataCorePlugin.GameData.Fuel'];
    const maxFuel = snapshot['DataCorePlugin.GameData.MaxFuel'];
    this.fuelLevel = fuel;
    this.maxFuel = maxFuel;
    this.render();
  }

  render() {
    const pct = (this.fuelLevel / this.maxFuel) * 100;
    this.shadowRoot.querySelector('.fuel-bar').style.width = pct + '%';
    // ... update text content
  }
}
```

**Migration from vanilla module:**
- Find `updateFuelBar()` function in poll-engine → becomes `updateData()` in component
- Move DOM queries to `connectedCallback()` and cache element refs
- Move CSS from `dashboard.css` to Shadow DOM stylesheet
- Delete global `updateFuelBar()` function

---

### `<racecor-leaderboard>` (Moderate DOM + Canvas)

**Inputs (properties):**
```javascript
component.data = [
  { pos: 1, name: 'Driver1', irating: 3500, gapToPlayer: 0.000, isPlayer: true, ... },
  { pos: 2, name: 'Driver2', irating: 3200, gapToPlayer: 0.152, isPlayer: false, ... },
  // ...
];
component.focusMode = 'me';  // 'me', 'leader', 'all'
component.maxRows = 5;
```

**Internal State:**
- Sparkline history (keyed by driver name)
- Cached gradient objects for drawing
- Current scroll position (if scrollable)

**Shadow DOM:**
- Adopts `leaderboard.css` stylesheet
- Manages `<canvas>` for sparklines
- Renders row divs and status indicators

**Canvas Lifecycle:**
- `connectedCallback()` → `getContext('2d')`, cache context
- `updateData()` → feed new lap times to sparkline buffers
- `render()` → iterate sparklines, draw to canvas
- `disconnectedCallback()` → clear canvas references (no memory leaks)

**Special Handling:**
- Sparklines are **only visual** — don't affect core layout
- Component handles "expand to fill" calculation (responsive height)
- Race timeline strip is a sibling `<canvas>` element (or nested slot)

---

### `<racecor-webgl-fx>` (Complex WebGL Component)

**Challenge:** Shared GL context across multiple canvases (tachometer, glare, post-FX).

**Solution:** Singleton webgl-helpers module + lazy-initialized shared context.

```javascript
// webgl-helpers.js (stays as vanilla helper module)
window._glContext = null; // Singleton shared context
window._glPrograms = {};  // Cached shader programs

function getSharedGLContext() {
  if (!window._glContext) {
    const canvas = document.createElement('canvas');
    canvas.id = 'shared-gl-canvas';
    document.body.appendChild(canvas);
    const gl = canvas.getContext('webgl2', { alpha: true, antialias: true });
    window._glContext = gl;
  }
  return window._glContext;
}
```

**Component approach:**
- `<racecor-webgl-fx>` manages a single canvas (the glare overlay canvas)
- Requests frames from the singleton context
- Initializes shader programs on first use
- Shares program objects with other WebGL components via `window._glPrograms`

**Lifecycle:**
```javascript
connectedCallback() {
  this.canvas = this.shadowRoot.querySelector('canvas');
  this.gl = getSharedGLContext();
  this.requestAnimationFrame(() => this.render());
}

render() {
  // Draw to this.gl with this.canvas as target
  // Update uniforms from window._latestSnapshot
  // Schedule next frame
}

disconnectedCallback() {
  // Don't destroy shared context, just stop scheduling frames
}
```

---

### CSS Theming Strategy

**Root-level variables (light DOM, inherited into Shadow DOM):**
```css
:root {
  /* Colors */
  --bg: hsla(0, 0%, 8%, 0.90);
  --bg-panel: hsla(0, 0%, 6%, 0.90);
  --text-primary: hsla(0, 0%, 100%, 1.0);
  --red: #e53935;
  --green: #43a047;

  /* Sizing */
  --corner-r: 8px;
  --pad: 6px;
  --gap: 4px;

  /* Fonts */
  --ff: 'Barlow Condensed', sans-serif;
  --ff-mono: 'JetBrains Mono', monospace;
  --fs-md: 11px;
}
```

**Component Shadow DOM (CSS custom properties):**
```css
:host {
  display: block;
  background: var(--bg-panel);
  color: var(--text-primary);
  font-family: var(--ff);
  padding: var(--pad);
  border-radius: var(--corner-r);
  border: 1px solid var(--border);
}

.panel-label {
  font-size: var(--fs-md);
  font-weight: var(--fw-semi);
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.bar-fill {
  background: linear-gradient(90deg, var(--green), var(--amber), var(--red));
}
```

**Result:** Changing `:root` variables automatically updates all components (both light and shadow DOM).

---

## Layout System Conversion

### Current Layout

```html
<div class="dashboard layout-tr" id="dashboard">  <!-- 'tr' = top-right -->
  <div class="main-area">                        <!-- 5-column grid -->
    <div class="fuel-tyres-col">...</div>
    <div class="controls-pedals-block">...</div>
    <div class="maps-col">...</div>
    <div class="pos-gaps-col">...</div>
    <div class="tacho-block">...</div>
  </div>
  <div class="timer-row">...</div>
</div>

<div class="sec-container" id="secContainer">    <!-- Secondary panels -->
  <div class="leaderboard-panel lb-bottom lb-right">...</div>
  <div class="datastream-panel ds-bottom ds-right">...</div>
  <!-- ... -->
</div>
```

**Layout class meanings:**
- `layout-tr`, `layout-tl`, `layout-br`, `layout-bl`, `layout-ac` → position system (top-right, top-left, bottom-right, bottom-left, auto-center)
- Secondary panels use CSS classes (`lb-bottom`, `lb-right`) to position within sec-container

### Proposed Web Component Layout

```html
<racecor-dashboard position="tr">
  <racecor-fuel-gauge></racecor-fuel-gauge>
  <racecor-tire-grid></racecor-tire-grid>
  <racecor-tachometer></racecor-tachometer>
  <!-- ... all 5 main columns -->
</racecor-dashboard>

<racecor-panel-container position="bottom right">
  <racecor-leaderboard></racecor-leaderboard>
  <racecor-datastream></racecor-datastream>
  <!-- ... secondary panels -->
</racecor-panel-container>
```

### `<racecor-dashboard>` Component

**Attributes:**
- `position` — "tr", "tl", "br", "bl", "ac" (enum, default "tr")

**Slots:**
```html
<template shadowroot="open">
  <style>
    :host {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr 1fr 1fr;
      gap: var(--gap);
      position: fixed;
      top: var(--edge);
      right: var(--edge);
      width: auto;
      max-height: 100vh;
    }

    :host([position="tl"]) {
      left: var(--edge);
      right: auto;
    }

    :host([position="bl"]) {
      bottom: var(--edge);
      top: auto;
      left: var(--edge);
      right: auto;
    }

    :host([position="br"]) {
      bottom: var(--edge);
      top: auto;
    }

    /* ... */
  </style>

  <slot name="col1"></slot>
  <slot name="col2"></slot>
  <!-- ... -->
</template>
```

**JavaScript:**
```javascript
connectedCallback() {
  this.attachShadow({ mode: 'open' });
  // Position CSS based on attribute
  const pos = this.getAttribute('position') || 'tr';
  this.classList.add(`dashboard-${pos}`);
}
```

### `<racecor-panel-container>` Component

Similar pattern for secondary panels — flex container with positioning attributes.

---

## Shared Component Strategy

### Package Structure

```
racecor-overlay/
  modules/
    components/           ← NEW: Web component source
      fuel-gauge.js
      tire-grid.js
      leaderboard.js
      ... [28 components]
      index.js            ← Barrel export
    styles/
      base.css            ← Kept, becomes global stylesheet
      dashboard.css       ← Refactored: common styles only
      ...                 ← Component-specific styles move to Shadow DOM
    js/
      poll-engine.js      ← Stays unchanged
      config.js           ← Extended with component registry
      game-detect.js      ← Stays unchanged
      ... [5 core modules kept as-is]

      # Deprecated (logic moved to components):
      # leaderboard.js → <racecor-leaderboard>
      # datastream.js → <racecor-datastream>
      # [etc.]
```

### Overlay Import (Zero-Build Mode)

```html
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="modules/styles/base.css">
</head>
<body>
  <racecor-dashboard position="tr">
    <racecor-fuel-gauge></racecor-fuel-gauge>
    <racecor-tire-grid></racecor-tire-grid>
    <!-- ... -->
  </racecor-dashboard>

  <script type="module">
    // Import all components
    import './modules/components/index.js';

    // Import core modules
    import './modules/js/config.js';
    import './modules/js/poll-engine.js';
    import './modules/js/game-detect.js';
  </script>
</body>
</html>
```

**No bundler needed** — ES modules work natively in Electron with `nodeIntegration: false` and context isolation.

### Web App Import (Next.js)

**Option 1: Async component wrapper**

```typescript
// components/DashboardEmbed.tsx
import dynamic from 'next/dynamic';
import { Suspense } from 'react';

const RaceCorDashboard = dynamic(
  () => import('@/components/RaceCorDashboard'),
  { ssr: false, loading: () => <div>Loading...</div> }
);

export function DashboardEmbed() {
  return (
    <Suspense fallback={<div>Loading dashboard...</div>}>
      <RaceCorDashboard />
    </Suspense>
  );
}
```

**Option 2: React wrapper component**

```typescript
// components/RaceCorDashboard.tsx
'use client';

import { useEffect, useRef } from 'react';
import '../../../racecor-overlay/modules/styles/base.css';
import '../../../racecor-overlay/modules/components/index.js';

export default function RaceCorDashboard() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;

    // Create web component tree in ref
    const dashboard = document.createElement('racecor-dashboard');
    dashboard.setAttribute('position', 'tr');

    const fuelGauge = document.createElement('racecor-fuel-gauge');
    dashboard.appendChild(fuelGauge);

    ref.current.appendChild(dashboard);

    return () => {
      ref.current?.removeChild(dashboard);
    };
  }, []);

  return <div ref={ref} />;
}
```

### Package Distribution

**For now (Phase 1):** Components live in the monorepo:
```typescript
// web/tsconfig.json
{
  "compilerOptions": {
    "paths": {
      "@/overlay/*": ["../../racecor-overlay/*"]
    }
  }
}

// Usage
import '@/overlay/modules/components/index.js';
```

**For future (Phase 2):** Extract to npm package:
```bash
npm publish @k10motorsports/racecor-components
```

---

## Migration Path

### Phase 1: DOM-Only Components (Weeks 1-2)

**Components to convert:**
1. Ambient light (CSS variables only)
2. Position card & gap display (simple DOM)
3. Grid module & race control banner (simple DOM, CSS animations)
4. Race end screen & pit limiter (simple DOM)
5. Incidents panel (basic version, no advanced sparklines yet)
6. Sector indicator (simple DOM)
7. Race timeline (basic Canvas)

**Testing:** Side-by-side rendering
- New component: `<racecor-fuel-gauge id="new-fuel">`
- Old code: `<div id="fuel-remaining">` (from vanilla module)
- Compare pixel-perfect at same telemetry snapshot
- Disable old code, verify new code works

**Rollout:**
```html
<!-- During migration: run both -->
<div id="fuel-remaining" style="display: none;"><!-- Old --></div>
<racecor-fuel-gauge></racecor-fuel-gauge><!-- New -->

<!-- After verification -->
<racecor-fuel-gauge></racecor-fuel-gauge><!-- Remove old -->
```

### Phase 2: Canvas & Moderate Components (Weeks 3-4)

**Components to convert:**
1. Leaderboard (with sparklines)
2. Datastream (g-force diamond, yaw trail)
3. Pedal curves (response curve overlays)
4. Pitbox panel (tabbed interface)
5. Spotter panel (stacking messages)
6. Commentary panel & commentary-viz (canvas visualization)
7. Dashboard layout container

**Challenges:**
- Canvas context management (don't create too many contexts)
- Shared animation state (e.g., current telemetry flowing to 5 canvas components)
- Tab switching in pitbox (manage tab state internally)

**Solution:** Use `window._latestSnapshot` as single source of truth
```javascript
// In connectedCallback()
const updateHandler = () => {
  if (window._latestSnapshot) {
    this.updateData(window._latestSnapshot);
  }
};
this._updateHandler = updateHandler;
window.addEventListener('telemetry-update', updateHandler);

// In disconnectedCallback()
window.removeEventListener('telemetry-update', this._updateHandler);
```

### Phase 3: Complex & WebGL Components (Weeks 5-6)

**Components to convert:**
1. Tachometer (WebGL bloom + redline)
2. WebGL FX engine (post-processing, glare, reflections)
3. Drive HUD (full-screen mode with SVG rotation)
4. Driver profile (inline charts)

**Challenges:**
- Shared GL context (tachometer + main glare canvas both need WebGL2)
- SVG map rotation (heading smoothing, coordinate transforms)
- Full-screen mode switching (CSS + JavaScript state)

**Solution:**
- Initialize GL context once in `webgl-helpers.js`
- Components request frames via `window._glContext`
- Use `visibility: hidden` + `display: none` for mode switching

### Phase 4: Documentation & Optimization (Week 7)

- Create JSDoc templates for all components
- Add Storybook stories (optional, for development preview)
- Benchmark: compare 30fps polling loop with old vs. new code
- Optimize: lazy-load component definitions, chunk CSS stylesheets
- Update README with component API reference

---

## Risk Assessment

### Performance at 30fps

**Risk:** Shadow DOM + custom elements add CPU overhead.
**Mitigation:**
- Measure: Compare frame times (old vs. new) with DevTools Performance API
- Light DOM for data-heavy components (leaderboard, datastream)
- Cache DOM queries in `connectedCallback()`, avoid repeated `querySelector()`
- Canvas components: reuse context objects, don't recreate buffers each frame

**Expected impact:** < 1-2ms overhead per frame (acceptable for 30fps budget)

### CSS Cascade & Variable Inheritance

**Risk:** Styles that currently cascade (e.g., inherited `font-family`) may not work in Shadow DOM.
**Mitigation:**
- Test: Build a test component, verify shadow-DOM-scoped styles don't break colors/fonts
- Solution: Explicitly set `:host { font-family: var(--ff); }` in each component
- Use CSS variables for **all** tokens, not just colors

**Expected outcome:** No visual differences (all tokens in `:root` as variables)

### Canvas & WebGL Lifecycle

**Risk:** Memory leaks if Canvas contexts aren't cleaned up on component removal.
**Mitigation:**
- Implement `disconnectedCallback()` → clear canvas references, cancel rAF
- Test: Load/unload components in DevTools, check for memory growth
- Use singleton shared GL context (not per-component)

**Expected outcome:** Zero memory leaks with proper cleanup

### Electron Environment

**Risk:** Web components + ES modules may not work in Electron without proper config.
**Mitigation:**
- Test on macOS/Windows with current Electron version (v31+)
- If issues: add transpilation step for development, build step for production
- ES modules are natively supported in modern Electron (no bundler needed)

**Expected outcome:** Works out-of-the-box

### Bundle Size (Optional Bundling)

**Current:** Overlay is zero-build, ~400KB of JS (all modules)
**With web components:** Each component is ~5-10KB, same total, but more modular
**Bundled option:** Single bundle ~350KB (minified), faster network load in remote scenarios

**No forced bundling** — overlay stays zero-build by default.

---

## Proof of Concept

### First Component: `<racecor-fuel-gauge>`

**Why this component?**
- Self-contained (no dependencies on other components)
- Simple DOM (no Canvas, no complex state)
- Represents the most common pattern (data → DOM)
- Takes ~2 hours to implement
- Easy to verify visually (compare side-by-side with original)

### Implementation

**File:** `/racecor-overlay/modules/components/fuel-gauge.js`

```javascript
/**
 * @element racecor-fuel-gauge
 * @description Fuel level display with bar and consumption stats
 *
 * @attribute none
 *
 * @property {number} fuelLevel - Current fuel in liters
 * @property {number} maxFuel - Max tank capacity in liters
 * @property {number} fuelPerLap - Consumption rate (L/lap)
 * @property {number} lapsRemaining - Estimated laps until empty
 *
 * @fires none
 *
 * @slot default (not used, Shadow DOM)
 *
 * @example
 * <racecor-fuel-gauge></racecor-fuel-gauge>
 * <script>
 *   const gauge = document.querySelector('racecor-fuel-gauge');
 *   window.addEventListener('telemetry-update', (e) => {
 *     gauge.fuelLevel = e.detail.fuel;
 *     gauge.maxFuel = e.detail.maxFuel;
 *     gauge.render();
 *   });
 * </script>
 */

class RaceCorFuelGauge extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    // Internal state
    this._fuelLevel = 0;
    this._maxFuel = 0;
    this._fuelPerLap = 0;
    this._lapsRemaining = 0;
    this._prevFuelPct = -1;
  }

  connectedCallback() {
    this._render();
    this._subscribeToData();
  }

  disconnectedCallback() {
    window.removeEventListener('telemetry-update', this._telemetryHandler);
  }

  // ─── Properties ───────────────────────────────────────────

  get fuelLevel() { return this._fuelLevel; }
  set fuelLevel(val) { this._fuelLevel = +val || 0; }

  get maxFuel() { return this._maxFuel; }
  set maxFuel(val) { this._maxFuel = +val || 1; }

  get fuelPerLap() { return this._fuelPerLap; }
  set fuelPerLap(val) { this._fuelPerLap = +val || 0; }

  get lapsRemaining() { return this._lapsRemaining; }
  set lapsRemaining(val) { this._lapsRemaining = +val || 0; }

  // ─── Data update (called from poll-engine via event) ─────

  updateData(snapshot, isImperial = false) {
    const dsPre = snapshot._demo ? 'RaceCorProDrive.Plugin.Demo.DS.' : 'RaceCorProDrive.Plugin.DS.';
    const fuel = +(snapshot['DataCorePlugin.GameData.Fuel'] || 0);
    const maxFuel = +(snapshot['DataCorePlugin.GameData.MaxFuel'] || 0);

    this.fuelLevel = isImperial ? fuel / 3.78541 : fuel;
    this.maxFuel = isImperial ? maxFuel / 3.78541 : maxFuel;
    this.fuelPerLap = isImperial
      ? +(snapshot[dsPre + 'FuelPerLap'] || 0) / 3.78541
      : +(snapshot[dsPre + 'FuelPerLap'] || 0);
    this.lapsRemaining = +(snapshot[dsPre + 'FuelLapsRemaining'] || 0);

    this.render();
  }

  // ─── Rendering ────────────────────────────────────────────

  _render() {
    const template = document.createElement('template');
    template.innerHTML = `
      <style>
        :host {
          display: block;
          background: var(--bg-panel);
          color: var(--text-primary);
          font-family: var(--ff);
          padding: var(--pad);
          border-radius: var(--corner-r);
          border: 1px solid var(--border);
        }

        .fuel-label {
          font-size: var(--fs-xs);
          font-weight: var(--fw-bold);
          text-transform: uppercase;
          color: var(--text-secondary);
          letter-spacing: 0.05em;
          margin-bottom: 4px;
        }

        .fuel-remaining {
          font-size: var(--fs-lg);
          font-weight: var(--fw-semi);
          margin-bottom: 6px;
        }

        .fuel-bar-outer {
          height: 8px;
          background: var(--bg);
          border-radius: 2px;
          overflow: hidden;
          margin-bottom: 6px;
        }

        .fuel-bar-inner {
          height: 100%;
          background: linear-gradient(to right, var(--green), var(--amber), var(--red));
          transition: width 0.2s ease;
        }

        .fuel-bar-inner.flash {
          animation: fuelFlash 0.4s ease-out;
        }

        @keyframes fuelFlash {
          0% { box-shadow: inset 0 0 8px var(--green); }
          100% { box-shadow: none; }
        }

        .fuel-stats {
          font-size: var(--fs-xs);
          color: var(--text-dim);
          display: flex;
          justify-content: space-between;
          gap: 4px;
        }

        .fuel-pit-suggest {
          font-size: var(--fs-xs);
          color: var(--amber);
          font-weight: var(--fw-semi);
          margin-top: 4px;
        }
      </style>

      <div class="fuel-label">Fuel</div>
      <div class="fuel-remaining">— <span class="unit">L</span></div>
      <div class="fuel-bar-outer">
        <div class="fuel-bar-inner" style="width: 0%;"></div>
      </div>
      <div class="fuel-stats">
        <span>Avg <span class="val">—</span> L/lap</span>
        <span>Est <span class="val">—</span> laps</span>
      </div>
      <div class="fuel-pit-suggest"></div>
    `;

    this.shadowRoot.appendChild(template.content.cloneNode(true));
  }

  render() {
    const fuelPct = this.maxFuel > 0 ? (this.fuelLevel / this.maxFuel) * 100 : 0;

    // Update bar
    const bar = this.shadowRoot.querySelector('.fuel-bar-inner');
    if (bar) {
      bar.style.width = fuelPct + '%';

      // Flash animation on significant change
      if (Math.abs(fuelPct - this._prevFuelPct) > 5 && this._prevFuelPct >= 0) {
        bar.classList.add('flash');
        setTimeout(() => bar.classList.remove('flash'), 400);
      }
      this._prevFuelPct = fuelPct;
    }

    // Update text
    const fuelText = this.shadowRoot.querySelector('.fuel-remaining');
    if (fuelText) {
      fuelText.innerHTML = this.fuelLevel > 0
        ? this.fuelLevel.toFixed(1) + ' <span class="unit">L</span>'
        : '— <span class="unit">L</span>';
    }

    const stats = this.shadowRoot.querySelectorAll('.fuel-stats .val');
    if (stats.length >= 2) {
      stats[0].textContent = this.fuelPerLap > 0 ? this.fuelPerLap.toFixed(2) : '—';
      stats[1].textContent = this.lapsRemaining > 0.1 ? this.lapsRemaining.toFixed(1) : '—';
    }

    // Pit suggestion
    const pitSuggest = this.shadowRoot.querySelector('.fuel-pit-suggest');
    if (pitSuggest) {
      pitSuggest.textContent = (this.lapsRemaining > 0 && this.lapsRemaining < 20)
        ? `PIT in ~${Math.ceil(this.lapsRemaining)} laps`
        : '';
    }
  }

  // ─── Data subscription ─────────────────────────────────────

  _subscribeToData() {
    this._telemetryHandler = (e) => {
      if (e.detail) {
        this.updateData(e.detail);
      }
    };
    window.addEventListener('telemetry-update', this._telemetryHandler);
  }
}

customElements.define('racecor-fuel-gauge', RaceCorFuelGauge);
```

**Integration with poll-engine:**

```javascript
// In poll-engine.js, _renderFrame() function:

// Replace this:
// updateFuelBar(fuelPct, 0);

// With this:
const fuelComp = document.querySelector('racecor-fuel-gauge');
if (fuelComp) {
  fuelComp.updateData(p);
}

// And fire event for components subscribed to events:
window.dispatchEvent(new CustomEvent('telemetry-update', {
  detail: p,
  bubbles: false,
  cancelable: false
}));
```

**Testing:**
```html
<!-- dashboard.html -->
<racecor-fuel-gauge></racecor-fuel-gauge>

<!-- Check side-by-side with original -->
<style>
  #old-fuel { display: none; }  /* Hide original during testing */
</style>

<!-- Verify: same colors, same animations, same text formatting -->
```

---

## Next Steps (After Approval)

1. **Create branch:** `feature/web-components-phase1`
2. **Implement Phase 1 components** (7 simple DOM components, ~1 week)
3. **Test side-by-side** in overlay and web app
4. **Benchmark:** Measure CPU/memory impact at 30fps
5. **Gather feedback** from code review
6. **Plan Phase 2** (Canvas + moderate components)
7. **Document** component API (JSDoc, Storybook)
8. **Release:** Components available as npm package (future)

---

## Appendix: Quick Reference

### Component Template (Copy-Paste)

```javascript
/**
 * @element racecor-component-name
 * @description Brief description
 */

class RaceCorComponentName extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._data = {};
  }

  connectedCallback() {
    this._render();
    this._subscribeToData();
  }

  disconnectedCallback() {
    // Cleanup
  }

  _render() {
    // Render shadow DOM template
  }

  updateData(snapshot) {
    // Extract values from snapshot
    // Update internal state
    // Call this.render()
  }

  render() {
    // Update DOM/Canvas with current state
  }

  _subscribeToData() {
    this._handler = (e) => this.updateData(e.detail);
    window.addEventListener('telemetry-update', this._handler);
  }
}

customElements.define('racecor-component-name', RaceCorComponentName);
```

### CSS Variables Checklist

Before defining Shadow DOM styles, check for inherited variables:
- ✓ Colors: `--red`, `--green`, `--blue`, `--amber`, `--orange`, `--cyan`, `--purple`, `--bg`, `--bg-panel`, `--text-primary`, `--text-secondary`, `--text-dim`, `--border`
- ✓ Typography: `--ff`, `--ff-mono`, `--fs-xl`, `--fs-lg`, `--fs-md`, `--fs-sm`, `--fs-xs`, `--fw-black`, `--fw-bold`, `--fw-semi`, `--fw-medium`
- ✓ Spacing: `--edge`, `--gap`, `--pad`, `--panel-gap`, `--corner-r`, `--corner-r-sm`
- ✓ Timing: `--t-fast`, `--t-med`, `--t-slow`

All are available in Shadow DOM via `var(--name)`.

