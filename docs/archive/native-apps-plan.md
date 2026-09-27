# The Racing Desk — Native Apps Plan

*Drafted overnight 2026-04-22 → 2026-04-23. Revised 2026-04-25 — Electron shells removed; native-only roster.*

The web app at `prodrive.racing-desk.io` becomes four shipping native apps. This doc is the map: what got built, what remains, and the decisions behind the architecture.

## The roster — 4 apps grouped into 3 OS monorepos

Each operating system gets one private GitHub repo that houses every app targeting it. Inside each repo, apps live under `apps/<name>/`.

### `racing-desk-prodrive-macos/` — macOS

| App | Path | Stack | Login |
|---|---|---|---|
| Native | `apps/native/` | SwiftUI + AppKit, macOS 14+ | PKCE + Discord via ASWebAuthenticationSession |

### `racing-desk-prodrive-windows/` — Windows

| App | Path | Stack | Login |
|---|---|---|---|
| Native | `apps/native/` | WinUI 3 + C# .NET 8 | PKCE + Discord via system browser + URL scheme |

### `racing-desk-prodrive-ios/` — iOS + iPadOS (universal apps)

| App | Path | Stack | Login |
|---|---|---|---|
| Native | `apps/native/` | SwiftUI, iOS 17+ | PKCE + Discord via ASWebAuthenticationSession |
| RN | `apps/rn/` | Expo SDK 52+, Expo Router, TanStack Query, NativeWind | PKCE + Discord via expo-auth-session |

### Why grouped by OS rather than one repo per app

- **Apps for the same OS share a platform vocabulary** — the same Xcode / Visual Studio toolchain, the same signing process, the same store submission path. Grouping means when you sit down to work on "the mac apps today," everything is in one `git pull`.
- **iOS has two apps because the native/RN split is deliberately parallel** — the whole point is you'll kill one of the two after TestFlight. Keeping them together makes the "pick a winner" decision visible and the losing codebase easy to archive.
- **Nothing is shared at the package level** — there's no `packages/*` shared directory at the monorepo root. Each app owns its full toolchain and dependency tree. Add shared packages only when concrete duplication appears.
- **Independent release cadence preserved** — each app tags its own versions (e.g. `macos-native@0.1.0`). Nothing forces them to ship together.

### Why 4 and not 3 or 5

- **4 vs 3**: iOS gets two — the SwiftUI native and the Expo RN — shipped in parallel. Pick a winner after TestFlight feedback.
- **4 vs 5**: No Android. You named Windows/macOS/iOS, not Android. If Android becomes a priority, Expo makes the RN app a two-platform target with one additional `eas build` command.
- **Separate iPhone and iPad builds (would split iOS again)**: rejected. SwiftUI and Expo both do universal apps with size-class-aware layouts. That's the modern Apple-recommended shape for iOS 13+.

### Why native-only (no shells)

The Electron/WKWebView shells were dropped — they were a bridge while native ramped up, not a long-term surface. Native apps deliver the better experience (real navigation, haptics, widgets, Live Activities, keyboard shortcuts, menu bars, smaller install size, offline cache, push notifications) and the shells were always going to be retired once native reached parity. We're skipping the bridge.

## Server-side changes in `racing-desk-prodrive-server`

**All additive. Nothing existing breaks.** Changes land as separate commits on a branch; review in the morning.

1. **`src/lib/queries/*`** — every Drizzle query currently inlined in a Server Component gets lifted into a pure function here. The Server Component imports it; a new `/api/v1/*` route handler also imports it. Zero user-visible change to the web app.
2. **`/api/v1/*`** — JSON REST endpoints for every screen the native apps need (`/dashboard`, `/races`, `/races/:id`, `/moments`, `/tracks`, `/cars`, `/dna`, `/when`, `/safety`, `/composure`, `/next-race-ideas`, `/should-i-race-now`). Bearer auth via the existing `plugin-auth` verify logic.
3. **Extend `/api/plugin-auth/authorize`** — currently validates `redirect_uri` is localhost only. Widen to accept a known-client list where each native app has a registered `client_id` and allowed redirect set (e.g. `racing-desk-native://auth` for custom schemes). Stays backwards-compatible with the SimHub plugin.
4. **Style Dictionary native targets** — extend `apps/web/src/lib/tokens/build.ts` with `tokens.swift` (SwiftUI Color extensions), `tokens.cs` (WinUI ResourceDictionary), `tokens.json` (for RN). Served from `/api/tokens/native?format=swift|cs|json`. Native apps fetch on launch, cache to disk, rebuild UI on change. Same live-token pipeline the overlay uses.

## Auth — how Discord login works across platforms

All apps use the PKCE flow against the same `/api/plugin-auth/*` endpoints (shared with the SimHub plugin):

```
1. App generates random code_verifier → SHA256 → code_challenge
2. App opens SYSTEM BROWSER (not in-app WebView — Apple/Google require this)
   → https://prodrive.racing-desk.io/api/plugin-auth/authorize
      ?client_id=racing-desk-prodrive-ios
      &code_challenge=...
      &redirect_uri=racing-desk-native://auth
      &state=<random>
3. Server redirects user through the normal Discord OAuth (same as the web)
4. Discord redirects back to server
5. Server issues one-time code, redirects to racing-desk-native://auth?code=XXX&state=...
6. OS hands the URL to the native app via registered URL scheme
7. App POSTs { code, code_verifier } to /api/plugin-auth/token → Bearer token
8. App stores Bearer token in Keychain / Credential Manager / SecureStore
9. Every API call sends Authorization: Bearer <token>
```

Platform SDKs that make step 2/6 clean:

- **Apple** (iOS/iPadOS/macOS): `ASWebAuthenticationSession` — opens Safari with shared cookies, handles the custom URL scheme callback, returns the final URL to the app.
- **Windows**: `WebAuthenticationBroker` for WinUI 3, or just `Process.Start(url)` + a URL-scheme handler registered via MSIX package manifest.
- **React Native**: `expo-auth-session` wraps `ASWebAuthenticationSession` on iOS and Custom Tabs on Android.

## Design tokens across platforms

The token pipeline in `apps/web/src/lib/tokens/build.ts` is Style Dictionary. Native apps get three new targets (see Server changes #4):

- `tokens.swift` — `extension Color { static let bgSurface = Color(...) }`, `struct Typography { static let displayFont = Font.custom(...) }`, etc.
- `tokens.cs` — static class `RaceCorTokens { public static Color BgSurface => ... }` + a ResourceDictionary for XAML binding.
- `tokens.json` — flat JSON for RN to consume.

All three published at `/api/tokens/native?format=<fmt>` with cache-control headers, same as the existing CSS blob pipeline. Apps fetch on launch, cache to disk, hot-swap when version changes. This means tokens edited via the admin UI at `/drive/admin/styles` reach every surface — web, overlay, and now four native apps — from one source.

## Repo structure conventions

Each app repo includes:

```
README.md              # what this is, how to run, build, sign
CLAUDE.md              # architecture notes for future Claude sessions
next-steps.md          # punch list of what remains after scaffolding
.gitignore
LICENSE                # placeholder — update before publishing
src/                   # actual code
docs/                  # platform-specific deep dives if needed
```

No CI workflows in the first pass — your call whether to use GitHub Actions, EAS, Xcode Cloud, etc. per app.

## What I actually shipped tonight

See the individual `next-steps.md` files in each repo for a precise status, and the commit log in `racing-desk-prodrive-server` for the backend work. Summary at the end of this doc gets filled in before I hand off.

## Open questions for you to answer in the morning

1. **Bundle IDs** — I've used `racing.doooom.prodrive.racing-desk.*` (e.g. `racing.doooom.prodrive.racing-desk.mac`, `racing.doooom.prodrive.racing-desk.ios`). Swap to whatever your Apple Developer team / Microsoft Partner Center is actually registered under. Grep-replaceable.
2. **App name** — "The Racing Desk" everywhere. If the App Store fights you on length, "Pro Drive" alone is the fallback.
3. **Signing** — every app has placeholder signing config. You mentioned you'll generate/download certs. For Windows the MSIX route needs Partner Center.
4. **Icon art** — placeholder PNGs. You have a logomark (`--rd-red` chevron) but I don't have a print-quality 1024×1024 source. Drop one in `assets/icon-source.png` per repo and the build scripts pick it up.
5. **RN vs SwiftUI iOS** — eventually you'll pick one. Ship both to TestFlight as separate apps (different bundle IDs, different product names in App Store Connect e.g. "Pro Drive" and "Pro Drive (RN preview)") for a month, decide based on what actually feels better.
6. **Android on the RN app** — trivial to add later, just `eas build -p android`. Gated on whether enough of your audience is on Android to justify the polish tax.
7. **Overlay token publishing** — unrelated but still open per `racing-desk-prodrive-server/CLAUDE.md`. The new `tokens-native` target doesn't solve it.

## Where things live

```
/Users/kevinconboy/Documents/K10/racing-desk.io/
├── racing-desk-prodrive-server/           (existing — web + API + now the v1 endpoints)
├── racecorio-prodrive/                (existing — overlay + plugin + SimHub stuff)
├── racing-desk-prodrive-macos/            NEW monorepo (1 app)
│   ├── apps/
│   │   └── native/                    SwiftUI/AppKit mac
│   ├── README.md
│   └── CLAUDE.md
├── racing-desk-prodrive-windows/          NEW monorepo (1 app)
│   ├── apps/
│   │   └── native/                    WinUI 3
│   ├── README.md
│   └── CLAUDE.md
├── racing-desk-prodrive-ios/              NEW monorepo (2 apps — pick a winner)
│   ├── apps/
│   │   ├── native/                    SwiftUI iOS/iPadOS
│   │   └── rn/                        Expo React Native
│   ├── README.md
│   └── CLAUDE.md
├── native-apps-plan.md                (this file)
└── native-apps-api-contract.md        (sibling — endpoint catalogue)
```

Three private GitHub repos, `alternatekev/racing-desk-prodrive-{macos,windows,ios}`.
