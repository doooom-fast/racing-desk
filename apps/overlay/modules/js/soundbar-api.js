// iRacing's LFE off while the sound bar is the speakers, as the desk sees it: the app's host's GET/POST
// /racing-desk/data/soundbar, asked by Node from the main process. The host's data is for programs on this machine and no
// page (LocalDataApi), so Settings → Sound asks main.js (soundbar:read, soundbar:command).
//
// The host does the work by itself: it listens for Windows changing the default playback device and edits iRacing's app.ini
// only while the sim is closed. Nothing here writes anything of his: it asks the host, and the host decides. The HUD is told
// nothing of it.
//
//   read()          → { value } | { missing: true } | { error }        the host's answer, never a rejection
//   command(body)   → { ok, … } | { ok: false, error }                  { enabled: true|false } or { device: '<id>' } ('' = the SineAudio one)
const rigApi = require('./rig-api');

const SOUNDBAR_PATH = '/racing-desk/data/soundbar';
const READ_TIMEOUT_MS = 6000;
const COMMAND_TIMEOUT_MS = 15000;
const MAX_ANSWER_BYTES = 1000000;
const MAX_DEVICE_ID = 300;

const isRow = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// What is wrong with a command, in words, or null when nothing is. One thing at a time, and only these.
function commandProblem(body) {
  if (!isRow(body)) return 'No command was given.';
  const keys = Object.keys(body);
  if (keys.length !== 1) return 'One thing is changed at a time: the switch, or the sound bar.';
  if (keys[0] === 'enabled') return typeof body.enabled === 'boolean' ? null : 'The switch is on or off.';
  if (keys[0] === 'device') {
    if (typeof body.device !== 'string') return 'The sound bar is one of the playback devices, by its id.';
    return body.device.length <= MAX_DEVICE_ID ? null : 'That playback device id is too long.';
  }
  return 'That is not a command Racing Desk takes.';
}

// The command as it is sent: its own key and no other.
function commandBody(body) {
  return 'enabled' in body ? { enabled: body.enabled } : { device: body.device };
}

function request(base, method, body, timeoutMs) {
  const text = body === undefined ? undefined : JSON.stringify(body);
  return {
    url: base.replace(/\/+$/, '') + SOUNDBAR_PATH,
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
function createSoundBarApi({ host, send = rigApi.send, readTimeoutMs = READ_TIMEOUT_MS, commandTimeoutMs = COMMAND_TIMEOUT_MS } = {}) {
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
      answer = await send(request(base, 'GET', undefined, readTimeoutMs), readTimeoutMs);
    } catch (err) {
      return { error: rigApi.noAnswer(base, err, readTimeoutMs) };
    }
    if (answer.status === 404) return { missing: true };
    if (answer.status !== 200) return { error: `The host answered ${answer.status}.` };
    try {
      const value = JSON.parse(answer.text);
      return isRow(value) ? { value } : { error: 'The host answered, but not with how the sound bar stands.' };
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
      answer = await send(request(base, 'POST', commandBody(body), commandTimeoutMs), commandTimeoutMs);
    } catch (err) {
      return { ok: false, error: rigApi.noAnswer(base, err, commandTimeoutMs) };
    }
    let parsed = null;
    try { parsed = JSON.parse(answer.text); } catch (e) { parsed = null; }
    if (answer.status === 200 && isRow(parsed)) return { ...parsed, ok: parsed.ok !== false };
    if (isRow(parsed) && typeof parsed.error === 'string') return { ok: false, error: parsed.error.slice(0, 300) };
    if (answer.status === 404) return { ok: false, error: 'This host is older than the app: it does not watch the sound bar yet.' };
    return { ok: false, error: `The host answered ${answer.status}.` };
  }

  return { read, command };
}

module.exports = { SOUNDBAR_PATH, READ_TIMEOUT_MS, COMMAND_TIMEOUT_MS, commandProblem, commandBody, createSoundBarApi };
