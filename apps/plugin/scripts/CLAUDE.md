# apps/plugin/scripts

## In use

| Script | Purpose |
|--------|---------|
| `windows/install.bat` | Stops SimHub, builds the plugin (`-c Release`, or the configuration given), removes the old `RaceCorProDrive`/`RaceCor.Core` files, copies the plugin, `RacingDesk.Core.dll`, the third-party DLLs SimHub does not ship and `racingdesk-data` into SimHub, and starts SimHub again only if it was running. **Ask the driver before running it**: it replaces the installed plugin (root CLAUDE.md). |

## Dead (kept until the driver says to remove them)

Each points at something this tree no longer has; none is run by anything.

| Script | What it needed |
|--------|----------------|
| `windows/build-installer.bat` | An Inno Setup installer (`installer/k10-motorsports.iss`): there is no installer (root, Ground rules) |
| `stamp-version.sh` | The same installer and a release's version numbers: there is no release |
| `windows/export.bat` | Copying the built DLL back from SimHub into the repo, from when the build wrote into SimHub; it builds into `simhub-plugin/build/` now and the DLL is not committed |
| `mac/RacingDesk.command`, `mac/install.command`, `mac/launch.sh` | A `racing-desk-overlay/` folder beside them, and a Mac: the overlay is `apps/overlay` and the rig is Windows |
| `parse-shtl.js` | Turning SimHub's `.shtl` maps into CSVs for a server's upload route; the host reads `.shtl` files itself (`CrowdMaps.cs`, root CLAUDE.md, Track maps) |
