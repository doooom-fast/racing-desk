// What the rig's hardware is set to, for the HUD's datastream (he asked on 2026-10-01: "Show Max pedal force and max
// wheel nm in the data stream"): the brake force the pedals are at now, in kg, as the app's host follows it from
// SmartControl Live's keys (root CLAUDE.md, Per car, for the rig: nothing is read from the pedals and nothing written to
// them; the force is known from a key that sets one and from nothing else), and the wheel's maximum torque in Nm, as
// the host has it — what the wheel base itself said when the plugin's poll could last ask it (Pit House holds the base's
// ports, so seldom), else Pit House's own saved preset for the base, read and never written, else not known. (The
// sim's own force scale, iRacing's SteeringWheelMaxForceNm, is in the telemetry the page already reads: DS.SteerMaxForceNm.)
//
// The host's data is for programs on this machine and no page (LocalDataApi), so the page does not ask: this module,
// in the main process, asks GET <host>/racing-desk/data/brakeforce and .../wheelmax by Node — a Host and no Origin — on
// the HUD keeper's own poll (hud-visibility's fetchPayload, which main.js feeds here as it feeds the livery and the
// recording), while he is in the car, every ASK_EVERY_MS at most, and tells the page (rig-limits) when the answer
// changes; a page that loaded after is given the last answer (get-rig-limits). Out of the car nothing is asked and the
// page is told not known. Nothing here throws, and a host that does not answer is "not known", never a number.
//
//   { brakeKg: 45 | null, car: 'mx5 mx52016' | null, wheelNm: 11.55 | null, wheelSource: 'base' | 'pithouse' | null }
const http = require('http');
const RacingDeskInCar = require('./in-car');
const rigApi = require('./rig-api');

const BRAKE_FORCE_PATH = '/racing-desk/data/brakeforce';
const WHEEL_MAX_PATH = '/racing-desk/data/wheelmax';
const ASK_EVERY_MS = 2000;
const ANSWER_WITHIN_MS = 1500;
const MAX_ANSWER_BYTES = 4096;

const NO_BRAKE = Object.freeze({ brakeKg: null, car: null });
const NO_WHEEL = Object.freeze({ wheelNm: null, wheelSource: null });
const NOT_KNOWN = Object.freeze({ ...NO_BRAKE, ...NO_WHEEL });

// The host's answer as the page is told it: a force of nought or more in kg, else not known; the car as a string, else none.
function readAnswer(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ...NO_BRAKE };
  const kg = typeof body.force_kg === 'number' && Number.isFinite(body.force_kg) && body.force_kg >= 0 ? body.force_kg : null;
  const car = typeof body.car === 'string' && body.car.length ? body.car.slice(0, 200) : null;
  return { brakeKg: kg, car };
}

// The host's wheel answer as the page is told it: a maximum torque above nought in Nm and where it came from, else not
// known. A number the host sent with no source it knows is still a number (the source is for the log and the tests).
function readWheelAnswer(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ...NO_WHEEL };
  const nm = typeof body.max_nm === 'number' && Number.isFinite(body.max_nm) && body.max_nm > 0 ? body.max_nm : null;
  const source = nm !== null && (body.source === 'base' || body.source === 'pithouse') ? body.source : null;
  return { wheelNm: nm, wheelSource: source };
}

// What the fetch resolved, checked again as the page is told it ({ brakeKg, car, wheelNm, wheelSource }: already read
// from the host's answers, so not read as the host's a second time): a force of nought or more, a torque above nought,
// else not known; a stand-in or an older fetch that says nothing of the wheel leaves it not known.
function told(limits) {
  if (!limits || typeof limits !== 'object' || Array.isArray(limits)) return { ...NOT_KNOWN };
  const kg = typeof limits.brakeKg === 'number' && Number.isFinite(limits.brakeKg) && limits.brakeKg >= 0 ? limits.brakeKg : null;
  const car = typeof limits.car === 'string' && limits.car.length ? limits.car.slice(0, 200) : null;
  const nm = typeof limits.wheelNm === 'number' && Number.isFinite(limits.wheelNm) && limits.wheelNm > 0 ? limits.wheelNm : null;
  const source = nm !== null && (limits.wheelSource === 'base' || limits.wheelSource === 'pithouse') ? limits.wheelSource : null;
  return { brakeKg: kg, car, wheelNm: nm, wheelSource: source };
}

// GET a host route. Resolves its JSON, or null for anything that is not an answer: nothing listening, no answer in time,
// a status other than 200, a body that is not JSON. Never rejects. Node's http.get sends a Host and nothing a browser
// sends, which is what the host answers.
function getJson(url, { timeoutMs = ANSWER_WITHIN_MS, get = http.get } = {}) {
  return new Promise((resolve) => {
    let done = false;
    let req = null;
    let deadline = null;
    const finish = (answer) => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      resolve(answer);
    };
    const giveUp = () => {
      finish(null);
      try { if (req) req.destroy(); } catch (e) { /* already gone */ }
    };
    deadline = setTimeout(giveUp, timeoutMs);
    if (typeof deadline.unref === 'function') deadline.unref();
    try {
      req = get(url, { timeout: timeoutMs, headers: { Accept: 'application/json' } }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          finish(null);
          return;
        }
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_ANSWER_BYTES) giveUp();
          else chunks.push(chunk);
        });
        res.on('end', () => {
          try {
            finish(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (e) {
            finish(null);
          }
        });
        res.on('error', () => finish(null));
      });
      req.on('timeout', giveUp);
      req.on('error', () => finish(null));
    } catch (e) {
      finish(null);
    }
  });
}

// GET the brake force, as the page is told it ({ brakeKg, car }; not known for anything that is not an answer).
function fetchBrakeForce(url, options) {
  return getJson(url, options).then(readAnswer);
}

// GET the wheel's maximum torque, as the page is told it ({ wheelNm, wheelSource }; not known for anything that is not an answer).
function fetchWheelMax(url, options) {
  return getJson(url, options).then(readWheelAnswer);
}

// Both, for the keeper: asked together, the wheel's route being the brake force's sibling on the same host.
function fetchRigLimits(brakeUrl, options) {
  const wheelUrl = brakeUrl.slice(0, brakeUrl.length - BRAKE_FORCE_PATH.length) + WHEEL_MAX_PATH;
  return Promise.all([fetchBrakeForce(brakeUrl, options), fetchWheelMax(wheelUrl, options)]).then(([brake, wheel]) => ({ ...brake, ...wheel }));
}

/**
 * The keeper. `host()` is where the app's host is now (it can move: :8889, or :18889 beside SimHub); `send(limits)` tells
 * the HUD's page; `fetch(url)` is given the brake force's address and resolves the answer as the page is told it,
 * { brakeKg, car, wheelNm, wheelSource } (fetchRigLimits, which asks the wheel's route beside it, or a stand-in in
 * the tests).
 *
 *   feed(payload)   the telemetry the HUD keeper polled, or null: asks the host while he is in the car
 *   current()       what the page was last told, for one that loaded after
 *
 * An answer that comes back after he got out of the car, or from a host that is no longer the one there, is not told:
 * it is of a car or a host that has gone, and would put back what the page was told is not known.
 */
function createRigLimits({ host, send, fetch = fetchRigLimits, now = Date.now, everyMs = ASK_EVERY_MS, log = () => {} }) {
  let current = { ...NOT_KNOWN };
  let asking = false;
  let askedAt = -Infinity;
  let saidNotLocal = false;
  let outs = 0;               // times he has got out of the car: an answer asked for before the last is not his now

  function tell(next) {
    if (next.brakeKg === current.brakeKg && next.car === current.car && next.wheelNm === current.wheelNm && next.wheelSource === current.wheelSource) return;
    current = next;
    try { send({ ...current }); } catch (e) { log(`[RacingDesk] rig limits: the page could not be told (${e.message})`); }
  }

  function where() {
    let base = null;
    try { base = typeof host === 'function' ? host() : host; } catch (e) { base = null; }
    if (typeof base !== 'string' || !base.length) return null;
    // The host answers this machine alone; one elsewhere refuses every read and is not asked.
    if (!rigApi.isLocal(base)) {
      if (!saidNotLocal) log(`[RacingDesk] rig limits: the host at ${base} is not on this machine, so the brake force is not asked for`);
      saidNotLocal = true;
      return null;
    }
    return base.replace(/\/+$/, '') + BRAKE_FORCE_PATH;
  }

  async function ask() {
    const url = where();
    if (!url) { tell({ ...NOT_KNOWN }); return; }
    const out = outs;
    asking = true;
    let answer;
    try {
      answer = told(await fetch(url));
    } catch (e) {
      answer = { ...NOT_KNOWN };
    } finally {
      asking = false;
      askedAt = now();
    }
    if (out === outs && where() === url) tell(answer);
  }

  function feed(payload) {
    if (!RacingDeskInCar.inCar(payload)) {
      outs += 1;
      tell({ ...NOT_KNOWN });
      return;
    }
    if (asking || now() - askedAt < everyMs) return;
    ask();
  }

  return { feed, current: () => ({ ...current }) };
}

module.exports = { BRAKE_FORCE_PATH, WHEEL_MAX_PATH, ASK_EVERY_MS, ANSWER_WITHIN_MS, NOT_KNOWN, readAnswer, readWheelAnswer, told, getJson, fetchBrakeForce, fetchWheelMax, fetchRigLimits, createRigLimits };
