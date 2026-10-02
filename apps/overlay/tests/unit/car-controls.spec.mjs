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
const { KEY, ROOM, read, view, arrange, labelPlan, signals, textOf, fillOf, announced } = require('../../modules/js/car-controls.js');

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
const GT3_UNREAD = WIRE['madeup gt3 unread'];   // the same car not publishing its ABS or its throttle map
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
      for (const slot of ['abs', 'tc', 'bb']) expect(['none', 'on', 'off', 'value', 'mode', 'unread'], `${name} ${slot}`).toContain(cc[slot].state);
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
    for (const state of ['none', 'on', 'off', 'mode']) expect(fillOf({ state, value: 8, fill: 1 }), state).toBe(0);
    expect(fillOf({ state: 'value', value: 8, fill: 0.25 })).toBe(0.25);
    expect(fillOf({ state: 'value', value: 8, fill: 7 })).toBe(1);
    expect(fillOf({ state: 'value', value: 8, fill: -1 })).toBe(0);
    // The bar is where the value stands in that control's range for that car, which the host works out from the list:
    // where it sends none (no range in the list, positions that are names), there is none. Nothing is made up here —
    // not the 30 to 70 and 0 to 12 the HUD once drew for the three, which are the old panel's alone (a car the list
    // does not have).
    expect(fillOf({ state: 'value', value: 50 })).toBe(0);
    expect(fillOf({ state: 'value', value: 6, text: '6' })).toBe(0);
    expect(fillOf({ state: 'value', value: 30 })).toBe(0);
    expect(fillOf({ state: 'value', value: 3 })).toBe(0);
    // A position with a name is not a quantity: the host sends no fill for MDM, and the HUD makes none.
    expect(fillOf({ state: 'value', value: 1, text: 'MDM' })).toBe(0);
    // Positions that are a scale fill by the host's word (the MP4-30's target charge, 50% of 25 / 50 / 75).
    expect(fillOf({ state: 'value', value: 50, text: '50%', fill: 0.5 })).toBe(0.5);
    expect(fillOf({ state: 'value', text: 'MDM' })).toBe(0);
    expect(fillOf({ state: 'value', value: 4, fill: '0.5' })).toBe(0);
    expect(fillOf(null)).toBe(0);
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

  test('a control the car has and the sim is not reporting shows its own label and a dash, never a number', () => {
    const v = view(GT3_UNREAD);
    expect(v.primary[2]).toEqual(expect.objectContaining({ label: 'ABS', text: '—', state: 'unread', fill: 0, value: null, locked: false }));
    expect(v.primary[1]).toEqual(expect.objectContaining({ label: 'TC1', text: '4', state: 'value' }));
    expect(v.more).toEqual([expect.objectContaining({ id: 'throttleMap', label: 'MAP', text: '—', state: 'unread', value: null, fill: 0 })]);
    // Whatever the host put beside it: an unread reading has no value to show.
    expect(textOf({ state: 'unread', value: 4, text: '4' })).toBe('—');
    expect(fillOf({ state: 'unread', value: 4, fill: 0.5 }, 'tc')).toBe(0);
  });

  test('the bar is the host\'s fill and nothing else: a control the list gives no range has none', () => {
    const v = view({ car: 'x', more: [{ id: 'arbFront', state: 'value', value: 3, fill: 0.4 }, { id: 'tc2', state: 'value', value: 5 }],
      bb: { state: 'value', value: 50 }, tc: { state: 'value', value: 6 }, abs: { state: 'value', value: 3, fill: 0.9 } });
    expect(v.primary.map((c) => c.fill)).toEqual([0, 0, 0.9]);
    expect(v.primary.map((c) => c.text)).toEqual(['50', '6', '3']);
    expect(v.more.map((c) => c.fill)).toEqual([0.4, 0]);
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

// A car's controls with `n` other dials beside the three (brakeBias, tc, abs as given), for the room rule.
function withDials(n, { abs = 'value', tc = 'value', bb = 'value' } = {}) {
  const reading = (id, label, state) => (state === 'none' ? { id, label, state: 'none', text: 'NONE' } : { id, label, state: 'value', value: 3, text: '3' });
  const more = Array.from({ length: n }, (_, i) => reading('dial' + (i + 1), 'D' + (i + 1), 'value'));
  return { car: 'many', name: 'Many Dials', kind: 'gt', abs: reading('abs', 'ABS', abs), tc: reading('tc', 'TC', tc), bb: reading('brakeBias', 'BB', bb), more };
}

test.describe('arrange: which cells the rig\'s panel has room for', () => {
  test('the room is a ladder of steps: three across in one row and in two, four across in two rows a size down, three rows of four and of five', () => {
    expect(ROOM.steps).toEqual([
      { cols: 3, rows: 1, size: 'full' },
      { cols: 3, rows: 2, size: 'full' },
      { cols: 4, rows: 2, size: 'compact' },
      { cols: 4, rows: 3, size: 'tight' },
      { cols: 5, rows: 3, size: 'tight' },
    ]);
  });

  test('a car with nothing to turn: its three cells in one row, the real one first and NONE last', () => {
    expect(arrange(view(MX5))).toEqual({ cols: 3, rows: 1, compact: false, tight: false, shown: ['abs', 'bb', 'tc'], omitted: [] });
    expect(arrange(view(M2)).shown).toEqual(['tc', 'abs', 'bb']);
  });

  test('a mode and the cells it covers: the mode is a cell, the covered ones take no slot', () => {
    expect(arrange(view(MCLAREN_570S))).toEqual({ cols: 2, rows: 1, compact: false, tight: false, shown: ['mode', 'bb'], omitted: [] });
  });

  test('the cells go across first, then down: two rows from the fourth cell, balanced', () => {
    expect(arrange(view(withDials(0)))).toEqual(expect.objectContaining({ cols: 3, rows: 1, compact: false }));
    expect(arrange(view(withDials(1)))).toEqual(expect.objectContaining({ cols: 2, rows: 2, compact: false }));
    expect(arrange(view(withDials(2)))).toEqual(expect.objectContaining({ cols: 3, rows: 2, compact: false }));
    expect(arrange(view(withDials(3)))).toEqual(expect.objectContaining({ cols: 3, rows: 2, compact: false, omitted: [] }));
    expect(arrange(view(GT3))).toEqual(expect.objectContaining({ cols: 2, rows: 2, shown: ['bb', 'tc', 'abs', 'throttleMap'] }));
  });

  test('a NONE cell fills only a slot that is left in the rows the real cells need, and never makes a row of its own', () => {
    // The fixture's GTP: six real cells (the bias, TCLO, and its four dials) and ABS NONE. Two rows of three hold the
    // six and no more, so the NONE is omitted.
    expect(arrange(view(GTP))).toEqual({ cols: 3, rows: 2, compact: false, tight: false, shown: ['bb', 'tc', 'brakeMigration', 'tc2', 'arbFront', 'arbRear'], omitted: ['abs'] });
    // The formula car: three real (the bias, DRS, push-to-pass) fill one row of three; its two NONE would be a second
    // row, which is not worth the pedals' room: both are omitted.
    expect(arrange(view(FORMULA))).toEqual({ cols: 3, rows: 1, compact: false, tight: false, shown: ['bb', 'drs', 'p2p'], omitted: ['tc', 'abs'] });
    // Three real cells and ABS NONE: one row, the NONE omitted — not a two-by-two grid for a cell that says NONE.
    expect(arrange(view(withDials(1, { abs: 'none' })))).toEqual({ cols: 3, rows: 1, compact: false, tight: false, shown: ['bb', 'tc', 'dial1'], omitted: ['abs'] });
    // Two real and one NONE: the one row holds all three.
    expect(arrange(view(withDials(0, { abs: 'none' }))).omitted).toEqual([]);
    // Four real and one NONE: the second row has a slot left for it.
    expect(arrange(view(withDials(2, { abs: 'none' })))).toEqual(expect.objectContaining({ cols: 3, rows: 2, omitted: [] }));
    // Whatever the car has, the NONE cells change neither the rows nor the size, and every real cell is shown.
    for (let n = 0; n <= 16; n++) {
      for (const none of [{ abs: 'none' }, { abs: 'none', tc: 'none' }, { abs: 'none', tc: 'none', bb: 'none' }]) {
        const v = view(withDials(n, none));
        const without = arrange({ ...v, primary: v.primary.map((p) => (p.state === 'none' ? { ...p, hidden: true } : p)) });
        const fit = arrange(v);
        expect([n, none, fit.rows, fit.compact, fit.tight]).toEqual([n, none, without.rows, without.compact, without.tight]);
        expect(fit.shown.slice(0, without.shown.length)).toEqual(without.shown);
        const nones = new Set(v.primary.filter((p) => p.state === 'none').map((p) => p.slot));
        expect(fit.omitted.filter((k) => !nones.has(k)), 'only a NONE cell is ever omitted').toEqual([]);
      }
    }
  });

  test('past six real cells the type steps down to compact, four across, and NONE goes before any real one', () => {
    const seven = arrange(view(withDials(4)));
    expect(seven).toEqual(expect.objectContaining({ cols: 4, rows: 2, compact: true, tight: false, omitted: [] }));
    expect(seven.shown).toEqual(['bb', 'tc', 'abs', 'dial1', 'dial2', 'dial3', 'dial4']);
    const eight = arrange(view(withDials(5)));
    expect(eight).toEqual(expect.objectContaining({ cols: 4, rows: 2, compact: true, omitted: [] }));
    // Seven real and one NONE: the compact size holds eight, so the NONE is shown; eight real and one NONE: it goes.
    expect(arrange(view(withDials(5, { abs: 'none' }))).omitted).toEqual([]);
    expect(arrange(view(withDials(6, { abs: 'none' }))).omitted).toEqual(['abs']);
  });

  test('past eight real cells nothing the car has is left out: three rows, four across and then five, then as many as it takes', () => {
    const ten = arrange(view(withDials(7)));
    expect(ten).toEqual({ cols: 4, rows: 3, compact: true, tight: true, shown: ['bb', 'tc', 'abs', 'dial1', 'dial2', 'dial3', 'dial4', 'dial5', 'dial6', 'dial7'], omitted: [] });
    expect(arrange(view(withDials(9)))).toEqual(expect.objectContaining({ cols: 4, rows: 3, tight: true, omitted: [] }));
    expect(arrange(view(withDials(10)))).toEqual(expect.objectContaining({ cols: 5, rows: 3, tight: true, omitted: [] }));
    const fourteen = arrange(view(withDials(11)));
    expect(fourteen).toEqual(expect.objectContaining({ cols: 5, rows: 3, tight: true, omitted: [] }));
    expect(fourteen.shown).toHaveLength(14);
    const eighteen = arrange(view(withDials(15)));
    expect(eighteen).toEqual(expect.objectContaining({ cols: 6, rows: 3, tight: true, omitted: [] }));
    expect(eighteen.shown).toHaveLength(18);
    // Eleven real and ABS NONE: the twelfth slot of three rows of four holds it. Twelve real: none is left for it.
    expect(arrange(view(withDials(9, { abs: 'none' })))).toEqual(expect.objectContaining({ cols: 4, rows: 3, omitted: [] }));
    expect(arrange(view(withDials(10, { abs: 'none' }))).omitted).toEqual(['abs']);
  });

  test('DRS and push-to-pass, which are live state, are never the cells that go', () => {
    // Eleven of the car's own and DRS and push-to-pass after them in the panel's order: fourteen real cells.
    const cc = {
      ...withDials(9),
      drs: { id: 'drs', label: 'DRS', state: 'off', value: 0, text: 'OFF' },
      p2p: { id: 'p2p', label: 'P2P', state: 'value', value: 1, text: '120', count: 120 },
    };
    const fit = arrange(view(cc));
    expect(fit.shown).toEqual(expect.arrayContaining(['drs', 'p2p']));
    expect(fit.omitted).toEqual([]);
    expect(fit.shown).toHaveLength(14);
  });

  test('an unread cell is a real one: the car has it', () => {
    const v = view({ ...GT3_UNREAD, more: [...GT3_UNREAD.more, ...withDials(4).more] });
    const fit = arrange(v);
    expect(fit.compact).toBe(true);
    expect(fit.shown).toContain('abs');
    expect(fit.shown).toContain('throttleMap');
  });

  test('another room, for a layout that has one: past its last step the cells go on across', () => {
    expect(arrange(view(withDials(2)), { steps: [{ cols: 2, rows: 1, size: 'full' }] })).toEqual({ cols: 5, rows: 1, compact: false, tight: false, shown: ['bb', 'tc', 'abs', 'dial1', 'dial2'], omitted: [] });
  });
});

test.describe('labelPlan: how wide a label is on the rig, and whether it takes a second line', () => {
  const across = (cols, size) => ({ cols, compact: size !== 'full', tight: size === 'tight' });

  test('a label its cell holds at 8px or more on one line stays on one, as long as it is', () => {
    expect(labelPlan('BRAKE BIAS', false, across(3, 'full'))).toEqual({ len: 10, lines: 1 });
    expect(labelPlan('TC TOGGLE', false, across(4, 'compact'))).toEqual({ len: 9, lines: 1 });
    expect(labelPlan('REAR BRAKE VALVE', false, across(3, 'full'))).toEqual({ len: 16, lines: 1 });
  });

  test('one that would be set under 8px takes a second line, and is as wide as the wider of the two', () => {
    expect(labelPlan('BRAKE MIGRATION', false, across(4, 'compact'))).toEqual({ len: 9, lines: 2 });
    expect(labelPlan('BIAS MIGRATION GAIN', false, across(4, 'tight'))).toEqual({ len: 14, lines: 2 });
    expect(labelPlan('REAR TC LATERAL SLIP', false, across(5, 'tight'))).toEqual({ len: 12, lines: 2 });
  });

  test('the lock mark is two more characters, on the last line', () => {
    expect(labelPlan('REAR BRAKE VALVE', true, across(3, 'full'))).toEqual({ len: 10, lines: 2 });
    expect(labelPlan('BRAKE BIAS', true, across(3, 'full'))).toEqual({ len: 12, lines: 1 });
  });

  test('one word, a label the glance layout draws, or none: one line, as long as it is', () => {
    expect(labelPlan('THROTTLESHAPEXX', false, across(5, 'tight'))).toEqual({ len: 15, lines: 1 });
    expect(labelPlan('REAR TC LATERAL SLIP', false, null)).toEqual({ len: 20, lines: 1 });
    expect(labelPlan('', false, across(3, 'full'))).toEqual({ len: 1, lines: 1 });
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
    // ABS NONE: six real cells fill the rig panel's two rows at the full size, so the NONE cell is omitted (the room
    // rule, below) — drawn all the same, with the host's word, for the glance layout and for a car with room.
    expect(p.cells.map((c) => [c.id, c.label, c.value, c.shown])).toEqual([
      ['ctrlBB', 'BB', '48.25', true], ['ctrlTC', 'TCLO', '5', true], ['ctrlABS', 'ABS', 'NONE', false],
    ]);
    expect(p.cells[1].classes).toEqual(['ctrl-locked']);
    expect(p.cells[1].pct).toBe('36%');
    expect(p.cells[2].classes).toEqual(['ctrl-none', 'ctrl-omitted']);
    expect(p.cells[2].valueClasses).toEqual(['ctrl-value-fixed']);
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
    // Its real cells are the bias, DRS and push-to-pass: a row of three. The two NONE cells have no slot left in it, so
    // they are omitted (kept in the panel, not shown).
    expect(p.cells.map((c) => [c.id, c.label, c.value, c.classes])).toEqual([
      ['ctrlBB', 'BBAL', '55.0', []], ['ctrlTC', 'TC', 'NONE', ['ctrl-none', 'ctrl-omitted']], ['ctrlABS', 'ABS', 'NONE', ['ctrl-none', 'ctrl-omitted']],
    ]);
    expect(p.cells.map((c) => c.shown)).toEqual([true, false, false]);
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

  test('a control the car has and the sim is not reporting is its label over a dash, and the sim starting to say is not announced', async ({ page }) => {
    await openWith(page, withControls(GT3_UNREAD));
    await expect(page.locator('#ctrlABS .ctrl-value')).toHaveText('—');
    const p = await panel(page);
    expect(p.cells.map((c) => [c.id, c.label, c.value, c.classes])).toEqual([
      ['ctrlBB', 'BB', '56.2', []], ['ctrlTC', 'TC1', '4', []], ['ctrlABS', 'ABS', '—', ['ctrl-unread']],
    ]);
    expect(p.cells[2].pct).toBe('0%');
    expect(p.more.map((c) => [c.id, c.label, c.value, c.classes])).toEqual([['throttleMap', 'MAP', '—', ['ctrl-mini-unread']]]);
    expect(await page.evaluate(() => [
      getComputedStyle(document.querySelector('#ctrlABS .ctrl-value')).opacity,
      getComputedStyle(document.querySelector('[data-id="throttleMap"] .ctrl-mini-value')).opacity,
    ])).toEqual(['0.35', '0.35']);

    // The car begins to publish both: the numbers appear, and the spotter says nothing of it (he turned no dial).
    await serve(page, withControls({ ...GT3, fixedSetup: false, abs: { ...GT3.abs, locked: undefined }, tc: { ...GT3.tc, locked: undefined } }));
    await expect(page.locator('#ctrlABS .ctrl-value')).toHaveText('OFF');
    await expect(page.locator('[data-id="throttleMap"] .ctrl-mini-value')).toHaveText('2');
    await page.waitForTimeout(400);
    expect((await spotter(page)).filter((c) => c.header === 'Adjustment')).toEqual([]);
    expect((await panel(page)).cells[2].classes).toEqual(['ctrl-off']);
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

// ── The rig's room: a panel for every adjustment the car has ──

// The HUD's zoom and the cells' sizes ease into place (.dashboard and .ctrl-item transition everything): read once
// the panel and the pedals have held still for a quarter of a second.
async function settled(page) {
  const sizes = () => page.evaluate(() => [document.querySelector('.car-controls').getBoundingClientRect().height, document.querySelector('.pedals-area').getBoundingClientRect().height]);
  let last = await sizes();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(250);
    const now = await sizes();
    if (now[0] === last[0] && now[1] === last[1]) return;
    last = now;
  }
}

// The panel's own room-rule state, and where each cell that is shown ends up.
const room = (page) => page.evaluate(() => {
  const root = document.querySelector('.car-controls');
  const r = root.getBoundingClientRect();
  const cells = [...root.querySelectorAll('.ctrl-item, .ctrl-mini')].filter((el) => getComputedStyle(el).display !== 'none').map((el) => {
    const b = el.getBoundingClientRect();
    const value = el.querySelector('.ctrl-value, .ctrl-mini-value');
    const label = el.querySelector('.ctrl-label, .ctrl-mini-label');
    return {
      key: el.id ? ({ ctrlBB: 'bb', ctrlTC: 'tc', ctrlABS: 'abs' }[el.id] || el.id.replace(/^ctrlM/, 'm')) : el.getAttribute('data-id'),
      x: Math.round(b.left - r.left), y: Math.round(b.top - r.top), w: Math.round(b.width), h: Math.round(b.height),
      valuePx: parseFloat(getComputedStyle(value).fontSize), labelPx: parseFloat(getComputedStyle(label).fontSize),
      valueOverflows: value.scrollWidth > value.clientWidth + 1, labelClipped: label.scrollWidth > label.clientWidth + 1,
      labelLen: el.style.getPropertyValue('--ctrl-label-len'), labelTwoLines: label.classList.contains('ctrl-label-2l'),
      // Text taller than the cell it is in is cut off by it (the cell clips what runs past it).
      clipped: el.scrollHeight > el.clientHeight + 1,
      inside: b.left >= r.left - 0.5 && b.right <= r.right + 0.5 && b.top >= r.top - 0.5 && b.bottom <= r.bottom + 0.5,
    };
  });
  const pedals = document.querySelector('.pedals-area').getBoundingClientRect();
  return {
    fit: root.classList.contains('ctrl-fit'), compact: root.classList.contains('ctrl-compact'),
    cols: root.style.getPropertyValue('--ctrl-cols'), rows: root.getAttribute('data-ctrl-rows'),
    panel: { w: Math.round(r.width), h: Math.round(r.height) }, pedals: { h: Math.round(pedals.height) },
    moreDisplay: document.getElementById('ctrlMore') ? getComputedStyle(document.getElementById('ctrlMore')).display : null,
    cells,
  };
});

test.describe('the rig\'s room: every adjustment a cell, the ones the car lacks omitted first', () => {
  test('a car with nothing to turn: three cells in one row, as wide as each other, NONE last', async ({ page }) => {
    await openWith(page, withControls(MX5));
    await expect(page.locator('#ctrlABS .ctrl-value')).toHaveText('ON');
    await expect.poll(() => room(page).then((r) => r.fit)).toBe(true);
    await settled(page);
    const r = await room(page);
    expect([r.fit, r.compact, r.cols, r.rows]).toEqual([true, false, '3', '1']);
    expect(r.cells.map((c) => c.key)).toEqual(['bb', 'tc', 'abs']);
    expect(new Set(r.cells.map((c) => c.y)).size).toBe(1);
    expect(Math.max(...r.cells.map((c) => c.w)) - Math.min(...r.cells.map((c) => c.w))).toBeLessThanOrEqual(2);
    expect(r.cells.every((c) => c.inside)).toBe(true);
    // Left to right: the real one, then the two that say NONE.
    expect([...r.cells].sort((a, b) => a.x - b.x).map((c) => c.key)).toEqual(['abs', 'bb', 'tc']);
  });

  test('a GT3 with a map beside the three: two rows of two inside the panel\'s own height, the pedals as tall as ever', async ({ page }) => {
    await openWith(page, withControls(MX5));
    await expect(page.locator('#ctrlABS .ctrl-value')).toHaveText('ON');
    await expect.poll(() => room(page).then((r) => r.fit)).toBe(true);
    await settled(page);
    const one = await room(page);
    await serve(page, withControls(GT3));
    await expect(page.locator('[data-id="throttleMap"] .ctrl-mini-value')).toHaveText('2');
    await expect.poll(() => room(page).then((r) => r.rows)).toBe('2');
    await settled(page);
    const r = await room(page);
    expect([r.fit, r.compact, r.cols]).toEqual([true, false, '2']);
    expect(r.moreDisplay, 'the row of other controls dissolves: its cells are the panel\'s').toBe('contents');
    expect(r.cells.map((c) => c.key)).toEqual(['bb', 'tc', 'abs', 'throttleMap']);
    expect(new Set(r.cells.map((c) => c.y)).size).toBe(2);
    expect(r.cells.filter((c) => c.y === r.cells[0].y).map((c) => c.key)).toEqual(['bb', 'tc']);
    // The panel is as tall as with one row and the pedals under it lose nothing: nothing else on the HUD is displaced.
    expect(Math.abs(r.panel.h - one.panel.h)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.pedals.h - one.pedals.h)).toBeLessThanOrEqual(1);
    // The other control is a cell like the three: the same type, its label and its number in the same sizes.
    const map = r.cells.find((c) => c.key === 'throttleMap'), tc = r.cells.find((c) => c.key === 'tc');
    expect([map.valuePx, map.labelPx]).toEqual([tc.valuePx, tc.labelPx]);
    expect(Math.abs(map.h - tc.h)).toBeLessThanOrEqual(2);
    expect(r.cells.every((c) => c.inside && !c.valueOverflows && !c.clipped)).toBe(true);
  });

  test('a car whose three fit one row has no second row for a NONE: the panel stays one row', async ({ page }) => {
    // Bias, TC and a toggle (the C6 Corvette\'s three) with ABS NONE: three real cells, one row of three.
    const cc = withDials(1, { abs: 'none' });
    await openWith(page, withControls(MX5));
    await expect(page.locator('#ctrlABS .ctrl-value')).toHaveText('ON');
    await expect.poll(() => room(page).then((r) => r.fit)).toBe(true);
    await settled(page);
    const one = await room(page);
    await serve(page, withControls(cc));
    await expect(page.locator('[data-id="dial1"] .ctrl-mini-value')).toHaveText('3');
    await expect.poll(() => room(page).then((r) => r.cells.length)).toBe(3);
    await settled(page);
    const r = await room(page);
    expect([r.cols, r.rows]).toEqual(['3', '1']);
    expect(r.cells.map((c) => c.key)).toEqual(['bb', 'tc', 'dial1']);
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('ctrlABS')).display)).toBe('none');
    expect(Math.abs(r.panel.h - one.panel.h)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.pedals.h - one.pedals.h)).toBeLessThanOrEqual(1);
  });

  test('a mode is a cell as wide as the others, on the rig', async ({ page }) => {
    await openWith(page, withControls(MCLAREN_570S));
    await expect(page.locator('#ctrlMode .ctrl-label')).toHaveText('ESC');
    await expect.poll(() => room(page).then((r) => r.fit)).toBe(true);
    await settled(page);
    const r = await room(page);
    const mode = r.cells.find((c) => c.key === 'mode'), bb = r.cells.find((c) => c.key === 'bb');
    expect(r.cells.map((c) => c.key).sort()).toEqual(['bb', 'mode']);
    expect(mode.w, 'the mode (the 570S\'s one dial) is as wide as the bias beside it').toBeGreaterThanOrEqual(bb.w - 2);
    expect(Math.abs(mode.w - bb.w)).toBeLessThanOrEqual(2);
  });

  test('six real cells and ABS NONE: the full size holds the six, and the NONE is omitted', async ({ page }) => {
    await openWith(page, withControls(GTP));
    await expect(page.locator('[data-id="arbRear"] .ctrl-mini-value')).toHaveText('15');
    await expect.poll(() => room(page).then((r) => r.cells.length)).toBe(6);
    await settled(page);
    const r = await room(page);
    expect([r.fit, r.compact, r.cols, r.rows]).toEqual([true, false, '3', '2']);
    expect(r.cells.map((c) => c.key)).toEqual(['bb', 'tc', 'brakeMigration', 'tc2', 'arbFront', 'arbRear']);
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('ctrlABS')).display)).toBe('none');
    expect(r.cells.every((c) => c.inside && !c.valueOverflows)).toBe(true);
    // A number of five characters is a step down from the number's size, so it fits a cell of three across.
    expect(r.cells.find((c) => c.key === 'bb').valuePx).toBeLessThan(r.cells.find((c) => c.key === 'tc').valuePx);
    // The bar the three have, on the others too: the migration's fill is the host's.
    expect(await page.evaluate(() => document.querySelector('[data-id="brakeMigration"]').style.getPropertyValue('--ctrl-pct'))).toBe('33%');
  });

  test('past six the type steps down to compact, four across; past eight to three rows, and no dial the car has is left out', async ({ page }) => {
    await openWith(page, withControls(MX5));
    await expect(page.locator('#ctrlABS .ctrl-value')).toHaveText('ON');
    await expect.poll(() => room(page).then((r) => r.fit)).toBe(true);
    await settled(page);
    const one = await room(page);

    const eight = withDials(5, { abs: 'none' });     // seven real and one NONE: eight slots, all in
    await serve(page, withControls(eight));
    await expect(page.locator('[data-id="dial5"] .ctrl-mini-value')).toHaveText('3');
    await expect.poll(() => room(page).then((r) => r.compact)).toBe(true);
    await settled(page);
    let r = await room(page);
    expect([r.cols, r.rows]).toEqual(['4', '2']);
    expect(r.cells.map((c) => c.key)).toEqual(['bb', 'tc', 'abs', 'dial1', 'dial2', 'dial3', 'dial4', 'dial5']);
    const abs = r.cells.find((c) => c.key === 'abs'), dial5 = r.cells.find((c) => c.key === 'dial5');
    expect(abs.y, 'NONE last: the second row').toBe(Math.max(...r.cells.map((c) => c.y)));
    expect(abs.x, 'NONE last: after the last dial').toBeGreaterThan(dial5.x);
    expect(r.cells.filter((c) => c.y === r.cells[0].y).length, 'four across').toBe(4);
    expect(r.cells.every((c) => c.inside && !c.valueOverflows && !c.clipped)).toBe(true);
    const full = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#ctrlBB .ctrl-value')).fontSize));
    expect(full).toBeLessThan(22);
    expect(full).toBeGreaterThanOrEqual(16);
    expect(Math.abs(r.pedals.h - one.pedals.h)).toBeLessThanOrEqual(1);

    // Eleven real and ABS NONE: three rows of four, all twelve, the NONE in the last slot; nothing is left out.
    await serve(page, withControls(withDials(9, { abs: 'none', tc: 'value' })));
    await expect(page.locator('[data-id="dial9"] .ctrl-mini-value')).toHaveText('3');
    await expect.poll(() => room(page).then((x) => x.rows)).toBe('3');
    await settled(page);
    r = await room(page);
    expect([r.fit, r.compact, r.cols, r.rows]).toEqual([true, true, '4', '3']);
    expect(await page.evaluate(() => document.querySelector('.car-controls').classList.contains('ctrl-tight'))).toBe(true);
    expect(r.cells.map((c) => c.key)).toEqual(['bb', 'tc', 'abs', 'dial1', 'dial2', 'dial3', 'dial4', 'dial5', 'dial6', 'dial7', 'dial8', 'dial9']);
    expect(await page.evaluate(() => [...document.querySelectorAll('.car-controls .ctrl-omitted')].length)).toBe(0);
    expect(r.cells.every((c) => c.inside && !c.valueOverflows && !c.clipped)).toBe(true);
    expect(r.cells[0].valuePx).toBe(13);
    expect(Math.abs(r.panel.h - one.panel.h)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.pedals.h - one.pedals.h)).toBeLessThanOrEqual(1);

    // Fourteen real: five across in the same three rows, and a dial that is DRS is among them.
    const fourteen = withDials(10);
    fourteen.drs = { id: 'drs', label: 'DRS', state: 'off', value: 0, text: 'OFF' };
    await serve(page, withControls(fourteen));
    await expect(page.locator('[data-id="drs"] .ctrl-mini-value')).toHaveText('OFF');
    await expect.poll(() => room(page).then((x) => x.cols)).toBe('5');
    await settled(page);
    r = await room(page);
    expect([r.cols, r.rows]).toEqual(['5', '3']);
    expect(r.cells).toHaveLength(14);
    expect(r.cells.map((c) => c.key)).toContain('drs');
    expect(r.cells.every((c) => c.inside && !c.valueOverflows && !c.clipped)).toBe(true);
    expect(Math.abs(r.pedals.h - one.pedals.h)).toBeLessThanOrEqual(1);
  });

  test('a word that is wider than its cell is set smaller, and a long label is cut, never the cell', async ({ page }) => {
    const cc = withDials(5);
    cc.more[0] = { id: 'mguDeploy', label: 'HYS DEPLOY MODE', state: 'value', value: 1, text: 'AUTOMATIC' };
    await openWith(page, withControls(cc));
    await expect(page.locator('[data-id="mguDeploy"] .ctrl-mini-value')).toHaveText('AUTOMATIC');
    await settled(page);
    const r = await room(page);
    const cell = r.cells.find((c) => c.key === 'mguDeploy');
    expect(cell.valuePx).toBeLessThanOrEqual(10);
    expect(cell.valuePx).toBeGreaterThanOrEqual(7);
    expect(cell.inside).toBe(true);
    expect(cell.valueOverflows, 'AUTOMATIC whole, four across').toBe(false);
    expect(await page.evaluate(() => [...document.querySelector('[data-id="mguDeploy"] .ctrl-mini-value').classList].sort())).toEqual(['ctrl-mini-value', 'ctrl-mini-word', 'ctrl-value-long']);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('[data-id="mguDeploy"] .ctrl-mini-label')).textOverflow)).toBe('ellipsis');
  });

  test('a label is set as large as its cell holds it, takes a second line where one would not, and is cut only past that', async ({ page }) => {
    // The headless page has no Sofia Pro Comp (nothing is let through to Typekit: the page's font is the fallback,
    // half as wide again), so what is held to here is what the stylesheet works out from what the module says: the
    // length (--ctrl-label-len), the second line (.ctrl-label-2l), the type's own size and the floor of 7px. That every
    // label of the car list is whole in the page's own font is measured with it (car-controls-fit.spec.mjs).
    // Three across: BRAKE BIAS (the 720S's word for it) at the panel's size, as the short ones.
    const full = withDials(2);
    full.bb = { ...full.bb, label: 'BRAKE BIAS' };
    await openWith(page, withControls(full));
    await expect(page.locator('#ctrlBB .ctrl-label')).toHaveText('BRAKE BIAS');
    await settled(page);
    let r = await room(page);
    expect([r.compact, r.cols]).toEqual([false, '3']);
    let bb = r.cells.find((c) => c.key === 'bb'), tc = r.cells.find((c) => c.key === 'tc');
    expect([bb.labelLen, bb.labelTwoLines, bb.labelPx, tc.labelPx]).toEqual(['10', false, 10, 10]);

    // Four across: TC TOGGLE on one line; the labels of a GTP on two, as wide as the wider line; one word no line can
    // break stays on one, down to the floor, and is cut there with an ellipsis.
    const compact = withDials(5);
    compact.more[0] = { ...compact.more[0], label: 'TC TOGGLE' };
    compact.more[1] = { ...compact.more[1], label: 'REAR TC LATERAL SLIP' };
    compact.more[2] = { ...compact.more[2], label: 'BRAKE MIGRATION' };
    compact.more[3] = { ...compact.more[3], label: 'THROTTLESHAPEXXXX' };
    await serve(page, withControls(compact));
    await expect(page.locator('[data-id="dial2"] .ctrl-mini-label')).toHaveText('REAR TC LATERAL SLIP');
    await expect.poll(() => room(page).then((x) => x.compact)).toBe(true);
    await settled(page);
    r = await room(page);
    const cell = (key) => r.cells.find((c) => c.key === key);
    tc = cell('tc');
    expect([cell('dial1').labelLen, cell('dial1').labelTwoLines, cell('dial1').labelPx, tc.labelPx]).toEqual(['9', false, 9, 9]);
    expect([cell('dial2').labelLen, cell('dial2').labelTwoLines]).toEqual(['12', true]);
    expect([cell('dial3').labelLen, cell('dial3').labelTwoLines, cell('dial3').labelPx]).toEqual(['9', true, 9]);
    expect([cell('dial4').labelLen, cell('dial4').labelTwoLines, cell('dial4').labelPx, cell('dial4').labelClipped]).toEqual(['17', false, 7, true]);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('[data-id="dial4"] .ctrl-mini-label')).textOverflow)).toBe('ellipsis');
    expect(r.cells.every((c) => c.inside && !c.clipped)).toBe(true);
  });

  test('the glance layout keeps its own row of small cells, and the rig\'s room rule comes back with the rig', async ({ page }) => {
    await openWith(page, withControls(GTP));
    await expect(page.locator('[data-id="arbRear"] .ctrl-mini-value')).toHaveText('15');
    await expect.poll(() => room(page).then((r) => r.fit)).toBe(true);
    await page.evaluate(() => setDriveMode(true));
    await expect.poll(() => room(page).then((r) => r.fit)).toBe(false);
    let r = await room(page);
    expect([r.compact, r.cols, r.rows, r.moreDisplay]).toEqual([false, '', null, 'flex']);
    expect(r.cells.map((c) => c.key), 'every cell shown, NONE among them, in the list\'s order').toEqual(['bb', 'tc', 'abs', 'brakeMigration', 'tc2', 'arbFront', 'arbRear']);
    expect(await page.evaluate(() => document.querySelectorAll('.car-controls .ctrl-omitted').length)).toBe(0);
    await page.evaluate(() => setDriveMode(false));
    await expect.poll(() => room(page).then((r) => r.fit)).toBe(true);
    r = await room(page);
    expect(r.cells.map((c) => c.key)).toEqual(['bb', 'tc', 'brakeMigration', 'tc2', 'arbFront', 'arbRear']);
  });

  test('the glance layout leaves out another control the sim is not reporting, as before; the rig shows it with a dash', async ({ page }) => {
    await openWith(page, withControls(GT3_UNREAD));
    await expect(page.locator('[data-id="throttleMap"] .ctrl-mini-value')).toHaveText('—');
    await page.evaluate(() => setDriveMode(true));
    await expect.poll(() => room(page).then((r) => r.fit)).toBe(false);
    await expect(page.locator('[data-id="throttleMap"]')).toHaveCount(0);
    let r = await room(page);
    expect(r.cells.map((c) => c.key), 'the three; ABS a dash, as a primary the host said nothing of always was').toEqual(['bb', 'tc', 'abs']);
    expect(await page.locator('#ctrlABS .ctrl-value').textContent()).toBe('—');
    await page.evaluate(() => setDriveMode(false));
    await expect.poll(() => room(page).then((r) => r.fit)).toBe(true);
    await expect(page.locator('[data-id="throttleMap"] .ctrl-mini-value')).toHaveText('—');
    r = await room(page);
    expect(r.cells.map((c) => c.key)).toEqual(['bb', 'tc', 'abs', 'throttleMap']);
  });

  test('without the key the room rule goes with the rest', async ({ page }) => {
    await openWith(page, withControls(GTP));
    await expect.poll(() => room(page).then((r) => r.rows)).toBe('2');
    await serve(page, MOCK_TELEMETRY);
    await expect(page.locator('#ctrlTC .ctrl-label')).toHaveText('TC');
    const r = await room(page);
    expect([r.fit, r.compact, r.cols, r.rows]).toEqual([false, false, '', null]);
    expect(await page.evaluate(() => [...document.getElementById('ctrlABS').classList].filter((c) => !['ctrl-changed', 'ctrl-flash-out', 'ctrl-active'].includes(c)))).toEqual(['ctrl-item']);
  });
});
