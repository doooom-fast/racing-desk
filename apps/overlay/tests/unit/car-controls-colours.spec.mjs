/**
 * Every adjustment the car has, coloured by what it acts on and with the bar the three always had — he asked on
 * 2026-10-02: "we also need the color coding and um, background scaling for all of these adjustments as well".
 *
 * In Node: every control id of the real list (packages/car-list/cars.json) has a family (car-controls.js familyOf),
 * DRS and push-to-pass none. In the real dashboard.html, headless, fed a payload: each family's colour on the value,
 * the label and the bar, in the dark theme and the light, readable on the glass; the three cells exactly as they always
 * were, with the key and without it; DRS and push-to-pass in their own states; the bar following a value as it changes;
 * no bar for a control the host sends no fill for. Where the bar comes from (the list's ranges, positions that are a
 * scale) is the host's, held in RacingDesk.Tests (Cars/CarControlsFillTests.cs).
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { MOCK_TELEMETRY } from '../helpers.mjs';

const require = createRequire(import.meta.url);
const { KEY, FAMILY, familyOf, view } = require('../../modules/js/car-controls.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD = pathToFileURL(path.resolve(__dirname, '..', '..', 'dashboard.html')).href;
const LIST = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', '..', '..', 'packages', 'car-list', 'cars.json'), 'utf8'));

// The families, and the hue each is drawn in (leaderboard.css, "The controls' colours").
const HUES = { brake: 355, traction: 215, abs: 48, power: 275, chassis: 172, mode: 150 };

// ── Colour arithmetic, for reading what the page computed ──

const hsl = (h, s, l) => {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((x) => Math.round(x * 255));
};
const parse = (css) => {
  const m = String(css).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 };
};
const hueOf = ([r, g, b]) => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return null;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};
const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
const lum = (rgb) => {
  const c = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * c(rgb[0]) + 0.7152 * c(rgb[1]) + 0.0722 * c(rgb[2]);
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const near = (a, b, tol = 1) => a.every((x, i) => Math.abs(x - b[i]) <= tol);

// The glass the cells sit on, at its least kind: the dark panel (6 % grey at nine-tenths) over a bright game, and the
// light theme's panel (94 % at 0.92) over a dark one, each with the cell's own 3 % of white.
const DARK_GLASS = [40, 40, 40];
const LIGHT_GLASS = [219, 219, 223];

// ── The module by itself ──

test.describe('the families', () => {
  test('every control id of the list has one, and DRS and push-to-pass none', () => {
    const ids = new Set();
    for (const car of LIST.cars) for (const c of car.controls || []) ids.add(c.id);
    expect(ids.size).toBeGreaterThan(30);
    const without = [...ids].filter((id) => !/^(drs|p2p)$/i.test(id) && !familyOf(id));
    expect(without, 'a control the list has and the HUD gives no colour (car-controls.js FAMILY)').toEqual([]);
    for (const id of ids) {
      const f = familyOf(id);
      if (/^(drs|p2p)$/i.test(id)) { expect(f, id).toBeNull(); continue; }
      expect(Object.keys(HUES), id).toContain(f.family);
      expect([0, 1, 2, 3], id).toContain(f.shade);
    }
    // Every family the table names is one the stylesheet draws, and is used by the list.
    const used = new Set([...ids].map((id) => familyOf(id)).filter(Boolean).map((f) => f.family));
    for (const [id, [family]] of Object.entries(FAMILY)) expect(Object.keys(HUES), id).toContain(family);
    expect([...used].sort()).toEqual(Object.keys(HUES).sort());
  });

  test('what each control acts on: the brakes, traction, the anti-lock, the engine and the hybrid, the chassis, a mode', () => {
    const of = (id) => { const f = familyOf(id); return f && `${f.family} ${f.shade}`; };
    // The three, by their slot whatever id the list gives them, are each their family's own shade.
    expect([of('bb'), of('tc'), of('abs')]).toEqual(['brake 0', 'traction 0', 'abs 0']);
    expect(['brakeBias', 'brakeBiasFine', 'brakeMigration', 'brakeMigrationGain', 'rearBrakeValve', 'brakeMisc', 'brakeMagic', 'ibs'].map(of))
      .toEqual(['brake 0', 'brake 1', 'brake 2', 'brake 2', 'brake 3', 'brake 1', 'brake 1', 'brake 3']);
    expect(['tc2', 'tc3', 'tc4', 'tcToggle', 'launch', 'esc'].map(of)).toEqual(['traction 1', 'traction 2', 'traction 2', 'traction 3', 'traction 3', 'traction 1']);
    expect(['absToggle'].map(of)).toEqual(['abs 3']);
    expect(['engineMap', 'throttleMap', 'fuelMix', 'engineBraking', 'mguDeploy', 'mguDeployFixed', 'regen', 'boost', 'boostHold', 'fuelCut'].map(of))
      .toEqual(['power 0', 'power 1', 'power 0', 'power 3', 'power 2', 'power 2', 'power 1', 'power 1', 'power 3', 'power 3']);
    expect(['arbFront', 'arbRear', 'diffEntry', 'diffMid', 'diffExit', 'diffPreload', 'weightJacker', 'wingTop', 'powerSteering', 'driveBias'].map(of))
      .toEqual(['chassis 0', 'chassis 0', 'chassis 1', 'chassis 1', 'chassis 1', 'chassis 1', 'chassis 2', 'chassis 2', 'chassis 3', 'chassis 2']);
    expect(of('mode')).toBe('mode 0');
    // Case-blind, as the host compares ids; nothing for what is not an id the table has.
    expect(of('ARBFRONT')).toBe('chassis 0');
    expect([familyOf('drs'), familyOf('p2p'), familyOf('somethingNew'), familyOf('constructor'), familyOf(null)]).toEqual([null, null, null, null, null]);
  });

  test('view gives every cell its family and shade, DRS and push-to-pass none', () => {
    const v = view({ car: 'x', bb: { state: 'value', value: 52 }, tc: { state: 'none' }, abs: { state: 'value', value: 3 },
      more: [{ id: 'arbRear', state: 'value', value: 9 }, { id: 'mode', state: 'value', value: 1, text: 'MDM' }, { id: 'futureDial', state: 'value', value: 1 }],
      drs: { state: 'off', value: 0 }, p2p: { state: 'off', value: 0 } });
    expect(v.primary.map((c) => [c.slot, c.family, c.shade])).toEqual([['bb', 'brake', 0], ['tc', 'traction', 0], ['abs', 'abs', 0]]);
    expect(v.modes.map((c) => [c.id, c.family])).toEqual([['mode', 'mode']]);
    expect(v.more.map((c) => [c.id, c.family, c.shade])).toEqual([['arbRear', 'chassis', 0], ['futureDial', null, null], ['drs', null, null], ['p2p', null, null]]);
  });
});

// ── The page ──

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
  // The colours and the bars are read where they settle (the cells ease everything in).
  await page.addStyleTag({ content: '.car-controls, .car-controls *, .car-controls *::before { transition: none !important; animation: none !important; }' });
}
const serve = (page, payload) => page.evaluate((p) => { window.__feed.payload = p; window.__f0 = _pollFrame; }, payload)
  .then(() => page.waitForFunction(() => _pollFrame > window.__f0 + 2, null, { timeout: 5000 }));
const withControls = (cc) => ({ ...MOCK_TELEMETRY, [KEY]: cc, 'DataCorePlugin.GameData.CarModel': cc.name });

// A made-up car with a control of every family and shade the list uses, as the host would send it.
const dial = (id, value, fill, label = id.toUpperCase()) => ({ id, label, state: 'value', value, text: String(value), ...(fill == null ? {} : { fill }) });
const EVERY = {
  car: 'madeup colours', name: 'Made-up Colours', kind: 'prototype', fixedSetup: false,
  bb: { ...dial('brakeBias', 52, 0.5), label: 'Bias' }, tc: { ...dial('tc', 4, 0.3), label: 'TC' }, abs: { ...dial('abs', 3, 0.2), label: 'ABS' },
  more: [
    dial('brakeBiasFine', 1, 0.6), dial('brakeMigration', 2, 0.4), dial('rearBrakeValve', 3, 0.5),
    dial('tc2', 5, 0.4), dial('tc3', 2, 0.5), dial('tcToggle', 0, 0),
    dial('absToggle', 1, 1),
    dial('engineMap', 2, 0.1), dial('throttleMap', 3, 0.7), dial('mguDeploy', 4, 0.5), dial('engineBraking', 5, 0.4),
    dial('arbFront', 3, 0.5), dial('diffEntry', 4, 0.3), dial('weightJacker', 2, 0.55), dial('powerSteering', 3, 0.5),
    { id: 'mode', label: 'ESC', state: 'value', value: 1, text: 'Sport' },
  ],
  drs: { id: 'drs', label: 'DRS', state: 'off', value: 0, text: 'Off', var: 'DRS_Status', active: false },
  p2p: { id: 'p2p', label: 'OT', state: 'off', value: 0, text: '65', var: 'P2P_Status', active: false, count: 65 },
};

// Each cell as drawn: its family, its shade, and the colours of its value, its label and its bar.
const cells = (page) => page.evaluate(() => [...document.querySelectorAll('.car-controls .ctrl-item, .car-controls .ctrl-mini')]
  .filter((el) => !el.classList.contains('ctrl-hidden'))
  .map((el) => {
    const label = el.querySelector('.ctrl-label, .ctrl-mini-label'), value = el.querySelector('.ctrl-value, .ctrl-mini-value');
    const bar = getComputedStyle(el, '::before'), cs = getComputedStyle(el);
    return {
      key: el.id || el.getAttribute('data-id'), family: el.getAttribute('data-ctrl-family'), shade: el.getAttribute('data-ctrl-shade'),
      value: getComputedStyle(value).color, label: getComputedStyle(label).color, bar: bar.backgroundColor,
      // The bar's height and the box it is a share of (the cell's padding box), both in the page's own pixels (the HUD's
      // zoom scales what the screen shows, not these).
      pct: el.style.getPropertyValue('--ctrl-pct'), barH: parseFloat(bar.height),
      cellH: parseFloat(cs.height) - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth),
    };
  }));

test.describe('the page', () => {
  test('every family in its own colour on the value, the label and the bar; the shades of one family close to it', async ({ page }) => {
    await openWith(page, withControls(EVERY));
    await expect(page.locator('[data-id="powerSteering"] .ctrl-mini-value')).toHaveText('3');
    const all = await cells(page);
    const byKey = Object.fromEntries(all.map((c) => [c.key, c]));

    // The three are the colours they always had: the value, the label and the bar.
    const always = { ctrlBB: [355, 80, 65, 50, 55, 75], ctrlTC: [215, 80, 68, 50, 58, 75], ctrlABS: [48, 85, 62, 55, 52, 80] };
    for (const [key, [h, sv, lv, sl, ll, sf]] of Object.entries(always)) {
      expect(near(parse(byKey[key].value).rgb, hsl(h, sv, lv)), `${key}'s value`).toBe(true);
      expect(near(parse(byKey[key].label).rgb, hsl(h, sl, ll)), `${key}'s label`).toBe(true);
      const bar = parse(byKey[key].bar);
      expect(near(bar.rgb, hsl(h, sf, 33)) && Math.abs(bar.a - 0.12) < 0.01, `${key}'s bar`).toBe(true);
    }
    // The mode's green is the one it always had.
    expect(near(parse(byKey.ctrlMode.value).rgb, hsl(150, 70, 62)), 'the mode').toBe(true);

    // Every other control's value, label and bar are its family's hue (a shade of it within 15 degrees), every family
    // apart from the others, and a shade apart from its family's own.
    const coloured = all.filter((c) => c.family);
    expect(coloured.length).toBe(all.length - 2);
    for (const c of coloured) {
      const hue = HUES[c.family];
      for (const part of ['value', 'label', 'bar']) {
        const col = parse(c[part]);
        expect(col, `${c.key}'s ${part}`).not.toBeNull();
        expect(hueGap(hueOf(col.rgb), hue), `${c.key}'s ${part} is ${c.family}'s (${c[part]})`).toBeLessThanOrEqual(15);
      }
    }
    const own = (family) => coloured.find((c) => c.family === family && c.shade === '0');
    for (const a of Object.keys(HUES)) for (const b of Object.keys(HUES)) {
      if (a >= b) continue;
      expect(hueGap(hueOf(parse(own(a).value).rgb), hueOf(parse(own(b).value).rgb)), `${a} and ${b}`).toBeGreaterThanOrEqual(20);
    }
    for (const c of coloured.filter((x) => x.shade !== '0')) {
      const base = parse(own(c.family).value).rgb, mine = parse(c.value).rgb;
      expect(Math.max(...mine.map((x, i) => Math.abs(x - base[i]))), `${c.key} is a shade apart from ${c.family}'s own`).toBeGreaterThanOrEqual(12);
    }

    // DRS and push-to-pass have no family: their states are their colours, and off they are the row's own white.
    for (const key of ['drs', 'p2p']) {
      expect(byKey[key].family, key).toBeNull();
      expect(parse(byKey[key].value).rgb, key).toEqual([255, 255, 255]);
    }
  });

  test('readable on the dark glass and the light: every value and label against the panel at its least kind', async ({ page }) => {
    await openWith(page, withControls(EVERY));
    await expect(page.locator('[data-id="powerSteering"] .ctrl-mini-value')).toHaveText('3');
    const dark = (await cells(page)).filter((c) => c.family);
    await page.evaluate(() => document.body.setAttribute('data-theme', 'light'));
    const light = (await cells(page)).filter((c) => c.family);
    // (the bias red's own, as it always was, is 4.4:1 and 3.3:1 on the dark glass at its least kind)
    for (const c of dark) {
      expect(contrast(parse(c.value).rgb, DARK_GLASS), `${c.key}'s value on the dark glass`).toBeGreaterThanOrEqual(4);
      expect(contrast(parse(c.label).rgb, DARK_GLASS), `${c.key}'s label on the dark glass`).toBeGreaterThanOrEqual(3);
    }
    for (const c of light) {
      expect(contrast(parse(c.value).rgb, LIGHT_GLASS), `${c.key}'s value on the light glass`).toBeGreaterThanOrEqual(4);
      expect(contrast(parse(c.label).rgb, LIGHT_GLASS), `${c.key}'s label on the light glass`).toBeGreaterThanOrEqual(3.5);
      expect(hueGap(hueOf(parse(c.value).rgb), HUES[c.family]), `${c.key} keeps its family's hue on the light theme`).toBeLessThanOrEqual(15);
      const before = dark.find((d) => d.key === c.key);
      expect(lum(parse(c.value).rgb), `${c.key} is darker on the light theme`).toBeLessThan(lum(parse(before.value).rgb));
    }
  });

  test('the bar follows the value as he turns the dial, on the three and on every other cell', async ({ page }) => {
    const at = (bias, bar) => ({ ...EVERY, bb: { ...EVERY.bb, value: bias, text: String(bias), fill: (bias - 46) / 9 },
      more: EVERY.more.map((m) => (m.id === 'arbFront' ? { ...m, value: bar, text: String(bar), fill: (bar - 1) / 4 } : m)) });
    await openWith(page, withControls(at(48.25, 2)));
    await expect(page.locator('#ctrlBB .ctrl-value')).toHaveText('48.25');
    const read = async () => Object.fromEntries((await cells(page)).filter((c) => c.key === 'ctrlBB' || c.key === 'arbFront').map((c) => [c.key, c]));
    let r = await read();
    expect([r.ctrlBB.pct, r.arbFront.pct]).toEqual(['25%', '25%']);
    expect(r.arbFront.barH / r.arbFront.cellH).toBeCloseTo(0.25, 1);

    // He clicks the bias forward and the bar up: the next frames carry the new values, and the bars move with them.
    await serve(page, withControls(at(52.75, 4)));
    await expect(page.locator('#ctrlBB .ctrl-value')).toHaveText('52.75');
    r = await read();
    expect([r.ctrlBB.pct, r.arbFront.pct]).toEqual(['75%', '75%']);
    expect(r.arbFront.barH / r.arbFront.cellH).toBeCloseTo(0.75, 1);
    expect(r.ctrlBB.barH / r.ctrlBB.cellH).toBeCloseTo(0.75, 1);

    // And back down, one click at a time.
    for (const [bias, bar, pct] of [[51.85, 3, ['65%', '50%']], [46, 1, ['0%', '0%']]]) {
      await serve(page, withControls(at(bias, bar)));
      r = await read();
      expect([r.ctrlBB.pct, r.arbFront.pct], `${bias}, ${bar}`).toEqual(pct);
    }
  });

  test('a control the host sends no fill for has no bar; the old panel, for a car the list does not have, keeps its own', async ({ page }) => {
    const bare = { ...EVERY, bb: { ...EVERY.bb, fill: undefined }, more: [{ ...dial('arbRear', 9), fill: undefined }] };
    await openWith(page, withControls(bare));
    await expect(page.locator('[data-id="arbRear"] .ctrl-mini-value')).toHaveText('9');
    const r = Object.fromEntries((await cells(page)).map((c) => [c.key, c]));
    expect([r.ctrlBB.pct, r.arbRear.pct], 'no range in the list: no bar, and none made up').toEqual(['0%', '0%']);
    expect(r.arbRear.family).toBe('chassis');

    // Without the key the panel is the old one, coloured and filled by its ids as it always was: (bias - 30) / 40.
    await serve(page, { ...MOCK_TELEMETRY, 'DataCorePlugin.GameRawData.Telemetry.dcBrakeBias': 50, 'DataCorePlugin.GameData.CarModel': 'Porsche 911 GT3 R' });
    await expect.poll(() => page.evaluate(() => document.querySelector('.car-controls').classList.contains('car-controls-listed'))).toBe(false);
    const old = Object.fromEntries((await cells(page)).map((c) => [c.key, c]));
    expect(old.ctrlBB.pct).toBe('50%');
    expect([old.ctrlBB.family, old.ctrlTC.family, old.ctrlABS.family]).toEqual([null, null, null]);
    expect(near(parse(old.ctrlBB.value).rgb, hsl(355, 80, 65)), 'the bias red, by its id').toBe(true);
    expect(near(parse(old.ctrlTC.value).rgb, hsl(215, 80, 68)), 'the traction blue, by its id').toBe(true);
    expect(near(parse(old.ctrlABS.value).rgb, hsl(48, 85, 62)), 'the anti-lock yellow, by its id').toBe(true);
  });

  test('the glance layout has the same colours (it is the HUD\'s panels, laid out again)', async ({ page }) => {
    await openWith(page, withControls(EVERY));
    await expect(page.locator('[data-id="powerSteering"] .ctrl-mini-value')).toHaveText('3');
    const rig = Object.fromEntries((await cells(page)).map((c) => [c.key, c.value]));
    await page.evaluate(() => { document.body.classList.add('drive-mode-active'); });
    await serve(page, withControls(EVERY));
    const glance = Object.fromEntries((await cells(page)).map((c) => [c.key, c.value]));
    for (const key of ['ctrlBB', 'ctrlTC', 'ctrlABS', 'brakeMigration', 'tc2', 'throttleMap', 'arbFront']) expect(glance[key], key).toBe(rig[key]);
  });
});
