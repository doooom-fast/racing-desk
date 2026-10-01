/**
 * The track map on the host's outline: what the map cell says while there is no map (the host's TrackMap.Status),
 * that the circuit's sectors are split by the session's own boundaries and not equal fractions, that crossing the
 * line is one more step on the map and not a jump, and that nothing in the app resets or records a map any more:
 * no key, no action, no Stream Deck button, no fetch.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MOCK_TELEMETRY } from '../helpers.mjs';
import { frame, fieldWith, at, SVG_PATH } from '../frames.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const OVERLAY = path.resolve(here, '..', '..');
const DASHBOARD = pathToFileURL(path.join(OVERLAY, 'dashboard.html')).href;
const read = (p) => fs.readFileSync(path.join(OVERLAY, p), 'utf8');

// The page over a plugin that serves whatever it was last given (window.__feed.payload), nothing from the network.
async function loadDashboard(page, payload) {
  await page.route(/^https?:\/\//, (route) => route.abort());
  await page.addInitScript((first) => {
    window.__feed = { payload: first };
    const realFetch = window.fetch;
    window.fetch = function (url) {
      if (!/^http:\/\/localhost:8889\/racing-desk\/$/.test(String(url))) return realFetch.apply(this, arguments);
      return Promise.resolve(new Response(JSON.stringify(window.__feed.payload), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    };
  }, { ...MOCK_TELEMETRY, ...payload });
  await page.goto(DASHBOARD, { waitUntil: 'load' });
  await page.waitForTimeout(300);
}

const waiting = (page) => page.evaluate(() => {
  const el = document.getElementById('fullMapWaiting');
  return { text: el.textContent, shown: el.getClientRects().length > 0, size: parseFloat(getComputedStyle(el).fontSize) };
});

test.describe('what the map cell says', () => {
  test('while the host has no outline of the layout yet, and nothing once there is one', async ({ page }) => {
    test.setTimeout(60000);
    await loadDashboard(page, { 'RacingDesk.Plugin.TrackMap.Ready': 0, 'RacingDesk.Plugin.TrackMap.Status': 'first-lap', 'RacingDesk.Plugin.TrackMap.SvgPath': '' });
    await expect.poll(() => waiting(page).then((w) => w.text), { timeout: 10000 }).toBe('Map after one clean lap');
    expect((await waiting(page)).shown).toBe(true);
    expect((await waiting(page)).size).toBeGreaterThanOrEqual(11);

    // No host: said in what he can see and do, not in the name of a part of the app. The app is running (it is what is
    // showing this), so it is "starting its maps" at first and, when that has gone on for a minute, a thing to restart.
    await page.evaluate((p) => { window.__feed.payload = p; }, { ...MOCK_TELEMETRY, 'RacingDesk.Plugin.TrackMap.Ready': 0, 'RacingDesk.Plugin.TrackMap.Status': 'no-host' });
    await expect.poll(() => waiting(page).then((w) => w.text), { timeout: 10000 }).toBe('No map yet — the app is starting its maps');
    expect((await waiting(page)).text).not.toMatch(/host/i);
    await page.evaluate(() => { window.__realNow = Date.now; Date.now = () => window.__realNow.call(Date) + 61000; });
    await expect.poll(() => waiting(page).then((w) => w.text), { timeout: 10000 }).toBe('No map — restart the app to bring its maps back');
    expect((await waiting(page)).text).not.toMatch(/host/i);
    await page.evaluate(() => { Date.now = window.__realNow; });

    // A map: the line goes, whatever the status says.
    const race = frame({ order: fieldWith(4), state: 4, mode: 4, start: 7, lap: 12 });
    await page.evaluate((p) => { window.__feed.payload = p; }, { ...race, 'RacingDesk.Plugin.TrackMap.Status': 'ready' });
    await expect.poll(() => waiting(page).then((w) => w.text), { timeout: 10000 }).toBe('');
    expect((await waiting(page)).shown).toBe(false);
    expect(await page.evaluate(() => document.getElementById('fullMapTrackSrc').getAttribute('d').length)).toBeGreaterThan(100);
    const circuitHeight = () => page.evaluate(() => document.getElementById('fullMapSvg').getBoundingClientRect().height);
    const heightWithout = await circuitHeight();
    expect(heightWithout).toBeGreaterThan(30);

    // A map that is SimHub's shared one (the host's interim until his first clean lap): drawn as any other, and the cell
    // says plainly whose it is and until when, in one line under the circuit, at the label's floor.
    await page.evaluate((p) => { window.__feed.payload = p; }, { ...race, 'RacingDesk.Plugin.TrackMap.Status': 'crowd' });
    await expect.poll(() => waiting(page).then((w) => w.text), { timeout: 10000 }).toBe('SimHub’s map until your first clean lap');
    await page.waitForTimeout(200);
    const noteFacts = () => page.evaluate(() => {
      const el = document.getElementById('fullMapWaiting');
      const inner = el.querySelector('.map-note-inner');
      const r = el.getBoundingClientRect(), panel = el.parentElement.getBoundingClientRect();
      const label = document.getElementById('fullMapLabel').getBoundingClientRect();
      const svg = document.getElementById('fullMapSvg').getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(inner);
      const lines = new Set([...range.getClientRects()].map((q) => Math.round(q.top))).size;
      return { shown: el.getClientRects().length > 0, note: el.classList.contains('map-note'), size: parseFloat(getComputedStyle(el).fontSize),
        nowrap: getComputedStyle(el).whiteSpace, lines,
        inPanel: r.top >= panel.top && r.bottom <= panel.bottom, belowCircuit: r.top >= svg.bottom - 1,
        aboveName: r.bottom <= label.top + 1, path: document.getElementById('fullMapTrackSrc').getAttribute('d').length,
        sliding: el.classList.contains('is-marquee'), wider: inner.scrollWidth > el.clientWidth + 2,
        // The line is cut off at the cell's edge and nothing slides it: unseen. (A sliding line is not cut: it is moved.)
        cut: inner.scrollWidth > el.clientWidth + 2 && !el.classList.contains('is-marquee'),
        svgHeight: svg.height };
    });
    const note = await noteFacts();
    expect(note.shown).toBe(true);
    expect(note.note).toBe(true);
    expect(note.size).toBeGreaterThanOrEqual(11);
    // Under the circuit and above its name, covering nothing: not the top, where race control's banner goes under a flag.
    expect([note.inPanel, note.belowCircuit, note.aboveName]).toEqual([true, true, true]);
    expect(note.path).toBeGreaterThan(100);
    // One line, and the circuit gives up a line and no more: in the rig's small cell (this is its default layout, where
    // a sentence that wrapped took the circuit down to a fifth of its height) as in the glance layout and an iPad's.
    expect([note.nowrap, note.lines]).toEqual(['nowrap', 1]);
    expect(note.svgHeight / heightWithout, `the circuit was ${heightWithout.toFixed(0)}px tall and is ${note.svgHeight.toFixed(0)}px`).toBeGreaterThan(0.72);
    // A line wider than its cell slides; one that fits stays put. Never cut off and left.
    expect(note.cut).toBe(false);
    expect((await waiting(page)).text).not.toMatch(/crowd|branch|commit|merge|git/i);
    // The glance layout, on a screen the size of an iPad's: the same, and the cell changing size is noticed.
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.evaluate(() => setDriveMode(true));
    await page.waitForTimeout(500);
    const glanceWithout = await (async () => {
      await page.evaluate((p) => { window.__feed.payload = p; }, { ...race, 'RacingDesk.Plugin.TrackMap.Status': 'ready' });
      await expect.poll(() => waiting(page).then((w) => w.text), { timeout: 10000 }).toBe('');
      await page.waitForTimeout(300);
      return circuitHeight();
    })();
    await page.evaluate((p) => { window.__feed.payload = p; }, { ...race, 'RacingDesk.Plugin.TrackMap.Status': 'crowd' });
    await expect.poll(() => waiting(page).then((w) => w.text), { timeout: 10000 }).toBe('SimHub’s map until your first clean lap');
    await page.waitForTimeout(500);
    const glance = await noteFacts();
    expect(glance.size).toBeGreaterThanOrEqual(11);
    expect([glance.nowrap, glance.lines, glance.cut, glance.belowCircuit, glance.aboveName]).toEqual(['nowrap', 1, false, true, true]);
    expect(glance.svgHeight / glanceWithout, `the glance circuit was ${glanceWithout.toFixed(0)}px tall and is ${glance.svgHeight.toFixed(0)}px`).toBeGreaterThan(0.85);
    await page.evaluate(() => setDriveMode(false));
    await page.setViewportSize({ width: 1280, height: 600 });
    await page.waitForTimeout(500);
    expect((await noteFacts()).cut, 'back to the small cell: the line slides if it no longer fits').toBe(false);
    // His own outline takes over: the note goes and the map stays.
    await page.evaluate((p) => { window.__feed.payload = p; }, { ...race, 'RacingDesk.Plugin.TrackMap.Status': 'ready' });
    await expect.poll(() => waiting(page).then((w) => w.text), { timeout: 10000 }).toBe('');
    expect(await page.evaluate(() => document.getElementById('fullMapWaiting').classList.contains('map-note'))).toBe(false);
    expect(await page.evaluate(() => document.getElementById('fullMapTrackSrc').getAttribute('d').length)).toBeGreaterThan(100);

    // A host from before the status (none sent), with no map: nothing is said, as nothing was.
    await page.evaluate((p) => { window.__feed.payload = p; }, { ...MOCK_TELEMETRY, 'RacingDesk.Plugin.TrackMap.Ready': 0 });
    await expect.poll(() => page.evaluate(() => document.getElementById('fullMapTrackSrc').getAttribute('d')), { timeout: 10000 }).toBe('');
    expect((await waiting(page)).text).toBe('');
  });
});

test.describe('the circuit\'s sectors', () => {
  test('are split by the session\'s own boundaries, in a race and out of one', async ({ page }) => {
    const bounds = { 'RacingDesk.Plugin.DS.SectorCount': 3, 'RacingDesk.Plugin.DS.SectorBoundaryPcts': '0.2,0.75' };
    await loadDashboard(page, { ...frame({ order: fieldWith(4), state: 4, mode: 4, start: 7, lap: 12 }), ...bounds });
    await expect.poll(() => page.evaluate(() => window._sectorBoundaries), { timeout: 10000 }).toEqual([0.2, 0.75]);
    const lengths = await page.evaluate(() => [1, 2, 3].map((i) => (document.getElementById('mapSector' + i).getAttribute('d').match(/ L /g) || []).length));
    // The three sector paths are a fifth, a bit over a half and a quarter of the lap's points: not thirds.
    const total = lengths.reduce((a, b) => a + b, 0);
    expect(lengths[0] / total).toBeCloseTo(0.2, 1);
    expect(lengths[1] / total).toBeCloseTo(0.55, 1);
    expect(lengths[2] / total).toBeCloseTo(0.25, 1);
    // Out of a race the same boundaries hold (they used to be equal fractions there).
    await page.evaluate((p) => { window.__feed.payload = p; }, { ...frame({ order: fieldWith(4), session: 'Practice', state: 4, mode: 1, start: 4, lap: 6 }), ...bounds });
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window._sectorBoundaries)).toEqual([0.2, 0.75]);
    // With the legacy two keys only, those; with neither, the last known stand.
    await page.evaluate((p) => { window.__feed.payload = p; }, { ...frame({ order: fieldWith(4), state: 4, mode: 4, start: 7, lap: 12 }), 'RacingDesk.Plugin.DS.SectorS2StartPct': 0.4, 'RacingDesk.Plugin.DS.SectorS3StartPct': 0.8 });
    await expect.poll(() => page.evaluate(() => window._sectorBoundaries), { timeout: 10000 }).toEqual([0.4, 0.8]);
  });
});

test.describe('crossing the line', () => {
  test('is one more step of the car on the map, with no jump rule and no slow blend', async ({ page }) => {
    test.setTimeout(60000);
    await loadDashboard(page, frame({ order: fieldWith(4), state: 4, mode: 4, start: 7, lap: 12, playerPct: 0.97 }));
    await expect.poll(() => page.evaluate(() => document.getElementById('fullMapTrackSrc').getAttribute('d').length), { timeout: 10000 }).toBeGreaterThan(100);
    const dot = () => page.evaluate(() => { const c = document.getElementById('fullMapPlayer'); return [+c.getAttribute('cx'), +c.getAttribute('cy')]; });
    // The car across the line, a 0.3% step of the lap at a time, as the host places it along its closed loop; the
    // dot is read once the low-pass has settled on each, and is where the host put the car (within the snap to the
    // nearest point of the drawn path) on every step, the line included: nothing holds it back or slides it.
    const off = [];
    for (let i = 0; i < 14; i++) {
      const pct = (0.985 + i * 0.003) % 1;
      const p = at(pct);
      await page.evaluate((f) => { window.__feed.payload = f; }, frame({ order: fieldWith(4), state: 4, mode: 4, start: 7, lap: 12, playerPct: pct, extra: { 'RacingDesk.Plugin.TrackMap.PlayerX': +p.x.toFixed(2), 'RacingDesk.Plugin.TrackMap.PlayerY': +p.y.toFixed(2) } }));
      await page.waitForTimeout(450);
      const now = await dot();
      off.push(Math.hypot(now[0] - p.x, now[1] - p.y));
    }
    expect(Math.max(...off), `off by: ${off.map((s) => s.toFixed(2)).join(' ')}`).toBeLessThan(1.2);
    expect(read('modules/js/webgl-helpers.js')).not.toMatch(/jump > 15|jump > 20|resetTrackMap/);
  });
});

test.describe('a teleport', () => {
  test('takes the trail away: a car put in the pits is not drawn with a quarter of the lap behind it', async ({ page }) => {
    test.setTimeout(60000);
    await loadDashboard(page, frame({ order: fieldWith(4), state: 4, mode: 4, start: 7, lap: 12, playerPct: 0.3 }));
    await expect.poll(() => page.evaluate(() => document.getElementById('fullMapTrackSrc').getAttribute('d').length), { timeout: 10000 }).toBeGreaterThan(100);
    const trail = () => page.evaluate(() => (document.getElementById('fullMapTrail')?.getAttribute('points') || '').trim().split(/\s+/).filter(Boolean).length);
    const put = async (pct, wait = 300) => {
      const p = at(pct);
      await page.evaluate((f) => { window.__feed.payload = f; }, frame({ order: fieldWith(4), state: 4, mode: 4, start: 7, lap: 12, playerPct: pct, extra: { 'RacingDesk.Plugin.TrackMap.PlayerX': +p.x.toFixed(2), 'RacingDesk.Plugin.TrackMap.PlayerY': +p.y.toFixed(2) } }));
      await page.waitForTimeout(wait);
    };
    // Driven along, a few percent of the lap at a time: a trail grows behind the car.
    for (let pct = 0.3; pct <= 0.46; pct += 0.01) await put(pct);
    const driven = await trail();
    expect(driven, 'a trail behind a car that is being driven').toBeGreaterThan(20);
    // Put in the pits on the other side of the lap, and left there: the trail is not drawn from where the car was to
    // where it is (a quarter of the lap, 60 of the circuit's 240 points, which is what it was clamped to). What is
    // left is the last few points of the low-pass catching up with the car.
    await put(0.8, 1500);
    const teleported = await trail();
    expect(teleported, `before ${driven} points, after ${teleported}`).toBeLessThanOrEqual(12);
  });
});

test.describe('nothing resets or records a map', () => {
  test('no key, no action, no Stream Deck button, no fetch of resetmap, and the status is read', () => {
    expect(read('main.js')).not.toMatch(/reset-trackmap|Shift\+M'/);
    expect(read('preload.js')).not.toMatch(/ResetTrackmap|reset-trackmap/);
    expect(read('modules/js/keyboard.js')).not.toMatch(/resetTrackMap|ResetTrackmap/);
    expect(read('remote-server.js')).not.toMatch(/reset-trackmap/);
    expect(read('modules/js/webgl-helpers.js')).not.toMatch(/resetmap|listtracks/);
    expect(read('streamdeck/racing-desk/com.doooom.racingdesk.sdPlugin/manifest.json')).not.toMatch(/reset-trackmap/);
    expect(read('streamdeck/racing-desk/src/actions/overlay-action.ts')).not.toMatch(/reset-trackmap/);
    expect(read('streamdeck/src/actions/overlay-action.ts')).not.toMatch(/reset-trackmap/);
    expect(fs.existsSync(path.join(OVERLAY, 'streamdeck/racing-desk/com.doooom.racingdesk.sdPlugin/imgs/actions/reset-trackmap'))).toBe(false);
    expect(read('modules/js/poll-engine.js')).toMatch(/RacingDesk\.Plugin\.TrackMap\.Status/);
    expect(SVG_PATH.startsWith('M ')).toBe(true);
  });
});
