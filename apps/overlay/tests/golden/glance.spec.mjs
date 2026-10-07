// Golden frames of the glance layout: what an iPad is shown, the real dashboard.html served by remote-server.js's own
// request handler (on 127.0.0.1, an OS-chosen port; nothing on the network) over the replay harness, pinned to a
// frame. Headless, no window on screen. The HUD's typefaces are Adobe's and the network is shut, so the page is in the
// stand-in faces it wears until the kit arrives (deterministic on this machine).
//
//   npm run test:golden -w racing-desk-overlay                     compare
//   npm run test:golden -w racing-desk-overlay -- --update-snapshots   accept new baselines
//
// The frames are made up (tests/frames.mjs): a synthetic circuit and a field of NATO-alphabet surnames.

import { test, expect } from '@playwright/test';
import http from 'node:http';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRecordingWriter, readRecording, startReplayServer } from '@racing-desk/replay';
import { frame, fieldWith } from '../frames.mjs';

const require = createRequire(import.meta.url);
const remote = require('../../remote-server.js');
const here = dirname(fileURLToPath(import.meta.url));
const OVERLAY = join(here, '..', '..');
const FIXED_TIME = new Date('2026-09-16T19:30:00Z');

let replay, ipad, dir;

async function record(name, payloads) {
  const file = join(dir, `${name}.replay.jsonl.gz`);
  const writer = createRecordingWriter(file, { source: 'golden fixture (glance layout)' });
  payloads.forEach((payload, i) => writer.write(i * 1000, payload));
  await writer.close();
  return readRecording(file);
}

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'racing-desk-glance-'));
  // Frame 0 is a race, frame 1 a practice: the replay server serves the one it is paused on.
  const race = frame({ order: fieldWith(4), state: 4, mode: 4, start: 7, lap: 12 });
  const practice = frame({ order: fieldWith(4), session: 'Practice', state: 4, mode: 1, start: 4, lap: 6 });
  replay = await startReplayServer({ recording: await record('glance', [race, practice]), port: 0, paused: true });
  const config = {
    appDir: OVERLAY, telemetryBase: `http://127.0.0.1:${replay.port}`, key: remote.newKey(),
    dispatchAction: null, addresses: () => [], names: () => [],
  };
  ipad = http.createServer((req, res) => remote.handleRequest(config, req, res));
  await new Promise((resolve) => ipad.listen(0, '127.0.0.1', resolve));
});

test.afterAll(async () => {
  await replay?.close();
  await new Promise((resolve) => { if (!ipad) return resolve(); ipad.close(resolve); ipad.closeAllConnections(); });
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function openGlance(page, width, height, at = 0) {
  await page.clock.setFixedTime(FIXED_TIME);
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
  await page.setViewportSize({ width, height });
  await fetch(`http://127.0.0.1:${replay.port}/__replay/control?frame=${at}&pause=1`);
  await page.goto(`http://127.0.0.1:${ipad.address().port}/`, { waitUntil: 'load' });
  await expect.poll(async () => (await (await fetch(`http://127.0.0.1:${replay.port}/__replay/state`)).json()).requests, { timeout: 10000 }).toBeGreaterThan(5);
  await page.waitForFunction(() => document.querySelectorAll('#lbRows .lb-row').length >= 3 && document.getElementById('fullMapSvg').style.getPropertyValue('--px') !== '');
  // A car that has not touched its clutch in the first sixty frames has its clutch's label and trace taken away
  // (poll-engine.js, "Auto-hide clutch"): the frame is taken after that, or the picture is one or the other of them,
  // by how many frames the page had had in a second and a half (it was, one run in three, with the clutch).
  await page.waitForFunction(() => typeof _pollFrame !== 'undefined' && _pollFrame > 75, null, { timeout: 15000 });
  await page.waitForTimeout(1500);
  // The spotter's card comes up when the race frame's first gap is read and goes after its few seconds (spotter.js). The
  // picture is of the layout, not of the card: how soon the page gets its frames (it runs no WebGL effect here, so it
  // gets them fast) must not decide whether a card that is on its way out is in it, so it is not drawn.
  await page.addStyleTag({ content: '#spotterStack { visibility: hidden !important; }' });
  await page.waitForTimeout(300);
}

test('glance layout — a race, iPad on its side (1180x820)', async ({ page }) => {
  await openGlance(page, 1180, 820);
  await expect(page).toHaveScreenshot('glance-race-1180x820.png', { animations: 'disabled', caret: 'hide', maxDiffPixels: 100 });
});

test('glance layout — a race, iPad upright (820x1180)', async ({ page }) => {
  await openGlance(page, 820, 1180);
  await expect(page).toHaveScreenshot('glance-race-820x1180.png', { animations: 'disabled', caret: 'hide', maxDiffPixels: 100 });
});
