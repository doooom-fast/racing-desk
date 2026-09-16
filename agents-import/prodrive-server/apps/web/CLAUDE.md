# RaceCor Web — Next.js 16

Marketing site ([k10motorsports.racing](https://k10motorsports.racing)) and Pro Drive members app ([prodrive.racecor.io](https://prodrive.racecor.io)) with subdomain routing.

## ⚠️ Next.js 16 — Breaking Changes

**This is NOT the Next.js you know.** APIs, conventions, and file structure may differ from your training data. **Read the relevant guide in `node_modules/next/dist/docs/` before writing any code.** Heed deprecation notices. The dev server uses `--webpack` (not Turbopack) due to a LightningCSS native module compatibility issue.

## Tech Stack

- **Next.js 16.2.0** with Webpack (not Turbopack)
- **React 19.2.4**
- **Tailwind CSS 4**
- **Drizzle ORM 0.45+** with Neon serverless PostgreSQL
- **NextAuth 5** (beta) with Discord OAuth
- **Strapi CMS** — headless CMS for news, driver profiles, team info
- **Vercel** — hosting with automatic deploys on push to `main`
- **Vitest** — test runner (`npm test` / `npm run test:watch`)
- **Style Dictionary 5** — design token pipeline
- **Recharts** — data visualization
- **Lucide React** — icon library

## Key Files

| What | Path |
|------|------|
| App entry / layout | `src/app/layout.tsx` |
| Marketing routes | `src/app/marketing/` |
| Pro Drive routes | `src/app/drive/` |
| K10 routes | `src/app/k10/` |
| API routes | `src/app/api/` |
| Subdomain middleware | `src/middleware.ts` |
| Global styles + tokens | `src/styles/globals.css` |
| DB schema (Drizzle) | `src/db/schema.ts` |
| Token build pipeline | `src/lib/tokens/build.ts` |
| Components | `src/components/` |
| Types | `src/types/` |
| Tests | `src/__tests__/` |
| Next.js config | `next.config.ts` |
| Drizzle config | `drizzle.config.ts` |
| DB migrations | `drizzle/` |
| Blog content | `content/blog/` |
| Environment template | `.env.example` |

## Architecture

### Subdomain Routing

The middleware (`src/middleware.ts`) routes requests based on subdomain:
- `k10motorsports.racing` / `dev.racecor.io` → marketing site (`src/app/marketing/`)
- `prodrive.racecor.io` / `dev.prodrive.racecor.io` → Pro Drive app (`src/app/drive/`)

Dev shortcut without `/etc/hosts` changes: `http://localhost:3000?subdomain=drive`

Constants in `constants.ts` auto-switch between `http://dev.` (dev) and `https://` (production) based on `NODE_ENV`.

### Authentication

NextAuth 5 with Discord OAuth. Callback URLs:
- `https://k10motorsports.racing/api/auth/callback/discord`
- `https://prodrive.racecor.io/api/auth/callback/discord`

### Database

Drizzle ORM with Neon serverless PostgreSQL (`@neondatabase/serverless`). Schema in `src/db/schema.ts`. Migrations in `drizzle/`.

Design system tables: `theme_sets` and `theme_overrides` — store F1 team themes (12 teams × dark+light variants).

### CMS

Strapi provides headless content management (news posts, driver profiles, team info). Connected via `STRAPI_URL` and `STRAPI_API_TOKEN` environment variables.

### Pre-build Step

Both `npm run dev` and `npm run build` run a prebuild script (`../../scripts/build-web-demo.mjs`) that generates demo data for the overlay widget. The script reads overlay source from the open monorepo (`alternatekev/k10-motorsports`) — set `RACECOR_OVERLAY_PATH` or clone the open repo as a sibling. Skips gracefully if the overlay source isn't found.

## Design System

This project hosts the **token editor** and **Style Dictionary pipeline** that generates CSS consumed by the overlay (overlay lives in the open `alternatekev/k10-motorsports` monorepo). See the repo root [CLAUDE.md](../../CLAUDE.md) and the open monorepo's root CLAUDE.md for cross-project design system context.

- Token build: `src/lib/tokens/build.ts`
- Theme DB tables: `theme_sets`, `theme_overrides`
- Admin UI for editing tokens (Pro Drive dashboard)

## Local Development

```bash
npm install
cp .env.example .env.local   # Fill in values (see README.md for full list)
npm run dev                   # Starts on http://localhost:3000
```

Required env vars: `YOUTUBE_API_KEY`. For auth: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`. For CMS: `STRAPI_URL`, `STRAPI_API_TOKEN`.

Optional local domain setup for subdomain testing — add to `/etc/hosts`:
```
127.0.0.1   dev.racecor.io
127.0.0.1   dev.prodrive.racecor.io
```

## Testing

```bash
npm test          # Vitest (run once)
npm run test:watch  # Vitest (watch mode)
npm run lint      # ESLint
```

## Deployment

Hosted on Vercel. Root directory set to `web`. Auto-deploys on push to `main`.

Domains: `k10motorsports.racing` (marketing), `prodrive.racecor.io` (Pro Drive).

## Code Style

- Standard Next.js 16 conventions (but verify against `node_modules/next/dist/docs/`)
- Tailwind 4 for styling
- ESLint config in `eslint.config.mjs`
- TypeScript strict mode (`tsconfig.json`)
