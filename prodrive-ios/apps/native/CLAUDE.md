# RaceCor Pro Drive — iOS App

Standalone native SwiftUI universal app (iOS 17.0+, iPadOS 17.0+). One of seven parallel native apps for the RaceCor Pro Drive ecosystem.

## Integration Contract

This app is a **consumer** of the Pro Drive web API at `https://prodrive.racecor.io/api/v1/*`. It is **independent** of the plugin/overlay runtime pipeline in the open `alternatekev/k10-motorsports` repo.

- **Auth**: OAuth via Discord using PKCE (code_challenge_method=S256)
- **Client ID**: `racecor-prodrive-ios`
- **Redirect URI**: `racecor-prodrive://auth`
- **Token Storage**: Keychain (not UserDefaults)
- **Bearer attachment**: Every request includes `Authorization: Bearer <access_token>`
- **Refresh**: Single retry on 401 (no exponential backoff)
- **Base URL**: `https://prodrive.racecor.io`

Endpoints consumed:
- GET `/api/plugin-auth/authorize` (browser)
- POST `/api/plugin-auth/token` (code exchange)
- GET `/api/v1/me`
- GET `/api/v1/sessions?limit=50&offset=0&category=all`
- GET `/api/v1/sessions/:id`
- GET `/api/v1/dashboard`
- GET `/api/v1/tokens/native?format=swift`

## Architecture

### Auth Flow

1. **AuthManager** (@MainActor @Observable) orchestrates all auth state
2. **PKCE**: Generates 64-byte verifier → SHA256 → base64url (no padding)
3. **ASWebAuthenticationSession**: Native system browser, no embedded WebView
4. **Deep linking**: App handles `racecor-prodrive://auth?code=...&state=...` callbacks
5. **Keychain**: TokenStore uses Security framework, service `racing.k10motorsports.prodrive.racecor.ios`, account `tokens`

**State machine:**
- `.loggedOut` → user taps "Sign in"
- `.authenticating` → waiting for OAuth browser
- `.authenticated(Me)` → user data loaded

On app launch, AuthManager checks Keychain; if valid tokens exist, silently restores session.

### Data Layer

- **APIClient** (actor): async/await URLSession wrapper
  - All requests attach Bearer token
  - 401 → refresh attempt → retry (once only)
  - Exponential backoff NOT implemented (TODO)
- **Models** (Codable): exact server contract
  - Optional fields: `iRatingPre`, `iRatingPost`, `srPre`, `srPost`, `startPosition`, `seriesName`, `sessionType`
  - Session detail includes `laps: [Lap]?` and `behavior: BehaviorData?`
- **Token exchange**: POST body is `{ grant_type, code, code_verifier }`

### UI Layer

**Adaptive design:**
- iPhone (compact): TabView (Dashboard, Races, Moments, Profile)
- iPad (regular): NavigationSplitView (sidebar + detail)

Branching via `@Environment(\.horizontalSizeClass)` in AppTabsView.

**Screens:**
- LoginView: hero layout, "Sign in with Discord" button (K10 red)
- DashboardView: 4 stat cards (2-column grid on iPhone, 4 on iPad), recent races list, pull-to-refresh
- SessionsView: paginated with category picker, NavigationLink to detail
- SessionDetailView: header card, laps table, behavior summary
- MomentsView: placeholder with link to prodrive.racecor.io
- ProfileView: Discord avatar (AsyncImage), user info, sign out
- Placeholders (iPad only): Tracks, Cars, DNA, When, Safety, Composure, Debrief, Settings

### Design System

- **Tokens.swift**: K10 brand colors (red: rgb(255, 51, 51)), typography (7 weight + size combos)
- **TokenLoader**: Fetches from `/api/v1/tokens/native?format=swift` on app launch, caches to Documents/
- **Color extensions**: hex parser `Color(hex:)`, rgba parser `Color(rgba:)`
- **Until Style Dictionary live**: inline defaults in Tokens.swift

### Build & Project

- **XcodeGen**: `project.yml` declares structure; no manual .pbxproj editing
- **Swift**: vanilla SwiftUI, no frameworks (Observation only)
- **Dependencies**: Foundation, SwiftUI, AuthenticationServices, CryptoKit, Security, os.log (built-in)
- **Deployment target**: 17.0
- **Device families**: 1 (iPhone), 2 (iPad)
- **Orientation**: all (configurable)
- **App icon**: placeholder sizes declared; needs real 1024×1024 master

### Keychain & Secrets

- TokenStore uses Security.framework, not Keychain.framework
- Service: `racing.k10motorsports.prodrive.racecor.ios`
- Account: `tokens`
- Value: JSON `{access_token, refresh_token, expires_at}` (Codable)
- On first run (no tokens in Keychain): graceful fallback to .loggedOut

### App Review Considerations

- ASWebAuthenticationSession required (no embedded browser)
- Keychain NOT UserDefaults (secure storage requirement)
- No private APIs
- No URLScheme conflicts
- Pull-to-refresh standard
- Accessible text sizes

## Code Style

- **No frameworks**: vanilla SwiftUI, no Redux/MVVM libraries
- **@MainActor on AuthManager**: prevents race conditions on UI updates
- **actor APIClient**: thread-safe network access
- **Async/await only**: no Combine subscriptions
- **CodingKeys for snake_case**: server returns camelCase (Drizzle), no mapping needed
- **Error types**: APIError with LocalizedError conformance

## Decisions & Trade-offs

### Why not Keychain.framework?

Security.framework is lower-level but more direct for simple key-value storage. Keychain.framework has more overhead. For a single token JSON, Security is sufficient.

### Why no refresh exponential backoff?

Scope: v0.1 is auth flow validation. 401 retry logic deferred to v0.2. Current: single attempt prevents loops.

### Why no @Query or Observation with @State?

iOS 17 @Observable is sufficient for AuthManager. No CoreData (tokens are Keychain-only). No SwiftData (overkill).

### Moments placeholder + API stub

Moments endpoint `/api/v1/moments` not yet spec'd. Placeholder directs users to web app. TokenLoader stub returns "Coming soon" until Style Dictionary pipeline publishes tokens.

### No Handoff / Continuity

Deferred. Requires `NSUserActivityTypes` in Info.plist and activity restoration logic. v0.2+.

## Testing

- Previews provided for all main screens
- No XCTests yet (TODO)
- Manual testing: Simulator iPhone 15, iPad Pro 13"
- Network stubbing: use mock API in Simulator via /etc/hosts or local mock server

## Related Docs

See `/Users/kevinconboy/Documents/K10/racecor.io/`:
- `native-apps-plan.md` — design + roadmap
- `native-apps-api-contract.md` — detailed API spec

See parent monorepo CLAUDE.md for plugin/overlay contracts (not applicable here).

## Deployment

### Prerequisites

- Apple Developer account
- Team signing (Xcode auto-manages)
- App ID in Apple Developer Console

### Steps

1. `xcodegen generate && open RaceCorProDrive.xcodeproj`
2. Configure team in Xcode (Build Settings → Code Signing)
3. Archive (Cmd+Shift+B) → Distribute → App Store Connect
4. Review in App Store Connect, submit
5. For TestFlight: upload build, invite testers

Real icon, screenshots, app description, privacy policy, and EULA required before submission.
