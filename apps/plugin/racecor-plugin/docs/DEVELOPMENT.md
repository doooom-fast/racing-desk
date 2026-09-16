# Development

This document covers building from source, project setup, and contributor workflow for both plugins.

## SimHub Plugin (C#)

### Prerequisites

- Windows 10/11
- [SimHub](https://www.simhubdash.com/) installed
- Visual Studio 2019+ or the .NET Framework 4.8 SDK
- .NET 6.0 SDK (for running the test project)

### Project Setup

The `.csproj` references SimHub DLLs from the SimHub installation directory. Set the path via environment variable or edit the default in the project file:

```bash
# Environment variable (recommended)
set SIMHUB_PATH=C:\Program Files (x86)\SimHub\

# Or edit plugin/RaceCorProDrive.Plugin/RaceCorProDrive.Plugin.csproj directly:
# <SimHubPath>C:\Your\SimHub\Path\</SimHubPath>
```

### Building

```bash
dotnet build plugin/RaceCorProDrive.Plugin/RaceCorProDrive.Plugin.sln
```

The build automatically:
1. Compiles `RaceCorProDrive.dll` to the SimHub directory
2. Copies `racecorprodrive-data/` to `SimHub\dataset\` (post-build target `CopyDataset`)
3. Copies `DashTemplates/` to `SimHub\DashTemplates\` (post-build target `CopyDashboard`)

In Debug configuration, pressing F5 in Visual Studio launches SimHub directly for debugging.

### Dependencies

All dependencies are SimHub-provided DLLs referenced with `Private=False` (not copied to output):

| Assembly | Purpose |
|----------|---------|
| GameReaderCommon.dll | Telemetry data access |
| SimHub.Plugins.dll | Plugin base class, AttachDelegate, settings |
| SimHub.Logging.dll | Logging infrastructure |
| Newtonsoft.Json.dll | JSON deserialization for datasets |
| log4net.dll | Logging backend |

No NuGet packages are required. The plugin runs entirely on assemblies already present in the SimHub installation.

### Architecture Notes

The project targets .NET Framework 4.8 (SimHub's runtime). The WPF settings panel (`Control.xaml`) renders inside SimHub's plugin settings tab. The `UseWPF` flag is enabled in the project file.

Output goes directly to the SimHub folder with no target framework or runtime identifier subfolders (`AppendTargetFrameworkToOutputPath=false`). This means a build immediately updates the running plugin — restart SimHub to pick up changes.

## Homebridge Plugin (TypeScript)

The Homebridge plugin lives in its own repo: **[k10-motorsports/prodrive-homebridge](https://github.com/k10-motorsports/prodrive-homebridge)**. See that repo's README for build, watch, link, and test instructions.

## Dataset Development

### Editing Topics and Fragments

Edit the JSON files in `racecorprodrive-data/` directly. After changes:

```bash
# Validate structural integrity (28 tests)
python3 tests/validate_datasets.py

```

### Regenerating Fragments

The fragment generation script calls Claude Haiku to produce new sentence fragments:

```bash
python3 tools/generate_fragments.py
```

This reads `commentary_topics.json`, `sentiments.json`, and `channel_notes.json` as context and writes `commentary_fragments.json`. It requires an Anthropic API key in the `ANTHROPIC_API_KEY` environment variable.

### Adding a New Topic

1. Add the topic to `commentary_topics.json` (unique ID, valid category, triggers, severity 1-5, at least 4 commentary prompts, cooldown in minutes)
2. Add matching fragments to `commentary_fragments.json` (same topic ID, minimum 6 openers / 8 bodies / 5 closers)
3. If using a new sentiment, add it to `sentiments.json` with a color that doesn't collide with flag hues
4. Run `python3 tests/validate_datasets.py` — all 28 tests must pass
5. Rebuild the SimHub plugin to copy updated dataset files

## Running Tests

All test suites run without SimHub, iRacing, or any external service:

```bash
# C# unit tests (200+ tests, NUnit, .NET 6.0)
cd tests/RaceCorProDrive.Tests && dotnet test

# Python dataset validation (28 tests)
python3 tests/validate_datasets.py
```

The Homebridge plugin's Jest test suite lives in [k10-motorsports/prodrive-homebridge](https://github.com/k10-motorsports/prodrive-homebridge).

```bash
# Installer and export tool tests (34 tests)
python3 tools/test_installer.py

# Live .bat execution tests (Windows only)
python3 tools/test_installer.py --live
```

Full testing documentation: [TESTING.md](TESTING.md)

## Exporting Built Files Back to the Repo

After building in Visual Studio or via `dotnet build`, the compiled DLL lands in the SimHub directory. To copy it (and any dashboard changes made in SimHub's editor) back into the repo for commit:

**Double-click `export.bat`** in the repository root, or run it from a terminal.

The export tool copies:
- `RaceCorProDrive.dll` and `.pdb` from SimHub to the repo root
- The `DashTemplates/k10 motorsports/` folder from SimHub to the repo (excluding `_Backups/`)

It does **not** copy the `racecorprodrive-data/` folder back — the repo is the source of truth for dataset files. Changes to datasets should be made in the repo and pushed to SimHub via `install.bat` or a rebuild.

```bash
# After export, the typical commit flow is:
git add RaceCorProDrive.dll RaceCorProDrive.pdb DashTemplates/
git commit -m "Update built plugin and dashboard"
```

## Project Layout

```
├── plugin/RaceCorProDrive.Plugin/    SimHub plugin source (C#)
│   ├── Engine/                     Core logic (no manual edits to .csproj needed)
│   ├── Models/                     Data models
│   └── Properties/                 Assembly info
├── racecorprodrive-data/                        Shared data files (JSON)
├── tests/
│   ├── RaceCorProDrive.Tests/        C# unit tests (.NET 6.0, NUnit)
│   ├── validate_datasets.py        Python dataset validation
├── tools/
│   ├── generate_fragments.py       Fragment generation (Haiku)
│   └── test_installer.py           Installer and export tool tests (34 tests)
├── DashTemplates/                  SimHub dashboard templates
├── install.bat                     One-click Windows installer
├── export.bat                      Copy built files from SimHub back to repo
└── docs/                           Documentation
```
