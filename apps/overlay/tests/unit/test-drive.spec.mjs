/**
 * A test drive — iRacing's solo testing session — has no field to list, so the leaderboard is not shown in one, on every
 * overlay: the rig's HUD, its Ctrl+Shift+F glance layout, the iPad's view, and the two pages OBS draws (/obs and
 * /obs-ipad on the loopback listener). He asked for it on 2026-10-01 ("hide leaderboard on test drives in all overlays").
 *
 * How a test drive shows in the data, on both paths, is the one word under RacingDesk.Plugin.SessionTypeName: the app's
 * host sends the session YAML's SessionType of the session the sim is in, which is "Offline Testing" for every test
 * drive in his own .ibt files (WeekendInfo.EventType "Test", SessionName "TESTING"; RacingDesk.Tests SessionTypeTests
 * reads them), and the SimHub plugin sends SimHub's SessionTypeName, the same string. DS.SessionMode is 1 for a test
 * drive and for a practice alike, so the word is what is read (modules/js/session-kind.js).
 *
 * Hidden means its space goes to the other panels: in the glance layout the grid is laid out again without its cell,
 * and the cells still cover the screen; on the rig's HUD the other secondary panels take its place at the edge. It
 * comes back the moment the session is anything else — practice, qualifying, a race.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { frame, fieldWith } from '../frames.mjs';

const require = createRequire(import.meta.url);
const remote = require('../../remote-server.js');
const { isTestDrive, sessionTypeOf } = require('../../modules/js/session-kind.js');

const OVERLAY = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DASHBOARD = pathToFileURL(path.join(OVERLAY, 'dashboard.html')).href;

// A race with a field; a practice with the same field; and a test drive: his car alone, iRacing's own word for the
// session, no incident limits (DS.IsNonRaceSession, as the host sends it), one car in the grid.
const RACE = (over = {}) => frame({ order: fieldWith(4), state: 4, mode: 4, start: 7, lap: 12, ...over });
const PRACTICE = (over = {}) => frame({ order: fieldWith(4), session: 'Practice', state: 4, mode: 1, start: 4, lap: 6, ...over });
const QUALIFY = () => frame({ order: fieldWith(4), session: 'Lone Qualify', state: 4, mode: 2, start: 4, lap: 2 });
const TEST_DRIVE = (over = {}) => frame({
  order: fieldWith(1, []), session: 'Offline Testing', mode: 1, state: 4, start: 0, lap: 3, incidents: 2,
  extra: { 'RacingDesk.Plugin.DS.IsNonRaceSession': 1, 'RacingDesk.Plugin.Grid.TotalCars': 1 }, ...over,
});

test.describe('which session is a test drive (session-kind.js)', () => {
  test('the words iRacing and SimHub use: "Offline Testing" is one, and nothing else is', () => {
    // His own .ibt files: a test drive's session, and a race weekend's three.
    expect(isTestDrive('Offline Testing')).toBe(true);
    for (const name of ['Practice', 'Lone Qualify', 'Open Qualify', 'Race', 'Warmup', 'Time Trial', 'Time Attack', '']) {
      expect(isTestDrive(name), name).toBe(false);
    }
    // A source that shortens it, in either case.
    expect(isTestDrive('Test')).toBe(true);
    expect(isTestDrive('Testing')).toBe(true);
    expect(isTestDrive('offline testing')).toBe(true);
    // Not by an accident of letters, and not for a frame that does not say.
    expect(isTestDrive('Fastest Lap Contest')).toBe(false);
    expect(isTestDrive(null)).toBe(false);
    expect(isTestDrive(undefined)).toBe(false);
    expect(isTestDrive(4)).toBe(false);
  });

  test('the type is read from the frame, the demo\'s when the demo is on', () => {
    expect(sessionTypeOf(TEST_DRIVE())).toBe('Offline Testing');
    expect(sessionTypeOf(RACE())).toBe('Race');
    expect(sessionTypeOf({ 'RacingDesk.Plugin.DemoMode': 1, 'RacingDesk.Plugin.SessionTypeName': 'Offline Testing', 'RacingDesk.Plugin.Demo.SessionTypeName': 'Race' })).toBe('Race');
    expect(sessionTypeOf({})).toBe('');
    expect(sessionTypeOf(null)).toBe('');
    expect(sessionTypeOf({ 'RacingDesk.Plugin.SessionTypeName': 7 })).toBe('');
  });
});

// ── The pages ────────────────────────────────────────────────────────────────────────────────────────────────────────

function freePort() {
  return new Promise((resolve) => {
    const probe = http.createServer();
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
}

// A stand-in telemetry on 127.0.0.1 that answers whatever it was last given.
async function telemetry(first) {
  const feed = { payload: first };
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(feed.payload));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    feed, url: `http://127.0.0.1:${server.address().port}/racing-desk/`,
    close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }),
  };
}

// What the page says of the leaderboard and the grid.
const look = (page) => page.evaluate(() => {
  const lb = document.getElementById('leaderboardPanel');
  const areas = getComputedStyle(document.body).gridTemplateAreas;
  return {
    testDrive: document.body.classList.contains('session-testdrive'),
    shown: lb.getClientRects().length > 0,
    rows: document.querySelectorAll('#lbRows .lb-row').length,
    gridHasLb: /\blb\b/.test(areas),
    drive: document.body.classList.contains('drive-mode-active'),
  };
});

// A frame has been drawn: the page is in the car and a few more frames have gone by.
async function frames(page, n = 6) {
  await page.waitForFunction(() => typeof _isIdle !== 'undefined' && _isIdle === false && _pollFrame > 5, null, { timeout: 15000 });
  const before = await page.evaluate(() => _pollFrame);
  await page.waitForFunction((at) => _pollFrame >= at, before + n, { timeout: 15000 });
}

// The glance layout, measured: every cell drawn, inside the screen, none over another, and the cells the screen (the
// same bar tests/unit/drive-view.spec.mjs holds the layout to); and the leaderboard's cell, when there is one.
function measure(page, cells) {
  return page.evaluate((cellSelectors) => {
    const vw = innerWidth, vh = innerHeight;
    const out = { drawn: [], outside: [], overlapping: [], covered: 0, overflowing: [] };
    let area = 0;
    const rects = [];
    for (const [name, sel] of Object.entries(cellSelectors)) {
      const el = document.querySelector(sel);
      if (!el || el.getClientRects().length === 0) continue;
      out.drawn.push(name);
      const r = el.getBoundingClientRect();
      area += r.width * r.height;
      rects.push([name, r]);
      if (r.left < -0.5 || r.top < -0.5 || r.right > vw + 0.5 || r.bottom > vh + 0.5) out.outside.push(name);
      const slack = Math.max(1, parseFloat(getComputedStyle(el).fontSize) * 0.3);
      if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + slack) out.overflowing.push(name);
    }
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const [a, ra] = rects[i], [b, rb] = rects[j];
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (w > 1 && h > 1) out.overlapping.push(`${a}/${b}`);
    }
    out.covered = area / (vw * vh);
    out.drawn.sort();
    // The full circuit is fitted to its (wider) cell again: on one axis it reaches nearly to the edges.
    const svg = document.getElementById('fullMapSvg');
    const cell = svg.getBoundingClientRect();
    const outline = document.getElementById('fullMapTrackOuter').getBoundingClientRect();
    out.mapFills = Math.max(outline.width / cell.width, outline.height / cell.height);
    out.mapInside = outline.width <= cell.width + 1 && outline.height <= cell.height + 1;
    return out;
  }, cells);
}

const CELLS = {
  hero: '#positionPage', gaps: '#gapsBlock', tacho: '.tacho-block', lb: '#leaderboardPanel', map: '.map-panel',
  local: '.map-zoom-panel', laps: '#lapsPanel', rating: '#ratingPage', ctrl: '.car-controls', pedals: '.pedals-area',
  timer: '#raceTimerBlock', pit: '#pitBoxPanel', ds: '#datastreamPanel', inc: '#incidentsPanel',
};
const CELLS_RIG = { ...CELLS, brand: '#brandLogoSquare', car: '#carLogoSquare' };
const without = (cells, key) => Object.fromEntries(Object.entries(cells).filter(([k]) => k !== key));

// The rig's HUD, from the file, as the app has it.
async function openRig(page, first, { drive = false, width = 1920, height = 1080 } = {}) {
  const feed = { payload: first };
  await page.route(/^https?:\/\/(?!localhost:8889)/, (route) => route.abort());
  await page.route('http://localhost:8889/racing-desk/', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(feed.payload) }));
  await page.setViewportSize({ width, height });
  await page.goto(DASHBOARD);
  await page.evaluate(() => { _settings.showWebGL = false; applySettings(); });
  if (drive) await page.evaluate(() => setDriveMode(true));
  await frames(page);
  return feed;
}

test('the rig\'s HUD: no leaderboard in a test drive, and it is back, with its rows, for a practice, a qualifying and a race', async ({ page }) => {
  test.setTimeout(60000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const feed = await openRig(page, TEST_DRIVE());
  expect(await look(page)).toMatchObject({ testDrive: true, shown: false, drive: false });

  feed.payload = PRACTICE();
  await frames(page);
  let m = await look(page);
  expect(m).toMatchObject({ testDrive: false, shown: true });
  expect(m.rows).toBeGreaterThanOrEqual(3);

  feed.payload = TEST_DRIVE();
  await frames(page);
  expect(await look(page)).toMatchObject({ testDrive: true, shown: false });

  feed.payload = QUALIFY();
  await frames(page);
  m = await look(page);
  expect(m).toMatchObject({ testDrive: false, shown: true });
  expect(m.rows).toBeGreaterThanOrEqual(3);

  feed.payload = TEST_DRIVE();
  await frames(page);
  expect(await look(page)).toMatchObject({ testDrive: true, shown: false });

  feed.payload = RACE();
  await frames(page);
  m = await look(page);
  expect(m).toMatchObject({ testDrive: false, shown: true });
  expect(m.rows).toBeGreaterThanOrEqual(3);
  // The other secondary panels are still where they were: at the edge, in a row.
  const sec = await page.evaluate(() => ['datastreamPanel', 'pitBoxPanel'].map((id) => document.getElementById(id).getClientRects().length > 0));
  expect(sec).toEqual([true, true]);
  expect(errors).toEqual([]);
});

test('a frame that names no session type leaves it as it was; the rig\'s own switch for the panel still hides it in a race', async ({ page }) => {
  test.setTimeout(60000);
  const feed = await openRig(page, TEST_DRIVE());
  expect(await look(page)).toMatchObject({ testDrive: true, shown: false });
  const nameless = { ...TEST_DRIVE() };
  delete nameless['RacingDesk.Plugin.SessionTypeName'];
  feed.payload = nameless;
  await frames(page);
  expect(await look(page)).toMatchObject({ testDrive: true, shown: false });
  feed.payload = RACE();
  await frames(page);
  expect(await look(page)).toMatchObject({ testDrive: false, shown: true });
  await page.evaluate(() => { _settings.showLeaderboard = false; applySettings(); });
  expect(await look(page)).toMatchObject({ testDrive: false, shown: false });
});

for (const [width, height, what] of [[1920, 1080, 'the rig, 16:9'], [2560, 1080, 'the rig, ultrawide']]) {
  test(`the rig's Ctrl+Shift+F at ${width}x${height} (${what}): a test drive has no leaderboard cell, the other cells take the screen, and a race has it back`, async ({ page }) => {
    test.setTimeout(90000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const feed = await openRig(page, TEST_DRIVE(), { drive: true, width, height });
    await page.waitForFunction(() => document.getElementById('fullMapSvg').style.getPropertyValue('--px') !== '', null, { timeout: 10000 });
    await page.waitForTimeout(500);
    expect(await look(page)).toMatchObject({ testDrive: true, shown: false, gridHasLb: false, drive: true });
    let m = await measure(page, CELLS_RIG);
    expect(m.drawn).toEqual(Object.keys(without(CELLS_RIG, 'lb')).sort());
    expect(m.outside).toEqual([]);
    expect(m.overlapping).toEqual([]);
    expect(m.covered).toBeGreaterThanOrEqual(0.86);
    expect(m.mapFills).toBeGreaterThan(0.85);
    expect(m.mapInside).toBe(true);

    feed.payload = RACE();
    await frames(page);
    await page.waitForFunction(() => document.querySelectorAll('#lbRows .lb-row').length >= 3, null, { timeout: 10000 });
    await page.waitForTimeout(500);
    expect(await look(page)).toMatchObject({ testDrive: false, shown: true, gridHasLb: true });
    m = await measure(page, CELLS_RIG);
    expect(m.drawn).toEqual(Object.keys(CELLS_RIG).sort());
    expect(m.overlapping).toEqual([]);
    expect(m.covered).toBeGreaterThanOrEqual(0.86);
    expect(m.mapFills).toBeGreaterThan(0.85);
    expect(errors).toEqual([]);
  });
}

// The iPad's page: served by remote-server.js's own server on 127.0.0.1, as an iPad is given it.
test.describe('the iPad', () => {
  let feed, port, stop;
  test.beforeAll(async () => {
    const t = await telemetry(TEST_DRIVE());
    feed = t.feed;
    port = await freePort();
    await remote.start({ port, host: '127.0.0.1', appDir: OVERLAY, key: 'abcd2345', log: () => {}, telemetryUrl: t.url });
    stop = async () => { await remote.stop(); await t.close(); };
  });
  test.afterAll(async () => { await stop(); });

  for (const [width, height, what] of [[1180, 820, 'on its side'], [820, 1180, 'upright'], [1024, 768, '9.7", on its side'], [744, 1133, 'mini, upright']]) {
    test(`${width}x${height} (${what}): a test drive has no leaderboard cell and the other cells take the screen; a race, then a practice, have it back`, async ({ page }) => {
      test.setTimeout(90000);
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      feed.payload = TEST_DRIVE();
      await page.addInitScript(() => { try { localStorage.setItem('rd-effects', 'off'); } catch (e) { /* none */ } });
      await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
      await page.setViewportSize({ width, height });
      await page.goto(`http://127.0.0.1:${port}/`);
      await frames(page);
      await page.waitForFunction(() => document.getElementById('fullMapSvg').style.getPropertyValue('--px') !== '', null, { timeout: 10000 });
      await page.waitForTimeout(500);
      expect(await look(page)).toMatchObject({ testDrive: true, shown: false, gridHasLb: false, drive: true });
      let m = await measure(page, CELLS);
      expect(m.drawn).toEqual(Object.keys(without(CELLS, 'lb')).sort());
      expect(m.outside).toEqual([]);
      expect(m.overlapping).toEqual([]);
      expect(m.covered, JSON.stringify(m)).toBeGreaterThanOrEqual(0.86);
      expect(m.overflowing).toEqual([]);
      expect(m.mapFills).toBeGreaterThan(0.85);
      expect(m.mapInside).toBe(true);

      feed.payload = RACE();
      await frames(page);
      await page.waitForFunction(() => document.querySelectorAll('#lbRows .lb-row').length >= 3, null, { timeout: 10000 });
      await page.waitForTimeout(500);
      expect(await look(page)).toMatchObject({ testDrive: false, shown: true, gridHasLb: true });
      m = await measure(page, CELLS);
      expect(m.drawn).toEqual(Object.keys(CELLS).sort());
      expect(m.overlapping).toEqual([]);
      expect(m.covered).toBeGreaterThanOrEqual(0.86);

      feed.payload = PRACTICE();
      await frames(page);
      expect(await look(page)).toMatchObject({ testDrive: false, shown: true, gridHasLb: true });
      expect(errors).toEqual([]);
    });
  }
});

// The two pages OBS draws, from the loopback listener: the rig's HUD (/obs) and the iPad dashboard (/obs-ipad).
test.describe('the pages OBS draws', () => {
  let feed, port, local, t;
  test.beforeAll(async () => {
    t = await telemetry(TEST_DRIVE());
    feed = t.feed;
    port = await freePort();
    local = remote.createServer({ loopback: true });
    await local.start({
      port, appDir: OVERLAY, key: remote.newKey(), log: () => {}, telemetryUrl: t.url,
      status: () => ({ inCar: true, hudVisible: true, hudOff: false, hudActions: { seq: 0, recent: [] }, recording: null }),
      displaySettings: () => ({ zoom: 100 }),
    });
  });
  test.afterAll(async () => { await local.stop(); await t.close(); });

  for (const [what, pathname] of [['the rig HUD', remote.OBS_PATH], ['the iPad dashboard', remote.OBS_IPAD_PATH]]) {
    test(`${what} (${pathname}): no leaderboard in a test drive, back in a race`, async ({ page }) => {
      test.setTimeout(60000);
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      feed.payload = TEST_DRIVE();
      await page.addInitScript(() => { window._obsStatusEveryMs = 200; });
      await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
      await page.setViewportSize({ width: 1180, height: 820 });
      await page.goto(`http://127.0.0.1:${port}${pathname}`, { waitUntil: 'load' });
      await page.evaluate(() => { _settings.showWebGL = false; applySettings(); });
      await frames(page);
      const glance = pathname === remote.OBS_IPAD_PATH;
      expect(await look(page)).toMatchObject({ testDrive: true, shown: false, drive: glance, ...(glance ? { gridHasLb: false } : {}) });
      feed.payload = RACE();
      await frames(page);
      await page.waitForFunction(() => document.querySelectorAll('#lbRows .lb-row').length >= 3, null, { timeout: 10000 });
      expect(await look(page)).toMatchObject({ testDrive: false, shown: true, ...(glance ? { gridHasLb: true } : {}) });
      expect(errors).toEqual([]);
    });
  }
});
