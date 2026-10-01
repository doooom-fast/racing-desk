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
- **OBS** records (`docs/recording.md` at the root): the main process drives it over obs-websocket 5 (`modules/js/obs/`), with a WebSocket client of its own over `net` — Electron's Node has none and `ws` is not in the tree. No ffmpeg, no recorder in the page. OBS may also draw the HUD itself, from the page `remote-server.js` serves on `127.0.0.1:9091/obs` (`window._obsMode`: the rig's layout, hidden out of the car, the voice coach off, the display settings through an allowlist), behind the switch "HUD drawn by OBS" — or, by the choice under it, the iPad dashboard from `/obs-ipad` (`window._obsGlance`: the glance layout over a transparent page, placed once in a corner of the game).
- **Anthropic SDK** — direct API calls from `race-coach.js` for live AI commentary (uses user's own API key)

## 55 modules in `modules/js/`

Far more than just the telemetry HUD. Notable additions beyond the original module set:

| Module | Purpose |
|--------|---------|
| `race-coach.js` | **Live Claude API integration** — POSTs to `https://api.anthropic.com/v1/messages` with rolling race context (lap times, position, incidents, fuel, tyre, commentary log). Configurable tone/depth/model. Uses `claude-haiku-4-5` for short prompts, `claude-sonnet-4-6` for post-race summaries. **User supplies their own Anthropic API key**; The Racing Desk does not proxy. |
| `voice-coach.js` | Synthesized voice prompts for in-race coaching at quiet moments |
| `incident-coach.js` | Highlights what just went wrong and how to recover |
| `obs/client.js` | **Main process**: the obs-websocket 5 client — Hello, the challenge-and-salt authentication, requests by id, events by name, tried again every 5 s while OBS is closed; the password is a function asked at Hello and logged as `set` or `none`, never as itself |
| `obs/ws-client.js`, `obs/ws-frames.js` | A WebSocket client over a plain socket and the RFC 6455 framing it and the Stream Deck plugin use |
| `obs/launcher.js` | **Main process**: where obs64.exe is, starting it detached and minimised on a press, whether it runs (tasklist, on a press only), Set up OBS: the WebSocket switched on in obs-websocket's `config.json` and the password read into memory, Hybrid MP4 / the 20 s replay buffer / the recording folder in the profile's `basic.ini` while OBS is closed or over the WebSocket while open. Every file and spawn is handed in |
| `obs/recording.js` | **Main process**: the keeper — OBS's recording mirrored whoever pressed, Record/Stop, OBS started only from the desk, the tray or the Stream Deck out of the car, ownership by outputPath in a state file and stopped on every quit path (a quit waits, up to 8 s, for a recording that has just stopped to be filed), take-over on connect, the floor under the disk (20 GB to start, 5 GB to stop), the sidecar at 30 Hz for a live sim session; auto-record acted on (once a session when OBS answers a start and does not carry it out; never tasklist), the replay buffer with the car (owned until OBS's STOPPED) and Save replay (the clip's own sidecar from the last seconds kept in memory, the keys of a frame only, as long as OBS's RecRBTime), chapters kept once OBS has taken them, pauses written down, and each recording filed after STOPPED (the move, the offset read back, lined up from the stop request) — or, for one whose end OBS never told, when OBS next answers. Nothing drawn on the HUD |
| `obs/auto-record.js` | Pure: when a recording starts and stops by itself — the green flag in a race, pit exit elsewhere; a new session, five seconds after HIS finish in a race (the chequered flag out and his lap count up since; the flag is the session's), leaving the car; held a second by the clock; only its own stopped; a green flag good once per stint |
| `obs/filing.js` | Pure: the recording's folder name (`<date> <track> <car>`), the same-drive move after the file holds still, the offset from the chapters read back (each paired with the same-named chapter nearest to where it belongs, the median of what agrees) or from the file's end (the pauses allowed for), the words of each chapter |
| `obs/mp4-info.js` | An MP4's duration and chapters read by seeking, no ffmpeg: a finished Hybrid MP4 or plain MP4 from its `moov`, an unfinished Hybrid MP4 from its fragments |
| `obs/hud-source.js` | **Main process**: "HUD drawn by OBS" — the one browser source `Racing Desk HUD` (the loopback listener's `/obs` page, at the port the listener is really on) made once, an item of it in each scene that has an item named `game video`, in the collection the switch was turned on in and no other, just above it and fitted to it (the source is the HUD window's size in DIPs, scaled up by OBS), reloaded when OBS answers unless the page is polling, disabled off — applied at every connect, then the window goes back into the capture — and on quit, never removed; what he hid or moved is left (`apply` does the ordering, with `setContentProtection` handed in as `protect`). With "iPad dashboard" chosen (`view`), the source is the `/obs-ipad` page at 1180 by 820, placed once per scene in the bottom-left corner of the game video at half its height (`IPAD_PLACE`) and never moved or sized again — not when he sizes the source in OBS (the address and size are put back; the item is scaled inside its bounds and keeps its box), not when he renames a scene; the state file keeps the scenes placed (by the scene's uuid, the name where OBS gives none) and his transform of it when the choice goes back to the rig HUD, which puts the item back over the game; an item with nothing written of it is his unless it still covers the game video as the rig HUD's fit does |
| `obs/tv-shots.js` | **Main process**: TV shots — the sidecar's moments (places gained, incidents, the pit lane) found again in iRacing's replay by their `sn`/`st` through the host's replay route (the SDK's own commands; no key; refused by the host while he is on track), recorded through a TV camera on his car by its number as one take in the race's folder, the recording paused between moments, a moment the sim does not reach skipped, the take ended where it is when he gets in the car, OBS stops it, iRacing leaves its replay, Stop or the quit; the facecam hidden, kept in `tv-state.json` and put back whatever happened, auto-record held; progress to the desk, the tray and the Stream Deck |
| `obs/recordings-index.js` | Pure: the recordings folder read by each folder's sidecar header — the race's recording by the session's start and track, the latest for the tray |
| `hud-notice.js` | The one thing the HUD may be told of recording, for two seconds: "OBS is not open", "OBS didn't start recording" |
| `telemetry-sidecar.js` | Pure: the `.telemetry.jsonl` beside the video, written by the keeper; every frame carries the sim's `SessionNum` and `SessionTime` (`docs/telemetry-sidecar-schema.md`) |
| `recording-settings.js` | The recording keys of `overlay-settings.json` and the once-only migration from the Electron recorder's; the default folder is `D:\Racing Desk\Recordings` |
| `streamdeck-install.js` | The Stream Deck plugin copied from the unpacked folder into the Stream Deck app at every start |
| `token-loader.js` | Fetches design tokens from server (`/api/v1/tokens/native`) |
| `pedal-curves.js` | Renders pedal-input traces (throttle / brake / clutch) |
| `formation.js` | Pre-race grid + formation lap UI |
| `idle-nav.js` | Carousel of stats during idle moments |
| `qr-code.js` | QR for pairing to native apps / sharing |
| `hud-display.js` | **Which screen the HUD's window is on** — the one he chose, else the one the sim's window is on (asked of the host), else the one iRacing's ini says it runs at, else the largest; not the primary. Pure rule + a keeper that moves the window (never shows it). Root CLAUDE.md, Desk |
| `car-controls.js` | What the controls panel shows of the car's ABS / TC / brake bias / other dials / DRS / push-to-pass, from the host's `RacingDesk.Plugin.CarControls` (see The controls panel) |
| `lap-delta.js` | The gap to his best lap of the session and to the optimal lap, worked out from his own laps, and how a delta is written and labelled (see The delta) |
| `laps-panel.js` | The glance layout's laps panel: the times, the sectors, the three gaps and the fuel to the flag (see The glance layout) |
| `gap-trend.js` | Whether the cars ahead and behind are closing or dropping away, lap on lap: the ▼ or ▲ beside their iRating in the gaps block of the glance layout (see The glance layout) |
| `session-flags.js` | iRacing's own flag field (`SessionFlags`, the host's `DataCorePlugin.GameRawData.Telemetry.SessionFlags`) read into the flag the page shows: a local yellow apart from a full-course caution, one lap to green, green held, the black flag furled, disqualified, the small notices and the start lights (see Flags) |
| `logo-livery.js` | **Main process only**: the crop of his own paint behind the car badge — which paint, when it is chosen, what is kept and handed to the page and the iPad (see The livery behind the car badge) |
| `logo-livery-picker.js` | Pure: the window of a paint sheet with artwork in it, scored, and the crop of it; runs in the worker and in Node tests |
| `logo-livery-worker.js` | A worker thread: reads one paint inside the paint folder, decodes it with `paints/tga.js`, asks the picker, answers with the PNG and no path |
| `session-kind.js` | Pure: which session the frame says it is, from `RacingDesk.Plugin.SessionTypeName` — a test drive (iRacing's "Offline Testing") or not (see The glance layout, A test drive has no leaderboard) |
| `map-zoom.js` | Pure: the following map's zoom with his speed (see The following map's zoom) — the curve, the ease, the follower a page keeps, the `followMapZoom` setting's words and its once-only migration in the settings file |

Plus the original set: `poll-engine`, `config`, `webgl`, `webgl-helpers`, `ambient-light`, `ambient-capture`, `drive-hud` (only the switch for the glance layout), `leaderboard`, `datastream`, `spotter`, `pitbox`, `sector-hud`, `track-map`, `game-logo`, `car-logos`, `game-detect`, `settings`, `connections`, `keyboard`, `commentary`, etc.

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

## The glance layout (drive mode: Ctrl+Shift+F, and the whole of what an iPad is shown)

A data display and not a page, and the real thing: **every one of the HUD's panels, in the HUD's glass and type, laid out
as the cells of one grid on `<body>`** that fills the screen, with the flag as the background when one is out.
`modules/styles/drive-view.css` is the layout; `modules/js/drive-hud.js` is the switch (`body.drive-mode-active`, on for a
page served to an iPad from the start, and toggled on the rig by Ctrl+Shift+F, the Stream Deck's Drive Mode and
`_settings.driveMode`). There is no second layout to keep in step: the HUD's wrappers (`#dashboard`, `.main-row`,
`.main-area`, `.controls-pedals-block`, `.maps-col`, `.pos-gaps-col`, `#cycleRatingPos`, `.timer-row`, `#secContainer`,
`.logo-col`) become `display: contents` (and their pseudo-elements go, or they would be cells of their own), the panels
become the cells, and every module goes on writing to the elements it always did, so the type, the colours and the
states are the HUD's. (The layout that was here before — `#driveHud`, `drive-mode.js`, the `dm-*` and `dh-*` rules,
`modules/components/` — is gone; it had a face, a track and a colour of its own.)

- **The cells** (24 columns; landscape, then portrait): the position block (`#positionPage`: the place, the places since
  the start, the lap, the live lap, the delta), the gaps ahead and behind (`#gapsBlock`, with its flag overlay), the tacho,
  the relative leaderboard with its sparklines and the race timeline, the full circuit and the local view, the laps panel
  (below), iRating and safety rating (`#ratingPage`, which on the rig takes turns with the position block; here both are
  up), the car's controls, the pedals, the Racing Desk mark and the car's badge, the clock (`#raceTimerBlock`), the pit
  box (its tyres, fuel and weather side by side, not tabs), the datastream, the incidents. Landscape:
  `hero×7 gaps×4 tacho×6 lb×7 / map×7 local×4 laps×6 lb / map local rating×6 lb / ctrl×6 pedals×4 brand×2 car×2 timer×3 lb /
  pit×10 ds×4 inc×3 lb` (rows 20 / 24 / 10 / 13 / 29 fr); portrait: `hero×14 gaps×10 / tacho×8 map×11 local×5 / lb×15 laps×9 /
  lb rating×9 / ctrl×8 pedals×6 brand×2 car×3 timer×5 / pit×13 ds×6 inc×5`. The tracks are `fr`, the edge round the grid
  `clamp(8px, 1.2vmin, 14px)` and the gutters `clamp(5px, 0.75vmin, 9px)`; nothing is set per device. Every panel is a cell
  whatever the rig's settings hide from its own screen (`settings.js` `applySettings` shows them all in drive mode, and
  leaving drive mode puts the settings' choice back), and nothing in a cell is a touch target.
- **What comes and goes** is laid over the cells, as it is over the game on the rig: the spotter's calls over the datastream
  (the least glanced-at cell, and not the circuit), race control over the top of the track, the finish (`#raceEndScreen`)
  over the track and the local view, the commentary card over the pit box, the pit limiter and the grid from the top edge.
  An absolute box placed in a grid area takes that area for its frame. Race control's sentence wraps to as many lines as
  the cell asks and none of it is cut off (`Full course yellow — hold position` had read `FULL COURSE YELLOV`); a flag
  that replaces the one it is about (yellow, then blue) takes it away at once (`poll-engine.js`), so it never says yellow
  over a blue screen (this is the rig's HUD too).
- **The glass**: each panel is the rig's — near-black at nine-tenths, an edge, and over it ambient.css's light (the
  overhead glow and sweep of its plastic mode, and its specular streak), tinted by the ambient colour. On the rig the WebGL
  glare pass adds to it by where a panel is on the screen; in the glance layout that pass is skipped (`webgl.js`) and each
  panel is lit the same, by its own layers. On an iPad there is no game behind it, so the colour is the one the telemetry
  carries (`DS.AmbientR/G/B`, the plugin's sample of the rig's screen), or the flag's when there is none (`ambient-light.js`,
  which now writes the colour only when it changes).
- **Flags are the background**: `poll-engine.js` writes the flag on show (the gaps block's, held as long as it holds it) to
  `body[data-flag]`, written only when it changes. The page behind the panels takes it full-bleed — the edge and every
  gutter — as the flag's own colour or pattern (checkered a checkerboard, the meatball an orange disc on black, debris the
  yellow and red surface flag), moving slowly on a composited layer, and the glass of every panel takes its colour, over
  a base that is opaque (a chequered board at four in a hundred showed through it, and lowered the contrast of the
  gaps); the car's badge is its maker's colour over an opaque base (`car-logos.js` sets it as `--logo-tint` beside its
  inline background, which a stylesheet cannot get under), and under the logo the crop of his own paint where there is
  one (The livery behind the car badge, below), whose darkening takes the glass's colour too; gone when the flag clears. A blue flag rings the screen and
  leaves the panels as they are. **Which flag it is comes from iRacing's own flag field** where the host sends it
  (`session-flags.js`, Flags below): a full-course caution (`data-flag="caution"`) has the whole treatment, a local yellow
  (`localyellow`) is the lighter one — thin yellow stripes round the edge, the panels left as they are — one lap to green
  under a caution (`onetogreen`) is yellow and white, green held (`greenheld`) the green, the black flag furled (`furled`) a black and grey
  ring, disqualified (`disqualify`) black and deep red. With no field in the payload `currentFlagState` is all there is, and
  `yellow` is what it says for any of them: the page is then what it was.
- **Effects**: the HUD's own, on an iPad too — the tacho's redline flash and glow, the pit limiter's blue, the gaps' and the
  position's ahead/behind pulses, the leaderboard's P1 shimmer and gain/lose pulses, the incidents' levels, the spotter, the
  maps' close and near cars. The iPad's menu has "Effects: on/off", kept in its own storage (`rd-effects`), for an iPad
  that cannot keep up; off, the WebGL canvases and the flag's movement stop and the numbers, colours and flags stay. What
  cannot work without the game behind it is not there: the screen-capture colour of the rig's own ambient light (the iPad
  takes the plugin's sample instead) and the glare pass.
- **Every cell is a size container** (`container-type: size`) and what is in it is sized in `cq` units, with floors: no
  label under 11px, **no number under 20px** (the tyres' wear and temperature, the fuel, the laps panel, the datastream,
  the pedals' percentages, the incidents' counts, the tacho's revs, the clock, the sectors and every other value), the
  place at 80px or more. The exceptions are named in `tests/unit/drive-view.spec.mjs`: the leaderboard's rows (a list of
  a dozen, 14px in their own type, their lap and gap columns the 0.84 of that) and what is a caption to a name whatever
  it says (a driver's iRating, the car's model, an axis' thousands, a sector's number, the tank's size, the track's name,
  the strategy call in the pit box at 14px). A cq unit on the container itself would resolve against the page, so a
  cell's own padding, gap and font-size are in px or set on its children. **A cell that cannot hold a number at 20px
  gives up the least useful thing in it by `@container` query, and never shrinks the number**: the laps panel drops
  its heading and third row of times, then the sectors' gaps, then its second row, and past that (a layout with many
  sectors) gives up more, by measurement (below); the datastream its yaw trace, then the
  wheel's torque, then the peak g; the pit box its two services (below 262px), its pit window when a strategy call has
  taken the room (below 225px); the pedals the clutch's channel (below 250px); the rating panel its bar. The test
  holds every piece of text in every cell to the box its ancestors let show (an ellipsis, an overflow, the cell), at the
  seven iPad sizes and at the rig's own 1920x1080 and 2560x1080 (opened as the rig has them, with the badges). The HUD's
  zoom setting is the rig screen's and is undone here. **Known and not fixed:** on his own 3440x1440 screen the rig's
  Ctrl+Shift+F cuts the ratings panel off (its row is 103px in an 85px cell), and a short circuit name goes on sliding in
  the map's label after the switch to this layout (the marquee is measured in the HUD's narrow label); neither was
  touched by the iPad's changes, and the tests do not open 3440x1440 for the whole layout.
- **The hero**: in a race the place, big; out of one (`body.session-nonrace`, which `poll-engine.js` sets from
  `DS.SessionMode`, written only when it changes) the place is a rank of best laps and the big number is the delta.
- **The laps panel** (`#lapsPanel`, `modules/js/laps-panel.js`; shown only in the glance layout): the lap of how many, his
  last, best and optimal laps (the optimal the plugin's `DS.SectorBests` added up), each sector's time and its gap to his
  best of it in the gaps block's colours, his gaps to his best of the session, the optimal lap and his best ever, and the
  laps of fuel against the laps to go to the flag (in a race to time, the time left over his last lap), green with a lap
  to spare, amber just, red short. What is left to go is a span of its own that a narrow panel leaves out: the clock has it.
  **A sector is never narrower than its number** (he had "sector numbers get cropped when they're too many digits",
  2026-09-30): the cells are a wrapping row with `min-width: max-content`, every one as wide as the widest time (`--tw`,
  so a sector not yet timed is as wide as one that is and nothing moves when it is), their numbers come down from the
  panel's size towards the 20px floor as the sectors get more (`--sectors` on `#lapsSectors`), and the cells wrap to
  more lines. **What the panel cannot hold it gives up, in stages** (`FIT` in `laps-panel.js`, one class each on the
  panel, tried one on top of the other, and the panel asked after each whether it overflows, until it holds what is
  left; asked when a time changes width, when the number of sectors does and when the cell is resized, and the stage
  reached is `data-fit`): the sectors' gaps to his best (`laps-fit-gaps`); each sector a line of its own, its name beside
  its time, with the heading and the third row of times gone (`laps-sectors-wrapped`); the second row of times
  (`laps-fit-row2`); the first row, the last lap and the gap to his best (`laps-fit-times`: the clock and the hero have
  them too); the fuel (`laps-fit-fuel`); the space between the lines (`laps-fit-tight`); and last the sectors' names
  (`laps-fit-bare`, the times stay in order with the one he is in outlined). A layout with three sectors, or a tall
  cell, gives up nothing. Which of these is shown at a size is a trade he has not been asked about: the order is
  the least useful first by guess, and `tests/unit/drive-view.spec.mjs` holds only that nothing is cropped and no
  number is under 20px, at 3, 4, 7, 10 and 14 sectors of half a minute and of over a minute, on every iPad size and on
  the rig's three. **The gaps block's strip of sectors** (practice and qualifying: labels, coloured by what he did in
  each) is as tall as its block (`min-height: 0`) so that its cells wrap into more columns, and in portrait on an
  iPad stops short of the menu's button, which is over that corner. The rig's gaps block wraps its sector labels the
  same way (`dashboard.css`, `.sector-indicator`).
- **The clock** (`#raceTimerBlock`) says what it is (`#raceTimerKey`, written by `poll-engine.js` in the glance layout
  only): the laps to go in a lap race (the time on the lap is in the hero), the time left in a race to a time and in
  qualifying, the clock in practice, and under it the last lap. On the rig the cell is as it was, with no key.
- **The gaps** are the car ahead's and the car behind's, each with its iRating and, beside it, which way the gap is going
  (`gap-trend.js`): the gap taken at the start of every lap for the car that is there, and what is said through a lap is
  how it changed from the lap before to this one's start, `▼0.5/lap` shrinking and `▲0.3/lap` growing, green when that is
  good for him (closing on the car ahead, pulling away from the one behind) and red when it is not, nothing for under
  0.05s a lap, and a different car in the place starts it again. The other cars' pace is their last lap in the
  leaderboard's column, coloured as it always was. Out of a race the block is his three sectors, a line each.
- **The pit box** shows what its tabs do on the rig, side by side: the four tyres (wear in the ring, temperature under it,
  the laps on this set in the heading, `Strategy.StintLaps`), the fuel (tank, level and its size, per lap, laps left, the
  pit's add, the pit window `Strategy.PitWindowOpen/Close` as `L18–24` or `by L24`, the two services), the weather. The
  strategist's call for tyres or fuel (`Strategy.TireHealthState`, `FuelHealthState`) is read where it is on the rig,
  above the rings or the tank, worded for a screen with nothing to press (`Change · ~12 laps`, `Stop · ~6 laps`).
- **The maps** (`webgl-helpers.js`, "The maps in the glance layout"): the full circuit's viewBox is fitted to the outline,
  the local view takes its cell's shape with the car two-thirds of the way down, and what is drawn in pixels (the
  outline's three layers at 12 / 7 / 1.5px, the sectors at 8px, the car at 7px and the others at 5px) is worked out from
  `--px` on the svg, the units of the map to a pixel. Told by `driveViewChanged` (drive-hud.js), on resize, and on a new
  path; out of drive mode the maps are the HUD's own again. The outline is the host's, from his own laps (root
  CLAUDE.md, Track maps), and the host places the cars along it as a closed loop, so the page keeps a plain low-pass on
  the car's position and has no jump rule and no slow blend (crossing the line is one more step). The trail behind the
  car (a quarter of the lap at most, from where it was last anchored) is let go when the car is put somewhere else —
  a step of more than a fiftieth of the lap in one frame is a teleport, a reset or a tow to the pits — and when the
  outline changes, so a car put in the pits is not drawn with a quarter of the lap behind it. The circuit's
  sectors are split by the session's own boundaries (`window._sectorBoundaries`, from `DS.SectorBoundaryPcts`, in a
  race and out of one), never equal fractions. While there is no map the cell says why, from `TrackMap.Status`
  (`#fullMapWaiting`, `.map-waiting`: "Map after one clean lap", "No map yet — the app is starting its maps", and
  after a minute of that "No map — restart the app to bring its maps back"), and nothing once there is one — but
  for `crowd`, which is a map drawn on SimHub's shared map of the layout (root CLAUDE.md, Track maps): the same
  element, as `.map-note`, says "SimHub's map until your first clean lap" under the circuit and above its name,
  in the column with them so it covers nothing (not the top, where race control's banner sits under a flag), at the
  label's 11px floor, until his own outline takes over; a host from before the status says nothing. It is **one
  line, never more** (`white-space: nowrap`): the rig's default cell is 96 px wide and 98 high, where a note that
  wrapped to three or five lines took the circuit down to a fifth of its height, so the circuit gives up one line
  for it and no more (`track-map-status.spec.mjs` holds the circuit's height with the note to 72 % of what it is
  without, in the default layout and in the glance layout at an iPad's size), and a cell narrower than the line
  slides it, as the circuit's name is slid (`_fitMapNote` in `webgl-helpers.js`: `.is-marquee`, measured when the
  note is set and by a `ResizeObserver` when its cell changes size). The iPad's cell and the glance layout's hold it
  whole.
  Nothing resets or records a map any more (`tests/unit/track-map-status.spec.mjs`).
- **The incidents panel** (`#incidentsPanel`, `.inc-inner`; the rig's own panel, a cell here) has its header where every
  other panel has its header and the numbers as large as the cell allows (he asked on 2026-10-01: "update incidents
  panel in ipad overlay to match header location of other modules and larger fonts on the data"). The header is the
  datastream's beside it: the inner card takes `.ds-inner`'s padding (6px 10px) and number size (`max(20px, min(6.2cqh,
  9cqw))`), and `.inc-label` is `max(11px, 0.55em)` with the same tracking (0.12em), colour, weight and rule beneath as
  `.ds-header`, at the top on the left, where it sat centred in the middle of the cell. The count is `max(20px,
  min(34cqh, 50cqw))` (70px in an Air's cell on its side, 60px in a 9.7-inch's, 105px on the rig's 1920x1080; it was
  `min(32cqh, 36cqw)`), the penalty and DQ counts `max(20px, min(12cqh, 20cqw))` (24 to 37px; they were `min(9cqh,
  14cqw)`), their labels 11px or more; the count floats in the room between the header and the thresholds (auto
  margins), so the thresholds are at the foot and in a session with no limits the count has the room to itself. Once
  a limit is hit the number is a word (PENALTY, DQ), read at a label's size (`max(14px, min(8cqh, 11cqw))`: at the
  number's size it was wider than the narrowest cell); a value that would not fit beside its label goes under it,
  right-aligned, and the labels never break. `tests/unit/incidents-glance.spec.mjs` measures the header against the
  datastream's (offset from the top and the left of its panel within a pixel, size, tracking, colour, weight, case,
  family) and the numbers against the cell, at the seven iPad sizes and the rig's two, in a race, with both limits
  hit and in a test drive, with nothing cropped. The glance golden frames were re-made for it.
- **The leaderboard** is the HUD's panel and rows, its type sized from the panel (`#lbRows` font-size) and the rows sharing
  its height; `leaderboard.js` counts how many the panel holds at that size (1.9 lines to a row) and not the sum of the
  screen minus the dashboard that the rig's HUD does.
- **A test drive has no leaderboard, on every overlay** (he asked on 2026-10-01: "hide leaderboard on test drives in all
  overlays"). iRacing's solo testing session shows in the data as the one word both paths send under
  `RacingDesk.Plugin.SessionTypeName`: the app's host sends the session YAML's `SessionType` of the session the sim is in
  (`IRacingTelemetrySource.SessionType`), which is `Offline Testing` in every test-drive `.ibt` of his (with
  `WeekendInfo.EventType: Test`, `SessionName: TESTING`, `Official: 0`; a race weekend's are `Practice`, `Lone Qualify`
  or `Open Qualify`, `Race`), and the SimHub plugin sends SimHub's `SessionTypeName`, the same string. `DS.SessionMode`
  is 1 for a test drive and a practice alike, so the word is what is read: `modules/js/session-kind.js`
  (`isTestDrive`, a word boundary and "test", so "Offline Testing", "Testing" and "Test" and nothing by accident of
  letters). `poll-engine.js` writes `body.session-testdrive` from it, only when it changes; a frame that names no type
  leaves it as it was. With the class the panel is not shown — `leaderboard.css` on the rig's HUD and the page OBS
  draws of it, where the other secondary panels take its place at the edge; `drive-view.css` in the glance layout,
  where the grid is laid out again without its cell (on its side the hero, the maps and the laps panel each gain, and
  the pit box, the datastream and the incidents share the bottom row; upright the laps panel and the ratings take the
  full width of the two rows the leaderboard had; the rows keep their heights) and the maps are fitted to their cells
  again (`driveViewChanged`) — and `updateLeaderboard` writes no rows while it is away. Any other session brings it
  back the moment the frame says so. `tests/unit/test-drive.spec.mjs` holds it on the rig's HUD, the rig's
  Ctrl+Shift+F at 1920x1080 and 2560x1080, the iPad at four sizes (the cells still cover the screen, none over
  another, nothing cut off) and both pages OBS draws, with a return to practice, qualifying and a race; RacingDesk.Tests
  `SessionTypeTests` holds the host's word, and reads his newest 300 `.ibt` files to see that every `EventType: Test`
  has the one `Offline Testing` session and nothing else does (only those fields; nothing of a file is printed).
- **The menu** (remote-server.js) is a small round button in the top right corner of the iPad's screen, over the frame
  and the corner of whatever cell is there, faint until it is open; its list opens on the side with the more room. On
  the rig there is no menu. Upright, that corner is the gaps block, and its strip of sectors stops short of the button.
- **On an iPad only** (`html.rd-remote`, the rules at the end of `drive-view.css`; the rig's own Ctrl+Shift+F keeps
  everything it had; the iPad dashboard OBS draws, `html.rd-glance` from the loopback listener's `/obs-ipad`, shares
  the look — the glass, no badges, the row, the sectors — and has none of what is the iPad's alone: no menu, no flag
  pattern behind or between the panels, no frame, and a transparent page in place of the black one, so the game shows
  through the gutters; `hud-page-obs-ipad.spec.mjs` renders it over a board and reads the pixels), what he asked for on
  2026-09-30: the glass's light at fifteen hundredths of the rig's
  (`--rd-shine: 0.15` — the tint, the overhead glow and the sweep, the specular streak and the inset glow all take
  the one factor; the flags' own treatment of the glass does not), the flag's pattern behind and between the panels
  at fifteen hundredths too, under every flag (`body::before` at 0.15; the first cut's renders had the stripes at
  full strength in every gutter, which is the noise he meant), with a thin frame at the very edge of the screen —
  four pixels of the frame round the grid, never a gutter, `body::after` masked to a ring — carrying the flag's own
  pattern at full strength so a white or a chequered flag is still seen (`drive-view.spec.mjs` holds it twice: the
  computed layers, the frame's `mask-composite` being `exclude`, and the pixels of a screenshot under each of the five
  flags — the gutter between the relative and the laps panel under 80 of 255, the edge over 150 — so a frame whose
  mask stopped taking the inside out, in an engine that does not honour it, would be caught); the flag card in the gaps block, race
  control's banner and the panels' flag-coloured borders are as strong as they were, and no badges: the Racing Desk mark and the car's
  maker are not shown, the row they were in is the controls, the pedals and the clock (landscape `ctrl×7 pedals×5
  timer×5`, portrait `ctrl×9 pedals×8 timer×7`), their WebGL canvases (the chevron drift, the maker's flag) are not
  started, and the crop of his paint is never asked for (`car-logos.js` `requestRemoteLivery` fetches nothing on an
  iPad; in the page OBS draws, where the badge is in the picture, the same call fetches the crop from the loopback
  listener).
- **Data**: the plugin sends 330 keys; the glance layout reads the ones a driver reads at a glance, every one the rig's
  HUD reads (all its panels are here) and what the panels above add. By panel: position, places since the start, lap, live
  lap, the delta (`Position`, `DS.StartPosition`, `PositionDelta`, `CurrentLap`, `CurrentLapTime`, `DS.LapDelta`); the gaps,
  the drivers' names and iRatings and the sectors (`iRacing_Opponent_*`, `DS.Sector*`); the tacho (`GameData.Gear`, `Rpms`, `SpeedMph`,
  `DS.RpmRatio`, `CarSettings_MaxRPM`); the leaderboard and its sparklines (`Leaderboard`, `Grid.SessionState`, `DS.SessionMode`); both maps
  (`TrackMap.*`); the laps panel (`LastLapTime`, `BestLapTime`, `DS.SectorBests`, `DS.TrackPct`, `DS.FuelLapsRemaining`,
  `RemainingLaps`, `RemainingTime`, `TotalLaps`, `DS.IsLapRace`); the ratings (`iRacing_DriverInfo_IRating`,
  `_SafetyRating`, `DS.EstimatedIRatingDelta`); the car's controls (`CarControls`, `DS.AbsActive`, `TcActive`); the pedals (`GameData.Throttle`, `Brake`, `Clutch`);
  the pit box (`DS.Fuel*`, `Tyre*` wear and temperature, `Strategy.*`, `AirTemp`, `TrackTemp`, `WeatherWet`,
  `PitBox.FastRepairRequested`, `WindshieldRequested`); the datastream (`DS.LatG`, `LongG`, `YawRate`, `SteerTorque`);
  the incidents (`DS.Incident*`); the flags (`currentFlagState`, and iRacing's `SessionFlags` where the host sends it); the danger rings on both maps (`DS.IncidentCoach.*`); the ambient colour (`DS.Ambient*`); the spotter, the
  commentary and race control. **Left out**, and why: the pit menu's controls and their state (`PitBox.PitSv*`, `Has*`,
  `Tire*` requests, `TiresRequested`, `FuelRequested`, and the requested tyre pressures `PitBox.Pressure*`: the rig's pit
  box does not show pressures either, and there is nothing to press on a screen with no touch targets); `Strategy.GripScore`
  and `CanMakeItToEnd` (the strategy engine's own reasoning: what he sees is its call, and the fuel against the laps to
  go in green, amber or red); the pre-formatted copies of numbers shown from their raw values (`DS.*Display`,
  `GapAheadFormatted`, `BBNorm`); `Session.*`, duplicates of `DS.*`; `DS.IRatingFieldSize` and `LicenseString`; the Moza wheel base's connection state (the desk's).
  What is not in the payload at all: a fastest-lap holder, sector times of the other cars, and any pace of theirs beyond
  the last lap.
- **Tests**: `tests/unit/drive-view.spec.mjs` serves the real page through `remote-server.js` at the seven iPad sizes, and
  opens the rig's own two screens (1920x1080, 2560x1080) from the file with drive mode switched on — no server and no
  `html.rd-remote`, so the two badges are cells and the glass is the rig's — in a race, at P12 and P21, with a prototype's
  dials, a formula car's DRS, under a yellow flag, with the strategist calling, and out of a race, and holds it to: every
  panel a cell, inside the screen, none on another,
  the cells the screen, nothing cut off by its cell or out of sight (every line of text against the box its ancestors show),
  no label under 11px and no number under 20px, the HUD's own type, colours and glass (compared with the HUD's page, item
  by item); the flags as the background and gone when cleared; race control's whole sentence for each flag at every size;
  the banner gone when another flag replaces its own; the panels and the badge opaque under every flag; the spotter over
  the datastream and not the circuit; the clock's key; the strategy calls; the laps panel's numbers; the gaps' trends;
  the pit box inside its cell at 1920x1080 and 2560x1080 on the rig; every panel shown whatever the settings hide, and the
  settings back after; the menu the one touch target. `tests/unit/gap-trend.spec.mjs` runs the trend in Node. Golden
  frames of the glance layout at 1180x820 and 820x1180 are in `tests/golden/glance.spec.mjs`. The flag states the field adds are
  in `tests/unit/session-flags.spec.mjs` (the decoding, bit by bit, and the values his recordings have) and
  `tests/unit/session-flags-hud.spec.mjs` (what the glance layout and the rig's gaps block draw for each, with the recorded
  values of practice, the grid, the parade and the cool-down; the rig's labels centred; the local yellow's hold; the notices,
  the start lights, and the page as it was without the key).

## The following map's zoom (`modules/js/map-zoom.js`, `window.RacingDeskMapZoom`)

The local view that follows his car (`#zoomMapSvg`, drawn by `webgl-helpers.js` `updateTrackMap` on the rig's HUD, in
the glance layout, on the iPad and in both pages OBS draws) zooms with his speed. He asked on 2026-10-01: "include a
zoom into my car on the following map that scales in with my speed increasing and out when it decreases, in relation
to that speed change". Most dashboards go the other way (wider at speed, to see further ahead), which is what the old
curve did (closest at a standstill, widest at 75 mph and above), so which way it goes is one setting, **"Following map
zoom" in Settings → Look** (`followMapZoom` in `overlay-settings.json`; `modules/desk/settings-model.js`): `closer`
("Closer at speed", his ask and the default), `wider` ("Wider at speed"), `fixed` ("Fixed", one view at every speed).

- **The curve** (`targetRadius(speedMph, mode)`): the view is a radius in the map's own units (the outline is drawn in
  a 0–100 space; on the rig the view is 2r across with the car at its centre, in the glance layout 2r across by its
  cell's shape with the car two-thirds down, as before). The bounds are the two the local view has always had, so
  neither end is new on his rig: `R_CLOSE` 5.6 (the closest: an eleventh of the map across, never a blur of track) and
  `R_WIDE` 16.7 (the widest: a third of the map, never the whole circuit, which the full map beside it is). Between
  them the radius is linear in speed from 0 to `SPEED_MAX_MPH`, 150 mph (the top of what his cars do, so the view
  goes on changing the whole way up a straight), clamped beyond: closer `r = R_WIDE − t·(R_WIDE − R_CLOSE)` with
  `t = clamp(speed/150, 0, 1)`, wider the same the other way up, fixed `R_FIXED` 11.15, the middle. A speed that is
  no number is a standstill; a mode that is none of the three is `closer`.
- **The ease** (`ease`, `follower`): the drawn radius follows the target with a first-order ease of time constant
  `TAU_S` 0.4 s — 63 % of a step in 0.4 s, 90 % in 0.93 s, 99 % in 1.8 s — by the page's own clock
  (`performance.now()`), so a slow frame moves it as far as the time says and no further and a step is never a jump;
  the first frame sets it outright; a frame after a pause eases as if a second had passed at most, so a page that
  was in the background does not jump when it comes back; a change of the setting eases to the new view too.
  Telemetry noise of a mile an hour or two moves the target by less than a tenth of a unit, and the ease takes the
  rest out. `webgl-helpers.js` keeps one `follower` and asks it each frame with the speed, `_settings.followMapZoom`
  and the clock; everything else of the local view (the rotation to heading up, the cell's shape, `--px`) is as it was.
- **Where the setting goes**: `config.js` `_defaultSettings` has `closer`; the desk's Settings → Look offers the three;
  the pages OBS draws get it through the display allowlist (`remote-server.js` `DISPLAY_SETTINGS`), and the iPad
  through `IPAD_SETTINGS`, which now lets each key through only as the kind of value it is (a number for the panel
  background, one of the three words for this). **A settings file from before the setting is given `closer` once**
  (`migrate`, `migrateFile` through `settings-file.js`; `main.js` `migrateFollowMapZoom`, at start, before anything
  reads the file; a value that is none of the three is put to `closer`; a file that cannot be read is left as it is).
- **Tests**: `tests/unit/map-zoom.spec.mjs` — the curve in Node (the bounds, each direction, fixed, proportion,
  clamping, the ease's time constant, the follower, noise), the migration (the function, the file, a first run, an
  unreadable file, main.js's call), and the pages: the rig's HUD up and down a speed ramp in each mode and with the
  setting changed in place, its glance layout, the iPad told the setting by its server (and a change within its ask),
  and `/obs` through the allowlist — the settled view at each speed, every move within what the ease allows for the
  time it had (no jumps), the car where it was. `desk-settings-model.spec.mjs` holds the control;
  `remote-server.spec.mjs` the allowlists. The glance layout's two golden frames were re-made for it (and for the
  incidents panel): at their 127 mph the view is close where it used to be at its widest. The rig's in-car frame is
  unchanged: its fixture has no track map (`TrackMap.Ready` 0), so the local view draws nothing there.

## Flags (`modules/js/session-flags.js`, `window.RacingDeskSessionFlags`)

The payload's one word, `currentFlagState`, cannot tell a local yellow from a full-course caution and leaves out the rest, so
the host also sends iRacing's `SessionFlags` bitmask whole, under `DataCorePlugin.GameRawData.Telemetry.SessionFlags` and only
where the sim says it (root CLAUDE.md, Flags). `read(payload)` takes it (an integer of the field's 32 bits, signed or not;
anything else is not read as one, and a payload without it is `null`), `decode(raw)` says what it means, `flagOf(detail, word)`
is the flag the page shows, `createNoticeTracker()` the notices said once, `lightsPhaseOf(payload)` the start lights. Pure, so
it runs in Node; `poll-engine.js` calls it where it used to go by the word alone, and **the word is still read, and is all
there is, with no such key** (a SimHub plugin from before it, a replay, the demo).

- **The flag, in this order** (the first that is up): red; disqualified (0x20000, `disqualify`); the meatball (0x100000);
  black (0x10000); the black flag furled (0x80000, `furled`, a warning); a full-course caution (0x4000 or 0x8000, `caution`,
  or `onetogreen` when 0x200 is up with it); a local yellow (0x8 or 0x100, `localyellow`, not once the chequered flag is
  out); blue; debris; white (0x2, the last lap); chequered; green held (0x400, `greenheld`); green. `yellow` stays the
  word's own for "yellow, which one not known", and `orange` (a car ahead being lapped) is in the word and not the field, so
  it is kept where the field says nothing else is out.
- **0x200 is nothing on its own.** It is the SDK's `oneLapToGreen`, and in his recordings it is up whenever the car is not
  under green: all of practice and test sessions (`0x10040200`), qualifying out-laps, the grid before every start, the
  warm-up and the parade (`0x20040200`, `0x20040600`), and beside the chequered flag in the cool-down (`0x10040201`). A
  flag made of it would be on all through practice, tint the glance layout yellow and white, and in the cool-down take the
  chequered flag's place, which hides the finish screen (`poll-engine.js` hides it when the flag is no longer `checkered`).
  So it is read only with a full-course caution up (`decode().oneToGreen`), the one place the SDK's name fits and the one
  combination no recording has; with none it is not a flag and never ranks above the white or the chequered flag. It is not
  a lap to the finish either (that is the white flag, and the laps to go are the clock's). The same scan has the chequered
  flag with a yellow waved after it (`0x10040101`), which is why a local yellow does not take the chequered flag's place.
  The values are held as recorded in `tests/unit/session-flags.spec.mjs` and on the page in `session-flags-hud.spec.mjs`.
- **What each says and looks like**: the gaps block (the rig's and the glance layout's) says `LOCAL YELLOW` / "Local yellow —
  slow in this sector", `CAUTION` / "Full course caution — hold position", `1 LAP TO GREEN` / "Green flag next lap — be ready"
  (under a caution only), `GREEN HELD`, `BLACK FLAG WARNING` / "Warning — a black flag may follow", `DISQUALIFIED`; the
  glance layout's background is per state (`drive-view.css`, `body[data-flag]`) and the rig's gaps block has a
  `.flag-<state>` class for each (`dashboard.css`, where `.flag-label` is centred and balanced, since the longer labels
  wrap to two lines in the rig's 272px block; `webgl.js` has the WebGL colours and `ambient-light.js` the ambient colour).
  Race control's banner is up for the caution (worded "Full course caution — hold position"), the black flag furled and
  disqualified, as it is for red, black, the meatball and chequered; a local yellow and one lap to green are in the gaps
  block only — a sector and a lap are not events. A flag is held for a minimum time from when it comes up (`FLAG_HOLD_MS`
  in `poll-engine.js`; a local yellow's is three seconds, the shortest): one that clears within it stays on show to its
  end, so a local yellow that comes and goes with the sector he is in does not flicker, and one that has been up longer
  than that goes the moment it clears. Green held is shown only after another flag (a restart), as a green is; steady, as
  in the parade and at the start, it is not shown.
- **The small notices** — ten to go (0x800), five to go (0x1000; if both are up, this one) and halfway (0x80, `crossed`) — are
  a card each in the spotter's stack ("10 laps to go", "5 laps to go", "Halfway", under "Race control"), said once when the
  bit comes up; a frame with no field forgets what was up. They are not flags: `data-flag` stays as it was.
- **The start lights**: set (0x40000000) lights the grid's five columns red and go (0x80000000) green with the GO, as the
  grid's own phases 6 and 7 do (`formation.js`), where the plugin's own `LightsPhase` says nothing (0) and it is not
  qualifying or the demo. Ready and hidden draw nothing new. The mapping of set to "all red" is by the names; it has not been
  watched against a real standing start.

## The livery behind the car badge (`#carLogoSquare`, `#carLivery`)

The square under the car's logo shows a section of the paint the sim is showing on his car, under the logo and the
car's name, over the maker's colour: the root CLAUDE.md (Desk, The livery behind the car badge) has what is chosen
and when, and why the main process and never the page does it. This is the page's side and the picker's.

- **The page** (`car-logos.js`): `#carLivery` is the first child of the square (dashboard.html), `.car-livery` in
  `dashboard.css` — absolute over the whole square, `background-size: cover`, its `::after` a radial and a vertical
  darkening (16 to 62 in 100 black) so the mark and the name read on any paint, faded in over 0.6 s; the logo and the
  name sit at `z-index: 1` above it, and the maker's flag canvas, which comes after it in the square, is drawn over
  it. `setCarLivery(url)` sets the layer's `background-image` and `.has-livery` on the square, or empties both for
  anything that is not a string: the maker's colour set on the square shows through. In the app the preload's
  `onLogoLivery` (the main process's `logo-livery` message, the data URL or null) and `getLogoLivery` (for a page that
  loaded after the crop was chosen) are all it listens to. In the glance layout (`drive-view.css`) the darkening takes
  the glass's colour as the panels do, and more of it under the flags the panels take a heavier tint under — the same
  `:is(...)` list as the panels' (green, green held, yellow, caution, one to green, red, white, chequered, meatball,
  debris, disqualified); under a local yellow, a blue, the black flag, its furled warning and the orange of a car being
  lapped the panels are as they were, and so is the badge (`tests/unit/logo-livery-page.spec.mjs` holds the list) —
  over an opaque base: the crop is opaque, so the flag's pattern shows through the badge no more than it did.
- **The badge is not one shape.** It is 204 by 138 (1.5 to 1) in the glance layout on the rig's ultrawide at 2560 by
  1080, 91 by 105 (0.87) on an iPad at 1180 by 820, and square (162 by 162) on the rig's HUD, measured. The crop is cut
  at the widest of them (`BADGE_ASPECT` in the picker, 1.5 to 1: 512 across and 341 high), the layer is `cover`, so a
  narrower badge shows the middle of it, and the picker scores that middle too (below), so the section has artwork in
  it in every badge.
- **On an iPad** the badge is not shown at all (he asked for the logos to go, 2026-09-30; The glance layout, above), so
  the crop is never asked for: `requestRemoteLivery()`, which `poll-engine.js` calls where the car's model changes
  and where the page's in-car state goes from out to in, fetches nothing there. The server still serves `/livery-crop.png`
  from the main process's memory — the one address, no query, the key's cookie — and `fetchRemoteLivery`
  (`window._fetchRemoteLivery`) is what reads it: a 200 as a blob URL, a 404 as the layer emptied, the same crop
  told again (its `ETag`) kept as it is. **In the page OBS draws** (`window._obsMode`, served by the loopback listener
  at `/obs`) the badge is in the picture, so the same `requestRemoteLivery()` does fetch: a few asks over the first
  seconds (`LIVERY_ASK_AT_MS`), in case the rig has not chosen the crop yet, from the listener the page came from
  (`tests/unit/hud-page-obs.spec.mjs`).
- **The picker** (`logo-livery-picker.js`, `chooseWindow` / `chooseCrop`): the sheet is averaged down to 320 across,
  every pixel gets a luminance, an edge (a step of 24 or more to the next pixel) and a hue bin (twelve round the
  wheel, and one for everything with no hue to speak of: grey, white and near-black are one colour, so black-and-white
  lettering is not a palette), and every window of the badge's widest shape (`BADGE_ASPECT`) at 15, 22, 30 and 40 in
  100 of the shorter edge, stepped a quarter of its width, is scored: edges above all (`0.5 × min(1, edges / 0.3)`),
  then the spread of its colours (`0.3`), then its count of hues (`0.2`), less what the base or the ground covers past
  half the window. A window wider than the narrowest badge (`NARROWEST`, 0.85) is scored twice, over its whole and
  over its middle — what that badge shows of it, cover-fitted — and is in only if both are, at the lower score, so that
  two patches at the ends of a gap are not a section the square badge would show the gap of. **Put out**: a window mostly transparent (mean alpha under a half; `tga.decode` keeps a 32-bit
  file's alpha when asked, `keepAlpha`), one whose commonest colour covers more than 55 in 100 (the base coat), one
  more than half the sheet's own commonest colour (the template's empty ground) — **unless it is busy throughout**:
  edges on 15 in 100 of its pixels or more, and the base under 80 in 100. That exemption is what finds the
  wordmark on a black car: on his Lotus 79 the wordmark windows are seven-tenths black with edges on four-tenths of
  their pixels, and the rule without it chose nothing on the Lotus, the Nissan GTP and the MX-5's orange-and-white
  (2026-09-30, the library's paints). **Two flat fields with lettering on them** are put out as well (`TWO_SHARE`): a
  window whose two commonest colours together cover more than 80 in 100, unless it is busy throughout — busy as above
  and with artwork in at least three-quarters of its 4 by 4 cells (`COVERAGE_MIN`; a cell has artwork when edges are
  on 6 in 100 of its pixels). That is what his Porsche 911 GT3 Cup (992) sheet had for a crop at first (review,
  2026-09-30): a black box, the template's white beside it and half a word across both, 47 in 100 black and 40 in 100
  white, edges on 22 in 100 of the window but artwork in only ten of its sixteen cells; it was two flat greys in the
  badge. A shard field or a wordmark across a black car has artwork in every cell and stays in. Then a window of one
  hue, and one scoring under 0.5 (dull: two flat colours meeting along a line score about 0.35; his shard fields 0.76
  to 0.92, the Lotus's wordmarks about 0.6). Over his paints with these rules (31 installed, the library's hand-made
  versions and samples of the shard ones, at 1.5 to 1): 54 of 57 give a crop; the Dallara IL-15 (a dark base with small
  sponsor marks) and the Nissan GTP's two library versions, which are black with orange marks no window of the badge's
  shape is mostly more than, give none, and their badge is the maker's colour. The
  choice is random among the best five that are not the same spot (no two overlapping by more than 35 in 100 of the
  smaller) and none under 0.7 of the best; the worker is given a seed from the main process's random, so a choice
  can be repeated in a test (`seeded`). The crop is the window averaged down to 512 across. Sponsor marks come out as
  the sheet has them, which on some panels is upside down: the sheet is the car unwrapped, and nothing here knows
  which way a panel faces.
- **Tests**: `tests/unit/logo-livery-picker.spec.mjs` (sheets made up in the test: a flat body with one busy patch
  picks the patch; a flat paint, a noisy one, two colours along a line, a transparent sheet, two flat fields with a few
  letters on them, and a field of greys give nothing; a two-colour shard field, a wordmark across a dark body and a
  mark across the ground are in; the choice random among the best few and the same for the same random; the badge's
  widest shape held inside the sheet, with artwork in the middle of every window too), `tests/unit/logo-livery.spec.mjs`
  (the keeper and the real worker over TGAs written to a temp folder: what the payload names, once per car, the paint
  folder never left, the byte cap, the header cap that refuses a few kilobytes declaring 16384 by 16384, a newer pick
  ending the worker of the one before it — three in 40 ms steps leave one, the others terminated and silent — the last
  car's crop taken away when the car changes and kept for the same car, no id or path in the log),
  `tests/unit/logo-livery-page.spec.mjs` (the real page: in the app, in a browser, and on an iPad through the real
  server, which asks again on getting back in; the darkening's flag list), the crop's address in
  `tests/unit/remote-server.spec.mjs`, `keepAlpha` in `tests/unit/paints-tga.spec.mjs`. The golden frames have no paint
  (their fixture names no car the rig has), so they are unchanged.
- **Not built**: the helmet and the suit (they come with the livery he applies, not from here); a preview of the
  crop on the desk; preferring a panel that faces the right way up.

## The delta: what the gap is against

`RacingDesk.Plugin.DS.LapDelta` is iRacing's `LapDeltaToBestLap` (`TelemetryCapture.cs`), and iRacing measures that against
his **best lap ever in that car at that track** (the lap file it keeps in `Documents\iRacing\lapfiles`), not against the
session: it is valid before the session's first lap is done and stays positive until that lap is beaten. At Zandvoort on
2026-09-29 it was positive on 87% of the frames of his qualifying and 72% of his race, which is why it was red with a
plus nearly always. `modules/js/lap-delta.js` works out the gap to **his best lap of the session**, and to the **optimal
lap** (his best of each sector), from his own laps as the page sees them: where he is round the lap (`DS.TrackPct`) and the
time on it, at each frame. A lap is one to measure against when it was seen whole, from the line to the line, off pit road
and not marked invalid (`DS.IsLapInvalid`); a new session (its type and track) starts again. The HUD shows one delta,
labelled with what it is against (`.delta-ref`): his session best once he has one, else iRacing's all-time one; a minus and
green when he is gaining, a plus and red when he is losing, `0.000` in neither. The position block, the datastream's row and
the sector he is in all use it; the laps panel shows all three. Tests: `tests/unit/lap-delta.spec.mjs`.

## The leaderboard's sparklines

Each row's line is **that car's places through the race in hand** (`leaderboard.js`, `_trails`): one trail per car, its
first point the place it held at the first frame of the race in which it has one — the driver's own is `DS.StartPosition`,
his grid slot — then every change, on the page's own clock (`performance.now()`), the start never dropped (past 64 points
the oldest change after it goes). **A better place is always drawn higher than a worse one, on every row**; a dashed
hairline is where the race began (above it is places gained, below places lost). **Each row is scaled to its own range**
(at least two places wide), so the top of a cell is the best place *that car* held, which is P1 only for a car that has
led: his Tsukuba line, P8 to P4 to P9 to P6, has P4 at the top and P9 at the foot, and a car that swapped P11 and P12
fills its cell with one step. One scale for the whole field (P1 at the top of every cell) would keep the tops the same on
every row and make the mid-field's lines a few pixels of movement in a cell built for twenty places: which of the two he
wants is his to say, and it is a change to `_trailShape` alone. His own line is coloured by where he stands against where
he began (gold P1, green, red, blue), the rest are white.

- **Only in a race** (`DS.SessionMode` 4, `Grid.SessionState` 4 or 5). In practice, qualifying and warm-up "position" is the
  order of best laps, and a cell that meant two things is how a race he gained a place in drew a staircase down (the HUD's
  page stays loaded through a whole event, and the line began with the ranks of the sessions before it). Those rows draw no
  line; the last-lap column carries the lap's colour there.
- **A trail belongs to one session and one green flag**: cleared when the session's type or the plugin's track name
  changes (a frame that names neither says nothing), and at the green flag (`Grid.SessionState` 1-3 becoming 4 in a race,
  seen in `poll-engine.js`, which also clears `_startPosition` there and on a change of session type, so that a heat and a
  feature of one type at one track are told apart). `resetLeaderboardTrails()` is the way in. **The lines stay through the
  chequered flag and the cool-down** (`Grid.SessionState` 5 and 6: that is when he looks back at how the race went), held
  where the race ended and not stretched across the clock, until the session or the track changes; nothing is added to a
  trail after the flag.
- **The rows are in the order of their places**: each is put in its place before whatever is there (it used to be
  appended to the end, which left the rows of cars gone out of view at the top and cut wanted ones off the bottom when
  the view shifted by several places at once).
- **Cost**: one Map lookup and a compare per car per render (the whole field, not only the rows on show, so a car scrolling
  into view has its history); a row's SVG nodes (hairline, line, dot) are made once and written to only when the trail has
  changed or a second has gone by. Tests: `tests/unit/leaderboard-trails.spec.mjs`.

## Recording

OBS records; this app drives it and writes the telemetry sidecar beside the file. The whole of it is in
[`../../docs/recording.md`](../../docs/recording.md): the obs-websocket client, the keeper, the launcher, what Set up OBS
changes, where the state is shown (the desk's masthead on every page, the Recording card under Settings, the tray, the
Stream Deck — never the HUD, which OBS films), the settings and what is coming. The sidecar's schema is
[`../../docs/telemetry-sidecar-schema.md`](../../docs/telemetry-sidecar-schema.md); the `.rcpdv` bundle is gone.

The desk's Recording card is its own model (`modules/desk/recording-model.js`, pure: the sentences, the buttons —
Record/Stop, Save replay, Open OBS, Set up OBS, the folder — the seven switches, where the last recording went, what Set
up OBS will change in one sentence, what "HUD drawn by OBS" did, how the TV shots are going, and the race detail's TV
shots button for a race whose recording the app found) because half of it is commands, not keys of the settings file;
`tests/unit/desk-recording-model.spec.mjs` and the Recording tests in `tests/desk/desk.spec.mjs`. While TV shots run the
masthead's pill is theirs, with Stop. The password he types
goes to main (`recording:command`, `password`), is kept with safeStorage under `obsWebSocketPasswordEnc`, and is stripped
from every page's copy of the settings like `remoteServerKey` (`tests/unit/hud-main-wiring.spec.mjs` holds main.js to it).
The Stream Deck plugin (`streamdeck/racing-desk/src/plugin.js`) speaks the Stream Deck app's own WebSocket protocol with
no SDK, asks the app's loopback listener (`127.0.0.1:9091`, always up) and writes the recording's state on the Toggle
Recording key from `/api/status`, is built by `npm run build` (`streamdeck/build.mjs`, esbuild) into the `.sdPlugin`
folder, which electron-builder unpacks from the asar, and is installed from there at every app start
(`tests/unit/streamdeck-install.spec.mjs` runs the built plugin against a fake Stream Deck app).

`remote-server.js` is two servers of one kind (`createServer`): the iPad's on the home network, and the loopback one on
`127.0.0.1:9091` for the programs on this machine — the actions, `/api/status` (with his HUD switch, `hudOff`, and the
page-only actions pressed on the rig, `hudActions`, which the OBS page asks once a second and does; `window.runHudAction`
in `keyboard.js`), `/api/settings-display` (the allowlist `DISPLAY_SETTINGS` and the `show*` switches, never a key, a
folder, an address or a device), `/obs` (hidden from the first paint until the page has started, and while he has the
HUD away) and `/obs-ipad` (the same page as the glance layout, for "iPad dashboard" under the switch; it takes the display
allowlist like `/obs`, so his rig's switches for effects and ambient light apply to it, where the iPad is told none of
them: the page runs on the rig, next to the sim). The iPad's server
answers `/api/settings-display` too, with the panel background alone (`IPAD_SETTINGS`), behind the key. It is started
with retries (`startWithRetry`) until it is up. `tests/unit/remote-server.spec.mjs`, `tests/unit/hud-page-obs.spec.mjs`
and `tests/unit/hud-page-obs-ipad.spec.mjs` (the real pages through the listener, headless).

The Recording card also holds, under the "HUD drawn by OBS" switch, the choice of what OBS draws (`obsHudView`: Rig HUD
or iPad dashboard, a sentence each) and the "Panel background in OBS" slider (`obsPanelBackground`), both keys of the
settings file saved like the switches (`recording-model.js` `HUD_VIEW`, `OBS_PANEL_BACKGROUND`).

## Panel background

How solid the panels' own background is — the base fill and the glass, nothing else — is a slider, 0 to 100, and there
are two: "Panel background" in Settings → Look (`panelBackground`, `settings-model.js`) for the rig's HUD and the iPad
view, and "Panel background in OBS" on the Recording card (`obsPanelBackground`) for the pages OBS draws, whichever of
the two, so a recording can be clearer or more see-through than what he drives with. `settings.js`
(`applyPanelBackground`, from `applySettings`) reads the one the page goes by (`window._obsMode` reads the OBS one),
writes it to `:root` as `--panel-alpha` and marks `body.panels-thin` under 90. `base.css` makes `--bg`, `--bg-panel`
and `--bg-logo` from it (the secondary panels' own fills in `leaderboard.css`, `datastream.css` and `pitbox.css` read
it too), scales the glass by `--panel-glass` — down with it, never up: the streak and plastic glow of `ambient.css`,
the glance layout's tints, inset glow and overhead glow, and its opaque base under a flag — and under 90 lays a soft
`text-shadow` on the panels (it inherits to every word in them; an effect with a shadow of its own keeps it) whose
alpha is `--panel-shadow`, 0 at 90 and 1 at nought, and whose colour is `--panel-shadow-rgb`: black under the dark theme,
white under the light one (dark text, so a pale halo and not a smear). **The spotter's card and race control's banner are
not panels**: their fills are their own and solid, so they keep `--panel-glass` at 1 (their streak and plastic glow are as
at 90) and `--panel-shadow` at 0, whatever the slider says. **90 is the panels as they have always been**, on every surface: the
rig's nine-tenths, the iPad's the same, the glance layout's opaque base under a flag opaque at 90 and above, so the
defaults change nothing and the golden frames are as they were. The rig's page is told by the desk's settings path, the
iPad by its server's `/api/settings-display` (the panel background alone, asked again every ten seconds), the OBS pages
by the display-settings allowlist (both sliders, the OBS one drawn by). `tests/unit/panel-background.spec.mjs` holds
each slider at 0, 50 and 100 on its own surface and not the others', the shadow in both themes, the two cards, and the
defaults.

## Deployment Modes

`dashboard.html` powers six modes:

1. **Electron Overlay** (primary) — standalone app, always-on-top, click-through, hotkeys
2. **SimHub Dashboard Template** — installs as a SimHub template, uses `$prop()` API instead of HTTP
3. **Browser Access** — open in any browser while SimHub runs, falls back to HTTP polling
4. **LAN Remote** — built-in HTTP server for serving to other devices on the network
5. **Showcase mode** — sibling `prodrive-overlay-showcase` repo runs this same dashboard with `showcase-bootstrap.js` driving from synthesized data, embedded in the marketing-site iframe
6. **OBS browser source** — the same page from the loopback listener's `/obs`, drawn by OBS over the game when "HUD drawn by OBS" is on (`window._obsMode`)

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
by hand, on this machine — `localhost` or `127.0.0.1` at its port: the host's data is for programs on this machine only
and no page, so a flag that names another machine is ignored and a host of its own is found or started; the desk's reads go
through `main.js` (`desk:read`, `modules/js/desk-reads.js`); `tests/this-machine-rule.mjs` is the rule the tests' stand-in
hosts keep) and
puts a tray icon up — quit from it, or by closing the desk; see the root CLAUDE.md, Desk. Dev mode
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

**Headless Chromium here draws in software.** `playwright.config.mjs` launches every browser with `--disable-gpu
--use-angle=swiftshader --use-gl=angle` (`tests/software-browser.mjs` exports them as `SOFTWARE_GL_ARGS`), and so must
any script that calls `chromium.launch` on its own, which goes round the config. The rig's graphics driver stopped
responding three times on 2026-09-29 while headless pages of the WebGL HUD were being screenshotted.
`tests/unit/software-browser.spec.mjs` fails for a script in the repo that launches Chromium without them, and checks
that the browser the tests run in reports SwiftShader.

Golden frames pin the replay to a frame, block all non-plugin network, fix `Date`, and compare
screenshots with a 100-pixel allowance (runs are pixel-exact; a single colour rule moves ~1.3k px).
No CI — run locally.

## The HUD's screen

`modules/js/hud-display.js` chooses the screen the transparent window covers, and `main.js` only hands it what Electron
knows (`connectedDisplays`, `screen.screenToDipRect`) and the settings: nothing in `main.js` calls `setBounds`, and
`getPrimaryDisplay()` is used once, for the primary's id (`tests/unit/hud-main-wiring.spec.mjs`). The rule and its
reasons are in the root CLAUDE.md (Desk, "The HUD is on the screen iRacing is on"). Short: a screen chosen in Settings
(`hudDisplay`, "HUD screen" in Layout, Automatic by default) while it is connected → the screen the sim's window is on
(the host's `/racing-desk/data/simwindow`; while the host does not say, the screen it was last on) → the screen that is
the size `rendererDX11Monitor.ini` says iRacing runs at → the largest. It is decided at start, when he gets in the car
(`hud-visibility`'s `beforeReveal`, before the window is revealed), on any screen being added, removed or changed, on a
change of the setting, and by Ctrl+Shift+R. A screen's size is not DIPs times its scale: Electron's DIPs are the
enclosing rectangle (his small screen, 1440 × 1080 at 175 %, is 823 × 618), so sizes are compared within a step of the
scale and named from the host's `/racing-desk/data/monitors`, "about" when it has not said.
`tests/unit/hud-display.spec.mjs` holds the rule with his two screens (823 × 618 at 175 % primary, 3440 × 1440 at
100 %) and three-monitor, single-monitor, mixed-scale, straddling, disconnected-choice, no-host, slow-host, silent-host
and bad-ini cases; the Settings control is in `tests/desk` and `tests/unit/desk-settings-model.spec.mjs`. The Settings
page reads the list of screens again in place when the app says they changed (`hud-displays-changed`).

## Hotkeys

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+F` | Toggle the glance layout (fullscreen): every panel of the HUD as one grid filling the screen, as an iPad is shown |
| `Ctrl+Shift+H` | Switch the HUD off/on, in the car only — out of it the key does nothing, and the tray's "HUD on/off" is the switch |
| `Ctrl+Shift+G` | Restart the app. (It toggled a `greenScreen` key as it went, which nothing read; the key is gone, migrated out of the settings file.) A restart is not a quit: a recording and a replay buffer Racing Desk started run on in OBS and the relaunched app takes them over when OBS answers, so the race stays one video and its sidecar is gone on in (`docs/recording.md`). The relaunched app opens no desk window (`--no-desk`, as it starts no OBS: `--no-obs-start`), because closing the desk is a quit; a real quit while the relaunch is still waiting gives it up and stops what Racing Desk started |
| `Ctrl+Shift+R` | Put the HUD's window back over the whole screen it belongs on (`hud-display.js`: not the primary one unless that is where the rule puts it) |
| `Ctrl+Shift+D` | Restart demo sequence |
| `Ctrl+Shift+O` | Open the desk |
| `Ctrl+Shift+V` | Record or stop, in OBS. With OBS closed it starts nothing: the HUD says "OBS is not open" (OBS is started from the desk, the tray or the Stream Deck, out of the car) |
| `Ctrl+Shift+B` | Save the instant replay: the last seconds from OBS's replay buffer as a clip, with its telemetry beside it, into the recording's folder (Instant replay on, OBS open; never starts OBS) |
| `Ctrl+Shift+P` | TV shots are made from the desk after the race, with iRacing in its replay; in the car the key answers so |
| `Ctrl+Shift+I` | Held by the app; nothing listens for it now |
| `Ctrl+Shift+Q` | Quit the overlay: the HUD is put away (`hud.putAway`), the app keeps running |

`Ctrl+Shift+O` is held while the app runs; the rest only while the driver is in the car
(`modules/js/hud-keys.js`). No key quits the app. `Ctrl+Shift+M`, which reset the track map, is held by nothing: the map
is the host's, from the driver's own laps, and there is nothing to reset (root CLAUDE.md, Track maps).

## What this repo does NOT do anymore

The previous Electron BrowserWindow + DOM-scraping iRacing client (`iracing-client.js`'s `runSync`) is gone. iRacing data sync now happens via two paths owned by other parts of the stack:

1. **Chrome extension** in [`prodrive-server/apps/web/browser-extension/`](https://github.com/DOOOOM/prodrive-server) scrapes members-ng.iracing.com and posts to `/api/iracing/extension-sync`
2. **Plugin push** — the SimHub plugin posts session data to `/api/iracing/import` after each race via Bearer auth

The overlay is the live HUD and the desk; OBS records (docs/recording.md).
