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

function startMockHost(history, schedule = SCHEDULE) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(body));
    };
    const route = url.pathname.replace('/racing-desk/data/', '');
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
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

let host;

test.beforeAll(async () => {
  execFileSync(process.execPath, [join(here, '..', '..', '..', '..', 'packages', 'calc', 'build.mjs')], { stdio: 'pipe' });
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
// the desk asks of it.
async function stubBridge(page, settings) {
  await page.addInitScript((initial) => {
    window.__k10 = { opened: [], saved: [], settings: initial };
    window.racingDesk = {
      getSettings: async () => JSON.parse(JSON.stringify(window.__k10.settings)),
      saveSettings: async (s) => { window.__k10.saved.push(s); window.__k10.settings = s; return true; },
      openExternal: async (url) => { window.__k10.opened.push(url); },
    };
  }, settings);
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
