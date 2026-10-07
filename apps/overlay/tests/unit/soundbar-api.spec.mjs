// iRacing's LFE off on the sound bar, as the app's main process asks the host for it (modules/js/soundbar-api.js): the commands it
// sends on and the ones it does not, the requests a stand-in host answers by the host's own rule, and main.js's and the preload's
// wiring, read as text — the desk asks, and the HUD is told nothing of it.

import { test, expect } from '@playwright/test';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { answerRefusal } from '../this-machine-rule.mjs';

const require = createRequire(import.meta.url);
const soundBarApi = require('../../modules/js/soundbar-api.js');

const MAIN = readFileSync(new URL('../../main.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const CODE = MAIN.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const PRELOAD = readFileSync(new URL('../../preload.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test.describe('the commands', () => {
  test('the switch or the sound bar, one at a time and nothing else, is sent on with only its own key', () => {
    const ok = [{ enabled: false }, { enabled: true }, { device: '{0.0.0.00000000}.{sound-bar}' }, { device: '' }];
    for (const body of ok) expect(soundBarApi.commandProblem(body), JSON.stringify(body)).toBeNull();
    const bad = [
      null, [], 'off', {}, { enabled: 'yes' }, { enabled: 1 }, { device: 5 }, { device: null }, { device: 'x'.repeat(301) },
      { enabled: true, device: 'x' }, { step: 'A1' }, { path: 'C:\\Users\\Owner\\Documents\\iRacing\\app.ini' }, { key: 'LFEEnabled', value: 1 }, { sql: 'DELETE' },
    ];
    for (const body of bad) expect(soundBarApi.commandProblem(body), JSON.stringify(body)).not.toBeNull();
    expect(soundBarApi.commandBody({ enabled: false, other: 1 })).toEqual({ enabled: false });
    expect(soundBarApi.commandBody({ device: 'a' })).toEqual({ device: 'a' });
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
  enabled: true,
  device: { id: '{sound-bar}', name: 'Speakers (SineAudio DS6301M Plus V1.23)', connected: true },
  devices: [{ id: '{sound-bar}', name: 'Speakers (SineAudio DS6301M Plus V1.23)' }],
  onSoundBar: false,
  status: { state: 'idle', last: null, lastAtUtc: null, waiting: null, problem: null },
};

test.describe('the host is asked as a program on this machine', () => {
  test('a read and a command reach the route, with a Host and no Origin, and come back as answers, never rejections', async () => {
    const host = await startHost((req, body) => (req.method === 'GET' ? { body: STANDS } : { body: { ok: true, enabled: body.enabled } }));
    try {
      const api = soundBarApi.createSoundBarApi({ host: () => host.url });
      expect(await api.read()).toEqual({ value: STANDS });
      expect(await api.command({ enabled: false })).toMatchObject({ ok: true, enabled: false });
      expect(host.state.bodies).toEqual([{ enabled: false }]);
      expect(host.state.refused).toEqual([]);
      expect(host.state.asked.map((a) => `${a.method} ${a.url}`)).toEqual(['GET /racing-desk/data/soundbar', 'POST /racing-desk/data/soundbar']);
      for (const a of host.state.asked) {
        expect(a.headers.host).toBe(`127.0.0.1:${host.port}`);
        expect(a.headers.origin).toBeUndefined();
      }
      // A command that is not one is not sent at all.
      expect((await api.command({ step: 'A1' })).ok).toBe(false);
      expect(host.state.asked).toHaveLength(2);
    } finally {
      await host.close();
    }
  });

  test('a refusal, an old host, a host elsewhere and no host are said in words', async () => {
    const host = await startHost((req) => (req.method === 'GET' ? { status: 404, body: { error: 'unknown data route' } } : { status: 400, body: { error: 'expected { enabled: true|false } or { device: "<id>" }' } }));
    try {
      const api = soundBarApi.createSoundBarApi({ host: () => host.url });
      expect(await api.read()).toEqual({ missing: true });
      expect(await api.command({ enabled: true })).toEqual({ ok: false, error: 'expected { enabled: true|false } or { device: "<id>" }' });
    } finally {
      await host.close();
    }
    const elsewhere = soundBarApi.createSoundBarApi({ host: () => 'http://192.168.1.20:8889' });
    expect((await elsewhere.read()).error).toMatch(/not on this machine/);
    expect((await elsewhere.command({ enabled: true })).error).toMatch(/not on this machine/);
    const nobody = soundBarApi.createSoundBarApi({ host: () => 'http://127.0.0.1:1' });
    expect((await nobody.read()).error).toMatch(/Nothing is answering|could not be asked/);
  });
});

test.describe('main.js and the preload', () => {
  const body = (channel) => {
    const at = CODE.indexOf(`ipcMain.handle('${channel}',`);
    expect(at, channel).toBeGreaterThanOrEqual(0);
    return CODE.slice(at, CODE.indexOf('\n});', at));
  };

  test('the desk window alone asks; the host keeps the switch and the choice, and nothing of them is in the settings file', () => {
    expect(body('soundbar:read')).toMatch(/async \(event\) => \{\s*if \(!fromDesk\(event\)\) return \{ error: SOUNDBAR_NOT_DESK \};\s*return soundBarApi\.read\(\);/);
    const command = body('soundbar:command');
    expect(command).toMatch(/async \(event, body\) => \{\s*if \(!fromDesk\(event\)\) return \{ ok: false, error: SOUNDBAR_NOT_DESK \};/);
    expect(command).toMatch(/soundBarApiMod\.commandProblem\(body\)/);
    expect(command.indexOf('fromDesk(event)')).toBeLessThan(command.indexOf('soundBarApi.command('));
    expect(CODE).not.toMatch(/soundBarEnabled|soundbarEnabled|lfeEnabled|xa2_mixToLFE|LFEEnabled/);
  });

  test('the HUD is told nothing of it', () => {
    expect(CODE).not.toMatch(/overlayWindow.*soundbar/i);
    expect(PRELOAD.match(/soundbar:/g)).toHaveLength(2);
  });

  test('the preload hands the desk read and command, and nothing else of it', () => {
    expect(PRELOAD).toMatch(/soundBar: \{\s*read: \(\) => ipcRenderer\.invoke\('soundbar:read'\),\s*command: \(body\) => ipcRenderer\.invoke\('soundbar:command', body\),\s*\},/);
  });
});
