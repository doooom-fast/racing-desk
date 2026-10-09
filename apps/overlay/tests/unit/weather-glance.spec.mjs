/**
 * The weather page of the pit box in the glance layout (modules/styles/drive-view.css, the pit box's weather rules):
 * what he asked for on 2026-10-01 — "Weather needs to make better use of its space like incidents". The glance layout
 * is the iPad's view, the rig's Ctrl+Shift+F and the iPad dashboard OBS draws.
 *
 * Held here, at every iPad size and on the rig's two screens, in a race and with the strategy engine calling (the pit
 * box at its fullest):
 *   - the header is where the tyres' and the fuel's are: the same rule (the page's ::before) in the same type, at the
 *     top, with the first thing of the page's own below it;
 *   - the values — the air with the sky beside it, the track, the conditions — are sized by the page's own box (it is a
 *     size container of its own, where the pit box's cq units are the whole pit box's), never under the 20px floor, the
 *     air the largest, and larger than the fixed 24px / 20px they were: at an Air on its side the air is 32px or more
 *     and the track 22px or more, and each name is over its value;
 *   - nothing is cropped: the page holds everything, and every piece of text lies inside the page.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { frame, fieldWith } from '../frames.mjs';

const require = createRequire(import.meta.url);
const remote = require('../../remote-server.js');

const OVERLAY = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DASHBOARD = pathToFileURL(path.join(OVERLAY, 'dashboard.html')).href;

const IPADS = [
  [1180, 820, 'Air, landscape'], [820, 1180, 'Air, portrait'], [1366, 1024, '12.9" Pro, landscape'],
  [1024, 768, '9.7", landscape'], [744, 1133, 'mini, portrait'], [1133, 744, 'mini, landscape'], [810, 1080, '10.2", portrait'],
  [1080, 810, '10.2", landscape'],
];
const RIG = [[1920, 1080, 'the rig, 16:9'], [2560, 1080, 'the rig, ultrawide']];

const CALLS = {
  'RacingDesk.Plugin.Strategy.TireHealthState': 2, 'RacingDesk.Plugin.Strategy.TireLapsRemaining': 12,
  'RacingDesk.Plugin.Strategy.FuelHealthState': 2, 'RacingDesk.Plugin.Strategy.FuelLapsRemaining': 6,
  'RacingDesk.Plugin.Strategy.PitWindowOpen': 18, 'RacingDesk.Plugin.Strategy.PitWindowClose': 24,
  'RacingDesk.Plugin.Strategy.StintNumber': 2, 'RacingDesk.Plugin.Strategy.StintLaps': 14,
};
// A race; a race with the engine calling and the track wet (the longer words); imperial units (three digits and °F).
const RACE = (extra = {}) => frame({ order: fieldWith(4), state: 4, mode: 4, start: 7, lap: 12, extra });
const CASES = [
  { name: 'a race', make: () => RACE(), air: '22°C', track: '32°C', conditions: 'Dry' },
  { name: 'a wet race with the strategy engine calling', make: () => RACE({ ...CALLS, 'RacingDesk.Plugin.DS.WeatherWet': 1 }), air: '22°C', track: '32°C', conditions: 'Wet' },
  { name: 'a race in imperial units', make: () => RACE({ 'RacingDesk.Plugin.DS.DisplayUnits': 0, 'RacingDesk.Plugin.DS.AirTemp': 40.6, 'RacingDesk.Plugin.DS.TrackTemp': 48.9 }), air: '105°F', track: '120°F', conditions: 'Dry' },
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
  await remote.start({ port, host: '127.0.0.1', appDir: OVERLAY, key: 'abcd2345', log: () => {}, telemetryUrl: `http://127.0.0.1:${telemetry.address().port}/racing-desk/` });
});
test.afterAll(async () => {
  await remote.stop();
  await new Promise((resolve) => { telemetry.close(resolve); telemetry.closeAllConnections(); });
});

async function frames(page, n = 6) {
  await page.waitForFunction(() => typeof _isIdle !== 'undefined' && _isIdle === false && _pollFrame > 5, null, { timeout: 15000 });
  const before = await page.evaluate(() => _pollFrame);
  await page.waitForFunction((at) => _pollFrame >= at, before + n, { timeout: 15000 });
  await page.waitForTimeout(300);
}

async function openAt(page, width, height, first, rig) {
  payload = first;
  await page.addInitScript(() => { try { localStorage.setItem('rd-effects', 'off'); } catch (e) { /* none */ } });
  await page.setViewportSize({ width, height });
  if (rig) {
    await page.route(/^https?:\/\/(?!localhost:8889)/, (route) => route.abort());
    await page.route('http://localhost:8889/racing-desk/', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) }));
    await page.goto(DASHBOARD);
    await page.evaluate(() => { _settings.showWebGL = false; applySettings(); setDriveMode(true); });
  } else {
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    await page.goto(`http://127.0.0.1:${port}/`);
  }
  await frames(page);
}

// The weather page, measured.
const measure = (page) => page.evaluate(() => {
  const weather = document.getElementById('pbPageWeather');
  // (the fuel page is not drawn in the glance layout since 2026-10-08; the header is held against the datastream's, which is
  // the same one header, --hdr-glance)
  const other = document.querySelector('#datastreamPanel .ds-header');
  const header = (el, pseudo) => {
    const cs = getComputedStyle(el, pseudo || null);
    return { content: cs.content, size: cs.fontSize, weight: cs.fontWeight, caps: cs.textTransform, tracking: cs.letterSpacing, colour: cs.color, align: cs.textAlign };
  };
  const px = (id) => parseFloat(getComputedStyle(document.getElementById(id)).fontSize);
  const box = weather.getBoundingClientRect();
  const cs = getComputedStyle(weather);
  const content = { top: box.top + parseFloat(cs.paddingTop), left: box.left + parseFloat(cs.paddingLeft), width: box.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) };
  // Every piece of text in the page lies inside the page's box (the glyphs' own box: the middle three fifths of a line).
  const cutOff = [];
  const walker = document.createTreeWalker(weather, NodeFilter.SHOW_TEXT);
  let topmost = Infinity;
  const widest = { air: 0, track: 0, conditions: 0 };
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = node.textContent.trim();
    const el = node.parentElement;
    if (!text || !el || el.getClientRects().length === 0) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const q of range.getClientRects()) {
      if (q.width < 1) continue;
      const inset = size * 0.22;
      if (q.left < box.left - 1.5 || q.top + inset < box.top - 1.5 || q.right > box.right + 1.5 || q.bottom - inset > box.bottom + 1.5) {
        cutOff.push(`"${text}" [${Math.round(q.left)},${Math.round(q.top)},${Math.round(q.right)},${Math.round(q.bottom)}] out of [${Math.round(box.left)},${Math.round(box.top)},${Math.round(box.right)},${Math.round(box.bottom)}]`);
      }
      topmost = Math.min(topmost, q.top);
      if (el.id === 'pbAirTemp') widest.air = Math.max(widest.air, q.width);
      if (el.id === 'pbTrackTemp') widest.track = Math.max(widest.track, q.width);
      if (el.id === 'pbConditions') widest.conditions = Math.max(widest.conditions, q.width);
    }
  }
  // The name of a value is the label in the value's own block (the hero's "Air", a row's "Track" or "Conditions").
  const labelOver = (valueId) => {
    const el = document.getElementById(valueId);
    const label = el.parentElement.querySelector('.pb-label').getBoundingClientRect();
    const value = el.getBoundingClientRect();
    return label.bottom <= value.top + 2;
  };
  const slack = Math.max(1, parseFloat(cs.fontSize) * 0.3);
  return {
    header: header(weather, '::before'), fuelHeader: header(other),
    headerLine: parseFloat(getComputedStyle(weather, '::before').fontSize) * 1.2,
    content, topmost,
    air: px('pbAirTemp'), track: px('pbTrackTemp'), conditions: px('pbConditions'), icon: px('pbWeatherIcon'),
    labels: [...weather.querySelectorAll('.pb-label')].map((l) => [l.textContent.trim(), parseFloat(getComputedStyle(l).fontSize)]),
    over: [labelOver('pbAirTemp'), labelOver('pbTrackTemp'), labelOver('pbConditions')],
    text: [document.getElementById('pbAirTemp').textContent, document.getElementById('pbTrackTemp').textContent, document.getElementById('pbConditions').textContent],
    widest,
    holds: weather.scrollHeight <= weather.clientHeight + slack && weather.scrollWidth <= weather.clientWidth + 1,
    container: cs.containerType,
    cutOff,
  };
});

for (const [width, height, what] of [...IPADS, ...RIG]) {
  const rig = RIG.some(([w, h]) => w === width && h === height);
  test(`${width}x${height} (${what}): the weather's header is where the other pages' are, its values as large as the page allows, nothing cropped`, async ({ page }) => {
    test.setTimeout(90000);
    await openAt(page, width, height, CASES[0].make(), rig);
    for (const c of CASES) {
      payload = c.make();
      await frames(page);
      const m = await measure(page);
      const label = `${width}x${height}, ${c.name}`;
      expect(m.text, label).toEqual([c.air, c.track, c.conditions]);
      // The header: the pit box's one rule for its three pages, at the top, the page's own things under it.
      expect(m.header.content, label).toBe('"Weather"');
      const { content: _c, ...weatherType } = m.header;
      const { content: _f, align: _a, ...otherType } = m.fuelHeader;
      delete weatherType.align;
      expect(weatherType, `${label}: the header's type is the other panels' (the datastream's)`).toEqual(otherType);
      expect(m.topmost, `${label}: the first thing of the page's own is under the header`).toBeGreaterThanOrEqual(m.content.top + m.headerLine - 2);
      // The page sizes its own values; each name is over its value; nothing under the floors.
      expect(m.container, label).toBe('size');
      expect(m.over, `${label}: each name over its value`).toEqual([true, true, true]);
      expect(m.air, `${label}: the air`).toBeGreaterThanOrEqual(24);
      expect(m.track, `${label}: the track`).toBeGreaterThanOrEqual(20);
      expect(m.conditions, `${label}: the conditions`).toBeGreaterThanOrEqual(20);
      expect(m.air, `${label}: the air is the largest`).toBeGreaterThanOrEqual(m.track);
      for (const [text, size] of m.labels) expect(size, `${label}: the label "${text}"`).toBeGreaterThanOrEqual(11);
      if (width >= 1180 && width > height) {
        expect(m.air, `${label}: larger than the 24px it was`).toBeGreaterThanOrEqual(32);
        expect(m.track, `${label}: larger than the 20px it was`).toBeGreaterThanOrEqual(22);
      }
      // Nothing cropped.
      expect(m.holds, `${label}: the page holds what it shows`).toBe(true);
      expect(m.cutOff, `${label}: text cut off`).toEqual([]);
      for (const [key, w] of Object.entries(m.widest)) expect(w, `${label}: the ${key} fits across the page`).toBeLessThanOrEqual(m.content.width + 1);
    }
  });
}

// The name over the air ("Air", `.pb-weather-k`) is the glance layout's: the rig's own pit box, its Weather tab, is as it
// was, with no such line (the first cut showed it there too, which made the tab 26px taller).
test("the rig HUD's pit box has no \"Air\" line over its temperature; the glance layout has it", async ({ page }) => {
  test.setTimeout(90000);
  payload = RACE();
  await page.addInitScript(() => { try { localStorage.setItem('rd-effects', 'off'); } catch (e) { /* none */ } });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.route(/^https?:\/\/(?!localhost:8889)/, (route) => route.abort());
  await page.route('http://localhost:8889/racing-desk/', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) }));
  await page.goto(DASHBOARD);
  await page.evaluate(() => { _settings.showWebGL = false; _settings.showPitBox = true; applySettings(); });
  await frames(page);
  const k = () => page.evaluate(() => {
    const el = document.querySelector('#pbPageWeather .pb-weather-k');
    return { display: getComputedStyle(el).display, text: el.textContent };
  });
  expect(await k(), "the rig's own HUD").toEqual({ display: 'none', text: 'Air' });
  await page.evaluate(() => setDriveMode(true));
  await frames(page);
  expect((await k()).display, 'the glance layout').toBe('block');
  await page.evaluate(() => setDriveMode(false));
  await frames(page);
  expect((await k()).display, 'and back on the rig').toBe('none');
});
