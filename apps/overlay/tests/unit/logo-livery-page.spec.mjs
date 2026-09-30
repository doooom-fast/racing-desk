/**
 * The livery behind the car badge, on the page (modules/js/car-logos.js; #carLivery in dashboard.html): the real
 * dashboard.html, headless. In the app the crop the main process chose is laid under the logo, over the maker's
 * colour, and taken away when it says there is none. On an iPad the page asks the rig for it at its one address when
 * the car changes, through remote-server.js's real server on 127.0.0.1, and shows the maker's colour when the rig has
 * none. In a browser with nothing behind it the badge is the maker's colour and nothing is asked for.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MOCK_TELEMETRY } from '../helpers.mjs';

const require = createRequire(import.meta.url);
const remote = require('../../remote-server.js');
const tga = require('../../modules/js/paints/tga.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const OVERLAY = path.resolve(here, '..', '..');
const DASHBOARD = pathToFileURL(path.join(OVERLAY, 'dashboard.html')).href;
const KEY = 'abcd2345';
const CROP_URL = /\/livery-crop\.png/;

// A crop as the main process makes one: a small PNG of one colour, which a browser can draw.
function cropOf(r, g, b, size = 8) {
  const rgb = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i++) {
    rgb[i * 3] = r;
    rgb[i * 3 + 1] = g;
    rgb[i * 3 + 2] = b;
  }
  return tga.toPng({ width: size, height: size, rgb });
}
const dataUrlOf = (png) => `data:image/png;base64,${png.toString('base64')}`;

const PORSCHE = MOCK_TELEMETRY;   // 'Porsche 911 GT3 R'
const BMW = { ...MOCK_TELEMETRY, 'DataCorePlugin.GameData.CarModel': 'BMW M4 GT3' };

// What the badge shows: the layer, the square's own colour, and how the two sit.
const badge = (page) => page.evaluate(() => {
  const sq = document.getElementById('carLogoSquare');
  const layer = document.getElementById('carLivery');
  const s = sq.getBoundingClientRect();
  const l = layer.getBoundingClientRect();
  const same = (a, b) => Math.abs(a - b) < 1;
  return {
    hasLivery: sq.classList.contains('has-livery'),
    image: layer.style.backgroundImage,
    opacity: getComputedStyle(layer).opacity,
    fit: getComputedStyle(layer).backgroundSize,
    square: sq.style.background,
    tint: sq.style.getPropertyValue('--logo-tint'),
    label: document.getElementById('carModelLabel').textContent,
    covers: same(s.x, l.x) && same(s.y, l.y) && same(s.width, l.width) && same(s.height, l.height),
    // First in the square, under the logo and the car's name.
    under: [...sq.children].indexOf(layer) === 0
      && getComputedStyle(document.getElementById('carLogoIcon')).zIndex === '1'
      && getComputedStyle(document.getElementById('carModelLabel')).zIndex === '1',
    darkened: getComputedStyle(layer, '::after').backgroundImage,
  };
});

// The page over a plugin that serves whatever it was last given; `bridge` is the app's preload, or nothing.
async function open(page, { payload = PORSCHE, bridge = false, crop = null } = {}) {
  await page.route(/^https?:\/\//, (route) => route.abort());
  await page.addInitScript(({ first, withBridge, chosen }) => {
    window.__feed = { payload: first, fetched: [] };
    const realFetch = window.fetch;
    window.fetch = function (url) {
      window.__feed.fetched.push(String(url));
      if (!/^http:\/\/localhost:8889\/racing-desk\/$/.test(String(url))) return realFetch.apply(this, arguments);
      return Promise.resolve(new Response(JSON.stringify(window.__feed.payload), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    };
    if (withBridge) {
      const known = {
        inCarFromMain: true,
        onInRaceState: (callback) => { window.__mainSays = callback; },
        getInRaceState: async () => true,
        getSettings: async () => null,
        // The livery: what the main process chose before the page loaded, and what it chooses after.
        getLogoLivery: async () => chosen,
        onLogoLivery: (callback) => { window.__liverySays = callback; },
      };
      window.racingDesk = new Proxy(known, { get: (t, k) => (k in t ? t[k] : () => Promise.resolve(null)) });
    }
  }, { first: payload, withBridge: bridge, chosen: crop });
  await page.goto(DASHBOARD, { waitUntil: 'load' });
  await expect.poll(() => badge(page).then((b) => b.label), { timeout: 10000 }).not.toBe('');
}

const fetched = (page) => page.evaluate(() => window.__feed.fetched);

test.describe('in the app', () => {
  test('the crop the main process chose is under the logo, over the maker\'s colour, and goes when it says there is none', async ({ page }) => {
    const first = dataUrlOf(cropOf(200, 30, 30));
    await open(page, { bridge: true, crop: first });
    await expect.poll(() => page.evaluate(() => typeof window.__liverySays === 'function')).toBe(true);

    // What was chosen before the page loaded is asked for and shown, cover-fitted under the logo and the name,
    // with the darkening over it; the square keeps the maker's colour beneath.
    await expect.poll(() => badge(page), { timeout: 5000 }).toMatchObject({ hasLivery: true, opacity: '1' });
    const shown = await badge(page);
    expect(shown.image).toBe(`url("${first}")`);
    expect(shown.fit).toBe('cover');
    expect(shown.covers).toBe(true);
    expect(shown.under).toBe(true);
    expect(shown.darkened).toContain('gradient');
    expect(shown.square).not.toBe('');
    expect(shown.tint).not.toBe('');
    expect(shown.label).toBe('911 GT3 R');

    // Told there is none: the layer is emptied and fades, and the maker's colour is what is left.
    await page.evaluate(() => window.__liverySays(null));
    await expect.poll(() => badge(page), { timeout: 5000 }).toMatchObject({ hasLivery: false, image: '', opacity: '0' });
    expect((await badge(page)).square).toBe(shown.square);

    // Another crop chosen later — another car, or the same car got into again — replaces it.
    const next = dataUrlOf(cropOf(30, 30, 200));
    await page.evaluate((url) => window.__liverySays(url), next);
    await expect.poll(() => badge(page), { timeout: 5000 }).toMatchObject({ hasLivery: true, opacity: '1' });
    expect((await badge(page)).image).toBe(`url("${next}")`);
    // The car changing does not touch it: the main process chooses, the page shows.
    await page.evaluate((p) => { window.__feed.payload = p; }, BMW);
    await expect.poll(() => badge(page).then((b) => b.label), { timeout: 5000 }).toBe('M4 GT3');
    expect((await badge(page)).image).toBe(`url("${next}")`);
    // Something that is not a data URL is not put on the page.
    for (const junk of [42, '', {}, []]) {
      await page.evaluate((v) => window.__liverySays(v), junk);
      expect((await badge(page)).hasLivery, String(junk)).toBe(false);
    }
    // And nothing was fetched for it: in the app the crop never travels over HTTP.
    expect((await fetched(page)).filter((u) => CROP_URL.test(u))).toEqual([]);
  });

  test('with nothing chosen yet the badge is the maker\'s colour', async ({ page }) => {
    await open(page, { bridge: true, crop: null });
    await expect.poll(() => page.evaluate(() => typeof window.__liverySays === 'function')).toBe(true);
    await page.waitForTimeout(300);
    const b = await badge(page);
    expect(b.hasLivery).toBe(false);
    expect(b.image).toBe('');
    expect(b.opacity).toBe('0');
    expect(b.square).not.toBe('');
  });
});

test('in a browser with nothing behind it, the badge is the maker\'s colour and nothing is asked for', async ({ page }) => {
  await open(page, { bridge: false });
  await page.waitForTimeout(500);
  const b = await badge(page);
  expect(b.hasLivery).toBe(false);
  expect(b.image).toBe('');
  expect(b.square).not.toBe('');
  expect((await fetched(page)).filter((u) => CROP_URL.test(u))).toEqual([]);
  // The page's own way in is there for the main process and for the iPad, and takes only a string.
  expect(await page.evaluate(() => typeof window.setCarLivery === 'function' && typeof window.requestRemoteLivery === 'function')).toBe(true);
});

// ── On an iPad: the real server on 127.0.0.1, the crop from a stand-in for the main process's memory ──

function freePort() {
  return new Promise((resolve) => {
    const probe = http.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

test.describe('on an iPad', () => {
  let telemetry;
  let port;
  let payload;
  let crop;

  test.beforeAll(async () => {
    telemetry = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
    await new Promise((resolve) => telemetry.listen(0, '127.0.0.1', resolve));
    port = await freePort();
    await remote.start({
      port, host: '127.0.0.1', appDir: OVERLAY, key: KEY, log: () => {},
      telemetryUrl: `http://127.0.0.1:${telemetry.address().port}/racing-desk/`,
      crop: () => crop,
    });
  });
  test.afterAll(async () => {
    await remote.stop();
    await new Promise((resolve) => { telemetry.close(resolve); telemetry.closeAllConnections(); });
  });

  test('the page asks the rig for the crop when the car changes, shows it in the glance layout, and shows the maker\'s colour when the rig has none', async ({ page }) => {
    test.setTimeout(60000);
    payload = PORSCHE;
    crop = { png: cropOf(200, 30, 30), id: '1-1' };
    const requested = [];
    page.on('request', (r) => requested.push(r.url()));
    await page.addInitScript(() => { try { localStorage.setItem('rd-effects', 'off'); } catch (e) { /* none */ } });
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.goto(`http://127.0.0.1:${port}/?k=${KEY}`);

    // Asked at the one address, exactly, with no query; shown as a blob of what came back.
    const cropUrl = `http://127.0.0.1:${port}${remote.CROP_PATH}`;
    await expect.poll(() => requested.filter((u) => u === cropUrl).length, { timeout: 15000 }).toBeGreaterThan(0);
    await expect.poll(() => badge(page), { timeout: 15000 }).toMatchObject({ hasLivery: true, opacity: '1' });
    const shown = await badge(page);
    expect(shown.image).toMatch(/^url\("blob:http:\/\/127\.0\.0\.1:\d+\/[\w-]+"\)$/);
    expect(shown.fit).toBe('cover');
    expect(shown.covers).toBe(true);
    expect(shown.under).toBe(true);
    expect(shown.label).toBe('911 GT3 R');
    expect(requested.filter((u) => CROP_URL.test(u)).every((u) => u === cropUrl)).toBe(true);
    // The glance layout is on, and the layer's darkening takes the glass's colour there (drive-view.css).
    expect(await page.evaluate(() => document.body.classList.contains('drive-mode-active'))).toBe(true);
    expect(shown.darkened).toContain('gradient');
    // The same crop, told again, is kept as it is: the page compares the tag and does not make a new blob.
    const before = requested.filter((u) => u === cropUrl).length;
    await page.evaluate(() => window.requestRemoteLivery());
    await expect.poll(() => requested.filter((u) => u === cropUrl).length, { timeout: 5000 }).toBeGreaterThan(before);
    await page.waitForTimeout(300);
    expect((await badge(page)).image).toBe(shown.image);

    // Under a flag the darkening over the crop deepens with the glass, as the panels do.
    const flagged = { ...PORSCHE, currentFlagState: 'yellow' };
    payload = flagged;
    await expect.poll(() => page.evaluate(() => document.body.getAttribute('data-flag')), { timeout: 10000 }).toBe('yellow');
    expect((await badge(page)).darkened).not.toBe(shown.darkened);
    expect((await badge(page)).image).toBe(shown.image);

    // Another car, for which the rig has nothing: 404, and the maker's colour.
    crop = null;
    payload = BMW;
    await expect.poll(() => badge(page), { timeout: 15000 }).toMatchObject({ hasLivery: false, image: '', label: 'M4 GT3' });

    // Back in a car with a paint: the new crop.
    crop = { png: cropOf(30, 30, 200), id: '2-1' };
    payload = PORSCHE;
    await expect.poll(() => badge(page), { timeout: 15000 }).toMatchObject({ hasLivery: true, label: '911 GT3 R' });
    expect((await badge(page)).image).toMatch(/^url\("blob:/);
    expect((await badge(page)).image).not.toBe(shown.image);
  });
});
