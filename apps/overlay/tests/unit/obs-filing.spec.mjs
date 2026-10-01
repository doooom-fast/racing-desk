/**
 * Where a recording's files go and how the telemetry is lined up with the video (modules/js/obs/filing.js): the
 * folder's name, the wait for a file to hold still, the move that is a rename on one drive and nothing across two,
 * the offset from the chapters read back and from the file's end, and the words of each chapter.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const filing = require('../../modules/js/obs/filing.js');

let dir;
test.beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-obs-filing-')); });
test.afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

test('the folder is the date, the track and the car, as a folder can hold them; the date alone where the sim did not say', () => {
  const at = new Date(2026, 8, 29, 22, 13, 22).getTime();
  expect(filing.folderDate(at)).toBe('2026-09-29 22-13');
  expect(filing.folderNameFor({ startedAt: at, track: 'Zandvoort', car: 'Porsche 911 GT3 Cup (992)' })).toBe('2026-09-29 22-13 Zandvoort Porsche 911 GT3 Cup (992)');
  expect(filing.folderNameFor({ startedAt: at })).toBe('2026-09-29 22-13');
  expect(filing.folderNameFor({ startedAt: at, track: '  ', car: null })).toBe('2026-09-29 22-13');
  expect(filing.folderPart('tsukuba 2000full')).toBe('tsukuba 2000full');
  expect(filing.folderPart('Spa: "Francorchamps" <GP>/2024?*|\\')).toBe('Spa Francorchamps GP 2024');
  expect(filing.folderPart('Ends with dots...')).toBe('Ends with dots');
  expect(filing.folderPart('x'.repeat(100))).toHaveLength(60);
  expect(filing.folderPart(42)).toBe('');
});

test('drives: a rename stays on one; a move across two is refused and copies nothing', async () => {
  expect(filing.driveOf('D:\\Racing Desk\\Recordings\\a.mp4')).toBe('d:');
  expect(filing.driveOf('c:/Users/x/Videos/NVIDIA/a.mp4')).toBe('c:');
  expect(filing.driveOf('\\\\nas\\share\\a.mp4')).toBe('\\\\nas\\share');
  expect(filing.driveOf('relative/a.mp4')).toBe('');
  expect(filing.sameDrive('D:/a', 'd:\\b')).toBe(true);
  expect(filing.sameDrive('C:/a', 'D:/b')).toBe(false);
  expect(filing.sameDrive('a', 'b')).toBe(false);
  const from = path.join(dir, 'from.mp4');
  fs.writeFileSync(from, 'video');
  const refused = await filing.moveFile(from, path.join(filing.driveOf(dir) === 'z:' ? 'Y:\\' : 'Z:\\', 'elsewhere', 'from.mp4'), { setTimer: (f) => f() });
  expect(refused.ok).toBe(false);
  expect(refused.why).toMatch(/different drives/);
  expect(fs.existsSync(from)).toBe(true);
});

test('the move: into a folder made on the way, tried again while the file is held, given up on anything else', async () => {
  const from = path.join(dir, 'a.mp4');
  fs.writeFileSync(from, 'video');
  const to = path.join(dir, 'race', 'a.mp4');
  const moved = await filing.moveFile(from, to, { setTimer: (f) => f() });
  expect(moved).toEqual({ ok: true, to });
  expect(fs.readFileSync(to, 'utf8')).toBe('video');
  expect(fs.existsSync(from)).toBe(false);
  // Held for two tries, then let go.
  let held = 2;
  const fakeFs = { mkdirSync: fs.mkdirSync, renameSync: (a, b) => { if (held-- > 0) { const e = new Error('busy'); e.code = 'EBUSY'; throw e; } fs.renameSync(a, b); } };
  fs.writeFileSync(from, 'again');
  const waits = [];
  const later = await filing.moveFile(from, path.join(dir, 'race', 'b.mp4'), { fs: fakeFs, setTimer: (f, ms) => { waits.push(ms); f(); }, retryMs: 7 });
  expect(later.ok).toBe(true);
  expect(waits).toEqual([7, 7]);
  // Held for good: given up after the tries, said in words.
  const stuck = { mkdirSync: fs.mkdirSync, renameSync: () => { const e = new Error('held'); e.code = 'EPERM'; throw e; } };
  fs.writeFileSync(from, 'stuck');
  const gaveUp = await filing.moveFile(from, path.join(dir, 'race', 'c.mp4'), { fs: stuck, setTimer: (f) => f(), tries: 3 });
  expect(gaveUp.ok).toBe(false);
  expect(gaveUp.why).toMatch(/EPERM held/);
  // Something other than a held file is not tried again.
  let calls = 0;
  const broken = { mkdirSync: fs.mkdirSync, renameSync: () => { calls++; const e = new Error('no such file'); e.code = 'ENOENT'; throw e; } };
  const once = await filing.moveFile(from, path.join(dir, 'race', 'd.mp4'), { fs: broken, setTimer: (f) => f() });
  expect(once.ok).toBe(false);
  expect(calls).toBe(1);
  // A name taken is made unique.
  expect(filing.uniquePath(to)).toBe(path.join(dir, 'race', 'a (2).mp4'));
  expect(filing.uniquePath(path.join(dir, 'race', 'new.mp4'))).toBe(path.join(dir, 'race', 'new.mp4'));
});

test('a file is waited for until its size holds still, and given up on after the timeout or when it is not there', async () => {
  const file = path.join(dir, 'growing.mp4');
  fs.writeFileSync(file, 'a');
  let clock = 0;
  const timers = [];
  const setTimer = (f, ms) => { timers.push({ f, ms }); return { unref() {} }; };
  const waiting = filing.waitForStableFile(file, { setTimer, now: () => clock, stableMs: 2000, pollMs: 500, timeoutMs: 10000 });
  // Grows for a while.
  for (let i = 0; i < 3; i++) { clock += 500; fs.appendFileSync(file, 'a'); timers.shift().f(); }
  // Then holds still: 2 s of unchanged size.
  for (let i = 0; i < 4; i++) { clock += 500; timers.shift().f(); }
  expect(await waiting).toEqual({ ok: true, size: 4 });
  // Never holds still: the timeout.
  const restless = filing.waitForStableFile(file, { setTimer, now: () => clock, stableMs: 2000, pollMs: 500, timeoutMs: 3000 });
  const began = clock;
  while (clock - began < 3000) { clock += 500; fs.appendFileSync(file, 'a'); timers.shift().f(); }
  expect(await restless).toMatchObject({ ok: false, why: 'the file kept changing' });
  expect(await filing.waitForStableFile(path.join(dir, 'nope.mp4'), { setTimer, now: () => clock })).toMatchObject({ ok: false, why: 'the file is not there' });
});

test('the offset from the chapters: paired in order by name, OBS\'s own Start stepped over, the median taken', () => {
  const ours = [{ name: 'Lap 2', t: 61000 }, { name: 'P5 → P4', t: 90000 }, { name: 'Pit in', t: 300000 }, { name: 'Pit out', t: 330000 }];
  const theirs = [{ name: 'Start', ms: 0 }, { name: 'Lap 2', ms: 63250 }, { name: 'P5 → P4', ms: 92240 }, { name: 'Pit in', ms: 302260 }, { name: 'Pit out', ms: 332250 }];
  expect(filing.alignFromChapters(ours, theirs)).toEqual({ videoOffsetMs: 2250, method: 'chapters', pairs: 4, spreadMs: 20 });
  // A chapter of ours OBS did not take (the recording was paused) is skipped; one of theirs we did not send is stepped over.
  expect(filing.alignFromChapters([{ name: 'Lap 2', t: 1000 }, { name: 'Lap 3', t: 2000 }, { name: 'Lap 4', t: 3000 }], [{ name: 'Start', ms: 0 }, { name: 'Lap 2', ms: 1500 }, { name: 'Unnamed 2', ms: 1800 }, { name: 'Lap 4', ms: 3500 }])).toEqual({ videoOffsetMs: 500, method: 'chapters', pairs: 2, spreadMs: 0 });
  // The same name twice is paired in order.
  expect(filing.alignFromChapters([{ name: 'Pit in', t: 100 }, { name: 'Pit in', t: 5000 }], [{ name: 'Pit in', ms: 200 }, { name: 'Pit in', ms: 5100 }])).toMatchObject({ videoOffsetMs: 100, pairs: 2 });
  // Nothing in common: null; so is nothing at all.
  expect(filing.alignFromChapters([{ name: 'Lap 2', t: 1 }], [{ name: 'Start', ms: 0 }])).toBeNull();
  expect(filing.alignFromChapters([], [{ name: 'Start', ms: 0 }])).toBeNull();
  expect(filing.alignFromChapters(null, null)).toBeNull();
  // An even count: the two middle values' mean.
  expect(filing.alignFromChapters([{ name: 'a', t: 0 }, { name: 'b', t: 0 }], [{ name: 'a', ms: 100 }, { name: 'b', ms: 301 }]).videoOffsetMs).toBe(201);
});

test('a chapter of ours the file does not have, with a name that comes again, takes the place of no other chapter: the offset is still the real one', () => {
  // The WebSocket dropped for a moment: a "Pit in" was found and written down but never reached OBS. The file's offset
  // is -4000 ms (its chapters are 4 s earlier than ours). Pairing by name going forward put the lost "Pit in" with the
  // later one, then lost every pair after it, and answered 346000 ms as if it were the tightest kind of alignment.
  const ours = [
    { name: 'Lap 3', t: 60000 }, { name: 'Pit in', t: 100000 }, { name: 'Lap 4', t: 120000 }, { name: 'Pit out', t: 130000 },
    { name: 'Lap 5', t: 180000 }, { name: 'Lap 6', t: 240000 }, { name: 'Pit in', t: 300000 }, { name: 'Pit out', t: 310000 }, { name: 'Lap 7', t: 360000 },
  ];
  const theirs = [
    { name: 'Start', ms: 0 }, { name: 'Lap 3', ms: 56000 }, { name: 'Lap 4', ms: 116000 }, { name: 'Pit out', ms: 126000 },
    { name: 'Lap 5', ms: 176000 }, { name: 'Lap 6', ms: 236000 }, { name: 'Pit in', ms: 296000 }, { name: 'Pit out', ms: 306000 }, { name: 'Lap 7', ms: 356000 },
  ];
  const found = filing.alignFromChapters(ours, theirs);
  expect(found).toMatchObject({ videoOffsetMs: -4000, method: 'chapters', spreadMs: 0 });
  expect(found.pairs).toBe(8);   // every chapter that is in both: the lost one is not paired with anything
  // The same with nothing to anchor on but repeated names (a race of pit stops only): the nearest pairs are made first,
  // so the first stop's lost chapters do not take the second stop's.
  const repeated = filing.alignFromChapters(
    [{ name: 'Pit in', t: 1000 }, { name: 'Pit out', t: 2000 }, { name: 'Pit in', t: 9000 }, { name: 'Pit out', t: 10000 }],
    [{ name: 'Pit in', ms: 9500 }, { name: 'Pit out', ms: 10500 }],
  );
  expect(repeated).toMatchObject({ videoOffsetMs: 500, pairs: 2 });
  // Pairs that cannot agree are not an alignment: the caller lines the file up from its end.
  expect(filing.alignFromChapters([{ name: 'a', t: 0 }, { name: 'b', t: 0 }], [{ name: 'a', ms: 100 }, { name: 'b', ms: 60000 }])).toBeNull();
  // A pair that strays is dropped and counted: three stops, the third of which the file has only as a far later one.
  const strays = filing.alignFromChapters(
    [{ name: 'Pit in', t: 1000 }, { name: 'Pit in', t: 2000 }, { name: 'Pit in', t: 3000 }],
    [{ name: 'Pit in', ms: 1100 }, { name: 'Pit in', ms: 2100 }, { name: 'Pit in', ms: 9100 }],
  );
  expect(strays).toMatchObject({ videoOffsetMs: 100, pairs: 2, dropped: 1 });
  // With names that agree on an offset, a chapter the file has only far from where it belongs is left unpaired.
  expect(filing.alignFromChapters(
    [{ name: 'Lap 1', t: 0 }, { name: 'Lap 2', t: 1000 }, { name: 'Lap 3', t: 2000 }, { name: 'Pit in', t: 2500 }],
    [{ name: 'Lap 1', ms: 100 }, { name: 'Lap 2', ms: 1100 }, { name: 'Lap 3', ms: 2100 }, { name: 'Pit in', ms: 4100 }],
  )).toMatchObject({ videoOffsetMs: 100, pairs: 3 });
});

test('a recording that was paused: the clock of the file stood still, so the pauses are taken out of ours before the chapters are paired, and put back for the end', () => {
  expect(filing.pausedBefore([{ from: 100000, to: 160000 }], 50000)).toBe(0);
  expect(filing.pausedBefore([{ from: 100000, to: 160000 }], 130000)).toBe(30000);
  expect(filing.pausedBefore([{ from: 100000, to: 160000 }, { from: 200000, to: null }], 300000)).toBe(60000 + 100000);
  expect(filing.pausedBefore(null, 1)).toBe(0);
  const pauses = [{ from: 100000, to: 160000 }];
  // Offset 2000 ms; the chapters after the pause are a minute earlier in the file than their t says.
  const ours = [{ name: 'Lap 2', t: 50000 }, { name: 'Lap 3', t: 200000 }, { name: 'Lap 4', t: 260000 }];
  const theirs = [{ name: 'Start', ms: 0 }, { name: 'Lap 2', ms: 52000 }, { name: 'Lap 3', ms: 142000 }, { name: 'Lap 4', ms: 202000 }];
  expect(filing.alignFromChapters(ours, theirs, { pauses })).toMatchObject({ videoOffsetMs: 2000, pairs: 3, spreadMs: 0 });
  // Without the pause taken out the chapters after it say a minute less, and the majority wins: not the offset.
  expect(filing.alignFromChapters(ours, theirs).videoOffsetMs).not.toBe(2000);
  // From the end: the file holds the recording less its pauses, so it began a minute earlier than its length says.
  const startedAt = 1_700_000_000_000;
  const end = filing.alignFromEnd({ startedAt, endedAt: startedAt + 300000, durationMs: 238000, pauses });
  expect(end).toMatchObject({ videoOffsetMs: -2000 + 0, method: 'end', approximate: true });
  expect(end.videoStartUtc).toBe(new Date(startedAt + 2000).toISOString());
  expect(filing.alignFromEnd({ startedAt, endedAt: startedAt + 300000, durationMs: 300000, endFrom: 'request' })).toMatchObject({ videoOffsetMs: 0, endFrom: 'request' });
});

test('the offset from the end: the file began at its end less its duration', () => {
  const startedAt = 1_700_000_000_000;      // STARTED arrived
  const endedAt = startedAt + 600_000;      // STOPPED arrived ten minutes later
  const durationMs = 596_500;               // the file holds 596.5 s: it began 3.5 s after STARTED
  expect(filing.alignFromEnd({ startedAt, endedAt, durationMs })).toEqual({ videoOffsetMs: -3500, method: 'end', videoStartUtc: new Date(startedAt + 3500).toISOString(), durationMs: 596500 });
  expect(filing.alignFromEnd({ startedAt, endedAt, durationMs, approximate: true })).toMatchObject({ approximate: true });
  expect(filing.alignFromEnd({ startedAt, endedAt, durationMs: null })).toBeNull();
});

test('the words of each chapter', () => {
  expect(filing.chapterNameFor({ type: 'new_lap', lap: 12 })).toBe('Lap 12');
  expect(filing.chapterNameFor({ type: 'incident', from: 2, to: 4 })).toBe('Incident ×2');
  expect(filing.chapterNameFor({ type: 'incident', from: 0, to: 1 })).toBe('Incident ×1');
  expect(filing.chapterNameFor({ type: 'pit_entry' })).toBe('Pit in');
  expect(filing.chapterNameFor({ type: 'pit_exit' })).toBe('Pit out');
  expect(filing.chapterNameFor({ type: 'position_change', from: 5, to: 4, direction: 'gained' })).toBe('P5 → P4');
  expect(filing.chapterNameFor({ type: 'position_change', from: 4, to: 6, direction: 'lost' })).toBeNull();
  expect(filing.chapterNameFor({ type: 'file_changed', path: 'x' })).toBeNull();
  expect(filing.chapterNameFor(null)).toBeNull();
});
