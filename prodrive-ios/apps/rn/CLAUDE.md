# RaceCor Pro Drive — React Native (Expo)

Managed Expo app for iOS and iPadOS. Companion to the SwiftUI native app, sharing the same backend API contract.

## Architecture Overview

- **Router**: Expo Router v4 file-based routing
- **Auth**: PKCE OAuth via `expo-auth-session`, tokens in Secure Store
- **Data**: TanStack Query v5 with AsyncStorage persistence (1-day cache)
- **UI**: NativeWind v4 (Tailwind utilities) + Lucide icons
- **Fonts**: System fonts (SF Pro on Apple, sans-serif-medium on Android, Menlo for mono). No licensed fonts shipped.

## File Structure

```
racecor-prodrive-rn/
├── app/                      # Expo Router entry point
│   ├── _layout.tsx          # Root: Query/Auth providers, SplashScreen
│   ├── (auth)/              # Auth group
│   │   ├── _layout.tsx
│   │   └── login.tsx        # Sign-in with Discord
│   └── (tabs)/              # Tab navigator group
│       ├── _layout.tsx      # Home, Races, Moments, Profile
│       ├── index.tsx        # Dashboard (stats, recent races)
│       ├── races.tsx        # Session list (categorized)
│       ├── races/[id].tsx   # Session detail (dynamic route)
│       ├── moments.tsx      # Empty state (placeholder)
│       └── profile.tsx      # User profile + sign-out
├── src/
│   ├── auth/
│   │   ├── AuthContext.tsx  # PKCE flow, token lifecycle
│   │   ├── pkce.ts          # PKCE verifier/challenge generation
│   │   └── tokenStore.ts    # expo-secure-store wrapper
│   ├── api/
│   │   ├── client.ts        # Fetch API client, interceptors
│   │   ├── types.ts         # TypeScript interfaces (User, Session, etc.)
│   │   └── hooks.ts         # TanStack Query hooks (useMe, useSessions, etc.)
│   ├── design/
│   │   ├── tokens.ts        # Design token constants (colors, fonts, spacing)
│   │   └── fonts.ts         # expo-font setup
│   └── components/
│       ├── StatCard.tsx     # Reusable stat display
│       ├── SessionCard.tsx  # Session list item
│       ├── LoadingState.tsx # Loading skeleton
│       ├── ErrorState.tsx   # Error + retry UI
│       └── EmptyState.tsx   # Empty list placeholder
├── assets/
│   ├── icon.png             # App icon (1024×1024)
│   ├── splash.png           # Splash screen
│   └── fonts/                # (empty — system fonts only, see src/design/fonts.ts)
├── package.json             # React Native 0.76.1, Expo ~52
├── app.json                 # Expo config (bundle IDs, plugins, runtimeVersion)
├── eas.json                 # EAS Build profiles (dev, preview, production)
├── tsconfig.json            # strict: true, jsx: react-native
├── tailwind.config.js       # NativeWind theme (colors, fonts, spacing)
├── babel.config.js          # Babel preset for Expo + NativeWind
├── metro.config.js          # Metro bundler with NativeWind helper
└── README.md                # Dev/build/deploy instructions

```

## Backend Contract

API base: `https://prodrive.racecor.io`

### Auth Flow

1. User presses "Sign in with Discord"
2. `expo-auth-session` opens Discord OAuth modal with PKCE challenge
3. Redirect URI: `racecor-prodrive://auth` (configured in `app.json` scheme)
4. Exchange auth code for `access_token` + `refresh_token` at `/api/plugin-auth/token`
5. Store tokens in Secure Store via `tokenStore.ts`
6. Bearer token included in all API requests

### Endpoints (all require Bearer auth)

| Method | Endpoint | Response |
|--------|----------|----------|
| GET | `/api/v1/me` | User profile (id, username, email, iRatingCurrent, etc.) |
| GET | `/api/v1/dashboard` | Stats + recent sessions |
| GET | `/api/v1/sessions?category={All,Recent,Wins,League}&page=1` | Paginated session list |
| GET | `/api/v1/sessions/:id` | Single session detail |

See `src/api/types.ts` for full interface definitions.

## State Management

### TanStack Query + AsyncStorage

Queries are persisted to AsyncStorage with a 24-hour TTL. Stale time is set per hook:
- `useMe()` — 30 min stale
- `useDashboard()` — 5 min stale
- `useSessions()` — 5 min stale, infinite query pagination
- `useSession()` — 30 min stale

Refetch on screen focus (Query default behavior).

### Auth Context

Single source of truth for `status`, `user`, `accessToken`. Provided at root in `app/_layout.tsx`. Protected routes redirect to `/(auth)/login` if status is `signOut`.

**Note**: Route protection is not yet implemented — add Expo Router `redirect()` in screen components or use a custom `withAuth()` HOC.

## Design System

Design tokens live in `src/design/tokens.ts`. Tailwind config (`tailwind.config.js`) defines:
- **Colors**: k10-red (#e53935), k10-red-mid, k10-red-dark, bg (#0a0a14), bg-surface, text primary/secondary
- **Fonts**: System (display + body), Menlo (mono) 2014 see src/design/fonts.ts
- **Spacing & radius**: xs, sm, md, lg, xl, 2xl
- **Shadows**: sm, md, lg

NativeWind v4 compiles Tailwind utilities to React Native style objects. Classes like `"bg-k10-red"` become `{ backgroundColor: "#e53935" }`.

### Fallback Fonts

If `.ttf` files are missing from `assets/fonts/`, Expo will use system defaults:
- iOS: San Francisco
- Android: Roboto

This allows development without licensed fonts. But EAS builds will fail if fonts are referenced in code but not present.

## iOS-Specific Config

In `app.json`:
- `bundleIdentifier: "racing.k10motorsports.prodrive.racecor.rn"`
- `supportsTablet: true` (iPad landscape rotation enabled)
- `infoPlist` includes Bonjour services (for future local network features)

Requires Apple Developer account + provisioning profile for test device.

## Android

Functional config in `app.json` but **untested**. Package name is `racing.k10motorsports.prodrive.racecor.rn`. Android-specific styling (Material 3, etc.) is not yet applied — vanilla components work on both platforms.

## Development Workflow

### Local

```bash
npm install
npx expo start
# Press i for iOS simulator or use Expo Go
```

### EAS Build

```bash
eas login
eas build -p ios --profile preview
```

First build takes 10+ minutes. Subsequent builds are cached. TestFlight upload is separate:

```bash
eas submit -p ios --latest
```

### Environment

`app.json` reads `Constants.expoConfig?.extra?.apiBaseUrl` for API base URL. Set via:
1. `.env` file: `EXPO_PUBLIC_API_BASE_URL=...` (for local dev)
2. EAS secret: `eas secret:create EXPO_PUBLIC_API_BASE_URL` (for builds)

## Known Limitations

1. **No refresh token rotation** — tokens from auth are stored as-is, no auto-refresh on 401. Implement in `src/api/client.ts` if auth flow supports refresh.
2. **Route protection missing** — any user can navigate to protected tabs without signing in. Add redirect logic in tab screens.
3. **No widget/Live Activity support** — iOS widgets and Live Activities require additional setup.
4. **Android untested** — styles may need Material 3 adjustments.
5. **Fonts fallback** — until `.ttf` files are present, system fonts are used.

## References

- **Plan document**: `/Users/kevinconboy/Documents/K10/racecor.io/mobile-app-plan.md`
- **API contract**: `/Users/kevinconboy/Documents/K10/racecor.io/native-apps-api-contract.md`
- **Server CLAUDE.md**: `/Users/kevinconboy/Documents/K10/racecor.io/racecor-prodrive-server/CLAUDE.md`
- **Expo docs**: https://docs.expo.dev
- **TanStack Query**: https://tanstack.com/query/latest
- **NativeWind**: https://www.nativewind.dev

## Next Steps

1. Design + provide app icon + splash screen (system fonts are default — no font work needed)
3. Add route protection (redirect unauthenticated users to login)
4. Implement Moments detail screen (video player)
5. Add push notifications (Expo Notifications)
6. Android testing + Material 3 styling
7. E2E tests (Detox)
8. TestFlight distribution flow
9. App Store submission
