/**
 * What is in the sim's folder for one car, and which library version it is: reading a fake car folder (this
 * customer's textures, cooked files split mine/theirs, the read-only flag) and identifying the applied version by
 * hash — exact, paint-only, none. Port of the tests in apps/paints/src-tauri/src/installed.rs plus read().
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const installed = require('../../modules/js/paints/installed.js');
const { roleLabel } = require('../../modules/js/paints/roles.js');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const inst = (role, sha256) => ({
  role, roleLabel: roleLabel(role), fileName: `${role}_1159839.tga`, path: '', size: 1, sha256, readOnly: false,
});
const vfile = (role, sha256) => ({ role, roleLabel: roleLabel(role), fileName: `${role}.tga`, path: '', size: 1, sha256 });
const version = (id, files) => ({
  id, name: id, path: '', files, previews: [], meta: {}, problems: [],
  hasPaint: files.some((f) => f.role === 'car'), hasSpec: files.some((f) => f.role === 'car_spec'),
});
const state = (files) => ({
  simFolder: 'lotus79', folderExists: true, files, cooked: [], cookedOtherDrivers: 0,
  appliedVersionId: null, matchKind: 'none', anyReadOnly: false,
});

test.describe('identify', () => {
  test('an exact match is found', () => {
    const s = installed.identify(state([inst('car', 'aa'), inst('car_spec', 'bb')]), [version('v13', [vfile('car', 'aa'), vfile('car_spec', 'bb')])]);
    expect(s.appliedVersionId).toBe('v13');
    expect(s.matchKind).toBe('exact');
  });

  test('a paint without its spec is half-applied', () => {
    // The state you land in when the spec map silently failed to copy.
    const s = installed.identify(state([inst('car', 'aa'), inst('car_spec', 'WRONG')]), [version('v13', [vfile('car', 'aa'), vfile('car_spec', 'bb')])]);
    expect(s.appliedVersionId).toBe('v13');
    expect(s.matchKind).toBe('paint-only');
  });

  test('exact wins over an earlier partial', () => {
    const s = installed.identify(state([inst('car', 'aa'), inst('car_spec', 'bb')]), [
      version('partial', [vfile('car', 'aa'), vfile('car_spec', 'zz')]),
      version('exact', [vfile('car', 'aa'), vfile('car_spec', 'bb')]),
    ]);
    expect(s.appliedVersionId).toBe('exact');
    expect(s.matchKind).toBe('exact');
  });

  test('a leftover texture stops it being exact', () => {
    // A decal from a previous paint is still on disk; the folder is not purely this version, and claiming
    // otherwise would hide the leftover.
    const s = installed.identify(state([inst('car', 'aa'), inst('car_spec', 'bb'), inst('car_decal', 'cc')]), [version('v13', [vfile('car', 'aa'), vfile('car_spec', 'bb')])]);
    expect(s.matchKind).toBe('paint-only');
  });

  test('nothing installed matches nothing; a version with no files is skipped', () => {
    const s = installed.identify(state([]), [version('empty', []), version('v13', [vfile('car', 'aa')])]);
    expect(s.appliedVersionId).toBeNull();
    expect(s.matchKind).toBe('none');
  });

  test('the first exact match wins when two versions are byte-identical', () => {
    const s = installed.identify(state([inst('car', 'aa')]), [version('one', [vfile('car', 'aa')]), version('two', [vfile('car', 'aa')])]);
    expect(s.appliedVersionId).toBe('one');
  });
});

test.describe('read', () => {
  let paint;
  test.beforeAll(() => {
    paint = fs.mkdtempSync(path.join(os.tmpdir(), 'racing-desk-paints-installed-'));
    const car = path.join(paint, 'lotus79');
    fs.mkdirSync(car);
    fs.writeFileSync(path.join(car, 'car_spec_1159839.tga'), 'SPEC');
    fs.writeFileSync(path.join(car, 'car_1159839.tga'), 'PAINT');
    fs.writeFileSync(path.join(car, 'car_1159839.mip'), 'cooked mine');
    fs.writeFileSync(path.join(car, 'car_spec_1159839.mip'), 'cooked mine too');
    fs.writeFileSync(path.join(car, 'car_999000.tga'), 'someone else');
    fs.writeFileSync(path.join(car, 'car_999000.mip'), 'someone else cooked');
    fs.writeFileSync(path.join(car, 'car_888.mip'), 'another stranger');
    fs.writeFileSync(path.join(car, 'helmet_1159839.tga'), 'not a car role');
    fs.writeFileSync(path.join(car, 'readme.txt'), 'x');
    fs.mkdirSync(path.join(car, 'car_1159839.tga.d'));   // a directory is never a texture
    fs.chmodSync(path.join(car, 'car_1159839.tga'), 0o444);
  });
  test.afterAll(() => {
    fs.chmodSync(path.join(paint, 'lotus79', 'car_1159839.tga'), 0o666);
    fs.rmSync(paint, { recursive: true, force: true });
  });

  test('this customer\'s textures, sorted, hashed, with the read-only flag; cooked files split mine/theirs', () => {
    const s = installed.read(paint, 'lotus79', '1159839');
    const car = path.join(paint, 'lotus79');
    expect(s.simFolder).toBe('lotus79');
    expect(s.folderExists).toBe(true);
    expect(s.files).toEqual([
      { role: 'car', roleLabel: 'Paint', fileName: 'car_1159839.tga', path: path.join(car, 'car_1159839.tga'), size: 5, sha256: sha('PAINT'), readOnly: true },
      { role: 'car_spec', roleLabel: 'Spec map', fileName: 'car_spec_1159839.tga', path: path.join(car, 'car_spec_1159839.tga'), size: 4, sha256: sha('SPEC'), readOnly: false },
    ]);
    expect(s.cooked).toEqual([path.join(car, 'car_1159839.mip'), path.join(car, 'car_spec_1159839.mip')]);
    expect(s.cookedOtherDrivers).toBe(2);
    expect(s.anyReadOnly).toBe(true);
    expect(s.appliedVersionId).toBeNull();
    expect(s.matchKind).toBe('none');
    expect(Object.keys(s).sort()).toEqual(['anyReadOnly', 'appliedVersionId', 'cooked', 'cookedOtherDrivers', 'files', 'folderExists', 'matchKind', 'simFolder']);
  });

  test('read then identify against a scanned-looking version', () => {
    const s = installed.read(paint, 'lotus79', '1159839');
    installed.identify(s, [version('v13', [vfile('car', sha('PAINT')), vfile('car_spec', sha('SPEC'))])]);
    expect(s.appliedVersionId).toBe('v13');
    expect(s.matchKind).toBe('exact');
  });

  test('another customer sees their own files only', () => {
    const s = installed.read(paint, 'lotus79', '999000');
    expect(s.files.map((f) => f.fileName)).toEqual(['car_999000.tga']);
    expect(s.cooked.map((p) => path.basename(p))).toEqual(['car_999000.mip']);
    expect(s.cookedOtherDrivers).toBe(3);
    expect(s.anyReadOnly).toBe(false);
  });

  test('no sim folder known, or the folder not there yet', () => {
    expect(installed.read(paint, null, '1159839')).toEqual({
      simFolder: null, folderExists: false, files: [], cooked: [], cookedOtherDrivers: 0,
      appliedVersionId: null, matchKind: 'none', anyReadOnly: false,
    });
    expect(installed.read(paint, 'nissangtpzxt', '1159839')).toMatchObject({ simFolder: 'nissangtpzxt', folderExists: false, files: [] });
  });
});
