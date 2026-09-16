# CLAUDE.md — racecor-prodrive-ios

## What this repo is

Native universal SwiftUI app for iOS 17+ / iPadOS 17+. One of seven parallel native apps for the RaceCor Pro Drive ecosystem. See [README.md](../../README.md).

The repo is flat — sources at the root, no `apps/<name>/` nesting. (Originally it held a parallel React Native app under `apps/rn/`; that was killed in favor of focusing on a single Swift implementation.)

## Cross-repo context

Backend: `https://prodrive.racecor.io`. The app is a **consumer** of the Pro Drive web API. It is independent of the plugin/overlay runtime pipeline in the open `alternatekev/k10-motorsports` repo.

- **Auth**: `/api/plugin-auth/*` PKCE (`code_challenge_method=S256`). Client ID `racecor-prodrive-ios`. Redirect URI `racecor-prodrive://auth`.
- **Data**: `/api/v1/*`. See `../native-apps-api-contract.md`.
- **Tokens (design system)**: `/api/v1/tokens/native?format=swift` or `?format=json`.
- **Bundle ID**: `racing.k10motorsports.prodrive.racecor.ios`.

Endpoints consumed:
- GET `/api/plugin-auth/authorize` (browser)
- POST `/api/plugin-auth/token` (code exchange)
- GET `/api/v1/me`
- GET `/api/v1/sessions?limit=50&offset=0&category=all`
- GET `/api/v1/sessions/:id`
- GET `/api/v1/dashboard`
- GET `/api/v1/tokens/native?format=swift`

## Agent work policy

Agent-spawned work should use `isolation: "worktree"`. Exception: read-only exploration, single-file doc updates.

## Architecture

### Auth flow

1. **AuthManager** (`@MainActor @Observable`) orchestrates all auth state.
2. **PKCE**: 64-byte verifier → SHA256 → base64url (no padding).
3. **ASWebAuthenticationSession**: native system browser, no embedded WebView (Apple requires this for OAuth).
4. **Deep linking**: handles `racecor-prodrive://auth?code=...&state=...` callbacks.
5. **Keychain** (TokenStore): Security.framework, service `racing.k10motorsports.prodrive.racecor.ios`, account `tokens`.

State machine:
- `.loggedOut` → user taps "Sign in"
- `.authenticating` → waiting for OAuth browser
- `.authenticated(Me)` → user data loaded

On launch, AuthManager checks Keychain; if valid tokens exist, silently restores session.

### Data layer

- **APIClient** (`actor`): async/await `URLSession` wrapper.
  - All requests attach `Authorization: Bearer <access_token>`.
  - 401 → single refresh attempt → retry. No exponential backoff (TODO).
- **Models** (Codable): exact server contract.
  - Optional fields: `iRatingPre`, `iRatingPost`, `srPre`, `srPost`, `startPosition`, `seriesName`, `sessionType`.
  - Session detail includes `laps: [Lap]?` and `behavior: BehaviorData?`.
- **Token exchange**: POST body is `{ grant_type, code, code_verifier }`.

### UI layer

Adaptive design via `@Environment(\.horizontalSizeClass)` in `AppTabsView`:
- iPhone (compact): `TabView` (Dashboard, Races, Moments, Profile)
- iPad (regular): `NavigationSplitView` (sidebar + detail)

Screens:
- **LoginView**: hero layout, "Sign in with Discord" button (K10 red)
- **DashboardView**: 4 stat cards (2-column grid on iPhone, 4 on iPad), recent races list, pull-to-refresh
- **SessionsView**: paginated with category picker, NavigationLink to detail
- **SessionDetailView**: header card, laps table, behavior summary
- **MomentsView**: placeholder linking to prodrive.racecor.io
- **ProfileView**: Discord avatar (`AsyncImage`), user info, sign out
- **iPad-only placeholders**: Tracks, Cars, DNA, When, Safety, Composure, Debrief, Settings

### Design system

- **Tokens.swift**: K10 brand colors (red: rgb(255, 51, 51)), typography (7 weight + size combos).
- **TokenLoader**: fetches `/api/v1/tokens/native?format=swift` on launch, caches to Documents/. Returns a stub until Style Dictionary pipeline publishes tokens.
- **Color extensions**: `Color(hex:)`, `Color(rgba:)`.

### Build & project

- **XcodeGen**: `project.yml` declares structure; no manual `.pbxproj` editing.
- **Swift**: vanilla SwiftUI, Observation only. No Redux/MVVM/Combine.
- **Dependencies**: Foundation, SwiftUI, AuthenticationServices, CryptoKit, Security, os.log (built-in).
- **Deployment target**: iOS 17.0.
- **Device families**: 1 (iPhone), 2 (iPad). All orientations.
- **App icon**: placeholder sizes declared; needs real 1024×1024 master before TestFlight.

### Keychain & secrets

- TokenStore uses Security.framework (lower-level than Keychain.framework, sufficient for a single token JSON).
- Service: `racing.k10motorsports.prodrive.racecor.ios`, account: `tokens`.
- Value: JSON `{access_token, refresh_token, expires_at}` (Codable).
- First run with no tokens: graceful fallback to `.loggedOut`.

### App Review considerations

- ASWebAuthenticationSession required (no embedded browser).
- Keychain, not UserDefaults (secure storage requirement).
- No private APIs, no URL scheme conflicts.
- Pull-to-refresh standard; accessible text sizes.

## Code style

- Vanilla SwiftUI, no third-party frameworks.
- `@MainActor` on AuthManager prevents race conditions on UI updates.
- `actor APIClient` for thread-safe network access.
- Async/await only — no Combine subscriptions.
- `CodingKeys` for snake_case (server returns camelCase from Drizzle, no mapping needed).
- Error types: `APIError` with `LocalizedError` conformance.

## Decisions & trade-offs

- **Why Security.framework, not Keychain.framework?** Lower-level but more direct for simple key-value storage. Keychain.framework has more overhead. For a single token JSON, Security is sufficient.
- **Why no refresh exponential backoff?** v0.1 is auth-flow validation. 401 retry logic deferred to v0.2. Single attempt prevents loops.
- **Why no `@Query` or SwiftData?** iOS 17 `@Observable` is sufficient for AuthManager. Tokens are Keychain-only — no CoreData/SwiftData needed.
- **Moments + Tokens stubs**: `/api/v1/moments` not yet spec'd; placeholder directs users to the web app. TokenLoader returns "Coming soon" until Style Dictionary pipeline publishes tokens.
- **No Handoff / Continuity**: deferred. Requires `NSUserActivityTypes` in Info.plist and activity restoration logic. v0.2+.

## Testing

- Previews provided for all main screens.
- No XCTests yet (TODO).
- Manual testing: Simulator iPhone 15, iPad Pro 13".
- Network stubbing: mock API via `/etc/hosts` or local mock server.

## Deployment

### Prerequisites

- Apple Developer account.
- Team signing (Xcode auto-manages).
- App ID in Apple Developer Console.

### Steps

1. `xcodegen generate && open RaceCorProDrive.xcodeproj`
2. Configure team in Xcode (Build Settings → Code Signing).
3. Archive (Cmd+Shift+B) → Distribute → App Store Connect.
4. Review in App Store Connect, submit.
5. For TestFlight: upload build, invite testers.

Real icon, screenshots, app description, privacy policy, and EULA required before submission.

## Pointers

- Master plan: `../native-apps-plan.md`
- API contract: `../native-apps-api-contract.md`
