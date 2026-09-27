# prodrive-overlay — Electron HUD

Standalone Electron overlay that renders real-time sim racing telemetry as a transparent always-on-top HUD. Built by `npm run build` at the monorepo root into `dist/win-unpacked/Racing Desk.exe`, which starts its own RacingDesk.Host (`modules/js/host-launcher.js`) — no installer; see the root CLAUDE.md, Desk.

A sibling repo, [`prodrive-overlay-showcase`](https://github.com/DOOOOM/prodrive-overlay-showcase), holds the same code with a `showcase-bootstrap.js` that drives it from synthesized data — used in the marketing-site iframe.

## Integration Contract (Overlay ↔ Plugin)

This overlay is the **consumer** side of the live-telemetry pipeline. The [SimHub plugin](../plugin/CLAUDE.md) is the **producer**.

- **HTTP API**: `GET http://localhost:8889/racing-desk/`
- **Response**: Flat JSON object with 100+ properties (telemetry, commentary, strategy)
- **Polling**: `fetchProps()` in `poll-engine.js` issues a GET every 33ms (~30fps)
- **Backoff**: Exponential on failure (1s → 2s → 4s → 8s, capped at 10s)
- **Demo mode**: Reads from `RacingDesk.Plugin.Demo.*` properties instead — switching is transparent
- **Contract rule**: Any change to JSON property names consumed by this overlay must be coordinated with the plugin

## Tech Stack

- **Electron** — frameless, always-on-top, click-through window
- **Vanilla JS** — no framework, intentional for 30fps render performance. Do NOT introduce React/Vue/etc.
- **WebGL2** — fragment shader pipeline for post-processing effects (glare, bloom, vignette)
- **Canvas 2D** — fallback and auxiliary rendering
- **Plain CSS** — `.css` files loaded via `<link>` (NOT CSS modules), custom properties for theming
- **No build step** — JS modules loaded directly by HTML, no bundler
- **ffmpeg** — bundled binary, used by `ffmpeg-encoder.js` for race-bundle recording
- **Anthropic SDK** — direct API calls from `race-coach.js` for live AI commentary (uses user's own API key)

## 51 modules in `modules/js/`

Far more than just the telemetry HUD. Notable additions beyond the original module set:

| Module | Purpose |
|--------|---------|
| `race-coach.js` | **Live Claude API integration** — POSTs to `https://api.anthropic.com/v1/messages` with rolling race context (lap times, position, incidents, fuel, tyre, commentary log). Configurable tone/depth/model. Uses `claude-haiku-4-5` for short prompts, `claude-sonnet-4-6` for post-race summaries. **User supplies their own Anthropic API key**; The Racing Desk does not proxy. |
| `voice-coach.js` | Synthesized voice prompts for in-race coaching at quiet moments |
| `incident-coach.js` | Highlights what just went wrong and how to recover |
| `recorder.js` | Screen capture for `.rcpdv` race bundles |
| `replay-buffer.js` | Rolling N-second buffer in RAM for instant replay clips |
| `replay-director.js` | Timeline of a recorded race for in-overlay scrubbing |
| `ffmpeg-encoder.js` | Mux MP4 + telemetry sidecar into the final `.rcpdv` bundle |
| `token-loader.js` | Fetches design tokens from server (`/api/v1/tokens/native`) |
| `telemetry-sidecar.js` | Writes the `.telemetry.jsonl` paired with the recorded MP4 |
| `pedal-curves.js` | Renders pedal-input traces (throttle / brake / clutch) |
| `bundle-writer.js` | Writes the `.rcpdv` bundle directory with metadata.json |
| `formation.js` | Pre-race grid + formation lap UI |
| `idle-nav.js` | Carousel of stats during idle moments |
| `qr-code.js` | QR for pairing to native apps / sharing |

Plus the original set: `poll-engine`, `config`, `webgl`, `webgl-helpers`, `ambient-light`, `ambient-capture`, `drive-hud`, `leaderboard`, `datastream`, `spotter`, `pitbox`, `sector-hud`, `track-map`, `game-logo`, `car-logos`, `game-detect`, `settings`, `connections`, `keyboard`, `commentary`, etc.

## Race-bundle (`.rcpdv`) output

Format: folder containing `video.mp4` + `telemetry.jsonl` + `metadata.json`. Recording is opt-in via overlay settings → Recording. Bundles land in `%APPDATA%\RacingDesk\overlay\bundles\`.

Consumed by:

- [`prodrive-windows`](https://github.com/DOOOOM/prodrive-windows) Library + Editor pages
- [`prodrive-macos`](https://github.com/DOOOOM/prodrive-macos) Library + Editor (basic playback live)
- [`prodrive-edit`](../edit/CLAUDE.md) CLI for AI-driven highlight reels

Schema documented in [`../../docs/telemetry-sidecar-schema.md`](../../docs/telemetry-sidecar-schema.md).

## Deployment Modes

`dashboard.html` powers four modes:

1. **Electron Overlay** (primary) — standalone app, always-on-top, click-through, hotkeys
2. **SimHub Dashboard Template** — installs as a SimHub template, uses `$prop()` API instead of HTTP
3. **Browser Access** — open in any browser while SimHub runs, falls back to HTTP polling
4. **LAN Remote** — built-in HTTP server for serving to other devices on the network
5. **Showcase mode** — sibling `prodrive-overlay-showcase` repo runs this same dashboard with `showcase-bootstrap.js` driving from synthesized data, embedded in the marketing-site iframe

## Code Style

- **Vanilla JS only** — no frameworks, no TypeScript, no bundler. Intentional for 30fps performance.
- **CSS**: plain `.css` files via `<link>`. Custom properties for theming. NOT CSS modules.
- **WebGL shaders**: inlined as template strings in JS files
- **Animations**: CSS transitions triggered by class changes, not JS animation loops
- **DOM updates**: direct DOM manipulation in `pollUpdate()`, routed from the single `fetchProps()` call

## Design System

The overlay consumes design tokens generated by the server's Style Dictionary pipeline. See [`../../docs/archive/monorepo-orchestration.md`](../../docs/archive/monorepo-orchestration.md) for the cross-repo design system details.

- Token CSS files: `modules/styles/`
- Three visual modes: Standard, Minimal, Minimal+
- Theme switching via CSS custom property overrides
- Live token loading via `token-loader.js` → server endpoint

## Running

From the monorepo root:

```bash
npm install
npm run dev                       # newest recording on :18889 + overlay in dev mode
npm run dev -- --live             # dev mode against live SimHub on :8889
npm run record -- --only-in-car   # capture the plugin payload while driving (or in demo mode)
```

Dev mode (`electron . --dev`, see `dev-mode.js`): interactive window on the second display, visible
regardless of in-car state; CSS in `modules/styles` hot-swaps on save, JS/HTML reloads the page;
`--replay-port=N` redirects every `localhost:8889` request at the network layer. Dev mode never
runs the auto-updater or the Stream Deck plugin install.

```bash
npm start                         # normal HUD mode (from apps/overlay)
npm run start:safe                # ARM/software rendering mode
```

`npm start` also starts RacingDesk.Host (or uses one already on :8889/:18889; `--desk-host=<url>` to use one you ran
by hand) and puts a tray icon up — quit from it or with Ctrl+Shift+Q; see the root CLAUDE.md, Desk. Dev mode
starts no host.

## Testing

```bash
npm test                          # unit project
npm run test:golden               # golden frames: dashboard.html + replay harness, headless
npm run test:golden -- --update-snapshots   # accept new baselines after an intended change
```

Golden frames pin the replay to a frame, block all non-plugin network, fix `Date`, and compare
screenshots with a 100-pixel allowance (runs are pixel-exact; a single colour rule moves ~1.3k px).
No CI — run locally.

## Hotkeys

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+S` | Toggle settings/move mode |
| `Ctrl+Shift+F` | Toggle Drive HUD mode (fullscreen) |
| `Ctrl+Shift+H` | Hide/show overlay |
| `Ctrl+Shift+G` | Toggle green-screen mode |
| `Ctrl+Shift+R` | Reset position and size |
| `Ctrl+Shift+D` | Restart demo sequence |
| `Ctrl+Shift+O` | Open the desk |
| `Ctrl+Shift+Q` | Quit |

## What this repo does NOT do anymore

The previous Electron BrowserWindow + DOM-scraping iRacing client (`iracing-client.js`'s `runSync`) is gone. iRacing data sync now happens via two paths owned by other parts of the stack:

1. **Chrome extension** in [`prodrive-server/apps/web/browser-extension/`](https://github.com/DOOOOM/prodrive-server) scrapes members-ng.iracing.com and posts to `/api/iracing/extension-sync`
2. **Plugin push** — the SimHub plugin posts session data to `/api/iracing/import` after each race via Bearer auth

The overlay is back to being purely the live-HUD-and-recording client.
