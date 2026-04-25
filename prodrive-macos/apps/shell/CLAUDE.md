# RaceCor Pro Drive — macOS Electron Shell

Native macOS Electron wrapper for RaceCor Pro Drive. This is one of 7 native app shells being built as cross-platform entry points to the web product. **This CLAUDE.md is scoped to the macOS Electron shell only.**

## Architecture

### Main/Renderer Separation

- **Main process** (`src/main/index.js`) — window lifecycle, menu bar, IPC, file system access, native integrations
  - Loads `https://prodrive.racecor.io` in a BrowserWindow
  - Persists window bounds to `{userData}/window-state.json`
  - Handles custom URL scheme (`racecor-prodrive://`) for future deeplinks
  - Routes external links (cross-origin) to system browser via `shell.openExternal()`
  - Exposes app version/platform via IPC
  - Stub for electron-updater (TODO: configure release server)

- **Preload script** (`src/main/preload.js`) — context bridge
  - Exposes `window.racecor = { version, platform, openExternal(url), onDeeplink(callback) }`
  - No node integration or enableRemoteModule
  - Minimal attack surface by design

- **Renderer** — the web app (prodrive.racecor.io)
  - All UI, state, auth, navigation handled by Next.js frontend
  - Discord OAuth via NextAuth (same as web)
  - No Electron-specific code needed yet (no native dialogs, notifications, or IPC beyond metadata)
  - Makes HTTP calls to Vercel Blob, Neon DB, Strapi as normal

### Why Route External Links to System Browser

The Electron BrowserWindow has its own cookie jar, separate from the system browser. If we let the app navigate to external links (docs, GitHub, status pages), the user may end up in a logged-out state because those sites don't share cookies with prodrive.racecor.io. By routing cross-origin navigation to the system browser, we preserve the user's web identity and avoid confusion.

### Navigation Flow

1. User clicks a link to prodrive.racecor.io/another-page → same origin → loads in BrowserWindow (no dialog)
2. User clicks a link to github.com/racecor → different origin → `will-navigate` event catches it, calls `shell.openExternal()` → opens in default browser
3. User clicks a link that would open a new window (target="_blank") → `setWindowOpenHandler` checks origin and either allows (same-origin) or opens externally

## Window State Persistence

`WindowState` class in `src/main/window-state.js`:
- Reads `{userData}/window-state.json` on startup; uses defaults if missing
- Tracks `moved` and `resized` events; saves bounds after each change
- Survives app crashes and restarts

This is intentional: users expect their window size/position to persist across app launches.

## Build Configuration

`electron-builder` config in `package.json`:
- **appId**: `racing.k10motorsports.prodrive.racecor.macshell`
- **productName**: `RaceCor Pro Drive`
- **Mac targets**: `dmg` + `zip`
- **Category**: `public.app-category.sports`
- **Hardened runtime**: enabled (required for notarization)
- **Entitlements**: `entitlements.mac.plist` (minimal: allow-jit, network-client)
- **Notarization**: configured for automated signing (requires env vars at build time)

## Native Features — Current & Future

**Current (implemented)**:
- Native menu bar (File, Edit, View, Window, Help) with macOS shortcuts
- Window state persistence
- Custom URL scheme registration
- Context isolation + no node integration

**Next (skeleton in place)**:
- Auto-updater via electron-updater (TODO: wire up GitHub Releases or other server)
- Deeplink handling for `racecor-prodrive://` scheme (unused for now; routed to renderer)

**Future (if needed)**:
- File system integration — open local MP4/replay files (would need file picker + IPC to add to Edit tool)
- Native notifications — when prodrive.racecor.io wires up web-push, show native macOS notifications
- Ambient light capture — if the overlay ever integrates, capture screen color for light mapping
- Menu bar agent mode — always-on-top, invisible dock icon, drive from menu bar

## Code Style

- **Vanilla Node.js** — no frameworks or build steps for the main/preload
- **Single entry point** — `src/main/index.js` only imports menu, window-state; no circular deps
- **Minimal IPC** — only `get-app-info` and deeplink channel so far
- **Security defaults** — contextIsolation true, nodeIntegration false, webSecurity true, preload required

## Testing

No automated tests yet. Manual test checklist:
- [ ] `npm install && npm run dev` launches without errors
- [ ] App loads prodrive.racecor.io in the BrowserWindow
- [ ] Cmd+R reloads the page
- [ ] Cmd+Q quits the app
- [ ] External links (File → Report Issue) open in system browser, not in the app
- [ ] Resize and move the window, quit, relaunch → bounds are restored
- [ ] DevTools open with Cmd+Shift+I

## Cross-Repo Integration Points

This app is **independent of the plugin and overlay** at runtime (doesn't poll port 8889, doesn't subscribe to telemetry). It's a wrapper shell, not an integrated system.

- **Icon**: will be provided by design; placeholder in `assets/icon.png`
- **Native-apps umbrella doc**: `/Users/kevinconboy/Documents/K10/racecor.io/native-apps-plan.md` tracks all 7 shells (macOS, Windows, iOS, Android, etc.)

## Known Limitations

- macOS only (this particular shell; other platforms have their own)
- No offline mode (always loads prodrive.racecor.io online)
- iRacing Web Scraping not supported (as per root CLAUDE.md, web scraping of iRacing data was unreliable and is now handled server-side by the plugin API)

## References

- **Root CLAUDE.md**: `/Users/kevinconboy/Documents/K10/racecor.io/racecorio-prodrive/CLAUDE.md`
- **Server CLAUDE.md**: `/Users/kevinconboy/Documents/K10/racecor.io/racecor-prodrive-server/CLAUDE.md`
- **Native apps plan**: `/Users/kevinconboy/Documents/K10/racecor.io/native-apps-plan.md`
