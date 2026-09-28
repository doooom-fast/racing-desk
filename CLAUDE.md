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

The host also serves the store read-only at `:8889/racing-desk/data/{status,sessions,session?id=,schedule,cars}`
— that's what the desk reads. If SimHub's plugin holds `:8889`, the app runs its host on `:18889`/`:18890` instead (see Desk).

Car names (`cars`, schema v4) come from the session YAML of the driver's own sessions, which lists every entrant's
`CarPath` and `CarScreenName` — nothing of iRacing's is bundled, so a car that has never been in one of those sessions
has no name. The host reads them on ingest and live capture, and once, in the background, from the headers of the
files ingested before v4 (`ingested_files.cars_scanned`) — a file cut short or gone is marked read all the same, one
that could not be reached (held by another program, its folder not there) is tried again at the next start, and a
header pass that fails does not stop the ingest after it. `seen` is the number of stored sessions a car was entered in
(`session_cars`), `driven` those the driver drove it in. An older host still records sessions in a v4 store but can
no longer mark a file ingested, so rebuild the app before opening the real store with a newer host.

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
would run with nothing on screen. The tray menu (Open desk / Paints / Settings, HUD on/off, Quit) and Ctrl+Shift+Q quit too. The host is
spawned detached — Node otherwise puts it in a job object Windows kills with the app, mid-write — and stops itself,
flushing what it was recording, when the app goes (`--parent-pid`). One instance: double-clicking the shortcut again
opens the desk in the running app.

The desk window has three pages — **Desk**, **Paints** and **Settings** — switched from the masthead nav, the tray menu, `?page=` or the `#settings` hash (`modules/desk/desk.js`
`showPage`). Settings edits the HUD's `%APPDATA%\Racing Desk\overlay-settings.json` through the preload bridge
(`modules/desk/settings-model.js` lists the keys) and each change applies live: `save-settings` writes the file whole
and sends `settings-sync` to the HUD window. The old WinUI settings app is no longer the way to change the HUD.

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
