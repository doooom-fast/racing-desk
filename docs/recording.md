# Recording

OBS records; Racing Desk drives it, writes the telemetry beside the file, records by itself, keeps the replay buffer
with the car, writes chapters, files each recording in a folder of its own, and shows what is going on everywhere but
the HUD. Decided 2026-09-30 ("refactor the recording using obs as the main recording and composition surface"); this
is what is built as of stage 3 and what is coming. The Electron recorder, its ffmpeg, the `.rcpdv` bundles and the old
"native" backend are gone.

## What OBS does

- Captures the sim and the HUD through his own scene collection and profile (`sim race 2k`, `Untitled`), which Racing
  Desk never writes to, except the three profile keys below when he presses **Set up OBS**.
- Encodes and writes the file: NVENC as his profile has it, as **Hybrid MP4** once set up (crash-safe files, and the
  format chapters need).
- Keeps the replay buffer (20 s), once set up: the instant replay, saved as a clip of its own.
- Writes the chapters Racing Desk sends into the file (Hybrid MP4), and its own "Start" chapter at 0.

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
  Racing Desk's. Quitting Racing Desk — closing the desk, the tray's Quit — stops the recording it started (StopRecord,
  STOPPED waited for 3 s at most) and leaves OBS and his own recordings alone; with OBS out of reach it cannot ask, and
  keeps the state file for the next start. **The Ctrl+Shift+G relaunch is not a quit** (`leaveForRelaunch`): the
  recording, and the replay buffer, Racing Desk started run on in OBS; the state file says both are its own (`replayOurs`,
  and that alone when nothing of its own is recording); the sidecar is closed with the reason; and the relaunched app —
  back within seconds — takes them over when OBS answers: the sidecar gone on in from the same file (a `resumed` line, no
  second header), the buffer stopped when he leaves the car, so a restart mid-race leaves the race one video with one
  sidecar. A press of Stop stops whatever is recording.
- **Writes the telemetry sidecar** beside the file (`<video>.telemetry.jsonl`, `modules/js/telemetry-sidecar.js`,
  schema in [telemetry-sidecar-schema.md](telemetry-sidecar-schema.md)): the main process polls `:8889/racing-desk/`
  at 30 Hz while OBS records a live sim session, so a page reload or the HUD switched off no longer stops the frames.
  Every frame carries the sim's own `SessionNum` and `SessionTime`, which the host and the SimHub plugin now send
  (`DataCorePlugin.GameRawData.Telemetry.SessionNum` / `SessionTime`, iRacing's alone, never in demo). Only a recording
  made while a sim session is live is filed — its sidecar, its chapters, its folder; his other collections' recordings
  are left alone. His own Ctrl+Space recordings made during a live session are filed the same.
- **Records by itself** ("Record by itself", on; `modules/js/obs/auto-record.js`, pure, fed the payload main.js polls
  twice a second in the car): in a race from the green flag — iRacing's SessionState reaching Racing while he is in the
  car; the grid, the warm-up and the formation lap start nothing, and a pit-lane start sees the same flag — and in
  practice, qualifying and a warm-up from pit exit. It stops on a new session number, five seconds after **his own**
  finish in a race, and when he leaves the car; never on a state change within a session, so a red flag ends nothing.
  His finish is the chequered flag being out and his lap count having gone up since, which is him crossing the line:
  the flag, and SessionState 5, are the session's and come when the leader finishes, so a car a lap down still has a
  lap to drive, and the cool-down (SessionState 6) is only the backstop. Practice and qualifying have no end of their
  own — time runs out during a flying lap and the flag comes out in it — so only a new session or leaving the car
  stops those. Each start and stop is held about a second by the clock. It stops only the recordings it started
  (`auto` in the state file): one he began on the desk or with Ctrl+Space runs on. A green flag is good once per stint,
  so a Stop he presses mid-race is not undone a second later. It never starts OBS and never asks tasklist (that is for
  presses): with OBS closed the HUD says "OBS is not open" once per session, and the start is tried again no sooner
  than half a minute on while the flag holds. When OBS answers a start and does not carry it out (its Settings window
  left open, a folder that is gone: a dialog over the sim at every try) it asks once, says "OBS didn't start
  recording" once, and does not ask again that session; a new session, a reconnect, a new stint in the car or any
  recording event from OBS lets it try again. A gap in the telemetry is not him leaving the car — main.js's in-car
  signal turns false after three silent seconds — so for a minute of silence the keeper goes by what the last payload
  that answered said of him.
- **Keeps the replay buffer with the car** ("Instant replay", off unless he turns it on): `StartReplayBuffer` when he
  gets in the car and a live sim session has him in it (the demo is "in the car" too and gets none), `StopReplayBuffer`
  when he gets out (or the switch goes off) if Racing Desk started it; one OBS started itself is left alone. The buffer
  is Racing Desk's from the answer to its StartReplayBuffer until OBS's STOPPED, no earlier: STARTING and STOPPING say
  the output is not active (obs-websocket's `outputActive` is false for every state but STARTED), and STARTING comes
  after the answer, so going by the flag would drop ownership at once and leave the buffer, its encoder and the 30 Hz
  poll running after he leaves the car and after Racing Desk quits. The Ctrl+Shift+G relaunch leaves a buffer Racing
  Desk started running and hands it to the relaunched app through the state file (above). A start that failed is tried
  again no sooner than a minute on; one that did not fail is not held back. With no replay buffer in OBS the card says to press Set up OBS —
  or, when OBS's profile has one (Set up OBS ran while OBS was open), that instant replay starts the next time OBS opens
  — and it is not asked for again and again. **Save replay** — Ctrl+Shift+B in the car, the tray, the Stream Deck, the
  card — is `SaveReplayBuffer`; the clip OBS saves (`Replay <date>.mp4`, by his profile's prefix) gets a sidecar of its
  own from the last seconds of telemetry kept in memory while the buffer runs and he is in the car (only the keys a
  frame is made of, for as long as OBS's own buffer — its RecRBTime, read from the profile — and ten seconds more, so
  that the wait for the clip to be written does not shorten it), lined up from the clip's end (its duration read from
  the file; the moment the save was asked is its end), and is moved into the recording's folder, else into `Replays`
  under the recordings folder. A clip saved with no sim session live is left as it is.
- **Writes chapters** ("Chapters", on): a chapter per lap ("Lap 12"), incident ("Incident ×2"), pit in and out, and
  place gained ("P5 → P4"), sent with `CreateRecordChapter` as the sidecar finds each, while the recording is not
  paused; no "Start" chapter (OBS adds its own). Hybrid MP4 alone takes them: a refusal ends them for that file —
  unless OBS is paused, which it answers the same way (702) before the PAUSED event may have arrived, and which is
  asked about first. Each is kept in the sidecar's summary with the t it was sent at, once OBS has taken it: one that
  never got there (the connection dropped) is not listed, or it would be paired with the wrong chapter of the file.
- **Files each recording** (`modules/js/obs/filing.js`): one folder per recording under the recordings folder,
  `<date> <track> <car>` (`2026-09-29 22-13 Zandvoort Porsche 911 GT3 Cup (992)`; the date alone where the sim did not
  say), made when the sidecar begins and only when the file OBS writes is on the recordings folder's drive, so that
  every move is a rename. After STOPPED the file is waited for until its size has held still for two seconds, then
  moved with its sidecar into the folder, where the session's replay clips already are. Across drives nothing is
  copied (a 24 GB file would take minutes): the file stays where OBS wrote it, its sidecar beside it, and the card says
  so. A video whose sidecar cannot follow it (a lock on the sidecar that outlasts the tries) goes back where OBS wrote
  it and the card says why, since the editor pairs the files of a folder; a folder made for a recording that went
  nowhere is not left empty. OBS quitting mid-recording (`ExitStarted`) files what it wrote at once. A recording whose
  end OBS never told — it crashed, or it was stopped while the WebSocket was down — is filed when OBS next answers and
  is not recording that file, or, for one of Racing Desk's, when Racing Desk next starts and finds it in the state
  file: moved with its sidecar, lined up from its end — the last moment OBS was seen recording: the connection closing,
  the last look every ten seconds, kept in the state file as `seenAt` — marked approximate, and one more summary line
  (`refiled: true`) added to the sidecar. An unfinished Hybrid MP4 has no chapters to read back. **Quitting waits for a
  recording that has just stopped to be filed**, up to eight seconds (the file holds still for two, and is moved), so
  that closing the desk a moment after he gets out of the car does not leave the file in OBS's folder with a sidecar
  that has no summary.
- **Lines the telemetry up with the video** (`modules/js/obs/mp4-info.js`, no ffmpeg: the file's boxes are read by
  seeking, never the video). STARTED is only a provisional t = 0: an output joining a running encoder waits for the
  next keyframe. Once the file is finished the chapters Racing Desk sent are read back from its chapter track and
  paired by name with the t each was sent at — each of ours with the chapter of that name nearest to where it belongs
  (names that occur once in each list, a lap's, say where), neither used twice, a pair more than a second from the
  median dropped, and the whole pairing not believed if half were: the offset is the median of (file time − t), and the
  summary says `alignment: { method: 'chapters', pairs, spreadMs }`. With no pair — a plain MP4, Chapters off, a
  replay clip, a file OBS never finalised — the file is lined up from its end: the moment its recording ended less its
  duration (a finished file's `mvhd`; an unfinished Hybrid MP4's fragments, marked `approximate`). A recording ends when
  StopRecord was sent, or when OBS said STOPPING for a stop made in OBS (`endFrom: 'request'` or `'event'`) — not at
  STOPPED, which comes after the encoder has flushed and the file is closed — or at the last moment OBS was seen
  recording, for one whose end was not told (`'lastSeen'`, approximate); a clip's end is the moment the save was asked.
  A recording that was **paused** (OBS's own button, or a later stage's TV takes) has the pause written down — markers
  and `pauses` in the summary — and allowed for: the file's clock stands still for it and the sidecar's does not, so
  the chapters are paired with the pauses taken out and the end alignment puts them back, marked approximate;
  `videoOffsetMs` is the offset for the frames before the first pause. A sidecar gone on in (Racing Desk restarted,
  OBS unreachable for a while) goes on from the zero its header says, not the one a take-over works out from OBS's
  clock, which can be seconds off. The summary's `videoOffsetMs` is what a reader adds to `t`
  (docs/telemetry-sidecar-schema.md).
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
- **Settings → Recording**: the state in a sentence; while recording its size, its chapters so far, its file, whether
  it was started in OBS or by itself, the telemetry beside it and the folder it goes to; otherwise where the last
  recording went (its chapters and replays), or why it stayed where OBS wrote it; what the replay buffer is doing and
  the last replay saved. Record/Stop, Save replay (while Instant replay is on; pressable while the buffer runs), Open
  OBS (while OBS is not answering), Set up OBS (while something is missing, with one sentence saying what it will
  change), Open folder, Choose folder, the five switches ("Record by itself", on; "Instant replay", off; "Chapters",
  on; "Start OBS when I press Record", on; "Start OBS with Racing Desk", off), and the password field only when OBS
  wants a password Racing Desk does not have.
- **The tray**: Record / Stop recording, Save replay (while Instant replay is on), Open OBS.
- **The Stream Deck**: Toggle Recording, Save Replay, TV Shots and the rest of its buttons, through the app's listener on
  `127.0.0.1:9091` (below), which is always up whatever the iPad view's switch. While a Toggle Recording key is on the deck
  the plugin asks that listener every two seconds how the recording stands (`/api/status`) and writes it on the key: the
  time while recording, "OBS off" while OBS is not open, "TV 3/7" during a take. A recording press waits up to 45 s for
  the answer (OBS started, its WebSocket up, the recording begun), the other keys 3 s. Open Settings opens the desk's
  Settings page. The plugin is built by `npm run build` (`apps/overlay/streamdeck/build.mjs`, esbuild, no SDK: it speaks
  the Stream Deck app's own WebSocket protocol) and installed at every app start from the unpacked copy
  (`modules/js/streamdeck-install.js`); its manifest does not turn Node's inspector on.
- **The race detail on the Desk page**: which recording in the recordings folder is the race's (by the session's start
  and track), Open folder beside it, and **TV shots** (below).
- **In the car**: Ctrl+Shift+V records or stops (OBS open), Ctrl+Shift+B saves the replay, Ctrl+Shift+P answers that
  TV shots are made from the desk after the race. Neither starts OBS.
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
pointed at it so that every file move into a recording's folder is a rename on the same drive.

## The listener on this PC (`remote-server.js`, loopback)

The iPad's server (port 9090, on the home network, switched on from the desk) has a twin that is always up, on
`127.0.0.1` alone, port 9091 (`localServerPort`), for the programs on this machine: the Stream Deck's buttons ask it for
the actions, whatever the iPad switch says; `/api/status` says in the car or not, the HUD on screen or not, whether he
has put the HUD away (`hudOff`), the page-only actions pressed on the rig (`hudActions`, below) and the recording in
short; `/api/settings-display` is his display settings through an allowlist — the panels, the zoom, the position, the
look — and never a key, a folder, an address, a device or anything of the recording's; and `/obs` is the HUD page for OBS
(next). It never has a key to show and never listens on any other address; the LAN server knows none of the three
routes. If its port is taken when the app starts it is tried again, two seconds, five, fifteen and then every half
minute, with the port read afresh from the settings at each try, until it is up (the log says so); the HUD source is not
given to OBS while it is down, and is when it comes up.

## HUD drawn by OBS (`modules/js/obs/hud-source.js`)

Off unless he turns the switch on (the Recording card). The HUD is then in the picture as a browser source of OBS's
own, from `http://127.0.0.1:9091/obs` (the port the listener is really on), instead of through his screen capture: the
page told it is OBS's (`window._obsMode`), its telemetry from the same listener, his display settings with it and asked
for again every ten seconds (a change on the desk reaches this copy too), no background, no iPad menu, the voice coach
off (the rig is already talking), the livery crop fetched from the listener, nothing asked of the runtime. It is not
drawn at all until the page has started and said he is in the car (its markup is hidden from the first paint, so that a
page loading in OBS does not put the HUD's skeleton over the game or the garage), nor while he has the HUD away
(Ctrl+Shift+H, the tray, the Stream Deck, Quit Overlay: the page asks `/api/status` once a second). The page-only actions
pressed on the rig — Zoom In and Out, Cycle Rating and Logo, the pit box tabs, Dismiss Commentary — change the rig's page
and are saved nowhere, so the app notes the last sixteen of them with a number in the status and the OBS page does each
once (what was pressed before it began is not done again); the mode presets and the panels' switches are saved, and
reach it by its ten-second ask of the settings. The source is the size of the rig's HUD window in DIPs, which is what the
rig's page is laid out in, and OBS scales it up to the game (a source in physical pixels would lay the page out larger
than the rig's, and the recorded HUD would be smaller than the one he sees wherever the screen is not at 100 %).

Throwing the switch: the HUD's own window is taken out of every screen capture first (`setContentProtection`, which
takes effect at the next composition), then OBS is given one input, `Racing Desk HUD` — made once; OBS refuses a second
of that name — as a scene item (CreateSceneItem), put just above his `game video` (his facecam stays above the HUD) and
given its place and size (his 2up scene scales the HUD with the game), and reloaded (`refreshnocache`: CEF 127 in OBS
32 has no handler for a page that failed to load, so the page is reloaded when OBS answers, unless it is polling, which
a reconnect in the middle of a race leaves alone: the HUD in OBS keeps its session best and its sparklines). It goes into
the scene collection the switch was turned on in and no other (kept in `hud-source-state.json`; on another collection a
connect, or a change of collection, leaves it alone and the window stays in the capture there), and into the scenes of
that collection that have an item named `game video` and no other: nothing is guessed from the captures a scene has (his
"sim video with voice" has a SimHub window and a game capture of another name). An item that is there is left where he has
put it and enabled again only if Racing Desk is what disabled it (on the way out, or when the switch went off), so a
scene he hid it in stays so; it is fitted again only when the HUD's size has changed (the HUD moved screens).

Off again, OBS is told first — at every connect, whatever the last word was, so an item left enabled (the switch turned
off while OBS was closed, a crash, a restart) is switched off — and the window goes back into the capture after, so that
the two HUDs are never in the picture together. The items are disabled and never removed; nothing of his is ever removed.
The source is also disabled when Racing Desk quits, except for the Ctrl+Shift+G relaunch, which is back within seconds and
leaves the page in OBS loaded. The card says in one sentence what it did. Not seen on this rig: how CEF 127 lays the
HUD out (its `zoom`), and that `setContentProtection` leaves the window out of his display capture — the first run
with the switch on tells.

## TV shots (`modules/js/obs/tv-shots.js`)

After a race, from the desk's race detail (the race's recording), the tray or the Stream Deck (the latest recording):
the moments the recording's telemetry sidecar found — the places gained, the incidents, the pit stops; merged within
five seconds for up to half a minute of markers, at most twenty, the biggest first; the markers of every summary line of
the sidecar, so that a recording Racing Desk resumed is not shortened to its last stretch — recorded again from
iRacing's own replay through a TV camera, as one take in the race's folder, `<the race's video> tv.mp4` with its sidecar
(`kind: "tv"`, no chapters). The replay is driven through the app's own host, which sends the SDK's own commands
(`POST /racing-desk/data/replay`: seek by the sidecar's `sn` and `st` — the frame three seconds before each moment —
speed, the camera focused on his car by its number (the driver's focus names no car) in TV1, TV2, TV3 in turn, and
the camera flags: iRacing's own replay controls are hidden for the take and the flags and the play speed put back; for a
program on this machine alone, like the `?action=` routes, and refused with a 409 while the sim says he is on track). No
key is pressed. Only out of the car, with OBS answering, nothing recording and iRacing in its replay of this race (the
track the sim says is the sidecar's); otherwise one sentence says what is missing. For the take auto-record is held, and
his facecam is hidden in the scene being recorded ("Hide the facecam during TV shots", on) and put back as soon as the
recording has stopped. The replay is paused and the first moment sought and waited for (the sim says where it is); the
recording starts; each moment plays at real speed and the replay pauses; between moments the recording is paused and
resumed once the next seek has landed, so the take holds the moments and nothing of the seeking. A moment the sim does
not reach within fifteen seconds is skipped, said and counted ("2 moments (1 was not in the replay)"); with none reached
nothing is recorded and no take is filed. After the last the recording stops and is filed.

The take ends where it is, with a sentence saying why, when he gets in the car (main's signal or the sim's own, looked at
before every command and every half second while a moment plays; nothing more is sent to the replay after that), when
iRacing leaves its replay (twice running), when OBS stops the take (his Ctrl+Space) or does not take the pause or the
resume, when he presses Stop (the moment that is playing is cut short) and when the app quits. His facecam is written
to `tv-state.json` (scene, item id, name) before it is hidden and cleared when it is shown again; a quit shows it again at
once (and waits for a take that has hidden it, even before the first seek has landed), and what a crash or an OBS that went
away left hidden is shown again at the next start of the app or the next time OBS answers — only an item still hidden that
the file names, by scene, id and name. A take left running by a Racing Desk that was closed in the middle of it is kept in
`recording-state.json` with its `take`, and is stopped and filed as the take it was when the next one finds it. Progress is on the desk's
pill (with Stop), the Recording card, the race detail, the tray and the Stream Deck's key. Not seen on this rig: that
iRacing lands a `ReplaySearchSessionTime` where the sidecar's clock says, that the camera follows his car by its number,
that its replay controls are out of the shots, and what `IsReplayPlaying` does while a seek lands (the first take tells).

## Settings (`overlay-settings.json`, migrated once by `modules/js/recording-settings.js`)

`recordingFolder`, `recordingAutoRecord` (on unless false), `recordingInstantReplay` (false),
`recordingInstantReplaySeconds` (20), `recordingChapters` (true), `obsStartOnRecord` (true), `obsStartWithApp` (false),
`obsPath` (null: the default install), `obsHudSource` (false: "HUD drawn by OBS"), `tvShotsHideFacecam` (true),
`localServerPort` (9091: the listener on this PC), `obsWebSocketPasswordEnc` (only if typed; never sent to a page),
`recordingSettingsVersion` (4). The Electron recorder's keys, the "native" backend's port and "stop in the pits"
(`recordingAutoStopOnPit`: his rules stop a recording on a new session, at the end of the race and when he leaves the
car, and the pit lane is none of those) are deleted.

## Coming (not in this stage)

- **The editor applying `videoOffsetMs`.** `apps/edit/src/ingest/parse-telemetry.js` keeps the last summary as
  `sidecarSummary` and reads each frame's `t` as it is; adding the summary's `videoOffsetMs` (ms) to `t` (s) — less the
  `pauses` before it, for a recording that was paused — is for the editor's stage, and until then its cuts are as
  far off as the offset (up to about four seconds for a plain keyframe wait).

- **The editor cutting from a TV take**: `apps/edit` names the take by `tv` in the file name and takes it for the TV
  view, but applies none of the take's sidecar (its `pauses`, its own offset) yet.

## First run (what no test here can check)

With OBS closed, press Set up OBS on the desk and read what it says. Press Record: OBS should appear in the tray and the
pill should read "Recording"; drive a lap; press Stop; the card should say where the recording went, and that folder
under `D:\Racing Desk\Recordings` should hold the `.mp4` and the `.telemetry.jsonl` side by side, the sidecar's last
line saying `"alignment": { "method": "chapters" … }` with the offset. Then, with OBS open, press Ctrl+Space in OBS and
watch the desk's pill follow it. In OBS's mixer, check that the game audio meter moves (the Volt 2 game-audio device
failed to start on 2026-09-29). Then a session with OBS open and Record by itself on: out of the pits in practice the
pill should read "Recording" a second later, and getting out of the car should stop it; in a race it should begin at
the green flag. With Instant replay on, Ctrl+Shift+B in the car should put a `Replay …` clip and its sidecar in the
recording's folder. Open the finished MP4 in a player that lists chapters (VLC, DaVinci Resolve) and see the laps.

Then, with the iPad view off, press a Stream Deck key: it should answer (the listener on this PC is what it asks now). The
Stream Deck app runs the plugin it started with, so after the first start of this build it has to be restarted before its
keys use the new plugin and the TV Shots action is in its list (the log says so when the plugin was replaced).
Then "HUD drawn by OBS": switch it on with OBS open, look at OBS's preview — the HUD should be there once, over the
game and under the facecam, laid out as on the screen — and at a recording made with it on: the HUD once, not twice.
Then TV shots: after a race, open its replay in iRacing, pick the race on the Desk page and press TV shots; the pill
should count the moments, the facecam should go and come back, and the race's folder should hold `… tv.mp4` and its
sidecar; watch whether each moment is where the race had it (the first take says whether the sim lands the seeks), that the camera
follows his car, and that iRacing's replay bar is not in the shots; and that getting into the car during a take stops it.
