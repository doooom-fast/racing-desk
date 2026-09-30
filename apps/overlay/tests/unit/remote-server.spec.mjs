/**
 * The HUD on an iPad (remote-server.js): what the server answers, to whom. Requests "from the network" are made up —
 * a request object with another machine's address on it — so nothing here listens on the network; the one real
 * server is on 127.0.0.1. The app folder is a temp one, with files in it that must never be served.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const remote = require('../../remote-server.js');

const KEY = 'abcd2345';
const IPAD = '192.168.1.50';
const RIG = [{ name: 'Ethernet', address: '192.168.1.20', virtual: false, home: true }];
const TELEMETRY = '{"RacingDesk.Plugin.GameRunning":1,"DataCorePlugin.GameData.Gear":"3"}';
const NEEDS_KEY = 'This address needs its key. Open the address the Racing Desk shows under Settings, or scan its code.';

let appDir;
test.beforeAll(() => {
  appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'racing-desk-remote-'));
  const put = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(appDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(appDir, rel), text);
  };
  put('dashboard.html', '<!DOCTYPE html><html><head><title>HUD</title>\n'
    + '<link rel="stylesheet" href="https://use.typekit.net/abc1def.css">\n'
    + '<link rel="stylesheet" href="fonts/mono.css">\n'
    + '<link href=\'http://fonts.example/x.css\' rel=\'stylesheet\'>\n'
    + '</head><body><div id="dashboard"></div></body></html>');
  put('modules/js/config.js', 'const SIMHUB_URL = "http://localhost:8889/racing-desk/";');
  put('modules/styles/base.css', 'body{}');
  put('images/logos/iracing.svg', '<svg/>');
  put('fonts/mono.woff2', 'font');
  // The app's own, which are nobody's business on the network.
  put('main.js', 'SECRET main');
  put('preload.js', 'SECRET preload');
  put('package.json', '{"secret":true}');
  put('k10-debug.log', 'SECRET log');
  put('overlay-settings.json', '{"remoteServerKey":"SECRET"}');
  put('modules/js/notes.txt', 'SECRET notes');
  put('modules/js/app.map', 'SECRET map');
  put('node_modules/thing/index.js', 'SECRET module');
  // A file named as the livery crop's address is: the crop comes from memory, never from here.
  put('livery-crop.png', 'SECRET file');
});
test.afterAll(() => { fs.rmSync(appDir, { recursive: true, force: true }); });

// The rig's telemetry, as http.get would give it: what was asked for is recorded, and `answer` is what comes back.
function telemetryOf(upstream, answer = {}) {
  return (url, _options, respond) => {
    upstream.push(url);
    const events = {};
    queueMicrotask(() => respond({
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      pipe: (to) => to.end(TELEMETRY),
      ...answer,
    }));
    return { on: (name, fn) => { events[name] = fn; }, destroy: () => {} };
  };
}

// One request through the handler, answered into a plain object. `from` is the address it came from; host: null
// is a request that names nobody.
function ask(target, { from = IPAD, host = '192.168.1.20:9090', method = 'GET', headers = {}, config = {}, answer } = {}) {
  const upstream = [];
  const dispatched = [];
  return new Promise((resolve) => {
    const out = { status: null, headers: {}, body: '', upstream, dispatched };
    const res = {
      headersSent: false,
      writableEnded: false,
      writeHead(status, h = {}) { out.status = status; out.headers = { ...out.headers, ...h }; this.headersSent = true; },
      end(data) {
        if (this.writableEnded) return;
        this.writableEnded = true;
        if (data !== undefined) out.body += Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
        if (Buffer.isBuffer(data)) out.bytes = data;   // as sent, for an answer that is not text
        resolve(out);
      },
    };
    const req = { method, url: target, headers: host === null ? { ...headers } : { host, ...headers }, socket: { remoteAddress: from } };
    remote.handleRequest({
      appDir,
      telemetryBase: 'http://localhost:8889',
      key: KEY,
      addresses: () => RIG,
      names: () => ['DESKTOP-RIG'],
      dispatchAction: (name) => { dispatched.push(name); return { ok: true }; },
      get: telemetryOf(upstream, answer),
      ...config,
    }, req, res);
  });
}

const withKey = { headers: { cookie: `${remote.KEY_COOKIE}=${KEY}` } };
const onTheRig = { from: '127.0.0.1', host: 'localhost:9090' };
// A program on the rig that says it is one: what a Stream Deck button sends.
const aProgram = { ...onTheRig, headers: { [remote.ACTION_HEADER]: '1' } };

test.describe('the key', () => {
  test('is eight characters nobody could mistake for one another, and new each time', () => {
    const keys = Array.from({ length: 200 }, () => remote.newKey());
    for (const key of keys) {
      expect(key).toMatch(/^[a-km-np-z2-9]{8}$/);
      expect(remote.isKey(key)).toBe(true);
    }
    expect(new Set(keys).size).toBe(200);
    for (const not of ['', 'abcd234', 'abcd23456', 'abcd234l', 'abcd2340', 'ABCD2345', null, undefined, 12345678, ['abcd2345']]) {
      expect(remote.isKey(not), String(not)).toBe(false);
    }
  });

  test('without it nothing is answered from the network: not the page, its files, the telemetry or the status', async () => {
    for (const target of ['/', '/racing-desk/', '/modules/js/config.js', '/images/logos/iracing.svg', '/api/status', '/?k=', '/?k=abcd2346', '/?k=abcd23456']) {
      const answer = await ask(target);
      expect(answer.status, target).toBe(403);
      expect(answer.body, target).toBe(NEEDS_KEY);
      expect(answer.upstream, target).toEqual([]);
    }
    const wrongCookie = await ask('/racing-desk/', { headers: { cookie: `${remote.KEY_COOKIE}=zzzz9999; other=1` } });
    expect(wrongCookie.status).toBe(403);
  });

  test('in the address it opens the page, which hands it back as a cookie for everything after', async () => {
    const page = await ask(`/?k=${KEY}`);
    expect(page.status).toBe(200);
    expect(page.headers['Content-Type']).toBe('text/html; charset=utf-8');
    expect(page.headers['Set-Cookie']).toBe(`${remote.KEY_COOKIE}=${KEY}; Max-Age=31536000; Path=/; HttpOnly; SameSite=Strict`);
    expect(page.headers['Referrer-Policy']).toBe('no-referrer');

    // The cookie alone opens the rest, and sets no cookie of its own again.
    const again = await ask('/', withKey);
    expect(again.status).toBe(200);
    expect(again.headers['Set-Cookie']).toBeUndefined();
    expect((await ask('/modules/js/config.js', { headers: { cookie: `a=b; ${remote.KEY_COOKIE}=${KEY}` } })).status).toBe(200);
  });

  test('on the rig itself none is needed — unless something on the rig is handing on a request from elsewhere', async () => {
    for (const from of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      expect((await ask('/', { from, host: 'localhost:9090' })).status, from).toBe(200);
      expect((await ask('/racing-desk/', { from, host: '127.0.0.1:9090' })).status, from).toBe(200);
    }
    for (const header of ['x-forwarded-for', 'forwarded', 'x-forwarded-host', 'x-real-ip']) {
      const handedOn = await ask('/', { ...onTheRig, headers: { [header]: '203.0.113.9' } });
      expect(handedOn.status, header).toBe(403);
      expect(remote.isLocal({ socket: { remoteAddress: '127.0.0.1' }, headers: { [header]: 'for=203.0.113.9' } }), header).toBe(false);
    }
    for (const from of ['127.0.0.2', '::ffff:7f00:1', '192.168.1.20', undefined]) {
      expect((await ask('/', { from, host: 'localhost:9090' })).status, String(from)).toBe(403);
    }
  });
});

test.describe('the page', () => {
  test('is the HUD, told that it is the remote one and that its telemetry is where it came from', async () => {
    const page = await ask('/', withKey);
    expect(page.body).toContain('<title>HUD</title>');
    expect(page.body).toContain('window._remoteMode = true;');
    expect(page.body).toContain("window._simhubUrlOverride = location.origin + '/racing-desk/';");
    expect(page.body).toContain('<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">');
    // Before anything of the page's own: the HUD's scripts read both as they load.
    expect(page.body.indexOf('window._remoteMode')).toBeLessThan(page.body.indexOf('<title>'));
    expect(page.body).not.toContain(KEY);
    // A browser's window has nothing behind it, and numbers that stop arriving have to say so.
    expect(page.body).toContain('html { background: #000; }');
    expect(page.body).toContain('body.rd-no-data::after');
  });

  test('waits for nothing from the internet: an iPad that has the rig and no internet is not left with a blank page', async () => {
    const page = await ask('/', withKey);
    // No stylesheet from the internet is left in the page's markup, where it would hold the page back...
    expect(page.body).not.toContain('fonts.example');
    expect(page.body).not.toMatch(/<link\b[^>]*https?:/i);
    expect(page.body).toContain('<link rel="stylesheet" href="fonts/mono.css">');   // its own are kept
    // ...the kit of the HUD's faces that the page named is asked for by a script, once the page has loaded, and only
    // that one: what else the page named is not asked for at all.
    expect(page.body).toContain('addEventListener(\'load\'');
    expect(page.body).toContain('var kits = ["https://use.typekit.net/abc1def.css"];');
    // Until its faces have come the HUD's own are stood in for by the condensed faces iPadOS has.
    expect(page.body).toContain(':root:not(.rd-kit)');
  });

  test('a stylesheet on another host than Typekit is never asked for, whatever the page names', () => {
    const html = '<html><head><link rel="stylesheet" href="https://evil.example/use.typekit.net/x.css">'
      + '<link rel="stylesheet" href="https://use.typekit.net.evil.example/x.css">'
      + '<link rel="stylesheet" href="http://use.typekit.net/x.css">'
      + '<link rel="stylesheet" href="https://use.typekit.net/aaa111.css"></head><body></body></html>';
    const out = remote.injectRemoteOverrides(html);
    expect(out).toContain('var kits = ["https://use.typekit.net/aaa111.css"];');
    expect(out).not.toMatch(/<link\b[^>]*https?:/i);
    expect(out).not.toContain('evil.example');
  });

  test('offers only what works on an iPad, and cannot be held inside another site\'s page', async () => {
    const page = await ask('/', withKey);
    expect(page.body).toContain("label: 'Full screen'");
    expect(page.body).toContain("label: 'Reconnect'");
    expect(page.body.match(/label: '[^']*'/g)).toEqual(["label: 'Full screen'", "label: 'Reconnect'"]);
    // …and the switch for the HUD's effects, kept on the iPad itself: its label says which way it is.
    expect(page.body).toContain("'Effects: off' : 'Effects: on'");
    expect(page.body).toContain("localStorage.setItem('rd-effects'");
    expect(page.headers['Content-Security-Policy']).toBe("frame-ancestors 'none'");
    expect(page.headers['X-Frame-Options']).toBe('DENY');
  });

  test('has nothing in it that the request said', async () => {
    const page = await ask(`/?k=${KEY}&x=%27%3Balert(1)%2F%2F`, { headers: { 'user-agent': '\';alert(2)//', referer: 'http://x/\';alert(3)//' } });
    expect(page.status).toBe(200);
    expect(page.body).not.toContain('alert(');
    expect(page.body).not.toContain('192.168.1.20');
  });
});

test.describe('the telemetry', () => {
  test('is fetched from the rig\'s own plugin or host, and handed on as it came', async () => {
    for (const target of ['/racing-desk/', '/racing-desk']) {
      const answer = await ask(target, withKey);
      expect(answer.status, target).toBe(200);
      expect(answer.body, target).toBe(TELEMETRY);
      expect(answer.headers['Content-Type'], target).toBe('application/json; charset=utf-8');
      expect(answer.headers['Cache-Control'], target).toBe('no-store');
      expect(answer.upstream, target).toEqual(['http://localhost:8889/racing-desk/']);
    }
    const elsewhere = await ask('/racing-desk/', { ...withKey, config: { telemetryBase: 'http://localhost:18889' } });
    expect(elsewhere.upstream).toEqual(['http://localhost:18889/racing-desk/']);
  });

  test('and nothing else of theirs: a request that would change anything is refused and never sent on', async () => {
    for (const target of [
      '/racing-desk/?action=setSetting&key=promptDuration&value=1',
      '/racing-desk/?action=bindPedalProfile&id=x',
      '/racing-desk/?action=setMozaPedalSetting&name=brake&value=0',
      '/racing-desk/?action=resetmap',
      '/racing-desk?x=1',
    ]) {
      const answer = await ask(target, onTheRig);   // even from the rig
      expect(answer.status, target).toBe(403);
      expect(answer.body, target).toContain('Read-only');
      expect(answer.upstream, target).toEqual([]);
    }
    expect((await ask('/racing-desk/?', onTheRig)).status).toBe(200);   // no query at all
    for (const target of [
      '/racing-desk/data/sessions', '/racing-desk/data/pedals', '/racing-desk/../main.js', '/racing-deskx',
      '/racing-desk/%3Faction=quit', '/racing-desk/;action=quit', '/RACING-DESK/',
    ]) {
      const answer = await ask(target, withKey);
      expect(answer.status, target).toBe(404);
      expect(answer.upstream, target).toEqual([]);
    }
  });

  test('is telemetry whatever the rig calls it, and an answer whatever the rig answers', async () => {
    const html = await ask('/racing-desk/', { ...withKey, answer: { headers: { 'content-type': 'text/html', 'set-cookie': 'x=1', location: 'http://x/' }, pipe: (to) => to.end('<script>alert(1)</script>') } });
    expect(html.headers['Content-Type']).toBe('application/json; charset=utf-8');
    expect(Object.keys(html.headers).map((h) => h.toLowerCase())).not.toContain('set-cookie');
    expect(Object.keys(html.headers).map((h) => h.toLowerCase())).not.toContain('location');

    expect((await ask('/racing-desk/', { ...withKey, answer: { statusCode: 503 } })).status).toBe(503);
    for (const statusCode of [99, 101, 600, 0, undefined, 'OK']) {
      expect((await ask('/racing-desk/', { ...withKey, answer: { statusCode } })).status, String(statusCode)).toBe(502);
    }
    // A rig that breaks off part-way, or throws, still ends the iPad's request.
    const threw = await ask('/racing-desk/', { ...withKey, answer: { pipe: () => { throw new Error('gone'); } } });
    expect(threw.status).toBe(200);   // the status had gone out; the answer is ended, not left open
  });

  test('when the rig\'s telemetry is not answering, that is what the iPad is told', async () => {
    const answer = await ask('/racing-desk/', {
      ...withKey,
      config: {
        get: () => {
          const events = {};
          queueMicrotask(() => events.error(new Error('connect ECONNREFUSED 127.0.0.1:8889')));
          return { on: (name, fn) => { events[name] = fn; }, destroy: () => {} };
        },
      },
    });
    expect(answer.status).toBe(502);
    expect(JSON.parse(answer.body).error).toBe('The telemetry is not answering on the rig.');
  });
});

test.describe('the livery crop', () => {
  // What the main process holds: a PNG's signature and a few bytes are enough for the server, which reads none of it.
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const held = { crop: () => ({ png: PNG, id: '3-11' }) };

  test('is served whole from the main process\'s memory at its one address, tagged, never cached', async () => {
    const answer = await ask(remote.CROP_PATH, { ...withKey, config: held });
    expect(remote.CROP_PATH).toBe('/livery-crop.png');
    expect(answer.status).toBe(200);
    expect(answer.headers['Content-Type']).toBe('image/png');
    expect(answer.headers['Cache-Control']).toBe('no-store');
    expect(answer.headers['Content-Length']).toBe(PNG.length);
    expect(answer.headers.ETag).toBe('"3-11"');
    expect(Buffer.compare(answer.bytes, PNG)).toBe(0);
    expect(answer.upstream).toEqual([]);
    // The tag is the crop's id and nothing else that could be put in a header.
    const odd = await ask(remote.CROP_PATH, { ...withKey, config: { crop: () => ({ png: PNG, id: 'a"b\r\nX: y' }) } });
    expect(odd.headers.ETag).toBe('"abXy"');
    expect((await ask(remote.CROP_PATH, { ...withKey, config: { crop: () => ({ png: PNG }) } })).headers.ETag).toBe(`"${PNG.length}"`);
    // On the rig itself no key is needed, as for the rest; asked with HEAD it says the same.
    expect((await ask(remote.CROP_PATH, { ...onTheRig, config: held })).status).toBe(200);
    expect((await ask(remote.CROP_PATH, { ...withKey, config: held, method: 'HEAD' })).status).toBe(200);
    expect(Object.keys(answer.headers).map((h) => h.toLowerCase())).not.toContain('access-control-allow-origin');
  });

  test('needs the key from the network, takes no query, and is not a file', async () => {
    const noKey = await ask(remote.CROP_PATH, { config: held });
    expect(noKey.status).toBe(403);
    expect(noKey.body).toBe(NEEDS_KEY);
    for (const target of [`${remote.CROP_PATH}?x=1`, `${remote.CROP_PATH}?k=${KEY}`, `${remote.CROP_PATH}/`, '/livery-crop.PNG', '/livery-crop', '/images/livery-crop.png']) {
      const answer = await ask(target, { ...withKey, config: held });
      expect(answer.status, target).toBe(404);
      expect(answer.bytes, target).toBeUndefined();
      expect(answer.body, target).not.toContain('SECRET');
    }
    expect((await ask(`${remote.CROP_PATH}?`, { ...withKey, config: held })).status).toBe(200);   // no query at all
    // A request naming the address as a query of something else changes nothing either.
    expect((await ask(`/racing-desk/?${remote.CROP_PATH}`, { ...withKey, config: held })).status).toBe(403);
    expect((await ask(remote.CROP_PATH, { ...withKey, config: held, method: 'POST' })).status).toBe(405);
  });

  test('is 404 while there is none to show, and the file of that name in the app folder is never it', async () => {
    for (const [what, crop] of Object.entries({
      'no crop function': undefined,
      'none held': () => null,
      'nothing': () => undefined,
      'not a PNG': () => ({ png: 'not bytes', id: '1' }),
      'empty': () => ({ png: Buffer.alloc(0), id: '1' }),
      'a throw': () => { throw new Error('gone'); },
    })) {
      const answer = await ask(remote.CROP_PATH, { ...withKey, config: { crop } });
      expect(answer.status, what).toBe(404);
      expect(answer.body, what).toBe('No livery crop to show.');
      expect(answer.headers['Cache-Control'], what).toBe('no-store');
    }
    expect(fs.existsSync(path.join(appDir, 'livery-crop.png'))).toBe(true);
    expect(remote.staticFile(appDir, remote.CROP_PATH)).toBeNull();
  });
});

test.describe('the page\'s files', () => {
  test('are served, with their types', async () => {
    const files = {
      '/modules/js/config.js': 'application/javascript',
      '/modules/styles/base.css': 'text/css',
      '/images/logos/iracing.svg': 'image/svg+xml',
      '/fonts/mono.woff2': 'font/woff2',
    };
    for (const [target, type] of Object.entries(files)) {
      const answer = await ask(target, withKey);
      expect(answer.status, target).toBe(200);
      expect(answer.headers['Content-Type'], target).toBe(type);
      expect(answer.headers['X-Content-Type-Options'], target).toBe('nosniff');
    }
  });

  test('and no other file of the app\'s, by any spelling', async () => {
    for (const target of [
      '/main.js', '/preload.js', '/package.json', '/k10-debug.log', '/overlay-settings.json', '/dashboard.html',
      '/node_modules/thing/index.js', '/modules/js/notes.txt', '/modules/js/app.map', '/modules', '/modules/', '/images',
      '/modules/../main.js', '/modules/js/../../main.js', '/modules/%2e%2e/main.js', '/modules/..%2fmain.js',
      '/modules/..%5cmain.js', '/modules/js/..%5c..%5cmain.js', '/modules//..//main.js', '/MODULES/../main.js',
      '/images/C:%5cWindows%5cwin.ini', '/modules/js/config.js%00.png', '/fonts/../package.json',
      '/modules/js/config.js::$DATA', '/modules/%252e%252e/main.js',
    ]) {
      const answer = await ask(target, withKey);
      expect([400, 404], target).toContain(answer.status);
      expect(answer.body, target).not.toContain('SECRET');
    }
    expect(remote.staticFile(appDir, '/modules/js/config.js').file).toBe(path.join(appDir, 'modules', 'js', 'config.js'));
    expect(remote.staticFile(appDir, '/main.js')).toBeNull();
    expect(remote.staticFile(appDir, '/modules/../main.js')).toBeNull();
  });
});

test.describe('the actions', () => {
  const targets = ['/api/action/quit', '/api/action/toggle-overlay', '/api/actions'];

  test('are not for the network, key or no key, header or no header', async () => {
    for (const options of [{}, withKey, { headers: { ...withKey.headers, [remote.ACTION_HEADER]: '1' } }]) {
      for (const target of targets) {
        const answer = await ask(target, options);
        expect(answer.status, target).toBe(403);
        expect(answer.dispatched, target).toEqual([]);
      }
    }
  });

  test('are not for a browser on the rig: not a page\'s script, nor a link, an image or a form in one', async () => {
    const browser = (headers) => ({ ...onTheRig, headers });
    for (const [what, options] of Object.entries({
      // What Chromium sends when a page on another site does each of these to http://localhost:9090/api/action/quit.
      'a link followed, or location.href': browser({ 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', referer: 'http://elsewhere.example/' }),
      'an image': browser({ 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'image' }),
      'a script tag': browser({ 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'script' }),
      'a form': browser({ 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'sec-fetch-user': '?1' }),
      'fetch from a page': browser({ origin: 'http://elsewhere.example', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' }),
      'a page with no referrer policy to speak of': browser({ referer: 'http://127.0.0.1:58837/' }),
      'an address typed into the bar': browser({ 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'sec-fetch-user': '?1' }),
      // An old browser that says none of that still cannot say it is a program: a link carries no header of a page's choosing.
      'a browser that says nothing': onTheRig,
      'the header, and a browser\'s too': browser({ [remote.ACTION_HEADER]: '1', 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'empty' }),
      'the header with another value': browser({ [remote.ACTION_HEADER]: 'true' }),
    })) {
      for (const target of targets) {
        const answer = await ask(target, options);
        expect(answer.status, `${what}: ${target}`).toBe(403);
        expect(answer.dispatched, `${what}: ${target}`).toEqual([]);
      }
    }
  });

  test('are for a program on the rig that says it is one, and only the ones there are', async () => {
    const ran = await ask('/api/action/toggle-leaderboard', aProgram);
    expect(ran.status).toBe(200);
    expect(JSON.parse(ran.body)).toEqual({ ok: true });
    expect(ran.dispatched).toEqual(['toggle-leaderboard']);

    // Node's fetch, which the Stream Deck button uses, says what mode it is in and no more.
    const viaNodeFetch = await ask('/api/action/quit', { ...onTheRig, headers: { [remote.ACTION_HEADER]: '1', 'sec-fetch-mode': 'cors', 'user-agent': 'node' } });
    expect(viaNodeFetch.dispatched).toEqual(['quit']);

    const unknown = await ask('/api/action/format-c', aProgram);
    expect(unknown.status).toBe(404);
    expect(unknown.dispatched).toEqual([]);

    const list = JSON.parse((await ask('/api/actions', aProgram)).body);
    expect(list.actions.map((a) => a.name)).toContain('quit');
    expect((await ask('/api/action/quit', { ...aProgram, config: { dispatchAction: null } })).status).toBe(503);

    // Asking what a request would answer is not a way to run it.
    const head = await ask('/api/action/quit', { ...aProgram, method: 'HEAD' });
    expect(head.status).toBe(403);
    expect(head.dispatched).toEqual([]);
    // Nor is being handed on by something else on the rig.
    const handedOn = await ask('/api/action/quit', { ...onTheRig, headers: { [remote.ACTION_HEADER]: '1', 'x-forwarded-for': '203.0.113.9' } });
    expect(handedOn.status).toBe(403);
    expect(handedOn.dispatched).toEqual([]);
  });
});

test.describe('who is asked for', () => {
  test('has to be this machine, by one of its own names', async () => {
    for (const host of [
      '192.168.1.20:9090', '192.168.1.20', 'localhost:9090', '127.0.0.1:9090', '[::1]:9090', 'LOCALHOST:9090',
      'desktop-rig:9090', 'DESKTOP-RIG', 'desktop-rig.local:9090',
    ]) {
      expect((await ask('/', { ...withKey, host })).status, host).toBe(200);
    }
    // A name somebody else points at the rig, to read through the browser of someone at home.
    for (const host of [
      'evil.example:9090', 'rig.evil.example', '192.168.1.21:9090', '192.168.1.20.evil.example:9090', '', null, 'a b',
      'desktop-rig.evil.example', 'evil.example@localhost', 'localhost/evil.example', '2130706433', 'localhost:9090:1',
      'localhost:', '-localhost', 'localhost.',
    ]) {
      const network = await ask('/', { ...withKey, host });
      expect(network.status, `${host} from the network`).toBe(403);
      // The network is told no more than it is about a missing key: not which names are the rig's.
      expect(network.body, `${host} from the network`).toBe(NEEDS_KEY);
      const local = await ask('/', { ...onTheRig, host });
      expect(local.status, `${host} from the rig`).toBe(403);
      expect(local.body, `${host} from the rig`).toBe('That is not this machine\'s name.');
    }
    expect(remote.namesThisMachine('192.168.1.20:9090', RIG)).toBe(true);
    expect(remote.namesThisMachine('10.0.0.5:9090', RIG)).toBe(false);
    expect(remote.namesThisMachine('rig:9090', RIG, ['', null, 'RIG'])).toBe(true);
    expect(remote.namesThisMachine('.local', RIG, [''])).toBe(false);
  });

  test('only by GET: the server changes nothing, so it takes nothing', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'TRACE']) {
      const answer = await ask('/racing-desk/', { ...withKey, method });
      expect(answer.status, method).toBe(405);
      expect(answer.upstream, method).toEqual([]);
    }
    expect((await ask('/', { ...withKey, method: 'HEAD' })).status).toBe(200);
  });

  test('an address that is not one is refused, not thrown on', async () => {
    for (const target of ['/%', '/%E0%A4%A', '/modules/%zz']) {
      expect((await ask(target, withKey)).status, target).toBe(400);
    }
  });

  test('no answer invites another site to read it', async () => {
    for (const target of ['/', '/racing-desk/', '/modules/js/config.js', '/api/status']) {
      const answer = await ask(target, withKey);
      expect(Object.keys(answer.headers).map((h) => h.toLowerCase()), target).not.toContain('access-control-allow-origin');
    }
  });
});

test.describe('the rig\'s addresses', () => {
  const v4 = (address, internal = false) => ({ address, family: 'IPv4', internal });

  test('the home network on a real adapter comes first; what nothing in the house can reach comes last or not at all', () => {
    const found = remote.lanAddresses({
      'vEthernet (WSL)': [v4('172.29.64.1')],
      'Loopback Pseudo-Interface 1': [v4('127.0.0.1', true)],
      'Wi-Fi': [{ address: 'fe80::1', family: 'IPv6', internal: false }, v4('192.168.1.20')],
      Tailscale: [v4('100.101.102.103')],
      'Ethernet 2': [v4('169.254.12.7')],           // no network answered
      Ethernet: [{ address: '10.0.0.5', family: 4, internal: false }],   // Node 18 said 4 for the family
    });
    expect(found.map((a) => `${a.name}: ${a.address}`)).toEqual([
      'Ethernet: 10.0.0.5', 'Wi-Fi: 192.168.1.20', 'vEthernet (WSL): 172.29.64.1', 'Tailscale: 100.101.102.103',
    ]);
    expect(remote.getLanAddress({ 'Wi-Fi': [v4('192.168.1.20')] })).toBe('192.168.1.20');
  });

  test('a rig on no network has none', () => {
    expect(remote.lanAddresses({ 'Loopback Pseudo-Interface 1': [v4('127.0.0.1', true)] })).toEqual([]);
    expect(remote.lanAddresses({})).toEqual([]);
    expect(remote.lanAddresses(null)).toEqual([]);
    expect(remote.getLanAddress({})).toBeNull();
  });
});

test('the telemetry is where the settings say only when they say it as the HUD would take it', () => {
  expect(remote.telemetryBase('http://localhost:18889/racing-desk/')).toBe('http://localhost:18889');
  expect(remote.telemetryBase('http://localhost:8889/racing-desk')).toBe('http://localhost:8889');
  for (const not of [
    undefined, null, '', 42, 'http://localhost:8889', 'http://localhost:8889/racecor-io-pro-drive/',
    'http://localhost:8889/k10-media-broadcaster/', 'https://localhost:8889/racing-desk/', 'not a url/racing-desk/',
  ]) {
    expect(remote.telemetryBase(not), String(not)).toBe('http://localhost:8889');
  }
});

// ── The one real server, on 127.0.0.1 ──

function freePort() {
  return new Promise((resolve) => {
    const probe = http.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

test.describe('starting and stopping', () => {
  test.afterEach(async () => { await remote.stop(); });

  test('it will not start without a key', async () => {
    const port = await freePort();
    await expect(remote.start({ port, host: '127.0.0.1', appDir })).rejects.toThrow('needs a key');
    await expect(remote.start({ port, host: '127.0.0.1', appDir, key: 'short' })).rejects.toThrow('needs a key');
    expect(remote.isRunning()).toBe(false);
  });

  test('nor on the port its telemetry comes from', async () => {
    const port = await freePort();
    for (const telemetryUrl of [`http://localhost:${port}/racing-desk/`, `http://127.0.0.1:${port}/racing-desk/`, `http://LOCALHOST:${port}/racing-desk`]) {
      await expect(remote.start({ port, host: '127.0.0.1', appDir, key: KEY, telemetryUrl, log: () => {} }), telemetryUrl)
        .rejects.toThrow(`Port ${port} is where the telemetry is read from. Choose another port.`);
    }
    expect(remote.isRunning()).toBe(false);
  });

  test('started, it answers; stopped, the port is free again', async () => {
    const port = await freePort();
    const logged = [];
    const info = await remote.start({ port, host: '127.0.0.1', appDir, key: KEY, log: (m) => logged.push(m) });
    expect(info.running).toBe(true);
    expect(info.port).toBe(port);
    expect(remote.isRunning()).toBe(true);
    if (info.url !== null) expect(info.url).toBe(`http://${info.lanAddress}:${port}/?k=${KEY}`);
    for (const a of info.addresses) expect(a.url).toBe(`http://${a.address}:${port}/?k=${KEY}`);
    // The key is for the address on the Settings page, not for the log.
    expect(logged.join('\n')).not.toContain(KEY);

    const page = await fetch(`http://127.0.0.1:${port}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('window._remoteMode = true;');
    expect((await fetch(`http://127.0.0.1:${port}/main.js`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${port}/racing-desk/?action=quit`)).status).toBe(403);
    // A program on the rig, as the Stream Deck button is: Node's fetch, saying it is one. No dispatcher is set
    // here, so nothing runs — and the answer says the request got as far as one.
    expect((await fetch(`http://127.0.0.1:${port}/api/action/zoom-in`, { headers: { 'X-Racing-Desk': '1' } })).status).toBe(503);
    expect((await fetch(`http://127.0.0.1:${port}/api/action/zoom-in`)).status).toBe(403);

    // A second start is the one that is running.
    expect((await remote.start({ port: port + 1, host: '127.0.0.1', appDir, key: KEY })).port).toBe(port);

    await remote.stop();
    expect(remote.isRunning()).toBe(false);
    expect(remote.getInfo().running).toBe(false);
    await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
    await remote.stop();   // stopping what is stopped is nothing
  });

  test('two starts at once are one server, which stop stops', async () => {
    const [a, b] = [await freePort(), await freePort()];
    const [first, second] = await Promise.all([
      remote.start({ port: a, host: '127.0.0.1', appDir, key: KEY, log: () => {} }),
      remote.start({ port: b, host: '127.0.0.1', appDir, key: KEY, log: () => {} }),
    ]);
    expect(first.port).toBe(a);
    expect(second.port).toBe(a);
    await remote.stop();
    await expect(fetch(`http://127.0.0.1:${a}/`)).rejects.toThrow();
    await expect(fetch(`http://127.0.0.1:${b}/`)).rejects.toThrow();
  });

  // The whole way, with the real HUD in a browser that has no app around it — which is what an iPad is. The
  // telemetry is a stand-in on 127.0.0.1; every address but 127.0.0.1 is shut, so nothing reaches the network.
  test('a browser is shown the glance layout, asks the rig it came from for its telemetry, and says when there is none', async ({ page }) => {
    test.setTimeout(90000);   // it waits out the page's own back-off, twice
    const asked = [];
    let answering = true;
    const telemetry = http.createServer((req, res) => {
      asked.push(`${req.method} ${req.url}`);
      if (!answering) { res.destroy(); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"RacingDesk.Plugin.GameRunning":0}');
    });
    await new Promise((resolve) => telemetry.listen(0, '127.0.0.1', resolve));
    const port = await freePort();
    const overlay = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    try {
      await remote.start({
        port, host: '127.0.0.1', appDir: overlay, key: KEY, log: () => {},
        telemetryUrl: `http://127.0.0.1:${telemetry.address().port}/racing-desk/`,
      });

      const requested = [];
      const errors = [];
      page.on('request', (r) => requested.push(r.url()));
      page.on('pageerror', (e) => errors.push(e.message));
      await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
      // What the page adds to itself, and when: the kit is a stylesheet added by script, and it has to be after the
      // page has loaded ('complete' is what the document says during the load event, and after it).
      await page.addInitScript(() => {
        // This iPad had its effects switched off before (a headless browser draws their WebGL in software, at the cost
        // of the tests beside this one); the switch is tried below.
        try { localStorage.setItem('rd-effects', 'off'); } catch (e) { /* none */ }
        window.__added = [];
        new MutationObserver((records) => {
          for (const r of records) for (const n of r.addedNodes) {
            if (n.tagName === 'LINK') window.__added.push({ href: n.href, readyState: document.readyState });
          }
        }).observe(document, { childList: true, subtree: true });   // the document: its <html> is not there yet
      });
      await page.setViewportSize({ width: 1180, height: 820 });   // an iPad, on its side
      await page.goto(`http://127.0.0.1:${port}/`);

      const mine = `http://127.0.0.1:${port}/racing-desk/`;
      await expect.poll(() => requested.filter((u) => u === mine).length, { timeout: 10000 }).toBeGreaterThan(2);
      // What the server said is still what the page has, after its settings were applied.
      expect(await page.evaluate(() => [window._remoteMode, window._simhubUrlOverride])).toEqual([true, mine]);
      // Nothing was asked of the iPad itself or of the rig to change anything, and the one thing asked of the internet
      // is the HUD's typefaces, from Typekit, by a stylesheet the page added after it had loaded.
      expect(requested.filter((u) => !u.startsWith(`http://127.0.0.1:${port}/`))).toEqual(['https://use.typekit.net/pdg5yka.css']);
      expect(requested.filter((u) => u.includes('?action='))).toEqual([]);
      const added = await page.evaluate(() => window.__added.filter((a) => /typekit/.test(a.href)));
      expect(added).toEqual([{ href: 'https://use.typekit.net/pdg5yka.css', readyState: 'complete' }]);
      // With the kit refused the page is drawn all the same, in the stand-in faces.
      expect(await page.evaluate(() => document.documentElement.classList.contains('rd-kit'))).toBe(false);
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ff'))).toContain('Avenir Next Condensed');

      // It is the glance layout: the HUD's own panels as the cells of a grid, all in sight (drive-view.spec.mjs has
      // the sizes), and the menu is one of them.
      expect(await page.evaluate(() => getComputedStyle(document.body).display)).toBe('grid');
      for (const id of ['leaderboardPanel', 'positionPage', 'fullMapSvg', 'gapsBlock', 'rd-remote-menu-fab']) {
        await expect(page.locator('#' + id), id).toBeVisible();
        const inside = await page.evaluate((i) => {
          const r = document.getElementById(i).getBoundingClientRect();
          return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
        }, id);
        expect(inside, `${id} inside the window`).toBe(true);
      }
      expect(await page.locator('#driveHud').count()).toBe(0);
      await expect(page.locator('#rd-remote-menu-fab')).toBeVisible();
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe('rgb(0, 0, 0)');
      expect(await page.evaluate(() => document.body.classList.contains('rd-no-data'))).toBe(false);

      // The menu works, and what it offers is there to offer.
      await page.locator('#rd-remote-menu-fab').click();
      // The effects were off on this iPad from before, and the page began without them.
      await expect(page.locator('#rd-remote-menu-panel .rd-rm-btn')).toHaveText(['Full screen', 'Reconnect', 'Effects: off']);
      expect(await page.evaluate(() => [window._rdEffectsOff, document.documentElement.classList.contains('rd-effects-off')])).toEqual([true, true]);
      // They go on and off from here, the menu staying open, and the iPad keeps the choice.
      await page.locator('#rd-remote-menu-panel .rd-rm-btn', { hasText: 'Effects' }).click();
      await expect(page.locator('#rd-remote-menu-panel .rd-rm-btn').nth(2)).toHaveText('Effects: on');
      expect(await page.evaluate(() => [window._rdEffectsOff, document.documentElement.classList.contains('rd-effects-off'), localStorage.getItem('rd-effects')]))
        .toEqual([false, false, 'on']);
      await page.locator('#rd-remote-menu-panel .rd-rm-btn', { hasText: 'Effects' }).click();
      expect(await page.evaluate(() => [window._rdEffectsOff, document.documentElement.classList.contains('rd-effects-off'), localStorage.getItem('rd-effects')]))
        .toEqual([true, true, 'off']);
      await page.locator('#rd-remote-menu-panel .rd-rm-btn', { hasText: 'Reconnect' }).click();
      await expect(page.locator('#rd-remote-menu-panel')).toBeHidden();

      // The rig goes quiet: the numbers on the iPad are no longer the rig's, and the page says so.
      answering = false;
      await expect.poll(() => page.evaluate(() => document.body.classList.contains('rd-no-data')), { timeout: 15000 }).toBe(true);
      expect(await page.evaluate(() => getComputedStyle(document.body, '::after').content)).toBe('"No data from the rig"');
      answering = true;
      await expect.poll(() => page.evaluate(() => document.body.classList.contains('rd-no-data')), { timeout: 20000 }).toBe(false);

      expect(errors).toEqual([]);
      // And the rig's telemetry was only ever read.
      expect([...new Set(asked)]).toEqual(['GET /racing-desk/']);
    } finally {
      await new Promise((resolve) => { telemetry.close(resolve); telemetry.closeAllConnections(); });
    }
  });

  // The kit is Adobe's, and its files are not to be copied, so the tests serve stand-ins under its address: a stylesheet
  // that names the two faces, and a font file that is the bundled mono (nobody's licence but its own).
  test('when the kit arrives the page changes over to the HUD\'s faces, and until it does it is in the stand-ins', async ({ page }) => {
    const port = await freePort();
    const overlay = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    try {
      await remote.start({ port, host: '127.0.0.1', appDir: overlay, key: KEY, log: () => {}, telemetryUrl: 'http://127.0.0.1:1/racing-desk/' });
      const font = `http://127.0.0.1:${port}/fonts/jetbrains-mono/jetbrains-mono-latin-700-normal.woff2`;
      let kitAsked = 0;
      await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
        if (route.request().url() !== 'https://use.typekit.net/pdg5yka.css') return route.abort();
        kitAsked++;
        await route.fulfill({
          status: 200, contentType: 'text/css', headers: { 'Access-Control-Allow-Origin': '*' },
          body: `@font-face{font-family:sofia-pro-comp;font-weight:700;src:url(${font}) format("woff2")}`
            + `@font-face{font-family:stolzl;font-weight:400;src:url(${font}) format("woff2")}`,
        });
      });
      await page.setViewportSize({ width: 1180, height: 820 });
      await page.goto(`http://127.0.0.1:${port}/`);
      await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('rd-kit')), { timeout: 10000 }).toBe(true);
      expect(kitAsked).toBe(1);
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ff'))).toContain('sofia-pro-comp');
      expect(await page.evaluate(() => getComputedStyle(document.querySelector('.lb-header')).fontFamily)).toContain('sofia-pro-comp');
    } finally {
      await remote.stop();
    }
  });

  test('a port another program has is said in words', async () => {
    const port = await freePort();
    const other = http.createServer();
    await new Promise((resolve) => other.listen(port, '127.0.0.1', resolve));
    try {
      await expect(remote.start({ port, host: '127.0.0.1', appDir, key: KEY, log: () => {} }))
        .rejects.toThrow(`Port ${port} is in use by another program. Choose another port.`);
      expect(remote.isRunning()).toBe(false);
    } finally {
      await new Promise((resolve) => other.close(resolve));
    }
  });
});
