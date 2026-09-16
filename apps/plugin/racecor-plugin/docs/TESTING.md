# Testing

The test suite covers five layers: C# unit tests for the SimHub plugin logic, Python dataset validation, Python telemetry replay with synthetic scenarios, TypeScript Jest tests for the Homebridge plugin, and Python installer/export validation. No layer requires a running SimHub instance or live sim session.

## Test Suites at a Glance

| Suite | Language | Framework | Tests | What It Covers |
|-------|----------|-----------|-------|----------------|
| RaceCorProDrive.Tests | C# | NUnit (.NET 6.0) | 200+ | Trigger evaluation, fragment assembly, color resolution, dataset validation |
| validate_datasets.py | Python | unittest | 28 | JSON structure, cross-references, threshold regressions |
| Homebridge tests | TypeScript | Jest | 133 | Color mapping, SimHub client, per-light mode overrides |
| test_installer.py | Python | unittest | 34 | Installer structure, simulated install/export, file manifests |

## C# Unit Tests

```
tests/RaceCorProDrive.Tests/
├── TriggerEvaluatorTests.cs        84 tests — all 18 trigger conditions
├── FragmentAssemblerTests.cs       35 tests — assembly, repetition, placeholders
├── ColorResolverTests.cs           50+ tests — category/severity colors, flag collisions
├── NormalizeColorTests.cs          25+ tests — hex format conversion
├── DatasetValidationTests.cs       20+ tests — live validation of JSON files
└── TestHelpers/
    ├── TriggerEvaluator.cs         Standalone reimplementation (no SimHub refs)
    ├── FragmentAssembler.cs         Standalone reimplementation
    ├── CommentaryColorResolver.cs   Standalone reimplementation
    ├── TelemetrySnapshot.cs         Pure data model
    └── Models.cs                    Topic/trigger/fragment models
```

### Why TestHelpers Exist

The SimHub plugin references `SimHub.Plugins.dll`, `GameReaderCommon.dll`, and `SimHub.Logging.dll` — assemblies that only exist inside a SimHub installation on Windows. The test project targets .NET 6.0 (cross-platform) and reimplements the pure logic from the plugin's engine classes in `TestHelpers/`. This means the tests run anywhere with the .NET SDK installed, including CI environments, without needing SimHub.

The TestHelpers mirror the plugin's logic exactly. They're kept in sync manually — when the plugin code changes, the corresponding TestHelper should be updated to match. The `DatasetValidationTests` class reads the actual JSON files from the repo, so those tests catch real dataset issues regardless of code drift.

### Running

```bash
cd tests/RaceCorProDrive.Tests
dotnet test --verbosity normal
```

All 200+ tests complete in under 2 seconds.

### Key Test Categories

**TriggerEvaluatorTests** exercises every condition type with known inputs and verifies the expected boolean result. Includes regression tests for every threshold that was corrected during development:
- Tyre wear inversion (must use `<`, not `>`)
- Fahrenheit temperature thresholds (must be >= 200)
- Kerb hit sensitivity (thresholdDelta >= 10)
- Heavy braking threshold (value <= -38)
- Spin catch yaw rate (absValue >= 3.0)
- Proximity threshold (must be <= 0.008)

**FragmentAssemblerTests** verifies sentence composition, placeholder substitution (`{ahead}`, `{behind}`, `{value}`), repetition avoidance (ring buffer behavior), and graceful handling of missing fragment data.

**ColorResolverTests** validates the category-to-hue mapping, severity-to-alpha mapping, output format (`#AARRGGBB`), and flag collision detection. Ensures no category hue falls within 15 degrees of any flag hue.

**NormalizeColorTests** covers all input format conversions: `#RGB` → `#FFRRGGBB`, `#RRGGBB` → `#FFRRGGBB`, `#AARRGGBB` passthrough, edge cases (empty string, null, malformed).

## Python Dataset Validation

```bash
python3 tests/validate_datasets.py
```

28 tests across 4 test classes:

**TestTopicsDataset** — Structural validation of `commentary_topics.json`: required fields present, categories are valid enum values, trigger conditions are in the known set, severities are 1-5, cooldowns are positive. Includes all threshold regression tests (tyre wear direction, temperature units, delta thresholds).

**TestFragmentsDataset** — Every topic has matching fragments. Minimum combination count (100+ per topic). No empty openers or bodies. At most one empty closer per topic. No orphan fragments (fragments for topics that don't exist).

**TestSentimentsDataset** — All sentiments have `id` and `color`. Colors are valid hex. No sentiment color collides with flag hues (red H0, yellow H60, blue H240, orange H30) within a 15-degree tolerance.

**TestCrossReferences** — Every sentiment referenced by a topic exists in `sentiments.json`. No duplicate IDs across topics or fragments.

## Homebridge Jest Tests

The Homebridge plugin has its own repo and CI: **[k10-motorsports/prodrive-homebridge](https://github.com/k10-motorsports/prodrive-homebridge)**.

## Installer and Export Tests

```bash
python3 tools/test_installer.py
```

34 tests across 5 test classes:

**TestInstallerStructure (11 tests)** — Validates `install.bat` exists and contains the expected references: DLL name, dataset folder, DashTemplates folder, SimHubWPF.exe detection, SIMHUB_PATH environment variable, default install locations, process check via `tasklist`, error handling with exit codes.

**TestExportStructure (6 tests)** — Validates `export.bat` references DLL, PDB, DashTemplates, explicitly excludes `_Backups`, checks for SimHub detection, and has error handling.

**TestRepoSourceFiles (4 tests)** — Verifies every file in the install manifest actually exists in the repo: DLL, all 5 dataset JSON files (and that they parse as valid JSON), and all 7 dashboard template files.

**TestSimulatedInstall (7 tests)** — Creates a fake SimHub directory in a temp folder, runs the installer's file operations in Python, and verifies: DLL content matches, PDB is present, all dataset files land correctly, installed JSON files are still valid, all dashboard files are present, SimHub's own DLLs are not overwritten, and running the install twice is idempotent.

**TestSimulatedExport (6 tests)** — Creates a fake SimHub directory with modified built files, runs the export logic, and verifies: DLL and PDB content matches the built versions, dashboard `.djson` and all assets are exported, `_Backups` directory is excluded, and dataset files are not copied from SimHub back to the repo.

On Windows, an additional **TestLiveInstall** class (3 tests) can be enabled with `--live` to actually execute the `.bat` files against a fake SimHub directory via `subprocess`.

## CI Integration

A GitHub Actions workflow (`.github/workflows/ci.yml`) runs all test suites on every push and pull request. None of the suites require SimHub, iRacing, or any external service.

The workflow runs three parallel jobs:

| Job | Runner | What It Runs |
|-----|--------|--------------|
| Python Tests | `ubuntu-latest` | Dataset validation (28), telemetry replay (4 scenarios), installer tests (34) |
| C# Tests | `ubuntu-latest` | NUnit test project (200+), .NET 6.0 SDK |
| Windows Installer | `windows-latest` | Live `.bat` execution against fake SimHub directory (3) |

The first two jobs share `ubuntu-latest` and run in parallel. The Windows job runs separately on `windows-latest` to test the actual batch file execution.

To run locally without CI:

```bash
# Python (no dependencies beyond stdlib)
python3 tests/validate_datasets.py
python3 tools/test_installer.py

# C# (.NET 6.0 SDK)
cd tests/RaceCorProDrive.Tests && dotnet test
```
