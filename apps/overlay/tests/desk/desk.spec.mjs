// The desk window (desk.html) over a mock RacingDesk.Host data API: synthetic history, headless, no network.
//
//   npx playwright test --project=desk

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DESK = pathToFileURL(join(here, '..', '..', 'desk.html')).href;
const NOW = new Date('2026-09-17T01:30:00Z');

// ── Synthetic history: 30 official races over six weeks, each with a practice, some split across two stints ──

const TRACKS = [
  { id: 249, name: 'nurburgring nordschleife', display: 'Nordschleife', km: 20.8, lap: 480 },
  { id: 432, name: 'oulton fosters', display: 'Oulton Park Circuit', km: 4.3, lap: 98 },
  { id: 395, name: 'virginia 2022 full', display: 'Virginia International Raceway', km: 5.2, lap: 105 },
];
const CARS = [
  { id: 218, path: 'caterham caterham420r', name: 'Caterham 420R' },
  { id: 135, path: 'mclaren570sgt4', name: 'Mclaren 570s GT4' },
];

function buildHistory() {
  const sessions = [];
  const details = new Map();
  let id = 1000;
  let ir = 800;
  let sr = 2.4;
  for (let i = 0; i < 30; i++) {
    const track = TRACKS[i % TRACKS.length];
    const car = CARS[i % CARS.length];
    const start = Date.UTC(2026, 7, 6 + Math.floor(i * 1.4), 18 + (i % 6), 0, 0);
    const subsession = 88000000 + i;
    const base = {
      source: 'ibt', ibt_path: `race-${i}.ibt`, subsession_id: subsession, session_id: 1, series_id: 526, season_id: 6454,
      race_week: 0, official: 1, category: 'SportsCar', track_id: track.id, track_name: track.name, track_display_name: track.display,
      track_config: null, track_length_km: track.km, car_path: car.path, car_id: car.id, car_screen_name: car.name, car_class_id: 4113,
      driver_cust_id: 1, irating: ir, license: `C ${sr.toFixed(2)}`, safety_rating: Number(sr.toFixed(2)),
    };
    sessions.push({
      ...base, id: id++, session_num: 0, event_type: 'Practice', session_type: 'Practice', started_at: new Date(start - 3600e3).toISOString(),
      duration_s: 1500, laps_completed: 6, best_lap_s: track.lap + 1.2, incidents: i % 3, start_position: 0, finish_position: 0,
      finish_position_in_class: 0, field_size: 22, sof: 1500,
    });

    const finish = 1 + ((i * 7) % 18);
    const incidents = (i * 5) % 9;
    const stints = i % 4 === 0 ? 2 : 1;
    for (let s = 0; s < stints; s++) {
      const rowId = id++;
      const laps = [];
      const events = [];
      for (let lap = 1; lap <= 4; lap++) {
        const dirty = (lap + i) % 3 === 0;
        laps.push({ lap: lap + s * 4, lap_time_s: track.lap + (dirty ? 3.5 : 0) + lap * 0.2, clean: dirty ? 0 : 1, incidents: dirty ? 2 : 0,
          fuel_used_l: 2.1, pitted: 0, start_session_time: lap * track.lap, position: finish });
        if (dirty) events.push({ session_time: lap * track.lap + 40, lap: lap + s * 4, lap_dist_pct: ((lap * 37) % 100) / 100, points: 2 });
      }
      details.set(rowId, { laps, incidents: events });
      sessions.push({
        ...base, id: rowId, session_num: 2, event_type: 'Race', session_type: 'Race',
        started_at: new Date(start + s * 700e3).toISOString(), duration_s: 650, laps_completed: laps.length,
        best_lap_s: track.lap + 0.2, incidents: Math.round(incidents / stints),
        start_position: s === 0 ? 10 : 0, finish_position: s === stints - 1 ? finish : 0, finish_position_in_class: s === stints - 1 ? finish : 0,
        field_size: 22, sof: 1500 + i * 10,
      });
    }
    ir += finish <= 8 ? 18 : -14;
    sr = Math.min(3.99, sr + (incidents < 4 ? 0.06 : -0.04));
  }
  return { sessions, details };
}

// One sports-car series racing every hour, in the week the fixed clock sits in.
const SCHEDULE = {
  season: '2026 Season 4',
  sourceFile: 'C:\\RacingDesk\\schedule\\2026s4.pdf',
  parsedAt: '2026-09-16T10:00:00Z',
  series: [{
    id: 1,
    season: '2026 Season 4',
    name: 'Caterham Academy Challenge',
    category: 'sports_car',
    licenseClass: 'D',
    minLicenseClass: 'Rookie',
    minLicenseLevel: 4,
    fixedSetup: false,
    multiclass: false,
    carsVaryByWeek: false,
    cars: ['Caterham Academy'],
    timingText: 'Races every hour at :00',
    repeatMinutes: 60,
    minuteOffsets: [0],
    hourParity: null,
    weeklySlots: [],
    alternateWeeks: false,
    minEntries: 6,
    splitAt: 24,
    drops: 4,
    incidentLimit: 17,
    driveThroughPenalties: false,
    weeks: [{
      week: 1,
      startsOn: '2026-09-15',
      trackName: 'Oulton Park Circuit',
      trackConfig: 'Fosters',
      raceMinutes: 15,
      raceLaps: 0,
      heatFormat: null,
      cars: [],
      simTimeOfDay: '2026-09-19 12:00 1x',
      conditions: '69°F/20°C, Rain chance None, Standing start.',
    }],
  }],
};

// `rig` is what the Cars page reads — { cars, views, pedals } (RIG, below) — and a host from before that page is
// one without the last two: it answers them 404, as it does any route it has never heard of. The host keeps what
// it was asked in `asked`, and takes nothing but a GET: a page's write is refused, as RacingDesk.Host refuses it.
function startMockHost(history, schedule = SCHEDULE, rig = RIG) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(body));
    };
    const route = url.pathname.replace('/racing-desk/data/', '');
    server.asked.push({ method: req.method, route });
    if (req.method !== 'GET') return send(403, { error: 'Writes are for local programs.' });
    if (Object.hasOwn(rig, route)) return send(200, rig[route]);
    if (route === 'status') return send(200, { schemaVersion: 2, sessions: history.sessions.length, laps: 120, lastSessionAt: history.sessions.at(-1).started_at });
    if (route === 'sessions') return send(200, history.sessions);
    if (route === 'schedule') return send(200, schedule ?? { season: null, series: [] });
    if (route === 'session') {
      const row = Number(url.searchParams.get('id'));
      const d = history.details.get(row) ?? { laps: [], incidents: [] };
      return send(200, { session: history.sessions.filter((s) => s.id === row), laps: d.laps, incidents: d.incidents, grid: [] });
    }
    send(404, { error: 'unknown data route' });
  });
  server.asked = [];
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

let host;

test.beforeAll(async () => {
  execFileSync(process.execPath, [join(here, '..', '..', '..', '..', 'packages', 'calc', 'build.mjs')], { stdio: 'pipe' });
  execFileSync(process.execPath, [join(here, '..', '..', '..', 'paints', 'build-island.mjs')], { stdio: 'pipe' });
  host = await startMockHost(buildHistory());
});

test.afterAll(async () => {
  await new Promise((resolve) => host?.close(resolve));
});

async function openDesk(page, hostUrl, query = '') {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    if (/typekit\.net/.test(msg.location().url)) return; // blocked below; the desk falls back to system fonts
    errors.push(msg.text());
  });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort()); // Typekit and anything else off-machine
  await page.clock.setFixedTime(NOW);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`${DESK}?host=${encodeURIComponent(hostUrl)}${query}`);
  return errors;
}

test('populates every panel from the local store', async ({ page }) => {
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`);

  await expect(page.locator('.race-row')).toHaveCount(30);
  await expect(page.locator('#offline')).toBeHidden();
  await expect(page.locator('.rating .ir')).toHaveText(/\d{3}/);
  await expect(page.locator('.stat').first()).toContainText('30');
  await expect(page.locator('#race-now .headline')).not.toBeEmpty();
  await expect(page.locator('#composure .score b')).toHaveText(/^\d+$/);
  await expect(page.locator('#when .window')).toHaveCount(2);
  await expect(page.locator('.heat-cell[title]')).not.toHaveCount(0);
  await expect(page.locator('#tracks li')).toHaveCount(3);
  await expect(page.locator('#cars .name')).toHaveCount(2);
  expect((await page.locator('#cars .name').allTextContents()).sort()).toEqual(['Caterham', 'McLaren']); // brand casing folded
  await expect(page.locator('#dna .archetype')).not.toBeEmpty();
  // The schedule is stored, so the suggestion reads out of it: countdown, score, series, track and reasoning.
  await expect(page.locator('#next-race')).toContainText('2026 Season 4');
  await expect(page.locator('.suggestions li')).toHaveCount(1);
  await expect(page.locator('.suggestions .name')).toHaveText('Caterham Academy Challenge');
  await expect(page.locator('.suggestions .sub')).toContainText('Oulton Park Circuit — Fosters');
  await expect(page.locator('.suggestions .when')).toHaveText(/\d/);

  // Newest race is selected; its two stints come back as one lap table.
  await expect(page.locator('.race-row.selected')).toHaveCount(1);
  await expect(page.locator('.laps-table tbody tr')).toHaveCount(4);
  await page.locator('.race-row').nth(1).click();
  await expect(page.locator('.laps-table tbody tr')).toHaveCount(8);
  await expect(page.locator('.lap-chart rect')).toHaveCount(8);

  expect(errors).toEqual([]);
});

test('says how to fetch the schedule when there is none', async ({ page }) => {
  const bare = await startMockHost(buildHistory(), null);
  try {
    await openDesk(page, `http://127.0.0.1:${bare.address().port}`);
    await expect(page.locator('.race-row')).toHaveCount(30);
    await expect(page.locator('#next-race')).toContainText('official season schedule PDF');
    await expect(page.locator('.suggestions li')).toHaveCount(0);
  } finally {
    await new Promise((resolve) => bare.close(resolve));
  }
});

test('says so when no local host is running', async ({ page }) => {
  const closed = http.createServer();
  await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve));
  const port = closed.address().port;
  await new Promise((resolve) => closed.close(resolve));

  await openDesk(page, `http://127.0.0.1:${port}`);
  await expect(page.locator('#offline')).toBeVisible();
  await expect(page.locator('#offline-reason')).toContainText(`127.0.0.1:${port}`);
});

test('passes on why the app has no host of its own', async ({ page }) => {
  const closed = http.createServer();
  await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve));
  const port = closed.address().port;
  await new Promise((resolve) => closed.close(resolve));

  const note = 'no host exe at C:\\Racing Desk\\resources\\host\\RacingDesk.Host.exe; run npm run build:host';
  await openDesk(page, `http://127.0.0.1:${port}`, `&note=${encodeURIComponent(note)}`);
  await expect(page.locator('#offline')).toBeVisible();
  await expect(page.locator('#offline-reason')).toContainText(`127.0.0.1:${port}`);
  await expect(page.locator('#offline-reason')).toContainText(note);
});

test('tells a telemetry-only server (the SimHub plugin) apart from the local host', async ({ page }) => {
  const plugin = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ 'DataCorePlugin.GameRunning': 0 }));
  });
  await new Promise((resolve) => plugin.listen(0, '127.0.0.1', resolve));
  try {
    await openDesk(page, `http://127.0.0.1:${plugin.address().port}`);
    await expect(page.locator('#offline')).toBeVisible();
    await expect(page.locator('#offline-reason')).toContainText('SimHub');
  } finally {
    await new Promise((resolve) => plugin.close(resolve));
  }
});

// ── Open in iRacing ──────────────────────────────────────────
// window.racingDesk is the preload bridge; outside Electron there is none, so these stand one in and record what
// the desk asks of it. `binds` are rig.bindPedals' answers, one per call in order, each as main.js gives it —
// { ok: true, car } or { ok: false, error } — or { __error } to reject, which main.js never does.
async function stubBridge(page, settings, binds = []) {
  await page.addInitScript(([initial, answers]) => {
    window.__k10 = { opened: [], saved: [], settings: initial, bound: [], binds: answers };
    window.racingDesk = {
      getSettings: async () => JSON.parse(JSON.stringify(window.__k10.settings)),
      saveSettings: async (s) => { window.__k10.saved.push(s); window.__k10.settings = s; return true; },
      openExternal: async (url) => { window.__k10.opened.push(url); },
      rig: {
        bindPedals: async (carPath, profileId) => {
          window.__k10.bound.push([carPath, profileId]);
          const answer = window.__k10.binds.shift() ?? { ok: false, error: 'the test has no answer for this' };
          if (answer.__error) throw new Error(answer.__error);
          return answer;
        },
      },
    };
  }, [settings, binds]);
}

test('"Open in iRacing" hands the suggestion to the iRacing UI, on the Official page while no link is known', async ({ page }) => {
  await stubBridge(page, { zoom: 100 });
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`);
  await expect(page.locator('.suggestions li')).toHaveCount(1);
  await expect(page.locator('.suggestions .link-toggle')).toHaveText('link…');
  await page.locator('.suggestions .open-iracing').click();
  expect(await page.evaluate(() => window.__k10.opened)).toEqual(['iracing://web/racing/official/']);
  expect(errors).toEqual([]);
});

test('a pasted series link is kept in the overlay settings, beside everything else in them', async ({ page }) => {
  await stubBridge(page, { zoom: 100, showSpotter: false });
  await openDesk(page, `http://127.0.0.1:${host.address().port}`);
  await expect(page.locator('.suggestions li')).toHaveCount(1);
  await page.locator('.suggestions .link-toggle').click();
  const input = page.locator('.suggestions .link-form input');
  await expect(input).toBeFocused();

  await input.fill('https://members-ng.iracing.com/web/racing/results-stats/');
  await input.press('Enter');
  await expect(page.locator('.suggestions .link-note')).toContainText('Not a series link');
  expect(await page.evaluate(() => window.__k10.saved)).toEqual([]);

  await input.fill('https://members-ng.iracing.com/web/racing/official/series-list/6273/');
  await input.press('Enter');
  await expect(page.locator('.suggestions .link-toggle')).toHaveText('linked');
  expect(await page.evaluate(() => window.__k10.saved)).toEqual([
    { zoom: 100, showSpotter: false, raceLinks: { 'Caterham Academy Challenge': '6273' } },
  ]);
  await page.locator('.suggestions .open-iracing').click();
  expect(await page.evaluate(() => window.__k10.opened)).toEqual(['iracing://web/racing/official/series-list/6273/']);
});

test('a link already in the settings is used from the first click', async ({ page }) => {
  await stubBridge(page, { raceLinks: { 'Caterham Academy Challenge': '6273' } });
  await openDesk(page, `http://127.0.0.1:${host.address().port}`);
  await expect(page.locator('.suggestions .link-toggle')).toHaveText('linked');
  await page.locator('.suggestions .open-iracing').click();
  expect(await page.evaluate(() => window.__k10.opened)).toEqual(['iracing://web/racing/official/series-list/6273/']);
});

// ── Pages ────────────────────────────────────────────────────

test('the masthead nav switches pages and the hash follows', async ({ page }) => {
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`);
  await expect(page.locator('#desk')).toBeVisible();
  await expect(page.locator('#paints')).toBeHidden();
  await expect(page.locator('#settings')).toBeHidden();
  await expect(page.locator('.nav a[aria-current="page"]')).toHaveText('Desk');

  await page.locator('.nav a', { hasText: 'Paints' }).click();
  await expect(page.locator('#paints')).toBeVisible();
  await expect(page.locator('#paints')).toContainText('livery manager');
  await expect(page.locator('#desk')).toBeHidden();
  expect(new URL(page.url()).hash).toBe('#paints');

  await page.locator('.nav a', { hasText: 'Settings' }).click();
  await expect(page.locator('#settings')).toBeVisible();
  await expect(page.locator('#paints')).toBeHidden();
  await expect(page.locator('.nav a[aria-current="page"]')).toHaveText('Settings');
  expect(new URL(page.url()).hash).toBe('#settings');

  await page.locator('.nav a', { hasText: 'Desk' }).click();
  await expect(page.locator('#desk')).toBeVisible();
  await expect(page.locator('.race-row')).toHaveCount(30);
  expect(errors).toEqual([]);
});

test('?page=settings opens on Settings', async ({ page }) => {
  await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=settings');
  await expect(page.locator('#settings')).toBeVisible();
  await expect(page.locator('#desk')).toBeHidden();
  await expect(page.locator('.nav a[aria-current="page"]')).toHaveText('Settings');
  expect(new URL(page.url()).hash).toBe('#settings');
});

// ── Cars ─────────────────────────────────────────────────────
// What the host has per car, made up. Four cars in the store: the two the history above is driven in, one driven
// in sessions the history doesn't have, and one only ever seen in other people's hands. The McLaren's view is its
// own; the Caterham was driven with whatever was set before it, and has no camera file to read a seat from; the
// MX-5 has not been driven since views were first recorded. One car has been given a profile, since edited.

const RIG_CARS = [
  { car_path: 'caterham caterham420r', name: 'Caterham Seven 420R', short_name: 'Seven 420R', car_id: 218, driven: 45, seen: 45 },
  { car_path: 'lotus79', name: 'Lotus 79', short_name: 'Lotus 79', car_id: 42, driven: 0, seen: 12 },
  { car_path: 'mx5 mx52016', name: 'Mazda MX-5 Cup', short_name: 'MX-5 Cup', car_id: 67, driven: 3, seen: 9 },
  { car_path: 'mclaren570sgt4', name: 'McLaren 570S GT4', short_name: '570S GT4', car_id: 135, driven: 45, seen: 47 },
];
const RIG_VIEWS = [
  {
    car_path: 'mclaren570sgt4', name: 'McLaren 570S GT4', driver_height: -0.06, vanish_y: -0.035, head_horizon: 0.5, fov: 69.0,
    seat_x: -0.13, seat_y: 0.0, seat_z: 0.02, chosen: 1, chosen_at: '2026-09-15T23:40:00.000Z', seen_at: '2026-09-15T23:40:00.000Z',
  },
  {
    car_path: 'caterham caterham420r', name: 'Caterham Seven 420R', driver_height: 0.015, vanish_y: 0.0, head_horizon: null, fov: 69.0,
    seat_x: null, seat_y: null, seat_z: null, chosen: 0, chosen_at: null, seen_at: '2026-09-14T22:30:00.000Z',
  },
];
const LINEAR = [0, 20, 40, 60, 80, 100];
const PROFILES = [
  {
    id: '283f91ae', name: 'Default',
    throttle: { deadzone_bottom: 5, deadzone_top: 5, curve: LINEAR },
    brake: { deadzone_bottom: 5, max_force_kg: 80, curve: LINEAR },
    clutch: { deadzone_bottom: 5, deadzone_top: 5, curve: LINEAR },
  },
  {
    id: '9c1d44e0', name: 'GT3 <stiff>',   // a name is the driver's to type: it is text, whatever is in it
    throttle: { deadzone_bottom: 2, deadzone_top: 4, curve: [] },
    brake: { deadzone_bottom: 3, max_force_kg: 95.5, curve: [0, 12, 28, 48, 72, 100] },
    clutch: null,
  },
  { id: 'aa00ff11', name: 'Throttle only', throttle: { deadzone_bottom: 5, deadzone_top: 5, curve: LINEAR }, brake: null, clutch: null },
];
const LIVE_KEYS = [
  { action: 'set', value: 50, keys: ['PRIOR'] },
  { action: 'raise', value: 5, keys: ['RCONTROL', 'UP'] },
  { action: 'lower', value: 5, keys: ['RCONTROL', 'DOWN'] },
  { action: 'other', value: null, keys: ['PAUSE', 'F13'] },
];
const bound = (car_path, name, profile_id, profile_name, profile_now, brake_force_kg = null) =>
  ({ car_path, name, profile_id, profile_name, brake_force_kg, bound_at: '2026-09-10T18:00:00.000Z', profile_now });
const RIG_PEDALS = {
  smartcontrol: { found: true, profiles: PROFILES, keys: LIVE_KEYS },
  cars: [bound('mclaren570sgt4', 'McLaren 570S GT4', '9c1d44e0', 'GT3 <stiff>', 'changed', 62)],
};
const RIG = { cars: RIG_CARS, views: RIG_VIEWS, pedals: RIG_PEDALS };

const CATERHAM = 'caterham caterham420r';
const carRow = (page, name) => page.locator('#cars-list tbody tr', { hasText: name });
const bindCalls = (page) => page.evaluate(() => window.__k10.bound);
const askedFor = (server, route) => server.asked.filter((a) => a.route === route).length;

test('the Cars page lists the cars driven, the one driven last first, and reads the host when it is shown', async ({ page }) => {
  const own = await startMockHost(buildHistory());
  try {
    const errors = await openDesk(page, `http://127.0.0.1:${own.address().port}`);
    await expect(page.locator('.race-row')).toHaveCount(30);
    await expect(page.locator('.nav a')).toHaveText(['Desk', 'Cars', 'Paints', 'Settings']);
    expect(['cars', 'views', 'pedals'].map((route) => askedFor(own, route))).toEqual([0, 0, 0]);   // nothing at desk start

    await page.locator('.nav a', { hasText: 'Cars' }).click();
    await expect(page.locator('#cars-page')).toBeVisible();
    await expect(page.locator('#desk')).toBeHidden();
    await expect(page.locator('.nav a[aria-current="page"]')).toHaveText('Cars');
    expect(new URL(page.url()).hash).toBe('#cars');

    // By full name; the Lotus has only been seen, never driven. The history's last session was the McLaren's,
    // 26½ hours before the fixed clock; the MX-5 is in no stored session, so it has no "last" and goes after.
    const rows = page.locator('#cars-list tbody tr');
    await expect(rows.locator('td.car')).toHaveText(['McLaren 570S GT4', 'Caterham Seven 420R', 'Mazda MX-5 Cup']);
    await expect(rows.locator('td:nth-child(2)')).toHaveText(['27 h ago', '2 days ago', '—']);
    await expect(page.locator('#cars-count')).toHaveText('3');
    await expect(page.locator('#cars-status')).toHaveText('');
    await expect(rows.first()).toHaveAttribute('data-car', 'mclaren570sgt4');
    expect(['cars', 'views', 'pedals'].map((route) => askedFor(own, route))).toEqual([1, 1, 1]);

    // Refresh reads them again, and so does coming back to the page.
    await page.locator('#refresh').click();
    await expect.poll(() => ['cars', 'views', 'pedals'].map((route) => askedFor(own, route))).toEqual([2, 2, 2]);
    await page.locator('.nav a', { hasText: 'Desk' }).click();
    await expect(page.locator('#cars-page')).toBeHidden();
    // The desk page's Car affinity card has the id the hash names: it is still the card, and the desk was not
    // scrolled to it on the way out.
    await expect(page.locator('#cars .name')).toHaveCount(2);
    await expect(page.locator('#cars h2')).toHaveText('Car affinity');
    expect(await page.locator('#desk').evaluate((el) => el.scrollTop)).toBe(0);
    await page.locator('.nav a', { hasText: 'Cars' }).click();
    await expect.poll(() => ['cars', 'views', 'pedals'].map((route) => askedFor(own, route))).toEqual([3, 3, 3]);
    await expect(rows).toHaveCount(3);

    // The filter is over names and paths, words in any order, and says how many it left.
    const filter = page.locator('#cars-filter');
    await filter.fill('gt4 MCLAREN');
    await expect(rows.locator('td.car')).toHaveText(['McLaren 570S GT4']);
    await expect(page.locator('#cars-count')).toHaveText('1 of 3');
    await filter.fill('mx52016');
    await expect(rows.locator('td.car')).toHaveText(['Mazda MX-5 Cup']);
    await filter.fill('trabant');
    await expect(rows).toHaveCount(0);
    await expect(page.locator('#cars-list .empty')).toHaveText('No car matches “trabant”.');
    await filter.fill('');
    await expect(rows).toHaveCount(3);

    expect(own.asked.filter((a) => a.method !== 'GET')).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await new Promise((resolve) => own.close(resolve));
  }
});

test('a car\'s view is in millimetres with their sign, the horizon as iRacing has it, and says whose it is', async ({ page }) => {
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=cars');
  await expect(page.locator('#cars-page')).toBeVisible();
  await expect(page.locator('.nav a[aria-current="page"]')).toHaveText('Cars');

  // Height, horizon, head horizon, field of view, the seat three ways, and whose view it is.
  const view = (name) => carRow(page, name).locator('td:nth-child(n+3):nth-child(-n+10)');
  await expect(view('McLaren 570S GT4')).toHaveText(['−60 mm', '−0.035', '0.5', '69°', '−130 mm', '0 mm', '+20 mm', 'its own']);
  await expect(view('Caterham Seven 420R')).toHaveText(['+15 mm', '0', '—', '69°', '—', '—', '—', 'inherited']);
  await expect(page.locator('#cars-list thead tr').nth(1).locator('th'))
    .toHaveText(['Height', 'Horizon', 'Head horizon', 'FOV', 'Fore/aft', 'Sideways', 'Up/down']);
  // Which sign is which way has not been established, so the page does not say.
  expect(await page.locator('#cars-page').textContent()).not.toMatch(/forward|\bback(ward)?\b/i);

  // Numbers are in the monospace face and line up on the right, to be read down the column.
  const look = (locator) => locator.evaluate((el) => { const s = getComputedStyle(el); return [s.textAlign, s.fontFamily, s.color]; });
  for (const cell of await view('McLaren 570S GT4').all()) {
    const [align, face] = await look(cell);
    if ((await cell.textContent()) === 'its own') continue;
    expect(align).toBe('right');
    expect(face).toContain('JetBrains Mono');
  }

  // No view yet is how every car starts: one plain sentence across the view's columns, as quiet as a heading.
  const none = carRow(page, 'Mazda MX-5 Cup').locator('td.none');
  await expect(none).toHaveText('not recorded yet — it will be after the next time you drive it');
  await expect(none).toHaveAttribute('colspan', '8');
  await expect(carRow(page, 'Mazda MX-5 Cup').locator('td')).toHaveCount(4);
  expect((await look(none))[2]).toBe((await look(page.locator('#cars-list thead th').first()))[2]);
  expect(errors).toEqual([]);
});

test('a car\'s pedals: the profile it was given, that profile\'s brake in a line, and SmartControl Live\'s keys', async ({ page }) => {
  await stubBridge(page, {});
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=cars');
  await expect(page.locator('#cars-note')).toBeHidden();

  const mclaren = carRow(page, 'McLaren 570S GT4');
  await expect(mclaren.locator('select')).toBeEnabled();
  await expect(mclaren.locator('select')).toHaveValue('9c1d44e0');
  await expect(mclaren.locator('select option')).toHaveText(['no profile of its own', 'Default', 'GT3 <stiff>', 'Throttle only']);
  await expect(mclaren.locator('select option:checked')).toHaveText('GT3 <stiff>');
  await expect(mclaren.locator('.brake')).toHaveText(
    'brake max 95.5 kg · bottom deadzone 3% · shaped curve · edited in SmartControl since this car was given it · brake force 62 kg in this car');
  await expect(mclaren.locator('.pedal-note')).toHaveText('');

  // A car with no profile of its own has the select and nothing to say beside it.
  const caterham = carRow(page, 'Caterham Seven 420R');
  await expect(caterham.locator('select')).toHaveValue('');
  await expect(caterham.locator('select option:checked')).toHaveText('no profile of its own');
  await expect(caterham.locator('.brake')).toHaveCount(0);

  // The keys the driver presses, by the names on the keycaps; a name not known here is shown as it came.
  await expect(page.locator('#cars-keys')).toBeVisible();
  await expect(page.locator('#cars-keys .key')).toHaveText([
    'Page Up — brake force 50 kg', 'Right Ctrl + Up — 5 kg more', 'Right Ctrl + Down — 5 kg less', 'Pause + F13 — other',
  ]);
  expect(await bindCalls(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('a profile deleted in SmartControl is still what the car was given, and the page says it is gone', async ({ page }) => {
  const pedals = {
    smartcontrol: RIG_PEDALS.smartcontrol,
    cars: [
      bound('mx5 mx52016', 'Mazda MX-5 Cup', 'deadbeef', 'Old wet', 'gone'),
      bound(CATERHAM, 'Caterham Seven 420R', 'aa00ff11', 'Throttle only', 'same'),
      bound('mclaren570sgt4', 'McLaren 570S GT4', '283f91ae', 'Default', 'unknown'),
    ],
  };
  const own = await startMockHost(buildHistory(), SCHEDULE, { ...RIG, pedals });
  try {
    await stubBridge(page, {});
    const errors = await openDesk(page, `http://127.0.0.1:${own.address().port}`, '&page=cars');
    const mx5 = carRow(page, 'Mazda MX-5 Cup');
    await expect(mx5.locator('select')).toHaveValue('deadbeef');
    await expect(mx5.locator('select option:checked')).toHaveText('Old wet (not in SmartControl)');
    await expect(mx5.locator('select option')).toHaveCount(5);
    await expect(mx5.locator('.brake')).toHaveText('deleted in SmartControl');
    await expect(mx5.locator('.brake .warn')).toHaveCount(1);
    // The other cars' lists are SmartControl's own.
    await expect(carRow(page, 'Caterham Seven 420R').locator('select option')).toHaveCount(4);
    await expect(carRow(page, 'Caterham Seven 420R').locator('.brake')).toHaveText('no brake in this profile');
    await expect(carRow(page, 'McLaren 570S GT4').locator('.brake')).toHaveText('brake max 80 kg · bottom deadzone 5% · linear curve');
    expect(errors).toEqual([]);
  } finally {
    await new Promise((resolve) => own.close(resolve));
  }
});

test('choosing a profile asks the app to give it to the car, and says when it is saved', async ({ page }) => {
  const own = await startMockHost(buildHistory());
  try {
    await stubBridge(page, {}, [
      { ok: true, car: bound(CATERHAM, 'Caterham Seven 420R', '283f91ae', 'Default', 'same') },
      { ok: true, car: null },
    ]);
    const errors = await openDesk(page, `http://127.0.0.1:${own.address().port}`, '&page=cars');
    const caterham = carRow(page, 'Caterham Seven 420R');
    await caterham.locator('select').selectOption({ label: 'Default' });

    await expect(caterham.locator('.pedal-note.saved')).toHaveText('saved');
    expect(await bindCalls(page)).toEqual([[CATERHAM, '283f91ae']]);
    await expect(caterham.locator('select')).toHaveValue('283f91ae');
    await expect(caterham.locator('select')).toBeEnabled();
    await expect(caterham.locator('.brake')).toHaveText('brake max 80 kg · bottom deadzone 5% · linear curve');
    // Only that car's cell changed.
    await expect(carRow(page, 'McLaren 570S GT4').locator('select')).toHaveValue('9c1d44e0');
    await expect(carRow(page, 'McLaren 570S GT4').locator('.pedal-note')).toHaveText('');

    // Taking it away is the same call with no profile.
    await caterham.locator('select').selectOption({ label: 'no profile of its own' });
    await expect.poll(() => bindCalls(page)).toEqual([[CATERHAM, '283f91ae'], [CATERHAM, null]]);
    await expect(caterham.locator('.pedal-note.saved')).toHaveText('saved');
    await expect(caterham.locator('select')).toHaveValue('');
    await expect(caterham.locator('.brake')).toHaveCount(0);

    // What was saved outlives a filter; the page itself wrote nothing to the host.
    await page.locator('#cars-filter').fill('caterham');
    await expect(page.locator('#cars-list tbody tr')).toHaveCount(1);
    await expect(caterham.locator('select')).toHaveValue('');
    expect(own.asked.filter((a) => a.method !== 'GET')).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await new Promise((resolve) => own.close(resolve));
  }
});

test('a profile that could not be saved says why, and the select goes back to what the car has', async ({ page }) => {
  const refusal = 'SmartControl doesn\'t have a profile <283f91ae>.';
  await stubBridge(page, {}, [{ ok: false, error: refusal }, { __error: 'the app went away' }]);
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=cars');
  const mclaren = carRow(page, 'McLaren 570S GT4');
  await expect(mclaren.locator('select')).toHaveValue('9c1d44e0');
  await mclaren.locator('select').selectOption({ label: 'Default' });

  await expect(mclaren.locator('.pedal-note.failed')).toHaveText(`not saved: ${refusal}`);
  expect(await bindCalls(page)).toEqual([['mclaren570sgt4', '283f91ae']]);
  await expect(mclaren.locator('select')).toHaveValue('9c1d44e0');
  await expect(mclaren.locator('select')).toBeEnabled();
  await expect(mclaren.locator('.brake')).toContainText('brake max 95.5 kg');   // still the profile it has

  // main.js never rejects; if the bridge ever does, that is shown the same way.
  await mclaren.locator('select').selectOption({ label: 'Throttle only' });
  await expect(mclaren.locator('.pedal-note.failed')).toHaveText('not saved: the app went away');
  await expect(mclaren.locator('select')).toHaveValue('9c1d44e0');
  expect(errors).toEqual([]);
});

test('a host from before the Cars page still lists the cars, and the page says the host is older', async ({ page }) => {
  const older = await startMockHost(buildHistory(), SCHEDULE, { cars: RIG_CARS });
  try {
    await stubBridge(page, {});
    const errors = await openDesk(page, `http://127.0.0.1:${older.address().port}`, '&page=cars');
    const rows = page.locator('#cars-list tbody tr');
    await expect(rows.locator('td.car')).toHaveText(['McLaren 570S GT4', 'Caterham Seven 420R', 'Mazda MX-5 Cup']);
    await expect(rows.locator('td:nth-child(2)')).toHaveText(['27 h ago', '2 days ago', '—']);
    await expect(page.locator('#cars-status')).toHaveText('This host is older than the page: it has no views or pedals to show yet.');
    // Nothing is made up in their place: no "not recorded yet", no select, no keys.
    await expect(rows.locator('td.none')).toHaveText(['—', '—', '—']);
    await expect(rows.locator('td.pedals')).toHaveText(['—', '—', '—']);
    await expect(page.locator('#cars-list select')).toHaveCount(0);
    await expect(page.locator('#cars-keys')).toBeHidden();
    expect(askedFor(older, 'views')).toBe(1);
    expect(askedFor(older, 'pedals')).toBe(1);
    // The browser notes each 404 in the console itself; nothing else went wrong.
    expect(errors.filter((e) => !/status of 404/.test(e))).toEqual([]);
    expect(errors).toHaveLength(2);

    // A host with views and no pedals yet says just that.
    const half = await startMockHost(buildHistory(), SCHEDULE, { cars: RIG_CARS, views: RIG_VIEWS });
    try {
      await page.goto(`${DESK}?host=${encodeURIComponent(`http://127.0.0.1:${half.address().port}`)}&page=cars`);
      await expect(page.locator('#cars-status')).toHaveText('This host is older than the page: it has no pedals to show yet.');
      await expect(carRow(page, 'McLaren 570S GT4').locator('td').nth(2)).toHaveText('−60 mm');
      await expect(carRow(page, 'Mazda MX-5 Cup').locator('td.none')).toContainText('not recorded yet');
      await expect(page.locator('#cars-list select')).toHaveCount(0);
    } finally {
      await new Promise((resolve) => half.close(resolve));
    }
  } finally {
    await new Promise((resolve) => older.close(resolve));
  }
});

test('without SmartControl the views are all there, and the pedals column says it was not found', async ({ page }) => {
  const pedals = {
    smartcontrol: { found: false, profiles: [], keys: [] },
    cars: [bound('mclaren570sgt4', 'McLaren 570S GT4', '9c1d44e0', 'GT3 <stiff>', 'unknown', 62)],
  };
  const own = await startMockHost(buildHistory(), SCHEDULE, { ...RIG, pedals });
  try {
    await stubBridge(page, {});
    const errors = await openDesk(page, `http://127.0.0.1:${own.address().port}`, '&page=cars');
    await expect(carRow(page, 'McLaren 570S GT4').locator('td').nth(2)).toHaveText('−60 mm');
    await expect(carRow(page, 'Caterham Seven 420R').locator('td').nth(9)).toHaveText('inherited');
    await expect(carRow(page, 'Mazda MX-5 Cup').locator('td.none')).toContainText('not recorded yet');

    await expect(page.locator('#cars-list thead tr').first().locator('th').last()).toHaveText('Pedals SmartControl wasn\'t found');
    await expect(page.locator('#cars-status')).toHaveText('SmartControl wasn\'t found on this rig, so there are no profiles to choose from.');
    await expect(page.locator('#cars-list select')).toHaveCount(0);
    // What a car was given before is still the host's to show; there is nothing to choose for the others.
    await expect(carRow(page, 'McLaren 570S GT4').locator('td.pedals .kept')).toHaveText('GT3 <stiff>');
    await expect(carRow(page, 'McLaren 570S GT4').locator('td.pedals .says')).toHaveText('brake force 62 kg in this car');
    await expect(carRow(page, 'Caterham Seven 420R').locator('td.pedals')).toHaveText('—');
    await expect(page.locator('#cars-keys')).toBeHidden();
    expect(errors).toEqual([]);
  } finally {
    await new Promise((resolve) => own.close(resolve));
  }
});

test('without the app the Cars page shows everything, changes nothing, and says so', async ({ page }) => {
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=cars');
  await expect(page.locator('#cars-note')).toBeVisible();
  await expect(page.locator('#cars-note')).toContainText('needs the Racing Desk app');
  await expect(page.locator('#cars-list tbody tr')).toHaveCount(3);
  await expect(page.locator('#cars-list select')).toHaveCount(3);
  expect(await page.locator('#cars-list select:not(:disabled)').count()).toBe(0);
  // What the host has is all still there to be read.
  await expect(carRow(page, 'McLaren 570S GT4').locator('select')).toHaveValue('9c1d44e0');
  await expect(carRow(page, 'McLaren 570S GT4').locator('td').nth(2)).toHaveText('−60 mm');
  await expect(page.locator('#cars-keys .key')).toHaveCount(4);
  await expect(page.locator('.race-row')).toHaveCount(30);   // the desk page loaded behind it all the same
  expect(errors).toEqual([]);
});

test('with no host answering the Cars page says so, in its own words', async ({ page }) => {
  const closed = http.createServer();
  await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve));
  const port = closed.address().port;
  await new Promise((resolve) => closed.close(resolve));

  await openDesk(page, `http://127.0.0.1:${port}`, '&page=cars');
  await expect(page.locator('#cars-page')).toBeVisible();
  await expect(page.locator('#cars-list .empty')).toHaveText(`The cars could not be read: nothing is answering at http://127.0.0.1:${port}.`);
  await expect(page.locator('#cars-status')).toHaveText('');
  await expect(page.locator('#cars-list table')).toHaveCount(0);
  await expect(page.locator('#offline')).toBeHidden();   // the "no local data" notice is the desk page's
});

// ── Settings ─────────────────────────────────────────────────

test('the Settings page shows what the HUD has, and the HUD default for what the file leaves out', async ({ page }) => {
  await stubBridge(page, { zoom: 120, showSpotter: false, layoutPosition: 'bottom-left', visualPreset: 'minimal-plus', commentaryEventOnlyMode: true });
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=settings');
  await expect(page.locator('#settings-note')).toBeHidden();
  await expect(page.locator('#setting-zoom')).toHaveValue('120');
  await expect(page.locator('output[for="setting-zoom"]')).toHaveText('120%');
  await expect(page.locator('#setting-showSpotter')).not.toBeChecked();
  await expect(page.locator('#setting-showLeaderboard')).toBeChecked();
  await expect(page.locator('#setting-layoutPosition')).toHaveValue('bottom-left');
  await expect(page.locator('#setting-visualPreset')).toHaveValue('minimal+'); // the older spelling, read as the HUD reads it
  await expect(page.locator('#setting-commentaryEventOnlyMode')).toBeChecked();
  await expect(page.locator('#setting-commentaryPromptDuration')).toHaveValue('15');
  await expect(page.locator('#setting-coachTone')).toHaveValue('coach');
  await expect(page.locator('#settings-sections .card h2')).toHaveText(['Layout', 'Modules', 'Look', 'Commentary']);
  expect(await page.locator('#settings-sections [data-key]:disabled').count()).toBe(0);
  expect(errors).toEqual([]);
});

test('a change writes the whole settings file back with that one key changed', async ({ page }) => {
  const seed = { zoom: 120, showSpotter: true, raceLinks: { 'Caterham Academy Challenge': '6273' }, recordingQuality: 'high' };
  await stubBridge(page, seed);
  await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=settings');

  await page.locator('#setting-showSpotter').uncheck();
  await expect.poll(() => page.evaluate(() => window.__k10.saved.length)).toBe(1);
  expect(await page.evaluate(() => window.__k10.saved)).toEqual([{ ...seed, showSpotter: false }]);
  await expect(page.locator('#settings-status')).toHaveText(/Saved/);

  await page.locator('#setting-layoutPosition').selectOption('bottom-left');
  await expect.poll(() => page.evaluate(() => window.__k10.saved.length)).toBe(2);
  expect(await page.evaluate(() => window.__k10.saved[1])).toEqual({ ...seed, showSpotter: false, layoutPosition: 'bottom-left' });

  // A number is clamped to what the HUD accepts before it is written.
  await page.locator('#setting-commentaryPromptDuration').fill('900');
  await page.locator('#setting-commentaryPromptDuration').press('Enter');
  await expect.poll(() => page.evaluate(() => window.__k10.saved.length)).toBe(3);
  expect(await page.evaluate(() => window.__k10.saved[2].commentaryPromptDuration)).toBe(120);
  await expect(page.locator('#setting-commentaryPromptDuration')).toHaveValue('120');
});

test('without the app the Settings page is read-only and says so', async ({ page }) => {
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=settings');
  await expect(page.locator('#settings-note')).toBeVisible();
  await expect(page.locator('#settings-note')).toContainText('needs the Racing Desk app');
  await expect(page.locator('#setting-zoom')).toBeDisabled();
  await expect(page.locator('#setting-zoom')).toHaveValue('165'); // the HUD's default
  await expect(page.locator('#setting-showSpotter')).toBeChecked();
  expect(await page.locator('#settings-sections [data-key]:not(:disabled)').count()).toBe(0);
  // The iPad view is the app's to switch, too.
  await expect(page.locator('#remote-on')).toBeDisabled();
  await expect(page.locator('#remote-port')).toBeDisabled();
  await expect(page.locator('#settings-remote')).toContainText('This is switched from the Racing Desk app.');
  await expect(page.locator('.race-row')).toHaveCount(30); // the desk page loaded behind it all the same
  expect(errors).toEqual([]);
});

// ── Settings: the HUD on an iPad ─────────────────────────────
// main.js starts and stops remote-server.js and answers with the server as it then stands. Here a stand-in keeps
// that state in the page and records what was asked of it. `fail` is what start answers instead, once.

const RIG_ADDRESSES = [
  { name: 'Ethernet', address: '192.168.1.20' },
  { name: 'vEthernet (WSL)', address: '172.29.64.1' },
];

async function stubRemote(page, { running = false, port = 9090, key = 'abcd2345', addresses = RIG_ADDRESSES, fail = null } = {}) {
  await page.addInitScript((start) => {
    const state = { running: start.running, port: start.port, key: start.key, error: null };
    const keys = ['wxyz6789', 'mnpq4567'];
    window.__remote = { asked: [], fail: start.fail };
    const info = () => {
      const at = (a) => `http://${a.address}:${state.port}/?k=${state.key}`;
      return {
        running: state.running, enabled: state.running, port: state.port, error: state.error,
        lanAddress: start.addresses.length ? start.addresses[0].address : null,
        url: start.addresses.length ? at(start.addresses[0]) : null,
        addresses: start.addresses.map((a) => ({ ...a, url: at(a) })),
      };
    };
    Object.assign(window.racingDesk, {
      getRemoteServerInfo: async () => { window.__remote.asked.push(['info']); return { success: true, ...info() }; },
      startRemoteServer: async (opts) => {
        window.__remote.asked.push(['start', opts]);
        if (window.__remote.fail) {
          const error = window.__remote.fail;
          window.__remote.fail = null;
          state.running = false;
          return { success: false, ...info(), error };
        }
        state.running = true;
        state.port = opts.port;
        return { success: true, ...info() };
      },
      stopRemoteServer: async () => { window.__remote.asked.push(['stop']); state.running = false; return { success: true, ...info() }; },
      renewRemoteServerKey: async () => { window.__remote.asked.push(['renew']); state.key = keys.shift(); return { success: true, ...info() }; },
    });
  }, { running, port, key, addresses, fail });
}

const remoteAsked = (page) => page.evaluate(() => window.__remote.asked.filter(([what]) => what !== 'info'));
// How much of the code's canvas is ink: a code that was drawn is a fair part black, a blank one none.
const inkOf = (page) => page.evaluate(() => {
  const canvas = document.getElementById('remote-qr');
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  let dark = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i] < 128) dark += 1;
  return dark / (data.length / 4);
});

test('the iPad view is off until it is switched on, and says what Windows will ask', async ({ page }) => {
  await stubBridge(page, { zoom: 120 });
  await stubRemote(page);
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=settings');
  const card = page.locator('#settings-remote');
  await expect(card.locator('h2')).toHaveText('iPad');
  await expect(card.locator('#remote-on')).not.toBeChecked();
  await expect(card.locator('#remote-on')).toBeEnabled();
  await expect(card.locator('#remote-port')).toHaveValue('9090');
  await expect(card).toContainText('never a picture of the game');
  await expect(card).toContainText('Windows asks whether Racing Desk may be reached from your network');
  await expect(card.locator('.remote-address')).toHaveCount(0);
  await expect(card.locator('.remote-error')).toHaveCount(0);
  expect(await remoteAsked(page)).toEqual([]);   // looking at the page starts nothing
  expect(await page.evaluate(() => window.__k10.saved)).toEqual([]);
  expect(errors).toEqual([]);
});

test('switched on, it shows the address to open with its key, as text and as a code to scan', async ({ page }) => {
  await stubBridge(page, { zoom: 120 });
  await stubRemote(page);
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=settings');
  const card = page.locator('#settings-remote');
  await card.locator('#remote-on').check();

  await expect(card.locator('.remote-url code')).toHaveText('http://192.168.1.20:9090/?k=abcd2345');
  await expect(card.locator('#remote-on')).toBeChecked();
  expect(await remoteAsked(page)).toEqual([['start', { port: 9090 }]]);
  const ink = await inkOf(page);
  expect(ink).toBeGreaterThan(0.2);
  expect(ink).toBeLessThan(0.8);
  // The rig's other address, for when the first is not the one the iPad can reach.
  await expect(card.locator('.remote-others code')).toHaveText(['http://172.29.64.1:9090/?k=abcd2345']);
  await expect(card.locator('.remote-others code')).toHaveAttribute('title', 'vEthernet (WSL)');
  await expect(card).not.toContainText('Windows asks');

  // A new key is another address, and the code is of that one.
  await card.locator('#remote-renew').click();
  await expect(card.locator('.remote-url code')).toHaveText('http://192.168.1.20:9090/?k=wxyz6789');
  expect(await inkOf(page)).toBeGreaterThan(0.2);

  // Another port is the server started again on it.
  await card.locator('#remote-port').fill('9191');
  await card.locator('#remote-port').press('Enter');
  await expect(card.locator('.remote-url code')).toHaveText('http://192.168.1.20:9191/?k=wxyz6789');

  await card.locator('#remote-on').uncheck();
  await expect(card.locator('.remote-address')).toHaveCount(0);
  await expect(card.locator('#remote-on')).not.toBeChecked();
  expect(await remoteAsked(page)).toEqual([['start', { port: 9090 }], ['renew'], ['start', { port: 9191 }], ['stop']]);
  // None of it is the settings file's: main.js keeps what it needs itself.
  expect(await page.evaluate(() => window.__k10.saved)).toEqual([]);
  expect(errors).toEqual([]);
});

test('already on when the page opens, the address is there without asking for anything', async ({ page }) => {
  await stubBridge(page, { zoom: 120 });
  await stubRemote(page, { running: true, port: 9191, addresses: [{ name: 'Wi-Fi', address: '10.0.0.5' }] });
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=settings');
  const card = page.locator('#settings-remote');
  await expect(card.locator('#remote-on')).toBeChecked();
  await expect(card.locator('#remote-port')).toHaveValue('9191');
  await expect(card.locator('.remote-url code')).toHaveText('http://10.0.0.5:9191/?k=abcd2345');
  await expect(card.locator('.remote-others')).toHaveCount(0);
  expect(await remoteAsked(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('a port another program has is said, and the switch goes back to off', async ({ page }) => {
  await stubBridge(page, { zoom: 120 });
  await stubRemote(page, { fail: 'Port 9090 is in use by another program. Choose another port.' });
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=settings');
  const card = page.locator('#settings-remote');
  // A click, as a hand makes it: check() would click again on finding the switch still off.
  await card.locator('#remote-on').click();

  await expect(card.locator('.remote-error')).toHaveText('Port 9090 is in use by another program. Choose another port.');
  await expect(card.locator('#remote-on')).not.toBeChecked();
  await expect(card.locator('.remote-address')).toHaveCount(0);

  // With the port changed while it is off nothing starts; switching on then uses it.
  await card.locator('#remote-port').fill('9292');
  await card.locator('#remote-port').press('Enter');
  expect(await remoteAsked(page)).toEqual([['start', { port: 9090 }]]);
  await card.locator('#remote-on').check();
  await expect(card.locator('.remote-url code')).toHaveText('http://192.168.1.20:9292/?k=abcd2345');
  await expect(card.locator('.remote-error')).toHaveCount(0);
  expect(await remoteAsked(page)).toEqual([['start', { port: 9090 }], ['start', { port: 9292 }]]);
  expect(errors).toEqual([]);
});

test('a rig on no network is switched on all the same, and says there is no address yet', async ({ page }) => {
  await stubBridge(page, { zoom: 120 });
  await stubRemote(page, { addresses: [] });
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=settings');
  const card = page.locator('#settings-remote');
  await card.locator('#remote-on').check();
  await expect(card.locator('#remote-on')).toBeChecked();
  await expect(card.locator('.remote-error')).toHaveText('The rig is not on a network, so there is no address to open yet.');
  await expect(card.locator('.remote-address')).toHaveCount(0);
  expect(errors).toEqual([]);
});

// ── Paints ───────────────────────────────────────────────────
// The livery manager's island (apps/paints/src, bundled by build-island.mjs in beforeAll) over a stubbed
// window.racingDesk.paints: a canned answer per command, every call recorded. An answer of { __error } rejects the
// way preload.js does, with an Error carrying the command's own message; { __after: ms, answer } answers that much
// later; { __by: 'carFolder', answers } picks the answer by that argument ('*' for the rest).

const PAINT_DIR = 'C:\\Users\\Owner\\Documents\\iRacing\\paint';
const LIBRARY = 'C:\\Users\\Owner\\Documents\\GitHub\\liveries\\cars';
const CUSTOMER = '424242';
const PLAIN_FOLDER = {
  gitAvailable: true, isRepo: false, root: null, branch: null, upstream: null, remoteUrl: null, head: null, subject: null,
  dirty: false, behind: 0, ahead: 0, checkedRemote: false, updatesAvailable: false, notes: [],
};

function version(id, name, car = 'lotus79') {
  const dir = `${LIBRARY}\\${car}\\${id}`;
  return {
    id, name, path: dir,
    files: [
      { role: 'car', roleLabel: 'Paint', fileName: `car_${CUSTOMER}.tga`, path: `${dir}\\car_${CUSTOMER}.tga`, size: 12582956, sha256: `${id}-paint` },
      { role: 'car_spec', roleLabel: 'Spec map', fileName: `car_spec_${CUSTOMER}.tga`, path: `${dir}\\car_spec_${CUSTOMER}.tga`, size: 12582956, sha256: `${id}-spec` },
    ],
    previews: [], meta: { name }, hasPaint: true, hasSpec: true, problems: [],
  };
}

// What the rig knows, as modules/js/paints/catalogue.js answers: three cars with a livery — one the library
// files under another name than the sim, one the rig has never had — and four without: two the sim has named, one
// of them by the name another car goes by, and a paint folder left behind by a car that is no longer installed.
const car = (folder, simFolder, versions, name, shortName, installed, driven, simFolderInferred = false) =>
  ({ folder, simFolder, simFolderInferred, versions, name, shortName, installed, installPath: installed ? (simFolder ?? folder) : null, driven });
const CATALOGUE = [
  car('caterham caterham420r', 'caterham caterham420r', [], 'Caterham Seven 420R', 'Seven 420R', true, 120),
  car('lotus79', 'lotus79', [version('v12', 'v12 Shatter'), version('v13', 'v13 Shatter')], 'Lotus 79', 'Lotus 79', true, 41),
  car('mx5 cup', null, [], 'Mazda MX-5 Cup', 'MX-5 Cup', true, 0),
  car('mx5-mx52016', 'mx5 mx52016', [version('orange', 'Orange', 'mx5-mx52016')], 'Mazda MX-5 Cup', 'MX-5 Cup', true, 668, true),
  car('mclaren570sgt4', 'mclaren570sgt4', [], 'McLaren 570S GT4', '570S GT4', true, 0),
  car('nissangtpzxt', null, [version('v1', 'v1', 'nissangtpzxt')], null, null, false, 0),
  car('oldcar', 'oldcar', [], null, null, false, 0),
];

const PAINTS = {
  loadSettings: {},
  saveSettings: null,
  detectPaths: {
    candidates: [{ path: PAINT_DIR, source: '%USERPROFILE%', exists: true, isOneDrive: false, carFolders: 85, textureFiles: 3204 }],
    chosen: PAINT_DIR, ambiguous: false, notes: [],
  },
  detectCustomer: { id: CUSTOMER, confidence: 'certain', source: 'Trading Paints downloader config', candidates: [], notes: [] },
  suggestLibraries: [{ path: LIBRARY, cars: 3, repo: PLAIN_FOLDER }],
  carCatalogue: CATALOGUE,
  carState: {
    simFolder: 'lotus79', folderExists: true,
    files: [{ role: 'car', roleLabel: 'Paint', fileName: `car_${CUSTOMER}.tga`, path: `${PAINT_DIR}\\lotus79\\car_${CUSTOMER}.tga`, size: 12582956, sha256: 'v12-paint', readOnly: false }],
    cooked: [`${PAINT_DIR}\\lotus79\\car_${CUSTOMER}.mip`], cookedOtherDrivers: 41, appliedVersionId: 'v12', matchKind: 'paint-only', anyReadOnly: false,
  },
  listBackups: [],
  tradingPaintsStatus: {
    configFound: false, configPath: null, running: false, userId: null, downloadMySchemes: null, deleteBeforeDownloading: null,
    deleteAfterSession: null, keepSynced: null, warnings: [],
  },
  simStatus: { simRunning: false, uiRunning: false, matched: [] },
  repoStatus: PLAIN_FOLDER,
  repoCheck: PLAIN_FOLDER, // asked once per library on launch
  preflight: { blockers: [], warnings: [] },
  applyVersion: {
    applied: true,
    backupDir: 'C:\\Users\\Owner\\AppData\\Local\\Racing Desk\\paints\\backups\\lotus79\\2026-09-17_013000_000',
    actions: [{ kind: 'backup', detail: 'Backed up 2 file(s)' }, { kind: 'copy', detail: `car_${CUSTOMER}.tga installed` }],
    warnings: [],
  },
  // A 1x1 PNG: the real command decodes the .tga and answers with a data URL like this one.
  previewImage: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
};

async function stubPaintsBridge(page, answers) {
  await page.addInitScript((canned) => {
    window.__paints = { calls: [], picked: 0, revealed: [] };
    const give = async (answer, args) => {
      const special = (key) => answer !== null && typeof answer === 'object' && key in answer;
      if (special('__by')) {
        const key = String((args ?? {})[answer.__by]);
        return give(key in answer.answers ? answer.answers[key] : answer.answers['*'], args);
      }
      if (special('__after')) {
        await new Promise((resolve) => setTimeout(resolve, answer.__after));
        return give(answer.answer, args);
      }
      if (special('__error')) throw new Error(answer.__error);
      return JSON.parse(JSON.stringify(answer));
    };
    window.racingDesk = {
      paints: {
        invoke: async (name, args) => {
          window.__paints.calls.push({ name, args });
          if (!(name in canned)) throw new Error(`no answer for ${name}`);
          return give(canned[name], args);
        },
        pickFolder: async () => { window.__paints.picked += 1; return null; },
        reveal: async (p) => { window.__paints.revealed.push(p); },
        openPath: async () => {},
      },
    };
  }, answers);
}

const paintsCalls = (page, name) => page.evaluate((n) => window.__paints.calls.filter((c) => c.name === n).map((c) => c.args), name);

test('the Paints page is the livery manager: the paint folder it found, the cars by name and the first one\'s versions', async ({ page }) => {
  await stubPaintsBridge(page, PAINTS);
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=paints');
  await expect(page.locator('#paints')).toBeVisible();
  await expect(page.locator('#paints-unbuilt')).toBeHidden();
  await expect(page.locator('#paints-note')).toBeHidden();
  const app = page.locator('#paints-root > .paints-app');
  await expect(app).toBeVisible();

  // The three things every swap depends on, from detection, then the car and its versions from the library.
  const setup = app.locator('.setup input');
  await expect(setup).toHaveCount(3);
  await expect(setup.nth(0)).toHaveValue(PAINT_DIR);
  await expect(setup.nth(1)).toHaveValue(LIBRARY);
  await expect(setup.nth(2)).toHaveValue(CUSTOMER);
  await expect(app.locator('.setup .badge')).toHaveText('certain');
  // A path longer than its field is whole in the field's tooltip.
  await expect(setup.nth(0)).toHaveAttribute('title', PAINT_DIR);
  await expect(setup.nth(1)).toHaveAttribute('title', LIBRARY);

  // The desk's masthead says where you are: no wordmark and no bar for one — what stands in a swap's way, and
  // Refresh, are at the end of the setup row.
  await expect(app.locator('.titlebar, .wordmark')).toHaveCount(0);
  await expect(app).not.toContainText('DOOOOM');
  expect(await app.evaluate((el) => el.firstElementChild.className)).toBe('setup');
  await expect(app.locator('.setup .status .chips .chip')).toHaveText('ready');
  await expect(app.locator('.setup .status button', { hasText: 'Refresh' })).toBeEnabled();

  // Cars are called what the sim calls them; the first with a livery is the one shown.
  await expect(app.locator('.sidebar .car .name')).toHaveText([
    'Lotus 79', 'Mazda MX-5 Cup', 'nissangtpzxt', 'Caterham Seven 420R', 'Mazda MX-5 Cup', 'McLaren 570S GT4', 'oldcar',
  ]);
  await expect(app.locator('.sidebar .car.active .name')).toHaveText('Lotus 79');
  await expect(app.locator('.sidebar .car.active .meta')).toHaveText('2 versions');
  await expect(app.locator('.car-head h2')).toHaveText('Lotus 79');
  await expect(app.locator('.car-head .note')).toHaveText('lotus79 · driven in 41 sessions');
  await expect(app.locator('.versions .card .head .name')).toHaveText(['v12 Shatter', 'v13 Shatter']);
  await expect(app.locator('.versions .card .badge.partial')).toHaveText('paint only'); // carState: v12's paint, not its spec
  await expect(app.locator('.versions .card .preview img')).toHaveCount(2);
  await expect(app.locator('.chips .chip')).toHaveText('ready');
  await expect(app.locator('.panel', { hasText: 'Installed in the sim' })).toContainText('41 belonging to other drivers');
  expect(await paintsCalls(page, 'carCatalogue')).toEqual([{ libraryRoot: LIBRARY, paintDir: PAINT_DIR }]);
  expect(await paintsCalls(page, 'scanLibrary')).toEqual([]);   // the catalogue reads the library itself
  expect(await paintsCalls(page, 'carState')).toEqual([{ paintDir: PAINT_DIR, libraryRoot: LIBRARY, carFolder: 'lotus79', simFolder: 'lotus79', customerId: CUSTOMER }]);

  // What it worked out is remembered through the bridge, in the Settings shape.
  await expect.poll(() => paintsCalls(page, 'saveSettings')).toEqual([{
    settings: { paintDir: PAINT_DIR, libraryRoot: LIBRARY, customerId: CUSTOMER, includeSpec: true, setReadOnlyAfter: false, clearOtherCooked: false, autoUpdateOnLaunch: false },
  }]);

  // Leaving the page and coming back finds the same island, not a second one.
  await page.locator('.nav a', { hasText: 'Desk' }).click();
  await expect(page.locator('#paints')).toBeHidden();
  await page.locator('.nav a', { hasText: 'Paints' }).click();
  await expect(app.locator('.versions .card')).toHaveCount(2);
  expect(await page.locator('.paints-app').count()).toBe(1);

  // Refresh asks for the cars again, and the car being looked at stays the one being looked at.
  await app.locator('.setup .status button', { hasText: 'Refresh' }).click();
  await expect.poll(() => paintsCalls(page, 'carCatalogue')).toHaveLength(2);
  await expect(app.locator('.car-head h2')).toHaveText('Lotus 79');
  expect(errors).toEqual([]);
});

test('the Paints sidebar: cars with a livery, then the rest, each by name, and a filter over both', async ({ page }) => {
  await stubPaintsBridge(page, PAINTS);
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=paints');
  const app = page.locator('#paints-root > .paints-app');
  const groups = app.locator('.sidebar .group');
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0).locator('.heading')).toHaveText('Liveries 3');
  await expect(groups.nth(1).locator('.heading')).toHaveText('No livery yet 4');
  await expect(groups.nth(0).locator('.car .name')).toHaveText(['Lotus 79', 'Mazda MX-5 Cup', 'nissangtpzxt']);
  await expect(groups.nth(1).locator('.car .name')).toHaveText(['Caterham Seven 420R', 'Mazda MX-5 Cup', 'McLaren 570S GT4', 'oldcar']);

  // The folder is under the name only where it says something the name does not: the library and the sim
  // disagree about it, or two cars go by one name. A car with no name is listed by its folder.
  const line = (group, n) => groups.nth(group).locator('.car').nth(n);
  await expect(line(0, 0).locator('.meta')).toHaveText('2 versions');
  await expect(line(0, 1).locator('.meta')).toHaveText('1 version · mx5-mx52016 · installs to mx5 mx52016');
  await expect(line(0, 2).locator('.meta')).toHaveText('1 version · not in the sim');
  await expect(line(1, 0).locator('.meta')).toHaveCount(0);
  await expect(line(1, 1).locator('.meta')).toHaveText('mx5 cup');
  await expect(line(1, 2).locator('.meta')).toHaveCount(0);
  await expect(line(1, 3).locator('.meta')).toHaveText('not installed');
  await expect(line(1, 0)).toHaveAttribute('title', 'caterham caterham420r');

  // Every one of them is a button: reachable by Tab, chosen with Enter.
  expect(await app.locator('.sidebar .car').evaluateAll((els) => els.map((el) => el.tagName))).toEqual(Array(7).fill('BUTTON'));
  const filter = app.locator('.sidebar .filter input');
  await filter.focus();
  await page.keyboard.press('Tab');
  await expect(app.locator('.sidebar .groups .heading button')).toBeFocused();   // New, for a group
  await page.keyboard.press('Tab');
  await expect(line(0, 0)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(line(0, 1)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(line(0, 1)).toHaveAttribute('aria-current', 'true');
  await expect(app.locator('.car-head h2')).toHaveText('Mazda MX-5 Cup');
  await expect(app.locator('.car-head .note')).toHaveText('mx5-mx52016 · installs to mx5 mx52016 · driven in 668 sessions');
  await expect(app.locator('.versions .card .head .name')).toHaveText(['Orange']);

  // By name, in any case, across both groups; the counts are of what is showing.
  await filter.fill('MAZDA');
  await expect(app.locator('.sidebar .car .name')).toHaveText(['Mazda MX-5 Cup', 'Mazda MX-5 Cup']);
  await expect(groups.nth(0).locator('.heading')).toHaveText('Liveries 1');
  await expect(groups.nth(1).locator('.heading')).toHaveText('No livery yet 1');
  // By folder — the library's or the sim's — though the name is what is shown.
  await filter.fill('mx52016');
  await expect(app.locator('.sidebar .car .name')).toHaveText(['Mazda MX-5 Cup']);
  await expect(groups).toHaveCount(1);
  await expect(groups.locator('.heading')).toHaveText('Liveries 1');
  await filter.fill('Caterham420');
  await expect(app.locator('.sidebar .car .name')).toHaveText(['Caterham Seven 420R']);
  await expect(groups.locator('.heading')).toHaveText('No livery yet 1');
  await filter.fill('  570s ');
  await expect(app.locator('.sidebar .car .name')).toHaveText(['McLaren 570S GT4']);
  await filter.fill('trabant');
  await expect(app.locator('.sidebar .car')).toHaveCount(0);
  await expect(app.locator('.sidebar .list .empty')).toHaveText('No car matches “trabant”.');
  // The car being shown is still shown; the filter is over the list, not the page.
  await expect(app.locator('.car-head h2')).toHaveText('Mazda MX-5 Cup');

  // Escape clears it.
  await filter.press('Escape');
  await expect(filter).toHaveValue('');
  await expect(filter).toBeFocused();
  await expect(app.locator('.sidebar .car')).toHaveCount(7);
  await expect(groups.nth(1).locator('.heading')).toHaveText('No livery yet 4');
  await expect(app.locator('.sidebar .car.active .name')).toHaveText('Mazda MX-5 Cup');
  expect(errors).toEqual([]);
});

test('a car with no livery says where one would go, shows what is installed, and offers nothing to apply', async ({ page }) => {
  const installed = {
    simFolder: 'caterham caterham420r', folderExists: true,
    files: [{ role: 'car', roleLabel: 'Paint', fileName: `car_${CUSTOMER}.tga`, path: `${PAINT_DIR}\\caterham caterham420r\\car_${CUSTOMER}.tga`, size: 12582956, sha256: 'someone-elses-work', readOnly: false }],
    cooked: [], cookedOtherDrivers: 203, appliedVersionId: null, matchKind: 'none', anyReadOnly: false,
  };
  const backup = { id: '2026-09-16_221500_000', path: 'C:\\backups\\caterham caterham420r\\2026-09-16_221500_000', created: '2026-09-16T22:15:00.000+01:00', reason: 'before revert to 2026-09-10_101010_000', fileCount: 1 };
  await stubPaintsBridge(page, { ...PAINTS, carState: installed, listBackups: [backup] });
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=paints');
  const app = page.locator('#paints-root > .paints-app');
  await app.locator('.sidebar .car', { hasText: 'Caterham Seven 420R' }).click();

  await expect(app.locator('.car-head h2')).toHaveText('Caterham Seven 420R');
  await expect(app.locator('.car-head .note')).toHaveText('caterham caterham420r · driven in 120 sessions');
  const note = app.locator('.panel.no-livery');
  await expect(note).toContainText('There is no livery for this car in the library.');
  await expect(note.locator('code').first()).toHaveText(`${LIBRARY}\\caterham caterham420r\\<version name>\\`);
  await expect(app.locator('.versions')).toHaveCount(0);
  await expect(app.locator('.card')).toHaveCount(0);

  // What is in the sim's folder, and the backups, are the car's whether the library knows it or not.
  const inSim = app.locator('.panel', { hasText: 'Installed in the sim' });
  await expect(inSim).toContainText(`car_${CUSTOMER}.tga`);
  await expect(inSim).toContainText('203 belonging to other drivers');
  await expect(app.locator('.panel', { hasText: 'Backups' })).toContainText(backup.id);
  expect((await paintsCalls(page, 'carState')).at(-1)).toEqual({
    paintDir: PAINT_DIR, libraryRoot: LIBRARY, carFolder: 'caterham caterham420r', simFolder: 'caterham caterham420r', customerId: CUSTOMER,
  });
  expect((await paintsCalls(page, 'listBackups')).at(-1)).toEqual({ carFolder: 'caterham caterham420r' });

  // No Apply anywhere, and nothing warning about where a paint would land.
  await expect(app.getByRole('button', { name: /apply/i })).toHaveCount(0);
  await expect(app.locator('.modal')).toHaveCount(0);
  await expect(app.locator('.chips .chip')).toHaveText('ready');
  expect(await paintsCalls(page, 'preflight')).toEqual([]);
  expect(await paintsCalls(page, 'applyVersion')).toEqual([]);

  // A car the sim has made no paint folder for has nothing installed, and the page says why.
  await stubPaintsBridge(page, {
    ...PAINTS,
    carState: { simFolder: null, folderExists: false, files: [], cooked: [], cookedOtherDrivers: 0, appliedVersionId: null, matchKind: 'none', anyReadOnly: false },
  });
  await page.reload();
  const again = page.locator('#paints-root > .paints-app');
  await again.locator('.sidebar .group').nth(1).locator('.car', { hasText: 'Mazda MX-5 Cup' }).click();
  await expect(again.locator('.car-head .note')).toHaveText('mx5 cup');
  await expect(again.locator('.panel.no-livery code').first()).toHaveText(`${LIBRARY}\\mx5 cup\\<version name>\\`);
  await expect(again.locator('.panel', { hasText: 'Installed in the sim' })).toContainText('no folder in the paint directory yet');
  await expect(again.getByRole('button', { name: /apply/i })).toHaveCount(0);
  await expect(again.locator('.chips .chip')).toHaveText('ready');
  expect(errors).toEqual([]);
});

test('a livery for a car with no paint folder is shown, warned about, and cannot be applied yet', async ({ page }) => {
  await stubPaintsBridge(page, {
    ...PAINTS,
    carState: { simFolder: null, folderExists: false, files: [], cooked: [], cookedOtherDrivers: 0, appliedVersionId: null, matchKind: 'none', anyReadOnly: false },
  });
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=paints');
  const app = page.locator('#paints-root > .paints-app');
  await app.locator('.sidebar .car', { hasText: 'nissangtpzxt' }).click();
  await expect(app.locator('.car-head h2')).toHaveText('nissangtpzxt');
  await expect(app.locator('.versions .card .head .name')).toHaveText(['v1']);
  await expect(app.locator('.versions .card .actions button.primary')).toBeDisabled();
  await expect(app.locator('.chips .chip')).toHaveText('Car not in sim');
  expect(errors).toEqual([]);
});

const applyRequest = (extra = {}) => ({
  request: {
    paintDir: PAINT_DIR, libraryRoot: LIBRARY, carFolder: 'lotus79', simFolder: 'lotus79', versionId: 'v13', customerId: CUSTOMER,
    includeSpec: true, setReadOnlyAfter: false, clearOtherCooked: false, force: false, ...extra,
  },
});

test('Apply is one click: no dialog, the request src/types.ts describes, and what was done in the activity', async ({ page }) => {
  await stubPaintsBridge(page, PAINTS);
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=paints');
  const app = page.locator('#paints-root > .paints-app');
  await app.locator('.versions .card', { hasText: 'v13 Shatter' }).locator('.actions button.primary').click();

  const entry = app.locator('.log .entry.ok');
  await expect(entry).toContainText('Applied v13 Shatter to Lotus 79');
  await expect(entry).toContainText(`car_${CUSTOMER}.tga installed`);
  expect(await paintsCalls(page, 'applyVersion')).toEqual([applyRequest()]);
  // Nothing was asked of the driver on the way, and nothing stands where the click was.
  await expect(app.locator('.modal, .scrim')).toHaveCount(0);
  await expect(app.locator('.refusal')).toHaveCount(0);
  expect(await paintsCalls(page, 'preflight')).toEqual([]);
  expect((await paintsCalls(page, 'carState')).length).toBeGreaterThanOrEqual(2); // re-read after the apply
  expect(errors).toEqual([]);
});

test('how a livery is applied is set once, remembered, and used by the next apply', async ({ page }) => {
  await stubPaintsBridge(page, { ...PAINTS, loadSettings: { setReadOnlyAfter: true } });
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=paints');
  const app = page.locator('#paints-root > .paints-app');
  const options = app.locator('.apply-options');
  await expect(options.locator('h3')).toHaveText('When a livery is applied');
  const boxes = options.getByRole('checkbox');
  await expect(boxes).toHaveCount(3);
  await expect(options.getByLabel('Install the spec map')).toBeChecked();
  await expect(options.getByLabel('Set read-only afterwards')).toBeChecked();   // as remembered
  await expect(options.getByLabel('Also clear other drivers\' cooked files')).not.toBeChecked();

  await options.getByLabel('Install the spec map').uncheck();
  await options.getByLabel('Also clear other drivers\' cooked files').check();
  await app.locator('.versions .card', { hasText: 'v13 Shatter' }).locator('.actions button.primary').click();
  await expect(app.locator('.log .entry.ok')).toContainText('Applied v13 Shatter to Lotus 79');

  expect(await paintsCalls(page, 'applyVersion')).toEqual([applyRequest({ includeSpec: false, setReadOnlyAfter: true, clearOtherCooked: true })]);
  await expect.poll(async () => (await paintsCalls(page, 'saveSettings')).at(-1)?.settings).toMatchObject({
    includeSpec: false, setReadOnlyAfter: true, clearOtherCooked: true,
  });
  expect(errors).toEqual([]);
});

const SIM_RUNNING = 'iRacing is running. It holds paint files open, so a swap can fail halfway. Close the sim first.';

test('what stands in the way is said where the click was, and going on regardless is a second click', async ({ page }) => {
  await stubPaintsBridge(page, {
    ...PAINTS,
    simStatus: { simRunning: true, uiRunning: true, matched: ['iRacingSim64DX11.exe'] },
    applyVersion: { __by: 'force', answers: { true: PAINTS.applyVersion, '*': { __error: SIM_RUNNING } } },
  });
  // The stub picks its answer by an argument of the call; the request is one level down.
  await page.addInitScript(() => {
    const invoke = window.racingDesk.paints.invoke;
    window.racingDesk.paints.invoke = (name, args) =>
      invoke(name, name === 'applyVersion' ? { ...args, force: String(args.request.force) } : args);
  });
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=paints');
  const app = page.locator('#paints-root > .paints-app');
  await app.locator('.versions .card', { hasText: 'v13 Shatter' }).locator('.actions button.primary').click();

  const refusal = app.locator('.refusal');
  await expect(refusal).toContainText(SIM_RUNNING);
  await expect(app.locator('.log .entry.bad')).toContainText('Did not apply v13 Shatter to Lotus 79');
  await expect(refusal.getByRole('button')).toHaveText(['Apply v13 Shatter anyway', 'Dismiss']);

  await refusal.getByRole('button', { name: 'Apply v13 Shatter anyway' }).click();
  await expect(app.locator('.log .entry.ok')).toContainText('Applied v13 Shatter to Lotus 79');
  await expect(refusal).toHaveCount(0);
  expect((await paintsCalls(page, 'applyVersion')).map((c) => c.request.force)).toEqual([false, true]);
  expect(errors).toEqual([]);
});

test('a failure that insisting would not mend offers no way to insist', async ({ page }) => {
  const failure = `Could not write car_${CUSTOMER}.tga (EBUSY). Everything this apply had changed was put back.`;
  await stubPaintsBridge(page, { ...PAINTS, applyVersion: { __error: failure } });
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=paints');
  const app = page.locator('#paints-root > .paints-app');
  await app.locator('.versions .card', { hasText: 'v13 Shatter' }).locator('.actions button.primary').click();

  const refusal = app.locator('.refusal');
  await expect(refusal).toContainText(failure);
  await expect(refusal.getByRole('button')).toHaveText(['Dismiss']);
  await refusal.getByRole('button', { name: 'Dismiss' }).click();
  await expect(refusal).toHaveCount(0);
  expect(await paintsCalls(page, 'applyVersion')).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('choosing another car takes the refusal with it: what it says is about the car it was for', async ({ page }) => {
  await stubPaintsBridge(page, { ...PAINTS, applyVersion: { __error: SIM_RUNNING } });
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=paints');
  const app = page.locator('#paints-root > .paints-app');
  await app.locator('.versions .card', { hasText: 'v13 Shatter' }).locator('.actions button.primary').click();
  const refusal = app.locator('.refusal');
  await expect(refusal).toContainText(SIM_RUNNING);

  await app.locator('.sidebar .car', { hasText: 'McLaren 570S GT4' }).click();
  await expect(app.locator('.car-head h2')).toHaveText('McLaren 570S GT4');
  await expect(refusal).toHaveCount(0);

  // And it stays gone: it does not come back with the car it was for.
  await app.locator('.sidebar .car', { hasText: 'Lotus 79' }).click();
  await expect(app.locator('.car-head h2')).toHaveText('Lotus 79');
  await expect(app.locator('.versions .card')).toHaveCount(2);
  await expect(refusal).toHaveCount(0);
  expect(await paintsCalls(page, 'applyVersion')).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('a car never driven has no paint folder, and its livery is applied into the one the sim would make', async ({ page }) => {
  const NEVER_DRIVEN = car('porsche992cup', null, [version('shatter', 'shatter', 'porsche992cup')], 'Porsche 911 GT3 Cup (992)', '911 Cup', true, 0);
  await stubPaintsBridge(page, {
    ...PAINTS,
    carCatalogue: [...CATALOGUE, NEVER_DRIVEN],
    carState: { simFolder: 'porsche992cup', folderExists: false, files: [], cooked: [], cookedOtherDrivers: 0, appliedVersionId: null, matchKind: 'none', anyReadOnly: false },
  });
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=paints');
  const app = page.locator('#paints-root > .paints-app');
  await app.locator('.sidebar .car', { hasText: 'Porsche 911 GT3 Cup (992)' }).click();
  await expect(app.locator('.panel', { hasText: 'Installed in the sim' })).toContainText('Applying a livery makes it');

  await app.locator('.versions .card .actions button.primary').click();
  await expect(app.locator('.log .entry.ok')).toContainText('Applied shatter to Porsche 911 GT3 Cup (992)');
  expect(await paintsCalls(page, 'applyVersion')).toEqual([
    applyRequest({ carFolder: 'porsche992cup', simFolder: 'porsche992cup', versionId: 'shatter' }),
  ]);
  expect(errors).toEqual([]);
});

// Two cars whose folders hold different things, so that one's answer under the other's name shows.
const MCLAREN_STATE = {
  simFolder: 'mclaren570sgt4', folderExists: true,
  files: [{ role: 'car', roleLabel: 'Paint', fileName: `car_${CUSTOMER}.tga`, path: `${PAINT_DIR}\\mclaren570sgt4\\car_${CUSTOMER}.tga`, size: 12582956, sha256: 'mclaren-paint', readOnly: false }],
  cooked: [], cookedOtherDrivers: 7, appliedVersionId: null, matchKind: 'none', anyReadOnly: false,
};
const LOTUS_BACKUP = { id: '2026-09-16_221500_000', path: 'C:\\backups\\lotus79\\2026-09-16_221500_000', created: '2026-09-16T22:15:00.000+01:00', reason: 'before apply v12', fileCount: 2 };
const BY_CAR = {
  carState: { __by: 'carFolder', answers: { mclaren570sgt4: MCLAREN_STATE, '*': PAINTS.carState } },
  listBackups: { __by: 'carFolder', answers: { lotus79: [LOTUS_BACKUP], '*': [] } },
};

test('a car just chosen is not shown the last car\'s files and backups while its own are read', async ({ page }) => {
  await stubPaintsBridge(page, {
    ...PAINTS, ...BY_CAR,
    carState: { __by: 'carFolder', answers: { mclaren570sgt4: { __after: 800, answer: MCLAREN_STATE }, '*': PAINTS.carState } },
  });
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=paints');
  const app = page.locator('#paints-root > .paints-app');
  const inSim = app.locator('.panel', { hasText: 'Installed in the sim' });
  const backups = app.locator('.panel', { hasText: 'Backups' });
  await expect(inSim).toContainText('41 belonging to other drivers');
  await expect(backups).toContainText(LOTUS_BACKUP.id);

  await app.locator('.sidebar .car', { hasText: 'McLaren 570S GT4' }).click();
  await expect(app.locator('.car-head h2')).toHaveText('McLaren 570S GT4');
  // As it stands now, not as it will once the answer is in.
  expect(await inSim.textContent()).not.toContain('belonging to other drivers');
  expect(await backups.textContent()).not.toContain(LOTUS_BACKUP.id);
  expect(await backups.getByRole('button').count()).toBe(0);

  await expect(inSim).toContainText('7 belonging to other drivers');
  await expect(backups).toContainText('Nothing backed up for this car yet');
  expect(errors).toEqual([]);
});

test('a car chosen while an apply is on its way keeps its own files when the apply answers', async ({ page }) => {
  await stubPaintsBridge(page, { ...PAINTS, ...BY_CAR, applyVersion: { __after: 500, answer: PAINTS.applyVersion } });
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=paints');
  const app = page.locator('#paints-root > .paints-app');
  await app.locator('.versions .card', { hasText: 'v13 Shatter' }).locator('.actions button.primary').click();
  await app.locator('.sidebar .car', { hasText: 'McLaren 570S GT4' }).click();
  await expect(app.locator('.car-head h2')).toHaveText('McLaren 570S GT4');

  // The apply answers, and the car is read again — the one on the page, not the one the apply was for.
  await expect(app.locator('.log .entry.ok')).toContainText('Applied v13 Shatter to Lotus 79');
  await expect.poll(async () => (await paintsCalls(page, 'carState')).length).toBeGreaterThanOrEqual(3);
  await page.waitForTimeout(150);
  expect((await paintsCalls(page, 'carState')).at(-1).carFolder).toBe('mclaren570sgt4');
  expect((await paintsCalls(page, 'listBackups')).at(-1)).toEqual({ carFolder: 'mclaren570sgt4' });
  const inSim = app.locator('.panel', { hasText: 'Installed in the sim' });
  expect(await inSim.textContent()).toContain('7 belonging to other drivers');
  expect(await app.locator('.panel', { hasText: 'Backups' }).textContent()).toContain('Nothing backed up for this car yet');
  await inSim.getByRole('button', { name: 'Show in Explorer' }).click();
  expect(await page.evaluate(() => window.__paints.revealed)).toEqual([`${PAINT_DIR}\\mclaren570sgt4\\car_${CUSTOMER}.tga`]);

  // Refresh reads the cars, and the car on the page once.
  const before = (await paintsCalls(page, 'carState')).length;
  await app.locator('.setup .status button', { hasText: 'Refresh' }).click();
  await expect.poll(() => paintsCalls(page, 'carCatalogue')).toHaveLength(2);
  await expect.poll(async () => (await paintsCalls(page, 'carState')).length).toBeGreaterThan(before);
  await page.waitForTimeout(150);
  expect((await paintsCalls(page, 'carState')).slice(before).map((c) => c.carFolder)).toEqual(['mclaren570sgt4']);
  expect(errors).toEqual([]);
});

test('while the cars are on their way the page says so, and when they cannot be read it says why', async ({ page }) => {
  await stubPaintsBridge(page, { ...PAINTS, carCatalogue: { __after: 700, answer: CATALOGUE } });
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=paints');
  const app = page.locator('#paints-root > .paints-app');
  await expect(app.locator('.sidebar .empty')).toHaveText('Reading the cars…');
  await expect(app.locator('.main > .empty')).toHaveText('Reading the cars…');
  await expect(app.locator('.sidebar .car')).toHaveCount(7);
  await expect(app.locator('.sidebar .empty')).toHaveCount(0);
  await expect(app.locator('.car-head h2')).toHaveText('Lotus 79');
  expect(errors).toEqual([]);

  // A list that is here and empty is the only one that says there are no cars.
  await stubPaintsBridge(page, { ...PAINTS, carCatalogue: [] });
  await page.reload();
  const empty = page.locator('#paints-root > .paints-app');
  await expect(empty.locator('.sidebar .empty')).toHaveText('No cars in this folder.');
  await expect(empty.locator('.main > .empty')).toHaveText('Nothing to show. Point the library at a folder of car folders.');

  const refusal = 'EPERM: operation not permitted, scandir \'C:\\Users\\Owner\\Documents\\GitHub\\liveries\\cars\\locked\'';
  const found = 'Documents is redirected to OneDrive; using the paint folder there.';
  await stubPaintsBridge(page, {
    ...PAINTS,
    detectPaths: { ...PAINTS.detectPaths, notes: [found] },
    carCatalogue: { __error: refusal },
  });
  await page.reload();
  const failed = page.locator('#paints-root > .paints-app');
  await expect(failed.locator('.sidebar .empty')).toHaveText('The cars could not be read.');
  await expect(failed.locator('.main > .empty')).toContainText('The cars could not be read');
  // With no car to show there is still somewhere for what went wrong, and what start-up found, to be read.
  await expect(failed.locator('.log .entry.bad')).toContainText('Could not read the library');
  await expect(failed.locator('.log .entry.bad')).toContainText(refusal);
  await expect(failed.locator('.log .entry', { hasText: found })).toHaveCount(1);
  await expect(failed).not.toContainText('No cars in this folder.');
  await expect(failed).not.toContainText('Point the library at a folder');
});

// The rig's list: 18 cars with a livery and 171 without, far more than the window is tall.
const pad = (n) => String(n).padStart(3, '0');
const MANY = [
  ...Array.from({ length: 18 }, (_, i) => car(`livery${pad(i)}`, `livery${pad(i)}`, [version('v1', 'v1', `livery${pad(i)}`)], `Livery Car ${pad(i)}`, null, true, 1)),
  ...Array.from({ length: 171 }, (_, i) => car(`plain${pad(i)}`, `plain${pad(i)}`, [], `Plain Car ${pad(i)}`, null, true, 0)),
];

// Null when the focused row is what is on screen at its middle; its name when something else is over it.
const focusedRowIfCovered = (page) => page.evaluate(() => {
  const row = document.activeElement;
  const box = row.getBoundingClientRect();
  const onTop = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  return row.contains(onTop) ? null : row.textContent;
});

test('a long list: a row reached by keyboard is never under a group\'s heading', async ({ page }) => {
  await stubPaintsBridge(page, { ...PAINTS, carCatalogue: MANY });
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=paints');
  const app = page.locator('#paints-root > .paints-app');
  const rows = app.locator('.sidebar .car');
  await expect(rows).toHaveCount(189);

  // Up the list: each row scrolls into view at the top edge, which is where the heading is stuck.
  await rows.nth(120).focus();
  const covered = [];
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Shift+Tab');
    const name = await focusedRowIfCovered(page);
    if (name) covered.push(name);
  }
  await expect(rows.nth(60)).toBeFocused();
  expect(covered).toEqual([]);
  expect(errors).toEqual([]);
});

test('a long list: the car being looked at is back in view when the filter is cleared', async ({ page }) => {
  await stubPaintsBridge(page, { ...PAINTS, carCatalogue: MANY });
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=paints');
  const app = page.locator('#paints-root > .paints-app');
  const rows = app.locator('.sidebar .car');
  const active = app.locator('.sidebar .car.active');
  const filter = app.locator('.sidebar .filter input');
  await expect(rows).toHaveCount(189);
  const inView = () => active.evaluate((row) => {
    const box = row.getBoundingClientRect();
    return row.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
  });

  await rows.nth(150).click();
  await expect(active.locator('.name')).toHaveText('Plain Car 132');
  await filter.fill('trabant');
  await expect(rows).toHaveCount(0);
  await filter.press('Escape');
  await expect(rows).toHaveCount(189);
  await expect(active.locator('.name')).toHaveText('Plain Car 132');
  await expect(active).toBeInViewport();
  expect(await inView()).toBe(true);

  // Emptied by hand, from a filter the car was one of the matches of.
  await filter.fill('plain13');
  await expect(rows).toHaveCount(10);
  await filter.fill('');
  await expect(rows).toHaveCount(189);
  await expect(active).toBeInViewport();
  expect(await inView()).toBe(true);
  expect(errors).toEqual([]);
});

test('the filter takes words in any order, and an accent need not be typed', async ({ page }) => {
  await stubPaintsBridge(page, {
    ...PAINTS,
    carCatalogue: [
      ...CATALOGUE,
      car('lamborghinievogt3', 'lamborghinievogt3', [], 'Lamborghini Huracán GT3 EVO', 'Huracán GT3 EVO', true, 3),
      car('citroenc3wrx', null, [], 'Citroën C3 WRX', 'C3 WRX', true, 0),
    ],
  });
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=paints');
  const app = page.locator('#paints-root > .paints-app');
  const names = app.locator('.sidebar .car .name');
  const filter = app.locator('.sidebar .filter input');
  await expect(names).toHaveCount(9);

  await filter.fill('huracan');
  await expect(names).toHaveText(['Lamborghini Huracán GT3 EVO']);
  await filter.fill('HURACÁN');
  await expect(names).toHaveText(['Lamborghini Huracán GT3 EVO']);
  await filter.fill('evo lambo');
  await expect(names).toHaveText(['Lamborghini Huracán GT3 EVO']);
  await filter.fill('Citroën wrx');
  await expect(names).toHaveText(['Citroën C3 WRX']);
  await filter.fill('mazda cup');
  await expect(names).toHaveText(['Mazda MX-5 Cup', 'Mazda MX-5 Cup']);
  // A word may be in the name and another in the folder.
  await filter.fill('cup  mx52016');
  await expect(names).toHaveText(['Mazda MX-5 Cup']);
  await expect(app.locator('.sidebar .car .meta')).toHaveText('1 version · mx5-mx52016 · installs to mx5 mx52016');
  // Every word has to be there.
  await filter.fill('mazda trabant');
  await expect(names).toHaveCount(0);
  await expect(app.locator('.sidebar .list .empty')).toHaveText('No car matches “mazda trabant”.');
  expect(errors).toEqual([]);
});

test('a car with a livery is as bold when the filter leaves only cars with one', async ({ page }) => {
  await stubPaintsBridge(page, PAINTS);
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=paints');
  const app = page.locator('#paints-root > .paints-app');
  const groups = app.locator('.sidebar .group');
  const filter = app.locator('.sidebar .filter input');
  const look = (name) => app.locator('.sidebar .car:not(.active) .name', { hasText: name })
    .evaluate((el) => { const s = getComputedStyle(el); return [s.fontWeight, s.color]; });
  await expect(groups).toHaveCount(2);
  const livery = await look('nissangtpzxt');
  const plain = await look('oldcar');
  expect(livery[0]).toBe('600');
  expect(plain[0]).toBe('400');
  expect(plain[1]).not.toBe(livery[1]);

  // Its group is now the last in the list, and it is still a car with a livery.
  await filter.fill('nissan');
  await expect(groups.locator('.heading')).toHaveText(['Liveries 1']);
  expect(await look('nissangtpzxt')).toEqual(livery);
  // And a car without one is as quiet when its group is the only one.
  await filter.fill('oldcar');
  await expect(groups.locator('.heading')).toHaveText(['No livery yet 1']);
  expect(await look('oldcar')).toEqual(plain);
  expect(errors).toEqual([]);
});

// The same bundle outside the desk, as the Tauri shell runs the same source: no window.racingDesk, the Rust
// commands under their snake_case names — and no car_catalogue among them.
// ── Livery groups ──
// liveryGroups, saveGroup and deleteGroup keep their groups in the page, as the manager keeps them in the settings;
// setGroup answers as canned. Every call is recorded with the rest.

const group = (id, name, kind, cars) => ({
  id, name, kind, cars: cars.map(([folder, versionId, versionName = versionId, missing = false]) => ({ folder, versionId, versionName, missing })),
});
const SHATTER = group('library:shatter', 'shatter', 'library', [['lotus79', 'v13', 'v13 Shatter'], ['nissangtpzxt', 'v1']]);
const RACE_DAY = group('mine:race-day', 'Race day', 'mine', [['lotus79', 'v12', 'v12 Shatter'], ['mx5-mx52016', 'orange', 'Orange']]);

const SET_REPORT = {
  groupId: 'library:shatter', name: 'shatter', applied: 1, already: 0, skipped: 1, failed: 0, warnings: [],
  results: [
    { folder: 'lotus79', simFolder: 'lotus79', versionId: 'v13', outcome: 'applied', detail: `car_${CUSTOMER}.tga -> car_${CUSTOMER}.tga`, backupDir: 'C:\\backups\\lotus79\\2026-09-28_120000_000', warnings: [] },
    { folder: 'nissangtpzxt', simFolder: null, versionId: 'v1', outcome: 'skipped', detail: 'The car has no folder in the paint directory and is not in the iRacing install.', backupDir: null, warnings: [] },
  ],
};

async function stubGroups(page, initial) {
  await page.addInitScript((groups) => {
    const held = JSON.parse(JSON.stringify(groups));
    const copy = (v) => JSON.parse(JSON.stringify(v));
    const invoke = window.racingDesk.paints.invoke;
    window.racingDesk.paints.invoke = async (name, args) => {
      if (!['liveryGroups', 'saveGroup', 'deleteGroup'].includes(name)) return invoke(name, args);
      window.__paints.calls.push({ name, args });
      if (name === 'liveryGroups') return copy(held);
      if (name === 'deleteGroup') {
        const at = held.findIndex((g) => g.id === args.id);
        if (at < 0) return false;
        held.splice(at, 1);
        return true;
      }
      if (held.some((g) => g.id !== args.id && g.name.toLowerCase() === args.name.toLowerCase())) {
        throw new Error(`There is a group called ${args.name} already.`);
      }
      const cars = Object.entries(args.cars).filter(([, v]) => v).map(([folder, versionId]) => ({ folder, versionId, versionName: versionId, missing: false }));
      let saved = held.find((g) => g.id === args.id);
      if (saved) Object.assign(saved, { name: args.name, cars });
      else {
        saved = { id: `mine:${args.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name: args.name, kind: 'mine', cars };
        held.unshift(saved);
      }
      return copy(saved);
    };
  }, initial);
}

const groupRequest = (groupId, extra = {}) => ({
  request: {
    paintDir: PAINT_DIR, libraryRoot: LIBRARY, customerId: CUSTOMER, groupId,
    includeSpec: true, setReadOnlyAfter: false, clearOtherCooked: false, force: false, ...extra,
  },
});

test('groups are listed above the cars, and one is looked at where a car would be', async ({ page }) => {
  await stubPaintsBridge(page, PAINTS);
  await stubGroups(page, [RACE_DAY, SHATTER]);
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=paints');
  const app = page.locator('#paints-root > .paints-app');

  await expect(app.locator('.sidebar .groups .heading')).toContainText('Groups 2');
  await expect(app.locator('.sidebar .groups .car .name')).toHaveText(['Race day', 'shatter']);
  await expect(app.locator('.sidebar .groups .car .meta')).toHaveText(['2 cars · yours', '2 cars']);
  // The cars are as they were, and a car is still what the page opens on.
  await expect(app.locator('.sidebar .group .heading')).toHaveText(['Liveries 3', 'No livery yet 4']);
  await expect(app.locator('.car-head h2')).toHaveText('Lotus 79');

  await app.locator('.sidebar .groups .car', { hasText: 'shatter' }).click();
  await expect(app.locator('.group-head h2')).toHaveText('shatter');
  await expect(app.locator('.group-head .note')).toHaveText('Every car with a version called shatter in the library · 2 cars');
  await expect(app.locator('.sidebar .car.active .name')).toHaveText(['shatter']);
  await expect(app.locator('.versions')).toHaveCount(0);

  const rows = app.locator('.panel', { hasText: 'Cars in this group' }).locator('tbody tr');
  await expect(rows.locator('.name')).toHaveText(['Lotus 79', 'nissangtpzxt']);
  await expect(rows.locator('.version')).toHaveText(['v13 Shatter', 'v1']);
  await expect(rows.locator('.standing')).toHaveText(['', 'not in the sim']);
  // One of the two can be set, and nothing about a library's group is the driver's to change.
  await expect(app.locator('.group-actions button')).toHaveText(['Set on 1 car']);
  const leftOut = app.locator('.panel', { hasText: 'Not in this group' });
  await expect(leftOut).toContainText('No version called shatter for Mazda MX-5 Cup.');
  await expect(leftOut).toContainText('3 more cars on the rig have no livery in the library at all.');
  await expect(app.locator('.apply-options')).toBeVisible();

  // From a car in the group to that car, and the list follows.
  await rows.locator('.name button', { hasText: 'Lotus 79' }).click();
  await expect(app.locator('.car-head:not(.group-head) h2')).toHaveText('Lotus 79');
  await expect(app.locator('.sidebar .car.active .name')).toHaveText(['Lotus 79']);

  // While the cars are filtered the groups are out of the way.
  await app.locator('.sidebar .filter input').fill('mazda');
  await expect(app.locator('.sidebar .groups')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('setting a group is one click, and what became of each car is said beside it', async ({ page }) => {
  await stubPaintsBridge(page, { ...PAINTS, setGroup: SET_REPORT });
  await stubGroups(page, [SHATTER]);
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=paints');
  const app = page.locator('#paints-root > .paints-app');
  await app.locator('.sidebar .groups .car', { hasText: 'shatter' }).click();
  await app.locator('.group-actions button.primary').click();

  const rows = app.locator('.panel', { hasText: 'Cars in this group' }).locator('tbody tr');
  await expect(rows.locator('.outcome')).toHaveText([
    'applied', 'skipped — The car has no folder in the paint directory and is not in the iRacing install.',
  ]);
  const entry = app.locator('.log .entry.ok');
  await expect(entry).toContainText('Set shatter: 1 applied, 1 skipped');
  await expect(entry).toContainText('nissangtpzxt: The car has no folder in the paint directory and is not in the iRacing install.');
  expect(await paintsCalls(page, 'setGroup')).toEqual([groupRequest('library:shatter')]);
  expect(await paintsCalls(page, 'applyVersion')).toEqual([]);
  await expect(app.locator('.modal, .scrim, .refusal')).toHaveCount(0);

  // Another group's page does not show this one's outcomes.
  await app.locator('.sidebar .car:not(.livery-group)', { hasText: 'Lotus 79' }).click();
  await app.locator('.sidebar .groups .car', { hasText: 'shatter' }).click();
  await expect(rows.locator('.outcome')).toHaveText(['', '']);
  expect(errors).toEqual([]);
});

test('a group that cannot be set while the sim runs says so, and can be set anyway', async ({ page }) => {
  await stubPaintsBridge(page, {
    ...PAINTS,
    simStatus: { simRunning: true, uiRunning: true, matched: ['iRacingSim64DX11.exe'] },
    setGroup: { __by: 'force', answers: { true: { ...SET_REPORT, warnings: [`Set anyway, over a warning: ${SIM_RUNNING}`] }, '*': { __error: SIM_RUNNING } } },
  });
  await page.addInitScript(() => {
    const invoke = window.racingDesk.paints.invoke;
    window.racingDesk.paints.invoke = (name, args) =>
      invoke(name, name === 'setGroup' ? { ...args, force: String(args.request.force) } : args);
  });
  await stubGroups(page, [SHATTER]);
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=paints');
  const app = page.locator('#paints-root > .paints-app');
  await app.locator('.sidebar .groups .car', { hasText: 'shatter' }).click();
  await app.locator('.group-actions button.primary').click();

  const refusal = app.locator('.refusal');
  await expect(refusal).toContainText(SIM_RUNNING);
  await expect(refusal.getByRole('button')).toHaveText(['Set anyway', 'Dismiss']);
  await expect(app.locator('.log .entry.bad')).toContainText('Did not set shatter');

  await refusal.getByRole('button', { name: 'Set anyway' }).click();
  await expect(app.locator('.log .entry.ok')).toContainText('Set shatter: 1 applied, 1 skipped');
  await expect(app.locator('.log .entry.ok')).toContainText(`Set anyway, over a warning: ${SIM_RUNNING}`);
  await expect(refusal).toHaveCount(0);
  expect((await paintsCalls(page, 'setGroup')).map((c) => c.request.force)).toEqual([false, true]);
  expect(errors).toEqual([]);
});

test('a group of the driver\'s own is made from the cars\' versions, changed, and forgotten', async ({ page }) => {
  await stubPaintsBridge(page, PAINTS);
  await stubGroups(page, [SHATTER]);
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=paints');
  const app = page.locator('#paints-root > .paints-app');

  await app.locator('.sidebar .groups .heading button', { hasText: 'New' }).click();
  await expect(app.locator('.group-head h2')).toHaveText('New group');
  const editor = app.locator('.group-editor');
  // Every car with a livery, by name, and none of them in the group yet.
  await expect(editor.locator('tbody .name')).toHaveText(['Lotus 79', 'Mazda MX-5 Cup', 'nissangtpzxt']);
  for (const name of ['Lotus 79', 'Mazda MX-5 Cup', 'nissangtpzxt']) await expect(editor.getByLabel(name)).toHaveValue('');
  const make = editor.getByRole('button', { name: 'Make the group' });
  await expect(make).toBeDisabled();

  await editor.getByLabel('Name').fill('Race day');
  await expect(make).toBeDisabled();   // a name, and no car
  await editor.getByLabel('Lotus 79').selectOption('v12');
  await editor.getByLabel('Mazda MX-5 Cup').selectOption('orange');
  await expect(editor.locator('.group-actions .note')).toHaveText('2 cars in it');
  await make.click();

  expect(await paintsCalls(page, 'saveGroup')).toEqual([{
    libraryRoot: LIBRARY, paintDir: PAINT_DIR, id: null, name: 'Race day',
    cars: { lotus79: 'v12', 'mx5-mx52016': 'orange', nissangtpzxt: null },
  }]);
  await expect(app.locator('.group-head h2')).toHaveText('Race day');
  await expect(app.locator('.group-head .note')).toHaveText('A group of yours · 2 cars');
  await expect(app.locator('.sidebar .groups .car .name')).toHaveText(['Race day', 'shatter']);
  await expect(app.locator('.group-actions button')).toHaveText(['Set on 2 cars', 'Change', 'Forget this group']);
  await expect(app.locator('.log .entry.ok')).toContainText('Made the group Race day');

  // Changed: the editor opens on what the group has.
  await app.locator('.group-actions button', { hasText: 'Change' }).click();
  await expect(app.locator('.group-head h2')).toHaveText('Change Race day');
  await expect(editor.getByLabel('Name')).toHaveValue('Race day');
  await expect(editor.getByLabel('Lotus 79')).toHaveValue('v12');
  await editor.getByLabel('Lotus 79').selectOption('v13');
  await editor.getByLabel('Mazda MX-5 Cup').selectOption('');
  await editor.getByRole('button', { name: 'Save' }).click();
  expect((await paintsCalls(page, 'saveGroup')).at(-1)).toEqual({
    libraryRoot: LIBRARY, paintDir: PAINT_DIR, id: 'mine:race-day', name: 'Race day',
    cars: { lotus79: 'v13', 'mx5-mx52016': null, nissangtpzxt: null },
  });
  await expect(app.locator('.group-head .note')).toHaveText('A group of yours · 1 car');

  // A name another group has is refused where it was typed, and the editor stays.
  await app.locator('.sidebar .groups .heading button', { hasText: 'New' }).click();
  await editor.getByLabel('Name').fill('SHATTER');
  await editor.getByLabel('Lotus 79').selectOption('v12');
  await editor.getByRole('button', { name: 'Make the group' }).click();
  await expect(editor.locator('.banner.bad')).toContainText('There is a group called SHATTER already.');
  await editor.getByRole('button', { name: 'Cancel' }).click();
  await expect(app.locator('.group-head h2')).toHaveText('Race day');

  await app.locator('.group-actions button', { hasText: 'Forget this group' }).click();
  expect(await paintsCalls(page, 'deleteGroup')).toEqual([{ id: 'mine:race-day' }]);
  await expect(app.locator('.sidebar .groups .car .name')).toHaveText(['shatter']);
  await expect(app.locator('.car-head h2')).toHaveText('Lotus 79');   // back to the car that was being looked at
  expect(errors).toEqual([]);
});

test('"every car in" fills the group from a version the cars share', async ({ page }) => {
  const shared = (folder, name, extra) => car(folder, folder, [version('shatter', 'shatter', folder), version('shatter-inverted', 'shatter-inverted', folder), ...extra], name, name, true, 1);
  await stubPaintsBridge(page, {
    ...PAINTS,
    carCatalogue: [shared('lotus79', 'Lotus 79', [version('v14', 'v14')]), shared('dallarair18', 'Dallara IR18', []), car('audi90gto', 'audi90gto', [version('v1', 'v1', 'audi90gto')], 'Audi 90 GTO', 'Audi 90', true, 3)],
  });
  await stubGroups(page, []);
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=paints');
  const app = page.locator('#paints-root > .paints-app');
  await expect(app.locator('.sidebar .groups .heading')).toContainText('Groups 0');
  await app.locator('.sidebar .groups .heading button', { hasText: 'New' }).click();
  const editor = app.locator('.group-editor');

  await expect(editor.getByLabel('Every car in').locator('option')).toHaveText(['choose a version…', 'shatter (2 cars)', 'shatter-inverted (2 cars)']);
  await editor.getByLabel('Audi 90 GTO').selectOption('v1');
  await editor.getByLabel('Every car in').selectOption('shatter-inverted');
  await expect(editor.getByLabel('Dallara IR18')).toHaveValue('shatter-inverted');
  await expect(editor.getByLabel('Lotus 79')).toHaveValue('shatter-inverted');
  await expect(editor.getByLabel('Audi 90 GTO')).toHaveValue('v1');   // it has no such version, and keeps what it had
  await editor.getByLabel('Lotus 79').selectOption('v14');
  await editor.getByLabel('Name').fill('Inverted');
  await editor.getByRole('button', { name: 'Make the group' }).click();

  expect(await paintsCalls(page, 'saveGroup')).toEqual([{
    libraryRoot: LIBRARY, paintDir: PAINT_DIR, id: null, name: 'Inverted',
    cars: { audi90gto: 'v1', dallarair18: 'shatter-inverted', lotus79: 'v14' },
  }]);
  expect(errors).toEqual([]);
});

test('in the Tauri shell there is no catalogue: the list is the library\'s cars, by folder', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
  const rust = {
    load_settings: {}, save_settings: null, detect_paths: PAINTS.detectPaths, detect_customer: PAINTS.detectCustomer,
    suggest_libraries: PAINTS.suggestLibraries, car_state: PAINTS.carState, list_backups: [],
    trading_paints_status: PAINTS.tradingPaintsStatus, sim_status: PAINTS.simStatus, repo_status: PLAIN_FOLDER, repo_check: PLAIN_FOLDER,
    preview_image: PAINTS.previewImage,
    scan_library: {
      root: LIBRARY,
      cars: CATALOGUE.filter((c) => c.versions.length > 0).map(({ folder, simFolder, simFolderInferred, versions }) => ({ folder, simFolder, simFolderInferred, versions })),
      notes: [],
    },
  };
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('about:blank');
  await page.evaluate((canned) => {
    window.__rust = [];
    window.__TAURI_INTERNALS__ = {
      invoke: (cmd, args) => {
        window.__rust.push({ cmd, args });
        return cmd in canned ? Promise.resolve(JSON.parse(JSON.stringify(canned[cmd]))) : Promise.reject(`Command ${cmd} not found`);
      },
      transformCallback: (cb) => cb,
    };
    document.body.style.cssText = 'margin:0;height:100vh';
    const root = document.createElement('div');
    root.id = 'root';
    root.style.height = '100%';
    document.body.append(root);
  }, rust);
  await page.addStyleTag({ path: join(here, '..', '..', 'modules', 'desk', 'paints.bundle.css') });
  await page.addScriptTag({ path: join(here, '..', '..', 'modules', 'desk', 'paints.bundle.js') });
  await page.evaluate(() => window.RacingDeskPaints.mount(document.getElementById('root')));

  const app = page.locator('#root > .paints-app');
  await expect(app.locator('.sidebar .group .heading')).toHaveText(['Liveries 3']);
  await expect(app.locator('.sidebar .groups')).toHaveCount(0);   // groups are the desk's
  await expect(app.locator('.sidebar .car .name')).toHaveText(['lotus79', 'mx5-mx52016', 'nissangtpzxt']);
  await expect(app.locator('.sidebar .car .meta')).toHaveText(['2 versions', '1 version · installs to mx5 mx52016', '1 version · not in the sim']);
  await expect(app.locator('.car-head h2')).toHaveText('lotus79');
  await expect(app.locator('.versions .card .head .name')).toHaveText(['v12 Shatter', 'v13 Shatter']);
  const asked = await page.evaluate(() => window.__rust.map((c) => c.cmd));
  expect(asked.filter((c) => c === 'car_catalogue')).toHaveLength(1);
  expect(await page.evaluate(() => window.__rust.filter((c) => c.cmd === 'scan_library').map((c) => c.args)))
    .toEqual([{ libraryRoot: LIBRARY, paintDir: PAINT_DIR }]);
  expect(errors).toEqual([]);
});

test('without the app the Paints page says so instead of mounting the manager', async ({ page }) => {
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=paints');
  await expect(page.locator('#paints-note')).toBeVisible();
  await expect(page.locator('#paints-note')).toContainText('needs the Racing Desk app');
  await expect(page.locator('#paints-unbuilt')).toBeHidden();
  expect(await page.locator('.paints-app').count()).toBe(0);
  expect(errors).toEqual([]);
});
