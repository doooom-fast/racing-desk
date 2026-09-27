# Native apps — calc API integration

> **Audience:** the chat / agent picking up the iOS / macOS / tvOS / Windows native apps and wiring them up to the post-Phase-9 server. Sibling to [`native-apps-api-contract.md`](native-apps-api-contract.md) (per-screen REST) and the Phase 9 spec at [`prodrive-server/docs/native-app-integration.md`](https://github.com/DOOOOM/prodrive-server/blob/main/docs/native-app-integration.md) (calc engines).
>
> **Repos in scope:** `prodrive-ios` (SwiftUI + RN), `prodrive-macos` (SwiftUI), `prodrive-tvos` (SwiftUI), `prodrive-windows` (WinUI 3 / .NET 8).
>
> **Status:** drafted 2026-04-26. Living document — update as the four apps reach feature parity with the web dashboard.

## Why this exists

After Phase 9 (PRs #10–#17 in `prodrive-server`), every dashboard analytic — Driver DNA, Mastery, Moments, Scatter, When-Engine, Race-Now Verdict, Race Summary, Next Race Ideas — runs in a single TypeScript implementation under `apps/web-api/src/calc/`. The web app and the Electron overlay already consume that calc layer over HTTP. The four native apps do not yet, and their `APIClient` scaffolding pre-dates the calc surface.

This doc defines how the four native apps should fetch data so that what they show is **byte-identical** to what the web dashboard shows. It supersedes any pre-Phase-9 assumptions about per-app calc reimplementation.

> **Note on the SimHub plugin:** the plugin is a *data producer* (telemetry → port 8889 → consumers), not a calc consumer. The overlay (today) and the native apps (target) hold the user's Bearer token and call `/api/v1/calc/*` directly. The plugin's [`Calc/CalcClient.cs`](https://github.com/DOOOOM/prodrive-plugin/blob/main/racing-desk-plugin/simhub-plugin/plugin/RacingDesk.Plugin/Calc/CalcClient.cs) (merged in PR #186) is dormant scaffolding — keep, but no current consumer. If a future plugin feature wants derived analytics, the right path is to ask the consumer (overlay/native app) over the existing port-8889 channel, not to mint a parallel auth path in the plugin.

## Two API surfaces — when to use which

| Surface | Base URL | Auth | Method | When to use |
|---|---|---|---|---|
| **Per-screen REST** (the screen contract) | `https://prodrive.racing-desk.io/api/v1/*` | Bearer required | GET | Default. One call per screen. Server aggregates the user's data + runs calc internally + returns a finalized, screen-shaped blob. Cache 60s. |
| **Calc engines** (the Phase 9 API) | `https://api.prodrive.racing-desk.io/api/v1/calc/*` | None today; Bearer planned (Phase 9b) | POST | What-if flows where the client wants to feed in a synthetic or scoped subset (e.g. "score only the last 10 sessions", "what's my DNA if I exclude practice sessions"). Also: any client that already has session data in memory and doesn't want to round-trip. |

**Native-app default: per-screen REST.** The four native apps are user-scoped surfaces showing the user's own data on app launch. They don't want to ship 500KB of session JSON to a calc POST endpoint just to render a DNA panel. The per-screen endpoints already do that aggregation server-side.

**Calc POST is escape-hatch, not main course.** Reserve it for:

- Driver DNA "compare myself last 30 days vs all-time" toggles
- Pre-race "what would happen if I ran X series next" hypotheticals
- Replays of specific sessions from local cache without re-fetching

If the screen has its own per-screen GET endpoint, prefer it. If it doesn't, file an issue against `prodrive-server` to add one before reaching for calc POST.

## Per-screen REST — what each endpoint returns

See [`native-apps-api-contract.md`](native-apps-api-contract.md) for the catalogue. That doc remains the source of truth for the GET surface — its endpoints, response shapes, and the `src/lib/queries/*` refactor on the server side are unchanged by Phase 9.

The server-side query functions internally call the calc engines, so the per-screen blobs are always consistent with what calc POST would return for the same inputs.

## Calc POST endpoints — the eight

All eight are documented in [`prodrive-server/docs/native-app-integration.md`](https://github.com/DOOOOM/prodrive-server/blob/main/docs/native-app-integration.md). Quick reference:

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
| Calc POST | None required | **Same JWT** as the per-screen Bearer |

**Decision (locked in 2026-04-26):** Phase 9b will reuse the existing `/api/plugin-auth/token` JWT on the calc surface — one token, two surfaces. No separate per-app installer token. This collapses what would otherwise be two auth pipelines into one and means each native app's calc subsurface can literally reuse the same `Authorization` header injection the per-screen client uses.

**Send Bearer prophylactically on calc POST today.** The server currently ignores it; when 9b lands, clients that already include the header become compatible without a release.

The token store layouts already exist:

- iOS / macOS / tvOS: `Sources/Auth/TokenStore.swift` (Keychain-backed)
- Windows: `src/RacingDesk/Auth/` (Credential Manager)
- iOS RN: `expo-secure-store`

## How the SimHub plugin fits (it doesn't, directly)

The SimHub plugin runs alongside iRacing on the user's gaming PC and serves telemetry on `http://localhost:8889`. The current consumer of that channel is the Electron overlay; the target consumer is the Windows native app (and any other native app paired with a running game session).

The plugin **never** calls `/api/v1/calc/*` directly. It has no user identity, no Bearer token, no need for derived analytics. Its job ends at "produce JSON telemetry on port 8889 and let consumers do whatever with it."

If a future plugin feature actually needs a derived value (e.g. CommentaryEngine wants to mention "you're consistent with this car" mid-race), the plugin should request that value from the consumer over the existing port-8889 channel — the consumer already has the token and the cached calc result. Don't reach for HTTP-to-web-api from inside the plugin.

This is why the plugin's [`Calc/CalcClient.cs`](https://github.com/DOOOOM/prodrive-plugin/blob/main/racing-desk-plugin/simhub-plugin/plugin/RacingDesk.Plugin/Calc/CalcClient.cs) (PR #186) is dormant. It's not wrong; it's just unused. Revert it if it bitrots; otherwise leave it alone.

## Recommended client shape per platform

Each app already has an `APIClient` (or equivalent) targeting the per-screen surface. Add a `CalcClient` peer that owns the calc base URL and shares the same auth/HTTP infrastructure. Mirror the layout that's already in the overlay (`modules/js/calc-client.js`) and the SimHub plugin (`Plugin/Calc/CalcClient.cs`).

### Swift (iOS, macOS, tvOS)

```
Sources/API/
├── APIClient.swift              // existing — per-screen GETs against prodrive.racing-desk.io
├── APIClient+Moments.swift      // existing — domain-grouped extensions
├── CalcClient.swift             // NEW — POSTs against api.prodrive.racing-desk.io
├── CalcModels.swift             // NEW — Codable DTOs for the 8 endpoints
└── Models.swift                 // existing — shared DTOs
```

```swift
public actor CalcClient {
    private let baseURL: URL
    private let session: URLSession
    private let tokenStore: TokenStore   // shared with APIClient

    public init(
        baseURL: URL = URL(string: "https://api.prodrive.racing-desk.io")!,
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
src/RacingDesk/Api/
├── ApiClient.cs                 // existing — per-screen GETs
├── CalcClient.cs                // NEW — POSTs
└── CalcModels.cs                // NEW — DTOs
```

The Windows app is .NET 8 (not net48 like the SimHub plugin), so `System.Net.Http.Json` and `System.Text.Json` are available — prefer those over Newtonsoft. Pattern matches the plugin's `RacingDesk.Plugin.Calc.CalcClient` but with `JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, DefaultIgnoreCondition = WhenWritingNull }`.

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
- **Calc POST**: server sends no cache headers — cache client-side keyed on a hash of the request body. DNA / Mastery / When recompute on every screen open is fine; the calc engines run in milliseconds.
- **Offline**: every native app should be readable offline from cache. The four are not write surfaces — there are no mutations to queue.

## Verifying parity

Same fixtures the web app uses: [`apps/web/__fixtures__/real/`](https://github.com/DOOOOM/prodrive-server/tree/main/apps/web/__fixtures__/real). The "best parity check before shipping" workflow:

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
- [ ] Race-Now polls on hour boundaries, not on a fixed 5-minute interval.
- [ ] Driver DNA, Mastery, Moments, Scatter, When-Engine, Race-Now, Race Summary, NRI panels render strings and numbers byte-identical to `prodrive.racing-desk.io` for the same user.
- [ ] Offline: every screen reads from cache without a network round-trip.
- [ ] Parity dump CLI / debug menu item exists.

When all four (five with RN) repos meet those criteria, the calc layer is genuinely a single source of truth across web + overlay + 4 native apps + 1 RN preview. (The SimHub plugin participates as a telemetry source on port 8889; it does not call calc directly.)

## Open questions

1. **Should `prodrive-server` add per-screen GETs that expose the calc panels not yet covered?** E.g. `GET /api/v1/race-summary?sessionId=X` (already in the v1 contract) is fine, but `GET /api/v1/dna?window=last30d` doesn't exist — the calc POST is the only way to get a windowed DNA today. Decide before native apps ship if windowed views are needed.
2. ~~**Token-format alignment** between the per-screen Bearer and the eventual calc Bearer (Phase 9b) — same JWT, or two different tokens?~~ **Resolved 2026-04-26: same JWT.** See Auth posture above.
3. **iRacing schedule blob** for `next-race-ideas`. The overlay fetches it from the local SimHub plugin's `weekPlanner` action. Native apps without a paired plugin (e.g. iOS away from the gaming PC) need either a `GET /api/v1/iracing/schedule` proxy on `prodrive-server` (doesn't exist yet) or to call iRacing's upstream directly with the user's auth (more brittle). Recommend the proxy. Native apps **with** a paired plugin (the Windows native app on the gaming PC) can keep using the port-8889 channel.
4. **RN ↔ SwiftUI iOS app pick-a-winner** — decision still pending per `native-apps-plan.md` Q5. Both ship their own `CalcClient`; the loser's gets archived along with its app.
