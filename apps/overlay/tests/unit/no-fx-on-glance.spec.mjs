/**
 * The WebGL effects (the glows, the bloom, the flashes: webgl.js's loop) are the rig's HUD over the game, and nothing
 * else's. The glance layout — the iPad's page, the iPad dashboard OBS draws (/obs-ipad) and Ctrl+Shift+F on the rig —
 * and the HUD page OBS draws (/obs) never start that loop and make no WebGL context. The real dashboard.html, headless,
 * in the car; nothing reaches a port but 127.0.0.1, and every other address is shut.
 *
 * The rig's page is the control: in the car it does run the loop, so "not running" on the others is not a loop that
 * never starts anywhere.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { frame, fieldWith } from '../frames.mjs';

const require = createRequire(import.meta.url);
const remote = require('../../remote-server.js');

const OVERLAY = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DASHBOARD = pathToFileURL(path.join(OVERLAY, 'dashboard.html')).href;
const RACE = () => frame({ order: fieldWith(4), state: 4, mode: 4, start: 7, lap: 12 });

function freePort() {
  return new Promise((resolve) => {
    const probe = http.createServer();
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
}

// What the page asks for: the WebGL contexts it makes, counted as they are asked for.
async function countGlContexts(page) {
  await page.addInitScript(() => {
    window.__gl = 0;
    const real = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind) {
      if (/webgl/.test(String(kind))) window.__gl++;
      return real.apply(this, arguments);
    };
  });
}

const inTheCar = (page) => expect(page.locator('body')).not.toHaveClass(/idle-state/, { timeout: 15000 });
const running = (page) => page.evaluate(() => window.isGLFXRunning());

// The three pages the app serves, over a telemetry that has him in the car.
async function served(which) {
  const telemetry = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(RACE()));
  });
  await new Promise((resolve) => telemetry.listen(0, '127.0.0.1', resolve));
  const port = await freePort();
  const server = remote.createServer({ loopback: which !== 'ipad' });
  await server.start({
    port, host: '127.0.0.1', appDir: OVERLAY, key: remote.newKey(), log: () => {},
    telemetryUrl: `http://127.0.0.1:${telemetry.address().port}/racing-desk/`,
    status: () => ({ inCar: true, hudVisible: true, hudOff: false, hudActions: { seq: 0, recent: [] }, recording: null }),
    displaySettings: () => ({ showWebGL: true }),
  });
  const path = which === 'obs' ? remote.OBS_PATH : which === 'obs-ipad' ? remote.OBS_IPAD_PATH : '/';
  return {
    url: `http://127.0.0.1:${port}${path}`,
    close: async () => { await server.stop(); await new Promise((resolve) => { telemetry.close(resolve); telemetry.closeAllConnections(); }); },
  };
}

for (const which of ['ipad', 'obs-ipad', 'obs']) {
  test(`${which}: in the car, with the effects setting on, no effects loop starts and no WebGL context is made`, async ({ page }) => {
    test.setTimeout(60000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    await countGlContexts(page);
    const s = await served(which);
    try {
      await page.setViewportSize({ width: 1180, height: 820 });
      await page.goto(s.url, { waitUntil: 'load' });
      await inTheCar(page);
      // A few of the page's own frames have gone by, so a loop that was going to start has.
      const before = await page.evaluate(() => _pollFrame);
      await page.waitForFunction((n) => _pollFrame >= n + 5, before, { timeout: 20000 });
      expect(await page.evaluate(() => _settings.showWebGL !== false)).toBe(true);
      expect(await running(page)).toBe(false);
      // Asked to start, it still does not.
      await page.evaluate(() => { window.setGLFXActive(true); window.refreshGLFX(); });
      await page.waitForTimeout(300);
      expect(await running(page)).toBe(false);
      expect(await page.evaluate(() => window.__gl)).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await s.close();
    }
  });
}

test('the rig HUD in the car runs the effects loop; the glance layout on the rig (Ctrl+Shift+F) stops it, and leaving it starts it again', async ({ page }) => {
  test.setTimeout(60000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/^https?:\/\//, (route) => route.abort());
  await countGlContexts(page);
  await page.addInitScript((payload) => {
    const realFetch = window.fetch;
    window.fetch = function (url) {
      if (/^http:\/\/localhost:8889\/racing-desk\/$/.test(String(url))) {
        return Promise.resolve(new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return realFetch.apply(this, arguments);
    };
  }, RACE());
  await page.goto(DASHBOARD, { waitUntil: 'load' });
  await inTheCar(page);

  await expect.poll(() => running(page), { timeout: 15000 }).toBe(true);
  expect(await page.evaluate(() => window.__gl)).toBeGreaterThan(0);

  await page.evaluate(() => window.setDriveMode(true));
  await expect.poll(() => running(page), { timeout: 5000 }).toBe(false);
  // Asked for while it is on, still none.
  await page.evaluate(() => { window.setGLFXActive(true); window.refreshGLFX(); });
  await page.waitForTimeout(200);
  expect(await running(page)).toBe(false);

  await page.evaluate(() => window.setDriveMode(false));
  await expect.poll(() => running(page), { timeout: 5000 }).toBe(true);
  expect(errors).toEqual([]);
});

test('a settings file from before, with the screen-capture light in it, loads and the page runs: nothing asks for the screen any more', async ({ page }) => {
  test.setTimeout(60000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/^https?:\/\//, (route) => route.abort());
  const asked = [];
  page.on('request', (r) => asked.push(r.url()));
  await page.addInitScript((payload) => {
    window.racingDesk = new Proxy({
      getSettings: async () => ({ zoom: 120, ambientMode: 'reflective', showAmbientLight: true, ambientCaptureRect: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } }),
    }, { get: (t, k) => (k in t ? t[k] : () => Promise.resolve(null)) });
    const realFetch = window.fetch;
    window.fetch = function (url) {
      if (/^http:\/\/localhost:8889\/racing-desk\/$/.test(String(url))) {
        return Promise.resolve(new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return realFetch.apply(this, arguments);
    };
  }, RACE());
  await page.goto(DASHBOARD, { waitUntil: 'load' });
  await inTheCar(page);
  const gone = await page.evaluate(() => ({
    light: typeof window.startAmbientLight, capture: typeof window.startCaptureAreaSelection, canvas: !!document.getElementById('ambientGlCanvas'),
    rule: [...document.styleSheets].some((s) => /ambient\.css/.test(s.href || '')),
  }));
  expect(gone).toEqual({ light: 'undefined', capture: 'undefined', canvas: false, rule: false });
  expect(asked.filter((u) => /action=setrect/.test(u))).toEqual([]);
  expect(errors).toEqual([]);
});
