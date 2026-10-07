/**
 * The telemetry as remote-server.js hands it on to the iPad's page and to OBS's (/obs, /obs-ipad): one fetch from the
 * plugin or host for every page that asks within a frame, where each request was a fetch of the whole frame; the track's
 * outline, two thirds of the frame, left out for a page that says it holds it; gzipped for a page that takes it. And the
 * page (game-detect.js) putting the outline back, so that what it draws from is the frame as the plugin made it.
 *
 * Requests from the rig itself into the handler, a made-up telemetry that answers when the test says, and for the pages
 * a real server on 127.0.0.1 at a port the system chooses, over a telemetry there too. Nothing on the network.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import http from 'node:http';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { frame, fieldWith, SVG_PATH } from '../frames.mjs';

const require = createRequire(import.meta.url);
const remote = require('../../remote-server.js');
const OVERLAY = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { OUTLINE_KEY, OUTLINE_ID_KEY, OUTLINE_HEADER, SHARE_MS } = remote;

const FRAME = frame({ order: fieldWith(4) });
const TEXT = JSON.stringify(FRAME);
const OTHER_SVG = SVG_PATH.replace(/^M [\d.]+/, 'M 12.3');
const OTHER_TEXT = JSON.stringify({ ...FRAME, [OUTLINE_KEY]: OTHER_SVG });

// A rig whose telemetry answers when the test says (`answer()`), or at once (`now`): `texts` in turn, the last again.
function rigOf(texts, { now = false } = {}) {
  const rig = { asked: 0, held: [], texts };
  rig.get = (_url, _options, respond) => {
    rig.asked++;
    const text = rig.texts[Math.min(rig.asked - 1, rig.texts.length - 1)];
    const reply = () => respond({ statusCode: 200, headers: {}, pipe: (to) => to.end(text) });
    if (now) queueMicrotask(reply);
    else rig.held.push(reply);
    return { on: () => {}, destroy: () => {} };
  };
  rig.answer = () => { rig.held.splice(0).forEach((reply) => reply()); };
  return rig;
}

const configOf = (rig, more = {}) => ({
  appDir: OVERLAY, telemetryBase: 'http://localhost:8889', key: remote.newKey(), loopback: true,
  addresses: () => [], names: () => [], get: rig.get, ...more,
});

// One request from the rig itself, as a page sends it; the answer as it was sent, bytes and all.
function ask(config, headers = {}) {
  return new Promise((resolve) => {
    const out = { status: null, headers: {}, bytes: Buffer.alloc(0) };
    const res = {
      headersSent: false,
      writableEnded: false,
      writeHead(status, h = {}) { out.status = status; out.headers = { ...h }; this.headersSent = true; },
      end(data) {
        this.writableEnded = true;
        if (data !== undefined) out.bytes = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
        resolve(out);
      },
    };
    const req = { method: 'GET', url: '/racing-desk/', headers: { host: '127.0.0.1:9091', ...headers }, socket: { remoteAddress: '127.0.0.1' } };
    remote.handleRequest(config, req, res);
  });
}
const textOf = (out) => (out.headers['Content-Encoding'] === 'gzip' ? zlib.gunzipSync(out.bytes) : out.bytes).toString('utf8');
const settle = () => new Promise((resolve) => setImmediate(resolve));

test.describe('one fetch for every page', () => {
  test('pages that ask while a fetch is under way wait for it, and are all answered with it', async () => {
    const rig = rigOf([TEXT]);
    const config = configOf(rig);
    const pages = [ask(config), ask(config), ask(config)];
    await settle();
    expect(rig.asked).toBe(1);
    rig.answer();
    for (const out of await Promise.all(pages)) {
      expect(out.status).toBe(200);
      expect(JSON.parse(textOf(out))[OUTLINE_KEY]).toBe(SVG_PATH);
    }
    expect(rig.asked).toBe(1);
  });

  test('a page that asks within a frame of the last fetch is given it; after that, a new one is fetched', async () => {
    expect(SHARE_MS).toBeGreaterThan(0);
    expect(SHARE_MS).toBeLessThan(33);   // less than a page's poll: one page alone is never given its own frame again
    const rig = rigOf([TEXT, OTHER_TEXT], { now: true });
    const config = configOf(rig, { shareMs: 60000 });
    await ask(config);
    const again = await ask(config);
    expect(rig.asked).toBe(1);
    expect(JSON.parse(textOf(again))[OUTLINE_KEY]).toBe(SVG_PATH);
    config.shareMs = 0;
    const next = await ask(config);
    expect(rig.asked).toBe(2);
    expect(JSON.parse(textOf(next))[OUTLINE_KEY]).toBe(OTHER_SVG);
  });

  test("the iPad's server and the loopback one share it: two pages, one on each, one fetch", async () => {
    const rig = rigOf([TEXT]);
    const ipad = configOf(rig, { loopback: false });
    const obs = configOf(rig, { loopback: true });
    const pages = [ask(ipad), ask(obs)];
    await settle();
    rig.answer();
    await Promise.all(pages);
    expect(rig.asked).toBe(1);
  });

  test('a rig that does not answer is said not to answer, to every page that waited', async () => {
    const config = configOf({
      get: () => {
        const events = {};
        setImmediate(() => events.error(new Error('connect ECONNREFUSED')));
        return { on: (name, fn) => { events[name] = fn; }, destroy: () => {} };
      },
    });
    const outs = await Promise.all([ask(config), ask(config)]);
    for (const out of outs) {
      expect(out.status).toBe(502);
      expect(JSON.parse(textOf(out)).error).toBe('The telemetry is not answering on the rig.');
    }
  });
});

test.describe('the outline', () => {
  test('is sent with its name; a page that holds it is sent the frame without it, every other byte as the rig sent it', async () => {
    const rig = rigOf([TEXT], { now: true });
    const config = configOf(rig, { shareMs: 0 });
    const first = await ask(config);
    const whole = JSON.parse(textOf(first));
    const id = whole[OUTLINE_ID_KEY];
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(whole[OUTLINE_KEY]).toBe(SVG_PATH);
    // The name is put first, and is all that was added.
    expect(textOf(first)).toBe(`{${JSON.stringify(OUTLINE_ID_KEY)}:${JSON.stringify(id)},${TEXT.slice(1)}`);

    const lean = await ask(config, { [OUTLINE_HEADER]: id });
    const leanText = textOf(lean);
    const leanFrame = JSON.parse(leanText);
    expect(Object.prototype.hasOwnProperty.call(leanFrame, OUTLINE_KEY)).toBe(false);
    expect(leanFrame[OUTLINE_ID_KEY]).toBe(id);
    expect(leanText.length).toBeLessThan(TEXT.length - SVG_PATH.length + 60);
    delete leanFrame[OUTLINE_ID_KEY];
    expect({ ...leanFrame, [OUTLINE_KEY]: SVG_PATH }).toEqual(FRAME);

    // A page that holds another, or none, is sent it whole.
    for (const held of ['0123456789abcdef', '', undefined]) {
      const out = await ask(config, held === undefined ? {} : { [OUTLINE_HEADER]: held });
      expect(JSON.parse(textOf(out))[OUTLINE_KEY], String(held)).toBe(SVG_PATH);
    }
  });

  test('a new track is a new outline: a page that holds the old one is sent the new one, under its own name', async () => {
    const rig = rigOf([TEXT, OTHER_TEXT], { now: true });
    const config = configOf(rig, { shareMs: 0 });
    const id = JSON.parse(textOf(await ask(config)))[OUTLINE_ID_KEY];
    const changed = JSON.parse(textOf(await ask(config, { [OUTLINE_HEADER]: id })));
    expect(changed[OUTLINE_KEY]).toBe(OTHER_SVG);
    expect(changed[OUTLINE_ID_KEY]).toMatch(/^[0-9a-f]{16}$/);
    expect(changed[OUTLINE_ID_KEY]).not.toBe(id);
    // The same outline again is the same name, whichever server instance or restart gives it (a hash, not a count).
    const again = JSON.parse(textOf(await ask(configOf(rigOf([TEXT], { now: true })))));
    expect(again[OUTLINE_ID_KEY]).toBe(id);
  });

  test('a frame with none, or one that is not an object of the plugin\'s, is sent as it came', async () => {
    for (const text of ['{"DataCorePlugin.GameRunning":1}', '[1,2]', 'not json', '{"a":{"RacingDesk.Plugin.TrackMap.SvgPath":"M 1,1"}}']) {
      const out = await ask(configOf(rigOf([text], { now: true })), { [OUTLINE_HEADER]: 'x' });
      expect(textOf(out), text).toBe(text);
    }
  });

  test('is found only as a member of the frame itself, a string or null, wherever it is in it and however it is spaced', () => {
    const cut = (text) => {
      const m = remote.findMember(text, OUTLINE_KEY);
      return m && (text.slice(0, m.cutStart) + text.slice(m.cutEnd)).replace(/^\uFEFF/, '');
    };
    const K = JSON.stringify(OUTLINE_KEY);
    expect(JSON.parse(cut(`{${K}:"M 1,1","b":2}`))).toEqual({ b: 2 });
    expect(JSON.parse(cut(`{"a":1,${K}:"M 1,1","b":2}`))).toEqual({ a: 1, b: 2 });
    expect(JSON.parse(cut(`{"a":1,${K}:"M 1,1"}`))).toEqual({ a: 1 });
    expect(JSON.parse(cut(`{${K}:"M 1,1"}`))).toEqual({});
    expect(JSON.parse(cut(`\uFEFF {\n  "a": 1,\n  ${K} : null ,\n  "b": [2]\n}`))).toEqual({ a: 1, b: [2] });
    expect(JSON.parse(cut(`{"a":"x \\"${OUTLINE_KEY}\\":1",${K}:"M \\"q\\" 1,1","b":2}`))).toEqual({ a: `x "${OUTLINE_KEY}":1`, b: 2 });
    expect(remote.findMember(`{"a":"${OUTLINE_KEY}"}`, OUTLINE_KEY)).toBeNull();
    expect(remote.findMember(`{"a":[{${K}:"M"}]}`, OUTLINE_KEY)).toBeNull();
    expect(remote.findMember(`{${K}:12}`, OUTLINE_KEY)).toBeNull();
    expect(remote.findMember(`[${K}]`, OUTLINE_KEY)).toBeNull();
  });
});

test.describe('gzip', () => {
  test('for a page that takes it, which a browser always does; never for one that does not', async () => {
    const rig = rigOf([TEXT], { now: true });
    const config = configOf(rig, { shareMs: 60000 });
    const plain = await ask(config);
    expect(plain.headers['Content-Encoding']).toBeUndefined();
    expect(plain.headers['Content-Length']).toBe(plain.bytes.length);
    for (const accept of ['gzip, deflate, br', 'br;q=1, gzip;q=0.5', 'GZIP']) {
      const out = await ask(config, { 'accept-encoding': accept });
      expect(out.headers['Content-Encoding'], accept).toBe('gzip');
      expect(out.headers.Vary).toMatch(/accept-encoding/i);
      expect(out.headers['Content-Length']).toBe(out.bytes.length);
      expect(out.bytes.length).toBeLessThan(plain.bytes.length / 2);
      expect(zlib.gunzipSync(out.bytes).equals(plain.bytes), accept).toBe(true);
    }
    for (const accept of ['gzip;q=0', 'br', 'deflate', 'identity', 'x-gzip-ish']) {
      const out = await ask(config, { 'accept-encoding': accept });
      expect(out.headers['Content-Encoding'], accept).toBeUndefined();
      expect(out.bytes.equals(plain.bytes), accept).toBe(true);
    }
    expect(rig.asked).toBe(1);
  });
});

// ── The pages ──

async function telemetryServer(payload) {
  const served = [];
  const server = http.createServer((req, res) => {
    served.push(req.url);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { served, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }) };
}

for (const [name, where, loopback] of [['the iPad\'s page', '/', false], ['OBS\'s iPad dashboard', '/obs-ipad', true]]) {
  test(`${name} keeps the outline: asked with its name after the first frame, sent none, and reads every frame whole`, async ({ page }) => {
    test.setTimeout(60000);
    // An outline as the host writes one: a point every few metres, two decimals, most of the frame.
    const points = [];
    for (let i = 0; i < 2000; i++) { const a = (i / 2000) * 2 * Math.PI; points.push(`${(50 + 40 * Math.cos(a)).toFixed(2)},${(50 + 30 * Math.sin(a)).toFixed(2)}`); }
    const payload = { ...FRAME, [OUTLINE_KEY]: `M ${points.join(' L ')} Z`, 'DataCorePlugin.GameRawData.Telemetry.IsOnTrack': 1, 'RacingDesk.Plugin.TrackMap.Status': 'ready' };
    const t = await telemetryServer(payload);
    const config = { appDir: OVERLAY, telemetryBase: t.url, key: remote.newKey(), loopback, dispatchAction: null, addresses: () => [], names: () => [], displaySettings: () => ({}) };
    const server = http.createServer((req, res) => remote.handleRequest(config, req, res));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const asked = [];
    page.on('request', (r) => { if (/\/racing-desk\/$/.test(r.url())) asked.push(r.headers()[OUTLINE_HEADER] || null); });
    const sizes = [];
    page.on('response', async (r) => {
      if (!/\/racing-desk\/$/.test(r.url())) return;
      const h = await r.allHeaders();
      sizes.push({ encoding: h['content-encoding'] || null, length: +h['content-length'] });
    });
    try {
      await page.addInitScript(() => { try { localStorage.setItem('rd-effects', 'off'); } catch (e) { /* none */ } });
      await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
      await page.setViewportSize({ width: 1180, height: 820 });
      await page.goto(`http://127.0.0.1:${server.address().port}${where}`);
      await page.waitForFunction(() => typeof _isIdle !== 'undefined' && _isIdle === false && _pollFrame > 20, null, { timeout: 30000 });
      // Every frame the page read was the frame as the plugin made it: the outline in it, no name of the server's.
      const read = await page.evaluate(() => _latestSnapshot);
      expect(read).toEqual(payload);
      expect(await page.evaluate(() => document.getElementById('fullMapTrackSrc').getAttribute('d').length)).toBeGreaterThan(100);
      // The first ask names none; once it has one, every ask names it, and is answered gzipped and without the outline.
      expect(asked[0]).toBeNull();
      const named = asked.filter((h) => h !== null);
      expect(named.length).toBeGreaterThan(15);
      expect(new Set(named).size).toBe(1);
      expect(asked.indexOf(named[0])).toBeLessThanOrEqual(2);
      expect(sizes[0].encoding).toBe('gzip');
      const later = sizes.slice(3);
      expect(later.length).toBeGreaterThan(10);
      for (const s of later) {
        expect(s.encoding).toBe('gzip');
        expect(s.length).toBeLessThan(sizes[0].length / 2);
      }
    } finally {
      await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
      await t.close();
    }
  });
}
