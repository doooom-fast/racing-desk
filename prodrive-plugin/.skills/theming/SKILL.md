# Theming — Theme System & Remote Token Delivery

## Overview

RaceCor supports multiple themes (dark, light, future custom) across both the web app and the overlay. Themes are CSS variable overrides layered on top of a base token set. The overlay fetches theme CSS remotely so users get updates without downloading new versions.

## Key Concepts

### Themes vs Modes
- **Theme** = colors and visual tone (dark / light). Controlled by `data-theme` attribute.
- **Mode** = density, chrome, and effects (standard / minimal / minimal+). Controlled by `body.mode-*` class.
- They are orthogonal and compose via CSS specificity.

### Theme Cascade
```css
:root { /* base tokens — this IS the dark theme */ }
[data-theme="light"] { /* light overrides — only tokens that differ */ }
body.mode-minimal { /* mode overrides — spacing, borders, animations */ }
```

### What Exists Today Is "Dark"
The current token values (defined in the `designTokens` database table) are the dark theme baseline. The `themeOverrides` table stores deltas for other themes.

## Web App Theming

### How It Works
1. Root layout reads theme preference from cookie (`racecor-theme`)
2. Sets `<html data-theme="dark|light">` during SSR (no flash)
3. Blob CSS `<link>` in `<head>` provides all tokens including `[data-theme="light"]` block
4. Client-side toggle updates cookie + `data-theme` attribute

### Theme Preference Storage
- **Cookie:** `racecor-theme=dark|light` — SSR-readable, set on toggle
- **Database:** `users.themePreference` column — persisted for authenticated users
- **Sync:** Overlay reads user preference from API

### Adding a Theme Toggle
```tsx
// Minimal example — actual component in web/src/components/ThemeToggle.tsx
function toggleTheme() {
  const current = document.documentElement.dataset.theme
  const next = current === 'dark' ? 'light' : 'dark'
  document.documentElement.dataset.theme = next
  document.cookie = `racecor-theme=${next};path=/;max-age=31536000`
}
```

## Overlay Theming

### Remote CSS Loading
The overlay fetches token CSS from the web API on startup and polls for updates.

```
Module: racecor-overlay/modules/js/token-loader.js

Startup:
  1. Apply bundled fallback CSS (local file)
  2. Fetch GET /api/tokens/current → { overlay: { url, hash } }
  3. Fetch blob URL → CSS string
  4. Inject <style id="remote-tokens"> after local <link> tags
  5. Cache CSS to disk: overlay-settings/tokens-cache.css
  6. Cache hash to disk: overlay-settings/tokens-hash.txt

Polling (every 5 min):
  1. Fetch /api/tokens/current → compare hash
  2. If changed: re-fetch blob, re-inject, update disk cache
  3. If same or fetch fails: no-op
```

### Fallback Chain (3 layers)
1. **Remote blob CSS** — freshest, injected as `<style>` (highest cascade priority)
2. **Disk cache** — `overlay-settings/tokens-cache.css` from last successful fetch
3. **Bundled defaults** — `modules/styles/base.css` `:root` block (always present)

### Theme Selection in Overlay
- Setting in overlay settings panel: Theme dropdown (Dark / Light)
- Saved to `overlay-settings.json` as `theme: "dark" | "light"`
- Applied as `document.documentElement.dataset.theme = setting`
- Synced from web API when connected: reads `users.themePreference`

### Overlay Light Theme Considerations
The overlay composites on a transparent window over the game. Light theme means:
- Panel backgrounds need higher opacity (the game shows through less)
- Borders may need to replace drop shadows for definition
- Ambient light system influence should be dampened
- WebGL effects (bloom, sentiment halo) need adjusted color math
- Test with both bright and dark game scenes

## Creating a New Theme

### Via Admin UI
1. Go to `/drive/admin/styles`
2. Select a base theme to start from (e.g. duplicate "dark")
3. Switch the theme dropdown to the new theme
4. Edit token values — only changed values create override entries
5. Save → triggers build → new CSS blob uploaded
6. New theme appears in theme selectors on web and overlay

### Via Database
1. Insert rows into `themeOverrides` with your `themeId` and overridden values
2. Trigger build: `POST /api/admin/tokens/build?theme=your-theme-id`
3. New blob URL stored in `tokenBuilds`

## CSS Specificity Model

```
Priority (lowest → highest):

1. :root { }                           — base tokens (dark)
2. [data-theme="light"] { }            — theme overrides
3. body.mode-minimal { }               — mode overrides (spacing/borders)
4. body.mode-minimal[data-theme="light"] { } — mode + theme compound (if needed)
5. <style id="remote-tokens">          — remote CSS injection (overlay only)
6. element.style.setProperty()         — JS-driven dynamic vars (ambient, sentiment)
```

Dynamic vars (ambient light, sentiment, control bars) are set via JS and always win because they're inline styles. This is intentional — they're real-time data visualizations that should override any theme.

## Cache-Busting Strategy

- Each build produces a content hash (first 8 chars of SHA-256)
- Blob key includes hash: `tokens/dark/overlay-a1b2c3d4.css`
- Old blobs are retained (previous versions stay accessible)
- The `/api/tokens/current` endpoint returns the latest URL + hash
- Overlay compares cached hash to server hash before re-fetching
- Vercel Blob serves with appropriate cache headers

## Files

```
Overlay:
  racecor-overlay/modules/js/token-loader.js  — Remote fetch + fallback + polling
  racecor-overlay/modules/styles/base.css     — Bundled fallback tokens in :root
  racecor-overlay/modules/styles/modes.css    — Mode overrides (unchanged)

Web:
  web/src/app/layout.tsx                      — SSR theme attribute + blob CSS link
  web/src/components/ThemeToggle.tsx           — Client-side theme switcher
  web/src/styles/globals.css                  — Structural CSS only (no tokens)

Shared:
  web/src/lib/tokens/build.ts                 — Build pipeline
  web/src/db/schema.ts                        — designTokens, themeOverrides, tokenBuilds
  docs/STYLE_DICTIONARY_PLAN.md               — Full implementation plan
```
