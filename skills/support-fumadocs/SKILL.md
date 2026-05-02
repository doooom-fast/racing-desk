---
name: support-fumadocs
description: |
  Fumadocs-specific patterns and gotchas for the prodrive-support repo. Use this skill when touching anything that hooks into the Fumadocs framework itself: `source.config.ts`, `lib/source.ts`, `app/docs/**`, `app/api/search/**`, `app/llms*` routes, `app/og/**`, `proxy.ts`, `meta.json` ordering syntax, theming via `fumadocs-ui/css/*.css`, MDX component overrides in `components/mdx.tsx`, or the JSON API at `app/api/v1/articles/**` that consumes the Fumadocs source loader. Skip this skill for plain MDX content edits — those use `support-content-authoring`.
---

# Fumadocs patterns for prodrive-support

This is the tactical reference for the Fumadocs machinery. Content authors don't need this — engineers extending the framework do.

## Versions in use

- `fumadocs-core@16.8.5`
- `fumadocs-ui@16.8.5`
- `fumadocs-mdx@14.3.2` ← **note**: `fumadocs-mdx` versions independently from core/ui, don't try to align them

When upgrading: bump `core` and `ui` together, bump `mdx` separately, then run `npm run types:check` (which runs `fumadocs-mdx && next typegen && tsc --noEmit` and surfaces breakage).

## The collection pipeline

```
content/docs/**/*.mdx
        │
        ▼  (build / dev)
fumadocs-mdx generates .source/  ← `collections/server` import resolves here
        │
        ▼
lib/source.ts → loader({ source: docs.toFumadocsSource() })
        │
        ▼
source.getPages() / source.getPage(slugs) / source.getPageTree()
        │
        ▼
- app/docs/[[...slug]]/page.tsx    (renders one article)
- app/docs/layout.tsx              (sidebar from getPageTree)
- app/api/search/route.ts          (Orama index from all pages)
- app/api/v1/articles/**           (JSON API consumes same source)
- app/llms*.txt routes             (LLM-friendly dumps)
- app/og/docs/[...slug]            (per-page OG images)
```

`.source/` is gitignored. The `fumadocs-mdx` CLI runs at build start (and on `dev`); if you ever see "module not found: collections/server", run `npx fumadocs-mdx` once to regenerate.

## Frontmatter schema

`source.config.ts` uses `pageSchema` from `fumadocs-core/source/schema` (Zod). Default fields: `title` (required), `description` (optional), `full` (boolean), `icon` (string).

To add a custom field (e.g. `audience: "racer" | "engineer"`):

```ts
import { z } from 'zod';
import { pageSchema } from 'fumadocs-core/source/schema';

export const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    schema: pageSchema.extend({
      audience: z.enum(['racer', 'engineer']).optional(),
    }),
    ...
  },
});
```

Then access as `page.data.audience` in `app/docs/[[...slug]]/page.tsx`.

## `meta.json` sidebar syntax

Each folder controls its sidebar order via `meta.json`:

```json
{
  "title": "Windows",
  "pages": ["index", "install", "simhub", "uninstall"]
}
```

Special tokens in the `pages` array:

- `"---Label---"` — renders as a section separator with `Label` text
- `"..."` — wildcard, expands to "all remaining pages alphabetically"
- `"![title]"` — hidden from sidebar but still routable
- `"[Visible](slug)"` — rename the link text without renaming the file

Validated by `metaSchema` in `source.config.ts`. CI catches typos.

## Search (Orama)

`app/api/search/route.ts` uses `createFromSource(source, { language: 'english' })`. The index is built at request time per route invocation — for our scale (low hundreds of articles) this is fine.

If we cross ~500 articles or search latency becomes an issue, switch to **Orama Cloud** by passing `{ tag: '...' }` and following <https://fumadocs.dev/docs/headless/search/orama-cloud>. That moves indexing to a build step.

The frontend search UI is provided by Fumadocs' `RootProvider` (in `app/layout.tsx`) — no extra wiring needed.

## Theming

Two CSS imports in `app/global.css` control the look:

```css
@import 'fumadocs-ui/css/neutral.css';   ← color palette
@import 'fumadocs-ui/css/preset.css';    ← Tailwind preset
```

Available palettes: `neutral`, `dusty`, `vitepress`, `catppuccin`, `ocean`, `purple`. To re-theme, swap the first import. To do custom branding (RaceCor brand colors), override CSS variables in `app/global.css` after the imports — see <https://fumadocs.dev/docs/ui/theme>.

When we want to match the racecor.io marketing site palette, the design tokens to import live in `prodrive-server/packages/components` (see `agents/prodrive-server/packages/components/CLAUDE.md`). Mirror the `--racecor-*` CSS variables here as Fumadocs' `--color-fd-*` overrides.

## MDX component overrides

`components/mdx.tsx` is where you add custom components usable in MDX without an explicit import. The current setup spreads `defaultMdxComponents` (which provides `<Cards>`, `<Card>`, `<Callout>`, `<Step>`, `<Steps>`, etc.). To add a custom component:

```ts
import defaultMdxComponents from 'fumadocs-ui/mdx';
import { VideoEmbed } from './video-embed';

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    VideoEmbed,
    ...components,
  } satisfies MDXComponents;
}
```

Then use `<VideoEmbed src="..." />` in any `.mdx` file with no import.

## Markdown content negotiation (`proxy.ts`)

`proxy.ts` rewrites requests so that:

- `GET /docs/macos/install` with `Accept: text/markdown` → `/llms.mdx/docs/macos/install/content.md` (raw markdown)
- `GET /docs/macos/install.mdx` (any client) → same raw markdown

This is what makes the site LLM-friendly without a separate API surface. Don't remove this file — the `MarkdownCopyButton` and `ViewOptionsPopover` in `app/docs/[[...slug]]/page.tsx` rely on it.

## OG image generation

`app/og/docs/[...slug]/route.tsx` generates per-article OG images on demand using `next-og`. Cached at the edge. To restyle, edit that route — it's a self-contained `ImageResponse`.

## JSON API for native apps (`/api/v1/articles`)

These routes consume the Fumadocs source loader directly:

- `app/api/v1/articles/route.ts` — list endpoint
- `app/api/v1/articles/[...slug]/route.ts` — per-article

Both are `force-static` (Next.js generates them at build time) and cached at the edge per `vercel.json` headers. The body field uses `page.data.getText('processed')` — that returns the post-processed markdown string (not the raw frontmatter+body, not the React tree).

**If you change the response shape, bump the path to `/api/v2/...` and keep v1 around for a deprecation window** — native apps can be slow to update. Document the change in `agents/prodrive-context/native-apps-api-contract.md`.

## Static generation

`generateStaticParams()` in `app/docs/[[...slug]]/page.tsx` and the API routes returns every page from `source.generateParams()` / `source.getPages()`. Vercel will pre-render every article at build. Build time scales linearly with article count — at ~1000 articles you may want to switch to ISR; until then, fully static is fine and better for the support use case (no cold starts).

## llms.txt

`app/llms.txt/route.ts` and `app/llms-full.txt/route.ts` produce the standard <https://llmstxt.org/> indexes. These are unconditionally enabled. The site is intentionally LLM-readable so Claude / ChatGPT / etc. can answer support questions accurately when users ask elsewhere.

## Common gotchas

- **`workspace:*` in package.json** — the upstream Fumadocs starter uses `workspace:*` for its monorepo. Our repo pins explicit versions; never re-introduce `workspace:*`.
- **`@types/react@19.x` + `react@19.x` mismatch** — Fumadocs 16 requires React 19. If you bump React, bump types together or you'll see hundreds of phantom JSX errors.
- **Tailwind v4 has no config file** — there's no `tailwind.config.ts`. Configuration lives in `app/global.css` via `@theme` blocks. Don't add a config file or things will silently break.
- **`fumadocs-mdx` typegen runs implicitly during `next dev`** — but if you delete `.source/` while the dev server is running, restart the server.
