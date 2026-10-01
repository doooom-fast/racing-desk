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
function rig({ connect = true, freeBytes = 400e9, payload = LIVE, inCar = false, settings = {}, startObs, port, obsRunning = false, lostAfterMs, stateFile } = {}) {
  const lines = [];
  const notices = [];
  const changes = [];
  const fake = {
    free: freeBytes, payload, inCar, settings: { obsStartOnRecord: true, ...settings },
    startObsCalls: 0, obsRunning, freeAsked: [], freeFor: null, profileFolder: null,
  };
  const client = createObsClient({ port: port || server.port, password: () => PASSWORD, retryMs: 40, authRetryMs: 100, connectTimeoutMs: 500, log: (l) => lines.push(l) });
  const keeper = createRecordingKeeper({
    client,
    settings: () => fake.settings,
    recordFolder: () => dir,
    obsFolder: () => fake.profileFolder,
    stateFile: stateFile || path.join(dir, 'state', 'recording-state.json'),
    freeSpace: async (folder) => { fake.freeAsked.push(folder); return fake.freeFor ? fake.freeFor(folder) : fake.free; },
    fetchPayload: async () => fake.payload,
    inCar: () => fake.inCar,
    obsRunning: async () => fake.obsRunning,
    startObs: startObs || (async () => { fake.startObsCalls++; return { ok: true }; }),
    notice: (t) => notices.push(t),
    log: (l) => lines.push(l),
    onChange: (s) => changes.push(s),
    waitStartedMs: 400, waitStoppedMs: 400, waitObsMs: 600, waitSavedMs: 600, quitWaitMs: 300, statusEveryMs: 60, idleFreeEveryMs: 100000, sidecarHz: 100,
    stableMs: 40, stableTimeoutMs: 2000, moveRetryMs: 20, autoRetryMs: 300, replayRetryMs: 300,
    ...(lostAfterMs ? { lostAfterMs } : {}),
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
    expect(Object.keys(s).sort()).toEqual(['auto', 'autoRecord', 'busy', 'bytes', 'bytesPerSecond', 'chapters', 'elapsedMs', 'filed', 'free', 'last', 'lastFiled', 'lowDisk', 'obs', 'obsVersion', 'outputPath', 'owned', 'paused', 'recording', 'replay', 'sidecar', 'startedAt', 'starting', 'stopping']);
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
    expect(server.state.replayBuffer).toBe(false);
    // In the car again, then the switch off: stopped though he is still in the car.
    r.fake.inCar = true;
    await untilFed(r, () => r.keeper.status().replay.running, 2000);
    r.fake.settings.recordingInstantReplay = false;
    await untilFed(r, () => !r.keeper.status().replay.running, 2000);
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
