/**
 * The following map's zoom with his speed (modules/js/map-zoom.js; webgl-helpers.js draws it). He asked on
 * 2026-10-01: "include a zoom into my car on the following map that scales in with my speed increasing and out when it
 * decreases, in relation to that speed change". So the view's radius is a function of his speed — closer as he goes
 * faster, by default — bounded (the closest and the widest the local view has always had), eased over about half a
 * second so the noise in the speed is not in the map, centred on his car as before, and the same on every overlay;
 * which way it goes is one setting, "Following map zoom" under Look: 'closer', 'wider' or 'fixed', in the settings
 * file (a file from before it is given 'closer' once), told to the iPad and the OBS pages through their allowlists.
 *
 * "Wider at speed" is the local view as it was until this setting, curve for curve (closest standing still, widest from
 * 75 mph), so one setting gives it back; "Fixed" is a third view, not that one.
 *
 * Held here: the curve, in Node (bounds, each direction, today's curve exactly, fixed, proportion, clamping, the ease's
 * time constant, one late frame, a page back from the background, noise); the migration; and the pages — the rig's
 * HUD, its glance layout, the iPad and the page OBS draws — whose local view follows a speed ramp the way the setting
 * says, step by step and never in a jump, with the car at the middle of it to a thousandth of a unit.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { frame, fieldWith } from '../frames.mjs';

const require = createRequire(import.meta.url);
const mz = require('../../modules/js/map-zoom.js');
const settingsFile = require('../../modules/js/settings-file.js');
const remote = require('../../remote-server.js');

const OVERLAY = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DASHBOARD = pathToFileURL(path.join(OVERLAY, 'dashboard.html')).href;
const RACE = (over = {}) => frame({ order: fieldWith(4), state: 4, mode: 4, start: 7, lap: 12, ...over });
const atSpeed = (mph, over = {}) => ({ ...RACE(over), 'DataCorePlugin.GameData.SpeedMph': mph });

// ── The curve ─────────────────────────────────────────────────────────────────────────────────────────────────────────

test.describe('the curve: speed to radius', () => {
  const { R_CLOSE, R_WIDE, R_FIXED, SPEED_MAX_MPH, WIDER_MAX_MPH, TAU_S, MAX_STEP_S, RESTART_AFTER_S, targetRadius, ease, modeOf } = mz;

  test('the bounds are the local view\'s own (5.6 and 50/3), and the fixed view is the middle of them', () => {
    expect(R_CLOSE).toBe(5.6);
    expect(R_WIDE).toBe(50 / 3);
    expect(R_FIXED).toBeCloseTo((5.6 + 50 / 3) / 2, 9);
    expect(SPEED_MAX_MPH).toBe(150);
    expect(WIDER_MAX_MPH).toBe(75);
    expect(TAU_S).toBe(0.4);
    expect(MAX_STEP_S).toBe(0.1);
    expect(RESTART_AFTER_S).toBe(2);
  });

  test('closer at speed: the widest view standing still, the closest at 150 mph and above, linear between, never past either', () => {
    expect(targetRadius(0, 'closer')).toBe(R_WIDE);
    expect(targetRadius(150, 'closer')).toBeCloseTo(R_CLOSE, 9);
    expect(targetRadius(75, 'closer')).toBeCloseTo((R_WIDE + R_CLOSE) / 2, 9);
    expect(targetRadius(50, 'closer')).toBeCloseTo(R_WIDE - (R_WIDE - R_CLOSE) / 3, 9);
    expect(targetRadius(200, 'closer')).toBeCloseTo(R_CLOSE, 9);
    expect(targetRadius(-20, 'closer')).toBe(R_WIDE);
    let last = Infinity;
    for (let mph = 0; mph <= 160; mph += 5) {
      const r = targetRadius(mph, 'closer');
      expect(r).toBeLessThanOrEqual(last + 1e-12);
      expect(r).toBeGreaterThanOrEqual(R_CLOSE - 1e-12);
      expect(r).toBeLessThanOrEqual(R_WIDE + 1e-12);
      last = r;
    }
  });

  test('wider at speed is the local view as it was, exactly: the old curve, closest standing still and widest from 75 mph', () => {
    // The line this setting replaced in webgl-helpers.js: `5.6 + (min(speed, 75) / 75) * (50 / 3 - 5.6)`.
    const was = (mph) => 5.6 + (Math.min(mph, 75) / 75) * (50 / 3 - 5.6);
    for (let mph = 0; mph <= 220; mph += 2.5) expect(targetRadius(mph, 'wider'), `${mph} mph`).toBeCloseTo(was(mph), 12);
    expect(targetRadius(0, 'wider')).toBe(R_CLOSE);
    expect(targetRadius(75, 'wider')).toBeCloseTo(R_WIDE, 12);
    expect(targetRadius(37.5, 'wider')).toBeCloseTo((R_WIDE + R_CLOSE) / 2, 12);
    for (const mph of [75, 110, 150, 999]) expect(targetRadius(mph, 'wider'), `${mph} mph`).toBeCloseTo(R_WIDE, 12);
    expect(targetRadius(-30, 'wider')).toBe(R_CLOSE);
  });

  test('"fixed" is a view of its own, not the old one: at the speeds he drives it is not what the map was, and the three are three views', () => {
    for (const mph of [20, 40, 110, 140]) {
      const [c, w, f] = ['closer', 'wider', 'fixed'].map((m) => targetRadius(mph, m));
      expect(Math.abs(f - w), `fixed against the old view at ${mph} mph`).toBeGreaterThan(0.3);
      expect(new Set([c, w, f].map((r) => r.toFixed(3))).size, `${mph} mph`).toBe(3);
    }
  });

  test('fixed is one view at every speed', () => {
    for (const mph of [0, 20, 75, 150, 300]) expect(targetRadius(mph, 'fixed')).toBe(R_FIXED);
  });

  test('a speed that is no number is standing still; a mode that is no mode is closer at speed', () => {
    expect(targetRadius(undefined, 'closer')).toBe(R_WIDE);
    expect(targetRadius(NaN, 'wider')).toBe(R_CLOSE);
    expect(targetRadius('fast', 'closer')).toBe(R_WIDE);
    expect(targetRadius(150, 'sideways')).toBeCloseTo(R_CLOSE, 9);
    expect(targetRadius(150)).toBeCloseTo(R_CLOSE, 9);
    expect(modeOf('closer')).toBe('closer');
    expect(modeOf('wider')).toBe('wider');
    expect(modeOf('fixed')).toBe('fixed');
    for (const junk of ['sideways', '', null, undefined, 1, {}]) expect(modeOf(junk)).toBe('closer');
    expect(mz.MODES).toEqual(['closer', 'wider', 'fixed']);
    expect(mz.DEFAULT).toBe('closer');
    expect(mz.KEY).toBe('followMapZoom');
  });

  test('the ease: 63 % of a step in 0.4 s, 90 % in 0.93 s, 99 % in 1.85 s; nothing in no time; a start from nowhere is the target', () => {
    expect(ease(10, 20, 0.4)).toBeCloseTo(10 + 10 * (1 - Math.exp(-1)), 6);
    expect(ease(10, 20, 0.93)).toBeGreaterThan(19);
    expect(ease(10, 20, 1.85)).toBeGreaterThan(19.9);
    expect(ease(10, 20, 0)).toBe(10);
    expect(ease(10, 20, -1)).toBe(10);
    expect(ease(10, 20, NaN)).toBe(10);
    expect(ease(NaN, 20, 0.1)).toBe(20);
    expect(ease(undefined, 20, 0.1)).toBe(20);
    // Half a second to a second: most of the way in half a second, all but a little in one.
    expect((ease(0, 1, 0.5))).toBeGreaterThan(0.7);
    expect((ease(0, 1, 1.0))).toBeGreaterThan(0.9);
  });

  test('the follower: the first frame sets the view outright, then each frame eases by the page\'s clock; a late frame counts for a tenth of a second at most', () => {
    const f = mz.follower();
    expect(f.radius(0, 'closer', 1000)).toBe(R_WIDE);
    // At 30 frames a second, a step from 0 to 150 mph: never a jump, and near the target within a second and a half.
    let r = R_WIDE;
    const steps = [];
    for (let i = 1; i <= 45; i++) {
      const next = f.radius(150, 'closer', 1000 + i * 33.3);
      steps.push(r - next);
      expect(next).toBeLessThan(r);
      r = next;
    }
    expect(Math.max(...steps)).toBeLessThan((R_WIDE - R_CLOSE) * 0.1);    // a tenth of the whole in one frame at most
    expect(Math.abs(r - R_CLOSE)).toBeLessThan((R_WIDE - R_CLOSE) * 0.03);  // within 3 % after 1.5 s
    // Back down: the view opens up again, as slowly.
    const before = r;
    const next = f.radius(0, 'closer', 1000 + 46 * 33.3);
    expect(next).toBeGreaterThan(before);
    expect(next - before).toBeLessThan((R_WIDE - R_CLOSE) * 0.1);
    // A frame that is late — nearly two seconds — counts for a tenth of a second: the view moves by about a fifth of
    // what is left and no more, and the frames after it close the rest.
    const lateAt = 1000 + 46 * 33.3 + 1900;
    const late = f.radius(0, 'closer', lateAt);
    expect(late).toBeGreaterThan(next);
    expect(late).toBeCloseTo(next + (R_WIDE - next) * (1 - Math.exp(-MAX_STEP_S / TAU_S)), 9);
    expect(f.radius(0, 'closer', lateAt + 33.3)).toBeGreaterThan(late);
    // No clock: the view is held where it is.
    const held = f.current();
    expect(f.radius(150, 'closer', NaN)).toBe(held);
    expect(f.radius(150, 'closer')).toBe(held);
    f.reset();
    expect(Number.isNaN(f.current())).toBe(true);
    expect(f.radius(75, 'fixed', 5)).toBe(R_FIXED);
    // A change of mode is eased too: no jump when the setting changes.
    const after = f.radius(75, 'closer', 5 + 33);
    expect(Math.abs(after - R_FIXED)).toBeLessThan(0.1);
  });

  test('one late frame moves the view by a quarter of what is left at most, whatever the gap, and the frames after it catch up', () => {
    for (const lateMs of [250, 500, 1000, 1900]) {
      const f = mz.follower();
      f.radius(0, 'closer', 0);
      // Settled at 150 mph, then braking to 60: the target is far from the radius, and a frame comes late.
      for (let i = 1; i <= 90; i++) f.radius(150, 'closer', i * 33.3);
      const settled = f.current();
      const t0 = 90 * 33.3;
      const target = targetRadius(60, 'closer');
      const first = f.radius(60, 'closer', t0 + lateMs);
      expect(Math.abs(first - settled), `${lateMs} ms late`).toBeLessThanOrEqual(Math.abs(target - settled) * 0.25);
      expect(first).toBeGreaterThan(settled);
      // Prompt frames after it close the rest in the ordinary way.
      let r = first;
      for (let i = 1; i <= 60; i++) { const n = f.radius(60, 'closer', t0 + lateMs + i * 33.3); expect(n).toBeGreaterThanOrEqual(r); r = n; }
      expect(Math.abs(r - target)).toBeLessThan(Math.abs(target - settled) * 0.03);
    }
  });

  test('a page back from the background (more than two seconds with no frame) starts afresh at the speed it is at, not from the view it had', () => {
    const f = mz.follower();
    f.radius(150, 'closer', 0);
    for (let i = 1; i <= 90; i++) f.radius(150, 'closer', i * 33.3);
    expect(f.current()).toBeCloseTo(R_CLOSE, 1);
    expect(f.radius(0, 'closer', 90 * 33.3 + 2500)).toBe(R_WIDE);
    // Just under two seconds is a late frame and no more: eased, not started afresh.
    const g = mz.follower();
    g.radius(150, 'closer', 0);
    for (let i = 1; i <= 90; i++) g.radius(150, 'closer', i * 33.3);
    const before = g.current();
    const r = g.radius(0, 'closer', 90 * 33.3 + 1990);
    expect(r).toBeLessThan(R_WIDE);
    expect(r).toBeGreaterThan(before);
    // And a clock that runs backwards is no time at all.
    const h = mz.follower();
    h.radius(0, 'closer', 5000);
    expect(h.radius(150, 'closer', 4000)).toBe(R_WIDE);
  });

  test('noise in the speed is not in the map: a mile an hour or two either way moves the view by a hundredth of a unit a frame', () => {
    const f = mz.follower();
    f.radius(100, 'closer', 0);
    for (let i = 1; i <= 60; i++) f.radius(100, 'closer', i * 33.3);
    const settled = f.current();
    let worst = 0;
    for (let i = 61; i <= 120; i++) {
      const jitter = 100 + (i % 2 ? 2 : -2);
      const r = f.radius(jitter, 'closer', i * 33.3);
      worst = Math.max(worst, Math.abs(r - settled));
    }
    expect(worst).toBeLessThan(0.02);
  });
});

// ── The migration ─────────────────────────────────────────────────────────────────────────────────────────────────────

test.describe('the setting in the file', () => {
  let root;
  test.beforeAll(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'racing-desk-map-zoom-')); });
  test.afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });
  const fileIn = (tag) => { const dir = path.join(root, tag); fs.mkdirSync(dir, { recursive: true }); return path.join(dir, 'overlay-settings.json'); };

  test('a file from before the setting is given "closer"; a word that is one of the three is kept; junk becomes "closer"; nothing else is touched', () => {
    const his = { zoom: 120, showSpotter: false, paints: { customerId: '424242' } };
    expect(mz.migrate(his)).toEqual({ settings: { ...his, followMapZoom: 'closer' }, changed: true, added: ['followMapZoom'] });
    expect(his.followMapZoom).toBeUndefined();   // the one given is left as it was
    for (const mode of ['closer', 'wider', 'fixed']) expect(mz.migrate({ ...his, followMapZoom: mode })).toEqual({ settings: { ...his, followMapZoom: mode }, changed: false, added: [] });
    expect(mz.migrate({ ...his, followMapZoom: 'sideways' }).settings.followMapZoom).toBe('closer');
    expect(mz.migrate({ ...his, followMapZoom: 3 }).settings.followMapZoom).toBe('closer');
    expect(mz.migrate(null)).toEqual({ settings: { followMapZoom: 'closer' }, changed: true, added: ['followMapZoom'] });
  });

  test('the file: written once, left alone after, and never written over one that cannot be read', () => {
    const file = fileIn('his');
    settingsFile.save(file, { zoom: 120, raceLinks: { a: '1' } });
    const first = mz.migrateFile(file, { settingsFile });
    expect(first).toMatchObject({ changed: true, added: ['followMapZoom'], state: 'ok' });
    expect(settingsFile.load(file)).toEqual({ zoom: 120, raceLinks: { a: '1' }, followMapZoom: 'closer' });
    expect(mz.migrateFile(file, { settingsFile })).toMatchObject({ changed: false, added: [], state: 'ok' });
    // His choice stands.
    settingsFile.setKey(file, 'followMapZoom', 'wider');
    expect(mz.migrateFile(file, { settingsFile })).toMatchObject({ changed: false });
    expect(settingsFile.load(file).followMapZoom).toBe('wider');
    // A first run has no file: the setting is written into a new one.
    const fresh = fileIn('fresh');
    expect(mz.migrateFile(fresh, { settingsFile })).toMatchObject({ changed: true, state: 'missing' });
    expect(settingsFile.load(fresh)).toEqual({ followMapZoom: 'closer' });
    // An unreadable file is left as it is.
    const broken = fileIn('broken');
    fs.writeFileSync(broken, '{ "zoom": 120, ');
    expect(mz.migrateFile(broken, { settingsFile })).toMatchObject({ changed: false, state: 'unreadable' });
    expect(fs.readFileSync(broken, 'utf8')).toBe('{ "zoom": 120, ');
  });

  test('main.js runs it once at start, through settings-file.js, before anything reads the file', () => {
    const code = fs.readFileSync(path.join(OVERLAY, 'main.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
    expect(code).toMatch(/const mapZoom = require\('\.\/modules\/js\/map-zoom'\);/);
    expect(code.match(/mapZoom\.migrateFile\(getSettingsPath\(\), \{ settingsFile \}\)/g)).toHaveLength(1);
    expect(code.indexOf('migrateFollowMapZoom')).toBeLessThan(code.indexOf('function getRatingPath'));
  });
});

// ── The pages ─────────────────────────────────────────────────────────────────────────────────────────────────────────

function freePort() {
  return new Promise((resolve) => {
    const probe = http.createServer();
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
}

async function telemetry(first) {
  const feed = { payload: first };
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(feed.payload));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { feed, url: `http://127.0.0.1:${server.address().port}/racing-desk/`, close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }) };
}

async function frames(page, n = 6) {
  await page.waitForFunction(() => typeof _isIdle !== 'undefined' && _isIdle === false && _pollFrame > 5, null, { timeout: 15000 });
  const before = await page.evaluate(() => _pollFrame);
  await page.waitForFunction((at) => _pollFrame >= at, before + n, { timeout: 15000 });
}

// The local view as drawn: its viewBox's width in map units (the radius twice), and where the car is in it.
const view = (page) => page.evaluate(() => {
  const svg = document.getElementById('zoomMapSvg');
  const vb = svg.getAttribute('viewBox').split(/\s+/).map(Number);
  const player = document.getElementById('zoomMapPlayer');
  return {
    width: vb[2], height: vb[3],
    across: (+player.getAttribute('cx') - vb[0]) / vb[2], down: (+player.getAttribute('cy') - vb[1]) / vb[3],
    mode: _settings.followMapZoom,
  };
});

const RANGE = 2 * (mz.R_WIDE - mz.R_CLOSE);   // the whole of the view's change, in width

// Hold a speed for `ms` at least, and on until the view has stopped moving (the last five frames within a fiftieth of a
// unit of each other; eight seconds at most), reading the view's width at every frame the page draws on the way (and the
// time, and how long the frame before took): the width it settled at, and every move that was a jump. A frame counts for
// the time since the one before it, a tenth of a second at most (map-zoom.js MAX_STEP_S): between one frame and the next
// the view may move no further than the ease allows for that — a late frame moves further than a prompt one, as the
// clock says, up to the cap, and a headless page drawing in software has late frames, and settles in more of them — so a
// jump is a move with no time behind it, judged against the whole range (what a change of setting asks for at most).
async function hold(page, feed, mph, ms = 1800) {
  feed.payload = atSpeed(mph);
  const samples = await page.evaluate(async ([wait, most]) => {
    const out = [];
    const t0 = performance.now();
    let seen = -1;
    let lastRaf = t0;
    const width = () => document.getElementById('zoomMapSvg').getAttribute('viewBox').split(/\s+/).map(Number)[2];
    const still = () => out.length >= 5 && out.slice(-5).every((s) => Math.abs(s[2] - out[out.length - 1][2]) < 0.02);
    while (performance.now() - t0 < wait || (!still() && performance.now() - t0 < most)) {
      await new Promise((r) => requestAnimationFrame(r));
      const now = performance.now();
      const gap = now - lastRaf;
      lastRaf = now;
      if (_pollFrame === seen) continue;
      seen = _pollFrame;
      out.push([now, gap, width()]);
    }
    return out;
  }, [ms, 8000]);
  const jumps = [];
  for (let i = 1; i < samples.length; i++) {
    // The frame was drawn somewhere in the gap before this sample, so the time it had is up to a gap more.
    const dt = Math.min(mz.MAX_STEP_S, (samples[i][0] - samples[i - 1][0] + samples[i][1]) / 1000);
    const allowed = RANGE * (1 - Math.exp(-dt / mz.TAU_S)) * 1.1 + 0.1;
    const moved = Math.abs(samples[i][2] - samples[i - 1][2]);
    if (moved > allowed) jumps.push(`${moved.toFixed(2)} in ${(dt * 1000).toFixed(0)} ms (${allowed.toFixed(2)} allowed)`);
  }
  return { settled: samples[samples.length - 1][2], jumps, frames: samples.length };
}

// A ramp of speeds, each held long enough to settle: the settled widths, and the jumps on the way, if any.
async function ramp(page, feed, speeds) {
  const widths = [];
  const jumps = [];
  for (const mph of speeds) {
    const h = await hold(page, feed, mph);
    widths.push(h.settled);
    jumps.push(...h.jumps);
  }
  return { widths, jumps };
}

const RAMP = [0, 30, 60, 90, 120, 150];
// "Wider at speed" is the old view, widest from 75 mph: its ramp ends there (past it nothing moves, held below).
const RAMP_WIDER = [0, 15, 30, 45, 60, 75];

function expectCloser(widths, jumps, label) {
  for (let i = 1; i < widths.length; i++) expect(widths[i], `${label}: ${widths.join(' → ')}`).toBeLessThan(widths[i - 1]);
  expect(widths[0]).toBeCloseTo(2 * mz.R_WIDE, 0);
  expect(widths[widths.length - 1]).toBeCloseTo(2 * mz.R_CLOSE, 0);
  expect(jumps, `${label}: jumps`).toEqual([]);
}
function expectWider(widths, jumps, label) {
  for (let i = 1; i < widths.length; i++) expect(widths[i], `${label}: ${widths.join(' → ')}`).toBeGreaterThan(widths[i - 1]);
  expect(widths[0]).toBeCloseTo(2 * mz.R_CLOSE, 0);
  expect(widths[widths.length - 1]).toBeCloseTo(2 * mz.R_WIDE, 0);
  expect(jumps, `${label}: jumps`).toEqual([]);
}
function expectFixed(widths, label) {
  for (const w of widths) expect(w, `${label}: ${widths.join(' → ')}`).toBeCloseTo(2 * mz.R_FIXED, 0);
}

async function openRig(page, settings = {}, { drive = false } = {}) {
  const feed = { payload: atSpeed(0) };
  await page.route(/^https?:\/\/(?!localhost:8889)/, (route) => route.abort());
  await page.route('http://localhost:8889/racing-desk/', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(feed.payload) }));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(DASHBOARD);
  await page.evaluate((s) => { Object.assign(_settings, s); _settings.showWebGL = false; applySettings(); }, settings);
  if (drive) await page.evaluate(() => setDriveMode(true));
  await frames(page);
  return feed;
}

test('the rig\'s HUD: by default the view closes in up a speed ramp and opens out down it, step by step and never in a jump, with the car at the centre', async ({ page }) => {
  test.setTimeout(180000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const feed = await openRig(page);
  expect((await view(page)).mode).toBe('closer');
  const up = await ramp(page, feed, RAMP);
  expectCloser(up.widths, up.jumps, 'up');
  const down = await ramp(page, feed, [...RAMP].reverse());
  expectWider(down.widths, down.jumps, 'down');
  const v = await view(page);
  expect(v.across).toBeCloseTo(0.5, 1);
  expect(v.down).toBeCloseTo(0.5, 1);
  expect(v.width).toBeCloseTo(v.height, 1);
  expect(errors).toEqual([]);
});

test('the rig\'s HUD: "wider at speed" is the old view (widest from 75 mph), "fixed" is one view; a change of the setting takes effect in place', async ({ page }) => {
  test.setTimeout(180000);
  const feed = await openRig(page, { followMapZoom: 'wider' });
  expect((await view(page)).mode).toBe('wider');
  const up = await ramp(page, feed, RAMP_WIDER);
  expectWider(up.widths, up.jumps, 'wider, up');
  // Past 75 mph the old view had nothing more to give: it stays at its widest.
  const past = await ramp(page, feed, [110, 150]);
  for (const w of past.widths) expect(w).toBeCloseTo(2 * mz.R_WIDE, 1);
  expect(past.jumps).toEqual([]);
  await page.evaluate(() => { _settings.followMapZoom = 'fixed'; applySettings(); });
  const fixed = await ramp(page, feed, [0, 75, 150]);
  expectFixed(fixed.widths, 'fixed');
  await page.evaluate(() => { _settings.followMapZoom = 'closer'; applySettings(); });
  const closer = await ramp(page, feed, [0, 150]);
  expect(closer.widths[1]).toBeLessThan(closer.widths[0]);
  expect(closer.widths[1]).toBeCloseTo(2 * mz.R_CLOSE, 0);
});

test('the rig\'s glance layout (Ctrl+Shift+F): the same curve, in the cell\'s shape with the car two-thirds down', async ({ page }) => {
  test.setTimeout(180000);
  const feed = await openRig(page, {}, { drive: true });
  await page.waitForFunction(() => document.getElementById('zoomMapSvg').style.getPropertyValue('--px') !== '', null, { timeout: 10000 });
  const up = await ramp(page, feed, [0, 75, 150]);
  expectCloser(up.widths, up.jumps, 'glance, up');
  const v = await view(page);
  expect(v.across).toBeCloseTo(0.5, 1);
  expect(v.down).toBeCloseTo(2 / 3, 1);
});

// How far the car's dot is from where its view puts the middle (the rig's: the centre; the glance layout's: across the
// middle and two-thirds of the way down), in map units, as the page has written both.
const offCentre = (page, down) => page.evaluate((fraction) => {
  const vb = document.getElementById('zoomMapSvg').getAttribute('viewBox').split(/\s+/).map(Number);
  const player = document.getElementById('zoomMapPlayer');
  return {
    x: Math.abs(+player.getAttribute('cx') - (vb[0] + vb[2] / 2)),
    y: Math.abs(+player.getAttribute('cy') - (vb[1] + vb[3] * fraction)),
    box: vb,
  };
}, down);

test('the view\'s box and the car\'s dot are written to a thousandth of a unit: the car does not shimmer against the middle, and at speed the track does not scroll in jerks', async ({ page }) => {
  test.setTimeout(180000);
  const feed = await openRig(page);
  // At the closest the view is 11 units across and scrolls fastest; a step of a tenth is two or three pixels.
  await hold(page, feed, 150);
  for (let i = 0; i < 4; i++) {
    const m = await offCentre(page, 0.5);
    expect(m.x, JSON.stringify(m)).toBeLessThan(0.005);
    expect(m.y, JSON.stringify(m)).toBeLessThan(0.005);
    await frames(page, 2);
  }
  // The box is not on a grid of tenths: at least one of its four numbers has a hundredth or a thousandth in it.
  const box = await page.evaluate(() => document.getElementById('zoomMapSvg').getAttribute('viewBox'));
  expect(box.split(/\s+/).some((n) => /\.\d{3}$/.test(n) && !/\.\d00$/.test(n)), box).toBe(true);
  // The glance layout's: across the middle, two-thirds of the way down.
  await page.evaluate(() => setDriveMode(true));
  await page.waitForFunction(() => document.getElementById('zoomMapSvg').style.getPropertyValue('--px') !== '', null, { timeout: 10000 });
  await hold(page, feed, 150);
  for (let i = 0; i < 4; i++) {
    const m = await offCentre(page, 2 / 3);
    expect(m.x, JSON.stringify(m)).toBeLessThan(0.005);
    expect(m.y, JSON.stringify(m)).toBeLessThan(0.005);
    await frames(page, 2);
  }
});

test('the iPad: told the setting by its server and following it; told a change within its ten-second ask', async ({ page }) => {
  test.setTimeout(180000);
  const t = await telemetry(atSpeed(0));
  const port = await freePort();
  const his = { followMapZoom: 'wider', panelBackground: 90, zoom: 120, remoteServerKey: 'SECRET-remote' };
  await remote.start({ port, host: '127.0.0.1', appDir: OVERLAY, key: 'abcd2345', log: () => {}, telemetryUrl: t.url, displaySettings: () => his });
  try {
    await page.addInitScript(() => { window._displaySettingsEveryMs = 250; try { localStorage.setItem('rd-effects', 'off'); } catch (e) { /* none */ } });
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.goto(`http://127.0.0.1:${port}/`);
    await frames(page);
    await page.waitForFunction(() => document.getElementById('zoomMapSvg').style.getPropertyValue('--px') !== '', null, { timeout: 10000 });
    expect((await view(page)).mode).toBe('wider');
    const up = await ramp(page, t.feed, [0, 40, 75]);
    expectWider(up.widths, up.jumps, 'iPad, wider');
    // He changes it on the desk: the iPad's next ask brings the word, and the view eases the other way.
    his.followMapZoom = 'closer';
    await expect.poll(() => page.evaluate(() => _settings.followMapZoom), { timeout: 10000 }).toBe('closer');
    const after = await hold(page, t.feed, 150);
    expect(after.settled).toBeCloseTo(2 * mz.R_CLOSE, 0);
    expect(after.jumps).toEqual([]);
    // Nothing else of his settings came with it (the zoom is the HUD's own default, not his 120).
    expect(await page.evaluate(() => [_settings.remoteServerKey, _settings.zoom])).toEqual([undefined, 165]);
  } finally {
    await remote.stop();
    await t.close();
  }
});

test('the page OBS draws (/obs): told the setting through the display allowlist, and following it', async ({ page }) => {
  test.setTimeout(180000);
  const t = await telemetry(atSpeed(0));
  const port = await freePort();
  const local = remote.createServer({ loopback: true });
  const his = { followMapZoom: 'fixed', zoom: 100 };
  await local.start({
    port, appDir: OVERLAY, key: remote.newKey(), log: () => {}, telemetryUrl: t.url,
    status: () => ({ inCar: true, hudVisible: true, hudOff: false, hudActions: { seq: 0, recent: [] }, recording: null }),
    displaySettings: () => his,
  });
  try {
    await page.addInitScript(() => { window._displaySettingsEveryMs = 250; window._obsStatusEveryMs = 200; });
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`http://127.0.0.1:${port}${remote.OBS_PATH}`, { waitUntil: 'load' });
    await page.evaluate(() => { _settings.showWebGL = false; applySettings(); });
    await frames(page);
    expect((await view(page)).mode).toBe('fixed');
    const fixed = await ramp(page, t.feed, [0, 150]);
    expectFixed(fixed.widths, 'OBS, fixed');
    his.followMapZoom = 'closer';
    await expect.poll(() => page.evaluate(() => _settings.followMapZoom), { timeout: 10000 }).toBe('closer');
    const closer = await ramp(page, t.feed, [0, 150]);
    expectCloser(closer.widths, closer.jumps, 'OBS, closer');
  } finally {
    await local.stop();
    await t.close();
  }
});
