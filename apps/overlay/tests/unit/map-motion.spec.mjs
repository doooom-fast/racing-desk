/**
 * The two maps between the data frames (modules/js/map-motion.js; webgl-helpers.js animateTrackMap draws them). He said
 * on 2026-10-07: "In the OBS version, and the iPad version, the animations don't seem as smooth as they used to be." The
 * page draws only when a frame of telemetry arrives, about thirty a second, and the iPad's following map was brought
 * 30 % closer that day, so each frame moved the car further on the screen and the map visibly stepped. Offered the
 * maps animated at the display's rate between the frames, he said yes. So in the glance layout (the iPad, /obs-ipad,
 * Ctrl+Shift+F) the car's dot and glow, the following map's view (its centre, its turn, its size), the other cars' dots
 * and the trail behind the car are drawn between the last two frames, one data interval behind, so that the picture is
 * always between two places the page knows. The rig's HUD is not in it.
 *
 * Held here: the arithmetic in Node (a position round the loop the short way — 0.99 to 0.01 of the lap is a short step
 * forward over the line and not a lap back —, a heading the shortest way, the clock that says how far through the step
 * the page is, what is a jump); and the iPad's page, in a headless browser over a stand-in telemetry that answers every
 * 150 ms (so there are several animation frames to a data frame, which a real 30-a-second feed gives two of): the dot, the
 * view and the other cars move between the data frames and land on the frame's place; the trail's head goes over the
 * start/finish line the short way; a tow is a jump and not a slide, for his dot and the others'; a heading from 0 to 330 turns
 * the 30 degrees and not the 330; a frame between two data frames reads nothing from the page and writes only what changes;
 * and the rig's HUD is drawn on its data frames alone, as it was.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { frame, fieldWith, at, SVG_PATH } from '../frames.mjs';

const require = createRequire(import.meta.url);
const mm = require('../../modules/js/map-motion.js');
const remote = require('../../remote-server.js');

const OVERLAY = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DASHBOARD = pathToFileURL(path.join(OVERLAY, 'dashboard.html')).href;

// ── The arithmetic ────────────────────────────────────────────────────────────────────────────────────────────────────

test.describe('positions round the loop and headings', () => {
  test('0.99 of the lap to 0.01 is a short step forward over the line, not a lap back', () => {
    // On an outline of 240 points: from 239.6 to 0.4 is 0.8 of a point forward.
    const n = 240;
    const forward = [];
    for (let i = 0; i <= 10; i++) forward.push(mm.lerpAround(239.6, 0.4, i / 10, n));
    // Every sample is within a point of the line (the other way round, half-way is 120, on the far side of the circuit).
    for (const p of forward) expect(Math.min(p, n - p), forward.join(', ')).toBeLessThan(1);
    expect(mm.lerpAround(239.6, 0.4, 0.5, n) % n).toBeCloseTo(0, 6);
    // Each sample is a step on from the one before, by a tenth of 0.8.
    for (let i = 1; i < forward.length; i++) {
      const step = ((forward[i] - forward[i - 1] + n * 1.5) % n) - n / 2;
      expect(step).toBeCloseTo(0.08, 6);
    }
    // As a fraction of the lap: 0.99 to 0.01 of 1000 points.
    expect(mm.lerpAround(990, 10, 0.5, 1000)).toBeCloseTo(0, 6);
    expect(mm.lerpAround(990, 10, 0.25, 1000)).toBeCloseTo(995, 6);
    expect(mm.lerpAround(990, 10, 0.75, 1000)).toBeCloseTo(5, 6);
    // And back the short way too, when a car reverses over the line.
    expect(mm.lerpAround(0.4, 239.6, 0.5, n) % n).toBeCloseTo(0, 6);
  });

  test('away from the line it is the plain line between the two, and always inside the loop', () => {
    expect(mm.lerpAround(10, 20, 0.5, 240)).toBe(15);
    expect(mm.lerpAround(100, 100, 0.7, 240)).toBe(100);
    for (const [a, b] of [[0, 239.9], [239.9, 0], [3, 230], [230, 3], [119, 121]]) {
      for (let i = 0; i <= 10; i++) {
        const r = mm.lerpAround(a, b, i / 10, 240);
        expect(r, `${a} to ${b} at ${i}/10`).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThan(240);
      }
    }
    expect(mm.stepAround(239.6, 0.4, 240)).toBeCloseTo(0.8, 6);
    expect(mm.stepAround(0.4, 239.6, 240)).toBeCloseTo(-0.8, 6);
    expect(mm.stepAround(10, 20, 240)).toBe(10);
  });

  test('a heading turns the shortest way round: 350 to 10 is 20 degrees, 10 to 350 is 20 the other way', () => {
    expect(mm.lerpAngle(350, 10, 0.5)).toBeCloseTo(0, 6);
    expect(mm.lerpAngle(10, 350, 0.5)).toBeCloseTo(0, 6);
    expect(mm.lerpAngle(359, 1, 0.25)).toBeCloseTo(359.5, 6);
    expect(mm.lerpAngle(0, 355.5, 0.5)).toBeCloseTo(357.75, 6);
    expect(mm.lerpAngle(90, 100, 0.5)).toBe(95);
    expect(mm.lerpAngle(200, 200, 0.3)).toBe(200);
    for (let i = 0; i <= 20; i++) {
      const h = mm.lerpAngle(350, 10, i / 20);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
      expect(Math.min(h, 360 - h), `${h}`).toBeLessThanOrEqual(10.0001);
    }
  });

  test('a jump is a step longer than a car drives in a data interval, and nothing less', () => {
    expect(mm.jumped(10, 10, 10, 10, 5)).toBe(false);
    expect(mm.jumped(10, 10, 13, 14, 5)).toBe(false);    // exactly 5 is not more
    expect(mm.jumped(10, 10, 13, 14.1, 5)).toBe(true);
    expect(mm.JUMP_LAP_FRACTION).toBe(0.02);
    expect(mm.loopLength([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])).toBe(40);
    expect(mm.loopLength([])).toBe(0);
  });
});

test.describe('the clock: how far through the step the page is', () => {
  test('before any frame it is at the end; a frame starts a step that runs one data interval and is held at its end', () => {
    const clock = mm.createClock();
    expect(clock.phase(1000)).toBe(1);
    expect(clock.frame(1000)).toBe(false);   // the first frame has nothing to step from
    expect(clock.phase(1000)).toBe(0);
    expect(clock.interval()).toBe(mm.FIRST_INTERVAL_MS);
    // Steady frames 33.3 ms apart: the step is that long.
    let t = 1000;
    for (let i = 0; i < 40; i++) { t += 100 / 3; expect(clock.frame(t)).toBe(true); }
    expect(clock.interval()).toBeCloseTo(100 / 3, 1);
    expect(clock.phase(t)).toBe(0);
    expect(clock.phase(t + 100 / 6)).toBeCloseTo(0.5, 1);
    expect(clock.phase(t + 100 / 3)).toBe(1);
    // A late frame leaves the picture at the newest place until it comes; nothing is drawn ahead of the data.
    expect(clock.phase(t + 90)).toBe(1);
  });

  test('the step follows the frames\' own spacing, held between a twelfth and a tenth of a second', () => {
    const clock = mm.createClock();
    let t = 0;
    clock.frame(t);
    for (let i = 0; i < 80; i++) { t += 50; clock.frame(t); }
    expect(clock.interval()).toBeCloseTo(50, 0);
    for (let i = 0; i < 80; i++) { t += 4; clock.frame(t); }
    expect(clock.interval()).toBeCloseTo(mm.MIN_INTERVAL_MS, 0);
    for (let i = 0; i < 80; i++) { t += 200; clock.frame(t); }
    expect(clock.interval()).toBeCloseTo(mm.MAX_INTERVAL_MS, 0);
  });

  test('a frame after a stall is not stepped to, and does not change the step\'s length', () => {
    const clock = mm.createClock();
    let t = 0;
    clock.frame(t);
    for (let i = 0; i < 20; i++) { t += 33; clock.frame(t); }
    const was = clock.interval();
    t += mm.STALL_MS + 1;
    expect(clock.frame(t)).toBe(false);
    expect(clock.interval()).toBe(was);
    t += 33;
    expect(clock.frame(t)).toBe(true);
    clock.reset();
    expect(clock.phase(t + 5)).toBe(1);
    expect(clock.frame(t + 10)).toBe(false);
  });
});

// ── The pages ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const RACE = (over = {}) => frame({ order: fieldWith(4), state: 4, mode: 4, start: 7, lap: 12, ...over });
const POINTS = SVG_PATH.replace(/^M\s*/, '').replace(/\s*Z$/, '').split(/\s*L\s*/).map((p) => p.split(',').map(Number));
const LAP = POINTS.reduce((sum, p, i) => sum + Math.hypot(POINTS[(i + 1) % POINTS.length][0] - p[0], POINTS[(i + 1) % POINTS.length][1] - p[1]), 0);

// The stand-in telemetry: each request is answered by `feed.next()` after `feed.delay` ms. The iPad's server is the real
// one (remote-server.js) over it, on 127.0.0.1, with no sharing of a frame between two asks (`shareMs: 0`: with it, a slow
// feed gives the page the same frame twice, 17 ms apart).
const feed = { delay: 0, next: () => RACE() };
let telemetry, ipad, port;

test.beforeAll(async () => {
  telemetry = http.createServer((req, res) => {
    const body = JSON.stringify(feed.next());
    setTimeout(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(body); }, feed.delay);
  });
  await new Promise((resolve) => telemetry.listen(0, '127.0.0.1', resolve));
  const config = {
    appDir: OVERLAY, telemetryBase: `http://127.0.0.1:${telemetry.address().port}`, key: remote.newKey(), dispatchAction: null,
    addresses: () => [], names: () => [], displaySettings: () => ({ followMapZoom: 'closer' }), shareMs: 0,
  };
  ipad = http.createServer((req, res) => remote.handleRequest(config, req, res));
  await new Promise((resolve) => ipad.listen(0, '127.0.0.1', resolve));
  port = ipad.address().port;
});
test.afterAll(async () => {
  await new Promise((resolve) => { ipad.close(resolve); ipad.closeAllConnections(); });
  await new Promise((resolve) => { telemetry.close(resolve); telemetry.closeAllConnections(); });
});
test.beforeEach(() => { feed.delay = 0; feed.next = () => RACE({ playerPct: 0.3 }); });

async function frames(page, n = 6) {
  await page.waitForFunction(() => typeof _isIdle !== 'undefined' && _isIdle === false && _pollFrame > 5, null, { timeout: 15000 });
  const before = await page.evaluate(() => _pollFrame);
  await page.waitForFunction((at) => _pollFrame >= at, before + n, { timeout: 20000 });
}

// A headless browser draws in software (this machine's rule), and the glance layout's glass and shadows take it 150 ms or
// more a frame: it then draws no more often than the data comes, and there is nothing between the frames to see. The
// glass is left off here, so that the page's animation frames come at the display's rate as they do on an iPad.
const cheap = (page) => page.addStyleTag({ content: '*, *::before, *::after { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; filter: none !important; box-shadow: none !important; text-shadow: none !important; }' });

async function openIpad(page) {
  await page.addInitScript(() => { try { localStorage.setItem('rd-effects', 'off'); } catch (e) { /* none */ } });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.goto(`http://127.0.0.1:${port}/`);
  await cheap(page);
  await frames(page, 25);   // quick frames: the car and the view settle where they are
  await page.waitForFunction(() => document.getElementById('zoomMapSvg').style.getPropertyValue('--px') !== ''
    && document.querySelectorAll('#fullMapOpponents .map-opponent').length > 0, null, { timeout: 10000 });
}

// What the maps show at every animation frame for `ms`, and which data frame the page was at. The first of the other cars
// is the one tracked on the full map, and the third (the one just ahead of him, 0.035 of the lap, a little over eight units)
// on the following map, whose view is eight units across: the others are not in it. (The rotation group's angle is the view's turn, negated.)
const sample = (page, ms) => page.evaluate(async (ms) => {
  const out = [];
  const t0 = performance.now();
  const full = document.getElementById('fullMapPlayer'), zoom = document.getElementById('zoomMapPlayer');
  const svg = document.getElementById('zoomMapSvg'), rot = document.getElementById('zoomMapRotateGroup');
  const trail = document.getElementById('zoomMapTrail');
  const num = (el, a) => +el.getAttribute(a);
  while (performance.now() - t0 < ms) {
    await new Promise((r) => requestAnimationFrame(r));
    const vb = svg.getAttribute('viewBox').split(/\s+/).map(Number);
    const m = /rotate\(([-\d.]+)/.exec(rot.getAttribute('transform') || '');
    const pts = trail ? (trail.getAttribute('points') || '').trim().split(/\s+/).filter(Boolean) : [];
    const head = pts.length ? pts[pts.length - 1].split(',').map(Number) : null;
    const oF = document.querySelector('#fullMapOpponents .map-opponent'), oZ = document.querySelector('#zoomMapOpponents .map-opponent:nth-child(3)');   // the car just ahead of him: in the following map's view
    out.push({
      t: performance.now() - t0, frame: _pollFrame, phase: _motion.phase,
      full: [num(full, 'cx'), num(full, 'cy')], zoom: [num(zoom, 'cx'), num(zoom, 'cy')], vb,
      rot: m ? +m[1] : null, head, trailN: pts.length,
      oFull: oF ? [num(oF, 'cx'), num(oF, 'cy')] : null, oZoom: oZ ? [num(oZ, 'cx'), num(oZ, 'cy')] : null,
    });
  }
  return out;
}, ms);

const differ = (a, b) => a.some((v, i) => Math.abs(v - b[i]) > 1e-9);
// The index of the nearest point of the test circuit: where round the lap.
const alongOf = ([x, y]) => POINTS.reduce((best, p, i) => { const d = Math.hypot(p[0] - x, p[1] - y); return d < best.d ? { d, i } : best; }, { d: Infinity, i: 0 }).i;

test('the iPad: the car, the view and the other cars move between the data frames, forward all the way, and land on the frame', async ({ page }) => {
  test.setTimeout(120000);
  await openIpad(page);
  // A car driving at a tenth of a lap a second (about 0.8 % of the lap a frame at this feed's 150 ms: under a car's
  // limit, so it is a drive and not a jump), every frame a step on from the one before.
  let k = 0;
  feed.delay = 150;
  feed.next = () => RACE({ playerPct: 0.3 + 0.008 * k++ });
  await frames(page, 3);
  const s = await sample(page, 2600);
  const same = s.filter((x, i) => i > 0 && x.frame === s[i - 1].frame);
  // Between the data frames the dot, the view and the other car moved: on most of the animation frames that had no new data.
  const moved = (pick) => same.filter((x) => differ(pick(x), pick(s[s.indexOf(x) - 1]))).length;
  expect(same.length, 'animation frames without a new data frame').toBeGreaterThan(30);
  expect(moved((x) => x.full), 'the full map\'s dot').toBeGreaterThan(same.length * 0.35);
  expect(moved((x) => x.zoom), 'the following map\'s dot').toBeGreaterThan(same.length * 0.35);
  expect(moved((x) => x.vb.slice(0, 2)), 'the following map\'s view').toBeGreaterThan(same.length * 0.35);
  expect(moved((x) => x.oFull), 'the other car on the full map').toBeGreaterThan(same.length * 0.35);
  expect(moved((x) => x.oZoom), 'the other car on the following map').toBeGreaterThan(same.length * 0.35);
  // The dot is at several places for one data frame, not one.
  const perFrame = new Map();
  for (const x of s) { const set = perFrame.get(x.frame) || new Set(); set.add(x.full.join(',')); perFrame.set(x.frame, set); }
  const counts = [...perFrame.values()].map((set) => set.size);
  expect(counts.reduce((a, b) => a + b, 0) / counts.length, `places per data frame: ${counts.join(' ')}`).toBeGreaterThan(2.5);
  // And forward all the way round the circuit: never back by more than the point it is nearest to jittering by one.
  let along = alongOf(s[0].full), travelled = 0, worstBack = 0;
  for (const x of s) {
    const i = alongOf(x.full);
    const step = ((i - along + 360) % 240) - 120;
    travelled += step;
    worstBack = Math.min(worstBack, step);
    along = i;
  }
  expect(travelled, 'points travelled').toBeGreaterThan(15);
  expect(worstBack, 'the worst step back, in points').toBeGreaterThanOrEqual(-1);
  // The view is centred on the dot, to a thousandth of a unit, at every animation frame (two-thirds down in this layout).
  for (const x of s) {
    expect(Math.abs(x.zoom[0] - (x.vb[0] + x.vb[2] / 2)), JSON.stringify(x)).toBeLessThan(0.0015);
    expect(Math.abs(x.zoom[1] - (x.vb[1] + (x.vb[3] * 2) / 3)), JSON.stringify(x)).toBeLessThan(0.0015);
    expect(x.zoom, 'both maps\' dots are the same place').toEqual(x.full);
  }
  // The car stops: after the frames it takes the low-pass to settle the picture is at the frame, exactly: the dot where the
  // payload puts the car and the other car where the payload puts it.
  const stop = 0.3 + 0.008 * k;
  feed.next = () => RACE({ playerPct: stop });
  await frames(page, 14);
  await page.waitForFunction(() => _motion.phase === 1, null, { timeout: 5000 });
  const end = await sample(page, 400);
  // (the payload carries the car to a hundredth and the others to a tenth of a unit)
  const want = at(stop), wantOther = at(stop + 0.105);
  for (const x of end) {
    expect(x.zoom[0]).toBeCloseTo(want.x, 1);
    expect(x.zoom[1]).toBeCloseTo(want.y, 1);
    expect(x.oFull[0]).toBeCloseTo(+wantOther.x.toFixed(1), 2);
    expect(x.oFull[1]).toBeCloseTo(+wantOther.y.toFixed(1), 2);
  }
  const landed = await page.evaluate(() => ({
    cur: [_motion.cur.x, _motion.cur.y], to: [_motion.to.x, _motion.to.y], smoothed: [_mapSmoothedX, _mapSmoothedY],
    dot: [+document.getElementById('zoomMapPlayer').getAttribute('cx'), +document.getElementById('zoomMapPlayer').getAttribute('cy')],
    other: [_oppCurX[0], _oppCurY[0], _oppX[0], _oppY[0]],
  }));
  // (a car that has stopped is still being eased to its place by the page's low-pass, by less than a millionth a frame)
  expect(landed.cur[0]).toBeCloseTo(landed.to[0], 3);
  expect(landed.cur[1]).toBeCloseTo(landed.to[1], 3);
  expect(landed.to).toEqual(landed.smoothed);
  expect(landed.dot[0]).toBeCloseTo(landed.to[0], 3);
  expect(landed.dot[1]).toBeCloseTo(landed.to[1], 3);
  expect(landed.other[0]).toBeCloseTo(landed.other[2], 3);
  expect(landed.other[1]).toBeCloseTo(landed.other[3], 3);
});

test('the iPad: over the start/finish line the car, the trail\'s head and the view go the short way, never round the lap', async ({ page }) => {
  test.setTimeout(120000);
  feed.next = () => RACE({ playerPct: 0.955 });
  await openIpad(page);
  // 0.015 of the lap a frame, across the line between the third frame and the fourth: 0.985 then 0.0, then on.
  const seq = [0.97, 0.985, 0.0, 0.015, 0.03, 0.045, 0.06, 0.06, 0.06, 0.06];
  let k = 0;
  feed.delay = 150;
  feed.next = () => RACE({ playerPct: seq[Math.min(k++, seq.length - 1)] });
  const s = await sample(page, 2200);
  const line = POINTS[0];
  const far = (p) => Math.hypot(p[0] - line[0], p[1] - line[1]);
  // Never more than a little way from the line: the whole drive is 0.045 of the lap before it to 0.06 after (about 25 units
  // of the 230 round); a lap the wrong way would be most of the circuit away.
  const reach = 0.075 * LAP;
  let withTrail = 0, before = false, after = false;
  for (const x of s) {
    expect(far(x.full), `the dot at ${x.t.toFixed(0)} ms`).toBeLessThan(reach);
    if (x.head) {
      withTrail++;
      expect(far(x.head), `the trail's head at ${x.t.toFixed(0)} ms`).toBeLessThan(reach);
      expect(x.trailN, 'the trail is a quarter of the lap at most').toBeLessThanOrEqual(62);
    }
    // (the circuit runs down the screen at the line)
    if (x.full[1] < line[1] - 1) before = true;
    if (x.full[1] > line[1] + 1) after = true;
  }
  expect(withTrail, 'frames with a trail behind the car').toBeGreaterThan(10);
  expect([before, after], 'the car went over the line in the sample').toEqual([true, true]);
  // Several places for the one data frame over the line itself.
  const around = s.filter((x) => far(x.full) < 3);
  expect(new Set(around.map((x) => x.full.join(','))).size, 'places within 3 units of the line').toBeGreaterThan(3);
});

test('the iPad: a tow is a jump, not a slide: his dot and the other cars\' are where they were and then where they are, never between', async ({ page }) => {
  test.setTimeout(120000);
  feed.next = () => RACE({ playerPct: 0.2 });
  await openIpad(page);
  feed.delay = 150;
  await frames(page, 3);
  feed.next = () => RACE({ playerPct: 0.7 });
  const s = await sample(page, 1500);
  const here = at(0.2), there = at(0.7), otherHere = at(0.305), otherThere = at(0.805);
  const near = (p, q) => Math.hypot(p[0] - q.x, p[1] - q.y) < 0.6;
  let seenThere = 0;
  for (const x of s) {
    const label = `at ${x.t.toFixed(0)} ms`;
    expect(near(x.full, here) || near(x.full, there), `his dot ${label}: ${x.full}`).toBe(true);
    expect(near(x.oFull, otherHere) || near(x.oFull, otherThere), `the other car ${label}: ${x.oFull}`).toBe(true);
    if (near(x.full, there)) seenThere++;
  }
  expect(seenThere, 'samples after the tow').toBeGreaterThan(5);
});

test('the iPad: the view turns the shortest way: a heading from 0 to 330 is 30 degrees one way, not 330 the other', async ({ page }) => {
  test.setTimeout(120000);
  const heading = (deg) => () => ({ ...RACE({ playerPct: 0.3 }), 'RacingDesk.Plugin.TrackMap.PlayerHeading': deg });
  feed.next = heading(0);
  await openIpad(page);
  await frames(page, 30);   // the page eases the view's turn to the heading, 15 % a frame: 0 degrees
  feed.delay = 150;
  feed.next = heading(330);
  const s = await sample(page, 1600);
  let turned = 0;
  for (const x of s) {
    // The group is turned by minus the heading; as a signed angle.
    const a = ((x.rot + 540) % 360) - 180;
    expect(Math.abs(a), `the view's turn at ${x.t.toFixed(0)} ms: ${x.rot}`).toBeLessThan(40);
    turned = Math.max(turned, Math.abs(a));
  }
  expect(turned, 'it did turn').toBeGreaterThan(2);
});

test('the iPad: a frame between two data frames reads nothing from the page and writes only what changes', async ({ page }) => {
  test.setTimeout(120000);
  let k = 0;
  feed.next = () => RACE({ playerPct: 0.3 + 0.004 * k++ });
  await openIpad(page);
  feed.delay = 150;
  await page.evaluate(() => {
    const seen = { reads: [], writes: [], redundant: [], calls: 0, worked: 0 };
    window.__between = seen;
    let inside = 0;
    const count = (name) => { if (inside) seen.reads.push(name); };
    const wrapRead = (obj, name) => {
      const orig = obj[name];
      obj[name] = function () { count(name); return orig.apply(this, arguments); };
    };
    wrapRead(window, 'getComputedStyle');
    for (const n of ['getBoundingClientRect', 'getClientRects']) wrapRead(Element.prototype, n);
    for (const n of ['getBBox', 'getScreenCTM', 'getCTM']) wrapRead(SVGGraphicsElement.prototype, n);
    const setAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      if (inside) {
        seen.writes.push(name);
        if (this.getAttribute(name) === String(value)) seen.redundant.push(name + '=' + value);
      }
      return setAttribute.call(this, name, value);
    };
    for (const n of ['add', 'remove', 'toggle']) {
      const orig = DOMTokenList.prototype[n];
      DOMTokenList.prototype[n] = function () { if (inside) seen.writes.push('class'); return orig.apply(this, arguments); };
    }
    const setProperty = CSSStyleDeclaration.prototype.setProperty;
    CSSStyleDeclaration.prototype.setProperty = function () { if (inside) seen.writes.push('style'); return setProperty.apply(this, arguments); };
    const animate = window.animateTrackMap;
    window.animateTrackMap = function () {
      const was = _motion.phase;
      inside++;
      seen.calls++;
      try { return animate.apply(this, arguments); } finally { inside--; if (_motion.phase !== was) seen.worked++; }
    };
  });
  await frames(page, 3);
  await sample(page, 2000);
  const seen = await page.evaluate(() => window.__between);
  expect(seen.calls, 'animation frames with no new data').toBeGreaterThan(30);
  expect(seen.worked, 'of them that drew').toBeGreaterThan(20);
  expect(seen.reads, 'reads of layout or style between the data frames').toEqual([]);
  expect(seen.redundant, 'writes of what was there').toEqual([]);
  const allowed = new Set(['cx', 'cy', 'viewBox', 'transform', 'points', 'x1', 'y1', 'x2', 'y2', 'stroke-width']);
  expect([...new Set(seen.writes)].filter((n) => !allowed.has(n)), 'attributes written between the data frames').toEqual([]);
  // A good deal is written (the dot, the glow, the view, the turn, the trail, the dots) and only on the frames that drew.
  expect(seen.writes.length).toBeGreaterThan(seen.worked * 6);
  expect(seen.writes.length).toBeLessThan(seen.worked * 120);
});

test('the rig\'s HUD is drawn on its data frames alone, as it was', async ({ page }) => {
  test.setTimeout(120000);
  let k = 0;
  const next = () => RACE({ playerPct: 0.3 + 0.008 * k++ });
  await page.route(/^https?:\/\/(?!localhost:8889)/, (route) => route.abort());
  await page.route('http://localhost:8889/racing-desk/', async (route) => {
    const body = JSON.stringify(next());
    await new Promise((r) => setTimeout(r, 150));
    await route.fulfill({ status: 200, contentType: 'application/json', body });
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(DASHBOARD);
  await page.evaluate(() => { _settings.showWebGL = false; });
  await cheap(page);
  await frames(page, 4);
  const s = await sample(page, 2200);
  const same = s.filter((x, i) => i > 0 && x.frame === s[i - 1].frame);
  expect(same.length, 'animation frames with no new data').toBeGreaterThan(30);
  for (const x of same) {
    const was = s[s.indexOf(x) - 1];
    expect(differ(x.full, was.full) || differ(x.zoom, was.zoom) || differ(x.vb, was.vb) || differ(x.oFull, was.oFull) || differ(x.oZoom, was.oZoom) || x.rot !== was.rot,
      `the rig's maps changed with no new frame at ${x.t.toFixed(0)} ms`).toBe(false);
  }
  const live = await page.evaluate(() => _motion.live);
  expect(live).toBe(false);
  // It moved, on the data frames.
  expect(new Set(s.map((x) => x.full.join(','))).size).toBeGreaterThan(5);
});
