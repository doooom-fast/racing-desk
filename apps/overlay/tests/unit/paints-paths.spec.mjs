/**
 * Finding Documents\iRacing\paint: registry-style %VAR% expansion, reg query parsing, the cheap survey, and the
 * OneDrive trap built in a temp folder — two live paint folders, ranked by what is in them, never chosen silently.
 * Port of the tests in apps/paints/src-tauri/src/paths.rs plus the detect() paths those left to the real machine.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const paths = require('../../modules/js/paints/paths.js');

let root;
test.beforeAll(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'racing-desk-paints-paths-')); });
test.afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

function paintFolder(docs, cars) {
  const paint = path.join(docs, 'iRacing', 'paint');
  for (const [car, files] of Object.entries(cars)) {
    fs.mkdirSync(path.join(paint, car), { recursive: true });
    for (const f of files) fs.writeFileSync(path.join(paint, car, f), 'x');
  }
  return paint;
}

test.describe('expandEnv', () => {
  test('expands known variables', () => {
    expect(paths.expandEnv('%RD_TEST_VAR%\\Documents', { RD_TEST_VAR: 'C:\\somewhere' })).toBe('C:\\somewhere\\Documents');
  });

  test('leaves unknown variables visible', () => {
    // A blanked-out variable would look like a plausible relative path; a visible %NAME% is obviously wrong.
    expect(paths.expandEnv('%NO_SUCH_VAR_HERE%\\x', {})).toBe('%NO_SUCH_VAR_HERE%\\x');
  });

  test('handles an unbalanced percent', () => {
    expect(paths.expandEnv('100% done', {})).toBe('100% done');
    expect(paths.expandEnv('plain', {})).toBe('plain');
    expect(paths.expandEnv('%A%-%B', { A: 'a' })).toBe('a-%B');
  });
});

test('spots OneDrive paths', () => {
  expect(paths.looksLikeOneDrive('C:\\Users\\x\\OneDrive\\Documents')).toBe(true);
  expect(paths.looksLikeOneDrive('C:\\Users\\x\\onedrive - Contoso\\Documents')).toBe(true);
  expect(paths.looksLikeOneDrive('C:\\Users\\x\\Documents')).toBe(false);
});

test.describe('parseRegQuery', () => {
  test('reads REG_SZ and REG_EXPAND_SZ values, spaces in the path intact', () => {
    const shell = '\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders\r\n'
      + '    Personal    REG_SZ    C:\\Users\\Kevin Conboy\\Documents\r\n\r\n';
    expect(paths.parseRegQuery(shell)).toBe('C:\\Users\\Kevin Conboy\\Documents');
    const user = '\r\nHKEY_CURRENT_USER\\...\\User Shell Folders\r\n    Personal    REG_EXPAND_SZ    %USERPROFILE%\\Documents\r\n';
    expect(paths.parseRegQuery(user)).toBe('%USERPROFILE%\\Documents');
  });

  test('nothing there means null, not a guess', () => {
    expect(paths.parseRegQuery('ERROR: The system was unable to find the specified registry key or value.')).toBeNull();
    expect(paths.parseRegQuery('')).toBeNull();
  });
});

test('documentsFromRegistry drives reg query with no window and expands what comes back', async () => {
  const calls = [];
  const exec = async (file, args) => {
    calls.push([file, ...args]);
    const value = args[1].endsWith('User Shell Folders') ? '%USERPROFILE%\\Documents' : 'C:\\Users\\x\\Documents';
    return { status: 0, stdout: `\r\n${args[1]}\r\n    Personal    REG_SZ    ${value}\r\n`, stderr: '', error: null };
  };
  const docs = await paths.documentsFromRegistry({ exec, env: { USERPROFILE: 'C:\\Users\\x' }, platform: 'win32' });
  expect(docs).toEqual([
    { path: 'C:\\Users\\x\\Documents', source: 'registry Shell Folders' },
    { path: 'C:\\Users\\x\\Documents', source: 'registry User Shell Folders' },
  ]);
  expect(calls).toHaveLength(2);
  expect(calls[0]).toEqual(['reg', 'query', paths.REGISTRY_KEYS[0][0], '/v', 'Personal']);

  // A failing reg, or another platform, contributes nothing rather than an error.
  expect(await paths.documentsFromRegistry({ exec: async () => ({ status: 1, stdout: '', stderr: 'nope', error: null }), platform: 'win32' })).toEqual([]);
  expect(await paths.documentsFromRegistry({ exec, platform: 'linux' })).toEqual([]);
});

test('survey counts car folders and samples textures', () => {
  const docs = path.join(root, 'survey');
  const cars = {};
  for (let i = 0; i < 15; i++) cars[`car${String(i).padStart(2, '0')}`] = ['car_424242.tga', 'car_spec_424242.mip', 'readme.txt'];
  const paint = paintFolder(docs, cars);
  fs.writeFileSync(path.join(paint, 'helmet_1.tga'), 'x');   // a file at the top level is not a car folder
  const s = paths.survey(paint);
  expect(s.carFolders).toBe(15);
  // Only the first 12 folders are sampled: it ranks candidates, it is not a census.
  expect(s.textureFiles).toBe(12 * 2);
  expect(paths.survey(path.join(root, 'missing'))).toEqual({ carFolders: 0, textureFiles: 0 });
});

test.describe('detect', () => {
  test('the OneDrive trap: two live folders, ranked by contents, flagged as ambiguous', async () => {
    const profile = path.join(root, 'trap', 'Users', 'x');
    const oneDrive = path.join(profile, 'OneDrive');
    // The sim reads the OneDrive one: it is full. The plain one has a single stale car.
    const busy = paintFolder(path.join(oneDrive, 'Documents'), {
      lotus79: ['car_424242.tga', 'car_spec_424242.tga', 'car_999.tga'],
      mx5: ['car_424242.tga'],
    });
    const stale = paintFolder(path.join(profile, 'Documents'), { lotus79: ['car_424242.tga'] });

    const report = await paths.detect({
      env: { USERPROFILE: profile, OneDrive: oneDrive },
      registry: async () => [{ path: path.join(oneDrive, 'Documents'), source: 'registry Shell Folders' }],
    });

    expect(report.chosen).toBe(busy);
    expect(report.ambiguous).toBe(true);
    expect(report.notes).toHaveLength(1);
    expect(report.notes[0]).toContain('OneDrive redirects Documents');
    // Deduplicated on the final path: the registry saw the OneDrive folder first, so %OneDrive% adds nothing.
    expect(report.candidates.map((c) => c.path)).toEqual([busy, stale]);
    expect(report.candidates[0]).toEqual({
      path: busy, source: 'registry Shell Folders', exists: true, isOneDrive: true, carFolders: 2, textureFiles: 4,
    });
    expect(report.candidates[1]).toEqual({
      path: stale, source: '%USERPROFILE%', exists: true, isOneDrive: false, carFolders: 1, textureFiles: 1,
    });
  });

  test('a lone folder is chosen without fuss, and a missing one is listed but not chosen', async () => {
    const profile = path.join(root, 'lone', 'Users', 'x');
    const paint = paintFolder(path.join(profile, 'Documents'), { lotus79: ['car_424242.tga'] });
    const report = await paths.detect({
      env: { USERPROFILE: profile, OneDriveConsumer: path.join(profile, 'OneDrive') },
      registry: async () => [],
    });
    expect(report.chosen).toBe(paint);
    expect(report.ambiguous).toBe(false);
    expect(report.notes).toEqual([]);
    expect(report.candidates).toHaveLength(2);
    expect(report.candidates[1]).toMatchObject({ source: '%OneDriveConsumer%', exists: false, isOneDrive: true, carFolders: 0, textureFiles: 0 });
  });

  test('nothing on disk: no choice, and a note saying to set it by hand', async () => {
    const report = await paths.detect({ env: { USERPROFILE: path.join(root, 'nobody') }, registry: async () => [] });
    expect(report.chosen).toBeNull();
    expect(report.ambiguous).toBe(false);
    expect(report.notes).toEqual(['No iRacing paint folder found. Set it by hand if the sim keeps its files somewhere unusual.']);
    expect(report.candidates).toHaveLength(1);
    expect(report.candidates[0].exists).toBe(false);
  });

  test('no environment at all still answers', async () => {
    const report = await paths.detect({ env: {}, registry: async () => [] });
    expect(report).toEqual({ candidates: [], chosen: null, ambiguous: false, notes: [
      'No iRacing paint folder found. Set it by hand if the sim keeps its files somewhere unusual.',
    ] });
  });
});
