/**
 * The host's data is for this machine (apps/host LocalDataApi): it answers a request from a loopback connection whose Host
 * names this machine at the port it listens on, and whose Origin is null or none; anything else is a 403 with no CORS
 * header. Every program of the app that asks it — the main process's readers and the probe of the status route — makes
 * such a request, and this holds them to it: each is run, over a real socket on 127.0.0.1, against a stand-in host that
 * makes the host's check (tests/this-machine-rule.mjs) and refuses what the real host refuses. The desk's own page is
 * held to it in tests/desk/desk.spec.mjs, and the rule over the real host's socket in the .NET tests
 * (DataRoutesThisMachineTests).
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import http from 'node:http';
import { refusalOfRead, answerRuleOrPreflight } from '../this-machine-rule.mjs';

const require = createRequire(import.meta.url);
const { createCarNames } = require('../../modules/js/paints/car-names.js');
const hudDisplay = require('../../modules/js/hud-display.js');
const hostLauncher = require('../../modules/js/host-launcher.js');
const rigApi = require('../../modules/js/rig-api.js');

const CARS = [{ car_path: 'mx5 mx52016', name: 'Mazda MX-5 Cup', short_name: 'MX-5 Cup', car_id: 67, driven: 668, seen: 702 }];
const MONITORS = [{ x: -1440, y: 0, width: 1440, height: 1080, primary: false }, { x: 0, y: 0, width: 3440, height: 1440, primary: true }];
const SIM_WINDOW = { process: 'iRacingSim64DX11', window: { x: 0, y: 0, width: 3440, height: 1440 }, monitor: { x: 0, y: 0, width: 3440, height: 1440 } };
const ROUTES = {
  status: { schemaVersion: 8, sessions: 3 },
  cars: CARS,
  views: [],
  pedals: { smartcontrol: { found: false, profiles: [], keys: [] }, cars: [], without_profile: [] },
  controls: { cars: [] },
  simwindow: SIM_WINDOW,
  monitors: MONITORS,
  replay: { available: false, connected: false },
};

// The host's data API, as far as its check goes: it asks of every request what the real one asks, before the route.
function startHost() {
  const state = { asked: [], refused: [] };
  const server = http.createServer((req, res) => {
    if (answerRuleOrPreflight(req, res, server.address().port, state.refused)) return;
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
  expect(asks({ host: '127.0.0.1:8889', origin: 'null' })).toBeNull();
  expect(asks({ host: '[::1]:8889', origin: '' })).toBeNull();
  expect(asks({ host: 'LOCALHOST:8889' })).toBeNull();
  expect(asks({ host: 'localhost:8889' }, '192.168.1.20')).toBe('AnotherMachine');
  expect(asks({ host: '192.168.1.20:8889' })).toBe('AnotherHost');
  expect(asks({ host: 'evil.example:8889' })).toBe('AnotherHost');
  expect(asks({ host: 'localhost:8890' })).toBe('AnotherHost');
  expect(asks({ host: 'localhost' })).toBe('AnotherHost');
  expect(asks({})).toBe('AnotherHost');
  expect(asks({ host: 'localhost:8889', origin: 'https://evil.example' })).toBe('AWebSite');
  expect(asks({ host: 'localhost:8889', origin: 'http://localhost:3000' })).toBe('AWebSite');
  expect(asks({ host: 'localhost:8889', origin: 'Null' })).toBe('AWebSite');

  // Over the socket: a wrong Host and a web site's Origin get the 403, with no CORS header.
  for (const headers of [{ host: 'evil.example' }, { host: `127.0.0.1:${host.port + 1}` }, { origin: 'https://evil.example' }]) {
    const answer = await new Promise((resolve, reject) => {
      http.get(`${host.url}/racing-desk/data/status`, { headers }, (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
      }).on('error', reject);
    });
    expect(answer.status, JSON.stringify(headers)).toBe(403);
    expect(Object.keys(answer.headers).filter((k) => k.startsWith('access-control-'))).toEqual([]);
  }
  expect(host.state.refused).toHaveLength(3);
  expect(host.state.asked).toEqual([]);
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
