/**
 * The glance layout (modules/styles/drive-view.css): the HUD as an iPad shows it, and as Ctrl+Shift+F shows it on the
 * rig. The page is served by remote-server.js's own server on 127.0.0.1, exactly as an iPad is given it, over a
 * stand-in for the rig's telemetry; every address but 127.0.0.1 is shut, so nothing reaches the network (and the
 * HUD's typefaces, which are Adobe's, are not there: the page is in the stand-in faces, as it is until they arrive).
 *
 * He asked for a data display, not a web page, that looks like the real thing: every panel of the HUD in the HUD's
 * glass and type, filling the screen, with the flag as the background when one is out. So at every size an iPad has,
 * in a race and out of one:
 *   - every panel is a cell, inside the screen, and the cells are the screen (no band of black),
 *   - nothing in a cell is cut off by it,
 *   - nothing is too small to read at a glance (no label under 11px, no number under 20px, the place at 80px),
 *   - and a cell is the HUD's own panel, in its type, its colours and its glass.
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

const here = path.dirname(fileURLToPath(import.meta.url));
const OVERLAY = path.resolve(here, '..', '..');
const KEY = 'abcd2345';
const WIRE = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'car-controls-wire.json'), 'utf8'));

// Every size an iPad has, on its side and upright: the Air and the 11" Pro (1180x820), the 9th generation and the
// 9.7" (1024x768), the 12.9" Pro (1366x1024), the mini (1133x744), the 10.2" (1080x810). And the two screens the rig's
// own Ctrl+Shift+F is on: 1920x1080 and the ultrawide 2560x1080.
const IPADS = [
  [1180, 820, 'Air, landscape'], [820, 1180, 'Air, portrait'], [1366, 1024, '12.9" Pro, landscape'],
  [1024, 768, '9.7", landscape'], [744, 1133, 'mini, portrait'], [1133, 744, 'mini, landscape'], [810, 1080, '10.2", portrait'],
];
// The rig's own screens are opened as the rig has them (from the file, drive mode switched on: no server, no
// html.rd-remote, so the two badges are cells and the glass is the rig's), not through the iPad's server.
const RIG = [[1920, 1080, 'the rig, 16:9'], [2560, 1080, 'the rig, ultrawide']];
// (his own screen as well, for the sectors: the ratings panel is cut off by its cell on it, as it was before the iPad's
// changes, which is not what these tests are about)
const RIG_SECTORS = [...RIG, [3440, 1440, 'the rig, his ultrawide']];
const SIZES = [...IPADS, ...RIG];

// The strategy engine calling for tyres and for fuel, with a pit window and a stint of 14 laps: more lines in the pit box.
const CALLS = {
  'RacingDesk.Plugin.Strategy.TireHealthState': 2, 'RacingDesk.Plugin.Strategy.TireLapsRemaining': 12,
  'RacingDesk.Plugin.Strategy.FuelHealthState': 2, 'RacingDesk.Plugin.Strategy.FuelLapsRemaining': 6,
  'RacingDesk.Plugin.Strategy.PitWindowOpen': 18, 'RacingDesk.Plugin.Strategy.PitWindowClose': 24,
  'RacingDesk.Plugin.Strategy.StintNumber': 2, 'RacingDesk.Plugin.Strategy.StintLaps': 14,
};

let telemetry, port, payload;

test.beforeAll(async () => {
  telemetry = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
  await new Promise((resolve) => telemetry.listen(0, '127.0.0.1', resolve));
  port = await new Promise((resolve) => {
    const probe = http.createServer();
    probe.listen(0, '127.0.0.1', () => { const { port: p } = probe.address(); probe.close(() => resolve(p)); });
  });
  await remote.start({
    port, host: '127.0.0.1', appDir: OVERLAY, key: KEY, log: () => {},
    telemetryUrl: `http://127.0.0.1:${telemetry.address().port}/racing-desk/`,
  });
});
test.afterAll(async () => {
  await remote.stop();
  await new Promise((resolve) => { telemetry.close(resolve); telemetry.closeAllConnections(); });
});

// A race in progress, and a practice: the HUD's numbers are not the same ones.
const RACE = (over = {}) => frame({ order: fieldWith(4), state: 4, mode: 4, start: 7, lap: 12, ...over });
const PRACTICE = () => frame({ order: fieldWith(4), session: 'Practice', state: 4, mode: 1, start: 4, lap: 6 });
const withCar = (car) => frame({ order: fieldWith(4), state: 4, mode: 4, start: 7, lap: 12, controls: WIRE[car] });

// The layout is what is held here, not the effects: with the iPad's own switch ("Effects: off", kept in its storage) the
// WebGL a headless browser draws in software does not take the machine from the rest of the tests. The glass, the
// flags and the numbers are the same either way; the page is shown with its effects on in remote-server.spec.mjs and
// in the golden frames.
async function openAt(page, width, height, first, { effects = false } = {}) {
  payload = first;
  if (!effects) await page.addInitScript(() => { try { localStorage.setItem('rd-effects', 'off'); } catch (e) { /* none */ } });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
  await page.setViewportSize({ width, height });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => typeof _isIdle !== 'undefined' && _isIdle === false && _pollFrame > 5, null, { timeout: 10000 });
  await drawn(page);
}

// The rig's own Ctrl+Shift+F: the page from the file, as the HUD has it, with drive mode switched on.
async function openRig(page, width, height, first) {
  payload = first;
  await page.route(/^https?:\/\/(?!localhost:8889)/, (route) => route.abort());
  await page.route('http://localhost:8889/racing-desk/', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) }));
  await page.setViewportSize({ width, height });
  await page.goto(pathToFileURL(path.join(OVERLAY, 'dashboard.html')).href);
  await page.evaluate(() => { _settings.showWebGL = false; });
  await page.waitForFunction(() => typeof _isIdle !== 'undefined' && _isIdle === false && _pollFrame > 6, null, { timeout: 10000 });
  // The circuit's name slides when it is wider than its label, and is measured when the HUD is first drawn, in its own
  // narrow label: switched to the glance layout a short name goes on sliding, a few pixels, for seconds. The text is
  // read where it stands, so the slide is held still (it is the HUD's, and not what these tests are of).
  await page.addStyleTag({ content: '.map-panel > .map-zoom-label .map-zoom-label-inner { animation: none !important; transform: none !important; }' });
  await page.evaluate(() => setDriveMode(true));
  await drawn(page);
}

// What the page has been given is what it has drawn: the leaderboard has its rows, the maps are fitted.
async function drawn(page) {
  await page.waitForFunction(() => {
    const svg = document.getElementById('fullMapSvg');
    return document.querySelectorAll('#lbRows .lb-row').length >= 3
      && svg && svg.style.getPropertyValue('--px') !== ''
      && document.getElementById('zoomMapSvg').style.getPropertyValue('--px') !== '';
  }, null, { timeout: 10000 });
  // A few more frames: the cells' widths and the type settle (the controls ease into place).
  const before = await page.evaluate(() => _pollFrame);
  await page.waitForFunction((n) => _pollFrame >= n + 6, before, { timeout: 5000 });
  await page.waitForTimeout(500);
}

async function serve(page, next) {
  payload = next;
  await drawn(page);
}

// Every panel of the HUD, and the one each is. On an iPad (which is what this server serves) the two badges, the
// Racing Desk mark and the car's maker, are not shown — he asked for the logos to go — so they are not cells here;
// the rig's own Ctrl+Shift+F keeps them.
const CELLS = {
  hero: '#positionPage', gaps: '#gapsBlock', tacho: '.tacho-block', lb: '#leaderboardPanel', map: '.map-panel',
  local: '.map-zoom-panel', laps: '#lapsPanel', rating: '#ratingPage', ctrl: '.car-controls', pedals: '.pedals-area',
  timer: '#raceTimerBlock', pit: '#pitBoxPanel', ds: '#datastreamPanel', inc: '#incidentsPanel',
};
// On the rig's own screen the two badges are cells too.
const CELLS_RIG = { ...CELLS, brand: '#brandLogoSquare', car: '#carLogoSquare' };

// Everything the rules are held to, measured in the page. Each is a list of what breaks it: nothing, when it holds.
function measure(page, cells = CELLS) {
  return page.evaluate((cellSelectors) => {
    const vw = innerWidth, vh = innerHeight;
    const shown = (el) => el.getClientRects().length > 0;
    const out = { cells: {}, outside: [], overflowing: [], cutOff: [], small: [], covered: 0, overlapping: [] };

    let area = 0;
    const rects = [];
    for (const [name, sel] of Object.entries(cellSelectors)) {
      const el = document.querySelector(sel);
      if (!el || !shown(el)) { out.outside.push(`${name}: not drawn`); continue; }
      const r = el.getBoundingClientRect();
      out.cells[name] = [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
      area += r.width * r.height;
      rects.push([name, r]);
      if (r.left < -0.5 || r.top < -0.5 || r.right > vw + 0.5 || r.bottom > vh + 0.5) out.outside.push(name);
    }
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const [a, ra] = rects[i], [b, rb] = rects[j];
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (w > 1 && h > 1) out.overlapping.push(`${a}/${b}`);
    }
    out.covered = area / (vw * vh);

    // Nothing in a cell is cut off by it: the cell's contents, and the parts inside it that lay themselves out.
    const containers = [...Object.values(cellSelectors), '#positionPage .pos-layout', '#positionPage .pos-meta', '#lbRows',
      '#incidentsPanel .inc-inner', '#gapsBlock .gap-item', '#gapsBlock .sector-cell', '#leaderboardPanel .lb-inner', '.lb-row',
      '.car-controls .ctrl-item', '.car-controls .ctrl-mini', '.ds-inner', '.pb-inner', '.pb-content', '.pb-page', '.pb-tire-circles',
      '.pb-circle-cell', '.laps-panel > *', '.laps-sectors .sector-cell', '.laps-col', '#ratingPage .rating-row',
      '#ratingPage .rating-item', '.pedal-labels-row', '.pedal-label-group', '.ds-gforce'];
    for (const sel of containers) {
      for (const el of document.querySelectorAll(sel)) {
        if (!shown(el)) continue;
        // (a line of type is taller than its line-height in a face like the mono, by a fraction of its size, and that
        // is the slack allowed in height)
        const slack = Math.max(1, parseFloat(getComputedStyle(el).fontSize) * 0.3);
        if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + slack) {
          out.overflowing.push(`${sel} ${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight}`);
        }
      }
    }

    // Nothing that is written is cut off or left out of sight: every piece of text in a cell lies inside the box its
    // ancestors let show (an overflow hidden, the ellipsis of a name that does not fit, a line clamp, and the cell).
    const gone = (el) => {
      for (let e = el; e && e !== document.body; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return true;
      }
      return false;
    };
    const window_ = (el, cell) => {
      let l = -Infinity, t = -Infinity, r = Infinity, b = Infinity;
      for (let e = el; e; e = e.parentElement) {
        const cs = getComputedStyle(e);
        // (a box that steps aside, display: contents, shows nothing of its own and clips nothing)
        if (cs.display !== 'contents' && (cs.overflowX !== 'visible' || cs.overflowY !== 'visible')) {
          const q = e.getBoundingClientRect();
          l = Math.max(l, q.left); t = Math.max(t, q.top); r = Math.min(r, q.right); b = Math.min(b, q.bottom);
        }
        if (e === cell) break;
      }
      return { l, t, r, b };
    };

    // Labels are 11px or more and numbers 20px or more. The exceptions are named: a caption to a name (the car's
    // model, a driver's iRating, an axis, a sector's number, the tank's size, the track's name) is a label whatever it
    // says, and so is a tyre's temperature under its ring (the pits' reading, not the lap's: he asked for them "Much
    // smaller", 2026-10-01); the leaderboard's rows are a list of a dozen, at 14px.
    const CAPTION = '.gap-ir, .gap-driver, .car-model-label, .sector-label, .ctrl-mini-label, .pb-circle-pos, .ir-bar-tick-label, ' +
      '.pb-fuel-tank-cap, .map-zoom-label, .panel-label, .ds-label, .pb-label, .laps-k, .pedal-channel-label, .ctrl-label, .lb-header, ' +
      '.pb-strat-btn, .pb-circle-temp';
    const tiny = new Map();
    for (const [name, sel] of Object.entries(cellSelectors)) {
      const cell = document.querySelector(sel);
      if (!cell || !shown(cell)) continue;
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const text = node.textContent.trim();
        const el = node.parentElement;
        if (!text || !el || !shown(el) || gone(el)) continue;
        if (el.closest('svg, canvas, #rd-remote-menu-fab, #rd-remote-menu-panel')) continue;

        const px = parseFloat(getComputedStyle(el).fontSize);
        // (a line's box is taller than the ink in it: a digit's is the middle three fifths, so that is what is held to
        // the box it is shown through)
        const range = document.createRange();
        range.selectNodeContents(node);
        const box = window_(el, cell);
        for (const q of range.getClientRects()) {
          if (q.width < 1) continue;
          const inset = px * (px >= 60 ? 0.3 : 0.22);
          const top = q.top + inset, bottom = q.bottom - inset;
          if (q.left < box.l - 1.5 || top < box.t - 1.5 || q.right > box.r + 1.5 || bottom > box.b + 1.5) {
            out.cutOff.push(`${name}: "${text.slice(0, 24)}" [${Math.round(q.left)},${Math.round(top)},${Math.round(q.right)},${Math.round(bottom)}] out of [${Math.round(box.l)},${Math.round(box.t)},${Math.round(box.r)},${Math.round(box.b)}]`);
            break;
          }
        }

        const inList = !!el.closest('.lb-row');
        const isCaption = !!el.closest(CAPTION);
        const isNumber = /\d/.test(text) && !isCaption && !inList;
        const min = isNumber ? 20 : 11;
        if (px < min - 0.01) tiny.set(`${name}: "${text.slice(0, 20)}" ${px.toFixed(1)}px < ${min}`, 1);
      }
    }
    out.small = [...tiny.keys()];

    // The leaderboard is a list of a dozen rows, at 14px or more in its rows' own type (its lap and gap columns are the
    // 0.84 of it, and never under a label's 11).
    for (const row of document.querySelectorAll('.lb-row')) {
      if (!shown(row)) continue;
      const px = parseFloat(getComputedStyle(row).fontSize);
      if (px < 14 - 0.01) out.small.push(`lb: a row is ${px.toFixed(1)}px < 14`);
    }
    out.place = parseFloat(getComputedStyle(document.querySelector('#positionPage .pos-number')).fontSize);
    out.gear = parseFloat(getComputedStyle(document.querySelector('.tacho-gear')).fontSize);
    const delta = document.querySelector('#positionPage .pos-meta-row.delta-row .val');
    out.delta = parseFloat(getComputedStyle(delta).fontSize);
    out.kind = document.body.classList.contains('session-race') ? 'race' : document.body.classList.contains('session-nonrace') ? 'nonrace' : 'none';
    return out;
  }, cells);
}

const describeSize = ([w, h, what]) => `${w}x${h} (${what})`;

for (const size of SIZES) {
  const [width, height] = size;
  // The rig's screens are the rig's own layout (with its two badges), opened from the file; an iPad's, through the server.
  const rig = RIG.includes(size);
  const cellsOf = rig ? CELLS_RIG : CELLS;
  test(`${describeSize(size)}: every panel is a cell, the cells are the screen, nothing is cut off or too small to read`, async ({ page }) => {
    test.setTimeout(90000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    if (rig) await openRig(page, width, height, RACE());
    else await openAt(page, width, height, RACE());

    // The grid, and the HUD's own wrappers out of the way.
    expect(await page.evaluate(() => getComputedStyle(document.body).display)).toBe('grid');
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('dashboard')).display)).toBe('contents');
    expect(await page.evaluate(() => document.documentElement.classList.contains('rd-remote'))).toBe(!rig);

    // Every size is held to a race and a practice; the cases that fill a cell the most (a place of three glyphs, a car
    // with a row of dials beneath, the flag's glass) to the sizes they are tightest at, the small ones and the upright.
    const tight = width <= 1024 || height <= 768 || height > width;
    const cases = [
      ['a race', null],
      ...(tight ? [
        ['a race at P12, a place of three glyphs', () => frame({ order: fieldWith(12), state: 4, mode: 4, start: 15, lap: 12 })],
        ['a race at P21, the back of the field', () => frame({ order: fieldWith(21), state: 4, mode: 4, start: 19, lap: 12 })],
        ['a race in a prototype with its dials in a row beneath', () => withCar('porsche963gtp')],
        ['a race in a formula car with DRS and push-to-pass', () => withCar('madeup formula drs 2')],
        ['a race under a yellow flag', () => RACE({ flag: 'yellow' })],
        ['a race with the strategy engine calling for tyres and fuel', () => RACE({ extra: CALLS })],
      ] : []),
      ['practice', () => PRACTICE()],
    ];
    for (const [name, next] of cases) {
      if (next) await serve(page, next());
      const m = await measure(page, cellsOf);
      const label = `${describeSize(size)}, ${name}`;
      expect(m.outside, `${label}: cells outside the screen`).toEqual([]);
      expect(Object.keys(m.cells).sort(), `${label}: every panel is drawn`).toEqual(Object.keys(cellsOf).sort());
      expect(m.overlapping, `${label}: cells on top of one another`).toEqual([]);
      // The cells are the screen: what is not a cell is the edge round the grid and the gutters between the cells.
      expect(m.covered, `${label}: the cells cover the screen (${JSON.stringify(m.cells)})`).toBeGreaterThanOrEqual(0.86);
      expect.soft(m.overflowing, `${label}: content cut off by its cell`).toEqual([]);
      expect.soft(m.cutOff, `${label}: text cut off or left out of sight`).toEqual([]);
      expect.soft(m.small, `${label}: type too small to glance at`).toEqual([]);
      expect(m.gear, `${label}: the gear`).toBeGreaterThanOrEqual(40);
      if (name === 'practice') {
        // Out of a race the place is a rank of best laps; the number that changes what he does is the live delta.
        expect(m.kind).toBe('nonrace');
        expect(m.delta, `${label}: the live delta is the big number`).toBeGreaterThanOrEqual(40);
        expect(m.delta).toBeGreaterThan(m.place);
      } else {
        expect(m.kind).toBe('race');
        expect(m.place, `${label}: the place`).toBeGreaterThanOrEqual(80);
      }
    }
    expect(errors).toEqual([]);
  });
}

test.describe('on the screen, at the size of an iPad Air on its side', () => {
  test.beforeEach(async ({ page }) => { await openAt(page, 1180, 820, RACE()); });

  test('the circuit fills its cell, and its lines are the HUD\'s three layers at the weights the layout gives them', async ({ page }) => {
    const m = await page.evaluate(() => {
      const svg = document.getElementById('fullMapSvg');
      const cell = svg.getBoundingClientRect();
      const ctm = svg.getScreenCTM();
      const outline = document.getElementById('fullMapTrackOuter').getBoundingClientRect();
      // (a width given as calc() is read back as calc(3.2px): the number in it)
      const px = (id, prop) => parseFloat(getComputedStyle(document.getElementById(id))[prop].match(/[\d.]+/)[0]) * ctm.a;
      const cs = (id) => getComputedStyle(document.getElementById(id));
      const player = document.getElementById('fullMapPlayer');
      const dot = document.querySelector('#fullMapOpponents circle');
      return {
        fillsW: outline.width / cell.width, fillsH: outline.height / cell.height,
        outer: px('fullMapTrackOuter', 'strokeWidth'), core: px('fullMapTrack', 'strokeWidth'), inner: px('fullMapTrackInner', 'strokeWidth'),
        sector: px('mapSector1', 'strokeWidth'),
        outerColour: cs('fullMapTrackOuter').stroke, coreColour: cs('fullMapTrack').stroke, innerColour: cs('fullMapTrackInner').stroke,
        player: parseFloat(player.getAttribute('r')) * ctm.a, opponent: parseFloat(dot.getAttribute('r')) * ctm.a,
        sf: document.getElementById('fullMapSF').style.display !== 'none',
      };
    });
    // The outline is as large as its cell lets it be: on one axis or the other it reaches almost to the edges, and on
    // neither does it go past them (a ratio over one is an outline that overflows its box).
    expect(Math.max(m.fillsW, m.fillsH)).toBeGreaterThan(0.85);
    expect(m.fillsW).toBeLessThanOrEqual(1);
    expect(m.fillsH).toBeLessThanOrEqual(1);
    // Twelve, seven and one and a half pixels: the HUD's 5 : 3 : 0.6 outline, given in pixels so it does not grow.
    expect(m.outer).toBeCloseTo(12, 0);
    expect(m.core).toBeCloseTo(7, 0);
    expect(m.inner).toBeCloseTo(1.5, 0);
    expect(m.sector).toBeCloseTo(8, 0);
    // The HUD's colours: a pale wide edge, a near-black core, a cyan centre line, the start/finish tick.
    expect(m.outerColour).toBe('rgba(255, 255, 255, 0.18)');
    expect(m.coreColour).toBe('rgba(17, 19, 23, 0.95)');
    expect(m.innerColour).toBe('rgba(71, 198, 209, 0.35)');   // hsla(185, 60%, 55%, 0.35)
    expect(m.sf).toBe(true);
    // The car is seven pixels across in radius, the others five, whatever the size of the cell.
    expect(m.player).toBeCloseTo(7, 0);
    expect(m.opponent).toBeCloseTo(5, 0);
  });

  test('the local view is the shape of its cell, with the car two-thirds of the way down', async ({ page }) => {
    const m = await page.evaluate(() => {
      const svg = document.getElementById('zoomMapSvg');
      const r = svg.getBoundingClientRect();
      const vb = svg.getAttribute('viewBox').split(/\s+/).map(Number);
      const player = document.getElementById('zoomMapPlayer');
      return {
        cellAspect: r.width / r.height, viewAspect: vb[2] / vb[3],
        down: (+player.getAttribute('cy') - vb[1]) / vb[3], across: (+player.getAttribute('cx') - vb[0]) / vb[2],
        radius: parseFloat(player.getAttribute('r')) * svg.getScreenCTM().a,
      };
    });
    expect(m.viewAspect / m.cellAspect).toBeCloseTo(1, 1);
    expect(m.down).toBeCloseTo(2 / 3, 1);
    expect(m.across).toBeCloseTo(0.5, 1);
    expect(m.radius).toBeCloseTo(7, 0);
  });

  test('the leaderboard\'s rows share its height: as many as fit, filling the panel', async ({ page }) => {
    const m = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#lbRows .lb-row')];
      const box = document.getElementById('lbRows').getBoundingClientRect();
      const last = rows[rows.length - 1].getBoundingClientRect();
      const fs = parseFloat(getComputedStyle(document.getElementById('lbRows')).fontSize);
      return { count: rows.length, room: box.height, bottomGap: box.bottom - last.bottom, row: last.height, fs, wide: rows.every((r) => r.scrollWidth <= r.clientWidth + 1) };
    });
    // A full field of twenty-one at this size, each a line and a bit of its own type, and no band of black under the last.
    expect(m.count).toBeGreaterThanOrEqual(12);
    expect(m.row).toBeGreaterThanOrEqual(m.fs * 1.5);
    expect(m.bottomGap).toBeLessThan(m.row * 0.5);
    expect(m.wide).toBe(true);
  });

  test('his sparkline is his places through the race, drawn where the row draws it', async ({ page }) => {
    await serve(page, frame({ order: fieldWith(6), state: 4, mode: 4, start: 7, lap: 13 }));
    const m = await page.evaluate(() => {
      const svg = document.querySelector('#lbRows .lb-row.lb-player .lb-spark');
      const b = svg.getBoundingClientRect();
      return { shown: svg.style.display !== 'none', width: b.width, height: b.height };
    });
    expect(m.shown).toBe(true);
    expect(m.width).toBeGreaterThan(40);
    expect(m.height).toBeGreaterThan(15);
  });

  test('the pit box shows its tyres, its fuel and the weather at once, where on the rig they are tabs', async ({ page }) => {
    const m = await page.evaluate(() => ['pbPageTyres', 'pbPageFuel', 'pbPageWeather'].map((id) => {
      const r = document.getElementById(id).getBoundingClientRect();
      return r.width > 40 && r.height > 40;
    }));
    expect(m).toEqual([true, true, true]);
    expect(await page.locator('.pb-tabs').isVisible()).toBe(false);
  });

  test('the laps panel: the lap, the times, each sector against his best, the three gaps and the fuel to the flag', async ({ page }) => {
    const m = await page.evaluate(() => ({
      count: document.getElementById('lapsCount').textContent,
      best: document.getElementById('lapsBest').textContent,
      optimal: document.getElementById('lapsOptimal').textContent,
      allTime: [document.getElementById('lapsDeltaAll').textContent, document.getElementById('lapsDeltaAll').className],
      sectors: [...document.querySelectorAll('#lapsSectors .sector-cell')].map((c) => [c.children[0].textContent, c.children[1].textContent, c.className.includes('sector-pb') ? 'pb' : c.className.includes('sector-slower') ? 'slower' : '']),
      fuel: [document.getElementById('lapsFuelK').textContent, document.getElementById('lapsFuel').textContent, document.getElementById('lapsFuel').className],
    }));
    expect(m.count).toBe('12 / 20');
    expect(m.best).toBe('1:32.347');
    // The plugin's best of each sector, added up (30.512 + 31.084 + 30.371).
    expect(m.optimal).toBe('1:31.967');
    // iRacing's gap to his best lap ever at the track: a plus and red, labelled as that.
    expect(m.allTime).toEqual(['+0.412', 'laps-v delta-slower']);
    expect(m.sectors).toEqual([['S1', '30.512', 'pb'], ['S2', '31.270', 'slower'], ['S3', '—', '']]);
    // 9.1 laps of fuel and 8 to go, to the flag: enough, with a lap to spare.
    expect(m.fuel).toEqual(['Fuel', '9.1 laps · 8 to go', 'laps-v green']);
  });

  test('every panel is shown whatever the rig\'s settings hide from its own screen, and leaving puts the settings back', async ({ page }) => {
    const shown = () => page.evaluate(() => ['datastreamPanel', 'pitBoxPanel', 'leaderboardPanel'].map((id) => document.getElementById(id).getClientRects().length > 0));
    await page.evaluate(() => { _settings.showDatastream = false; _settings.showPitBox = false; applySettings(); });
    expect(await shown()).toEqual([true, true, true]);
    // Out of drive mode (Ctrl+Shift+F again, on the rig) the rig's settings are what they were.
    await page.evaluate(() => setDriveMode(false));
    expect(await shown()).toEqual([false, false, true]);
    await page.evaluate(() => setDriveMode(true));
    expect(await shown()).toEqual([true, true, true]);
  });

  test('the menu is a small round button in the top right corner, the only touch target, and its list opens on screen from it', async ({ page }) => {
    const fab = await page.locator('#rd-remote-menu-fab').boundingBox();
    expect(fab.width).toBeGreaterThanOrEqual(44);
    expect(fab.height).toBeGreaterThanOrEqual(44);
    expect(fab.x + fab.width).toBeGreaterThan(1180 - 60);
    expect(fab.y).toBeLessThan(60);
    // The badges are not on an iPad, and the menu is where the Racing Desk mark no longer is.
    expect(await page.evaluate(() => ['brandLogoSquare', 'carLogoSquare'].map((id) => document.getElementById(id).getClientRects().length))).toEqual([0, 0]);
    await page.locator('#rd-remote-menu-fab').click();
    const panel = await page.locator('#rd-remote-menu-panel').boundingBox();
    expect(panel.y + panel.height <= fab.y || panel.y >= fab.y + fab.height).toBe(true);
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(1180);
    expect(panel.y).toBeGreaterThanOrEqual(0);
    expect(panel.y + panel.height).toBeLessThanOrEqual(820);
    for (const button of await page.locator('#rd-remote-menu-panel .rd-rm-btn').all()) {
      expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44);
    }
    // Nothing else reacts to touch: the cells are data.
    const targets = await page.evaluate(() => [...document.querySelectorAll('button, a, input, select, [onclick]')]
      .filter((el) => el.getClientRects().length > 0 && !el.closest('#rd-remote-menu-panel')).map((el) => el.tagName + '#' + el.id));
    expect(targets).toEqual([]);
    const pointer = await page.evaluate(() => Object.values({ lb: '#leaderboardPanel', pit: '#pitBoxPanel', hero: '#positionPage' })
      .map((s) => getComputedStyle(document.querySelector(s)).pointerEvents));
    expect(pointer).toEqual(['none', 'none', 'none']);
  });

  test('the HUD\'s type and its colours, in the HUD\'s own faces once they have arrived, on the HUD\'s glass', async ({ page, context }) => {
    // The iPad, with the faces the HUD is set in switched on (what the kit's arrival does; the kit is Adobe's, so
    // here the switch is thrown by hand)...
    await page.evaluate(() => document.documentElement.classList.add('rd-kit'));
    const style = (p) => p.evaluate(() => {
      const first = (family) => family.split(',')[0].replace(/["']/g, '').trim();
      const get = (sel, pick) => { const el = document.querySelector(sel); if (!el) return null; const cs = getComputedStyle(el); return pick(cs); };
      const em = (cs) => +(parseFloat(cs.letterSpacing) / parseFloat(cs.fontSize)).toFixed(3) || 0;
      const type = (sel) => get(sel, (cs) => ({ face: first(cs.fontFamily), weight: cs.fontWeight, caps: cs.textTransform, tracking: em(cs), colour: cs.color, numerals: cs.fontVariantNumeric }));
      return {
        label: type('#gapsBlock .panel-label'), header: type('.lb-header'), place: type('#positionPage .pos-number'),
        skew: get('#positionPage .skew-accent', (cs) => cs.transform), gapAhead: type('#gapsBlock .gap-time.ahead'), gapBehind: type('#gapsBlock .gap-time.behind'),
        driver: type('#gapsBlock .gap-driver'), incLabel: type('.inc-label'), incCount: type('.inc-count'), name: type('#lbRows .lb-name'),
        lbGap: type('#lbRows .lb-gap'), ctrlLabel: type('.ctrl-label'), ctrlValue: type('.ctrl-value'), timer: type('.race-timer-value'),
        gear: type('.tacho-gear'), speed: type('.speed-value'), tyre: type('.pb-circle-pct'), dsValue: type('.ds-value'),
        rating: type('.rating-value'), deltaRef: type('#positionPage .delta-ref'),
        panelBase: get('#gapsBlock', (cs) => cs.backgroundColor),
        // (its width is the rig's 2px, which the rig's zoom setting reads back divided by the zoom)
        edge: get('#lbRows .lb-row.lb-player', (cs) => cs.borderLeftColor),
        streak: get('#gapsBlock', () => getComputedStyle(document.getElementById('gapsBlock'), '::after').backgroundImage.split('),')[0]),
      };
    });
    const ipad = await style(page);

    // ...and the HUD on the rig's screen, the same frame, from the file (no server, no injection).
    const hud = await context.newPage();
    await hud.route(/^https?:\/\/(?!localhost:8889)/, (route) => route.abort());
    await hud.route('http://localhost:8889/racing-desk/', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) }));
    await hud.setViewportSize({ width: 1920, height: 1080 });
    await hud.goto(pathToFileURL(path.join(OVERLAY, 'dashboard.html')).href);
    await hud.evaluate(() => { _settings.showWebGL = false; });   // (its WebGL is not what is compared, and is costly here)
    await hud.waitForFunction(() => typeof _isIdle !== 'undefined' && _isIdle === false && document.querySelectorAll('#lbRows .lb-row').length >= 3, null, { timeout: 10000 });
    await hud.waitForTimeout(1500);   // the colours' own transitions (0.4s) have run
    const rig = await style(hud);

    // The HUD's own panel label is a small-caps label in its display face; so is the iPad's. And so on, item by item:
    // the face, the weight, the case, the tracking, the colour; the panel's base and its glass streak. (What differs
    // is the size, which is the cell's.)
    // Tracking is compared to within a hundredth of an em: what inherits the body's (0.48px) has it in pixels, so its
    // share of an em moves a little with the size, which is all that differs.
    const loose = (x) => (x && typeof x === 'object' && 'tracking' in x ? { ...x, tracking: undefined } : x);
    for (const key of Object.keys(rig)) {
      expect(loose(ipad[key]), `${key} is the HUD's`).toEqual(loose(rig[key]));
      if (rig[key] && typeof rig[key] === 'object' && 'tracking' in rig[key]) {
        expect(Math.abs(ipad[key].tracking - rig[key].tracking), `${key}'s tracking is the HUD's`).toBeLessThanOrEqual(0.012);
      }
    }
    expect(rig.place.face).toBe('JetBrains Mono');
    expect(rig.skew).not.toBe('none');
    expect(rig.label.caps).toBe('uppercase');
    await hud.close();

    // The glass on the iPad is lit as the rig's plastic mode lights it: an overhead glow in the ambient colour over each
    // panel, a tint through it and a hairline of that colour for an edge.
    const glass = await page.evaluate(() => {
      const cs = getComputedStyle(document.getElementById('gapsBlock'));
      const glow = getComputedStyle(document.getElementById('gapsBlock'), '::before');
      return { image: cs.backgroundImage, border: cs.borderTopColor, glow: glow.display, glowImage: glow.backgroundImage };
    });
    expect(glass.image).toContain('linear-gradient');
    expect(glass.glow).toBe('block');
    expect(glass.glowImage).toContain('radial-gradient');
  });
});

test.describe('the flag is the background', () => {
  test('a yellow fills every gutter and tints every panel; a blue rings the screen and leaves the panels as they are; the clear flag takes it away', async ({ page }) => {
    test.setTimeout(60000);
    await openAt(page, 1180, 820, RACE());
    const look = () => page.evaluate(() => {
      const before = getComputedStyle(document.body, '::before');
      return {
        flag: document.body.dataset.flag,
        opacity: before.opacity,
        pattern: before.backgroundImage,
        panel: getComputedStyle(document.getElementById('positionPage')).backgroundColor,
        tint: getComputedStyle(document.getElementById('positionPage')).backgroundImage,
      };
    });
    const none = await look();
    expect(none.flag).toBe('none');
    expect(none.opacity).toBe('0');

    await serve(page, RACE({ flag: 'yellow' }));
    await page.waitForTimeout(500);
    const yellow = await look();
    expect(yellow.flag).toBe('yellow');
    expect(+yellow.opacity).toBeCloseTo(0.15, 2);                   // on an iPad the pattern behind the panels is at fifteen hundredths (below)
    expect(yellow.pattern).toContain('rgb(253, 205, 13)');          // hsl(48, 98%, 52%), the flag's yellow
    expect(yellow.tint).toContain('rgba(245, 205, 40, 0.34)');      // the glass takes the flag's colour
    expect(yellow.panel).toBe('rgb(15, 15, 15)');                   // over a panel the numbers stay legible on, and nothing shows through it

    // A blue flag is a car to let by: the edge and the gutters, not the panels.
    await serve(page, RACE({ flag: 'blue' }));
    await page.waitForTimeout(500);
    const blue = await look();
    expect(blue.flag).toBe('blue');
    expect(+blue.opacity).toBeCloseTo(0.15, 2);
    expect(blue.pattern).toContain('rgb(29, 98, 237)');             // hsl(220, 85%, 52%)
    expect(blue.panel).toBe(none.panel);

    // Cleared: gone once the flag's hold is over (four seconds for a blue, as the gaps block holds it).
    await serve(page, RACE({ flag: 'none' }));
    await expect.poll(() => page.evaluate(() => document.body.dataset.flag), { timeout: 8000 }).toBe('none');
    await page.waitForTimeout(500);
    expect((await look()).opacity).toBe('0');
  });

  test('on an iPad the flag behind and between the panels is at fifteen hundredths, and a thin frame at the edge carries it whole', async ({ page }) => {
    test.setTimeout(90000);
    // What he asked for: the shiny backgrounds "brought back to about 15% opacity". The glass was; the stripes in every
    // gutter were not. Every layer that draws the flag's pattern on the page is at 0.15 or under, but for the frame,
    // which is a few pixels at the screen's edge and no wider — never a gutter — and may be at full strength.
    // Every layer on the page that draws the flag's pattern: the same image as the page's own flag layer (body::before,
    // whose background is --rd-flag-bg). Race control's banner has stripes of its own, and the panels their tint:
    // neither is the flag's pattern, and neither is what he asked to have brought down.
    const layers = () => page.evaluate(() => {
      const pattern = getComputedStyle(document.body, '::before').backgroundImage;
      const out = [];
      for (const el of document.querySelectorAll('body, body *')) {
        for (const pseudo of [null, '::before', '::after']) {
          const cs = getComputedStyle(el, pseudo);
          if (pseudo && cs.content === 'none') continue;
          if (cs.backgroundImage !== pattern) continue;
          out.push({ el: (el.id || el.className || el.tagName) + (pseudo || ''), opacity: +cs.opacity, padding: parseFloat(cs.paddingTop) || 0,
            masked: (cs.webkitMaskImage !== 'none' && cs.webkitMaskImage !== '') || (cs.maskImage && cs.maskImage !== 'none'), position: cs.position,
            // What makes a masked box a ring and not a whole screen: the second mask taken out of the first.
            composite: cs.maskComposite || cs.webkitMaskComposite || '', size: cs.maskSize || cs.webkitMaskSize || '' });
        }
      }
      return { pattern, out };
    });
    await openAt(page, 1180, 820, RACE());
    for (const flag of ['yellow', 'green', 'white', 'checkered', 'blue']) {
      await serve(page, RACE({ flag }));
      await page.waitForTimeout(500);
      expect(await page.evaluate(() => document.body.dataset.flag)).toBe(flag);
      const { pattern, out: found } = await layers();
      expect(pattern, `${flag}: a pattern`).toMatch(/gradient/);
      expect(found.length, `${flag}: the pattern is drawn`).toBeGreaterThanOrEqual(2);
      for (const layer of found) {
        if (layer.masked) {
          // The frame: at the screen's edge, a few pixels, the rest of the box masked out.
          expect(layer.position, `${flag}: ${layer.el}`).toBe('fixed');
          expect(layer.padding, `${flag}: ${layer.el} is a thin frame`).toBeGreaterThan(0);
          expect(layer.padding, `${flag}: ${layer.el} is a thin frame`).toBeLessThanOrEqual(6);
          // A ring, not the whole box: with the masks added together (the default) it would be every gutter again.
          expect(layer.composite.split(',')[0].trim(), `${flag}: ${layer.el} is a ring, one mask taken out of the other`).toMatch(/^(exclude|xor)$/);
        } else {
          expect(layer.opacity, `${flag}: ${layer.el} at fifteen hundredths`).toBeLessThanOrEqual(0.16);
        }
      }
      expect(found.some((l) => l.masked), `${flag}: the frame is there`).toBe(true);
    }
    // Cleared, the frame goes too.
    await serve(page, RACE({ flag: 'none' }));
    await expect.poll(() => page.evaluate(() => document.body.dataset.flag), { timeout: 8000 }).toBe('none');
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => getComputedStyle(document.body, '::after').opacity)).toBe('0');
    // On the rig's own glance layout the flag is as it was: full strength in the gutters, and no frame.
    await page.evaluate(() => document.documentElement.classList.remove('rd-remote'));
    await serve(page, RACE({ flag: 'yellow' }));
    await page.waitForTimeout(500);
    const rig = await page.evaluate(() => [getComputedStyle(document.body, '::before').opacity, getComputedStyle(document.body, '::after').content]);
    expect(rig).toEqual(['1', 'none']);
    await page.evaluate(() => document.documentElement.classList.add('rd-remote'));
  });

  test('on an iPad the pixels in the gutters between the panels are at fifteen hundredths and the pixels at the edge carry the flag', async ({ page }) => {
    test.setTimeout(150000);
    // The computed styles above say what the layers are; this looks at what is drawn. A frame whose mask stopped taking
    // the inside out (an engine that does not honour mask-composite, or a refactor of the shorthand) would still pass
    // every one of them, with the stripes at full strength in every gutter, which is what he complained of. In the
    // gutter between the relative and the laps panel (a straight one the length of the laps panel, and not under the
    // race's results, which cover the map and the local view once the flag is chequered), whatever the flag, nothing
    // is bright: the pattern is at 0.15 over the HUD's dark. And along the screen's edge, a few pixels wide, the flag's
    // pattern is there whole.
    const sample = async () => {
      const shot = (await page.screenshot()).toString('base64');
      return page.evaluate(async ({ b64 }) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + b64;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.width; canvas.height = img.height;
        const g = canvas.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0);
        const bright = (x, y) => { const d = g.getImageData(x, y, 1, 1).data; return Math.max(d[0], d[1], d[2]); };
        const a = document.getElementById('leaderboardPanel').getBoundingClientRect();
        const b = document.getElementById('lapsPanel').getBoundingClientRect();
        // The gutter between them: the column midway between the two panels, down the length of both (so a panel's
        // glow at its own edge is not what is judged).
        const [first, second] = a.left < b.left ? [a, b] : [b, a];
        const left = Math.ceil(first.right), right = Math.floor(second.left);
        const top = Math.ceil(Math.max(a.top, b.top)) + 4, bottom = Math.floor(Math.min(a.bottom, b.bottom)) - 4;
        let gutter = 0, gutterPixels = 0;
        const mid = Math.round((left + right) / 2);
        for (let y = top; y < bottom; y += 1) { gutter = Math.max(gutter, bright(mid, y)); gutterPixels++; }
        // The edge: the screen's outermost columns and rows (the frame is 4px of them).
        let edge = 0;
        for (let y = 0; y < img.height; y += 1) edge = Math.max(edge, bright(1, y), bright(img.width - 2, y));
        for (let x = 0; x < img.width; x += 1) edge = Math.max(edge, bright(x, 1), bright(x, img.height - 2));
        return { gutter, edge, gutterWidth: right - left, gutterPixels, size: [img.width, img.height] };
      }, { b64: shot });
    };
    for (const [width, height] of [[1180, 820], [820, 1180]]) {
      await openAt(page, width, height, RACE());
      await page.waitForTimeout(500);
      const dark = await sample();   // no flag yet: what the dark is
      expect(dark.gutterWidth, `${width}x${height}: a gutter to look at, between the relative and the laps`).toBeGreaterThanOrEqual(3);
      expect(dark.gutterPixels, `${width}x${height}: a gutter long enough to cross the stripes`).toBeGreaterThan(80);
      expect(dark.gutter, `${width}x${height}: no flag, a dark gutter`).toBeLessThan(60);
      for (const flag of ['yellow', 'green', 'white', 'checkered', 'blue']) {
        await serve(page, RACE({ flag }));
        await page.waitForTimeout(600);
        const m = await sample();
        // At 0.15 over the dark the brightest a stripe gets is the dark and 15% of the flag's lightest colour (a 245 white,
        // a 253 yellow): under 80. At full strength it is the flag's own colour, over 150 for every one of the five.
        expect(m.gutter, `${width}x${height} ${flag}: the gutter's brightest pixel (the dark is ${dark.gutter})`).toBeLessThan(80);
        expect(m.edge, `${width}x${height} ${flag}: the edge's brightest pixel: the frame carries the flag`).toBeGreaterThan(150);
      }
    }
  });

  test('the checkered flag is a checkerboard, and the meatball an orange disc on black', async ({ page }) => {
    await openAt(page, 1180, 820, RACE({ flag: 'checkered' }));
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => getComputedStyle(document.body, '::before').backgroundImage)).toContain('repeating-conic-gradient');
    await serve(page, RACE({ flag: 'meatball' }));
    await page.waitForTimeout(500);
    const meatball = await page.evaluate(() => [document.body.dataset.flag, getComputedStyle(document.body, '::before').backgroundImage]);
    expect(meatball[0]).toBe('meatball');
    expect(meatball[1]).toContain('radial-gradient');
  });
});

// ── Race control: the sentence is read whole, for every flag that has one, at every size ──────────────────────────────
// The banner is over the top of the full circuit. Its detail ("Full course yellow — hold position") is the message he
// most needs to read, and it was set on one line, so in a cell narrower than the sentence it read "FULL COURSE YELLOV".
for (const size of SIZES) {
  const [width, height] = size;
  test(`${describeSize(size)}: race control's whole sentence is read, for every flag that has one`, async ({ page }) => {
    test.setTimeout(90000);
    await openAt(page, width, height, RACE());
    for (const flag of ['yellow', 'red', 'checkered', 'black', 'meatball']) {
      await serve(page, RACE({ flag }));
      await page.waitForTimeout(700);
      const m = await page.evaluate(() => {
        const banner = document.getElementById('rcBanner');
        const content = banner.querySelector('.rc-content').getBoundingClientRect();
        const box = banner.getBoundingClientRect();
        const map = document.querySelector('.map-panel').getBoundingClientRect();
        const cut = [];
        for (const id of ['rcTitle', 'rcDetail']) {
          const el = document.getElementById(id);
          const range = document.createRange();
          range.selectNodeContents(el);
          for (const q of range.getClientRects()) {
            if (q.left < content.left - 1 || q.right > content.right + 1) cut.push(`${id} ${Math.round(q.left)}-${Math.round(q.right)} out of ${Math.round(content.left)}-${Math.round(content.right)}`);
          }
        }
        const detail = document.getElementById('rcDetail');
        return {
          shown: banner.classList.contains('rc-visible') && getComputedStyle(banner).opacity === '1',
          title: document.getElementById('rcTitle').textContent, detail: detail.textContent,
          cut, wider: detail.scrollWidth > detail.clientWidth + 1,
          inMap: box.left >= map.left - 1 && box.right <= map.right + 1 && box.top >= map.top - 1 && box.bottom <= map.bottom + 1,
          onScreen: box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight,
        };
      });
      const label = `${describeSize(size)}, ${flag}`;
      expect(m.shown, `${label}: the banner is up`).toBe(true);
      expect(m.detail.length, `${label}: it has a sentence`).toBeGreaterThan(10);
      expect(m.cut, `${label}: "${m.detail}" is read whole`).toEqual([]);
      expect(m.wider, `${label}: the sentence is not wider than its box`).toBe(false);
      expect(m.inMap, `${label}: the banner is over the circuit`).toBe(true);
      expect(m.onScreen, `${label}: and on the screen`).toBe(true);
    }
  });
}

test.describe('what the background flag and the race-control banner say together', () => {
  test('a flag that replaces the yellow takes its banner away at once: the banner never says yellow over a blue screen', async ({ page }) => {
    test.setTimeout(60000);
    await openAt(page, 1180, 820, RACE());
    const banner = () => page.evaluate(() => document.getElementById('rcBanner').classList.contains('rc-visible'));
    await serve(page, RACE({ flag: 'yellow' }));
    await page.waitForTimeout(400);
    expect(await banner()).toBe(true);
    expect(await page.evaluate(() => document.getElementById('rcDetail').textContent)).toMatch(/yellow/i);
    await serve(page, RACE({ flag: 'blue' }));
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.body.dataset.flag)).toBe('blue');
    expect(await banner()).toBe(false);
    // One that is cleared leaves it to run its time out (so that it is not yanked away), as it always did.
    await serve(page, RACE({ flag: 'red' }));
    await page.waitForTimeout(300);
    expect(await banner()).toBe(true);
    await serve(page, RACE({ flag: 'none' }));
    await page.waitForTimeout(300);
    expect(await banner()).toBe(true);
  });

  test('under a flag the panels are opaque: the pattern does not show through them', async ({ page }) => {
    test.setTimeout(60000);
    await openAt(page, 1180, 820, RACE({ controls: WIRE.porsche963gtp }));
    const panels = () => page.evaluate((cells) => {
      const out = {};
      for (const [name, sel] of Object.entries(cells)) {
        const el = document.querySelector(sel);
        if (name === 'lb') { out.lb = getComputedStyle(el.querySelector('.lb-inner')).backgroundColor; continue; }
        if (name === 'pit') { out.pit = getComputedStyle(el.querySelector('.pb-inner')).backgroundColor; continue; }
        if (name === 'ds') { out.ds = getComputedStyle(el.querySelector('.ds-inner')).backgroundColor; continue; }
        if (name === 'inc') { out.inc = getComputedStyle(el.querySelector('.inc-inner')).backgroundColor; continue; }
        out[name] = getComputedStyle(el).backgroundColor;
      }
      return out;
    }, CELLS);
    const opaque = (c) => /^rgb\(/.test(c);
    for (const flag of ['checkered', 'meatball', 'yellow', 'white', 'debris']) {
      await serve(page, RACE({ flag, controls: WIRE.porsche963gtp }));
      await page.waitForTimeout(500);
      const p = await panels();
      const seen = Object.entries(p).filter(([k, v]) => !opaque(v) && v !== 'rgba(0, 0, 0, 0)').map(([k, v]) => `${k}: ${v}`);
      expect(seen, `${flag}: every panel's base is opaque`).toEqual([]);
    }
  });

  test('the glass shows fifteen hundredths of the rig\'s light, and the badges are not there', async ({ page }) => {
    await openAt(page, 1180, 820, RACE());
    const glass = await page.evaluate(() => {
      const hero = document.getElementById('positionPage');
      const panel = document.querySelector('.map-panel');   // a .panel: the glow and the streak are its pseudo-elements
      const alpha = (image) => [...image.matchAll(/rgba\(\d+, \d+, \d+, ([\d.]+)\)/g)].map((m) => +m[1]);
      return {
        shine: getComputedStyle(document.body).getPropertyValue('--rd-shine').trim(),
        tint: alpha(getComputedStyle(hero).backgroundImage),
        glow: +getComputedStyle(panel, '::before').opacity,
        streak: +getComputedStyle(panel, '::after').opacity,
        lum: +getComputedStyle(document.documentElement).getPropertyValue('--ambient-lum') || 0,
        brand: document.getElementById('brandLogoSquare').getClientRects().length,
        car: document.getElementById('carLogoSquare').getClientRects().length,
        row: getComputedStyle(document.body).gridTemplateAreas.includes('brand'),
      };
    });
    expect(glass.shine).toBe('0.15');
    // The tint the rig has at 0.26 / 0.16 / 0.20, the overhead glow at 0.45 + lum × 0.5, the streak at 0.25 + lum × 0.35.
    // (an alpha is kept to the nearest 1/255 when it is read back)
    expect(glass.tint).toHaveLength(3);
    expect(glass.tint[0]).toBeCloseTo(0.26 * 0.15, 2);
    expect(glass.tint[1]).toBeCloseTo(0.16 * 0.15, 2);
    expect(glass.tint[2]).toBeCloseTo(0.20 * 0.15, 2);
    expect(glass.glow).toBeCloseTo((0.45 + glass.lum * 0.5) * 0.15, 2);
    expect(glass.streak).toBeCloseTo((0.25 + glass.lum * 0.35) * 0.15, 2);
    expect([glass.brand, glass.car, glass.row]).toEqual([0, 0, false]);
    // On the rig's own glance layout (no rd-remote) the glass is as it was, and the badges are cells.
    await page.evaluate(() => document.documentElement.classList.remove('rd-remote'));
    const rig = await page.evaluate(() => {
      const hero = document.getElementById('positionPage');
      return {
        shine: getComputedStyle(document.body).getPropertyValue('--rd-shine').trim(),
        tint: [...getComputedStyle(hero).backgroundImage.matchAll(/rgba\(\d+, \d+, \d+, ([\d.]+)\)/g)].map((m) => +m[1]),
        brand: document.getElementById('brandLogoSquare').getClientRects().length,
        row: getComputedStyle(document.body).gridTemplateAreas.includes('brand'),
      };
    });
    expect(rig.shine).toBe('');
    expect(rig.tint).toEqual([0.26, 0.16, 0.2]);
    expect([rig.brand > 0, rig.row]).toEqual([true, true]);
    await page.evaluate(() => document.documentElement.classList.add('rd-remote'));
  });

  test('a layout with many sectors, and sector times past a minute, never has a sector cropped', async ({ page }) => {
    test.setTimeout(60000);
    // Six sectors, each over a minute, with a gap on each: the widest the cells get.
    const six = {};
    for (let i = 1; i <= 6; i++) {
      six[`RacingDesk.Plugin.DS.SectorSplitS${i}`] = 60 + i * 1.111;
      six[`RacingDesk.Plugin.DS.SectorDeltaS${i}`] = i % 2 ? -0.123 : 0.456;
      six[`RacingDesk.Plugin.DS.SectorStateS${i}`] = i % 2 ? 2 : 3;
    }
    const wide = { 'RacingDesk.Plugin.DS.SectorCount': 6, 'RacingDesk.Plugin.DS.SectorBoundaryPcts': '0.15,0.3,0.5,0.65,0.85', ...six };
    for (const [width, height] of [[1180, 820], [820, 1180], [1133, 744], [744, 1133]]) {
      await openAt(page, width, height, RACE({ extra: wide }));
      await page.waitForTimeout(300);
      const m = await measure(page);
      const sectors = await page.evaluate(() => {
        const box = document.getElementById('lapsSectors');
        const cells = [...box.children];
        const r = box.getBoundingClientRect();
        return {
          count: cells.length,
          times: cells.map((c) => c.children[1].textContent),
          sizes: cells.map((c) => parseFloat(getComputedStyle(c.children[1]).fontSize)),
          clipped: cells.filter((c) => { const q = c.getBoundingClientRect(); return q.left < r.left - 0.5 || q.right > r.right + 0.5; }).length,
          overflow: cells.filter((c) => c.scrollWidth > c.clientWidth + 1).length,
          wrapped: document.getElementById('lapsPanel').classList.contains('laps-sectors-wrapped'),
          boundaries: window._sectorBoundaries,
        };
      });
      expect(sectors.count, `${width}x${height}`).toBe(6);
      expect(sectors.times[0]).toBe('1:01.111');
      expect(sectors.sizes.every((s) => s >= 20), `${width}x${height}: ${sectors.sizes}`).toBe(true);
      expect(sectors.clipped + sectors.overflow, `${width}x${height}: a sector cropped`).toBe(0);
      expect(m.cutOff.filter((c) => c.startsWith('laps')), `${width}x${height}`).toEqual([]);
      expect(m.overflowing.filter((c) => c.includes('laps')), `${width}x${height}`).toEqual([]);
      expect(sectors.boundaries).toEqual([0.15, 0.3, 0.5, 0.65, 0.85]);
    }
  });

  test('the spotter\'s card is over the datastream, not over the circuit or the local view', async ({ page }) => {
    await openAt(page, 1180, 820, RACE());
    await page.evaluate(() => { _pushSpotterMsg('Car ahead — 1.3s', 'sp-warn', 'Spotter'); });
    await page.waitForTimeout(600);
    const m = await page.evaluate(() => {
      const r = (sel) => document.querySelector(sel).getBoundingClientRect();
      const sp = r('#spotterPanel'), ds = r('#datastreamPanel'), map = r('.map-panel'), local = r('.map-zoom-panel');
      const meets = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
      return {
        shown: sp.width > 0 && sp.height > 0 && getComputedStyle(document.querySelector('#spotterPanel .sp-inner')).opacity !== '0',
        overMap: meets(sp, map), overLocal: meets(sp, local),
        inDs: sp.left >= ds.left - 1 && sp.right <= ds.right + 1 && sp.top >= ds.top - 1 && sp.bottom <= ds.bottom + 1,
        text: document.querySelector('#spotterPanel .sp-message').textContent,
      };
    });
    expect(m.text).toBe('Car ahead — 1.3s');
    expect(m.shown).toBe(true);
    expect(m.overMap).toBe(false);
    expect(m.overLocal).toBe(false);
    expect(m.inDs).toBe(true);
  });
});

// ── The clock cell says what it is ────────────────────────────────────────────────────────────────────────────────
test.describe('the clock', () => {
  const clock = (page) => page.evaluate(() => ({
    key: document.getElementById('raceTimerKey').textContent, value: document.getElementById('raceTimerValue').textContent,
    keyShown: getComputedStyle(document.getElementById('raceTimerKey')).display !== 'none',
  }));

  test('in a lap race it says the laps to go, not the time on the lap the hero has already', async ({ page }) => {
    await openAt(page, 1180, 820, RACE());
    expect(await clock(page)).toEqual({ key: 'Laps to go', value: '8', keyShown: true });
    await serve(page, RACE({ lap: 19 }));
    expect(await clock(page)).toEqual({ key: 'Laps to go', value: '1', keyShown: true });
  });

  test('in a race to a time it says the time left, in practice the clock', async ({ page }) => {
    await openAt(page, 1180, 820, RACE({ extra: { 'RacingDesk.Plugin.DS.IsLapRace': 0, 'RacingDesk.Plugin.DS.RemainingTimeFormatted': '0:14:22' } }));
    expect(await clock(page)).toEqual({ key: 'Time left', value: '0:14:22', keyShown: true });
    await serve(page, PRACTICE());
    expect((await clock(page)).key).toBe('Clock');
  });

  test('on the rig\'s own HUD the clock cell is what it was: the time on the lap in a lap race, with no key', async ({ page, context }) => {
    const hud = await context.newPage();
    await hud.route(/^https?:\/\/(?!localhost:8889)/, (route) => route.abort());
    await hud.route('http://localhost:8889/racing-desk/', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RACE()) }));
    await hud.setViewportSize({ width: 1920, height: 1080 });
    await hud.goto(pathToFileURL(path.join(OVERLAY, 'dashboard.html')).href);
    await hud.evaluate(() => { _settings.showWebGL = false; });
    await hud.waitForFunction(() => typeof _isIdle !== 'undefined' && _isIdle === false && _pollFrame > 6, null, { timeout: 10000 });
    const c = await clock(hud);
    expect(c.keyShown).toBe(false);
    expect(c.value).toMatch(/^\d+(:\d\d)?\.\d$/);   // 41.2: the time on this lap
    await hud.close();
  });
});

// ── The pit box's strategy calls, read on a screen with nothing to press ──────────────────────────────────────────────
test.describe('the strategy engine\'s calls in the pit box', () => {
  test('a call for tyres and one for fuel are shown, worded for a screen with nothing to press, and gone when the call is', async ({ page }) => {
    await openAt(page, 1180, 820, RACE());
    const calls = () => page.evaluate(() => ['pbStratSuggest', 'pbFuelStratSuggest'].map((id) => {
      const el = document.getElementById(id);
      return [getComputedStyle(el).display !== 'none', el.textContent.trim().replace(/\s+/g, ' '), getComputedStyle(el.querySelector('button')).pointerEvents];
    }));
    expect((await calls()).map((c) => c[0])).toEqual([false, false]);
    await serve(page, RACE({ extra: CALLS }));
    const on = await calls();
    expect(on.map((c) => c[0])).toEqual([true, true]);
    expect(on[0][1]).toMatch(/Change · ~12 laps/);
    expect(on[1][1]).toMatch(/Stop · ~6 laps/);
    expect(on.map((c) => c[2])).toEqual(['none', 'none']);
    // The fuel strategy's pit window is a line in the fuel page, and the laps on this set of tyres are in the tyres' heading
    // (what the rings' number is — iRacing measures tread in the pits and nowhere else — is a line under the rings: tyre-wear.spec.mjs).
    const more = () => page.evaluate(() => [document.getElementById('pbRowWindow').getClientRects().length > 0, document.getElementById('pbWindow').textContent,
      getComputedStyle(document.getElementById('pbPageTyres'), '::before').content]);
    expect(await more()).toEqual([true, 'L18–24', '"Tyres · 14 laps"']);
    await serve(page, RACE());
    expect((await calls()).map((c) => c[0])).toEqual([false, false]);
    expect(await more()).toEqual([false, '', '"Tyres"']);
  });
});

// ── The rig's own screen: Ctrl+Shift+F on 1920x1080, the ultrawide and his own, from the file, not through the server ──
// Every panel including the two badges (the rig keeps them), so a change that crops the car's badge or the row of
// controls here is caught: these are the rig's layout and not the iPad's.
for (const [width, height, what] of RIG) {
  test(`${width}x${height} (${what}): the glance layout of the rig's own HUD holds every panel`, async ({ page }) => {
    test.setTimeout(60000);
    await openRig(page, width, height, RACE({ controls: WIRE.porsche963gtp, extra: CALLS }));
    expect(await page.evaluate(() => document.documentElement.classList.contains('rd-remote'))).toBe(false);
    const m = await measure(page, CELLS_RIG);
    const label = `${width}x${height}`;
    expect(m.outside, `${label}: outside`).toEqual([]);
    expect(Object.keys(m.cells).sort(), `${label}: every panel is drawn, the badges too`).toEqual(Object.keys(CELLS_RIG).sort());
    expect(m.overlapping, `${label}: overlapping`).toEqual([]);
    expect.soft(m.overflowing, `${label}: content cut off by its cell`).toEqual([]);
    expect.soft(m.cutOff, `${label}: text cut off or left out of sight`).toEqual([]);
    expect.soft(m.small, `${label}: type too small`).toEqual([]);
    // The pit box in particular: the rear tyres' names and the two services were below its foot on this screen.
    const pit = await page.evaluate(() => {
      const cell = document.getElementById('pitBoxPanel').getBoundingClientRect();
      const low = [];
      for (const sel of ['#pbCircleLR .pb-circle-pos', '#pbCircleRR .pb-circle-pos', '#pbTempLR', '#pbTempRR', '#pbFuelLaps', '#pbConditions']) {
        const b = document.querySelector(sel).getBoundingClientRect();
        if (b.bottom > cell.bottom + 0.5 || b.top < cell.top) low.push(sel);
      }
      const services = ['#pbFastRepair', '#pbWindshield'].map((s) => { const el = document.querySelector(s); return el.getClientRects().length === 0 ? 'left out' : (el.getBoundingClientRect().bottom <= cell.bottom + 0.5 ? 'in' : 'below'); });
      return { low, services };
    });
    expect(pit.low, `${label}: the pit box's contents are inside it`).toEqual([]);
    expect(pit.services.filter((s) => s === 'below'), `${label}: the services are inside the pit box or left out, never below it`).toEqual([]);
  });
}

// ── A layout with many sectors, and sectors a minute long: every one is read, in the laps panel and in the strip ─────
// The laps panel is a cell of a fixed size and gives up what it cannot hold in stages (laps-panel.js, tried one on top
// of the other until the panel holds what is left: the sectors' gaps, then each sector a line, the rows of times, the
// fuel, the spacing, and last the sectors' names); the gaps block's strip of sectors, out of a race, goes on in
// another column. A Nordschleife has 10 sectors, the 24 hour layout 14, and a minute is a short sector there.
function timedSectors(n, base) {
  const extra = { 'RacingDesk.Plugin.DS.SectorCount': n, 'RacingDesk.Plugin.DS.SectorBoundaryPcts': Array.from({ length: n - 1 }, (_, i) => ((i + 1) / n).toFixed(3)).join(',') };
  for (let i = 1; i <= n; i++) {
    extra[`RacingDesk.Plugin.DS.SectorSplitS${i}`] = base + i * 1.111;
    extra[`RacingDesk.Plugin.DS.SectorDeltaS${i}`] = i % 2 ? -0.123 : 0.456;
    extra[`RacingDesk.Plugin.DS.SectorStateS${i}`] = i % 2 ? 2 : 3;
  }
  extra['RacingDesk.Plugin.DS.SectorBests'] = Array.from({ length: n }, (_, i) => (base + i).toFixed(3)).join(',');
  return extra;
}
const practiceWith = (extra) => frame({ order: fieldWith(4), session: 'Practice', state: 4, mode: 1, start: 4, lap: 6, extra });

// What is on show of the laps panel's sectors and the gaps block's strip.
function sectorsShown(page) {
  return page.evaluate(() => {
    const panel = document.getElementById('lapsPanel');
    const pr = panel.getBoundingClientRect();
    const inside = (q, r) => q.left >= r.left - 0.5 && q.right <= r.right + 0.5 && q.top >= r.top - 0.5 && q.bottom <= r.bottom + 0.5;
    const shown = (e) => e.getClientRects().length > 0;
    const cells = [...document.querySelectorAll('#lapsSectors .sector-cell')];
    const times = cells.map((c) => c.children[1]);
    const gb = document.getElementById('gapsBlock').getBoundingClientRect();
    const strip = [...document.querySelectorAll('#gapsBlock .sector-indicator .sector-cell')];
    const fab = document.getElementById('rd-remote-menu-fab')?.getBoundingClientRect();
    const meets = (a, b) => a && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    return {
      fit: +panel.dataset.fit,
      panelHolds: panel.scrollHeight <= panel.clientHeight + 1 && panel.scrollWidth <= panel.clientWidth + 1,
      count: cells.length,
      timesShown: times.filter((t) => shown(t) && inside(t.getBoundingClientRect(), pr)).length,
      sizes: times.map((t) => parseFloat(getComputedStyle(t).fontSize)),
      fuel: shown(document.getElementById('lapsFuel')),
      stripCount: strip.length,
      stripInside: strip.filter((c) => shown(c) && inside(c.getBoundingClientRect(), gb)).length,
      stripUnderMenu: strip.filter((c) => meets(fab, c.getBoundingClientRect())).length,
    };
  });
}

async function holdsEverySector(page, label, cells, n, base) {
  const s = await sectorsShown(page);
  const m = await measure(page, cells);
  expect(s.count, `${label}: the panel has a cell for each sector`).toBe(n);
  expect(s.panelHolds, `${label}: the laps panel holds what it shows (it gave up ${s.fit} stages)`).toBe(true);
  expect(s.timesShown, `${label}: every sector's time is in the panel (it gave up ${s.fit} stages)`).toBe(n);
  expect(Math.min(...s.sizes), `${label}: a sector's time is 20px or more`).toBeGreaterThanOrEqual(20 - 0.01);
  expect(s.stripCount, `${label}: the strip has a cell for each sector`).toBe(n);
  expect(s.stripInside, `${label}: every sector of the gaps block's strip is in the block`).toBe(n);
  expect(s.stripUnderMenu, `${label}: none of them is under the menu's button`).toBe(0);
  const mine = (c) => /lapsPanel|laps-|gapsBlock|^laps:|^gaps:/.test(c);
  expect(m.overflowing.filter(mine), `${label}: nothing in the laps panel or the strip is cut off by its cell`).toEqual([]);
  expect(m.cutOff.filter(mine), `${label}: no text of theirs is cut off`).toEqual([]);
  expect(m.small.filter(mine), `${label}: nor too small`).toEqual([]);
  if (n <= 4) expect(s.fuel, `${label}: the fuel against the laps to go stays while there are few sectors`).toBe(true);
  return s;
}

for (const size of IPADS) {
  const [width, height] = size;
  test(`${describeSize(size)}: a layout with many sectors, and sectors a minute long, is read whole in the laps panel and the gaps block's strip`, async ({ page }) => {
    test.setTimeout(150000);
    await openAt(page, width, height, practiceWith(timedSectors(3, 31.2)));
    for (const n of [3, 4, 7, 10, 14]) {
      for (const base of [31.2, 71.1]) {
        await serve(page, practiceWith(timedSectors(n, base)));
        const label = `${describeSize(size)}, ${n} sectors from ${base} s`;
        const s = await holdsEverySector(page, label, CELLS, n, base);
        // The Air on its side gives up nothing at the three sectors the layout has by default.
        if (width === 1180 && height === 820 && n === 3 && base < 60) expect(s.fit, `${label}: nothing given up`).toBe(0);
      }
    }
    // A sector not yet timed is as wide as one that is, so the panel does not change when the last of them is: it was
    // at the size where the three of them just fitted, and went from the whole panel to the short one (and back).
    const blank = timedSectors(3, 31.2);
    blank['RacingDesk.Plugin.DS.SectorSplitS3'] = 0; blank['RacingDesk.Plugin.DS.SectorDeltaS3'] = 0; blank['RacingDesk.Plugin.DS.SectorStateS3'] = 0;
    await serve(page, practiceWith(blank));
    const before = (await sectorsShown(page)).fit;
    await serve(page, practiceWith(timedSectors(3, 31.2)));
    expect((await sectorsShown(page)).fit, `${describeSize(size)}: the panel is the same before and after the last sector is timed`).toBe(before);
  });
}

for (const [width, height, what] of RIG_SECTORS) {
  test(`${width}x${height} (${what}): a layout with many sectors, and sectors a minute long, is read whole on the rig's own glance layout`, async ({ page }) => {
    test.setTimeout(150000);
    await openRig(page, width, height, practiceWith(timedSectors(3, 31.2)));
    for (const n of [3, 7, 10, 14]) {
      for (const base of [31.2, 71.1]) {
        await serve(page, practiceWith(timedSectors(n, base)));
        await holdsEverySector(page, `${width}x${height}, ${n} sectors from ${base} s`, CELLS_RIG, n, base);
      }
    }
  });
}

// ── Whether the cars around are closing or dropping away ─────────────────────────────────────────────────────────────
test.describe('the gaps block: which way the gaps are going', () => {
  test('it says over the last lap whether each gap shrank (▼) or grew (▲), green when that is good for him, red when not', async ({ page }) => {
    test.setTimeout(60000);
    const gaps = (ahead, behind) => ({ 'IRacingExtraProperties.iRacing_Opponent_Ahead_Gap': ahead, 'IRacingExtraProperties.iRacing_Opponent_Behind_Gap': behind });
    await openAt(page, 1180, 820, RACE({ lap: 12, extra: gaps(2.0, 1.0) }));
    const said = () => page.evaluate(() => {
      const named = (v) => { const s = document.createElement('span'); s.style.color = `var(${v})`; document.body.appendChild(s); const c = getComputedStyle(s).color; s.remove(); return c; };
      return {
        green: named('--green'), red: named('--red'),
        sides: ['#gapAheadItem .gap-ir', '#gapBehindItem .gap-ir'].map((sel) => {
          const after = getComputedStyle(document.querySelector(sel), '::after');
          return { content: after.content, colour: after.color };
        }),
      };
    });
    // The first lap seen says nothing.
    expect((await said()).sides.map((s) => s.content)).toEqual(['none', 'none']);

    // Next lap: he closed on the car ahead by 0.5 and the car behind dropped back by 0.4: both good.
    await serve(page, RACE({ lap: 13, extra: gaps(1.5, 1.4) }));
    let s = await said();
    expect(s.sides.map((x) => x.content)).toEqual(['" · ▼0.5/lap"', '" · ▲0.4/lap"']);
    expect(s.sides.map((x) => x.colour)).toEqual([s.green, s.green]);

    // The lap after: the car ahead pulled away by 0.3 and the car behind closed by 0.4: both bad.
    await serve(page, RACE({ lap: 14, extra: gaps(1.8, 1.0) }));
    s = await said();
    expect(s.sides.map((x) => x.content)).toEqual(['" · ▲0.3/lap"', '" · ▼0.4/lap"']);
    expect(s.sides.map((x) => x.colour)).toEqual([s.red, s.red]);
  });
});
