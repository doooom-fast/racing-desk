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
// - Ownership is claimed when StartRecord is sent and kept for a minute, so a STARTED that comes late (OBS busy), a
//   quit between StartRecord and STARTED, and a connection cut in between all still end with the recording ours.
// - The floor: no recording starts below about 20 GB free on the drive OBS records to (asked of OBS), and one of
//   ours is stopped at about 5 GB and said so in one sentence. At his 100 Mbps a drive fills at 43 GB an hour, and
//   OBS itself stops only at 50 MB, with a dialog over the sim. A folder that is not made yet is measured on the
//   nearest folder above it; a drive that cannot be measured at all is a recording that does not start.
// - Only a recording made while a sim session is live is filed — the sidecar, the chapters, the folder: his other
//   collections' recordings are left alone.
// - Auto-record (auto-record.js has the rules: the green flag in a race, pit exit elsewhere; stops on a new session
//   number, five seconds after the end of the race, and when he leaves the car) is fed the payload main.js polls,
//   starts a recording through the same press as a key in the car (never OBS), tries again no sooner than half a
//   minute after a start that failed, and stops only the recordings it started.
// - The replay buffer runs with the car while "Instant replay" is on: started when he gets in, stopped when he gets
//   out if this keeper started it, never started by this keeper when OBS has none (the card says to press Set up
//   OBS). Save replay (Ctrl+Shift+B, the tray, the Stream Deck) is SaveReplayBuffer; the clip OBS saves gets a
//   sidecar of its own from the last seconds of telemetry kept here, lined up from the clip's end, and goes into the
//   recording's folder, or into Replays under the recordings folder.
// - Chapters: a lap, an incident, pit in and out, a place gained, each sent to OBS as the sidecar finds it
//   (CreateRecordChapter; Hybrid MP4 alone takes them, and OBS adds its own "Start"), while "Chapters" is on and the
//   recording is not paused. Each is kept in the sidecar with its t.
// - After STOPPED the file is waited for, moved with its sidecar into the recording's folder (a rename on the same
//   drive; across drives it stays where OBS left it), and the video offset is read back from the chapters, else
//   taken from the file's end (filing.js, mp4-info.js); the sidecar's summary says which.
// - Nothing of this is drawn on the HUD: the desk's masthead, the tray and the Stream Deck show it.
const path = require('path');
const fs = require('fs');
const { createSidecar, sidecarPathFor, trackAndCar } = require('../telemetry-sidecar');
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
const CHAPTER_FAILED = 702;      // obs-websocket RequestProcessingFailed: the output takes no chapters (not Hybrid MP4)
const OUTPUT_PAUSED = 502;

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
  let claim = null;            // { at, auto } from the StartRecord we sent until the STARTED that answers it
  let pendingStart = null;     // { resolve, auto } while we wait for STARTED after our StartRecord
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
  let autoNoticedFor = null;   // the session key "OBS is not open" was said for, once
  const replay = { running: false, ours: false, unavailable: null, lastSaved: null, triedAt: 0, saving: false };
  const ring = [];             // { at, payload } for the last seconds, while the replay buffer runs
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
      fsModule.writeFileSync(tmp, JSON.stringify({ owned: key, current: outputPath, startedAt, auto, folder: session ? session.folder : null }));
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
  const replaySeconds = () => { const s = Number(settings().recordingInstantReplaySeconds); return Number.isFinite(s) && s > 0 ? s : REPLAY_SECONDS; };

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
      outputPath: s.outputPath, bytes: s.bytes, rate: Math.round(s.bytesPerSecond),
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

  function folderFor(payload, keptFolder) {
    if (typeof keptFolder === 'string' && keptFolder) return keptFolder;
    const root = recordFolder();
    if (!root || !key || !filing.sameDrive(key, root)) return null;
    const { track, car } = trackAndCar(payload);
    return path.join(root, filing.folderNameFor({ startedAt, track, car }));
  }

  async function beginSidecar({ keptFolder = null } = {}) {
    if (!key || (session && session.writer.isActive())) return;
    const mine = key;
    let payload = null;
    try { payload = await fetchPayload(); } catch (e) { payload = null; }
    if (!recording || key !== mine || (session && session.writer.isActive())) return;
    if (!isSimLive(payload)) {
      log('[RacingDesk] Recording: no sim session is live, so this recording gets no sidecar');
      return;
    }
    // One file per recording, by the file STARTED named (a split goes on in it). A file that has frames already —
    // Racing Desk was restarted, or lost OBS for a while — is gone on in, not given a second header.
    const file = sidecarPathFor(mine);
    const resume = sidecarHasContent(file);
    const s = { writer: null, key: mine, files: [mine], folder: null, chapterCount: 0, chaptersPossible: true, clips: [], resumed: resume, startedAt };
    s.writer = createSidecar({ write: (f, text) => fsModule.appendFileSync(f, text), now, onMarker: (m) => onMarkerFound(s, m) });
    try {
      s.writer.start({ path: file, startedAt, producer: 'obs', obsOutputPath: mine, resume, kind: 'recording' });
      session = s;
      s.writer.frame(payload, { at: now() });
    } catch (e) {
      log(`[RacingDesk] Recording: the sidecar could not be started: ${e.message}`);
      return;
    }
    s.folder = folderFor(payload, keptFolder);
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
    if (settings().recordingChapters === false || !s.chaptersPossible) return;
    const name = filing.chapterNameFor(marker);
    if (!name) return;
    const at = now();
    s.writer.chapter({ name, at });
    client.request('CreateRecordChapter', { chapterName: name }).then(() => {
      s.chapterCount++;
      announce();
    }).catch((e) => {
      if (e && e.code === CHAPTER_FAILED) {
        if (s.chaptersPossible) log('[RacingDesk] Recording: OBS takes no chapters in this file (not Hybrid MP4: press Set up OBS), so none more are sent');
        s.chaptersPossible = false;
      } else if (e && e.code === OUTPUT_PAUSED) {
        /* paused: the chapter is skipped */
      } else {
        log(`[RacingDesk] Recording: a chapter was not written: ${e.message}`);
      }
    });
  }

  // The frames: polled at 30 Hz while a sidecar is being written or the replay buffer runs (its ring).
  function wantTap() {
    return (session && session.writer.isActive()) || replay.running;
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
            if (replay.running) {
              ring.push({ at, payload: p });
              const keepMs = (replaySeconds() + RING_EXTRA_S) * 1000;
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
      const result = s.writer.stop({ stoppedAt: now(), reason, obsOutputPath: outputPath });
      if (result) log(`[RacingDesk] Recording: sidecar done, ${result.frames} frames, ${result.markers} markers, ${result.chapters} chapters`);
    } catch (e) {
      log(`[RacingDesk] Recording: the sidecar could not be finished: ${e.message}`);
    }
  }

  // The recording is over and its file complete (STOPPED, ExitStarted, OBS saying it is not recording): the session is
  // let go of here and filed on its own — the file waited for, moved with its sidecar, the offset read back.
  function fileSidecar(reason, { endedAt = now(), lastFile = outputPath } = {}) {
    if (!session) return;
    const s = session;
    session = null;
    if (!s.writer.isActive()) return;
    s.writer.flush();
    finishRecording(s, { reason, endedAt, lastFile }).catch((e) => {
      log(`[RacingDesk] Recording: filing failed: ${e.message}`);
      try { if (s.writer.isActive()) s.writer.stop({ stoppedAt: endedAt, reason, obsOutputPath: lastFile }); } catch (err) { /* gone */ }
    });
  }

  async function finishRecording(s, { reason, endedAt, lastFile }) {
    const files = [...new Set([...s.files, lastFile].filter(Boolean))];
    const timing = { fs: fsModule, setTimer, now, stableMs, timeoutMs: stableTimeoutMs };
    const moved = new Map();
    let folder = s.folder;
    let why = null;
    for (const f of files) {
      const settled = await filing.waitForStableFile(f, timing);
      if (!settled.ok) { log(`[RacingDesk] Recording: ${f} was not filed: ${settled.why}`); if (!why) why = settled.why; continue; }
      if (!folder) continue;
      const target = filing.uniquePath(path.join(folder, path.basename(f)), { exists: (p) => { try { fsModule.statSync(p); return true; } catch (e) { return false; } } });
      const result = await filing.moveFile(f, target, { fs: fsModule, setTimer, retryMs: moveRetryMs });
      if (result.ok) moved.set(f, result.to);
      else { log(`[RacingDesk] Recording: ${f} stays where OBS left it: ${result.why}`); if (!why) why = result.why; }
    }
    if (!folder && why === null) why = recordFolder() && s.key && !filing.sameDrive(s.key, recordFolder()) ? `${driveOf(s.key)} and ${driveOf(recordFolder())} are different drives` : 'no folder';
    // The sidecar goes with the first file.
    const first = files[0];
    const firstNow = moved.get(first) || first;
    let sidecarPath = s.writer.state().path;
    if (moved.has(first)) {
      const target = sidecarPathFor(firstNow);
      const result = await filing.moveFile(sidecarPath, target, { fs: fsModule, setTimer, retryMs: moveRetryMs });
      if (result.ok) { s.writer.relocate(target); sidecarPath = target; }
    }
    // The offset: from the chapters read back, else from the end.
    let alignment = null;
    let videoOffsetMs = null;
    const info = readMp4(firstNow);
    const ours = s.writer.state().chapters;
    const byChapters = info.chapters && info.chapters.length ? filing.alignFromChapters(ours, info.chapters) : null;
    if (byChapters) {
      videoOffsetMs = byChapters.videoOffsetMs;
      alignment = { method: 'chapters', pairs: byChapters.pairs, spreadMs: byChapters.spreadMs, fileChapters: info.chapters.length };
    } else if (Number.isFinite(info.durationMs)) {
      const byEnd = filing.alignFromEnd({ startedAt: s.startedAt, endedAt, durationMs: info.durationMs, approximate: !info.complete });
      if (byEnd) { videoOffsetMs = byEnd.videoOffsetMs; alignment = { method: 'end', videoStartUtc: byEnd.videoStartUtc, durationMs: byEnd.durationMs, ...(byEnd.approximate ? { approximate: true } : {}) }; }
    }
    if (!alignment) alignment = { method: 'none', why: info.problem || 'the file said nothing of its length' };
    const lastNow = moved.get(lastFile) || lastFile;
    const result = s.writer.stop({ stoppedAt: endedAt, reason, obsOutputPath: lastNow, videoOffsetMs, alignment });
    lastFiled = {
      at: now(), folder: moved.size ? folder : null, video: firstNow, sidecar: sidecarPath, files: files.map((f) => moved.get(f) || f),
      chapters: result ? result.chapters : 0, clips: s.clips.length, alignment, why: moved.size ? null : why,
    };
    log(`[RacingDesk] Recording: filed ${firstNow}${moved.size ? '' : ' (left where OBS wrote it)'}; offset ${videoOffsetMs === null ? 'not found' : `${videoOffsetMs} ms by ${alignment.method}`}; ${result ? `${result.frames} frames, ${result.chapters} chapters` : ''}`);
    announce();
  }

  // ── Replay clips ──
  // The clip OBS saved: its sidecar from the ring's last seconds, lined up from the clip's end (its duration from the
  // file), into the recording's folder, else Replays under the recordings folder, by a rename on the same drive.
  async function fileClip(clipPath, { endAt, asked }) {
    const settled = await filing.waitForStableFile(clipPath, { fs: fsModule, setTimer, now, stableMs: Math.min(stableMs, 500), timeoutMs: Math.min(stableTimeoutMs, 10000) });
    if (!settled.ok) { log(`[RacingDesk] Replay: ${clipPath} was not filed: ${settled.why}`); return null; }
    const info = readMp4(clipPath);
    const durationMs = Number.isFinite(info.durationMs) ? info.durationMs : replaySeconds() * 1000;
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

  function onReplayState(data) {
    if (typeof data.outputActive !== 'boolean') return;
    const was = replay.running;
    replay.running = data.outputActive;
    if (!replay.running) { replay.ours = false; ring.length = 0; }
    if (replay.running && !was) { replay.unavailable = null; bookTap(); }
    announce();
  }

  async function startReplayBuffer(why) {
    replay.triedAt = now();
    try {
      await client.request('StartReplayBuffer');
      replay.ours = true;
      replay.running = true;
      replay.unavailable = null;
      log(`[RacingDesk] Replay buffer started (${why})`);
      bookTap();
    } catch (e) {
      if (e && e.code === 500) { replay.running = true; return; }   // running already: OBS's own
      if (e && e.code === 604) { replay.unavailable = REPLAY_NONE; log('[RacingDesk] Replay buffer: OBS has none (RecRB is off): press Set up OBS'); }
      else if (e && e.code !== 'not-connected') log(`[RacingDesk] Replay buffer could not be started: ${e.message}`);
    }
    announce();
  }

  async function stopReplayBuffer(why) {
    if (!replay.ours) return;
    try {
      await client.request('StopReplayBuffer');
      log(`[RacingDesk] Replay buffer stopped (${why})`);
    } catch (e) { /* not running, or OBS gone */ }
    replay.ours = false;
    replay.running = false;
    ring.length = 0;
    announce();
  }

  // Started when he gets in the car and stopped when he gets out, while "Instant replay" is on; asked again no sooner
  // than a minute after one that would not start. Settings are read at each look, so the switch acts at once.
  function reconcileReplayBuffer() {
    const on = settings().recordingInstantReplay === true;
    const here = inCar();
    if (!client.identified()) return;
    if (on && here) {
      if (!replay.running && !replay.unavailable && now() - replay.triedAt >= replayRetryMs) startReplayBuffer('in the car').catch(() => {});
      if (!replay.running && replay.unavailable && now() - replay.triedAt >= replayRetryMs) startReplayBuffer('in the car, tried again').catch(() => {});
    } else if (replay.running && replay.ours) {
      stopReplayBuffer(here ? 'instant replay switched off' : 'out of the car').catch(() => {});
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
          // Whatever the events said, OBS says nothing is recording: believe it.
          ended('OBS said it was not recording', { file: true });
          announce();
          return;
        }
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
  function ended(reason, { keepState = false, stopValue = false, file = false } = {}) {
    generation++;
    const endedAt = now();
    const lastFile = outputPath;
    recording = false; starting = false; stopping = false; paused = false;
    cancelLost();
    unbookStatus();
    if (file) fileSidecar(reason, { endedAt, lastFile });
    else endSidecar(reason);
    if (owned && !keepState) clearState();
    owned = false;
    auto = false;
    settlePending(false, stopValue);
  }

  // ── Mirroring OBS ──
  function onRecordState(data) {
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
        recording = true;
        starting = false;
        stopping = false;
        paused = false;
        startedAt = now();
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
        claim = null;
        if (owned) writeState();
        log(`[RacingDesk] Recording started${owned ? (auto ? ' (auto-record)' : '') : ' (by OBS)'}: ${outputPath || 'path not said'}`);
        if (pendingStart) { const p = pendingStart; pendingStart = null; p.resolve(true); }
        bookStatus();
        announce();
        beginSidecar();
        break;
      }
      case STATE.STOPPING:
        stopping = true;
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
        announce();
        break;
      case STATE.RESUMED:
        paused = false;
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
        // We thought it was recording and OBS says not: it ended while we were away.
        ended('OBS stopped while Racing Desk was away', { file: true });
      } else if (readState()) {
        // A state file from a recording that is not running any more.
        clearState();
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
        if (typeof s.outputBytes === 'number') bytes = s.outputBytes;
        announce();
        return;
      }
      // Another recording is running than the one we had: ours is over.
      ended('OBS began another recording while Racing Desk was away', { file: true });
    }
    recording = true;
    starting = false;
    stopping = false;
    paused = !!s.outputPaused;
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
    await beginSidecar({ keptFolder: keptIsThis ? kept.folder : null });
  }

  async function askReplayStatus() {
    try {
      const r = await client.request('GetReplayBufferStatus');
      replay.running = !!(r && r.outputActive);
      replay.unavailable = null;
      if (replay.running) bookTap();
    } catch (e) {
      if (e && e.code === 604) { replay.running = false; replay.unavailable = REPLAY_NONE; }
    }
    announce();
  }

  function onClientChange(state) {
    if (state.phase === 'identified') {
      cancelLost();
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
  // whether the HUD may be told. The HUD says OBS is not open only when it is known not to be: with OBS open and its
  // WebSocket off, or refusing the password, the sentence would be false, and it is filmed.
  async function notAnswering({ quiet = false } = {}) {
    let running = null;
    try { running = await obsRunning(); } catch (e) { running = null; }
    if (running === false) {
      if (!quiet) notice(NOTICE_NOT_OPEN);
      return { text: NOT_OPEN, known: true };
    }
    if (running === true) {
      const st = client.state();
      return { text: st.authFailed || st.passwordMissing ? passwordSentence(st) : OPEN_NOT_REACHED, known: false };
    }
    return { text: NOT_OPEN, known: false };
  }

  async function record({ source = 'desk', quiet = false } = {}) {
    const fromAuto = source === 'auto';
    if (busy === 'starting-obs') return answer(false, 'OBS is starting');
    if (busy) return answer(false, ALREADY);
    if (!client.identified()) {
      const fromKey = source === 'key';
      if (fromKey || fromAuto || inCar()) {
        // Nothing is started from here.
        const said = await notAnswering({ quiet });
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
    pendingStart = { resolve: resolveStart, auto: fromAuto };
    claim = { at: now(), auto: fromAuto };
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
      return answer(false, `OBS could not start recording: ${e.message}`);
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
      // The claim is kept for its minute: OBS may be slow, and a STARTED that comes now is still ours.
      starting = false;
      if (!recording && !quiet) notice(NOTICE_NOT_STARTED);
      return answer(false, NOT_STARTED);
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
    try {
      said = await client.request('StopRecord');
    } catch (e) {
      busy = null;
      pendingStop = null;
      if (e && e.code === 501) {
        // OBS says nothing is recording: believe it.
        ended('OBS said it was not recording', { file: true });
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
      const said = await notAnswering();
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
  function feed(payload) {
    if (disposed) return;
    reconcileReplayBuffer();
    if (settings().recordingAutoRecord === false) return;
    let decision = null;
    try {
      decision = rules.feed({ payload, inCar: inCar(), recording, auto: recording && owned && auto });
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
    if (now() - autoTriedAt < autoRetryMs) return;
    autoTriedAt = now();
    // "OBS is not open" is put on the HUD once per session for auto-record, not at every try.
    const sessionKey = rules.state().lastSession;
    const quiet = !client.identified() && autoNoticedFor === sessionKey;
    if (!client.identified()) autoNoticedFor = sessionKey;
    log(`[RacingDesk] Auto-record: ${why}, starting the recording`);
    record({ source: 'auto', quiet }).then((a) => {
      if (!a.ok) log(`[RacingDesk] Auto-record: not started: ${a.reason}`);
    }).catch((e) => log(`[RacingDesk] Auto-record: ${e.message}`));
  }

  function autoStop(why) {
    if (!recording || !owned || !auto || busy) return;
    log(`[RacingDesk] Auto-record: ${why}, stopping the recording`);
    stop().then((a) => {
      if (!a.ok) log(`[RacingDesk] Auto-record: not stopped: ${a.reason}`);
    }).catch((e) => log(`[RacingDesk] Auto-record: ${e.message}`));
  }

  // ── Quitting ──
  // A start that is under way counts: Racing Desk may be quit between StartRecord and the STARTED that follows it.
  function needsStopForQuit() {
    return (owned && (recording || starting)) || (!recording && claimActive()) || !!session || (replay.running && replay.ours);
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

  return { start, dispose, record, stop, toggle, saveReplay, feed, status, stopOwnedForQuit, needsStopForQuit, refreshFree };
}

module.exports = {
  STATE, RECORD_OUTPUT, FLOOR_START_BYTES, FLOOR_STOP_BYTES, DEFAULT_BYTES_PER_SECOND, WAIT_STARTED_MS, WAIT_OBS_MS, WAIT_SAVED_MS, QUIT_WAIT_MS, LOST_AFTER_MS, CLAIM_MS,
  AUTO_RETRY_MS, REPLAY_RETRY_MS, REPLAY_SECONDS,
  NOT_OPEN, NOTICE_NOT_OPEN, NOTICE_NOT_STARTED, NOT_STARTED, NOT_ANSWERING, REFUSED_PASSWORD, MISSING_PASSWORD, OPEN_NOT_REACHED, LOST_START, ALREADY, NOT_RECORDING,
  REPLAY_OFF, REPLAY_NOT_RUNNING, REPLAY_NONE, REPLAY_NOT_SAVED,
  isSimLive, freeSpaceOf, gb, driveOf, createRecordingKeeper,
};
