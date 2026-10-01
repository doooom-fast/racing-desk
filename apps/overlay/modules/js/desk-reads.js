// What the desk reads of the local host's store: status, sessions, the season's schedule and one session's laps.
//
//   GET <host>/racing-desk/data/status
//   GET <host>/racing-desk/data/sessions
//   GET <host>/racing-desk/data/schedule
//   GET <host>/racing-desk/data/session?id=<row id>
//
// The host answers a program on this machine and no page (apps/host LocalDataApi): `sessions` and `session` carry the driver's
// customer id and `status` the store's path, and a page that asks says an Origin, which is `null` for the desk (a file) and for
// any web page that is redirected to the host, sandboxed or opened from disk, so the host cannot tell the desk from those and
// turns away every page. So the desk's page fetches none of it: it asks main.js (desk:read, preload.js's racingDesk.desk.read)
// and the request is made here, by Node, which sends a Host and no Origin. Same as the Cars page's reads and its write
// (rig-api.js), and for the same reason.
//
// Each read comes back as one of
//
//   { value }                         the host's JSON, as it gave it (calc and the page check what it holds)
//   { error, status }                 an answer that is not 200: 404 from a host with no such route, 403 from one that refuses
//   { error, notHere: true }          the host is not on this machine: nothing is sent to it
//   { error, noAnswer: true }         nothing answered, or too slowly, or with more than the page reads
//   { error }                         not JSON, or not a read the desk has
//
// with `error` in words. Nothing is thrown: the page shows what it is given.
const rigApi = require('./rig-api');

const READS = Object.freeze(['status', 'sessions', 'schedule', 'session']);
const DATA_PATH = '/racing-desk/data/';
// The sessions are the one answer with some size: a few thousand rows of thirty-odd columns is a few MB. Beyond this it is not
// the host's store that is answering.
const MAX_BYTES = 64 * 1024 * 1024;
const TIMEOUT_MS = 15000;

// What is wrong with the arguments, in words, or null when nothing is. `session` takes the stored row's id.
function readProblem(route, id) {
  if (!READS.includes(route)) return `The desk has no read called ${typeof route === 'string' ? route.slice(0, 40) : typeof route}.`;
  if (route === 'session' && !(Number.isSafeInteger(id) && id > 0)) return 'A session is asked for by its stored id, a whole number.';
  return null;
}

// The request for one read, as data: a GET with no body and never an Origin (Node adds a Host and a Connection).
function readRequest(base, route, id) {
  const path = route === 'session' ? `session?id=${id}` : route;
  return { url: base.replace(/\/+$/, '') + DATA_PATH + path, method: 'GET', headers: { Accept: 'application/json' }, maxBytes: MAX_BYTES };
}

// Whether `base` is an address of this machine, as a URL: another machine's host refuses the desk, so it is not asked.
function isHere(base) {
  return typeof base === 'string' && /^https?:\/\//i.test(base) && rigApi.isLocal(base);
}

// The host --desk-host= names, out of the arguments the app was started with: { url } when it is one on this machine (a host you ran
// by hand, `--desk-host=http://localhost:18889`), { url: null } when there is no such flag, and { url: null, ignored } with the
// flag's value when it names anything else. The host answers this machine alone, so another machine's would leave the app with
// no host that answers it, for the desk, the HUD's screen lookup, the car names and the TV shots alike: it is ignored, and the app
// finds or starts one of its own as it does with no flag.
function deskHostOf(argv) {
  const flag = (argv || []).find((a) => typeof a === 'string' && a.startsWith('--desk-host='));
  if (!flag) return { url: null };
  const url = flag.slice('--desk-host='.length).replace(/\/+$/, '');
  return isHere(url) ? { url } : { url: null, ignored: url };
}

// The host's answer as the desk reads it.
function readAnswer(answer) {
  const status = answer && answer.status;
  if (status !== 200) {
    let said = null;
    try {
      const body = JSON.parse(answer.text);
      if (body && typeof body.error === 'string' && body.error.length) said = body.error.slice(0, 200);
    } catch (e) {
      // not JSON: the status says what happened
    }
    return { error: said ? `HTTP ${status}: ${said}` : `HTTP ${status}`, status };
  }
  try {
    return { value: JSON.parse(answer.text) };
  } catch (e) {
    return { error: 'The host answered, but not with JSON.', status };
  }
}

// `host` returns where the host is now (it can move while the app runs: :8889, or :18889 beside SimHub). `send` is
// injectable for the tests.
function createDeskReads({ host, send: sendRequest = rigApi.send, timeoutMs = TIMEOUT_MS } = {}) {
  async function read(route, id) {
    const problem = readProblem(route, id);
    if (problem) return { error: problem };
    let base = null;
    try {
      base = typeof host === 'function' ? host() : host;
    } catch (e) {
      // no host to be worked out: said below
    }
    if (typeof base !== 'string' || !base.length) return { error: 'There is no local host to ask.', noAnswer: true };
    if (!isHere(base)) return { error: `The host at ${base} is not on this machine, so nothing was asked of it.`, notHere: true };
    let answer;
    try {
      answer = await sendRequest(readRequest(base, route, id), timeoutMs);
    } catch (err) {
      return { error: rigApi.noAnswer(base, err, timeoutMs), noAnswer: true };
    }
    return readAnswer(answer);
  }

  return { read };
}

module.exports = { READS, MAX_BYTES, TIMEOUT_MS, readProblem, readRequest, readAnswer, isHere, deskHostOf, createDeskReads };
