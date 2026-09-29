/**
 * The HUD's page, in the car and out of it — the real dashboard.html, headless, nothing reaching a port.
 *
 * In the app main.js decides (modules/js/hud-visibility.js) and tells the page: out of the car the window is
 * hidden and the page must cost nothing, so it asks the telemetry for nothing until it is told he is in. A page
 * with no main process behind it — on an iPad, in a browser — decides for itself, by the same rule
 * (modules/js/in-car.js). It used to be unable to leave: the timer that was to say "out of the car" was re-armed
 * by every frame, so it ran only if the frames stopped.
 *
 * The telemetry is answered inside the page, and the page's own timer is asked what it was set to: headless, with
 * the effects drawn in software, the polls that get through in a second say little about the rate that was asked for.
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { MOCK_TELEMETRY } from '../helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD = pathToFileURL(path.resolve(__dirname, '..', '..', 'dashboard.html')).href;

const IN_THE_CAR = MOCK_TELEMETRY;
const AT_THE_MENUS = { ...MOCK_TELEMETRY, 'RacingDesk.Plugin.Grid.SessionState': 0 };

// The dashboard over a plugin that serves whatever it was last given, or does not answer at all.
// `main`: the page has the app's main process behind it, which said `inCarAtStart` before the page was listening.
async function openWith(page, { payload = IN_THE_CAR, main = false, inCarAtStart = false } = {}) {
  await page.route(/^https?:\/\//, (route) => route.abort());
  await page.addInitScript(({ first, withMain, atStart }) => {
    const feed = { payload: first, answering: true, polls: 0, everyMs: 0, frames: 0, fetches: 0 };
    window.__feed = feed;
    // Every frame asked for, by whatever asks: the page's own loop, the effects', anything else's.
    const realFrame = window.requestAnimationFrame;
    window.requestAnimationFrame = function () {
      feed.frames++;
      return realFrame.apply(this, arguments);
    };
    // What the poll's timer is set to: 33 in the car, 1000 or nothing at all (0) out of it.
    const realSet = window.setInterval;
    const realClear = window.clearInterval;
    let pollTimer = null;
    window.setInterval = function (fn, ms) {
      const id = realSet.apply(this, arguments);
      if (fn && fn.name === 'pollUpdate') { pollTimer = id; feed.everyMs = ms; }
      return id;
    };
    window.clearInterval = function (id) {
      if (id === pollTimer) { pollTimer = null; feed.everyMs = 0; }
      return realClear.apply(this, arguments);
    };
    const realFetch = window.fetch;
    window.fetch = function (url) {
      feed.fetches++;
      // A poll is the plugin's address and nothing after it; its ?action= calls go the way of the rest.
      if (!/^http:\/\/localhost:8889\/racing-desk\/$/.test(String(url))) return realFetch.apply(this, arguments);
      feed.polls++;
      if (!feed.answering) return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve(new Response(JSON.stringify(feed.payload), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    };
    if (withMain) {
      const known = {
        inCarFromMain: true,
        onInRaceState: (callback) => { window.__mainSays = callback; },
        getInRaceState: async () => atStart,
        getSettings: async () => null,
      };
      window.racingDesk = new Proxy(known, { get: (t, k) => (k in t ? t[k] : () => Promise.resolve(null)) });
    }
  }, { first: payload, withMain: main, atStart: inCarAtStart });
  await page.goto(DASHBOARD, { waitUntil: 'load' });
}

const serve = (page, payload) => page.evaluate((p) => { window.__feed.payload = p; }, payload);
const stopAnswering = (page) => page.evaluate(() => { window.__feed.answering = false; });
const polls = (page) => page.evaluate(() => window.__feed.polls);
const everyMs = (page) => page.evaluate(() => window.__feed.everyMs);
const mainSays = (page, inCar) => page.evaluate((v) => window.__mainSays(v), inCar);

// What the page has settled on.
const inCar = (page) => page.evaluate(() => _prevInRace);
const listening = (page) => page.evaluate(() => typeof window.__mainSays === 'function');

// Polls made in the next `ms`.
async function pollsIn(page, ms) {
  const before = await polls(page);
  await page.waitForTimeout(ms);
  return (await polls(page)) - before;
}

// Frames asked for and requests made — of any address — in the next `ms`.
async function workIn(page, ms) {
  const count = () => page.evaluate(() => ({ frames: window.__feed.frames, fetches: window.__feed.fetches }));
  const before = await count();
  await page.waitForTimeout(ms);
  const after = await count();
  return { frames: after.frames - before.frames, fetches: after.fetches - before.fetches };
}

test.describe('in the app: main.js decides', () => {
  test('out of the car the page asks the telemetry for nothing', async ({ page }) => {
    await openWith(page, { main: true });
    await expect.poll(() => listening(page)).toBe(true);
    await page.waitForTimeout(2500);
    expect(await polls(page)).toBe(0);
    expect(await everyMs(page)).toBe(0);
    expect(await inCar(page)).toBe(false);
  });

  test('told he is in the car it reads and draws; told he is out, it stops', async ({ page }) => {
    await openWith(page, { main: true });
    await expect.poll(() => listening(page)).toBe(true);

    await mainSays(page, true);
    expect(await everyMs(page)).toBe(33);
    await expect.poll(() => polls(page)).toBeGreaterThan(3);
    await expect(page.locator('#gearText')).toHaveText('4');
    await expect(page.locator('body')).not.toHaveClass(/idle-state/);

    await mainSays(page, false);
    expect(await everyMs(page)).toBe(0);
    expect(await pollsIn(page, 1500)).toBe(0);
    await expect(page.locator('body')).toHaveClass(/idle-state/);

    await mainSays(page, true);
    expect(await everyMs(page)).toBe(33);
    await expect.poll(() => pollsIn(page, 500)).toBeGreaterThan(0);
  });

  test('already in the car when the page loads: it asks main, and starts', async ({ page }) => {
    await openWith(page, { main: true, inCarAtStart: true });
    await expect.poll(() => inCar(page)).toBe(true);
    expect(await everyMs(page)).toBe(33);
    await expect(page.locator('#gearText')).toHaveText('4');
  });

  test('out of the car nothing goes round: no frame is asked for, nothing is fetched', async ({ page }) => {
    // The window is hidden, but main.js has Chromium's throttling switched off, so a hidden page's frames and
    // timers run as fast as a shown one's: a loop left going out of the car costs what it costs in it.
    await openWith(page, { main: true });
    await expect.poll(() => listening(page)).toBe(true);
    await page.waitForTimeout(1000);   // what the page does as it loads
    expect(await workIn(page, 2000)).toEqual({ frames: 0, fetches: 0 });

    // In the car the page's loop and the effects' go round, a frame each at a time; that is what is counted.
    await mainSays(page, true);
    const inTheCar = await workIn(page, 1000);
    expect(inTheCar.frames).toBeGreaterThan(10);
    expect(inTheCar.fetches).toBeGreaterThan(3);

    await mainSays(page, false);
    await page.waitForTimeout(500);   // the frames already asked for, and what they had begun
    expect(await workIn(page, 2000)).toEqual({ frames: 0, fetches: 0 });
  });

  test('back in the car after a break in the telemetry: it starts clean, and reads at once', async ({ page }) => {
    // The page waits longer after each request that fails — 1 s, 2 s, 4 s, up to 10 — and the wait used to
    // outlast the break: main.js had its answer and put the HUD on screen, and the page sat out what was left
    // over the numbers from before, marked as having no connection.
    await openWith(page, { main: true });
    await expect.poll(() => listening(page)).toBe(true);
    await mainSays(page, true);
    await expect(page.locator('#gearText')).toHaveText('4');

    await stopAnswering(page);
    await expect.poll(() => page.evaluate(() => _connFails), { timeout: 8000 }).toBeGreaterThanOrEqual(3);
    await expect(page.locator('#connStatus')).toHaveClass(/disconnected/);
    // A wait is left over from the last failure, whatever its length.
    await page.evaluate(() => { _backoffUntil = Date.now() + 4000; });

    // Three seconds without an answer and main.js says out; the telemetry comes back, and it says in.
    await mainSays(page, false);
    expect(await pollsIn(page, 500)).toBe(0);
    await page.evaluate((p) => { window.__feed.payload = p; window.__feed.answering = true; },
      { ...IN_THE_CAR, 'DataCorePlugin.GameData.Gear': '5' });

    const atOnce = await page.evaluate(() => {
      const before = window.__feed.polls;
      window.__mainSays(true);
      return { polls: window.__feed.polls - before, fails: _connFails, backoffUntil: _backoffUntil };
    });
    expect(atOnce).toEqual({ polls: 1, fails: 0, backoffUntil: 0 });
    await expect(page.locator('#connStatus')).not.toHaveClass(/disconnected/);
    await expect(page.locator('#gearText')).toHaveText('5', { timeout: 1000 });
    expect(await everyMs(page)).toBe(33);
  });

  test('a break too short for main.js to say he is out does not leave old numbers up after it', async ({ page }) => {
    // It takes main.js three seconds of silence to say out. A shorter break never gets that far, so the page is
    // never told in again and never starts clean: what keeps it from sitting out a long wait is that in the
    // car it is never left waiting longer than one of main.js's polls.
    await openWith(page, { main: true });
    await expect.poll(() => listening(page)).toBe(true);
    await mainSays(page, true);
    await expect(page.locator('#gearText')).toHaveText('4');

    await stopAnswering(page);
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => _connFails)).toBeGreaterThanOrEqual(2);
    expect(await page.evaluate(() => _backoffUntil - Date.now())).toBeLessThanOrEqual(500);

    await page.evaluate((p) => { window.__feed.payload = p; window.__feed.answering = true; },
      { ...IN_THE_CAR, 'DataCorePlugin.GameData.Gear': '6' });
    await expect(page.locator('#gearText')).toHaveText('6', { timeout: 800 });

    // Out of the car the page reads nothing, and a source that is not there is left alone for as long as it was.
    await mainSays(page, false);
    expect(await page.evaluate(() => _backoffCapMs)).toBe(10000);
  });

  test('told he is in, the page does not think again', async ({ page }) => {
    // The telemetry says the menus. Main has the same telemetry and the same rule, and the two seconds it waits
    // before believing it; until it says so the page reads on, and draws nothing of the car.
    await openWith(page, { main: true, payload: AT_THE_MENUS });
    await expect.poll(() => listening(page)).toBe(true);
    await mainSays(page, true);
    await page.waitForTimeout(3000);
    expect(await inCar(page)).toBe(true);
    expect(await everyMs(page)).toBe(33);
    expect(await page.evaluate(() => _isIdle)).toBe(true);
  });
});

test.describe('a page by itself: an iPad, a browser', () => {
  test('out of the car it asks once a second, and notices him getting in', async ({ page }) => {
    await openWith(page, { payload: AT_THE_MENUS });
    await expect.poll(() => polls(page)).toBeGreaterThan(0);
    expect(await everyMs(page)).toBe(1000);
    const slow = await pollsIn(page, 2000);
    expect(slow).toBeGreaterThanOrEqual(1);
    expect(slow).toBeLessThanOrEqual(3);
    expect(await inCar(page)).toBe(false);

    await serve(page, IN_THE_CAR);
    await expect.poll(() => inCar(page)).toBe(true);
    expect(await everyMs(page)).toBe(33);
    await expect(page.locator('#gearText')).toHaveText('4');
  });

  test('he gets out, the telemetry still answering: out of the car two seconds later', async ({ page }) => {
    await openWith(page);
    await expect.poll(() => inCar(page)).toBe(true);

    await serve(page, AT_THE_MENUS);
    await page.waitForTimeout(1000);
    expect(await inCar(page)).toBe(true);
    await expect.poll(() => inCar(page), { timeout: 4000 }).toBe(false);
    await expect(page.locator('body')).toHaveClass(/idle-state/);
    expect(await everyMs(page)).toBe(1000);
  });

  test('the telemetry stops answering while he drives: out of the car', async ({ page }) => {
    await openWith(page);
    await expect.poll(() => inCar(page)).toBe(true);
    await expect(page.locator('body')).not.toHaveClass(/idle-state/);

    await stopAnswering(page);
    await expect.poll(() => inCar(page), { timeout: 6000 }).toBe(false);
    await expect(page.locator('body')).toHaveClass(/idle-state/);
    expect(await everyMs(page)).toBe(1000);
  });
});
