---
name: web-theming
description: |
  Web app color theming system expert for the Next.js Pro Drive dashboard.
  Use when working on design tokens, theme sets, dark/light mode, F1 team themes,
  Style Dictionary pipeline, CSS custom properties, contrast checking, or the token editor admin UI.
  Triggers: theme, theming, dark mode, light mode, tokens, design tokens, CSS variables,
  custom properties, color palette, F1 team themes, Style Dictionary, contrast, WCAG,
  brand colors, token editor, theme sets, theme overrides.
---

# Web Color Theming System Expert

You are an expert on the design token and theming architecture of the RaceCor.io web application. Before making changes, read the key source files to get current implementation context.

## Files to Read on Activation

Always read these before making theming changes:

```
web/src/styles/globals.css                        # Token definitions, fallback values, brand palette
web/src/lib/theme.ts                              # Cookie-based theme/set management
web/src/lib/chart-theme.ts                        # Recharts color constants
web/src/lib/constants.ts                          # Brand color palette definitions
web/src/db/schema.ts                              # designTokens, themeSets, themeOverrides, tokenBuilds tables
web/src/components/ThemeScript.tsx                 # Flash prevention (reads cookie before paint)
web/src/components/ThemeToggle.tsx                 # Dark/light toggle
web/src/components/ThemeSetSelector.tsx            # F1 team theme dropdown
web/src/components/ThemeSetEffects.tsx             # Theme set side effects
```

Read for token pipeline work:

```
web/src/lib/tokens/build.ts                       # Style Dictionary build orchestration
web/src/lib/tokens/sd-config.ts                   # Style Dictionary configuration
web/src/lib/tokens/get-token-css-url.ts           # Query latest CSS blob URL
web/src/lib/tokens/seed.ts                        # Token seeding
web/src/lib/tokens/seed-light-theme.ts            # Light theme seed data
web/src/lib/tokens/seed-theme-sets.ts             # F1 team set definitions
web/src/lib/tokens/upload.ts                      # Upload built CSS to Vercel Blob
```

Read for admin UI work:

```
web/src/app/drive/admin/styles/page.tsx
web/src/app/drive/admin/styles/TokenEditor.tsx     # Color picker + override editor
web/src/app/drive/admin/styles/PreviewPanel.tsx    # Live preview
web/src/app/drive/admin/styles/ContrastChecker.tsx # WCAG validation
```

## Architecture

### Theme System Flow

```
1. Page load → ThemeScript.tsx reads `racecor-theme` cookie → sets data-theme on <html>
2. layout.tsx (server) → reads cookies → queries getTokenCssUrl() → injects <link> to Vercel Blob CSS
3. globals.css → @layer base with fallback token values (overridden by blob CSS when loaded)
4. ThemeToggle → toggles data-theme (dark/light), updates cookie
5. ThemeSetSelector → changes data-set (team slug), updates cookie, triggers page reload for new blob CSS
```

### Database Schema

**`designTokens`** — Master token definitions:
- `path` (unique) — e.g. `"color.text"`, `"color.bg"`, `"color.accent"`
- `value` — CSS value (hex, hsl, etc.)
- `kind` — `color`, `sizing`, `typography`, `timing`
- `cssProperty` — Mapped CSS custom property name
- `wcag` — Accessibility rating (AAA, AA, etc.)
- `platforms` — `'web'`, `'overlay'`, or `'both'`
- `category` — Grouping for the editor UI

**`themeSets`** — 12 named collections (default + 11 F1 teams):
- `slug` (primary key) — `'default'`, `'red-bull'`, `'ferrari'`, `'mclaren'`, `'mercedes'`, `'aston-martin'`, `'alpine'`, `'williams'`, `'rb'`, `'haas'`, `'kick-sauber'`, `'cadillac'`
- `name`, `description`, `liveryImage`, `sortOrder`

**`themeOverrides`** — Per-set, per-theme (dark/light) token overrides:
- `setSlug` → `themeSets.slug`
- `themeId` — `'dark'` or `'light'`
- `tokenPath` → `designTokens.path`
- `value` — Override CSS value
- Unique constraint: `(setSlug, themeId, tokenPath)`

**`tokenBuilds`** — Compiled CSS blobs cached in Vercel Blob:
- `setSlug`, `themeId`, `platform` — Build dimensions
- `blobUrl` — Vercel Blob URL to compiled CSS
- `hash` — Content hash for cache busting
- `builtBy` → `users.id`

### Style Dictionary Pipeline

The build process (`tokens/build.ts`):
1. Reads `designTokens` from DB
2. Reads `themeOverrides` for the target set + theme
3. Merges overrides onto base tokens
4. Runs Style Dictionary transforms
5. Outputs CSS with custom properties
6. Uploads to Vercel Blob (`tokens/upload.ts`)
7. Stores blob URL + hash in `tokenBuilds`

### Brand Color Palette

From `globals.css` and `constants.ts`:

```css
/* K10 three-tone reds */
--k10-red:        #e53935;
--k10-red-dark:   #b02020;
--k10-red-deeper: #700010;

/* Semantic colors */
--green:  #43a047;
--blue:   #1e88e5;
--amber:  #f9a825;
--purple: #7c6cf0;
--cyan:   #00bcd4;

/* Base dark background */
--bg: #0a0a14;

/* WCAG 2.1 contrast (documented in globals.css) */
/* All text colors are audited for AAA/AA compliance against --bg */
```

### Token CSS Loading

The remote token CSS is loaded from Vercel Blob and overrides the fallback values in `globals.css`. If the blob is unavailable, the fallback values ensure the app still renders correctly.

```
globals.css @layer base (fallback) ← overridden by → Vercel Blob CSS (authoritative)
```

### Chart Theme Integration

`chart-theme.ts` exports constants used by all Recharts components:

```typescript
CHART_COLORS.primary    = '#e53935'  // K10 red
CHART_COLORS.secondary  = '#1e88e5'  // blue
CHART_COLORS.tertiary   = '#7c6cf0'  // purple
CHART_COLORS.positive   = '#43a047'  // green
CHART_COLORS.palette    = [red, blue, green, amber, purple, cyan]

CHART_AXIS_STYLE        // stroke, tick fill/size
CHART_TOOLTIP_STYLE     // dark glass tooltip
CHART_GRID_STYLE        // subtle dashed grid lines
```

## Rules

1. **Token CSS is the source of truth** — Don't hardcode color values in components. Use CSS custom properties from the token system.
2. **Fallbacks are required** — Every token consumed in `globals.css` must have a fallback value. The blob CSS may not load.
3. **WCAG compliance** — All text/background combinations must meet at least AA contrast. The `ContrastChecker.tsx` component validates this in the admin UI.
4. **Theme attribute names are fixed** — `data-theme` (dark/light) and `data-set` (team slug) on `<html>`. Don't rename.
5. **Cookie names are fixed** — `racecor-theme` and `racecor-theme-set`. Used by both server and client.
6. **ThemeScript prevents FOUC** — It runs as inline `<script>` before first paint. Don't move it to a deferred script.
7. **react-colorful for pickers** — The token editor uses `react-colorful` for color picking. Don't introduce additional color picker libraries.
8. **Platform targeting** — Tokens have a `platforms` field (`'web'`, `'overlay'`, `'both'`). Overlay tokens generate different CSS output via Style Dictionary.
9. **No localStorage for theme** — Theme state is in cookies (for SSR access). The `ThemeScript` reads cookies, not localStorage.

## Cross-Project Impact

Token changes in the web admin UI can affect the overlay. The overlay consumes token CSS files from `racecor-overlay/modules/styles/`. See the root CLAUDE.md's "Design System (Cross-Project)" section. When modifying token definitions or the Style Dictionary pipeline, consider both platforms.
