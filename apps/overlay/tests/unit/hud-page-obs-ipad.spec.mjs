/**
 * The iPad dashboard as OBS draws it ("iPad dashboard" under "HUD drawn by OBS"): the real dashboard.html served
 * through the loopback listener (remote-server.js, /obs-ipad) to a headless browser, over a stand-in telemetry on
 * 127.0.0.1. Nothing reaches a port but those two, and nothing the page asks of the internet is answered.
 *
 * What is held: the page is the glance layout from the start, in OBS mode (it knows it is OBS's, decides in-car for
 * itself, is not drawn at all out of the car or while he has the HUD away, asks for no key, says nothing aloud); it
 * has the iPad's look (the glass at fifteen hundredths, no badges, no crop asked for) and none of what is the iPad's
 * alone (no menu); and the page behind and between the panels is transparent — no black, no flag pattern in the
 * gutters, no frame at the edge — so the game shows through, which a render over a checkerboard proves. A flag is
 * still read from the flag card, race control's banner and the panels' flag-coloured borders. The rig's page-only
 * actions (its zoom keys) are not done here. His display settings (the allowlist) reach it as they reach the rig HUD
 * OBS draws, live: effects off takes the WebGL canvases out, which the iPad (told none of them) draws.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { frame, fieldWith } from '../frames.mjs';

const require = createRequire(import.meta.url);
const remote = require('../../remote-server.js');

const OVERLAY = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RACE = (over = {}) => frame({ order: fieldWith(4), state: 4, mode: 4, start: 7, lap: 12, ...over });
const AT_THE_MENUS = () => ({ ...RACE(), 'RacingDesk.Plugin.Grid.SessionState': 0, 'DataCorePlugin.GameRunning': 0 });
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function freePort() {
  return new Promise((resolve) => {
    const probe = http.createServer();
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
}

// A stand-in telemetry on 127.0.0.1 that answers whatever it was last given, and a loopback listener over it.
async function rig({ settings = {} } = {}) {
  const feed = { payload: AT_THE_MENUS(), asked: [] };
  const telemetry = http.createServer((req, res) => {
    feed.asked.push(req.url);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(feed.payload));
  });
  await new Promise((resolve) => telemetry.listen(0, '127.0.0.1', resolve));
  const port = await freePort();
  const local = remote.createServer({ loopback: true });
  const his = { zoom: 120, layoutPosition: 'top-left', agentKey: 'SECRET-agent', remoteServerKey: 'SECRET-remote', obsWebSocketPasswordEnc: 'SECRET-obs', paints: { customerId: '424242' }, ...settings };
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
    url: `http://127.0.0.1:${port}${remote.OBS_IPAD_PATH}`,
    close: async () => { await local.stop(); await new Promise((resolve) => { telemetry.close(resolve); telemetry.closeAllConnections(); }); },
  };
}

async function open(page, r, { width = 1180, height = 820 } = {}) {
  const requested = [];
  const errors = [];
  page.on('request', (q) => requested.push(q.url()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
  await page.addInitScript(() => {
    window._displaySettingsEveryMs = 250;
    window._obsStatusEveryMs = 200;
    window.__spoken = 0;
    if (window.speechSynthesis) window.speechSynthesis.speak = () => { window.__spoken++; };
  });
  await page.setViewportSize({ width, height });
  await page.goto(r.url, { waitUntil: 'load' });
  return { requested, errors };
}

// In the car, and drawn: the leaderboard has its rows, the maps are fitted, a few more frames have gone by.
async function drawn(page) {
  await expect(page.locator('body')).not.toHaveClass(/idle-state/, { timeout: 10000 });
  await page.waitForFunction(() => {
    const svg = document.getElementById('fullMapSvg');
    return document.querySelectorAll('#lbRows .lb-row').length >= 3 && svg && svg.style.getPropertyValue('--px') !== '';
  }, null, { timeout: 10000 });
  const before = await page.evaluate(() => _pollFrame);
  await page.waitForFunction((n) => _pollFrame >= n + 6, before, { timeout: 5000 });
  await page.waitForTimeout(500);
}

// The pixels of a screenshot, as the test reads them: the brightest channel and the colour at a point.
async function pixels(page) {
  const shot = await page.screenshot();
  const read = await page.evaluate(async ({ b64 }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const at = (x, y) => { const d = g.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]]; };
    // The gutter between the following map and the leaderboard beside it (the two span the maps' rows).
    const a = document.getElementById('leaderboardPanel').getBoundingClientRect();
    const b = document.querySelector('.map-zoom-panel').getBoundingClientRect();
    const [first, second] = a.left < b.left ? [a, b] : [b, a];
    const left = Math.ceil(first.right), right = Math.floor(second.left);
    const mid = Math.round((left + right) / 2);
    const top = Math.ceil(Math.max(a.top, b.top)) + 4, bottom = Math.floor(Math.min(a.bottom, b.bottom)) - 4;
    const gutter = [];
    for (let y = top; y < bottom; y += 1) gutter.push(at(mid, y));
    const edge = [];
    for (let y = 0; y < img.height; y += 3) edge.push(at(1, y), at(img.width - 2, y));
    for (let x = 0; x < img.width; x += 3) edge.push(at(x, 1), at(x, img.height - 2));
    // The middle of the hero and of the laps panel: a panel's own base, over the board.
    const hero = document.getElementById('positionPage').getBoundingClientRect();
    const inside = [];
    for (let y = Math.round(hero.top + hero.height * 0.3); y < hero.bottom - 8; y += 2) inside.push(at(Math.round(hero.left + 12), y));
    return { gutter, edge, inside, gutterWidth: right - left };
  }, { b64: shot.toString('base64') });
  return { shot, ...read };
}

// The board the page is laid over: magenta and cyan squares, which nothing of the HUD's is.
const BOARD = 'html { background: repeating-conic-gradient(#ff00ff 0 25%, #00ffff 0 50%) 0 0 / 40px 40px !important; }';
const isBoard = ([r, g, b]) => (r > 180 && b > 180 && g < 90) || (g > 180 && b > 180 && r < 90);
const isDark = ([r, g, b]) => Math.max(r, g, b) < 110;

// Where the renders go, for looking at: the test's own output folder, and the folder RD_SHOTS_DIR names if it is set.
function keep(name, png) {
  const file = test.info().outputPath(name);
  fs.writeFileSync(file, png);
  if (process.env.RD_SHOTS_DIR) {
    fs.mkdirSync(process.env.RD_SHOTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.RD_SHOTS_DIR, name), png);
  }
  return file;
}

test('the glance layout in OBS mode: hidden out of the car, drawn in it with the iPad\'s look over a transparent page; no menu, no badges, no crop, no key, nothing said aloud', async ({ page }) => {
  test.setTimeout(60000);
  const r = await rig();
  try {
    const { requested, errors } = await open(page, r);
    expect(await page.evaluate(() => [window._obsMode, window._obsGlance, window._remoteMode])).toEqual([true, true, undefined]);
    expect(await page.evaluate(() => [...document.documentElement.classList].filter((c) => /^rd-/.test(c)).sort())).toEqual(['rd-glance', 'rd-obs', 'rd-started']);
    expect(await page.evaluate(() => window._simhubUrlOverride)).toBe(`http://127.0.0.1:${r.port}/racing-desk/`);
    // The glance layout from the start, and not drawn out of the car.
    expect(await page.evaluate(() => document.body.classList.contains('drive-mode-active'))).toBe(true);
    await expect(page.locator('body')).toHaveClass(/idle-state/);
    expect(await page.evaluate(() => getComputedStyle(document.body).visibility)).toBe('hidden');
    // In the car: drawn, as the iPad is.
    r.feed.payload = RACE();
    await drawn(page);
    const look = await page.evaluate(() => ({
      visibility: getComputedStyle(document.body).visibility,
      html: getComputedStyle(document.documentElement).backgroundColor,
      body: getComputedStyle(document.body).backgroundColor,
      shine: getComputedStyle(document.body).getPropertyValue('--rd-shine').trim(),
      tint: [...getComputedStyle(document.getElementById('positionPage')).backgroundImage.matchAll(/rgba\(\d+, \d+, \d+, ([\d.]+)\)/g)].map((m) => +m[1]),
      brand: document.getElementById('brandLogoSquare').getClientRects().length,
      car: document.getElementById('carLogoSquare').getClientRects().length,
      row: getComputedStyle(document.body).gridTemplateAreas.includes('brand'),
      menu: document.querySelectorAll('#rd-remote-menu-fab, #rd-remote-menu-panel').length,
      zoom: document.documentElement.style.getPropertyValue('--dash-zoom').trim(),
      dashZoom: getComputedStyle(document.getElementById('dashboard')).zoom,
      flagLayer: getComputedStyle(document.body, '::before').display,
      frame: getComputedStyle(document.body, '::after').content,
      rows: document.querySelectorAll('#lbRows .lb-row').length,
    }));
    expect(look.visibility).toBe('visible');
    expect(look.html).toBe('rgba(0, 0, 0, 0)');
    expect(look.body).toBe('rgba(0, 0, 0, 0)');
    expect(look.shine).toBe('0.15');
    expect(look.tint[0]).toBeCloseTo(0.26 * 0.15, 2);
    expect([look.brand, look.car, look.row, look.menu]).toEqual([0, 0, false, 0]);
    // His zoom reached the page (the allowlist) and is undone by the layout, as on the iPad.
    expect(look.zoom).toBe('1.2');
    expect(look.dashZoom).toBe('1');
    expect(look.flagLayer).toBe('none');
    expect(look.frame).toBe('none');
    expect(look.rows).toBeGreaterThanOrEqual(3);
    // The crop of his paint is never asked for: there is no badge to put it under.
    await page.waitForTimeout(1200);
    expect(requested.filter((u) => u === `http://127.0.0.1:${r.port}/livery-crop.png`)).toEqual([]);
    expect(r.state.crops).toBe(0);
    // Nothing of his keys in the page; the voice coach is off; nothing asked of the runtime.
    const html = await page.content();
    for (const secret of ['SECRET', '424242']) expect(html).not.toContain(secret);
    await page.evaluate(() => window.voiceCoachSay('a sentence', 5));
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__spoken)).toBe(0);
    expect(requested.filter((u) => /action=/.test(u))).toEqual([]);
    expect(requested.filter((u) => !u.startsWith(`http://127.0.0.1:${r.port}/`))).toEqual(['https://use.typekit.net/pdg5yka.css']);
    expect(r.feed.asked.filter((u) => u !== '/racing-desk/')).toEqual([]);
    // Out of the car again: hidden again.
    r.feed.payload = AT_THE_MENUS();
    await expect(page.locator('body')).toHaveClass(/idle-state/, { timeout: 10000 });
    expect(await page.evaluate(() => getComputedStyle(document.body).visibility)).toBe('hidden');
    expect(errors).toEqual([]);
  } finally {
    await r.close();
  }
});

test("his display settings reach the dashboard as they reach the rig HUD OBS draws (the allowlist), not the iPad's own defaults: effects off takes the WebGL canvases out and ambient light off stops the light, live; the layout, the glass and the transparent page are as they were", async ({ page }) => {
  test.setTimeout(60000);
  // As his own overlay-settings.json has them: ambient light off, effects off. This page runs on the rig next to the sim, so
  // it keeps to the rig's switches (the iPad draws the effects on its own graphics and is told none of these).
  const r = await rig({ settings: { showWebGL: false, ambientMode: 'off', theme: 'dark', visualPreset: 'standard' } });
  try {
    const { errors } = await open(page, r);
    r.feed.payload = RACE();
    await drawn(page);
    const read = () => page.evaluate(() => {
      const canvases = [...document.querySelectorAll('.gl-overlay')];
      return {
        total: canvases.length,
        drawn: canvases.filter((c) => c.style.display !== 'none').length,
        ambient: _settings.ambientMode,
        webgl: _settings.showWebGL,
        glance: document.documentElement.classList.contains('rd-glance') && document.body.classList.contains('drive-mode-active'),
        page: [getComputedStyle(document.documentElement).backgroundColor, getComputedStyle(document.body).backgroundColor],
        shine: getComputedStyle(document.body).getPropertyValue('--rd-shine').trim(),
        tint: +[...getComputedStyle(document.getElementById('positionPage')).backgroundImage.matchAll(/rgba\(\d+, \d+, \d+, ([\d.]+)\)/g)][0][1],
      };
    });
    const his = await read();
    expect(his.total).toBeGreaterThan(0);
    expect(his).toMatchObject({ drawn: 0, ambient: 'off', webgl: false, glance: true, page: ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)'], shine: '0.15' });
    expect(his.tint).toBeCloseTo(0.26 * 0.15, 2);
    // He turns the effects and the light on at the desk: the page follows by its ask, and is the same layout.
    r.state.settings = { ...r.state.settings, showWebGL: true, ambientMode: 'reflective' };
    await expect.poll(async () => (await read()).drawn, { timeout: 10000 }).toBe(his.total);
    expect(await read()).toMatchObject({ ambient: 'reflective', webgl: true, glance: true, page: ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)'], shine: '0.15' });
    expect(errors).toEqual([]);
  } finally {
    await r.close();
  }
});

test('rendered over a checkerboard at 1180x820 with a yellow flag out: the board shows in every gutter and at the edge, the panels are dark over it, and the flag reads from the card, the banner and the borders', async ({ page }) => {
  test.setTimeout(90000);
  const r = await rig();
  try {
    const { errors } = await open(page, r);
    r.feed.payload = RACE({ flag: 'yellow' });
    await drawn(page);
    await page.addStyleTag({ content: BOARD });
    await page.waitForTimeout(600);
    // The flag is on show: the card, the banner, the panels' tint and border in its colour, and the page's own flag
    // layers are not drawn.
    const flag = await page.evaluate(() => {
      const hero = getComputedStyle(document.getElementById('positionPage'));
      return {
        flag: document.body.dataset.flag,
        card: document.getElementById('gapsBlock').classList.contains('flag-active'),
        banner: document.getElementById('rcBanner').classList.contains('rc-visible'),
        tint: hero.backgroundImage,
        border: hero.borderTopColor,
        layer: getComputedStyle(document.body, '::before').display,
        frame: getComputedStyle(document.body, '::after').content,
        body: getComputedStyle(document.body).backgroundColor,
      };
    });
    expect(flag.flag).toBe('yellow');
    expect(flag.card).toBe(true);
    expect(flag.banner).toBe(true);
    expect(flag.tint).toContain('rgba(245, 205, 40, 0.34)');
    expect(flag.border).toBe('rgba(245, 205, 40, 0.85)');
    expect(flag.layer).toBe('none');
    expect(flag.frame).toBe('none');
    expect(flag.body).toBe('rgba(0, 0, 0, 0)');
    const p = await pixels(page);
    const file = keep('obs-ipad-yellow-1180x820.png', p.shot);
    expect(p.gutterWidth).toBeGreaterThanOrEqual(3);
    expect(p.gutter.length).toBeGreaterThan(80);
    // Every pixel down the gutter between the following map and the leaderboard is the board's: not the dark, not a stripe.
    const notBoard = p.gutter.filter((c) => !isBoard(c));
    expect(notBoard.length, `${notBoard.length} of ${p.gutter.length} gutter pixels are not the board (${file})`).toBe(0);
    // And so is the screen's edge: no frame carries the flag there.
    const edgeNotBoard = p.edge.filter((c) => !isBoard(c));
    expect(edgeNotBoard.length, `${edgeNotBoard.length} of ${p.edge.length} edge pixels are not the board`).toBe(0);
    // The panels' own base is over the board: dark, at the panels' nine-tenths.
    const inside = p.inside.filter((c) => !isDark(c));
    expect(inside.length, `${inside.length} of ${p.inside.length} pixels inside the hero are not dark`).toBeLessThan(p.inside.length * 0.1);
    expect(errors).toEqual([]);
  } finally {
    await r.close();
  }
});

test('he puts the HUD away: the page is hidden while he is in the car, and drawn again when he switches it on; the rig\'s page-only actions are not done here', async ({ page }) => {
  test.setTimeout(60000);
  const r = await rig();
  try {
    const { errors } = await open(page, r);
    r.feed.payload = RACE();
    await expect(page.locator('body')).not.toHaveClass(/idle-state/, { timeout: 10000 });
    expect(await page.evaluate(() => getComputedStyle(document.body).visibility)).toBe('visible');
    r.state.status = { ...r.state.status, hudOff: true };
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).visibility), { timeout: 5000 }).toBe('hidden');
    expect(await page.evaluate(() => document.documentElement.classList.contains('rd-hud-off'))).toBe(true);
    r.state.status = { ...r.state.status, hudOff: false };
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).visibility), { timeout: 5000 }).toBe('visible');
    // A zoom pressed on the rig scales the rig's page; the glance layout has no zoom, and is left alone.
    r.state.status = { ...r.state.status, hudActions: { seq: 2, recent: [{ n: 1, name: 'zoom-in' }, { n: 2, name: 'zoom-in' }] } };
    await page.waitForTimeout(900);
    expect(await page.evaluate(() => document.body.style.transform)).toBe('');
    expect(errors).toEqual([]);
  } finally {
    await r.close();
  }
});
