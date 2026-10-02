/**
 * Words, not capitals. He asked on 2026-10-02: "i'm thinking we get rid of any all-caps text that isn't an acronym and
 * also that we use words instead of acronyms where we can, though things like tCLO may be hard" — and gave his words for
 * the common ones: "for ABS: anti-lock, for bb: bias. for tc: traction", "mig: migration. arb: rollbar". And to "should
 * all panel headers use one style?", yes.
 *
 * Held here:
 *   - nothing Racing Desk writes for him to read is in capitals but an acronym of modules/js/words.js: no stylesheet sets
 *     text in capitals, and no page, script, the Cars island, the car list or the commentary writes a word in them
 *     (tests/unit/words-scan.mjs reads them all; it is held to finding what it is for, too);
 *   - the car list has its words where a public source settles what a control does (his for the common ones), and the
 *     car's own short label where none does (the BMW LMDh's TCLON and TCLAT);
 *   - one header style for every panel, on the rig's HUD and in the glance layout;
 *   - the longest labels are whole: on the rig at his 3440x1440 and zoom 120 (by the arithmetic the panel sizes its
 *     labels by, and with RD_REAL_FONT=1 in the page's own font), and at every iPad size in the glance layout, measured.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { frame, fieldWith } from '../frames.mjs';
import {
  capsWords, scanCss, scanHtml, scanScript, scriptFiles, scanCarList, scanCommentary, stringsOf, pageText, OVERLAY, CAR_LIST,
} from './words-scan.mjs';

const require = createRequire(import.meta.url);
const W = require('../../modules/js/words.js');
const { view, arrange, chooseForm, fitsWhole, labelPlan } = require('../../modules/js/car-controls.js');
const remote = require('../../remote-server.js');
const here = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD = pathToFileURL(path.join(OVERLAY, 'dashboard.html')).href;
const LIST = JSON.parse(fs.readFileSync(CAR_LIST, 'utf8'));
const REAL_FONT = process.env.RD_REAL_FONT === '1';
const formText = (form) => (form.mark ? `${form.text} ${form.mark}` : form.text);

// ── The words ──

test.describe('words.js: what may be in capitals, and sentence case', () => {
  test('his words for the common ones are words now, not acronyms', () => {
    for (const was of ['ABS', 'TC', 'BB', 'MIG', 'ARB', 'SR', 'FFB', 'RPM']) expect(W.ACRONYMS, was).not.toContain(was);
    for (const kept of ['DRS', 'P2P', 'OBS', 'HUD', 'DQ', 'GT', 'MDM']) expect(W.ACRONYMS, kept).toContain(kept);
  });

  test('a text in sentence case: capitals lowered but for an acronym, and the first letter up', () => {
    expect(W.sentenceCase('NONE')).toBe('None');
    expect(W.sentenceCase('SAFETY CAR')).toBe('Safety car');
    expect(W.sentenceCase('NOT AVAILABLE')).toBe('Not available');
    expect(W.sentenceCase('SPORT+')).toBe('Sport+');
    expect(W.sentenceCase('MDM')).toBe('MDM');
    expect(W.sentenceCase('DRS open')).toBe('DRS open');
    expect(W.sentenceCase('FUEL CRITICAL — 1.2 laps remaining. Pit immediately!')).toBe('Fuel critical — 1.2 laps remaining. Pit immediately!');
    expect(W.sentenceCase('iRating')).toBe('iRating');
    expect(W.sentenceCase('1 LAP TO GREEN')).toBe('1 lap to green');
    expect(W.sentenceCase('25%')).toBe('25%');
    expect(W.sentenceCase('')).toBe('');
    // A car's label keeps the car's own abbreviations.
    expect(W.labelCase('TC TOGGLE')).toBe('TC toggle');
    expect(W.labelCase('BRAKE BIAS')).toBe('Brake bias');
    expect(W.labelCase('MGU-K DEPLOY MODE')).toBe('MGU-K deploy mode');
    expect(W.labelCase('TCLO')).toBe('TCLO');
    expect(W.labelCase('AR-F')).toBe('AR-F');
    expect(W.labelCase('LAUNCH RPM')).toBe('Launch rpm');
  });
});

// ── No capitals but an acronym ──

test.describe('no text in capitals but an acronym', () => {
  test('the scan finds what it is for', () => {
    expect(capsWords('NONE')).toEqual(['NONE']);
    expect(capsWords('LOCAL YELLOW — slow')).toEqual(['LOCAL', 'YELLOW']);
    expect(capsWords('DRS open, OBS and the HUD, P4, TC1, MX-5')).toEqual([]);
    expect(capsWords('ABS active')).toEqual(['ABS']);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-words-'));
    try {
      const css = path.join(tmp, 'a.css');
      fs.writeFileSync(css, '.x { text-transform: uppercase; }\n.y { content: \'NO DATA\'; }\n.z { font-variant: small-caps; }\n/* text-transform: uppercase in a comment */\n');
      expect(scanCss(css).map((f) => f.line)).toEqual([1, 2, 3]);
      const js = path.join(tmp, 'a.js');
      fs.writeFileSync(js, [
        "el.textContent = 'LOCAL YELLOW';",
        "const s = `Lap ${n} — ${'GREEN FLAG'}`;",
        "console.log('[RacingDesk] HUD ERROR');",
        "const map = { 'ABS Activation': 1 };",
        "fetch(url, { method: 'GET' });",
        "const re = /'NOT A STRING'/;",
        "el.innerHTML = '<b>BEST LAP</b> 1:32.4';",
      ].join('\n'));
      expect(scanScript(js).map((f) => [f.line, f.what.split(': ').pop()])).toEqual([[1, 'LOCAL'], [1, 'YELLOW'], [2, 'GREEN'], [2, 'FLAG'], [7, 'BEST'], [7, 'LAP']]);
      const tsx = path.join(tmp, 'a.tsx');
      fs.writeFileSync(tsx, "export const A = () => <div title=\"CAR LIST\">The library's DEFAULT goes in</div>;\n");
      expect(scanScript(tsx).map((f) => f.what.split(': ').pop())).toEqual(['CAR', 'LIST', 'DEFAULT']);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    expect(pageText('<p>Saved <code>%APPDATA%\\x</code><!-- NOTE --> <span title="TC TOGGLE">ok</span></p>')).toEqual(['TC TOGGLE', 'Saved', 'ok']);
    expect(stringsOf("a('x'); b(`y ${c('z')} w`);", 'a.js').map((s) => s.text)).toEqual(['x', 'y   w', 'z']);
  });

  test('no stylesheet sets text in capitals or in small capitals', () => {
    const files = [
      ...fs.readdirSync(path.join(OVERLAY, 'modules', 'styles')).filter((f) => f.endsWith('.css')).map((f) => path.join(OVERLAY, 'modules', 'styles', f)),
      path.join(OVERLAY, 'modules', 'desk', 'desk.css'),
      ...fs.readdirSync(path.join(OVERLAY, '..', 'paints', 'src')).filter((f) => f.endsWith('.css')).map((f) => path.join(OVERLAY, '..', 'paints', 'src', f)),
    ];
    expect(files.length).toBeGreaterThan(14);
    const found = files.flatMap(scanCss);
    expect(found, found.map((f) => `${f.file}:${f.line} ${f.what}`).join('\n')).toEqual([]);
  });

  test('the HUD\'s page and the desk\'s write no word in capitals but an acronym', () => {
    const found = [path.join(OVERLAY, 'dashboard.html'), path.join(OVERLAY, 'desk.html')].flatMap(scanHtml);
    expect(found, found.map((f) => `${f.file}:${f.line} ${f.what}`).join('\n')).toEqual([]);
  });

  test('nor does any script that puts words on the HUD, the iPad, the pages OBS draws, the desk or the Cars island', () => {
    const files = scriptFiles();
    expect(files.length).toBeGreaterThan(80);
    const found = files.flatMap(scanScript);
    expect(found, found.map((f) => `${f.file}:${f.line} ${f.what}`).join('\n')).toEqual([]);
  });

  test('nor the car list (labels the cars\' own, in sentence case; words; positions)', () => {
    const found = scanCarList();
    expect(found, found.map((f) => f.what).join('\n')).toEqual([]);
  });

  test('nor the commentary card (titles, the event-only line, the remarks and their fragments)', () => {
    const found = scanCommentary();
    expect(found, found.map((f) => `${f.file} ${f.what}`).join('\n')).toEqual([]);
  });
});

// ── The car list in words ──

test.describe('the car list, in words', () => {
  test('is JSON, in the list\'s own layout', () => {
    const raw = fs.readFileSync(CAR_LIST, 'utf8').replace(/\r\n/g, '\n');
    const json = JSON.parse(raw);
    expect(JSON.stringify(json, null, 1) + '\n').toBe(raw);
    expect(json.cars.length).toBeGreaterThan(150);
  });

  test('his words for the common ones, on every car that has them', () => {
    const wrong = [];
    let n = 0;
    for (const car of LIST.cars) {
      for (const c of car.controls) {
        const shown = c.words || c.label;
        const want = { brakeBias: 'Bias', brakeMigration: 'Migration', arbFront: 'Front rollbar', arbRear: 'Rear rollbar' }[c.id]
          || (c.id === 'abs' && c.label === 'ABS' ? 'Anti-lock' : c.id === 'tc' && c.label === 'TC' ? 'Traction' : null);
        if (!want) continue;
        n++;
        if (shown !== want) wrong.push(`${car.path} ${c.id}: ${shown}`);
      }
    }
    // 293 on 2026-10-02: every brake bias (185), migration (9), rollbar (36), and the ABS and TC that are only that (63).
    expect(n).toBeGreaterThan(280);
    expect(wrong).toEqual([]);
  });

  test('words where a public source settles what a control does; the car\'s own label where none does', () => {
    // Every control whose label is only the car's abbreviation has words, but for these: what the BMW LMDh's TCLON and
    // TCLAT do (which is the slip and which the gain) is not settled, and DRS is an acronym that stays one.
    const bare = [];
    for (const car of LIST.cars) {
      for (const c of car.controls) {
        if (c.words) continue;
        const abbreviated = (c.label || '').split(/\s+/).some((t) => /[A-Z]{2,}/.test(t) && t === t.toUpperCase());
        if (abbreviated) bare.push(`${car.path} ${c.id} ${c.label}`);
      }
    }
    expect(bare.filter((b) => !/ drs DRS$/.test(b))).toEqual(['bmwlmdh tc TCLON', 'bmwlmdh tc2 TCLAT']);
    // TCLO is the 963's own word for its traction slip, as its garage says; TCLA its gain.
    const porsche = LIST.cars.find((c) => c.path === 'porsche963gtp');
    expect(porsche.controls.filter((c) => /^tc2?$/.test(c.id)).map((c) => [c.label, c.words])).toEqual([['TCLO', 'Traction slip'], ['TCLA', 'Traction gain']]);
  });
});

// ── One header for every panel ──

// The type of every panel's header, on the page as it is now.
const headers = (page) => page.evaluate(() => {
  const pick = (el, pseudo) => {
    if (!el) return null;
    const cs = getComputedStyle(el, pseudo || null);
    // A rule beneath is one that can be seen (a tab's is there, transparent, for the one that is open to colour).
    const seen = cs.borderBottomStyle !== 'none' && !/^transparent$|rgba\([^)]*,\s*0\)$/.test(cs.borderBottomColor);
    return { size: cs.fontSize, weight: cs.fontWeight, colour: cs.color, tracking: cs.letterSpacing, caps: cs.textTransform, rule: seen ? cs.borderBottomWidth : '0px', family: cs.fontFamily.split(',')[0] };
  };
  const tab = [...document.querySelectorAll('.pb-tab')].find((t) => !t.classList.contains('active'));
  return {
    leaderboard: pick(document.querySelector('.lb-header')),
    datastream: pick(document.querySelector('.ds-header')),
    incidents: pick(document.querySelector('.inc-label')),
    ahead: pick(document.querySelector('#gapsBlock .panel-label')),
    rating: pick(document.querySelector('#ratingPage .panel-label')),
    laps: pick(document.querySelector('#lapsPanel .panel-label')),
    tab: pick(tab),
    tyres: pick(document.getElementById('pbPageTyres'), '::before'),
    clock: pick(document.getElementById('raceTimerKey')),
  };
});

async function openRig(page, payload, { width = 1920, height = 1080, zoom = 100 } = {}) {
  await page.setViewportSize({ width, height });
  await page.route(/^https?:\/\//, (route) => {
    if (REAL_FONT && /(^|\.)typekit\.net$/.test(new URL(route.request().url()).hostname)) return route.continue();
    return route.abort();
  });
  await page.addInitScript((first) => {
    window.__feed = { payload: first };
    const realFetch = window.fetch;
    window.fetch = function (url) {
      if (!/^http:\/\/localhost:8889\/racing-desk\/$/.test(String(url))) return realFetch.apply(this, arguments);
      return Promise.resolve(new Response(JSON.stringify(window.__feed.payload), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    };
  }, payload);
  await page.goto(DASHBOARD, { waitUntil: 'load' });
  await page.evaluate((z) => { _settings.showWebGL = false; _settings.zoom = z; applySettings(); }, zoom);
  await page.waitForFunction(() => typeof _isIdle !== 'undefined' && _isIdle === false && _pollFrame > 5, null, { timeout: 15000 });
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' });
}

test.describe('one header for every panel', () => {
  test('on the rig\'s HUD: one size, weight, colour and tracking, in sentence case, with no rule beneath', async ({ page }) => {
    await openRig(page, frame({ order: fieldWith(4), state: 4, mode: 4, start: 7, lap: 12 }));
    await page.waitForFunction(() => document.querySelectorAll('#lbRows .lb-row').length >= 3);
    const h = await headers(page);
    const one = h.datastream;
    for (const key of ['leaderboard', 'datastream', 'incidents', 'ahead', 'rating', 'tab']) {
      expect(h[key], key).toEqual(one);
    }
    expect(one.caps).toBe('none');
    expect(one.rule).toBe('0px');
    expect(one.weight).toBe('700');
    // The dim text colour of the theme, and a tracking of 0.04 of the size.
    expect(one.colour).toBe('rgba(255, 255, 255, 0.55)');
    expect(parseFloat(one.tracking) / parseFloat(one.size)).toBeCloseTo(0.04, 3);
    expect(await page.locator('.lb-header').textContent()).toBe('Leaderboard');
    expect(await page.locator('.ds-header').textContent()).toBe('Datastream');
    expect(await page.locator('.inc-label').textContent()).toBe('Incidents');
  });

  test('in the glance layout: the same one style at one size, the pit box\'s pages and the clock\'s key among them', async ({ page }) => {
    await openRig(page, frame({ order: fieldWith(4), state: 4, mode: 4, start: 7, lap: 12 }), { width: 1180, height: 820 });
    await page.evaluate(() => setDriveMode(true));
    await page.waitForFunction(() => document.body.classList.contains('drive-mode-active') && document.getElementById('raceTimerKey').textContent !== '');
    const h = await headers(page);
    const one = h.datastream;
    for (const key of ['leaderboard', 'datastream', 'incidents', 'ahead', 'rating', 'laps', 'tyres', 'clock']) {
      const { family, ...type } = h[key];
      const { family: f1, ...want } = one;
      expect(type, key).toEqual(want);
    }
    expect(one.caps).toBe('none');
    expect(one.rule).toBe('0px');
    expect(parseFloat(one.size)).toBeGreaterThanOrEqual(11);
  });
});

// ── The longest labels are whole ──

// What the host sends for a car of the list (as the C# reads it, with the list's words); the values made up.
function controlsFromList(car) {
  const dial = (c, label) => ({ id: c.id, label, ...(c.words ? { words: c.words } : {}), state: 'value', value: 3, text: c.id === 'brakeBias' ? '47.25' : c.id === 'mode' ? 'Track' : '3' });
  const primary = (id, having, label) => {
    if (having === 'none') return { id, label, state: 'none', text: 'None' };
    const c = car.controls.find((x) => x.id === id);
    if (c) return dial(c, c.label || label);
    const mode = car.controls.find((x) => x.id === 'mode' && (!x.covers || x.covers.includes(id)));
    if (mode) return { id, label, state: 'mode', by: mode.label || mode.id };
    return having === 'fixed' ? { id, label, state: 'on', text: 'On' } : null;
  };
  const out = { car: car.path, name: car.name, kind: car.kind };
  const abs = primary('abs', car.abs, 'ABS'), tc = primary('tc', car.tc, 'TC'), bb = primary('brakeBias', car.brakeBias, 'BB');
  if (abs) out.abs = abs;
  if (tc) out.tc = tc;
  if (bb) out.bb = bb;
  out.more = car.controls.filter((c) => !['abs', 'tc', 'brakeBias', 'drs', 'p2p'].includes(c.id)).map((c) => dial(c, c.label || c.id));
  for (const c of car.controls) {
    if (c.id === 'drs') out.drs = { id: 'drs', label: c.label || 'DRS', state: 'off', value: 0, text: 'Off' };
    if (c.id === 'p2p') out.p2p = { id: 'p2p', label: c.label || 'P2P', ...(c.words ? { words: c.words } : {}), state: 'off', value: 0, text: 'Off', count: 200 };
  }
  return out;
}

// The cars with the most to fit: the longest words and labels for the step of the panel each takes, and the cars with
// the most controls (the Audi R18's fourteen, the 499P, the W13, the 963).
const cellsOf = (v) => [...v.primary.filter((p) => !p.hidden), ...v.modes, ...v.more];
const LONGEST = (() => {
  const scored = LIST.cars.map((car) => {
    const v = view(controlsFromList(car));
    const fit = arrange(v);
    const worst = Math.max(...cellsOf(v).map((c) => labelPlan(c.words || c.label, c.locked, fit).len / Math.max(1, 6 - fit.cols)));
    return { car, worst, n: cellsOf(v).length };
  });
  const byWords = [...scored].sort((a, b) => b.worst - a.worst).slice(0, 10).map((s) => s.car.path);
  const byCount = [...scored].sort((a, b) => b.n - a.n).slice(0, 6).map((s) => s.car.path);
  return [...new Set([...byCount, ...byWords, 'porsche963gtp', 'mclaren720sgt3', 'mclaren570sgt4', 'dirtmodified 358'])];
})();

test.describe('the longest labels are whole', () => {
  test('on the rig, by the arithmetic the panel sizes its labels by: each cell its words where they are whole', () => {
    // Every car of the list: a cell shows its words unless they are not whole at its size, and then the form that is.
    const notWhole = [];
    for (const car of LIST.cars) {
      const v = view(controlsFromList(car));
      const fit = arrange(v);
      for (const cell of cellsOf(v)) {
        const form = chooseForm(cell, fit);
        if (!fitsWhole(formText(form), cell.locked, fit)) notWhole.push(`${car.path}: ${formText(form)}`);
        if (cell.words && fitsWhole(cell.words, cell.locked, fit)) expect(form.text, `${car.path}: ${cell.words}`).toBe(cell.words);
      }
    }
    // What no form of fits by the arithmetic (which allows 0.5 em a letter, more than the face's widest) is the Audi
    // R18's two lateral slips five across; in the page's own face they are whole (RD_REAL_FONT=1, below).
    expect(notWhole.every((n) => n.startsWith('audir18:')), notWhole.join('\n')).toBe(true);
  });

  test('on the rig at 3440x1440 and zoom 120: every cell inside the panel, nothing clipped, and with RD_REAL_FONT=1 every label whole', async ({ page }) => {
    test.setTimeout(180000);
    const first = LIST.cars.find((c) => c.path === LONGEST[0]);
    await openRig(page, frame({ order: fieldWith(4), state: 4, mode: 4, start: 7, lap: 12, controls: controlsFromList(first) }), { width: 3440, height: 1440, zoom: 120 });
    if (REAL_FONT) {
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(2500);
      expect(await page.evaluate(() => document.fonts.check('600 10px sofia-pro-comp')), 'Sofia Pro Comp has not arrived').toBe(true);
    }
    const problems = [];
    for (const p of LONGEST) {
      const car = LIST.cars.find((c) => c.path === p);
      const cc = controlsFromList(car);
      await page.evaluate((c) => { window.__feed.payload = { ...window.__feed.payload, 'RacingDesk.Plugin.CarControls': c, 'DataCorePlugin.GameData.CarModel': c.name }; window.__f0 = _pollFrame; }, cc);
      await page.waitForFunction(() => _pollFrame > window.__f0 + 3, null, { timeout: 8000 });
      await page.waitForTimeout(100);
      const v = view(cc);
      const fit = arrange(v);
      const want = cellsOf(v).filter((c) => c.state !== 'none').map((c) => formText(chooseForm(c, fit)));
      const m = await page.evaluate(() => {
        const root = document.querySelector('.car-controls');
        const r = root.getBoundingClientRect();
        return [...root.querySelectorAll('.ctrl-item, .ctrl-mini')].filter((el) => getComputedStyle(el).display !== 'none').map((el) => {
          const label = el.querySelector('.ctrl-label, .ctrl-mini-label');
          const b = el.getBoundingClientRect(), lb = label.getBoundingClientRect();
          const rg = document.createRange();
          rg.selectNodeContents(label);
          const lines = new Set([...rg.getClientRects()].map((q) => Math.round(q.top))).size;
          return {
            text: label.textContent, lines,
            cut: label.scrollWidth > label.clientWidth + 0.5 || rg.getBoundingClientRect().width > lb.width + 0.5 || lines > 2,
            inside: b.left >= r.left - 0.5 && b.right <= r.right + 0.5 && b.top >= r.top - 0.5 && b.bottom <= r.bottom + 0.5,
            clipped: el.scrollHeight > el.clientHeight + 1,
          };
        });
      });
      for (const label of want) if (!m.some((c) => c.text === label)) problems.push(`${p}: "${label}" is not shown`);
      for (const c of m) {
        if (!c.inside) problems.push(`${p}: "${c.text}" is outside the panel`);
        if (c.clipped) problems.push(`${p}: "${c.text}" is clipped by its cell`);
        if (REAL_FONT && c.cut) problems.push(`${p}: "${c.text}" is cut`);
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  test.describe('at every iPad size, in the glance layout, each label measured into its cell', () => {
    const IPADS = [[1180, 820], [820, 1180], [1366, 1024], [1024, 768], [744, 1133], [1133, 744], [810, 1080], [1080, 810]];
    // The GT3 and the GTPs he races, the prototypes and formula cars with the most controls, and the three with a dozen
    // in the row under the three (the Audi R18, the Mercedes W12 and W13), which no iPad has the width for.
    const CARS = ['mclaren720sgt3', 'porsche963gtp', 'cadillacvseriesrgtp', 'bmwlmdh', 'acuraarx06gtp', 'amvalkyriegtp', 'ferrari499p', 'porsche919', 'mclarenmp430', 'audir18', 'mercedesw12', 'mercedesw13'];
    let telemetry, port, payload;
    test.beforeAll(async () => {
      telemetry = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(payload)); });
      await new Promise((resolve) => telemetry.listen(0, '127.0.0.1', resolve));
      port = await new Promise((resolve) => { const probe = http.createServer(); probe.listen(0, '127.0.0.1', () => { const { port: p } = probe.address(); probe.close(() => resolve(p)); }); });
      await remote.start({ port, host: '127.0.0.1', appDir: OVERLAY, key: 'wrds2345', log: () => {}, telemetryUrl: `http://127.0.0.1:${telemetry.address().port}/racing-desk/` });
    });
    test.afterAll(async () => {
      await remote.stop();
      await new Promise((resolve) => { telemetry.close(resolve); telemetry.closeAllConnections(); });
    });

    for (const [width, height] of IPADS) {
      test(`${width}x${height}: every label whole in its cell where the row has the room, and the narrowest of its forms where it has not`, async ({ page }) => {
        test.setTimeout(120000);
        payload = frame({ order: fieldWith(4), state: 4, mode: 4, start: 7, lap: 12, controls: controlsFromList(LIST.cars.find((c) => c.path === CARS[0])) });
        await page.addInitScript(() => { try { localStorage.setItem('rd-effects', 'off'); } catch (e) { /* none */ } });
        await page.setViewportSize({ width, height });
        await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
        await page.goto(`http://127.0.0.1:${port}/`);
        await page.waitForFunction(() => typeof _isIdle !== 'undefined' && _isIdle === false && _pollFrame > 5, null, { timeout: 15000 });
        const problems = [];
        for (const p of CARS) {
          payload = frame({ order: fieldWith(4), state: 4, mode: 4, start: 7, lap: 12, controls: controlsFromList(LIST.cars.find((c) => c.path === p)) });
          await page.evaluate(() => { window.__f0 = _pollFrame; });
          await page.waitForFunction(() => _pollFrame > window.__f0 + 4, null, { timeout: 10000 });
          await page.waitForTimeout(150);
          const m = await page.evaluate(() => {
            const visible = (l) => l.getClientRects().length > 0 && getComputedStyle(l.parentElement).display !== 'none';
            // Widths to the fraction of a pixel: a text's own (a range over it), a cell's inside its padding and border.
            const range = document.createRange();
            const textWidth = (el) => { range.selectNodeContents(el); return range.getBoundingClientRect().width; };
            const edges = (cs) => ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce((s, k) => s + (parseFloat(cs[k]) || 0), 0);
            // How wide a label is in each of its forms, written into it and put back as it was.
            const widthOf = (l, form) => {
              const keep = l.innerHTML;
              l.textContent = form.mark ? form.text + ' ' : form.text;
              if (form.mark) { const s = document.createElement('span'); s.className = 'ctrl-mark'; s.textContent = form.mark; l.appendChild(s); }
              const w = textWidth(l);
              l.innerHTML = keep;
              return w;
            };
            const read = (l) => {
              const cell = l.parentElement;
              const cs = getComputedStyle(cell);
              const room = cell.getBoundingClientRect().width - edges(cs);
              const width = textWidth(l);
              const narrowest = Math.min(...(l.__rdForms || []).map((f) => widthOf(l, f)), width);
              const value = cell.querySelector('.ctrl-value, .ctrl-mini-value');
              // What the cell needs at the least: its narrowest label or its value, and its padding and border.
              const need = Math.max(narrowest, value ? textWidth(value) : 0) + edges(cs);
              return { text: l.textContent, width, room, narrowest, need, px: parseFloat(getComputedStyle(l).fontSize), mini: l.classList.contains('ctrl-mini-label') };
            };
            const labels = [...document.querySelectorAll('.car-controls .ctrl-label, .car-controls .ctrl-mini-label')].filter(visible).map(read);
            const row = document.getElementById('ctrlMore');
            const gap = row ? parseFloat(getComputedStyle(row).columnGap) || 0 : 0;
            const minis = labels.filter((l) => l.mini);
            // Whether the row under the three has the width for every cell at its narrowest.
            const roomy = !row || minis.reduce((s, l) => s + l.need, 0) + gap * Math.max(0, minis.length - 1) <= row.getBoundingClientRect().width + 0.5;
            return { labels, roomy };
          });
          expect(m.labels.length, `${p}: its labels are drawn`).toBeGreaterThan(2);
          for (const l of m.labels) {
            // Never under the glance layout's floor of 11px.
            if (l.px < 11) problems.push(`${p}: "${l.text}" is set at ${l.px}px`);
            if (l.width <= l.room + 0.5) continue;
            // Whole in its cell — the three always, and the row under them wherever it has the room for every cell —
            // and where it has not, the narrowest form of it.
            if (!l.mini || m.roomy) problems.push(`${p}: "${l.text}" is ${l.width.toFixed(1)}px in ${l.room.toFixed(1)}px`);
            else if (l.width > l.narrowest + 0.5) problems.push(`${p}: "${l.text}" is ${l.width.toFixed(1)}px where a form of it is ${l.narrowest.toFixed(1)}px`);
          }
          if (['mclaren720sgt3', 'porsche963gtp'].includes(p)) expect(m.roomy, `${p}: the row under the three has the room for every cell`).toBe(true);
        }
        expect(problems, problems.join('\n')).toEqual([]);
      });
    }
  });
});
