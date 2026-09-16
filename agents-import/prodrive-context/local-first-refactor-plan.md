# Local-First Refactor Plan — Pro Drive on the Rig

> **Status:** proposal, not yet executed. Supersedes the cloud-hub assumptions in
> [`monorepo-orchestration.md`](monorepo-orchestration.md),
> [`native-apps-api-contract.md`](native-apps-api-contract.md), and
> [`native-apps-calc-integration.md`](native-apps-calc-integration.md) if adopted.
>
> **Author's premise (stated up front so it can be argued with):** nobody wants to upload their
> iRacing career into a new account-gated service. The account *is* the friction. Everything the
> cloud does for us today can be done on the rig, and the two things the cloud actually buys us —
> content assets and the series schedule — do not need a login.

---

## 1. The bet

**Move the product onto the rig. Keep the cloud as a static, anonymous file host.**

Three things changed that make this the right time:

1. **iRacing shipped Track Map, Fuel Calculator and Incident Tracker widgets in 2026 Season 3.**
   Three of our HUD features are now table stakes inside the sim. Feature parity is no longer a
   position. Rendering quality, information design, and integration are.
2. **iRacing retired legacy read-only auth (2026 S1, Dec 9 2025) and has *paused* OAuth client-ID
   creation** while it evaluates third-party API/SDK usage. Our `IRacingDataClient.cs`
   credential-login path is dead, and we cannot currently register a replacement. A cloud hub whose
   ingest depends on iRacing web auth is building on sand. A local-first product that reads the SDK
   and the user's own `.ibt` files is not affected at all.
3. **Telemetry logging can now cover the whole field** (`[Misc] irsdkLogAllCars=1`, 2026 S3 Patch 1).
   The local corpus just got dramatically richer than anything we can scrape from the website.

The result is a system where the *entire* value loop — capture, analyse, suggest, render, record —
happens on one machine, with no account, no upload, and no network dependency at race time.

### What the cloud is reduced to

| Today | After |
|---|---|
| Neon Postgres, 23 tables, per-user data | *(gone)* |
| NextAuth + Discord OAuth | *(gone)* |
| 83 API routes | *(gone)* |
| Vercel Blob telemetry storage | *(gone)* |
| Stored track maps + SVGs, alias/resolution tooling, 13 track routes | *(gone — track data is read locally, never stored, never shipped; §3)* |
| Calc engines on `api.prodrive.racecor.io` | Ported into the Electron main process |
| Chrome extension scraping members-ng | *(gone — auth path is retired anyway)* |
| Marketing site | Static site, unchanged in spirit |
| — | **Content packs**: versioned static files on GitHub Releases, fetched anonymously |

No login. No PII. No database. The only outbound request the app ever makes is
`GET .../releases/latest/download/index.json`, and it works fine when that fails.

---

## 2. What iRacing gives us now (and what it took away)

### Gives

| Capability | Where it lands for us |
|---|---|
| Track Map / Fuel Calculator / Incident Tracker widgets (2026 S3) | We stop competing on *existence* of these and compete on *rendering*. Our fuel model stays, but it earns its place by being predictive and strategic, not by being a number on screen. |
| `irsdkLogAllCars=1` — full-field arrays in `.ibt` | Local field-strength and relative-pace analysis without any API. Feeds the suggestion engine (§6). |
| Session-info YAML: `SplitTimeInfo` sectors, `DriverInfo` iRating/SR/licence, full grid with every opponent's iRating, incident limits | **Replaces four server features outright**: track sector-boundary storage, iRating/SR fetch, driver-rating tables, and incident-limit config. We already parse most of this in `IRacingSdkBridge.cs` — it just isn't the source of truth yet. |
| `.ibt` files in `Documents\iRacing\telemetry\` | Cold-start history. On first run we can backfill months of racing the user already has on disk — something the cloud version could never do. |
| Installed content on disk (`<install>\tracks\`, `\cars\`) | Ground truth for what the user *owns*. Suggestions that never recommend content you'd have to buy. **Verify layout on the rig — Phase 0.** |
| Track data already on the user's machine — the sim's own map data plus live SDK world position | **The only track-geometry source.** We store none of it and ship none of it (§3). Deletes the entire server-side track apparatus. |

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
│              │  RaceCor.Core  (netstandard2.0)              │          │
│              │  · IRSDKSharper live reader                   │          │
│              │  · session YAML → sectors, ratings, grid      │          │
│              │  · fuel / incident / commentary engines       │          │
│              │  · Moza serial                                │          │
│              │  · .ibt ingest (backfill + post-session)      │          │
│              │  · SQLite writer                              │          │
│              └───────┬──────────────────────────┬────────────┘          │
│                      │ hosted by                │ hosted by             │
│         ┌────────────▼───────────┐   ┌──────────▼──────────────┐        │
│         │ RaceCor.Host.exe (.NET8)│   │ SimHub plugin (net48)   │        │
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
│  %LOCALAPPDATA%\RaceCor\  prodrive.db · telemetry\ · bundles\ · packs\  │
└────────────────────────────────────┼───────────────────────────────────┘
                                     │ anonymous, cache-first, optional
                          GitHub Releases: content packs
```

### Two processes, not five

- **`RaceCor.Core`** — the existing plugin engine, retargeted to **netstandard2.0** so the same
  assembly loads into both SimHub's .NET Framework 4.8 host *and* a .NET 8 standalone host. This is
  the key structural change in the C# side and should be done first; everything else follows.
- **`Pro Drive` (Electron)** — the existing overlay, plus a second `BrowserWindow` that is the
  desktop app. **This deletes `prodrive-windows` entirely** (67k lines of WinUI 3) and with it the
  9-page WinUI app, the Discord PKCE flow, and the second design-system implementation.

### SimHub becomes optional, not required

Today SimHub is a hard prerequisite: our plugin only runs inside it. But `IRacingSdkBridge.cs`
already reads the SDK directly via IRSDKSharper — SimHub is largely a *host*, not a data source.
Making the standalone host the default removes an install step and a support surface, while keeping
the SimHub plugin for people who want SimHub dashes, Arduino output, or LED devices.

> Keep the `localhost:8889` JSON contract byte-identical through this change. It is the seam that
> lets us move the host without touching the overlay, Homebridge, or anyone's third-party tooling.

### Local storage

| Path | Contents |
|---|---|
| `%LOCALAPPDATA%\RaceCor\prodrive.db` | SQLite — sessions, laps, sectors, incidents, ratings, opponents/grids, mastery, suggestion cache |
| `%LOCALAPPDATA%\RaceCor\telemetry\<sessionId>.jsonl.zst` | Per-frame traces (same schema as [`telemetry-sidecar-schema.md`](telemetry-sidecar-schema.md)) |
| `%LOCALAPPDATA%\RaceCor\bundles\` | `.rcpdv` race bundles (unchanged) |
| `%LOCALAPPDATA%\RaceCor\packs\` | Downloaded content packs + the baseline shipped in the installer |

SQLite via `Microsoft.Data.Sqlite` (writer, C#) and `better-sqlite3` (reader, Electron). Single
writer, many readers, WAL mode. The existing Drizzle schema maps over almost one-to-one minus the
user/auth/token tables.

### Content packs — the cloud that doesn't need an account

Published as GitHub Release assets on a new `k10-motorsports/prodrive-packs` repo. Anonymous HTTPS,
cache-first, baseline copy shipped in the installer so a rig with no network still works.

| Pack | Cadence | Contents |
|---|---|---|
| `schedule-<season>-w<NN>` | weekly | Series schedule — the input `next-race-ideas` already expects |
| `tokens-<ver>` | on change | Design tokens (replaces `/api/v1/tokens/native` and `token-loader.js`'s live fetch) |
| `commentary-<ver>` | on change | The 240+ pre-generated fragments |

**No track pack. No car pack. We ship none of iRacing's data, in any form.** Everything about a
track or a car is resolved on the user's machine from data iRacing already put there. The packs
carry only things we authored: our schedule build, our design tokens, our commentary fragments.

### Track data: iRacing's local data only

**The track API reads iRacing's own local data and nothing else. We store zero SVGs — not on a
server, not in a pack, not in the installer.**

Two local sources, in order of preference:

1. **iRacing's own map data on disk.** The sim ships a Track Map widget as of 2026 S3, so the
   geometry for every track the user owns is already on their machine, under a licence they already
   hold. Read it in place. **Exact location and format is a Phase 0 question** — this is the single
   highest-value item in the discovery spike.
2. **Live SDK world position.** `TrackMapProvider.cs` already records an outline from world X/Z +
   `LapDistPct` and normalises it to a 0–100 viewBox. It works today and needs no permission from
   anyone: it is generated at runtime, on the user's machine, from the session they are driving.

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
> iRacing's data, so they're a separate call — keep them in a pack or drop them, but don't let them
> ride along under this decision.

**Schedule pack: fix the fragile bit.** Today `iracing-schedule-fetcher.ts` scrapes a third-party
React SPA's webpack bundle (`iracing-week-planner.tmo.lol`) for season data. That is one bundle-hash
change away from breaking, and it currently breaks *the server for every user at once*. As a weekly
pack build it breaks for nobody until we publish, with a manual fallback and a checked-in previous
week. Same fragility, vastly smaller blast radius.

---

## 4. The pare-down ledger

Current system, measured:

| Repo | Files | Lines | Disposition |
|---|---:|---:|---|
| `prodrive-server` | 472 | 94,743 | **Reduce to a static marketing site.** Delete 83 API routes, 23 tables, NextAuth, Drizzle/Neon, Vercel Blob, 8 admin pages, the Chrome extension, and the entire track apparatus (§3 — 2,314 lines and 3 tables on its own). Port the ~7k lines of calc engines into Electron. |
| `prodrive-windows` | 160 | 66,960 | **Delete.** Absorb the Moza settings UI + installer into the Electron app / one Inno script. |
| `prodrive-plugin` | 190 | 31,756 C# | **Keep and restructure.** Split core → netstandard2.0; delete `IRacingDataClient.cs` (dead) and all cloud push/fetch; add SQLite writer + `.ibt` ingest. |
| `prodrive-overlay` | 279 | 52,477 | **Keep almost entirely.** Delete `calc-client.js`, `session-sync.js`; repoint `token-loader.js`, `car-logos.js`, `pit-wall-chip.js`, `poll-engine.js` at local + packs. Add desk window. |
| `prodrive-agents` | — | — | Fold into the monorepo as `.claude/` + `docs/`. |
| `prodrive-*-showcase` ×2 | — | — | **Delete.** Showcase becomes a run mode of the replay harness (§7). |
| `prodrive-ios` / `macos` / `tvos` | — | — | **Park.** They exist only to consume the server API. Revive later as LAN clients to the rig if there's demand. |
| `prodrive-designer` / `prodrive-edit` | — | — | **Absorb.** Designer becomes the overlay's dev mode; edit becomes a workspace in the monorepo. |
| `prodrive-homebridge` | — | — | Keep as-is. It polls SimHub:8888 and is unaffected. |

**16 repos → 3:** `prodrive` (monorepo), `prodrive-packs` (static content), `racecor-site` (marketing).
**Six-repo lockstep release → one version, one installer, one GitHub Release.**

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

## 5. Positioning: what we are, next to Garage 61

Garage 61 is cloud telemetry analysis with a community lap database and setup sharing, a background
agent that uploads `.ibt` and syncs ghost laps, and a Pro tier around $6.50/mo. Their moat is
**aggregate community data**. We will not beat that, and we should stop trying.

Their product is *after* the race, in a browser tab, on someone else's server. Ours is *during* the
race, on the rig, rendered properly. Different jobs.

| | Garage 61 | Pro Drive (target) |
|---|---|---|
| Where the value lands | Browser, post-session | In-car, live + on-rig debrief |
| Data location | Their cloud | Your disk. Nothing leaves, and nothing of iRacing's is redistributed to you either. |
| Account | Required | **None** |
| Works offline | No | Yes |
| Moat | Community lap corpus | Rendering, information design, opinion |
| Setups | Yes | No — not our fight |
| Lap-vs-lap comparison depth | Excellent | Adequate, and honest about it |

**Our four differentiators, in priority order:**

1. **Rendering.** The WebGL2 pipeline, 30fps+, real motion design. Nobody in this space treats a HUD
   as a designed object. This is the whole pitch and it should get the most engineering time.
2. **Information design.** What to show, when, at what density, with what typography. iRacing's own
   new widgets are functional and ugly; that gap is the product.
3. **Racing opinions as defaults.** The app should have a point of view about what matters in a
   stint and behave accordingly, rather than exposing 200 toggles.
4. **Suggestions that are actually tightly integrated** (§6) — because they read your telemetry, not
   your results page.

Plus one that only exists because of this refactor: **no account, no upload, works offline.** For a
meaningful slice of sim racers that is not a feature, it's a precondition.

*Interop note:* the Garage 61 agent syncs ghost laps into the iRacing folders. Reading those if
present is cheap and friendly. Not a competitor to fight — a neighbour.

---

## 6. Race Now — suggestions without a login

The existing `next-race-ideas.ts` scores on: track familiarity, track incident rate, car
familiarity, car performance, time of day, day of week, rating trend, licence level. All eight are
computable from local history. The interesting question is what we can do *locally* that a
cloud service can't — and there's more than expected.

### Local-only signals, ranked by value × feasibility

**S1 — Owned-content filter.** Enumerate installed tracks and cars from the iRacing install
directory. Never suggest a race the user would have to buy into. Cloud tools need
`/data/member/info` and OAuth for this; we need a directory listing. *(Verify on rig — Phase 0.)*

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
**EV per hour of your time**, using `sessionMinutes` and `raceTimeLimit`/`raceLapLimit` which the
schedule pack already carries. This is the number the whole feature should be built around.

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

**S10 — Opt-in anonymous pack (later, maybe never).** Hashed aggregate SoF observations contributed
back to improve S2 for new users. Explicitly optional, no account, no identifiers. Only build this
if cold-start proves painful in practice.

### Cold start

Honest answer: S1 and the schedule pack work on install. S2–S6 need history. Two mitigations:
**backfill every `.ibt` on disk at first run** (most users have months of them), and ship a generic
prior in the tracks pack so day-one suggestions are reasonable rather than empty. Personalisation
should visibly ramp over ~2 weeks — and *showing* that ramp is a nice piece of design work rather
than a thing to hide.

### The surface

One verdict card — *"Race Now: GT4 at Oulton, 18 minutes, +14 iR expected, your incident risk here
is below your average"* — with the ranked alternatives behind it, and the score breakdown rendered
as a designed explanation rather than a table of eight numbers. If our differentiator is
visualisation, the recommender's *reasoning* is the best possible showcase for it.

---

## 7. The rig as the dev environment

The current loop is: edit on Mac → push → GitHub Actions → Vercel deploy → build installer →
install on rig → launch iRacing → drive → observe. That's the actual thing killing velocity, more
than any architectural problem.

Target loop: **edit on the rig → hot reload → replayed telemetry drives the UI → observe. No sim, no
driving, no install, no network.**

### Rig setup (one-time)

```
git, Node 22, .NET 8 SDK, VS Build Tools 2022 (C++ + .NET desktop),
Inno Setup 6, Claude Code (native Windows — needs PowerShell, dotnet,
and Documents\iRacing access)
C:\dev\prodrive   ← single monorepo
```

Native Windows Claude Code, not WSL — the agent needs to build .NET, launch Electron, read
`Documents\iRacing\telemetry`, and enumerate the iRacing install.

### Monorepo layout

```
prodrive/
  apps/
    overlay/          ← ex-prodrive-overlay (Electron: overlay + desk windows)
    core/             ← ex-plugin engine, netstandard2.0
    host/             ← .NET 8 standalone host
    simhub-plugin/    ← net48 shim, optional
    edit/             ← ex-prodrive-edit
  packages/
    calc/             ← ported TS calc engines
    tokens/           ← Style Dictionary source
    replay/           ← the replay harness
  packs/              ← pack build scripts
  installer/          ← one Inno script
  site/               ← static marketing (or its own repo)
  .claude/            ← ex-prodrive-agents
```

pnpm workspaces + one `.sln`. `pnpm dev` starts: `dotnet watch` on the host, Electron with reload,
and the replay harness if iRacing isn't running.

### The replay harness is the centrepiece

`pnpm replay <bundle|ibt> [--speed 2 --seek 00:14:20]` streams recorded frames onto
`localhost:8889` in the exact live contract. Consequences:

- **UI and design work needs no sim and no driving.** This alone is most of the velocity win.
- **Deterministic.** Frame 8,412 is always frame 8,412 → golden-frame screenshot tests.
- **The showcase mode falls out for free** — delete `prodrive-overlay-showcase` and
  `showcase-bootstrap.js`; the marketing demo is the harness with a curated bundle.
- **`prodrive-designer` folds in** — its "composite the overlay over recorded race video with an
  element picker and Claude attached" idea becomes `pnpm dev --composite <bundle>`.

`.ibt` playback is available off the shelf (`SVappsLAB.iRacingTelemetrySDK` supports IBT-file mode
with a speed multiplier; IRSDKSharper does its own record/playback), so the harness is days of work,
not weeks.

### Inner loop rules

- **No CI in the inner loop.** GitHub Actions runs on tag only: build installer, publish release,
  publish packs. Everything else runs locally in under 60 seconds.
- **Overlay dev mode**: normal window on the second monitor, not click-through, CSS hot reload,
  debug console (`debug-console.js` already exists) always on.
- **Golden-frame regression**: Playwright against the harness at fixed frames, visual diff. This is
  the replacement for "install and look at it", and it's better.
- **C# tests stay** — the ~147 NUnit tests carry over to `apps/core`; they get faster once the core
  isn't loaded inside SimHub.
- **Relax the worktree policy.** "All agent work must use `isolation: worktree`" made sense across
  16 repos on a Mac. On one rig with one app it's friction; keep worktrees for genuinely parallel
  agent work only.

### Release

Local build → `installer/build.ps1` produces one signed installer containing the Electron app, the
standalone host, the optional SimHub plugin, and the baseline packs. Tag → Actions attaches it to a
GitHub Release. One version number. No Vercel in the path.

---

## 8. Execution phases

Each phase ends in something runnable. Nothing is deleted until its replacement works.

**Phase 0 — Rig discovery spike.** *(Gate. Do not skip.)*
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

**Phase 1 — Monorepo + dev loop.** Consolidate repos, stand up `pnpm dev`, build the replay harness,
add golden-frame tests. **No feature work.**
**Done when:** you can change a CSS value and see it on a replayed race in under 3 seconds, with no
sim running.

**Phase 2 — Local data spine.** Split core to netstandard2.0, add the .NET 8 host, SQLite schema,
`.ibt` backfill ingest, session capture writing locally.
**Done when:** a full race is captured, stored and re-readable with the network cable unplugged.

**Phase 3 — Cut the cord.** Port calc engines into Electron main. Publish packs v1. Delete
`calc-client.js`, `session-sync.js`, `IRacingDataClient.cs`, the entire track apparatus (§3), and
every cloud fetch in the overlay and plugin. Build the first fully offline installer.
**Done when:** a clean Windows install with no account and no network reaches a working HUD and a
populated dashboard.

**Phase 4 — Race Now.** Suggestion engine with S1–S7 and the designed explanation surface.
**Done when:** the verdict card is something you'd actually act on before your own race.

**Phase 5 — The differentiator push.** Track rendering v2 over locally-resolved geometry, the
rendering and information-design work this whole refactor exists to make room for, replay/debrief.
**Done when:** screenshots sell the product without a paragraph of explanation.

**Phase 6 — Sunset.** Server reduced to static marketing. Archive `prodrive-windows`,
both showcase repos, and the Chrome extension. Park the Apple clients with a note explaining why.

---

## 9. Risks and open items

| Item | Assessment |
|---|---|
| **iRacing OAuth pause** | Not a blocker *by design* — nothing in this plan needs `/data`. If it reopens, official track assets and richer schedule data become optional upgrades. |
| **Track-asset redistribution** | **Resolved by decision, not mitigation.** We ship none of iRacing's data — no SVGs stored anywhere, no track pack, no car pack. The track API reads only what's already on the user's machine (§3). This removes the legal question entirely rather than answering it. |
| **Local track data may not be machine-readable** | The cost of the above. If iRacing's on-disk map data turns out to be an opaque format, the fallback is runtime recording via `TrackMapProvider.cs` — which works today but means the map is absent for the first lap at an unseen track, and quality depends on the recording lap. Phase 0 question #1; worth a real look before committing Phase 5's scope. |
| **Schedule mirror fragility** | Still depends on a third-party SPA bundle. Mitigated (weekly pack build, checked-in fallback, manual override) but not eliminated. Worth building a second independent source. |
| **iRacing shipping our features** | Already happened once (map/fuel/incidents). Assume it happens again. The defence is that they will not out-design us, and they have no interest in personalised race selection. |
| **Losing phone/TV/multi-device** | Real regression. iOS/macOS/tvOS die with the server API. LAN discovery to the rig can bring them back later; do not carry them through the refactor. |
| **Losing all telemetry about our own users** | Local-only means no analytics, no remote debugging, no error reporting. Accept it deliberately, and invest in a good local diagnostics bundle the user can send manually. |
| **Losing the account as a retention/distribution mechanism** | The Discord-gated account is currently *also* the funnel and the licence check. Removing it needs a deliberate answer for both — probably: Discord stays as community, licensing (if ever) becomes an offline key. Not solved here. |
| **Scope of the cut** | ~160k lines are being deleted or parked. The calc engines are ported, not lost — but this is still the single largest destructive change in the project's history. Phase order exists specifically so nothing is deleted before its replacement runs. |
| **Single-machine development** | No CI safety net during the inner loop, one hardware configuration, no ARM64 validation. Keep tagged Actions builds for release artefacts, and test ARM64 at release time only. |

---

## Sources

- [iRacing 2026 Season 3 initial release notes](https://support.iracing.com/support/solutions/articles/31000179016-2026-season-3-initial-release-notes-2026-06-09-01-) — Track Map, Fuel Calculator, Incident Tracker widgets
- [iRacing 2026 Season 3 Patch 1](https://support.iracing.com/support/solutions/articles/31000179039-2026-season-3-patch-1-release-notes-2026-06-12-02-) — `[Misc] irsdkLogAllCars`
- [iRacing OAuth client registration](https://oauth.iracing.com/oauth2/book/client_registration.html) — client-ID creation paused; PKCE required for public clients
- [Enabling/Disabling Legacy Read Only Authentication](https://support.iracing.com/support/solutions/articles/31000173894-enabling-or-disabling-legacy-read-only-authentication) — retired with 2026 S1
- [iRacing OAuth Client Credentials](https://support.iracing.com/support/solutions/articles/31000177790-oauth-client-credentials)
- [Garage 61 agent docs](https://garage61.net/docs/usage/agent) · [Coach Dave Delta vs Garage 61](https://coachdaveacademy.com/tutorials/coach-dave-delta-vs-garage-61-which-is-best-for-you/) — feature set and pricing
- [SVappsLAB.iRacingTelemetrySDK](https://github.com/SVappsLAB/iRacingTelemetrySDK) · [IRSDKSharper](https://github.com/mherbold/IRSDKSharper) — `.ibt` playback for the replay harness
