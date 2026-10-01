# Local-First Refactor Plan — Pro Drive on the Rig

> **Status:** proposal. Phase 0 done 2026-09-16 — see
> [`local-first-phase0-findings.md`](local-first-phase0-findings.md); corrections folded in below.
>
> Supersedes the cloud-hub assumptions in
> [`archive/monorepo-orchestration.md`](archive/monorepo-orchestration.md),
> [`archive/native-apps-api-contract.md`](archive/native-apps-api-contract.md), and
> [`archive/native-apps-calc-integration.md`](archive/native-apps-calc-integration.md), and
> [`archive/release-pipeline.md`](archive/release-pipeline.md) if adopted.
>
> **Scope (decided 2026-09-16): one user, one rig.** Pro Drive is built for Kevin, on his machine.
> No accounts, no sync, no distribution, no audience — so no content packs, no installer or release
> pipeline, no marketing site and no competitive positioning. Everything below is sized to that.

---

## 1. The bet

**Move the product onto the rig. No cloud.**

Three things changed that make this the right time:

1. **iRacing shipped Track Map, Fuel Calculator and Incident Tracker widgets in 2026 Season 3.**
   Three of our HUD features are now table stakes inside the sim. Feature parity is no longer a
   position. Rendering quality, information design, and integration are.
2. **iRacing retired legacy read-only auth (2026 S1, Dec 9 2025) and has *paused* OAuth client-ID
   creation** while it evaluates third-party API/SDK usage. Our `IRacingDataClient.cs`
   credential-login path is dead, and we cannot currently register a replacement. A cloud hub whose
   ingest depends on iRacing web auth is building on sand. A local-first product that reads the SDK
   and the user's own `.ibt` files is not affected at all.
3. **The local corpus is already rich.** `.ibt` files carry GPS-grade `Lat`/`Lon`/`Alt` for the
   player, and every session's YAML carries the full grid with iRatings and end-of-session results.
   *(Phase 0 correction: `irsdkLogAllCars=1` does **not** add opponent arrays to `.ibt` — disk
   telemetry has no `CarIdx*` arrays at all. Frame-level opponent data exists only live.)*

The result is a system where the *entire* value loop — capture, analyse, suggest, render, record —
happens on one machine, with no account, no upload, and no network dependency at race time.

### What happens to the cloud

| Today | After |
|---|---|
| Neon Postgres, 23 tables, per-user data | *(gone)* |
| NextAuth + Discord OAuth | *(gone)* |
| 83 API routes | *(gone)* |
| Vercel Blob telemetry storage | *(gone)* |
| Stored track maps + SVGs, alias/resolution tooling, 13 track routes | *(gone — track data is read locally, never stored, never shipped; §3)* |
| Calc engines on `api.prodrive.racing-desk.io` | Ported into the Electron main process |
| Chrome extension scraping members-ng | *(gone — auth path is retired anyway)* |
| Marketing site | *(gone — single user)* |
| Six-repo lockstep release pipeline | *(gone — built and run on the rig; §7)* |

No login, no server, no hosted anything. The only outbound request is the season-schedule fetch
(§3) — run in the background, never at race time, and everything works when it fails.

---

## 2. What iRacing gives us now (and what it took away)

### Gives

| Capability | Where it lands for us |
|---|---|
| Track Map / Fuel Calculator / Incident Tracker widgets (2026 S3) | We stop competing on *existence* of these and compete on *rendering*. Our fuel model stays, but it earns its place by being predictive and strategic, not by being a number on screen. |
| Session YAML grid + `ResultsPositions` in every `.ibt` | Local field-strength and lap-level relative pace without any API. Feeds the suggestion engine (§6). Frame-level opponent traces must be recorded live from shared memory — disk telemetry has none. |
| Session-info YAML: `SplitTimeInfo` sectors, `DriverInfo` iRating/SR/licence, full grid with every opponent's iRating, incident limits | **Replaces four server features outright**: track sector-boundary storage, iRating/SR fetch, driver-rating tables, and incident-limit config. We already parse most of this in `IRacingSdkBridge.cs` — it just isn't the source of truth yet. |
| `.ibt` files in `Documents\iRacing\telemetry\` | Cold-start history. On first run we can backfill months of racing the user already has on disk — something the cloud version could never do. *Needs `irsdkAutoLogDisk=1` — on for the rig (Phase 0 §3).* |
| Installed content on disk (`<install>\tracks\`, `\cars\`) | What the user has *downloaded* — a strong proxy for owned. Suggestions that never recommend content you'd have to buy. Layout verified: `TrackName`/`CarPath` map to paths deterministically (Phase 0 §2); treated as owned under single-user scope. |
| Track data already on the user's machine — `Lat`/`Lon` in the user's own `.ibt` history, plus live SDK position | **The only track-geometry source.** We store none of it and ship none of it (§3). Deletes the entire server-side track apparatus. |

### Takes away

| Change | Consequence |
|---|---|
| Legacy read-only auth retired (2026 S1) | `IRacingDataClient.cs` (683 lines) is dead code. Delete it — the session YAML has iRating and SR already. |
| OAuth client-ID creation **paused** | We cannot register a `/data` API client today. Any plan that needs `/data` is blocked on iRacing's timeline. **This plan deliberately needs zero `/data` access.** |
| Sim ships its own map/fuel/incident widgets | Two of our HUD modules lose novelty. Respond with quality and integration, not parity. |

**Design rule that falls out of this:** *no feature may depend on an authenticated iRacing endpoint.*
If OAuth reopens, treat it as an optional enhancement, never a dependency.

---

## 3. Target architecture

### Process model

```
┌─────────────────────────────── the rig ───────────────────────────────┐
│                                                                        │
│   iRacing ──shared memory──┐        Documents\iRacing\telemetry\*.ibt  │
│                            │                        │                  │
│                            ▼                        ▼                  │
│              ┌──────────────────────────────────────────────┐          │
│              │  RacingDesk.Core  (net48 + net8.0)              │          │
│              │  · IRSDKSharper live reader                   │          │
│              │  · session YAML → sectors, ratings, grid      │          │
│              │  · fuel / incident / commentary engines       │          │
│              │  · Moza serial                                │          │
│              │  · .ibt ingest (backfill + post-session)      │          │
│              │  · SQLite writer                              │          │
│              └───────┬──────────────────────────┬────────────┘          │
│                      │ hosted by                │ hosted by             │
│         ┌────────────▼───────────┐   ┌──────────▼──────────────┐        │
│         │ RacingDesk.Host.exe (.NET8)│   │ SimHub plugin (net48)   │        │
│         │  default, no SimHub     │   │  optional — dashes,     │        │
│         │                         │   │  Arduino/LED devices    │        │
│         └────────────┬───────────┘   └──────────┬──────────────┘        │
│                      └────────── localhost:8889 ─┘                      │
│                                    │ HTTP + WS (contract unchanged)     │
│                      ┌─────────────▼──────────────┐                     │
│                      │  Pro Drive (Electron)      │                     │
│                      │  · overlay window (HUD)     │                     │
│                      │  · desk window (app)        │                     │
│                      │  · calc engines (Node)      │                     │
│                      │  · SQLite reader            │                     │
│                      │  · recorder / replay        │                     │
│                      └─────────────┬──────────────┘                     │
│                                    │                                     │
│ %LOCALAPPDATA%\RacingDesk\ racing-desk.db · telemetry\ · bundles\ · schedule\ │
└────────────────────────────────────┼───────────────────────────────────┘
                                     │ background, off race-time, optional
                          iRacing's public season schedule
```

### Two processes, not five

- **`RacingDesk.Core`** — the existing plugin engine, multi-targeted **`net48;net8.0-windows`** so the
  same code builds for both SimHub's .NET Framework 4.8 host *and* a .NET 8 standalone host.
  (Not netstandard2.0: IRSDKSharper ships no netstandard build — Phase 0 §6.) This is
  the key structural change in the C# side and should be done first; everything else follows.
- **`Pro Drive` (Electron)** — the existing overlay, plus a second `BrowserWindow` that is the
  desktop app. **This deletes `prodrive-windows` entirely** (67k lines of WinUI 3) and with it the
  9-page WinUI app, the Discord PKCE flow, and the second design-system implementation.

### SimHub becomes optional, not required

Today SimHub is a hard prerequisite: our plugin only runs inside it. But `IRacingSdkBridge.cs`
already reads the SDK directly via IRSDKSharper — SimHub is largely a *host*, not a data source.
Making the standalone host the default removes a moving part, while keeping the SimHub plugin for
when SimHub dashes, Arduino output or LED devices are wanted.

> Keep the `localhost:8889` JSON contract byte-identical through this change. It is the seam that
> lets us move the host without touching the overlay, Homebridge, or anyone's third-party tooling.

### Local storage

| Path | Contents |
|---|---|
| `%LOCALAPPDATA%\RacingDesk\racing-desk.db` | SQLite — sessions, laps, sectors, incidents, ratings, opponents/grids, mastery, suggestion cache |
| `%LOCALAPPDATA%\RacingDesk\telemetry\<sessionId>.jsonl.zst` | Per-frame traces (same schema as [`telemetry-sidecar-schema.md`](telemetry-sidecar-schema.md)) |
| `%LOCALAPPDATA%\RacingDesk\bundles\` | `.rcpdv` race bundles (unchanged) |
| `%LOCALAPPDATA%\RacingDesk\schedule\` | Last-fetched season schedule source + parsed result (§3) |

SQLite via `Microsoft.Data.Sqlite` (writer, C#) and `better-sqlite3` (reader, Electron). Single
writer, many readers, WAL mode. The existing Drizzle schema maps over almost one-to-one minus the
user/auth/token tables.

### Authored content ships in the build

No content packs and no `prodrive-packs` repo. What the packs would have carried lives in the
monorepo and is built into the app:

| Content | Where | Replaces |
|---|---|---|
| Design tokens | `packages/tokens` | `/api/v1/tokens/native` and `token-loader.js`'s live fetch |
| Commentary | the 240+ pre-generated fragments, checked in | server-hosted fragments |

**No track data, no car data — stored or bundled.** Everything about a track or a car is resolved on
the rig from data iRacing already put there.

### Season schedule — the one network fetch

`next-race-ideas` needs the season schedule. It's the only thing Pro Drive fetches.

**Source (decided 2026-09-16): iRacing's official season schedule PDF** — public, no login, published
per season on iRacing's season page, 200+ pages covering tracks, race lengths, race frequency and
incident limits. A background job on the rig checks the season page, downloads the PDF when it's new
or revised (the first one each season is *preliminary*), parses it into SQLite, and keeps the last
good PDF and parse in `schedule\`. It never runs at race time, and a manual override covers a bad
parse.

Not used: the `iracing-week-planner.tmo.lol` bundle scrape (`iracing-schedule-fetcher.ts`, deleted
with the server) and the iRacing UI's local cache, which Phase 0 §5 found holds no schedule.

### Track data: iRacing's local data only

**The track API reads iRacing's own local data and nothing else. We store zero SVGs — not on a
server, not in the repo.**

Two local sources, in order of preference *(revised after Phase 0)*:

1. **`Lat`/`Lon`/`Alt` from the user's own `.ibt` files.** Disk-only variables, recorded every
   frame. An outline averaged over clean laps matched YAML `TrackLength` to 0.01% (Virginia), 0.10%
   (Zandvoort) and 0.28% (Nordschleife), in well under a second per file. Covers every layout the user
   has ever driven, with elevation. Key by `TrackID` — layouts get re-released under new names.
   *The sim's own map data is not used (decided 2026-09-16):* it lives in signed, zstd-compressed
   `.dat` packs, and decoding them means reverse-engineering iRacing's asset format for gains a test
   out-lap mostly covers (Phase 0 findings).
2. ~~**Live SDK world position.** `TrackMapProvider.cs` already records an outline from world X/Z +
   `LapDistPct` and normalises it to a 0–100 viewBox.~~ Gone on 2026-09-30: live shared memory has no
   position, so that outline was dead-reckoned from velocity and yaw, started wherever the car was and
   bent wherever it spun. The first session at a layout is now followed through the `.ibt` the sim is
   writing (`IbtFollower`), and from its first clean lap there is a provisional outline; the SimHub
   plugin asks the app's host for every outline over loopback. Root `CLAUDE.md`, Track maps.

Sector boundaries come from `SplitTimeInfo` in the session YAML — also local, also already parsed.

What this deletes, immediately and without replacement:

| Gone | Size |
|---|---:|
| `track_maps` table — `svg_path`, `raw_csv`, `svg_preview`, `logo_svg`, `logo_png`, `sector_boundaries` | 1 table |
| `track_aliases`, `track_resolution_misses` | 2 tables |
| 13 track routes (`/api/tracks`, `/api/v1/tracks/*`, 9 × `/api/admin/tracks/*`, `/api/iracing/consolidate-tracks`) | 1,429 lines |
| `track-svg.ts`, `parse-shtl.ts`, `resolve-track.ts`, `track-resolver{,-core}.ts`, `tracks.ts`, `track-backfill.ts` | 885 lines |
| Admin tracks page, `/k10/tracks` page, the whole alias/merge/rename/backfill/miss-tracking workflow | — |
| Overlay: `_trackApiSvgCache` and the `K10_DISPLAY_NAME_API` fetch in `poll-engine.js`; the `_apiSvg` preference in `drive-hud.js` | — |
| Plugin: the `GET /api/tracks?trackName=` call in `TelemetrySnapshot.Capture.cs` | — |

The overlay already falls back to the plugin's local `TrackMap.SvgPath` when the API returns
nothing (`drive-hud.js:197–205`). Deleting the API path doesn't break the feature — it *removes a
branch*. The fallback becomes the only path, and then gets to be the thing we actually invest in.

That investment is the point. Track rendering stops being "fetch a curated SVG from Postgres" and
becomes a real-time rendering problem over local geometry — which is exactly where the
differentiator lives (§5) and exactly the kind of work the replay harness (§7) makes fast.

> Remaining stored-SVG asset: the `car_logos` table (manufacturer brand marks). Those aren't
> iRacing's data, so they're a separate call — bundle them in the app or drop them, but don't let them
> ride along under this decision.

---

## 4. The pare-down ledger

Current system, measured:

| Repo | Files | Lines | Disposition |
|---|---:|---:|---|
| `prodrive-server` | 472 | 94,743 | **Archive**, once the ~7k lines of calc engines are ported into Electron. Nothing else survives: 83 API routes, 23 tables, NextAuth, Drizzle/Neon, Vercel Blob, 8 admin pages, the Chrome extension, the marketing site, and the entire track apparatus (§3 — 2,314 lines and 3 tables on its own). |
| `prodrive-windows` | 160 | 66,960 | **Delete.** Absorb the Moza settings UI into the Electron app. |
| `prodrive-plugin` | 190 | 31,756 C# | **Keep and restructure.** Multi-target core `net48;net8.0-windows`; delete `IRacingDataClient.cs` (dead) and all cloud push/fetch; add SQLite writer + `.ibt` ingest. |
| `prodrive-overlay` | 279 | 52,477 | **Keep almost entirely.** Delete `calc-client.js`, `session-sync.js`; repoint `token-loader.js`, `car-logos.js`, `pit-wall-chip.js`, `poll-engine.js` at local data and bundled content. Add desk window. |
| `prodrive-agents` | — | — | Fold into the monorepo as `.claude/` + `docs/`. |
| `prodrive-*-showcase` ×2 | — | — | **Delete.** Nothing to demo to; the replay harness covers their dev use (§7). |
| `prodrive-ios` / `macos` / `tvos` | — | — | **Park.** They exist only to consume the server API. Revive later as LAN clients to the rig if there's demand. |
| `prodrive-designer` / `prodrive-edit` | — | — | **Absorb.** Designer becomes the overlay's dev mode; edit becomes a workspace in the monorepo. |
| `prodrive-homebridge` | — | — | Keep as-is. It polls SimHub:8888 and is unaffected. |

**16 repos → 1:** `prodrive` (monorepo), pushed to GitHub as source control and backup.
**Six-repo lockstep release → none.** The rig builds and runs the app from source (§7).

### What is deleted vs. what is *moved*

Worth being precise, because "delete the server" undersells it: the calc engines are the best code in
the system and none of them are being thrown away.

| Engine | Lines | Fate |
|---|---:|---|
| `next-race-ideas.ts` | 1,387 | Port → Electron main. Becomes the core of Race Now (§6). |
| `when-generator.ts` / `when-engine.ts` | 1,565 | Port. All inputs are local session history. |
| `composure.ts` | 678 | Port. Pure telemetry-derived. |
| `race-summary.ts` | 546 | Port — but the Anthropic call becomes BYO-key, like `race-coach.js` already is. |
| `race-now-verdict.ts` | 515 | Port. |
| `driver-dna.ts` | 499 | Port. |
| `previous-races.ts` / `mastery.ts` / `moments.ts` | 1,163 | Port. |
| `fuzzy-match.ts` / `tz.ts` / view helpers | 621 | Port — and `fuzzy-match` mostly *retires*. It exists to reconcile track names scraped from three different sources; with the SDK as the only source, names are already canonical. The alias/resolution/consolidation apparatus goes with it (§3). |

Every one of these takes `sessions[]` + `ratings[]` + `schedule` as input. Those become SQLite
queries instead of Postgres queries. The engines themselves barely change.

---

## 5. What it's for

A HUD and debrief tool for one driver, judged by whether it beats iRacing's own widgets *for him*.
Where the effort goes, in priority order:

1. **Rendering.** The WebGL2 pipeline, 30fps+, real motion design. A HUD treated as a designed object.
   Gets the most engineering time.
2. **Information design.** What to show, when, at what density, with what typography. iRacing's new
   widgets are the baseline to beat.
3. **Racing opinions as defaults.** One configuration that's right for how Kevin races, rather than
   200 toggles.
4. **Suggestions that read telemetry** (§6), not a results page.

---

## 6. Race Now — suggestions without a login

The existing `next-race-ideas.ts` scores on: track familiarity, track incident rate, car
familiarity, car performance, time of day, day of week, rating trend, licence level. All eight are
computable from local history. The interesting question is what we can do *locally* that a
cloud service can't — and there's more than expected.

### Local-only signals, ranked by value × feasibility

**S1 — Owned-content filter.** Enumerate installed tracks and cars from the iRacing install
directory. Never suggest a race the user would have to buy into. Cloud tools need
`/data/member/info` and OAuth for this; we need a directory listing. *(Layout verified in Phase 0; installed is treated as owned.)*

**S2 — Field-strength memory.** Every session's YAML contains the full grid with every opponent's
iRating. We already parse it. Persist it: `field_observations(series_id, race_week, hour_bucket,
sof, entry_count)`. After a few weeks of racing this predicts the SoF of a given series at a given
hour better than a generic prior — from the user's own splits, which is exactly the population they
race in. No API, no scraping, and *nobody else has this data shape.*

**S3 — Pace readiness from `.ibt`.** Not "have you raced here" but "are you on the pace here,
tonight". Recent laps at this track/car vs. personal best and vs. your own consistency band.
Familiarity is a proxy; this is the real quantity.

**S4 — Form and fatigue.** Rolling incident rate by hour-of-day and by race-number-within-a-sitting.
"Your incident rate on the third consecutive race is 2.4×" is a genuinely useful thing to be told at
11pm, and it requires continuous local presence to know.

**S5 — Expected-value ranking.** Combine S2 (predicted SoF) + S3 (predicted finishing position
distribution) + your incident distribution at that track → expected ΔiR and expected ΔSR. Rank by
**EV per hour of your time**, using `sessionMinutes` and `raceTimeLimit`/`raceLapLimit` from the season
schedule. This is the number the whole feature should be built around.

**S6 — Track archetypes for content you've never driven.** Derive an archetype vector per track from
telemetry (corner-speed histogram, braking events/km, elevation change, throttle-on duty cycle),
then match against the tracks where you're historically strong. Lets us confidently suggest a track
you've *never raced* — the single hardest thing for a familiarity-based recommender to do, and the
clearest demonstration that we read telemetry rather than results.

**S7 — Time budget.** Infer the user's usual racing window from local usage. "You have 70 minutes"
prunes the list harder and more usefully than any scoring weight.

**S8 — Week freshness and decay.** New week Tuesday; mastery decays; suggest a practice block before
a race when readiness (S3) has drifted below your own band.

**S9 — Repeat-incident awareness.** From local grids: how often you've shared a split with drivers
you've had contact with. Aggregate only, never named. Useful, and slightly delightful.

### History

S2–S6 need history, and the rig has it: **backfill every `.ibt` on disk at first run** — 11 months
here, where `irsdkAutoLogDisk=1`. The app checks `app.ini` at launch and offers to turn disk logging
back on if it's been switched off. No generic priors, no cold-start design.

### The surface

One verdict card — *"Race Now: GT4 at Oulton, 18 minutes, +14 iR expected, your incident risk here
is below your average"* — with the ranked alternatives behind it, and the score breakdown rendered
as a designed explanation rather than a table of eight numbers.

---

## 7. The rig as the dev environment

The current loop is: edit on Mac → push → GitHub Actions → Vercel deploy → build installer →
install on rig → launch iRacing → drive → observe. That's the actual thing killing velocity, more
than any architectural problem.

Target loop: **edit on the rig → hot reload → replayed telemetry drives the UI → observe. No sim, no
driving, no install, no network.**

### Rig setup (one-time)

```
git, Node 22+, .NET 8 SDK, VS Build Tools 2022 (C++ + .NET desktop),
Claude Code (native Windows — needs PowerShell, dotnet,
and Documents\iRacing access)
Documents\GitHub\racing-desk   ← single monorepo (next to the old repos; was `prodrive` until 2026-09-27)
```

Native Windows Claude Code, not WSL — the agent needs to build .NET, launch Electron, read
`Documents\iRacing\telemetry`, and enumerate the iRacing install.

### Monorepo layout

```
prodrive/
  apps/
    overlay/          ← ex-prodrive-overlay (Electron: overlay + desk windows)
    core/             ← ex-plugin engine, net48 + net8.0-windows
    host/             ← .NET 8 standalone host
    simhub-plugin/    ← net48 shim, optional
    edit/             ← ex-prodrive-edit
  packages/
    calc/             ← ported TS calc engines
    tokens/           ← Style Dictionary source
    replay/           ← the replay harness
    schedule/         ← season schedule fetch + parse
  .claude/            ← ex-prodrive-agents
```

npm workspaces + one `.sln` (npm, not pnpm: the overlay and edit already used npm). `npm run dev`
starts the replay harness and Electron in dev mode; `dotnet watch` on the host joins in Phase 2.

### The replay harness is the centrepiece

`npm run replay -- [<recording>] [--speed 2 --seek 00:14:20]` streams recorded frames onto
`localhost:8889` in the exact live contract. Recordings are captured from the live plugin with
`npm run record`; `.ibt` input arrives with the Phase 2 core. Consequences:

- **UI and design work needs no sim and no driving.** This alone is most of the velocity win.
- **Deterministic.** Frame 8,412 is always frame 8,412 → golden-frame screenshot tests.
- **Showcase mode goes away** — delete `prodrive-overlay-showcase` and `showcase-bootstrap.js`;
  with no audience to demo to, the harness covers everything they did.
- **`prodrive-designer` folds in** — its "composite the overlay over recorded race video with an
  element picker and Claude attached" idea becomes `npm run dev -- --composite <bundle>`.

`.ibt` playback is available off the shelf (`SVappsLAB.iRacingTelemetrySDK` supports IBT-file mode
with a speed multiplier; IRSDKSharper does its own record/playback), so the harness is days of work,
not weeks.

### Inner loop rules

- **No CI.** Everything runs locally in under 60 seconds. GitHub is source control and backup only.
- **Overlay dev mode**: normal window on the second monitor, not click-through, CSS hot reload,
  debug console (`debug-console.js` already exists) always on.
- **Golden-frame regression**: Playwright against the harness at fixed frames, visual diff. This is
  the replacement for "install and look at it", and it's better.
- **C# tests stay** — the ~147 NUnit tests carry over to `apps/core`; they get faster once the core
  isn't loaded inside SimHub.
- **Relax the worktree policy.** "All agent work must use `isolation: worktree`" made sense across
  16 repos on a Mac. On one rig with one app it's friction; keep worktrees for genuinely parallel
  agent work only.

### Build and run

`npm run build` on the rig produces `apps/overlay/dist/win-unpacked/Racing Desk.exe` with RacingDesk.Host
published inside it (`resources/host`); the SimHub plugin is built from `racing-desk.sln` and installed with
`apps/plugin/scripts/windows/install.bat` separately. The Start menu / Desktop shortcuts point at the exe.
No installer, no code signing, no GitHub Release, no version lockstep. "Shipping" is
`git pull && npm run build`.

---

## 8. Execution phases

Each phase ends in something runnable. Nothing is deleted until its replacement works.

**Phase 0 — Rig discovery spike.** *(Gate. **Done 2026-09-16** —
[findings](local-first-phase0-findings.md).)*
Inventory the actual machine. In priority order:

1. **Where does iRacing keep track map data locally, and is it machine-readable?** This decides
   whether the track API reads the sim's own data (preferred) or leans entirely on runtime
   recording. Blocks §3 and Phase 5.
2. Installed-content directory layout — confirms or replaces S1 (owned-content filtering).
3. `.ibt` naming, retention and rollover; how far back a typical rig's history actually goes.
4. Whether the new Fuel Calculator / Incident Tracker widgets expose anything to the SDK.
5. Whether iRacing's UI caches schedule data locally (would give a second schedule source).
6. SimHub-optional viability; current OAuth registration status.

**Done when:** a findings doc exists and questions 1 and 2 are answered on real hardware.

**Phase 1 — Monorepo + dev loop.** Consolidate repos, stand up `npm run dev`, build the replay harness,
add golden-frame tests. **No feature work.**
**Done when:** you can change a CSS value and see it on a replayed race in under 3 seconds, with no
sim running.

> **Status 2026-09-16 — monorepo done; replay loop parked.** The replay harness, overlay dev mode and golden
> frames below were built, then deferred to Phase 5 (design work) — no further investment until then.
> Details as built: Local monorepo at `Documents\GitHub\prodrive`
> (overlay, plugin, edit, agents imported with history). `packages/replay` records and replays the
> `:8889` payload (verified against live SimHub: all 328 keys match). Overlay dev mode hot-swaps CSS
> ~80 ms after save and redirects `:8889` to replay so SimHub can keep running. Golden frames run
> headless (Playwright Chromium, not Electron — no window on screen), pixel-exact across runs.
> **Missing:** a recording of an actual race or of SimHub demo mode — the rig's only recording is
> idle, and the golden frame uses a synthetic in-car payload until one exists. Not yet pushed to
> GitHub (needs a new `k10-motorsports/prodrive` repo).

**Phase 2 — Local data spine.** Multi-target core (`net48;net8.0-windows`), add the .NET 8 host, SQLite schema,
`.ibt` backfill ingest, session capture writing locally.
**Done when:** a full race is captured, stored and re-readable with the network cable unplugged.

> **Status 2026-09-17 — done.**
> - `apps/core/RacingDesk.Core` (net48 + net8.0-windows): engine, `RacingDeskRuntime` (per-frame orchestration, `:8889` /
>   `:8890`), `TelemetryCapture` over an `ITelemetrySource`, and `IRacing/` — live SDK and `.ibt` readers plus
>   `IRacingTelemetrySource`, which speaks SimHub's vocabulary so capture runs unchanged. The SimHub plugin is
>   a 242-line adapter.
> - `apps/host/RacingDesk.Host` (net8): serves the same contract without SimHub, live or from an `.ibt`. Contract
>   parity with the installed plugin is a test (keys match bar hardware and per-track sector keys).
> - `apps/core/RacingDesk.Data` (net8, host only): `%LOCALAPPDATA%\RacingDesk\racing-desk.db` — sessions, laps, incidents,
>   grids, track outlines. Full backfill of the rig: 3,031 files / 104.6 GB in ~110 s → 3,019 sessions (598 races),
>   6,808 laps, 68 track outlines; 3 truncated files skipped. Live capture uses the same accumulator and is
>   tested lap-for-lap against backfill of the same race.
> - Ingest pauses while iRacing runs and reads at background I/O priority.
>
> **Live parity check** (2026-09-17, a Nordschleife race, host beside SimHub, `npm run parity`): core telemetry,
> lap times, iRating/SR, car, session and leaderboard names agree. Four convention mismatches were found and
> fixed — SimHub's iRacing `TrackName` is the internal track name (which also fed the track map and sectors);
> normalized fuel and tyre temperatures follow display units (gallons, °F); tyre wear is percent remaining; the
> IRacingExtraProperties gap keys don't exist in a stock SimHub. Remaining differences are expected: engine
> history when the host starts mid-race (strategy, stint, start position, sector bests), commentary timing, SimHub
> button counters and hardware keys. Disk `.ibt` has no `CarIdx` arrays, so leaderboard, gaps and nearest-car
> are empty when replaying a file. The SimHub plugin build is not installed.

**Phase 3 — Cut the cord.** Port calc engines into Electron main. Stand up the schedule fetch. Delete
`calc-client.js`, `session-sync.js`, `IRacingDataClient.cs`, the entire track apparatus (§3), and
every cloud fetch in the overlay and plugin.
**Done when:** with the server switched off and the network cable unplugged, the rig reaches a
working HUD and a populated dashboard.

> **Status 2026-09-17 — done.**
> - Deleted: `IRacingDataClient.cs`, the week planner, the web track-map/sector/display-name fetches in core and
>   overlay, `calc-client.js`, `session-sync.js`, `token-loader.js`, accounts and the auto-updater. Track maps come
>   from the driver's own `.ibt` Lat/Lon; sectors from `SplitTimeInfo`.
> - **Deviation — engines run in the desk renderer, not Electron main, and read SQLite through the host.**
>   `RacingDesk.Host` serves the store read-only at `:8889/racing-desk/data/`; `packages/calc` (the 14 engines,
>   verbatim, 178 tests passing) is bundled into `desk.html`. No native Node module (better-sqlite3) to rebuild
>   against Electron. Cost: the desk needs the host running, not the SimHub plugin, on `:8889`.
> - The local model merges an event's stints (a tow or rejoin writes a new `.ibt`), and derives iRating/SR change
>   from the next session in the same licence category — estimates, since a race run with disk logging off would
>   be folded in. Over the rig's history: 371 official races, all with engine output in ~130 ms.
> - Ingest fixes found on the way: best lap no longer requires a clean lap; lap 1 of a race and laps of a
>   capture that starts mid-lap are timed from iRacing's own lap time. Races with no best lap: 270 of 589 stints
>   → 23 of 371 races, all broken up by tows.
> - Verified: desk over the real store (screenshots), and headless over a mock host with every off-machine
>   request blocked. Not yet verified: the Electron window itself with the network cable out.
> - **Schedule.** iRacing's published season PDF is read with PdfPig, parsed into the store (schema v3) and served
>   at `/data/schedule`; `packages/calc` turns it into what `next-race-ideas` wants. The live host refreshes it
>   daily, never while the sim runs. 2026 S4 parses to 151 series (every series its own contents pages list) and
>   1,989 series-weeks, each with a track, a race length and a start pattern — including the awkward shapes: dirt
>   heat racing (`H:8L C:10L F:50L`), endurance durations whose number and unit land on different lines, configs
>   that wrap, cars that rotate weekly, and 40-odd hand-written variants of "Races every 2 hours at :15 past".
>   Suggestions are filtered to the disciplines he races and the licence he holds; on the rig they read as
>   formula and sports-car races starting within the hour, with scores, lengths, cars and reasoning.
> - **Discovery caveat:** the PDF is not linked from iracing.com's season-page HTML (it sits on iRacing's forum
>   file host, and the forum needs a login to browse). The URL is a setting, and any PDF dropped into
>   `%LOCALAPPDATA%\RacingDesk\schedule\` is picked up — that is the manual override the plan called for.
> - Found while verifying the parse against the PDF series by series (a fan-out of checking agents): configs lost
>   to column wrapping, sim-time stamps missed when the conditions column pushed them along the line, and two
>   incident-rule wordings read wrong. All fixed, with the PDF-shaped fixture as a regression test.

**Phase 4 — Race Now.** Suggestion engine with S1–S7 and the designed explanation surface.
**Done when:** the verdict card is something you'd actually act on before your own race.

**Phase 5 — The differentiator push.** Track rendering v2 over locally-resolved geometry, the
rendering and information-design work this whole refactor exists to make room for, replay/debrief.
**Done when:** you'd rather race with it than with iRacing's own widgets.

**Phase 6 — Sunset.** Archive `prodrive-server` and take down Vercel, Neon and the marketing site.
Archive `prodrive-windows`, both showcase repos and the Chrome extension. Retire the six-repo
`release` skill and [`archive/release-pipeline.md`](archive/release-pipeline.md). Park the Apple clients with a note
explaining why.

---

## 9. Risks and open items

| Item | Assessment |
|---|---|
| **iRacing OAuth pause** | Not a blocker *by design* — nothing in this plan needs `/data`. If it reopens, official track assets and richer schedule data become optional upgrades. |
| **Track-asset redistribution** | **Resolved.** Nothing is distributed at all, and no SVGs are stored anywhere. The track API reads only what's already on the rig (§3). |
| **Local track data may not be machine-readable** | **Resolved (Phase 0).** The sim's map data *is* opaque, but `.ibt` `Lat`/`Lon` gives validated geometry for every layout the user has driven. Residual gap: a never-driven layout has no map until its first lap, via `TrackMapProvider.cs` dead reckoning. |
| **Cold start without `.ibt` history** | **Moot — single user (decided 2026-09-16).** The rig already has 11 months of history. The app checks `irsdkAutoLogDisk` at launch and offers to re-enable it. |
| **Schedule PDF parsing** | Source decided (§3). New risk: the PDF's layout can change between seasons and break the parser, and preliminary schedules get revised mid-season. Mitigated by keeping the last good parse, re-checking for revisions, and a manual override; the first parse of each season needs a look. |
| **iRacing shipping our features** | Already happened once (map/fuel/incidents). Assume it happens again. Use theirs where it's better; build ours where it isn't. |
| **Losing phone/TV/multi-device** | Real regression. iOS/macOS/tvOS die with the server API. LAN discovery to the rig can bring them back later; do not carry them through the refactor. |
| **Scope of the cut** | ~160k lines are being deleted or parked. The calc engines are ported, not lost — but this is still the single largest destructive change in the project's history. Phase order exists specifically so nothing is deleted before its replacement runs. |
| **Single-machine development** | No CI, one hardware configuration, no ARM64. Accepted — it's the only machine the app runs on. Push to GitHub regularly; it's the only backup. |

---

## Sources

- [iRacing 2026 Season 3 initial release notes](https://support.iracing.com/support/solutions/articles/31000179016-2026-season-3-initial-release-notes-2026-06-09-01-) — Track Map, Fuel Calculator, Incident Tracker widgets
- [iRacing 2026 Season 3 Patch 1](https://support.iracing.com/support/solutions/articles/31000179039-2026-season-3-patch-1-release-notes-2026-06-12-02-) — `[Misc] irsdkLogAllCars`
- [iRacing OAuth client registration](https://oauth.iracing.com/oauth2/book/client_registration.html) — client-ID creation paused; PKCE required for public clients
- [Enabling/Disabling Legacy Read Only Authentication](https://support.iracing.com/support/solutions/articles/31000173894-enabling-or-disabling-legacy-read-only-authentication) — retired with 2026 S1
- [iRacing OAuth Client Credentials](https://support.iracing.com/support/solutions/articles/31000177790-oauth-client-credentials)
- [iRacing 2026 Season 4](https://www.iracing.com/seasons/2026-s4/) — official season schedule PDF
- [SVappsLAB.iRacingTelemetrySDK](https://github.com/SVappsLAB/iRacingTelemetrySDK) · [IRSDKSharper](https://github.com/mherbold/IRSDKSharper) — `.ibt` playback for the replay harness
