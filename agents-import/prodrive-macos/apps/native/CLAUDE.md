# RaceCor Pro Drive — macOS Native App

Native SwiftUI + AppKit application targeting macOS 14+ (Sonoma). Not an Electron wrapper.

## Architecture & Patterns

### MVVM-Lite Pattern

- **AuthManager**: `@Observable` singleton managing login state + token lifecycle
- **View state**: `@State` for local UI state, `Task {}` blocks for side-effect-driven data fetching
- **APIClient**: `URLSession` wrapper with auto-attached Bearer tokens, single 401 refresh retry
- **TokenStore**: Keychain-backed persistence (not UserDefaults — no plaintext secrets)

### Authentication Flow

1. **Sign in**: Launches `ASWebAuthenticationSession` with PKCE challenge
   - Why ASWebAuthenticationSession? It shares Safari cookies (better UX), passes Apple App Review, handles the browser entirely
   - Redirect scheme: `racecor-prodrive://auth`
   - Client ID: `racecor-prodrive-mac`

2. **Code exchange**: POST `/api/plugin-auth/token` with authorization code + PKCE verifier
   - Response: `{ access_token, refresh_token, token_type, expires_at }`

3. **Token storage**: Keychain under service `racing.k10motorsports.prodrive.racecor.mac`
   - Accounts: `accessToken`, `refreshToken`, `expiresAt`
   - Survives app restart, cleared on sign out

4. **Restore on launch**: `AuthManager.restore()` loads Keychain tokens, validates via `/api/v1/me`

### 401 Retry Loop

On 401 response:
1. Call `refreshToken()` which POSTs `/api/plugin-auth/token` with `grant_type: refresh_token`
2. On success: save new tokens to Keychain, set Bearer, retry the original request once
3. On refresh failure: delete Keychain tokens, sign out, end request chain (max 1 retry prevents loops)

### Design Tokens

- **Token source**: `/api/v1/tokens/native?format=swift` returns Swift enum
- **Cache**: Disk cache in `~/Library/Application Support/racing.k10motorsports.prodrive.racecor.mac/tokens.swift`
- **Regeneration**: `TokenLoader.loadOrFetch()` called on app launch, checks cache first
- **Note**: Style Dictionary pipeline is TODO; tokens are currently hardcoded fallbacks in `DesignSystem/Tokens.swift`

## File Structure

| Path | Purpose |
|------|---------|
| `project.yml` | XcodeGen spec |
| `Sources/App/` | Entry point, main window, command set |
| `Sources/Auth/` | Login, PKCE, token exchange, Keychain |
| `Sources/API/` | URLSession client, Codable models |
| `Sources/UI/` | SwiftUI views: Dashboard, Sessions, Login, placeholders |
| `Sources/DesignSystem/` | Color + typography tokens, token loader |
| `Sources/Support/` | Logging, entitlements |
| `Resources/` | Info.plist, app icons |

## Key Decisions

1. **No frameworks**: Vanilla SwiftUI + AppKit, no third-party networking/auth libraries
2. **Keychain for secrets**: Protects access tokens from casual inspection
3. **Task-driven fetching**: `.task {}` on appear, `.refreshable {}` for pull-to-refresh
4. **URL scheme for OAuth**: Matches Apple guidelines, works even if browser is in background
5. **NavigationSplitView**: Three-column layout (sidebar / detail column) when window is wide

## Testing Locally

1. `xcodegen generate && open RaceCorProDrive.xcodeproj`
2. Build + run in Xcode simulator or native
3. Override API endpoint: `UserDefaults.standard.set("http://localhost:3000", forKey: "racecor.dev.baseURL")`

## Cross-Repo Contracts

Refer to:
- `/Users/kevinconboy/Documents/K10/racecor.io/native-apps-plan.md` — high-level roadmap
- `/Users/kevinconboy/Documents/K10/racecor.io/native-apps-api-contract.md` — exact API shapes

The plugin HTTP API (`http://localhost:8889`) is NOT used here; we consume `https://prodrive.racecor.io/api/v1/*` instead.

## Known Limitations

- Dashboard aggregate endpoint is TODO on backend
- Moments, DNA, When, Safety, Composure, Debrief screens are placeholders
- No MenuBarExtra live stats (planned for v1.1)
- No macOS widgets (Sonoma+ planned for v1.1)
- No Continuity/Handoff to iOS app yet
