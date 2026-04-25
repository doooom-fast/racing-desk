# K10 Motorsports — Component Architecture (React/TS Migration Reference)

## Component Tree
```
Dashboard (root)
├── LogoColumn
│   ├── K10LogoSquare (WebGL overlay canvas)
│   └── CarLogoSquare (SVG manufacturer logos, brand color bg)
├── MainArea
│   ├── FuelBlock (bar + numeric + laps estimate + pit marker)
│   ├── TyresBlock (4-cell grid FL/FR/RL/RR, temp + wear)
│   ├── ControlsBlock (BB/TC/ABS with color-coded bars)
│   ├── PedalsArea (3-layer step histograms: throttle/brake/clutch)
│   ├── MapsColumn
│   │   ├── FullMap (SVG track + player + opponents)
│   │   └── ZoomMap (same SVG, cropped viewport)
│   ├── PositionGapsColumn
│   │   ├── CycleContainer (pages with dots)
│   │   │   ├── PositionPage (P#, lap count, best time, delta)
│   │   │   └── RatingPage (iRating bar, SR pie chart)
│   │   └── GapsBlock (ahead/behind dual panel)
│   ├── CommentaryColumn (event-driven slide-in)
│   └── TachoBlock (gear, speed, RPM bar segments, WebGL overlay)
├── LeaderboardPanel (fixed, horizontally opposed)
│   ├── LBHeader
│   ├── LBRows[] (grid: pos | name | lap | ir | gap + sparkline SVG)
│   └── RaceTimeline (canvas strip)
├── DatastreamPanel (fixed, adjacent to leaderboard)
│   ├── GForceDiamond (canvas)
│   └── DSRows[] (label | value | minibar)
├── IncidentsPanel (fixed, adjacent to datastream)
├── RaceControlBanner (fixed top-center, animated stripes)
├── PitLimiterBanner (fixed top-center, blue glow)
├── SpotterPanel (fixed corner, fade in/out messages)
├── GridModule (fixed center, formation info + F1 start lights)
└── SettingsOverlay (modal with toggles, dropdowns, sliders)
```

## DOM Class Map — Shared Names, Different Panels

Several CSS classes are reused across different panels. When writing
`querySelector`/`querySelectorAll` calls, **always scope to the parent panel**
to avoid cross-panel collisions.

| Class | Panels that use it | Scope selector |
|-------|-------------------|----------------|
| `.panel-label` | fuel-block, tyres-block, gaps-block, rating pages | `.gaps-block .panel-label` etc. |
| `.panel` | Every major block | Always scope by specific sub-class |
| `.val` | pos-meta-row, datastream rows, gap rows | `.pos-meta-row .val` etc. |
| `.bar-inner` | fuel, tyres, iRating, controls | `.fuel-block .bar-inner` etc. |

**Key DOM order in dashboard.html** (affects `querySelectorAll` index):
1. `.fuel-block` (line ~136) — contains `.panel-label` "Fuel"
2. `.tyres-block` (line ~148) — contains `.panel-label` "Tyres °F"
3. `.gaps-block` (line ~303) — contains `.panel-label` "Ahead" / "Behind"

**Rule**: Never use bare `.panel-label` or `.val` selectors. Always prefix with
the parent panel class to avoid writing data into the wrong module.

## Shared Patterns for Extraction
- `TabularNums`: font-variant-numeric: tabular-nums (used 17+ times)
- `PanelBase`: background + border + border-radius + overflow:hidden
- `FlashAnimation`: keyframe for value-change flash (1.4s ease-out)
- `GlowPulse`: keyframe for breathing glow (2.5-3.5s ease-in-out alternate)
- `DimOnMode`: opacity transition for pit/grid/RC dimming states

## State Management (Current)
- `_settings` object: persisted via window.k10.saveSettings()
- `_demo` flag: switches property prefix between live and Demo.*
- `_pollFrame` counter: drives animation and cycling
- Module-specific state: `_gridActive`, `_wasInPit`, `_rcVisible`, etc.
- Sparkline history: `_sparkHistory[driverName]` array per driver

## Data Flow
1. `pollUpdate()` fetches JSON from SimHub HTTP API every 100ms
2. Properties mapped via `PROP_KEYS` array (68+ keys)
3. `v(key)` helper reads from latest poll response
4. `d(gameKey, demoKey)` swaps between live/demo based on `_demo` flag
5. Per-module update functions called in try/catch (fault isolation)
6. DOM updated via direct `.textContent`, `.style`, `.classList` manipulation
