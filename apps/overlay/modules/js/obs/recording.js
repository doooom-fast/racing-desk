// The recording keeper: OBS records, and this mirrors it. OBS is the truth — a recording he starts with Ctrl+Space in
// OBS is seen and treated the same as one Racing Desk asked for — and what Racing Desk adds is the telemetry sidecar
// beside the file (telemetry-sidecar.js, polled at 30 Hz from here while OBS records a live sim session), the
// chapters, the folder each recording is filed in, knowing which recordings it started so that it stops those and
// only those when it quits, auto-record, the replay buffer with the car, and a floor under the disk.
//
// Rules, each with a test in tests/unit/obs-recording.spec.mjs:
// - Record from the desk, the tray or the Stream Deck with OBS closed starts OBS (main.js's startObs: tasklist, then
//   obs64 detached) while "Start OBS when I press Record" is on and he is out of the car, and waits up to 30 s for
//   its WebSocket. From a key in the car, or in the car at all, or from auto-record, it starts nothing: the HUD says
//   "OBS is not open", one of the two sentences it may show, and only when tasklist says OBS is not running (OBS may
//   be open with its WebSocket off, and then the sentence would be false, and filmed).
// - StartRecord only queues the start; STARTING comes after OBS's path and disk checks, STARTED when the output
//   runs. Ten seconds without STARTED is "OBS didn't start recording. It may be showing a message." (OBS puts a modal
//   dialog up for a bad path or a full disk, even minimised).
// - A recording this keeper started is known by the outputPath STARTED carried, kept in a small state file, so that
//   after a restart it is still ours; on connect a recording already running is taken over (GetRecordStatus, its
//   path from GetOutputSettings on adv_file_output, its start from outputDuration). Stop from a press stops whatever
//   is recording, his own included; quitting stops only what we started.
// - A dropped connection is not OBS going away: OBS restarts its server when he changes its WebSocket settings, a
//   session can be kicked, a socket can be cut, a machine can sleep. The recording goes on in OBS, so it goes on
//   here — owned, in the state file, its sidecar still being written. It ends when OBS says so (STOPPED, ExitStarted,
//   or GetRecordStatus saying nothing is recording); after half a minute with no connection the card stops saying
//   it is recording, and the state file is kept so that the next connection takes the recording over as ours.
// - A recording whose end OBS did not tell — OBS crashed, or was closed with the WebSocket down — is filed when OBS next
//   answers and is not recording that file (or, for one of ours, when Racing Desk next starts): the file moved with its
//   sidecar, and lined up from its end, the end being the last moment OBS was seen recording (the connection closing,
//   the last look at GetRecordStatus), marked approximate. An unfinished Hybrid MP4 has no chapters to read back.
// - A recording's end, for lining it up from its end, is the moment its file ended: when StopRecord was sent, or STOPPING
//   came for a stop made in OBS — not STOPPED, which comes after the encoder has flushed and the file is closed.
// - Ownership is claimed when StartRecord is sent and kept for a minute, so a STARTED that comes late (OBS busy), a
//   quit between StartRecord and STARTED, and a connection cut in between all still end with the recording ours. A
//   claim auto-record made is let go once its ten seconds are up: the STARTED that follows is then not its, so a
//   Ctrl+Space he presses after closing the dialog that held it up is not stopped when he leaves the car.
// - The floor: no recording starts below about 20 GB free on the drive OBS records to (asked of OBS), and one of
//   ours is stopped at about 5 GB and said so in one sentence. At his 100 Mbps a drive fills at 43 GB an hour, and
//   OBS itself stops only at 50 MB, with a dialog over the sim. A folder that is not made yet is measured on the
//   nearest folder above it; a drive that cannot be measured at all is a recording that does not start.
// - Only a recording made while a sim session is live is filed — the sidecar, the chapters, the folder: his other
//   collections' recordings are left alone.
// - Auto-record (auto-record.js has the rules: the green flag in a race, pit exit elsewhere; stops on a new session
//   number, five seconds after his own finish, and when he leaves the car) is fed the payload main.js polls,
//   starts a recording through the same press as a key in the car (never OBS, never tasklist), tries again no sooner
//   than half a minute after a start that failed because OBS was not there, gives up for the session after one start
//   that OBS answered and did not carry out (a Settings window left open, a folder that is gone: it would be a dialog
//   over the sim at every try), says each of its two HUD sentences once a session, and stops only the recordings it
//   started. A gap in the telemetry is not him leaving the car: the in-car signal turns false after three silent
//   seconds, and the keeper goes by the last payload that answered for a minute.
// - The replay buffer runs with the car while "Instant replay" is on and a live sim session has him in it (not the
//   demo): started when he gets in, stopped when he gets out if this keeper started it — ownership is OBS's STOPPED
//   and no earlier, since STARTING and STOPPING say the output is not active — never started by this keeper when OBS
//   has none (the card says to press Set up OBS, or that it comes with OBS's next start when the profile has it).
//   Save replay (Ctrl+Shift+B, the tray, the Stream Deck) is SaveReplayBuffer; the clip OBS saves gets a sidecar of
//   its own from the last seconds of telemetry kept here (only the keys a frame is made of, as long as OBS's own
//   buffer and ten seconds more), lined up from the clip's end, and goes into the recording's folder, or into
//   Replays under the recordings folder.
// - Chapters: a lap, an incident, pit in and out, a place gained, each sent to OBS as the sidecar finds it
//   (CreateRecordChapter; Hybrid MP4 alone takes them, and OBS adds its own "Start"), while "Chapters" is on and the
//   recording is not paused. Each is kept in the sidecar with its t once OBS has taken it, so one that never
//   reached OBS is not paired with a chapter of the file's.
// - A pause (OBS's own button, or a later stage's TV takes) is written into the sidecar as markers and in the summary
//   as `pauses`: the video's clock stands still for it, the sidecar's does not, and the alignment allows for it.
// - After STOPPED the file is waited for, moved with its sidecar into the recording's folder (a rename on the same
//   drive; across drives it stays where OBS left it; and a video whose sidecar cannot follow goes back, since the
//   editor pairs files by folder), and the video offset is read back from the chapters, else taken from the file's
//   end (filing.js, mp4-info.js); the sidecar's summary says which. Quitting waits, for a few seconds, for a filing
//   still under way: a recording stopped a moment before he closes the desk is filed all the same.
// - A TV take (tv-shots.js): a recording asked for with `take` — the race's folder and the name to file it under
//   (`<the race's video> tv`) — is one of ours like any other, never starts OBS, gets a sidecar of `kind: 'tv'` with no
//   chapters (its laps are the replay's), and is filed into that folder under that name. While a take runs auto-record
//   is held (holdAuto), so nothing of the replay starts or stops a recording.
// - Nothing of this is drawn on the HUD: the desk's masthead, the tray and the Stream Deck show it.
const path = require('path');
const fs = require('fs');
const { createSidecar, sidecarPathFor, trackAndCar, trimPayload, parseSidecarEnds } = require('../telemetry-sidecar');
const { createAutoRecord } = require('./auto-record');
const filing = require('./filing');
const { readMp4Info } = require('./mp4-info');

const STATE = Object.freeze({
  STARTING: 'OBS_WEBSOCKET_OUTPUT_STARTING',
  STARTED: 'OBS_WEBSOCKET_OUTPUT_STARTED',
  STOPPING: 'OBS_WEBSOCKET_OUTPUT_STOPPING',
  STOPPED: 'OBS_WEBSOCKET_OUTPUT_STOPPED',
  PAUSED: 'OBS_WEBSOCKET_OUTPUT_PAUSED',
  RESUMED: 'OBS_WEBSOCKET_OUTPUT_RESUMED',
});

const RECORD_OUTPUT = 'adv_file_output';
const FLOOR_START_BYTES = 20e9;
const FLOOR_STOP_BYTES = 5e9;
const DEFAULT_BYTES_PER_SECOND = 12.5e6;   // his profile: 100 Mbps CBR
const WAIT_STARTED_MS = 10000;
const WAIT_STOPPED_MS = 10000;
const WAIT_OBS_MS = 30000;
const WAIT_SAVED_MS = 10000;
const QUIT_WAIT_MS = 3000;
const STATUS_EVERY_MS = 10000;
const IDLE_FREE_EVERY_MS = 60000;
const LOST_AFTER_MS = 30000;     // with no connection this long, the card stops saying it is recording
const CLAIM_MS = 60000;          // a StartRecord's claim on the STARTED that follows it
const SIDECAR_HZ = 30;
const AUTO_RETRY_MS = 30000;     // auto-record tries a start that failed again no sooner than this
const REPLAY_RETRY_MS = 60000;   // the replay buffer that would not start is tried again no sooner than this
const REPLAY_SECONDS = 20;
const RING_EXTRA_S = 10;
const CHAPTER_FAILED = 702;      // obs-websocket RequestProcessingFailed: the output takes no chapters (not Hybrid MP4), or is paused
const OUTPUT_PAUSED = 502;
const FILING_QUIT_WAIT_MS = 8000;   // quitting waits this long at most for a recording to be filed (2 s for the file to hold still, the move)
const SILENT_LIMIT_MS = 60000;      // telemetry that has said nothing this long is taken as him gone, whatever the in-car signal says
const LIVE_TRIES = 6;               // asks, when a recording begins, whether a sim session is live: a poll with no answer is not "no sim"
const LIVE_TRIES_PATIENT = 60;      // and at a take-over, when the host may not be up yet (Racing Desk's start)
const LIVE_EVERY_MS = 500;
const LIVE_FRESH_MS = 5000;         // a payload fed this recently stands in for a poll that got no answer
const HEAD_BYTES = 64 * 1024;       // how much of a sidecar's start and end are read to see what it holds
const TAIL_BYTES = 1024 * 1024;
const NEVER = Symbol('never');

const NOT_OPEN = "OBS isn't open";
const NOTICE_NOT_OPEN = 'OBS is not open';
const NOTICE_NOT_STARTED = "OBS didn't start recording";
const NOT_STARTED = "OBS didn't start recording. It may be showing a message.";
const NOT_ANSWERING = 'OBS is open but not answering. If it is asking about its last crash, choose Launch Normally.';
const REFUSED_PASSWORD = 'OBS refused the password. Type the one from OBS on the Recording card.';
const MISSING_PASSWORD = 'OBS wants a password and Racing Desk has none. Type the one from OBS on the Recording card.';
const OPEN_NOT_REACHED = 'OBS is open but Racing Desk cannot reach it.';
const LOST_START = 'OBS stopped answering before it said the recording had started.';
const ALREADY = 'Already recording';
const NOT_RECORDING = 'Not recording';
const REPLAY_OFF = 'Instant replay is switched off on the Recording card.';
const REPLAY_NOT_RUNNING = "The replay buffer isn't running.";
const REPLAY_NONE = 'OBS has no replay buffer. Press Set up OBS, then open OBS again.';
const REPLAY_NEXT_START = 'Instant replay starts the next time OBS opens.';
const REPLAY_NOT_SAVED = "OBS didn't say the replay was saved. It may be showing a message.";

function flag(value) {
  if (value === true) return true;
  if (typeof value === 'string' && /^true$/i.test(value.trim())) return true;
  return Number(value) > 0;
}

/** A live sim session: the game running and not the demo. Only such recordings are filed. */
function isSimLive(payload) {
  return !!payload && typeof payload === 'object' && flag(payload['DataCorePlugin.GameRunning']) && !flag(payload['RacingDesk.Plugin.DemoMode']);
}

function gb(bytes) {
  return (bytes / 1e9).toFixed(bytes < 10e9 ? 1 : 0);
}

function driveOf(p) {
  try { return path.win32.parse(String(p)).root.replace(/[\\/]+$/, '') || path.win32.parse(String(p)).root; } catch (e) { return ''; }
}

/**
 * Free bytes on the drive a folder is on, from fs.statfs. A folder that is not made yet — OBS makes the one it records
 * to when it starts, and Set up OBS has perhaps not run — is measured on the nearest folder above it, which is on the
 * same drive; null only when no folder up to the drive's root can be asked.
 */
function freeSpaceOf(folder, fsModule = fs) {
  const ask = (where) => new Promise((resolve) => {
    try {
      fsModule.statfs(String(where), (err, stats) => {
        if (err || !stats) { resolve(null); return; }
        resolve(Number(stats.bavail) * Number(stats.bsize));
      });
    } catch (e) {
      resolve(null);
    }
  });
  return (async () => {
    let where = String(folder || '');
    if (!where) return null;
    for (let i = 0; i < 64; i++) {
      const bytes = await ask(where);
      if (bytes !== null) return bytes;
      const up = path.dirname(where);
      if (!up || up === where) return null;
      where = up;
    }
    return null;
  })();
}

/**
 * What a sidecar file holds at its two ends — its header, its last summary, the last frame written — read from the
 * first 64 kB and the last megabyte, never the whole file (an hour of 30 Hz frames is some 160 MB). null when the file
 * cannot be read.
 */
function readSidecarEnds(file, fsModule = fs) {
  let fd = null;
  try {
    fd = fsModule.openSync(file, 'r');
    const size = fsModule.fstatSync(fd).size;
    const head = Buffer.alloc(Math.min(size, HEAD_BYTES));
    fsModule.readSync(fd, head, 0, head.length, 0);
    const tailLength = Math.min(size, TAIL_BYTES);
    const tail = Buffer.alloc(tailLength);
    fsModule.readSync(fd, tail, 0, tailLength, size - tailLength);
    // A file cut short by a crash ends in the middle of a line, and what is appended to it must start on a line of its own.
    return { ...parseSidecarEnds({ head: head.toString('utf8'), tail: tail.toString('utf8'), whole: tailLength === size }), size, endsWithNewline: tailLength === 0 || tail[tailLength - 1] === 10 };
  } catch (e) {
    return null;
  } finally {
    if (fd !== null) { try { fsModule.closeSync(fd); } catch (e) { /* closed */ } }
  }
}

function createRecordingKeeper({
  client,
  settings = () => ({}),
  recordFolder = () => '',
  obsFolder = () => null,
  stateFile,
  fs: fsModule = fs,
  freeSpace = (folder) => freeSpaceOf(folder, fsModule),
  fetchPayload = async () => null,
  inCar = () => false,
  obsRunning = async () => null,
  startObs = async () => ({ ok: false, reason: 'OBS cannot be started from here' }),
  notice = () => {},
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  log = () => {},
  onChange = () => {},
  readMp4 = (file) => readMp4Info(file, { fs: fsModule }),
  waitStartedMs = WAIT_STARTED_MS,
  waitStoppedMs = WAIT_STOPPED_MS,
  waitObsMs = WAIT_OBS_MS,
  waitSavedMs = WAIT_SAVED_MS,
  quitWaitMs = QUIT_WAIT_MS,
  lostAfterMs = LOST_AFTER_MS,
  claimMs = CLAIM_MS,
  floorStartBytes = FLOOR_START_BYTES,
  floorStopBytes = FLOOR_STOP_BYTES,
  statusEveryMs = STATUS_EVERY_MS,
  idleFreeEveryMs = IDLE_FREE_EVERY_MS,
  sidecarHz = SIDECAR_HZ,
  defaultBytesPerSecond = DEFAULT_BYTES_PER_SECOND,
  autoRetryMs = AUTO_RETRY_MS,
  replayRetryMs = REPLAY_RETRY_MS,
  stableMs = filing.STABLE_MS,
  stableTimeoutMs = filing.STABLE_TIMEOUT_MS,
  moveRetryMs = 500,
  autoRules = null,
  silentLimitMs = SILENT_LIMIT_MS,
  filingQuitWaitMs = FILING_QUIT_WAIT_MS,
  liveTries = LIVE_TRIES,
  liveTriesPatient = LIVE_TRIES_PATIENT,
  liveEveryMs = LIVE_EVERY_MS,
  ringExtraS = RING_EXTRA_S,
} = {}) {
  if (!client) throw new Error('the recording keeper needs the OBS client');

  let recording = false;
  let starting = false;
  let stopping = false;
  let paused = false;
  let owned = false;
  let auto = false;            // the recording running is one auto-record started
  let outputPath = null;       // the file being written now: the last RecordFileChanged's, else STARTED's
  let key = null;              // the file STARTED named: what the recording is known by, split or not
  let splitSeen = false;       // RecordFileChanged named a later file than the one STARTED did
  let startedAt = 0;
  let bytes = 0;
  let bytesPerSecond = null;
  let free = null;             // { bytes, at, folder }
  let lowDisk = null;
  let last = null;             // the last answer to a press
  let busy = null;             // 'starting-obs' | 'starting' | 'stopping' | 'saving' | null
  let claim = null;            // { at, auto, take } from the StartRecord we sent until the STARTED that answers it
  let pendingStart = null;     // { resolve, auto, take } while we wait for STARTED after our StartRecord
  let take = null;             // { folder, baseName } of the recording running, when it is a TV take
  let autoHeld = null;         // a reason while auto-record is held (a TV take): the rules are not asked
  let pendingStop = null;
  let pendingSave = null;      // { resolve, sentAt } while we wait for ReplayBufferSaved after our SaveReplayBuffer
  let generation = 0;          // counts STARTED and STOPPED: a take-over that was asked before one is out of date
  let statusTimer = null;
  let freeTimer = null;
  let tapTimer = null;
  let lostTimer = null;
  let tapBusy = false;
  let disposed = false;
  let lastDigest = null;
  let session = null;          // the sidecar session of the recording being written (below)
  let lastFiled = null;        // where the last recording went, for the card
  let autoTriedAt = 0;
  const autoSaid = { open: NEVER, started: NEVER };   // the session each of the two HUD sentences was last said for by auto-record
  let autoGaveUp = null;       // { session }: auto-record's start was answered with nothing; no more tries this session
  let lastHere = false;        // the last feed had him in the car: a stint begins when this turns true
  let inSession = false;       // ... and a live sim session (not the demo) has him in it
  let answered = null;         // { here, live } as of the last payload that answered
  let silentSince = null;      // when the telemetry stopped answering, while it has
  let lastPayload = null;      // { at, payload }: the last payload fed
  let lastSeenAt = 0;          // the last moment OBS was known to be recording
  let stopRequestedAt = null;  // the moment the file ended: StopRecord sent, or OBS's STOPPING for a stop made in OBS
  let stopFrom = null;         // 'request' | 'event'
  let abandoned = null;        // a recording whose end OBS did not tell: { key, files, folder, endedAt }
  const pendingFilings = new Set();   // recordings being filed: a quit waits for them
  // The replay buffer: `ours` is OBS's STOPPED and no earlier; `failedAt` is the last start that failed, not the last
  // start; `seconds` is OBS's own RecRBTime where it said, `settingSeconds` the card's.
  const replay = { running: false, ours: false, busy: false, unavailable: null, lastSaved: null, failedAt: 0, saving: false, seconds: null, settingSeconds: REPLAY_SECONDS };
  const ring = [];             // { at, payload } for the last seconds, while the replay buffer runs (payload: trimPayload's)
  const offs = [];
  const rules = autoRules || createAutoRecord({ now });

  // ── The state file: which recording is ours ──
  // { owned: the file STARTED named, current: the file being written (a split moves it), startedAt, auto, folder }.
  function readState() {
    try {
      const parsed = JSON.parse(String(fsModule.readFileSync(stateFile, 'utf8')));
      return parsed && typeof parsed === 'object' && typeof parsed.owned === 'string' ? parsed : null;
    } catch (e) {
      return null;
    }
  }
  function writeState() {
    if (!stateFile || !key) return;
    try {
      fsModule.mkdirSync(path.dirname(stateFile), { recursive: true });
      const tmp = `${stateFile}.tmp`;
      fsModule.writeFileSync(tmp, JSON.stringify({ owned: key, current: outputPath, startedAt, auto, folder: session ? session.folder : null, seenAt: lastSeenAt || null }));
      fsModule.renameSync(tmp, stateFile);
    } catch (e) {
      log(`[RacingDesk] Recording: the state file could not be written: ${e.message}`);
    }
  }
  function clearState() {
    if (!stateFile) return;
    try { fsModule.unlinkSync(stateFile); } catch (e) { /* none */ }
  }
  const samePath = (a, b) => !!a && !!b && String(a).replace(/\//g, '\\').toLowerCase() === String(b).replace(/\//g, '\\').toLowerCase();
  const claimActive = () => !!claim && now() - claim.at <= claimMs;
  // The card's length for the buffer, from the settings as they were at the last feed (the tap runs at 30 Hz and does not
  // read a file each time); the ring holds the longer of that and OBS's own RecRBTime, with ten seconds more.
  const replaySettingSeconds = (set) => { const s = Number(set.recordingInstantReplaySeconds); return Number.isFinite(s) && s > 0 ? s : REPLAY_SECONDS; };
  const ringKeepMs = () => (Math.max(replay.settingSeconds, replay.seconds || 0) + ringExtraS) * 1000;
  const clipSeconds = () => replay.seconds || replay.settingSeconds;

  // ── Status ──
  function obsPhase() {
    const s = client.state();
    if (s.identified) return 'open';
    if (s.authFailed) return 'authFailed';
    if (s.passwordMissing) return 'passwordMissing';
    if (s.phase === 'connecting' || s.phase === 'hello') return 'connecting';
    return 'closed';
  }

  function status() {
    const rate = bytesPerSecond || defaultBytesPerSecond;
    const set = settings();
    return {
      obs: obsPhase(),
      obsVersion: client.state().obsVersion,
      recording, starting, stopping, paused, owned, auto, outputPath,
      startedAt: recording ? startedAt : null,
      elapsedMs: recording ? Math.max(0, now() - startedAt) : 0,
      bytes: recording ? bytes : 0,
      bytesPerSecond: rate,
      free: free ? { bytes: free.bytes, hoursLeft: free.bytes / rate / 3600, drive: driveOf(free.folder) } : null,
      lowDisk,
      last,
      busy,
      sidecar: session && session.writer.isActive() ? { path: session.writer.state().path, frames: session.writer.state().frames } : null,
      kind: session ? session.kind : (take ? 'tv' : null),
      autoHeld: autoHeld,
      chapters: session ? session.chapterCount : 0,
      filed: session && session.folder ? { folder: session.folder } : null,
      lastFiled,
      replay: {
        on: set.recordingInstantReplay === true,
        running: replay.running,
        unavailable: replay.unavailable,
        lastSaved: replay.lastSaved,
      },
      autoRecord: set.recordingAutoRecord !== false,
    };
  }

  // What the desk and the tray are told of is what they would show: not the clock, which the desk runs on itself, and
  // not OBS being looked for again every five seconds (connecting and closed read alike), which used to rebuild the
  // tray's menu and the card — the password field with it — at every try.
  function digest() {
    const s = status();
    return JSON.stringify({
      obs: s.obs === 'connecting' ? 'closed' : s.obs,
      v: s.obsVersion,
      recording: s.recording, starting: s.starting, stopping: s.stopping, paused: s.paused, owned: s.owned, auto: s.auto,
      outputPath: s.outputPath, bytes: s.bytes, rate: Math.round(s.bytesPerSecond), kind: s.kind, autoHeld: s.autoHeld,
      free: s.free && { bytes: s.free.bytes, drive: s.free.drive },
      lowDisk: s.lowDisk, last: s.last && { ok: s.last.ok, text: s.last.text }, busy: s.busy, sidecar: !!s.sidecar,
      chapters: s.chapters, filed: s.filed, lastFiled: s.lastFiled && s.lastFiled.at, replay: s.replay, autoRecord: s.autoRecord,
    });
  }

  function announce() {
    const seen = digest();
    if (seen === lastDigest) return;
    lastDigest = seen;
    try { onChange(status()); } catch (e) { log(`[RacingDesk] Recording: onChange threw: ${e.message}`); }
  }

  function answer(ok, text, extra = {}) {
    last = { ok, text, at: now() };
    announce();
    return { ok, reason: ok ? undefined : text, ...extra };
  }

  function settlePending(startValue, stopValue) {
    if (pendingStart) { const p = pendingStart; pendingStart = null; p.resolve(startValue); }
    if (pendingStop) { const p = pendingStop; pendingStop = null; p.resolve(stopValue); }
  }

  function unrefed(t) {
    if (t && typeof t.unref === 'function') t.unref();
    return t;
  }

  // ── The sidecar session: one per recording ──
  // { writer, key, files, folder, chapterCount, chaptersPossible, clips, resumed }. The writer is telemetry-sidecar.js's;
  // the folder is the recording's own under the recordings folder, made when the session begins if the file OBS writes
  // is on the same drive (so that the move after STOPPED is a rename), and replay clips saved meanwhile go into it.
  function sidecarHasContent(file) {
    try { return fsModule.statSync(file).size > 0; } catch (e) { return false; }
  }

  function folderFor(payload, keptFolder, at = startedAt) {
    if (typeof keptFolder === 'string' && keptFolder) return keptFolder;
    const root = recordFolder();
    if (!root || !key || !filing.sameDrive(key, root)) return null;
    const { track, car } = trackAndCar(payload);
    return path.join(root, filing.folderNameFor({ startedAt: at, track, car }));
  }

  // Whether a sim session is live, asked for a few times: a poll with no answer (a timeout at the moment STARTED comes,
  // or a host that is still starting when Racing Desk is) is not "no sim". An answer that says there is none is final.
  // undefined: the recording was over, or another began, while it was asked.
  async function livePayload(mine, tries) {
    for (let i = 0; i < tries; i++) {
      let p = null;
      try { p = await fetchPayload(); } catch (e) { p = null; }
      if (!recording || key !== mine || disposed) return undefined;
      if (p) return p;
      if (lastPayload && now() - lastPayload.at <= LIVE_FRESH_MS) return lastPayload.payload;
      if (i < tries - 1) await new Promise((resolve) => { unrefed(setTimer(resolve, liveEveryMs)); });
    }
    return null;
  }

  async function beginSidecar({ keptFolder = null, patient = false, take: asTake = null } = {}) {
    if (!key || (session && session.writer.isActive())) return;
    const mine = key;
    const payload = await livePayload(mine, patient ? liveTriesPatient : liveTries);
    if (payload === undefined || (session && session.writer.isActive())) return;
    if (!isSimLive(payload)) {
      log('[RacingDesk] Recording: no sim session is live, so this recording gets no sidecar');
      return;
    }
    // One file per recording, by the file STARTED named (a split goes on in it). A file that has frames already —
    // Racing Desk was restarted, or lost OBS for a while — is gone on in, not given a second header, and t goes on
    // from the zero its header says: the zero a take-over works out for itself is OBS's own clock, which can be seconds
    // off the moment STARTED arrived (the keyframe wait), and the frames before the gap were counted from that.
    const file = sidecarPathFor(mine);
    const resume = sidecarHasContent(file);
    let zero = startedAt;
    if (resume) {
      const ends = readSidecarEnds(file, fsModule);
      const began = ends && ends.header ? Date.parse(ends.header.startedAt) : NaN;
      if (Number.isFinite(began) && began <= now()) zero = began;
    }
    const kind = asTake ? 'tv' : 'recording';
    const s = { writer: null, key: mine, files: [mine], folder: null, chapterCount: 0, chaptersPossible: !asTake, clips: [], resumed: resume, startedAt: zero, pauses: [], kind, fileAs: asTake ? asTake.baseName : null };
    s.writer = createSidecar({ write: (f, text) => fsModule.appendFileSync(f, text), now, onMarker: (m) => onMarkerFound(s, m) });
    try {
      s.writer.start({ path: file, startedAt: zero, producer: 'obs', obsOutputPath: mine, resume, kind });
      session = s;
      s.writer.frame(payload, { at: now() });
    } catch (e) {
      log(`[RacingDesk] Recording: the sidecar could not be started: ${e.message}`);
      return;
    }
    if (paused) s.pauses.push({ from: Math.max(0, now() - zero), to: null });
    // A TV take goes into the race's folder under the race's name; a recording into a folder of its own.
    s.folder = asTake ? (filing.sameDrive(mine, asTake.folder) ? asTake.folder : null) : folderFor(payload, keptFolder, zero);
    if (s.folder) {
      try { fsModule.mkdirSync(s.folder, { recursive: true }); } catch (e) { log(`[RacingDesk] Recording: the folder ${s.folder} could not be made: ${e.message}`); s.folder = null; }
    }
    if (owned) writeState();
    log(`[RacingDesk] Recording: sidecar ${resume ? 'resumed' : '→'} ${file}${s.folder ? `, to be filed in ${s.folder}` : ''}`);
    bookTap();
    announce();
  }

  // A marker the sidecar found in a frame: a chapter for OBS, while "Chapters" is on and the output takes them.
  function onMarkerFound(s, marker) {
    if (s !== session || !recording || paused) return;
    if (s.kind === 'tv') return;   // a take's laps and places are the replay's, not the race's
    if (settings().recordingChapters === false || !s.chaptersPossible) return;
    const name = filing.chapterNameFor(marker);
    if (!name) return;
    const at = now();
    // Kept in the sidecar only once OBS has taken it: one that never got there (the connection dropped, the recording
    // was paused) is not in the file, and a chapter of ours the file lacks pairs with the wrong one of its own.
    client.request('CreateRecordChapter', { chapterName: name }).then(() => {
      if (s.writer.isActive()) s.writer.chapter({ name, at, frame: marker.frame });
      s.chapterCount++;
      announce();
    }).catch(async (e) => {
      if (e && e.code === CHAPTER_FAILED) {
        // OBS answers 702 both for an output that takes no chapters (not Hybrid MP4) and for a recording that is paused —
        // before its PAUSED has reached us, perhaps. Only the first ends the chapters for the recording.
        let status = null;
        try { status = await client.request('GetRecordStatus'); } catch (err) { status = null; }
        if (status && status.outputPaused === true) return;
        if (s.chaptersPossible) log('[RacingDesk] Recording: OBS takes no chapters in this file (not Hybrid MP4: press Set up OBS), so none more are sent');
        s.chaptersPossible = false;
      } else if (e && e.code === OUTPUT_PAUSED) {
        /* paused: the chapter is skipped */
      } else {
        log(`[RacingDesk] Recording: a chapter was not written: ${e.message}`);
      }
    });
  }

  // A pause, from OBS's own: the video's clock stands still and the sidecar's does not, so the pause is written down
  // (markers, and `pauses` in the summary) for whoever lines the two up.
  function notePause(on, at = now()) {
    if (!session || !session.writer.isActive()) return;
    const t = Math.max(0, at - session.startedAt);
    if (on) {
      if (session.pauses.some((p) => p.to === null)) return;
      session.pauses.push({ from: t, to: null });
      session.writer.marker({ type: 'recording_paused' }, { at });
    } else {
      const open = session.pauses.find((p) => p.to === null);
      if (!open) return;
      open.to = t;
      session.writer.marker({ type: 'recording_resumed' }, { at });
    }
  }

  function closePause(s, at) {
    const open = s.pauses.find((p) => p.to === null);
    if (open) open.to = Math.max(open.from, at - s.startedAt);
  }

  // The frames: polled at 30 Hz while a sidecar is being written, or while the replay buffer runs and a live sim session
  // has him in the car (its ring: a buffer he started himself in OBS does not keep a 30 Hz poll going in the garage).
  function wantTap() {
    return (session && session.writer.isActive()) || (replay.running && inSession);
  }

  function bookTap() {
    if (tapTimer !== null || disposed || !wantTap()) return;
    const period = Math.max(10, Math.round(1000 / sidecarHz));
    const tick = async () => {
      tapTimer = null;
      if (disposed || !wantTap()) return;
      if (!tapBusy) {
        tapBusy = true;
        try {
          const p = await fetchPayload();
          const at = now();
          if (p) {
            if (session && session.writer.isActive()) session.writer.frame(p, { at });
            if (replay.running && inSession) {
              ring.push({ at, payload: trimPayload(p) });
              const keepMs = ringKeepMs();
              while (ring.length && at - ring[0].at > keepMs) ring.shift();
            }
          }
        } catch (e) { /* a poll that failed is a frame missed */ } finally {
          tapBusy = false;
        }
      }
      if (!disposed && wantTap()) tapTimer = unrefed(setTimer(tick, period));
    };
    tapTimer = unrefed(setTimer(tick, period));
  }

  // The session ends now, without filing (OBS cannot be reached, Racing Desk is quitting, it was disposed): the
  // summary is written at once with what is known.
  function endSidecar(reason) {
    if (!session) return;
    const s = session;
    session = null;
    if (!s.writer.isActive()) return;
    try {
      closePause(s, now());
      const result = s.writer.stop({ stoppedAt: now(), reason, obsOutputPath: outputPath, pauses: s.pauses });
      if (result) log(`[RacingDesk] Recording: sidecar done, ${result.frames} frames, ${result.markers} markers, ${result.chapters} chapters`);
    } catch (e) {
      log(`[RacingDesk] Recording: the sidecar could not be finished: ${e.message}`);
    }
  }

  // A filing under way is kept in pendingFilings until it is over, so that a quit can wait for it.
  function trackFiling(job) {
    const tracked = job.finally(() => { pendingFilings.delete(tracked); });
    pendingFilings.add(tracked);
    return tracked;
  }

  // The recording is over and its file complete (STOPPED, ExitStarted, OBS saying it is not recording): the session is
  // let go of here and filed on its own — the file waited for, moved with its sidecar, the offset read back.
  function fileSidecar(reason, { endedAt = now(), lastFile = outputPath, endFrom = null } = {}) {
    if (!session) return;
    const s = session;
    session = null;
    if (!s.writer.isActive()) return;
    closePause(s, endedAt);
    s.writer.flush();
    trackFiling(finishRecording(s, { reason, endedAt, lastFile, endFrom }).catch((e) => {
      log(`[RacingDesk] Recording: filing failed: ${e.message}`);
      try { if (s.writer.isActive()) s.writer.stop({ stoppedAt: endedAt, reason, obsOutputPath: lastFile, pauses: s.pauses }); } catch (err) { /* gone */ }
    }));
  }

  const fileExists = (p) => { try { fsModule.statSync(p); return true; } catch (e) { return false; } };

  async function finishRecording(s, { reason, endedAt, lastFile, endFrom = null }) {
    const files = [...new Set([...s.files, lastFile].filter(Boolean))];
    const timing = { fs: fsModule, setTimer, now, stableMs, timeoutMs: stableTimeoutMs };
    const moved = new Map();
    let folder = s.folder;
    let why = null;
    for (const f of files) {
      const settled = await filing.waitForStableFile(f, timing);
      if (!settled.ok) { log(`[RacingDesk] Recording: ${f} was not filed: ${settled.why}`); if (!why) why = settled.why; continue; }
      if (!folder) continue;
      const named = s.fileAs ? `${s.fileAs}${path.extname(f)}` : path.basename(f);
      const target = filing.uniquePath(path.join(folder, named), { exists: fileExists });
      const result = await filing.moveFile(f, target, { fs: fsModule, setTimer, retryMs: moveRetryMs });
      if (result.ok) moved.set(f, result.to);
      else { log(`[RacingDesk] Recording: ${f} stays where OBS left it: ${result.why}`); if (!why) why = result.why; }
    }
    if (!folder && why === null) why = recordFolder() && s.key && !filing.sameDrive(s.key, recordFolder()) ? `${driveOf(s.key)} and ${driveOf(recordFolder())} are different drives` : 'no folder';
    // The sidecar goes with the first file. A video in a folder with no telemetry beside it is no pair (the editor pairs
    // the files of a folder), so if the sidecar cannot follow, the videos go back where OBS wrote them.
    const first = files[0];
    let firstNow = moved.get(first) || first;
    let sidecarPath = s.writer.state().path;
    if (moved.has(first)) {
      const target = sidecarPathFor(firstNow);
      const result = await filing.moveFile(sidecarPath, target, { fs: fsModule, setTimer, retryMs: moveRetryMs });
      if (result.ok) {
        s.writer.relocate(target);
        sidecarPath = target;
      } else {
        log(`[RacingDesk] Recording: the telemetry stays where it is: ${result.why}`);
        for (const [from, to] of [...moved]) {
          const back = await filing.moveFile(to, from, { fs: fsModule, setTimer, retryMs: moveRetryMs });
          if (back.ok) moved.delete(from);
        }
        why = `the telemetry could not be moved with the video (${result.why})${moved.size ? ', and the video could not be moved back' : ', so the video was left where OBS wrote it'}`;
        firstNow = moved.get(first) || first;
      }
    }
    // A folder made for a recording that went nowhere is not left behind empty.
    if (!moved.size && folder) { try { fsModule.rmdirSync(folder); } catch (e) { /* not empty (a clip is in it), or gone */ } }
    // The offset: from the chapters read back, else from the end.
    let alignment = null;
    let videoOffsetMs = null;
    const info = readMp4(firstNow);
    const ours = s.writer.state().chapters;
    const pauses = s.pauses || [];
    const byChapters = info.chapters && info.chapters.length ? filing.alignFromChapters(ours, info.chapters, { pauses }) : null;
    if (byChapters) {
      videoOffsetMs = byChapters.videoOffsetMs;
      alignment = { method: 'chapters', pairs: byChapters.pairs, spreadMs: byChapters.spreadMs, fileChapters: info.chapters.length, ...(byChapters.dropped ? { dropped: byChapters.dropped } : {}), ...(pauses.length ? { approximate: true } : {}) };
    } else if (Number.isFinite(info.durationMs)) {
      const byEnd = filing.alignFromEnd({ startedAt: s.startedAt, endedAt, durationMs: info.durationMs, approximate: !info.complete || endFrom === 'lastSeen', pauses, endFrom });
      if (byEnd) { const { videoOffsetMs: offset, ...rest } = byEnd; videoOffsetMs = offset; alignment = rest; }
    }
    if (!alignment) alignment = { method: 'none', why: info.problem || 'the file said nothing of its length' };
    const lastNow = moved.get(lastFile) || lastFile;
    const result = s.writer.stop({ stoppedAt: endedAt, reason, obsOutputPath: lastNow, videoOffsetMs, alignment, pauses });
    lastFiled = {
      at: now(), folder: moved.size ? folder : null, video: firstNow, sidecar: sidecarPath, files: files.map((f) => moved.get(f) || f),
      chapters: result ? result.chapters : 0, clips: s.clips.length, alignment, why: moved.size ? null : why, kind: s.kind || 'recording',
    };
    log(`[RacingDesk] Recording: filed ${firstNow}${moved.size ? '' : ' (left where OBS wrote it)'}; offset ${videoOffsetMs === null ? 'not found' : `${videoOffsetMs} ms by ${alignment.method}`}; ${result ? `${result.frames} frames, ${result.chapters} chapters` : ''}`);
    announce();
  }

  // A recording whose end OBS did not tell (it crashed, or was closed while the WebSocket was down): its file is left
  // where OBS wrote it and its sidecar says what happened, with a summary written when the connection was lost. Filed
  // here when OBS next answers and is not recording it, or when Racing Desk next starts and finds it in the state file:
  // the file moved, lined up from its end — the end being the last moment OBS was seen recording — and one more summary
  // line appended, which a reader takes as the file's (a sidecar gone on in has more than one already).
  async function fileLeftover(left) {
    const sidecar = sidecarPathFor(left.key);
    const ends = readSidecarEnds(sidecar, fsModule);
    if (!ends || !ends.header) {
      // No sidecar: no sim session was live for it, so there is nothing of Racing Desk's to file.
      if (left.folder) { try { fsModule.rmdirSync(left.folder); } catch (e) { /* not empty, or gone */ } }
      return;
    }
    const began = Date.parse(ends.header.startedAt);
    const zero = Number.isFinite(began) ? began : now();
    let endedAt = Number(left.endedAt);
    if (!Number.isFinite(endedAt) || endedAt <= 0) {
      // Nothing says when OBS was last seen recording: the sidecar's last write, which is when its frames stopped.
      try { endedAt = fsModule.statSync(sidecar).mtimeMs; } catch (e) { endedAt = now(); }
    }
    const before = ends.summary || {
      _type: 'summary', frames: ends.lastFrame === null ? 0 : ends.lastFrame + 1, durationMs: Math.max(0, endedAt - zero),
      markers: [], chapters: [], videoOffsetMs: 0, alignment: { method: 'none' },
    };
    let at = sidecar;
    const lineBreak = ends.endsWithNewline ? '' : '\n';
    const writer = {
      isActive: () => true,
      flush() {},
      state: () => ({ path: at, chapters: Array.isArray(before.chapters) ? before.chapters.map((c) => ({ ...c })) : [] }),
      relocate(next) { at = next; return true; },
      stop({ stoppedAt, reason, obsOutputPath, videoOffsetMs, alignment, pauses }) {
        const line = {
          ...before,
          stoppedAt: new Date(stoppedAt).toISOString(),
          obsOutputPath: obsOutputPath || before.obsOutputPath,
          videoOffsetMs: Number.isFinite(videoOffsetMs) ? Math.round(videoOffsetMs) : (Number.isFinite(before.videoOffsetMs) ? before.videoOffsetMs : 0),
          alignment: alignment || { method: 'none' },
          reason,
          refiled: true,
          ...(Array.isArray(pauses) && pauses.length ? { pauses } : {}),
        };
        fsModule.appendFileSync(at, lineBreak + JSON.stringify(line) + '\n');
        return { path: at, frames: line.frames, markers: Array.isArray(line.markers) ? line.markers.length : 0, chapters: Array.isArray(line.chapters) ? line.chapters.length : 0, summary: line };
      },
    };
    const files = [...new Set((left.files || []).concat(left.key).filter(Boolean))];
    const lastFile = files[files.length - 1];
    const s = { writer, key: left.key, files, folder: left.folder || null, startedAt: zero, clips: [], pauses: Array.isArray(before.pauses) ? before.pauses : [] };
    log(`[RacingDesk] Recording: ${left.key} ended while OBS could not be reached; filing it, ending at the last moment OBS was seen recording`);
    await finishRecording(s, { reason: 'OBS went away', endedAt, lastFile, endFrom: 'lastSeen' });
  }

  function startLeftover(left) {
    trackFiling(fileLeftover(left).catch((e) => log(`[RacingDesk] Recording: filing what OBS left failed: ${e.message}`)));
  }

  // OBS answered and is not recording what the keeper lost track of — or is recording something else: that recording is
  // over. `foundPath` is what OBS records now (null: nothing). The same file is the recording being found again, which
  // is taken over, not filed. Not waited for: the take-over of what is running now must not wait for a file to hold still.
  function settleLeftover(foundPath) {
    const kept = readState();
    const left = abandoned || (kept ? {
      key: kept.owned, files: [kept.owned, kept.current].filter(Boolean), folder: kept.folder || null, endedAt: Number(kept.seenAt) || null,
    } : null);
    if (!left) return;
    if (foundPath && samePath(left.key, foundPath)) { abandoned = null; return; }
    abandoned = null;
    if (kept) clearState();
    startLeftover(left);
  }

  // ── Replay clips ──
  // The clip OBS saved: its sidecar from the ring's last seconds, lined up from the clip's end (its duration from the
  // file), into the recording's folder, else Replays under the recordings folder, by a rename on the same drive.
  async function fileClip(clipPath, { endAt, asked }) {
    const settled = await filing.waitForStableFile(clipPath, { fs: fsModule, setTimer, now, stableMs: Math.min(stableMs, 500), timeoutMs: Math.min(stableTimeoutMs, 10000) });
    if (!settled.ok) { log(`[RacingDesk] Replay: ${clipPath} was not filed: ${settled.why}`); return null; }
    const info = readMp4(clipPath);
    const durationMs = Number.isFinite(info.durationMs) ? info.durationMs : clipSeconds() * 1000;
    const videoStart = endAt - durationMs;
    const frames = ring.filter((f) => f.at >= videoStart - 50 && f.at <= endAt + 50);
    if (!frames.some((f) => isSimLive(f.payload))) {
      log(`[RacingDesk] Replay: ${clipPath} was saved with no sim session live, so it is left as it is`);
      return null;
    }
    const where = session && session.folder ? session.folder : (recordFolder() ? path.join(recordFolder(), 'Replays') : null);
    const writer = createSidecar({ write: (f, text) => fsModule.appendFileSync(f, text), now });
    let sidecarPath = sidecarPathFor(clipPath);
    writer.start({ path: sidecarPath, startedAt: videoStart, producer: 'obs', obsOutputPath: clipPath, kind: 'replay' });
    for (const f of frames) if (f.at >= videoStart) writer.frame(f.payload, { at: f.at });
    writer.flush();
    let finalClip = clipPath;
    if (where && filing.sameDrive(clipPath, where)) {
      const target = filing.uniquePath(path.join(where, path.basename(clipPath)), { exists: (p) => { try { fsModule.statSync(p); return true; } catch (e) { return false; } } });
      const moved = await filing.moveFile(clipPath, target, { fs: fsModule, setTimer, retryMs: moveRetryMs });
      if (moved.ok) {
        finalClip = moved.to;
        const sidecarTarget = sidecarPathFor(finalClip);
        const movedSidecar = await filing.moveFile(sidecarPath, sidecarTarget, { fs: fsModule, setTimer, retryMs: moveRetryMs });
        if (movedSidecar.ok) { writer.relocate(sidecarTarget); sidecarPath = sidecarTarget; }
      } else {
        log(`[RacingDesk] Replay: ${clipPath} stays where OBS saved it: ${moved.why}`);
      }
    }
    const alignment = Number.isFinite(info.durationMs)
      ? { method: 'end', videoStartUtc: new Date(videoStart).toISOString(), durationMs: Math.round(info.durationMs), endFrom: asked ? 'request' : 'event' }
      : { method: 'none', why: info.problem || 'the clip said nothing of its length' };
    const result = writer.stop({ stoppedAt: endAt, reason: 'saved', obsOutputPath: finalClip, videoOffsetMs: 0, alignment });
    if (session) session.clips.push(finalClip);
    replay.lastSaved = { path: finalClip, sidecar: sidecarPath, at: now(), frames: result ? result.frames : 0 };
    log(`[RacingDesk] Replay: saved ${finalClip} with ${result ? result.frames : 0} frames of telemetry`);
    announce();
    return replay.lastSaved;
  }

  function onReplaySaved(data) {
    const clip = typeof data.savedReplayPath === 'string' && data.savedReplayPath ? data.savedReplayPath : null;
    const asked = pendingSave;
    pendingSave = null;
    const endAt = asked ? asked.sentAt : now();
    if (asked) asked.resolve(clip);
    if (!clip) return;
    fileClip(clip, { endAt, asked: !!asked }).catch((e) => log(`[RacingDesk] Replay: filing the clip failed: ${e.message}`));
  }

  // The replay buffer's own events. STARTING and STOPPING say the output is not active (obs-websocket's outputActive is
  // false for every state but STARTED, RESUMED and RECONNECTED), and STARTING comes after the StartReplayBuffer answer,
  // so they say nothing of whether the buffer is ours or running: only STARTED and STOPPED do.
  function onReplayState(data) {
    const state = typeof data.outputState === 'string' ? data.outputState : null;
    const was = replay.running;
    if (state === STATE.STARTED) {
      replay.running = true;
    } else if (state === STATE.STOPPED) {
      replay.running = false;
      replay.ours = false;
      ring.length = 0;
    } else if (state !== null) {
      announce();   // STARTING, STOPPING: transitions
      return;
    } else if (typeof data.outputActive === 'boolean') {
      // An event with no state word: the flag is all there is.
      replay.running = data.outputActive;
      if (!replay.running) { replay.ours = false; ring.length = 0; }
    } else {
      return;
    }
    if (replay.running && !was) { replay.unavailable = null; readReplaySeconds().catch(() => {}); bookTap(); }
    announce();
  }

  // OBS's own length for the buffer (its profile's RecRBTime), which the ring is sized by.
  async function readReplaySeconds() {
    if (!client.identified()) return;
    try {
      const answer = await client.request('GetProfileParameter', { parameterCategory: 'AdvOut', parameterName: 'RecRBTime' });
      const n = Number(answer && answer.parameterValue);
      if (Number.isFinite(n) && n > 0) replay.seconds = n;
    } catch (e) { /* the card's length, then */ }
  }

  // OBS says it has no replay buffer: either its profile has none (Set up OBS is what is missing), or Set up OBS made
  // the profile say it over the WebSocket and OBS builds the buffer at its next start.
  async function noReplayBufferSentence() {
    try {
      const answer = await client.request('GetProfileParameter', { parameterCategory: 'AdvOut', parameterName: 'RecRB' });
      if (answer && answer.parameterValue === 'true') return REPLAY_NEXT_START;
    } catch (e) { /* the sentence for none */ }
    return REPLAY_NONE;
  }

  async function startReplayBuffer(why) {
    replay.busy = true;
    try {
      await client.request('StartReplayBuffer');
      replay.ours = true;
      replay.running = true;
      replay.unavailable = null;
      replay.failedAt = 0;
      log(`[RacingDesk] Replay buffer started (${why})`);
      readReplaySeconds().catch(() => {});
      bookTap();
    } catch (e) {
      if (e && e.code === 500) {
        // Running already, or still stopping: not ours. The event that says it has stopped is what is waited for, and
        // the next look starts it.
        replay.running = true;
      } else {
        replay.failedAt = now();
        if (e && e.code === 604) {
          replay.unavailable = await noReplayBufferSentence();
          log(`[RacingDesk] Replay buffer: OBS has none (${replay.unavailable === REPLAY_NEXT_START ? 'its profile has one, from the next start' : 'RecRB is off: press Set up OBS'})`);
        } else if (e && e.code !== 'not-connected') {
          log(`[RacingDesk] Replay buffer could not be started: ${e.message}`);
        }
      }
    } finally {
      replay.busy = false;
    }
    announce();
  }

  async function stopReplayBuffer(why) {
    if (!replay.ours) return;
    replay.busy = true;
    try {
      await client.request('StopReplayBuffer');
      log(`[RacingDesk] Replay buffer stopped (${why})`);
    } catch (e) { /* not running, or OBS gone */ } finally {
      replay.busy = false;
    }
    replay.ours = false;
    replay.running = false;
    ring.length = 0;
    announce();
  }

  // Started when he gets in the car and stopped when he gets out, while "Instant replay" is on, and a live sim session
  // has him in the car — not the demo, which is "in the car" too. A start that failed is tried again no sooner than a
  // minute on; one that did not fail is not held back: out of the car for ten seconds and back, it is started at once.
  // Settings are read at each look, so the switch acts at once.
  function reconcileReplayBuffer(set, here) {
    const on = set.recordingInstantReplay === true;
    replay.settingSeconds = replaySettingSeconds(set);
    if (!client.identified()) return;
    if (on && here) {
      if (!replay.running && !replay.busy && (!replay.failedAt || now() - replay.failedAt >= replayRetryMs)) {
        startReplayBuffer(replay.failedAt ? 'in the car, tried again' : 'in the car').catch(() => {});
      }
    } else if (replay.running && replay.ours && !replay.busy) {
      stopReplayBuffer(on ? 'out of the car' : 'instant replay switched off').catch(() => {});
    }
  }

  // ── Free space ──
  // The folder OBS will write to, which is not Racing Desk's own setting while Set up OBS has not run, or could not
  // move OBS's folder: OBS's own answer while it answers, else the folder its profile says, else ours.
  async function wantedFolder() {
    if (outputPath) return path.dirname(outputPath);
    if (client.identified()) {
      try {
        const answered = await client.request('GetRecordDirectory');
        if (answered && typeof answered.recordDirectory === 'string' && answered.recordDirectory) return answered.recordDirectory;
      } catch (e) { /* the profile's, then */ }
    }
    let profile = null;
    try { profile = obsFolder(); } catch (e) { profile = null; }
    return profile || recordFolder();
  }

  async function refreshFree(folder) {
    const where = folder || await wantedFolder();
    if (!where) return null;
    let bytesFree = null;
    try { bytesFree = await freeSpace(where); } catch (e) { bytesFree = null; }
    free = bytesFree === null ? null : { bytes: bytesFree, at: now(), folder: where };
    return bytesFree;
  }

  function bookIdleFree() {
    if (freeTimer !== null) clearTimer(freeTimer);
    freeTimer = unrefed(setTimer(async () => {
      freeTimer = null;
      if (disposed) return;
      if (!recording) { await refreshFree(); announce(); }
      bookIdleFree();
    }, idleFreeEveryMs));
  }

  // ── While recording: OBS's own numbers, and the floor ──
  async function pollStatus() {
    if (!recording || disposed) return;
    const gen = generation;
    try {
      const s = await client.request('GetRecordStatus');
      if (gen === generation && recording) {
        if (s && s.outputActive === false) {
          // Whatever the events said, OBS says nothing is recording: believe it. It ended some time since the last look
          // that said it was running, which is the latest the file's end can be put at.
          ended('OBS said it was not recording', { file: true, endedAt: lastSeenAt || null, endFrom: 'lastSeen' });
          announce();
          return;
        }
        if (s && s.outputActive === true) { lastSeenAt = now(); if (owned) writeState(); }
        if (s && typeof s.outputBytes === 'number') bytes = s.outputBytes;
        if (s && typeof s.outputDuration === 'number' && s.outputDuration > 5000 && bytes > 0) bytesPerSecond = bytes / (s.outputDuration / 1000);
      }
    } catch (e) { /* OBS gone, or busy: the next tick */ }
    const bytesFree = await refreshFree();
    if (recording && owned && bytesFree !== null && bytesFree < floorStopBytes) {
      lowDisk = `Recording stopped: only ${gb(bytesFree)} GB left on ${driveOf(free.folder)}.`;
      log(`[RacingDesk] Recording: ${lowDisk}`);
      stop().catch(() => {});
    }
    announce();
    if (recording) bookStatus();
  }

  function bookStatus() {
    if (statusTimer !== null) clearTimer(statusTimer);
    statusTimer = unrefed(setTimer(pollStatus, statusEveryMs));
  }

  function unbookStatus() {
    if (statusTimer !== null) { clearTimer(statusTimer); statusTimer = null; }
  }

  function cancelLost() {
    if (lostTimer !== null) { clearTimer(lostTimer); lostTimer = null; }
  }

  // The recording is over, as far as this keeper is concerned. `keepState` leaves the state file where it is: OBS has
  // not said the recording ended, only that it cannot be reached, so the next connection may find it still going.
  // `file` says the file is complete, and the sidecar is filed on its own (the move, the offset); otherwise it ends now.
  // The file's end, for lining it up from its end, is the moment its recording stopped: when StopRecord was sent or OBS's
  // STOPPING arrived, else `endedAt` where the caller knows it (the last moment OBS was seen recording, for a recording
  // that ended while it could not be asked), else now — not when STOPPED arrived, which comes after the encoder has
  // flushed and the file is closed.
  function ended(reason, { keepState = false, stopValue = false, file = false, endedAt = null, endFrom = null } = {}) {
    generation++;
    const at = now();
    // A stop that was asked for (or announced) is when the file ended, whoever else knows better how late it is.
    const end = stopRequestedAt !== null ? stopRequestedAt : (endedAt !== null ? endedAt : at);
    const from = stopRequestedAt !== null ? stopFrom : (endedAt !== null ? (endFrom || 'lastSeen') : 'event');
    const lastFile = outputPath;
    // A recording that was lost track of, not ended, is remembered, to be filed when OBS next answers (fileLeftover).
    if (keepState && key && session) abandoned = { key, files: [...session.files], folder: session.folder, endedAt: lastSeenAt || at };
    recording = false; starting = false; stopping = false; paused = false;
    cancelLost();
    unbookStatus();
    if (file) fileSidecar(reason, { endedAt: end, lastFile, endFrom: from });
    else endSidecar(reason);
    if (owned && !keepState) clearState();
    owned = false;
    auto = false;
    take = null;
    stopRequestedAt = null;
    stopFrom = null;
    settlePending(false, stopValue);
  }

  // ── Mirroring OBS ──
  function onRecordState(data) {
    autoGaveUp = null;   // OBS did something: a start auto-record gave up on is tried again
    switch (data.outputState) {
      case STATE.STARTING:
        starting = true;
        stopping = false;
        announce();
        break;
      case STATE.STARTED: {
        generation++;
        cancelLost();
        // A sidecar still open is a recording whose STOPPED was missed: it is closed here, not written into by this one.
        if (session) endSidecar('a new recording began');
        // One lost track of earlier, which is not this one, is over: filed, before this one's state is written.
        if (abandoned) settleLeftover(typeof data.outputPath === 'string' ? data.outputPath : null);
        recording = true;
        starting = false;
        stopping = false;
        paused = false;
        startedAt = now();
        lastSeenAt = startedAt;
        stopRequestedAt = null;
        stopFrom = null;
        bytes = 0;
        bytesPerSecond = null;
        lowDisk = null;
        outputPath = typeof data.outputPath === 'string' && data.outputPath ? data.outputPath : null;
        key = outputPath;
        splitSeen = false;
        // Ours if the StartRecord we sent is what this answers: a STARTED that came after the ten seconds are up counts,
        // within the claim's minute.
        owned = !!pendingStart || claimActive();
        auto = owned && !!((pendingStart && pendingStart.auto) || (claim && claim.auto));
        take = owned ? ((pendingStart && pendingStart.take) || (claim && claim.take) || null) : null;
        claim = null;
        if (owned) writeState();
        log(`[RacingDesk] Recording started${owned ? (auto ? ' (auto-record)' : take ? ' (a TV take)' : '') : ' (by OBS)'}: ${outputPath || 'path not said'}`);
        if (pendingStart) { const p = pendingStart; pendingStart = null; p.resolve(true); }
        bookStatus();
        announce();
        beginSidecar({ take });
        break;
      }
      case STATE.STOPPING:
        stopping = true;
        // A stop made in OBS: the file ends about now. One we asked for was timed when it was sent.
        if (stopRequestedAt === null && (recording || starting)) { stopRequestedAt = now(); stopFrom = 'event'; }
        announce();
        break;
      case STATE.STOPPED: {
        generation++;
        // STOPPED's path is OBS's last file name, which for a split recording is the first file again: the file
        // RecordFileChanged named is the one that was written last.
        if (typeof data.outputPath === 'string' && data.outputPath && !splitSeen) outputPath = data.outputPath;
        const was = recording || starting;
        const wasOwned = owned;
        if (pendingStart && !recording) claim = null;
        ended('stopped', { stopValue: true, file: true });
        if (was) log(`[RacingDesk] Recording stopped${wasOwned ? '' : ' (by OBS)'}: ${outputPath || 'path not said'}`);
        announce();
        break;
      }
      case STATE.PAUSED:
        paused = true;
        notePause(true);
        announce();
        break;
      case STATE.RESUMED:
        paused = false;
        notePause(false);
        announce();
        break;
      default:
        break;
    }
  }

  function onFileChanged(data) {
    if (typeof data.newOutputPath !== 'string' || !data.newOutputPath) return;
    outputPath = data.newOutputPath;
    splitSeen = true;
    if (session) {
      session.files.push(outputPath);
      session.writer.marker({ type: 'file_changed', path: outputPath }, { at: now() });
    }
    if (owned) writeState();
    log(`[RacingDesk] Recording: OBS began a new file: ${outputPath}`);
    announce();
  }

  // OBS is open: a recording already running is taken over, ours if the state file says so (or a StartRecord of ours
  // is waiting for its STARTED); one this keeper thinks is running that OBS says is not is over. The replay buffer's
  // state is asked too.
  async function takeOver() {
    const gen = generation;
    let s;
    try { s = await client.request('GetRecordStatus'); } catch (e) { return; }
    if (gen !== generation) return;   // a STARTED or STOPPED said how it stands while this was asking
    if (!s || !s.outputActive) {
      if (recording) {
        // We thought it was recording and OBS says not: it ended while we were away, some time after the last moment it
        // was seen recording (which is the latest its file's end can be put at; the time of this answer is not).
        ended('OBS stopped while Racing Desk was away', { file: true, endedAt: lastSeenAt || null, endFrom: 'lastSeen' });
      } else {
        // A recording lost track of earlier, or a state file from one, that is not running any more: filed.
        settleLeftover(null);
      }
      announce();
      return;
    }
    let found = null;
    try {
      const out = await client.request('GetOutputSettings', { outputName: RECORD_OUTPUT });
      const os = out && out.outputSettings ? out.outputSettings : {};
      found = typeof os.path === 'string' && os.path ? os.path : (typeof os.url === 'string' && os.url ? os.url : null);
    } catch (e) { found = null; }
    if (gen !== generation) return;
    if (recording) {
      if (!key || !found || samePath(key, found)) {
        // The same recording, and still going: only OBS's own numbers to catch up on.
        paused = !!s.outputPaused;
        lastSeenAt = now();
        if (typeof s.outputBytes === 'number') bytes = s.outputBytes;
        announce();
        return;
      }
      // Another recording is running than the one we had: ours is over.
      ended('OBS began another recording while Racing Desk was away', { file: true, endedAt: lastSeenAt || null, endFrom: 'lastSeen' });
    }
    // One lost track of earlier that is not this one is over, and is filed (not waited for); this one is taken over.
    settleLeftover(found);
    recording = true;
    starting = false;
    stopping = false;
    paused = !!s.outputPaused;
    lastSeenAt = now();
    stopRequestedAt = null;
    stopFrom = null;
    startedAt = now() - (typeof s.outputDuration === 'number' ? s.outputDuration : 0);
    bytes = typeof s.outputBytes === 'number' ? s.outputBytes : 0;
    key = found;
    outputPath = found;
    splitSeen = false;
    const kept = readState();
    const keptIsThis = !!(kept && found && samePath(kept.owned, found));
    owned = keptIsThis || claimActive();
    auto = owned && !!((keptIsThis && kept.auto === true) || (claim && claim.auto));
    if (keptIsThis && typeof kept.current === 'string' && kept.current) { outputPath = kept.current; splitSeen = !samePath(kept.current, found); }
    if (keptIsThis && typeof kept.startedAt === 'number' && kept.startedAt > 0 && kept.startedAt <= now()) startedAt = kept.startedAt;
    claim = null;
    if (owned) writeState();
    log(`[RacingDesk] Recording already running${owned ? ', ours' : ' (OBS\'s)'}: ${found || 'path not said'}, ${Math.round((now() - startedAt) / 1000)} s in`);
    bookStatus();
    announce();
    // The host may not be up yet (Racing Desk's own start): the telemetry is waited for, not asked once.
    await beginSidecar({ keptFolder: keptIsThis ? kept.folder : null, patient: true });
  }

  async function askReplayStatus() {
    try {
      const r = await client.request('GetReplayBufferStatus');
      replay.running = !!(r && r.outputActive);
      replay.unavailable = null;
      if (replay.running) { bookTap(); readReplaySeconds().catch(() => {}); }
    } catch (e) {
      if (e && e.code === 604) { replay.running = false; replay.unavailable = await noReplayBufferSentence(); }
    }
    announce();
  }

  function onClientChange(state) {
    if (state.phase === 'identified') {
      cancelLost();
      // Something has changed: a start auto-record gave up on, and a replay buffer that would not start, are tried again.
      autoGaveUp = null;
      replay.failedAt = 0;
      // The recording first, then the replay buffer's state (after, so that the take-over's requests stay in order).
      takeOver().catch((e) => log(`[RacingDesk] Recording: take-over failed: ${e.message}`)).finally(() => { if (client.identified()) askReplayStatus().catch(() => {}); });
    } else if (state.phase === 'closed' || state.phase === 'stopped') {
      // A connection that closed is not a recording that ended (see the rules at the top). What cannot be waited for
      // any more is let go of: a start whose STARTED can no longer come, a stop whose STOPPED can no longer come.
      if (!recording) starting = false;
      stopping = false;
      if (pendingStart) { const p = pendingStart; pendingStart = null; p.resolve('lost'); }
      if (pendingStop) { const p = pendingStop; pendingStop = null; p.resolve(false); }
      if (pendingSave) { const p = pendingSave; pendingSave = null; p.resolve(null); }
      if (recording && lostTimer === null && !disposed) {
        // The last moment OBS is known to have been recording: where its file's end is put if it never says.
        lastSeenAt = now();
        if (owned) writeState();
        lostTimer = unrefed(setTimer(() => {
          lostTimer = null;
          if (!recording || client.identified() || disposed) return;
          log('[RacingDesk] Recording: OBS has not been reachable for a while; the recording is no longer followed (it is kept as Racing Desk\'s if OBS is found still recording)');
          ended('OBS went away', { keepState: true });
          announce();
        }, lostAfterMs));
      }
    }
    announce();
  }

  // OBS is exiting: it stops its own outputs on the way out, so the recording is over and its file closed.
  function onExitStarted() {
    log('[RacingDesk] OBS is closing');
    if (recording || starting) ended('OBS went away', { file: true });
    replay.running = false;
    replay.ours = false;
    ring.length = 0;
    announce();
  }

  // ── Waiting ──
  function waitFor(check, ms) {
    return new Promise((resolve) => {
      if (check()) { resolve(true); return; }
      const started = now();
      const look = () => {
        if (check()) { resolve(true); return; }
        if (now() - started >= ms || disposed) { resolve(false); return; }
        unrefed(setTimer(look, 50));
      };
      look();
    });
  }

  // ── Presses ──
  const passwordSentence = (s) => (s.authFailed ? REFUSED_PASSWORD : MISSING_PASSWORD);

  // With OBS not answering and no starting it from here (a key, the car, auto-record, Save replay): what to say, and
  // whether the HUD may be told (`hud`). The HUD says OBS is not open only when it is known not to be: with OBS open and
  // its WebSocket off, or refusing the password, the sentence would be false, and it is filmed. A press asks tasklist;
  // auto-record, which tries at every flag, does not (tasklist runs only on a press) and goes by the WebSocket alone.
  async function notAnswering({ source = 'desk' } = {}) {
    const st = client.state();
    if (source === 'auto') {
      if (st.authFailed || st.passwordMissing) return { text: passwordSentence(st), hud: false };
      return { text: NOT_OPEN, hud: true };
    }
    let running = null;
    try { running = await obsRunning(); } catch (e) { running = null; }
    if (running === false) return { text: NOT_OPEN, hud: true };
    if (running === true) return { text: st.authFailed || st.passwordMissing ? passwordSentence(st) : OPEN_NOT_REACHED, hud: false };
    return { text: NOT_OPEN, hud: false };
  }

  // The two sentences the HUD may show, and no others. Auto-record says each once a session, however often it tries.
  function sayOnHud(kind, text, fromAuto) {
    if (fromAuto) {
      const session = rules.state().lastSession;
      if (autoSaid[kind] === session) return;
      autoSaid[kind] = session;
    }
    notice(text);
  }

  async function record({ source = 'desk', take: asTake = null } = {}) {
    const fromAuto = source === 'auto';
    const fromTv = source === 'tv';
    if (busy === 'starting-obs') return answer(false, 'OBS is starting');
    if (busy) return answer(false, ALREADY);
    if (!client.identified()) {
      const fromKey = source === 'key';
      if (fromKey || fromAuto || fromTv || inCar()) {
        // Nothing is started from here.
        const said = await notAnswering({ source });
        if (said.hud) sayOnHud('open', NOTICE_NOT_OPEN, fromAuto);
        return answer(false, said.text);
      }
      if (settings().obsStartOnRecord === false) return answer(false, NOT_OPEN);
      busy = 'starting-obs';
      announce();
      let started;
      try { started = await startObs(); } catch (e) { started = { ok: false, reason: e.message }; }
      if (!started || !started.ok) { busy = null; return answer(false, (started && started.reason) || 'OBS could not be started'); }
      if (started.running) {
        // OBS is open already and is not answering. If it is the password, that is what to say now: waiting half a
        // minute and then blaming a crash dialog that is not there sends him to the wrong place.
        const st = client.state();
        if (!client.identified() && (st.authFailed || st.passwordMissing)) { busy = null; return answer(false, passwordSentence(st)); }
      }
      client.tryNow();
      const open = await waitFor(() => client.identified(), waitObsMs);
      busy = null;
      if (!open) {
        const st = client.state();
        return answer(false, st.authFailed || st.passwordMissing ? passwordSentence(st) : NOT_ANSWERING);
      }
      // Taking over what OBS had running is under way; give it the moment.
      await waitFor(() => recording || !client.identified(), 300);
    }
    if (recording || starting) return answer(false, ALREADY);
    const where = await wantedFolder();
    const bytesFree = await refreshFree(where);
    if (bytesFree === null) {
      return answer(false, `Racing Desk could not tell how much room is left on ${driveOf(where) || 'the recording drive'}, so it did not start recording.`);
    }
    if (bytesFree < floorStartBytes) {
      return answer(false, `Only ${gb(bytesFree)} GB free on ${driveOf(free.folder)}. Recording needs about ${gb(floorStartBytes)} GB.`);
    }
    busy = 'starting';
    lowDisk = null;
    let resolveStart;
    const startedPromise = new Promise((resolve) => { resolveStart = resolve; });
    const taking = fromTv && asTake && typeof asTake.folder === 'string' && typeof asTake.baseName === 'string' ? { folder: asTake.folder, baseName: asTake.baseName } : null;
    pendingStart = { resolve: resolveStart, auto: fromAuto, take: taking };
    claim = { at: now(), auto: fromAuto, take: taking };
    announce();
    try {
      await client.request('StartRecord');
    } catch (e) {
      busy = null;
      pendingStart = null;
      if (e && (e.code === 'disconnected' || e.code === 'timeout')) {
        // Sent, perhaps, and not answered: the claim stays, so that the STARTED that may follow is ours.
        return answer(false, LOST_START);
      }
      claim = null;
      if (e && e.code === 500) return answer(false, ALREADY);
      return answer(false, `OBS could not start recording: ${e.message}`, { notStarted: true });
    }
    const timer = unrefed(setTimer(() => { if (pendingStart) { const p = pendingStart; pendingStart = null; p.resolve(false); } }, waitStartedMs));
    const ok = await startedPromise;
    clearTimer(timer);
    busy = null;
    if (ok === 'lost') {
      starting = false;
      return answer(false, LOST_START);
    }
    if (!ok) {
      // The claim is kept for its minute: OBS may be slow, and a STARTED that comes now is still ours. Auto-record's is
      // let go: its start may have been stopped by a dialog, and a Ctrl+Space he presses after closing it is his.
      starting = false;
      if (fromAuto) claim = null;
      if (!recording) sayOnHud('started', NOTICE_NOT_STARTED, fromAuto);
      return answer(false, NOT_STARTED, { notStarted: true });
    }
    return answer(true, 'Recording', { path: outputPath });
  }

  async function stop() {
    if (busy === 'stopping') return answer(false, 'Stopping');
    if (!recording && !starting) return answer(false, NOT_RECORDING);
    if (!client.identified()) return answer(false, NOT_OPEN);
    busy = 'stopping';
    let resolveStop;
    const stoppedPromise = new Promise((resolve) => { resolveStop = resolve; });
    pendingStop = { resolve: resolveStop };
    announce();
    let said = null;
    // The file ends when the stop is asked for, not when STOPPED comes after the encoder has flushed.
    const timed = stopRequestedAt === null;
    if (timed) { stopRequestedAt = now(); stopFrom = 'request'; }
    try {
      said = await client.request('StopRecord');
    } catch (e) {
      busy = null;
      pendingStop = null;
      if (timed) { stopRequestedAt = null; stopFrom = null; }
      if (e && e.code === 501) {
        // OBS says nothing is recording: believe it.
        ended('OBS said it was not recording', { file: true, endedAt: lastSeenAt || null, endFrom: 'lastSeen' });
        return answer(false, NOT_RECORDING);
      }
      return answer(false, `OBS could not stop recording: ${e.message}`);
    }
    const timer = unrefed(setTimer(() => { if (pendingStop) { const p = pendingStop; pendingStop = null; p.resolve(false); } }, waitStoppedMs));
    const ok = await stoppedPromise;
    clearTimer(timer);
    busy = null;
    const file = splitSeen ? outputPath : ((said && said.outputPath) || outputPath);
    if (!ok) return answer(false, "OBS didn't say the recording stopped. It may be showing a message.");
    return answer(true, 'Stopped', { path: file });
  }

  function toggle({ source = 'desk' } = {}) {
    return recording || starting ? stop() : record({ source });
  }

  // Save replay: SaveReplayBuffer while the buffer runs; the clip's sidecar and its filing follow ReplayBufferSaved.
  async function saveReplay({ source = 'desk' } = {}) {
    if (busy === 'saving') return answer(false, 'Saving the replay');
    if (!client.identified()) {
      const said = await notAnswering({ source });
      if (said.hud) notice(NOTICE_NOT_OPEN);
      return answer(false, said.text);
    }
    if (settings().recordingInstantReplay !== true) return answer(false, REPLAY_OFF);
    if (!replay.running) return answer(false, replay.unavailable || REPLAY_NOT_RUNNING);
    busy = 'saving';
    announce();
    let resolveSave;
    const savedPromise = new Promise((resolve) => { resolveSave = resolve; });
    pendingSave = { resolve: resolveSave, sentAt: now(), source };
    try {
      await client.request('SaveReplayBuffer');
    } catch (e) {
      busy = null;
      pendingSave = null;
      if (e && e.code === 501) { replay.running = false; replay.ours = false; return answer(false, REPLAY_NOT_RUNNING); }
      return answer(false, `OBS could not save the replay: ${e.message}`);
    }
    const timer = unrefed(setTimer(() => { if (pendingSave) { const p = pendingSave; pendingSave = null; p.resolve(null); } }, waitSavedMs));
    const clip = await savedPromise;
    clearTimer(timer);
    busy = null;
    if (!clip) return answer(false, REPLAY_NOT_SAVED);
    return answer(true, 'Replay saved', { path: clip });
  }

  // ── Fed the payload main.js polls (once a second out of the car, twice in it) ──
  // `payload` is null when the poll got no answer. main.js's in-car signal says he is out of the car after three silent
  // seconds, which is not him getting out: a car left is seen by a payload that answers. So for a minute of silence
  // the keeper goes by what the last payload that answered said of him; after that, by the signal.
  function feed(payload) {
    if (disposed) return;
    const at = now();
    const signal = inCar();
    let here;
    if (payload && typeof payload === 'object') {
      silentSince = null;
      answered = { here: signal, live: isSimLive(payload) };
      lastPayload = { at, payload };
      here = signal;
    } else {
      if (silentSince === null) silentSince = at;
      here = signal || (!!answered && answered.here && at - silentSince < silentLimitMs);
    }
    if (here && !lastHere) autoGaveUp = null;   // a new stint
    lastHere = here;
    inSession = here && !!answered && answered.live;
    const set = settings();
    reconcileReplayBuffer(set, inSession);
    if (inSession && replay.running) bookTap();
    if (set.recordingAutoRecord === false || autoHeld) return;
    let decision = null;
    try {
      decision = rules.feed({ payload, inCar: here, recording, auto: recording && owned && auto });
    } catch (e) {
      log(`[RacingDesk] Auto-record: ${e.message}`);
      return;
    }
    if (!decision) return;
    if (decision.start) autoStart(decision.why);
    else if (decision.stop) autoStop(decision.why);
  }

  function autoStart(why) {
    if (busy || recording || starting) return;
    const session = rules.state().lastSession;
    // OBS answered a start and did not carry it out (its Settings window open, a folder that is gone): it would be the
    // same at every try, with a dialog over the sim each time. Not again this session, until something changes.
    if (autoGaveUp && autoGaveUp.session === session) return;
    if (now() - autoTriedAt < autoRetryMs) return;
    autoTriedAt = now();
    log(`[RacingDesk] Auto-record: ${why}, starting the recording`);
    record({ source: 'auto' }).then((a) => {
      if (!a.ok) {
        log(`[RacingDesk] Auto-record: not started: ${a.reason}`);
        if (a.notStarted && !recording) {
          autoGaveUp = { session };
          log('[RacingDesk] Auto-record: OBS did not carry the start out, so it is not asked again this session');
        }
      }
    }).catch((e) => log(`[RacingDesk] Auto-record: ${e.message}`));
  }

  function autoStop(why) {
    if (!recording || !owned || !auto || busy) return;
    log(`[RacingDesk] Auto-record: ${why}, stopping the recording`);
    stop().then((a) => {
      if (!a.ok) log(`[RacingDesk] Auto-record: not stopped: ${a.reason}`);
    }).catch((e) => log(`[RacingDesk] Auto-record: ${e.message}`));
  }

  // Auto-record held (a TV take is under way: the replay's pit lane and flags are not the race's): the rules are not
  // asked until the hold is let go. Resolves to the function that lets it go; holding again is one hold.
  function holdAuto(reason = 'held') {
    autoHeld = String(reason);
    announce();
    return () => { if (autoHeld === String(reason)) { autoHeld = null; announce(); } };
  }

  // ── Quitting ──
  // A start that is under way counts: Racing Desk may be quit between StartRecord and the STARTED that follows it.
  // A filing still under way counts too: a recording stopped a moment before the quit is not filed yet.
  function needsStopForQuit() {
    return (owned && (recording || starting)) || (!recording && claimActive()) || !!session || (replay.running && replay.ours) || pendingFilings.size > 0;
  }

  async function stopOwnedForQuit() {
    if (!recording && claimActive() && client.identified()) {
      // StartRecord is on its way: its STARTED is waited for a moment, so that what it starts is stopped too.
      await waitFor(() => recording, quitWaitMs);
    }
    if (owned && (recording || starting) && client.identified()) {
      log('[RacingDesk] Recording: quitting, so the recording Racing Desk started is stopped');
      let resolveStop;
      const stoppedPromise = new Promise((resolve) => { resolveStop = resolve; });
      pendingStop = { resolve: resolveStop };
      if (stopRequestedAt === null) { stopRequestedAt = now(); stopFrom = 'request'; }
      try { await client.request('StopRecord', {}, { timeoutMs: quitWaitMs }); } catch (e) { /* OBS gone, or not recording */ }
      const timer = unrefed(setTimer(() => { if (pendingStop) { const p = pendingStop; pendingStop = null; p.resolve(false); } }, quitWaitMs));
      const ok = await stoppedPromise;
      clearTimer(timer);
      if (!ok) log('[RacingDesk] Recording: OBS did not say the recording stopped within the wait');
    } else if (owned && (recording || starting)) {
      // OBS cannot be asked, and the recording may well be running on: the state file stays, so that the next start
      // finds it and takes it over as Racing Desk's own.
      log('[RacingDesk] Recording: quitting with OBS out of reach; the recording it may still be making is kept as Racing Desk\'s');
    }
    if (replay.running && replay.ours && client.identified()) {
      try { await client.request('StopReplayBuffer', {}, { timeoutMs: quitWaitMs }); log('[RacingDesk] Replay buffer stopped (Racing Desk quit)'); } catch (e) { /* gone */ }
      replay.ours = false;
      replay.running = false;
    }
    // A recording that has just stopped is being filed — the file held still for two seconds, moved, its sidecar finished —
    // and the app is about to go: the filing is waited for, for a few seconds at most, or the file stays in OBS's folder
    // with a sidecar that has no summary.
    if (pendingFilings.size) {
      log('[RacingDesk] Recording: quitting, so the recording just stopped is filed first');
      let timer = null;
      await Promise.race([
        Promise.allSettled([...pendingFilings]),
        new Promise((resolve) => { timer = unrefed(setTimer(resolve, filingQuitWaitMs)); }),
      ]);
      if (timer !== null) clearTimer(timer);
      if (pendingFilings.size) log('[RacingDesk] Recording: the filing was not finished in time; the file stays where OBS wrote it');
    }
    endSidecar('Racing Desk quit');
    return { ok: true };
  }

  function start() {
    offs.push(client.on('RecordStateChanged', onRecordState));
    offs.push(client.on('RecordFileChanged', onFileChanged));
    offs.push(client.on('ReplayBufferStateChanged', onReplayState));
    offs.push(client.on('ReplayBufferSaved', onReplaySaved));
    offs.push(client.on('ExitStarted', onExitStarted));
    offs.push(client.onChange(onClientChange));
    refreshFree().then(() => announce());
    bookIdleFree();
    if (client.identified()) takeOver().catch(() => {});
  }

  function dispose() {
    disposed = true;
    for (const off of offs) { try { off(); } catch (e) { /* gone */ } }
    unbookStatus();
    cancelLost();
    if (freeTimer !== null) { clearTimer(freeTimer); freeTimer = null; }
    if (tapTimer !== null) { clearTimer(tapTimer); tapTimer = null; }
    endSidecar('disposed');
  }

  return { start, dispose, record, stop, toggle, saveReplay, feed, status, stopOwnedForQuit, needsStopForQuit, refreshFree, holdAuto };
}

module.exports = {
  STATE, RECORD_OUTPUT, FLOOR_START_BYTES, FLOOR_STOP_BYTES, DEFAULT_BYTES_PER_SECOND, WAIT_STARTED_MS, WAIT_OBS_MS, WAIT_SAVED_MS, QUIT_WAIT_MS, LOST_AFTER_MS, CLAIM_MS,
  AUTO_RETRY_MS, REPLAY_RETRY_MS, REPLAY_SECONDS, FILING_QUIT_WAIT_MS, SILENT_LIMIT_MS,
  NOT_OPEN, NOTICE_NOT_OPEN, NOTICE_NOT_STARTED, NOT_STARTED, NOT_ANSWERING, REFUSED_PASSWORD, MISSING_PASSWORD, OPEN_NOT_REACHED, LOST_START, ALREADY, NOT_RECORDING,
  REPLAY_OFF, REPLAY_NOT_RUNNING, REPLAY_NONE, REPLAY_NEXT_START, REPLAY_NOT_SAVED,
  isSimLive, freeSpaceOf, readSidecarEnds, gb, driveOf, createRecordingKeeper,
};
