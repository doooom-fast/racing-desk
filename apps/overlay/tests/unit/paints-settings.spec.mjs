/**
 * The Settings shape: defaults, validation of what a store hands back (unknown and wrong-typed fields tolerated,
 * as serde's `default` did), merge, and load/save through an injected { get(), set(obj) } store.
 * Port of the tests in apps/paints/src-tauri/src/settings.rs, minus the file — persistence is main.js's.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const settings = require('../../modules/js/paints/settings.js');

const ALL_NULL = {
  paintDir: null, libraryRoot: null, customerId: null, includeSpec: null, setReadOnlyAfter: null,
  clearOtherCooked: null, autoUpdateLibrary: null,
};

test('the defaults are the Settings shape with every field null', () => {
  expect(settings.DEFAULTS).toEqual(ALL_NULL);
  expect(settings.KEYS).toEqual(Object.keys(ALL_NULL));
  expect(Object.isFrozen(settings.DEFAULTS)).toBe(true);
});

test('round-trips through JSON', () => {
  const s = settings.normalise({ paintDir: 'C:\\Users\\x\\Documents\\iRacing\\paint', customerId: '424242', includeSpec: true });
  const back = settings.normalise(JSON.parse(JSON.stringify(s)));
  expect(back.customerId).toBe('424242');
  expect(back.includeSpec).toBe(true);
  expect(back.libraryRoot).toBeNull();
  expect(back).toEqual({ ...ALL_NULL, paintDir: 'C:\\Users\\x\\Documents\\iRacing\\paint', customerId: '424242', includeSpec: true });
});

test('unknown and missing fields are tolerated', () => {
  // An older or newer settings file must not stop the app starting.
  const { settings: s, problems } = settings.validate({ customerId: '42', somethingNew: true });
  expect(s).toEqual({ ...ALL_NULL, customerId: '42' });
  expect(problems).toEqual([]);
  expect(s).not.toHaveProperty('somethingNew');
});

test('wrong-typed fields are dropped and named', () => {
  const { settings: s, problems } = settings.validate({ customerId: 424242, includeSpec: 'yes', paintDir: 'ok', autoUpdateLibrary: false });
  expect(s).toEqual({ ...ALL_NULL, paintDir: 'ok', autoUpdateLibrary: false });
  expect(problems).toEqual(['customerId must be a string; ignoring it.', 'includeSpec must be true or false; ignoring it.']);
  expect(settings.validate({ autoUpdateLibrary: 'sometimes' })).toEqual({
    settings: ALL_NULL, problems: ['autoUpdateLibrary must be true or false; ignoring it.'],
  });
});

test('the library keeps itself up to date unless it is set to false: null, until he chooses, is not a no', () => {
  // The page reads null as on, so null has to stay null through a load and a save, and only a false is a no.
  expect(settings.normalise({}).autoUpdateLibrary).toBeNull();
  expect(settings.normalise({ autoUpdateLibrary: null }).autoUpdateLibrary).toBeNull();
  expect(settings.normalise({ autoUpdateLibrary: true }).autoUpdateLibrary).toBe(true);
  expect(settings.normalise({ autoUpdateLibrary: false }).autoUpdateLibrary).toBe(false);
  expect(settings.merge({ ...ALL_NULL, autoUpdateLibrary: false }, { autoUpdateLibrary: null }).autoUpdateLibrary).toBeNull();
  expect(settings.merge({ ...ALL_NULL, autoUpdateLibrary: false }, { paintDir: 'P' }).autoUpdateLibrary).toBe(false);
});

test('autoUpdateOnLaunch, which older files hold, is accepted and never read: what it said was the old default, not a choice', () => {
  expect(settings.LEGACY_KEYS).toEqual(['autoUpdateOnLaunch']);
  expect(settings.KEYS).not.toContain('autoUpdateOnLaunch');
  // Whatever it holds — the false the page saved, a true, or something that is not a boolean — it is dropped, and not
  // reported: an old file loads clean.
  for (const value of [false, true, null, 'yes', 7]) {
    const { settings: s, problems } = settings.validate({ customerId: '42', autoUpdateOnLaunch: value });
    expect(s, String(value)).toEqual({ ...ALL_NULL, customerId: '42' });
    expect(s).not.toHaveProperty('autoUpdateOnLaunch');
    expect(problems, String(value)).toEqual([]);
  }
  // As he has it: only the old false in the file. Nothing there says he turned it off.
  const old = settings.normalise('{"paintDir":"P","autoUpdateOnLaunch":false}');
  expect(old.autoUpdateLibrary).toBeNull();
  // The first save takes it out of the file.
  let held = { paintDir: 'P', autoUpdateOnLaunch: false, installDir: 'D:\\Sims\\iRacing' };
  const store = { get: () => held, set: (obj) => { held = obj; } };
  settings.save(store, { ...settings.load(store) });
  expect(held).toEqual({ ...ALL_NULL, paintDir: 'P', installDir: 'D:\\Sims\\iRacing' });
  expect(held).not.toHaveProperty('autoUpdateOnLaunch');
});

test('rubbish is the defaults: not an object, corrupt JSON, nothing', () => {
  expect(settings.normalise(undefined)).toEqual(ALL_NULL);
  expect(settings.normalise(null)).toEqual(ALL_NULL);
  expect(settings.normalise([1, 2])).toEqual(ALL_NULL);
  expect(settings.normalise('{ not json')).toEqual(ALL_NULL);
  expect(settings.validate('{ not json').problems[0]).toMatch(/could not be parsed/);
  // A JSON string of the right shape is accepted, since a store may hand the file back raw.
  expect(settings.normalise('{"customerId":"7"}')).toEqual({ ...ALL_NULL, customerId: '7' });
});

test('merge: the patch wins where it says something, null clears, undefined keeps', () => {
  const base = { ...ALL_NULL, paintDir: 'P', customerId: '1', includeSpec: true };
  expect(settings.merge(base, { customerId: '2', includeSpec: null, junk: 1 })).toEqual({ ...ALL_NULL, paintDir: 'P', customerId: '2', includeSpec: null });
  expect(settings.merge(base, { customerId: 99 })).toEqual({ ...ALL_NULL, paintDir: 'P', customerId: null, includeSpec: true });
  expect(settings.merge(base, undefined)).toEqual(base);
});

test('load and save through a store', () => {
  let held = { customerId: '424242', libraryRoot: 'L', stale: true };
  const store = { get: () => held, set: (obj) => { held = obj; } };
  expect(settings.load(store)).toEqual({ ...ALL_NULL, customerId: '424242', libraryRoot: 'L' });

  const saved = settings.save(store, { paintDir: 'P', includeSpec: 'nope', extra: 1 });
  expect(saved).toEqual({ ...ALL_NULL, paintDir: 'P' });
  expect(held).toEqual(saved);
  expect(settings.load(store)).toEqual(saved);

  // A store that throws yields the defaults rather than stopping the app.
  expect(settings.load({ get: () => { throw new Error('disk'); }, set: () => {} })).toEqual(ALL_NULL);
  expect(settings.load(undefined)).toEqual(ALL_NULL);
  expect(() => settings.save(null, {})).toThrow('No settings store to save into.');
});

test('the host\'s own keys ride along in the store: kept by a save, never loaded or saved as Settings', () => {
  expect(settings.HOST_KEYS).toEqual(['installDir']);
  let held = { customerId: '424242', installDir: 'D:\\Sims\\iRacing', stale: true };
  const store = { get: () => held, set: (obj) => { held = obj; } };
  expect(settings.load(store)).toEqual({ ...ALL_NULL, customerId: '424242' });
  expect(settings.hostValues(store)).toEqual({ installDir: 'D:\\Sims\\iRacing' });

  // The page cannot set one, or clear one, by sending it.
  const saved = settings.save(store, { paintDir: 'P', installDir: 'C:\\elsewhere' });
  expect(saved).toEqual({ ...ALL_NULL, paintDir: 'P' });
  expect(held).toEqual({ ...ALL_NULL, paintDir: 'P', installDir: 'D:\\Sims\\iRacing' });
  settings.save(store, { paintDir: 'P', installDir: null });
  expect(held.installDir).toBe('D:\\Sims\\iRacing');

  // One that is not a path is not kept, and a store that cannot be read has none.
  for (const bad of [42, '', '   ', null, ['x']]) {
    held = { installDir: bad };
    expect(settings.hostValues(store), String(bad)).toEqual({});
    settings.save(store, { customerId: '7' });
    expect(held).toEqual({ ...ALL_NULL, customerId: '7' });
  }
  expect(settings.hostValues({ get: () => { throw new Error('disk'); } })).toEqual({});
  expect(settings.hostValues({ get: () => 'rubbish' })).toEqual({});
  expect(settings.hostValues(undefined)).toEqual({});
});
