import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { createRecordingWriter, readRecording, Player, record, startReplayServer, CONTRACT_PATH } from '../src/index.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'prodrive-replay-'));

// Synthetic payloads shaped like the plugin's: flat dotted keys, a few objects, keys that come and go.
function syntheticFrames(n) {
  const frames = [];
  for (let i = 0; i < n; i++) {
    const p = {
      'DataCorePlugin.GameRunning': 1,
      'RaceCorProDrive.Plugin.DemoMode': 0,
      'RaceCorProDrive.Plugin.Grid.SessionState': 2,
      'DataCorePlugin.GameData.SpeedKmh': Math.round(120 + 40 * Math.sin(i / 10)),
      'DataCorePlugin.GameData.Gear': String(3 + (i % 3)),
      'RaceCorProDrive.Plugin.Leaderboard': [{ pos: 1, name: 'A', gap: i % 7 }],
      'RaceCorProDrive.Plugin.TrackMap.SvgPath': 'M0,0L10,10Z',
    };
    if (i % 25 >= 20) p['RaceCorProDrive.Plugin.DS.Transient'] = i;
    frames.push({ t: i * 33, p });
  }
  return frames;
}

async function writeSynthetic(path, frames, keyframeEveryMs = 500) {
  const w = createRecordingWriter(path, { source: 'test', keyframeEveryMs });
  for (const f of frames) w.write(f.t, f.p);
  await w.close();
}

test('writer + player reconstruct every recorded payload exactly', async () => {
  const dir = tmp();
  try {
    const frames = syntheticFrames(200);
    const file = join(dir, 'a.replay.jsonl.gz');
    await writeSynthetic(file, frames);
    const rec = readRecording(file);
    const player = new Player(rec);
    assert.ok(player.keyframes.length > 5, 'expected periodic keyframes');
    // Sequential, then backwards, then random access.
    const order = [...rec.frames.keys(), ...[...rec.frames.keys()].reverse(), 150, 3, 199, 0, 77];
    for (const i of order) {
      const original = frames.find((f) => f.t === rec.frames[i].t).p;
      assert.deepEqual(player.stateAt(i), original, `frame ${i}`);
    }
    // Key order survives, so serialised bodies match the source object's layout.
    assert.deepEqual(Object.keys(player.stateAt(0)), Object.keys(frames[0].p));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('unchanged frames are not written; playback holds the last frame', async () => {
  const dir = tmp();
  try {
    const file = join(dir, 'idle.replay.jsonl.gz');
    const p = { a: 1 };
    const w = createRecordingWriter(file, { keyframeEveryMs: 100000 });
    for (let i = 0; i < 50; i++) w.write(i * 33, { ...p });
    w.write(50 * 33, { a: 2 });
    await w.close();
    const rec = readRecording(file);
    assert.equal(rec.frames.length, 2);
    const player = new Player(rec);
    assert.deepEqual(player.stateAt(player.indexAt(40 * 33)), { a: 1 });
    assert.deepEqual(player.stateAt(player.indexAt(60 * 33)), { a: 2 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a recording cut off mid-write reads back up to its last flushed keyframe', async () => {
  const dir = tmp();
  try {
    const file = join(dir, 'cut.replay.jsonl.gz');
    await writeSynthetic(file, syntheticFrames(300), 200);
    const whole = readRecording(file);
    const buf = readFileSync(file);
    writeFileSync(file, buf.subarray(0, Math.floor(buf.length * 0.6)));
    const cut = readRecording(file);
    assert.ok(cut.frames.length > 10 && cut.frames.length < whole.frames.length, `got ${cut.frames.length} of ${whole.frames.length}`);
    const player = new Player(cut);
    assert.ok(player.stateAt(cut.frames.length - 1)['DataCorePlugin.GameRunning'] === 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rejects files that are not recordings', () => {
  const dir = tmp();
  try {
    const file = join(dir, 'x.replay.jsonl.gz');
    writeFileSync(file, gzipSync('{"format":"something-else"}\n'));
    assert.throws(() => readRecording(file), /not a prodrive-replay recording/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('server speaks the plugin contract and can be pinned to a frame', async () => {
  const dir = tmp();
  const frames = syntheticFrames(120);
  const file = join(dir, 's.replay.jsonl.gz');
  await writeSynthetic(file, frames);
  const replay = await startReplayServer({ recording: readRecording(file), port: 0, paused: true });
  const base = `http://127.0.0.1:${replay.port}`;
  try {
    let body = await (await fetch(`${base}${CONTRACT_PATH}`)).json();
    assert.deepEqual(body, frames[0].p);

    const pinned = await (await fetch(`${base}/__replay/control?frame=90&pause=1`)).json();
    assert.equal(pinned.paused, true);
    const res = await fetch(`${base}${CONTRACT_PATH}`);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.equal(res.headers.get('content-type'), 'application/json');
    body = await res.json();
    const expected = frames.find((f) => f.t === replay.player.frames[90].t).p;
    assert.deepEqual(body, expected);

    assert.deepEqual(await (await fetch(`${base}${CONTRACT_PATH}?action=restartdemo`)).json(), { ok: true });
    const pre = await fetch(`${base}${CONTRACT_PATH}`, { method: 'OPTIONS' });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-private-network'), 'true');
    assert.equal((await fetch(`${base}/elsewhere`)).status, 404);
  } finally {
    await replay.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('server reports a clear error when the port is taken', async () => {
  const blocker = http.createServer().listen(0, '127.0.0.1');
  await new Promise((r) => blocker.once('listening', r));
  const dir = tmp();
  const file = join(dir, 'p.replay.jsonl.gz');
  await writeSynthetic(file, syntheticFrames(5));
  try {
    await assert.rejects(startReplayServer({ recording: readRecording(file), port: blocker.address().port }), /already in use/);
  } finally {
    blocker.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('recorder captures a live source and collapses out-of-car gaps', async () => {
  let n = 0;
  const source = http.createServer((req, res) => {
    n++;
    const inCar = n <= 8 || n > 20; // polls 9..20 are "at the menus"
    const body = JSON.stringify({ 'DataCorePlugin.GameRunning': inCar ? 1 : 0, 'RaceCorProDrive.Plugin.Grid.SessionState': inCar ? 2 : 0, 'RaceCorProDrive.Plugin.DemoMode': 0, n });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(body);
  }).listen(0, '127.0.0.1');
  await new Promise((r) => source.once('listening', r));
  const dir = tmp();
  try {
    const out = join(dir, 'live.replay.jsonl.gz');
    const result = await record({ url: `http://127.0.0.1:${source.address().port}${CONTRACT_PATH}`, out, hz: 50, durationSec: 0.8, onlyInCar: true });
    assert.ok(result.polled >= 25, `polled ${result.polled}`);
    assert.equal(result.skipped, 12);
    const rec = readRecording(out);
    const player = new Player(rec);
    const ns = rec.frames.map((_, i) => player.stateAt(i).n);
    assert.ok(!ns.some((v) => v > 8 && v <= 20), 'out-of-car frames must not be written');
    // The 12-poll gap (~240ms at 50Hz) is collapsed: consecutive in-car frames stay ~one interval apart.
    const i8 = ns.indexOf(8), i21 = ns.indexOf(21);
    assert.ok(rec.frames[i21].t - rec.frames[i8].t < 100, `gap not collapsed: ${rec.frames[i21].t - rec.frames[i8].t}ms`);
  } finally {
    source.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
