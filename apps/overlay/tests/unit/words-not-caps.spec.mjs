/**
 * Words, not capitals. He asked on 2026-10-02: "i'm thinking we get rid of any all-caps text that isn't an acronym and
 * also that we use words instead of acronyms where we can, though things like tCLO may be hard" — and gave his words for
 * the common ones: "for ABS: anti-lock, for bb: bias. for tc: traction", "mig: migration. arb: rollbar". And to "should
 * all panel headers use one style?", yes.
 *
 * Held here:
 *   - nothing Racing Desk writes for him to read is in capitals but an acronym of modules/js/words.js: no stylesheet sets
 *     text in capitals, and no page, script, the Cars island, the calc engines the desk bundles, the car list or the
 *     commentary writes a word in them; no abbreviation where the word fits (iR, SoF, Pos, Inc, avg), and no heading in
 *     Title Case (tests/unit/words-scan.mjs reads them all; it is held to finding what it is for, too);
 *   - the car list has its words where a public source settles what a control does (his for the common ones), and the
 *     car's own short label where none does (the BMW LMDh's TCLON and TCLAT);
 *   - one header style for every panel, on the rig's HUD and in the glance layout, and one place for the leaderboard's,
 *     the datastream's and the incidents';
 *   - the pit box's corners in words on the rig;
 *   - the longest labels are whole: on the rig at his 3440x1440 and zoom 120 (by the arithmetic the panel sizes its
 *     labels by, and with RD_REAL_FONT=1 in the page's own font), and at every iPad size in the glance layout, measured —
 *     after a change of car with the stylesheet's transitions on, with the gaps' iRating, and in the crowded rows.
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
  scanScriptAbbreviations, scanScriptTitleCase, scanHtmlWords, titleCaseFiles, titleCaseHeading, abbreviationsIn, calcFiles,
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

  test('what this change spelt out is not an acronym in any text (frame rate, field of view, hybrid battery, strength of field), and what only a car shows is a label', () => {
    for (const was of ['FPS', 'FOV', 'ERS', 'SOF']) expect(W.ACRONYMS, was).not.toContain(was);
    // The hybrid's and the brakes' own abbreviations on a car's dash: a car's label may have them, nothing else may.
    for (const only of ['HYS', 'IBS', 'SOC']) {
      expect(W.ACRONYMS, only).not.toContain(only);
      expect(W.CAR_LABELS, only).toContain(only);
      expect(W.labelCase(`${only} BOOST`), only).toBe(`${only} boost`);
      expect(W.sentenceCase(`${only} BOOST`), only).toBe(`${only.toLowerCase()} boost`.replace(/^./, (c) => c.toUpperCase()));
    }
    expect(capsWords('FPS FOV ERS SOF')).toEqual(['FPS', 'FOV', 'ERS', 'SOF']);
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

    // A word that is code is exempt only as the whole of a string: a shown LEFT or NEXT, or a STARTED in a sentence, is a finding.
    const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-words-'));
    try {
      const js = path.join(tmp2, 'b.js');
      fs.writeFileSync(js, [
        "el.textContent = 'LEFT';",
        "el.textContent = 'NEXT';",
        "el.title = 'Recording STARTED';",
        "el.title = 'CAR LEFT';",
        "fetch(url, { method: 'GET' });",
        "const e = { code: 'ENOENT' };",
      ].join('\n'));
      expect(scanScript(js).map((f) => [f.line, f.what.split(': ').pop()])).toEqual([[1, 'LEFT'], [2, 'NEXT'], [3, 'STARTED'], [4, 'CAR'], [4, 'LEFT']]);
    } finally {
      fs.rmSync(tmp2, { recursive: true, force: true });
    }

    // The abbreviations that are not in capitals: iR, SoF, Pos, Inc, avg and inc/race.
    expect(abbreviationsIn('3210 iR')).toEqual(['iR (iRating)']);
    expect(abbreviationsIn('iRating 3210, SoF 2,345')).toEqual(['SoF (strength of field)']);
    expect(abbreviationsIn('<th>Pos</th><th>Inc</th>')).toEqual(['Pos (position)', 'Inc (incidents)']);
    expect(abbreviationsIn('1.2 inc/race, 1.4 avg')).toEqual(['inc/ (incidents a)', 'avg (average)']);
    expect(abbreviationsIn('3210 iRating, Position, Incidents, average, .inc-thresholds')).toEqual([]);
    const tmp3 = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-words-'));
    try {
      const js = path.join(tmp3, 'c.js');
      fs.writeFileSync(js, "el.textContent = `+${n} iR`; el.title = 'SoF'; el.className = 'inc-label';\nth.innerHTML = '<th>Pos</th>';\n");
      expect(scanScriptAbbreviations(js).map((f) => [f.line, f.what.split(': ').pop()])).toEqual([[1, 'iR (iRating)'], [1, 'SoF (strength of field)'], [2, 'Pos (position)']]);
    } finally {
      fs.rmSync(tmp3, { recursive: true, force: true });
    }

    // Title Case, where capitals used to hide it: a heading with every word capitalised.
    for (const heading of ['Race Summary', 'Areas for Improvement', 'Cool-Downs', 'Rage Spikes', 'Incident Coach', 'Next Session Focus']) expect(titleCaseHeading(heading), heading).toBe(true);
    for (const text of ['Race summary', 'Cool-downs', 'Incident coach', 'Quit Racing Desk', 'Open the Stream Deck app', 'Page Down', 'Trading Paints', 'Press Set up OBS again.', 'Civic Type R', 'Racing Desk is closing', 'Next', 'Leaderboard']) {
      expect(titleCaseHeading(text), text).toBe(false);
    }

    // The calc engines the desk's bundle holds are read too, and only those.
    const bundled = calcFiles().map((f) => path.relative(path.join(OVERLAY, '..', '..'), f).split(path.sep).join('/'));
    expect(bundled).toContain('packages/calc/src/index.ts');
    expect(bundled).toContain('packages/calc/src/engines/race-now-verdict.ts');
    expect(bundled).toContain('packages/calc/src/engines/next-race-ideas.ts');
    expect(scriptFiles()).toEqual(expect.arrayContaining(calcFiles()));
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

  test('nor an abbreviation where the word fits (iRating, strength of field, position, incidents, average), in any page or script', () => {
    const pages = [path.join(OVERLAY, 'dashboard.html'), path.join(OVERLAY, 'desk.html')];
    const found = [...scriptFiles().flatMap(scanScriptAbbreviations), ...pages.flatMap(scanHtmlWords).filter((f) => !/Title Case$/.test(f.what))];
    expect(found, found.map((f) => `${f.file}:${f.line} ${f.what}`).join('\n')).toEqual([]);
  });

  test('nor a heading in Title Case (the stylesheets set capitals before, and the headings were written so: sentence case now)', () => {
    const pages = [path.join(OVERLAY, 'dashboard.html'), path.join(OVERLAY, 'desk.html')];
    const found = [...titleCaseFiles().flatMap(scanScriptTitleCase), ...pages.flatMap(scanHtmlWords).filter((f) => /Title Case$/.test(f.what))];
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

// Where the text of the leaderboard's, the datastream's and the incidents' headers sits in its panel (the panel's own box: its border
// and glass), in CSS pixels from the left and from the top.
const insets = (page) => page.evaluate(() => {
  const zoom = parseFloat(getComputedStyle(document.getElementById('dashboard') || document.body).zoom) || 1;
  const where = (header, panel) => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(header));
    const t = range.getBoundingClientRect();
    const p = document.querySelector(panel).getBoundingClientRect();
    return { left: +((t.left - p.left) / zoom).toFixed(2), top: +((t.top - p.top) / zoom).toFixed(2) };
  };
  return { leaderboard: where('.lb-header', '.lb-inner'), datastream: where('.ds-header', '.ds-inner'), incidents: where('.inc-label', '.inc-inner') };
});

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
    weather: pick(document.getElementById('pbPageWeather'), '::before'),
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
    // Larger than the data's labels and lighter than its numbers (he asked on 2026-10-02): Light at --fs-lg.
    expect(one.weight).toBe('300');
    expect(one.size).toBe('13px');
    // The dim text colour of the theme, and a tracking of 0.04 of the size.
    expect(one.colour).toBe('rgba(255, 255, 255, 0.55)');
    expect(parseFloat(one.tracking) / parseFloat(one.size)).toBeCloseTo(0.04, 3);
    expect(await page.locator('.lb-header').textContent()).toBe('Leaderboard');
    expect(await page.locator('.ds-header').textContent()).toBe('Datastream');
    expect(await page.locator('.inc-label').textContent()).toBe('Incidents');
  });

  test('where it sits: the leaderboard\'s, the datastream\'s and the incidents\' headers are one inset from their panels\' edges, on the rig and in the glance layout', async ({ page }) => {
    await openRig(page, frame({ order: fieldWith(4), state: 4, mode: 4, start: 7, lap: 12 }), { width: 1920, height: 1080 });
    await page.waitForFunction(() => document.querySelectorAll('#lbRows .lb-row').length >= 3);
    let at = await insets(page);
    // 11px in (the panel's 10px of padding and its border) and 7px down (its 6px and the border), as the datastream's is.
    for (const key of ['leaderboard', 'datastream', 'incidents']) {
      expect(Math.abs(at[key].left - 11), `rig: ${key} from the left (${at[key].left})`).toBeLessThanOrEqual(1.2);
      expect(Math.abs(at[key].top - 7), `rig: ${key} from the top (${at[key].top})`).toBeLessThanOrEqual(1.2);
    }
    expect(Math.abs(at.leaderboard.left - at.incidents.left)).toBeLessThanOrEqual(0.6);
    expect(Math.abs(at.leaderboard.top - at.incidents.top)).toBeLessThanOrEqual(0.6);
    expect(Math.abs(at.datastream.top - at.incidents.top)).toBeLessThanOrEqual(0.6);

    await page.evaluate(() => setDriveMode(true));
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.waitForFunction(() => document.body.classList.contains('drive-mode-active') && document.getElementById('raceTimerKey').textContent !== '');
    await page.waitForTimeout(300);
    at = await insets(page);
    for (const key of ['leaderboard', 'datastream', 'incidents']) {
      expect(Math.abs(at[key].left - 11), `glance: ${key} from the left (${at[key].left})`).toBeLessThanOrEqual(1.2);
      expect(Math.abs(at[key].top - 7), `glance: ${key} from the top (${at[key].top})`).toBeLessThanOrEqual(1.2);
    }
    for (const key of ['datastream', 'incidents']) {
      expect(Math.abs(at[key].left - at.leaderboard.left), `glance: ${key} against the leaderboard, from the left`).toBeLessThanOrEqual(0.6);
      expect(Math.abs(at[key].top - at.leaderboard.top), `glance: ${key} against the leaderboard, from the top`).toBeLessThanOrEqual(0.6);
    }
  });

  test('in the glance layout: the same one style at one size, the pit box\'s pages and the clock\'s key among them', async ({ page }) => {
    await openRig(page, frame({ order: fieldWith(4), state: 4, mode: 4, start: 7, lap: 12 }), { width: 1180, height: 820 });
    await page.evaluate(() => setDriveMode(true));
    await page.waitForFunction(() => document.body.classList.contains('drive-mode-active') && document.getElementById('raceTimerKey').textContent !== '');
    const h = await headers(page);
    const one = h.datastream;
    for (const key of ['leaderboard', 'datastream', 'incidents', 'ahead', 'rating', 'laps', 'weather', 'clock']) {
      const { family, ...type } = h[key];
      const { family: f1, ...want } = one;
      expect(type, key).toEqual(want);
    }
    expect(one.caps).toBe('none');
    expect(one.rule).toBe('0px');
    expect(parseFloat(one.size)).toBeGreaterThanOrEqual(11);
  });
});

// ── The pit box's corners: words on the rig, where each has the room under its ring ──

test.describe('the pit box names its corners', () => {
  test('on the rig: Left front, Right front, Left rear and Right rear, each whole under its ring', async ({ page }) => {
    await openRig(page, frame({ order: fieldWith(4), state: 4, mode: 4, start: 7, lap: 12 }), { width: 3440, height: 1440, zoom: 120 });
    const corners = await page.evaluate(() => ['LF', 'RF', 'LR', 'RR'].map((c) => {
      const cell = document.getElementById('pbCircle' + c);
      const name = cell.querySelector('.pb-circle-pos');
      const rg = document.createRange();
      rg.selectNodeContents(name);
      const t = rg.getBoundingClientRect(), r = cell.getBoundingClientRect(), ring = cell.querySelector('.pb-wear-ring').getBoundingClientRect();
      return { c, text: name.innerText, title: name.getAttribute('title'), inside: t.left >= r.left - 0.5 && t.right <= r.right + 0.5, belowRing: t.top >= ring.bottom - 2, shown: cell.getClientRects().length > 0 };
    }));
    expect(corners.map((k) => [k.c, k.text, k.title, k.shown])).toEqual([['LF', 'Left front', 'Left front', true], ['RF', 'Right front', 'Right front', true], ['LR', 'Left rear', 'Left rear', true], ['RR', 'Right rear', 'Right rear', true]]);
    for (const k of corners) {
      expect(k.inside, `${k.c}: its name is inside its cell`).toBe(true);
      expect(k.belowRing, `${k.c}: its name is under its ring`).toBe(true);
    }
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
            text: label.textContent, lines, px: parseFloat(getComputedStyle(label).fontSize), twoLine: label.classList.contains('ctrl-label-2l'),
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
        // The plan's room is the cell's real width, so a label it keeps on one line is set at 8px or more by the stylesheet (it was set
        // at 7.66px on the 963's Rear rollbar, which the plan thought held 8.17: it had taken the panel's padding for the cell's).
        if (!c.twoLine && c.px < 8 - 0.05) problems.push(`${p}: "${c.text}" is planned on one line and set at ${c.px}px`);
      }
      // The same words at the same size: the 963's front and rear rollbars.
      const front = m.find((c) => /^Front rollbar/.test(c.text)), rear = m.find((c) => /^Rear rollbar/.test(c.text));
      // (Where one wraps and the other does not, the rows' own sizes differ: a tight row sets a wrapped label at 7px and a whole one at 8.)
      if (front && rear && front.twoLine === rear.twoLine && Math.abs(front.px - rear.px) > 0.05) problems.push(`${p}: the front rollbar is set at ${front.px}px and the rear at ${rear.px}px`);
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
            // The glance layout's floor is 11px, but for a crowded row's labels, which go down together to 9 where the row
            // would not hold (a crowded row is held to it by its own test, below).
            if (l.px < (l.mini ? 9 : 11) - 0.05) problems.push(`${p}: "${l.text}" is set at ${l.px}px`);
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

    // How a label is measured in the page: its own width in each form it can take, and what its cell gives it.
    const READ_LABELS = () => {
      const range = document.createRange();
      const textWidth = (el) => { range.selectNodeContents(el); return range.getBoundingClientRect().width; };
      const edges = (cs) => ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce((n, k) => n + (parseFloat(cs[k]) || 0), 0);
      const widthOf = (l, form) => {
        const keep = l.innerHTML;
        l.textContent = form.mark ? form.text + ' ' : form.text;
        if (form.mark) { const sp = document.createElement('span'); sp.className = 'ctrl-mark'; sp.textContent = form.mark; l.appendChild(sp); }
        const w = textWidth(l);
        l.innerHTML = keep;
        return w;
      };
      return [...document.querySelectorAll('.car-controls .ctrl-label, .car-controls .ctrl-mini-label')].filter((l) => l.getClientRects().length > 0).map((l) => {
        const cell = l.parentElement;
        const room = cell.getBoundingClientRect().width - edges(getComputedStyle(cell));
        const forms = (l.__rdForms || []).map((f) => (f.mark ? f.text + ' ' + f.mark : f.text));
        const widths = (l.__rdForms || []).map((f) => widthOf(l, f));
        const shown = forms.findIndex((f) => f === l.textContent);
        return { text: l.textContent, mini: l.classList.contains('ctrl-mini-label'), room, forms, widths, shown, width: textWidth(l) };
      });
    };

    // He saw "ABS" and "TCLO" in the 720S's and the 963's main cells on an iPad where "Anti-lock" and "Traction slip" fit: a label was
    // measured in the frame its cell changed and the cell was still growing (the stylesheet animated its flex for a third of a second),
    // then never again. The cars are changed one after another, with the stylesheet's transitions left on, as a drive does it.
    for (const [width, height] of IPADS) {
      test(`${width}x${height}: after a change of car every main cell shows the longest form that fits it, however the car before it was laid out`, async ({ page }) => {
        test.setTimeout(120000);
        const SEQUENCE = ['porsche963gtp', 'mclaren720sgt3', 'cadillacvseriesrgtp', 'acuraarx06gtp'];
        payload = frame({ order: fieldWith(4), state: 4, mode: 4, start: 7, lap: 12, controls: controlsFromList(LIST.cars.find((c) => c.path === SEQUENCE[0])) });
        await page.addInitScript(() => { try { localStorage.setItem('rd-effects', 'off'); } catch (e) { /* none */ } });
        await page.setViewportSize({ width, height });
        await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
        await page.goto(`http://127.0.0.1:${port}/`);
        await page.waitForFunction(() => typeof _isIdle !== 'undefined' && _isIdle === false && _pollFrame > 5, null, { timeout: 15000 });
        // His own transitions are on: a stylesheet that animates the cells' size again would put the old bug back.
        expect(await page.evaluate(() => getComputedStyle(document.querySelector('.car-controls .ctrl-item')).transitionProperty)).not.toMatch(/\ball\b|flex|padding|width|min-width/);
        const problems = [];
        for (const p of SEQUENCE) {
          if (p !== SEQUENCE[0]) {
            payload = frame({ order: fieldWith(4), state: 4, mode: 4, start: 7, lap: 12, controls: controlsFromList(LIST.cars.find((c) => c.path === p)) });
            await page.evaluate(() => { window.__f0 = _pollFrame; });
          } else {
            await page.evaluate(() => { window.__f0 = _pollFrame - 5; });
          }
          await page.waitForFunction(() => _pollFrame > window.__f0 + 4, null, { timeout: 10000 });
          // Read at once, with the cells as they are: the form was chosen when they changed, and a later look would see them settled.
          const labels = await page.evaluate(READ_LABELS);
          expect(labels.length, `${p}: its labels are drawn`).toBeGreaterThan(2);
          for (const l of labels.filter((x) => !x.mini)) {
            const fits = l.widths.findIndex((w) => w <= l.room + 0.5);
            const want = fits === -1 ? l.widths.indexOf(Math.min(...l.widths)) : fits;
            if (l.shown !== want) problems.push(`${p}: "${l.text}" is shown, and "${l.forms[want]}" fits (${l.widths[want].toFixed(1)}px in ${l.room.toFixed(1)}px)`);
          }
        }
        expect(problems, problems.join('\n')).toEqual([]);
      });
    }

    // The 963's main cell, on a fresh page: "Traction slip", not the car's TCLO, though it is the first car the page has seen.
    test('820x1180: a fresh page showing the 963 has Traction slip in its main cell', async ({ page }) => {
      payload = frame({ order: fieldWith(4), state: 4, mode: 4, start: 7, lap: 12, controls: controlsFromList(LIST.cars.find((c) => c.path === 'porsche963gtp')) });
      await page.addInitScript(() => { try { localStorage.setItem('rd-effects', 'off'); } catch (e) { /* none */ } });
      await page.setViewportSize({ width: 820, height: 1180 });
      await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
      await page.goto(`http://127.0.0.1:${port}/`);
      await page.waitForFunction(() => typeof _isIdle !== 'undefined' && _isIdle === false && _pollFrame > 5, null, { timeout: 15000 });
      expect(await page.locator('#ctrlTC .ctrl-label').textContent()).toBe('Traction slip');
      expect(await page.locator('#ctrlBB .ctrl-label').textContent()).toBe('Bias');
    });

    // The iRating beside each car of the gaps block: the words where the line, with the way the gap is going after it, is whole in
    // its cell, "iR" where it is not. (The rig's cells are 66px across and have "3210 iR"; an iPad's have the room on some sides.)
    for (const [width, height] of IPADS) {
      test(`${width}x${height}: the gaps' iRating is the longest form that is whole in its cell, with the trend after it and without`, async ({ page }) => {
        test.setTimeout(60000);
        const gaps = (ahead, behind) => ({ 'IRacingExtraProperties.iRacing_Opponent_Ahead_Gap': ahead, 'IRacingExtraProperties.iRacing_Opponent_Behind_Gap': behind });
        const RACE = (lap, extra) => frame({ order: fieldWith(4), state: 4, mode: 4, start: 7, lap, extra });
        payload = RACE(12, gaps(2.0, 1.0));
        await page.addInitScript(() => { try { localStorage.setItem('rd-effects', 'off'); } catch (e) { /* none */ } });
        await page.setViewportSize({ width, height });
        await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
        await page.goto(`http://127.0.0.1:${port}/`);
        await page.waitForFunction(() => typeof _isIdle !== 'undefined' && _isIdle === false && _pollFrame > 5, null, { timeout: 15000 });
        const read = async () => {
          await page.evaluate(() => { window.__f0 = _pollFrame; });
          await page.waitForFunction(() => _pollFrame > window.__f0 + 4, null, { timeout: 10000 });
          return page.evaluate(() => [...document.querySelectorAll('.gap-ir')].map((el) => {
            // Whole: on one line, with what follows it, in the cell's width.
            const whole = () => {
              const cell = el.getBoundingClientRect().width;
              el.style.width = 'max-content'; el.style.whiteSpace = 'nowrap';
              const natural = el.getBoundingClientRect().width;
              el.style.width = ''; el.style.whiteSpace = '';
              return natural <= cell + 0.02;
            };
            const text = el.textContent, trend = getComputedStyle(el, '::after').content;
            const shownWhole = whole();
            // And what the other form would have been: the words, where "iR" is shown.
            let wordsWhole = null;
            if (/ iR$/.test(text)) { el.textContent = text.replace(/ iR$/, ' iRating'); wordsWhole = whole(); el.textContent = text; }
            return { text, trend, shownWhole, wordsWhole, height: el.getBoundingClientRect().height, line: parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.3 };
          }));
        };
        let said = await read();
        expect(said.map((x) => x.text), 'first lap seen: no trend, so the words').toEqual(['3210 iRating', '2530 iRating']);
        expect(said.every((x) => x.shownWhole)).toBe(true);
        payload = RACE(13, gaps(1.5, 1.4));
        said = await read();
        for (const x of said) {
          expect(x.trend, 'the trend is after it').toMatch(/^" · [▼▲]/);
          expect(x.shownWhole, `${x.text} ${x.trend} is whole in its cell`).toBe(true);
          expect(x.height, `${x.text} is on one line`).toBeLessThanOrEqual(x.line * 1.5);
          // The longest that is whole: "iRating", or "iR" only where the words with the trend are not.
          if (/ iR$/.test(x.text)) expect(x.wordsWhole, `${x.text}: the words would not have been whole`).toBe(false);
          else expect(x.text).toMatch(/^\d+ iRating$/);
        }
        // The iPads he is likeliest to have: an Air or an 11-inch Pro on its side, the 12.9-inch, an Air upright. The words fit them,
        // trend and all (the line is set without the body's tracking, which was 11px of it).
        if ([[1180, 820], [1366, 1024], [820, 1180]].some(([w, h]) => w === width && h === height)) {
          expect(said.map((x) => x.text), `${width}x${height}: the words`).toEqual(['3210 iRating', '2530 iRating']);
        }
      });
    }

    // A row under the three with more cells than the iPad has the width for is made whole in steps — its cells closed up, then its
    // labels down from 11px to 9 — and where even that is not enough a label is cut at the edge of its own cell, and never runs into
    // the next one's. The cars are the crowded ones: the 499P (7 cells), the Valkyrie, the BMW LMDh, the 919, and the Audi R18 and
    // the Mercedes W13, whose twelve and ten no iPad has the width for.
    const CROWDED = ['ferrari499p', 'bmwlmdh', 'amvalkyriegtp', 'porsche919', 'audir18', 'mercedesw13'];
    for (const [width, height] of IPADS) {
      test(`${width}x${height}: a crowded row is whole where the iPad has the width for it, and never runs into the next label where it has not`, async ({ page }) => {
        test.setTimeout(120000);
        payload = frame({ order: fieldWith(4), state: 4, mode: 4, start: 7, lap: 12, controls: controlsFromList(LIST.cars.find((c) => c.path === CROWDED[0])) });
        await page.addInitScript(() => { try { localStorage.setItem('rd-effects', 'off'); } catch (e) { /* none */ } });
        await page.setViewportSize({ width, height });
        await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
        await page.goto(`http://127.0.0.1:${port}/`);
        await page.waitForFunction(() => typeof _isIdle !== 'undefined' && _isIdle === false && _pollFrame > 5, null, { timeout: 15000 });
        const problems = [];
        for (const p of CROWDED) {
          payload = frame({ order: fieldWith(4), state: 4, mode: 4, start: 7, lap: 12, controls: controlsFromList(LIST.cars.find((c) => c.path === p)) });
          await page.evaluate(() => { window.__f0 = _pollFrame; });
          await page.waitForFunction(() => _pollFrame > window.__f0 + 4, null, { timeout: 10000 });
          await page.waitForTimeout(150);
          const m = await page.evaluate(() => {
            const row = document.getElementById('ctrlMore');
            const panel = document.querySelector('.car-controls');
            const range = document.createRange();
            const textWidth = (el) => { range.selectNodeContents(el); return range.getBoundingClientRect().width; };
            const edges = (cs) => ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce((n, k) => n + (parseFloat(cs[k]) || 0), 0);
            const widthOf = (l, form) => {
              const keep = l.innerHTML;
              l.textContent = form.mark ? form.text + ' ' : form.text;
              if (form.mark) { const sp = document.createElement('span'); sp.className = 'ctrl-mark'; sp.textContent = form.mark; l.appendChild(sp); }
              const w = textWidth(l);
              l.innerHTML = keep;
              return w;
            };
            const minis = () => [...row.children];
            // Whether the row has the width for every cell at the narrowest form of its label, in the row as it is laid out for a state.
            const holds = (closed, scale) => {
              const was = [row.classList.contains('ctrl-crowded'), row.style.getPropertyValue('--mini-scale')];
              row.classList.toggle('ctrl-crowded', closed);
              if (scale < 1) row.style.setProperty('--mini-scale', String(scale)); else row.style.removeProperty('--mini-scale');
              let need = 0;
              const cells = minis();
              for (const cell of cells) {
                const l = cell.querySelector('.ctrl-mini-label'), v = cell.querySelector('.ctrl-mini-value');
                const narrowest = Math.min(...(l.__rdForms || []).map((f) => widthOf(l, f)), textWidth(l));
                need += Math.max(narrowest, textWidth(v)) + edges(getComputedStyle(cell));
              }
              const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
              const ok = need + gap * Math.max(0, cells.length - 1) <= row.getBoundingClientRect().width + 0.5;
              row.classList.toggle('ctrl-crowded', was[0]);
              if (was[1]) row.style.setProperty('--mini-scale', was[1]); else row.style.removeProperty('--mini-scale');
              return ok;
            };
            const labels = minis().map((cell) => {
              const l = cell.querySelector('.ctrl-mini-label');
              const room = cell.getBoundingClientRect().width - edges(getComputedStyle(cell));
              const lr = l.getBoundingClientRect(), cr = cell.getBoundingClientRect();
              return { text: l.textContent, px: parseFloat(getComputedStyle(l).fontSize), width: textWidth(l), room, cut: l.scrollWidth > l.clientWidth + 0.5, inCell: lr.left >= cr.left - 0.5 && lr.right <= cr.right + 0.5 };
            });
            return { n: minis().length, openHolds: holds(false, 1), floorHolds: holds(true, 0.82), crowded: row.classList.contains('ctrl-crowded'), scale: parseFloat(row.style.getPropertyValue('--mini-scale') || '1'), labels, panelInside: panel.scrollWidth <= panel.clientWidth + 1 };
          });
          const where = `${p}`;
          if (m.openHolds) {
            // Roomy: as it has always been, at 11px or more, whole, with nothing closed up.
            if (m.crowded || m.scale !== 1) problems.push(`${where}: the row has the room and is laid out as crowded`);
            for (const l of m.labels) {
              if (l.px < 11 - 0.01) problems.push(`${where}: "${l.text}" is set at ${l.px}px in a row that has the room`);
              if (l.width > l.room + 0.5) problems.push(`${where}: "${l.text}" is ${l.width.toFixed(1)}px in ${l.room.toFixed(1)}px`);
            }
          } else if (m.floorHolds) {
            // Crowded, and the iPad has the width: whole, down from 11px by no more than the 9 it may go to.
            if (!m.crowded) problems.push(`${where}: the row does not hold as it is, and is not laid out as crowded`);
            for (const l of m.labels) {
              if (l.px < 9 - 0.05) problems.push(`${where}: "${l.text}" is set at ${l.px}px, under the 9 a crowded row's labels go down to`);
              if (l.width > l.room + 0.5) problems.push(`${where}: "${l.text}" is ${l.width.toFixed(1)}px in ${l.room.toFixed(1)}px, though the row holds at 9px`);
            }
          } else {
            // The iPad has not the width at 9px (twelve dials at 20px each): as small as it goes, and each label kept to its own cell.
            if (!m.crowded || m.scale > 0.83) problems.push(`${where}: the row cannot hold and is not at its smallest (scale ${m.scale})`);
            for (const l of m.labels) {
              if (!l.inCell) problems.push(`${where}: "${l.text}" runs out of its cell into the next one's`);
              if (l.px < 9 - 0.05) problems.push(`${where}: "${l.text}" is set at ${l.px}px`);
            }
          }
        }
        // The cars that are the point: the 499P has the width on the larger iPads, the BMW and the Valkyrie on the sides, and so on.
        expect(problems, problems.join('\n')).toEqual([]);
      });
    }
  });
});
