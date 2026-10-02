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
import fs from 'node:fs';
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
    // iRacing's word whatever its case and spacing.
    expect(isTestDrive('offline testing')).toBe(true);
    expect(isTestDrive('  OFFLINE   TESTING ')).toBe(true);
    // Nothing looser: the overlay also runs for other sims through SimHub, and a word that merely begins "test" in
    // one of theirs (a "Test Day", say, which can have a full online field) is not iRacing's solo session.
    for (const name of ['Test', 'Testing', 'Test Day', 'Testing Session', 'Online Testing', 'Offline Testing Session',
      'Fastest Lap Contest', 'Contest']) {
      expect(isTestDrive(name), name).toBe(false);
    }
    // And not for a frame that does not say.
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

test('poll-engine.js reads the session type only through session-kind.js: the one place that picks the demo\'s name or the live one', () => {
  // The change of session and the test drive read the same word, from the same function the test above holds to the
  // frame; a second copy of the choice in the page could drift from it and leave that test passing.
  const code = fs.readFileSync(path.join(OVERLAY, 'modules', 'js', 'poll-engine.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  expect(code.match(/RacingDeskSessionKind\.sessionTypeOf\(p\)/g)).toHaveLength(1);
  expect(code).not.toMatch(/\.SessionTypeName/);
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

test('the page reads the session type the way session-kind.js says: the demo\'s name while the demo is on, the live one otherwise', async ({ page }) => {
  test.setTimeout(60000);
  // The demo says a test drive while the live key says a race: the demo's is the one the page reads.
  const demo = (demoName, liveName) => ({
    ...RACE(), 'RacingDesk.Plugin.DemoMode': 1,
    'RacingDesk.Plugin.Demo.SessionTypeName': demoName, 'RacingDesk.Plugin.SessionTypeName': liveName,
  });
  const feed = await openRig(page, demo('Offline Testing', 'Race'));
  expect(await look(page)).toMatchObject({ testDrive: true, shown: false });
  feed.payload = demo('Race', 'Offline Testing');
  await frames(page);
  expect(await look(page)).toMatchObject({ testDrive: false, shown: true });
  feed.payload = RACE();
  await frames(page);
  expect(await look(page)).toMatchObject({ testDrive: false, shown: true });
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

  // The menu's button (remote-server.js) is a 44px round button over the top right corner of the screen, over the frame
  // and the corner of whatever cell is there. On its side a test drive puts the tacho in that corner (a race has the
  // empty end of the leaderboard's header there), and its speed is at its top right: it stops short of the button, as the
  // gaps block's strip of sectors does upright (drive-view.spec.mjs). Held as: no text on the page is under the button,
  // and the speed and its unit in particular are clear of it by a few pixels.
  for (const [width, height, what] of [[1180, 820, 'Air, on its side'], [1366, 1024, '12.9", on its side'], [1024, 768, '9.7", on its side'], [1133, 744, 'mini, on its side'], [820, 1180, 'Air, upright'], [744, 1133, 'mini, upright']]) {
    test(`${width}x${height} (${what}): in a test drive the menu's button has no text under it, and is clear of the speed and its unit`, async ({ page }) => {
      test.setTimeout(90000);
      feed.payload = TEST_DRIVE();
      await page.addInitScript(() => { try { localStorage.setItem('rd-effects', 'off'); } catch (e) { /* none */ } });
      await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
      await page.setViewportSize({ width, height });
      await page.goto(`http://127.0.0.1:${port}/`);
      await frames(page);
      await page.waitForFunction(() => document.getElementById('fullMapSvg').style.getPropertyValue('--px') !== '' && document.getElementById('rd-remote-menu-fab'), null, { timeout: 10000 });
      await page.waitForTimeout(500);
      const m = await page.evaluate(() => {
        const rect = (b) => ({ left: b.left, top: b.top, right: b.right, bottom: b.bottom });
        const fab = document.getElementById('rd-remote-menu-fab');
        const f = fab.getBoundingClientRect();
        const box = (sel) => { const el = document.querySelector(sel); return el && el.getClientRects().length ? rect(el.getBoundingClientRect()) : null; };
        const under = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          const el = node.parentElement;
          if (!node.textContent.trim() || !el || fab.contains(el) || el.closest('script, style')) continue;
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const q of range.getClientRects()) {
            const w = Math.min(q.right, f.right) - Math.max(q.left, f.left);
            const h = Math.min(q.bottom, f.bottom) - Math.max(q.top, f.top);
            if (q.width > 0 && w > 1 && h > 1) under.push(`"${node.textContent.trim().slice(0, 20)}" in ${el.className || el.id || el.tagName}`);
          }
        }
        return { fab: rect(f), speed: box('.speed-value'), unit: box('.speed-unit'), under };
      });
      expect(m.under, `text under the button: ${JSON.stringify(m)}`).toEqual([]);
      for (const key of ['speed', 'unit']) {
        const b = m[key];
        expect(b, key).not.toBeNull();
        const apart = b.right <= m.fab.left - 2 || b.left >= m.fab.right + 2 || b.bottom <= m.fab.top - 2 || b.top >= m.fab.bottom + 2;
        expect(apart, `the ${key} ${JSON.stringify(b)} against the button ${JSON.stringify(m.fab)}`).toBe(true);
      }
    });
  }

  // Upright, a test drive keeps the laps panel and the ratings at the width they have in a race (their numbers are sized
  // from the cell's height, so a strip the width of the screen is empty glass), and the room the leaderboard had goes to
  // the following map beside them, which spans both rows; the full map has the row above to itself, with the tacho in
  // the hero's row beside the gaps (where it is upright in a race too, since the maps grew: drive-view.css).
  for (const [width, height, what] of [[820, 1180, 'Air'], [744, 1133, 'mini'], [810, 1080, '10.2"']]) {
    test(`${width}x${height} (${what}, upright): a test drive gives the following map the room beside the laps panel and the ratings, not a strip of empty glass`, async ({ page }) => {
      test.setTimeout(90000);
      feed.payload = TEST_DRIVE();
      await page.addInitScript(() => { try { localStorage.setItem('rd-effects', 'off'); } catch (e) { /* none */ } });
      await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
      await page.setViewportSize({ width, height });
      await page.goto(`http://127.0.0.1:${port}/`);
      await frames(page);
      await page.waitForFunction(() => document.getElementById('fullMapSvg').style.getPropertyValue('--px') !== '', null, { timeout: 10000 });
      await page.waitForTimeout(500);
      const rects = () => page.evaluate((cells) => Object.fromEntries(Object.entries(cells).map(([k, sel]) => {
        const b = document.querySelector(sel).getBoundingClientRect();
        return [k, { left: b.left, top: b.top, right: b.right, bottom: b.bottom, w: b.width, h: b.height }];
      })), { laps: '#lapsPanel', rating: '#ratingPage', local: '.map-zoom-panel', map: '.map-panel', tacho: '.tacho-block' });
      const td = await rects();
      expect(td.laps.w, 'the laps panel is no strip').toBeLessThan(width * 0.45);
      expect(td.rating.w, 'the ratings are no strip').toBeLessThan(width * 0.45);
      expect(td.local.left, 'the following map is beside the laps panel').toBeGreaterThanOrEqual(td.laps.right);
      expect(Math.abs(td.local.top - td.laps.top)).toBeLessThanOrEqual(2);
      expect(Math.abs(td.local.bottom - td.rating.bottom)).toBeLessThanOrEqual(2);
      // The tacho is in the hero's row, above the full map, which has its row to itself.
      expect(td.tacho.bottom).toBeLessThanOrEqual(td.map.top + 1);
      expect(td.map.w, 'the full map has the row to itself').toBeGreaterThan(width * 0.9);
      expect(td.local.right).toBeGreaterThan(width * 0.9);
      // The laps panel and the ratings are the width they have in a race, and the following map is the larger (a race's
      // following map upright is already nine columns of twenty-four by the maps' row).
      feed.payload = RACE();
      await frames(page);
      await page.waitForFunction(() => document.querySelectorAll('#lbRows .lb-row').length >= 3, null, { timeout: 10000 });
      await page.waitForTimeout(500);
      const race = await rects();
      expect(Math.abs(td.laps.w - race.laps.w), 'the laps panel keeps its width').toBeLessThanOrEqual(2);
      expect(Math.abs(td.rating.w - race.rating.w), 'the ratings keep their width').toBeLessThanOrEqual(2);
      expect(td.local.w * td.local.h, 'the following map, in a test drive and in a race').toBeGreaterThan(1.2 * race.local.w * race.local.h);
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
