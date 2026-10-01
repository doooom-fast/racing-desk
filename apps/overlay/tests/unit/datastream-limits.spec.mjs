/**
 * The datastream's two rows for what the rig is set to (dashboard.html, datastream.js): "FFB max", the wheel's
 * full-output force from iRacing's own SteeringWheelMaxForceNm (DS.SteerMaxForceNm, sent only where the sim says it), and
 * "Brake max", SmartControl's brake force in kg as the app's host follows it, handed to the page by the main process
 * (rig-limits.js, through the preload). Each is a dash while not known — no key, no main process, the demo — and never a
 * number of the page's own. They are the rig HUD's rows: the glance layout has no room for them.
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { MOCK_TELEMETRY, MOCK_DEMO } from '../helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD = pathToFileURL(path.resolve(__dirname, '..', '..', 'dashboard.html')).href;

const KEY = 'RacingDesk.Plugin.DS.SteerMaxForceNm';
const WITH_WHEEL = { ...MOCK_TELEMETRY, 'RacingDesk.Plugin.DS.SteerTorque': 7.8, [KEY]: 29.7 };

// The dashboard over a plugin that serves whatever it was last given; with `main`, the app's preload behind it, which
// knows the brake force (`limits`) and his settings.
async function openWith(page, payload, { main = false, limits = null, settings = null } = {}) {
  await page.route(/^https?:\/\//, (route) => route.abort());
  await page.addInitScript(({ first, withMain, first_limits, first_settings }) => {
    window.__feed = { payload: first };
    const realFetch = window.fetch;
    window.fetch = function (url) {
      if (!/^http:\/\/localhost:8889\/racing-desk\/$/.test(String(url))) return realFetch.apply(this, arguments);
      return Promise.resolve(new Response(JSON.stringify(window.__feed.payload), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    };
    if (withMain) {
      const known = {
        inCarFromMain: true,
        onInRaceState: (callback) => { window.__mainSays = callback; },
        getInRaceState: async () => true,
        getSettings: async () => first_settings,
        onRigLimits: (callback) => { window.__limitsFromMain = callback; },
        getRigLimits: async () => first_limits,
      };
      window.racingDesk = new Proxy(known, { get: (t, k) => (k in t ? t[k] : () => Promise.resolve(null)) });
    }
  }, { first: payload, withMain: main, first_limits: limits, first_settings: settings });
  await page.goto(DASHBOARD, { waitUntil: 'load' });
  if (main) {
    await page.waitForFunction(() => typeof window.__mainSays === 'function');
    await page.evaluate(() => window.__mainSays(true));
  }
}
const serve = (page, payload) => page.evaluate((p) => { window.__feed.payload = p; }, payload);
const rows = (page) => page.evaluate(() => {
  const row = (id) => {
    const el = document.getElementById(id);
    const r = el.closest('.ds-row');
    return { text: el.textContent, label: r.querySelector('.ds-label').textContent, shown: getComputedStyle(r).display !== 'none' };
  };
  return { ffb: row('dsSteerTorque'), ffbMax: row('dsFfbMax'), brakeMax: row('dsBrakeMax') };
});

test.describe('the rows', () => {
  test('the wheel\'s from the frame, the brake\'s from the main process, each with its unit', async ({ page }) => {
    await openWith(page, WITH_WHEEL, { main: true, limits: { brakeKg: 45, car: 'mx5 mx52016' } });
    await expect(page.locator('#dsFfbMax')).toHaveText('29.7 Nm');
    await expect(page.locator('#dsBrakeMax')).toHaveText('45 kg');
    const r = await rows(page);
    expect(r.ffb.text).toBe('7.8 Nm');
    expect([r.ffbMax.label, r.brakeMax.label]).toEqual(['FFB max', 'Brake max']);
    expect([r.ffbMax.shown, r.brakeMax.shown]).toEqual([true, true]);
    // The rows sit under FFB, in the panel's order.
    expect(await page.evaluate(() => [...document.querySelectorAll('.ds-inner .ds-row')].map((r) => r.querySelector('.ds-label').textContent).slice(0, 7))).toEqual(['Lat', 'Long', 'Peak', 'Yaw', 'FFB', 'FFB max', 'Brake max']);
  });

  test('the main process telling the page a change: a new force, a half, then not known', async ({ page }) => {
    await openWith(page, WITH_WHEEL, { main: true, limits: { brakeKg: 45, car: 'mx5 mx52016' } });
    await expect(page.locator('#dsBrakeMax')).toHaveText('45 kg');
    await page.evaluate(() => window.__limitsFromMain({ brakeKg: 47.5, car: 'mx5 mx52016' }));
    await expect(page.locator('#dsBrakeMax')).toHaveText('47.5 kg');
    await page.evaluate(() => window.__limitsFromMain({ brakeKg: null, car: 'mx5 mx52016' }));
    await expect(page.locator('#dsBrakeMax')).toHaveText('—');
    await page.evaluate(() => window.__limitsFromMain({ brakeKg: 'forty', car: null }));
    await expect(page.locator('#dsBrakeMax')).toHaveText('—');
    await page.evaluate(() => window.__limitsFromMain(null));
    await expect(page.locator('#dsBrakeMax')).toHaveText('—');
  });

  test('a dash where it is not known: no key from the sim, no main process behind the page, and never a number made up', async ({ page }) => {
    await openWith(page, { ...MOCK_TELEMETRY, 'RacingDesk.Plugin.DS.SteerTorque': 7.8 });
    await expect(page.locator('#dsSteerTorque')).toHaveText('7.8 Nm');
    expect((await rows(page)).ffbMax.text).toBe('—');
    expect((await rows(page)).brakeMax.text).toBe('—');
    // A key that says nought, or nonsense, is not a force.
    await serve(page, { ...WITH_WHEEL, [KEY]: 0 });
    await page.waitForTimeout(150);
    expect((await rows(page)).ffbMax.text).toBe('—');
    await serve(page, { ...WITH_WHEEL, [KEY]: 'strong' });
    await page.waitForTimeout(150);
    expect((await rows(page)).ffbMax.text).toBe('—');
    await serve(page, WITH_WHEEL);
    await expect(page.locator('#dsFfbMax')).toHaveText('29.7 Nm');
    await serve(page, { ...WITH_WHEEL, [KEY]: 33.9 });
    await expect(page.locator('#dsFfbMax')).toHaveText('33.9 Nm');
  });

  test('the demo has no wheel: a dash, whatever a frame of it carries', async ({ page }) => {
    await openWith(page, { ...MOCK_DEMO, [KEY]: 29.7, 'RacingDesk.Plugin.Demo.DS.SteerTorque': 12.4 });
    await expect(page.locator('#dsSteerTorque')).toHaveText('12.4 Nm');
    expect((await rows(page)).ffbMax.text).toBe('—');
  });

  test('his switches: each row has one, on by default, and off takes the row away', async ({ page }) => {
    await openWith(page, WITH_WHEEL, { main: true, limits: { brakeKg: 45, car: 'mx5 mx52016' }, settings: { dsShowFfbMax: false, dsShowBrakeMax: true } });
    await expect(page.locator('#dsBrakeMax')).toHaveText('45 kg');
    await expect.poll(() => rows(page).then((r) => [r.ffbMax.shown, r.brakeMax.shown])).toEqual([false, true]);
  });

  test('the glance layout has no room for them: the rows are the rig HUD\'s', async ({ page }) => {
    await openWith(page, WITH_WHEEL, { main: true, limits: { brakeKg: 45, car: 'mx5 mx52016' } });
    await expect(page.locator('#dsBrakeMax')).toHaveText('45 kg');
    await page.evaluate(() => setDriveMode(true));
    // (The live FFB row is the cell's own business there: a short cell gives it up by container query.)
    await expect.poll(() => rows(page).then((r) => [r.ffbMax.shown, r.brakeMax.shown])).toEqual([false, false]);
    await page.evaluate(() => setDriveMode(false));
    await expect.poll(() => rows(page).then((r) => [r.ffbMax.shown, r.brakeMax.shown])).toEqual([true, true]);
  });
});
