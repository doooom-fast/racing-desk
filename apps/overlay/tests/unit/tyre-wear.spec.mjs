/**
 * Tyre wear on the HUD: the wire's number as it is. Tyre wear has one meaning everywhere — tread remaining, per
 * corner, 0..100 %, 100 = new, null where the sim has not measured it (root CLAUDE.md, Tyre wear) — and the page
 * converts nothing: the pit box's rings show the number, amber under 35 and red under 20, and the strategist's
 * offer of a change comes from the engine's TireHealthState, not from the page. iRacing measures tread in the pits
 * and nowhere else, so the page says what the number is, in one dim line under the rings, on the rig and in the
 * glance layout. The real dashboard.html from the file, headless, over a stand-in for the plugin on
 * localhost:8889 (routed, nothing listens); every other address is shut.
 *
 * A flip anywhere — the host or the plugin sending a fraction, or wear instead of tread, or the page inverting —
 * fails here: a new tyre is 100% and green with nothing offered, a worn one is low and red.
 */

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
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
  return [getComputedStyle(el).display !== 'none', el.textContent];
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

    // At the thresholds: 35 is not under 35, 20 is not under 20 — and a tyre under one never prints as the number (34.9 is
    // amber and says 34, 19.9 is red and says 19).
    await serve(page, RACE({ [FL]: 35, [FR]: 34.9, [RL]: 20, [RR]: 19.9 }));
    expect((await rings(page)).map((x) => x.slice(0, 2))).toEqual([['35%', 'ok'], ['34%', 'warn'], ['20%', 'warn'], ['19%', 'crit']]);
  });

  test('a printed number never rounds across a threshold, and his fresh tyres read 100', async ({ page }) => {
    await open(page, RACE({ [FL]: 34.6, [FR]: 19.7, [RL]: 99.98, [RR]: 20.4 }));
    expect((await rings(page)).map((x) => x.slice(0, 2))).toEqual([['34%', 'warn'], ['19%', 'crit'], ['100%', 'ok'], ['20%', 'warn']]);
    // The same table as the engine's TyreWear.DisplayPercent (TyreWearTests.ThePrintedPercentNeverRoundsAcrossAThreshold)
    const shown = await page.evaluate(() => [100, 99.98, 64.4, 35, 34.6, 34.5, 20, 19.7, 15.4, 0, 250].map(tyreWearShown));
    expect(shown).toEqual([100, 100, 64, 35, 34, 34, 20, 19, 15, 0, 100]);
  });

  test('the page\'s two thresholds are the engine\'s', async ({ page }) => {
    // One pair everywhere: Engine/TyreWear.cs is the source, config.js (which every panel reads) must say the same two numbers
    const cs = fs.readFileSync(path.join(OVERLAY, '..', 'core', 'RacingDesk.Core', 'Engine', 'TyreWear.cs'), 'utf8');
    const warn = parseFloat(/WarnBelowPercent\s*=\s*([\d.]+)/.exec(cs)[1]);
    const crit = parseFloat(/CriticalBelowPercent\s*=\s*([\d.]+)/.exec(cs)[1]);
    await open(page, RACE({ [FL]: 100, [FR]: 100, [RL]: 100, [RR]: 100 }));
    expect(await page.evaluate(() => [TYRE_WEAR_WARN_BELOW, TYRE_WEAR_CRIT_BELOW])).toEqual([warn, crit]);
    // and no panel keeps a number of its own: the rings, the quad and the old cells read them
    for (const file of ['pitbox.js', 'commentary-viz.js', 'webgl-helpers.js']) {
      const src = fs.readFileSync(path.join(OVERLAY, 'modules', 'js', file), 'utf8');
      expect(src, file).toMatch(/TYRE_WEAR_(WARN|CRIT)_BELOW/);
    }
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

  test('a corner the engine has taken off the wire (a new set: null) is a dash while the others keep their numbers', async ({ page }) => {
    await open(page, RACE({ [FL]: null, [FR]: 16, [RL]: null, [RR]: 62 }, { [HEALTH]: 2, [LAPS]: 0 }));
    expect((await rings(page)).map((x) => x.slice(0, 2))).toEqual([['—', 'ok'], ['16%', 'crit'], ['—', 'ok'], ['62%', 'ok']]);
    await serve(page, RACE({ [FL]: null, [FR]: null, [RL]: null, [RR]: null }, { [HEALTH]: 0, [LAPS]: 99 }));
    expect((await rings(page)).map((x) => x[0])).toEqual(['—', '—', '—', '—']);
    expect(await strategist(page)).toEqual([false, expect.any(String)]);
  });

  test('the commentary\'s quad says a dash where nothing is measured, and never four red 0%', async ({ page }) => {
    await open(page, RACE({ [FL]: 100, [FR]: 100, [RL]: 100, [RR]: 100 }));
    await page.evaluate(() => {
      // The quad has a size to draw into only while a card is up (the page lays it out at nothing now): give it one
      document.getElementById('commentaryViz').getBoundingClientRect = () => ({ width: 160, height: 100, left: 0, top: 0, right: 160, bottom: 100 });
      window.__quad = [];
      const fill = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (t, ...rest) { window.__quad.push(String(t)); return fill.call(this, t, ...rest); };
    });
    const texts = (data) => page.evaluate((d) => {
      window.__quad.length = 0;
      window.updateCommentaryVizData(d);
      window.showCommentaryViz('tyre_wear_high', 200);
      const out = window.__quad.slice();
      window.hideCommentaryViz();
      return out;
    }, data);
    // The quad renders before the first telemetry has supplied its tread (or with a value that is not a list)
    const none = await texts({});
    expect(none.filter((t) => /%$|—/.test(t))).toEqual(['—', '—', '—', '—']);
    expect(none.join(' ')).not.toContain('0%');
    const notAList = await texts({ tyreWears: 'x' });
    expect(notAList.filter((t) => /%$|—/.test(t))).toEqual(['—', '—', '—', '—']);
    // And with the engine's numbers, the whole percent that is printed beside the colour
    const some = await texts({ tyreWears: [34.6, null, 19.7, 100] });
    expect(some.filter((t) => /%$|—/.test(t))).toEqual(['34%', '—', '19%', '100%']);
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
    // Amber, and nothing offered: the live offer comes at 20 (TireHealthState 2), and the demo is no different
    await serve(page, demo([40, 30, 60, 25]));
    expect((await rings(page)).map((x) => x.slice(0, 2))).toEqual([['40%', 'ok'], ['30%', 'warn'], ['60%', 'ok'], ['25%', 'warn']]);
    expect(await strategist(page)).toEqual([false, expect.any(String)]);
    await serve(page, demo([40, 30, 60, 18]));
    expect((await rings(page)).map((x) => x.slice(0, 2))).toEqual([['40%', 'ok'], ['30%', 'warn'], ['60%', 'ok'], ['18%', 'crit']]);
    expect(await strategist(page)).toEqual([true, 'Accept tire change · ~4 laps left']);   // the worst, 18, a fifth of a lap a point
  });
});

test.describe('what the number is', () => {
  test('under the rings the page says the tread is measured in the pits, for iRacing and not in the demo', async ({ page }) => {
    await open(page, RACE({ [FL]: 100, [FR]: 100, [RL]: 100, [RR]: 100 }));
    expect(await note(page)).toEqual([true, 'Tread measured in the pits']);
    await serve(page, RACE({}, { 'RacingDesk.Plugin.DemoMode': 1, 'RacingDesk.Plugin.Demo.TyreWearFL': 82, 'RacingDesk.Plugin.Demo.CarModel': 'BMW M4 GT3' }));
    expect(await note(page)).toEqual([false, '']);
    await serve(page, RACE({ [FL]: 100, [FR]: 100, [RL]: 100, [RR]: 100 }));
    expect(await note(page)).toEqual([true, 'Tread measured in the pits']);
  });

  test('on the smallest pit box (810x1080, the 10.2" iPad upright) the note gives way to a tyre call there is no room beside, and is back without the call', async ({ page }) => {
    const set = (wear, extra = {}) => RACE({ [FL]: wear, [FR]: 100, [RL]: 100, [RR]: 100 }, { 'RacingDesk.Plugin.Strategy.StintLaps': 14, ...extra });
    await open(page, set(100));
    await page.setViewportSize({ width: 810, height: 1080 });
    await page.evaluate(() => setDriveMode(true));
    await drawn(page);
    expect(await note(page)).toEqual([true, 'Tread measured in the pits']);
    await serve(page, set(15, { [HEALTH]: 2, [LAPS]: 12 }));
    expect(await strategist(page)).toEqual([true, expect.stringContaining('Change')]);
    expect((await note(page))[0], 'with the call up there is no room for the line').toBe(false);
    // and the rings are whole: no cell is cut off by the pit box
    expect(await page.evaluate(() => [...document.querySelectorAll('.pb-circle-cell')].map((c) => c.scrollHeight - c.clientHeight <= 5))).toEqual([true, true, true, true]);
    await serve(page, set(100, { [HEALTH]: 0, [LAPS]: 99 }));
    expect(await note(page)).toEqual([true, 'Tread measured in the pits']);
  });

  for (const [width, height, what] of [[1180, 820, 'an iPad Air on its side'], [820, 1180, 'an iPad Air upright'], [744, 1133, 'an iPad mini upright']]) {
    test(`in the glance layout at ${width}x${height} (${what}) the line stays: one line at the label's floor under the rings, whole, and the heading keeps the laps`, async ({ page }) => {
      await open(page, RACE({ [FL]: 100, [FR]: 100, [RL]: 100, [RR]: 100 }, { 'RacingDesk.Plugin.Strategy.StintLaps': 14 }));
      await page.setViewportSize({ width, height });
      await page.evaluate(() => setDriveMode(true));
      await drawn(page);
      const look = () => page.evaluate(() => {
        const el = document.getElementById('pbWearNote');
        const cs = getComputedStyle(el);
        const rings = document.querySelector('.pb-tire-circles').getBoundingClientRect();
        const r = el.getBoundingClientRect();
        return {
          heading: getComputedStyle(document.getElementById('pbPageTyres'), '::before').content,
          text: el.textContent, shown: cs.display !== 'none', nowrap: cs.whiteSpace, size: parseFloat(cs.fontSize),
          oneLine: r.height < parseFloat(cs.fontSize) * 1.6, underTheRings: r.top >= rings.bottom - 1,
          whole: el.scrollWidth <= el.clientWidth + 1,
        };
      });
      expect(await look()).toEqual({
        heading: '"Tyres · 14 laps"', text: 'Tread measured in the pits', shown: true, nowrap: 'nowrap', size: expect.any(Number),
        oneLine: true, underTheRings: true, whole: true,
      });
      expect((await look()).size).toBeGreaterThanOrEqual(11);
    });
  }
});
