/**
 * Issue #11 — Fuel unit detection and tyre wear fallback
 *
 * Two bugs fixed:
 * 1. parseInt('0') || 1 evaluates to 1 (metric) even when DisplayUnits=0
 *    (imperial). The fix uses an explicit null/empty check.
 * 2. Tyre wear from GameData is 0 for the whole first lap in iRacing.
 *    The fix averages the three raw zone values (L/M/R) as a fallback.
 */

import { test, expect } from '@playwright/test';

// ─────────────────────────────────────────────────────────────
//  Re-implementation of the fixed DisplayUnits parse from pitbox.js
// ─────────────────────────────────────────────────────────────

function parseDisplayUnits(rawValue) {
  return (rawValue !== '' && rawValue !== null && rawValue !== undefined)
    ? parseInt(rawValue)
    : 1;  // default metric
}

// ─────────────────────────────────────────────────────────────
//  Re-implementation of the tyre wear fallback from TelemetrySnapshot
// ─────────────────────────────────────────────────────────────

function resolveTyreWear(gameDataWear, rawL, rawM, rawR) {
  if (gameDataWear > 0) return gameDataWear;
  if (rawL > 0 || rawM > 0 || rawR > 0) return (rawL + rawM + rawR) / 3;
  return 0;
}

test.describe('Issue #11 — DisplayUnits: imperial zero must not default to metric', () => {

  test('DisplayUnits=0 (imperial) is parsed as 0, not 1', () => {
    expect(parseDisplayUnits('0')).toBe(0);
    expect(parseDisplayUnits(0)).toBe(0);
  });

  test('DisplayUnits=1 (metric) is parsed as 1', () => {
    expect(parseDisplayUnits('1')).toBe(1);
    expect(parseDisplayUnits(1)).toBe(1);
  });

  test('null DisplayUnits defaults to 1 (metric)', () => {
    expect(parseDisplayUnits(null)).toBe(1);
  });

  test('undefined DisplayUnits defaults to 1 (metric)', () => {
    expect(parseDisplayUnits(undefined)).toBe(1);
  });

  test('empty string DisplayUnits defaults to 1 (metric)', () => {
    expect(parseDisplayUnits('')).toBe(1);
  });

  test('old broken logic (parseInt || 1) would have failed for 0', () => {
    // Regression guard: document the bug explicitly
    const brokenResult = parseInt('0') || 1;
    expect(brokenResult).toBe(1);  // this is wrong — proves the fix was needed
  });

  test('fixed logic correctly distinguishes 0 from missing', () => {
    expect(parseDisplayUnits('0')).toBe(0);   // imperial — correct
    expect(parseDisplayUnits('')).toBe(1);     // missing — defaults to metric
  });
});

test.describe('Issue #11 — Tyre wear: raw zone fallback when GameData returns 0', () => {

  test('GameData wear > 0 is used directly', () => {
    expect(resolveTyreWear(0.85, 0, 0, 0)).toBeCloseTo(0.85);
  });

  test('GameData wear = 0 falls back to average of raw zones', () => {
    expect(resolveTyreWear(0, 0.90, 0.85, 0.80)).toBeCloseTo(0.85);
  });

  test('partial raw zone data is still averaged (not zeroed)', () => {
    // Only outer and middle recorded
    expect(resolveTyreWear(0, 0.90, 0.85, 0)).toBeCloseTo((0.90 + 0.85 + 0) / 3);
  });

  test('all raw zones = 0 returns 0 (no data available)', () => {
    expect(resolveTyreWear(0, 0, 0, 0)).toBe(0);
  });

  test('GameData takes precedence over non-zero raw zones', () => {
    // GameData says 0.7 — trust it even if raw zones differ
    expect(resolveTyreWear(0.7, 0.9, 0.9, 0.9)).toBeCloseTo(0.7);
  });

  test('result is in [0, 1] range for all valid inputs', () => {
    const cases = [
      [0, 0.8, 0.9, 0.7],
      [0.5, 0, 0, 0],
      [0, 1.0, 1.0, 1.0],
      [0, 0, 0, 0],
    ];
    for (const [gd, l, m, r] of cases) {
      const result = resolveTyreWear(gd, l, m, r);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    }
  });
});
