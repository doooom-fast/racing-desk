/**
 * Car names from the local store: GET <host>/racing-desk/data/cars, against a stand-in host on 127.0.0.1 — a good
 * answer is kept for a minute, and anything else (no host, a host without the route, rubbish, a slow answer) is an
 * empty list rather than an error, and is asked for again next time.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import http from 'node:http';

const require = createRequire(import.meta.url);
const { createCarNames, getJson, CARS_PATH, TIMEOUT_MS, KEEP_MS } = require('../../modules/js/paints/car-names.js');

const ROWS = [
  { car_path: 'mx5 mx52016', name: 'Mazda MX-5 Cup', short_name: 'MX-5 Cup', car_id: 67, driven: 668, seen: 702 },
  { car_path: 'lotus79', name: 'Lotus 79', short_name: 'Lotus 79', car_id: 42, driven: 41, seen: 44 },
];

// A host whose answer the test sets: { status, body, delayMs }. Counts what it was asked.
function startHost() {
  const state = { answer: { status: 200, body: JSON.stringify(ROWS) }, asked: [] };
  const server = http.createServer((req, res) => {
    state.asked.push(req.url);
    const { status, body, delayMs = 0 } = state.answer;
    const timer = setTimeout(() => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(body);
    }, delayMs);
    res.on('close', () => clearTimeout(timer));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    state,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((done) => { server.closeAllConnections(); server.close(done); }),
  })));
}

let host;
test.beforeEach(async () => { host = await startHost(); });
test.afterEach(async () => { await host.close(); });

test('the contract: the store\'s rows from /racing-desk/data/cars, 3 s, kept a minute', async () => {
  expect(CARS_PATH).toBe('/racing-desk/data/cars');
  expect(TIMEOUT_MS).toBe(3000);
  expect(KEEP_MS).toBe(60000);
  const carNames = createCarNames({ host: () => `${host.url}/` });   // a trailing slash is not doubled
  expect(await carNames()).toEqual(ROWS);
  expect(host.state.asked).toEqual(['/racing-desk/data/cars']);
});

test('a good answer is kept for a minute, then asked for again', async () => {
  let clock = 1000;
  const carNames = createCarNames({ host: host.url, now: () => clock });
  expect(await carNames()).toEqual(ROWS);
  host.state.answer = { status: 200, body: JSON.stringify([ROWS[0]]) };
  clock += 59999;
  expect(await carNames()).toEqual(ROWS);
  expect(host.state.asked).toHaveLength(1);
  clock += 1;
  expect(await carNames()).toEqual([ROWS[0]]);
  expect(host.state.asked).toHaveLength(2);
});

test('what was kept is one host\'s: when the app\'s host moves, the new one is asked', async () => {
  const other = await startHost();
  try {
    other.state.answer = { status: 200, body: JSON.stringify([ROWS[1]]) };
    let where = host.url;
    const carNames = createCarNames({ host: () => where });
    expect(await carNames()).toEqual(ROWS);
    where = other.url;
    expect(await carNames()).toEqual([ROWS[1]]);
    expect(other.state.asked).toHaveLength(1);
  } finally {
    await other.close();
  }
});

test('anything but a list of rows is an empty list, and is not kept', async () => {
  const carNames = createCarNames({ host: host.url });
  for (const answer of [
    { status: 404, body: JSON.stringify({ error: 'unknown data route' }) },   // a host from before the route
    { status: 500, body: 'boom' },
    { status: 200, body: '{ not json' },
    { status: 200, body: JSON.stringify({ cars: ROWS }) },
    { status: 200, body: '' },
  ]) {
    host.state.answer = answer;
    expect(await carNames(), JSON.stringify(answer)).toEqual([]);
  }
  expect(host.state.asked).toHaveLength(5);
  // The host comes good: the very next call has the names.
  host.state.answer = { status: 200, body: JSON.stringify(ROWS) };
  expect(await carNames()).toEqual(ROWS);
});

test('an empty list is an answer, and is not kept: a store that has met no car yet is asked again', async () => {
  const carNames = createCarNames({ host: host.url });
  host.state.answer = { status: 200, body: '[]' };
  expect(await carNames()).toEqual([]);
  host.state.answer = { status: 200, body: JSON.stringify(ROWS) };
  expect(await carNames()).toEqual(ROWS);
  expect(host.state.asked).toHaveLength(2);
});

test('calls made while one is on its way share its answer: a path being typed asks the host once', async () => {
  host.state.answer = { status: 200, body: JSON.stringify(ROWS), delayMs: 200 };
  const carNames = createCarNames({ host: host.url });
  const answers = await Promise.all(Array.from({ length: 12 }, () => carNames()));
  for (const rows of answers) expect(rows).toEqual(ROWS);
  expect(host.state.asked).toHaveLength(1);

  // A failure is shared the same way, and the call after it asks again.
  const other = createCarNames({ host: host.url, timeoutMs: 100 });
  host.state.asked.length = 0;
  host.state.answer = { status: 200, body: JSON.stringify(ROWS), delayMs: 2000 };
  expect(await Promise.all([other(), other(), other()])).toEqual([[], [], []]);
  expect(host.state.asked).toHaveLength(1);
  host.state.answer = { status: 200, body: JSON.stringify(ROWS) };
  expect(await other()).toEqual(ROWS);
  expect(host.state.asked).toHaveLength(2);
});

test('rows that are not rows are dropped from a list that is one', async () => {
  host.state.answer = { status: 200, body: JSON.stringify([ROWS[0], null, 'lotus79', { name: 'No path' }, { car_path: 7 }, ROWS[1]]) };
  expect(await createCarNames({ host: host.url })()).toEqual(ROWS);
});

test('no host answering is an empty list', async () => {
  const gone = await startHost();
  const url = gone.url;
  await gone.close();
  expect(await createCarNames({ host: url })()).toEqual([]);
  // Nowhere to ask, or a host that cannot be worked out, is the same.
  expect(await createCarNames({ host: () => null })()).toEqual([]);
  expect(await createCarNames({ host: '' })()).toEqual([]);
  expect(await createCarNames({ host: () => { throw new Error('no settings'); } })()).toEqual([]);
  expect(await createCarNames()()).toEqual([]);
});

test('a host that takes too long is given up on at the limit', async () => {
  host.state.answer = { status: 200, body: JSON.stringify(ROWS), delayMs: 5000 };
  const carNames = createCarNames({ host: host.url, timeoutMs: 150 });
  const started = Date.now();
  expect(await carNames()).toEqual([]);
  expect(Date.now() - started).toBeLessThan(2000);
  await expect(getJson(`${host.url}${CARS_PATH}`, 150)).rejects.toThrow(/timeout/);
});
