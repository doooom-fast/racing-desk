# SimHub Plugin Architecture

The RaceCorProDrive plugin is a .NET Framework 4.8 WPF plugin for [SimHub](https://www.simhubdash.com/). It reads telemetry from any supported sim (with full feature support for iRacing), evaluates trigger conditions against live data, and surfaces commentary prompts through SimHub's property system for display on dashboards and consumption by companion tools.

## Project Structure

```
plugin/RaceCorProDrive.Plugin/
├── Plugin.cs                           Entry point, lifecycle, dashboard properties
├── Settings.cs                         User-configurable settings (serialized by SimHub)
├── Control.xaml / Control.xaml.cs       WPF settings panel
├── RaceCorProDrive.Plugin.csproj         Build config (targets SimHub install directory)
├── RaceCorProDrive.Plugin.sln            Solution file
├── Properties/AssemblyInfo.cs          Assembly metadata
└── Engine/
    ├── CommentaryEngine.cs             Core logic: trigger eval, prompt selection, color
    ├── TriggerEvaluator.cs             Pure logic: 18 trigger condition types
    ├── FragmentAssembler.cs            Composable sentence assembly with repetition avoidance
    ├── TelemetrySnapshot.cs            Data model (cross-game normalized)
    ├── TelemetrySnapshot.Capture.cs    SimHub-specific telemetry capture (reflection)
    ├── DemoSequence.cs                 Curated demo events for testing without a live session
    ├── FeedbackEngine.cs               User feedback tracking (adjusts cooldown multipliers)
    └── ScreenColorSampler.cs           GDI+ ambient light screen capture
```

## How It Runs

SimHub calls into the plugin at three points:

**`Init()`** loads settings, instantiates the engine, and registers 12 dashboard properties via `AttachDelegate`. These properties are the plugin's only output — everything else reads them.

**`DataUpdate()`** fires every frame (~16ms at 60fps). The plugin captures a `TelemetrySnapshot` from the current game data, then every 6th frame (~100ms) runs the full trigger evaluation pipeline. This throttle exists because trigger evaluation is expensive relative to a single frame budget, and 100ms resolution is more than fast enough for commentary timing.

**`End()`** saves settings and stops any active telemetry recording.

## Dashboard Properties

These are the properties the plugin exposes. Any SimHub dashboard or external tool (including the Homebridge plugin) can read them.

| Property | Type | Description |
|----------|------|-------------|
| `CommentaryText` | string | Current prompt text (full sentence or event exposition) |
| `CommentaryVisible` | int | 1 when a prompt is active, 0 when idle |
| `CommentaryCategory` | string | Category label with sentiment (e.g., "Car Response — Technical") |
| `CommentaryTitle` | string | Topic title (e.g., "Big Save", "Position Lost") |
| `CommentarySeverity` | int | 0-5 severity of the current event |
| `CommentarySentimentColor` | string | #AARRGGBB color string for dashboard styling |
| `CommentaryTextColor` | string | #AARRGGBB bright text color (WCAG AA contrast) |
| `CurrentEventExposition` | string | Short event description for event-only mode |
| `IsInPitLane` | int | 1 if the player is in pit lane |
| `CurrentFlagState` | string | Human-readable flag: "green", "yellow", "black", etc. |
| `NearestCarDistance` | double | Closest opponent track distance fraction (0.0-1.0) |

## Settings

All settings are serialized through SimHub's built-in settings system (`ReadCommonSettings` / `SaveCommonSettings`). The settings panel is a WPF control (`Control.xaml`) rendered inside SimHub's plugin settings tab.

| Setting | Default | Range | Purpose |
|---------|---------|-------|---------|
| PromptDisplaySeconds | 15 | 5-120 (5s steps) | How long a prompt stays visible |
| EnabledCategories | all | hardware, game_feel, car_response, racing_experience | Which topic categories are active |
| EventOnlyMode | false | — | Show short exposition text instead of full prompts |
| DemoMode | false | — | Run the curated demo sequence (no live session needed) |
| ShowTopicTitle | true | — | Prepend the topic title to prompt text |
| TopicsFilePath | (auto) | — | Override path to commentary_topics.json |

## Build

The `.csproj` targets .NET Framework 4.8 and builds directly into the SimHub installation folder. Set the `SIMHUB_PATH` environment variable or edit the default path in the project file.

```bash
# Build
dotnet build plugin/RaceCorProDrive.Plugin/RaceCorProDrive.Plugin.sln

# The DLL and dataset folder are copied to SimHub automatically via post-build targets
```

The post-build step also copies the `racecorprodrive-data/` folder and `DashTemplates/` to the SimHub directory so the plugin can find its data files at runtime.

Dependencies are all SimHub-provided DLLs (GameReaderCommon, SimHub.Plugins, SimHub.Logging, Newtonsoft.Json, log4net) referenced with `Private=False` so they aren't copied to output.

## Cross-Game Support

The `TelemetrySnapshot` is split into two files to keep the data model testable without SimHub dependencies:

`TelemetrySnapshot.cs` defines normalized fields that work across any sim: speed, throttle, brake, fuel, position, lateral/longitudinal/vertical acceleration, yaw rate, tyre wear and temps, driver aids status.

`TelemetrySnapshot.Capture.cs` contains the SimHub-specific capture logic. It tries iRacing's raw telemetry properties first (via reflection on `GameRawData`), then falls back to SimHub's normalized cross-game fields. This means iRacing gets full feature support (steering torque, session flags, DRS, incident count, opponent positions) while other sims get basic trigger functionality through normalized data.

The reflection-based capture uses a `Coalesce<T>()` helper that handles NaN values, null references, and type conversion failures gracefully — the plugin never crashes on missing data, it just gets default values and the affected triggers don't fire.

## HTTP API (Port 8889)

The plugin runs its own lightweight HTTP server using `System.Net.HttpListener`, independent of SimHub's built-in web server. This serves the RaceCorProDrive dashboard overlay and can be consumed by any HTTP client.

**Endpoint:** `GET http://localhost:8889/racecor-io-pro-drive/`

**Response:** A flat JSON object containing 77+ key-value pairs covering all game telemetry, commentary state, demo mode data, and track map information. Property keys match SimHub's naming convention (e.g., `DataCorePlugin.GameData.Rpms`, `RaceCorProDrive.Plugin.CommentaryText`).

The server includes CORS headers (`Access-Control-Allow-Origin: *`) so the dashboard can be loaded from `file://` URLs or different origins. OPTIONS preflight requests are handled automatically.

### Why a Separate Server

SimHub's built-in web server (port 8888) does not expose plugin properties via REST in version 9.x. The undocumented `GET /api/GetGamedata` endpoint exists but returns only core game data, not plugin-specific properties. By running a dedicated listener on port 8889, the plugin has full control over what data is served and can include commentary state, demo telemetry, and track map SVG paths that SimHub wouldn't expose.

### Demo Mode Properties

When demo mode is active (`RaceCorProDrive.Plugin.DemoMode = 1`), the server serves simulated telemetry under the `RaceCorProDrive.Plugin.Demo.*` namespace. The dashboard automatically switches data sources — reading from `Demo.Gear` instead of `DataCorePlugin.GameData.Gear`, for example. This allows the full dashboard to run without a live sim session.

## Dashboard Integration

The plugin's telemetry is consumed by three dashboard implementations, all using the same `dashboard.html` source file:

**RaceCorProDrive (Electron overlay):** A standalone always-on-top transparent window that polls the HTTP API at ~30fps. Designed for stream overlays and broadcast production. See [racecor-overlay/README.md](../../racecor-overlay/README.md) for full documentation.

**SimHub Dashboard Template:** Installed to SimHub's `DashTemplates/` directory. When loaded inside SimHub's dashboard viewer, it uses SimHub's `$prop()` JavaScript API for data access instead of HTTP polling — lower latency since the data is already in-process.

**Browser Access:** Opening `dashboard.html` directly in a browser auto-detects that SimHub's `$prop()` function isn't available and falls back to HTTP polling mode. Useful for testing layout changes without launching the full Electron app.

## For More Detail

The commentary engine's trigger evaluation, prompt selection, severity-based interruption, and color system are documented in [COMMENTARY_ENGINE.md](COMMENTARY_ENGINE.md). The dataset format and how to extend it are documented in [DATASETS.md](DATASETS.md).
