/**
 * The real rate of his recordings (modules/js/obs/recording-rate.js): the newest few in the recordings folder, each
 * video's size over its duration as the file's own boxes say it, pooled; nothing until there is one. A temp folder
 * stands in for D:\Racing Desk\Recordings, and the videos are the small MP4s the fixture builds.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildFinalMp4, buildFragmentedMp4 } from './mp4-fixture.mjs';

const require = createRequire(import.meta.url);
const { measureRate, NEWEST, MIN_SECONDS } = require('../../modules/js/obs/recording-rate.js');

let root;
test.beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-recording-rate-')); });
test.afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

// A recording folder as filing.js makes it: the sidecar with its header, and the video padded to `bytes` with a free
// box at the end (the reader walks the top-level boxes and takes the length from the moov, so the padding is any size).
function recording(name, { startedAt, durationMs, bytes, video = true, unfinished = false, ext = '.mp4', notMp4 = false }) {
  const folder = path.join(root, name);
  fs.mkdirSync(folder, { recursive: true });
  const base = '2026-09-29 22-13-22';
  const header = { _type: 'header', schemaVersion: 1, startedAt, car: 'Porsche', track: 'Zandvoort', gameId: 'IRacing', isDemo: false, producer: 'obs', kind: 'recording' };
  fs.writeFileSync(path.join(folder, `${base}.telemetry.jsonl`), `${JSON.stringify(header)}\n{"_type":"summary","frames":1,"markers":[]}\n`);
  if (!video) return folder;
  const file = path.join(folder, `${base}${ext}`);
  if (notMp4) {
    // A Matroska file: its EBML header, then noise. The reader goes by boxes, not names, and finds no ftyp.
    fs.writeFileSync(file, Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(bytes - 4, 0x5a)]));
    return folder;
  }
  const body = unfinished
    ? buildFragmentedMp4({ fragments: [{ samples: Math.round(durationMs / 1000) * 60, sampleDuration: 1000 }] })
    : buildFinalMp4({ durationMs, withChapterTrack: false });
  const pad = Math.max(0, bytes - body.length - 8);
  const free = Buffer.concat([Buffer.alloc(4), Buffer.from('free', 'latin1'), Buffer.alloc(pad)]);
  free.writeUInt32BE(8 + pad, 0);
  fs.writeFileSync(file, Buffer.concat([body, free]));
  expect(fs.statSync(file).size).toBe(bytes);
  return folder;
}

test('the rate is the pooled size over duration of the newest recordings, in bytes a second and GB an hour', () => {
  // 20 minutes at 30 MB and 10 minutes at 10 MB: 40 MB over 30 minutes (small files; the arithmetic is the point).
  recording('2026-09-29 22-13 Zandvoort Porsche', { startedAt: '2026-09-29T20:13:22Z', durationMs: 20 * 60000, bytes: 30e6 });
  recording('2026-09-29 20-30 Zandvoort Porsche', { startedAt: '2026-09-29T18:30:00Z', durationMs: 10 * 60000, bytes: 10e6 });
  const rate = measureRate(root, { fs });
  expect(rate.recordings).toBe(2);
  expect(rate.bytes).toBe(40e6);
  expect(rate.seconds).toBe(1800);
  expect(rate.bytesPerSecond).toBeCloseTo(40e6 / 1800, 6);
  expect(rate.gbPerHour).toBeCloseTo(0.08, 6);
  expect(rate.used.map((u) => path.basename(path.dirname(u.video)))).toEqual(['2026-09-29 22-13 Zandvoort Porsche', '2026-09-29 20-30 Zandvoort Porsche']);
  expect(rate.used.every((u) => u.complete)).toBe(true);
  // A race's numbers, through a reader and a disk that are handed in: 18 GB over an hour is 5 MB/s.
  const big = measureRate(root, {
    fs: { readdirSync: fs.readdirSync, statSync: () => ({ size: 18e9, isDirectory: () => true }), openSync: fs.openSync, fstatSync: fs.fstatSync, readSync: fs.readSync, closeSync: fs.closeSync },
    readMp4: () => ({ durationMs: 3600000, complete: true }),
    newest: 1,
  });
  expect(big).toMatchObject({ recordings: 1, bytesPerSecond: 5e6, gbPerHour: 18 });
});

test('nothing to measure says so: no folder, no recording, a recording with no video, one too short, one that is not an MP4', () => {
  expect(measureRate(path.join(root, 'nowhere'), { fs })).toBeNull();
  expect(measureRate('', { fs })).toBeNull();
  expect(measureRate(root, { fs })).toBeNull();
  recording('2026-09-28 21-00 Tsukuba', { startedAt: '2026-09-28T19:00:00Z', durationMs: 60000, bytes: 1e6, video: false });
  expect(measureRate(root, { fs })).toBeNull();
  // A mis-press ten seconds long says nothing of a race.
  recording('2026-09-28 21-10 Tsukuba', { startedAt: '2026-09-28T19:10:00Z', durationMs: 10000, bytes: 1e6 });
  expect(measureRate(root, { fs })).toBeNull();
  expect(MIN_SECONDS).toBe(30);
  // An .mkv (a profile not set up to Hybrid MP4), whose length the reader cannot find.
  recording('2026-09-28 21-20 Tsukuba', { startedAt: '2026-09-28T19:20:00Z', durationMs: 60000, bytes: 1e6, ext: '.mkv', notMp4: true });
  expect(measureRate(root, { fs })).toBeNull();
  // Then one that counts.
  recording('2026-09-28 21-30 Tsukuba', { startedAt: '2026-09-28T19:30:00Z', durationMs: 60000, bytes: 6e6 });
  expect(measureRate(root, { fs })).toMatchObject({ recordings: 1, bytesPerSecond: 1e5 });
});

test('only the recordings begun since the encoder settings changed count: the first race with the quality target is not averaged with fixed-bitrate ones', () => {
  // Four recordings at a fixed bitrate (7.5 MB a minute here, standing for the 45 GB an hour of 100 Mbps with its filler data) before the file changed at noon on the 30th ...
  for (let i = 1; i <= 4; i++) {
    recording(`2026-09-2${i} 21-00 Spa`, { startedAt: `2026-09-2${i}T19:00:00Z`, durationMs: 60000, bytes: 7.5e6 });
  }
  const since = Date.parse('2026-09-30T12:00:00Z');
  // ... none made since: nothing to measure (the card then says nothing of size), where without `since` they are the rate.
  expect(measureRate(root, { fs, since })).toBeNull();
  expect(measureRate(root, { fs })).toMatchObject({ recordings: 4, bytesPerSecond: 1.25e5 });
  // The first recording with the quality target: 3 MB a minute, alone, not pooled with the four (which would say 110 kB/s).
  recording('2026-09-30 21-00 Spa', { startedAt: '2026-09-30T19:00:00Z', durationMs: 60000, bytes: 3e6 });
  const first = measureRate(root, { fs, since });
  expect(first).toMatchObject({ recordings: 1, bytesPerSecond: 5e4 });
  expect(measureRate(root, { fs }).recordings).toBe(5);
  // One begun exactly when the file was written counts; one a moment before does not.
  recording('2026-09-30 12-00 Spa', { startedAt: '2026-09-30T12:00:00Z', durationMs: 60000, bytes: 3.6e6 });
  recording('2026-09-30 11-59 Spa', { startedAt: '2026-09-30T11:59:59Z', durationMs: 60000, bytes: 7.5e6 });
  const edge = measureRate(root, { fs, since });
  expect(edge.recordings).toBe(2);
  expect(edge.used.map((u) => path.basename(path.dirname(u.video)))).toEqual(['2026-09-30 21-00 Spa', '2026-09-30 12-00 Spa']);
  // A recording whose sidecar does not say when it began cannot be placed after the change, so it is left out.
  const noStart = recording('2026-10-01 09-00 Spa', { startedAt: 'not a time', durationMs: 60000, bytes: 7.5e6 });
  expect(fs.existsSync(noStart)).toBe(true);
  expect(measureRate(root, { fs, since }).recordings).toBe(2);
  // A `since` that is not a number is no filter.
  expect(measureRate(root, { fs, since: null }).recordings).toBe(5);
  expect(measureRate(root, { fs, since: NaN }).recordings).toBe(5);
});

test('only the newest few count, and an unfinished Hybrid MP4 counts by the length its fragments reach', () => {
  expect(NEWEST).toBe(5);
  for (let i = 0; i < 7; i++) {
    // The oldest two are far bigger: left out, they do not move the rate.
    recording(`2026-09-2${i} 21-00 Spa`, { startedAt: `2026-09-2${i}T19:00:00Z`, durationMs: 60000, bytes: i < 2 ? 20e6 : 6e6 });
  }
  const rate = measureRate(root, { fs });
  expect(rate.recordings).toBe(5);
  expect(rate.bytesPerSecond).toBeCloseTo(1e5, 6);
  expect(rate.used.map((u) => path.basename(path.dirname(u.video)))).toEqual(['2026-09-26 21-00 Spa', '2026-09-25 21-00 Spa', '2026-09-24 21-00 Spa', '2026-09-23 21-00 Spa', '2026-09-22 21-00 Spa']);
  expect(measureRate(root, { fs, newest: 2 }).recordings).toBe(2);
  // OBS crashed on the newest: a fragmented file a minute long, counted all the same, marked not complete.
  recording('2026-09-30 21-00 Spa', { startedAt: '2026-09-30T19:00:00Z', durationMs: 60000, bytes: 12e6, unfinished: true });
  const withCrash = measureRate(root, { fs, newest: 1 });
  expect(withCrash).toMatchObject({ recordings: 1, bytesPerSecond: 2e5 });
  expect(withCrash.used[0].complete).toBe(false);
});
