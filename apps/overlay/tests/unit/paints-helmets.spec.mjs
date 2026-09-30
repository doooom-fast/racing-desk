/**
 * The library's helmets: reading its helmet list as far as it can be trusted, which set a version comes with, the
 * file a set is copied from — only one under the library's helmets folder, only a true-colour TGA the sim could
 * load — and the library's default set. All in a temp library with generated TGAs; every id is made up, and the
 * library's file names carry a different one from the app's, as the real library's do.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const helmets = require('../../modules/js/paints/helmets.js');

// The id the library's file names carry. It is never the app's: the sim gets the file under the app's own id.
const LIBRARY_ID = '31337';

let root;
test.beforeAll(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'racing-desk-paints-helmets-')); });
test.afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

// A true-colour uncompressed TGA of one colour, top row first — the shape the pipeline writes, at a size a test
// can afford. TGA keeps colour as BGR(A).
function tga(w, h, [r, g, b] = [220, 55, 20], { bits = 24, imageType = 2, colorMapType = 0 } = {}) {
  const head = Buffer.alloc(18);
  head[1] = colorMapType;
  head[2] = imageType;
  head.writeUInt16LE(w, 12);
  head.writeUInt16LE(h, 14);
  head[16] = bits;
  head[17] = bits === 32 ? 0x28 : 0x20;
  const px = bits === 32 ? [b, g, r, 0xff] : bits === 24 ? [b, g, r] : [r];
  return Buffer.concat([head, Buffer.from(Array.from({ length: w * h }, () => px).flat())]);
}

// A library at <root>/<tag>: cars are not needed here, only the helmets folder as the pipeline writes it.
function library(tag) {
  const dir = path.join(root, tag);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const setFile = (set) => `helmets/${set}/helmet_${LIBRARY_ID}.tga`;

// Write helmets/manifest.json and one TGA per set named, as build_helmets.py does. `sets` is
// { <name>: { body, art, file? } }; a set with `file: false` is named in the list but has no file on disk.
function withHelmets(lib, { sets, variants = {}, fallback = null, customerId = LIBRARY_ID }, { write = true } = {}) {
  const manifest = { customer_id: customerId, default: fallback, sets: {}, variants };
  for (const [name, entry] of Object.entries(sets)) {
    const file = entry.file === undefined || entry.file === false ? setFile(name) : entry.file;
    manifest.sets[name] = { file, body: entry.body ?? [10, 10, 10], art: entry.art ?? [220, 55, 20] };
    if (write && entry.file === undefined) {
      const p = path.join(lib, file);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, entry.bytes ?? tga(2, 2, entry.art ?? [220, 55, 20]));
    }
  }
  fs.mkdirSync(path.join(lib, 'helmets'), { recursive: true });
  fs.writeFileSync(path.join(lib, 'helmets', 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

const FIVE = {
  sets: {
    shatter: { body: [10, 10, 10], art: [220, 55, 20] },
    'shatter-inverted': { body: [220, 55, 20], art: [10, 10, 10] },
    'white-orange': { body: [235, 235, 235], art: [220, 55, 20] },
  },
  variants: {
    'lotus79/v13-shatter': 'shatter',
    'lotus79/v14-inverted': 'shatter-inverted',
    'mx5-mx52016/white-orange': 'white-orange',
    'porsche963gtp/shatter': 'shatter',
  },
  fallback: 'shatter',
};

test.describe('readManifest', () => {
  test('a library with no helmets, and none at all, is found to keep none — quietly', () => {
    expect(helmets.readManifest('')).toEqual({ found: false, reason: 'no-library', default: null, sets: {}, refused: {}, variants: {}, notes: [] });
    expect(helmets.readManifest(null)).toMatchObject({ found: false, reason: 'no-library' });
    expect(helmets.readManifest(library('bare'))).toMatchObject({ found: false, reason: 'no-manifest', notes: [] });
    expect(helmets.readManifest(path.join(root, 'nowhere'))).toMatchObject({ found: false, reason: 'no-manifest' });
  });

  test('a list that cannot be read is said, and nothing of it is used', () => {
    const lib = library('malformed');
    fs.mkdirSync(path.join(lib, 'helmets'));
    fs.writeFileSync(path.join(lib, 'helmets', 'manifest.json'), '{ not json');
    const bad = helmets.readManifest(lib);
    expect(bad).toMatchObject({ found: false, reason: 'malformed', sets: {}, variants: {} });
    expect(bad.notes).toHaveLength(1);
    expect(bad.notes[0]).toMatch(/^The helmet list could not be read \(.+\)\.$/);

    fs.writeFileSync(path.join(lib, 'helmets', 'manifest.json'), JSON.stringify({ default: 'shatter' }));
    expect(helmets.readManifest(lib)).toMatchObject({ found: false, reason: 'malformed', notes: ['The helmet list is not in the shape the app reads.'] });
    fs.writeFileSync(path.join(lib, 'helmets', 'manifest.json'), '[1, 2]');
    expect(helmets.readManifest(lib)).toMatchObject({ found: false, reason: 'malformed' });
  });

  test('the shape the pipeline writes: sets with their colours, the variants, the default — and never the customer id', () => {
    const lib = library('pipeline');
    withHelmets(lib, FIVE);
    const m = helmets.readManifest(lib);
    expect(m.found).toBe(true);
    expect(m.reason).toBeNull();
    expect(m.default).toBe('shatter');
    expect(m.sets).toEqual({
      shatter: { file: path.join('helmets', 'shatter', `helmet_${LIBRARY_ID}.tga`), body: [10, 10, 10], art: [220, 55, 20] },
      'shatter-inverted': { file: path.join('helmets', 'shatter-inverted', `helmet_${LIBRARY_ID}.tga`), body: [220, 55, 20], art: [10, 10, 10] },
      'white-orange': { file: path.join('helmets', 'white-orange', `helmet_${LIBRARY_ID}.tga`), body: [235, 235, 235], art: [220, 55, 20] },
    });
    expect(m.variants).toEqual(FIVE.variants);
    expect(m.refused).toEqual({});
    expect(m.notes).toEqual([]);
    // The id the list carries is not read: the app names what it writes with its own. (The files' names carry it,
    // as the library's do, and they are read only to copy from.)
    expect(Object.keys(m).sort()).toEqual(['default', 'found', 'notes', 'reason', 'refused', 'sets', 'variants']);
    expect(m.notes.join(' ')).not.toContain(LIBRARY_ID);
  });

  test('a set whose file is not under the helmets folder is refused with a note; its variants remember it, the default does not', () => {
    const lib = library('outside');
    withHelmets(lib, {
      sets: {
        shatter: {},
        up: { file: '../car_424242.tga' },
        drive: { file: 'C:\\Users\\x\\helmet.tga' },
        sneaky: { file: 'helmets/../../x/helmet.tga' },
        elsewhere: { file: 'cars/lotus79/helmet.tga' },
        rooted: { file: '/helmets/x/helmet.tga' },
        png: { file: 'helmets/x/helmet.png' },
        bare: { file: 'helmets' },
        none: { file: 7 },
      },
      variants: { 'a/1': 'shatter', 'a/2': 'up', 'a/3': 'png', 'a/4': 'never-listed', 'a/5': 7 },
      fallback: 'up',
    });
    const m = helmets.readManifest(lib);
    expect(Object.keys(m.sets)).toEqual(['shatter']);
    expect(Object.keys(m.refused).sort()).toEqual(['bare', 'drive', 'elsewhere', 'none', 'png', 'rooted', 'sneaky', 'up']);
    expect(m.refused.up).toBe("The up helmet names a file outside the library's helmets folder, so it is not used.");
    expect(m.notes).toHaveLength(8);
    // A variant naming a refused set is kept, so the version can say why its helmet is left alone; one naming a
    // set the list never had, or not a set at all, is dropped.
    expect(m.variants).toEqual({ 'a/1': 'shatter', 'a/2': 'up', 'a/3': 'png' });
    // The default can only be a set that may be used.
    expect(m.default).toBeNull();
  });

  test('both slashes are read, and a name that is not a name is passed over', () => {
    const lib = library('slashes');
    withHelmets(lib, { sets: { shatter: {} }, variants: {} });
    const raw = JSON.parse(fs.readFileSync(path.join(lib, 'helmets', 'manifest.json'), 'utf8'));
    raw.sets.shatter.file = `helmets\\shatter\\helmet_${LIBRARY_ID}.tga`;
    raw.sets['   '] = { file: 'helmets/x/h.tga' };
    raw.sets['x'.repeat(81)] = { file: 'helmets/x/h.tga' };
    raw.sets['tab\there'] = { file: 'helmets/x/h.tga' };
    raw.sets.text = 'not an object';
    raw.sets.colours = { file: 'helmets/c/h.tga', body: [1, 2], art: [300, 0, 0] };
    fs.writeFileSync(path.join(lib, 'helmets', 'manifest.json'), JSON.stringify(raw));
    const m = helmets.readManifest(lib);
    expect(Object.keys(m.sets).sort()).toEqual(['colours', 'shatter']);
    expect(m.sets.shatter.file).toBe(path.join('helmets', 'shatter', `helmet_${LIBRARY_ID}.tga`));
    // A colour that is not one loses the swatch and nothing more.
    expect(m.sets.colours).toEqual({ file: path.join('helmets', 'c', 'h.tga'), body: null, art: null });
  });
});

test.describe('which set a version comes with', () => {
  test('by "<car folder>/<version id>", as written or without regard to case; none for the rest', () => {
    const lib = library('setfor');
    withHelmets(lib, FIVE);
    const m = helmets.readManifest(lib);
    expect(helmets.setFor(m, 'lotus79', 'v13-shatter')).toBe('shatter');
    expect(helmets.setFor(m, 'Lotus79', 'V13-Shatter')).toBe('shatter');
    expect(helmets.setFor(m, 'mx5-mx52016', 'white-orange')).toBe('white-orange');
    expect(helmets.setFor(m, 'lotus79', 'v12')).toBeNull();
    expect(helmets.setFor(m, 'bmwm2csr', 'shatter')).toBeNull();
    expect(helmets.setFor(helmets.readManifest(''), 'lotus79', 'v13-shatter')).toBeNull();
    expect(helmets.setFor(null, 'lotus79', 'v13-shatter')).toBeNull();
  });

  test('what a card shows: the set and its colours, or null', () => {
    const lib = library('pick');
    withHelmets(lib, { ...FIVE, sets: { ...FIVE.sets, up: { file: '../x.tga' } }, variants: { ...FIVE.variants, 'a/2': 'up' } });
    const m = helmets.readManifest(lib);
    expect(helmets.pick(m, 'lotus79', 'v14-inverted')).toEqual({ set: 'shatter-inverted', body: [220, 55, 20], art: [10, 10, 10] });
    expect(helmets.pick(m, 'lotus79', 'v12')).toBeNull();
    expect(helmets.pick(m, 'a', '2')).toBeNull();   // a refused set is no helmet to show
    expect(helmets.pick(helmets.readManifest(''), 'lotus79', 'v13-shatter')).toBeNull();
  });
});

test.describe('the file a set is copied from', () => {
  test('a true-colour TGA under the helmets folder, with its size', () => {
    const lib = library('source');
    withHelmets(lib, FIVE);
    const m = helmets.readManifest(lib);
    const found = helmets.sourceFor(lib, m, 'shatter');
    expect(found).toEqual({ path: path.join(lib, 'helmets', 'shatter', `helmet_${LIBRARY_ID}.tga`), size: 18 + 2 * 2 * 3 });
    // 32-bit is a true-colour TGA too, and run-length encoded is fine.
    fs.writeFileSync(found.path, tga(2, 2, [1, 2, 3], { bits: 32 }));
    expect(helmets.sourceFor(lib, m, 'shatter').size).toBe(18 + 2 * 2 * 4);
    fs.writeFileSync(found.path, tga(2, 2, [1, 2, 3], { imageType: 10 }));
    expect(helmets.sourceFor(lib, m, 'shatter').problem).toBeUndefined();
  });

  test('a set the list does not have, a file that is not there, a folder, and a file that is not a TGA the sim loads', () => {
    const lib = library('source-problems');
    withHelmets(lib, {
      sets: {
        shatter: {},
        gone: { file: false },
        folder: { bytes: Buffer.alloc(0) },
        text: { bytes: Buffer.from('not a tga at all, but long enough to read a header from') },
        short: { bytes: Buffer.from('tiny') },
        mapped: { bytes: tga(2, 2, [1, 2, 3], { colorMapType: 1, imageType: 1 }) },
        grey: { bytes: tga(2, 2, [1, 2, 3], { bits: 8, imageType: 3 }) },
        wide: { bytes: tga(1, 1) },
        empty: { bytes: tga(1, 1) },
        huge: { bytes: tga(1, 1) },
      },
    });
    // The folder set's file is a folder of that name; the wide one claims a width the sim does not take.
    fs.rmSync(path.join(lib, setFile('folder')));
    fs.mkdirSync(path.join(lib, setFile('folder')));
    const wide = path.join(lib, setFile('wide'));
    const w = fs.readFileSync(wide);
    w.writeUInt16LE(helmets.MAX_EDGE + 1, 12);
    fs.writeFileSync(wide, w);
    const empty = path.join(lib, setFile('empty'));
    const e = fs.readFileSync(empty);
    e.writeUInt16LE(0, 14);
    fs.writeFileSync(empty, e);
    // The huge one is a good header on a file larger than any helmet the sim takes: the length is what is read.
    fs.truncateSync(path.join(lib, setFile('huge')), helmets.MAX_BYTES + 1);

    const m = helmets.readManifest(lib);
    const problem = (set) => helmets.sourceFor(lib, m, set).problem;
    expect(problem('never')).toBe("The never helmet is not in the library's helmet list.");
    expect(problem('gone')).toBe("The gone helmet's file is not in the library.");
    expect(problem('folder')).toBe("The folder helmet's file is not a file.");
    expect(problem('text')).toBe("The text helmet's file is not a true-colour TGA.");
    expect(problem('short')).toBe("The short helmet's file is not a TGA.");
    expect(problem('mapped')).toBe("The mapped helmet's file is not a true-colour TGA.");
    expect(problem('grey')).toBe("The grey helmet's file is not a true-colour TGA.");
    expect(problem('wide')).toBe(`The wide helmet is ${helmets.MAX_EDGE + 1} × 1, and the sim takes helmets up to ${helmets.MAX_EDGE} × ${helmets.MAX_EDGE}.`);
    expect(problem('empty')).toBe('The empty helmet is 1 × 0, and the sim takes helmets up to 2048 × 2048.');
    expect(problem('huge')).toBe("The huge helmet's file is larger than any helmet the sim takes.");
    expect(helmets.sourceFor(lib, m, 'shatter').problem).toBeUndefined();
    expect(helmets.MAX_BYTES).toBeLessThanOrEqual(17 * 1024 * 1024);
  });

  test('a path that leaves the helmets folder is refused before anything is read, and one that leaves it through a link after', () => {
    const lib = library('source-outside');
    // The file the sneaky set points at is there, outside the folder, so this is about the rule and not the disk.
    fs.mkdirSync(path.join(lib, 'evil'));
    fs.writeFileSync(path.join(lib, 'evil', 'helmet.tga'), tga(1, 1));
    withHelmets(lib, { sets: { shatter: {}, sneaky: { file: 'helmets/../evil/helmet.tga' } } });
    const m = helmets.readManifest(lib);
    expect(m.sets.sneaky).toBeUndefined();
    expect(helmets.sourceFor(lib, m, 'sneaky').problem).toBe("The sneaky helmet is not in the library's helmet list.");
    // The name checks are not the only guard: a set the list kept, whose file is a link out of the folder, is
    // refused when the link is followed.
    const linked = path.join(lib, 'helmets', 'linked');
    try {
      fs.symlinkSync(path.join(lib, 'evil'), linked, 'junction');
    } catch (e) {
      test.skip(true, `no junction could be made here (${e.code})`);
    }
    const raw = JSON.parse(fs.readFileSync(path.join(lib, 'helmets', 'manifest.json'), 'utf8'));
    raw.sets.linked = { file: 'helmets/linked/helmet.tga', body: [1, 1, 1], art: [2, 2, 2] };
    fs.writeFileSync(path.join(lib, 'helmets', 'manifest.json'), JSON.stringify(raw));
    const again = helmets.readManifest(lib);
    expect(again.sets.linked).toBeDefined();
    expect(fs.existsSync(path.join(lib, 'helmets', 'linked', 'helmet.tga'))).toBe(true);
    expect(helmets.sourceFor(lib, again, 'linked').problem).toBe("The linked helmet's file is outside the library's helmets folder.");
  });

  test('the sim names a helmet helmet_<id>.tga, and its cooked file .mip', () => {
    expect(helmets.parseHelmet('helmet_424242.tga')).toEqual({ role: 'helmet', id: '424242', ext: 'tga' });
    expect(helmets.parseHelmet('HELMET_424242.MIP')).toEqual({ role: 'helmet', id: '424242', ext: 'mip' });
    expect(helmets.parseHelmet('helmet.tga')).toBeNull();
    expect(helmets.parseHelmet('helmet_424242.png')).toBeNull();
    expect(helmets.parseHelmet('car_424242.tga')).toBeNull();
    expect(helmets.parseHelmet('suit_424242.tga')).toBeNull();
    expect(helmets.installedName('424242')).toBe('helmet_424242.tga');
    expect(helmets.cookedName('424242')).toBe('helmet_424242.mip');
  });
});

test.describe('what an apply would do about the helmet', () => {
  test('the set, its colours and the file to copy — or why the car\'s helmet is left as it is, in a sentence', () => {
    const lib = library('resolve');
    withHelmets(lib, { ...FIVE, sets: { ...FIVE.sets, gone: { file: false }, up: { file: '../x.tga' } }, variants: { ...FIVE.variants, 'a/gone': 'gone', 'a/up': 'up' } });
    const m = helmets.readManifest(lib);

    const found = helmets.resolve(lib, 'lotus79', 'v13-shatter', m);
    expect(found).toEqual({
      set: 'shatter', body: [10, 10, 10], art: [220, 55, 20],
      source: { path: path.join(lib, 'helmets', 'shatter', `helmet_${LIBRARY_ID}.tga`), size: 30 }, said: '',
    });
    // Without the manifest handed in it is read from the library.
    expect(helmets.resolve(lib, 'lotus79', 'v13-shatter')).toEqual(found);

    expect(helmets.resolve(lib, 'lotus79', 'v12', m)).toEqual({
      set: null, body: null, art: null, source: null, said: 'No helmet comes with this version, so the helmet on the car was left as it was.',
    });
    expect(helmets.resolve(lib, 'a', 'gone', m)).toEqual({
      set: 'gone', body: [10, 10, 10], art: [220, 55, 20], source: null,
      said: "The gone helmet's file is not in the library. The car's helmet was left as it was.",
    });
    expect(helmets.resolve(lib, 'a', 'up', m)).toEqual({
      set: 'up', body: null, art: null, source: null,
      said: "The up helmet names a file outside the library's helmets folder, so it is not used. The car's helmet was left as it was.",
    });
    expect(helmets.resolve('', 'lotus79', 'v13-shatter').said).toBe('The library keeps no helmets, so the helmet on the car was left as it was.');
    expect(helmets.resolve(library('resolve-none'), 'lotus79', 'v13-shatter').said).toBe('The library keeps no helmets, so the helmet on the car was left as it was.');

    const broken = library('resolve-broken');
    fs.mkdirSync(path.join(broken, 'helmets'));
    fs.writeFileSync(path.join(broken, 'helmets', 'manifest.json'), '{');
    expect(helmets.resolve(broken, 'lotus79', 'v13-shatter').said).toBe("The library's helmet list could not be read, so the helmet on the car was left as it was.");
  });

  test('the library\'s default, ready to copy, or why not — the set the list names, never a car\'s', () => {
    const lib = library('default');
    withHelmets(lib, FIVE);
    const m = helmets.readManifest(lib);
    expect(helmets.resolveDefault(lib, m)).toEqual({
      set: 'shatter', source: { path: path.join(lib, 'helmets', 'shatter', `helmet_${LIBRARY_ID}.tga`), size: 30 }, problem: null,
    });
    // The list's word alone: nothing about which sets the cars wear comes into it.
    expect(helmets.resolveDefault(lib, { ...m, default: 'white-orange' }).set).toBe('white-orange');
    fs.rmSync(path.join(lib, setFile('shatter')));
    expect(helmets.resolveDefault(lib, m)).toEqual({ set: 'shatter', source: null, problem: "The shatter helmet's file is not in the library." });
    expect(helmets.resolveDefault(lib, { ...m, default: null })).toEqual({ set: null, source: null, problem: 'The library names no default helmet.' });
    expect(helmets.resolveDefault('', helmets.readManifest(''))).toEqual({ set: null, source: null, problem: 'The library names no default helmet.' });
    // Nothing here chooses a default from the cars: that was the rule he turned down.
    expect(helmets.chooseDefault).toBeUndefined();
  });
});
