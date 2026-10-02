/**
 * Other drivers' names on the HUD (root CLAUDE.md, Other drivers' names). The host and the plugin send every other
 * driver as a character from packages/pseudonyms, already in the HUD's own style, and the HUD shows each name exactly
 * as it is sent: a nickname whole ("Sick Boy", "Second Prize"), a particle kept ("J. van Dyne"), a single word as it
 * is ("Lyle"), an entry's own form ("J.D. Steelritter"). The gaps carry the same string as the row, so what the HUD
 * matches by name (a threat to its row, a gap trend to its car) matches. The real dashboard.html, headless; no port.
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { frame, fieldWith } from '../frames.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD = pathToFileURL(path.resolve(__dirname, '..', '..', 'dashboard.html')).href;

// The field as the host sends it: characters, in the forms the list gives them.
const FIELD = ['Sick Boy', 'J. van Dyne', 'Lyle', 'J.D. Steelritter', 'Second Prize', 'H. Incandenza', 'M. Renton',
  'T. Iommi', 'R. Smith', 'D. Gately', "S. O'Malley", 'P. Steele'];

async function open(page, first) {
  await page.route(/^https?:\/\//, (route) => route.abort());
  await page.addInitScript((payload) => {
    window.__feed = { payload };
    const realFetch = window.fetch;
    window.fetch = function (url) {
      if (!/^http:\/\/localhost:8889\/racing-desk\/$/.test(String(url))) return realFetch.apply(this, arguments);
      return Promise.resolve(new Response(JSON.stringify(window.__feed.payload), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    };
  }, first);
  await page.goto(DASHBOARD, { waitUntil: 'load' });
  await page.evaluate(() => { _settings.showWebGL = false; });
  await page.waitForFunction(() => typeof _isIdle !== 'undefined' && _isIdle === false && _pollFrame > 3, null, { timeout: 10000 });
  const before = await page.evaluate(() => _pollFrame);
  await page.waitForFunction((n) => _pollFrame >= n + 4, before, { timeout: 5000 });
}

// What each other row says its driver is called: the row's own text, not the pit chip beside it.
const rowNames = (page) => page.evaluate(() => [...document.querySelectorAll('#lbRows .lb-row:not(.lb-player) .lb-name')]
  .map((el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join('').trim()));

test('every other row shows its name as it was sent, nicknames and particles whole', async ({ page }) => {
  const order = fieldWith(3, FIELD);
  await open(page, frame({ order }));
  const names = await rowNames(page);
  expect(names.length).toBeGreaterThanOrEqual(4);
  for (const n of names) expect(FIELD, `"${n}" is a name the frame sent`).toContain(n);
  for (const whole of ['Sick Boy', 'J. van Dyne', 'Lyle', 'J.D. Steelritter']) expect(names).toContain(whole);
});

test('the gaps name the cars ahead and behind with the strings their rows show', async ({ page }) => {
  const order = fieldWith(3, FIELD);
  await open(page, frame({ order }));
  const gaps = (await page.locator('#gapsBlock .gap-driver').allTextContents()).map((s) => s.trim());
  expect(gaps).toEqual([order[1], order[3]]);
  const names = await rowNames(page);
  for (const g of gaps) expect(names).toContain(g);
});
