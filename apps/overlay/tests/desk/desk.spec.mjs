// The desk window (desk.html) over a mock RacingDesk.Host data API: synthetic history, headless, no network.
//
//   npx playwright test --project=desk

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { answerRefusal } from '../this-machine-rule.mjs';

const require = createRequire(import.meta.url);
const { createDeskReads } = require('../../modules/js/desk-reads.js');

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
      irating: ir, license: `C ${sr.toFixed(2)}`, safety_rating: Number(sr.toFixed(2)),
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

// The host keeps what it was asked in `asked`, and takes nothing but a GET: a page's write is refused, as
// RacingDesk.Host refuses it. It has no cars, views or pedals to give. What the host keeps per car reaches the Cars
// page through the app (window.racingDesk.rig, stubRig below), and a page that asked the host for any of it
// itself would be at fault: the tests look in `asked` for that.
//
// It answers whom RacingDesk.Host answers (tests/this-machine-rule.mjs): a program on this machine that names this machine at
// its own port and says no Origin; anything else — a page of any origin, the desk's own (a file, which says null) included —
// is a 403 with no CORS header, written to `refused`, and nothing is ever sent a CORS header. The desk reads through the
// app's main process (window.racingDesk.desk, bridged below by openDesk to the real modules/js/desk-reads.js), so every test
// here that finds the desk drawn from this host is also a test that the app's own requests are ones the host answers.
function startMockHost(history, schedule = SCHEDULE, port = 0) {
  const server = http.createServer((req, res) => {
    if (answerRefusal(req, res, server.address().port, server.refused)) return;
    const url = new URL(req.url, 'http://x');
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const route = url.pathname.replace('/racing-desk/data/', '');
    server.asked.push({ method: req.method, route, host: req.headers.host, origin: req.headers.origin });
    if (req.method !== 'GET') return send(403, { error: 'Writes are for local programs.' });
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
  server.refused = [];
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

// One more session at the end of a history: a practice in `car`, an hour after the last — or at `startedAt`.
function driveAfter(history, car, startedAt = null) {
  const last = history.sessions.at(-1);
  history.sessions.push({
    ...last, id: last.id + 1, ibt_path: `practice-${car.path}.ibt`, subsession_id: last.subsession_id + 1, official: 0,
    car_path: car.path, car_id: car.id, car_screen_name: car.name, session_num: 0, event_type: 'Practice', session_type: 'Practice',
    started_at: startedAt ?? new Date(Date.parse(last.started_at) + 3600e3).toISOString(), duration_s: 1200, laps_completed: 5,
    start_position: 0, finish_position: 0, finish_position_in_class: 0,
  });
  return history;
}
const LOTUS = { id: 42, path: 'lotus79', name: 'Lotus 79' };

// Two hosts. In `host`'s history the car driven last is the McLaren. The Cars page opens on the car driven last,
// so the tests of a car's liveries are over `lotusHost`, where that is the Lotus: a car with liveries to apply.
let host;
let lotusHost;
const lotusLast = () => `http://127.0.0.1:${lotusHost.address().port}`;

test.beforeAll(async () => {
  execFileSync(process.execPath, [join(here, '..', '..', '..', '..', 'packages', 'calc', 'build.mjs')], { stdio: 'pipe' });
  execFileSync(process.execPath, [join(here, '..', '..', '..', 'paints', 'build-island.mjs')], { stdio: 'pipe' });
  host = await startMockHost(buildHistory());
  lotusHost = await startMockHost(driveAfter(buildHistory(), LOTUS));
});

test.afterAll(async () => {
  await new Promise((resolve) => host?.close(resolve));
  await new Promise((resolve) => lotusHost?.close(resolve));
});

// The app's half of the desk's reads, as main.js has it: the page asks window.racingDesk.desk.read and Node asks the host
// (modules/js/desk-reads.js, the real one), which sends a Host and no Origin. The host a page is read from is the one
// openDesk was given for it (`?host=`, as main.js loads the desk with it); a test that wants another bridge puts its own in
// before openDesk, and this one keeps to what that left (`desk` is only added when there is none).
const hostOfPage = new WeakMap();
const bridged = new WeakSet();
async function bridgeDeskReads(page, hostUrl) {
  hostOfPage.set(page, hostUrl);
  if (bridged.has(page)) return;
  bridged.add(page);
  const reads = createDeskReads({ host: () => hostOfPage.get(page) });
  await page.exposeFunction('__deskRead', (name, id) => reads.read(name, id));
  await page.addInitScript(() => {
    window.racingDesk = Object.assign(window.racingDesk || {}, { desk: (window.racingDesk || {}).desk || { read: (name, id) => window.__deskRead(name, id) } });
  });
}

// `timers` hands the page's clock to the test (page.clock.runFor), for what happens every so often: the time is
// NOW and moves on from it. Without, the time is NOW for good and the page's timers run as they would.
async function openDesk(page, hostUrl, query = '', { timers = false, bridge = true } = {}) {
  const errors = [];
  if (bridge) await bridgeDeskReads(page, hostUrl);
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    if (/typekit\.net/.test(msg.location().url)) return; // blocked below; the desk falls back to system fonts
    errors.push(msg.text());
  });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort()); // Typekit and anything else off-machine
  if (timers) await page.clock.install({ time: NOW });
  else await page.clock.setFixedTime(NOW);
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

// ── The host's data is for programs on this machine ──────────
// RacingDesk.Host answers a program on this machine that names this machine at the host's own port and says no Origin, and
// refuses every page, the desk's own included (apps/host LocalDataApi; tests/this-machine-rule.mjs is the stand-in's copy of
// the rule): a file's page says Origin: null, and so does any web page redirected to the host, sandboxed or opened from disk. So
// the desk's page asks the app's main process (window.racingDesk.desk.read), which asks as Node does; openDesk bridges that to
// the real modules/js/desk-reads.js.

test('reads the host through the app: no request of the page\'s own, a Host and no Origin from Node, and every read answered', async ({ page }) => {
  const own = await startMockHost(buildHistory());
  const port = own.address().port;
  const fromThePage = [];
  page.on('request', (request) => { if (request.url().startsWith(`http://127.0.0.1:${port}`)) fromThePage.push(request.url()); });
  try {
    await openDesk(page, `http://127.0.0.1:${port}`);
    await expect(page.locator('.race-row')).toHaveCount(30);
    await expect(page.locator('#offline')).toBeHidden();
    // A race's laps are a fourth read.
    await page.locator('.race-row').first().click();
    await expect(page.locator('.laps-table tbody tr')).not.toHaveCount(0);

    const routes = new Set(own.asked.map((a) => a.route.split('?')[0]));
    expect([...routes].sort()).toEqual(['schedule', 'session', 'sessions', 'status']);
    for (const a of own.asked) {
      expect(a.origin, `${a.method} ${a.route}: Node sends no Origin`).toBeUndefined();
      expect(a.host, `${a.method} ${a.route}: it names the host it was given, at its port`).toBe(`127.0.0.1:${port}`);
    }
    expect(fromThePage, 'the page asked the host for nothing itself: it would be refused').toEqual([]);
    expect(own.refused, 'the host refused none of the app\'s requests').toEqual([]);
  } finally {
    await new Promise((resolve) => own.close(resolve));
  }
});

test('the host refuses the page that asks itself, as it does any page: a fetch from the desk gets a 403 and no CORS header', async ({ page }) => {
  // What the desk did before it went through the app, and what any page open on the rig could do: the host does not tell a file's
  // page from a web page that says Origin: null, so neither reads it, and nothing is sent a header that would let one.
  const own = await startMockHost(buildHistory());
  const port = own.address().port;
  try {
    await openDesk(page, `http://127.0.0.1:${port}`);
    await expect(page.locator('.race-row')).toHaveCount(30);
    own.asked.length = 0;
    const seen = await page.evaluate(async (url) => {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        return { read: true, status: res.status, text: await res.text() };
      } catch (err) {
        return { read: false, error: String(err) };
      }
    }, `http://127.0.0.1:${port}/racing-desk/data/sessions`);
    expect(seen.read, 'a page cannot read the answer: it has no CORS header').toBe(false);
    expect(own.asked, 'and the host did not answer the request').toEqual([]);
    expect(own.refused.map((r) => r.why)).toEqual(['AWebSite']);
    expect(own.refused[0].origin).toBe('null');
  } finally {
    await new Promise((resolve) => own.close(resolve));
  }
});

test('does not ask a host that is on another machine, and says why', async ({ page }) => {
  const asked = [];
  page.on('request', (request) => { if (request.url().startsWith('http://192.168.1.20')) asked.push(request.url()); });
  await openDesk(page, 'http://192.168.1.20:8889');

  await expect(page.locator('#offline')).toBeVisible();
  await expect(page.locator('#offline-reason')).toContainText('not on this machine');
  await expect(page.locator('#offline-reason')).toContainText('192.168.1.20:8889');
  await page.waitForTimeout(300);
  expect(asked, 'nothing was sent to it').toEqual([]);
});

test('a host that refuses the app (a 403) is told apart from one that is not answering', async ({ page }) => {
  // A refusal says nothing a page may read when the page asks itself; the app asks, so the desk sees it and says so.
  const refusing = http.createServer((req, res) => {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'this is for the app on this machine' }));
  });
  await new Promise((resolve) => refusing.listen(0, '127.0.0.1', resolve));
  try {
    await openDesk(page, `http://127.0.0.1:${refusing.address().port}`);
    await expect(page.locator('#offline')).toBeVisible();
    await expect(page.locator('#offline-reason')).toContainText(`127.0.0.1:${refusing.address().port}`);
    await expect(page.locator('#offline-reason')).toContainText('refused');
    await expect(page.locator('.race-row')).toHaveCount(0);
  } finally {
    await new Promise((resolve) => refusing.close(resolve));
  }
});

test('a desk page that is not in the app (no bridge) says so and asks nobody', async ({ page }) => {
  const own = await startMockHost(buildHistory());
  try {
    await openDesk(page, `http://127.0.0.1:${own.address().port}`, '', { bridge: false });
    await expect(page.locator('#offline')).toBeVisible();
    await expect(page.locator('#offline-reason')).toContainText('not open in it');
    await page.waitForTimeout(300);
    expect(own.asked).toEqual([]);
    expect(own.refused).toEqual([]);
  } finally {
    await new Promise((resolve) => own.close(resolve));
  }
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

// ── Pages ────────────────────────────────────────────────────

test('the masthead nav switches pages and the hash follows', async ({ page }) => {
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`);
  await expect(page.locator('.nav a')).toHaveText(['Desk', 'Cars', 'Settings']);
  await expect(page.locator('#desk')).toBeVisible();
  await expect(page.locator('#cars-page')).toBeHidden();
  await expect(page.locator('#settings')).toBeHidden();
  await expect(page.locator('.nav a[aria-current="page"]')).toHaveText('Desk');

  await page.locator('.nav a', { hasText: 'Cars' }).click();
  await expect(page.locator('#cars-page')).toBeVisible();
  await expect(page.locator('#cars-page')).toContainText('need the Racing Desk app');
  await expect(page.locator('#desk')).toBeHidden();
  await expect(page.locator('.nav a[aria-current="page"]')).toHaveText('Cars');
  expect(new URL(page.url()).hash).toBe('#cars');

  await page.locator('.nav a', { hasText: 'Settings' }).click();
  await expect(page.locator('#settings')).toBeVisible();
  await expect(page.locator('#cars-page')).toBeHidden();
  await expect(page.locator('.nav a[aria-current="page"]')).toHaveText('Settings');
  expect(new URL(page.url()).hash).toBe('#settings');

  await page.locator('.nav a', { hasText: 'Desk' }).click();
  await expect(page.locator('#desk')).toBeVisible();
  await expect(page.locator('.race-row')).toHaveCount(30);
  // #cars is the hash of the Cars page and the id of the desk page's Car affinity card: it is still the card,
  // and the desk was not scrolled to it on the way.
  await expect(page.locator('#cars .name')).toHaveCount(2);
  await expect(page.locator('#cars h2')).toHaveText('Car affinity');
  expect(await page.locator('#desk').evaluate((el) => el.scrollTop)).toBe(0);
  expect(errors).toEqual([]);
});

test('?page=settings opens on Settings', async ({ page }) => {
  await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=settings');
  await expect(page.locator('#settings')).toBeVisible();
  await expect(page.locator('#desk')).toBeHidden();
  await expect(page.locator('.nav a[aria-current="page"]')).toHaveText('Settings');
  expect(new URL(page.url()).hash).toBe('#settings');
});

test('Paints was a page of its own: its name, from the app or in an old link, leads to Cars', async ({ page }) => {
  // The app asks for a page by name while the window is up (the tray's entries); the stand-in keeps the way in.
  await page.addInitScript(() => {
    window.racingDesk = { onShowPage: (show) => { window.__show = show; } };
  });
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=paints');
  const onCars = async () => {
    await expect(page.locator('#cars-page')).toBeVisible();
    await expect(page.locator('#desk')).toBeHidden();
    await expect(page.locator('.nav a[aria-current="page"]')).toHaveText('Cars');
    await expect.poll(() => new URL(page.url()).hash).toBe('#cars');
  };
  await onCars();

  await page.evaluate(() => window.__show('settings'));
  await expect(page.locator('#settings')).toBeVisible();
  await page.evaluate(() => window.__show('cars'));   // the tray's one entry for the page
  await onCars();

  await page.evaluate(() => window.__show('settings'));
  await page.evaluate(() => window.__show('paints'));
  await onCars();

  await page.evaluate(() => { location.hash = '#settings'; });
  await expect(page.locator('#settings')).toBeVisible();
  await page.evaluate(() => { location.hash = '#paints'; });
  await onCars();
  // A name that was never a page's is the desk, as it was.
  await page.evaluate(() => { location.hash = '#constructor'; });
  await expect(page.locator('#desk')).toBeVisible();
  expect(errors).toEqual([]);
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

// ── Settings: the HUD's screen ───────────────────────────────
// main.js says which screens are connected and which one the HUD is on (get-hud-displays); the page offers Automatic
// and each screen by a plain name. This stand-in is his rig: a small primary on the left, the ultrawide on the right,
// and it answers as the app does — the HUD is on the chosen screen while it is connected, else where iRacing is.

const RIG_SCREENS = [
  { key: '2', name: '1440 × 1080 (left, primary)', primary: true },
  { key: '1', name: '3440 × 1440 (right)', primary: false },
];

async function stubHudScreens(page, { displays = RIG_SCREENS, simOn = '1' } = {}) {
  await page.addInitScript((start) => {
    // `displays` is what is connected now; a test changes it and calls `changed()` as the app does when a screen goes or comes.
    window.__hud = { asked: 0, displays: start.displays, simOn: start.simOn, changed: null };
    Object.assign(window.racingDesk, {
      getHudDisplays: async () => {
        window.__hud.asked += 1;
        const shown = window.__hud.displays;
        const choice = window.__k10.settings.hudDisplay;
        const chosen = shown.find((d) => d.key === choice);
        const using = chosen || shown.find((d) => d.key === window.__hud.simOn) || shown[0];
        return {
          displays: shown,
          using: { key: using.key, name: using.name, reason: chosen ? 'chosen' : 'sim', why: chosen ? 'you chose it in Settings' : 'iRacing is running on it' },
          choiceMissing: !!choice && choice !== 'auto' && !chosen,
        };
      },
      onHudDisplaysChanged: (callback) => { window.__hud.changed = callback; },
    });
  }, { displays, simOn });
}

test('the HUD screen is Automatic until he chooses, and names each connected screen and where the HUD is', async ({ page }) => {
  await stubBridge(page, { zoom: 120 });
  await stubHudScreens(page);
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=settings');
  const control = page.locator('#setting-hudDisplay');
  await expect(page.locator('label[for="setting-hudDisplay"]')).toHaveText('HUD screen');
  await expect(control).toBeEnabled();
  await expect(control).toHaveValue('auto');
  await expect(control.locator('option')).toHaveText([
    'Automatic (the screen iRacing is on)', '1440 × 1080 (left, primary)', '3440 × 1440 (right)',
  ]);
  await expect(page.locator('#setting-hudDisplay-note')).toHaveText('Now on 3440 × 1440 (right): iRacing is running on it.');
  // In Layout, where the HUD's placement already is.
  await expect(page.locator('#settings-layout #setting-hudDisplay')).toHaveCount(1);
  // Looking at the page writes nothing.
  expect(await page.evaluate(() => window.__k10.saved.length)).toBe(0);
  expect(errors).toEqual([]);
});

test('choosing a screen writes it into the settings, beside everything else, and says where the HUD went', async ({ page }) => {
  const seed = { zoom: 120, raceLinks: { 'Caterham Academy Challenge': '6273' } };
  await stubBridge(page, seed);
  await stubHudScreens(page);
  await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=settings');

  await page.locator('#setting-hudDisplay').selectOption('2');
  await expect.poll(() => page.evaluate(() => window.__k10.saved.length)).toBe(1);
  expect(await page.evaluate(() => window.__k10.saved[0])).toEqual({ ...seed, hudDisplay: '2' });
  await expect(page.locator('#settings-status')).toHaveText(/Saved/);
  await expect(page.locator('#setting-hudDisplay-note')).toHaveText('Now on 1440 × 1080 (left, primary): you chose it in Settings.');

  // Back to Automatic: the HUD follows iRacing again.
  await page.locator('#setting-hudDisplay').selectOption('auto');
  await expect.poll(() => page.evaluate(() => window.__k10.saved.length)).toBe(2);
  expect(await page.evaluate(() => window.__k10.saved[1].hudDisplay)).toBe('auto');
  await expect(page.locator('#setting-hudDisplay-note')).toHaveText('Now on 3440 × 1440 (right): iRacing is running on it.');
});

test('a screen he chose that is not connected is shown as such, kept for when it is, and Automatic clears it', async ({ page }) => {
  await stubBridge(page, { hudDisplay: '7', zoom: 120 });
  await stubHudScreens(page);
  await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=settings');
  const control = page.locator('#setting-hudDisplay');
  // Selected as what it is, so that choosing Automatic is a change that is written.
  await expect(control).toHaveValue('7');
  await expect(control.locator('option')).toHaveText([
    'Automatic (the screen iRacing is on)', '1440 × 1080 (left, primary)', '3440 × 1440 (right)', 'The screen you chose (not connected)',
  ]);
  await expect(page.locator('#setting-hudDisplay-note')).toContainText('The screen you chose is not connected');
  await expect(page.locator('#setting-hudDisplay-note')).toContainText('Now on 3440 × 1440 (right)');
  expect(await page.evaluate(() => window.__k10.saved.length)).toBe(0);

  // Changing something else does not lose it.
  await page.locator('#setting-layoutPosition').selectOption('bottom-left');
  await expect.poll(() => page.evaluate(() => window.__k10.saved.length)).toBe(1);
  expect(await page.evaluate(() => window.__k10.saved[0])).toEqual({ hudDisplay: '7', zoom: 120, layoutPosition: 'bottom-left' });

  // Choosing Automatic writes it: the stale key was what stayed in the file.
  await control.selectOption('auto');
  await expect.poll(() => page.evaluate(() => window.__k10.saved.length)).toBe(2);
  expect(await page.evaluate(() => window.__k10.saved[1])).toEqual({ hudDisplay: 'auto', zoom: 120, layoutPosition: 'bottom-left' });
  await expect(control).toHaveValue('auto');
  await expect(control.locator('option')).toHaveText(['Automatic (the screen iRacing is on)', '1440 × 1080 (left, primary)', '3440 × 1440 (right)']);
  await expect(page.locator('#setting-hudDisplay-note')).toHaveText('Now on 3440 × 1440 (right): iRacing is running on it.');
});

test('a screen plugged in or taken out while Settings is open is in the list when the app says so', async ({ page }) => {
  await stubBridge(page, { hudDisplay: '3', zoom: 120 });
  await stubHudScreens(page);
  await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=settings');
  const control = page.locator('#setting-hudDisplay');
  await expect(control).toHaveValue('3');
  await expect(control.locator('option')).toHaveCount(4);   // Automatic, the two, and the one that is not there

  // The third screen he chose is plugged in: the app tells the desk, and the list is read again.
  await page.evaluate(() => {
    window.__hud.displays = [...window.__hud.displays, { key: '3', name: '1920 × 1080 (right)', primary: false }];
    window.__hud.changed();
  });
  await expect(control.locator('option')).toHaveText([
    'Automatic (the screen iRacing is on)', '1440 × 1080 (left, primary)', '3440 × 1440 (right)', '1920 × 1080 (right)',
  ]);
  await expect(control).toHaveValue('3');
  await expect(page.locator('#setting-hudDisplay-note')).toHaveText('Now on 1920 × 1080 (right): you chose it in Settings.');

  // And it is taken out again: the choice stays, as one that is not connected.
  await page.evaluate(() => {
    window.__hud.displays = window.__hud.displays.filter((d) => d.key !== '3');
    window.__hud.changed();
  });
  await expect(control.locator('option')).toHaveText([
    'Automatic (the screen iRacing is on)', '1440 × 1080 (left, primary)', '3440 × 1440 (right)', 'The screen you chose (not connected)',
  ]);
  await expect(control).toHaveValue('3');
  // Nothing was written by any of it.
  expect(await page.evaluate(() => window.__k10.saved.length)).toBe(0);
});

test('the screens changing while another page is showing changes nothing on the Settings page, which reads them when it is shown', async ({ page }) => {
  await stubBridge(page, { zoom: 120 });
  await stubHudScreens(page);
  await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=desk');
  await page.evaluate(() => { window.__hud.changed(); });
  expect(await page.evaluate(() => window.__hud.asked)).toBe(0);
  await page.evaluate(() => { window.__hud.displays = [window.__hud.displays[0]]; });
  await page.locator('a[data-page-link="settings"]').click();
  await expect(page.locator('#setting-hudDisplay option')).toHaveText(['Automatic (the screen iRacing is on)', '1440 × 1080 (left, primary)']);
});

test('with one screen there is Automatic and that screen', async ({ page }) => {
  await stubBridge(page, {});
  await stubHudScreens(page, { displays: [{ key: '1', name: '2560 × 1440 (primary)', primary: true }], simOn: '1' });
  await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=settings');
  await expect(page.locator('#setting-hudDisplay option')).toHaveText(['Automatic (the screen iRacing is on)', '2560 × 1440 (primary)']);
});

test('an app that cannot say which screens there are offers Automatic alone, still enabled', async ({ page }) => {
  await stubBridge(page, {});
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=settings');
  await expect(page.locator('#setting-hudDisplay')).toBeEnabled();
  await expect(page.locator('#setting-hudDisplay option')).toHaveText(['Automatic (the screen iRacing is on)']);
  await expect(page.locator('#setting-hudDisplay-note')).toHaveText('');
  expect(errors).toEqual([]);
});

test('without the app the Settings page is read-only and says so', async ({ page }) => {
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=settings');
  await expect(page.locator('#settings-note')).toBeVisible();
  await expect(page.locator('#settings-note')).toContainText('needs the Racing Desk app');
  await expect(page.locator('#setting-zoom')).toBeDisabled();
  await expect(page.locator('#setting-zoom')).toHaveValue('165'); // the HUD's default
  await expect(page.locator('#setting-showSpotter')).toBeChecked();
  await expect(page.locator('#setting-hudDisplay')).toBeDisabled();
  await expect(page.locator('#setting-hudDisplay')).toHaveValue('auto');
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

// ── Cars: the list, and a car's liveries ─────────────────────
// The Cars page is the livery manager's island (apps/paints/src, bundled by build-island.mjs in beforeAll) over a
// stubbed window.racingDesk.paints: a canned answer per command, every call recorded. The stand-in is put beside
// whatever else of the bridge a test has stood in, so a test can have the rig's half too (stubRig, further down). An answer of { __error } rejects the
// way preload.js does, with an Error carrying the command's own message; { __after: ms, answer } answers that much
// later; { __by: 'carFolder', answers } picks the answer by that argument ('*' for the rest); { __in_turn: [...] }
// answers each call with the next, and with the last from then on.

const PAINT_DIR = 'C:\\Users\\Owner\\Documents\\iRacing\\paint';
const LIBRARY = 'C:\\Users\\Owner\\Documents\\GitHub\\liveries\\cars';
const CUSTOMER = '424242';
const APP = '#cars-root > .paints-app';
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
  car('mclaren570sgt4', 'mclaren570sgt4', [], 'McLaren 570S GT4', '570S GT4', true, 45),
  car('nissangtpzxt', null, [version('v1', 'v1', 'nissangtpzxt')], null, null, false, 0),
  car('oldcar', 'oldcar', [], null, null, false, 0),
];

// The library keeps itself up to date unless he turned it off, so the tests that are about something else have it off:
// nothing asks the remote, or the sim, that they are not counting. The tests of the updating itself say what is saved
// (`loadSettings`), and that includes saying nothing.
const PAINTS = {
  loadSettings: { autoUpdateLibrary: false },
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
  listDefaultHelmetBackups: [],
  tradingPaintsStatus: {
    configFound: false, configPath: null, running: false, userId: null, downloadMySchemes: null, deleteBeforeDownloading: null,
    deleteAfterSession: null, keepSynced: null, warnings: [],
  },
  simStatus: { simRunning: false, uiRunning: false, matched: [] },
  repoStatus: PLAIN_FOLDER,
  repoCheck: PLAIN_FOLDER, // asked once per library, when a livery is in reach (updating by itself is off here)
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
      if (special('__in_turn')) {
        answer.given = (answer.given ?? 0) + 1;
        return give(answer.__in_turn[Math.min(answer.given, answer.__in_turn.length) - 1], args);
      }
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
    window.racingDesk = Object.assign(window.racingDesk || {}, {
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
    });
  }, answers);
}

const NO_APP = {
  view: 'A car\'s view is kept by the Racing Desk app, and this page is running without it.',
  pedals: 'A car\'s pedals are kept by the Racing Desk app, and this page is running without it.',
};
const paintsCalls = (page, name) => page.evaluate((n) => window.__paints.calls.filter((c) => c.name === n).map((c) => c.args), name);

test('the Cars page is the livery manager: the paint folder it found, the cars by name and the first one\'s versions', async ({ page }) => {
  await stubPaintsBridge(page, PAINTS);
  const errors = await openDesk(page, lotusLast(), '&page=cars');
  await expect(page.locator('#cars-page')).toBeVisible();
  await expect(page.locator('#cars-unbuilt')).toBeHidden();
  await expect(page.locator('#cars-note')).toBeHidden();
  const app = page.locator(APP);
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

  // Cars are called what the sim calls them; the one driven last is the one shown.
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
  // This stand-in is the livery manager's half of the bridge and no more: the car's view and pedals say there is
  // no app to ask, and nothing else on the page is the worse for it.
  await expect(app.locator('.car-view .note')).toHaveText(NO_APP.view);
  await expect(app.locator('.car-pedals .note')).toHaveText(NO_APP.pedals);
  await expect(app.locator('.car-pedals select')).toHaveCount(0);
  await expect(app.locator('.sidebar .mark')).toHaveCount(0);
  expect(await paintsCalls(page, 'carCatalogue')).toEqual([{ libraryRoot: LIBRARY, paintDir: PAINT_DIR }]);
  expect(await paintsCalls(page, 'scanLibrary')).toEqual([]);   // the catalogue reads the library itself
  expect(await paintsCalls(page, 'carState')).toEqual([{ paintDir: PAINT_DIR, libraryRoot: LIBRARY, carFolder: 'lotus79', simFolder: 'lotus79', customerId: CUSTOMER }]);

  // What it worked out is remembered through the bridge, in the Settings shape.
  await expect.poll(() => paintsCalls(page, 'saveSettings')).toEqual([{
    settings: { paintDir: PAINT_DIR, libraryRoot: LIBRARY, customerId: CUSTOMER, includeSpec: true, setReadOnlyAfter: false, clearOtherCooked: false, autoUpdateLibrary: false },
  }]);

  // Leaving the page and coming back finds the same island, not a second one.
  await page.locator('.nav a', { hasText: 'Desk' }).click();
  await expect(page.locator('#cars-page')).toBeHidden();
  await page.locator('.nav a', { hasText: 'Cars' }).click();
  await expect(app.locator('.versions .card')).toHaveCount(2);
  expect(await page.locator('.paints-app').count()).toBe(1);

  // Refresh asks for the cars again, and the car being looked at stays the one being looked at.
  await app.locator('.setup .status button', { hasText: 'Refresh' }).click();
  await expect.poll(() => paintsCalls(page, 'carCatalogue')).toHaveLength(2);
  await expect(app.locator('.car-head h2')).toHaveText('Lotus 79');
  expect(errors).toEqual([]);
});

test('the list of cars: cars with a livery, then the rest, each by name, and a filter over both', async ({ page }) => {
  await stubPaintsBridge(page, PAINTS);
  const errors = await openDesk(page, lotusLast(), '&page=cars');
  const app = page.locator(APP);
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
  await expect(app.getByRole('button', { name: 'Driven', exact: true })).toBeFocused();       // the cars he has driven
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
  const errors = await openDesk(page, lotusLast(), '&page=cars');
  const app = page.locator(APP);
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
  const again = page.locator(APP);
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
  const errors = await openDesk(page, lotusLast(), '&page=cars');
  const app = page.locator(APP);
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
  const errors = await openDesk(page, lotusLast(), '&page=cars');
  const app = page.locator(APP);
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

test('a card says which helmet comes with the version, and an apply says where it went', async ({ page }) => {
  // The library keeps helmets, and names one for v13 and none for v12; the Mazda's version knows nothing of them.
  const HELMET = { set: 'shatter-inverted', body: [220, 55, 20], art: [10, 10, 10] };
  const lotus = car('lotus79', 'lotus79', [{ ...version('v12', 'v12 Shatter'), helmet: null }, { ...version('v13', 'v13 Shatter'), helmet: HELMET }], 'Lotus 79', 'Lotus 79', true, 41);
  // The car got its version's helmet; the default is the library's default set, put in place by the same apply.
  const said = 'The shatter-inverted helmet is on the car. The shatter helmet is now the default for every car without a helmet of its own.';
  await stubPaintsBridge(page, {
    ...PAINTS,
    carCatalogue: CATALOGUE.map((c) => (c.folder === 'lotus79' ? lotus : c)),
    applyVersion: { ...PAINTS.applyVersion, helmet: { set: 'shatter-inverted', onCar: true, defaultSet: 'shatter', defaultPut: true, said } },
  });
  const errors = await openDesk(page, lotusLast(), '&page=cars');
  const app = page.locator(APP);
  const cards = app.locator('.versions .card');
  await expect(cards.locator('.helmet')).toHaveText(['No helmet comes with this version.', 'Comes with the shatter-inverted helmet.']);
  // The swatch is the set's two colours, body and art, and a version with no helmet has none.
  const swatch = cards.nth(1).locator('.helmet .swatch');
  await expect(swatch).toHaveCount(1);
  await expect(cards.nth(0).locator('.helmet .swatch')).toHaveCount(0);
  const background = await swatch.evaluate((el) => el.style.background);
  expect(background).toContain('rgb(220, 55, 20)');
  expect(background).toContain('rgb(10, 10, 10)');
  await expect(app.locator('.helmet-said')).toHaveCount(0);

  await cards.nth(1).locator('.actions button.primary').click();
  await expect(app.locator('.helmet-said')).toHaveText(said);
  await expect(app.locator('.log .entry.ok')).toContainText(said);
  expect(await paintsCalls(page, 'applyVersion')).toEqual([applyRequest()]);

  // The sentence is under the cards it was done from: another car does not carry it, and its own version says
  // nothing of helmets where the library keeps none for it; coming back, the sentence is gone.
  await app.locator('.sidebar .car', { hasText: 'Mazda MX-5 Cup' }).first().click();
  await expect(app.locator('.car-head h2')).toHaveText('Mazda MX-5 Cup');
  await expect(app.locator('.versions .card')).toHaveCount(1);
  await expect(app.locator('.versions .card .helmet')).toHaveCount(0);
  await expect(app.locator('.helmet-said')).toHaveCount(0);
  await app.locator('.sidebar .car', { hasText: 'Lotus 79' }).click();
  await expect(app.locator('.car-head h2')).toHaveText('Lotus 79');
  await expect(app.locator('.helmet-said')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a version that comes with a helmet that cannot be used says why on its card, in the words an apply uses, and the apply says it too', async ({ page }) => {
  // A set whose file is missing, and one the list names outside its helmets folder: each version still comes with it,
  // and neither has a swatch to show.
  const GONE = { set: 'shatter', body: [10, 10, 10], art: [220, 55, 20], problem: "The shatter helmet's file is not in the library." };
  const OUT = { set: 'up', body: null, art: null, problem: "The up helmet names a file outside the library's helmets folder, so it is not used." };
  const lotus = car('lotus79', 'lotus79', [{ ...version('v12', 'v12 Shatter'), helmet: OUT }, { ...version('v13', 'v13 Shatter'), helmet: GONE }], 'Lotus 79', 'Lotus 79', true, 41);
  const said = "The shatter helmet's file is not in the library. The car's helmet was left as it was.";
  await stubPaintsBridge(page, {
    ...PAINTS,
    carCatalogue: CATALOGUE.map((c) => (c.folder === 'lotus79' ? lotus : c)),
    applyVersion: { ...PAINTS.applyVersion, helmet: { set: 'shatter', onCar: false, defaultSet: 'shatter', defaultPut: false, said } },
  });
  const errors = await openDesk(page, lotusLast(), '&page=cars');
  const app = page.locator(APP);
  const cards = app.locator('.versions .card');
  await expect(cards.locator('.helmet')).toHaveText([OUT.problem, GONE.problem]);
  await expect(cards.locator('.helmet .swatch')).toHaveCount(0);
  expect((await cards.locator('.helmet').allInnerTexts()).join(' ')).not.toContain('Comes with');

  // What the apply says of it is what the card said: nothing the page has to work out, and no instruction.
  await cards.nth(1).locator('.actions button.primary').click();
  await expect(app.locator('.helmet-said')).toHaveText(said);
  await expect(app.locator('.log .entry.ok')).toContainText(said);
  expect(await app.locator('.helmet-said').innerText()).not.toMatch(/close|first|go to/i);
  expect(errors).toEqual([]);
});

test('how a livery is applied is set once, remembered, and used by the next apply', async ({ page }) => {
  await stubPaintsBridge(page, { ...PAINTS, loadSettings: { setReadOnlyAfter: true } });
  const errors = await openDesk(page, lotusLast(), '&page=cars');
  const app = page.locator(APP);
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
  const errors = await openDesk(page, lotusLast(), '&page=cars');
  const app = page.locator(APP);
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
  const errors = await openDesk(page, lotusLast(), '&page=cars');
  const app = page.locator(APP);
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
  const errors = await openDesk(page, lotusLast(), '&page=cars');
  const app = page.locator(APP);
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
  const errors = await openDesk(page, lotusLast(), '&page=cars');
  const app = page.locator(APP);
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
  const errors = await openDesk(page, lotusLast(), '&page=cars');
  const app = page.locator(APP);
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
  const errors = await openDesk(page, lotusLast(), '&page=cars');
  const app = page.locator(APP);
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
  const errors = await openDesk(page, lotusLast(), '&page=cars');
  const app = page.locator(APP);
  await expect(app.locator('.sidebar .empty')).toHaveText('Reading the cars…');
  await expect(app.locator('.main > .empty')).toHaveText('Reading the cars…');
  await expect(app.locator('.sidebar .car')).toHaveCount(7);
  await expect(app.locator('.sidebar .empty')).toHaveCount(0);
  await expect(app.locator('.car-head h2')).toHaveText('Lotus 79');
  expect(errors).toEqual([]);

  // A list that is here and empty is the only one that says there are no cars.
  await stubPaintsBridge(page, { ...PAINTS, carCatalogue: [] });
  await page.reload();
  const empty = page.locator(APP);
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
  const failed = page.locator(APP);
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
  const errors = await openDesk(page, lotusLast(), '&page=cars');
  const app = page.locator(APP);
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
  const errors = await openDesk(page, lotusLast(), '&page=cars');
  const app = page.locator(APP);
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
  const errors = await openDesk(page, lotusLast(), '&page=cars');
  const app = page.locator(APP);
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
  const errors = await openDesk(page, lotusLast(), '&page=cars');
  const app = page.locator(APP);
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

// ── Cars: a car's view and pedals ────────────────────────────
// What the host keeps per car, made up, as the app hands it to the page: window.racingDesk.rig.read() answers
// { cars, views, pedals }, each { value }, { missing: true } (a host from before the route) or { error }, as
// modules/js/rig-api.js does. Four cars in the store, all of them in the list above. The McLaren's view is its own;
// the Caterham was driven with whatever was set before it, and has no camera file to read a seat from; the MX-5 has
// not been driven since views were first recorded, and nothing is kept for the Lotus. One car has been given a
// profile, since edited.

const RIG_CARS = [
  { car_path: 'caterham caterham420r', name: 'Caterham Seven 420R', short_name: 'Seven 420R', car_id: 218, driven: 120, seen: 120 },
  { car_path: 'lotus79', name: 'Lotus 79', short_name: 'Lotus 79', car_id: 42, driven: 41, seen: 53 },
  { car_path: 'mx5 mx52016', name: 'Mazda MX-5 Cup', short_name: 'MX-5 Cup', car_id: 67, driven: 668, seen: 702 },
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
const held = (value) => ({ value });
const OLDER = { missing: true };
const RIG = { cars: held(RIG_CARS), views: held(RIG_VIEWS), pedals: held(RIG_PEDALS) };

const CATERHAM = 'caterham caterham420r';
const NOT_THE_PAGES = ['cars', 'views', 'pedals', 'controls'];   // what the page must not ask the host for itself

// The rig's half of the bridge, put beside the paints half. `binds` are rig.bindPedals' answers, one per call in
// order, each as main.js gives it — { ok: true, car } or { ok: false, error } — or { __error } to reject, which
// main.js never does.
async function stubRig(page, rig = RIG, binds = []) {
  await page.addInitScript(([read, answers]) => {
    window.__rig = { reads: 0, bound: [], binds: answers };
    window.racingDesk = Object.assign(window.racingDesk || {}, {
      rig: {
        read: async () => {
          window.__rig.reads += 1;
          return JSON.parse(JSON.stringify(read));
        },
        bindPedals: async (carPath, profileId) => {
          window.__rig.bound.push([carPath, profileId]);
          const answer = window.__rig.binds.shift() ?? { ok: false, error: 'the test has no answer for this' };
          if (answer.__error) throw new Error(answer.__error);
          return answer;
        },
      },
    });
  }, [rig, binds]);
}

// The Cars page as the app has it: the livery manager's commands and what the host keeps, both stood in for.
async function openCars(page, hostUrl, { paints = PAINTS, rig = RIG, binds = [], timers = false } = {}) {
  await stubPaintsBridge(page, paints);
  await stubRig(page, rig, binds);
  const errors = await openDesk(page, hostUrl, '&page=cars', { timers });
  return { errors, app: page.locator(APP) };
}

const carRow = (app, name) => app.locator('.sidebar .group .car', { hasText: name });
// Two cars go by "Mazda MX-5 Cup": the one that has been driven is the one with a livery.
const MX5 = (app) => app.locator('.sidebar .group').first().locator('.car', { hasText: 'Mazda MX-5 Cup' });
async function lookAt(app, name, row = carRow(app, name)) {
  await row.click();
  await expect(app.locator('.car-head h2')).toHaveText(name);
}
const bindCalls = (page) => page.evaluate(() => window.__rig.bound);
const rigReads = (page) => page.evaluate(() => window.__rig.reads);
const askedFor = (server, route) => server.asked.filter((a) => a.route === route).length;

const NO_VIEW = 'Not recorded yet — it will be after the next time you drive it.';
const VIEW_FACTS = ['Last driven', 'Height', 'Horizon', 'Head horizon', 'Field of view', 'Seat fore/aft', 'Seat sideways', 'Seat up/down', 'The view is'];

test('the one list of cars marks the cars with a view or pedals, and what the host keeps is read through the app', async ({ page }) => {
  const own = await startMockHost(buildHistory());
  try {
    await stubPaintsBridge(page, PAINTS);
    await stubRig(page);
    const errors = await openDesk(page, `http://127.0.0.1:${own.address().port}`);
    const app = page.locator(APP);
    await expect(page.locator('.race-row')).toHaveCount(30);
    expect(await rigReads(page)).toBe(0);   // nothing at desk start
    expect(await paintsCalls(page, 'carCatalogue')).toEqual([]);

    await page.locator('.nav a', { hasText: 'Cars' }).click();
    await expect(page.locator('#cars-page')).toBeVisible();
    await expect(page.locator('#cars-note')).toBeHidden();
    await expect(app.locator('.sidebar .car')).toHaveCount(7);
    await expect.poll(() => rigReads(page)).toBe(1);

    // Every car is in the list, as it was; the ones the host keeps something for say what.
    await expect(app.locator('.sidebar .group .heading')).toHaveText(['Liveries 3', 'No livery yet 4']);
    await expect(carRow(app, 'McLaren 570S GT4').locator('.mark')).toHaveText(['view', 'pedals']);
    await expect(carRow(app, 'Caterham Seven 420R').locator('.mark')).toHaveText(['view']);
    await expect(app.locator('.sidebar .mark')).toHaveCount(3);
    // A car with a view and no livery is in the list like any other, and its name is still only its name.
    await expect(carRow(app, 'McLaren 570S GT4').locator('.name')).toHaveText('McLaren 570S GT4');
    await expect(carRow(app, 'McLaren 570S GT4').locator('.meta')).toHaveCount(0);
    // The marks are words in the row, not stops of their own: from one row the next Tab is the next row.
    await carRow(app, 'Caterham Seven 420R').focus();
    await page.keyboard.press('Tab');
    await expect(app.locator('.sidebar .group').nth(1).locator('.car').nth(1)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(carRow(app, 'McLaren 570S GT4')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(app.locator('.car-head h2')).toHaveText('McLaren 570S GT4');

    // One car, one place: how it is driven, under its name; then what it wears; then what is on disk for it; and
    // under them all the library's own housekeeping.
    const headings = app.locator('.main .panel h3');
    const blocks = () => app.locator('.main > *').evaluateAll((els) => els.map((el) => el.className.trim()));
    await expect(headings)
      .toHaveText(['View', 'Pedals', 'No livery yet', 'Installed in the sim', 'Backups', 'Trading Paints', 'Library source']);
    expect(await blocks()).toEqual(['car-head', 'car-rig', 'panel no-livery', 'panel', 'panel', 'panel', 'panel']);
    await lookAt(app, 'Lotus 79');
    await expect(headings)
      .toHaveText(['View', 'Pedals', 'When a livery is applied', 'Installed in the sim', 'Backups', 'Trading Paints', 'Library source']);
    expect(await blocks()).toEqual(['car-head', 'car-rig', 'versions', 'panel apply-options', 'panel', 'panel', 'panel', 'panel']);
    expect(await app.locator('.car-rig > *').evaluateAll((els) => els.map((el) => el.className.trim())))
      .toEqual(['panel car-view', 'panel car-pedals']);

    // The desk's Refresh reads it all again, the list of cars too, as the page's own does. Coming back to the
    // page reads what the host keeps, and not the list.
    await page.locator('#refresh').click();
    await expect.poll(() => rigReads(page)).toBe(2);
    await expect.poll(() => paintsCalls(page, 'carCatalogue')).toHaveLength(2);
    await page.locator('.nav a', { hasText: 'Desk' }).click();
    await expect(page.locator('#cars-page')).toBeHidden();
    await page.locator('.nav a', { hasText: 'Cars' }).click();
    await expect.poll(() => rigReads(page)).toBe(3);
    expect(await paintsCalls(page, 'carCatalogue')).toHaveLength(2);
    await app.locator('.setup .status button', { hasText: 'Refresh' }).click();
    await expect.poll(() => rigReads(page)).toBe(4);
    await expect.poll(() => paintsCalls(page, 'carCatalogue')).toHaveLength(3);
    await expect(app.locator('.car-head h2')).toHaveText('Lotus 79');
    // Elsewhere in the desk its Refresh reads nothing of the Cars page's there and then. It is owed to the page,
    // which reads it all when it is next shown — once, though it is told twice: shown, and something new.
    await page.locator('.nav a', { hasText: 'Desk' }).click();
    await page.locator('#refresh').click();
    await expect(page.locator('#freshness')).toContainText('ms');
    expect(await rigReads(page)).toBe(4);
    expect(await paintsCalls(page, 'carCatalogue')).toHaveLength(3);
    await page.locator('.nav a', { hasText: 'Cars' }).click();
    await expect.poll(() => paintsCalls(page, 'carCatalogue')).toHaveLength(4);
    await expect.poll(() => rigReads(page)).toBe(5);
    await page.locator('.nav a', { hasText: 'Desk' }).click();
    await page.locator('.nav a', { hasText: 'Cars' }).click();   // nothing is owed twice
    await expect.poll(() => rigReads(page)).toBe(6);
    expect(await paintsCalls(page, 'carCatalogue')).toHaveLength(4);
    await expect(app.locator('.car-head h2')).toHaveText('Lotus 79');

    // None of it was asked of the host by the page, and nothing was written.
    expect(NOT_THE_PAGES.map((route) => askedFor(own, route))).toEqual(NOT_THE_PAGES.map(() => 0));
    expect(own.asked.filter((a) => a.method !== 'GET')).toEqual([]);
    expect(await bindCalls(page)).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await new Promise((resolve) => own.close(resolve));
  }
});

test('a car\'s view is in millimetres with their sign, the horizon as iRacing has it, and says whose it is', async ({ page }) => {
  const { errors, app } = await openCars(page, `http://127.0.0.1:${host.address().port}`);
  await expect(page.locator('#cars-page')).toBeVisible();
  await expect(page.locator('.nav a[aria-current="page"]')).toHaveText('Cars');
  const view = app.locator('.car-view');

  // When it was last driven — the history's last session was the McLaren's, 26½ hours before the fixed clock —
  // then height, horizon, head horizon, field of view, the seat three ways, and whose view it is.
  await lookAt(app, 'McLaren 570S GT4');
  await expect(view.locator('h3')).toHaveText('View');
  await expect(view.locator('dt')).toHaveText(VIEW_FACTS);
  await expect(view.locator('dd')).toHaveText(['27 h ago', '−60 mm', '−0.035', '0.5', '69°', '−130 mm', '0 mm', '+20 mm', 'its own']);
  await expect(view.locator('.note')).toHaveText(/^Changed while in this car\. Recorded \S.+\.$/);
  // Each number is under its name, in a list a screen reader reads as name and value.
  expect(await view.locator('dl.facts > .fact').evaluateAll((els) => els.map((el) => [...el.children].map((c) => c.tagName).join(' '))))
    .toEqual(Array(9).fill('DT DD'));

  await lookAt(app, 'Caterham Seven 420R');
  await expect(view.locator('dd')).toHaveText(['2 days ago', '+15 mm', '0', '—', '69°', '—', '—', '—', 'inherited']);
  await expect(view.locator('.note')).toHaveText(/^Carried over from the car driven before it, and not changed in this one\. Recorded \S.+\.$/);
  // Which sign is which way has not been established, so the page does not say.
  expect(await view.textContent()).not.toMatch(/forward|\bback(ward)?\b/i);

  // Numbers are in the monospace face; words are not.
  const look = (locator) => locator.evaluate((el) => { const s = getComputedStyle(el); return [s.fontFamily, s.color]; });
  await lookAt(app, 'McLaren 570S GT4');
  for (const figure of await view.locator('.fact:not(.words) dd').all()) expect((await look(figure))[0]).toContain('JetBrains Mono');
  expect(await view.locator('.fact:not(.words) dd').count()).toBe(7);
  expect((await look(view.locator('.fact.words dd').last()))[0]).not.toContain('JetBrains Mono');

  // No view yet is how every car starts: one plain sentence, as quiet as the heading over it. The MX-5 is in no
  // stored session either, so it has no "last".
  await lookAt(app, 'Mazda MX-5 Cup', MX5(app));
  await expect(view.locator('dt')).toHaveText(['Last driven']);
  await expect(view.locator('dd')).toHaveText(['—']);
  await expect(view.locator('.note')).toHaveText(NO_VIEW);
  expect((await look(view.locator('.note')))[1]).toBe((await look(view.locator('h3')))[1]);
  expect(errors).toEqual([]);
});

test('a car\'s pedals: the profile it was given, that profile\'s brake in a line, and SmartControl Live\'s keys', async ({ page }) => {
  const { errors, app } = await openCars(page, `http://127.0.0.1:${host.address().port}`);
  const pedals = app.locator('.car-pedals');

  await lookAt(app, 'McLaren 570S GT4');
  await expect(pedals.locator('h3')).toHaveText('Pedals');
  const select = pedals.getByLabel('Pedal profile for McLaren 570S GT4');
  await expect(select).toBeEnabled();
  await expect(select).toHaveValue('9c1d44e0');
  await expect(select.locator('option')).toHaveText(['no profile of its own', 'Default', 'GT3 <stiff>', 'Throttle only']);
  await expect(select.locator('option:checked')).toHaveText('GT3 <stiff>');
  await expect(pedals.locator('label')).toHaveText('Profile');
  await expect(pedals.locator('.brake')).toHaveText(
    'brake max 95.5 kg · bottom deadzone 3% · shaped curve · edited in SmartControl since this car was given it · brake force 62 kg in this car');
  await expect(pedals.locator('.brake .warn')).toHaveText('edited in SmartControl since this car was given it');
  await expect(pedals.locator('.pedal-note')).toHaveText('');
  await expect(pedals.locator('.pedal-note')).toHaveAttribute('role', 'status');
  // This host is one from before it said who gave a car its profile: nothing is said of it, as nothing was.
  await expect(pedals.locator('.given')).toHaveCount(0);
  await expect(select).not.toHaveAttribute('aria-describedby');

  // The keys the driver presses, by the names on the keycaps; a name not known here is shown as it came.
  await expect(pedals.locator('.live-keys .key')).toHaveText([
    'Page Up — brake force 50 kg', 'Right Ctrl + Up — 5 kg more', 'Right Ctrl + Down — 5 kg less', 'Pause + F13 — other',
  ]);

  // A car with no profile of its own has the select and nothing to say beside it.
  await lookAt(app, 'Caterham Seven 420R');
  await expect(pedals.locator('select')).toHaveValue('');
  await expect(pedals.locator('select option:checked')).toHaveText('no profile of its own');
  await expect(pedals.getByLabel('Pedal profile for Caterham Seven 420R')).toBeEnabled();
  await expect(pedals.locator('.brake')).toHaveCount(0);
  await expect(pedals.locator('.given')).toHaveCount(0);
  await expect(pedals.locator('.live-keys .key')).toHaveCount(4);

  // A car that has never been in a session is one the host cannot keep anything against, and the page says so
  // where the choice would be made.
  await lookAt(app, 'oldcar');
  await expect(pedals.locator('select')).toBeDisabled();
  await expect(pedals.locator('select')).toHaveValue('');
  await expect(pedals.locator('.note')).toContainText('it has not been in one of your sessions');
  await expect(app.locator('.car-view .note')).toHaveText(NO_VIEW);

  expect(await bindCalls(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('a profile deleted in SmartControl is still what the car was given, and the page says it is gone', async ({ page }) => {
  const pedalsHeld = {
    smartcontrol: RIG_PEDALS.smartcontrol,
    cars: [
      bound('mx5 mx52016', 'Mazda MX-5 Cup', 'deadbeef', 'Old wet', 'gone'),
      bound(CATERHAM, 'Caterham Seven 420R', 'aa00ff11', 'Throttle only', 'same'),
      bound('mclaren570sgt4', 'McLaren 570S GT4', '283f91ae', 'Default', 'unknown'),
    ],
    // Known to the host without a profile: the force it was last driven with, set by key.
    without_profile: [{ car_path: 'lotus79', name: 'Lotus 79', brake_force_kg: 48.5, force_at: '2026-09-12T20:00:00.000Z', has_abs: false, given_by: 'none', given_why: null }],
  };
  const { errors, app } = await openCars(page, `http://127.0.0.1:${host.address().port}`, { rig: { ...RIG, pedals: held(pedalsHeld) } });
  const pedals = app.locator('.car-pedals');

  await lookAt(app, 'Mazda MX-5 Cup', MX5(app));
  await expect(pedals.locator('select')).toHaveValue('deadbeef');
  await expect(pedals.locator('select option:checked')).toHaveText('Old wet (not in SmartControl)');
  await expect(pedals.locator('select option')).toHaveCount(5);
  await expect(pedals.locator('.brake')).toHaveText('deleted in SmartControl');
  await expect(pedals.locator('.brake .warn')).toHaveCount(1);
  // The other cars' lists are SmartControl's own.
  await lookAt(app, 'Caterham Seven 420R');
  await expect(pedals.locator('select option')).toHaveCount(4);
  await expect(pedals.locator('.brake')).toHaveText('no brake in this profile');
  await lookAt(app, 'McLaren 570S GT4');
  await expect(pedals.locator('.brake')).toHaveText('brake max 80 kg · bottom deadzone 5% · linear curve');
  await expect(pedals.locator('.given')).toHaveCount(0);   // nobody is down as having given it
  // A car with no profile, and a force the host has followed all the same: what it is, and when it was set.
  await lookAt(app, 'Lotus 79');
  await expect(pedals.locator('select')).toHaveValue('');
  await expect(pedals.locator('.brake')).toHaveText(/^brake force 48\.5 kg in this car, set \S.*\d/);
  await expect(pedals.locator('.given')).toHaveText('You chose that this car has none.');
  await expect(app.locator('.sidebar .mark', { hasText: 'pedals' })).toHaveCount(4);
  expect(errors).toEqual([]);
});

// ── Cars: what the store knows of a car's pedals beside its profile ──
// A host that keeps a car's pedal facts sends them with every row — force_at, has_abs, given_by, given_why, nulls
// where nothing is known — and the cars it knows something of that have no profile yet (without_profile). The
// driver's rule gives a car with no profile a copy of his LightBrake (ABS, not a formula car) or his Default.
const LIGHT_BRAKE = { id: '5511aacc', name: 'LightBrake', throttle: null, brake: { deadzone_bottom: 4, max_force_kg: 60, curve: LINEAR }, clutch: null };
const facts = (force_at, has_abs, given_by, given_why) => ({ force_at, has_abs, given_by, given_why });
const bare = (car_path, name, brake_force_kg, known) => ({ car_path, name, brake_force_kg, ...known });
const TOLD_CARS = [
  ...RIG_CARS,
  { car_path: 'mx5 cup', name: 'Mazda MX-5 Cup', short_name: 'MX-5 Cup', car_id: 35, driven: 3, seen: 3 },
  { car_path: 'oldcar', name: null, short_name: null, car_id: 9, driven: 2, seen: 2 },
  { car_path: 'nissangtpzxt', name: null, short_name: null, car_id: 77, driven: 1, seen: 1 },
];
const TOLD_PEDALS = {
  smartcontrol: { found: true, profiles: [...PROFILES, LIGHT_BRAKE], keys: LIVE_KEYS },
  cars: [
    { ...bound('mclaren570sgt4', 'McLaren 570S GT4', '5511aacc', 'LightBrake', 'same', 62), ...facts('2026-09-15T23:40:00.000Z', true, 'rule', 'ABS') },
    { ...bound('lotus79', 'Lotus 79', '283f91ae', 'Default', 'same'), ...facts(null, null, 'rule', 'a formula car') },
    { ...bound('mx5 mx52016', 'Mazda MX-5 Cup', '9c1d44e0', 'GT3 <stiff>', 'same', 70), ...facts(null, false, 'driver', null) },
  ],
  without_profile: [
    bare(CATERHAM, 'Caterham Seven 420R', 55, facts('2026-09-14T22:30:00.000Z', null, null, null)),
    bare('mx5 cup', 'Mazda MX-5 Cup', null, facts(null, true, 'none', null)),
    bare('oldcar', null, null, facts(null, true, null, null)),
  ],
};
const TOLD = { cars: held(TOLD_CARS), views: held(RIG_VIEWS), pedals: held(TOLD_PEDALS) };
const SET_AT = / in this car, set \S.*\d/;   // a moment as the desk writes one, whatever the rig's language and clock

test('a prototype starts from Default, ABS and all, and the page says that is why', async ({ page }) => {
  const gtp = { ...bound('nissangtpzxt', null, '283f91ae', 'Default', 'same'), ...facts(null, true, 'rule', 'a prototype') };
  const rig = { ...TOLD, pedals: held({ ...TOLD_PEDALS, cars: [...TOLD_PEDALS.cars, gtp] }) };
  const { errors, app } = await openCars(page, `http://127.0.0.1:${host.address().port}`, { rig });
  await lookAt(app, 'nissangtpzxt');
  await expect(app.locator('.car-pedals select')).toHaveValue('283f91ae');
  await expect(app.locator('.car-pedals .given')).toHaveText('From Default — given by the rule: it is a prototype.');
  expect(errors).toEqual([]);
});

test('a car\'s pedals say who gave it its profile and why, the force it was last driven with and when it was set', async ({ page }) => {
  const { errors, app } = await openCars(page, `http://127.0.0.1:${host.address().port}`, { rig: TOLD });
  const pedals = app.locator('.car-pedals');
  const select = pedals.locator('select');

  // Given by the rule, which went by its ABS: a copy of LightBrake, as the select says.
  await lookAt(app, 'McLaren 570S GT4');
  await expect(select).toHaveValue('5511aacc');
  await expect(pedals.locator('.given')).toHaveText('From LightBrake — given by the rule: it has anti-lock brakes.');
  await expect(pedals.locator('.brake')).toHaveText(/^brake max 60 kg · bottom deadzone 4% · linear curve · brake force 62 kg in this car, set \S/);
  await expect(pedals.locator('.brake')).toHaveText(SET_AT);
  // The sentence is the select's description: a screen reader says it with the profile.
  await expect(select).toHaveAttribute('aria-describedby', 'car-pedals-given');
  await expect(pedals.locator('#car-pedals-given')).toHaveText('From LightBrake — given by the rule: it has anti-lock brakes.');
  await expect(pedals.getByLabel('Pedal profile for McLaren 570S GT4')).toHaveValue('5511aacc');

  // A formula car starts from Default whatever its ABS; no force is known for this one, and none is made up.
  await lookAt(app, 'Lotus 79');
  await expect(pedals.locator('.given')).toHaveText('From Default — given by the rule: it is a formula car.');
  await expect(pedals.locator('.brake')).toHaveText('brake max 80 kg · bottom deadzone 5% · linear curve');

  // One he gave it here. The force is known, and when it was set is not.
  await lookAt(app, 'Mazda MX-5 Cup', MX5(app));
  await expect(pedals.locator('.given')).toHaveText('You chose this.');
  await expect(pedals.locator('.brake')).toHaveText('brake max 95.5 kg · bottom deadzone 3% · shaped curve · brake force 70 kg in this car');

  // No profile yet, and what is waited for. The force it was driven with is kept all the same.
  await lookAt(app, 'Caterham Seven 420R');
  await expect(select).toHaveValue('');
  await expect(select).toBeEnabled();
  await expect(pedals.locator('.given')).toHaveText('No profile yet: not driven enough yet to say whether it has anti-lock brakes.');
  await expect(pedals.locator('.brake')).toHaveText(/^brake force 55 kg in this car, set \S/);
  await expect(pedals.locator('.brake')).toHaveText(SET_AT);
  // Enough is known, and the rule has not been round since.
  await lookAt(app, 'oldcar');
  await expect(pedals.locator('.given')).toHaveText('No profile yet: it has anti-lock brakes, and the rule gives it one when it is next driven.');
  await expect(pedals.locator('.brake')).toHaveCount(0);
  // A car the host knows and keeps nothing of is waiting like any other.
  await lookAt(app, 'nissangtpzxt');
  await expect(select).toBeEnabled();
  await expect(pedals.locator('.given')).toHaveText('No profile yet: not driven enough yet to say whether it has anti-lock brakes.');
  // None, and his choice: the rule leaves it alone, and the page does not say it is waiting.
  await lookAt(app, 'Mazda MX-5 Cup', app.locator('.sidebar .group').nth(1).locator('.car', { hasText: 'Mazda MX-5 Cup' }));
  await expect(select).toHaveValue('');
  await expect(pedals.locator('.given')).toHaveText('You chose that this car has none.');

  // In the list a car's pedals are kept when it has a profile or a force, not when it is only known of.
  await expect(app.locator('.sidebar .mark', { hasText: 'pedals' })).toHaveCount(4);
  await expect(carRow(app, 'oldcar').locator('.mark')).toHaveCount(0);
  expect(await bindCalls(page)).toEqual([]);
  expect(errors).toEqual([]);

  // With nothing for the rule to give from, that is what is waited for. A car the host has never had in a
  // session has nothing kept against it, and the note that says so is all that is said.
  const none = { ...TOLD_PEDALS, smartcontrol: { found: true, profiles: PROFILES.slice(1), keys: [] } };
  await stubRig(page, { cars: held(TOLD_CARS.slice(0, -1)), views: held(RIG_VIEWS), pedals: held(none) });
  await page.reload();
  const again = page.locator(APP);
  await lookAt(again, 'oldcar');
  await expect(again.locator('.car-pedals .given'))
    .toHaveText('No profile yet: it has anti-lock brakes, and the rule would give it one from LightBrake or Default, neither of which SmartControl has.');
  await lookAt(again, 'nissangtpzxt');
  await expect(again.locator('.car-pedals select')).toBeDisabled();
  await expect(again.locator('.car-pedals .given')).toHaveCount(0);
  await expect(again.locator('.car-pedals .note')).toContainText('it has not been in one of your sessions');
});

test('a profile taken away leaves the force the car was driven with on the page', async ({ page }) => {
  // From a host that says nothing of who gave what: the force stays, and nothing else is said.
  const { errors, app } = await openCars(page, `http://127.0.0.1:${host.address().port}`, { binds: [{ ok: true, car: null }] });
  const pedals = app.locator('.car-pedals');
  const select = pedals.locator('select');
  await lookAt(app, 'McLaren 570S GT4');
  await expect(pedals.locator('.brake')).toContainText('brake force 62 kg in this car');
  await select.selectOption({ label: 'no profile of its own' });

  await expect(pedals.locator('.pedal-note.saved')).toHaveText('saved');
  expect(await bindCalls(page)).toEqual([['mclaren570sgt4', null]]);
  await expect(select).toHaveValue('');
  await expect(pedals.locator('.brake')).toHaveText('brake force 62 kg in this car');
  await expect(pedals.locator('.given')).toHaveCount(0);
  await expect(carRow(app, 'McLaren 570S GT4').locator('.mark')).toHaveText(['view', 'pedals']);
  // Still there when the car is come back to: it is the car's, not the moment's.
  await lookAt(app, 'Caterham Seven 420R');
  await expect(pedals.locator('.brake')).toHaveCount(0);
  await lookAt(app, 'McLaren 570S GT4');
  await expect(pedals.locator('.brake')).toHaveText('brake force 62 kg in this car');
  expect(await rigReads(page)).toBe(1);   // it was not read again to find out
  expect(errors).toEqual([]);

  // From one that does: the force and when it was set, and that having none is his choice — of a car with a
  // force, and of one with nothing else known of it.
  await stubRig(page, TOLD, [{ ok: true, car: null }, { ok: true, car: null }]);
  await page.reload();
  const told = page.locator(APP);
  const given = told.locator('.car-pedals .given');
  await lookAt(told, 'McLaren 570S GT4');
  await expect(given).toHaveText('From LightBrake — given by the rule: it has anti-lock brakes.');
  await told.locator('.car-pedals select').selectOption({ label: 'no profile of its own' });
  await expect(told.locator('.car-pedals .pedal-note.saved')).toHaveText('saved');
  await expect(given).toHaveText('You chose that this car has none.');
  await expect(told.locator('.car-pedals .brake')).toHaveText(/^brake force 62 kg in this car, set \S/);
  await expect(carRow(told, 'McLaren 570S GT4').locator('.mark')).toHaveText(['view', 'pedals']);
  await lookAt(told, 'Lotus 79');
  await told.locator('.car-pedals select').selectOption({ label: 'no profile of its own' });
  await expect(told.locator('.car-pedals .pedal-note.saved')).toHaveText('saved');
  await expect(given).toHaveText('You chose that this car has none.');
  await expect(told.locator('.car-pedals .brake')).toHaveCount(0);
  await expect(carRow(told, 'Lotus 79').locator('.mark')).toHaveCount(0);
  expect(await bindCalls(page)).toEqual([['mclaren570sgt4', null], ['lotus79', null]]);
});

test('choosing a profile asks the app to give it to the car, and says when it is saved', async ({ page }) => {
  const own = await startMockHost(buildHistory());
  try {
    const { errors, app } = await openCars(page, `http://127.0.0.1:${own.address().port}`, {
      binds: [
        { ok: true, car: bound(CATERHAM, 'Caterham Seven 420R', '283f91ae', 'Default', 'same') },
        { ok: true, car: null },
      ],
    });
    const pedals = app.locator('.car-pedals');
    const select = pedals.locator('select');
    await lookAt(app, 'Caterham Seven 420R');
    await select.focus();
    await select.selectOption({ label: 'Default' });

    await expect(pedals.locator('.pedal-note.saved')).toHaveText('saved');
    // The host is told the car by the store's own name for it.
    expect(await bindCalls(page)).toEqual([[CATERHAM, '283f91ae']]);
    await expect(select).toHaveValue('283f91ae');
    await expect(select).toBeEnabled();
    await expect(select).toBeFocused();   // the keyboard is where it was
    await expect(pedals.locator('.brake')).toHaveText('brake max 80 kg · bottom deadzone 5% · linear curve');
    await expect(carRow(app, 'Caterham Seven 420R').locator('.mark')).toHaveText(['view', 'pedals']);
    // Only that car changed, and what was said of it is still said when it is looked at again.
    await lookAt(app, 'McLaren 570S GT4');
    await expect(select).toHaveValue('9c1d44e0');
    await expect(pedals.locator('.pedal-note')).toHaveText('');
    await lookAt(app, 'Caterham Seven 420R');
    await expect(select).toHaveValue('283f91ae');
    await expect(pedals.locator('.pedal-note.saved')).toHaveText('saved');

    // Taking it away is the same call with no profile.
    await select.selectOption({ label: 'no profile of its own' });
    await expect.poll(() => bindCalls(page)).toEqual([[CATERHAM, '283f91ae'], [CATERHAM, null]]);
    await expect(pedals.locator('.pedal-note.saved')).toHaveText('saved');
    await expect(select).toHaveValue('');
    await expect(pedals.locator('.brake')).toHaveCount(0);
    await expect(carRow(app, 'Caterham Seven 420R').locator('.mark')).toHaveText(['view']);

    // A car the library calls one thing and the sim another is given its profile under the store's name.
    await lookAt(app, 'Mazda MX-5 Cup', MX5(app));
    await select.selectOption({ label: 'Throttle only' });
    await expect.poll(() => bindCalls(page)).toHaveLength(3);
    expect((await bindCalls(page)).at(-1)).toEqual(['mx5 mx52016', 'aa00ff11']);

    // A save is no reason to read again, and the page itself asked the host for none of it and wrote nothing.
    expect(await rigReads(page)).toBe(1);
    expect(NOT_THE_PAGES.map((route) => askedFor(own, route))).toEqual(NOT_THE_PAGES.map(() => 0));
    expect(own.asked.filter((a) => a.method !== 'GET')).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await new Promise((resolve) => own.close(resolve));
  }
});

test('a profile that could not be saved says why, and the select goes back to what the car has', async ({ page }) => {
  const refusal = 'SmartControl doesn\'t have a profile <283f91ae>.';
  const { errors, app } = await openCars(page, `http://127.0.0.1:${host.address().port}`, {
    binds: [{ ok: false, error: refusal }, { __error: 'the app went away' }],
  });
  const pedals = app.locator('.car-pedals');
  const select = pedals.locator('select');
  await lookAt(app, 'McLaren 570S GT4');
  await expect(select).toHaveValue('9c1d44e0');
  await select.selectOption({ label: 'Default' });

  await expect(pedals.locator('.pedal-note.failed')).toHaveText(`not saved: ${refusal}`);
  expect(await bindCalls(page)).toEqual([['mclaren570sgt4', '283f91ae']]);
  await expect(select).toHaveValue('9c1d44e0');
  await expect(select).toBeEnabled();
  await expect(pedals.locator('.brake')).toContainText('brake max 95.5 kg');   // still the profile it has

  // main.js never rejects; if the bridge ever does, that is shown the same way.
  await select.selectOption({ label: 'Throttle only' });
  await expect(pedals.locator('.pedal-note.failed')).toHaveText('not saved: the app went away');
  await expect(select).toHaveValue('9c1d44e0');
  await expect(carRow(app, 'McLaren 570S GT4').locator('.mark')).toHaveText(['view', 'pedals']);
  expect(errors).toEqual([]);
});

test('a host from before it kept views and pedals still has its cars looked at, and the page says the host is older', async ({ page }) => {
  const { errors, app } = await openCars(page, `http://127.0.0.1:${host.address().port}`, {
    rig: { cars: held(RIG_CARS), views: OLDER, pedals: OLDER },
  });
  await lookAt(app, 'McLaren 570S GT4');
  await expect(app.locator('.car-view dt')).toHaveText(['Last driven']);
  await expect(app.locator('.car-view dd')).toHaveText(['27 h ago']);
  await expect(app.locator('.car-view .note')).toHaveText('This host is older than the page: it has no views to show yet.');
  await expect(app.locator('.car-pedals .note')).toHaveText('This host is older than the page: it has no pedals to show yet.');
  // Nothing is made up in their place: no "not recorded yet", no select, no keys, no marks in the list.
  await expect(app.locator('.car-pedals select')).toHaveCount(0);
  await expect(app.locator('.live-keys')).toHaveCount(0);
  await expect(app.locator('.sidebar .mark')).toHaveCount(0);
  // The liveries are none the worse for it.
  await lookAt(app, 'Lotus 79');
  await expect(app.locator('.versions .card')).toHaveCount(2);
  expect(errors).toEqual([]);

  // A host with views and no pedals yet says just that.
  await stubRig(page, { cars: held(RIG_CARS), views: held(RIG_VIEWS), pedals: OLDER });
  await page.reload();
  const half = page.locator(APP);
  await lookAt(half, 'McLaren 570S GT4');
  await expect(half.locator('.car-view dd').nth(1)).toHaveText('−60 mm');
  await expect(half.locator('.car-pedals .note')).toHaveText('This host is older than the page: it has no pedals to show yet.');
  await expect(half.locator('.car-pedals select')).toHaveCount(0);
  await lookAt(half, 'Mazda MX-5 Cup', MX5(half));
  await expect(half.locator('.car-view .note')).toHaveText(NO_VIEW);
  await expect(half.locator('.sidebar .mark')).toHaveText(['view', 'view']);
  expect(errors).toEqual([]);
});

test('without SmartControl the views are all there, and the pedals say it was not found', async ({ page }) => {
  const pedalsHeld = {
    smartcontrol: { found: false, profiles: [], keys: [] },
    cars: [bound('mclaren570sgt4', 'McLaren 570S GT4', '9c1d44e0', 'GT3 <stiff>', 'unknown', 62)],
  };
  const { errors, app } = await openCars(page, `http://127.0.0.1:${host.address().port}`, { rig: { ...RIG, pedals: held(pedalsHeld) } });
  const pedals = app.locator('.car-pedals');
  const notFound = 'SmartControl wasn\'t found on this rig, so there are no profiles to choose from.';

  await lookAt(app, 'McLaren 570S GT4');
  await expect(app.locator('.car-view dd').nth(1)).toHaveText('−60 mm');
  await expect(pedals.locator('.note')).toHaveText(notFound);
  await expect(pedals.locator('select')).toHaveCount(0);
  // What a car was given before is still the host's to show; there is nothing to choose for the others.
  await expect(pedals.locator('.kept')).toHaveText('GT3 <stiff>');
  await expect(pedals.locator('.says')).toHaveText('brake force 62 kg in this car');
  await expect(pedals.locator('.live-keys')).toHaveCount(0);

  await lookAt(app, 'Caterham Seven 420R');
  await expect(app.locator('.car-view dd').last()).toHaveText('inherited');
  await expect(pedals.locator('.note')).toHaveText(notFound);
  await expect(pedals.locator('.pedals-line')).toHaveCount(0);
  await lookAt(app, 'Mazda MX-5 Cup', MX5(app));
  await expect(app.locator('.car-view .note')).toHaveText(NO_VIEW);
  expect(errors).toEqual([]);
});

test('what could not be read is said where it would have been, in the app\'s own words', async ({ page }) => {
  const closed = http.createServer();
  await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve));
  const port = closed.address().port;
  await new Promise((resolve) => closed.close(resolve));
  const nothing = { error: `Nothing is answering at http://127.0.0.1:${port}.` };

  const { app } = await openCars(page, `http://127.0.0.1:${port}`, {
    rig: { cars: nothing, views: nothing, pedals: { error: 'The host answered, but not with JSON.' } },
  });
  await expect(page.locator('#cars-page')).toBeVisible();
  await expect(page.locator('#offline')).toBeHidden();   // the "no local data" notice is the desk page's
  // The cars and their liveries are the app's to read, host or no host.
  await lookAt(app, 'McLaren 570S GT4');
  await expect(app.locator('.car-view .note')).toHaveText(`The views could not be read. Nothing is answering at http://127.0.0.1:${port}.`);
  await expect(app.locator('.car-view dd')).toHaveText(['—']);
  await expect(app.locator('.car-pedals .note')).toHaveText('The pedals could not be read. The host answered, but not with JSON.');
  await expect(app.locator('.car-pedals select')).toHaveCount(0);
  await expect(app.locator('.sidebar .mark')).toHaveCount(0);

  // An answer that is not what was asked for is not taken for it.
  await stubRig(page, { cars: held({ cars: [] }), views: held('views'), pedals: held({ cars: [] }) });
  await page.reload();
  const odd = page.locator(APP);
  await lookAt(odd, 'McLaren 570S GT4');
  await expect(odd.locator('.car-view .note')).toHaveText('The views could not be read. The host\'s answer was not a list.');
  await expect(odd.locator('.car-pedals .note')).toHaveText('The pedals could not be read. The host\'s answer was not SmartControl\'s profiles.');
});

test('a Cars page that found no host reads again when the host comes up: the cars by name, their views and pedals', async ({ page }) => {
  const closed = http.createServer();
  await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve));
  const port = closed.address().port;
  await new Promise((resolve) => closed.close(resolve));

  // While the host is starting the app has no names to give, nor how often a car was driven: the cars are
  // listed by folder. The next list is the one with names in.
  const unnamed = CATALOGUE.map((c) => ({ ...c, name: null, shortName: null, driven: 0 }));
  const { app } = await openCars(page, `http://127.0.0.1:${port}`, {
    paints: { ...PAINTS, carCatalogue: { __in_turn: [unnamed, CATALOGUE] } },
  });
  const names = app.locator('.sidebar .car .name');
  await expect(names).toHaveText(['lotus79', 'mx5-mx52016', 'nissangtpzxt', 'caterham caterham420r', 'mclaren570sgt4', 'mx5 cup', 'oldcar']);
  await expect(page.locator('#freshness')).toHaveText('Local host not running');
  // Nothing says which car was driven last, or that any was: the first with a livery, and no way to narrow.
  await expect(app.locator('.car-head h2')).toHaveText('lotus79');
  await expect(app.getByRole('button', { name: 'Driven', exact: true })).toHaveCount(0);
  expect(await rigReads(page)).toBe(1);
  expect(await paintsCalls(page, 'carCatalogue')).toHaveLength(1);

  // The desk asks for the store again every five seconds until something answers.
  const late = await startMockHost(buildHistory(), SCHEDULE, port);
  try {
    await expect.poll(() => rigReads(page), { timeout: 12000 }).toBe(2);
    // The list was read again too, without the page's own Refresh being pressed: the cars have their names.
    await expect(names).toHaveText(['Lotus 79', 'Mazda MX-5 Cup', 'nissangtpzxt', 'Caterham Seven 420R', 'Mazda MX-5 Cup', 'McLaren 570S GT4', 'oldcar']);
    expect(await paintsCalls(page, 'carCatalogue')).toHaveLength(2);
    // And when each was driven came with the host: no car had been chosen, so the page is on the one driven last.
    await expect(app.locator('.car-head h2')).toHaveText('McLaren 570S GT4');
    await expect(app.locator('.car-view dd').first()).toHaveText('27 h ago');
    await expect(app.getByRole('button', { name: 'Driven', exact: true })).toBeVisible();
    expect(NOT_THE_PAGES.map((route) => askedFor(late, route))).toEqual(NOT_THE_PAGES.map(() => 0));
  } finally {
    await new Promise((resolve) => { late.closeAllConnections(); late.close(resolve); });
  }
});

// ── Cars: the car he has just driven ─────────────────────────
// The desk hands the island when each car was last driven (RacingDeskPaints.setLastDriven, from the sessions it
// has read), at its start and again whenever the store has something new. `drove` is the desk doing that.
const drove = (page, byCar) => page.evaluate((dates) => window.RacingDeskPaints.setLastDriven(dates), byCar);

test('the page opens on the car driven last, follows it until a car is chosen, and never takes the place of one that was', async ({ page }) => {
  // In this history that is the McLaren: a car with no livery, fifth in the list.
  const { errors, app } = await openCars(page, `http://127.0.0.1:${host.address().port}`);
  const name = app.locator('.car-head h2');
  const active = app.locator('.sidebar .car.active');
  await expect(name).toHaveText('McLaren 570S GT4');
  await expect(active.locator('.name')).toHaveText('McLaren 570S GT4');
  await expect(active).toHaveAttribute('aria-current', 'true');
  await expect(app.locator('.car-view dd').first()).toHaveText('27 h ago');
  // Reading the list again leaves it there.
  await app.locator('.setup .status button', { hasText: 'Refresh' }).click();
  await expect.poll(() => paintsCalls(page, 'carCatalogue')).toHaveLength(2);
  await expect(name).toHaveText('McLaren 570S GT4');

  // Another car is driven, and the page has not been touched: it is on that car.
  await drove(page, { mclaren570sgt4: '2026-09-15T23:00:00Z', 'mx5 mx52016': '2026-09-17T00:30:00Z' });
  await expect(name).toHaveText('Mazda MX-5 Cup');
  await expect(app.locator('.car-head .note')).toContainText('mx5-mx52016');   // the library's name for the sim's car
  await expect(app.locator('.car-view dd').first()).toHaveText('1 h ago');
  await expect(active).toBeInViewport();

  // A car he chose stays, whatever is driven after it, and however often the list is read.
  await lookAt(app, 'Caterham Seven 420R');
  await drove(page, { lotus79: '2026-09-17T01:15:00Z', 'caterham caterham420r': '2026-09-17T00:45:00Z' });
  await expect(app.locator('.car-view dd').first()).toHaveText('45 min ago');
  await expect(name).toHaveText('Caterham Seven 420R');
  await page.locator('#refresh').click();
  await expect.poll(() => paintsCalls(page, 'carCatalogue')).toHaveLength(3);
  await expect(name).toHaveText('Caterham Seven 420R');
  await expect(active.locator('.name')).toHaveText('Caterham Seven 420R');
  expect(errors).toEqual([]);
});

test('Driven narrows the list to the cars he has driven, the last driven first, and is remembered while the page is open', async ({ page }) => {
  const { errors, app } = await openCars(page, `http://127.0.0.1:${host.address().port}`);
  const driven = app.getByRole('button', { name: 'Driven', exact: true });
  const rows = app.locator('.sidebar .car');
  const headings = app.locator('.sidebar .group .heading');
  await expect(driven).toHaveAttribute('aria-pressed', 'false');
  await expect(rows).toHaveCount(7);

  // One click. The desk has a date for two of them; the store counts sessions in two more, which come after, by
  // name. One list and not two: newest first is an order across them all.
  await driven.click();
  await expect(driven).toHaveAttribute('aria-pressed', 'true');
  await expect(headings).toHaveText(['Driven 4']);
  await expect(app.locator('.sidebar .group')).toHaveAttribute('aria-label', 'Driven');
  await expect(rows.locator('.name')).toHaveText(['McLaren 570S GT4', 'Caterham Seven 420R', 'Lotus 79', 'Mazda MX-5 Cup']);
  await expect(rows.locator('.meta')).toHaveText([
    'driven 27 h ago', 'driven 2 days ago', 'driven in 41 sessions · 2 versions',
    'driven in 668 sessions · 1 version · mx5-mx52016 · installs to mx5 mx52016',
  ]);
  // What the host keeps for a car is said in its row here as in the whole list, and a row is one stop.
  await expect(rows.first().locator('.mark')).toHaveText(['view', 'pedals']);
  await expect(app.locator('.sidebar .groups')).toHaveCount(0);   // the livery groups are out of the way
  await app.locator('.sidebar .filter input').focus();
  await page.keyboard.press('Tab');
  await expect(driven).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(rows.first()).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(app.locator('.car-head h2')).toHaveText('Caterham Seven 420R');
  await expect(rows.nth(1)).toHaveAttribute('aria-current', 'true');

  // The filter's words are over the cars he has driven while it is on.
  const filter = app.locator('.sidebar .filter input');
  await filter.fill('mazda');
  await expect(rows.locator('.name')).toHaveText(['Mazda MX-5 Cup']);
  await expect(headings).toHaveText(['Driven 1']);
  await filter.fill('oldcar');
  await expect(rows).toHaveCount(0);
  await expect(app.locator('.sidebar .list .empty')).toHaveText('No car you have driven matches “oldcar”.');
  await filter.press('Escape');
  await expect(rows).toHaveCount(4);

  // A car driven since is at the top, once the desk has said so.
  await drove(page, { mclaren570sgt4: '2026-09-15T23:00:00Z', lotus79: '2026-09-17T01:00:00Z' });
  await expect(rows.locator('.name')).toHaveText(['Lotus 79', 'McLaren 570S GT4', 'Caterham Seven 420R', 'Mazda MX-5 Cup']);
  await expect(rows.first().locator('.meta')).toHaveText('driven 30 min ago · 2 versions');

  // Remembered while the page is open: through another page of the desk, and the list being read again.
  await page.locator('.nav a', { hasText: 'Desk' }).click();
  await page.locator('.nav a', { hasText: 'Cars' }).click();
  await expect(driven).toHaveAttribute('aria-pressed', 'true');
  await expect(headings).toHaveText(['Driven 4']);
  await app.locator('.setup .status button', { hasText: 'Refresh' }).click();
  await expect.poll(() => paintsCalls(page, 'carCatalogue')).toHaveLength(2);
  await expect(headings).toHaveText(['Driven 4']);

  // Off, by the keyboard: the list as it was, every car in it, the groups and their headings the same.
  await driven.focus();
  await page.keyboard.press('Space');
  await expect(driven).toHaveAttribute('aria-pressed', 'false');
  await expect(headings).toHaveText(['Liveries 3', 'No livery yet 4']);
  await expect(app.locator('.sidebar .groups .heading')).toContainText('Groups 0');
  await expect(rows).toHaveCount(7);
  await expect(app.locator('.sidebar .car.active .name')).toHaveText('Caterham Seven 420R');
  expect(errors).toEqual([]);
});

// ── Cars: the view and the pedals, in sight ──────────────────
// The desk's window is no smaller than 1024 by 680 (main.js), which leaves the page about 1008 by 641 inside
// its frame. 1024 by 700 is the size the review named.
const SMALLEST = [{ width: 1024, height: 700 }, { width: 1008, height: 641 }];
const CHECKOUT = {
  ...PLAIN_FOLDER, isRepo: true, root: LIBRARY, branch: 'main', upstream: 'origin/main', remoteUrl: 'https://github.com/DOOOOM/liveries',
  head: 'abc1234', subject: 'lotus79: v13, matte black against gloss shards',
};

// Whether all of an element is on screen: inside the pane that scrolls it, and inside the window.
const allInSight = (locator) => locator.evaluate((el) => {
  const box = el.getBoundingClientRect();
  const pane = el.closest('.main').getBoundingClientRect();
  return box.height > 0 && box.top >= pane.top && box.bottom <= Math.min(pane.bottom, window.innerHeight)
    && box.left >= pane.left && box.right <= Math.min(pane.right, window.innerWidth);
});

test('a car\'s view and pedals are in sight without scrolling in the desk\'s smallest window, above its liveries', async ({ page }) => {
  // The most there is to say of a car: liveries, a view of its own, a profile from the rule, a force, the keys.
  const painted = CATALOGUE.map((c) => (c.folder === 'mclaren570sgt4'
    ? { ...c, versions: [version('shatter', 'shatter', c.folder), version('shatter-inverted', 'shatter-inverted', c.folder), version('v3', 'v3', c.folder)] }
    : c));
  const { errors, app } = await openCars(page, `http://127.0.0.1:${host.address().port}`, {
    paints: { ...PAINTS, carCatalogue: painted, repoStatus: CHECKOUT, repoCheck: CHECKOUT }, rig: TOLD,
  });
  const pane = app.locator('.main');
  const scrolled = () => pane.evaluate((el) => el.scrollTop);

  for (const size of SMALLEST) {
    const at = `${size.width} by ${size.height}`;
    await page.setViewportSize(size);
    await lookAt(app, 'McLaren 570S GT4');
    await expect(app.locator('.versions .card')).toHaveCount(3);
    await expect(app.locator('.car-view dd')).toHaveCount(9);
    await expect(app.locator('.car-pedals .given')).toHaveText('From LightBrake — given by the rule: it has anti-lock brakes.');
    await expect(app.locator('.car-pedals .live-keys .key')).toHaveCount(4);
    expect(await scrolled(), at).toBe(0);
    expect(await allInSight(app.locator('.car-view')), `the view, at ${at}`).toBe(true);
    expect(await allInSight(app.locator('.car-pedals')), `the pedals, at ${at}`).toBe(true);
    // Beside each other, under the car's name and above what it wears — which begins in sight too.
    const tops = await app.locator('.car-head, .car-view, .car-pedals, .versions').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    expect(tops[1], at).toBe(tops[2]);
    expect(tops[0], at).toBeLessThan(tops[1]);
    expect(tops[1], at).toBeLessThan(tops[3]);
    expect(tops[3], at).toBeLessThan(size.height);
    // Nothing is cut off sideways, and the page has no scroll of its own.
    expect(await pane.evaluate((el) => el.scrollWidth <= el.clientWidth), at).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight), at).toBe(true);

    // Every car: one with no livery and no profile, one the host knows nothing of, one that is in no sim.
    for (const [name, row] of [['Caterham Seven 420R'], ['Lotus 79'], ['oldcar'], ['nissangtpzxt'], ['Mazda MX-5 Cup', MX5(app)]]) {
      await lookAt(app, name, row);
      expect(await scrolled(), `${name}, at ${at}`).toBe(0);
      expect(await allInSight(app.locator('.car-view')), `the view of ${name}, at ${at}`).toBe(true);
      expect(await allInSight(app.locator('.car-pedals')), `the pedals of ${name}, at ${at}`).toBe(true);
    }
  }
  expect(errors).toEqual([]);
});

test('choosing another car puts the pane at its top', async ({ page }) => {
  await stubPaintsBridge(page, PAINTS);
  await stubGroups(page, [SHATTER]);
  await stubRig(page);
  const errors = await openDesk(page, lotusLast(), '&page=cars');
  const app = page.locator(APP);
  const pane = app.locator('.main');
  await page.setViewportSize(SMALLEST[0]);
  await expect(app.locator('.car-head h2')).toHaveText('Lotus 79');
  await expect(app.locator('.versions .card')).toHaveCount(2);
  const toTheFoot = async () => {
    await pane.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    expect(await pane.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
    expect(await allInSight(app.locator('.car-view, .group-head').first())).toBe(false);
  };
  const atTheTop = async () => {
    await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBe(0);
    expect(await allInSight(app.locator('.car-view, .group-head').first())).toBe(true);
  };

  await toTheFoot();
  await lookAt(app, 'Mazda MX-5 Cup', MX5(app));
  await atTheTop();
  // By the keyboard as by the mouse.
  await toTheFoot();
  await app.locator('.sidebar .group .car', { hasText: 'Lotus 79' }).focus();
  await page.keyboard.press('Enter');
  await expect(app.locator('.car-head h2')).toHaveText('Lotus 79');
  await atTheTop();
  // A group is read from its top too.
  await toTheFoot();
  await app.locator('.sidebar .groups .car', { hasText: 'shatter' }).click();
  await expect(app.locator('.group-head h2')).toHaveText('shatter');
  await atTheTop();
  expect(errors).toEqual([]);
});

// ── Cars: what the car list says of a car, and where the car disagrees ──
// The canonical list of cars reaches the page through the app, as the rest of the rig does: rig.read() answers
// `controls` as { value }, { missing } or { error }, already bounded and shaped by modules/js/rig-api.js (positions
// as [value, name] pairs, what the check has kept as [{ car, remarks }]). Made up over the cars the tests already
// have. The McLaren is in the list and the check has found the car disagreeing with it twice; the MX-5 is in it and
// nothing has been found; the Caterham is not, and the check said so; the Lotus is not, and nothing was said; the
// Nissan is a prototype with a range for some of its dials and none for others, and words in it that are only text.

const said = (about, text, firstSeen, lastSeen) => ({ about, text, firstSeen, lastSeen });
const LIST_CARS = [
  {
    path: 'mclaren570sgt4', name: 'McLaren 570S GT4', kind: 'gt', abs: 'adjustable', tc: 'adjustable', brakeBias: 'none',
    controls: [{ id: 'mode', var: 'dcABS', label: 'ESC', positions: [[0, 'TRACK'], [1, 'SPORT'], [2, 'NORMAL']], covers: ['abs', 'tc'] }],
    checked: 'telemetry',
  },
  { path: 'mx5 mx52016', name: 'Mazda MX-5 Cup', kind: 'touring', abs: 'fixed', tc: 'none', brakeBias: 'none', controls: [], checked: 'written' },
  {
    path: 'nissangtpzxt', name: 'Nissan GTP ZX-T', kind: 'prototype', abs: 'none', tc: 'adjustable', brakeBias: 'adjustable',
    controls: [
      { id: 'brakeBias', var: 'dcBrakeBias', label: 'BAL', range: [40, 60] },
      { id: 'tc', var: 'dcTractionControl', label: 'TC1', off: 1, range: [1, 12] },
      { id: 'brakeMigration', var: 'dcABS', label: 'MIG', range: [-6, 6] },
      { id: 'throttleMap', var: 'dcThrottleShape', label: 'MAP', off: false },
      { id: 'tcToggle', var: 'dcTractionControlToggle', label: 'TC <b>TOGGLE</b>' },
      { id: 'absToggle', var: 'dcABSToggle', label: 'ABS' },
      { id: 'powerSteering', var: 'dcPowerSteering', label: 'PS', range: [3, 3] },
      { id: 'drs', var: 'DRS_Status', label: 'DRS' },
    ],
    checked: 'telemetry',
  },
];
const LIST_KEPT = [
  {
    car: 'mclaren570sgt4',
    remarks: [
      said('absent:dcABS', 'the list gives abs as dcABS, which the car does not publish', '2026-09-15T23:40:00.000Z', '2026-09-22T18:05:00.000Z'),
      said('value:dcABS', 'dcABS reads 3, a position of mode the list has no name for', '2026-09-22T18:05:00.000Z', '2026-09-22T18:05:00.000Z'),
    ],
  },
  {
    car: 'caterham caterham420r',
    remarks: [said('unknown', 'is not in the list: its controls are shown as they were before there was one', '2026-09-14T22:30:00.000Z', '2026-09-20T22:30:00.000Z')],
  },
];
const listOf = (cars = LIST_CARS, kept = LIST_KEPT) => held({ version: 1, listHash: '0123456789ab', count: cars.length, following: null, cars, kept });
const LISTED = { ...TOLD, controls: listOf() };
const CONTROLS_STRIP = ['panel car-view', 'panel car-pedals', 'panel car-controls'];
const stripOf = (app) => app.locator('.car-rig > *').evaluateAll((els) => els.map((el) => el.className.trim()));
// A moment as the desk writes one, whatever the rig's language and clock.
const FIRST_AND_LAST = /^First seen \S.*\d.*, last seen \S.*\d.*\.$/;
const SEEN_ONCE = /^Seen \S.*\d.*\.$/;
const NOT_IN_THE_LIST = 'This car is not in the car list. The HUD shows its controls as it did before there was a list.';

test('a car with no profile yet is said to wait on what the car list says, not on what the car publishes', async ({ page }) => {
  // The McLaren without its profile, nothing seen of its ABS; the Nissan, a prototype, seen publishing dcABS — which
  // in a GTP carries brake migration. The list answers both at once, and the rule gives each a profile when it is
  // next driven.
  const pedals = {
    ...TOLD_PEDALS,
    cars: TOLD_PEDALS.cars.filter((c) => c.car_path !== 'mclaren570sgt4'),
    without_profile: [
      ...TOLD_PEDALS.without_profile,
      bare('mclaren570sgt4', 'McLaren 570S GT4', null, facts(null, null, null, null)),
      bare('nissangtpzxt', null, null, facts(null, true, null, null)),
    ],
  };
  const { errors, app } = await openCars(page, `http://127.0.0.1:${host.address().port}`, { rig: { ...LISTED, pedals: held(pedals) } });
  const given = app.locator('.car-pedals .given');

  await lookAt(app, 'McLaren 570S GT4');
  await expect(given).toHaveText('No profile yet: the car list says it has anti-lock brakes, and the rule gives it one from LightBrake when it is next driven.');
  await lookAt(app, 'nissangtpzxt');
  await expect(given).toHaveText('No profile yet: the car list says it is a prototype, and the rule gives it one from Default when it is next driven.');
  // A car the list does not have waits on the data, as before.
  await lookAt(app, 'oldcar');
  await expect(given).toHaveText('No profile yet: it has anti-lock brakes, and the rule gives it one when it is next driven.');
  expect(errors).toEqual([]);

  // A host with no list: the prototype waits on the data, and the data's word is the only one there is.
  const { app: bare2 } = await openCars(page, `http://127.0.0.1:${host.address().port}`, { rig: { ...TOLD, pedals: held(pedals) } });
  await lookAt(bare2, 'nissangtpzxt');
  await expect(bare2.locator('.car-pedals .given')).toHaveText('No profile yet: it has anti-lock brakes, and the rule gives it one when it is next driven.');
});

test('a car\'s controls, as the list has them: its kind, what it has, the car\'s own names for its dials, and how it was checked', async ({ page }) => {
  const { errors, app } = await openCars(page, `http://127.0.0.1:${host.address().port}`, { rig: LISTED });
  const panel = app.locator('.car-controls');
  const facts = panel.locator('.facts');

  // A car with a dial that stands for two things, whose values have names.
  await lookAt(app, 'McLaren 570S GT4');
  expect(await stripOf(app)).toEqual(CONTROLS_STRIP);
  await expect(panel.locator('h3')).toHaveText('Controls');
  await expect(facts.locator('dt')).toHaveText(['Kind', 'Anti-lock', 'Traction control', 'Brake bias']);
  await expect(facts.locator('dd')).toHaveText(['GT car', 'adjustable ESC', 'adjustable ESC', 'none']);
  // The rows of controls are folded until asked for, so that the car's liveries stay in sight under this panel.
  const rows = panel.locator('.control-rows');
  await expect(rows).toHaveCount(1);
  expect(await rows.evaluate((el) => el.open)).toBe(false);
  await expect(rows.locator('summary')).toHaveText('Each control, its label and values 1');
  await expect(panel.locator('.controls')).toBeHidden();
  await rows.locator('summary').click();
  await expect(panel.locator('.controls')).toBeVisible();
  await expect(panel.locator('.controls li')).toHaveText(['Mode ESC 0 TRACK · 1 SPORT · 2 NORMAL']);
  await expect(panel.locator('.controls li .tag')).toHaveText(['ESC']);
  // How it was checked is beside the heading, one line above what the list says, and is not lost with the rows.
  await expect(panel.locator('.head .checked')).toHaveText('Checked against your telemetry.');

  // A car whose ranges and off positions are the list's own words, and whose labels are only text. What was opened
  // stays open as he goes down the list of cars, which is a choice of his and not the panel's.
  await lookAt(app, 'nissangtpzxt');
  await expect(facts.locator('dd')).toHaveText(['Prototype', 'none', 'adjustable TC1', 'adjustable BAL']);
  await expect(rows.locator('summary')).toHaveText('Each control, its label and values 8');
  expect(await rows.evaluate((el) => el.open)).toBe(true);
  await expect(panel.locator('.controls li')).toHaveText([
    'Brake bias BAL 40 to 60',
    'Traction control TC1 1 to 12, 1 is off',
    'Brake migration MIG -6 to 6',
    'Throttle map MAP never off',
    'Traction toggle TC <b>TOGGLE</b>',
    'Anti-lock toggle ABS',
    'Power steering PS only 3',
    // DRS is the dial's generic name: its own label would say it twice.
    'DRS status',
  ]);
  await expect(panel.locator('.controls li b')).toHaveCount(0);
  // The variable that carries a control is under its row, for whoever is putting the list right.
  await expect(panel.locator('.controls li').first()).toHaveAttribute('title', 'dcBrakeBias');
  await expect(panel.locator('.checked')).toHaveText('Checked against your telemetry.');
  await expect(panel.locator('.disagreements')).toHaveCount(0);

  // Written from the manuals and not yet held against his telemetry, which the page says instead. A car the list
  // gives no controls says so, and its ABS is the one that is fixed.
  await lookAt(app, 'Mazda MX-5 Cup', MX5(app));
  await expect(facts.locator('dd')).toHaveText(['Touring car', 'fixed', 'none', 'none']);
  await expect(facts.locator('.fact').nth(1)).toHaveAttribute('title', 'The car has it, and you cannot turn it.');
  await expect(panel.locator('.controls')).toHaveCount(0);
  await expect(panel.locator('.facts + .note')).toHaveText('The list gives this car no controls.');
  await expect(panel.locator('.control-rows')).toHaveCount(0);
  await expect(panel.locator('.checked')).toHaveText('Written from the manuals; not checked against your telemetry yet.');
  await expect(panel.locator('.disagreements')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('where the car and the list disagree is set apart, each in a sentence with when it was first and last seen', async ({ page }) => {
  const { errors, app } = await openCars(page, `http://127.0.0.1:${host.address().port}`, { rig: LISTED });
  const panel = app.locator('.car-controls');
  const differences = panel.locator('.disagreements');

  await lookAt(app, 'McLaren 570S GT4');
  await expect(differences).toBeVisible();
  await expect(differences).toHaveAttribute('role', 'group');
  await expect(differences).toHaveAttribute('aria-label', 'Where the car and the list disagree');
  await expect(differences.locator('.heading')).toHaveText('Where the car and the list disagree 2');
  // Sentences: the first letter up and a full stop, except that a variable is written as the sim writes it.
  await expect(differences.locator('li .says')).toHaveText([
    'The list gives abs as dcABS, which the car does not publish.',
    'dcABS reads 3, a position of mode the list has no name for.',
  ]);
  const when = differences.locator('li .when');
  await expect(when).toHaveCount(2);
  await expect(when.first()).toHaveText(FIRST_AND_LAST);
  await expect(when.nth(1)).toHaveText(SEEN_ONCE);   // said once, so first and last are the one moment
  // Above what the list says, where the eye lands, and not in the colour of the rest of the panel.
  const order = await panel.evaluate((el) => [...el.children].map((c) => c.className || c.tagName));
  expect(order).toEqual(['head', 'disagreements', 'facts', 'control-rows']);
  const [warning, ordinary] = await Promise.all([
    differences.locator('.heading').evaluate((el) => getComputedStyle(el).color),
    panel.locator('h3').evaluate((el) => getComputedStyle(el).color),
  ]);
  expect(warning).not.toBe(ordinary);
  const box = await differences.evaluate((el) => { const s = getComputedStyle(el); return [s.borderLeftWidth, s.borderTopWidth]; });
  expect(box).toEqual(['3px', '1px']);

  // The others have none to show.
  await lookAt(app, 'Lotus 79');
  await expect(differences).toHaveCount(0);
  await lookAt(app, 'Mazda MX-5 Cup', MX5(app));
  await expect(differences).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('what the check says is text: a tag in it is shown as it was written, and is not one', async ({ page }) => {
  const kept = [{ car: 'nissangtpzxt', remarks: [said('unlisted', 'the car publishes <img src=x onerror="window.__ran = 1">, which the list gives to no control', null, null)] }];
  const { errors, app } = await openCars(page, `http://127.0.0.1:${host.address().port}`, { rig: { ...TOLD, controls: listOf(LIST_CARS, kept) } });
  await lookAt(app, 'nissangtpzxt');
  await expect(app.locator('.disagreements li .says')).toHaveText('The car publishes <img src=x onerror="window.__ran = 1">, which the list gives to no control.');
  await expect(app.locator('.disagreements img')).toHaveCount(0);
  // With no moment given there is none to say: no "Seen", and no empty line where it would be.
  await expect(app.locator('.disagreements .when')).toHaveCount(0);
  expect(await page.evaluate(() => window.__ran)).toBeUndefined();
  expect(errors).toEqual([]);
});

test('a car the list does not have says so plainly, and makes up nothing in its place', async ({ page }) => {
  const { errors, app } = await openCars(page, `http://127.0.0.1:${host.address().port}`, { rig: LISTED });
  const panel = app.locator('.car-controls');

  // The check noticed it, and when.
  await lookAt(app, 'Caterham Seven 420R');
  expect(await stripOf(app)).toEqual(CONTROLS_STRIP);
  await expect(panel.locator('.not-listed > div').first()).toHaveText(NOT_IN_THE_LIST);
  await expect(panel.locator('.not-listed .note')).toHaveText(/^The check noticed it\. First seen \S.*\d.*, last seen \S.*\d.*\.$/);
  await expect(panel.locator('.facts')).toHaveCount(0);
  await expect(panel.locator('.controls')).toHaveCount(0);
  await expect(panel.locator('.checked')).toHaveCount(0);
  // That the list lacks the car is not a disagreement with it.
  await expect(panel.locator('.disagreements')).toHaveCount(0);

  // One the check has not said anything of.
  await lookAt(app, 'Lotus 79');
  await expect(panel.locator('.not-listed')).toHaveText(NOT_IN_THE_LIST);
  await expect(panel.locator('.not-listed .note')).toHaveCount(0);
  await lookAt(app, 'oldcar');
  await expect(panel.locator('.not-listed')).toHaveText(NOT_IN_THE_LIST);
  expect(errors).toEqual([]);
});

test('a car the list and the car disagree about is marked in the list of cars, and no other is', async ({ page }) => {
  const { errors, app } = await openCars(page, `http://127.0.0.1:${host.address().port}`, { rig: LISTED });
  const marks = app.locator('.sidebar .mark.differs');
  await expect(marks).toHaveCount(1);
  await expect(marks).toHaveText('≠ list');
  await expect(marks).toHaveAttribute('title', 'What this car publishes disagrees with the car list: see its Controls');
  await expect(carRow(app, 'McLaren 570S GT4').locator('.mark')).toHaveText(['view', 'pedals', '≠ list']);
  await expect(carRow(app, 'McLaren 570S GT4').locator('.mark.differs')).toHaveCount(1);
  // The Caterham was said not to be in the list, which is no disagreement; the MX-5 was said nothing of.
  await expect(carRow(app, 'Caterham Seven 420R').locator('.mark')).toHaveText(['view', 'pedals']);
  await expect(MX5(app).locator('.mark.differs')).toHaveCount(0);
  // A word inside the row, as the others are: from one row the next Tab is the next row.
  await carRow(app, 'McLaren 570S GT4').focus();
  await page.keyboard.press('Tab');
  await expect(app.locator('.sidebar .car:focus')).not.toHaveText(/McLaren/);
  // Its name is still only its name.
  await expect(carRow(app, 'McLaren 570S GT4').locator('.name')).toHaveText('McLaren 570S GT4');

  // Driven narrows the list, and the mark goes where the car does.
  await app.locator('.sidebar .filter .driven').click();
  await expect(app.locator('.sidebar .mark.differs')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('a host from before the list: the page is as it was', async ({ page }) => {
  const { errors, app } = await openCars(page, `http://127.0.0.1:${host.address().port}`, { rig: TOLD });
  await lookAt(app, 'McLaren 570S GT4');
  const before = { rig: await app.locator('.car-rig').innerHTML(), marks: await app.locator('.sidebar .mark').allTextContents() };
  expect(await stripOf(app)).toEqual(['panel car-view', 'panel car-pedals']);
  await expect(app.locator('.car-controls')).toHaveCount(0);
  await expect(app.locator('.sidebar .mark.differs')).toHaveCount(0);
  expect(before.marks).toContain('pedals');

  // Whichever way it does not have it: an app whose answer has no such key, a host with no such route, a host whose
  // build carries no list, a list with no cars in it.
  const none = [
    ['no key in the answer', TOLD],
    ['a host with no route', { ...TOLD, controls: OLDER }],
    ['a list with no cars', { ...TOLD, controls: held({ version: 1, listHash: 'empty', count: 0, following: null, cars: [], kept: [] }) }],
    ['a list with no cars and something kept', { ...TOLD, controls: held({ version: 1, listHash: 'empty', count: 0, following: null, cars: [], kept: LIST_KEPT }) }],
  ];
  for (const [what, rig] of none) {
    await stubRig(page, rig);
    await page.reload();
    const again = page.locator(APP);
    await lookAt(again, 'McLaren 570S GT4');
    expect(await stripOf(again), what).toEqual(['panel car-view', 'panel car-pedals']);
    expect(await again.locator('.car-rig').innerHTML(), what).toBe(before.rig);
    expect(await again.locator('.sidebar .mark').allTextContents(), what).toEqual(before.marks);
    await expect(again.locator('.car-controls'), what).toHaveCount(0);
    await lookAt(again, 'Caterham Seven 420R');
    await expect(again.locator('.car-controls'), what).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test('a list that could not be read is said in the Controls panel, and the rest of the page is as it was', async ({ page }) => {
  const nothing = { error: 'Nothing is answering at http://127.0.0.1:8889.' };
  const { errors, app } = await openCars(page, `http://127.0.0.1:${host.address().port}`, { rig: { ...TOLD, controls: nothing } });
  await lookAt(app, 'McLaren 570S GT4');
  expect(await stripOf(app)).toEqual(CONTROLS_STRIP);
  await expect(app.locator('.car-controls .note')).toHaveText('The car list could not be read. Nothing is answering at http://127.0.0.1:8889.');
  await expect(app.locator('.car-controls .facts')).toHaveCount(0);
  await expect(app.locator('.car-view dd').nth(1)).toHaveText('−60 mm');   // the view is the view
  await expect(app.locator('.car-pedals select')).toHaveValue('5511aacc');
  await expect(app.locator('.sidebar .mark.differs')).toHaveCount(0);

  // An answer that is not the list is not taken for one.
  await stubRig(page, { ...TOLD, controls: held('the list') });
  await page.reload();
  const odd = page.locator(APP);
  await lookAt(odd, 'McLaren 570S GT4');
  await expect(odd.locator('.car-controls .note')).toHaveText('The car list could not be read. The host\'s answer was not the list.');

  // The rest of the app answered nothing of it at all, or something that is not an answer.
  await stubRig(page, { ...TOLD, controls: 'nothing' });
  await page.reload();
  const none = page.locator(APP);
  await lookAt(none, 'McLaren 570S GT4');
  await expect(none.locator('.car-controls .note')).toHaveText('The car list could not be read. The app did not answer.');
  expect(errors).toEqual([]);
});

test('a store that could not be read says so beside the list, and no disagreement is made up in its place', async ({ page }) => {
  const { errors, app } = await openCars(page, `http://127.0.0.1:${host.address().port}`, { rig: { ...TOLD, controls: listOf(LIST_CARS, null) } });
  const panel = app.locator('.car-controls');
  await lookAt(app, 'McLaren 570S GT4');
  await expect(panel.locator('.facts dd')).toHaveText(['GT car', 'adjustable ESC', 'adjustable ESC', 'none']);
  await expect(panel.locator('.note').last()).toHaveText('What the check has found could not be read from the host\'s store.');
  await expect(panel.locator('.disagreements')).toHaveCount(0);
  await expect(app.locator('.sidebar .mark.differs')).toHaveCount(0);
  await lookAt(app, 'Lotus 79');
  await expect(panel.locator('.not-listed')).toContainText(NOT_IN_THE_LIST);
  await expect(panel.locator('.note').last()).toHaveText('What the check has found could not be read from the host\'s store.');

  // Not the same as nothing kept, which says nothing.
  await stubRig(page, { ...TOLD, controls: listOf(LIST_CARS, []) });
  await page.reload();
  const none = page.locator(APP);
  await lookAt(none, 'McLaren 570S GT4');
  await expect(none.locator('.car-controls .facts')).toHaveCount(1);
  await expect(none.locator('.car-controls .disagreements')).toHaveCount(0);
  await expect(none.locator('.car-controls .note').filter({ hasText: 'could not be read' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the list is read again with the rest of what the host keeps, and chosen with the car', async ({ page }) => {
  const own = await startMockHost(buildHistory());
  try {
    await stubPaintsBridge(page, PAINTS);
    await stubRig(page, LISTED);
    const errors = await openDesk(page, `http://127.0.0.1:${own.address().port}`, '&page=cars');
    const app = page.locator(APP);
    await expect.poll(() => rigReads(page)).toBe(1);
    await lookAt(app, 'McLaren 570S GT4');
    await expect(app.locator('.car-controls .disagreements li')).toHaveCount(2);

    // What the host keeps changes while the page is up: the next read has it.
    await page.evaluate(() => {
      const read = window.racingDesk.rig.read;
      window.racingDesk.rig.read = async () => {
        const answer = await read();
        answer.controls.value.kept = answer.controls.value.kept.filter((k) => k.car !== 'mclaren570sgt4');
        return answer;
      };
    });
    await page.locator('#refresh').click();
    await expect.poll(() => rigReads(page)).toBe(2);
    await expect(app.locator('.car-controls .disagreements')).toHaveCount(0);
    await expect(app.locator('.sidebar .mark.differs')).toHaveCount(0);
    await expect(app.locator('.car-controls .facts')).toHaveCount(1);
    await expect(app.locator('.car-head h2')).toHaveText('McLaren 570S GT4');

    // The page asked for none of it itself.
    expect(NOT_THE_PAGES.map((route) => askedFor(own, route))).toEqual(NOT_THE_PAGES.map(() => 0));
    expect(errors).toEqual([]);
  } finally {
    await new Promise((resolve) => own.close(resolve));
  }
});

test('in the desk\'s smallest window the view and the pedals are still in sight, with the controls under them', async ({ page }) => {
  const painted = CATALOGUE.map((c) => (c.folder === 'mclaren570sgt4'
    ? { ...c, versions: [version('shatter', 'shatter', c.folder), version('shatter-inverted', 'shatter-inverted', c.folder), version('v3', 'v3', c.folder)] }
    : c));
  const { errors, app } = await openCars(page, `http://127.0.0.1:${host.address().port}`, {
    paints: { ...PAINTS, carCatalogue: painted, repoStatus: CHECKOUT, repoCheck: CHECKOUT }, rig: LISTED,
  });
  const pane = app.locator('.main');

  for (const size of SMALLEST) {
    const at = `${size.width} by ${size.height}`;
    await page.setViewportSize(size);
    // The car with the most to say: liveries, a view, a profile from the rule, the keys, a mode dial and two
    // disagreements.
    await lookAt(app, 'McLaren 570S GT4');
    await expect(app.locator('.versions .card')).toHaveCount(3);
    await expect(app.locator('.car-controls .disagreements li')).toHaveCount(2);
    expect(await pane.evaluate((el) => el.scrollTop), at).toBe(0);
    expect(await allInSight(app.locator('.car-view')), `the view, at ${at}`).toBe(true);
    expect(await allInSight(app.locator('.car-pedals')), `the pedals, at ${at}`).toBe(true);
    // Beside each other as they were, with the controls across both and under them.
    const boxes = await app.locator('.car-head, .car-view, .car-pedals, .car-controls, .versions').evaluateAll((els) => els.map((el) => {
      const b = el.getBoundingClientRect();
      return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right) };
    }));
    const [head, view, pedals, controls, versions] = boxes;
    expect(view.top, at).toBe(pedals.top);
    expect(head.top, at).toBeLessThan(view.top);
    expect(controls.top, at).toBeGreaterThanOrEqual(Math.max(view.bottom, pedals.bottom));
    expect(controls.left, at).toBeLessThanOrEqual(view.left);
    expect(controls.right, at).toBeGreaterThanOrEqual(pedals.right);
    expect(versions.top, at).toBeGreaterThanOrEqual(controls.bottom);
    // The controls begin in sight, and where the car and the list disagree is all in sight — it is what the panel is
    // for after a drive — with what the list says of the car below it. Nothing is cut off sideways, and the page has
    // no scroll of its own.
    expect(controls.top, at).toBeLessThan(size.height);
    expect(await allInSight(app.locator('.car-controls .disagreements')), `what disagrees, at ${at}`).toBe(true);
    expect(await pane.evaluate((el) => el.scrollWidth <= el.clientWidth), at).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight), at).toBe(true);

    // Every other car keeps the view and the pedals where they were.
    for (const [name, row] of [['Caterham Seven 420R'], ['Lotus 79'], ['oldcar'], ['nissangtpzxt'], ['Mazda MX-5 Cup', MX5(app)]]) {
      await lookAt(app, name, row);
      expect(await pane.evaluate((el) => el.scrollTop), `${name}, at ${at}`).toBe(0);
      expect(await allInSight(app.locator('.car-view')), `the view of ${name}, at ${at}`).toBe(true);
      expect(await allInSight(app.locator('.car-pedals')), `the pedals of ${name}, at ${at}`).toBe(true);
    }
  }
  expect(errors).toEqual([]);
});

test('with the list and nothing found, a listed car\'s liveries still begin in sight in the desk\'s smallest window', async ({ page }) => {
  // Nearly every car is in the list once it lands, and a prototype in it has eight controls: what the list says of a
  // car is a line and its dials, and the rows of controls are one press away, or the liveries of every listed car
  // would begin below the fold — with nothing wrong with the car at all.
  const painted = CATALOGUE.map((c) => (c.folder === 'mclaren570sgt4'
    ? { ...c, versions: [version('shatter', 'shatter', c.folder), version('shatter-inverted', 'shatter-inverted', c.folder), version('v3', 'v3', c.folder)] }
    : c));
  const { errors, app } = await openCars(page, `http://127.0.0.1:${host.address().port}`, {
    paints: { ...PAINTS, carCatalogue: painted, repoStatus: CHECKOUT, repoCheck: CHECKOUT }, rig: { ...TOLD, controls: listOf(LIST_CARS, []) },
  });
  const pane = app.locator('.main');
  const top = (locator) => locator.evaluate((el) => Math.round(el.getBoundingClientRect().top));

  for (const size of SMALLEST) {
    const at = `${size.width} by ${size.height}`;
    await page.setViewportSize(size);
    // The one with one control, the prototype with eight (and one livery), and one the list has not got.
    for (const [name, cards] of [['McLaren 570S GT4', 3], ['nissangtpzxt', 1], ['Lotus 79', 2]]) {
      await lookAt(app, name);
      await expect(app.locator('.versions .card')).toHaveCount(cards);
      await expect(app.locator('.car-controls')).toHaveCount(1);
      await expect(app.locator('.car-controls .disagreements')).toHaveCount(0);
      expect(await pane.evaluate((el) => el.scrollTop), `${name}, at ${at}`).toBe(0);
      if (name !== 'Lotus 79') expect(await app.locator('.control-rows').evaluate((el) => el.open), `${name} folded, at ${at}`).toBe(false);
      // The liveries begin in sight, and so does all of what the list says of the car.
      const versions = await top(app.locator('.versions'));
      expect(versions, `where the liveries of ${name} begin, at ${at}`).toBeLessThan(size.height);
      expect(await allInSight(app.locator('.car-controls')), `the controls of ${name}, at ${at}`).toBe(true);
      expect(await allInSight(app.locator('.car-view')), `the view of ${name}, at ${at}`).toBe(true);
      expect(await allInSight(app.locator('.car-pedals')), `the pedals of ${name}, at ${at}`).toBe(true);
      expect(await pane.evaluate((el) => el.scrollWidth <= el.clientWidth), `${name}, at ${at}`).toBe(true);
    }

    // Asked for, the rows are there — and the view and the pedals are where they were, above them.
    await lookAt(app, 'nissangtpzxt');
    await app.locator('.control-rows summary').click();
    await expect(app.locator('.control-rows .controls li')).toHaveCount(8);
    await expect(app.locator('.control-rows .controls li').first()).toBeVisible();
    expect(await allInSight(app.locator('.car-view')), `the view, at ${at}`).toBe(true);
    expect(await allInSight(app.locator('.car-pedals')), `the pedals, at ${at}`).toBe(true);
    await app.locator('.control-rows summary').click();
    expect(await app.locator('.control-rows').evaluate((el) => el.open)).toBe(false);
  }
  expect(errors).toEqual([]);
});

// ── Cars: what the page keeps an eye on, and when ────────────
// The chips say whether the sim or the downloader is running, and each look starts a process in the app. The
// page stays mounted through a race, so it looks only while the desk's window is the one in front.

const looks = async (page) => {
  const [sim, downloader] = await Promise.all([paintsCalls(page, 'simStatus'), paintsCalls(page, 'tradingPaintsStatus')]);
  expect(downloader.length).toBe(sim.length);
  return sim.length;
};
// The remote is asked about once a livery has been within reach for a second (App.tsx, REMOTE_AFTER_MS). This is
// long enough for it to have been asked, had it been going to be.
const UNASKED_MS = 1400;

test('the guards are looked at every eight seconds while the desk\'s window is in front, at once when it comes there, and not otherwise', async ({ page }) => {
  await stubPaintsBridge(page, {
    ...PAINTS,
    simStatus: { simRunning: true, uiRunning: true, matched: ['iRacingSim64DX11.exe'] },
    applyVersion: { __error: SIM_RUNNING },
  });
  await stubRig(page);
  const errors = await openDesk(page, lotusLast(), '&page=cars', { timers: true });
  const app = page.locator(APP);
  await expect(app.locator('.versions .card')).toHaveCount(2);
  await expect.poll(() => looks(page)).toBe(1);   // somebody is looking: at once
  await page.clock.pauseAt(new Date(NOW.getTime() + 60000));   // from here the clock is the test's
  const before = await looks(page);

  await page.clock.runFor(8000);
  await expect.poll(() => looks(page)).toBe(before + 1);
  await page.clock.runFor(16000);
  await expect.poll(() => looks(page)).toBe(before + 3);

  // Behind another window — he is driving — nothing is looked at, however long, and whatever the desk shows
  // meanwhile: the app can be asked for a page from the tray or a button on the wheel.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.clock.runFor(120000);
  expect(await looks(page)).toBe(before + 3);
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('racingdesk:page', { detail: 'cars' })));
  await page.clock.runFor(30000);
  expect(await looks(page)).toBe(before + 3);
  // In front again: at once, and then every eight seconds as before.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => looks(page)).toBe(before + 4);
  await page.clock.runFor(8000);
  await expect.poll(() => looks(page)).toBe(before + 5);

  // Another page of the desk is up: the same.
  await page.locator('.nav a', { hasText: 'Settings' }).click();
  await expect(page.locator('#settings')).toBeVisible();
  await page.clock.runFor(60000);
  expect(await looks(page)).toBe(before + 5);
  await page.locator('.nav a', { hasText: 'Cars' }).click();
  await expect.poll(() => looks(page)).toBe(before + 6);
  await page.clock.runFor(8000);
  await expect.poll(() => looks(page)).toBe(before + 7);

  // What stands in an apply's way is asked about when the apply is refused, whoever is or is not looking: it
  // does not go by what the chips last said.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await app.locator('.versions .card', { hasText: 'v13 Shatter' }).locator('.actions button.primary').click();
  await expect(app.locator('.refusal').getByRole('button')).toHaveText(['Apply v13 Shatter anyway', 'Dismiss']);
  expect(await looks(page)).toBe(before + 8);
  await page.clock.runFor(60000);
  expect(await looks(page)).toBe(before + 8);
  expect(errors).toEqual([]);
});

test('the library\'s remote is asked when a livery is within reach or he asks, not for looking at how a car is driven', async ({ page }) => {
  // The car driven last has no livery: the page opens on its view and pedals, with nothing to apply.
  const { errors, app } = await openCars(page, `http://127.0.0.1:${host.address().port}`, {
    paints: { ...PAINTS, repoStatus: CHECKOUT, repoCheck: { ...CHECKOUT, checkedRemote: true } },
  });
  const source = app.locator('.panel', { hasText: 'Library source' });
  const asked = () => paintsCalls(page, 'repoCheck');
  await expect(app.locator('.car-head h2')).toHaveText('McLaren 570S GT4');
  await expect(app.locator('.car-view dd').nth(1)).toHaveText('−60 mm');
  // The checkout as it stands on disk is read, which asks nothing of anybody.
  await expect(source.locator('.badge')).toHaveText('up to date as of last check');
  await lookAt(app, 'Caterham Seven 420R');
  await page.waitForTimeout(UNASKED_MS);
  expect(await asked()).toEqual([]);
  expect(await paintsCalls(page, 'repoStatus')).toEqual([{ path: LIBRARY }]);

  // A car with a livery, passed on the way to another: not for that either.
  await lookAt(app, 'Lotus 79');
  await expect(app.locator('.versions .card')).toHaveCount(2);
  await lookAt(app, 'McLaren 570S GT4');
  await page.waitForTimeout(UNASKED_MS);
  expect(await asked()).toEqual([]);
  // One stayed on, and the window behind another: not yet. In front: asked, once for the library.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await lookAt(app, 'Lotus 79');
  await page.waitForTimeout(UNASKED_MS);
  expect(await asked()).toEqual([]);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(asked).toEqual([{ path: LIBRARY }]);
  await expect(source.locator('.badge')).toHaveText('up to date');
  await lookAt(app, 'Mazda MX-5 Cup', MX5(app));
  await page.waitForTimeout(UNASKED_MS);
  expect(await asked()).toHaveLength(1);

  // Check asks whenever he does, whatever car is on the page.
  await lookAt(app, 'McLaren 570S GT4');
  await source.getByRole('button', { name: 'Check' }).click();
  await expect.poll(asked).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('a group on the page is a livery within reach', async ({ page }) => {
  await stubPaintsBridge(page, { ...PAINTS, repoStatus: CHECKOUT, repoCheck: { ...CHECKOUT, checkedRemote: true } });
  await stubGroups(page, [SHATTER]);
  await stubRig(page);
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=cars');
  const app = page.locator(APP);
  await expect(app.locator('.car-head h2')).toHaveText('McLaren 570S GT4');
  await page.waitForTimeout(UNASKED_MS);
  expect(await paintsCalls(page, 'repoCheck')).toEqual([]);
  await app.locator('.sidebar .groups .car', { hasText: 'shatter' }).click();
  await expect(app.locator('.group-head h2')).toHaveText('shatter');
  await expect.poll(() => paintsCalls(page, 'repoCheck')).toEqual([{ path: LIBRARY }]);
  expect(errors).toEqual([]);
});

// ── Cars: the library keeps itself up to date ────────────────
// On unless he turned it off (`autoUpdateLibrary`; null, and the old `autoUpdateOnLaunch` that was only ever the
// page's default, are on). The remote is looked at as the page starts, every half hour, and when the window is back
// in front after as long away — never while the sim is running, and never two at once — and what is waiting is taken.
// What is in the way is one plain sentence on the chip, and nothing on the page sends him to git.

const UP = { ...CHECKOUT, checkedRemote: true, updatesAvailable: true };
const CURRENT = { ...CHECKOUT, checkedRemote: true };
const pulled = (over = {}) => ({ updated: true, commits: ['abc1234 lotus79: v14'], changed: 3, setAside: null, blocked: null, status: CURRENT, ...over });
// The desk's own sentences (apps/overlay/modules/js/paints/repo.js says them; the page prints what it is told).
const IN_THE_WAY = {
  changes: 'The library has changes of its own that are not online, so it was not updated. Nothing was changed.',
  work: 'The library has work of its own that is not online, so it was not updated. Nothing was changed.',
  files: 'Files in the library are in the way of the update and could not be moved aside, so it was not updated. Nothing was changed.',
  other: 'The library could not be brought up to date just now, so it was not updated. Nothing was changed.',
  // Files were moved aside for it and some could not be put back: something was changed, and it is said.
  kept: 'The library was not updated, and some files that were in the way of it could not be put back, so they are in the folder they were set aside in.',
};
const refusedFor = (reason, status = UP, setAside = null) => ({ updated: false, commits: [], changed: 0, setAside, blocked: { reason, text: IN_THE_WAY[reason] }, status });
// The desk's answer to a look at a remote it could not reach (repo.js `check`): no answer from it, and a note; with
// what an earlier fetch left behind still counting as waiting, which is not news.
const UNREACHABLE = { ...CHECKOUT, behind: 1, updatesAvailable: true, checkedRemote: false, notes: ['Could not reach the remote to check for updates.'] };
const ASIDE_FOLDER = 'C:\\Users\\Owner\\AppData\\Local\\Racing Desk\\library-set-aside\\2026-09-29_101530';
const RUNNING = { simRunning: true, uiRunning: false, matched: ['iRacingSim64DX11.exe'] };
const sourcePanel = (app) => app.locator('.panel', { hasText: 'Library source' });
const autoBox = (app) => sourcePanel(app).getByLabel('Keep the library up to date by itself');
const chipOf = (app) => app.locator('.chips .chip');

// Everything a chip or a toast says, and the tooltip a chip carries, that he could read: none of it is about git.
async function saidOnTheChips(app) {
  const said = [
    ...(await app.locator('.chips .chip, .chip-detail, .toast').allInnerTexts()),
    ...(await app.locator('.chips .chip').evaluateAll((els) => els.map((el) => el.title))),
  ].join('\n');
  expect(said).not.toMatch(/\bgit\b|commit|stash|Library source/i);
  return said;
}

test('with nothing saved the library keeps itself up to date: looked at as the page starts, updated, and what arrived is said', async ({ page }) => {
  const { errors, app } = await openCars(page, lotusLast(), {
    paints: { ...PAINTS, loadSettings: {}, repoStatus: CHECKOUT, repoCheck: UP, repoPull: { __after: 1500, answer: pulled() } },
  });
  // The page starts, and asks nothing of him: no livery had to be within reach, nobody had to press anything.
  await expect(chipOf(app)).toHaveText('Updating library…');
  await saidOnTheChips(app);
  await expect(app.locator('.toast .grow')).toHaveText('Library updated: 3 liveries added or changed.');
  await expect(chipOf(app)).toHaveText('ready');
  expect(await paintsCalls(page, 'repoCheck')).toEqual([{ path: LIBRARY }]);
  expect(await paintsCalls(page, 'repoPull')).toEqual([{ path: LIBRARY }]);
  expect((await paintsCalls(page, 'simStatus')).length).toBeGreaterThan(0);   // asked, and not running
  // The library is read again, as an update by hand does.
  await expect.poll(() => paintsCalls(page, 'carCatalogue')).toHaveLength(2);
  await expect(app.locator('.log .entry').first()).toContainText('The library was updated');
  await saidOnTheChips(app);

  // It is where it was, ticked, under the words he can follow; and he never chose it, so what is saved is not a choice.
  await expect(autoBox(app)).toBeChecked();
  await expect.poll(async () => (await paintsCalls(page, 'saveSettings')).at(-1)?.settings.autoUpdateLibrary).toBeNull();
  expect((await paintsCalls(page, 'saveSettings')).at(-1).settings).not.toHaveProperty('autoUpdateOnLaunch');
  await app.locator('.toast').getByRole('button', { name: 'Dismiss' }).click();
  await expect(app.locator('.toast')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('an older version\'s saved false is its default, not his choice: the library still updates itself', async ({ page }) => {
  const { errors, app } = await openCars(page, lotusLast(), {
    paints: { ...PAINTS, loadSettings: { autoUpdateOnLaunch: false }, repoStatus: CHECKOUT, repoCheck: UP, repoPull: pulled() },
  });
  await expect(app.locator('.toast .grow')).toHaveText('Library updated: 3 liveries added or changed.');
  expect(await paintsCalls(page, 'repoPull')).toEqual([{ path: LIBRARY }]);
  await expect(autoBox(app)).toBeChecked();
  await expect.poll(async () => (await paintsCalls(page, 'saveSettings')).at(-1)?.settings.autoUpdateLibrary).toBeNull();
  expect((await paintsCalls(page, 'saveSettings')).at(-1).settings).not.toHaveProperty('autoUpdateOnLaunch');
  expect(errors).toEqual([]);
});

test('turned off, nothing is taken by itself: the chip says updates are waiting and has an Update now that does it there', async ({ page }) => {
  const { errors, app } = await openCars(page, lotusLast(), {
    paints: { ...PAINTS, loadSettings: { autoUpdateLibrary: false }, repoStatus: CHECKOUT, repoCheck: UP, repoPull: { __after: 1500, answer: pulled({ changed: 1 }) } },
  });
  await expect(autoBox(app)).not.toBeChecked();
  // Asked once, when a livery is within reach — this car has two — and said on the chip, not on a toast.
  await expect(chipOf(app)).toHaveText('Updates waiting');
  await page.waitForTimeout(UNASKED_MS);
  expect(await paintsCalls(page, 'repoCheck')).toEqual([{ path: LIBRARY }]);
  expect(await paintsCalls(page, 'repoPull')).toEqual([]);
  await expect(app.locator('.toast')).toHaveCount(0);

  await chipOf(app).click();
  await expect(app.locator('.chip-detail')).toContainText('New liveries are waiting to be added to the library.');
  await expect(app.locator('.chip-detail').getByRole('button')).toHaveText('Update now');
  await saidOnTheChips(app);
  await app.locator('.chip-detail').getByRole('button', { name: 'Update now' }).click();
  await expect(chipOf(app)).toHaveText('Updating library…');
  await expect(app.locator('.toast .grow')).toHaveText('Library updated: 1 livery added or changed.');
  await expect(chipOf(app)).toHaveText('ready');
  await expect(app.locator('.chip-detail')).toHaveCount(0);
  expect(await paintsCalls(page, 'repoPull')).toEqual([{ path: LIBRARY }]);
  await saidOnTheChips(app);

  // Turned on, it does what it is for at once, and the choice is saved as his.
  await autoBox(app).check();
  await expect.poll(() => paintsCalls(page, 'repoPull')).toHaveLength(2);
  await expect.poll(async () => (await paintsCalls(page, 'saveSettings')).at(-1)?.settings.autoUpdateLibrary).toBe(true);
  expect(errors).toEqual([]);
});

test('the remote is looked at every half hour while the app runs, and never while the sim is', async ({ page }) => {
  const { errors, app } = await openCars(page, lotusLast(), {
    paints: { ...PAINTS, loadSettings: {}, repoStatus: CHECKOUT, repoCheck: CURRENT },
    timers: true,
  });
  const asked = () => paintsCalls(page, 'repoCheck');
  await expect(app.locator('.versions .card')).toHaveCount(2);
  await expect.poll(asked).toHaveLength(1);        // as the page starts
  await page.clock.runFor(29 * 60000);
  expect(await asked()).toHaveLength(1);
  await page.clock.runFor(60000);
  await expect.poll(asked).toHaveLength(2);        // and every half hour after
  await page.clock.runFor(30 * 60000);
  await expect.poll(asked).toHaveLength(3);
  expect(await paintsCalls(page, 'repoPull')).toEqual([]);   // nothing was waiting

  // Turned off, it stops.
  await autoBox(app).uncheck();
  await page.clock.runFor(95 * 60000);
  expect(await asked()).toHaveLength(3);
  expect(errors).toEqual([]);
});

test('with the sim running the remote is not looked at, whoever is looking, until it is not', async ({ page }) => {
  const { errors, app } = await openCars(page, lotusLast(), {
    paints: { ...PAINTS, loadSettings: {}, simStatus: RUNNING, repoStatus: CHECKOUT, repoCheck: UP, repoPull: pulled() },
    timers: true,
  });
  await expect(app.locator('.versions .card')).toHaveCount(2);
  await expect(chipOf(app)).toHaveText('iRacing running');
  await page.clock.runFor(3000);
  // Not as the page starts, though it was asked afresh.
  expect(await paintsCalls(page, 'repoCheck')).toEqual([]);

  // Behind the sim, so that nobody is looking and the chips' own answer goes stale: asked again, itself, at the half hour.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const before = (await paintsCalls(page, 'simStatus')).length;
  await page.clock.runFor(61 * 60000);
  expect((await paintsCalls(page, 'simStatus')).length).toBeGreaterThanOrEqual(before + 2);
  expect(await paintsCalls(page, 'repoCheck')).toEqual([]);
  expect(await paintsCalls(page, 'repoPull')).toEqual([]);
  await expect(app.locator('.toast')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a race that begins while the remote is being looked at is not downloaded into', async ({ page }) => {
  // The sim is not running until the remote has been looked at, and is after: the look goes ahead, and the update
  // does not.
  await stubPaintsBridge(page, {
    ...PAINTS, loadSettings: {}, repoStatus: CHECKOUT, repoPull: pulled(), repoCheck: { __after: 400, answer: UP },
  });
  await stubRig(page);
  await page.addInitScript(() => {
    const invoke = window.racingDesk.paints.invoke;
    window.racingDesk.paints.invoke = async (name, args) => {
      const answer = await invoke(name, args);
      const looked = window.__paints.calls.some((c) => c.name === 'repoCheck');
      return name === 'simStatus' && looked ? { ...answer, simRunning: true } : answer;
    };
  });
  const errors = await openDesk(page, lotusLast(), '&page=cars');
  const app = page.locator(APP);
  await expect.poll(() => paintsCalls(page, 'repoCheck')).toHaveLength(1);
  await page.waitForTimeout(UNASKED_MS);
  expect(await paintsCalls(page, 'repoPull')).toEqual([]);
  await expect(chipOf(app)).toHaveText(['iRacing running', 'Updates waiting']);
  await chipOf(app).nth(1).click();
  await expect(app.locator('.chip-detail')).toContainText('The library takes them by itself when it can, and not while iRacing is running.');
  await saidOnTheChips(app);
  expect(errors).toEqual([]);
});

test('the window coming back after half an hour away is another occasion, and a short time away is not', async ({ page }) => {
  const { errors } = await openCars(page, lotusLast(), {
    paints: { ...PAINTS, loadSettings: {}, repoStatus: CHECKOUT, repoCheck: CURRENT },
    timers: true,
  });
  const asked = () => paintsCalls(page, 'repoCheck');
  await expect.poll(asked).toHaveLength(1);
  const blur = () => page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const focus = () => page.evaluate(() => window.dispatchEvent(new Event('focus')));

  await blur();
  await page.clock.fastForward('20:00');
  await focus();
  await page.waitForTimeout(300);
  expect(await asked()).toHaveLength(1);

  // Away for 31 minutes: the half hour's own look falls due in it, and coming back is one more.
  await blur();
  await page.clock.fastForward('31:00');
  await expect.poll(asked).toHaveLength(2);
  await page.waitForTimeout(300);
  await focus();
  await expect.poll(asked).toHaveLength(3);
  expect(errors).toEqual([]);
});

for (const reason of ['changes', 'work', 'files', 'other']) {
  test(`an update that cannot be taken by itself is said in one plain sentence, and nothing is told to be done: ${reason}`, async ({ page }) => {
    const { errors, app } = await openCars(page, lotusLast(), {
      paints: { ...PAINTS, loadSettings: {}, repoStatus: CHECKOUT, repoCheck: UP, repoPull: refusedFor(reason, { ...UP, dirty: reason === 'changes', ahead: reason === 'work' ? 1 : 0 }) },
    });
    await expect(chipOf(app)).toHaveText('Library not updated');
    await chipOf(app).click();
    await expect(app.locator('.chip-detail')).toHaveText(IN_THE_WAY[reason]);
    await expect(app.locator('.chip-detail').getByRole('button')).toHaveCount(0);
    await expect(app.locator('.toast')).toHaveCount(0);
    await saidOnTheChips(app);
    // The Activity list has it too, once, in the same words.
    await expect(app.locator('.log .entry')).toHaveCount(1);
    await expect(app.locator('.log .entry')).toContainText(IN_THE_WAY[reason]);
    expect(await paintsCalls(page, 'repoPull')).toEqual([{ path: LIBRARY }]);
    expect(errors).toEqual([]);
  });
}

// Turned off, the button is where it is needed: on the chip that says what is in the way, wherever trying again could
// put that right — a file held open at that moment, git not answering — for the only other one is under Library
// source, and he is not sent there. Not where it could not: changes or work of the library's own stay.
for (const [reason, again] of [['changes', false], ['work', false], ['files', true], ['other', true], ['kept', true]]) {
  test(`turned off, what is in the way has an Update now on the chip where trying again could help: ${reason}`, async ({ page }) => {
    const aside = reason === 'kept' ? { count: 1, folder: ASIDE_FOLDER } : null;
    const answer = refusedFor(reason, { ...UP, dirty: reason === 'changes', ahead: reason === 'work' ? 1 : 0 }, aside);
    const { errors, app } = await openCars(page, lotusLast(), {
      paints: {
        ...PAINTS, loadSettings: { autoUpdateLibrary: false }, repoStatus: CHECKOUT, repoCheck: UP,
        repoPull: again ? { __in_turn: [answer, pulled({ changed: 2 })] } : answer,
      },
    });
    await expect(chipOf(app)).toHaveText('Updates waiting');
    await chipOf(app).click();
    await app.locator('.chip-detail').getByRole('button', { name: 'Update now' }).click();
    await expect(chipOf(app)).toHaveText('Library not updated');
    await expect(app.locator('.chip-detail')).toContainText(IN_THE_WAY[reason]);
    await saidOnTheChips(app);
    const button = app.locator('.chip-detail').getByRole('button');
    if (!again) {
      await expect(button).toHaveCount(0);
      expect(await paintsCalls(page, 'repoPull')).toEqual([{ path: LIBRARY }]);
      expect(errors).toEqual([]);
      return;
    }
    await expect(button).toHaveText('Update now');
    await button.click();
    await expect(app.locator('.toast .grow')).toHaveText('Library updated: 2 liveries added or changed.');
    await expect(chipOf(app)).toHaveText('ready');
    expect(await paintsCalls(page, 'repoPull')).toHaveLength(2);
    await saidOnTheChips(app);
    expect(errors).toEqual([]);
  });
}

test('a failure of the update by hand, with it off, keeps the button on the chip too', async ({ page }) => {
  const { errors, app } = await openCars(page, lotusLast(), {
    paints: {
      ...PAINTS, loadSettings: { autoUpdateLibrary: false }, repoStatus: CHECKOUT, repoCheck: UP,
      repoPull: { __in_turn: [{ __error: 'fatal: unable to access the remote: could not resolve host' }, pulled()] },
    },
  });
  await expect(chipOf(app)).toHaveText('Updates waiting');
  await chipOf(app).click();
  await app.locator('.chip-detail').getByRole('button', { name: 'Update now' }).click();
  await expect(chipOf(app)).toHaveText('Library not updated');
  await expect(app.locator('.chip-detail')).toContainText(IN_THE_WAY.other);
  await app.locator('.chip-detail').getByRole('button', { name: 'Update now' }).click();
  await expect(app.locator('.toast .grow')).toHaveText('Library updated: 3 liveries added or changed.');
  await expect(chipOf(app)).toHaveText('ready');
  await saidOnTheChips(app);
  expect(errors).toEqual([]);
});

test('files that were moved aside and could not be put back are named with where, and the chip does not say nothing was changed', async ({ page }) => {
  const { errors, app } = await openCars(page, lotusLast(), {
    paints: {
      ...PAINTS, loadSettings: {}, repoStatus: CHECKOUT, repoCheck: UP,
      repoPull: refusedFor('kept', UP, { count: 1, folder: ASIDE_FOLDER }),
    },
  });
  await expect(chipOf(app)).toHaveText('Library not updated');
  await chipOf(app).click();
  await expect(app.locator('.chip-detail')).toHaveText(IN_THE_WAY.kept);
  await expect(app.locator('.chip-detail')).not.toContainText('Nothing was changed');
  // The toast says how many and where, with a Show, though the update was not taken.
  await expect(app.locator('.toast .grow')).toHaveText(`1 file that was in the way was set aside in ${ASIDE_FOLDER}. Nothing was deleted.`);
  await app.locator('.toast').getByRole('button', { name: 'Show' }).click();
  await expect.poll(() => page.evaluate(() => window.__paints.revealed)).toEqual([ASIDE_FOLDER]);
  await saidOnTheChips(app);
  await expect(app.locator('.log .entry')).toContainText(IN_THE_WAY.kept);
  expect(errors).toEqual([]);
});

test('a remote that cannot be reached is not said anywhere on the page, nothing is pulled, and the next occasion tries again', async ({ page }) => {
  const { errors, app } = await openCars(page, lotusLast(), {
    paints: { ...PAINTS, loadSettings: {}, repoStatus: CHECKOUT, repoCheck: { __in_turn: [UNREACHABLE, UNREACHABLE, UP] }, repoPull: pulled() },
    timers: true,
  });
  const asked = () => paintsCalls(page, 'repoCheck');
  await expect.poll(asked).toHaveLength(1);   // as the page starts
  await page.clock.runFor(3000);
  const quiet = async () => {
    // Not under Library source, where the desk's note would be printed in the warning colour; nor on a chip, a toast,
    // or the Activity list; and what an earlier fetch left counting as waiting is not taken without the remote's word.
    await expect(sourcePanel(app)).toBeVisible();
    await expect(sourcePanel(app)).not.toContainText('Could not reach');
    await expect(chipOf(app)).toHaveText('ready');
    await expect(app.locator('.toast')).toHaveCount(0);
    await expect(app.locator('.log .entry')).toHaveCount(0);
    expect(await paintsCalls(page, 'repoPull')).toEqual([]);
    await saidOnTheChips(app);
  };
  await quiet();
  await page.clock.runFor(30 * 60000);
  await expect.poll(asked).toHaveLength(2);   // every half hour, and again it could not be reached
  await page.clock.runFor(3000);
  await quiet();

  // The third time it answers, and what is waiting is taken.
  await page.clock.runFor(30 * 60000);
  await expect.poll(asked).toHaveLength(3);
  await expect(app.locator('.toast .grow')).toHaveText('Library updated: 3 liveries added or changed.');
  expect(await paintsCalls(page, 'repoPull')).toEqual([{ path: LIBRARY }]);
  expect(errors).toEqual([]);
});

test('with it off the look as the page starts is as quiet, and a Check he pressed says the remote could not be reached', async ({ page }) => {
  const { errors, app } = await openCars(page, lotusLast(), {
    paints: { ...PAINTS, loadSettings: { autoUpdateLibrary: false }, repoStatus: CHECKOUT, repoCheck: UNREACHABLE },
  });
  await expect.poll(() => paintsCalls(page, 'repoCheck')).toHaveLength(1);
  await page.waitForTimeout(UNASKED_MS);
  await expect(sourcePanel(app)).not.toContainText('Could not reach');
  await expect(chipOf(app)).toHaveText('ready');
  await expect(app.locator('.log .entry')).toHaveCount(0);

  // He asked: then it is said, where the answer's notes are.
  await sourcePanel(app).getByRole('button', { name: 'Check' }).click();
  await expect(sourcePanel(app)).toContainText('Could not reach the remote to check for updates.');
  expect(await paintsCalls(page, 'repoPull')).toEqual([]);
  expect(errors).toEqual([]);
});

test('a library that is a plain folder is told so, with nothing to do and nowhere else to go', async ({ page }) => {
  const { errors, app } = await openCars(page, lotusLast());
  await expect(sourcePanel(app)).toHaveText('Library sourceThis library is a plain folder, so it cannot bring in new liveries by itself.');
  await expect(sourcePanel(app)).not.toContainText(/choose|above|below|online/i);
  expect(errors).toEqual([]);
});

test('a refusal goes when the library is up to date again, and is not said again each time it is found', async ({ page }) => {
  const { errors, app } = await openCars(page, lotusLast(), {
    paints: {
      ...PAINTS, loadSettings: {}, repoStatus: CHECKOUT,
      repoCheck: { __in_turn: [UP, UP, CURRENT] }, repoPull: refusedFor('changes'),
    },
    timers: true,
  });
  await expect(chipOf(app)).toHaveText('Library not updated');
  await page.clock.runFor(30 * 60000);
  await expect.poll(() => paintsCalls(page, 'repoPull')).toHaveLength(2);
  await expect(chipOf(app)).toHaveText('Library not updated');
  await expect(app.locator('.log .entry')).toHaveCount(1);   // the same thing, said the once
  // He put it right: the next look finds nothing waiting.
  await page.clock.runFor(30 * 60000);
  await expect(chipOf(app)).toHaveText('ready');
  expect(await paintsCalls(page, 'repoPull')).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('an update that fails of itself says nothing; by hand it says so plainly, and never in git\'s words', async ({ page }) => {
  const git = 'fatal: unable to access the remote: could not resolve host\nhint: use git pull --rebase to put it right';
  const { errors, app } = await openCars(page, lotusLast(), {
    paints: { ...PAINTS, loadSettings: {}, repoStatus: CHECKOUT, repoCheck: UP, repoPull: { __error: git } },
  });
  // It tried, and could not; nobody is told, and there is still something waiting.
  await expect.poll(() => paintsCalls(page, 'repoPull')).toHaveLength(1);
  await expect(chipOf(app)).toHaveText('Updates waiting');
  await expect(app.locator('.toast')).toHaveCount(0);
  await expect(app.locator('.log .entry')).toHaveCount(0);

  await chipOf(app).click();
  await app.locator('.chip-detail').getByRole('button', { name: 'Update now' }).click();
  await expect(chipOf(app)).toHaveText('Library not updated');
  await expect(app.locator('.chip-detail')).toHaveText(IN_THE_WAY.other);   // the detail stayed open through it
  await saidOnTheChips(app);
  // What went wrong is in the Activity list, without the line that tells him what to type.
  const entry = app.locator('.log .entry');
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText('Could not update the library');
  await expect(entry).toContainText('unable to access the remote');
  await expect(entry).not.toContainText('hint');
  await expect(entry).not.toContainText('rebase');
  expect(errors).toEqual([]);
});

test('files that were in the way are said with how many and where, can be shown, and the toast goes a while after somebody looks', async ({ page }) => {
  const folder = 'C:\\Users\\Owner\\AppData\\Local\\Racing Desk\\library-set-aside\\2026-09-29_101530';
  const { errors, app } = await openCars(page, lotusLast(), {
    paints: {
      ...PAINTS, loadSettings: {}, repoStatus: CHECKOUT, repoCheck: UP,
      repoPull: { __after: 3000, answer: pulled({ changed: 2, setAside: { count: 12, folder } }) },
    },
    timers: true,
  });
  await page.clock.runFor(1500);   // the page starts, and the update is under way
  await expect(chipOf(app)).toHaveText('Updating library…');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));   // and he is driving
  await page.clock.runFor(4000);
  const toast = app.locator('.toast .grow');
  await expect(toast).toHaveText(`Library updated: 2 liveries added or changed. 12 files that were in the way were set aside in ${folder}. Nothing was deleted.`);
  await saidOnTheChips(app);

  // Nobody was there: it is there when somebody is, and then for a while.
  await page.clock.runFor(60000);
  await expect(toast).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.clock.runFor(8000);
  await expect(toast).toBeVisible();
  await app.locator('.toast').getByRole('button', { name: 'Show' }).click();
  await expect.poll(() => page.evaluate(() => window.__paints.revealed)).toEqual([folder]);
  await page.clock.runFor(6000);
  await expect(app.locator('.toast')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('one set-aside file is said in the singular', async ({ page }) => {
  const folder = 'C:\\Users\\Owner\\AppData\\Local\\Racing Desk\\library-set-aside\\2026-09-29_101530';
  const { errors, app } = await openCars(page, lotusLast(), {
    paints: { ...PAINTS, loadSettings: {}, repoStatus: CHECKOUT, repoCheck: UP, repoPull: pulled({ changed: 0, setAside: { count: 1, folder } }) },
  });
  await expect(app.locator('.toast .grow')).toHaveText(`Library updated. 1 file that was in the way was set aside in ${folder}. Nothing was deleted.`);
  expect(errors).toEqual([]);
});

// ── Cars: a car that is no longer on the rig ─────────────────
// The store has sessions for it, a view and pedals; the install, the paint folder and the library have nothing.
// The catalogue lists it as not installed (modules/js/paints/catalogue.js).
const GONE = car('porsche992cup', null, [], 'Porsche 911 GT3 Cup (992)', '911 Cup', false, 12);
const GONE_RIG = {
  cars: held([...RIG_CARS, { car_path: 'porsche992cup', name: 'Porsche 911 GT3 Cup (992)', short_name: '911 Cup', car_id: 143, driven: 12, seen: 40 }]),
  views: held([...RIG_VIEWS, {
    car_path: 'porsche992cup', name: 'Porsche 911 GT3 Cup (992)', driver_height: 0.02, vanish_y: 0.01, head_horizon: 0.5, fov: 69.0,
    seat_x: 0.04, seat_y: 0.0, seat_z: -0.01, chosen: 1, chosen_at: '2026-08-02T20:00:00.000Z', seen_at: '2026-08-02T20:00:00.000Z',
  }]),
  pedals: held({ ...RIG_PEDALS, cars: [...RIG_PEDALS.cars, bound('porsche992cup', 'Porsche 911 GT3 Cup (992)', '283f91ae', 'Default', 'same', 58)] }),
};

test('a car he has driven that is no longer on the rig has its view and pedals, and nothing that needs it on disk', async ({ page }) => {
  const { errors, app } = await openCars(page, `http://127.0.0.1:${host.address().port}`, {
    paints: { ...PAINTS, carCatalogue: [...CATALOGUE, GONE] }, rig: GONE_RIG, binds: [{ ok: true, car: bound('porsche992cup', 'Porsche 911 GT3 Cup (992)', '9c1d44e0', 'GT3 <stiff>', 'same', 58) }],
  });
  // In the list with the rest, and among the cars he has driven; its row says what it is and what is kept.
  const row = carRow(app, 'Porsche 911 GT3 Cup (992)');
  await expect(app.locator('.sidebar .group .heading')).toHaveText(['Liveries 3', 'No livery yet 5']);
  await expect(row.locator('.meta')).toHaveText('not installed');
  await expect(row.locator('.mark')).toHaveText(['view', 'pedals']);
  await app.getByRole('button', { name: 'Driven', exact: true }).click();
  await expect(row.locator('.meta')).toHaveText('driven in 12 sessions · not installed');
  await app.getByRole('button', { name: 'Driven', exact: true }).click();

  await lookAt(app, 'Porsche 911 GT3 Cup (992)');
  await expect(app.locator('.car-head .note')).toHaveText('porsche992cup · driven in 12 sessions · not installed');
  await expect(app.locator('.car-view dd')).toHaveText(['—', '+20 mm', '+0.01', '0.5', '69°', '+40 mm', '0 mm', '−10 mm', 'its own']);
  await expect(app.locator('.car-pedals select')).toHaveValue('283f91ae');
  await expect(app.locator('.car-pedals .brake')).toHaveText('brake max 80 kg · bottom deadzone 5% · linear curve · brake force 58 kg in this car');

  // Said plainly, and nothing offered that needs the car on disk: nowhere for a livery to go, nothing installed
  // to read, no backup to put back, nothing to apply.
  await expect(app.locator('.main .panel h3')).toHaveText(['View', 'Pedals', 'Not installed', 'Trading Paints', 'Library source']);
  await expect(app.locator('.panel.not-on-disk')).toContainText('This car is not on the rig now');
  await expect(app.locator('.panel.not-on-disk')).toContainText('Its view and its pedals are kept from when you drove it.');
  await expect(app.locator('.panel.no-livery')).toHaveCount(0);
  await expect(app.locator('.main code')).toHaveCount(0);
  await expect(app.getByRole('button', { name: /apply|revert|restore|explorer/i })).toHaveCount(0);
  await expect(app.locator('.chips .chip')).toHaveText('ready');
  await page.waitForTimeout(150);
  expect((await paintsCalls(page, 'carState')).filter((c) => c.carFolder === 'porsche992cup')).toEqual([]);
  expect((await paintsCalls(page, 'listBackups')).filter((c) => c.carFolder === 'porsche992cup')).toEqual([]);

  // Its pedals are the store's, which has the car: a profile can still be chosen for it.
  await app.locator('.car-pedals select').selectOption({ label: 'GT3 <stiff>' });
  await expect(app.locator('.car-pedals .pedal-note.saved')).toHaveText('saved');
  expect(await bindCalls(page)).toEqual([['porsche992cup', '9c1d44e0']]);

  // A car that is on the rig is as it was.
  await lookAt(app, 'oldcar');
  await expect(app.locator('.main .panel h3')).toHaveText(['View', 'Pedals', 'No livery yet', 'Installed in the sim', 'Backups', 'Trading Paints', 'Library source']);
  expect(errors).toEqual([]);
});

// ── Cars: the store has something new ────────────────────────
// The desk asks the host how the store stands every half minute (desk.js, pollStatus). Another session in it is
// something new: the desk reads its sessions again, hands the island the dates, and says there is something to
// read — the list of cars, and what the host keeps for them.
test('the Cars page reads again when the store has something new, and is on the car just driven', async ({ page }) => {
  const history = buildHistory();
  const own = await startMockHost(history);
  try {
    const { errors, app } = await openCars(page, `http://127.0.0.1:${own.address().port}`, { timers: true });
    await expect(app.locator('.car-head h2')).toHaveText('McLaren 570S GT4');
    await expect.poll(() => rigReads(page)).toBe(1);
    expect(await paintsCalls(page, 'carCatalogue')).toHaveLength(1);

    // Nothing new, nothing read.
    await page.clock.runFor(31000);
    await expect.poll(() => askedFor(own, 'status')).toBeGreaterThanOrEqual(2);
    expect(await rigReads(page)).toBe(1);
    expect(await paintsCalls(page, 'carCatalogue')).toHaveLength(1);
    expect(askedFor(own, 'sessions')).toBe(1);

    // He drives the Lotus, and comes back to the desk.
    driveAfter(history, LOTUS, '2026-09-17T01:20:00.000Z');
    await page.clock.runFor(30000);
    await expect.poll(() => askedFor(own, 'sessions')).toBe(2);
    await expect.poll(() => rigReads(page)).toBe(2);
    await expect.poll(() => paintsCalls(page, 'carCatalogue')).toHaveLength(2);
    await expect(app.locator('.car-head h2')).toHaveText('Lotus 79');
    await expect(app.locator('.car-view dd').first()).toHaveText(/^1\d min ago$/);
    expect(NOT_THE_PAGES.map((route) => askedFor(own, route))).toEqual(NOT_THE_PAGES.map(() => 0));
    expect(errors).toEqual([]);
  } finally {
    await new Promise((resolve) => { own.closeAllConnections(); own.close(resolve); });
  }
});

test('with the desk behind the sim nothing is read, however much is new, until somebody looks', async ({ page }) => {
  // He drives with the desk left on Cars. The store has something new at the first lap, and again with each
  // session: reading the list of cars for it is work done in the process the HUD answers to, for nobody.
  const history = buildHistory();
  const own = await startMockHost(history);
  try {
    const { errors, app } = await openCars(page, `http://127.0.0.1:${own.address().port}`, { timers: true });
    await expect(app.locator('.car-head h2')).toHaveText('McLaren 570S GT4');
    await expect.poll(() => rigReads(page)).toBe(1);

    await page.evaluate(() => window.dispatchEvent(new Event('blur')));   // the sim has the focus
    driveAfter(history, LOTUS, '2026-09-17T01:20:00.000Z');
    await page.clock.runFor(31000);
    await expect.poll(() => askedFor(own, 'sessions')).toBe(2);           // the desk's own page is kept up
    await page.clock.runFor(31000);
    expect(await rigReads(page)).toBe(1);
    expect(await paintsCalls(page, 'carCatalogue')).toHaveLength(1);
    await expect(app.locator('.car-head h2')).toHaveText('McLaren 570S GT4');

    // He is back: what was owed is read, once, and the page is on the car he drove.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(app.locator('.car-head h2')).toHaveText('Lotus 79');
    await expect.poll(() => paintsCalls(page, 'carCatalogue')).toHaveLength(2);
    await expect.poll(() => rigReads(page)).toBe(2);
    expect(errors).toEqual([]);
  } finally {
    await new Promise((resolve) => { own.closeAllConnections(); own.close(resolve); });
  }
});

test('coming back to the desk reads the car\'s view and pedals again, and once more when the view has been written', async ({ page }) => {
  // The host keeps a car's pedals when the run ends and its view once the sim has gone — neither of which is
  // news to the desk, whose count of sessions changed at the first lap.
  const { errors, app } = await openCars(page, `http://127.0.0.1:${host.address().port}`, { timers: true });
  await expect(app.locator('.car-head h2')).toHaveText('McLaren 570S GT4');
  await expect.poll(() => rigReads(page)).toBe(1);

  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => rigReads(page)).toBe(2);
  await page.clock.runFor(111000);
  await expect.poll(() => rigReads(page)).toBe(3);
  await page.clock.runFor(240000);
  expect(await rigReads(page)).toBe(3);                                 // and that is all
  expect(await paintsCalls(page, 'carCatalogue')).toHaveLength(1);      // the list of cars is not what changed

  // Not with another page up.
  await page.locator('.nav a[data-page-link="desk"]').click();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.clock.runFor(1000);
  expect(await rigReads(page)).toBe(3);
  expect(errors).toEqual([]);
});

test('a car he chose stays until he drives again: he comes back from a drive to the car he drove', async ({ page }) => {
  await stubPaintsBridge(page, PAINTS);
  await stubGroups(page, [SHATTER]);
  await stubRig(page);
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=cars');
  const app = page.locator(APP);
  const name = app.locator('.car-head h2');
  await lookAt(app, 'Caterham Seven 420R');
  await expect(name).toHaveText('Caterham Seven 420R');

  // Dates of drives before he chose it, arriving late, do not move the page.
  await drove(page, { lotus79: '2026-09-17T01:15:00Z', mclaren570sgt4: '2026-09-15T23:00:00Z' });
  await expect(name).toHaveText('Caterham Seven 420R');

  // A drive since does.
  const since = await page.evaluate(() => new Date(Date.now() + 5 * 60000).toISOString());
  await drove(page, { lotus79: since, mclaren570sgt4: '2026-09-15T23:00:00Z' });
  await expect(name).toHaveText('Lotus 79');

  // Not under a group he is looking at: the page follows when he leaves it.
  await app.locator('.sidebar .groups .car', { hasText: 'shatter' }).click();
  await expect(app.locator('.group-head h2')).toHaveText('shatter');
  const later = await page.evaluate(() => new Date(Date.now() + 10 * 60000).toISOString());
  await drove(page, { 'mx5 mx52016': later });
  await page.waitForTimeout(300);
  await expect(app.locator('.group-head h2')).toHaveText('shatter');
  expect(errors).toEqual([]);
});

test('with no library to be found the cars are listed all the same, with their views and pedals', async ({ page }) => {
  const plain = CATALOGUE.filter((c) => c.versions.length === 0).concat(car('mx5 mx52016', 'mx5 mx52016', [], 'Mazda MX-5 Cup', 'MX-5 Cup', true, 668));
  const { errors, app } = await openCars(page, `http://127.0.0.1:${host.address().port}`, {
    paints: { ...PAINTS, suggestLibraries: [], carCatalogue: plain },
  });
  await expect(app.locator('.setup input').nth(1)).toHaveValue('');
  await expect(app.locator('.sidebar .group .heading')).toHaveText(['No livery yet 5']);
  // Asked once, when a library had been looked for and none found: not at every step on the way there.
  expect(await paintsCalls(page, 'carCatalogue')).toEqual([{ libraryRoot: '', paintDir: PAINT_DIR }]);

  await lookAt(app, 'McLaren 570S GT4');
  await expect(app.locator('.panel.no-livery')).toContainText('There is no library to keep liveries in. Pick its folder above.');
  await expect(app.locator('.car-view dd').nth(1)).toHaveText('−60 mm');
  await expect(app.locator('.car-pedals select')).toHaveValue('9c1d44e0');
  await expect(app.getByRole('button', { name: /apply/i })).toHaveCount(0);
  expect(await paintsCalls(page, 'carState')).toEqual([]);   // nothing to match what is installed against
  expect(errors).toEqual([]);
});

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
  const errors = await openDesk(page, lotusLast(), '&page=cars');
  const app = page.locator(APP);

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
  const errors = await openDesk(page, lotusLast(), '&page=cars');
  const app = page.locator(APP);
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

test('setting a group says which helmet each car got, and which the library\'s default is', async ({ page }) => {
  const said = 'The shatter helmet is now the default for every car without a helmet of its own.';
  const report = {
    ...SET_REPORT,
    results: [
      { ...SET_REPORT.results[0], helmet: { set: 'shatter-inverted', onCar: true, defaultSet: null, defaultPut: false, said: 'The shatter-inverted helmet is on the car.' } },
      { ...SET_REPORT.results[1], helmet: null },
    ],
    helmet: { set: 'shatter', put: true, said, backupDir: 'C:\\backups\\.default-helmet\\2026-09-28_120000_000' },
  };
  await stubPaintsBridge(page, { ...PAINTS, setGroup: report });
  await stubGroups(page, [SHATTER]);
  const errors = await openDesk(page, lotusLast(), '&page=cars');
  const app = page.locator(APP);
  await app.locator('.sidebar .groups .car', { hasText: 'shatter' }).click();
  await app.locator('.group-actions button.primary').click();

  const panel = app.locator('.panel', { hasText: 'Cars in this group' });
  await expect(panel.locator('tbody tr .outcome')).toHaveText([
    'applied — with the shatter-inverted helmet', 'skipped — The car has no folder in the paint directory and is not in the iRacing install.',
  ]);
  await expect(panel.locator('.helmet-said')).toHaveText(said);
  await expect(app.locator('.log .entry.ok')).toContainText(said);
  expect(errors).toEqual([]);
});

test('setting a group says, beside a car whose helmet was left as it was, why — in the sentence an apply gives', async ({ page }) => {
  const left = 'No helmet comes with this version, so the helmet on the car was left as it was.';
  const report = {
    ...SET_REPORT,
    results: [
      { ...SET_REPORT.results[0], helmet: { set: null, onCar: false, defaultSet: null, defaultPut: false, said: left } },
      SET_REPORT.results[1],
    ],
    helmet: { set: 'shatter', put: false, said: 'The shatter helmet is the default for every car without a helmet of its own, as before.', backupDir: null },
  };
  await stubPaintsBridge(page, { ...PAINTS, setGroup: report });
  await stubGroups(page, [SHATTER]);
  const errors = await openDesk(page, lotusLast(), '&page=cars');
  const app = page.locator(APP);
  await app.locator('.sidebar .groups .car', { hasText: 'shatter' }).click();
  await app.locator('.group-actions button.primary').click();

  const panel = app.locator('.panel', { hasText: 'Cars in this group' });
  await expect(panel.locator('tbody tr .outcome')).toHaveText([
    `applied — ${left}`, 'skipped — The car has no folder in the paint directory and is not in the iRacing install.',
  ]);
  await expect(panel.locator('tbody tr .outcome .helmet-left')).toHaveCount(1);
  // A car whose helmet went on says which; one whose helmet was left alone does not say it came with one.
  expect((await panel.locator('tbody tr .outcome').allInnerTexts()).join(' ')).not.toMatch(/with the .* helmet/);
  expect(errors).toEqual([]);
});

test('after a library update that changed the default helmet the default follows, and what came of it is said with the update', async ({ page }) => {
  const said = 'The shatter-inverted helmet is now the default for every car without a helmet of its own. The default helmet that was there is kept, and can be put back.';
  const { errors, app } = await openCars(page, lotusLast(), {
    paints: {
      ...PAINTS, loadSettings: {}, repoStatus: CHECKOUT, repoCheck: UP,
      repoPull: pulled({ helmetDefault: { was: 'shatter', now: 'shatter-inverted', changed: true } }),
      ensureDefaultHelmet: { set: 'shatter-inverted', put: true, said, backupDir: 'C:\\backups\\.default-helmet\\2026-09-30_120000_000', warnings: [] },
    },
  });
  await expect(app.locator('.toast .grow')).toHaveText('Library updated: 3 liveries added or changed.');
  await expect(app.locator('.log .entry.ok', { hasText: 'The library was updated' })).toContainText(said);
  // Asked with what the page knows — the paint folder, the library, the customer id and the default it was — and
  // nothing of its own.
  expect(await paintsCalls(page, 'ensureDefaultHelmet')).toEqual([{ paintDir: PAINT_DIR, libraryRoot: LIBRARY, customerId: CUSTOMER, was: 'shatter' }]);
  await saidOnTheChips(app);
  expect(errors).toEqual([]);
});

test('an update that leaves the default helmet as it was does nothing about it', async ({ page }) => {
  // The update brought liveries and the list's default is the same: the page never asks.
  const same = await openCars(page, lotusLast(), {
    paints: {
      ...PAINTS, loadSettings: {}, repoStatus: CHECKOUT, repoCheck: UP,
      repoPull: pulled({ helmetDefault: { was: 'shatter', now: 'shatter', changed: false } }),
      ensureDefaultHelmet: { set: 'shatter', put: true, said: 'must not be asked', backupDir: null, warnings: [] },
    },
  });
  await expect(same.app.locator('.toast .grow')).toHaveText('Library updated: 3 liveries added or changed.');
  await expect(same.app.locator('.log .entry.ok', { hasText: 'The library was updated' })).not.toContainText('must not be asked');
  expect(await paintsCalls(page, 'ensureDefaultHelmet')).toEqual([]);
  expect(same.errors).toEqual([]);
});

test('with the sim in the way an update says what changed and what is in the way, and gives no instruction', async ({ page }) => {
  const said = "The library's default helmet is now the shatter-inverted helmet; the next apply puts it in place, since iRacing is running right now.";
  const { errors, app } = await openCars(page, lotusLast(), {
    paints: {
      ...PAINTS, loadSettings: {}, repoStatus: CHECKOUT, repoCheck: UP,
      repoPull: pulled({ helmetDefault: { was: 'shatter', now: 'shatter-inverted', changed: true } }),
      ensureDefaultHelmet: { set: 'shatter-inverted', put: false, said, backupDir: null, warnings: [] },
    },
  });
  const line = app.locator('.log .entry.ok', { hasText: 'The library was updated' });
  await expect(line).toContainText(said);
  await expect(line).not.toContainText('Close the sim');
  expect(await paintsCalls(page, 'ensureDefaultHelmet')).toHaveLength(1);
  expect(errors).toEqual([]);
});

// Every backup of the default helmet can be put back from the page: the ones a car's revert names, and the ones no
// car's backup names (a group that set no car, a library update).
const DEFAULT_BACKUPS = [
  { id: '2026-09-30_120000_000', path: 'C:\\backups\\.default-helmet\\2026-09-30_120000_000', created: '2026-09-30T12:00:00.000+10:00', reason: 'library update', had: true },
  { id: '2026-09-29_090000_000', path: 'C:\\backups\\.default-helmet\\2026-09-29_090000_000', created: '2026-09-29T09:00:00.000+10:00', reason: 'set shatter', had: false },
];

test('the default helmet\'s backups are on the page and each can be put back, and what came of it is said', async ({ page }) => {
  const back = 'The default helmet is back as it was. The library\'s default, the shatter helmet, goes in again at the next apply.';
  const { errors, app } = await openCars(page, lotusLast(), {
    paints: {
      ...PAINTS,
      listDefaultHelmetBackups: DEFAULT_BACKUPS,
      revertDefaultHelmet: {
        __by: 'backupId',
        answers: {
          [DEFAULT_BACKUPS[0].id]: { restored: 'restored', said: back, backupDir: 'C:\\backups\\.default-helmet\\2026-09-30_130000_000', warnings: [] },
          '*': { __error: SIM_RUNNING },
        },
      },
    },
  });
  const panel = app.locator('.panel.default-helmet');
  await expect(panel.locator('h3')).toHaveText('Default helmet');
  await expect(panel.locator('.row-line')).toHaveCount(2);
  await expect(panel.locator('.row-line').nth(0)).toContainText('2026-09-30_120000_000');
  await expect(panel.locator('.row-line').nth(0)).toContainText('library update; a helmet was there');
  await expect(panel.locator('.row-line').nth(1)).toContainText('set shatter; no helmet was there');
  await expect(panel.getByRole('button', { name: 'Put back' })).toHaveCount(2);
  // Asked for by the customer's id alone: the paint folder and the library are the page's to send with the put back.
  expect(await paintsCalls(page, 'listDefaultHelmetBackups')).toContainEqual({ customerId: CUSTOMER });

  await panel.locator('.row-line').nth(0).getByRole('button', { name: 'Put back' }).click();
  await expect(panel.locator('.helmet-said')).toHaveText(back);
  await expect(app.locator('.log .entry.ok', { hasText: 'Put the default helmet back' })).toContainText(back);
  expect(await paintsCalls(page, 'revertDefaultHelmet')).toEqual([{ paintDir: PAINT_DIR, libraryRoot: LIBRARY, customerId: CUSTOMER, backupId: DEFAULT_BACKUPS[0].id }]);
  // The list is read again after it, as after anything that may have taken a backup.
  await expect.poll(async () => (await paintsCalls(page, 'listDefaultHelmetBackups')).length).toBeGreaterThanOrEqual(2);

  // With the sim running the host refuses, and that is said, as it is for a car.
  await panel.locator('.row-line').nth(1).getByRole('button', { name: 'Put back' }).click();
  await expect(app.locator('.log .entry.bad', { hasText: 'Did not put the default helmet back' })).toContainText(SIM_RUNNING);
  expect(errors).toEqual([]);
});

test('with no backup of the default helmet there is no panel for it', async ({ page }) => {
  const { errors, app } = await openCars(page, lotusLast());
  await expect(app.locator('.car-head h2')).toHaveText('Lotus 79');
  await expect(app.locator('.panel.default-helmet')).toHaveCount(0);
  expect(await paintsCalls(page, 'listDefaultHelmetBackups')).toContainEqual({ customerId: CUSTOMER });
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
  const errors = await openDesk(page, lotusLast(), '&page=cars');
  const app = page.locator(APP);
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
  const errors = await openDesk(page, lotusLast(), '&page=cars');
  const app = page.locator(APP);

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
  const errors = await openDesk(page, lotusLast(), '&page=cars');
  const app = page.locator(APP);
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

// The same bundle outside the desk, as the Tauri shell runs the same source: no window.racingDesk, the Rust
// commands under their snake_case names — and no car_catalogue among them.
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
  // What the desk's host keeps per car is the desk's to ask for. Here the two panels say so; nothing fails, and
  // nothing is asked of the Rust, which never had any of it.
  await expect(app.locator('.car-view .note')).toHaveText(NO_APP.view);
  await expect(app.locator('.car-pedals .note')).toHaveText(NO_APP.pedals);
  await expect(app.locator('.car-pedals select')).toHaveCount(0);
  await expect(app.locator('.sidebar .mark')).toHaveCount(0);
  const asked = await page.evaluate(() => window.__rust.map((c) => c.cmd));
  expect(asked.filter((c) => c === 'car_catalogue')).toHaveLength(1);
  expect(asked.filter((c) => c !== 'car_catalogue' && !Object.hasOwn(rust, c))).toEqual([]);
  expect(await page.evaluate(() => window.__rust.filter((c) => c.cmd === 'scan_library').map((c) => c.args)))
    .toEqual([{ libraryRoot: LIBRARY, paintDir: PAINT_DIR }]);
  expect(errors).toEqual([]);
});

test('without the app the Cars page says so instead of mounting the manager', async ({ page }) => {
  const own = await startMockHost(buildHistory());
  try {
    const errors = await openDesk(page, `http://127.0.0.1:${own.address().port}`, '&page=cars');
    await expect(page.locator('#cars-note')).toBeVisible();
    await expect(page.locator('#cars-note')).toContainText('need the Racing Desk app');
    await expect(page.locator('#cars-unbuilt')).toBeHidden();
    expect(await page.locator('.paints-app').count()).toBe(0);
    await expect(page.locator('.race-row')).toHaveCount(30);   // the desk page loaded behind it all the same
    // A browser has no app to ask through, and the page does not ask the host itself instead.
    expect(NOT_THE_PAGES.map((route) => askedFor(own, route))).toEqual(NOT_THE_PAGES.map(() => 0));
    expect(errors).toEqual([]);
  } finally {
    await new Promise((resolve) => own.close(resolve));
  }
});

// ── Settings: Recording (OBS) ────────────────────────────────
// main.js keeps the recording (modules/js/obs) and answers the desk over window.racingDesk.recording. Here a stand-in
// keeps a status in the page, records every command, and pushes a new status the way the app does on a change.

const OBS_READY = {
  obs: 'open', obsVersion: '32.1.2', recording: false, starting: false, stopping: false, paused: false, owned: false, outputPath: null,
  startedAt: null, elapsedMs: 0, bytes: 0, bytesPerSecond: 12.5e6, free: { bytes: 400e9, hoursLeft: 8.9, drive: 'D:' },
  lowDisk: null, last: null, busy: null, sidecar: null,
  auto: false, autoRecord: true, chapters: 0, filed: null, lastFiled: null, replay: { on: false, running: false, unavailable: null, lastSaved: null },
  folder: 'D:\\Racing Desk\\Recordings',
  setup: { wsState: 'ok', wsEnabled: true, wsPort: 4455, profile: 'Untitled', hybrid: true, replayBuffer: true, folderSet: true, folderExists: true, obsFound: true, needed: false },
  needsPassword: false, passwordTyped: false, obsStartOnRecord: true, obsStartWithApp: false, obsPath: null,
  recordingAutoRecord: true, recordingInstantReplay: false, recordingChapters: true,
};
const OBS_CLOSED_FRESH = {
  ...OBS_READY, obs: 'closed', free: null,
  setup: { ...OBS_READY.setup, wsEnabled: false, hybrid: false, replayBuffer: false, folderSet: false, folderExists: false, needed: true },
};

// `answers` maps a command to what the stand-in answers; a command that is not there answers { ok: true } and, for
// toggle, flips the recording as the app would and pushes the new status.
async function stubRecording(page, status, answers = {}) {
  await page.addInitScript(({ initial, planned }) => {
    const state = { status: initial };
    window.__recording = { commands: [], push: null, state };
    // The app reads the two switches from the settings file each time it is asked; so does the stand-in.
    const withSwitches = () => {
      const saved = window.__k10 && window.__k10.settings ? window.__k10.settings : {};
      const out = JSON.parse(JSON.stringify(state.status));
      for (const key of ['obsStartOnRecord', 'obsStartWithApp', 'recordingAutoRecord', 'recordingInstantReplay', 'recordingChapters', 'obsHudSource', 'tvShotsHideFacecam']) if (typeof saved[key] === 'boolean') out[key] = saved[key];
      // And the choice of what OBS draws and the panel background for it, as main.js reads them.
      out.obsHudView = saved.obsHudView === 'ipad' ? 'ipad' : 'rig';
      if (typeof saved.obsPanelBackground === 'number') out.obsPanelBackground = saved.obsPanelBackground;
      return out;
    };
    Object.assign(window.racingDesk, {
      recording: {
        status: async () => withSwitches(),
        command: async (name, value) => {
          window.__recording.commands.push([name, value]);
          if (planned[name]) return planned[name];
          if (name === 'toggle') {
            const now = !state.status.recording;
            state.status = { ...state.status, recording: now, owned: now, startedAt: now ? Date.now() - 61_000 : null, elapsedMs: now ? 61_000 : 0, outputPath: now ? 'D:/Racing Desk/Recordings/2026-09-30 21-00-00.mp4' : null, bytes: now ? 3.1e9 : 0, sidecar: now ? { path: 'x', frames: 1830 } : null };
            if (window.__recording.push) window.__recording.push(JSON.parse(JSON.stringify(state.status)));
            return { ok: true };
          }
          return { ok: true };
        },
        onState: (callback) => { window.__recording.push = callback; },
      },
    });
  }, { initial: status, planned: answers });
}

// The presses. The race detail's asking which recording is the race's (recordingFor) is a read the page makes for
// itself whenever a race is shown, not a press: it is looked at by its own test.
const recordingCommands = (page) => page.evaluate(() => window.__recording.commands.filter((c) => c[0] !== 'recordingFor'));
const recordingAsks = (page) => page.evaluate(() => window.__recording.commands.filter((c) => c[0] === 'recordingFor'));
const pushRecording = (page, status) => page.evaluate((s) => { window.__recording.state.status = s; window.__recording.push(s); }, status);

test('the recording pill is on the masthead of every page; outside the app it is there and says it is the app\'s to switch', async ({ page }) => {
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=desk');
  const pill = page.locator('#recording-pill');
  await expect(pill).toBeVisible();
  await expect(pill.locator('.recording-text')).toHaveText('Recording');
  await expect(pill.locator('.recording-button')).toHaveText('Record');
  await expect(pill.locator('.recording-button')).toBeDisabled();
  await expect(pill).toHaveAttribute('title', 'This is switched from the Racing Desk app.');
  await page.locator('a[data-page-link="cars"]').click();
  await expect(pill).toBeVisible();
  await page.locator('a[data-page-link="settings"]').click();
  await expect(pill).toBeVisible();
  // The card, read-only.
  const card = page.locator('#settings-recording');
  await expect(card.locator('h2')).toHaveText('Recording');
  await expect(card.locator('#recording-line')).toHaveText('This is switched from the Racing Desk app.');
  await expect(card.locator('button[data-recording-cmd="toggle"]')).toBeDisabled();
  await expect(card.locator('[data-recording-key]:not(:disabled)')).toHaveCount(0);
  await expect(card.locator('#recording-folder')).toHaveValue('');
  expect(errors).toEqual([]);
});

test('with OBS open the pill says so and Record is one press; recording, it counts and offers Stop; the card follows', async ({ page }) => {
  await stubBridge(page, { zoom: 120 });
  await stubRecording(page, OBS_READY);
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=settings');
  const pill = page.locator('#recording-pill');
  await expect(pill.locator('.recording-text')).toHaveText('OBS is open, not recording');
  await expect(pill).toHaveAttribute('data-state', 'ready');
  await expect(pill.locator('.recording-button')).toHaveText('Record');
  await expect(pill.locator('.recording-button')).toBeEnabled();
  const card = page.locator('#settings-recording');
  await expect(card.locator('#recording-line')).toHaveText('OBS is open, not recording');
  await expect(card.locator('.recording-detail')).toHaveText(['About 9 hours of recording left on D: at 100 Mbps.']);
  await expect(card.locator('button[data-recording-cmd="setup"]')).toHaveCount(0);     // nothing is missing
  await expect(card.locator('button[data-recording-cmd="openObs"]')).toHaveCount(0);   // OBS is open
  await expect(card.locator('#recording-password')).toHaveCount(0);
  await expect(card.locator('#recording-folder')).toHaveValue('D:\\Racing Desk\\Recordings');
  await expect(card.locator('#recording-obsStartOnRecord')).toBeChecked();
  await expect(card.locator('#recording-obsStartWithApp')).not.toBeChecked();
  expect(await recordingCommands(page)).toEqual([]);   // looking at the page asks nothing of OBS

  await pill.locator('.recording-button').click();
  await expect(pill).toHaveAttribute('data-state', 'recording');
  await expect(pill.locator('.recording-text')).toHaveText(/^Recording 1:0[1-3]$/);
  await expect(pill.locator('.recording-button')).toHaveText('Stop');
  await expect(card.locator('#recording-line')).toHaveText(/^Recording 1:0[1-3]$/);
  await expect(card.locator('.recording-detail').first()).toHaveText('3.1 GB · D:/Racing Desk/Recordings/2026-09-30 21-00-00.mp4');
  await expect(card.locator('.recording-detail').nth(1)).toHaveText('Telemetry is being written beside it (1830 frames).');
  await expect(card.locator('button[data-recording-cmd="toggle"]')).toHaveText('Stop');
  expect(await recordingCommands(page)).toEqual([['toggle', undefined]]);

  await card.locator('button[data-recording-cmd="toggle"]').click();
  await expect(pill.locator('.recording-button')).toHaveText('Record');
  await expect(card.locator('#recording-line')).toHaveText('OBS is open, not recording');
  expect(await recordingCommands(page)).toEqual([['toggle', undefined], ['toggle', undefined]]);
  // Nothing was saved to the settings file by any of it.
  expect(await page.evaluate(() => window.__k10.saved)).toEqual([]);
  expect(errors).toEqual([]);
});

test('with OBS closed and nothing set up: Open OBS, and Set up OBS with one sentence saying what it will change; its answer is shown', async ({ page }) => {
  await stubBridge(page, { zoom: 120 });
  await stubRecording(page, OBS_CLOSED_FRESH, {
    setup: { ok: true, did: ["OBS's WebSocket is switched on.", 'The profile "Untitled" now has Hybrid MP4, a 20 s replay buffer, recordings into D:\\Racing Desk\\Recordings.'], problems: [] },
    openObs: { ok: false, reason: 'OBS was not found at C:\\Program Files\\obs-studio, so Racing Desk cannot start it. If you open OBS yourself, Racing Desk will find it.' },
  });
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=settings');
  const card = page.locator('#settings-recording');
  await expect(card.locator('#recording-line')).toHaveText('OBS is not open');
  await expect(page.locator('#recording-pill')).toHaveAttribute('data-state', 'off');
  await expect(page.locator('#recording-pill .recording-button')).toBeEnabled();   // the app decides whether OBS may be started
  await expect(card.locator('.recording-detail')).toHaveText([
    "Set up OBS will switch on OBS's WebSocket, set your profile to Hybrid MP4, turn its 20 s replay buffer on and point its recordings at D:\\Racing Desk\\Recordings. Your own Ctrl+Space recordings become Hybrid MP4 and go to D:\\Racing Desk\\Recordings too. OBS then answers on port 4455 to anything on your network that knows the password.",
  ]);
  await expect(card.locator('button[data-recording-cmd="openObs"]')).toBeEnabled();
  await expect(card.locator('button[data-recording-cmd="setup"]')).toBeEnabled();

  await card.locator('button[data-recording-cmd="setup"]').click();
  await expect(card.locator('.recording-said')).toHaveText(["OBS's WebSocket is switched on.", 'The profile "Untitled" now has Hybrid MP4, a 20 s replay buffer, recordings into D:\\Racing Desk\\Recordings.']);
  await expect(card.locator('.recording-error')).toHaveCount(0);
  expect(await recordingCommands(page)).toEqual([['setup', undefined]]);

  await card.locator('button[data-recording-cmd="openObs"]').click();
  await expect(card.locator('.recording-error')).toHaveText('OBS was not found at C:\\Program Files\\obs-studio, so Racing Desk cannot start it. If you open OBS yourself, Racing Desk will find it.');
  await expect(card.locator('.recording-said')).toHaveCount(0);
  expect(await recordingCommands(page)).toEqual([['setup', undefined], ['openObs', undefined]]);
  expect(errors).toEqual([]);
});

test('the password field is there only when OBS wants a password; what is typed goes to the app and is not kept on the page', async ({ page }) => {
  await stubBridge(page, { zoom: 120 });
  await stubRecording(page, { ...OBS_READY, obs: 'authFailed', needsPassword: true });
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=settings');
  const card = page.locator('#settings-recording');
  await expect(card.locator('#recording-line')).toHaveText('OBS refused the password');
  await expect(page.locator('#recording-pill')).toHaveAttribute('data-state', 'warn');
  await expect(card.locator('.recording-detail').first()).toContainText('OBS refused the password Racing Desk has.');
  const field = card.locator('#recording-password-field');
  await expect(field).toBeVisible();
  await expect(field).toHaveAttribute('type', 'password');
  await expect(card.locator('#recording-password .hint')).toContainText('Tools, WebSocket Server Settings');
  await field.fill('sixteen-chars-pw');
  await card.locator('#recording-password button[type="submit"]').click();
  expect(await recordingCommands(page)).toEqual([['password', 'sixteen-chars-pw']]);
  // The app says OBS is now open: the field goes.
  await pushRecording(page, { ...OBS_READY, passwordTyped: true });
  await expect(card.locator('#recording-password')).toHaveCount(0);
  await expect(card.locator('#recording-line')).toHaveText('OBS is open, not recording');
  expect(await page.evaluate(() => document.body.innerHTML.includes('sixteen-chars-pw'))).toBe(false);
  // The settings file was not written by the page for it.
  expect(await page.evaluate(() => window.__k10.saved)).toEqual([]);
  expect(errors).toEqual([]);
});

test('the two switches are saved through the settings file, like the rest of the page', async ({ page }) => {
  await stubBridge(page, { zoom: 120, obsStartOnRecord: true });
  await stubRecording(page, OBS_READY);
  await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=settings');
  const card = page.locator('#settings-recording');
  await card.locator('#recording-obsStartWithApp').check();
  await card.locator('#recording-obsStartOnRecord').uncheck();
  await expect.poll(() => page.evaluate(() => window.__k10.saved.length)).toBe(2);
  const saved = await page.evaluate(() => window.__k10.saved);
  expect(saved[0]).toMatchObject({ zoom: 120, obsStartWithApp: true });
  expect(saved[1]).toMatchObject({ zoom: 120, obsStartWithApp: true, obsStartOnRecord: false });
  // Choosing the folder and opening it are the app's commands, not keys.
  await card.locator('button[data-recording-cmd="openFolder"]').click();
  await card.locator('button[data-recording-cmd="chooseFolder"]').click();
  expect(await recordingCommands(page)).toEqual([['openFolder', undefined], ['chooseFolder', undefined]]);
});

test('under "HUD drawn by OBS": what OBS draws, Rig HUD or iPad dashboard with a sentence each, and the panel background for OBS as a slider of its own; both saved through the settings file; the card says what the choice is doing', async ({ page }) => {
  await stubBridge(page, { zoom: 120, obsHudSource: true });
  await stubRecording(page, { ...OBS_READY, obsHudSource: true, hudSource: { last: { ok: true, did: 'The HUD is a browser source in 3 of your scenes, just above the game.', problems: [] } } });
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=settings');
  const card = page.locator('#settings-recording');
  // The choice is right under the switch, with its two sentences; the slider under it.
  const names = await card.locator('.field .name').allTextContents();
  const at = names.indexOf('HUD drawn by OBS');
  expect(at).toBeGreaterThan(0);
  expect(names.slice(at, at + 3)).toEqual(['HUD drawn by OBS', 'What OBS draws', 'Panel background in OBS']);
  const choice = card.locator('#recording-obsHudView');
  await expect(choice).toHaveValue('rig');
  expect(await choice.locator('option').allTextContents()).toEqual(['Rig HUD', 'iPad dashboard']);
  await expect(card.locator('.recording-hud-view .hint')).toContainText('Rig HUD: The HUD as it is on your screen');
  await expect(card.locator('.recording-hud-view .hint')).toContainText('iPad dashboard: The glance layout the iPad shows');
  const slider = card.locator('#recording-obsPanelBackground');
  await expect(slider).toHaveAttribute('type', 'range');
  await expect(slider).toHaveValue('90');
  await expect(card.locator('.recording-panel-background output')).toHaveText('90%');
  await expect(card.locator('.recording-detail')).toContainText(['HUD drawn by OBS: The HUD is a browser source in 3 of your scenes, just above the game.']);
  // The iPad dashboard chosen: saved like the switches, and the app's new word is shown.
  await choice.selectOption('ipad');
  await expect.poll(() => page.evaluate(() => window.__k10.saved.length)).toBe(1);
  expect((await page.evaluate(() => window.__k10.saved))[0]).toMatchObject({ zoom: 120, obsHudSource: true, obsHudView: 'ipad' });
  await expect(choice).toHaveValue('ipad');
  await pushRecording(page, { ...OBS_READY, obsHudSource: true, obsHudView: 'ipad', hudSource: { last: { ok: true, did: 'The iPad dashboard is a browser source in 3 of your scenes, in its corner over the game.', problems: [] } } });
  await expect(card.locator('.recording-detail')).toContainText(['HUD drawn by OBS: The iPad dashboard is a browser source in 3 of your scenes, in its corner over the game.']);
  await expect(choice).toHaveValue('ipad');
  // The slider: its readout follows the thumb, the file is written when it is let go, held to the slider's range.
  await slider.fill('40');
  await expect(card.locator('.recording-panel-background output')).toHaveText('40%');
  await expect.poll(() => page.evaluate(() => window.__k10.saved.length)).toBe(2);
  expect((await page.evaluate(() => window.__k10.saved))[1]).toMatchObject({ obsHudView: 'ipad', obsPanelBackground: 40 });
  await expect(slider).toHaveValue('40');
  // Nothing of it is a command to the app.
  expect(await recordingCommands(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('without the app the choice and the slider are there, disabled, at their defaults', async ({ page }) => {
  await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=settings');
  const card = page.locator('#settings-recording');
  await expect(card.locator('#recording-obsHudView')).toBeDisabled();
  await expect(card.locator('#recording-obsHudView')).toHaveValue('rig');
  await expect(card.locator('#recording-obsPanelBackground')).toBeDisabled();
  await expect(card.locator('#recording-obsPanelBackground')).toHaveValue('90');
});

test('Save replay is on the card while Instant replay is on, pressable while the buffer runs, and is the app\'s command; the three recording switches are saved like the rest', async ({ page }) => {
  await stubBridge(page, { zoom: 120 });
  await stubRecording(page, { ...OBS_READY, recordingInstantReplay: true, replay: { on: true, running: false, unavailable: null, lastSaved: null } }, { saveReplay: { ok: true, path: 'D:/Racing Desk/Recordings/Replays/Replay 2026-09-30 21-20-00.mp4' } });
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=settings');
  const card = page.locator('#settings-recording');
  const save = card.locator('button[data-recording-cmd="saveReplay"]');
  await expect(save).toHaveText('Save replay');
  await expect(save).toBeDisabled();
  await expect(card.locator('.recording-detail')).toContainText(['Instant replay runs while you are in the car.']);
  await pushRecording(page, { ...OBS_READY, recordingInstantReplay: true, replay: { on: true, running: true, unavailable: null, lastSaved: null } });
  await expect(save).toBeEnabled();
  await save.click();
  expect(await recordingCommands(page)).toEqual([['saveReplay', undefined]]);
  await pushRecording(page, { ...OBS_READY, recordingInstantReplay: true, replay: { on: true, running: true, unavailable: null, lastSaved: { path: 'D:/Racing Desk/Recordings/Replays/Replay 2026-09-30 21-20-00.mp4', sidecar: 'x', at: 1, frames: 600 } } });
  await expect(card.locator('.recording-detail')).toContainText(['Replay saved: D:/Racing Desk/Recordings/Replays/Replay 2026-09-30 21-20-00.mp4']);
  // The three switches.
  await expect(card.locator('#recording-recordingAutoRecord')).toBeChecked();
  await expect(card.locator('#recording-recordingInstantReplay')).toBeChecked();
  await expect(card.locator('#recording-recordingChapters')).toBeChecked();
  await card.locator('#recording-recordingAutoRecord').uncheck();
  await card.locator('#recording-recordingChapters').uncheck();
  await expect.poll(() => page.evaluate(() => window.__k10.saved.length)).toBe(2);
  const saved = await page.evaluate(() => window.__k10.saved);
  expect(saved[1]).toMatchObject({ zoom: 120, recordingAutoRecord: false, recordingChapters: false });
  // With Instant replay off the button goes.
  await pushRecording(page, { ...OBS_READY, lastFiled: { at: 1, folder: 'D:\\Racing Desk\\Recordings\\2026-09-29 22-13 Zandvoort Porsche 992 Cup', video: 'x', sidecar: 'y', chapters: 7, clips: 1, alignment: { method: 'chapters' }, why: null } });
  await expect(card.locator('button[data-recording-cmd="saveReplay"]')).toHaveCount(0);
  await expect(card.locator('.recording-detail').first()).toHaveText('The last recording is in D:\\Racing Desk\\Recordings\\2026-09-29 22-13 Zandvoort Porsche 992 Cup (7 chapters, 1 replay).');
  expect(errors).toEqual([]);
});

test('the race detail says which recording is the race\'s and offers TV shots; pressed, the app is asked with the folder; while they run the pill is theirs and Stop ends them', async ({ page }) => {
  await stubBridge(page, { zoom: 120 });
  const REC = { folder: 'D:\\Racing Desk\\Recordings\\2026-08-15 18-00 Nordschleife Caterham', name: '2026-08-15 18-00 Nordschleife Caterham', video: 'x.mp4', take: null, startedAt: 1, clips: 1 };
  await stubRecording(page, OBS_READY, { recordingFor: { ok: true, recording: REC }, tvShots: { ok: true, moments: 5, folder: REC.folder }, tvShotsCancel: { ok: true } });
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=desk');
  const detail = page.locator('#detail');
  await expect(detail.locator('#race-tv')).toBeVisible();
  await expect(detail.locator('.race-tv-line')).toContainText('Recording: 2026-08-15 18-00 Nordschleife Caterham · 1 replay');
  const button = detail.locator('button[data-recording-cmd="tvShots"]');
  await expect(button).toHaveText('TV shots');
  await expect(button).toBeEnabled();
  // The app was asked which recording is the race's, with the race's start and track, and nothing else was asked.
  const asked = await recordingAsks(page);
  expect(asked.length).toBeGreaterThan(0);
  expect(asked.at(-1)[1]).toMatchObject({ track: expect.any(String), startedAt: expect.any(String) });
  expect(await recordingCommands(page)).toEqual([]);

  await button.click();
  await expect.poll(async () => (await recordingCommands(page)).filter((c) => c[0] === 'tvShots')).toEqual([['tvShots', { folder: REC.folder }]]);
  // The app says they are under way: the pill is theirs, with Stop; the race detail's button stops them too.
  await pushRecording(page, { ...OBS_READY, tv: { running: true, step: 'recording', index: 2, total: 5, label: 'P7 → P6', result: null } });
  const pill = page.locator('#recording-pill');
  await expect(pill.locator('.recording-text')).toHaveText('TV shots 2 of 5');
  await expect(pill).toHaveAttribute('data-state', 'busy');
  await expect(pill.locator('.recording-button')).toHaveText('Stop');
  await expect(detail.locator('button[data-recording-cmd="tvShotsCancel"]')).toHaveText('Stop TV shots');
  await pill.locator('.recording-button').click();
  await expect.poll(async () => (await recordingCommands(page)).filter((c) => c[0] === 'tvShotsCancel')).toEqual([['tvShotsCancel', undefined]]);
  // Done: the pill is the recording's again, the card says what came of them, the button offers them again.
  await pushRecording(page, { ...OBS_READY, tv: { running: false, step: 'done', result: { ok: true, moments: 5, video: 'D:\\Racing Desk\\Recordings\\2026-08-15 18-00 Nordschleife Caterham\\x tv.mp4' } } });
  await expect(pill.locator('.recording-button')).toHaveText('Record');
  await expect(detail.locator('button[data-recording-cmd="tvShots"]')).toHaveText('TV shots');
  await page.locator('a[data-page-link="settings"]').click();
  await expect(page.locator('#settings-recording .recording-detail')).toContainText(['TV shots done: 5 moments, in D:\\Racing Desk\\Recordings\\2026-08-15 18-00 Nordschleife Caterham\\x tv.mp4.']);
  expect(errors).toEqual([]);
});

test('a race with no recording says so in the detail, and outside the app the detail asks for nothing', async ({ page }) => {
  await stubBridge(page, { zoom: 120 });
  await stubRecording(page, OBS_READY, { recordingFor: { ok: true, recording: null } });
  await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=desk');
  await expect(page.locator('#detail .race-tv-line')).toHaveText('No recording of this race was found in the recordings folder.');
  await expect(page.locator('#detail button[data-recording-cmd="tvShots"]')).toHaveCount(0);
});

test('a recording stopped for the disk, and a recording OBS started, are said on the card', async ({ page }) => {
  await stubBridge(page, { zoom: 120 });
  await stubRecording(page, { ...OBS_READY, lowDisk: 'Recording stopped: only 4.0 GB left on D:.', free: { bytes: 4e9, hoursLeft: 0.09, drive: 'D:' } });
  await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=settings');
  const card = page.locator('#settings-recording');
  await expect(card.locator('.recording-detail')).toHaveText(['Recording stopped: only 4.0 GB left on D:.', 'About 5 minutes of recording left on D: at 100 Mbps.']);
  await pushRecording(page, { ...OBS_READY, recording: true, owned: false, startedAt: Date.now() - 5000, elapsedMs: 5000, outputPath: 'C:/Users/Driver/Videos/NVIDIA/his.mp4', sidecar: null });
  await expect(card.locator('.recording-detail').first()).toHaveText('C:/Users/Driver/Videos/NVIDIA/his.mp4 · started in OBS');
  await expect(card.locator('.recording-detail').nth(1)).toHaveText('No sim session is live, so no telemetry is written beside this one.');
  await expect(page.locator('#recording-pill .recording-button')).toHaveText('Stop');
});

test('what he is typing in the password field is not lost when the app pushes a new state; a state that reads the same does not rebuild the card', async ({ page }) => {
  await stubBridge(page, { zoom: 120 });
  const refused = { ...OBS_READY, obs: 'authFailed', needsPassword: true };
  await stubRecording(page, refused);
  await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=settings');
  const card = page.locator('#settings-recording');
  const field = card.locator('#recording-password-field');
  await expect(field).toBeVisible();
  await field.click();
  await page.keyboard.type('half-typed');
  await expect(field).toHaveValue('half-typed');
  await expect(field).toBeFocused();

  // The app says the same again (it used to, at every try to find OBS): the card is not touched at all.
  await page.evaluate(() => { window.__heading = document.querySelector('#settings-recording h2'); });
  await pushRecording(page, refused);
  await pushRecording(page, { ...refused });
  expect(await page.evaluate(() => window.__heading.isConnected)).toBe(true);
  await expect(field).toHaveValue('half-typed');

  // A state that does change the card — a line of its own — rebuilds it, and the field keeps its text, its focus and its caret.
  await pushRecording(page, { ...refused, last: { ok: false, text: "OBS isn't open", at: 1 } });
  await expect(card.locator('.recording-detail').first()).toHaveText("OBS isn't open");
  const again = card.locator('#recording-password-field');
  await expect(again).toHaveValue('half-typed');
  await expect(again).toBeFocused();
  await page.keyboard.type('!');
  await expect(again).toHaveValue('half-typed!');
  // Once OBS takes the password the field goes, and nothing of it stays on the page.
  await pushRecording(page, OBS_READY);
  await expect(card.locator('#recording-password')).toHaveCount(0);
  expect(await page.evaluate(() => document.body.innerHTML.includes('half-typed'))).toBe(false);
});

test('the pill\'s clock ticks without the button being replaced under the pointer, so a click that straddles a tick still lands', async ({ page }) => {
  await stubBridge(page, { zoom: 120 });
  await stubRecording(page, OBS_READY);
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=settings', { timers: true });
  const pill = page.locator('#recording-pill');
  await pill.locator('.recording-button').click();
  await expect(pill).toHaveAttribute('data-state', 'recording');
  const button = await pill.locator('.recording-button').elementHandle();
  const text = pill.locator('.recording-text');
  const before = await text.textContent();
  await page.clock.runFor(1100);
  await expect(text).not.toHaveText(before);                 // the clock moved on...
  expect(await button.evaluate((el) => el.isConnected)).toBe(true);   // ...and it is the same button
  await page.clock.runFor(3100);
  expect(await button.evaluate((el) => el.isConnected)).toBe(true);
  await expect(pill.locator('.recording-button')).toHaveText('Stop');
  // Pressed after the ticks, it stops the recording as before.
  await button.click();
  await expect(pill).toHaveAttribute('data-state', 'ready');
  expect(await recordingCommands(page)).toEqual([['toggle', undefined], ['toggle', undefined]]);
  expect(errors).toEqual([]);
});

test('the recording pill is on the masthead at the desk\'s smallest windows too, and the masthead is no taller for it', async ({ page }) => {
  await stubBridge(page, { zoom: 120 });
  await stubRecording(page, OBS_READY);
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=cars');
  const masthead = page.locator('.masthead');
  // The masthead's height, with the pill and without it: the desk's smallest windows have no height to give, and the
  // pill must not be what makes the masthead (or the freshness line in it) wrap.
  const heights = async (size) => {
    await page.setViewportSize(size);
    return masthead.evaluate((el) => {
      const pill = document.getElementById('recording-pill');
      const measure = () => [Math.round(el.getBoundingClientRect().height), Math.round(document.querySelector('.freshness').getBoundingClientRect().height)];
      const withIt = measure();
      pill.style.setProperty('display', 'none', 'important');
      const without = measure();
      pill.style.removeProperty('display');
      return { withIt, without };
    });
  };
  const normal = (await heights({ width: 1600, height: 900 })).withIt[0];
  for (const size of [{ width: 1600, height: 900 }, { width: 1280, height: 800 }, { width: 1100, height: 700 }, { width: 1050, height: 700 }, ...SMALLEST]) {
    const at = `${size.width} by ${size.height}`;
    const { withIt, without } = await heights(size);
    expect(withIt, `the masthead and the freshness line, with the pill and without it, at ${at}`).toEqual(without);
    expect(withIt[0], `the masthead is as high as it is in a wide window, at ${at}`).toBe(normal);
    // Where the freshness line gives up its words, they are its tooltip.
    if (size.width <= 1100) {
      await expect(page.locator('#freshness'), at).toBeHidden();
      await expect(page.locator('.freshness'), at).toHaveAttribute('title', /\d+ sessions/);
    }
    const pill = page.locator('#recording-pill');
    await expect(pill, at).toBeVisible();
    const button = pill.locator('.recording-button');
    await expect(button, at).toBeVisible();
    await expect(button, at).toHaveText('Record');
    const box = await button.boundingBox();
    expect(box.x + box.width, `the button is inside the window at ${at}`).toBeLessThanOrEqual(size.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `no sideways scroll at ${at}`).toBe(true);
  }
  expect(errors).toEqual([]);
});
