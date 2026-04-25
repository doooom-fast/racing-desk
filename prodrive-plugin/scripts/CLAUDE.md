# Build & Utility Scripts

Cross-project scripts for building, installing, launching, and maintaining the platform.

## Scripts

| Script | Language | Purpose |
|--------|----------|---------|
| `parse-shtl.js` | Node.js | Parses SimHub template language (SHTL) files. |
| `stamp-version.sh` | Bash | Stamps version numbers across the monorepo (installer `.iss`, package.json files, etc.). |

> **Moved to closed repo:** `build-web-demo.mjs` and `generate-screenshots.py` served the web app and marketing site, which now live in [`alternatekev/racecor-prodrive-server`](https://github.com/alternatekev/racecor-prodrive-server).

## Platform Launchers (macOS)

| Script | Purpose |
|--------|---------|
| `mac/RaceCor.command` | Double-click launcher for the overlay |
| `mac/install.command` | Dependency installer |
| `mac/launch.sh` | Shell launch script |

## Windows Build Scripts

| Script | Purpose |
|--------|---------|
| `windows/build-installer.bat` | Builds the Inno Setup installer |
| `windows/export.bat` | Exports built files from SimHub back to repo |
| `windows/rebuild.bat` | Full rebuild of plugin + overlay |

## Relationship to Other Projects

- `stamp-version.sh` updates version strings in `installer/racecor-prodrive.iss` and other files
- macOS launchers start the `racecor-overlay/` Electron app
