// ═══════════════════════════════════════════════════════════════
// EVENT DETECTION TESTS
// ═══════════════════════════════════════════════════════════════

import { test } from 'node:test';
import assert from 'node:assert';
import { detectEvents } from '../src/ingest/detect-events.js';

// Helper to create a minimal frame
function frame(t, opts = {}) {
  return {
    t,
    pos: opts.pos ?? 1,
    speed: opts.speed ?? 100,
    gapAhead: opts.gapAhead ?? Infinity,
    gapBehind: opts.gapBehind ?? Infinity,
    closestCar: opts.closestCar ?? Infinity,
    lap: opts.lap ?? 1,
    lapDelta: opts.lapDelta ?? 0,
    incidents: opts.incidents ?? 0,
    pit: opts.pit ?? false,
    flag: opts.flag ?? 'green',
    endOfRace: opts.endOfRace ?? false,
    totalCars: opts.totalCars ?? 20,
    ...opts,
  };
}

test('detectEvents - empty input', () => {
  const result = detectEvents([]);
  assert.strictEqual(result.length, 0);
});

test('detectEvents - null input', () => {
  const result = detectEvents(null);
  assert.strictEqual(result.length, 0);
});

test('detectEvents - race start detection (first frame)', () => {
  const frames = [
    frame(0, { lap: 1 }),
    frame(1, { lap: 1 }),
  ];

  const events = detectEvents(frames);
  const startEvent = events.find(e => e.event === 'race_start');

  assert(startEvent, 'Should detect race start');
  assert.strictEqual(startEvent.t, 0);
  assert.strictEqual(startEvent.data.pos, 1);
  assert.strictEqual(startEvent.data.totalCars, 20);
});

test('detectEvents - position change detection (overtake)', () => {
  const frames = [
    frame(0, { pos: 3, lap: 1 }),
    frame(1, { pos: 2, lap: 1 }), // Gained position
  ];

  const events = detectEvents(frames);
  const posChangeEvent = events.find(e => e.event === 'position_change');

  assert(posChangeEvent, 'Should detect position change');
  assert.strictEqual(posChangeEvent.data.from, 3);
  assert.strictEqual(posChangeEvent.data.to, 2);
  assert.strictEqual(posChangeEvent.data.direction, 'gained');
  assert.strictEqual(posChangeEvent.data.delta, 1);
});

test('detectEvents - position change detection (lost position)', () => {
  const frames = [
    frame(0, { pos: 2, lap: 1 }),
    frame(1, { pos: 3, lap: 1 }), // Lost position
  ];

  const events = detectEvents(frames);
  const posChangeEvent = events.find(e => e.event === 'position_change');

  assert(posChangeEvent, 'Should detect lost position');
  assert.strictEqual(posChangeEvent.data.from, 2);
  assert.strictEqual(posChangeEvent.data.to, 3);
  assert.strictEqual(posChangeEvent.data.direction, 'lost');
});

test('detectEvents - battle detection (sustained close gap)', () => {
  const frames = [
    frame(0, { gapAhead: 2.0, lap: 1 }),
    frame(1, { gapAhead: 1.2, lap: 1 }), // Battle threshold is 1.5s
    frame(2, { gapAhead: 0.9, lap: 1 }),
    frame(3, { gapAhead: 0.8, lap: 1 }),
    frame(4, { gapAhead: 2.0, lap: 1 }), // Exit battle
  ];

  const events = detectEvents(frames);
  const battleEvent = events.find(e => e.event === 'close_battle');

  assert(battleEvent, 'Should detect close battle');
  assert.strictEqual(battleEvent.t, 1); // Start at first frame in battle
  assert(battleEvent.duration >= 2, 'Battle should have duration >= 2s');
  assert(battleEvent.data.minGap <= 0.9, 'Should record minimum gap');
});

test('detectEvents - battle too short ignored', () => {
  const frames = [
    frame(0, { gapAhead: 2.0, lap: 1 }),
    frame(0.5, { gapAhead: 1.2, lap: 1 }), // Brief dip
    frame(1, { gapAhead: 2.0, lap: 1 }), // Back out
  ];

  const events = detectEvents(frames);
  const battleEvent = events.find(e => e.event === 'close_battle');

  // Duration is ~0.5s, minimum is 2s, so should not create event
  assert(!battleEvent, 'Should ignore battles shorter than 2 seconds');
});

test('detectEvents - incident detection', () => {
  const frames = [
    frame(0, { incidents: 0, lap: 1 }),
    frame(1, { incidents: 1, lap: 1 }),
    frame(2, { incidents: 1, lap: 1 }),
  ];

  const events = detectEvents(frames);
  const incidentEvent = events.find(e => e.event === 'incident');

  assert(incidentEvent, 'Should detect incident');
  assert.strictEqual(incidentEvent.t, 1);
  assert.strictEqual(incidentEvent.data.from, 0);
  assert.strictEqual(incidentEvent.data.to, 1);
});

test('detectEvents - pit entry/exit detection', () => {
  const frames = [
    frame(0, { pit: false, lap: 1 }),
    frame(1, { pit: true, lap: 1 }), // Pit entry
    frame(2, { pit: true, lap: 1 }),
    frame(3, { pit: false, lap: 1 }), // Pit exit
  ];

  const events = detectEvents(frames);
  const pitEntry = events.find(e => e.event === 'pit_entry');
  const pitExit = events.find(e => e.event === 'pit_exit');

  assert(pitEntry, 'Should detect pit entry');
  assert.strictEqual(pitEntry.t, 1);
  assert(pitExit, 'Should detect pit exit');
  assert.strictEqual(pitExit.t, 3);
});

test('detectEvents - flag change detection', () => {
  const frames = [
    frame(0, { flag: 'green', lap: 1 }),
    frame(1, { flag: 'yellow', lap: 1 }),
    frame(2, { flag: 'green', lap: 1 }), // Return to green doesn't trigger (it's already non-green)
  ];

  const events = detectEvents(frames);
  const flagEvent = events.find(e => e.event === 'flag_change');

  assert(flagEvent, 'Should detect flag change');
  assert.strictEqual(flagEvent.t, 1);
  assert.strictEqual(flagEvent.data.from, 'green');
  assert.strictEqual(flagEvent.data.to, 'yellow');
});

test('detectEvents - speed drop detection (off-track)', () => {
  const frames = [
    frame(0, { speed: 150, lap: 1 }),
    frame(1, { speed: 100, lap: 1 }), // ~67% of previous speed
    frame(2, { speed: 120, lap: 1 }),
  ];

  const events = detectEvents(frames);
  const speedDropEvent = events.find(e => e.event === 'speed_drop');

  assert(speedDropEvent, 'Should detect speed drop');
  assert.strictEqual(speedDropEvent.t, 1);
  assert.strictEqual(speedDropEvent.data.from, 150);
  assert.strictEqual(speedDropEvent.data.to, 100);
});

test('detectEvents - speed drop with threshold boundary', () => {
  // Threshold is 0.7 (30% drop)
  const frames = [
    frame(0, { speed: 100, lap: 1 }),
    frame(1, { speed: 70.1, lap: 1 }), // Just above 70%
    frame(2, { speed: 100, lap: 1 }),
  ];

  const events = detectEvents(frames);
  const speedDropEvent = events.find(e => e.event === 'speed_drop');

  assert(!speedDropEvent, 'Should not detect speed drop above 70% threshold');
});

test('detectEvents - avoids speed drop on low speeds', () => {
  const frames = [
    frame(0, { speed: 20, lap: 1 }), // Low speed, no drop detection
    frame(1, { speed: 5, lap: 1 }),
  ];

  const events = detectEvents(frames);
  const speedDropEvent = events.find(e => e.event === 'speed_drop');

  // prevSpeed > 30 check prevents false positives at low speeds
  assert(!speedDropEvent, 'Should not detect speed drop on low speeds');
});

test('detectEvents - lap changes', () => {
  const frames = [
    frame(0, { lap: 1, lapDelta: 0, speed: 100 }),
    frame(10, { lap: 2, lapDelta: 0.5, speed: 100 }),
    frame(20, { lap: 3, lapDelta: -0.35, speed: 100 }), // Fast lap
  ];

  const events = detectEvents(frames);
  const newLapEvent = events.find(e => e.event === 'new_lap');
  const fastLapEvent = events.find(e => e.event === 'fast_lap');

  assert(newLapEvent, 'Should detect new lap');
  assert(fastLapEvent, 'Should detect fast lap (delta < -0.3)');
  assert.strictEqual(fastLapEvent.data.delta, -0.35);
});

test('detectEvents - fast lap threshold', () => {
  const frames = [
    frame(0, { lap: 1, lapDelta: 0, speed: 100 }),
    frame(10, { lap: 2, lapDelta: -0.2, speed: 100 }), // Close to threshold but not quite
    frame(20, { lap: 3, lapDelta: -0.35, speed: 100 }), // Below threshold
  ];

  const events = detectEvents(frames);
  const fastLapEvents = events.filter(e => e.event === 'fast_lap');

  // Only one fast lap event (lap 3)
  assert.strictEqual(fastLapEvents.length, 1);
  assert.strictEqual(fastLapEvents[0].data.lap, 3);
});

test('detectEvents - race end detection', () => {
  const frames = [
    frame(0, { endOfRace: false, lap: 1 }),
    frame(100, { endOfRace: true, lap: 10, pos: 1 }),
    frame(100.5, { endOfRace: true, lap: 10, pos: 1 }),
  ];

  const events = detectEvents(frames);
  const raceEndEvent = events.find(e => e.event === 'race_end');

  assert(raceEndEvent, 'Should detect race end');
  // Race end fires at the last frame when endOfRace is true, or when endOfRace transitions to false
  assert.strictEqual(raceEndEvent.t, 100.5);
  assert.strictEqual(raceEndEvent.data.lap, 10);
  assert.strictEqual(raceEndEvent.data.pos, 1);
});

test('detectEvents - battle merging (within 5s gap)', () => {
  const frames = [
    frame(0, { gapAhead: 2.0, lap: 1 }),
    // Battle 1: t=1 to t=3
    frame(1, { gapAhead: 1.0, lap: 1 }),
    frame(2, { gapAhead: 1.0, lap: 1 }),
    frame(3, { gapAhead: 2.0, lap: 1 }),
    // Gap (3s)
    frame(6, { gapAhead: 2.0, lap: 1 }),
    // Battle 2: t=7 to t=9 (within 5s merge window)
    frame(7, { gapAhead: 1.0, lap: 1 }),
    frame(8, { gapAhead: 1.0, lap: 1 }),
    frame(9, { gapAhead: 2.0, lap: 1 }),
  ];

  const events = detectEvents(frames);
  const battleEvents = events.filter(e => e.event === 'close_battle');

  // Should merge battles within 5s
  assert(
    battleEvents.length < 2,
    'Battles within 5s should be merged into single event'
  );
});

test('detectEvents - events sorted by time', () => {
  const frames = [
    frame(0, { pos: 3, incidents: 0, lap: 1 }),
    frame(2, { pos: 2, incidents: 0, lap: 1 }), // Position change at t=2
    frame(1, { pos: 2, incidents: 1, lap: 1 }), // Incident at t=1 (out of order)
  ];

  const events = detectEvents(frames);

  // Events should be sorted by time
  for (let i = 1; i < events.length; i++) {
    assert(
      events[i].t >= events[i - 1].t,
      `Events should be sorted by time: ${events[i - 1].t} -> ${events[i].t}`
    );
  }
});

test('detectEvents - complex scenario (full race)', () => {
  const frames = [
    frame(0, { pos: 5, lap: 1, incidents: 0, pit: false, flag: 'green' }),
    frame(5, { pos: 4, lap: 1, incidents: 0, pit: false, flag: 'green' }), // Overtake
    frame(15, { pos: 4, lap: 2, lapDelta: 0.2, incidents: 0, pit: false }), // New lap
    frame(20, { pos: 4, lap: 2, incidents: 0, pit: true }), // Pit entry
    frame(25, { pos: 4, lap: 2, incidents: 0, pit: false }), // Pit exit
    frame(35, { pos: 3, lap: 3, lapDelta: -0.4, incidents: 0, pit: false }), // Overtake + fast lap
    frame(45, { pos: 3, lap: 4, incidents: 1, pit: false }), // Incident
    frame(100, { pos: 2, lap: 10, endOfRace: true, incidents: 1 }),
  ];

  const events = detectEvents(frames);

  assert(events.length > 0, 'Should detect multiple events');
  assert(events.some(e => e.event === 'race_start'), 'Should have race_start');
  assert(events.some(e => e.event === 'position_change'), 'Should have position_change');
  assert(events.some(e => e.event === 'pit_entry'), 'Should have pit_entry');
  assert(events.some(e => e.event === 'pit_exit'), 'Should have pit_exit');
  assert(events.some(e => e.event === 'fast_lap'), 'Should have fast_lap');
  assert(events.some(e => e.event === 'incident'), 'Should have incident');
  assert(events.some(e => e.event === 'race_end'), 'Should have race_end');
});
