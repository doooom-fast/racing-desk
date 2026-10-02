/**
 * What the HUD draws from iRacing's own flag field (modules/js/session-flags.js, decoded in session-flags.spec.mjs): a
 * local yellow apart from a full-course caution, one lap to green, green held, the black flag furled, disqualified, the
 * small notices, the start lights. The real dashboard.html is served through remote-server.js on 127.0.0.1, headless, as
 * the glance layout (an iPad's), over a stand-in for the rig's telemetry; every other address is shut. A payload with no
 * field in it is what a SimHub plugin from before it sends, or a replay: the page is then as it was, from the one word.
 * The values his own recordings have (0x10040200 all through a practice session, 0x10040201 in the cool-down, 0x20040600 in
 * the parade) are held against the page too, since a flag made of a bit that is always up is no flag.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { frame, fieldWith } from '../frames.mjs';

const require = createRequire(import.meta.url);
const remote = require('../../remote-server.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const OVERLAY = path.resolve(here, '..', '..');
const KEY = 'abcd2345';

const LOCAL_YELLOW = 0x8, CAUTION = 0x4000, ONE_TO_GREEN = 0x200, GREEN = 0x4, GREEN_HELD = 0x400, WHITE = 0x2;
const FURLED = 0x80000, BLACK = 0x10000, DISQUALIFY = 0x20000, TEN = 0x800, FIVE = 0x1000, HALFWAY = 0x80;

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
  await remote.start({
    port, host: '127.0.0.1', appDir: OVERLAY, key: KEY, log: () => {},
    telemetryUrl: `http://127.0.0.1:${telemetry.address().port}/racing-desk/`,
  });
});
test.afterAll(async () => {
  await remote.stop();
  await new Promise((resolve) => { telemetry.close(resolve); telemetry.closeAllConnections(); });
});

// A race in progress; `flags` is iRacing's field and `flag` the one word, each as the plugin would send it (or not).
const RACE = (over = {}) => frame({ order: fieldWith(4), state: 4, mode: 4, start: 7, lap: 12, ...over });

async function openAt(page, width, height, first) {
  payload = first;
  await page.addInitScript(() => { try { localStorage.setItem('rd-effects', 'off'); } catch (e) { /* none */ } });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
  await page.setViewportSize({ width, height });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => typeof _isIdle !== 'undefined' && _isIdle === false && _pollFrame > 5, null, { timeout: 10000 });
  await drawn(page);
}

async function drawn(page) {
  const before = await page.evaluate(() => _pollFrame);
  await page.waitForFunction((n) => _pollFrame >= n + 6, before, { timeout: 8000 });
  await page.waitForTimeout(700);   // the colours' own transitions (0.35s and 0.4s) have run
}

// A few frames, no more (the colours' own transitions are not waited for): for what is told by when a frame is seen.
async function frames(page, n = 6) {
  const before = await page.evaluate(() => _pollFrame);
  await page.waitForFunction((k) => _pollFrame >= k, before + n, { timeout: 8000 });
}

async function serve(page, next) {
  payload = next;
  await drawn(page);
}

// What the page shows of the flag: the background, the glass, the gaps block's words and race control's banner.
const look = (page) => page.evaluate(() => {
  const before = getComputedStyle(document.body, '::before');
  const panel = document.getElementById('positionPage');
  const banner = document.getElementById('rcBanner');
  return {
    flag: document.body.dataset.flag,
    opacity: before.opacity,
    pattern: before.backgroundImage,
    tint: getComputedStyle(panel).backgroundImage,
    base: getComputedStyle(panel).backgroundColor,
    gapsClass: [...document.getElementById('gapsBlock').classList].filter((c) => c.startsWith('flag-') && c !== 'flag-active').join(' '),
    active: document.getElementById('gapsBlock').classList.contains('flag-active'),
    label: document.getElementById('flagLabel1').textContent,
    context: document.getElementById('flagCtx1').textContent,
    banner: banner.classList.contains('rc-visible') ? [document.getElementById('rcTitle').textContent, document.getElementById('rcDetail').textContent] : null,
    bannerClass: banner.className,
  };
});

// The yellow of a full-course caution's stripes, and of the glass it tints (drive-view.css).
const CAUTION_STRIPE = 'rgb(253, 205, 13)';           // hsl(48, 98%, 52%)
const CAUTION_TINT = 'rgba(245, 205, 40, 0.34)';
const WHITE_STRIPE = 'rgb(245, 245, 245)';             // hsl(0, 0%, 96%)
const WHITE_FLAG_SHADE = 'rgb(214, 214, 214)';         // hsl(0, 0%, 84%): the white flag's second stripe

test.describe('a local yellow is lighter than a full-course caution, and both are told from the field', () => {
  test('local yellow: thin yellow stripes round the edge, the panels left as they are, and it says so', async ({ page }) => {
    test.setTimeout(60000);
    await openAt(page, 1180, 820, RACE({ flag: 'none', sessionFlags: 0 }));
    const none = await look(page);
    expect(none.flag).toBe('none');
    expect(none.opacity).toBe('0');

    // The one word says yellow, as it does for a caution too: it is the field that says which.
    await serve(page, RACE({ flag: 'yellow', sessionFlags: LOCAL_YELLOW }));
    const local = await look(page);
    expect(local.flag).toBe('localyellow');
    expect(local.gapsClass).toBe('flag-localyellow');
    // On an iPad the pattern behind the panels is at fifteen hundredths under every flag, this one too (drive-view.spec.mjs
    // holds every flag to it, and the thin frame at the screen's edge to full strength).
    expect(+local.opacity).toBeCloseTo(0.15, 2);
    expect(local.pattern).toContain(CAUTION_STRIPE);
    expect(local.pattern, 'yellow stripes with the dark between them, not a solid fill').toContain('rgba(0, 0, 0, 0)');
    expect(local.tint, 'the panels are not lit by it: a yellow that is a sector, not the track').toBe(none.tint);
    expect(local.label).toBe('Local yellow');
    expect(local.context).toBe('Local yellow — slow in this sector');
    expect(local.banner, 'race control has nothing to say of a sector').toBeNull();

    // A waved local yellow (0x100) is the same, and the one word left it out.
    await serve(page, RACE({ flag: 'none', sessionFlags: 0x100 }));
    expect((await look(page)).flag).toBe('localyellow');

    // The full-course caution is the full treatment: every gutter solid, every panel lit, and race control says it.
    await serve(page, RACE({ flag: 'yellow', sessionFlags: CAUTION }));
    const caution = await look(page);
    expect(caution.flag).toBe('caution');
    expect(caution.gapsClass).toBe('flag-caution');
    expect(caution.pattern).toContain(CAUTION_STRIPE);
    expect(caution.pattern, 'a solid fill').not.toContain('rgba(0, 0, 0, 0)');
    expect(caution.tint).toContain(CAUTION_TINT);
    expect(caution.base, 'over a panel the numbers stay legible on').toMatch(/^rgba?\(15, 15, 15(, 1)?\)$/);
    expect(caution.label).toBe('Caution');
    expect(caution.context).toBe('Full course caution — hold position');
    expect(caution.banner).toEqual(['Caution', 'Full course caution — hold position']);

    // A caution with a local yellow in it (iRacing sets both) is the caution; the waved caution is one too.
    await serve(page, RACE({ flag: 'yellow', sessionFlags: CAUTION | LOCAL_YELLOW }));
    expect((await look(page)).flag).toBe('caution');
    await serve(page, RACE({ flag: 'yellow', sessionFlags: 0x8000 }));
    expect((await look(page)).flag).toBe('caution');
  });

  test('the caution is the one the page always drew for yellow: same background, same glass, same sentence', async ({ page }) => {
    test.setTimeout(60000);
    await openAt(page, 1180, 820, RACE({ flag: 'yellow' }));
    const word = await look(page);
    await serve(page, RACE({ flag: 'yellow', sessionFlags: CAUTION }));
    const field = await look(page);
    expect(word.flag).toBe('yellow');
    expect(field.flag).toBe('caution');
    expect(field.pattern).toBe(word.pattern);
    expect(field.tint).toBe(word.tint);
    expect(field.label).toBe(word.label);
    expect(field.context).toBe(word.context);
  });
});

test.describe('one lap to green, green held, the black flag furled, disqualified', () => {
  test('one lap to green, under a caution, is yellow and white, and says it', async ({ page }) => {
    test.setTimeout(60000);
    await openAt(page, 1180, 820, RACE({ flag: 'yellow', sessionFlags: CAUTION }));
    await serve(page, RACE({ flag: 'yellow', sessionFlags: CAUTION | ONE_TO_GREEN }));
    const one = await look(page);
    expect(one.flag).toBe('onetogreen');
    expect(one.gapsClass).toBe('flag-onetogreen');
    expect(one.pattern).toContain(CAUTION_STRIPE);
    expect(one.pattern).toContain(WHITE_STRIPE);
    expect(one.pattern, 'not the white flag\'s pair of whites').not.toContain(WHITE_FLAG_SHADE);
    expect(one.label).toBe('1 lap to green');
    expect(one.context).toBe('Green flag next lap — be ready');
    expect(one.base).toMatch(/^rgba?\(15, 15, 15(, 1)?\)$/);

    // The white flag is the last lap, and is not this.
    await serve(page, RACE({ flag: 'white', sessionFlags: WHITE }));
    const white = await look(page);
    expect(white.flag).toBe('white');
    expect(white.label).toBe('Last lap');
    expect(white.pattern).toContain(WHITE_FLAG_SHADE);
    expect(white.pattern).not.toContain(CAUTION_STRIPE);
  });

  test('green held after a caution is shown as the green, and says green held', async ({ page }) => {
    test.setTimeout(60000);
    await openAt(page, 1180, 820, RACE({ flag: 'yellow', sessionFlags: CAUTION }));
    await serve(page, RACE({ flag: 'green', sessionFlags: GREEN | GREEN_HELD }));
    const held = await look(page);
    expect(held.flag).toBe('greenheld');
    expect(held.gapsClass).toBe('flag-greenheld');
    expect(held.label).toBe('Green held');
    expect(held.context).toBe('Green flag held — racing resumes');
    expect(held.pattern).toContain('rgb(29, 175, 53)');        // hsl(130, 72%, 40%), the flag's green
    expect(held.tint).toContain('rgba(60, 200, 90, 0.34)');   // the glass takes the green of the flag

    // And on to a plain green: shown as green for what is left of its five seconds, and then steady green is not shown, as ever.
    await serve(page, RACE({ flag: 'green', sessionFlags: GREEN }));
    expect((await look(page)).flag).toBe('green');
    await expect.poll(async () => (await look(page)).flag, { timeout: 9000 }).toBe('none');
  });

  test('the black flag furled is a warning (a grey ring, the panels alone); the black flag itself is not it', async ({ page }) => {
    test.setTimeout(60000);
    await openAt(page, 1180, 820, RACE());
    const none = await look(page);
    await serve(page, RACE({ flag: 'none', sessionFlags: FURLED }));
    const furled = await look(page);
    expect(furled.flag, 'the one word leaves it out').toBe('furled');
    expect(furled.gapsClass).toBe('flag-furled');
    expect(furled.label).toBe('Black flag warning');
    expect(furled.context).toBe('Warning — a black flag may follow');
    expect(furled.tint, 'a warning rings the screen and leaves the panels').toBe(none.tint);
    expect(furled.banner).toEqual(['Black flag warning', 'Warning — a black flag may follow']);
    expect(furled.bannerClass).toContain('rc-flag-furled');
    expect(furled.pattern).toContain('rgb(148, 148, 148)');   // hsl(0, 0%, 58%)

    await serve(page, RACE({ flag: 'black', sessionFlags: BLACK | FURLED }));
    const black = await look(page);
    expect(black.flag).toBe('black');
    expect(black.label).toBe('Black flag');
    expect(black.banner?.[0]).toBe('Black flag');
  });

  test('disqualified is a state of its own, black and deep red, with its own banner', async ({ page }) => {
    test.setTimeout(60000);
    await openAt(page, 1180, 820, RACE());
    await serve(page, RACE({ flag: 'black', sessionFlags: DISQUALIFY | BLACK }));
    const dq = await look(page);
    expect(dq.flag).toBe('disqualify');
    expect(dq.gapsClass).toBe('flag-disqualify');
    expect(dq.label).toBe('Disqualified');
    expect(dq.context).toBe('Disqualified — return to the pits');
    expect(dq.tint).toContain('rgba(225, 25, 25, 0.34)');
    expect(dq.banner).toEqual(['Disqualified', 'Disqualified — return to the pits']);
    expect(dq.bannerClass).toContain('rc-flag-disqualify');
  });
});

test.describe('the values his own recordings have: no flag all through practice and on the grid, the chequered flag through the cool-down', () => {
  // SessionFlags as iRacing wrote it (the service bit 0x40000 and the start lights' 0x10000000 are in every real frame).
  const PRACTICE = (over = {}) => frame({ order: fieldWith(4), state: 4, mode: 1, session: 'Practice', start: 0, lap: 3, ...over });
  const QUALI = (over = {}) => frame({ order: fieldWith(4), state: 4, mode: 2, session: 'Qualify', start: 0, lap: 3, ...over });
  const nothing = (l, where) => {
    expect(l.flag, `${where}: no flag`).toBe('none');
    expect(l.active, `${where}: the gaps block is the gaps`).toBe(false);
    expect(l.gapsClass, where).toBe('');
    expect(l.opacity, `${where}: no background`).toBe('0');
    expect(l.banner, `${where}: race control has nothing to say`).toBeNull();
  };
  const finish = (page) => page.evaluate(() => ({ up: _raceEndVisible, shown: document.getElementById('raceEndScreen').classList.contains('re-visible') }));

  test('a practice session (0x10040200, every frame of it) shows no flag: the glance layout is as if nothing were out', async ({ page }) => {
    test.setTimeout(60000);
    await openAt(page, 1180, 820, PRACTICE({ flag: 'none', sessionFlags: 0x10040200 }));
    nothing(await look(page), 'practice');
    await serve(page, PRACTICE({ flag: 'none', sessionFlags: 0x10000200 }));
    nothing(await look(page), 'the first seconds, before the service bit');
    // The glance layout's own words are not in it anywhere.
    expect(await page.evaluate(() => document.body.innerText.toUpperCase().includes('LAP TO GREEN'))).toBe(false);
  });

  test('the black flag furled in practice (0x100c0200) is the warning, and the 0x200 beside it is not a flag', async ({ page }) => {
    test.setTimeout(60000);
    await openAt(page, 1180, 820, PRACTICE({ flag: 'none', sessionFlags: 0x10040200 }));
    await serve(page, PRACTICE({ flag: 'none', sessionFlags: 0x100c0200 }));
    const furled = await look(page);
    expect(furled.flag).toBe('furled');
    expect(furled.label).toBe('Black flag warning');
  });

  test('the grid, the warm-up and the parade show no flag, and the start after them is the start and not a flag', async ({ page }) => {
    test.setTimeout(90000);
    await openAt(page, 1180, 820, RACE({ state: 1, flag: 'none', sessionFlags: 0x10040200 }));
    nothing(await look(page), 'the grid');
    for (const [state, flags, where] of [[2, 0x20040200, 'lights ready'], [2, 0x40040200, 'lights set'], [3, 0x20040200, 'the parade'],
      [3, 0x20040600, 'the end of the parade (green held, 0x200)'], [4, 0x80040604, 'the start, lights go'], [4, 0x80040004, 'the start, green']]) {
      await serve(page, RACE({ state, flag: (flags & 0x4) ? 'green' : 'none', sessionFlags: flags }));
      nothing(await look(page), where);
    }
  });

  test('the cool-down (0x10040201) keeps the chequered flag and the finish screen; a yellow waved after the flag (0x10040101) does not take them', async ({ page }) => {
    test.setTimeout(90000);
    await openAt(page, 1180, 820, RACE({ state: 4, flag: 'none', sessionFlags: 0x10040000 }));
    await serve(page, RACE({ state: 5, flag: 'checkered', sessionFlags: 0x10040001 }));
    const flag = await look(page);
    expect(flag.flag).toBe('checkered');
    expect(flag.label).toBe('Finish');
    expect(flag.banner?.[0]).toBe('Checkered flag');
    expect(await finish(page), 'the finish screen is up').toEqual({ up: true, shown: true });

    await serve(page, RACE({ state: 5, flag: 'checkered', sessionFlags: 0x10040101 }));
    expect((await look(page)).flag, 'a yellow waved after the flag').toBe('checkered');
    expect(await finish(page)).toEqual({ up: true, shown: true });

    await serve(page, RACE({ state: 6, flag: 'checkered', sessionFlags: 0x10040201 }));
    const cool = await look(page);
    expect(cool.flag, 'the cool-down: the chequered flag is still out, with 0x200 beside it').toBe('checkered');
    expect(cool.label).toBe('Finish');
    expect(await finish(page), 'the finish screen stays up').toEqual({ up: true, shown: true });
  });

  test('a lone qualifying ends with the chequered flag (0x10040201 at SessionState 4 and 5), which is shown', async ({ page }) => {
    test.setTimeout(60000);
    await openAt(page, 1180, 820, QUALI({ flag: 'none', sessionFlags: 0x10040200 }));
    nothing(await look(page), 'qualifying, lapping');
    await serve(page, QUALI({ flag: 'checkered', sessionFlags: 0x10040201 }));
    const l = await look(page);
    expect(l.flag).toBe('checkered');
    expect(l.label).toBe('Finish');
  });
});

test.describe('a local yellow is held for at least three seconds from when it comes up, and is gone when it clears after that', () => {
  test('cleared after a blink it stays on show to the end of its three seconds; up for longer it goes the moment it clears', async ({ page }) => {
    test.setTimeout(60000);
    await openAt(page, 1180, 820, RACE({ flag: 'none', sessionFlags: 0 }));
    expect((await look(page)).flag).toBe('none');

    payload = RACE({ flag: 'yellow', sessionFlags: LOCAL_YELLOW });
    await frames(page, 8);
    expect((await look(page)).flag).toBe('localyellow');
    payload = RACE({ flag: 'none', sessionFlags: 0 });
    await frames(page, 8);
    expect((await look(page)).flag, 'cleared a moment later: the minimum from its onset has not run out').toBe('localyellow');
    await expect.poll(async () => (await look(page)).flag, { timeout: 8000 }).toBe('none');

    payload = RACE({ flag: 'yellow', sessionFlags: LOCAL_YELLOW });
    await frames(page, 8);
    expect((await look(page)).flag).toBe('localyellow');
    await page.waitForTimeout(3400);
    payload = RACE({ flag: 'none', sessionFlags: 0 });
    await frames(page, 8);
    expect((await look(page)).flag, 'up for longer than the three seconds, it is not held again after it clears').toBe('none');
  });
});

test.describe('the small notices are said once, in the spotter\'s card', () => {
  // (the spotter's own calls, about the cars ahead and behind, share the stack: these are the flags' cards)
  const cards = (page) => page.evaluate(() => [...document.querySelectorAll('#spotterStack .sp-inner')]
    .filter((c) => (c.dataset.spotCat || '').startsWith('flag-'))
    .map((c) => [c.dataset.spotCat, c.querySelector('.sp-message').textContent, c.querySelector('.sp-header').textContent]));

  test('ten to go, five to go and halfway come up as a card each, and leave the flag alone', async ({ page }) => {
    test.setTimeout(60000);
    await openAt(page, 1180, 820, RACE({ flag: 'none', sessionFlags: 0 }));
    expect(await cards(page)).toEqual([]);

    await serve(page, RACE({ flag: 'none', sessionFlags: HALFWAY }));
    expect(await cards(page)).toEqual([['flag-crossed', 'Halfway', 'Race control']]);
    expect((await look(page)).flag, 'a notice is not a flag').toBe('none');

    await serve(page, RACE({ flag: 'none', sessionFlags: TEN }));
    expect((await cards(page)).map((c) => c[1]).sort()).toEqual(['10 laps to go', 'Halfway']);

    await serve(page, RACE({ flag: 'none', sessionFlags: FIVE }));
    expect((await cards(page)).map((c) => c[1]).sort()).toEqual(['10 laps to go', '5 laps to go', 'Halfway']);
    expect((await look(page)).flag).toBe('none');
  });

  test('a payload with no field says none of it', async ({ page }) => {
    await openAt(page, 1180, 820, RACE({ flag: 'none' }));
    await serve(page, RACE({ flag: 'green' }));
    expect(await cards(page)).toEqual([]);
  });
});

test.describe('with no field in the payload the HUD is as it was, from the one word', () => {
  test('each word draws what it drew: a yellow is the caution\'s look and sentence, a white the last lap, the orange a lapped car', async ({ page }) => {
    test.setTimeout(90000);
    await openAt(page, 1180, 820, RACE());
    const words = { yellow: ['yellow', 'Caution', 'Full course caution — hold position'], blue: ['blue', 'Blue flag', 'Faster car approaching — yield'],
      white: ['white', 'Last lap', 'Last lap — push to the line'], debris: ['debris', 'Debris', 'Debris on track — stay alert'],
      meatball: ['meatball', 'Meatball', 'Repair required — pit immediately'], orange: ['orange', 'Lapped car', 'Car ahead must yield — make the pass'],
      red: ['red', 'Red flag', 'Session stopped — return to pits'], black: ['black', 'Black flag', 'Penalty — report to pit lane'] };
    for (const [word, [flag, label, context]] of Object.entries(words)) {
      await serve(page, RACE({ flag: word }));
      const l = await look(page);
      expect(l.flag, word).toBe(flag);
      expect(l.label, word).toBe(label);
      expect(l.context, word).toBe(context);
    }
  });

  test('a key that is not a flag field is not one: the word decides', async ({ page }) => {
    test.setTimeout(60000);
    await openAt(page, 1180, 820, RACE({ flag: 'yellow', sessionFlags: null }));
    for (const junk of ['', true, 'caution', 1.5, -5000000000, null]) {
      await serve(page, RACE({ flag: 'yellow', extra: { 'DataCorePlugin.GameRawData.Telemetry.SessionFlags': junk } }));
      expect((await look(page)).flag, JSON.stringify(junk)).toBe('yellow');
    }
  });

  test('the field is believed over the word: a sim that says nothing is out is nothing out; a lapped car is kept', async ({ page }) => {
    test.setTimeout(60000);
    await openAt(page, 1180, 820, RACE({ flag: 'orange', sessionFlags: 0 }));
    expect((await look(page)).flag, 'the word says a car ahead is being lapped, which is not in the field').toBe('orange');
    await serve(page, RACE({ flag: 'yellow', sessionFlags: 0 }));
    await expect.poll(async () => (await look(page)).flag, { timeout: 9000 }).toBe('none');
  });
});

test.describe('the start lights, from the field, on the grid', () => {
  const lights = (page) => page.evaluate(() => ({
    active: document.getElementById('startLights').classList.contains('lights-active'),
    bulbs: ['light1t', 'light3b', 'light5t'].map((id) => document.getElementById(id).className.replace('light-bulb', '').trim()),
    go: document.getElementById('lightsGo').classList.contains('go-visible'),
  }));

  test('set is the lights all red and go the green; ready, and a frame with no field, draw none', async ({ page }) => {
    test.setTimeout(60000);
    // On the grid: the parade laps (SessionState 3).
    await openAt(page, 1180, 820, RACE({ state: 3, flag: 'none' }));
    expect((await lights(page)).active).toBe(false);

    await serve(page, RACE({ state: 3, flag: 'none', sessionFlags: 0x20000000 }));
    expect((await lights(page)).active, 'ready: the lights are coming').toBe(false);

    await serve(page, RACE({ state: 3, flag: 'none', sessionFlags: 0x40000000 }));
    expect(await lights(page)).toEqual({ active: true, bulbs: ['lit-red', 'lit-red', 'lit-red'], go: false });

    await serve(page, RACE({ state: 4, flag: 'green', sessionFlags: 0x80000000 | GREEN }));
    expect(await lights(page)).toEqual({ active: true, bulbs: ['lit-green', 'lit-green', 'lit-green'], go: true });
  });
});

test.describe('the wording fits: nothing cut off at the smallest cells', () => {
  for (const [width, height] of [[744, 1133], [1024, 768], [1180, 820], [1920, 1080]]) {
    test(`${width}x${height}: the gaps block's words and race control's sentence are read whole for each new state`, async ({ page }) => {
      test.setTimeout(90000);
      await openAt(page, width, height, RACE());
      const states = [['a local yellow', LOCAL_YELLOW], ['a caution', CAUTION], ['one to green', CAUTION | ONE_TO_GREEN],
        ['green held', GREEN | GREEN_HELD], ['furled', FURLED], ['disqualified', DISQUALIFY]];
      for (const [name, flags] of states) {
        await serve(page, RACE({ flag: 'none', sessionFlags: flags }));
        const m = await page.evaluate(() => {
          const box = document.getElementById('gapsBlock').getBoundingClientRect();
          const cut = [];
          for (const id of ['flagLabel1', 'flagCtx1']) {
            const el = document.getElementById(id);
            const range = document.createRange();
            range.selectNodeContents(el);
            for (const q of range.getClientRects()) {
              if (q.left < box.left - 1 || q.right > box.right + 1 || q.top < box.top - 1 || q.bottom > box.bottom + 1) cut.push(`${id} ${Math.round(q.left)}-${Math.round(q.right)} x ${Math.round(q.top)}-${Math.round(q.bottom)}`);
            }
          }
          const banner = document.getElementById('rcBanner');
          const detail = document.getElementById('rcDetail');
          const content = banner.querySelector('.rc-content').getBoundingClientRect();
          const bannerCut = [];
          for (const id of ['rcTitle', 'rcDetail']) {
            const range = document.createRange();
            range.selectNodeContents(document.getElementById(id));
            for (const q of range.getClientRects()) if (q.left < content.left - 1 || q.right > content.right + 1) bannerCut.push(id);
          }
          return { cut, bannerShown: banner.classList.contains('rc-visible'), bannerCut, wider: detail.scrollWidth > detail.clientWidth + 1 };
        });
        expect(m.cut, `${width}x${height}, ${name}: the gaps block's words are inside it`).toEqual([]);
        if (m.bannerShown) {
          expect(m.bannerCut, `${width}x${height}, ${name}: the banner is read whole`).toEqual([]);
          expect(m.wider, `${width}x${height}, ${name}: the banner's sentence is not wider than its box`).toBe(false);
        }
      }
    });
  }
});

test.describe('the rig\'s own HUD says the same in its gaps block', () => {
  test('a local yellow and a full-course caution in the gaps block of the HUD itself, from the file', async ({ page, context }) => {
    test.setTimeout(60000);
    const hud = await context.newPage();
    let body = RACE({ flag: 'yellow', sessionFlags: LOCAL_YELLOW });
    await hud.route(/^https?:\/\/(?!localhost:8889)/, (route) => route.abort());
    await hud.route('http://localhost:8889/racing-desk/', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }));
    await hud.setViewportSize({ width: 1920, height: 1080 });
    await hud.goto(pathToFileURL(path.join(OVERLAY, 'dashboard.html')).href);
    await hud.evaluate(() => { _settings.showWebGL = false; });
    await hud.waitForFunction(() => typeof _isIdle !== 'undefined' && _isIdle === false && _pollFrame > 6, null, { timeout: 10000 });
    const say = () => hud.evaluate(() => ({
      cls: [...document.getElementById('gapsBlock').classList].filter((c) => c.startsWith('flag-') && c !== 'flag-active').join(' '),
      label: document.getElementById('flagLabel1').textContent, context: document.getElementById('flagCtx1').textContent,
      drive: document.body.classList.contains('drive-mode-active'),
    }));
    await expect.poll(async () => (await say()).cls, { timeout: 8000 }).toBe('flag-localyellow');
    expect(await say()).toEqual({ cls: 'flag-localyellow', label: 'Local yellow', context: 'Local yellow — slow in this sector', drive: false });

    body = RACE({ flag: 'yellow', sessionFlags: CAUTION });
    await expect.poll(async () => (await say()).cls, { timeout: 8000 }).toBe('flag-caution');
    expect(await say()).toEqual({ cls: 'flag-caution', label: 'Caution', context: 'Full course caution — hold position', drive: false });
    await hud.close();
  });

  test('every label is centred in the gaps block, the long ones that wrap to two lines as much as the short ones', async ({ page, context }) => {
    test.setTimeout(90000);
    const hud = await context.newPage();
    let body = RACE({ flag: 'yellow', sessionFlags: LOCAL_YELLOW });
    await hud.route(/^https?:\/\/(?!localhost:8889)/, (route) => route.abort());
    await hud.route('http://localhost:8889/racing-desk/', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }));
    await hud.setViewportSize({ width: 1920, height: 1080 });
    await hud.goto(pathToFileURL(path.join(OVERLAY, 'dashboard.html')).href);
    await hud.evaluate(() => { _settings.showWebGL = false; });
    await hud.waitForFunction(() => typeof _isIdle !== 'undefined' && _isIdle === false && _pollFrame > 6, null, { timeout: 10000 });
    const label = () => hud.evaluate(() => document.getElementById('flagLabel1').textContent);
    // Where each line of the label and of the sentence under it sits in the block: the gap to its left edge and to its right.
    const lines = () => hud.evaluate(() => {
      const box = document.getElementById('gapsBlock').getBoundingClientRect();
      const out = { width: Math.round(box.width), label: [], context: [], align: getComputedStyle(document.getElementById('flagLabel1')).textAlign };
      for (const [key, id] of [['label', 'flagLabel1'], ['context', 'flagCtx1']]) {
        const range = document.createRange();
        range.selectNodeContents(document.getElementById(id));
        for (const q of range.getClientRects()) out[key].push({ left: q.left - box.left, right: box.right - q.right, top: q.top - box.top, bottom: box.bottom - q.bottom });
      }
      return out;
    });

    // Each state comes after another flag (a green held is only shown after one), so the order matters.
    const STATES = [
      ['Local yellow', RACE({ flag: 'yellow', sessionFlags: LOCAL_YELLOW })],
      ['Caution', RACE({ flag: 'yellow', sessionFlags: CAUTION })],
      ['1 lap to green', RACE({ flag: 'yellow', sessionFlags: CAUTION | ONE_TO_GREEN })],
      ['Black flag warning', RACE({ flag: 'none', sessionFlags: FURLED })],
      ['Disqualified', RACE({ flag: 'black', sessionFlags: DISQUALIFY | BLACK })],
      ['Green held', RACE({ flag: 'green', sessionFlags: GREEN | GREEN_HELD })],
      ['Last lap', RACE({ flag: 'white', sessionFlags: WHITE })],
      ['Black flag', RACE({ flag: 'black', sessionFlags: BLACK })],
      ['Lapped car', RACE({ flag: 'orange' })],   // the one word alone, as before
    ];
    for (const [text, next] of STATES) {
      body = next;
      await expect.poll(label, { timeout: 8000, message: text }).toBe(text);
      const m = await lines();
      expect(m.align, `${text}: the label is centred`).toBe('center');
      expect(m.label.length, text).toBeGreaterThan(0);
      for (const key of ['label', 'context']) {
        for (const q of m[key]) {
          expect(q.left, `${text} (${key}) is inside the block on the left`).toBeGreaterThanOrEqual(-1);
          expect(q.right, `${text} (${key}) is inside the block on the right`).toBeGreaterThanOrEqual(-1);
          // Every line has the same room either side (the letters' own spacing after the last is about a pixel and a half).
          expect(Math.abs(q.left - q.right), `${text} (${key}): ${Math.round(q.left)}px from the left edge, ${Math.round(q.right)}px from the right, in a block ${m.width}px wide`).toBeLessThanOrEqual(4);
          expect(q.top, `${text} (${key}) is inside the block at the top`).toBeGreaterThanOrEqual(-1);
          expect(q.bottom, `${text} (${key}) is inside the block at the bottom`).toBeGreaterThanOrEqual(-1);
        }
      }
    }
    await hud.close();
  });
});
