/**
 * The whole chain the Paints page uses, minus Electron: the named arguments apps/paints/src/api.ts sends, through
 * paints-ipc's dispatcher, into the real commands — over a temp paint folder, a temp library and a temp backups
 * base. paints-ipc.spec.mjs checks the dispatcher against a recorder and the desk spec stubs the bridge, so this is
 * the test that would notice an argument reaching the wrong parameter.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const paints = require('../../modules/js/paints');
const paintsIpc = require('../../modules/js/paints-ipc.js');

const CUSTOMER = '424242';
const STRANGER = '999000';

let root, paintDir, libraryRoot, backups, install, car, commands, store, remembered;
const invoke = (name, args) => paintsIpc.invoke(commands, store, name, args);

test.beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'racing-desk-paints-chain-'));
  paintDir = path.join(root, 'paint');
  libraryRoot = path.join(root, 'library');
  backups = path.join(root, 'backups');
  car = path.join(paintDir, 'lotus79');
  fs.mkdirSync(car, { recursive: true });
  fs.mkdirSync(path.join(libraryRoot, 'lotus79', 'v1'), { recursive: true });

  // In the sim: this customer's old paint, spec map and cooked file, and another driver's.
  fs.writeFileSync(path.join(car, `car_${CUSTOMER}.tga`), 'old paint');
  fs.writeFileSync(path.join(car, `car_spec_${CUSTOMER}.tga`), 'old spec');
  fs.writeFileSync(path.join(car, `car_${CUSTOMER}.mip`), 'cooked');
  fs.writeFileSync(path.join(car, `car_${STRANGER}.tga`), 'their paint');
  fs.writeFileSync(path.join(car, `car_${STRANGER}.mip`), 'their cooked');
  // In the library: one version.
  fs.writeFileSync(path.join(libraryRoot, 'lotus79', 'v1', `car_${CUSTOMER}.tga`), 'new paint');
  fs.writeFileSync(path.join(libraryRoot, 'lotus79', 'v1', `car_spec_${CUSTOMER}.tga`), 'new spec');

  // An iRacing install, as much of one as the catalogue looks at: the Lotus, a nested car the driver has a paint
  // in, and one that has never been driven. The library knows only the Lotus.
  install = path.join(root, 'iRacing');
  for (const parts of [['lotus79'], ['mx5', 'mx52016'], ['mclaren570sgt4']]) {
    fs.mkdirSync(path.join(install, 'cars', ...parts), { recursive: true });
    fs.writeFileSync(path.join(install, 'cars', ...parts, `${parts[parts.length - 1]}.dat`), 'x');
  }
  fs.mkdirSync(path.join(paintDir, 'mx5 mx52016'));
  fs.writeFileSync(path.join(paintDir, 'mx5 mx52016', `car_${CUSTOMER}.tga`), 'mx5 paint');
  fs.writeFileSync(path.join(paintDir, 'mx5 mx52016', `car_${CUSTOMER}.mip`), 'mx5 cooked');
  fs.writeFileSync(path.join(paintDir, 'mx5 mx52016', `car_${STRANGER}.mip`), 'their cooked');
  fs.mkdirSync(path.join(paintDir, 'helmets'));

  remembered = {};
  store = { get: () => remembered, set: (obj) => { remembered = obj; } };
  commands = paints.createCommands({
    backupsBase: backups,
    env: { ...process.env, APPDATA: path.join(root, 'no-appdata') },   // no Trading Paints config to find
    installRoot: () => install,
    carNames: async () => [
      { car_path: 'lotus79', name: 'Lotus 79', short_name: 'Lotus 79', car_id: 42, driven: 41, seen: 44 },
      { car_path: 'mx5 mx52016', name: 'Mazda MX-5 Cup', short_name: 'MX-5 Cup', car_id: 67, driven: 668, seen: 702 },
    ],
    simState: async () => ({ simRunning: false, uiRunning: false, matched: [] }),
    tradingPaints: async () => ({
      configFound: false, configPath: null, running: false, userId: null, downloadMySchemes: null,
      deleteBeforeDownloading: null, deleteAfterSession: null, keepSynced: null, warnings: [],
    }),
  });
});

test.afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

test('detect, scan, apply, identify, revert — with the arguments the UI sends', async () => {
  const found = await invoke('detectCustomer', { paintDir });
  expect(found.id).toBe(CUSTOMER);

  const library = await invoke('scanLibrary', { libraryRoot, paintDir });
  expect(library.cars.map((c) => c.folder)).toEqual(['lotus79']);
  expect(library.cars[0].versions.map((v) => v.id)).toEqual(['v1']);
  expect((await invoke('scanLibrary', { libraryRoot, paintDir: null })).cars).toHaveLength(1);

  const where = { paintDir, libraryRoot, carFolder: 'lotus79', simFolder: null, customerId: CUSTOMER };
  const before = await invoke('carState', where);
  expect(before.appliedVersionId).toBeNull();
  expect(before.files.map((f) => f.fileName).sort()).toEqual([`car_${CUSTOMER}.tga`, `car_spec_${CUSTOMER}.tga`]);

  expect(await invoke('preflight', { paintDir, simFolder: 'lotus79' })).toEqual({ blockers: [], warnings: [] });

  const applied = await invoke('applyVersion', {
    request: {
      paintDir, libraryRoot, carFolder: 'lotus79', simFolder: 'lotus79', versionId: 'v1', customerId: CUSTOMER,
      includeSpec: true, setReadOnlyAfter: false, clearOtherCooked: false, force: false,
    },
  });
  expect(applied.applied).toBe(true);
  expect(applied.backupDir.startsWith(backups)).toBe(true);
  expect(fs.readFileSync(path.join(car, `car_${CUSTOMER}.tga`), 'utf8')).toBe('new paint');
  expect(fs.readFileSync(path.join(car, `car_spec_${CUSTOMER}.tga`), 'utf8')).toBe('new spec');
  expect(fs.existsSync(path.join(car, `car_${CUSTOMER}.mip`))).toBe(false);          // ours: re-cooked by the sim
  expect(fs.readFileSync(path.join(car, `car_${STRANGER}.tga`), 'utf8')).toBe('their paint');
  expect(fs.existsSync(path.join(car, `car_${STRANGER}.mip`))).toBe(true);           // theirs: not ours to delete

  const after = await invoke('carState', where);
  expect(after.appliedVersionId).toBe('v1');
  expect(after.matchKind).toBe('exact');

  const kept = await invoke('listBackups', { carFolder: 'lotus79' });
  expect(kept).toHaveLength(1);
  expect(kept[0].fileCount).toBeGreaterThanOrEqual(2);

  const reverted = await invoke('revertCar', {
    paintDir, carFolder: 'lotus79', simFolder: 'lotus79', customerId: CUSTOMER, backupId: null, force: false,
  });
  expect(reverted.applied).toBe(true);
  expect(fs.readFileSync(path.join(car, `car_${CUSTOMER}.tga`), 'utf8')).toBe('old paint');
  expect(fs.readFileSync(path.join(car, `car_spec_${CUSTOMER}.tga`), 'utf8')).toBe('old spec');
  expect(fs.readFileSync(path.join(car, `car_${STRANGER}.tga`), 'utf8')).toBe('their paint');
});

test('the catalogue is every car the rig knows, named, and a car outside the library still has a state', async () => {
  const cars = await invoke('carCatalogue', { libraryRoot, paintDir });
  expect(cars.map((c) => [c.name, c.folder, c.simFolder, c.versions.length, c.installed, c.driven])).toEqual([
    ['Lotus 79', 'lotus79', 'lotus79', 1, true, 41],
    ['Mazda MX-5 Cup', 'mx5 mx52016', 'mx5 mx52016', 0, true, 668],
    [null, 'mclaren570sgt4', null, 0, true, 0],
  ]);
  expect(cars[0].versions[0].id).toBe('v1');
  // The library's cars are the ones scanLibrary gives, as it gives them.
  const library = await invoke('scanLibrary', { libraryRoot, paintDir });
  expect(cars[0]).toMatchObject(library.cars[0]);

  // With no library chosen the rig's cars are still there; with nothing at all, an empty list.
  expect((await invoke('carCatalogue', { libraryRoot: '', paintDir })).map((c) => [c.folder, c.versions.length]))
    .toEqual([['lotus79', 0], ['mx5 mx52016', 0], ['mclaren570sgt4', 0]]);
  expect((await invoke('carCatalogue', { libraryRoot, paintDir: null })).map((c) => [c.folder, c.simFolder]))
    .toEqual([['lotus79', null], ['mx5 mx52016', null], ['mclaren570sgt4', null]]);
  expect((await invoke('carCatalogue')).map((c) => c.folder)).toEqual(['lotus79', 'mx5 mx52016', 'mclaren570sgt4']);

  // carState for a car the library has no folder for: what is installed, and no version to call it.
  const mx5 = await invoke('carState', { paintDir, libraryRoot, carFolder: 'mx5 mx52016', simFolder: 'mx5 mx52016', customerId: CUSTOMER });
  expect(mx5).toMatchObject({ simFolder: 'mx5 mx52016', folderExists: true, appliedVersionId: null, matchKind: 'none', cookedOtherDrivers: 1 });
  expect(mx5.files.map((f) => f.fileName)).toEqual([`car_${CUSTOMER}.tga`]);
  expect(mx5.cooked.map((p) => path.basename(p))).toEqual([`car_${CUSTOMER}.mip`]);
  // Left to find the sim's folder itself, it matches as the library would: loosely, separators folded.
  expect(await invoke('carState', { paintDir, libraryRoot, carFolder: 'mx5-mx52016', simFolder: null, customerId: CUSTOMER })).toEqual(mx5);
  // A car with no paint folder yet has nothing installed, and that is not an error.
  expect(await invoke('carState', { paintDir, libraryRoot, carFolder: 'mclaren570sgt4', simFolder: null, customerId: CUSTOMER })).toEqual({
    simFolder: null, folderExists: false, files: [], cooked: [], cookedOtherDrivers: 0, appliedVersionId: null, matchKind: 'none',
    anyReadOnly: false,
  });
  expect(await invoke('listBackups', { carFolder: 'mx5 mx52016' })).toEqual([]);
});

test('a catalogue with no host to name the cars, or no install to find, is the cars it can see', async () => {
  const quiet = {
    backupsBase: backups,
    simState: async () => ({ simRunning: false, uiRunning: false, matched: [] }),
    tradingPaints: async () => ({ configFound: false, running: false, warnings: [] }),
  };
  const unnamed = paints.createCommands({ ...quiet, installRoot: install, carNames: async () => { throw new Error('ECONNREFUSED'); } });
  expect((await paintsIpc.invoke(unnamed, store, 'carCatalogue', { libraryRoot, paintDir })).map((c) => [c.name, c.folder])).toEqual([
    [null, 'lotus79'], [null, 'mclaren570sgt4'], [null, 'mx5 mx52016'],
  ]);
  // No install: `reg` finds no registration and the usual places are empty, so the list is the library's cars
  // and the paint directory's.
  const lost = paints.createCommands({
    ...quiet,
    env: { APPDATA: path.join(root, 'no-appdata') },
    exec: async () => ({ status: 1, stdout: '', stderr: 'ERROR: The system was unable to find the specified registry key or value.', error: null }),
  });
  expect((await paintsIpc.invoke(lost, store, 'carCatalogue', { libraryRoot, paintDir })).map((c) => [c.folder, c.versions.length, c.installed])).toEqual([
    ['lotus79', 1, false], ['mx5 mx52016', 0, false],
  ]);
});

test('what the manager remembers goes through the store, and needs the settings to be there', async () => {
  const settings = {
    paintDir, libraryRoot, customerId: CUSTOMER, includeSpec: true, setReadOnlyAfter: false, clearOtherCooked: false,
    autoUpdateOnLaunch: false,
  };
  await invoke('saveSettings', { settings });
  expect(await invoke('loadSettings')).toEqual(settings);
  await expect(invoke('saveSettings', {})).rejects.toThrow(/needs the settings/);
  await expect(invoke('saveSettings')).rejects.toThrow(/needs the settings/);
  expect(await invoke('loadSettings')).toEqual(settings);

  // `installDir` is set by hand beside them and is the app's to read, not the page's: a save keeps it.
  remembered = { ...remembered, installDir: install };
  await invoke('saveSettings', { settings: { ...settings, customerId: STRANGER } });
  expect(remembered).toEqual({ ...settings, customerId: STRANGER, installDir: install });
  expect(await invoke('loadSettings')).toEqual({ ...settings, customerId: STRANGER });
});

test('only the 18 commands can be called', async () => {
  expect(paintsIpc.NAMES).toHaveLength(18);
  for (const name of ['__proto__', 'constructor', 'toString', 'createCommands', '', 42, null, undefined]) {
    await expect(invoke(name, {}), String(name)).rejects.toThrow(/Not a paints command/);
  }
});
