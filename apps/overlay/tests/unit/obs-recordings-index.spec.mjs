/**
 * The recordings folder read for the desk and the tray (modules/js/obs/recordings-index.js): one folder per recording
 * with the video, its sidecar, the clips and the take; the recording of a race found by the race's start and track;
 * the latest of all. A temp folder stands in for D:\Racing Desk\Recordings.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const index = require('../../modules/js/obs/recordings-index.js');

let root;
test.beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-recordings-')); });
test.afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

function recordingFolder(name, { startedAt, track, car, video = true, clips = 0, take = false, extra = [] }) {
  const folder = path.join(root, name);
  fs.mkdirSync(folder, { recursive: true });
  const base = '2026-09-29 22-13-22';
  const header = { _type: 'header', schemaVersion: 1, startedAt, car, track, gameId: 'IRacing', isDemo: false, producer: 'obs', kind: 'recording', obsOutputPath: 'x', videoStartUtc: startedAt, videoOffsetMs: 0 };
  fs.writeFileSync(path.join(folder, `${base}.telemetry.jsonl`), `${JSON.stringify(header)}\n{"t":0.033,"frame":0,"sn":2,"st":10}\n{"_type":"summary","frames":1,"markers":[]}\n`);
  if (video) fs.writeFileSync(path.join(folder, `${base}.mp4`), 'video');
  for (let i = 0; i < clips; i++) {
    fs.writeFileSync(path.join(folder, `Replay 2026-09-29 22-2${i}-05.mp4`), 'clip');
    fs.writeFileSync(path.join(folder, `Replay 2026-09-29 22-2${i}-05.telemetry.jsonl`), '{"_type":"header","kind":"replay","startedAt":"2026-09-29T22:20:00Z"}\n');
  }
  if (take) {
    fs.writeFileSync(path.join(folder, `${base} tv.mp4`), 'take');
    fs.writeFileSync(path.join(folder, `${base} tv.telemetry.jsonl`), '{"_type":"header","kind":"tv","startedAt":"2026-09-29T23:20:00Z"}\n');
  }
  for (const f of extra) fs.writeFileSync(path.join(folder, f), '');
  return folder;
}

test('a recording folder is read by its main sidecar: the video beside it, the clips and the take counted apart, the header\'s start, track and car', () => {
  const folder = recordingFolder('2026-09-29 22-13 Circuit Zandvoort Porsche 911 GT3 Cup (992)', { startedAt: '2026-09-29T20:13:22.000Z', track: 'Circuit Zandvoort', car: 'Porsche 911 GT3 Cup (992)', clips: 2, take: true });
  const rec = index.recordingIn(folder, { fs });
  expect(rec).toMatchObject({
    folder, name: '2026-09-29 22-13 Circuit Zandvoort Porsche 911 GT3 Cup (992)',
    sidecar: path.join(folder, '2026-09-29 22-13-22.telemetry.jsonl'), video: path.join(folder, '2026-09-29 22-13-22.mp4'),
    take: path.join(folder, '2026-09-29 22-13-22 tv.mp4'), startedAt: Date.parse('2026-09-29T20:13:22.000Z'),
    track: 'Circuit Zandvoort', car: 'Porsche 911 GT3 Cup (992)', clips: 2,
  });
  // The clips' and the take's sidecars are never taken for the recording's.
  expect(index.isClip('Replay 2026-09-29 22-20-05.telemetry.jsonl')).toBe(true);
  expect(index.isTake('2026-09-29 22-13-22 tv.telemetry.jsonl')).toBe(true);
  expect(index.isTake('2026-09-29 22-13-22.telemetry.jsonl')).toBe(false);
  // A folder with no sidecar, or none at all, is no recording; a sidecar with no video still is (left where OBS wrote it).
  fs.mkdirSync(path.join(root, 'empty'));
  expect(index.recordingIn(path.join(root, 'empty'), { fs })).toBeNull();
  expect(index.recordingIn(path.join(root, 'nowhere'), { fs })).toBeNull();
  const bare = recordingFolder('2026-09-30 10-00 Spa', { startedAt: '2026-09-30T08:00:00Z', track: 'Spa', car: 'x', video: false });
  expect(index.recordingIn(bare, { fs })).toMatchObject({ video: null, track: 'Spa' });
});

test('the folder is listed newest first, the Replays folder and folders with no recording left out; the race\'s recording is found by start and track', () => {
  recordingFolder('2026-09-29 22-13 Circuit Zandvoort Porsche 911 GT3 Cup (992)', { startedAt: '2026-09-29T20:13:22Z', track: 'Circuit Zandvoort', car: 'Porsche' });
  recordingFolder('2026-09-29 20-30 Circuit Zandvoort Porsche 911 GT3 Cup (992)', { startedAt: '2026-09-29T18:30:00Z', track: 'Circuit Zandvoort', car: 'Porsche' });
  recordingFolder('2026-09-28 21-00 Tsukuba Mazda MX-5', { startedAt: '2026-09-28T19:00:00Z', track: 'Tsukuba Circuit', car: 'Mazda MX-5 Cup' });
  fs.mkdirSync(path.join(root, 'Replays'));
  fs.writeFileSync(path.join(root, 'Replays', 'Replay 2026-09-30 21-20-00.mp4'), 'clip');
  fs.mkdirSync(path.join(root, 'odds and ends'));
  fs.writeFileSync(path.join(root, 'loose.mp4'), 'x');
  const list = index.listRecordings(root, { fs });
  expect(list.map((r) => r.name)).toEqual([
    '2026-09-29 22-13 Circuit Zandvoort Porsche 911 GT3 Cup (992)', '2026-09-29 20-30 Circuit Zandvoort Porsche 911 GT3 Cup (992)', '2026-09-28 21-00 Tsukuba Mazda MX-5',
  ]);
  expect(index.latest(list).name).toBe('2026-09-29 22-13 Circuit Zandvoort Porsche 911 GT3 Cup (992)');
  // The race the store has: started 20:15 at Zandvoort (the recording began two minutes before, at the grid).
  expect(index.matchRace(list, { startedAt: '2026-09-29T20:15:00Z', track: 'Zandvoort' }).name).toBe('2026-09-29 22-13 Circuit Zandvoort Porsche 911 GT3 Cup (992)');
  // The store's name and the sim's differ in their words: the same place all the same.
  expect(index.matchRace(list, { startedAt: '2026-09-28T19:05:00Z', track: 'tsukuba 2000 full' }).name).toBe('2026-09-28 21-00 Tsukuba Mazda MX-5');
  // The nearest start wins among the recordings at the track; a race at another track finds nothing, nor one on another day.
  expect(index.matchRace(list, { startedAt: '2026-09-29T18:40:00Z', track: 'Zandvoort' }).name).toBe('2026-09-29 20-30 Circuit Zandvoort Porsche 911 GT3 Cup (992)');
  expect(index.matchRace(list, { startedAt: '2026-09-29T20:15:00Z', track: 'Silverstone' })).toBeNull();
  expect(index.matchRace(list, { startedAt: '2026-10-05T20:15:00Z', track: 'Zandvoort' })).toBeNull();
  expect(index.matchRace(list, { startedAt: 'not a date' })).toBeNull();
  // Without a track, the start alone.
  expect(index.matchRace(list, { startedAt: '2026-09-28T19:10:00Z' }).name).toBe('2026-09-28 21-00 Tsukuba Mazda MX-5');
  // A recording that began more than twenty minutes before the session is not its.
  expect(index.matchRace(list, { startedAt: '2026-09-28T19:30:00Z' })).toBeNull();
  expect(index.listRecordings(path.join(root, 'nowhere'), { fs })).toEqual([]);
  expect(index.latest([])).toBeNull();
});

test('the same track by either name', () => {
  expect(index.sameTrack('Circuit Zandvoort', 'zandvoort')).toBe(true);
  expect(index.sameTrack('Zandvoort', 'Circuit Zandvoort')).toBe(true);
  expect(index.sameTrack('Tsukuba Circuit', 'tsukuba 2000 full')).toBe(true);
  expect(index.sameTrack('Spa-Francorchamps', 'spa 2024 up')).toBe(true);
  expect(index.sameTrack('Circuit Zandvoort', 'Silverstone Circuit')).toBe(false);
  expect(index.sameTrack('', 'Silverstone')).toBe(false);
  expect(index.sameTrack(null, null)).toBe(false);
});
