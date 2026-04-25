# RaceCor Pro Drive — Windows Electron Shell

One of 7 native app shells being built for RaceCor Pro Drive. This project wraps https://prodrive.racecor.io in an Electron BrowserWindow, providing:

- **NSIS installer** (.exe) for users without Microsoft Store
- **MSIX package** (.appx) for Microsoft Store distribution
- **Custom URL scheme** (`racecor-prodrive://`) for OAuth deep-linking
- **Single-instance lock** critical on Windows for callback handling
- **Auto-updater** via GitHub Releases (electron-updater)
- **Window state persistence** to %APPDATA%/RaceCor Pro Drive/

See `/Users/kevinconboy/Documents/K10/racecor.io/native-apps-plan.md` for the 7-app strategy and cross-platform decisions.

## Architecture & Key Decisions

### Single-Instance Lock (CRITICAL ON WINDOWS)

Discord OAuth on Windows requires a running, focused window. When an OAuth callback arrives as a custom URL scheme link, the OS launches a second Electron instance. The single-instance lock prevents this; instead, it routes the URL to the already-running instance via IPC.

```javascript
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) app.quit();

app.on('second-instance', (event, argv) => {
  handleDeepLink(argv);
  mainWindow.focus();
});
```

Without this, OAuth fails on Windows.

### Installer Trade-offs: Squirrel vs NSIS vs MSIX

| Format | Pros | Cons | Use Case |
|--------|------|------|----------|
| **NSIS** (.exe) | Universal, no Store account needed, fast | No auto-update support (updates manual) | Primary distribution; legacy Windows PCs |
| **MSIX** (.appx) | Store-native, auto-updates via Store, security sandbox | Requires Partner Center account, stricter signing | Microsoft Store listing |
| **Squirrel** | Auto-updates built-in | macOS/Windows only, aging infrastructure | Not used; superseded by electron-updater + GitHub |

We ship BOTH NSIS (for general users) and MSIX (for Store). NSIS users receive update prompts; Store users get automatic background updates.

### Auto-Updater Strategy

electron-updater is configured to poll GitHub Releases for new versions. On startup (outside dev mode), it checks for updates asynchronously and notifies the user.

**Limitation:** Auto-updates work for NSIS .exe but NOT MSIX. Microsoft Store handles MSIX updates automatically.

```javascript
if (!isDev) {
  autoUpdater.checkForUpdatesAndNotify();
}
```

To integrate a release pipeline:
1. Create a GitHub Actions workflow that builds and signs the .exe
2. Publish signed artifact to a GitHub Release tagged `v1.0.0`
3. electron-updater detects it and notifies users to update

### Context Bridge & Security

- `contextIsolation: true` — Renderer cannot access Node.js APIs
- `nodeIntegration: false` — No require() in renderer
- `sandbox: true` — Additional OS-level sandbox
- `preload.js` exposes only: `version()`, `platform()`, `openExternal()`, `onDeepLink()`

No sensitive data (API keys, auth tokens) should be stored in the renderer or main process. Auth is handled by the web app (NextAuth + Discord OAuth).

### Protocol Handler Registration

Windows registers `racecor-prodrive://` at build time via `build.protocols` in package.json. When clicked, the OS passes the URL to the app via `app.on('open-url')`, which sends it to the renderer via the `deep-link` IPC channel.

Verification:
```powershell
reg query HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.racecor-prodrive\UserChoice
```

## File Map

| File | Purpose |
|------|---------|
| `src/main/index.js` | Electron main process, window mgmt, IPC, protocol handler |
| `src/main/preload.js` | Context bridge, exposes minimal API to renderer |
| `src/main/window-state.js` | Persistence of window bounds to AppData |
| `assets/icon.ico` | NSIS + .exe icon (multi-res, 256x256 max) |
| `assets/icon.png` | Source icon (1024x1024, for design edits) |
| `package.json` | Dependencies, build config (electron-builder, protocols, NSIS/MSIX) |
| `.gitignore` | Excludes node_modules, dist/, .env |
| `README.md` | User guide: build, code signing, Store submission |
| `CLAUDE.md` | This file — architecture & decisions |
| `next-steps.md` | TODO: code signing cert, Partner Center, icon art, auto-updater |

## Building & Testing

```bash
# Dev
npm install && npm run dev

# Build (produces dist/RaceCor*Pro*Drive*1.0.0.exe and .msix)
npm run build:win

# Code signing (for production)
export CSC_LINK="path/to/cert.pfx"
export CSC_KEY_PASSWORD="password"
npm run build:win
```

## Known Gaps

1. **Code Signing** — Requires EV cert from DigiCert, Sectigo, etc. SmartScreen warns on unsigned builds.
2. **Icon Art** — Placeholder .txt files; needs design + export to .ico and .png.
3. **Auto-Updater Infrastructure** — GitHub Releases publishing not yet set up.
4. **Microsoft Store** — Partner Center account and app listing not yet created.
5. **Windows Jump List** — Could add recent sessions/features to taskbar jump list (nice-to-have).
6. **Toast Notifications** — Could integrate Windows 10+ native notifications (electron-windows-notifications or native Electron API).

## Cross-Project Notes

This project is **independent** of the overlay and plugin at runtime. The web app (prodrive.racecor.io) handles its own auth, data, and connectivity. The Electron shell is a thin wrapper providing system integration (protocol handler, installer, auto-updates, window mgmt).

If design tokens or the demo-generation script change in the closed repo, this project is unaffected.
