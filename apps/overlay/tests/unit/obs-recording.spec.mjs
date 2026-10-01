/**
 * The recording keeper (modules/js/obs/recording.js) over the real OBS client and the fake obs-websocket server on
 * 127.0.0.1: the mirror follows OBS whoever pressed; Record and Stop from the desk, the tray, the Stream Deck and
 * the in-car key; OBS started on a press and never from the car; the ten seconds without STARTED; what is ours and
 * what is OBS's own, kept in the state file and taken over on connect; the floor under the disk; the sidecar beside
 * the file at 30 Hz with the sim's clock in it; and quitting, which stops what we started and nothing else.
 * Every path is in a temp folder; the clock and the disk are fakes.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFakeObs } from './fake-obs.mjs';
import { MOCK_TELEMETRY } from '../helpers.mjs';

const require = createRequire(import.meta.url);
const { createObsClient } = require('../../modules/js/obs/client.js');
const keeperModule = require('../../modules/js/obs/recording.js');
const { createRecordingKeeper, isSimLive } = keeperModule;

const PASSWORD = 'horse-battery';
const LIVE = { ...MOCK_TELEMETRY, 'DataCorePlugin.GameRawData.Telemetry.SessionNum': 2, 'DataCorePlugin.GameRawData.Telemetry.SessionTime': 500.25, currentFlagState: 'green' };
const until = async (what, timeoutMs = 4000) => {
  const start = Date.now();
  while (!what()) {
    if (Date.now() - start > timeoutMs) throw new Error('waited too long');
    await new Promise((r) => setTimeout(r, 15));
  }
};
const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms));

let dir;
let server;
test.beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-obs-recording-'));
  server = await startFakeObs({ password: PASSWORD, recordDirectory: dir.replace(/\\/g, '/') });
});
test.afterEach(async () => {
  await server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// A keeper over a real client against the fake, with the disk, the clock, the sim and OBS's start as fakes.
function rig({ connect = true, freeBytes = 400e9, payload = LIVE, inCar = false, settings = {}, startObs, port } = {}) {
  const lines = [];
  const notices = [];
  const changes = [];
  const fake = {
    free: freeBytes, payload, inCar, settings: { obsStartOnRecord: true, ...settings },
    startObsCalls: 0,
  };
  const client = createObsClient({ port: port || server.port, password: () => PASSWORD, retryMs: 40, authRetryMs: 100, connectTimeoutMs: 500, log: (l) => lines.push(l) });
  const keeper = createRecordingKeeper({
    client,
    settings: () => fake.settings,
    recordFolder: () => dir,
    stateFile: path.join(dir, 'state', 'recording-state.json'),
    freeSpace: async () => fake.free,
    fetchPayload: async () => fake.payload,
    inCar: () => fake.inCar,
    startObs: startObs || (async () => { fake.startObsCalls++; return { ok: true }; }),
    notice: (t) => notices.push(t),
    log: (l) => lines.push(l),
    onChange: (s) => changes.push(s),
    waitStartedMs: 400, waitStoppedMs: 400, waitObsMs: 600, quitWaitMs: 300, statusEveryMs: 60, idleFreeEveryMs: 100000, sidecarHz: 100,
  });
  keeper.start();
  if (connect) client.start();
  return { client, keeper, lines, notices, changes, fake, dispose: () => { keeper.dispose(); client.stop(); } };
}

const sidecarOf = (mp4) => fs.readFileSync(mp4.replace(/\.mp4$/, '.telemetry.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('a sim session is live when the game runs and it is not the demo', () => {
  expect(isSimLive(LIVE)).toBe(true);
  expect(isSimLive({ ...LIVE, 'RacingDesk.Plugin.DemoMode': 1 })).toBe(false);
  expect(isSimLive({ ...LIVE, 'DataCorePlugin.GameRunning': 0 })).toBe(false);
  expect(isSimLive(null)).toBe(false);
});

test('the mirror: a recording OBS started (his Ctrl+Space) is seen, gets a sidecar beside it, and is not ours', async () => {
  const r = rig();
  try {
    await until(() => r.keeper.status().obs === 'open');
    expect(r.keeper.status()).toMatchObject({ recording: false, owned: false, outputPath: null });
    server.startRecording(`${dir.replace(/\\/g, '/')}/his.mp4`);
    await until(() => r.keeper.status().recording);
    const s = r.keeper.status();
    expect(s.owned).toBe(false);
    expect(s.outputPath).toBe(`${dir.replace(/\\/g, '/')}/his.mp4`);
    await until(() => r.keeper.status().sidecar && r.keeper.status().sidecar.frames >= 3);
    server.stopRecording();
    await until(() => !r.keeper.status().recording);
    const lines = sidecarOf(path.join(dir, 'his.mp4'));
    expect(lines[0]).toMatchObject({ _type: 'header', producer: 'obs', obsOutputPath: `${dir.replace(/\\/g, '/')}/his.mp4`, car: 'Porsche 911 GT3 R' });
    expect(lines[1]).toMatchObject({ frame: 0, sn: 2, st: 500.25, flag: 'green' });
    expect(lines.at(-1)).toMatchObject({ _type: 'summary', reason: 'stopped' });
    expect(fs.existsSync(path.join(dir, 'state', 'recording-state.json'))).toBe(false);
    expect(r.keeper.status().sidecar).toBeNull();
    // Nothing of it was said to the HUD.
    expect(r.notices).toEqual([]);
  } finally { r.dispose(); }
});

test('Record from the desk: StartRecord, then STARTED makes it ours and writes the state file; Stop clears it', async () => {
  const r = rig();
  try {
    await until(() => r.keeper.status().obs === 'open');
    const started = await r.keeper.record({ source: 'desk' });
    expect(started.ok).toBe(true);
    expect(started.path).toMatch(/\.mp4$/);
    expect(server.requests.map((q) => q.type)).toContain('StartRecord');
    const s = r.keeper.status();
    expect(s).toMatchObject({ recording: true, owned: true, outputPath: started.path, busy: null });
    expect(s.last).toMatchObject({ ok: true, text: 'Recording' });
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'state', 'recording-state.json'), 'utf8')).owned).toBe(started.path);
    // Pressed again: already recording, and no second StartRecord.
    expect(await r.keeper.record({ source: 'tray' })).toMatchObject({ ok: false, reason: 'Already recording' });
    expect(server.requests.filter((q) => q.type === 'StartRecord')).toHaveLength(1);
    await until(() => r.keeper.status().sidecar && r.keeper.status().sidecar.frames >= 2);
    const stopped = await r.keeper.stop();
    expect(stopped).toMatchObject({ ok: true, path: started.path });
    expect(r.keeper.status()).toMatchObject({ recording: false, owned: false });
    expect(fs.existsSync(path.join(dir, 'state', 'recording-state.json'))).toBe(false);
    expect(sidecarOf(started.path.replace(/\//g, path.sep)).at(-1)._type).toBe('summary');
    expect(await r.keeper.stop()).toMatchObject({ ok: false, reason: 'Not recording' });
    // toggle goes the right way.
    expect((await r.keeper.toggle({ source: 'streamdeck' })).ok).toBe(true);
    expect(r.keeper.status().recording).toBe(true);
    expect((await r.keeper.toggle()).ok).toBe(true);
    expect(r.keeper.status().recording).toBe(false);
  } finally { r.dispose(); }
});

test('Stop from a press stops a recording OBS started too; his Ctrl+Space recording is not ours to stop at quit', async () => {
  const r = rig();
  try {
    await until(() => r.keeper.status().obs === 'open');
    server.startRecording();
    await until(() => r.keeper.status().recording);
    expect(r.keeper.needsStopForQuit()).toBe(true);   // the sidecar is ours to finish, the recording is not ours to stop
    const beforeQuit = server.requests.filter((q) => q.type === 'StopRecord').length;
    await r.keeper.stopOwnedForQuit();
    expect(server.requests.filter((q) => q.type === 'StopRecord')).toHaveLength(beforeQuit);
    expect(server.state.recording).toBe(true);
    expect(r.keeper.status().sidecar).toBeNull();
    const stopped = await r.keeper.stop();
    expect(stopped.ok).toBe(true);
    expect(server.state.recording).toBe(false);
  } finally { r.dispose(); }
});

test('with OBS closed: a key in the car starts nothing and the HUD is told once; the desk starts OBS and waits for it; the switch off says so', async () => {
  const closed = await startFakeObs({ password: PASSWORD });
  const freePort = closed.port;
  await closed.close();
  // A client aimed at a port where nothing listens, and a startObs that answers but brings nothing up: the wait runs
  // out with the sentence about the crash dialog.
  const r2 = rig({ port: freePort, startObs: async () => { r2.fake.startObsCalls++; return { ok: true }; } });
  try {
    await until(() => r2.keeper.status().obs === 'closed');
    // The key, in the car: nothing started, the HUD told.
    expect(await r2.keeper.record({ source: 'key' })).toMatchObject({ ok: false, reason: "OBS isn't open" });
    expect(r2.notices).toEqual(['OBS is not open']);
    // The desk, in the car: the same (a launch would land over the sim), and the HUD, which is on screen, is told.
    r2.fake.inCar = true;
    expect(await r2.keeper.record({ source: 'desk' })).toMatchObject({ ok: false, reason: "OBS isn't open" });
    expect(r2.notices).toEqual(['OBS is not open', 'OBS is not open']);
    r2.fake.inCar = false;
    // The desk, with the switch off: said, not started.
    r2.fake.settings.obsStartOnRecord = false;
    expect(await r2.keeper.record({ source: 'desk' })).toMatchObject({ ok: false, reason: "OBS isn't open" });
    expect(r2.fake.startObsCalls).toBe(0);
    // The desk, switch on: OBS is "started" and waited for; nothing answers, so the sentence about the crash dialog.
    r2.fake.settings.obsStartOnRecord = true;
    const answer = await r2.keeper.record({ source: 'desk' });
    expect(answer).toMatchObject({ ok: false, reason: 'OBS is open but not answering. If it is asking about its last crash, choose Launch Normally.' });
    expect(r2.fake.startObsCalls).toBe(1);
    expect(r2.notices).toEqual(['OBS is not open', 'OBS is not open']);   // nothing more was said to the HUD out of the car
  } finally { r2.dispose(); }
});

test('Record from the desk with OBS closed starts it, waits for the WebSocket, then records', async () => {
  // The client is aimed at the live fake, which stands for an OBS that is "started" by the press: before the press
  // the keeper is kept from it by not connecting the client until startObs is called.
  const r = rig({ connect: false, startObs: async () => { r.fake.startObsCalls++; r.client.start(); return { ok: true, started: true }; } });
  try {
    expect(r.keeper.status().obs).toBe('closed');
    const answer = await r.keeper.record({ source: 'desk' });
    expect(answer.ok).toBe(true);
    expect(r.fake.startObsCalls).toBe(1);
    expect(r.keeper.status()).toMatchObject({ recording: true, owned: true, obs: 'open' });
    expect(r.notices).toEqual([]);
  } finally { r.dispose(); }
});

test('OBS that never sends STARTED: the sentence about the message, and the HUD told', async () => {
  const r = rig();
  try {
    await until(() => r.keeper.status().obs === 'open');
    server.mode.neverStarts = true;
    const answer = await r.keeper.record({ source: 'desk' });
    expect(answer).toMatchObject({ ok: false, reason: "OBS didn't start recording. It may be showing a message." });
    expect(r.notices).toEqual(["OBS didn't start recording"]);
    expect(r.keeper.status()).toMatchObject({ recording: false, owned: false, busy: null });
    expect(fs.existsSync(path.join(dir, 'state', 'recording-state.json'))).toBe(false);
  } finally { r.dispose(); }
});

test('the floor: no start below 20 GB; one of ours stops at 5 GB and says so; OBS\'s own is left', async () => {
  const r = rig({ freeBytes: 12e9 });
  try {
    await until(() => r.keeper.status().obs === 'open');
    const refused = await r.keeper.record({ source: 'desk' });
    expect(refused.ok).toBe(false);
    expect(refused.reason).toMatch(/^Only 12 GB free on .*\. Recording needs about 20 GB\.$/);
    expect(server.requests.filter((q) => q.type === 'StartRecord')).toHaveLength(0);
    expect(r.keeper.status().free.bytes).toBe(12e9);
    expect(r.keeper.status().free.hoursLeft).toBeCloseTo(12e9 / 12.5e6 / 3600, 3);

    r.fake.free = 400e9;
    expect((await r.keeper.record({ source: 'desk' })).ok).toBe(true);
    r.fake.free = 4e9;
    await until(() => !r.keeper.status().recording, 3000);
    expect(r.keeper.status().lowDisk).toMatch(/^Recording stopped: only 4\.0 GB left on .*\.$/);
    expect(server.state.recording).toBe(false);

    // His own recording is not stopped by the floor.
    r.fake.free = 4e9;
    server.startRecording();
    await until(() => r.keeper.status().recording);
    await settle(250);
    expect(r.keeper.status().recording).toBe(true);
    expect(server.state.recording).toBe(true);
  } finally { r.dispose(); }
});

test('a recording already running when OBS answers is taken over: its path, its start, and ours if the state file says so', async () => {
  const mp4 = `${dir.replace(/\\/g, '/')}/earlier.mp4`;
  server.mode.clock = () => Date.now();
  server.startRecording(mp4);
  server.state.startedAt = Date.now() - 90_000;
  server.state.bytes = 1_000_000_000;
  fs.mkdirSync(path.join(dir, 'state'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'state', 'recording-state.json'), JSON.stringify({ owned: mp4.replace(/\//g, '\\'), startedAt: Date.now() - 90_000 }));
  const r = rig();
  try {
    await until(() => r.keeper.status().recording);
    const s = r.keeper.status();
    expect(s.owned).toBe(true);
    expect(s.outputPath).toBe(mp4);
    expect(s.elapsedMs).toBeGreaterThan(85_000);
    expect(s.elapsedMs).toBeLessThan(100_000);
    expect(s.bytes).toBe(1_000_000_000);
    expect(server.requests.map((q) => q.type).slice(0, 2)).toEqual(['GetRecordStatus', 'GetOutputSettings']);
    expect(server.requests[1].data).toEqual({ outputName: 'adv_file_output' });
    expect(r.keeper.needsStopForQuit()).toBe(true);
    // Quitting stops it, waits for STOPPED, and the state file goes.
    await r.keeper.stopOwnedForQuit();
    expect(server.state.recording).toBe(false);
    expect(fs.existsSync(path.join(dir, 'state', 'recording-state.json'))).toBe(false);
    expect(r.keeper.status().recording).toBe(false);
  } finally { r.dispose(); }
});

test('a recording running at connect that is not in the state file is OBS\'s own', async () => {
  server.startRecording();
  const r = rig();
  try {
    await until(() => r.keeper.status().recording);
    expect(r.keeper.status().owned).toBe(false);
    expect(r.lines.some((l) => /already running \(OBS's\)/.test(l))).toBe(true);
  } finally { r.dispose(); }
});

test('OBS beginning a new file (a split) is followed; OBS going away mid-recording ends the sidecar with the reason', async () => {
  const r = rig();
  try {
    await until(() => r.keeper.status().obs === 'open');
    const started = await r.keeper.record({ source: 'desk' });
    const next = `${dir.replace(/\\/g, '/')}/split-2.mp4`;
    server.emit('RecordFileChanged', { newOutputPath: next });
    await until(() => r.keeper.status().outputPath === next);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'state', 'recording-state.json'), 'utf8')).owned).toBe(next);
    await server.exitStarted();
    await until(() => !r.keeper.status().recording);
    const lines = sidecarOf(started.path.replace(/\//g, path.sep));
    const summary = lines.at(-1);
    expect(summary).toMatchObject({ _type: 'summary', reason: 'OBS went away', obsOutputPath: next });
    expect(summary.markers.some((m) => m.type === 'file_changed' && m.path === next)).toBe(true);
    expect(fs.existsSync(path.join(dir, 'state', 'recording-state.json'))).toBe(false);
    expect(r.keeper.status()).toMatchObject({ recording: false, owned: false, obs: 'closed' });
  } finally { r.dispose(); }
});

test('no sidecar for a recording made while no sim session is live', async () => {
  const r = rig({ payload: { 'DataCorePlugin.GameRunning': 0 } });
  try {
    await until(() => r.keeper.status().obs === 'open');
    const started = await r.keeper.record({ source: 'desk' });
    await settle(120);
    expect(r.keeper.status().sidecar).toBeNull();
    expect(fs.existsSync(started.path.replace(/\.mp4$/, '.telemetry.jsonl').replace(/\//g, path.sep))).toBe(false);
    expect(r.lines.some((l) => /no sim session is live/.test(l))).toBe(true);
    await r.keeper.stop();
  } finally { r.dispose(); }
});

test('the status says what the card needs, and every change is announced', async () => {
  const r = rig();
  try {
    await until(() => r.keeper.status().obs === 'open');
    const s = r.keeper.status();
    expect(Object.keys(s).sort()).toEqual(['busy', 'bytes', 'bytesPerSecond', 'elapsedMs', 'free', 'last', 'lowDisk', 'obs', 'obsVersion', 'outputPath', 'owned', 'paused', 'recording', 'sidecar', 'startedAt', 'starting', 'stopping']);
    expect(s.obsVersion).toBe('32.1.2');
    expect(s.free).toMatchObject({ bytes: 400e9 });
    expect(r.changes.length).toBeGreaterThan(0);
    const before = r.changes.length;
    await r.keeper.record({ source: 'desk' });
    expect(r.changes.length).toBeGreaterThan(before);
    expect(r.changes.at(-1).recording).toBe(true);
    await r.keeper.stop();
  } finally { r.dispose(); }
});
