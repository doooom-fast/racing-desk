# Listing and joining official sessions from inside Racing Desk — findings

> **Status:** researched 2026-09-18 on the rig, read-only. Nothing was launched, clicked or logged into.
> Feeds Phase 4 (Race Now) in [`local-first-refactor-plan.md`](local-first-refactor-plan.md).
> Constraint as set that day: our code never authenticates to iRacing, but relying on the *running,
> logged-in iRacing UI* is allowed.

**Headline.** There is no local API, port, file or deep link that lists open sessions, registers, or
launches the sim on behalf of a third party. What a local app can do without touching credentials is
(1) compute "what's scheduled next" from the PDF we already parse, and (2) hand the user into the
exact page of the logged-in iRacing UI with an `iracing://` link. Anything that reads real
registration counts or presses Register/Join must either scrape the running UI's window (UI
Automation exposes the page — verified read-only) or log in itself (ruled out). Launching the sim
into a session ourselves is not feasible: the launch parameters are minted per launch by iRacing's
backend and handed to the sim through a private JSON-RPC hand-off.

State of the rig during the research: the UI (`iRacingUI.exe` 8.17.0, sim build 2026.09.10.02) was
running and logged in; Steam was not running; the sim was not running. The UI's own JS was extracted
from its asar to a scratch folder, grepped, and deleted.

## 1. Machine findings

| Item | Finding | Where |
|---|---|---|
| `iracing://` handler | Registered, HKCU only. `(Default)=URL:iracing`, `URL Protocol=""`, command `"<install>\ui\iRacingUI.exe" "%1"`. No HKLM entry; no other `iracing-*` scheme on this machine. | `HKCU:\Software\Classes\iracing\shell\open\command` |
| Who registers it | The UI itself at every start: `app.setAsDefaultProtocolClient("iracing")` (or `iracing-<env>` for secure/alpha/beta/gamma/staging builds). | `ui\resources\app.asar` → `compiled/main.js` |
| Deep-link grammar | Regex `^iracing(?:-(secure\|alpha\|beta\|gamma\|staging))?://(.*)$`. Path is validated after stripping an optional `web/`, `commercial/`, `payments/`, `demo-drive/` prefix and must start with `help`, `racing`, `receipt`, `settings` or `shop`; otherwise logged as "Tried to open invalid route via protocol" and ignored. Accepted path (prefix kept, `?query` preserved) becomes `pathname`/`search` on `https://members-ng.iracing.com/web`. Cold start: initial URL = deep link. Warm: single-instance lock → `second-instance` → `loadURL(...)` + restore/focus. | `main.js` |
| Known public route shape | `https://members-ng.iracing.com/web/racing/official/series-list/6273/` (id semantics unverified). So the link form is `iracing://web/racing/official/series-list/6273/`. The `web/` prefix matters: without it the pathname replaces `/web`. | search result; code |
| Processes | `iRacingUI.exe` (main + 7 Electron children), `iRacingService64.exe` (Windows service "iRacing.com Helper Service", LocalSystem, auto-start). No `--remote-debugging-port`/`--inspect` on any command line. | `Get-Process`, `Win32_Process` |
| Listening ports | `0.0.0.0:55000` TCP + UDP `53575–53578` owned by the UI = iRacing Connect / NVIDIA CloudXR streaming for Apple Vision Pro. `127.0.0.1:32034` = `iRacingService64` legacy HTTP helper: the UI only TCP-probes it and fetches `/get_localservice_dir`; the service's strings show JSONP-style replay data and `CreateProcessAsUserW`/`-join_server` (the old website's launch path). Neither is a session or control API. | `Get-NetTCPConnection`, `main.js`, strings |
| Sim ↔ UI channel | Per launch the UI opens a JSON-RPC (`jsonrpc-lite`) TCP server on an ephemeral `127.0.0.1` port and passes it as `-ui_port=`; the sim calls `getTask` (receives the whole task object) and `simEnding`. | `main.js` (`launchSim`), sim strings |
| UI hardening | argv blocklist `--remote-debugging-port`, `--inspect`, `--inspect-brk`, `--load-extension`, `--dev-tools` → "Exiting application due to unsupported configuration", `app.exit(1)`. Electron fuses: RunAsNode off, EnableCookieEncryption **off**, NodeOptions off, NodeCliInspect off, EmbeddedAsarIntegrityValidation on, OnlyLoadAppFromAsar on. Renderer: `sandbox`, `contextIsolation`, no `nodeIntegration`; the page is remote (`https://members-ng.iracing.com/web`), so all racing logic is web code not on disk. | `iRacingUI.exe` fuse bytes; `main.js` |
| What the web page can ask the shell | `window.interop.*`: `startSim(task, cb, hideLoadingScreen, displayMode)`, `openInBrowser`, AI roster/season CRUD, paint/spec-map helpers, viewer (3D car), `getHardware`, zoom; plus a tRPC router: `isLocalServiceRunning`, `startService`, `stopService`, `getPingTimes`, `setPingServers`, `getVersions`, `isCloudXRSupported`, `isAVConnected`, `stopMsrTelemetryUpload`, open-folder mutations. Reachable only from the renderer, over Electron IPC — no socket. | `compiled/preload.js`, `main.js` |
| Non-credential artifacts of what the UI fetched | None. `%LOCALAPPDATA%\iRacing\` holds `uiResources\` (car images), `internal\telemetry_status.json` (upload bookkeeping), `paint`, `replay`. `Documents\iRacing\logs\main-ui.log*` is bunyan JSON with telemetry-upload, sim-status and relayed web-error lines — no session data and no launch command at the default level. `%APPDATA%\iracing-electron\` (directory names only): `Cache` (last write 2026-08-24, so dynamic responses aren't disk-cached), `Code Cache`, `Network`, `Local Storage`, `Session Storage`, … — never read; cookie encryption being off is one more reason not to. | directory listings only |
| UI Automation (read-only probe) | The renderer's accessibility tree **is** exposed once a client touches it: a `Document` with 419 descendants (172 Text, 92 Group, 62 Image, 47 Hyperlink, 18 Button, 16 ListItem, Tab/TabItem, StatusBar), 280 named, 135 invokable. Nav labels: Home, Racing, Official, Hosted, Leagues, Spectate, Results & Stats, Help, Settings, Shop, "Test Drive". On the page showing at the time, text nodes matched time-of-day (3) and "registered" (1); no "SOF". | `System.Windows.Automation` from PowerShell |
| Sim launch command (from code, not observed) | `"<install>\iRacingSim64DX11.exe" "-ui_port=<port>" ["-uses=1"] ["-display_mode=<mode>"]` and either `"-need_eac"` (online) **or**, when the anticheat is EOS, the exe becomes `start_protected_game.exe` with `"-access_token=<token>"` from `task.parameters.commandLineOptions`. The UI refuses a second launch while one is up. The UI log shows the EOS branch is the one taken on this rig. | `main.js` (`buildLaunchCommand`, `launchSim`); `main-ui.log` |
| Task vocabulary the sim knows | `legacyJoinServer`, `legacyJoinServerWithAI`, `legacyPlayReplay`, `legacyRunAIWeekend`; `commandLineOptions` is a query string (keys seen: `access_token`, `local`, `time_attack`); sim switch table also lists `-join_server`, `-auth`, `-landing_url`, `-exit_on_failed_connect`, `-fuel_limit=`, `-weight_penalty=`, `-power_adjust=`, `-loadsavegame`, `-playreplay`, `-autocfg`, `-controls`. No documented public form of a join invocation exists. | strings in `iRacingSim64DX11.exe`, `main.js` |

### How "Join" works today, end to end

1. The logged-in web app (members-ng, inside the Electron window) registers the driver through its
   own authenticated endpoints (not the `/data` API — `/data` has no register/join call at all).
2. When the session opens, the web app calls `interop.startSim(task, …)`;
   `task.parameters.commandLineOptions` already contains backend-minted material (join/auth, EOS
   access token).
3. The shell spawns the sim with `-ui_port`, the sim connects back, pulls the task via JSON-RPC,
   joins the race server, reports `simEnding`.

So a third party cannot launch the sim into a chosen race: step 2's inputs come from iRacing's
servers for that login, and the sim's `getTask` hand-off is a private contract. Any join from Racing
Desk has to end in the iRacing UI doing steps 1–3.

## 2. What the `/data` API would provide (out of scope, for the record)

- `GET /data/season/race_guide?from=&include_end_after_from=` → `sessions[]`: `season_id`,
  `series_id`, `race_week_num`, `session_id` (nullable), `start_time`, `end_time`, `super_session`,
  **`entry_count`**. No SOF, no track/car (join on ids).
- `GET /data/series/seasons?include_series=` → seasons with `schedules[]` incl.
  `race_time_descriptors`, `race_week_cars`, `track`, lengths — what the PDF gives us, plus the
  **ids** we lack.
- `GET /data/season/spectator_subsessionids_detail` → live `subsession_id`/`session_id`/`season_id`.
- `GET /data/hosted/sessions`, `combined_sessions`; `GET /data/league/season_sessions`;
  `GET /data/results/search_series` (past results only).
- Auth: username + encoded password to members-ng, or OAuth2; 2FA accounts can't use legacy auth.
  Nothing registers or launches.

Ruled out by the ground rules, and it wouldn't close the join gap anyway.

## 3. Ranked options

| # | Option | Gives | Risk / fragility | Effort |
|---|---|---|---|---|
| 1 | **Schedule-derived "next starts"** — from the parsed PDF compute upcoming start times per series/week in local time, filtered to the driver's disciplines/licence. | LIST of *scheduled* sessions (no registrations, no SOF). | None. Cadence in the PDF can be irregular (super sessions). | Small |
| 2 | **Deep-link hand-off** — an "Open in iRacing" action that shell-opens `iracing://web/racing/official/series-list/<id>/` (or `iracing://web/racing/official/` without an id). The running UI navigates; if not running, the handler starts the UI and loads the link after login. | One click from Register/Join on the right page. Launch happens through the UI's own flow. No data back. | Low ToS risk (iRacing's own scheme). SPA routes unversioned; needs `season_id`s the PDF doesn't carry. **Not verified by launching.** | Small + an id source |
| 3 | **Read the logged-in UI via UI Automation** — navigate with #2, then read the accessibility tree for session times and registered counts; optionally `Invoke` Register/Join. | LIST with real registered counts; REGISTER/JOIN by pressing the UI's own buttons. | ToS grey-to-high (EULA language on bots and software that "intercepts, mines or collects information" through the service); breaks whenever the web app's DOM changes; page must be loaded. | Medium-high |
| 4 | Sim/UI process awareness (already have via the SDK) | Wording of buttons; not a session source. | None | Trivial |
| 5 | CDP/DevTools automation of the UI | Race guide JSON + DOM control. | Blocked in code and by fuses; circumvention. **Ruled out.** | — |
| 6 | Launch the sim ourselves (`-ui_port` + our own `getTask`, or `-join_server`) | Would launch. | Task contents are backend-minted per login; anti-cheat wrapper required. **Ruled out.** | — |
| 7 | Own login to `/data` or members-ng | LIST with `entry_count`, ids. Still no register/launch. | **Ruled out** by the ground rules. | — |

## 4. Recommendation — first slice

> **Built 2026-09-18** (items 1–3): the desk's next-race suggestions each carry "Open in iRacing", which hands
> `iracing://web/racing/official/series-list/<id>/` — or `iracing://web/racing/official/` while no id is known —
> to the OS through the overlay's `open-external` (allowlisted in `apps/overlay/modules/js/external-links.js`).
> Ids come from a pasted series page link, kept in `overlay-settings.json` under `raceLinks`. The route with an
> id is unverified until a real link is pasted. The id-less route was tried on the rig with the UI closed: the
> link cold-started `iRacingUI.exe`, which logged in and accepted the route (no "invalid route" in `main-ui.log`).

1. **List**: upcoming official starts for the next few hours from the stored schedule (option 1),
   reusing the discipline/licence filters. Label them as "scheduled" — no registered counts, no SOF.
2. **Act**: per row an "Open in iRacing" action that ShellExecutes `iracing://web/racing/official/…`;
   nothing else. Detect whether `iRacingUI.exe` is running only to word the button. Don't try to
   launch the sim.
3. **Id gap**: ship with the id-less fallback and let the user paste a series/season link from the UI
   once per season (the S4 UI added shareable links for series pages; their URLs should carry the
   ids). Store `series → id` in the local DB.
4. **Verify by hand once**: with the UI running, open one deep link and confirm it navigates; then
   try a cold start. Record the routes that work here.
5. **Defer** option 3 behind an explicit decision: it is the only way to show registrations without
   logging in, and iRacing's EULA language is against it. If pursued: a spike with a kill switch,
   read-only first, never touching credential files.

## 5. Unknowns

- Exact SPA routes under `/web/racing/` beyond `official/series-list/<id>/`; whether any route opens a
  specific session's register dialog; whether `6273` is a `season_id` or `series_id`.
- Whether a cold-start deep link survives the OAuth login redirect (the code loads it as the initial
  URL; not verified).
- Whether the UI's Chromium disk cache holds race-guide JSON (not readable under the rules; the
  timestamp suggests no).
- Any `/data` source of live SOF (`race_guide` only has `entry_count`).
- The `task` JSON schema for `legacyJoinServer` and the full `commandLineOptions` key set.
- Whether UIA exposes the Race Guide's per-row registered counts in a stable, parseable form.

## 6. Side finding

`main-ui.log` shows the iRacing UI uploading a second, smaller per-session `.ibt` that the sim writes to
`%LOCALAPPDATA%\iRacing\internal\` (not a copy of `Documents\iRacing\telemetry\`, which is untouched) to an
iRacing S3 bucket named for driver-training research, then deleting it. It is iRacing's anonymised race-data
collection — on in select official series unless turned off under **Settings > Preferences** in the UI — not
Racing Desk. Details and the ledger on this rig:
[`local-first-phase0-findings.md`](local-first-phase0-findings.md) §3, "The research upload".

## Sources

- https://support.iracing.com/support/solutions/articles/31000178872-iracing-apple-vision-pro-quick-start-and-troubleshooting-guide
- https://support.iracing.com/support/solutions/articles/31000140706-what-ports-and-ip-addresses-does-iracing-use-
- https://support.iracing.com/support/solutions/articles/31000179517-2026-season-4-initial-release-notes-2026-09-09-01-
- https://www.electronjs.org/docs/latest/tutorial/fuses
- https://www.electronjs.org/docs/latest/api/command-line-switches
- https://pkg.go.dev/github.com/riccardotornesello/irapi-go/pkg/api (race_guide, hosted/sessions, league/season_sessions, series/seasons, spectator_subsessionids_detail)
- https://adrianjsclark.github.io/aydsko-iracingdata/api/Aydsko.iRacingData.IDataClient.html
- https://github.com/jasondilworth56/iracingdataapi
- https://members-ng.iracing.com/web/racing/official/series-list/6273/
- https://www.iracing.com/terms-use-eula/
- https://greasyfork.org/en/scripts/13049-iracing-auto-join
- https://simlauncher.com/iracing-launcher/
- https://rosters.iracing.com/seasons/members-seasonListing.txt (AI season manifest; no official ids)
