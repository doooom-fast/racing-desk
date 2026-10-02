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
const { readAnswer, told, fetchBrakeForce, createRigLimits, BRAKE_FORCE_PATH, NOT_KNOWN } = limits;

const IN_CAR = { 'DataCorePlugin.GameRunning': 1, 'RacingDesk.Plugin.Grid.SessionState': 4, 'DataCorePlugin.GameRawData.Telemetry.IsOnTrack': 1 };
const OUT = { 'DataCorePlugin.GameRunning': 1, 'RacingDesk.Plugin.Grid.SessionState': 4, 'DataCorePlugin.GameRawData.Telemetry.IsOnTrack': 0 };

test.describe('the host\'s answer, as the page is told it', () => {
  test('a force in kg and the car; not known for anything else', () => {
    expect(readAnswer({ car: 'mx5 mx52016', force_kg: 45 })).toEqual({ brakeKg: 45, car: 'mx5 mx52016' });
    expect(readAnswer({ car: 'mx5 mx52016', force_kg: 0 })).toEqual({ brakeKg: 0, car: 'mx5 mx52016' });
    expect(readAnswer({ car: 'hondacivictyper', force_kg: null })).toEqual({ brakeKg: null, car: 'hondacivictyper' });
    expect(readAnswer({ car: null, force_kg: null })).toEqual({ brakeKg: null, car: null });
    expect(readAnswer({ car: 'x', force_kg: '45' })).toEqual({ brakeKg: null, car: 'x' });
    expect(readAnswer({ car: 'x', force_kg: -5 })).toEqual({ brakeKg: null, car: 'x' });
    expect(readAnswer({ car: 'x', force_kg: NaN })).toEqual({ brakeKg: null, car: 'x' });
    expect(readAnswer({ car: 7, force_kg: 45 })).toEqual({ brakeKg: 45, car: null });
    expect(readAnswer(null)).toEqual({ brakeKg: null, car: null });
    expect(readAnswer([45])).toEqual({ brakeKg: null, car: null });
    expect(readAnswer('45')).toEqual({ brakeKg: null, car: null });
    expect(NOT_KNOWN).toEqual({ brakeKg: null, car: null });
    expect(BRAKE_FORCE_PATH).toBe('/racing-desk/data/brakeforce');
  });

  test('what the fetch resolved is checked in the page\'s shape, not read as the host\'s again', () => {
    expect(told({ brakeKg: 45, car: 'mx5 mx52016' })).toEqual({ brakeKg: 45, car: 'mx5 mx52016' });
    expect(told({ brakeKg: 0, car: 'x' })).toEqual({ brakeKg: 0, car: 'x' });
    expect(told({ brakeKg: null, car: 'x' })).toEqual({ brakeKg: null, car: 'x' });
    expect(told({ brakeKg: -1, car: 'x' })).toEqual({ brakeKg: null, car: 'x' });
    expect(told({ brakeKg: '45', car: 'x' })).toEqual({ brakeKg: null, car: 'x' });
    expect(told(readAnswer({ car: 'mx5 mx52016', force_kg: 45 }))).toEqual({ brakeKg: 45, car: 'mx5 mx52016' });
    expect(told(null)).toEqual({ brakeKg: null, car: null });
    expect(told([45])).toEqual({ brakeKg: null, car: null });
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
      expect(await fetchBrakeForce(host.url + BRAKE_FORCE_PATH)).toEqual({ brakeKg: 45, car: 'mx5 mx52016' });
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
      expect(await fetchBrakeForce(host.url + BRAKE_FORCE_PATH)).toEqual({ brakeKg: null, car: null });
      host.state.answer = { body: '{ not json' };
      expect(await fetchBrakeForce(host.url + BRAKE_FORCE_PATH)).toEqual({ brakeKg: null, car: null });
      host.state.answer = 'hang';
      const started = Date.now();
      expect(await fetchBrakeForce(host.url + BRAKE_FORCE_PATH, { timeoutMs: 200 })).toEqual({ brakeKg: null, car: null });
      expect(Date.now() - started).toBeLessThan(2000);
    } finally {
      await host.close();
    }
    expect(await fetchBrakeForce(`http://127.0.0.1:1${BRAKE_FORCE_PATH}`, { timeoutMs: 500 })).toEqual({ brakeKg: null, car: null });
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
    expect(k.current()).toEqual({ brakeKg: null, car: null });

    k.feed(IN_CAR);
    await settle();
    expect(calls.fetched).toEqual(['http://localhost:18889/racing-desk/data/brakeforce']);
    expect(calls.sent).toEqual([{ brakeKg: 45, car: 'mx5 mx52016' }]);
    expect(k.current()).toEqual({ brakeKg: 45, car: 'mx5 mx52016' });

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
    expect(calls.sent).toEqual([{ brakeKg: 45, car: 'mx5 mx52016' }, { brakeKg: 50, car: 'mx5 mx52016' }, { brakeKg: null, car: 'mx5 mx52016' }]);
    expect(k.current()).toEqual({ brakeKg: null, car: 'mx5 mx52016' });
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
    expect(calls.sent).toEqual([{ brakeKg: 45, car: 'mx5 mx52016' }]);
    tick(2500);
    k.feed(OUT);
    await settle();
    expect(calls.fetched).toHaveLength(1);
    expect(calls.sent).toEqual([{ brakeKg: 45, car: 'mx5 mx52016' }, { brakeKg: null, car: null }]);
    expect(k.current()).toEqual({ brakeKg: null, car: null });
  });

  test('a host that does not answer, or answers with no force, is not known — never a number', async () => {
    const { k, calls, tick } = keeper({ answer: () => new Error('ECONNREFUSED') });
    k.feed(IN_CAR);
    await settle();
    expect(calls.sent).toEqual([]);
    expect(k.current()).toEqual({ brakeKg: null, car: null });

    const known = keeper({ answer: { brakeKg: null, car: 'hondacivictyper' } });
    known.k.feed(IN_CAR);
    await settle();
    expect(known.calls.sent).toEqual([{ brakeKg: null, car: 'hondacivictyper' }]);
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
  test('with its own fetch, the host\'s force reaches the page', async () => {
    const host = await startHost({ body: { car: 'mx5 mx52016', force_kg: 45 } });
    try {
      const sent = [];
      let clock = 0;
      const k = createRigLimits({ host: () => host.url, send: (l) => sent.push(l), now: () => clock });
      k.feed(IN_CAR);
      await expect.poll(() => sent.length, { timeout: 3000 }).toBe(1);
      expect(sent).toEqual([{ brakeKg: 45, car: 'mx5 mx52016' }]);
      expect(k.current()).toEqual({ brakeKg: 45, car: 'mx5 mx52016' });
      expect(host.state.asked.map((a) => a.url)).toEqual([BRAKE_FORCE_PATH]);

      host.state.answer = { body: { car: 'mx5 mx52016', force_kg: null } };
      clock += 2500;
      k.feed(IN_CAR);
      await expect.poll(() => sent.length, { timeout: 3000 }).toBe(2);
      expect(sent[1]).toEqual({ brakeKg: null, car: 'mx5 mx52016' });
    } finally {
      await host.close();
    }
  });

  test('a page that cannot be told does not stop the keeper', async () => {
    const calls = [];
    let clock = 0;
    const k = createRigLimits({ host: () => 'http://localhost:8889', send: () => { throw new Error('gone'); }, fetch: async () => ({ brakeKg: 1, car: 'x' }), now: () => clock, log: (l) => calls.push(l) });
    k.feed(IN_CAR);
    await settle();
    expect(k.current()).toEqual({ brakeKg: 1, car: 'x' });
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
    }
  });
});
