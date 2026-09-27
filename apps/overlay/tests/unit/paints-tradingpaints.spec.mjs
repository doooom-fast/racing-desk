/**
 * The Trading Paints downloader's config.xml: the real file shape (BOM and all), truncation, the settings that
 * decide whether an apply survives, and the account id — read from a fake config in a temp APPDATA, returned to
 * the caller and never logged. Port of the tests in apps/paints/src-tauri/src/tradingpaints.rs plus inspect().
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const tp = require('../../modules/js/paints/tradingpaints.js');

// A made-up account id. It must come back in the report and must never appear in anything logged.
const FAKE_ID = '8675309';

// Trimmed from a real config.xml, BOM and all.
const sample = (opts = {}) => '﻿<?xml version="1.0" encoding="utf-8"?>\n'
  + '<!--This is the main configuration of the downloader-->\n<Settings>\n'
  + `  <Option>\n    <configname>Delete schemes once session ends</configname>\n    <configvalue>${opts.deleteAfter ?? 'False'}</configvalue>\n  </Option>\n`
  + `  <Option>\n    <configname>Download my schemes</configname>\n    <configvalue>${opts.downloadMine ?? 'False'}</configvalue>\n  </Option>\n`
  + `  <Option>\n    <configname>Delete schemes before downloading</configname>\n    <configvalue>${opts.deleteBefore ?? 'True'}</configvalue>\n  </Option>\n`
  + (opts.keepSynced !== undefined
    ? `  <Option>\n    <configname>Keep my paints synced from website</configname>\n    <configvalue>${opts.keepSynced}</configvalue>\n  </Option>\n`
    : '')
  + `  <Option>\n    <configname>User ID</configname>\n    <configvalue>${opts.userId ?? FAKE_ID}</configvalue>\n  </Option>\n`
  + '</Settings>';

let root;
test.beforeAll(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'racing-desk-paints-tp-')); });
test.afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

// A fake %APPDATA% holding the downloader's config.
function appdata(tag, xml) {
  const dir = path.join(root, tag);
  if (xml !== null) {
    fs.mkdirSync(path.join(dir, 'TradingPaints Downloader'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'TradingPaints Downloader', 'config.xml'), xml, 'utf8');
  } else {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

const notRunning = async () => false;
const running = async () => true;

test.describe('parseConfig', () => {
  test('reads the real config shape', () => {
    const map = tp.parseConfig(sample());
    expect(map.get('User ID')).toBe(FAKE_ID);
    expect(tp.asBool(map, tp.KEY_DOWNLOAD_MINE)).toBe(false);
    expect(tp.asBool(map, tp.KEY_DELETE_BEFORE)).toBe(true);
    expect(tp.asBool(map, tp.KEY_DELETE_AFTER)).toBe(false);
  });

  test('the BOM does not break the first tag', () => {
    // Left in, the BOM rides along on the opening tag and the whole file reads empty.
    expect(tp.parseConfig(sample()).size).toBe(4);
  });

  test('a truncated file does not pair across options', () => {
    const map = tp.parseConfig('<configname>A</configname><configvalue>1</configvalue><configname>B</configname>');
    expect(map.get('A')).toBe('1');
    expect(map.has('B')).toBe(false);
  });

  test('unknown booleans stay unknown', () => {
    const m = new Map([['k', 'maybe'], ['y', ' YES '], ['n', '0']]);
    expect(tp.asBool(m, 'k')).toBeNull();
    expect(tp.asBool(m, 'y')).toBe(true);
    expect(tp.asBool(m, 'n')).toBe(false);
    expect(tp.asBool(m, 'absent')).toBeNull();
  });
});

test.describe('inspect', () => {
  test('returns the account id and the settings, with the config path', async () => {
    const dir = appdata('plain', sample());
    const report = await tp.inspect({ env: { APPDATA: dir }, isRunning: notRunning });
    expect(report).toEqual({
      configFound: true,
      configPath: path.join(dir, 'TradingPaints Downloader', 'config.xml'),
      running: false,
      userId: FAKE_ID,
      downloadMySchemes: false,
      deleteBeforeDownloading: true,
      deleteAfterSession: false,
      keepSynced: null,
      warnings: [],   // delete-before only bites while the downloader is running
    });
  });

  test('a non-numeric user id is rejected', async () => {
    const dir = appdata('badid', sample({ userId: 'abc' }));
    expect((await tp.inspect({ env: { APPDATA: dir }, isRunning: notRunning })).userId).toBeNull();
  });

  test('warnings, worst first, for each setting that can undo an apply', async () => {
    const dir = appdata('risky', sample({ downloadMine: 'True', keepSynced: 'True', deleteBefore: 'True', deleteAfter: 'True' }));
    const report = await tp.inspect({ env: { APPDATA: dir }, isRunning: running });
    expect(report.running).toBe(true);
    expect(report.warnings).toHaveLength(4);
    expect(report.warnings[0]).toContain('"Download my schemes" switched on');
    expect(report.warnings[1]).toContain('keep your paints synced');
    expect(report.warnings[2]).toContain('deletes paints before downloading, and the downloader is running');
    expect(report.warnings[3]).toContain('deletes downloaded paints when a session ends');
    expect(tp.isRisky(report)).toBe(true);
  });

  test('running with safe settings is still worth a word', async () => {
    const dir = appdata('safe-running', sample({ deleteBefore: 'False' }));
    const report = await tp.inspect({ env: { APPDATA: dir }, isRunning: running });
    expect(report.warnings).toEqual(['The Trading Paints downloader is running. Its settings look safe, but it has the paint folder open.']);
  });

  test('no config file: nothing found, but the path it looked at is reported', async () => {
    const dir = appdata('none', null);
    const report = await tp.inspect({ env: { APPDATA: dir }, isRunning: notRunning });
    expect(report.configFound).toBe(false);
    expect(report.configPath).toBe(path.join(dir, 'TradingPaints Downloader', 'config.xml'));
    expect(report.userId).toBeNull();
    expect(report.downloadMySchemes).toBeNull();
    expect(report.warnings).toEqual([]);
    expect(tp.isRisky(report)).toBe(false);
  });

  test('no APPDATA: no path either', async () => {
    const report = await tp.inspect({ env: {}, isRunning: notRunning });
    expect(report.configPath).toBeNull();
    expect(report.configFound).toBe(false);
  });

  test('the account id is never logged', async () => {
    const dir = appdata('quiet', sample());
    const captured = [];
    const originals = {};
    for (const m of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
      originals[m] = console[m];
      console[m] = (...args) => captured.push(args.map(String).join(' '));
    }
    const outWrite = process.stdout.write;
    const errWrite = process.stderr.write;
    process.stdout.write = (chunk, ...rest) => { captured.push(String(chunk)); return outWrite.call(process.stdout, chunk, ...rest); };
    process.stderr.write = (chunk, ...rest) => { captured.push(String(chunk)); return errWrite.call(process.stderr, chunk, ...rest); };
    try {
      const report = await tp.inspect({ env: { APPDATA: dir }, isRunning: running });
      expect(report.userId).toBe(FAKE_ID);
    } finally {
      for (const [m, fn] of Object.entries(originals)) console[m] = fn;
      process.stdout.write = outWrite;
      process.stderr.write = errWrite;
    }
    expect(captured.join('\n')).not.toContain(FAKE_ID);

    // And the module has no logging in it at all, so it cannot start.
    const source = fs.readFileSync(new URL('../../modules/js/paints/tradingpaints.js', import.meta.url), 'utf8');
    expect(source).not.toMatch(/console\./);
    expect(source).not.toMatch(/process\.std(out|err)/);
  });
});
