/**
 * Which customer id is yours: the tally over a fake paint folder and the three-step cascade with its confidence
 * levels — certain from the downloader's config, likely from a hand-installed spec map, guess from frequency.
 * Port of the tests in apps/paints/src-tauri/src/customer.rs plus the cascade itself with a fake Trading Paints.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const customer = require('../../modules/js/paints/customer.js');

let root;
test.beforeAll(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'racing-desk-paints-customer-')); });
test.afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

function fixture(tag, cars) {
  const dir = path.join(root, tag);
  for (const [car, files] of Object.entries(cars)) {
    fs.mkdirSync(path.join(dir, car), { recursive: true });
    for (const f of files) fs.writeFileSync(path.join(dir, car, f), 'x');
  }
  return dir;
}

const noTradingPaints = async () => ({
  configFound: false, configPath: null, running: false, userId: null, downloadMySchemes: null,
  deleteBeforeDownloading: null, deleteAfterSession: null, keepSynced: null, warnings: [],
});

test.describe('tally', () => {
  test('a spec map in .tga form beats raw frequency', () => {
    // The exact shape of the real machine: a stranger has more paints, the owner is the only one with a .tga
    // spec map.
    const dir = fixture('spec', {
      lotus79: ['car_999111.tga', 'car_888222.tga', 'car_424242.tga', 'car_spec_424242.tga'],
      mx5: ['car_999111.tga', 'car_888222.tga'],
    });
    const ranked = customer.tally(dir);
    expect(ranked[0]).toEqual({ id: '424242', paints: 1, localSpecMaps: 1, carFolders: 1 });
    expect(ranked.map((c) => c.id)).toEqual(['424242', '888222', '999111']);   // then paints, then id
  });

  test('cooked .mip files are not evidence', () => {
    // A .mip is the sim's cache. Counting it would credit every downloaded paint.
    const dir = fixture('mip', { lotus79: ['car_spec_777.mip', 'car_555.tga'] });
    const ranked = customer.tally(dir);
    expect(ranked.find((c) => c.id === '777')).toBeUndefined();
    expect(ranked.find((c) => c.id === '555')).toEqual({ id: '555', paints: 1, localSpecMaps: 0, carFolders: 1 });
  });

  test('counts car folders once per id', () => {
    const dir = fixture('folders', { a: ['car_42.tga', 'car_spec_42.tga'], b: ['car_42.tga', 'car_spec_42.tga'] });
    expect(customer.tally(dir).find((c) => c.id === '42')).toEqual({ id: '42', paints: 2, localSpecMaps: 2, carFolders: 2 });
  });

  test('helmets and suits are not car ids', () => {
    const dir = fixture('helmets', { lotus79: ['helmet_314159.tga', 'suit_314159.tga'] });
    expect(customer.tally(dir)).toEqual([]);
  });

  test('a missing folder tallies to nothing', () => {
    expect(customer.tally(path.join(root, 'nope'))).toEqual([]);
  });
});

test('validates ids', () => {
  expect(customer.isValid('424242')).toBe(true);
  expect(customer.isValid('')).toBe(false);
  expect(customer.isValid('abc')).toBe(false);
  expect(customer.isValid('424 242')).toBe(false);
  expect(customer.isValid('1234567890123')).toBe(false);
  expect(customer.isValid(424242)).toBe(false);
  expect(customer.isValid(null)).toBe(false);
});

test.describe('detect — the cascade', () => {
  test('certain: Trading Paints says so, whatever the folder looks like', async () => {
    const dir = fixture('certain', { lotus79: ['car_999.tga', 'car_spec_999.tga'] });
    const report = await customer.detect(dir, {
      tradingPaints: async () => ({ ...(await noTradingPaints()), configFound: true, userId: '424242' }),
    });
    expect(report.id).toBe('424242');
    expect(report.confidence).toBe('certain');
    expect(report.source).toBe('Trading Paints downloader config');
    expect(report.notes).toEqual(['Trading Paints is configured for customer 424242, which is where this came from.']);
    // The pick-list is still offered.
    expect(report.candidates.map((c) => c.id)).toEqual(['999']);
  });

  test('likely: the only id with a spec map in .tga form', async () => {
    const dir = fixture('likely', {
      lotus79: ['car_999111.tga', 'car_888222.tga', 'car_424242.tga', 'car_spec_424242.tga', 'car_spec_888222.mip'],
      mx5: ['car_999111.tga', 'car_888222.tga'],
    });
    const report = await customer.detect(dir, { tradingPaints: noTradingPaints });
    expect(report).toMatchObject({ id: '424242', confidence: 'likely', source: 'hand-installed spec maps' });
    expect(report.notes[0]).toContain('is the only id with spec maps in .tga form');
  });

  test('guess: two ids with hand-installed spec maps fall through to frequency, with both notes', async () => {
    const dir = fixture('guess', {
      lotus79: ['car_111.tga', 'car_spec_111.tga', 'car_222.tga', 'car_spec_222.tga', 'car_333.tga'],
      mx5: ['car_333.tga'],
      gt3: ['car_333.tga'],
    });
    const report = await customer.detect(dir, { tradingPaints: noTradingPaints });
    expect(report).toMatchObject({ id: '333', confidence: 'guess', source: 'most frequent id in the paint folder' });
    expect(report.notes).toHaveLength(2);
    expect(report.notes[0]).toBe('2 ids have hand-installed spec maps, so that signal did not settle it.');
    expect(report.notes[1]).toContain('weak signal');
  });

  test('guess: plain frequency when nothing is hand-installed', async () => {
    const dir = fixture('freq', { lotus79: ['car_5.tga', 'car_6.tga'], mx5: ['car_5.tga'] });
    const report = await customer.detect(dir, { tradingPaints: noTradingPaints });
    expect(report.id).toBe('5');
    expect(report.confidence).toBe('guess');
    expect(report.candidates[0]).toEqual({ id: '5', paints: 2, localSpecMaps: 0, carFolders: 2 });
  });

  test('nothing: an empty paint folder has no id and says why', async () => {
    const dir = fixture('empty', { lotus79: ['car_spec_1.mip', 'notes.txt'] });
    const report = await customer.detect(dir, { tradingPaints: noTradingPaints });
    expect(report).toEqual({
      id: null, confidence: null, source: null, candidates: [],
      notes: ['No car textures found, so there was nothing to infer an id from.'],
    });
  });

  test('the report has exactly the CustomerReport shape', async () => {
    const dir = fixture('shape', { lotus79: ['car_1.tga'] });
    const report = await customer.detect(dir, { tradingPaints: noTradingPaints });
    expect(Object.keys(report).sort()).toEqual(['candidates', 'confidence', 'id', 'notes', 'source']);
    expect(Object.keys(report.candidates[0]).sort()).toEqual(['carFolders', 'id', 'localSpecMaps', 'paints']);
  });
});
