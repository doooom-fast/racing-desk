# prodrive-overlay — Electron HUD

Standalone Electron overlay that renders real-time sim racing telemetry as a transparent always-on-top HUD. Built by `npm run build` at the monorepo root into `dist/win-unpacked/Racing Desk.exe`, which starts its own RacingDesk.Host (`modules/js/host-launcher.js`) — no installer; see the root CLAUDE.md, Desk.

A sibling repo, [`prodrive-overlay-showcase`](https://github.com/DOOOOM/prodrive-overlay-showcase), holds the same code with a `showcase-bootstrap.js` that drives it from synthesized data — used in the marketing-site iframe.

## Integration Contract (Overlay ↔ Plugin)

This overlay is the **consumer** side of the live-telemetry pipeline. The [SimHub plugin](../plugin/CLAUDE.md) is the **producer**.

- **HTTP API**: `GET http://localhost:8889/racing-desk/`
- **Response**: Flat JSON object with 100+ properties (telemetry, commentary, strategy)
- **Polling**: `pollUpdate()` in `poll-engine.js` calls `fetchProps()` (`game-detect.js`), one GET every 33ms (~30fps) while the driver is in the car. Out of the car, or with the HUD switched off or put away (unless the incident coach is on: it speaks from the page), in the app, the page asks for nothing and draws nothing — the main process asks once a second (`modules/js/hud-visibility.js`) and tells the page (root CLAUDE.md, Desk). Told to start again, it ends the lap it was reading (lap-delta.js `breakLap`, gap-trend.js `resume`). A page with no main process behind it (an iPad, a browser) asks once a second out of the car, to notice him getting in
- **Backoff**: Exponential on failure (1s → 2s → 4s → 8s, capped at 10s). In the app it is dropped when the main process says he is back in the car, and the page polls at once (`startConnectionClean()` in `game-detect.js`)
- **Demo mode**: Reads from `RacingDesk.Plugin.Demo.*` properties instead — switching is transparent
- **Contract rule**: Any change to JSON property names consumed by this overlay must be coordinated with the plugin
- **Tyre wear** (`GameData.TyreWear*`, `Demo.TyreWear*`) is tread remaining, 0..100 %, 100 = new, `null` where the sim has
  not measured it, and the page converts nothing: every panel reads it through `parseTyreWear` and prints it through
  `tyreWearShown`, with `TYRE_WEAR_WARN_BELOW`/`TYRE_WEAR_CRIT_BELOW`, all in `config.js` (root CLAUDE.md, Tyre wear;
  `tests/unit/tyre-wear.spec.mjs`). A corner whose tyre the engine saw changed (a stop with it ticked, or a reset to the
  pits) comes as a new set's 100 until the sim measures it, and `RacingDesk.Plugin.TyreNewSetFlags` says which corners
  (`PitSvFlags`' bits, 0x01 FL … 0x08 RR; `parseTyreNewSet`, `tyreNewSetNote` in `config.js`): the ring is 100 % and green
  like any 100, and the line under the rings says "New set · not measured" (a pair: "New fronts · not measured", rears,
  lefts, rights; an odd change names its corners alone, "New LF, RR", the widest words that stay whole at the 11 px floor on
  the iPad mini) in place of "Tread measured in the pits" until the measurement comes. The sidecar carries the flags as `wNew`.
  The strategist's offer is for the corners that are not a new set: what the accept button ticks leaves them out
  (`pitbox.js`: `selectOfferedTires`, `dropNewSetFromOffer`), and a flagged corner that arrives as `null` is still
  a dash (the flags feed the words only; the ring has no rule of its own).

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
| `obs/hud-source.js` | **Main process**: "HUD drawn by OBS" — the one browser source `Racing Desk HUD` (the loopback listener's `/obs` page, at the port the listener is really on) made once, an item of it in each scene that has an item named `game video`, in the collection the switch was turned on in and no other, just above it and fitted to it (the source is the HUD window's size in DIPs, scaled up by OBS), reloaded when OBS answers unless the page is polling, disabled off — applied at every connect, then the window goes back into the capture — and on quit, never removed; what he hid or moved is left (`apply` does the ordering, with `setContentProtection` handed in as `protect`). With "iPad dashboard" chosen (`view`), the source is the `/obs-ipad` page, made at 1180 by 820 and placed once per scene in the bottom-left corner of the game video at half its height (`IPAD_PLACE`) and never moved or sized again — not when he renames a scene; **the page is laid out at the box he gives the item** (`followBox`: the source's width and height follow the item's bounds, or its scaled size with the scale put to one; a box smaller than the least iPad in its orientation, `LEAST_BOX` 1024x744 / 744x1024, is laid out at its shape scaled up to that and drawn into the box, on every connect for the scene OBS is on and a moment after OBS's `SceneItemTransformChanged` for the item, `transformChanged`, so dragging the item's corner in OBS re-lays the page out rather than stretching it; a size typed into the source's settings is not kept); the state file keeps the scenes placed (by the scene's uuid, the name where OBS gives none) and his transform of it when the choice goes back to the rig HUD, which puts the item back over the game; an item with nothing written of it is his unless it still covers the game video as the rig HUD's fit does |
| `obs/tv-shots.js` | **Main process**: TV shots — the sidecar's moments (places gained, incidents, the pit lane) found again in iRacing's replay by their `sn`/`st` through the host's replay route (the SDK's own commands; no key; refused by the host while he is on track), recorded through a TV camera on his car by its number as one take in the race's folder, the recording paused between moments, a moment the sim does not reach skipped, the take ended where it is when he gets in the car, OBS stops it, iRacing leaves its replay, Stop or the quit; the facecam hidden, kept in `tv-state.json` and put back whatever happened, auto-record held; progress to the desk, the tray and the Stream Deck |
| `obs/recordings-index.js` | Pure: the recordings folder read by each folder's sidecar header — the race's recording by the session's start and track, the latest for the tray |
| `hud-notice.js` | The one thing the HUD may be told of recording, for two seconds: "OBS is not open", "OBS didn't start recording" |
| `restore-api.js` | **Main process**: putting back each car's seat height and brakes, as the desk sees it — the host's `GET`/`POST /racing-desk/data/restore` asked by Node (`restore:read`, `restore:command`, answered to the desk window alone: `{ switches: { brakes?, height? } }` or `{ undo: 'all' }`). The host keeps the switches; the HUD is told nothing of it. Root CLAUDE.md, Per car, for the rig |
| `desk-frame.js` | The desk window is held to `desk.html` (a navigation or a new window the page starts is stopped), and its IPC channel answers a sender frame at that file alone (`fromDesk`) |
| `telemetry-sidecar.js` | Pure: the `.telemetry.jsonl` beside the video, written by the keeper; every frame carries the sim's `SessionNum` and `SessionTime` (`docs/telemetry-sidecar-schema.md`) |
| `recording-settings.js` | The recording keys of `overlay-settings.json` and the once-only migration from the Electron recorder's; the default folder is `D:\Racing Desk\Recordings` |
| `streamdeck-install.js` | The Stream Deck plugin copied from the unpacked folder into the Stream Deck app at every start |
| `token-loader.js` | Fetches design tokens from server (`/api/v1/tokens/native`) |
| `pedal-curves.js` | Renders pedal-input traces (throttle / brake / clutch) |
| `formation.js` | Pre-race grid + formation lap UI |
| `idle-nav.js` | Carousel of stats during idle moments |
| `qr-code.js` | QR for pairing to native apps / sharing |
| `hud-display.js` | **Which screen the HUD's window is on** — the one he chose, else the one the sim's window is on (asked of the host), else the one iRacing's ini says it runs at, else the largest; not the primary. Pure rule + a keeper that moves the window (never shows it). Root CLAUDE.md, Desk |
| `car-controls.js` | What the controls panel shows of the car's anti-lock, traction, bias, its other dials, DRS and push-to-pass, from the host's `RacingDesk.Plugin.CarControls`, in words where they fit (see The controls panel) |
| `words.js` | Words, not capitals: the acronyms that may be shown in capitals (`ACRONYMS`), the car list's own short labels (`CAR_LABELS`), and `sentenceCase` / `labelCase`, which every word from the wire goes through (see Words, not capitals) |
| `lap-delta.js` | The gap to his best lap of the session and to the optimal lap, worked out from his own laps, and how a delta is written and labelled (see The delta) |
| `laps-panel.js` | The glance layout's laps panel: the times, the sectors, the three gaps and the fuel to the flag (see The glance layout) |
| `gap-trend.js` | Whether the cars ahead and behind are closing or dropping away, lap on lap: the ▼ or ▲ beside their iRating in the gaps block of the glance layout (see The glance layout) |
| `session-flags.js` | iRacing's own flag field (`SessionFlags`, the host's `DataCorePlugin.GameRawData.Telemetry.SessionFlags`) read into the flag the page shows: a local yellow apart from a full-course caution, one lap to green, green held, the black flag furled, disqualified, the small notices and the start lights (see Flags) |
| `logo-livery.js` | **Main process only**: the crop of his own paint behind the car badge — which paint, when it is chosen, what is kept and handed to the page and the iPad (see The livery behind the car badge) |
| `logo-livery-picker.js` | Pure: the window of a paint sheet with artwork in it, scored, and the crop of it; runs in the worker and in Node tests |
| `logo-livery-worker.js` | A worker thread: reads one paint inside the paint folder, decodes it with `paints/tga.js`, asks the picker, answers with the PNG and no path |
| `session-kind.js` | Pure: which session the frame says it is, from `RacingDesk.Plugin.SessionTypeName` — a test drive (iRacing's "Offline Testing") or not (see The glance layout, A test drive has no leaderboard) |
| `map-zoom.js` | Pure: the following map's zoom with his speed (see The following map's zoom) — the curve, the ease on the view's scale and its cap, the follower a page keeps, the view at which the glance layout's local view has its pixel weights, the `followMapZoom` setting's words and its once-only migration in the settings file |

Plus the original set: `poll-engine`, `config`, `webgl`, `webgl-helpers`, `drive-hud` (only the switch for the glance layout), `leaderboard`, `datastream`, `spotter`, `pitbox`, `sector-hud`, `track-map`, `game-logo`, `car-logos`, `game-detect`, `settings`, `connections`, `keyboard`, `commentary`, etc.

## Words, not capitals (`modules/js/words.js`), and one header for every panel

He asked on 2026-10-02 for no text in capitals but an acronym, for words instead of acronyms where they fit, and for one
style for every panel's header (the root CLAUDE.md, Words, not capitals, has his words). On the HUD, the glance layout,
the iPad, both pages OBS draws and the desk:

- **No stylesheet sets text in capitals** (`text-transform: uppercase`, small capitals; the desk's and the Cars
  island's neither), so what is written is what is shown: sentence case in the markup and the scripts ("Leaderboard",
  "Laps to go", "Tread measured in the pits", "No adjustments", "Pit limiter"), units as they are written (mph,
  km/h, rpm, kg, Nm, °C), an acronym in capitals. Tracking that was there for capitals is halved or gone.
- **`words.js`** (`window.RacingDeskWords`, or `require` in Node; loaded before `car-controls.js` in `dashboard.html`):
  `ACRONYMS`, what may be in capitals anywhere (DRS, P2P, DQ, OBS, HUD, TV, GT, GTP, MDM, the corners' LF/RF/LR/RR, the
  sims' ACC and AMS, TT, GOAT…; not FPS, FOV, ERS or SOF, which are words now);
  `CAR_LABELS`, the car list's own short labels (TCLO, BBAL, FARB, and HYS, IBS and SOC, which only a car's dash shows), shown only in a controls cell where the words do
  not fit and on the desk beside the words; `sentenceCase`, which lowers a word in capitals that is not an acronym and
  puts up the first letter of a text that begins with a lower-case word (NONE is None, SAFETY CAR Safety car, 1 LAP TO
  GREEN 1 lap to green; iRating and a name stay as they are); and `labelCase`, the same with the car's labels kept (TC
  TOGGLE is TC toggle). Every word the wire brings to the page goes through one of them — the controls' states,
  positions and labels (`car-controls.js`) and the strategist's calls (`poll-engine.js`) — since a SimHub plugin
  installed before 2026-10-02 still sends them in capitals.
- **Words for acronyms**: the controls (The controls panel, below), Safety (the ratings' SR), Force feedback and Sim
  feedback max (FFB), Frame rate (FPS), the desk's Field of view (FOV), **iRating where the line is whole in its cell**
  (the gaps' "3210 iRating": `_sayRating` in `poll-engine.js` writes the words, measures them to the fraction of a pixel
  with the trend after them ("· ▼0.5/lap") and falls back to "3210 iR" where they are not whole — always on the rig,
  whose cells are 66px across, and on an iPad on its side; the commentary, the desk and the results screen say iRating
  outright), and **the pit box's corners**: Left front, Right front, Left rear and Right rear on the rig and in the
  short wide box's one row over each ring, LF/RF/LR/RR in the glance layout's 2x2 where the name sits at the cell's
  corner beside the ring's shoulder (`.pb-pos-words` / `.pb-pos-short`). What stays an acronym: what `ACRONYMS` has, a
  licence class, a position's P4.
- **Sentence case is for every heading**: Title Case hid where capitals were set by a stylesheet before ("Incident coach",
  "Rage spikes", "Race summary", "Areas for improvement": the spotter's card, the results screen and its coach).
  The scan reads for it (below). Names are as they are (Racing Desk, Trading Paints, Stream Deck), and so are the calc
  engines' archetypes and moments, which are names given to the driver ("The Swiss Army Knife", "Win Streak").
- **One header for every panel** (`dashboard.css`, "One header for every panel": `--hdr-size`, `--hdr-weight`,
  `--hdr-track`, `--hdr-color`): `.lb-header`, `.ds-header`, `.inc-label`, `.panel-label` (the gaps' Ahead and Behind,
  the ratings', the laps panel's), `.pb-tab` (the pit box's tabs: the one that is open is white with its green rule
  beneath, as it was) and `.race-timer-key`, and in the glance layout the pit box's pages (`.pb-page::before`). Of the
  two styles there were, the `.panel-label`'s: the HUD's face at its smallest size (`--fs-xs`), weight 700 — since the same evening, when he asked for headers larger in general and lighter than the data, Light (300) at `--fs-lg` (13px) — the
  theme's dim text colour (`--text-dim`), no rule beneath, and tracking of 0.04em, half its 0.08em, which was spacing
  for capitals. The other — 0.12em, white at 0.35 with a rule beneath: the leaderboard's, the datastream's and the
  incidents' — went. **Where it sits**: a panel's header is at its panel's top left, its text 11px in and 7px down
  from the panel's edge (the panel's border, its 6px and its 10px), the same for the leaderboard's, the datastream's
  and the incidents', on the rig and in the glance layout (`tests/unit/words-not-caps.spec.mjs`, "where it sits"; the
  leaderboard's and the incidents' were 2 to 4px off the datastream's). In the glance layout every one is one size,
  `--hdr-glance` (`max(14px, min(1.7vmin, 19px))`, `drive-view.css`; the gaps' Ahead and Behind on a line of their own height, so that they fit a 10.2" iPad's cell). **Not headers, and so not moved or restyled**
  (decided here and open to him): the labels that name a column and sit centred over it — Ahead and Behind, iRating
  and Safety, Laps to go — which have the one style and are placed by their column; the pit box's tab bar, whose tabs
  are centred across it and whose open tab is marked by white and its rule (a state, not a style); and the pedals'
  Throttle, Brake and Clutch, which are captions of their bars, as the maps' names are captions under the circuit and
  are as they were.
- **Tests**: `tests/unit/words-not-caps.spec.mjs`, with `words-scan.mjs`: `words.js` itself; no stylesheet in
  capitals; no word in capitals but an acronym in `dashboard.html` and `desk.html`, in the strings the scripts show (read
  with TypeScript's parser, so comments, keys, selectors and addresses are not taken for text; `remote-server.js`,
  `main.js`, the Cars island and **the calc engines the desk's bundle holds** among them), in the car list's labels,
  words and positions, and in the commentary's titles, lines and fragments — and that the scan finds what it is for
  (a shown LEFT or a STARTED in a sentence is found: code words such as GET are exempt only as a whole string); no
  abbreviation where the word fits (iR, SoF, Pos, Inc, avg, inc/race) and no heading in Title Case; the car list in
  words (his words on every car that has the control, the car's own label where nothing settles the meaning); the one
  header on the rig and in the glance layout, and where it sits; the pit box's corners; and the longest forms whole,
  on the rig at 3440x1440 and zoom 120 (by the arithmetic, in the page, and with `RD_REAL_FONT=1` in Sofia Pro Comp:
  no label the plan keeps on one line is set under 8px) and at every iPad size in the glance layout, measured: after a
  change of car with the stylesheet's transitions on (963 to 720S to Cadillac to Acura: each main cell its longest
  fitting form), the gaps' iRating, and the crowded rows.

## The controls panel (`.car-controls`: bias, traction, anti-lock, and what the car has besides)

The panel says what the driver's car has and what each control reads. **What a car has is not worked out here**: the
host sends it, from the hand-written car list (root CLAUDE.md, The car's controls), as one key,
`RacingDesk.Plugin.CarControls` — an object from `:8889`, its text from the WebSocket feed, and `read()` takes both.

- **`modules/js/car-controls.js`** (`window.RacingDeskCarControls`, or `require` in Node): `read(payload)` (the key, or
  null: not sent, not JSON, not an object with a `car`), `view(cc)` (the cells, from the reading alone), `arrange(view)`
  (which cells the rig's panel has room for, below), `signals(prev, next)` (what the spotter says), `render(panel, cc,
  hooks, state)` (the only part that touches the DOM), `clear`. `poll-engine.js` calls `read` and `render` where it
  used to compute the bias, traction and anti-lock, and nothing else in the HUD knows about the list. The old computing is still in the
  `else`.
- **What a cell shows** — the same words as the host's (`state`), in sentence case whatever case the host wrote them in
  (`textOf`; a SimHub plugin from before 2026-10-02 sends NONE, ON, OFF): None (the car has none; `.ctrl-none`), On (has
  it, cannot turn it; `.ctrl-on`), Off (a dial at its off position; `.ctrl-off`), a number or the name of a position
  (Track, Sport, the BMW's MDM) under the control's name (below), or **a dim dash under its name where the car has
  it and the sim is not saying what it reads** (`unread`, `.ctrl-unread`: the list gives no variable, or the car is not
  publishing it; never a made-up number, and the sim starting to say is not announced as a change). A control the fixed
  setup holds gets a small lock mark (`.ctrl-locked`). **Every cell's bar is the host's `fill` and nothing else**
  (`fillOf`; `--ctrl-pct`, the cell's `::before`): where the value stands in that control's range for that car, from
  the list (root CLAUDE.md, The car's controls), written every frame, so it moves as he clicks. Where the host sends
  none — the list has no range for the control, or its positions are names (the number behind MDM or Track is a
  position, not a quantity) — there is no bar. The bars the HUD once drew for the three when the host sent none (bias
  `(n-30)/40`, TC and ABS `n/12`) are the old panel's alone, for a car the list does not have (`poll-engine.js`). A mode
  (the 570S's one dial) is a cell of its own, `#ctrlMode`, and the cells it covers (`ctrl-hidden`) take no room.
- **A cell's name, in words where they fit** (he asked on 2026-10-02 for words instead of acronyms, with his own for the
  common ones: "for ABS: anti-lock, for bb: bias. for tc: traction", "mig: migration. arb: rollbar"). A control has up
  to three forms, longest first (`namesOf`, `formsOf`): its **words** — the car list's `words`, which the host sends
  with each reading ("Traction slip", "Front rollbar", "Assists"), else `ID_WORDS` for a control whose meaning is its
  id's in every car (anti-lock, bias, migration, the two rollbars), else for one of the three his words (`WORDS`: Bias,
  Traction, Anti-lock) where the car's label is the generic one; for a rollbar **"Rollbar" with a small F or R**
  (`.ctrl-mark`); and the car's own **short label** (TCLO, BBAL, "TC toggle"), through `labelCase` so a plugin's old
  BRAKE BIAS reads "Brake bias". **The cell shows the longest form that is whole at its size**: on the rig by the
  room rule's arithmetic (`chooseForm`, `fitsWhole`: whole on one line or two at no less than the 7px floor, below),
  so the sizing shrinks each form before the next is tried; in the glance layout measured in the page (`fitGlance`,
  to the fraction of a pixel: every label at its words, then one at a time the label that runs furthest past its cell
  takes its next form; a label of the row under the three still past its cell at its last form gets room from another
  of the row, the widest first, taking its next form; again when the forms change, when the panel is resized and when a
  font arrives, not on every frame; **measured after the layout has settled**: the control cells do not animate their
  size, `.ctrl-item` transitions its colours alone, where `transition: all` took a cell that was still growing from a
  None to a value for the real one and left ABS and TCLO on a cell that Anti-lock and Traction slip fitted, after a car
  change and on a fresh page). In the glance layout the cells of the row under the three are as wide as what
  they hold and share what is left over (`flex: 1 1 auto`; the row is the panel's width, `min-width: 0`, where before a
  row of long labels was as wide as their sum and ran past the panel), so a short label (TCLA, MIG) leaves the room a
  long one needs: the 963 and the 720S have every label whole at every iPad size. No form is ever cropped where a
  shorter one would be whole. **A crowded row** — more cells than an iPad has the width for with every label at its
  narrowest form — is made whole in steps, the labels as large as they can be (`fitGlance`): its cells close up
  (`.ctrl-crowded`: no border, 1px between them and 1px of padding, the panel's own padding at 3px), and then its labels
  go down together from 11px to 10.5, 10, 9.5 and 9 (`--mini-scale` on the row, `MINI_SCALES`), the forms chosen again
  at each size. Measured at every iPad size (`words-not-caps.spec.mjs` holds each by what the row can hold): the BMW
  LMDh's, the Valkyrie's and the 919's rows are **whole at every size** (at 9 to 11px, the cells closed up on most),
  the Ferrari 499P's on the 12.9-inch, the Air, the mini and the 10.2-inch on their sides (at 9 to 11px), and the
  Mercedes W12's and W13's ten dials on the 12.9-inch (at 9px). **What still does not fit**: a row that is not whole at
  9px — the Audi R18's twelve dials at every size, the W12's and W13's on all the smaller iPads, the 499P's seven on the
  9.7-inch and upright (the Air, the mini and the 10.2-inch) — is as small as it goes and **each label is cut with an
  ellipsis at the edge of its own cell and never runs into the next one's** (the rig does the same past its last
  step). The panel is some 90 to 120px tall at the iPad sizes and the row 33 to 44 of it: there is no second row to
  give, and a label of two lines would take the main row's room. The spotter's card says the words (`spoken`:
  `Traction slip ▲ 6`, `Assists ▼ Sport`), and push-to-pass its own (the SF23's "Overtake", else "Push to pass").
- **Every cell is coloured by what the control acts on** (he asked on 2026-10-02: "we also need the color coding and um,
  background scaling for all of these adjustments as well"): `familyOf` (`FAMILY`, by the list's control id, case-blind)
  gives each cell `data-ctrl-family` and `data-ctrl-shade`, and `leaderboard.css` ("The controls' colours") colours its
  value, its label and its bar by them, as bias, TC and ABS always were. **The brakes** in the bias red (the bias, its
  target and fine trim, the migration and its gain, a rear brake valve, the R18's IBS), **traction** in its blue (TC and
  its second, third and fourth dials, stability, the switch, launch), **the anti-lock** in its yellow (and its switch),
  **the engine and the hybrid** in violet (engine, fuel and throttle maps, regen, boost, deploy, engine braking, the fuel
  cut), **the chassis** in teal (the anti-roll bars, the differential, weight jacker, wing, drive split, power steering),
  **a mode** in green; **DRS and push-to-pass have none**, their states (ready, open, on) being their colours. The shade
  sets apart controls of one family that sit side by side (0 the family's own, 1 a lighter tint, 2 the hue turned, 3
  muted: the 963's bias, target and migration are three reds). The palette is defined once, as custom properties
  (`--ctrl-<family>-h/-s/-l`, the theme's lightness for a value, a label, the bar and the glow, the shades' offsets),
  and redefined under `[data-theme="light"]`, darker, so every value reads at 4:1 or better and every label at 3.5:1 on
  the light glass at its least kind (over a dark game); on the dark glass 4:1 and 3:1 (the bias red's own, as it always
  was, is 4.4 and 3.3). The three are shade 0 of theirs, which are the colours they always had, with the key and
  without it (the old panel keeps them by its ids). Every control id of the list has a family (a test fails for one
  that is added without), and the glance layout carries the same colours (it is the HUD's panels laid out again; the
  row cells there have no bar, as before).
- **The car's other controls** (`#ctrlMore`, `.ctrl-mini`): every one the list gives the car, in the list's order — a
  second traction dial (the 963's TCLA, "Traction gain"), brake migration ("Migration"), the anti-roll bars ("Front
  rollbar", "Rear rollbar"), a throttle map, the hybrid's dials — then
  DRS and push-to-pass; an unread one with a dash (`.ctrl-mini-unread`). Only for a car that has any; DRS is
  `.ctrl-mini-ready` when it can be opened and `.ctrl-mini-active` while it is, push-to-pass `.ctrl-mini-active` while
  it is on. **In the glance layout** (an iPad, the page OBS draws of it, Ctrl+Shift+F) they are a row of small cells
  under the three, as they always were, and an unread one (or an unread mode) is left out of it, as when the host left
  such a one out (`render`; the request was for the desktop HUD alone). **On the rig's HUD every one of them is a panel like the three** — he asked on
  2026-10-01: "show adjustment panels for every adjustment available for that car. Omit ones that are not on the car
  when there's no room" — the same type, label over number, with the bar: the row's box dissolves (`.ctrl-fit .ctrl-more
  { display: contents }`, `leaderboard.css`) and its cells are the panel's.
- **The rig's room** (`arrange`, `ROOM`, `labelPlan`; `.ctrl-fit`, `.ctrl-compact`, `.ctrl-tight`, `--ctrl-cols`,
  `data-ctrl-rows`, `.ctrl-omitted`, `.ctrl-label-2l`, added by `render` on the rig alone, never in the glance layout): the
  panel is 240px wide (its content 226px: the panel's own 6px of padding and 1px of border each side are not the
  cells', and `PANEL_EDGE` takes them off, so that the plan and the stylesheet's `100cqi` agree on what fits — a label
  planned on one line at 8.2px was set at 7.7px, under the 8 it wraps below) and **as tall as it has always been** — it shares its column with the pedals, which lose nothing
  (118px each at his zoom, with one row or three) — so the room is a constant of the layout and not a measurement: **a
  ladder of steps**, each with more cells across or down and its type a size down: three across in one row (22px
  numbers, 10px labels), three across in two rows, four across in two rows (the compact size: 16px and 9px), and in
  three rows of four and then of five (the tight size: 13px and 8px, 2px between the cells). A car takes the smallest
  step that holds its real controls, and **every control the car has is shown** — he asked: "show adjustment panels
  for every adjustment available for that car. Omit ones that are not on the car when there's no room" — so what is
  omitted is only what the car does not have: a None cell takes a slot only where one is left in the rows the real
  cells already need (`.ctrl-none` is a full cell, `order: 9`, so the real ones come first left to right) and never
  makes a row of its own. DRS and push-to-pass are real cells like the rest: nothing is ever dropped for them or by
  them. Past the last step the cells go on across, in three rows. The cells go across first and then down, balanced
  (four cells are two by two). Of the list's 194 cars: 135 are one row (an MX-5 is anti-lock On, bias None, traction None; a C6
  with bias, traction and a toggle is one row of three and its anti-lock None is omitted), 55 are two rows (a 720S GT3:
  bias, traction, anti-lock, map, TC toggle: two rows of three and two at the full size; a 963 GTP: bias, traction slip,
  traction gain, migration, target, front and rear rollbar, TC toggle, its eight at the compact size with anti-lock
  None omitted), and four are three rows (a Ferrari 499P of nine, a
  W12 or a W13 of eleven with DRS, four across; the Audi R18, fourteen dials, five across). A number of five characters
  (`48.25`) is set a step down so it fits three across (`.ctrl-value-wide`); a word wider than its cell (Automatic) or a
  number of six smaller still (`.ctrl-value-long`, sized to its cell by `--ctrl-value-len`, down to 7px, with no tracking
  and 0.62 em to a character: JetBrains Mono's 0.6). A mode is a cell like the others (the 570S's ESC cell is as wide as
  its bias beside it: the glance layout's wider flex for a mode is taken back under `.ctrl-fit`). **A label** is set no
  larger than its cell holds (`--ctrl-label-len`, the cell a size container: "Brake bias" whole three across at 10px,
  "TC toggle" four across at 9px), down to 7px, **and a label that would be set under 8px on one line takes a second
  one** (`labelPlan`: the split of its words that makes the wider line narrowest, set to that line's length; a two-line
  label is set at 8px at the most at the full size, 9px at the compact one and 7px in the tight rows, so two lines and
  the number fit the row; in the tight rows, where any row may have one now that the cells are in words, the cells have
  no padding above and below, the rows 1px between them and a two-line cell's number is 11px: three rows of two-line
  cells are 82px of the 84 inside the panel). Only past that — no form of it whole in its cell, and its shortest shown — is it cut with an
  ellipsis. **The width of
  a character is Sofia Pro Comp's, the page's font, not the fallback's**: measured in the page with the HUD's own
  Typekit stylesheet let through, at weight 600 and the label's tracking, the car list's 121 labels are 0.34 to 0.53 em
  a character (0.43 on average) and **0.47 at the most for a label of seven characters or more**, while the fallback
  sans-serif is 0.69 (0.81 at the most). The stylesheet's 0.5 em holds every label with a little over and was 0.74 (the
  fallback's) in the first cut, which set labels far smaller than they needed to be on the rig and was never checked
  against the real font (the headless tests block every request, so Typekit never loads there: a headless page is
  the fallback, and cuts what the rig does not). Measured with the real font, 194 cars at 3440x1440 zoom 120 and at the
  default zoom 100 in the top-right: **no label or value is cut or clipped in any of them, and the panel and the pedals
  are 118.2px each for every car** (14 labels on two lines, in 7 cars: the Audi R18, the Ferrari 499P, the Porsche
  919, the Aston Martin Valkyrie, the BMW LMDh, the Acura ARX-06 and the McLaren MP4-30; eight at the 7px floor, all
  in the three-row cars). `tests/unit/car-controls-fit.spec.mjs` holds the rest in Node over every car, and in the page
  for the sixty that need it (`RD_REAL_FONT=1` lets Typekit through for the one run that holds every label to its
  cell in Sofia Pro Comp; `RD_FIT_ALL=1` opens all 194, about three minutes). Those measurements were of the labels in
  capitals; since 2026-10-02 the forms are in sentence case and the words come first, chosen by the same arithmetic,
  and `tests/unit/words-not-caps.spec.mjs` holds the longest of them in the panel at 3440x1440 and zoom 120 (whole in
  Sofia Pro Comp under `RD_REAL_FONT=1`) and in the glance layout at every iPad size.
- **The spotter**: a change of a control is announced with its words, else the car's label, and what it reads in
  sentence case, `Traction slip ▲ 6`, `Assists ▼ Sport`, `Stability ▼ Off` (`announceAdjustment(type, value, direction,
  name, text)` in `spotter.js`; a name or text given, the card says the car's own thing; without them, `Bias ▲ 55.0`). DRS says `DRS next zone`, `DRS — open it`,
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
- **Tests** (`tests/unit/car-controls.spec.mjs`): the module's functions in Node (`arrange` at each step of the ladder
  and with a None cell at every count, `labelPlan`, `chooseForm`), then the real `dashboard.html`, headless, fed a
  payload for each case — None, On, Off, a value with the control's words and the car's label, a mode by name, GTP brake migration, TC slip and gain, the bars,
  DRS and push-to-pass, an unread dial, a car that changes, a car not in the list, a key that is not one — and the
  rig's room: the one-row car, two rows with the pedals as tall as ever, a None that is not worth a row, a mode as wide
  as the bias, six real cells with None omitted, compact, three rows and five across with nothing left out, the long
  word, the labels on one line and two, the glance layout and back (an unread dial left out there and shown with a
  dash on the rig), the panel without the key. **The cars are not typed in the spec**: they are read from
  `tests/unit/fixtures/car-controls-wire.json`, which RacingDesk.Tests holds to what the host writes
  (`Cars/CarControlsWireTests.cs`, rewritten with `UPDATE_CAR_CONTROLS_WIRE=1`). The C# side cannot be tested over
  `:8889` without binding wildcard ports, so that hop is by the code: the runtime writes `s.CarControlsJson` into the
  payload as an object. `tests/unit/car-controls-colours.spec.mjs` holds the colours and the bars: every control id of
  the real list has a family, each family its own hue on the value, the label and the bar and each shade apart from
  its family's own, the three exactly as they always were (with the key and without), DRS and push-to-pass in their
  own states, the contrast on the dark glass and the light, the bar following a value click by click, no bar where the
  host sends none, and the glance layout's colours the rig's. Where the bar comes from is the host's:
  RacingDesk.Tests `Cars/CarControlsFillTests.cs` (every range of the list fills 0 to 1 and holds at its ends, says
  where it came from, positions that are a scale and names that are not, the bar following the value).

## The datastream's rig limits (`Wheel max`, `Sim feedback max`, `Brake max`)

Three rows under "Force feedback" (it was FFB) on the rig's HUD, for what the rig is set to beside the live torque (he asked on 2026-10-01:
"Show Max pedal force and max wheel nm in the data stream"). Each has its unit, a dash while it is not known, and a switch
(`dsShowWheelMax`, `dsShowFfbMax`, `dsShowBrakeMax`, on by default); the glance layout hides all three (`drive-view.css`,
as the frame rate). Nothing is written to the pedals, the wheel base, SmartControl or Pit House, no serial port is opened for
any of it, and nothing is sent to them.

- **Wheel max** is the wheel's own maximum torque, in Nm: the base's max-torque setting (per cent of its model's rated
  peak: 21 Nm for an R21 and an R21 Ultra, 9 for an R9, 5.5 for an R5; `MozaWheelbaseModels`, and a model not in the
  table has no rating and shows a dash) as a number of Nm. Where it comes from, in order: (1) **the base itself**, where
  the plugin's poll could last ask it — the poll that already probes and reads the base every two seconds, which runs
  only while Pit House has let go of its serial ports (on the rig Pit House nearly always holds COM6 and COM13) — sent in
  the telemetry as `RacingDesk.Plugin.DS.MozaWheelbaseMaxTorque` (the per cent) and `MozaWheelbaseMaxNm` (where the
  model has a rating; `WheelbaseSettings.Model` is now the model the base's USB description names, which it never
  was before); nothing new is sent to the base for it. (2) **Pit House's own saved preset for the base**, read and
  never written (`RacingDesk.Data/Wheel/PitHouseWheelLimits.cs`): `Documents\MOZA Pit House\Presets\config.ini`'s
  `[LastUsedPreset]` maps each device Pit House has met to the preset it last used, and each preset in `Presets\Motor`
  is an ordinary zip (a `preset.json` and a `metadata.json`) whose `devices` is the model ("R21 Ultra") and
  `deviceParams.maximumTorque` the per cent (his R21 Ultra preset, written 2026-09-30: 55; `gameForceFeedbackStrength`
  70 is the game's own scale and is not read). The files are opened for reading with `FileShare.ReadWrite`, so a
  running Pit House is never in the way and nothing is created or changed (`WheelMaxTests` holds the bytes and times of
  every file before and after, and a read while another program has them open for writing). The host serves the
  answer at `GET /racing-desk/data/wheelmax` (`{ source: "base" | "pithouse", model, max_pct, rated_nm, max_nm,
  candidates }`, null each while not known) for programs on this machine, and the page's main process asks it with the
  brake force (below). (3) Neither: a dash. **What the preset is not, said plainly:** it is what Pit House last loaded
  into the base and not necessarily what the base is set to now (a slider moved in Pit House and not saved is not in
  the file), and Pit House does not say which of the bases it has met is the one attached. His Pit House has two
  motor presets in `[LastUsedPreset]` (an R9, "bmw", saved 2026-08-02, and the R21 Ultra, 2026-09-30), so **the preset
  saved last is taken** (`candidates` says how many there were); if he moves to the other base without saving a preset
  for it, the row shows the old base's number until he does. 55 per cent of an R21 Ultra is 11.6 Nm; his 963 GTP's
  29.7 Nm is the next row, not this.
- **Sim feedback max** is the sim's ("Sim FFB max" until 2026-10-02): iRacing's own `SteeringWheelMaxForceNm`, the strength slider in Nm the sim maps to full
  output on the wheel, set per car (29.7 on his 963, 27.3 on the MX-5), sent as `RacingDesk.Plugin.DS.SteerMaxForceNm`
  only where the sim says a number above nought and never in demo (`TelemetryCapture.SteeringWheelMaxForceNm`,
  `TelemetryFrame.SteerMaxForceNmKey`; `SteerMaxForceTests`). `datastream.js` reads it to one place. **It is not the
  wheel's maximum** — an R21 at 55 % tops out near 11.6 Nm whatever the sim's scale says — which is why the row is
  labelled the sim's (it was "FFB max", which read as the wheel's limit) and the wheel's is its own row. Beside SimHub the
  key arrives only once the plugin has been installed again from a build that carries it.
- **Brake max** is the host's: SmartControl's brake force in kg as the app's host follows it from Live's keys (root
  CLAUDE.md, Per car, for the rig; `CarPedalsRecorder.Now`), known from a key that sets a force and not known again after
  a held step key or between cars. The host serves it at `GET /racing-desk/data/brakeforce` (`{ car, force_kg }`, null
  each while not known) for programs on this machine and no page, so the main process asks (`modules/js/rig-limits.js`:
  on the HUD keeper's own poll, in the car, every two seconds at most, by Node with a Host and no Origin, the brake
  force's route and the wheel's together) and tells the page as the answer changes (`rig-limits`, `{ brakeKg, car,
  wheelNm, wheelSource }`; `get-rig-limits` for a page that loaded after, through the preload's `onRigLimits` /
  `getRigLimits`). A page with no main process behind it — an iPad, the page OBS draws, a browser — shows a dash for it
  (and for the wheel's, unless the telemetry itself carries the base's reading: `MozaWheelbaseMaxNm`, which the page reads
  ahead of the main process's number). The store's `car_pedal_facts.force_kg` (the force a car was *last* driven with)
  is not shown: the pedals are not put back to it when he gets in, so it is not necessarily what they are at.
- **Tests**: `tests/unit/rig-limits.spec.mjs` (the answers as read, the requests over a 127.0.0.1 stand-in, the keeper's
  asking and telling, the keeper with its own fetch against the stand-in — the host's `{ car, force_kg }` and
  `{ max_nm }` are read once, into the page's `{ brakeKg, car, wheelNm, wheelSource }`, and that is what the keeper
  checks — main.js's and the preload's wiring), `tests/unit/datastream-limits.spec.mjs` (the rows on the page: the
  units, a change told by the main process, the wheel's from the frame ahead of the main process, the dashes, the demo,
  the switches, the glance layout), `host-reads-this-machine.spec.mjs` (the requests are ones the host answers);
  RacingDesk.Tests `Wheel/WheelMaxTests.cs` (the preset's shape, two bases, a preset that is not usable, a model not in
  the table, nothing written, files held open for writing, the route, the poll's keys).

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
  the leaderboard with its sparklines and the race timeline, the full circuit and the local view, the laps panel
  (below), iRating and safety rating (`#ratingPage`, which on the rig takes turns with the position block; here both are
  up), the car's controls, the pedals, the Racing Desk mark and the car's badge, the clock (`#raceTimerBlock`), the pit
  box (its tyres, fuel and weather side by side, not tabs), the datastream, the incidents. Landscape:
  `hero×7 gaps×4 tacho×7 lb×6 / map×11 local×7 lb / map local lb / ctrl×6 pedals×5 brand×2 car×2 timer×3 rating×6 /
  pit×10 ds×5 inc×3 laps×6` (rows 18 / 30 / 13 / 12 / 23.5 fr, and 16.5 / 30 / 14.5 / 12 / 23.5 on a screen wider than 3:2
  on its side — the mini, the rig's 16:9 and ultrawide, a wide box in OBS — which is short for its width; under 1100px wide —
  the 9.7" — the right-hand column is 7 and the maps 10 and 7, for the leaderboard's names and the laps panel's two columns
  of times); portrait: `hero×9 gaps×7 tacho×8 / map×15 local×9 / lb×15 laps×9 / lb rating×9 / ctrl×8 pedals×6 brand×2
  car×3 timer×5 / pit×13 ds×6 inc×5` (rows 14 / 27.5 / 16 / 8 / 8 / 17 fr: the controls' row keeps the 8 a prototype's dials
  in a row beneath want). **The maps are 1.5 times what they were** (he asked on 2026-10-01: "Make the maps 1.5x their size
  on iPad version"), **as drawn**: the circuit's outline is at least 1.45 times the 6253ff1 layout's, on both axes, at every
  iPad size and on the rig's two screens (1.495 at the smallest, the mini on its side; 1.5 to 1.7 elsewhere), and the
  following map's cell, whose scale follows its width, at least 1.75 times as wide. Before, the circuit had 7 columns over
  34 row-units and the following map 4, with the laps panel and the ratings beside them (`map×7 local×4 laps×6 lb×7`,
  rows 20 / 24 / 10 / 13 / 29). The floors leave no width for the maps beside a 6-column leaderboard and a 6-column laps
  panel, so the laps panel and the ratings are under the leaderboard in its column and the maps' rows are theirs: at
  1180x820 the circuit's cell is 528x352 where it was 334x281, the following map's 334x352 where it was 188x281. **The
  first cut gave the cells the room and counted the cells** (1.9 times the area at 1180x820), and the circuit was drawn
  only 1.2 to 1.4 times: a circuit is limited by the height of its cell on a screen on its side, which had grown 1.2
  times, and the svg's margin round it was 6 % of the circuit's longer side (22px of 366, a seventh of that height). So
  the margin is nine pixels (`_DV_MAP_MARGIN_PX` in `webgl-helpers.js`: the outline's outer stroke reaches 6px past its
  centre line and the car's dot 7px; the svg's overflow is visible, so the glow shows into the cell's 4px of padding), and
  the rows were shared out for it: the maps 43 of 96.5 row-units on its side (44.5 of 96.5 on a wide screen; they were 34
  of 96, and 41 in the first cut) and upright 27.5 of 90.5 (21, and 27). What the maps cost, which he has not been asked
  about: on its side the leaderboard has the top three rows only (whole rows on an Air 16, where it had 21; 15 on the mini,
  the 9.7" and the 10.2"; 18 on the 12.9"); upright the leaderboard has 7 to 9 rows where it had 9, the tacho moved into
  the hero's row (`hero×9 gaps×7 tacho×8`; the place is on 9 columns of 24 where it was on 14, still at 80px), and the
  laps panel, in 16 row-units where it had 20, has lost its heading ("Laps 12 / 20", which the hero's "Lap 12" and the
  clock's laps to go say) and its third row of times ("Optimal", "vs all-time"); and the gaps block drops the words
  "Ahead" and "Behind" in a cell under 138px (134 inside; its padding and the gap between its items are 1px and 2px so that
  the Air on its side, 145px, keeps them), which is the 9.7" and the mini on their sides (the order, the sign and the
  colour say which is which). The tacho was in the maps' row upright (`tacho×8 map×11
  local×5`, rows 15 / 21 / 20 / 9 / 8 / 17) and is in the hero's now, so the maps have the row to themselves (498x343 and
  296x343 at 820x1180, where they were 363x264 and 162x264). The gaps block is a column in both orientations (its cell is
  near-square in both now), and upright the menu's button is over the tacho's corner, so its speed stops short of it as
  in a landscape test drive. The rows the floors allow: a prototype's dials want 12 units, the pit box with the engine
  calling 23.5 (where the fuel page gives up the pit's add under 240px and the window under 185px; the datastream its
  g-force diamond under 180px, and its row of the track's temperature always, which the weather page beside it says
  larger; the ratings their bar's thousands under 135px, and keep the room those take where they are shown). The hero
  wants 16.5 (the tacho's gear is cut off below about 118px: 16 on a mini). `drive-view.spec.mjs` holds the circuit's
  drawn size against the old layout's (a table of what 6253ff1 drew of the test circuit at every size), the margin round
  it, the following map's width, and the two maps to 27 % of the screen at every size. The tracks are `fr`, the edge round the grid
  `clamp(8px, 1.2vmin, 14px)` and the gutters `clamp(5px, 0.75vmin, 9px)`; nothing is set per device. Every panel is a cell
  whatever the rig's settings hide from its own screen (`settings.js` `applySettings` shows them all in drive mode, and
  leaving drive mode puts the settings' choice back), and nothing in a cell is a touch target.
- **What comes and goes** is laid over the cells, as it is over the game on the rig: the spotter's calls over the datastream
  (the least glanced-at cell, and not the circuit), race control over the top of the track, the finish (`#raceEndScreen`)
  over the track and the local view, the commentary card over the pit box, the pit limiter and the grid from the top edge.
  An absolute box placed in a grid area takes that area for its frame. Race control's sentence wraps to as many lines as
  the cell asks and none of it is cut off (`Full course yellow — hold position` had read `FULL COURSE YELLOV` when it was set in capitals); a flag
  that replaces the one it is about (yellow, then blue) takes it away at once (`poll-engine.js`), so it never says yellow
  over a blue screen (this is the rig's HUD too).
- **The glass**: each panel is the rig's — near-black at nine-tenths, an edge, and over it an overhead glow and a sweep,
  in the glass's tint: one fixed blue-grey (`--rd-glass-r/g/b` and `--rd-glass-lum` on the body in `drive-view.css`), or
  the flag's when one is out. Nothing is sampled from the screen (the sim's-screen ambient colour, `ambient.css`, the
  panels' specular streak and the glare pass's ambient glow and glass dome were removed on 2026-10-07). The glance layout
  runs no WebGL effect at all (see "No WebGL effect" below), so each panel is lit the same, by its own layers.
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
  that cannot keep up; off, the flag's movement stops and the numbers, colours and flags stay. **No WebGL effect**: the
  glance layout (the iPad's page, `/obs-ipad`, Ctrl+Shift+F on the rig) and the HUD page in OBS (`/obs`) never start
  `webgl.js`'s effects loop (`fxAllowed()`; `refreshGLFX` starts it again when the rig leaves the glance layout), the
  iPad's and OBS's pages make no WebGL context at all (`NO_FX_PAGE`), and the canvases of the effects are hidden in the
  glance layout (`drive-view.css`). The maps and every other cell draw as they did. `tests/unit/no-fx-on-glance.spec.mjs`.
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
  zoom setting is the rig screen's and is undone here. **Known and not fixed:** a short circuit name goes on sliding in the map's label after the switch to this layout (the
  marquee is measured in the HUD's narrow label); the iPad's changes did not touch it, and the tests hold the label still.
  (On his own 3440x1440 screen the rig's Ctrl+Shift+F cut the ratings panel off — the iR bar's thousands hang under the
  bar and its row did not count them — which is fixed: the bar's box keeps their room, and the whole layout is held on
  that screen now, as the page OBS draws is at that box.)
- **The hero**: in a race the place, big; out of one (`body.session-nonrace`, which `poll-engine.js` sets from
  `DS.SessionMode`, written only when it changes) the place is a rank of best laps and the big number is the delta.
- **The laps panel** (`#lapsPanel`, `modules/js/laps-panel.js`; shown only in the glance layout): the lap of how many, his
  last, best and optimal laps (the optimal the plugin's `DS.SectorBests` added up), each sector's time and its gap to his
  best of it in the gaps block's colours, his gaps to his best of the session, the optimal lap and his best ever, and the
  laps of fuel against the laps to go to the flag (in a race to time, the time left over his last lap), green with a lap
  to spare, amber just, red short. What is left to go is a span of its own that a narrow panel leaves out: the clock has it.
  **The laps of fuel are a number or a dash, never 99, and they are laps** (he asked on 2026-10-01: "The fuel in the
  sector area on iPad shows 99 laps always"): `DS.FuelLapsRemaining` was 99 from the host and the plugin alike for as long
  as the fuel per lap was not known — the host's own (`IRacingTelemetrySource.FuelPerLap`) wants one green lap off pit
  road, SimHub's a lap or two, and his practice runs that afternoon (the recordings' sidecars) each ended before the line
  with a reset to the pits, so it never was — and the laps panel read it as it was, where the pit box refused anything at
  99. The engine now says 0 there (`TelemetrySnapshot.FuelLapsRemaining`, the demo's and the strategist's
  `Strategy.FuelLapsRemaining` alike, which never calls fuel critical on a 0), and every reader on the page takes the
  wire's number through one function, `parseFuelLaps` (`config.js`): 0 is not known and so is **exactly 99**, which a
  SimHub plugin built before this still sends, and else it is a number — a hundred laps or more is one too (a small burn
  on a short oval; the first cut dropped everything from 99 up), so the page shows a dash only for what is not known.
  **Once known, the number is litres over litres**: the host serves it as `DataCorePlugin.Computed.Fuel_RemainingLaps`
  (iRacing's `FuelLevel`, litres, over the litres a lap costs), and the SimHub plugin works it the same way from the raw
  `FuelLevel` and `Fuel_LitersPerLap` (`TelemetryCapture`), taking SimHub's own `Fuel_RemainingLaps` only for a sim that
  has no raw litres: it was `FuelLevel / FuelPerLap`, and `FuelLevel` (SimHub's `GameData.Fuel`) is in the display units
  — gallons for him — where the fuel per lap is not, so a driver in gallons would have read a quarter of his laps, and
  nothing had checked SimHub's own figure for gallons. The page works out no laps of its own for the same reason. Beside
  it on the pit box's fuel page, the fuel is shown in the display units once (`DS.FuelFormatted` made gallons into
  gallons again) and the tank is the litres over the fraction of it they are (`GameData.MaxFuel`, litres on the wire:
  `FuelPercent` is 0–100 and was taken as a fraction, so the tank was the fuel in it). And the host's
  `GameData.RemainingLaps` is the session's laps to go, as SimHub's is (`SessionLapsRemainEx`, 0 for iRacing's 32767): it
  said the laps of fuel there, so the "to go" after them and the clock's laps were the laps of fuel too.
  **One number where fuel laps show**: the laps panel's fuel line, the pit box's "Laps left" and the number in the
  strategist's call ("Stop · ~6 laps") are all `DS.FuelLapsRemaining`. The strategist works out a figure of its own
  (`Strategy.FuelLapsRemaining`, over a trimmed mean of the stint's laps, made at the line and stale between laps): it
  decides the call and is what the call says only while the engine's is not known; two numbers for one thing on the one
  pit box was what the first cut had. **The pit box holds the last known laps through the pit lane** (the telemetry can
  blank during service) as it holds the fuel and the burn, but only a number — never a 99 or a nought, so on the track
  "not known" is a dash and what is held becomes one — and **not past the car, the session or the circuit** they were of
  (`_fuelHoldKey` in `pitbox.js`): a new one starts with nothing held, so the pit lane it begins in does not show the last
  stint's fuel (the first cut stored a 99 and read "99.0" on pit road after every reset to the pits). **The host forgets
  what a lap costs when the car or the circuit changes** (`IRacingTelemetrySource`, `FuelPerLap.Forget`; the same car at
  the same circuit in the next session keeps it): it lives as long as the app, and said the new car's litres over the last
  car's burn from its first frame. **The strategist makes no call in a session with no end** (a practice, a test drive:
  iRacing says 32767 laps to go, `TelemetryCapture` takes that as no count of laps, and a week, 604800 s, for the time
  left, which `FuelComputer` takes as no end beyond two days): with nothing to make it to there is no stop to need; it read
  them as 32767 laps to the flag, or assumed 99, so its "Stop" call was up in every practice once a lap had been driven —
  over his newest test drive the fuel was critical in 4738 of 6511 frames. A race to a lap count or a time is as it was.
  `tests/unit/fuel-laps.spec.mjs`; RacingDesk.Tests `Strategy/FuelLapsRemainingTests.cs` (the units through the host and
  through the SimHub plugin's capture, the host forgetting a car, no call in a session with no end — over his newest test
  drive too — and the host's fuel per lap over his newest race).
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
- **The pit box** shows what its tabs do on the rig, side by side: the four tyres (the tread remaining in the ring, as the
  wire has it — 0..100 %, amber under 35, red under 20, a dash where not measured — its temperature under it **as a
  caption**, `max(11px, 0.55em)` and dim, since iRacing measures it in the pits with the tread and it is the last stop's
  reading, not the lap's (he asked on 2026-10-01: "Tires temps aren't live so make them Much smaller"; the rings keep the
  room, their floor 46px with the wear at 20px in them; `drive-view.spec.mjs` names `.pb-circle-temp` a caption, so the
  20px number floor is not asked of it), the laps on this
  set in the heading, `Strategy.StintLaps`, and what the number is: iRacing measures tread in the pits and nowhere else,
  so "Tread measured in the pits" is one dim line under the rings, at the label's floor and never wrapped, as it is
  on the rig — an iPad's heading has no room for it, and in a pit cell under 200px (the 10.2" iPad upright) it gives way
  while a tyre call is up, which would otherwise cut the rings off by 7px; while a corner's 100 is a new set the sim has
  not measured (`TyreNewSetFlags`) the same line says "New set · not measured" or which tyres, and gives way to a call
  in that cell just the same — a screenshot with both showed the line over the rings' position labels; root CLAUDE.md, Tyre wear), the fuel (tank, level and its size, per lap, laps left, the
  pit's add, the pit window `Strategy.PitWindowOpen/Close` as `L18–24` or `by L24`, the two services), the weather. The
  strategist's call for tyres or fuel (`Strategy.TireHealthState`, `FuelHealthState`) is read where it is on the rig,
  above the rings or the tank, worded for a screen with nothing to press (`Change · ~12 laps`, `Stop · ~6 laps`).
  **The weather makes the most of its page** (he asked on 2026-10-01: "Weather needs to make better use of its space like
  incidents"): the three pages share the width 38 / 34 / 28 (the weather had 24), and the weather page is a size
  container of its own, so its values are sized by its own box the way the incidents' count is by its cell — the air,
  with the sky beside it, at the lesser of 22 % of the page's height and 30 % of its width (34px in an Air's cell on its
  side, where it was a fixed 24px), the track and the conditions under it at the lesser of 15 % and 28 % (22px, where
  they were 20), each name over its value ("Air" is a label of the markup now, `.pb-weather-k`, shown in the glance layout alone: the
  rig's own pit box, its Weather tab, has no such line, which the first cut put there, 26px taller), the three spread down
  the page; the header is the pit box's one rule for its three pages, at the top.
  `tests/unit/weather-glance.spec.mjs` holds the header against the fuel page's, the sizes, each name over its value and
  nothing cropped at the seven iPad sizes and the rig's two, in a race, wet with the engine calling, and in °F.
  Upright the pit box is narrow and the pages are 40 / 36 / 24, as they were: at 38 / 34 the line under the tyres' rings
  ("Tread measured in the pits") and the call above them were cut off on a mini, and the pit window on an Air. The weather
  page there is under 90px inside, and its sky gives way to the air (the conditions say the same). **The pit window**
  is its name beside its laps, so what it needs is the fuel page's own width, a share of the pit box's (34 % of it on its
  side, 36 upright): `#pbPageFuel` is a container by its inline size (`pbfuel`), and a page under 145px inside gives the
  name its short form, "Window" (the 10.2" iPad on its side, whose page is 127px inside, had "L18–…" cut off under a name
  over two lines; the name and the laps are 138px across in the long form and 123 in the short), and one under 125px gives
  the window up while the engine calls, whose call says when to stop. The
  10.2" on its side is one of the glance tests' sizes now. **A short, wide pit box** (a wide box in OBS) lays the four tyres
  in a row, and each corner's name is a line of its own over its ring, centred (`hud-page-obs-ipad.spec.mjs`): at a cell's
  top corner, as in the 2x2 layout, the right front's and the left rear's sat side by side between two rings.
- **The maps** (`webgl-helpers.js`, "The maps in the glance layout"): the full circuit's viewBox is fitted to the outline
  with a margin of nine pixels all round (worked out from the scale the circuit is drawn at, so it is pixels whatever the
  circuit and the cell: it was 6 % of the circuit's longer side), the local view takes its cell's shape with the car two-thirds of the way down, and what is drawn in pixels (the
  outline's three layers at 12 / 7 / 1.5px, the sectors at 8px, the car at 7px and the others at 5px) is worked out from
  `--px` on the svg, the units of the map to a pixel. On the local view those are the weights (10 / 6 / 1.2px, the car 7,
  the others 5, the trail 10) when the view is at its middle, and they follow its zoom with his speed from there, as the
  rig's do (The following map's zoom, below). Told by `driveViewChanged` (drive-hud.js), on resize, and on a new
  path; out of drive mode the maps are the HUD's own again. The line itself is drawn by the page from the host's
  points (The outline the page draws, below). The outline is the host's, from his own laps (root
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
  panel in ipad overlay to match header location of other modules and larger fonts on the data"). The header is where
  the datastream's beside it is: the inner card takes `.ds-inner`'s padding (6px 10px) and number size (`max(20px,
  min(6.2cqh, 9cqw))`), and `.inc-label` is at the top on the left, where it sat centred in the middle of the cell, in
  the one header style (One header for every panel, below). **The count** is a custom property, `--inc-count`, the lesser of what the cell's height leaves it (40cqh: under the
  header, over the bar and the two limits) and what its width does (two digits and the x take 1.3 times its size
  across the card, so `72cqw − 18px`, six per cent under what was measured to fit): 83px in an Air's cell on its side
  (it was 70, `min(34cqh, 50cqw)`), 98px in a 12.9-inch Pro's, 85px upright; the x goes with it at four-tenths. A
  session with no limits (a test drive, a practice) has no bar and no limits under it, and the count has their room
  too (66cqh): 153px in a test drive on an Air on its side. `incidents.js` writes the two things the stylesheet sizes
  by: `inc-no-limits` on the panel, and `data-digits` (1 to 4, four for four or more) — three digits (a long test
  drive; a race is DQ'd long before) are sized at `52cqw − 14px` and four at `40cqw − 12px`, so the count is never cut
  off. The penalty and DQ counts are `max(20px, min(14.7cqh, 27cqw))` (25 to 43px; they were `min(9cqh, 14cqw)`), their
  labels 11px or more; the count floats in the room between the header and the thresholds (auto margins), so the
  thresholds are at the foot. Once a limit is hit the number is a word (Penalty, DQ), read at a label's size
  (`max(14px, min(8cqh, 11cqw))`: at the number's size it was wider than the narrowest cell); a value that would not
  fit beside its label goes under it, right-aligned, and the labels never break. Probed in the page's own layout at
  the seven iPad sizes (the count's size at which the card first overflows), the count is within 1 to 6 % of the most
  the card holds: the margin that is left is for the iPad's own font, whose digits may be wider than the headless
  browser's fallback. `tests/unit/incidents-glance.spec.mjs` measures the header against the
  datastream's (offset from the top and the left of its panel within a pixel, size, tracking, colour, weight, case —
  none, family) and the leaderboard's (tracking in em, 0.04, colour), and the numbers against the cell, at the
  seven iPad sizes and the rig's two, in a race, with two digits, with both limits hit, with a DQ limit alone, in a
  test drive and in long ones (three and four digits), with the count and its x inside the card and nothing cropped.
  The glance golden frames were re-made for it.
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
  (`isTestDrive`: iRacing's own words, "Offline Testing", whatever the case and spacing, and nothing looser — the
  overlay also runs for other sims through SimHub, and a word that merely begins "test" in one of theirs, a "Test Day"
  with a full online field, is not iRacing's solo session; `sessionTypeOf` picks the demo's name or the live one, and
  `poll-engine.js` uses it for both the change of session and this, so they cannot read different words).
  `poll-engine.js` writes `body.session-testdrive` from it, only when it changes; a frame that names no type
  leaves it as it was. With the class the panel is not shown — `leaderboard.css` on the rig's HUD and the page OBS
  draws of it, where the other secondary panels take its place at the edge; `drive-view.css` in the glance layout,
  where the grid is laid out again without its cell and the maps are fitted to their cells again
  (`driveViewChanged`) — and `updateLeaderboard` writes no rows while it is away. On its side the hero, the maps and
  the laps panel each gain, and the pit box, the datastream and the incidents share the bottom row; the tacho is in
  the top right corner, where the iPad's menu button is, so its speed and unit stop short of the button
  (`html.rd-remote ... .tacho-speed-cluster`, in a landscape test drive, and upright in every session now that the
  tacho is in the hero's row there: the OBS page has no button). Upright the laps panel and
  the ratings keep the width they have in a race (their numbers are sized from the cell's height, so a strip the
  width of the screen was empty glass) and **the following map takes the rest of their two rows beside them**, nine
  columns by fifteen, with the full map having the row above to itself; the rows keep
  their heights. Any other session brings the leaderboard back the moment the frame says so.
  `tests/unit/test-drive.spec.mjs` holds it on the rig's HUD, the rig's
  Ctrl+Shift+F at 1920x1080 and 2560x1080, the iPad at four sizes (the cells still cover the screen, none over
  another, nothing cut off), the menu's button against every piece of text on the page at six sizes, the upright
  layout at three, and both pages OBS draws, with a return to practice, qualifying and a race; RacingDesk.Tests
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
  (`--rd-shine: 0.15` — the tint, the overhead glow and the sweep and the inset glow all take
  the one factor; the flags' own treatment of the glass does not), the flag's pattern behind and between the panels
  at fifteen hundredths too, under every flag (`body::before` at 0.15; the first cut's renders had the stripes at
  full strength in every gutter, which is the noise he meant), with a thin frame at the very edge of the screen —
  four pixels of the frame round the grid, never a gutter, `body::after` masked to a ring — carrying the flag's own
  pattern at full strength so a white or a chequered flag is still seen (`drive-view.spec.mjs` holds it twice: the
  computed layers, the frame's `mask-composite` being `exclude`, and the pixels of a screenshot under each of the five
  flags — the gutter between the relative and the laps panel under 80 of 255, the edge over 150 — so a frame whose
  mask stopped taking the inside out, in an engine that does not honour it, would be caught); the flag card in the gaps block, race
  control's banner and the panels' flag-coloured borders are as strong as they were, and no badges: the Racing Desk mark and the car's
  maker are not shown, the row they were in is the controls, the pedals and the clock (landscape `ctrl×7 pedals×6
  timer×5` beside the ratings' six — `ctrl×7 pedals×5 timer×5` beside seven under 1100px wide — portrait `ctrl×9 pedals×8
  timer×7`), their WebGL canvases (the chevron drift, the maker's flag) are not
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
  the incidents (`DS.Incident*`); the flags (`currentFlagState`, and iRacing's `SessionFlags` where the host sends it); the danger rings on both maps (`DS.IncidentCoach.*`); the spotter, the
  commentary and race control. **Left out**, and why: the pit menu's controls and their state (`PitBox.PitSv*`, `Has*`,
  `Tire*` requests, `TiresRequested`, `FuelRequested`, and the requested tyre pressures `PitBox.Pressure*`: the rig's pit
  box does not show pressures either, and there is nothing to press on a screen with no touch targets); `Strategy.GripScore`
  and `CanMakeItToEnd` (the strategy engine's own reasoning: what he sees is its call, and the fuel against the laps to
  go in green, amber or red); the pre-formatted copies of numbers shown from their raw values (`DS.*Display`,
  `GapAheadFormatted`, `BBNorm`); `Session.*`, duplicates of `DS.*`; `DS.IRatingFieldSize` and `LicenseString`; the Moza wheel base's connection state (the desk's).
  What is not in the payload at all: a fastest-lap holder, sector times of the other cars, and any pace of theirs beyond
  the last lap.
- **Tests**: `tests/unit/drive-view.spec.mjs` serves the real page through `remote-server.js` at the eight iPad sizes (the
  10.2" on its side too), and holds it to what `tests/glance-measure.mjs` measures — the one measure, shared with
  `hud-page-obs-ipad.spec.mjs`, which holds the page OBS draws to it at ten boxes (a wide strip, a thin one, a square, a
  1080p box, tall columns, a small box, his whole 3440x1440 canvas) with the engine calling as well — and
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
**"Wider at speed" is the map as it was, curve for curve** — the one setting that gives him the view he drove with for
months; **"Fixed" is a third view, not that one** (the old map was never fixed: it widened with speed up to 75 mph).

- **The curve** (`targetRadius(speedMph, mode)`): the view is a radius in the map's own units (the outline is drawn in
  a 0–100 space; on the rig the view is 2r across with the car at its centre, in the glance layout 2r across by its
  cell's shape with the car two-thirds down, as before). The bounds are the two the local view has always had, so
  neither end is new on his rig: `R_CLOSE` 5.6 (the closest: an eleventh of the map across, never a blur of track) and
  `R_WIDE` 50/3 (the widest: a third of the map, never the whole circuit, which the full map beside it is). Between
  them: **closer** is linear in speed from 0 to `SPEED_MAX_MPH`, **120 mph**, clamped beyond (`r = R_WIDE − t·(R_WIDE −
  R_CLOSE)`, `t = clamp(speed/120, 0, 1)`); **wider** is the old curve exactly (`r = R_CLOSE + t·(R_WIDE − R_CLOSE)`,
  `t = clamp(speed/75, 0, 1)`, `WIDER_MAX_MPH`: the line `5.6 + (min(speed, 75)/75)·(50/3 − 5.6)` that this replaced,
  held to it at every speed by a test), with the ease below in place of the old per-frame blend; **fixed** is
  `R_FIXED` 11.15, the middle. A speed that is no number is a standstill; a mode that is none of the three is
  `closer`. Linear in the radius because it is the plain reading of "in relation to that speed change". **Why 120**
  (it was 150 on 2026-10-01; the next day he asked to "zoom in faster on the HUD zoom map"): in his newest recorded
  session (the 963 GTP at Bathurst, the OBS sidecar's speeds) half his moving time was under 87 mph, a quarter over
  119 and a twentieth over 150, so at 150 the view sat at its closest a twentieth of the time and changed by 1.6 times
  between his corners and his straights (the first and third quartiles of his speed). From 120 it is at its closest on
  every straight of every car he drives but the MX-5 (which tops out near it) and changes by about twice between
  corner and straight: 11.9 units at 52 mph, 8.6 at 87, 5.6 from 120. (An even ratio per mph,
  `r = R_WIDE·(R_CLOSE/R_WIDE)^t`, spends its zoom on 0–50 mph, the pit lane and the hairpins, and changes less between
  his corners and straights: 1.8 times.)
- **The ease** (`ease`, `follower`) is on the view's scale, the log of the radius, so a zoom in and a zoom out of the same
  size take the same time (on the radius a zoom out from the closest began with a kick): a first-order ease of time
  constant `TAU_S` **0.2 s** — 63 % of a change in 0.2 s, 95 % in 0.6 s — by the page's own clock (`performance.now()`).
  It was 0.4 s on the radius: braking at 40 mph a second (the first percentile of that session's frames) the view was
  16 mph behind his speed, and is 8 now. His speed is smooth (from one frame to the next it bends by 0.6 mph at the
  99th percentile), so the short ease lets no noise through. What no ease takes out is a speed that changes in a frame —
  a reset to the pits, a tow, a crash into a wall (the sidecar has −728 mph a second), a frame with a bad speed — so the
  scale also changes by no more than `MAX_RATE`, **1.5** (e^1.5, 4.5 times) a second: the whole range, three times,
  takes three-quarters of a second at the least, and a lone bad frame moves the view by 5 % at most. His hardest braking
  in that session (51 mph a second over half a second, resets left out) moves the target at 0.63 in that measure, so the
  cap never holds his driving back (a test drives it frame by frame against the ease with no cap). A frame counts for
  the time since the one before it, `MAX_STEP_S` 0.1 s at most, so one late frame (an iPad's Wi-Fi, a browser source in
  OBS) moves the view by 16 % at most and the rest comes over the next frames, as the car's own position does
  (`_mapSmoothedX`): a step is never a jump, and a stall is not a pop. The first frame sets it outright, and so does a
  frame after `RESTART_AFTER_S`, two seconds, with none (the page was in the background, or he was out of the car: the
  radius it held is from a speed long ago, and getting back in is not a zoom from there). A change of the setting eases
  to the new view too. `webgl-helpers.js` keeps one `follower` and asks it each frame with the speed,
  `_settings.followMapZoom` and the clock; the view's box, its pivot and the car's dot are written to a thousandth of a
  unit, not a tenth: at the closest the view is 11 units across and scrolls fastest at speed, where steps of a tenth
  were jerks of two or three pixels (and the dot and the box's centre each rounded on their own and shimmered).
- **The zoom is seen in what is drawn, on every overlay** (he said on 2026-10-02: "the iPad zoom map … doesn't zoom at
  all"). The rig's HUD draws the road's three lines, the trail, the car and the others in the map's own units (2.5,
  1.5, 0.3; the car 2), so they grow as the view closes in. The glance layout (the iPad, `/obs-ipad`, Ctrl+Shift+F)
  drew them in pixels (`--px`, 10 / 6 / 1.2 px, the car 7, the others 5) and sized them again whenever the zoom moved
  by 3 %, which took the zoom back out of everything but the bends: on a straight the view at 150 mph looked like the
  view at rest (in a headless render of the iPad page, the road was 9.9 px at rest and 10.2 at 120 mph). Now `--px`
  on the local view is the units to a pixel when the view is `R_LINE_WEIGHTS` across (the middle, `R_FIXED`), set when
  the cell changes and not when the zoom does: those are the pixel weights at the middle view, two-thirds of them at
  the widest and twice them at the closest (the road 6.7, 10 and 20 px), as the rig's do. The full circuit, which does
  not zoom, keeps its weights in pixels.
- **Where the setting goes**: `config.js` `_defaultSettings` has `closer`; the desk's Settings → Look offers the three;
  the pages OBS draws get it through the display allowlist (`remote-server.js` `DISPLAY_SETTINGS`), and the iPad
  through `IPAD_SETTINGS`, which now lets each key through only as the kind of value it is (a number for the panel
  background, one of the three words for this). **A settings file from before the setting is given `closer` once**
  (`migrate`, `migrateFile` through `settings-file.js`; `main.js` `migrateFollowMapZoom`, at start, before anything
  reads the file; a value that is none of the three is put to `closer`; a file that cannot be read is left as it is).
- **Tests**: `tests/unit/map-zoom.spec.mjs` — the curve in Node (the bounds, each direction, the old curve exactly,
  fixed, proportion, clamping, his own speeds, the ease on the scale and its time constant, the cap, his hardest braking
  not held back by it, the follower, one late frame, a page back from the background, noise), the migration (the
  function, the file, a first run, an unreadable file, main.js's call), and the pages: the rig's HUD up and down a speed
  ramp in each mode and with the setting changed in place, its glance layout, the iPad told the setting by its server
  (and a change within its ask) and down and up a ramp in `closer`, `/obs` through the allowlist and `/obs-ipad` — the
  settled view at each speed, every move within what the cap allows for the time it had (no jumps), the car at the
  middle of its view to a thousandth of a unit, and the road and the car drawn three times as big at the closest view
  as at the widest, on the rig's HUD and in the glance layout (where they are also their pixel weights times
  `R_LINE_WEIGHTS` over the view's radius). `drive-view.spec.mjs` holds the car's dot to the same rule.
  `desk-settings-model.spec.mjs` holds the control; `remote-server.spec.mjs` the allowlists. The glance layout's two
  golden frames were re-made for it (and for the incidents panel) on 2026-10-01, and again on 2026-10-02: at their
  127 mph the view is at its closest, and its road and car are drawn twice their old weights. The rig's in-car frame is
  unchanged: its fixture has no track map (`TrackMap.Ready` 0), so the local view draws nothing there.

## The outline the page draws (`webgl-helpers.js`, "The outline as the page draws it")

The host sends the outline as an SVG path, `RacingDesk.Plugin.TrackMap.SvgPath` (`TrackMapProvider.BuildSvgPath`): a
Catmull-Rom spline through its points — one to a bin of the lap, about every 5 m — as cubic Béziers, `M x,y C x1,y1 x2,y2
x,y … Z`. **The page reads the points the line passes through** (`_readOutline`: the end of each `C`, never its control
points; `L` and bare pairs after `M` too) **and draws the spline through them itself** (`_outlineOf`), to a thousandth of
a unit, on both maps' `<path>` sources; and **everything else it does with the outline goes by points on that line**
(`_trackPathCoords`: the spline at each point and a third and two-thirds of the way to the next — as many as the pairs
the page used to take from the host's path, so the trail's length, the teleport rule and the sectors, which count in
them, are as they were): where the car is on it (`_nearestTrackPoint` puts the car on the nearest segment, so it slides
along the line and does not hop from point to point), the trail (to the point at or behind the car and then the car,
to a thousandth), the full map's fit, the sectors (`_sectorPaths`), the start/finish tick and the glow. A path the page
cannot read (no `M` first, a command it does not know) is drawn as it came, its pairs of numbers taken as before, and
the self-check says that nothing rendered.

**Why** (he said on 2026-10-02: "the iPad zoom map seems to be very squiggly"): the host wrote every number to a tenth of a
unit, which at Le Mans (13.5 km, 90 units across, 60 m to a unit) is 6 m — more than the 5 m between its points — and
at Bathurst 2.4 m. The page took every pair of numbers in the path as a point of the line, control points included,
and put the car and its trail on the nearest of them. At the iPad's following map, 30 px to a unit at its closest
view, the line drawn from his own outlines (read from his store, built as the host builds them) turned by 40 to 90
degrees from one bit of it to the next (a median of 45 at Le Mans, 18 at Bathurst, where the outline turns by 0.1 to
0.3) and strayed from his real line by 1 to 2 px, its curves met at kinks (a control point rounded onto its end point),
and the car and the trail stepped from one rounded point to the next. On the rig's small cell the same was under a
pixel. **The host now writes two decimals** (root CLAUDE.md, Track maps): the line is within 0.2 px of the true one at
the iPad's closest view. **A plugin from before that still sends one**, so where a path's rounding is a fifth of the
spacing between its points or more (`_OUTLINE_COARSE`), the page smooths the points first: three passes of 1-2-1
(`_OUTLINE_SMOOTH_PASSES`), about a point and a quarter either way, 6 m at the host's 5 m bins. On his own outlines
that leaves the line within 1.5 px of the true one at the iPad's closest view and turning by a degree or so between
samples; a hairpin of 15 m radius is pulled in by about a metre where the points are 5 m apart (the shorter circuits'
points are closer and the pull less), under a pixel there. What one decimal threw away it cannot give back, so
on a long shallow straight at Le Mans a faint long wave is left until the plugin is installed again. A path rounded
finely enough for its spacing (the host's two decimals, the demo's sparse circuit, the tests' synthetic one) is drawn
through its own points untouched.

- **Tests**: `tests/unit/map-outline.spec.mjs` — a made-up circuit as long as Le Mans (the shape of `tests/frames.mjs`,
  nobody's), a point every 5 m, sent as the host sends it at one decimal and at two to the real iPad page served
  through `remote-server.js`'s handler, at the closest view: the one-decimal path itself wiggles by 2.1 px and its
  curves meet at 90° kinks (so the test can fail: against the page before this, it did, at 2.1 px); what the page draws
  from either wiggles by under half a pixel (a point from the middle of its neighbours), its curves meet within 6°, and
  it is within 1.5 px of the circuit (0.4 at two decimals); the car's dot is within 0.6 px of the line while it drives
  and the trail on it and ending at the car; the rig's HUD draws the same line from the same path; a path that is not
  one is drawn as it came and said to render nothing. RacingDesk.Tests `TrackMapProviderTests` holds the host's two
  decimals.

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
- **What each says and looks like**: the gaps block (the rig's and the glance layout's) says "Local yellow" / "Local yellow —
  slow in this sector", "Caution" / "Full course caution — hold position", "1 lap to green" / "Green flag next lap — be ready"
  (under a caution only), "Green held", "Black flag warning" / "Warning — a black flag may follow", "Disqualified" (in
  sentence case since 2026-10-02: Words, not capitals); the
  glance layout's background is per state (`drive-view.css`, `body[data-flag]`) and the rig's gaps block has a
  `.flag-<state>` class for each (`dashboard.css`, where `.flag-label` is centred and balanced, since the longer labels
  wrap to two lines in the rig's 272px block; `webgl.js` has the WebGL colours).
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
allowlist like `/obs`, so his rig's display switches apply to it, where the iPad is told none of
them: the page runs on the rig, next to the sim). The iPad's server
answers `/api/settings-display` too, with the panel background and the following map's zoom and no more (`IPAD_SETTINGS`), behind the key. It is started
with retries (`startWithRetry`) until it is up. `tests/unit/remote-server.spec.mjs`, `tests/unit/hud-page-obs.spec.mjs`
and `tests/unit/hud-page-obs-ipad.spec.mjs` (the real pages through the listener, headless).

The Recording card also holds, under the "HUD drawn by OBS" switch, the choice of what OBS draws (`obsHudView`: Rig HUD
or iPad dashboard, a sentence each) and the "Panel background in OBS" slider (`obsPanelBackground`), both keys of the
settings file saved like the switches (`recording-model.js` `HUD_VIEW`, `OBS_PANEL_BACKGROUND`).

## Settings → Cars: putting each car's seat height and brakes back

The card under the Recording card (`#settings-restore`; root CLAUDE.md, Per car, for the rig). Its model is
`modules/desk/restore-model.js` (pure); `desk.js` does the DOM and asks `window.racingDesk.restore` (preload →
`restore:read` / `restore:command` in main.js → `modules/js/restore-api.js` → the host). Two rows, "Brakes put back for each
car" and "Seat height put back for each car", each a switch (on by default; the host keeps it) and the host's sentence for
how it stands — working, waiting for something (said), or turned itself off (and why); and one "Undo what Racing Desk
changed", which asks first and says under it what it did. No trial, no first run, nothing on the HUD and no line on the Desk
page. The Cars page shows the host's sentence for a car on its Pedals panel (the brakes that go on) and on its View panel
only where he needs to know something (no camera file, and how to save one) (`apps/paints/src/useRig.ts` reads it beside
the rest; the page only reads). Tests: `tests/unit/desk-restore-model.spec.mjs`, `tests/unit/restore-api.spec.mjs`,
`tests/desk/restore.spec.mjs`, and "putting the cars back" in `tests/desk/desk.spec.mjs`.

## Panel background

How solid the panels' own background is — the base fill and the glass, nothing else — is a slider, 0 to 100, and there
are two: "Panel background" in Settings → Look (`panelBackground`, `settings-model.js`) for the rig's HUD and the iPad
view, and "Panel background in OBS" on the Recording card (`obsPanelBackground`) for the pages OBS draws, whichever of
the two, so a recording can be clearer or more see-through than what he drives with. `settings.js`
(`applyPanelBackground`, from `applySettings`) reads the one the page goes by (`window._obsMode` reads the OBS one),
writes it to `:root` as `--panel-alpha` and marks `body.panels-thin` under 90. `base.css` makes `--bg`, `--bg-panel`
and `--bg-logo` from it (the secondary panels' own fills in `leaderboard.css`, `datastream.css` and `pitbox.css` read
it too), scales the glass by `--panel-glass` — down with it, never up: the glance layout's tints, inset glow and overhead glow, and its opaque base under a flag — and under 90 lays a soft
`text-shadow` on the panels (it inherits to every word in them; an effect with a shadow of its own keeps it) whose
alpha is `--panel-shadow`, 0 at 90 and 1 at nought, and whose colour is `--panel-shadow-rgb`: black under the dark theme,
white under the light one (dark text, so a pale halo and not a smear). **The spotter's card and race control's banner are
not panels**: their fills are their own and solid, so they keep `--panel-glass` at 1 and `--panel-shadow` at 0, whatever the slider says. **90 is the panels as they have always been**, on every surface: the
rig's nine-tenths, the iPad's the same, the glance layout's opaque base under a flag opaque at 90 and above, so the
defaults change nothing and the golden frames are as they were. The rig's page is told by the desk's settings path, the
iPad by its server's `/api/settings-display` (the panel background and the following map's zoom, asked again every ten seconds), the OBS pages
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
