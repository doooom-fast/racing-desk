# RacingDesk — Dashboard Overlay

A standalone Electron overlay that renders real-time sim racing telemetry as a transparent HUD on top of your sim. Designed for stream overlays and broadcast production — it composites directly over the game window with no capture card or secondary monitor required. Also, as the glance layout (Ctrl+Shift+F, and what an iPad on the home network is shown), a full-screen data display of every panel.

This is the Electron half of The Racing Desk: the HUD (`dashboard.html`) and the desk window (`desk.html`), one app. It is built by `npm run build` at the monorepo root into `dist/win-unpacked/Racing Desk.exe` and starts its own RacingDesk.Host — there is no installer; see the root `CLAUDE.md`, Desk. **The HUD is on screen only while the driver is in the car** ([below](#when-the-hud-is-on-screen)). A sibling repo, [`prodrive-overlay-showcase`](https://github.com/DOOOOM/prodrive-overlay-showcase), holds the same code with a `showcase-bootstrap.js` that drives it from synthesized data — used in the marketing-site iframe.

**Beyond the live HUD,** today's overlay also handles **race recording** (produces `.rcpdv` bundles = MP4 + telemetry sidecar via `recorder.js` + `ffmpeg-encoder.js`), **in-overlay replay** (`replay-director.js` for scrubbing the captured race), **Race Coach** (live Claude AI commentary via direct calls to `api.anthropic.com` from `race-coach.js` — uses your own Anthropic API key), **voice commentary** (`voice-coach.js`), and **incident coaching** (`incident-coach.js`). 51 modules in `modules/js/` total — the table below covers the live-HUD subset.

![Dashboard Screenshot](../racing-desk-plugin/docs/dashboard-screenshot.png)

## Overview

The dashboard connects to the telemetry's HTTP API — the RacingDesk SimHub plugin's, or the app's own RacingDesk.Host when SimHub is not running — and renders telemetry data at ~30fps. It runs as a frameless, always-on-top, click-through window so the game receives all mouse and keyboard input normally; the window is hidden until the driver is in the car, and is shown without taking the focus from the sim. On systems that support native transparency (x64 Windows), the window background is fully transparent. On ARM devices (Surface Pro, Snapdragon laptops), it uses a green chroma key background for OBS Color Key compositing.

The `dashboard.html` file powers three deployment modes: the Electron overlay (this app), the SimHub built-in dashboard template, and direct browser access via the plugin's HTTP server.

## Quick Start

### Prerequisites

- Node.js 18+
- Telemetry on port 8889: SimHub with the RacingDesk plugin enabled, or RacingDesk.Host, which the app starts for itself (`npm run build:host` at the monorepo root, once)
- **iRacing users, beside SimHub:** The [iRacing Extra Properties](https://drive.google.com/drive/folders/1AiIWHviD4j-_D-zgRrjJU1AFhJ_xmass) plugin by RomainRob (required for iRating and Safety Rating display)

### Install and Run

From the monorepo root:

```bash
npm install
npm start -w racing-desk-overlay     # from source; the built app is `npm run build`, then Racing Desk.exe
```

The desk window opens and a tray icon goes up. Nothing of the HUD is on screen yet: it comes up when you get in the car, and goes again two seconds after you get out. For ARM hardware, use safe mode: `npm run start:safe`

### When the HUD is on screen

Only while the driver is in the car, he has not switched the HUD off, and the page is loaded. The window is made hidden; `modules/js/hud-visibility.js`, in the main process, is the only thing that shows it (`showInactive`, so the sim keeps the focus) and hides it. It asks the telemetry once a second — twice in the car — and tells the page, which polls and draws only while he is in. Nothing is ever quit to get the HUD off the screen.

- **In the car** is one rule, `inCar` in `modules/js/in-car.js`: demo mode; or the sim running and iRacing's own `IsOnTrack`, which RacingDesk.Host sends — so the sim's menus, the garage screen and a replay are out of the car. From a source that sends no `IsOnTrack` (a SimHub plugin from before 2026-09-29) a session under way counts as in the car, garage and replay included.
- **Getting out** is believed after two seconds, so the HUD does not blink between sessions; a telemetry that has not answered for three seconds is out of the car too.
- **The switch.** The tray's "HUD on/off" works anywhere, and its tick shows where it stands. `Ctrl+Shift+H` and the Stream Deck's button work only in the car, where what they do is seen; out of the car they do nothing, and their answer says so (`{ ok: false, reason: 'out of the car' }`). Off stays off — through getting out and in again — until it is switched on, or the app is started again.
- **A page that dies** is loaded again two seconds later, whatever the reason but a clean exit, three times at most without a load finishing; after that, once more each time he gets in the car.
- **Back in the car after a break in the telemetry** the page starts clean: no backoff left over, and one poll at once.
- **Dev mode** (`npm run dev`) leaves the window on screen whatever the car is doing.

### The desk

The other window: **Desk**, **Cars** and **Settings**, switched from its masthead, the tray menu or `Ctrl+Shift+O`. Cars is every car on the rig and, for the one chosen, its liveries, the view it was last driven with and its pedals — Paints was a page of its own until 2026-09-29, and `paints` as a page's name still leads to Cars. Settings edits the HUD's `overlay-settings.json` and each change reaches the HUD live. Closing the desk window quits the app; minimise it to keep the HUD while racing. See the root `CLAUDE.md`, Desk.

### Log

From source the main process logs to `racing-desk-debug.log` in this folder. The built app logs to `%LOCALAPPDATA%\Racing Desk\overlay.log`, beside the host's `host.log` — "In the car → HUD on screen", "Out of the car → HUD hidden" and the rest are there. Past 4 MB the file becomes `overlay.log.1` (from source, `racing-desk-debug.log.1`) and a new one is begun.

### Hotkeys

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+H` | Switch the HUD off or on — in the car only; out of it, use the tray's "HUD on/off" |
| `Ctrl+Shift+O` | Open the desk |
| `Ctrl+Shift+F` | Toggle the glance layout (fullscreen data display, as an iPad is shown) |
| `Ctrl+Shift+G` | Toggle green-screen mode (restarts) |
| `Ctrl+Shift+R` | Put the HUD's window back over the whole screen it belongs on (the one iRacing is on) |
| `Ctrl+Shift+D` | Restart demo sequence |
| `Ctrl+Shift+M` | Reset the track map |
| `Ctrl+Shift+V` | Start or stop recording |
| `Ctrl+Shift+B` | Save the replay buffer |
| `Ctrl+Shift+P` | Start or stop the replay director |
| `Ctrl+Shift+I` | Held by the app; nothing listens for it now |
| `Ctrl+Shift+Q` | Quit the overlay: the HUD is put away, and the app keeps running. Bring it back with `Ctrl+Shift+H` in the car, or the tray's "HUD on/off" |

Only `Ctrl+Shift+O` is held for as long as the app runs. The rest are the HUD's, and are held only while you are
in the car: out of it they are the computer's, for whatever other program uses them.

To quit the app itself, close the desk window or choose "Quit Racing Desk" from the tray icon.

## Dashboard Panels

### Main HUD

**Tachometer and Speed** — Large gear indicator (top-left), RPM readout (top-right), speed below. The tachometer bar segments fill from green through yellow to red as RPM approaches redline, flashing when RPM exceeds 95% of max.

**Live Lap Timer** — Current lap time displayed with a real-time delta-to-best overlay. The delta is color-coded: purple (PB pace), green (faster than best), amber (slightly slower), red (1s+ slower). Absolutely positioned so it never affects the lap counter layout regardless of digit count.

**Rating and Gaps (Cycling)** — Alternates between two pages every 45 seconds. Page 1 shows iRating with a horizontal fill bar (scaled 0–5000) and Safety Rating with a circular progress indicator (0–4.00). Page 2 shows current race position, gap to car ahead and behind with driver names and iRating values. Gaps flash green on overtakes and red when losing positions.

**Track Map** — SVG minimap rendered from the plugin's track path data. The player's car appears as a bright dot, centered at all times with heading-up rotation so the direction of travel always points upward. Opponents appear as smaller dim dots. Smooth 150ms CSS transition on rotation.

**Sector Timing** — Per-sector split times with brightness-coded performance indicators. Supports native iRacing sector boundaries (up to 7+ sectors) with automatic fallback to equidistant 3-sector splits. Resets cleanly on track changes.

**Pedal Traces** — Three side-by-side histogram columns showing throttle (green), brake (red), and clutch (blue) input traces. Each is a rolling 20-sample window. Current percentage displayed above each column.

**Controls (BB / TC / ABS)** — Brake bias percentage, traction control level, and ABS level with small vertical fill indicators. TC and ABS auto-hide if the car doesn't expose those channels.

**Fuel** — Current fuel level in liters with a color-transitioning bar (green → amber → red). Below: average consumption per lap, estimated laps remaining, and a "PIT in ~N laps" warning when fuel won't last the race distance.

**Tyres** — 2×2 grid of tyre temperatures in °F with heat-map background coloring (blue → green → red). Wear percentage drives cell opacity — worn tyres appear muted.

**Logo Column** — RacingDesk logomark (top) and auto-detected manufacturer logo (bottom). Supports Porsche, BMW, Ferrari, McLaren, Mazda, Nissan, Dallara, and more. The game logo is placed in the diagonally opposite corner from the dashboard to avoid overlapping secondary panels.

### Secondary Panels

**Leaderboard** — Full-field position table with interval gaps and gap-to-leader columns. Updates in real-time as positions change.

**Datastream** — Live telemetry data stream showing raw and computed values for debugging and analysis.

**Incidents** — Incident count tracker with configurable penalty and DQ thresholds.

**Spotter** — Proximity overlay showing nearby cars with directional indicators.

**Pitbox** — Pit strategy management panel with tabbed navigation for fuel, tires, and pit options. Navigable via wheel buttons or Stream Deck through the plugin's registered actions.

### Race Overlays

**Race Control Banner** — Full-width overlay for race control messages (flags, cautions, session changes).

**Pit Limiter** — Speed overlay that activates when the pit limiter is engaged, showing current speed against the pit lane limit.

**Race End Screen** — Results display at the end of a race session.

### Commentary Panel

Slides in from the edge when the commentary engine fires an event. Shows topic title, commentary text, and category label. The panel border and background tint match the event's sentiment color — orange for warnings, red for critical, blue for informational, amber for strategy calls. Auto-dismisses when the event expires.

### The glance layout (drive mode)

Toggle with `Ctrl+Shift+F` for a fullscreen data display, and it is what an iPad on the home network is shown. Every panel of the HUD — the place and the live lap with its delta, the gaps ahead and behind, the tacho, the full circuit and the local view of it, the leaderboard with its sparklines, a laps panel (last, best and optimal laps, the sectors, the gaps to each, the fuel to the flag), the ratings, the car's controls, the pedals, the badges, the clock, the tyres, fuel and weather, the datastream and the incidents — is laid out as the cells of one grid that fills the screen, in the HUD's glass, type and colours, each sized from its cell. When a flag is out the whole background is that flag.

## Visual Effects

### WebGL Post-Processing

A fullscreen WebGL2 fragment shader system (`webgl.js`) provides real-time visual effects driven by telemetry:

- **Center glow** and **bloom pulse** — dynamic brightness based on RPM and throttle
- **Light sweep** — periodic sweep effect across the dashboard
- **Panel glow** — individual panel illumination that responds to telemetry values
- **Dome specular** — simulated glass dome highlight
- **G-force vignette** — screen edge darkening proportional to lateral G-forces
- **RPM redline** — intensified glow effect at high RPM

The glare canvas renders at half device-pixel-ratio for performance. Per-frame timing and draw call counts are exposed via `window._glarePerf` for monitoring.

### Ambient Light Engine

The Electron main process captures a configurable screen region at ~4fps using `desktopCapturer`, extracts the dominant color, and sends it to the renderer via IPC. The ambient light module (`ambient-light.js`) uses LERP color interpolation to smooth transitions and updates CSS custom variables that drive glass refraction `::after` pseudo-elements on all panels. Two modes: matte and reflective.

## Architecture

```
┌──────────────────────────────────────────┐
│  SimHub + RacingDesk Plugin         │
│  ┌─────────────────────────────────────┐ │
│  │ HTTP Server (port 8889)             │ │
│  │ GET /racing-desk/           │ │
│  │ → flat JSON: 100+ properties        │ │
│  │   (telemetry, commentary, strategy) │ │
│  └─────────────────────────────────────┘ │
└───────────────────┬──────────────────────┘
                    │ HTTP GET (~30fps)
┌───────────────────▼──────────────────────┐
│  RacingDesk (Electron)              │
│  ┌─────────────────────────────────────┐ │
│  │ main.js         (main process)      │ │
│  │ • Window management + transparency  │ │
│  │ • Screen capture (ambient light)    │ │
│  │ • Settings persistence (IPC)        │ │
│  │ • Global hotkeys                    │ │
│  │ • Crash recovery                    │ │
│  │ • Remote LAN server                 │ │
│  ├─────────────────────────────────────┤ │
│  │ preload.js      (context bridge)    │ │
│  │ • k10.getSettings()                 │ │
│  │ • k10.saveSettings()               │ │
│  │ • k10.onSettingsMode()             │ │
│  │ • k10.onAmbientColor()            │ │
│  ├─────────────────────────────────────┤ │
│  │ dashboard.html   (renderer)         │ │
│  │ • 51 JS modules (no build step)     │ │
│  │ • 10 CSS modules                    │ │
│  │ • WebGL2 shader pipeline            │ │
│  │ • Polling loop (fetchProps ~30fps)  │ │
│  │ • Settings overlay UI               │ │
│  │ • Recording → .rcpdv bundles        │ │
│  │ • Race Coach → Anthropic API        │ │
│  └─────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

### Data Flow

1. The SimHub plugin serves all telemetry, commentary, and strategy state as a flat JSON object at `/racing-desk/` over HTTP on port 8889.

2. While the driver is in the car, `pollUpdate()` (`poll-engine.js`) calls `fetchProps()` (`game-detect.js`), a single HTTP GET every 33ms (~30fps). Out of the car the app's page asks for nothing and draws nothing: the main process asks once a second and tells the page when he is in. A page in a browser or on an iPad has no main process behind it, and asks once a second for itself. In demo mode, the dashboard reads from `RacingDesk.Plugin.Demo.*` properties instead — the switching is transparent.

3. Each frame, `_renderFrame()` routes the JSON values last read to the appropriate module: updating DOM elements, CSS custom properties, SVG transforms, class toggles, and WebGL shader uniforms. Animations are driven by CSS transitions triggered by class changes.

4. The connection uses exponential backoff on failure (1s → 2s → 4s → 8s, capped at 10s) to avoid socket exhaustion when nothing is answering. In the app the backoff is dropped when the main process says he is back in the car.

### Modules

| Module | Purpose |
|--------|---------|
| `poll-engine.js` | Telemetry polling, data routing, commentary/strategy display |
| `config.js` | Property subscriptions, state management, demo mode switching |
| `webgl.js` | WebGL2 fragment shader — glare, bloom, glow, vignette |
| `webgl-helpers.js` | Shader compilation, icon atlas generation |
| `ambient-light.js` | Screen color sampling, LERP interpolation, CSS variable updates |
| `ambient-capture.js` | Capture region UI configuration |
| `drive-hud.js` | The switch for the glance layout (drive mode: Ctrl+Shift+F, and an iPad): the layout itself is `modules/styles/drive-view.css` |
| `leaderboard.js` | Full-field position/gap leaderboard |
| `datastream.js` | Live telemetry data stream |
| `spotter.js` | Proximity overlay |
| `pitbox.js` | Pit strategy management |
| `sector-hud.js` | Sector timing display |
| `track-map.js` | SVG minimap with heading-up rotation |
| `game-logo.js` | Manufacturer detection + logo rendering |
| `car-logos.js` | Manufacturer name → logo path resolution |
| `game-detect.js` | Active sim detection |
| `settings.js` | Settings panel UI + persistence |
| `connections.js` | Connection management + remote access |
| `keyboard.js` | Global hotkey handling |
| `commentary.js` | Commentary panel slide-in/out animation |

### Beyond the live HUD

Additional modules in `modules/js/`, not represented in the live-HUD table above:

| Module | Purpose |
|--------|---------|
| `race-coach.js` | **Live Claude API integration.** POSTs to `https://api.anthropic.com/v1/messages` with rolling race context (lap times, position, incidents, fuel/tyre state, commentary log). Configurable model (Haiku 4.5 / Sonnet 4.6), tone, depth. **User supplies their own Anthropic API key**; The Racing Desk does not proxy. |
| `voice-coach.js` | Synthesized voice prompts for in-race coaching at quiet moments |
| `incident-coach.js` | Highlights what just went wrong and how to recover |
| `recorder.js` | Screen capture for `.rcpdv` race bundles |
| `replay-buffer.js` | Rolling N-second buffer in RAM for instant replay clips |
| `replay-director.js` | Timeline of a recorded race for in-overlay scrubbing |
| `ffmpeg-encoder.js` | Mux MP4 + telemetry sidecar into the final `.rcpdv` |
| `bundle-writer.js` | Writes the `.rcpdv` bundle directory with metadata.json |
| `telemetry-sidecar.js` | Writes the `.telemetry.jsonl` paired with the recorded MP4 |
| `token-loader.js` | Fetches design tokens from server (`/api/v1/tokens/native`) |
| `pedal-curves.js` | Renders pedal-input traces (throttle / brake / clutch) |
| `formation.js` | Pre-race grid + formation lap UI |
| `idle-nav.js` | Carousel of stats during idle moments |
| `qr-code.js` | QR for pairing to native apps / sharing |

Race-bundle (`.rcpdv`) format: folder containing `video.mp4` + `telemetry.jsonl` + `metadata.json`. Recording is opt-in via overlay settings → Recording. Bundles land in `%APPDATA%\RacingDesk\overlay\bundles\` (Windows). Consumed by [`prodrive-windows`](https://github.com/DOOOOM/prodrive-windows) Library + Editor pages, [`prodrive-macos`](https://github.com/DOOOOM/prodrive-macos) Library + Editor (basic playback live), and [`prodrive-edit`](https://github.com/DOOOOM/prodrive-edit) CLI for AI-driven highlight reels.

### iRacing data sync — moved out

Earlier versions of the overlay hosted an `iracing-client.js` Electron BrowserWindow that scraped iRacing's member site. **That responsibility moved out** — iRacing data sync now happens via two paths owned by other parts of the stack:

1. **Chrome extension** in [`prodrive-server/apps/web/browser-extension/`](https://github.com/DOOOOM/prodrive-server) — scrapes members-ng.iracing.com and posts to `/api/iracing/extension-sync`
2. **Plugin push** — the SimHub plugin posts session data to `/api/iracing/import` after each race via Bearer auth

The overlay is back to being purely the live-HUD-and-recording client.

## Configuration

### Settings

The HUD has no settings panel of its own any more: its window takes no clicks. Settings are a page of the desk window (`modules/desk/settings-model.js` lists them) — layout (position, zoom, bottom offset), which modules are shown, the look (visual preset, theme, ambient light, borders, WebGL effects), and the HUD on an iPad. Each change is written to `%APPDATA%\Racing Desk\overlay-settings.json` and reaches the HUD at once.

In a browser, with no app behind the page, settings fall back to localStorage.

### Window Position

The HUD's window covers the whole of the screen iRacing is on (or the one chosen under Settings, HUD screen), and the panels place themselves inside it by the Position setting. `Ctrl+Shift+R` puts the window back if something has moved it.

## ARM Compatibility

On ARM64 Windows devices, the overlay automatically switches to chroma key mode (green background, solid panel backgrounds, software rendering). For OBS: add a Window Capture source → Filters → Color Key → green `#00FF00`.

On x64 systems, native transparency composites directly — no OBS filter needed.

## Deployment Modes

**Electron Overlay (Primary)** — Standalone app, always-on-top, click-through, hotkey controls. Best for streaming and broadcast.

**SimHub Dashboard Template** — The same `dashboard.html` installs as a SimHub dashboard template. Uses SimHub's `$prop()` API instead of HTTP polling.

**Browser Access** — Open `dashboard.html` in any browser while SimHub is running. Auto-detects non-SimHub environment and falls back to HTTP polling.

**LAN Remote** — The Electron app includes a built-in HTTP server for serving the dashboard to other devices on the local network.

## Troubleshooting

**No HUD in the car:** Look at the tray's "HUD on/off": unticked, the HUD is switched off, and stays off until it is ticked again. Then read the log (`%LOCALAPPDATA%\Racing Desk\overlay.log` in the built app): it says when the HUD was put on screen and hidden, and why. Beside SimHub the HUD reads SimHub's plugin, so SimHub closing in mid-session hides the HUD.

**The HUD is on screen in the garage, or over a replay:** The telemetry it reads sends no `IsOnTrack` — a SimHub plugin installed before 2026-09-29. Install the plugin again from this build.

**Dashboard shows no data:** Open `http://localhost:8889/racing-desk/` in a browser. You should see a JSON blob with 100+ properties. If not, verify the RacingDesk plugin is enabled in SimHub, or that RacingDesk.Host is running.

**Overlay crashes on launch (ARM):** Use `npm run start:safe` for software rendering. Requires Electron 33+.

**Commentary panel never appears:** Enable Demo Mode in the plugin settings to trigger test events.

**OBS shows black/solid overlay:** On x64, use Window Capture with "Allow Transparency" enabled. On ARM, use the Color Key filter.

**The glance layout shows no map:** Track map data must be available from the plugin. Some tracks may not have SVG path data — export maps from the plugin's SimHub settings panel.
