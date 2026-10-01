/**
 * The MP4 reader (modules/js/obs/mp4-info.js) over files built in the two layouts OBS's Hybrid MP4 muxer writes
 * (tests/unit/mp4-fixture.mjs): a finished file with its chapter track, a plain one without, one with a 64-bit mdat,
 * and an unfinished one made of fragments — and files that are not MP4s, or are cut short. No ffmpeg, no mdat read.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildFinalMp4, buildFragmentedMp4 } from './mp4-fixture.mjs';

const require = createRequire(import.meta.url);
const { readMp4Info } = require('../../modules/js/obs/mp4-info.js');

let dir;
test.beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-mp4-info-')); });
test.afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
const write = (name, buf) => { const p = path.join(dir, name); fs.writeFileSync(p, buf); return p; };

test('a finished Hybrid MP4: the duration from mvhd and the chapters from the text track, in order, in milliseconds', () => {
  const chapters = [{ ms: 0, name: 'Start' }, { ms: 12345, name: 'Lap 2' }, { ms: 70000, name: 'P5 → P4' }, { ms: 150500, name: 'Pit in' }];
  const file = write('race.mp4', buildFinalMp4({ durationMs: 200000, chapters }));
  const info = readMp4Info(file);
  expect(info).toMatchObject({ layout: 'final', complete: true, durationMs: 200000, video: { trackId: 1, timescale: 60000 } });
  expect(info.chapters).toEqual(chapters);
  expect(info.bytes).toBe(fs.statSync(file).size);
  expect(info.problem).toBeUndefined();
});

test('a plain MP4 (a replay clip, a file from before Set up OBS) has its duration and no chapters; a 64-bit mdat is walked', () => {
  const plain = readMp4Info(write('clip.mp4', buildFinalMp4({ durationMs: 19500, withChapterTrack: false })));
  expect(plain).toMatchObject({ layout: 'final', complete: true, durationMs: 19500, chapters: [] });
  const large = readMp4Info(write('big.mp4', buildFinalMp4({ durationMs: 3600000, chapters: [{ ms: 0, name: 'Start' }, { ms: 1000, name: 'Lap 1' }], large: true })));
  expect(large).toMatchObject({ layout: 'final', durationMs: 3600000 });
  expect(large.chapters).toEqual([{ ms: 0, name: 'Start' }, { ms: 1000, name: 'Lap 1' }]);
  // A text track with no chap reference from the video track is still the chapter track.
  const unref = readMp4Info(write('unref.mp4', buildFinalMp4({ durationMs: 5000, chapters: [{ ms: 0, name: 'Start' }, { ms: 2500, name: 'Incident ×2' }], chapterRef: false })));
  expect(unref.chapters.map((c) => c.name)).toEqual(['Start', 'Incident ×2']);
});

test('an unfinished Hybrid MP4: the duration is the video track\'s fragments added up, with no chapters (they are written only at the end)', () => {
  const byDefault = readMp4Info(write('crash.mp4', buildFragmentedMp4({ fragments: [{ samples: 60, sampleDuration: 1000 }, { samples: 60, sampleDuration: 1000 }, { samples: 30, sampleDuration: 1000 }] })));
  expect(byDefault).toMatchObject({ layout: 'fragmented', complete: false, durationMs: 2500, chapters: [], video: { trackId: 1, timescale: 60000 } });
  const perSample = readMp4Info(write('crash2.mp4', buildFragmentedMp4({ fragments: [{ samples: 120, sampleDuration: 1000 }, { samples: 7, sampleDuration: 1000 }], perSample: true })));
  expect(perSample).toMatchObject({ layout: 'fragmented', durationMs: Math.round((127000 / 60000) * 1000) });
  // Cut off in the middle of a fragment: what is whole counts.
  const whole = buildFragmentedMp4({ fragments: [{ samples: 60, sampleDuration: 1000 }, { samples: 60, sampleDuration: 1000 }] });
  const cut = readMp4Info(write('cut.mp4', whole.subarray(0, whole.length - 500)));
  expect(cut).toMatchObject({ layout: 'fragmented', durationMs: 1000 });
});

test('what is not an MP4, or is cut short before its moov, is said so and never thrown', () => {
  expect(readMp4Info(path.join(dir, 'missing.mp4'))).toMatchObject({ layout: 'none', complete: false, durationMs: null, chapters: [] });
  expect(readMp4Info(path.join(dir, 'missing.mp4')).problem).toMatch(/could not be opened/);
  expect(readMp4Info(write('text.mp4', Buffer.from('not a video at all')))).toMatchObject({ layout: 'none' });
  expect(readMp4Info(write('empty.mp4', Buffer.alloc(0)))).toMatchObject({ layout: 'none' });
  const whole = buildFinalMp4({ durationMs: 1000, chapters: [{ ms: 0, name: 'Start' }] });
  const short = readMp4Info(write('short.mp4', whole.subarray(0, whole.length - 40)));
  expect(short).toMatchObject({ layout: 'none', complete: false });
  expect(short.problem).toMatch(/cut short/);
});
