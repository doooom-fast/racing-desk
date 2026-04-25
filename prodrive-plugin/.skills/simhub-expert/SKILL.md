---
name: simhub-expert
description: |
  SimHub platform expert for all K10 Motorsports applications.
  Use when working on SimHub plugin development, SimHub API integration, the HTTP server,
  dashboard templates, telemetry properties, or any SimHub-specific functionality.
  Triggers: SimHub, plugin, dashboard template, $prop, telemetry properties, HTTP server,
  port 8889, SimHub API, GameReaderCommon, AttachDelegate, DataCorePlugin, SimHub settings.
---

# SimHub Platform Expert

You are an expert on SimHub — the sim racing dashboard and telemetry platform that the RaceCor plugin extends. You understand SimHub's plugin architecture, API surface, and how the K10 platform integrates with it.

## Files to Read on Activation

```
# Plugin source
racecor-plugin/simhub-plugin/plugin/RaceCorProDrive.Plugin/Plugin.cs
racecor-plugin/simhub-plugin/plugin/RaceCorProDrive.Plugin/RaceCorProDrive.Plugin.csproj

# Plugin docs
racecor-plugin/docs/SIMHUB_PLUGIN.md
racecor-plugin/docs/DEVELOPMENT.md
racecor-plugin/docs/COMMENTARY_ENGINE.md

# API reference
docs/api-data-browser.html                    # Interactive viewer of 100+ JSON properties
```

## SimHub Plugin Architecture

### Runtime Environment

SimHub runs on **.NET Framework 4.8** (Windows only). Plugins are loaded as DLLs from SimHub's installation directory. The K10 plugin:
- Implements `IPlugin` and `IDataPlugin` interfaces from `SimHub.Plugins.dll`
- Registers properties via `AttachDelegate()` which exposes them to SimHub's property system
- Includes a WPF settings panel (`Control.xaml`) rendered inside SimHub's plugin settings tab
- Targets .NET Framework 4.8 with `UseWPF=true`

### SimHub Dependencies

All dependencies are SimHub-provided DLLs (not NuGet):

| Assembly | Purpose |
|----------|---------|
| `GameReaderCommon.dll` | Telemetry data access (`GameData`, `StatusData`) |
| `SimHub.Plugins.dll` | Plugin base class, `AttachDelegate`, settings API |
| `SimHub.Logging.dll` | Logging infrastructure |
| `Newtonsoft.Json.dll` | JSON serialization (SimHub's bundled version) |
| `log4net.dll` | Logging backend |

Referenced with `Private=False` (not copied to output — already in SimHub's directory).

### Property System

SimHub exposes a flat property namespace. Plugins register properties via `AttachDelegate`:

```csharp
// Registering a property
this.AttachDelegate("RaceCorProDrive.Plugin.Commentary.Active", () => _commentaryActive);
this.AttachDelegate("RaceCorProDrive.Plugin.Fuel.LapsRemaining", () => _fuelLapsRemaining);
```

These properties are then accessible:
- In SimHub dashboards via `$prop('RaceCorProDrive.Plugin.Commentary.Active')`
- Over HTTP via SimHub's web server at `http://localhost:8889/`
- In the K10 overlay via the flat JSON API at `/racecor-io-pro-drive/`

### HTTP API

SimHub includes a built-in HTTP server (port 8889 by default). The K10 plugin serves all registered properties as a flat JSON object:

**Endpoint**: `GET http://localhost:8889/racecor-io-pro-drive/`

**Response**: Flat JSON with 100+ properties:
```json
{
  "DataCorePlugin.GameRunning": true,
  "DataCorePlugin.GameData.Rpms": 7250,
  "DataCorePlugin.GameData.Gear": "4",
  "DataCorePlugin.GameData.SpeedMph": 142.5,
  "DataCorePlugin.GameData.Throttle": 0.85,
  "DataCorePlugin.GameData.Brake": 0.0,
  "DataCorePlugin.GameData.Fuel": 23.4,
  "DataCorePlugin.Computed.Fuel_LitersPerLap": 2.1,
  "RaceCorProDrive.Plugin.Commentary.Active": true,
  "RaceCorProDrive.Plugin.Commentary.TopicId": "heavy_braking",
  "RaceCorProDrive.Plugin.Commentary.Text": "...",
  "RaceCorProDrive.Plugin.Leaderboard": "[{...}]",
  "RaceCorProDrive.Plugin.DS.GForce": "{\"lateral\":0.8,\"longitudinal\":-0.3}",
  ...
}
```

### Dashboard Templates

SimHub dashboards use `.djson` files with a proprietary template format. The K10 plugin includes a dashboard template that renders the same `dashboard.html` used by the Electron overlay, using SimHub's `$prop()` API instead of HTTP polling.

Dashboard files location: `DashTemplates/k10 motorsports/`

### Build & Deploy Cycle

```
dotnet build → DLL → SimHub dir (auto-copy via post-build target)
             → datasets → SimHub\dataset\ (CopyDataset target)
             → dashboards → SimHub\DashTemplates\ (CopyDashboard target)
Restart SimHub to load updated plugin
```

### Testing Without SimHub

The test project targets .NET 6.0 (not 4.8) and uses standalone reimplementations in `TestHelpers/` that mirror the plugin's logic without SimHub DLL dependencies. This enables:
- CI on Linux (no SimHub available)
- Fast test execution (~2s for all 147 tests)
- Cross-platform development

**Critical**: When plugin engine code changes, the corresponding TestHelper must be manually updated to match.

## SimHub Property Naming Conventions

| Prefix | Source |
|--------|--------|
| `DataCorePlugin.GameData.*` | Raw telemetry from the game |
| `DataCorePlugin.Computed.*` | SimHub's computed values (fuel per lap, etc.) |
| `DataCorePlugin.GameRunning` | Whether a supported game is active |
| `IRacingExtraProperties.*` | iRacing Extra Properties plugin (third-party, required for iR/SR) |
| `RaceCorProDrive.Plugin.*` | K10 plugin custom properties |
| `RaceCorProDrive.Plugin.DS.*` | K10 datastream structs (JSON-encoded) |
| `RaceCorProDrive.Plugin.Demo.*` | Demo mode properties (fake data for testing) |

## Rules

1. **.NET Framework 4.8 only** — The plugin must target net48. Don't use C# features unavailable in .NET Framework 4.8 (no `Span<T>`, limited `async` patterns, etc.).
2. **No NuGet packages** — All dependencies come from SimHub. Don't add NuGet references.
3. **Property names are API contracts** — Renaming a `RaceCorProDrive.Plugin.*` property breaks the overlay. Coordinate with `racecor-overlay/`.
4. **SimHub refs are local** — The `.csproj` references SimHub DLLs from `SIMHUB_PATH` environment variable or a default path. These aren't in the repo.
5. **WPF for settings UI** — The settings panel is WPF XAML, not WinForms or HTML.
6. **JSON via Newtonsoft** — Use SimHub's bundled `Newtonsoft.Json`, not `System.Text.Json`.
7. **Post-build targets** — Don't remove `CopyDataset` or `CopyDashboard` from the `.csproj`. They're how datasets and dashboards get deployed.
8. **iRating/SR require extra plugin** — The iRacing Extra Properties plugin by RomainRob is required for iRating and Safety Rating display. This is a third-party dependency.
