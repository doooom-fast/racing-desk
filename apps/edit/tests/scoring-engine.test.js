// ═══════════════════════════════════════════════════════════════
// SCORING ENGINE TESTS
// ═══════════════════════════════════════════════════════════════

import { test } from 'node:test';
import assert from 'node:assert';
import { scoreFrames, applyCameraHysteresis } from '../src/analyze/scoring-engine.js';

// Helper to create a minimal frame
function frame(t, opts = {}) {
  return {
    t,
    pos: opts.pos ?? 1,
    speed: opts.speed ?? 100,
    brake: opts.brake ?? 0,
    gapAhead: opts.gapAhead ?? Infinity,
    gapBehind: opts.gapBehind ?? Infinity,
    closestCar: opts.closestCar ?? Infinity,
    lap: opts.lap ?? 1,
    lapDelta: opts.lapDelta ?? 0,
    incidents: opts.incidents ?? 0,
    pit: opts.pit ?? false,
    flag: opts.flag ?? 'green',
    endOfRace: opts.endOfRace ?? false,
    ...opts,
  };
}

test('scoreFrames - empty input', () => {
  const result = scoreFrames([], []);
  assert.strictEqual(result.length, 0);
});

test('scoreFrames - null input', () => {
  const result = scoreFrames(null, []);
  assert.strictEqual(result.length, 0);
});

test('scoreFrames - single frame', () => {
  const frames = [frame(0)];
  const scores = scoreFrames(frames, []);

  assert.strictEqual(scores.length, 1);
  assert.strictEqual(scores[0].t, 0);
  assert(typeof scores[0].tvScore === 'number');
  assert(typeof scores[0].interestScore === 'number');
  assert(scores[0].tvScore >= 0 && scores[0].tvScore <= 100);
  assert(scores[0].interestScore >= 0 && scores[0].interestScore <= 100);
});

test('scoreFrames - avoids division by zero with missing gap fields', () => {
  // This tests the fix for division-by-zero when gaps are undefined
  const frames = [
    frame(0, { gapAhead: undefined, gapBehind: undefined, closestCar: undefined }),
  ];

  const scores = scoreFrames(frames, []);
  assert.strictEqual(scores.length, 1);
  assert(scores[0].tvScore >= 0 && scores[0].tvScore <= 100);
});

test('scoreFrames - battle conditions boost TV score', () => {
  const closeGapFrames = [
    frame(0, { gapAhead: 0.5, gapBehind: 2.0 }),
  ];

  const scores = scoreFrames(closeGapFrames, []);
  assert(scores[0].tvScore >= 40, 'Close gap ahead should boost TV score');
});

test('scoreFrames - clean air reduces TV score (negative weight)', () => {
  const cleanAirFrames = [
    frame(0, { gapAhead: 5.0, gapBehind: 5.0, lap: 5 }),
  ];

  const scores = scoreFrames(cleanAirFrames, []);
  // Clean air gets -20 TV weight, should be 0 when clamped (no other signals)
  assert(scores[0].tvScore === 0, 'Clean air with no other signals should be 0');
});

test('scoreFrames - lap 1 boosts both scores', () => {
  const lap1Frames = [frame(0, { lap: 1 })];
  const otherLapFrames = [frame(0, { lap: 5 })];

  const lap1Scores = scoreFrames(lap1Frames, []);
  const otherScores = scoreFrames(otherLapFrames, []);

  assert(
    lap1Scores[0].tvScore >= otherScores[0].tvScore,
    'Lap 1 should have higher or equal TV score'
  );
  assert(
    lap1Scores[0].interestScore >= otherScores[0].interestScore,
    'Lap 1 should have higher or equal interest score'
  );
});

test('scoreFrames - pit stop boosts scores', () => {
  const pitFrames = [frame(0, { pit: true })];
  const noPitFrames = [frame(0, { pit: false })];

  const pitScores = scoreFrames(pitFrames, []);
  const noPitScores = scoreFrames(noPitFrames, []);

  assert(
    pitScores[0].tvScore > noPitScores[0].tvScore,
    'Pit should boost TV score'
  );
  assert(
    pitScores[0].interestScore > noPitScores[0].interestScore,
    'Pit should boost interest score'
  );
});

test('scoreFrames - end of race boosts interest score', () => {
  const endFrames = [frame(0, { endOfRace: true, lap: 10 })];
  const normalFrames = [frame(0, { endOfRace: false, lap: 10 })];

  const endScores = scoreFrames(endFrames, []);
  const normalScores = scoreFrames(normalFrames, []);

  assert(
    endScores[0].interestScore > normalScores[0].interestScore,
    'End of race should boost interest score'
  );
});

test('scoreFrames - scores clamped to 0-100', () => {
  // Create a frame with multiple high-scoring conditions
  const frames = [
    frame(0, {
      lap: 1,
      pit: true,
      gapAhead: 0.5,
      gapBehind: 0.5,
      endOfRace: true,
    }),
  ];

  const scores = scoreFrames(frames, []);
  assert(
    scores[0].tvScore <= 100,
    'TV score should be clamped to max 100'
  );
  assert(
    scores[0].interestScore <= 100,
    'Interest score should be clamped to max 100'
  );
});

test('scoreFrames - events spread across duration', () => {
  const frames = [
    frame(0),
    frame(1),
    frame(2),
    frame(3),
    frame(4),
  ];

  const events = [
    {
      t: 1,
      event: 'position_change',
      data: { from: 2, to: 1 },
      duration: 2, // spans seconds 1, 2, 3
    },
  ];

  const scores = scoreFrames(frames, events);
  assert(scores.length > 0);
  // Event at second 1 should have higher score
  const eventSecond = scores.find(s => s.t === 1);
  const laterSecond = scores.find(s => s.t === 4);
  assert(
    eventSecond.interestScore >= laterSecond.interestScore,
    'Event second should have higher interest score than non-event'
  );
});

test('applyCameraHysteresis - empty input', () => {
  const result = applyCameraHysteresis([]);
  assert.strictEqual(result.length, 0);
});

test('applyCameraHysteresis - single segment', () => {
  const scores = [
    { t: 0, tvScore: 20 },
    { t: 1, tvScore: 25 },
  ];

  const segments = applyCameraHysteresis(scores);
  assert.strictEqual(segments.length, 1);
  assert.strictEqual(segments[0].source, 'cockpit');
});

test('applyCameraHysteresis - tv threshold crossing', () => {
  const scores = [
    { t: 0, tvScore: 20 }, // cockpit
    { t: 1, tvScore: 45 }, // tv (above 40 threshold)
    { t: 2, tvScore: 50 }, // tv
    { t: 3, tvScore: 30 }, // cockpit (below threshold, but hold 6s)
    { t: 10, tvScore: 20 }, // after hold expires, cockpit
  ];

  const segments = applyCameraHysteresis(scores, 40);
  assert(segments.length >= 2, 'Should have multiple segments');

  // First segment should be cockpit
  assert.strictEqual(segments[0].source, 'cockpit');

  // Should have a TV segment
  const tvSegment = segments.find(s => s.source === 'tv');
  assert(tvSegment, 'Should have TV segment');
});

test('applyCameraHysteresis - custom threshold', () => {
  const scores = [
    { t: 0, tvScore: 50 },
    { t: 1, tvScore: 60 },
    { t: 2, tvScore: 70 },
  ];

  const segmentsDefault = applyCameraHysteresis(scores, 40);
  const segmentsHigh = applyCameraHysteresis(scores, 80);

  // Higher threshold should result in fewer TV segments
  const defaultTV = segmentsDefault.filter(s => s.source === 'tv');
  const highTV = segmentsHigh.filter(s => s.source === 'tv');

  assert(
    defaultTV.length >= highTV.length,
    'Higher threshold should have fewer TV segments'
  );
});

test('applyCameraHysteresis - hold duration respected', () => {
  const scores = [
    { t: 0, tvScore: 50 }, // tv
    { t: 1, tvScore: 20 }, // cockpit (but hold 6s from t=0)
    { t: 5, tvScore: 20 }, // still in hold
    { t: 7, tvScore: 20 }, // past hold, actually cockpit now
  ];

  const segments = applyCameraHysteresis(scores);
  // Should not immediately switch to cockpit at t=1
  const firstSegment = segments[0];
  assert.strictEqual(firstSegment.source, 'tv');
  assert(firstSegment.end > 1, 'TV segment should extend past immediate drop');
});

test('applyCameraHysteresis - result structure', () => {
  const scores = [
    { t: 0, tvScore: 30 },
    { t: 10, tvScore: 60 },
  ];

  const segments = applyCameraHysteresis(scores);
  for (const seg of segments) {
    assert(typeof seg.start === 'number', 'Segment should have start');
    assert(typeof seg.end === 'number', 'Segment should have end');
    assert(['cockpit', 'tv'].includes(seg.source), 'Source should be cockpit or tv');
    assert(seg.start <= seg.end, 'Start should be before or equal to end');
  }
});
