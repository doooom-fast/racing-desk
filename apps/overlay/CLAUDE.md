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

## 53 modules in `modules/js/`

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
| `hud-display.js` | **Which screen the HUD's window is on** — the one he chose, else the one the sim's window is on (asked of the host), else the one iRacing's ini says it runs at, else the largest; not the primary. Pure rule + a keeper that moves the window (never shows it). Root CLAUDE.md, Desk |
| `car-controls.js` | What the controls panel shows of the car's ABS / TC / brake bias / other dials / DRS / push-to-pass, from the host's `RacingDesk.Plugin.CarControls` (see The controls panel) |
| `lap-delta.js` | The gap to his best lap of the session and to the optimal lap, worked out from his own laps, and how a delta is written and labelled (see The delta) |
| `laps-panel.js` | The glance layout's laps panel: the times, the sectors, the three gaps and the fuel to the flag (see The glance layout) |
| `gap-trend.js` | Whether the cars ahead and behind are closing or dropping away, lap on lap: the ▼ or ▲ beside their iRating in the gaps block of the glance layout (see The glance layout) |

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
  inline background, which a stylesheet cannot get under); gone when the flag clears. A blue flag rings the screen and
  leaves the panels as they are. `currentFlagState` is all the
  payload says: a local yellow and a full-course caution are both `yellow`, and there is no "one to go" in it (the plugin
  would have to send iRacing's `SessionFlags` bits for either).
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
  its heading and third row of times, then the sectors' gaps, then its second row; the datastream its yaw trace, then the
  wheel's torque, then the peak g; the pit box its two services (below 262px), its pit window when a strategy call has
  taken the room (below 225px); the pedals the clutch's channel (below 250px); the rating panel its bar. The test
  holds every piece of text in every cell to the box its ancestors let show (an ellipsis, an overflow, the cell), at the
  seven iPad sizes and at the rig's own 1920x1080 and 2560x1080. The HUD's zoom setting is the rig screen's and is undone
  here.
- **The hero**: in a race the place, big; out of one (`body.session-nonrace`, which `poll-engine.js` sets from
  `DS.SessionMode`, written only when it changes) the place is a rank of best laps and the big number is the delta.
- **The laps panel** (`#lapsPanel`, `modules/js/laps-panel.js`; shown only in the glance layout): the lap of how many, his
  last, best and optimal laps (the optimal the plugin's `DS.SectorBests` added up), each sector's time and its gap to his
  best of it in the gaps block's colours, his gaps to his best of the session, the optimal lap and his best ever, and the
  laps of fuel against the laps to go to the flag (in a race to time, the time left over his last lap), green with a lap
  to spare, amber just, red short. What is left to go is a span of its own that a narrow panel leaves out: the clock has it.
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
  path; out of drive mode the maps are the HUD's own again.
- **The leaderboard** is the HUD's panel and rows, its type sized from the panel (`#lbRows` font-size) and the rows sharing
  its height; `leaderboard.js` counts how many the panel holds at that size (1.9 lines to a row) and not the sum of the
  screen minus the dashboard that the rig's HUD does.
- **The menu** (remote-server.js) is laid over the Racing Desk mark: the whole square answers a tap and its list opens on
  the side with the more room. On the rig there is no menu, and the mark is just the mark.
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
  the incidents (`DS.Incident*`); the flags (`currentFlagState`); the danger rings on both maps (`DS.IncidentCoach.*`); the ambient colour (`DS.Ambient*`); the spotter, the
  commentary and race control. **Left out**, and why: the pit menu's controls and their state (`PitBox.PitSv*`, `Has*`,
  `Tire*` requests, `TiresRequested`, `FuelRequested`, and the requested tyre pressures `PitBox.Pressure*`: the rig's pit
  box does not show pressures either, and there is nothing to press on a screen with no touch targets); `Strategy.GripScore`
  and `CanMakeItToEnd` (the strategy engine's own reasoning: what he sees is its call, and the fuel against the laps to
  go in green, amber or red); the pre-formatted copies of numbers shown from their raw values (`DS.*Display`,
  `GapAheadFormatted`, `BBNorm`); `Session.*`, duplicates of `DS.*`; `DS.IRatingFieldSize` and `LicenseString`; the Moza wheel base's connection state (the desk's).
  What is not in the payload at all: a fastest-lap holder, sector times of the other cars, and any pace of theirs beyond
  the last lap.
- **Tests**: `tests/unit/drive-view.spec.mjs` serves the real page through `remote-server.js` at the seven iPad sizes and
  the rig's own two screens, in a race, at P12 and P21, with a prototype's dials, a formula car's DRS, under a yellow flag,
  with the strategist calling, and out of a race, and holds it to: every panel a cell, inside the screen, none on another,
  the cells the screen, nothing cut off by its cell or out of sight (every line of text against the box its ancestors show),
  no label under 11px and no number under 20px, the HUD's own type, colours and glass (compared with the HUD's page, item
  by item); the flags as the background and gone when cleared; race control's whole sentence for each flag at every size;
  the banner gone when another flag replaces its own; the panels and the badge opaque under every flag; the spotter over
  the datastream and not the circuit; the clock's key; the strategy calls; the laps panel's numbers; the gaps' trends;
  the pit box inside its cell at 1920x1080 and 2560x1080 on the rig; every panel shown whatever the settings hide, and the
  settings back after; the menu the one touch target. `tests/unit/gap-trend.spec.mjs` runs the trend in Node. Golden
  frames of the glance layout at 1180x820 and 820x1180 are in `tests/golden/glance.spec.mjs`.

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
| `Ctrl+Shift+G` | Toggle green-screen mode |
| `Ctrl+Shift+R` | Put the HUD's window back over the whole screen it belongs on (`hud-display.js`: not the primary one unless that is where the rule puts it) |
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
