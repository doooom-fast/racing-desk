---
name: racecor-design-system
description: |
  The complete RaceCor.io Pro Drive design system — tokens, component patterns, typography, layout conventions, and visual language. Use this skill whenever building, modifying, or reviewing ANY UI component in the Pro Drive app (src/app/drive/**). This includes: creating new pages or sections, adding cards/lists/badges, designing hero banners, building data visualizations, styling empty states, or touching anything visual. Also trigger when the user mentions "design system", "styling", "theme", "component", "card", "badge", "layout", or asks to match the existing look-and-feel. If in doubt about how something should look in Pro Drive, use this skill.
---

# RaceCor.io Pro Drive — Design System

This skill captures the full visual language of the Pro Drive sim racing dashboard. Every new component should feel like it belongs alongside the existing pages. The goal is consistency — not uniformity. Each page has character, but they all share the same DNA.

## How to Use This Skill

1. Read this file first for the principles and token reference
2. For concrete code examples, read `references/patterns.md`
3. When building a new component, find the closest existing pattern in the reference and adapt it

---

## Design Tokens (CSS Custom Properties)

All colors, typography, and spacing are controlled by CSS custom properties defined in `src/styles/globals.css`. A remote "token blob" can override these (loaded per-team for F1 branding), so **never hardcode colors** — always use the variables.

### Backgrounds (layered elevation)
```
--bg:          #0a0a14              — Page background (deepest)
--bg-surface:  rgba(16,16,32,0.90)  — Translucent floating surfaces (DataStrip, overlays)
--bg-panel:    rgba(10,10,20,0.95)  — Hero banners, panel backgrounds
--bg-elevated: rgba(24,24,48,0.85)  — Cards, modals, elevated content
```
Elevation increases opacity. Cards sit on `--bg-elevated`, heroes on `--bg-panel`, the page itself on `--bg`.

### Borders
```
--border:        rgba(255,255,255,0.14)  — Default card/divider borders
--border-subtle: rgba(255,255,255,0.06)  — Very faint separators
--border-accent: rgba(229,57,53,0.35)    — K10 red accent (hover states, highlights)
```

### Text Hierarchy
```
--text:           #e8e8f0                — Primary text (headings, body)
--text-secondary: rgba(255,255,255,0.69) — Secondary text (card content, values)
--text-dim:       rgba(255,255,255,0.55) — Tertiary (labels, descriptions)
--text-muted:     rgba(255,255,255,0.45) — Least prominent (metadata, captions)
```
Use `--text` for headings and primary content, step down through the hierarchy for supporting text. Never skip more than one level.

### Brand Colors
```
--k10-red:      #e53935  — Primary brand red (buttons, accents)
--k10-red-mid:  #b02020  — Mid-tone (large decorative elements only)
--k10-red-dark: #700010  — Dark (backgrounds/borders only, never text)
```

### Semantic Colors
```
--green:  #43a047   --blue:   #1e88e5   --amber:  #ffb300
--purple: #7c6cf0   --cyan:   #00acc1
```

### Typography
```
--ff:         sofia-pro-comp, sans-serif     — Body text
--ff-display: "stolzl", sans-serif           — Headlines, stats, card titles
--ff-mono:    'JetBrains Mono', monospace    — Numbers, data, lap times
```

**Rules:**
- All headings (h1–h3) and card titles use `fontFamily: 'var(--ff-display)'`
- Numeric data (iRating, positions, lap times, stats) use `fontFamily: 'var(--ff-mono)'` with `tabular-nums`
- Body text inherits `var(--ff)` from the body element
- Large display numbers (hero stats) use `var(--ff-display)` with `font-black`

### Layout Constants
```
--header-h:    41px   — Fixed nav header height
--datastrip-h: 46px   — DataStrip height (below header)
--corner-r:    12px   — Default card border radius
--corner-r-sm: 6px    — Small radius (chips, badges)
```

### Font Sizes
Font sizes use a token scale (`--fs-xs` through `--fs-9xl`) bridged to Tailwind utilities. The fallback values are compact — body is 16px, `text-xs` is 10px, `text-sm` is 11px. Prefer `text-sm` as the minimum readable size for content (per user feedback — avoid `text-xs` for anything the user needs to read).

---

## Light Theme

All tokens have light-mode variants under `[data-theme="light"]`. Never use raw white/black — always use the token variables so themes work automatically.

---

## Component Patterns

### Cards
The standard card:
```jsx
<div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5
                hover:border-[var(--border-accent)] transition-colors">
```
- **Border radius**: `rounded-xl` (12px) for cards, `rounded-lg` for smaller items
- **Background**: `bg-[var(--bg-elevated)]`
- **Border**: `border-[var(--border)]`, upgrades to `border-[var(--border-accent)]` on hover
- **Transition**: Always `transition-colors` on interactive cards
- **Padding**: `p-5` for full cards, `p-3` for compact list items

### Hero Banners (Page Headers)
Every Pro Drive page uses a full-width hero:
```jsx
<div className="relative overflow-hidden bg-[var(--bg-panel)]">
  {/* Optional background image — very low opacity */}
  <img className="absolute inset-0 w-full h-full object-cover opacity-15" />
  
  {/* Gradient overlays — ALWAYS include both */}
  <div className="absolute inset-0 bg-gradient-to-r from-[var(--bg-panel)] via-[var(--bg-panel)]/80 to-transparent" />
  <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[var(--bg)] to-transparent" />
  
  {/* Content — constrained width */}
  <div className="relative z-10 px-6 pt-8 pb-10 max-w-6xl mx-auto">
    <h1 className="text-3xl lg:text-4xl font-black tracking-tight"
        style={{ fontFamily: 'var(--ff-display)', color: 'var(--text)' }}>
      Page Title
    </h1>
    <p className="text-sm mt-2 max-w-xl" style={{ color: 'var(--text-dim)' }}>
      Subtitle description
    </p>
  </div>
</div>
```
Key elements:
- Left-to-right gradient preserves text readability over imagery
- Bottom gradient blends into `--bg` page background
- Decorative elements (SVG track maps, radar charts) positioned absolute, right-aligned, low opacity
- Content at `z-10` above overlays

### Empty States
```jsx
<div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--bg-elevated)] 
                px-8 py-12 text-center">
  <IconComponent size={48} className="mx-auto mb-4 opacity-50" style={{ color: 'var(--text-muted)' }} />
  <h2 className="text-xl font-semibold mb-2" style={{ color: 'var(--text)' }}>
    Primary message
  </h2>
  <p style={{ color: 'var(--text-dim)' }}>Supporting explanation</p>
</div>
```
- Dashed border distinguishes from data cards
- Centered icon at reduced opacity
- Warm, encouraging copy (never "No data found" — instead "Keep racing and...")

### Badges & Chips

**GameBadge** — use `<GameBadge game={name} size={12} />` from `@/components/GameBadge`. Renders the iRacing logo inline, falls back to text pill for unknown games. Use everywhere a game name appears.

**Metadata chips** (on cards, over images):
```jsx
<span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold"
      style={{ 
        background: 'rgba(0,0,0,0.55)', 
        border: '1px solid rgba(255,255,255,0.18)',
        backdropFilter: 'blur(6px)' 
      }}>
```

**Brand chips** (with color):
```jsx
style={{
  background: `${brandColor}55`,  // hex color + alpha
  border: `1px solid ${brandColor}99`,
  backdropFilter: 'blur(6px)',
}}
```

**License badges** (iRating/Safety):
```jsx
<span className="text-xs font-black px-1 py-0.5 rounded-sm"
      style={{ background: licenseColor, color: 'white' }}>
  A4.52
</span>
```
License colors: A=blue `hsl(210,80%,45%)`, B=green `hsl(142,50%,45%)`, C=yellow `hsl(45,80%,45%)`, D=orange `hsl(25,80%,45%)`, R=red `hsl(0,60%,45%)`

**Trend badges**:
```jsx
<div className="flex items-center gap-1 px-2 py-1 rounded-full"
     style={{ backgroundColor: 'hsl(142 60% 55% / 0.13)' }}>
  <TrendingUp className="w-4 h-4" style={{ color: 'hsl(142,60%,55%)' }} />
  <span className="text-xs font-medium" style={{ color: 'hsl(142,60%,55%)' }}>Improving</span>
</div>
```
Never append hex alpha to HSL strings (e.g., `hsl(...)22` is invalid CSS). Use `hsl(h s% l% / alpha)` syntax.

### Track Maps (SVG)
Track SVG paths are stored in the `track_maps` DB table. When displayed:
```jsx
<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
  <path d={svgPath} fill="none" stroke="var(--track-stroke)" 
        strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
</svg>
```
- **On cards**: Make maps LARGE and cropped — `w-[200%] h-[200%]` inside an `overflow-hidden` container. This creates an abstract, graphic feel.
- **In heroes**: Large but contained — `w-[500px] h-[500px]`, low opacity (0.3), right-aligned
- **Stroke**: Use `var(--track-stroke)` which adapts to theme

### Data Display

**Stat blocks** (DataStrip pattern):
```jsx
<div className="flex flex-col items-left gap-0.5 px-3">
  <span className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
    Label
  </span>
  <span className="text-xs font-bold" style={{ fontFamily: 'var(--ff-mono)' }}>
    {value.toLocaleString()}
  </span>
</div>
```

**Score/progress bars**:
```jsx
<div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--border)' }}>
  <div className="h-full transition-all duration-500"
       style={{ width: `${score}%`, background: tierColor }} />
</div>
```

**Mastery progress rings** (circular SVG):
- 48×48px, stroke-based circle with `strokeDasharray`/`strokeDashoffset`
- Score number centered inside

### Fixed Layout (Dashboard)
The dashboard uses a fixed viewport layout:
```
┌─────────────────────────────┐
│ DriveHeader (sticky z-40)   │  ← backdrop-blur-md, bg-elevated
├─────────────────────────────┤
│ DataStrip (absolute z-20)   │  ← backdrop-blur-md, bg-surface, top: var(--header-h)
├──────────────────┬──────────┤
│ Left column      │ Right    │  ← Both overflow-y-auto, independent scroll
│ (3fr)            │ (1fr)    │  ← paddingTop: calc(header + datastrip + 24px)
│                  │          │
│ Content scrolls  │          │  ← Content scrolls BEHIND translucent headers
│ behind headers   │          │
└──────────────────┴──────────┘
```

### Country/Location Metadata
Track location data (country, flag emoji, city) is available via `getTrackLocation(trackName)` from `@/data/track-metadata`. Display as:
```jsx
{location && <span className="text-base">{location.flag}</span>}
{location && <span className="text-xs" style={{ color: 'var(--text-dim)' }}>{location.city}</span>}
```

---

## Anti-Patterns (Things NOT to Do)

1. **Don't use `text-xs` for readable content** — user finds it too small. Use `text-sm` minimum.
2. **Don't hardcode colors** — always use CSS custom properties.
3. **Don't append hex alpha to HSL** — `hsl(0,60%,45%)22` is invalid. Use `hsl(0 60% 45% / 0.13)`.
4. **Don't make track maps tiny** — they should be large, cropped, and abstract on cards.
5. **Don't render game names as plain text** — use `<GameBadge>` component everywhere.
6. **Don't use generic empty states** — copy should be encouraging and racing-themed.
7. **Don't forget the bottom gradient** on heroes — content needs to blend into `--bg`.
8. **Don't skip `transition-colors`** on interactive/hoverable cards.
9. **Don't use the iRacing Data API** — the whole architecture works around not having access to it.

---

## Shared Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `GameBadge` | `@/components/GameBadge` | Inline game logo (iRacing SVG, text fallback) |
| `LogoMark` | `@/components/LogoMark` | RaceCor logomark (theme-aware) |
| `DriveHeader` | `@/components/DriveHeader` | Fixed nav header with auth |
| `DataStrip` | `drive/dashboard/DataStrip` | Rating sparklines strip |
| `DashboardBackground` | `@/components/DashboardBackground` | Animated background |

---

## File Locations

| What | Path |
|------|------|
| Global tokens/CSS | `src/styles/globals.css` |
| Track metadata | `src/data/track-metadata.ts` |
| Track images | `src/lib/commentary-images.ts` |
| Mastery computation | `src/lib/mastery.ts` |
| Brand data | `src/data/master-brands.json` |
| DB schema | `src/db/schema.ts` |

For full code examples of every pattern, see `references/patterns.md`.
