/**
 * The car's controls by the canonical list (modules/js/car-controls.js): what the host sends as
 * RacingDesk.Plugin.CarControls, and what the HUD makes of it — each of the three as None, Off, On, a value or a
 * mode, in words where they fit (Anti-lock, Bias, Traction slip) and else with the car's own label; the car's other
 * controls in a row of their own; DRS and push-to-pass with the spotter's word. First the module by itself, in Node; then the real dashboard.html, headless, fed a payload.
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
const { KEY, ROOM, read, view, arrange, labelPlan, signals, textOf, fillOf, announced, chooseForm, fitsWhole } = require('../../modules/js/car-controls.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD = pathToFileURL(path.resolve(__dirname, '..', '..', 'dashboard.html')).href;
const WIRE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'car-controls-wire.json'), 'utf8'));

// What the host sends for the fixture's cars (see the file above for what each shows).
const GTP = WIRE['porsche963gtp'];              // ABS none; TCLO/TCLA, MIG, the bars; a fixed setup holds the traction control
const MCLAREN_570S = WIRE['mclaren570sgt4'];    // one dial for ABS, traction and stability: Track
const MX5 = WIRE['mx5 mx52016'];                // ABS on, the rest none
const M2 = WIRE['bmwm2csr'];                    // DSC (Stability) is a word: On; MDM and Off below
const M2_MDM = WIRE['bmwm2csr mdm'];
const M2_OFF = WIRE['bmwm2csr off'];
const GT3 = WIRE['madeup gt3'];                 // ABS off, held; TC1 4
const GT3_UNREAD = WIRE['madeup gt3 unread'];   // the same car not publishing its ABS or its throttle map
const FORMULA = WIRE['madeup formula'];         // ABS none, TC none, BBAL; DRS off, push-to-pass waiting with 65
const DRS = [FORMULA, WIRE['madeup formula drs 1'], WIRE['madeup formula drs 2'], WIRE['madeup formula drs 3']];
const P2P_ON = WIRE['madeup formula p2p on'];

const withControls = (cc, extra = {}) => ({ ...MOCK_TELEMETRY, [KEY]: cc, 'DataCorePlugin.GameData.CarModel': cc.name, ...extra });
const drs = (status) => DRS[status];
const p2p = (active, count) => ({ ...FORMULA, p2p: { ...(active ? P2P_ON.p2p : FORMULA.p2p), count, text: active ? 'On' : String(count) } });

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
  test('the host\'s text in sentence case, or its number, or a dash for one that says nothing', () => {
    expect(textOf({ text: 'Track', value: 0 })).toBe('Track');
    // A SimHub plugin from before the change sends its words in capitals: shown in sentence case, an acronym as one.
    expect(textOf({ text: 'TRACK', value: 0 })).toBe('Track');
    expect(textOf({ state: 'none', text: 'NONE' })).toBe('None');
    expect(textOf({ state: 'on', text: 'ON' })).toBe('On');
    expect(textOf({ state: 'off', text: 'OFF', value: 0 })).toBe('Off');
    expect(textOf({ state: 'value', text: 'MDM', value: 1 })).toBe('MDM');
    expect(textOf({ state: 'value', text: 'SPORT+', value: 2 })).toBe('Sport+');
    expect(textOf({ state: 'value', text: 'NOT AVAILABLE', value: 0 })).toBe('Not available');
    expect(textOf({ state: 'value', text: '25%', value: 25 })).toBe('25%');
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
    expect(announced({ text: 'Sport', value: 1 })).toBe('Sport');
    expect(announced({ text: 'SPORT', value: 1 })).toBe('Sport');
    expect(announced({ value: 6 })).toBe('6');
    expect(announced({ value: 0 })).toBe('0');
    expect(announced({})).toBe('');
    expect(announced(null)).toBe('');
  });
});

test.describe('view: the panel, cell by cell', () => {
  test('None, a value with the car\'s label, and the car\'s other controls in the list\'s order', () => {
    const v = view(GTP);
    expect(v.primary.map((c) => [c.slot, c.label, c.text, c.state, c.hidden, c.locked])).toEqual([
      ['bb', 'BB', '48.25', 'value', false, false],
      ['tc', 'TCLO', '5', 'value', false, true],
      ['abs', 'ABS', 'None', 'none', false, false],
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
    expect(v.modes).toEqual([expect.objectContaining({ id: 'mode', label: 'ESC', words: 'Assists', text: 'Track', state: 'value', value: 0 })]);
    expect(v.more).toEqual([]);
  });

  test('a dial that is a word shows the word, and its off position is Off', () => {
    const v = view(M2);
    expect(v.primary.map((c) => [c.label, c.text, c.state])).toEqual([['BB', 'None', 'none'], ['DSC', 'On', 'value'], ['ABS', 'On', 'on']]);
    expect(view(M2_MDM).primary[1]).toEqual(expect.objectContaining({ label: 'DSC', text: 'MDM', state: 'value', fill: 0 }));
    expect(view(M2_OFF).primary[1]).toEqual(expect.objectContaining({ label: 'DSC', text: 'Off', state: 'off', fill: 0 }));
  });

  test('On for ABS the driver cannot turn, Off for a dial at its off position', () => {
    expect(view(MX5).primary.map((c) => [c.label, c.text, c.state])).toEqual([['BB', 'None', 'none'], ['TC', 'None', 'none'], ['ABS', 'On', 'on']]);
    const gt3 = view(GT3);
    expect(gt3.primary[2]).toEqual(expect.objectContaining({ label: 'ABS', text: 'Off', state: 'off', fill: 0, locked: true }));
    expect(gt3.primary[1]).toEqual(expect.objectContaining({ label: 'TC1', text: '4', locked: true }));
    expect(gt3.primary[0]).toEqual(expect.objectContaining({ label: 'BB', text: '56.2', locked: false }));
  });

  test('a formula car has neither ABS nor traction control, and its bias has a name of its own', () => {
    expect(view(FORMULA).primary.map((c) => [c.label, c.text, c.state])).toEqual([['BBAL', '55.0', 'value'], ['TC', 'None', 'none'], ['ABS', 'None', 'none']]);
  });

  test('a cell the host said nothing of shows a dash and its usual label', () => {
    const v = view({ car: 'x', name: '', kind: '', more: [] });
    expect(v.primary.map((c) => [c.label, c.text, c.state])).toEqual([['BB', '—', 'unknown'], ['TC', '—', 'unknown'], ['ABS', '—', 'unknown']]);
  });

  test('a control the car has and the sim is not reporting shows its own label and a dash, never a number', () => {
    const v = view(GT3_UNREAD);
    expect(v.primary[2]).toEqual(expect.objectContaining({ label: 'ABS', text: '—', state: 'unread', fill: 0, value: null, locked: false }));
    expect(v.primary[1]).toEqual(expect.objectContaining({ label: 'TC1', text: '4', state: 'value' }));
    expect(v.more).toEqual([expect.objectContaining({ id: 'throttleMap', label: 'Map', words: 'Throttle map', text: '—', state: 'unread', value: null, fill: 0 })]);
    // Whatever the host put beside it: an unread reading has no value to show.
    expect(textOf({ state: 'unread', value: 4, text: '4' })).toBe('—');
    expect(fillOf({ state: 'unread', value: 4, fill: 0.5 }, 'tc')).toBe(0);
  });

  test('the bar is the host\'s fill, or the one the HUD always drew', () => {
    const v = view({ car: 'x', more: [], bb: { state: 'value', value: 50 }, tc: { state: 'value', value: 6 }, abs: { state: 'value', value: 3, fill: 0.9 } });
    expect(v.primary.map((c) => c.fill)).toEqual([0.5, 0.5, 0.9]);
    expect(v.primary.map((c) => c.text)).toEqual(['50', '6', '3']);
  });

  test('DRS and push-to-pass come last, with whether they are ready or on', () => {
    const off = view(FORMULA);
    expect(off.more.map((c) => [c.id, c.label, c.text, c.state, c.active, c.ready, c.count])).toEqual([
      ['drs', 'DRS', 'Off', 'off', false, false, null],
      ['p2p', 'OT', '65', 'off', false, false, 65],
    ]);
    expect(view(drs(1)).more[0]).toEqual(expect.objectContaining({ text: 'Next', ready: true, active: false }));
    expect(view(drs(2)).more[0]).toEqual(expect.objectContaining({ text: 'Ready', ready: true, active: false }));
    expect(view(drs(3)).more[0]).toEqual(expect.objectContaining({ text: 'Open', ready: false, active: true }));
    expect(view(p2p(true, 64)).more[1]).toEqual(expect.objectContaining({ text: 'On', active: true, count: 64 }));
  });

  test('a car with no DRS and no push-to-pass has neither cell, whatever else it has', () => {
    for (const cc of [GTP, MCLAREN_570S, MX5, M2, GT3]) expect(view(cc).more.filter((c) => c.id === 'drs' || c.id === 'p2p'), cc.car).toEqual([]);
  });

  test('each cell in words where the list gives them, his words for the three, and the car\'s own label beside them', () => {
    // He asked on 2026-10-02: ABS anti-lock, BB bias, TC traction, MIG migration, ARB rollbar.
    const v = view(GTP);
    expect(v.primary.map((c) => [c.label, c.words])).toEqual([['BB', 'Bias'], ['TCLO', 'Traction slip'], ['ABS', 'Anti-lock']]);
    expect(v.more.map((c) => [c.label, c.words, c.mark])).toEqual([['MIG', 'Migration', null], ['TCLA', 'Traction gain', null], ['FARB', 'Front rollbar', 'F'], ['RARB', 'Rear rollbar', 'R']]);
    expect(view(MX5).primary.map((c) => c.words)).toEqual(['Bias', 'Traction', 'Anti-lock']);
    expect(view(M2).primary[1].words).toEqual('Stability');
    expect(view(FORMULA).more.map((c) => [c.label, c.words])).toEqual([['DRS', null], ['OT', 'Overtake']]);
    // A host from before the list had words (an old SimHub plugin): the label in sentence case, an acronym kept, and
    // words from the control's id where its meaning is the same in every car.
    const old = view({ car: 'x', bb: { id: 'brakeBias', label: 'BRAKE BIAS', state: 'value', value: 55, text: '55.0' }, tc: { id: 'tc', label: 'TCLO', state: 'value', value: 4, text: '4' },
      abs: { id: 'abs', label: 'ABS', state: 'none', text: 'NONE' }, more: [{ id: 'tcToggle', label: 'TC TOGGLE', state: 'value', value: 0, text: '0' }, { id: 'arbFront', label: 'AR-F', state: 'value', value: 1, text: '1' }] });
    expect(old.primary.map((c) => [c.label, c.words, c.text])).toEqual([['Brake bias', 'Bias', '55.0'], ['TCLO', null, '4'], ['ABS', 'Anti-lock', 'None']]);
    expect(old.more.map((c) => [c.label, c.words])).toEqual([['TC toggle', null], ['AR-F', 'Front rollbar']]);
  });

  test('a cell shows the longest form that is whole at its size: the words, a rollbar\'s short word with its mark, the car\'s label', () => {
    const across = (cols, size) => ({ cols, compact: size !== 'full', tight: size === 'tight' });
    const cell = (words, label, mark = null, locked = false) => ({ words, label, mark, locked });
    // Three across at the full size: every word of the list is whole.
    expect(chooseForm(cell('Front rollbar', 'FARB', 'F'), across(3, 'full'))).toEqual({ text: 'Front rollbar', mark: null });
    expect(chooseForm(cell('Traction slip', 'TCLO', null, true), across(3, 'full'))).toEqual({ text: 'Traction slip', mark: null });
    // Words too long for a cell at the floor give way: a rollbar to its short word and its mark, the rest to the label.
    expect(fitsWhole('Frontrollbarrollbar', false, across(5, 'tight'))).toBe(false);
    expect(chooseForm(cell('Frontrollbarrollbar', 'FARB', 'F'), across(5, 'tight'))).toEqual({ text: 'Rollbar', mark: 'F' });
    expect(chooseForm(cell('Differentialpreloadsetting', 'PL'), across(5, 'tight'))).toEqual({ text: 'PL', mark: null });
    // No form whole: the one that needs the least width.
    expect(chooseForm(cell('Rear lateral slip', 'Rear TC lateral slip'), across(5, 'tight')).text).toBe('Rear lateral slip');
    // In the glance layout the page measures: the words come first.
    expect(chooseForm(cell('Front rollbar', 'FARB', 'F'), null)).toEqual({ text: 'Front rollbar', mark: null });
  });
});

// A car's controls with `n` other dials beside the three (brakeBias, tc, abs as given), for the room rule.
function withDials(n, { abs = 'value', tc = 'value', bb = 'value' } = {}) {
  const reading = (id, label, state) => (state === 'none' ? { id, label, state: 'none', text: 'None' } : { id, label, state: 'value', value: 3, text: '3' });
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
      drs: { id: 'drs', label: 'DRS', state: 'off', value: 0, text: 'Off' },
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
    expect(signals(p2p(false, 65), p2p(true, 64))).toEqual([{ msg: 'Overtake on — 64s left', severity: 'sp-clear', header: 'Push to pass', category: 'p2p' }]);
    expect(signals(p2p(true, 40), p2p(false, 40))).toEqual([{ msg: 'Overtake off — 40s left', severity: 'sp-warn', header: 'Push to pass', category: 'p2p' }]);
    expect(signals(p2p(true, 1), p2p(false, 0))).toEqual([expect.objectContaining({ msg: 'Overtake off — 0s left' })]);
    expect(signals(p2p(false, 1), p2p(false, 0))).toEqual([{ msg: 'Overtake used up', severity: 'sp-danger', header: 'Push to pass', category: 'p2p' }]);
    expect(signals(p2p(false, 65), p2p(false, 65))).toEqual([]);
    expect(signals(p2p(false, undefined), p2p(true, undefined))).toEqual([expect.objectContaining({ msg: 'Overtake on' })]);
    // A host with no words for it: the car's own label.
    const bare = (active, count) => { const cc = p2p(active, count); return { ...cc, p2p: { ...cc.p2p, words: undefined } }; };
    expect(signals(bare(false, 65), bare(true, 64))).toEqual([expect.objectContaining({ msg: 'OT on — 64s left' })]);
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
  test('a GTP car: ABS none, the dials in words (TCLO is Traction slip), the rest in a row beneath', async ({ page }) => {
    await openWith(page, withControls(GTP));
    await expect(page.locator('#ctrlTC .ctrl-label')).toHaveText('Traction slip');
    const p = await panel(page);
    expect(p.listed).toBe(true);
    expect(p.noAdj).toBe(false);
    // ABS NONE: six real cells fill the rig panel's two rows at the full size, so the NONE cell is omitted (the room
    // rule, below) — drawn all the same, with the host's word, for the glance layout and for a car with room.
    expect(p.cells.map((c) => [c.id, c.label, c.value, c.shown])).toEqual([
      ['ctrlBB', 'Bias', '48.25', true], ['ctrlTC', 'Traction slip', '5', true], ['ctrlABS', 'Anti-lock', 'None', false],
    ]);
    expect(p.cells[1].classes).toEqual(['ctrl-locked']);
    expect(p.cells[1].pct).toBe('36%');
    expect(p.cells[2].classes).toEqual(['ctrl-none', 'ctrl-omitted']);
    expect(p.cells[2].valueClasses).toEqual(['ctrl-value-fixed']);
    expect(p.hasMore).toBe(true);
    expect(p.more.map((c) => [c.id, c.label, c.value])).toEqual([['brakeMigration', 'Migration', '-2'], ['tc2', 'Traction gain', '4'], ['arbFront', 'Front rollbar', '1'], ['arbRear', 'Rear rollbar', '15']]);
    // Traction control's second dial is held by the fixed setup as the first is; the migration and the bars are his.
    expect(p.more.map((c) => c.classes.includes('ctrl-mini-locked'))).toEqual([false, true, false, false]);
  });

  test('the same car sent as text, as the WebSocket feed sends it, is the same panel', async ({ page }) => {
    await openWith(page, withControls(JSON.stringify(GTP), { 'DataCorePlugin.GameData.CarModel': GTP.name }));
    await expect(page.locator('#ctrlTC .ctrl-label')).toHaveText('Traction slip');
    const p = await panel(page);
    expect(p.cells.map((c) => [c.label, c.value])).toEqual([['Bias', '48.25'], ['Traction slip', '5'], ['Anti-lock', 'None']]);
    expect(p.more.map((c) => c.label)).toEqual(['Migration', 'Traction gain', 'Front rollbar', 'Rear rollbar']);
  });

  test('a car whose dial is a mode shows the mode, and the cells it covers take no space', async ({ page }) => {
    await openWith(page, withControls(MCLAREN_570S));
    await expect(page.locator('#ctrlMode .ctrl-value')).toHaveText('Track');
    const p = await panel(page);
    expect(p.cells.map((c) => [c.id, c.label, c.value, c.shown])).toEqual([
      ['ctrlBB', 'Bias', 'None', true], ['ctrlTC', 'Traction', '—', false], ['ctrlABS', 'Anti-lock', '—', false], ['ctrlMode', 'Assists', 'Track', true],
    ]);
    expect(p.cells[3].classes).toEqual(['ctrl-mode']);
    expect(p.cells[3].valueClasses).toEqual(['ctrl-value-fixed']);
    expect(p.hasMore).toBe(false);
  });

  test('Anti-lock the driver cannot turn is On; a car with nothing to turn reads None, not "no adjustments"', async ({ page }) => {
    await openWith(page, withControls(MX5));
    await expect(page.locator('#ctrlABS .ctrl-value')).toHaveText('On');
    const p = await panel(page);
    expect(p.cells.map((c) => [c.label, c.value, c.classes])).toEqual([['Bias', 'None', ['ctrl-none']], ['Traction', 'None', ['ctrl-none']], ['Anti-lock', 'On', ['ctrl-on']]]);
    expect(p.noAdj).toBe(false);
    expect(p.hasMore).toBe(false);
  });

  test('a formula car: no ABS, no traction control, and the bias by its own name', async ({ page }) => {
    await openWith(page, withControls(FORMULA));
    await expect(page.locator('#ctrlBB .ctrl-label')).toHaveText('Bias');
    const p = await panel(page);
    // Its real cells are the bias, DRS and push-to-pass: a row of three. The two NONE cells have no slot left in it, so
    // they are omitted (kept in the panel, not shown).
    expect(p.cells.map((c) => [c.id, c.label, c.value, c.classes])).toEqual([
      ['ctrlBB', 'Bias', '55.0', []], ['ctrlTC', 'Traction', 'None', ['ctrl-none', 'ctrl-omitted']], ['ctrlABS', 'Anti-lock', 'None', ['ctrl-none', 'ctrl-omitted']],
    ]);
    expect(p.cells.map((c) => c.shown)).toEqual([true, false, false]);
    expect(p.noAdj).toBe(false);
  });

  test('Anti-lock off in a fixed setup is Off, and marked as held', async ({ page }) => {
    await openWith(page, withControls(GT3));
    await expect(page.locator('#ctrlABS .ctrl-value')).toHaveText('Off');
    const p = await panel(page);
    expect(p.cells[2].classes).toEqual(['ctrl-locked', 'ctrl-off']);
    expect(p.cells[2].pct).toBe('0%');
    expect(p.cells[1].classes).toEqual(['ctrl-locked']);
    expect(p.cells[0].classes).toEqual([]);
    expect(p.more.map((c) => [c.label, c.value])).toEqual([['Throttle map', '2']]);
  });

  test('a dial that is a word: On, then MDM by name, then Off, each announced in words', async ({ page }) => {
    await openWith(page, withControls(M2));
    await expect(page.locator('#ctrlTC .ctrl-label')).toHaveText('Stability');
    let p = await panel(page);
    expect(p.cells.map((c) => [c.label, c.value, c.classes])).toEqual([['Bias', 'None', ['ctrl-none']], ['Stability', 'On', []], ['Anti-lock', 'On', ['ctrl-on']]]);

    await serve(page, withControls(M2_MDM));
    await expect(page.locator('#ctrlTC .ctrl-value')).toHaveText('MDM');
    p = await panel(page);
    expect(p.cells[1].valueClasses).toEqual(['ctrl-value-fixed']);
    expect(p.cells[1].pct, 'a name is not a quantity: no bar').toBe('0%');
    await serve(page, withControls(M2_OFF));
    await expect(page.locator('#ctrlTC .ctrl-value')).toHaveText('Off');
    p = await panel(page);
    expect(p.cells[1].classes).toEqual(['ctrl-off']);
    expect(p.cells[1].pct).toBe('0%');
    await expect.poll(() => spotter(page).then((s) => s.filter((c) => c.header === 'Adjustment').map((c) => c.msg)))
      .toEqual(expect.arrayContaining(['Stability ▼ Off']));
  });

  test('a change is flashed and announced in words', async ({ page }) => {
    await openWith(page, withControls(GTP));
    await expect(page.locator('#ctrlTC .ctrl-value')).toHaveText('5');
    await serve(page, withControls({ ...GTP, tc: { ...GTP.tc, value: 6, text: '6' }, more: [{ ...GTP.more[0], value: -1, text: '-1' }, ...GTP.more.slice(1)] }));
    await expect(page.locator('#ctrlTC .ctrl-value')).toHaveText('6');
    await expect.poll(() => spotter(page)).toEqual(expect.arrayContaining([
      expect.objectContaining({ header: 'Adjustment', msg: 'Traction slip ▲ 6', adj: 'tc' }),
      expect.objectContaining({ header: 'Adjustment', msg: 'Migration ▲ -1', adj: 'brakeMigration' }),
    ]));
    expect(await page.evaluate(() => document.querySelector('[data-id="brakeMigration"]').classList.contains('ctrl-mini-changed'))).toBe(true);

    await serve(page, withControls({ ...MCLAREN_570S, more: [{ ...MCLAREN_570S.more[0], value: 1, text: 'Sport' }] }));
    await expect(page.locator('#ctrlMode .ctrl-value')).toHaveText('Sport');
    await serve(page, withControls(MCLAREN_570S));
    await expect(page.locator('#ctrlMode .ctrl-value')).toHaveText('Track');
    await expect.poll(() => spotter(page)).toEqual(expect.arrayContaining([expect.objectContaining({ msg: 'Assists ▼ Track', adj: 'mode' })]));
  });

  test('the rollbars are announced in words', async ({ page }) => {
    await openWith(page, withControls(GTP));
    await expect(page.locator('[data-id="arbRear"] .ctrl-mini-value')).toHaveText('15');
    const bars = (front, rear) => withControls({ ...GTP, more: GTP.more.map((m) => m.id === 'arbFront' ? { ...m, value: front, text: String(front) } : m.id === 'arbRear' ? { ...m, value: rear, text: String(rear) } : m) });
    await serve(page, bars(2, 14));
    await expect(page.locator('[data-id="arbRear"] .ctrl-mini-value')).toHaveText('14');
    await expect.poll(() => spotter(page).then((s) => s.map((c) => c.msg))).toEqual(expect.arrayContaining(['Front rollbar ▲ 2', 'Rear rollbar ▼ 14']));
  });

  test('DRS and push-to-pass: their cells, and the spotter as they change', async ({ page }) => {
    await openWith(page, withControls(FORMULA));
    await expect(page.locator('[data-id="drs"] .ctrl-mini-value')).toHaveText('Off');
    expect((await panel(page)).more.map((c) => [c.id, c.label, c.value, c.classes])).toEqual([['drs', 'DRS', 'Off', ['ctrl-mini-off']], ['p2p', 'Overtake', '65', ['ctrl-mini-off']]]);

    await serve(page, withControls(drs(1)));
    await expect(page.locator('[data-id="drs"] .ctrl-mini-value')).toHaveText('Next');
    await expect.poll(() => spotter(page)).toEqual(expect.arrayContaining([expect.objectContaining({ header: 'DRS', msg: 'DRS next zone', cat: 'drs' })]));
    await serve(page, withControls(drs(2)));
    await expect(page.locator('[data-id="drs"]')).toHaveClass(/ctrl-mini-ready/);
    await expect.poll(() => spotter(page).then((s) => s.filter((c) => c.cat === 'drs').map((c) => c.msg))).toEqual(['DRS — open it']);
    await serve(page, withControls(drs(3)));
    await expect(page.locator('[data-id="drs"]')).toHaveClass(/ctrl-mini-active/);
    await expect(page.locator('[data-id="drs"] .ctrl-mini-value')).toHaveText('Open');

    await serve(page, withControls(p2p(true, 64)));
    await expect(page.locator('[data-id="p2p"] .ctrl-mini-value')).toHaveText('On');
    await expect(page.locator('[data-id="p2p"]')).toHaveClass(/ctrl-mini-active/);
    await expect.poll(() => spotter(page).then((s) => s.filter((c) => c.cat === 'p2p').map((c) => c.msg))).toEqual(['Overtake on — 64s left']);
    const adjustments = (await spotter(page)).filter((c) => c.header === 'Adjustment');
    expect(adjustments).toEqual([]);
  });

  test('a car with neither shows neither, and the spotter is left alone by what it publishes', async ({ page }) => {
    // Every car publishes the push-to-pass variables; the host says nothing of them for a car that has none.
    await openWith(page, withControls(GTP, { 'DataCorePlugin.GameRawData.Telemetry.P2P_Status': 1, 'DataCorePlugin.GameRawData.Telemetry.P2P_Count': 65, 'DataCorePlugin.GameRawData.Telemetry.DRS_Status': 2 }));
    await expect(page.locator('#ctrlTC .ctrl-label')).toHaveText('Traction slip');
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
    await expect(page.locator('#ctrlMode .ctrl-value')).toHaveText('Track');
    await serve(page, withControls(GT3));
    await expect(page.locator('#ctrlABS .ctrl-value')).toHaveText('Off');
    const p = await panel(page);
    expect(p.cells.map((c) => [c.id, c.label, c.value, c.shown])).toEqual([
      ['ctrlBB', 'Bias', '56.2', true], ['ctrlTC', 'TC1', '4', true], ['ctrlABS', 'Anti-lock', 'Off', true],
    ]);
    expect(p.more.map((c) => [c.id, c.label, c.value])).toEqual([['throttleMap', 'Throttle map', '2']]);
    // Give the spotter time to say something it should not.
    await page.waitForTimeout(400);
    expect((await spotter(page)).filter((c) => c.header === 'Adjustment')).toEqual([]);

    await serve(page, withControls(FORMULA));
    await expect(page.locator('#ctrlBB .ctrl-value')).toHaveText('55.0');
    expect((await panel(page)).more.map((c) => c.id)).toEqual(['drs', 'p2p']);
    await page.waitForTimeout(400);
    expect((await spotter(page)).filter((c) => c.header === 'Adjustment')).toEqual([]);
  });

  test('without the key the panel is as it was, and a car that leaves the list goes back to it', async ({ page }) => {
    await openWith(page, MOCK_TELEMETRY);
    await expect(page.locator('#ctrlBB .ctrl-value')).toHaveText('56.2');
    const before = await panel(page);
    expect(before.listed).toBe(false);
    expect(before.cells.map((c) => [c.label, c.value, c.classes])).toEqual([['Bias', '56.2', []], ['Traction', '4', []], ['Anti-lock', '3', []]]);
    expect(before.hasMore).toBe(false);

    await serve(page, withControls(GTP));
    await expect(page.locator('#ctrlTC .ctrl-label')).toHaveText('Traction slip');
    await serve(page, MOCK_TELEMETRY);
    await expect(page.locator('#ctrlTC .ctrl-label')).toHaveText('Traction');
    const after = await panel(page);
    expect(after.listed).toBe(false);
    expect(after.cells.map((c) => [c.id, c.label, c.value, c.classes])).toEqual(before.cells.map((c) => [c.id, c.label, c.value, c.classes]));
    expect(after.hasMore).toBe(false);

    // and from a car with a mode: its cell goes, and the cells it covered are shown again
    await serve(page, withControls(MCLAREN_570S));
    await expect(page.locator('#ctrlMode .ctrl-value')).toHaveText('Track');
    await serve(page, MOCK_TELEMETRY);
    await expect(page.locator('#ctrlTC .ctrl-value')).toHaveText('4');
    const back = await panel(page);
    expect(back.cells.map((c) => [c.id, c.label, c.value, c.shown])).toEqual([['ctrlBB', 'Bias', '56.2', true], ['ctrlTC', 'Traction', '4', true], ['ctrlABS', 'Anti-lock', '3', true]]);
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
    expect(p.cells.map((c) => [c.label, c.value])).toEqual([['Bias', '56.2'], ['Traction', 'Off'], ['Anti-lock', 'Off']]);
    for (const cell of p.cells) expect(cell.classes.filter((c) => /^ctrl-(none|on|off|mode|locked)$/.test(c)), cell.label).toEqual([]);
    expect(p.hasMore).toBe(false);
    expect(await page.evaluate(() => [...document.querySelectorAll('.car-controls *')].some((e) => /^(NONE|None)$/.test((e.children.length ? '' : e.textContent).trim())))).toBe(false);
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
      ['ctrlBB', 'Bias', '56.2', []], ['ctrlTC', 'TC1', '4', []], ['ctrlABS', 'Anti-lock', '—', ['ctrl-unread']],
    ]);
    expect(p.cells[2].pct).toBe('0%');
    expect(p.more.map((c) => [c.id, c.label, c.value, c.classes])).toEqual([['throttleMap', 'Throttle map', '—', ['ctrl-mini-unread']]]);
    expect(await page.evaluate(() => [
      getComputedStyle(document.querySelector('#ctrlABS .ctrl-value')).opacity,
      getComputedStyle(document.querySelector('[data-id="throttleMap"] .ctrl-mini-value')).opacity,
    ])).toEqual(['0.35', '0.35']);

    // The car begins to publish both: the numbers appear, and the spotter says nothing of it (he turned no dial).
    await serve(page, withControls({ ...GT3, fixedSetup: false, abs: { ...GT3.abs, locked: undefined }, tc: { ...GT3.tc, locked: undefined } }));
    await expect(page.locator('#ctrlABS .ctrl-value')).toHaveText('Off');
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
    expect(p.cells.map((c) => [c.label, c.value])).toEqual([['Bias', '56.2'], ['Traction', '4'], ['Anti-lock', '3']]);
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
  test('a car with nothing to turn: three cells in one row, as wide as each other, None last', async ({ page }) => {
    await openWith(page, withControls(MX5));
    await expect(page.locator('#ctrlABS .ctrl-value')).toHaveText('On');
    await expect.poll(() => room(page).then((r) => r.fit)).toBe(true);
    await settled(page);
    const r = await room(page);
    expect([r.fit, r.compact, r.cols, r.rows]).toEqual([true, false, '3', '1']);
    expect(r.cells.map((c) => c.key)).toEqual(['bb', 'tc', 'abs']);
    expect(new Set(r.cells.map((c) => c.y)).size).toBe(1);
    expect(Math.max(...r.cells.map((c) => c.w)) - Math.min(...r.cells.map((c) => c.w))).toBeLessThanOrEqual(2);
    expect(r.cells.every((c) => c.inside)).toBe(true);
    // Left to right: the real one, then the two that say None.
    expect([...r.cells].sort((a, b) => a.x - b.x).map((c) => c.key)).toEqual(['abs', 'bb', 'tc']);
  });

  test('a GT3 with a map beside the three: two rows of two inside the panel\'s own height, the pedals as tall as ever', async ({ page }) => {
    await openWith(page, withControls(MX5));
    await expect(page.locator('#ctrlABS .ctrl-value')).toHaveText('On');
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
    await expect(page.locator('#ctrlABS .ctrl-value')).toHaveText('On');
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
    await expect(page.locator('#ctrlMode .ctrl-label')).toHaveText('Assists');
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
    await expect(page.locator('#ctrlABS .ctrl-value')).toHaveText('On');
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
    fourteen.drs = { id: 'drs', label: 'DRS', state: 'off', value: 0, text: 'Off' };
    await serve(page, withControls(fourteen));
    await expect(page.locator('[data-id="drs"] .ctrl-mini-value')).toHaveText('Off');
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
    cc.more[0] = { id: 'mguDeploy', label: 'HYS deploy mode', state: 'value', value: 1, text: 'Automatic' };
    await openWith(page, withControls(cc));
    await expect(page.locator('[data-id="mguDeploy"] .ctrl-mini-value')).toHaveText('Automatic');
    await settled(page);
    const r = await room(page);
    const cell = r.cells.find((c) => c.key === 'mguDeploy');
    expect(cell.valuePx).toBeLessThanOrEqual(10);
    expect(cell.valuePx).toBeGreaterThanOrEqual(7);
    expect(cell.inside).toBe(true);
    expect(cell.valueOverflows, 'Automatic whole, four across').toBe(false);
    expect(await page.evaluate(() => [...document.querySelector('[data-id="mguDeploy"] .ctrl-mini-value').classList].sort())).toEqual(['ctrl-mini-value', 'ctrl-mini-word', 'ctrl-value-long']);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('[data-id="mguDeploy"] .ctrl-mini-label')).textOverflow)).toBe('ellipsis');
  });

  test('a label is set as large as its cell holds it, takes a second line where one would not, and is cut only past that', async ({ page }) => {
    // The headless page has no Sofia Pro Comp (nothing is let through to Typekit: the page's font is the fallback,
    // half as wide again), so what is held to here is what the stylesheet works out from what the module says: the
    // length (--ctrl-label-len), the second line (.ctrl-label-2l), the type's own size and the floor of 7px. That every
    // label of the car list is whole in the page's own font is measured with it (car-controls-fit.spec.mjs).
    // Three across: words of ten letters at the panel's size, as the short ones.
    const full = withDials(2);
    full.bb = { ...full.bb, words: 'Brake bias' };
    await openWith(page, withControls(full));
    await expect(page.locator('#ctrlBB .ctrl-label')).toHaveText('Brake bias');
    await settled(page);
    let r = await room(page);
    expect([r.compact, r.cols]).toEqual([false, '3']);
    let bb = r.cells.find((c) => c.key === 'bb'), tc = r.cells.find((c) => c.key === 'tc');
    expect([bb.labelLen, bb.labelTwoLines, bb.labelPx, tc.labelPx]).toEqual(['10', false, 10, 10]);

    // Four across: TC toggle on one line; the labels of a GTP on two, as wide as the wider line; one word no line can
    // break stays on one, down to the floor, and is cut there with an ellipsis (a label with no words to give way to).
    const compact = withDials(5);
    compact.more[0] = { ...compact.more[0], label: 'TC toggle' };
    compact.more[1] = { ...compact.more[1], label: 'Rear TC lateral slip' };
    compact.more[2] = { ...compact.more[2], label: 'Brake migration' };
    compact.more[3] = { ...compact.more[3], label: 'Throttleshapexxxx' };
    await serve(page, withControls(compact));
    await expect(page.locator('[data-id="dial2"] .ctrl-mini-label')).toHaveText('Rear TC lateral slip');
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
    expect(r.cells.map((c) => c.key), 'every cell shown, None among them, in the list\'s order').toEqual(['bb', 'tc', 'abs', 'brakeMigration', 'tc2', 'arbFront', 'arbRear']);
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
    await expect(page.locator('#ctrlTC .ctrl-label')).toHaveText('Traction');
    const r = await room(page);
    expect([r.fit, r.compact, r.cols, r.rows]).toEqual([false, false, '', null]);
    expect(await page.evaluate(() => [...document.getElementById('ctrlABS').classList].filter((c) => !['ctrl-changed', 'ctrl-flash-out', 'ctrl-active'].includes(c)))).toEqual(['ctrl-item']);
  });
});
