// ═══════════════════════════════════════════════════════════════
// INGEST TESTS — a recording's folder as Racing Desk files it
// ═══════════════════════════════════════════════════════════════

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ingest, isClipName, isTvName } from '../src/ingest/parse-telemetry.js';

const line = (o) => JSON.stringify(o) + '\n';
const header = (extra = {}) => line({ _type: 'header', schemaVersion: 1, startedAt: '2026-09-29T20:13:22.000Z', car: 'Porsche 911 GT3 Cup (992)', track: 'Zandvoort', producer: 'obs', kind: 'recording', ...extra });
const frame = (t, extra = {}) => line({ t, frame: Math.round(t * 30), pos: 5, totalCars: 20, lap: 1, speed: 100, gapAhead: 2, gapBehind: 3, incidents: 0, pit: false, flag: 'green', endOfRace: false, ...extra });
const summary = (extra = {}) => line({ _type: 'summary', frames: 3, durationMs: 1000, markers: [], chapters: [], videoOffsetMs: 250, alignment: { method: 'chapters' }, ...extra });

function folder() {
  const dir = mkdtempSync(join(tmpdir(), 'rd-edit-ingest-'));
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('names: a replay clip is "Replay …", the TV take is "… tv"', () => {
  assert.strictEqual(isClipName('Replay 2026-09-30 21-20-05.mp4'), true);
  assert.strictEqual(isClipName('Replay 2026-09-30 21-20-05.telemetry.jsonl'), true);
  assert.strictEqual(isClipName('2026-09-29 22-13-22.mp4'), false);
  assert.strictEqual(isClipName('D:\\R\\replay.mp4'), true);
  assert.strictEqual(isTvName('2026-09-29 22-13-22 tv.mp4'), true);
  assert.strictEqual(isTvName('2026-09-29 22-13-22 tv.telemetry.jsonl'), true);
  assert.strictEqual(isTvName('2026-09-29 22-13-22.mp4'), false);
  assert.strictEqual(isTvName('tvcar.mp4'), false);
});

test('the header and a resumed line are not frames; the last summary is the file\'s', async () => {
  const { dir, done } = folder();
  try {
    writeFileSync(join(dir, '2026-09-29 22-13-22.telemetry.jsonl'),
      header() + frame(0.033) + frame(0.066) + summary({ reason: 'OBS went away' })
      + line({ _type: 'resumed', schemaVersion: 1, t: 5.1 }) + frame(5.133, { lap: 2 }) + summary({ resumed: true, frames: 1 }));
    const session = await ingest(dir);
    assert.strictEqual(session.frameCount, 3);
    assert.strictEqual(session.startPosition, 5);
    assert.strictEqual(session.totalLaps, 2);
    assert.strictEqual(session.sidecarSummary.resumed, true);
    assert.strictEqual(session.sidecarSummary.videoOffsetMs, 250);
    assert.strictEqual(session.sources.cockpit, null);
  } finally { done(); }
});

test('the recording\'s own sidecar is read, not a replay clip\'s or the TV take\'s; clips are clips and the TV take is the TV view', async () => {
  const { dir, done } = folder();
  try {
    writeFileSync(join(dir, '2026-09-29 22-13-22.telemetry.jsonl'), header() + frame(0.033) + frame(0.066) + frame(0.1) + summary());
    writeFileSync(join(dir, 'Replay 2026-09-30 21-20-05.telemetry.jsonl'), header({ kind: 'replay' }) + frame(0.033, { pos: 9 }) + summary({ frames: 1, reason: 'saved' }));
    writeFileSync(join(dir, '2026-09-29 22-13-22 tv.telemetry.jsonl'), header({ kind: 'tv' }) + frame(0.033, { pos: 8 }) + summary({ frames: 1 }));
    for (const v of ['2026-09-29 22-13-22.mp4', 'Replay 2026-09-30 21-20-05.mp4', '2026-09-29 22-13-22 tv.mp4']) writeFileSync(join(dir, v), 'not a video');
    const session = await ingest(dir);
    assert.strictEqual(session.sidecarFile, '2026-09-29 22-13-22.telemetry.jsonl');
    assert.strictEqual(session.frameCount, 3);
    assert.strictEqual(session.startPosition, 5);
    assert.strictEqual(session.sources.cockpit.file, '2026-09-29 22-13-22.mp4');
    assert.strictEqual(session.sources.tvView.file, '2026-09-29 22-13-22 tv.mp4');
    assert.deepStrictEqual(session.sources.clips.map((c) => c.file), ['Replay 2026-09-30 21-20-05.mp4']);
  } finally { done(); }
});

test('with only a clip\'s sidecar in the folder it is read', async () => {
  const { dir, done } = folder();
  try {
    writeFileSync(join(dir, 'Replay 2026-09-30 21-20-05.telemetry.jsonl'), header({ kind: 'replay' }) + frame(0.033, { pos: 9 }) + summary({ frames: 1, reason: 'saved' }));
    const session = await ingest(dir);
    assert.strictEqual(session.sidecarFile, 'Replay 2026-09-30 21-20-05.telemetry.jsonl');
    assert.strictEqual(session.frameCount, 1);
  } finally { done(); }
});
