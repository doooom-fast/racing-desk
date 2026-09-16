// Golden frames: the real dashboard.html, fed by the replay harness pinned to a frame, compared
// against committed screenshots. Runs headless — no sim, no SimHub, no network, no window on screen.
//
//   npm run test:golden -w racecor-overlay                     compare
//   npm run test:golden -w racecor-overlay -- --update-snapshots   accept new baselines
//
// Fixture: base-payload.json is a full 328-key payload captured from the live plugin (driver name
// neutralised), with the unit tests' MOCK_TELEMETRY layered on top to put the car on track. Swap in
// a real recording (npm run record) as soon as one exists.

import { test, expect } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRecordingWriter, readRecording, startReplayServer, CONTRACT_PATH } from '@prodrive/replay';
import { MOCK_TELEMETRY } from '../helpers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const DASHBOARD = pathToFileURL(join(here, '..', '..', 'dashboard.html')).href;
const FIXED_TIME = new Date('2026-09-16T19:30:00Z');

let replay, dir;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'prodrive-golden-'));
  const base = JSON.parse(readFileSync(join(here, 'fixtures', 'base-payload.json'), 'utf8'));
  const file = join(dir, 'synthetic-in-car.replay.jsonl.gz');
  const writer = createRecordingWriter(file, { source: 'golden fixture' });
  writer.write(0, { ...base, ...MOCK_TELEMETRY });
  await writer.close();
  replay = await startReplayServer({ recording: readRecording(file), port: 0, paused: true });
});

test.afterAll(async () => {
  await replay?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function openAtFrame(page, frame) {
  await fetch(`http://127.0.0.1:${replay.port}/__replay/control?frame=${frame}&pause=1`);
  await page.clock.setFixedTime(FIXED_TIME);
  // Plugin traffic → replay server; everything else remote is blocked so frames never depend on
  // the network (fonts fall back deterministically).
  await page.route(/^https?:\/\//, async (route) => {
    const url = route.request().url();
    const m = url.match(/^https?:\/\/(?:localhost|127\.0\.0\.1):8889(\/.*)$/);
    if (!m) return route.abort();
    const res = await fetch(`http://127.0.0.1:${replay.port}${m[1]}`);
    await route.fulfill({ status: res.status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: await res.text() });
  });
  await page.goto(DASHBOARD, { waitUntil: 'load' });
  // Wait until the dashboard has consumed replayed frames, then let layout settle.
  await expect.poll(async () => (await (await fetch(`http://127.0.0.1:${replay.port}/__replay/state`)).json()).requests, { timeout: 10000 }).toBeGreaterThan(3);
  await page.waitForTimeout(1500);
}

test('in car — synthetic frame', async ({ page }) => {
  await openAtFrame(page, 0);
  await expect(page).toHaveScreenshot('in-car-synthetic.png', {
    animations: 'disabled',
    caret: 'hide',
    // Pixel-exact across repeated runs on the rig (0 differing pixels in 5/5). The small absolute
    // allowance only absorbs GPU/driver noise; a text-colour change alone moves ~11k pixels.
    maxDiffPixels: 100,
  });
});

test('replayed payload reaches the page unchanged', async ({ page }) => {
  await openAtFrame(page, 0);
  const expected = await (await fetch(`http://127.0.0.1:${replay.port}${CONTRACT_PATH}`)).json();
  const seen = await page.evaluate(async () => (await fetch('http://localhost:8889/racecor-io-pro-drive/')).json());
  expect(seen).toEqual(expected);
});
