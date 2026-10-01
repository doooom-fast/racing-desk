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
  const state = { settings: his, crops: 0 };
  await local.start({
    port, appDir: OVERLAY, key: remote.newKey(), log: () => {},
    telemetryUrl: `http://127.0.0.1:${telemetry.address().port}/racing-desk/`,
    status: () => ({ inCar: false, hudVisible: false, recording: null }),
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
    // The settings are asked for again every ten seconds; here sooner. And whatever the voice coach says is counted.
    window._obsSettingsEveryMs = 250;
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
