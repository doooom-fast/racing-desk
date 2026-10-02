/**
 * The incidents panel in the glance layout (modules/styles/drive-view.css, the incidents block): what he asked for on
 * 2026-10-01 — "update incidents panel in ipad overlay to match header location of other modules and larger fonts on
 * the data". The glance layout is the iPad's view, the rig's Ctrl+Shift+F and the iPad dashboard OBS draws.
 *
 * Held here, at every iPad size and on the rig's two screens, in a race, in a race with two digits, with both limits
 * hit and with a DQ limit alone, in a test drive (no limits) and in a long one (three and four digits):
 *   - the header is where the other panels' headers are and in the one style every panel's header has (he chose one
 *     style on 2026-10-02: dashboard.css, "One header for every panel"): the same offset from the top and the left of
 *     its panel as the datastream's beside it, the same size, weight, case (none: sentence case), tracking and colour
 *     as the datastream's and the leaderboard's, aligned left, the topmost thing in the panel;
 *   - the numbers are as large as the cell allows: the count the lesser of what the cell's height leaves it (40 %; 66 %
 *     with no limits under it) and what its width does (72 % less 18px for two digits, 52 % less 14px for three, 40 %
 *     less 12px for four), the penalty and DQ counts the lesser of 14.7 % of the height and 27 % of the width, never
 *     under 20px, their labels 11px or more; and what the cell allows is what is drawn: a two-digit count, a
 *     three-digit one, a long test drive, all with the x beside them inside the card;
 *   - nothing is cropped: the inner card holds everything, and every piece of text lies inside the panel.
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
];
const RIG = [[1920, 1080, 'the rig, 16:9'], [2560, 1080, 'the rig, ultrawide']];

// A race with a penalty at 17 and a DQ at 25 (the frame's limits): four incidents; fourteen; thirty, both hit; twenty-two
// with a DQ limit alone. A test drive, none: two incidents, a hundred and twenty, a thousand two hundred and thirty-four.
const RACE = (incidents = 4, extra = {}) => frame({ order: fieldWith(4), state: 4, mode: 4, start: 7, lap: 12, incidents, extra });
const TEST_DRIVE = (incidents = 2) => frame({
  order: fieldWith(1, []), session: 'Offline Testing', mode: 1, state: 4, start: 0, lap: 3, incidents,
  extra: { 'RacingDesk.Plugin.DS.IsNonRaceSession': 1, 'RacingDesk.Plugin.Grid.TotalCars': 1 },
});
const CASES = [
  { name: 'a race', make: () => RACE(4), count: '4', rows: ['Penalty in 13', 'DQ in 21'] },
  { name: 'a race, two digits', make: () => RACE(14), count: '14', rows: ['Penalty in 3', 'DQ in 11'] },
  { name: 'a race with both limits hit', make: () => RACE(30), count: '30', rows: ['Penalty in Penalty', 'DQ in DQ'], hit: true },
  { name: 'a race with a DQ limit alone', make: () => RACE(22, { 'RacingDesk.Plugin.DS.IncidentLimitPenalty': 0 }), count: '22', rows: ['DQ in 3'] },
  { name: 'a test drive', make: () => TEST_DRIVE(2), count: '2', rows: [], noLimits: true },
  { name: 'a long test drive', make: () => TEST_DRIVE(120), count: '120', rows: [], noLimits: true },
  { name: 'a very long test drive', make: () => TEST_DRIVE(1234), count: '1234', rows: [], noLimits: true },
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

// The iPad's page through the server; the rig's own Ctrl+Shift+F from the file.
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

// The panel, measured.
const measure = (page) => page.evaluate(() => {
  const panel = document.getElementById('incidentsPanel');
  const inner = panel.querySelector('.inc-inner');
  const label = panel.querySelector('.inc-label');
  const ds = document.getElementById('datastreamPanel');
  const dsHeader = ds.querySelector('.ds-header');
  const type = (el) => {
    if (!el || el.getClientRects().length === 0) return null;
    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize);
    const track = parseFloat(cs.letterSpacing);
    return { size, tracking: cs.letterSpacing, trackingEm: Number.isFinite(track) ? track / size : 0, colour: cs.color, weight: cs.fontWeight, caps: cs.textTransform, align: cs.textAlign, family: cs.fontFamily };
  };
  const offset = (el, within) => { const a = el.getBoundingClientRect(), b = within.getBoundingClientRect(); return { top: a.top - b.top, left: a.left - b.left }; };
  // The first match that is showing (with a DQ limit alone the penalty's row is not).
  const px = (sel) => { const el = [...panel.querySelectorAll(sel)].find((e) => e.getClientRects().length > 0); return el ? parseFloat(getComputedStyle(el).fontSize) : null; };
  const cell = panel.getBoundingClientRect();
  // Every piece of text in the panel lies inside the panel's box (the glyphs' own box: the middle three fifths of a line).
  const cutOff = [];
  const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
  let topmost = Infinity, topmostText = '';
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = node.textContent.trim();
    const el = node.parentElement;
    if (!text || !el || el.getClientRects().length === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const size = parseFloat(cs.fontSize);
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const q of range.getClientRects()) {
      if (q.width < 1) continue;
      const inset = size * (size >= 60 ? 0.3 : 0.22);
      if (q.left < cell.left - 1.5 || q.top + inset < cell.top - 1.5 || q.right > cell.right + 1.5 || q.bottom - inset > cell.bottom + 1.5) cutOff.push(`"${text}" [${Math.round(q.left)},${Math.round(q.top)},${Math.round(q.right)},${Math.round(q.bottom)}] out of [${Math.round(cell.left)},${Math.round(cell.top)},${Math.round(cell.right)},${Math.round(cell.bottom)}]`);
      if (q.top < topmost) { topmost = q.top; topmostText = text; }
    }
  }
  const slack = Math.max(1, parseFloat(getComputedStyle(inner).fontSize) * 0.3);
  const rowsShown = [...panel.querySelectorAll('.inc-thresh-row')].filter((r) => r.getClientRects().length > 0).map((r) => [...r.children].map((c) => c.textContent.trim()).join(' '));
  // The count and its x lie across the card's inside, in the row they are in.
  const row = panel.querySelector('.inc-value-row');
  const count = panel.querySelector('.inc-count');
  const x = panel.querySelector('.inc-x');
  const rowGap = parseFloat(getComputedStyle(row).columnGap) || 0;
  const reference = (sel) => type(document.querySelector(sel));
  return {
    cell: { w: cell.width, h: cell.height },
    header: { ...type(label), ...offset(label, panel), text: label.textContent.trim() },
    dsHeader: { ...type(dsHeader), ...offset(dsHeader, ds) },
    // The leaderboard's header, the other one in the HUD's older style, when there is a leaderboard (not in a test drive).
    lbHeader: reference('#leaderboardPanel .lb-header'),
    count: px('.inc-count'), x: px('.inc-x'), thresh: px('.inc-thresh-val'), threshLabel: px('.inc-thresh-row'),
    thresholdsShown: panel.querySelector('.inc-thresholds').style.display !== 'none',
    rows: rowsShown,
    overflow: inner.scrollWidth > inner.clientWidth + 1 || inner.scrollHeight > inner.clientHeight + slack ? `${inner.scrollWidth}x${inner.scrollHeight} in ${inner.clientWidth}x${inner.clientHeight}` : null,
    rowOver: count.offsetWidth + x.offsetWidth + rowGap - row.clientWidth,
    cutOff, topmostText,
    countText: count.textContent,
    digits: panel.dataset.digits || null,
    noLimits: panel.classList.contains('inc-no-limits'),
  };
});

// What the stylesheet gives the count and the penalty / DQ counts at a cell's size (the rules in drive-view.css).
const countFor = (m, c) => {
  const digits = c.count.length;
  const wide = digits <= 2 ? 0.72 * m.cell.w - 18 : digits === 3 ? 0.52 * m.cell.w - 14 : 0.40 * m.cell.w - 12;
  return Math.max(20, Math.min((c.noLimits ? 0.66 : 0.40) * m.cell.h, wide));
};
const threshFor = (m) => Math.max(20, Math.min(0.147 * m.cell.h, 0.27 * m.cell.w));

for (const size of [...IPADS, ...RIG]) {
  const [width, height, what] = size;
  const rig = RIG.includes(size);
  test(`${width}x${height} (${what}): the header is where the others are, in the HUD's type; the numbers fill the cell; nothing is cropped`, async ({ page }) => {
    test.setTimeout(120000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openAt(page, width, height, RACE(), rig);
    for (const c of CASES) {
      payload = c.make();
      await frames(page);
      const m = await measure(page);
      const label = `${width}x${height}, ${c.name}`;
      // The header: where the datastream's is, at its size.
      expect(m.header.text, label).toBe('Incidents');
      expect(Math.abs(m.header.top - m.dsHeader.top), `${label}: the header's offset from the top of its panel (${m.header.top} vs the datastream's ${m.dsHeader.top})`).toBeLessThanOrEqual(1);
      expect(Math.abs(m.header.left - m.dsHeader.left), `${label}: the header's offset from the left of its panel (${m.header.left} vs the datastream's ${m.dsHeader.left})`).toBeLessThanOrEqual(1);
      expect(m.header.size, `${label}: the header's size`).toBeCloseTo(m.dsHeader.size, 1);
      expect(m.header.weight, label).toBe(m.dsHeader.weight);
      expect(m.header.caps, label).toBe('none');
      expect(m.header.align, label).toBe('left');
      expect(m.header.family, label).toBe(m.dsHeader.family);
      expect(m.header.size).toBeGreaterThanOrEqual(11);
      expect(m.topmostText, `${label}: the header is the first thing in the panel`).toBe('Incidents');
      // The one header style: the datastream's, and the leaderboard's when there is one, at one size in this layout.
      expect(m.header.tracking, label).toBe(m.dsHeader.tracking);
      expect(m.header.colour, label).toBe(m.dsHeader.colour);
      expect(m.header.trackingEm, label).toBeCloseTo(0.04, 3);
      if (m.lbHeader) {
        expect(m.header.trackingEm, `${label}: the header's tracking against the leaderboard's`).toBeCloseTo(m.lbHeader.trackingEm, 3);
        expect(m.header.colour, `${label}: the header's colour against the leaderboard's`).toBe(m.lbHeader.colour);
      }
      // The numbers, as large as the cell allows.
      expect(m.countText, label).toBe(c.count);
      expect(m.noLimits, label).toBe(!!c.noLimits);
      expect(m.digits, label).toBe(String(Math.min(4, c.count.length)));
      const countFloor = countFor(m, c);
      expect(m.count, `${label}: the count at ${m.count}px in a ${Math.round(m.cell.w)}x${Math.round(m.cell.h)} cell, its floor ${countFloor.toFixed(1)}`).toBeGreaterThanOrEqual(countFloor - 0.5);
      expect(m.count).toBeGreaterThanOrEqual(20);
      expect(m.x).toBeGreaterThanOrEqual(20);
      // ...and the count with its x is across the card's inside, not out over its padding.
      expect(m.rowOver, `${label}: the count and its x are ${m.rowOver.toFixed(1)}px wider than the card's inside`).toBeLessThanOrEqual(0.5);
      if (c.noLimits) {
        expect(m.thresholdsShown, label).toBe(false);
      } else {
        expect(m.thresholdsShown, label).toBe(true);
        expect(m.rows, label).toEqual(c.rows);
        if (!c.hit) {
          expect(m.thresh, `${label}: a threshold's number at ${m.thresh}px`).toBeGreaterThanOrEqual(threshFor(m) - 0.5);
        } else {
          // A limit hit is a word, read at a label's size: 14px or more.
          expect(m.thresh, `${label}: the word at ${m.thresh}px`).toBeGreaterThanOrEqual(14);
        }
        expect(m.threshLabel, label).toBeGreaterThanOrEqual(11);
      }
      // Nothing cropped.
      expect(m.overflow, `${label}: the inner card overflows`).toBeNull();
      expect(m.cutOff, `${label}: text cut off`).toEqual([]);
    }
    expect(errors).toEqual([]);
  });
}
