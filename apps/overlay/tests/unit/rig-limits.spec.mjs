/**
 * What the rig's hardware is set to, for the HUD's datastream (modules/js/rig-limits.js): the brake force the pedals are
 * at, asked of the app's host by the main process — on the HUD keeper's poll, in the car, every two seconds at most — and
 * told to the page as it changes. Nothing is read from the pedals and nothing is made up: a host that does not answer, or
 * answers with no force, is "not known". The wheel's number is the telemetry's own (DS.SteerMaxForceNm), and the page's
 * rows for both are in datastream-limits.spec.mjs.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import http from 'node:http';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const limits = require('../../modules/js/rig-limits.js');
const { readAnswer, readWheelAnswer, told, fetchBrakeForce, fetchWheelMax, createRigLimits, BRAKE_FORCE_PATH, WHEEL_MAX_PATH, NOT_KNOWN } = limits;

const IN_CAR = { 'DataCorePlugin.GameRunning': 1, 'RacingDesk.Plugin.Grid.SessionState': 4, 'DataCorePlugin.GameRawData.Telemetry.IsOnTrack': 1 };
const OUT = { 'DataCorePlugin.GameRunning': 1, 'RacingDesk.Plugin.Grid.SessionState': 4, 'DataCorePlugin.GameRawData.Telemetry.IsOnTrack': 0 };

test.describe('the host\'s answer, as the page is told it', () => {
  test('a force in kg and the car; not known for anything else', () => {
    expect(readAnswer({ car: 'mx5 mx52016', force_kg: 45 })).toEqual({ brakeKg: 45, car: 'mx5 mx52016', brakeWhy: null });
    expect(readAnswer({ car: 'mx5 mx52016', force_kg: 0 })).toEqual({ brakeKg: 0, car: 'mx5 mx52016', brakeWhy: null });
    expect(readAnswer({ car: 'hondacivictyper', force_kg: null })).toEqual({ brakeKg: null, car: 'hondacivictyper', brakeWhy: null });
    expect(readAnswer({ car: null, force_kg: null })).toEqual({ brakeKg: null, car: null, brakeWhy: null });
    expect(readAnswer({ car: 'x', force_kg: '45' })).toEqual({ brakeKg: null, car: 'x', brakeWhy: null });
    expect(readAnswer({ car: 'x', force_kg: -5 })).toEqual({ brakeKg: null, car: 'x', brakeWhy: null });
    expect(readAnswer({ car: 'x', force_kg: NaN })).toEqual({ brakeKg: null, car: 'x', brakeWhy: null });
    expect(readAnswer({ car: 7, force_kg: 45 })).toEqual({ brakeKg: 45, car: null, brakeWhy: null });
    expect(readAnswer(null)).toEqual({ brakeKg: null, car: null, brakeWhy: null });
    expect(readAnswer([45])).toEqual({ brakeKg: null, car: null, brakeWhy: null });
    expect(readAnswer('45')).toEqual({ brakeKg: null, car: null, brakeWhy: null });
    // Why it is not known, in the host's own words (BrakeForceNow): one of them, and only beside no number.
    expect(readAnswer({ car: 'x', force_kg: null, why: 'held' })).toEqual({ brakeKg: null, car: 'x', brakeWhy: 'held' });
    expect(readAnswer({ car: null, force_kg: null, why: 'no-car' })).toEqual({ brakeKg: null, car: null, brakeWhy: 'no-car' });
    expect(readAnswer({ car: 'x', force_kg: 45, why: 'held' })).toEqual({ brakeKg: 45, car: 'x', brakeWhy: null });
    for (const why of ['Held', 'because', 7, '', null]) {
      expect(readAnswer({ car: 'x', force_kg: null, why }).brakeWhy, String(why)).toBeNull();
    }
    expect(NOT_KNOWN).toEqual({ brakeKg: null, car: null, wheelNm: null, wheelSource: null, brakeWhy: null });
    expect(BRAKE_FORCE_PATH).toBe('/racing-desk/data/brakeforce');
    expect(WHEEL_MAX_PATH).toBe('/racing-desk/data/wheelmax');
  });

  test('a maximum torque above nought in Nm and where it came from; not known for anything else', () => {
    expect(readWheelAnswer({ source: 'pithouse', model: 'R21 Ultra', max_pct: 55, rated_nm: 21, max_nm: 11.55, candidates: 2 })).toEqual({ wheelNm: 11.55, wheelSource: 'pithouse' });
    expect(readWheelAnswer({ source: 'base', max_nm: 9 })).toEqual({ wheelNm: 9, wheelSource: 'base' });
    expect(readWheelAnswer({ source: 'somewhere', max_nm: 9 })).toEqual({ wheelNm: 9, wheelSource: null });
    for (const body of [{ source: null, max_nm: null }, { max_nm: 0 }, { max_nm: -3 }, { max_nm: '9' }, { max_nm: NaN }, { max_nm: Infinity }, {}, null, [9], '9', 9]) {
      expect(readWheelAnswer(body), JSON.stringify(body)).toEqual({ wheelNm: null, wheelSource: null });
    }
    // The base's max torque in per cent is not a number of Nm: only max_nm is read.
    expect(readWheelAnswer({ source: 'pithouse', max_pct: 55, rated_nm: null, max_nm: null })).toEqual({ wheelNm: null, wheelSource: null });
  });

  test('what the fetch resolved is checked in the page\'s shape, not read as the host\'s again', () => {
    expect(told({ brakeKg: 45, car: 'mx5 mx52016' })).toEqual({ brakeKg: 45, car: 'mx5 mx52016', wheelNm: null, wheelSource: null, brakeWhy: null });
    expect(told({ brakeKg: 0, car: 'x' })).toEqual({ brakeKg: 0, car: 'x', wheelNm: null, wheelSource: null, brakeWhy: null });
    expect(told({ brakeKg: null, car: 'x' })).toEqual({ brakeKg: null, car: 'x', wheelNm: null, wheelSource: null, brakeWhy: null });
    expect(told({ brakeKg: -1, car: 'x' })).toEqual({ brakeKg: null, car: 'x', wheelNm: null, wheelSource: null, brakeWhy: null });
    expect(told({ brakeKg: '45', car: 'x' })).toEqual({ brakeKg: null, car: 'x', wheelNm: null, wheelSource: null, brakeWhy: null });
    expect(told({ ...readAnswer({ car: 'mx5 mx52016', force_kg: 45 }), ...readWheelAnswer({ source: 'base', max_nm: 9 }) })).toEqual({ brakeKg: 45, car: 'mx5 mx52016', wheelNm: 9, wheelSource: 'base', brakeWhy: null });
    expect(told({ brakeKg: 45, car: 'x', wheelNm: 0, wheelSource: 'base', brakeWhy: null })).toEqual({ brakeKg: 45, car: 'x', wheelNm: null, wheelSource: null, brakeWhy: null });
    expect(told({ brakeKg: 45, car: 'x', wheelNm: '9', wheelSource: 'base', brakeWhy: null }).wheelNm).toBeNull();
    expect(told({ brakeKg: 45, car: 'x', wheelNm: 9, wheelSource: 'elsewhere', brakeWhy: null })).toEqual({ brakeKg: 45, car: 'x', wheelNm: 9, wheelSource: null, brakeWhy: null });
    expect(told(null)).toEqual({ brakeKg: null, car: null, wheelNm: null, wheelSource: null, brakeWhy: null });
    expect(told([45])).toEqual({ brakeKg: null, car: null, wheelNm: null, wheelSource: null, brakeWhy: null });
    expect(told({ brakeKg: null, car: 'x', brakeWhy: 'live-off' }).brakeWhy).toBe('live-off');
    expect(told({ brakeKg: 45, car: 'x', brakeWhy: 'live-off' }).brakeWhy).toBeNull();
    expect(told({ brakeKg: null, car: 'x', brakeWhy: 'gremlins' }).brakeWhy).toBeNull();
  });
});

// A stand-in host on 127.0.0.1 that answers whatever it is told to, and records what it was asked.
function startHost(answer) {
  const state = { asked: [], answer };
  const server = http.createServer((req, res) => {
    state.asked.push({ url: req.url, headers: req.headers });
    const a = typeof state.answer === 'function' ? state.answer(req) : state.answer;
    if (a === 'hang') return;
    res.writeHead(a.status || 200, { 'Content-Type': 'application/json' });
    res.end(typeof a.body === 'string' ? a.body : JSON.stringify(a.body));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    state, url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((done) => { server.closeAllConnections(); server.close(done); }),
  })));
}

test.describe('fetchBrakeForce: the request to the host, by Node', () => {
  test('is answered with the force, with a Host and nothing a browser sends', async () => {
    const host = await startHost({ body: { car: 'mx5 mx52016', force_kg: 45 } });
    try {
      expect(await fetchBrakeForce(host.url + BRAKE_FORCE_PATH)).toEqual({ brakeKg: 45, car: 'mx5 mx52016', brakeWhy: null });
      expect(host.state.asked).toHaveLength(1);
      expect(host.state.asked[0].url).toBe(BRAKE_FORCE_PATH);
      expect(host.state.asked[0].headers.host).toBe(host.url.replace('http://', ''));
      for (const name of ['origin', 'referer', 'sec-fetch-site', 'sec-fetch-dest', 'sec-fetch-user']) expect(host.state.asked[0].headers[name], name).toBeUndefined();
    } finally {
      await host.close();
    }
  });

  test('anything that is not an answer is not known: a refusal, no JSON, nothing listening, no answer in time', async () => {
    const host = await startHost({ status: 403, body: { error: 'this is for the app on this machine' } });
    try {
      expect(await fetchBrakeForce(host.url + BRAKE_FORCE_PATH)).toEqual({ brakeKg: null, car: null, brakeWhy: null });
      host.state.answer = { body: '{ not json' };
      expect(await fetchBrakeForce(host.url + BRAKE_FORCE_PATH)).toEqual({ brakeKg: null, car: null, brakeWhy: null });
      host.state.answer = 'hang';
      const started = Date.now();
      expect(await fetchBrakeForce(host.url + BRAKE_FORCE_PATH, { timeoutMs: 200 })).toEqual({ brakeKg: null, car: null, brakeWhy: null });
      expect(Date.now() - started).toBeLessThan(2000);
    } finally {
      await host.close();
    }
    expect(await fetchBrakeForce(`http://127.0.0.1:1${BRAKE_FORCE_PATH}`, { timeoutMs: 500 })).toEqual({ brakeKg: null, car: null, brakeWhy: null });
  });
});

test.describe('the keeper', () => {
  function keeper({ answer = { brakeKg: 45, car: 'mx5 mx52016' }, host = 'http://localhost:18889', everyMs = 2000 } = {}) {
    const calls = { fetched: [], sent: [], logged: [] };
    let clock = 1000;
    const k = createRigLimits({
      host: () => host,
      send: (l) => calls.sent.push(l),
      fetch: async (url) => { calls.fetched.push(url); const a = typeof answer === 'function' ? answer() : answer; if (a instanceof Error) throw a; return a; },
      now: () => clock,
      everyMs,
      log: (line) => calls.logged.push(line),
    });
    return { k, calls, tick: (ms) => { clock += ms; } };
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

  test('in the car the host is asked, once every two seconds, and the page told when the answer changes', async () => {
    const { k, calls, tick } = keeper();
    expect(k.current()).toEqual({ brakeKg: null, car: null, wheelNm: null, wheelSource: null, brakeWhy: null });

    k.feed(IN_CAR);
    await settle();
    expect(calls.fetched).toEqual(['http://localhost:18889/racing-desk/data/brakeforce']);
    expect(calls.sent).toEqual([{ brakeKg: 45, car: 'mx5 mx52016', wheelNm: null, wheelSource: null, brakeWhy: null }]);
    expect(k.current()).toEqual({ brakeKg: 45, car: 'mx5 mx52016', wheelNm: null, wheelSource: null, brakeWhy: null });

    // Half a second on: the same frame again, not asked again; the page is not told what it already knows.
    tick(500);
    k.feed(IN_CAR);
    await settle();
    expect(calls.fetched).toHaveLength(1);
    expect(calls.sent).toHaveLength(1);

    tick(2000);
    k.feed(IN_CAR);
    await settle();
    expect(calls.fetched).toHaveLength(2);
    expect(calls.sent).toHaveLength(1);
  });

  test('a change in the answer reaches the page; the current answer is kept for a page that loads after', async () => {
    let answer = { brakeKg: 45, car: 'mx5 mx52016' };
    const { k, calls, tick } = keeper({ answer: () => answer });
    k.feed(IN_CAR);
    await settle();
    answer = { brakeKg: 50, car: 'mx5 mx52016' };
    tick(2500);
    k.feed(IN_CAR);
    await settle();
    answer = { brakeKg: null, car: 'mx5 mx52016' };
    tick(2500);
    k.feed(IN_CAR);
    await settle();
    expect(calls.sent).toEqual([{ brakeKg: 45, car: 'mx5 mx52016', wheelNm: null, wheelSource: null, brakeWhy: null }, { brakeKg: 50, car: 'mx5 mx52016', wheelNm: null, wheelSource: null, brakeWhy: null }, { brakeKg: null, car: 'mx5 mx52016', wheelNm: null, wheelSource: null, brakeWhy: null }]);
    expect(k.current()).toEqual({ brakeKg: null, car: 'mx5 mx52016', wheelNm: null, wheelSource: null, brakeWhy: null });
  });

  test('out of the car nothing is asked, and the page is told not known', async () => {
    const { k, calls, tick } = keeper();
    k.feed(OUT);
    k.feed(null);
    await settle();
    expect(calls.fetched).toEqual([]);
    expect(calls.sent).toEqual([]);

    k.feed(IN_CAR);
    await settle();
    expect(calls.sent).toEqual([{ brakeKg: 45, car: 'mx5 mx52016', wheelNm: null, wheelSource: null, brakeWhy: null }]);
    tick(2500);
    k.feed(OUT);
    await settle();
    expect(calls.fetched).toHaveLength(1);
    expect(calls.sent).toEqual([{ brakeKg: 45, car: 'mx5 mx52016', wheelNm: null, wheelSource: null, brakeWhy: null }, { brakeKg: null, car: null, wheelNm: null, wheelSource: null, brakeWhy: null }]);
    expect(k.current()).toEqual({ brakeKg: null, car: null, wheelNm: null, wheelSource: null, brakeWhy: null });
  });

  function pendingKeeper() {
    let host = 'http://localhost:18889';
    let clock = 1000;
    const pending = [];
    const sent = [];
    const k = createRigLimits({
      host: () => host, now: () => clock, send: (value) => sent.push(value),
      fetch: (url) => new Promise((resolve, reject) => pending.push({ url, resolve, reject })),
    });
    return { k, pending, sent, moveHost: (value) => { host = value; }, tick: (ms) => { clock += ms; } };
  }
  const READING = { brakeKg: 45, car: 'mx5 mx52016', wheelNm: 11.55, wheelSource: 'pithouse', brakeWhy: null };
  const FRAME = {
    ...IN_CAR,
    'RacingDesk.Plugin.GameId': 'iRacing',
    'RacingDesk.Plugin.CarControls': { car: 'mx5 mx52016' },
    'DataCorePlugin.GameData.CarModel': 'Mazda MX-5',
    'DataCorePlugin.GameRawData.Telemetry.SessionNum': 0,
    'RacingDesk.Plugin.SessionTypeName': 'Practice',
    'RacingDesk.Plugin.Session.TrackName': 'Okayama',
  };

  for (const exit of [OUT, null]) {
    test(`a late reply cannot restore readings after ${exit ? 'leaving the car' : 'losing telemetry'}`, async () => {
      const { k, pending, sent, tick } = pendingKeeper();
      k.feed(FRAME);
      pending[0].resolve(READING);
      await settle();
      tick(2500);
      k.feed(FRAME);
      k.feed(exit);
      expect(k.current()).toEqual(NOT_KNOWN);
      pending[1].resolve(READING);
      await settle();
      expect(k.current()).toEqual(NOT_KNOWN);
      expect(sent).toEqual([READING, NOT_KNOWN]);
    });
  }

  const changes = [
    ['car path', { 'RacingDesk.Plugin.CarControls': { car: 'porsche963' } }],
    ['car model without controls', { 'RacingDesk.Plugin.CarControls': null, 'DataCorePlugin.GameData.CarModel': 'Porsche 963' }],
    ['session number', { 'DataCorePlugin.GameRawData.Telemetry.SessionNum': 1 }],
    ['session name without number', { 'DataCorePlugin.GameRawData.Telemetry.SessionNum': null, 'RacingDesk.Plugin.SessionTypeName': 'Race' }],
    ['track', { 'RacingDesk.Plugin.Session.TrackName': 'Spa' }],
    ['sim', { 'RacingDesk.Plugin.GameId': 'AssettoCorsa' }],
    ['demo', { 'RacingDesk.Plugin.DemoMode': 1 }],
  ];
  for (const [name, change] of changes) {
    test(`a changed ${name} clears cached readings and ignores the old request`, async () => {
      const { k, pending, tick } = pendingKeeper();
      k.feed(FRAME);
      pending[0].resolve(READING);
      await settle();
      tick(2500);
      k.feed(FRAME);
      const next = { ...FRAME, ...change };
      k.feed(next);
      expect(k.current()).toEqual(NOT_KNOWN);
      expect(pending).toHaveLength(3);
      pending[1].resolve(READING);
      await settle();
      expect(k.current()).toEqual(NOT_KNOWN);
      // The old request's finally must not release the new request's in-flight guard.
      tick(2500);
      k.feed(next);
      expect(pending).toHaveLength(3);
      // The answer is for the car the new frame names (the host follows the car as the sim does).
      pending[2].resolve({ ...READING, brakeKg: 80, car: name === 'car path' ? 'porsche963' : READING.car });
      await settle();
      // Another sim is not the host's to follow: its brake force is not known, and the page is told why.
      if (name === 'sim') expect([k.current().brakeKg, k.current().brakeWhy, k.current().wheelNm]).toEqual([null, 'iracing-only', 11.55]);
      else expect(k.current().brakeKg).toBe(80);
    });
  }

  test('in another sim the brake force is not told, whatever the host says; the wheel\'s maximum is', async () => {
    for (const game of ['AssettoCorsa', 'AssettoCorsaEVO', 'acc']) {
      const { k, pending } = pendingKeeper();
      k.feed({ ...FRAME, 'RacingDesk.Plugin.GameId': game });
      pending[0].resolve(READING);
      await settle();
      expect(k.current(), game).toEqual({ brakeKg: null, car: null, brakeWhy: 'iracing-only', wheelNm: 11.55, wheelSource: 'pithouse' });
    }
    for (const game of ['iRacing', 'IRacing', '', undefined]) {
      const { k, pending } = pendingKeeper();
      k.feed({ ...FRAME, 'RacingDesk.Plugin.GameId': game });
      pending[0].resolve(READING);
      await settle();
      expect(k.current(), String(game)).toEqual(READING);
    }
  });

  test('a force the host gives for another car than the telemetry names is not told; the car list\'s spelling is the same car', async () => {
    const other = pendingKeeper();
    other.k.feed(FRAME);
    other.pending[0].resolve({ ...READING, car: 'porsche963gtp' });
    await settle();
    expect(other.k.current()).toEqual({ brakeKg: null, car: null, brakeWhy: null, wheelNm: 11.55, wheelSource: 'pithouse' });

    const same = pendingKeeper();
    same.k.feed({ ...FRAME, 'RacingDesk.Plugin.CarControls': { car: 'MX5-mx52016' } });
    same.pending[0].resolve(READING);
    await settle();
    expect(same.k.current()).toEqual(READING);

    // A car the list does not have names no folder in the telemetry: the host's answer stands as it is.
    const unlisted = pendingKeeper();
    unlisted.k.feed({ ...FRAME, 'RacingDesk.Plugin.CarControls': null });
    unlisted.pending[0].resolve({ ...READING, car: 'somecar' });
    await settle();
    expect(unlisted.k.current().brakeKg).toBe(45);
  });

  test('the host\'s reason reaches the page while the force is not known, and goes when it is', async () => {
    let answer = { brakeKg: null, car: 'mx5 mx52016', brakeWhy: 'not-set' };
    const { k, calls, tick } = keeper({ answer: () => answer });
    k.feed(IN_CAR);
    await settle();
    answer = { brakeKg: null, car: 'mx5 mx52016', brakeWhy: 'live-off' };
    tick(2500);
    k.feed(IN_CAR);
    await settle();
    answer = { brakeKg: 50, car: 'mx5 mx52016', brakeWhy: null };
    tick(2500);
    k.feed(IN_CAR);
    await settle();
    expect(calls.sent.map((s) => [s.brakeKg, s.brakeWhy])).toEqual([[null, 'not-set'], [null, 'live-off'], [50, null]]);
  });

  test('returning to the same car asks immediately; an old failure cannot clear the new reading or delay its poll', async () => {
    const { k, pending, tick } = pendingKeeper();
    k.feed(FRAME);
    k.feed(OUT);
    k.feed(FRAME);
    expect(pending).toHaveLength(2);
    pending[1].resolve(READING);
    await settle();
    tick(2500);
    pending[0].reject(new Error('old host gone'));
    await settle();
    expect(k.current()).toEqual(READING);
    k.feed(FRAME);
    expect(pending).toHaveLength(3);
    pending[2].resolve(READING);
    await settle();
  });

  for (const host of ['http://localhost:8889', 'http://192.168.1.20:8889', null]) {
    test(`moving the host to ${host} invalidates an outstanding answer even before another frame`, async () => {
      const { k, pending, moveHost, tick } = pendingKeeper();
      k.feed(FRAME);
      pending[0].resolve(READING);
      await settle();
      tick(2500);
      k.feed(FRAME);
      moveHost(host);
      pending[1].resolve(READING);
      await settle();
      expect(k.current()).toEqual(NOT_KNOWN);
      k.feed(FRAME);
      expect(pending).toHaveLength(host === 'http://localhost:8889' ? 3 : 2);
      if (pending[2]) {
        expect(pending[2].url).toBe(host + BRAKE_FORCE_PATH);
        pending[2].resolve(READING);
        await settle();
      }
    });
  }

  test('changing controls and session state is not a new context; object and wire-text controls agree', async () => {
    const { k, pending, tick } = pendingKeeper();
    k.feed(FRAME);
    const next = {
      ...FRAME,
      'RacingDesk.Plugin.CarControls': JSON.stringify({ car: 'mx5 mx52016', bb: { value: 53 } }),
      'RacingDesk.Plugin.Grid.SessionState': 5,
    };
    tick(2500);
    k.feed(next);
    expect(pending).toHaveLength(1);
    pending[0].resolve(READING);
    await settle();
    expect(k.current()).toEqual(READING);
    k.feed(next);
    expect(pending).toHaveLength(1);
  });

  test('a late success from the old host cannot overwrite the new host, even after moving back', async () => {
    const { k, pending, moveHost } = pendingKeeper();
    k.feed(FRAME);
    moveHost('http://localhost:8889');
    k.feed(FRAME);
    moveHost('http://localhost:18889');
    k.feed(FRAME);
    expect(pending).toHaveLength(3);
    pending[2].resolve(READING);
    await settle();
    pending[0].resolve({ ...READING, brakeKg: 80 });
    pending[1].reject(new Error('old host gone'));
    await settle();
    expect(k.current()).toEqual(READING);
  });

  test('a host change on a frame clears the cache without waiting for the poll interval', async () => {
    const { k, pending, moveHost } = pendingKeeper();
    k.feed(FRAME);
    pending[0].resolve(READING);
    await settle();
    moveHost('http://localhost:8889');
    k.feed(FRAME);
    expect(k.current()).toEqual(NOT_KNOWN);
    expect(pending).toHaveLength(2);
    pending[1].resolve(READING);
    await settle();
    expect(k.current()).toEqual(READING);
  });

  test('a host that does not answer, or answers with no force, is not known — never a number', async () => {
    const { k, calls, tick } = keeper({ answer: () => new Error('ECONNREFUSED') });
    k.feed(IN_CAR);
    await settle();
    expect(calls.sent).toEqual([]);
    expect(k.current()).toEqual({ brakeKg: null, car: null, wheelNm: null, wheelSource: null, brakeWhy: null });

    const known = keeper({ answer: { brakeKg: null, car: 'hondacivictyper' } });
    known.k.feed(IN_CAR);
    await settle();
    expect(known.calls.sent).toEqual([{ brakeKg: null, car: 'hondacivictyper', wheelNm: null, wheelSource: null, brakeWhy: null }]);
    expect(known.k.current().brakeKg).toBeNull();
    tick(0);
  });

  test('a host that is not on this machine is not asked (it would refuse), said once', async () => {
    const { k, calls, tick } = keeper({ host: 'http://192.168.1.20:8889' });
    k.feed(IN_CAR);
    tick(2500);
    k.feed(IN_CAR);
    await settle();
    expect(calls.fetched).toEqual([]);
    expect(calls.sent).toEqual([]);
    expect(calls.logged.filter((l) => /not on this machine/.test(l))).toHaveLength(1);
    expect(calls.logged.join('\n')).not.toContain('Origin');
  });

  // The keeper as main.js makes it — its own fetch (fetchBrakeForce), not a stand-in — against a host on 127.0.0.1 that
  // answers as LocalDataApi does ({ car, force_kg }): the force reaches the page. (The host's answer was once read a
  // second time as the host's, and every force came out "not known".)
  test('with its own fetch, the host\'s reason reaches the page as its word', async () => {
    const host = await startHost({ body: { car: 'mx5 mx52016', force_kg: null, why: 'held' } });
    try {
      const sent = [];
      const k = createRigLimits({ host: () => host.url, send: (l) => sent.push(l), now: () => 0 });
      k.feed(IN_CAR);
      await expect.poll(() => sent.length, { timeout: 3000 }).toBe(1);
      expect([sent[0].brakeKg, sent[0].brakeWhy]).toEqual([null, 'held']);
    } finally {
      await host.close();
    }
  });

  test('with its own fetch, the host\'s force reaches the page', async () => {
    const host = await startHost({ body: { car: 'mx5 mx52016', force_kg: 45 } });
    try {
      const sent = [];
      let clock = 0;
      const k = createRigLimits({ host: () => host.url, send: (l) => sent.push(l), now: () => clock });
      k.feed(IN_CAR);
      await expect.poll(() => sent.length, { timeout: 3000 }).toBe(1);
      expect(sent).toEqual([{ brakeKg: 45, car: 'mx5 mx52016', wheelNm: null, wheelSource: null, brakeWhy: null }]);
      expect(k.current()).toEqual({ brakeKg: 45, car: 'mx5 mx52016', wheelNm: null, wheelSource: null, brakeWhy: null });
      // Both routes are asked; this stand-in answers the one body to each, and a body with no max_nm is no torque.
      expect(host.state.asked.map((a) => a.url).sort()).toEqual([BRAKE_FORCE_PATH, WHEEL_MAX_PATH]);

      host.state.answer = { body: { car: 'mx5 mx52016', force_kg: null } };
      clock += 2500;
      k.feed(IN_CAR);
      await expect.poll(() => sent.length, { timeout: 3000 }).toBe(2);
      expect(sent[1]).toEqual({ brakeKg: null, car: 'mx5 mx52016', wheelNm: null, wheelSource: null, brakeWhy: null });
    } finally {
      await host.close();
    }
  });

  // The wheel's maximum is the host's other route, asked beside the force and told with it.
  test('with its own fetch, the wheel\'s maximum is asked beside the force, and each is not known without the other', async () => {
    const host = await startHost({ body: {} });
    const answers = {
      [BRAKE_FORCE_PATH]: { car: 'mx5 mx52016', force_kg: 45 },
      [WHEEL_MAX_PATH]: { source: 'pithouse', model: 'R21 Ultra', max_pct: 55, rated_nm: 21, max_nm: 11.55, candidates: 2 },
    };
    host.state.answer = (req) => ({ body: answers[req.url] });
    try {
      const sent = [];
      let clock = 0;
      const k = createRigLimits({ host: () => host.url, send: (l) => sent.push(l), now: () => clock });
      k.feed(IN_CAR);
      await expect.poll(() => sent.length, { timeout: 3000 }).toBe(1);
      expect(sent[0]).toEqual({ brakeKg: 45, car: 'mx5 mx52016', wheelNm: 11.55, wheelSource: 'pithouse', brakeWhy: null });
      expect(host.state.asked.map((a) => a.url).sort()).toEqual([BRAKE_FORCE_PATH, WHEEL_MAX_PATH]);
      for (const a of host.state.asked) for (const name of ['origin', 'referer', 'sec-fetch-site']) expect(a.headers[name], name).toBeUndefined();

      // The wheel's route stops answering (a 404 from an older host): the force stays, the wheel is not known.
      answers[WHEEL_MAX_PATH] = undefined;
      host.state.answer = (req) => (answers[req.url] ? { body: answers[req.url] } : { status: 404, body: { error: 'unknown data route' } });
      clock += 2500;
      k.feed(IN_CAR);
      await expect.poll(() => sent.length, { timeout: 3000 }).toBe(2);
      expect(sent[1]).toEqual({ brakeKg: 45, car: 'mx5 mx52016', wheelNm: null, wheelSource: null, brakeWhy: null });

      // The wheel's answers again with another number: told as it changes, the force untouched.
      answers[WHEEL_MAX_PATH] = { source: 'base', model: 'R21', max_pct: 40, rated_nm: 21, max_nm: 8.4, candidates: 1 };
      clock += 2500;
      k.feed(IN_CAR);
      await expect.poll(() => sent.length, { timeout: 3000 }).toBe(3);
      expect(sent[2]).toEqual({ brakeKg: 45, car: 'mx5 mx52016', wheelNm: 8.4, wheelSource: 'base', brakeWhy: null });
    } finally {
      await host.close();
    }
  });

  test('a stand-in that says nothing of the wheel leaves it not known; a wheel that changes is told', async () => {
    let answer = { brakeKg: 45, car: 'mx5 mx52016', wheelNm: 11.55, wheelSource: 'pithouse', brakeWhy: null };
    const { k, calls, tick } = keeper({ answer: () => answer });
    k.feed(IN_CAR);
    await settle();
    answer = { brakeKg: 45, car: 'mx5 mx52016', wheelNm: 8.4, wheelSource: 'base', brakeWhy: null };
    tick(2500);
    k.feed(IN_CAR);
    await settle();
    answer = { brakeKg: 45, car: 'mx5 mx52016', wheelNm: 8.4, wheelSource: 'base', brakeWhy: null };
    tick(2500);
    k.feed(IN_CAR);
    await settle();
    expect(calls.sent).toEqual([
      { brakeKg: 45, car: 'mx5 mx52016', wheelNm: 11.55, wheelSource: 'pithouse', brakeWhy: null },
      { brakeKg: 45, car: 'mx5 mx52016', wheelNm: 8.4, wheelSource: 'base', brakeWhy: null },
    ]);
  });

  test('a page that cannot be told does not stop the keeper', async () => {
    const calls = [];
    let clock = 0;
    const k = createRigLimits({ host: () => 'http://localhost:8889', send: () => { throw new Error('gone'); }, fetch: async () => ({ brakeKg: 1, car: 'x' }), now: () => clock, log: (l) => calls.push(l) });
    k.feed(IN_CAR);
    await settle();
    expect(k.current()).toEqual({ brakeKg: 1, car: 'x', wheelNm: null, wheelSource: null, brakeWhy: null });
    expect(calls.some((l) => /could not be told/.test(l))).toBe(true);
  });
});

test.describe('main.js and the preload', () => {
  const main = readFileSync(new URL('../../main.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  const preload = readFileSync(new URL('../../preload.js', import.meta.url), 'utf8');

  test('the keeper is fed the HUD keeper\'s own poll, asks the app\'s host, and answers the page by one channel', () => {
    expect(main).toMatch(/const rigLimits = rigLimitsMod\.createRigLimits\(\{\s*host:\s*\(\)\s*=>\s*localHostUrl\(\),/);
    expect(main).toMatch(/livery\.feed\(payload\);\s*recording\.feed\(payload\);\s*rigLimits\.feed\(payload\);/);
    expect(main).toMatch(/ipcMain\.handle\('get-rig-limits',\s*async\s*\(\)\s*=>\s*rigLimits\.current\(\)\);/);
    expect(main).toMatch(/overlayWindow\.webContents\.send\('rig-limits', limits\)/);
    expect(main.match(/rigLimits\.feed\(/g)).toHaveLength(1);
    expect(preload).toMatch(/onRigLimits:\s*\(callback\)\s*=>\s*\{\s*ipcRenderer\.on\('rig-limits',/);
    expect(preload).toMatch(/getRigLimits:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('get-rig-limits'\)/);
  });

  test('no page asks the host for it, and no script of the page fetches the route', () => {
    for (const file of ['datastream.js', 'poll-engine.js', 'car-controls.js']) {
      const text = readFileSync(new URL(`../../modules/js/${file}`, import.meta.url), 'utf8');
      expect(text, file).not.toContain('/racing-desk/data/brakeforce');
      expect(text, file).not.toContain('/racing-desk/data/wheelmax');
    }
  });
});
