# Component Pattern Reference

Concrete code examples extracted from the live codebase. Copy and adapt these when building new components.

## Table of Contents
1. [Hero Banner — Full Width with Decorative SVG](#hero-banner)
2. [Visual Card with Image Header](#visual-card)
3. [Compact List Item Card](#list-item-card)
4. [Data Stat Block](#stat-block)
5. [Sparkline Chart](#sparkline)
6. [Progress Ring (Circular)](#progress-ring)
7. [Score Bar (Linear)](#score-bar)
8. [Tier Badge](#tier-badge)
9. [Trend Badge](#trend-badge)
10. [Metadata Chip (Over Image)](#metadata-chip)
11. [Brand Chip with Logo](#brand-chip)
12. [License Badge](#license-badge)
13. [Empty State](#empty-state)
14. [Grid Layout (3-column)](#grid-layout)
15. [Two-Column Scroll Layout](#scroll-layout)
16. [Track Map on Card (Large/Abstract)](#track-map-card)
17. [Track Map in Hero](#track-map-hero)
18. [GameBadge Usage](#gamebadge)
19. [Country/Flag Metadata](#country-flag)
20. [Separator (Vertical Divider)](#separator)

---

<a id="hero-banner"></a>
## 1. Hero Banner — Full Width with Decorative SVG

From `TrackMasteryPage.tsx`:
```jsx
<div className="relative overflow-hidden bg-[var(--bg-panel)]">
  {/* Background photo — very subtle */}
  {heroImageUrl && (
    <img src={heroImageUrl} alt=""
         className="absolute inset-0 w-full h-full object-cover opacity-20 pointer-events-none" />
  )}
  
  {/* Decorative SVG element — right-aligned, large, translucent */}
  {heroSvgPath && (
    <div className="absolute inset-0 flex items-center justify-end pointer-events-none opacity-30 pr-16">
      <svg viewBox="0 0 100 100" className="w-[500px] h-[500px]"
           preserveAspectRatio="xMidYMid meet">
        <path d={heroSvgPath} fill="none" stroke="var(--border-accent)"
              strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )}
  
  {/* Gradient overlays */}
  <div className="absolute inset-0 bg-gradient-to-r from-[var(--bg-panel)] via-[var(--bg-panel)]/80 to-transparent pointer-events-none" />
  <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[var(--bg)] to-transparent pointer-events-none" />

  {/* Content */}
  <div className="relative z-10 px-6 pt-8 pb-10 max-w-6xl mx-auto">
    <h1 className="text-3xl lg:text-4xl font-black tracking-tight text-[var(--text)]"
        style={{ fontFamily: 'var(--ff-display)' }}>
      Track Mastery
    </h1>
    <p className="text-sm text-[var(--text-dim)] mt-2 max-w-xl">
      Master the circuits. See your progression at every track.
    </p>

    {/* Hero stats row */}
    <div className="flex items-center gap-6 mt-6">
      <div className="text-center">
        <div className="text-3xl font-black text-[var(--text)]"
             style={{ fontFamily: 'var(--ff-display)' }}>
          {uniqueTracks}
        </div>
        <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Tracks</div>
      </div>
      <div className="text-center">
        <div className="text-3xl font-black text-[var(--text)]"
             style={{ fontFamily: 'var(--ff-display)' }}>
          {totalSessions}
        </div>
        <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Sessions</div>
      </div>
    </div>
  </div>
</div>
```

---

<a id="visual-card"></a>
## 2. Visual Card with Image Header

From `TrackMasteryPage.tsx` — TrackCard with large abstract map, photo, country metadata:
```jsx
<Link
  href={`/drive/track/${encodeURIComponent(track.trackName)}`}
  className="group rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] overflow-hidden 
             flex flex-col transition-colors hover:border-[var(--border-accent)]"
  style={{ textDecoration: 'none', color: 'inherit' }}
>
  {/* Visual header — 176px tall */}
  <div className="relative h-44 overflow-hidden bg-[var(--bg-panel)]">
    {/* Background photo — very subtle */}
    <img src={imageUrl} alt=""
         className="absolute inset-0 w-full h-full object-cover opacity-15 
                    group-hover:opacity-25 transition-opacity" />

    {/* Track map SVG — LARGE, cropped, abstract */}
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden">
      <svg viewBox="0 0 100 100"
           className="w-[200%] h-[200%] opacity-40 group-hover:opacity-60 transition-opacity"
           preserveAspectRatio="xMidYMid meet"
           style={{ filter: 'blur(0.3px)' }}>
        <path d={svgPath} fill="none" stroke="var(--track-stroke)"
              strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>

    {/* Gradient fades */}
    <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-elevated)] via-transparent to-transparent" />
    <div className="absolute inset-0 bg-gradient-to-r from-[var(--bg-elevated)]/60 to-transparent" />

    {/* Top row: flag + location */}
    <div className="absolute top-3 left-4 right-4 flex items-start justify-between z-10">
      <div className="flex items-center gap-2">
        <span className="text-base leading-none">{location.flag}</span>
        <span className="text-xs text-[var(--text-dim)]">{location.city}</span>
      </div>
    </div>

    {/* Bottom overlay: mastery ring + name + tier badge */}
    <div className="absolute bottom-3 left-4 right-4 flex items-end justify-between z-10">
      <div className="flex items-center gap-2">
        <div className="bg-[var(--bg-elevated)] rounded-full p-0.5">
          <MasteryProgressRing score={score} color={tierColor} />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-[var(--text)] leading-tight"
              style={{ fontFamily: 'var(--ff-display)' }}>
            {trackName}
          </h3>
          <span className="text-xs text-[var(--text-muted)]">{location.country}</span>
        </div>
      </div>
      <TierBadge tier={masteryTier} />
    </div>
  </div>

  {/* Card body */}
  <div className="px-4 py-3 flex flex-col gap-2">
    {/* Horizontal stats */}
    <div className="flex gap-5 text-sm">
      <div>
        <span className="text-xs text-[var(--text-dim)] block">Sessions</span>
        <span className="font-semibold text-[var(--text-secondary)]">{sessions}</span>
      </div>
      <div>
        <span className="text-xs text-[var(--text-dim)] block">Avg Pos</span>
        <span className="font-semibold text-[var(--text-secondary)]">P{avgPos}</span>
      </div>
    </div>

    {/* Footer */}
    <div className="flex justify-between items-center pt-2 border-t border-[var(--border)]">
      <div className="flex items-center gap-2">
        <TrendIndicator trend={trend} />
        <GameBadge game={gameName} size={10} />
      </div>
      <span className="text-xs text-[var(--text-dim)]">{relativeTime}</span>
    </div>
  </div>
</Link>
```

---

<a id="list-item-card"></a>
## 3. Compact List Item Card

From `TopTracksAndCars.tsx`:
```jsx
<Link
  className="rounded-xl p-3 border border-[var(--border)] bg-[var(--bg-elevated)]
             hover:border-[var(--border-accent)] transition-colors flex items-center gap-3"
  style={{ textDecoration: 'none', color: 'inherit' }}
>
  {/* Left: 40×40 visual (SVG map, brand logo, or number) */}
  <div className="w-10 h-10 shrink-0 rounded-lg overflow-hidden flex items-center justify-center"
       style={{ background: 'rgba(255,255,255,0.04)' }}>
    <svg viewBox="0 0 100 100" className="w-8 h-8">
      <path d={svgPath} fill="none" stroke="var(--track-stroke)" strokeWidth="2" />
    </svg>
  </div>

  {/* Right: name + score bar + meta */}
  <div className="flex-1 min-w-0">
    <div className="text-sm font-medium text-[var(--text-secondary)] truncate"
         style={{ fontFamily: 'var(--ff-display)' }}>
      {name}
    </div>
    {/* Score bar */}
    <div className="mt-1 h-1 w-full rounded-full bg-[var(--border)]">
      <div className="h-full rounded-full" style={{ width: `${score}%`, background: color }} />
    </div>
    <div className="flex items-center gap-3 mt-1.5 text-xs text-[var(--text-muted)]">
      <span>{sessionCount} races</span>
      <span>P{avgPosition}</span>
    </div>
  </div>
</Link>
```

---

<a id="stat-block"></a>
## 4. Data Stat Block

From `DataStrip.tsx`:
```jsx
function Stat({ label, value, mono = true }) {
  return (
    <div className="flex flex-col items-left gap-0.5 px-3"
         style={{ color: 'var(--text-secondary)' }}>
      <span className="text-xs uppercase tracking-wider leading-none"
            style={{ color: 'var(--text-muted)' }}>
        {label}
      </span>
      <span className="text-xs font-bold leading-none"
            style={mono ? { fontFamily: 'var(--ff-mono)' } : undefined}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </span>
    </div>
  )
}
```

---

<a id="sparkline"></a>
## 5. Sparkline Chart

From `DataStrip.tsx` — inline SVG sparkline with gradient fill:
```jsx
const SPARK_W = 100, SPARK_H = 28, SPARK_PAD = 2

// Build path from points array
const pathD = points.map((v, i) => {
  const x = SPARK_PAD + (i / (points.length - 1)) * (SPARK_W - SPARK_PAD * 2)
  const y = SPARK_PAD + (1 - (v - min) / range) * (SPARK_H - SPARK_PAD * 2)
  return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
}).join(' ')

<svg width={SPARK_W} height={SPARK_H} viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}>
  <defs>
    <linearGradient id={`spark-fill-${id}`} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={color} stopOpacity={0.25} />
      <stop offset="100%" stopColor={color} stopOpacity={0} />
    </linearGradient>
  </defs>
  <path d={fillD} fill={`url(#spark-fill-${id})`} />
  <path d={pathD} fill="none" stroke={color} strokeWidth={1.5}
        strokeLinejoin="round" strokeLinecap="round" />
</svg>
```

---

<a id="progress-ring"></a>
## 6. Progress Ring (Circular)

From `TrackMasteryPage.tsx`:
```jsx
function MasteryProgressRing({ score, color }) {
  const circumference = 2 * Math.PI * 18
  const offset = circumference - (score / 100) * circumference
  return (
    <svg width="48" height="48" viewBox="0 0 48 48">
      <circle cx="24" cy="24" r="18" fill="none"
              stroke="var(--border)" strokeWidth="3" />
      <circle cx="24" cy="24" r="18" fill="none"
              stroke={color} strokeWidth="3"
              strokeDasharray={circumference} strokeDashoffset={offset}
              strokeLinecap="round" transform="rotate(-90 24 24)" />
      <text x="24" y="24" textAnchor="middle" dominantBaseline="central"
            fill="var(--text-secondary)" fontSize="11" fontWeight="bold">
        {score}
      </text>
    </svg>
  )
}
```

---

<a id="score-bar"></a>
## 7. Score Bar (Linear)

```jsx
<div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--border)' }}>
  <div className="h-full transition-all duration-500"
       style={{ width: `${value}%`, background: `linear-gradient(90deg, var(--border-accent), rgba(229,57,53,0.3))` }} />
</div>
```

---

<a id="tier-badge"></a>
## 8. Tier Badge

```jsx
const TIER_COLORS = { bronze: '#cd7f32', silver: '#c0c0c0', gold: '#ffd700', diamond: '#b9f2ff' }

function TierBadge({ tier }) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium 
                    bg-[rgba(0,0,0,0.4)] backdrop-blur-sm border border-[rgba(255,255,255,0.1)]"
         style={{ color: TIER_COLORS[tier] }}>
      <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: TIER_COLORS[tier] }} />
      <span>{tier.charAt(0).toUpperCase() + tier.slice(1)}</span>
    </div>
  )
}
```

---

<a id="trend-badge"></a>
## 9. Trend Badge

```jsx
// IMPORTANT: Use proper HSL alpha syntax, NOT string concatenation
const trendColor = trend === 'improving' ? 'hsl(142,60%,55%)' 
                 : trend === 'declining' ? 'hsl(0,80%,60%)' 
                 : 'var(--text-muted)'
const trendBg = trend === 'improving' ? 'hsl(142 60% 55% / 0.13)' 
              : trend === 'declining' ? 'hsl(0 80% 60% / 0.13)' 
              : 'hsl(0 0% 50% / 0.1)'

<div className="flex items-center gap-1 w-fit px-2 py-1 rounded-full"
     style={{ backgroundColor: trendBg }}>
  <TrendingUp className="w-4 h-4" style={{ color: trendColor }} />
  <span className="text-xs font-medium" style={{ color: trendColor }}>Improving</span>
</div>
```

---

<a id="metadata-chip"></a>
## 10. Metadata Chip (Over Image)

```jsx
<div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 px-2 py-1 rounded-full"
     style={{ background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(255,255,255,0.18)', 
              backdropFilter: 'blur(6px)' }}>
  <GameBadge game={gameName} size={14} />
</div>
```

---

<a id="brand-chip"></a>
## 11. Brand Chip with Logo

From `RaceCard.tsx`:
```jsx
<div className="flex items-center gap-1.5 px-2 py-1"
     style={{
       background: color ? `${color}55` : 'rgba(0,0,0,0.55)',
       border: `1px solid ${color ? `${color}99` : 'var(--border)'}`,
       backdropFilter: 'blur(6px)',
       borderRadius: 'var(--corner-r-sm)',
     }}>
  {logoSrc && <img src={logoSrc} className="h-3.5 w-auto" />}
  <span className="text-xs font-bold">{brandName}</span>
</div>
```

---

<a id="license-badge"></a>
## 12. License Badge

```jsx
const LICENSE_COLOR = {
  A: 'hsl(210, 80%, 45%)', B: 'hsl(142, 50%, 45%)',
  C: 'hsl(45, 80%, 45%)',  D: 'hsl(25, 80%, 45%)',  R: 'hsl(0, 60%, 45%)'
}

<span className="text-xs font-black leading-none px-1 py-0.5 rounded-sm"
      style={{ background: LICENSE_COLOR[license], color: 'white' }}>
  {license}{safetyRating}
</span>
```

---

<a id="empty-state"></a>
## 13. Empty State

```jsx
<div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--bg-elevated)] 
                px-8 py-12 text-center">
  <Target className="w-16 h-16 mx-auto mb-6 opacity-50" style={{ color: 'var(--border-accent)' }} />
  <h2 className="text-xl font-semibold mb-2" style={{ color: 'var(--text)' }}>
    Complete at least 3 races to generate your Driver DNA profile
  </h2>
  <p style={{ color: 'var(--text-secondary)' }}>
    You currently have {count} race{count !== 1 ? 's' : ''} logged. Keep racing and your profile will unlock!
  </p>
</div>
```

---

<a id="grid-layout"></a>
## 14. Grid Layout (3-column)

```jsx
<div className="max-w-6xl mx-auto px-6 py-8">
  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
    {items.map(item => <Card key={item.id} {...item} />)}
  </div>
</div>
```

---

<a id="scroll-layout"></a>
## 15. Two-Column Scroll Layout (Dashboard)

```jsx
<main className="fixed inset-0" style={{ zIndex: 1 }}>
  <DataStrip ... />
  <div className="absolute inset-0 max-w-[120rem] mx-auto px-6 w-full">
    <section className="h-full grid grid-cols-1 md:grid-cols-[3fr_1fr] gap-4">
      {/* Left column — independent scroll */}
      <div className="overflow-y-auto pb-6 pr-2"
           style={{ scrollbarGutter: 'stable',
                    paddingTop: 'calc(var(--header-h) + var(--datastrip-h) + 24px)' }}>
        {/* Content */}
      </div>
      {/* Right column — independent scroll */}
      <div className="overflow-y-auto pb-6 pl-2"
           style={{ scrollbarGutter: 'stable',
                    paddingTop: 'calc(var(--header-h) + var(--datastrip-h) + 24px)' }}>
        {/* Sidebar content */}
      </div>
    </section>
  </div>
</main>
```

---

<a id="track-map-card"></a>
## 16. Track Map on Card (Large/Abstract)

The map should dominate the card header — oversized and cropped:
```jsx
<div className="relative h-44 overflow-hidden bg-[var(--bg-panel)]">
  <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden">
    <svg viewBox="0 0 100 100"
         className="w-[200%] h-[200%] opacity-40 group-hover:opacity-60 transition-opacity"
         preserveAspectRatio="xMidYMid meet"
         style={{ filter: 'blur(0.3px)' }}>
      <path d={svgPath} fill="none" stroke="var(--track-stroke)"
            strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </div>
</div>
```

---

<a id="track-map-hero"></a>
## 17. Track Map in Hero

Contained and decorative:
```jsx
<div className="absolute inset-0 flex items-center justify-end pointer-events-none opacity-30 pr-16">
  <svg viewBox="0 0 100 100" className="w-[500px] h-[500px]"
       preserveAspectRatio="xMidYMid meet">
    <path d={svgPath} fill="none" stroke="var(--border-accent)"
          strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
</div>
```

---

<a id="gamebadge"></a>
## 18. GameBadge Usage

Always use the shared component:
```jsx
import GameBadge from '@/components/GameBadge'

// In cards/lists — small
<GameBadge game="iracing" size={10} />

// On image overlays — medium
<GameBadge game={gameName} size={14} />

// Never do this:
<span>{gameName}</span>  // ❌ Plain text
```

---

<a id="country-flag"></a>
## 19. Country/Flag Metadata

```jsx
import { getTrackLocation } from '@/data/track-metadata'

const location = getTrackLocation(trackName)

// In card headers
{location && <span className="text-base leading-none">{location.flag}</span>}
{location && <span className="text-xs text-[var(--text-dim)]">{location.city}</span>}

// Under track names
{location && <span className="text-xs text-[var(--text-muted)]">{location.country}</span>}
```

---

<a id="separator"></a>
## 20. Separator (Vertical Divider)

Used between stat blocks in the DataStrip:
```jsx
function Separator() {
  return <div className="w-px self-stretch bg-[var(--border)] shrink-0" />
}
```

---

## Category Colors (Racing Disciplines)

```js
const CAT_COLOR = {
  road:      '#e53935',  // Red
  oval:      '#1e88e5',  // Blue
  dirt_road: '#43a047',  // Green
  dirt_oval: '#ff9800',  // Orange
  formula:   '#00bcd4',  // Cyan
}

const CAT_LABEL = {
  road: 'Sports Car', oval: 'Oval', dirt_road: 'Dirt Road',
  dirt_oval: 'Dirt Oval', formula: 'Formula',
}
```
