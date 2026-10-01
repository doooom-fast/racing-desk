/**
 * The two "Panel background" sliders (settings.js applyPanelBackground; base.css): `panelBackground`, in Settings →
 * Look, for the rig's HUD and the iPad view; `obsPanelBackground`, with "HUD drawn by OBS", for the pages OBS draws
 * (the rig HUD and the iPad dashboard alike). Each sets how solid the panels' own background is — the base fill and
 * the glass — and nothing else; 90 is what the panels have always been, so the defaults change nothing; under 90 the
 * numbers and words get a soft dark shadow that grows as the background goes. Each slider reaches its own surfaces and
 * not the others', and reaches them live: the rig's page by the desk's settings path (settings-sync), the iPad and the
 * OBS pages by the ten-second ask of the server they came from.
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
const RACE = (over = {}) => frame({ order: fieldWith(4), state: 4, mode: 4, start: 7, lap: 12, ...over });

function freePort() {
  return new Promise((resolve) => {
    const probe = http.createServer();
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
}

// What the slider changes, read from the page: the base fill's alpha on a main panel and on a secondary one, the glass
// streak's opacity, and the shadow under the numbers (its first layer's alpha, 0 when there is none).
const look = (page) => page.evaluate(() => {
  const alphaOf = (colour) => { const m = colour.match(/rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/); return m ? (m[4] === undefined ? 1 : +m[4]) : null; };
  const panel = document.querySelector('.map-panel');
  // --panel-glass as the element has it, worked out (a custom property reads back as the words it was written in): a
  // probe inside it takes it as its opacity.
  const glassOf = (el) => { const probe = document.createElement('i'); probe.style.opacity = 'var(--panel-glass)'; el.appendChild(probe); const v = +getComputedStyle(probe).opacity; probe.remove(); return v; };
  const shadow = getComputedStyle(document.getElementById('gapsBlock')).textShadow;
  return {
    alpha: getComputedStyle(document.documentElement).getPropertyValue('--panel-alpha').trim(),
    panel: alphaOf(getComputedStyle(panel).backgroundColor),
    lb: alphaOf(getComputedStyle(document.querySelector('.lb-inner')).backgroundColor),
    streak: +getComputedStyle(panel, '::after').opacity,
    lum: +getComputedStyle(document.documentElement).getPropertyValue('--ambient-lum') || 0,
    thin: document.body.classList.contains('panels-thin'),
    shadow: shadow === 'none' ? 0 : alphaOf(shadow),
    shadowText: shadow,
    spotter: getComputedStyle(document.getElementById('spotterPanel')).textShadow,
    // The spotter's card and race control's banner are solid cards, not panels: the glass on them is not thinned.
    spotterGlass: glassOf(document.getElementById('spotterPanel')),
    bannerGlass: glassOf(document.getElementById('rcBanner')),
    panelGlass: glassOf(panel),
  };
});

// The rig's HUD, from the file, as the app has it (no server, no injection), in the car.
async function openRig(page, settings = {}) {
  let payload = RACE();
  await page.route(/^https?:\/\/(?!localhost:8889)/, (route) => route.abort());
  await page.route('http://localhost:8889/racing-desk/', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) }));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(pathToFileURL(path.join(OVERLAY, 'dashboard.html')).href);
  await page.evaluate((s) => { Object.assign(_settings, s); _settings.showWebGL = false; applySettings(); }, settings);
  await page.waitForFunction(() => typeof _isIdle !== 'undefined' && _isIdle === false && _pollFrame > 6, null, { timeout: 10000 });
  // The ambient light moves --ambient-lum as it runs, and the streak's opacity follows it over 0.4 s: held still here,
  // so that what is read is the slider's doing and nothing else's.
  await page.evaluate(() => { if (typeof window.stopAmbientLight === 'function') window.stopAmbientLight(); document.documentElement.style.setProperty('--ambient-lum', '0.35'); });
  await page.waitForTimeout(800);
  return { serve: (next) => { payload = next; } };
}

test('on the rig: 90 is the panels as they were, and the sliders at 0, 50 and 100 set the base and the glass, with a shadow under the numbers that grows as the background goes; the OBS slider does nothing here', async ({ page }) => {
  test.setTimeout(60000);
  await openRig(page);
  const asBefore = await look(page);
  expect(asBefore.alpha).toBe('0.9');
  expect(asBefore.panel).toBeCloseTo(0.9, 2);
  expect(asBefore.lb).toBeCloseTo(0.9, 2);
  expect(asBefore.streak).toBeCloseTo(0.25 + asBefore.lum * 0.35, 2);   // the glass as ambient.css always had it
  expect(asBefore.thin).toBe(false);
  expect(asBefore.shadow).toBe(0);

  // The panels' colours fade to a new value (background over 0.6 s, the streak over 0.4 s): read once they have settled.
  const set = async (s) => { await page.evaluate((v) => { Object.assign(_settings, v); applySettings(); }, s); await page.waitForTimeout(800); };
  await set({ panelBackground: 100 });
  const solid = await look(page);
  expect(solid.panel).toBe(1);
  expect(solid.lb).toBe(1);
  expect(solid.streak).toBeCloseTo(0.25 + solid.lum * 0.35, 2);   // the glass never goes up
  expect(solid.thin).toBe(false);
  expect(solid.shadow).toBe(0);

  await set({ panelBackground: 50 });
  const half = await look(page);
  expect(half.panel).toBeCloseTo(0.5, 2);
  expect(half.lb).toBeCloseTo(0.5, 2);
  expect(half.streak).toBeCloseTo((0.25 + half.lum * 0.35) * (0.5 / 0.9), 2);
  expect(half.thin).toBe(true);
  expect(half.shadow).toBeGreaterThan(0.3);
  expect(half.shadow).toBeLessThan(0.5);
  expect(half.shadowText).toMatch(/rgba\(0, 0, 0, [\d.]+\) 0px 1px 2px/);

  await set({ panelBackground: 0 });
  const none = await look(page);
  expect(none.panel).toBe(0);
  expect(none.lb).toBe(0);
  expect(none.streak).toBe(0);
  expect(none.thin).toBe(true);
  expect(none.shadow).toBeCloseTo(0.9, 2);
  expect(none.shadow).toBeGreaterThan(half.shadow);
  // The shadow is the panels': the spotter's card, which comes and goes over the game, has none of it.
  expect(none.spotter).toBe('none');

  // The OBS slider is the OBS pages' alone.
  await set({ panelBackground: 90, obsPanelBackground: 0 });
  expect(await look(page)).toMatchObject({ alpha: '0.9', thin: false, shadow: 0 });
  // A value that is not a number is the default; one past the ends is held to them.
  await set({ panelBackground: 'thin' });
  expect((await look(page)).alpha).toBe('0.9');
  await set({ panelBackground: 250 });
  expect((await look(page)).alpha).toBe('1');
  await set({ panelBackground: -5 });
  expect((await look(page)).alpha).toBe('0');
  expect(await page.evaluate(() => window.panelBackgroundNow())).toBe(0);
});

test("the shadow takes its colour from the theme — a pale halo under the light theme's dark numbers, not a dark smear — and the spotter's card and race control's banner, solid cards that are not panels, keep their glass at 0", async ({ page }) => {
  test.setTimeout(60000);
  await openRig(page);
  const set = async (s) => { await page.evaluate((v) => { Object.assign(_settings, v); applySettings(); }, s); await page.waitForTimeout(800); };
  await set({ panelBackground: 0 });
  const dark = await look(page);
  expect(dark.shadowText).toMatch(/rgba\(0, 0, 0, 0\.9\) 0px 1px 2px/);
  expect(dark.shadowText).not.toMatch(/255/);
  // The light theme: dark text, so the halo is white, at the same strength.
  await set({ panelBackground: 0, theme: 'light' });
  const light = await look(page);
  expect(light.shadowText).toMatch(/rgba\(255, 255, 255, 0\.9\) 0px 1px 2px/);
  expect(light.shadowText).not.toMatch(/rgba\(0, 0, 0/);
  expect(light.shadow).toBeCloseTo(0.9, 2);
  expect(light.panel).toBe(0);
  await set({ panelBackground: 50, theme: 'light' });
  expect((await look(page)).shadow).toBeGreaterThan(0.3);
  // At 90 and above the light theme has no shadow either, and its panels are as they were (0.92 at 90).
  await set({ panelBackground: 90, theme: 'light' });
  const asBefore = await look(page);
  expect(asBefore.shadow).toBe(0);
  expect(asBefore.panel).toBeCloseTo(0.92, 2);
  // The cards: at 0 the panels' glass is gone (0) and theirs is whole (1), in both themes; no shadow under their words.
  for (const theme of ['dark', 'light']) {
    await set({ panelBackground: 0, theme });
    const at = await look(page);
    expect(at.panelGlass, theme).toBe(0);
    expect(at.spotterGlass, theme).toBe(1);
    expect(at.bannerGlass, theme).toBe(1);
    expect(at.spotter, theme).toBe('none');
  }
  // Their glass streak, drawn when the light is on (ambient.css), is at its full strength at 0, as it is at 90: the
  // spotter's ::after follows the light's brightness and nothing of the slider.
  await set({ panelBackground: 0, theme: 'dark' });
  const streak = await page.evaluate(() => ({ spotter: +getComputedStyle(document.getElementById('spotterPanel'), '::after').opacity, panel: +getComputedStyle(document.querySelector('.map-panel'), '::after').opacity, lum: +getComputedStyle(document.documentElement).getPropertyValue('--ambient-lum') }));
  expect(streak.panel).toBe(0);
  expect(streak.spotter).toBeCloseTo(0.25 + streak.lum * 0.35, 2);
});

// The iPad's server and the loopback one, each over a stand-in telemetry, with his settings as a box the test changes.
async function servers() {
  const feed = { payload: RACE() };
  const telemetry = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(feed.payload)); });
  await new Promise((resolve) => telemetry.listen(0, '127.0.0.1', resolve));
  const his = { settings: { panelBackground: 50, obsPanelBackground: 0, zoom: 120 } };
  const lanPort = await freePort();
  const localPort = await freePort();
  const lan = remote.createServer();
  const local = remote.createServer({ loopback: true });
  const common = { appDir: OVERLAY, log: () => {}, telemetryUrl: `http://127.0.0.1:${telemetry.address().port}/racing-desk/`, displaySettings: () => his.settings };
  const key = remote.newKey();
  await lan.start({ ...common, port: lanPort, host: '127.0.0.1', key });
  await local.start({ ...common, port: localPort, key: remote.newKey(), status: () => ({ inCar: true, hudVisible: true, hudOff: false, hudActions: { seq: 0, recent: [] }, recording: null }) });
  return {
    his,
    serve: (next) => { feed.payload = next; },
    ipad: `http://127.0.0.1:${lanPort}/?k=${key}`,
    obs: `http://127.0.0.1:${localPort}${remote.OBS_PATH}`,
    obsIpad: `http://127.0.0.1:${localPort}${remote.OBS_IPAD_PATH}`,
    close: async () => { await lan.stop(); await local.stop(); await new Promise((resolve) => { telemetry.close(resolve); telemetry.closeAllConnections(); }); },
  };
}

// The panels' colours fade to a new value (background over 0.6 s), and under the whole suite's load the fade may lag the
// server's answer: the panel's own alpha is waited for, and the rest read after it.
const panelAt = async (page, alpha) => {
  await expect.poll(async () => (await look(page)).panel, { timeout: 10000 }).toBeCloseTo(alpha, 2);
  await expect.poll(async () => (await look(page)).lb, { timeout: 10000 }).toBeCloseTo(alpha, 2);
};

async function openServed(page, url, { width = 1180, height = 820 } = {}) {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
  await page.addInitScript(() => { window._displaySettingsEveryMs = 250; window._obsStatusEveryMs = 200; try { localStorage.setItem('rd-effects', 'off'); } catch (e) { /* none */ } });
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof _isIdle !== 'undefined' && _isIdle === false && _pollFrame > 6, null, { timeout: 10000 });
  await page.waitForTimeout(300);
}

test('on the iPad: the rig\'s slider reaches the glance layout, live, by the iPad\'s server; the OBS slider does not', async ({ page }) => {
  test.setTimeout(60000);
  const s = await servers();
  try {
    await openServed(page, s.ipad);
    const half = await look(page);
    expect(half.alpha).toBe('0.5');
    expect(half.panel).toBeCloseTo(0.5, 2);
    expect(half.lb).toBeCloseTo(0.5, 2);
    expect(half.thin).toBe(true);
    expect(half.shadow).toBeGreaterThan(0.3);
    // The glance layout's glass (at the iPad's fifteen hundredths) scaled down with it.
    const tint = await page.evaluate(() => [...getComputedStyle(document.getElementById('positionPage')).backgroundImage.matchAll(/rgba\(\d+, \d+, \d+, ([\d.]+)\)/g)].map((m) => +m[1]));
    expect(tint[0]).toBeCloseTo(0.26 * 0.15 * (0.5 / 0.9), 2);
    // Nothing else of the settings reached the iPad: not the OBS slider (0 would have emptied the panels), not his zoom
    // (the HUD's own default stands, and the layout undoes it anyway).
    expect(await page.evaluate(() => [_settings.obsPanelBackground, _settings.zoom])).toEqual([undefined, 165]);
    // Moved on the desk: the iPad follows by its ask.
    s.his.settings = { ...s.his.settings, panelBackground: 0 };
    await panelAt(page, 0);
    expect(await look(page)).toMatchObject({ alpha: '0', thin: true });
    s.his.settings = { ...s.his.settings, panelBackground: 100 };
    await panelAt(page, 1);
    expect(await look(page)).toMatchObject({ alpha: '1', lb: 1, thin: false, shadow: 0 });
    // Under a flag the base is opaque at 90 and above, and thins below it.
    s.his.settings = { ...s.his.settings, panelBackground: 90 };
    await panelAt(page, 0.9);
    s.serve(RACE({ flag: 'yellow' }));
    await expect.poll(() => page.evaluate(() => document.body.dataset.flag), { timeout: 5000 }).toBe('yellow');
    await panelAt(page, 1);
    s.his.settings = { ...s.his.settings, panelBackground: 45 };
    await panelAt(page, 0.5);
    expect((await look(page)).alpha).toBe('0.45');
  } finally {
    await s.close();
  }
});

for (const [name, which] of [['the rig HUD OBS draws', 'obs'], ['the iPad dashboard OBS draws', 'obsIpad']]) {
  test(`${name}: the OBS slider reaches it, live, by the loopback listener; the rig's slider does not`, async ({ page }) => {
    test.setTimeout(60000);
    const s = await servers();
    try {
      await openServed(page, s[which], which === 'obs' ? { width: 1920, height: 1080 } : {});
      await expect(page.locator('body')).not.toHaveClass(/idle-state/, { timeout: 10000 });
      const none = await look(page);
      expect(none.alpha).toBe('0');
      expect(none.panel).toBe(0);
      expect(none.lb).toBe(0);
      expect(none.streak).toBe(0);
      expect(none.thin).toBe(true);
      expect(none.shadow).toBeCloseTo(0.9, 2);
      // The rig's slider came with the page (the allowlist) and is not what this page draws by.
      expect(await page.evaluate(() => [_settings.panelBackground, _settings.obsPanelBackground])).toEqual([50, 0]);
      s.his.settings = { ...s.his.settings, obsPanelBackground: 50 };
      await panelAt(page, 0.5);
      expect((await look(page)).alpha).toBe('0.5');
      s.his.settings = { ...s.his.settings, obsPanelBackground: 100, panelBackground: 0 };
      await panelAt(page, 1);
      expect(await look(page)).toMatchObject({ alpha: '1', lb: 1, thin: false, shadow: 0 });
      // Back to the panels as they were.
      s.his.settings = { ...s.his.settings, obsPanelBackground: 90 };
      await panelAt(page, 0.9);
      expect((await look(page)).alpha).toBe('0.9');
    } finally {
      await s.close();
    }
  });
}
