/**
 * Scanning a library: folder-name normalisation, matching a car to the sim's folder (exact, loose, overridden),
 * and a version's files, previews, meta and problems — built in a temp library the shape the pipeline writes.
 * Port of the tests in apps/paints/src-tauri/src/library.rs plus the shapes src/types.ts promises.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const library = require('../../modules/js/paints/library.js');

let root;
test.beforeAll(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'racing-desk-paints-library-')); });
test.afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function lib(tag) {
  const dir = path.join(root, tag);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function version(libRoot, car, id, files) {
  const dir = path.join(libRoot, car, id);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  return dir;
}

test.describe('normalise', () => {
  test('separator differences fold away', () => {
    // The exact case in the wild.
    expect(library.normalise('mx5-mx52016')).toBe(library.normalise('mx5 mx52016'));
    expect(library.normalise('Lotus79')).toBe('lotus79');
    expect(library.normalise('astonmartin  dbr9')).toBe('astonmartin dbr9');
    expect(library.normalise(' trailing-')).toBe('trailing');
    expect(library.normalise('a_b-c  d')).toBe('a b c d');
  });

  test('different cars do not collide', () => {
    expect(library.normalise('audir8gt3')).not.toBe(library.normalise('audir8lmsevo2gt3'));
  });
});

test.describe('resolveSimFolder', () => {
  test('a meta override wins and is not inferred', () => {
    expect(library.resolveSimFolder('whatever', 'mx5 mx52016', null)).toEqual({ simFolder: 'mx5 mx52016', inferred: false });
    // A blank override is no override.
    expect(library.resolveSimFolder('whatever', '   ', null)).toEqual({ simFolder: null, inferred: false });
  });

  test('a loose match is flagged as inferred, an exact one is not', () => {
    const paint = lib('resolve-paint');
    fs.mkdirSync(path.join(paint, 'mx5 mx52016'));
    fs.mkdirSync(path.join(paint, 'lotus79'));
    expect(library.resolveSimFolder('mx5-mx52016', null, paint)).toEqual({ simFolder: 'mx5 mx52016', inferred: true });
    expect(library.resolveSimFolder('lotus79', null, paint)).toEqual({ simFolder: 'lotus79', inferred: false });
    expect(library.resolveSimFolder('nissangtpzxt', null, paint)).toEqual({ simFolder: null, inferred: false });
    expect(library.resolveSimFolder('lotus79', null, path.join(paint, 'missing'))).toEqual({ simFolder: null, inferred: false });
  });
});

test.describe('scan', () => {
  test('the shape the pipeline writes', () => {
    const l = lib('pipeline');
    const v = version(l, 'lotus79', 'v13-shatter', {
      'car_1159839.tga': 'paint', 'car_spec_1159839.tga': 'spec', 'preview_topview_nose_up.png': 'png', 'Preview_side.PNG': 'png2',
      'notes.txt': 'not a role, not a preview',
    });
    const out = library.scan(l, null);
    expect(out.root).toBe(l);
    expect(out.notes).toEqual([]);
    expect(out.cars).toHaveLength(1);
    const car = out.cars[0];
    expect(car).toMatchObject({ folder: 'lotus79', simFolder: null, simFolderInferred: false });
    expect(car.versions).toHaveLength(1);
    const ver = car.versions[0];
    expect(ver.id).toBe('v13-shatter');
    expect(ver.name).toBe('v13-shatter');   // no meta: the folder name
    expect(ver.path).toBe(v);
    expect(ver.hasPaint && ver.hasSpec).toBe(true);
    expect(ver.problems).toEqual([]);
    expect(ver.previews).toEqual([path.join(v, 'Preview_side.PNG'), path.join(v, 'preview_topview_nose_up.png')]);
    expect(ver.files).toEqual([
      { role: 'car', roleLabel: 'Paint', fileName: 'car_1159839.tga', path: path.join(v, 'car_1159839.tga'), size: 5, sha256: sha('paint') },
      { role: 'car_spec', roleLabel: 'Spec map', fileName: 'car_spec_1159839.tga', path: path.join(v, 'car_spec_1159839.tga'), size: 4, sha256: sha('spec') },
    ]);
    // Meta is always the full shape, nulls for what is missing.
    expect(ver.meta).toEqual({ name: null, created: null, notes: null, source: null, seed: null, simFolder: null });
    expect(Object.keys(ver).sort()).toEqual(['files', 'hasPaint', 'hasSpec', 'id', 'meta', 'name', 'path', 'previews', 'problems']);
  });

  test('meta.json names the version and can point at the sim folder', () => {
    const l = lib('meta');
    version(l, 'mx5-mx52016', 'v1', {
      'car.tga': 'p',
      'meta.json': JSON.stringify({ name: 'v1 Shatter', created: '2026-09-23', notes: 'matte', source: 'design/x.py', simFolder: 'mx5 mx52016', extra: 1 }),
    });
    version(l, 'mx5-mx52016', 'v2', { 'car.tga': 'q', 'meta.json': JSON.stringify({ name: '   ' }) });
    const paint = lib('meta-paint');
    fs.mkdirSync(path.join(paint, 'mx5 mx52016'));
    const out = library.scan(l, paint);
    const car = out.cars[0];
    // The override applies to the car and counts as explicit, not inferred.
    expect(car).toMatchObject({ simFolder: 'mx5 mx52016', simFolderInferred: false });
    expect(car.versions[0].name).toBe('v1 Shatter');
    expect(car.versions[0].meta).toEqual({ name: 'v1 Shatter', created: '2026-09-23', notes: 'matte', source: 'design/x.py', seed: null, simFolder: 'mx5 mx52016' });
    // A blank name falls back to the folder.
    expect(car.versions[1].name).toBe('v2');
  });

  test('without an override the sim folder is matched loosely and said so', () => {
    const l = lib('loose');
    version(l, 'mx5-mx52016', 'v1', { 'car.tga': 'p' });
    version(l, 'nissangtpzxt', 'v1', { 'car.tga': 'p' });
    const paint = lib('loose-paint');
    fs.mkdirSync(path.join(paint, 'mx5 mx52016'));
    const out = library.scan(l, paint);
    expect(out.cars[0]).toMatchObject({ folder: 'mx5-mx52016', simFolder: 'mx5 mx52016', simFolderInferred: true });
    expect(out.cars[1]).toMatchObject({ folder: 'nissangtpzxt', simFolder: null, simFolderInferred: false });
    expect(out.notes).toEqual(["No folder named nissangtpzxt in the sim's paint directory. The sim creates a car's folder the first time you drive it."]);
  });

  test('a malformed meta.json is a problem, not a hidden version', () => {
    const l = lib('badmeta');
    version(l, 'lotus79', 'v1', { 'car.tga': 'p', 'meta.json': '{ not json' });
    version(l, 'lotus79', 'v2', { 'car.tga': 'p', 'meta.json': JSON.stringify({ name: 42 }) });
    version(l, 'lotus79', 'v3', { 'car.tga': 'p', 'meta.json': '[1,2]' });
    const [v1, v2, v3] = library.scan(l, null).cars[0].versions;
    for (const v of [v1, v2, v3]) {
      expect(v.hasPaint).toBe(true);
      expect(v.problems).toHaveLength(1);
      expect(v.problems[0]).toMatch(/^meta\.json could not be read \(.+\); ignoring it\.$/);
      expect(v.meta).toEqual(library.emptyMeta());
    }
  });

  test('a version with no paint says so', () => {
    const l = lib('nopaint');
    version(l, 'lotus79', 'broken', { 'car_spec.tga': 'spec' });
    const v = library.scan(l, null).cars[0].versions[0];
    expect(v.hasPaint).toBe(false);
    expect(v.hasSpec).toBe(true);
    expect(v.problems).toEqual(['No car paint (car.tga) in this version.']);
  });

  test('two files claiming one role is a problem', () => {
    const l = lib('dupe');
    version(l, 'lotus79', 'v1', { 'car.tga': 'a', 'car_1159839.tga': 'b', 'car_spec.tga': 's' });
    const v = library.scan(l, null).cars[0].versions[0];
    expect(v.files).toHaveLength(3);
    expect(v.problems).toEqual(['2 files in this version claim the Paint role; only one can be installed.']);
  });

  test('the legacy .backups folder and other dotfolders are not cars; a car with no versions is skipped', () => {
    const l = lib('backups');
    fs.mkdirSync(path.join(l, library.LEGACY_BACKUP_DIR, 'lotus79', 'x'), { recursive: true });
    fs.mkdirSync(path.join(l, '.git', 'objects'), { recursive: true });
    fs.mkdirSync(path.join(l, 'emptycar'));
    fs.writeFileSync(path.join(l, 'README.md'), 'not a car');
    version(l, 'lotus79', 'v1', { 'car.tga': 'paint' });
    const out = library.scan(l, null);
    expect(out.cars.map((c) => c.folder)).toEqual(['lotus79']);
  });

  test('cars and versions come out sorted', () => {
    const l = lib('sorted');
    version(l, 'zcar', 'v2', { 'car.tga': 'p' });
    version(l, 'zcar', 'v10', { 'car.tga': 'p' });
    version(l, 'acar', 'v1', { 'car.tga': 'p' });
    const out = library.scan(l, null);
    expect(out.cars.map((c) => c.folder)).toEqual(['acar', 'zcar']);
    expect(out.cars[1].versions.map((v) => v.id)).toEqual(['v10', 'v2']);   // plain string order, as the Rust sorted paths
  });

  test('a root that is not a folder is a note, not an error', () => {
    const missing = path.join(root, 'no-such-library');
    expect(library.scan(missing, null)).toEqual({ root: missing, cars: [], notes: [`${missing} is not a folder.`] });
  });
});
