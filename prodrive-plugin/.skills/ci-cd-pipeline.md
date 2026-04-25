# K10 Motorsports — CI/CD & Release Pipeline

## Release Flow (tag → installer)

The entire release is triggered by pushing a git tag like `v0.2.0`. The pipeline
lives in `.github/workflows/release.yml` and runs four sequential jobs:

```
push tag v*
  └─ stamp-version (ubuntu)
       └─ build-overlay-win (windows)
            └─ build-installer (windows)
                 └─ release (ubuntu)
```

## Version Stamping — CRITICAL

**Versions are NEVER updated manually.** The `stamp-version` job is the single
source of truth. It:

1. Checks out `main`
2. Extracts the version from the git tag (e.g. `v0.2.0` → `0.2.0`)
3. Stamps three files using `sed`:
   - `racecor-overlay/package.json` → `"version": "0.2.0"`
   - `installer/k10-motorsports.iss` → `#define MyAppVersion "0.2.0"`
   - `racecor-plugin/simhub-plugin/.../Properties/AssemblyInfo.cs` → `AssemblyVersion("0.2.0.0")`
4. Commits and pushes back to `main` with `[skip ci]`

All downstream build jobs `needs: [stamp-version]` and check out `main`,
so they always build with the correct version already in place.

**Do NOT:**
- Create manual version-stamping scripts
- Add runtime version detection hacks (git describe, etc.)
- Hardcode versions anywhere — they flow from the tag
- Update version files by hand outside of CI

**If the user asks about version issues:**
1. Check what the latest git tag is (`git describe --tags --abbrev=0`)
2. Check if the three version files match that tag
3. If they don't, the fix is to push a new tag or re-run the CI pipeline
4. The local dev display reads from `package.json`, which CI keeps in sync

## Build Artifacts

| Job | Produces | Artifact Name |
|-----|----------|---------------|
| build-overlay-win | Electron app (x64) | `overlay-win-unpacked` |
| build-overlay-win | Electron app (arm64) | `overlay-win-arm64-unpacked` |
| build-installer | Inno Setup .exe | `installer` |

## Plugin Build

The C# plugin builds with `dotnet build` targeting .NET Framework 4.8.
SimHub SDK DLLs are committed in `racecor-plugin/simhub-plugin/lib/simhub-refs/` so the plugin compiles
on CI without a SimHub installation. The output DLL lands at
`racecor-plugin/RaceCorProDrive.dll`.

## Installer

Inno Setup (`installer/k10-motorsports.iss`) bundles:
- The Electron overlay (x64 + arm64)
- The SimHub plugin DLL
- Any supporting files

Compiled via `ISCC.exe` on the Windows runner.

## GitHub Release

The final `release` job uses `softprops/action-gh-release@v2` to create a
GitHub release with auto-generated release notes and the installer .exe attached.

## When Modifying the Pipeline

- Test changes on a branch by pushing a tag like `v0.0.0-test.1`
- The `stamp-version` job commits to `main` — be aware of branch protection rules
- `GITHUB_TOKEN` is used for both checkout and release creation
- `[skip ci]` in the version bump commit prevents infinite loops
