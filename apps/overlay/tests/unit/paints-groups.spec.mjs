/**
 * Livery groups: the ones the library makes by itself, the driver's own, and setting one across its cars — in a
 * temp paint folder, a temp library and a temp backups base, never the real ones. The process and downloader
 * checks are faked quiet, and the customer id is made up.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const groups = require('../../modules/js/paints/groups.js');
const library = require('../../modules/js/paints/library.js');
const settings = require('../../modules/js/paints/settings.js');
const paints = require('../../modules/js/paints/index.js');
const paintsIpc = require('../../modules/js/paints-ipc.js');

const CUSTOMER = '424242';

const quietSim = async () => ({ simRunning: false, uiRunning: false, matched: [] });
const quietTp = async () => ({
  configFound: false, configPath: null, running: false, userId: null, downloadMySchemes: null,
  deleteBeforeDownloading: null, deleteAfterSession: null, keepSynced: null, warnings: [],
});
const quiet = { simState: quietSim, tradingPaints: quietTp };
const racing = { ...quiet, simState: async () => ({ simRunning: true, uiRunning: true, matched: ['iRacingSim64DX11.exe'] }) };

let root;
test.beforeAll(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'racing-desk-paints-groups-')); });
test.afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

// A library of three cars — the Lotus and the MX-5 each in two schemes and one of their own, the Porsche in one —
// a paint directory that has folders for the first two, and an install that has all three and one car more.
function fixture(tag) {
  const base = path.join(root, tag);
  const fx = {
    base,
    paint: path.join(base, 'paint'),
    library: path.join(base, 'library'),
    backups: path.join(base, 'backups'),
    install: path.join(base, 'iRacing'),
  };
  const version = (car, id, withSpec = true) => {
    const dir = path.join(fx.library, car, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `car_${CUSTOMER}.tga`), `${car} ${id} paint`);
    if (withSpec) fs.writeFileSync(path.join(dir, `car_spec_${CUSTOMER}.tga`), `${car} ${id} spec`);
  };
  version('lotus79', 'shatter');
  version('lotus79', 'shatter-inverted');
  version('lotus79', 'v14');
  version('mx5-mx52016', 'shatter');
  version('mx5-mx52016', 'Shatter-Inverted');
  version('mx5-mx52016', 'orange-white', false);
  version('porsche992cup', 'shatter');
  fs.mkdirSync(path.join(fx.paint, 'lotus79'), { recursive: true });
  fs.mkdirSync(path.join(fx.paint, 'mx5 mx52016'), { recursive: true });
  for (const car of ['lotus79', path.join('mx5', 'mx52016'), 'porsche992cup', 'audi90gto']) {
    fs.mkdirSync(path.join(fx.install, 'cars', car), { recursive: true });
    fs.writeFileSync(path.join(fx.install, 'cars', car, 'car.dat'), 'x');
  }
  fx.lib = () => library.scan(fx.library, fx.paint);
  fx.installed = ['audi90gto', 'lotus79', 'mx5 mx52016', 'porsche992cup'];
  return fx;
}

function memoryStore(initial = {}) {
  let held = initial;
  return { get: () => held, set: (v) => { held = v; }, peek: () => held };
}

const request = (fx, groupId, extra = {}) => ({
  paintDir: fx.paint, libraryRoot: fx.library, customerId: CUSTOMER, groupId,
  includeSpec: true, setReadOnlyAfter: false, clearOtherCooked: false, force: false, ...extra,
});

const read = (p) => fs.readFileSync(p, 'utf8');
const outcomes = (report) => report.results.map((r) => `${r.folder}: ${r.outcome}`);

test.describe('the library\'s own groups', () => {
  test('a version more than one car has is a group; one a single car has is not', () => {
    const fx = fixture('library');
    const found = groups.fromLibrary(fx.lib());

    expect(found.map((g) => [g.id, g.name, g.kind, g.cars.length])).toEqual([
      ['library:shatter', 'shatter', 'library', 3],
      ['library:shatter-inverted', 'shatter-inverted', 'library', 2],
    ]);
    // Each car with the version as that car has it, whatever the case of its folder.
    expect(found[1].cars).toEqual([
      { folder: 'lotus79', versionId: 'shatter-inverted', versionName: 'shatter-inverted', missing: false },
      { folder: 'mx5-mx52016', versionId: 'Shatter-Inverted', versionName: 'Shatter-Inverted', missing: false },
    ]);
  });

  test('no library, or an empty one, has none', () => {
    expect(groups.fromLibrary(null)).toEqual([]);
    expect(groups.fromLibrary({ root: 'x', cars: [], notes: [] })).toEqual([]);
    expect(groups.list(null, memoryStore())).toEqual([]);
  });
});

test.describe('the driver\'s own groups', () => {
  test('are made, listed before the library\'s, changed and forgotten', () => {
    const fx = fixture('mine');
    const store = memoryStore({ paintDir: fx.paint, installDir: 'D:\\iRacing' });

    const made = groups.save(store, fx.lib(), {
      name: '  Race day ',
      cars: { lotus79: 'v14', 'mx5-mx52016': 'orange-white', porsche992cup: null },
    });
    expect(made).toEqual({
      id: 'mine:race-day',
      name: 'Race day',
      kind: 'mine',
      cars: [
        { folder: 'lotus79', versionId: 'v14', versionName: 'v14', missing: false },
        { folder: 'mx5-mx52016', versionId: 'orange-white', versionName: 'orange-white', missing: false },
      ],
    });
    // Beside what the store already held, not in place of it.
    expect(store.peek()).toEqual({
      paintDir: fx.paint,
      installDir: 'D:\\iRacing',
      liveryGroups: [{ id: 'mine:race-day', name: 'Race day', cars: { lotus79: 'v14', 'mx5-mx52016': 'orange-white' } }],
    });

    groups.save(store, fx.lib(), { name: 'Endurance', cars: { porsche992cup: 'shatter' } });
    expect(groups.list(fx.lib(), store).map((g) => g.id)).toEqual([
      'mine:endurance', 'mine:race-day', 'library:shatter', 'library:shatter-inverted',
    ]);

    const changed = groups.save(store, fx.lib(), { id: 'mine:race-day', name: 'Sprint', cars: { lotus79: 'shatter' } });
    expect(changed.id).toBe('mine:race-day');
    expect(changed.name).toBe('Sprint');
    expect(changed.cars.map((c) => `${c.folder}/${c.versionId}`)).toEqual(['lotus79/shatter']);

    // A second group of a name that slugs the same gets an id of its own.
    expect(groups.save(store, fx.lib(), { name: 'Race-Day!', cars: { lotus79: 'v14' } }).id).toBe('mine:race-day-2');

    expect(groups.remove(store, 'mine:endurance')).toBe(true);
    expect(groups.remove(store, 'mine:endurance')).toBe(false);
    expect(groups.remove(store, 'library:shatter')).toBe(false);
    expect(groups.stored(store).map((g) => g.id)).toEqual(['mine:race-day', 'mine:race-day-2']);
    expect(store.peek().installDir).toBe('D:\\iRacing');
  });

  test('what cannot be a group is refused, and nothing is kept', () => {
    const fx = fixture('mine-refused');
    const store = memoryStore({});
    const lib = fx.lib();

    expect(() => groups.save(store, lib, { name: ' ', cars: { lotus79: 'v14' } })).toThrow('A group needs a name');
    expect(() => groups.save(store, lib, { name: 'x'.repeat(61), cars: { lotus79: 'v14' } })).toThrow('A group needs a name');
    expect(() => groups.save(store, lib, { name: 'Race day' })).toThrow('A group needs its cars.');
    expect(() => groups.save(store, lib, { name: 'Race day', cars: {} })).toThrow('no car in it');
    expect(() => groups.save(store, lib, { name: 'Race day', cars: { lotus79: null } })).toThrow('no car in it');
    expect(() => groups.save(store, lib, { name: 'Race day', cars: { lotus79: 'v99' } })).toThrow('lotus79 / v99 is not in the library.');
    expect(() => groups.save(store, lib, { name: 'Race day', cars: { 'never-painted': 'shatter' } })).toThrow('is not in the library.');
    expect(() => groups.save(store, lib, { name: 'Race day', cars: { lotus79: 7 } })).toThrow('is not in the library.');
    expect(() => groups.save(store, lib, { id: 'mine:nothing', name: 'Race day', cars: { lotus79: 'v14' } })).toThrow('not one of yours');
    expect(() => groups.save(store, lib, { id: 'library:shatter', name: 'Race day', cars: { lotus79: 'v14' } })).toThrow('not one of yours');
    expect(store.peek()).toEqual({});

    groups.save(store, lib, { name: 'Race day', cars: { lotus79: 'v14' } });
    expect(() => groups.save(store, lib, { name: 'race DAY', cars: { lotus79: 'shatter' } })).toThrow('There is a group called race DAY already.');
  });

  test('a version that has left the library is said to be missing; rubbish in the store is passed over', () => {
    const fx = fixture('mine-missing');
    const store = memoryStore({
      liveryGroups: [
        { id: 'mine:race-day', name: 'Race day', cars: { lotus79: 'v14', 'mx5-mx52016': 'gone', 'never-painted': 'shatter', bad: 7 } },
        { id: 'library:shatter', name: 'Not mine', cars: { lotus79: 'v14' } },
        { id: 'mine:race-day', name: 'Twice', cars: { lotus79: 'v14' } },
        { id: 'mine:no-cars', name: 'No cars' },
        { name: 'No id', cars: {} },
        'text', null, 7,
      ],
    });

    expect(groups.list(fx.lib(), store).filter((g) => g.kind === 'mine')).toEqual([{
      id: 'mine:race-day',
      name: 'Race day',
      kind: 'mine',
      cars: [
        { folder: 'lotus79', versionId: 'v14', versionName: 'v14', missing: false },
        { folder: 'mx5-mx52016', versionId: 'gone', versionName: 'gone', missing: true },
        { folder: 'never-painted', versionId: 'shatter', versionName: 'shatter', missing: true },
      ],
    }]);
    expect(groups.stored(memoryStore({ liveryGroups: 'text' }))).toEqual([]);
    expect(groups.stored({ get: () => { throw new Error('unreadable'); } })).toEqual([]);
  });

  test('the page saving its settings does not lose the groups', () => {
    const fx = fixture('mine-settings');
    const store = memoryStore({ paintDir: fx.paint });
    groups.save(store, fx.lib(), { name: 'Race day', cars: { lotus79: 'v14' } });

    settings.save(store, { paintDir: 'C:\\elsewhere', customerId: CUSTOMER, includeSpec: false });

    expect(store.peek().paintDir).toBe('C:\\elsewhere');
    expect(groups.stored(store).map((g) => g.name)).toEqual(['Race day']);
    // And the page is handed its own settings, not the groups.
    expect(Object.keys(settings.load(store))).toEqual(settings.KEYS);
  });
});

test.describe('setting a group', () => {
  test('puts each car\'s version on it, makes the folder of a car never driven, and backs each car up', async () => {
    const fx = fixture('set');
    fs.writeFileSync(path.join(fx.paint, 'lotus79', `car_${CUSTOMER}.tga`), 'the paint before');
    fs.writeFileSync(path.join(fx.paint, 'lotus79', `car_${CUSTOMER}.mip`), 'cooked');

    const report = await groups.set(request(fx, 'library:shatter'), {
      lib: fx.lib(), store: memoryStore(), installedCars: fx.installed, base: fx.backups, deps: quiet,
    });

    expect(outcomes(report)).toEqual(['lotus79: applied', 'mx5-mx52016: applied', 'porsche992cup: applied']);
    expect([report.name, report.applied, report.already, report.skipped, report.failed]).toEqual(['shatter', 3, 0, 0, 0]);
    expect(report.results.map((r) => r.simFolder)).toEqual(['lotus79', 'mx5 mx52016', 'porsche992cup']);
    expect(report.results[0].detail).toBe(`car_${CUSTOMER}.tga -> car_${CUSTOMER}.tga, car_spec_${CUSTOMER}.tga -> car_spec_${CUSTOMER}.tga`);

    expect(read(path.join(fx.paint, 'lotus79', `car_${CUSTOMER}.tga`))).toBe('lotus79 shatter paint');
    expect(read(path.join(fx.paint, 'mx5 mx52016', `car_spec_${CUSTOMER}.tga`))).toBe('mx5-mx52016 shatter spec');
    expect(read(path.join(fx.paint, 'porsche992cup', `car_${CUSTOMER}.tga`))).toBe('porsche992cup shatter paint');
    expect(fs.existsSync(path.join(fx.paint, 'lotus79', `car_${CUSTOMER}.mip`))).toBe(false);

    // A backup a car, under the car's own name, and the Lotus's holds what was there.
    expect(fs.readdirSync(fx.backups).sort()).toEqual(['lotus79', 'mx5-mx52016', 'porsche992cup']);
    expect(read(path.join(report.results[0].backupDir, `car_${CUSTOMER}.tga`))).toBe('the paint before');
  });

  test('a folder the library names for a car never driven is made, when the install has a car by that name', async () => {
    const fx = fixture('set-named');
    // The Porsche's version names its folder, as a meta.json can; the Lotus's names one no car has.
    fs.writeFileSync(path.join(fx.library, 'porsche992cup', 'shatter', 'meta.json'), JSON.stringify({ simFolder: 'porsche992cup' }));
    fs.rmSync(path.join(fx.paint, 'lotus79'), { recursive: true });
    fs.writeFileSync(path.join(fx.library, 'lotus79', 'shatter', 'meta.json'), JSON.stringify({ simFolder: 'lotus 79 special' }));

    const report = await groups.set(request(fx, 'library:shatter'), {
      lib: fx.lib(), store: memoryStore(), installedCars: fx.installed, base: fx.backups, deps: quiet,
    });

    expect(outcomes(report)).toEqual(['lotus79: failed', 'mx5-mx52016: applied', 'porsche992cup: applied']);
    expect(read(path.join(fx.paint, 'porsche992cup', `car_${CUSTOMER}.tga`))).toBe('porsche992cup shatter paint');
    expect(report.results[0].detail).toContain('lotus 79 special');
    expect(fs.existsSync(path.join(fx.paint, 'lotus 79 special'))).toBe(false);
  });

  test('a version with no spec map is on the car when its paint is, whatever spec map is in the folder', async () => {
    const fx = fixture('set-paint-alone');
    const mine = memoryStore();
    const made = groups.save(mine, fx.lib(), { name: 'Orange', cars: { 'mx5-mx52016': 'orange-white' } });
    fs.writeFileSync(path.join(fx.paint, 'mx5 mx52016', `car_spec_${CUSTOMER}.tga`), 'a spec map from an earlier paint');
    const deps = { lib: fx.lib(), store: mine, installedCars: fx.installed, base: fx.backups, deps: quiet };

    const first = await groups.set(request(fx, made.id), deps);
    expect(outcomes(first)).toEqual(['mx5-mx52016: applied']);
    expect(first.results[0].warnings.join(' ')).toContain('This version has no spec map');
    expect(read(path.join(fx.paint, 'mx5 mx52016', `car_spec_${CUSTOMER}.tga`))).toBe('a spec map from an earlier paint');

    const again = await groups.set(request(fx, made.id), deps);
    expect(outcomes(again)).toEqual(['mx5-mx52016: already']);
  });

  test('a second time writes nothing and backs nothing up', async () => {
    const fx = fixture('set-twice');
    const deps = { lib: fx.lib(), store: memoryStore(), installedCars: fx.installed, base: fx.backups, deps: quiet };
    await groups.set(request(fx, 'library:shatter'), deps);
    const backupsAfterFirst = fs.readdirSync(path.join(fx.backups, 'lotus79'));
    const written = fs.statSync(path.join(fx.paint, 'lotus79', `car_${CUSTOMER}.tga`)).mtimeMs;

    const again = await groups.set(request(fx, 'library:shatter'), deps);

    expect(outcomes(again)).toEqual(['lotus79: already', 'mx5-mx52016: already', 'porsche992cup: already']);
    expect([again.applied, again.already]).toEqual([0, 3]);
    expect(fs.readdirSync(path.join(fx.backups, 'lotus79'))).toEqual(backupsAfterFirst);
    expect(fs.statSync(path.join(fx.paint, 'lotus79', `car_${CUSTOMER}.tga`)).mtimeMs).toBe(written);

    // Another group moves only the cars it has another version for.
    const inverted = await groups.set(request(fx, 'library:shatter-inverted'), deps);
    expect(outcomes(inverted)).toEqual(['lotus79: applied', 'mx5-mx52016: applied']);
    expect(read(path.join(fx.paint, 'mx5 mx52016', `car_${CUSTOMER}.tga`))).toBe('mx5-mx52016 Shatter-Inverted paint');
    expect(read(path.join(fx.paint, 'porsche992cup', `car_${CUSTOMER}.tga`))).toBe('porsche992cup shatter paint');
  });

  test('without the spec map, a car whose paint is the version\'s is already done', async () => {
    const fx = fixture('set-no-spec');
    const deps = { lib: fx.lib(), store: memoryStore(), installedCars: fx.installed, base: fx.backups, deps: quiet };
    fs.writeFileSync(path.join(fx.paint, 'lotus79', `car_${CUSTOMER}.tga`), 'lotus79 shatter paint');

    const withSpec = await groups.set(request(fx, 'library:shatter', { includeSpec: false }), deps);
    expect(outcomes(withSpec)[0]).toBe('lotus79: already');
    expect(fs.existsSync(path.join(fx.paint, 'lotus79', `car_spec_${CUSTOMER}.tga`))).toBe(false);

    const full = await groups.set(request(fx, 'library:shatter'), deps);
    expect(outcomes(full)[0]).toBe('lotus79: applied');
    expect(read(path.join(fx.paint, 'lotus79', `car_spec_${CUSTOMER}.tga`))).toBe('lotus79 shatter spec');
  });

  test('one car that cannot be done does not stop the rest, and each is accounted for', async () => {
    const fx = fixture('set-partly');
    const store = memoryStore();
    const lib = fx.lib();
    groups.save(store, lib, { name: 'Race day', cars: { lotus79: 'v14', 'mx5-mx52016': 'orange-white', porsche992cup: 'shatter' } });
    // Since the group was made: the Lotus's version deleted, and the Porsche gone from the install.
    fs.rmSync(path.join(fx.library, 'lotus79', 'v14'), { recursive: true });

    const report = await groups.set(request(fx, 'mine:race-day'), {
      lib: fx.lib(), store, installedCars: ['lotus79', 'mx5 mx52016'], base: fx.backups, deps: quiet,
    });

    expect(outcomes(report)).toEqual(['lotus79: skipped', 'mx5-mx52016: applied', 'porsche992cup: skipped']);
    expect(report.results[0].detail).toBe('v14 is no longer in the library for this car.');
    expect(report.results[2].detail).toBe('The car has no folder in the paint directory and is not in the iRacing install.');
    expect([report.applied, report.skipped, report.failed]).toEqual([1, 2, 0]);
    expect(fs.existsSync(path.join(fx.paint, 'porsche992cup'))).toBe(false);
    expect(read(path.join(fx.paint, 'mx5 mx52016', `car_${CUSTOMER}.tga`))).toBe('mx5-mx52016 orange-white paint');
  });

  test('a car whose files cannot be written has failed, and the next car is still done', async () => {
    const fx = fixture('set-failed');
    // Where the Lotus's paint would go, there is a folder of that name.
    fs.mkdirSync(path.join(fx.paint, 'lotus79', `car_${CUSTOMER}.tga`));

    const report = await groups.set(request(fx, 'library:shatter-inverted'), {
      lib: fx.lib(), store: memoryStore(), installedCars: fx.installed, base: fx.backups, deps: quiet,
    });

    expect(outcomes(report)).toEqual(['lotus79: failed', 'mx5-mx52016: applied']);
    expect(report.results[0].detail).toContain(`car_${CUSTOMER}.tga`);
    expect(report.results[0].backupDir).toBeNull();
    expect([report.applied, report.failed]).toEqual([1, 1]);
  });

  test('with the sim running nothing is touched, unless told to go on; then it is said once, not once a car', async () => {
    const fx = fixture('set-racing');
    const deps = { lib: fx.lib(), store: memoryStore(), installedCars: fx.installed, base: fx.backups, deps: racing };

    await expect(groups.set(request(fx, 'library:shatter'), deps)).rejects.toThrow('iRacing is running.');
    expect(fs.existsSync(fx.backups)).toBe(false);
    expect(fs.existsSync(path.join(fx.paint, 'porsche992cup'))).toBe(false);
    expect(fs.readdirSync(path.join(fx.paint, 'lotus79'))).toEqual([]);

    const forced = await groups.set(request(fx, 'library:shatter', { force: true }), deps);
    expect(forced.applied).toBe(3);
    expect(forced.warnings).toEqual([
      'Set anyway, over a warning: iRacing is running. It holds paint files open, so a swap can fail halfway. Close the sim first.',
    ]);
    expect(forced.results.flatMap((r) => r.warnings)).toEqual([]);
  });

  test('a group that is not there, or a customer id that is not one, changes nothing', async () => {
    const fx = fixture('set-refused');
    const deps = { lib: fx.lib(), store: memoryStore(), installedCars: fx.installed, base: fx.backups, deps: quiet };

    await expect(groups.set(request(fx, 'library:no-such'), deps)).rejects.toThrow('That group is no longer there.');
    await expect(groups.set(request(fx, 'mine:no-such'), deps)).rejects.toThrow('That group is no longer there.');
    await expect(groups.set(request(fx, 'library:shatter', { customerId: '12a' }), deps)).rejects.toThrow('digits only');
    expect(fs.existsSync(fx.backups)).toBe(false);
  });
});

// The helmet comes with the livery, and a group sees to the default once for its cars: the set the library names
// as its default, whatever the cars wear. The library keeps helmets/<set>/helmet_<its id>.tga and
// helmets/manifest.json; the id in its file names is never the app's.
const LIBRARY_ID = '31337';
const apply = require('../../modules/js/paints/apply.js');

// A 2x2 true-colour TGA of one colour, the shape the pipeline writes, at a size a test can afford.
function tga([r, g, b]) {
  const head = Buffer.alloc(18);
  head[2] = 2;
  head.writeUInt16LE(2, 12);
  head.writeUInt16LE(2, 14);
  head[16] = 24;
  head[17] = 0x20;
  return Buffer.concat([head, Buffer.from([b, g, r, b, g, r, b, g, r, b, g, r])]);
}
const SETS = { shatter: tga([220, 55, 20]), 'shatter-inverted': tga([10, 10, 10]), 'white-orange': tga([235, 235, 235]) };

// helmets/manifest.json and the set files, as build_helmets.py writes them.
function withHelmets(fx, variants, fallback = 'shatter') {
  const manifest = { customer_id: LIBRARY_ID, default: fallback, sets: {}, variants };
  for (const [name, bytes] of Object.entries(SETS)) {
    manifest.sets[name] = { file: `helmets/${name}/helmet_${LIBRARY_ID}.tga`, body: [10, 10, 10], art: [220, 55, 20] };
    fs.mkdirSync(path.join(fx.library, 'helmets', name), { recursive: true });
    fs.writeFileSync(path.join(fx.library, 'helmets', name, `helmet_${LIBRARY_ID}.tga`), bytes);
  }
  fs.writeFileSync(path.join(fx.library, 'helmets', 'manifest.json'), JSON.stringify(manifest, null, 2));
}
const bytes = (p) => fs.readFileSync(p);
const helmetOn = (fx, simFolder) => path.join(fx.paint, simFolder, `helmet_${CUSTOMER}.tga`);
const defaultHelmet = (fx) => path.join(fx.paint, `helmet_${CUSTOMER}.tga`);
const manifestOf = (dir) => JSON.parse(read(path.join(dir, 'manifest.json')));
const ALL_SHATTER = { 'lotus79/shatter': 'shatter', 'mx5-mx52016/shatter': 'shatter', 'porsche992cup/shatter': 'shatter', 'lotus79/shatter-inverted': 'shatter-inverted', 'mx5-mx52016/Shatter-Inverted': 'shatter-inverted', 'mx5-mx52016/orange-white': 'white-orange' };

test.describe('the helmet comes with the group', () => {
  test('goes on each car under the app\'s id; the default is the library\'s default set, not the one the cars agree on; set again, nothing is written', async () => {
    const fx = fixture('helmet-agree');
    withHelmets(fx, ALL_SHATTER, 'shatter-inverted');   // every car wears shatter; the library's default is another set
    fs.writeFileSync(defaultHelmet(fx), 'OLD DEFAULT');
    const deps = { lib: fx.lib(), store: memoryStore(), installedCars: fx.installed, base: fx.backups, deps: quiet };

    const report = await groups.set(request(fx, 'library:shatter'), deps);
    expect(outcomes(report)).toEqual(['lotus79: applied', 'mx5-mx52016: applied', 'porsche992cup: applied']);
    for (const sim of ['lotus79', 'mx5 mx52016', 'porsche992cup']) expect(bytes(helmetOn(fx, sim)).equals(SETS.shatter)).toBe(true);
    // The cars all wear shatter, and the default is what the library names: shatter-inverted.
    expect(bytes(defaultHelmet(fx)).equals(SETS['shatter-inverted'])).toBe(true);
    expect(report.helmet.set).toBe('shatter-inverted');
    expect(report.helmet.put).toBe(true);
    expect(report.helmet.said).toBe('The shatter-inverted helmet is now the default for every car without a helmet of its own.');
    expect(report.helmet.backupDir.startsWith(path.join(fx.backups, apply.DEFAULT_HELMET_FOLDER))).toBe(true);
    expect(read(path.join(report.helmet.backupDir, `helmet_${CUSTOMER}.tga`))).toBe('OLD DEFAULT');
    expect(manifestOf(report.helmet.backupDir).reason).toBe('set shatter');
    // Each car says its helmet is on, and leaves the default to the group; each car's backup names the group's one
    // backup of the default.
    for (const r of report.results) {
      expect(r.helmet).toEqual({ set: 'shatter', onCar: true, defaultSet: null, defaultPut: false, said: 'The shatter helmet is on the car.' });
      expect(manifestOf(r.backupDir).defaultHelmetBackup).toBe(path.basename(report.helmet.backupDir));
    }
    // The car's own words are of its paint; the helmet is said apart.
    expect(report.results[0].detail).toBe(`car_${CUSTOMER}.tga -> car_${CUSTOMER}.tga, car_spec_${CUSTOMER}.tga -> car_spec_${CUSTOMER}.tga`);
    // Nothing anywhere carries the library's id.
    const everywhere = [fx.paint, fx.backups].flatMap((d) => fs.readdirSync(d, { recursive: true }).map(String));
    expect(everywhere.some((n) => n.includes(LIBRARY_ID))).toBe(false);

    // A second time: every car is already done, helmet included, and the default is neither backed up nor written.
    const written = fs.statSync(defaultHelmet(fx)).mtimeMs;
    const again = await groups.set(request(fx, 'library:shatter'), deps);
    expect(outcomes(again)).toEqual(['lotus79: already', 'mx5-mx52016: already', 'porsche992cup: already']);
    expect(again.helmet).toEqual({
      set: 'shatter-inverted', put: false, backupDir: null,
      said: 'The shatter-inverted helmet is the default for every car without a helmet of its own, as before.',
    });
    expect(fs.readdirSync(path.join(fx.backups, apply.DEFAULT_HELMET_FOLDER))).toHaveLength(1);
    expect(fs.statSync(defaultHelmet(fx)).mtimeMs).toBe(written);

    // A helmet changed by hand on one car is put back by the next set, that car alone.
    fs.writeFileSync(helmetOn(fx, 'lotus79'), 'BY HAND');
    const third = await groups.set(request(fx, 'library:shatter'), deps);
    expect(outcomes(third)).toEqual(['lotus79: applied', 'mx5-mx52016: already', 'porsche992cup: already']);
    expect(bytes(helmetOn(fx, 'lotus79')).equals(SETS.shatter)).toBe(true);

    // Reverting one car of the group puts the default back as it was before the group, and takes the helmet the
    // group put on the car away; the other cars keep theirs.
    const reverted = await apply.revert(fx.paint, fx.backups, 'lotus79', 'lotus79', CUSTOMER, apply.listBackups(fx.backups, 'lotus79').at(-1).id, false, quiet);
    expect(reverted.helmet.said).toBe('The helmet that apply put on the car was taken off, and the default helmet is as it was before it.');
    expect(fs.existsSync(helmetOn(fx, 'lotus79'))).toBe(false);
    expect(read(defaultHelmet(fx))).toBe('OLD DEFAULT');
    expect(bytes(helmetOn(fx, 'mx5 mx52016')).equals(SETS.shatter)).toBe(true);
  });

  test('when the cars wear different helmets the default is the library\'s default set all the same, and it is said which', async () => {
    const fx = fixture('helmet-differ');
    withHelmets(fx, ALL_SHATTER, 'shatter');
    const store = memoryStore();
    const made = groups.save(store, fx.lib(), { name: 'Mixed', cars: { lotus79: 'shatter-inverted', 'mx5-mx52016': 'orange-white' } });
    const deps = { lib: fx.lib(), store, installedCars: fx.installed, base: fx.backups, deps: quiet };

    const report = await groups.set(request(fx, made.id), deps);
    expect(outcomes(report)).toEqual(['lotus79: applied', 'mx5-mx52016: applied']);
    expect(bytes(helmetOn(fx, 'lotus79')).equals(SETS['shatter-inverted'])).toBe(true);
    expect(bytes(helmetOn(fx, 'mx5 mx52016')).equals(SETS['white-orange'])).toBe(true);
    expect(bytes(defaultHelmet(fx)).equals(SETS.shatter)).toBe(true);
    expect(report.helmet).toMatchObject({ set: 'shatter', put: true, said: 'The shatter helmet is now the default for every car without a helmet of its own.' });
    expect(report.results.map((r) => r.helmet.said)).toEqual(['The shatter-inverted helmet is on the car.', 'The white-orange helmet is on the car.']);
    // The default's backup says there was none before it.
    expect(manifestOf(report.helmet.backupDir).files).toEqual([]);

    const again = await groups.set(request(fx, made.id), deps);
    expect(again.helmet.said).toBe('The shatter helmet is the default for every car without a helmet of its own, as before.');
    expect(again.helmet.put).toBe(false);
    expect(again.helmet.backupDir).toBeNull();

    // The library names another default: the next set puts it in place, and what the cars wear still has no say.
    const p = path.join(fx.library, 'helmets', 'manifest.json');
    fs.writeFileSync(p, JSON.stringify({ ...JSON.parse(read(p)), default: 'white-orange' }));
    const changed = await groups.set(request(fx, made.id), deps);
    expect(outcomes(changed)).toEqual(['lotus79: already', 'mx5-mx52016: already']);
    expect(changed.helmet).toMatchObject({ set: 'white-orange', put: true, said: 'The white-orange helmet is now the default for every car without a helmet of its own.' });
    expect(bytes(defaultHelmet(fx)).equals(SETS['white-orange'])).toBe(true);
    expect(bytes(path.join(changed.helmet.backupDir, `helmet_${CUSTOMER}.tga`)).equals(SETS.shatter)).toBe(true);
    expect(bytes(helmetOn(fx, 'lotus79')).equals(SETS['shatter-inverted'])).toBe(true);
  });

  test('a library that keeps no helmets leaves the default alone, and says so; when the list arrives the default is its, whatever one car wears', async () => {
    const fx = fixture('helmet-none');
    fs.writeFileSync(defaultHelmet(fx), 'MY DEFAULT');
    const deps = { lib: fx.lib(), store: memoryStore(), installedCars: fx.installed, base: fx.backups, deps: quiet };

    const none = await groups.set(request(fx, 'library:shatter'), deps);
    expect(none.applied).toBe(3);
    expect(none.helmet).toEqual({ set: null, put: false, said: 'The library keeps no helmets, so the default helmet was left as it was.', backupDir: null });
    expect(none.results.map((r) => r.helmet.said)).toEqual(Array(3).fill('The library keeps no helmets, so the helmet on the car was left as it was.'));
    expect(read(defaultHelmet(fx))).toBe('MY DEFAULT');
    expect(fs.existsSync(path.join(fx.backups, apply.DEFAULT_HELMET_FOLDER))).toBe(false);
    for (const sim of ['lotus79', 'mx5 mx52016', 'porsche992cup']) expect(fs.existsSync(helmetOn(fx, sim))).toBe(false);

    // The list arrives, naming a helmet for one car of the three: that car wears it, and the default is the list's.
    withHelmets(fx, { 'porsche992cup/shatter': 'shatter' }, 'shatter-inverted');
    const one = await groups.set(request(fx, 'library:shatter'), deps);
    expect(outcomes(one)).toEqual(['lotus79: already', 'mx5-mx52016: already', 'porsche992cup: applied']);
    expect(one.results[0].helmet).toBeNull();   // a car already done says nothing of a helmet
    expect(one.results[2].helmet.said).toBe('The shatter helmet is on the car.');
    expect(bytes(helmetOn(fx, 'porsche992cup')).equals(SETS.shatter)).toBe(true);
    expect(bytes(defaultHelmet(fx)).equals(SETS['shatter-inverted'])).toBe(true);
    expect(one.helmet.said).toBe('The shatter-inverted helmet is now the default for every car without a helmet of its own.');
    expect(read(path.join(one.helmet.backupDir, `helmet_${CUSTOMER}.tga`))).toBe('MY DEFAULT');

    // A list that cannot be read is said as such.
    fs.writeFileSync(path.join(fx.library, 'helmets', 'manifest.json'), '{ no');
    const broken = await groups.set(request(fx, 'library:shatter'), deps);
    expect(broken.helmet).toEqual({ set: null, put: false, said: "The library's helmet list could not be read, so the default helmet was left as it was.", backupDir: null });
    expect(bytes(defaultHelmet(fx)).equals(SETS['shatter-inverted'])).toBe(true);
  });

  test('with the sim running nothing is touched, the default included', async () => {
    const fx = fixture('helmet-racing');
    withHelmets(fx, ALL_SHATTER);
    const deps = { lib: fx.lib(), store: memoryStore(), installedCars: fx.installed, base: fx.backups, deps: racing };
    await expect(groups.set(request(fx, 'library:shatter'), deps)).rejects.toThrow('iRacing is running.');
    expect(fs.existsSync(defaultHelmet(fx))).toBe(false);
    expect(fs.existsSync(fx.backups)).toBe(false);
    expect(fs.readdirSync(path.join(fx.paint, 'lotus79'))).toEqual([]);
  });
});

test.describe('through the commands the page calls', () => {
  function commandsFor(fx) {
    return paints.createCommands({
      backupsBase: fx.backups, simState: quietSim, tradingPaints: quietTp, installRoot: fx.install,
      // No registry and no usual places: the install is the one handed in.
      env: {}, exec: async () => ({ status: 1, stdout: '', stderr: '' }),
    });
  }

  test('one car\'s apply sees to the default whatever the page sent; a group\'s answer carries its helmet; the default is seen to on its own', async () => {
    const fx = fixture('commands-helmets');
    withHelmets(fx, ALL_SHATTER);
    const commands = commandsFor(fx);
    const report = await commands.applyVersion({
      paintDir: fx.paint, libraryRoot: fx.library, carFolder: 'lotus79', simFolder: 'lotus79', versionId: 'shatter-inverted', customerId: CUSTOMER,
      includeSpec: true, setReadOnlyAfter: false, clearOtherCooked: false, force: false,
      // Not the page's to send: both are set in the main process whatever it sent.
      ensureDefaultHelmet: false, defaultHelmetBackup: '..\\x',
    });
    expect(report.helmet).toEqual({
      set: 'shatter-inverted', onCar: true, defaultSet: 'shatter', defaultPut: true,
      said: 'The shatter-inverted helmet is on the car. The shatter helmet is now the default for every car without a helmet of its own.',
    });
    expect(bytes(helmetOn(fx, 'lotus79')).equals(SETS['shatter-inverted'])).toBe(true);
    expect(bytes(defaultHelmet(fx)).equals(SETS.shatter)).toBe(true);
    expect(apply.isBackupId(manifestOf(report.backupDir).defaultHelmetBackup)).toBe(true);

    const set = await paintsIpc.invoke(commands, memoryStore({}), 'setGroup', { request: request(fx, 'library:shatter') });
    expect(outcomes(set)).toEqual(['lotus79: applied', 'mx5-mx52016: applied', 'porsche992cup: applied']);
    expect(set.helmet).toEqual({ set: 'shatter', put: false, said: 'The shatter helmet is the default for every car without a helmet of its own, as before.', backupDir: null });
    expect(bytes(defaultHelmet(fx)).equals(SETS.shatter)).toBe(true);

    // On its own, over the bridge, as the page asks after a library update: in place, nothing to say; the list
    // naming another set, put in place and said.
    const ask = () => paintsIpc.invoke(commands, memoryStore({}), 'ensureDefaultHelmet', { paintDir: fx.paint, libraryRoot: fx.library, customerId: CUSTOMER, extra: 'not taken' });
    expect(await ask()).toEqual({ set: 'shatter', put: false, said: '', backupDir: null, warnings: [] });
    const p = path.join(fx.library, 'helmets', 'manifest.json');
    fs.writeFileSync(p, JSON.stringify({ ...JSON.parse(read(p)), default: 'white-orange' }));
    const ensured = await ask();
    expect(ensured).toMatchObject({ set: 'white-orange', put: true, said: 'The white-orange helmet is now the default for every car without a helmet of its own.', warnings: [] });
    expect(manifestOf(ensured.backupDir).reason).toBe('library update');
    expect(bytes(defaultHelmet(fx)).equals(SETS['white-orange'])).toBe(true);
    // The library scan the page reads says which helmet each version comes with.
    const lib = await commands.scanLibrary(fx.library, fx.paint);
    const mx5 = lib.cars.find((c) => c.folder === 'mx5-mx52016');
    expect(mx5.versions.map((v) => [v.id, v.helmet && v.helmet.set])).toEqual([
      ['Shatter-Inverted', 'shatter-inverted'], ['orange-white', 'white-orange'], ['shatter', 'shatter'],
    ]);
    expect(lib.cars.map((c) => c.folder)).toEqual(['lotus79', 'mx5-mx52016', 'porsche992cup']);   // the helmets folder is no car
  });

  test('groups are listed, made, set and forgotten', async () => {
    const fx = fixture('commands');
    const commands = commandsFor(fx);
    const store = memoryStore({});
    const where = { libraryRoot: fx.library, paintDir: fx.paint };

    const made = await paintsIpc.invoke(commands, store, 'saveGroup', { ...where, name: 'Race day', cars: { porsche992cup: 'shatter', lotus79: 'v14' } });
    expect(made.id).toBe('mine:race-day');
    expect((await paintsIpc.invoke(commands, store, 'liveryGroups', where)).map((g) => g.id)).toEqual([
      'mine:race-day', 'library:shatter', 'library:shatter-inverted',
    ]);

    const report = await paintsIpc.invoke(commands, store, 'setGroup', { request: request(fx, 'mine:race-day') });
    expect(outcomes(report)).toEqual(['lotus79: applied', 'porsche992cup: applied']);
    expect(read(path.join(fx.paint, 'porsche992cup', `car_${CUSTOMER}.tga`))).toBe('porsche992cup shatter paint');

    expect(await paintsIpc.invoke(commands, store, 'deleteGroup', { id: 'mine:race-day' })).toBe(true);
    expect((await paintsIpc.invoke(commands, store, 'liveryGroups', where)).map((g) => g.kind)).toEqual(['library', 'library']);
    await expect(paintsIpc.invoke(commands, store, 'setGroup', {})).rejects.toThrow('setGroup needs the request.');
  });

  test('one car\'s apply makes its folder only under the install\'s name for the car', async () => {
    const fx = fixture('commands-apply');
    const commands = commandsFor(fx);
    const one = (simFolder, extra = {}) => ({
      paintDir: fx.paint, libraryRoot: fx.library, carFolder: 'porsche992cup', simFolder, versionId: 'shatter', customerId: CUSTOMER,
      includeSpec: true, setReadOnlyAfter: false, clearOtherCooked: false, force: false, ...extra,
    });

    // The page cannot ask for a folder to be made; a name the install does not have is refused as before.
    await expect(commands.applyVersion(one('porsche-992-cup', { createFolder: true }))).rejects.toThrow('There is no porsche-992-cup folder');
    expect(fs.existsSync(path.join(fx.paint, 'porsche-992-cup'))).toBe(false);

    const report = await commands.applyVersion(one('porsche992cup'));
    expect(report.actions.map((a) => a.kind)).toEqual(['folder', 'backup', 'install', 'install', 'cooked']);
    expect(read(path.join(fx.paint, 'porsche992cup', `car_${CUSTOMER}.tga`))).toBe('porsche992cup shatter paint');

    const cars = await commands.carCatalogue({ libraryRoot: fx.library, paintDir: path.join(fx.base, 'empty-paint') });
    expect(cars.map((c) => [c.folder, c.simFolder, c.installPath])).toEqual([
      ['audi90gto', null, 'audi90gto'],
      ['lotus79', null, 'lotus79'],
      ['mx5-mx52016', null, 'mx5 mx52016'],
      ['porsche992cup', null, 'porsche992cup'],
    ]);
  });
});
