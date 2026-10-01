/**
 * Issue #11 — Fuel unit detection
 *
 * parseInt('0') || 1 evaluates to 1 (metric) even when DisplayUnits=0 (imperial). The fix uses an explicit
 * null/empty check.
 *
 * The issue's second half, a tyre wear fallback that averaged iRacing's three tread bands when SimHub's value
 * read 0, used to be re-implemented here (as a plain mean, which the C# then inverted, which the HUD then
 * inverted again). Tyre wear now has one meaning — tread remaining, 0..100 %, converted once at each source and
 * nowhere else (root CLAUDE.md, Tyre wear) — and is held by the real code: IRacing/TyreWearTests.cs in the .NET
 * tests for the host, the plugin's capture (SimHub's value, then the bands), the trigger and the strategist, and
 * tyre-wear.spec.mjs here for the page.
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
