---
name: overlay-webgl
description: |
  Overlay WebGL system expert for the Electron HUD's real-time visual effects.
  Use when working on the tachometer glow, bloom effects, post-processing shaders,
  g-force vignette, glare canvas, or any GPU-rendered visual effects.
  Triggers: WebGL, shader, GLSL, fragment shader, bloom, glow, glare, vignette,
  tachometer effects, post-processing, GPU, render pipeline.
---

# Overlay WebGL System Expert

You are an expert on the WebGL2 visual effects pipeline in the RacingDesk overlay. Before making changes, read the source files.

## Files to Read on Activation

```
racing-desk-overlay/modules/js/webgl.js                  # Main WebGL pipeline (112KB) — shaders, bloom, glow, vignette
racing-desk-overlay/modules/js/webgl-helpers.js           # Tachometer segments, pedal bars, shader utilities (55KB)
racing-desk-overlay/modules/styles/effects.css            # Effect CSS (glow animations, vignettes)
```

## WebGL Pipeline Architecture

### Overview

The overlay uses a **fullscreen WebGL2 fragment shader system** for real-time visual effects driven by telemetry data. This is NOT a 3D scene — it's a 2D post-processing pipeline applied as an overlay canvas on top of the dashboard panels.

### Render Pipeline

```
Telemetry snapshot (every 33ms)
  → Extract: RPM, throttle, brake, G-force, flags, gear
  → Update shader uniforms
  → Single fullscreen quad draw call
  → Fragment shader computes per-pixel effects:
      • Center glow (RPM + throttle driven)
      • Bloom pulse (RPM zones)
      • Light sweep (periodic)
      • Panel glow (per-panel illumination from telemetry)
      • Dome specular (simulated glass highlight)
      • G-force vignette (lateral G → edge darkening)
      • RPM redline (intensified at high RPM)
  → Composite over dashboard via CSS layering
```

### Key WebGL Components

**webgl.js** (112KB) — The main effects module:
- Creates WebGL2 context on a fullscreen canvas
- Compiles and links fragment shaders (inlined as template strings)
- Updates uniforms from telemetry each frame
- Manages the render loop (synced with rAF, not polling)
- Handles DPR (device pixel ratio) compensation for retina displays

**webgl-helpers.js** (55KB) — Supporting renders:
- **Tachometer segment bar** — 11 segments, lit left-to-right based on RPM percentage
  - Color zones: `lit-green` (low), `lit-yellow` (mid), `lit-red` (high), `lit-redline` (>95%)
  - Pulse animation on segment transitions
- **Pedal histogram bars** — 20 vertical bars per pedal (throttle/brake/clutch)
  - DOM-based (not canvas), updated per frame via `scaleY(data[i])`
  - Live scaling with current input value
- **Shader compilation utilities** — Compile/link helpers with error logging

### Glare Canvas

All panel edge glows are rendered in a single WebGL pass on one canvas rather than per-panel WebGL contexts. This solves z-order issues and reduces GPU context overhead.

The glare canvas renders at **half device-pixel-ratio** for performance — the glow effects don't need full resolution.

### Who runs the effects

Only the rig's HUD over the game. The glance layout (the iPad's page, `/obs-ipad`, Ctrl+Shift+F) and the HUD page in OBS (`/obs`) never start the effects loop (`fxAllowed()` in `webgl.js`), and the iPad's and OBS's pages make no WebGL context (`NO_FX_PAGE`). There is no ambient light: the screen-capture colour, its CSS variables, the glare pass's ambient glow and glass dome were removed on 2026-10-07.

### Effect Types

| Effect | Shader Input | Visual Result |
|--------|-------------|---------------|
| Center glow | RPM %, throttle % | Bright spot at dashboard center |
| Bloom pulse | RPM zone (green/yellow/red) | Pulsing brightness on zone change |
| Light sweep | Time (periodic) | Moving highlight across dashboard |
| Panel glow | Per-panel telemetry values | Individual panel edge illumination |
| G-force vignette | Lateral G value | Screen edge darkening proportional to G |
| RPM redline | RPM > 95% of max | Intensified red glow + flash |

### CSS Effects (Non-WebGL)

`effects.css` (37KB) handles effects that don't need GPU shaders:
- Race control banner flag stripe animation
- Commentary panel border glow + backdrop blur
- Incident coach cool-down vignette fade
- Panel hover/active states

## Performance

### Frame Budget

The overlay targets 30fps (33ms per frame). WebGL effects share this budget with polling and DOM updates:
- Polling: ~2ms
- DOM updates: ~5ms
- WebGL draw: ~3ms
- **Available headroom**: ~23ms

### Optimization Techniques

1. **Half-DPR glare canvas** — Glow effects rendered at 50% resolution
2. **Single fullscreen quad** — One draw call for all post-processing
3. **Uniform batching** — All telemetry values sent to shader in one update
4. **rAF-synced** — WebGL renders on requestAnimationFrame, not on poll
5. **No texture uploads per frame** — Shader operates on uniforms only
6. **Shader branching** — Effects disabled by setting their intensity uniform to 0

## Rules

1. **Shaders are inlined** — GLSL source lives as template strings inside `webgl.js`. Don't move them to separate `.glsl` files (breaks the no-build constraint).
2. **WebGL2 only** — The pipeline uses WebGL2 features. No WebGL1 fallback.
3. **DPR compensation** — All canvas sizing must account for `window.devicePixelRatio`. The glare canvas intentionally halves this.
4. **No external GL libraries** — No Three.js, no Babylon.js, no REGL. Everything is raw WebGL2 calls.
5. **Uniform names are API** — Shader uniform names are referenced from JS. Renaming requires updating both the GLSL and JS.
6. **No screen capture** — nothing in the app samples the screen for the HUD's light; don't add it back.
7. **CSS effects complement WebGL** — Some effects are pure CSS (backdrop-blur, keyframe animations). Use CSS when GPU shaders aren't needed.
8. **ARM fallback** — On ARM devices, WebGL may use software rendering. Effects should degrade gracefully (reduce complexity, not crash).
