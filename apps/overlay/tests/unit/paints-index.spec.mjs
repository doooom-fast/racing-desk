/**
 * The command surface: the 17 Tauri command names in camelCase and the desk's own carCatalogue, each taking
 * src/api.ts's arguments and returning src/types.ts's shapes, driven end to end over temp folders with the machine
 * checks faked quiet — including the lib.rs-level errors and the settings store hand-off.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const paints = require('../../modules/js/paints/index.js');
const { createCommands, commands, COMMAND_NAMES } = paints;

const CUSTOMER = '424242';
const NAMES = [
  'detectPaths', 'detectCustomer', 'scanLibrary', 'carState', 'tradingPaintsStatus', 'simStatus', 'preflight',
  'applyVersion', 'listBackups', 'revertCar', 'repoStatus', 'repoCheck', 'repoPull', 'suggestLibraries',
  'loadSettings', 'saveSettings', 'previewImage', 'carCatalogue',
  'liveryGroups', 'saveGroup', 'deleteGroup', 'setGroup',
];

const quietSim = async () => ({ simRunning: false, uiRunning: false, matched: [] });
const quietTp = async () => ({
  configFound: false, configPath: null, running: false, userId: null, downloadMySchemes: null,
  deleteBeforeDownloading: null, deleteAfterSession: null, keepSynced: null, warnings: [],
});

let root;
let fx;
let cmd;
test.beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'racing-desk-paints-index-'));
  fx = {
    paint: path.join(root, 'Documents', 'iRacing', 'paint'),
    library: path.join(root, 'library'),
    backups: path.join(root, 'backups'),
    profile: root,
  };
  // The sim's folder for the Lotus, and a library with two versions of it.
  fs.mkdirSync(path.join(fx.paint, 'lotus79'), { recursive: true });
  fs.writeFileSync(path.join(fx.paint, 'lotus79', `car_${CUSTOMER}.tga`), 'PAINT 12');
  fs.writeFileSync(path.join(fx.paint, 'lotus79', `car_${CUSTOMER}.mip`), 'cooked');
  for (const [id, paint] of [['v12', 'PAINT 12'], ['v13', 'PAINT 13']]) {
    const dir = path.join(fx.library, 'lotus79', id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `car_${CUSTOMER}.tga`), paint);
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ name: `${id} Shatter` }));
  }
  cmd = createCommands({
    backupsBase: fx.backups,
    simState: quietSim,
    tradingPaints: quietTp,
    env: { USERPROFILE: fx.profile, LOCALAPPDATA: path.join(root, 'AppData', 'Local') },
    registry: async () => [],
  });
});
test.afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

test('exactly the 22 commands — the Tauri ones in camelCase, then the desk\'s own — every one async', () => {
  expect(Object.keys(commands)).toEqual(NAMES);
  expect(COMMAND_NAMES).toEqual(NAMES);
  expect(Object.keys(cmd)).toEqual(NAMES);
  for (const name of NAMES) expect(typeof cmd[name], name).toBe('function');
  // No Electron in any of it: everything loaded under plain Node.
  for (const mod of ['apply', 'catalogue', 'customer', 'digest', 'groups', 'helmets', 'installed', 'library', 'paths', 'process', 'repo', 'roles', 'settings', 'tga', 'tradingpaints']) {
    expect(typeof paints[mod], mod).toBe('object');
  }
});

test('detectPaths and detectCustomer use the injected environment', async () => {
  const report = await cmd.detectPaths();
  expect(report.chosen).toBe(fx.paint);
  expect(report.ambiguous).toBe(false);
  expect(report.candidates[0]).toMatchObject({ source: '%USERPROFILE%', exists: true, carFolders: 1, textureFiles: 2 });

  const who = await cmd.detectCustomer(fx.paint);
  expect(who).toMatchObject({ id: CUSTOMER, confidence: 'guess' });

  const certain = createCommands({ tradingPaints: async () => ({ ...(await quietTp()), userId: '42' }) });
  expect(await certain.detectCustomer(fx.paint)).toMatchObject({ id: '42', confidence: 'certain' });
});

test('scanLibrary and carState, in the library and out of it', async () => {
  const lib = await cmd.scanLibrary(fx.library, fx.paint);
  expect(lib.cars.map((c) => c.folder)).toEqual(['lotus79']);
  expect(lib.cars[0].simFolder).toBe('lotus79');
  expect(lib.cars[0].versions.map((v) => v.name)).toEqual(['v12 Shatter', 'v13 Shatter']);

  const state = await cmd.carState({ paintDir: fx.paint, libraryRoot: fx.library, carFolder: 'lotus79', simFolder: null, customerId: CUSTOMER });
  expect(state).toMatchObject({ simFolder: 'lotus79', folderExists: true, appliedVersionId: 'v12', matchKind: 'exact' });
  expect(state.cooked.map((p) => path.basename(p))).toEqual([`car_${CUSTOMER}.mip`]);

  // An explicit sim folder overrides the car's.
  const elsewhere = await cmd.carState({ paintDir: fx.paint, libraryRoot: fx.library, carFolder: 'lotus79', simFolder: 'nissangtpzxt', customerId: CUSTOMER });
  expect(elsewhere).toMatchObject({ simFolder: 'nissangtpzxt', folderExists: false, appliedVersionId: null });

  // A car the library has no folder for is not an error — the list holds every car on the rig — it has no
  // versions to be one of. (lib.rs refused it: "mx5 is not in the library.")
  expect(await cmd.carState({ paintDir: fx.paint, libraryRoot: fx.library, carFolder: 'mx5', simFolder: null, customerId: CUSTOMER }))
    .toMatchObject({ simFolder: null, folderExists: false, files: [], appliedVersionId: null, matchKind: 'none' });
  // Nor is no library at all: the Lotus's files are read, and nothing claims them.
  const unmatched = await cmd.carState({ paintDir: fx.paint, libraryRoot: '', carFolder: 'lotus79', simFolder: null, customerId: CUSTOMER });
  expect(unmatched).toMatchObject({ simFolder: 'lotus79', folderExists: true, appliedVersionId: null, matchKind: 'none' });
  expect(unmatched.files.map((f) => f.fileName)).toEqual([`car_${CUSTOMER}.tga`]);
});

test('tradingPaintsStatus, simStatus and preflight come from the injected checks', async () => {
  expect(await cmd.tradingPaintsStatus()).toEqual(await quietTp());
  expect(await cmd.simStatus()).toEqual({ simRunning: false, uiRunning: false, matched: [] });
  expect(await cmd.preflight(fx.paint, 'lotus79')).toEqual({ blockers: [], warnings: [] });
  expect((await cmd.preflight(fx.paint, 'mx5')).blockers[0]).toMatch(/^There is no mx5 folder/);
});

test('applyVersion → carState → listBackups → revertCar → carState, through the commands', async () => {
  const request = {
    paintDir: fx.paint, libraryRoot: fx.library, carFolder: 'lotus79', simFolder: 'lotus79', versionId: 'v13',
    customerId: CUSTOMER, includeSpec: true, setReadOnlyAfter: false, clearOtherCooked: false, force: false,
  };
  await expect(cmd.applyVersion({ ...request, versionId: 'v99' })).rejects.toThrow('lotus79 / v99 is no longer in the library.');
  await expect(cmd.applyVersion({ ...request, carFolder: 'mx5' })).rejects.toThrow('mx5 / v13 is no longer in the library.');
  expect(fs.existsSync(fx.backups)).toBe(false);

  const report = await cmd.applyVersion(request);
  expect(report.applied).toBe(true);
  expect(report.backupDir.startsWith(path.join(fx.backups, 'lotus79'))).toBe(true);
  expect(fs.readFileSync(path.join(fx.paint, 'lotus79', `car_${CUSTOMER}.tga`), 'utf8')).toBe('PAINT 13');
  expect(fs.existsSync(path.join(fx.paint, 'lotus79', `car_${CUSTOMER}.mip`))).toBe(false);

  const args = { paintDir: fx.paint, libraryRoot: fx.library, carFolder: 'lotus79', simFolder: null, customerId: CUSTOMER };
  expect(await cmd.carState(args)).toMatchObject({ appliedVersionId: 'v13', matchKind: 'exact', cooked: [] });

  const backups = await cmd.listBackups('lotus79');
  expect(backups).toHaveLength(1);
  expect(backups[0]).toMatchObject({ reason: 'apply v13', fileCount: 2, path: report.backupDir });
  expect(await cmd.listBackups('mx5')).toEqual([]);

  const reverted = await cmd.revertCar({ paintDir: fx.paint, carFolder: 'lotus79', simFolder: 'lotus79', customerId: CUSTOMER, backupId: null, force: false });
  expect(reverted.applied).toBe(true);
  expect(reverted.backupDir).toBe(report.backupDir);
  expect(await cmd.carState(args)).toMatchObject({ appliedVersionId: 'v12', matchKind: 'exact' });
  expect(fs.readFileSync(path.join(fx.paint, 'lotus79', `car_${CUSTOMER}.mip`), 'utf8')).toBe('cooked');
  expect(await cmd.listBackups('lotus79')).toHaveLength(2);

  await expect(cmd.revertCar({ paintDir: fx.paint, carFolder: 'mx5', simFolder: 'mx5', customerId: CUSTOMER, backupId: null, force: false }))
    .rejects.toThrow('There is no backup to go back to for this car.');
});

test('the default backups base is under %LOCALAPPDATA%\\Racing Desk when none is given', async () => {
  const local = path.join(root, 'AppData', 'Local');
  const withEnv = createCommands({ simState: quietSim, tradingPaints: quietTp, env: { LOCALAPPDATA: local } });
  expect(await withEnv.listBackups('lotus79')).toEqual([]);
  // Nothing was created just by asking.
  expect(fs.existsSync(path.join(local, 'Racing Desk', 'paints', 'backups'))).toBe(false);
  expect(paints.apply.backupsBase({ env: { LOCALAPPDATA: local } })).toBe(path.join(local, 'Racing Desk', 'paints', 'backups'));
});

test('repoStatus, repoCheck, repoPull and suggestLibraries over temp folders', async () => {
  const st = await cmd.repoStatus(fx.library);
  expect(st).toMatchObject({ gitAvailable: true, isRepo: false });
  await expect(cmd.repoCheck(fx.library)).rejects.toThrow('The library is not inside a git repository.');
  await expect(cmd.repoPull(fx.library)).rejects.toThrow('The library is not inside a git repository.');
  // The library sits beside the paint folder's grandparent, not near it, and Documents\GitHub is empty here.
  expect(await cmd.suggestLibraries(fx.paint)).toEqual([]);
  fs.mkdirSync(path.join(fx.profile, 'Documents', 'GitHub'), { recursive: true });
  fs.cpSync(fx.library, path.join(fx.profile, 'Documents', 'GitHub', 'liveries', 'cars'), { recursive: true });
  const found = await cmd.suggestLibraries(fx.paint);
  expect(found.map((s) => s.path)).toEqual([path.join(fx.profile, 'Documents', 'GitHub', 'liveries', 'cars')]);
  expect(found[0].cars).toBe(1);
});

test('loadSettings and saveSettings go through the caller\'s store and keep the Settings shape', async () => {
  let held = { customerId: CUSTOMER, junk: 1 };
  const store = { get: () => held, set: (obj) => { held = obj; } };
  expect(await cmd.loadSettings(store)).toEqual({
    paintDir: null, libraryRoot: null, customerId: CUSTOMER, includeSpec: null, setReadOnlyAfter: null,
    clearOtherCooked: null, autoUpdateLibrary: null,
  });
  expect(await cmd.saveSettings({ paintDir: fx.paint, autoUpdateLibrary: false, includeSpec: 'no' }, store)).toBeNull();
  expect(held).toEqual({
    paintDir: fx.paint, libraryRoot: null, customerId: null, includeSpec: null, setReadOnlyAfter: null,
    clearOtherCooked: null, autoUpdateLibrary: false,
  });
  expect(await cmd.loadSettings({ get: () => { throw new Error('no file'); } })).toEqual(paints.settings.DEFAULTS);
});

test('previewImage returns a data URL for a TGA and passes a PNG through', async () => {
  const tgaPath = path.join(root, 'car.tga');
  const bytes = Buffer.alloc(18 + 3);
  bytes[2] = 2; bytes[12] = 1; bytes[14] = 1; bytes[16] = 24; bytes[17] = 0x20;
  bytes[18] = 0; bytes[19] = 0; bytes[20] = 255;   // BGR red
  fs.writeFileSync(tgaPath, bytes);
  const url = await cmd.previewImage(tgaPath, 64);
  expect(url.startsWith('data:image/png;base64,')).toBe(true);
  const png = Buffer.from(url.split(',')[1], 'base64');
  fs.writeFileSync(path.join(root, 'p.png'), png);
  expect(await cmd.previewImage(path.join(root, 'p.png'))).toBe(`data:image/png;base64,${png.toString('base64')}`);
  await expect(cmd.previewImage(path.join(root, 'nope.bmp'))).rejects.toThrow();
});
