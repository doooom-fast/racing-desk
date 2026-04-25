# Style Dictionary — Token Build Pipeline

## Overview

RaceCor uses [Style Dictionary](https://amzn.github.io/style-dictionary/) to transform design tokens stored in PostgreSQL into platform-specific CSS files. This skill covers the entire pipeline from database to delivered CSS.

## Architecture

```
PostgreSQL (designTokens + themeOverrides)
  → API reads tokens as flat rows
  → Converts to nested JSON (SD input format)
  → Style Dictionary transforms + builds
  → Two CSS outputs: overlay.css, web.css
  → Uploaded to Vercel Blob Storage
  → Overlay + web app fetch via blob URLs
```

## Key Files

```
web/src/lib/tokens/
  build.ts          — Main build orchestrator (reads DB → runs SD → uploads blob)
  sd-config.ts      — Style Dictionary config factory (per-platform)
  transforms.ts     — Custom SD transforms (platform filter, opacity, aliases)
  seed.ts           — One-time seeder from existing CSS into database

web/src/app/api/tokens/
  current/route.ts  — GET: returns active blob URLs + hashes for each platform
  css/[platform]/route.ts — GET: fallback dynamic CSS renderer

web/src/app/api/admin/tokens/
  route.ts          — GET/POST: token CRUD for admin editor
  build/route.ts    — POST: triggers full SD build + blob upload
```

## Database Tables

### `designTokens` — Canonical token definitions
- `path`: Dot-notation key (e.g. `color.background.base`)
- `value`: Resolved CSS value (e.g. `hsla(0,0%,8%,0.90)`)
- `cssProperty`: CSS custom property name (e.g. `--bg`)
- `kind`: `color | font | size | radius | timing | weight | opacity`
- `platforms`: `web | overlay | both` — controls which CSS output includes this token
- `category`: Grouping for the admin UI

### `themeOverrides` — Per-theme value overrides
- `themeId`: `dark` (base), `light`, or custom theme names
- `tokenPath`: FK to `designTokens.path`
- `value`: The overridden value for this theme

### `tokenBuilds` — Build output metadata
- `themeId` + `platform`: Identifies which CSS file
- `blobUrl`: Vercel Blob URL
- `hash`: Short content hash for cache-busting

## Adding a New Token

1. Insert a row into `designTokens` with the token's path, value, kind, cssProperty, platforms, and category
2. If the token has a different value in light mode, insert a row into `themeOverrides` with `themeId: 'light'`
3. Trigger a build via `POST /api/admin/tokens/build` (or use the admin UI Save button)
4. The new token appears in both overlay and web CSS output (filtered by `platforms`)

## Style Dictionary Transforms

### Platform Filter
Tokens with `platforms: 'overlay'` are excluded from the web build, and vice versa. Tokens with `platforms: 'both'` appear in both outputs.

### Opacity Adjustment (Web)
Background tokens in the overlay use semi-transparent values (for the transparent Electron window). The web transform forces alpha to 1.0 for solid page backgrounds.

### Alias Resolution
Some tokens reference others (e.g. `--k10-red` aliases `--red`). The SD build resolves these at build time.

## Build Process

```typescript
// Simplified build flow
async function buildTokens(themeId: string) {
  const tokens = await db.select().from(designTokens)
  const overrides = await db.select().from(themeOverrides).where(eq(themeOverrides.themeId, themeId))

  // Merge overrides onto base tokens
  const merged = applyOverrides(tokens, overrides)

  // Convert flat rows to nested JSON for SD
  const sdInput = toNestedJson(merged)

  // Build per platform
  for (const platform of ['web', 'overlay']) {
    const css = runStyleDictionary(sdInput, platform)
    const hash = contentHash(css)
    const url = await uploadToBlob(`tokens/${themeId}/${platform}-${hash}.css`, css)
    await upsertBuild(themeId, platform, url, hash)
  }
}
```

## CSS Output Format

```css
/* overlay.css */
:root {
  --bg: hsla(0, 0%, 8%, 0.90);
  --bg-panel: hsla(0, 0%, 6%, 0.90);
  --text-primary: hsla(0, 0%, 100%, 1.0);
  --red: #e53935;
  --corner-r: 8px;
  --ff: 'Barlow Condensed', 'Corbel', 'Segoe UI', system-ui, sans-serif;
  --t-fast: 180ms ease;
  /* ... */
}

[data-theme="light"] {
  --bg: hsla(0, 0%, 96%, 0.90);
  --text-primary: hsla(0, 0%, 10%, 1.0);
  /* ... only overridden values ... */
}
```

## Testing a Build

```bash
# In web/ directory
npx tsx src/lib/tokens/build.ts --theme dark --dry-run
# Outputs CSS to stdout without uploading to blob
```

## Debugging

- **Token missing from output:** Check `platforms` field — is it set to the right platform?
- **Wrong value:** Check `themeOverrides` — an override may be replacing the base value
- **Build fails:** Check SD config — the nested JSON structure must match SD's expected format
- **Blob upload fails:** Check `BLOB_READ_WRITE_TOKEN` env var is set in Vercel
