<p align="center">
  <img src="src/images/logomark.png" alt="RaceCorProDrive" width="200">
</p>

# prodrive-plugin — RaceCor.io SimHub plugin

The **SimHub plugin** for RaceCor.io Pro Drive — written in C# (.NET Framework 4.8). Reads iRacing SDK telemetry, normalizes ~100 properties, runs them through commentary triggers and strategy modules, and exposes the result as a flat JSON API on **`http://localhost:8889/racecor-io-pro-drive/`**.

It also pushes session data to the Pro Drive cloud after each race (Bearer-authed `POST /api/iracing/import`) and fetches custom track / sector configuration from the cloud at track change.

![Dashboard](racecor-plugin/simhub-plugin/docs/dashboard-screenshot.png)

## Where this fits in the wider ecosystem

This repo is the **producer** of live telemetry. The consumers and adjacent surfaces live in their own repos:

| Repo | Role |
|------|------|
| **`prodrive-plugin`** (this repo) | SimHub plugin (telemetry producer) — opens `localhost:8889`, pushes sessions to cloud |
| [`prodrive-overlay`](https://github.com/k10-motorsports/prodrive-overlay) | Electron HUD that polls `localhost:8889` at ~30fps. Records `.rcpdv` race bundles. Race Coach (Claude) for live AI commentary. |
| [`prodrive-windows`](https://github.com/k10-motorsports/prodrive-windows) | Pro Drive Windows desktop app — Library, Editor, Hardware (Moza). Auto-launches the overlay when iRacing starts. |
| [`prodrive-server`](https://github.com/k10-motorsports/prodrive-server) | racecor.io marketing + Pro Drive members dashboard + Chrome extension + calc engines. The cloud target for plugin's session push. |
| [`prodrive-homebridge`](https://github.com/k10-motorsports/prodrive-homebridge) | HomeKit smart-light mapping (polls SimHub on port 8888 — not this plugin's port 8889) |
| [`prodrive-edit`](https://github.com/k10-motorsports/prodrive-edit) | AI-powered race editing pipeline — ingests `.mp4` + `.telemetry.jsonl` pairs |
| [`prodrive-macos`](https://github.com/k10-motorsports/prodrive-macos) / [`-ios`](https://github.com/k10-motorsports/prodrive-ios) / [`-tvos`](https://github.com/k10-motorsports/prodrive-tvos) | Native Apple clients — read-only viewers over the Pro Drive API |

This README covers only the plugin in this repo.

## What the plugin does

The plugin captures telemetry snapshots every ~100ms and runs them through a multi-stage processing pipeline: commentary evaluation, sector timing, strategy computation, state diffing. All processed data is served as 100+ JSON properties over an HTTP API on port 8889 (with a WebSocket variant for push consumption).

Key systems:

- **Commentary engine** — composable sentence fragments (opener + body + closer), severity-based interruption, cooldown management across 33 topics and 240+ prompt combinations. Fragments are pre-generated offline; **the live AI commentary lives in the overlay's `race-coach.js`**, not in this plugin.
- **Strategy engine** — real-time tire lifecycle tracking (grip degradation scoring, wear estimation, temp state), fuel computation (burn variance, pit window, fuel-saving detection), stint-aware evaluation with severity-graded coaching calls.
- **Sector tracker** — auto-detects native iRacing track boundaries, falls back to equidistant sectors. **Cloud-augmented**: at track change, the plugin GETs `https://prodrive.racecor.io/api/tracks?trackName=...` to load custom sector boundaries, cached in-memory until track changes.
- **iRating estimator** — pre-qualifying iRating display.
- **Direct iRacing API client** (`IRacingDataClient.cs`) — authenticates against `members-ng.iracing.com/auth` with stored local credentials to fetch the user's live iRating + Safety Rating for the overlay's display.
- **Country flag normalization** — iRacing's full country names → ISO 2-letter codes for the flag sprite system.
- **Moza serial control** (`MozaSerialManager.cs`) — direct serial control of Moza wheels for force-feedback events triggered by telemetry.
- **Plugin actions** — 10 configurable actions (prefixed `RaceCorProDrive.*`) for wheel button and Stream Deck mapping (dismiss prompts, cycle pitbox tabs, navigate pit strategy options, commentary feedback).

## Cloud surface

The plugin is a cloud client, not just a local server. After authenticating via PKCE through `/api/plugin-auth/{authorize, token}`, it stores a Bearer token in `%APPDATA%\RaceCor\plugin\auth.json` and uses it for:

- `GET https://prodrive.racecor.io/api/tracks?trackName=...` — track config fetch on track change
- `POST https://prodrive.racecor.io/api/iracing/import` — session telemetry push at session end

This is the only path that captures **per-frame telemetry traces** for the cloud (the Chrome extension scrape only sees what iRacing exposes on the website). Telemetry traces land in Vercel Blob; metadata in Postgres.

To pair: open the plugin's settings page in SimHub → "Connect to Pro Drive" → browser handoff → Discord OAuth → token comes back to the plugin.

## Install

### Windows Installer (Recommended)

The Pro Drive Windows desktop app's installer bundles the **overlay only** — not this plugin. To install the plugin:

1. Install [SimHub](https://www.simhubdash.com/) (free).
2. Download the latest plugin zip from this repo's [releases](https://github.com/k10-motorsports/prodrive-plugin/releases).
3. Extract into `%PROGRAMFILES%\SimHub\PluginsData\Common\RaceCor\`.
4. Restart SimHub. Accept the unsigned-plugin warning the first time.
5. Open SimHub → **Additional plugins** → enable **RaceCorProDrive**.
6. (Optional, for cloud sync) Open the plugin's settings panel → **Connect to Pro Drive** → sign in with Discord.

Verify the local server with:

```
http://localhost:8889/racecor-io-pro-drive/
```

You should see a JSON blob with 100+ properties.

**iRacing users:** Install the [iRacing Extra Properties](https://drive.google.com/drive/folders/1AiIWHviD4j-_D-zgRrjJU1AFhJ_xmass) plugin by RomainRob for iRating and Safety Rating display. Copy `RSC.iRacingExtraProperties.dll` into your SimHub folder while SimHub is closed.

The plugin exposes all data as SimHub properties (prefixed `RaceCorProDrive.Plugin.*`), so you can build your own dashboard layout or integrate the properties into an existing one.

Build from source: [racecor-plugin/simhub-plugin/docs/DEVELOPMENT.md](racecor-plugin/simhub-plugin/docs/DEVELOPMENT.md)

## Repository Structure

```
prodrive-plugin/
├── racecor-plugin/                       SimHub C# plugin
│   ├── simhub-plugin/                    SimHub plugin + data
│   │   ├── plugin/RaceCorProDrive.Plugin/ C# source (.NET Framework 4.8, WPF)
│   │   │   ├── Plugin.cs                 Entry point, HTTP server, action registration
│   │   │   └── Engine/                   Core systems
│   │   │       ├── CommentaryEngine.cs   Trigger evaluation + prompt assembly
│   │   │       ├── TelemetrySnapshot.cs  Cross-game telemetry normalization (cloud track fetch lives here)
│   │   │       ├── SectorTracker.cs      Native + fallback sector boundary detection
│   │   │       ├── IRacingSdkBridge.cs   Direct iRacing SDK integration
│   │   │       ├── IRacingDataClient.cs  Live iRating/SR fetch from members-ng.iracing.com
│   │   │       ├── IRatingEstimator.cs   Pre-qualifying iRating estimation
│   │   │       ├── TrackMapProvider.cs   SVG track map generation
│   │   │       ├── PluginUpdater.cs      GitHub Release auto-updater
│   │   │       ├── MozaSerialManager.cs  Direct Moza wheel control
│   │   │       └── Strategy/             Real-time race strategy engine
│   │   │           ├── StrategyCoordinator.cs  Stint lifecycle + call orchestration
│   │   │           ├── TireTracker.cs          Grip scoring, wear estimation, temp monitoring
│   │   │           ├── FuelComputer.cs         Burn stats, pit window, fuel saving detection
│   │   │           └── StintData.cs            Per-stint telemetry history
│   │   ├── racecorprodrive-data/         Commentary topics, fragments, sentiments (JSON)
│   │   ├── tests/                        C# unit tests + Python dataset validation
│   │   ├── tools/                        Telemetry replay, fragment generation
│   │   └── DashTemplates/                SimHub dashboard templates
├── src/agents/                           MCP servers (Model Context Protocol)
│   ├── simhub-telemetry/                 Live telemetry data reader
│   ├── k10-plugin/                       Plugin source + dataset inspector
│   └── k10-broadcaster/                  Dashboard component inspector
├── installer/                            (vestigial — combined Windows installer moved to prodrive-windows repo)
├── scripts/                              Platform launch scripts
│   ├── mac/                              macOS launch (overlay's mac launcher lives in prodrive-overlay)
│   └── windows/                          Windows install, start, export, build-installer
└── .github/workflows/                    CI pipelines + release workflow
```

## Documentation

| Document | Covers |
| --- | --- |
| [SIMHUB_PLUGIN.md](racecor-plugin/simhub-plugin/docs/SIMHUB_PLUGIN.md) | Plugin architecture, cross-game support, settings, dashboard properties |
| [COMMENTARY_ENGINE.md](racecor-plugin/simhub-plugin/docs/COMMENTARY_ENGINE.md) | Trigger evaluation pipeline, severity interruption, fragment assembly, cooldowns |
| [AI_STRATEGIST_DESIGN.md](AI_STRATEGIST_DESIGN.md) | Strategy engine design — tire lifecycle, fuel strategy, pit optimizer, opponent intelligence |
| [DATASETS.md](racecor-plugin/simhub-plugin/docs/DATASETS.md) | Topic schema, trigger conditions, fragment format, how to add new topics |
| [TESTING.md](racecor-plugin/simhub-plugin/docs/TESTING.md) | Test suites, CI integration |
| [DEVELOPMENT.md](racecor-plugin/simhub-plugin/docs/DEVELOPMENT.md) | Building from source, project setup, contributor workflow |

For overlay docs see [prodrive-overlay's README](https://github.com/k10-motorsports/prodrive-overlay). For the Pro Drive Windows app see [prodrive-windows](https://github.com/k10-motorsports/prodrive-windows).

## Testing

Three test suites run without SimHub, iRacing, or any external service:

```bash
# C# unit tests (200+ tests, NUnit)
cd racecor-plugin/simhub-plugin/tests/RaceCorProDrive.Tests && dotnet test

# Python dataset validation (28 tests)
python3 racecor-plugin/simhub-plugin/tests/validate_datasets.py
```

The Homebridge plugin's Jest test suite lives in [k10-motorsports/prodrive-homebridge](https://github.com/k10-motorsports/prodrive-homebridge).

The C# test project uses standalone reimplementations of the plugin's engine logic (no SimHub dependencies), so it runs on any platform with the .NET 6.0 SDK.

Full testing documentation: [racecor-plugin/simhub-plugin/docs/TESTING.md](racecor-plugin/simhub-plugin/docs/TESTING.md)

## AI use in this repo (and elsewhere)

**This plugin uses Claude offline only.** The 240+ commentary fragments in `racecor-plugin/simhub-plugin/racecorprodrive-data/commentary_fragments.json` were generated using [Claude](https://claude.ai) (Anthropic's `claude-haiku-4-5` model) with the commentary topics, sentiment vocabulary, and channel style profiles as input. The generation is a one-time offline process — **the plugin makes no Anthropic API calls at runtime**.

**Live AI commentary lives in the overlay**, not here. `prodrive-overlay/modules/js/race-coach.js` calls the Anthropic Messages API directly with rolling race context. It uses the user's own Anthropic API key. See the overlay README for details.

The codebase, test suites, dataset structures, and documentation in this repo were built with [Claude Code](https://claude.ai/claude-code) (Anthropic's `claude-opus-4-7`).

## Release

Wave 1 of the lockstep release (parallel with overlay), per the orchestrator at `agents/.claude/commands/release.md` in the [prodrive-agents](https://github.com/k10-motorsports/prodrive-agents) submodule.

## Data Sources and Attribution

The commentary voice, phrase patterns, and fragment vocabulary are informed by the following sources. All transcripts were obtained through publicly available YouTube auto-captions or published APIs.

### Sim Racing YouTube Creators

| Channel | Style | License |
| --- | --- | --- |
| [Jimmy Broadbent](https://www.youtube.com/@JimmyBroadbent) | High-energy, humorous race commentary | YouTube Standard License (auto-captions) |
| [Matt Malone / MG Charoudin](https://www.youtube.com/@MGCharoudin) | Nürburgring-focused, technical | YouTube Standard License |
| [Jaaames](https://www.youtube.com/@jaaames) | Competitive iRacing, analytical | YouTube Standard License |
| [Traxion.GG](https://www.youtube.com/@Traxion) | Sim racing news and reviews | YouTube Standard License |
| [JustHun Gaming](https://www.youtube.com/@JustHunGaming) | ACC competitive, setup-focused | YouTube Standard License |
| [Project Sim Racing](https://www.youtube.com/@ProjectSimRacing) | Community broadcasts | YouTube Standard License |
| [Just Sim Racing](https://www.youtube.com/@JustSimRacing) | Multi-sim, wheel-to-wheel focus | YouTube Standard License |
| [Redd500 Gaming](https://www.youtube.com/@Redd500) | iRacing oval/road, narrative style | YouTube Standard License |

### Professional Broadcast Commentary

| Source | Style | License |
| --- | --- | --- |
| [Global SimRacing Channel](https://www.youtube.com/@GlobalSimRacingChannel) | Professional sim racing broadcasts since 2013 | YouTube Standard License |
| [RaceSpot TV](https://www.youtube.com/@RaceSpotTV) | eNASCAR official broadcast partner | YouTube Standard License |
| [Apex Racing TV](https://www.youtube.com/@ApexRacingTV) | iRacing league broadcasts | YouTube Standard License |

### Coaching and Instructional

| Source | Style | License |
| --- | --- | --- |
| [Driver61](https://www.youtube.com/@Driver61) | Professional racing coach, technique breakdowns | YouTube Standard License |
| [Suellio Almeida / Virtual Racing School](https://www.youtube.com/@VirtualRacingSchool) | Data-driven coaching, telemetry analysis | YouTube Standard License |

### Structured Phrase Databases

| Source | Usage | License |
| --- | --- | --- |
| [Crew Chief V4](https://gitlab.com/mr_belern/CrewChiefV4) | Spotter phrase patterns and audio composition architecture | [GPL-3.0](https://gitlab.com/mr_belern/CrewChiefV4/-/blob/master/LICENSE) |

The composable fragment system (opener + body + closer) is directly inspired by Crew Chief V4's audio clip composition architecture.

## License

MIT

## Author

Kevin Conboy — [alternate.org](http://www.alternate.org)
