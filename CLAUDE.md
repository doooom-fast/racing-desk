# prodrive

Pro Drive for one driver on one rig: a transparent HUD and desk app over live iRacing telemetry, with
no account, no cloud and no distribution. This machine *is* the rig — iRacing, SimHub and the full
`.ibt` history are local, so verify against real data rather than assuming.

**The plan:** [`docs/local-first-refactor-plan.md`](docs/local-first-refactor-plan.md) (phases in §8).
**What the rig actually looks like:** [`docs/local-first-phase0-findings.md`](docs/local-first-phase0-findings.md).

## Layout

| Path | What | Instructions |
|---|---|---|
| `apps/overlay/` | Electron app: the HUD (`dashboard.html`) and the desk window (`desk.html`), both consumers of `localhost:8889` | [`apps/overlay/CLAUDE.md`](apps/overlay/CLAUDE.md) |
| `apps/core/RaceCor.Core/` | The engine, runtime and `:8889` / `:8890` servers, host-agnostic (`net48` + `net8.0-windows`). `IRacing/` reads the SDK or `.ibt` directly | — |
| `apps/core/RaceCor.Data/` | Local SQLite store (`%LOCALAPPDATA%\RaceCor\prodrive.db`), session capture, `.ibt` backfill, track outlines from Lat/Lon (`net8`, host only) | — |
| `apps/host/RaceCor.Host/` | Standalone host: live iRacing or `.ibt` replay → same `:8889` contract, records sessions | — |
| `apps/plugin/` | SimHub plugin — now a thin adapter over RaceCor.Core (SimHub dashes, actions, events). `prodrive.sln` at the root builds all .NET projects | [`apps/plugin/CLAUDE.md`](apps/plugin/CLAUDE.md) |
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
npm run test:dotnet                 # dotnet test prodrive.sln (5 WsTelemetryPublisher failures are pre-existing)
npm run host                        # live iRacing → :8889/:8890, records sessions, backfills new .ibt
npm run host -- --ibt <file> --http-port 18889 --ws-port 18890   # replay an .ibt beside SimHub
npm run ingest                      # backfill prodrive.db from Documents\iRacing\telemetry
npm run sessions -- --type Race     # read back stored sessions (--laps <id> for laps)
npm run parity -- --seconds 120     # live session: diff SimHub's :8889 with the host's :18889
npm run host -- sql "SELECT ..."    # read-only query against the store, JSON out
npm run host -- schedule --fetch    # download the season PDF if it changed, parse it, store it
npm run host -- schedule            # parse the stored PDF and report what the parser found
npm run host -- schedule --series "Caterham"   # what one series parsed to, week by week
```

The host also serves the store read-only at `:8889/racecor-io-pro-drive/data/{status,sessions,session?id=}`
— that's what the desk reads. If SimHub's plugin holds `:8889`, the desk says so instead of loading.

## Season schedule

The only thing Pro Drive fetches. iRacing publishes a ~200-page PDF per season; `RaceCor.Data/Schedule` reads it
with PdfPig (laid out as fixed-pitch text, like `pdftotext -layout`), parses every series and week, and stores it
(schema v3). The live host refreshes it once a day, never while the sim is running.

- The PDF is **not linked from iracing.com's season page HTML** — it's posted on iRacing's forum file host. The URL
  is `settings.json`'s `scheduleUrl` (`--url` overrides it). When a season's URL changes, set it there, or just
  drop the PDF into `%LOCALAPPDATA%\RaceCor\schedule\` — the newest PDF in that folder is used.
- The parse checks itself against the PDF's own contents pages: every series listed has to come out of the body
  (2026 S4: 151 of 151, 1,989 series-weeks, all with a race length).
- Track and car names come out as iRacing writes them in the PDF, which is not always how it writes them in
  telemetry; the engines fuzzy-match (`packages/calc/src/engines/fuzzy-match.ts`).

## Desk

```bash
npm start -w racecor-overlay        # HUD + desk (desk opens at launch; --no-desk to skip, Ctrl+Shift+O to reopen)
npm test -w @prodrive/calc          # engines + local model (vitest)
npm run test:desk                   # desk.html over a mock host, headless, off-machine requests blocked
```

`modules/desk/calc.bundle.js` is generated from `packages/calc` on overlay start and by the desk tests — don't edit
or commit it. Rating changes aren't in telemetry: a race's iRating/SR change is read from the driver's next
session in the same licence category. Next-race suggestions are limited to the disciplines the driver actually
races (3+ races in the last year) and to what their licence can enter.

The SimHub plugin build stages into `apps/plugin/racecor-plugin/simhub-plugin/build/`; `apps/plugin/scripts/windows/install.bat`
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
npm run recordings                # list recordings in %LOCALAPPDATA%\RaceCor\recordings
npm test                          # all workspace tests
npm run test:golden               # golden frames (headless)
```

The replay format and server live in `packages/replay`; the plugin's payload is ~330 flat dotted keys
served by plain HTTP GET on `:8889/racecor-io-pro-drive/` (a MessagePack WebSocket on `:8890` also
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
