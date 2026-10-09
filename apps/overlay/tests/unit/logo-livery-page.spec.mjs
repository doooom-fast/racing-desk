/**
 * The livery behind the car badge, on the page (modules/js/car-logos.js; #carLivery in dashboard.html): the real
 * dashboard.html, headless. In the app the crop the main process chose is laid under the logo, over the maker's
 * colour, and taken away when it says there is none. On an iPad the badge is back (he asked for the logos to go on
 * 2026-09-30 and for them back on 2026-10-08, top left, the Racing Desk's first), so the crop is asked for when the car
 * changes and when he is back in it, through remote-server.js's real server on 127.0.0.1; and the Racing Desk's own
 * tile, a part of the DOOOOM wordmark (modules/js/brand-livery.js), takes its two colours from that crop and shows
 * another part of the wordmark each time he is back in the car. In a browser with nothing behind it the badge is the
 * maker's colour and nothing is asked for. In the glance layout on the rig the darkening over the crop deepens under
 * the flags the panels take a heavier tint under, and under no others.
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
const rgbOf = (css) => (/rgb\((\d+), (\d+), (\d+)\)/.exec(css) || []).slice(1).map(Number);

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

// The alpha of the first stop of the layer's darkening: what the glass's colour is laid on at.
const tintOf = (page, flag) => page.evaluate((f) => {
  document.body.classList.add('drive-mode-active');
  if (f) document.body.setAttribute('data-flag', f);
  else document.body.removeAttribute('data-flag');
  const m = /rgba\(\d+, \d+, \d+, ([\d.]+)\)/.exec(getComputedStyle(document.querySelector('#carLivery'), '::after').backgroundImage);
  return m ? Number(m[1]) : null;
}, flag);

test.describe('the glance layout\'s darkening over the crop', () => {
  test('is the heavier tint under the flags the panels take a heavier tint under, and the light one under any other', async ({ page }) => {
    await open(page, { bridge: true, crop: dataUrlOf(cropOf(200, 30, 30)) });
    await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
    await expect.poll(() => badge(page), { timeout: 5000 }).toMatchObject({ hasLivery: true });
    // The panels' own list (drive-view.css, "The glass under a flag").
    const panels = ['green', 'greenheld', 'yellow', 'caution', 'onetogreen', 'red', 'white', 'checkered', 'meatball', 'debris', 'disqualify'];
    // What the page also has a flag for and the panels leave as they are: a local yellow, blue, the black flag
    // and its furled warning, the flag for a car being lapped, and none.
    const others = ['none', 'blue', 'black', 'furled', 'localyellow', 'orange'];
    const light = await tintOf(page, null);
    expect(light).toBe(0.18);
    for (const flag of panels) expect(await tintOf(page, flag), flag).toBe(0.34);
    for (const flag of others) expect(await tintOf(page, flag), flag).toBe(light);
    // Outside the glance layout the darkening is the plain one, with no glass colour in it.
    await page.evaluate(() => { document.body.classList.remove('drive-mode-active'); document.body.removeAttribute('data-flag'); });
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('#carLivery'), '::after').backgroundImage)).not.toContain('rgba(225');
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

  // He asked for the logos to go from the iPad on 2026-09-30 and for them back on 2026-10-08: the tiles are drawn, the crop
  // of the paint under the car's is asked for when the page opens, when the car changes and when he gets back in the car,
  // and the Racing Desk's tile (a part of the DOOOOM wordmark) takes its colours from it.
  const brand = (page) => page.evaluate(() => {
    const el = document.getElementById('brandLivery');
    const cs = getComputedStyle(el);
    const svg = el.querySelector('svg');
    return {
      body: cs.getPropertyValue('--brand-body').trim(), ink: cs.getPropertyValue('--brand-ink').trim(), fromPaint: el.classList.contains('from-paint'),
      window: svg.getAttribute('viewBox'),
      mask: (svg.querySelector('mask image') || {}).href ? svg.querySelector('mask image').href.baseVal : '',
      lettering: getComputedStyle(svg.querySelector('rect')).fill,
      images: document.querySelectorAll('#brandLogoSquare img').length,
    };
  });

  test('the two tiles are back and the crop is asked for: when the page opens, when the car changes, back in the car; the Racing Desk\'s tile takes its colours from it and shows another part of the wordmark each time', async ({ page }) => {
    test.setTimeout(90000);
    const onTrack = (value) => ({ ...PORSCHE, 'DataCorePlugin.GameRawData.Telemetry.IsOnTrack': value });
    payload = onTrack(1);
    crop = { png: cropOf(200, 30, 30), id: '1-1' };
    const requested = [];
    page.on('request', (r) => requested.push(r.url()));
    await page.addInitScript(() => { try { localStorage.setItem('rd-effects', 'off'); } catch (e) { /* none */ } });
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.goto(`http://127.0.0.1:${port}/?k=${KEY}`);
    await expect.poll(() => badge(page).then((b) => b.label), { timeout: 15000 }).toBe('911 GT3 R');
    expect(await page.evaluate(() => document.body.classList.contains('drive-mode-active'))).toBe(true);
    const drawn = () => page.evaluate(() => ['brandLogoSquare', 'carLogoSquare'].map((id) => document.getElementById(id).getClientRects().length > 0));
    expect(await drawn()).toEqual([true, true]);

    // Asked for when the page opens, and shown under the car's logo.
    await expect.poll(() => requested.filter((u) => CROP_URL.test(u)).length, { timeout: 10000 }).toBeGreaterThan(0);
    await expect.poll(() => badge(page), { timeout: 10000 }).toMatchObject({ hasLivery: true });
    // The Racing Desk's tile: the wordmark as the mask, no old mark in it, and the paint's own colours: the red ground, the
    // lettering lighter than it.
    await expect.poll(() => brand(page).then((b) => b.fromPaint), { timeout: 10000 }).toBe(true);
    let b = await brand(page);
    expect(b.mask).toContain('doooom-mark.png');
    expect(rgbOf(b.lettering), 'the lettering is filled with the ink').toEqual(rgbOf(b.ink));
    expect(b.images, 'the old mark is gone from the tile').toBe(0);
    expect(rgbOf(b.body)).toEqual([200, 30, 30]);
    expect(rgbOf(b.ink)[0]).toBeGreaterThan(230);
    expect(rgbOf(b.ink)[1]).toBeGreaterThan(190);

    // The car changes: asked for again, and the colours follow the crop that is chosen then.
    const before = requested.filter((u) => CROP_URL.test(u)).length;
    crop = { png: cropOf(30, 30, 200), id: '2-1' };
    payload = { ...BMW, 'DataCorePlugin.GameRawData.Telemetry.IsOnTrack': 1 };
    await expect.poll(() => badge(page).then((x) => x.label), { timeout: 15000 }).toBe('M4 GT3');
    await expect.poll(() => requested.filter((u) => CROP_URL.test(u)).length, { timeout: 10000 }).toBeGreaterThan(before);
    await expect.poll(() => brand(page).then((x) => rgbOf(x.body).join()), { timeout: 15000 }).toBe('30,30,200');

    // He leaves the car and gets back in: asked for again, and another part of the wordmark (a roll is of continuous
    // numbers, so a part the same as the last is not a chance worth a test; three goes, one at least differs).
    const windows = [(await brand(page)).window];
    for (let i = 0; i < 3; i++) {
      const asked = requested.filter((u) => CROP_URL.test(u)).length;
      payload = { ...BMW, 'DataCorePlugin.GameRawData.Telemetry.IsOnTrack': 0 };
      await expect.poll(() => page.evaluate(() => document.body.classList.contains('idle-state')), { timeout: 15000 }).toBe(true);
      payload = { ...BMW, 'DataCorePlugin.GameRawData.Telemetry.IsOnTrack': 1 };
      await expect.poll(() => page.evaluate(() => document.body.classList.contains('idle-state')), { timeout: 15000 }).toBe(false);
      await expect.poll(() => requested.filter((u) => CROP_URL.test(u)).length, { timeout: 10000 }).toBeGreaterThan(asked);
      windows.push((await brand(page)).window);
    }
    expect(new Set(windows).size, `the windows: ${windows.join(' | ')}`).toBeGreaterThan(1);
    expect(await drawn()).toEqual([true, true]);
    // The way in stays: the colour of the car's maker is still set for the map's car.
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--map-player-color').trim())).not.toBe('');
  });
});

// ── The Racing Desk's tile on its own: a part of the DOOOOM wordmark in the colours of the paint, or the glass's own ──
test.describe('the Racing Desk\'s tile', () => {
  test('with no paint it is the glass\'s colours; a crop of one colour gives the ground and a lighter lettering; two colours give those two; no paint puts it back', async ({ page }) => {
    await open(page, { bridge: true, crop: null });
    await expect.poll(() => page.evaluate(() => typeof window.__liverySays === 'function')).toBe(true);
    await page.evaluate(() => document.body.classList.add('drive-mode-active'));
    const read = () => page.evaluate(() => {
      const el = document.getElementById('brandLivery');
      const cs = getComputedStyle(el);
      return { body: cs.getPropertyValue('--brand-body').trim(), ink: cs.getPropertyValue('--brand-ink').trim(), fromPaint: el.classList.contains('from-paint') };
    });
    expect(await read()).toEqual({ body: 'rgb(22, 25, 32)', ink: 'rgb(115, 140, 191)', fromPaint: false });
    // One colour: its own lightness picks the lettering (lighter on a dark ground, darker on a light one).
    await page.evaluate((url) => window.__liverySays(url), dataUrlOf(cropOf(200, 30, 30)));
    await expect.poll(() => read().then((r) => r.fromPaint)).toBe(true);
    let r = await read();
    expect(rgbOf(r.body)).toEqual([200, 30, 30]);
    expect(rgbOf(r.ink)[1]).toBeGreaterThan(190);
    await page.evaluate((url) => window.__liverySays(url), dataUrlOf(cropOf(235, 235, 230)));
    await expect.poll(() => read().then((x) => rgbOf(x.body).join())).toBe('235,235,230');
    r = await read();
    expect(rgbOf(r.ink)[0], 'on a light ground the lettering is dark').toBeLessThan(60);
    // Two colours: a half and a half (the crop is drawn as a picture of four pixels' width, in the page).
    const two = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = c.height = 8;
      const g = c.getContext('2d');
      g.fillStyle = 'rgb(10, 40, 160)'; g.fillRect(0, 0, 8, 8);
      g.fillStyle = 'rgb(250, 190, 20)'; g.fillRect(0, 0, 8, 3);
      return c.toDataURL('image/png');
    });
    await page.evaluate((url) => window.__liverySays(url), two);
    // (the crop is scaled to a few pixels in the page, so the edge between the two is a blend: the colours are near, not exact)
    await expect.poll(() => read().then((x) => { const c = rgbOf(x.body); return c[0] < 50 && c[2] > 130; })).toBe(true);
    r = await read();
    expect(rgbOf(r.ink)[0]).toBeGreaterThan(220);
    expect(rgbOf(r.ink)[1]).toBeGreaterThan(160);
    expect(rgbOf(r.ink)[2]).toBeLessThan(60);
    // Told there is no paint (another car): the glass's colours again.
    await page.evaluate(() => window.__liverySays(null));
    await expect.poll(() => read().then((x) => x.fromPaint)).toBe(false);
    expect(await read()).toMatchObject({ body: 'rgb(22, 25, 32)', ink: 'rgb(115, 140, 191)' });
  });

  test('it shows the wordmark, a part of it, in both colours, and the part is rolled again each time it is asked for', async ({ page }) => {
    test.setTimeout(60000);
    await open(page, { bridge: true, crop: dataUrlOf(cropOf(30, 60, 180)) });
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.evaluate(() => { _settings.showWebGL = false; setDriveMode(true); });
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.getElementById('brandLivery')).getPropertyValue('--brand-body').trim()), { timeout: 10000 }).toBe('rgb(30, 60, 180)');
    // A part of the wordmark with a good deal of lettering in it: the middle of the rolls' numbers.
    await page.evaluate(() => window.rollBrandLivery(() => 0.5));
    await page.waitForTimeout(600);
    // The tile as it is drawn: some of it the ground and some the lettering, neither all there is.
    const share = async () => {
      const box = await page.locator('#brandLogoSquare').boundingBox();
      const shot = await page.screenshot({ clip: box });
      return page.evaluate(async ({ b64, w, h }) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + b64;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, img.width, img.height).data;
        let ground = 0, letters = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) {
          n++;
          // the ground is the blue, darkened toward the edges; the lettering is the lighter tint of it
          if (d[i] < 60 && d[i + 2] > 70) ground++;
          else if (d[i] > 100 && d[i + 1] > 110) letters++;
        }
        return { ground: ground / n, letters: letters / n, w: img.width, h: img.height };
      }, { b64: shot.toString('base64') });
    };
    const first = await share();
    expect(first.ground, `the ground: ${JSON.stringify(first)}`).toBeGreaterThan(0.1);
    expect(first.letters, `the lettering: ${JSON.stringify(first)}`).toBeGreaterThan(0.08);
    expect(Math.abs(first.w - first.h), 'the tile is square').toBeLessThanOrEqual(1);
    // Rolled again: the parts differ (twenty rolls, a dozen at least distinct).
    const parts = await page.evaluate(() => {
      const svg = document.querySelector('#brandLivery svg');
      const seen = new Set();
      for (let i = 0; i < 20; i++) { window.rollBrandLivery(); seen.add(svg.getAttribute('viewBox')); }
      return seen.size;
    });
    expect(parts).toBeGreaterThanOrEqual(15);
  });
});
