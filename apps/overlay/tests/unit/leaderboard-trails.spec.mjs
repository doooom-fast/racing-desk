/**
 * The leaderboard's sparklines: each car's place through the race (modules/js/leaderboard.js), on the real
 * dashboard.html, headless, fed frames as the plugin would send them, in one page load.
 *
 * What was wrong: his own line was the history of "position" for as long as the page stayed loaded, and the HUD's
 * page stays loaded through a whole event. In practice and qualifying "position" is the order of best laps, so the
 * line of a race began with the ranks of the sessions before it (a Bathurst race he gained a place in, P11 to P10,
 * drew [2 3 4 5 6 7 8 9 10 11 10]: a staircase down across the whole width and one step up at the end), and it kept
 * only the last twelve changes, so a race with many changes lost its start. Every other row plotted the car's last
 * laps, not its places, so a car gaining places on slower laps drew a line falling. The line is now the car's
 * places through the race in hand: one trail per car, from its grid slot, recorded only in a race, the better place
 * higher, and P1 the top.
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { frame, fieldWith, ME, FIELD } from '../frames.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD = pathToFileURL(path.resolve(__dirname, '..', '..', 'dashboard.html')).href;

const GREEN = 'hsla(145,75%,50%,1)';
const RED = 'hsla(0,75%,50%,1)';

// The dashboard over a plugin that serves whatever it was last given. No port is reached.
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
  // The WebGL effects are not what this is about, and a headless browser draws them in software at a dozen frames a
  // second, which is the time a frame of these takes to be drawn.
  await page.evaluate(() => { _settings.showWebGL = false; });
  // In the car (the page finds that out from the first frame it is given), and drawing.
  await page.waitForFunction(() => typeof _isIdle !== 'undefined' && _isIdle === false && _pollFrame > 3, null, { timeout: 10000 });
  await settle(page);
}

// A few frames drawn: what the page was given is what it has drawn.
async function settle(page) {
  const before = await page.evaluate(() => _pollFrame);
  await page.waitForFunction((n) => _pollFrame >= n + 4, before, { timeout: 5000 });
}

async function show(page, payload) {
  await page.evaluate((p) => { window.__feed.payload = p; }, payload);
  await settle(page);
}

// Every frame of a list, one after the other (each is drawn before the next is given).
async function play(page, frames) {
  for (const f of frames) await show(page, f);
}

// Frames straight into the leaderboard as fast as it takes them, for a race of many changes: the page's own poll
// would take a fifth of a second over each. What it goes on being given is the last of them.
async function pump(page, frames) {
  await page.evaluate((list) => {
    window.__feed.payload = list[list.length - 1];
    for (const f of list) { window._lbLastJson = ''; updateLeaderboard(f); }
  }, frames);
  await settle(page);
}

// The trail of a car, as the places it holds.
const places = (page, name) => page.evaluate((n) => { const t = _trails.get(n); return t ? t.pts.map((p) => p[1]) : []; }, name);

// The line a row draws: its points, the hairline where the race began, the colour. Null when the row draws none.
// `name` is the driver as the row says it ("A. Alpha": first initial and last name; his own is "Test Driver").
function line(page, name) {
  return page.evaluate((n) => {
    const row = [...document.querySelectorAll('#lbRows .lb-row')].find((r) => r.querySelector('.lb-name').textContent.startsWith(n));
    if (!row) return { missing: true };
    const svg = row.querySelector('.lb-spark');
    if (svg.style.display === 'none') return null;
    const poly = svg.querySelector('polyline');
    const pts = poly.getAttribute('points').trim().split(/\s+/).map((p) => p.split(',').map(Number));
    return {
      pts,
      first: pts[0][1],
      last: pts[pts.length - 1][1],
      start: +svg.querySelector('.lb-spark-start').getAttribute('y1'),
      color: poly.getAttribute('stroke'),
    };
  }, name);
}
// How many rows draw a line at all.
const drawn = (page) => page.evaluate(() => [...document.querySelectorAll('#lbRows .lb-row .lb-spark')].filter((s) => s.style.display !== 'none').length);

// The player's row is the driver's own, whatever the name the page gives it.
const mine = (page) => page.evaluate(() => {
  const row = document.querySelector('#lbRows .lb-row.lb-player');
  if (!row) return { missing: true };
  const svg = row.querySelector('.lb-spark');
  if (svg.style.display === 'none') return null;
  const poly = svg.querySelector('polyline');
  const pts = poly.getAttribute('points').trim().split(/\s+/).map((p) => p.split(',').map(Number));
  return { pts, first: pts[0][1], last: pts[pts.length - 1][1], start: +svg.querySelector('.lb-spark-start').getAttribute('y1'), color: poly.getAttribute('stroke') };
});

// One frame of the driver at a place, in whichever session.
const at = (place, over = {}) => frame({ order: fieldWith(place), ...over });

// Practice → qualifying → race in one page load, with his own places as the .ibt of his Bathurst race read them:
// practice P2 to P6 as others set faster laps; qualifying P7 to P10; the race from the grid slot P11, none for the
// first seconds after the green, then P11, and P10 from lap seven to the flag.
const practice = [2, 3, 4, 5, 6].map((p, i) => at(p, { session: 'Practice', mode: 1, state: 4, start: 2, lap: i + 1 }));
const qualifying = [7, 8, 9, 10].map((p, i) => at(p, { session: 'Qualify', mode: 2, state: 4, start: 7, lap: i + 1 }));
const grid = [1, 2, 3].map((state) => at(11, { mode: 4, state, start: 0, lap: 1 }));
const race = [
  at(11, { state: 4, start: 0, noPlaces: true, lap: 1 }),
  at(11, { state: 4, start: 11, lap: 1 }),
  at(11, { state: 4, start: 11, lap: 2 }),
  at(10, { state: 4, start: 11, lap: 7 }),
  at(10, { state: 5, start: 11, lap: 12 }),
];

test.describe('his own line, through a whole event in one page load', () => {
  test('practice and qualifying draw no line, and the race starts from the grid and goes up when he does', async ({ page }) => {
    await open(page, practice[0]);
    await play(page, practice.slice(1));
    // Out of a race "position" is the order of best laps, and it is not what the line is of.
    expect(await drawn(page)).toBe(0);
    expect(await page.evaluate(() => _trails.size)).toBe(0);

    await play(page, qualifying);
    expect(await drawn(page)).toBe(0);
    expect(await page.evaluate(() => _trails.size)).toBe(0);

    // Warm-up and the parade laps: nothing is recorded before the green flag either.
    await play(page, grid);
    expect(await page.evaluate(() => _trails.size)).toBe(0);

    // The first seconds after the green: no place for anyone yet.
    await show(page, race[0]);
    expect(await places(page, ME)).toEqual([]);
    expect(await drawn(page)).toBe(0);

    // The places arrive, in grid order: his line begins at P11, flat, and does not begin in a session before.
    await show(page, race[1]);
    expect(await places(page, ME)).toEqual([11]);
    await show(page, race[2]);
    expect(await places(page, ME)).toEqual([11]);
    const flat = await mine(page);
    expect(flat.first).toBe(flat.last);
    expect(flat.start).toBeCloseTo(flat.first, 1);

    // He gains a place: the line steps up (a smaller number is drawn higher: P1 is the top) and is green.
    await show(page, race[3]);
    expect(await places(page, ME)).toEqual([11, 10]);
    const up = await mine(page);
    expect(up.last).toBeLessThan(up.first);
    expect(up.last).toBeLessThan(up.start);   // above the hairline where the race began: places gained
    expect(up.color).toBe(GREEN);

    await show(page, race[4]);
    expect(await places(page, ME)).toEqual([11, 10]);
    expect((await mine(page)).last).toBeLessThan((await mine(page)).first);
  });

  // His Zandvoort race of 2026-09-29, as its .ibt has his places, in the one page load it was driven in: qualifying
  // ended P19; the race began from the grid slot P18, went to P22 on the first lap, and back to P20 by lap 5, where he
  // finished. The line used to begin with the qualifying rank.
  test('Zandvoort: the line begins at his grid slot, not his qualifying rank, and shows the first lap\'s drop and the climb', async ({ page }) => {
    // Twenty-two cars, as there were.
    const z = (place, over = {}) => frame({ order: fieldWith(place, [...FIELD, 'Uri Uniform']), ...over });
    await open(page, z(19, { session: 'Qualify', mode: 2, state: 4, start: 19, lap: 2 }));
    await play(page, [1, 2, 3].map((state) => z(19, { mode: 4, state, start: 0, lap: 1 })));
    await play(page, [
      z(18, { state: 4, start: 0, noPlaces: true, lap: 1 }),
      z(18, { state: 4, start: 18, lap: 1 }),
      z(20, { state: 4, start: 18, lap: 1 }), z(21, { state: 4, start: 18, lap: 1 }), z(22, { state: 4, start: 18, lap: 1 }),
      z(21, { state: 4, start: 18, lap: 3 }), z(20, { state: 4, start: 18, lap: 6 }), z(20, { state: 5, start: 18, lap: 13 }),
    ]);
    expect(await places(page, ME)).toEqual([18, 20, 21, 22, 21, 20]);
    const shown = await mine(page);
    // Lower than the start at the finish (two places lost, net), and higher than its lowest (two regained): red.
    expect(shown.last).toBeGreaterThan(shown.start);
    expect(Math.max(...shown.pts.map((p) => p[1]))).toBeGreaterThan(shown.last);
    expect(shown.color).toBe(RED);
  });

  // His most recent race, Tsukuba on 2026-09-29 (an MX-5, .ibt 22-13-03), in the one page load it was driven in: a
  // qualifying that gave him P1 to P6, then a race from P8 that went P4 on the first lap, back to P9, and ended P6 —
  // two places gained. The line the HUD drew for it was [2 3 4 5 6 8 4 5 6 7 9 6]: the qualifying's ranks first, and a
  // line that ended below the height it began at although he had gained two places.
  test('Tsukuba: two places gained draws a line that ends above where it began, in green, from the grid slot', async ({ page }) => {
    await open(page, at(1, { session: 'Lone Qualify', mode: 2, state: 4, start: 1, lap: 1 }));
    await play(page, [2, 3, 4, 5, 6].map((p, i) => at(p, { session: 'Lone Qualify', mode: 2, state: 4, start: 1, lap: 2 + i })));
    await play(page, [1, 2, 3].map((state) => at(6, { mode: 4, state, start: 0, lap: 1 })));
    await play(page, [
      at(8, { state: 4, start: 0, noPlaces: true, lap: 1 }),
      at(8, { state: 4, start: 8, lap: 1 }), at(4, { state: 4, start: 8, lap: 1 }), at(5, { state: 4, start: 8, lap: 1 }),
      at(6, { state: 4, start: 8, lap: 1 }), at(7, { state: 4, start: 8, lap: 1 }), at(9, { state: 4, start: 8, lap: 1 }),
      at(6, { state: 4, start: 8, lap: 3 }), at(6, { state: 5, start: 8, lap: 12 }),
    ]);
    expect(await places(page, ME)).toEqual([8, 4, 5, 6, 7, 9, 6]);
    const shown = await mine(page);
    expect(shown.last).toBeLessThan(shown.start);   // ends above the hairline where the race began: places gained
    expect(shown.color).toBe(GREEN);
    // Its highest is P4 and its lowest P9, and it is drawn between them: the scale is his own range in the race.
    expect(Math.min(...shown.pts.map((p) => p[1]))).toBeLessThan(shown.last);
    expect(Math.max(...shown.pts.map((p) => p[1]))).toBeGreaterThan(shown.start);
  });

  test('a place lost is drawn lower, in red, below the hairline', async ({ page }) => {
    await open(page, at(8, { state: 4, start: 8 }));
    await play(page, [at(9, { start: 8 }), at(10, { start: 8 }), at(9, { start: 8 }), at(10, { start: 8 })]);
    expect(await places(page, ME)).toEqual([8, 9, 10, 9, 10]);
    const down = await mine(page);
    expect(down.last).toBeGreaterThan(down.start);
    expect(down.color).toBe(RED);
  });

  test('the start is never dropped, however many places change', async ({ page }) => {
    await open(page, at(12, { start: 12 }));
    // 25 changes: more than the twelve the line used to keep.
    const wander = Array.from({ length: 25 }, (_, i) => 12 + (i % 2 === 0 ? -1 : 1) * (1 + (i % 3)));
    await pump(page, wander.map((p, i) => at(p, { start: 12, lap: 2 + i })));
    const held = await places(page, ME);
    expect(held[0]).toBe(12);
    expect(held.length).toBeGreaterThan(12);
    const shape = await mine(page);
    // A line from the start: the hairline is at the height the line began at.
    expect(shape.start).toBeCloseTo(shape.first, 1);
  });

  test('past its limit the oldest change after the start goes, and the start stays', async ({ page }) => {
    await open(page, at(12, { start: 12 }));
    const many = Array.from({ length: 80 }, (_, i) => (i % 2 === 0 ? 11 : 13));
    await pump(page, many.map((p, i) => at(p, { start: 12, lap: 2 + i })));
    const held = await places(page, ME);
    expect(held.length).toBe(64);
    expect(held[0]).toBe(12);
    expect(held[held.length - 1]).toBe(13);
  });
});

test.describe('every other row is that car\'s places too, not its laps', () => {
  // The car that begins at P12 climbs to P6 on laps that get slower: what it was last plotted as falling.
  const climb = (fromPlace, toPlace) => {
    const base = fieldWith(9);
    const name = base[fromPlace - 1];
    const frames = [];
    for (let place = fromPlace, step = 0; place >= toPlace; place--, step++) {
      const order = base.filter((n) => n !== name);
      order.splice(place - 1, 0, name);
      frames.push(frame({ order, lap: 2 + step, state: 4, start: 9, lastLaps: { [name]: 92 + step * 0.4 } }));
    }
    return { name, frames };
  };

  test('a car that climbs on slower laps draws a rising line', async ({ page }) => {
    const { name, frames } = climb(12, 7);
    await open(page, frames[0]);
    await play(page, frames.slice(1));
    expect(await places(page, name)).toEqual([12, 11, 10, 9, 8, 7]);
    const [first, last] = name.split(' ');
    const shown = await line(page, `${first[0]}. ${last}`);
    expect(shown, 'the climber is in view').not.toBeNull();
    expect(shown.missing).toBeUndefined();
    expect(shown.last).toBeLessThan(shown.first);
    expect(shown.color).toBe('hsla(0,0%,100%,0.35)');
  });

  test('a car that loses places draws a falling line', async ({ page }) => {
    const base = fieldWith(9);
    const name = base[6];   // P7
    const frames = [7, 8, 9, 10].map((place, step) => {
      const order = base.filter((n) => n !== name);
      order.splice(place - 1, 0, name);
      return frame({ order, lap: 2 + step, state: 4, start: 9, lastLaps: { [name]: 91 - step * 0.4 } });
    });
    await open(page, frames[0]);
    await play(page, frames.slice(1));
    const [first, last] = name.split(' ');
    const shown = await line(page, `${first[0]}. ${last}`);
    expect(shown.last).toBeGreaterThan(shown.first);
  });

  test('a car out of view has its history when it comes into view', async ({ page }) => {
    // Twenty-one cars and ten rows: the car at P1 is not on show while he runs P18, and it is followed all the
    // same, so that its line is there when it is.
    const front = 'Alex Alpha';
    const back = fieldWith(18);
    const swap = (order, a, b) => { const o = order.slice(); const i = o.indexOf(a), j = o.indexOf(b); [o[i], o[j]] = [o[j], o[i]]; return o; };
    const frames = [
      frame({ order: back, state: 4, start: 18 }),
      frame({ order: swap(back, front, back[1]), state: 4, start: 18, lap: 6 }),
      frame({ order: swap(swap(back, front, back[1]), front, back[2]), state: 4, start: 18, lap: 7 }),
    ];
    await open(page, frames[0]);
    expect((await line(page, 'A. Alpha')).missing).toBe(true);   // not on show
    await play(page, frames.slice(1));
    expect((await line(page, 'A. Alpha')).missing).toBe(true);
    expect(await places(page, front)).toEqual([1, 2, 3]);
    // He climbs to where it is: it comes on show, drawn from the start of the race, not from when it appeared.
    const near = frame({ order: fieldWith(4, swap(swap(back, front, back[1]), front, back[2]).filter((n) => n !== ME)), state: 4, start: 18, lap: 8 });
    await show(page, near);
    const shown = await line(page, 'A. Alpha');
    expect(shown.missing).toBeUndefined();
    expect(shown.pts.length).toBeGreaterThan(4);   // more than a flat line: it has moved
  });
});

test.describe('which race a trail belongs to', () => {
  // The cool-down is when he looks back at how his race went. The lines were hidden by the next render after the
  // chequered flag (a gap changes every frame, so that render comes at once), and would have been stretched across the
  // clock as it went on: they stay, as the race ended, until the session or the track changes.
  test('the lines of the finished race stay through the cool-down, held where the race ended, and go with the session', async ({ page }) => {
    await open(page, at(11, { state: 4, start: 11 }));
    await play(page, [at(10, { start: 11, lap: 5 }), at(9, { start: 11, lap: 9 }), at(9, { state: 5, start: 11, lap: 12 })]);
    const raced = await mine(page);
    const rows = await drawn(page);
    expect(raced).not.toBeNull();
    expect(rows).toBeGreaterThan(5);
    expect(raced.color).toBe(GREEN);

    // The cool-down: a car's last lap changes, so every row is drawn again. The lines are all there, and his is the
    // line it was (the right-hand end is where the race ended, not the page's clock a second and a half later).
    await page.waitForTimeout(1500);
    await play(page, [
      at(9, { state: 6, start: 11, lap: 12, lastLaps: { [ME]: 96.5 } }),
      at(9, { state: 6, start: 11, lap: 12, lastLaps: { [ME]: 97.1 } }),
    ]);
    expect(await drawn(page)).toBe(rows);
    const cooled = await mine(page);
    expect(cooled).not.toBeNull();
    expect(cooled.pts).toEqual(raced.pts);
    expect(cooled.color).toBe(GREEN);
    // Nothing is added to a trail in the cool-down: a place that changes there is not a place in the race.
    await show(page, at(12, { state: 6, start: 11, lap: 12, lastLaps: { [ME]: 98 } }));
    expect(await places(page, ME)).toEqual([11, 10, 9]);

    // The next session takes them away.
    await show(page, at(6, { session: 'Practice', mode: 1, state: 4, start: 6 }));
    expect(await drawn(page)).toBe(0);
    expect(await page.evaluate(() => _trails.size)).toBe(0);
  });

  test('a second race of the same type at the same track starts clean at its green flag', async ({ page }) => {
    await open(page, at(11, { state: 4, start: 11 }));
    await play(page, [at(10, { start: 11, lap: 5 }), at(9, { start: 11, lap: 9 })]);
    expect(await places(page, ME)).toEqual([11, 10, 9]);
    // The flag, the cool-down, and the grid of the next: the same type of session, at the same track.
    await play(page, [at(9, { state: 5, start: 11 }), at(9, { state: 6, start: 11 })]);
    expect(await places(page, ME)).toEqual([11, 10, 9]);   // the chequered flag is still that race's
    await play(page, [1, 2, 3].map((state) => at(4, { state, start: 0 })));
    await show(page, at(4, { state: 4, start: 0, noPlaces: true }));
    await show(page, at(4, { state: 4, start: 4 }));
    expect(await places(page, ME)).toEqual([4]);
    expect(await places(page, 'A. Alpha')).toEqual([1]);
    const flat = await mine(page);
    expect(flat.first).toBe(flat.last);
  });

  test('a new session type clears the trails, and a race joined at another track does too', async ({ page }) => {
    await open(page, at(11, { state: 4, start: 11 }));
    await show(page, at(10, { start: 11 }));
    expect((await places(page, ME)).length).toBe(2);
    await show(page, at(6, { session: 'Practice', mode: 1, state: 4, start: 6 }));
    expect(await page.evaluate(() => _trails.size)).toBe(0);
    expect(await drawn(page)).toBe(0);

    // Joined mid-way at the next track, with no green flag seen: what he knew of the first is not this one's.
    await show(page, at(9, { state: 4, start: 12, track: 'another_circuit' }));
    expect(await places(page, ME)).toEqual([12, 9]);
    await show(page, at(8, { state: 4, start: 12, track: 'yet_another_circuit' }));
    expect(await places(page, ME)).toEqual([12, 8]);
  });

  test('a page that joins a race mid-way starts his line at the grid slot the host kept', async ({ page }) => {
    await open(page, at(8, { state: 4, start: 12, lap: 9 }));
    expect(await places(page, ME)).toEqual([12, 8]);
    const shown = await mine(page);
    expect(shown.last).toBeLessThan(shown.first);
    expect(shown.color).toBe(GREEN);
    // Nobody else's grid slot is known: their lines begin where they were first seen.
    expect(await places(page, 'A. Alpha')).toEqual([1]);
  });

  test('a frame that names no session does not end the one in hand', async ({ page }) => {
    await open(page, at(11, { state: 4, start: 11 }));
    await show(page, at(10, { start: 11 }));
    await show(page, at(10, { start: 11, session: '', track: '' }));
    await show(page, at(9, { start: 11 }));
    expect(await places(page, ME)).toEqual([11, 10, 9]);
  });
});

test.describe('what it costs', () => {
  test('a row\'s nodes are made once, and written to only when what they say has changed', async ({ page }) => {
    await open(page, at(11, { state: 4, start: 11 }));
    const marked = await page.evaluate(() => {
      window.__rows = new Map([...document.querySelectorAll('#lbRows .lb-row')].map((r) => [r.querySelector('.lb-name').textContent, r]));
      for (const svg of document.querySelectorAll('#lbRows .lb-spark')) svg.__mine = true;
    });
    await play(page, [at(10, { state: 4, start: 11 }), at(9, { state: 4, start: 11 })]);
    const after = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#lbRows .lb-row')];
      const kept = rows.filter((r) => window.__rows.has(r.querySelector('.lb-name').textContent));
      return {
        // every car that was on show and still is has the very row it had…
        kept: kept.length, same: kept.every((r) => window.__rows.get(r.querySelector('.lb-name').textContent) === r),
        marked: kept.every((r) => r.querySelector('.lb-spark').__mine === true),
        // …the rows are in the order of the places they show…
        order: rows.map((r) => +r.querySelector('.lb-pos').textContent),
        // …and in a line, the hairline, the line and the dot: three, and never more
        children: rows.map((r) => r.querySelector('.lb-spark').children.length),
      };
    });
    expect(marked).toBeUndefined();
    expect(after.kept).toBeGreaterThan(5);
    expect(after.same).toBe(true);
    expect(after.marked).toBe(true);
    expect(after.order).toEqual([...after.order].sort((a, b) => a - b));
    expect(after.children.every((n) => n === 3)).toBe(true);
  });

  test('the same trail at the same second is not drawn again; a second later it is drawn once', async ({ page }) => {
    await open(page, at(11, { state: 4, start: 11 }));
    await show(page, at(10, { state: 4, start: 11 }));
    const writes = await page.evaluate(() => {
      const trail = _trails.get('Test Driver');
      const row = _rowPool.get('Test Driver');
      let count = 0;
      for (const el of [row.sparkLine, row.sparkBase, row.sparkDot]) {
        const set = el.setAttribute.bind(el);
        el.setAttribute = (k, v) => { count++; return set(k, v); };
      }
      const colour = 'hsla(145,75%,50%,1)';
      const T = 5000000.5;
      _setSpark(row, trail, T, colour);
      const first = count;
      _setSpark(row, trail, T + 100, colour);        // the same second, the same trail
      const same = count - first;
      _setSpark(row, trail, T + 1500, colour);       // a second on: the right-hand end of the line is now
      const later = count - first - same;
      return { first, same, later };
    });
    expect(writes.first).toBeGreaterThan(0);
    expect(writes.same).toBe(0);
    expect(writes.later).toBeLessThanOrEqual(7);   // the line, its dot and the hairline, and nothing else
  });
});
