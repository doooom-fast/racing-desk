---
name: web-commentary
description: |
  Web app commentary and recommendation system expert for the Pro Drive dashboard.
  Use when working on race analysis, driver insights, next race recommendations,
  Driver DNA profiles, When Engine scheduling, track mastery, moments highlights,
  or any feature that generates personalized recommendations from racing data.
  Triggers: race analysis, recommendation, next race, driver DNA, when engine, moments,
  track mastery, race insights, scheduling, race history, post-race, driver profile,
  archetype, improvement tips, session analysis, iRating prediction.
---

# Web Commentary & Recommendation System Expert

You are an expert on the recommendation and analysis systems in the RaceCor Pro Drive web dashboard. These systems transform raw race data into actionable insights, personalized recommendations, and driver performance profiles.

## Files to Read on Activation

```
# Core recommendation engines
web/src/lib/driver-dna.ts                            # Driver archetype computation (8 dimensions)
web/src/lib/when-engine.ts                           # Optimal race time recommendations
web/src/lib/next-race-ideas.ts                       # Next race suggestions
web/src/lib/mastery.ts                               # Track mastery scoring
web/src/lib/moments.ts                               # Highlight moment detection
web/src/lib/iracing-api.ts                           # iRacing data fetching
web/src/lib/iracing-schedule-fetcher.ts              # Race schedule data

# UI components that render recommendations
web/src/app/drive/dashboard/NextRaceIdeas.tsx        # "What to race next" cards
web/src/app/drive/dashboard/WhenInsightsPanel.tsx    # Scheduling insights widget
web/src/app/drive/dashboard/RecentMoments.tsx        # Highlight clips carousel
web/src/app/drive/dashboard/RaceHistory.tsx          # Race listing with analysis
web/src/app/drive/dashboard/RaceCard.tsx             # Individual race result card
web/src/app/drive/dashboard/DriverDNARadar.tsx       # DNA radar chart
web/src/app/drive/dna/DriverDNAPage.tsx              # Full DNA profile page
web/src/app/drive/tracks/TrackMasteryPage.tsx        # Track mastery grid
web/src/app/drive/when/WhenEnginePage.tsx            # When Engine full page

# Data layer
web/src/db/schema.ts                                 # ratings, sessions, tracks tables
web/src/app/api/ratings/route.ts                     # Rating history endpoints
web/src/app/api/sessions/                            # Session management APIs
web/src/app/api/iracing/                             # iRacing data import APIs
```

## Recommendation Systems

### Driver DNA (8-Axis Profile)

**Engine**: `driver-dna.ts`
**UI**: `DriverDNARadar.tsx` (radar chart), `DriverDNAPage.tsx` (full page)

Computes a driver profile from race session history across 8 dimensions (0-100 scale):

| Dimension | What It Measures | Data Source |
|-----------|-----------------|-------------|
| Consistency | Lap time variance within sessions | Lap time standard deviation |
| Racecraft | Positions gained vs lost | Start position vs finish position delta |
| Cleanness | Incident rate | Incidents per corner/lap |
| Endurance | Performance over long stints | Pace degradation in final third of race |
| Adaptability | Performance across different tracks/cars | Variance in results across series |
| Improvement | Rating trend over time | iRating slope over recent sessions |
| Wet Weather | Performance in variable conditions | Results in wet sessions vs dry |
| Experience | Total race count and variety | Session count, unique tracks, series breadth |

**Archetypes** — Derived from the dominant DNA dimensions:
- "The Surgeon" = high consistency + cleanness
- "The Charger" = high racecraft + improvement
- "The Veteran" = high experience + endurance
- "The Natural" = high adaptability + wet weather
- etc.

### When Engine (Race Time Optimizer)

**Engine**: `when-engine.ts`
**UI**: `WhenInsightsPanel.tsx` (widget), `WhenEnginePage.tsx` (full page)

Analyzes historical session data to recommend optimal racing times:
- Day-of-week patterns (e.g., "You perform best on Thursdays")
- Time-of-day patterns (e.g., "Your cleanest races are 8-10pm")
- Series-specific timing (e.g., "GT3 Fixed has highest splits Tue 9pm")
- Fatigue detection (performance drops after N consecutive races)

### Next Race Ideas

**Engine**: `next-race-ideas.ts`
**UI**: `NextRaceIdeas.tsx`

Suggests what to race next based on:
- Current iRacing schedule (fetched via `iracing-schedule-fetcher.ts`)
- Track mastery scores (prefer tracks where driver has room to improve)
- Series participation history
- iRating-appropriate split predictions
- Time availability (When Engine insights)

### Track Mastery

**Engine**: `mastery.ts`
**UI**: `TrackMasteryPage.tsx`

Per-track proficiency scoring:
- Lap count and session count per track
- Best lap percentile vs field
- Incident rate per track
- Rating gain/loss per track
- Mastery level: Novice → Familiar → Proficient → Expert → Master

### Moments (Highlights)

**Engine**: `moments.ts`
**UI**: `RecentMoments.tsx`

Automated highlight detection from telemetry events:
- Overtake sequences (positions gained in consecutive corners)
- Personal best laps (purple delta)
- Close battles (gap < 0.5s for multiple laps)
- Recovery drives (significant positions gained from poor start)
- Clean race achievements (0 incidents over threshold laps)

## Data Pipeline

```
iRacing Web → iracing-api.ts (fetch) → API routes (process) → DB (store)
                                                                    ↓
                                                    driver-dna.ts (compute profiles)
                                                    when-engine.ts (compute timing)
                                                    next-race-ideas.ts (compute suggestions)
                                                    mastery.ts (compute track scores)
                                                    moments.ts (detect highlights)
                                                                    ↓
                                                    Dashboard components (render)
```

Data import flow:
1. User connects iRacing account (or uploads data via `IRacingUploadForm`)
2. `iracing-api.ts` fetches ratings, sessions, results
3. API routes (`/api/iracing/import`, `/api/sessions/backfill`) process and store
4. Recommendation engines compute insights from stored data
5. Dashboard components render insights with charts and cards

## Rules

1. **Data-driven, not rule-based** — Recommendations should emerge from actual session data patterns, not hardcoded rules. If the driver consistently crashes at Monza, that should surface naturally from the incident rate, not from a rule saying "Monza is hard."
2. **Positive framing** — Frame recommendations as opportunities ("You gain positions at Spa — race there more") not deficiencies ("You're bad at Suzuka").
3. **Archetype labels are fun, not clinical** — DNA archetypes should feel like racing personality types, not medical diagnoses.
4. **Sparse data handling** — Recommendation engines must handle drivers with <10 sessions gracefully. Show "needs more data" states rather than inaccurate conclusions from small samples.
5. **Server-side computation** — All recommendation engines run server-side. Components use `'use client'` only for interactivity, not for data computation.
6. **Chart consistency** — All visualizations use `CHART_COLORS` and `CHART_*_STYLE` from `chart-theme.ts`. See the `web-dataviz` skill.
7. **iRating is per-category** — Never aggregate iRating across categories. Recommendations should be category-aware.
8. **Privacy** — Driver data is personal. Recommendations are only shown to the authenticated user, never exposed publicly.
