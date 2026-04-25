# K10 Motorsports — Monorepo Root

Broadcast-grade sim racing platform. This root CLAUDE.md is for **cross-project orchestration only**. For day-to-day work, use the project-specific CLAUDE.md in the directory you're working in.

## Agent Work — Always Use Worktrees

All agent-spawned work MUST use `isolation: "worktree"`. Exceptions: read-only exploration, single non-code file writes.

## Project Map

| Directory | CLAUDE.md | Stack | Purpose |
|-----------|-----------|-------|---------|
| `racecor-plugin/` | [CLAUDE.md](racecor-plugin/CLAUDE.md) | C# .NET 4.8, TypeScript, NUnit, Jest | SimHub plugin + Homebridge plugin |
| `racecor-overlay/` | [CLAUDE.md](racecor-overlay/CLAUDE.md) | Electron, vanilla JS, WebGL2, Canvas 2D | Overlay HUD (30fps polling) |
| `racecor-edit/` | — | — | Replay/editing tool |
| `src/agents/` | [CLAUDE.md](src/agents/CLAUDE.md) | Node.js, MCP SDK | 3 MCP servers |
| `installer/` | [CLAUDE.md](installer/CLAUDE.md) | Inno Setup | Windows installer (.iss) |
| `scripts/` | [CLAUDE.md](scripts/CLAUDE.md) | Bash, Node, Python | Build, install, launch scripts |
| `docs/` | [CLAUDE.md](docs/CLAUDE.md) | Markdown, HTML | Architecture and design docs |

> **Note — web side split out:** The marketing site, Pro Drive admin (Next.js), mock telemetry server, and shared React component library now live in the closed [`alternatekev/racecor-prodrive-server`](https://github.com/alternatekev/racecor-prodrive-server) repo. See the "Closed-repo seams" section below for the cross-repo contracts.

## End-to-End Data Flow (Integration Contract)

This is the contract that ties the plugin and overlay together. Changes to the JSON shape must be coordinated across both projects.

```
iRacing SDK
  → C# TelemetrySnapshot (racecor-plugin/simhub-plugin/)
  → cross-game normalization
  → 33+ commentary triggers
  → strategy modules (tire/fuel/pit/opponent/position)
  → HTTP API on port 8889: GET http://localhost:8889/racecor-io-pro-drive/
    → flat JSON object with 100+ properties (telemetry, commentary, strategy)
  → Electron overlay polls at ~30fps (racecor-overlay/)
  → WebGL2 + Canvas 2D rendering
  → Homebridge subscribes for light color mapping (racecor-plugin/homebridge-plugin/)
```

The plugin is the **producer**, the overlay is the **consumer**, and the HTTP JSON API on port 8889 is the **contract** between them.

## Closed-repo seams

The web-facing side of the product lives in [`alternatekev/racecor-prodrive-server`](https://github.com/alternatekev/racecor-prodrive-server). Two cross-repo contracts matter:

### 1. Design tokens

Token definitions and the Style Dictionary pipeline live in the closed repo (`apps/web/src/lib/tokens/build.ts`). The overlay consumes these tokens as CSS custom properties in `racecor-overlay/modules/styles/`.

**Open question:** the publishing mechanism from closed → open isn't decided yet. Current options: private npm package, GitHub release artifact, or manual sync. Until resolved, token changes require manual copy.

Reference docs: `docs/STYLE_DICTIONARY_PLAN.md`, `docs/STYLEGUIDE.md`.

### 2. Demo page generation

The closed repo's marketing site embeds a live dashboard demo built by inlining overlay CSS/JS. The build script (`scripts/build-web-demo.mjs` in the closed repo) expects access to overlay source via `RACECOR_OVERLAY_PATH` env var or a sibling checkout of this repo.

## CI Workflows

All workflows live in `.github/workflows/`:

| Workflow | Trigger | What It Tests |
|----------|---------|---------------|
| `dashboard-ci.yml` | Push/PR | Overlay Playwright tests |
| `simhub-ci.yml` | Push/PR | C# NUnit (~147), Python dataset validation (28), Python installer tests (34) |
| `homebridge-ci.yml` | Push/PR | Homebridge Jest (133) |
| `release.yml` | `v*` tags | Full release build |
| `plugin-ci.yml` | Disabled | Legacy duplicate of simhub-ci |

## iRacing Web Scraping — HARD CONSTRAINTS

The iRacing member site is an Angular SSR app. **No data API calls work from the embedded Electron BrowserWindow.** This has been tested extensively:

- `/data/` API endpoints require separate OAuth auth that the embedded browser does not have
- `/bff/pub/proxy/api/` BFF proxy endpoints return OAuth session metadata, NOT member/racing data
- `fetchBff`, `fetchIRacingEndpoint`, `fetchDirectData`, `fetchViaWebContents` — all fail for chart/member data
- The only working approach is **DOM scraping of server-rendered pages**

To get historical iRating data, you MUST:
1. Navigate the BrowserWindow to the page that renders the iRating chart (e.g. profile/charts)
2. Wait for Angular SSR to render the chart into the DOM
3. Scrape data points from the rendered SVG/Canvas chart elements
4. Navigate back to the dashboard afterward

**Do not attempt API/BFF calls for iRating history. They do not work. Period.**

Key file: `racecor-overlay/iracing-client.js` — `runSync(wc)` function (line ~1092)
