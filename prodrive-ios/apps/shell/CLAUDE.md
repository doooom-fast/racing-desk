# RaceCor Pro Drive iOS Shell

SwiftUI + WKWebView universal iOS/iPadOS app wrapping https://prodrive.racecor.io. Part of the 7-app native suite for RaceCor Pro Drive (see `/Users/kevinconboy/Documents/K10/racecor.io/native-apps-plan.md`).

## Architecture

**Hybrid model**: The web app is fully responsive and handles all feature logic. This shell provides:
- Native-level integration (deep links, cookies, Safari delegation)
- Pull-to-refresh via UIRefreshControl on the WKWebView's scrollView
- Custom URL scheme (`racecor-prodrive://`) for deep linking
- External link delegation (non-prodrive.racecor.io hosts open in SFSafariViewController per App Store guidelines 4.2)
- Persistent cookie storage via WKHTTPCookieStore
- Minimal JS injection to tag the DOM with `.ios-shell` and `.ios-iphone`/`.ios-ipad` so the web app can adapt styles if needed

## Structure

```
Sources/
  App/
    RaceCorProDriveApp.swift         @main SwiftUI App, onOpenURL router
    ContentView.swift                View container with LoadingIndicator
  WebView/
    WebContainerView.swift           UIViewRepresentable wrapping WKWebView
    WebViewCoordinator.swift         WKNavigationDelegate + WKUIDelegate
    ExternalLinkHandler.swift        SFSafariViewController dispatch
  Config/
    Config.swift                     Base URL + debug override
  DeepLink/
    DeepLinkRouter.swift             racecor-prodrive:// scheme handler
  UI/
    LoadingIndicator.swift           Subtle top progress bar

Resources/
  Info.plist                         Bundle config, URL schemes, orientations
  RaceCorProDrive.entitlements       Minimal (Sign in with Apple stub)
  Assets.xcassets/                   Icon set manifest
```

## Key Decisions

1. **No build step** — XcodeGen generates the project, sources are Swift + HTML/CSS/JS via WKWebView. No bundler or npm involved at this level.

2. **WKWebViewConfiguration** uses default `websiteDataStore` — cookies are persisted automatically, so auth state survives app restarts. The web app handles session management.

3. **Custom User-Agent** — appends `RaceCorProDriveShell/0.1.0 (iOS)` to the default UA string for server-side analytics. This lets the API distinguish shell users from web-only users.

4. **External link policy** — any http/https link to a host other than `prodrive.racecor.io` is canceled by the navigation delegate and handed to `ExternalLinkHandler.openInSafari()`. This opens SFSafariViewController, which:
   - Keeps the user in a sandboxed Safari context (better privacy than in-app WebView)
   - Avoids App Store rejection risk (guideline 4.2 discourages in-app browsing of arbitrary third-party sites)
   - Maintains visual separation between the app and external content

5. **Pull-to-refresh** — wired via `UIRefreshControl` on `webView.scrollView`. The coordinator observes `estimatedProgress` and ends the refresh control when loading finishes.

6. **Deep link routing** — `racecor-prodrive://auth?code=xyz&state=abc` URLs arrive at the app level via `onOpenURL`, routed through `DeepLinkRouter`, which appends the query string to the base URL and navigates the WKWebView. The web app handles the rest (OAuth callback, state validation, etc.).
   - **TODO**: Once the backend OAuth callback endpoint is finalized, update `DeepLinkRouter` to POST the deep link params to the API instead of navigating the web view.

7. **iPad layout** — no special chrome; the WebView fills safe areas and respects orientation. The web app's responsive design handles the rest. `UIRequiresFullScreen: false` allows iPad split-view multitasking.

8. **JS injection** — on `didFinish`, a small inline script adds `.ios-shell` and device-type classes to `<html>`. This allows the web app to tweak CSS (e.g., statusbar padding) without detecting user-agent strings.

## Build & Run

```bash
# Generate the Xcode project from XcodeGen config
xcodegen generate

# Open in Xcode
open RaceCorProDrive.xcodeproj

# Build and run on simulator or device
# Or use command line:
xcodebuild -scheme RaceCorProDrive-Debug -configuration Debug
```

## Future Extensions (Out of Scope)

- **Push Notifications**: Add APNS certificate, register with the web API for device tokens
- **iCloud Sync**: NSUbiquitousKeyValueStore for settings sync across devices
- **Handoff**: NSUserActivity for continuing sessions on other devices
- **Widgets**: SwiftUI App Intents for lock-screen or home-screen widgets (e.g., live race timer)
- **Shortcuts**: Register custom intents for Siri
- **Share Sheet**: NSItemProvider for sharing race replays or session data

## Testing

Currently no unit tests — all integration testing is manual via the simulator and physical devices. Future: Xcode UI tests (XCUITest) for critical paths (auth, pull-to-refresh, external link handling).

## Deployment

1. **Certificates & Provisioning**: Generate via Apple Developer portal, assign team ID in `project.yml` or Xcode settings
2. **TestFlight**: Use Xcode's "Destination: Any iOS Device (arm64)" build, then upload to App Store Connect and distribute to testers
3. **App Store**: TestFlight build, fill out app description/screenshots/privacy nutrition label, submit for review. Flag guideline 4.2 compliance (minimal browser use, deep linking, native features)

## References

- Root monorepo CLAUDE.md: `/Users/kevinconboy/Documents/K10/racecor.io/racecorio-prodrive/CLAUDE.md`
- Native apps plan: `/Users/kevinconboy/Documents/K10/racecor.io/native-apps-plan.md`
- Web app (responder): `https://github.com/alternatekev/racecor-prodrive-server` (closed)
