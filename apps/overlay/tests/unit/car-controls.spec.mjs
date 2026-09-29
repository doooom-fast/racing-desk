/**
 * The car's controls by the canonical list (modules/js/car-controls.js): what the host sends as
 * RacingDesk.Plugin.CarControls, and what the HUD makes of it — each of the three as NONE, OFF, ON, a value or a
 * mode, with the car's own label; the car's other controls in a row of their own; DRS and push-to-pass with the
 * spotter's word. First the module by itself, in Node; then the real dashboard.html, headless, fed a payload.
 * Without the key the panel is as it was before there was a list, which is what the golden frames hold it to.
 *
 * The cars are not typed here. They are read from fixtures/car-controls-wire.json, which the host's own tests
 * (RacingDesk.Tests, Cars/CarControlsWireTests.cs) hold to what RacingDesk.Core writes: change what the host sends
 * and that test fails until the file is rewritten, and this one then runs against the new shape.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { MOCK_TELEMETRY } from '../helpers.mjs';

const require = createRequire(import.meta.url);
const { KEY, read, view, signals, textOf, fillOf, announced } = require('../../modules/js/car-controls.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD = pathToFileURL(path.resolve(__dirname, '..', '..', 'dashboard.html')).href;
const WIRE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'car-controls-wire.json'), 'utf8'));

// What the host sends for the fixture's cars (see the file above for what each shows).
const GTP = WIRE['porsche963gtp'];              // ABS none; TCLO/TCLA, MIG, the bars; a fixed setup holds the traction control
const MCLAREN_570S = WIRE['mclaren570sgt4'];    // one dial for ABS, traction and stability: TRACK
const MX5 = WIRE['mx5 mx52016'];                // ABS on, the rest none
const M2 = WIRE['bmwm2csr'];                    // DSC is a word: ON; MDM and OFF below
const M2_MDM = WIRE['bmwm2csr mdm'];
const M2_OFF = WIRE['bmwm2csr off'];
const GT3 = WIRE['madeup gt3'];                 // ABS off, held; TC1 4
const FORMULA = WIRE['madeup formula'];         // ABS none, TC none, BBAL; DRS off, push-to-pass waiting with 65
const DRS = [FORMULA, WIRE['madeup formula drs 1'], WIRE['madeup formula drs 2'], WIRE['madeup formula drs 3']];
const P2P_ON = WIRE['madeup formula p2p on'];

const withControls = (cc, extra = {}) => ({ ...MOCK_TELEMETRY, [KEY]: cc, 'DataCorePlugin.GameData.CarModel': cc.name, ...extra });
const drs = (status) => DRS[status];
const p2p = (active, count) => ({ ...FORMULA, p2p: { ...(active ? P2P_ON.p2p : FORMULA.p2p), count, text: active ? 'ON' : String(count) } });

// ── The module by itself ──

test.describe('the fixture', () => {
  test('is the shape the tests below go by', () => {
    for (const [name, cc] of Object.entries(WIRE)) {
      expect(typeof cc.car, name).toBe('string');
      for (const slot of ['abs', 'tc', 'bb']) expect(['none', 'on', 'off', 'value', 'mode'], `${name} ${slot}`).toContain(cc[slot].state);
    }
    expect(Object.keys(WIRE).length).toBeGreaterThanOrEqual(12);
  });
});

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

test.describe('textOf, fillOf, announced: what a reading shows', () => {
  test('the host\'s text, or its number, or a dash for one that says nothing', () => {
    expect(textOf({ text: 'TRACK', value: 0 })).toBe('TRACK');
    expect(textOf({ value: 4 })).toBe('4');
    expect(textOf({ value: 0 })).toBe('0');
    expect(textOf({ text: '', value: 5 })).toBe('5');
    expect(textOf({ value: NaN })).toBe('—');
    expect(textOf({ value: '4' })).toBe('—');
    expect(textOf({})).toBe('—');
    expect(textOf(null)).toBe('—');
  });

  test('a bar is filled by a value and by nothing else', () => {
    for (const state of ['none', 'on', 'off', 'mode']) expect(fillOf({ state, value: 8, fill: 1 }, 'tc'), state).toBe(0);
    expect(fillOf({ state: 'value', value: 8, fill: 0.25 }, 'tc')).toBe(0.25);
    expect(fillOf({ state: 'value', value: 8, fill: 7 }, 'tc')).toBe(1);
    expect(fillOf({ state: 'value', value: 8, fill: -1 }, 'tc')).toBe(0);
    // Without the host's own fill, the bars the HUD always drew.
    expect(fillOf({ state: 'value', value: 50 }, 'bb')).toBe(0.5);
    expect(fillOf({ state: 'value', value: 90 }, 'bb')).toBe(1);
    expect(fillOf({ state: 'value', value: 6 }, 'tc')).toBe(0.5);
    expect(fillOf({ state: 'value', value: 30 }, 'abs')).toBe(1);
    expect(fillOf({ state: 'value', value: 3 }, 'arbFront')).toBe(0);
    // A position with a name is not a quantity: the number behind MDM does not fill a bar.
    expect(fillOf({ state: 'value', value: 1, text: 'MDM' }, 'tc')).toBe(0);
    expect(fillOf({ state: 'value', value: 6, text: '6' }, 'tc')).toBe(0.5);
    expect(fillOf({ state: 'value', value: 54.5, text: '54.5' }, 'bb')).toBeCloseTo(0.6125, 4);
    expect(fillOf({ state: 'value', text: 'MDM' }, 'tc')).toBe(0);
    expect(fillOf(null, 'tc')).toBe(0);
  });

  test('the spotter\'s value: the text as shown, else the number, else nothing', () => {
    expect(announced({ text: 'SPORT', value: 1 })).toBe('SPORT');
    expect(announced({ value: 6 })).toBe('6');
    expect(announced({ value: 0 })).toBe('0');
    expect(announced({})).toBe('');
    expect(announced(null)).toBe('');
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
    expect(v.primary[0].fill).toBeCloseTo(0.412, 3);
    expect(v.primary[2].fill).toBe(0);
    expect(v.modes).toEqual([]);
    expect(v.more.map((c) => [c.id, c.label, c.text])).toEqual([['brakeMigration', 'MIG', '-2'], ['tc2', 'TCLA', '4'], ['arbFront', 'FARB', '1'], ['arbRear', 'RARB', '15']]);
    expect(v.more[0].fill).toBeCloseTo(0.333, 3);
    expect(v.more[2].fill).toBe(0);
  });

  test('brake migration, traction control slip and gain, and the anti-roll bars are cells of their own, locked as the host says', () => {
    const more = Object.fromEntries(view(GTP).more.map((c) => [c.id, c]));
    expect(more.brakeMigration).toEqual(expect.objectContaining({ label: 'MIG', text: '-2', value: -2, locked: false }));
    expect(more.tc2).toEqual(expect.objectContaining({ label: 'TCLA', text: '4', value: 4, locked: true }));
    expect(more.arbFront).toEqual(expect.objectContaining({ label: 'FARB', text: '1', locked: false }));
    expect(more.arbRear).toEqual(expect.objectContaining({ label: 'RARB', text: '15', locked: false }));
  });

  test('a mode stands in for the cells it covers', () => {
    const v = view(MCLAREN_570S);
    expect(v.primary.map((c) => [c.slot, c.state, c.hidden, c.by])).toEqual([['bb', 'none', false, null], ['tc', 'mode', true, 'ESC'], ['abs', 'mode', true, 'ESC']]);
    expect(v.modes).toEqual([expect.objectContaining({ id: 'mode', label: 'ESC', text: 'TRACK', state: 'value', value: 0 })]);
    expect(v.more).toEqual([]);
  });

  test('a dial that is a word shows the word, and its off position is OFF', () => {
    const v = view(M2);
    expect(v.primary.map((c) => [c.label, c.text, c.state])).toEqual([['BB', 'NONE', 'none'], ['DSC', 'ON', 'value'], ['ABS', 'ON', 'on']]);
    expect(view(M2_MDM).primary[1]).toEqual(expect.objectContaining({ label: 'DSC', text: 'MDM', state: 'value', fill: 0 }));
    expect(view(M2_OFF).primary[1]).toEqual(expect.objectContaining({ label: 'DSC', text: 'OFF', state: 'off', fill: 0 }));
  });

  test('ON for ABS the driver cannot turn, OFF for a dial at its off position', () => {
    expect(view(MX5).primary.map((c) => [c.label, c.text, c.state])).toEqual([['BB', 'NONE', 'none'], ['TC', 'NONE', 'none'], ['ABS', 'ON', 'on']]);
    const gt3 = view(GT3);
    expect(gt3.primary[2]).toEqual(expect.objectContaining({ label: 'ABS', text: 'OFF', state: 'off', fill: 0, locked: true }));
    expect(gt3.primary[1]).toEqual(expect.objectContaining({ label: 'TC1', text: '4', locked: true }));
    expect(gt3.primary[0]).toEqual(expect.objectContaining({ label: 'BB', text: '56.2', locked: false }));
  });

  test('a formula car has neither ABS nor traction control, and its bias has a name of its own', () => {
    expect(view(FORMULA).primary.map((c) => [c.label, c.text, c.state])).toEqual([['BBAL', '55.0', 'value'], ['TC', 'NONE', 'none'], ['ABS', 'NONE', 'none']]);
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
    expect(view(drs(1)).more[0]).toEqual(expect.objectContaining({ text: 'NEXT', ready: true, active: false }));
    expect(view(drs(2)).more[0]).toEqual(expect.objectContaining({ text: 'READY', ready: true, active: false }));
    expect(view(drs(3)).more[0]).toEqual(expect.objectContaining({ text: 'OPEN', ready: false, active: true }));
    expect(view(p2p(true, 64)).more[1]).toEqual(expect.objectContaining({ text: 'ON', active: true, count: 64 }));
  });

  test('a car with no DRS and no push-to-pass has neither cell, whatever else it has', () => {
    for (const cc of [GTP, MCLAREN_570S, MX5, M2, GT3]) expect(view(cc).more.filter((c) => c.id === 'drs' || c.id === 'p2p'), cc.car).toEqual([]);
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
    expect(signals(drs(0), null)).toEqual([]);
  });

  test('push-to-pass: on with the seconds left, off, used up', () => {
    expect(signals(p2p(false, 65), p2p(true, 64))).toEqual([{ msg: 'OT on — 64s left', severity: 'sp-clear', header: 'Push to pass', category: 'p2p' }]);
    expect(signals(p2p(true, 40), p2p(false, 40))).toEqual([{ msg: 'OT off — 40s left', severity: 'sp-warn', header: 'Push to pass', category: 'p2p' }]);
    expect(signals(p2p(true, 1), p2p(false, 0))).toEqual([expect.objectContaining({ msg: 'OT off — 0s left' })]);
    expect(signals(p2p(false, 1), p2p(false, 0))).toEqual([{ msg: 'OT used up', severity: 'sp-danger', header: 'Push to pass', category: 'p2p' }]);
    expect(signals(p2p(false, 65), p2p(false, 65))).toEqual([]);
    expect(signals(p2p(false, undefined), p2p(true, undefined))).toEqual([expect.objectContaining({ msg: 'OT on' })]);
  });

  test('a car without the systems says nothing of them', () => {
    expect(signals(GTP, { ...GTP, tc: { ...GTP.tc, value: 6, text: '6' } })).toEqual([]);
    expect(signals(MX5, MX5)).toEqual([]);
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
    // (the two that flash a change come and go with the clock)
    classes: [...el.classList].filter((c) => !['ctrl-item', 'ctrl-mini', 'ctrl-changed', 'ctrl-flash-out'].includes(c)).sort(),
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
const glow = (page) => page.evaluate(() => ({
  abs: document.getElementById('ctrlABS').classList.contains('ctrl-active'),
  tc: document.getElementById('ctrlTC').classList.contains('ctrl-active'),
}));

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
    // Traction control's second dial is held by the fixed setup as the first is; the migration and the bars are his.
    expect(p.more.map((c) => c.classes.includes('ctrl-mini-locked'))).toEqual([false, true, false, false]);
  });

  test('the same car sent as text, as the WebSocket feed sends it, is the same panel', async ({ page }) => {
    await openWith(page, withControls(JSON.stringify(GTP), { 'DataCorePlugin.GameData.CarModel': GTP.name }));
    await expect(page.locator('#ctrlTC .ctrl-label')).toHaveText('TCLO');
    const p = await panel(page);
    expect(p.cells.map((c) => [c.label, c.value])).toEqual([['BB', '48.25'], ['TCLO', '5'], ['ABS', 'NONE']]);
    expect(p.more.map((c) => c.label)).toEqual(['MIG', 'TCLA', 'FARB', 'RARB']);
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

  test('a formula car: no ABS, no traction control, and the bias by its own name', async ({ page }) => {
    await openWith(page, withControls(FORMULA));
    await expect(page.locator('#ctrlBB .ctrl-label')).toHaveText('BBAL');
    const p = await panel(page);
    expect(p.cells.map((c) => [c.id, c.label, c.value, c.classes])).toEqual([
      ['ctrlBB', 'BBAL', '55.0', []], ['ctrlTC', 'TC', 'NONE', ['ctrl-none']], ['ctrlABS', 'ABS', 'NONE', ['ctrl-none']],
    ]);
    expect(p.cells.every((c) => c.shown)).toBe(true);
    expect(p.noAdj).toBe(false);
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

  test('a dial that is a word: ON, then MDM by name, then OFF, each announced with the car\'s word', async ({ page }) => {
    await openWith(page, withControls(M2));
    await expect(page.locator('#ctrlTC .ctrl-label')).toHaveText('DSC');
    let p = await panel(page);
    expect(p.cells.map((c) => [c.label, c.value, c.classes])).toEqual([['BB', 'NONE', ['ctrl-none']], ['DSC', 'ON', []], ['ABS', 'ON', ['ctrl-on']]]);

    await serve(page, withControls(M2_MDM));
    await expect(page.locator('#ctrlTC .ctrl-value')).toHaveText('MDM');
    p = await panel(page);
    expect(p.cells[1].valueClasses).toEqual(['ctrl-value-fixed']);
    expect(p.cells[1].pct, 'a name is not a quantity: no bar').toBe('0%');
    await serve(page, withControls(M2_OFF));
    await expect(page.locator('#ctrlTC .ctrl-value')).toHaveText('OFF');
    p = await panel(page);
    expect(p.cells[1].classes).toEqual(['ctrl-off']);
    expect(p.cells[1].pct).toBe('0%');
    await expect.poll(() => spotter(page).then((s) => s.filter((c) => c.header === 'Adjustment').map((c) => c.msg)))
      .toEqual(expect.arrayContaining(['DSC ▼ OFF']));
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

  test('the anti-roll bars are announced by their own names', async ({ page }) => {
    await openWith(page, withControls(GTP));
    await expect(page.locator('[data-id="arbRear"] .ctrl-mini-value')).toHaveText('15');
    const bars = (front, rear) => withControls({ ...GTP, more: GTP.more.map((m) => m.id === 'arbFront' ? { ...m, value: front, text: String(front) } : m.id === 'arbRear' ? { ...m, value: rear, text: String(rear) } : m) });
    await serve(page, bars(2, 14));
    await expect(page.locator('[data-id="arbRear"] .ctrl-mini-value')).toHaveText('14');
    await expect.poll(() => spotter(page).then((s) => s.map((c) => c.msg))).toEqual(expect.arrayContaining(['FARB ▲ 2', 'RARB ▼ 14']));
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

  test('a car with neither shows neither, and the spotter is left alone by what it publishes', async ({ page }) => {
    // Every car publishes the push-to-pass variables; the host says nothing of them for a car that has none.
    await openWith(page, withControls(GTP, { 'DataCorePlugin.GameRawData.Telemetry.P2P_Status': 1, 'DataCorePlugin.GameRawData.Telemetry.P2P_Count': 65, 'DataCorePlugin.GameRawData.Telemetry.DRS_Status': 2 }));
    await expect(page.locator('#ctrlTC .ctrl-label')).toHaveText('TCLO');
    const p = await panel(page);
    expect(p.more.map((c) => c.id)).toEqual(['brakeMigration', 'tc2', 'arbFront', 'arbRear']);
    expect((await spotter(page)).filter((c) => c.header === 'DRS' || c.header === 'Push to pass')).toEqual([]);
  });

  test('the glow that says an aid is cutting in is there for a car in the list and one that is not', async ({ page }) => {
    test.setTimeout(30000);
    // The data stream module lights the same two cells (datastream.js). Here it is taken out, so that what is held
    // is the controls' own glow: it must not depend on the car being one the list does not have.
    await openWith(page, withControls(GT3, { 'RacingDesk.Plugin.DS.AbsActive': 1, 'RacingDesk.Plugin.DS.TcActive': 1 }));
    await page.evaluate(() => { window.updateDatastream = () => {}; });
    await serve(page, withControls(GT3));
    await expect.poll(() => glow(page)).toEqual({ abs: false, tc: false });
    await serve(page, withControls(GT3, { 'RacingDesk.Plugin.DS.AbsActive': 1, 'RacingDesk.Plugin.DS.TcActive': 1 }));
    await expect.poll(() => glow(page)).toEqual({ abs: true, tc: true });
    await serve(page, withControls(GT3, { 'RacingDesk.Plugin.DS.AbsActive': 0, 'RacingDesk.Plugin.DS.TcActive': 0 }));
    await expect.poll(() => glow(page)).toEqual({ abs: false, tc: false });

    // The same, with no list to go by.
    await serve(page, { ...MOCK_TELEMETRY, 'RacingDesk.Plugin.DS.AbsActive': 1 });
    await expect.poll(() => glow(page)).toEqual({ abs: true, tc: false });
    await serve(page, MOCK_TELEMETRY);
    await expect.poll(() => glow(page)).toEqual({ abs: false, tc: false });
  });

  test('another car in the list starts clean: no flash, no word from the spotter, and nothing of the last car\'s left', async ({ page }) => {
    await openWith(page, withControls(MCLAREN_570S));
    await expect(page.locator('#ctrlMode .ctrl-value')).toHaveText('TRACK');
    await serve(page, withControls(GT3));
    await expect(page.locator('#ctrlABS .ctrl-value')).toHaveText('OFF');
    const p = await panel(page);
    expect(p.cells.map((c) => [c.id, c.label, c.value, c.shown])).toEqual([
      ['ctrlBB', 'BB', '56.2', true], ['ctrlTC', 'TC1', '4', true], ['ctrlABS', 'ABS', 'OFF', true],
    ]);
    expect(p.more.map((c) => [c.id, c.label, c.value])).toEqual([['throttleMap', 'MAP', '2']]);
    // Give the spotter time to say something it should not.
    await page.waitForTimeout(400);
    expect((await spotter(page)).filter((c) => c.header === 'Adjustment')).toEqual([]);

    await serve(page, withControls(FORMULA));
    await expect(page.locator('#ctrlBB .ctrl-label')).toHaveText('BBAL');
    expect((await panel(page)).more.map((c) => c.id)).toEqual(['drs', 'p2p']);
    await page.waitForTimeout(400);
    expect((await spotter(page)).filter((c) => c.header === 'Adjustment')).toEqual([]);
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

    // and from a car with a mode: its cell goes, and the cells it covered are shown again
    await serve(page, withControls(MCLAREN_570S));
    await expect(page.locator('#ctrlMode .ctrl-value')).toHaveText('TRACK');
    await serve(page, MOCK_TELEMETRY);
    await expect(page.locator('#ctrlTC .ctrl-value')).toHaveText('4');
    const back = await panel(page);
    expect(back.cells.map((c) => [c.id, c.label, c.value, c.shown])).toEqual([['ctrlBB', 'BB', '56.2', true], ['ctrlTC', 'TC', '4', true], ['ctrlABS', 'ABS', '3', true]]);
  });

  test('a car the list does not have is shown as it always was, and nothing is made up', async ({ page }) => {
    // What such a car publishes raw: a dial the sim calls ABS at 0 and traction control at 0, and the DRS and
    // push-to-pass variables every car has. Nothing says which of them is real, so nothing is said.
    const unlisted = {
      ...MOCK_TELEMETRY,
      'DataCorePlugin.GameData.CarModel': 'Some Car The List Has Not Met',
      'DataCorePlugin.GameRawData.Telemetry.dcABS': 0,
      'DataCorePlugin.GameRawData.Telemetry.dcTractionControl': 0,
      'DataCorePlugin.GameRawData.Telemetry.DRS_Status': 2,
      'DataCorePlugin.GameRawData.Telemetry.P2P_Status': 1,
      'DataCorePlugin.GameRawData.Telemetry.P2P_Count': 65,
    };
    await openWith(page, unlisted);
    await expect(page.locator('#ctrlABS .ctrl-value')).toHaveText('Off');
    const p = await panel(page);
    expect(p.listed).toBe(false);
    expect(p.cells.map((c) => [c.label, c.value])).toEqual([['BB', '56.2'], ['TC', 'Off'], ['ABS', 'Off']]);
    for (const cell of p.cells) expect(cell.classes.filter((c) => /^ctrl-(none|on|off|mode|locked)$/.test(c)), cell.label).toEqual([]);
    expect(p.hasMore).toBe(false);
    expect(await page.evaluate(() => [...document.querySelectorAll('.car-controls *')].some((e) => /^NONE$/.test((e.children.length ? '' : e.textContent).trim())))).toBe(false);
    await page.waitForTimeout(300);
    expect((await spotter(page)).filter((c) => c.header === 'DRS' || c.header === 'Push to pass')).toEqual([]);
  });

  test('a car the old table knows to have none of them keeps its cells hidden, as before', async ({ page }) => {
    await openWith(page, { ...MOCK_TELEMETRY, 'DataCorePlugin.GameData.CarModel': 'Formula Vee' });
    await expect(page.locator('#ctrlTC')).toHaveClass(/ctrl-hidden/);
    const p = await panel(page);
    expect(p.listed).toBe(false);
    expect(p.cells.map((c) => [c.id, c.classes.includes('ctrl-hidden')])).toEqual([['ctrlBB', false], ['ctrlTC', true], ['ctrlABS', true]]);
  });

  test('a key that is not the car\'s controls is not believed', async ({ page }) => {
    await openWith(page, { ...MOCK_TELEMETRY, [KEY]: '{ not json', 'DataCorePlugin.GameData.CarModel': 'Some Car The List Has Not Met' });
    await expect(page.locator('#ctrlBB .ctrl-value')).toHaveText('56.2');
    let p = await panel(page);
    expect(p.listed).toBe(false);
    expect(p.cells.map((c) => [c.label, c.value])).toEqual([['BB', '56.2'], ['TC', '4'], ['ABS', '3']]);
    await serve(page, { ...MOCK_TELEMETRY, [KEY]: { car: '' } });
    await serve(page, { ...MOCK_TELEMETRY, [KEY]: ['porsche963gtp'] });
    await page.waitForTimeout(150);
    p = await panel(page);
    expect(p.listed).toBe(false);
    expect(p.hasMore).toBe(false);
  });
});
