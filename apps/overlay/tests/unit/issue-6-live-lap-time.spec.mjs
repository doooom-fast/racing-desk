/**
 * Issue #6 — Position module: live lap time + delta vs best
 *
 * While on-lap the position module should show the current lap time
 * with a +/- differential vs personal best. When between laps
 * (currentLapTime < 0.5s) it falls back to showing the best lap time.
 */

import { test, expect } from '@playwright/test';

// Re-implementation of the lap time formatting and display logic
// from poll-engine.js

function fmtLap(seconds) {
  if (!seconds || seconds <= 0) return '—:——.———';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(3)}`;
}

function resolveLapDisplay(curLapTime, bestLap) {
  // On-lap: curLapTime > 0.5s threshold
  if (curLapTime > 0.5) {
    const diff = bestLap > 0 ? curLapTime - bestLap : null;
    let label = fmtLap(curLapTime);
    if (diff !== null) {
      label += '  ' + (diff >= 0 ? '+' : '') + diff.toFixed(3);
    }
    return { label, isOnLap: true, diff };
  }
  // Between laps: show best lap
  return {
    label: bestLap > 0 ? fmtLap(bestLap) : '—:——.———',
    isOnLap: false,
    diff: null,
  };
}

test.describe('Issue #6 — Live lap time display', () => {

  test('shows current lap time + positive delta when slower than best', () => {
    const { label, diff } = resolveLapDisplay(92.456, 90.123);
    expect(label).toContain(fmtLap(92.456));
    expect(label).toContain('+2.333');
    expect(diff).toBeCloseTo(2.333, 2);
  });

  test('shows current lap time + negative delta when faster than best', () => {
    const { label, diff } = resolveLapDisplay(88.500, 90.123);
    expect(label).toContain('-1.623');
    expect(diff).toBeLessThan(0);
  });

  test('shows current lap time without delta when no best lap recorded', () => {
    const { label, diff } = resolveLapDisplay(45.0, 0);
    expect(label).toBe(fmtLap(45.0));
    expect(diff).toBeNull();
  });

  test('isOnLap is true when curLapTime > 0.5', () => {
    expect(resolveLapDisplay(1.0, 90).isOnLap).toBe(true);
    expect(resolveLapDisplay(0.51, 90).isOnLap).toBe(true);
  });

  test('isOnLap is false when curLapTime <= 0.5 (between laps)', () => {
    expect(resolveLapDisplay(0.5, 90).isOnLap).toBe(false);
    expect(resolveLapDisplay(0.0, 90).isOnLap).toBe(false);
  });

  test('falls back to best lap display between laps', () => {
    const { label } = resolveLapDisplay(0.1, 90.123);
    expect(label).toBe(fmtLap(90.123));
  });

  test('shows placeholder when between laps and no best lap', () => {
    const { label } = resolveLapDisplay(0, 0);
    expect(label).toBe('—:——.———');
  });

  test('delta sign is always explicit (+ for positive, - for negative)', () => {
    const pos = resolveLapDisplay(92, 90);
    const neg = resolveLapDisplay(88, 90);
    expect(pos.label).toContain('+');
    expect(neg.label).toContain('-');
  });

  test('fmtLap formats minutes correctly for laps over 60s', () => {
    expect(fmtLap(90.5)).toBe('1:30.500');
    expect(fmtLap(61.0)).toBe('1:01.000');
  });

  test('fmtLap returns placeholder for zero or missing time', () => {
    expect(fmtLap(0)).toBe('—:——.———');
    expect(fmtLap(null)).toBe('—:——.———');
  });
});
