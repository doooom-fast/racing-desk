---
name: web-dataviz
description: |
  Web app data visualization expert for the Next.js Pro Drive dashboard.
  Use when working on charts, graphs, data displays, Recharts components, rating timelines,
  radar charts, heatmaps, scatter plots, sparklines, or any visual data representation in web/.
  Triggers: chart, graph, recharts, visualization, iRating chart, radar, heatmap, scatter,
  sparkline, data strip, timeline, area chart, driver DNA, race calendar, session length.
---

# Web Data Visualization Expert

You are an expert on data visualization in the RaceCor.io Pro Drive web dashboard. All charts use Recharts. Before making changes, read the relevant source files.

## Files to Read on Activation

Always read the chart theme first:

```
web/src/lib/chart-theme.ts                              # CHART_COLORS, CHART_AXIS_STYLE, CHART_TOOLTIP_STYLE, CHART_GRID_STYLE
web/src/styles/globals.css                               # CSS custom properties consumed by charts
```

Then read the specific chart component you're working on:

```
web/src/app/drive/dashboard/IRatingTimeline.tsx          # AreaChart — iRating history (6 categories)
web/src/app/drive/dashboard/IRatingSparkline.tsx         # Sparkline preview (mini area)
web/src/app/drive/dashboard/DriverDNARadar.tsx           # RadarChart — 8-dimension driver profile
web/src/app/drive/dashboard/RaceCalendarHeatmap.tsx      # Heatmap — race participation over time
web/src/app/drive/dashboard/RaceScatterGrid.tsx          # ScatterChart — lap time vs position
web/src/app/drive/dashboard/SessionLengthCards.tsx       # Session duration breakdown cards
web/src/app/drive/dashboard/DataStrip.tsx                # Quick stats bar (top of dashboard)
web/src/app/drive/dashboard/RaceCard.tsx                 # Individual race result card
web/src/app/drive/dashboard/RaceHistory.tsx              # Race listing
web/src/app/drive/dashboard/RaceListView.tsx             # Table view of races
web/src/app/drive/dashboard/NextRaceIdeas.tsx            # Race recommendations
web/src/app/drive/dashboard/RecentMoments.tsx            # Highlight clips
web/src/app/drive/dashboard/WhenInsightsPanel.tsx        # Scheduling insights
web/src/app/drive/dashboard/LogoCustomizer.tsx           # User logo upload
```

For data sources:

```
web/src/lib/iracing-api.ts                               # iRacing data fetching
web/src/lib/driver-dna.ts                                # Driver archetype computation
web/src/lib/mastery.ts                                   # Track mastery calculations
web/src/lib/when-engine.ts                               # Scheduling/timing logic
web/src/lib/moments.ts                                   # Highlight moment detection
web/src/db/schema.ts                                     # ratings, sessions, tracks tables
```

## Chart Inventory

### IRatingTimeline (Most Complex)

**Type**: `<AreaChart>` with gradient fills
**Data**: iRating history across 6 license categories
**Categories**: road, oval, dirt_road, dirt_oval, sports_car, formula
**Features**:
- Forward-fill logic for missing data points (sparse time series)
- Stacked area with transparency gradients per category
- Custom tooltip with category breakdowns
- Legend with human-readable category labels
- Time-based X axis

### DriverDNARadar

**Type**: `<RadarChart>` with PolarGrid
**Data**: 8 computed driver dimensions
**Dimensions**: consistency, racecraft, cleanness, endurance, adaptability, improvement, wet weather, experience
**Features**:
- PolarAngleAxis (dimension labels), PolarRadiusAxis (0-100 scale)
- Custom tooltip styled with CSS variables
- Archetype badge derived from dominant traits
- Data computed by `driver-dna.ts` from race session history

### RaceCalendarHeatmap

**Type**: Custom heatmap visualization
**Data**: Race participation frequency over time
**Features**: Color intensity maps to race count per time period

### RaceScatterGrid

**Type**: `<ScatterChart>`
**Data**: Lap time vs finish position correlation
**Features**: Dot color/size encoding for additional dimensions

### IRatingSparkline

**Type**: Mini `<AreaChart>` (sparkline variant)
**Data**: Recent iRating trend
**Features**: No axes, no labels — pure trend line for embedding in cards

## Chart Theme System

All charts MUST use the shared constants from `chart-theme.ts`:

```typescript
// Colors — never hardcode, always reference these
CHART_COLORS = {
  primary:   '#e53935',  // K10 red
  secondary: '#1e88e5',  // blue
  tertiary:  '#7c6cf0',  // purple
  positive:  '#43a047',  // green
  palette:   ['#e53935', '#1e88e5', '#43a047', '#f9a825', '#7c6cf0', '#00bcd4']
}

// Axis styling — consistent across all charts
CHART_AXIS_STYLE = {
  stroke: 'rgba(255,255,255,0.14)',
  tick: { fill: 'rgba(255,255,255,0.45)', fontSize: 11 }
}

// Tooltip — dark glass aesthetic
CHART_TOOLTIP_STYLE = {
  contentStyle: {
    background: 'rgba(16, 16, 32, 0.95)',
    border: '1px solid rgba(255,255,255,0.14)',
    borderRadius: '8px'
  }
}

// Grid — subtle dashed lines
CHART_GRID_STYLE = {
  strokeDasharray: '3 3',
  stroke: 'rgba(255,255,255,0.06)'
}
```

## Data Sources

### iRacing API (`iracing-api.ts`)

Fetches from iRacing's data API:
- Rating history (iRating, Safety Rating per category)
- Race schedule (series, tracks, times)
- Session results (finish position, incidents, laps, lap times)

### Computed Metrics

- **Driver DNA** (`driver-dna.ts`) — 8-axis profile computed from session statistics. Archetype classification based on dominant traits.
- **Track Mastery** (`mastery.ts`) — Per-track proficiency scoring from historical performance.
- **When Engine** (`when-engine.ts`) — Optimal racing time recommendations from session data patterns.
- **Moments** (`moments.ts`) — Automated highlight detection from telemetry events.

## Rules

1. **Always use `CHART_COLORS`** — Never hardcode hex colors in chart components. Import from `chart-theme.ts`.
2. **Dark-first design** — All charts render on dark backgrounds (`#0a0a14` or similar). Use `rgba(255,255,255,...)` for grid/text, not dark colors.
3. **Responsive** — Charts should work in the dashboard grid layout. Use `<ResponsiveContainer>` wrapper from Recharts.
4. **Custom tooltips** — Use `CHART_TOOLTIP_STYLE` for consistent dark glass look. Custom tooltip components should match existing patterns.
5. **Forward-fill sparse data** — iRating data has gaps. Use forward-fill (carry last known value) to avoid broken area charts.
6. **Recharts only** — Don't introduce D3 or Chart.js in the web app. All viz uses Recharts (`recharts` package).
7. **Server Components where possible** — Data fetching should happen server-side. Chart rendering is client-side (`'use client'`).
8. **Tailwind for layout** — Chart container layout uses Tailwind classes, not inline styles.
9. **License categories** — iRacing has 6 categories: road, oval, dirt_road, dirt_oval, sports_car, formula. Each gets a distinct color from the palette.
