// The desk's one write to the local host: which SmartControl profile a car is driven with.
//
//   POST <host>/racing-desk/data/pedals    { "car_path": "mx5 mx52016", "profile_id": "283f91ae" }
//   200 { "car": { …the car's row… } }     { "car": null } when "profile_id": null took the profile away
//   400 { "error": "…" }                   a car or a profile the host doesn't know
//   403                                    any request that carries an Origin header
//
// The 403 is the host's rule that writes are for local programs, not for pages in a browser, so the Cars page does
// not fetch this: it asks main.js (rig:bindPedals) and the request is made here, by Node, which sends no Origin.
//
// The page shows whatever comes back beside the car's select, so every outcome is an answer it can read —
// { ok: true, car } or { ok: false, error } with the error in words — and nothing is thrown: no host, a slow host,
// a host from before the route and an answer that isn't JSON are all { ok: false }.
const http = require('http');

const PEDALS_PATH = '/racing-desk/data/pedals';
const TIMEOUT_MS = 3000;
const MAX_LENGTH = 200;   // of a car path or a profile id: both are short names, and the page is not to be trusted with more
const MAX_ERROR = 300;    // of the host's own words for a refusal, as shown in a table cell

// What is wrong with the arguments, in words, or null when nothing is. A profile id of null takes the profile away.
function bindingProblem(carPath, profileId) {
  if (typeof carPath !== 'string' || !carPath.length) return 'No car was named.';
  if (carPath.length > MAX_LENGTH) return `The car's path is longer than ${MAX_LENGTH} characters.`;
  if (profileId !== null && typeof profileId !== 'string') return 'The profile is neither one of SmartControl\'s nor none.';
  if (profileId !== null && profileId.length > MAX_LENGTH) return `The profile's id is longer than ${MAX_LENGTH} characters.`;
  return null;
}

// The request, as data. These two headers are all it carries: Node adds Host and Connection, and never an Origin.
function bindingRequest(base, carPath, profileId) {
  const body = JSON.stringify({ car_path: carPath, profile_id: profileId });
  return {
    url: base.replace(/\/+$/, '') + PEDALS_PATH,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    body,
  };
}

// Sends it; resolves to { status, text } for any answer at all, rejects when there was none.
function send(request, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.request(request.url, { method: request.method, headers: request.headers, timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    // `timeout` is how long the socket may sit idle; the timer is the whole request, as in paints/car-names.js.
    const timer = setTimeout(() => req.destroy(new Error('timeout')), timeoutMs);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.on('close', () => clearTimeout(timer));
    req.end(request.body);
  });
}

// Whether `base` is a host on this machine. The desk can be pointed at a host elsewhere to read from
// (settings.simhubUrl); what a car is driven with is this rig's, and is not sent anywhere else.
function isLocal(base) {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname);
  } catch (e) {
    return true;   // not a URL at all: there is nowhere for it to go, and the send says so
  }
}

const isRow = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// The host's answer as the page reads it. A refusal is in the host's own words where it gave any.
function readAnswer(answer) {
  const status = answer && answer.status;
  let body = null;
  try {
    body = JSON.parse(answer.text);
  } catch (e) {
    // not JSON: the status says what happened
  }
  if (status === 200) {
    if (isRow(body) && 'car' in body && (body.car === null || isRow(body.car))) return { ok: true, car: body.car };
    return { ok: false, error: 'The host answered, but not with the car it was asked about.' };
  }
  if (isRow(body) && typeof body.error === 'string' && body.error.length) return { ok: false, error: body.error.slice(0, MAX_ERROR) };
  if (status === 404) return { ok: false, error: 'This host is older than the page: it cannot keep a car\'s pedals yet.' };
  if (status === 403) return { ok: false, error: 'The host refused the request (403).' };
  return { ok: false, error: `The host answered ${status}.` };
}

function noAnswer(base, err, timeoutMs) {
  const why = err && err.message ? err.message : String(err);
  if (why === 'timeout') return `The host at ${base} did not answer within ${timeoutMs / 1000} s.`;
  if (err && err.code === 'ECONNREFUSED') return `Nothing is answering at ${base}.`;
  return `The host at ${base} could not be asked: ${why}`;
}

// `host` returns where the host is now (it can move while the app runs: :8889, or :18889 beside SimHub). `send` is
// injectable for the tests.
function createRigApi({ host, send: sendRequest = send, timeoutMs = TIMEOUT_MS } = {}) {
  async function bindPedals(carPath, profileId) {
    const problem = bindingProblem(carPath, profileId);
    if (problem) return { ok: false, error: problem };
    let base = null;
    try {
      base = typeof host === 'function' ? host() : host;
    } catch (e) {
      // no host to be worked out: said below
    }
    if (typeof base !== 'string' || !base.length) return { ok: false, error: 'There is no local host to ask.' };
    if (!isLocal(base)) return { ok: false, error: `The host at ${base} is not on this machine, so nothing was sent to it.` };
    let answer;
    try {
      answer = await sendRequest(bindingRequest(base, carPath, profileId), timeoutMs);
    } catch (err) {
      return { ok: false, error: noAnswer(base, err, timeoutMs) };
    }
    return readAnswer(answer);
  }
  return { bindPedals };
}

module.exports = { PEDALS_PATH, TIMEOUT_MS, MAX_LENGTH, bindingProblem, bindingRequest, isLocal, send, readAnswer, createRigApi };
