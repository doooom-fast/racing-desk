# racing-desk

The Racing Desk, by DOOOOM, for one driver on one rig: a transparent HUD, a desk and a livery manager over live
iRacing telemetry, with no account, no cloud and no distribution. This machine *is* the rig — iRacing, SimHub and
the full `.ibt` history are local, so verify against real data rather than assuming.

It was Pro Drive (RaceCor, K10 Motorsports) until 2026-09-27, when everything took the new name: `RacingDesk.*`
projects and namespaces, the SimHub plugin (`RacingDesk.dll`, publishing `RacingDesk.Plugin.*`), the
`:8889/racing-desk/` route, the store at `%LOCALAPPDATA%\Racing Desk` and the settings at `%APPDATA%\Racing Desk`.
The app and the host move the old folders across on first run (`RacingDesk.Data/DataFolder.cs`, `main.js`). The
SimHub plugin must be reinstalled after the rename (`apps/plugin/scripts/windows/install.bat`, which stops
SimHub, builds, removes the old DLL and copies the new one in, and restarts SimHub only if it was running —
**ask before running it**); until then SimHub's copy publishes the old property
names and the HUD reads nothing from it. The plan docs in `docs/` were written under the old name and say so. The
repo's home is `DOOOOM/racing-desk`.

**The plan:** [`docs/local-first-refactor-plan.md`](docs/local-first-refactor-plan.md) (phases in §8).
**What the rig actually looks like:** [`docs/local-first-phase0-findings.md`](docs/local-first-phase0-findings.md).

## Layout

| Path | What | Instructions |
|---|---|---|
| `apps/overlay/` | Electron app: the HUD (`dashboard.html`) and the desk window (`desk.html`), both consumers of `localhost:8889` | [`apps/overlay/CLAUDE.md`](apps/overlay/CLAUDE.md) |
| `apps/core/RacingDesk.Core/` | The engine, runtime and `:8889` / `:8890` servers, host-agnostic (`net48` + `net8.0-windows`). `IRacing/` reads the SDK or `.ibt` directly | — |
| `apps/core/RacingDesk.Data/` | Local SQLite store (`%LOCALAPPDATA%\RacingDesk\racing-desk.db`), session capture, `.ibt` backfill, track outlines from Lat/Lon (`net8`, host only) | — |
| `apps/host/RacingDesk.Host/` | Standalone host: live iRacing or `.ibt` replay → same `:8889` contract, records sessions | — |
| `apps/plugin/` | SimHub plugin — now a thin adapter over RacingDesk.Core (SimHub dashes, actions, events). `racing-desk.sln` at the root builds all .NET projects | [`apps/plugin/CLAUDE.md`](apps/plugin/CLAUDE.md) |
| `packages/calc/` | Calc engines ported from prodrive-server (verbatim, with their tests) plus the local model that turns stored sessions into their inputs; bundled into the desk | — |
| `apps/edit/` | Node CLI for `.rcpdv` bundle editing | [`apps/edit/CLAUDE.md`](apps/edit/CLAUDE.md) |
| `apps/livery/` | Python CLI: livery spec (YAML, car space) → the TGA paint + spec map iRacing loads, self-checked, installed into `Documents\iRacing\paint` | [`apps/livery/docs/DESIGN.md`](apps/livery/docs/DESIGN.md), skill `livery-pipeline` |
| `docs/` | Cross-app context; `docs/archive/` is superseded | [`docs/README.md`](docs/README.md) |
| `.claude/skills/` | Project skills (overlay, plugin, racing domain, bundle format) | — |

Imported 2026-09-16 from `prodrive-overlay`, `prodrive-plugin`, `prodrive-edit` and `prodrive-agents`
with history (subtree merges). Those repos, plus `prodrive-server` and `prodrive-windows`, still exist
and are archived in Phase 6 — nothing is deleted before its replacement works.

## .NET

```bash
npm run test:dotnet                 # dotnet test racing-desk.sln (5 WsTelemetryPublisher failures are pre-existing)
npm run host                        # live iRacing → :8889/:8890, records sessions, backfills new .ibt
npm run host -- --ibt <file> --http-port 18889 --ws-port 18890   # replay an .ibt beside SimHub
npm run ingest                      # backfill racing-desk.db from Documents\iRacing\telemetry
npm run sessions -- --type Race     # read back stored sessions (--laps <id> for laps)
npm run parity -- --seconds 120     # live session: diff SimHub's :8889 with the host's :18889
npm run host -- sql "SELECT ..."    # read-only query against the store, JSON out
npm run host -- cars                # the cars the store can name: name, folder, sessions driven, sessions seen in
npm run host -- cars --scan         # first read the names out of the .ibt files ingested before the store kept them
                                    # (headers only, seconds; waits for the sim to close unless --now)
npm run host -- schedule --fetch    # download the season PDF if it changed, parse it, store it
npm run host -- schedule            # parse the stored PDF and report what the parser found
npm run host -- schedule --series "Caterham"   # what one series parsed to, week by week
```

The host also serves the store read-only at
`:8889/racing-desk/data/{status,sessions,session?id=,schedule,cars,views,pedals}` — that's what the desk reads. If
SimHub's plugin holds `:8889`, the app runs its host on `:18889`/`:18890` instead (see Desk). One thing is written
through it: `POST /racing-desk/data/pedals` (`{ car_path, profile_id | null }`), for programs on this machine only —
a request that names an `Origin`, or comes from another machine, gets 403, so the desk page sends it through main.js.

Car names (`cars`, schema v4) come from the session YAML of the driver's own sessions, which lists every entrant's
`CarPath` and `CarScreenName` — nothing of iRacing's is bundled, so a car that has never been in one of those sessions
has no name. The host reads them on ingest and live capture, and once, in the background, from the headers of the
files it has not read yet (`car_scans`: the file's path, length and mtime when it was read) — a file cut short or gone
is marked read all the same, one that could not be reached (held by another program, its folder not there) is tried
again at the next start, and a header pass that fails does not stop the ingest after it. `seen` is the number of
sessions a car was entered in (`session_cars`), `driven` those the driver drove it in — sessions, not rows: a session
driven live and then read from its `.ibt`, or written to several files, is one (`subsession_id:session_num`, as
`packages/calc` merges them).

Schema changes add tables and leave the old ones as they were (v5 took `cars_scanned` back out of `ingested_files`),
so an earlier build can still record and ingest into a store a later one has opened.

**Per car, for the rig** (schema v5; plan in `docs/view-and-pedals-plan.md`). Nothing here writes to iRacing's files
or to the pedals.
- `car_views` — the view a car was driven with. iRacing keeps one height and horizon for every car (`[View]` in
  `Documents\iRacing\app.ini`, read at sim start, written at exit), so `CarViewRecorder` reads the file while the sim
  is up and again once it has gone: what changed is what the driver changed in that car (`chosen`). A chosen view is
  never replaced by one that was only inherited from the car before. The seat is the cockpit camera's offset in the
  car's own `cameras\cars\<car>\car.cam` (`CarCamFile`, versions 14 and 15).
- `car_pedals` — which of Heusinkveld SmartControl's profiles a car is driven with, and that profile byte for byte as
  it was when the car was given it (each device's section carries a hash, so a profile is never rebuilt from its
  numbers). `RacingDesk.Data/Pedals/SmartControl.cs` reads `C:\ProgramData\Heusinkveld\Database\Heusinkveld.db`
  read-only: the profiles, and SmartControl Live's keys.

## Season schedule

The only thing The Racing Desk fetches. iRacing publishes a ~200-page PDF per season; `RacingDesk.Data/Schedule` reads it
with PdfPig (laid out as fixed-pitch text, like `pdftotext -layout`), parses every series and week, and stores it
(schema v3). The live host refreshes it once a day, never while the sim is running.

- The PDF is **not linked from iracing.com's season page HTML** — it's posted on iRacing's forum file host. The URL
  is `settings.json`'s `scheduleUrl` (`--url` overrides it). When a season's URL changes, set it there, or just
  drop the PDF into `%LOCALAPPDATA%\RacingDesk\schedule\` — the newest PDF in that folder is used.
- The parse checks itself against the PDF's own contents pages: every series listed has to come out of the body
  (2026 S4: 151 of 151, 1,989 series-weeks, all with a race length).
- Track and car names come out as iRacing writes them in the PDF, which is not always how it writes them in
  telemetry; the engines fuzzy-match (`packages/calc/src/engines/fuzzy-match.ts`).

## Desk

```bash
npm run build                       # THE APP: apps/overlay/dist/win-unpacked/Racing Desk.exe (calc bundle + host + overlay)
npm run build:host                  # just RacingDesk.Host → apps/host/publish (dev: once, then npm start below)
# electron-builder here: npmRebuild is off (its "install production dependencies" step would prune the workspace's
# shared node_modules of every dev package, itself included), and its winCodeSign tools archive can't be unpacked
# by it on this machine (macOS symlinks inside need a privilege Windows doesn't grant by default) — if the cache
# is ever cleared, unpack the .7z it downloads into %LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0
# with 7za and `-xr!darwin`, then build again.
npm start -w racing-desk-overlay        # overlay from source: HUD + desk, starts the host too (--no-desk skips the desk,
                                    # Ctrl+Shift+O reopens it; --desk-host=http://localhost:18889 uses a host you ran by hand)
npm test -w @racing-desk/calc          # engines + local model (vitest)
npm run test:desk                   # desk.html over a mock host, headless, off-machine requests blocked
```

Build once with `npm run build`, then the app is `apps/overlay/dist/win-unpacked/Racing Desk.exe` — the Start menu and
Desktop "Racing Desk" shortcuts point there; "shipping" is `git pull && npm run build`. It starts its own RacingDesk.Host
(`modules/js/host-launcher.js`): beside SimHub on `:18889`/`:18890` with `--no-hardware` while SimHub holds `:8889`,
on `:8889`/`:8890` otherwise, or it uses a host already running; the host's output goes to `%LOCALAPPDATA%\Racing Desk\host.log`.
There is no console window. **Closing the desk window quits the app** (minimise it to keep the HUD while racing) — the
HUD's window is hidden and Windows 11 tucks the tray icon behind its overflow arrow, so an app that outlived its window
would run with nothing on screen. The tray menu (Open desk / Cars / Paints / Settings, HUD on/off, Quit) and Ctrl+Shift+Q quit too. The host is
spawned detached — Node otherwise puts it in a job object Windows kills with the app, mid-write — and stops itself,
flushing what it was recording, when the app goes (`--parent-pid`). One instance: double-clicking the shortcut again
opens the desk in the running app.

The desk window has four pages — **Desk**, **Cars**, **Paints** and **Settings** — switched from the masthead nav, the
tray menu, `?page=` or the `#settings` hash (`modules/desk/desk.js` `showPage`). Settings edits the HUD's `%APPDATA%\Racing Desk\overlay-settings.json` through the preload bridge
(`modules/desk/settings-model.js` lists the keys) and each change applies live: `save-settings` writes the file whole
and sends `settings-sync` to the HUD window. The old WinUI settings app is no longer the way to change the HUD.

**The HUD on an iPad** (`remote-server.js`; the "iPad" card at the foot of the Settings page). Off unless the driver
switches it on; then the main process listens on the home network (port 9090) and serves `dashboard.html` to a
browser, which shows the drive view (`#driveHud`, `modules/js/drive-hud.js`). It sends the numbers the HUD reads,
never a picture of the game. The rules it is built on, each with tests in `tests/unit/remote-server.spec.mjs`:
- **Read-only from the network.** GET and HEAD only. `/racing-desk/` is proxied to the telemetry the HUD itself
  reads (`localhost:8889`, or a saved `simhubUrl` that ends in `/racing-desk/`) and a request carrying a query is
  refused — the plugin and host take `?action=…` on that same path, wheel-base settings among them, and none of it
  can be reached through here. Files are served from `modules/`, `images/` and `fonts/` only.
- **A key in the address.** `http://<rig>:9090/?k=<8 characters>`; the page hands it back as a cookie. Made the
  first time the server starts and kept in `overlay-settings.json` (`remoteServerKey`, with `remoteServer` and
  `remoteServerPort`). Those three are the main process's own: `save-settings` keeps what is on disk for them
  whatever a page sends, and no window is given the key (`get-settings` and `settings-sync` leave it out). "New
  key" on the card cuts off every address handed out before.
- **The request has to name the rig** — localhost, one of its addresses, or its hostname — which is what stops a
  site from pointing a name of its own at the rig and reading through a browser at home.
- **The actions (`/api/action/<name>`) are for a program on the rig** that says it is one with the header
  `X-Racing-Desk: 1` (the Stream Deck plugin does). A browser cannot put that header on a link, an image or a
  form, and anything carrying a browser's own headers is refused too: otherwise any page open on the rig could
  quit the app.
- **The page waits for nothing from the internet**: the Typekit stylesheet is taken out of what is served, because
  a stylesheet that cannot be fetched holds the whole page back.
- **What the page is told, not what it works out**: `window._remoteMode` and `window._simhubUrlOverride` are set
  before any of the HUD's scripts run, and `settings.js` leaves the address alone in remote mode. (It used to reset
  it, which had the iPad asking itself for telemetry.) In remote mode there is no voice coach, no WebGL effects and
  no ambient light, and a strip says "No data from the rig" when the numbers stop arriving.

Tests listen on 127.0.0.1 only. A listener on the network makes Windows ask about the firewall, in a window, over
whatever the driver is doing — so nothing but the driver's own switch ever starts one. The code on the card is
`modules/js/qr-code.js` (version 3-M, 42 bytes at most); `tests/unit/qr-code.spec.mjs` reads it back by the
standard's rules, since no reader is on hand. A page cannot keep an iPad awake over plain http, so the card says to
set Auto-Lock to Never.

**Cars** is what the host remembers per car, for the cars the driver has driven (`driven > 0` in
`/racing-desk/data/cars`), the one driven last first — worked out from the session rows the desk already has. Two
things. The **view** each was last driven with: driver height, horizon, head horizon, FOV and the seat's three
offsets, from `GET /racing-desk/data/views`; the page says whether a car's view is its own or inherited from the car
driven before it, and a car with none yet says so plainly, which is how every car starts. And its **pedals**: which
SmartControl profile it is driven with, chosen from a select, with that profile's brake in a line beside it and
SmartControl Live's keys at the foot of the page (`GET /racing-desk/data/pedals`). Nothing on the page changes
iRacing or the pedals. The three routes are read each time the page is shown and on Refresh, not at desk start
(`loadCars`); a host from before the page answers 404 for `views` and `pedals`, and the page lists the cars and says
the host is older. The one write goes through main, because the host refuses a request that names an origin:
`window.racingDesk.rig.bindPedals(carPath, profileId)` → `rig:bindPedals` (the desk window only) →
`modules/js/rig-api.js`, which POSTs from Node with a 3 s limit, only to a host on this machine, and answers
`{ ok: true, car }` or `{ ok: false, error }`, never a rejection. Seat offsets are signed millimetres and the page
does not say which way is forward — that has not been verified. `id="cars"` is still the Desk page's Car affinity
card; the page's own elements are `cars-page`, `cars-list` and so on, and the nav switches pages itself rather than
following `#cars`, which would scroll the desk to that card.

**Paints** is the livery manager (was doooom-paints): a library of paint versions outside the sim's folders, applied
by copying files in under the customer id, backing up what was there, deleting the stale `.mip` files and warning
when Trading Paints would undo it. One UI source, `apps/paints/src` (React), bundled for the desk by
`apps/paints/build-island.mjs` into `modules/desk/paints.bundle.js` + `.css` (generated, like the calc bundle) and
mounted the first time the page is shown. Its calls go through `apps/paints/src/bridge.ts` to
`window.racingDesk.paints` → `paints:invoke` → `modules/js/paints-ipc.js` (the allow-list and argument mapping) →
`modules/js/paints/` (the file operations, ported from the Rust in `apps/paints/src-tauri`). Backups live under
`%LOCALAPPDATA%\Racing Desk\paints\backups`; what it remembers is the `paints` key of `overlay-settings.json`. The
Tauri shell in `apps/paints` still builds from the same source and goes once the page has proved itself. Use made-up
customer ids in fixtures.

Applying is one click — there is no dialog. The three options (spec map, read-only afterwards, other drivers' cooked
files) are set once under "When a livery is applied" and remembered; an apply that is refused says why where the
click was, and offers to go on regardless only when something stands in every apply's way (the sim running, the
downloader). **Groups** (`modules/js/paints/groups.js`; commands `liveryGroups`, `saveGroup`, `deleteGroup`,
`setGroup`) are one name for a livery across cars: a version id more than one car has in the library is a group by
itself, and the driver's own — a name and a version per car — are kept under `paints.liveryGroups`. Setting one
applies each car's version through `apply.js`, skips a car already wearing it, and carries on past a car that
fails. A car never driven has no paint folder: an apply makes it under the install's name for the car
(`installPath` in the catalogue), and only `index.js` decides that it may.

The page lists every car the rig knows, by the sim's name for it — cars with a livery first, then the rest, with a
filter over both — and a car with no livery still shows what is installed for it and its backups. The list is the
`carCatalogue` command (`modules/js/paints/catalogue.js`; the desk's own — the Rust has none, so the Tauri shell lists
the library by folder name): the library's cars, the cars in the iRacing install and the folders of the paint
directory that are cars, merged on the sim's car path. That path is the car's folder under `<install>\cars` with the
folders joined by spaces — `cars\mx5\mx52016` is `mx5 mx52016`, and they go three deep (`dirtsprint winged 410`) — and
is also the name of its paint folder and the store's `car_path`; `-`, `_` and case fold away, so the library's
`mx5-mx52016` is the same car.
- **A car in the install** is a folder holding a `.dat` (that it is there is all that is read). 29 folders on this rig
  hold one *and* have cars beneath them — `mx5\mx5.dat` beside `mx5\mx52016`, `fordgt` beside `fordgt\gt3`. Some are
  cars themselves (`fordgt`), some only what their cars are built on (`mx5`), and the disk doesn't say which, so one
  is listed only when the store has a name for it, the paint directory a folder, or the library a livery. Nothing
  under `cars\safety` is listed: the 7 pace cars, which the store never names.
- **A car in the paint directory** is a folder the install has, or one holding `car_*.tga` / `car_*.mip` itself — and
  never `helmets`, `suits` or `cars`, where Trading Paints leaves `car_spec_*.mip` files too, nor the folder the
  library is in, whatever is lying at the top of a checkout.
- **Names** come from the local store through the host, `GET /racing-desk/data/cars` →
  `[{ car_path, name, short_name, car_id, driven, seen }]` (`modules/js/paints/car-names.js`: 3 s, a good answer kept
  for a minute, an empty list on any failure, one request however many callers are waiting). A car that has never
  been in one of the driver's sessions has no name and is listed by its folder.
- **The install** is found from `HKCU\Software\Classes\iracing\shell\open\command`, which the iRacing UI rewrites
  every time it starts — the install is two folders above that exe — then the usual Steam and default paths; it must
  be a whole path and hold a `cars` folder, and `reg` gets 3 s to answer. `paints.installDir` in
  `overlay-settings.json` names another by hand, and the page's saves keep it.

`modules/desk/calc.bundle.js` is generated from `packages/calc` on overlay start and by the desk tests — don't edit
or commit it. Rating changes aren't in telemetry: a race's iRating/SR change is read from the driver's next
session in the same licence category. Next-race suggestions are limited to the disciplines the driver actually
races (3+ races in the last year) and to what their licence can enter. Each suggestion has **Open in iRacing**: an
`iracing://web/racing/official/...` link the logged-in iRacing UI accepts (it starts the UI if needed) — the whole of
what a local app can do about joining, see `docs/race-join-findings.md`. The PDF carries no iRacing ids, so the
button lands on the Official page until the driver pastes that series' page link once (the row's "link…"); ids are
kept in `overlay-settings.json` under `raceLinks`.

The SimHub plugin build stages into `apps/plugin/racing-desk-plugin/simhub-plugin/build/`; `apps/plugin/scripts/windows/install.bat`
copies it into SimHub — **ask before running it**, it replaces the installed plugin.

## Liveries

```bash
cd apps/livery
python -m venv .venv && .venv/Scripts/python -m pip install -e ".[dev,templates]"
.venv/Scripts/livery doctor         # paths, customer id, Blender, stale mips
.venv/Scripts/livery cars scan      # the cars installed on the rig — folder names are paint folder names
.venv/Scripts/python -m pytest -q
```

Imported from prodrive-agents#19. Use the real Python (`%LOCALAPPDATA%\Python\bin\python.exe`), not the
WindowsApps `python.exe` stub, which opens the Store and hangs. `livery.yaml` names the rig's install and Blender
4.2. Builds stage in `apps/livery/build/`; `--install` copies into the paint folder, keeping a `.bak-` of what it
replaces. Sponsor art beyond the two `sample-*` placeholders, paint templates and `data/cars.json` stay out of git.

## Dev loop (overlay design work — parked until Phase 5)

```bash
npm install
npm run dev                       # replay newest recording + overlay dev mode (CSS hot reload)
npm run dev -- --live             # overlay dev mode against live SimHub
npm run record -- --only-in-car   # record the :8889 payload while driving or in SimHub demo mode
npm run replay                    # serve a recording on :8889 (SimHub must be closed)
npm run recordings                # list recordings in %LOCALAPPDATA%\RacingDesk\recordings
npm test                          # all workspace tests
npm run test:golden               # golden frames (headless)
```

The replay format and server live in `packages/replay`; the plugin's payload is ~330 flat dotted keys
served by plain HTTP GET on `:8889/racing-desk/` (a MessagePack WebSocket on `:8890` also
exists; the overlay doesn't use it).

## Ground rules

- **Single user, local only.** No accounts, sync, telemetry upload, content packs, installer, release
  pipeline or marketing. Don't add seams for them.
- **No feature may depend on an authenticated iRacing endpoint.** The only network fetch is the
  season schedule PDF, never at race time.
- **Store and bundle no track or car data.** Track geometry comes from `Lat`/`Lon` in the user's own
  `.ibt` files; the sim's `.dat` packs are not decoded.
- **Keep the `localhost:8889` contract byte-identical** while hosts move — it's the seam between the
  engine and everything that consumes it.
- **No CI.** Everything runs locally; GitHub is source control and backup.

## Rig facts worth knowing

- iRacing install: `C:\Program Files (x86)\Steam\steamapps\common\iRacing` (the uninstall registry
  key points at a stale copy on `D:`).
- Telemetry: `Documents\iRacing\telemetry\*.ibt` — ~3k files, ~100 GB since Oct 2025.
- SimHub: `C:\Program Files (x86)\SimHub\` with the plugin installed.
- `%APPDATA%\iracing-electron\` holds iRacing login state — never dump its contents.
