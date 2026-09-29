/**
 * The car's controls by the canonical list (modules/js/car-controls.js): what the host sends as
 * RacingDesk.Plugin.CarControls, and what the HUD makes of it — each of the three as NONE, OFF, ON, a value or a
 * mode, with the car's own label; the car's other controls in a row of their own; DRS and push-to-pass with the
 * spotter's word. First the module by itself, in Node; then the real dashboard.html, headless, fed a payload.
 * Without the key the panel is as it was before there was a list, which is what the golden frames hold it to.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { MOCK_TELEMETRY } from '../helpers.mjs';

const require = createRequire(import.meta.url);
const { KEY, read, view, signals } = require('../../modules/js/car-controls.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD = pathToFileURL(path.resolve(__dirname, '..', '..', 'dashboard.html')).href;

// What the host sends for four cars — the shape RacingDesk.Core.Cars.CarControlsState.ToJson() writes.
const GTP = {
  car: 'porsche963gtp', name: 'Porsche 963 GTP', kind: 'prototype', fixedSetup: true,
  abs: { id: 'abs', label: 'ABS', state: 'none', text: 'NONE' },
  tc: { id: 'tc', label: 'TCLO', state: 'value', value: 5, text: '5', fill: 0.364, locked: true, var: 'dcTractionControl' },
  bb: { id: 'brakeBias', label: 'BB', state: 'value', value: 48.25, text: '48.25', fill: 0.41, var: 'dcBrakeBias' },
  more: [
    { id: 'brakeMigration', label: 'MIG', state: 'value', value: -2, text: '-2', fill: 0.333, var: 'dcABS' },
    { id: 'tc2', label: 'TCLA', state: 'value', value: 4, text: '4', fill: 0.27, locked: true, var: 'dcTractionControl2' },
    { id: 'arbFront', label: 'FARB', state: 'value', value: 1, text: '1', var: 'dcAntiRollFront' },
    { id: 'arbRear', label: 'RARB', state: 'value', value: 15, text: '15', var: 'dcAntiRollRear' },
  ],
};
const MCLAREN_570S = {
  car: 'mclaren570sgt4', name: 'McLaren 570S GT4', kind: 'gt', fixedSetup: false,
  abs: { id: 'abs', label: 'ABS', state: 'mode', by: 'ESC' },
  tc: { id: 'tc', label: 'TC', state: 'mode', by: 'ESC' },
  bb: { id: 'brakeBias', label: 'BB', state: 'none', text: 'NONE' },
  more: [{ id: 'mode', label: 'ESC', state: 'value', value: 0, text: 'TRACK', var: 'dcABS' }],
};
const MX5 = {
  car: 'mx5 mx52016', name: 'Mazda MX-5 Cup', kind: 'touring', fixedSetup: true,
  abs: { id: 'abs', label: 'ABS', state: 'on', text: 'ON' },
  tc: { id: 'tc', label: 'TC', state: 'none', text: 'NONE' },
  bb: { id: 'brakeBias', label: 'BB', state: 'none', text: 'NONE' },
};
const FORMULA = {
  car: 'madeup formula', name: 'Made-up Formula', kind: 'formula', fixedSetup: false,
  abs: { id: 'abs', label: 'ABS', state: 'none', text: 'NONE' },
  tc: { id: 'tc', label: 'TC', state: 'none', text: 'NONE' },
  bb: { id: 'brakeBias', label: 'BBAL', state: 'value', value: 55, text: '55.0', var: 'dcBrakeBias' },
  drs: { id: 'drs', label: 'DRS', state: 'off', value: 0, text: 'OFF', active: false, var: 'DRS_Status' },
  p2p: { id: 'p2p', label: 'OT', state: 'off', value: 0, text: '65', count: 65, active: false, var: 'P2P_Status' },
};
const GT3 = {
  car: 'madeup gt3', name: 'Made-up GT3', kind: 'gt', fixedSetup: true,
  abs: { id: 'abs', label: 'ABS', state: 'off', value: 0, text: 'OFF', locked: true, var: 'dcABS' },
  tc: { id: 'tc', label: 'TC1', state: 'value', value: 4, text: '4', fill: 0.333, locked: true, var: 'dcTractionControl' },
  bb: { id: 'brakeBias', label: 'BB', state: 'value', value: 56.2, text: '56.2', fill: 0.56, var: 'dcBrakeBias' },
  more: [{ id: 'throttleMap', label: 'MAP', state: 'value', value: 2, text: '2', var: 'dcThrottleShape' }],
};

const withControls = (cc, extra = {}) => ({ ...MOCK_TELEMETRY, [KEY]: cc, 'DataCorePlugin.GameData.CarModel': cc.name, ...extra });
const drs = (value, active = value === 3) => ({ ...FORMULA, drs: { ...FORMULA.drs, state: value ? 'value' : 'off', value, active, text: ['OFF', 'NEXT', 'READY', 'OPEN'][value] } });
const p2p = (active, count) => ({ ...FORMULA, p2p: { ...FORMULA.p2p, state: active ? 'value' : 'off', active, count, text: active ? 'ON' : String(count) } });

// ── The module by itself ──

test.describe('read: what the host sent', () => {
  test('the key, as an object or as its text', () => {
    expect(read(withControls(GTP))).toEqual({ ...GTP });
    expect(read({ [KEY]: JSON.stringify(GTP) })).toEqual({ ...GTP });
    expect(read({ [KEY]: MX5 })).toEqual({ ...MX5, more: [] });
  });

  test('nothing sent, or nothing that is the car\'s controls: null', () => {
    expect(read(MOCK_TELEMETRY)).toBeNull();
    expect(read(null)).toBeNull();
    expect(read({ [KEY]: '{ not json' })).toBeNull();
    expect(read({ [KEY]: 'porsche963gtp' })).toBeNull();
    expect(read({ [KEY]: { name: 'no car' } })).toBeNull();
    expect(read({ [KEY]: [] })).toBeNull();
  });

  test('a reading that is not one is left out; the rest is kept', () => {
    const cc = read({ [KEY]: { car: 'x', abs: 'none', tc: 4, bb: { state: 'none' }, more: [{ id: 'tc2' }, 'mode', { label: 'no id' }, null], fixedSetup: 'yes' } });
    expect(cc).toEqual({ car: 'x', name: '', kind: '', bb: { state: 'none' }, more: [{ id: 'tc2' }] });
  });
});

test.describe('view: the panel, cell by cell', () => {
  test('NONE, a value with the car\'s label, and the car\'s other controls in the list\'s order', () => {
    const v = view(GTP);
    expect(v.primary.map((c) => [c.slot, c.label, c.text, c.state, c.hidden, c.locked])).toEqual([
      ['bb', 'BB', '48.25', 'value', false, false],
      ['tc', 'TCLO', '5', 'value', false, true],
      ['abs', 'ABS', 'NONE', 'none', false, false],
    ]);
    expect(v.primary[1].fill).toBeCloseTo(0.364, 3);
    expect(v.primary[0].fill).toBeCloseTo(0.41, 3);
    expect(v.modes).toEqual([]);
    expect(v.more.map((c) => [c.id, c.label, c.text])).toEqual([['brakeMigration', 'MIG', '-2'], ['tc2', 'TCLA', '4'], ['arbFront', 'FARB', '1'], ['arbRear', 'RARB', '15']]);
    expect(v.more[0].fill).toBeCloseTo(0.333, 3);
  });

  test('a mode stands in for the cells it covers', () => {
    const v = view(MCLAREN_570S);
    expect(v.primary.map((c) => [c.slot, c.state, c.hidden, c.by])).toEqual([['bb', 'none', false, null], ['tc', 'mode', true, 'ESC'], ['abs', 'mode', true, 'ESC']]);
    expect(v.modes).toEqual([expect.objectContaining({ id: 'mode', label: 'ESC', text: 'TRACK', state: 'value', value: 0 })]);
    expect(v.more).toEqual([]);
  });

  test('ON for ABS the driver cannot turn, OFF for a dial at its off position', () => {
    expect(view(MX5).primary.map((c) => [c.label, c.text, c.state])).toEqual([['BB', 'NONE', 'none'], ['TC', 'NONE', 'none'], ['ABS', 'ON', 'on']]);
    const gt3 = view(GT3);
    expect(gt3.primary[2]).toEqual(expect.objectContaining({ label: 'ABS', text: 'OFF', state: 'off', fill: 0, locked: true }));
    expect(gt3.primary[1]).toEqual(expect.objectContaining({ label: 'TC1', text: '4', locked: true }));
    expect(gt3.primary[0]).toEqual(expect.objectContaining({ label: 'BB', text: '56.2', locked: false }));
  });

  test('a cell the host said nothing of shows a dash and its usual label', () => {
    const v = view({ car: 'x', name: '', kind: '', more: [] });
    expect(v.primary.map((c) => [c.label, c.text, c.state])).toEqual([['BB', '—', 'unknown'], ['TC', '—', 'unknown'], ['ABS', '—', 'unknown']]);
  });

  test('the bar is the host\'s fill, or the one the HUD always drew', () => {
    const v = view({ car: 'x', more: [], bb: { state: 'value', value: 50 }, tc: { state: 'value', value: 6 }, abs: { state: 'value', value: 3, fill: 0.9 } });
    expect(v.primary.map((c) => c.fill)).toEqual([0.5, 0.5, 0.9]);
    expect(v.primary.map((c) => c.text)).toEqual(['50', '6', '3']);
  });

  test('DRS and push-to-pass come last, with whether they are ready or on', () => {
    const off = view(FORMULA);
    expect(off.more.map((c) => [c.id, c.label, c.text, c.state, c.active, c.ready, c.count])).toEqual([
      ['drs', 'DRS', 'OFF', 'off', false, false, null],
      ['p2p', 'OT', '65', 'off', false, false, 65],
    ]);
    expect(view(drs(2)).more[0]).toEqual(expect.objectContaining({ text: 'READY', ready: true, active: false }));
    expect(view(drs(3)).more[0]).toEqual(expect.objectContaining({ text: 'OPEN', ready: false, active: true }));
    expect(view(p2p(true, 64)).more[1]).toEqual(expect.objectContaining({ text: 'ON', active: true, count: 64 }));
  });
});

test.describe('signals: the spotter\'s word', () => {
  test('DRS: detected, then open it, then open', () => {
    expect(signals(drs(0), drs(1))).toEqual([{ msg: 'DRS next zone', severity: 'sp-warn', header: 'DRS', category: 'drs' }]);
    expect(signals(drs(1), drs(2))).toEqual([{ msg: 'DRS — open it', severity: 'sp-clear', header: 'DRS', category: 'drs' }]);
    expect(signals(drs(0), drs(2))).toEqual([expect.objectContaining({ msg: 'DRS — open it' })]);
    expect(signals(drs(2), drs(3))).toEqual([{ msg: 'DRS open', severity: 'sp-clear', header: 'DRS', category: 'drs' }]);
    expect(signals(drs(3), drs(0))).toEqual([]);
    expect(signals(drs(2), drs(2))).toEqual([]);
  });

  test('nothing is said of a first frame, nor of another car\'s last', () => {
    expect(signals(null, drs(2))).toEqual([]);
    expect(signals({ ...drs(0), car: 'another' }, drs(2))).toEqual([]);
    expect(signals(GTP, GTP)).toEqual([]);
  });

  test('push-to-pass: on with the seconds left, off, used up', () => {
    expect(signals(p2p(false, 65), p2p(true, 64))).toEqual([{ msg: 'OT on — 64s left', severity: 'sp-clear', header: 'Push to pass', category: 'p2p' }]);
    expect(signals(p2p(true, 40), p2p(false, 40))).toEqual([{ msg: 'OT off — 40s left', severity: 'sp-warn', header: 'Push to pass', category: 'p2p' }]);
    expect(signals(p2p(true, 1), p2p(false, 0))).toEqual([expect.objectContaining({ msg: 'OT off — 0s left' })]);
    expect(signals(p2p(false, 1), p2p(false, 0))).toEqual([{ msg: 'OT used up', severity: 'sp-danger', header: 'Push to pass', category: 'p2p' }]);
    expect(signals(p2p(false, 65), p2p(false, 65))).toEqual([]);
    expect(signals(p2p(false, undefined), p2p(true, undefined))).toEqual([expect.objectContaining({ msg: 'OT on' })]);
  });
});

// ── The page ──

// The dashboard over a plugin that serves whatever it was last given. No port is reached.
async function openWith(page, payload) {
  await page.route(/^https?:\/\//, (route) => route.abort());
  await page.addInitScript((first) => {
    window.__feed = { payload: first };
    const realFetch = window.fetch;
    window.fetch = function (url) {
      if (!/^http:\/\/localhost:8889\/racing-desk\/$/.test(String(url))) return realFetch.apply(this, arguments);
      return Promise.resolve(new Response(JSON.stringify(window.__feed.payload), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    };
  }, payload);
  await page.goto(DASHBOARD, { waitUntil: 'load' });
}
const serve = (page, payload) => page.evaluate((p) => { window.__feed.payload = p; }, payload);

// The panel as drawn: each cell's label, value and the classes the styles go by.
const panel = (page) => page.evaluate(() => {
  const cell = (el) => ({
    id: el.id || el.getAttribute('data-id'),
    label: (el.querySelector('.ctrl-label, .ctrl-mini-label') || {}).textContent,
    value: (el.querySelector('.ctrl-value, .ctrl-mini-value') || {}).textContent,
    classes: [...el.classList].filter((c) => c !== 'ctrl-item' && c !== 'ctrl-mini').sort(),
    valueClasses: [...((el.querySelector('.ctrl-value') || { classList: [] }).classList)].filter((c) => c !== 'ctrl-value').sort(),
    shown: getComputedStyle(el).display !== 'none',
    pct: el.style.getPropertyValue('--ctrl-pct'),
    width: Math.round(el.getBoundingClientRect().width),
  });
  const root = document.querySelector('.car-controls');
  return {
    listed: root.classList.contains('car-controls-listed'),
    noAdj: root.classList.contains('no-adj'),
    cells: [...root.querySelectorAll('.ctrl-item')].map(cell),
    more: [...root.querySelectorAll('.ctrl-mini')].map(cell),
    hasMore: !!document.getElementById('ctrlMore'),
  };
});
const spotter = (page) => page.evaluate(() => [...document.querySelectorAll('#spotterStack .sp-inner')].map((c) => ({
  header: c.querySelector('.sp-header').textContent, msg: c.querySelector('.sp-message').textContent, cat: c.getAttribute('data-spot-cat'), adj: c.getAttribute('data-adj-type'),
})));

test.describe('the page', () => {
  test('a GTP car: ABS none, the dials by the car\'s own names, the rest in a row beneath', async ({ page }) => {
    await openWith(page, withControls(GTP));
    await expect(page.locator('#ctrlTC .ctrl-label')).toHaveText('TCLO');
    const p = await panel(page);
    expect(p.listed).toBe(true);
    expect(p.noAdj).toBe(false);
    expect(p.cells.map((c) => [c.id, c.label, c.value, c.shown])).toEqual([
      ['ctrlBB', 'BB', '48.25', true], ['ctrlTC', 'TCLO', '5', true], ['ctrlABS', 'ABS', 'NONE', true],
    ]);
    expect(p.cells[1].classes).toEqual(['ctrl-locked']);
    expect(p.cells[1].pct).toBe('36%');
    expect(p.cells[2].classes).toEqual(['ctrl-none']);
    expect(p.cells[2].valueClasses).toEqual(['ctrl-value-fixed']);
    // The cells' widths ease into place (.ctrl-item transitions everything): NONE ends up as wide as the word.
    await expect.poll(async () => { const q = await panel(page); return q.cells[2].width / q.cells[1].width; }).toBeLessThan(0.75);
    expect(p.hasMore).toBe(true);
    expect(p.more.map((c) => [c.id, c.label, c.value])).toEqual([['brakeMigration', 'MIG', '-2'], ['tc2', 'TCLA', '4'], ['arbFront', 'FARB', '1'], ['arbRear', 'RARB', '15']]);
  });

  test('a car whose dial is a mode shows the mode, and the cells it covers take no space', async ({ page }) => {
    await openWith(page, withControls(MCLAREN_570S));
    await expect(page.locator('#ctrlMode .ctrl-value')).toHaveText('TRACK');
    const p = await panel(page);
    expect(p.cells.map((c) => [c.id, c.label, c.value, c.shown])).toEqual([
      ['ctrlBB', 'BB', 'NONE', true], ['ctrlTC', 'TC', '—', false], ['ctrlABS', 'ABS', '—', false], ['ctrlMode', 'ESC', 'TRACK', true],
    ]);
    expect(p.cells[3].classes).toEqual(['ctrl-mode']);
    expect(p.cells[3].valueClasses).toEqual(['ctrl-value-fixed']);
    expect(p.hasMore).toBe(false);
  });

  test('ABS the driver cannot turn is ON; a car with nothing to turn reads NONE, not "no adjustments"', async ({ page }) => {
    await openWith(page, withControls(MX5));
    await expect(page.locator('#ctrlABS .ctrl-value')).toHaveText('ON');
    const p = await panel(page);
    expect(p.cells.map((c) => [c.label, c.value, c.classes])).toEqual([['BB', 'NONE', ['ctrl-none']], ['TC', 'NONE', ['ctrl-none']], ['ABS', 'ON', ['ctrl-on']]]);
    expect(p.noAdj).toBe(false);
    expect(p.hasMore).toBe(false);
  });

  test('ABS off in a fixed setup is OFF, and marked as held', async ({ page }) => {
    await openWith(page, withControls(GT3));
    await expect(page.locator('#ctrlABS .ctrl-value')).toHaveText('OFF');
    const p = await panel(page);
    expect(p.cells[2].classes).toEqual(['ctrl-locked', 'ctrl-off']);
    expect(p.cells[2].pct).toBe('0%');
    expect(p.cells[1].classes).toEqual(['ctrl-locked']);
    expect(p.cells[0].classes).toEqual([]);
    expect(p.more.map((c) => [c.label, c.value])).toEqual([['MAP', '2']]);
  });

  test('a change is flashed and announced with the car\'s own word', async ({ page }) => {
    await openWith(page, withControls(GTP));
    await expect(page.locator('#ctrlTC .ctrl-value')).toHaveText('5');
    await serve(page, withControls({ ...GTP, tc: { ...GTP.tc, value: 6, text: '6' }, more: [{ ...GTP.more[0], value: -1, text: '-1' }, ...GTP.more.slice(1)] }));
    await expect(page.locator('#ctrlTC .ctrl-value')).toHaveText('6');
    await expect.poll(() => spotter(page)).toEqual(expect.arrayContaining([
      expect.objectContaining({ header: 'Adjustment', msg: 'TCLO ▲ 6', adj: 'tc' }),
      expect.objectContaining({ header: 'Adjustment', msg: 'MIG ▲ -1', adj: 'brakeMigration' }),
    ]));
    expect(await page.evaluate(() => document.querySelector('[data-id="brakeMigration"]').classList.contains('ctrl-mini-changed'))).toBe(true);

    await serve(page, withControls({ ...MCLAREN_570S, more: [{ ...MCLAREN_570S.more[0], value: 1, text: 'SPORT' }] }));
    await expect(page.locator('#ctrlMode .ctrl-value')).toHaveText('SPORT');
    await serve(page, withControls(MCLAREN_570S));
    await expect(page.locator('#ctrlMode .ctrl-value')).toHaveText('TRACK');
    await expect.poll(() => spotter(page)).toEqual(expect.arrayContaining([expect.objectContaining({ msg: 'ESC ▼ TRACK', adj: 'mode' })]));
  });

  test('DRS and push-to-pass: their cells, and the spotter as they change', async ({ page }) => {
    await openWith(page, withControls(FORMULA));
    await expect(page.locator('[data-id="drs"] .ctrl-mini-value')).toHaveText('OFF');
    expect((await panel(page)).more.map((c) => [c.id, c.label, c.value, c.classes])).toEqual([['drs', 'DRS', 'OFF', ['ctrl-mini-off']], ['p2p', 'OT', '65', ['ctrl-mini-off']]]);

    await serve(page, withControls(drs(1)));
    await expect(page.locator('[data-id="drs"] .ctrl-mini-value')).toHaveText('NEXT');
    await expect.poll(() => spotter(page)).toEqual(expect.arrayContaining([expect.objectContaining({ header: 'DRS', msg: 'DRS next zone', cat: 'drs' })]));
    await serve(page, withControls(drs(2)));
    await expect(page.locator('[data-id="drs"]')).toHaveClass(/ctrl-mini-ready/);
    await expect.poll(() => spotter(page).then((s) => s.filter((c) => c.cat === 'drs').map((c) => c.msg))).toEqual(['DRS — open it']);
    await serve(page, withControls(drs(3)));
    await expect(page.locator('[data-id="drs"]')).toHaveClass(/ctrl-mini-active/);
    await expect(page.locator('[data-id="drs"] .ctrl-mini-value')).toHaveText('OPEN');

    await serve(page, withControls(p2p(true, 64)));
    await expect(page.locator('[data-id="p2p"] .ctrl-mini-value')).toHaveText('ON');
    await expect(page.locator('[data-id="p2p"]')).toHaveClass(/ctrl-mini-active/);
    await expect.poll(() => spotter(page).then((s) => s.filter((c) => c.cat === 'p2p').map((c) => c.msg))).toEqual(['OT on — 64s left']);
    const adjustments = (await spotter(page)).filter((c) => c.header === 'Adjustment');
    expect(adjustments).toEqual([]);
  });

  test('without the key the panel is as it was, and a car that leaves the list goes back to it', async ({ page }) => {
    await openWith(page, MOCK_TELEMETRY);
    await expect(page.locator('#ctrlBB .ctrl-value')).toHaveText('56.2');
    const before = await panel(page);
    expect(before.listed).toBe(false);
    expect(before.cells.map((c) => [c.label, c.value, c.classes])).toEqual([['BB', '56.2', []], ['TC', '4', []], ['ABS', '3', []]]);
    expect(before.hasMore).toBe(false);

    await serve(page, withControls(GTP));
    await expect(page.locator('#ctrlTC .ctrl-label')).toHaveText('TCLO');
    await serve(page, MOCK_TELEMETRY);
    await expect(page.locator('#ctrlTC .ctrl-label')).toHaveText('TC');
    const after = await panel(page);
    expect(after.listed).toBe(false);
    expect(after.cells.map((c) => [c.id, c.label, c.value, c.classes])).toEqual(before.cells.map((c) => [c.id, c.label, c.value, c.classes]));
    expect(after.hasMore).toBe(false);
  });
});
