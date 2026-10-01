/**
 * TV shots (modules/js/obs/tv-shots.js): the moments of a recording's sidecar recorded again from iRacing's replay,
 * driven through the host's replay route, as one take in the race's folder. Here the sidecar is one the real writer
 * made, OBS is the fake obs-websocket server on 127.0.0.1 over the real client and the real keeper, and the host's
 * replay route is a fake that writes down every command and answers where the replay is. No key is pressed, no
 * message reaches iRacing, and nothing but temp folders is written.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFakeObs } from './fake-obs.mjs';
import { buildFinalMp4 } from './mp4-fixture.mjs';
import { MOCK_TELEMETRY } from '../helpers.mjs';

const require = createRequire(import.meta.url);
const { createObsClient } = require('../../modules/js/obs/client.js');
const { createRecordingKeeper } = require('../../modules/js/obs/recording.js');
const tv = require('../../modules/js/obs/tv-shots.js');
const { createSidecar } = require('../../modules/js/telemetry-sidecar.js');

const PASSWORD = 'horse-battery';
const until = async (what, timeoutMs = 6000) => {
  const start = Date.now();
  while (!what()) {
    if (Date.now() - start > timeoutMs) throw new Error('waited too long');
    await new Promise((r) => setTimeout(r, 15));
  }
};
const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const linesOf = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

// A live race payload, in the replay: the sim running, not the demo, out of the car (a replay is not the car).
const REPLAY_PAYLOAD = { ...MOCK_TELEMETRY, 'DataCorePlugin.GameRawData.Telemetry.IsOnTrack': 0, 'DataCorePlugin.GameRawData.Telemetry.SessionNum': 2, 'DataCorePlugin.GameRawData.Telemetry.SessionTime': 3000, 'RacingDesk.Plugin.Session.TrackName': 'Zandvoort' };

// A race's sidecar, as the writer makes it: ten frames a second for `seconds`, the sim's clock on each (session 2,
// from 1000 s), with a place gained at 10 s, an incident at 30 s, the pit lane from 50 to 53 s.
function writeRaceSidecar(file, { seconds = 60, clock = true, track = 'Circuit Zandvoort' } = {}) {
  const writer = createSidecar({ write: (f, text) => fs.appendFileSync(f, text) });
  const t0 = Date.parse('2026-09-29T20:13:22Z');
  writer.start({ path: file, startedAt: t0, producer: 'obs', obsOutputPath: 'x', kind: 'recording' });
  for (let i = 0; i <= seconds * 10; i++) {
    const t = i / 10;
    const p = {
      ...MOCK_TELEMETRY,
      'RacingDesk.Plugin.TrackMap.TrackDisplayName': track,
      'DataCorePlugin.GameData.Position': t >= 10 ? 5 : 6,
      'RacingDesk.Plugin.DS.IncidentCount': t >= 30 ? 2 : 0,
      'RacingDesk.Plugin.DS.IsInPitLane': t >= 50 && t < 53 ? 1 : 0,
      'DataCorePlugin.GameData.CurrentLap': 3,
    };
    if (clock) { p['DataCorePlugin.GameRawData.Telemetry.SessionNum'] = 2; p['DataCorePlugin.GameRawData.Telemetry.SessionTime'] = 1000 + t; }
    else { delete p['DataCorePlugin.GameRawData.Telemetry.SessionNum']; delete p['DataCorePlugin.GameRawData.Telemetry.SessionTime']; }
    writer.frame(p, { at: t0 + i * 100 });
  }
  return writer.stop({ stoppedAt: t0 + seconds * 1000, reason: 'stopped', videoOffsetMs: 0, alignment: { method: 'end' } });
}

// The host's replay route, faked: it writes down the commands and lands every seek at once (or never, or late: `landMs`,
// `landsAt`). As the host does, it refuses every command with a 409 while he is on track (`state.onTrack`, which a test
// can turn on partway through a take), and it says the camera system's flags and the session's own track.
function fakeReplay({ available = true, connected = true, replayPlaying = true, onTrack = false, groups = [{ num: 1, name: 'Cockpit' }, { num: 5, name: 'TV1' }, { num: 6, name: 'TV2' }, { num: 9, name: 'Chase' }], landMs = 0, landsAt = null, weekend = { trackDisplayName: 'Circuit Zandvoort', trackName: 'zandvoort full', subSessionId: 71 }, cameraState = 16, speed = 0 } = {}) {
  const state = { sessionNum: 2, sessionTime: 0, speed, group: 1, pending: null, onTrack, replayPlaying, cameraState };
  const calls = [];
  return {
    calls, state,
    status: async () => {
      if (state.pending && Date.now() >= state.pending.at) { state.sessionNum = state.pending.sn; state.sessionTime = state.pending.st; state.pending = null; }
      return { available, connected, replayPlaying: state.replayPlaying, onTrack: state.onTrack, sessionNum: 2, sessionTime: 3000, replay: { sessionNum: state.sessionNum, sessionTime: state.sessionTime, speed: state.speed, slowMotion: false }, camera: { group: state.group, state: state.cameraState }, weekend, player: { carNumber: '42', carNumberRaw: 42 }, groups, reason: available ? undefined : 'iRacing is not running, so its replay cannot be driven.' };
    },
    command: async (body) => {
      if (state.onTrack) return { ok: false, error: 'You are in the car, so the replay and the cameras are left alone.', status: 409 };
      calls.push(body);
      if (body.command === 'seek' && (!landsAt || landsAt(body.sessionNum, body.sessionTime))) state.pending = { sn: body.sessionNum, st: body.sessionTime, at: Date.now() + landMs };
      if (body.command === 'speed') state.speed = body.speed;
      if (body.command === 'camera') state.group = body.group;
      if (body.command === 'cameraState') state.cameraState = body.state;
      return { ok: true };
    },
  };
}

let dir;
let server;
test.beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-tv-shots-'));
  server = await startFakeObs({ password: PASSWORD, recordDirectory: dir.replace(/\\/g, '/') });
});
test.afterEach(async () => {
  await server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// A race's folder with its recording, and the keeper and the director over the fake OBS and the fake replay route.
function rig({ replay = fakeReplay(), settings = {}, inCar = false, payload = REPLAY_PAYLOAD, sidecarOptions = {}, options = {} } = {}) {
  const race = path.join(dir, '2026-09-29 22-13 Zandvoort Porsche 911 GT3 Cup (992)');
  fs.mkdirSync(race, { recursive: true });
  fs.writeFileSync(path.join(race, '2026-09-29 22-13-22.mp4'), buildFinalMp4({ durationMs: 60000, withChapterTrack: false }));
  writeRaceSidecar(path.join(race, '2026-09-29 22-13-22.telemetry.jsonl'), sidecarOptions);
  const lines = [];
  const changes = [];
  const fake = { payload, inCar, settings: { obsStartOnRecord: true, recordingChapters: true, ...settings } };
  const client = createObsClient({ port: server.port, password: () => PASSWORD, retryMs: 40, connectTimeoutMs: 500, log: (l) => lines.push(l) });
  const keeper = createRecordingKeeper({
    client, settings: () => fake.settings, recordFolder: () => dir, stateFile: path.join(dir, 'state', 'recording-state.json'),
    freeSpace: async () => 400e9, fetchPayload: async () => fake.payload, inCar: () => fake.inCar, obsRunning: async () => true,
    notice: () => {}, log: (l) => lines.push(l),
    waitStartedMs: 400, waitStoppedMs: 400, waitObsMs: 600, statusEveryMs: 60, idleFreeEveryMs: 100000, sidecarHz: 50, stableMs: 40, stableTimeoutMs: 2000, moveRetryMs: 20,
  });
  keeper.start();
  client.start();
  const shots = tv.createTvShots({
    client, recording: keeper, replay, settings: () => fake.settings, stateFile: path.join(dir, 'state', 'tv-state.json'), inCar: () => fake.inCar, log: (l) => lines.push(l), onChange: (s) => changes.push(s),
    leadInS: 0.2, tailS: 0.2, settleMs: 30, landPollMs: 20, landWaitMs: 1500, filingWaitMs: 6000, watchMs: 20, watchStatusMs: 40, ...options,
  });
  // The file OBS "writes" has to be there for the keeper to file: written when the recording begins.
  const writer = setInterval(() => { const s = keeper.status(); if (s.recording && s.outputPath && !fs.existsSync(s.outputPath)) fs.writeFileSync(s.outputPath, buildFinalMp4({ durationMs: 3000, withChapterTrack: false })); }, 20);
  return { race, client, keeper, shots, replay, lines, changes, fake, dispose: () => { clearInterval(writer); keeper.dispose(); client.stop(); } };
}

const facecamOf = (scene) => server.state.scenes.find((s) => s.sceneName === scene).items.find((i) => i.sourceName === 'Video Capture Device');
const requests = (type) => server.requests.filter((q) => q.type === type);

test('the moments of a sidecar: the places gained, the incidents and the pit lane, merged within five seconds, capped by priority, each with the sim\'s clock at its lead-in', () => {
  const frames = Array.from({ length: 601 }, (_, i) => ({ t: i / 10, frame: i, sn: 2, st: 1000 + i / 10 }));
  const markers = [
    { type: 'new_lap', t: 5000, lap: 2 },
    { type: 'position_change', t: 10000, from: 6, to: 5, direction: 'gained' },
    { type: 'incident', t: 30000, from: 0, to: 2 },
    { type: 'position_change', t: 32000, from: 5, to: 6, direction: 'lost' },
    { type: 'pit_entry', t: 50000 },
    { type: 'pit_exit', t: 53000 },
  ];
  const { moments, clock } = tv.momentsOf({ markers, frames });
  expect(clock).toBe(true);
  expect(moments.map((m) => [m.label, m.priority, m.t, m.from, m.to])).toEqual([
    ['P6 → P5', 3, 10, 7, 13],
    ['Incident ×2 + Lost P5 → P6', 2, 30, 27, 35],
    ['Pit in + Pit out', 1, 50, 47, 56],
  ]);
  // The sim's clock at the lead-in, which is what the replay is asked to seek to.
  expect(moments.map((m) => [m.sn, m.st])).toEqual([[2, 1007], [2, 1027], [2, 1047]]);
  // A lap is not a moment; nothing with no clock is one.
  expect(tv.momentsOf({ markers, frames: frames.map((f) => ({ t: f.t })) })).toEqual({ moments: [], clock: false });
  // Capped: the biggest kept, in the race's order.
  const many = Array.from({ length: 30 }, (_, i) => ({ type: i % 3 === 0 ? 'position_change' : 'incident', t: (i + 1) * 10000, from: 9, to: 8, direction: 'gained' }));
  const capped = tv.momentsOf({ markers: many, frames: Array.from({ length: 3200 }, (_, i) => ({ t: i / 10, sn: 2, st: i / 10 })) }, { maxMoments: 5 });
  expect(capped.moments).toHaveLength(5);
  expect(capped.moments.every((m) => m.label.startsWith('P9 → P8'))).toBe(true);
  expect(capped.moments.map((m) => m.t)).toEqual([10, 40, 70, 100, 130]);
  // The camera: the TV groups in turn, else any TV, else none.
  const groups = [{ num: 1, name: 'Cockpit' }, { num: 5, name: 'TV1' }, { num: 6, name: 'TV2' }, { num: 7, name: 'TV3' }, { num: 9, name: 'Chase' }];
  expect([0, 1, 2, 3].map((i) => tv.chooseCameraGroup(groups, i).name)).toEqual(['TV1', 'TV2', 'TV3', 'TV1']);
  expect(tv.chooseCameraGroup([{ num: 1, name: 'Cockpit' }, { num: 4, name: 'TV Static' }], 0).num).toBe(4);
  expect(tv.chooseCameraGroup([{ num: 1, name: 'Cockpit' }], 0)).toBeNull();
  // His camera among a scene's items: a capture device, or anything named like one.
  expect(tv.cameraItems([{ sourceName: 'game video', inputKind: 'monitor_capture' }, { sourceName: 'Video Capture Device', inputKind: 'dshow_input' }, { sourceName: 'Facecam', inputKind: 'browser_source' }]).map((i) => i.sourceName)).toEqual(['Video Capture Device', 'Facecam']);
});

test('a take: the facecam hidden, auto-record held, the replay paused and sought by the sidecar\'s clock, the recording paused between the moments and resumed after each seek, the take filed in the race\'s folder with its sidecar, the facecam back', async () => {
  test.setTimeout(30000);
  const r = rig();
  try {
    await until(() => r.client.identified());
    const plan = await tv.readTvPlan(path.join(r.race, '2026-09-29 22-13-22.telemetry.jsonl'), { leadInS: 0.2, tailS: 0.2 });
    expect(plan.moments.map((m) => m.label)).toEqual(['P6 → P5', 'Incident ×2', 'Pit in + Pit out']);
    expect(plan.header.car).toBe('Porsche 911 GT3 R');

    const began = await r.shots.start({ folder: r.race });
    expect(began).toMatchObject({ ok: true, moments: 3, folder: r.race });
    expect(r.shots.status()).toMatchObject({ running: true, total: 3 });
    expect(r.keeper.status().autoHeld).toBe('TV shots');
    // The facecam is hidden in the scene being recorded, and only there.
    await until(() => facecamOf('Large Video').enabled === false);
    expect(facecamOf('Small Video').enabled).toBe(true);
    await until(() => r.shots.status().step === 'done', 25000);

    const s = r.shots.status();
    expect(s.result).toMatchObject({ ok: true, cancelled: false, moments: 3 });
    expect(s.result.video).toBe(path.join(r.race, '2026-09-29 22-13-22 tv.mp4'));
    expect(fs.existsSync(s.result.video)).toBe(true);
    // The take's sidecar beside it: kind tv, the two pauses between the three moments, no chapters.
    const lines = linesOf(path.join(r.race, '2026-09-29 22-13-22 tv.telemetry.jsonl'));
    expect(lines[0]).toMatchObject({ _type: 'header', kind: 'tv', producer: 'obs' });
    const summary = lines.at(-1);
    expect(summary._type).toBe('summary');
    expect(summary.pauses).toHaveLength(2);
    expect(summary.chapters).toEqual([]);
    expect(requests('CreateRecordChapter')).toHaveLength(0);
    expect(r.keeper.status().lastFiled).toMatchObject({ kind: 'tv', folder: r.race });
    // The race's own files are as they were.
    expect(fs.existsSync(path.join(r.race, '2026-09-29 22-13-22.mp4'))).toBe(true);
    expect(fs.existsSync(path.join(r.race, '2026-09-29 22-13-22.telemetry.jsonl'))).toBe(true);

    // What was asked of the replay, in order: iRacing's own replay controls hidden (the camera flags it said, with UIHidden
    // added), paused, sought to the first moment's clock, the TV camera on his car by its number (the driver's focus names
    // no car); played and paused for the moment; then the next, on the next TV group; and at the end the replay as found.
    const calls = r.replay.calls;
    expect(calls.slice(0, 4)).toEqual([
      { command: 'cameraState', state: 16 | tv.UI_HIDDEN },
      { command: 'speed', speed: 0 },
      { command: 'seek', sessionNum: 2, sessionTime: plan.moments[0].st },
      { command: 'camera', carNumber: 42, group: 5, camera: 0 },
    ]);
    expect(calls.filter((c) => c.command === 'camera').every((c) => c.focus === undefined && c.carNumber === 42)).toBe(true);
    expect(calls.slice(-2)).toEqual([{ command: 'cameraState', state: 16 }, { command: 'speed', speed: 0, slowMotion: false }]);
    expect(r.replay.state.cameraState).toBe(16);
    expect(calls.filter((c) => c.command === 'seek').map((c) => c.sessionTime)).toEqual(plan.moments.map((m) => m.st));
    expect(calls.filter((c) => c.command === 'camera').map((c) => c.group)).toEqual([5, 6, 5]);
    expect(calls.filter((c) => c.command === 'speed' && c.speed === 1)).toHaveLength(3);
    // The recording: one StartRecord, paused twice and resumed twice between the moments, stopped once; no key pressed.
    expect(requests('StartRecord')).toHaveLength(1);
    expect(requests('PauseRecord')).toHaveLength(2);
    expect(requests('ResumeRecord')).toHaveLength(2);
    expect(requests('StopRecord')).toHaveLength(1);
    // The facecam is back, auto-record is let go, and the keeper is idle.
    expect(facecamOf('Large Video').enabled).toBe(true);
    expect(r.keeper.status().autoHeld).toBeNull();
    expect(r.keeper.status().recording).toBe(false);
    // Progress was said at every step.
    const steps = r.changes.map((c) => c.step);
    expect(steps[0]).toBe('preparing');
    expect(steps).toContain('seeking');
    expect(steps).toContain('recording');
    expect(steps).toContain('filing');
    expect(steps.at(-1)).toBe('done');
    expect(r.changes.filter((c) => c.step === 'recording').map((c) => c.label)).toEqual(['P6 → P5', 'Incident ×2', 'Pit in + Pit out']);
    // A second press while it runs would have been refused; after, the take can be made again.
    expect(r.lines.some((l) => /TV shots: done, 3 moments/.test(l))).toBe(true);
  } finally { r.dispose(); }
});

test('stopped part-way: the recording stops, what was recorded is filed, the facecam comes back; the switch off leaves the facecam alone', async () => {
  test.setTimeout(30000);
  const r = rig({ options: { leadInS: 2, tailS: 2 } });
  try {
    await until(() => r.client.identified());
    expect(r.shots.cancel()).toMatchObject({ ok: false });
    expect((await r.shots.start({ folder: r.race })).ok).toBe(true);
    expect((await r.shots.start({ folder: r.race }))).toEqual({ ok: false, reason: 'TV shots are being recorded already.' });
    await until(() => r.shots.status().step === 'recording' && r.shots.status().index === 1, 10000);
    // The file is there, as OBS's is from its STARTED: the rig writes it within 20 ms, and a stop before that has nothing to file.
    await until(() => { const s = r.keeper.status(); return !!s.outputPath && fs.existsSync(s.outputPath); });
    expect(r.shots.cancel()).toEqual({ ok: true });
    expect(r.shots.status().step).toBe('cancelling');
    await until(() => r.shots.status().step === 'cancelled', 20000);
    expect(r.shots.status().result).toMatchObject({ ok: false, cancelled: true, moments: 1 });
    expect(r.keeper.status().recording).toBe(false);
    expect(facecamOf('Large Video').enabled).toBe(true);
    expect(r.keeper.status().autoHeld).toBeNull();
    expect(requests('StopRecord')).toHaveLength(1);
    expect(fs.existsSync(path.join(r.race, '2026-09-29 22-13-22 tv.mp4'))).toBe(true);
  } finally { r.dispose(); }
  // With "Hide the facecam during TV shots" off the camera is left as it is.
  const r2 = rig({ settings: { tvShotsHideFacecam: false } });
  try {
    await until(() => r2.client.identified());
    const from = server.requests.length;
    expect((await r2.shots.start({ folder: r2.race })).ok).toBe(true);
    await until(() => r2.shots.status().step === 'done', 25000);
    expect(server.requests.slice(from).filter((q) => q.type === 'SetSceneItemEnabled')).toHaveLength(0);
    expect(facecamOf('Large Video').enabled).toBe(true);
  } finally { r2.dispose(); }
});

test('refused in words: in the car, OBS closed, a recording running, no sim, iRacing not in its replay, a recording with no moments or no clock, no recording', async () => {
  const r = rig({ inCar: true });
  try {
    await until(() => r.client.identified());
    expect(await r.shots.start({ folder: r.race })).toEqual({ ok: false, reason: tv.IN_CAR });
    r.fake.inCar = false;
    // A recording running.
    expect((await r.keeper.record({ source: 'desk' })).ok).toBe(true);
    expect(await r.shots.start({ folder: r.race })).toEqual({ ok: false, reason: tv.RECORDING });
    await r.keeper.stop();
    await until(() => !r.keeper.status().recording);
    // No recording, or one with nothing in it.
    expect(await r.shots.start({ folder: path.join(dir, 'nowhere') })).toEqual({ ok: false, reason: tv.NO_RECORDING });
    expect(await r.shots.start({})).toEqual({ ok: false, reason: tv.NO_RECORDING });
    const dull = path.join(dir, 'dull');
    fs.mkdirSync(dull);
    const w = createSidecar({ write: (f, text) => fs.appendFileSync(f, text) });
    w.start({ path: path.join(dull, 'a.telemetry.jsonl'), startedAt: 1000 });
    for (let i = 0; i < 20; i++) w.frame({ ...MOCK_TELEMETRY, 'DataCorePlugin.GameRawData.Telemetry.SessionNum': 2, 'DataCorePlugin.GameRawData.Telemetry.SessionTime': 100 + i }, { at: 1000 + i * 100 });
    w.stop({ stoppedAt: 4000 });
    expect(await r.shots.start({ folder: dull })).toEqual({ ok: false, reason: tv.NO_MOMENTS });
    const noClock = path.join(dir, 'noclock');
    fs.mkdirSync(noClock);
    writeRaceSidecar(path.join(noClock, 'b.telemetry.jsonl'), { clock: false });
    expect(await r.shots.start({ folder: noClock })).toEqual({ ok: false, reason: tv.NO_CLOCK });
    // Nothing of the replay was asked for by any of it, and nothing recorded.
    expect(r.replay.calls).toEqual([]);
  } finally { r.dispose(); }

  for (const [replay, reason] of [
    [fakeReplay({ available: false, connected: false }), 'iRacing is not running, so its replay cannot be driven.'],
    [fakeReplay({ onTrack: true }), tv.IN_CAR],
    [fakeReplay({ replayPlaying: false }), tv.NOT_REPLAY],
    [{ status: async () => { throw new Error('ECONNREFUSED'); }, command: async () => ({ ok: true }), calls: [] }, tv.NO_HOST],
    // The host answered, but not with a status: refused (403), or not the app's own host (a SimHub plugin: 404). Not "iRacing isn't running".
    [{ status: async () => ({ ok: false, error: 'this is for the app on this machine', status: 403 }), command: async () => ({ ok: true }), calls: [] }, 'The app’s own host would not say where the replay is: this is for the app on this machine.'],
    [{ status: async () => ({ ok: false, error: 'the host answered 404', status: 404 }), command: async () => ({ ok: true }), calls: [] }, 'The app’s own host would not say where the replay is: the host answered 404.'],
    // Another race's replay is open: a different track than the recording's.
    [fakeReplay({ weekend: { trackDisplayName: 'Spa-Francorchamps', trackName: 'spa up', subSessionId: 9 } }), tv.OTHER_REPLAY],
  ]) {
    const r2 = rig({ replay });
    try {
      await until(() => r2.client.identified());
      const from = server.requests.length;
      expect(await r2.shots.start({ folder: r2.race })).toEqual({ ok: false, reason });
      expect(replay.calls).toEqual([]);
      expect(server.requests.slice(from).filter((q) => q.type === 'StartRecord')).toHaveLength(0);
    } finally { r2.dispose(); }
  }

  // OBS closed.
  const closed = await startFakeObs({ password: PASSWORD });
  const freePort = closed.port;
  await closed.close();
  const lines = [];
  const client = createObsClient({ port: freePort, password: () => PASSWORD, retryMs: 40, connectTimeoutMs: 300, log: (l) => lines.push(l) });
  const keeper = createRecordingKeeper({ client, settings: () => ({}), recordFolder: () => dir, stateFile: path.join(dir, 's.json'), freeSpace: async () => 400e9, fetchPayload: async () => REPLAY_PAYLOAD, log: () => {} });
  keeper.start();
  client.start();
  try {
    await until(() => client.state().phase === 'closed');
    const shots = tv.createTvShots({ client, recording: keeper, replay: fakeReplay(), log: () => {} });
    expect(await shots.start({ folder: dir })).toEqual({ ok: false, reason: tv.NOT_OPEN });
  } finally { keeper.dispose(); client.stop(); }
});

// ── What the review of stage 3 found ──

const stateFileOf = () => path.join(dir, 'state', 'tv-state.json');
const hiddenIn = (file) => JSON.parse(fs.readFileSync(file, 'utf8')).hidden;

test('a long battle is several moments, not one of minutes; the lead-in\'s clock is the frame\'s plus the time to it, from a frame before it or after it', () => {
  // A place gained every four seconds for two minutes used to merge into one moment as long as the battle.
  const frames = Array.from({ length: 1301 }, (_, i) => ({ t: i / 10, sn: 2, st: 1000 + i / 10 }));
  const battle = Array.from({ length: 30 }, (_, i) => ({ type: 'position_change', t: (i + 1) * 4000, from: 9, to: 8, direction: 'gained' }));
  const { moments } = tv.momentsOf({ markers: battle, frames }, { leadInS: 3, tailS: 3 });
  expect(moments.length).toBeGreaterThanOrEqual(4);
  expect(moments.every((m) => m.to - m.from <= tv.MAX_MOMENT_S + 3 + 3 + 1e-9)).toBe(true);
  expect(moments[0].t).toBe(4);
  // The frames are three seconds apart here, so the lead-in at 5 s falls between them: the sim's clock there is the frame
  // before's (1003) and the two seconds on, 1005 — the sign was wrong, and made it 1001.
  const sparse = [0, 3, 6, 9].map((t) => ({ t, sn: 2, st: 1000 + t }));
  const marker = [{ type: 'incident', t: 8000, from: 0, to: 1 }];
  expect(tv.momentsOf({ markers: marker, frames: sparse }, { leadInS: 3, tailS: 3 }).moments[0]).toMatchObject({ from: 5, sn: 2, st: 1005 });
  // The recording began after the lead-in: the first frame is after it, and the clock before it is the frame's less the gap.
  const late = [6, 7, 8, 9].map((t) => ({ t, sn: 2, st: 1000 + t }));
  expect(tv.momentsOf({ markers: marker, frames: late }, { leadInS: 3, tailS: 3 }).moments[0]).toMatchObject({ from: 5, sn: 2, st: 1005 });
});

test('a sidecar that was resumed has a summary for each stretch: the moments of every one are found, not those of the last', async () => {
  const file = path.join(dir, 'resumed.telemetry.jsonl');
  const frame = (i, t, st) => JSON.stringify({ frame: i, t, sn: 2, st });
  fs.writeFileSync(file, [
    JSON.stringify({ _type: 'header', track: 'Circuit Zandvoort', car: 'Porsche 911 GT3 R' }),
    ...Array.from({ length: 200 }, (_, i) => frame(i, i / 10, 1000 + i / 10)),
    JSON.stringify({ _type: 'summary', markers: [{ type: 'position_change', t: 10000, from: 6, to: 5, direction: 'gained' }] }),
    JSON.stringify({ _type: 'resumed', at: 20000 }),
    ...Array.from({ length: 200 }, (_, i) => frame(200 + i, 20 + i / 10, 1020 + i / 10)),
    JSON.stringify({ _type: 'summary', markers: [{ type: 'incident', t: 30000, from: 0, to: 2 }, { type: 'position_change', t: 10000, from: 6, to: 5, direction: 'gained' }] }),
  ].join('\n') + '\n');
  const plan = await tv.readTvPlan(file, { leadInS: 0.2, tailS: 0.2 });
  expect(plan.problem).toBeNull();
  expect(plan.moments.map((m) => m.label)).toEqual(['P6 → P5', 'Incident ×2']);   // the repeated one counted once
});

test('the replay open is of this race: the track the sim says is the recording\'s, by name, by a word of it, or not said', () => {
  const at = (display, name = '') => ({ trackDisplayName: display, trackName: name });
  expect(tv.sameTrack('Circuit Zandvoort', at('Circuit Zandvoort'))).toBe(true);
  expect(tv.sameTrack('zandvoort full', at('Circuit Zandvoort', 'zandvoort full'))).toBe(true);   // SimHub's key where the host sent no display name
  expect(tv.sameTrack('Zandvoort', at('Circuit Zandvoort'))).toBe(true);
  expect(tv.sameTrack('Road America', at('Road Atlanta'))).toBe(false);                            // "road" says nothing of which
  expect(tv.sameTrack('Circuit Zandvoort', at('Spa-Francorchamps', 'spa up'))).toBe(false);
  expect(tv.sameTrack(null, at('Spa-Francorchamps'))).toBe(true);                                   // unknown on either side is not a difference
  expect(tv.sameTrack('Circuit Zandvoort', undefined)).toBe(true);
  expect(tv.sameTrack('Circuit Zandvoort', at('', ''))).toBe(true);
});

test('he gets in the car partway through a take — the sim says he is on track, or main says he is in the car: no command is sent after that, the recording stops, the facecam and auto-record come back', async () => {
  test.setTimeout(40000);
  for (const how of ['the sim says on track', 'main says in the car']) {
    const r = rig();
    try {
      await until(() => r.client.identified());
      expect((await r.shots.start({ folder: r.race })).ok).toBe(true);
      // The first moment is playing: speed 1 has been sent, the recording is under way, the facecam is hidden.
      await until(() => r.replay.calls.some((c) => c.command === 'speed' && c.speed === 1), 10000);
      expect(r.keeper.status().recording).toBe(true);
      expect(facecamOf('Large Video').enabled).toBe(false);
      const sent = r.replay.calls.length;
      if (how === 'the sim says on track') r.replay.state.onTrack = true; else r.fake.inCar = true;
      await until(() => r.shots.status().step === 'failed', 10000);
      expect(r.shots.status().result, how).toMatchObject({ ok: false, cancelled: false, reason: tv.DROVE, moments: 0 });
      // Nothing was sent to the replay or the cameras after he was in: not the next seek, not the pause after the moment,
      // not the putting-back (the host would refuse it, and it is his replay now).
      expect(r.replay.calls.length, how).toBe(sent);
      expect(requests('StopRecord'), how).toHaveLength(1);
      expect(r.keeper.status().recording, how).toBe(false);
      expect(facecamOf('Large Video').enabled, how).toBe(true);
      expect(r.keeper.status().autoHeld, how).toBeNull();
      expect(fs.existsSync(stateFileOf()), how).toBe(false);
    } finally { r.dispose(); }
    server.requests.length = 0;
  }
});

test('he is in the car while the seek is still being waited for: the wait ends at once, nothing is recorded, nothing more is sent', async () => {
  test.setTimeout(30000);
  const r = rig({ replay: fakeReplay({ landMs: 60000 }), options: { landWaitMs: 20000 } });
  try {
    await until(() => r.client.identified());
    expect((await r.shots.start({ folder: r.race })).ok).toBe(true);
    // The seek, and the camera that follows it, have been sent: the wait for the landing is what he interrupts.
    await until(() => r.replay.calls.some((c) => c.command === 'camera'), 5000);
    const sent = r.replay.calls.length;
    r.replay.state.onTrack = true;
    await until(() => r.shots.status().step === 'failed', 5000);
    expect(r.shots.status().result).toMatchObject({ ok: false, reason: tv.DROVE, moments: 0 });
    expect(r.replay.calls.length).toBe(sent);
    expect(requests('StartRecord')).toHaveLength(0);
    expect(facecamOf('Large Video').enabled).toBe(true);
  } finally { r.dispose(); }
});

test('iRacing leaving its replay ends the take, said twice running; one look is not a verdict', async () => {
  test.setTimeout(30000);
  const r = rig();
  try {
    await until(() => r.client.identified());
    expect((await r.shots.start({ folder: r.race })).ok).toBe(true);
    await until(() => r.replay.calls.some((c) => c.command === 'speed' && c.speed === 1), 10000);
    r.replay.state.replayPlaying = false;
    await until(() => r.shots.status().step === 'failed', 5000);
    expect(r.shots.status().result).toMatchObject({ ok: false, reason: tv.LEFT_REPLAY });
    expect(facecamOf('Large Video').enabled).toBe(true);
    expect(r.keeper.status().recording).toBe(false);
  } finally { r.dispose(); }
});

test('the app quits during a take: his facecam is shown again at once — before the first seek has landed too, when nothing is recording and the keeper would have let the quit go — and the state file says what was hidden until then', async () => {
  test.setTimeout(30000);
  const r = rig({ replay: fakeReplay({ landMs: 60000 }), options: { landWaitMs: 20000 } });
  try {
    await until(() => r.client.identified());
    expect((await r.shots.start({ folder: r.race })).ok).toBe(true);
    await until(() => facecamOf('Large Video').enabled === false);
    // Written before it was hidden: scene, item and name.
    expect(hiddenIn(stateFileOf())).toEqual([{ sceneName: 'Large Video', sceneItemId: 2, sourceName: 'Video Capture Device' }]);
    // The keeper has nothing to stop, which is why the quit used to go through and leave the facecam hidden.
    expect(r.keeper.needsStopForQuit()).toBe(false);
    expect(r.shots.needsStopForQuit()).toBe(true);
    const began = Date.now();
    await r.shots.stopForQuit();
    expect(Date.now() - began).toBeLessThan(1500);
    expect(facecamOf('Large Video').enabled).toBe(true);
    expect(fs.existsSync(stateFileOf())).toBe(false);
    expect(r.shots.needsStopForQuit()).toBe(false);
    // The take ends by itself behind it, with nothing recorded.
    await until(() => r.shots.status().step === 'cancelled', 5000);
    expect(requests('StartRecord')).toHaveLength(0);
  } finally { r.dispose(); }
  // Quitting during a recorded moment: the take's recording is the keeper's to stop, and is stopped; the facecam is back.
  const r2 = rig();
  try {
    await until(() => r2.client.identified());
    expect((await r2.shots.start({ folder: r2.race })).ok).toBe(true);
    await until(() => r2.keeper.status().recording && r2.shots.status().step === 'recording', 10000);
    expect(r2.shots.needsStopForQuit()).toBe(true);
    expect(r2.keeper.needsStopForQuit()).toBe(true);
    await Promise.all([r2.shots.stopForQuit(), r2.keeper.stopOwnedForQuit()]);
    expect(facecamOf('Large Video').enabled).toBe(true);
    expect(server.state.recording).toBe(false);
  } finally { r2.dispose(); }
});

test('a facecam a take left hidden — Racing Desk crashed, or OBS went away before it could be shown — is shown again at the next start or the next time OBS answers; only the item the file names, by scene, id and name', async () => {
  test.setTimeout(30000);
  // What a crashed take left behind: the file, the facecam hidden, and a game video that he has hidden himself.
  fs.mkdirSync(path.dirname(stateFileOf()), { recursive: true });
  fs.writeFileSync(stateFileOf(), JSON.stringify({ hidden: [
    { sceneName: 'Large Video', sceneItemId: 2, sourceName: 'Video Capture Device' },
    { sceneName: 'Large Video', sceneItemId: 1, sourceName: 'an item that is not that one' },
    { sceneName: 'A scene that is gone', sceneItemId: 7, sourceName: 'Video Capture Device' },
  ], at: 1 }));
  facecamOf('Large Video').enabled = false;
  server.state.scenes[0].items[0].enabled = false;   // his game video, hidden by him
  const r = rig();
  try {
    await until(() => facecamOf('Large Video').enabled === true);
    expect(server.state.scenes[0].items[0].enabled).toBe(false);   // not touched: the name did not match
    await until(() => !fs.existsSync(stateFileOf()));
  } finally { r.dispose(); }
  server.state.scenes[0].items[0].enabled = true;

  // OBS busy when the facecam was to be shown: the file stays; the next answer of OBS puts it back.
  const r2 = rig();
  try {
    await until(() => r2.client.identified());
    expect((await r2.shots.start({ folder: r2.race })).ok).toBe(true);
    await until(() => facecamOf('Large Video').enabled === false);
    server.fail('SetSceneItemEnabled', 702, 'OBS is busy');   // the one request that shows it again
    r2.shots.cancel();
    await until(() => r2.shots.status().step === 'cancelled', 15000);
    expect(facecamOf('Large Video').enabled).toBe(false);
    expect(fs.existsSync(stateFileOf())).toBe(true);
    // OBS restarts its server (he changes its WebSocket settings): it answers again, and the facecam is back.
    server.closeAll(1001, 'the server restarted');
    await until(() => facecamOf('Large Video').enabled === true, 10000);
    await until(() => !fs.existsSync(stateFileOf()));
  } finally { r2.dispose(); }
});

test('a seek the sim does not reach is skipped and said, not recorded where the replay is: some missed, the rest are taken; none reached, nothing is recorded and no take is filed', async () => {
  test.setTimeout(40000);
  // The middle moment is from before the replay's memory: the sim never gets there.
  const r = rig({ replay: fakeReplay({ landsAt: (sn, st) => Math.abs(st - 1029.8) > 0.5 }), options: { landWaitMs: 300 } });
  try {
    await until(() => r.client.identified());
    expect((await r.shots.start({ folder: r.race })).ok).toBe(true);
    await until(() => r.shots.status().step === 'done', 30000);
    const s = r.shots.status();
    expect(s.result).toMatchObject({ ok: true, moments: 2, skipped: 1 });
    expect(r.changes.some((c) => c.step === 'skipped' && c.label === 'Incident ×2')).toBe(true);
    // Recording resumed only for the two that were there: resumed once (the third), paused for the second and the third.
    expect(requests('ResumeRecord')).toHaveLength(1);
    expect(requests('PauseRecord')).toHaveLength(2);
    expect(r.replay.calls.filter((c) => c.command === 'speed' && c.speed === 1)).toHaveLength(2);
    expect(r.lines.some((l) => /the moment is skipped/.test(l))).toBe(true);
  } finally { r.dispose(); }
  // None reached: the sim is in another session. Nothing started, nothing filed, the facecam back.
  fs.rmSync(path.join(r.race, '2026-09-29 22-13-22 tv.mp4'), { force: true });   // the first take's, in the same folder
  const r2 = rig({ replay: fakeReplay({ landsAt: () => false }), options: { landWaitMs: 200 } });
  try {
    await until(() => r2.client.identified());
    const from = server.requests.length;
    expect((await r2.shots.start({ folder: r2.race })).ok).toBe(true);
    await until(() => r2.shots.status().step === 'failed', 20000);
    expect(r2.shots.status().result).toMatchObject({ ok: false, reason: tv.NOT_LANDED, moments: 0, skipped: 3 });
    expect(server.requests.slice(from).filter((q) => q.type === 'StartRecord')).toHaveLength(0);
    expect(facecamOf('Large Video').enabled).toBe(true);
    expect(fs.existsSync(path.join(r2.race, '2026-09-29 22-13-22 tv.mp4'))).toBe(false);
  } finally { r2.dispose(); }
});

test('OBS stopping the take (his Ctrl+Space) or not taking the pause ends the take where it is: the replay is not driven through the rest, and it is not "done"', async () => {
  test.setTimeout(40000);
  const r = rig();
  try {
    await until(() => r.client.identified());
    expect((await r.shots.start({ folder: r.race })).ok).toBe(true);
    await until(() => r.keeper.status().recording && r.shots.status().step === 'recording', 10000);
    server.stopRecording();   // he pressed Ctrl+Space in OBS
    await until(() => r.shots.status().step === 'failed', 10000);
    expect(r.shots.status().result).toMatchObject({ ok: false, reason: tv.OBS_STOPPED });
    // One moment began; no seek went on to the second and third.
    expect(r.replay.calls.filter((c) => c.command === 'seek')).toHaveLength(1);
    expect(facecamOf('Large Video').enabled).toBe(true);
  } finally { r.dispose(); }
  server.requests.length = 0;
  // A pause OBS refuses: the loop would otherwise carry on driving the replay.
  const r2 = rig();
  try {
    await until(() => r2.client.identified());
    server.fail('PauseRecord', 702, 'the output could not be paused');
    expect((await r2.shots.start({ folder: r2.race })).ok).toBe(true);
    await until(() => r2.shots.status().step === 'failed', 20000);
    expect(r2.shots.status().result.reason).toMatch(/OBS did not take the pause/);
    expect(r2.replay.calls.filter((c) => c.command === 'seek')).toHaveLength(1);
    expect(r2.keeper.status().recording).toBe(false);
    expect(facecamOf('Large Video').enabled).toBe(true);
  } finally { r2.dispose(); }
});

test('Stop ends a moment that is playing at once, not when it has played out', async () => {
  test.setTimeout(40000);
  // Moments of 40 s: the old wait could not be woken.
  const r = rig({ options: { leadInS: 20, tailS: 20 } });
  try {
    await until(() => r.client.identified());
    expect((await r.shots.start({ folder: r.race })).ok).toBe(true);
    await until(() => r.shots.status().step === 'recording' && r.shots.status().index === 1, 10000);
    const began = Date.now();
    expect(r.shots.cancel()).toEqual({ ok: true });
    await until(() => r.shots.status().step === 'cancelled', 15000);
    expect(Date.now() - began).toBeLessThan(8000);
    expect(r.shots.status().result).toMatchObject({ ok: false, cancelled: true, moments: 1 });
    expect(facecamOf('Large Video').enabled).toBe(true);
    expect(r.keeper.status().recording).toBe(false);
  } finally { r.dispose(); }
});

test('a take left running by a Racing Desk that was closed in the middle of it is stopped when the next one finds it, and filed as the take it was', async () => {
  test.setTimeout(30000);
  const race = path.join(dir, '2026-09-29 22-13 Zandvoort Porsche 911 GT3 Cup (992)');
  fs.mkdirSync(race, { recursive: true });
  const mp4 = `${dir.replace(/\\/g, '/')}/take-left.mp4`;
  fs.writeFileSync(mp4, buildFinalMp4({ durationMs: 3000, withChapterTrack: false }));
  server.mode.clock = () => Date.now();
  server.startRecording(mp4);
  server.state.startedAt = Date.now() - 20_000;
  fs.mkdirSync(path.join(dir, 'state'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'state', 'recording-state.json'), JSON.stringify({ owned: mp4.replace(/\//g, '\\'), startedAt: Date.now() - 20_000, take: { folder: race, baseName: '2026-09-29 22-13-22 tv' } }));
  const r = rig();
  try {
    await until(() => !server.state.recording, 15000);
    expect(requests('StopRecord')).toHaveLength(1);
    expect(r.lines.some((l) => /a TV take/.test(l))).toBe(true);
    await until(() => fs.existsSync(path.join(race, '2026-09-29 22-13-22 tv.mp4')), 15000);
    expect(r.keeper.status().lastFiled).toMatchObject({ kind: 'tv', folder: race });
  } finally { r.dispose(); }
  // His own recording, with no take in the state file, is left running.
  const mp4b = `${dir.replace(/\\/g, '/')}/his-own.mp4`;
  server.startRecording(mp4b);
  fs.writeFileSync(path.join(dir, 'state', 'recording-state.json'), JSON.stringify({ owned: mp4b.replace(/\//g, '\\'), startedAt: Date.now() - 5_000 }));
  const before = requests('StopRecord').length;
  const r2 = rig();
  try {
    await until(() => r2.keeper.status().recording);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(server.state.recording).toBe(true);
    expect(requests('StopRecord')).toHaveLength(before);
  } finally { r2.dispose(); }
});
