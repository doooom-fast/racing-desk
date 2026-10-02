/**
 * The host's data is for programs on this machine (apps/host LocalDataApi): it answers a request from a loopback connection
 * whose Host names this machine at the port it listens on and that no browser sent (no Origin of any kind, the app's own page's
 * `null` included, and none of a browser's other marks); anything else is a 403 with no CORS header, and nothing is sent one.
 * Every program of the app that asks it — the main process's readers, the desk's reads it makes for the page, and the probe of
 * the status route — makes such a request, and this holds them to it: each is run, over a real socket on 127.0.0.1, against a
 * stand-in host that makes the host's check (tests/this-machine-rule.mjs) and refuses what the real host refuses. The desk's
 * own page is held to it in tests/desk/desk.spec.mjs, the pages of a web site in host-data-pages.spec.mjs, and the rule over
 * the real host's socket in the .NET tests (DataRoutesThisMachineTests).
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import http from 'node:http';
import { refusalOfRead, answerRefusal } from '../this-machine-rule.mjs';

const require = createRequire(import.meta.url);
const { createCarNames } = require('../../modules/js/paints/car-names.js');
const hudDisplay = require('../../modules/js/hud-display.js');
const hostLauncher = require('../../modules/js/host-launcher.js');
const rigApi = require('../../modules/js/rig-api.js');
const deskReads = require('../../modules/js/desk-reads.js');
const rigLimits = require('../../modules/js/rig-limits.js');

const CARS = [{ car_path: 'mx5 mx52016', name: 'Mazda MX-5 Cup', short_name: 'MX-5 Cup', car_id: 67, driven: 668, seen: 702 }];
const MONITORS = [{ x: -1440, y: 0, width: 1440, height: 1080, primary: false }, { x: 0, y: 0, width: 3440, height: 1440, primary: true }];
const SIM_WINDOW = { process: 'iRacingSim64DX11', window: { x: 0, y: 0, width: 3440, height: 1440 }, monitor: { x: 0, y: 0, width: 3440, height: 1440 } };
const ROUTES = {
  status: { schemaVersion: 8, sessions: 3, db: 'racing-desk.db' },
  sessions: [{ id: 1, driver_cust_id: 424242, car_path: 'mx5 mx52016' }],
  schedule: { season: null, series: [] },
  session: { session: [{ id: 1 }], laps: [], incidents: [], grid: [] },
  cars: CARS,
  views: [],
  pedals: { smartcontrol: { found: false, profiles: [], keys: [] }, cars: [], without_profile: [] },
  controls: { cars: [] },
  simwindow: SIM_WINDOW,
  monitors: MONITORS,
  replay: { available: false, connected: false },
  brakeforce: { car: 'mx5 mx52016', force_kg: 45 },
  wheelmax: { source: 'pithouse', model: 'R21 Ultra', max_pct: 55, rated_nm: 21, max_nm: 11.55, candidates: 2 },
};

// The host's data API, as far as its check goes: it asks of every request what the real one asks, before the route.
function startHost() {
  const state = { asked: [], refused: [] };
  const server = http.createServer((req, res) => {
    if (answerRefusal(req, res, server.address().port, state.refused)) return;
    state.asked.push({ method: req.method, url: req.url, headers: req.headers });
    const route = new URL(req.url, 'http://x').pathname.replace('/racing-desk/data/', '');
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (req.method === 'POST' && route === 'pedals') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ car: { car_path: 'mx5 mx52016', name: 'Mazda MX-5 Cup', profile_id: 'a1', profile_name: 'Default', brake_force_kg: null, bound_at: '2026-09-28T18:00:00.000Z', profile_now: 'same' } }));
        return;
      }
      const body = ROUTES[route];
      res.writeHead(body === undefined ? 404 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body === undefined ? { error: 'unknown data route' } : body));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    state,
    port: server.address().port,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((done) => { server.closeAllConnections(); server.close(done); }),
  })));
}

let host;
test.beforeEach(async () => { host = await startHost(); });
test.afterEach(async () => { await host.close(); });

// A request as the stand-in sees one: the connection's address and the headers.
const fake = (headers, remoteAddress = '127.0.0.1') => ({ socket: { remoteAddress }, headers });

test('the stand-in refuses what the host refuses (so the readers below passing means something)', async () => {
  const port = 8889;
  const asks = (headers, remote) => refusalOfRead(fake(headers, remote), port);
  expect(asks({ host: 'localhost:8889' })).toBeNull();
  expect(asks({ host: '[::1]:8889', origin: '' })).toBeNull();
  expect(asks({ host: 'LOCALHOST:8889' })).toBeNull();
  expect(asks({ host: 'localhost:8889', 'sec-fetch-mode': 'cors' }), 'Node\'s fetch says Sec-Fetch-Mode and no more').toBeNull();
  expect(asks({ host: 'localhost:8889' }, '192.168.1.20')).toBe('AnotherMachine');
  expect(asks({ host: '192.168.1.20:8889' })).toBe('AnotherHost');
  expect(asks({ host: 'evil.example:8889' })).toBe('AnotherHost');
  expect(asks({ host: 'localhost:8890' })).toBe('AnotherHost');
  expect(asks({ host: 'localhost' })).toBe('AnotherHost');
  expect(asks({})).toBe('AnotherHost');
  expect(asks({ host: 'localhost:8889', origin: 'https://evil.example' })).toBe('AWebSite');
  expect(asks({ host: 'localhost:8889', origin: 'http://localhost:3000' })).toBe('AWebSite');
  expect(asks({ host: 'localhost:8889', origin: 'Null' })).toBe('AWebSite');
  // null is the app's own page, and also a web page redirected to the host, sandboxed, or opened from disk: no page reads the host.
  expect(asks({ host: '127.0.0.1:8889', origin: 'null' })).toBe('AWebSite');
  // What a browser sends with no Origin: an image, a script or a no-cors fetch, a link, a form.
  expect(asks({ host: 'localhost:8889', 'sec-fetch-site': 'cross-site' })).toBe('ABrowser');
  expect(asks({ host: 'localhost:8889', 'sec-fetch-dest': 'image' })).toBe('ABrowser');
  expect(asks({ host: 'localhost:8889', 'sec-fetch-user': '?1' })).toBe('ABrowser');
  expect(asks({ host: 'localhost:8889', referer: 'https://evil.example/' })).toBe('ABrowser');

  // Over the socket: a wrong Host, any Origin (null too) and a browser's marks get the 403, with no CORS header.
  const refusedAsked = [
    { host: 'evil.example' }, { host: `127.0.0.1:${host.port + 1}` }, { origin: 'https://evil.example' }, { origin: 'null' },
    { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-dest': 'image' },
  ];
  for (const headers of refusedAsked) {
    const answer = await new Promise((resolve, reject) => {
      http.get(`${host.url}/racing-desk/data/status`, { headers }, (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
      }).on('error', reject);
    });
    expect(answer.status, JSON.stringify(headers)).toBe(403);
    expect(Object.keys(answer.headers).filter((k) => k.startsWith('access-control-'))).toEqual([]);
  }
  expect(host.state.refused).toHaveLength(refusedAsked.length);
  expect(host.state.asked).toEqual([]);
});

test('the desk\'s four reads, which the app makes for its page (desk-reads.js), are answered', async () => {
  const reads = deskReads.createDeskReads({ host: () => host.url });
  expect(await reads.read('status')).toEqual({ value: ROUTES.status });
  expect(await reads.read('sessions')).toEqual({ value: ROUTES.sessions });
  expect(await reads.read('schedule')).toEqual({ value: ROUTES.schedule });
  expect(await reads.read('session', 1)).toEqual({ value: ROUTES.session });
  expect(host.state.refused).toEqual([]);
  expect(host.state.asked.map((a) => a.url)).toEqual([
    '/racing-desk/data/status', '/racing-desk/data/sessions', '/racing-desk/data/schedule', '/racing-desk/data/session?id=1',
  ]);
  // Node adds a Host and no Origin, and no other mark of a browser.
  for (const a of host.state.asked) {
    expect(a.headers.host).toBe(`127.0.0.1:${host.port}`);
    for (const name of ['origin', 'referer', 'sec-fetch-site', 'sec-fetch-dest', 'sec-fetch-user']) expect(a.headers[name], name).toBeUndefined();
  }
});

test('the car names the app asks for (paints/car-names.js) are answered', async () => {
  const carNames = createCarNames({ host: () => host.url });
  expect(await carNames()).toEqual(CARS);
  expect(host.state.refused).toEqual([]);
  expect(host.state.asked.map((a) => a.url)).toEqual(['/racing-desk/data/cars']);
});

test('the sim window and the monitors the HUD asks for (hud-display.js) are answered', async () => {
  expect(await hudDisplay.fetchSimWindow(`${host.url}${hudDisplay.SIM_WINDOW_PATH}`)).toMatchObject({ state: 'running', process: 'iRacingSim64DX11' });
  expect(await hudDisplay.fetchMonitors(`${host.url}${hudDisplay.MONITORS_PATH}`)).toEqual({ state: 'ok', monitors: MONITORS });
  expect(host.state.refused).toEqual([]);
});

test('the probe of the status route that finds a host to use (host-launcher.js) is answered', async () => {
  const result = await hostLauncher.probe(`${host.url}${hostLauncher.STATUS_PATH}`);
  expect(result.status).toBe(200);
  expect(hostLauncher.classifyStatus(result)).toBe('host');
  expect(await hostLauncher.waitForHost(host.url, { timeoutMs: 2000, intervalMs: 50 })).toBe(true);
  expect(host.state.refused).toEqual([]);
});

test('the Cars page\'s four reads and its one write (rig-api.js) are answered', async () => {
  const rig = rigApi.createRigApi({ host: () => host.url });
  const read = await rig.read();
  expect(Object.keys(read).sort()).toEqual(['cars', 'controls', 'pedals', 'views']);
  for (const route of rigApi.READS) expect(read[route], route).toHaveProperty('value');
  expect(await rig.bindPedals('mx5 mx52016', 'a1')).toMatchObject({ ok: true });
  expect(host.state.refused).toEqual([]);
  // Node adds a Host and no Origin: the rule's two halves for a program.
  for (const a of host.state.asked) {
    expect(a.headers.host).toBe(`127.0.0.1:${host.port}`);
    expect(a.headers.origin).toBeUndefined();
  }
});

test('the brake force and the wheel\'s maximum the HUD\'s datastream is told (rig-limits.js, asked by the main process) are answered', async () => {
  expect(await rigLimits.fetchBrakeForce(`${host.url}${rigLimits.BRAKE_FORCE_PATH}`)).toEqual({ brakeKg: 45, car: 'mx5 mx52016' });
  expect(await rigLimits.fetchWheelMax(`${host.url}${rigLimits.WHEEL_MAX_PATH}`)).toEqual({ wheelNm: 11.55, wheelSource: 'pithouse' });
  expect(await rigLimits.fetchRigLimits(`${host.url}${rigLimits.BRAKE_FORCE_PATH}`)).toEqual({ brakeKg: 45, car: 'mx5 mx52016', wheelNm: 11.55, wheelSource: 'pithouse' });
  expect(host.state.refused).toEqual([]);
  expect(host.state.asked.map((a) => a.url)).toEqual([
    '/racing-desk/data/brakeforce', '/racing-desk/data/wheelmax', '/racing-desk/data/brakeforce', '/racing-desk/data/wheelmax',
  ]);
  for (const a of host.state.asked) {
    expect(a.headers.host).toBe(`127.0.0.1:${host.port}`);
    for (const name of ['origin', 'referer', 'sec-fetch-site', 'sec-fetch-dest', 'sec-fetch-user']) expect(a.headers[name], name).toBeUndefined();
  }
});

test('main.js\'s own asks of the host (Node\'s fetch: the replay) are answered', async () => {
  // main.js askHost: global fetch with a JSON body for the POST, and nothing that says a browser sent it. Node's fetch says
  // Sec-Fetch-Mode and no more, which the host's check for a program does not count against it, and neither does this one.
  const get = await fetch(`${host.url}/racing-desk/data/replay`, { signal: AbortSignal.timeout(3000) });
  expect(get.status).toBe(200);
  const post = await fetch(`${host.url}/racing-desk/data/pedals`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ car_path: 'x', profile_id: null }), signal: AbortSignal.timeout(3000),
  });
  expect(post.status).toBe(200);
  expect(host.state.refused).toEqual([]);
  for (const a of host.state.asked) expect(a.headers.origin).toBeUndefined();
});
