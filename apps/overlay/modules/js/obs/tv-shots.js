// TV shots: after a race, the moments its telemetry sidecar found — the places gained, the incidents, the pit stops —
// recorded again from iRacing's own replay through a TV camera, as one take beside the recording. Rebuilt on the
// iRacing SDK's replay commands, sent by the host (apps/host ReplayApi, /racing-desk/data/replay, a program on this
// machine alone): the old director sent keystrokes to whichever window had the focus and guessed how far a
// fast-forward had got. Nothing here presses a key.
//
// How a take goes, each step with a test in tests/unit/obs-tv-shots.spec.mjs:
// - The moments come from the sidecar's summary markers (every summary in the file: a sidecar Racing Desk resumed has
//   one for each stretch); each is a point in the sim's own clock, the `sn` and `st` of the frame three seconds before
//   it (the lead-in), which is what the replay is asked to seek to (ReplaySearchSessionTime). Moments within five
//   seconds of each other are one, up to half a minute of markers; at most twenty are taken, the biggest first (a place
//   gained, then an incident, then the pit lane), in the race's order.
// - Only out of the car, with OBS answering, nothing recording, and iRacing in its replay of this race (the sim says
//   IsReplayPlaying, and the track it says is the sidecar's). Auto-record is held for the take (the replay's pit lane
//   and flags are not the race's); his facecam is hidden in the scene being recorded while "Hide the facecam during TV
//   shots" is on, and put back after, whatever happened in between: the items are written to a small file before they
//   are hidden, so that a crash, a quit or an OBS that went away leaves nothing hidden at the next start or connect.
// - The camera is a TV group of the session's (TV1, TV2, TV3 in turn), focused on his own car by its number. iRacing's own
//   replay controls are hidden for the take (CameraState UIHidden) and the camera state and play speed are put back as
//   they were.
// - The replay is paused, the first moment sought and waited for (the sim says where it is), then the recording starts
//   (a recording of the keeper's own, filed as `<the race's video> tv` in the race's folder, with a sidecar of kind 'tv'
//   and no chapters); the moment plays at real speed and the replay is paused again; between moments the recording is
//   paused (PauseRecord) while the next seek lands and resumed (ResumeRecord) when it has, so the take holds the
//   moments and nothing of the seeking. A moment the sim does not reach is skipped, said, and counted; with none
//   reached nothing is recorded. After the last the recording stops and the keeper files it.
// - It ends where it is, and says why, when he gets in the car (the sim says he is on track, or main says he is in the
//   car: no command is sent after that, the host refuses them too), when iRacing leaves its replay, when OBS stops the
//   take or does not answer the pause or the resume, when he presses Stop (the moment's wait is woken) and when the
//   app quits. The facecam comes back as soon as the recording has stopped.
// - Progress is said at every step (onChange: the desk's pill and card, the tray, the Stream Deck).
const path = require('path');
const readline = require('readline');
const fs = require('fs');
const index = require('./recordings-index');

const LEAD_IN_S = 3;
const TAIL_S = 3;
const MERGE_GAP_S = 5;
const MAX_MOMENT_S = 30;
const MAX_MOMENTS = 20;
const LAND_TOLERANCE_S = 1.5;
const LAND_WAIT_MS = 15000;
const LAND_POLL_MS = 300;
const SETTLE_MS = 800;
const FILING_WAIT_MS = 15000;
const WATCH_MS = 500;          // while a moment plays: how often main's in-car signal is looked at
const WATCH_STATUS_MS = 1000;  // and how often the sim is asked where he is
const LEFT_REPLAY_LOOKS = 2;   // the sim saying twice running that it is not in its replay
const TAKE_SUFFIX = ' tv';
const UI_HIDDEN = 8;           // iRacing's CameraState flag that takes its own replay controls off the screen
const TV_GROUP = /^tv\s*\d*$/i;
const CAMERA_LIKE = /facecam|webcam|\bcam\b|camera|video capture/i;
const CAMERA_KINDS = ['dshow_input', 'av_capture_input', 'v4l2_input', 'macos-avcapture'];
// Words that every circuit's name has some of: not what tells one track from another.
const GENERIC_TRACK_WORDS = new Set(['circuit', 'grand', 'prix', 'international', 'speedway', 'raceway', 'motor', 'motorsport', 'motorsports', 'park', 'full', 'course', 'road', 'track', 'short', 'long', 'oval', 'layout', 'combined', 'club', 'national', 'historic']);

const NOT_OPEN = "OBS isn't open, so TV shots cannot be recorded.";
const RUNNING = 'TV shots are being recorded already.';
const RECORDING = 'A recording is running. Stop it first, then press TV shots.';
const IN_CAR = 'TV shots are made from the desk after the race, with iRacing in its replay.';
const NO_SIM = "iRacing isn't running. Open the replay of the race in iRacing, then press TV shots.";
const NOT_REPLAY = "iRacing isn't in its replay. Open the replay of the race in iRacing, then press TV shots.";
const OTHER_REPLAY = "iRacing has another race's replay open. Open this race's replay in iRacing, then press TV shots.";
const NO_RECORDING = 'There is no recording to make TV shots of.';
const NO_MOMENTS = 'The recording has no moments to show: no place gained, no incident, no pit stop.';
const NO_CLOCK = "The recording's telemetry has no session clock in it, so its moments cannot be found in the replay.";
const NO_HOST = 'The app’s own host is not answering, and it is what drives the replay.';
const DROVE = 'You got in the car, so the TV shots were ended.';
const LEFT_REPLAY = 'iRacing left its replay, so the TV shots were ended.';
const OBS_STOPPED = 'OBS stopped the take, so the TV shots were ended.';
const NOT_LANDED = "The replay did not reach any of the moments. It may not hold them, or it may be another race's replay.";

/** The take is over before its end, and why; `driving` says it is because he is in the car (no command is sent then). */
class TakeEnded extends Error {
  constructor(reason, { driving = false } = {}) {
    super(reason);
    this.name = 'TakeEnded';
    this.reason = reason;
    this.driving = driving;
  }
}

function labelOf(marker) {
  switch (marker.type) {
    case 'position_change': return marker.direction === 'gained' ? `P${marker.from} → P${marker.to}` : `Lost P${marker.from} → P${marker.to}`;
    case 'incident': return `Incident ×${Math.max(1, (marker.to || 0) - (marker.from || 0))}`;
    case 'pit_entry': return 'Pit in';
    case 'pit_exit': return 'Pit out';
    default: return null;
  }
}

function priorityOf(marker) {
  switch (marker.type) {
    case 'position_change': return marker.direction === 'gained' ? 3 : 1;
    case 'incident': return 2;
    case 'pit_entry': case 'pit_exit': return 1;
    default: return 0;
  }
}

/**
 * The moments of a sidecar, from its markers and its frames: [{ label, priority, t, from, to, sn, st, frame }], t and
 * from/to in seconds of the sidecar's clock, sn/st the sim's clock at `from` (the lead-in before the marker). Markers
 * within five seconds of each other are one moment, for no more than half a minute of markers (a lap of places swapped
 * every few seconds is several moments, not one of minutes); at most `maxMoments`, by priority, in the race's order.
 * `frames` is [{ t, sn, st }] in order. A moment whose lead-in has no sim clock is left out; none at all is `clock: false`.
 */
function momentsOf({ markers = [], frames = [] } = {}, { leadInS = LEAD_IN_S, tailS = TAIL_S, mergeGapS = MERGE_GAP_S, maxMomentS = MAX_MOMENT_S, maxMoments = MAX_MOMENTS } = {}) {
  const points = [];
  for (const m of markers || []) {
    const label = labelOf(m);
    if (!label) continue;
    const t = Number(m.t) / 1000;
    if (!Number.isFinite(t)) continue;
    points.push({ label, priority: priorityOf(m), t, end: t });
  }
  points.sort((a, b) => a.t - b.t);
  const merged = [];
  for (const p of points) {
    const last = merged[merged.length - 1];
    if (last && p.t - last.end < mergeGapS && p.t - last.t < maxMomentS) {
      last.end = p.t;
      last.priority = Math.max(last.priority, p.priority);
      if (!last.label.includes(p.label)) last.label += ` + ${p.label}`;
    } else {
      merged.push({ ...p });
    }
  }
  const kept = merged.length > maxMoments
    ? merged.slice().sort((a, b) => b.priority - a.priority || a.t - b.t).slice(0, maxMoments).sort((a, b) => a.t - b.t)
    : merged;
  const withClock = frames.filter((f) => f && Number.isFinite(f.sn) && Number.isFinite(f.st) && Number.isFinite(f.t));
  if (!withClock.length) return { moments: [], clock: false };
  const out = [];
  for (const m of kept) {
    const from = Math.max(0, m.t - leadInS);
    // The last frame at or before the lead-in, else the first after it.
    let at = null;
    for (const f of withClock) { if (f.t <= from) at = f; else { if (!at) at = f; break; } }
    if (!at) continue;
    // The sim's clock at `from`: the frame's, plus the time from the frame to `from` — which is negative when the frame
    // is the first one after it (a hole in the frames, a recording that began after the lead-in).
    out.push({ label: m.label, priority: m.priority, t: m.t, from, to: m.end + tailS, sn: at.sn, st: Math.max(0, at.st + (from - at.t)), frame: at.frame });
  }
  return { moments: out, clock: true };
}

/**
 * The plan for a sidecar file, read line by line (an hour of frames is some 160 MB; only t, sn and st of each frame
 * are kept): { header, moments, clock, frames, problem }. The markers are those of every summary line in the file: a
 * sidecar that was resumed (Racing Desk restarted, or OBS was lost for a while) has a summary for each stretch, each
 * holding only the markers since its resume.
 */
async function readTvPlan(file, { fs: fsModule = fs, ...options } = {}) {
  const frames = [];
  const markers = [];
  const seen = new Set();
  let header = null;
  await new Promise((resolve, reject) => {
    let stream;
    try { stream = fsModule.createReadStream(file, { encoding: 'utf8' }); } catch (e) { reject(e); return; }
    stream.on('error', reject);
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    lines.on('line', (line) => {
      if (!line || line.length < 2) return;
      let obj;
      try { obj = JSON.parse(line); } catch (e) { return; }
      if (!obj || typeof obj !== 'object') return;
      if (obj._type === 'header') { if (!header) header = obj; return; }
      if (obj._type === 'summary') {
        for (const m of Array.isArray(obj.markers) ? obj.markers : []) {
          if (!m || typeof m !== 'object') continue;
          const key = `${m.type}|${m.t}`;
          if (seen.has(key)) continue;
          seen.add(key);
          markers.push(m);
        }
        return;
      }
      if (obj._type) return;
      frames.push({ t: Number(obj.t), frame: obj.frame, sn: obj.sn === undefined ? NaN : Number(obj.sn), st: obj.st === undefined ? NaN : Number(obj.st) });
    });
    lines.on('close', resolve);
  });
  const { moments, clock } = momentsOf({ markers, frames }, options);
  let problem = null;
  if (!header) problem = 'The telemetry file has no header.';
  else if (!markers.length || !moments.length) problem = clock || !markers.length ? NO_MOMENTS : NO_CLOCK;
  if (!problem && !clock) problem = NO_CLOCK;
  return { header, moments, clock, frames: frames.length, problem };
}

/** The camera group for a moment: TV1, TV2, TV3 in turn where the session has them, else any TV group, else none. */
function chooseCameraGroup(groups, i = 0) {
  const list = Array.isArray(groups) ? groups.filter((g) => g && Number.isInteger(g.num)) : [];
  const tv = list.filter((g) => TV_GROUP.test(String(g.name || '').trim()));
  if (tv.length) return tv[i % tv.length];
  const any = list.filter((g) => /tv/i.test(String(g.name || '')));
  if (any.length) return any[i % any.length];
  return null;
}

/** His camera in a scene's items: a video capture device, or anything named like one. */
function cameraItems(items) {
  return (items || []).filter((it) => it && (CAMERA_KINDS.includes(String(it.inputKind || '').replace(/_v\d+$/, '')) || CAMERA_LIKE.test(String(it.sourceName || ''))));
}

const trackWords = (name) => String(name || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !GENERIC_TRACK_WORDS.has(w));

/**
 * Whether the replay open in iRacing is of the track the recording says (its header's `track`, iRacing's display name
 * where the host sent it). Same name, or a name in the other, or a word of one in the other; unknown on either side is
 * not a difference.
 */
function sameTrack(recorded, weekend) {
  const a = String(recorded || '').trim();
  const names = weekend && typeof weekend === 'object' ? [weekend.trackDisplayName, weekend.trackName].map((n) => String(n || '').trim()).filter(Boolean) : [];
  if (!a || !names.length) return true;
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const wordsA = trackWords(a);
  return names.some((n) => {
    if (norm(n) === norm(a) || norm(n).includes(norm(a)) || norm(a).includes(norm(n))) return true;
    const wordsN = trackWords(n);
    return wordsA.some((w) => wordsN.includes(w));
  });
}

/** An error from OBS that says it could not be asked, not that it said no: the thing to try again at its next answer. */
const unreachable = (e) => !!e && (e.code === 'not-connected' || e.code === 'disconnected' || e.code === 'timeout');

function createTvShots({
  client,
  recording,
  replay,
  settings = () => ({}),
  stateFile = null,
  fs: fsModule = fs,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  log = () => {},
  onChange = () => {},
  inCar = () => false,
  leadInS = LEAD_IN_S,
  tailS = TAIL_S,
  mergeGapS = MERGE_GAP_S,
  maxMomentS = MAX_MOMENT_S,
  maxMoments = MAX_MOMENTS,
  landWaitMs = LAND_WAIT_MS,
  landPollMs = LAND_POLL_MS,
  landToleranceS = LAND_TOLERANCE_S,
  settleMs = SETTLE_MS,
  filingWaitMs = FILING_WAIT_MS,
  watchMs = WATCH_MS,
  watchStatusMs = WATCH_STATUS_MS,
} = {}) {
  if (!client) throw new Error('TV shots need the OBS client');
  if (!recording) throw new Error('TV shots need the recording keeper');
  if (!replay || typeof replay.status !== 'function' || typeof replay.command !== 'function') throw new Error('TV shots need the host\'s replay route');

  let running = false;
  let cancelled = false;
  let progress = { step: null, index: 0, total: 0, label: null, startedAt: null };
  let result = null;   // { ok, reason, video, folder, moments, skipped, cancelled, at }
  let lastAt = null;
  let lastSim = null;          // the last answer of the host's status
  let leftReplayLooks = 0;
  let hiddenNow = [];          // the facecam items the take has hidden and not shown again
  let restoring = null;        // the restore under way, if one is
  const sleepers = new Set();  // the waits Stop wakes

  // A wait that Stop (and the quit) cuts short. `wake: false` for the one that is not to be cut short.
  const sleep = (ms, { wake = true } = {}) => new Promise((resolve) => {
    let timer = null;
    const done = () => {
      if (timer !== null) { clearTimer(timer); timer = null; }
      sleepers.delete(done);
      resolve();
    };
    timer = setTimer(done, ms);
    if (timer && typeof timer.unref === 'function') timer.unref();
    if (wake) sleepers.add(done);
  });
  const wakeAll = () => { for (const done of [...sleepers]) done(); };

  function status() {
    return { running, cancelled: running && cancelled, ...progress, result, lastAt };
  }

  function say(step, more = {}) {
    progress = { ...progress, step, ...more };
    try { onChange(status()); } catch (e) { log(`[RacingDesk] TV shots: onChange threw: ${e.message}`); }
  }

  function finish(outcome) {
    running = false;
    result = { ...outcome, at: now() };
    lastAt = now();
    log(`[RacingDesk] TV shots: ${outcome.ok ? `done, ${outcome.moments} moments${outcome.skipped ? ` (${outcome.skipped} not in the replay)` : ''} in ${outcome.video || 'the take'}` : `${outcome.cancelled ? 'stopped' : 'not made'}: ${outcome.reason}`}`);
    say(outcome.ok ? 'done' : outcome.cancelled ? 'cancelled' : 'failed');
  }

  async function replayStatus() {
    try { lastSim = await replay.status(); return lastSim; } catch (e) { return null; }
  }

  // Ends the take where it is when he is in the car — main says so, or the sim says he is on track — or when iRacing has
  // left its replay (twice running: one look at a replay that is changing is not a verdict).
  function guard(sim = lastSim) {
    if (inCar()) throw new TakeEnded(DROVE, { driving: true });
    if (sim && sim.onTrack === true) throw new TakeEnded(DROVE, { driving: true });
    if (sim && sim.replayPlaying === false) {
      if (++leftReplayLooks >= LEFT_REPLAY_LOOKS) throw new TakeEnded(LEFT_REPLAY);
    } else if (sim && sim.replayPlaying === true) {
      leftReplayLooks = 0;
    }
  }

  // One command to the replay, never after he is in the car. `cleanup` is putting the replay back, which is tried
  // whatever has happened (the host refuses it while he drives, and that is all right).
  async function command(body, { cleanup = false } = {}) {
    if (!cleanup) guard();
    const answer = await replay.command(body);
    if (!answer || answer.ok !== true) {
      const said = (answer && (answer.error || answer.reason)) || `the host did not take the replay command ${body.command}`;
      if (answer && answer.status === 409 && /in the car/i.test(said)) throw new TakeEnded(DROVE, { driving: true });
      throw new Error(said);
    }
    return answer;
  }

  // The seek has landed when the sim says it is in that session within a second and a half of the time asked for.
  async function waitLanded(moment) {
    const until = now() + landWaitMs;
    let seen = null;
    while (now() < until && !cancelled) {
      seen = await replayStatus();
      guard(seen);
      const r = seen && seen.replay;
      if (r && Number(r.sessionNum) === moment.sn && Math.abs(Number(r.sessionTime) - moment.st) <= landToleranceS) return { landed: true, seen };
      await sleep(landPollMs);
    }
    return { landed: false, seen };
  }

  function cameraCommand(group, sim) {
    // His own car by its number (CamSwitchNum): the driver's focus without one keeps the camera on whichever car it is on.
    const player = sim && sim.player;
    if (player && typeof player.carNumber === 'string' && player.carNumber !== '' && Number.isInteger(player.carNumberRaw)) {
      return { command: 'camera', carNumber: player.carNumberRaw, group: group.num, camera: 0 };
    }
    return { command: 'camera', focus: 'driver', group: group.num, camera: 0 };
  }

  async function seekTo(moment, i, sim) {
    await command({ command: 'speed', speed: 0 });
    await command({ command: 'seek', sessionNum: moment.sn, sessionTime: moment.st });
    const group = chooseCameraGroup(sim.groups || [], i);
    if (group) await command(cameraCommand(group, sim));
    const landed = await waitLanded(moment);
    if (!landed.landed && !cancelled) log(`[RacingDesk] TV shots: the replay did not say it had reached session ${moment.sn} at ${moment.st.toFixed(1)} s within ${Math.round(landWaitMs / 1000)} s; the moment is skipped`);
    if (landed.landed) await sleep(settleMs);
    return landed.landed;
  }

  // ── His facecam ──
  // Hidden in the scene OBS is recording and shown again after; only what was shown is put back. The items are written
  // to a small file before the first one is hidden and the file is cleared when they are shown again, so that a crash,
  // a quit or an OBS that went away does not leave them hidden: whatever the file lists is shown again at the next
  // start of the app or the next time OBS answers.
  function readLeft() {
    if (!stateFile) return [];
    try {
      const parsed = JSON.parse(String(fsModule.readFileSync(stateFile, 'utf8')));
      return parsed && Array.isArray(parsed.hidden) ? parsed.hidden.filter((h) => h && typeof h.sceneName === 'string' && Number.isInteger(h.sceneItemId)) : [];
    } catch (e) {
      return [];
    }
  }
  function writeLeft(items) {
    if (!stateFile) return;
    try {
      fsModule.mkdirSync(path.dirname(stateFile), { recursive: true });
      const tmp = `${stateFile}.tmp`;
      fsModule.writeFileSync(tmp, JSON.stringify({ hidden: items, at: now() }));
      fsModule.renameSync(tmp, stateFile);
    } catch (e) {
      log(`[RacingDesk] TV shots: the facecam's state file could not be written: ${e.message}`);
    }
  }
  function clearLeft() {
    if (!stateFile) return;
    try { fsModule.unlinkSync(stateFile); } catch (e) { /* none */ }
  }

  async function hideFacecam() {
    if (settings().tvShotsHideFacecam === false) return;
    let targets = [];
    try {
      const scene = await client.request('GetCurrentProgramScene');
      const sceneName = scene && (scene.sceneName || scene.currentProgramSceneName);
      if (!sceneName) return;
      const list = await client.request('GetSceneItemList', { sceneName });
      targets = cameraItems(list && list.sceneItems).filter((it) => it.sceneItemEnabled !== false)
        .map((it) => ({ sceneName, sceneItemId: it.sceneItemId, sourceName: it.sourceName }));
    } catch (e) {
      log(`[RacingDesk] TV shots: the facecam could not be hidden: ${e.message}`);
      return;
    }
    if (!targets.length) return;
    writeLeft(targets);
    hiddenNow = targets.slice();
    for (const t of targets) {
      if (cancelled) break;
      try { await client.request('SetSceneItemEnabled', { sceneName: t.sceneName, sceneItemId: t.sceneItemId, sceneItemEnabled: false }); } catch (e) { log(`[RacingDesk] TV shots: the facecam "${t.sourceName}" could not be hidden: ${e.message}`); }
    }
    log(`[RacingDesk] TV shots: the facecam is hidden for the take (${targets.map((h) => h.sourceName).join(', ')})`);
  }

  // The facecam back, now. Once at a time; what could not be shown again stays in the file for the next answer of OBS.
  function showFacecam() {
    if (restoring) return restoring;
    if (!hiddenNow.length) return Promise.resolve();
    const items = hiddenNow.slice();
    restoring = (async () => {
      let all = true;
      for (const h of items) {
        try { await client.request('SetSceneItemEnabled', { sceneName: h.sceneName, sceneItemId: h.sceneItemId, sceneItemEnabled: true }); } catch (e) { all = false; log(`[RacingDesk] TV shots: the facecam "${h.sourceName}" could not be shown again: ${e.message}`); }
      }
      hiddenNow = [];
      if (all) { clearLeft(); log('[RacingDesk] TV shots: the facecam is back'); } else log('[RacingDesk] TV shots: the facecam is shown again the next time OBS answers');
    })().finally(() => { restoring = null; });
    return restoring;
  }

  // OBS has answered, or the app has started: what an earlier take left hidden is shown again — by scene, item and name,
  // and only what is still hidden. Never while a take runs (its own items are in the file too).
  async function restoreLeft() {
    if (running || !stateFile) return;
    const left = readLeft();
    if (!left.length) return;
    let again = false;
    for (const h of left) {
      try {
        const list = await client.request('GetSceneItemList', { sceneName: h.sceneName });
        const it = ((list && list.sceneItems) || []).find((i) => i && i.sceneItemId === h.sceneItemId && i.sourceName === h.sourceName);
        if (it && it.sceneItemEnabled === false) {
          await client.request('SetSceneItemEnabled', { sceneName: h.sceneName, sceneItemId: h.sceneItemId, sceneItemEnabled: true });
          log(`[RacingDesk] TV shots: the facecam "${h.sourceName}" an earlier take left hidden is shown again`);
        }
      } catch (e) {
        if (unreachable(e)) again = true;
        else log(`[RacingDesk] TV shots: the facecam "${h.sourceName}" was not found to be shown again: ${e.message}`);
      }
    }
    if (!again && !running) clearLeft();
  }
  client.onChange((state) => {
    if (state && state.phase === 'identified') restoreLeft().catch((e) => log(`[RacingDesk] TV shots: ${e.message}`));
  });
  if (client.identified()) restoreLeft().catch((e) => log(`[RacingDesk] TV shots: ${e.message}`));

  // ── iRacing's own replay controls, and the replay as the take found it ──
  async function hideReplayUi(before) {
    if (!Number.isInteger(before.cameraState) || (before.cameraState & UI_HIDDEN)) return;
    try { await command({ command: 'cameraState', state: before.cameraState | UI_HIDDEN }); } catch (e) {
      if (e instanceof TakeEnded) throw e;
      log(`[RacingDesk] TV shots: iRacing's replay controls could not be hidden: ${e.message}`);
    }
  }

  async function putReplayBack(before, tried) {
    if (tried.done) return;
    tried.done = true;
    if (Number.isInteger(before.cameraState)) {
      try { await command({ command: 'cameraState', state: before.cameraState }, { cleanup: true }); } catch (e) { log(`[RacingDesk] TV shots: the camera state was not put back: ${e.message}`); }
    }
    if (Number.isInteger(before.speed)) {
      try { await command({ command: 'speed', speed: before.speed, slowMotion: before.slowMotion === true }, { cleanup: true }); } catch (e) { log(`[RacingDesk] TV shots: the replay's speed was not put back: ${e.message}`); }
    }
  }

  // ── The recording, paused and resumed between the moments ──
  // OBS saying no to either is the take being over, not a detail: the loop would otherwise go on driving the replay.
  async function pauseTake() {
    try { await client.request('PauseRecord'); } catch (e) {
      if (e && e.code === 502) return;   // paused already
      throw new TakeEnded(e && e.code === 501 ? OBS_STOPPED : `OBS did not take the pause, so the TV shots were ended: ${e && e.message}`);
    }
  }
  async function resumeTake() {
    try { await client.request('ResumeRecord'); } catch (e) {
      if (e && e.code === 503) return;   // not paused
      throw new TakeEnded(e && e.code === 501 ? OBS_STOPPED : `OBS did not take the resume, so the TV shots were ended: ${e && e.message}`);
    }
  }
  function stillRecording() {
    const s = recording.status();
    if (!(s.recording && s.kind === 'tv')) throw new TakeEnded(OBS_STOPPED);
  }

  // A moment plays at real speed for `ms`, looked after: he is not in the car, the sim is still in its replay, Stop and the
  // quit end the wait at once.
  async function playFor(ms) {
    const end = now() + ms;
    let askedAt = now();
    while (!cancelled) {
      const left = end - now();
      if (left <= 0) break;
      await sleep(Math.min(watchMs, left));
      if (cancelled) break;
      guard();
      stillRecording();
      if (now() - askedAt >= watchStatusMs) {
        askedAt = now();
        guard(await replayStatus());
      }
    }
  }

  async function waitFiled(since) {
    const until = now() + filingWaitMs;
    while (now() < until) {
      const s = recording.status();
      if (s.lastFiled && s.lastFiled.kind === 'tv' && s.lastFiled.at >= since) return s.lastFiled;
      await sleep(200, { wake: false });
    }
    return null;
  }

  /**
   * Start a take of the recording in `folder` (or of `video`'s). Answers at once with { ok, reason?, moments? }: the
   * checks and the plan are made first, the take goes on by itself and says how it goes (onChange, status()).
   */
  async function start({ folder = null, video = null, sidecar = null } = {}) {
    if (running) return { ok: false, reason: RUNNING };
    if (inCar()) return { ok: false, reason: IN_CAR };
    if (!client.identified()) return { ok: false, reason: NOT_OPEN };
    const rs = recording.status();
    if (rs.recording || rs.starting) return { ok: false, reason: RECORDING };
    // The recording: by its folder, else by its video's folder.
    let rec = null;
    const where = folder || (video ? path.dirname(video) : null);
    if (where) rec = index.recordingIn(where, { fs: fsModule });
    if (!rec && sidecar) rec = { folder: path.dirname(sidecar), sidecar, video: video || null, name: path.basename(path.dirname(sidecar)) };
    if (!rec || !rec.sidecar) return { ok: false, reason: NO_RECORDING };
    let plan;
    try { plan = await readTvPlan(rec.sidecar, { fs: fsModule, leadInS, tailS, mergeGapS, maxMomentS, maxMoments }); } catch (e) { return { ok: false, reason: `The recording's telemetry could not be read: ${e.message}` }; }
    if (plan.problem) return { ok: false, reason: plan.problem };
    const sim = await replayStatus();
    if (!sim) return { ok: false, reason: NO_HOST };
    // The host answered, but not with a status: refused (not this machine's program), or not the app's own host at all (a
    // SimHub plugin has no replay route). That is not iRacing being closed.
    if (sim.available === undefined && sim.ok === false) return { ok: false, reason: `The app’s own host would not say where the replay is: ${sim.error || 'no answer'}.` };
    if (!sim.available || !sim.connected) return { ok: false, reason: sim.reason || NO_SIM };
    if (sim.onTrack) return { ok: false, reason: IN_CAR };
    if (!sim.replayPlaying) return { ok: false, reason: NOT_REPLAY };
    if (!sameTrack(plan.header && plan.header.track, sim.weekend)) return { ok: false, reason: OTHER_REPLAY };
    const baseName = `${path.basename(rec.video || rec.sidecar.replace(/\.telemetry\.jsonl$/i, ''), rec.video ? path.extname(rec.video) : '')}${TAKE_SUFFIX}`;
    running = true;
    cancelled = false;
    leftReplayLooks = 0;
    result = null;
    progress = { step: 'preparing', index: 0, total: plan.moments.length, label: null, startedAt: now(), folder: rec.folder, baseName };
    say('preparing');
    log(`[RacingDesk] TV shots: ${plan.moments.length} moments of ${rec.name || rec.folder}, from iRacing's replay`);
    run(rec, plan, sim, baseName).catch((e) => { finish({ ok: false, reason: e.message, moments: 0, cancelled: false }); });   // nothing of run's own throws past its catch
    return { ok: true, moments: plan.moments.length, folder: rec.folder };
  }

  // The take itself. Whatever happens in it, the facecam comes back and auto-record is let go before the outcome is
  // said, so that "done" means the scene is as it was.
  async function run(rec, plan, sim, baseName) {
    const release = recording.holdAuto('TV shots');
    const takeAt = now();
    const before = {
      cameraState: sim.camera && Number.isInteger(sim.camera.state) ? sim.camera.state : null,
      speed: sim.replay && Number.isInteger(sim.replay.speed) ? sim.replay.speed : null,
      slowMotion: !!(sim.replay && sim.replay.slowMotion),
    };
    const tried = { done: false };
    let started = false;
    let done = 0;
    let skipped = 0;
    let driving = false;
    let outcome;
    try {
      await hideFacecam();
      await hideReplayUi(before);
      const moments = plan.moments;
      for (let i = 0; i < moments.length; i++) {
        if (cancelled) break;
        guard();
        const m = moments[i];
        say('seeking', { index: i + 1, label: m.label });
        if (started) await pauseTake();
        const landed = await seekTo(m, i, sim);
        if (cancelled) break;
        if (!landed) {
          // The sim did not reach it (a moment from before the replay's memory, another session, another race): nothing
          // of where it is is recorded under this moment's name.
          skipped++;
          say('skipped', { index: i + 1, label: m.label, skipped });
          continue;
        }
        if (!started) {
          const began = await recording.record({ source: 'tv', take: { folder: rec.folder, baseName } });
          if (!began.ok) throw new Error(began.reason || 'the recording did not start');
          started = true;
        } else {
          stillRecording();
          await resumeTake();
        }
        say('recording', { index: i + 1, label: m.label });
        await command({ command: 'speed', speed: 1 });
        await playFor(Math.max(1000, Math.round((m.to - m.from) * 1000)));
        await command({ command: 'speed', speed: 0 }, { cleanup: true }).catch(() => {});
        done++;
      }
      if (started) {
        say('filing', { label: null });
        const stopped = await recording.stop();
        if (!stopped.ok) log(`[RacingDesk] TV shots: the take was not stopped cleanly: ${stopped.reason}`);
        // The recording has stopped: his facecam and iRacing's replay are put back now, not after the filing is waited for.
        await showFacecam();
        await putReplayBack(before, tried);
        const filed = await waitFiled(takeAt);
        outcome = { ok: !cancelled, cancelled, reason: cancelled ? 'stopped' : null, moments: done, skipped, video: filed ? filed.video : null, folder: filed ? filed.folder : rec.folder };
      } else {
        outcome = { ok: false, cancelled, reason: cancelled ? 'stopped before the first moment' : (skipped ? NOT_LANDED : 'no moment was recorded'), moments: 0, skipped };
      }
    } catch (e) {
      driving = !!(e && e.driving);
      outcome = { ok: false, cancelled: false, reason: e && e.reason ? e.reason : (e && e.message) || 'the take failed', moments: done, skipped };
      if (started && recording.status().recording) { try { await recording.stop(); } catch (err) { /* said by the keeper */ } }
    } finally {
      await showFacecam();
      // In the car, nothing more is sent to the replay: it is his. Otherwise it is put back as it was found.
      if (!driving) await putReplayBack(before, tried);
      release();
    }
    finish(outcome);
  }

  /** Stop the take where it is: the wait it is in is woken, the recording stops, the facecam comes back. */
  function cancel() {
    if (!running) return { ok: false, reason: 'No TV shots are being recorded.' };
    cancelled = true;
    wakeAll();
    say('cancelling');
    return { ok: true };
  }

  /**
   * The app is quitting: the take ends and his facecam is shown again, now. Resolves once it is (the caller bounds the
   * wait); what OBS cannot be told is left in the state file for the next start.
   */
  function stopForQuit() {
    if (running) { cancelled = true; wakeAll(); }
    return showFacecam();
  }

  /** Whether a quit has something to wait for: a take that has hidden his facecam. */
  function needsStopForQuit() {
    return running && hiddenNow.length > 0;
  }

  return { start, cancel, stopForQuit, needsStopForQuit, restoreLeft, status };
}

module.exports = {
  LEAD_IN_S, TAIL_S, MERGE_GAP_S, MAX_MOMENT_S, MAX_MOMENTS, LAND_TOLERANCE_S, LAND_WAIT_MS, SETTLE_MS, TAKE_SUFFIX, UI_HIDDEN,
  NOT_OPEN, RUNNING, RECORDING, IN_CAR, NO_SIM, NOT_REPLAY, OTHER_REPLAY, NO_RECORDING, NO_MOMENTS, NO_CLOCK, NO_HOST, DROVE, LEFT_REPLAY, OBS_STOPPED, NOT_LANDED,
  labelOf, priorityOf, momentsOf, readTvPlan, chooseCameraGroup, cameraItems, sameTrack, createTvShots,
};
