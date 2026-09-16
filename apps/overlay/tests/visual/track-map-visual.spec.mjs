/**
 * Visual-regression test for the track map panels.
 *
 * Catches the class of "it used to render, now it doesn't" bug that
 * the assert-the-d-attribute tests miss. If the track line disappears,
 * the pixel diff fails.
 *
 * First run writes baselines into __screenshots__/. Subsequent runs
 * diff against them. When an intentional visual change lands, re-run
 * with `--update-snapshots` to refresh the baselines.
 */

import { test, expect } from '@playwright/test';
import { loadDashboard, DASHBOARD_PATHS } from '../helpers.mjs';

// Deterministic track shape — a closed cubic-spline loop. Same maths
// the C# TrackMapProvider uses, so the shape is realistic but fixed.
function stableTrackPath() {
  const pts = [
    [20, 10], [50, 8],  [80, 12], [90, 35],
    [85, 60], [70, 75], [50, 80], [30, 78],
    [15, 65], [10, 45], [12, 28], [16, 18],
  ];
  const f = (n) => n.toFixed(2);
  const len = pts.length;
  let path = `M ${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 0; i < len; i++) {
    const p0 = pts[(i - 1 + len) % len];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % len];
    const p3 = pts[(i + 2) % len];
    const cx1 = p1[0] + (p2[0] - p0[0]) / 6;
    const cy1 = p1[1] + (p2[1] - p0[1]) / 6;
    const cx2 = p2[0] - (p3[0] - p1[0]) / 6;
    const cy2 = p2[1] - (p3[1] - p1[1]) / 6;
    path += ` C ${f(cx1)},${f(cy1)} ${f(cx2)},${f(cy2)} ${f(p2[0])},${f(p2[1])}`;
  }
  return path + ' Z';
}

// Freeze CSS animations and disable ambient-light color mutation so the
// screenshot is deterministic across runs.
async function freezeAnimations(page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }
    `,
  });
  await page.evaluate(() => {
    // Pin the map player color so ambient sampling can't shift it
    document.documentElement.style.setProperty('--map-player-color', '#00acc1');
  });
}

test.describe('Track map visual regression', () => {

  test('full + zoom maps render a visible track with player dot', async ({ page }) => {
    await loadDashboard(
      page,
      {
        'RaceCorProDrive.Plugin.TrackMap.Ready': 1,
        'RaceCorProDrive.Plugin.TrackMap.TrackName': 'Visual Test Track',
        'RaceCorProDrive.Plugin.TrackMap.SvgPath': stableTrackPath(),
        'RaceCorProDrive.Plugin.TrackMap.PlayerX': 50,
        'RaceCorProDrive.Plugin.TrackMap.PlayerY': 50,
        'RaceCorProDrive.Plugin.TrackMap.PlayerHeading': 0,
        'DataCorePlugin.GameData.SpeedMph': 0,   // tight zoom for stable framing
      },
      { dashboardPath: DASHBOARD_PATHS.original }
    );

    await freezeAnimations(page);
    // Give the smoothing filters (map radius, heading LERP) time to settle
    // on the fixed inputs. With animations zeroed above this is quick.
    await page.waitForTimeout(250);

    const mapsCol = page.locator('.maps-col');
    await expect(mapsCol).toBeVisible();
    await expect(mapsCol).toHaveScreenshot('maps-col-center.png', {
      maxDiffPixelRatio: 0.02,  // tolerate minor antialiasing differences
      animations: 'disabled',
    });
  });

  test('track map is blank when no path is provided', async ({ page }) => {
    await loadDashboard(
      page,
      {
        'RaceCorProDrive.Plugin.TrackMap.Ready': 0,
      },
      { dashboardPath: DASHBOARD_PATHS.original }
    );

    await freezeAnimations(page);
    await page.waitForTimeout(200);

    const mapsCol = page.locator('.maps-col');
    await expect(mapsCol).toHaveScreenshot('maps-col-blank.png', {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });
});
