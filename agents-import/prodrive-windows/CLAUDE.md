# prodrive-windows — Pro Drive Windows desktop app

## What this repo is

The **Pro Drive Windows desktop app** — a full WinUI 3 (.NET 8) native client for the Pro Drive ecosystem. Far more than the "thin shell + installer" original framing.

The repo also produces the **combined Inno Setup installer** that bundles the desktop app **+ the Electron overlay**. The SimHub plugin is a **separate** install (lives in `prodrive-plugin`); this installer does NOT bundle it.

## What's in the app

Single solution (`RaceCorProDrive.sln`) with one project. Nine pages under `Pages/`:

| Page | Purpose |
|------|---------|
| **Login** | Discord PKCE OAuth (browser handoff, token in Credential Manager) |
| **Dashboard** | Stat tiles, HUD-status indicator, "launch overlay" FAB |
| **Sessions** | Paginated race list, category filter, fetched from `prodrive.racecor.io/api/v1/sessions` |
| **SessionDetail** | Session header + lap telemetry + AI debrief from server |
| **Library** | Local `.rcpdv` race-bundle browser (MP4 + telemetry sidecar) — uses `BundleReader` |
| **Editor** | MP4 viewer with bundle metadata overlay (clip prep — early stage) |
| **Settings** (5 tabs: Visual, Commentary, Recording, **Hardware** = Moza wheel/pedal/shifter, System) | App-wide config |
| **PlaceholderPage** | Stubs for Moments, Tracks, Cars, DNA, When, Safety, Composure, Debrief |

## Cross-repo seams

**Auto-launches the bundled overlay.** `IRacingDetector` polls `Local\IRSDKMemMapFileName` (the iRacing SDK shared-memory file) every 5 seconds. When iRacing starts, `OverlayLauncher` spawns `Overlay\RaceCorOverlay.exe` (path relative to the host binary).

**Polls the SimHub plugin.** Hits `http://localhost:8889/racecor-io-pro-drive/` for the Dashboard's HUD-status indicator. Plugin must be installed separately (this repo does NOT bundle it).

**Talks to prodrive-server.** All cloud data via `https://prodrive.racecor.io/api/v1/*` with Bearer auth from the PKCE flow. Endpoints: `/me`, `/sessions`, `/sessions/{id}`, `/dashboard`, `/tokens/native?format=cs`.

**Shares overlay settings.** Both host and overlay read/write `%APPDATA%\RaceCor.io\overlay-settings.json`. Host writes; overlay reads.

**LAN sharing via Bonjour/mDNS.** Advertises `prodrive-share._tcp` (Zeroconf NuGet) so other Pro Drive desktop apps on the LAN can discover and pull race bundles.

## Tech stack

- **.NET 8** (`global.json`)
- **WinUI 3** via `Microsoft.WindowsAppSDK` 1.5
- **Multi-arch:** x64 + ARM64
- **Packaging:** **unpackaged** today (Inno Setup single-folder install). MSIX-ready (`<WindowsPackageType>None</WindowsPackageType>` flips to `MSIX`).
- **Auth:** Discord PKCE → `Windows.Security.Credentials.PasswordVault`
- **Hardware:** `System.IO.Ports` + `System.Management` for Moza serial enumeration; 12 services in `Services/Moza/`

Auth: `/api/plugin-auth/*` PKCE. Client ID `racecor-prodrive-win`. Redirect `racecor-native://auth` (custom protocol handler) plus localhost for dev.

## What this repo does NOT do

- **Does NOT read `.ibt` files or upload telemetry directly.** `IRacingDetector` only watches for the SDK shared-memory file's existence. Telemetry upload is the job of the SimHub plugin.
- **Does NOT bundle the SimHub plugin.** The README's old claim that the installer bundles "plugin + overlay" was wrong; the plugin is a separate install. Branch history references `fix/installer-no-clobber-simhub` from when this was clarified.
- **Does NOT do RN.** This is pure WinUI 3 / C#.

## Agent work policy

All agent-spawned work should use `isolation: "worktree"`. Exceptions: read-only exploration, single-file doc updates.

## Pointers

- Cross-repo orchestration: [`../prodrive-context/monorepo-orchestration.md`](../prodrive-context/monorepo-orchestration.md)
- Native apps API contract: [`../prodrive-context/native-apps-api-contract.md`](../prodrive-context/native-apps-api-contract.md)
- Calc API integration: [`../prodrive-context/native-apps-calc-integration.md`](../prodrive-context/native-apps-calc-integration.md)
- The plugin (separate install): [`../prodrive-plugin/CLAUDE.md`](../prodrive-plugin/CLAUDE.md)
- The overlay (bundled in installer): [`../prodrive-overlay/CLAUDE.md`](../prodrive-overlay/CLAUDE.md)
- Server API: [`../prodrive-server/CLAUDE.md`](../prodrive-server/CLAUDE.md)
