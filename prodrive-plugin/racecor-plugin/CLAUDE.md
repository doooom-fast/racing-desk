# RaceCor Plugin — SimHub + Homebridge

This directory contains two related plugins that share a data directory and documentation:

1. **SimHub Plugin** (`simhub-plugin/`) — C# .NET Framework 4.8. Ingests telemetry from iRacing (and other sims), runs commentary triggers and strategy analysis, and serves results over HTTP.
2. **Homebridge Plugin** (`homebridge-plugin/`) — TypeScript. Subscribes to the SimHub plugin's HTTP API and maps telemetry states to HomeKit smart light colors/patterns.

## Integration Contract (Plugin ↔ Overlay)

This plugin is the **producer** side of the telemetry pipeline. The overlay (`racecor-overlay/`) is the **consumer**. See also: [root CLAUDE.md](../CLAUDE.md) for the full end-to-end data flow.

- **HTTP API**: Port 8889, `GET http://localhost:8889/racecor-io-pro-drive/`
- **Response**: Flat JSON object with 100+ properties (telemetry values, commentary state, strategy recommendations)
- **Polling**: The overlay polls this endpoint at ~30fps (every 33ms)
- **Contract rule**: Any change to JSON property names, types, or removal of properties is a breaking change that requires a coordinated update in `racecor-overlay/`

## SimHub Plugin (C#)

### Tech Stack

- .NET Framework 4.8 (SimHub's runtime)
- WPF for settings panel (`Control.xaml`, renders inside SimHub's plugin settings tab)
- Newtonsoft.Json for dataset deserialization
- No NuGet packages — all dependencies are SimHub-provided DLLs

### Key Files

| What | Path |
|------|------|
| Plugin entry | `simhub-plugin/plugin/RaceCorProDrive.Plugin/Plugin.cs` |
| Project file | `simhub-plugin/plugin/RaceCorProDrive.Plugin/RaceCorProDrive.Plugin.csproj` |
| Engine logic | `simhub-plugin/plugin/RaceCorProDrive.Plugin/Engine/` |
| Data models | `simhub-plugin/plugin/RaceCorProDrive.Plugin/Models/` |
| Settings panel | `simhub-plugin/plugin/RaceCorProDrive.Plugin/Control.xaml` |
| Shared datasets | `simhub-plugin/racecorprodrive-data/` (JSON: topics, fragments, sentiments, channel notes) |
| Unit tests | `simhub-plugin/tests/RaceCorProDrive.Tests/` |
| SimHub DLL refs | `simhub-plugin/lib/simhub-refs/` |

### Architecture

The plugin runs inside SimHub's .NET Framework 4.8 process. It:
1. Receives `TelemetrySnapshot` objects from SimHub's game reader
2. Normalizes telemetry across supported sims (iRacing, ACC, etc.)
3. Evaluates 33+ commentary trigger conditions (tire wear, fuel, proximity, flags, etc.)
4. Assembles commentary sentences from fragment datasets (opener + body + closer)
5. Runs strategy modules: tire degradation, fuel planning, pit window, opponent tracking, position analysis
6. Serves everything as a flat JSON blob on port 8889

Output goes directly to the SimHub folder (`AppendTargetFrameworkToOutputPath=false`). A build immediately updates the plugin — restart SimHub to pick up changes.

### Building

```bash
# Set SimHub path (or edit .csproj default)
set SIMHUB_PATH=C:\Program Files (x86)\SimHub\

# Build (copies DLL to SimHub dir, datasets to SimHub\dataset\, dashboards to SimHub\DashTemplates\)
dotnet build simhub-plugin/plugin/RaceCorProDrive.Plugin/RaceCorProDrive.Plugin.sln
```

### Testing

Tests run **without SimHub installed** — the test project targets .NET 6.0 (cross-platform) and uses standalone reimplementations of the plugin logic in `TestHelpers/`. When plugin engine code changes, the corresponding TestHelper must be updated to match.

```bash
cd simhub-plugin/tests/RaceCorProDrive.Tests && dotnet test
```

~147 NUnit tests (including parameterized `[TestCase]` expansions) covering:
- **TriggerEvaluatorTests** (~47) — all 18 trigger conditions with regression tests for corrected thresholds (tyre wear inversion, Fahrenheit temps ≥200, kerb delta ≥10, heavy braking ≤-38, spin yaw ≥3.0, proximity ≤0.008)
- **ColorResolverTests** (~42) — category-to-hue mapping, severity-to-alpha, `#AARRGGBB` format, flag collision detection (15° tolerance)
- **NormalizeColorTests** (~26) — hex format conversion edge cases
- **FragmentAssemblerTests** (~18) — sentence composition, placeholder substitution (`{ahead}`, `{behind}`, `{value}`), repetition avoidance (ring buffer)
- **DatasetValidationTests** (~14) — live validation of actual JSON dataset files

### Dataset Development

Datasets live in `simhub-plugin/racecorprodrive-data/`:
- `commentary_topics.json` — trigger definitions (conditions, severity, cooldowns)
- `commentary_fragments.json` — sentence fragments (openers, bodies, closers per topic)
- `sentiments.json` — sentiment colors (must not collide with flag hues)
- `channel_notes.json` — channel-specific commentary context

```bash
# Validate datasets (28 tests)
python3 simhub-plugin/tests/validate_datasets.py

# Generate new fragments via Claude Haiku (requires ANTHROPIC_API_KEY)
python3 simhub-plugin/tools/generate_fragments.py
```

### Export Workflow

After building in Visual Studio, export built files back to the repo:
```bash
# Double-click export.bat or run from terminal
# Copies: DLL + PDB from SimHub, DashTemplates (excluding _Backups/)
# Does NOT copy datasets — repo is source of truth for those
```

## Homebridge Plugin (TypeScript)

### Tech Stack

- TypeScript targeting Node.js 18+
- Zero runtime dependencies (uses Node built-in `http` module)
- Jest for testing
- Homebridge v1.6+ platform plugin

### Key Files

| What | Path |
|------|------|
| Source | `homebridge-plugin/src/` |
| Tests | `homebridge-plugin/src/__tests__/` |
| Package | `homebridge-plugin/package.json` |

### How It Works

Registered as `homebridge-racecor-lights` / `RaceCorProDriveLights` platform. Polls SimHub's HTTP API and maps telemetry state to HomeKit light attributes: flag colors (8 states), severity colors (6 levels), proximity-based colors, and blink patterns. Supports per-light mode overrides.

### Building & Testing

```bash
cd homebridge-plugin
npm install && npm run build    # TypeScript → dist/
npm test                         # 133 Jest tests
npm run test:coverage           # With coverage
npm run lint                    # ESLint
npm run watch                   # Dev mode
```

133 Jest tests covering: color mapping (84), SimHub HTTP client (24), per-light mode overrides (25).

## CI

The `simhub-ci.yml` workflow runs on every push/PR with 4 parallel jobs:

| Job | Runner | Tests |
|-----|--------|-------|
| Python Tests | ubuntu-latest | Dataset validation (28) + installer tests (34) |
| C# Tests | ubuntu-latest | NUnit (.NET 6.0, 200+) |
| Homebridge Tests | ubuntu-latest | Jest (133) |
| Windows Installer | windows-latest | Live `.bat` execution (3) |

The `homebridge-ci.yml` workflow also runs Homebridge tests independently.

## Code Style

- C# follows standard .NET conventions, no special formatting rules
- TypeScript uses the project ESLint config
- Dataset JSON files must pass all 28 validation tests before committing
- When adding a new commentary topic: add to `commentary_topics.json`, add matching fragments (≥6 openers / ≥8 bodies / ≥5 closers), add sentiment if new, validate, rebuild

## Documentation

Detailed docs in `docs/`:
- `COMMENTARY_ENGINE.md` — trigger system and fragment assembly
- `DATASETS.md` — JSON dataset schema and validation rules
- `DEVELOPMENT.md` — full build/test/export workflow
- `TESTING.md` — comprehensive test suite documentation
- `HOMEBRIDGE_PLUGIN.md` / `HOMEKIT.md` — Homebridge architecture
- `SIMHUB_PLUGIN.md` — SimHub plugin architecture
