/**
 * The HUD's page in Assetto Corsa and Assetto Corsa EVO (asked for 2026-10-09; the plan's step 2), through SimHub's
 * data as the plugin sends it — the real dashboard.html, headless, nothing reaching a port:
 *
 *   - in the car by the key the host sends from the game's status, with iRacing's session state at nought;
 *   - the three cells from the shared memory, in his words: Bias with its number, Anti-lock and Traction a dash until the
 *     aid has shown itself and On after (Assetto Corsa), a level or Off in EVO;
 *   - iRacing's panels not made up for another sim: the incidents panel hidden, the ratings' cycle held on the position
 *     page with no dots, the gaps' iRating lines empty, the leaderboard's iRating column empty;
 *   - the game's own logo asked for, and the body marked for the game;
 *   - and back in iRacing, every one of them as it was.
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { MOCK_TELEMETRY } from '../helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD = pathToFileURL(path.resolve(__dirname, '..', '..', 'dashboard.html')).href;

const CONTROLS_KEY = 'RacingDesk.Plugin.CarControls';
const ON_TRACK = 'DataCorePlugin.GameRawData.Telemetry.IsOnTrack';

// The three cells as the host sends them for an Assetto Corsa car (RacingDesk.Core.Cars.AcCarControls): bias read, the aids
// not yet seen working.
const AC_CAR = 'ks_porsche_911_gt3_r_2016';
const acControls = ({ abs = 'unread', tc = 'unread' } = {}) => ({
  car: AC_CAR, name: AC_CAR, kind: '',
  abs: { id: 'abs', label: 'ABS', words: 'Anti-lock', state: abs, ...(abs === 'on' ? { text: 'On' } : {}), var: 'Physics.Abs' },
  tc: { id: 'tc', label: 'TC', words: 'Traction', state: tc, ...(tc === 'on' ? { text: 'On' } : {}), var: 'Physics.TC' },
  bb: { id: 'brakeBias', label: 'BB', words: 'Bias', state: 'value', value: 57.2, var: 'Physics.BrakeBias' },
});
const evoControls = () => ({
  car: 'ks_bmw_m4_gt3', name: 'ks_bmw_m4_gt3', kind: '',
  abs: { id: 'abs', label: 'ABS', words: 'Anti-lock', state: 'value', value: 3, var: 'Graphics.electronics.abs_level' },
  tc: { id: 'tc', label: 'TC', words: 'Traction', state: 'off', value: 0, text: 'Off', var: 'Graphics.electronics.tc_level' },
  bb: { id: 'brakeBias', label: 'BB', words: 'Bias', state: 'value', value: 54.8, var: 'Physics.brake_bias' },
});

// What the plugin sends in another sim: no iRating, no incidents, no flag field, no session state — and the host's key for
// being in the car.
const inSim = (game, controls) => ({
  ...MOCK_TELEMETRY,
  'RacingDesk.Plugin.GameId': game,
  'RacingDesk.Plugin.Grid.SessionState': 0,
  [ON_TRACK]: 1,
  [CONTROLS_KEY]: JSON.stringify(controls),
  'DataCorePlugin.GameData.CarModel': controls.car,
  'IRacingExtraProperties.iRacing_DriverInfo_IRating': 0,
  'IRacingExtraProperties.iRacing_DriverInfo_SafetyRating': 0,
  'IRacingExtraProperties.iRacing_Opponent_Ahead_IRating': 0,
  'IRacingExtraProperties.iRacing_Opponent_Behind_IRating': 0,
  'RacingDesk.Plugin.DS.EstimatedIRatingDelta': -2147483648,
  'RacingDesk.Plugin.DS.IncidentCount': 0,
  'DataCorePlugin.GameRawData.Telemetry.dcABS': 0,
  'DataCorePlugin.GameRawData.Telemetry.dcTractionControl': 0,
  'DataCorePlugin.GameRawData.Telemetry.dcBrakeBias': 57.2,
});
const IN_ASSETTO_CORSA = inSim('AssettoCorsa', acControls());
const IN_EVO = inSim('AssettoCorsaEVO', evoControls());
const IN_IRACING = MOCK_TELEMETRY;

// The dashboard by itself (no main process), over a plugin that serves whatever it was last given; the logos it asks for
// are counted and answered with a mark of their own.
async function openWith(page, payload) {
  await page.route(/^https?:\/\//, (route) => route.abort());
  await page.addInitScript(({ first }) => {
    const feed = { payload: first, logos: [] };
    window.__feed = feed;
    const realFetch = window.fetch;
    window.fetch = function (url) {
      const s = String(url);
      if (/^http:\/\/localhost:8889\/racing-desk\/$/.test(s)) {
        return Promise.resolve(new Response(JSON.stringify(feed.payload), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      const logo = /images\/logos\/([a-z0-9-]+\.svg)$/i.exec(s);
      if (logo) {
        feed.logos.push(logo[1]);
        return Promise.resolve(new Response(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" data-logo="${logo[1]}"></svg>`, { status: 200, headers: { 'Content-Type': 'image/svg+xml' } }));
      }
      return realFetch.apply(this, arguments);
    };
  }, { first: payload });
  await page.goto(DASHBOARD, { waitUntil: 'load' });
}

const serve = (page, payload) => page.evaluate((p) => { window.__feed.payload = p; }, payload);
const inCar = (page) => page.evaluate(() => _prevInRace);
const logos = (page) => page.evaluate(() => window.__feed.logos.slice());
const text = (page, selector) => page.locator(selector).evaluate((el) => el.textContent.trim());

test('Assetto Corsa: in the car by the status, the three cells in his words, iRacing\'s panels not made up', async ({ page }) => {
  await openWith(page, IN_ASSETTO_CORSA);
  await expect.poll(() => inCar(page)).toBe(true);
  await expect(page.locator('body')).toHaveClass(/game-ac\b/);
  await expect(page.locator('body')).not.toHaveClass(/game-iracing/);

  // The cells: the list's words, the bias to one place, the aids a dash until seen.
  await expect(page.locator('#ctrlBB .ctrl-value')).toHaveText('57.2');
  await expect(page.locator('#ctrlBB .ctrl-label')).toHaveText('Bias');
  await expect(page.locator('#ctrlABS .ctrl-value')).toHaveText('—');
  await expect(page.locator('#ctrlABS .ctrl-label')).toHaveText('Anti-lock');
  await expect(page.locator('#ctrlTC .ctrl-value')).toHaveText('—');
  await expect(page.locator('#ctrlTC .ctrl-label')).toHaveText('Traction');
  await expect(page.locator('#ctrlABS')).toHaveClass(/ctrl-unread/);
  await expect(page.locator('#ctrlABS')).not.toHaveClass(/ctrl-off/);

  // The anti-lock shows itself under braking: On, and it stays.
  await serve(page, inSim('AssettoCorsa', acControls({ abs: 'on' })));
  await expect(page.locator('#ctrlABS .ctrl-value')).toHaveText('On');
  await expect(page.locator('#ctrlABS')).toHaveClass(/ctrl-on/);
  await expect(page.locator('#ctrlTC .ctrl-value')).toHaveText('—');

  // iRacing's panels: the incidents hidden, the ratings' cycle on the position page with no dots, the ratings dashes.
  await expect(page.locator('#incidentsPanel')).toHaveClass(/game-hidden/);
  await expect(page.locator('#incidentsPanel')).toBeHidden();
  await expect(page.locator('#cycleRatingPos')).toHaveClass(/game-one-page/);
  await expect(page.locator('#positionPage')).toHaveClass(/active/);
  await expect(page.locator('#ratingPage')).toHaveClass(/inactive/);
  await expect(page.locator('#cycleRatingPos .cycle-dots')).toBeHidden();
  for (const value of await page.locator('#ratingPage .rating-value').allTextContents()) expect(value.trim()).toBe('—');
  for (const value of await page.locator('#ratingPage .rating-delta').allTextContents()) expect(value.trim()).toBe('—');
  expect(await page.evaluate(() => _hasRatingData)).toBe(false);
  // The gaps' iRating lines say nothing.
  for (const line of await page.locator('.gap-ir').allTextContents()) expect(line.trim()).toBe('');
  // The leaderboard has no iRating to show.
  expect(await page.locator('#lbRows').evaluate((el) => /\d\.\dk|\biRating\b/.test(el.textContent))).toBe(false);

  // The game's own logo was asked for, iRacing's not.
  await expect.poll(() => logos(page)).toContain('assetto-corsa.svg');
  expect(await logos(page)).not.toContain('iracing.svg');
});

test('out of the car in Assetto Corsa: a replay or the pause, by the same key', async ({ page }) => {
  await openWith(page, IN_ASSETTO_CORSA);
  await expect.poll(() => inCar(page)).toBe(true);
  await serve(page, { ...IN_ASSETTO_CORSA, [ON_TRACK]: 0 });
  await expect.poll(() => inCar(page), { timeout: 5000 }).toBe(false);
  await expect(page.locator('body')).toHaveClass(/idle-state/);
});

test('Assetto Corsa EVO: the levels where the game gives them, Off only on a car known to have the aid, its own logo', async ({ page }) => {
  await openWith(page, IN_EVO);
  await expect.poll(() => inCar(page)).toBe(true);
  await expect(page.locator('body')).toHaveClass(/game-acevo/);
  await expect(page.locator('#ctrlABS .ctrl-value')).toHaveText('3');
  await expect(page.locator('#ctrlTC .ctrl-value')).toHaveText('Off');
  await expect(page.locator('#ctrlTC')).toHaveClass(/ctrl-off/);
  await expect(page.locator('#ctrlBB .ctrl-value')).toHaveText('54.8');
  await expect(page.locator('#incidentsPanel')).toBeHidden();
  await expect(page.locator('#positionPage')).toHaveClass(/active/);
  await expect.poll(() => logos(page)).toContain('assetto-corsa-evo.svg');
});

test('back in iRacing everything is as it was', async ({ page }) => {
  await openWith(page, IN_ASSETTO_CORSA);
  await expect.poll(() => inCar(page)).toBe(true);
  await expect(page.locator('#incidentsPanel')).toBeHidden();

  await serve(page, IN_IRACING);
  await expect(page.locator('body')).toHaveClass(/game-iracing/);
  await expect(page.locator('body')).not.toHaveClass(/game-ac\b/);
  await expect(page.locator('#incidentsPanel')).not.toHaveClass(/game-hidden/);
  await expect(page.locator('#incidentsPanel')).toBeVisible();
  await expect(page.locator('#incCount')).toHaveText(/^\d+$/);
  await expect(page.locator('#incidentsPanel')).not.toHaveClass(/inc-none/);
  await expect(page.locator('#cycleRatingPos')).not.toHaveClass(/game-one-page/);
  await expect.poll(() => page.evaluate(() => _hasRatingData)).toBe(true);
  await expect(page.locator('#ratingPage .rating-value').first()).toHaveText('2.8k');
  // The old panel's three cells, from iRacing's own variables (the fixture has no list key).
  await expect(page.locator('#ctrlABS .ctrl-value')).toHaveText('3');
  await expect(page.locator('#ctrlTC .ctrl-value')).toHaveText('4');
  await expect.poll(() => logos(page)).toContain('iracing.svg');
});

test('the glance layout keeps the cells of its grid: the incidents card says a dash with no x, the ratings dashes', async ({ page }) => {
  await openWith(page, IN_ASSETTO_CORSA);
  await expect.poll(() => inCar(page)).toBe(true);
  await page.evaluate(() => document.body.classList.add('drive-mode-active'));
  await expect(page.locator('#incidentsPanel')).toBeVisible();
  await expect(page.locator('#incCount')).toHaveText('—');
  await expect(page.locator('#incidentsPanel')).toHaveClass(/inc-none/);
  await expect(page.locator('#incidentsPanel .inc-x')).toBeHidden();
  await expect(page.locator('#incidentsPanel .inc-thresholds')).toBeHidden();
  await expect(page.locator('#ratingPage')).toBeVisible();
  for (const value of await page.locator('#ratingPage .rating-value').allTextContents()) expect(value.trim()).toBe('—');
});
