// Putting back each car's driver height and brakes (docs/view-and-pedals-plan.md), as the desk and the HUD see it: the
// app's host's GET/POST /racing-desk/data/restore, asked by Node from the main process. The host's data is for programs
// on this machine and no page (LocalDataApi), so the desk's Settings → Cars card, its Desk page line and the Cars page ask
// main.js (restore:read, restore:command), and the HUD is told its lines (hud-notice) by main.js too.
//
// In this build the host is in trial: it says what it would do and writes and presses nothing, and the first run's
// buttons write or press only on his click. Nothing here writes anything of his: it asks the host, and the host decides.
//
//   read()          → { value } | { missing: true } | { error }        the host's answer, never a rejection
//   command(body)   → { ok, … } | { ok: false, error }                  one of { switches }, { step }, { mark, state }, { undo, car? }
//   tellSwitches(s) → what the host was told of the three switches, from overlay-settings.json
//
// The HUD's lines (createRestoreLines): asked on the HUD keeper's own poll, as the brake force is (rig-limits.js), while
// he is in the car, every two seconds at most; a line said while he was out of the car (the garage screen, where the HUD is
// not shown) is shown at his first moment in it, two seconds each, one after another — and never while OBS records,
// because OBS films the screen the HUD is on (hud-notice.js). Lines from before the app started are not shown.
const http = require('http');
const rigApi = require('./rig-api');
const RacingDeskInCar = require('./in-car');

const RESTORE_PATH = '/racing-desk/data/restore';
const READ_TIMEOUT_MS = 6000;
const COMMAND_TIMEOUT_MS = 30000;   // a first-run press waits 5 s for him to put a window in front; a backup takes a moment
const MAX_ANSWER_BYTES = 2000000;
const MAX_BODY = 4096;

// The first run's buttons, as the host names them (RestoreGate.Steps): 0a, 0b, A1–A8, B1–B8, and A7-check, B1-check,
// B2-flags, B6-b, B7-restore.
const STEP = /^(0a|0b|A[1-8]|B[1-8])(-(check|flags|b|restore))?$/;
const MARK = /^(0a|0b|A[1-8]|B[1-8])$/;
const SWITCHES = Object.freeze(['height', 'brakes', 'horizon']);

// The three switches, as overlay-settings.json keeps them: the height and the brakes on unless the file says false (on, in
// trial), the horizon off unless it says true (only once the first run shows it adds).
const SETTINGS_KEYS = Object.freeze({ height: 'restoreHeight', brakes: 'restoreBrakes', horizon: 'restoreHorizon' });
function switchesOf(settings) {
  const s = settings && typeof settings === 'object' ? settings : {};
  return {
    height: s.restoreHeight !== false,
    brakes: s.restoreBrakes !== false,
    horizon: s.restoreHorizon === true,
  };
}

const isRow = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// What is wrong with a command, in words, or null when nothing is. Only these are sent on, with only their own keys.
function commandProblem(body) {
  if (!isRow(body)) return 'No command was given.';
  const keys = Object.keys(body);
  if (keys.includes('switches')) {
    if (!isRow(body.switches)) return 'The switches are not a set of switches.';
    const named = Object.keys(body.switches);
    if (!named.length || named.some((k) => !SWITCHES.includes(k) || typeof body.switches[k] !== 'boolean')) return 'A switch is height, brakes or horizon, on or off.';
    return null;
  }
  if (keys.includes('step')) return typeof body.step === 'string' && STEP.test(body.step) ? null : 'There is no such step.';
  if (keys.includes('mark')) {
    if (typeof body.mark !== 'string' || !MARK.test(body.mark)) return 'There is no such step to mark.';
    return body.state === null || body.state === 'passed' || body.state === 'failed' ? null : 'A mark is passed, failed or none.';
  }
  if (keys.includes('undo')) {
    if (body.undo === 'brakes' || body.undo === 'heights') return null;
    if (body.undo === 'height') return typeof body.car === 'string' && body.car.trim().length > 0 && body.car.length <= rigApi.MAX_LENGTH ? null : 'Which car?';
    return 'Undo is the brakes, the heights, or one car\'s height.';
  }
  return 'That is not a command Racing Desk takes.';
}

// The command as it is sent: its own keys and no others.
function commandBody(body) {
  if ('switches' in body) {
    const switches = {};
    for (const k of SWITCHES) if (typeof body.switches[k] === 'boolean') switches[k] = body.switches[k];
    return { switches };
  }
  if ('step' in body) return { step: body.step };
  if ('mark' in body) return { mark: body.mark, state: body.state };
  return body.undo === 'height' ? { undo: 'height', car: body.car.trim() } : { undo: body.undo };
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

function noAnswer(base, err, timeoutMs) {
  return rigApi.noAnswer(base, err, timeoutMs);
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

  async function read(query = '') {
    const { base, error } = where();
    if (error) return { error };
    let answer;
    try {
      answer = await send(request(base, 'GET', RESTORE_PATH + query, undefined, readTimeoutMs), readTimeoutMs);
    } catch (err) {
      return { error: noAnswer(base, err, readTimeoutMs) };
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
      return { ok: false, error: noAnswer(base, err, commandTimeoutMs) };
    }
    let parsed = null;
    try { parsed = JSON.parse(answer.text); } catch (e) { parsed = null; }
    if (answer.status === 200 && isRow(parsed)) return { ...parsed, ok: parsed.ok !== false };
    if (isRow(parsed) && typeof parsed.error === 'string') return { ok: false, error: parsed.error.slice(0, 300) };
    if (answer.status === 404) return { ok: false, error: 'This host is older than the app: it does not put cars back yet.' };
    return { ok: false, error: `The host answered ${answer.status}.` };
  }

  // The switches are the settings file's; the host keeps a copy (restore.json) for the moments before it is told.
  function tellSwitches(settings) {
    return command({ switches: switchesOf(settings) });
  }

  return { read, command, tellSwitches };
}

// GET the lines after a sequence number (the HUD's poll: no dry run, no first run). Resolves the answer or null.
function getLines(url, { timeoutMs = 1500, get = http.get } = {}) {
  return new Promise((resolve) => {
    let done = false;
    let req = null;
    const finish = (answer) => { if (!done) { done = true; clearTimeout(deadline); resolve(answer); } };
    const deadline = setTimeout(() => { finish(null); try { if (req) req.destroy(); } catch (e) { /* gone */ } }, timeoutMs);
    if (typeof deadline.unref === 'function') deadline.unref();
    try {
      req = get(url, { timeout: timeoutMs, headers: { Accept: 'application/json' } }, (res) => {
        if (res.statusCode !== 200) { res.resume(); finish(null); return; }
        const chunks = [];
        let size = 0;
        res.on('data', (c) => { size += c.length; if (size > 200000) { finish(null); req.destroy(); } else chunks.push(c); });
        res.on('end', () => { try { finish(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { finish(null); } });
        res.on('error', () => finish(null));
      });
      req.on('timeout', () => finish(null));
      req.on('error', () => finish(null));
    } catch (e) {
      finish(null);
    }
  });
}

const ASK_EVERY_MS = 2000;
const SHOW_GAP_MS = 2400;           // hud-notice.js shows a line for two seconds; the next one after it
const OLDEST_MS = 30 * 60 * 1000;   // a line older than this is not news by the time he gets in
const MOST_AT_ONCE = 3;

/**
 * The HUD's lines. `show(text)` hands one to the page (hud-notice); `recording()` says OBS is recording or starting to, when
 * nothing is shown (OBS films the HUD's screen) and what was waiting is let go; `fetch(url)` resolves the host's answer.
 *
 *   feed(payload)   the telemetry the HUD keeper polled, or null
 */
function createRestoreLines({ host, show, recording = () => false, fetch = getLines, now = Date.now, everyMs = ASK_EVERY_MS, gapMs = SHOW_GAP_MS, log = () => {} }) {
  let seen = null;   // the newest line's number when the app first asked: what was said before it is not shown
  let queue = [];
  let asking = false;
  let askedAt = -Infinity;
  let shownAt = -Infinity;

  function base() {
    let b = null;
    try { b = typeof host === 'function' ? host() : host; } catch (e) { b = null; }
    return typeof b === 'string' && b.length && rigApi.isLocal(b) ? b.replace(/\/+$/, '') : null;
  }

  async function ask() {
    const b = base();
    if (!b) return;
    asking = true;
    try {
      const answer = await fetch(`${b}${RESTORE_PATH}?since=${seen === null ? 0 : seen}`);
      if (!isRow(answer) || answer.available !== true) return;
      const lines = Array.isArray(answer.lines) ? answer.lines.filter(isRow) : [];
      const newest = Number.isInteger(answer.seq) ? answer.seq : Math.max(0, ...lines.map((l) => (Number.isInteger(l.seq) ? l.seq : 0)));
      if (seen === null) { seen = newest; return; }
      for (const line of lines) {
        if (!Number.isInteger(line.seq) || line.seq <= seen || line.hud !== true || typeof line.text !== 'string' || !line.text.trim()) continue;
        const at = Date.parse(line.at);
        if (Number.isFinite(at) && now() - at > OLDEST_MS) continue;
        queue.push(line.text.slice(0, 160));
      }
      seen = Math.max(seen, newest);
      if (queue.length > MOST_AT_ONCE) queue = queue.slice(-MOST_AT_ONCE);
    } catch (e) {
      // a host that does not answer is asked again next time
    } finally {
      asking = false;
      askedAt = now();
    }
  }

  function feed(payload) {
    // The first ask is made whatever he is doing, to know where the lines stand; after it, only in the car.
    if (seen === null) {
      if (!asking && now() - askedAt >= everyMs) ask();
      return;
    }
    if (!RacingDeskInCar.inCar(payload)) return;
    if (!asking && now() - askedAt >= everyMs) ask();
    if (!queue.length || now() - shownAt < gapMs) return;
    let filming = false;
    try { filming = !!recording(); } catch (e) { filming = false; }
    if (filming) {
      log(`[RacingDesk] restore: ${queue.length} line${queue.length === 1 ? '' : 's'} not shown on the HUD: OBS is recording it`);
      queue = [];
      return;
    }
    const text = queue.shift();
    shownAt = now();
    try { show(text); } catch (e) { log(`[RacingDesk] restore: the HUD could not be told (${e.message})`); }
  }

  return { feed, pending: () => queue.slice() };
}

module.exports = {
  RESTORE_PATH, READ_TIMEOUT_MS, COMMAND_TIMEOUT_MS, SETTINGS_KEYS, SWITCHES, STEP, MARK, ASK_EVERY_MS, SHOW_GAP_MS, OLDEST_MS, MOST_AT_ONCE,
  switchesOf, commandProblem, commandBody, createRestoreApi, createRestoreLines, getLines,
};
