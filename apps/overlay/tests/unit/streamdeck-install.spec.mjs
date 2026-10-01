/**
 * The Stream Deck plugin: built by streamdeck/build.mjs into the .sdPlugin folder, installed from the unpacked copy
 * (modules/js/streamdeck-install.js), and the plugin itself (streamdeck/racing-desk/src/plugin.js) against a fake
 * Stream Deck app and a fake action route, both on 127.0.0.1. Nothing here touches the real Stream Deck folder.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startWsServer } from './ws-fake-server.mjs';
import { buildPlugin, PLUGIN_DIR } from '../../streamdeck/build.mjs';

const require = createRequire(import.meta.url);
const installer = require('../../modules/js/streamdeck-install.js');
const plugin = require('../../streamdeck/racing-desk/src/plugin.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const SD_PLUGIN = path.resolve(here, '..', '..', 'streamdeck', 'racing-desk', PLUGIN_DIR);
const manifest = JSON.parse(fs.readFileSync(path.join(SD_PLUGIN, 'manifest.json'), 'utf8'));

let dir;
test.beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-streamdeck-')); });
test.afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

test.describe('the plugin\'s actions', () => {
  test('every UUID in the manifest is one of the plugin\'s actions, and the names are the app\'s', () => {
    const uuids = manifest.Actions.map((a) => a.UUID);
    expect(uuids.sort()).toEqual(Object.keys(plugin.ACTIONS).sort());
    expect(manifest.CodePath).toBe('bin/plugin.js');
    const remote = require('../../remote-server.js');
    for (const name of Object.values(plugin.ACTIONS)) expect(remote.ACTIONS.some((a) => a.name === name), name).toBe(true);
  });

  test('the shipped manifest does not start the plugin with Node\'s inspector open', () => {
    // "Debug": "enabled" makes the Stream Deck app start the plugin under --inspect: a port on this machine that any
    // program on it can attach to and run code through. It never ran while the install failed; it does now.
    expect(manifest.Nodejs).toBeTruthy();
    expect(manifest.Nodejs.Version).toBe('20');
    expect(String(manifest.Nodejs.Debug || 'disabled').toLowerCase()).not.toBe('enabled');
  });

  test('a recording press waits as long as OBS may take to answer — OBS started, its WebSocket up, the recording begun — and the rest wait 3 s', async () => {
    // With OBS closed, Record starts it (up to 30 s for its WebSocket) and waits for STARTED (up to 10 s). At 3 s the key
    // showed a cross for a recording that had begun.
    expect(plugin.askWithin('toggle-recording')).toBeGreaterThanOrEqual(30000 + 10000);
    for (const name of ['toggle-recording', 'start-recording', 'stop-recording', 'save-replay-buffer']) expect(plugin.askWithin(name), name).toBe(plugin.RECORDING_ASK_WITHIN_MS);
    for (const name of ['toggle-overlay', 'zoom-in', 'quit', 'toggle-settings']) expect(plugin.askWithin(name), name).toBe(plugin.ASK_WITHIN_MS);
    expect(plugin.ASK_WITHIN_MS).toBe(3000);
    // End to end: an app that answers Record after 3.4 s (OBS being started) is a tick, not a cross.
    const server = http.createServer((req, res) => {
      const slow = req.url.endsWith('toggle-recording');
      setTimeout(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true })); }, slow ? 3400 : 0);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    try {
      expect(await plugin.fire('toggle-recording', port)).toBe(true);
      // Anything else that is that slow is still a cross at 3 s.
      expect(await plugin.fire('zoom-in', port, { timeoutMs: 50 })).toBe(true);
      const slowZoom = http.createServer((req, res) => { setTimeout(() => { res.writeHead(200); res.end('{"ok":true}'); }, 600); });
      await new Promise((r) => slowZoom.listen(0, '127.0.0.1', r));
      try { expect(await plugin.fire('zoom-in', slowZoom.address().port, { timeoutMs: 100 })).toBe(false); } finally { await new Promise((r) => slowZoom.close(r)); }
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  test('the Stream Deck app\'s arguments are read', () => {
    expect(plugin.parseArgs(['-port', '28196', '-pluginUUID', 'abc', '-registerEvent', 'registerPlugin', '-info', '{"application":{}}'])).toEqual({ port: 28196, pluginUUID: 'abc', registerEvent: 'registerPlugin', info: { application: {} } });
    expect(plugin.parseArgs([])).toEqual({ port: null, pluginUUID: null, registerEvent: 'registerPlugin', info: null });
  });

  test('a press asks the app with the header that says a program is asking; a tick for ok, a cross for anything else', async () => {
    const asked = [];
    const answers = { 'toggle-recording': [200, { ok: true }], 'toggle-overlay': [200, { ok: false, reason: 'out of the car' }], quit: [403, { ok: false }] };
    const server = http.createServer((req, res) => {
      asked.push({ url: req.url, header: req.headers['x-racing-desk'] });
      const name = req.url.replace('/api/action/', '');
      const [status, body] = answers[name] || [404, { ok: false }];
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    try {
      expect(await plugin.fire('toggle-recording', port)).toBe(true);
      expect(await plugin.fire('toggle-overlay', port)).toBe(false);
      expect(await plugin.fire('quit', port)).toBe(false);
      expect(await plugin.fire('nothing', port)).toBe(false);
      expect(asked.map((a) => a.url)).toEqual(['/api/action/toggle-recording', '/api/action/toggle-overlay', '/api/action/quit', '/api/action/nothing']);
      expect(asked.every((a) => a.header === '1')).toBe(true);
    } finally {
      await new Promise((r) => server.close(r));
    }
    // Nothing listening: a cross, not a throw.
    expect(await plugin.fire('toggle-recording', port)).toBe(false);
  });
});

test.describe('the build and the plugin running', () => {
  test('builds into bin/plugin.js with its package.json, and the built plugin registers with the Stream Deck app and answers a key', async () => {
    test.setTimeout(60000);
    const out = path.join(dir, 'bin');
    const { outfile } = buildPlugin({ outDir: out });
    expect(fs.existsSync(outfile)).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(out, 'package.json'), 'utf8'))).toEqual({ type: 'commonjs' });
    const code = fs.readFileSync(outfile, 'utf8');
    expect(code).toContain('com.doooom.racingdesk.toggle-recording');
    expect(code).not.toMatch(/require\(['"]\.\.?\//);   // nothing left to resolve beside it: the client is bundled in

    // A fake action route, and a fake Stream Deck app.
    const asked = [];
    const app = http.createServer((req, res) => { asked.push(req.url); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: !/quit/.test(req.url) })); });
    await new Promise((r) => app.listen(0, '127.0.0.1', r));
    const received = [];
    let conn = null;
    const deck = await startWsServer({ onConnection(c) { conn = c; c.on('message', (t) => received.push(JSON.parse(t))); } });
    let child = null;
    const stdout = [];
    try {
      child = spawn(process.execPath, [outfile, '-port', String(deck.port), '-pluginUUID', 'plugin-1', '-registerEvent', 'registerPlugin', '-info', '{}'], { stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', (d) => stdout.push(String(d)));
      child.stderr.on('data', (d) => stdout.push(String(d)));
      const until = async (what) => { const t = Date.now(); while (!what()) { if (Date.now() - t > 15000) throw new Error('waited too long: ' + stdout.join('')); await new Promise((r) => setTimeout(r, 20)); } };
      await until(() => received.length >= 1);
      expect(received[0]).toEqual({ event: 'registerPlugin', uuid: 'plugin-1' });
      conn.send(JSON.stringify({ event: 'keyDown', action: 'com.doooom.racingdesk.toggle-recording', context: 'ctx-1', device: 'd', payload: { settings: { port: app.address().port }, coordinates: { column: 0, row: 0 }, isInMultiAction: false } }));
      await until(() => received.length >= 2);
      expect(received[1]).toEqual({ event: 'showOk', context: 'ctx-1' });
      expect(asked).toEqual(['/api/action/toggle-recording']);
      conn.send(JSON.stringify({ event: 'keyDown', action: 'com.doooom.racingdesk.quit', context: 'ctx-2', payload: { settings: { port: app.address().port } } }));
      await until(() => received.length >= 3);
      expect(received[2]).toEqual({ event: 'showAlert', context: 'ctx-2' });
      conn.send(JSON.stringify({ event: 'keyDown', action: 'com.unknown.thing', context: 'ctx-3', payload: { settings: {} } }));
      await until(() => received.length >= 4);
      expect(received[3]).toEqual({ event: 'showAlert', context: 'ctx-3' });
      expect(asked).toHaveLength(2);
      // The Stream Deck app letting go ends the plugin.
      conn.close(1001, 'bye');
      await new Promise((resolve) => child.on('exit', resolve));
      expect(child.exitCode).toBe(0);
      child = null;
    } finally {
      if (child) child.kill();
      await deck.close();
      await new Promise((r) => app.close(r));
    }
  });
});

test.describe('the install', () => {
  function tree(root) {
    const src = path.join(root, 'app', 'streamdeck', 'racing-desk', PLUGIN_DIR);
    fs.mkdirSync(path.join(src, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(src, 'manifest.json'), JSON.stringify({ Version: '0.1.0.0', CodePath: 'bin/plugin.js' }));
    fs.writeFileSync(path.join(src, 'bin', 'plugin.js'), '// plugin v1');
    const plugins = path.join(root, 'Elgato', 'StreamDeck', 'Plugins');
    fs.mkdirSync(plugins, { recursive: true });
    return { src, plugins };
  }

  test('the source is the unpacked copy beside the asar in the built app, and the folder beside main.js from source', () => {
    expect(installer.pluginSource('C:\\Racing Desk\\resources\\app.asar')).toBe(path.join('C:\\Racing Desk\\resources\\app.asar.unpacked', 'streamdeck', 'racing-desk', PLUGIN_DIR));
    expect(installer.pluginSource('C:\\Racing Desk\\resources\\app.asar\\sub')).toBe(path.join('C:\\Racing Desk\\resources\\app.asar.unpacked\\sub', 'streamdeck', 'racing-desk', PLUGIN_DIR));
    expect(installer.pluginSource('C:\\src\\apps\\overlay')).toBe(path.join('C:\\src\\apps\\overlay', 'streamdeck', 'racing-desk', PLUGIN_DIR));
    expect(installer.pluginsDir({ platform: 'win32', env: { APPDATA: 'C:\\Users\\Driver\\AppData\\Roaming' } })).toBe('C:\\Users\\Driver\\AppData\\Roaming\\Elgato\\StreamDeck\\Plugins');
    expect(installer.pluginsDir({ platform: 'linux' })).toBeNull();
  });

  test('copies when missing, keeps when the same, copies again when the app carries another build, removes the old plugin', () => {
    const { src, plugins } = tree(dir);
    fs.mkdirSync(path.join(plugins, 'com.k10motorsports.racecor.overlay.sdPlugin'), { recursive: true });
    const lines = [];
    const first = installer.install({ srcDir: src, pluginsDir: plugins, log: (l) => lines.push(l) });
    expect(first).toMatchObject({ ok: true, did: 'copied' });
    expect(fs.existsSync(path.join(plugins, PLUGIN_DIR, 'bin', 'plugin.js'))).toBe(true);
    expect(fs.existsSync(path.join(plugins, 'com.k10motorsports.racecor.overlay.sdPlugin'))).toBe(false);
    expect(lines.some((l) => /removed the old plugin/.test(l))).toBe(true);
    expect(installer.install({ srcDir: src, pluginsDir: plugins })).toMatchObject({ ok: true, did: 'kept' });
    fs.writeFileSync(path.join(src, 'bin', 'plugin.js'), '// plugin v2, longer');
    expect(installer.install({ srcDir: src, pluginsDir: plugins })).toMatchObject({ ok: true, did: 'copied' });
    expect(fs.readFileSync(path.join(plugins, PLUGIN_DIR, 'bin', 'plugin.js'), 'utf8')).toBe('// plugin v2, longer');
  });

  test('skips, in words, when the Stream Deck app is not installed, the plugin is not in the app, or it was not built', () => {
    const { src, plugins } = tree(dir);
    expect(installer.install({ srcDir: src, pluginsDir: path.join(dir, 'nowhere') })).toMatchObject({ ok: false, did: 'skipped', reason: /Stream Deck app is not installed/ });
    expect(installer.install({ srcDir: path.join(dir, 'missing'), pluginsDir: plugins })).toMatchObject({ ok: false, did: 'skipped', reason: /not in the app/ });
    fs.rmSync(path.join(src, 'bin'), { recursive: true });
    expect(installer.install({ srcDir: src, pluginsDir: plugins })).toMatchObject({ ok: false, did: 'skipped', reason: /was not built/ });
    expect(installer.install({ srcDir: src, pluginsDir: null })).toMatchObject({ ok: false, did: 'skipped' });
    expect(fs.existsSync(path.join(plugins, PLUGIN_DIR))).toBe(false);
  });

  test('a copy that fails is said, not thrown', () => {
    const { src, plugins } = tree(dir);
    const failing = { ...fs, cpSync: () => { throw new Error('EBUSY: held by the Stream Deck app'); } };
    expect(installer.install({ srcDir: src, pluginsDir: plugins, fs: failing })).toMatchObject({ ok: false, did: 'skipped', reason: /could not be copied.*EBUSY/ });
  });
});
