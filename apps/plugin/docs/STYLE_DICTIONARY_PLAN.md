# Style Dictionary & Theming — Implementation Plan

> Planning document for the design token pipeline, theme system, and live editor.
> Target: v1.0 release. Work begins April 5, 2026.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      Admin UI (Next.js)                         │
│  Token Editor → Color Pickers, Sliders, Inputs                  │
│  Live Preview → Injected <style> tag with draft CSS vars        │
│  Save Button → POST /api/admin/tokens/build                     │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Token Build Pipeline                            │
│  1. Read tokens from Postgres (designTokens + themeOverrides)   │
│  2. Run Style Dictionary transforms per platform                │
│  3. Generate CSS files: overlay.css, web.css (per theme)        │
│  4. Upload to Vercel Blob Storage with versioned keys           │
│  5. Update buildMeta table with new blob URLs + cache-bust hash │
└──────────┬──────────────────────────┬───────────────────────────┘
           │                          │
           ▼                          ▼
┌──────────────────────┐   ┌──────────────────────────────────┐
│   Web App (Next.js)  │   │   Overlay (Electron)             │
│   <link> to blob URL │   │   Remote-first fetch on startup  │
│   SSR injects vars   │   │   Falls back to local bundle     │
│   Theme via data-attr│   │   Polls for updates every 5 min  │
└──────────────────────┘   └──────────────────────────────────┘
```

---

## Phase 1 — Token Consolidation & Database Schema

**Goal:** Unify the two separate token sets (web globals.css + overlay base.css) into one canonical set stored in the database. The overlay token wins wherever there's a conflict.

### 1a. Token Audit & Consolidation Map

Current state: ~60 tokens split across two CSS files with different values for the same names.

| Token | Web Value | Overlay Value | Unified Value | Notes |
|-------|-----------|---------------|---------------|-------|
| `--bg` | `#0a0a14` | `hsla(0,0%,8%,0.90)` | `hsla(0,0%,8%,0.90)` | Overlay wins; web sets opacity to 1.0 via platform transform |
| `--bg-surface` | `rgba(16,16,32,0.90)` | — | `rgba(16,16,32,0.90)` | Web-only, keep |
| `--bg-panel` | `rgba(10,10,20,0.95)` | `hsla(0,0%,6%,0.90)` | `hsla(0,0%,6%,0.90)` | Overlay wins |
| `--bg-elevated` | `rgba(24,24,48,0.85)` | — | `rgba(24,24,48,0.85)` | Web-only, keep |
| `--bg-logo` | — | `hsla(0,0%,12%,0.90)` | `hsla(0,0%,12%,0.90)` | Overlay-only, keep |
| `--text` / `--text-primary` | `#e8e8f0` | `hsla(0,0%,100%,1.0)` | `hsla(0,0%,100%,1.0)` | Merge to `--text-primary`; web alias `--text` to it |
| `--text-muted` | `rgba(255,255,255,0.45)` | — | `rgba(255,255,255,0.45)` | Web-only, keep |
| `--border-subtle` | `rgba(255,255,255,0.06)` | — | `rgba(255,255,255,0.06)` | Web-only, keep |
| `--border-accent` | `rgba(229,57,53,0.35)` | — | `rgba(229,57,53,0.35)` | Web-only, keep |
| `--k10-red` / `--red` | `#e53935` | `#e53935` | `#e53935` | Same value, merge to `--red`; alias `--k10-red` |
| `--purple` | `#7c6cf0` | `hsl(280,80%,70%)` | `hsl(280,80%,70%)` | Overlay wins |
| `--corner-r` | `12px` | `8px` | `8px` | Overlay wins; web can override via platform transform |
| `--corner-r-sm` | `6px` | `5px` | `5px` | Overlay wins |
| `--ff-display` | `var(--font-display), 'Cinzel Decorative'...` | `'Cinzel Decorative'...` | `'Cinzel Decorative', 'Georgia', serif` | Overlay wins; Next.js font variable injected separately |

Full audit will be done during implementation — this table covers the known conflicts.

### 1b. Database Schema

Two new tables in the Drizzle schema:

```typescript
// ── Design Tokens (canonical source of truth) ──
export const designTokens = pgTable('design_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  path: varchar('path', { length: 128 }).notNull().unique(),
    // e.g. "color.background.base", "typography.fontFamily.display"
    // Dot-notation maps to Style Dictionary's nested JSON structure
  value: text('value').notNull(),
    // The resolved value: "#e53935", "8px", "'Barlow Condensed', ..."
  kind: varchar('kind', { length: 16 }).notNull(),
    // "color" | "font" | "size" | "radius" | "timing" | "weight" | "opacity"
  cssProperty: varchar('css_property', { length: 64 }).notNull(),
    // The CSS custom property name: "--red", "--corner-r", "--ff"
  description: text('description'),
  wcag: varchar('wcag', { length: 32 }),
    // WCAG contrast note: "4.7:1 AA", null for non-color tokens
  platforms: varchar('platforms', { length: 16 }).notNull().default('both'),
    // "web" | "overlay" | "both"
    // Controls which CSS output files include this token
  category: varchar('category', { length: 32 }).notNull(),
    // "background" | "text" | "border" | "semantic" | "brand" |
    // "typography" | "spacing" | "timing" | "flag" | "license" | "status"
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ── Theme Overrides (light, dark = base, future custom themes) ──
export const themeOverrides = pgTable('theme_overrides', {
  id: uuid('id').defaultRandom().primaryKey(),
  themeId: varchar('theme_id', { length: 32 }).notNull(),
    // "dark" (base — what exists today), "light", future custom themes
  tokenPath: varchar('token_path', { length: 128 }).notNull()
    .references(() => designTokens.path),
  value: text('value').notNull(),
    // The overridden value for this theme
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  uniqueThemeToken: unique().on(table.themeId, table.tokenPath),
}))

// ── Build Metadata (tracks which CSS files are live) ──
export const tokenBuilds = pgTable('token_builds', {
  id: uuid('id').defaultRandom().primaryKey(),
  themeId: varchar('theme_id', { length: 32 }).notNull(),
  platform: varchar('platform', { length: 16 }).notNull(), // "web" | "overlay"
  blobUrl: text('blob_url').notNull(),
    // Vercel Blob URL: https://xxx.public.blob.vercel-storage.com/tokens/dark/overlay-abc123.css
  hash: varchar('hash', { length: 16 }).notNull(),
    // Short content hash for cache-busting
  builtAt: timestamp('built_at').defaultNow().notNull(),
  builtBy: uuid('built_by').references(() => users.id),
})
```

### 1c. Seed Script

A one-time migration script that reads the existing `.skills/design-system.json` + overlay `base.css` + web `globals.css`, deduplicates them (overlay wins), and inserts rows into `designTokens`. The current values become the "dark" theme baseline — no entries needed in `themeOverrides` since the base tokens ARE the dark theme.

---

## Phase 2 — Style Dictionary Build Pipeline

**Goal:** A server-side build function that reads tokens from Postgres, runs Style Dictionary transforms, and outputs platform-specific CSS files.

### 2a. Style Dictionary Integration

Install `style-dictionary` as a dependency of the web app. The build runs on-demand (triggered by the admin Save button), NOT at deploy time.

```
web/
  src/
    lib/
      tokens/
        build.ts          ← Main build orchestrator
        sd-config.ts      ← Style Dictionary config factory
        transforms.ts     ← Custom transforms (opacity, alias, platform filter)
        seed.ts           ← One-time DB seeder from existing CSS
```

**Build flow:**

1. Fetch all `designTokens` rows from Postgres
2. Fetch `themeOverrides` for the target theme
3. Merge overrides onto base tokens
4. Convert flat rows into Style Dictionary's nested JSON format
5. Run SD build with custom config per platform (web vs overlay)
6. Output: two CSS strings (`:root { ... }` blocks)

**Platform transforms:**

- **Overlay CSS:** Output all tokens marked `overlay` or `both`. Use raw values (hsla with alpha for transparency on transparent Electron window).
- **Web CSS:** Output all tokens marked `web` or `both`. For background tokens, force alpha to 1.0 (web pages have solid backgrounds). Add `[data-theme="light"]` block for light theme overrides.

### 2b. Vercel Blob Upload

After SD build completes, upload the CSS strings to Vercel Blob Storage:

```
tokens/{themeId}/{platform}-{hash}.css
```

Example: `tokens/dark/overlay-a1b2c3.css`

Store the blob URL + hash in `tokenBuilds`. The overlay and web app always fetch the latest URL from a lightweight API endpoint.

### 2c. API Endpoints

```
GET  /api/tokens/current
     → Returns { web: { url, hash }, overlay: { url, hash } } for active theme
     → Overlay polls this every 5 minutes

POST /api/admin/tokens
     → Upsert a single token (used by the editor UI)

POST /api/admin/tokens/build
     → Triggers full SD build → Blob upload → updates tokenBuilds
     → Returns new URLs + hashes

GET  /api/admin/tokens
     → Returns all tokens + theme overrides for the editor UI

POST /api/admin/themes
     → Create/update theme override entries

GET  /api/tokens/css/{platform}.css
     → Fallback: dynamically renders CSS from DB (for dev/preview)
     → Production uses Blob URLs
```

---

## Phase 3 — Admin Token Editor UI

**Goal:** Replace the read-only `StyleDictionary.tsx` with an interactive editor that supports live preview and triggers builds.

### 3a. Editor Components

The existing `StyleDictionary.tsx` already has the right structure (tabs, token tables, previews). We'll evolve it:

- **Color tokens:** Replace static swatches with color pickers (use a lightweight picker — `react-colorful` is 2KB gzipped)
- **Size/radius/spacing tokens:** Number inputs with unit suffix, range sliders for visual tuning
- **Typography tokens:** Font family dropdowns, weight selectors
- **Timing tokens:** Duration input + easing curve selector with animated preview

Each token row becomes editable. Changes go into a local draft state — nothing saves until the user clicks Save.

### 3b. Live Preview

As the user edits tokens, inject a `<style>` tag into the admin page that overrides the `:root` variables in real-time. The existing admin UI uses these variables (via Tailwind's `var()` references), so color changes are visible immediately on the admin page itself.

For a richer preview, add a preview panel below the editor that shows:
- A miniature overlay mockup (static screenshot with CSS variables applied)
- Sample UI elements: buttons, cards, text hierarchy, border radius examples
- WCAG contrast checker that recalculates as colors change

### 3c. Save & Build Flow

1. User edits tokens → local draft state accumulates changes
2. "Unsaved changes" badge appears, Save button activates
3. Click Save → `POST /api/admin/tokens` (batch upsert) → `POST /api/admin/tokens/build`
4. Build runs server-side (~2-3 seconds)
5. New blob URLs returned → success toast
6. Web app picks up new CSS on next page load
7. Overlay picks up new CSS within 5 minutes (or immediate if user triggers refresh from overlay settings)

### 3d. Theme Switcher

Add a theme selector to the editor (dropdown or toggle: Dark / Light). When editing in "Light" mode, changes write to `themeOverrides` with `themeId: 'light'` instead of modifying base tokens. A "Reset to base" button per token removes the override.

---

## Phase 4 — Web App CSS Integration

**Goal:** The web app loads its CSS from the token build output instead of hardcoded globals.css values.

### 4a. CSS Loading Strategy

Replace the hardcoded `:root` block in `globals.css` with a dynamic approach:

- **SSR (production):** The root layout fetches the latest blob URL from `tokenBuilds` and injects a `<link>` tag pointing to it. Add `[data-theme]` attribute to `<html>` based on user preference.
- **Client-side theme switching:** A `<script>` in `<head>` reads the theme preference from a cookie (not localStorage — SSR needs it) and sets `data-theme` before first paint to avoid flash.
- **Fallback:** Keep a minimal set of hardcoded defaults in globals.css that the blob CSS overrides. If the blob is unreachable, the site still looks right.

### 4b. Theme Preference Storage

- Cookie: `racecor-theme=dark|light` (readable by SSR + client)
- For authenticated users: store preference in a new `themePreference` column on the `users` table
- The overlay reads the user's preference from the API and applies the matching theme

### 4c. Globals.css Changes

Strip the `:root` token block from `globals.css`. Keep only structural rules (Tailwind import, scrollbar styles, link styles, html/body reset). All token values come from the blob CSS.

---

## Phase 5 — Overlay Remote CSS Loading

**Goal:** The overlay fetches its token CSS from the web API instead of using local files.

### 5a. Remote-First with Local Fallback

New module: `racecor-overlay/modules/js/token-loader.js`

```
Startup:
  1. Load bundled fallback CSS (local copy of last-known-good tokens)
  2. Fetch GET /api/tokens/current → get overlay blob URL + hash
  3. Fetch the blob URL → get CSS string
  4. Inject as <style id="remote-tokens"> in <head>, AFTER local <link> tags
     (remote overrides local due to cascade)
  5. Save CSS to disk as new fallback: overlay-settings/tokens-cache.css

Polling (every 5 minutes):
  1. Fetch /api/tokens/current → compare hash to cached hash
  2. If different: fetch new blob, inject, save to disk
  3. If same: no-op
  4. If fetch fails: keep current styles (graceful degradation)
```

### 5b. Theme Support in Overlay

The overlay currently only has body class modes (minimal, minimal+, standard). Add theme support:

- `body[data-theme="dark"]` — default (what exists today)
- `body[data-theme="light"]` — new

The remote CSS blob includes both theme blocks. The overlay reads the user's theme preference from:
1. Local setting in `overlay-settings.json`
2. Synced from web API when connected (user's `themePreference`)

### 5c. Transition Plan

During rollout, both systems coexist:

1. Local `base.css` keeps its current `:root` block (fallback)
2. Remote CSS loads on top (overrides via cascade)
3. Once stable, the local `:root` tokens in `base.css` become minimal fallback-only defaults
4. Feature flag in settings: "Use remote tokens" (default: on)

---

## Phase 6 — Theme System (Light & Dark)

**Goal:** Ship light and dark themes for both web and overlay.

### 6a. Theme Architecture

What exists today IS the dark theme. The `designTokens` table stores the dark/base values. Light theme values go into `themeOverrides` with `themeId: 'light'`.

**CSS output structure (per platform):**

```css
/* Base tokens (dark theme) */
:root {
  --bg: hsla(0, 0%, 8%, 0.90);
  --text-primary: hsla(0, 0%, 100%, 1.0);
  --red: #e53935;
  /* ... all tokens ... */
}

/* Light theme overrides */
[data-theme="light"] {
  --bg: #f5f5f8;
  --text-primary: hsla(0, 0%, 10%, 1.0);
  /* ... only tokens that differ ... */
}
```

### 6b. Light Theme Token Mapping

Starting point for light theme overrides (will be refined in the editor):

| Category | Dark Value | Light Value |
|----------|-----------|-------------|
| `--bg` | `hsla(0,0%,8%,0.90)` | `#f5f5f8` |
| `--bg-surface` | `rgba(16,16,32,0.90)` | `rgba(255,255,255,0.95)` |
| `--bg-panel` | `hsla(0,0%,6%,0.90)` | `rgba(240,240,245,0.95)` |
| `--bg-elevated` | `rgba(24,24,48,0.85)` | `rgba(255,255,255,1.0)` |
| `--text-primary` | `hsla(0,0%,100%,1.0)` | `hsla(0,0%,10%,1.0)` |
| `--text-secondary` | `rgba(255,255,255,0.69)` | `rgba(0,0,0,0.65)` |
| `--text-dim` | `rgba(255,255,255,0.55)` | `rgba(0,0,0,0.50)` |
| `--text-muted` | `rgba(255,255,255,0.45)` | `rgba(0,0,0,0.40)` |
| `--border` | `rgba(255,255,255,0.14)` | `rgba(0,0,0,0.12)` |
| `--border-subtle` | `rgba(255,255,255,0.06)` | `rgba(0,0,0,0.06)` |

Semantic colors (red, green, blue, amber, etc.) may need slight saturation/lightness adjustments for readability on light backgrounds but should remain recognizable.

### 6c. Overlay Light Theme Considerations

The overlay runs on a transparent Electron window composited over the game. A "light" overlay theme means light-colored panels over a (usually dark) game scene. This is unusual but valid — some broadcasters prefer it for daytime races or specific aesthetics.

Key considerations:
- Panel backgrounds need higher opacity in light mode to maintain readability
- Drop shadows may need to become subtle borders
- The ambient light system's influence may need dampening in light mode
- WebGL effects (sentiment halo, bloom) need color adjustments

---

## Phase 7 — Mode Interaction with Themes

The overlay has visual modes (Standard, Minimal, Minimal+) that override spacing, borders, and animation tokens. These are orthogonal to themes:

- **Theme** controls colors and visual tone (dark/light)
- **Mode** controls density, chrome, and effects (standard/minimal/minimal+)

They compose via CSS specificity:

```css
:root { /* base tokens (dark) */ }
[data-theme="light"] { /* light color overrides */ }
body.mode-minimal { /* minimal spacing/border overrides */ }
body.mode-minimal[data-theme="light"] { /* minimal + light, if needed */ }
```

The existing `modes.css` stays as-is — it only touches spacing/border/animation tokens, not colors. If a mode needs theme-specific adjustments, they go in `modes.css` with the compound selector.

---

## Implementation Sequence

Work is broken into 8 discrete work sessions, each completable in roughly half a day. Dependencies flow downward — each session builds on the previous.

### Session 1: Database Schema & Seed
- Add `designTokens`, `themeOverrides`, `tokenBuilds` tables to Drizzle schema
- Run migration
- Write seed script that reads existing CSS + design-system.json → inserts rows
- Verify: all current tokens exist in DB with correct values

### Session 2: Style Dictionary Build Pipeline
- Install `style-dictionary` in web app
- Write `build.ts` — reads from DB, runs SD, outputs CSS strings
- Write custom transforms (platform filter, opacity adjustment, alias resolution)
- Write tests: build produces valid CSS matching current globals.css + base.css
- Verify: `node -e "require('./build').buildTokens('dark','overlay')"` outputs correct CSS

### Session 3: Blob Storage & API
- Set up Vercel Blob integration
- Write `POST /api/admin/tokens/build` endpoint
- Write `GET /api/tokens/current` endpoint
- Write token CRUD endpoints (`GET/POST /api/admin/tokens`)
- Verify: build endpoint produces blob URLs, current endpoint returns them

### Session 4: Admin Token Editor UI
- Evolve `StyleDictionary.tsx` → `TokenEditor.tsx`
- Add color pickers, number inputs, dropdowns per token kind
- Add draft state management (local unsaved changes)
- Wire Save button to build API
- Verify: can edit a color, see preview update, save, and get new blob URL

### Session 5: Live Preview & WCAG
- Add `<style>` injection for real-time preview as tokens change
- Add preview panel with sample UI elements
- Add WCAG contrast auto-calculator for color tokens
- Add undo/reset-to-saved per token
- Verify: editing --bg instantly changes the admin page background

### Session 6: Web App Integration
- Strip hardcoded tokens from globals.css
- Add blob CSS `<link>` injection in root layout (SSR)
- Add theme cookie + `data-theme` attribute
- Add theme toggle component (header dropdown)
- Add `themePreference` column to users table
- Verify: switching themes on web works without flash

### Session 7: Overlay Remote Loading
- Write `token-loader.js` module
- Add startup fetch + fallback + polling
- Add `data-theme` support to overlay body
- Add "theme" setting to overlay settings panel (synced from web preference)
- Add cache-busting logic
- Verify: editing a token in admin → overlay picks it up within 5 minutes

### Session 8: Light Theme & Polish
- Create light theme overrides in DB via admin editor
- Test light theme on web + overlay
- Adjust semantic colors for light backgrounds
- Test mode × theme combinations in overlay
- Test ambient light + WebGL effects with light theme
- Update STYLEGUIDE.md with theme documentation

---

## Skills to Create

Two new `.skills/` entries for ongoing work:

### `.skills/style-dictionary/SKILL.md`
Covers the token build pipeline: how to add new tokens, run builds, debug SD transforms, understand the DB → SD → CSS → Blob flow. Referenced whenever modifying or extending the design token system.

### `.skills/theming/SKILL.md`
Covers the theme system: how themes compose with modes, how to create new themes, the CSS specificity model, overlay remote loading behavior, cache-busting, and the admin editor workflow.

---

## Open Questions (Resolved)

| Question | Decision |
|----------|----------|
| Where do tokens live? | **Database only** — admin UI writes to Postgres, SD builds read from API |
| How to serve built CSS? | **Vercel Blob Storage** — upload after build, overlay fetches blob URL |
| Overlay loading strategy? | **Remote-first with local fallback** — fetch on startup, poll every 5 min, cache to disk |
| Theme model? | **Base tokens + overrides** — one base set (dark), themes store only diffs |
| What's the dark theme? | **What exists today** — current token values become the dark baseline |

---

## Risk Mitigation

- **Blob unavailable:** Both web and overlay have local CSS fallbacks. The site never breaks.
- **Bad token build:** The admin preview lets you see changes before saving. A "revert to last build" button restores the previous blob.
- **Overlay offline:** Falls back to cached CSS on disk, then to bundled defaults. Three layers of fallback.
- **Performance:** Blob CSS is a single small file (~2-4KB). No runtime rendering cost beyond a normal stylesheet.
- **Vercel Blob limits:** Free tier includes 500MB and 1M reads/month. Token CSS files are tiny — this is well within limits.
