# racing-desk-plugin — the SimHub plugin's sources, datasets and tests

`simhub-plugin/` holds the SimHub plugin project, the commentary datasets, and the test project for every .NET project
in the repo. What the plugin is, how it is built and installed, and what is retired: [`../CLAUDE.md`](../CLAUDE.md). The
`:8889` contract and the rules behind it: the root [`CLAUDE.md`](../../../CLAUDE.md).

## Key files

| What | Path |
|------|------|
| Plugin entry (SimHub's `IPlugin`, actions, events, settings) | `simhub-plugin/plugin/RacingDesk.Plugin/Plugin.cs` |
| SimHub's game data as Core's `ITelemetrySource` | `simhub-plugin/plugin/RacingDesk.Plugin/SimHubTelemetrySource.cs` |
| Settings panel (WPF, in SimHub's plugin tab) | `simhub-plugin/plugin/RacingDesk.Plugin/Control.xaml` |
| Project (`net48`, references `RacingDesk.Core`, stages into `simhub-plugin/build/`) | `simhub-plugin/plugin/RacingDesk.Plugin/RacingDesk.Plugin.csproj` |
| The engine, capture, runtime, Moza, strategist, commentary engine | `apps/core/RacingDesk.Core/` (`Engine/`, `Capture/`, `Runtime/`, `Models/`, …) |
| Commentary datasets (topics, fragments, sentiments, cars, tracks, sources) | `simhub-plugin/racingdesk-data/` |
| Tests (NUnit, `net8.0-windows`; Core, Data, Host and the plugin's logic) | `simhub-plugin/tests/RacingDesk.Tests/` |
| SimHub's DLLs to compile against | `simhub-plugin/lib/simhub-refs/` |

## Tests

```bash
npm run test:dotnet                                  # from the root: dotnet test racing-desk.sln
dotnet test apps/plugin/racing-desk-plugin/simhub-plugin/tests/RacingDesk.Tests/RacingDesk.Tests.csproj --filter "FullyQualifiedName~TyreWear"
python apps/plugin/racing-desk-plugin/simhub-plugin/tests/validate_datasets.py
```

The test project references `RacingDesk.Core`, `RacingDesk.Data` and `RacingDesk.Host` and runs the shipped code; it
needs no SimHub (`SimHubOpponentTests` reads SimHub's installed assembly where there is one). `TestHelpers/` still holds
copies of a few older engines (the trigger evaluator, the fragment assembler, the colour resolver, the coaches): a test of
one of those runs the copy, so a change to the engine is a change to its copy too, and tyre wear's cases run against the
shipped evaluator instead (root CLAUDE.md, Tyre wear). Some tests read his real `.ibt` files where the rig has them
(`LocalDataTests`, `HostContractTests`) and are skipped where it has none.

## Datasets

`simhub-plugin/racingdesk-data/` is copied into SimHub by `install.bat` and into the app's host by `npm run build`; the
repo is their source. `commentary_topics.json` (triggers: conditions, severity, cooldowns), `commentary_fragments.json`
(openers, bodies, closers per topic), `sentiments.json` (colours, which must not collide with a flag's hue),
`channel_notes.json`, and the commentary's car and track facts. A new topic: add it to the topics, give it fragments
(≥6 openers, ≥8 bodies, ≥5 closers), a sentiment if it needs one, run `validate_datasets.py` and
`DatasetValidationTests`. `simhub-plugin/tools/generate_fragments.py` drafts fragments with Claude (`ANTHROPIC_API_KEY`),
for him to read before they go in. Text in them follows the root's Words, not capitals.

## The older documents here

`docs/` (`COMMENTARY_ENGINE.md`, `DATASETS.md`, `SIMHUB_PLUGIN.md`, `TESTING.md`, `DEVELOPMENT.md`, …) were written for
`prodrive-plugin`, when the engine lived in the plugin, the build wrote into SimHub and CI ran the tests. What they say of
the commentary engine and the datasets' shape is still the design; their paths, build steps, test counts and CI are not.
`simhub-plugin/tools/test_installer.py` tests an installer that is gone.
