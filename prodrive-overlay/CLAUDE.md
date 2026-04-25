# RaceCor Overlay — Electron HUD

Standalone Electron overlay that renders real-time sim racing telemetry as a transparent HUD on top of the game. Designed for stream overlays and broadcast production.

## Integration Contract (Overlay ↔ Plugin)

This overlay is the **consumer** side of the telemetry pipeline. The plugin (`racecor-plugin/simhub-plugin/`) is the **producer**. See also: [root CLAUDE.md](../CLAUDE.md) for the full end-to-end data flow.

- **HTTP API**: `GET http://localhost:8889/racecor-io-pro-drive/`
- **Response**: Flat JSON object with 100+ properties (telemetry, commentary, strategy)
- **Polling**: `fetchProps()` in `poll-engine.js` issues a GET every 33ms (~30fps)
- **Backoff**: Exponential on failure (1s → 2s → 4s → 8s, capped at 10s)
- **Demo mode**: Reads from `RaceCorProDrive.Plugin.Demo.*` properties instead — switching is transparent
- **Contract rule**: Any change to JSON property names consumed by this overlay must be coordinated with `racecor-plugin/`

## Tech Stack

- **Electron** — frameless, always-on-top, click-through window
- **Vanilla JS** — no framework, intentional for 30fps render performance. Do NOT introduce React/Vue/etc.
- **WebGL2** — fragment shader pipeline for post-processing effects (glare, bloom, vignette)
- **Canvas 2D** — fallback and auxiliary rendering
- **Plain CSS** — `.css` files loaded via `<link>` (NOT CSS modules), custom properties for theming
- **No build step** — all JS modules loaded directly by the HTML, no bundler

## Key Files

| What | Path |
|------|------|
| HTML entry | `dashboard.html` |
| Electron main process | `main.js` |
| Preload / context bridge | `preload.js` |
| JS modules | `modules/js/*.js` |
| CSS modules | `modules/styles/*.css` |
| Reusable UI components | `modules/components/` |
| Playwright tests | `tests/` |
| Playwright config | `playwright.config.mjs` |
| Stream Deck integration | `streamdeck/` |
| Electron builder config | `electron-builder.yml` |

## Architecture

```
main.js (Electron main process)
  → Window management, transparency, screen capture (ambient light), settings IPC, hotkeys, crash recovery, LAN server

preload.js (context bridge)
  → k10.getSettings(), k10.saveSettings(), k10.onSettingsMode(), k10.onAmbientColor()

dashboard.html (renderer — 28+ JS modules, 10 CSS modules, WebGL2 pipeline)
  → poll-engine.js: fetchProps() at ~30fps → routes data to all modules
  → config.js: property subscriptions, state management, demo mode switching
  → webgl.js + webgl-helpers.js: fragment shaders (glare, bloom, glow, g-force vignette)
  → ambient-light.js + ambient-capture.js: screen color sampling → CSS variable updates
  → Module per panel: track-map, leaderboard, spotter, pitbox, sector-hud, commentary, etc.
```

## Module Map

| Module | Purpose |
|--------|---------|
| `poll-engine.js` | Telemetry polling, data routing, commentary/strategy display |
| `config.js` | Property subscriptions, state management, demo mode switching |
| `webgl.js` | WebGL2 fragment shader — glare, bloom, glow, vignette |
| `webgl-helpers.js` | Shader compilation, icon atlas generation |
| `ambient-light.js` | Screen color sampling via desktopCapturer, LERP interpolation |
| `ambient-capture.js` | Capture region UI configuration |
| `drive-hud.js` | Fullscreen driving-focused HUD mode |
| `leaderboard.js` | Full-field position/gap leaderboard |
| `datastream.js` | Live telemetry data stream display |
| `spotter.js` | Proximity overlay with directional indicators |
| `pitbox.js` | Pit strategy management (tabbed: fuel, tires, pit options) |
| `sector-hud.js` | Sector timing with brightness-coded performance |
| `track-map.js` | SVG minimap with heading-up rotation, smooth CSS transitions |
| `game-logo.js` | Manufacturer detection + logo rendering |
| `car-logos.js` | Manufacturer name → logo path resolution |
| `game-detect.js` | Active sim detection |
| `settings.js` | Settings panel UI + JSON persistence via Electron IPC |
| `connections.js` | Connection management + remote LAN access |
| `keyboard.js` | Global hotkey handling |
| `commentary.js` | Commentary panel slide-in/out animation |

## Deployment Modes

`dashboard.html` powers three modes:
1. **Electron Overlay** (primary) — standalone app, always-on-top, click-through, hotkeys
2. **SimHub Dashboard Template** — installs as a SimHub template, uses `$prop()` API instead of HTTP
3. **Browser Access** — open in any browser while SimHub runs, auto-detects and falls back to HTTP polling
4. **LAN Remote** — built-in HTTP server for serving to other devices on the network

## Code Style

- **Vanilla JS only** — no frameworks, no TypeScript, no bundler. This is intentional for 30fps performance.
- **CSS**: plain `.css` files loaded via `<link>`. Custom properties for theming. NOT CSS modules.
- **WebGL shaders**: inlined as template strings in JS files
- **Animations**: driven by CSS transitions triggered by class changes, not JS animation loops
- **DOM updates**: direct DOM manipulation in `pollUpdate()`, routed from the single `fetchProps()` call

## iRacing Data Sync

iRacing data (session results, ratings, track maps) is synced via two mechanisms — both use the SimHub plugin HTTP API, not direct iRacing scraping:

1. **Auto-sync** (`session-sync.js`): captures session start/end data automatically, posts to `/api/sessions` with track name resolution and dedup
2. **Post-race poll** (`/api/iracing/latest`): imports recent races from iRacing's official API, upgrades auto-synced sessions with richer data when matched by `subsessionId`

The previous approach (Electron BrowserWindow + DOM scraping of iRacing's Angular site) was removed — it never reliably worked on Windows and all its responsibilities are now handled by the plugin API path.

## Design System

The overlay consumes design tokens generated by the web project's Style Dictionary pipeline. See [root CLAUDE.md](../CLAUDE.md) for the cross-project design system details.

- Token CSS files: `modules/styles/`
- Three visual modes: Standard, Minimal, Minimal+
- Theme switching via CSS custom property overrides

## Running

```bash
npm install && npm start          # Normal mode
npm run start:safe                # ARM/software rendering mode
```

## Testing

```bash
npx playwright test               # Playwright tests in tests/
```

CI: `dashboard-ci.yml` runs Playwright tests on every push/PR.

## Hotkeys

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+S` | Toggle settings/move mode |
| `Ctrl+Shift+F` | Toggle Drive HUD mode (fullscreen) |
| `Ctrl+Shift+H` | Hide/show overlay |
| `Ctrl+Shift+G` | Toggle green-screen mode |
| `Ctrl+Shift+R` | Reset position and size |
| `Ctrl+Shift+D` | Restart demo sequence |
| `Ctrl+Shift+Q` | Quit |
