// ═══════════════════════════════════════════════════════════════
// SIDECAR VALUES TESTS — frames as the sidecar writes them: 0 for a
// number it did not have, `none` for no flag word, the cool-down
// after the flag. Shaped on his 2026-10-27 Zandvoort race and his
// 2026-10-07 Road Atlanta race (whose numbers are in the comments).
// ═══════════════════════════════════════════════════════════════

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { knownGap, knownPosition, isNoFlag, isCaution, finishTime, raceStartTime } from '../src/ingest/frame-values.js';
import { detectEvents } from '../src/ingest/detect-events.js';
import { scoreFrames, applyCameraHysteresis } from '../src/analyze/scoring-engine.js';
import { buildMechanicalEDL } from '../src/analyze/edl-generator.js';
import { ingest } from '../src/ingest/parse-telemetry.js';

/** A frame as telemetry-sidecar.js writes one: what the payload did not have is 0, or `none` for the flag. */
const frame = (t, extra = {}) => ({
  t, frame: Math.round(t * 30), pos: 8, totalCars: 9, gapAhead: 0, gapBehind: 0, lap: 3, speed: 120, brake: 0,
  incidents: 0, flag: 'none', pit: false, sessionState: 4, endOfRace: false, ...extra,
});

/** Every half second from `from` to `to`. */
const span = (from, to, extra = {}) => {
  const out = [];
  for (let t = from; t <= to + 1e-9; t += 0.5) out.push(frame(+t.toFixed(3), typeof extra === 'function' ? extra(t) : extra));
  return out;
};

test('the values: 0 is no gap and no position, -1 is no position, `none` is no flag', () => {
  assert.strictEqual(knownGap(0), null);
  assert.strictEqual(knownGap(-0.4), null);
  assert.strictEqual(knownGap(undefined), null);
  assert.strictEqual(knownGap(Infinity), null);
  assert.strictEqual(knownGap(0.003), 0.003);
  assert.strictEqual(knownPosition(-1), null);
  assert.strictEqual(knownPosition(0), null);
  assert.strictEqual(knownPosition(8), 8);
  for (const f of ['none', 'green', '', undefined]) assert.strictEqual(isNoFlag(f), true);
  for (const f of ['debris', 'blue', 'white', 'yellow']) assert.strictEqual(isNoFlag(f), false);
  assert.deepStrictEqual(['yellow', 'red', 'debris', 'blue', 'white', 'none'].map(isCaution), [true, true, false, false, false, false]);
  assert.strictEqual(finishTime([frame(1), frame(2, { endOfRace: true }), frame(3, { endOfRace: true })]), 2);
  assert.strictEqual(finishTime([frame(1)]), null);
  assert.strictEqual(raceStartTime([frame(0, { lap: 0 }), frame(2.6, { lap: 1 }), frame(90, { lap: 2 })]), 2.6);
  assert.strictEqual(raceStartTime([frame(0, { lap: 1 })]), 0);
  assert.strictEqual(raceStartTime([frame(0, { lap: 3 }), frame(1, { lap: 1 })]), null);
});

test('a gap of 0 behind in every frame is no car behind: no battle, no TV view, and clean air', () => {
  // Zandvoort: the gap behind was 0 in all 36,748 frames, the gap ahead 3 s or more, the flag `none`.
  const frames = span(0, 120, { gapAhead: 4.2 });
  assert.deepStrictEqual(detectEvents(frames).filter((e) => e.event === 'close_battle'), []);
  const scores = scoreFrames(frames, []);
  assert.ok(scores.every((s) => s.tvScore === 0), 'nothing here is a reason for the TV view');
  assert.deepStrictEqual(applyCameraHysteresis(scores).map((s) => s.source), ['cockpit']);
  const close = scoreFrames(span(0, 10, { gapAhead: 0.5 }), []);
  assert.ok(close[5].tvScore >= 40, 'a car 0.5 s ahead still is');
});

test('the flag `none` scores as green, a caution as a caution', () => {
  const none = scoreFrames(span(0, 5, { gapAhead: 2, gapBehind: 2, flag: 'none' }), []);
  const green = scoreFrames(span(0, 5, { gapAhead: 2, gapBehind: 2, flag: 'green' }), []);
  const debris = scoreFrames(span(0, 5, { gapAhead: 2, gapBehind: 2, flag: 'debris' }), []);
  const yellow = scoreFrames(span(0, 5, { gapAhead: 2, gapBehind: 2, flag: 'yellow' }), []);
  assert.deepStrictEqual(none, green);
  assert.deepStrictEqual(debris, green);
  assert.ok(yellow[2].tvScore > green[2].tvScore && yellow[2].interestScore > green[2].interestScore);
});

test('flag changes: only flags that change his race, and a flag back within 30 s is the same one', () => {
  // Zandvoort's 40 changes of the word: debris out at a sector every lap, blue as the leaders lapped him, white and
  // blue taking turns on the last lap, `none` in between.
  const words = [[0, 'none'], [131.9, 'debris'], [137.3, 'none'], [228.4, 'debris'], [230.1, 'none'], [662.9, 'blue'],
    [669.7, 'none'], [982.9, 'white'], [1041.3, 'debris'], [1043.9, 'blue'], [1049.5, 'white'], [1054.9, 'blue'],
    [1062.6, 'white'], [1070.3, 'blue'], [1074.3, 'white'], [1083.4, 'blue'], [1088.7, 'white'], [1089.5, 'checkered']];
  const frames = [];
  for (let i = 0; i < words.length; i++) {
    const [from, flag] = words[i];
    const to = i + 1 < words.length ? words[i + 1][0] - 0.5 : from + 5;
    frames.push(...span(from, to, { flag, endOfRace: flag === 'checkered' }));
  }
  const flags = detectEvents(frames).filter((e) => e.event === 'flag_change').map((e) => [e.t, e.data.to]);
  assert.deepStrictEqual(flags, [[982.9, 'white'], [1089.5, 'checkered']]);
  // Two cautions minutes apart are two.
  const two = detectEvents([...span(0, 10, { flag: 'yellow' }), ...span(10.5, 200), ...span(200.5, 210, { flag: 'yellow' })]);
  assert.deepStrictEqual(two.filter((e) => e.event === 'flag_change').map((e) => e.t), [0, 200.5]);
});

test('after the chequered flag the cool-down is not the race, and ten seconds on nothing of it is shown', () => {
  // Zandvoort: the flag at 1089.5; the cool-down lap at 9 to 36 mph with gaps of 0.002 s to the car ahead, the lap
  // counter going on to 15 and then 1, the position -1 once he was out of the session.
  const frames = [
    ...span(1070, 1089, { lap: 14, gapAhead: 2.5 }),
    ...span(1089.5, 1097, { lap: 14, endOfRace: true, gapAhead: 2.4, speed: 90 }),
    ...span(1097.5, 1120.5, { lap: 15, endOfRace: true, gapAhead: 88, speed: 30 }),
    ...span(1121, 1132.5, { lap: 15, endOfRace: true, gapAhead: 0.4, speed: 9 }),
    ...span(1133, 1138, { lap: 1, endOfRace: true, speed: 0, pit: true }),
    ...span(1138.5, 1150, { lap: 1, endOfRace: true, speed: 0, pos: -1 }),
  ];
  const events = detectEvents(frames);
  assert.deepStrictEqual(events.filter((e) => ['close_battle', 'pit_entry', 'position_change', 'speed_drop', 'new_lap'].includes(e.event)), []);
  const end = events.filter((e) => e.event === 'race_end');
  assert.deepStrictEqual(end.map((e) => [e.t, e.data.pos, e.data.lap]), [[1089.5, 8, 14]]);
  const scores = scoreFrames(frames, events);
  assert.ok(scores.filter((s) => s.t > 1100).every((s) => s.tvScore === 0 && s.interestScore === 0));
  assert.ok(scores.find((s) => s.t === 1090).interestScore > 0, 'the finish itself is');
});

test('the start is lap 1 from the grid, and its first minute; a recording begun later has none', () => {
  const grid = [...span(0, 2.5, { lap: 0 }), ...span(3, 200, { lap: 1, gapAhead: 4, gapBehind: 4 })];
  assert.deepStrictEqual(detectEvents(grid).filter((e) => e.event === 'race_start').map((e) => e.t), [3]);
  const scores = scoreFrames(grid, []);
  assert.ok(scores.find((s) => s.t === 30).tvScore >= 40, 'the start is TV');
  assert.strictEqual(scores.find((s) => s.t === 120).tvScore, 0, 'two minutes into lap 1 is not the start');
  assert.deepStrictEqual(detectEvents(span(0, 60, { lap: 3 })).filter((e) => e.event === 'race_start'), []);
});

test('a battle\'s highlight is its closest moment, not all of it; highlights that overlap are one', () => {
  // Road Atlanta: the pack ran within 1.5 s from the start for four minutes; four places changed in eight seconds.
  const frames = [
    ...span(0, 254, (t) => ({ lap: 1, gapAhead: t >= 30 && t < 31 ? 0.05 : 0.9, gapBehind: 1.2 })),
    ...span(254.5, 400, { lap: 2, gapAhead: 4, gapBehind: 4 }),
  ];
  const events = detectEvents(frames);
  const battle = events.find((e) => e.event === 'close_battle');
  assert.strictEqual(battle.data.closestAt, 30);
  assert.ok(battle.duration > 250);
  const passes = [[85.4, 10, 12], [87.4, 12, 13], [89.5, 13, 14], [93.5, 14, 13]]
    .map(([t, from, to]) => ({ t, event: 'position_change', data: { from, to } }));
  const edl = buildMechanicalEDL({ startPosition: 10, endPosition: 9, durationStr: '6:40', events: [...events, ...passes] }, []);
  assert.deepStrictEqual(edl.highlight_reel.segments.map((h) => [h.start, h.end, h.label]), [
    ['0:17', '0:43', 'Battle (gap under 0.1s)'],
    ['1:22', '1:42', 'P10 → P12, P12 → P13, P13 → P14, P14 → P13'],
  ]);
});

test('the session\'s numbers are the race\'s: not P-1, not the lap counter after the flag', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rd-edit-values-'));
  try {
    const frames = [
      ...span(0, 10, { lap: 3, totalCars: 1 }),
      ...span(10.5, 100, { lap: 14, incidents: 6, totalCars: 9 }),
      ...span(100.5, 108, { lap: 14, incidents: 6, endOfRace: true }),
      ...span(108.5, 130, { lap: 15, incidents: 6, endOfRace: true }),
      ...span(130.5, 150, { lap: 1, incidents: 0, endOfRace: true, pos: -1, totalCars: 1 }),
    ];
    writeFileSync(join(dir, 'race.telemetry.jsonl'), frames.map((f) => JSON.stringify(f)).join('\n') + '\n');
    const session = await ingest(dir);
    assert.strictEqual(session.startPosition, 8);
    assert.strictEqual(session.endPosition, 8);
    assert.strictEqual(session.totalLaps, 14);
    assert.strictEqual(session.totalIncidents, 6);
    assert.strictEqual(session.totalCars, 9);
    assert.strictEqual(session.finishedAt, 100.5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
