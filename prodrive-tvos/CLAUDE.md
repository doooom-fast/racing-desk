# prodrive-tvos — Pro Drive for Apple TV

Minimal SwiftUI dashboard viewer for Apple TV — the simplest of the Pro Drive native apps. Three tabs, an animated `DataStrip` ticker, no editing or local recording.

## What's in the app

Single SwiftUI hierarchy:

| Component | Purpose |
|-----------|---------|
| `RootView` | Auth-state tree (login → main shell) |
| `LoginView` | Device-link OAuth — shows 6-char code; user enters at racecor.io/link |
| `MainShell` | Sidebar nav (top-left float) + 3 tabs |
| `DashboardTVView` | The 3 tabs: Performance, NextRace, Previous |
| `DataStrip` | Animated ticker bar across the bottom showing iRating + SR live |
| Visualizations | Charts |

## Tech stack

- **SwiftUI**, deployment target **tvOS 17**
- **Swift 5.9**
- **SwiftDraw 0.27.0** — the only third-party SwiftPM dependency, used for SVG rendering
- **XcodeGen** for project file generation

## Auth — device-link

Apple TV can't open a browser, so sign-in goes through a device-link flow:

1. App calls `POST /api/plugin-auth/device/start` → server returns `device_code` + 6-char `user_code`
2. App displays the user code on the TV
3. User goes to `racecor.io/link` on phone or laptop, enters the code, signs in with Discord
4. App polls `POST /api/plugin-auth/device/poll` until the server returns the access token
5. Token stored in Keychain

Codes expire after 10 minutes; if so, exit and re-enter the app to get a new one.

## API consumed

Same Bearer-authed surface as iOS / macOS:

- `/api/v1/me`
- `/api/v1/sessions`
- `/api/v1/sessions/{id}`
- `/api/v1/dashboard?tz=...`
- `/api/v1/tokens/native?format=swift`

Plus calc engines at `api.prodrive.racecor.io/api/v1/calc/*` for race-summary / next-race-ideas.

## What this repo does NOT do

- **No live in-game telemetry.** Apple TV doesn't run any sim. This is a viewer.
- **No iRacing data upload.** Read-only client.
- **No local recording or editing.**
- **No iCloud mirroring from macOS.** This is a separate native app, not a mirror.
- **No watchOS app.** (None of the Apple repos have a watch target yet — design doc only, in `../prodrive-ios/watchos-plan.md`.)

## Cross-repo seams

Same backend as iOS / macOS / Windows desktop:

- Auth: `/api/plugin-auth/device/{start, poll}` PKCE-style device flow
- Data: `/api/v1/*` Bearer
- Tokens: `/api/v1/tokens/native?format=swift`

## Release wave

**Wave 2** of the lockstep release alongside iOS / macOS / Windows, per the release orchestrator at [`.claude/commands/release.md`](../.claude/commands/release.md). Distributed via TestFlight (same Apple Developer account as iOS).

## Agent work policy

All agent-spawned work MUST use `isolation: "worktree"`. Exceptions: read-only exploration, single non-code file writes.

## Pointers

- Cross-repo orchestration: [`../prodrive-context/monorepo-orchestration.md`](../prodrive-context/monorepo-orchestration.md)
- Native API contract: [`../prodrive-context/native-apps-api-contract.md`](../prodrive-context/native-apps-api-contract.md)
- Sibling iOS app: [`../prodrive-ios/CLAUDE.md`](../prodrive-ios/CLAUDE.md)
- Sibling macOS app: [`../prodrive-macos/CLAUDE.md`](../prodrive-macos/CLAUDE.md)
