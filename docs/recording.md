# Recording

OBS records; Racing Desk drives it, writes the telemetry beside the file, and shows what is going on everywhere but the
HUD. Decided 2026-09-30 ("refactor the recording using obs as the main recording and composition surface"); this is
what is built as of stage 1 and what is coming. The Electron recorder, its ffmpeg, the `.rcpdv` bundles and the old
"native" backend are gone.

## What OBS does

- Captures the sim and the HUD through his own scene collection and profile (`sim race 2k`, `Untitled`), which Racing
  Desk never writes to, except the three profile keys below when he presses **Set up OBS**.
- Encodes and writes the file: NVENC as his profile has it, as **Hybrid MP4** once set up (crash-safe files, and the
  format chapters need).
- Keeps the replay buffer (20 s), once set up, for the instant replay of a later build.

## What Racing Desk does (`apps/overlay/modules/js/obs/`)

- **Talks obs-websocket 5 to OBS** on `127.0.0.1:4455` (`client.js`), over a WebSocket client of its own (`ws-client.js`,
  `ws-frames.js`: Electron's Node has none, and `ws` is not in the tree). It tries every 5 s while OBS is closed, which
  is how OBS being open is noticed; `tasklist` runs only on a press. The password is read from OBS's own settings file
  (`%APPDATA%\obs-studio\plugin_config\obs-websocket\config.json`) when OBS asks for it, or is the one he typed on the
  Recording card, kept with Electron's safeStorage and stripped from every page's copy of the settings like the iPad's
  key. It is held in memory by nothing, and the log says only `password: set` or `none`.
- **Mirrors the recording** (`recording.js`): `RecordStateChanged` is followed whoever pressed, so his own Ctrl+Space
  recordings in OBS are seen the same as ones Racing Desk asked for. A recording running when OBS answers is taken over
  (`GetRecordStatus`, its path from `GetOutputSettings` on `adv_file_output`); what STARTED or STOPPED says while that is
  being asked wins over it, and `GetRecordStatus` saying nothing is recording, at any of its looks every 10 s, ends a
  recording whose STOPPED was missed.
- **A dropped connection is not OBS going away.** OBS restarts its server when he saves its WebSocket settings, a session
  can be kicked, a socket cut. The recording goes on in OBS, so it goes on here: still Racing Desk's, still in the state
  file, its sidecar still being written. It ends when OBS says so — STOPPED, `ExitStarted` (OBS stops its own outputs on
  the way out), or `GetRecordStatus` finding nothing recording. After half a minute with no connection the card stops
  saying it is recording, and the state file is kept: the next connection finds the recording still going and takes it
  over as Racing Desk's own, its sidecar gone on in (a `resumed` line, no second header).
- **Knows which recordings are its own**: the file STARTED named — its key, split or not — in
  `%APPDATA%\Racing Desk\recording-state.json`, with the file being written now (a split moves it; `RecordFileChanged` is
  followed, and OBS's own "last file" at STOPPED, which for a split recording is the first file again, does not point back).
  Ownership is claimed when StartRecord is sent and kept for a minute, so a STARTED that comes late, a quit between
  StartRecord and STARTED (it waits for STARTED, then stops it), and a connection cut in between all end with the recording
  Racing Desk's. Quitting Racing Desk — closing the desk, the tray's Quit, the Ctrl+Shift+G relaunch — stops the recording
  it started (StopRecord, STOPPED waited for 3 s at most) and leaves OBS and his own recordings alone; with OBS out of
  reach it cannot ask, and keeps the state file for the next start. A press of Stop stops whatever is recording.
- **Writes the telemetry sidecar** beside the file (`<video>.telemetry.jsonl`, `modules/js/telemetry-sidecar.js`,
  schema in [telemetry-sidecar-schema.md](telemetry-sidecar-schema.md)): the main process polls `:8889/racing-desk/`
  at 30 Hz while OBS records a live sim session, so a page reload or the HUD switched off no longer stops the frames.
  Every frame carries the sim's own `SessionNum` and `SessionTime`, which the host and the SimHub plugin now send
  (`DataCorePlugin.GameRawData.Telemetry.SessionNum` / `SessionTime`, iRacing's alone, never in demo). Only a recording
  made while a sim session is live gets one; his other collections' recordings are left alone.
- **Keeps a floor under the disk**: no recording starts below about 20 GB free on the drive OBS records to, one Racing
  Desk started is stopped at about 5 GB and said so in one sentence, and the card shows hours left at the measured rate
  (his profile's 100 Mbps is 43 GB an hour; OBS itself stops only at 50 MB, with a dialog over the sim). The drive is the
  one OBS will write to — asked of OBS (`GetRecordDirectory`), else the folder its profile says, else Racing Desk's own
  setting — and a folder that is not made yet is measured on the nearest one above it. A drive that cannot be measured at
  all is a recording that does not start, said in a sentence; the floor is never switched off in silence.
- **Starts OBS** only on a press — Record from the desk, the tray or the Stream Deck while he is out of the car, or
  "Open OBS" — detached, minimised to the tray, from its own `bin\64bit` folder, with `--minimize-to-tray` and
  `--disable-updater` and nothing that names a collection, a profile or a password (OBS logs its whole command line).
  Never from a key in the car (the HUD says "OBS is not open", and only when `tasklist` says OBS is not running: with OBS
  open and its WebSocket off, or refusing the password, nothing goes on the HUD, which is filmed), never from
  auto-record. Never a second OBS: a `tasklist` that cannot say whether OBS runs is "not known", and then nothing is
  started and, for Set up OBS, nothing of OBS's is written; presses that come together share one start. Never an OBS that
  could not answer: with its WebSocket off (or no settings file yet) a press says to press Set up OBS first. OBS is never
  quit. `launcher.js` holds all of it.
- **"Start OBS with Racing Desk"** (off unless he turns it on) waits for the telemetry to answer, up to a minute, and
  starts OBS only if it says he is out of the car; never from the relaunch Ctrl+Shift+G makes (`--no-obs-start`), which
  happens in the car, where a dialog OBS opens at its start lands over the sim.

## Where it is seen

- **The desk's masthead**, on every page and at every width: a pill with the state and one button, Record or Stop.
  Under 1280 px wide the pill is its dot and its button (the words are in its title), and room is made for it: the
  brand's name goes (the mark stays) and the gaps narrow; under 1100 px the freshness line keeps its Refresh button and
  gives up its words (they are its tooltip). The masthead is no taller for the pill at any width. The pill's clock ticks
  without the button being replaced, so a click is never lost to a tick.
- **The Recording card** is not rebuilt for changes that read the same (OBS being looked for again every five seconds is
  not announced), and one that has to change keeps what he is typing in the password field, with its focus.
- **Settings → Recording**: the state in a sentence, Record/Stop, Open OBS (while OBS is not answering), Set up OBS
  (while something is missing, with one sentence saying what it will change), Open folder, Choose folder, the two
  switches ("Start OBS when I press Record", on; "Start OBS with Racing Desk", off), and the password field only when
  OBS wants a password Racing Desk does not have.
- **The tray**: Record / Stop recording, Open OBS.
- **The Stream Deck**: Toggle Recording (and the rest of its buttons), through the app's action route on `:9090`, **which
  answers only while the iPad view is switched on** until the always-on loopback listener of stage 3 (with the iPad view off
  every key shows a cross). The plugin shows no recording state on the key yet either — only a tick or a cross after a press;
  the key's state comes with that listener (`/api/status`). A recording press waits up to 45 s for the answer (OBS started,
  its WebSocket up, the recording begun), the other keys 3 s. Open Settings opens the desk's Settings page. The plugin is
  built by `npm run build` (`apps/overlay/streamdeck/build.mjs`, esbuild, no SDK: it speaks the Stream Deck app's own
  WebSocket protocol) and installed at every app start from the unpacked copy (`modules/js/streamdeck-install.js`); its
  manifest does not turn Node's inspector on.
- **In the car**: Ctrl+Shift+V records or stops (OBS open), Ctrl+Shift+B and Ctrl+Shift+P answer that instant replay
  and TV shots come with a later build.
- **Never on the HUD.** OBS films the screen the HUD is on, so a red dot or a timer there would be in every video. The
  HUD may show two sentences, for two seconds: "OBS is not open" and "OBS didn't start recording".

## Set up OBS

One press. While OBS is closed it writes `server_enabled: true` into obs-websocket's `config.json` (atomically, changing
nothing else), reads the password from the same file into memory, and writes into the current profile's `basic.ini`
`[AdvOut] RecFormat2=hybrid_mp4`, `RecRB=true`, `RecRBTime=20` and `RecFilePath=<folder>` (and `[SimpleOutput] FilePath`),
with the file's BOM and every other line kept. While OBS is open the profile keys go through `SetProfileParameter` and
`SetRecordDirectory`, which OBS saves at once and takes up at its next start; the WebSocket cannot be switched on from
there (OBS rewrites that file from memory), so with OBS open and its WebSocket off the card says to quit OBS and press
again, and a `tasklist` that cannot say whether OBS is open leaves OBS's files alone (OBS writes them from memory when it
closes). Never a hop through another profile. The card says what will change for his own Ctrl+Space recordings, from what
is really changing: that they become Hybrid MP4 (the replay buffer changes nothing of theirs), and that they go to the new
folder. OBS then answers on port 4455 to anything on his network that knows the password — said once on the card. A password
read from OBS's file replaces one he typed earlier.

The recording folder is `D:\Racing Desk\Recordings` while there is a D: drive (`recordingFolder` in
`overlay-settings.json` names another; C: holds about ninety minutes at his bitrate). OBS's own recording folder is
pointed at it so that, in the next stage, every file move is a rename on the same drive.

## Settings (`overlay-settings.json`, migrated once by `modules/js/recording-settings.js`)

`recordingFolder`, `recordingAutoRecord`, `recordingAutoStopOnPit`, `recordingInstantReplay`,
`recordingInstantReplaySeconds` (20), `recordingChapters` (true), `obsStartOnRecord` (true), `obsStartWithApp` (false),
`obsPath` (null: the default install), `obsHudSource` (false), `obsWebSocketPasswordEnc` (only if typed; never sent
to a page), `recordingSettingsVersion` (2). The Electron recorder's keys and the "native" backend's port are deleted.

## Coming (not in this stage)

- **Auto-record**: in a race from the green flag (`SessionState` Racing while he is in the car), in practice and
  qualifying from pit exit; stop on a new session number, at the end of the race (5 s after), or when he leaves the
  car; never on a state change within a session; debounced by time. It stops only its own recordings.
- **Instant replay**: the replay buffer started when he gets in the car, saved on Ctrl+Shift+B / the Stream Deck / the
  tray, with the last seconds of telemetry beside the clip.
- **Chapters** per lap, incident, pit stop and place, through `CreateRecordChapter` (Hybrid MP4), read back from the
  finished file's chapter track for the sidecar's exact offset; plain MP4 and crash-truncated files aligned from the end.
- **Folders**: one per recording under the folder above (video, sidecar, replays, TV takes), moved after STOPPED.
- **TV shots**, rebuilt on the iRacing SDK's own replay commands through the host, from the desk's race detail.
- **The HUD as an OBS browser source**, behind a switch, off by default.

## First run (what no test here can check)

With OBS closed, press Set up OBS on the desk and read what it says. Press Record: OBS should appear in the tray and the
pill should read "Recording"; drive a lap; press Stop; the `.mp4` and the `.telemetry.jsonl` should be side by side in
`D:\Racing Desk\Recordings`. Then, with OBS open, press Ctrl+Space in OBS and watch the desk's pill follow it. In OBS's
mixer, check that the game audio meter moves (the Volt 2 game-audio device failed to start on 2026-09-29).
