// What the local host keeps per car, for the desk's Cars page: read, and the one thing written.
//
// The write is which SmartControl profile a car is driven with:
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
//
// The read is the four routes the page is drawn from (rig:read), asked from here too, so that the page builds no
// address of its own:
//
//   GET <host>/racing-desk/data/cars       the store's name for each car, and its own spelling of the car's path
//   GET <host>/racing-desk/data/views      the view each car was last driven with
//   GET <host>/racing-desk/data/pedals     SmartControl's profiles and keys, and the cars given a profile
//   GET <host>/racing-desk/data/controls   the canonical list of cars, and what its check has said of each car
//
// Each comes back as { value }, as { missing: true } from a host that has no such route yet (404), or as
// { error } in words. One that fails does not take the others with it, and nothing is thrown here either.
//
// The first three are passed on as the host gave them, and the page checks what they hold. The list of cars is
// the one answer that is big (a couple of hundred cars, each with its controls) and that comes from a file written
// by hand, so it is bounded and shaped here before it goes to the page (shapeControls): only the keys the page
// draws, each of the type it is drawn as, no string, list or object longer than the page has room for. A host
// that answers with something else is { error }, not a page that has to guess.
const http = require('http');

const DATA_PATH = '/racing-desk/data/';
const PEDALS_PATH = DATA_PATH + 'pedals';
const READS = Object.freeze(['cars', 'views', 'pedals', 'controls']);
const TIMEOUT_MS = 3000;
const MAX_LENGTH = 200;   // of a car path or a profile id: both are short names, and the page is not to be trusted with more
const MAX_ERROR = 300;    // of the host's own words for a refusal, as shown in a table cell

// What the list of cars is held to. The list on this rig is under 300 KB written out; four times that is still a
// list, and more is not one the page reads.
const MAX_CONTROLS_BYTES = 1200000;
const MAX_CARS = 1000;        // cars in the list, and cars with something kept of them
const MAX_CONTROLS = 60;      // controls of one car
const MAX_POSITIONS = 64;     // named positions of one control
const MAX_REMARKS = 60;       // things said of one car
const MAX_WORD = 100;         // an id, a variable, a label, a kind, a check's key
const MAX_REMARK = 500;       // one thing the check said
const MAX_MOMENT = 40;        // a time, as the host writes one

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
      let received = 0;
      res.on('data', (c) => {
        received += c.length;
        if (request.maxBytes && received > request.maxBytes) req.destroy(new Error('too long'));
        else chunks.push(c);
      });
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
  if (why === 'too long') return `The host at ${base} answered with more than the page reads.`;
  if (err && err.code === 'ECONNREFUSED') return `Nothing is answering at ${base}.`;
  return `The host at ${base} could not be asked: ${why}`;
}

// The request for one of the routes the page reads, as data. A GET with no body, and never an Origin.
// The list of cars is the one answer with a size to be held to: a host that goes on is not listened to.
function readRequest(base, route) {
  const request = { url: base.replace(/\/+$/, '') + DATA_PATH + route, method: 'GET', headers: { Accept: 'application/json' } };
  if (route === 'controls') request.maxBytes = MAX_CONTROLS_BYTES;
  return request;
}

// One route's answer as the page reads it. What the value holds is the page's to check: it is passed on as the
// host gave it.
function readRoute(answer) {
  const status = answer && answer.status;
  if (status === 404) return { missing: true };
  if (status !== 200) return { error: `The host answered ${status}.` };
  try {
    return { value: JSON.parse(answer.text) };
  } catch (e) {
    return { error: 'The host answered, but not with JSON.' };
  }
}

// ── The list of cars ──

const str = (v, max) => (typeof v === 'string' && v.trim().length > 0 ? v.slice(0, max) : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const WORDS = Object.freeze(['none', 'fixed', 'adjustable']);
const word = (v) => (WORDS.includes(v) ? v : null);

// One control of a car: which it is, what carries it, what the car calls it, and the values it can have — off, a
// range, or names for positions. Null for what is not a control.
function shapeControl(c) {
  const id = isRow(c) ? str(c.id, MAX_WORD) : null;
  if (id === null) return null;
  const out = { id, var: str(c.var, MAX_WORD), label: str(c.label, MAX_WORD) };
  if (c.off === false || num(c.off) !== null) out.off = c.off;
  if (Array.isArray(c.range) && c.range.length === 2 && num(c.range[0]) !== null && num(c.range[1]) !== null) {
    out.range = [c.range[0], c.range[1]];
  }
  if (isRow(c.positions)) {
    // A list of pairs, in the order of the values, and not an object: nothing here is a key that could be __proto__.
    const positions = Object.entries(c.positions)
      .filter(([value]) => value.trim() !== '' && Number.isFinite(Number(value)))
      .map(([value, name]) => [Number(value), str(name, MAX_WORD)])
      .filter(([, name]) => name !== null)
      .slice(0, MAX_POSITIONS)
      .sort((a, b) => a[0] - b[0]);
    if (positions.length) out.positions = positions;
  }
  if (Array.isArray(c.covers)) out.covers = c.covers.filter((x) => typeof x === 'string').slice(0, 3).map((x) => x.slice(0, MAX_WORD));
  return out;
}

// One car of the list. Null for what has no folder to be a car by.
function shapeCar(c) {
  const path = isRow(c) ? str(c.path, MAX_LENGTH) : null;
  if (path === null) return null;
  return {
    path,
    name: str(c.name, MAX_LENGTH),
    kind: str(c.kind, MAX_WORD),
    abs: word(c.abs),
    tc: word(c.tc),
    brakeBias: word(c.brakeBias),
    controls: (Array.isArray(c.controls) ? c.controls : []).slice(0, MAX_CONTROLS).map(shapeControl).filter((x) => x !== null),
    checked: str(c.checked, MAX_WORD),
  };
}

// One thing the check said of a car, and when it first and last said it. Null for what says nothing.
function shapeRemark(r) {
  const about = isRow(r) ? str(r.about, MAX_WORD) : null;
  const text = isRow(r) ? str(r.text, MAX_REMARK) : null;
  if (about === null || text === null) return null;
  return { about, text, firstSeen: str(r.firstSeen, MAX_MOMENT), lastSeen: str(r.lastSeen, MAX_MOMENT) };
}

// What the host answered to GET controls, as the page reads it, or null where that is not the list of cars:
//
//   { version, listHash, count, following,
//     cars: [ { path, name, kind, abs, tc, brakeBias, controls: [ { id, var, label, off?, range?, positions?, covers? } ], checked } ],
//     kept: [ { car, remarks: [ { about, text, firstSeen, lastSeen } ] } ] | null }
//
// `kept` is what the host's store has of the check's remarks against this list, by car, and is null when the host
// could not read its store — which is not the same as none. What the check said in this run alone (`remarks`) is
// the log's, and is not passed on.
function shapeControls(body) {
  if (!isRow(body) || !Array.isArray(body.cars)) return null;
  let kept = null;
  if (isRow(body.kept)) {
    kept = Object.entries(body.kept)
      .slice(0, MAX_CARS)
      .map(([car, remarks]) => ({
        car: str(car, MAX_LENGTH),
        remarks: (Array.isArray(remarks) ? remarks : []).slice(0, MAX_REMARKS).map(shapeRemark).filter((x) => x !== null),
      }))
      .filter((x) => x.car !== null && x.remarks.length > 0);
  }
  return {
    version: num(body.version),
    listHash: str(body.listHash, MAX_WORD),
    count: num(body.count),
    following: str(body.following, MAX_LENGTH),
    cars: body.cars.slice(0, MAX_CARS).map(shapeCar).filter((x) => x !== null),
    kept,
  };
}

// The answer to GET controls: the same three outcomes as any route, and the list shaped and bounded.
function readControls(answer) {
  if (answer && answer.status === 200 && typeof answer.text === 'string' && answer.text.length > MAX_CONTROLS_BYTES) {
    return { error: 'The host\'s list of cars is longer than the page reads.' };
  }
  const read = readRoute(answer);
  if (!('value' in read)) return read;
  const shaped = shapeControls(read.value);
  return shaped === null ? { error: 'The host answered, but not with the list of cars.' } : { value: shaped };
}

// What a read comes to when nothing could be asked at all: the same words for every route.
function unread(error) {
  return Object.fromEntries(READS.map((route) => [route, { error }]));
}

// `host` returns where the host is now (it can move while the app runs: :8889, or :18889 beside SimHub). `send` is
// injectable for the tests.
function createRigApi({ host, send: sendRequest = send, timeoutMs = TIMEOUT_MS } = {}) {
  // Where to ask, or why not: { base } or { error }. The desk can be pointed at a host elsewhere; what a car is
  // driven with is this rig's, and is neither sent to another machine nor taken from one.
  function where(verb) {
    let base = null;
    try {
      base = typeof host === 'function' ? host() : host;
    } catch (e) {
      // no host to be worked out: said below
    }
    if (typeof base !== 'string' || !base.length) return { error: 'There is no local host to ask.' };
    if (!isLocal(base)) return { error: `The host at ${base} is not on this machine, so nothing was ${verb} it.` };
    return { base };
  }

  async function bindPedals(carPath, profileId) {
    const problem = bindingProblem(carPath, profileId);
    if (problem) return { ok: false, error: problem };
    const { base, error } = where('sent to');
    if (error) return { ok: false, error };
    let answer;
    try {
      answer = await sendRequest(bindingRequest(base, carPath, profileId), timeoutMs);
    } catch (err) {
      return { ok: false, error: noAnswer(base, err, timeoutMs) };
    }
    return readAnswer(answer);
  }

  async function read() {
    const { base, error } = where('asked of');
    if (error) return unread(error);
    const answers = await Promise.all(READS.map(async (route) => {
      try {
        const answer = await sendRequest(readRequest(base, route), timeoutMs);
        return route === 'controls' ? readControls(answer) : readRoute(answer);
      } catch (err) {
        return { error: noAnswer(base, err, timeoutMs) };
      }
    }));
    return Object.fromEntries(READS.map((route, i) => [route, answers[i]]));
  }

  return { bindPedals, read };
}

module.exports = {
  PEDALS_PATH, READS, TIMEOUT_MS, MAX_LENGTH, MAX_CONTROLS_BYTES, bindingProblem, bindingRequest, readRequest, isLocal, send, readAnswer,
  readRoute, readControls, shapeControls, unread, createRigApi,
};
