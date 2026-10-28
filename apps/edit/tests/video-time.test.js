// ═══════════════════════════════════════════════════════════════
// VIDEO TIME TESTS — the sidecar's t against the video's own clock
// ═══════════════════════════════════════════════════════════════

import { test } from 'node:test';
import assert from 'node:assert';
import { videoClock, toVideoTime, toSidecarTime, videoRange, describeClock } from '../src/utils/video-time.js';
import { silencesInSidecarTime } from '../src/analyze/condenser.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);

test('a sidecar with no summary, or none lined up, is read as t = video time', () => {
  for (const summary of [null, undefined, {}, { videoOffsetMs: 0, alignment: { method: 'none', why: 'no file' } }, { videoOffsetMs: 'x' }]) {
    const clock = videoClock(summary);
    assert.strictEqual(clock.known, false);
    assert.strictEqual(clock.offsetMs, 0);
    close(toVideoTime(clock, 42.5), 42.5);
    close(toSidecarTime(clock, 42.5), 42.5);
    assert.deepStrictEqual(videoRange(clock, 10, 20), { start: 10, end: 20 });
  }
});

test('the keyframe wait: the file began 3.5 s after t = 0, so a moment is 3.5 s earlier in it', () => {
  const clock = videoClock({ videoOffsetMs: -3500, alignment: { method: 'chapters', pairs: 12, spreadMs: 40 } });
  assert.strictEqual(clock.known, true);
  assert.strictEqual(clock.approximate, false);
  close(toVideoTime(clock, 100), 96.5);
  close(toSidecarTime(clock, 96.5), 100);
  // A pass at t 100, with 3 s either side, is cut from the video at 93.5–104.5, not at 97–108.
  assert.deepStrictEqual(videoRange(clock, 97, 108), { start: 93.5, end: 104.5 });
  // What the sidecar saw before the file began is not in it.
  assert.strictEqual(videoRange(clock, 0, 3), null);
  assert.deepStrictEqual(videoRange(clock, 2, 10), { start: 0, end: 6.5 });
});

test('an offset the other way (STARTED told late) moves the cut later', () => {
  const clock = videoClock({ videoOffsetMs: 1250, alignment: { method: 'end', endFrom: 'request' } });
  close(toVideoTime(clock, 10), 11.25);
  close(toSidecarTime(clock, 11.25), 10);
  close(toSidecarTime(clock, 0), -1.25);
  assert.deepStrictEqual(videoRange(clock, 10, 20), { start: 11.25, end: 21.25 });
});

test('a pause: the video stood still for it, so what follows is that much earlier in the video', () => {
  // Paused from t 60 to t 90.
  const clock = videoClock({ videoOffsetMs: -2000, alignment: { method: 'chapters', approximate: true }, pauses: [{ from: 60000, to: 90000 }] });
  assert.strictEqual(clock.approximate, true);
  close(toVideoTime(clock, 50), 48);     // before it: the offset alone
  close(toVideoTime(clock, 70), 58);     // inside it: where the video stopped
  close(toVideoTime(clock, 90), 58);     // its end is where the video went on
  close(toVideoTime(clock, 100), 68);    // after it: less the 30 s it lasted
  close(toSidecarTime(clock, 48), 50);
  close(toSidecarTime(clock, 58), 60);   // the point the video stopped at shows the pause's start first
  close(toSidecarTime(clock, 68), 100);
  // A stretch over the pause is one piece of the video, shorter by the pause.
  assert.deepStrictEqual(videoRange(clock, 55, 95), { start: 53, end: 63 });
  // A stretch wholly inside it is not in the video at all.
  assert.strictEqual(videoRange(clock, 65, 85), null);
});

test('pauses out of order, overlapping or not real are put in order, joined and left out', () => {
  const clock = videoClock({
    videoOffsetMs: 0,
    alignment: { method: 'chapters' },
    pauses: [{ from: 50000, to: 55000 }, { from: 10000, to: 20000 }, { from: 15000, to: 25000 }, { from: 30000, to: 30000 }, { from: 'a', to: 3 }, null, { from: 40000, to: 35000 }],
  });
  assert.deepStrictEqual(clock.pauses, [{ from: 10000, to: 25000 }, { from: 50000, to: 55000 }]);
  close(toVideoTime(clock, 60), 40);     // 60 less 15 and 5
  close(toSidecarTime(clock, 40), 60);
});

test('every moment outside a pause comes back to itself', () => {
  const clock = videoClock({ videoOffsetMs: -3712, alignment: { method: 'chapters' }, pauses: [{ from: 61000, to: 64500 }, { from: 200000, to: 260000 }] });
  for (let t = 4; t < 400; t += 0.37) {
    // A pause's end is the same point of the video as its start, which comes back as the start.
    const inPause = clock.pauses.some((p) => t * 1000 > p.from && t * 1000 <= p.to);
    if (!inPause) close(toSidecarTime(clock, toVideoTime(clock, t)), t);
  }
});

test('a stretch is held to the file: from 0, and to its end where its length is known', () => {
  const clock = videoClock({ videoOffsetMs: -1000, alignment: { method: 'end' } });
  assert.deepStrictEqual(videoRange(clock, 590, 610, 600), { start: 589, end: 600 });
  assert.strictEqual(videoRange(clock, 605, 615, 600), null);
  assert.deepStrictEqual(videoRange(clock, 605, 615, 0), { start: 604, end: 614 });
});

test('the line the command line prints says what the clock is', () => {
  assert.strictEqual(describeClock(videoClock(null)), 'Video offset not known: telemetry time is taken as video time.');
  assert.strictEqual(describeClock(videoClock({ videoOffsetMs: -3500, alignment: { method: 'chapters' } })),
    'Video is telemetry time −3500 ms (lined up by chapters).');
  assert.strictEqual(describeClock(videoClock({ videoOffsetMs: 250, alignment: { method: 'end' }, pauses: [{ from: 1, to: 2 }] })),
    'Video is telemetry time +250 ms (lined up by end), 1 pause taken out, approximate.');
});

test('the condenser\'s silences, found in the video, become stretches of the telemetry\'s time', () => {
  const clock = videoClock({ videoOffsetMs: -3500, alignment: { method: 'chapters' }, pauses: [{ from: 60000, to: 90000 }] });
  const out = silencesInSidecarTime(clock, [{ start: 10, end: 20, duration: 10 }, { start: 50, end: 60, duration: 10 }]);
  close(out[0].start, 13.5);
  close(out[0].end, 23.5);
  close(out[1].start, 53.5);    // before the pause
  close(out[1].end, 93.5);      // after it: the video's 56.5 is the pause's point, so 60 is 3.5 s past its end
  assert.strictEqual(out[0].duration, 10);
});
