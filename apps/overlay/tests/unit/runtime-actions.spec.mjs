/**
 * The runtime's ?action= routes, asked for by the app's main process on the HUD's behalf (modules/js/runtime-actions.js).
 *
 * The runtime answers them to a program on this machine alone: the connection is this machine's, the Host names it, and
 * no browser sent it — no Origin, no Referer, no Sec-Fetch-Site. The HUD is a page, a file, whose requests carry an Origin
 * of "null", so it cannot fetch them; main.js (runtime:action) makes the request, as Node, which sends none of that.
 * Held here: only the routes the page uses are asked for, with their arguments and no others; only of a runtime on this
 * machine; every outcome is an answer; the request as it leaves Node is one the runtime takes, where one with a browser's
 * marks is refused as the real runtime refuses it; main.js passes the call on for the HUD's window and the desk's and no
 * other; and the page's scripts ask through config.js's runtimeAction and never fetch an ?action= route themselves.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const require = createRequire(import.meta.url);
const { ACTIONS, TIMEOUT_MS, MAX_LENGTH, problemWith, actionRequest, readAnswer, createRuntimeActions } = require('../../modules/js/runtime-actions.js');
const { send } = require('../../modules/js/rig-api.js');

const URL_8889 = 'http://localhost:8889/racing-desk/';

// A `send` that answers what the test sets — { status, text }, or a function of the request — and keeps what it was handed.
function recorder(answer = { status: 200, text: '{"ok":true}' }) {
  const sent = [];
  return {
    sent,
    send: async (request, timeoutMs) => {
      sent.push({ request, timeoutMs });
      return typeof answer === 'function' ? answer(request) : answer;
    },
  };
}

// ── What may be asked ──

test('the routes are the five the HUD uses, and none that writes to the hardware', () => {
  expect(Object.keys(ACTIONS).sort()).toEqual([
    'bindPedalProfile', 'listPedalProfiles', 'restartdemo', 'setPedalProfile', 'setrect',
  ]);
  expect(TIMEOUT_MS).toBe(3000);
  expect(MAX_LENGTH).toBe(200);
});

test('a route is asked for with the arguments it takes', () => {
  expect(problemWith('restartdemo', {})).toBeNull();
  expect(problemWith('restartdemo')).toBeNull();
  expect(problemWith('restartdemo', null)).toBeNull();
  expect(problemWith('listPedalProfiles', {})).toBeNull();
  expect(problemWith('setrect', { x: 0.1, y: 0.2, w: 0.5, h: 0.4 })).toBeNull();
  expect(problemWith('setrect', { x: -0.02, y: 0, w: 1.04, h: 1 })).toBeNull();   // a drag that ended outside the window
  expect(problemWith('setPedalProfile', { id: '283f91ae' })).toBeNull();
  expect(problemWith('bindPedalProfile', { id: '283f91ae' })).toBeNull();
  expect(problemWith('bindPedalProfile', { id: '283f91ae', car: 'mx5 mx52016' })).toBeNull();   // the car is the sim's, left out
});

test('a route the page has no business with is not asked for, whatever it is called', () => {
  for (const name of [
    'setMozaWheelbaseSetting', 'setMozaPedalSetting', 'setMozaHandbrakeSetting', 'mozaReconnect', 'mozaRefresh', 'importMozaPedals',
    'listMozaDevices', 'getMozaWheelbaseSettings', 'listSerialPortDiagnostic', 'listtracks', 'resetmap', 'setSetting', 'quit',
    '', ' restartdemo', 'RESTARTDEMO', 'restartdemo&action=mozaReconnect', '__proto__', 'constructor', 'toString', 'hasOwnProperty',
    null, undefined, 7, {}, ['restartdemo'],
  ]) {
    expect(problemWith(name, {}), String(name)).toBe('That is not a route the page may ask for.');
  }
});

test('an argument the route does not take, or one that is missing or wrong, is refused in words', () => {
  expect(problemWith('restartdemo', { x: 1 })).toBe('restartdemo takes no "x".');
  expect(problemWith('setPedalProfile', { id: 'a', key: 'b' })).toBe('setPedalProfile takes no "key".');
  expect(problemWith('setPedalProfile', { id: 'a', action: 'mozaReconnect' })).toBe('setPedalProfile takes no "action".');
  expect(problemWith('setPedalProfile', {})).toBe('setPedalProfile needs "id".');
  expect(problemWith('setrect', { x: 0, y: 0, w: 1 })).toBe('setrect needs "h".');
  expect(problemWith('setrect', { x: '0.1', y: 0, w: 1, h: 1 })).toBe('"x" is not a share of the screen.');
  expect(problemWith('setrect', { x: NaN, y: 0, w: 1, h: 1 })).toBe('"x" is not a share of the screen.');
  expect(problemWith('setrect', { x: Infinity, y: 0, w: 1, h: 1 })).toBe('"x" is not a share of the screen.');
  expect(problemWith('setrect', { x: 0, y: 0, w: 1e9, h: 1 })).toBe('"w" is not a share of the screen.');
  expect(problemWith('setPedalProfile', { id: '' })).toBe('"id" is not a name.');
  expect(problemWith('setPedalProfile', { id: 7 })).toBe('"id" is not a name.');
  expect(problemWith('setPedalProfile', { id: 'a'.repeat(MAX_LENGTH + 1) })).toBe(`"id" is longer than ${MAX_LENGTH} characters.`);
  expect(problemWith('setPedalProfile', { id: 'a'.repeat(MAX_LENGTH) })).toBeNull();
  expect(problemWith('setPedalProfile', { id: 'a\r\nHost: evil' })).toBe('"id" holds a character that is not printable.');
  expect(problemWith('setPedalProfile', ['a'])).toBe('The arguments are not an object.');
  expect(problemWith('setPedalProfile', 'a')).toBe('The arguments are not an object.');
});

// ── The request, as it leaves ──

test('the request is a GET of the route with its arguments, written here and not as they came', () => {
  expect(actionRequest(URL_8889, 'restartdemo', {})).toEqual({ url: `${URL_8889}?action=restartdemo`, method: 'GET', headers: { Accept: 'application/json' } });
  expect(actionRequest('http://localhost:8889/racing-desk', 'restartdemo').url).toBe(`${URL_8889}?action=restartdemo`);   // no path doubled
  expect(actionRequest('http://localhost:18889/racing-desk/', 'restartdemo').url).toBe('http://localhost:18889/racing-desk/?action=restartdemo');
  expect(actionRequest(URL_8889, 'setrect', { x: 0.1, y: 0.25, w: 0.5, h: 1 }).url)
    .toBe(`${URL_8889}?action=setrect&x=0.100000&y=0.250000&w=0.500000&h=1.000000`);
  // A name is encoded: nothing in it can start another parameter or another route.
  const url = actionRequest(URL_8889, 'setPedalProfile', { id: 'a&action=mozaReconnect#x y' }).url;
  expect(url).toBe(`${URL_8889}?action=setPedalProfile&id=a%26action%3DmozaReconnect%23x%20y`);
  expect(new URL(url).searchParams.getAll('action')).toEqual(['setPedalProfile']);
  // Only what the route takes goes into it, in the route's order.
  expect(actionRequest(URL_8889, 'bindPedalProfile', { car: 'mx5', id: 'a', extra: 'b' }).url).toBe(`${URL_8889}?action=bindPedalProfile&id=a&car=mx5`);
  // Nothing a browser says: Node adds the Host and the Connection, and never an Origin.
  expect(Object.keys(actionRequest(URL_8889, 'restartdemo', {}).headers)).toEqual(['Accept']);
});

test('the answer is the route\'s own on 200, and in words on anything else', () => {
  expect(readAnswer({ status: 200, text: '{"ok":true}' })).toEqual({ ok: true, body: { ok: true } });
  expect(readAnswer({ status: 200, text: '[{"id":"a","name":"A"}]' })).toEqual({ ok: true, body: [{ id: 'a', name: 'A' }] });
  expect(readAnswer({ status: 200, text: 'not json' })).toEqual({ ok: true, body: null });
  expect(readAnswer({ status: 403, text: '{"error":"this is for a program on this machine"}' }))
    .toEqual({ ok: false, error: 'The runtime refused the request: it is for programs on this machine alone.' });
  expect(readAnswer({ status: 500, text: '' })).toEqual({ ok: false, error: 'The runtime answered 500.' });
});

// ── Who is asked, and what happens when nobody answers ──

test('the runtime is asked where the HUD reads its telemetry now, and never with what is not a route', async () => {
  let where = URL_8889;
  const { sent, send: sendRequest } = recorder();
  const actions = createRuntimeActions({ url: () => where, send: sendRequest });

  expect(await actions.run('restartdemo', {})).toEqual({ ok: true, body: { ok: true } });
  where = 'http://localhost:9999/racing-desk/';   // dev mode: the replay's port
  await actions.run('setPedalProfile', { id: 'a' });
  expect(sent.map((s) => s.request.url)).toEqual([`${URL_8889}?action=restartdemo`, 'http://localhost:9999/racing-desk/?action=setPedalProfile&id=a']);
  expect(sent.map((s) => s.timeoutMs)).toEqual([3000, 3000]);

  const refused = await actions.run('setMozaWheelbaseSetting', { key: 'ffbStrength', value: 100 });
  expect(refused).toEqual({ ok: false, error: 'That is not a route the page may ask for.' });
  expect(sent).toHaveLength(2);   // never sent
});

test('a runtime on another machine is not asked', async () => {
  const { sent, send: sendRequest } = recorder();
  for (const url of ['http://192.168.1.20:8889/racing-desk/', 'http://rig.example:8889/racing-desk/', 'http://localhost.evil.example/racing-desk/']) {
    const actions = createRuntimeActions({ url, send: sendRequest });
    expect(await actions.run('restartdemo', {}), url).toEqual({ ok: false, error: 'The runtime is not on this machine, so it was not asked.' });
  }
  for (const url of ['http://localhost:8889/racing-desk/', 'http://127.0.0.1:8889/racing-desk/', 'http://[::1]:8889/racing-desk/']) {
    expect((await createRuntimeActions({ url, send: sendRequest }).run('restartdemo', {})).ok, url).toBe(true);
  }
  expect(sent).toHaveLength(3);
});

test('nothing to ask, nobody answering and a slow runtime are answers, not rejections', async () => {
  expect(await createRuntimeActions({ url: () => '', send: recorder().send }).run('restartdemo', {})).toEqual({ ok: false, error: 'There is no runtime to ask.' });
  expect(await createRuntimeActions({ url: () => { throw new Error('no settings'); }, send: recorder().send }).run('restartdemo', {}))
    .toEqual({ ok: false, error: 'There is no runtime to ask.' });
  const refusing = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8889'), { code: 'ECONNREFUSED' });
  expect(await createRuntimeActions({ url: URL_8889, send: async () => { throw refusing; } }).run('restartdemo', {}))
    .toEqual({ ok: false, error: 'Nothing is answering where the runtime should be.' });
  expect(await createRuntimeActions({ url: URL_8889, send: async () => { throw new Error('timeout'); } }).run('restartdemo', {}))
    .toEqual({ ok: false, error: 'The runtime did not answer within 3 s.' });
  expect(await createRuntimeActions({ url: URL_8889, send: async () => { throw new Error('socket hang up'); } }).run('restartdemo', {}))
    .toEqual({ ok: false, error: 'The runtime could not be asked: socket hang up' });
});

// ── As it leaves Node ──
// A stand-in for the runtime that decides as RacingDeskRuntime does (LocalRequest): 403 to a request with a browser's marks
// or a Host that is not this machine's, and the route's answer to any other.

function startRuntime() {
  const state = { asked: [] };
  const BROWSER = ['origin', 'referer', 'sec-fetch-site', 'sec-fetch-dest', 'sec-fetch-user'];
  const server = http.createServer((req, res) => {
    state.asked.push({ method: req.method, url: req.url, headers: req.headers });
    const fromThisMachine = !BROWSER.some((h) => req.headers[h] !== undefined) && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(req.headers.host || '');
    res.writeHead(fromThisMachine ? 200 : 403, { 'Content-Type': 'application/json' });
    res.end(fromThisMachine ? '{"ok":true}' : '{"error":"this is for a program on this machine"}');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    state,
    url: `http://127.0.0.1:${server.address().port}/racing-desk/`,
    close: () => new Promise((done) => { server.closeAllConnections(); server.close(done); }),
  })));
}

test('as it leaves Node: a request the runtime takes, where the same with a page\'s marks is refused', async () => {
  const runtime = await startRuntime();
  try {
    expect(await createRuntimeActions({ url: runtime.url }).run('setrect', { x: 0.1, y: 0.2, w: 0.5, h: 0.4 })).toEqual({ ok: true, body: { ok: true } });
    const asked = runtime.state.asked[0];
    expect(asked.method).toBe('GET');
    expect(asked.url).toBe('/racing-desk/?action=setrect&x=0.100000&y=0.200000&w=0.500000&h=0.400000');
    for (const mark of ['origin', 'referer', 'sec-fetch-site', 'sec-fetch-dest', 'sec-fetch-user']) expect(asked.headers, mark).not.toHaveProperty(mark);

    // What a page would send: the same request with one of its marks. The stand-in refuses each, as the runtime does.
    for (const marks of [{ Origin: 'null' }, { Referer: 'file:///C:/app/dashboard.html' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
      const fromAPage = actionRequest(runtime.url, 'restartdemo', {});
      fromAPage.headers = { ...fromAPage.headers, ...marks };
      expect((await send(fromAPage, 1000)).status, JSON.stringify(marks)).toBe(403);
    }
    const asPage = createRuntimeActions({ url: runtime.url, send: (request, ms) => send({ ...request, headers: { ...request.headers, Origin: 'null' } }, ms) });
    expect(await asPage.run('restartdemo', {})).toEqual({ ok: false, error: 'The runtime refused the request: it is for programs on this machine alone.' });
  } finally {
    await runtime.close();
  }
});

// ── Who may ask: main.js and the preload ──
// main.js cannot be loaded without Electron, so it is read as text, as rig-api.spec.mjs reads it.

const MAIN = readFileSync(new URL('../../main.js', import.meta.url), 'utf8');
const PRELOAD = readFileSync(new URL('../../preload.js', import.meta.url), 'utf8');

test('main.js passes runtime:action on for the HUD\'s window and the desk\'s, and no other', () => {
  const registered = MAIN.split("ipcMain.handle('runtime:action',");
  expect(registered, 'runtime:action is handled once').toHaveLength(2);
  const opening = /^\s*async \(([^)]*)\) => \{\r?\n/.exec(registered[1]);
  expect(opening, 'by a function written out where it is registered').not.toBeNull();
  expect(opening[1].split(',').map((name) => name.trim())).toEqual(['event', 'name', 'params']);
  const does = registered[1].slice(opening[0].length).split(/\r?\n\}\);/)[0].split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length && !l.startsWith('//'));
  // Anybody else is turned away first, in words, and the runtime is asked after that and nowhere else.
  expect(does[0]).toBe("if (!fromHud(event) && !fromDesk(event)) return { ok: false, error: 'The runtime is asked from the HUD and the desk alone.' };");
  expect(does[1]).toBe('return hudActions.run(name, params);');
  expect(does).toHaveLength(2);
  expect(MAIN.match(/\bhudActions\.run\(/g)).toHaveLength(1);

  // The windows are the senders themselves, not a name or an address a page gives.
  const fromHud = /\bconst fromHud = \(event\) => ([^;\n]+);/.exec(MAIN);
  expect(fromHud, 'fromHud is one expression over the event').not.toBeNull();
  expect(fromHud[1]).toContain('event.sender === overlayWindow.webContents');
  expect(fromHud[1]).toContain('!overlayWindow.isDestroyed()');
  expect(fromHud[1]).not.toContain('||');
  expect(MAIN.match(/\bfromHud\s*=/g)).toHaveLength(1);
});

test('main.js asks where the HUD\'s own polls go, and the preload hands the page the one call', () => {
  expect(MAIN).toMatch(/runtimeActions\.createRuntimeActions\(\{\s*(\/\/[^\n]*\n\s*)*url: \(\) => hudVisibility\.telemetryUrl\(loadSettingsSync\(\)\.simhubUrl, \{ replayPort: devMode \? devMode\.readArgs\(\)\.replayPort : null \}\),\s*\}\);/);
  expect(PRELOAD).toContain("runtimeAction: (name, params) => ipcRenderer.invoke('runtime:action', name, params),");
  expect(PRELOAD.match(/'runtime:action'/g)).toHaveLength(1);
});

// ── The page ──

const CONFIG = readFileSync(new URL('../../modules/js/config.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// config.js is a long list of globals; the one function in it is taken out and given the page's window and fetch.
function pageRuntimeAction({ window, fetch }) {
  const found = /\nfunction runtimeAction\(name, params\) \{\n[\s\S]*?\n\}\n/.exec(CONFIG);
  expect(found, 'config.js has runtimeAction').not.toBeNull();
  return new Function('window', 'fetch', 'SIMHUB_URL', `${found[0]}; return runtimeAction;`)(window, fetch, URL_8889);
}

test('in the app the page asks main.js, and gets the route\'s answer or a rejection with the words', async () => {
  const calls = [];
  const bridge = async (name, params) => { calls.push([name, params]); return { ok: true, body: [{ id: 'a' }] }; };
  const runtimeAction = pageRuntimeAction({ window: { racingDesk: { runtimeAction: bridge } }, fetch: () => { throw new Error('the page fetched'); } });
  expect(await runtimeAction('listPedalProfiles')).toEqual([{ id: 'a' }]);
  expect(await runtimeAction('setPedalProfile', { id: 'a' })).toEqual([{ id: 'a' }]);
  expect(calls).toEqual([['listPedalProfiles', {}], ['setPedalProfile', { id: 'a' }]]);

  const refusing = pageRuntimeAction({ window: { racingDesk: { runtimeAction: async () => ({ ok: false, error: 'The runtime did not answer within 3 s.' }) } }, fetch: () => { throw new Error('the page fetched'); } });
  await expect(refusing('restartdemo')).rejects.toThrow('The runtime did not answer within 3 s.');
  const silent = pageRuntimeAction({ window: { racingDesk: { runtimeAction: async () => undefined } }, fetch: () => { throw new Error('the page fetched'); } });
  await expect(silent('restartdemo')).rejects.toThrow('The runtime did not answer.');
});

test('without the app the page asks as it always did, and is refused where the runtime refuses it', async () => {
  const asked = [];
  const answer = (status, body) => async (url) => { asked.push(url); return { ok: status === 200, status, json: async () => body }; };

  const plain = pageRuntimeAction({ window: {}, fetch: answer(200, { ok: true }) });
  expect(await plain('setrect', { x: 0.1, y: 0.2 })).toEqual({ ok: true });
  expect(await plain('setPedalProfile', { id: 'a b' })).toEqual({ ok: true });
  expect(asked).toEqual([`${URL_8889}?action=setrect&x=0.1&y=0.2`, `${URL_8889}?action=setPedalProfile&id=a%20b`]);

  asked.length = 0;
  const onAnIpad = pageRuntimeAction({ window: { _simhubUrlOverride: 'http://192.168.1.50:9090/racing-desk/' }, fetch: answer(403, { error: 'x' }) });
  await expect(onAnIpad('restartdemo')).rejects.toThrow('The runtime answered 403.');
  expect(asked).toEqual(['http://192.168.1.50:9090/racing-desk/?action=restartdemo']);
});

// ── What the page's scripts do ──

// A script's code with its comments taken out.
function withoutComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// The bodies of a page's inline <script>s: what the page's own file runs, which a `src` does not name.
function inlineScripts(html) {
  return [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).filter((body) => body.trim().length > 0);
}

// Whether a script has an ?action= address of its own to fetch: a string that holds `action=`.
function namesAnActionRoute(code) {
  return /['"`][^'"`\n]*\baction=/.test(withoutComments(code));
}

// The routes a script asks runtimeAction for by name.
function routesAskedFor(code) {
  return [...withoutComments(code).matchAll(/\bruntimeAction\(\s*(['"`])([^'"`]+)\1/g)].map((m) => m[2]);
}

// Every script the page runs, as { name, code }: each .js under modules/ at any depth (the folders of tests left out), the
// inline scripts of each of the app's own pages, and the Cars island's source (apps/paints/src, which the desk runs as
// modules/desk/paints.bundle.js). A generated bundle is not read as itself: it is minified onto one line, where a quote
// and an `action=` a kilobyte apart (React's own `t.action=null`) read as one string, so its source is read instead.
function pageScripts() {
  const appDir = fileURLToPath(new URL('../../', import.meta.url));
  const scripts = [];
  const walk = (dir, root, isScript) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__' && entry.name !== 'node_modules') walk(full, root, isScript);
      } else if (isScript(entry.name)) {
        const code = readFileSync(full, 'utf8');
        if (/^\/\/ Generated by /.test(code)) continue;   // built from a source that is read in its place
        scripts.push({ name: relative(root, full).replace(/\\/g, '/'), code });
      }
    }
  };
  walk(join(appDir, 'modules'), appDir, (file) => file.endsWith('.js'));
  walk(join(appDir, '..', 'paints', 'src'), join(appDir, '..'), (file) => /\.(js|ts|tsx)$/.test(file));
  for (const page of readdirSync(appDir).filter((file) => file.endsWith('.html'))) {
    inlineScripts(readFileSync(join(appDir, page), 'utf8')).forEach((code, i) => scripts.push({ name: `${page} (inline script ${i + 1})`, code }));
  }
  return scripts;
}

// The two that make the request on a page's behalf: config.js's fallback (a browser, the iPad's page) and the app's own.
const OWN_SCRIPTS = new Set(['modules/js/config.js', 'modules/js/runtime-actions.js']);

test('the guards read what they are meant to: nested scripts, inline scripts, and a route the HUD may not ask for', () => {
  expect(namesAnActionRoute("fetch('http://localhost:8889/racing-desk/?action=setMozaPedalSetting&key=a')")).toBe(true);
  expect(namesAnActionRoute('fetch(`${base}?action=${name}`)')).toBe(true);
  expect(namesAnActionRoute("// fetch('?action=x')\n/* '?action=y' */ const a = 1; // 'action='")).toBe(false);
  expect(inlineScripts('<script src="a.js"></script><script>fetch("?action=restartdemo")</script><script type="module"> </script>')).toEqual(['fetch("?action=restartdemo")']);
  expect(routesAskedFor("runtimeAction('restartdemo'); runtimeAction( \"setSetting\", {}); function runtimeAction(name, params) {}")).toEqual(['restartdemo', 'setSetting']);

  // The list of scripts goes down into the folders, and the inline scripts of a page are among what is read.
  const names = pageScripts().map((script) => script.name);
  expect(names).toContain('modules/js/config.js');
  expect(names).toContain('modules/js/paints/apply.js');
  expect(names).toContain('modules/desk/desk.js');
  expect(names.some((name) => name.includes('__tests__'))).toBe(false);
  // The Cars island is read as its source, never as the bundle built from it (which may or may not be there).
  expect(names).toContain('paints/src/island.tsx');
  expect(names).not.toContain('modules/desk/paints.bundle.js');
});

test('no script of the page fetches an ?action= route itself: it asks through runtimeAction', () => {
  const offenders = pageScripts().filter(({ name, code }) => !OWN_SCRIPTS.has(name) && namesAnActionRoute(code)).map(({ name }) => name);
  expect(offenders).toEqual([]);
});

test('every route a script asks runtimeAction for is one the main process passes on', () => {
  const asked = pageScripts().flatMap(({ name, code }) => routesAskedFor(code).map((route) => ({ name, route })));
  // The scan finds the HUD's own calls (a regex that found none would pass for all of them).
  expect(new Set(asked.map(({ route }) => route))).toEqual(new Set(['restartdemo', 'setrect', 'listPedalProfiles', 'setPedalProfile', 'bindPedalProfile']));
  expect(asked.filter(({ route }) => !Object.prototype.hasOwnProperty.call(ACTIONS, route))).toEqual([]);
});
