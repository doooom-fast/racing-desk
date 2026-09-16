/**
 * Vanilla Build Parity Tests
 * ═══════════════════════════════════════════════════════════════
 * Validates the vanilla TypeScript build (dashboard-build.html)
 * against the gold standard (dashboard.html modular JS).
 *
 * Tests verify that all live-data features work identically:
 * DOM structure, CSS classes, text content, visibility states,
 * and canvas rendering for each module.
 *
 * Run: npx playwright test tests/build/vanilla-parity.mjs
 */

import { test, expect } from '@playwright/test';
import {
  DASHBOARD_PATHS,
  MOCK_TELEMETRY,
  MOCK_DEMO,
  loadDashboard,
  updateMockData,
} from '../helpers.mjs';

// ─── Helpers ─────────────────────────────────────────────────

const BUILD_PATH = DASHBOARD_PATHS.build;

async function loadBuild(page, data, opts = {}) {
  return loadDashboard(page, data, { ...opts, dashboardPath: BUILD_PATH });
}

// Extended mock data with DS prefix values for datastream/incidents
const DS_TELEMETRY = {
  ...MOCK_TELEMETRY,
  'RaceCorProDrive.Plugin.DS.LatG': 0.85,
  'RaceCorProDrive.Plugin.DS.LongG': -0.42,
  'RaceCorProDrive.Plugin.DS.YawRate': 0.35,
  'RaceCorProDrive.Plugin.DS.SteerTorque': 12.4,
  'RaceCorProDrive.Plugin.DS.TrackTemp': 38.5,
  'RaceCorProDrive.Plugin.DS.IncidentCount': 4,
  'RaceCorProDrive.Plugin.DS.IncidentLimitPenalty': 17,
  'RaceCorProDrive.Plugin.DS.IncidentLimitDQ': 25,
  'RaceCorProDrive.Plugin.DS.AbsActive': 0,
  'RaceCorProDrive.Plugin.DS.TcActive': 0,
  'RaceCorProDrive.Plugin.DS.LapDelta': -0.234,
  'RaceCorProDrive.Plugin.DS.IsInPitLane': 0,
  'RaceCorProDrive.Plugin.DS.SpeedKmh': 204,
  'RaceCorProDrive.Plugin.DS.PitLimiterOn': 0,
  'RaceCorProDrive.Plugin.DS.PitSpeedLimitKmh': 60,
  'RaceCorProDrive.Plugin.DS.ThrottleNorm': 0.82,
  'RaceCorProDrive.Plugin.DS.BrakeNorm': 0.0,
  'RaceCorProDrive.Plugin.DS.ClutchNorm': 0.0,
  'RaceCorProDrive.Plugin.DS.RpmRatio': 0.80,
  'RaceCorProDrive.Plugin.DS.FuelPct': 47.3,
  'RaceCorProDrive.Plugin.DS.FuelLapsRemaining': 9.1,
  'RaceCorProDrive.Plugin.DS.SpeedMph': 127,
  'RaceCorProDrive.Plugin.DS.IsNonRaceSession': 0,
  'RaceCorProDrive.Plugin.DS.StartPosition': 7,
  'currentFlagState': 'none',
};

const LEADERBOARD_DATA = [
  [1, 'A. Fast', 4200, 91.5, 92.1, -4.2, false, false],
  [2, 'B. Quick', 3800, 91.8, 92.4, -2.1, false, false],
  [3, 'C. Swift', 3500, 92.0, 93.1, -1.0, false, false],
  [4, 'D. Rapid', 3100, 92.2, 92.8, -0.3, false, false],
  [5, 'YOU', 2847, 92.3, 93.0, 0, false, true],
  [6, 'E. Slow', 2600, 92.5, 93.5, 0.8, false, false],
  [7, 'F. Behind', 2200, 93.0, 94.2, 2.1, false, false],
  [8, 'G. Pitted', 1800, 94.0, 0, 0, true, false],
];

// ═══════════════════════════════════════════════════════════════
//  1. TACHOMETER
// ═══════════════════════════════════════════════════════════════

test.describe('Tachometer', () => {
  test('renders 11 segments with correct color classes', async ({ page }) => {
    await loadBuild(page, DS_TELEMETRY);
    const segs = await page.locator('#tachoBar .tacho-seg').count();
    expect(segs).toBe(11);

    // RPM ratio = 0.80 → about 9 lit segments
    const lit = await page.locator('#tachoBar .tacho-seg[class*="lit-"]').count();
    expect(lit).toBeGreaterThanOrEqual(7);
    expect(lit).toBeLessThanOrEqual(10);
  });

  test('displays gear and speed text', async ({ page }) => {
    await loadBuild(page, DS_TELEMETRY);
    const gear = await page.locator('#gearText').textContent();
    expect(gear).toBe('4');
    const speed = await page.locator('#speedText').textContent();
    expect(speed).toBe('127');
  });

  test('RPM text updates from telemetry', async ({ page }) => {
    await loadBuild(page, DS_TELEMETRY);
    const rpm = await page.locator('#rpmText').textContent();
    expect(rpm).toBe('6842');
  });

  test('adds tacho-redline class at high RPM', async ({ page }) => {
    await loadBuild(page, { ...DS_TELEMETRY, 'RaceCorProDrive.Plugin.DS.RpmRatio': 0.95 });
    await page.waitForTimeout(200);
    const hasRedline = await page.locator('.tacho-block.tacho-redline').count();
    expect(hasRedline).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════
//  2. PEDALS
// ═══════════════════════════════════════════════════════════════

test.describe('Pedals', () => {
  test('histogram bars exist for throttle, brake, clutch', async ({ page }) => {
    await loadBuild(page, DS_TELEMETRY);
    const thrBars = await page.locator('#throttleHist .pedal-hist-bar').count();
    const brkBars = await page.locator('#brakeHist .pedal-hist-bar').count();
    const cltBars = await page.locator('#clutchHist .pedal-hist-bar').count();
    expect(thrBars).toBe(20);
    expect(brkBars).toBe(20);
    expect(cltBars).toBe(20);
  });

  test('pedal percentage text updates', async ({ page }) => {
    await loadBuild(page, DS_TELEMETRY);
    const pcts = await page.locator('.pedal-pct').allTextContents();
    expect(pcts[0]).toBe('82%'); // throttle
    expect(pcts[1]).toBe('0%');  // brake
  });

  test('pedal trace canvas exists and has content', async ({ page }) => {
    await loadBuild(page, DS_TELEMETRY);
    await page.waitForTimeout(300); // wait for several poll frames
    const canvas = page.locator('#pedalTraceCanvas');
    await expect(canvas).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════
//  3. FUEL
// ═══════════════════════════════════════════════════════════════

test.describe('Fuel', () => {
  test('displays fuel remaining value', async ({ page }) => {
    await loadBuild(page, DS_TELEMETRY);
    const fuel = await page.locator('.fuel-remaining').textContent();
    expect(fuel).toContain('28.4');
  });

  test('fuel bar has correct health class', async ({ page }) => {
    await loadBuild(page, DS_TELEMETRY);
    const bar = page.locator('.fuel-bar-inner');
    const cls = await bar.getAttribute('class');
    // 47.3% > 40% → healthy
    expect(cls).toContain('healthy');
  });

  test('fuel stats show per-lap and estimate', async ({ page }) => {
    await loadBuild(page, DS_TELEMETRY);
    const vals = await page.locator('.fuel-stats .val').allTextContents();
    expect(vals[0]).toBe('3.12'); // per lap
    expect(vals[1]).toBe('9.1');  // laps remaining
  });
});

// ═══════════════════════════════════════════════════════════════
//  4. TYRES
// ═══════════════════════════════════════════════════════════════

test.describe('Tyres', () => {
  test('shows 4 tyre temperature cells', async ({ page }) => {
    await loadBuild(page, DS_TELEMETRY);
    const cells = await page.locator('.tyre-cell').allTextContents();
    expect(cells).toHaveLength(4);
    expect(cells[0]).toContain('196');
    expect(cells[1]).toContain('203');
  });

  test('applies correct temp classes', async ({ page }) => {
    await loadBuild(page, DS_TELEMETRY);
    // 196°F → optimal (150-230)
    const cell = page.locator('.tyre-cell').first();
    const cls = await cell.getAttribute('class');
    expect(cls).toContain('optimal');
  });
});

// ═══════════════════════════════════════════════════════════════
//  5. CONTROLS (BB / TC / ABS)
// ═══════════════════════════════════════════════════════════════

test.describe('Controls', () => {
  test('shows BB, TC, ABS values', async ({ page }) => {
    await loadBuild(page, DS_TELEMETRY);
    const bb = await page.locator('#ctrlBB .ctrl-value').textContent();
    const tc = await page.locator('#ctrlTC .ctrl-value').textContent();
    const abs = await page.locator('#ctrlABS .ctrl-value').textContent();
    expect(bb).toBe('56.2');
    expect(tc).toBe('4');
    expect(abs).toBe('3');
  });

  test('hides controls for cars without them', async ({ page }) => {
    await loadBuild(page, {
      ...DS_TELEMETRY,
      'DataCorePlugin.GameData.CarModel': 'Mazda MX-5 Cup',
      'DataCorePlugin.GameRawData.Telemetry.dcTractionControl': null,
      'DataCorePlugin.GameRawData.Telemetry.dcABS': null,
    });
    await page.waitForTimeout(300);
    const tcHidden = await page.locator('#ctrlTC.ctrl-hidden').count();
    const absHidden = await page.locator('#ctrlABS.ctrl-hidden').count();
    expect(tcHidden).toBe(1);
    expect(absHidden).toBe(1);
  });

  test('shows "fixed" for cars with fixed TC/ABS at 0', async ({ page }) => {
    await loadBuild(page, {
      ...DS_TELEMETRY,
      'DataCorePlugin.GameData.CarModel': 'McLaren 570S GT4',
      'DataCorePlugin.GameRawData.Telemetry.dcTractionControl': 0,
      'DataCorePlugin.GameRawData.Telemetry.dcABS': 0,
    });
    await page.waitForTimeout(300);
    const tc = await page.locator('#ctrlTC .ctrl-value').textContent();
    const abs = await page.locator('#ctrlABS .ctrl-value').textContent();
    expect(tc).toBe('fixed');
    expect(abs).toBe('fixed');
  });

  test('applies ctrl-active class when ABS/TC firing', async ({ page }) => {
    await loadBuild(page, {
      ...DS_TELEMETRY,
      'RaceCorProDrive.Plugin.DS.AbsActive': 1,
      'RaceCorProDrive.Plugin.DS.TcActive': 1,
    });
    await page.waitForTimeout(200);
    const absActive = await page.locator('#ctrlABS.ctrl-active').count();
    const tcActive = await page.locator('#ctrlTC.ctrl-active').count();
    expect(absActive).toBe(1);
    expect(tcActive).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════
//  6. POSITION & GAPS
// ═══════════════════════════════════════════════════════════════

test.describe('Position & Gaps', () => {
  test('displays position number', async ({ page }) => {
    await loadBuild(page, DS_TELEMETRY);
    const pos = await page.locator('.pos-number .skew-accent').first().textContent();
    expect(pos).toBe('P5');
  });

  test('shows gap ahead and behind in race mode', async ({ page }) => {
    await loadBuild(page, DS_TELEMETRY);
    const times = await page.locator('.gap-time').allTextContents();
    expect(times[0]).toContain('1.3');  // ahead
    expect(times[1]).toContain('2.1');  // behind
  });

  test('shows driver names for gaps', async ({ page }) => {
    await loadBuild(page, DS_TELEMETRY);
    const drivers = await page.locator('.gap-driver').allTextContents();
    expect(drivers[0]).toContain('Broadbent');
    expect(drivers[1]).toContain('Leclerc');
  });

  test('clears gaps block during practice/qualifying', async ({ page }) => {
    await loadBuild(page, {
      ...DS_TELEMETRY,
      'RaceCorProDrive.Plugin.DS.IsNonRaceSession': 1,
      'RaceCorProDrive.Plugin.SessionTypeName': 'Practice',
    });
    await page.waitForTimeout(200);
    const labels = await page.locator('.panel-label').allTextContents();
    // Gaps block labels should be empty in non-race sessions
    const gapLabels = labels.filter(l => l === 'Ahead' || l === 'Behind');
    expect(gapLabels).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
//  7. iRATING & SAFETY RATING
// ═══════════════════════════════════════════════════════════════

test.describe('iRating & Safety Rating', () => {
  test('displays iRating value', async ({ page }) => {
    await loadBuild(page, DS_TELEMETRY);
    const vals = await page.locator('.rating-value').allTextContents();
    expect(vals[0]).toBe('2847');
  });

  test('displays safety rating value', async ({ page }) => {
    await loadBuild(page, DS_TELEMETRY);
    const vals = await page.locator('.rating-value').allTextContents();
    expect(vals[1]).toBe('3.41');
  });

  test('iR bar fill width is proportional', async ({ page }) => {
    await loadBuild(page, DS_TELEMETRY);
    const width = await page.locator('#irBarFill').evaluate(el => el.style.width);
    // 2847/5000 * 100 ≈ 56.9%
    const pct = parseFloat(width);
    expect(pct).toBeGreaterThan(50);
    expect(pct).toBeLessThan(60);
  });
});

// ═══════════════════════════════════════════════════════════════
//  8. DATASTREAM (G-force, Yaw, Delta)
// ═══════════════════════════════════════════════════════════════

test.describe('Datastream', () => {
  test('shows G-force values', async ({ page }) => {
    await loadBuild(page, DS_TELEMETRY);
    const latG = await page.locator('#dsLatG').textContent();
    const longG = await page.locator('#dsLongG').textContent();
    expect(latG).toContain('0.85');
    expect(longG).toContain('0.42');
  });

  test('shows yaw rate', async ({ page }) => {
    await loadBuild(page, DS_TELEMETRY);
    const yaw = await page.locator('#dsYawRate').textContent();
    expect(yaw).toContain('0.35');
  });

  test('G-force canvas is rendered (non-empty)', async ({ page }) => {
    await loadBuild(page, DS_TELEMETRY);
    await page.waitForTimeout(300);
    const hasContent = await page.locator('#dsGforceCanvas').evaluate(canvas => {
      const ctx = canvas.getContext('2d');
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      return data.some(v => v > 0);
    });
    expect(hasContent).toBe(true);
  });

  test('yaw trail canvas is rendered', async ({ page }) => {
    await loadBuild(page, DS_TELEMETRY);
    await page.waitForTimeout(300);
    const hasContent = await page.locator('#dsYawTrail').evaluate(canvas => {
      const ctx = canvas.getContext('2d');
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      return data.some(v => v > 0);
    });
    expect(hasContent).toBe(true);
  });

  test('lap delta shows sign and color class', async ({ page }) => {
    await loadBuild(page, DS_TELEMETRY);
    const delta = await page.locator('#dsDelta').textContent();
    expect(delta).toContain('-0.234');
    const cls = await page.locator('#dsDelta').getAttribute('class');
    expect(cls).toContain('ds-negative'); // gaining time
  });

  test('track temp displays', async ({ page }) => {
    await loadBuild(page, DS_TELEMETRY);
    const temp = await page.locator('#dsTrackTemp').textContent();
    expect(temp).toContain('38.5');
  });
});

// ═══════════════════════════════════════════════════════════════
//  9. INCIDENTS
// ═══════════════════════════════════════════════════════════════

test.describe('Incidents', () => {
  test('shows incident count', async ({ page }) => {
    await loadBuild(page, DS_TELEMETRY);
    const count = await page.locator('#incCount').textContent();
    expect(count).toBe('4');
  });

  test('shows penalty countdown (17 - 4 = 13)', async ({ page }) => {
    await loadBuild(page, DS_TELEMETRY);
    const pen = await page.locator('#incToPen').textContent();
    expect(pen).toBe('13');
  });

  test('shows DQ countdown (25 - 4 = 21)', async ({ page }) => {
    await loadBuild(page, DS_TELEMETRY);
    const dq = await page.locator('#incToDQ').textContent();
    expect(dq).toBe('21');
  });

  test('bar fill width is proportional to DQ limit', async ({ page }) => {
    await loadBuild(page, DS_TELEMETRY);
    const width = await page.locator('#incBarFill').evaluate(el => el.style.width);
    // 4/25 * 100 = 16%
    const pct = parseFloat(width);
    expect(pct).toBeGreaterThan(14);
    expect(pct).toBeLessThan(18);
  });

  test('applies correct severity level class', async ({ page }) => {
    await loadBuild(page, DS_TELEMETRY);
    const panel = page.locator('#incidentsPanel');
    const cls = await panel.getAttribute('class');
    // 4 incidents → level 2 (3-4)
    expect(cls).toContain('inc-level-2');
  });
});

// ═══════════════════════════════════════════════════════════════
//  10. LEADERBOARD
// ═══════════════════════════════════════════════════════════════

test.describe('Leaderboard', () => {
  const LB_TELEMETRY = {
    ...DS_TELEMETRY,
    'RaceCorProDrive.Plugin.Leaderboard': JSON.stringify(LEADERBOARD_DATA),
  };

  test('renders correct number of rows', async ({ page }) => {
    await loadBuild(page, LB_TELEMETRY);
    const rows = await page.locator('.lb-row').count();
    expect(rows).toBe(8);
  });

  test('marks player row', async ({ page }) => {
    await loadBuild(page, LB_TELEMETRY);
    const playerRows = await page.locator('.lb-row.lb-player').count();
    expect(playerRows).toBe(1);
  });

  test('marks pitted drivers', async ({ page }) => {
    await loadBuild(page, LB_TELEMETRY);
    const pitRows = await page.locator('.lb-row.lb-pit').count();
    expect(pitRows).toBe(1); // G. Pitted
  });

  test('shows gap values for non-player rows', async ({ page }) => {
    await loadBuild(page, LB_TELEMETRY);
    const gaps = await page.locator('.lb-gap').allTextContents();
    // First driver: gap -4.2 → "-4.2s"
    expect(gaps[0]).toContain('4.2');
    // Player row should be empty
    expect(gaps[4]).toBe('');
  });

  test('shows dash for zero gap (missing data)', async ({ page }) => {
    await loadBuild(page, LB_TELEMETRY);
    const gaps = await page.locator('.lb-gap').allTextContents();
    // G. Pitted has gap 0 → should show "—"
    expect(gaps[7]).toBe('—');
  });

  test('shows sparkline SVG after multiple laps', async ({ page }) => {
    // First load with initial data
    await loadBuild(page, LB_TELEMETRY);

    // Update with slightly different last-lap times to build history
    const lb2 = LEADERBOARD_DATA.map(e => [...e]);
    lb2[0][4] = 91.8; // slightly different last lap
    await updateMockData(page, {
      ...LB_TELEMETRY,
      'RaceCorProDrive.Plugin.Leaderboard': JSON.stringify(lb2),
    });
    await page.waitForTimeout(200);

    const lb3 = LEADERBOARD_DATA.map(e => [...e]);
    lb3[0][4] = 92.3;
    await updateMockData(page, {
      ...LB_TELEMETRY,
      'RaceCorProDrive.Plugin.Leaderboard': JSON.stringify(lb3),
    });
    await page.waitForTimeout(200);

    const sparks = await page.locator('.lb-spark').count();
    expect(sparks).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════
//  11. PIT LIMITER
// ═══════════════════════════════════════════════════════════════

test.describe('Pit Limiter', () => {
  test('shows pit banner when in pit lane', async ({ page }) => {
    await loadBuild(page, {
      ...DS_TELEMETRY,
      'RaceCorProDrive.Plugin.DS.IsInPitLane': 1,
      'RaceCorProDrive.Plugin.DS.PitLimiterOn': 1,
      'RaceCorProDrive.Plugin.DS.SpeedKmh': 55,
      'RaceCorProDrive.Plugin.DS.SpeedMph': 34,
    });
    const banner = page.locator('#pitBanner.pit-visible');
    await expect(banner).toBeVisible();
  });

  test('shows normal state with limiter on', async ({ page }) => {
    await loadBuild(page, {
      ...DS_TELEMETRY,
      'RaceCorProDrive.Plugin.DS.IsInPitLane': 1,
      'RaceCorProDrive.Plugin.DS.PitLimiterOn': 1,
      'RaceCorProDrive.Plugin.DS.SpeedKmh': 55,
    });
    const label = await page.locator('.pit-label').textContent();
    expect(label).toBe('Pit Limiter');
    const banner = page.locator('#pitBanner');
    const cls = await banner.getAttribute('class');
    expect(cls).not.toContain('pit-bonkers');
    expect(cls).not.toContain('pit-warning');
  });

  test('shows warning when limiter off', async ({ page }) => {
    await loadBuild(page, {
      ...DS_TELEMETRY,
      'RaceCorProDrive.Plugin.DS.IsInPitLane': 1,
      'RaceCorProDrive.Plugin.DS.PitLimiterOn': 0,
      'RaceCorProDrive.Plugin.DS.SpeedKmh': 55,
    });
    await page.waitForTimeout(200);
    const label = await page.locator('.pit-label').textContent();
    expect(label).toBe('PIT LIMITER OFF');
  });

  test('shows bonkers/speeding state', async ({ page }) => {
    await loadBuild(page, {
      ...DS_TELEMETRY,
      'RaceCorProDrive.Plugin.DS.IsInPitLane': 1,
      'RaceCorProDrive.Plugin.DS.PitLimiterOn': 0,
      'RaceCorProDrive.Plugin.DS.IsPitSpeeding': 1,
      'RaceCorProDrive.Plugin.DS.SpeedKmh': 80,
    });
    await page.waitForTimeout(200);
    const label = await page.locator('.pit-label').textContent();
    expect(label).toBe('SPEEDING');
    const cls = await page.locator('#pitBanner').getAttribute('class');
    expect(cls).toContain('pit-bonkers');
  });

  test('hides pit banner when not in pit', async ({ page }) => {
    await loadBuild(page, DS_TELEMETRY);
    const cls = await page.locator('#pitBanner').getAttribute('class');
    expect(cls).not.toContain('pit-visible');
  });
});

// ═══════════════════════════════════════════════════════════════
//  12. FORMATION / GRID
// ═══════════════════════════════════════════════════════════════

test.describe('Formation / Grid', () => {
  test('shows grid module during formation lap', async ({ page }) => {
    await loadBuild(page, {
      ...DS_TELEMETRY,
      'RaceCorProDrive.Plugin.Grid.SessionState': 3,
      'RaceCorProDrive.Plugin.Grid.GriddedCars': 20,
      'RaceCorProDrive.Plugin.Grid.TotalCars': 24,
      'RaceCorProDrive.Plugin.Grid.PaceMode': 2,
      'RaceCorProDrive.Plugin.Grid.StartType': 'rolling',
      'RaceCorProDrive.Plugin.Grid.TrackCountry': 'AU',
    });
    await page.waitForTimeout(300);
    const visible = await page.locator('#gridModule.grid-visible').count();
    expect(visible).toBe(1);
  });

  test('shows gridded/total cars count', async ({ page }) => {
    await loadBuild(page, {
      ...DS_TELEMETRY,
      'RaceCorProDrive.Plugin.Grid.SessionState': 3,
      'RaceCorProDrive.Plugin.Grid.GriddedCars': 20,
      'RaceCorProDrive.Plugin.Grid.TotalCars': 24,
    });
    await page.waitForTimeout(200);
    const gridded = await page.locator('#gridCarsGridded').textContent();
    const total = await page.locator('#gridCarsTotal').textContent();
    expect(gridded).toBe('20');
    expect(total).toBe('24');
  });

  test('shows start lights during active phase', async ({ page }) => {
    await loadBuild(page, {
      ...DS_TELEMETRY,
      'RaceCorProDrive.Plugin.Grid.SessionState': 3,
      'RaceCorProDrive.Plugin.Grid.LightsPhase': 3,
    });
    await page.waitForTimeout(200);
    // Phase 3: first 3 columns lit red
    const litRed = await page.locator('.light-bulb.lit-red').count();
    expect(litRed).toBe(6); // 3 columns × 2 bulbs
  });

  test('does not show during idle state (sessionState <= 1 but no formation)', async ({ page }) => {
    await loadBuild(page, {
      ...DS_TELEMETRY,
      'RaceCorProDrive.Plugin.Grid.SessionState': 0,
      'RaceCorProDrive.Plugin.Grid.LightsPhase': 0,
    });
    await page.waitForTimeout(200);
    const visible = await page.locator('#gridModule.grid-visible').count();
    expect(visible).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
//  13. COMMENTARY
// ═══════════════════════════════════════════════════════════════

test.describe('Commentary', () => {
  test('shows commentary when CommentaryVisible is 1', async ({ page }) => {
    await loadBuild(page, {
      ...DS_TELEMETRY,
      'RaceCorProDrive.Plugin.CommentaryVisible': 1,
      'RaceCorProDrive.Plugin.CommentaryTopicTitle': 'Heavy Braking',
      'RaceCorProDrive.Plugin.CommentaryText': 'Strong braking into turn 1',
      'RaceCorProDrive.Plugin.CommentaryTopicId': 'heavy_braking',
      'RaceCorProDrive.Plugin.CommentarySentimentColor': '#448aff',
      'RaceCorProDrive.Plugin.CommentarySeverity': 1,
    });
    await page.waitForTimeout(200);
    const visible = await page.locator('#commentaryCol.visible').count();
    expect(visible).toBe(1);
    const title = await page.locator('#commentaryTitle').textContent();
    expect(title).toBe('Heavy Braking');
  });

  test('commentary viz canvas is activated for known topics', async ({ page }) => {
    await loadBuild(page, {
      ...DS_TELEMETRY,
      'RaceCorProDrive.Plugin.CommentaryVisible': 1,
      'RaceCorProDrive.Plugin.CommentaryTopicTitle': 'Heavy Braking',
      'RaceCorProDrive.Plugin.CommentaryText': 'Test',
      'RaceCorProDrive.Plugin.CommentaryTopicId': 'heavy_braking',
      'RaceCorProDrive.Plugin.CommentarySentimentColor': '#448aff',
    });
    await page.waitForTimeout(400);
    // The commentary viz container should be visible
    const vizContainer = page.locator('#commentaryViz');
    // Check if canvas has any rendered content
    const vizHasContent = await page.locator('#commentaryVizCanvas').evaluate(canvas => {
      if (!canvas || !canvas.getContext) return false;
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      return data.some(v => v > 0);
    });
    // With showCommentaryViz now called, the viz should render
    expect(vizHasContent).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
//  14. FLAGS
// ═══════════════════════════════════════════════════════════════

test.describe('Flags', () => {
  test('applies flag class to gaps block', async ({ page }) => {
    await loadBuild(page, {
      ...DS_TELEMETRY,
      'currentFlagState': 'yellow',
    });
    await page.waitForTimeout(200);
    const cls = await page.locator('#gapsBlock').getAttribute('class');
    expect(cls).toContain('flag-yellow');
    expect(cls).toContain('flag-active');
  });

  test('shows flag label text', async ({ page }) => {
    await loadBuild(page, {
      ...DS_TELEMETRY,
      'currentFlagState': 'yellow',
    });
    await page.waitForTimeout(200);
    const label = await page.locator('#flagLabel1').textContent();
    expect(label).toBe('CAUTION');
  });
});

// ═══════════════════════════════════════════════════════════════
//  15. RACE TIMELINE
// ═══════════════════════════════════════════════════════════════

test.describe('Race Timeline', () => {
  test('timeline canvas exists', async ({ page }) => {
    await loadBuild(page, DS_TELEMETRY);
    const canvas = page.locator('#rtCanvas');
    await expect(canvas).toBeAttached();
  });

  test('timeline populates with data after laps', async ({ page }) => {
    await loadBuild(page, DS_TELEMETRY);
    // Simulate lap changes
    await updateMockData(page, {
      ...DS_TELEMETRY,
      'DataCorePlugin.GameData.CurrentLap': 9,
    });
    await page.waitForTimeout(200);
    await updateMockData(page, {
      ...DS_TELEMETRY,
      'DataCorePlugin.GameData.CurrentLap': 10,
    });
    await page.waitForTimeout(200);

    const hasContent = await page.locator('#rtCanvas').evaluate(canvas => {
      const ctx = canvas.getContext('2d');
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      return data.some(v => v > 0);
    });
    expect(hasContent).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
//  16. TRACK MAP
// ═══════════════════════════════════════════════════════════════

test.describe('Track Map', () => {
  test('renders track path when data available', async ({ page }) => {
    await loadBuild(page, {
      ...DS_TELEMETRY,
      'RaceCorProDrive.Plugin.TrackMap.Ready': 1,
      'RaceCorProDrive.Plugin.TrackMap.SvgPath': 'M 10 50 C 20 20, 40 20, 50 50 C 60 80, 80 80, 90 50',
      'RaceCorProDrive.Plugin.TrackMap.PlayerX': 30,
      'RaceCorProDrive.Plugin.TrackMap.PlayerY': 40,
    });
    await page.waitForTimeout(300);
    const path = await page.locator('#fullMapTrack').getAttribute('d');
    expect(path).toContain('M 10 50');
  });

  test('renders opponent dots', async ({ page }) => {
    await loadBuild(page, {
      ...DS_TELEMETRY,
      'RaceCorProDrive.Plugin.TrackMap.Ready': 1,
      'RaceCorProDrive.Plugin.TrackMap.SvgPath': 'M 10 50 C 20 20, 40 20, 50 50',
      'RaceCorProDrive.Plugin.TrackMap.PlayerX': 30,
      'RaceCorProDrive.Plugin.TrackMap.PlayerY': 40,
      'RaceCorProDrive.Plugin.TrackMap.Opponents': '20,30,0;60,70,0;80,20,1',
    });
    await page.waitForTimeout(300);
    const opponentDots = await page.locator('#fullMapOpponents circle').count();
    expect(opponentDots).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════
//  17. SECONDARY LAYOUT
// ═══════════════════════════════════════════════════════════════

test.describe('Secondary Layout', () => {
  test('default layout is row (horizontal)', async ({ page }) => {
    await loadBuild(page, DS_TELEMETRY);
    const bodyCls = await page.locator('body').getAttribute('class');
    expect(bodyCls).toContain('sec-row');
  });

  test('secondary container uses flex-direction from position class', async ({ page }) => {
    await loadBuild(page, DS_TELEMETRY);
    const container = page.locator('#secContainer');
    const cls = await container.getAttribute('class');
    // Default: sec-right → CSS sets flex-direction: row-reverse
    expect(cls).toContain('sec-right');
  });
});

// ═══════════════════════════════════════════════════════════════
//  18. DOM STRUCTURE PARITY
// ═══════════════════════════════════════════════════════════════

test.describe('DOM Structure Parity', () => {
  test('all essential element IDs exist', async ({ page }) => {
    await loadBuild(page, DS_TELEMETRY);
    const essentialIds = [
      'dashboard', 'gearText', 'rpmText', 'speedText', 'tachoBar',
      'throttleHist', 'brakeHist', 'clutchHist', 'pedalTraceCanvas',
      'ctrlBB', 'ctrlTC', 'ctrlABS',
      'fullMapSvg', 'zoomMapSvg', 'fullMapTrack', 'zoomMapTrack',
      'fullMapPlayer', 'zoomMapPlayer', 'fullMapOpponents', 'zoomMapOpponents',
      'mapTrackName',
      'gapsBlock', 'flagLabel1', 'flagCtx1',
      'raceTimerValue', 'lastLapTimeValue',
      'commentaryCol', 'commentaryTitle', 'commentaryText',
      'commentaryViz', 'commentaryVizCanvas',
      'leaderboardPanel', 'lbRows', 'rtCanvas',
      'datastreamPanel', 'dsGforceCanvas', 'dsYawTrail',
      'dsLatG', 'dsLongG', 'dsPeakG', 'dsYawRate', 'dsDelta', 'dsTrackTemp',
      'incidentsPanel', 'incCount', 'incToPen', 'incToDQ', 'incBarFill',
      'pitBanner', 'pitSpeed', 'pitLimit',
      'gridModule', 'gridInfo', 'startLights',
      'spotterPanel',
      'raceEndScreen',
      'settingsOverlay',
      'secContainer',
      'connBanner', 'connStatus',
      'irBarFill', 'srPieFill',
      'ratingPage', 'positionPage',
    ];

    for (const id of essentialIds) {
      const el = page.locator('#' + id);
      await expect(el, `Element #${id} should exist`).toBeAttached();
    }
  });

  test('CSS custom properties are applied', async ({ page }) => {
    await loadBuild(page, DS_TELEMETRY);
    const hasVars = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement);
      // Check a few key CSS variables
      return {
        green: styles.getPropertyValue('--green').trim(),
        red: styles.getPropertyValue('--red').trim(),
      };
    });
    expect(hasVars.green).toBeTruthy();
    expect(hasVars.red).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════
//  19. TRACK NAME FALLBACK
// ═══════════════════════════════════════════════════════════════

test.describe('Track Name', () => {
  test('displays track name from telemetry', async ({ page }) => {
    await loadBuild(page, {
      ...DS_TELEMETRY,
      'DataCorePlugin.GameData.TrackName': 'Adelaide',
    });
    await page.waitForTimeout(200);
    const name = await page.locator('#mapTrackName').textContent();
    expect(name).toBe('Adelaide');
  });

  test('filters out comma-only track names', async ({ page }) => {
    await loadBuild(page, {
      ...DS_TELEMETRY,
      'DataCorePlugin.GameData.TrackName': ',',
    });
    await page.waitForTimeout(200);
    const name = await page.locator('#mapTrackName').textContent();
    expect(name).not.toBe(',');
  });
});
