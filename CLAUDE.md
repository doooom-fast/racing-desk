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

**Per car, for the rig** (schema v5 and v6; plan in `docs/view-and-pedals-plan.md`). Nothing here writes to iRacing's files
or to the pedals.
- `car_views` — the view a car was driven with. iRacing keeps one height and horizon for every car (`[View]` in
  `Documents\iRacing\app.ini`, read at sim start, written at exit), so `CarViewRecorder` reads the file while the sim
  is up and again once it has gone: what changed is what the driver changed in that car (`chosen`). A chosen view is
  never replaced by one that was only inherited from the car before. The seat is the cockpit camera's offset in the
  car's own `cameras\cars\<car>\car.cam` (`CarCamFile`, versions 14 and 15).
- `car_pedals` — which of Heusinkveld SmartControl's profiles a car is driven with, and that profile byte for byte as
  it was when the car was given it (each device's section carries a hash, so a profile is never rebuilt from its
  numbers). `RacingDesk.Data/Pedals/SmartControl.cs` reads `C:\ProgramData\Heusinkveld\Database\Heusinkveld.db`
  read-only: the profiles, and SmartControl Live's keys. A profile is parsed as text, never as bytes: most say
  `encoding="utf-16"` on their first line and are one byte to a letter.
- `car_pedal_facts` (schema v6) — what is known of a car's pedals beside its profile: the brake force it was last
  driven with, whether it has ABS, and who gave it its profile (`rule` and what the rule went by, `driver`, or
  `none` when he chose that it has none). A force is the car's with or without a profile, which is why it is not
  kept only in `car_pedals`.
- **The brake force is followed from SmartControl Live's keys** (`Pedals/BrakeForce.cs`, `CarPedalsRecorder.cs`),
  because it is in no file: a key goes to Live, Live tells the controller, the controller keeps it. The driver
  said yes to this (2026-09-28), on these terms:
  - Windows is asked whether a key is down (`GetAsyncKeyState`; no hook) about **the keys Live has bound to the
    brake force and no others** — `LiveKeyWatcher.Watched` — and never about a key that text is typed with,
    whatever Live has bound. It is asked on a telemetry frame, so only while the sim is sending; there is no
    clock in it. **Nothing is kept but the force**: the log has the force, never the key.
  - The force is known from the first key that *sets* one. **A number that may be wrong is not kept**: a step key
    held until Windows repeats it leaves the force not known until a key sets one, a key pressed while
    SmartControl Live is not running is not counted, and a look after a gap in the frames only looks.
  - When the sim goes, the car changes or the host stops, the run's force becomes the car's — if a key was pressed
    in that car, and whether or not the car has a profile. The pedals keep their force from car to car and through
    a break in the telemetry of under a minute; after longer, nothing is known until a key sets a force.
  - **A car with no pedals of its own is given them by the driver's rule** (`CarPedalsKeeper`): his `LightBrake`
    for a car with ABS that is not a formula car, his `Default` for a formula car or a car without ABS. A car has
    ABS when it publishes `dcABS` or its ABS was seen working; it is taken to have none after three laps of
    neither, counted across runs and only while he is in the car — and is put right if its ABS is seen later. A
    car is a formula car when any session in it ran in the category `Formula` (a test session is `Road` whatever
    the car). A profile he gave on the desk, or chose not to have, is never the rule's to change.
  - Nothing here may hold up or end the telemetry: SmartControl's database is read on a thread of its own and
    never waited for, and what is thrown while following the car is logged and goes no further.
  - Not yet: putting a car's force or profile *back* when he gets in. That presses keys or writes SmartControl's
    database, and waits on the experiments in the plan (does Live act on a key a program sends?) and on him. Nor
    is any of this said on the HUD.

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
would run with nothing on screen. The tray menu (Open desk / Cars / Settings, HUD on/off, Quit) and Ctrl+Shift+Q quit too. The host is
spawned detached — Node otherwise puts it in a job object Windows kills with the app, mid-write — and stops itself,
flushing what it was recording, when the app goes (`--parent-pid`). One instance: double-clicking the shortcut again
opens the desk in the running app.

**The HUD is on screen only while the driver is in the car.** Its window is made hidden, and
`modules/js/hud-visibility.js` is the only thing that reveals it (`showInactive`, so the sim keeps the focus): while
the telemetry says he is in the car, he has not switched the HUD off, and the page is loaded. At the sim's menus,
with the sim closed, or once the telemetry has not answered for three seconds it is hidden — two seconds after he
gets out, so it does not blink between sessions — and nothing is ever quit to get it off the screen. The decision
is the main process's, not the page's: it asks the telemetry the page reads, once a second (twice in the car), and
tells the page (`in-race-state`), which polls and draws only while he is in. A hidden page is not relied on to
notice him getting back in. What "in the car" means is one function, `inCar` in `modules/js/in-car.js`
(`tests/unit/in-car.spec.mjs`): demo mode; or the sim running and iRacing's own `IsOnTrack` and not a replay, which
the payload carries as `DataCorePlugin.GameRawData.Telemetry.IsOnTrack` (`TelemetryCapture.InCar`, sent only where
the sim says it: a key that is sent is believed, so one made up would hide the HUD for good) — so the garage
screen and a replay are out of the car; or, from a source that sends no such key, a session under way
(`Grid.SessionState` > 0), which counts them as in. The SimHub plugin sends the key once it has been installed
again from this build; until then, beside SimHub, the HUD is on screen in the garage.
The page on an iPad or in a browser has no main process behind it and asks the same function for itself; so does
`npm run record -- --only-in-car`. The driver's switch is kept until the app is quit: off stays off when he gets
in, on shows nothing while he is out. The tray's "HUD on/off" (ticked while it is on) throws it anywhere;
Ctrl+Shift+H and the Stream Deck's button only where what they do is seen — in the car, the page loaded — and
anywhere else leave the switch as it was and answer `{ ok: false, reason: 'out of the car' }` (pressed at the
desktop they used to switch the HUD off unseen, and there was none when he got in). The Stream Deck's button shows
its tick all the same: it goes by the answer's status, not by what the answer says. When the main process says he
is back in the car the page starts clean — no backoff left from a break in the telemetry, and one poll at once
(`startConnectionClean` in `game-detect.js`) — and while he is in the car the page is never left waiting on a
source that did not answer for longer than half a second, so a break too short for the main process to notice
does not leave old numbers up after it. A page whose process has gone is loaded again by `hud-visibility.js`:
two seconds later, for every reason but a clean exit, three times at most without a load finishing; and after
that, or after a load that failed, once more each time he gets in the car. A page that hangs has its process
ended (`unresponsive` → `forcefullyCrashRenderer`), and is loaded again as one that died. In dev mode the window stays as
`dev-mode.js` put it. `tests/unit/hud-main-wiring.spec.mjs` reads `main.js` and holds it to this: the window made
with `show: false`, nothing in `main.js` showing or hiding it, the switches going through `hud.toggle`.
**The HUD's keys are held only while he is in the car** (`modules/js/hud-keys.js`, `HUD_KEYS` in `main.js`,
`tests/unit/hud-keys.spec.mjs`). A key the app registers is taken from every other program on the machine for as
long as it is held — Ctrl+Shift+V is paste-as-text in a browser, Ctrl+Shift+P a command palette — and the app used
to hold twelve from start to quit. It holds two, Ctrl+Shift+O (the desk) and Ctrl+Shift+Q (quit); the HUD's ten
(H, R, G, D, M, I, F, V, B, P) are registered when `hud-visibility` says he has got in (`onInCar`) and let go when
he gets out. In dev mode they are held throughout.
**A limit:** beside SimHub the HUD reads SimHub's plugin on `:8889`; if SimHub goes in mid-session the HUD is
hidden, though the app's own host on `:18889` has the same telemetry. There is no falling back to it.

**The main process's log** (`logToFile` in `main.js`, `modules/js/app-log.js`, `tests/unit/hud-log.spec.mjs`): in
the built app `%LOCALAPPDATA%\Racing Desk\overlay.log`, beside `host.log` — it was written beside `main.js`, which
in the built app is inside `app.asar`, so nothing was kept; from source it is still
`apps/overlay/racing-desk-debug.log`. Past 4 MB the file becomes `overlay.log.1` (from source
`racing-desk-debug.log.1`, git-ignored with the other), in place of the one before, and a new one is begun. A line
that cannot be written is dropped — a failure to log is never a failure of the app — and no line carries a
customer id or the name of a key he pressed. The id is in more places than a paint's name: the name a paint is
written under on its way in (`car_<id>.doooom-tmp`), and `"customerId"` in the settings and in each backup's
manifest; `scrub` takes it out of all of them.

The desk window has three pages — **Desk**, **Cars** and **Settings** — switched from the masthead nav, the
tray menu, `?page=` or the `#settings` hash (`modules/desk/desk.js` `showPage`). Paints was a page of its own until
2026-09-29, when it and Cars became one; `paints` as a page's name still leads to Cars. Settings edits the HUD's `%APPDATA%\Racing Desk\overlay-settings.json` through the preload bridge
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

**Cars** is the one list of cars and the one place to look at a car: its liveries, the view it is driven with, its
pedals. The list is on the left — every car the rig knows, by the sim's name for it, cars with a livery first, a
filter over all of them, the livery groups above — and a car that has a view or pedals kept says so in its row
(`view`, `pedals`), so the cars that have been set up can be found among the rest. The car on the page is on the
right, in this order: its name; **View** and **Pedals**, side by side (`.car-rig`); its versions and "When a livery
is applied"; what is on disk for it (installed in the sim, backups); Trading Paints; and last the library's own
housekeeping, Library source. The view and the pedals are what the page is opened for after a drive, so they are in
sight without scrolling in the desk's smallest window (1024 × 680 outside, about 1008 × 641 inside) for every car,
with the liveries beginning under them, and choosing another car puts the pane at its top — both held by desk
tests. A strip under the name and not a column beside the liveries: at that width a column leaves the cards one
abreast, and is itself too narrow to hold both panels in the height there is.
- **The car driven last is the one the page opens on**, and follows — the desk hands over the dates at its start
  and whenever the store has something new — until he chooses a car in the list. A car he chose stays until he
  drives again: a drive begun after he chose it puts the page on the car he drove, which is what he comes back
  to the desk for. Dates of drives from before the choice, arriving late, move nothing. Nor is the page moved
  under a group or the group editor, or while something is being done; it catches up when he leaves them.
  Before any date has arrived it is the first car with a livery.
- **Driven**, a button beside the filter that says whether it is pressed, narrows the list to the cars he has
  driven, the last driven first, each row saying when. One click, kept while the page is open. That list is one
  group, "Driven", not the two: newest first is an order across every car driven. Off, the list is as it was.
- **What the page asks for while nobody is looking is nothing.** It stays mounted through a race, in the process
  the HUD answers to. The desk says nothing to it — neither that there is something to read again nor when each
  car was driven — unless the window is in front, not hidden, and Cars the page showing (`looking` in
  `desk.js`): the store has something new at the first lap of every session, which is when he is driving. What
  was not said is owed, and said when somebody next looks. The guards (`simStatus`, `tradingPaintsStatus`: a `tasklist` each) are looked at every 8 s
  only while the desk window has the focus and the page is showing, and at once when it gets it. The library's git
  remote is asked once per library, and not before a car with a livery, or a group, has been on the page for a
  second with the window in front; Check asks whenever he does. An apply checks for itself before it writes
  (`paints/apply.js`), whatever the chips last said. With "Update automatically when the app starts" ticked the
  check and the pull are made as the page starts, as the words say.
- **Coming back to the desk reads the car's view and pedals again** (`useRig.ts`): when the window comes to the
  front with the page showing, and once more 110 s later. The host keeps the pedals when the run ends and the
  view once the sim has gone and written its files, neither of which changes what the desk counts as new. It is
  three questions of the host on this machine; the list of cars is not read for it.

One UI source, `apps/paints/src` (React), bundled for the desk by
`apps/paints/build-island.mjs` into `modules/desk/paints.bundle.js` + `.css` (generated, like the calc bundle) and
mounted into `#cars-root` the first time the page is shown (`desk.js` `mountCars`). The page fetches nothing: every
call goes through `apps/paints/src/bridge.ts` to the preload bridge, and the main process does the asking. In a
browser there is no bridge, and the page says it needs the app. `id="cars"` is still the Desk page's Car affinity
card; the page's own elements are `cars-page` and `cars-root`, and the nav switches pages itself rather than
following `#cars`, which would scroll the desk to that card.

Its **liveries** are the livery manager (was doooom-paints, and the Paints page): a library of paint versions
outside the sim's folders, applied by copying files in under the customer id, backing up what was there, deleting
the stale `.mip` files and warning when Trading Paints would undo it. The calls are `window.racingDesk.paints` →
`paints:invoke` → `modules/js/paints-ipc.js` (the allow-list and argument mapping) →
`modules/js/paints/` (the file operations, ported from the Rust in `apps/paints/src-tauri`). Backups live under
`%LOCALAPPDATA%\Racing Desk\paints\backups`; what it remembers is the `paints` key of `overlay-settings.json`. The
library is hundreds of paints, every command scans it, and the scan runs in the process the HUD's windows answer
to — so a paint is hashed once: the hashes are kept beside the backups (`paints\hashes.json`, `digest.keepIn`), and
an apply forgets only the folder it wrote into (`digest.forgetUnder`), never the library. The
Tauri shell in `apps/paints` still builds from the same source and goes once the page has proved itself; it has no
host behind it, so there a car's View and Pedals say that the app is not there. Use made-up customer ids in fixtures.

Its **view** and **pedals** are what the host remembers per car (`car_views`, `car_pedals`, above). The view is the
one the car was last driven with — driver height, horizon, head horizon, FOV and the seat's three offsets — with
when it was last driven, whether the view is its own or inherited from the car driven before it, and when it was
recorded; a car with none yet says so plainly, which is how every car starts. The pedals are which SmartControl
profile the car is driven with, chosen from a select, with that profile's brake in a line beside it — and whether
the profile has been edited or deleted in SmartControl since, and the brake force kept for the car — and
SmartControl Live's keys at the foot. Nothing on the page changes iRacing or the pedals. Seat offsets are signed
millimetres and the page does not say which way is forward — that has not been verified.
- **What the store knows of a car's pedals beside its profile** (`car_pedal_facts`, above; `force_at`, `has_abs`,
  `given_by`, `given_why` on every row of `pedals`, and the rows of `without_profile`) is said in plain words
  (`components/CarPedals.tsx`). Under the profile, who gave it and why: "From LightBrake — given by the rule: it
  has ABS." (or no ABS, or a formula car), "You chose this.", "You chose that this car has none."; for a car with
  no profile yet, what is waited for: "No profile yet: not driven enough yet to say whether it has ABS.", or, once
  that is known, that the rule gives it one when it is next driven — or has no `LightBrake` or `Default` in
  SmartControl to give from. Beside the profile's brake, the force and when it was set: "brake force 62 kg in this
  car, set Tue, Sep 15, 5:40 PM". A host from before it sent any of this shows as it did: no sentence, no date.
  Taking a profile away leaves the force on the page.
- **Read through main.** `window.racingDesk.rig.read()` → `rig:read` (the desk window only) →
  `modules/js/rig-api.js`, which GETs `cars`, `views` and `pedals` from Node with a 3 s limit each, only from a
  host on this machine, and answers `{ cars, views, pedals }`, each `{ value }`, `{ missing: true }` (a 404: a host
  from before the route, and the page says the host is older) or `{ error }` in words — never a rejection, and
  one failing does not take the others with it. `apps/paints/src/rig.ts` shapes the answers and trusts none of
  them. Read when the page is mounted and each time it is shown again — not at desk start.
- **Read again, the list of cars with it, when the desk says so** (`racingdesk:refresh`, `desk.js` `refreshCars`):
  the masthead's Refresh, which does for this page what the page's own does; the desk finding the host after finding none,
  which is how cars listed by folder while the host was starting get their names; and the store having something
  new — the desk asks the host how it stands every 30 s (`pollStatus`), and another session is a drive, so the car
  just driven is there to be looked at when he comes back. Said while another page is up, it is owed, and said
  when Cars is next shown.
- **One write**, through main because the host refuses a request that names an origin:
  `window.racingDesk.rig.bindPedals(carPath, profileId | null)` → `rig:bindPedals` → `rig-api.js`, which POSTs
  and answers `{ ok: true, car }` or `{ ok: false, error }`. The car is named by the store's own `car_path`, which
  `cars` gives; a car the store has never had in a session has none, and its select is off and says why.
  `tests/unit/rig-api.spec.mjs` reads `main.js` as text and holds both handlers to answering the desk window alone.
- **Which car a row is about** is the list's own rule: the sim's car path with `-`, `_` and case folded away
  (`rig.ts` `carKey`, as `paints/library.js` `normalise`), so the library's `mx5-mx52016` has the view kept for
  `mx5 mx52016`.
- **Last driven** is the desk's to say: `desk.js` works it out from the session rows it has read for the Desk page
  and hands it to the island (`RacingDeskPaints.setLastDriven`), each time it reads them. It is what the page
  opens on and what Driven is ordered by, as well as what a car's View says.
- **With no library** the list is still there in the desk — the install's cars and the paint folder's — once one
  has been looked for and not found, so a car's view and pedals do not wait on there being a livery anywhere.

Applying is one click — there is no dialog. The three options (spec map, read-only afterwards, other drivers' cooked
files) are set once under "When a livery is applied" and remembered; an apply that is refused says why where the
click was, and offers to go on regardless only when something stands in every apply's way (the sim running, the
downloader). **Groups** (`modules/js/paints/groups.js`; commands `liveryGroups`, `saveGroup`, `deleteGroup`,
`setGroup`) are one name for a livery across cars: a version id more than one car has in the library is a group by
itself, and the driver's own — a name and a version per car — are kept under `paints.liveryGroups`. Setting one
applies each car's version through `apply.js`, skips a car already wearing it, and carries on past a car that
fails. A car never driven has no paint folder: an apply makes it under the install's name for the car
(`installPath` in the catalogue), and only `index.js` decides that it may.

The list is every car the rig knows, by the sim's name for it — cars with a livery first, then the rest, with a
filter over both — and a car with no livery still shows what is installed for it and its backups. It is the
`carCatalogue` command (`modules/js/paints/catalogue.js`; the desk's own — the Rust has none, so the Tauri shell lists
the library by folder name): the library's cars, the cars in the iRacing install and the folders of the paint
directory that are cars, merged on the sim's car path, and the cars he has driven that are in none of the three.
That path is the car's folder under `<install>\cars` with the
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
- **A car he has driven that is nowhere on disk** — uninstalled since, or the install not found — is listed from
  the store's row for it (`driven` > 0), under the store's own path, not installed, with no paint folder: its view
  and pedals are kept, and were out of reach. The page says "Not installed" and offers nothing that needs the car
  on disk — nowhere for a livery, nothing installed, no backups, nothing read from the paint folder for it; its
  pedals can still be given a profile, which is the store's. A car only ever seen in a session is not listed.
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
python -m venv .venv && .venv/Scripts/python -m pip install -e ".[dev,templates,fleet]"
.venv/Scripts/livery doctor         # paths, customer id, Blender, stale mips
.venv/Scripts/livery cars scan      # the cars installed on the rig — folder names are paint folder names
.venv/Scripts/python -m pytest -q
```

Imported from prodrive-agents#19. Use the real Python (`%LOCALAPPDATA%\Python\bin\python.exe`), not the
WindowsApps `python.exe` stub, which opens the Store and hangs. `livery.yaml` names the rig's install and Blender
4.2. Builds stage in `apps/livery/build/`; `--install` copies into the paint folder, keeping a `.bak-` of what it
replaces. Sponsor art beyond the two `sample-*` placeholders, paint templates and `data/cars.json` stay out of git.

**The fleet build** (`apps/livery/src/livery/fleet`, `livery fleet status|build|panels|logos`) lays one livery —
the DOOOOM shard field, as `shatter` and `shatter-inverted` — on every car that has a paint template, and writes it
into the library the Cars page reads, where a version name shared by cars is a group by itself. It is the library's
own `design/fleet` scripts and the skills `iracing-paint-templates`, `iracing-livery-placement` and
`iracing-paint-install` (all three now in `.claude/skills/`), with the paths of the machine they were written on
taken out. The rules it is built on, each with a test in `apps/livery/tests/test_fleet*.py`:
- **Templates are iRacing's files.** They are public (no login; `data/paint_templates.tsv` holds the addresses, and
  only an `https://ir-core-sites.iracing.com/…zip` is ever fetched), they are kept in
  `%LOCALAPPDATA%\Racing Desk\templates\`, and they are never committed or passed on. Out of an archive comes the PSD
  and nothing else, under its own file name.
- **Nothing heavy while the sim runs.** The build asks before each car and waits; `panels` and `logos` refuse.
- **A paint the build did not make is never written over** — `meta.json`'s `source` says whose a version is, and
  `--force` rebuilds only the build's own. The seventeen cars painted before carry logos this machine cannot yet
  repeat.
- **The customer id is in file names only.** It is read from the library's paints, and appears in no log line,
  report or `meta.json`.
- **The field is the fleet's** (`art/doooom/shatter-field.png`, recovered from the 34 paints already in the library),
  so a car painted here matches the cars painted before it. `packages/shatter` is the engine that makes a new one
  (`IMPORTED.md` there says what of it is wired).
- **Logos wait on two things**: the sponsors' masks (`art/sponsors/masks/`, still on the machine that made them) and
  a panel map per car (`data/panels/<car>.json`), which takes a look at the car's own stock schemes.

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
