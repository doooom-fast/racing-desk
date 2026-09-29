/**
 * The desk's one write (modules/js/rig-api.js): POST <host>/racing-desk/data/pedals, made by Node so that it
 * carries no Origin header, and every outcome — the car's row, a refusal, no host, a slow one, rubbish — as an
 * answer the Cars page can show, { ok, … }, never a rejection. Mostly over a `send` that records what it was
 * handed; the request as it leaves is checked against a stand-in host on 127.0.0.1 that refuses an Origin as the
 * real one does.
 *
 * And what the page reads, asked from the same place: GET cars, views and pedals, each answered { value },
 * { missing } or { error }, from a host on this machine and no other.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import http from 'node:http';

const require = createRequire(import.meta.url);
const {
  createRigApi, bindingProblem, bindingRequest, readAnswer, readRequest, readRoute, unread, send, PEDALS_PATH, READS, TIMEOUT_MS, MAX_LENGTH,
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

// A `send` that answers each route with what the host holds for it, 404 for one it has never heard of.
function reader(held = HELD) {
  return recorder((request) => {
    const route = new URL(request.url).pathname.replace('/racing-desk/data/', '');
    return Object.hasOwn(held, route) ? { status: 200, text: JSON.stringify(held[route]) } : { status: 404, text: '{"error":"unknown data route"}' };
  });
}

test('the contract of a read: a GET for each of cars, views and pedals, with no body and no Origin', () => {
  expect(READS).toEqual(['cars', 'views', 'pedals']);
  const request = readRequest('http://localhost:8889/', 'views');   // a trailing slash is not doubled
  expect(request.url).toBe('http://localhost:8889/racing-desk/data/views');
  expect(request.method).toBe('GET');
  expect(request.body).toBeUndefined();
  expect(Object.keys(request.headers).map((h) => h.toLowerCase())).toEqual(['accept']);
});

test('read asks where the host is now, and answers each route with what the host gave', async () => {
  let where = 'http://localhost:8889';
  const { sent, send: sendRequest } = reader();
  const rig = createRigApi({ host: () => where, send: sendRequest });
  expect(await rig.read()).toEqual({ cars: { value: CARS }, views: { value: VIEWS }, pedals: { value: PEDALS } });
  where = 'http://localhost:18889/';   // the host moved beside SimHub
  await rig.read();
  expect(sent.map((s) => s.request.url)).toEqual([
    'http://localhost:8889/racing-desk/data/cars',
    'http://localhost:8889/racing-desk/data/views',
    'http://localhost:8889/racing-desk/data/pedals',
    'http://localhost:18889/racing-desk/data/cars',
    'http://localhost:18889/racing-desk/data/views',
    'http://localhost:18889/racing-desk/data/pedals',
  ]);
  expect(sent.map((s) => s.request.method)).toEqual(Array(6).fill('GET'));
  expect(sent.map((s) => s.timeoutMs)).toEqual(Array(6).fill(3000));
  for (const { request } of sent) expect(Object.keys(request.headers).some((h) => /^origin$/i.test(h))).toBe(false);
});

test('as it leaves Node: three GETs the host takes, none of them a page\'s', async () => {
  const host = await startHost();
  try {
    for (const route of READS) host.state.routes[`/racing-desk/data/${route}`] = { status: 200, body: JSON.stringify(HELD[route]) };
    const rig = createRigApi({ host: host.url });
    expect(await rig.read()).toEqual({ cars: { value: CARS }, views: { value: VIEWS }, pedals: { value: PEDALS } });
    expect(host.state.asked.map((a) => `${a.method} ${a.url}`).sort()).toEqual([
      'GET /racing-desk/data/cars', 'GET /racing-desk/data/pedals', 'GET /racing-desk/data/views',
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
  expect(await older.read()).toEqual({ cars: { value: CARS }, views: { missing: true }, pedals: { missing: true } });
  const half = createRigApi({ host: 'http://localhost:8889', send: reader({ cars: CARS, views: VIEWS }).send });
  expect(await half.read()).toEqual({ cars: { value: CARS }, views: { value: VIEWS }, pedals: { missing: true } });
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
    return { status: 200, text: JSON.stringify(CARS) };
  });
  const rig = createRigApi({ host: 'http://localhost:8889', send: sendRequest });
  expect(await rig.read()).toEqual({
    cars: { value: CARS },
    views: { error: 'Nothing is answering at http://localhost:8889.' },
    pedals: { error: 'The host answered, but not with JSON.' },
  });
});

test('a host on another machine is asked nothing', async () => {
  for (const elsewhere of ['http://192.168.1.20:8889', 'http://rig.local:8889', 'http://localhost.example.com:8889']) {
    const { sent, send: sendRequest } = reader();
    const rig = createRigApi({ host: elsewhere, send: sendRequest });
    const error = `The host at ${elsewhere} is not on this machine, so nothing was asked of it.`;
    expect(await rig.read(), elsewhere).toEqual({ cars: { error }, views: { error }, pedals: { error } });
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
  expect(await createRigApi({ host: url }).read()).toEqual({ cars: nothing, views: nothing, pedals: nothing });

  const nowhere = { error: 'There is no local host to ask.' };
  expect(unread(nowhere.error)).toEqual({ cars: nowhere, views: nowhere, pedals: nowhere });
  expect(await createRigApi({ host: () => null }).read()).toEqual(unread(nowhere.error));
  expect(await createRigApi({ host: () => { throw new Error('no settings'); } }).read()).toEqual(unread(nowhere.error));
  expect(await createRigApi().read()).toEqual(unread(nowhere.error));

  const slow = await startHost();
  try {
    slow.state.answer = { status: 200, body: '[]', delayMs: 5000 };
    const started = Date.now();
    const late = { error: `The host at ${slow.url} did not answer within 0.15 s.` };
    expect(await createRigApi({ host: slow.url, timeoutMs: 150 }).read()).toEqual({ cars: late, views: late, pedals: late });
    expect(Date.now() - started).toBeLessThan(2000);
  } finally {
    await slow.close();
  }

  const thrown = createRigApi({ host: 'http://localhost:8889', send: () => { throw new Error('thrown before any promise'); } });
  const why = { error: 'The host at http://localhost:8889 could not be asked: thrown before any promise' };
  expect(await thrown.read()).toEqual({ cars: why, views: why, pedals: why });
});
