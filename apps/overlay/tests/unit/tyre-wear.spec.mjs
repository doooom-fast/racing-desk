/**
 * Tyre wear on the HUD: the wire's number as it is. Tyre wear has one meaning everywhere — tread remaining, per
 * corner, 0..100 %, 100 = new, null where the sim has not measured it (root CLAUDE.md, Tyre wear) — and the page
 * converts nothing: the pit box's rings show the number, amber under 35 and red under 20, and the strategist's
 * offer of a change comes from the engine's TireHealthState, not from the page. iRacing measures tread in the pits
 * and nowhere else, so the page says what the number is: a line under the rings on the rig, the tyres' heading in
 * the glance layout. The real dashboard.html from the file, headless, over a stand-in for the plugin on
 * localhost:8889 (routed, nothing listens); every other address is shut.
 *
 * A flip anywhere — the host or the plugin sending a fraction, or wear instead of tread, or the page inverting —
 * fails here: a new tyre is 100% and green with nothing offered, a worn one is low and red.
 */

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { frame, fieldWith } from '../frames.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const OVERLAY = path.resolve(here, '..', '..');

const FL = 'DataCorePlugin.GameData.TyreWearFrontLeft';
const FR = 'DataCorePlugin.GameData.TyreWearFrontRight';
const RL = 'DataCorePlugin.GameData.TyreWearRearLeft';
const RR = 'DataCorePlugin.GameData.TyreWearRearRight';
const HEALTH = 'RacingDesk.Plugin.Strategy.TireHealthState';
const LAPS = 'RacingDesk.Plugin.Strategy.TireLapsRemaining';

let payload;

// A race under way, with the four corners as given (undefined leaves the key out; null is the plugin's "not measured").
const RACE = (wear = {}, extra = {}) => {
  const p = frame({ order: fieldWith(4), state: 4, mode: 4, start: 7, lap: 12, extra });
  for (const [k, v] of Object.entries(wear)) { if (v === undefined) delete p[k]; else p[k] = v; }
  return p;
};

async function open(page, first) {
  payload = first;
  await page.route(/^https?:\/\/(?!localhost:8889)/, (route) => route.abort());
  await page.route('http://localhost:8889/racing-desk/', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) }));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(pathToFileURL(path.join(OVERLAY, 'dashboard.html')).href);
  await page.evaluate(() => { _settings.showWebGL = false; });
  await page.waitForFunction(() => typeof _isIdle !== 'undefined' && _isIdle === false && _pollFrame > 6, null, { timeout: 10000 });
  await drawn(page);
}

async function drawn(page) {
  const before = await page.evaluate(() => _pollFrame);
  await page.waitForFunction((n) => _pollFrame >= n + 6, before, { timeout: 8000 });
}

async function serve(page, next) {
  payload = next;
  await drawn(page);
}

// The four rings: the number shown and the ring's state (green, warn, crit, or empty with a dash).
const rings = (page) => page.evaluate(() => ['LF', 'RF', 'LR', 'RR'].map((c) => {
  const ring = document.getElementById('pbRing' + c);
  const cls = ring.className.baseVal.replace('pb-ring-fill', '').trim();
  return [document.getElementById('pbWear' + c + 'Val').textContent, cls || 'ok', ring.style.strokeDashoffset];
}));

const strategist = (page) => page.evaluate(() => {
  const el = document.getElementById('pbStratSuggest');
  return [!el.classList.contains('hidden'), document.getElementById('pbStratLabel').textContent.trim()];
});

const note = (page) => page.evaluate(() => {
  const el = document.getElementById('pbWearNote');
  return [getComputedStyle(el).display !== 'none', el.textContent, document.getElementById('pbPageTyres').dataset.measured ?? null];
});

test.describe('the wire\'s tread, as it is', () => {
  test('new tyres are 100%, green, with nothing offered; worn ones are low, amber under 35 and red under 20', async ({ page }) => {
    await open(page, RACE({ [FL]: 100, [FR]: 100, [RL]: 100, [RR]: 100 }));
    expect(await rings(page)).toEqual([['100%', 'ok', '0'], ['100%', 'ok', '0'], ['100%', 'ok', '0'], ['100%', 'ok', '0']]);
    expect(await strategist(page)).toEqual([false, expect.any(String)]);

    // Each corner from its own key, the number as sent: 64.4 is 64, not 100 (a clamp to 1) and not 36 (an inversion).
    await serve(page, RACE({ [FL]: 100, [FR]: 30, [RL]: 15, [RR]: 64.4 }));
    const r = await rings(page);
    expect(r.map((x) => x.slice(0, 2))).toEqual([['100%', 'ok'], ['30%', 'warn'], ['15%', 'crit'], ['64%', 'ok']]);
    // The ring is as full as the tread: a 15 % tyre's arc is 85 % of the way to empty.
    const C = 2 * Math.PI * 28;
    expect(parseFloat(r[2][2])).toBeCloseTo(C * 0.85, 2);
    expect(parseFloat(r[0][2])).toBeCloseTo(0, 6);

    // At the thresholds: 35 is not under 35, 20 is not under 20.
    await serve(page, RACE({ [FL]: 35, [FR]: 34.9, [RL]: 20, [RR]: 19.9 }));
    expect((await rings(page)).map((x) => x.slice(0, 2))).toEqual([['35%', 'ok'], ['35%', 'warn'], ['20%', 'warn'], ['20%', 'crit']]);
  });

  test('not measured is a dash and an empty ring: null, 0, or no key at all', async ({ page }) => {
    await open(page, RACE({ [FL]: null, [FR]: 0, [RL]: undefined, [RR]: '' }));
    const r = await rings(page);
    expect(r.map((x) => x[0])).toEqual(['—', '—', '—', '—']);
    expect(r.map((x) => x[1])).toEqual(['ok', 'ok', 'ok', 'ok']);
    const C = 2 * Math.PI * 28;
    for (const x of r) expect(parseFloat(x[2])).toBeCloseTo(C, 2);
    expect(await strategist(page)).toEqual([false, expect.any(String)]);
  });

  test('a fraction is not converted: the page shows what it is sent, so a 0..1 value upstream is seen as a bald tyre here', async ({ page }) => {
    await open(page, RACE({ [FL]: 0.91, [FR]: 0.88, [RL]: 0.94, [RR]: 0.93 }));
    expect((await rings(page)).map((x) => x.slice(0, 2))).toEqual([['1%', 'crit'], ['1%', 'crit'], ['1%', 'crit'], ['1%', 'crit']]);
  });

  test('the strategist\'s offer is the engine\'s TireHealthState, and its laps are shown only where there is a number', async ({ page }) => {
    // New tyres on the wire, but a stale engine would not say 2: the page does not decide this itself.
    await open(page, RACE({ [FL]: 100, [FR]: 100, [RL]: 100, [RR]: 100 }, { [HEALTH]: 0, [LAPS]: 99 }));
    expect(await strategist(page)).toEqual([false, expect.any(String)]);
    await serve(page, RACE({ [FL]: 100, [FR]: 100, [RL]: 15, [RR]: 100 }, { [HEALTH]: 2, [LAPS]: 0 }));
    expect(await strategist(page)).toEqual([true, 'Accept tire change']);
    await serve(page, RACE({ [FL]: 100, [FR]: 100, [RL]: 15, [RR]: 100 }, { [HEALTH]: 2, [LAPS]: 99 }));
    expect(await strategist(page)).toEqual([true, 'Accept tire change']);
    await serve(page, RACE({ [FL]: 100, [FR]: 100, [RL]: 30, [RR]: 100 }, { [HEALTH]: 1, [LAPS]: 12 }));
    expect(await strategist(page)).toEqual([false, expect.any(String)]);
    await serve(page, RACE({ [FL]: 100, [FR]: 100, [RL]: 15, [RR]: 100 }, { [HEALTH]: 2, [LAPS]: 12 }));
    expect(await strategist(page)).toEqual([true, 'Accept tire change · ~12 laps left']);
    await serve(page, RACE({ [FL]: 100, [FR]: 100, [RL]: 100, [RR]: 100 }, { [HEALTH]: 0, [LAPS]: 99 }));
    expect(await strategist(page)).toEqual([false, expect.any(String)]);
  });

  test('the demo\'s keys mean the same thing: percent remaining, read as it is, and the page plays the strategist under 35', async ({ page }) => {
    const demo = (wear, extra = {}) => RACE({}, {
      'RacingDesk.Plugin.DemoMode': 1,
      'RacingDesk.Plugin.Demo.TyreWearFL': wear[0], 'RacingDesk.Plugin.Demo.TyreWearFR': wear[1],
      'RacingDesk.Plugin.Demo.TyreWearRL': wear[2], 'RacingDesk.Plugin.Demo.TyreWearRR': wear[3],
      'RacingDesk.Plugin.Demo.CarModel': 'BMW M4 GT3',
      ...extra,
    });
    await open(page, demo([82, 79, 86, 85]));
    expect((await rings(page)).map((x) => x.slice(0, 2))).toEqual([['82%', 'ok'], ['79%', 'ok'], ['86%', 'ok'], ['85%', 'ok']]);
    expect(await strategist(page)).toEqual([false, expect.any(String)]);
    await serve(page, demo([40, 30, 60, 18]));
    expect((await rings(page)).map((x) => x.slice(0, 2))).toEqual([['40%', 'ok'], ['30%', 'warn'], ['60%', 'ok'], ['18%', 'crit']]);
    expect(await strategist(page)).toEqual([true, 'Accept tire change · ~4 laps left']);   // the worst, 18, a fifth of a lap a point
  });
});

test.describe('what the number is', () => {
  test('on the rig the rings say the tread is as measured in the pits, for iRacing and not in the demo', async ({ page }) => {
    await open(page, RACE({ [FL]: 100, [FR]: 100, [RL]: 100, [RR]: 100 }));
    expect(await note(page)).toEqual([true, 'Tread as measured in the pits', ' · as measured in the pits']);
    await serve(page, RACE({}, { 'RacingDesk.Plugin.DemoMode': 1, 'RacingDesk.Plugin.Demo.TyreWearFL': 82, 'RacingDesk.Plugin.Demo.CarModel': 'BMW M4 GT3' }));
    expect(await note(page)).toEqual([false, '', null]);
    await serve(page, RACE({ [FL]: 100, [FR]: 100, [RL]: 100, [RR]: 100 }));
    expect(await note(page)).toEqual([true, 'Tread as measured in the pits', ' · as measured in the pits']);
  });

  test('in the glance layout the tyres\' heading says it, with the laps on the set, on one line, and the rig\'s line is put away', async ({ page }) => {
    await open(page, RACE({ [FL]: 100, [FR]: 100, [RL]: 100, [RR]: 100 }));
    await page.evaluate(() => setDriveMode(true));
    await drawn(page);
    const heading = () => page.evaluate(() => {
      const el = document.getElementById('pbPageTyres');
      const before = getComputedStyle(el, '::before');
      return [before.content, before.whiteSpace, getComputedStyle(document.getElementById('pbWearNote')).display];
    });
    expect(await heading()).toEqual(['"Tyres · as measured in the pits"', 'nowrap', 'none']);
    await serve(page, RACE({ [FL]: 100, [FR]: 100, [RL]: 100, [RR]: 100 }, { 'RacingDesk.Plugin.Strategy.StintLaps': 14 }));
    expect((await heading())[0]).toBe('"Tyres · 14 laps · as measured in the pits"');
  });
});
