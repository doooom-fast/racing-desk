# Native Apps — API Contract

*Drafted 2026-04-22 → 23 overnight. Living document — update as the server work lands.*

## Purpose

The web app at `prodrive.racing-desk.io` does almost all its data loading in React Server Components that read Drizzle directly. Native apps sit across the network and can't do that. This doc lists the JSON endpoints under `/api/v1/*` that the native apps consume, what each one returns, and which Server Component query it replaces.

Everything here is **additive**. No existing route moves. No existing Server Component query changes. The only refactor is extracting inline Drizzle queries into `src/lib/queries/*` pure functions so both the Server Component and the new route handler can call the same thing.

## Conventions

- **Base**: `https://prodrive.racing-desk.io/api/v1/`
- **Auth**: `Authorization: Bearer <access_token>` from the `/api/plugin-auth/token` flow. Missing/invalid → `401`. Expired → `401` with `WWW-Authenticate: Bearer error="invalid_token"` and the app refreshes via `/api/plugin-auth/token` with `grant_type=refresh_token`.
- **User scoping**: the access token resolves to a `userId` on the server. Every query is implicitly user-scoped. Native clients never pass a userId.
- **Date serialization**: all `Date` → ISO 8601 string.
- **Numeric fields**: integers as integers, timestamps as milliseconds or ISO string (see per-endpoint notes).
- **Errors**: `{ error: string, code: string, details?: any }` with HTTP status matching the category.
- **Versioning**: `/api/v1/*` is the first version. Breaking changes go to `/api/v2/*`; v1 kept alive at least 6 months after v2 launches.
- **Rate limit**: not enforced at v1 launch. Plan to add per-token 60 req/min later.
- **Cache control**: most endpoints `Cache-Control: private, max-age=60, stale-while-revalidate=300`. Client caches in TanStack Query / NSCache / Core Data.

## Endpoint catalogue

### `GET /api/v1/me`
- **Replaces**: implicit user lookup in every Server Component.
- **Returns**: `{ id, discordId, discordUsername, discordDisplayName, discordAvatar, email, createdAt }`.
- **Notes**: called on app launch, cached in secure storage with the token.

### `GET /api/v1/dashboard`
- **Replaces**: `apps/web/src/app/drive/dashboard/page.tsx`.
- **Returns**: top-level aggregate for the dashboard screen:
  ```ts
  {
    stats: { totalRaces, totalLaps, uniqueTracks, uniqueCars, careerSpanDays },
    iRating: Record<Category, { current, trend: -1|0|1, sparkline: { t, value }[] }>,
    safetyRating: Record<Category, { current, license: 'R'|'D'|'C'|'B'|'A' }>,
    when: WhenProfile | null,       // null if <5 sessions
    moments: Moment[],              // top 5 highlights
    recentMoments: Moment[],        // most recent 20
    nextRaceIdeas: NextRaceIdea[],
    topTracks: TrackMastery[],      // top 3
    topCars: CarAffinity[],         // top 3
  }
  ```
- **Complexity**: heavy. Server aggregates 9 tables. Cache 60s.

### `GET /api/v1/sessions?limit=100&offset=0&category=road|oval|sports|dirt|dirt_oval|all`
- **Replaces**: list-style Server Component queries on `raceSessions`.
- **Returns**: `{ sessions: RaceSession[], total: number, hasMore: boolean }`.
- **Fields per session**: `id, createdAt, trackName, carModel, category, seriesName, finishPosition, startPosition, incidentCount, iRatingPre, iRatingPost, srPre, srPost, sessionType: 'race'|'practice'|'qualify'|'time_trial'`.
- **Notes**: default sort `createdAt DESC`. Paginated.

### `GET /api/v1/sessions/:id`
- **Replaces**: `apps/web/src/app/drive/race/[id]/page.tsx`.
- **Returns**:
  ```ts
  {
    session: RaceSession,
    laps: LapTelemetry[],           // ordered by lap number
    behavior: SessionBehavior | null,
    ratingImpact: { iRatingDelta, srDelta, categoryBefore, categoryAfter },
    trackContext: { avgIncidents, avgPosition, bestFinish, racesAtTrack },
    summary: {
      strengths: string[],
      improvements: string[],
      lapAnalysis: { fastestLap, consistency, sectorBests },
      composure: { rageScore, phases: { in, mid, out } },
    },
  }
  ```
- **Notes**: 404 if session doesn't exist or isn't this user's.

### `GET /api/v1/moments`
- **Replaces**: `apps/web/src/app/drive/moments/page.tsx`.
- **Returns**: `{ moments: Moment[], categories: { pb: number, firstWin: number, licenseMove: number, other: number } }`.
- **Moment shape**: `{ id, sessionId, kind: 'pb'|'first_win'|'license_promotion'|'license_demotion'|'rare_clean_sweep', headline, subhead, trackName, carModel, createdAt, iRatingDelta?, srDelta? }`.

### `GET /api/v1/tracks`
- **Replaces**: `apps/web/src/app/drive/tracks/page.tsx`.
- **Returns**: `{ tracks: { name, displayName, svgPath, logoUrl, heroImageUrl, racesHere, bestFinish, masteryScore }[] }`.

### `GET /api/v1/tracks/:name`
- **Replaces**: `apps/web/src/app/drive/track/[name]/page.tsx`.
- **Returns**: the track mastery blob — mastery score + tier, trend, position/iRating history, incident hotspots (bucketed by track position), car usage, recent sessions (10), narrative summary. 404 if no sessions at track.

### `GET /api/v1/cars`
- **Replaces**: `apps/web/src/app/drive/cars/page.tsx`.
- **Returns**: `{ cars: { model, manufacturer, brandColor, logoUrl, heroImageUrl, racesWithCar, bestFinish, affinityScore }[] }`.

### `GET /api/v1/cars/:name`
- **Replaces**: `apps/web/src/app/drive/car/[name]/page.tsx`.
- **Returns**: car affinity blob — positions, wins/podiums/incidents, iRating delta history filtered by car, sibling cars (same manufacturer), brand aggregate stats, narrative, recent sessions. 404 if none.

### `GET /api/v1/dna`
- **Replaces**: `apps/web/src/app/drive/dna/page.tsx`.
- **Returns**: `{ aggression, consistency, pace, cleanliness, sampleSize, confidence: 0..1 }`. All 0-100 scales.

### `GET /api/v1/when`
- **Replaces**: `apps/web/src/app/drive/when/page.tsx`.
- **Returns**: `{ profile: WhenProfile | null, hoursOfDay: number[24], daysOfWeek: number[7], bestSlot: { day, hour, score }, worstSlot }`.

### `GET /api/v1/safety`
- **Replaces**: `apps/web/src/app/drive/safety/page.tsx`.
- **Returns**: current ratings by category + recent 50 races + recent 100 rating history entries (time-trials filtered out, since they bogus-set license) + 500 recent clean laps + 100 recent session behaviors.

### `GET /api/v1/composure`
- **Replaces**: `apps/web/src/app/drive/composure/page.tsx`.
- **Returns**: `{ sessions: SessionWithBehavior[] }` — 100 recent sessions with LEFT-JOINed behavior data (rage metrics, clean laps, close passes, off-tracks, tailgating, retaliation).

### `GET /api/v1/debrief?sessionId=XXX`
- **Replaces**: `apps/web/src/app/drive/debrief/page.tsx`.
- **Returns**: recent 20 sessions + (if sessionId) that session's detail + lap telemetry + session behavior + track-wide behavior history (20 sessions) + all-user behavioral averages (1000 laps).
- **Notes**: heavy. Cache 5 min.

### `GET /api/v1/should-i-race-now`
- **Replaces**: the ShouldIRaceNow widget on the dashboard.
- **Returns**: `{ verdict: 'green'|'amber'|'red', score: 0..1, reason: string, suggestion: { track, car, practice: boolean } | null }`.

### `GET /api/v1/next-race-ideas?limit=10`
- **Replaces**: the NextRaceIdeas component.
- **Returns**: `{ ideas: NextRaceIdea[] }` where each idea is `{ id, seriesName, trackName, carClass, startsAt, trackMastery, carAffinity, matchScore, iRacingUrl }`. `iRacingUrl` opens the iRacing web session in the system browser.

### `GET /api/v1/tokens/native?format=swift|cs|json`
- **Replaces**: the existing `/api/tokens/css` blob pipeline, for native apps.
- **Returns**: a token file in the requested format. See `native-apps-plan.md#design-tokens-across-platforms` for the generation targets.
- **Notes**: public endpoint, no Bearer required (tokens are not secret). `Cache-Control: public, max-age=300, stale-while-revalidate=3600`.

## Mutations (v1 scope)

**None.** v1 is read-only. Writes happen on the web app or via the SimHub plugin. v2 candidates:

- `POST /api/v1/sessions/:id/notes` — driver notes on a session
- `POST /api/v1/moments/:id/pin` — pin/unpin moment
- `POST /api/v1/preferences` — theme, default category, notification toggles

Skipping these lets us ship a useful v1 without tackling optimistic UI, conflict handling, and offline queue.

## Query functions — the refactor

Each endpoint above delegates to a function in `apps/web/src/lib/queries/`:

```
src/lib/queries/
├── dashboard.ts         getDashboardData(userId)
├── sessions.ts          getSessions(userId, opts), getSession(userId, id)
├── moments.ts           getMoments(userId)
├── tracks.ts            getTracks(userId), getTrackDetail(userId, trackName)
├── cars.ts              getCars(userId), getCarDetail(userId, carName)
├── dna.ts               getDriverDna(userId)
├── when.ts              getWhenProfile(userId)
├── safety.ts            getSafetyDashboard(userId)
├── composure.ts         getComposureTrends(userId)
├── debrief.ts           getDebrief(userId, sessionId?)
├── shouldIRaceNow.ts    getShouldIRaceNow(userId)
├── nextRaceIdeas.ts     getNextRaceIdeas(userId, limit)
└── me.ts                getMe(userId)
```

Each Server Component that previously inlined a Drizzle query now does:

```ts
import { getDashboardData } from '@/lib/queries/dashboard'
const data = await getDashboardData(session.user.id)
```

And the new route handler does the same. One source of truth.

## Known gaps

1. **Pagination metadata**: `/sessions` has it, but `/moments` / `/tracks` / `/cars` return full lists. If a user has 10 000 races, `/sessions` paginates but `/moments` doesn't. Pre-launch, scan the DB for max per-user counts and decide which endpoints need pagination.
2. **Versioning the plugin-auth endpoints**: they're under `/api/plugin-auth/*` unversioned. Native apps shouldn't share that namespace if we want independent deprecation cadence. Move to `/api/v1/auth/*` before v2 planning starts.
3. **Mutations story**: v2 will need a consistent pattern for mutations. Probably `POST` / `PATCH` / `DELETE` at the same endpoints as the GETs.
4. **iRacing import endpoints** (`/api/iracing/*`): exist but are user-pull-triggered and live under `/api/iracing/` not `/api/v1/`. Leave there; native apps shouldn't call them directly, they go through the web import UI.
