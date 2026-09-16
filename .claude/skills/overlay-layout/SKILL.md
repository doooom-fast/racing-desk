---
name: overlay-layout
description: |
  Overlay app layout system expert for the Electron HUD.
  Use when working on panel placement, dashboard positioning, CSS grid/flexbox layout,
  corner positions, settings mode, Drive HUD mode, or responsive overlay sizing.
  Triggers: overlay layout, panel position, dashboard placement, corner position, drive HUD,
  settings mode, click-through, frameless window, overlay CSS, panel grid, swap vertical,
  flow direction, zoom, edge spacing.
---

# Overlay Layout System Expert

You are an expert on the layout architecture of the RaceCor Electron overlay HUD. Before making changes, read the key source files.

## Files to Read on Activation

```
racecor-overlay/dashboard.html                       # HTML structure — all panels defined here
racecor-overlay/modules/styles/dashboard.css         # Layout system — positions, grid, flow
racecor-overlay/modules/styles/base.css              # Theme variables, dimensions, spacing
racecor-overlay/modules/js/settings.js               # Settings UI, position/flow controls
racecor-overlay/modules/js/drive-hud.js              # Drive HUD fullscreen layout
racecor-overlay/modules/js/drive-mode.js             # Drive mode DOM creation
racecor-overlay/main.js                              # Electron window config (frameless, click-through, transparency)
```

## Layout Architecture

### Position System

The overlay supports 5 screen positions, selected in settings:

| Class | Position | Description |
|-------|----------|-------------|
| `layout-tl` | Top-left | Panels flow right and down |
| `layout-tr` | Top-right (default) | Panels flow left and down |
| `layout-bl` | Bottom-left | Panels flow right and up |
| `layout-br` | Bottom-right | Panels flow left and up |
| `layout-ac` | Absolute center | Centered on screen |

Each position class controls:
- **Flow direction** — LTR or RTL column arrangement
- **Vertical alignment** — Top-down or bottom-up stacking
- **Edge offset** — `--edge` (CSS var, default 8px), overridden by JS as `--edge-z` for zoom compensation

### Panel Structure

`dashboard.html` defines the panel hierarchy:

```
.dashboard-container
  ├── .column.main          # Primary telemetry (tacho, speed, gear, lap timer)
  ├── .column.secondary     # Data panels (fuel, tyres, controls, pedals)
  ├── .column.tertiary      # Track map, position card, rating gauges
  ├── .panel.leaderboard    # Full-width leaderboard
  ├── .panel.commentary     # Slide-in commentary overlay
  ├── .panel.race-control   # Full-width race control banner
  ├── .panel.pit-limiter    # Pit speed overlay
  └── .panel.race-end       # Results screen
```

Panels use Web Components (Shadow DOM) for style isolation. Each `<racecor-*>` component manages its own internal layout.

### CSS Variables (Layout-Related)

```css
--corner-r: 8px;           /* Panel border radius */
--dash-h: 200px;           /* Base dashboard height */
--row-h: calc((var(--dash-h) - var(--gap)) / 2);  /* Half-height row */
--gap: 4px;                /* Inter-panel gap */
--edge: 8px;               /* Screen edge offset */
--edge-z: var(--edge);     /* Zoom-compensated edge (set by JS) */
```

### Zoom Compensation

JS sets `--edge-z` based on the current window zoom level to maintain consistent edge spacing regardless of zoom. This is critical for maintaining panel alignment at different DPR/zoom levels.

### Settings Mode (Ctrl+Shift+S)

When settings mode is active:
- Window becomes **not** click-through (receives mouse events)
- Drag handle appears for repositioning the overlay
- Edge handles appear for resizing
- Settings panel opens with position, flow direction, and panel toggles
- Position and size persist via Electron IPC → JSON file

### Drive HUD Mode (Ctrl+Shift+F)

Fullscreen driving-focused display:
- Hides all broadcast/stream panels
- Shows only: track map, sectors, lap delta, position, spotter, incidents
- Different layout rules (centered, maximized)
- `drive-hud.js` manages this mode's DOM and layout

### Window Properties (Electron)

Set in `main.js`:
- `transparent: true` — Native transparency (x64) or green chroma key (ARM)
- `frame: false` — No title bar
- `alwaysOnTop: true` — Above game window
- `focusable: false` + click-through flag — Game receives all input
- `skipTaskbar: true` — Not visible in taskbar

### Panel Toggle System

Each dashboard section can be toggled on/off via settings. Panels are shown/hidden via CSS class toggles (`display: none`), not DOM removal. This preserves state and avoids re-initialization costs.

## Rules

1. **No build step** — All CSS is plain `.css` files loaded via `<link>`. No preprocessors, no CSS modules, no Tailwind.
2. **CSS custom properties for layout values** — Don't hardcode pixel values. Use `--dash-h`, `--gap`, `--edge`, `--corner-r`.
3. **Position classes are mutually exclusive** — Only one `layout-*` class on `.dashboard-container` at a time.
4. **Web Components for panels** — New panels should be implemented as `<racecor-*>` custom elements with Shadow DOM.
5. **Click-through by default** — The overlay must not intercept mouse events unless in settings mode.
6. **Zoom compensation** — Any layout depending on `--edge` should use `--edge-z` instead for zoom-safe behavior.
7. **ARM compatibility** — Layout must work with both native transparency (x64) and green-screen chroma key (ARM).
8. **30fps render budget** — Layout changes should not cause reflows that impact the 33ms frame budget. Prefer CSS transitions over JS layout recalculation.
