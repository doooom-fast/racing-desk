/**
 * The outline the page draws (webgl-helpers.js, "The outline as the page draws it"), at the iPad's following map. He said
 * on 2026-10-02 "the iPad zoom map seems to be very squiggly". The plugin wrote the outline's numbers to a tenth of a map
 * unit, which on a circuit as big as Le Mans (13.5 km, 90 units across) is 6 m, more than the 5 m between its points:
 * at the iPad's following map, 30 px to a unit at its closest view, the line wandered by a pixel or two from one point
 * to the next and its curves met at kinks (the Béziers' control points were rounded too), and the page put the car and
 * its trail on the nearest of the path's numbers, control points and all. The host writes two decimals now
 * (TrackMapProvider, held in RacingDesk.Tests TrackMapProviderTests), and the page draws the spline through the path's
 * own points itself, smoothing them a little first where the path is rounded coarsely for how close its points are.
 *
 * A made-up circuit as long as Le Mans (nobody's: the shape of tests/frames.mjs, scaled), a point every 5 m, is sent as
 * the plugin sends it — a Catmull-Rom spline as cubic Béziers — at one decimal (a plugin from before the change) and at
 * two (the host now), to the real iPad page served through remote-server.js's own handler, at the closest view. Held:
 * the line drawn wiggles by under half a pixel from one point to the next (the one-decimal path's own points by two),
 * its curves meet without a kink, and it stays within a pixel and a half of the circuit (a fifth of one at two
 * decimals); the car's dot is on the line while it drives and its trail is on the line and ends at it; the rig's HUD
 * draws the same line from the same path; and a path the page cannot read is drawn as it was given and said to render
 * nothing.
 */

import { test, expect } from '@playwright/test';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { frame, fieldWith } from '../frames.mjs';

const require = createRequire(import.meta.url);
const remote = require('../../remote-server.js');
const mz = require('../../modules/js/map-zoom.js');
const OVERLAY = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ── The circuit: tests/frames.mjs's shape, 13.5 km round, a point every 5 m by its length, in the plugin's 0–100 space ──
const LENGTH_M = 13500;
const STEP_M = 5;
const shape = (t) => [36 * Math.cos(t) + 6 * Math.cos(3 * t), 26 * Math.sin(t) - 8 * Math.sin(2 * t)];
const TRUE = [];      // the circuit itself, finely, in map units
const POINTS = [];    // the outline's points, as the host has them
{
  const N = 60000;
  const dense = [];
  for (let i = 0; i <= N; i++) dense.push(shape((i / N) * Math.PI * 2));
  const cum = [0];
  for (let i = 1; i <= N; i++) cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  const total = cum[N];
  const count = Math.round(LENGTH_M / STEP_M);
  const raw = [];
  let j = 0;
  for (let k = 0; k < count; k++) {
    const want = (k / count) * total;
    while (cum[j + 1] < want) j++;
    const f = (want - cum[j]) / (cum[j + 1] - cum[j]);
    raw.push([dense[j][0] + (dense[j + 1][0] - dense[j][0]) * f, dense[j][1] + (dense[j + 1][1] - dense[j][1]) * f]);
  }
  // TrackMapProvider.NormaliseAndBuild: 90 units across the longer side, centred in 0–100.
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of raw) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const s = 90 / Math.max(x1 - x0, y1 - y0);
  const ox = (100 - (x1 - x0) * s) / 2, oy = (100 - (y1 - y0) * s) / 2;
  const norm = ([x, y]) => [(x - x0) * s + ox, (y - y0) * s + oy];
  for (const p of raw) POINTS.push(norm(p));
  for (const p of dense) TRUE.push(norm(p));
}

// TrackMapProvider.BuildSvgPath: Catmull-Rom to cubic Béziers, closed, every number to `dp` places.
function hostPath(dp) {
  const F = (v) => v.toFixed(dp);
  const n = POINTS.length;
  let d = `M ${F(POINTS[0][0])},${F(POINTS[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = POINTS[(i - 1 + n) % n], p1 = POINTS[i], p2 = POINTS[(i + 1) % n], p3 = POINTS[(i + 2) % n];
    d += ` C ${F(p1[0] + (p2[0] - p0[0]) / 6)},${F(p1[1] + (p2[1] - p0[1]) / 6)} ${F(p2[0] - (p3[0] - p1[0]) / 6)},${F(p2[1] - (p3[1] - p1[1]) / 6)} ${F(p2[0])},${F(p2[1])}`;
  }
  return `${d} Z`;
}

// A path's Béziers: [start, control, control, end] for each `C`.
function beziers(d) {
  const nums = (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  const out = [];
  let at = [nums[0], nums[1]];
  for (let i = 2; i + 5 < nums.length; i += 6) {
    const seg = [at, [nums[i], nums[i + 1]], [nums[i + 2], nums[i + 3]], [nums[i + 4], nums[i + 5]]];
    out.push(seg);
    at = seg[3];
  }
  return out;
}
// The points the line passes through: where each curve starts.
const onCurve = (d) => beziers(d).map((b) => b[0]);
// How far each point is from the middle of its two neighbours: a smooth line's is its curvature and no more.
function wiggles(pts) {
  const n = pts.length;
  return pts.map((b, i) => {
    const a = pts[(i - 1 + n) % n], c = pts[(i + 1) % n];
    return Math.hypot(b[0] - (a[0] + c[0]) / 2, b[1] - (a[1] + c[1]) / 2);
  });
}
// Where one curve meets the next, the angle between the way it arrives and the way the next leaves, in degrees. A control
// point rounded onto its end point leaves the curve no way to arrive or leave by, which is drawn as a corner: 90.
function joints(d) {
  const bs = beziers(d);
  return bs.map((b, i) => {
    const next = bs[(i + 1) % bs.length];
    const ix = b[3][0] - b[2][0], iy = b[3][1] - b[2][1];
    const ox = next[1][0] - next[0][0], oy = next[1][1] - next[0][1];
    if (Math.hypot(ix, iy) === 0 || Math.hypot(ox, oy) === 0) return 90;
    const t = Math.abs(Math.atan2(iy, ix) - Math.atan2(oy, ox)) * 180 / Math.PI;
    return t > 180 ? 360 - t : t;
  });
}
// The distance from a point to a polyline, looking near a hint (the points go round in order).
function distanceTo(line, p, hint, reach = 200) {
  let best = Infinity;
  const n = line.length;
  for (let o = -reach; o <= reach; o++) {
    const a = line[(((hint + o) % n) + n) % n], b = line[(((hint + o + 1) % n) + n) % n];
    const ex = b[0] - a[0], ey = b[1] - a[1], len = ex * ex + ey * ey || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / len));
    best = Math.min(best, Math.hypot(a[0] + ex * t - p[0], a[1] + ey * t - p[1]));
  }
  return best;
}
// The drawn path sampled finely: each curve at eight points.
function sampled(d) {
  const out = [];
  for (const [a, b, c, e] of beziers(d)) {
    for (let k = 0; k < 8; k++) {
      const t = k / 8, u = 1 - t;
      out.push([u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * e[0],
        u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * e[1]]);
    }
  }
  return out;
}
const max = (a) => a.reduce((m, v) => Math.max(m, v), 0);
// The nearest index of the fine circuit to each point of a list that goes round it in order.
function hintsOn(line, pts) {
  const hints = [];
  let h = 0;
  for (const p of pts) {
    let best = Infinity, at = h;
    for (let o = -50; o <= 400; o++) {
      const i = (((h + o) % line.length) + line.length) % line.length;
      const dd = Math.hypot(line[i][0] - p[0], line[i][1] - p[1]);
      if (dd < best) { best = dd; at = i; }
    }
    hints.push(at);
    h = at;
  }
  return hints;
}

// ── The page ──

// The car `pct` of the way round, from the outline's own points.
function carAt(pct) {
  const n = POINTS.length;
  const f = ((((pct % 1) + 1) % 1) * n);
  const i = Math.floor(f) % n, j = (i + 1) % n, k = f - Math.floor(f);
  const [ax, ay] = POINTS[i], [bx, by] = POINTS[j];
  const [cx, cy] = POINTS[(i + 10) % n];
  return { x: ax + (bx - ax) * k, y: ay + (by - ay) * k, heading: (Math.atan2(cx - ax, -(cy - ay)) * 180) / Math.PI };
}

// A stand-in for the telemetry: the race of tests/frames.mjs, at 120 mph (the closest view), with the circuit's path
// and the car where `feed` says — standing at `pct`, or driving round from it at `mps` metres a second by the clock.
async function telemetry() {
  const feed = { svg: hostPath(1), pct: 0.12, mps: 0, since: Date.now() };
  const payload = () => {
    const pct = feed.pct + (feed.mps * (Date.now() - feed.since)) / 1000 / LENGTH_M;
    const car = carAt(pct);
    return {
      ...frame({ order: fieldWith(4), state: 4, mode: 4, start: 7, lap: 12, playerPct: pct }),
      'DataCorePlugin.GameData.SpeedMph': 120,
      'RacingDesk.Plugin.TrackMap.SvgPath': feed.svg,
      'RacingDesk.Plugin.TrackMap.PlayerX': car.x,
      'RacingDesk.Plugin.TrackMap.PlayerY': car.y,
      'RacingDesk.Plugin.TrackMap.PlayerHeading': car.heading,
      'RacingDesk.Plugin.TrackMap.Status': 'ready',
    };
  };
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload()));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { feed, payload, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }) };
}

async function openIpad(page, t) {
  const config = { appDir: OVERLAY, telemetryBase: t.url, key: remote.newKey(), dispatchAction: null, addresses: () => [], names: () => [], displaySettings: () => ({ followMapZoom: 'closer' }) };
  const ipad = http.createServer((req, res) => remote.handleRequest(config, req, res));
  await new Promise((resolve) => ipad.listen(0, '127.0.0.1', resolve));
  await page.addInitScript(() => { try { localStorage.setItem('rd-effects', 'off'); } catch (e) { /* none */ } });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.goto(`http://127.0.0.1:${ipad.address().port}/`);
  await page.waitForFunction(() => typeof _isIdle !== 'undefined' && _isIdle === false && _pollFrame > 5
    && document.getElementById('zoomMapTrackSrc').getAttribute('d').length > 1000
    && document.getElementById('zoomMapSvg').style.getPropertyValue('--px') !== '', null, { timeout: 20000 });
  // The closest view: the car at 120 mph, and the view settled.
  await page.waitForFunction((r) => Math.abs(+document.getElementById('zoomMapSvg').getAttribute('viewBox').split(/\s+/)[2] - 2 * r) < 0.05, mz.R_CLOSE, { timeout: 10000 });
  return { close: () => new Promise((resolve) => { ipad.close(resolve); ipad.closeAllConnections(); }) };
}

// Pixels to a map unit on the iPad's following map at its closest view.
const pxPerUnit = (page) => page.evaluate((r) => document.getElementById('zoomMapSvg').getBoundingClientRect().width / (2 * r), mz.R_CLOSE);
const drawn = (page) => page.evaluate(() => document.getElementById('zoomMapTrackSrc').getAttribute('d'));

test('the plugin\'s path before the change is the squiggle: at one decimal its points wander by two pixels at the iPad\'s closest view, and its curves meet at kinks', () => {
  const px = 332 / (2 * mz.R_CLOSE);   // the following map's cell on an iPad Air on its side, at the closest view
  expect(max(wiggles(POINTS)) * px, 'the circuit itself').toBeLessThan(0.15);
  expect(max(wiggles(onCurve(hostPath(1)))) * px, 'one decimal').toBeGreaterThan(1.5);
  expect(max(joints(hostPath(1))), 'one decimal: the worst kink, degrees').toBeGreaterThan(45);
  // Two decimals, as the host writes it now: a third of a pixel.
  expect(max(wiggles(onCurve(hostPath(2)))) * px, 'two decimals').toBeLessThan(0.4);
});

test('the iPad draws the outline smooth from a plugin\'s one-decimal path and from the host\'s two, on the circuit, the car on the line', async ({ page }) => {
  test.setTimeout(120000);
  const t = await telemetry();
  const ipad = await openIpad(page, t);
  try {
    const px = await pxPerUnit(page);
    expect(px).toBeGreaterThan(25);

    // A plugin from before the change: one decimal. The page smooths it, and draws its own spline.
    const one = await drawn(page);
    const onePts = onCurve(one);
    expect(onePts.length, 'a curve to each of the outline\'s points').toBe(POINTS.length);
    expect(max(wiggles(onePts)) * px, 'one decimal: the line\'s wiggle, px').toBeLessThan(0.5);
    expect(max(joints(one)), 'one decimal: the worst kink where two curves meet, degrees').toBeLessThan(6);
    const oneHints = hintsOn(TRUE, onePts);
    expect(max(onePts.map((p, i) => distanceTo(TRUE, p, oneHints[i]))) * px, 'one decimal: off the circuit, px').toBeLessThan(1.5);

    // The host now: two decimals, drawn through its own points, within a fifth of a pixel of the circuit.
    t.feed.svg = hostPath(2);
    await page.waitForFunction((was) => document.getElementById('zoomMapTrackSrc').getAttribute('d') !== was, one, { timeout: 10000 });
    const two = await drawn(page);
    const twoPts = onCurve(two);
    expect(max(wiggles(twoPts)) * px, 'two decimals: the line\'s wiggle, px').toBeLessThan(0.5);
    expect(max(joints(two)), 'two decimals: the worst kink, degrees').toBeLessThan(6);
    const twoHints = hintsOn(TRUE, twoPts);
    expect(max(twoPts.map((p, i) => distanceTo(TRUE, p, twoHints[i]))) * px, 'two decimals: off the circuit, px').toBeLessThan(0.4);
    // The full circuit is drawn from the same line.
    expect(await page.evaluate(() => document.getElementById('fullMapTrackSrc').getAttribute('d'))).toBe(two);

    // Driving, from where it stands: the car's dot is on the line at every frame, and its trail is on the line and ends at
    // it. At 15 m/s: a headless page drawing in software has a handful of frames a second, and the page's low-pass on the
    // car's place, which cuts a bend by the square of the step, is not what this is of (the view still says 120 mph).
    t.feed.mps = 15;
    t.feed.since = Date.now();
    const frames = await page.evaluate(async () => {
      const out = [];
      let seen = -1;
      const t0 = performance.now();
      while (out.length < 30 && performance.now() - t0 < 15000) {
        await new Promise((r) => requestAnimationFrame(r));
        if (_pollFrame === seen) continue;
        seen = _pollFrame;
        const dot = document.getElementById('zoomMapPlayer');
        const trail = (document.getElementById('zoomMapTrail').getAttribute('points') || '').trim().split(/\s+/).filter(Boolean)
          .map((p) => p.split(',').map(Number));
        out.push({ dot: [+dot.getAttribute('cx'), +dot.getAttribute('cy')], trail });
      }
      return out;
    });
    expect(frames.length).toBeGreaterThan(20);
    const line = sampled(two);
    // The nearest sample of the line to a point, looked for all the way round.
    const nearest = (p) => { let b = Infinity, at = 0; for (let i = 0; i < line.length; i++) { const d = Math.hypot(line[i][0] - p[0], line[i][1] - p[1]); if (d < b) { b = d; at = i; } } return at; };
    let worstDot = 0, worstTrail = 0, worstHead = 0, trails = 0;
    // The first frames are the car moving off; the rest are it driving.
    for (const f of frames.slice(3)) {
      const h = nearest(f.dot);
      worstDot = Math.max(worstDot, distanceTo(line, f.dot, h, 40));
      if (f.trail.length >= 2) {
        trails++;
        const head = f.trail[f.trail.length - 1];
        worstHead = Math.max(worstHead, Math.hypot(head[0] - f.dot[0], head[1] - f.dot[1]));
        // The last stretch of the trail: its last sixty points, 100 m behind the car.
        for (const p of f.trail.slice(-60)) worstTrail = Math.max(worstTrail, distanceTo(line, p, h, 400));
      }
    }
    expect(trails, 'frames with a trail behind the car').toBeGreaterThan(10);
    expect(worstDot * px, 'the car\'s dot off the line, px').toBeLessThan(0.6);
    expect(worstTrail * px, 'the trail off the line, px').toBeLessThan(0.3);
    expect(worstHead * px, 'the trail\'s end from the car, px').toBeLessThan(0.6);
  } finally {
    await ipad.close();
    await t.close();
  }
});

test('the rig\'s HUD draws the same line from the same path; a path the page cannot read is drawn as it was given and said to render nothing', async ({ page }) => {
  test.setTimeout(60000);
  const t = await telemetry();
  const ipadPage = await page.context().newPage();
  const ipad = await openIpad(ipadPage, t);
  try {
    const onIpad = await drawn(ipadPage);
    const warnings = [];
    page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()); });
    const feed = { payload: t.payload() };
    await page.route(/^https?:\/\/(?!localhost:8889)/, (route) => route.abort());
    await page.route('http://localhost:8889/racing-desk/', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(feed.payload) }));
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(pathToFileURL(path.join(OVERLAY, 'dashboard.html')).href);
    await page.evaluate(() => { _settings.showWebGL = false; applySettings(); });
    await page.waitForFunction(() => document.getElementById('zoomMapTrackSrc').getAttribute('d').length > 1000, null, { timeout: 20000 });
    expect(await drawn(page)).toBe(onIpad);
    // Pairs of numbers with no command: not a path. It is drawn as it came, nothing renders, and the page says so.
    feed.payload = { ...t.payload(), 'RacingDesk.Plugin.TrackMap.SvgPath': '20,10 50,8 80,12 90,35 70,75' };
    await expect.poll(() => drawn(page), { timeout: 10000 }).toBe('20,10 50,8 80,12 90,35 70,75');
    await expect.poll(() => warnings.some((w) => w.includes('[K10 track-map]') && w.includes('nothing rendered')), { timeout: 10000 }).toBe(true);
  } finally {
    await ipad.close();
    await t.close();
  }
});
