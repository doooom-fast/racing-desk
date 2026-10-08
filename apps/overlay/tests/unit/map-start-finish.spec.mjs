/**
 * The start/finish tick on the two maps (webgl-helpers.js updateTrackMap, map-motion.js startFinishAngle). He said on
 * 2026-10-07: "start, finish lines on maps seem to be strangely placed. They need to go perpendicular to the track at
 * that point." The tick is a vertical line in dashboard.html, put at the outline's first point with a translate and
 * nothing else, so it was across the road only where the road ran along the screen, and along it where the road ran
 * down it. Now it is turned by the way the road runs at that point (a short chord across the point, wrapping past the
 * end of the closed outline), on the full map and on the following map, on the rig's HUD and in the glance layout. In
 * the glance layout, where the road is drawn in pixels, it is also sized to the road: 1.2 times the outer line's width.
 *
 * The first point of the outline is the line (LapDistPct 0) for every source the host serves — his own outline, whose
 * bin b is at b/bins, and SimHub's shared map, whose first point is p 0 and whose resampled bins start at it (the C#
 * tests hold both: CrowdMapsTests, GeometryTests) — so the page puts the tick at the path's first point.
 *
 * Held here: the angle, in Node (a circle, a loop that starts at a corner so that only a chord across the point finds
 * the road, a chord too short to reach a corner 1 % of the lap on, a curve whose last point repeats its first, an outline
 * too short to have a direction); and the pages — the
 * iPad's (the glance layout, from the remote server) and the rig's HUD (from the file), for a line that starts where the
 * road runs down the screen and for one that starts part way round — with the tick at right angles to the road on
 * both maps as the browser's own matrices have it, and its size.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { frame, fieldWith, SVG_PATH } from '../frames.mjs';

const require = createRequire(import.meta.url);
const mm = require('../../modules/js/map-motion.js');
const mz = require('../../modules/js/map-zoom.js');
const remote = require('../../remote-server.js');

const OVERLAY = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DASHBOARD = pathToFileURL(path.join(OVERLAY, 'dashboard.html')).href;
const KEY = 'abcd2345';
const RACE = (over = {}) => frame({ order: fieldWith(4), state: 4, mode: 4, start: 7, lap: 12, ...over });

// The test circuit (tests/frames.mjs) as points, and as the path of a loop that starts `k` points round it.
const POINTS = SVG_PATH.replace(/^M\s*/, '').replace(/\s*Z$/, '').split(/\s*L\s*/).map((p) => p.split(',').map(Number));
const pathFrom = (k) => 'M ' + [...POINTS.slice(k), ...POINTS.slice(0, k)].map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L ') + ' Z';
// The road's direction at point k of that circuit, from a chord across it.
const roadAt = (k) => {
  const a = POINTS[(k - 3 + POINTS.length) % POINTS.length], b = POINTS[(k + 3) % POINTS.length];
  return { x: b[0] - a[0], y: b[1] - a[1] };
};

// ── The angle ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const circle = (n, r = 40, start = 0) => Array.from({ length: n }, (_, i) => {
  const t = start + (i / n) * Math.PI * 2;
  return { x: 50 + r * Math.cos(t), y: 50 + r * Math.sin(t) };
});
// Whether a vertical line turned by `angle` degrees is across a road running along (dx, dy).
const acrossRoad = (angle, dx, dy) => {
  const a = (angle * Math.PI) / 180;
  const tick = { x: -Math.sin(a), y: Math.cos(a) };   // (0, 1) turned by rotate(angle)
  return Math.abs(tick.x * dx + tick.y * dy) / Math.hypot(dx, dy);
};

test.describe('the road\'s direction at the start/finish line', () => {
  test('on a circle it is the tangent at the first point, whichever way round the circle starts', () => {
    for (const start of [0, 0.7, 2.1, 4, 5.5]) {
      const pts = circle(400, 40, start);
      const angle = mm.startFinishAngle(pts);
      // The first point is at angle `start` round the circle, driven the way the points go: the tangent is a quarter turn on.
      const expected = ((start * 180) / Math.PI + 90 + 540) % 360 - 180;
      const diff = ((angle - expected + 540) % 360) - 180;
      expect(Math.abs(diff), `start ${start}: ${angle.toFixed(2)} against ${expected.toFixed(2)}`).toBeLessThan(0.6);
      // A vertical line turned by it is across the road: its direction has nothing along the tangent.
      const t = { x: -Math.sin(start), y: Math.cos(start) };
      expect(acrossRoad(angle, t.x, t.y)).toBeLessThan(0.01);
    }
  });

  test('it reads the road over a chord across the point, wrapping past the end of the closed outline', () => {
    // A square that starts at its corner: the road turns there, and a chord across the corner runs on the diagonal. (The
    // direction from the first point to the second would be along the edge, and one from the point before it to the
    // first, the other edge's.) Wrapping matters: the point before the first is the last.
    const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(mm.startFinishAngle(square)).toBeCloseTo(-45, 0);
    // The same square starting at the next corner: the chord across it is the other diagonal.
    const next = [square[1], square[2], square[3], square[0]];
    expect(mm.startFinishAngle(next)).toBeCloseTo(45, 0);
  });

  test('a curve that closes with its first point repeated is the same loop', () => {
    const pts = circle(300, 30, 1.3);
    const closed = [...pts, { ...pts[0] }];
    expect(mm.startFinishAngle(closed)).toBeCloseTo(mm.startFinishAngle(pts), 6);
  });

  test('the chord is a short one: SF_SPAN of the lap each way, and never less than SF_MIN_POINTS of the outline\'s points', () => {
    expect(mm.SF_SPAN).toBe(0.003);
    expect(mm.SF_MIN_POINTS).toBe(1.5);
    // On a circle a chord across the point is parallel to the tangent however long it is, so the proof that it is short
    // is a bend that is not a circle: a straight edge into a corner. The chord is 0.3 % of the lap either side of the
    // point (1.2 of an outline 400 round), so from a point 1 % of the lap (4) before the corner it stays on the straight.
    const rect = [];
    for (let i = 0; i < 1000; i++) rect.push({ x: i / 10, y: 0 });         // 100 along the bottom
    for (let i = 0; i < 1000; i++) rect.push({ x: 100, y: i / 10 });       // 100 up the right (y grows down the screen)
    for (let i = 0; i < 1000; i++) rect.push({ x: 100 - i / 10, y: 100 });
    for (let i = 0; i < 1000; i++) rect.push({ x: 0, y: 100 - i / 10 });
    const before = rect.slice(960).concat(rect.slice(0, 960));            // starts 4 % of an edge, 1 % of the lap, before the corner
    expect(mm.startFinishAngle(before)).toBeCloseTo(0, 3);                  // along the edge: the chord does not reach the corner
  });

  test('an outline too short to have a direction has none', () => {
    expect(mm.startFinishAngle([])).toBe(0);
    expect(mm.startFinishAngle(null)).toBe(0);
    expect(mm.startFinishAngle([{ x: 1, y: 1 }, { x: 2, y: 2 }])).toBe(0);
    expect(mm.startFinishAngle([{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }])).toBe(0);
  });
});

// ── The pages ─────────────────────────────────────────────────────────────────────────────────────────────────────────

let payload = RACE();
let telemetry, port;

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
  await remote.start({ port, host: '127.0.0.1', appDir: OVERLAY, key: KEY, log: () => {}, telemetryUrl: `http://127.0.0.1:${telemetry.address().port}/racing-desk/` });
});
test.afterAll(async () => {
  await remote.stop();
  await new Promise((resolve) => { telemetry.close(resolve); telemetry.closeAllConnections(); });
});

const withPath = (k, over = {}) => ({ ...RACE(over), 'RacingDesk.Plugin.TrackMap.SvgPath': pathFrom(k) });

async function frames(page, n = 6) {
  await page.waitForFunction(() => typeof _isIdle !== 'undefined' && _isIdle === false && _pollFrame > 5, null, { timeout: 15000 });
  const before = await page.evaluate(() => _pollFrame);
  await page.waitForFunction((at) => _pollFrame >= at, before + n, { timeout: 15000 });
}

async function openIpad(page, first) {
  payload = first;
  await page.addInitScript(() => { try { localStorage.setItem('rd-effects', 'off'); } catch (e) { /* none */ } });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.goto(`http://127.0.0.1:${port}/`);
  await frames(page);
  await page.waitForFunction(() => document.getElementById('zoomMapSvg').style.getPropertyValue('--px') !== '', null, { timeout: 10000 });
}

async function openRig(page, first, { glance = false } = {}) {
  payload = first;
  await page.route(/^https?:\/\/(?!localhost:8889)/, (route) => route.abort());
  await page.route('http://localhost:8889/racing-desk/', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) }));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(DASHBOARD);
  await page.evaluate(() => { _settings.showWebGL = false; });
  if (glance) {
    await page.evaluate(() => setDriveMode(true));
    await page.waitForFunction(() => document.getElementById('zoomMapSvg').style.getPropertyValue('--px') !== '', null, { timeout: 10000 });
  }
  await frames(page);
}

// What the page has drawn of the tick on one map, as the browser's own matrices have it, in screen pixels: where it is,
// the vector from one end of it to the other (round caps and all: the stroke's width is added to its length), and the road's
// direction at the line, from the outline's points `k - 3` and `k + 3` carried through the matrices of the space they are drawn in.
async function tickOn(page, which, k) {
  return page.evaluate(([id, k, pts]) => {
    const g = document.getElementById(id);
    const line = g.querySelector('line');
    const m = g.getScreenCTM();
    const parent = g.parentNode.getScreenCTM();
    const y1 = +line.getAttribute('y1'), y2 = +line.getAttribute('y2'), stroke = +line.getAttribute('stroke-width');
    const n = pts.length;
    const a = pts[(k - 3 + n) % n], b = pts[(k + 3) % n];
    const road = { x: parent.a * (b[0] - a[0]) + parent.c * (b[1] - a[1]), y: parent.b * (b[0] - a[0]) + parent.d * (b[1] - a[1]) };
    const tick = { x: m.c * (y2 - y1), y: m.d * (y2 - y1) };
    const scale = Math.hypot(m.a, m.b);
    return {
      shown: g.style.display !== 'none',
      at: { x: m.e, y: m.f },
      tick, road, y1, y2, stroke, scale,
      lengthPx: (Math.abs(y2 - y1) + stroke) * scale,
      transform: g.getAttribute('transform'),
    };
  }, [which, k, POINTS]);
}
// Degrees between the tick and the road: 90 is across it.
const between = (t) => (Math.acos(Math.abs(t.tick.x * t.road.x + t.tick.y * t.road.y) / (Math.hypot(t.tick.x, t.tick.y) * Math.hypot(t.road.x, t.road.y))) * 180) / Math.PI;

// The road at the circuit's first point runs straight down the screen (the circuit of tests/frames.mjs starts at its
// rightmost point, going down), which is exactly where a vertical tick lay along the road: the worst case. And part way
// round, where the road runs at a slant.
const STARTS = [0, 61, 143, 200];

test('the iPad: on both maps the tick is across the road at the start/finish line, wherever the outline starts', async ({ page }) => {
  test.setTimeout(120000);
  await openIpad(page, withPath(0));
  for (const k of STARTS) {
    payload = withPath(k);
    await page.waitForFunction((d) => document.getElementById('fullMapTrackSrc').getAttribute('d').startsWith(d), `M ${POINTS[k][0].toFixed(3)},${POINTS[k][1].toFixed(3)}`, { timeout: 10000 });
    await frames(page, 3);
    for (const which of ['fullMapSF', 'zoomMapSF']) {
      const t = await tickOn(page, which, k);
      const label = `${which}, outline starts at point ${k}`;
      expect(t.shown, label).toBe(true);
      // At the line: the outline's first point.
      expect(t.transform, label).toMatch(new RegExp(`^translate\\(${POINTS[k][0].toFixed(3)},${POINTS[k][1].toFixed(3)}\\) rotate\\(`));
      // Across the road, to within a few degrees (the chord the page reads it from is its own).
      expect(Math.abs(between(t) - 90), `${label}: ${between(t).toFixed(1)} degrees to the road`).toBeLessThan(3);
    }
  }
});

test('the iPad: the tick is sized to the road, 1.2 times the width of its outer line from end to end, and at a stroke in proportion', async ({ page }) => {
  test.setTimeout(60000);
  await openIpad(page, withPath(61));
  const m = await page.evaluate(() => {
    const px = (id) => parseFloat(document.getElementById(id).style.getPropertyValue('--px'));
    return { full: px('fullMapSvg'), zoom: px('zoomMapSvg') };
  });
  for (const [which, unit, outer] of [['fullMapSF', m.full, 12], ['zoomMapSF', m.zoom, 10 * mz.GLANCE_WEIGHT]]) {
    const t = await tickOn(page, which, 61);
    // The road's outer line in the map's units is its pixel weight times `--px`; the tick's length with its round ends
    // is 1.2 of that, and its stroke a fifth of the length.
    const outerUnits = outer * unit;
    expect((Math.abs(t.y2 - t.y1) + t.stroke) / outerUnits, `${which}: length over the outer line`).toBeCloseTo(1.2, 2);
    expect(t.stroke / (Math.abs(t.y2 - t.y1) + t.stroke), `${which}: stroke over length`).toBeCloseTo(0.2, 2);
    // On the screen, the full map's is 14.4 px (12 · 1.2) and the following map's 1.2 times its road, which is drawn in
    // proportion to the zoom.
    const roadPx = await page.evaluate(([id, w]) => {
      const svg = document.getElementById(id);
      return w * parseFloat(svg.style.getPropertyValue('--px')) * svg.getScreenCTM().a;
    }, [which === 'fullMapSF' ? 'fullMapSvg' : 'zoomMapSvg', outer]);
    expect(t.lengthPx / roadPx, `${which}: ${t.lengthPx.toFixed(1)} px against a road of ${roadPx.toFixed(1)}`).toBeCloseTo(1.2, 2);
    if (which === 'fullMapSF') expect(t.lengthPx).toBeCloseTo(14.4, 0);
  }
});

test('the rig\'s HUD: the tick is across the road too, at the sizes the HUD has always had', async ({ page }) => {
  test.setTimeout(60000);
  await openRig(page, withPath(61));
  for (const [which, half, stroke] of [['fullMapSF', 3.5, 1.5], ['zoomMapSF', 2, 0.8]]) {
    const t = await tickOn(page, which, 61);
    expect(Math.abs(between(t) - 90), `${which}: ${between(t).toFixed(1)} degrees to the road`).toBeLessThan(3);
    expect([t.y1, t.y2, t.stroke], which).toEqual([-half, half, stroke]);
  }
  // And where the road runs down the screen, where it lay along it.
  payload = withPath(0);
  await page.waitForFunction((d) => document.getElementById('fullMapTrackSrc').getAttribute('d').startsWith(d), `M ${POINTS[0][0].toFixed(3)},${POINTS[0][1].toFixed(3)}`, { timeout: 10000 });
  await frames(page, 3);
  for (const which of ['fullMapSF', 'zoomMapSF']) {
    const t = await tickOn(page, which, 0);
    expect(Math.abs(between(t) - 90), `${which}, road down the screen: ${between(t).toFixed(1)} degrees`).toBeLessThan(3);
  }
});

test('the rig\'s glance layout (Ctrl+Shift+F): sized to the road when on, and the HUD\'s own again when off', async ({ page }) => {
  test.setTimeout(60000);
  await openRig(page, withPath(143), { glance: true });
  const on = await tickOn(page, 'zoomMapSF', 143);
  expect(Math.abs(between(on) - 90)).toBeLessThan(3);
  expect(on.y2).not.toBe(2);
  const road = await page.evaluate(() => 10 * RacingDeskMapZoom.GLANCE_WEIGHT * parseFloat(document.getElementById('zoomMapSvg').style.getPropertyValue('--px')));
  expect((Math.abs(on.y2 - on.y1) + on.stroke) / road).toBeCloseTo(1.2, 2);
  await page.evaluate(() => setDriveMode(false));
  await frames(page, 2);
  for (const [which, half, stroke] of [['fullMapSF', 3.5, 1.5], ['zoomMapSF', 2, 0.8]]) {
    const t = await tickOn(page, which, 143);
    expect([t.y1, t.y2, t.stroke], which).toEqual([-half, half, stroke]);
    expect(Math.abs(between(t) - 90), which).toBeLessThan(3);
  }
});
