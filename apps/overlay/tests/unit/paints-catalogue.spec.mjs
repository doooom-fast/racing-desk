/**
 * Every car the rig knows: finding the iRacing install (set by hand, the iracing:// registration from a faked
 * `reg query`, the usual places), walking its cars folder into car paths, and merging the library, the install and
 * the paint directory into one named list — over a temp install, a temp paint directory and a temp library. Nothing
 * here reads the real install, the real registry or the real paint folder.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const catalogue = require('../../modules/js/paints/catalogue.js');
const library = require('../../modules/js/paints/library.js');

const CUSTOMER = '424242';

let root;
test.beforeAll(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'racing-desk-paints-catalogue-')); });
test.afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

function touch(file, content = 'x') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

// An install the shape of the real one: <root>\cars\<car>\<car>.dat, nested cars, families, and folders that are
// not cars at all. The .dat files are a byte long — that they are there is all the walk asks.
function install(tag, cars) {
  const dir = path.join(root, tag, 'iRacing');
  fs.mkdirSync(path.join(dir, 'cars'), { recursive: true });
  for (const car of cars) {
    const parts = car.split('/');
    touch(path.join(dir, 'cars', ...parts, `${parts[parts.length - 1]}.dat`));
    touch(path.join(dir, 'cars', ...parts, 'version.txt'), '2026.09.01.01');
  }
  return dir;
}

const regAnswer = (value) => ({
  status: 0,
  stdout: `\r\nHKEY_CURRENT_USER\\Software\\Classes\\iracing\\shell\\open\\command\r\n    (Default)    REG_SZ    ${value}\r\n\r\n`,
  stderr: '',
  error: null,
});
const noReg = async () => ({ status: 1, stdout: '', stderr: 'ERROR: The system was unable to find the specified registry key or value.', error: null });

test.describe('the iracing:// registration', () => {
  test('the default value is read out of reg query, quoted path and all', () => {
    const out = regAnswer('"C:\\Program Files (x86)\\Steam\\steamapps\\common\\iRacing\\ui\\iRacingUI.exe" "%1"').stdout;
    expect(catalogue.parseDefaultValue(out)).toBe('"C:\\Program Files (x86)\\Steam\\steamapps\\common\\iRacing\\ui\\iRacingUI.exe" "%1"');
    expect(catalogue.parseDefaultValue('ERROR: The system was unable to find the specified registry key or value.')).toBeNull();
    expect(catalogue.parseDefaultValue('')).toBeNull();
    expect(catalogue.parseDefaultValue(undefined)).toBeNull();
  });

  test('the program is the quoted path, or up to the .exe, or the first word', () => {
    expect(catalogue.programOf('"C:\\Program Files (x86)\\iRacing\\ui\\iRacingUI.exe" "%1"')).toBe('C:\\Program Files (x86)\\iRacing\\ui\\iRacingUI.exe');
    expect(catalogue.programOf('C:\\Program Files (x86)\\iRacing\\ui\\iRacingUI.exe "%1"')).toBe('C:\\Program Files (x86)\\iRacing\\ui\\iRacingUI.exe');
    expect(catalogue.programOf('C:\\iRacing\\ui\\iRacingUI.EXE')).toBe('C:\\iRacing\\ui\\iRacingUI.EXE');
    expect(catalogue.programOf('launcher --url %1')).toBe('launcher');
    expect(catalogue.programOf('"unterminated')).toBeNull();
    expect(catalogue.programOf('')).toBeNull();
    expect(catalogue.programOf(null)).toBeNull();
  });
});

test.describe('installRoot', () => {
  test('from the registration: two folders above the program, asked for with reg query and no window', async () => {
    const dir = install('registered', ['lotus79']);
    const calls = [];
    const exec = async (file, args) => {
      calls.push([file, ...args]);
      return regAnswer(`"${path.join(dir, 'ui', 'iRacingUI.exe')}" "%1"`);
    };
    expect(await catalogue.installRoot({ env: {}, exec, platform: 'win32' })).toBe(dir);
    expect(calls).toEqual([['reg', 'query', catalogue.URL_HANDLER_KEY, '/ve']]);
    expect(catalogue.URL_HANDLER_KEY).toBe('HKCU\\Software\\Classes\\iracing\\shell\\open\\command');
  });

  test('a registration written with %VARIABLES% is expanded', async () => {
    const dir = install('expanded', ['lotus79']);
    const exec = async () => regAnswer('"%RD_TEST_INSTALL%\\ui\\iRacingUI.exe" "%1"');
    expect(await catalogue.installRoot({ env: { RD_TEST_INSTALL: dir }, exec, platform: 'win32' })).toBe(dir);
  });

  test('a folder set by hand comes first — when it holds a cars folder', async () => {
    const registered = install('hand-registered', ['lotus79']);
    const byHand = install('hand-set', ['mx5/mx52016']);
    const exec = async () => regAnswer(`"${path.join(registered, 'ui', 'iRacingUI.exe')}" "%1"`);
    expect(await catalogue.installRoot({ override: byHand, env: {}, exec, platform: 'win32' })).toBe(byHand);
    expect(await catalogue.installRoot({ override: `  ${byHand}  `, env: {}, exec, platform: 'win32' })).toBe(byHand);
    // One that does not is passed over, not trusted: a stale setting must not empty the list.
    const stale = path.join(root, 'hand-stale');
    fs.mkdirSync(stale, { recursive: true });
    expect(await catalogue.installRoot({ override: stale, env: {}, exec, platform: 'win32' })).toBe(registered);
    expect(await catalogue.installRoot({ override: 42, env: {}, exec, platform: 'win32' })).toBe(registered);
  });

  test('a registration pointing at an install that has gone falls through to the usual places', async () => {
    const programFiles = path.join(root, 'usual', 'Program Files (x86)');
    const steam = path.join(programFiles, 'Steam', 'steamapps', 'common', 'iRacing');
    touch(path.join(steam, 'cars', 'lotus79', 'lotus79.dat'));
    const exec = async () => regAnswer(`"${path.join(root, 'usual', 'gone', 'iRacing', 'ui', 'iRacingUI.exe')}" "%1"`);
    const env = { 'ProgramFiles(x86)': programFiles };
    expect(await catalogue.installRoot({ env, exec, platform: 'win32' })).toBe(steam);
    expect(catalogue.usualInstalls(env)).toEqual([steam, path.join(programFiles, 'iRacing')]);

    // Steam's first, the stand-alone install's after.
    const alone = path.join(root, 'usual-alone', 'Program Files (x86)');
    touch(path.join(alone, 'iRacing', 'cars', 'lotus79', 'lotus79.dat'));
    expect(await catalogue.installRoot({ env: { 'ProgramFiles(x86)': alone }, exec: noReg, platform: 'win32' })).toBe(path.join(alone, 'iRacing'));
  });

  test('nothing anywhere is null, whatever reg says — and another platform asks no registry', async () => {
    expect(await catalogue.installRoot({ env: {}, exec: noReg, platform: 'win32' })).toBeNull();
    expect(await catalogue.installRoot({ env: {}, exec: async () => ({ status: null, stdout: '', stderr: '', error: new Error('ENOENT') }), platform: 'win32' })).toBeNull();
    expect(await catalogue.installRoot({ env: {}, exec: async () => regAnswer(''), platform: 'win32' })).toBeNull();
    let asked = 0;
    expect(await catalogue.installRoot({ env: {}, exec: async () => { asked += 1; return noReg(); }, platform: 'linux' })).toBeNull();
    expect(asked).toBe(0);
  });

  test('a registration that is not the path of a program points at no install, whatever the working directory holds', async () => {
    // What reg prints for a key with no default value, a bare command, and a handler that is not an .exe. Two
    // folders above any of them is `.`, and the working directory is nobody's install.
    const cwd = process.cwd();
    const here = path.join(root, 'cwd');
    touch(path.join(here, 'cars', 'notiracing', 'notiracing.dat'));
    touch(path.join(here, 'iRacing', 'cars', 'notiracing', 'notiracing.dat'));
    process.chdir(here);
    try {
      for (const value of ['(value not set)', 'launcher --url %1', 'rundll32 url.dll,FileProtocolHandler %1', '"iRacingUI.exe" "%1"', '"ui\\iRacingUI.exe" "%1"']) {
        const exec = async () => regAnswer(value);
        expect(await catalogue.installFromRegistry({ env: {}, exec, platform: 'win32' }), value).toBeNull();
        expect(await catalogue.installRoot({ env: {}, exec, platform: 'win32' }), value).toBeNull();
      }
      // The same for a folder set by hand, or a usual place, that is not a whole path.
      expect(await catalogue.installRoot({ override: '.', env: {}, exec: noReg, platform: 'win32' })).toBeNull();
      expect(await catalogue.installRoot({ env: { ProgramFiles: '.' }, exec: noReg, platform: 'win32' })).toBeNull();
      expect(await catalogue.installRoot({ override: here, env: {}, exec: noReg, platform: 'win32' })).toBe(here);
    } finally {
      process.chdir(cwd);
    }
  });

  test('reg is given three seconds, and one that takes longer is no registration', async () => {
    const dir = install('slow-reg', ['lotus79']);
    const limits = [];
    const exec = async (file, args, options) => {
      limits.push(options && options.timeoutMs);
      return { status: null, signal: 'SIGTERM', stdout: '', stderr: '', error: new Error('reg took longer than 3000 ms') };
    };
    expect(await catalogue.installRoot({ override: dir, env: {}, exec, platform: 'win32' })).toBe(dir);
    expect(await catalogue.installRoot({ env: {}, exec, platform: 'win32' })).toBeNull();
    expect(limits).toEqual([3000, 3000]);
  });
});

test.describe('the walk', () => {
  test('top-level cars, nested cars, and folders with no .dat that are not cars', () => {
    const dir = install('walk', ['lotus79', 'mclaren570sgt4', 'caterham/caterham420r', 'caterham/caterhamacademy', 'dirtsprint/winged/410']);
    // Folders that hold no .dat of their own: a stray one, an empty one, and one holding a .dat file's cousin.
    fs.mkdirSync(path.join(dir, 'cars', 'emptyfolder'));
    touch(path.join(dir, 'cars', 'notacar', 'readme.txt'));
    touch(path.join(dir, 'cars', 'notacar', 'data.dat.bak'));
    touch(path.join(dir, 'cars', 'trucks', 'tundra2015', 'version.txt'));
    touch(path.join(dir, 'cars', 'loose.dat'));   // a file in cars\ itself is nobody's

    expect(catalogue.installedCars(dir)).toEqual([
      'caterham caterham420r', 'caterham caterhamacademy', 'dirtsprint winged 410', 'lotus79', 'mclaren570sgt4',
    ]);
    expect(catalogue.walkInstall(dir).families).toEqual([]);
  });

  test('a folder with a .dat of its own and cars beneath it is a family, not certainly a car', () => {
    // As the real install has it: mx5\mx5.dat beside mx5\mx52016\mx52016.dat, fordgt\fordgt.dat beside
    // fordgt\gt3\gt3.dat, and three deep under stockcars2\chevy.
    const dir = install('families', ['mx5', 'mx5/mx52016', 'mx5/cup', 'fordgt', 'fordgt/gt3', 'stockcars2', 'stockcars2/chevy', 'stockcars2/chevy/cot', 'lotus79']);
    const walked = catalogue.walkInstall(dir);
    expect(walked.cars).toEqual(['fordgt gt3', 'lotus79', 'mx5 cup', 'mx5 mx52016', 'stockcars2 chevy cot']);
    expect(walked.families).toEqual(['fordgt', 'mx5', 'stockcars2', 'stockcars2 chevy']);
    expect(catalogue.installedCars(dir)).toEqual(walked.cars);
  });

  test('.DAT counts whatever its case, and the walk stops four folders down', () => {
    const dir = path.join(root, 'walk-case', 'iRacing');
    touch(path.join(dir, 'cars', 'Lotus79', 'LOTUS79.DAT'));
    touch(path.join(dir, 'cars', 'a', 'b', 'c', 'd', 'd.dat'));
    touch(path.join(dir, 'cars', 'a', 'b', 'c', 'd', 'e', 'e.dat'));
    expect(catalogue.installedCars(dir)).toEqual(['Lotus79', 'a b c d']);
  });

  test('the pace cars under cars\\safety are not cars to paint', () => {
    // The store never names them — the session YAML's pace car is left out — so they would be listed for good
    // under their folder names.
    const dir = install('pace-cars', ['lotus79', 'safety/pcporsche911cup', 'safety/pcsedan', 'trucks/safety']);
    touch(path.join(dir, 'cars', 'safety', 'version.txt'));
    expect(catalogue.walkInstall(dir)).toEqual({ cars: ['lotus79', 'trucks safety'], families: [] });
    expect(catalogue.catalogue({ installRoot: dir }).map((c) => c.folder)).toEqual(['lotus79', 'trucks safety']);
  });

  test('no install, or one with no cars folder, is no cars', () => {
    expect(catalogue.installedCars(null)).toEqual([]);
    expect(catalogue.installedCars(path.join(root, 'no-such-install'))).toEqual([]);
    const bare = path.join(root, 'bare-install');
    fs.mkdirSync(bare, { recursive: true });
    expect(catalogue.walkInstall(bare)).toEqual({ cars: [], families: [] });
  });
});

test.describe('catalogue', () => {
  let dir, paintDir, libraryRoot;
  const NAMES = [
    { car_path: 'mx5 mx52016', name: 'Mazda MX-5 Cup', short_name: 'MX-5 Cup', car_id: 67, driven: 668, seen: 702 },
    { car_path: 'lotus79', name: 'Lotus 79', short_name: 'Lotus 79', car_id: 42, driven: 41, seen: 44 },
    { car_path: 'mclaren570sgt4', name: 'McLaren 570S GT4', short_name: '570S GT4', car_id: 135, driven: 0, seen: 140 },
    { car_path: 'fordgt', name: 'Ford GT', short_name: 'Ford GT', car_id: 40, driven: 0, seen: 1 },
    { car_path: 'ferrari296gt3', name: 'Ferrari 296 GT3', short_name: '296 GT3', car_id: 173, driven: 0, seen: 93 },   // seen, never installed
  ];

  test.beforeAll(() => {
    dir = install('rig', [
      'lotus79', 'mclaren570sgt4', 'dallarair18', 'mx5', 'mx5/mx52016', 'mx5/cup', 'fordgt', 'fordgt/gt3',
      'solstice', 'solstice/rookie', 'caterham/caterham420r',
    ]);

    // The paint directory as the rig has it: the sim's own folders, a checkout of the library, car folders with
    // files in, car folders the sim made and nobody has filled, and one for a car that is no longer installed.
    paintDir = path.join(root, 'rig', 'Documents', 'iRacing', 'paint');
    for (const folder of ['helmets', 'suits', 'cars', 'lotus79', 'mx5 mx52016', 'mclaren570sgt4', 'solstice', 'oldcar', 'emptyoldcar']) {
      fs.mkdirSync(path.join(paintDir, folder), { recursive: true });
    }
    touch(path.join(paintDir, 'helmet_424242.tga'));                                   // a file, not a folder
    touch(path.join(paintDir, 'helmets', 'car_spec_999000.mip'));                       // Trading Paints leaves these
    touch(path.join(paintDir, 'suits', 'car_decal_999000.tga'));
    touch(path.join(paintDir, 'lotus79', `car_${CUSTOMER}.tga`), 'paint');
    touch(path.join(paintDir, 'mx5 mx52016', `car_${CUSTOMER}.tga`), 'paint');
    touch(path.join(paintDir, 'mx5 mx52016', 'car_999000.mip'), 'theirs');
    touch(path.join(paintDir, 'oldcar', 'car_999000.mip'), 'theirs');
    touch(path.join(paintDir, 'emptyoldcar', 'notes.txt'), 'nothing of a car');

    libraryRoot = path.join(paintDir, 'doooom-liveries', 'cars');
    touch(path.join(paintDir, 'doooom-liveries', 'README.md'), 'a library, not a car');
    touch(path.join(libraryRoot, 'lotus79', 'v12', `car_${CUSTOMER}.tga`), 'v12 paint');
    touch(path.join(libraryRoot, 'lotus79', 'v13', `car_${CUSTOMER}.tga`), 'v13 paint');
    touch(path.join(libraryRoot, 'mx5-mx52016', 'orange', `car_${CUSTOMER}.tga`), 'orange paint');
    touch(path.join(libraryRoot, 'dallarair18', 'v1', 'car.tga'), 'ir18 paint');
    touch(path.join(libraryRoot, 'nissangtpzxt', 'v1', 'car.tga'), 'nissan paint');     // in the library, not on the rig
  });

  const list = (over = {}) => catalogue.catalogue({
    library: library.scan(libraryRoot, paintDir), paintDir, installRoot: dir, names: NAMES, ...over,
  });
  const find = (cars, folder) => cars.find((c) => c.folder === folder);

  test('every car once, by name: the library\'s, the install\'s and the paint directory\'s', () => {
    const cars = list();
    expect(cars.map((c) => [c.name || c.folder, c.folder])).toEqual([
      ['caterham caterham420r', 'caterham caterham420r'],
      ['dallarair18', 'dallarair18'],
      ['Ford GT', 'fordgt'],
      ['fordgt gt3', 'fordgt gt3'],
      ['Lotus 79', 'lotus79'],
      ['Mazda MX-5 Cup', 'mx5-mx52016'],
      ['McLaren 570S GT4', 'mclaren570sgt4'],
      ['mx5 cup', 'mx5 cup'],
      ['nissangtpzxt', 'nissangtpzxt'],
      ['oldcar', 'oldcar'],
      ['solstice', 'solstice'],
      ['solstice rookie', 'solstice rookie'],
    ]);
    for (const car of cars) {
      expect(Object.keys(car), car.folder).toEqual(['folder', 'simFolder', 'simFolderInferred', 'versions', 'name', 'shortName', 'installed', 'driven']);
    }
  });

  test('a library car keeps what the library said of it, and gains its name', () => {
    const cars = list();
    const scanned = library.scan(libraryRoot, paintDir).cars;
    expect(find(cars, 'lotus79')).toEqual({
      folder: 'lotus79', simFolder: 'lotus79', simFolderInferred: false, versions: scanned.find((c) => c.folder === 'lotus79').versions,
      name: 'Lotus 79', shortName: 'Lotus 79', installed: true, driven: 41,
    });
    expect(find(cars, 'lotus79').versions.map((v) => v.id)).toEqual(['v12', 'v13']);
    // In the library and in the install, with no paint folder yet: the library's null stands.
    expect(find(cars, 'dallarair18')).toMatchObject({ simFolder: null, installed: true, name: null, shortName: null, driven: 0 });
    expect(find(cars, 'dallarair18').versions).toHaveLength(1);
    // In the library and nowhere else.
    expect(find(cars, 'nissangtpzxt')).toMatchObject({ simFolder: null, simFolderInferred: false, installed: false, name: null, driven: 0 });
  });

  test('mx5-mx52016 in the library and mx5 mx52016 in the sim are one car', () => {
    const cars = list();
    expect(cars.filter((c) => library.normalise(c.simFolder || c.folder) === 'mx5 mx52016')).toHaveLength(1);
    expect(find(cars, 'mx5 mx52016')).toBeUndefined();
    expect(find(cars, 'mx5-mx52016')).toMatchObject({
      folder: 'mx5-mx52016', simFolder: 'mx5 mx52016', simFolderInferred: true, name: 'Mazda MX-5 Cup', shortName: 'MX-5 Cup',
      installed: true, driven: 668,
    });
    expect(find(cars, 'mx5-mx52016').versions.map((v) => v.id)).toEqual(['orange']);

    // The same without a paint folder to match it to: the library cannot say where it installs, and it is
    // still the install's mx5 mx52016 and still has its name.
    const unpainted = catalogue.catalogue({ library: library.scan(libraryRoot, null), paintDir: null, installRoot: dir, names: NAMES });
    expect(find(unpainted, 'mx5 mx52016')).toBeUndefined();
    expect(find(unpainted, 'mx5-mx52016')).toMatchObject({ simFolder: null, name: 'Mazda MX-5 Cup', installed: true, driven: 668 });
  });

  test('a car outside the library is its car path, with its paint folder when it has one', () => {
    const cars = list();
    expect(find(cars, 'mclaren570sgt4')).toEqual({
      folder: 'mclaren570sgt4', simFolder: 'mclaren570sgt4', simFolderInferred: false, versions: [],
      name: 'McLaren 570S GT4', shortName: '570S GT4', installed: true, driven: 0,
    });
    expect(find(cars, 'caterham caterham420r')).toEqual({
      folder: 'caterham caterham420r', simFolder: null, simFolderInferred: false, versions: [],
      name: null, shortName: null, installed: true, driven: 0,
    });
    // `caterham` holds no .dat of its own: a folder of cars, never a car.
    expect(find(cars, 'caterham')).toBeUndefined();
  });

  test('a family is listed when something knows it as a car: a name, or a paint folder', () => {
    const cars = list();
    expect(find(cars, 'fordgt')).toMatchObject({ name: 'Ford GT', simFolder: null, installed: true });      // named
    expect(find(cars, 'solstice')).toMatchObject({ name: null, simFolder: 'solstice', installed: true });   // a paint folder
    expect(find(cars, 'mx5')).toBeUndefined();                                                              // neither
    // The cars beneath a family are cars whatever becomes of it.
    expect(find(cars, 'mx5 cup')).toMatchObject({ installed: true, versions: [] });
    expect(find(cars, 'fordgt gt3')).toMatchObject({ installed: true });
    expect(find(cars, 'solstice rookie')).toMatchObject({ installed: true });
    // With no names and no paint directory, none of the families is.
    const bare = catalogue.catalogue({ library: null, paintDir: null, installRoot: dir, names: [] });
    expect(bare.map((c) => c.folder)).toEqual([
      'caterham caterham420r', 'dallarair18', 'fordgt gt3', 'lotus79', 'mclaren570sgt4', 'mx5 cup', 'mx5 mx52016', 'solstice rookie',
    ]);
  });

  test('in the paint directory, a folder is a car when it is installed or holds car files — not helmets, suits, cars or the library', () => {
    const cars = list();
    const folders = cars.map((c) => c.folder);
    for (const not of ['helmets', 'suits', 'cars', 'doooom-liveries', 'emptyoldcar']) expect(folders, not).not.toContain(not);
    // No longer installed, but its paint folder still holds car files.
    expect(find(cars, 'oldcar')).toEqual({
      folder: 'oldcar', simFolder: 'oldcar', simFolderInferred: false, versions: [], name: null, shortName: null, installed: false, driven: 0,
    });
    // The paint directory alone: the folders with car files in, and nothing else.
    const paintOnly = catalogue.catalogue({ library: null, paintDir, installRoot: null, names: NAMES });
    expect(paintOnly.map((c) => [c.folder, c.name, c.installed])).toEqual([
      ['lotus79', 'Lotus 79', false], ['mx5 mx52016', 'Mazda MX-5 Cup', false], ['oldcar', null, false],
    ]);
  });

  test('the folder the library is in is not a car, whatever is lying in it', () => {
    // A texture at the top of the checkout, and the library itself a folder of the paint directory.
    const paint = path.join(root, 'library-inside', 'paint');
    touch(path.join(paint, 'lotus79', `car_${CUSTOMER}.tga`), 'paint');
    touch(path.join(paint, 'doooom-liveries', `car_${CUSTOMER}.tga`), 'left at the top of the checkout');
    touch(path.join(paint, 'doooom-liveries', 'cars', 'lotus79', 'v1', 'car.tga'), 'v1 paint');
    touch(path.join(paint, 'Liveries', 'car_spec.tga'), 'a template beside the car folders');
    touch(path.join(paint, 'Liveries', 'lotus79', 'v2', 'car.tga'), 'v2 paint');
    touch(path.join(paint, 'Liveries', 'oldcar', `car_${CUSTOMER}.mip`), 'theirs');

    const folders = (libraryPath) => catalogue
      .catalogue({ library: library.scan(libraryPath, paint), paintDir: paint, installRoot: null, names: [] })
      .map((c) => c.folder);
    expect(folders(path.join(paint, 'doooom-liveries', 'cars'))).toEqual(['Liveries', 'lotus79']);
    expect(folders(path.join(paint, 'liveries'))).toEqual(['doooom-liveries', 'lotus79']);   // whatever its case
    expect(folders(`${path.join(paint, 'Liveries')}${path.sep}`)).toEqual(['doooom-liveries', 'lotus79']);
    // A library that is not a folder at all takes nothing out of the list.
    expect(folders(path.join(paint, 'no-such-library'))).toEqual(['doooom-liveries', 'Liveries', 'lotus79']);
  });

  test('a name for a car the rig does not have adds nothing, and rubbish among the names is passed over', () => {
    expect(find(list(), 'ferrari296gt3')).toBeUndefined();
    const odd = list({
      names: [
        null, 'lotus79', { name: 'No path' }, { car_path: 42, name: 'Not a path' },
        { car_path: 'LOTUS79', name: '  ', short_name: '', driven: '7' },
        { car_path: 'lotus79', name: 'Second for the same car', driven: 1 },
        { car_path: 'mclaren570sgt4', name: 'McLaren 570S GT4', driven: -3 },
        { car_path: 'dallarair18', name: 'Dallara IR18', short_name: 'IR18', driven: 'many' },
      ],
    });
    // Matched whatever its case; a blank name is no name; the first row for a car stands.
    expect(find(odd, 'lotus79')).toMatchObject({ name: null, shortName: null, driven: 7 });
    expect(find(odd, 'mclaren570sgt4')).toMatchObject({ name: 'McLaren 570S GT4', shortName: null, driven: 0 });
    expect(find(odd, 'dallarair18')).toMatchObject({ name: 'Dallara IR18', shortName: 'IR18', driven: 0 });
    for (const names of [undefined, null, 'nope', {}]) expect(list({ names }).every((c) => c.name === null)).toBe(true);
  });

  test('nothing to go on is an empty list', () => {
    expect(catalogue.catalogue()).toEqual([]);
    expect(catalogue.catalogue({ library: null, paintDir: path.join(root, 'no-paint'), installRoot: path.join(root, 'no-install'), names: NAMES })).toEqual([]);
    expect(catalogue.catalogue({ library: { root: 'x', cars: [], notes: [] } })).toEqual([]);
  });
});
