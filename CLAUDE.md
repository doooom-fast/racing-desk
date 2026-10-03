# racing-desk

The Racing Desk, by DOOOOM, for one driver on one rig: a transparent HUD, a desk and a livery manager over live
iRacing telemetry, with no account, no cloud and no distribution. This machine *is* the rig — iRacing, SimHub and
the full `.ibt` history are local, so verify against real data rather than assuming.

It was Pro Drive (RaceCor, K10 Motorsports) until 2026-09-27, when everything took the new name: `RacingDesk.*`
projects and namespaces, the SimHub plugin (`RacingDesk.dll`, publishing `RacingDesk.Plugin.*`), the
`:8889/racing-desk/` route, the store at `%LOCALAPPDATA%\Racing Desk` and the settings at `%APPDATA%\Racing Desk`.
The app and the host move the old folders across on first run (`RacingDesk.Data/DataFolder.cs`, `main.js`). The
SimHub plugin must be reinstalled after the rename (`apps/plugin/scripts/windows/install.bat`, which stops
SimHub, builds, removes the old DLL and copies the new one in, and restarts SimHub only if it was running —
**ask before running it**); until then SimHub's copy publishes the old property
names and the HUD reads nothing from it. The plan docs in `docs/` were written under the old name and say so. The
repo's home is `DOOOOM/racing-desk`.

**The plan:** [`docs/local-first-refactor-plan.md`](docs/local-first-refactor-plan.md) (phases in §8).
**What the rig actually looks like:** [`docs/local-first-phase0-findings.md`](docs/local-first-phase0-findings.md).

## Layout

| Path | What | Instructions |
|---|---|---|
| `apps/overlay/` | Electron app: the HUD (`dashboard.html`) and the desk window (`desk.html`), both consumers of `localhost:8889` | [`apps/overlay/CLAUDE.md`](apps/overlay/CLAUDE.md) |
| `apps/core/RacingDesk.Core/` | The engine, runtime and `:8889` / `:8890` servers, host-agnostic (`net48` + `net8.0-windows`). `IRacing/` reads the SDK or `.ibt` directly | — |
| `apps/core/RacingDesk.Data/` | Local SQLite store (`%LOCALAPPDATA%\RacingDesk\racing-desk.db`), session capture, `.ibt` backfill, track outlines from Lat/Lon (`net8`, host only) | — |
| `apps/host/RacingDesk.Host/` | Standalone host: live iRacing or `.ibt` replay → same `:8889` contract, records sessions | — |
| `apps/plugin/` | SimHub plugin — now a thin adapter over RacingDesk.Core (SimHub dashes, actions, events). `racing-desk.sln` at the root builds all .NET projects | [`apps/plugin/CLAUDE.md`](apps/plugin/CLAUDE.md) |
| `packages/calc/` | Calc engines ported from prodrive-server (verbatim, with their tests) plus the local model that turns stored sessions into their inputs; bundled into the desk | — |
| `apps/edit/` | Node CLI that cuts a recording by its telemetry sidecar (loose files by folder; the `.rcpdv` bundle is gone) | [`apps/edit/CLAUDE.md`](apps/edit/CLAUDE.md) |
| `apps/livery/` | Python CLI: livery spec (YAML, car space) → the TGA paint + spec map iRacing loads, self-checked, installed into `Documents\iRacing\paint` | [`apps/livery/docs/DESIGN.md`](apps/livery/docs/DESIGN.md), skill `livery-pipeline` |
| `docs/` | Cross-app context; `docs/archive/` is superseded | [`docs/README.md`](docs/README.md) |
| `.claude/skills/` | Project skills (overlay, plugin, racing domain, bundle format) | — |

Imported 2026-09-16 from `prodrive-overlay`, `prodrive-plugin`, `prodrive-edit` and `prodrive-agents`
with history (subtree merges). Those repos, plus `prodrive-server` and `prodrive-windows`, still exist
and are archived in Phase 6 — nothing is deleted before its replacement works.

## .NET

```bash
npm run test:dotnet                 # dotnet test racing-desk.sln (5 WsTelemetryPublisher failures are pre-existing)
npm run host                        # live iRacing → :8889/:8890, records sessions, backfills new .ibt
npm run host -- --ibt <file> --http-port 18889 --ws-port 18890 --loopback-only   # replay an .ibt beside SimHub, on 127.0.0.1 alone
npm run ingest                      # backfill racing-desk.db from Documents\iRacing\telemetry
npm run sessions -- --type Race     # read back stored sessions (--laps <id> for laps)
npm run parity -- --seconds 120     # live session: diff SimHub's :8889 with the host's :18889
npm run host -- sql "SELECT ..."    # read-only query against the store, JSON out
npm run host -- cars                # the cars the store can name: name, folder, sessions driven, sessions seen in
npm run host -- cars --scan         # first read the names out of the .ibt files ingested before the store kept them
                                    # (headers only, seconds; waits for the sim to close unless --now)
npm run host -- schedule --fetch    # download the season PDF if it changed, parse it, store it
npm run host -- schedule            # parse the stored PDF and report what the parser found
npm run host -- schedule --series "Caterham"   # what one series parsed to, week by week
npm run host -- restore --dry-run   # what is kept for each car's seat height and brakes; writes nothing
                                    # (--db, --documents, --smartcontrol name copies to read instead of the rig's own)
```

A probe the driver or an agent starts by hand (a replay, the parity check) takes `--loopback-only`: the host's HTTP
and WebSocket ports are then on 127.0.0.1 and no other address (`RacingDeskRuntime.Options.LoopbackOnly`; the tests
set the same), where the default is every address, and a probe has no business on the network — a firewall prompt in
a window over whatever the driver is doing is the least of it. The app's own host and the SimHub plugin never take it:
the iPad view needs the LAN.

The host also serves the store read-only at
`:8889/racing-desk/data/{status,sessions,session?id=,schedule,cars,views,pedals,restore,outline?track=}` — that's what the desk
reads (through the app's main process, not from its page), and `outline` is what the SimHub plugin's track map reads (see
Track maps) — **to programs on this machine only**: a request from another address, naming another host, or that a browser
sent (any page, the desk's own included) gets a 403 with no CORS header (see below, after the `?action=` routes). If
SimHub's plugin holds `:8889`, the app runs its host on `:18889`/`:18890` instead (see Desk). One thing is written
through it: `POST /racing-desk/data/pedals` (`{ car_path, profile_id | null }`), for programs on this machine only,
by the same check as the runtime's `?action=` routes make (below), which is now the one every read has too: a request
from another machine, one that names a host other than this machine's own, or one a browser sent (`Origin`, `Referer`,
`Sec-Fetch-*`) gets 403, so the desk page sends it through main.js. `POST /racing-desk/data/restore` is the other write,
by the same check: a switch, or undo (see Per car, for the rig).
Beside them, `GET /racing-desk/data/simwindow` says where the sim's window is and `GET /racing-desk/data/monitors` lists
the monitors, both in physical pixels (see **The HUD is on the screen iRacing is on**, under Desk), and
`GET /racing-desk/data/controls[?car=<folder>]` serves the car list (from the assembly, so it is there
before there is a store) with what the check of it has said of each car: this run's, and what the store has kept of
the runs before (see The car's controls), `GET /racing-desk/data/brakeforce` the brake force the pedals are at now
as the host follows it from SmartControl Live's keys, for the HUD's datastream (`{ car, force_kg }`, null each while not
known; see Per car, for the rig), and `GET /racing-desk/data/wheelmax` the wheel's maximum torque in Nm, from what the
wheel base itself last said (the plugin's poll, which runs while Pit House lets go of the ports) or Pit House's own saved
preset for it, read and never written (`{ source, model, max_pct, rated_nm, max_nm, candidates }`, null each while not
known; the overlay's CLAUDE.md, The datastream's rig limits).

**The runtime's `?action=` routes are for programs on this machine.** The plugin (`:8889`) and the host (`:8889` or
`:18889`) take `GET /racing-desk/?action=<name>` on the telemetry's own path. `setMozaWheelbaseSetting`,
`setMozaPedalSetting` and `setMozaHandbrakeSetting` queue writes to the wheel base, the pedals and the handbrake;
`mozaRefresh` and `mozaReconnect` make the Moza manager poll again and look for its ports again; `importMozaPedals`
reads Pit House's files and saves a profile; `setPedalProfile` and `bindPedalProfile` change the active pedal profile
and the car bindings, which are written to disk; `restartdemo` and `setrect` change the runtime's state; and the reads
(`getMoza*Settings`, `listMozaDevices`, `listPedalProfiles`, `listSerialPortDiagnostic`, which opens the machine's
serial ports and with `probe=1` writes to the ones nothing calls Moza) ask the hardware or the machine. (`resetmap` and
`listtracks` are gone with the recorded maps: see Track maps.) Those ports answer every
address (the iPad view reads the telemetry through the app, which sends no query), so a request that names an action —
`action=` anywhere in the address, in any case, or decoded from the query; whether or not the runtime has such a route —
is checked first, once, before any route is looked at, the host's own data API (`ExtraRoutes`) included, so a
`…/data/status?action=…` from the LAN is a 403 too (`RacingDeskRuntime.Http.cs`; the check is
`LocalRequest.IsFromThisMachine`, which the host's `POST …/data/pedals` makes too):
- the connection is this machine's (`IsLocal`);
- the `Host` is `localhost`, `127.0.0.1` or `[::1]` (HTTP.sys gives a `localhost` prefix any request that says so, from
  any address, and a name another site has pointed at the rig is not one of these);
- no browser sent it: no `Origin`, `Referer` or `Sec-Fetch-Site`/`-Dest`/`-User`. A link, an image or a form carries
  those without a script to add them, and `<img src="http://localhost:8889/racing-desk/?action=…">` on any site open
  on the rig would otherwise have turned the wheel base. Node's own `fetch` says `Sec-Fetch-Mode` and no more, and is a
  program.

Anything else is 403 with no CORS header and a line in the log: once for each action name and each kind of asker (a
connection from this machine that a browser sent, or from another machine). Every name the runtime has a route for
(`KnownActions`) is always written; the names it has none of, which a device on the network can make up without end,
are written for the first 16 and then not. So curl, PowerShell and Node can ask, and an address typed into a browser
cannot: use curl. The Stream Deck's plugin does not ask the runtime: it asks the app's `/api/action/<name>` on its
loopback listener, `127.0.0.1:9091` (always up; the iPad's server on `:9090` answers the same actions while its switch
is on), which hands the demo action to the HUD, and the HUD's own calls go through `runtime:action`
(below). The host has one more route for a program on this machine, behind the same check: `/racing-desk/data/replay`
(GET and POST), iRacing's replay and cameras through the SDK's own commands, for the app's TV shots
(`docs/recording.md`). A route added to the file is behind the check by being below it; `ActionRoutesTests` reads every
`action == "…"` in the file, asks each from another machine, from a page and from this one, and fails on one that is
let through (and on a way of looking at the action it cannot read, and on one missing from `KnownActions`). The HUD is a page — a file, whose requests carry `Origin: null` — so its own calls
(`restartdemo`, `setrect`, the pedal profiles) are made by the main process: `runtimeAction` in
`modules/js/config.js` → the preload → `runtime:action` in `main.js` → `modules/js/runtime-actions.js`, which passes on
only those routes, with their arguments checked, to a runtime on this machine (`tests/unit/runtime-actions.spec.mjs`
fails on a script that fetches an `?action=` route itself, anywhere under `modules/` or in the inline scripts of
`dashboard.html` and `desk.html`, and on one that asks `runtimeAction` for a route that is not in `ACTIONS`; a route the
HUD needs goes in `ACTIONS`). **Install order:** an exe from before this check makes the HUD's calls from the page
(`Origin: null`), and a runtime with the check refuses them, with nothing visible in the HUD (the calls' errors are
swallowed): the ambient capture rect, the demo restart and pedal-profile switching stop working,
and the only trace is one line in SimHub's log for each (`?action=setrect refused: …`). So install the plugin from
this change only with, or after, an exe built from it; an older plugin with the newer exe works. **Left reachable from
the network, on purpose:** the telemetry (`GET /racing-desk/` with no action: read-only, and the iPad's path) and the
`:8890` feed (it reads nothing from its clients).

**The host's data reads are for programs on this machine too, by a rule of their own** (asked for and approved, 2026-10-01: they
carry the driver's customer id — `sessions`, `session` — and the store's path — `status` — and they were open to any
device on the LAN and, by `Access-Control-Allow-Origin: *`, to any web page open on the rig). `LocalDataApi.TryHandle`
asks it of every request under `/racing-desk/data/` before any route is looked at, so a route added later, and a name that
is no route (a 403, not a 404), is behind it with nothing to remember (`LocalRequest.RefusalOfRead`):
- the connection is this machine's (`IsLocal`);
- the `Host` is `localhost`, `127.0.0.1` or `[::1]` **at the port the request came in on** (`localhost:8889` to `:8889`;
  no port, or another, is refused);
- **no browser sent it**: no `Origin` of any kind, `null` included, and none of the marks a browser puts on a request that
  has none (`Referer`, `Sec-Fetch-Site/-Dest/-User`: an image, a script, a no-cors fetch, a link, a form, a navigation —
  typing the host's address into a browser on the rig is refused too). Node's own `fetch` sends `Sec-Fetch-Mode` and no
  more, which is not held against it.

**No page may read the host, the desk's own included, so there is no CORS answer for anybody.** `Origin: null` is what a
file's page says (the desk and the HUD are files, `loadFile`), and it is also what a web page's fetch says once it is
redirected to the host (a second site that answers 302; Chromium marks the fetch tainted), what a `<iframe sandbox>` says,
and what an `.html` file opened from disk or a `data:` URL says: the host cannot tell the desk from those, so a host that
answered `null` could be read by any page open on the rig. (Tested in headless Chromium: `host-data-pages.spec.mjs`.) So
the desk's four reads (`status`, `sessions`, `schedule`, `session?id=`) go through the main process, as the Cars page's
reads and the pedals write do: `desk.js` → `window.racingDesk.desk.read(name, id)` (preload) → `desk:read` in `main.js`,
answered to the desk window alone → `modules/js/desk-reads.js`, which asks the host by Node (a `Host` and no `Origin`) and
answers `{ value }` or `{ error, notHere | noAnswer | status }`, never a rejection. The desk's page fetches nothing (a test
reads `desk.js` for a `fetch`), and the preflight of a data route is refused (403: the host claims it so that the runtime's
wildcard preflight, which the telemetry keeps, is not what a page gets).

Anything else is a 403 (`this is for the app on this machine`) with no CORS header, and one log line for each route and
kind of asker (another machine, another host, an origin, a browser's marks; never the Host or Origin the asker said).
`POST …/data/pedals` and `…/data/replay` keep the stricter test of their own, which the check above now includes.
`LocalDataApi.Routes` is the host's own list; `DataRoutesThisMachineTests` reads the dispatch's source to see it is complete,
and asks every route, over a real 127.0.0.1 socket, of a LAN host, another name, a wrong port, web-site origins, `null`, the
desk's own request as Chromium sends it and a browser's marks (403, no CORS header, nothing of the store in the body), and of
programs (answered, with no CORS header).
**Who asks, and why each is let through:** the main process, by Node (no Origin, `Host: localhost:<port>`): the desk's
reads (`desk-reads.js`), the replay (`askHost`), the car names, the sim's window and the monitors, the Cars page's four
reads and its write (`rig-api.js`), the probe of `status` (`host-launcher.js`); the SimHub plugin's track map
(`HostOutlineSource`, over `127.0.0.1`). No page of the HUD or the iPad reads these routes (the iPad's proxy forwards
`/racing-desk/` with no query and nothing else); `tests/this-machine-rule.mjs` is the stand-in hosts' copy of the rule, so a
reader that would be refused by the real host fails the tests.
**What remains of `--desk-host=`, the desk's `?host=` and `settings.simhubUrl`:** a host on this machine and nothing
further. `--desk-host=http://localhost:18889` (a host you ran by hand, at the port it listens on) still works; a
`--desk-host=` that names another machine is **ignored**, with one line in the log (`main.js` `deskHostFlag`,
`desk-reads.js` `deskHostOf`), and the app finds or starts a host of its own, so the desk, the HUD's screen lookup, the car
names and the TV shots keep working. `?host=` is no longer a way to point the desk anywhere: it is the name of the host the
app loaded the desk with, shown in the desk's messages, and the reads go to the host main.js has (`localHostUrl()`). The
last fallback of `localHostUrl()`, `settings.simhubUrl` (when no host was found or started and there is no flag), is the
telemetry's address and can name another machine; a value that is not on this machine is a host that refuses every read,
so nothing is sent to it (`desk-reads.js` and `rig-api.js` both refuse it first) and the desk says "not on this machine".
Reading a host on another machine was a development convenience, not a feature.

Car names (`cars`, schema v4) come from the session YAML of the driver's own sessions, which lists every entrant's
`CarPath` and `CarScreenName` — nothing of iRacing's is bundled, so a car that has never been in one of those sessions
has no name. The host reads them on ingest and live capture, and once, in the background, from the headers of the
files it has not read yet (`car_scans`: the file's path, length and mtime when it was read) — a file cut short or gone
is marked read all the same, one that could not be reached (held by another program, its folder not there) is tried
again at the next start, and a header pass that fails does not stop the ingest after it. `seen` is the number of
sessions a car was entered in (`session_cars`), `driven` those the driver drove it in — sessions, not rows: a session
driven live and then read from its `.ibt`, or written to several files, is one (`subsession_id:session_num`, as
`packages/calc` merges them).

Schema changes add tables and leave the old ones as they were (v5 took `cars_scanned` back out of `ingested_files`;
v8 keeps what each track outline was built with in `track_geometry_build`, beside `track_geometry`, which has the
columns it always had; v9 adds the five tables of putting the cars back, see Per car, for the rig), so an earlier build can still record and ingest into a store a later one has opened: an
earlier build writes an outline by position, eleven values, and a column added to that table would make it fail and
then delete the sessions it had just stored from the same file.

## Track maps

The map on the HUD and the iPad is one outline per layout, keyed by the sim's `TrackID`, derived from `Lat`/`Lon` in
his own `.ibt` files. The one exception is a layout he has not yet driven a clean lap on: until he has, SimHub's
crowd-sourced map stands in, read from SimHub's own file each session and kept in memory only (below). The sim's `.dat` packs are not decoded, iRacing's map drawings need a login
and are not keyed to `LapDistPct`, and live shared memory has no position at all. Nothing is recorded or dead-reckoned
at runtime any more, so a spin on the first lap, a start from pit exit or an old recording cannot bend the map, and
crossing the line is one more step along a closed loop (`TrackMapProvider.InterpolateOnOutline` takes the segment from
the last point back to the first) and not a jump. He asked for this on 2026-09-30 ("why are we still recording map
data?… get rid of all of it").

- **The host is the one source** (`RacingDesk.Data`: `GeometryAccumulator`, `IbtIngest`, `IbtFollower`,
  `TrackOutlines`; the store's `track_geometry`). `TrackMapProvider` takes an `IOutlineSource`: the host's own
  (`LocalOutlineSource` over `TrackOutlines`), and in the SimHub plugin `HostOutlineSource`, which asks the app's host
  over loopback (`Settings.HostUrl`, `http://127.0.0.1:18889`, where the host runs beside SimHub; the address is the
  app's and is never saved in SimHub's settings) at
  `GET /racing-desk/data/outline?track=<TrackID>` → `{ trackId, cleanLaps, lengthM, officialLengthM, provisional,
  crowd, updatedAt, points: [[x, z, pct], …] }` (metres east and south, so the map is north-up), 404 while there is
  none, 400 without an id. The plugin reads no file of his and no store. Asked on a pool thread, never SimHub's
  `DataUpdate` thread; again every 5 s while there is nothing (and while what there is is SimHub's shared map, below)
  and every 60 s once there is his own, swapping the outline when it has gained laps. The iPad's proxy serves
  `/racing-desk/` alone and refuses queries, so the route is never reachable from the
  network. The HUD's contract (`TrackMap.SvgPath`, `PlayerX/Y`, `PlayerHeading`, `Opponents`) is as it was — but for
  the numbers of the path and of the other cars' places, written to a hundredth of a unit since 2026-10-02
  (`TrackMapProvider.F`): a tenth was 6 m at Le Mans, more than the 5 m between the outline's points, and drew a squiggle
  on the iPad's following map (the overlay's CLAUDE.md, The outline the page draws; beside SimHub this takes the plugin
  installed again, and the page smooths a one-decimal path from an older plugin meanwhile) — plus
  `TrackMap.Status`: `ready`, `crowd` (drawn, on SimHub's shared map: the cell says "SimHub's map until your
  first clean lap", one line under the circuit, above its name), `first-lap` (no outline of this layout yet: the map cell says "Map
  after one clean lap"), `no-host` (the app's host does not answer the plugin: the cell says "No map yet — the app is
  starting its maps", and after a minute of it "No map — restart the app to bring its maps back"), `none`. The host answers on the
  address the plugin asks, `127.0.0.1`, as well as on `localhost`: HTTP.sys matches a prefix that names a host
  against the request's Host header and answers 400 itself to any other name, so `RacingDeskRuntime.HttpPrefixGroups`
  gives the loopback listener both (`OutlineRouteTests` holds the plugin's address to every prefix the host may bind).
  The plugin's layout is the SDK bridge's `TrackId`, which is forgotten when the sim goes.
- **Which laps are in** (`GeometryAccumulator.CloseLap`, `ChecksVersion` 1): a lap from the line to the line (first
  sample within 0.01 of pct 0, last at 0.99 or past), never on pit road, on the track surface but for six frames, with
  a position at every sample (one `0,0` puts the whole lap out), never under 3 m/s after its first second (a spin to a
  halt, a tow, a reset), no step over 15 m between samples, closed (its ends as near as their fractions of the lap
  say, give or take 10 m), and in agreement with the laps already in (median within 8 m and the 95th percentile
  within 25 m, bin by bin). A rescan or iRacing's north fix moves a layout's Lat/Lon between files that share a name:
  laps that disagree are never averaged, and when files disagree the newest file's laps win. The YAML `TrackLength` is
  said in the log when the outline differs from it by more than a hundredth (Okayama's is 4 % out) and is never a gate.
  A single clean lap is an outline. `track_geometry_build.checks` is the checks a row was built with (no row, or a
  row for an outline an earlier build has since written over, is 0: built before them); the host builds every such
  outline again from the layout's files once the new files are in — newest first, the newest file's name, sectors and
  laps winning, stopping at twelve clean laps, waiting where it is when the sim starts. A layout no file gives a clean
  lap for keeps its old outline, still said to be built before the checks (`looked` says it was looked at, so it is not
  read again; the follower may still make it a new one). The sessions are not touched. One line per layout in
  `host.log`; no names or ids.
- **The first session at a layout** (`IbtFollower`): the sim writes the session's `.ibt` as it goes, so the host reads
  it behind the sim — on a thread of its own at background I/O priority, every 10 s (`IbtFile(path, growing: true)`
  counts the records from the length, since the sub-header says 0 until the sim closes the file). A file the follower
  opens when it is already well under way is read from its last five minutes, not its start, and after that what the
  sim has written since each look; the lap being driven is left to close at the line and not judged where it stands.
  From the first clean lap there is a provisional outline for the map (`track_geometry_build.provisional`), refined by
  each clean lap after. **The sim's file is asked for itself, never judged by the folder's listing**: Windows keeps the
  time a file was made, and a length of nought, in the listing for as long as the sim holds the file open, so a
  follower that went by it stopped two minutes after the sim made the file; the newest few are asked by their path, and
  the file being followed stays the current one for as long as it is the newest. What goes wrong with a file is said
  once, a file of another layout is said once and not opened again. The finished file, ingested once it has settled,
  replaces the provisional outline; a provisional one never replaces a whole one. The finished files go in while the
  host runs (`IbtIngest.WatchFinished`, every minute while the sim is closed, files written more than two minutes
  ago), not only at the next start; a file written to while it was being read is read again next time.
- **Until that first clean lap, SimHub's shared map** (`CrowdMaps`, `RacingDesk.Data`, host only; he said "Simhub
  using crowd maps yes" on 2026-09-30). SimHub downloads a crowd-sourced map of the layout a second after the sim
  connects, to `Program Files (x86)\SimHub\PluginsData\IRacing\MapRecordsCloud\<TrackName>[-<TrackConfigName>]-<metres>.shtl`:
  the session YAML's three names to the letter (iRacing's own two spaces in "Historic Circa  95" included), the
  `TrackLength` "4.5789 km" as `4578.9` and a whole number with no `.0` (`algarve gp-Grand Prix-4578.9.shtl`,
  `bathurst-6144.1.shtl`, `crandon full-Crandon Off-Road Full-2360.shtl`); of the 85 files on the rig, 81 are made
  again exactly from his `.ibt` files' YAML by that rule and no other (none differed), and four (`lemans nochicane`,
  `oran south`, `sonoma cup`, `zolder alt`) have no `.ibt` of his to check against, so that rule is all that is
  normalised and nothing is matched loosely — the file with the exact name or none, never a near one, and a rescan
  like `lagunaseca 2026` never takes a `lagunaseca` map. The file is gzip of SimHub's lap-record JSON, `CarCoordinates:
  [{ Value: [x east, altitude, z south], p: LapDistPct }, …]`, a point every 2 m from the line at the origin, the
  filler `[0,0,0]` at p 1 last (the whole shape, and what the survey found, is in `CrowdMaps.cs`); against his own
  GPS lap at Algarve it fits at scale 1.0009, x east and z south (RMS 5.7 m), which is the outline's own frame, so it
  is served as one is. While the store and the follower have nothing of a layout, `TrackOutlines` consults it last:
  looked for every 5 s for the session's first minute (SimHub may still be downloading) and every 30 s after; read
  read-only, a 2 MB packed cap that is on the bytes of the file as it is opened and read (SimHub rewrites these
  files, so the size seen a moment before is not trusted) and an 8 MB unpacked cap; checked (no more points than a
  layout of that length has — one to a metre, never over 30,000, where the files have one to two metres — and p from 0
  to 1 with no hole over 2 % of the lap, 100 points or more, no step over 50 m, closed within 50 m, the length within
  5 % of the session's — the files are within 1 %); a file refused is said once in `host.log`, by its name and why,
  and not read again until it changes, whatever it does (nothing a file does leaves the look set). A file with more
  points than an outline of his own has (`GeometryAccumulator.BinsFor`: one to 5 m, a thousand at least) is made
  evenly spaced in p at that many once it has passed, so the path the HUD and the iPad are sent thirty times a second is
  no larger than his own would be and the sectors, cut by point index, fall where they do on his.
  Served as an outline marked `crowd` (`cleanLaps` 0, `provisional`), which the plugin, the HUD and the iPad draw as
  any other; `TrackMap.Status` is `crowd`, the map asks again every 5 s under it, so the follower's first outline (or
  the store's) replaces it within seconds, and his own is never replaced by it. Kept in memory for the session only:
  never written to the store, a cache or a file, and nothing in SimHub's folder is touched. The line in the log has
  the file's name and nothing else (no path, no id, no driver).
- **The old maps are set aside, never deleted** (`TrackMapSetAside`, at every runtime start): every `*.csv` in
  `<assembly>\racingdesk-data\trackmaps`, `<assembly>\trackmaps` and `<data>\TrackMaps` — SimHub's
  `Program Files (x86)\SimHub\racingdesk-data\trackmaps` and `ProgramData\SimHub\PluginsData\RacingDesk\TrackMaps`
  for the plugin, `%LOCALAPPDATA%\Racing Desk\TrackMaps` and `resources\host\racingdesk-data\trackmaps` for the app —
  moves to `%LOCALAPPDATA%\Racing Desk\track-maps-set-aside\<yyyy-mm-dd_hhmmss>\<simhub|host>\<folder>\`. One line in
  the log; a file held open is tried again at the next start. SimHub's own `PluginsData\IRacing\MapRecords` is not
  touched and no longer read. The `resetmap` and `listtracks` actions, Ctrl+Shift+M and the Stream Deck's "Reset
  Track Map" are gone: there is nothing to reset.
- **Tests**: `tests/…/IRacing/GeometryTests.cs` (synthetic laps round a made-up circuit: each check, agreement, merging,
  the store, the rebuild, the watch, `TrackOutlines`), `IbtFollowerTests.cs` (a file that grows), `OutlineRouteTests.cs`,
  `TrackMapProviderTests.cs` (the loop, the asking, the status, the plugin's source over a listener on 127.0.0.1),
  `CrowdMapsTests.cs` (made-up `.shtl` files in a folder of the test's: the name rule, the shape, every refusal, exact
  matching, a file that comes later, the hand-over to his own, nothing written), `TrackMapSetAsideTests.cs`; on the
  overlay `tests/unit/track-map-status.spec.mjs`.

**Per car, for the rig** (schema v5 to v9; plan in `docs/view-and-pedals-plan.md`). Recording writes nothing to iRacing's
files or to the pedals; putting the cars back (last bullet) does, by itself, by the rules there.
- `car_views` — the view a car was driven with. iRacing keeps one height and horizon for every car (`[View]` in
  `Documents\iRacing\app.ini`, read at sim start, written at exit), so `CarViewRecorder` reads the file while the sim
  is up and again once it has gone: what changed is what the driver changed in that car (`chosen`). A chosen view is
  never replaced by one that was only inherited from the car before. The seat is the cockpit camera's offset in the
  car's own `cameras\cars\<car>\car.cam` (`CarCamFile`, versions 14 and 15).
- `car_pedals` — which of Heusinkveld SmartControl's profiles a car is driven with, and that profile byte for byte as
  it was when the car was given it (each device's section carries a hash, so a profile is never rebuilt from its
  numbers). `RacingDesk.Data/Pedals/SmartControl.cs` reads `C:\ProgramData\Heusinkveld\Database\Heusinkveld.db`
  read-only: the profiles, and SmartControl Live's keys. A profile is parsed as text, never as bytes: most say
  `encoding="utf-16"` on their first line and are one byte to a letter.
- `car_pedal_facts` (schema v6) — what is known of a car's pedals beside its profile: the brake force it was last
  driven with, whether it has ABS, and who gave it its profile (`rule` and what the rule went by, `driver`, or
  `none` when he chose that it has none). A force is the car's with or without a profile, which is why it is not
  kept only in `car_pedals`.
- `car_list_remarks` (schema v7) — what the check of the car list has said of each car, kept so that the desk can
  show it after the run that said it is over (see The car's controls).
- **The brake force is followed from SmartControl Live's keys** (`Pedals/BrakeForce.cs`, `CarPedalsRecorder.cs`),
  because it is in no file: a key goes to Live, Live tells the controller, the controller keeps it. The driver
  said yes to this (2026-09-28), on these terms:
  - Windows is asked whether a key is down (`GetAsyncKeyState`; no hook) about **the keys Live has bound to the
    brake force and no others** — `LiveKeyWatcher.Watched` — and never about a key that text is typed with,
    whatever Live has bound. It is asked on a telemetry frame, so only while the sim is sending; there is no
    clock in it. **Nothing is kept but the force**: the log has the force, never the key.
  - The force is known from the first key that *sets* one. **A number that may be wrong is not kept**: a step key
    held until Windows repeats it leaves the force not known until a key sets one, a key pressed while
    SmartControl Live is not running is not counted, and a look after a gap in the frames only looks.
  - When the sim goes, the car changes or the host stops, the run's force becomes the car's — if a key was pressed
    in that car, and whether or not the car has a profile. The pedals keep their force from car to car and through
    a break in the telemetry of under a minute; after longer, nothing is known until a key sets a force.
  - **A car with no pedals of its own is given them by the driver's rule** (`CarPedalsKeeper`): his `LightBrake`
    for a car with ABS that is neither a formula car nor a prototype, his `Default` for the rest ("a proto with
    abs gets default"). **The car list answers first** (`RacingDesk.Core.Cars.CarList`; `CarPedalsKeeper.Keep`
    takes one, by default the list the build carries): a car is a formula car when the list says its `kind` is
    `formula`, a prototype when it says `prototype`, and has ABS when it says `abs` is `fixed` or `adjustable`.
    The list answers at the end of the car's first run, with no laps to wait for, and whatever the car published,
    when what it says is enough for the profile: both the kind and the ABS, or a formula car, or no ABS (those two
    start from `Default` whatever else is so). The log line says so (`from Default (no ABS, from the list)`); what
    is kept is one of the four reasons and no more (no schema change), so the desk cannot yet say where an answer
    came from. Where the rule acts on a car the list has without ABS, and the car published an ABS setting or its
    ABS was seen working, the line says the two disagree and that the rule goes by the list — once, since it is
    said where the rule acts, and the check in the log says the rest; every prototype of the list is such a car,
    for the `dcABS` they publish carries brake migration. **A profile the rule gave whose reason the list now
    contradicts** (the list was put right in a later build, or the data gave the profile before the list had the
    car) **is given again, once**, with the line saying why; when the list sends it to the profile it already has,
    only the reason kept is put right and the profile stays as it was given. **What an entry leaves out, and any car
    the list does not have, the rule goes by the data for**, as it did before the list: an entry that says the kind
    and not the ABS is a kind, and waits for the laps to say the ABS (`… from the list and what the car showed`);
    one that says the ABS and not the kind has what the car showed for its kind. **What the rule writes is written
    only if the driver has not chosen since it looked** (`GiveCarPedalsByRule`, `RegiveCarPedalsByRule`,
    `NoteRuleReason` in the store: he may pick on the desk, from another connection, while SmartControl's database
    is being read) — his profile, his choice that a car has none, stand. A car has ABS when it publishes `dcABS` or
    its ABS was seen working; it is taken to
    have none after three laps of neither, counted across runs and only while he is in the car — and is put right
    if its ABS is seen later. A car is a formula car when any session in it ran in the category `Formula` (a test
    session is `Road` whatever the car). A car is a prototype, as built, when it publishes what his prototypes do
    and none of his GT or touring cars does — a hybrid system, brake migration, a front anti-roll bar set from the
    seat (`IRacingTelemetrySource.PrototypeControls`) — because the sim has no word for it: a prototype races as
    `SportsCar`, and its class has no name in a test session. **That is the stand-in**, for the cars the list has
    not met. Being a prototype is the reason only where it changes what is given, so a car without ABS is given
    `Default` for that. By the data, a car the rule took for a sports car and later sees to be a prototype is put
    right, as one taken to have no ABS is. A profile he gave on the desk, or chose not to have, is never the
    rule's to change, whatever the list says.
  - Nothing here may hold up or end the telemetry: SmartControl's database is read on a thread of its own and
    never waited for, and what is thrown while following the car is logged and goes no further.
  - Putting a car's force and profile *back* when he gets in is the next bullet.
  - **What the HUD says of it** (since 2026-10-01): the force the run's keys have left the pedals at, as "Brake max"
    in the datastream — `CarPedalsRecorder.Now`, served at `GET /racing-desk/data/brakeforce` (`{ car, force_kg }`,
    null each while not known: no key has set a force this run, a step key was held, between cars) to the app's main
    process, which hands it to the page (`apps/overlay/modules/js/rig-limits.js`; the overlay's CLAUDE.md, The
    datastream's rig limits). A dash until a key sets a force; never the store's last-driven-with number, which the
    pedals are not put back to.
- **Putting each car's seat height and brakes back** (2026-10-02, his words: "when I get in a car, its saved driver
  height and brake force should be set automatically", and then "No trial mode"; the plan has the design). It acts by
  itself, in the host (`RestoreDirector`, `RacingDesk.Data/Restore`); nothing of it is on the HUD.
  - **Brakes**: every car has **a profile of its own in SmartControl** ("Porsche 963 GTP · Racing Desk"), made the first time
    the car loads (editor closed, a copy of the database first): his rule's base at the car's saved force (or the base's own:
    LightBrake 45, Default 80). It is the one he tunes in SmartControl. A force he sets there is the car's force (the row
    holds another than the `car_smartcontrol.written_kg` Racing Desk last wrote: his edit, which wins over his keys of the
    same run); anything else he changes is his, kept as it is (the row is marked `edited`, and a base he picks for the car on
    the desk makes it again only while it is still as Racing Desk wrote it); the force his keys leave in the car is written
    into it when he leaves the car or the sim (`PedalsLeft`: the force and its hash by the rule, nothing else; it waits for the
    editor and a copy first). Deleted in SmartControl, it is made again at the next load. There is also one **switch
    profile** ("Racing Desk", a copy of Default) with F24 · Set profile bound to it in Live's Default preset; Live has the key
    from its next start (he restarts Live once). When he is parked in a car (garage screen or pit stall, still a second,
    brake released, fresh frames, not a replay) and its brakes are not on the pedals already, the car's own profile is
    **copied as it stands** into the switch profile (editor closed, binding checked and made again if gone), which is renamed
    "Racing Desk: Porsche 963 GTP" so that Live's voice says which car, and **F24** is pressed once — only with Live started
    after the binding, iRacing in front and not elevated, and his own keys not pressed first in that car. Then the key
    watcher's force is the one the profile holds (`CarPedalsRecorder.ForceIs`), so his +5 / −5 are kept right. Names are
    `RestorePolicy.CarRowName` / `SwitchRowName`, kept unique.
  - **Seat height**: when the sim has gone (the recorder's `ViewRun`), app.ini above S (−0.020) goes into the car's camera
    file's cockpit Z and app.ini back to S; once, the heights he chose before go in the same way. A car beyond ±5 cm keeps
    nothing; one without a camera file keeps its height in the store, and the Cars page says how to save one. The
    self-check: at the sim's first frame app.ini must hold what Racing Desk last wrote; if not, the height part turns itself
    off and puts the camera files back once iRacing closes — unless an `.ibt` in the telemetry folder (names and times only)
    is newer than Racing Desk's last write of app.ini: a session ran without Racing Desk, iRacing wrote the height itself, a
    line goes in the log and the next fold keeps what he ends with. The horizon is left out.
  - **Undo** (one button, Settings → Cars): both parts off, F24's binding and Racing Desk's rows out of SmartControl (the
    cars' own profiles, with a line if he had changed any; the switch profile left in place once F24 has gone, with one
    sentence on what to pick in SmartControl), the camera files and app.ini put back by value (`RestoreUndo`). One command
    at a time, on the director's own worker.
  - **The writers** back up first and read back after: `ViewFiles` (`app.ini` through `AppIniEditor`, which keeps the
    line's width; `car.cam` through `CarCamFile`; both process names of the sim checked before each write; an intent kept
    in the store when both files change, and put back by value at host start if a stop cut it short; undo puts values
    back too, never a whole-file copy) and `SmartControlWriter` (the vendor's own SQL shapes, database version 1 only, a
    short transaction with a busy timeout, the journal mode never changed, **any row it did not make refused**: his six
    profiles, presets and five keys are never touched). Never SmartControl's Apply, Save or Restore; nothing to the
    pedals' memory; no HID.
  - **One key, ever**: `KeySender.SendF24` in the host (`SendInput`, F24 alone, which nothing on the rig is bound to).
    `SendInputOnlyHereTests` fails if `SendInput` appears in any other file. Tests inject a fake sender.
  - **Schema v9 adds tables only** (`car_view_keep`, `view_baseline`, `car_smartcontrol`, `smartcontrol_switch`,
    `restore_events`); `GET /racing-desk/data/restore` (this machine only) answers the two switches, a sentence for each
    part, whether there is anything to undo, and each car's sentences; `POST` takes a switch or undo. The host keeps the
    switches in `restore.json` beside its settings.
  - Tests: `RacingDesk.Tests/Restore/` (`LiveTests.cs`: the loop over made-up files and a fake key sender; editors, writers,
    the route); on the overlay `tests/unit/restore-api.spec.mjs`, `tests/unit/desk-restore-model.spec.mjs`,
    `tests/desk/restore.spec.mjs` and the Cars page's test in `tests/desk/desk.spec.mjs`.

## Season schedule

The only thing The Racing Desk fetches. iRacing publishes a ~200-page PDF per season; `RacingDesk.Data/Schedule` reads it
with PdfPig (laid out as fixed-pitch text, like `pdftotext -layout`), parses every series and week, and stores it
(schema v3). The live host refreshes it once a day, never while the sim is running.

- The PDF is **not linked from iracing.com's season page HTML** — it's posted on iRacing's forum file host. The URL
  is `settings.json`'s `scheduleUrl` (`--url` overrides it). When a season's URL changes, set it there, or just
  drop the PDF into `%LOCALAPPDATA%\RacingDesk\schedule\` — the newest PDF in that folder is used.
- The parse checks itself against the PDF's own contents pages: every series listed has to come out of the body
  (2026 S4: 151 of 151, 1,989 series-weeks, all with a race length).
- Track and car names come out as iRacing writes them in the PDF, which is not always how it writes them in
  telemetry; the engines fuzzy-match (`packages/calc/src/engines/fuzzy-match.ts`).

## The car's controls

What the HUD's controls panel says of the car he is in: ABS, traction control, brake bias, the car's other dials
(a second traction dial, brake migration, anti-roll bars, throttle map), DRS and push-to-pass — in words where they fit
("Anti-lock", "Bias", "Traction slip", "Front rollbar"; see Words, not capitals, below). What each car
publishes, and why none of it can be trusted to say what a car *has*: [`docs/car-controls-findings.md`](docs/car-controls-findings.md).

- **What a car has is written by hand, once, in one list**, at `packages/car-list/cars.json` (he decided this on
  2026-09-29: "i don't think we can reliably do databased detection"): `{ version, cars: [ { path, name, kind, abs,
  tc, brakeBias, controls: [ { id, var, label, words?, off?, range?, positions?, note? } ], checked, sources } ] }`. `path` is
  the sim's folder for the car (`mx5 mx52016`), `abs` and `tc` are `none`, `fixed` (it has it, he cannot turn it) or
  `adjustable`, `brakeBias` is `none` or `adjustable`, and each control gives the telemetry variable that carries
  it, the car's own short label for it in sentence case (`TCLO`, `ESC`, `BBAL`, `TC toggle`, `Brake bias`) and, where
  what it does in that car is known, the control in words (`words`: `Traction slip`, `Bias`, `Front rollbar`;
  `packages/car-list/README.md` says which and from where). The file is embedded in `RacingDesk.Core` as
  `RacingDesk.Core.Cars.cars.json`, so the host and the SimHub plugin carry the same list; a tree without the file
  builds without one, and every car is then not known. `RacingDesk.Core.Cars.CarList` reads it (`Find(path)` is
  case-blind and takes `-`, `_` and space as one; what it does not know it leaves, an entry that is wrong is put in
  `Problems` and the rest are read; `tests/…/Cars/CarListTests.cs`). Keys the code also reads that the list may
  carry: `lockedWhenFixed`, `covers` (which of abs, tc and brakeBias a `mode` stands for) and `decimals`.
  **What a control's keys must look like to be read**: `off` a number, or `false` for "no value of this is off";
  `range` `[low, high]`, low not above high; `positions` an object of value to name, `{ "0": "Track", "1": "Sport" }`
  (a name of `off`, in any case, is the off position); `words` a string; `lockedWhenFixed` a boolean; `covers` an array of `abs`, `tc`, `brakeBias`;
  `decimals` 0 to 3. A key of the wrong kind is taken as not said, not as an error. The ids the code knows are `abs`,
  `tc`, `tc2`… (a dial that is traction control), `brakeBias`, `mode` (which may be listed more than once), `drs` and
  `p2p` (its `var` may be left out: `DRS_Status`, `P2P_Status`); any other id (`brakeMigration`, `arbFront`,
  `arbRear`, `throttleMap`…) is a cell in the row beneath the three, in the order the list gives them.
  **A `range` says where it came from, in the control's `note`** (`CarControlsFillTests` holds every one to it, but for
  two Supercars throttle maps of 2026-09-29 whose manual is too large to fetch and check, named there): a
  manual, release notes, an article, or — for a car he drives — the lowest and highest his own `.ibt` files show, in
  one form, `Range from his files: seen 46 to 55 in 55 files to 2026-10-02`: every frame of every file read while he was
  in the car (`IsOnTrack`), a value counted where it was held for half a second or more (a single frame of noughts as a
  car loads, or a value rolled past while a button is held, is not a setting), outward to two places for a dial that is
  not whole. Ranges were added for every control a source could be named for on 2026-10-02 (he asked for the bar on
  every adjustment); a control with none has no bar rather than a made-up one. A range from his files is what he has
  used, not what the car allows, so a value beyond it is held at the end of the bar and the check says so in the log
  and on the desk (`value:<var>`): the reminder to widen it.
- **The telemetry is asked three things and nothing more** (`Cars/CarControls.cs`): the value each listed control
  has now (`var`), whether the session's setup is fixed (`WeekendInfo.WeekendOptions.IsFixedSetup`), and the check
  below. Nothing here works out what a car has.
- **None, On, Off, a value, a mode** — each of the three, the sentence the HUD reads (the host writes them in
  sentence case since 2026-10-02; the HUD puts what an older host sends, NONE, ON, OFF, through `words.js` too):
  - **None**: the list says the car has none. Whatever the sim publishes under that name is not it — `dcABS` in the
    GTP cars is the brake migration, and their anti-lock reads None.
  - **On**: the car has it and he cannot turn it (`fixed`; the MX-5's ABS), so there is no number to show.
  - **Off**: it has a dial and the dial is at its off position — `off` in the control, else a position named `off`
    in `positions`, else nought for ABS and traction control only (his rule), unless the control says `"off": false`.
    A fixed setup can hold ABS off, so Off is not always his to change: the reading says `locked`.
  - **A value**: the number as the list's `decimals` says (brake bias to one place), or the name of the position
    (Track, Sport, the BMW's MDM), under the words or the label the list gives. A number has a bar, `fill`: where it
    stands in the control's `range` for that car, held at the ends (`CarControls.FillOf`). A control with no range has
    none, and nothing is made up for it. Positions fill only where they are a scale (`CarControl.PositionsAreAScale`:
    numbers, a percent sign allowed, or `off` at an end, running one way — the MP4-30's `25%`, `50%`, `75%`), by the
    position's place among them; the names of modes (Track / Sport / Normal, Off / MDM / On, Dry / Wet) fill nothing,
    whatever range the list gives.
  - **A mode**: one dial standing for several (the 570S's ABS, traction and stability, "Assists", under Track/Sport/Normal):
    the mode is a cell of its own and the cells it covers are not shown.
  - A fixed setup holds ABS and traction control (`locked`), and nothing else, unless the list says otherwise.
    That is as far as his own files go (§10 of the findings): the sim does not say which dials a fixed setup locks.
- **What is sent**: one key, `RacingDesk.Plugin.CarControls` (`TelemetryFrame.CarControlsKey`), an object on `:8889`
  and its text on the MessagePack feed: `car`, `name`, `kind`, `fixedSetup`, `abs`, `tc`, `bb` (each
  `{ id, label, words?, state: none|on|off|value|mode|unread, value?, text?, fill?, locked?, var?, by? }`, `words` the
  list's for the control and `text` None, On, Off, Next, Ready, Open or a position's name, in sentence case), `more` (the car's
  other controls, every one the list gives it, in the list's order), `drs` and `p2p`. **It is sent only where there is
  something true to say**: for a car the list has, not in the demo. A control the car has by the list whose value
  cannot be read — the list gives no variable, the car is not publishing it, a frame of garbage — is sent as `unread`
  with its id, label and variable and no value, text, bar or lock, so the HUD can show its label over a dash (he asked
  for a panel for every adjustment, 2026-10-01); a fixed primary with no reading is still `on`. DRS is 0 nothing, 1
  next zone, 2 open it, 3 open; push-to-pass has its seconds left (999 is practice, no limit).
  `Cars/CarControlsWireTests.cs` holds what the host writes to `apps/overlay/tests/unit/fixtures/car-controls-wire.json`,
  which is what the HUD's tests are built from: change the shape, and the C# test fails until
  `UPDATE_CAR_CONTROLS_WIRE=1 dotnet test … --filter CarControlsWireTests` rewrites the file, and the HUD's tests
  then run against the new shape.
- **The check** (`Cars/CarListCheck.cs`, one per car, `CarControlsFollower` follows the car): the list against what
  the car publishes, said once per car for each thing in the log (`host.log` for the app's host, SimHub's log for the
  plugin; lines begin `[RacingDesk] car list: <car> …`), kept in the store by the host, and served
  with the list at `/racing-desk/data/controls`. A car not in the list; a listed variable the car does not
  publish; a dial the car publishes that no control of the list has; ABS seen working (`BrakeABSactive`) in a car
  listed without it, or `dcABS` published by one; a bias that moves in a car listed without one; a value outside
  the control's `range` or a position with no name. It compares only while he is in the car and after his first
  second in it (the garage and replays publish what the last car left). **It changes nothing the HUD shows**: the
  list is right until somebody corrects it, and the log line is the reminder to.
- **What the check said is kept, and shown on the desk** (schema v7, `car_list_remarks`). Each remark is a
  `CarRemark`: the car, `About` — which thing was said, the key the check already said each once by (`unknown`,
  `list:abs`, `absent:dcABS`, `unlisted`, `abs:dial`, `tc:dial`, `abs:working`, `bias:moved`, `value:dcABS`…) — and
  `Text`, the words without the car. `CarControlsFollower.Said` raises each one, stamped with the list it was said
  against and when, after the follower's lock is let go; the SimHub plugin has no store and does not listen.
  **A thing is said in every drive of the car that finds it so**, because "last seen" has to mean the last time he
  drove the car and it was still so, and the host — and its one follower, one check per car — is up for as long as the
  app is, across sessions. A drive begins when he gets back into the car after being out of it (`inCar` false, then
  not), when he gets into a car the check has seen before, and when the sim has been gone and comes back; the check
  is then looked at afresh (`CarListCheck.BeginDrive`): what the list says of itself, and that a car is not in it,
  stands and is said again at once, the comparison with what the car publishes is made again after its first second
  in it, and a thing seen happening (ABS working, a bias that moves, a value outside its range) is said again only
  if it is seen again. A thing that is no longer so is not said, and its last sighting stays where it was. A repeat
  is a `CarRemark` with `Again` set: it is for keeping, and the log and this run's remarks have each thing once.
  The list's name is `CarList.Hash`: twelve hex digits of the SHA-256 of the exact bytes of the embedded
  `cars.json` (`empty` for a build with no list, which has nothing to say). The host's `CarListRemarkKeeper`
  (`RacingDesk.Data`) only queues the remark on the telemetry thread and writes it from a pool thread through a
  connection of its own, as the pedals are; a store that will not take it is logged and goes no further, and what
  was in hand is dropped — a thing still so is said again in the car's next drive, which is when it is next seen.
  One row per car (case-blind), per thing, per list: said again under the same list a remark moves `last_seen_at`
  (the earliest first and the latest last are kept) and takes the words it was last said in; said against another
  list — the list has changed since — it is a row of its own. **Only what was said against the list in use is served
  as current**: rows against an earlier list stay in the store and are not shown, since what they say may have been
  put right. A host in replay (`--ibt`) keeps none: a replay's remarks would be stamped with the day it was
  replayed. `/racing-desk/data/controls` says `listHash` and, per car, `kept` — `{ about, text, firstSeen,
  lastSeen }` — beside `remarks`, this run's, as the log has them (`{ "<car>": […] }` for the whole list; for
  `?car=` a list). `kept` is `null` when the store is there and could not be read, which is not the same as none. A
  host from before this had no `kept` at all, and `rig-api.js` reads that as none kept — a host that kept nothing,
  not a store that could not be read. The route reads the store read-only and creates none. A store from a later
  build is not migrated, and is not refused either: it is opened as it is, and remarks are kept in its
  `car_list_remarks` when it has the table — a later build's store has it, since every migration adds and none
  takes away — and nothing is kept in one that does not (`tests/…/CarListRemarksStoreTests.cs`).
- **A car the list does not have** shows what it showed before there was a list: no key is sent, and the HUD goes by
  the raw `dc…` values and the old hand-written table in `apps/overlay/modules/js/config.js`. Nothing is made up —
  no None, no car's own labels, no DRS or push-to-pass. The check says once, in the log, that the car is missing.
- **Not built**: the HUD does not say what the check found; of a car's controls nothing is remembered but what the
  check said; the desk cannot yet say that a pedal profile *already given* came from the list (the host's log line
  says so). A car with no profile yet is said to wait on the list's answer where the list has one (the Desk
  section, below). Beside SimHub the key shows only once the plugin has been installed again from a build that
  carries the list: the plugin carries `RacingDesk.Core`, and the old DLL sends no such key.

## Flags

The payload has long had **one word** for the flags, `currentFlagState` (`none`, `red`, `meatball`, `black`, `yellow`,
`blue`, `debris`, `white`, `checkered`, `green`, and `orange` where the host sees a car ahead being lapped), made from
iRacing's `SessionFlags` bitmask (`TelemetrySnapshot.SessionFlags`) in three places that agree on every flag and differ
at the edges: `TelemetryFrame.GetFlagState` (the WebSocket frame's word: it never says `orange`, and in demo it reads the
snapshot's flags), the HTTP path in `RacingDeskRuntime.Http.cs` (it says `orange`, and in demo reads the engine's demo
flags, `CurrentDemoFlags`) and the plugin's `CurrentFlagState` property (it says `orange` and reads the snapshot's flags
whatever the demo is doing). It cannot tell a local yellow from a full-course caution (`FLAG_YELLOW` is
`0x8 | 0x4000 | 0x8000`), and it has nothing for one lap to green, ten and five to go, halfway, green held, the black flag
furled, disqualified or the start lights. So the host also sends the field itself, and the HUD reads it
(`apps/overlay/modules/js/session-flags.js`, see the overlay's CLAUDE.md, The glance layout and Flags).

- **What is sent**: `DataCorePlugin.GameRawData.Telemetry.SessionFlags` (`TelemetryFrame.SessionFlagsKey`, the name SimHub
  gives iRacing's variable and the one `IsOnTrack` is sent under), iRacing's `irsdk_Flags` bitmask **whole**, as an
  unsigned integer. The start lights are its top nibble, so a value can be above 2^31 (`TelemetrySnapshot.SessionFlagsRaw`
  is a `uint?`; the SDK's signed read of the same 32 bits is the same field, and `TelemetryCapture.SessionFlagsRaw` takes
  either). **Only where the sim says it**: iRacing's own variable (another sim's flags are mapped onto the word and have
  nothing to add), while the sim is running, and never in demo, whose flags are made up — a key that is sent is believed, as
  `IsOnTrack` is, so one made up would put a flag on the HUD that nobody is showing. It goes out from the host's HTTP path
  and from `TelemetryFrame` (the WebSocket feed), which the SimHub plugin carries too. `currentFlagState` is **unchanged**
  and is still what anything that reads the word gets. `tests/…/IRacing/SessionFlagsTests.cs` holds all of this and
  `HostContractTests` holds it over a real `.ibt`: the key is the recording's own `SessionFlags` for the frame the host
  has just been given (over the window of a race, and again over a frame where something other than nothing was out),
  and the word is made from those same bits.
- **The bits**, as IRSDKSharper names them (`IRacingSdkEnum.Flags`, checked against the assembly): checkered 0x1, white 0x2,
  green 0x4, yellow 0x8 (a local yellow), red 0x10, blue 0x20, debris 0x40, crossed 0x80 (halfway), yellowWaving 0x100,
  **oneLapToGreen 0x200**, greenHeld 0x400, tenToGo 0x800, fiveToGo 0x1000, randomWaving 0x2000, caution 0x4000 and
  cautionWaving 0x8000 (a full-course caution), black 0x10000, disqualify 0x20000, servicible 0x40000 (service allowed, not a
  flag), furled 0x80000 (the black flag rolled up: a warning), repair 0x100000 (the meatball), startHidden / Ready / Set / Go
  0x10000000 / 0x20000000 / 0x40000000 / 0x80000000.
- **What 0x200 is, from his recordings** (the newest `.ibt` files, scanned on 2026-09-30). The SDK calls it
  `oneLapToGreen`, and in his data it is **up whenever the car is not under green, which is most of the time**: every
  frame of a practice or test session (`0x10040200`), a qualifying out-lap, the grid before every start (standing starts
  too), the warm-up and the parade (`0x20040200`, `0x40040200`, and `0x20040600` at the end of the parade, with green
  held), and beside the chequered flag in the cool-down (`0x10040201`, which is also how a lone qualifying ends). Every
  real frame also has 0x40000 (service allowed) and, before the start lights, 0x10000000. It is not a lap to the finish:
  the SDK has no bit for that beyond the white flag (0x2, the last lap), so "one lap to go" is not something this field
  says; the laps to go are the glance layout's clock (`RemainingLaps`, in a lap race). **None of the recordings has a
  full-course caution in it**, so what 0x200 does under one has never been seen; the HUD takes it by the SDK's name
  there and nowhere else.
- **What the HUD shows of it** (the overlay's CLAUDE.md has the detail): a **local yellow** (0x8 or 0x100, with no caution
  bit, and not once the chequered flag is out) is the lighter yellow — thin stripes round the edge, the panels left as they
  are, "Local yellow — slow in this sector"; a **full-course caution** (0x4000 or 0x8000) is the full yellow the glance
  layout has always given `yellow`, worded "full course caution"; **one lap to green** (0x200 **with** a caution bit) is
  yellow and white and says "1 lap to green", and 0x200 without one is nothing — it is never ranked above the white or the
  chequered flag, and practice, the grid, the parade and the cool-down show no flag for it; **green held** (0x400) is the
  green, shown only as the green is, after another flag (it is up at the end of the parade and through the start in
  his recordings, where nothing is shown); the **black flag furled** (0x80000) is "Black flag warning", a grey ring with
  its own banner; **disqualified** (0x20000) is its own state with its own banner; **ten and five to go and halfway** are a card each in the spotter's stack,
  said once; the start lights **set** and **go** light the grid's lights when the plugin's own phase says nothing.
- **With no such key** — a SimHub plugin from before it, a replay of one, a sim that does not say — the HUD is exactly as it
  was, from `currentFlagState`. Beside SimHub the key arrives only once the plugin has been installed again from a build that
  carries it (`apps/plugin/scripts/windows/install.bat`; ask before running it), and the app has to be built again
  (`npm run build`) for its own host and for the HUD.

## Words, not capitals

He asked on 2026-10-02: "i'm thinking we get rid of any all-caps text that isn't an acronym and also that we use words
instead of acronyms where we can, though things like tCLO may be hard" — with his own words for the common ones, "for
ABS: anti-lock, for bb: bias. for tc: traction", "mig: migration. arb: rollbar" — and one style for every panel's
header. So, everywhere Racing Desk shows text (the HUD, its glance layout, the iPad, both pages OBS draws, the desk and
its Cars page):

- **Nothing is set in capitals but an acronym.** No stylesheet has `text-transform: uppercase` or small capitals, and
  text is written in sentence case: "Leaderboard", "Laps to go", "Wheel max", "Local yellow", "Pit limiter", "No
  adjustments"; units in their own case (mph, km/h, rpm, kg, Nm, °C). The acronyms that stay are
  `apps/overlay/modules/js/words.js` `ACRONYMS` (DRS, P2P, DQ, OBS, HUD, TV, GT, GTP, MDM, the corners' LF/RF/LR/RR in the
  glance layout, the sims' ACC and AMS, TT, GOAT…); ABS, TC, BB, MIG, ARB, SR, FFB, RPM, FPS, FOV, ERS and SOF are not
  among them any more. Names are as they
  are sent (a driver's, a car's as its maker spells it), and a licence class or a position's P4 is not a word. The car
  list's own short labels (TCLO, BBAL, FARB, and the dash's HYS, IBS and SOC) are `CAR_LABELS`, shown only where the words
  do not fit, and on the desk beside them. `words.js` `sentenceCase` and `labelCase` put
  what a host sends through the same rule, so a SimHub plugin installed before this change shows the controls' states
  and positions (NONE, ON, OFF, BRAKE BIAS) and the strategist's label (FUEL) in sentence case too. **That is all it
  can do**: the commentary card's titles and lines (Title Case, "ABS Activation", "FFB Torque Spike", "ERS depleted"),
  and the strategist's messages ("ABS/TC working overtime", "FL+FR overheating"), are written by the host and by the
  plugin, each with its own `racingdesk-data` and engine, and never go through `words.js`: they say their new words
  only from a rebuilt exe (the app's own host) and from a plugin installed again (SimHub's), and the old ones until then.
- **Words instead of acronyms where they fit**: Anti-lock, Bias, Traction, Migration, Rollbar (Front rollbar, Rear
  rollbar), Safety (was SR), Force feedback (was FFB; "Sim feedback max"), iRating (was iR: the gaps' line in the glance
  layout where it is whole in its cell with the trend after it, "iR" on the rig's 66px cells and where it is not; the
  commentary, the desk and the results screen say iRating outright), Frame rate (was FPS), Field of
  view (was FOV, on the desk), Hybrid battery (was ERS) and the like in the commentary, Strength of field, Position,
  Incidents and "incidents a race" on the desk, the pit box's corners (Left front… on the rig, LF… in the glance layout's
  corners), the strategist's "Front-left and front-right overheating", and "g" in lower case; each control of the car list in
  words where a public source settles what it does (`packages/car-list/README.md`). The HUD's controls panel shows the
  longest form that is whole in its cell: the words, then a rollbar's "Rollbar" with a small F or R, then the car's
  label, never cropped (`car-controls.js` `chooseForm` on the rig, by the arithmetic the panel sizes its labels by;
  measured in the glance layout). The desk shows the car's label beside the words with the words as its title, and
  leaves out a label that only repeats the dial's generic name (ABS beside Anti-lock).
- **One header for every panel** (`dashboard.css`, "One header for every panel"): the leaderboard's, the datastream's,
  the incidents', the gaps' Ahead and Behind, the ratings', the laps panel's, the pit box's tabs and pages and the
  clock's key are one style — the HUD's face in Light (300) at `--fs-lg` (13px), larger than the data's labels and lighter than its numbers (he asked on 2026-10-02), in the theme's dim text colour, 0.04em of
  tracking, no rule beneath (the `.panel-label`'s of the two there were, its tracking halved for sentence case), at one
  size in the glance layout (`--hdr-glance`) — and the leaderboard's, the datastream's and the incidents' headers are
  one place, 11px in and 7px down from their panels' edges. **Open to him**: the labels over a column (Ahead and Behind,
  iRating and Safety, Laps to go) have the style and are centred over their column; the pit box's tab bar keeps its
  centred tabs and its open tab's white and rule; the pedals' Throttle, Brake and Clutch are captions of their bars
  and keep their own weight and white (`apps/overlay/CLAUDE.md`, Words, not capitals).
- **Tests**: `apps/overlay/tests/unit/words-not-caps.spec.mjs` with `words-scan.mjs` (every stylesheet, page and script
  that shows text, the Cars island, the calc engines the desk's bundle holds, the car list and the commentary, read for
  capitals, for abbreviations that are not in capitals (iR, SoF, Pos, Inc, avg, inc/race) and for Title Case headings;
  the car list's words; the one header on the rig and in the glance layout, and where it sits; the pit box's corners;
  the longest labels whole on the rig at 3440x1440 and zoom 120 and at every iPad size, after a change of car with the
  transitions on, the gaps' iRating, the crowded rows), `Cars/CarControlsWireTests.cs`
  `TheListThisBuildCarriesHasItsWordsWhereTheMeaningIsKnown` and
  `TheWordsAreWhatTheCarsOwnSourceCallsTheDialAndNothingIsRenamedThatAlreadyIsWords`, `IRacing/TyreWearTests.cs`
  `TheOverheatingCallNamesTheCornersInWordsNotInLetters`.
- **Not done**: the commentary's car and track facts (`commentary_cars.json`, `commentary_tracks.json`: makers' and
  series' names and acronyms such as FIA, DTM, ECU, FWD, NA) are as they were, and the topics' "temps" and the engines'
  "min" and "hr" are as they were (units and clippings, not acronyms); the calc engines' archetypes and moments ("The Swiss
  Army Knife", "Win Streak") are names and stay Title Case; the Stream Deck's action names (`remote-server.js`
  `ACTIONS` and the plugin's manifest: "Open Settings", "Cycle Rating / Pos") are the Stream Deck's own and are as they
  were. The results screen is dormant and is in sentence case now, its coach's headings and its iRating included. On an
  iPad the controls under the three are one row: a row that is not whole at its narrowest forms is made whole by closing its
  cells up and going down to 9px, and where even that is not enough (the Audi R18's twelve dials, the Mercedes W12's and
  W13's ten but on the 12.9-inch, the Ferrari 499P's seven on the 9.7-inch and upright) each label is cut at its own
  cell's edge, not run into the next's; the overlay's CLAUDE.md, The controls panel.

## Other drivers' names

**A real name of another driver never leaves the source adapters.** Everywhere Racing Desk shows or sends a driver who is
not him — the leaderboard, the gaps, the spotter, race control and the commentary, the incident coach, the iPad view and
both OBS pages, the desk's sessions, the recording sidecar and the TV shots, the WebSocket feed, the logs — the name is a
character's, chosen for that driver from `packages/pseudonyms/names.json`: the people of David Foster Wallace's fiction
(*Infinite Jest*, *The Broom of the System*, *The Pale King* and the stories) and of *Trainspotting*, and the members, past
and present, of Sunn O))), Black Sabbath, Type O Negative, Tool and The Cure — 336 real names from public sources, none
invented, with their sources in the file and its README (session and touring players of the bands, who are not members,
are not on it: adding them back is his decision). His rule (2026-10-01: "iRacing likely won't let us show others'
names eventually"; iRacing's support article of 2026-09-30 says no display name or customer id may be shown without
explicit, revocable consent), so there is no switch. **His own name stays his.** Car numbers, cars, classes, iRating and
licence stay what they are. No route sends a customer id (the sessions' `driver_cust_id` column is gone from
`GET /racing-desk/data/sessions` and `session`; nothing read it).

- **Where the names are replaced** (`apps/core/RacingDesk.Core/Names/`): on the host's path at the two places the session
  YAML is parsed — `SdkRawTelemetry.SessionInfo` (live: `SessionNaming` renames the SDK's model once for each
  session-info update, whether the SDK hands over a new object or fills the same one again, and whoever asks first renames
  it for all the others) and `IbtFile.SessionInfo` (a replay, the ingest, the follower) — every other driver's `UserName`,
  `AbbrevName` and `Initials`, and the `TeamName`, are rewritten in the model itself (`Pseudonymizer.Apply`; his own entry
  and the pace car are left, his car with him in it, `Pseudonymizer.IsHim`: in a team race a teammate driving his car is
  another driver, named like the rest; spectators are named too). A session without teams has each driver's team named as
  the driver is (iRacing's is the driver's own name there); in a team race every team, his own included, is a label
  made from its id, `Team <surname of a character>` — a team may be named after anyone, so none of its own is kept. On the
  plugin's path SimHub hands over its opponents with their names, and the engine never reads an opponent's `Name`: it asks
  the source (`ITelemetrySource.OpponentName`), the plugin's source hands the three facts it reads off SimHub's opponent
  to `SimHubNaming` (in `RacingDesk.Core`, so the tests run the code the plugin runs), which asks the SDK bridge
  (`IRacingSdkBridge.OpponentName`), and the bridge has named every car of the session YAML by its customer id and finds the
  car again **by the name SimHub gives, or failing that by its number** — a lookup that stays inside the bridge. **Until
  the bridge has read the session YAML nobody is named** (null: the leaderboard leaves the row out, the gaps have no name,
  the commentary uses the name in Settings), and **SimHub's word for who is the player is not trusted**: a name passes as
  his only when it is the one the session gives him (a teammate in his car, or a camera on another car, is another driver
  and gets a character). iRacing with no bridge names nobody. For another sim there is no session to read: his own is
  SimHub's word, every other driver a character keyed on the name, salted, from one table kept for as long as the plugin
  runs (it starts again when it has used the list up). A car the YAML does not list is named by its name until it does. A
  build without the list says "Driver" and four digits, no two alike. So the readers hold no real name, and nothing keeps
  the raw YAML (the iRating estimator reads its numbers from it and lets it go; `IbtFile` and `IbtHeader` give out the
  cars, never the text, and the file lets go of its text once the model is parsed).
- **What the store keeps and sends.** The store keeps what it was given (sessions stored before this have real names on
  disk, new ones the characters, and the customer id either way). The recorder takes his id from the session's
  `DriverUserID` and flags only his own entry `is_player`; it used to take the first entry for his car, which in a team
  race may be a teammate's. `GET /racing-desk/data/session?id=` keeps a stored character, and names the drivers of an old
  grid from the stored ids, as one field in the order of their ids' priority (`LocalDataApi.GridNames`: the way the live
  session names its racers, whatever order the store lists them in), so a rival is the character the HUD showed. His own
  row is told by his customer id (`RacingDeskStore.OwnCustomerId`: the one most stored sessions are under), not by the
  `is_player` flag, which in a session stored before went to whoever was in his car: a flagged entry under another id is
  a teammate's and is named like the rest.
- **One name, one form, everywhere.** The name is the HUD's own style — the first initial, a dot and the surname with its
  particle (`H. Incandenza`, `J. van Dyne`); a character known by a nickname is shown whole (`Sick Boy`, `Spud`, `Begbie`,
  `Bob Death`) — and the same string goes to every reader, so what the HUD matches by name (a threat to a leaderboard
  row, a gap trend to its car) matches. `leaderboard.js`'s `formatName` no longer shortens: it would have cut a
  nickname in two. **Open, his decision**: the brief asked for the full name ("Hal Incandenza") where the HUD showed full
  names (the gaps, the spotter and commentary text, the desk) and the short form where it abbreviates; the builder chose
  the short form everywhere because the incident coach and the gap trends match by text. Giving the full name to those
  readers means `UserName` = the full name, `AbbrevName` = the short form, the leaderboard reading the short one, and
  the matching moved to `CarIdx`; it is not done.
- **Randomized, but steady** (`PseudonymBook`, `Pseudonymizer`): each name of the list is scored for a driver by
  `HMAC-SHA256(salt, "rank|cust:" + customer id + "|" + the name)` (rendezvous hashing: the order and the length of the
  file decide nothing, so re-sorting it renames no one and a name added to it moves only the drivers who prefer it to
  the one they had), with a salt of 32 random bytes made once on this machine and kept at
  `%LOCALAPPDATA%\Racing Desk\pseudonyms.salt` (the app's host and the SimHub plugin read the same file; it is never sent
  anywhere, and the id is stored nowhere by the names), and the driver takes the best-scored name nobody in the session
  holds. A field named at once is served in an order of the ids' own (`"priority|" + key`, not the listing's) and racers
  before spectators, so a contested name goes the same way on every path. A name once given is kept for the session
  (iRacing's SessionID and SubSessionID), so a rival is the same character all race and, by the hash, the next time.
  **Not guaranteed**: a rival keeps his character from one race to the next only when no one in the field held it first —
  in a field of 40, about two pairs of first choices clash, so roughly one rival in twenty is another character than he
  would be alone — and a driver who joined after the field was named, or a path that began later, can be served in a
  different order than the one that named the field first. When a session has more drivers than names the next gets a
  numbered form of the one he prefers (`H. Incandenza II`), never one in use, so no two drivers in a session share a
  name. Nobody can turn a name back into an id without the salt.
- **The demo's rivals are characters too** (`Names/DemoNames.cs`); the fixtures and tests use characters or a few made-up
  names, and `NoRealNamesInFixturesTests` scans the tests, fixtures and sources for a driver-shaped string that is neither.
  The tests run with a book and salt of their own (`TestNames`), so none reads or writes the rig's salt. The full chain,
  through both paths to the `:8889` JSON, the WebSocket frame, the leaderboard, the gaps, the incident coach, the
  commentary, the recorder and the data route: `tests/RacingDesk.Tests/Names/`.

## Tyre wear

**One meaning, everywhere: tread remaining, per corner, 0..100 %, 100 = new; `null` where the sim has not measured it;
a corner whose tyre was changed reads a new set's 100 until the sim measures it, and `RacingDesk.Plugin.TyreNewSetFlags`
says which.** That is what `DataCorePlugin.GameData.TyreWear{FrontLeft,FrontRight,RearLeft,RearRight}` carry on `:8889` and the
`:8890` feed, what `RacingDesk.Plugin.Demo.TyreWear{FL,FR,RL,RR}` carry, what `TelemetrySnapshot.TyreWear*` hold
(`double?`), and what every reader — the pit box's rings, the commentary's quad, the trigger, the strategist, the
recording's sidecar — takes as it is. Nothing converts it but two functions in `apps/core/RacingDesk.Core/Engine/TyreWear.cs`,
called once at each source and nowhere else, and nothing replaces a reading on the wire but one class,
`Engine/TyreSetMask.cs`, once, before any reader (he asked on 2026-10-01: "100% tires are reading as totally worn … we've tried
to fix that a number of times so it seems to getting flipped back and forth in multiple places" — it had four meanings,
0..1 remaining, 0..1 worn, 0..100 remaining and "0 is no data", and each fix flipped one reader to match whatever it saw):

- **The host** (`IRacingTelemetrySource.TreadRemaining`): iRacing's own variables, `LFwearL/M/R` and the other corners, are a
  fraction remaining per tread band, 1.0 = new (the header says "percent"; the value is a fraction — his recordings start at
  0.9998). One corner is **the mean of its three bands, times a hundred** (`TyreWear.FromBands`). All three bands at 0, or
  absent, is not a bald tyre: it is not measured, `null` (a corner that really is at 0.0 on all three bands reads as not
  measured too, which is the safe side: a variable that is not there reads 0 the same way, and a false "critical" on a fresh
  set is the error this exists to prevent; the worst of the corners that are measured still warns).
- **The SimHub plugin** (`TelemetryCapture`) asks the same bands first, through the same `FromBands`, so it and the host read
  the same number at the same moment. SimHub's own `GameData.TyreWear*` comes second, for a game with no such bands: it is a
  percent remaining (a fresh set read 100 on its wire on 2026-10-01, and SimHub's bundled dashes compute wear as
  `100 - [TyreWearFrontLeft]`), but for iRacing it is **the middle band alone** (its reader, `IRacingManager.GD_TyreWear*`,
  is `LFwearM * 100`), it was seen to read 0 until a lap was done, and it reads **0 while it has nothing**. So 0 is `null`
  (`TyreWear.FromSimHub`). **0 is never a measurement**, on the wire or on the page.
- **The demo** (`DemoTelemetryProvider`, `DemoSequence`): the same percent. The provider's set starts at 82/79/86/85 and
  loses two or three points a lap to a floor of 10; the sequence's base set is 62/59/66/65 and its `tyre_wear_high` step
  has the fronts at 29 and 32, which the provider takes on when the step fires (`ApplyDemoStep`), so the rings and the quad
  say what the card says.

**iRacing measures tread in the pits and nowhere else.** In his `.ibt` files the bands sat at one value for thirty-one laps
and moved on the first frame on pit road, before the stall; two fourteen-lap races never moved at all. So the number is
**the last measurement, never live wear**, and the code says so rather than pretend: the pit box writes "Tread measured
in the pits" in one dim line under the rings, on the rig and in the glance layout (at the label's floor, never wrapped; an
iPad's heading has no room for it), for iRacing and out of the demo. The strategist (`Engine/Strategy/TireTracker.cs`) rates
the health **when a measurement comes in** (a corner's value changed to a number, or was first said) and the coordinator
makes the **wear** call on that frame — on pit road, where it can be acted on, under its own module key (`tire-wear`), so a
temperature call a minute before cannot swallow it — and **not again at a lap crossing**: a value that has not changed is
not news, and the pit box's offer comes from the verdict that stands, not from a repeated call. The temperature and grip calls
are not tied to a measurement. There is no spike filter: the step at pit entry is the one true reading. The tread is **not a
grip factor** (`GripScore`): between stops it says nothing about live grip, and it was a third threshold (40) that put a
"grip" call on a fresh set. The laps-left estimate is 99 (nothing to say) between iRacing's stops and 0 for a tyre measured
critical, and the pit box shows laps only in between.

**A changed corner reads a new set's 100, per corner, at the source, until the sim measures it.** After a change iRacing keeps
showing the readings of the set that came off until it measures again at the next stop (reported by others — niklam/iracedeck
issue 1108 and pull request 1188 — and seen on his own data as resets: a reset to the pits fits a new set with his default pit
settings while the readings keep the old set's; the sim's own counters, `LFTiresUsed` and the others, `TireSetsUsed`, do not
count a reset, so the stall and the checkboxes are what catch it). `TyreSetMask`, which `RacingDeskRuntime.Advance` calls on
every frame before the wire, the commentary and the strategist read the snapshot, replaces that reading: a corner whose tyre
is asked for while the car is in its stall (`PitSvFlags`, the pit box's own source for "tyres requested", one bit a corner)
remembers what the sim shows then; the car leaving pit road makes the corner read **`TyreWear.NewPercent`, 100** — a new set,
green, full — and sets its bit in **`TelemetrySnapshot.TyreNewSetFlags`**, on the wire as **`RacingDesk.Plugin.TyreNewSetFlags`**
(`PitSvFlags`' bits: 0x01 FL, 0x02 FR, 0x04 RL, 0x08 RR; 0 where every number is the sim's own, and 0 in the demo); both stay
until the sim's number for that corner moves (the next stop's measurement), when the real number replaces the 100 and the bit
clears. He chose this on 2026-10-01 over a dash ("100%, new set (Recommended)"): his own .ibt files showed every change in his 64
newest sessions was a reset, and in 9 of them a dash would have stood for 6 to 93 % of his time on track. A sim that measures in
the stall after the change is not held at all; a stop without tyres holds nothing; a stop with two (`0x05`) holds those two
corners at 100 and the strategist rates the car again with them (a right rear measured at 15 and left on stays critical, and
the pit box still offers the change, for that corner only); a corner the sim had never measured when it was changed has
nothing to hold and stays `null` until its first measurement; and **a corner whose remembered reading already prints as a
new set's 100** (`TyreWear.DisplayPercent` of it is 100: a session that starts on a fresh set, with tyres ticked in his
default pit settings, leaves its stall on the first exit with readings of 100 — one of his 64 newest sessions, with
`PitSvFlags` 0x1f from its first frame and 100.00 throughout, would have said "New set" for 88.8 % of its time on track)
**has nothing to replace and is not held or flagged**, so the page says
"new set" only where the engine put the 100 there and the same fresh set reads "Tread measured in the pits" whichever way
the defaults were ticked. (Replayed over his 64 newest sessions: the line is up in 7 of them instead of 9, and one session's
share of its time on track falls from 71.6 % to 33.5 %.) The wire, the rings, the quad, the `tyre_wear_high` trigger, the strategist, the sidecar and
the commentary all see the same 100, so none of them has a rule about the value: a new set never warns, nothing is offered for
it, and the trigger does not fire on it. Two readers look at the flags, for what the 100 is and not for what it says: the pit box
writes **"New set · not measured"** (a pair: "New fronts · not measured", rears, lefts, rights; an odd change names its corners
alone, "New LF, RR", since no honest suffix fits beside three corners in the 136 px under the rings at 744 wide) in the dim line
under the rings in place of "Tread measured in the pits" while any corner is flagged, on the rig and in the glance layout
(`config.js`: `parseTyreNewSet`, `tyreNewSetNote`; the iPad and OBS pages are the same page), and the strategist
(`TireTracker.UpdateFrame`) takes a flagged corner's 100 as the tread — a new set is healthy — but **not as a measurement**, so
the frame the lefts became new does not call the right rear's 15 again (`NewMeasurement` stays false; a value that has not
changed is not news). The pit box's tyre-change offer keeps the same rule on the page, where the flags are: with the offer up
for the right rear, the accept button ticks the rights and not the two new lefts (`pitbox.js`: `selectOfferedTires`,
`dropNewSetFromOffer`; a corner that turns into a new set while the offer is up loses its tick; the driver can still tick one
by hand; the amber "suggested" highlight, which `showStrategistSuggestions` adds and `deselectAllTires` takes off again in the
same frame, has never shown, and leaves new sets out should it ever). The ring itself has no rule: a flagged corner whose
value arrives `null` is still a dash, since the flag only feeds the words. In the pit cell of the 10.2" iPad held upright
(under 200 px, where "Tread measured in the pits" already gives way) **the new-set line gives way too while a tyre call is
up**: the rings and the call fill the cell and there is no room beside them (a screenshot with both put the line over the
rings' position labels), and the call is the news. The sidecar carries the flags as `wNew`; demo frames carry `TyreNewSetFlags` as 0 (HTTP and WebSocket both), and the sidecar's
`wNew` is 0 there too. Not handled: tyres asked for in the stall and not fitted (the
driver left without the stop) read 100 until the next measurement, the safe side.

**Every warning fires at the worn end, at two numbers** (`TyreWear.WarnBelowPercent` 35, `CriticalBelowPercent` 20; on the
page `TYRE_WEAR_WARN_BELOW` and `TYRE_WEAR_CRIT_BELOW` in `config.js`, which every panel reads, with `parseTyreWear` the one
reader of the wire's value and `tyreWearShown` the one printer): the rings are amber under 35 and red under 20 (`pitbox.js`), as
is the commentary's quad (`commentary-viz.js`; a quad with no data is four dashes, never four 0 %); the `tyre_wear_high`
topic has one trigger, `TyreWearWorst < 35` — the worst corner of the four, so none is left out (the rear right had no
trigger before) — and prints the percent whole ("worst tyre measured at 30% tread"); its fragments say worn, not critical,
because it fires at worn; the strategist's `TireHealthState` is 1 under 35 and 2 under 20 (the pit box's "Accept tire change",
in the demo too), with a severity-2 call at 1 ("Front-left measured at 30% tread. Think about tyres at this stop." on pit road,
"…at the next stop." elsewhere) and a severity-4 call at 2 ("Front-left measured at 15% tread. Take tyres at this stop." on pit
road, "Pit for tyres at the first chance." elsewhere). **A printed number never rounds across a threshold** (34.6 is worn and
says 34, 19.7 is critical and says 19; `TyreWear.DisplayPercent`, `tyreWearShown`; a fresh 99.98 says 100). A tyre not measured
(`null`, NaN to the trigger) satisfies nothing. **Fresh tyres never warn.**

**Tests, which fail on any single flip** (a fraction, a worn-fraction, an inversion, a 0 for new, a reading from the set that
came off):
`tests/…/IRacing/TyreWearTests.cs` — the conversion and the printed percent; raw SDK bands of new and of worn tyres through the
host's source and capture to the WebSocket frame and, over a runtime on 127.0.0.1, to the HTTP wire (100, 15, `null`); the
plugin reading the bands before SimHub's property and the two agreeing to the digit whatever SimHub says; `TyreSetMask` alone
(a reset to the pits, four tyres, two at `0x05`, none, a drive-through, a sim that measures in the stall, a corner never
measured, a session reset: the changed corners read 100 with the flags saying which, until the measurement, then the measured
value; the strategist healthy and silent on a new set, a critical corner left on not called again; a fresh set the sim already
reads as 100 — exactly, or 99.98 — neither held nor flagged, while 99.4 is, and the next real change still is; the demo's two
wires carrying 0 with the live mask still holding behind them) and **a whole stop with four
new tyres through a runtime, from iRacing's variables to the HTTP wire and its `TyreNewSetFlags`, the WebSocket frame, the real
topic file's trigger and the strategist**, then the next stop's measurement; the real topics file against new, worn, each corner,
unmeasured and 0..1 snapshots; the exposition's formatting; the strategist's measurement rule, the wear calls once and not at
every lap, the wording, no tread in `GripScore`, and the coordinator's call on pit road; the demo's values and the sequence's
step reaching the provider. `apps/overlay/tests/unit/tyre-wear.spec.mjs` — the real page over a stand-in plugin: 100 is 100 % and
green with nothing offered, 30 amber, 15 red, 64.4 is 64 %, a printed number never across a threshold, `null`/0/no key a dash,
0.91 is 1 % and red (no conversion on the page), a new set's 100 with the flags is 100 % green and "New set · not measured"
(the words for each pair and an odd change, the measurement's words back when the flags clear, nothing in the demo; a flagged
corner whose value is `null` still a dash; every wording whole on one line on the rig as well as in the glance layout; the
words giving way to a tyre call at 810x1080 and back; "accept" ticking the corners that are not a new set, and a corner that
turns new while the offer is up losing its tick), the strategist from
`TireHealthState`, the demo's keys and the demo's offer at 20, the quad's dashes, the page's two thresholds equal to
`TyreWear.cs`'s, the note under the rings on the rig and in the glance layout, with the new-set words whole at the 11 px floor.
`telemetry-sidecar.spec.mjs` — `wFL`..`wRR` null or the number, `wNew` the flags or 0, and the header's `tyreWear`. `DatasetValidationTests` and
`validate_datasets.py` hold the topic to `<`, a percent threshold and the worst corner. The test project's own copies of the
evaluator and the snapshot (`TestHelpers/`) have no tyre wear any more: the tyre cases run against the shipped evaluator in
`TyreWearTests`, and a data file not found there fails, not skips. Fixtures that encoded the old meanings and were put
right: `tests/helpers.mjs` (0.91 → 91 …, demo 0.80 → 80 …), `tests/golden/fixtures/base-payload.json` (0 → 100, demo 0.82 →
82 …), `issue-11-display-units.spec.mjs` (its copy of the fallback is gone), `TriggerEvaluatorTests` (its tyre cases moved);
the golden frames (`glance-race-*.png`, `in-car-synthetic.png`) carry the note line.

## Desk

```bash
npm run build                       # THE APP: apps/overlay/dist/win-unpacked/Racing Desk.exe (calc bundle + host + overlay)
npm run build:host                  # just RacingDesk.Host → apps/host/publish (dev: once, then npm start below)
# electron-builder here: npmRebuild is off (its "install production dependencies" step would prune the workspace's
# shared node_modules of every dev package, itself included), and its winCodeSign tools archive can't be unpacked
# by it on this machine (macOS symlinks inside need a privilege Windows doesn't grant by default) — if the cache
# is ever cleared, unpack the .7z it downloads into %LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0
# with 7za and `-xr!darwin`, then build again.
npm start -w racing-desk-overlay        # overlay from source: HUD + desk, starts the host too (--no-desk skips the desk,
                                    # Ctrl+Shift+O reopens it; --desk-host=http://localhost:18889 uses a host you ran by hand,
                                    # on this machine: a host elsewhere refuses every read, so the flag is ignored)
npm test -w @racing-desk/calc          # engines + local model (vitest)
npm run test:desk                   # desk.html over a mock host, headless, off-machine requests blocked
```

Build once with `npm run build`, then the app is `apps/overlay/dist/win-unpacked/Racing Desk.exe` — the Start menu and
Desktop "Racing Desk" shortcuts point there; "shipping" is `git pull && npm run build`. It starts its own RacingDesk.Host
(`modules/js/host-launcher.js`): beside SimHub on `:18889`/`:18890` with `--no-hardware` while SimHub holds `:8889`,
on `:8889`/`:8890` otherwise, or it uses a host already running; the host's output goes to `%LOCALAPPDATA%\Racing Desk\host.log`.
There is no console window. **Closing the desk window quits the app** (minimise it to keep the HUD while racing) — the
HUD's window is hidden and Windows 11 tucks the tray icon behind its overflow arrow, so an app that outlived its window
would run with nothing on screen. The tray's "Quit Racing Desk" quits too, and nothing else does. **Quitting the
overlay is not quitting the app**: Ctrl+Shift+Q (held in the car only), the Stream Deck's "Quit Overlay" and the
`quit` action all put the HUD away (`hud.putAway`) and leave the desk, the host and what they record running. It is
the driver's switch thrown to off, so the HUD comes back the way a switched-off HUD does. No page can ask for the
app to be quit (`quit-app` and `quitApp` are gone). The host is
spawned detached — Node otherwise puts it in a job object Windows kills with the app, mid-write — and stops itself,
flushing what it was recording, when the app goes (`--parent-pid`). **A host still there five seconds after the app
went ends its own process** (`apps/host/RacingDesk.Host/HostStop.cs`, TerminateProcess, so nothing can hold it; the
same goes for Ctrl+C and `--exit-after`) — its stop still under way, or over with a thread still holding the process —
and what was being written is left uncommitted: the store is
SQLite in WAL mode and stays as it was at its last commit. **A host that has been asked to stop lets go of its ports
first** (`RacingDeskRuntime.StopListening`, wired by `Program.NewStop`: the HTTP and WebSocket listeners close before the
loops are told, and the orderly stop that can take up to five seconds comes after): `host-launcher.js` takes anything
that answers `/racing-desk/data/status` with a `schemaVersion` for a host it can use, so an app that started in the
meantime — the Ctrl+Shift+G restart relaunches it, and it is up within a second — would adopt a host that was about to end
and have none for the rest of the session. With the ports free it starts a host of its own, and the store serialises
the two hosts' writes (`tests/…/Transport/StopListeningTests.cs`). The app's will-quit kill is a backstop only while the app is
still here; a host that outlives the app has nothing of the app left to end it. On 2026-09-29 one did, for minutes,
and the next `npm run build` could not replace `e_sqlite3.dll`: IRSDKSharper 1.1.4's `Start()` spins until it sees its
connection loop's flag set, the loop clears the flag as soon as it has connected, and it connects on its first pass
when the sim's shared memory is already there — as it is beside SimHub, sim running or not, once iRacing has run while
SimHub is up. The host's main
thread missed that moment at 19:28:35 and never reached the loop that hears the stop (its log has no "waiting for
iRacing" line, no ingest and no schedule). `apps/core/RacingDesk.Core/IRacing/SdkStart.cs` lets that wait through, for
the host's reader and for the runtime's bridge, which the SimHub plugin starts the same way. One instance:
double-clicking the shortcut again opens the desk in the running app.

**The HUD is on screen only while the driver is in the car.** Its window is made hidden, and
`modules/js/hud-visibility.js` is the only thing that reveals it (`showInactive`, so the sim keeps the focus): while
the telemetry says he is in the car, he has not switched the HUD off, and the page is loaded. At the sim's menus,
with the sim closed, or once the telemetry has not answered for three seconds it is hidden — two seconds after he
gets out, so it does not blink between sessions — and nothing is ever quit to get it off the screen. The decision
is the main process's, not the page's: it asks the telemetry the page reads, once a second (twice in the car), and
tells the page (`in-race-state`), which polls and draws only while he is in. A hidden page is not relied on to
notice him getting back in. What "in the car" means is one function, `inCar` in `modules/js/in-car.js`
(`tests/unit/in-car.spec.mjs`): demo mode; or the sim running and iRacing's own `IsOnTrack` and not a replay, which
the payload carries as `DataCorePlugin.GameRawData.Telemetry.IsOnTrack` (`TelemetryCapture.InCar`, sent only where
the sim says it: a key that is sent is believed, so one made up would hide the HUD for good) — so the garage
screen and a replay are out of the car; or, from a source that sends no such key, a session under way
(`Grid.SessionState` > 0), which counts them as in. The SimHub plugin sends the key once it has been installed
again from this build; until then, beside SimHub, the HUD is on screen in the garage.
The page on an iPad or in a browser has no main process behind it and asks the same function for itself; so does
`npm run record -- --only-in-car`. The driver's switch is kept until the app is quit: off stays off when he gets
in, on shows nothing while he is out. The tray's "HUD on/off" (ticked while it is on) throws it anywhere;
Ctrl+Shift+H and the Stream Deck's button only where what they do is seen — in the car, the page loaded — and
anywhere else leave the switch as it was and answer `{ ok: false, reason: 'out of the car' }` (pressed at the
desktop they used to switch the HUD off unseen, and there was none when he got in). The Stream Deck's button shows
its tick all the same: it goes by the answer's status, not by what the answer says. When the main process says he
is back in the car the page starts clean — no backoff left from a break in the telemetry, and one poll at once
(`startConnectionClean` in `game-detect.js`) — and while he is in the car the page is never left waiting on a
source that did not answer for longer than half a second, so a break too short for the main process to notice
does not leave old numbers up after it. A page whose process has gone is loaded again by `hud-visibility.js`:
two seconds later, for every reason but a clean exit, three times at most without a load finishing; and after
that, or after a load that failed, once more each time he gets in the car. A page that hangs has its process
ended (`unresponsive` → `forcefullyCrashRenderer`), and is loaded again as one that died. In dev mode the window stays as
`dev-mode.js` put it. `tests/unit/hud-main-wiring.spec.mjs` reads `main.js` and holds it to this: the window made
with `show: false`, nothing in `main.js` showing or hiding it, the switches going through `hud.toggle`, quitting
the overlay through `hud.putAway`, and `app.quit()` called from five places and no more — and, for the screen
(next), the window moved by nothing in `main.js` (no `setBounds`) and `getPrimaryDisplay()` used once, for an id.
**The HUD's keys are held only while he is in the car** (`modules/js/hud-keys.js`, `HUD_KEYS` in `main.js`,
`tests/unit/hud-keys.spec.mjs`). A key the app registers is taken from every other program on the machine for as
long as it is held — Ctrl+Shift+V is paste-as-text in a browser, Ctrl+Shift+P a command palette — and the app used
to hold twelve from start to quit. It holds one, Ctrl+Shift+O (the desk); the HUD's ten
(H, R, G, D, I, F, V, B, P, and Q, which puts the HUD away) are registered when `hud-visibility` says he has got
in (`onInCar`) and let go when he gets out. In dev mode they are held throughout. (M, which reset the track map, is held
by nothing: the map is the host's, from his own laps, and there is nothing to reset.)
**A limit:** beside SimHub the HUD reads SimHub's plugin on `:8889`; if SimHub goes in mid-session the HUD is
hidden, though the app's own host on `:18889` has the same telemetry. There is no falling back to it.

**The HUD is on the screen iRacing is on** (`modules/js/hud-display.js`, `tests/unit/hud-display.spec.mjs`). It used to
be put on the primary screen, always, so it was on the wrong monitor whenever the primary was not the one the sim runs
on. The rig has two screens: the 3440 × 1440 ultrawide at 100 %, where iRacing runs, and a small 1440 × 1080 one at 175 %,
which Electron sees as **823 × 618**: 1080 / 1.75 is 617.14 and Chromium takes the enclosing rectangle, so a screen's
size in DIPs is the physical size over the scale, rounded up (`overlay.log` has it as "823x618", and a 1920 × 1080
screen at 175 % as "1098x618"). **Which of them Windows has as the primary changes**, and `overlay.log` says when:
the ultrawide was the primary at the app starts up to 2026-09-29 22:40Z (16:40 local); the small screen was at the starts
of 2026-09-30 00:42Z and 01:28Z (18:42 and 19:28 local), and the HUD was on it, which is when he complained; at 01:29:23Z
the log has `Display metrics changed (bounds, workArea), reflowing overlay to 3440x1440`, and the primary was the
ultrawide again. A read-only `EnumDisplayMonitors` query (per-monitor aware) after that found the ultrawide as the
primary at (0, 0) and the small one to its left at (-1440, 0). Just before the complaint, at 00:19–00:22Z, the log has
the primary's size changing three times (1098 × 618, 2560 × 1440, 1440 × 1080) while the displays were being set up; a
query when this was last worked on found a single 3840 × 2160 screen. So the screens are not fixed, the HUD follows
them as they are and does not read them once, and the rule does not depend on which is the primary; its tests hold both
layouts. The rule, in the order it is applied:
1. **A screen he chose** in Settings ("HUD screen", Layout; `hudDisplay` in `overlay-settings.json`: `auto`, or a
   screen's key), while it is connected. A choice that is not connected is not used and is not lost: it is Automatic
   until the screen is back, the Settings page shows it as "The screen you chose (not connected)" with a note, and the
   key stays in the file until he chooses another (Automatic clears it). The key is Electron's `display.id` as text;
   that Windows keeps it across a restart or a replug has not been checked on this rig, and if it does not the choice
   reads as not connected and Automatic does the work.
2. **The screen the sim's window is on**, while the sim runs. Electron cannot see another program's windows, so the
   app's own host says (`GET /racing-desk/data/simwindow`: the lookup is `apps/core/RacingDesk.Core/Screens/SimWindow.cs`,
   the answer `apps/host/RacingDesk.Host/SimWindow.cs`): the main window of
   `iRacingSim64DX11` or `iRacingSim64` — its frame (`DWMWA_EXTENDED_FRAME_BOUNDS`, else `GetWindowRect`) and the monitor
   Windows has most of it on, in **physical pixels**, or JSON `null` when there is no such window on screen (the sim
   closed, minimized, or gone between being listed and being asked). A look that cannot be made at all — the process
   list will not open — throws, and the route answers 500, which is "did not say" and not "closed". The host is not
   DPI-aware, so the asking thread is made per-monitor aware for the call (`PerMonitorAwareScope`): a caller that is not
   gets the 175 % screen's windows and monitor scaled down (measured with a probe of the same calls, on another
   program's window there: 832 × 578 for a window that is 1456 × 1012). `main.js` turns the rectangle into the screens'
   own units (`screen.screenToDipRect`) and the screen with most of its area wins; equal shares go to the left one. The
   host is asked at `localHostUrl()`, for 0.8 s at most. **A host that does not say is not a sim that is closed**: if
   the sim was last seen on a screen that is still connected, the HUD stays on it (`simKept`; the log says "iRacing
   was last on it, and the host did not say where it is now"), so a display event, Ctrl+Shift+R or a saved setting
   while the host is slow or restarting does not move it to where the ini says. Only the host saying `null` sends it
   to the ini.
3. **The screen that is the size iRacing is set to run at**, from `Documents\iRacing\rendererDX11Monitor.ini` (its
   `[Display]` section; read, never written): `fullScreenWidth × Height` when `fullScreen=1`, else `windowedWidth ×
   Height`, which when `windowedMaximized=1` is the screen it is maximized on (his is maximized at 3440 × 1440, and
   the size is what tells which). Sizes are matched physically, and within one step of the screen's scale: DIPs by the
   scale come to at most one step above the physical size (823 × 1.75 is 1440.25, 618 × 1.75 is 1081.5), so 1440 × 1080
   is the small screen and 823 × 618 is not a size iRacing can be set to. Where the host has said what the panel is
   (below), the match is exact. A maximized window is also as big as the room a screen has beside its taskbar, so when
   no screen is that size a screen whose `workArea` is counts. Of several screens of that size the primary one among
   them, else the first from the left. `windowedXPos/YPos` is not relied on: which screen it names depends on how
   Windows lays them out, and the size says more.
4. **The largest screen** by physical pixels, the primary among equals. Nothing known of the screens at all leaves
   the window alone.
   With the host absent (dev mode, one that failed to start, or SimHub's plugin on `:8889` answering something that is
   not a window), slow, or failing, its answer is "did not say" and, with no sim seen before, the ini decides; the log
   says so. The sim not running is an answer (`null`), and the ini decides too.

   **The screens' sizes.** Electron's are DIPs and cannot be turned back into pixels (1439 is 823 wide too), so the
   host lists the monitors (`GET /racing-desk/data/monitors`; `EnumDisplayMonitors` in `RacingDesk.Core/Screens/Monitors.cs`,
   the answer in the host's `Monitors.cs`: `[ { x, y, width,
   height, primary } ]` in physical pixels; 500 when Windows will not list them). `hud-display` asks it once for each
   layout of the screens that has a screen not at 100 % (with all at 100 % a DIP is a pixel and nothing is asked), in
   the same round as the sim's window and with the same limit, pairs each monitor with the screen most of it lies on
   (`matchMonitors`; a pair must agree on its size within a step, and a screen two monitors claim is left) and names the
   screens by the sizes it gives: "1440 × 1080 (left, primary)". Until it has, and where it does not, a scaled screen is
   named by the estimate and says "about": "about 1440 × 1082 (left, primary)". Asked again at the next round if it did
   not say, and when the layout changes; the Settings page (`describe`) waits for it for the same 0.8 s.

   **When it is decided:** at start, with no host asked (the sim is probably not running, and a window made on the
   right screen has nowhere to jump from); each time he gets in the car, and **before the window is revealed** —
   `hud-visibility` waits for `beforeReveal` (`hudScreen.refresh()`; `PREPARE_WITHIN_MS`, 2.5 s at the outside: a round
   is 0.8 s at the most, and one already under way when he gets in is followed by one more, so it is two; a hook that
   throws or hangs never keeps the HUD off) so it does not come up on the primary and then move; whenever a screen is
   added, removed or changes (`display-added`, `display-removed`, `display-metrics-changed` for any screen, not only the
   primary); when `hudDisplay` changes (the desk's save waits for it, so the page can say where the HUD went); and by
   Ctrl+Shift+R and the `reset-window` action, which put the window back on the screen the rule chooses. A run of
   asks made while one is under way is one more run, with the screens as they then are.
   **What is moved:** the window covers the screen's full bounds on Windows and its `workArea` on macOS (as before),
   moved with `setBounds` — hidden or not, never shown or hidden by this module, which is `hud-visibility`'s alone.
   On a screen of another scale the first `setBounds` can leave the old size, so the bounds are looked at and set
   again, three tries at most, and within 2 px is right. Dev mode's window is `dev-mode.js`'s and is left as it put
   it (no host is asked either). Logged once per change: `HUD screen: 3440 × 1440 (right) — iRacing is running on
   it`, and the screens (`Screens: about 1440 × 1082 at 175% (0, 0), primary; 3440 × 1440 at 100% (823, 0)`, and again
   as `1440 × 1080` when the host has given the panel's size). When the screens, or where the HUD is and why, change, the
   desk window is told (`hud-displays-changed`, `onHudDisplaysChanged` in the preload) and the Settings page, if it is
   showing, reads the HUD screen list again in place. Not verified in the app (no window is opened here): that
   Electron's `screenToDipRect` and `setBounds` agree across the two scales on this rig, and the screen key's
   stability; the real `EnumDisplayMonitors` was run once on this machine (one screen then), not on both screens; the
   rule, the wiring and the host's routes are tested, the Electron calls are not.

   **The ambient colour follows the sim's screen** (it looked at the primary or the first screen, always, until
   2026-09-29). A screen he chose in Settings for the HUD is the HUD's place: while the sim runs the colour is sampled on
   the screen the sim's window is on — with the HUD on the small screen by his choice and the sim on the ultrawide, the
   colour's region is ratios taken from the HUD's window on the chosen screen. While the sim has no window the colour is
   sampled on the primary. (A recording was of the sim's screen by the same rule, through the Electron recorder's
   `getDisplayMedia`; since 2026-09-30 OBS records, through his own display capture, and the app grants no screen
   capture at all — `docs/recording.md`; `hud-display.js` no longer keeps the sim's screen for a recording.)
   - **The ambient colour** (`RacingDesk.Core/Engine/ScreenColorSampler.cs`, in the app's host and in the SimHub plugin
     alike) is sampled on the monitor the sim's window is on — `RacingDesk.Core/Screens/SimMonitor.cs`, with the same
     lookup the `simwindow` route makes (it and the monitors' lookup moved from the host into `RacingDesk.Core/Screens/`
     so both can use them) — and, if the sim's window names no monitor, the listed monitor with most of it; while the sim
     has no window on screen or the look fails, the primary monitor, from the same `EnumDisplayMonitors` list the
     `monitors` route gives. Looked for again every 2 s at most (it lists every process; the sampler runs four times a
     second), and at once after a capture fails — once: a capture that goes on failing (the screen locked) waits the 2 s. The lookup and the capture are both made per-monitor aware on the
     sampler's own thread, so they agree in physical pixels on screens of different scales; the region the HUD sets is
     ratios of that monitor, from its own corner. Logged once per change (`ScreenColor: sampling the monitor iRacing is
     on, 3440x1440 at (0, 0)`). `tests/…/Screens/SimMonitorTests.cs`, with fake window and monitor sources. Not verified
     on the rig: a capture of the sim's screen beside the 175 % one, and a recording of it — nothing was built or
     captured here — and the SimHub plugin samples the sim's monitor only once it has been installed again.

**The main process's log** (`logToFile` in `main.js`, `modules/js/app-log.js`, `tests/unit/hud-log.spec.mjs`): in
the built app `%LOCALAPPDATA%\Racing Desk\overlay.log`, beside `host.log` — it was written beside `main.js`, which
in the built app is inside `app.asar`, so nothing was kept; from source it is still
`apps/overlay/racing-desk-debug.log`. Past 4 MB the file becomes `overlay.log.1` (from source
`racing-desk-debug.log.1`, git-ignored with the other), in place of the one before, and a new one is begun. A line
that cannot be written is dropped — a failure to log is never a failure of the app — and no line carries a
customer id or the name of a key he pressed. The id is in more places than a paint's name: the name a paint is
written under on its way in (`car_<id>.doooom-tmp`), and `"customerId"` in the settings and in each backup's
manifest; `scrub` takes it out of all of them.

The desk window has three pages — **Desk**, **Cars** and **Settings** — switched from the masthead nav, the
tray menu, `?page=` or the `#settings` hash (`modules/desk/desk.js` `showPage`). Paints was a page of its own until
2026-09-29, when it and Cars became one; `paints` as a page's name still leads to Cars. Settings edits the HUD's `%APPDATA%\Racing Desk\overlay-settings.json` through the preload bridge
(`modules/desk/settings-model.js` lists the keys) and each change applies live: `save-settings` writes the file whole
and sends `settings-sync` to the HUD window. The old WinUI settings app is no longer the way to change the HUD.

**The HUD on an iPad** (`remote-server.js`; the "iPad" card at the foot of the Settings page). Off unless the driver
switches it on; then the main process listens on the home network (port 9090) and serves `dashboard.html` to a
browser, which shows the glance layout: every panel of the HUD, in its glass and type, as the cells of one grid that
fills the screen, with the flag as the background when one is out (`body.drive-mode-active`,
`modules/styles/drive-view.css`; the switch is `modules/js/drive-hud.js`, and Ctrl+Shift+F puts the rig's HUD in the
same layout — see `apps/overlay/CLAUDE.md`, The glance layout). It sends the numbers the HUD reads, never a picture of
the game. The rules it is built on, each with tests in `tests/unit/remote-server.spec.mjs`:
- **Read-only from the network.** GET and HEAD only. `/racing-desk/` is proxied to the telemetry the HUD itself
  reads (`localhost:8889`, or a saved `simhubUrl` that ends in `/racing-desk/`) and a request carrying a query is
  refused — the plugin and host take `?action=…` on that same path, wheel-base settings among them, and none of it
  can be reached through here (nor from anywhere but a program on the rig: they refuse the rest themselves). Files
  are served from `modules/`, `images/` and `fonts/` only; the one other thing served is the crop of his paint behind the car badge, from the main process's memory at `/livery-crop.png` (The
  livery behind the car badge, below) — no query, nothing from disk, 404 while there is none.
- **A key in the address.** `http://<rig>:9090/?k=<8 characters>`; the page hands it back as a cookie. Made the
  first time the server starts and kept in `overlay-settings.json` (`remoteServerKey`, with `remoteServer` and
  `remoteServerPort`). Those three are the main process's own: `save-settings` keeps what is on disk for them
  whatever a page sends, and no window is given the key (`get-settings` and `settings-sync` leave it out). "New
  key" on the card cuts off every address handed out before.
- **The request has to name the rig** — localhost, one of its addresses, or its hostname — which is what stops a
  site from pointing a name of its own at the rig and reading through a browser at home.
- **The actions (`/api/action/<name>`) are for a program on the rig** that says it is one with the header
  `X-Racing-Desk: 1` (the Stream Deck plugin does). A browser cannot put that header on a link, an image or a
  form, and anything carrying a browser's own headers is refused too: otherwise any page open on the rig could
  quit the app.
- **The page waits for nothing from the internet.** The Typekit stylesheet is taken out of what is served, because a
  stylesheet that cannot be fetched holds the whole page back, and a script asks for it once the page has loaded
  (`remote-server.js` `injection()`). The HUD's two faces, sofia-pro-comp and stolzl, are Adobe's kit `pdg5yka`. The
  kit serves any address, with or without a referrer (a web project has no list of domains, so there is nothing to add
  in the driver's Adobe account; the page sends `no-referrer`), and its font files may not be copied or passed on, so
  the rig never serves them: the iPad fetches them from Adobe itself and needs the internet for that. Until the text
  face has arrived (`document.fonts.load`, then `rd-kit` on `<html>`) the page is in `"Avenir Next Condensed"` and
  `"Helvetica Neue"`, so no text is ever invisible or late; with no internet it stays in them. The only requests off
  the rig are that stylesheet, made after `load`, and Adobe's own ping from inside it. If Adobe ever stops serving the
  kit to an address like this one, the choice is the driver's: open-licensed faces bundled for both screens. The
  main HUD's typefaces are not changed by any of this.
- **What the page is told, not what it works out**: `window._remoteMode` and `window._simhubUrlOverride` are set
  before any of the HUD's scripts run, and `settings.js` leaves the address alone in remote mode. (It used to reset
  it, which had the iPad asking itself for telemetry.) In remote mode there is no voice coach; the HUD's effects and
  its ambient light are there (the colour the plugin samples from the rig's screen) unless "Effects: off" in the menu,
  which the iPad keeps; and a strip says "No data from the rig" when the numbers stop arriving. Of his settings the
  iPad is told two things, the "Panel background" slider of Settings → Look (`panelBackground`, 90 unless he moves it:
  how solid the panels are, with a shadow under the numbers as it goes down) and "Following map zoom" from the same
  page (`followMapZoom`: which way the local map zooms with his speed, one of three words; `apps/overlay/modules/js/map-zoom.js`),
  with the page and again every ten seconds from its server's `/api/settings-display` (`remote-server.js`
  `IPAD_SETTINGS`, each key let through only as the kind of value it is), and nothing else.
- **What he asked for on 2026-09-30** (`html.rd-remote` rules at the end of `drive-view.css`; the rig's own
  Ctrl+Shift+F is as it was): the glass's light — its tint, the overhead glow and the sweep, the specular streak, the
  inset glow — at fifteen hundredths of the rig's (`--rd-shine`), the flags' own treatment of the glass as it was;
  no badges (the Racing Desk mark and the car's maker are not cells on the iPad, and the crop of his paint is never
  asked for), the row they were in being the controls, the pedals and the clock; the menu's sign a small round button
  in the top right corner; and a sector never cropped in the laps panel (see the overlay's CLAUDE.md). The same look
  is what OBS draws when "iPad dashboard" is chosen under "HUD drawn by OBS" (the loopback listener's `/obs-ipad`,
  `html.rd-glance`): the glance layout in OBS mode over a transparent page, with no flag pattern between the panels,
  placed once in a corner of the game video, at half its height, and never moved or sized by Racing Desk again — not
  for a renamed scene — while **the page is laid out at the size he gives the item**: the browser source's own width
  and height follow the item's box, on every connect and a moment after he lets go of it in OBS, so the layout flows
  to a wide strip, a square or a 1080p box rather than being stretched into it — a box smaller than the least iPad
  (1024x744 on its side, 744x1024 upright) at its own shape scaled up to that, drawn into the box (asked 2026-10-01;
  `docs/recording.md`). It takes his display settings
  like the rig HUD OBS draws: effects off on the rig takes the WebGL canvases out of it, where the iPad is told none.

Tests listen on 127.0.0.1 only. A listener on the network makes Windows ask about the firewall, in a window, over
whatever the driver is doing — so nothing but the driver's own switch ever starts one. **The listener on this PC**
(`remote-server.js` again, `loopback: true`, port 9091, `localServerPort`) is always up on `127.0.0.1` alone and asks
Windows nothing: the Stream Deck's buttons, `/api/status`, his display settings through an allowlist
(`/api/settings-display`) and the two pages for OBS (`/obs`, the rig HUD, and `/obs-ipad`, the iPad dashboard: "HUD
drawn by OBS" in `docs/recording.md`). The code on the card is
`modules/js/qr-code.js` (version 3-M, 42 bytes at most); `tests/unit/qr-code.spec.mjs` reads it back by the
standard's rules, since no reader is on hand. A page cannot keep an iPad awake over plain http, so the card says to
set Auto-Lock to Never.

**The livery behind the car badge** (`modules/js/logo-livery.js`; asked for 2026-09-30: "the splash of color beneath
the car logo to be the livery preview cropped to a random artwork filled section"). The square under the car's logo
on the HUD — the rig's, and the glance layout's on the rig (an iPad shows no badge since 2026-09-30) — was a flat splash of the maker's colour.
Now it is a section of the paint the sim is showing on his car: `Documents\iRacing\paint\<car>\car_<customer id>.tga`,
the very bytes the sim reads, cropped to a window with artwork in it and laid under the logo, with a darkening over
it so the mark and the car's name read on any paint. **The main process chooses it, never the page**: the page reads
no file and builds no path. It is chosen from the same telemetry answer `hud-visibility` shows the HUD by — when he
gets in the car, and when the car changes while he is in it, once each — and kept until the next of those, so it
does not flicker; the choice is random among the best few windows, so each time he gets in the car it is another
section. Getting out keeps the last crop (the HUD is hidden then). **A crop made for
another car is taken away the moment the car changes**, so the last car's paint is never under this car's logo while
this one's is made (the badge is the maker's colour in between, and an ask for the crop gets a 404); getting back into the same
car keeps its crop until the new one comes. The car's folder is
what the host's car-controls key names for a car the list has (`car`), else the store's name for the telemetry's
model (`/racing-desk/data/cars`); the paint folder and the customer id are the desk's paint settings (`paints` in
`overlay-settings.json`, which the Cars page fills from detection the first time it is opened). **With any of the
three missing, no paint for the car, a paint that cannot be read, or a paint with no artwork, the badge is the
maker's colour, as it was.** The paint is read and decoded (`paints/tga.js`) in a worker thread
(`logo-livery-worker.js`), one at a time, so the process that owns the HUD's windows never stops to look at sixteen
megabytes: a newer car ends the worker of the pick under way (its signal is aborted and the thread terminated), so
there is never more than one at work. The worker refuses a file over 70 MB, a file whose header declares an image
over 4096 pixels either way (read before anything is allocated or decoded: the size of the file is no limit on the
image it says it holds, and a few kilobytes of run-length encoding can declare 16384 by 16384, which is a gigabyte to
decode), and any file outside the paint folder, by the path and by what the path really is (a junction elsewhere).
What leaves the main process is the crop alone: a PNG 512 across and 341 high — 1.5 to 1, the widest shape the badge
takes (the glance layout's on the rig's ultrawide is 204 by 138 and the rig HUD's is square, which shows the middle of
it, `cover`) — handed to the HUD's page as a data URL (`logo-livery`, and `get-logo-livery` for a page that loaded
after), and served from memory at `/livery-crop.png` by the iPad's server and by the loopback listener (above). The iPad
never asks for it: it shows no badge. The page OBS draws (`window._obsMode`, "HUD drawn by OBS" in `docs/recording.md`)
is the one that does, from the loopback listener, whenever the car changes and whenever he is back in the car
(`car-logos.js` `requestRemoteLivery`, which fetches nothing on an iPad).
**No log line carries the customer id or the paint's path**; the reasons the worker gives back have no path in them.
The picker's rules and the page's side are in `apps/overlay/CLAUDE.md`, The livery behind the car badge.

**Cars** is the one list of cars and the one place to look at a car: its liveries, the view it is driven with, its
pedals. The list is on the left — every car the rig knows, by the sim's name for it, cars with a livery first, a
filter over all of them, the livery groups above — and a car that has a view or pedals kept says so in its row
(`view`, `pedals`), so the cars that have been set up can be found among the rest. The car on the page is on the
right, in this order: its name; **View** and **Pedals**, side by side, and **Controls** across both (`.car-rig`); its
versions and "When a livery is applied"; what is on disk for it (installed in the sim, backups); Trading Paints; and
last the library's own housekeeping, Library source. The view and the pedals are what the page is opened for after a
drive, so they are in sight without scrolling in the desk's smallest window (1024 × 680 outside, about 1008 × 641
inside) for every car, with the liveries beginning under them — and, where the host has the car list, Controls
between. **Controls is short on purpose**, because the list will have nearly every car and a panel that listed each
control (a prototype has eight) pushed every listed car's liveries below the fold, with nothing wrong with the car:
its heading with how the entry was checked beside it, one line of kind and the three dials, and the rows of
controls folded under "Each control, its label and values" (a `<details>`, folded to begin with and kept as he
leaves it while he goes down the list). So for a listed car the whole panel is in sight and the liveries begin in
sight (about 620 of 641 for the McLaren, 600 for a prototype), and the rows are one press away. **Where the car
and the list disagree the liveries do begin below the fold** in that window: what disagrees is set apart and is
never folded, it is in sight for a car with two of them (its bottom edge about 10 px inside), and the line of what
the list says comes under it. That is the trade, made so that what the list's author has to act on is seen first;
put it to him if it is not the one he wants. Choosing another car puts the pane at its top; all held by desk
tests. A strip under the name and not a column beside the liveries: at that width a column leaves the cards one
abreast, and is itself too narrow to hold both panels in the height there is. Controls spans the two columns
the view and the pedals are in and no more (`grid-column: 1 / span 2`): across a whole wide window it would leave
them a third each, where without it they are half.
- **The car driven last is the one the page opens on**, and follows — the desk hands over the dates at its start
  and whenever the store has something new — until he chooses a car in the list. A car he chose stays until he
  drives again: a drive begun after he chose it puts the page on the car he drove, which is what he comes back
  to the desk for. Dates of drives from before the choice, arriving late, move nothing. Nor is the page moved
  under a group or the group editor, or while something is being done; it catches up when he leaves them.
  Before any date has arrived it is the first car with a livery.
- **Driven**, a button beside the filter that says whether it is pressed, narrows the list to the cars he has
  driven, the last driven first, each row saying when. One click, kept while the page is open. That list is one
  group, "Driven", not the two: newest first is an order across every car driven. Off, the list is as it was.
- **What the page asks for while nobody is looking is nothing** — but for one thing, the library keeping itself up
  to date (next). It stays mounted through a race, in the process the HUD answers to. The desk says nothing to it —
  neither that there is something to read again nor when each car was driven — unless the window is in front, not
  hidden, and Cars the page showing (`looking` in `desk.js`): the store has something new at the first lap of every
  session, which is when he is driving. What was not said is owed, and said when somebody next looks. The guards
  (`simStatus`, `tradingPaintsStatus`: a `tasklist` each) are looked at every 8 s only while the desk window has the
  focus and the page is showing, and at once when it gets it. An apply checks for itself before it writes
  (`paints/apply.js`), whatever the chips last said.
- **The library keeps itself up to date, unless he turns it off** (`App.tsx` `keepUp`; "Keep the library up to date
  by itself" under Library source; `paints.autoUpdateLibrary` in `overlay-settings.json`, where null — nothing
  chosen — is on and only a false is off; the old `autoUpdateOnLaunch` is accepted, never read and dropped by the
  next save, because it was only ever what the page held before he chose anything). **It is the Cars page that does
  it, so it begins when Cars is first opened in a run of the app** (the island is mounted then, and not before —
  `desk.js` `mountCars`; the app itself opens on the Desk page): it looks at the remote as the page starts, whatever
  is on the page and whoever is looking, then every 30 minutes while the app runs, and when the window comes back to
  the front after 30 minutes or more away — and when he turns it on. A run in which he never opens Cars looks at
  nothing; what is waiting is taken when he does. **Never while the sim is running**, asked afresh each time (`simStatus`: what the
  chips know of it is as old as the last look at the page, and the desk can be behind the sim for hours) and again
  between the look and the pull, and never while an apply or another look is under way; **never two at once**. A
  remote that cannot be reached is not said, on the page or under Library source (the desk's answer to it carries a
  note, which only a Check he pressed prints): what is shown stays as it was, nothing is pulled, and the next occasion
  tries again. That holds for a call that hangs as well: the desk gives up on a look at the remote after 2 minutes and
  on a fetch that has stalled for as long (a fetch still bringing data is left, to 20 minutes), so that one stuck call
  cannot hold every later look and Apply until the app restarts. When something is waiting it is pulled, the library is
  read again, and a toast says what arrived ("Library updated: 3 liveries added or changed."). With it off the remote
  is asked once per library, quietly, and not before a car with a livery, or a group, has been on the page for a
  second with the window in front, and the chip says updates are waiting, with an **Update now** in its detail; Check
  under Library source asks whenever he does. **Nothing on the page tells him to use git or to go elsewhere.** An
  update that cannot be taken by itself is one plain sentence on the chip, "Library not updated", that says what is in
  the way and that nothing was changed — the checkout has changes of its own, or has work the remote does not
  (diverged, ahead), or the fast-forward was refused (`paints/repo.js` `BLOCKED`, printed as it is; a failure of the
  remote by hand is the same chip; of itself, nothing). With it off, that chip keeps the **Update now** where trying
  again could help (a file held open, git not answering: `files`, `other`, `kept`) and has none where it could not
  (`changes`, `work`); with it on the library tries again by itself. **What is in the way is moved, not reported**:
  files git does not track that an incoming file would be written over — most likely the fleet build's own paints,
  which the design pipeline pushes too — are moved, whole and never deleted, to
  `%LOCALAPPDATA%\Racing Desk\library-set-aside\<yyyy-mm-dd_hhmmss>\` under their own paths in the checkout
  (`repo.pull`, the folder handed in from `main.js`), and the toast says how many and where, with a Show; if the update
  then fails they are put back. If some cannot be put back (a file held open at that moment) they stay in that folder,
  the toast says how many and where all the same, and the chip's sentence is the one that says so (`kept`) instead of
  that nothing was changed. The fast-forward is a `merge --ff-only` of what was just fetched, not a second fetch.
- **Coming back to the desk reads the car's view and pedals again** (`useRig.ts`): when the window comes to the
  front with the page showing, and once more 110 s later. The host keeps the pedals when the run ends and the
  view once the sim has gone and written its files, neither of which changes what the desk counts as new. It is
  four questions of the host on this machine (the names, the views, the pedals, the car list); the list of cars is not
  read for it.

One UI source, `apps/paints/src` (React), bundled for the desk by
`apps/paints/build-island.mjs` into `modules/desk/paints.bundle.js` + `.css` (generated, like the calc bundle) and
mounted into `#cars-root` the first time the page is shown (`desk.js` `mountCars`). The page fetches nothing: every
call goes through `apps/paints/src/bridge.ts` to the preload bridge, and the main process does the asking. In a
browser there is no bridge, and the page says it needs the app. `id="cars"` is still the Desk page's Car affinity
card; the page's own elements are `cars-page` and `cars-root`, and the nav switches pages itself rather than
following `#cars`, which would scroll the desk to that card.

Its **liveries** are the livery manager (was doooom-paints, and the Paints page): a library of paint versions
outside the sim's folders, applied by copying files in under the customer id, backing up what was there, deleting
the stale `.mip` files and warning when Trading Paints would undo it. The calls are `window.racingDesk.paints` →
`paints:invoke` → `modules/js/paints-ipc.js` (the allow-list and argument mapping) →
`modules/js/paints/` (the file operations, ported from the Rust in `apps/paints/src-tauri`). Backups live under
`%LOCALAPPDATA%\Racing Desk\paints\backups`; what it remembers is the `paints` key of `overlay-settings.json`. The
library is hundreds of paints, every command scans it, and the scan runs in the process the HUD's windows answer
to — so a paint is hashed once: the hashes are kept beside the backups (`paints\hashes.json`, `digest.keepIn`), and
an apply forgets only the folder it wrote into (`digest.forgetUnder`), never the library. The
Tauri shell in `apps/paints` still builds from the same source and goes once the page has proved itself; it has no
host behind it, so there a car's View and Pedals say that the app is not there. Use made-up customer ids in fixtures.

Its **view** and **pedals** are what the host remembers per car (`car_views`, `car_pedals`, above). The view is the
one the car was last driven with — driver height, horizon, head horizon, FOV and the seat's three offsets — with
when it was last driven, whether the view is its own or inherited from the car driven before it, and when it was
recorded; a car with none yet says so plainly, which is how every car starts. The pedals are which SmartControl
profile the car is driven with, chosen from a select, with that profile's brake in a line beside it — and whether
the profile has been edited or deleted in SmartControl since, and the brake force kept for the car — and
SmartControl Live's keys at the foot. Nothing on the page changes iRacing or the pedals. Seat offsets are signed
millimetres and the page does not say which way is forward — that has not been verified.
- **What the store knows of a car's pedals beside its profile** (`car_pedal_facts`, above; `force_at`, `has_abs`,
  `given_by`, `given_why` on every row of `pedals`, and the rows of `without_profile`) is said in plain words
  (`components/CarPedals.tsx`). Under the profile, who gave it and why: "From LightBrake — given by the rule: it
  has ABS." (or no ABS, or a formula car), "You chose this.", "You chose that this car has none."; for a car with
  no profile yet, what is waited for: "No profile yet: not driven enough yet to say whether it has ABS.", or, once
  that is known, that the rule gives it one when it is next driven — or has no `LightBrake` or `Default` in
  SmartControl to give from. As the rule does, the sentences go by the car list where it says, each fact on its own, as the rule does — "No profile yet: the
  car list says it is a prototype, and the rule gives it one from Default when it is next driven." — and by the
  data's `has_abs` for what an entry leaves out and for a car the list does not have. A GTP publishes `dcABS`,
  which carries its brake migration, so the data would say it has ABS; the list says it has none. Beside the profile's brake, the force and when it was set: "brake force 62 kg in this
  car, set Tue, Sep 15, 5:40 PM". A host from before it sent any of this shows as it did: no sentence, no date.
  Taking a profile away leaves the force on the page.
- **Controls** (`components/CarControls.tsx`, under the view and the pedals, across both) is what the car list says
  of the car, and where the car has been found disagreeing with it. In plain words: the kind ("GT car",
  "Prototype"); anti-lock, traction control and brake bias each as none, fixed or adjustable with the car's own name for
  the dial where it says more than the dial's generic one (`adjustable TCLO`, the list's words, "Traction slip", its
  title; ABS beside Anti-lock is left out; a mode dial that stands for several is the label of each); each control as
  its words (the list's, else what it is for), the car's own label beside them where it is not the same, with the words
  as its title, and its range or named positions ("Traction TCS 1 to 12, 1 is off", "Assists ABS/TC/ESC 0 Track · 1
  Sport · 2 Normal"); and "Checked against your telemetry." or "Written from the manuals; not checked against your
  telemetry yet." (beside the heading). The kind and the three dials are a line; **the rows of controls are folded**
  under "Each control, its label and values 8" and open with one press (see the Cars paragraph for why). Above them,
  **where the car and the list disagree**: each thing the check kept, as a sentence with when it was first and last
  seen ("First seen Tue, Sep 15, 5:40 PM, last seen Tue, Sep 22, 12:05 PM.", or "Seen …" where they are one moment;
  last seen is the last drive of the car that found it so, not when the host was last started), in the warning
  colour with a heading of its own, never folded. A car the list does not have says so
  ("This car is not in the car list. The HUD shows its controls as it did before there was a list.", and when the
  check first noticed) and shows nothing made up; that the list lacks a car is not counted a disagreement. In the
  list of cars a car with a disagreement carries the mark `≠ list`, beside `view` and `pedals` — and a car the list
  lacks does not. **The page is as it was where there is no list**: an app whose answer has no `controls`, a host with
  no such route, or a list with no cars in it (a build from before the list) show no panel and no mark. A list that
  could not be read is said in a Controls panel of its own ("The car list could not be read. …"), and a store that
  could not be read beside the list ("What the check has found could not be read from the host's store."), never as
  nothing found. What was said is text, however it is written.
- **Read through main.** `window.racingDesk.rig.read()` → `rig:read` (the desk window only) →
  `modules/js/rig-api.js`, which GETs `cars`, `views`, `pedals` and `controls` from Node with a 3 s limit each, only
  from a host on this machine, and answers `{ cars, views, pedals, controls }`, each `{ value }`, `{ missing: true }`
  (a 404: a host from before the route, and the page says the host is older) or `{ error }` in words — never a
  rejection, and one failing does not take the others with it. `apps/paints/src/rig.ts` shapes the answers and
  trusts none of them. Read when the page is mounted and each time it is shown again — not at desk start. The first
  three are passed on as the host gave them; **`controls` is bounded and shaped on the way** (`shapeControls`),
  being the one big answer and one from a file written by hand: at most 1.2 MB is listened to, only the keys the
  page draws are kept, each of the type it is drawn as (`positions` as `[value, name]` pairs, `kept` as
  `[{ car, remarks }]`, `[]` for a host whose answer has no `kept` and `null` only for the host's own `"kept": null`),
  no string, list or object longer than the page has room for, and an answer that is not the list is `{ error }`.
  The notes and sources of the list and what the check said in this run alone are not passed on.
- **Read again, the list of cars with it, when the desk says so** (`racingdesk:refresh`, `desk.js` `refreshCars`):
  the masthead's Refresh, which does for this page what the page's own does; the desk finding the host after finding none,
  which is how cars listed by folder while the host was starting get their names; and the store having something
  new — the desk asks the host how it stands every 30 s (`pollStatus`), and another session is a drive, so the car
  just driven is there to be looked at when he comes back. Said while another page is up, it is owed, and said
  when Cars is next shown.
- **One write**, through main because the host refuses a request that names an origin:
  `window.racingDesk.rig.bindPedals(carPath, profileId | null)` → `rig:bindPedals` → `rig-api.js`, which POSTs
  and answers `{ ok: true, car }` or `{ ok: false, error }`. The car is named by the store's own `car_path`, which
  `cars` gives; a car the store has never had in a session has none, and its select is off and says why.
  `tests/unit/rig-api.spec.mjs` reads `main.js` as text and holds both handlers to answering the desk window alone.
- **Which car a row is about** is the list's own rule: the sim's car path with `-`, `_` and case folded away
  (`rig.ts` `carKey`, as `paints/library.js` `normalise`), so the library's `mx5-mx52016` has the view kept for
  `mx5 mx52016`.
- **Last driven** is the desk's to say: `desk.js` works it out from the session rows it has read for the Desk page
  and hands it to the island (`RacingDeskPaints.setLastDriven`), each time it reads them. It is what the page
  opens on and what Driven is ordered by, as well as what a car's View says.
- **With no library** the list is still there in the desk — the install's cars and the paint folder's — once one
  has been looked for and not found, so a car's view and pedals do not wait on there being a livery anywhere.

Applying is one click — there is no dialog. The three options (spec map, read-only afterwards, other drivers' cooked
files) are set once under "When a livery is applied" and remembered; an apply that is refused says why where the
click was, and offers to go on regardless only when something stands in every apply's way (the sim running, the
downloader). **Groups** (`modules/js/paints/groups.js`; commands `liveryGroups`, `saveGroup`, `deleteGroup`,
`setGroup`) are one name for a livery across cars: a version id more than one car has in the library is a group by
itself, and the driver's own — a name and a version per car — are kept under `paints.liveryGroups`. Setting one
applies each car's version through `apply.js`, skips a car already wearing it, and carries on past a car that
fails. A car never driven has no paint folder: an apply makes it under the install's name for the car
(`installPath` in the catalogue), and only `index.js` decides that it may.

**Helmets come with the livery** (`modules/js/paints/helmets.js`; his words, 2026-09-30: "we pick a livery for a
car or a fleet, and the helmet comes along with it so whatever my last choice was sets the helmet. it's not a
single thing on its own"). The library keeps them beside the cars — `helmets/<set>/helmet_<id>.tga`, one 24-bit
TGA per colourway, and `helmets/manifest.json` naming a set per `<car folder>/<version>`, a default set, and each
set's body and art colours. **`helmets/` is at the top of his checkout, beside `cars/`, and the library the app is
given is the `cars/` folder**: so it is looked for in the library's own folder first, then in the folder the library
is in, and each set's `file` (`helmets/<set>/helmet_<id>.tga`) is relative to the folder that holds `helmets/`
(`manifest.base`). The sim reads `paint/<car folder>/helmet_<id>.tga` as that car's helmet and
`paint/helmet_<id>.tga` as the default for every car without one (the same two rules for `suit_<id>.tga`, which
nothing touches: the manifest names none). An apply copies the version's set into the car's folder **under the
app's own id, whatever id the library's file name carries**, after the car's textures and in the same step:
backed up with them (`helmetsIncluded` in the backup's manifest, so a revert knows a helmet the backup lacks was
not there), rolled back with them, put back by the same revert, said in the same result (`helmet: { set, onCar,
defaultSet, defaultPut, said }`, `said` plain sentences). Helmets are per car, so an apply never changes any other
car's helmet. **The default helmet is the manifest's default set** (`paint/helmet_<id>.tga`, worn by every car
without one of its own; shatter today) — never the set a car was just given: he chose this over "the last apply
becomes the default" (2026-09-30). An apply sees to it (`apply.defaultHelmet`, `writeDefault`): where the default
is missing or is another set, byte for byte, the manifest's set is put in place, the default that was there backed
up first under `backups\.default-helmet\<timestamp>\` (a backup with no file says there was none) and that backup
named in the car's (`defaultHelmetBackup`), so reverting the car puts the default back as well; a revert's own
safety backup does the same, so a revert is undoable whole. A default in place already is neither backed up nor
written nor said again. **Every backup of the default can be put back from the page**, including the ones no car's
backup names (a group that sets no car, a library update): `listDefaultHelmetBackups` / `revertDefaultHelmet` (the
desk's alone) back the `Default helmet` panel on the Cars page, under the same sim guard, taking a backup of the
default as it stands first; and the sentence that puts a new default in place says the old one was kept and can be
put back. A group sees to the default once for all its cars, backing it up before any car is touched and writing
it after them — asking the sim guard again first, as each car does, and leaving the default as it is when the sim
has started since — and says which (`report.helmet: { set, put, said, backupDir }`); a car already wearing its
version *and* its helmet is left alone, and the group's page says beside each car set which helmet went on it or,
where none did, why. After a library update that **changed which set the manifest names as the default**
(`repoPull` reports `helmetDefault: { was, now, changed }`, read before and after the pull) the page asks for the
default on its own (`ensureDefaultHelmet` with `was`, the desk's alone): under the same sim guard, and with the sim
running it says what is in the way and leaves it to the next apply; an update that left the default as it was does
nothing about it. A version with no
manifest entry, a set file that is missing, or a library without a manifest leaves the car's helmet as it is and
says so. Nothing in the manifest is trusted as a path: only a file under the library's `helmets/` folder is read
(no `..`, no drive, no absolute path, links followed), only a 24-bit true-colour TGA up to 2048² and no larger than
16 MiB, and the destination is always the sim folder the car's paint goes to or the paint root;
the sim guard is the apply's own. The card says which helmet comes with the version, with a swatch of the set's
body and art colours (`version.helmet` from the library scan: `null` where the library keeps helmets and names
none, absent where it keeps none; `problem` is the apply's own sentence for a set that cannot be used, which the card
shows instead of the swatch), and after an apply the sentence is under the cards. The manifest's `customer_id` is
never read, and the sentences the helmet code says (`said`, and the helmet lines in an apply's and a revert's
actions) name no file and carry no id; the car textures' action lines name their files, as they always did. Tests: `tests/unit/paints-helmets.spec.mjs`, the
helmets blocks of `paints-apply` and `paints-groups`, and the desk's. The skill that designs them is
`.claude/skills/iracing-helmet-paint`.

The list is every car the rig knows, by the sim's name for it — cars with a livery first, then the rest, with a
filter over both — and a car with no livery still shows what is installed for it and its backups. It is the
`carCatalogue` command (`modules/js/paints/catalogue.js`; the desk's own — the Rust has none, so the Tauri shell lists
the library by folder name): the library's cars, the cars in the iRacing install and the folders of the paint
directory that are cars, merged on the sim's car path, and the cars he has driven that are in none of the three.
That path is the car's folder under `<install>\cars` with the
folders joined by spaces — `cars\mx5\mx52016` is `mx5 mx52016`, and they go three deep (`dirtsprint winged 410`) — and
is also the name of its paint folder and the store's `car_path`; `-`, `_` and case fold away, so the library's
`mx5-mx52016` is the same car.
- **A car in the install** is a folder holding a `.dat` (that it is there is all that is read). 29 folders on this rig
  hold one *and* have cars beneath them — `mx5\mx5.dat` beside `mx5\mx52016`, `fordgt` beside `fordgt\gt3`. Some are
  cars themselves (`fordgt`), some only what their cars are built on (`mx5`), and the disk doesn't say which, so one
  is listed only when the store has a name for it, the paint directory a folder, or the library a livery. Nothing
  under `cars\safety` is listed: the 7 pace cars, which the store never names.
- **A car in the paint directory** is a folder the install has, or one holding `car_*.tga` / `car_*.mip` itself — and
  never `helmets`, `suits` or `cars`, where Trading Paints leaves `car_spec_*.mip` files too, nor the folder the
  library is in, whatever is lying at the top of a checkout.
- **A car he has driven that is nowhere on disk** — uninstalled since, or the install not found — is listed from
  the store's row for it (`driven` > 0), under the store's own path, not installed, with no paint folder: its view
  and pedals are kept, and were out of reach. The page says "Not installed" and offers nothing that needs the car
  on disk — nowhere for a livery, nothing installed, no backups, nothing read from the paint folder for it; its
  pedals can still be given a profile, which is the store's. A car only ever seen in a session is not listed.
- **Names** come from the local store through the host, `GET /racing-desk/data/cars` →
  `[{ car_path, name, short_name, car_id, driven, seen }]` (`modules/js/paints/car-names.js`: 3 s, a good answer kept
  for a minute, an empty list on any failure, one request however many callers are waiting). A car that has never
  been in one of the driver's sessions has no name and is listed by its folder.
- **The install** is found from `HKCU\Software\Classes\iracing\shell\open\command`, which the iRacing UI rewrites
  every time it starts — the install is two folders above that exe — then the usual Steam and default paths; it must
  be a whole path and hold a `cars` folder, and `reg` gets 3 s to answer. `paints.installDir` in
  `overlay-settings.json` names another by hand, and the page's saves keep it.

`modules/desk/calc.bundle.js` is generated from `packages/calc` on overlay start and by the desk tests — don't edit
or commit it. Rating changes aren't in telemetry: a race's iRating/SR change is read from the driver's next
session in the same licence category. Next-race suggestions are limited to the disciplines the driver actually
races (3+ races in the last year) and to what their licence can enter. Each suggestion has **Open in iRacing**: an
`iracing://web/racing/official/...` link the logged-in iRacing UI accepts (it starts the UI if needed) — the whole of
what a local app can do about joining, see `docs/race-join-findings.md`. The PDF carries no iRacing ids, so the
button lands on the Official page until the driver pastes that series' page link once (the row's "link…"); ids are
kept in `overlay-settings.json` under `raceLinks`.

The SimHub plugin build stages into `apps/plugin/racing-desk-plugin/simhub-plugin/build/`; `apps/plugin/scripts/windows/install.bat`
copies it into SimHub — **ask before running it**, it replaces the installed plugin.

## Liveries

```bash
cd apps/livery
python -m venv .venv && .venv/Scripts/python -m pip install -e ".[dev,templates,fleet]"
.venv/Scripts/livery doctor         # paths, customer id, Blender, stale mips
.venv/Scripts/livery cars scan      # the cars installed on the rig — folder names are paint folder names
.venv/Scripts/python -m pytest -q
```

Imported from prodrive-agents#19. Use the real Python (`%LOCALAPPDATA%\Python\bin\python.exe`), not the
WindowsApps `python.exe` stub, which opens the Store and hangs. `livery.yaml` names the rig's install and Blender
4.2. Builds stage in `apps/livery/build/`; `--install` copies into the paint folder, keeping a `.bak-` of what it
replaces. Sponsor art beyond the two `sample-*` placeholders, paint templates and `data/cars.json` stay out of git.

**The fleet build** (`apps/livery/src/livery/fleet`, `livery fleet status|build|panels|logos`) lays one livery —
the DOOOOM shard field, as `shatter` and `shatter-inverted` — on every car that has a paint template, and writes it
into the library the Cars page reads, where a version name shared by cars is a group by itself. It is the library's
own `design/fleet` scripts and the skills `iracing-paint-templates`, `iracing-livery-placement` and
`iracing-paint-install` (all three now in `.claude/skills/`), with the paths of the machine they were written on
taken out. The rules it is built on, each with a test in `apps/livery/tests/test_fleet*.py`:
- **Templates are iRacing's files.** They are public (no login; `data/paint_templates.tsv` holds the addresses, and
  only an `https://ir-core-sites.iracing.com/…zip` is ever fetched), they are kept in
  `%LOCALAPPDATA%\Racing Desk\templates\`, and they are never committed or passed on. Out of an archive comes the PSD
  and nothing else, under its own file name.
- **Nothing heavy while the sim runs.** The build asks before each car and waits; `panels` and `logos` refuse.
- **A paint the build did not make is never written over** — `meta.json`'s `source` says whose a version is, and
  `--force` rebuilds only the build's own. The seventeen cars painted before carry logos this machine cannot yet
  repeat.
- **The customer id is in file names only.** It is read from the library's paints, and appears in no log line,
  report or `meta.json`.
- **The field is the fleet's** (`art/doooom/shatter-field.png`, recovered from the 34 paints already in the library),
  so a car painted here matches the cars painted before it. `packages/shatter` is the engine that makes a new one
  (`IMPORTED.md` there says what of it is wired).
- **Logos wait on two things**: the sponsors' masks (`art/sponsors/masks/`, still on the machine that made them) and
  a panel map per car (`data/panels/<car>.json`), which takes a look at the car's own stock schemes.
- **Helmets are one per colourway, not one per car** (`.claude/skills/iracing-helmet-paint`, from prodrive-agents,
  its example id the made-up one): the library's `design/helmets/build_helmets.py` builds `helmets/<set>/` and
  `helmets/manifest.json`, and the Cars page installs the set a version comes with alongside the livery (see
  Helmets under Cars). Nothing here builds them yet; they are designed on the machine that made the logos.

## Dev loop (overlay design work — parked until Phase 5)

```bash
npm install
npm run dev                       # replay newest recording + overlay dev mode (CSS hot reload)
npm run dev -- --live             # overlay dev mode against live SimHub
npm run record -- --only-in-car   # record the :8889 payload while driving or in SimHub demo mode
npm run replay                    # serve a recording on :8889 (SimHub must be closed)
npm run recordings                # list recordings in %LOCALAPPDATA%\RacingDesk\recordings
npm test                          # all workspace tests
npm run test:golden               # golden frames (headless)
```

The replay format and server live in `packages/replay`; the plugin's payload is ~330 flat dotted keys
served by plain HTTP GET on `:8889/racing-desk/` (a MessagePack WebSocket on `:8890` also
exists; the overlay doesn't use it).

## Ground rules

- **Single user, local only.** No accounts, sync, telemetry upload, content packs, installer, release
  pipeline or marketing. Don't add seams for them.
- **No feature may depend on an authenticated iRacing endpoint.** The only network fetch is the
  season schedule PDF, never at race time.
- **Store and bundle no track or car data.** Track geometry comes from `Lat`/`Lon` in the user's own
  `.ibt` files; the sim's `.dat` packs are not decoded.
- **Keep the `localhost:8889` contract byte-identical** while hosts move — it's the seam between the
  engine and everything that consumes it.
- **No CI.** Everything runs locally; GitHub is source control and backup.

## Rig facts worth knowing

- **Headless Chromium on this machine draws in software.** Any browser started for a test, a screenshot or a script
  launches with `--disable-gpu --use-angle=swiftshader --use-gl=angle`: `apps/overlay/tests/software-browser.mjs`
  exports them (`SOFTWARE_GL_ARGS`), the Playwright config takes them, and every `chromium.launch` call must, since a
  script that launches with no flags goes round the config (`tests/unit/software-browser.spec.mjs` fails for one that
  does). The NVIDIA driver stopped responding three times on 2026-09-29 (Display event 4101 at 20:38, 23:00 and 23:01)
  while headless pages of the WebGL HUD were being screenshotted, once leaving the screen in a mode the monitor could
  not show. Never launch a browser on the graphics card here, and none while iRacing is running.
- iRacing install: `C:\Program Files (x86)\Steam\steamapps\common\iRacing` (the uninstall registry
  key points at a stale copy on `D:`).
- Telemetry: `Documents\iRacing\telemetry\*.ibt` — ~3k files, ~100 GB since Oct 2025.
- SimHub: `C:\Program Files (x86)\SimHub\` with the plugin installed.
- `%APPDATA%\iracing-electron\` holds iRacing login state — never dump its contents.
