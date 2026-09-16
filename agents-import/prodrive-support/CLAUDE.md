# prodrive-support — RaceCor.io Pro Drive support site

User-facing help center at <https://support.racecor.io>. Public Fumadocs site; the canonical source of truth for end-user-facing documentation about the entire Pro Drive ecosystem.

## Stack

- **Next.js 16** (App Router, Cache Components-ready)
- **Fumadocs 16** — docs framework (MDX content collections, Orama search, OG image generation, llms.txt)
- **Tailwind CSS 4** + Fumadocs UI preset (`neutral` palette, themable later)
- **Biome** — formatter + linter
- **TypeScript 6**
- **Vercel** — deployed at `support.racecor.io`

## Layout

```
app/
  (home)/             marketing landing — has the Getting Started roundtrip section
  docs/[[...slug]]/   rendered MDX articles
  api/
    search/           Orama search endpoint (Fumadocs)
    v1/articles/      JSON API for native apps (list + per-slug)
  llms.txt/           index of every article (LLMs)
  llms-full.txt/      full-text dump (LLMs)
  llms.mdx/docs/      raw markdown source per article
  og/docs/            on-demand OG images per article
content/docs/         MDX articles, organized one folder per ecosystem product
lib/
  source.ts           Fumadocs source loader
  shared.ts           appName, siteUrl, gitConfig
  layout.shared.tsx   nav config shared between home + docs layouts
components/mdx.tsx    MDX component overrides
proxy.ts              Markdown content negotiation
source.config.ts      MDX collection config (frontmatter schema)
```

## Content categories — one per ecosystem product

The site mirrors the ecosystem map one-to-one. Each top-level folder in `content/docs/` is a product:

| Folder | Covers | Lives in repo |
|--------|--------|---------------|
| `getting-started/` | The 8-step roundtrip — sign-in → install → connect → race → sync → analyze → AI debrief → edit/share | (this repo only) |
| `web-app/` | racecor.io itself — dashboards, sessions, manual upload page | [prodrive-server](https://github.com/k10-motorsports/prodrive-server) |
| `chrome-extension/` | RaceCor iRacing Sync extension — install, what it captures, privacy | [prodrive-server `apps/web/browser-extension/`](https://github.com/k10-motorsports/prodrive-server) |
| `windows/` | Pro Drive Windows desktop app — install, library, hardware, LAN sharing | [prodrive-windows](https://github.com/k10-motorsports/prodrive-windows) |
| `plugin/` | SimHub plugin — install, cloud auth, localhost:8889 endpoint | [prodrive-plugin](https://github.com/k10-motorsports/prodrive-plugin) |
| `overlay/` | In-game HUD — widgets, recording, Race Coach AI | [prodrive-overlay](https://github.com/k10-motorsports/prodrive-overlay) |
| `macos/` | Pro Drive for Mac — install, Editor for clip prep | [prodrive-macos](https://github.com/k10-motorsports/prodrive-macos) |
| `ios/` | Pro Drive for iPhone & iPad (TestFlight) | [prodrive-ios](https://github.com/k10-motorsports/prodrive-ios) |
| `tvos/` | Pro Drive for Apple TV (TestFlight, device-link) | [prodrive-tvos](https://github.com/k10-motorsports/prodrive-tvos) |
| `homebridge/` | HomeKit smart-light mapping | [prodrive-homebridge](https://github.com/k10-motorsports/prodrive-homebridge) |
| `account/` | Discord OAuth, invite access, sign-in problems, deletion | (cross-cutting) |
| `troubleshooting/` | Common failures across all three sync paths, plus Race Coach + plugin diagnostics | (cross-cutting) |
| `faq/` | Quick answers — sims supported, AI key, deletion, etc. | (cross-cutting) |

Some categories surface internal repos (`prodrive-edit`, `prodrive-designer`, `prodrive-narrative`, `prodrive-telemetry`) only indirectly — those are not user-facing.

## Native-app integration

The site is consumed by the macOS / iOS / tvOS apps via:

1. **Embedded webview** — apps open `https://support.racecor.io/docs/<platform>` in a webview. Default and zero-API-cost.
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
   API responses are CORS-open, cached `s-maxage=300, stale-while-revalidate=86400` at the edge.

The native-apps-api-contract doc in `prodrive-context/` is the source of truth for API surface evolution; coordinate any breaking change to `/api/v1/articles` there.

## Skills (in `agents/skills/`)

Three support-specific skills live in this repo's mirror at `prodrive-agents/skills/`:

- **`support-content-authoring`** — voice, frontmatter shape, when to use Cards vs prose, cross-linking, what good stub-fill looks like
- **`support-app-coverage`** — keeping articles in sync as features ship across the six lockstep platforms; how to know what needs new/updated docs
- **`support-fumadocs`** — Fumadocs-specific patterns: `meta.json` ordering, theming, MDX overrides, OG generation, content negotiation via `proxy.ts`

## Deployment

- Vercel project: **`prodrive-support`** under `alternate` team
- GitHub repo: [k10-motorsports/prodrive-support](https://github.com/k10-motorsports/prodrive-support)
- Production branch: `main`
- Preview branches: every PR
- Domain: `support.racecor.io` (CNAME to `cname.vercel-dns.com`)
- No env vars required — content is static
- Independent release cadence (NOT in the six-repo lockstep)

## When making changes

- **Content edits** → use `support-content-authoring` skill, edit MDX under `content/docs/`, no PR review needed unless touching frontmatter shape
- **New product / category** → update `content/docs/meta.json`, the home page categories array in `app/(home)/page.tsx`, and add a `<category>/index.mdx` + `meta.json`
- **API change to `/api/v1/articles`** → coordinate with native apps via `../prodrive-context/native-apps-api-contract.md`; bump the v1 → v2 if breaking
- **Theming / look-and-feel** → swap `fumadocs-ui/css/neutral.css` import in `app/global.css`; available palettes documented at <https://fumadocs.dev/docs/ui/themes>

## Agent work policy

All agent-spawned work should use `isolation: "worktree"`. Exceptions: read-only exploration, single non-code file writes.
