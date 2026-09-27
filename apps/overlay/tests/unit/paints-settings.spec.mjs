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
  clearOtherCooked: null, autoUpdateOnLaunch: null,
};

test('the defaults are the Settings shape with every field null', () => {
  expect(settings.DEFAULTS).toEqual(ALL_NULL);
  expect(settings.KEYS).toEqual(Object.keys(ALL_NULL));
  expect(Object.isFrozen(settings.DEFAULTS)).toBe(true);
});

test('round-trips through JSON', () => {
  const s = settings.normalise({ paintDir: 'C:\\Users\\x\\Documents\\iRacing\\paint', customerId: '1159839', includeSpec: true });
  const back = settings.normalise(JSON.parse(JSON.stringify(s)));
  expect(back.customerId).toBe('1159839');
  expect(back.includeSpec).toBe(true);
  expect(back.libraryRoot).toBeNull();
  expect(back).toEqual({ ...ALL_NULL, paintDir: 'C:\\Users\\x\\Documents\\iRacing\\paint', customerId: '1159839', includeSpec: true });
});

test('unknown and missing fields are tolerated', () => {
  // An older or newer settings file must not stop the app starting.
  const { settings: s, problems } = settings.validate({ customerId: '42', somethingNew: true });
  expect(s).toEqual({ ...ALL_NULL, customerId: '42' });
  expect(problems).toEqual([]);
  expect(s).not.toHaveProperty('somethingNew');
});

test('wrong-typed fields are dropped and named', () => {
  const { settings: s, problems } = settings.validate({ customerId: 1159839, includeSpec: 'yes', paintDir: 'ok', autoUpdateOnLaunch: false });
  expect(s).toEqual({ ...ALL_NULL, paintDir: 'ok', autoUpdateOnLaunch: false });
  expect(problems).toEqual(['customerId must be a string; ignoring it.', 'includeSpec must be true or false; ignoring it.']);
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
  let held = { customerId: '1159839', libraryRoot: 'L', stale: true };
  const store = { get: () => held, set: (obj) => { held = obj; } };
  expect(settings.load(store)).toEqual({ ...ALL_NULL, customerId: '1159839', libraryRoot: 'L' });

  const saved = settings.save(store, { paintDir: 'P', includeSpec: 'nope', extra: 1 });
  expect(saved).toEqual({ ...ALL_NULL, paintDir: 'P' });
  expect(held).toEqual(saved);
  expect(settings.load(store)).toEqual(saved);

  // A store that throws yields the defaults rather than stopping the app.
  expect(settings.load({ get: () => { throw new Error('disk'); }, set: () => {} })).toEqual(ALL_NULL);
  expect(settings.load(undefined)).toEqual(ALL_NULL);
  expect(() => settings.save(null, {})).toThrow('No settings store to save into.');
});
