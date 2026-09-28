/**
 * overlay-settings.json can't be lost: a write is atomic, a BOM is fine, a file that won't parse is copied aside
 * before anything replaces it, and the one-key writers refuse to write over a file they couldn't read.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const settingsFile = require('../../modules/js/settings-file.js');

let root;
test.beforeAll(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'racing-desk-settings-')); });
test.afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

const fileIn = (tag) => {
  const dir = path.join(root, tag);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'overlay-settings.json');
};
const HUD = { zoom: 120, layoutPosition: 'bottom-right', showSpotter: false, raceLinks: { 'Caterham Academy Challenge': '6273' } };

test('no file is a first run: empty settings, and saving creates it', () => {
  const file = fileIn('missing');
  expect(settingsFile.read(file)).toEqual({ settings: {}, state: 'missing' });
  expect(settingsFile.save(file, HUD)).toEqual({ kept: null });
  expect(settingsFile.load(file)).toEqual(HUD);
  expect(fs.existsSync(`${file}.tmp`)).toBe(false);
});

test('a UTF-8 BOM is not an error', () => {
  const file = fileIn('bom');
  fs.writeFileSync(file, `﻿${JSON.stringify(HUD)}`);
  expect(settingsFile.read(file)).toEqual({ settings: HUD, state: 'ok' });
});

test('a file that will not parse, or is not an object, is unreadable', () => {
  const file = fileIn('unreadable');
  for (const text of ['{"zoom": 12', '', 'null', '[1,2]', '"text"']) {
    fs.writeFileSync(file, text);
    expect(settingsFile.read(file), JSON.stringify(text)).toEqual({ settings: {}, state: 'unreadable' });
  }
});

test('setting one key keeps every other', () => {
  const file = fileIn('setkey');
  settingsFile.save(file, HUD);
  settingsFile.setKey(file, 'paints', { customerId: '424242' });
  expect(settingsFile.load(file)).toEqual({ ...HUD, paints: { customerId: '424242' } });
});

test('setting one key refuses to write over a file it could not read, and leaves it as it is', () => {
  const file = fileIn('refuse');
  const truncated = JSON.stringify(HUD).slice(0, 40);
  fs.writeFileSync(file, truncated);
  expect(() => settingsFile.setKey(file, 'paints', { customerId: '424242' })).toThrow(/can't be read/);
  expect(fs.readFileSync(file, 'utf8')).toBe(truncated);
  expect(fs.readdirSync(path.dirname(file))).toEqual(['overlay-settings.json']);
});

test('replacing an unreadable file keeps a copy of it first', () => {
  const file = fileIn('kept');
  const truncated = JSON.stringify(HUD).slice(0, 40);
  fs.writeFileSync(file, truncated);
  const { kept } = settingsFile.save(file, { zoom: 100 }, { now: () => 1234 });
  expect(path.basename(kept)).toBe('overlay-settings.unreadable-1234.json');
  expect(fs.readFileSync(kept, 'utf8')).toBe(truncated);
  expect(settingsFile.load(file)).toEqual({ zoom: 100 });
});

test('only an object can be saved', () => {
  const file = fileIn('shape');
  settingsFile.save(file, HUD);
  for (const bad of [null, undefined, 'text', 3, [1]]) {
    expect(() => settingsFile.save(file, bad), String(bad)).toThrow(/must be an object/);
  }
  expect(settingsFile.load(file)).toEqual(HUD);
});
