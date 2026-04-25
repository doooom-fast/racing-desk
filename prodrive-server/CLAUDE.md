# racecor-prodrive-server — Monorepo Root

Closed-source web-facing side of RaceCor Pro Drive. Split from the open `alternatekev/k10-motorsports` monorepo on 2026-04-18. This CLAUDE.md is for cross-project orchestration. For day-to-day work, use the project-specific CLAUDE.md in the workspace you're touching.

## Project Map

| Path | CLAUDE.md | Stack | Purpose |
|------|-----------|-------|---------|
| `apps/web/` | [CLAUDE.md](apps/web/CLAUDE.md) | Next.js 16, React 19, Tailwind 4, Drizzle, Strapi | Marketing site + Pro Drive admin |
| `apps/web-api/` | — | Node.js ESM | Mock telemetry server (dev only) |
| `packages/components/` | [CLAUDE.md](packages/components/CLAUDE.md) | Storybook, React 19 | Shared component library |
| `scripts/` | — | Node.js | Build scripts (notably `build-web-demo.mjs`) |

## Relationship to the open monorepo

The open [`alternatekev/k10-motorsports`](https://github.com/alternatekev/k10-motorsports) repo hosts:
- `racecor-plugin/` — SimHub plugin (C# .NET 4.8)
- `racecor-overlay/` — Electron overlay (30fps polling HUD)
- `racecor-edit/` — replay/editing tool
- `installer/` — Inno Setup Windows installer
- `src/agents/` — MCP servers

The plugin produces telemetry JSON on `http://localhost:8889/racecor-io-pro-drive/`. The overlay polls that. This closed repo is **independent of that runtime pipeline** — nothing here runs on the user's racing rig. Pro Drive server features run in a hosted web environment and are consumed by a logged-in user in their browser.

The two repos are related, not coupled. Changes here don't need to be coordinated with plugin/overlay releases unless touching the design system or the demo-generation script.

## Cross-repo seams

### Demo generation (`scripts/build-web-demo.mjs`)

This script inlines overlay CSS/JS into `apps/web/public/_demo/dashboard-embed.html` for the marketing site's live dashboard preview. It needs access to overlay source, which now lives in the open repo.

**Resolution order:** `RACECOR_OVERLAY_PATH` env var → sibling `../k10-motorsports/racecor-overlay/` → skip gracefully.

**Long-term plan:** the open monorepo's CI should publish a versioned `@racecor/overlay-assets` npm package with the inlined CSS/JS, and this repo's prebuild step should consume it. Tracked under Open Questions below.

### Design tokens

`apps/web/src/lib/tokens/build.ts` is the Style Dictionary pipeline that generates CSS custom properties from the token DB. The overlay consumes these tokens.

**Current state:** Tokens are built in this repo and need to reach the overlay.

**Decision per plan:** publish `packages/components` (or a dedicated tokens sub-package) to npm so the overlay can install it as a dependency. Defer until we see how often tokens change in practice. Tracked under Open Questions.

## Agent Work — Worktrees

All agent-spawned work MUST use `isolation: "worktree"`. Exceptions: read-only exploration, single non-code file writes.

## Open Questions

1. **Overlay asset publishing.** What's the mechanism for the open repo's overlay to publish inlined demo assets that `build-web-demo.mjs` can consume without a sibling checkout? Options: npm package, GitHub release artifact, CDN. No decision yet.
2. **Token publishing to overlay.** npm package (private or public), release artifact, or something else? Gated on seeing real change frequency.
3. **CI.** The open monorepo has `.github/workflows/dashboard-ci.yml`, `simhub-ci.yml`, `homebridge-ci.yml`, and `release.yml`. This repo needs its own web-focused CI — not yet set up.
4. **Auth / deployment infrastructure.** The Discord OAuth, Neon DB, and Vercel Blob credentials were set up against the open repo originally. Verify that environment variables and deployment targets follow this repo after the split.
