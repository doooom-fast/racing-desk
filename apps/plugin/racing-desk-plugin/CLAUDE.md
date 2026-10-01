# RacingDesk Plugin — SimHub

The SimHub plugin (`simhub-plugin/`) — C# .NET Framework 4.8. Ingests telemetry from iRacing (and other sims), runs commentary triggers and strategy analysis, and serves results over HTTP on port 8889.

> The Homebridge plugin that used to live alongside this directory has moved to its own repo: [`k10-motorsports/prodrive-homebridge`](https://github.com/DOOOOM/prodrive-homebridge) (instructions: [`prodrive-homebridge`](https://github.com/DOOOOM/prodrive-homebridge)). It remains a consumer of the same HTTP API described below.

## Integration Contract (Plugin ↔ Overlay)

This plugin is the **producer** side of the telemetry pipeline. The overlay (`racing-desk-overlay/`) is the **consumer**. See also: [root CLAUDE.md](../CLAUDE.md) for the full end-to-end data flow.

- **HTTP API**: Port 8889, `GET http://localhost:8889/racing-desk/`
- **Response**: Flat JSON object with 100+ properties (telemetry values, commentary state, strategy recommendations)
- **Polling**: The overlay polls this endpoint at ~30fps (every 33ms)
- **Contract rule**: Any change to JSON property names, types, or removal of properties is a breaking change that requires a coordinated update in `racing-desk-overlay/`

## SimHub Plugin (C#)

### Tech Stack

- .NET Framework 4.8 (SimHub's runtime)
- WPF for settings panel (`Control.xaml`, renders inside SimHub's plugin settings tab)
- Newtonsoft.Json for dataset deserialization
- No NuGet packages — all dependencies are SimHub-provided DLLs

### Key Files

| What | Path |
|------|------|
| Plugin entry | `simhub-plugin/plugin/RacingDesk.Plugin/Plugin.cs` |
| Project file | `simhub-plugin/plugin/RacingDesk.Plugin/RacingDesk.Plugin.csproj` |
| Engine logic | `simhub-plugin/plugin/RacingDesk.Plugin/Engine/` |
| Data models | `simhub-plugin/plugin/RacingDesk.Plugin/Models/` |
| Settings panel | `simhub-plugin/plugin/RacingDesk.Plugin/Control.xaml` |
| Shared datasets | `simhub-plugin/racingdesk-data/` (JSON: topics, fragments, sentiments, channel notes) |
| Unit tests | `simhub-plugin/tests/RacingDesk.Tests/` |
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
dotnet build simhub-plugin/plugin/RacingDesk.Plugin/RacingDesk.Plugin.sln
```

### Testing

Tests run **without SimHub installed** — the test project targets .NET 6.0 (cross-platform) and uses standalone reimplementations of the plugin logic in `TestHelpers/`. When plugin engine code changes, the corresponding TestHelper must be updated to match.

```bash
cd simhub-plugin/tests/RacingDesk.Tests && dotnet test
```

~147 NUnit tests (including parameterized `[TestCase]` expansions) covering:
- **TriggerEvaluatorTests** (~47) — all 18 trigger conditions with regression tests for corrected thresholds (tyre wear as tread remaining in percent, worn is low; Fahrenheit temps ≥200, kerb delta ≥10, heavy braking ≤-38, spin yaw ≥3.0, proximity ≤0.008)
- **TyreWearTests** (`IRacing/`) — tyre wear's one meaning end to end: raw SDK bands through the host to the HTTP and WebSocket wire, the plugin's bands-before-SimHub reading, `TyreSetMask` (a stop with new tyres through a runtime to the wire, the topic and the strategist), the real topic, the strategist's wear calls, the demo (root CLAUDE.md, Tyre wear)
- **ColorResolverTests** (~42) — category-to-hue mapping, severity-to-alpha, `#AARRGGBB` format, flag collision detection (15° tolerance)
- **NormalizeColorTests** (~26) — hex format conversion edge cases
- **FragmentAssemblerTests** (~18) — sentence composition, placeholder substitution (`{ahead}`, `{behind}`, `{value}`), repetition avoidance (ring buffer)
- **DatasetValidationTests** (~14) — live validation of actual JSON dataset files

### Dataset Development

Datasets live in `simhub-plugin/racingdesk-data/`:
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

## CI

The `simhub-ci.yml` workflow runs on every push/PR with 3 parallel jobs:

| Job | Runner | Tests |
|-----|--------|-------|
| Python Tests | ubuntu-latest | Dataset validation (28) + installer tests (34) |
| C# Tests | ubuntu-latest | NUnit (.NET 6.0, 200+) |
| Windows Installer | windows-latest | Live `.bat` execution (3) |

## Code Style

- C# follows standard .NET conventions, no special formatting rules
- Dataset JSON files must pass all 28 validation tests before committing
- When adding a new commentary topic: add to `commentary_topics.json`, add matching fragments (≥6 openers / ≥8 bodies / ≥5 closers), add sentiment if new, validate, rebuild

## Documentation

Detailed docs in `docs/`:
- `COMMENTARY_ENGINE.md` — trigger system and fragment assembly
- `DATASETS.md` — JSON dataset schema and validation rules
- `DEVELOPMENT.md` — full build/test/export workflow
- `TESTING.md` — comprehensive test suite documentation
- `SIMHUB_PLUGIN.md` — SimHub plugin architecture
