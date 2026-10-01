// The recording keeper: OBS records, and this mirrors it. OBS is the truth — a recording he starts with Ctrl+Space in
// OBS is seen and treated the same as one Racing Desk asked for — and what Racing Desk adds is the telemetry sidecar
// beside the file (telemetry-sidecar.js, polled at 30 Hz from here while OBS records a live sim session), knowing
// which recordings it started so that it stops those and only those when it quits, and a floor under the disk.
//
// Rules, each with a test in tests/unit/obs-recording.spec.mjs:
// - Record from the desk, the tray or the Stream Deck with OBS closed starts OBS (main.js's startObs: tasklist, then
//   obs64 detached) while "Start OBS when I press Record" is on and he is out of the car, and waits up to 30 s for
//   its WebSocket. From a key in the car, or in the car at all, it starts nothing: the HUD says "OBS is not open",
//   one of the two sentences it may show, and only when tasklist says OBS is not running (OBS may be open with its
//   WebSocket off, and then the sentence would be false, and filmed).
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
// - Only a recording made while a sim session is live gets a sidecar (and, in the next build, a folder of its own):
//   his other collections' recordings are left alone.
// - Nothing of this is drawn on the HUD: the desk's masthead, the tray and the Stream Deck show it.
const path = require('path');
const fs = require('fs');
const { createSidecar, sidecarPathFor } = require('../telemetry-sidecar');

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
const QUIT_WAIT_MS = 3000;
const STATUS_EVERY_MS = 10000;
const IDLE_FREE_EVERY_MS = 60000;
const LOST_AFTER_MS = 30000;     // with no connection this long, the card stops saying it is recording
const CLAIM_MS = 60000;          // a StartRecord's claim on the STARTED that follows it
const SIDECAR_HZ = 30;

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
  waitStartedMs = WAIT_STARTED_MS,
  waitStoppedMs = WAIT_STOPPED_MS,
  waitObsMs = WAIT_OBS_MS,
  quitWaitMs = QUIT_WAIT_MS,
  lostAfterMs = LOST_AFTER_MS,
  claimMs = CLAIM_MS,
  floorStartBytes = FLOOR_START_BYTES,
  floorStopBytes = FLOOR_STOP_BYTES,
  statusEveryMs = STATUS_EVERY_MS,
  idleFreeEveryMs = IDLE_FREE_EVERY_MS,
  sidecarHz = SIDECAR_HZ,
  defaultBytesPerSecond = DEFAULT_BYTES_PER_SECOND,
} = {}) {
  if (!client) throw new Error('the recording keeper needs the OBS client');

  let recording = false;
  let starting = false;
  let stopping = false;
  let paused = false;
  let owned = false;
  let outputPath = null;       // the file being written now: the last RecordFileChanged's, else STARTED's
  let key = null;              // the file STARTED named: what the recording is known by, split or not
  let splitSeen = false;       // RecordFileChanged named a later file than the one STARTED did
  let startedAt = 0;
  let bytes = 0;
  let bytesPerSecond = null;
  let free = null;             // { bytes, at, folder }
  let lowDisk = null;
  let last = null;             // the last answer to a press
  let busy = null;             // 'starting-obs' | 'starting' | 'stopping' | null
  let claim = null;            // { at } from the StartRecord we sent until the STARTED that answers it
  let pendingStart = null;     // { resolve } while we wait for STARTED after our StartRecord
  let pendingStop = null;
  let generation = 0;          // counts STARTED and STOPPED: a take-over that was asked before one is out of date
  let statusTimer = null;
  let freeTimer = null;
  let sidecarTimer = null;
  let lostTimer = null;
  let sidecarBusy = false;
  let disposed = false;
  let lastDigest = null;
  const offs = [];
  const sidecar = createSidecar({ write: (file, text) => fsModule.appendFileSync(file, text), now });

  // ── The state file: which recording is ours ──
  // { owned: the file STARTED named, current: the file being written (a split moves it), startedAt }.
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
      fsModule.writeFileSync(tmp, JSON.stringify({ owned: key, current: outputPath, startedAt }));
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
    return {
      obs: obsPhase(),
      obsVersion: client.state().obsVersion,
      recording, starting, stopping, paused, owned, outputPath,
      startedAt: recording ? startedAt : null,
      elapsedMs: recording ? Math.max(0, now() - startedAt) : 0,
      bytes: recording ? bytes : 0,
      bytesPerSecond: rate,
      free: free ? { bytes: free.bytes, hoursLeft: free.bytes / rate / 3600, drive: driveOf(free.folder) } : null,
      lowDisk,
      last,
      busy,
      sidecar: sidecar.isActive() ? { path: sidecar.state().path, frames: sidecar.state().frames } : null,
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
      recording: s.recording, starting: s.starting, stopping: s.stopping, paused: s.paused, owned: s.owned,
      outputPath: s.outputPath, bytes: s.bytes, rate: Math.round(s.bytesPerSecond),
      free: s.free && { bytes: s.free.bytes, drive: s.free.drive },
      lowDisk: s.lowDisk, last: s.last && { ok: s.last.ok, text: s.last.text }, busy: s.busy, sidecar: !!s.sidecar,
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

  // ── The sidecar, at 30 Hz while a live session is recorded ──
  function sidecarHasContent(file) {
    try { return fsModule.statSync(file).size > 0; } catch (e) { return false; }
  }

  async function beginSidecar() {
    if (!key || sidecar.isActive()) return;
    const mine = key;
    let payload = null;
    try { payload = await fetchPayload(); } catch (e) { payload = null; }
    if (!recording || key !== mine || sidecar.isActive()) return;
    if (!isSimLive(payload)) {
      log('[RacingDesk] Recording: no sim session is live, so this recording gets no sidecar');
      return;
    }
    // One file per recording, by the file STARTED named (a split goes on in it). A file that has frames already —
    // Racing Desk was restarted, or lost OBS for a while — is gone on in, not given a second header.
    const file = sidecarPathFor(mine);
    const resume = sidecarHasContent(file);
    try {
      sidecar.start({ path: file, startedAt, producer: 'obs', obsOutputPath: mine, resume });
      sidecar.frame(payload, { at: now() });
    } catch (e) {
      log(`[RacingDesk] Recording: the sidecar could not be started: ${e.message}`);
      return;
    }
    log(`[RacingDesk] Recording: sidecar ${resume ? 'resumed' : '→'} ${file}`);
    const period = Math.max(10, Math.round(1000 / sidecarHz));
    const tick = async () => {
      if (!sidecar.isActive() || disposed) return;
      if (!sidecarBusy) {
        sidecarBusy = true;
        try {
          const p = await fetchPayload();
          if (p && sidecar.isActive()) sidecar.frame(p, { at: now() });
        } catch (e) { /* a poll that failed is a frame missed */ } finally {
          sidecarBusy = false;
        }
      }
      if (sidecar.isActive() && !disposed) sidecarTimer = setTimer(tick, period);
    };
    sidecarTimer = setTimer(tick, period);
    announce();
  }

  function endSidecar(reason) {
    if (sidecarTimer !== null) { clearTimer(sidecarTimer); sidecarTimer = null; }
    if (!sidecar.isActive()) return;
    try {
      const result = sidecar.stop({ stoppedAt: now(), reason, obsOutputPath: outputPath });
      if (result) log(`[RacingDesk] Recording: sidecar done, ${result.frames} frames, ${result.markers} markers`);
    } catch (e) {
      log(`[RacingDesk] Recording: the sidecar could not be finished: ${e.message}`);
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
    freeTimer = setTimer(async () => {
      freeTimer = null;
      if (disposed) return;
      if (!recording) { await refreshFree(); announce(); }
      bookIdleFree();
    }, idleFreeEveryMs);
    if (freeTimer && typeof freeTimer.unref === 'function') freeTimer.unref();
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
          ended('OBS said it was not recording');
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
    statusTimer = setTimer(pollStatus, statusEveryMs);
    if (statusTimer && typeof statusTimer.unref === 'function') statusTimer.unref();
  }

  function unbookStatus() {
    if (statusTimer !== null) { clearTimer(statusTimer); statusTimer = null; }
  }

  function cancelLost() {
    if (lostTimer !== null) { clearTimer(lostTimer); lostTimer = null; }
  }

  // The recording is over, as far as this keeper is concerned. `keepState` leaves the state file where it is: OBS has
  // not said the recording ended, only that it cannot be reached, so the next connection may find it still going.
  function ended(reason, { keepState = false, stopValue = false } = {}) {
    generation++;
    recording = false; starting = false; stopping = false; paused = false;
    cancelLost();
    unbookStatus();
    endSidecar(reason);
    if (owned && !keepState) clearState();
    owned = false;
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
        if (sidecar.isActive()) endSidecar('a new recording began');
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
        claim = null;
        if (owned) writeState();
        log(`[RacingDesk] Recording started${owned ? '' : ' (by OBS)'}: ${outputPath || 'path not said'}`);
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
        ended('stopped', { stopValue: true });
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
    sidecar.marker({ type: 'file_changed', path: outputPath }, { at: now() });
    if (owned) writeState();
    log(`[RacingDesk] Recording: OBS began a new file: ${outputPath}`);
    announce();
  }

  // OBS is open: a recording already running is taken over, ours if the state file says so (or a StartRecord of ours
  // is waiting for its STARTED); one this keeper thinks is running that OBS says is not is over.
  async function takeOver() {
    const gen = generation;
    let s;
    try { s = await client.request('GetRecordStatus'); } catch (e) { return; }
    if (gen !== generation) return;   // a STARTED or STOPPED said how it stands while this was asking
    if (!s || !s.outputActive) {
      if (recording) {
        // We thought it was recording and OBS says not: it ended while we were away.
        ended('OBS stopped while Racing Desk was away');
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
      ended('OBS began another recording while Racing Desk was away');
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
    if (keptIsThis && typeof kept.current === 'string' && kept.current) { outputPath = kept.current; splitSeen = !samePath(kept.current, found); }
    claim = null;
    if (owned) writeState();
    log(`[RacingDesk] Recording already running${owned ? ', ours' : ' (OBS\'s)'}: ${found || 'path not said'}, ${Math.round((now() - startedAt) / 1000)} s in`);
    bookStatus();
    announce();
    await beginSidecar();
  }

  function onClientChange(state) {
    if (state.phase === 'identified') {
      cancelLost();
      takeOver().catch((e) => log(`[RacingDesk] Recording: take-over failed: ${e.message}`));
    } else if (state.phase === 'closed' || state.phase === 'stopped') {
      // A connection that closed is not a recording that ended (see the rules at the top). What cannot be waited for
      // any more is let go of: a start whose STARTED can no longer come, a stop whose STOPPED can no longer come.
      if (!recording) starting = false;
      stopping = false;
      if (pendingStart) { const p = pendingStart; pendingStart = null; p.resolve('lost'); }
      if (pendingStop) { const p = pendingStop; pendingStop = null; p.resolve(false); }
      if (recording && lostTimer === null && !disposed) {
        lostTimer = setTimer(() => {
          lostTimer = null;
          if (!recording || client.identified() || disposed) return;
          log('[RacingDesk] Recording: OBS has not been reachable for a while; the recording is no longer followed (it is kept as Racing Desk\'s if OBS is found still recording)');
          ended('OBS went away', { keepState: true });
          announce();
        }, lostAfterMs);
        if (lostTimer && typeof lostTimer.unref === 'function') lostTimer.unref();
      }
    }
    announce();
  }

  // OBS is exiting: it stops its own outputs on the way out, so the recording is over.
  function onExitStarted() {
    log('[RacingDesk] OBS is closing');
    if (recording || starting) ended('OBS went away');
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
        const t = setTimer(look, 50);
        if (t && typeof t.unref === 'function') t.unref();
      };
      look();
    });
  }

  // ── Presses ──
  const passwordSentence = (s) => (s.authFailed ? REFUSED_PASSWORD : MISSING_PASSWORD);

  async function record({ source = 'desk' } = {}) {
    if (busy === 'starting-obs') return answer(false, 'OBS is starting');
    if (busy) return answer(false, ALREADY);
    if (!client.identified()) {
      const fromKey = source === 'key';
      if (fromKey || inCar()) {
        // Nothing is started from here. The HUD says OBS is not open only when it is known not to be: with OBS open and
        // its WebSocket off, or refusing the password, the sentence would be false, and it is filmed.
        let running = null;
        try { running = await obsRunning(); } catch (e) { running = null; }
        if (running === false) {
          notice(NOTICE_NOT_OPEN);
          return answer(false, NOT_OPEN);
        }
        if (running === true) {
          const st = client.state();
          return answer(false, st.authFailed || st.passwordMissing ? passwordSentence(st) : OPEN_NOT_REACHED);
        }
        return answer(false, NOT_OPEN);
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
    pendingStart = { resolve: resolveStart };
    claim = { at: now() };
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
    const timer = setTimer(() => { if (pendingStart) { const p = pendingStart; pendingStart = null; p.resolve(false); } }, waitStartedMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
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
      if (!recording) notice(NOTICE_NOT_STARTED);
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
        ended('OBS said it was not recording');
        return answer(false, NOT_RECORDING);
      }
      return answer(false, `OBS could not stop recording: ${e.message}`);
    }
    const timer = setTimer(() => { if (pendingStop) { const p = pendingStop; pendingStop = null; p.resolve(false); } }, waitStoppedMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
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

  // ── Quitting ──
  // A start that is under way counts: Racing Desk may be quit between StartRecord and the STARTED that follows it.
  function needsStopForQuit() {
    return (owned && (recording || starting)) || (!recording && claimActive()) || sidecar.isActive();
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
      const timer = setTimer(() => { if (pendingStop) { const p = pendingStop; pendingStop = null; p.resolve(false); } }, quitWaitMs);
      if (timer && typeof timer.unref === 'function') timer.unref();
      const ok = await stoppedPromise;
      clearTimer(timer);
      if (!ok) log('[RacingDesk] Recording: OBS did not say the recording stopped within the wait');
    } else if (owned && (recording || starting)) {
      // OBS cannot be asked, and the recording may well be running on: the state file stays, so that the next start
      // finds it and takes it over as Racing Desk's own.
      log('[RacingDesk] Recording: quitting with OBS out of reach; the recording it may still be making is kept as Racing Desk\'s');
    }
    endSidecar('Racing Desk quit');
    return { ok: true };
  }

  function start() {
    offs.push(client.on('RecordStateChanged', onRecordState));
    offs.push(client.on('RecordFileChanged', onFileChanged));
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
    endSidecar('disposed');
  }

  return { start, dispose, record, stop, toggle, status, stopOwnedForQuit, needsStopForQuit, refreshFree };
}

module.exports = {
  STATE, RECORD_OUTPUT, FLOOR_START_BYTES, FLOOR_STOP_BYTES, DEFAULT_BYTES_PER_SECOND, WAIT_STARTED_MS, WAIT_OBS_MS, QUIT_WAIT_MS, LOST_AFTER_MS, CLAIM_MS,
  NOT_OPEN, NOTICE_NOT_OPEN, NOTICE_NOT_STARTED, NOT_STARTED, NOT_ANSWERING, REFUSED_PASSWORD, MISSING_PASSWORD, OPEN_NOT_REACHED, LOST_START, ALREADY, NOT_RECORDING,
  isSimLive, freeSpaceOf, gb, driveOf, createRecordingKeeper,
};
