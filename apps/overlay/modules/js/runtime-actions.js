// The runtime's ?action= routes, asked for by this process on the HUD's behalf.
//
//   GET <runtime>/racing-desk/?action=restartdemo
//   GET <runtime>/racing-desk/?action=setPedalProfile&id=283f91ae
//   403 { "error": "this is for a program on this machine" }     to anything that is not one
//
// They write to the wheel base and the pedals, change the pedal profiles and the runtime's state, and several of the
// reads ask the hardware over serial, and the runtime listens on every address (the iPad view reads the telemetry through
// the app), so it answers a request only when a program on this machine made it: the connection is this machine's, the
// Host names it, and no browser sent it (RacingDeskRuntime, LocalRequest). The HUD is a page, and a page's request says
// where it came from — an Origin of "null", for a file — so the HUD does not fetch these: it asks main.js (runtime:action)
// and the request is made here, by Node, which sends none of that. The same way the desk's Cars page writes a car's
// pedals (modules/js/rig-api.js).
//
// Only the routes the page uses are asked for, with the arguments each takes and no others, and only of a runtime on this
// machine: what the page names is checked here, never sent on as it came. Every outcome is an answer, { ok: true,
// body } or { ok: false, error } with the error in words; nothing is thrown.
const rigApi = require('./rig-api');

const TIMEOUT_MS = 3000;
const MAX_LENGTH = 200;   // of a profile's id or a car's name: short names, and the page is not to be trusted with more

// What each route takes. 'name' is a short string with nothing in it that is not printable.
const ACTIONS = Object.freeze({
  restartdemo: Object.freeze({}),
  listPedalProfiles: Object.freeze({}),
  setPedalProfile: Object.freeze({ id: 'name' }),
  bindPedalProfile: Object.freeze({ id: 'name', car: 'name' }),
});

// What is wrong with a route and its arguments, in words, or null when nothing is.
function problemWith(name, params) {
  if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(ACTIONS, name)) return 'That is not a route the page may ask for.';
  const wanted = ACTIONS[name];
  const given = params === undefined || params === null ? {} : params;
  if (typeof given !== 'object' || Array.isArray(given)) return 'The arguments are not an object.';
  for (const key of Object.keys(given)) {
    if (!Object.prototype.hasOwnProperty.call(wanted, key)) return `${name} takes no "${key}".`;
  }
  for (const [key, kind] of Object.entries(wanted)) {
    const value = given[key];
    if (value === undefined) {
      // Optional: the runtime has its own answer for a car that is not named (the one in the sim).
      if (key === 'car') continue;
      return `${name} needs "${key}".`;
    }
    if (kind === 'name') {
      if (typeof value !== 'string' || !value.length) return `"${key}" is not a name.`;
      if (value.length > MAX_LENGTH) return `"${key}" is longer than ${MAX_LENGTH} characters.`;
      if (/[\u0000-\u001f\u007f]/.test(value)) return `"${key}" holds a character that is not printable.`;
    }
  }
  return null;
}

// The request, as data. The query is built here from what was checked: a name is encoded.
// Only GET, and only the headers a program sends: never an Origin.
function actionRequest(telemetryUrl, name, params) {
  const query = [`action=${encodeURIComponent(name)}`];
  for (const key of Object.keys(ACTIONS[name])) {
    const value = (params || {})[key];
    if (value !== undefined) query.push(`${key}=${encodeURIComponent(value)}`);
  }
  return { url: `${telemetryUrl.replace(/\/?$/, '/')}?${query.join('&')}`, method: 'GET', headers: { Accept: 'application/json' } };
}

// The runtime's answer as the page reads it.
function readAnswer(answer) {
  const status = answer && answer.status;
  let body = null;
  try {
    body = JSON.parse(answer.text);
  } catch (e) {
    // not JSON: the status says what happened
  }
  if (status === 200) return { ok: true, body };
  if (status === 403) return { ok: false, error: 'The runtime refused the request: it is for programs on this machine alone.' };
  return { ok: false, error: `The runtime answered ${status}.` };
}

function noAnswer(err, timeoutMs) {
  const why = err && err.message ? err.message : String(err);
  if (why === 'timeout') return `The runtime did not answer within ${timeoutMs / 1000} s.`;
  if (err && err.code === 'ECONNREFUSED') return 'Nothing is answering where the runtime should be.';
  return `The runtime could not be asked: ${why}`;
}

// `url` returns where the HUD reads its telemetry now (it can be another port in dev mode, or a saved address), ending in
// /racing-desk/. `send` is injectable for the tests.
function createRuntimeActions({ url, send = rigApi.send, timeoutMs = TIMEOUT_MS } = {}) {
  async function run(name, params) {
    const problem = problemWith(name, params);
    if (problem) return { ok: false, error: problem };
    let telemetryUrl = null;
    try {
      telemetryUrl = typeof url === 'function' ? url() : url;
    } catch (e) {
      // no address to be worked out: said below
    }
    if (typeof telemetryUrl !== 'string' || !telemetryUrl.length) return { ok: false, error: 'There is no runtime to ask.' };
    // The page can be pointed at a runtime elsewhere to read from (settings.simhubUrl); what the runtime does for the driver on
    // this rig is this rig's, and is neither sent to another machine nor asked of one.
    if (!rigApi.isLocal(telemetryUrl)) return { ok: false, error: 'The runtime is not on this machine, so it was not asked.' };
    let answer;
    try {
      answer = await send(actionRequest(telemetryUrl, name, params), timeoutMs);
    } catch (err) {
      return { ok: false, error: noAnswer(err, timeoutMs) };
    }
    return readAnswer(answer);
  }

  return { run };
}

module.exports = { ACTIONS, TIMEOUT_MS, MAX_LENGTH, problemWith, actionRequest, readAnswer, createRuntimeActions };
