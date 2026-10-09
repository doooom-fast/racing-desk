// Putting back each car's seat height and brakes (docs/view-and-pedals-plan.md), as the desk sees it: the app's host's
// GET/POST /racing-desk/data/restore, asked by Node from the main process. The host's data is for programs on this machine and
// no page (LocalDataApi), so Settings → Cars and the Cars page ask main.js (restore:read, restore:command).
//
// The host does the work by itself: it puts a car's brakes on when he is parked in it, and keeps the seat height he leaves a
// car with in its camera file. Nothing here writes anything of his: it asks the host, and the host decides. The HUD is told
// nothing of it.
//
//   read()          → { value } | { missing: true } | { error }        the host's answer, never a rejection
//   command(body)   → { ok, … } | { ok: false, error }                  { switches: { brakes?, height? } }, { undo: 'all' },
//                                                                         or { keys: 'undo' | 'move' } for his brake-force keys
const rigApi = require('./rig-api');

const RESTORE_PATH = '/racing-desk/data/restore';
const READ_TIMEOUT_MS = 6000;
const COMMAND_TIMEOUT_MS = 30000;   // undo backs SmartControl's database up and puts files back: a moment, and the host waits 25 s at most
const MAX_ANSWER_BYTES = 2000000;

// The two switches of Settings → Cars.
const SWITCHES = Object.freeze(['brakes', 'height']);

// What can be asked of his brake-force keys: put back on F1–F4 as they were, or moved to Right Ctrl + F1–F4 again.
const KEYS = Object.freeze(['undo', 'move']);

const isRow = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// What is wrong with a command, in words, or null when nothing is. Only these are sent on, with only their own keys.
function commandProblem(body) {
  if (!isRow(body)) return 'No command was given.';
  const keys = Object.keys(body);
  if (keys.includes('switches')) {
    if (!isRow(body.switches)) return 'The switches are not a set of switches.';
    const named = Object.keys(body.switches);
    if (!named.length || named.some((k) => !SWITCHES.includes(k) || typeof body.switches[k] !== 'boolean')) return 'A switch is brakes or height, on or off.';
    return null;
  }
  if (keys.includes('undo')) return body.undo === 'all' ? null : 'Undo puts back everything Racing Desk changed, or nothing.';
  if (keys.includes('keys')) return KEYS.includes(body.keys) ? null : 'The brake-force keys are put back or moved, nothing else.';
  return 'That is not a command Racing Desk takes.';
}

// The command as it is sent: its own keys and no others.
function commandBody(body) {
  if ('switches' in body) {
    const switches = {};
    for (const k of SWITCHES) if (typeof body.switches[k] === 'boolean') switches[k] = body.switches[k];
    return { switches };
  }
  if ('undo' in body) return { undo: 'all' };
  return { keys: body.keys };
}

function request(base, method, pathAndQuery, body, timeoutMs) {
  const text = body === undefined ? undefined : JSON.stringify(body);
  return {
    url: base.replace(/\/+$/, '') + pathAndQuery,
    method,
    headers: text === undefined ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text), Accept: 'application/json' },
    body: text,
    maxBytes: MAX_ANSWER_BYTES,
    timeoutMs,
  };
}

/**
 * `host` is where the app's host is now (it can move: :8889, or :18889 beside SimHub); `send` is rig-api's, or a stand-in.
 */
function createRestoreApi({ host, send = rigApi.send, readTimeoutMs = READ_TIMEOUT_MS, commandTimeoutMs = COMMAND_TIMEOUT_MS } = {}) {
  function where() {
    let base = null;
    try { base = typeof host === 'function' ? host() : host; } catch (e) { base = null; }
    if (typeof base !== 'string' || !base.length) return { error: 'There is no local host to ask.' };
    if (!rigApi.isLocal(base)) return { error: `The host at ${base} is not on this machine, so nothing was asked of it.` };
    return { base };
  }

  async function read() {
    const { base, error } = where();
    if (error) return { error };
    let answer;
    try {
      answer = await send(request(base, 'GET', RESTORE_PATH, undefined, readTimeoutMs), readTimeoutMs);
    } catch (err) {
      return { error: rigApi.noAnswer(base, err, readTimeoutMs) };
    }
    if (answer.status === 404) return { missing: true };
    if (answer.status !== 200) return { error: `The host answered ${answer.status}.` };
    try {
      const value = JSON.parse(answer.text);
      return isRow(value) ? { value } : { error: 'The host answered, but not with how putting the cars back stands.' };
    } catch (e) {
      return { error: 'The host answered, but not with JSON.' };
    }
  }

  async function command(body) {
    const problem = commandProblem(body);
    if (problem) return { ok: false, error: problem };
    const { base, error } = where();
    if (error) return { ok: false, error };
    let answer;
    try {
      answer = await send(request(base, 'POST', RESTORE_PATH, commandBody(body), commandTimeoutMs), commandTimeoutMs);
    } catch (err) {
      return { ok: false, error: rigApi.noAnswer(base, err, commandTimeoutMs) };
    }
    let parsed = null;
    try { parsed = JSON.parse(answer.text); } catch (e) { parsed = null; }
    if (answer.status === 200 && isRow(parsed)) return { ...parsed, ok: parsed.ok !== false };
    if (isRow(parsed) && typeof parsed.error === 'string') return { ok: false, error: parsed.error.slice(0, 300) };
    if (answer.status === 404) return { ok: false, error: 'This host is older than the app: it does not put cars back yet.' };
    return { ok: false, error: `The host answered ${answer.status}.` };
  }

  return { read, command };
}

module.exports = { RESTORE_PATH, READ_TIMEOUT_MS, COMMAND_TIMEOUT_MS, SWITCHES, KEYS, commandProblem, commandBody, createRestoreApi };
