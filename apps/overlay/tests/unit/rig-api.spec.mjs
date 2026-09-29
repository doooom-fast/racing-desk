/**
 * The desk's one write (modules/js/rig-api.js): POST <host>/racing-desk/data/pedals, made by Node so that it
 * carries no Origin header, and every outcome — the car's row, a refusal, no host, a slow one, rubbish — as an
 * answer the Cars page can show, { ok, … }, never a rejection. Mostly over a `send` that records what it was
 * handed; the request as it leaves is checked against a stand-in host on 127.0.0.1 that refuses an Origin as the
 * real one does.
 *
 * And what the page reads, asked from the same place: GET cars, views, pedals and controls (the canonical list of
 * cars, with what its check has said of each), each answered { value }, { missing } or { error }, from a host on this
 * machine and no other. The list of cars is the one answer that is bounded and shaped on the way: only the keys the
 * page draws, each of the type it is drawn as, nothing longer than the page has room for.
 *
 * And who may ask either: main.js, read as text, answers the desk window alone.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import { readFileSync } from 'node:fs';
import http from 'node:http';

const require = createRequire(import.meta.url);
const {
  createRigApi, bindingProblem, bindingRequest, readAnswer, readRequest, readRoute, readControls, shapeControls, unread, send, PEDALS_PATH,
  READS, TIMEOUT_MS, MAX_LENGTH, MAX_CONTROLS_BYTES,
} = require('../../modules/js/rig-api.js');

const CAR = 'mx5 mx52016';
const PROFILE = '283f91ae';
const ROW = {
  car_path: CAR, name: 'Mazda MX-5 Cup', profile_id: PROFILE, profile_name: 'Default',
  brake_force_kg: null, bound_at: '2026-09-28T18:00:00.000Z', profile_now: 'same',
};

// A `send` that answers what the test sets — { status, text }, or a function of the request — and keeps what it
// was handed.
function recorder(answer = { status: 200, text: JSON.stringify({ car: ROW }) }) {
  const sent = [];
  const sendRequest = async (request, timeoutMs) => {
    sent.push({ request, timeoutMs });
    return typeof answer === 'function' ? answer(request) : answer;
  };
  return { sent, send: sendRequest };
}

// A host that answers as RacingDesk.Host does where it matters here: 403 to anything with an Origin. `routes`
// are answers by address, for the reads; anything else gets `answer`.
function startHost() {
  const state = { answer: { status: 200, body: JSON.stringify({ car: ROW }) }, routes: {}, asked: [] };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      state.asked.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
      const { status, body, delayMs = 0 } = 'origin' in req.headers ? { status: 403, body: '' } : state.routes[req.url] ?? state.answer;
      const timer = setTimeout(() => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(body);
      }, delayMs);
      res.on('close', () => clearTimeout(timer));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    state,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((done) => { server.closeAllConnections(); server.close(done); }),
  })));
}

test('the contract: a JSON POST to /racing-desk/data/pedals, 3 s, with no Origin', () => {
  expect(PEDALS_PATH).toBe('/racing-desk/data/pedals');
  expect(TIMEOUT_MS).toBe(3000);
  expect(MAX_LENGTH).toBe(200);

  const request = bindingRequest('http://localhost:8889/', CAR, PROFILE);   // a trailing slash is not doubled
  expect(request.url).toBe('http://localhost:8889/racing-desk/data/pedals');
  expect(request.method).toBe('POST');
  expect(JSON.parse(request.body)).toEqual({ car_path: CAR, profile_id: PROFILE });
  expect(Object.keys(request.headers).map((h) => h.toLowerCase()).sort()).toEqual(['content-length', 'content-type']);
  expect(request.headers['Content-Type']).toBe('application/json');

  // Taking the profile away is the same request with a null in it; the length is of the bytes, not the characters.
  expect(JSON.parse(bindingRequest('http://localhost:18889', CAR, null).body)).toEqual({ car_path: CAR, profile_id: null });
  const accented = bindingRequest('http://localhost:8889', 'citroën c3', PROFILE);
  expect(accented.headers['Content-Length']).toBe(Buffer.byteLength(accented.body));
  expect(accented.headers['Content-Length']).toBe(accented.body.length + 1);
});

test('bindPedals sends that request to where the host is now, and answers with the car\'s row', async () => {
  let where = 'http://localhost:8889';
  const { sent, send: sendRequest } = recorder();
  const rig = createRigApi({ host: () => where, send: sendRequest });
  expect(await rig.bindPedals(CAR, PROFILE)).toEqual({ ok: true, car: ROW });
  where = 'http://localhost:18889/';   // the host moved beside SimHub
  await rig.bindPedals(CAR, null);
  expect(sent.map((s) => s.request.url)).toEqual([
    'http://localhost:8889/racing-desk/data/pedals',
    'http://localhost:18889/racing-desk/data/pedals',
  ]);
  expect(sent.map((s) => JSON.parse(s.request.body))).toEqual([
    { car_path: CAR, profile_id: PROFILE },
    { car_path: CAR, profile_id: null },
  ]);
  expect(sent.map((s) => s.timeoutMs)).toEqual([3000, 3000]);
  for (const { request } of sent) expect(Object.keys(request.headers).some((h) => /^origin$/i.test(h))).toBe(false);
});

test('as it leaves Node: a POST the host takes, where one with an Origin is refused', async () => {
  const host = await startHost();
  try {
    const rig = createRigApi({ host: host.url });
    expect(await rig.bindPedals(CAR, PROFILE)).toEqual({ ok: true, car: ROW });
    expect(host.state.asked).toHaveLength(1);
    const asked = host.state.asked[0];
    expect(asked.method).toBe('POST');
    expect(asked.url).toBe('/racing-desk/data/pedals');
    expect(asked.headers).not.toHaveProperty('origin');
    expect(asked.headers).not.toHaveProperty('referer');
    expect(asked.headers['content-type']).toBe('application/json');
    expect(JSON.parse(asked.body)).toEqual({ car_path: CAR, profile_id: PROFILE });

    // What a page would send: the same request with its Origin. The stand-in refuses it, and that is an answer too.
    const fromAPage = bindingRequest(host.url, CAR, PROFILE);
    fromAPage.headers.Origin = 'null';
    expect((await send(fromAPage, 1000)).status).toBe(403);
    const asPage = createRigApi({ host: host.url, send: (request, ms) => send({ ...request, headers: { ...request.headers, Origin: 'null' } }, ms) });
    expect(await asPage.bindPedals(CAR, PROFILE)).toEqual({ ok: false, error: 'The host refused the request (403).' });
  } finally {
    await host.close();
  }
});

test('200 is the car\'s row, or null once the profile is taken away', () => {
  expect(readAnswer({ status: 200, text: JSON.stringify({ car: ROW }) })).toEqual({ ok: true, car: ROW });
  expect(readAnswer({ status: 200, text: '{"car":null}' })).toEqual({ ok: true, car: null });
});

test('a refusal is in the host\'s own words where it gave any', () => {
  const unknown = 'No profile 283f91ae in SmartControl.';
  expect(readAnswer({ status: 400, text: JSON.stringify({ error: unknown }) })).toEqual({ ok: false, error: unknown });
  expect(readAnswer({ status: 403, text: JSON.stringify({ error: 'Writes are for local programs.' }) }))
    .toEqual({ ok: false, error: 'Writes are for local programs.' });
  // The host escapes an apostrophe as ': the body is parsed, so the words come out as they were meant.
  expect(readAnswer({ status: 400, text: '{"error":"SmartControl doesn\\u0027t have a profile 283f91ae."}' }))
    .toEqual({ ok: false, error: 'SmartControl doesn\'t have a profile 283f91ae.' });
  expect(readAnswer({ status: 403, text: '' })).toEqual({ ok: false, error: 'The host refused the request (403).' });
  expect(readAnswer({ status: 400, text: '' })).toEqual({ ok: false, error: 'The host answered 400.' });
  expect(readAnswer({ status: 400, text: JSON.stringify({ error: '' }) })).toEqual({ ok: false, error: 'The host answered 400.' });
  expect(readAnswer({ status: 500, text: 'boom' })).toEqual({ ok: false, error: 'The host answered 500.' });
  // A host from before the route.
  expect(readAnswer({ status: 404, text: '' }).error).toMatch(/older than the page/);
  // However much the host says, a table cell's worth is shown.
  expect(readAnswer({ status: 400, text: JSON.stringify({ error: 'x'.repeat(5000) }) }).error).toHaveLength(300);
});

test('a 200 that is not the answer is not taken for one', () => {
  for (const text of ['', '{ not json', '[]', 'null', '"ok"', '{}', '{"car":"mx5 mx52016"}', '{"car":[1]}', '{"cars":[]}', '<html>']) {
    const result = readAnswer({ status: 200, text });
    expect(result, text).toEqual({ ok: false, error: 'The host answered, but not with the car it was asked about.' });
  }
  // Nor is an answer with no status, or none at all, anything to throw over.
  expect(readAnswer({}).ok).toBe(false);
  expect(readAnswer(undefined).ok).toBe(false);
});

test('arguments that are not a car and a profile are refused before anything is sent', async () => {
  const { sent, send: sendRequest } = recorder();
  const rig = createRigApi({ host: 'http://localhost:8889', send: sendRequest });
  const long = 'x'.repeat(MAX_LENGTH + 1);
  const bad = [
    ['', PROFILE], [null, PROFILE], [undefined, PROFILE], [42, PROFILE], [{ car_path: CAR }, PROFILE], [[CAR], PROFILE], [long, PROFILE],
    [CAR, undefined], [CAR, 42], [CAR, {}], [CAR, [PROFILE]], [CAR, false], [CAR, long],
  ];
  for (const [carPath, profileId] of bad) {
    expect(typeof bindingProblem(carPath, profileId), JSON.stringify([carPath, profileId])).toBe('string');
    const result = await rig.bindPedals(carPath, profileId);
    expect(result, JSON.stringify([carPath, profileId])).toEqual({ ok: false, error: bindingProblem(carPath, profileId) });
  }
  expect(sent).toEqual([]);

  // The longest that may go, and none.
  const most = 'x'.repeat(MAX_LENGTH);
  expect(bindingProblem(most, most)).toBeNull();
  expect(bindingProblem(CAR, null)).toBeNull();
  expect((await rig.bindPedals(most, most)).ok).toBe(true);
  expect(sent).toHaveLength(1);
});

test('a host that takes too long is given up on at the limit, and said so', async () => {
  const host = await startHost();
  try {
    host.state.answer = { status: 200, body: JSON.stringify({ car: ROW }), delayMs: 5000 };
    const rig = createRigApi({ host: host.url, timeoutMs: 150 });
    const started = Date.now();
    expect(await rig.bindPedals(CAR, PROFILE)).toEqual({ ok: false, error: `The host at ${host.url} did not answer within 0.15 s.` });
    expect(Date.now() - started).toBeLessThan(2000);
    await expect(send(bindingRequest(host.url, CAR, PROFILE), 150)).rejects.toThrow(/timeout/);
  } finally {
    await host.close();
  }
});

test('no host answering, or none to be worked out, is an answer and not an exception', async () => {
  const gone = await startHost();
  const url = gone.url;
  await gone.close();
  expect(await createRigApi({ host: url }).bindPedals(CAR, PROFILE)).toEqual({ ok: false, error: `Nothing is answering at ${url}.` });

  const nowhere = { ok: false, error: 'There is no local host to ask.' };
  expect(await createRigApi({ host: () => null }).bindPedals(CAR, PROFILE)).toEqual(nowhere);
  expect(await createRigApi({ host: '' }).bindPedals(CAR, PROFILE)).toEqual(nowhere);
  expect(await createRigApi({ host: () => { throw new Error('no settings'); } }).bindPedals(CAR, PROFILE)).toEqual(nowhere);
  expect(await createRigApi().bindPedals(CAR, PROFILE)).toEqual(nowhere);

  // A host that Node's http cannot ask at all (the settings can name anything) fails in words too.
  const https = await createRigApi({ host: 'https://localhost:8889' }).bindPedals(CAR, PROFILE);
  expect(https.ok).toBe(false);
  expect(https.error).toMatch(/^The host at https:\/\/localhost:8889 could not be asked: /);
  const rubbish = await createRigApi({ host: 'not a url' }).bindPedals(CAR, PROFILE);
  expect(rubbish.ok).toBe(false);
  expect(typeof rubbish.error).toBe('string');
});

test('a host on another machine is sent nothing', async () => {
  // The desk can be pointed at one to read from; what a car is driven with stays on the rig.
  for (const elsewhere of ['http://192.168.1.20:8889', 'http://rig.local:8889', 'http://localhost.example.com:8889', 'http://127.0.0.1.example.com']) {
    const sent = [];
    const rig = createRigApi({ host: elsewhere, send: async (request) => { sent.push(request); return { status: 200, text: '{"car":null}' }; } });
    expect(await rig.bindPedals(CAR, PROFILE), elsewhere).toEqual({
      ok: false, error: `The host at ${elsewhere} is not on this machine, so nothing was sent to it.`,
    });
    expect(sent, elsewhere).toEqual([]);
  }
  for (const here of ['http://localhost:8889', 'http://127.0.0.1:18889/', 'http://[::1]:8889', 'http://LOCALHOST:8889']) {
    const rig = createRigApi({ host: here, send: async () => ({ status: 200, text: '{"car":null}' }) });
    expect(await rig.bindPedals(CAR, PROFILE), here).toEqual({ ok: true, car: null });
  }
});

test('whatever a send throws comes back as words', async () => {
  for (const thrown of [new Error('socket hang up'), 'plain string', null, undefined, { code: 'EPIPE' }]) {
    const rig = createRigApi({ host: 'http://localhost:8889', send: async () => { throw thrown; } });
    const result = await rig.bindPedals(CAR, PROFILE);
    expect(result.ok, String(thrown)).toBe(false);
    expect(typeof result.error, String(thrown)).toBe('string');
    expect(result.error, String(thrown)).toContain('http://localhost:8889');
  }
  const sync = createRigApi({ host: 'http://localhost:8889', send: () => { throw new Error('thrown before any promise'); } });
  expect(await sync.bindPedals(CAR, PROFILE)).toEqual({ ok: false, error: 'The host at http://localhost:8889 could not be asked: thrown before any promise' });
});

// ── What the Cars page reads ──

const CARS = [{ car_path: CAR, name: 'Mazda MX-5 Cup', short_name: 'MX-5 Cup', car_id: 67, driven: 3, seen: 9 }];
const VIEWS = [{
  car_path: CAR, name: 'Mazda MX-5 Cup', driver_height: -0.06, vanish_y: -0.035, head_horizon: 0.5, fov: 69,
  seat_x: -0.13, seat_y: 0, seat_z: 0.02, chosen: 1, chosen_at: '2026-09-28T18:00:00.000Z', seen_at: '2026-09-28T18:00:00.000Z',
}];
const PEDALS = { smartcontrol: { found: true, profiles: [{ id: PROFILE, name: 'Default' }], keys: [] }, cars: [ROW] };
const HELD = { cars: CARS, views: VIEWS, pedals: PEDALS };

// The list of cars as the host writes it, with what its check has kept of each car, and as the page is given it.
// The host is one from before the list when it holds none of this (HELD): its controls route is a 404.
const CONTROLS = {
  version: 1,
  listHash: '0123456789ab',
  count: 2,
  following: CAR,
  problems: [],
  remarks: { 'mclaren570sgt4': ['mclaren570sgt4 the list gives abs as dcABS, which the car does not publish'] },
  kept: {
    mclaren570sgt4: [{
      about: 'absent:dcABS', text: 'the list gives abs as dcABS, which the car does not publish',
      firstSeen: '2026-09-28T18:00:00.000Z', lastSeen: '2026-09-29T09:30:00.000Z',
    }],
  },
  cars: [
    {
      path: 'mclaren570sgt4', name: 'McLaren 570S GT4', kind: 'gt', abs: 'adjustable', tc: 'adjustable', brakeBias: 'none',
      controls: [{ id: 'mode', var: 'dcABS', label: 'ESC', positions: { 0: 'TRACK', 1: 'SPORT', 2: 'NORMAL' }, lockedWhenFixed: true, covers: ['abs', 'tc'], note: 'a long note' }],
      checked: 'telemetry', sources: ['https://example.invalid/manual.pdf'],
    },
    {
      path: CAR, name: 'Mazda MX-5 Cup', kind: 'touring', abs: 'fixed', tc: 'none', brakeBias: 'adjustable',
      controls: [{ id: 'brakeBias', var: 'dcBrakeBias', label: 'BB', range: [40, 60], decimals: 1, lockedWhenFixed: false }],
      checked: 'written',
    },
  ],
};
const SHAPED = {
  version: 1,
  listHash: '0123456789ab',
  count: 2,
  following: CAR,
  cars: [
    {
      path: 'mclaren570sgt4', name: 'McLaren 570S GT4', kind: 'gt', abs: 'adjustable', tc: 'adjustable', brakeBias: 'none',
      controls: [{ id: 'mode', var: 'dcABS', label: 'ESC', positions: [[0, 'TRACK'], [1, 'SPORT'], [2, 'NORMAL']], covers: ['abs', 'tc'] }],
      checked: 'telemetry',
    },
    {
      path: CAR, name: 'Mazda MX-5 Cup', kind: 'touring', abs: 'fixed', tc: 'none', brakeBias: 'adjustable',
      controls: [{ id: 'brakeBias', var: 'dcBrakeBias', label: 'BB', range: [40, 60] }],
      checked: 'written',
    },
  ],
  kept: [{
    car: 'mclaren570sgt4',
    remarks: [{
      about: 'absent:dcABS', text: 'the list gives abs as dcABS, which the car does not publish',
      firstSeen: '2026-09-28T18:00:00.000Z', lastSeen: '2026-09-29T09:30:00.000Z',
    }],
  }],
};
const WITH_LIST = { ...HELD, controls: CONTROLS };

// A `send` that answers each route with what the host holds for it, 404 for one it has never heard of.
function reader(held = HELD) {
  return recorder((request) => {
    const route = new URL(request.url).pathname.replace('/racing-desk/data/', '');
    return Object.hasOwn(held, route) ? { status: 200, text: JSON.stringify(held[route]) } : { status: 404, text: '{"error":"unknown data route"}' };
  });
}

test('the contract of a read: a GET for each of cars, views, pedals and controls, with no body and no Origin', () => {
  expect(READS).toEqual(['cars', 'views', 'pedals', 'controls']);
  const request = readRequest('http://localhost:8889/', 'views');   // a trailing slash is not doubled
  expect(request.url).toBe('http://localhost:8889/racing-desk/data/views');
  expect(request.method).toBe('GET');
  expect(request.body).toBeUndefined();
  expect(Object.keys(request.headers).map((h) => h.toLowerCase())).toEqual(['accept']);
  expect(request.maxBytes).toBeUndefined();

  // The list of cars is asked the same way, with a limit on how much of the answer is listened to.
  const list = readRequest('http://localhost:8889', 'controls');
  expect(list.url).toBe('http://localhost:8889/racing-desk/data/controls');
  expect([list.method, list.body, Object.keys(list.headers).map((h) => h.toLowerCase())]).toEqual(['GET', undefined, ['accept']]);
  expect(list.maxBytes).toBe(MAX_CONTROLS_BYTES);
});

test('read asks where the host is now, and answers each route with what the host gave', async () => {
  let where = 'http://localhost:8889';
  const { sent, send: sendRequest } = reader();
  const rig = createRigApi({ host: () => where, send: sendRequest });
  // A host from before the list of cars has no such route, and is read all the same.
  expect(await rig.read()).toEqual({ cars: { value: CARS }, views: { value: VIEWS }, pedals: { value: PEDALS }, controls: { missing: true } });
  where = 'http://localhost:18889/';   // the host moved beside SimHub
  await rig.read();
  expect(sent.map((s) => s.request.url)).toEqual([
    'http://localhost:8889/racing-desk/data/cars',
    'http://localhost:8889/racing-desk/data/views',
    'http://localhost:8889/racing-desk/data/pedals',
    'http://localhost:8889/racing-desk/data/controls',
    'http://localhost:18889/racing-desk/data/cars',
    'http://localhost:18889/racing-desk/data/views',
    'http://localhost:18889/racing-desk/data/pedals',
    'http://localhost:18889/racing-desk/data/controls',
  ]);
  expect(sent.map((s) => s.request.method)).toEqual(Array(8).fill('GET'));
  expect(sent.map((s) => s.timeoutMs)).toEqual(Array(8).fill(3000));
  for (const { request } of sent) expect(Object.keys(request.headers).some((h) => /^origin$/i.test(h))).toBe(false);
});

test('as it leaves Node: four GETs the host takes, none of them a page\'s', async () => {
  const host = await startHost();
  try {
    for (const route of READS) host.state.routes[`/racing-desk/data/${route}`] = { status: 200, body: JSON.stringify(WITH_LIST[route]) };
    const rig = createRigApi({ host: host.url });
    expect(await rig.read()).toEqual({ cars: { value: CARS }, views: { value: VIEWS }, pedals: { value: PEDALS }, controls: { value: SHAPED } });
    expect(host.state.asked.map((a) => `${a.method} ${a.url}`).sort()).toEqual([
      'GET /racing-desk/data/cars', 'GET /racing-desk/data/controls', 'GET /racing-desk/data/pedals', 'GET /racing-desk/data/views',
    ]);
    for (const asked of host.state.asked) {
      expect(asked.headers).not.toHaveProperty('origin');
      expect(asked.headers).not.toHaveProperty('referer');
      expect(asked.body).toBe('');
    }
  } finally {
    await host.close();
  }
});

test('a route the host does not have yet is missing, and the others are read all the same', async () => {
  const older = createRigApi({ host: 'http://localhost:8889', send: reader({ cars: CARS }).send });
  expect(await older.read()).toEqual({ cars: { value: CARS }, views: { missing: true }, pedals: { missing: true }, controls: { missing: true } });
  const half = createRigApi({ host: 'http://localhost:8889', send: reader({ cars: CARS, views: VIEWS }).send });
  expect(await half.read()).toEqual({ cars: { value: CARS }, views: { value: VIEWS }, pedals: { missing: true }, controls: { missing: true } });
  // One that has all but the list of cars: the page is as it was.
  const before = createRigApi({ host: 'http://localhost:8889', send: reader(HELD).send });
  expect(await before.read()).toEqual({ cars: { value: CARS }, views: { value: VIEWS }, pedals: { value: PEDALS }, controls: { missing: true } });
});

test('an answer that is not a 200 carrying JSON is said in words', () => {
  expect(readRoute({ status: 200, text: '[]' })).toEqual({ value: [] });
  expect(readRoute({ status: 200, text: 'null' })).toEqual({ value: null });   // what it holds is the page's to check
  expect(readRoute({ status: 404, text: '' })).toEqual({ missing: true });
  for (const text of ['', '{ not json', '<html>']) {
    expect(readRoute({ status: 200, text }), text).toEqual({ error: 'The host answered, but not with JSON.' });
  }
  expect(readRoute({ status: 500, text: 'boom' })).toEqual({ error: 'The host answered 500.' });
  expect(readRoute({ status: 403, text: '{"error":"no"}' })).toEqual({ error: 'The host answered 403.' });
  // Nor is an answer with no status, or none at all, anything to throw over.
  expect(typeof readRoute({}).error).toBe('string');
  expect(typeof readRoute(undefined).error).toBe('string');
});

test('one route failing does not take the others with it', async () => {
  const { send: sendRequest } = recorder((request) => {
    if (request.url.endsWith('/views')) throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    if (request.url.endsWith('/pedals')) return { status: 200, text: '{ not json' };
    if (request.url.endsWith('/controls')) return { status: 500, text: 'boom' };
    return { status: 200, text: JSON.stringify(CARS) };
  });
  const rig = createRigApi({ host: 'http://localhost:8889', send: sendRequest });
  expect(await rig.read()).toEqual({
    cars: { value: CARS },
    views: { error: 'Nothing is answering at http://localhost:8889.' },
    pedals: { error: 'The host answered, but not with JSON.' },
    controls: { error: 'The host answered 500.' },
  });
});

test('a host on another machine is asked nothing', async () => {
  for (const elsewhere of ['http://192.168.1.20:8889', 'http://rig.local:8889', 'http://localhost.example.com:8889']) {
    const { sent, send: sendRequest } = reader();
    const rig = createRigApi({ host: elsewhere, send: sendRequest });
    const error = `The host at ${elsewhere} is not on this machine, so nothing was asked of it.`;
    expect(await rig.read(), elsewhere).toEqual({ cars: { error }, views: { error }, pedals: { error }, controls: { error } });
    expect(sent, elsewhere).toEqual([]);
  }
  for (const here of ['http://localhost:8889', 'http://127.0.0.1:18889/', 'http://[::1]:8889']) {
    const rig = createRigApi({ host: here, send: reader().send });
    expect((await rig.read()).views, here).toEqual({ value: VIEWS });
  }
});

test('no host, a slow host, a send that throws: every route says so, and nothing is thrown', async () => {
  const gone = await startHost();
  const url = gone.url;
  await gone.close();
  const nothing = { error: `Nothing is answering at ${url}.` };
  expect(await createRigApi({ host: url }).read()).toEqual({ cars: nothing, views: nothing, pedals: nothing, controls: nothing });

  const nowhere = { error: 'There is no local host to ask.' };
  expect(unread(nowhere.error)).toEqual({ cars: nowhere, views: nowhere, pedals: nowhere, controls: nowhere });
  expect(await createRigApi({ host: () => null }).read()).toEqual(unread(nowhere.error));
  expect(await createRigApi({ host: () => { throw new Error('no settings'); } }).read()).toEqual(unread(nowhere.error));
  expect(await createRigApi().read()).toEqual(unread(nowhere.error));

  const slow = await startHost();
  try {
    slow.state.answer = { status: 200, body: '[]', delayMs: 5000 };
    const started = Date.now();
    const late = { error: `The host at ${slow.url} did not answer within 0.15 s.` };
    expect(await createRigApi({ host: slow.url, timeoutMs: 150 }).read()).toEqual({ cars: late, views: late, pedals: late, controls: late });
    expect(Date.now() - started).toBeLessThan(2000);
  } finally {
    await slow.close();
  }

  const thrown = createRigApi({ host: 'http://localhost:8889', send: () => { throw new Error('thrown before any promise'); } });
  const why = { error: 'The host at http://localhost:8889 could not be asked: thrown before any promise' };
  expect(await thrown.read()).toEqual({ cars: why, views: why, pedals: why, controls: why });
});

// ── The list of cars ──

test('the list of cars comes with the keys the page draws, and nothing it has not asked for', async () => {
  const rig = createRigApi({ host: 'http://localhost:8889', send: reader(WITH_LIST).send });
  expect((await rig.read()).controls).toEqual({ value: SHAPED });
  // The note, the sources, what only the HUD reads, this run's remarks and the problems of the list are not passed on.
  const text = JSON.stringify((await rig.read()).controls);
  for (const gone of ['a long note', 'sources', 'lockedWhenFixed', 'decimals', 'problems', 'remarks":{']) expect(text, gone).not.toContain(gone);
  // Positions are in the order of their values, whatever order the host wrote them in.
  const scrambled = { ...CONTROLS, cars: [{ ...CONTROLS.cars[0], controls: [{ id: 'mode', positions: { 2: 'NORMAL', 0: 'TRACK', 1: 'SPORT' } }] }] };
  expect(shapeControls(scrambled).cars[0].controls[0].positions).toEqual([[0, 'TRACK'], [1, 'SPORT'], [2, 'NORMAL']]);
});

test('a host that serves the list and keeps nothing is read as keeping none, and one that could not read its store says so', async () => {
  // The route existed before the host kept anything: it answers the list and this run's remarks, and no `kept`. That is
  // a host with nothing kept — plausible with the app run over an older host, or with --desk-host — and the page
  // must not say of it that a store could not be read.
  const { kept, ...fromBefore } = CONTROLS;
  expect(kept).toBeDefined();
  const old = createRigApi({ host: 'http://localhost:8889', send: reader({ ...HELD, controls: fromBefore }).send });
  const { controls } = await old.read();
  expect(controls.value.kept).toEqual([]);
  expect(controls.value.cars).toEqual(SHAPED.cars);

  // The host's own null is the store it could not read.
  const unreadable = createRigApi({ host: 'http://localhost:8889', send: reader({ ...HELD, controls: { ...CONTROLS, kept: null } }).send });
  expect((await unreadable.read()).controls.value.kept).toBeNull();
  // And a host that keeps things says which.
  const keeping = createRigApi({ host: 'http://localhost:8889', send: reader(WITH_LIST).send });
  expect((await keeping.read()).controls.value.kept).toEqual(SHAPED.kept);
});

test('a control keeps what it says of its values: off, a range, names for positions', () => {
  const shaped = (control) => shapeControls({ cars: [{ path: 'x', controls: [control] }] }).cars[0].controls[0];
  expect(shaped({ id: 'tc', var: 'dcTractionControl', label: 'TCS', off: 1, range: [1, 12] })).toEqual({ id: 'tc', var: 'dcTractionControl', label: 'TCS', off: 1, range: [1, 12] });
  expect(shaped({ id: 'throttleMap', off: false })).toEqual({ id: 'throttleMap', var: null, label: null, off: false });
  expect(shaped({ id: 'abs', off: 0, range: [0, 12] }).off).toBe(0);
  // What is not what it should be is left out, as the host's own reader leaves it.
  expect(shaped({ id: 'a', off: 'zero', range: [12] })).toEqual({ id: 'a', var: null, label: null });
  expect(shaped({ id: 'a', range: [1, '12'] }).range).toBeUndefined();
  expect(shaped({ id: 'a', range: [1, 2, 3] }).range).toBeUndefined();
  expect(shaped({ id: 'a', positions: { one: 'A', '': 'B', ' ': 'C', 2: 'B', 3: 4, 4: '  ' } }).positions).toEqual([[2, 'B']]);
  expect(shaped({ id: 'a', positions: {} }).positions).toBeUndefined();
  expect(shaped({ id: 'a', covers: ['abs', 3, 'tc', 'brakeBias', 'extra'] }).covers).toEqual(['abs', 'tc', 'brakeBias']);
  // A control with no id is not one.
  expect(shapeControls({ cars: [{ path: 'x', controls: [{ label: 'no id' }, 'text', null, 7, { id: '' }, { id: 'tc' }] }] }).cars[0].controls.map((c) => c.id)).toEqual(['tc']);
});

test('a car keeps its kind and what it has, and the words that say so are the three the list uses', () => {
  const car = (fields) => shapeControls({ cars: [{ path: 'x', ...fields }] }).cars[0];
  expect(car({ kind: 'gt', abs: 'adjustable', tc: 'fixed', brakeBias: 'none', checked: 'telemetry' }))
    .toEqual({ path: 'x', name: null, kind: 'gt', abs: 'adjustable', tc: 'fixed', brakeBias: 'none', controls: [], checked: 'telemetry' });
  expect(car({ abs: 'sometimes', tc: 4, brakeBias: null, kind: 5, name: '', checked: {} }))
    .toEqual({ path: 'x', name: null, kind: null, abs: null, tc: null, brakeBias: null, controls: [], checked: null });
  expect(car({ controls: 'none' }).controls).toEqual([]);
  // A car with no folder is not one.
  expect(shapeControls({ cars: [{ name: 'No folder' }, 'text', null, [], { path: '' }, { path: 'kept' }] }).cars.map((c) => c.path)).toEqual(['kept']);
});

test('what the check has kept is by car, and a car with nothing kept is not in it', () => {
  const remark = { about: 'unlisted', text: 'the car publishes dcBrakeMisc, which the list gives to no control', firstSeen: '2026-09-28T18:00:00.000Z', lastSeen: '2026-09-28T18:00:00.000Z' };
  const shaped = shapeControls({ cars: [], kept: { a: [remark, { about: 'x' }, { text: 'y' }, 'text', null], b: [], c: 'nope', d: [remark] } });
  expect(shaped.kept).toEqual([{ car: 'a', remarks: [remark] }, { car: 'd', remarks: [remark] }]);
  // A host that could not read its store says so with null, which is not none.
  expect(shapeControls({ cars: [], kept: null }).kept).toBeNull();
  expect(shapeControls({ cars: [], kept: [] }).kept).toBeNull();
  expect(shapeControls({ cars: [], kept: 'none' }).kept).toBeNull();
  expect(shapeControls({ cars: [], kept: {} }).kept).toEqual([]);
  // A host from before the desk kept anything serves the route with no `kept` at all: it keeps none, and that is not
  // its store being unreadable — the page must not say that of it.
  expect(shapeControls({ cars: [] }).kept).toEqual([]);
  expect(shapeControls({ version: 1, remarks: { a: ['a line of the log'] }, cars: [{ path: 'a' }] }).kept).toEqual([]);
  // The moments are text or nothing.
  expect(shapeControls({ cars: [], kept: { a: [{ ...remark, firstSeen: 5, lastSeen: null }] } }).kept[0].remarks[0]).toEqual({ ...remark, firstSeen: null, lastSeen: null });
  // A car called what an object's own keys are is a car like another.
  const odd = shapeControls({ cars: [], kept: JSON.parse('{"__proto__": [{"about":"a","text":"b"}], "constructor": [{"about":"a","text":"b"}]}') });
  expect(odd.kept.map((k) => k.car)).toEqual(['__proto__', 'constructor']);
  expect(({}).about).toBeUndefined();
});

test('what the page has no room for is cut, and the answer is a list all the same', () => {
  const long = 'x'.repeat(5000);
  const shaped = shapeControls({
    version: 1.5, listHash: long, count: 'many', following: long,
    cars: [{
      path: long, name: long, kind: long, checked: long,
      controls: [{ id: long, var: long, label: long, positions: { 0: long } }],
    }],
    kept: { [long]: [{ about: long, text: long, firstSeen: long, lastSeen: long }] },
  });
  expect(shaped.version).toBe(1.5);
  expect(shaped.count).toBeNull();
  expect(shaped.listHash).toHaveLength(100);
  expect(shaped.following).toHaveLength(MAX_LENGTH);
  const car = shaped.cars[0];
  expect([car.path.length, car.name.length, car.kind.length, car.checked.length]).toEqual([MAX_LENGTH, MAX_LENGTH, 100, 100]);
  const control = car.controls[0];
  expect([control.id.length, control.var.length, control.label.length, control.positions[0][1].length]).toEqual([100, 100, 100, 100]);
  const remark = shaped.kept[0].remarks[0];
  expect([shaped.kept[0].car.length, remark.about.length, remark.text.length, remark.firstSeen.length, remark.lastSeen.length]).toEqual([MAX_LENGTH, 100, 500, 40, 40]);

  // And in numbers: a list has as many cars as there are, up to a thousand, and a car as many controls as it has, up to sixty.
  const many = shapeControls({
    cars: Array.from({ length: 1500 }, (_, i) => ({
      path: `car${i}`,
      controls: Array.from({ length: i === 0 ? 90 : 1 }, (__, j) => ({ id: `c${j}`, positions: Object.fromEntries(Array.from({ length: 200 }, (___, k) => [k, `p${k}`])) })),
    })),
    kept: Object.fromEntries(Array.from({ length: 1500 }, (_, i) => [`car${i}`, Array.from({ length: 90 }, (__, j) => ({ about: `a${j}`, text: 't' }))])),
  });
  expect(many.cars).toHaveLength(1000);
  expect(many.cars[0].controls).toHaveLength(60);
  expect(many.cars[0].controls[0].positions).toHaveLength(64);
  expect(many.kept).toHaveLength(1000);
  expect(many.kept[0].remarks).toHaveLength(60);
});

test('an answer that is not the list of cars is an error in words, and an old host is missing', () => {
  const words = { error: 'The host answered, but not with the list of cars.' };
  for (const value of [null, [], 'text', 7, {}, { cars: 'all of them' }, { cars: null }, { car: {} }, { kept: {} }]) {
    expect(readControls({ status: 200, text: JSON.stringify(value) }), JSON.stringify(value)).toEqual(words);
  }
  expect(readControls({ status: 200, text: '{ "cars": [] }' })).toEqual({ value: { version: null, listHash: null, count: null, following: null, cars: [], kept: [] } });
  expect(readControls({ status: 200, text: '{ "cars": [], "kept": null }' }).value.kept).toBeNull();
  expect(readControls({ status: 404, text: '' })).toEqual({ missing: true });
  expect(readControls({ status: 500, text: 'boom' })).toEqual({ error: 'The host answered 500.' });
  expect(readControls({ status: 200, text: '{ not json' })).toEqual({ error: 'The host answered, but not with JSON.' });
  expect(typeof readControls({}).error).toBe('string');
  expect(typeof readControls(undefined).error).toBe('string');
});

test('a list longer than the page reads is not read, and is said', async () => {
  const size = MAX_CONTROLS_BYTES + 1;
  expect(readControls({ status: 200, text: ' '.repeat(size) })).toEqual({ error: 'The host\'s list of cars is longer than the page reads.' });
  expect(readControls({ status: 200, text: '{"cars":[]}' + ' '.repeat(MAX_CONTROLS_BYTES - 11) }).value.cars).toEqual([]);

  // As it comes off the wire: the read stops listening, and the others are asked all the same.
  const host = await startHost();
  try {
    for (const route of ['cars', 'views', 'pedals']) host.state.routes[`/racing-desk/data/${route}`] = { status: 200, body: JSON.stringify(HELD[route]) };
    host.state.routes['/racing-desk/data/controls'] = { status: 200, body: JSON.stringify({ cars: [{ path: 'x', name: 'y'.repeat(size) }] }) };
    const result = await createRigApi({ host: host.url }).read();
    expect(result.controls).toEqual({ error: `The host at ${host.url} answered with more than the page reads.` });
    expect(result.cars).toEqual({ value: CARS });
    // The other routes have no such limit: what they hold is the page's to check.
    host.state.routes['/racing-desk/data/views'] = { status: 200, body: JSON.stringify([{ car_path: 'x', name: 'y'.repeat(size) }]) };
    expect((await createRigApi({ host: host.url }).read()).views.value[0].name).toHaveLength(size);
  } finally {
    await host.close();
  }
});

// ── Who may ask ──
// main.js cannot be loaded without Electron, so it is read as text and held to this: rig:read and rig:bindPedals
// answer the desk window and no other. The HUD's window shares the preload, and so has the same two calls to make;
// the page on an iPad is served the HUD's scripts. Neither has any business with what a car is driven with.

const MAIN = readFileSync(new URL('../../main.js', import.meta.url), 'utf8');

// What a handler does, statement by statement: the lines of ipcMain.handle('<channel>', …)'s body, without the
// comments and the blank ones. `takes` is what it is handed.
function handlerOf(channel) {
  const registered = MAIN.split(`ipcMain.handle('${channel}',`);
  expect(registered, `${channel} is handled once`).toHaveLength(2);
  const opening = /^\s*async \(([^)]*)\) => \{\r?\n/.exec(registered[1]);
  expect(opening, `${channel} is handled by a function written out where it is registered`).not.toBeNull();
  const body = registered[1].slice(opening[0].length).split(/\r?\n\}\);/)[0];
  const does = body.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length && !line.startsWith('//'));
  return { takes: opening[1].split(',').map((name) => name.trim()), does };
}

test('main.js answers rig:read and rig:bindPedals to the desk window and no other', () => {
  // The desk window is the one whose page is asking: the sender itself, not a name or an address it gives.
  const fromDesk = /\bconst fromDesk = \(event\) => ([^;\n]+);/.exec(MAIN);
  expect(fromDesk, 'fromDesk is one expression over the event').not.toBeNull();
  expect(fromDesk[1]).toContain('event.sender === deskWindow.webContents');
  expect(fromDesk[1]).toContain('!deskWindow.isDestroyed()');
  expect(fromDesk[1]).not.toContain('||');
  expect(MAIN.match(/\bfromDesk\s*=/g)).toHaveLength(1);   // and it is not made to mean something else later

  const turnedAway = { 'rig:read': 'rigApi.unread(RIG_NOT_DESK)', 'rig:bindPedals': '{ ok: false, error: RIG_NOT_DESK }' };
  for (const [channel, answer] of Object.entries(turnedAway)) {
    const { takes, does } = handlerOf(channel);
    expect(takes[0], channel).toBe('event');
    // Anybody else is turned away first, with an answer the page could read and nothing of the host's in it.
    expect(does[0], channel).toBe(`if (!fromDesk(event)) return ${answer};`);
    // Only after that is the host asked, and nowhere else in the handler.
    const asks = does.map((line, i) => (/\brig\.\w+\(/.test(line) ? i : -1)).filter((i) => i >= 0);
    expect(asks, channel).toHaveLength(1);
    expect(asks[0], channel).toBeGreaterThan(0);
  }

  // Nothing else in main.js asks on the page's behalf: the two calls are made in those two handlers.
  expect(MAIN.match(/\brig\.read\(/g)).toHaveLength(1);
  expect(MAIN.match(/\brig\.bindPedals\(/g)).toHaveLength(1);
  expect(handlerOf('rig:read').does.some((line) => line.includes('rig.read('))).toBe(true);
  expect(handlerOf('rig:bindPedals').does.some((line) => line.includes('rig.bindPedals('))).toBe(true);
  // What is said to anybody else is words, as unread() and bindPedals' refusals are.
  expect(MAIN).toMatch(/\bconst RIG_NOT_DESK = '[^']+';/);
});
