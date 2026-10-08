# Recording

OBS records; Racing Desk drives it, writes the telemetry beside the file, records by itself, keeps the replay buffer
with the car, writes chapters, files each recording in a folder of its own, and shows what is going on everywhere but
the HUD. Decided 2026-09-30 ("refactor the recording using obs as the main recording and composition surface"); this
is what is built as of stage 3 and what is coming. The Electron recorder, its ffmpeg, the `.rcpdv` bundles and the old
"native" backend are gone.

## What OBS does

- Captures the sim and the HUD through his own scene collection and profile (`sim race 2k`, `Untitled`), which Racing
  Desk never writes to, except the profile keys below when he presses **Set up OBS**.
- Encodes and writes the file: NVENC as his profile has it, as **Hybrid MP4** once set up (crash-safe files, and the
  format chapters need), and once set up **with a quality target** instead of his fixed 100 Mbps — the encoder spends
  what each moment needs, capped at the 100 Mbps he had (the grid, the pits and a replay take little; a busy lap looks
  as it did). The size of the picture is not changed: his canvas is 3440x1440, but his profile outputs 2580x1080
  (`[Video] OutputCX`/`OutputCY`, the canvas scaled to three quarters) and records that, so the file, and the HUD in it,
  are 2580x1080 today and stay so; the card names the size the profile has, never "full size". His own Ctrl+Space
  recordings are made with the same profile and get the same.
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
  recording, and the replay buffer, Racing Desk started run on in OBS; the state file says both are its own — the
  buffer as a claim (`replayOurs` and `relaunchedAt`; the claim alone when nothing of its own is recording; added to a
  file that already names a recording, such as one kept while OBS was out of reach for over half a minute, and never
  written over it); the sidecar is closed with the reason; and the relaunched app — back within seconds, with no desk
  window (`--no-desk`: closing the desk is a quit, and would stop what the restart kept) — takes them over when OBS
  answers: the sidecar gone on in from the same file (a `resumed` line, no second header), the buffer stopped when he
  leaves the car, so a restart mid-race leaves the race one video with one sidecar. The claim on the buffer is honoured
  once, within two minutes of the relaunch, and only on an answer: OBS's status of the buffer, or a start that finds it
  running when that status could not be read; an old claim (a relaunch that never reached OBS) is dropped, so a buffer
  he started himself is never made Racing Desk's by a file left behind. A real quit that comes while the relaunch is
  still waiting (for a STARTED, or a filing) gives the relaunch up and is a quit: it stops and files what Racing Desk
  started. A quit with a claim still unsettled asks OBS for the buffer's state first and stops it if it runs. A press of
  Stop stops whatever is recording.
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
  Desk started running and hands it to the relaunched app through the state file's claim (above). A start that failed is tried
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
  Desk started is stopped at about 5 GB and said so in one sentence (OBS itself stops only at 50 MB, with a dialog over
  the sim). The drive is the one OBS will write to — asked of OBS (`GetRecordDirectory`), else the folder its profile
  says, else Racing Desk's own setting — and a folder that is not made yet is measured on the nearest one above it. A
  drive that cannot be measured at all is a recording that does not start, said in a sentence; the floor is never
  switched off in silence.
- **Knows what his recordings really come to** (`modules/js/obs/recording-rate.js`): with a quality target instead of a
  fixed bitrate only the files say what a race costs, so the newest five recordings in the recordings folder (the ones
  Racing Desk filed, their main video, longer than half a minute) are measured — each file's size over its duration,
  the duration read from the file's own boxes, pooled so a long race weighs more than a short practice — at the app's
  start, after each filing, when Set up OBS has run, and when the recordings folder has changed since. Only recordings
  begun after the profile's `recordEncoder.json` was last written count (`measureSince`, the file's modification time,
  against each sidecar's `startedAt`): OBS writes that file only when the encoder's settings are changed and Set up OBS
  writes it, so a recording that began later was made with what it says, and one before was not. Without that, the
  first races with the quality target would be averaged with fixed-bitrate ones (a CBR recording is padded with filler
  data, so exactly 45 GB an hour at 100 Mbps) and the card would look as if nothing had changed for up to five races;
  with it, the card says nothing of the rate (the cap's hours, "or more") until a recording made with the new settings
  has been filed. The hours-left estimate runs at the measured rate once there is one, and until then at the bitrate
  the profile is capped at (12.5 MB/s at his 100 Mbps, read from the profile's encoder file), which with a quality
  target is the most it can be; **while recording** it runs at OBS's own bytes over its own seconds (after more than
  five seconds), and only while: once the recording has ended that rate is of a recording that is over, and the files'
  say what it came to. The card says which (below).
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
  the last replay saved; how much recording is left on the drive, at the real rate of his recordings once there is one
  ("About 22 hours of recording left on D: at 18 GB an hour, measured from your last 3 recordings."), until then, with
  the quality target set, at the cap and said as "or more" with not a word of the rate ("About 9 hours or more of
  recording left on D:."), or at a fixed bitrate before Set up OBS has run ("… at 100 Mbps."); and, with OBS open and
  the size not yet set, one sentence saying the size change happens the next time Set up OBS runs with OBS closed ("The
  size change (a quality target instead of a fixed 100 Mbps; the recordings stay 2580x1080) happens …"). Record/Stop, Save
  replay (while Instant replay is on; pressable while the buffer runs), Open OBS (while OBS is not answering), Set up
  OBS (while something is missing, with one sentence saying what it will change), Open folder, Choose folder, the five
  switches ("Record by itself", on; "Instant replay", off; "Chapters", on; "Start OBS when I press Record", on; "Start
  OBS with Racing Desk", off), and the password field only when OBS wants a password Racing Desk does not have.
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
is really changing: that they become Hybrid MP4 (the replay buffer changes nothing of theirs), that they go to the new
folder, and that they keep their size with a quality target. OBS then answers on port 4455 to anything on his network that
knows the password — said once on the card. A password read from OBS's file replaces one he typed earlier.

**The recordings' size** is the fourth thing Set up OBS does, and only while OBS is closed. OBS keeps the recording
encoder's settings in the profile's `recordEncoder.json` and hands the whole file to the encoder `[AdvOut] RecEncoder`
names (`frontend/utility/AdvancedOutput.cpp:78,121` in 32.1.2; his is `obs_nvenc_h264_tex`, the obs-nvenc plugin). The
plugin reads its rate control from three keys (`plugins/obs-nvenc/nvenc-properties.c:5-15`): `rate_control` — `CBR`,
`CQP`, `VBR`, `CQVBR` or `lossless` (`:114-120`, compared without case, `nvenc.c:230-233`) — `target_quality` (1-51 for
H.264, `:129-130`) and `max_bitrate` (Kbps, `:132`). `CQVBR` is NVENC's VBR with `targetQuality` set and the average
bitrate and VBV left at zero, capped at `max_bitrate` (`nvenc.c:347-349,366-370`): a quality target with a ceiling.
Set up OBS writes `rate_control: "CQVBR"`, `target_quality: 16` and `max_bitrate` = the ceiling the file records under
today (his `bitrate`, 100000 Kbps; a VBR's own cap) into that file, in the one-line JSON OBS writes
(`obs_data_get_json`: compact, keys in order), changing those three keys and no other — the preset (`p2`), the keyframe
interval, the B-frames, the lookahead and anything else stay as he has them, and a key the plugin does not read is
carried (OBS keeps what it does not know and writes it back, `OBSBasicSettings.cpp:1885-1886,3272`) — through a temp
file and a rename, with the file as it was kept beside it the first time as `recordEncoder.json.before-racing-desk` (so
it can be put back by renaming it over the other). **A key the file does not have is the plugin's own default**: OBS
writes only the keys the user changed (`obs_data_get_json` without defaults, `libobs/obs-data.c:578`), and the encoder
is made from the file with the defaults under it (`nvenc-properties.c:41-47,60`: `rate_control` `cbr`, `bitrate` 10000,
`max_bitrate` 10000, `target_quality` 20). So a file with no `bitrate` records at 10 Mbps, and that is the cap kept and
the "fixed N Mbps" the card says (not 100 Mbps, which is in no file but his); and a CQVBR he set up in OBS's own dialog
and left at its defaults has no `target_quality` and no `max_bitrate` in the file, which is level 20 under a 10 Mbps
cap: a quality target of his, left alone like any other (his level and his cap are never replaced). 16 is OBS's own
"Indistinguishable Quality, Large File Size" level for NVENC (`frontend/utility/SimpleOutput.cpp:520,543`:
`CalcCRF(16)`, which is 16 at any output above 2000 px across): the nearest OBS has to his 100 Mbps CBR, which at the
2580x1080 60 fps his profile outputs is six tenths of a bit per pixel and all but transparent; the plugin's own default
for the mode is 20, a step smaller and a step rougher. **The size of the picture is not Set up OBS's to change**: his
canvas is 3440x1440, but `[Video] OutputCX=2580`, `OutputCY=1080` scale it to three quarters and the recording is not
rescaled on its own (`RecUseRescale=false`; OBS 32.1.2 rescales a recording only for a scale filter other than disable
together with a `RecRescaleRes`, `AdvancedOutput.cpp:330,353-358`), so his recordings are 2580x1080 and stay that. The
card names that size from the profile (`profileOutputSize`: "keep its recordings at 2580x1080 with a quality target
instead of a fixed 100 Mbps"), and where the profile does not say it names no size; it never says "full size". The keys
mean nothing to x264 or to Simple output, so for a profile that is not NVENC with Advanced, Standard output nothing is
written and the card says so; `RecEncoder=none` (the stream's encoder) is left alone too. obs-websocket 5 has no
request for an encoder's settings (`GetOutputSettings` is the muxer's), and OBS writes the file from memory when its
Settings are saved, so with OBS open the card says in one sentence that the size change happens the next time Set up
OBS runs with OBS closed, and the button's own sentence leaves it out. The hours-left line on the card then says "or
more" (the cap's hours, with nothing of the rate) until a recording made with the new settings has been measured.

**A side effect of CQVBR on the replay buffer.** OBS counts a recording as bitrate-based only for CBR, VBR or ABR
(`AdvancedOutput.cpp:146-147`, `usesBitrate`), and gives the replay buffer a memory limit only when it is not:
`max_size_mb` is `RecRBSize` (his 512 MB) instead of 0 (`:883`). The 20 s replay buffer is therefore now also limited to
512 MB, which holds 20 s at up to about 200 Mbps: well over the 100 Mbps cap, so the instant replay is intact today. If
the cap or the buffer's length is ever raised, a clip would be cut short by the memory limit without a word, so check
`RecRBSize` (OBS Settings, Output, Replay Buffer, Maximum Memory) first.

The recording folder is `D:\Racing Desk\Recordings` while there is a D: drive (`recordingFolder` in
`overlay-settings.json` names another; C: holds about ninety minutes at his bitrate). OBS's own recording folder is
pointed at it so that every file move into a recording's folder is a rename on the same drive.

## The listener on this PC (`remote-server.js`, loopback)

The iPad's server (port 9090, on the home network, switched on from the desk) has a twin that is always up, on
`127.0.0.1` alone, port 9091 (`localServerPort`), for the programs on this machine: the Stream Deck's buttons ask it for
the actions, whatever the iPad switch says; `/api/status` says in the car or not, the HUD on screen or not, whether he
has put the HUD away (`hudOff`), the page-only actions pressed on the rig (`hudActions`, below) and the recording in
short; `/api/settings-display` is his display settings through an allowlist — the panels, the zoom, the position, the
look, the two panel-background sliders — and never a key, a folder, an address, a device or anything of the recording's;
`/obs` is the HUD page for OBS (next) and `/obs-ipad` the iPad dashboard for OBS. It never has a key to show and never
listens on any other address; the LAN server knows neither page, and its own `/api/settings-display` (behind the key,
like everything on it) answers the iPad the panel background and nothing else. If its port is taken when the app starts
it is tried again, two seconds, five, fifteen and then every half
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
**The source is drawn at 60 frames a second** (`fps_custom: true, fps: 60` in the source's settings, both views): the
HUD's data changes 30 times a second, but the page moves at more than that — its CSS animations and transitions and, in
the iPad dashboard, the two maps, which are drawn between the data frames (overlay CLAUDE.md, The maps between the data
frames) — and a source at 30 showed all of it in steps (he said on 2026-10-07: "the animations don't seem as smooth as they
used to be"). It was 30 for a few hours of that day (`a3872eaa`). The settings are written when the source is made and
again at every connect to OBS, so an older source (made at the canvas's rate, or at 30) is put right the next time Racing
Desk meets OBS. **The page runs no WebGL effect** (the glows, bloom and
flashes): `/obs` and `/obs-ipad` never start the effects loop and make no WebGL context, so OBS's browser is not asked
for a GPU effect pass on top of the page.

**What OBS draws is a choice under the switch** (`obsHudView`, asked for 2026-10-01: "I'd like a setting for the hud in
obs to be the iPad version"): **Rig HUD**, the above, or **iPad dashboard**, the glance layout the iPad is shown. The
iPad dashboard is the listener's `/obs-ipad` page: the same `dashboard.html`, in drive mode from the start
(`window._obsGlance`, which `drive-hud.js` reads as it reads `_remoteMode`), with the iPad's look — the glass at
fifteen hundredths, no badges (so the crop is never asked for), the sectors that fit, the same grid (`html.rd-glance`
shares the iPad's rules in `drive-view.css`) — and OBS mode's behaviour: no key, no menu, hidden out of the car and while
he has the HUD away, no voice coach, the display-settings allowlist; the rig's page-only actions are not done on it (the
glance layout has no zoom, and the rig's zoom key would scale the whole grid). **It keeps to his display settings, as the
rig HUD OBS draws does, not to the iPad's own defaults** (decided 2026-10-01 after a review pointed out that the iPad is
told none of the look keys): this page runs on the rig, in OBS's browser next to the sim, so his switches for the rig
apply to it. (Since 2026-10-07 no WebGL effect runs on this page whatever they say, and there is no ambient light to
switch: `no-fx-on-glance.spec.mjs`.) The layout, the glass (the overhead glow and the sweep are in the page's CSS, not in
canvases), the flag card, race control's banner and the transparent page follow them, and `hud-page-obs-ipad.spec.mjs`
holds it, live. **The page behind and between the panels
is transparent**: no black page, no flag pattern in the gutters and no frame at the edge (those are the iPad's, which
has no game behind it), so the game shows through the gutters; a flag still reads from the flag card in the gaps block,
race control's banner and the panels' flag-coloured borders and tint. Never on the iPad's server; the iPad's own view is
as it was. **The source is an iPad's size, 1180 by 820** (`IPAD_SOURCE`: the iPad Air and 11" Pro on their side, the
size the layout is held to in `drive-view.spec.mjs` and the golden frames are made at; landscape, as the game is), and
**it is not stretched over the game**: the first time Racing Desk adds it to a scene it is put in the bottom-left corner
of the game video (away from a facecam in the bottom right), inset by a fiftieth of the game's shorter side, scaled
inside bounds at half the game's height (`IPAD_PLACE`; on his 3440 by 1440 canvas that is 1036 by 720, under a third of
the width: 0.88 of the page's own size, the layout's 11 px labels at 9.7 px of the canvas and its numbers, 20 px and up,
at 17.6 px. Two-fifths was the first cut and was too small for a recording: 7.7 px labels, under 5 px once the video is
scaled for upload. It is one drag in OBS to change, and then it is his), and after that **it is never moved or sized by
Racing Desk again**: his layout in OBS is his. The state file (`hud-source-state.json`: `collection`, `off`, `view`,
`ipad`) says which scenes it has been placed in, **by the scene's uuid** (OBS 30 and up; the name where OBS gives none),
so that renaming a scene is not a new scene. A connect, a choice made again or a change of the rig's screen only brings
the address up to date (SetInputSettings) and reloads the page: nothing is moved or sized. **The page is laid out at the
size he gives the item** (asked 2026-10-01: "Make the iPad version flow to its bounds … in obs, it responds to its
container if it can"). In OBS a browser source has a width and a height of its own — the page's viewport, what it is laid
out at — and the scene item has a transform: dragging an item's corner changes the item's scale or bounds and never the
source's size, so a page made at 1180 by 820 and dragged to a wide box was stretched into it. So the source's width and
height follow the item's box: on every connect (the item in the scene OBS is on, else the first with a game video) and a
moment after he lets go of the item (OBS's `SceneItemTransformChanged`, which the client now subscribes to and `main.js`
hands to `hudSource.transformChanged`; `FOLLOW_AFTER_MS`, 1.2 s, after the last one, since OBS sends one for every pixel
of a drag). The item is not touched for it: one scaled inside bounds, which is how it is placed, keeps its bounds and the
page fills them edge to edge at a scale of one; one he has set to no bounds and scaled has its scale put to one as the
source takes its box, so the box is what it was to the pixel. **A box smaller than the least iPad** in its orientation
(`LEAST_BOX`: 1024 by 744 on its side, 744 by 1024 upright — the 9.7" and the mini, the least the layout is held to, its
numbers at their 20px floor) has the page laid out at the box's own shape scaled up until it is that big, and OBS draws it
into the box (the item's scale, for one with no bounds, is what keeps the box): the corner it is first put in, 1036 by 720
on his 3440 by 1440 canvas, is laid out at 1071 by 744, a 1600 by 600 strip at 1984 by 744, a 900 by 900 square at 1024 by
1024; a 1920 by 1080 box at its own size. Below that the layout is not cut off by its floors, it is drawn a little smaller.
One source has one size, so with the dashboard in several
scenes at different boxes it is laid out for the scene OBS is on and scaled inside its bounds in the others. A size typed
into the source's own settings is not kept: the box is the size. A change of the source's size recreates OBS's browser (a
page loaded afresh, as a change of its settings always has), so it is made only when the box differs, to the pixel, from
the size the source has — a connect with the box unchanged asks OBS for its settings and no more. The page itself lays
out to whatever box it is given (`drive-view.css`: the grid, every cell a size container, and what a short cell gives up —
`hud-page-obs-ipad.spec.mjs` holds it at what a wide strip, the first corner, a square, a 1080p box, a tall column and
an iPad's box are laid out at).
An item that is in a scene with nothing written of it (the state file lost; the switch turned on afresh in
another collection and back; a rename with no uuid) is his too, and is only written down — unless it still covers the
game video as the rig HUD's fit does, when it is the rig HUD left there and goes to the corner. Changing the choice changes the source's address and size and reloads the page: to the iPad
dashboard, the item is placed in the corner once per scene; back to the rig HUD, the item is fitted over the game again
(as a rig HUD must be) and his transform of the dashboard is written down per scene, so that choosing the iPad dashboard
again puts it back where he had it, not in the corner. A game video placed by its centre or its other corners is read
by its alignment, so the corner is the box it really covers. `obs-hud-source.spec.mjs` holds the placement once, the
leaving alone (his move, his size for the source, a renamed scene with and without a uuid, a lost state file), the two
changes of choice and the state file against the fake OBS; `hud-page-obs-ipad.spec.mjs` renders
the page headless at 1180 by 820 over a magenta-and-cyan board with a yellow flag out and reads the pixels: the board in
every gutter and along the edge, the panels dark over it.

**How solid the panels are** is two sliders, 0 to 100 (he asked "Does the overlay allow backgrounds to be set to
transparent?" on 2026-10-01 and chose one slider with OBS separate): **Panel background** in Settings → Look
(`panelBackground`) for the rig's HUD and the iPad view, and **Panel background in OBS** on the Recording card with the
switch (`obsPanelBackground`) for the pages OBS draws, whichever of the two, so the recording can be clearer or more
see-through than what he drives with. Each sets the panels' own background — the base fill and the glass — and nothing
else (`settings.js` `applyPanelBackground` writes `--panel-alpha`; `base.css` makes the fills, scales the glass down
with it and never up, and under 90 puts a soft shadow under every number and word in the panels, growing as the
background goes, so they read over the game: dark under the dark theme and pale under the light one, whose text is dark
(`--panel-shadow-rgb`)). **The spotter's card and race control's banner are not panels**: they come and go over the game
and carry what he most needs to read, so their fill is their own and solid whatever the slider says, their glass is not
thinned either (they keep `--panel-glass` at 1) and they have no shadow under their words. 90 is the panels as they have always been: the rig's `--bg` at
nine-tenths and the secondary panels' fills the same, the glance layout's base the same under its glass and opaque
under a flag (opaque at 90 and above; it thins below), so the defaults change no surface and the golden frames are as
they were. The rig's page gets the slider by the desk's settings path; the iPad is told it by its own server
(`/api/settings-display` on the iPad's server answers the panel background and the following map's zoom and nothing else, behind the key, and the
page asks again every ten seconds); the OBS pages get both through the display-settings allowlist and draw by the OBS
one. `panel-background.spec.mjs` holds each slider at 0, 50 and 100 on its own surface and not the others', the shadow in
both themes, the two cards at 0, and the defaults.

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
`obsPath` (null: the default install), `obsHudSource` (false: "HUD drawn by OBS"), `obsHudView` (`rig`: what OBS draws,
`rig` or `ipad`; read strictly, anything else is `rig`), `obsPanelBackground` (90: how solid the panels are in the
picture OBS draws), `tvShotsHideFacecam` (true), `localServerPort` (9091: the listener on this PC),
`obsWebSocketPasswordEnc` (only if typed; never sent to a page), `recordingSettingsVersion` (5). The Electron recorder's
keys, the "native" backend's port, "stop in the pits" (`recordingAutoStopOnPit`: his rules stop a recording on a new
session, at the end of the race and when he leaves the car, and the pit lane is none of those) and `greenScreen` (a key
nothing read: Ctrl+Shift+G flipped it and restarted the app, and now only restarts the app) are deleted. The rig's and
the iPad's panel background, `panelBackground` (90), is a key of the HUD's own (Settings → Look), not of the recording's.

## Coming (not in this stage)

- **The editor applying `videoOffsetMs`.** `apps/edit/src/ingest/parse-telemetry.js` keeps the last summary as
  `sidecarSummary` and reads each frame's `t` as it is; adding the summary's `videoOffsetMs` (ms) to `t` (s) — less the
  `pauses` before it, for a recording that was paused — is for the editor's stage, and until then its cuts are as
  far off as the offset (up to about four seconds for a plain keyframe wait).

- **The editor cutting from a TV take**: `apps/edit` names the take by `tv` in the file name and takes it for the TV
  view, but applies none of the take's sidecar (its `pauses`, its own offset) yet.

## First run (what no test here can check)

With OBS closed, press Set up OBS on the desk and read what it says: among its sentences, one that the profile now
records with a quality target instead of a fixed 100 Mbps, still at 2580x1080 (what his profile outputs today; the
canvas is 3440x1440), and `recordEncoder.json.before-racing-desk` beside `recordEncoder.json` in
`%APPDATA%\obs-studio\basic\profiles\Untitled`. Press Record: OBS should appear in the tray and
the pill should read "Recording"; drive a lap; press Stop; the card should say where the recording went, and that folder
under `D:\Racing Desk\Recordings` should hold the `.mp4` and the `.telemetry.jsonl` side by side, the sidecar's last
line saying `"alignment": { "method": "chapters" … }` with the offset. OBS's log for that session (Help, Log Files)
should show the encoder's settings as `rate_control: CQVBR`, `cq: 16`, `max_bitrate: 100000`, `preset: p2`, with
`keyint`, `b-frames` and `lookahead` as before. Until the first race is filed the hours-left line should say "About N hours or more of
recording left on D:.", with nothing of the rate. While it records it says Mbps, OBS's own rate; once it is filed — with
Racing Desk still running, no restart — the line should say "at N GB an hour, measured from your last recording", the
real figure, where the fixed 100 Mbps was 45 GB an hour; only recordings begun after Set up OBS wrote the encoder file
count, so none made before it is averaged in. The race should look as it did on a busy lap. Then, with OBS open, press Ctrl+Space in OBS and watch the desk's pill follow it. In OBS's mixer, check that the game audio meter moves (the Volt 2 game-audio device
failed to start on 2026-09-29). Then a session with OBS open and Record by itself on: out of the pits in practice the
pill should read "Recording" a second later, and getting out of the car should stop it; in a race it should begin at
the green flag. With Instant replay on, Ctrl+Shift+B in the car should put a `Replay …` clip and its sidecar in the
recording's folder. Open the finished MP4 in a player that lists chapters (VLC, DaVinci Resolve) and see the laps.

Then, with the iPad view off, press a Stream Deck key: it should answer (the listener on this PC is what it asks now). The
Stream Deck app runs the plugin it started with, so after the first start of this build it has to be restarted before its
keys use the new plugin and the TV Shots action is in its list (the log says so when the plugin was replaced).
Then "HUD drawn by OBS": switch it on with OBS open, look at OBS's preview — the HUD should be there once, over the
game and under the facecam, laid out as on the screen — and at a recording made with it on: the HUD once, not twice.
Then choose "iPad dashboard" under it: the source should become the glance layout in the bottom-left corner of the game
at half its height and under a third of its width, the game showing through between its panels; drag it where you want
it and switch scenes, reopen OBS, restart Racing Desk, rename the scene, change the source's size in its properties — it
should stay put (the address and size are put back, and the picture keeps its box). Then "Panel background in OBS" down
to 30 or so: the picture's panels should go see-through with a shadow under the numbers while the HUD on the screen
stays as it is.
Then TV shots: after a race, open its replay in iRacing, pick the race on the Desk page and press TV shots; the pill
should count the moments, the facecam should go and come back, and the race's folder should hold `… tv.mp4` and its
sidecar; watch whether each moment is where the race had it (the first take says whether the sim lands the seeks), that the camera
follows his car, and that iRacing's replay bar is not in the shots; and that getting into the car during a take stops it.
