/**
 * The HUD's page as OBS draws it: the real dashboard.html served through the loopback listener (remote-server.js,
 * /obs) to a headless browser, over a stand-in telemetry on 127.0.0.1. Nothing reaches a port but those two, and
 * nothing the page asks of the internet is answered.
 *
 * What is held: the page knows it is OBS's and decides in-car for itself; out of the car it is not drawn at all (OBS
 * would composite whatever it showed over the garage), in the car it is; his display settings reach it — the zoom,
 * the position — from the allowlist, and nothing else of the settings file is in the page; the voice coach is off (the
 * rig is already talking); the livery crop is fetched from the server it came from; the ambient capture never asks
 * the runtime for anything; the settings are asked for again and a change on the desk reaches the page.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOCK_TELEMETRY } from '../helpers.mjs';

const require = createRequire(import.meta.url);
const remote = require('../../remote-server.js');

const OVERLAY = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const IN_THE_CAR = { ...MOCK_TELEMETRY, 'DataCorePlugin.GameData.CarModel': 'Porsche 911 GT3 R' };
const AT_THE_MENUS = { ...MOCK_TELEMETRY, 'RacingDesk.Plugin.Grid.SessionState': 0 };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function freePort() {
  return new Promise((resolve) => {
    const probe = http.createServer();
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
}

// A stand-in telemetry on 127.0.0.1 that answers whatever it was last given, and a loopback listener over it.
async function rig({ settings = {} } = {}) {
  const feed = { payload: AT_THE_MENUS, asked: [] };
  const telemetry = http.createServer((req, res) => {
    feed.asked.push(req.url);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(feed.payload));
  });
  await new Promise((resolve) => telemetry.listen(0, '127.0.0.1', resolve));
  const port = await freePort();
  const local = remote.createServer({ loopback: true });
  const his = {
    zoom: 120, layoutPosition: 'top-left', showSpotter: true, agentKey: 'SECRET-agent', remoteServerKey: 'SECRET-remote',
    obsWebSocketPasswordEnc: 'SECRET-obs', paints: { customerId: '424242' }, recordingFolder: 'D:\\SECRET', ...settings,
  };
  // What the app says of itself at /api/status: his HUD switch (hudOff) and the page-only actions pressed on the rig.
  const state = { settings: his, crops: 0, status: { inCar: false, hudVisible: false, hudOff: false, hudActions: { seq: 0, recent: [] }, recording: null } };
  await local.start({
    port, appDir: OVERLAY, key: remote.newKey(), log: () => {},
    telemetryUrl: `http://127.0.0.1:${telemetry.address().port}/racing-desk/`,
    status: () => state.status,
    displaySettings: () => state.settings,
    crop: () => { state.crops++; return { png: PNG, id: 'c1' }; },
  });
  return {
    port, feed, state,
    url: `http://127.0.0.1:${port}${remote.OBS_PATH}`,
    close: async () => { await local.stop(); await new Promise((resolve) => { telemetry.close(resolve); telemetry.closeAllConnections(); }); },
  };
}

async function open(page, r) {
  const requested = [];
  const errors = [];
  page.on('request', (q) => requested.push(q.url()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
  await page.addInitScript(() => {
    // The settings are asked for again every ten seconds, and the app's word on his HUD switch every second; here sooner.
    // And whatever the voice coach says is counted.
    window._displaySettingsEveryMs = 250;
    window._obsStatusEveryMs = 200;
    window.__spoken = 0;
    if (window.speechSynthesis) window.speechSynthesis.speak = () => { window.__spoken++; };
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(r.url, { waitUntil: 'load' });
  return { requested, errors };
}

test('out of the car the page is not drawn; in the car it is, laid out as the rig\'s HUD with his zoom and position, the crop fetched, nothing of his keys in it', async ({ page }) => {
  test.setTimeout(40000);
  const r = await rig();
  try {
    const { requested, errors } = await open(page, r);
    expect(await page.evaluate(() => [window._obsMode, window._remoteMode, document.documentElement.classList.contains('rd-obs')])).toEqual([true, undefined, true]);
    expect(await page.evaluate(() => window._simhubUrlOverride)).toBe(`http://127.0.0.1:${r.port}/racing-desk/`);
    // Out of the car: the page asks the telemetry (it decides for itself, as the iPad does) and draws nothing at all.
    await expect.poll(() => r.feed.asked.length).toBeGreaterThan(0);
    await expect(page.locator('body')).toHaveClass(/idle-state/);
    expect(await page.evaluate(() => getComputedStyle(document.body).visibility)).toBe('hidden');
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    // Not the glance layout: the rig's own HUD, at his zoom and in his corner.
    expect(await page.evaluate(() => document.body.classList.contains('drive-mode-active'))).toBe(false);
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--dash-zoom').trim())).toBe('1.2');
    await expect(page.locator('#dashboard')).toHaveClass(/layout-tl/);

    // In the car: drawn, with the numbers.
    r.feed.payload = IN_THE_CAR;
    await expect(page.locator('body')).not.toHaveClass(/idle-state/, { timeout: 10000 });
    expect(await page.evaluate(() => getComputedStyle(document.body).visibility)).toBe('visible');
    await expect(page.locator('#gearText')).toHaveText('4');
    // The crop of his paint is asked of the server the page came from, as the iPad asks the rig.
    await expect.poll(() => requested.filter((u) => u === `http://127.0.0.1:${r.port}/livery-crop.png`).length, { timeout: 10000 }).toBeGreaterThan(0);
    await expect.poll(() => r.state.crops).toBeGreaterThan(0);

    // Nothing of his keys reached the page: not in its text, not in its settings.
    const html = await page.content();
    for (const secret of ['SECRET', '424242']) expect(html).not.toContain(secret);
    const inPage = await page.evaluate(() => [_settings.agentKey, _settings.remoteServerKey, _settings.obsWebSocketPasswordEnc, _settings.recordingFolder, _settings.paints, _settings.zoom, _settings.layoutPosition]);
    expect(inPage.slice(0, 5).map((v) => (v === undefined || v === '' ? null : v))).toEqual([null, null, null, null, null]);   // the HUD's own defaults, where it has one, and nothing of his
    expect(inPage.slice(5)).toEqual([120, 'top-left']);
    // The voice coach is off: the rig is already talking.
    await page.evaluate(() => window.voiceCoachSay('a sentence', 5));
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__spoken)).toBe(0);
    // Nothing was asked of the runtime (no ?action=), and nothing but the kit of the internet.
    expect(requested.filter((u) => /action=/.test(u))).toEqual([]);
    expect(requested.filter((u) => !u.startsWith(`http://127.0.0.1:${r.port}/`))).toEqual(['https://use.typekit.net/pdg5yka.css']);
    expect(r.feed.asked.filter((u) => u !== '/racing-desk/')).toEqual([]);
    expect(errors).toEqual([]);

    // Out of the car again: hidden again.
    r.feed.payload = AT_THE_MENUS;
    await expect(page.locator('body')).toHaveClass(/idle-state/, { timeout: 10000 });
    expect(await page.evaluate(() => getComputedStyle(document.body).visibility)).toBe('hidden');
  } finally {
    await r.close();
  }
});

test('a setting changed on the desk reaches the page OBS draws, by the ten-second ask', async ({ page }) => {
  test.setTimeout(30000);
  const r = await rig();
  try {
    const { requested, errors } = await open(page, r);
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--dash-zoom').trim())).toBe('1.2');
    r.state.settings = { ...r.state.settings, zoom: 150, layoutPosition: 'bottom-right', agentKey: 'SECRET-again' };
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--dash-zoom').trim()), { timeout: 10000 }).toBe('1.5');
    await expect(page.locator('#dashboard')).toHaveClass(/layout-br/);
    expect(await page.evaluate(() => _settings.agentKey || null)).toBeNull();
    expect(requested.filter((u) => u === `http://127.0.0.1:${r.port}${remote.SETTINGS_PATH}`).length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  } finally {
    await r.close();
  }
});

const visibilityOf = (page) => page.evaluate(() => getComputedStyle(document.body).visibility);

test('he puts the HUD away (Ctrl+Shift+H, the tray, the Stream Deck, Quit Overlay): the page OBS draws is hidden while he is in the car, and is drawn again when he switches it on', async ({ page }) => {
  test.setTimeout(40000);
  const r = await rig();
  try {
    const { errors } = await open(page, r);
    r.feed.payload = IN_THE_CAR;
    await expect(page.locator('body')).not.toHaveClass(/idle-state/, { timeout: 10000 });
    expect(await visibilityOf(page)).toBe('visible');
    // The window is hidden by the HUD's keeper, and is out of the capture anyway: the page in OBS has to go too.
    r.state.status = { ...r.state.status, hudOff: true };
    await expect.poll(() => visibilityOf(page), { timeout: 5000 }).toBe('hidden');
    // He is still in the car as far as the telemetry says: it is his switch that hides it, nothing else.
    expect(await page.evaluate(() => document.body.classList.contains('idle-state'))).toBe(false);
    expect(await page.evaluate(() => document.documentElement.classList.contains('rd-hud-off'))).toBe(true);
    r.state.status = { ...r.state.status, hudOff: false };
    await expect.poll(() => visibilityOf(page), { timeout: 5000 }).toBe('visible');
    expect(errors).toEqual([]);
  } finally {
    await r.close();
  }
});

test('the page is not drawn while its scripts are still loading: its markup is hidden from the first paint, and stays so until it has started and the telemetry says he is in the car', async ({ page }) => {
  test.setTimeout(40000);
  const r = await rig();
  try {
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    // A script near the end of the page held back: the parser is blocked on it with the body, the placeholder gear and the
    // panels already parsed — which is what a browser source in OBS composites over the game while a page loads.
    await page.route('**/modules/js/keyboard.js', async (route) => { await new Promise((resolve) => setTimeout(resolve, 2000)); await route.continue(); });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(r.url, { waitUntil: 'commit' });
    await page.waitForFunction(() => document.readyState === 'loading' && !!document.body && !!document.getElementById('dashboard'), null, { timeout: 5000 });
    const early = await page.evaluate(() => ({ state: document.readyState, started: document.documentElement.classList.contains('rd-started'), visibility: getComputedStyle(document.body).visibility }));
    expect(early).toEqual({ state: 'loading', started: false, visibility: 'hidden' });
    // Loaded: the page has started, and says it is idle (out of the car): hidden still.
    await page.waitForLoadState('load');
    expect(await page.evaluate(() => document.documentElement.classList.contains('rd-started'))).toBe(true);
    expect(await visibilityOf(page)).toBe('hidden');
    // In the car: drawn.
    r.feed.payload = IN_THE_CAR;
    await expect(page.locator('body')).not.toHaveClass(/idle-state/, { timeout: 10000 });
    expect(await visibilityOf(page)).toBe('visible');
  } finally {
    await r.close();
  }
});

test('the page-only actions pressed on the rig — the Stream Deck\'s zoom keys — reach the page OBS draws, once each; what was pressed before the page began is not done again, and only those actions are done', async ({ page }) => {
  test.setTimeout(40000);
  const r = await rig();
  // Two zoom presses from before this page began: not for it.
  r.state.status = { ...r.state.status, hudActions: { seq: 2, recent: [{ n: 1, name: 'zoom-in' }, { n: 2, name: 'zoom-in' }] } };
  try {
    const { errors } = await open(page, r);
    r.feed.payload = IN_THE_CAR;
    await expect(page.locator('body')).not.toHaveClass(/idle-state/, { timeout: 10000 });
    expect(await page.evaluate(() => typeof window.runHudAction)).toBe('function');
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => document.body.style.transform)).toBe('');
    // Zoom in on the rig: the HUD in OBS grows with it.
    r.state.status = { ...r.state.status, hudActions: { seq: 3, recent: [{ n: 1, name: 'zoom-in' }, { n: 2, name: 'zoom-in' }, { n: 3, name: 'zoom-in' }] } };
    await expect.poll(() => page.evaluate(() => document.body.style.transform), { timeout: 5000 }).toBe('scale(1.05)');
    // Asked again and again with the same word: done once.
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => document.body.style.transform)).toBe('scale(1.05)');
    // Another press, and a name that is not a page-only action of the HUD's, which is not done at all.
    r.state.status = { ...r.state.status, hudActions: { seq: 5, recent: [{ n: 3, name: 'zoom-in' }, { n: 4, name: 'quit' }, { n: 5, name: 'zoom-in' }] } };
    await expect.poll(() => page.evaluate(() => document.body.style.transform), { timeout: 5000 }).toBe('scale(1.1)');
    expect(await page.evaluate(() => [window.runHudAction('zoom-out'), window.runHudAction('quit'), window.runHudAction('toString')])).toEqual([true, false, false]);
    expect(errors).toEqual([]);
  } finally {
    await r.close();
  }
});
