// ═══════════════════════════════════════════════════════════════
// TIME UTILITIES TESTS
// ═══════════════════════════════════════════════════════════════

import { test } from 'node:test';
import assert from 'node:assert';
import { parseDuration, formatDuration, toFFmpegTime } from '../src/utils/time.js';

test('parseDuration - numeric input', () => {
  assert.strictEqual(parseDuration(5), 5);
  assert.strictEqual(parseDuration(0), 0);
  assert.strictEqual(parseDuration(3600), 3600);
});

test('parseDuration - MM:SS format', () => {
  assert.strictEqual(parseDuration('0:00'), 0);
  assert.strictEqual(parseDuration('1:00'), 60);
  assert.strictEqual(parseDuration('5:00'), 300);
  assert.strictEqual(parseDuration('1:30'), 90);
  assert.strictEqual(parseDuration('59:59'), 3599);
});

test('parseDuration - HH:MM:SS format', () => {
  assert.strictEqual(parseDuration('0:00:00'), 0);
  assert.strictEqual(parseDuration('1:00:00'), 3600);
  assert.strictEqual(parseDuration('1:30:00'), 5400);
  assert.strictEqual(parseDuration('1:23:45'), 5025);
  assert.strictEqual(parseDuration('2:45:30'), 9930);
});

test('parseDuration - edge cases', () => {
  // Single number (seconds)
  assert.strictEqual(parseDuration('45'), 45);
  // Empty string defaults to 0
  assert.strictEqual(parseDuration(''), 0);
});

test('formatDuration - M:SS format (under 1 hour)', () => {
  assert.strictEqual(formatDuration(0), '0:00');
  assert.strictEqual(formatDuration(1), '0:01');
  assert.strictEqual(formatDuration(9), '0:09');
  assert.strictEqual(formatDuration(10), '0:10');
  assert.strictEqual(formatDuration(59), '0:59');
  assert.strictEqual(formatDuration(60), '1:00');
  assert.strictEqual(formatDuration(90), '1:30');
  assert.strictEqual(formatDuration(3599), '59:59');
});

test('formatDuration - H:MM:SS format (1 hour or more)', () => {
  assert.strictEqual(formatDuration(3600), '1:00:00');
  assert.strictEqual(formatDuration(3661), '1:01:01');
  assert.strictEqual(formatDuration(5400), '1:30:00');
  assert.strictEqual(formatDuration(5425), '1:30:25');
  assert.strictEqual(formatDuration(9930), '2:45:30');
});

test('formatDuration - rounding', () => {
  assert.strictEqual(formatDuration(1.4), '0:01');
  assert.strictEqual(formatDuration(1.5), '0:02');
  assert.strictEqual(formatDuration(59.9), '1:00');
});

test('toFFmpegTime - basic timestamps', () => {
  assert.strictEqual(toFFmpegTime(0), '00:00:00.000');
  assert.strictEqual(toFFmpegTime(1), '00:00:01.000');
  assert.strictEqual(toFFmpegTime(60), '00:01:00.000');
  assert.strictEqual(toFFmpegTime(3600), '01:00:00.000');
});

test('toFFmpegTime - fractional seconds', () => {
  const result = toFFmpegTime(0.5);
  assert.match(result, /^00:00:00\.\d{3}$/);
  assert.strictEqual(toFFmpegTime(1.234), '00:00:01.234');
  assert.strictEqual(toFFmpegTime(5.678), '00:00:05.678');
});

test('toFFmpegTime - complex timestamps', () => {
  assert.strictEqual(toFFmpegTime(3661.5), '01:01:01.500');
  assert.strictEqual(toFFmpegTime(5425.123), '01:30:25.123');
  assert.strictEqual(toFFmpegTime(9930.999), '02:45:30.999');
});

test('toFFmpegTime - padding zeros', () => {
  // Single digit hours, minutes, seconds should be zero-padded
  const result = toFFmpegTime(62); // 1:02
  assert.strictEqual(result, '00:01:02.000');

  const result2 = toFFmpegTime(3723); // 1:02:03
  assert.strictEqual(result2, '01:02:03.000');
});

test('roundtrip: parseDuration → formatDuration', () => {
  const testCases = ['0:00', '1:30', '5:00', '59:59', '1:00:00', '2:45:30'];

  for (const input of testCases) {
    const parsed = parseDuration(input);
    const formatted = formatDuration(parsed);
    // Re-parse to verify the result is mathematically equivalent
    const reparsed = parseDuration(formatted);
    assert.strictEqual(parsed, reparsed, `Roundtrip failed for ${input}`);
  }
});

test('roundtrip: toFFmpegTime maintains precision', () => {
  const seconds = 3661.234;
  const ffmpegTime = toFFmpegTime(seconds);
  assert.strictEqual(ffmpegTime, '01:01:01.234');

  // Extract components and verify
  const [h, m, s] = ffmpegTime.split(':');
  assert.strictEqual(parseInt(h), 1);
  assert.strictEqual(parseInt(m), 1);
  assert(s.startsWith('01.'));
});
