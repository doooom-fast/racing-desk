/**
 * Track map — opponent reprojection into the API coordinate space.
 *
 * Regression: when the curated web-API outline is rendered (preferred over
 * the plugin's local recording), the player dot is remapped onto it by lap
 * distance — but opponent dots were drawn with the plugin's RAW coordinates,
 * which are normalized against a different recording. Result: the player sat
 * on the track while the other cars drove around "in the wilderness" beside it.
 *
 * window._reprojectOpponentsToApi (poll-engine.js) fixes this by snapping each
 * car to the plugin path to recover its lap fraction, then mapping that
 * fraction onto the API points — the same remap the player gets. These tests
 * exercise the REAL function loaded from the dashboard, not a mirror.
 */

import { test, expect } from '@playwright/test';
import { loadDashboard, DASHBOARD_PATHS } from '../helpers.mjs';

// Two normalizations of the SAME 16-point loop. The plugin space is a large
// circle (centre 50,50 r 30); the API space is the same loop shrunk and
// shifted (centre 40,40 r 15) — exactly the kind of mismatch a different
// bounding-box fit produces. Sharing the angle list guarantees point i in one
// space corresponds to point i in the other, so a car on plugin point i must
// land on API point i after reprojection.
const N = 16;
const ANGLES = Array.from({ length: N }, (_, i) => (2 * Math.PI * i) / N);
const pluginPt = (a) => ({ x: 50 + 30 * Math.cos(a), y: 50 + 30 * Math.sin(a) });
const apiPt = (a) => ({ x: 40 + 15 * Math.cos(a), y: 40 + 15 * Math.sin(a) });

const PLUGIN_PATH =
  'M ' +
  ANGLES.map((a) => {
    const p = pluginPt(a);
    return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
  }).join(' L ') +
  ' Z';

const API_PTS = ANGLES.map((a, i) => {
  const p = apiPt(a);
  return { x: p.x, y: p.y, p: i / N };
});

// Distance from a point to the nearest vertex of the API loop.
function distToApiLoop(x, y) {
  let best = Infinity;
  for (const a of ANGLES) {
    const p = apiPt(a);
    best = Math.min(best, Math.hypot(x - p.x, y - p.y));
  }
  return best;
}

function reproject(page, oppStr, pluginPath, apiPts) {
  return page.evaluate(
    ([s, path, pts]) => window._reprojectOpponentsToApi(s, path, pts),
    [oppStr, pluginPath, apiPts]
  );
}

test.describe('Track map opponent reprojection', () => {
  test('exposes the reprojection helper from poll-engine', async ({ page }) => {
    await loadDashboard(page, {}, { dashboardPath: DASHBOARD_PATHS.original });
    const type = await page.evaluate(() => typeof window._reprojectOpponentsToApi);
    expect(type).toBe('function');
  });

  test('maps a car off the API outline back onto it', async ({ page }) => {
    await loadDashboard(page, {}, { dashboardPath: DASHBOARD_PATHS.original });

    // Car sits exactly on plugin point 4 — top of the big loop, (50, 80).
    const carIdx = 4;
    const car = pluginPt(ANGLES[carIdx]);
    const oppStr = `${car.x.toFixed(2)},${car.y.toFixed(2)},0`;

    // Before: the raw plugin coord is far from the (smaller, shifted) API loop.
    expect(distToApiLoop(car.x, car.y)).toBeGreaterThan(20);

    const out = await reproject(page, oppStr, PLUGIN_PATH, API_PTS);
    const [ox, oy] = out.split(',').map(Number);

    // After: the car lands on API point 4 — i.e. on the drawn track.
    const expected = apiPt(ANGLES[carIdx]);
    expect(ox).toBeCloseTo(expected.x, 1);
    expect(oy).toBeCloseTo(expected.y, 1);
    expect(distToApiLoop(ox, oy)).toBeLessThan(0.5);
  });

  test('preserves the in-pit flag and handles multiple cars', async ({ page }) => {
    await loadDashboard(page, {}, { dashboardPath: DASHBOARD_PATHS.original });

    const a = pluginPt(ANGLES[2]);
    const b = pluginPt(ANGLES[9]);
    const oppStr = `${a.x.toFixed(2)},${a.y.toFixed(2)},1;${b.x.toFixed(2)},${b.y.toFixed(2)},0`;

    const out = await reproject(page, oppStr, PLUGIN_PATH, API_PTS);
    const segs = out.split(';');
    expect(segs).toHaveLength(2);
    expect(segs[0].split(',')[2]).toBe('1'); // pit flag carried through
    expect(segs[1].split(',')[2]).toBe('0');

    // Each car lands on its corresponding API vertex.
    const [ax, ay] = segs[0].split(',').map(Number);
    const [bx, by] = segs[1].split(',').map(Number);
    expect(distToApiLoop(ax, ay)).toBeLessThan(0.5);
    expect(distToApiLoop(bx, by)).toBeLessThan(0.5);
  });

  test('returns the input unchanged when API points are unavailable', async ({ page }) => {
    await loadDashboard(page, {}, { dashboardPath: DASHBOARD_PATHS.original });

    const oppStr = '50.00,80.00,0';
    // No API points → nothing to map onto → leave the plugin coords as-is
    // (the outline being drawn is the plugin's own path in that case).
    const out = await reproject(page, oppStr, PLUGIN_PATH, []);
    expect(out).toBe(oppStr);
  });
});
