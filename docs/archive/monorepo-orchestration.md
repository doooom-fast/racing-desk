# The Racing Desk — Monorepo Orchestration

> **Cross-repo context.** This doc covers contracts and conventions that span multiple repos in the The Racing Desk org. For day-to-day work in a single repo, prefer that repo's own context under [`../<repo-name>/CLAUDE.md`](..).

## Agent Work — Always Use Worktrees

All agent-spawned work MUST use `isolation: "worktree"`. Exceptions: read-only exploration, single non-code file writes.

## Repo Map

| Repo | Stack | Purpose | Per-repo context |
|------|-------|---------|------------------|
| [`prodrive-plugin`](https://github.com/DOOOOM/prodrive-plugin) | C# .NET 4.8, NUnit | SimHub plugin — reads iRacing SDK, exposes `localhost:8889`, fetches track config from server, pushes session data to cloud via Bearer auth | [agents/prodrive-plugin/CLAUDE.md](../prodrive-plugin/CLAUDE.md) |
| [`prodrive-overlay`](https://github.com/DOOOOM/prodrive-overlay) | Electron, vanilla JS, WebGL2, Canvas 2D, ffmpeg | In-game HUD — 51 modules: live widgets, recording (`.rcpdv` bundles), replay director, Race Coach (Anthropic Claude), voice commentary | [agents/prodrive-overlay/CLAUDE.md](../prodrive-overlay/CLAUDE.md) |
| [`prodrive-overlay-showcase`](https://github.com/DOOOOM/prodrive-overlay-showcase) | Same as overlay | Same code with `showcase-bootstrap.js` driving from synthesized data — used in marketing-site iframe | (consult overlay docs) |
| [`prodrive-server`](https://github.com/DOOOOM/prodrive-server) | Next.js 16, React 19, Tailwind 4, Drizzle, Neon Postgres, NextAuth (Discord), Vercel Blob | Marketing site, members dashboard at `/drive`, calc engines (web-api), Chrome extension at `apps/web/browser-extension/`, 65 API routes | [agents/prodrive-server/CLAUDE.md](../prodrive-server/CLAUDE.md) |
| [`prodrive-server-showcase`](https://github.com/DOOOOM/prodrive-server-showcase) | Same as server | Read-only public demo — `denyIfDemo()` removed from 3 write routes | (consult server docs) |
| [`prodrive-windows`](https://github.com/DOOOOM/prodrive-windows) | WinUI 3, .NET 8, Inno Setup, Zeroconf | Full desktop app — 9 pages (Login, Dashboard, Sessions, SessionDetail, Library, Editor, Settings × 5 tabs incl. Moza hardware), iRacing detector, overlay auto-launch, LAN sharing via Bonjour | [agents/prodrive-windows/CLAUDE.md](../prodrive-windows/CLAUDE.md) |
| [`prodrive-ios`](https://github.com/DOOOOM/prodrive-ios) | Pure SwiftUI (iOS 17+), Swift 5.9 | Universal iPhone + iPad app — Dashboard, Sessions, Tracks, Moments, Profile. **No React Native** ever shipped. **No watchOS** built yet (design doc only). | [agents/prodrive-ios/CLAUDE.md](../prodrive-ios/CLAUDE.md) |
| [`prodrive-macos`](https://github.com/DOOOOM/prodrive-macos) | SwiftUI + AppKit (macOS 14+), Swift 5.9 | Native desktop client — rail-nav UI, Dashboard + Sessions live (4 stub destinations), Library + Editor for clip prep | [agents/prodrive-macos/CLAUDE.md](../prodrive-macos/CLAUDE.md) |
| [`prodrive-tvos`](https://github.com/DOOOOM/prodrive-tvos) | Pure SwiftUI (tvOS 17+), Swift 5.9, SwiftDraw | Minimal 3-tab dashboard — device-link OAuth, animated DataStrip ticker | [agents/prodrive-tvos/CLAUDE.md](../prodrive-tvos/CLAUDE.md) |
| [`prodrive-homebridge`](https://github.com/DOOOOM/prodrive-homebridge) | TypeScript, Homebridge platform | HomeKit smart-light mapping — polls SimHub on **port 8888** (NOT 8889), three modes: `flags_only` / `events_only` / `all_colors` | [agents/prodrive-homebridge/CLAUDE.md](../prodrive-homebridge/CLAUDE.md) |
| [`prodrive-designer`](https://github.com/DOOOOM/prodrive-designer) | Electron, vanilla JS, Claude Agent SDK | Live prototyping shell — composites the overlay over recorded race video with telemetry replay + element picker + Claude attached. Phase 0 scaffold | [agents/prodrive-designer/CLAUDE.md](../prodrive-designer/CLAUDE.md) |
| [`prodrive-edit`](https://github.com/DOOOOM/prodrive-edit) | Node.js CLI, ffmpeg | AI-powered race editing pipeline — ingests `.mp4` + `.telemetry.jsonl` pairs, detects events, generates edit lists, assembles condensed video | [agents/prodrive-edit/CLAUDE.md](../prodrive-edit/CLAUDE.md) |
| [`prodrive-narrative`](https://github.com/DOOOOM/prodrive-narrative) | Markdown only | Internal strategic & design narrative — 5 threads: collaboration, differentiation, visual, technical, design-systems mirror | (read 00-README.md) |
| [`prodrive-telemetry`](https://github.com/DOOOOM/prodrive-telemetry) | Data corpus | Sample `.mp4` + `.telemetry.jsonl` race recordings used by designer + edit for testing | (no docs needed) |
| [`prodrive-support`](https://github.com/DOOOOM/prodrive-support) | Next.js 16, Fumadocs 16, Tailwind 4, Biome | User-facing help center at support.racing-desk.io | [agents/prodrive-support/CLAUDE.md](../prodrive-support/CLAUDE.md) |
| [`prodrive-agents`](https://github.com/DOOOOM/prodrive-agents) | Markdown | This repo — central agent instructions and skills | (you are here) |

## End-to-End Data Flow (Integration Contract)

The contract that ties the producers and their consumers together.

```
                         ┌─────────────────────────────────────────────┐
                         │  iRacing                                    │
                         │  ┌─────────────────┐    ┌────────────────┐ │
                         │  │ SDK shared mem  │    │ members-ng.    │ │
                         │  │ (live telemetry)│    │ iracing.com    │ │
                         │  └────────┬────────┘    │ (web profile)  │ │
                         │           │             └────────┬───────┘ │
                         └───────────┼──────────────────────┼─────────┘
                                     │                      │
                ┌────────────────────┘                      │
                ▼                                           │
   ┌──────────────────────────┐                             │
   │ prodrive-plugin (C#)     │                             │
   │ - reads SDK              │              ┌──────────────┴───────────────┐
   │ - normalizes ~100 props  │              │ Chrome extension              │
   │ - serves localhost:8889  │              │ (in prodrive-server/apps/web/ │
   │ - fetches /api/tracks    │              │  browser-extension/)          │
   │ - posts /api/iracing/    │              │ - scrapes profile + results   │
   │   import on session end  │              │ - posts /api/iracing/         │
   └────────┬─────────────────┘              │   extension-sync              │
            │                                └────────────────┬──────────────┘
   ┌────────┼────────────┬────────────────────┐               │
   │        │            │                    │               │
   ▼        ▼            ▼                    ▼               ▼
┌──────┐ ┌──────────┐ ┌─────────────┐  ┌──────────────────────────────────┐
│Over- │ │Pro Drive │ │Homebridge   │  │ prodrive-server                  │
│lay   │ │Windows   │ │(port 8888)  │  │ - Next.js 16 / React 19          │
│      │ │app       │ │             │  │ - Discord OAuth (NextAuth)       │
│Race  │ │          │ │HomeKit      │  │ - 65 API routes                  │
│Coach │ │auto-     │ │lights       │  │ - calc engines (web-api)         │
│→Claude│ │launches  │ │             │  │ - Vercel Blob telemetry storage  │
│API    │ │HUD       │ │             │  │ - Postgres (Neon)                │
└──────┘ └──────────┘ └─────────────┘  └────────────────┬─────────────────┘
                                                        │
                                                        │ /api/v1/*
                                  ┌─────────────────────┼──────────────┐
                                  ▼                     ▼              ▼
                            ┌──────────┐         ┌──────────┐   ┌──────────┐
                            │macOS app │         │iOS app   │   │tvOS app  │
                            │(Sessions,│         │(Dashboard│   │(Dashboard│
                            │ Library, │         │ Sessions,│   │ ticker)  │
                            │ Editor)  │         │ Tracks)  │   │          │
                            └──────────┘         └──────────┘   └──────────┘
```

The plugin is a **producer** of live telemetry.
The Chrome extension is a **producer** of post-race results / ratings.
prodrive-server is the **consumer hub** — collects from both producers, serves all native clients.

## Three iRacing data ingest paths

| Path | Source | Endpoint | Captures |
|------|--------|----------|----------|
| **A — Chrome extension** | Scrape members-ng.iracing.com | `POST /api/iracing/extension-sync` and `/api/iracing/upload` | iRating + ttRating history, license progression, race results, S3 result archive (intercepted) |
| **B — Plugin push** | Live SDK telemetry, packaged at session end | `POST /api/iracing/import` (Bearer-authed) | Per-frame telemetry traces, sectors, incidents, fuel/tyre state — stored in Vercel Blob |
| **C — Manual upload** | User pastes/drops JSON at racing-desk.io/drive/iracing | `POST /api/iracing/upload` | Same as A but via UI; multiple input shapes accepted |

All three land in the same Postgres tables and run the same import pipeline (track-name resolution, dedup by `subsession_id`, rating deltas, driver_ratings update, track auto-consolidation).

## Auth model

- **Web app** — NextAuth v5 + Discord provider, JWT sessions
- **Chrome extension** — reuses the racing-desk.io browser session (no separate auth)
- **Native apps + Windows desktop** — Discord PKCE OAuth via ASWebAuthenticationSession (Apple) or browser handoff (Windows). Token in Keychain / Credential Manager
- **tvOS** — device-link flow via `/api/plugin-auth/device/{start, poll, authorize}`. User enters 6-char code at racing-desk.io/link
- **SimHub plugin** — Bearer token issued via `/api/plugin-auth/{authorize, token}`. Stored in `%APPDATA%\RacingDesk\plugin\auth.json`. Refreshes automatically.

**No Stripe / no billing** today — there's no payment flow in the codebase yet. Whether Pro Drive is invite-gated, paid, or open is a product decision; this doc only documents what the code does.

## AI surfaces

| Surface | Where | Model | Funded by |
|---------|-------|-------|-----------|
| **Race Coach** | `prodrive-overlay/modules/js/race-coach.js` — direct from machine | Haiku 4.5 (default) / Sonnet 4.6 | User's own Anthropic API key |
| **Race summary** | `prodrive-server` `/api/v1/calc/race-summary` — server-side | Sonnet 4.6 (default) | Pro Drive (free during beta) |
| **prodrive-edit** | CLI tool — uses Claude for edit decisions | Configurable | Operator (BYO key) |
| **prodrive-designer** | Claude Agent SDK integrated for UI iteration | Configurable | Operator (BYO key) |

Race Coach uses BYO key because long races burn enough tokens that proxying would warp Pro Drive's pricing. The server-side summary is funded because every imported race gets one automatically.

## Cross-repo seams

### 1. Plugin → server: track config + session push

- `GET https://prodrive.racing-desk.io/api/tracks?trackName=...` — plugin fetches sector boundaries on track change. Cached in-memory until track changes again.
- `POST https://prodrive.racing-desk.io/api/iracing/import` — plugin packages session telemetry on session end and pushes via Bearer auth.

Auth via `/api/plugin-auth/{authorize, token}` flow.

### 2. Chrome extension → server

Lives in `prodrive-server/apps/web/browser-extension/`. Manifest V3. Hosts: `https://members-ng.iracing.com/*`, `https://prodrive.racing-desk.io/*`, plus localhost / dev for development.

Two POST endpoints:

- `/api/iracing/extension-sync` — DOM-scraped data (rating history, career stats)
- `/api/iracing/upload` — full result archive data (intercepted from iRacing's S3 fetches)

CORS allows `chrome-extension://` origin with credentials.

### 3. Design tokens (server → overlay → native apps)

Token definitions and the Style Dictionary pipeline live in `prodrive-server/apps/web/src/lib/tokens/`. The overlay consumes via `token-loader.js`. Native apps consume via `/api/v1/tokens/native?format=swift`.

Publishing mechanism still ad-hoc — manual sync today, npm package planned.

### 4. Demo page generation (overlay → server)

The server's marketing site embeds a live overlay demo. Build script `scripts/build-web-demo.mjs` in prodrive-server expects `RACECOR_OVERLAY_PATH` env var or sibling `../prodrive-overlay/`. The `prodrive-overlay-showcase` repo is the dedicated source for this.

### 5. Combined Windows installer (overlay → windows)

`prodrive-windows` bundles its WinUI 3 desktop app + the **overlay only** (NOT the SimHub plugin). The plugin is a separate install.

Build wiring: `installer/build.ps1` defaults `$OverlayRepo` to `../../prodrive-overlay/`.

### 6. Native apps API contract (server → ios / macos / tvos / windows)

Native apps consume two API surfaces from prodrive-server:

- **Per-screen REST** (`prodrive.racing-desk.io/api/v1/*`, Bearer-authed GET) — server aggregates and runs calc internally; one call per screen.
- **Calc engines** (`api.prodrive.racing-desk.io/api/v1/calc/*`, POST) — Phase 9 layer; escape hatch for what-if flows.

Reference docs:

- [`native-apps-api-contract.md`](native-apps-api-contract.md) — per-screen REST surface
- [`native-apps-calc-integration.md`](native-apps-calc-integration.md) — calc API + division of labor
- [`native-apps-plan.md`](native-apps-plan.md) — high-level rollout plan

### 7. Race bundles (`.rcpdv`) — overlay producer, multi-consumer

Format: folder containing `video.mp4` + `telemetry.jsonl` + `metadata.json`. Produced by `prodrive-overlay/modules/js/recorder.js`. Consumed by:

- `prodrive-windows` Library + Editor pages (via `BundleReader`)
- `prodrive-macos` Library + Editor (basic playback live, deeper editing in development)
- `prodrive-edit` CLI (for AI-driven highlight reels)

Schema documented in [`telemetry-sidecar-schema.md`](telemetry-sidecar-schema.md).

### 8. LAN sharing (windows ↔ windows / macos)

`prodrive-windows` advertises bundles over mDNS/Bonjour as `prodrive-share._tcp` (Zeroconf NuGet). Other Pro Drive desktop apps on the same LAN can discover and pull. Doesn't work over VPN by default.

### 9. Support site — public consumer of all the above

`prodrive-support` (Fumadocs at support.racing-desk.io) is the user-facing help center. Content under `content/docs/` mirrors the ecosystem layout one-to-one. Updates triggered by the `support-app-coverage` skill when features ship across the producer / consumer repos.

## iRacing Web Scraping — HARD CONSTRAINTS

The iRacing member site is an Angular SSR app. **No data API calls work from an embedded Electron BrowserWindow.** Tested extensively:

- `/data/` API endpoints require separate OAuth auth that the embedded browser does not have
- `/bff/pub/proxy/api/` BFF proxy endpoints return OAuth session metadata, NOT member/racing data
- `fetchBff`, `fetchIRacingEndpoint`, `fetchDirectData`, `fetchViaWebContents` — all fail for chart/member data
- The only working approach is **DOM scraping of server-rendered pages**

To get historical iRating data:

1. Navigate the BrowserWindow to the page that renders the iRating chart
2. Wait for Angular SSR to render the chart into the DOM
3. Scrape data points from the rendered SVG/Canvas chart elements
4. Navigate back to the dashboard afterward

**Do not attempt API/BFF calls for iRating history. They do not work. Period.**

The Chrome extension takes a different approach — it intercepts iRacing's *own* fetches to its S3 result archive via a content script, which works because those fetches happen with the user's existing iRacing session. That's how `/api/iracing/upload` gets full per-race detail. See `prodrive-server/apps/web/browser-extension/content.js`.

## Release orchestration

Six repos ship in lockstep at the same `vX.Y.Z`: `plugin`, `overlay`, `windows`, `macos`, `ios`, `tvos`. The orchestrator slash command lives at `.claude/commands/release.md` in this repo. Wave 1 = plugin + overlay (parallel). Wave 2 = windows + macos + ios + tvos (parallel, depends on Wave 1 GitHub releases).

`server`, `homebridge`, `agents`, `support`, `edit`, `designer`, `narrative`, `telemetry` ship on independent cadences.

See `feedback_release_versioning.md` and `project_release_orchestration.md` in user memory for details.
