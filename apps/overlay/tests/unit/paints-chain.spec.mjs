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

let root, paintDir, libraryRoot, backups, car, commands, store, remembered;
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

  remembered = {};
  store = { get: () => remembered, set: (obj) => { remembered = obj; } };
  commands = paints.createCommands({
    backupsBase: backups,
    env: { ...process.env, APPDATA: path.join(root, 'no-appdata') },   // no Trading Paints config to find
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
});

test('only the 17 commands can be called', async () => {
  expect(paintsIpc.NAMES).toHaveLength(17);
  for (const name of ['__proto__', 'constructor', 'toString', 'createCommands', '', 42, null, undefined]) {
    await expect(invoke(name, {}), String(name)).rejects.toThrow(/Not a paints command/);
  }
});
