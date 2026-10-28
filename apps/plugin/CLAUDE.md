# apps/plugin — the SimHub plugin

The SimHub plugin, `RacingDesk.dll`: a thin adapter that runs inside SimHub (.NET Framework 4.8) and hands SimHub's
telemetry to `RacingDesk.Core` (`apps/core/RacingDesk.Core/`), which builds the same `:8889` contract the app's own host
builds. Everything about that contract, the runtime's routes, the car list, flags, tyre wear, names, maps and the rules
the code is held to is in the **root [`CLAUDE.md`](../../CLAUDE.md)**; this file is only what is particular to SimHub.

Until 2026-09-27 it was RaceCor Pro Drive (`RaceCorProDrive.dll`, `RaceCor.Core.dll`). Guidance from that time — a cloud
client, a release zip, an installer, CI — is retired: see "Retired" below. Imported into this monorepo on 2026-09-16
from `prodrive-plugin`.

## What it is

- **The plugin project** is three files of its own in `racing-desk-plugin/simhub-plugin/plugin/RacingDesk.Plugin/`:
  `Plugin.cs` (SimHub's entry point: data updates, actions, events, the settings it saves), `SimHubTelemetrySource.cs`
  (SimHub's game data as RacingDesk.Core's `ITelemetrySource`) and the settings panel (`Control.xaml`). The engine, the
  capture (`Capture/TelemetryCapture.cs`), the runtime and its servers, the Moza manager, the commentary and the
  strategist are all `RacingDesk.Core`, which the plugin carries.
- **It serves** `GET http://localhost:8889/racing-desk/` (the HUD, the iPad's proxy, OBS's pages) and the MessagePack
  WebSocket on `:8890`, both from `RacingDeskRuntime`. The app's own host serves the same contract on `:8889`, or on
  `:18889`/`:18890` beside SimHub (root CLAUDE.md, Desk).
- **It reads nothing of his files and no store.** The track map's outline comes from the app's host over loopback
  (`HostOutlineSource`, `http://127.0.0.1:18889`); with the app closed there is no map (root CLAUDE.md, Track maps).
- **Other sims** come through SimHub's own readers (Assetto Corsa and EVO: root CLAUDE.md, Assetto Corsa).
- **SimHub's opponents** are read by GameReaderCommon's own names: `IRacing_IRating`, `GaptoPlayer`, `IsCarInPit`,
  `IsCarInPitLane` (`SimHubOpponentTests` reads them from SimHub's installed assembly); the host's opponents keep
  `IRating`, `GapToPlayer`, `IsInPit`, read after them. The leaderboard's gap takes its size from the source and its sign
  from the order of the race (negative ahead of him, as `leaderboard.js` sorts), whatever sign the source uses; a gap that
  is null, 0 or not a finite number is not known, and while any other car's is not, every row carries 0 (the board in the
  order of the race, no gaps shown) — `RacingDeskRuntime.LeaderboardGaps`. A real name of another driver never leaves
  the source (root CLAUDE.md, Other drivers' names).
- **The Moza manager** (`MozaSerialManager`, in Core) looks for the ports never while MOZA Pit House runs (process
  `MOZA Pit House`; it holds the base's ports, on the rig all day, and is looked at once a minute while it does), and
  otherwise at the start, when the list of COM ports changes, when Pit House quits, when a device drops and on
  `mozaReconnect`; on a timer (every 5 min, `SlowSearchMs`) only while no base is connected or a port is held (Pit House's
  helpers can hold the base after it quits; a failed WMI read finds no Moza port), never once the base is connected and
  nothing is held. It opens, checks or writes to a port only when Windows describes it as Moza's or its USB vendor id is
  Moza's (`346E`); a Valve receiver or an Arduino is never touched. (The diagnostic route's `probe=1`, asked by hand,
  still writes to the others.)
- **Commentary** is offline: fragments and topics in `racing-desk-plugin/simhub-plugin/racingdesk-data/`, assembled by
  Core's engine. The plugin calls no API. (The overlay's race coach, `race-coach.js`, asks Anthropic's API itself with a
  key he gives it.)

## Building and installing

```bash
npm run test:dotnet                                   # every .NET project's tests, the plugin's included (root)
dotnet build apps/plugin/racing-desk-plugin/simhub-plugin/plugin/RacingDesk.Plugin/RacingDesk.Plugin.csproj -c Release
apps\plugin\scripts\windows\install.bat               # ASK THE DRIVER FIRST: it replaces SimHub's plugin
```

The build stages into `racing-desk-plugin/simhub-plugin/build/` and never into SimHub. `install.bat` stops SimHub, builds,
removes the old `RaceCorProDrive.dll`/`RaceCor.Core.dll` files, copies the plugin, `RacingDesk.Core.dll` and the
third-party DLLs SimHub does not ship (never a BCL polyfill or a library SimHub has: its plugin manager disables itself
on a version mismatch) and the `racingdesk-data` folder into SimHub, and starts SimHub again only if it was running.
**Ask before running it**, and see the root CLAUDE.md on what a plugin older or newer than the app means (install order).

## Retired (do not follow)

These were true of `prodrive-plugin` and are not of this tree; the code for them is gone:
- a cloud client (track configs fetched from `prodrive.racing-desk.io`, sessions pushed to it with a PKCE token) and a
  direct `members-ng.iracing.com` client — no feature depends on an iRacing login or any server (root, Ground rules);
- a GitHub release zip, a Windows installer, a lockstep release and CI (`simhub-ci.yml`) — there is no CI and no
  distribution;
- a WebSocket at `/racing-desk/ws` — the feed is MessagePack on `:8890`;
- consumers `prodrive-windows` and `prodrive-homebridge` — archived repos.

The old repos' design documents are in `docs/` here (see its CLAUDE.md for which still describe the code) and in the
root's `docs/archive/`.

## Pointers

- Root guidance and the contract: [`../../CLAUDE.md`](../../CLAUDE.md)
- The plugin's datasets, tests and engine notes: [`racing-desk-plugin/CLAUDE.md`](racing-desk-plugin/CLAUDE.md)
- The overlay (the consumer): [`../overlay/CLAUDE.md`](../overlay/CLAUDE.md)
- The scripts, live and dead: [`scripts/CLAUDE.md`](scripts/CLAUDE.md)
