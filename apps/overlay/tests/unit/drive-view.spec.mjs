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
// 9.7" (1024x768), the 12.9" Pro (1366x1024), the mini (1133x744), the 10.2" (1080x810).
const SIZES = [
  [1180, 820, 'Air, landscape'], [820, 1180, 'Air, portrait'], [1366, 1024, '12.9" Pro, landscape'],
  [1024, 768, '9.7", landscape'], [744, 1133, 'mini, portrait'], [1133, 744, 'mini, landscape'], [810, 1080, '10.2", portrait'],
];

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

// Every panel of the HUD, and the one each is.
const CELLS = {
  hero: '#positionPage', gaps: '#gapsBlock', tacho: '.tacho-block', lb: '#leaderboardPanel', map: '.map-panel',
  local: '.map-zoom-panel', laps: '#lapsPanel', rating: '#ratingPage', ctrl: '.car-controls', pedals: '.pedals-area',
  brand: '#brandLogoSquare', car: '#carLogoSquare', timer: '#raceTimerBlock', pit: '#pitBoxPanel', ds: '#datastreamPanel',
  inc: '#incidentsPanel',
};

// Everything the four rules are held to, measured in the page. Each is a list of what breaks it: nothing, when it holds.
function measure(page) {
  return page.evaluate((cellSelectors) => {
    const vw = innerWidth, vh = innerHeight;
    const shown = (el) => el.getClientRects().length > 0;
    const out = { cells: {}, outside: [], overflowing: [], small: [], covered: 0, overlapping: [] };

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
      '.car-controls .ctrl-item', '.car-controls .ctrl-mini', '.ds-inner', '.pb-page', '.laps-panel > *', '.laps-sectors .sector-cell',
      '#ratingPage .rating-row'];
    for (const sel of containers) {
      for (const el of document.querySelectorAll(sel)) {
        if (!shown(el)) continue;
        if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) {
          out.overflowing.push(`${sel} ${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight}`);
        }
      }
    }

    // Nothing is too small: labels 11px, numbers 20px.
    const floor = (list, min) => {
      for (const sel of list) {
        for (const el of document.querySelectorAll(sel)) {
          if (!shown(el) || !el.textContent.trim()) continue;
          const px = parseFloat(getComputedStyle(el).fontSize);
          if (px < min - 0.01) out.small.push(`${sel} ${px}px < ${min}`);
        }
      }
    };
    floor(['#gapsBlock .panel-label', '.car-controls .ctrl-label', '.inc-label', '.lb-header', '.gap-driver', '.gap-ir',
      '.inc-thresh-row', '.race-timer-lap', '.map-panel > .map-zoom-label', '.ctrl-mini-label', '#gapsBlock .sector-label',
      '#positionPage .pos-meta-row', '#positionPage .delta-ref', '.laps-k', '.laps-panel .panel-label', '.laps-sectors .sector-label',
      '.ds-label', '.ds-value', '.pb-label', '.pb-value', '.pb-circle-pct', '.pb-circle-temp', '.pedal-channel-label',
      '#ratingPage .panel-label', '.speed-unit', '.tacho-rpm', '.car-model-label'], 11);
    floor(['#gapsBlock .gap-time', '.car-controls .ctrl-value', '.inc-count', '.inc-x', '.race-timer-value',
      '#positionPage .pos-meta-row .val', '#positionPage .pos-delta.visible', '.speed-value', '#ratingPage .rating-value'], 20);
    floor(['.lb-row'], 14);
    out.place = parseFloat(getComputedStyle(document.querySelector('#positionPage .pos-number')).fontSize);
    out.gear = parseFloat(getComputedStyle(document.querySelector('.tacho-gear')).fontSize);
    const delta = document.querySelector('#positionPage .pos-meta-row.delta-row .val');
    out.delta = parseFloat(getComputedStyle(delta).fontSize);
    out.kind = document.body.classList.contains('session-race') ? 'race' : document.body.classList.contains('session-nonrace') ? 'nonrace' : 'none';
    return out;
  }, CELLS);
}

const describeSize = ([w, h, what]) => `${w}x${h} (${what})`;

for (const size of SIZES) {
  const [width, height] = size;
  test(`${describeSize(size)}: every panel is a cell, the cells are the screen, nothing is cut off or too small to read`, async ({ page }) => {
    test.setTimeout(90000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openAt(page, width, height, RACE());

    // The grid, and the HUD's own wrappers out of the way.
    expect(await page.evaluate(() => getComputedStyle(document.body).display)).toBe('grid');
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('dashboard')).display)).toBe('contents');
    expect(await page.evaluate(() => document.documentElement.classList.contains('rd-remote'))).toBe(true);

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
      ] : []),
      ['practice', () => PRACTICE()],
    ];
    for (const [name, next] of cases) {
      if (next) await serve(page, next());
      const m = await measure(page);
      const label = `${describeSize(size)}, ${name}`;
      expect(m.outside, `${label}: cells outside the screen`).toEqual([]);
      expect(Object.keys(m.cells).sort(), `${label}: every panel is drawn`).toEqual(Object.keys(CELLS).sort());
      expect(m.overlapping, `${label}: cells on top of one another`).toEqual([]);
      // The cells are the screen: what is not a cell is the edge round the grid and the gutters between the cells.
      expect(m.covered, `${label}: the cells cover the screen (${JSON.stringify(m.cells)})`).toBeGreaterThanOrEqual(0.86);
      expect(m.overflowing, `${label}: content cut off by its cell`).toEqual([]);
      expect(m.small, `${label}: type too small to glance at`).toEqual([]);
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
    // The outline is as large as its cell lets it be: on one axis or the other it reaches almost to the edges.
    expect(Math.max(m.fillsW, m.fillsH)).toBeGreaterThan(0.85);
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
    // 9.1 laps of fuel and 8 to go: enough, with a lap to spare.
    expect(m.fuel).toEqual(['Fuel to the flag', '9.1 laps · 8 to go', 'laps-v green']);
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

  test('the menu is laid over the Racing Desk mark, the only touch target, and its list opens on screen from it', async ({ page }) => {
    const fab = await page.locator('#rd-remote-menu-fab').boundingBox();
    const brand = await page.locator('#brandLogoSquare').boundingBox();
    expect(fab.width).toBeGreaterThanOrEqual(44);
    expect(fab.height).toBeGreaterThanOrEqual(44);
    expect(Math.abs(fab.x - brand.x) + Math.abs(fab.y - brand.y) + Math.abs(fab.width - brand.width) + Math.abs(fab.height - brand.height)).toBeLessThan(2);
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
    expect(yellow.opacity).toBe('1');
    expect(yellow.pattern).toContain('rgb(253, 205, 13)');          // hsl(48, 98%, 52%), the flag's yellow
    expect(yellow.tint).toContain('rgba(245, 205, 40, 0.34)');      // the glass takes the flag's colour
    expect(yellow.panel).toBe('rgba(15, 15, 15, 0.96)');            // over a panel the numbers stay legible on

    // A blue flag is a car to let by: the edge and the gutters, not the panels.
    await serve(page, RACE({ flag: 'blue' }));
    await page.waitForTimeout(500);
    const blue = await look();
    expect(blue.flag).toBe('blue');
    expect(blue.opacity).toBe('1');
    expect(blue.pattern).toContain('rgb(29, 98, 237)');             // hsl(220, 85%, 52%)
    expect(blue.panel).toBe(none.panel);

    // Cleared: gone once the flag's hold is over (four seconds for a blue, as the gaps block holds it).
    await serve(page, RACE({ flag: 'none' }));
    await expect.poll(() => page.evaluate(() => document.body.dataset.flag), { timeout: 8000 }).toBe('none');
    await page.waitForTimeout(500);
    expect((await look()).opacity).toBe('0');
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
