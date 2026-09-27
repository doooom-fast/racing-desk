/**
 * Is the sim running: tasklist CSV parsing, the sim/UI split, and what an absent tasklist means — all with a
 * canned process list, plus one read-only call to the real tasklist (hidden, headless) to prove the parser
 * copes with the real output. Port of the tests in apps/paints/src-tauri/src/process.rs.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const proc = require('../../modules/js/paints/process.js');
const { run } = require('../../modules/js/paints/exec.js');

const CSV = '"System Idle Process","0","Services","0","8 K"\r\n'
  + '"iRacingUI.exe","1234","Console","1","123,456 K"\r\n'
  + '"TradingPaintsDownloader.exe","5678","Console","1","45,000 K"\r\n'
  + 'not a csv row\r\n'
  + '"iRacingSim64DX11.exe","9012","Console","1","2,345,678 K"\r\n';

const fakeExec = (stdout) => async () => ({ status: 0, stdout, stderr: '', error: null });

test('parses tasklist CSV into lower-cased image names', () => {
  const names = proc.parseTasklist(CSV);
  expect([...names]).toEqual(['system idle process', 'iracingui.exe', 'tradingpaintsdownloader.exe', 'iracingsim64dx11.exe']);
});

test('simState: sim on track, UI open, both reported', async () => {
  const deps = { exec: fakeExec(CSV), platform: 'win32' };
  expect(await proc.simState(deps)).toEqual({ simRunning: true, uiRunning: true, matched: ['iRacingSim64DX11.exe', 'iRacingUI.exe'] });
  expect(await proc.isRunning('tradingpaintsdownloader.EXE', deps)).toBe(true);
  expect(await proc.isRunning('doooom-no-such-process-42.exe', deps)).toBe(false);
});

test('simState: only the launcher open', async () => {
  const deps = { exec: fakeExec('"iRacingUI.exe","1","Console","1","1 K"\r\n'), platform: 'win32' };
  expect(await proc.simState(deps)).toEqual({ simRunning: false, uiRunning: true, matched: ['iRacingUI.exe'] });
});

test('simState: a quiet machine', async () => {
  const deps = { exec: fakeExec('"explorer.exe","1","Console","1","1 K"\r\n'), platform: 'win32' };
  expect(await proc.simState(deps)).toEqual({ simRunning: false, uiRunning: false, matched: [] });
});

test('no tasklist, or not Windows: nothing is running, nothing throws', async () => {
  const calls = [];
  const failing = async (...a) => { calls.push(a); return { status: null, stdout: '', stderr: '', error: new Error('ENOENT') }; };
  expect(await proc.simState({ exec: failing, platform: 'win32' })).toEqual({ simRunning: false, uiRunning: false, matched: [] });
  expect(calls).toEqual([['tasklist', ['/FO', 'CSV', '/NH']]]);
  expect((await proc.runningImageNames({ exec: fakeExec(CSV), platform: 'linux' })).size).toBe(0);
});

test('exec.run reports a command that does not exist without throwing', async () => {
  const res = await run('racing-desk-no-such-command-42', ['--version']);
  expect(res.error).toBeTruthy();
  expect(res.status).toBeNull();
});

test('the real tasklist parses into something', async () => {
  test.skip(process.platform !== 'win32', 'tasklist is a Windows tool');
  // On Windows there is always at least one process; an empty set means the CSV parsing broke, which would
  // silently disable every guard in the app.
  const names = await proc.runningImageNames();
  expect(names.size).toBeGreaterThan(0);
  expect(await proc.isRunning('doooom-no-such-process-42.exe')).toBe(false);
});
