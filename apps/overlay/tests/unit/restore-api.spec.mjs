// Putting back each car's height and brakes, as the app's main process asks the host for it (modules/js/restore-api.js): the
// commands it sends on and the ones it does not, the requests a stand-in host answers by the host's own rule, the HUD's
// lines (in the car only, one after another, never while OBS records), and main.js's and the preload's wiring, read as text.

import { test, expect } from '@playwright/test';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { answerRefusal } from '../this-machine-rule.mjs';

const require = createRequire(import.meta.url);
const restoreApi = require('../../modules/js/restore-api.js');

const MAIN = readFileSync(new URL('../../main.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const CODE = MAIN.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const PRELOAD = readFileSync(new URL('../../preload.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test.describe('the commands', () => {
  test('only the host\'s own commands are sent on, with only their own keys', () => {
    const ok = [
      { switches: { height: false } }, { switches: { brakes: true, horizon: false } }, { step: 'A2' }, { step: 'A7-check' }, { step: 'B1-check' },
      { step: 'B2-flags' }, { step: 'B6-b' }, { step: 'B7-restore' }, { step: '0a' }, { mark: 'A4', state: 'passed' }, { mark: 'B5', state: null },
      { undo: 'brakes' }, { undo: 'heights' }, { undo: 'height', car: 'porsche963gtp' },
    ];
    for (const body of ok) expect(restoreApi.commandProblem(body), JSON.stringify(body)).toBeNull();
    const bad = [
      null, [], 'A2', {}, { switches: {} }, { switches: { height: 'yes' } }, { switches: { pedals: true } }, { step: 'A9' }, { step: 'C1' },
      { step: 'A2; DROP' }, { step: 'A7-anything' }, { mark: 'A7-check', state: 'passed' }, { mark: 'A4', state: 'sure' }, { mark: 'A4' },
      { undo: 'everything' }, { undo: 'height' }, { undo: 'height', car: '' }, { undo: 'height', car: 'x'.repeat(201) }, { sql: 'DELETE' },
    ];
    for (const body of bad) expect(restoreApi.commandProblem(body), JSON.stringify(body)).not.toBeNull();
    expect(restoreApi.commandBody({ step: 'A2', extra: 1 })).toEqual({ step: 'A2' });
    expect(restoreApi.commandBody({ switches: { height: true, other: 1 } })).toEqual({ switches: { height: true } });
    expect(restoreApi.commandBody({ undo: 'height', car: ' mx5 mx52016 ', more: 2 })).toEqual({ undo: 'height', car: 'mx5 mx52016' });
  });

  test('the switches are the settings file\'s: the height and the brakes on unless it says false, the horizon off unless it says true', () => {
    expect(restoreApi.switchesOf({})).toEqual({ height: true, brakes: true, horizon: false });
    expect(restoreApi.switchesOf(null)).toEqual({ height: true, brakes: true, horizon: false });
    expect(restoreApi.switchesOf({ restoreHeight: false, restoreBrakes: 0, restoreHorizon: 'yes' })).toEqual({ height: false, brakes: true, horizon: false });
    expect(restoreApi.switchesOf({ restoreHorizon: true })).toMatchObject({ horizon: true });
    expect(restoreApi.SETTINGS_KEYS).toEqual({ height: 'restoreHeight', brakes: 'restoreBrakes', horizon: 'restoreHorizon' });
  });
});

// A stand-in for the app's host: it answers whom the host answers (tests/this-machine-rule.mjs), and keeps what it was asked.
function startHost(handler) {
  const state = { asked: [], refused: [], bodies: [] };
  const server = http.createServer((req, res) => {
    if (answerRefusal(req, res, server.address().port, state.refused)) return;
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      state.asked.push({ method: req.method, url: req.url, headers: req.headers });
      if (body) state.bodies.push(JSON.parse(body));
      const answer = handler(req, body ? JSON.parse(body) : null);
      res.writeHead(answer.status ?? 200, { 'Content-Type': 'application/json' });
      res.end(typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    resolve({ server, state, port, url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) });
  }));
}

const STANDS = { available: true, mode: 'trial', seq: 7, switches: { height: true, brakes: true, horizon: false }, lines: [], cars: [] };

test.describe('the host is asked as a program on this machine', () => {
  test('a read and a command reach the route, with a Host and no Origin, and come back as answers, never rejections', async () => {
    const host = await startHost((req, body) => (req.method === 'GET' ? { body: STANDS } : { body: { ok: true, step: body.step, did: ['made'], saw: [] } }));
    try {
      const api = restoreApi.createRestoreApi({ host: () => host.url });
      expect(await api.read()).toEqual({ value: STANDS });
      expect(await api.read('?since=0')).toEqual({ value: STANDS });
      expect(await api.command({ step: 'A2' })).toMatchObject({ ok: true, step: 'A2', did: ['made'] });
      expect(await api.tellSwitches({ restoreBrakes: false })).toMatchObject({ ok: true });
      expect(host.state.bodies).toEqual([{ step: 'A2' }, { switches: { height: true, brakes: false, horizon: false } }]);
      expect(host.state.refused).toEqual([]);
      expect(host.state.asked.map((a) => `${a.method} ${a.url}`)).toEqual([
        'GET /racing-desk/data/restore', 'GET /racing-desk/data/restore?since=0', 'POST /racing-desk/data/restore', 'POST /racing-desk/data/restore',
      ]);
      for (const a of host.state.asked) {
        expect(a.headers.host).toBe(`127.0.0.1:${host.port}`);
        expect(a.headers.origin).toBeUndefined();
      }
      // A command that is not one is not sent at all.
      expect(await api.command({ step: 'Z9' })).toEqual({ ok: false, error: 'There is no such step.' });
      expect(host.state.asked).toHaveLength(4);
    } finally {
      await host.close();
    }
  });

  test('a refusal, an old host, a host elsewhere and no host are said in words', async () => {
    const host = await startHost((req) => (req.method === 'GET' ? { status: 404, body: { error: 'unknown data route' } } : { status: 400, body: { error: 'no such step' } }));
    try {
      const api = restoreApi.createRestoreApi({ host: () => host.url });
      expect(await api.read()).toEqual({ missing: true });
      expect(await api.command({ step: 'A1' })).toEqual({ ok: false, error: 'no such step' });
    } finally {
      await host.close();
    }
    const elsewhere = restoreApi.createRestoreApi({ host: () => 'http://192.168.1.20:8889' });
    expect((await elsewhere.read()).error).toMatch(/not on this machine/);
    expect((await elsewhere.command({ undo: 'brakes' })).error).toMatch(/not on this machine/);
    const nobody = restoreApi.createRestoreApi({ host: () => 'http://127.0.0.1:1' });
    expect((await nobody.read()).error).toMatch(/Nothing is answering|could not be asked/);
  });
});

test.describe('the HUD\'s lines', () => {
  const IN_CAR = { 'DataCorePlugin.GameRunning': 1, 'DataCorePlugin.GameRawData.Telemetry.IsOnTrack': true, 'DataCorePlugin.GameRawData.Telemetry.IsReplayPlaying': false };
  const OUT = { 'DataCorePlugin.GameRunning': 1, 'DataCorePlugin.GameRawData.Telemetry.IsOnTrack': false, 'DataCorePlugin.GameRawData.Telemetry.IsReplayPlaying': false };
  const at = (t) => new Date(Date.UTC(2026, 9, 2, 20, 0, 0) + t).toISOString();

  function rig(lines) {
    const clock = { now: Date.UTC(2026, 9, 2, 20, 0, 0) };
    const shown = [];
    const asked = [];
    const logged = [];
    let filming = false;
    const host = { lines: lines.slice() };
    const keeper = restoreApi.createRestoreLines({
      host: () => 'http://127.0.0.1:18889',
      show: (text) => shown.push(text),
      recording: () => filming,
      now: () => clock.now,
      log: (m) => logged.push(m),
      fetch: async (url) => {
        asked.push(url);
        const since = Number(new URL(url).searchParams.get('since'));
        const after = host.lines.filter((l) => l.seq > since);
        return { available: true, seq: host.lines.length ? host.lines.at(-1).seq : since, lines: after };
      },
    });
    const tick = async (payload, ms = 500) => { clock.now += ms; keeper.feed(payload); await new Promise((r) => setImmediate(r)); };
    return { keeper, clock, shown, asked, logged, host, tick, film: (v) => { filming = v; } };
  }

  test('what was said before the app first asked is not shown; what is said after is shown in the car, one at a time', async () => {
    const r = rig([{ seq: 1, at: at(0), car: 'x', hud: true, text: 'Trial: brakes Old Car · 40 kg' }]);
    await r.tick(OUT);
    expect(r.asked).toEqual(['http://127.0.0.1:18889/racing-desk/data/restore?since=0']);
    // At the garage screen: the car's lines are said, and the HUD is not shown there.
    r.host.lines.push(
      { seq: 2, at: at(1000), car: 'porsche963gtp', hud: true, text: 'Trial: brakes Porsche 963 GTP · 70 kg' },
      { seq: 3, at: at(1000), car: 'porsche963gtp', hud: false, text: 'Trial: would make its own SmartControl profile …' },
      { seq: 4, at: at(1000), car: 'porsche963gtp', hud: true, text: 'Trial: height Porsche 963 GTP · −2.0 cm (its camera file)' },
    );
    for (let i = 0; i < 10; i++) await r.tick(OUT);
    expect(r.asked).toHaveLength(1);
    expect(r.shown).toEqual([]);
    // In the car: asked, and shown a line at a time, the next after the first has had its two seconds.
    await r.tick(IN_CAR);
    await r.tick(IN_CAR);
    expect(r.shown).toEqual(['Trial: brakes Porsche 963 GTP · 70 kg']);
    await r.tick(IN_CAR, 2000);
    expect(r.shown, 'the first has its two seconds first').toHaveLength(1);
    await r.tick(IN_CAR);
    expect(r.shown).toEqual(['Trial: brakes Porsche 963 GTP · 70 kg', 'Trial: height Porsche 963 GTP · −2.0 cm (its camera file)']);
    for (let i = 0; i < 20; i++) await r.tick(IN_CAR);
    expect(r.shown).toHaveLength(2);
    expect(r.asked.every((u) => u.startsWith('http://127.0.0.1:18889/racing-desk/data/restore?since='))).toBe(true);
  });

  test('never while OBS records: what was waiting is let go and said in the log', async () => {
    const r = rig([]);
    await r.tick(OUT);
    r.host.lines.push({ seq: 1, at: at(1000), car: 'x', hud: true, text: 'Trial: brakes X · 50 kg' });
    r.film(true);
    for (let i = 0; i < 6; i++) await r.tick(IN_CAR);
    expect(r.shown).toEqual([]);
    expect(r.logged.join('\n')).toMatch(/not shown on the HUD: OBS is recording/);
    r.film(false);
    for (let i = 0; i < 6; i++) await r.tick(IN_CAR);
    expect(r.shown).toEqual([]);
  });

  test('an old line is not news, and no more than three wait', async () => {
    const r = rig([]);
    await r.tick(OUT);
    r.host.lines.push({ seq: 1, at: at(-40 * 60e3), car: 'x', hud: true, text: 'old' });
    for (let i = 2; i <= 7; i++) r.host.lines.push({ seq: i, at: at(1000), car: 'x', hud: true, text: `line ${i}` });
    await r.tick(IN_CAR, 2000);
    expect(r.keeper.pending()).toEqual(['line 5', 'line 6', 'line 7']);
  });
});

test.describe('main.js and the preload', () => {
  const body = (channel) => {
    const at = CODE.indexOf(`ipcMain.handle('${channel}',`);
    expect(at, channel).toBeGreaterThanOrEqual(0);
    return CODE.slice(at, CODE.indexOf('\n});', at));
  };

  test('the desk window alone asks, and the switches are written into the settings file before the host is told', () => {
    expect(body('restore:read')).toMatch(/async \(event, opts\) => \{\s*if \(!fromDesk\(event\)\) return \{ error: RESTORE_NOT_DESK \};/);
    const command = body('restore:command');
    expect(command).toMatch(/async \(event, body\) => \{\s*if \(!fromDesk\(event\)\) return \{ ok: false, error: RESTORE_NOT_DESK \};/);
    expect(command).toMatch(/restoreApiMod\.commandProblem\(body\)/);
    expect(command.indexOf('saveSettingsSync(settings)')).toBeLessThan(command.indexOf('restoreApi.command({ switches'));
    expect(CODE).toMatch(/await startLocalHost\(\);\s*tellRestoreSwitches\('the app started'\);/);
  });

  test('the HUD is told the car\'s lines on the one channel, from the keeper\'s own poll, and never while OBS records', () => {
    expect(CODE).toMatch(/function restoreNotice\(text\) \{\s*if \(overlayWindow && !overlayWindow\.isDestroyed\(\)\) overlayWindow\.webContents\.send\('hud-notice', text\);\s*\}/);
    expect(CODE).toMatch(/restoreApiMod\.createRestoreLines\(\{ host: \(\) => localHostUrl\(\), show: restoreNotice, recording: obsFilming, log: logToFile \}\)/);
    expect(CODE).toMatch(/function obsFilming\(\) \{[\s\S]*?return !!\(s && \(s\.recording \|\| s\.starting\)\);\s*\}/);
    expect(CODE).toMatch(/rigLimits\.feed\(payload\); restoreLines\.feed\(payload\); return payload;/);
    expect([...CODE.matchAll(/restoreLines\.feed\(/g)]).toHaveLength(1);
    expect([...CODE.matchAll(/\brestoreNotice\b/g)]).toHaveLength(2);
  });

  test('the preload hands the desk read and command, and nothing else of it', () => {
    expect(PRELOAD).toMatch(/restore: \{\s*read: \(opts\) => ipcRenderer\.invoke\('restore:read', opts && opts\.linesOnly === true \? \{ linesOnly: true \} : undefined\),\s*command: \(body\) => ipcRenderer\.invoke\('restore:command', body\),\s*\},/);
  });
});
