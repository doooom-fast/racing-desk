/**
 * The Cars page's rows of a car's controls (apps/paints/src/rig.ts `controlLine`, `labelBeside`, `functionWords`, drawn by
 * components/CarControls.tsx): each control says its name once. A review of 2026-10-02 found "Fuel cut [Fuel cut]",
 * "Bias [Brake bias]", "Brake bias [Bias]" and "MGU deploy [Deploy mode]" — a name beside itself, and an acronym describing
 * a label that is words already. The line is the list's words, else the car's own label where that is words, else what the
 * control is for; the car's label is beside it only where it says more (its abbreviation, or a name of its own).
 *
 * rig.ts is read as it is, by Node's own type stripping: nothing here bundles it.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, CAR_LIST } from './words-scan.mjs';

const rig = await import(pathToFileURL(path.join(ROOT, 'apps', 'paints', 'src', 'rig.ts')).href);
const LIST = JSON.parse(fs.readFileSync(CAR_LIST, 'utf8'));

const control = (c) => ({ id: c.id, label: c.label ?? null, words: c.words ?? null, positions: [], range: null, off: null, variable: null, covers: null });
const squash = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const ALLOWED_CAPS = ['DRS', 'ESC', 'IBS', 'LF', 'RF', 'LR', 'RR'];

test.describe('the Cars page names each control once', () => {
  test('across the whole list: no row says its name twice, and no line is an acronym where the car\'s label is words', () => {
    const twice = [], shouting = [], lines = new Map();
    let n = 0;
    for (const car of LIST.cars) {
      for (const c of car.controls || []) {
        const ctl = control(c);
        const line = rig.controlLine(ctl);
        const chip = rig.labelBeside(line, ctl.id, ctl.label);
        n++;
        lines.set(`${ctl.id} | ${ctl.label} | ${ctl.words}`, [line, chip]);
        // (whole words: ENT is not in "Entry diff")
        const within = (a, b) => ` ${squash(b)} `.includes(` ${squash(a)} `);
        if (chip && (within(chip, line) || within(line, chip))) twice.push(`${car.path} ${ctl.id}: ${line} [${chip}]`);
        // A word in capitals in the line that is not an acronym of the Cars page (MGU is "Hybrid" now).
        if (line.split(/\s+/).some((w) => /[A-Z]{2,}/.test(w) && !ALLOWED_CAPS.includes(w))) shouting.push(`${car.path} ${ctl.id}: ${line}`);
      }
    }
    expect(n).toBeGreaterThan(400);
    expect(twice, twice.join('\n')).toEqual([]);
    expect(shouting, shouting.join('\n')).toEqual([]);
  });

  test('the line is the words, else the car\'s own label where that is words, else what the control is for', () => {
    // The words win, and the car's label is beside them only where it says more.
    expect([rig.controlLine(control({ id: 'brakeBias', label: 'Brake bias', words: 'Bias' })), rig.labelBeside('Bias', 'brakeBias', 'Brake bias')]).toEqual(['Bias', null]);
    expect([rig.controlLine(control({ id: 'tc', label: 'TCLO', words: 'Traction slip' })), rig.labelBeside('Traction slip', 'tc', 'TCLO')]).toEqual(['Traction slip', 'TCLO']);
    expect(rig.labelBeside('Throttle map', 'throttleMap', 'Pedal'), 'a name of its own says more').toBe('Pedal');
    expect(rig.labelBeside('Entry diff', 'diffEntry', 'ENT'), 'ENT is not a word of "Entry diff"').toBe('ENT');
    expect(rig.labelBeside('Rear rollbar', 'arbRear', 'AR-R'), 'AR-R is not in "Rear rollbar" (ar r is, as letters)').toBe('AR-R');
    expect(rig.labelBeside('Migration', 'brakeMigration', 'MIG'), 'MIG is not in "Migration"').toBe('MIG');
    expect(rig.labelBeside('Anti-lock', 'abs', 'ABS'), 'the dial\'s generic label').toBeNull();
    expect(rig.labelBeside('Brake bias', 'brakeBias', 'BB'), 'the dial\'s generic label').toBeNull();
    // No words: a label of words is the line and nothing is beside it.
    for (const [id, label] of [['fuelCut', 'Fuel cut'], ['brakeMagic', 'Brake magic'], ['lineLock', 'Line lock'], ['launch', 'Launch rpm'], ['launch', 'Start limit'], ['wingTop', 'Top wing'], ['mguDeploy', 'Deploy mode'], ['fuelMix', 'Fuel map']]) {
      expect([rig.controlLine(control({ id, label })), rig.labelBeside(rig.controlLine(control({ id, label })), id, label)], `${id} ${label}`).toEqual([label, null]);
    }
    // A label that is only a part of what the control is for says less than that does.
    expect(rig.controlLine(control({ id: 'diffPreload', label: 'Diff' }))).toBe('Diff preload');
    expect(rig.controlLine(control({ id: 'mguDeploy', label: 'Deploy' }))).toBe('Hybrid deploy');
    expect(rig.labelBeside('Diff preload', 'diffPreload', 'Diff')).toBeNull();
    // An abbreviation with no words says what the control is for, and is beside it.
    expect([rig.controlLine(control({ id: 'tc', label: 'TCLON' })), rig.labelBeside('Traction control', 'tc', 'TCLON')]).toEqual(['Traction control', 'TCLON']);
    expect(rig.controlLine(control({ id: 'tc2', label: 'TCLAT' }))).toBe('Traction control 2');
  });

  test('what a control is for spells MGU out, and has his words for ABS, TC and ARB', () => {
    expect(rig.functionWords('mguDeploy')).toBe('Hybrid deploy');
    expect(rig.functionWords('mguDeployFixed')).toBe('Hybrid deploy fixed');
    expect(rig.functionWords('tcToggle')).toBe('Traction toggle');
    expect(rig.functionWords('absToggle')).toBe('Anti-lock toggle');
    expect(rig.functionWords('arbFront')).toBe('Front rollbar');
    expect(rig.functionWords('brakeBiasFine')).toBe('Brake bias fine');
    // An acronym that stays one.
    expect(rig.functionWords('esc')).toBe('ESC');
    expect(rig.functionWords('drs')).toBe('DRS');
  });

  test('whether a label is the car\'s abbreviation', () => {
    for (const label of ['TCLO', 'AR-F', 'TC toggle', 'MGU deploy', 'ABS/TC/ESC', 'BB+/BB-']) expect(rig.isAbbreviated(label), label).toBe(true);
    for (const label of ['Fuel cut', 'Brake magic', 'Deploy mode', 'Bias', 'Rollbar F', 'Top wing']) expect(rig.isAbbreviated(label), label).toBe(false);
  });
});
