// TV shots: after a race, the moments its telemetry sidecar found — the places gained, the incidents, the pit stops —
// recorded again from iRacing's own replay through a TV camera, as one take beside the recording. Rebuilt on the
// iRacing SDK's replay commands, sent by the host (apps/host ReplayApi, /racing-desk/data/replay, a program on this
// machine alone): the old director sent keystrokes to whichever window had the focus and guessed how far a
// fast-forward had got. Nothing here presses a key.
//
// How a take goes, each step with a test in tests/unit/obs-tv-shots.spec.mjs:
// - The moments come from the sidecar's summary markers; each is a point in the sim's own clock, the `sn` and `st`
//   of the frame three seconds before it (the lead-in), which is what the replay is asked to seek to
//   (ReplaySearchSessionTime). Moments within five seconds of each other are one; at most twenty are taken, the
//   biggest first (a place gained, then an incident, then the pit lane), in the race's order.
// - Only out of the car, with OBS answering, nothing recording, and iRacing in its replay (the sim says
//   IsReplayPlaying; in the car it says so too, and a take is never made while he drives). Auto-record is held for
//   the take (the replay's pit lane and flags are not the race's); his facecam is hidden in the scene being recorded
//   while "Hide the facecam during TV shots" is on, and put back after, whatever happened in between.
// - The camera is a TV group of the session's (TV1, TV2, TV3 in turn), focused on his own car.
// - The replay is paused, the first moment sought and waited for (the sim says where it is), then the recording
//   starts (a recording of the keeper's own, filed as `<the race's video> tv` in the race's folder, with a sidecar
//   of kind 'tv' and no chapters); the moment plays at real speed and the replay is paused again; between moments
//   the recording is paused (PauseRecord) while the next seek lands and resumed (ResumeRecord) when it has, so the
//   take holds the moments and nothing of the seeking; after the last the recording stops and the keeper files it.
// - Progress is said at every step (onChange: the desk's pill and card, the tray, the Stream Deck); Stop ends the
//   take where it is, and the facecam comes back.
const path = require('path');
const readline = require('readline');
const fs = require('fs');
const index = require('./recordings-index');

const LEAD_IN_S = 3;
const TAIL_S = 3;
const MERGE_GAP_S = 5;
const MAX_MOMENTS = 20;
const LAND_TOLERANCE_S = 1.5;
const LAND_WAIT_MS = 15000;
const LAND_POLL_MS = 300;
const SETTLE_MS = 800;
const FILING_WAIT_MS = 15000;
const TAKE_SUFFIX = ' tv';
const TV_GROUP = /^tv\s*\d*$/i;
const CAMERA_LIKE = /facecam|webcam|\bcam\b|camera|video capture/i;
const CAMERA_KINDS = ['dshow_input', 'av_capture_input', 'v4l2_input', 'macos-avcapture'];

const NOT_OPEN = "OBS isn't open, so TV shots cannot be recorded.";
const RUNNING = 'TV shots are being recorded already.';
const RECORDING = 'A recording is running. Stop it first, then press TV shots.';
const IN_CAR = 'TV shots are made from the desk after the race, with iRacing in its replay.';
const NO_SIM = "iRacing isn't running. Open the replay of the race in iRacing, then press TV shots.";
const NOT_REPLAY = "iRacing isn't in its replay. Open the replay of the race in iRacing, then press TV shots.";
const NO_RECORDING = 'There is no recording to make TV shots of.';
const NO_MOMENTS = 'The recording has no moments to show: no place gained, no incident, no pit stop.';
const NO_CLOCK = "The recording's telemetry has no session clock in it, so its moments cannot be found in the replay.";
const NO_HOST = 'The app’s own host is not answering, and it is what drives the replay.';

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
 * within five seconds of each other are one moment; at most `maxMoments`, by priority, in the race's order.
 * `frames` is [{ t, sn, st }] in order. A moment whose lead-in has no sim clock is left out; none at all is `clock: false`.
 */
function momentsOf({ markers = [], frames = [] } = {}, { leadInS = LEAD_IN_S, tailS = TAIL_S, mergeGapS = MERGE_GAP_S, maxMoments = MAX_MOMENTS } = {}) {
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
    if (last && p.t - last.end < mergeGapS) {
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
    out.push({ label: m.label, priority: m.priority, t: m.t, from, to: m.end + tailS, sn: at.sn, st: Math.max(0, at.st - Math.max(0, from - at.t)), frame: at.frame });
  }
  return { moments: out, clock: true };
}

/**
 * The plan for a sidecar file, read line by line (an hour of frames is some 160 MB; only t, sn and st of each frame
 * are kept): { header, moments, clock, frames, problem }.
 */
async function readTvPlan(file, { fs: fsModule = fs, ...options } = {}) {
  const frames = [];
  let header = null;
  let summary = null;
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
      if (obj._type === 'summary') { summary = obj; return; }
      if (obj._type) return;
      frames.push({ t: Number(obj.t), frame: obj.frame, sn: obj.sn === undefined ? NaN : Number(obj.sn), st: obj.st === undefined ? NaN : Number(obj.st) });
    });
    lines.on('close', resolve);
  });
  const markers = summary && Array.isArray(summary.markers) ? summary.markers : [];
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

function createTvShots({
  client,
  recording,
  replay,
  settings = () => ({}),
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
  maxMoments = MAX_MOMENTS,
  landWaitMs = LAND_WAIT_MS,
  landPollMs = LAND_POLL_MS,
  landToleranceS = LAND_TOLERANCE_S,
  settleMs = SETTLE_MS,
  filingWaitMs = FILING_WAIT_MS,
} = {}) {
  if (!client) throw new Error('TV shots need the OBS client');
  if (!recording) throw new Error('TV shots need the recording keeper');
  if (!replay || typeof replay.status !== 'function' || typeof replay.command !== 'function') throw new Error('TV shots need the host\'s replay route');

  let running = false;
  let cancelled = false;
  let progress = { step: null, index: 0, total: 0, label: null, startedAt: null };
  let result = null;   // { ok, reason, video, folder, moments, cancelled, at }
  let lastAt = null;

  const sleep = (ms) => new Promise((resolve) => { const t = setTimer(resolve, ms); if (t && typeof t.unref === 'function') t.unref(); });

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
    log(`[RacingDesk] TV shots: ${outcome.ok ? `done, ${outcome.moments} moments in ${outcome.video || 'the take'}` : `${outcome.cancelled ? 'stopped' : 'not made'}: ${outcome.reason}`}`);
    say(outcome.ok ? 'done' : outcome.cancelled ? 'cancelled' : 'failed');
  }

  async function replayStatus() {
    try { return await replay.status(); } catch (e) { return null; }
  }

  async function command(body) {
    const answer = await replay.command(body);
    if (!answer || answer.ok !== true) throw new Error((answer && (answer.error || answer.reason)) || `the host did not take the replay command ${body.command}`);
    return answer;
  }

  // The seek has landed when the sim says it is in that session within a second and a half of the time asked for.
  async function waitLanded(moment) {
    const until = now() + landWaitMs;
    let seen = null;
    while (now() < until && !cancelled) {
      seen = await replayStatus();
      const r = seen && seen.replay;
      if (r && Number(r.sessionNum) === moment.sn && Math.abs(Number(r.sessionTime) - moment.st) <= landToleranceS) return { landed: true, seen };
      await sleep(landPollMs);
    }
    return { landed: false, seen };
  }

  async function seekTo(moment, i, groups) {
    await command({ command: 'speed', speed: 0 });
    await command({ command: 'seek', sessionNum: moment.sn, sessionTime: moment.st });
    const group = chooseCameraGroup(groups, i);
    if (group) await command({ command: 'camera', focus: 'driver', group: group.num, camera: 0 });
    const landed = await waitLanded(moment);
    if (!landed.landed) log(`[RacingDesk] TV shots: the replay did not say it had reached session ${moment.sn} at ${moment.st.toFixed(1)} s within ${Math.round(landWaitMs / 1000)} s; recording where it is`);
    await sleep(settleMs);
    return landed.landed;
  }

  // His facecam, hidden in the scene OBS is recording and shown again after. Only what was shown is put back.
  async function hideFacecam() {
    if (settings().tvShotsHideFacecam === false) return [];
    const hidden = [];
    try {
      const scene = await client.request('GetCurrentProgramScene');
      const sceneName = scene && (scene.sceneName || scene.currentProgramSceneName);
      if (!sceneName) return [];
      const list = await client.request('GetSceneItemList', { sceneName });
      for (const it of cameraItems(list && list.sceneItems)) {
        if (it.sceneItemEnabled === false) continue;
        await client.request('SetSceneItemEnabled', { sceneName, sceneItemId: it.sceneItemId, sceneItemEnabled: false });
        hidden.push({ sceneName, sceneItemId: it.sceneItemId, sourceName: it.sourceName });
      }
      if (hidden.length) log(`[RacingDesk] TV shots: the facecam is hidden for the take (${hidden.map((h) => h.sourceName).join(', ')})`);
    } catch (e) {
      log(`[RacingDesk] TV shots: the facecam could not be hidden: ${e.message}`);
    }
    return hidden;
  }

  async function showFacecam(hidden) {
    for (const h of hidden) {
      try { await client.request('SetSceneItemEnabled', { sceneName: h.sceneName, sceneItemId: h.sceneItemId, sceneItemEnabled: true }); } catch (e) { log(`[RacingDesk] TV shots: the facecam "${h.sourceName}" could not be shown again: ${e.message}`); }
    }
    if (hidden.length) log('[RacingDesk] TV shots: the facecam is back');
  }

  async function waitFiled(since) {
    const until = now() + filingWaitMs;
    while (now() < until) {
      const s = recording.status();
      if (s.lastFiled && s.lastFiled.kind === 'tv' && s.lastFiled.at >= since) return s.lastFiled;
      await sleep(200);
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
    try { plan = await readTvPlan(rec.sidecar, { fs: fsModule, leadInS, tailS, mergeGapS, maxMoments }); } catch (e) { return { ok: false, reason: `The recording's telemetry could not be read: ${e.message}` }; }
    if (plan.problem) return { ok: false, reason: plan.problem };
    const sim = await replayStatus();
    if (!sim) return { ok: false, reason: NO_HOST };
    if (!sim.available || !sim.connected) return { ok: false, reason: sim.reason || NO_SIM };
    if (sim.onTrack) return { ok: false, reason: IN_CAR };
    if (!sim.replayPlaying) return { ok: false, reason: NOT_REPLAY };
    const baseName = `${path.basename(rec.video || rec.sidecar.replace(/\.telemetry\.jsonl$/i, ''), rec.video ? path.extname(rec.video) : '')}${TAKE_SUFFIX}`;
    running = true;
    cancelled = false;
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
    let hidden = [];
    let started = false;
    let done = 0;
    let outcome;
    const groups = sim.groups || [];
    try {
      hidden = await hideFacecam();
      const moments = plan.moments;
      for (let i = 0; i < moments.length; i++) {
        if (cancelled) break;
        const m = moments[i];
        say('seeking', { index: i + 1, label: m.label });
        if (started) await client.request('PauseRecord').catch(() => {});
        await seekTo(m, i, groups);
        if (cancelled) break;
        if (!started) {
          const began = await recording.record({ source: 'tv', take: { folder: rec.folder, baseName } });
          if (!began.ok) throw new Error(began.reason || 'the recording did not start');
          started = true;
        } else {
          await client.request('ResumeRecord').catch(() => {});
        }
        say('recording', { index: i + 1, label: m.label });
        await command({ command: 'speed', speed: 1 });
        await sleep(Math.max(1000, Math.round((m.to - m.from) * 1000)));
        await command({ command: 'speed', speed: 0 }).catch(() => {});
        done++;
      }
      if (started) {
        say('filing', { label: null });
        const stopAt = now();
        const stopped = await recording.stop();
        if (!stopped.ok) log(`[RacingDesk] TV shots: the take was not stopped cleanly: ${stopped.reason}`);
        const filed = await waitFiled(stopAt);
        outcome = { ok: !cancelled, cancelled, reason: cancelled ? 'stopped' : null, moments: done, video: filed ? filed.video : null, folder: filed ? filed.folder : rec.folder };
      } else {
        outcome = { ok: false, cancelled, reason: cancelled ? 'stopped before the first moment' : 'no moment was recorded', moments: 0 };
      }
    } catch (e) {
      outcome = { ok: false, cancelled, reason: e.message, moments: done };
      if (started && recording.status().recording) { try { await recording.stop(); } catch (err) { /* said by the keeper */ } }
    } finally {
      await showFacecam(hidden);
      release();
    }
    finish(outcome);
  }

  /** Stop the take where it is: the recording stops, the facecam comes back. */
  function cancel() {
    if (!running) return { ok: false, reason: 'No TV shots are being recorded.' };
    cancelled = true;
    say('cancelling');
    return { ok: true };
  }

  return { start, cancel, status };
}

module.exports = {
  LEAD_IN_S, TAIL_S, MERGE_GAP_S, MAX_MOMENTS, LAND_TOLERANCE_S, LAND_WAIT_MS, SETTLE_MS, TAKE_SUFFIX,
  NOT_OPEN, RUNNING, RECORDING, IN_CAR, NO_SIM, NOT_REPLAY, NO_RECORDING, NO_MOMENTS, NO_CLOCK, NO_HOST,
  labelOf, priorityOf, momentsOf, readTvPlan, chooseCameraGroup, cameraItems, createTvShots,
};
