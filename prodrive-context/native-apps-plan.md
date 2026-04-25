# RaceCor Pro Drive — Native Apps Plan

*Drafted overnight 2026-04-22 → 2026-04-23.*

The web app at `prodrive.racecor.io` becomes seven shipping native apps. This doc is the map: what got built, what remains, and the decisions behind the architecture.

## The roster — 7 apps grouped into 3 OS monorepos

Each operating system gets one private GitHub repo that houses every app targeting it. Inside each repo, apps live under `apps/<name>/`.

### `racecor-prodrive-macos/` — macOS

| App | Path | Stack | Login |
|---|---|---|---|
| Shell | `apps/shell/` | Electron → prodrive.racecor.io | Web Discord inside BrowserWindow |
| Native | `apps/native/` | SwiftUI + AppKit, macOS 14+ | PKCE + Discord via ASWebAuthenticationSession |

### `racecor-prodrive-windows/` — Windows

| App | Path | Stack | Login |
|---|---|---|---|
| Shell | `apps/shell/` | Electron → prodrive.racecor.io | Web Discord inside BrowserWindow |
| Native | `apps/native/` | WinUI 3 + C# .NET 8 | PKCE + Discord via system browser + URL scheme |

### `racecor-prodrive-ios/` — iOS + iPadOS (universal apps)

| App | Path | Stack | Login |
|---|---|---|---|
| Shell | `apps/shell/` | SwiftUI + WKWebView | Web Discord inside WKWebView |
| Native | `apps/native/` | SwiftUI, iOS 17+ | PKCE + Discord via ASWebAuthenticationSession |
| RN | `apps/rn/` | Expo SDK 52+, Expo Router, TanStack Query, NativeWind | PKCE + Discord via expo-auth-session |

### Why grouped by OS rather than one repo per app

- **Shell and native for the same OS share a platform vocabulary** — the same Xcode / Visual Studio toolchain, the same signing process, the same store submission path. Grouping means when you sit down to work on "the mac apps today," everything is in one `git pull`.
- **iOS has three apps because the shell/native/RN split is deliberately parallel** — the whole point is you'll kill two of the three after TestFlight. Keeping them together makes the "pick a winner" decision visible and the losing codebases easy to archive.
- **Nothing is shared at the package level** — there's no `packages/*` shared directory at the monorepo root. Each app owns its full toolchain and dependency tree. Add shared packages only when concrete duplication appears.
- **Independent release cadence preserved** — each app tags its own versions (e.g. `macos-shell@0.1.0`, `macos-native@0.1.0`). Nothing forces them to ship together.

### Why 7 and not 6 or 8

- **7 vs 6**: You said the existing `mobile-app-plan.md` (React Native) belongs in scope. So #7 is that app, living alongside — not replacing — the SwiftUI iOS native app in #6. Two approaches to the same mobile platform, shipped in parallel, pick a winner after TestFlight feedback.
- **7 vs 8**: No Android. You named Windows/macOS/iOS, not Android. If Android becomes a priority, Expo makes #7 a two-platform app with one additional `eas build` target.
- **Separate iPhone and iPad builds (would make it 10)**: rejected. SwiftUI and Expo both do universal apps with size-class-aware layouts. That's the modern Apple-recommended shape for iOS 13+.

### Why shells *and* native

- **Shells** ship **this week**. They're an Electron/WKWebView wrapper around the same web app you already run. The user gets a dock icon, a Start menu entry, and an App Store listing. Day-of-release-day distribution of features. Zero feature drift because there's nothing to drift.
- **Native** apps are the *better* experience — real navigation, haptics, widgets, Live Activities, keyboard shortcuts, menu bars, smaller install size, offline cache, push notifications. They take longer to reach feature parity but become the preferred surface over time.
- You don't need to choose between them. The shell is the bridge until the native is ready, and after that the shell is the fallback for anything the native hasn't ported yet.

## Server-side changes in `racecor-prodrive-server`

**All additive. Nothing existing breaks.** Changes land as separate commits on a branch; review in the morning.

1. **`src/lib/queries/*`** — every Drizzle query currently inlined in a Server Component gets lifted into a pure function here. The Server Component imports it; a new `/api/v1/*` route handler also imports it. Zero user-visible change to the web app.
2. **`/api/v1/*`** — JSON REST endpoints for every screen the native apps need (`/dashboard`, `/races`, `/races/:id`, `/moments`, `/tracks`, `/cars`, `/dna`, `/when`, `/safety`, `/composure`, `/next-race-ideas`, `/should-i-race-now`). Bearer auth via the existing `plugin-auth` verify logic.
3. **Extend `/api/plugin-auth/authorize`** — currently validates `redirect_uri` is localhost only. Widen to accept a known-client list where each native app has a registered `client_id` and allowed redirect set (e.g. `racecor-prodrive://auth` for custom schemes). Stays backwards-compatible with the SimHub plugin.
4. **Style Dictionary native targets** — extend `apps/web/src/lib/tokens/build.ts` with `tokens.swift` (SwiftUI Color extensions), `tokens.cs` (WinUI ResourceDictionary), `tokens.json` (for RN and Electron). Served from `/api/tokens/native?format=swift|cs|json`. Native apps fetch on launch, cache to disk, rebuild UI on change. Same live-token pipeline the overlay uses.

## Auth — how Discord login works across platforms

One flow, two mechanics:

**Shells** (Electron, WKWebView): load `prodrive.racecor.io` in an embedded browser. User clicks "Sign in with Discord" → Discord's OAuth → session cookie stored inside the embedded browser. Identical to the web.

**Native** (SwiftUI, WinUI, Expo): the PKCE flow you already have for SimHub plugin, against the same `/api/plugin-auth/*` endpoints:

```
1. App generates random code_verifier → SHA256 → code_challenge
2. App opens SYSTEM BROWSER (not in-app WebView — Apple/Google require this)
   → https://prodrive.racecor.io/api/plugin-auth/authorize
      ?client_id=racecor-prodrive-ios
      &code_challenge=...
      &redirect_uri=racecor-prodrive://auth
      &state=<random>
3. Server redirects user through the normal Discord OAuth (same as the web)
4. Discord redirects back to server
5. Server issues one-time code, redirects to racecor-prodrive://auth?code=XXX&state=...
6. OS hands the URL to the native app via registered URL scheme
7. App POSTs { code, code_verifier } to /api/plugin-auth/token → Bearer token
8. App stores Bearer token in Keychain / Credential Manager / SecureStore
9. Every API call sends Authorization: Bearer <token>
```

Platform SDKs that make step 2/6 clean:

- **Apple** (iOS/iPadOS/macOS): `ASWebAuthenticationSession` — opens Safari with shared cookies, handles the custom URL scheme callback, returns the final URL to the app.
- **Windows**: `WebAuthenticationBroker` for WinUI 3, or just `Process.Start(url)` + a URL-scheme handler registered via MSIX package manifest.
- **React Native**: `expo-auth-session` wraps `ASWebAuthenticationSession` on iOS and Custom Tabs on Android.
- **Electron**: doesn't need PKCE (uses the web flow directly in the BrowserWindow).

## Design tokens across platforms

The token pipeline in `apps/web/src/lib/tokens/build.ts` is Style Dictionary. Native apps get three new targets (see Server changes #4):

- `tokens.swift` — `extension Color { static let bgSurface = Color(...) }`, `struct Typography { static let displayFont = Font.custom(...) }`, etc.
- `tokens.cs` — static class `RaceCorTokens { public static Color BgSurface => ... }` + a ResourceDictionary for XAML binding.
- `tokens.json` — flat JSON for RN and Electron renderer to consume.

All three published at `/api/tokens/native?format=<fmt>` with cache-control headers, same as the existing CSS blob pipeline. Apps fetch on launch, cache to disk, hot-swap when version changes. This means tokens edited via the admin UI at `/drive/admin/styles` reach every surface — web, overlay, and now seven native apps — from one source.

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

See the individual `next-steps.md` files in each repo for a precise status, and the commit log in `racecor-prodrive-server` for the backend work. Summary at the end of this doc gets filled in before I hand off.

## Open questions for you to answer in the morning

1. **Bundle IDs** — I've used `racing.k10motorsports.prodrive.racecor.*` (e.g. `racing.k10motorsports.prodrive.racecor.mac`, `racing.k10motorsports.prodrive.racecor.iosshell`). Swap to whatever your Apple Developer team / Microsoft Partner Center is actually registered under. Grep-replaceable.
2. **App name** — "RaceCor Pro Drive" everywhere. If the App Store fights you on length, "Pro Drive" alone is the fallback.
3. **Signing** — every app has placeholder signing config. You mentioned you'll generate/download certs. For Windows the MSIX route needs Partner Center; the `electron-builder` NSIS fallback works without it.
4. **Icon art** — placeholder PNGs. You have a logomark (`--k10-red` chevron) but I don't have a print-quality 1024×1024 source. Drop one in `assets/icon-source.png` per repo and the build scripts pick it up.
5. **RN vs SwiftUI iOS** — eventually you'll pick one. Ship both to TestFlight as separate apps (different bundle IDs, different product names in App Store Connect e.g. "Pro Drive" and "Pro Drive (RN preview)") for a month, decide based on what actually feels better.
6. **Android on the RN app** — trivial to add later, just `eas build -p android`. Gated on whether enough of your audience is on Android to justify the polish tax.
7. **Overlay token publishing** — unrelated but still open per `racecor-prodrive-server/CLAUDE.md`. The new `tokens-native` target doesn't solve it.

## Where things live

```
/Users/kevinconboy/Documents/K10/racecor.io/
├── racecor-prodrive-server/           (existing — web + API + now the v1 endpoints)
├── racecorio-prodrive/                (existing — overlay + plugin + SimHub stuff)
├── racecor-prodrive-macos/            NEW monorepo (2 apps)
│   ├── apps/
│   │   ├── shell/                     Electron mac
│   │   └── native/                    SwiftUI/AppKit mac
│   ├── README.md
│   └── CLAUDE.md
├── racecor-prodrive-windows/          NEW monorepo (2 apps)
│   ├── apps/
│   │   ├── shell/                     Electron Windows
│   │   └── native/                    WinUI 3
│   ├── README.md
│   └── CLAUDE.md
├── racecor-prodrive-ios/              NEW monorepo (3 apps — pick a winner)
│   ├── apps/
│   │   ├── shell/                     WKWebView
│   │   ├── native/                    SwiftUI iOS/iPadOS
│   │   └── rn/                        Expo React Native
│   ├── README.md
│   └── CLAUDE.md
├── native-apps-plan.md                (this file)
└── native-apps-api-contract.md        (sibling — endpoint catalogue)
```

Three private GitHub repos, `alternatekev/racecor-prodrive-{macos,windows,ios}`.
