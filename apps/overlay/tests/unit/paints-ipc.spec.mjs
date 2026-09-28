/**
 * The desk's paints:invoke, minus Electron: only the livery manager's own command names are dispatched, each with
 * the renderer's named arguments turned into the positional ones modules/js/paints takes, and a command's result or
 * rejection comes back as it was.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const paintsIpc = require('../../modules/js/paints-ipc.js');
const { COMMAND_NAMES } = require('../../modules/js/paints/index.js');

// A stand-in for paints.createCommands(): every command records what it was called with and answers with its name.
function recorder() {
  const calls = [];
  const commands = {};
  for (const name of COMMAND_NAMES) {
    commands[name] = async (...args) => { calls.push([name, ...args]); return `${name} done`; };
  }
  return { commands, calls };
}

const store = { get: () => ({}), set: () => {} };

test('exactly the 18 commands, in the order the port lists them', () => {
  expect(paintsIpc.NAMES).toEqual(COMMAND_NAMES);
  expect(paintsIpc.NAMES).toHaveLength(18);
});

test('names outside the list are refused before anything runs — including Object.prototype\'s and non-strings', async () => {
  const { commands, calls } = recorder();
  for (const name of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'detect_paths', 'DetectPaths', '', null, undefined, 42, ['detectPaths']]) {
    expect(paintsIpc.isCommand(commands, name), String(name)).toBe(false);
    await expect(paintsIpc.invoke(commands, store, name, {}), String(name)).rejects.toThrow(`Not a paints command: ${String(name)}`);
  }
  expect(calls).toEqual([]);
  // A name from the list that the commands object lacks is refused too: the list says what may be called, the
  // commands say what can be.
  const { detectPaths: _omitted, ...fewer } = commands;
  expect(paintsIpc.isCommand(fewer, 'detectPaths')).toBe(false);
  expect(paintsIpc.isCommand(null, 'detectPaths')).toBe(false);
  expect(paintsIpc.isCommand(commands, 'detectPaths')).toBe(true);
});

test('named arguments become the positional ones each command takes', async () => {
  const { commands, calls } = recorder();
  const request = { paintDir: 'P', libraryRoot: 'L', carFolder: 'lotus79', simFolder: 'lotus79', versionId: 'v13', customerId: '1', includeSpec: true, setReadOnlyAfter: false, clearOtherCooked: false, force: false };
  const carArgs = { paintDir: 'P', libraryRoot: 'L', carFolder: 'lotus79', simFolder: null, customerId: '1' };
  const revertArgs = { paintDir: 'P', carFolder: 'lotus79', simFolder: 'lotus79', customerId: '1', backupId: null, force: false };

  expect(await paintsIpc.invoke(commands, store, 'detectPaths')).toBe('detectPaths done');
  await paintsIpc.invoke(commands, store, 'detectCustomer', { paintDir: 'P' });
  await paintsIpc.invoke(commands, store, 'scanLibrary', { libraryRoot: 'L', paintDir: null });
  await paintsIpc.invoke(commands, store, 'carState', carArgs);
  await paintsIpc.invoke(commands, store, 'tradingPaintsStatus', {});
  await paintsIpc.invoke(commands, store, 'simStatus', undefined);
  await paintsIpc.invoke(commands, store, 'preflight', { paintDir: 'P', simFolder: 'lotus79' });
  await paintsIpc.invoke(commands, store, 'applyVersion', { request });
  await paintsIpc.invoke(commands, store, 'listBackups', { carFolder: 'lotus79' });
  await paintsIpc.invoke(commands, store, 'revertCar', revertArgs);
  await paintsIpc.invoke(commands, store, 'repoStatus', { path: 'L' });
  await paintsIpc.invoke(commands, store, 'repoCheck', { path: 'L' });
  await paintsIpc.invoke(commands, store, 'repoPull', { path: 'L' });
  await paintsIpc.invoke(commands, store, 'suggestLibraries', { paintDir: 'P' });
  await paintsIpc.invoke(commands, store, 'loadSettings');
  await paintsIpc.invoke(commands, store, 'saveSettings', { settings: { customerId: '1' } });
  await paintsIpc.invoke(commands, store, 'previewImage', { path: 'car.tga', maxEdge: 640 });
  await paintsIpc.invoke(commands, store, 'carCatalogue', { libraryRoot: 'L', paintDir: 'P', installRoot: 'not the page\'s to say' });

  expect(calls).toEqual([
    ['detectPaths'],
    ['detectCustomer', 'P'],
    ['scanLibrary', 'L', null],
    ['carState', carArgs],
    ['tradingPaintsStatus'],
    ['simStatus'],
    ['preflight', 'P', 'lotus79'],
    ['applyVersion', request],
    ['listBackups', 'lotus79'],
    ['revertCar', revertArgs],
    ['repoStatus', 'L'],
    ['repoCheck', 'L'],
    ['repoPull', 'L'],
    ['suggestLibraries', 'P'],
    ['loadSettings', store],
    ['saveSettings', { customerId: '1' }, store],
    ['previewImage', 'car.tga', 640],
    ['carCatalogue', { libraryRoot: 'L', paintDir: 'P' }],
  ]);
});

test('a command\'s rejection comes back as it was, message and all', async () => {
  const { commands } = recorder();
  const refusal = Object.assign(new Error('iRacing is running. Close the sim before applying a paint.'), { kind: 'refused' });
  commands.applyVersion = async () => { throw refusal; };
  await expect(paintsIpc.invoke(commands, store, 'applyVersion', { request: {} })).rejects.toBe(refusal);
});
