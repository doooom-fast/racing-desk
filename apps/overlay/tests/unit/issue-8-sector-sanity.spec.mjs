/**
 * Issue #8 — Sector time sanity check
 *
 * iRacing occasionally sends the cumulative lap time as the last sector
 * split value. The fix detects this: if split >= sum of all other sector
 * splits, the value is suppressed and shown as '—'.
 */

import { test, expect } from '@playwright/test';

// Re-implementation of the sanity check from poll-engine.js
function sectorLooksLikeFullLap(splits, sectorIndex) {
  const split = splits[sectorIndex];
  if (split <= 0) return false;
  let sumOthers = 0;
  for (let k = 0; k < splits.length; k++) {
    if (k !== sectorIndex && splits[k] > 0) sumOthers += splits[k];
  }
  return sumOthers > 0 && split >= sumOthers;
}

test.describe('Issue #8 — Sector sanity check', () => {

  test('normal sector splits are not flagged', () => {
    // Lap ~90s split into three clean sectors
    const splits = [28.4, 31.2, 30.1];
    expect(sectorLooksLikeFullLap(splits, 0)).toBe(false);
    expect(sectorLooksLikeFullLap(splits, 1)).toBe(false);
    expect(sectorLooksLikeFullLap(splits, 2)).toBe(false);
  });

  test('last sector containing full lap time is flagged', () => {
    // iRacing sends cumulative lap time (~89.7s) as S3 instead of ~30s
    const splits = [28.4, 31.2, 89.7];
    expect(sectorLooksLikeFullLap(splits, 2)).toBe(true);
  });

  test('first sector containing full lap time is flagged', () => {
    const splits = [89.7, 31.2, 30.1];
    expect(sectorLooksLikeFullLap(splits, 0)).toBe(true);
  });

  test('zero split is never flagged', () => {
    // Split not yet recorded
    const splits = [28.4, 31.2, 0];
    expect(sectorLooksLikeFullLap(splits, 2)).toBe(false);
  });

  test('split equal to sum of others is flagged (boundary)', () => {
    // S2 = S1 + S3 exactly — treat as cumulative
    const splits = [30, 60, 30];
    expect(sectorLooksLikeFullLap(splits, 1)).toBe(true);
  });

  test('split just below sum of others is not flagged', () => {
    const splits = [30, 59.9, 30];
    expect(sectorLooksLikeFullLap(splits, 1)).toBe(false);
  });

  test('single known sector (others all zero) is not flagged', () => {
    // Only S1 recorded so far — sumOthers = 0, can't determine
    const splits = [28.4, 0, 0];
    expect(sectorLooksLikeFullLap(splits, 0)).toBe(false);
  });

  test('two-sector track: last sector is checked correctly', () => {
    const splits = [44.1, 90.3];  // S2 is the full lap time
    expect(sectorLooksLikeFullLap(splits, 1)).toBe(true);
  });

  test('four-sector track: bogus last sector is flagged', () => {
    const splits = [22.1, 24.3, 21.8, 91.5];
    expect(sectorLooksLikeFullLap(splits, 3)).toBe(true);
    // Others are still valid
    expect(sectorLooksLikeFullLap(splits, 0)).toBe(false);
    expect(sectorLooksLikeFullLap(splits, 1)).toBe(false);
    expect(sectorLooksLikeFullLap(splits, 2)).toBe(false);
  });
});
