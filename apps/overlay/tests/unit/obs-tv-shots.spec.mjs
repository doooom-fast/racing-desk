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
function writeRaceSidecar(file, { seconds = 60, clock = true } = {}) {
  const writer = createSidecar({ write: (f, text) => fs.appendFileSync(f, text) });
  const t0 = Date.parse('2026-09-29T20:13:22Z');
  writer.start({ path: file, startedAt: t0, producer: 'obs', obsOutputPath: 'x', kind: 'recording' });
  for (let i = 0; i <= seconds * 10; i++) {
    const t = i / 10;
    const p = {
      ...MOCK_TELEMETRY,
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

// The host's replay route, faked: it writes down the commands and lands every seek at once.
function fakeReplay({ available = true, connected = true, replayPlaying = true, onTrack = false, groups = [{ num: 1, name: 'Cockpit' }, { num: 5, name: 'TV1' }, { num: 6, name: 'TV2' }, { num: 9, name: 'Chase' }], landMs = 0 } = {}) {
  const state = { sessionNum: 2, sessionTime: 0, speed: 1, group: 1, pending: null };
  const calls = [];
  return {
    calls, state,
    status: async () => {
      if (state.pending && Date.now() >= state.pending.at) { state.sessionNum = state.pending.sn; state.sessionTime = state.pending.st; state.pending = null; }
      return { available, connected, replayPlaying, onTrack, sessionNum: 2, sessionTime: 3000, replay: { sessionNum: state.sessionNum, sessionTime: state.sessionTime, speed: state.speed }, camera: { group: state.group }, player: { carNumber: '42' }, groups, reason: available ? undefined : 'iRacing is not running, so its replay cannot be driven.' };
    },
    command: async (body) => {
      calls.push(body);
      if (body.command === 'seek') state.pending = { sn: body.sessionNum, st: body.sessionTime, at: Date.now() + landMs };
      if (body.command === 'speed') state.speed = body.speed;
      if (body.command === 'camera') state.group = body.group;
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
    client, recording: keeper, replay, settings: () => fake.settings, inCar: () => fake.inCar, log: (l) => lines.push(l), onChange: (s) => changes.push(s),
    leadInS: 0.2, tailS: 0.2, settleMs: 30, landPollMs: 20, landWaitMs: 1500, filingWaitMs: 6000, ...options,
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

    // What was asked of the replay, in order: paused, sought to the first moment's clock, the TV camera on his car;
    // played and paused for the moment; then the next, on the next TV group.
    const calls = r.replay.calls;
    expect(calls.slice(0, 3)).toEqual([
      { command: 'speed', speed: 0 },
      { command: 'seek', sessionNum: 2, sessionTime: plan.moments[0].st },
      { command: 'camera', focus: 'driver', group: 5, camera: 0 },
    ]);
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
