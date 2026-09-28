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

test.describe('through the commands the page calls', () => {
  function commandsFor(fx) {
    return paints.createCommands({
      backupsBase: fx.backups, simState: quietSim, tradingPaints: quietTp, installRoot: fx.install,
      // No registry and no usual places: the install is the one handed in.
      env: {}, exec: async () => ({ status: 1, stdout: '', stderr: '' }),
    });
  }

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
