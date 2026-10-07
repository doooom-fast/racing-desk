# prodrive-plugin — SimHub plugin (the producer)

## What this repo is

The **The Racing Desk SimHub plugin** — C# .NET 4.8 plugin that runs inside [SimHub](https://www.simhubdash.com), reads iRacing SDK telemetry, and exposes it on `localhost:8889` for in-machine consumers (overlay, The Racing Desk desktop app, Homebridge plugin).

It's also a **cloud client** today — fetches track configuration from the server at track change, and pushes session data to the server at session end via Bearer auth.

The plugin is **distributed separately** from the The Racing Desk Windows installer; the installer bundles the overlay only, not this plugin.

## Tech stack

- **C# .NET Framework 4.8** (SimHub's runtime requirement)
- **NUnit** for tests
- **HttpListener** for the localhost server
- **iRacing SDK shared-memory bridge** via `IRacingSdkBridge.cs`
- **Direct iRacing API client** via `IRacingDataClient.cs` — authenticates against `members-ng.iracing.com/auth` with stored local credentials to fetch live iRating + Safety Rating
- **Anthropic prompt fragments** — 240+ pre-generated Haiku-4.5 commentary fragments for offline use, **plus** live API hooks for the overlay's race-coach (the overlay handles the API call, not this plugin)
- **MozaSerialManager** — direct serial control of Moza wheels for force-feedback events triggered by telemetry. It looks
  for the ports never while MOZA Pit House runs (process `MOZA Pit House`; it holds the base's ports, on the rig all day,
  and is looked at once a minute while it does), and otherwise only at the start, when the list of COM ports changes, when
  Pit House quits, when a device drops and on `mozaReconnect` — never on a timer. It opens, checks or writes to a port
  only when Windows describes it as Moza's or its USB vendor id is Moza's (`346E`); a Valve receiver or an Arduino is
  never touched. (The diagnostic route's `probe=1`, asked by hand, still writes to the others.)
- **SimHub's opponents** are read by GameReaderCommon's own names: `IRacing_IRating`, `GaptoPlayer`, `IsCarInPit`,
  `IsCarInPitLane` (`SimHubOpponentTests` reads them from SimHub's installed assembly); the host's opponents keep
  `IRating`, `GapToPlayer`, `IsInPit`, read after them.

## What it exposes

### `localhost:8889` — the contract

`GET http://localhost:8889/racing-desk/` returns a flat JSON object with 100+ properties:

- `telemetry.*` — speed, RPM, gear, throttle / brake / clutch / steering, fuel, tyres
- `lap.*` — current lap, lap time, sector deltas, optimal lap target
- `session.*` — track name, layout, car name, series, session type
- `field.*` — number of cars, your position, gap to leader / next / behind
- `weather.*` — track temp, air temp, wind, sky
- `commentary.*` — derived event commentary (incidents, position changes, fuel calls)
- `strategy.*` — pit window, fuel projection, tyre wear projection

WebSocket variant at `ws://localhost:8889/racing-desk/ws` for push-style consumption.

Polled by:

- [`prodrive-overlay`](../overlay/CLAUDE.md) at ~30 fps
- [`prodrive-windows`](https://github.com/DOOOOM/prodrive-windows) for Dashboard HUD-status indicator
- Any third-party tool

(`prodrive-homebridge` polls SimHub directly on port **8888** — not this plugin's port.)

## Cross-repo seams

### 1. Track config — plugin → server

At every track change, the plugin GETs `https://prodrive.racing-desk.io/api/tracks?trackName=...` to load custom sector boundaries. Cached in-memory until track changes again.

Implementation: `racing-desk-plugin/.../Engine/TelemetrySnapshot.Capture.cs:~1007`.

### 2. Session push — plugin → server

After each session ends, the plugin packages captured telemetry and POSTs to `https://prodrive.racing-desk.io/api/iracing/import` with a Bearer token.

Auth via `/api/plugin-auth/{authorize, token}` PKCE flow. Token stored in `%APPDATA%\RacingDesk\plugin\auth.json`. Refreshes automatically.

This is the only path that captures **per-frame telemetry traces** (the Chrome extension scrape only sees what iRacing exposes on the website).

### 3. Direct iRacing API — plugin → members-ng.iracing.com

`IRacingDataClient.cs` authenticates against `members-ng.iracing.com/auth` with stored local credentials to fetch the user's live iRating + Safety Rating for the overlay's display.

This is **separate from the Chrome extension's scraping path** in `prodrive-server/apps/web/browser-extension/`. The plugin authenticates as the user; the extension scrapes the user's already-loaded session. Both end up in the server's Postgres tables but via different mechanisms.

## Distribution

GitHub release zip from [k10-motorsports/prodrive-plugin](https://github.com/DOOOOM/prodrive-plugin) → user drops into `%PROGRAMFILES%\SimHub\PluginsData\Common\RacingDesk\` → restart SimHub → enable in **Additional plugins**.

CI: `simhub-ci.yml` runs C# NUnit (~147 tests), Python dataset validation (28), Python installer tests (34).

Release wave: **Wave 1** of the lockstep release (parallel with overlay), per the release orchestrator at [`.claude/commands/release.md`](../.claude/commands/release.md) in this agents repo.

## What this repo does NOT do

- **Does NOT process `.ibt` files.** Reads live SDK shared memory only.
- **Does NOT host the overlay or Windows desktop app.** Those are separate repos.
- **Does NOT call the Anthropic API directly.** The overlay's `race-coach.js` does that; the plugin only ships pre-generated commentary fragments.

## Agent work policy

All agent-spawned work MUST use `isolation: "worktree"`. Exceptions: read-only exploration, single non-code file writes.

## Pointers

- Cross-repo orchestration: [`../../docs/archive/monorepo-orchestration.md`](../../docs/archive/monorepo-orchestration.md)
- Overlay (consumer): [`../overlay/CLAUDE.md`](../overlay/CLAUDE.md)
- Server (cloud target): [`prodrive-server`](https://github.com/DOOOOM/prodrive-server)
- Telemetry sidecar schema: [`../../docs/telemetry-sidecar-schema.md`](../../docs/telemetry-sidecar-schema.md)
