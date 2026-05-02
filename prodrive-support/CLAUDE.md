# prodrive-support — RaceCor.io Pro Drive support site

User-facing help center at <https://support.racecor.io>. Help articles for the web app and the macOS / iOS / tvOS / Windows native apps.

## Stack

- Next.js 16 (App Router, Cache Components-ready)
- Fumadocs 16 — docs framework (MDX content collections, Orama search, OG image generation, llms.txt)
- Tailwind CSS 4 + Fumadocs UI preset (`neutral` palette by default — themable later)
- Biome — formatter + linter
- TypeScript 6
- Vercel — deployed at `support.racecor.io`

## Layout

```
app/
  (home)/             marketing landing with category cards
  docs/[[...slug]]/   rendered MDX articles
  api/
    search/           Orama search endpoint (Fumadocs)
    v1/articles/      JSON API for native apps (list + per-slug)
  llms.txt/           index of every article (LLMs)
  llms-full.txt/      full-text dump (LLMs)
  llms.mdx/docs/      raw markdown source per article
  og/docs/            on-demand OG images per article
content/docs/         MDX articles, organized by product category
lib/
  source.ts           Fumadocs source loader
  shared.ts           appName, siteUrl, gitConfig
  layout.shared.tsx   nav config shared between home + docs layouts
components/mdx.tsx    MDX component overrides
proxy.ts              Markdown content negotiation
source.config.ts      MDX collection config (frontmatter schema)
```

## Content categories

Each top-level folder under `content/docs/` is a product category:

- `web-app/` — racecor.io itself
- `macos/` — Pro Drive for Mac (notarized .dmg, not App Store)
- `ios/` — Pro Drive for iPhone & iPad (TestFlight)
- `tvos/` — Pro Drive for Apple TV (TestFlight)
- `windows/` — combined plugin + overlay installer
- `overlay/` — in-game HUD configuration
- `troubleshooting/` — diagnostic articles, log gathering, bug-filing
- `faq/` — quick answers

## Native-app integration

Two ways apps consume support content:

1. **Embedded webview** — apps open `https://support.racecor.io/docs/<platform>` and render in a webview. Default and zero-API-cost.
2. **JSON API** — apps that want native rendering call `GET /api/v1/articles?category=<platform>` for the index and `GET /api/v1/articles/<slug>` for a specific article. Response shape:
   ```json
   {
     "slug": "macos/install",
     "category": "macos",
     "title": "Install Pro Drive on macOS",
     "description": "...",
     "url": "https://support.racecor.io/docs/macos/install",
     "body": "<processed markdown>",
     "toc": [ /* fumadocs toc */ ]
   }
   ```
   API responses are CORS-open, cached `s-maxage=300, stale-while-revalidate=86400` at the edge, and served as static at build time (`force-static`).

The native-apps-api-contract doc in `agents/prodrive-context/` is the source of truth for API surface evolution; coordinate any breaking change to `/api/v1/articles` there.

## Skills

Live in `agents/skills/` (via the prodrive-agents submodule). Support-specific:

- **`support-content-authoring`** — voice, frontmatter shape, when to use Cards vs prose, cross-linking, what good stub-fill looks like
- **`support-app-coverage`** — keeping articles in sync as features ship across the six lockstep platforms; how to know what needs new/updated docs
- **`support-fumadocs`** — Fumadocs-specific patterns: meta.json ordering, `--separator---` headers, image handling, OG generation, content negotiation via `proxy.ts`

## Deployment

- Vercel project: `prodrive-support` under `alternate` team
- Production branch: `main`
- Preview branches: every PR
- Domain: `support.racecor.io` (CNAME to `cname.vercel-dns.com`)
- No env vars required for the content site itself

## When making changes

- **Content edits** → use `support-content-authoring` skill, edit MDX under `content/docs/`, no code review needed unless touching frontmatter shape
- **New product / category** → update `content/docs/meta.json`, the home page categories array in `app/(home)/page.tsx`, and add a `<category>/index.mdx` + `meta.json`
- **API change to `/api/v1/articles`** → coordinate with native apps via `agents/prodrive-context/native-apps-api-contract.md`; bump the v1 → v2 if breaking
- **Theming / look-and-feel** → swap `fumadocs-ui/css/neutral.css` import in `app/global.css`; available palettes documented at <https://fumadocs.dev/docs/ui/themes>
