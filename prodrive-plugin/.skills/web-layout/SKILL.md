---
name: web-layout
description: |
  Web app layout system expert for the Next.js 16 marketing site and Pro Drive dashboard.
  Use when working on page layouts, route structure, subdomain routing, component placement,
  responsive design, navigation, or the app shell in the web/ project.
  Triggers: layout, page structure, routing, navigation, responsive, grid, flexbox, app shell,
  middleware, subdomain, drive routes, marketing routes, admin panel layout.
---

# Web Layout System Expert

You are an expert on the layout architecture of the RaceCor.io web application. Before making any changes, read the key source files listed below to get current implementation context.

## Files to Read on Activation

Always read these files before making layout changes:

```
web/src/app/layout.tsx                    # Root layout (fonts, theme attrs, token CSS injection)
web/src/middleware.ts                     # Subdomain routing logic
web/src/styles/globals.css                # Design tokens, base styles, typography
web/src/components/DriveHeader.tsx        # Drive app header
web/src/components/DriveNav.tsx           # Drive app navigation
web/src/components/DriveNavLinks.tsx      # Navigation link definitions
web/src/lib/constants.ts                  # Domain URLs, site names, brand constants
```

Read additional files based on the specific area:

```
# Marketing site layout
web/src/app/marketing/layout.tsx
web/src/app/marketing/page.tsx

# Drive app layout
web/src/app/drive/layout.tsx
web/src/app/drive/dashboard/page.tsx

# Admin panel layout
web/src/app/drive/admin/page.tsx
web/src/app/drive/admin/styles/page.tsx

# K10 branding layout
web/src/app/k10/layout.tsx
```

## Architecture

### Route Structure

The app uses **subdomain-based routing** via Next.js middleware:

| Subdomain | Route Group | Purpose |
|-----------|-------------|---------|
| `k10motorsports.racing` / `dev.racecor.io` | `src/app/marketing/` | Public marketing site |
| `prodrive.racecor.io` / `dev.prodrive.racecor.io` | `src/app/drive/` | Pro Drive members app (Discord auth) |
| — | `src/app/k10/` | K10 branding pages |
| — | `src/app/api/` | API routes |

Dev shortcut: `http://localhost:3000?subdomain=drive` bypasses `/etc/hosts` requirement.

### Root Layout Pattern

`layout.tsx` is an **async Server Component** that:
1. Reads `racecor-theme` and `racecor-theme-set` cookies server-side
2. Queries `getTokenCssUrl()` for the latest Style Dictionary CSS blob
3. Sets `data-theme` and `data-set` attributes on `<html>`
4. Injects a `<link>` tag to the remote token CSS (Vercel Blob)
5. Loads fonts: Adobe TypeKit (Sofia Pro Comp, Stolzl) + Google Fonts (JetBrains Mono)
6. Renders `<ThemeScript>` to prevent flash of wrong theme

### Drive App Pages

| Route | Component | Layout Notes |
|-------|-----------|-------------|
| `/drive/dashboard` | Dashboard with DataStrip, charts, cards | Multi-column responsive grid |
| `/drive/dna` | DriverDNAPage | Radar chart + archetype cards |
| `/drive/iracing` | IRacingUploadForm | Upload form + status |
| `/drive/tracks` | TrackMasteryPage | Track grid with module.css |
| `/drive/when` | WhenEnginePage | Scheduling insights + chart |
| `/drive/moments` | MomentsPage | Gallery grid |
| `/drive/admin/*` | 7 admin subsections | Tabbed navigation |

### Admin Panel Subsections

| Route | Component | Purpose |
|-------|-----------|---------|
| `/admin` | OverviewCards | Dashboard stats |
| `/admin/brands` | BrandsSection | Logo management |
| `/admin/components` | ComponentCatalog | Component showcase |
| `/admin/logs` | LogsSection | Activity logs |
| `/admin/styles` | TokenEditor + PreviewPanel + ContrastChecker | Design token management |
| `/admin/tracks` | TracksSection | Track data management |
| `/admin/users` | UsersSection | User administration |

## Rules

1. **Next.js 16 breaking changes** — Always read `node_modules/next/dist/docs/` before using new Next.js APIs. Conventions may differ from training data.
2. **Dev server uses Webpack** — Not Turbopack. Configured in `package.json` scripts (`--webpack` flag).
3. **Subdomain routing is middleware-based** — Don't use Next.js rewrites for subdomain logic; it's handled in `src/middleware.ts`.
4. **Theme attributes on `<html>`** — Layout relies on `data-theme` (dark/light) and `data-set` (team slug) attributes. Don't remove or rename these.
5. **Server Components by default** — Use `'use client'` only when needed (interactivity, hooks, browser APIs).
6. **Tailwind 4** — Use Tailwind utility classes. The project uses Tailwind CSS 4 (not 3).
7. **Typography** — Body: `sofia-pro-comp`. Display: `stolzl`. Mono: `JetBrains Mono`. These are set via CSS custom properties `--ff`, `--ff-display`, `--ff-mono`.
