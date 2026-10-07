/**
 * The other cars on the HUD's two maps (webgl-helpers.js, updateTrackMap): which of them pulse, how, and what is written
 * of them each frame. Every car within about 20 map units of him pulsed, with a drop-shadow at the pulse's peak — at a
 * start, the whole field on both maps, a filter redrawn every frame on the sim's own screen and GPU — and every car's
 * place, its being shown and its two classes were written on both maps on every frame. Now the three nearest pulse, in
 * opacity alone, and a dot is written only where it changed.
 *
 * The rig's HUD (dashboard.html as the app loads it) in headless software rendering, fed made-up frames through a route:
 * nothing listens on any port.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { frame, fieldWith, at, ME } from '../frames.mjs';

// A page in software rendering, a few hundred frames a test: more than the unit project's fifteen seconds under load.
test.describe.configure({ timeout: 60000 });

const OVERLAY = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DASHBOARD = pathToFileURL(path.join(OVERLAY, 'dashboard.html')).href;
const ON_TRACK = { 'DataCorePlugin.GameRawData.Telemetry.IsOnTrack': 1 };

const OTHERS = [];
for (let i = 1; i < 63; i++) OTHERS.push('Z. Racer' + String(i).padStart(2, '0'));
const ORDER = fieldWith(22, OTHERS);
const ME_PCT = 0.3;

// A start: the field of 63 bunched round him, a car every 0.4 % of the lap. `pit` cars are in the pits; `nudge` moves
// one car's x by a little.
function bunched({ pit = [], nudge = null } = {}) {
  const p = frame({ order: ORDER, playerPct: ME_PCT, extra: ON_TRACK });
  const others = ORDER.filter((n) => n !== ME);
  p['RacingDesk.Plugin.TrackMap.Opponents'] = others.map((_, i) => {
    const o = at(ME_PCT + (i - others.length / 2) * 0.004);
    const x = o.x + (nudge && nudge.car === i ? nudge.by : 0);
    return `${x.toFixed(2)},${o.y.toFixed(2)},${pit.includes(i) ? 1 : 0}`;
  }).join(';');
  return p;
}

async function open(page, feed) {
  await page.route(/^https?:\/\/(?!localhost:8889\/)/, (route) => route.abort());
  await page.route(/^https?:\/\/localhost:8889\//, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(feed.payload) }));
  await page.goto(DASHBOARD, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof _pollFrame !== 'undefined' && _pollFrame > 10
    && document.querySelectorAll('#fullMapOpponents .map-opponent').length === 62
    && document.querySelectorAll('#zoomMapOpponents .map-opponent').length === 62, null, { timeout: 20000 });
}

// His dot settled where the frame puts him (it eases there, 0.45 of the way a frame): thirty frames more.
const settled = (page) => page.evaluate(() => _pollFrame).then((from) => page.waitForFunction((f) => _pollFrame > f + 30, from, { timeout: 20000 }));

// Each map's dots: how far each is from him (squared, from his dot), whether it pulses and whether it is shown.
const dotsOf = (page) => page.evaluate(() => {
  const player = document.getElementById('zoomMapPlayer');
  const px = +player.getAttribute('cx'), py = +player.getAttribute('cy');
  const out = {};
  for (const id of ['fullMapOpponents', 'zoomMapOpponents']) {
    out[id] = [...document.getElementById(id).children].map((el) => ({
      d2: (+el.getAttribute('cx') - px) ** 2 + (+el.getAttribute('cy') - py) ** 2,
      near: el.classList.contains('map-opponent-near'),
      shown: el.style.display !== 'none',
    }));
  }
  return out;
});

test('at a start three cars pulse on each map, the three nearest him on track, and no more', async ({ page }) => {
  const feed = { payload: bunched() };
  await open(page, feed);
  await settled(page);
  const maps = await dotsOf(page);
  for (const [id, dots] of Object.entries(maps)) {
    const within = dots.filter((d) => d.shown && d.d2 < 400);
    expect(within.length, `${id}: cars within the pulse's reach`).toBeGreaterThan(10);
    const pulsing = dots.filter((d) => d.near);
    expect(pulsing, id).toHaveLength(3);
    const farthestPulsing = Math.max(...pulsing.map((d) => d.d2));
    const nearestNot = Math.min(...dots.filter((d) => d.shown && !d.near).map((d) => d.d2));
    expect(farthestPulsing, id).toBeLessThanOrEqual(nearestNot + 0.01);
  }
  // The same three on both.
  expect(maps.fullMapOpponents.map((d) => d.near)).toEqual(maps.zoomMapOpponents.map((d) => d.near));

  // A car in the pits is not shown, and does not pulse: the next nearest does.
  const nearest = maps.fullMapOpponents.reduce((best, d, i, all) => (d.d2 < all[best].d2 ? i : best), 0);
  feed.payload = bunched({ pit: [nearest] });
  await page.waitForFunction((i) => document.getElementById('fullMapOpponents').children[i].style.display === 'none', nearest);
  await settled(page);
  const after = await dotsOf(page);
  expect(after.fullMapOpponents[nearest]).toMatchObject({ shown: false, near: false });
  expect(after.fullMapOpponents.filter((d) => d.near)).toHaveLength(3);
});

test('a lone car near him pulses as it always did; none near, none pulses', async ({ page }) => {
  const p = frame({ order: ORDER, playerPct: ME_PCT, extra: ON_TRACK });
  const others = ORDER.filter((n) => n !== ME);
  // One car just behind him, the rest spread round the lap.
  p['RacingDesk.Plugin.TrackMap.Opponents'] = others.map((_, i) => {
    const o = at(i === 0 ? ME_PCT - 0.01 : ME_PCT + 0.3 + i * 0.006);
    return `${o.x.toFixed(2)},${o.y.toFixed(2)},0`;
  }).join(';');
  const feed = { payload: p };
  await open(page, feed);
  await settled(page);
  const maps = await dotsOf(page);
  for (const dots of Object.values(maps)) {
    const within = dots.filter((d) => d.shown && d.d2 < 400).length;
    expect(dots.filter((d) => d.near)).toHaveLength(Math.min(3, within));
    expect(dots[0].near).toBe(true);
  }
});

test('the pulse is in opacity alone: no filter on a car that pulses, at any point of it', async ({ page }) => {
  await open(page, { payload: bunched() });
  // The keyframes as written (a page from file:// may not read its own stylesheets' rules).
  const css = fs.readFileSync(path.join(OVERLAY, 'modules', 'styles', 'dashboard.css'), 'utf8');
  const rules = [];
  for (let at = css.indexOf('@keyframes map-opponent-pulse'); at >= 0; at = css.indexOf('@keyframes map-opponent-pulse', at + 1)) {
    let depth = 0, end = at;
    for (let i = css.indexOf('{', at); i < css.length; i++) {
      if (css[i] === '{') depth++;
      if (css[i] === '}' && --depth === 0) { end = i + 1; break; }
    }
    rules.push(css.slice(at, end));
  }
  const seen = await page.evaluate(() => {
    const dot = document.querySelector('#fullMapOpponents .map-opponent-near');
    const frames = dot ? dot.getAnimations().flatMap((a) => a.effect.getKeyframes()) : [];
    return { filter: dot ? getComputedStyle(dot).filter : null, props: [...new Set(frames.flatMap((f) => Object.keys(f)))] };
  });
  expect(rules.length).toBeGreaterThan(0);
  for (const rule of rules) {
    expect(rule).toMatch(/opacity/);
    expect(rule).not.toMatch(/filter|shadow/);
  }
  expect(seen.filter).toBe('none');
  expect(seen.props).toContain('opacity');
  expect(seen.props.filter((p) => !['opacity', 'offset', 'easing', 'composite', 'computedOffset'].includes(p))).toEqual([]);
});

test('a dot is written only when what it shows changes: the same frame again writes nothing, one car moved writes its place', async ({ page }) => {
  const feed = { payload: bunched() };
  await open(page, feed);
  await settled(page);
  const watch = () => page.evaluate(() => {
    window.__writes = [];
    window.__from = _pollFrame;
    const mo = new MutationObserver((list) => {
      for (const m of list) window.__writes.push(`${m.target.parentNode ? m.target.parentNode.id : '?'} ${m.type} ${m.attributeName || ''}`);
    });
    for (const id of ['fullMapOpponents', 'zoomMapOpponents']) mo.observe(document.getElementById(id), { attributes: true, childList: true, subtree: true });
    window.__mo = mo;
  });
  const writes = async () => {
    await page.waitForFunction(() => _pollFrame > window.__from + 15, null, { timeout: 10000 });
    return page.evaluate(() => { window.__mo.disconnect(); return window.__writes; });
  };
  await watch();
  expect(await writes()).toEqual([]);

  // The car farthest behind, a little to one side: its x, on each map, and nothing else of anyone's.
  feed.payload = bunched({ nudge: { car: 0, by: 0.5 } });
  await watch();
  const moved = await writes();
  expect([...new Set(moved)].sort()).toEqual(['fullMapOpponents attributes cx', 'zoomMapOpponents attributes cx']);
  expect(moved.length).toBe(2);
});
