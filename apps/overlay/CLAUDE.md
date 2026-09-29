# prodrive-overlay — Electron HUD

Standalone Electron overlay that renders real-time sim racing telemetry as a transparent always-on-top HUD. Built by `npm run build` at the monorepo root into `dist/win-unpacked/Racing Desk.exe`, which starts its own RacingDesk.Host (`modules/js/host-launcher.js`) — no installer; see the root CLAUDE.md, Desk.

A sibling repo, [`prodrive-overlay-showcase`](https://github.com/DOOOOM/prodrive-overlay-showcase), holds the same code with a `showcase-bootstrap.js` that drives it from synthesized data — used in the marketing-site iframe.

## Integration Contract (Overlay ↔ Plugin)

This overlay is the **consumer** side of the live-telemetry pipeline. The [SimHub plugin](../plugin/CLAUDE.md) is the **producer**.

- **HTTP API**: `GET http://localhost:8889/racing-desk/`
- **Response**: Flat JSON object with 100+ properties (telemetry, commentary, strategy)
- **Polling**: `pollUpdate()` in `poll-engine.js` calls `fetchProps()` (`game-detect.js`), one GET every 33ms (~30fps) while the driver is in the car. Out of the car, in the app, the page asks for nothing and draws nothing — the main process asks once a second (`modules/js/hud-visibility.js`) and tells the page (root CLAUDE.md, Desk). A page with no main process behind it (an iPad, a browser) asks once a second out of the car, to notice him getting in
- **Backoff**: Exponential on failure (1s → 2s → 4s → 8s, capped at 10s). In the app it is dropped when the main process says he is back in the car, and the page polls at once (`startConnectionClean()` in `game-detect.js`)
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
| `car-controls.js` | What the controls panel shows of the car's ABS / TC / brake bias / other dials / DRS / push-to-pass, from the host's `RacingDesk.Plugin.CarControls` (see The controls panel) |

Plus the original set: `poll-engine`, `config`, `webgl`, `webgl-helpers`, `ambient-light`, `ambient-capture`, `drive-hud`, `leaderboard`, `datastream`, `spotter`, `pitbox`, `sector-hud`, `track-map`, `game-logo`, `car-logos`, `game-detect`, `settings`, `connections`, `keyboard`, `commentary`, etc.

## The controls panel (`.car-controls`: BB, TC, ABS, and what the car has besides)

The panel says what the driver's car has and what each control reads. **What a car has is not worked out here**: the
host sends it, from the hand-written car list (root CLAUDE.md, The car's controls), as one key,
`RacingDesk.Plugin.CarControls` — an object from `:8889`, its text from the WebSocket feed, and `read()` takes both.

- **`modules/js/car-controls.js`** (`window.RacingDeskCarControls`, or `require` in Node): `read(payload)` (the key, or
  null: not sent, not JSON, not an object with a `car`), `view(cc)` (the cells, from the reading alone), `signals(prev,
  next)` (what the spotter says), `render(panel, cc, hooks, state)` (the only part that touches the DOM), `clear`.
  `poll-engine.js` calls `read` and `render` where it used to compute BB / TC / ABS, and nothing else in the HUD
  knows about the list. The old computing is still in the `else`.
- **What a cell shows** — the same words as the host's (`state`): `NONE` (the car has none; the cell shrinks to the
  word, `.ctrl-none`), `ON` (has it, cannot turn it; `.ctrl-on`), `OFF` (a dial at its off position; `.ctrl-off`), a
  number or the name of a position under the car's own label (`TCLO`, `ESC`, `BBAL`, `DSC`), or a dash where the
  host said nothing of it. A control the fixed setup holds gets a small lock mark (`.ctrl-locked`). A number fills its
  bar by the host's `fill`, else by the bars the HUD always drew (bias `(n-30)/40`, TC and ABS `n/12`); **a name
  fills nothing** (the number behind `MDM` is a position, not a quantity). A mode (the 570S's one dial) is a
  cell of its own, `#ctrlMode`, and the cells it covers (`ctrl-hidden`) take no room.
- **The row beneath** (`#ctrlMore`, `.ctrl-mini`): the car's other controls in the list's order — a second traction
  dial (`TCLA`), brake migration (`MIG`), the anti-roll bars (`FARB`, `RARB`), a throttle map — then DRS and
  push-to-pass. Only for a car that has any; DRS is `.ctrl-mini-ready` when it can be opened and
  `.ctrl-mini-active` while it is, push-to-pass `.ctrl-mini-active` while it is on.
- **The spotter**: a change of a control is announced with the car's word and what it reads, `TCLO ▲ 6`, `ESC ▼ SPORT`,
  `DSC ▼ OFF` (`announceAdjustment(type, value, direction, name, text)` in `spotter.js`; a name or text given, the card
  says the car's own thing; without them, the old `Brake Bias ▲ 55.0`). DRS says `DRS next zone`, `DRS — open it`,
  `DRS open`; push-to-pass says `<label> on — 64s left`, `off`, `used up`. Nothing is said of a first frame or of a
  car that has just been changed to.
- **A car the host sends no key for** (another sim, a car the list does not have, the demo, a host from before the
  list) is the panel as it was: the raw `dcBrakeBias`, `dcTractionControl` and `dcABS`, hidden or shown by the old
  table (`getCarAdjustability` in `config.js`, matched by the car's model name), `Off` and `Fixed` in the old words.
  Nothing is made up for it. The golden frames (no key in their payload) hold this panel as it was. **The old table stays** — it is the whole
  of what the HUD knows about a car the list has not met: `config.js`'s `_carAdj` and `getCarAdjustability`, read
  only in `poll-engine.js`'s controls block (the `carModel` change that sets it, and the `tcOk` / `absOk` / `bbOk`
  and "Fixed" lines) — the pit box does not read it. It goes when the list has every car he drives.
- **The glow that says an aid is cutting in** (`.ctrl-active`, from `RacingDesk.Plugin.DS.AbsActive` / `TcActive`) is
  driven for every car, the list's and not (`poll-engine.js`, after the panel; `datastream.js` sets the same
  class while it runs).
- **Tests** (`tests/unit/car-controls.spec.mjs`): the module's functions in Node, then the real `dashboard.html`,
  headless, fed a payload for each case — NONE, ON, OFF, a value with the car's label, a mode by name, GTP brake
  migration, TC slip and gain, the bars, DRS and push-to-pass, a car that changes, a car not in the list, a key
  that is not one. **The cars are not typed in the spec**: they are read from `tests/unit/fixtures/car-controls-wire.json`,
  which RacingDesk.Tests holds to what the host writes (`Cars/CarControlsWireTests.cs`, rewritten with
  `UPDATE_CAR_CONTROLS_WIRE=1`). The C# side cannot be tested over `:8889` without binding wildcard ports, so that
  hop is by the code: the runtime writes `s.CarControlsJson` into the payload as an object.

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
by hand) and puts a tray icon up — quit from it, or by closing the desk; see the root CLAUDE.md, Desk. Dev mode
starts no host.

The main process logs through `logToFile` in `main.js` (`modules/js/app-log.js`): from source to
`racing-desk-debug.log` in this folder, in the built app to `%LOCALAPPDATA%\Racing Desk\overlay.log`, beside the
host's `host.log` — this folder is inside `app.asar` there, and nothing written to it is kept. Two files of 4 MB at
most (`overlay.log`, `overlay.log.1`). A line is never a reason for the app to fail, and carries no customer id.

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
| `Ctrl+Shift+F` | Toggle Drive HUD mode (fullscreen) |
| `Ctrl+Shift+H` | Switch the HUD off/on, in the car only — out of it the key does nothing, and the tray's "HUD on/off" is the switch |
| `Ctrl+Shift+G` | Toggle green-screen mode |
| `Ctrl+Shift+R` | Reset position and size |
| `Ctrl+Shift+D` | Restart demo sequence |
| `Ctrl+Shift+O` | Open the desk |
| `Ctrl+Shift+M` | Reset the track map |
| `Ctrl+Shift+V` | Start or stop recording |
| `Ctrl+Shift+B` | Save the replay buffer |
| `Ctrl+Shift+P` | Start or stop the replay director |
| `Ctrl+Shift+I` | Held by the app; nothing listens for it now |
| `Ctrl+Shift+Q` | Quit the overlay: the HUD is put away (`hud.putAway`), the app keeps running |

`Ctrl+Shift+O` is held while the app runs; the rest only while the driver is in the car
(`modules/js/hud-keys.js`). No key quits the app.

## What this repo does NOT do anymore

The previous Electron BrowserWindow + DOM-scraping iRacing client (`iracing-client.js`'s `runSync`) is gone. iRacing data sync now happens via two paths owned by other parts of the stack:

1. **Chrome extension** in [`prodrive-server/apps/web/browser-extension/`](https://github.com/DOOOOM/prodrive-server) scrapes members-ng.iracing.com and posts to `/api/iracing/extension-sync`
2. **Plugin push** — the SimHub plugin posts session data to `/api/iracing/import` after each race via Bearer auth

The overlay is back to being purely the live-HUD-and-recording client.
