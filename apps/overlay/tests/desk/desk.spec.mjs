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
  await expect(page.locator('.race-row')).toHaveCount(30); // the desk page loaded behind it all the same
  expect(errors).toEqual([]);
});

// ── Paints ───────────────────────────────────────────────────
// The livery manager's island (apps/paints/src, bundled by build-island.mjs in beforeAll) over a stubbed
// window.racingDesk.paints: a canned answer per command, every call recorded. An answer of { __error } rejects the
// way preload.js does, with an Error carrying the command's own message.

const PAINT_DIR = 'C:\\Users\\Owner\\Documents\\iRacing\\paint';
const LIBRARY = 'C:\\Users\\Owner\\Documents\\GitHub\\liveries\\cars';
const CUSTOMER = '424242';
const PLAIN_FOLDER = {
  gitAvailable: true, isRepo: false, root: null, branch: null, upstream: null, remoteUrl: null, head: null, subject: null,
  dirty: false, behind: 0, ahead: 0, checkedRemote: false, updatesAvailable: false, notes: [],
};

function version(id, name) {
  const dir = `${LIBRARY}\\lotus79\\${id}`;
  return {
    id, name, path: dir,
    files: [
      { role: 'car', roleLabel: 'Paint', fileName: `car_${CUSTOMER}.tga`, path: `${dir}\\car_${CUSTOMER}.tga`, size: 12582956, sha256: `${id}-paint` },
      { role: 'car_spec', roleLabel: 'Spec map', fileName: `car_spec_${CUSTOMER}.tga`, path: `${dir}\\car_spec_${CUSTOMER}.tga`, size: 12582956, sha256: `${id}-spec` },
    ],
    previews: [], meta: { name }, hasPaint: true, hasSpec: true, problems: [],
  };
}

const PAINTS = {
  loadSettings: {},
  saveSettings: null,
  detectPaths: {
    candidates: [{ path: PAINT_DIR, source: '%USERPROFILE%', exists: true, isOneDrive: false, carFolders: 85, textureFiles: 3204 }],
    chosen: PAINT_DIR, ambiguous: false, notes: [],
  },
  detectCustomer: { id: CUSTOMER, confidence: 'certain', source: 'Trading Paints downloader config', candidates: [], notes: [] },
  suggestLibraries: [{ path: LIBRARY, cars: 1, repo: PLAIN_FOLDER }],
  scanLibrary: {
    root: LIBRARY,
    cars: [{ folder: 'lotus79', simFolder: 'lotus79', simFolderInferred: false, versions: [version('v12', 'v12 Shatter'), version('v13', 'v13 Shatter')] }],
    notes: [],
  },
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
    window.racingDesk = {
      paints: {
        invoke: async (name, args) => {
          window.__paints.calls.push({ name, args });
          if (!(name in canned)) throw new Error(`no answer for ${name}`);
          const answer = canned[name];
          if (answer && typeof answer === 'object' && '__error' in answer) throw new Error(answer.__error);
          return JSON.parse(JSON.stringify(answer));
        },
        pickFolder: async () => { window.__paints.picked += 1; return null; },
        reveal: async (p) => { window.__paints.revealed.push(p); },
        openPath: async () => {},
      },
    };
  }, answers);
}

const paintsCalls = (page, name) => page.evaluate((n) => window.__paints.calls.filter((c) => c.name === n).map((c) => c.args), name);

test('the Paints page is the livery manager: the paint folder it found, the library car and its versions', async ({ page }) => {
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
  await expect(app.locator('.sidebar .car .name')).toHaveText(['lotus79']);
  await expect(app.locator('.sidebar .car .meta')).toContainText('2 versions');
  await expect(app.locator('.versions .card .head .name')).toHaveText(['v12 Shatter', 'v13 Shatter']);
  await expect(app.locator('.versions .card .badge.partial')).toHaveText('paint only'); // carState: v12's paint, not its spec
  await expect(app.locator('.versions .card .preview img')).toHaveCount(2);
  await expect(app.locator('.chips .chip')).toHaveText('ready');
  await expect(app.locator('.panel', { hasText: 'Installed in the sim' })).toContainText('41 belonging to other drivers');
  expect(await paintsCalls(page, 'scanLibrary')).toEqual([{ libraryRoot: LIBRARY, paintDir: PAINT_DIR }]);
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
  expect(errors).toEqual([]);
});

test('Apply on a version runs the manager\'s applyVersion with the request src/types.ts describes', async ({ page }) => {
  await stubPaintsBridge(page, PAINTS);
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=paints');
  const app = page.locator('#paints-root > .paints-app');
  const v13 = app.locator('.versions .card', { hasText: 'v13 Shatter' });
  await v13.locator('.actions button.primary').click();

  // The dialog says what it is about to do, then Apply (enabled once preflight has answered) does it.
  const modal = app.locator('.modal');
  await expect(modal.locator('h2')).toHaveText('Apply v13 Shatter');
  await expect(modal).toContainText(`car_${CUSTOMER}.tga`);
  await expect(modal).toContainText(`car_spec_${CUSTOMER}.tga`);
  await expect(modal.locator('.banner')).toHaveCount(0);
  await modal.locator('.foot button.primary').click();
  await expect(modal).toBeHidden();

  expect(await paintsCalls(page, 'preflight')).toEqual([{ paintDir: PAINT_DIR, simFolder: 'lotus79' }]);
  expect(await paintsCalls(page, 'applyVersion')).toEqual([{
    request: {
      paintDir: PAINT_DIR, libraryRoot: LIBRARY, carFolder: 'lotus79', simFolder: 'lotus79', versionId: 'v13', customerId: CUSTOMER,
      includeSpec: true, setReadOnlyAfter: false, clearOtherCooked: false, force: false,
    },
  }]);
  const entry = app.locator('.log .entry.ok');
  await expect(entry).toContainText('Applied v13 Shatter to lotus79');
  await expect(entry).toContainText(`car_${CUSTOMER}.tga installed`);
  expect((await paintsCalls(page, 'carState')).length).toBeGreaterThanOrEqual(2); // re-read after the apply
  expect(errors).toEqual([]);
});

test('what the manager refuses is shown in its own words', async ({ page }) => {
  const refusal = 'iRacing is running. It holds paint files open, so a swap can fail halfway. Close the sim first.';
  await stubPaintsBridge(page, { ...PAINTS, applyVersion: { __error: refusal } });
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=paints');
  const app = page.locator('#paints-root > .paints-app');
  await app.locator('.versions .card', { hasText: 'v13 Shatter' }).locator('.actions button.primary').click();
  await app.locator('.modal .foot button.primary').click();
  const entry = app.locator('.log .entry.bad');
  await expect(entry).toContainText('Did not apply v13 Shatter');
  await expect(entry).toContainText(refusal);
  expect(errors).toEqual([]);

  // A preflight that fails outright is shown in the dialog itself, and Apply stays off.
  await stubPaintsBridge(page, { ...PAINTS, preflight: { __error: 'The paint folder could not be read.' } });
  await page.reload();
  const again = page.locator('#paints-root > .paints-app');
  await again.locator('.versions .card', { hasText: 'v12 Shatter' }).locator('.actions button.primary').click();
  await expect(again.locator('.modal .banner.bad')).toContainText('The paint folder could not be read.');
  await expect(again.locator('.modal .foot button.primary')).toBeDisabled();
});

test('without the app the Paints page says so instead of mounting the manager', async ({ page }) => {
  const errors = await openDesk(page, `http://127.0.0.1:${host.address().port}`, '&page=paints');
  await expect(page.locator('#paints-note')).toBeVisible();
  await expect(page.locator('#paints-note')).toContainText('needs the Racing Desk app');
  await expect(page.locator('#paints-unbuilt')).toBeHidden();
  expect(await page.locator('.paints-app').count()).toBe(0);
  expect(errors).toEqual([]);
});
