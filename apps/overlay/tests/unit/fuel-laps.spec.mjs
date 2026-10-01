/**
 * The laps of fuel, wherever the page shows them — the laps panel's fuel line in the glance layout ("9.1 laps · 8 to
 * go"), the pit box's "Laps left" and the strategist's fuel call — are a number of laps or a dash, never 99. He asked
 * on 2026-10-01: "The fuel in the sector area on iPad shows 99 laps always". The engine said 99 under
 * DS.FuelLapsRemaining for as long as it did not know what a lap costs (the host's own fuel per lap wants one green lap
 * off pit road; SimHub's a lap or two), and the laps panel read it as it was. The wire now says 0 there, and the page
 * refuses a 99 as well, since a SimHub plugin built before this still sends one.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { frame, fieldWith } from '../frames.mjs';

const require = createRequire(import.meta.url);
const remote = require('../../remote-server.js');

const OVERLAY = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DASHBOARD = pathToFileURL(path.join(OVERLAY, 'dashboard.html')).href;

const RACE = (over = {}) => frame({ order: fieldWith(4), state: 4, mode: 4, start: 7, lap: 12, ...over });
// The frame's fuel per lap is known (3.12 L, 28.4 L in the tank: 9.1 laps, which the page can work out for itself); a
// session whose fuel per lap is not known yet says 0 for it.
const NO_PER_LAP = { 'DataCorePlugin.Computed.Fuel_LitersPerLap': 0 };
// The strategist calling for fuel, with and without a number of laps to say.
const CALLING = (laps) => ({ 'RacingDesk.Plugin.Strategy.FuelHealthState': 2, 'RacingDesk.Plugin.Strategy.FuelLapsRemaining': laps });

let telemetry, port, payload;
test.beforeAll(async () => {
  telemetry = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
  await new Promise((resolve) => telemetry.listen(0, '127.0.0.1', resolve));
  port = await new Promise((resolve) => {
    const probe = http.createServer();
    probe.listen(0, '127.0.0.1', () => { const { port: p } = probe.address(); probe.close(() => resolve(p)); });
  });
  await remote.start({ port, host: '127.0.0.1', appDir: OVERLAY, key: 'abcd2345', log: () => {}, telemetryUrl: `http://127.0.0.1:${telemetry.address().port}/racing-desk/` });
});
test.afterAll(async () => {
  await remote.stop();
  await new Promise((resolve) => { telemetry.close(resolve); telemetry.closeAllConnections(); });
});

async function frames(page, n = 4) {
  await page.waitForFunction(() => typeof _isIdle !== 'undefined' && _isIdle === false && _pollFrame > 5, null, { timeout: 15000 });
  const before = await page.evaluate(() => _pollFrame);
  await page.waitForFunction((at) => _pollFrame >= at, before + n, { timeout: 15000 });
}

const read = (page) => page.evaluate(() => ({
  laps: document.getElementById('lapsFuel').textContent,
  lapsClass: document.getElementById('lapsFuel').className,
  pit: document.getElementById('pbFuelLaps').textContent,
  call: document.getElementById('pbFuelStratSuggest').classList.contains('hidden') ? null : document.getElementById('pbFuelStratLabel').textContent,
}));

test('the iPad: a 99 from the engine is not laps of fuel, nor is 0 — a dash until a lap has said what a lap costs, the real number after', async ({ page }) => {
  test.setTimeout(60000);
  payload = RACE({ fuelLaps: 99, extra: NO_PER_LAP });
  await page.addInitScript(() => { try { localStorage.setItem('rd-effects', 'off'); } catch (e) { /* none */ } });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.goto(`http://127.0.0.1:${port}/`);
  await frames(page);
  // An older plugin's 99, with no fuel per lap to work it out from: not shown.
  expect(await read(page)).toMatchObject({ laps: '—', lapsClass: 'laps-v dim', pit: '—', call: null });
  // The wire's 0, since 2026-10-01: not known yet.
  payload = RACE({ fuelLaps: 0, extra: NO_PER_LAP });
  await frames(page);
  expect(await read(page)).toMatchObject({ laps: '—', lapsClass: 'laps-v dim', pit: '—' });
  // Known: the laps of fuel against the laps to go, in the pit box as well.
  payload = RACE({ fuelLaps: 9.1 });
  await frames(page);
  expect(await read(page)).toMatchObject({ laps: '9.1 laps · 8 to go', lapsClass: 'laps-v green', pit: '9.1' });
  payload = RACE({ fuelLaps: 6.4 });
  await frames(page);
  expect(await read(page)).toMatchObject({ laps: '6.4 laps · 8 to go', lapsClass: 'laps-v red', pit: '6.4' });
  // The strategist's call says its laps only when it has them: 0 (not yet) and 99 (an older engine) are not a number.
  payload = RACE({ fuelLaps: 6.4, extra: CALLING(6) });
  await frames(page);
  expect((await read(page)).call).toBe('Stop · ~6 laps');
  payload = RACE({ fuelLaps: 6.4, extra: CALLING(0) });
  await frames(page);
  expect((await read(page)).call).toBe('Stop');
  payload = RACE({ fuelLaps: 6.4, extra: CALLING(99) });
  await frames(page);
  expect((await read(page)).call).toBe('Stop');
  // Back on a page whose wire says nothing of the laps but does say the fuel per lap: the page's own estimate.
  payload = RACE({ fuelLaps: 0, extra: { 'DataCorePlugin.Computed.Fuel_LitersPerLap': 2.0, 'DataCorePlugin.GameData.Fuel': 15.0 } });
  await frames(page);
  expect((await read(page)).laps).toBe('7.5 laps · 8 to go');
});

test("the rig's pit box reads the same rule: 99 and 0 are a dash, a number is the number", async ({ page }) => {
  test.setTimeout(60000);
  payload = RACE({ fuelLaps: 99, extra: NO_PER_LAP });
  await page.route(/^https?:\/\/(?!localhost:8889)/, (route) => route.abort());
  await page.route('http://localhost:8889/racing-desk/', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) }));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(DASHBOARD);
  await page.evaluate(() => { _settings.showWebGL = false; _settings.showPitBox = true; applySettings(); });
  await frames(page);
  const pit = () => page.evaluate(() => document.getElementById('pbFuelLaps').textContent);
  expect(await pit()).toBe('—');
  payload = RACE({ fuelLaps: 0, extra: NO_PER_LAP });
  await frames(page);
  expect(await pit()).toBe('—');
  payload = RACE({ fuelLaps: 9.1 });
  await frames(page);
  expect(await pit()).toBe('9.1');
});
