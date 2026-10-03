// Putting back each car's seat height and brakes, as the app's main process asks the host for it (modules/js/restore-api.js):
// the commands it sends on and the ones it does not, the requests a stand-in host answers by the host's own rule, and main.js's
// and the preload's wiring, read as text — the desk asks, and the HUD is told nothing of it.

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
  test('a switch or undo, and nothing else, is sent on, with only its own keys', () => {
    const ok = [{ switches: { brakes: false } }, { switches: { height: true } }, { switches: { brakes: true, height: false } }, { undo: 'all' }];
    for (const body of ok) expect(restoreApi.commandProblem(body), JSON.stringify(body)).toBeNull();
    const bad = [
      null, [], 'undo', {}, { switches: {} }, { switches: { height: 'yes' } }, { switches: { horizon: true } }, { switches: { pedals: true } },
      { step: 'A2' }, { mark: 'A4', state: 'passed' }, { undo: 'brakes' }, { undo: 'heights' }, { undo: 'height', car: 'porsche963gtp' }, { undo: true },
      { sql: 'DELETE' },
    ];
    for (const body of bad) expect(restoreApi.commandProblem(body), JSON.stringify(body)).not.toBeNull();
    expect(restoreApi.commandBody({ switches: { height: true, other: 1 } })).toEqual({ switches: { height: true } });
    expect(restoreApi.commandBody({ undo: 'all', car: 'x' })).toEqual({ undo: 'all' });
    expect(restoreApi.SWITCHES).toEqual(['brakes', 'height']);
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

const STANDS = {
  available: true,
  switches: { brakes: true, height: true },
  status: { brakes: { state: 'working', text: 'Working: the last brakes it put on were the Porsche 963 GTP\'s.' }, height: { state: 'working', text: 'Working.' } },
  undo: true,
  cars: [],
};

test.describe('the host is asked as a program on this machine', () => {
  test('a read and a command reach the route, with a Host and no Origin, and come back as answers, never rejections', async () => {
    const host = await startHost((req, body) => (req.method === 'GET' ? { body: STANDS } : { body: { ok: true, switches: body.switches } }));
    try {
      const api = restoreApi.createRestoreApi({ host: () => host.url });
      expect(await api.read()).toEqual({ value: STANDS });
      expect(await api.command({ switches: { brakes: false } })).toMatchObject({ ok: true, switches: { brakes: false } });
      expect(host.state.bodies).toEqual([{ switches: { brakes: false } }]);
      expect(host.state.refused).toEqual([]);
      expect(host.state.asked.map((a) => `${a.method} ${a.url}`)).toEqual(['GET /racing-desk/data/restore', 'POST /racing-desk/data/restore']);
      for (const a of host.state.asked) {
        expect(a.headers.host).toBe(`127.0.0.1:${host.port}`);
        expect(a.headers.origin).toBeUndefined();
      }
      // A command that is not one is not sent at all.
      expect((await api.command({ step: 'A2' })).ok).toBe(false);
      expect(host.state.asked).toHaveLength(2);
    } finally {
      await host.close();
    }
  });

  test('a refusal, an old host, a host elsewhere and no host are said in words', async () => {
    const host = await startHost((req) => (req.method === 'GET' ? { status: 404, body: { error: 'unknown data route' } } : { status: 400, body: { error: 'undo is all' } }));
    try {
      const api = restoreApi.createRestoreApi({ host: () => host.url });
      expect(await api.read()).toEqual({ missing: true });
      expect(await api.command({ undo: 'all' })).toEqual({ ok: false, error: 'undo is all' });
    } finally {
      await host.close();
    }
    const elsewhere = restoreApi.createRestoreApi({ host: () => 'http://192.168.1.20:8889' });
    expect((await elsewhere.read()).error).toMatch(/not on this machine/);
    expect((await elsewhere.command({ undo: 'all' })).error).toMatch(/not on this machine/);
    const nobody = restoreApi.createRestoreApi({ host: () => 'http://127.0.0.1:1' });
    expect((await nobody.read()).error).toMatch(/Nothing is answering|could not be asked/);
  });
});

test.describe('main.js and the preload', () => {
  const body = (channel) => {
    const at = CODE.indexOf(`ipcMain.handle('${channel}',`);
    expect(at, channel).toBeGreaterThanOrEqual(0);
    return CODE.slice(at, CODE.indexOf('\n});', at));
  };

  test('the desk window alone asks; the host keeps the switches, and nothing of them is in the settings file', () => {
    expect(body('restore:read')).toMatch(/async \(event\) => \{\s*if \(!fromDesk\(event\)\) return \{ error: RESTORE_NOT_DESK \};\s*return restoreApi\.read\(\);/);
    const command = body('restore:command');
    expect(command).toMatch(/async \(event, body\) => \{\s*if \(!fromDesk\(event\)\) return \{ ok: false, error: RESTORE_NOT_DESK \};/);
    expect(command).toMatch(/restoreApiMod\.commandProblem\(body\)/);
    expect(command.indexOf('fromDesk(event)')).toBeLessThan(command.indexOf('restoreApi.command('));
    expect(CODE).not.toMatch(/restoreHeight|restoreBrakes|restoreHorizon|tellRestoreSwitches|tellSwitches/);
  });

  test('the HUD gets no restore lines: nothing of it is fed the HUD\'s poll or sent to the HUD\'s window', () => {
    expect(CODE).not.toMatch(/createRestoreLines|restoreLines|restoreNotice/);
    expect(CODE).toMatch(/rigLimits\.feed\(payload\); return payload;/);
    const toOverlay = [...CODE.matchAll(/overlayWindow\.webContents\.send\('hud-notice'/g)];
    expect(toOverlay, 'the recording keeper\'s notice, and no other').toHaveLength(1);
    expect(restoreApi.createRestoreLines).toBeUndefined();
  });

  test('the desk channel is answered to the desk\'s own page: its frame is at desk.html, and the window cannot be taken anywhere else', () => {
    // fromDesk is one expression: the desk's own webContents, and a sender frame at the desk's file (null once it has navigated away).
    const fromDesk = /\bconst fromDesk = \(event\) => ([^;\n]+);/.exec(CODE);
    expect(fromDesk).not.toBeNull();
    expect(fromDesk[1]).toContain('event.sender === deskWindow.webContents');
    expect(fromDesk[1]).toContain('deskFrames.isDeskFrame(event.senderFrame, DESK_HTML)');
    expect(fromDesk[1]).not.toContain('||');
    expect(CODE).toMatch(/const DESK_HTML = path\.join\(__dirname, 'desk\.html'\);/);
    expect(CODE).toMatch(/deskWindow\.loadFile\(DESK_HTML, \{ query \}\);/);
    // The window is held to that page where it is made, before the page is loaded into it.
    const made = CODE.indexOf('deskWindow = new BrowserWindow(');
    const guarded = CODE.indexOf('deskFrames.guardWindow(deskWindow.webContents, DESK_HTML, { log: logToFile });');
    const loaded = CODE.indexOf('loadDesk(page);', made);
    expect(made).toBeGreaterThan(0);
    expect(guarded).toBeGreaterThan(made);
    expect(loaded).toBeGreaterThan(guarded);
  });

  test('the preload hands the desk read and command, and nothing else of it', () => {
    expect(PRELOAD).toMatch(/restore: \{\s*read: \(\) => ipcRenderer\.invoke\('restore:read'\),\s*command: \(body\) => ipcRenderer\.invoke\('restore:command', body\),\s*\},/);
  });
});
