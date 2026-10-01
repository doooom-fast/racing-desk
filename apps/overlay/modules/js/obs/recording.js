// The recording keeper: OBS records, and this mirrors it. OBS is the truth — a recording he starts with Ctrl+Space in
// OBS is seen and treated the same as one Racing Desk asked for — and what Racing Desk adds is the telemetry sidecar
// beside the file (telemetry-sidecar.js, polled at 30 Hz from here while OBS records a live sim session), knowing
// which recordings it started so that it stops those and only those when it quits, and a floor under the disk.
//
// Rules, each with a test in tests/unit/obs-recording.spec.mjs:
// - Record from the desk, the tray or the Stream Deck with OBS closed starts OBS (main.js's startObs: tasklist, then
//   obs64 detached) while "Start OBS when I press Record" is on and he is out of the car, and waits up to 30 s for
//   its WebSocket. From a key in the car, or in the car at all, it starts nothing: the HUD says "OBS is not open",
//   one of the two sentences it may show.
// - StartRecord only queues the start; STARTING comes after OBS's path and disk checks, STARTED when the output
//   runs. Ten seconds without STARTED is "OBS didn't start recording. It may be showing a message." (OBS puts a modal
//   dialog up for a bad path or a full disk, even minimised).
// - A recording this keeper started is known by the outputPath STARTED carried, kept in a small state file, so that
//   after a restart it is still ours; on connect a recording already running is taken over (GetRecordStatus, its
//   path from GetOutputSettings on adv_file_output, its start from outputDuration). Stop from a press stops whatever
//   is recording, his own included; quitting stops only what we started.
// - The floor: no recording starts below about 20 GB free on the recording drive, and one of ours is stopped at
//   about 5 GB and said so in one sentence. At his 100 Mbps a drive fills at 43 GB an hour, and OBS itself stops
//   only at 50 MB, with a dialog over the sim.
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
const SIDECAR_HZ = 30;

const NOT_OPEN = "OBS isn't open";
const NOTICE_NOT_OPEN = 'OBS is not open';
const NOTICE_NOT_STARTED = "OBS didn't start recording";
const NOT_STARTED = "OBS didn't start recording. It may be showing a message.";
const NOT_ANSWERING = 'OBS is open but not answering. If it is asking about its last crash, choose Launch Normally.';
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

/** Free bytes on the drive a folder is on, from fs.statfs; null when it cannot be asked. */
function freeSpaceOf(folder, fsModule = fs) {
  return new Promise((resolve) => {
    try {
      fsModule.statfs(String(folder), (err, stats) => {
        if (err || !stats) { resolve(null); return; }
        resolve(Number(stats.bavail) * Number(stats.bsize));
      });
    } catch (e) {
      resolve(null);
    }
  });
}

function createRecordingKeeper({
  client,
  settings = () => ({}),
  recordFolder = () => '',
  stateFile,
  fs: fsModule = fs,
  freeSpace = (folder) => freeSpaceOf(folder, fsModule),
  fetchPayload = async () => null,
  inCar = () => false,
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
  let outputPath = null;
  let startedAt = 0;
  let bytes = 0;
  let bytesPerSecond = null;
  let free = null;             // { bytes, at, folder }
  let lowDisk = null;
  let last = null;             // the last answer to a press
  let busy = null;             // 'starting-obs' | 'starting' | 'stopping' | null
  let pendingStart = null;     // { resolve } while we wait for STARTED after our StartRecord
  let pendingStop = null;
  let statusTimer = null;
  let freeTimer = null;
  let sidecarTimer = null;
  let sidecarBusy = false;
  let disposed = false;
  const offs = [];
  const sidecar = createSidecar({ write: (file, text) => fsModule.appendFileSync(file, text), now });

  // ── The state file: which recording is ours ──
  function readState() {
    try {
      const parsed = JSON.parse(String(fsModule.readFileSync(stateFile, 'utf8')));
      return parsed && typeof parsed === 'object' && typeof parsed.owned === 'string' ? parsed : null;
    } catch (e) {
      return null;
    }
  }
  function writeState() {
    if (!stateFile) return;
    try {
      fsModule.mkdirSync(path.dirname(stateFile), { recursive: true });
      const tmp = `${stateFile}.tmp`;
      fsModule.writeFileSync(tmp, JSON.stringify({ owned: outputPath, startedAt }));
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

  function announce() {
    try { onChange(status()); } catch (e) { log(`[RacingDesk] Recording: onChange threw: ${e.message}`); }
  }

  function answer(ok, text, extra = {}) {
    last = { ok, text, at: now() };
    announce();
    return { ok, reason: ok ? undefined : text, ...extra };
  }

  // ── The sidecar, at 30 Hz while a live session is recorded ──
  async function beginSidecar() {
    if (!outputPath) return;
    let payload = null;
    try { payload = await fetchPayload(); } catch (e) { payload = null; }
    if (!recording) return;
    if (!isSimLive(payload)) {
      log('[RacingDesk] Recording: no sim session is live, so this recording gets no sidecar');
      return;
    }
    const file = sidecarPathFor(outputPath);
    try {
      sidecar.start({ path: file, startedAt, producer: 'obs', obsOutputPath: outputPath });
      sidecar.frame(payload, { at: now() });
    } catch (e) {
      log(`[RacingDesk] Recording: the sidecar could not be started: ${e.message}`);
      return;
    }
    log(`[RacingDesk] Recording: sidecar → ${file}`);
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
  async function refreshFree(folder) {
    const where = folder || (outputPath ? path.dirname(outputPath) : recordFolder());
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
    try {
      const s = await client.request('GetRecordStatus');
      if (s && typeof s.outputBytes === 'number') bytes = s.outputBytes;
      if (s && typeof s.outputDuration === 'number' && s.outputDuration > 5000 && bytes > 0) bytesPerSecond = bytes / (s.outputDuration / 1000);
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

  // ── Mirroring OBS ──
  function onRecordState(data) {
    switch (data.outputState) {
      case STATE.STARTING:
        starting = true;
        stopping = false;
        announce();
        break;
      case STATE.STARTED: {
        recording = true;
        starting = false;
        stopping = false;
        paused = false;
        startedAt = now();
        bytes = 0;
        bytesPerSecond = null;
        lowDisk = null;
        outputPath = typeof data.outputPath === 'string' && data.outputPath ? data.outputPath : null;
        owned = !!pendingStart;
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
        if (typeof data.outputPath === 'string' && data.outputPath) outputPath = data.outputPath;
        const was = recording || starting;
        recording = false;
        starting = false;
        stopping = false;
        paused = false;
        unbookStatus();
        endSidecar('stopped');
        if (owned) clearState();
        const wasOwned = owned;
        owned = false;
        if (was) log(`[RacingDesk] Recording stopped${wasOwned ? '' : ' (by OBS)'}: ${outputPath || 'path not said'}`);
        if (pendingStop) { const p = pendingStop; pendingStop = null; p.resolve(true); }
        if (pendingStart) { const p = pendingStart; pendingStart = null; p.resolve(false); }
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
    sidecar.marker({ type: 'file_changed', path: outputPath }, { at: now() });
    if (owned) writeState();
    log(`[RacingDesk] Recording: OBS began a new file: ${outputPath}`);
    announce();
  }

  // OBS is open: a recording already running is taken over, ours if the state file says so.
  async function takeOver() {
    let s;
    try { s = await client.request('GetRecordStatus'); } catch (e) { return; }
    if (!s || !s.outputActive) {
      if (recording) {
        // We thought it was recording and OBS says not: it ended while we were away.
        recording = false; starting = false; stopping = false;
        unbookStatus();
        endSidecar('OBS stopped while Racing Desk was away');
        if (owned) clearState();
        owned = false;
      }
      announce();
      return;
    }
    if (recording) return;
    let found = null;
    try {
      const out = await client.request('GetOutputSettings', { outputName: RECORD_OUTPUT });
      const os = out && out.outputSettings ? out.outputSettings : {};
      found = typeof os.path === 'string' && os.path ? os.path : (typeof os.url === 'string' && os.url ? os.url : null);
    } catch (e) { found = null; }
    recording = true;
    starting = false;
    stopping = false;
    paused = !!s.outputPaused;
    startedAt = now() - (typeof s.outputDuration === 'number' ? s.outputDuration : 0);
    bytes = typeof s.outputBytes === 'number' ? s.outputBytes : 0;
    outputPath = found;
    const kept = readState();
    owned = !!(kept && found && samePath(kept.owned, found));
    log(`[RacingDesk] Recording already running${owned ? ', ours' : ' (OBS\'s)'}: ${found || 'path not said'}, ${Math.round((now() - startedAt) / 1000)} s in`);
    bookStatus();
    announce();
    await beginSidecar();
  }

  function onClientChange(state) {
    if (state.phase === 'identified') {
      takeOver().catch((e) => log(`[RacingDesk] Recording: take-over failed: ${e.message}`));
    } else if (recording && (state.phase === 'closed' || state.phase === 'stopped')) {
      // OBS went while recording: whatever it wrote is finished by OBS itself; there is nothing left to stop.
      recording = false; starting = false; stopping = false; paused = false;
      unbookStatus();
      endSidecar('OBS went away');
      if (owned) clearState();
      owned = false;
      if (pendingStart) { const p = pendingStart; pendingStart = null; p.resolve(false); }
      if (pendingStop) { const p = pendingStop; pendingStop = null; p.resolve(false); }
    }
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
  async function record({ source = 'desk' } = {}) {
    if (busy === 'starting-obs') return answer(false, 'OBS is starting');
    if (busy) return answer(false, ALREADY);
    if (!client.identified()) {
      const fromKey = source === 'key';
      if (fromKey || inCar()) {
        notice(NOTICE_NOT_OPEN);
        return answer(false, NOT_OPEN);
      }
      if (settings().obsStartOnRecord === false) return answer(false, NOT_OPEN);
      busy = 'starting-obs';
      announce();
      let started;
      try { started = await startObs(); } catch (e) { started = { ok: false, reason: e.message }; }
      if (!started || !started.ok) { busy = null; return answer(false, (started && started.reason) || 'OBS could not be started'); }
      client.tryNow();
      const open = await waitFor(() => client.identified(), waitObsMs);
      busy = null;
      if (!open) return answer(false, NOT_ANSWERING);
      // Taking over what OBS had running is under way; give it the moment.
      await waitFor(() => recording || !client.identified(), 300);
    }
    if (recording || starting) return answer(false, ALREADY);
    const bytesFree = await refreshFree(recordFolder());
    if (bytesFree !== null && bytesFree < floorStartBytes) {
      return answer(false, `Only ${gb(bytesFree)} GB free on ${driveOf(free.folder)}. Recording needs about ${gb(floorStartBytes)} GB.`);
    }
    busy = 'starting';
    lowDisk = null;
    let resolveStart;
    const startedPromise = new Promise((resolve) => { resolveStart = resolve; });
    pendingStart = { resolve: resolveStart };
    announce();
    try {
      await client.request('StartRecord');
    } catch (e) {
      busy = null;
      pendingStart = null;
      if (e && e.code === 500) return answer(false, ALREADY);
      return answer(false, `OBS could not start recording: ${e.message}`);
    }
    const timer = setTimer(() => { if (pendingStart) { const p = pendingStart; pendingStart = null; p.resolve(false); } }, waitStartedMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
    const ok = await startedPromise;
    clearTimer(timer);
    busy = null;
    if (!ok) {
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
        recording = false; starting = false; stopping = false;
        unbookStatus();
        endSidecar('OBS said it was not recording');
        if (owned) clearState();
        owned = false;
        return answer(false, NOT_RECORDING);
      }
      return answer(false, `OBS could not stop recording: ${e.message}`);
    }
    const timer = setTimer(() => { if (pendingStop) { const p = pendingStop; pendingStop = null; p.resolve(false); } }, waitStoppedMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
    const ok = await stoppedPromise;
    clearTimer(timer);
    busy = null;
    const file = (said && said.outputPath) || outputPath;
    if (!ok) return answer(false, "OBS didn't say the recording stopped. It may be showing a message.");
    return answer(true, 'Stopped', { path: file });
  }

  function toggle({ source = 'desk' } = {}) {
    return recording || starting ? stop() : record({ source });
  }

  // ── Quitting ──
  function needsStopForQuit() {
    return (owned && (recording || starting)) || sidecar.isActive();
  }

  async function stopOwnedForQuit() {
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
    }
    endSidecar('Racing Desk quit');
    if (owned) clearState();
    owned = false;
    return { ok: true };
  }

  function start() {
    offs.push(client.on('RecordStateChanged', onRecordState));
    offs.push(client.on('RecordFileChanged', onFileChanged));
    offs.push(client.on('ExitStarted', () => log('[RacingDesk] OBS is closing')));
    offs.push(client.onChange(onClientChange));
    refreshFree().then(() => announce());
    bookIdleFree();
    if (client.identified()) takeOver().catch(() => {});
  }

  function dispose() {
    disposed = true;
    for (const off of offs) { try { off(); } catch (e) { /* gone */ } }
    unbookStatus();
    if (freeTimer !== null) { clearTimer(freeTimer); freeTimer = null; }
    endSidecar('disposed');
  }

  return { start, dispose, record, stop, toggle, status, stopOwnedForQuit, needsStopForQuit, refreshFree };
}

module.exports = {
  STATE, RECORD_OUTPUT, FLOOR_START_BYTES, FLOOR_STOP_BYTES, DEFAULT_BYTES_PER_SECOND, WAIT_STARTED_MS, WAIT_OBS_MS, QUIT_WAIT_MS,
  NOT_OPEN, NOTICE_NOT_OPEN, NOTICE_NOT_STARTED, NOT_STARTED, NOT_ANSWERING, ALREADY, NOT_RECORDING,
  isSimLive, freeSpaceOf, gb, driveOf, createRecordingKeeper,
};
