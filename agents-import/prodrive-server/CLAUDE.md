# prodrive-server — RaceCor.io marketing + Pro Drive members + calc engines

The web-facing side of Pro Drive. Hosts:

- **Marketing site** at racecor.io
- **Members dashboard** at racecor.io/drive (Discord-gated)
- **Chrome extension source** at `apps/web/browser-extension/`
- **65 API routes** including iRacing ingest, calc engines, plugin auth, admin
- **Calc engine deployment** at api.prodrive.racecor.io (separate Vercel project)

A sibling repo, [`prodrive-server-showcase`](https://github.com/k10-motorsports/prodrive-server-showcase), holds the same code with `denyIfDemo()` removed from three write routes — used as a read-only public demo.

## Project Map

| Path | Stack | Purpose |
|------|-------|---------|
| `apps/web/` | Next.js 16, React 19, Tailwind 4, Drizzle, NextAuth (Discord), Vercel Blob | Marketing site + Pro Drive members dashboard + Chrome extension + 65 API routes |
| `apps/web-api/` | Vercel Functions / Node ESM | Calc engines (DNA, Moments, Mastery, race-summary, etc.) deployed to api.prodrive.racecor.io |
| `apps/web/browser-extension/` | Manifest V3 Chrome extension | "RaceCor iRacing Sync" — scrapes members-ng.iracing.com, posts to /api/iracing/extension-sync |
| `packages/components/` | Storybook, React 19 | Shared component library |
| `scripts/` | Node.js | Build scripts (notably `build-web-demo.mjs`) |

## Tech stack

- **Next.js 16** + **React 19** + **Tailwind 4**
- **Drizzle ORM** over **Neon Postgres**
- **NextAuth v5 (beta)** with **Discord** as the only OAuth provider
- **Vercel Blob** for telemetry trace storage
- **No Strapi** (older docs claimed CMS; not present in code today)
- **No Stripe / no billing** — closed beta, Discord-invite-only
- **Style Dictionary** pipeline for design tokens (`apps/web/src/lib/tokens/`)

## API routes (high level)

### Calc engines (`apps/web-api`, deployed to `api.prodrive.racecor.io/api/v1/calc/*`)

Pure functions over user data — no DB writes. Reproducible at any time:

`/dna`, `/moments`, `/mastery`, `/when`, `/scatter`, `/race-summary`, `/next-race-ideas`, `/race-now`, `/previous-races`

### User data (`apps/web`, served at `prodrive.racecor.io/api/v1/*`)

Bearer-authed GET, one call per screen, server aggregates:

`/me`, `/sessions`, `/sessions/{id}`, `/dashboard`, `/iracing/schedule`, `/tokens/native?format={swift,cs,kotlin}`

### iRacing ingest (`apps/web`)

The three sync paths:

- `POST /api/iracing/upload` — manual paste/drop at `/drive/iracing` AND Chrome extension full-result push (intercepted from S3 fetches)
- `POST /api/iracing/extension-sync` — Chrome extension DOM-scraped data (rating history, careers)
- `POST /api/iracing/import` — SimHub plugin Bearer-authed session push

Plus housekeeping: `/latest`, `/consolidate-tracks`, `/dedupe`, `/clear`.

CORS allows `chrome-extension://`, localhost:3000, dev, and prod domains.

### Plugin OAuth + device link

- `/api/plugin-auth/{authorize, token, verify}` — Bearer issuance for plugin / desktop apps
- `/api/plugin-auth/device/{start, poll, authorize}` — tvOS device-link flow (6-char code at racecor.io/link)

### Admin

`/api/admin/{ratings, logos, heroes, seed-demo, themes, tokens, tracks, users}` — auth + `denyIfDemo()` guarded.

### Misc

Download latest version, Unsplash backgrounds, theme CSS tokens, health check.

## Cross-repo seams

### 1. Chrome extension — same repo, different deployment

Lives at `apps/web/browser-extension/`. Manifest V3. Targets `https://members-ng.iracing.com/*` for the content script; `prodrive.racecor.io` (+ localhost dev) for API endpoints.

Distribution today is a packed zip from a private Discord channel; Chrome Web Store listing in progress.

### 2. Demo page generation (`scripts/build-web-demo.mjs`)

Inlines overlay CSS/JS into `apps/web/public/_demo/dashboard-embed.html` for the marketing-site live demo. Resolution order: `RACECOR_OVERLAY_PATH` env var → sibling `../prodrive-overlay-showcase/` → sibling `../prodrive-overlay/` → skip gracefully.

### 3. Design tokens

`apps/web/src/lib/tokens/` is the Style Dictionary source. Consumed by:

- The overlay's `token-loader.js` (live fetch from `/api/v1/tokens/native`)
- The native apps via `/api/v1/tokens/native?format={swift,cs,kotlin}`

### 4. Plugin Bearer issuance

The SimHub plugin uses `/api/plugin-auth/{authorize, token}` PKCE for Bearer tokens, then pushes session data to `/api/iracing/import`. See [`../prodrive-plugin/CLAUDE.md`](../prodrive-plugin/CLAUDE.md).

### 5. Native apps API contract

See [`../prodrive-context/native-apps-api-contract.md`](../prodrive-context/native-apps-api-contract.md) for per-screen REST + [`../prodrive-context/native-apps-calc-integration.md`](../prodrive-context/native-apps-calc-integration.md) for calc API shape and division of labor.

## What this repo is NOT

- Not the rig-side runtime — nothing here runs on the user's racing rig.
- Not currently a CMS host (no Strapi). Content is static MDX or Postgres-stored.
- Not a billing surface yet. Closed-beta, free, Discord-gated.

## Agent work policy

All agent-spawned work MUST use `isolation: "worktree"`. Exceptions: read-only exploration, single non-code file writes.

## Pointers

- Cross-repo orchestration: [`../prodrive-context/monorepo-orchestration.md`](../prodrive-context/monorepo-orchestration.md)
- Plugin (Bearer client): [`../prodrive-plugin/CLAUDE.md`](../prodrive-plugin/CLAUDE.md)
- Native API contract: [`../prodrive-context/native-apps-api-contract.md`](../prodrive-context/native-apps-api-contract.md)
- Calc integration: [`../prodrive-context/native-apps-calc-integration.md`](../prodrive-context/native-apps-calc-integration.md)
