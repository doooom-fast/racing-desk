/**
 * The rig's panel for the cars of the real list (packages/car-list/cars.json): every control a car has is a cell,
 * whatever the car — a GTP, an LMP1 car with fourteen dials, a W12 with DRS — and only a control it does not have
 * (NONE) is ever left out. First in Node over every car of the list (the room rule; no browser), then the real
 * dashboard.html, headless, for the cars that need more than one row: the panel and the pedals under it keep their
 * height, every control is a cell with its label and a number or a dash, and nothing is cut off by its cell.
 *
 * The controls are built from the list's own labels and kinds of control (what the host sends has the same shape;
 * the values are made up: the layout does not read them). That every label is whole in the page's own font, Sofia
 * Pro Comp, needs the font: the headless page lets nothing through to the internet, so its fallback is half as wide
 * again, and the width of text is only held to where it holds in any font. With RD_REAL_FONT=1 the page lets through
 * the HUD's own Typekit stylesheet and its font files (and nothing else) and holds every label and value to its cell
 * for the cars it opens; RD_FIT_ALL=1 opens all of the list (about three minutes) instead of the cars that need it.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { MOCK_TELEMETRY } from '../helpers.mjs';

const require = createRequire(import.meta.url);
const { KEY, view, arrange, labelPlan } = require('../../modules/js/car-controls.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD = pathToFileURL(path.resolve(__dirname, '..', '..', 'dashboard.html')).href;
const LIST = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', '..', '..', 'packages', 'car-list', 'cars.json'), 'utf8'));
const REAL_FONT = process.env.RD_REAL_FONT === '1';
const ALL = process.env.RD_FIT_ALL === '1';

// What the host would send for a car of the list: the three, the car's other controls in the list's order, DRS and
// push-to-pass. A dial the list gives has a number (the bias a five-character one, which is the widest); a mode, its
// word; a control the list does not have, NONE.
function controlsFromList(car) {
  const dial = (control, label) => ({ id: control.id, label, state: 'value', value: 3, text: control.id === 'brakeBias' ? '47.25' : '3', ...(control.id === 'mode' ? { text: 'TRACK' } : {}) });
  const primary = (id, having, label) => {
    if (having === 'none') return { id, label, state: 'none', text: 'NONE' };
    const control = car.controls.find((c) => c.id.toLowerCase() === id.toLowerCase());
    if (control) return dial(control, control.label || label);
    const mode = car.controls.find((c) => c.id === 'mode' && (!c.covers || c.covers.includes(id)));
    if (mode) return { id, label, state: 'mode', by: mode.label || mode.id };
    return having === 'fixed' ? { id, label, state: 'on', text: 'ON' } : null;
  };
  const out = { car: car.path, name: car.name, kind: car.kind };
  const abs = primary('abs', car.abs, 'ABS'), tc = primary('tc', car.tc, 'TC'), bb = primary('brakeBias', car.brakeBias, 'BB');
  if (abs) out.abs = abs;
  if (tc) out.tc = tc;
  if (bb) out.bb = bb;
  const more = [];
  for (const control of car.controls) {
    const id = control.id.toLowerCase();
    if (['abs', 'tc', 'brakebias', 'drs', 'p2p'].includes(id)) continue;
    more.push(dial(control, control.label || control.id));
  }
  out.more = more;
  for (const control of car.controls) {
    if (/^drs$/i.test(control.id)) out.drs = { id: 'drs', label: control.label || 'DRS', state: 'off', value: 0, text: 'OFF' };
    if (/^p2p$/i.test(control.id)) out.p2p = { id: 'p2p', label: control.label || 'P2P', state: 'off', value: 0, text: 'OFF', count: 200 };
  }
  return out;
}

const realCells = (v) => v.primary.filter((c) => !c.hidden && c.state !== 'none').length + v.modes.length + v.more.filter((c) => c.state !== 'none').length;

test.describe('the room rule over every car of the list', () => {
  test('the list is read', () => {
    expect(LIST.cars.length).toBeGreaterThan(150);
  });

  test('every control a car has is shown; only a NONE cell is ever omitted, and none makes a row of its own', () => {
    const steps = { 1: new Set(), 2: new Set(), 3: new Set() };
    for (const car of LIST.cars) {
      const v = view(controlsFromList(car));
      const fit = arrange(v);
      const nones = new Set([...v.primary.filter((p) => p.state === 'none').map((p) => p.slot), ...v.more.filter((m) => m.state === 'none').map((m) => m.id)]);
      expect(fit.omitted.filter((k) => !nones.has(k)), `${car.path}: a control the car has is left out`).toEqual([]);
      expect(fit.shown.length + fit.omitted.length, car.path).toBe(v.primary.filter((p) => !p.hidden).length + v.modes.length + v.more.length);
      // Every real cell is shown, DRS and push-to-pass among them.
      for (const m of v.more.filter((m) => m.state !== 'none')) expect(fit.shown, `${car.path}: ${m.label}`).toContain(m.id);
      expect(realCells(v), car.path).toBeLessThanOrEqual(fit.rows * fit.cols);
      expect(fit.rows, car.path).toBeLessThanOrEqual(3);
      // NONE cells never change the shape: the car without them would have the same rows and size.
      const without = arrange({ ...v, primary: v.primary.map((p) => (p.state === 'none' ? { ...p, hidden: true } : p)), more: v.more.filter((m) => m.state !== 'none') });
      expect([fit.rows, fit.compact, fit.tight], `${car.path}: a NONE cell made the panel bigger`).toEqual([without.rows, without.compact, without.tight]);
      steps[fit.rows].add(`${fit.cols}${fit.tight ? 't' : fit.compact ? 'c' : 'f'}`);
    }
    // The shapes the list's cars take: one row of two or three; two rows of two to four; three rows of four and of five.
    expect([...steps[1]].sort()).toEqual(['2f', '3f']);
    expect([...steps[2]].sort()).toEqual(['2f', '3f', '4c']);
    expect([...steps[3]].sort()).toEqual(['4t', '5t']);
  });

  test('a label is one line unless one would be set under 8px; two lines never read as one word cut in half', () => {
    for (const car of LIST.cars) {
      const v = view(controlsFromList(car));
      const fit = arrange(v);
      const all = [...v.primary.filter((p) => !p.hidden), ...v.modes, ...v.more].filter((c) => fit.shown.includes(c.slot || c.id || 'mode'));
      for (const cell of all) {
        const plan = labelPlan(cell.label, cell.locked, fit);
        if (plan.lines === 2) {
          expect(cell.label.split(/\s+/).length, `${car.path}: ${cell.label}`).toBeGreaterThan(1);
          expect(plan.len, `${car.path}: ${cell.label}`).toBeLessThan(cell.label.length);
        }
      }
    }
  });
});

// ── The page ──

async function openWith(page, payload) {
  await page.route(/^https?:\/\//, (route) => {
    // Nothing leaves the machine, but for the HUD's own font under RD_REAL_FONT=1: its stylesheet and font files.
    if (REAL_FONT && /(^|\.)typekit\.net$/.test(new URL(route.request().url()).hostname)) return route.continue();
    return route.abort();
  });
  await page.addInitScript((first) => {
    window.__feed = { payload: first };
    const realFetch = window.fetch;
    window.fetch = function (url) {
      if (!/^http:\/\/localhost:8889\/racing-desk\/$/.test(String(url))) return realFetch.apply(this, arguments);
      return Promise.resolve(new Response(JSON.stringify(window.__feed.payload), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    };
  }, payload);
  await page.goto(DASHBOARD, { waitUntil: 'load' });
  // The cells ease into their sizes (.ctrl-item transitions everything): measured here at the size they settle to.
  await page.addStyleTag({ content: '.car-controls, .car-controls * { transition: none !important; }' });
}

const withControls = (cc) => ({ ...MOCK_TELEMETRY, [KEY]: cc, 'DataCorePlugin.GameData.CarModel': cc.name });

// The panel as the page lays it out for the car it was last fed: the cells shown, what each says, and what is cut.
const measure = (page) => page.evaluate(() => {
  const root = document.querySelector('.car-controls');
  const r = root.getBoundingClientRect();
  const pedals = document.querySelector('.pedals-area').getBoundingClientRect();
  const textW = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); return rg.getBoundingClientRect().width; };
  const lines = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); return new Set([...rg.getClientRects()].map((q) => Math.round(q.top))).size; };
  const cells = [...root.querySelectorAll('.ctrl-item, .ctrl-mini')].filter((el) => getComputedStyle(el).display !== 'none').map((el) => {
    const label = el.querySelector('.ctrl-label, .ctrl-mini-label'), value = el.querySelector('.ctrl-value, .ctrl-mini-value');
    const b = el.getBoundingClientRect(), lb = label.getBoundingClientRect(), vb = value.getBoundingClientRect();
    const two = label.classList.contains('ctrl-label-2l');
    return {
      label: label.textContent, value: value.textContent, none: el.classList.contains('ctrl-none') || el.classList.contains('ctrl-mini-none'),
      inside: b.left >= r.left - 0.5 && b.right <= r.right + 0.5 && b.top >= r.top - 0.5 && b.bottom <= r.bottom + 0.5,
      clipped: el.scrollHeight > el.clientHeight + 1,
      labelCut: two ? (lines(label) > 2 || textW(label) > lb.width + 0.05) : textW(label) > lb.width + 0.05,
      valueCut: textW(value) > vb.width + 0.05,
      two, labelPx: parseFloat(getComputedStyle(label).fontSize),
    };
  });
  return { rows: root.getAttribute('data-ctrl-rows'), cols: root.style.getPropertyValue('--ctrl-cols'), panelH: r.height, pedalsH: pedals.height, cells };
});

test.describe('the rig\'s panel, for the real list\'s cars that need more than one row', () => {
  test('every control is a cell with its label and a value, the panel and the pedals keep their height, nothing is cut off by its cell', async ({ page }) => {
    test.setTimeout(ALL ? 600000 : 180000);
    // The cars that need it: more than three real cells (a second row or more), the cars that would wrap a label, and
    // three cars of one row for the reference height.
    const chosen = LIST.cars.filter((car) => {
      if (ALL) return true;
      const v = view(controlsFromList(car));
      const fit = arrange(v);
      return realCells(v) > 3 || [...v.primary.filter((p) => !p.hidden), ...v.modes, ...v.more].some((c) => labelPlan(c.label, c.locked, fit).lines === 2);
    });
    const ones = LIST.cars.filter((car) => realCells(view(controlsFromList(car))) <= 1).slice(0, 3);
    expect(chosen.length).toBeGreaterThan(40);
    expect(ones).toHaveLength(3);

    const first = ones[0];
    await openWith(page, withControls(controlsFromList(first)));
    await expect.poll(() => page.evaluate(() => !!document.querySelector('.car-controls.ctrl-fit'))).toBe(true);
    if (REAL_FONT) {
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(2500);
      expect(await page.evaluate(() => document.fonts.check('600 10px sofia-pro-comp')), 'Sofia Pro Comp is not loaded: the HUD\'s Typekit stylesheet did not arrive').toBe(true);
    }
    const feed = async (car) => {
      await page.evaluate((p) => { window.__feed.payload = p; window.__f0 = _pollFrame; }, withControls(controlsFromList(car)));
      await page.waitForFunction(() => _pollFrame > window.__f0 + 3, null, { timeout: 5000 });
      await page.waitForTimeout(120);
      return measure(page);
    };

    // The height of one row is the reference (the HUD's zoom and the cells' sizes ease into place: read it still).
    let ref = await feed(first);
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(250);
      const now = await measure(page);
      if (Math.abs(now.panelH - ref.panelH) < 0.5 && Math.abs(now.pedalsH - ref.pedalsH) < 0.5) { ref = now; break; }
      ref = now;
    }
    for (const car of ones.slice(1)) {
      const m = await feed(car);
      expect(Math.abs(m.panelH - ref.panelH), `${car.path}: the panel's height`).toBeLessThanOrEqual(1);
    }

    const problems = [];
    for (const car of chosen) {
      const cc = controlsFromList(car);
      const v = view(cc);
      const m = await feed(car);
      const real = [...v.primary.filter((p) => !p.hidden && p.state !== 'none'), ...v.modes, ...v.more.filter((x) => x.state !== 'none')].map((c) => c.label);
      const shown = m.cells.map((c) => c.label);
      for (const label of real) if (!shown.includes(label)) problems.push(`${car.path}: ${label} is not shown`);
      for (const c of m.cells) {
        if (!c.none && !c.value) problems.push(`${car.path}: ${c.label} has no value or dash`);
        if (!c.inside) problems.push(`${car.path}: ${c.label} is outside the panel`);
        if (c.clipped) problems.push(`${car.path}: ${c.label} is clipped by its cell`);
        if (REAL_FONT && c.labelCut) problems.push(`${car.path}: the label ${c.label} is cut (${c.labelPx}px)`);
        if (REAL_FONT && c.valueCut) problems.push(`${car.path}: the value ${c.value} of ${c.label} is cut`);
      }
      if (Math.abs(m.panelH - ref.panelH) > 1) problems.push(`${car.path}: the panel is ${m.panelH}px, not ${ref.panelH}`);
      if (Math.abs(m.pedalsH - ref.pedalsH) > 1) problems.push(`${car.path}: the pedals are ${m.pedalsH}px, not ${ref.pedalsH}`);
    }
    expect(problems).toEqual([]);
  });
});
