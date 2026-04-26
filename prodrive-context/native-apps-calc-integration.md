# Native apps — calc API integration

> **Audience:** the chat / agent picking up the iOS / macOS / tvOS / Windows native apps and wiring them up to the post-Phase-9 server. Sibling to [`native-apps-api-contract.md`](native-apps-api-contract.md) (per-screen REST) and the Phase 9 spec at [`prodrive-server/docs/native-app-integration.md`](https://github.com/k10-motorsports/prodrive-server/blob/main/docs/native-app-integration.md) (calc engines).
>
> **Repos in scope:** `prodrive-ios` (SwiftUI + RN), `prodrive-macos` (SwiftUI), `prodrive-tvos` (SwiftUI), `prodrive-windows` (WinUI 3 / .NET 8).
>
> **Status:** drafted 2026-04-26. Living document — update as the four apps reach feature parity with the web dashboard.

## Why this exists

After Phase 9 (PRs #10–#17 in `prodrive-server`), every dashboard analytic — Driver DNA, Mastery, Moments, Scatter, When-Engine, Race-Now Verdict, Race Summary, Next Race Ideas — runs in a single TypeScript implementation under `apps/web-api/src/calc/`. The web app, the Electron overlay, and the SimHub plugin already consume that calc layer over HTTP. The four native apps do not yet, and their `APIClient` scaffolding pre-dates the calc surface.

This doc defines how the four native apps should fetch data so that what they show is **byte-identical** to what the web dashboard shows. It supersedes any pre-Phase-9 assumptions about per-app calc reimplementation.

## Two API surfaces — when to use which

| Surface | Base URL | Auth | Method | When to use |
|---|---|---|---|---|
| **Per-screen REST** (the screen contract) | `https://prodrive.racecor.io/api/v1/*` | Bearer required | GET | Default. One call per screen. Server aggregates the user's data + runs calc internally + returns a finalized, screen-shaped blob. Cache 60s. |
| **Calc engines** (the Phase 9 API) | `https://api.prodrive.racecor.io/api/v1/calc/*` | None today; Bearer planned (Phase 9b) | POST | What-if flows where the client wants to feed in a synthetic or scoped subset (e.g. "score only the last 10 sessions", "what's my DNA if I exclude practice sessions"). Also: any client that already has session data in memory and doesn't want to round-trip. |

**Native-app default: per-screen REST.** The four native apps are user-scoped surfaces showing the user's own data on app launch. They don't want to ship 500KB of session JSON to a calc POST endpoint just to render a DNA panel. The per-screen endpoints already do that aggregation server-side.

**Calc POST is escape-hatch, not main course.** Reserve it for:

- Driver DNA "compare myself last 30 days vs all-time" toggles
- Race-Now polling (the verdict only changes on hour boundaries — see cadence note below)
- Pre-race "what would happen if I ran X series next" hypotheticals
- Replays of specific sessions from local cache without re-fetching

If the screen has its own per-screen GET endpoint, prefer it. If it doesn't, file an issue against `prodrive-server` to add one before reaching for calc POST.

## Per-screen REST — what each endpoint returns

See [`native-apps-api-contract.md`](native-apps-api-contract.md) for the catalogue. That doc remains the source of truth for the GET surface — its endpoints, response shapes, and the `src/lib/queries/*` refactor on the server side are unchanged by Phase 9.

The server-side query functions internally call the calc engines, so the per-screen blobs are always consistent with what calc POST would return for the same inputs.

## Calc POST endpoints — the eight

All eight are documented in [`prodrive-server/docs/native-app-integration.md`](https://github.com/k10-motorsports/prodrive-server/blob/main/docs/native-app-integration.md). Quick reference:

| Endpoint | Body | Response highlight | Native cadence |
|---|---|---|---|
| `POST /api/v1/calc/dna` | `{ sessions, ratings }` | 8-axis scores, archetype, insights | On screen open + on toggle |
| `POST /api/v1/calc/mastery` | `{ sessions }` | `{ tracks[], cars[] }` w/ tier + score | On screen open |
| `POST /api/v1/calc/moments` | `{ sessions, ratings }` | sorted highlights | On screen open |
| `POST /api/v1/calc/scatter` | `{ sessions, timeZone? }` | `buckets[]` for heatmap | On screen open |
| `POST /api/v1/calc/when` | `{ sessions, ratings, timeZone? }` | `profile`, `insights[]`, `panel` (pre-rendered strings) | On screen open |
| `POST /api/v1/calc/race-now` | `{ profile, now?, timeZone?, sessions? }` | verdict + alternatives | App start, then hourly |
| `POST /api/v1/calc/race-summary` | `{ session, laps, behavior, trackHistory, ratingContext }` | full debrief | After race completion |
| `POST /api/v1/calc/next-race-ideas` | `{ sessions, ratings, driverRatings, schedule, ... }` | sorted suggestions | On widget open + every 5–10 min |

`when.panel.strengths.paragraph`, `panel.watchOut.paragraph`, etc. are **pre-rendered** server-side. Native apps render verbatim — no string formatting in Swift / C#.

**Race-Now polling cadence is critical.** The verdict only changes on hour boundaries. Use a Timer/DispatcherTimer aligned to the next hour boundary, not a 5-minute interval. Faster polling burns the user's data plan for nothing.

## Auth posture

| Surface | Today | After Phase 9b |
|---|---|---|
| Per-screen GET | `Authorization: Bearer <token>` from `/api/plugin-auth/token` | Same |
| Calc POST | None required | `Authorization: Bearer <token>` (likely a per-app token bundled with the installer or shared with the user token) |

**Send Bearer prophylactically on calc POST too.** Today the server ignores it on the calc surface. When Phase 9b lands, every native client that already sends Bearer becomes compatible without a release. Concretely: each native app's calc subsurface should reuse the same `Authorization` header injection the per-screen client uses. One token plumbing path, two surfaces.

The token store layouts already exist:

- iOS / macOS / tvOS: `Sources/Auth/TokenStore.swift` (Keychain-backed)
- Windows: `src/RaceCorProDrive/Auth/` (Credential Manager)
- iOS RN: `expo-secure-store`

## Recommended client shape per platform

Each app already has an `APIClient` (or equivalent) targeting the per-screen surface. Add a `CalcClient` peer that owns the calc base URL and shares the same auth/HTTP infrastructure. Mirror the layout that's already in the overlay (`modules/js/calc-client.js`) and the SimHub plugin (`Plugin/Calc/CalcClient.cs`).

### Swift (iOS, macOS, tvOS)

```
Sources/API/
├── APIClient.swift              // existing — per-screen GETs against prodrive.racecor.io
├── APIClient+Moments.swift      // existing — domain-grouped extensions
├── CalcClient.swift             // NEW — POSTs against api.prodrive.racecor.io
├── CalcModels.swift             // NEW — Codable DTOs for the 8 endpoints
└── Models.swift                 // existing — shared DTOs
```

```swift
public actor CalcClient {
    private let baseURL: URL
    private let session: URLSession
    private let tokenStore: TokenStore   // shared with APIClient

    public init(
        baseURL: URL = URL(string: "https://api.prodrive.racecor.io")!,
        session: URLSession = .shared,
        tokenStore: TokenStore
    ) {
        self.baseURL = baseURL
        self.session = session
        self.tokenStore = tokenStore
    }

    public func driverDNA(sessions: [DnaSession], ratings: [DnaRating]) async throws -> DriverDnaResponse {
        try await post("/api/v1/calc/dna", body: DnaRequest(sessions: sessions, ratings: ratings))
    }

    // ... seven more
}
```

Reuse the JSON encoder/decoder pair already configured in `APIClient` (ISO-8601 dates, snake-case strategy disabled — the calc API is camelCase). Bearer header injection should live in a single `URLRequest` builder shared by both clients.

### C# / .NET 8 (Windows WinUI 3)

```
src/RaceCorProDrive/Api/
├── ApiClient.cs                 // existing — per-screen GETs
├── CalcClient.cs                // NEW — POSTs
└── CalcModels.cs                // NEW — DTOs
```

The Windows app is .NET 8 (not net48 like the SimHub plugin), so `System.Net.Http.Json` and `System.Text.Json` are available — prefer those over Newtonsoft. Pattern matches the plugin's `RaceCorProDrive.Plugin.Calc.CalcClient` but with `JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, DefaultIgnoreCondition = WhenWritingNull }`.

Long-lived `HttpClient` (one per app via DI), `Timeout = TimeSpan.FromSeconds(10)`. Bearer header from the same Credential Manager token the per-screen client uses.

### React Native (iOS RN preview app)

```
apps/rn/src/api/
├── client.ts                    // existing — per-screen
├── calc-client.ts               // NEW
└── calc-types.ts                // NEW
```

Use `fetch` (not Axios — the rest of the RN app is fetch-based) and the type signatures copied from `apps/web/src/lib/web-api-client.ts`. TanStack Query keys: `['calc', 'dna', userId, paramHash]` etc. — calc responses are pure functions of input, so `staleTime: Infinity` is reasonable for non-time-sensitive endpoints. Race-Now is the exception; key it on `floor(now / hour)` so the cache rotates on hour boundaries.

## What to delete in each native repo

Grep for and remove any local re-implementations of the 8 calc engines:

```
# Swift
rg -l 'driverDna|computeMastery|computeArchetype|whenProfile|raceNowVerdict|nextRaceIdeas|raceSummary|scatterBuckets' Sources/

# C#
rg -l 'DriverDna|ComputeMastery|WhenProfile|RaceNowVerdict|NextRaceIdeas|RaceSummary' src/

# RN
rg -l 'driverDna|computeMastery|whenProfile|raceNowVerdict|nextRaceIdeas|raceSummary' apps/rn/src/
```

If anything matches, delete the implementation and replace call sites with the appropriate `CalcClient` method or the per-screen GET. Keep:

- Telemetry collection (live ticks from the SimHub plugin or the iRacing SDK bridge)
- Local rendering / formatting (charts, sparklines, color theming)
- Auth flow code (PKCE, token refresh)
- Anything app-specific (push notifications, Live Activities, widgets)

## Caching and offline

- **Per-screen GET**: respect `Cache-Control: private, max-age=60, stale-while-revalidate=300`. Cache to disk (Core Data on Apple, SQLite on Windows, AsyncStorage on RN). Show stale-while-revalidate state in the UI (subtle "updating…" badge).
- **Calc POST**: server sends no cache headers — cache client-side keyed on a hash of the request body. Race-Now is hour-keyed (see above). DNA / Mastery / When recompute on every screen open is fine; the calc engines run in milliseconds.
- **Offline**: every native app should be readable offline from cache. The four are not write surfaces — there are no mutations to queue.

## Verifying parity

Same fixtures the web app uses: [`apps/web/__fixtures__/real/`](https://github.com/k10-motorsports/prodrive-server/tree/main/apps/web/__fixtures__/real). The "best parity check before shipping" workflow:

1. Pick one calc endpoint per app at a time (start with DNA — smallest payload).
2. Sign in to the native app as the admin user (whose 108 sessions are in the fixture set).
3. Capture the rendered DNA values.
4. Compare against the snapshot test output in `apps/web/src/__tests__/`. Strings, numbers, ordering, archetype text — all should match.
5. Repeat per endpoint. Check off the acceptance criteria.

Worth scripting per app: a hidden `--parity-dump` CLI flag (or debug menu item) that fetches every calc endpoint, serialises the response to JSON, and saves it next to the fixture for `diff`.

## Acceptance criteria — per native app

For each of `prodrive-ios`, `prodrive-macos`, `prodrive-tvos`, `prodrive-windows`, and `prodrive-ios/apps/rn`:

- [ ] `CalcClient` (or equivalent) exists alongside the per-screen client; one `Authorization` header injection path serves both.
- [ ] Configurable base URLs for both surfaces via env var or settings file (dev/staging/prod can differ).
- [ ] No local code reimplements any of the 8 calc engines.
- [ ] Driver DNA, Mastery, Moments, Scatter, When-Engine, Race-Now, Race Summary, NRI panels render strings and numbers byte-identical to `prodrive.racecor.io` for the same user.
- [ ] Race-Now polls on hour boundaries, not on a fixed 5-minute interval.
- [ ] Offline: every screen reads from cache without a network round-trip.
- [ ] Parity dump CLI / debug menu item exists.

When all four (five with RN) repos meet those criteria, the calc layer is genuinely a single source of truth across web + overlay + plugin + 4 native apps + 1 RN preview.

## Open questions

1. **Should `prodrive-server` add per-screen GETs that expose the calc panels not yet covered?** E.g. `GET /api/v1/race-summary?sessionId=X` (already in the v1 contract) is fine, but `GET /api/v1/dna?window=last30d` doesn't exist — the calc POST is the only way to get a windowed DNA today. Decide before native apps ship if windowed views are needed.
2. **Token-format alignment** between the per-screen Bearer (issued by `/api/plugin-auth/token`) and the eventual calc Bearer (Phase 9b) — same JWT, or two different tokens? Pick before Phase 9b lands so native apps can plumb correctly.
3. **iRacing schedule blob** for `next-race-ideas`. The plugin and overlay fetch it from the local SimHub plugin's `weekPlanner` action. Native apps don't have that local plugin available — they'd need either a `GET /api/v1/iracing/schedule` proxy on `prodrive-server` (doesn't exist yet) or to call iRacing's upstream directly with the user's auth (more brittle). Recommend the proxy.
4. **RN ↔ SwiftUI iOS app pick-a-winner** — decision still pending per `native-apps-plan.md` Q5. Both ship their own `CalcClient`; the loser's gets archived along with its app.
