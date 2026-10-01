/**
 * The recording keeper (modules/js/obs/recording.js) over the real OBS client and the fake obs-websocket server on
 * 127.0.0.1: the mirror follows OBS whoever pressed; Record and Stop from the desk, the tray, the Stream Deck and
 * the in-car key; OBS started on a press and never from the car; the ten seconds without STARTED; what is ours and
 * what is OBS's own, kept in the state file and taken over on connect; the floor under the disk; the sidecar beside
 * the file at 30 Hz with the sim's clock in it; a dropped connection, which is not OBS going away; and quitting, which
 * stops what we started and nothing else. Every path is in a temp folder; the clock and the disk are fakes.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFakeObs } from './fake-obs.mjs';
import { buildFinalMp4, buildFragmentedMp4 } from './mp4-fixture.mjs';
import { MOCK_TELEMETRY } from '../helpers.mjs';

const require = createRequire(import.meta.url);
const { createObsClient } = require('../../modules/js/obs/client.js');
const keeperModule = require('../../modules/js/obs/recording.js');
const { createRecordingKeeper, isSimLive } = keeperModule;
const { createAutoRecord } = require('../../modules/js/obs/auto-record.js');
const { createInCarSignal } = require('../../modules/js/in-car.js');

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
function rig({ connect = true, freeBytes = 400e9, payload = LIVE, inCar = false, settings = {}, startObs, port, obsRunning = false, lostAfterMs, stateFile, keeper: keeperOptions = {}, fsModule } = {}) {
  const lines = [];
  const notices = [];
  const changes = [];
  const fake = {
    free: freeBytes, payload, inCar, settings: { obsStartOnRecord: true, ...settings },
    startObsCalls: 0, obsRunning, obsRunningCalls: 0, settingsReads: 0, fetchCalls: 0, freeAsked: [], freeFor: null, profileFolder: null,
  };
  const client = createObsClient({ port: port || server.port, password: () => PASSWORD, retryMs: 40, authRetryMs: 100, connectTimeoutMs: 500, log: (l) => lines.push(l) });
  const keeper = createRecordingKeeper({
    client,
    settings: () => { fake.settingsReads++; return fake.settings; },
    recordFolder: () => dir,
    obsFolder: () => fake.profileFolder,
    stateFile: stateFile || path.join(dir, 'state', 'recording-state.json'),
    freeSpace: async (folder) => { fake.freeAsked.push(folder); return fake.freeFor ? fake.freeFor(folder) : fake.free; },
    fetchPayload: async () => { fake.fetchCalls++; if (fake.onFetch) fake.onFetch(); return fake.payload; },
    inCar: () => fake.inCar,
    obsRunning: async () => { fake.obsRunningCalls++; return fake.obsRunning; },
    startObs: startObs || (async () => { fake.startObsCalls++; return { ok: true }; }),
    notice: (t) => notices.push(t),
    log: (l) => lines.push(l),
    onChange: (s) => changes.push(s),
    waitStartedMs: 400, waitStoppedMs: 400, waitObsMs: 600, waitSavedMs: 600, quitWaitMs: 300, statusEveryMs: 60, idleFreeEveryMs: 100000, sidecarHz: 100,
    stableMs: 40, stableTimeoutMs: 2000, moveRetryMs: 20, autoRetryMs: 300, replayRetryMs: 300,
    ...(lostAfterMs ? { lostAfterMs } : {}),
    ...(fsModule ? { fs: fsModule } : {}),
    ...keeperOptions,
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
    // The recording is known by the file STARTED named; the state file also says which file is being written.
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'state', 'recording-state.json'), 'utf8'))).toMatchObject({ owned: started.path, current: next });
    await server.exitStarted();
    await until(() => !r.keeper.status().recording);
    const lines = sidecarOf(started.path.replace(/\//g, path.sep));
    const summary = lines.at(-1);
    expect(summary).toMatchObject({ _type: 'summary', reason: 'OBS went away', obsOutputPath: next });
    expect(summary.markers.some((m) => m.type === 'file_changed' && m.path === next)).toBe(true);
    expect(fs.existsSync(path.join(dir, 'state', 'recording-state.json'))).toBe(false);
    expect(r.keeper.status()).toMatchObject({ recording: false, owned: false });
    await until(() => r.client.state().lastClose && r.client.state().lastClose.code === 1001);   // and then the socket closed, as OBS's does on exit
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
    expect(Object.keys(s).sort()).toEqual(['auto', 'autoHeld', 'autoRecord', 'busy', 'bytes', 'bytesPerSecond', 'chapters', 'elapsedMs', 'filed', 'free', 'kind', 'last', 'lastFiled', 'lowDisk', 'obs', 'obsVersion', 'outputPath', 'owned', 'paused', 'recording', 'replay', 'sidecar', 'startedAt', 'starting', 'stopping']);
    expect(s.replay).toEqual({ on: false, running: false, unavailable: 'OBS has no replay buffer. Press Set up OBS, then open OBS again.', lastSaved: null });
    expect(s.autoRecord).toBe(true);
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

// ── What the review of stage 1 found ─────────────────────────────────────────────────────────────────────────────

const stateFileOf = () => path.join(dir, 'state', 'recording-state.json');
const asSlashes = (p) => p.replace(/\\/g, '/');

test('a dropped connection is not OBS going away: the recording stays ours, in the state file, with its sidecar going, and quitting stops it', async () => {
  const r = rig();
  try {
    await until(() => r.keeper.status().obs === 'open');
    const started = await r.keeper.record({ source: 'desk' });
    expect(started.ok).toBe(true);
    await until(() => r.keeper.status().sidecar && r.keeper.status().sidecar.frames >= 3);
    const before = r.keeper.status().sidecar.frames;
    // Any of: he saves OBS's WebSocket settings (it restarts its server, closing every session with 1001), a session is
    // kicked, a socket is cut. OBS goes on recording.
    for (const s of server.clients()) s.conn.destroy();
    await until(() => r.client.state().lastClose);
    expect(r.keeper.status()).toMatchObject({ recording: true, owned: true });
    expect(fs.existsSync(stateFileOf())).toBe(true);
    expect(r.lines.some((l) => /went away/.test(l))).toBe(false);
    // Back: still ours, and not taken over as "OBS's".
    await until(() => r.keeper.status().obs === 'open');
    await settle(150);
    expect(r.keeper.status()).toMatchObject({ recording: true, owned: true, outputPath: started.path });
    expect(r.lines.some((l) => /already running \(OBS's\)/.test(l))).toBe(false);
    expect(JSON.parse(fs.readFileSync(stateFileOf(), 'utf8')).owned).toBe(started.path);
    // The sidecar went on through the gap, in the one file: one header, frames, and no summary yet.
    await until(() => r.keeper.status().sidecar.frames > before);
    // Quitting stops it — which it would not, had the drop disowned it.
    expect(r.keeper.needsStopForQuit()).toBe(true);
    const stops = server.requests.filter((q) => q.type === 'StopRecord').length;
    await r.keeper.stopOwnedForQuit();
    expect(server.requests.filter((q) => q.type === 'StopRecord')).toHaveLength(stops + 1);
    expect(server.state.recording).toBe(false);
    expect(fs.existsSync(stateFileOf())).toBe(false);
    const lines = sidecarOf(started.path.replace(/\//g, path.sep));
    expect(lines.filter((l) => l._type === 'header')).toHaveLength(1);
    expect(lines.filter((l) => l._type === 'summary')).toHaveLength(1);
    expect(lines.at(-1)).toMatchObject({ _type: 'summary', reason: 'stopped' });
  } finally { r.dispose(); }
});

test('the floor stops a recording of ours that came back after a drop, as it would have before it', async () => {
  const r = rig();
  try {
    await until(() => r.keeper.status().obs === 'open');
    await r.keeper.record({ source: 'desk' });
    for (const s of server.clients()) s.conn.destroy();
    await until(() => r.client.state().lastClose);
    await until(() => r.keeper.status().obs === 'open' && server.identified() === 1);
    r.fake.free = 4e9;
    await until(() => !r.keeper.status().recording, 3000);
    expect(r.keeper.status().lowDisk).toMatch(/^Recording stopped: only 4\.0 GB left/);
    expect(server.state.recording).toBe(false);
  } finally { r.dispose(); }
});

test('OBS out of reach for good: after a while the card stops saying it records, the state file is kept, and the next connection takes the recording over as Racing Desk\'s, its sidecar gone on in, not given a second header', async () => {
  let aim = server.port;
  const lines = [];
  const client = createObsClient({ port: () => aim, password: () => PASSWORD, retryMs: 40, authRetryMs: 100, connectTimeoutMs: 300, log: (l) => lines.push(l) });
  const keeper = createRecordingKeeper({
    client, settings: () => ({ obsStartOnRecord: true }), recordFolder: () => dir, stateFile: stateFileOf(),
    freeSpace: async () => 400e9, fetchPayload: async () => LIVE, log: (l) => lines.push(l),
    waitStartedMs: 400, waitStoppedMs: 400, quitWaitMs: 300, statusEveryMs: 60, idleFreeEveryMs: 100000, sidecarHz: 100, lostAfterMs: 200,
  });
  keeper.start();
  client.start();
  try {
    await until(() => keeper.status().obs === 'open');
    const started = await keeper.record({ source: 'desk' });
    await until(() => keeper.status().sidecar && keeper.status().sidecar.frames >= 2);
    const probe = await startFakeObs({ password: PASSWORD });
    aim = probe.port;
    const deadPort = probe.port;
    await probe.close();                              // nothing listens there
    for (const s of server.clients()) s.conn.destroy();
    await until(() => !keeper.status().recording, 3000);
    expect(keeper.status()).toMatchObject({ recording: false, owned: false, sidecar: null });
    expect(fs.existsSync(stateFileOf())).toBe(true);   // kept: OBS may well be recording still
    expect(sidecarOf(started.path.replace(/\//g, path.sep)).at(-1)).toMatchObject({ _type: 'summary', reason: 'OBS went away' });
    expect(aim).toBe(deadPort);
    // OBS answers again, still recording that file.
    aim = server.port;
    await until(() => keeper.status().recording, 3000);
    expect(keeper.status()).toMatchObject({ recording: true, owned: true, outputPath: started.path });
    await until(() => keeper.status().sidecar && keeper.status().sidecar.frames >= 2);
    await keeper.stopOwnedForQuit();
    const lines2 = sidecarOf(started.path.replace(/\//g, path.sep));
    expect(lines2.filter((l) => l._type === 'header')).toHaveLength(1);
    expect(lines2.filter((l) => l._type === 'resumed')).toHaveLength(1);
    expect(lines2.filter((l) => l._type === 'summary')).toHaveLength(2);
    expect(lines2.at(-1)).toMatchObject({ _type: 'summary', resumed: true });
    expect(fs.existsSync(stateFileOf())).toBe(false);
  } finally { keeper.dispose(); client.stop(); }
});

test('quitting with OBS out of reach keeps the state file: the next start finds the recording and takes it over as Racing Desk\'s', async () => {
  const r = rig();
  let second = null;
  try {
    await until(() => r.keeper.status().obs === 'open');
    const started = await r.keeper.record({ source: 'desk' });
    r.client.stop();                                   // the quit finds OBS out of reach
    await until(() => !r.client.identified());
    const asked = server.requests.length;
    await r.keeper.stopOwnedForQuit();
    expect(server.requests.length).toBe(asked);        // nothing could be asked of OBS
    expect(server.state.recording).toBe(true);
    expect(fs.existsSync(stateFileOf())).toBe(true);
    r.dispose();
    // Racing Desk starts again, and OBS answers.
    second = rig();
    await until(() => second.keeper.status().recording);
    expect(second.keeper.status()).toMatchObject({ owned: true, outputPath: started.path });
    expect(second.lines.some((l) => /already running, ours/.test(l))).toBe(true);
  } finally { r.dispose(); if (second) second.dispose(); }
});

test('a state file from a recording that is not running any more is cleared when OBS answers', async () => {
  fs.mkdirSync(path.join(dir, 'state'), { recursive: true });
  fs.writeFileSync(stateFileOf(), JSON.stringify({ owned: `${asSlashes(dir)}/gone.mp4`, startedAt: 1 }));
  const r = rig();
  try {
    await until(() => r.keeper.status().obs === 'open');
    await until(() => !fs.existsSync(stateFileOf()));
    expect(r.keeper.status().recording).toBe(false);
  } finally { r.dispose(); }
});

test('StartRecord sent: a STARTED that comes late is still ours, and a quit before it waits for it and stops what it started', async () => {
  const r = rig();
  try {
    await until(() => r.keeper.status().obs === 'open');
    // Late: OBS is slower than the keeper's wait.
    server.mode.delayMs = 700;
    const late = await r.keeper.record({ source: 'desk' });
    expect(late).toMatchObject({ ok: false, reason: "OBS didn't start recording. It may be showing a message." });
    await until(() => r.keeper.status().recording, 3000);
    expect(r.keeper.status().owned).toBe(true);
    expect(JSON.parse(fs.readFileSync(stateFileOf(), 'utf8')).owned).toBe(r.keeper.status().outputPath);
    server.mode.delayMs = 0;
    await r.keeper.stop();
    expect(r.keeper.status().recording).toBe(false);

    // Quit between StartRecord and STARTED.
    server.mode.delayMs = 120;
    const pressed = r.keeper.record({ source: 'desk' });
    await until(() => server.requests.some((q) => q.type === 'StartRecord') && r.keeper.status().busy === 'starting');
    expect(r.keeper.status().recording).toBe(false);
    expect(r.keeper.needsStopForQuit()).toBe(true);
    await r.keeper.stopOwnedForQuit();
    expect(server.state.recording).toBe(false);        // STARTED was waited for, and what it started was stopped
    expect(server.requests.filter((q) => q.type === 'StopRecord').length).toBeGreaterThanOrEqual(2);
    await pressed;
  } finally { r.dispose(); }
});

test('a connection cut between StartRecord and STARTED is not "OBS didn\'t start recording": no wait for STARTED, nothing on the HUD, and the recording that follows is ours', async () => {
  const r = rig();
  try {
    await until(() => r.keeper.status().obs === 'open');
    server.mode.delayMs = 300;
    const began = Date.now();
    const pressed = r.keeper.record({ source: 'desk' });
    await until(() => server.requests.some((q) => q.type === 'StartRecord'));
    for (const s of server.clients()) s.conn.destroy();
    const answered = await pressed;
    expect(answered).toMatchObject({ ok: false, reason: 'OBS stopped answering before it said the recording had started.' });
    expect(Date.now() - began).toBeLessThan(380);       // not the whole wait for STARTED (400 ms here)
    expect(r.notices).toEqual([]);
    expect(r.keeper.status()).toMatchObject({ starting: false, busy: null });
    // OBS does start it, and the client is back by then: it is ours.
    await until(() => r.keeper.status().recording, 3000);
    expect(r.keeper.status().owned).toBe(true);
  } finally { r.dispose(); }
});

test('the claim a StartRecord makes on the STARTED that follows lasts a minute, not for ever: a STARTED long after is OBS\'s own', async () => {
  expect(keeperModule.CLAIM_MS).toBe(60000);
  let clock = 1_000_000;
  const client = createObsClient({ port: server.port, password: () => PASSWORD, retryMs: 40, connectTimeoutMs: 500 });
  const keeper = createRecordingKeeper({
    client, recordFolder: () => dir, stateFile: stateFileOf(), freeSpace: async () => 400e9, fetchPayload: async () => ({ 'DataCorePlugin.GameRunning': 0 }),
    now: () => clock, waitStartedMs: 150, idleFreeEveryMs: 100000, statusEveryMs: 100000,
  });
  keeper.start();
  client.start();
  try {
    await until(() => keeper.status().obs === 'open');
    server.mode.neverStarts = true;
    await keeper.record({ source: 'desk' });
    clock += 61_000;
    server.startRecording();
    await until(() => keeper.status().recording);
    expect(keeper.status().owned).toBe(false);
  } finally { keeper.dispose(); client.stop(); }
});

test('a take-over that a STOPPED overtakes does not bring the recording back, and starts no sidecar', async () => {
  const mp4 = `${asSlashes(dir)}/racing.mp4`;
  server.startRecording(mp4);
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const original = server.handlers.GetOutputSettings;
  server.handlers.GetOutputSettings = async (d) => { await held; return original(d); };
  const r = rig();
  try {
    await until(() => server.requests.some((q) => q.type === 'GetOutputSettings'));
    server.stopRecording();                            // STOPPED arrives while the take-over waits for the path
    release();
    await settle(250);
    expect(r.keeper.status()).toMatchObject({ recording: false, sidecar: null });
    expect(r.lines.some((l) => /already running/.test(l))).toBe(false);
    expect(fs.existsSync(mp4.replace(/\.mp4$/, '.telemetry.jsonl'))).toBe(false);
  } finally { r.dispose(); }
});

test('OBS saying nothing is recording, with no STOPPED to say so, ends the recording at the next look', async () => {
  const r = rig();
  try {
    await until(() => r.keeper.status().obs === 'open');
    const started = await r.keeper.record({ source: 'desk' });
    server.state.recording = false;                    // as if the event was missed
    await until(() => !r.keeper.status().recording, 3000);
    expect(r.keeper.status()).toMatchObject({ owned: false, sidecar: null });
    expect(fs.existsSync(stateFileOf())).toBe(false);
    expect(sidecarOf(started.path.replace(/\//g, path.sep)).at(-1)).toMatchObject({ _type: 'summary', reason: 'OBS said it was not recording' });
  } finally { r.dispose(); }
});

test('a split recording stays ours: the file STARTED named is its key, a restart takes it over by that, and STOPPED does not point back at the first file', async () => {
  const first = `${asSlashes(dir)}/split-1.mp4`;
  const second = `${asSlashes(dir)}/split-2.mp4`;
  server.startRecording(first);
  fs.mkdirSync(path.join(dir, 'state'), { recursive: true });
  // What a keeper that started it and saw the split wrote. OBS's settings still name the first file (mp4_output does not
  // update its "path" when it splits), so that is what GetOutputSettings answers.
  fs.writeFileSync(stateFileOf(), JSON.stringify({ owned: first.replace(/\//g, '\\'), current: second, startedAt: Date.now() }));
  const r = rig();
  try {
    await until(() => r.keeper.status().recording);
    expect(r.keeper.status()).toMatchObject({ owned: true, outputPath: second });
    server.emit('RecordFileChanged', { newOutputPath: `${asSlashes(dir)}/split-3.mp4` });
    await until(() => r.keeper.status().outputPath.endsWith('split-3.mp4'));
    expect(JSON.parse(fs.readFileSync(stateFileOf(), 'utf8'))).toMatchObject({ current: `${asSlashes(dir)}/split-3.mp4` });
    expect(JSON.parse(fs.readFileSync(stateFileOf(), 'utf8')).owned.replace(/\\/g, '/')).toBe(first);   // the key is still the first file
    server.stopRecording();                         // STOPPED carries OBS's last file name: the first one
    await until(() => !r.keeper.status().recording);
    expect(r.keeper.status().outputPath).toBe(`${asSlashes(dir)}/split-3.mp4`);
    expect(fs.existsSync(stateFileOf())).toBe(false);
  } finally { r.dispose(); }
});

test('the 20 GB floor is measured where OBS records, asked of OBS, and not on Racing Desk\'s own folder', async () => {
  server.state.recordDirectory = 'X:/OBS Videos';
  const r = rig();
  try {
    await until(() => r.keeper.status().obs === 'open');
    r.fake.freeFor = (folder) => (/OBS Videos/.test(folder) ? 15e9 : 400e9);   // OBS's drive is nearly full; Racing Desk's folder is not
    const refused = await r.keeper.record({ source: 'desk' });
    expect(refused).toMatchObject({ ok: false });
    expect(refused.reason).toBe('Only 15 GB free on X:. Recording needs about 20 GB.');
    expect(server.requests.map((q) => q.type)).toContain('GetRecordDirectory');
    expect(server.requests.filter((q) => q.type === 'StartRecord')).toHaveLength(0);
    expect(r.keeper.status().free).toMatchObject({ bytes: 15e9, drive: 'X:' });
    expect(r.fake.freeAsked.at(-1)).toBe('X:/OBS Videos');
  } finally { r.dispose(); }
});

test('with OBS not there to be asked the floor goes by the folder its profile says, then Racing Desk\'s', async () => {
  const closed = await startFakeObs({ password: PASSWORD });
  const port = closed.port;
  await closed.close();
  const r = rig({ port });
  try {
    r.fake.profileFolder = 'C:/Users/Driver/Videos/NVIDIA';
    await r.keeper.refreshFree();
    expect(r.fake.freeAsked.at(-1)).toBe('C:/Users/Driver/Videos/NVIDIA');
    r.fake.profileFolder = null;
    await r.keeper.refreshFree();
    expect(r.fake.freeAsked.at(-1)).toBe(dir);
  } finally { r.dispose(); }
});

test('a folder that is not made yet is measured on the one above it, and a drive that cannot be measured at all is a recording that does not start', async () => {
  // freeSpaceOf: the folder is missing (OBS makes it when it starts; Set up OBS may not have run), so the nearest
  // folder above it is asked. It used to answer null here, which switched the floor off without a word.
  const missing = path.join(dir, 'not', 'made', 'yet');
  const bytes = await keeperModule.freeSpaceOf(missing);
  expect(typeof bytes).toBe('number');
  expect(bytes).toBeGreaterThan(0);
  // Only statfs that fails everywhere gives null.
  expect(await keeperModule.freeSpaceOf(missing, { statfs: (p, cb) => cb(new Error('ENOENT')) })).toBeNull();
  expect(await keeperModule.freeSpaceOf('')).toBeNull();

  const r = rig({ freeBytes: null });
  try {
    await until(() => r.keeper.status().obs === 'open');
    const answer = await r.keeper.record({ source: 'desk' });
    expect(answer.ok).toBe(false);
    expect(answer.reason).toMatch(/^Racing Desk could not tell how much room is left on .*, so it did not start recording\.$/);
    expect(server.requests.filter((q) => q.type === 'StartRecord')).toHaveLength(0);
  } finally { r.dispose(); }
});

test('"OBS is not open" goes on the HUD only when tasklist says OBS is not running; open and not reached, or refusing the password, it is said in words', async () => {
  const closed = await startFakeObs({ password: PASSWORD });
  const port = closed.port;
  await closed.close();
  const r = rig({ port, obsRunning: true });
  try {
    await until(() => r.keeper.status().obs === 'closed');
    // OBS is open (recording by Ctrl+Space, say) with its WebSocket off: the sentence would be false, and filmed.
    expect(await r.keeper.record({ source: 'key' })).toMatchObject({ ok: false, reason: 'OBS is open but Racing Desk cannot reach it.' });
    expect(r.notices).toEqual([]);
    // tasklist cannot say: nothing is put on the HUD either.
    r.fake.obsRunning = null;
    expect(await r.keeper.record({ source: 'key' })).toMatchObject({ ok: false, reason: "OBS isn't open" });
    expect(r.notices).toEqual([]);
    // It says OBS is not running: now the HUD is told.
    r.fake.obsRunning = false;
    expect(await r.keeper.record({ source: 'key' })).toMatchObject({ ok: false, reason: "OBS isn't open" });
    expect(r.notices).toEqual(['OBS is not open']);
  } finally { r.dispose(); }

  // Open, refusing the password: the sentence is about the password.
  const other = await startFakeObs({ password: 'another-password' });
  const w = rig({ port: other.port, obsRunning: true });
  try {
    await until(() => w.keeper.status().obs === 'authFailed');
    expect(await w.keeper.record({ source: 'key' })).toMatchObject({ ok: false, reason: 'OBS refused the password. Type the one from OBS on the Recording card.' });
    expect(w.notices).toEqual([]);
  } finally { w.dispose(); await other.close(); }
});

test('Record with OBS open and refusing the password says so at once, not after half a minute and a sentence about a crash', async () => {
  const other = await startFakeObs({ password: 'another-password' });
  const w = rig({ port: other.port, startObs: async () => ({ ok: true, running: true }) });
  try {
    await until(() => w.keeper.status().obs === 'authFailed');
    const began = Date.now();
    const answer = await w.keeper.record({ source: 'desk' });
    expect(answer).toMatchObject({ ok: false, reason: 'OBS refused the password. Type the one from OBS on the Recording card.' });
    expect(Date.now() - began).toBeLessThan(300);      // the keeper's wait for OBS is 600 ms here
    expect(w.notices).toEqual([]);
  } finally { w.dispose(); await other.close(); }

  // And with no password to give at all.
  const none = await startFakeObs({ password: PASSWORD });
  const client = createObsClient({ port: none.port, password: () => null, retryMs: 40, authRetryMs: 100, connectTimeoutMs: 500 });
  const keeper = createRecordingKeeper({ client, recordFolder: () => dir, freeSpace: async () => 400e9, startObs: async () => ({ ok: true, running: true }), waitObsMs: 600, idleFreeEveryMs: 100000 });
  keeper.start();
  client.start();
  try {
    await until(() => keeper.status().obs === 'passwordMissing');
    expect(await keeper.record({ source: 'desk' })).toMatchObject({ ok: false, reason: 'OBS wants a password and Racing Desk has none. Type the one from OBS on the Recording card.' });
  } finally { keeper.dispose(); client.stop(); await none.close(); }
});

test('OBS being looked for every few seconds is not announced every time: the desk and the tray are told of changes, not of tries', async () => {
  const closed = await startFakeObs({ password: PASSWORD });
  const port = closed.port;
  await closed.close();
  const r = rig({ port });
  try {
    await until(() => r.client.state().attempts >= 8, 3000);   // eight tries at 40 ms
    // Looking for OBS and not finding it, again and again, is one thing to say, not sixteen.
    expect(r.changes.length).toBeLessThanOrEqual(3);
    expect(r.changes.every((s) => s.obs === 'connecting' || s.obs === 'closed')).toBe(true);
  } finally { r.dispose(); }
});

// ── Stage 2: auto-record, the replay buffer, chapters, the folder and the offset ──────────────────────────────────

const RACE_FRAME = (o = {}) => ({
  ...LIVE,
  'RacingDesk.Plugin.DS.SessionMode': 4, 'RacingDesk.Plugin.SessionTypeName': 'Race', 'DataCorePlugin.GameRawData.Telemetry.SessionNum': 2,
  'RacingDesk.Plugin.Grid.SessionState': 4, 'RacingDesk.Plugin.DS.IsInPitLane': 0, 'RacingDesk.Plugin.DS.IsEndOfRace': 0, 'DataCorePlugin.GameRawData.Telemetry.IsOnTrack': 1,
  'RacingDesk.Plugin.Session.TrackName': 'Zandvoort',
  ...o,
});
// Feed the keeper `n` times, `everyMs` apart, with the payload the rig holds (which a test may change between feeds).
async function feedFor(r, n, everyMs = 20) {
  for (let i = 0; i < n; i++) { r.keeper.feed(r.fake.payload); await settle(everyMs); }
}
// Wait for `what`, feeding the keeper the rig's payload every 40 ms meanwhile (as main.js does in the car).
async function untilFed(r, what, timeoutMs = 4000) {
  const start = Date.now();
  while (!what()) {
    if (Date.now() - start > timeoutMs) throw new Error('waited too long');
    r.keeper.feed(r.fake.payload);
    await settle(40);
  }
}
const folderOf = (r) => r.keeper.status().filed && r.keeper.status().filed.folder;
const linesOf = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('auto-record: fed the race from the grid, the green flag starts a recording of its own (never OBS), leaving the car stops it, and a Stop he pressed is not undone', async () => {
  const r = rig({ inCar: true, payload: RACE_FRAME({ 'RacingDesk.Plugin.Grid.SessionState': 2 }) });
  try {
    await until(() => r.keeper.status().obs === 'open');
    await feedFor(r, 5);
    expect(server.requests.filter((q) => q.type === 'StartRecord')).toHaveLength(0);
    r.fake.payload = RACE_FRAME({ 'RacingDesk.Plugin.Grid.SessionState': 4 });
    await untilFed(r, () => r.keeper.status().recording);
    expect(r.keeper.status()).toMatchObject({ owned: true, auto: true });
    expect(JSON.parse(fs.readFileSync(stateFileOf(), 'utf8'))).toMatchObject({ auto: true });
    expect(r.fake.startObsCalls).toBe(0);
    expect(r.lines.some((l) => /Auto-record: green flag, starting/.test(l))).toBe(true);
    // In the car under the green flag, the flag is used up: he presses Stop, and the next feeds start nothing.
    await r.keeper.stop();
    const starts = server.requests.filter((q) => q.type === 'StartRecord').length;
    await feedFor(r, 12, 60);
    expect(server.requests.filter((q) => q.type === 'StartRecord')).toHaveLength(starts);
    // Out of the car and back in: the green flag counts again, and leaving the car stops what it started.
    r.fake.inCar = false;
    await feedFor(r, 3, 60);
    r.fake.inCar = true;
    await untilFed(r, () => r.keeper.status().recording);
    expect(r.keeper.status().auto).toBe(true);
    r.fake.inCar = false;
    await untilFed(r, () => !r.keeper.status().recording);
    expect(r.lines.some((l) => /Auto-record: out of the car, stopping/.test(l))).toBe(true);
    expect(server.state.recording).toBe(false);
  } finally { r.dispose(); }
});

test('auto-record stops only what it started: a recording he began on the desk runs on when he leaves the car; with the switch off nothing starts', async () => {
  const r = rig({ inCar: true, payload: RACE_FRAME() });
  try {
    await until(() => r.keeper.status().obs === 'open');
    await r.keeper.record({ source: 'desk' });
    expect(r.keeper.status()).toMatchObject({ recording: true, owned: true, auto: false });
    r.fake.inCar = false;
    await feedFor(r, 30, 40);
    expect(r.keeper.status().recording).toBe(true);
    expect(server.state.recording).toBe(true);
    await r.keeper.stop();
    // The switch off: the green flag starts nothing.
    r.fake.settings.recordingAutoRecord = false;
    r.fake.inCar = true;
    await feedFor(r, 30, 40);
    expect(r.keeper.status().recording).toBe(false);
    expect(server.requests.filter((q) => q.type === 'StartRecord')).toHaveLength(1);
  } finally { r.dispose(); }
});

test('auto-record with OBS closed: nothing is started, the HUD is told once for the session, and the tries are spaced', async () => {
  const closed = await startFakeObs({ password: PASSWORD });
  const port = closed.port;
  await closed.close();
  const r = rig({ port, inCar: true, payload: RACE_FRAME(), obsRunning: false });
  try {
    await until(() => r.keeper.status().obs === 'closed');
    await feedFor(r, 40, 40);   // 1.6 s under the green flag: asked for every second, tried every 300 ms at most
    expect(r.fake.startObsCalls).toBe(0);
    expect(r.notices).toEqual(['OBS is not open']);
    const tries = r.lines.filter((l) => /Auto-record: green flag, starting/.test(l)).length;
    expect(tries).toBeGreaterThanOrEqual(1);
    expect(tries).toBeLessThanOrEqual(6);
    expect(r.keeper.status().last).toMatchObject({ ok: false, text: "OBS isn't open" });
  } finally { r.dispose(); }
});

test('the replay buffer runs with the car while Instant replay is on; the switch off stops it; one OBS started itself is left alone; with none in OBS the card says to press Set up OBS', async () => {
  server.state.profile.AdvOut.RecRB = 'true';
  const r = rig({ inCar: false, payload: RACE_FRAME(), settings: { recordingInstantReplay: true } });
  try {
    await until(() => r.keeper.status().obs === 'open');
    await feedFor(r, 3);
    expect(server.state.replayBuffer).toBe(false);
    r.fake.inCar = true;
    await untilFed(r, () => r.keeper.status().replay.running, 2000);
    expect(server.requests.filter((q) => q.type === 'StartReplayBuffer')).toHaveLength(1);
    expect(r.keeper.needsStopForQuit()).toBe(true);
    r.fake.inCar = false;
    await untilFed(r, () => !r.keeper.status().replay.running, 2000);
    await until(() => !server.state.replayBuffer);   // OBS stops it after it has answered: STOPPING, then STOPPED
    // In the car again, then the switch off: stopped though he is still in the car.
    r.fake.inCar = true;
    await untilFed(r, () => r.keeper.status().replay.running, 2000);
    r.fake.settings.recordingInstantReplay = false;
    await untilFed(r, () => !r.keeper.status().replay.running, 2000);
    await until(() => !server.state.replayBuffer);
    // One OBS started itself is left alone when he gets out, and is not Racing Desk's to stop at quit.
    r.fake.settings.recordingInstantReplay = true;
    server.handlers.StartReplayBuffer({});
    await until(() => r.keeper.status().replay.running);
    r.fake.inCar = false;
    await feedFor(r, 5, 40);
    expect(server.state.replayBuffer).toBe(true);
    expect(r.keeper.needsStopForQuit()).toBe(false);
  } finally { r.dispose(); }

  // No replay buffer in OBS (RecRB off): said on the card, and not asked for again and again.
  server.state.replayBuffer = false;
  server.state.profile.AdvOut.RecRB = 'false';
  const askedBefore = server.requests.filter((q) => q.type === 'StartReplayBuffer').length;
  const w = rig({ inCar: true, payload: RACE_FRAME(), settings: { recordingInstantReplay: true } });
  try {
    await until(() => w.keeper.status().obs === 'open');
    await feedFor(w, 10, 40);
    expect(w.keeper.status().replay).toMatchObject({ on: true, running: false, unavailable: 'OBS has no replay buffer. Press Set up OBS, then open OBS again.' });
    expect(server.requests.filter((q) => q.type === 'StartReplayBuffer').length - askedBefore).toBeLessThanOrEqual(2);   // 400 ms of feeds, tried every 300 ms at most
    expect(await w.keeper.saveReplay({ source: 'desk' })).toMatchObject({ ok: false, reason: 'OBS has no replay buffer. Press Set up OBS, then open OBS again.' });
  } finally { w.dispose(); }
});

test('Save replay: the clip OBS saves gets a sidecar from the last seconds of telemetry, lined up from its end, in the recording\'s folder; outside a recording it goes to Replays', async () => {
  server.state.profile.AdvOut.RecRB = 'true';
  server.state.profile.AdvOut.RecFormat2 = 'hybrid_mp4';
  server.mode.writeClip = (clip) => fs.writeFileSync(clip, buildFinalMp4({ durationMs: 2000, withChapterTrack: false }));
  const r = rig({ inCar: true, payload: RACE_FRAME(), settings: { recordingInstantReplay: true, recordingInstantReplaySeconds: 5 } });
  try {
    await until(() => r.keeper.status().obs === 'open');
    // Switched off: said. Not running: said.
    r.fake.settings.recordingInstantReplay = false;
    expect(await r.keeper.saveReplay({ source: 'key' })).toMatchObject({ ok: false, reason: 'Instant replay is switched off on the Recording card.' });
    r.fake.settings.recordingInstantReplay = true;
    expect(await r.keeper.saveReplay({ source: 'key' })).toMatchObject({ ok: false, reason: "The replay buffer isn't running." });
    await untilFed(r, () => r.keeper.status().replay.running, 2000);
    // A recording running, filed in its folder: the clip goes in with it.
    const started = await r.keeper.record({ source: 'desk' });
    await until(() => folderOf(r));
    await settle(300);   // the ring fills
    const saved = await r.keeper.saveReplay({ source: 'key' });
    expect(saved.ok).toBe(true);
    expect(saved.path).toMatch(/Replay 2026-09-30 21-20-00\.mp4$/);
    await until(() => r.keeper.status().replay.lastSaved, 3000);
    const clip = r.keeper.status().replay.lastSaved;
    expect(path.dirname(clip.path)).toBe(folderOf(r));
    expect(clip.sidecar).toBe(clip.path.replace(/\.mp4$/, '.telemetry.jsonl'));
    const lines = linesOf(clip.sidecar);
    expect(lines[0]).toMatchObject({ _type: 'header', kind: 'replay', car: 'Porsche 911 GT3 R', track: 'Zandvoort' });
    const frames = lines.filter((l) => !l._type);
    expect(frames.length).toBeGreaterThan(5);
    expect(frames.every((f) => f.t >= 0 && f.t <= 2.1)).toBe(true);   // the clip is 2 s long: its frames are the last 2 s
    expect(lines.at(-1)).toMatchObject({ _type: 'summary', reason: 'saved', videoOffsetMs: 0, alignment: { method: 'end', durationMs: 2000, endFrom: 'request' } });
    expect(clip.frames).toBe(frames.length);
    expect(r.notices).toEqual([]);
    // The recording itself is filed with the clip beside it.
    fs.writeFileSync(started.path, buildFinalMp4({ durationMs: 3000, chapters: [{ ms: 0, name: 'Start' }] }));
    const folder = folderOf(r);
    await r.keeper.stop();
    await until(() => r.keeper.status().lastFiled, 3000);
    expect(r.keeper.status().lastFiled.clips).toBe(1);
    expect(fs.readdirSync(folder).sort()).toEqual([
      path.basename(started.path), path.basename(started.path).replace(/\.mp4$/, '.telemetry.jsonl'), 'Replay 2026-09-30 21-20-00.mp4', 'Replay 2026-09-30 21-20-00.telemetry.jsonl',
    ].sort());
    // No recording: the clip goes to Replays under the recordings folder.
    await settle(200);
    const alone = await r.keeper.saveReplay({ source: 'tray' });
    expect(alone.ok).toBe(true);
    await until(() => r.keeper.status().replay.lastSaved && /21-20-01/.test(r.keeper.status().replay.lastSaved.path), 3000);
    expect(path.dirname(r.keeper.status().replay.lastSaved.path)).toBe(path.join(dir, 'Replays'));
    expect(fs.existsSync(path.join(dir, 'Replays', 'Replay 2026-09-30 21-20-01.telemetry.jsonl'))).toBe(true);
  } finally { r.dispose(); }
});

test('a clip saved with no sim session live is left where OBS put it, with no sidecar', async () => {
  server.state.profile.AdvOut.RecRB = 'true';
  server.mode.writeClip = (clip) => fs.writeFileSync(clip, buildFinalMp4({ durationMs: 2000, withChapterTrack: false }));
  const r = rig({ inCar: true, payload: { ...RACE_FRAME(), 'DataCorePlugin.GameRunning': 0 }, settings: { recordingInstantReplay: true } });
  try {
    await until(() => r.keeper.status().obs === 'open');
    server.handlers.StartReplayBuffer({});
    await until(() => r.keeper.status().replay.running);
    await settle(200);
    const saved = await r.keeper.saveReplay({ source: 'desk' });
    expect(saved.ok).toBe(true);
    await until(() => r.lines.some((l) => /saved with no sim session live/.test(l)), 3000);
    expect(fs.existsSync(saved.path)).toBe(true);
    expect(fs.existsSync(saved.path.replace(/\.mp4$/, '.telemetry.jsonl'))).toBe(false);
    expect(r.keeper.status().replay.lastSaved).toBeNull();
  } finally { r.dispose(); }
});

test('chapters: a lap, an incident, a place gained and the pit lane are sent to OBS as they are found, kept in the sidecar, and read back from the finished file for the offset', async () => {
  server.state.profile.AdvOut.RecFormat2 = 'hybrid_mp4';
  const r = rig({ inCar: true, payload: RACE_FRAME() });
  try {
    await until(() => r.keeper.status().obs === 'open');
    const started = await r.keeper.record({ source: 'desk' });
    await until(() => r.keeper.status().sidecar && r.keeper.status().sidecar.frames >= 3);
    const chapterOf = async (change, name) => {
      const before = r.keeper.status().chapters;
      r.fake.payload = { ...r.fake.payload, ...change };
      await until(() => r.keeper.status().chapters === before + 1, 2000);
      expect(server.state.chapters.at(-1).name).toBe(name);
    };
    await chapterOf({ 'DataCorePlugin.GameData.CurrentLap': 9 }, 'Lap 9');
    const incidents = Number(r.fake.payload['RacingDesk.Plugin.DS.IncidentCount']) || 0;
    await chapterOf({ 'RacingDesk.Plugin.DS.IncidentCount': incidents + 2 }, 'Incident ×2');
    await chapterOf({ 'DataCorePlugin.GameData.Position': 4 }, 'P5 → P4');
    await chapterOf({ 'RacingDesk.Plugin.DS.IsInPitLane': 1 }, 'Pit in');
    await chapterOf({ 'RacingDesk.Plugin.DS.IsInPitLane': 0 }, 'Pit out');
    // A place lost is no chapter.
    r.fake.payload = { ...r.fake.payload, 'DataCorePlugin.GameData.Position': 6 };
    await settle(150);
    expect(r.keeper.status().chapters).toBe(5);
    expect(server.state.chapters.map((c) => c.name)).toEqual(['Lap 9', 'Incident ×2', 'P5 → P4', 'Pit in', 'Pit out']);
    // The finished file: OBS's own Start first, then ours at the times it stamped them, 250 ms later than our clock
    // (the frames an output joining a running encoder drops), which is the offset to read back.
    const theirs = [{ ms: 0, name: 'Start' }, ...server.state.chapters.map((c) => ({ ms: c.ms + 250, name: c.name }))];
    const durationMs = (server.mode.clock() - server.state.startedAt) + 1000;
    fs.writeFileSync(started.path, buildFinalMp4({ durationMs, chapters: theirs }));
    await r.keeper.stop();
    await until(() => r.keeper.status().lastFiled, 3000);
    const filed = r.keeper.status().lastFiled;
    expect(path.dirname(filed.folder)).toBe(dir);
    expect(path.basename(filed.folder)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}-\d{2} Zandvoort Porsche 911 GT3 R$/);
    expect(filed.chapters).toBe(5);
    expect(filed.alignment).toMatchObject({ method: 'chapters', pairs: 5, fileChapters: 6 });
    expect(Math.abs(filed.alignment.spreadMs)).toBeLessThan(80);
    const summary = linesOf(filed.sidecar).at(-1);
    expect(summary).toMatchObject({ _type: 'summary', reason: 'stopped', alignment: { method: 'chapters', pairs: 5 } });
    expect(summary.videoOffsetMs).toBeGreaterThan(150);
    expect(summary.videoOffsetMs).toBeLessThan(350);
    expect(summary.chapters.map((c) => c.name)).toEqual(['Lap 9', 'Incident ×2', 'P5 → P4', 'Pit in', 'Pit out']);
    expect(summary.obsOutputPath).toBe(filed.video);
    expect(fs.existsSync(started.path.replace(/\//g, path.sep))).toBe(false);   // moved
    expect(fs.existsSync(filed.video)).toBe(true);
    expect(fs.existsSync(stateFileOf())).toBe(false);
  } finally { r.dispose(); }
});

test('a file that takes no chapters (not Hybrid MP4) gets none after the first refusal and is lined up from its end; with Chapters off none is sent', async () => {
  server.state.profile.AdvOut.RecFormat2 = 'mp4';
  const r = rig({ inCar: true, payload: RACE_FRAME() });
  try {
    await until(() => r.keeper.status().obs === 'open');
    const started = await r.keeper.record({ source: 'desk' });
    await until(() => r.keeper.status().sidecar && r.keeper.status().sidecar.frames >= 2);
    r.fake.payload = { ...r.fake.payload, 'DataCorePlugin.GameData.CurrentLap': 9 };
    await until(() => r.lines.some((l) => /takes no chapters in this file/.test(l)), 2000);
    r.fake.payload = { ...r.fake.payload, 'DataCorePlugin.GameData.CurrentLap': 10 };
    await settle(150);
    expect(server.requests.filter((q) => q.type === 'CreateRecordChapter')).toHaveLength(1);
    expect(r.keeper.status().chapters).toBe(0);
    // A plain MP4 three seconds long, stopped now: it began three seconds before the stop.
    fs.writeFileSync(started.path, buildFinalMp4({ durationMs: 3000, withChapterTrack: false }));
    await r.keeper.stop();
    await until(() => r.keeper.status().lastFiled, 3000);
    const filed = r.keeper.status().lastFiled;
    expect(filed.alignment).toMatchObject({ method: 'end', durationMs: 3000 });
    const summary = linesOf(filed.sidecar).at(-1);
    expect(summary.alignment.method).toBe('end');
    // t + offset is video time: the file holds three seconds and the recording ran well under one here, so the file
    // began a little under three seconds before STARTED, and the offset is a little under +3000.
    expect(summary.videoOffsetMs).toBeGreaterThan(1500);
    expect(summary.videoOffsetMs).toBeLessThan(3000);
  } finally { r.dispose(); }

  server.state.profile.AdvOut.RecFormat2 = 'hybrid_mp4';
  const w = rig({ inCar: true, payload: RACE_FRAME(), settings: { recordingChapters: false } });
  try {
    await until(() => w.keeper.status().obs === 'open');
    await w.keeper.record({ source: 'desk' });
    await until(() => w.keeper.status().sidecar && w.keeper.status().sidecar.frames >= 2);
    w.fake.payload = { ...w.fake.payload, 'DataCorePlugin.GameData.CurrentLap': 9 };
    await settle(150);
    expect(server.requests.filter((q) => q.type === 'CreateRecordChapter')).toHaveLength(1);   // the one from before
    await w.keeper.stop();
  } finally { w.dispose(); }
});

test('OBS closing mid-recording files what it wrote: an unfinished Hybrid MP4 is lined up from its end, approximately', async () => {
  const r = rig({ inCar: true, payload: RACE_FRAME() });
  try {
    await until(() => r.keeper.status().obs === 'open');
    const started = await r.keeper.record({ source: 'desk' });
    await until(() => r.keeper.status().sidecar && r.keeper.status().sidecar.frames >= 2);
    fs.writeFileSync(started.path, buildFragmentedMp4({ fragments: [{ samples: 60, sampleDuration: 1000 }, { samples: 30, sampleDuration: 1000 }] }));
    await server.exitStarted();
    await until(() => r.keeper.status().lastFiled, 3000);
    const filed = r.keeper.status().lastFiled;
    expect(filed.alignment).toMatchObject({ method: 'end', durationMs: 1500, approximate: true });
    const summary = linesOf(filed.sidecar).at(-1);
    expect(summary).toMatchObject({ reason: 'OBS went away', alignment: { method: 'end', approximate: true } });
    expect(fs.existsSync(filed.video)).toBe(true);
    expect(path.dirname(filed.video)).toBe(filed.folder);
  } finally { r.dispose(); }
});

test('across drives nothing is copied: the file and its sidecar stay where OBS wrote them, and the card is told why', async () => {
  const elsewhere = /^[a-y]:/i.test(dir) ? 'Z:\\Racing Desk\\Recordings' : 'Y:\\Racing Desk\\Recordings';
  const lines = [];
  const payload = RACE_FRAME();
  const client = createObsClient({ port: server.port, password: () => PASSWORD, retryMs: 40, connectTimeoutMs: 500 });
  const keeper = createRecordingKeeper({
    client, settings: () => ({}), recordFolder: () => elsewhere, stateFile: path.join(dir, 'state2', 'recording-state.json'),
    freeSpace: async () => 400e9, fetchPayload: async () => payload, inCar: () => true, log: (l) => lines.push(l),
    waitStartedMs: 400, waitStoppedMs: 400, statusEveryMs: 60, idleFreeEveryMs: 100000, sidecarHz: 100, stableMs: 40, stableTimeoutMs: 2000,
  });
  keeper.start();
  client.start();
  try {
    await until(() => keeper.status().obs === 'open');
    const started = await keeper.record({ source: 'desk' });
    await until(() => keeper.status().sidecar && keeper.status().sidecar.frames >= 2);
    expect(keeper.status().filed).toBeNull();
    fs.writeFileSync(started.path, buildFinalMp4({ durationMs: 1000, withChapterTrack: false }));
    await keeper.stop();
    await until(() => keeper.status().lastFiled, 3000);
    const filed = keeper.status().lastFiled;
    expect(filed.folder).toBeNull();
    expect(filed.why).toMatch(/different drives/);
    expect(filed.video).toBe(started.path);
    expect(fs.existsSync(started.path.replace(/\//g, path.sep))).toBe(true);
    expect(fs.existsSync(started.path.replace(/\.mp4$/, '.telemetry.jsonl').replace(/\//g, path.sep))).toBe(true);
  } finally { keeper.dispose(); client.stop(); }
});

test('a recording OBS started by Ctrl+Space during a live session is filed the same: its folder, its chapters, its move', async () => {
  server.state.profile.AdvOut.RecFormat2 = 'hybrid_mp4';
  const r = rig({ inCar: true, payload: RACE_FRAME() });
  try {
    await until(() => r.keeper.status().obs === 'open');
    const mp4 = `${asSlashes(dir)}/his.mp4`;
    server.startRecording(mp4);
    await until(() => r.keeper.status().sidecar && r.keeper.status().sidecar.frames >= 2);
    expect(r.keeper.status()).toMatchObject({ owned: false, auto: false });
    expect(folderOf(r)).toMatch(/Zandvoort Porsche 911 GT3 R$/);
    r.fake.payload = { ...r.fake.payload, 'DataCorePlugin.GameData.CurrentLap': 9 };
    await until(() => r.keeper.status().chapters === 1, 2000);
    fs.writeFileSync(mp4, buildFinalMp4({ durationMs: 2000, chapters: [{ ms: 0, name: 'Start' }, { ms: server.state.chapters[0].ms + 100, name: 'Lap 9' }] }));
    server.stopRecording();
    await until(() => r.keeper.status().lastFiled, 3000);
    const filed = r.keeper.status().lastFiled;
    expect(path.basename(filed.video)).toBe('his.mp4');
    expect(path.dirname(filed.video)).toBe(filed.folder);
    expect(filed.alignment).toMatchObject({ method: 'chapters', pairs: 1 });
    expect(fs.existsSync(path.join(filed.folder, 'his.telemetry.jsonl'))).toBe(true);
  } finally { r.dispose(); }
});

// ── What the review of stage 2 found ─────────────────────────────────────────────────────────────────────────────

// A keeper over a client whose port the test can move (an OBS that crashed has nothing listening; one that came back
// has), with the disk, the clock and the sim as fakes.
function aimedRig({ lostAfterMs = 200, keeper: keeperOptions = {}, payload = RACE_FRAME() } = {}) {
  let aim = server.port;
  const lines = [];
  const client = createObsClient({ port: () => aim, password: () => PASSWORD, retryMs: 40, authRetryMs: 100, connectTimeoutMs: 300, log: (l) => lines.push(l) });
  const keeper = createRecordingKeeper({
    client, settings: () => ({ obsStartOnRecord: true }), recordFolder: () => dir, stateFile: stateFileOf(),
    freeSpace: async () => 400e9, fetchPayload: async () => payload, inCar: () => true, log: (l) => lines.push(l),
    waitStartedMs: 400, waitStoppedMs: 400, quitWaitMs: 300, statusEveryMs: 60, idleFreeEveryMs: 100000, sidecarHz: 100, lostAfterMs,
    stableMs: 40, stableTimeoutMs: 2000, moveRetryMs: 20, ...keeperOptions,
  });
  keeper.start();
  client.start();
  return { client, keeper, lines, setAim: (p) => { aim = p; }, dispose: () => { keeper.dispose(); client.stop(); } };
}
const deadPort = async () => { const probe = await startFakeObs({ password: PASSWORD }); const port = probe.port; await probe.close(); return port; };
const FRAGMENTED_1500 = () => buildFragmentedMp4({ fragments: [{ samples: 60, sampleDuration: 1000 }, { samples: 30, sampleDuration: 1000 }] });   // 1.5 s
const replayEvents = () => server.events.filter((e) => e.eventType === 'ReplayBufferStateChanged').map((e) => e.eventData);

test('the replay buffer Racing Desk starts stays its own through the order OBS reports it in — the answer, STARTING (inactive), STARTED — and is stopped when he leaves the car and when Racing Desk quits', async () => {
  server.state.profile.AdvOut.RecRB = 'true';
  const r = rig({ inCar: true, payload: RACE_FRAME(), settings: { recordingInstantReplay: true } });
  try {
    await until(() => r.keeper.status().obs === 'open');
    await untilFed(r, () => r.keeper.status().replay.running, 2000);
    await until(() => replayEvents().some((e) => e.outputState === 'OBS_WEBSOCKET_OUTPUT_STARTED'));
    await settle(60);
    // As obs-websocket sends them: STARTING says the output is not active, and it comes after the answer.
    expect(replayEvents().slice(0, 2)).toEqual([
      { outputActive: false, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTING' },
      { outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED' },
    ]);
    expect(r.keeper.status().replay.running).toBe(true);
    expect(r.keeper.needsStopForQuit()).toBe(true);   // ours still: STARTING did not take it away
    // He leaves the car: the buffer is stopped, not left running with its encoder and the 30 Hz poll.
    r.fake.inCar = false;
    await untilFed(r, () => !server.state.replayBuffer, 2000);
    expect(r.keeper.status().replay.running).toBe(false);
    expect(replayEvents().map((e) => e.outputState).slice(2, 4)).toEqual(['OBS_WEBSOCKET_OUTPUT_STOPPING', 'OBS_WEBSOCKET_OUTPUT_STOPPED']);
    expect(replayEvents().find((e) => e.outputState === 'OBS_WEBSOCKET_OUTPUT_STOPPING').outputActive).toBe(false);
    // Back in: started again, and Racing Desk's quit stops it too.
    r.fake.inCar = true;
    await untilFed(r, () => server.state.replayBuffer && r.keeper.status().replay.running, 2000);
    await until(() => replayEvents().filter((e) => e.outputState === 'OBS_WEBSOCKET_OUTPUT_STARTED').length === 2);
    await settle(60);
    expect(r.keeper.needsStopForQuit()).toBe(true);
    await r.keeper.stopOwnedForQuit();
    await until(() => !server.state.replayBuffer);
  } finally { r.dispose(); }
});

test('a buffer is started again the moment he is back in the car: only a start that failed is held back', async () => {
  server.state.profile.AdvOut.RecRB = 'true';
  const r = rig({ inCar: true, payload: RACE_FRAME(), settings: { recordingInstantReplay: true }, keeper: { replayRetryMs: 5000 } });
  try {
    await until(() => r.keeper.status().obs === 'open');
    await untilFed(r, () => r.keeper.status().replay.running, 2000);
    r.fake.inCar = false;
    await untilFed(r, () => !server.state.replayBuffer, 2000);
    // Out for under a second, back in: not another minute of "The replay buffer isn't running."
    r.fake.inCar = true;
    await untilFed(r, () => server.state.replayBuffer && r.keeper.status().replay.running, 1500);
    expect(server.requests.filter((q) => q.type === 'StartReplayBuffer')).toHaveLength(2);
  } finally { r.dispose(); }
});

test('the demo is "in the car" and has no replay buffer: Instant replay starts only for a live sim session', async () => {
  server.state.profile.AdvOut.RecRB = 'true';
  const r = rig({ inCar: true, payload: { ...RACE_FRAME(), 'RacingDesk.Plugin.DemoMode': 1 }, settings: { recordingInstantReplay: true } });
  try {
    await until(() => r.keeper.status().obs === 'open');
    await feedFor(r, 10, 40);
    expect(server.requests.filter((q) => q.type === 'StartReplayBuffer')).toHaveLength(0);
    expect(r.keeper.status().replay.running).toBe(false);
    r.fake.payload = RACE_FRAME();
    await untilFed(r, () => r.keeper.status().replay.running, 2000);
  } finally { r.dispose(); }
});

test('the 30 Hz poll does not read the settings file each time, and a buffer he started himself keeps no poll going while he is out of the car', async () => {
  server.state.profile.AdvOut.RecRB = 'true';
  const r = rig({ inCar: true, payload: RACE_FRAME(), settings: { recordingInstantReplay: true } });
  try {
    await until(() => r.keeper.status().obs === 'open');
    await untilFed(r, () => r.keeper.status().replay.running, 2000);
    const reads = r.fake.settingsReads;
    const polls = r.fake.fetchCalls;
    await settle(400);
    expect(r.fake.fetchCalls - polls).toBeGreaterThan(15);   // the tap is running
    expect(r.fake.settingsReads - reads).toBeLessThan(6);    // and does not read the file at its rate
  } finally { r.dispose(); }

  // A buffer OBS started on its own, he is not in the car: nothing is polled; in the car, it is.
  server.state.replayBuffer = false;
  server.handlers.StartReplayBuffer({});
  await until(() => server.state.replayBuffer);
  const w = rig({ inCar: false, payload: RACE_FRAME(), settings: { recordingInstantReplay: true } });
  try {
    await until(() => w.keeper.status().replay.running);
    await settle(300);
    expect(w.fake.fetchCalls).toBe(0);
    w.fake.inCar = true;
    await untilFed(w, () => w.fake.fetchCalls > 5, 2000);
  } finally { w.dispose(); }
});

test("the ring is as long as OBS's own buffer (its RecRBTime), not the card's setting and a few seconds", async () => {
  server.state.profile.AdvOut.RecRB = 'true';
  server.state.profile.AdvOut.RecRBTime = '60';
  server.mode.writeClip = (clip) => fs.writeFileSync(clip, buildFinalMp4({ durationMs: 60000, withChapterTrack: false }));
  let jump = 0;
  const r = rig({ inCar: true, payload: RACE_FRAME(), settings: { recordingInstantReplay: true }, keeper: { now: () => Date.now() + jump } });
  try {
    await until(() => r.keeper.status().obs === 'open');
    await untilFed(r, () => r.keeper.status().replay.running, 2000);
    await until(() => server.requests.some((q) => q.type === 'GetProfileParameter' && q.data.parameterName === 'RecRBTime'));
    await settle(80);
    // Each poll is nearly a second on: eighty seconds of telemetry in a moment. The card says 20 s and OBS's buffer is 60.
    const polled = r.fake.fetchCalls;
    r.fake.onFetch = () => { jump += 990; };
    await until(() => r.fake.fetchCalls >= polled + 80, 8000);
    r.fake.onFetch = null;
    const saved = await r.keeper.saveReplay({ source: 'key' });
    expect(saved.ok).toBe(true);
    await until(() => r.keeper.status().replay.lastSaved, 5000);
    const frames = linesOf(r.keeper.status().replay.lastSaved.sidecar).filter((l) => !l._type);
    // The clip is sixty seconds long, and its sidecar starts with it: a ring of the card's twenty seconds and ten more
    // would have begun half a minute in.
    expect(frames[0].t).toBeLessThan(5);
    expect(frames.length).toBeGreaterThan(55);
  } finally { r.dispose(); }
});

test('with no replay buffer in OBS but one in its profile (Set up OBS ran while it was open), the card says it comes with the next start, not to press a button that is not there', async () => {
  server.state.profile.AdvOut.RecRB = 'true';
  server.mode.noReplayBuffer = true;
  const r = rig({ inCar: true, payload: RACE_FRAME(), settings: { recordingInstantReplay: true } });
  try {
    await until(() => r.keeper.status().obs === 'open');
    await until(() => r.keeper.status().replay.unavailable);
    expect(r.keeper.status().replay.unavailable).toBe('Instant replay starts the next time OBS opens.');
    expect(await r.keeper.saveReplay({ source: 'key' })).toMatchObject({ ok: false, reason: 'Instant replay starts the next time OBS opens.' });
    await feedFor(r, 6, 40);
    expect(r.keeper.status().replay.unavailable).toBe('Instant replay starts the next time OBS opens.');
    // The profile says nothing of one either: the other sentence.
    server.state.profile.AdvOut.RecRB = 'false';
    for (const s of server.clients()) s.conn.destroy();
    await until(() => r.keeper.status().replay.unavailable === 'OBS has no replay buffer. Press Set up OBS, then open OBS again.', 3000);
  } finally { r.dispose(); }
});

test('quitting waits for a recording that has just stopped to be filed: it is moved, its sidecar has its summary, and the quit is bounded', async () => {
  const r = rig({ inCar: true, payload: RACE_FRAME(), keeper: { stableMs: 300, stableTimeoutMs: 3000 } });
  try {
    await until(() => r.keeper.status().obs === 'open');
    const started = await r.keeper.record({ source: 'desk' });
    await until(() => r.keeper.status().sidecar && r.keeper.status().sidecar.frames >= 2);
    await until(() => folderOf(r));
    const folder = folderOf(r);
    fs.writeFileSync(started.path, buildFinalMp4({ durationMs: 3000, withChapterTrack: false }));
    // He finishes and closes the desk: STOPPED has come, and the file has still to hold still for 300 ms.
    await r.keeper.stop();
    expect(r.keeper.status().recording).toBe(false);
    expect(r.keeper.needsStopForQuit()).toBe(true);
    await r.keeper.stopOwnedForQuit();
    const video = path.join(folder, path.basename(started.path));
    expect(fs.existsSync(video)).toBe(true);
    expect(fs.existsSync(started.path)).toBe(false);
    expect(linesOf(video.replace(/\.mp4$/, '.telemetry.jsonl')).at(-1)).toMatchObject({ _type: 'summary', alignment: { method: 'end', endFrom: 'request' } });
    expect(r.keeper.needsStopForQuit()).toBe(false);
  } finally { r.dispose(); }

  // A filing that cannot finish is waited for only so long.
  const w = rig({ inCar: true, payload: RACE_FRAME(), keeper: { stableMs: 1500, stableTimeoutMs: 5000, filingQuitWaitMs: 150 } });
  try {
    await until(() => w.keeper.status().obs === 'open');
    const started = await w.keeper.record({ source: 'desk' });
    await until(() => w.keeper.status().sidecar && w.keeper.status().sidecar.frames >= 2);
    fs.writeFileSync(started.path, buildFinalMp4({ durationMs: 3000, withChapterTrack: false }));
    await w.keeper.stop();
    const began = Date.now();
    await w.keeper.stopOwnedForQuit();
    expect(Date.now() - began).toBeLessThan(900);
    expect(w.lines.some((l) => /filing was not finished in time/.test(l))).toBe(true);
  } finally { w.dispose(); }
});

test('OBS crashed and is back after more than half a minute: the file it left is filed from the last moment it was seen recording, and its sidecar gets a summary that says so', async () => {
  const a = aimedRig({ lostAfterMs: 200 });
  try {
    await until(() => a.keeper.status().obs === 'open');
    const started = await a.keeper.record({ source: 'desk' });
    await until(() => a.keeper.status().sidecar && a.keeper.status().sidecar.frames >= 3);
    fs.writeFileSync(started.path, FRAGMENTED_1500());   // what a crash leaves: a Hybrid MP4 never finalised
    const folder = a.keeper.status().filed.folder;
    a.setAim(await deadPort());
    server.state.recording = false;                       // when OBS is back it is not recording
    const cutAt = Date.now();
    for (const s of server.clients()) s.conn.destroy();
    await until(() => !a.keeper.status().recording, 3000);
    expect(fs.existsSync(stateFileOf())).toBe(true);
    // The video is still where OBS wrote it, and the sidecar already ends with the reason.
    expect(fs.existsSync(started.path)).toBe(true);
    expect(sidecarOf(started.path.replace(/\//g, path.sep)).at(-1)).toMatchObject({ _type: 'summary', reason: 'OBS went away' });
    await settle(250);
    // OBS is back, and is not recording.
    a.setAim(server.port);
    await until(() => a.keeper.status().lastFiled, 4000);
    const filed = a.keeper.status().lastFiled;
    expect(filed.folder).toBe(folder);
    expect(path.dirname(filed.video)).toBe(folder);
    expect(fs.existsSync(started.path)).toBe(false);
    expect(filed.alignment).toMatchObject({ method: 'end', endFrom: 'lastSeen', approximate: true, durationMs: 1500 });
    const lines = linesOf(filed.sidecar);
    expect(lines.filter((l) => l._type === 'summary')).toHaveLength(2);
    expect(lines.at(-1)).toMatchObject({ _type: 'summary', refiled: true, reason: 'OBS went away', alignment: { method: 'end', endFrom: 'lastSeen' } });
    expect(lines.at(-1).obsOutputPath).toBe(filed.video);
    // The end is when the connection was lost: not the half second after, when OBS came back and was asked.
    expect(Math.abs(Date.parse(lines.at(-1).stoppedAt) - cutAt)).toBeLessThan(250);
    expect(fs.existsSync(stateFileOf())).toBe(false);
  } finally { a.dispose(); }
});

test('OBS crashed and is back within half a minute: the end is when it was last seen recording, not when it was asked again', async () => {
  const a = aimedRig({ lostAfterMs: 5000 });
  try {
    await until(() => a.keeper.status().obs === 'open');
    const started = await a.keeper.record({ source: 'desk' });
    await until(() => a.keeper.status().sidecar && a.keeper.status().sidecar.frames >= 3);
    fs.writeFileSync(started.path, FRAGMENTED_1500());
    a.setAim(await deadPort());
    server.state.recording = false;
    const cutAt = Date.now();
    for (const s of server.clients()) s.conn.destroy();
    await settle(700);                                    // OBS takes its time to come back
    a.setAim(server.port);
    await until(() => a.keeper.status().lastFiled, 4000);
    const filed = a.keeper.status().lastFiled;
    expect(filed.alignment).toMatchObject({ method: 'end', endFrom: 'lastSeen', approximate: true, durationMs: 1500 });
    const summary = linesOf(filed.sidecar).at(-1);
    expect(summary).toMatchObject({ _type: 'summary', reason: 'OBS stopped while Racing Desk was away' });
    expect(Math.abs(Date.parse(summary.stoppedAt) - cutAt)).toBeLessThan(250);
    expect(Date.now() - Date.parse(summary.stoppedAt)).toBeGreaterThan(600);
  } finally { a.dispose(); }
});

test('Racing Desk restarted after the crash: a recording of ours in the state file, with a sidecar that has no summary, is filed when OBS answers and is not recording it', async () => {
  const began = Date.now() - 90_000;
  const mp4 = path.join(dir, 'crashed.mp4');
  fs.writeFileSync(mp4, FRAGMENTED_1500());
  const folder = path.join(dir, '2026-09-30 21-00 Zandvoort Porsche 911 GT3 R');
  fs.mkdirSync(folder, { recursive: true });
  const header = { _type: 'header', schemaVersion: 1, startedAt: new Date(began).toISOString(), car: 'Porsche 911 GT3 R', track: 'Zandvoort', producer: 'obs', kind: 'recording', obsOutputPath: asSlashes(mp4), videoOffsetMs: 0 };
  const frames = [0, 1, 2, 3].map((i) => ({ t: i * 0.033, frame: i, pos: 3 }));
  fs.writeFileSync(mp4.replace(/\.mp4$/, '.telemetry.jsonl'), [header, ...frames].map((l) => JSON.stringify(l)).join('\n') + '\n{"t":0.1');   // the last line cut short
  const seenAt = began + 80_000;
  fs.mkdirSync(path.join(dir, 'state'), { recursive: true });
  fs.writeFileSync(stateFileOf(), JSON.stringify({ owned: mp4, current: mp4, startedAt: began, auto: true, folder, seenAt }));
  const r = rig({ inCar: false, payload: null });
  try {
    await until(() => r.keeper.status().lastFiled, 4000);
    const filed = r.keeper.status().lastFiled;
    expect(filed.folder).toBe(folder);
    expect(fs.existsSync(mp4)).toBe(false);
    expect(fs.existsSync(path.join(folder, 'crashed.mp4'))).toBe(true);
    const lines = fs.readFileSync(path.join(folder, 'crashed.telemetry.jsonl'), 'utf8').split('\n').filter(Boolean);
    const summary = JSON.parse(lines.at(-1));
    expect(summary).toMatchObject({ _type: 'summary', refiled: true, frames: 4, reason: 'OBS went away', alignment: { method: 'end', endFrom: 'lastSeen', approximate: true, durationMs: 1500 } });
    expect(Date.parse(summary.stoppedAt)).toBe(seenAt);
    expect(summary.videoOffsetMs).toBe(Math.round(began - (seenAt - 1500)));
    expect(fs.existsSync(stateFileOf())).toBe(false);
  } finally { r.dispose(); }
});

test('the end of the file is when the stop was asked for, or OBS said it was stopping: not when STOPPED came after the encoder had flushed', async () => {
  server.state.profile.AdvOut.RecFormat2 = 'mp4';
  const r = rig({ inCar: true, payload: RACE_FRAME(), keeper: { waitStoppedMs: 2000 } });
  try {
    await until(() => r.keeper.status().obs === 'open');
    const started = await r.keeper.record({ source: 'desk' });
    await until(() => r.keeper.status().sidecar && r.keeper.status().sidecar.frames >= 2);
    fs.writeFileSync(started.path, buildFinalMp4({ durationMs: 3000, withChapterTrack: false }));
    server.mode.delayMs = 500;                            // the flush: STOPPED comes half a second after the request
    const asked = Date.now();
    await r.keeper.stop();
    expect(Date.now() - asked).toBeGreaterThanOrEqual(450);
    await until(() => r.keeper.status().lastFiled, 3000);
    const summary = linesOf(r.keeper.status().lastFiled.sidecar).at(-1);
    expect(Math.abs(Date.parse(summary.stoppedAt) - asked)).toBeLessThan(200);
    expect(summary.alignment).toMatchObject({ method: 'end', endFrom: 'request', durationMs: 3000 });
    expect(summary.alignment.approximate).toBeUndefined();

    // A stop made in OBS: the end is when STOPPING arrived.
    server.mode.delayMs = 0;
    const hisFile = `${asSlashes(dir)}/his.mp4`;
    server.startRecording(hisFile);
    await until(() => r.keeper.status().recording && r.keeper.status().sidecar);
    fs.writeFileSync(hisFile, buildFinalMp4({ durationMs: 2000, withChapterTrack: false }));
    server.stopRecording();
    await until(() => r.keeper.status().lastFiled && /his\.mp4$/.test(r.keeper.status().lastFiled.video), 3000);
    expect(linesOf(r.keeper.status().lastFiled.sidecar).at(-1).alignment).toMatchObject({ method: 'end', endFrom: 'event' });
  } finally { r.dispose(); }
});

test('a chapter OBS refuses because the recording was just paused is not "this file takes no chapters": the next one after the resume is taken; the pause is written down and allowed for', async () => {
  server.state.profile.AdvOut.RecFormat2 = 'hybrid_mp4';
  const r = rig({ inCar: true, payload: RACE_FRAME() });
  try {
    await until(() => r.keeper.status().obs === 'open');
    const started = await r.keeper.record({ source: 'desk' });
    await until(() => r.keeper.status().sidecar && r.keeper.status().sidecar.frames >= 3);
    // OBS is paused and its PAUSED has not reached us yet: the chapter is answered 702, as obs-websocket does.
    server.state.paused = true;
    r.fake.payload = { ...r.fake.payload, 'DataCorePlugin.GameData.CurrentLap': 9 };
    await until(() => server.requests.some((q) => q.type === 'CreateRecordChapter'), 2000);
    await until(() => server.requests.filter((q) => q.type === 'GetRecordStatus').length >= 1, 2000);
    await settle(150);
    expect(r.lines.some((l) => /takes no chapters/.test(l))).toBe(false);
    expect(r.keeper.status().chapters).toBe(0);
    server.state.paused = false;
    r.fake.payload = { ...r.fake.payload, 'DataCorePlugin.GameData.CurrentLap': 10 };
    await until(() => r.keeper.status().chapters === 1, 2000);
    expect(server.state.chapters.map((c) => c.name)).toEqual(['Lap 10']);

    // A pause, the proper way: the events come, and the sidecar says so.
    server.handlers.PauseRecord();
    await until(() => r.keeper.status().paused);
    await settle(250);
    server.handlers.ResumeRecord();
    await until(() => !r.keeper.status().paused);
    await settle(60);
    fs.writeFileSync(started.path, buildFinalMp4({ durationMs: 3000, withChapterTrack: false }));
    await r.keeper.stop();
    await until(() => r.keeper.status().lastFiled, 3000);
    const lines = linesOf(r.keeper.status().lastFiled.sidecar);
    const summary = lines.at(-1);
    expect(summary.markers.map((m) => m.type).filter((t) => /^recording_/.test(t))).toEqual(['recording_paused', 'recording_resumed']);
    // The chapter OBS refused while it was paused is not among the ones it took.
    expect(summary.chapters.map((c) => c.name)).toEqual(['Lap 10']);
    expect(summary.pauses).toHaveLength(1);
    const pause = summary.pauses[0];
    expect(pause.to - pause.from).toBeGreaterThanOrEqual(200);
    expect(summary.alignment).toMatchObject({ method: 'end', approximate: true });
    // The file holds the recording less the pause, so it began that much earlier than its length says.
    const startedAt = Date.parse(lines[0].startedAt);
    const expected = startedAt - (Date.parse(summary.stoppedAt) - 3000 - (pause.to - pause.from));
    expect(Math.abs(summary.videoOffsetMs - expected)).toBeLessThanOrEqual(2);
  } finally { r.dispose(); }
});

test('OBS answers StartRecord and starts nothing: auto-record asks once, says so once, and does not ask again this session; a new session, a reconnect or a stint of his lets it try', async () => {
  const r = rig({ inCar: true, payload: RACE_FRAME(), keeper: { autoRetryMs: 200 } });
  try {
    await until(() => r.keeper.status().obs === 'open');
    server.mode.neverStarts = true;
    await untilFed(r, () => r.lines.some((l) => /not started: OBS didn't start recording/.test(l)), 4000);
    await feedFor(r, 40, 40);   // 1.6 s more under the green flag, with a retry every 200 ms had it not given up
    expect(server.requests.filter((q) => q.type === 'StartRecord')).toHaveLength(1);
    expect(r.notices).toEqual(["OBS didn't start recording"]);
    // A reconnect is something changed: tried again.
    for (const s of server.clients()) s.conn.destroy();
    await until(() => server.identified() === 1 && r.keeper.status().obs === 'open', 3000);
    await untilFed(r, () => server.requests.filter((q) => q.type === 'StartRecord').length === 2, 4000);
    await until(() => r.lines.filter((l) => /not started: OBS didn't start recording/.test(l)).length === 2, 3000);
    // The HUD was told once, for the session, however many tries.
    expect(r.notices).toEqual(["OBS didn't start recording"]);
    // A new session: the green flag counts again, and OBS now starts.
    server.mode.neverStarts = false;
    r.fake.payload = RACE_FRAME({ 'DataCorePlugin.GameRawData.Telemetry.SessionNum': 3 });
    await untilFed(r, () => r.keeper.status().recording, 4000);
    expect(r.keeper.status()).toMatchObject({ owned: true, auto: true });
  } finally { r.dispose(); }
});

test('auto-record with OBS closed never asks tasklist, says "OBS is not open" once a session, and says nothing false when OBS refuses the password', async () => {
  const closed = await startFakeObs({ password: PASSWORD });
  const port = closed.port;
  await closed.close();
  const r = rig({ port, inCar: true, payload: RACE_FRAME(), obsRunning: true, keeper: { autoRetryMs: 100 } });
  try {
    await until(() => r.keeper.status().obs === 'closed');
    await feedFor(r, 40, 40);
    expect(r.fake.obsRunningCalls).toBe(0);
    expect(r.notices).toEqual(['OBS is not open']);
    // A press does ask: tasklist is for presses.
    await r.keeper.record({ source: 'key' });
    expect(r.fake.obsRunningCalls).toBe(1);
    // A new session: the sentence once more, not at every try.
    r.fake.payload = RACE_FRAME({ 'DataCorePlugin.GameRawData.Telemetry.SessionNum': 3 });
    await feedFor(r, 40, 40);
    expect(r.notices.filter((n) => n === 'OBS is not open').length).toBeLessThanOrEqual(2);
    expect(r.fake.obsRunningCalls).toBe(1);
  } finally { r.dispose(); }

  const other = await startFakeObs({ password: 'another-password' });
  const w = rig({ port: other.port, inCar: true, payload: RACE_FRAME(), obsRunning: true, keeper: { autoRetryMs: 100 } });
  try {
    await until(() => w.keeper.status().obs === 'authFailed');
    await feedFor(w, 40, 40);
    expect(w.notices).toEqual([]);
    expect(w.fake.obsRunningCalls).toBe(0);
    expect(w.keeper.status().last).toMatchObject({ ok: false, text: 'OBS refused the password. Type the one from OBS on the Recording card.' });
  } finally { w.dispose(); await other.close(); }
});

test('the telemetry has a gap: auto-record goes on through it with the real in-car signal turning false after three silent seconds, stops when a payload says he is out, and gives up after a minute of silence', async () => {
  const signal = createInCarSignal({ leaveMs: 50, staleMs: 100 });
  const r = rig({ inCar: false, payload: RACE_FRAME(), keeper: { autoRules: createAutoRecord({ debounceMs: 150 }), silentLimitMs: 900 } });
  // main.js hands the payload to the keeper, then to the signal, in that order.
  const pump = (p) => { r.keeper.feed(p); r.fake.inCar = signal.feed(p); };
  const pumpFor = async (n, p) => { for (let i = 0; i < n; i++) { pump(typeof p === 'function' ? p() : p); await settle(40); } };
  try {
    await until(() => r.keeper.status().obs === 'open');
    for (let i = 0; i < 80 && !r.keeper.status().recording; i++) { pump(RACE_FRAME()); await settle(40); }
    expect(r.keeper.status()).toMatchObject({ recording: true, owned: true, auto: true });
    // The host does not answer for 480 ms: the signal says out after 100 ms of it. Nothing stops.
    await pumpFor(12, null);
    expect(signal.inCar()).toBe(false);
    expect(r.keeper.status().recording).toBe(true);
    expect(server.requests.filter((q) => q.type === 'StopRecord')).toHaveLength(0);
    // It answers again, in the car: still recording. Then it says he is out of the car: the stop.
    await pumpFor(5, RACE_FRAME());
    expect(r.keeper.status().recording).toBe(true);
    await pumpFor(30, RACE_FRAME({ 'DataCorePlugin.GameRawData.Telemetry.IsOnTrack': 0 }));
    expect(r.keeper.status().recording).toBe(false);
    expect(r.lines.some((l) => /Auto-record: out of the car, stopping/.test(l))).toBe(true);
    // A start again, and then silence that does not end: after the limit it is out.
    for (let i = 0; i < 80 && !r.keeper.status().recording; i++) { pump(RACE_FRAME()); await settle(40); }
    expect(r.keeper.status().recording).toBe(true);
    await pumpFor(40, null);   // 1.6 s of silence, with a limit of 0.9 s
    expect(r.keeper.status().recording).toBe(false);
  } finally { r.dispose(); }
});

test('a poll that got no answer when a recording begins is not "no sim session": the telemetry is asked again; an answer that says there is no sim is believed at once; a take-over waits for the host', async () => {
  const r = rig({ payload: null, keeper: { liveEveryMs: 30 } });
  try {
    await until(() => r.keeper.status().obs === 'open');
    setTimeout(() => { r.fake.payload = RACE_FRAME(); }, 150);
    await r.keeper.record({ source: 'desk' });
    await until(() => r.keeper.status().sidecar, 3000);
    expect(r.lines.some((l) => /no sim session is live/.test(l))).toBe(false);
    await r.keeper.stop();
    // The host answers that no sim is running: one question, no more.
    r.fake.payload = { 'DataCorePlugin.GameRunning': 0 };
    const asked = r.fake.fetchCalls;
    await r.keeper.record({ source: 'desk' });
    await settle(250);
    expect(r.fake.fetchCalls - asked).toBe(1);
    expect(r.lines.some((l) => /no sim session is live/.test(l))).toBe(true);
    await r.keeper.stop();
  } finally { r.dispose(); }

  // Racing Desk starts with OBS recording, and the host is not up for a moment.
  const mp4 = `${asSlashes(dir)}/running.mp4`;
  server.startRecording(mp4);
  const w = rig({ payload: null, keeper: { liveEveryMs: 30 } });
  try {
    await until(() => w.keeper.status().recording);
    setTimeout(() => { w.fake.payload = RACE_FRAME(); }, 300);
    await until(() => w.keeper.status().sidecar, 3000);
    expect(w.lines.some((l) => /no sim session is live/.test(l))).toBe(false);
  } finally { w.dispose(); }
});

test('a live payload that does not name the car yet is not filed under the demo\'s car', async () => {
  const r = rig({ inCar: true, payload: { ...RACE_FRAME(), 'DataCorePlugin.GameData.CarModel': '', 'RacingDesk.Plugin.Demo.CarModel': 'BMW M4 GT3' } });
  try {
    await until(() => r.keeper.status().obs === 'open');
    await r.keeper.record({ source: 'desk' });
    await until(() => r.keeper.status().filed);
    const folder = r.keeper.status().filed.folder;
    expect(path.basename(folder)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}-\d{2} Zandvoort$/);
    expect(sidecarOf(r.keeper.status().outputPath.replace(/\//g, path.sep))[0]).toMatchObject({ _type: 'header', car: null, track: 'Zandvoort' });
    await r.keeper.stop();
  } finally { r.dispose(); }
});

test('auto-record\'s claim on the STARTED that follows its start is let go when its ten seconds are up: a recording he starts after closing the dialog is his', async () => {
  const r = rig({ inCar: true, payload: RACE_FRAME() });
  try {
    await until(() => r.keeper.status().obs === 'open');
    server.mode.neverStarts = true;
    await untilFed(r, () => r.lines.some((l) => /not started: OBS didn't start recording/.test(l)), 4000);
    server.mode.neverStarts = false;
    server.startRecording();                              // his Ctrl+Space, within the minute
    await until(() => r.keeper.status().recording);
    expect(r.keeper.status()).toMatchObject({ owned: false, auto: false });
    expect(fs.existsSync(stateFileOf())).toBe(false);
  } finally { r.dispose(); }
});

test('a video whose sidecar cannot follow it goes back where OBS wrote it, the problem is said, and no empty folder is left behind', async () => {
  const lockedSidecar = (from) => /telemetry\.jsonl$/.test(String(from));
  const heldFs = { ...fs, renameSync: (from, to) => { if (lockedSidecar(from)) { const e = new Error('held by another program'); e.code = 'EPERM'; throw e; } return fs.renameSync(from, to); } };
  const r = rig({ inCar: true, payload: RACE_FRAME(), fsModule: heldFs });
  try {
    await until(() => r.keeper.status().obs === 'open');
    const started = await r.keeper.record({ source: 'desk' });
    await until(() => r.keeper.status().sidecar && r.keeper.status().sidecar.frames >= 2);
    const folder = r.keeper.status().filed.folder;
    expect(fs.existsSync(folder)).toBe(true);
    fs.writeFileSync(started.path, buildFinalMp4({ durationMs: 2000, withChapterTrack: false }));
    await r.keeper.stop();
    await until(() => r.keeper.status().lastFiled, 5000);
    const filed = r.keeper.status().lastFiled;
    expect(filed.folder).toBeNull();
    expect(filed.why).toMatch(/telemetry could not be moved with the video/);
    expect(fs.existsSync(started.path)).toBe(true);        // the video is where OBS wrote it
    expect(fs.existsSync(started.path.replace(/\.mp4$/, '.telemetry.jsonl'))).toBe(true);   // beside its sidecar
    expect(fs.existsSync(folder)).toBe(false);             // and no folder is left with nothing in it
  } finally { r.dispose(); }

  // A video that cannot be moved at all leaves no empty folder either.
  const lockedVideo = { ...fs, renameSync: (from, to) => { if (/\.mp4$/.test(String(from))) { const e = new Error('held'); e.code = 'EPERM'; throw e; } return fs.renameSync(from, to); } };
  const w = rig({ inCar: true, payload: RACE_FRAME(), fsModule: lockedVideo });
  try {
    await until(() => w.keeper.status().obs === 'open');
    const started = await w.keeper.record({ source: 'desk' });
    await until(() => w.keeper.status().sidecar && w.keeper.status().sidecar.frames >= 2);
    const folder = w.keeper.status().filed.folder;
    fs.writeFileSync(started.path, buildFinalMp4({ durationMs: 2000, withChapterTrack: false }));
    await w.keeper.stop();
    await until(() => w.keeper.status().lastFiled, 5000);
    expect(fs.existsSync(folder)).toBe(false);
    expect(w.keeper.status().lastFiled.folder).toBeNull();
  } finally { w.dispose(); }
});

test('a sidecar gone on in for a recording of his own goes on from the zero its header says, not from the one the take-over works out for itself', async () => {
  const mp4 = `${asSlashes(dir)}/his.mp4`;
  server.startRecording(mp4);
  const a = rig({ inCar: true, payload: RACE_FRAME() });
  let began = 0;
  try {
    await until(() => a.keeper.status().sidecar && a.keeper.status().sidecar.frames >= 3);
    began = Date.parse(sidecarOf(path.join(dir, 'his.mp4'))[0].startedAt);
  } finally { a.dispose(); }
  // OBS's own clock puts the start of the video three seconds before the moment the first run first saw the recording
  // (it could as well be after: the keyframe wait). The take-over would count t from there.
  server.state.startedAt = began - 3000;
  const b = rig({ inCar: true, payload: RACE_FRAME() });
  try {
    await until(() => b.keeper.status().sidecar && b.keeper.status().sidecar.frames >= 2);
    b.keeper.dispose();   // the sidecar's buffered lines, the resumed line among them, are written when it ends
    const lines = sidecarOf(path.join(dir, 'his.mp4'));
    const resumed = lines.find((l) => l._type === 'resumed');
    expect(resumed).toBeTruthy();
    // Resumed a moment after the first run began, by the header's zero: well under the three seconds the other zero adds.
    expect(resumed.t).toBeGreaterThanOrEqual(0);
    expect(resumed.t).toBeLessThan(2);
    expect(lines.filter((l) => l._type === 'header')).toHaveLength(1);
  } finally { b.dispose(); }
});

test("a chapter that never reached OBS is not in the sidecar's list: a request fails, and only what OBS took is paired with the file", async () => {
  server.state.profile.AdvOut.RecFormat2 = 'hybrid_mp4';
  const r = rig({ inCar: true, payload: RACE_FRAME() });
  try {
    await until(() => r.keeper.status().obs === 'open');
    const started = await r.keeper.record({ source: 'desk' });
    await until(() => r.keeper.status().sidecar && r.keeper.status().sidecar.frames >= 3);
    server.fail('CreateRecordChapter', 700, 'The request failed.');
    r.fake.payload = { ...r.fake.payload, 'DataCorePlugin.GameData.CurrentLap': 9 };
    await until(() => server.requests.some((q) => q.type === 'CreateRecordChapter'), 2000);
    await settle(120);
    expect(r.keeper.status().chapters).toBe(0);
    r.fake.payload = { ...r.fake.payload, 'RacingDesk.Plugin.DS.IsInPitLane': 1 };
    await until(() => r.keeper.status().chapters === 1, 2000);
    r.fake.payload = { ...r.fake.payload, 'DataCorePlugin.GameData.CurrentLap': 10 };
    await until(() => r.keeper.status().chapters === 2, 2000);
    const theirs = server.state.chapters.map((c) => ({ ms: c.ms + 120, name: c.name }));
    expect(theirs.map((c) => c.name)).toEqual(['Pit in', 'Lap 10']);
    fs.writeFileSync(started.path, buildFinalMp4({ durationMs: (server.mode.clock() - server.state.startedAt) + 1000, chapters: [{ ms: 0, name: 'Start' }, ...theirs] }));
    await r.keeper.stop();
    await until(() => r.keeper.status().lastFiled, 3000);
    const filed = r.keeper.status().lastFiled;
    expect(linesOf(filed.sidecar).at(-1).chapters.map((c) => c.name)).toEqual(['Pit in', 'Lap 10']);
    expect(filed.alignment).toMatchObject({ method: 'chapters', pairs: 2 });
    expect(filed.alignment.dropped).toBeUndefined();
  } finally { r.dispose(); }
});
