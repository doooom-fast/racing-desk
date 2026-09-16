---
name: overlay-dataviz
description: |
  Overlay data visualization expert for the Electron HUD's real-time telemetry displays.
  Use when working on gauges, charts, histograms, canvas rendering, tachometer display,
  leaderboard, race timeline, pedal traces, G-force visualization, tire grid, fuel gauge,
  or any data-driven visual component in the overlay.
  Triggers: overlay chart, gauge, histogram, canvas, tachometer, leaderboard, race timeline,
  pedal trace, G-force, tire display, fuel display, position card, sparkline, data stream,
  commentary viz, sector timing, track map, SVG.
---

# Overlay Data Visualization Expert

You are an expert on the data visualization components in the RaceCor overlay HUD. All viz runs at 30fps with no framework — vanilla JS, Canvas 2D, SVG, and DOM manipulation.

## Files to Read on Activation

Read the specific visualization module you're working on:

```
# Canvas-based visualizations
racecor-overlay/modules/js/commentary-viz.js         # Multi-type telemetry charts (35KB)
racecor-overlay/modules/js/datastream.js             # G-force circle + yaw waveform (12KB)
racecor-overlay/modules/js/pedal-curves.js           # Pedal response curves + histograms (19KB)

# DOM-based visualizations
racecor-overlay/modules/js/leaderboard.js            # Position table + sparklines (14KB)
racecor-overlay/modules/js/race-timeline.js          # Position history heatmap strip (6KB)
racecor-overlay/modules/js/spotter.js                # Gap messages + stacking (17KB)

# SVG-based visualizations
racecor-overlay/modules/js/track-map.js              # SVG minimap with heading-up rotation
racecor-overlay/modules/js/sector-hud.js             # Sector timing display

# Hybrid (DOM + Canvas)
racecor-overlay/modules/js/webgl-helpers.js          # Tachometer segments, pedal bars (55KB)
racecor-overlay/modules/js/drive-mode.js             # Drive mode tacho SVG + spotter gaps (28KB)

# Web Components (Shadow DOM encapsulated)
racecor-overlay/modules/components/tachometer.js
racecor-overlay/modules/components/tire-grid.js
racecor-overlay/modules/components/fuel-gauge.js
racecor-overlay/modules/components/gap-display.js
racecor-overlay/modules/components/position-card.js
racecor-overlay/modules/components/leaderboard.js
racecor-overlay/modules/components/datastream.js
racecor-overlay/modules/components/commentary-viz.js
racecor-overlay/modules/components/pedal-curves.js
racecor-overlay/modules/components/race-timeline.js

# Data flow
racecor-overlay/modules/js/poll-engine.js            # Data routing from API to modules (66KB)
racecor-overlay/modules/js/config.js                 # Property keys, state (30KB)
```

## Visualization Inventory

### Canvas 2D Renders

**Commentary Viz** (`commentary-viz.js`) — Multi-type chart system driven by commentary events:

| Type | Description | Key Params |
|------|-------------|-----------|
| `gauge` | Arc gauge with color zones | green < 55%, yellow < 73%, red ≥ 91% |
| `line` | Rolling time-series | 60-sample buffer (2s at 30fps) |
| `g-force` | 2D dot plot (lateral × longitudinal) | Centered origin, ±range |
| `bar` | Horizontal bars with labels | Value + unit + label |
| `delta` | Centered zero bar (+/−) | Positive = right, negative = left |
| `quad` | Four-corner display | Tire temps/pressures per corner |
| `counter` | Large numeric (no canvas) | DOM-based |
| `grid` | Grid layout | Multi-value display |

Topic-based config maps each commentary event ID to a viz type and data binding.

**Datastream** (`datastream.js`) — Real-time telemetry monitor:
- **G-force circle**: Lateral vs longitudinal acceleration, 40-sample trail buffer, peak G tracking
- **Yaw rate waveform**: 80-sample ring buffer, scrolling trace
- Re-initialized on viewport DPR change

**Pedal Curves** (`pedal-curves.js`) — Input visualization:
- Throttle/brake/clutch response curves overlaid on histogram
- 20-bar histogram per pedal (height-scaled)
- Curve-following dot shows current position
- Fallback to time-series waveform if no profile loaded

### DOM-Based Renders

**Tachometer Segments** (`webgl-helpers.js`):
- 11-segment bar, lit left-to-right by RPM percentage
- Color classes: `lit-green`, `lit-yellow`, `lit-red`, `lit-redline`
- Pulse animation on zone transitions

**Pedal Histogram Bars** (`webgl-helpers.js`):
- 20 vertical DOM bars per pedal
- Updated via `transform: scaleY(data[i])` per frame
- Current percentage displayed above each column

**Leaderboard** (`leaderboard.js`):
- Table: position, driver name, interval gap, gap-to-leader, lap count
- Sparkline history: 12 samples per driver (canvas mini-chart)
- Focus modes: `'me'` (relative to player), `'lead'` (absolute leader)
- Deduplication on data change + settings version key

**Race Timeline** (`race-timeline.js`):
- Horizontal heat-mapped color strip showing position history
- Color: blue (neutral), green (gained), red (lost)
- Heat intensity scales with delta (clamped ±5 positions)
- Event markers: pit stop, off-track, damage, checkered flag
- Max 310 samples (one per lap/snapshot)

**Spotter** (`spotter.js`):
- Gap-ahead/behind messages with driver names and iRating
- Stacking system (max 3 visible messages)
- Flash green on overtake, red on position loss
- SVG directional icons

### SVG-Based Renders

**Track Map** (`track-map.js`):
- SVG minimap from plugin's track path data
- Heading-up rotation (direction of travel always points up)
- Player dot (bright) centered, opponents as smaller dim dots
- 150ms CSS transition on rotation for smoothness
- Automatic fallback if no track SVG data available

**Sector HUD** (`sector-hud.js`):
- Per-sector split times with brightness-coded performance
- Supports native iRacing sector boundaries (up to 7+ sectors)
- Fallback to equidistant 3-sector splits
- Resets cleanly on track changes

### Position Card

**Rating Gauges** (`position-card.js` / `<racecor-position-card>`):
- iRating: horizontal fill bar (0-5000 scale)
- Safety Rating: circular progress indicator (0-4.00)
- Cycling display: alternates between ratings and gap pages every 45s

## Web Component Pattern

All visualization panels use Custom Elements with Shadow DOM:

```javascript
class RacecorTachometer extends HTMLElement {
  connectedCallback() {
    this._renderTemplate();    // Inject Shadow DOM HTML
    this._cacheElements();     // querySelector references
    this._subscribeToData();   // Listen for telemetry-update events
  }
  
  updateData(snapshot) {       // Called by poll-engine.js
    // Read relevant properties from snapshot
    // Update DOM/canvas/SVG
  }
}
customElements.define('racecor-tachometer', RacecorTachometer);
```

Data flow: `poll-engine.js → _renderFrame(snapshot) → component.updateData(snapshot)`

## Rules

1. **Vanilla JS only** — No React, no D3, no Chart.js. Raw Canvas 2D, SVG, and DOM.
2. **33ms frame budget** — All viz updates must complete within the polling interval. Use `requestAnimationFrame` for heavy canvas work.
3. **Shadow DOM for panels** — New visualization panels must be Custom Elements with Shadow DOM for style isolation.
4. **Ring buffers for history** — Use fixed-size arrays with wrap-around index (not `push`/`shift` which causes GC). See datastream.js yaw buffer pattern.
5. **DPR-aware canvas** — All canvas sizing must multiply by `window.devicePixelRatio` and set `context.scale()`. Re-initialize on DPR change.
6. **Dedup before render** — Check if data actually changed before re-rendering. The leaderboard pattern (hash + version key) is the standard.
7. **Color from CSS vars** — Read colors from CSS custom properties, not hardcoded hex. This enables theming.
8. **No external chart libraries** — Everything is hand-rolled for performance and zero-dependency constraints.
9. **Delta color coding** — Positive delta = green, negative = red. Purple = personal best. Amber = slightly slow. This is universal across all timing displays.
