/**
 * What the desk reads of the host's store (modules/js/desk-reads.js): status, sessions, schedule and one session, made by Node
 * for the page (main.js, desk:read) because the host answers programs on this machine and no page, the desk's own included.
 * Each comes back as { value } or as an { error } the desk can say in words, and nothing is thrown. Mostly over a `send` that
 * records what it was handed, so that what is sent (a Host and no Origin, and nothing at all to another machine) is looked at;
 * the same reads over a real socket against the stand-in host that makes the host's check are in host-reads-this-machine.spec.mjs.
 *
 * And who may ask: main.js, read as text, answers the desk window alone; and the desk's page does not fetch.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const {
  READS, MAX_BYTES, TIMEOUT_MS, createDeskReads, deskHostOf, isHere, readAnswer, readProblem, readRequest,
} = require('../../modules/js/desk-reads.js');

function recorder(answer = { status: 200, text: JSON.stringify({ schemaVersion: 8 }) }) {
  const sent = [];
  return {
    sent,
    send: async (request, timeoutMs) => {
      sent.push({ request, timeoutMs });
      if (typeof answer === 'function') return answer(request);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

const HOST = 'http://localhost:8889';

test('the contract: four reads, each a GET of one data route, with no Origin and no body', () => {
  expect(READS).toEqual(['status', 'sessions', 'schedule', 'session']);
  expect(readRequest(HOST, 'status')).toEqual({ url: `${HOST}/racing-desk/data/status`, method: 'GET', headers: { Accept: 'application/json' }, maxBytes: MAX_BYTES });
  expect(readRequest(`${HOST}/`, 'sessions').url).toBe(`${HOST}/racing-desk/data/sessions`);
  expect(readRequest(HOST, 'schedule').url).toBe(`${HOST}/racing-desk/data/schedule`);
  expect(readRequest(HOST, 'session', 1042).url).toBe(`${HOST}/racing-desk/data/session?id=1042`);
  // Node adds a Host and a Connection; what is written here is all that could say a browser sent it.
  for (const route of READS) {
    const request = readRequest(HOST, route, 1);
    expect(Object.keys(request.headers).map((h) => h.toLowerCase()), route).toEqual(['accept']);
    expect(request.body).toBeUndefined();
  }
  expect(TIMEOUT_MS).toBeGreaterThanOrEqual(10000);
});

test('only these reads, with a whole number for a session', async () => {
  for (const [route, id] of [['status'], ['sessions'], ['schedule'], ['session', 7]]) expect(readProblem(route, id), route).toBeNull();
  for (const [route, id] of [['cars'], ['pedals'], ['replay'], ['controls'], ['../status'], ['status?x=1'], [''], [undefined], [{}], ['session'], ['session', 0], ['session', -1], ['session', 1.5], ['session', '1'], ['session', '1&x=2'], ['session', NaN], ['session', 2 ** 60]]) {
    expect(readProblem(route, id), `${JSON.stringify(route)} ${JSON.stringify(id)}`).toEqual(expect.any(String));
  }
  const { send, sent } = recorder();
  const reads = createDeskReads({ host: () => HOST, send });
  for (const [route, id] of [['cars'], ['session', '1&action=restartdemo'], ['replay']]) {
    const answer = await reads.read(route, id);
    expect(answer.error, route).toEqual(expect.any(String));
    expect('value' in answer).toBe(false);
  }
  expect(sent, 'nothing that is not a read is sent on').toEqual([]);
});

test('a read is the host\'s JSON, as it gave it', async () => {
  const body = { schemaVersion: 8, sessions: 30, db: 'racing-desk.db' };
  const { send, sent } = recorder({ status: 200, text: JSON.stringify(body) });
  const reads = createDeskReads({ host: () => `${HOST}/`, send });
  expect(await reads.read('status')).toEqual({ value: body });
  expect(await reads.read('session', 5)).toEqual({ value: body });
  expect(sent.map((s) => s.request.url)).toEqual([`${HOST}/racing-desk/data/status`, `${HOST}/racing-desk/data/session?id=5`]);
  expect(sent.every((s) => s.timeoutMs === TIMEOUT_MS)).toBe(true);
});

test('where the host is is asked each time: it can move while the app runs', async () => {
  let where = 'http://localhost:8889';
  const { send, sent } = recorder();
  const reads = createDeskReads({ host: () => where, send });
  await reads.read('status');
  where = 'http://127.0.0.1:18889';
  await reads.read('status');
  expect(sent.map((s) => s.request.url)).toEqual(['http://localhost:8889/racing-desk/data/status', 'http://127.0.0.1:18889/racing-desk/data/status']);
});

test('a host that is not on this machine is not asked, and the answer says so', async () => {
  for (const base of [
    'http://192.168.1.20:8889', 'http://192.168.1.20', 'https://rig.example:8889', 'http://localhost.evil.example:8889',
    'http://localhost@evil.example:8889', 'http://evil.example/localhost', 'http://10.0.0.5:18889',
  ]) {
    const { send, sent } = recorder();
    const answer = await createDeskReads({ host: () => base, send }).read('sessions');
    expect(answer, base).toEqual({ error: `The host at ${base} is not on this machine, so nothing was asked of it.`, notHere: true });
    expect(sent, `${base}: nothing was sent`).toEqual([]);
  }
  for (const base of ['http://localhost:8889', 'http://127.0.0.1:18889', 'http://[::1]:8889', 'https://localhost:8889']) expect(isHere(base), base).toBe(true);
  // Not an address at all: there is nowhere for it to go.
  for (const base of [undefined, null, '', 'localhost:8889', 'garbage', 42]) {
    const { send, sent } = recorder();
    const answer = await createDeskReads({ host: () => base, send }).read('status');
    expect('value' in answer, String(base)).toBe(false);
    expect(sent, `${String(base)}: nothing was sent`).toEqual([]);
  }
});

test('a host that cannot be worked out is no host, and nothing is thrown', async () => {
  const { send, sent } = recorder();
  const answer = await createDeskReads({ host: () => { throw new Error('settings unreadable'); }, send }).read('status');
  expect(answer).toEqual({ error: 'There is no local host to ask.', noAnswer: true });
  expect(sent).toEqual([]);
});

test('every way a read can fail is an answer: refused, missing, not JSON, nothing', async () => {
  const give = async (answer) => createDeskReads({ host: () => HOST, send: recorder(answer).send }).read('status');

  expect(await give({ status: 403, text: JSON.stringify({ error: 'this is for the app on this machine' }) }))
    .toEqual({ error: 'HTTP 403: this is for the app on this machine', status: 403 });
  expect(await give({ status: 404, text: JSON.stringify({ error: 'no local store yet' }) })).toMatchObject({ status: 404, error: 'HTTP 404: no local store yet' });
  expect(await give({ status: 500, text: '' })).toEqual({ error: 'HTTP 500', status: 500 });
  expect(await give({ status: 200, text: '<html>not json</html>' })).toMatchObject({ error: 'The host answered, but not with JSON.' });
  expect(await give({ status: 200, text: '' })).toMatchObject({ error: 'The host answered, but not with JSON.' });

  const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8889'), { code: 'ECONNREFUSED' });
  expect(await give(refused)).toEqual({ error: `Nothing is answering at ${HOST}.`, noAnswer: true });
  expect(await give(new Error('timeout'))).toEqual({ error: `The host at ${HOST} did not answer within ${TIMEOUT_MS / 1000} s.`, noAnswer: true });
  expect(await give(new Error('too long'))).toEqual({ error: `The host at ${HOST} answered with more than the page reads.`, noAnswer: true });
  // A host's own long words are cut, and a body that is not an error says nothing of itself.
  expect((await give({ status: 400, text: JSON.stringify({ error: 'x'.repeat(5000) }) })).error.length).toBeLessThan(260);
  expect(readAnswer({ status: 400, text: JSON.stringify(['an array']) })).toEqual({ error: 'HTTP 400', status: 400 });
});

test('--desk-host names a host on this machine, or is ignored', () => {
  expect(deskHostOf([])).toEqual({ url: null });
  expect(deskHostOf(['electron', '.', '--no-desk'])).toEqual({ url: null });
  expect(deskHostOf(['--desk-host=http://localhost:18889'])).toEqual({ url: 'http://localhost:18889' });
  expect(deskHostOf(['--desk-host=http://127.0.0.1:18889/'])).toEqual({ url: 'http://127.0.0.1:18889' });
  expect(deskHostOf(['--desk-host=http://[::1]:8889'])).toEqual({ url: 'http://[::1]:8889' });
  // Another machine's host refuses every read: it is ignored, so the app finds or starts a host of its own, and the desk, the
  // HUD's screen lookup, the car names and the TV shots all ask that one.
  for (const flag of ['http://192.168.1.20:8889', 'http://rig:8889', 'https://example.com', 'http://localhost.evil.example:8889', 'nonsense', '']) {
    expect(deskHostOf([`--desk-host=${flag}`]), flag).toEqual({ url: null, ignored: flag.replace(/\/+$/, '') });
  }
});

// ── Who may ask, and what the page does itself ──
// main.js cannot be loaded without Electron, so it is read as text. desk:read answers the desk window alone: the HUD's window
// shares the preload, and has the same call to make, and nothing of the HUD's has any business with the sessions.

const MAIN = readFileSync(new URL('../../main.js', import.meta.url), 'utf8');

test('main.js answers desk:read to the desk window and no other, and asks the host in that handler alone', () => {
  const registered = MAIN.split("ipcMain.handle('desk:read',");
  expect(registered, 'desk:read is handled once').toHaveLength(2);
  const opening = /^\s*async \(([^)]*)\) => \{\r?\n/.exec(registered[1]);
  expect(opening, 'by a function written out where it is registered').not.toBeNull();
  const takes = opening[1].split(',').map((name) => name.trim());
  expect(takes).toEqual(['event', 'name', 'id']);
  const body = registered[1].slice(opening[0].length).split(/\r?\n\}\);/)[0];
  const does = body.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length && !line.startsWith('//'));
  // Anybody else is turned away first, in words, with nothing of the host's in it; then the host is asked, once.
  expect(does[0]).toMatch(/^if \(!fromDesk\(event\)\) return \{ error: '[^']+' \};$/);
  expect(does.slice(1)).toEqual(['return deskReader.read(name, id);']);
  expect(MAIN.match(/\bdeskReader\.read\(/g)).toHaveLength(1);
  // The reader asks where the host is now, as the Cars page's does.
  expect(MAIN).toMatch(/\bconst deskReader = createDeskReads\(\{ host: \(\) => localHostUrl\(\) \}\);/);
  // And --desk-host goes through the same test: a flag that is not on this machine is ignored.
  expect(MAIN).toMatch(/const \{ url, ignored \} = deskHostOf\(process\.argv\);/);
  expect(MAIN.match(/process\.argv\.find\(\(a\) => a\.startsWith\('--desk-host='\)\)/g)).toBeNull();
});

test('the preload offers the desk its one read, and that is the page\'s only way to the host\'s store', () => {
  const preload = readFileSync(new URL('../../preload.js', import.meta.url), 'utf8');
  expect(preload).toMatch(/desk: \{\s*read: \(name, id\) => ipcRenderer\.invoke\('desk:read', name, id\),\s*\},/);
});

test('the desk\'s page asks the host for nothing itself: no fetch, no request of its own', () => {
  const code = readFileSync(new URL('../../modules/desk/desk.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  expect(code).not.toMatch(/\bfetch\s*\(/);
  expect(code).not.toMatch(/new\s+(?:XMLHttpRequest|WebSocket|EventSource)|sendBeacon/);
  expect(code).not.toContain('racing-desk/data');
  expect(code).toMatch(/window\.racingDesk && window\.racingDesk\.desk/);
});
