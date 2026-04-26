# K10 Motorsports — Monorepo Orchestration

> **Cross-repo context.** This doc covers contracts and conventions that span multiple repos in the K10 Motorsports org. Originally lived at the root of [`prodrive-plugin`](../prodrive-plugin/CLAUDE.md) (back when the plugin and overlay were one monorepo); promoted here when the overlay was extracted to its own repo.
>
> For day-to-day work in a single repo, prefer that repo's own context under [`../<repo-name>/CLAUDE.md`](..).

## Agent Work — Always Use Worktrees

All agent-spawned work MUST use `isolation: "worktree"`. Exceptions: read-only exploration, single non-code file writes.

## Repo Map

| Repo | Stack | Purpose | Per-repo context |
|------|-------|---------|------------------|
| [`prodrive-plugin`](https://github.com/k10-motorsports/prodrive-plugin) | C# .NET 4.8, TypeScript, NUnit, Jest | SimHub plugin + Homebridge plugin (the producer) | [agents/prodrive-plugin/CLAUDE.md](../prodrive-plugin/CLAUDE.md) |
| [`prodrive-overlay`](https://github.com/k10-motorsports/prodrive-overlay) | Electron, vanilla JS, WebGL2, Canvas 2D | Overlay HUD (30fps polling) — the consumer | [agents/prodrive-overlay/CLAUDE.md](../prodrive-overlay/CLAUDE.md) |
| [`prodrive-server`](https://github.com/k10-motorsports/prodrive-server) | Next.js, Drizzle, Postgres | Marketing site, Pro Drive admin, telemetry mock, shared React lib | [agents/prodrive-server/CLAUDE.md](../prodrive-server/CLAUDE.md) |
| [`prodrive-windows`](https://github.com/k10-motorsports/prodrive-windows) | WinUI 3, .NET 8, Inno Setup | Windows host app + combined installer | [agents/prodrive-windows/CLAUDE.md](../prodrive-windows/CLAUDE.md) |
| [`prodrive-ios`](https://github.com/k10-motorsports/prodrive-ios) | Swift / SwiftUI / RN | iOS native + RN apps | [agents/prodrive-ios/CLAUDE.md](../prodrive-ios/CLAUDE.md) |
| [`prodrive-macos`](https://github.com/k10-motorsports/prodrive-macos) | Swift / SwiftUI | macOS native app | [agents/prodrive-macos/CLAUDE.md](../prodrive-macos/CLAUDE.md) |
| [`prodrive-tvos`](https://github.com/k10-motorsports/prodrive-tvos) | Swift / SwiftUI | tvOS native app | [agents/prodrive-tvos/](../prodrive-tvos/) |
| [`prodrive-agents`](https://github.com/k10-motorsports/prodrive-agents) | Markdown | This repo — central agent instructions and skills | (you are here) |

## End-to-End Data Flow (Integration Contract)

The contract that ties the plugin and its consumers together. Changes to the JSON shape must be coordinated across all consumers.

```
iRacing SDK
  → C# TelemetrySnapshot (prodrive-plugin/racecor-plugin/simhub-plugin/)
  → cross-game normalization
  → 33+ commentary triggers
  → strategy modules (tire/fuel/pit/opponent/position)
  → HTTP API on port 8889: GET http://localhost:8889/racecor-io-pro-drive/
    → flat JSON object with 100+ properties (telemetry, commentary, strategy)
  → Consumers (any of the below — same contract, different renderers):
    ├─ Electron overlay polls at ~30fps (prodrive-overlay/, transitional)
    │  └─ WebGL2 + Canvas 2D rendering
    ├─ Windows native app (prodrive-windows/, target replacement for overlay)
    ├─ macOS / iOS / tvOS native apps when paired with a gaming PC on the LAN
    └─ Homebridge plugin subscribes for light color mapping (prodrive-homebridge/)
```

The plugin is the **producer**. The overlay is the **current consumer**; the four native apps inherit that role as they reach feature parity. The HTTP JSON API on port 8889 is the **contract** — stable across the consumer change.

**The plugin never calls web-api.** Its role ends at "produce JSON on port 8889." Anything that wants derived analytics (Driver DNA, Mastery, NRI, etc.) is a consumer, fetches its own user token, and calls `/api/v1/calc/*` directly. See [`native-apps-calc-integration.md`](native-apps-calc-integration.md) for that surface.

## Cross-repo seams

### 1. Design tokens (server → overlay)

Token definitions and the Style Dictionary pipeline live in [`prodrive-server`](https://github.com/k10-motorsports/prodrive-server) (`apps/web/src/lib/tokens/build.ts`). The overlay consumes these tokens as CSS custom properties in `prodrive-overlay/modules/styles/`.

**Open question:** the publishing mechanism from server → overlay isn't decided yet. Current options: private npm package, GitHub release artifact, or manual sync. Until resolved, token changes require manual copy.

Reference docs: see `prodrive-plugin/docs/STYLE_DICTIONARY_PLAN.md` (in the plugin repo, historical).

### 2. Demo page generation (overlay → server)

The server's marketing site embeds a live dashboard demo built by inlining overlay CSS/JS. The build script (`scripts/build-web-demo.mjs` in [`prodrive-server`](https://github.com/k10-motorsports/prodrive-server)) expects access to overlay source via `RACECOR_OVERLAY_PATH` env var or a sibling checkout of [`prodrive-overlay`](https://github.com/k10-motorsports/prodrive-overlay).

### 3. Combined Windows installer (overlay → windows)

[`prodrive-windows`](https://github.com/k10-motorsports/prodrive-windows) bundles its WinUI 3 host plus the overlay into a single Inno Setup installer. Build wiring: `installer/build.ps1` defaults `$OverlayRepo` to a sibling checkout at `../../prodrive-overlay/`, and the .iss `HUD_UNPACKED` define points at `..\..\prodrive-overlay\dist\win-unpacked`.

### 4. Native apps API contract (server → ios/macos/tvos/windows)

Native apps consume two API surfaces from [`prodrive-server`](https://github.com/k10-motorsports/prodrive-server):

- **Per-screen REST** (`prodrive.racecor.io/api/v1/*`, Bearer-authed GET) — one call per screen, server aggregates + runs calc internally + returns a finalized blob. Default for normal usage.
- **Calc engines** (`api.prodrive.racecor.io/api/v1/calc/*`, POST) — the Phase 9 layer; escape hatch for what-if flows that need scoped/synthetic inputs.

Docs:
- [`native-apps-api-contract.md`](native-apps-api-contract.md) — per-screen REST surface
- [`native-apps-calc-integration.md`](native-apps-calc-integration.md) — calc API + division of labor with per-screen REST + per-platform client recommendations
- [`native-apps-plan.md`](native-apps-plan.md) — high-level rollout plan

## iRacing Web Scraping — HARD CONSTRAINTS

The iRacing member site is an Angular SSR app. **No data API calls work from the embedded Electron BrowserWindow.** Tested extensively:

- `/data/` API endpoints require separate OAuth auth that the embedded browser does not have
- `/bff/pub/proxy/api/` BFF proxy endpoints return OAuth session metadata, NOT member/racing data
- `fetchBff`, `fetchIRacingEndpoint`, `fetchDirectData`, `fetchViaWebContents` — all fail for chart/member data
- The only working approach is **DOM scraping of server-rendered pages**

To get historical iRating data:
1. Navigate the BrowserWindow to the page that renders the iRating chart (e.g. profile/charts)
2. Wait for Angular SSR to render the chart into the DOM
3. Scrape data points from the rendered SVG/Canvas chart elements
4. Navigate back to the dashboard afterward

**Do not attempt API/BFF calls for iRating history. They do not work. Period.**

Key file: `prodrive-overlay/iracing-client.js` — `runSync(wc)` function (line ~1092 at last check).
