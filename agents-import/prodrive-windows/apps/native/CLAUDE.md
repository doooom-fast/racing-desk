# RaceCor Pro Drive — Windows Native App (WinUI 3)

Fully native Windows desktop application using WinUI 3 + C# .NET 8. NOT Electron, NOT WebView. Part of the 7-app Pro Drive native ecosystem.

## Architecture

**MVVM-lite pattern**: Pages contain minimal code-behind; ViewModels (simple classes) manage state. ApiClient handles HTTP + Bearer tokens. AuthService orchestrates OAuth 2.0 PKCE flow.

### Key Decisions

1. **Unpackaged vs MSIX (v1 unpackaged)**
   - Development: unpackaged app (simpler debugging, no package identity required initially)
   - Release: flip to MSIX (signed, Windows Store, better security isolation)
   - Protocol handler: Registry .reg file for dev; Package.appxmanifest for MSIX

2. **PasswordVault for token storage**
   - Secure OS credential store (encrypted with user's Windows login)
   - First-run friendly (handles no-credential case gracefully)
   - Rationale: Firefox / Edge use it; better than isolated storage for sensitive data

3. **WebAuthenticationBroker caveats for unpackaged apps**
   - Unreliable for unpackaged apps on some Windows versions
   - Fallback: `Process.Start()` + system browser + protocol handler
   - Callback URI: `racecor-prodrive://auth?code=...&state=...`

4. **No build step**
   - XAML compiled in-place by the WinUI SDK
   - No bundler, no webpack
   - Direct .NET tooling: `dotnet build`, `dotnet publish`

## API Contract

All endpoints require `Authorization: Bearer <access_token>` header.

- **Auth**: `/api/plugin-auth/authorize` (PKCE) → `/api/plugin-auth/token` (exchange / refresh)
- **Data**: `/api/v1/me`, `/api/v1/sessions`, `/api/v1/dashboard` (stub, expandable)
- **Token format**: store as `{ accessToken, refreshToken, expiresAt }` in PasswordVault

See `/Users/kevinconboy/Documents/K10/racecor.io/native-apps-plan.md` and `native-apps-api-contract.md` for cross-app architecture.

## Tech Stack

- **Framework**: WinUI 3 (Windows App SDK 1.6+)
- **Runtime**: .NET 8 (net8.0-windows10.0.19041.0)
- **Language**: C# with nullable reference types enabled
- **Auth**: PKCE (PkceHelper), PasswordVault (TokenStore)
- **HTTP**: HttpClient with automatic 401 → refresh → retry

## Project Layout

```
RaceCorProDrive.sln
├── src/RaceCorProDrive/
│   ├── RaceCorProDrive.csproj
│   ├── App.xaml / App.xaml.cs
│   ├── MainWindow.xaml / MainWindow.xaml.cs
│   ├── Pages/
│   │   ├── LoginPage.xaml / .cs
│   │   ├── DashboardPage.xaml / .cs
│   │   ├── SessionsPage.xaml / .cs
│   │   ├── SessionDetailPage.xaml / .cs
│   │   └── PlaceholderPage.xaml / .cs
│   ├── Auth/
│   │   ├── AuthService.cs
│   │   ├── PkceHelper.cs
│   │   └── TokenStore.cs
│   ├── Api/
│   │   ├── ApiClient.cs
│   │   └── Models.cs
│   ├── DesignSystem/
│   │   ├── Tokens.cs
│   │   ├── DesignSystem.xaml / .xaml.cs
│   ├── Support/
│   │   └── AppLogger.cs
│   ├── Package.appxmanifest
│   ├── app.manifest
│   └── Properties/
│       └── launchSettings.json
├── assets/
│   ├── icon.png (placeholder)
│   └── register-scheme.reg (dev protocol handler)
├── .gitignore
└── README.md
```

## Building

### Prerequisites
- Visual Studio 2022 17.8+
- .NET 8 SDK
- Windows App SDK workload (auto-installed with WinUI 3 NuGet)

### Development
```bash
# Open solution
open RaceCorProDrive.sln  # or vs RaceCorProDrive.sln

# Build
dotnet build

# Debug
# Press F5 in Visual Studio or:
dotnet run
```

### Protocol Handler Registration (Unpackaged)
```bash
# On Windows (admin):
regedit /s assets/register-scheme.reg
# (Edit path in .reg file for your user)

# Verify:
explorer racecor-prodrive://auth
```

## Design System

Colors, fonts, and spacing defined in `DesignSystem/Tokens.cs` and exposed via `DesignSystem.xaml` ResourceDictionary:

- **K10 Red**: #E53935 (primary, buttons)
- **Background**: #0A0A14 (dark theme, v1 only)
- **Surface**: #1A1A24 (cards, panels)
- **Text**: #FFFFFF primary, #A0A0A0 secondary, #707070 tertiary
- **Font**: system fonts (SF Pro on Apple, Segoe UI Variable on Windows, Menlo for mono)

## OAuth 2.0 PKCE Flow

1. **User clicks "Sign in with Discord"**
   - `AuthService.SignInAsync()` generates verifier + challenge
   - Opens browser to `https://prodrive.racecor.io/api/plugin-auth/authorize?...`

2. **User grants permission on web**
   - Redirects to `racecor-prodrive://auth?code=...&state=...`

3. **Protocol handler routes to app**
   - `OnAuthCallbackAsync()` in AuthService
   - Exchanges code for tokens (POST `/api/plugin-auth/token`)

4. **Tokens stored securely**
   - PasswordVault (encrypted OS credential store)
   - Auto-refresh on 401 + retry

## Pages

| Page | Status | Purpose |
|------|--------|---------|
| LoginPage | Ready | Discord sign-in, K10 red button |
| DashboardPage | Ready (stub) | Stat tiles (WIP), recent sessions |
| SessionsPage | Ready | Paginated list, category filter, tap → detail |
| SessionDetailPage | Ready | Session header, laps list |
| PlaceholderPage | Ready | Reusable for Moments/Tracks/Cars/DNA/When/Safety/Composure/Debrief/Settings |

## Packaging for MSIX Release

1. Right-click project → Publish → Create App Packages
2. Provide Package Identity (K10 Motorsports, racing.k10motorsports.prodrive.racecor.win)
3. Sign with trusted EV certificate (see next-steps.md for cert procurement)
4. Submit to Microsoft Partner Center

For unpackaged → packaged flip:
- `RaceCorProDrive.csproj`: set `WindowsPackageType=Win32` (or `MSIX`)
- `Package.appxmanifest`: already includes protocol handler registration
- Certificate: self-signed for dev, EV for release

## Deployment Modes

1. **Unpackaged (dev/sideload)**
   - No package identity required
   - Protocol handler via Registry
   - Simple: just copy .exe

2. **MSIX (release)**
   - Package identity: racing.k10motorsports.prodrive.racecor.win
   - Protocol handler via manifest
   - Signed with EV cert
   - Distributable via Partner Center or direct .msix install

## Next Steps (Out of Scope for v0)

1. **Richer dashboard** — when `/api/v1/dashboard` is fully implemented
2. **Moments + DNA + When** — full page implementations (not PlaceholderPage)
3. **Accent-color integration** — read Windows theme and apply to UI
4. **Notifications** — Windows.UI.Notifications toasts for live updates
5. **Jump list entries** — Recently accessed sessions in taskbar
6. **Taskbar badge** — Unread moments count
7. **Microsoft Store / Partner Center** — full submission workflow
8. **EV certificate** — procurement and CI signing
9. **Accessibility pass** — Narrator support, high-contrast theme, keyboard nav
10. **ARM64 signing** — parallel build target (csproj ready, needs test)

## Cross-Repo References

- See `/Users/kevinconboy/Documents/K10/racecor.io/native-apps-plan.md` for full 7-app ecosystem
- See `/Users/kevinconboy/Documents/K10/racecor.io/native-apps-api-contract.md` for shared backend API details
- Web project (closed repo): design tokens, demo generation script

## Troubleshooting

**401 errors on API calls**: Token may be expired. Check `TokenStore.LoadTokens()` and `AuthService.RefreshTokenAsync()`.

**Protocol handler not firing**: Verify Registry entry via `regedit HKEY_CURRENT_USER\Software\Classes\racecor-prodrive`. Path must point to actual .exe.

**XAML binding failures**: Check DesignSystem.xaml is merged in App.xaml.

**WebAuthenticationBroker timeout**: Expected for unpackaged apps. Fallback to system browser + protocol handler is active by default.
