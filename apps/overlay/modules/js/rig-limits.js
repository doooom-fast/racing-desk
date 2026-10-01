// What the rig's hardware is set to, for the HUD's datastream (he asked on 2026-10-01: "Show Max pedal force and max
// wheel nm in the data stream"): the brake force the pedals are at now, in kg, as the app's host follows it from
// SmartControl Live's keys (root CLAUDE.md, Per car, for the rig: nothing is read from the pedals and nothing written to
// them; the force is known from a key that sets one and from nothing else). The wheel's number needs none of this: it
// is iRacing's own SteeringWheelMaxForceNm, in the telemetry the page already reads (DS.SteerMaxForceNm).
//
// The host's data is for programs on this machine and no page (LocalDataApi), so the page does not ask: this module,
// in the main process, asks GET <host>/racing-desk/data/brakeforce by Node — a Host and no Origin — on the HUD keeper's
// own poll (hud-visibility's fetchPayload, which main.js feeds here as it feeds the livery and the recording), while he
// is in the car, every ASK_EVERY_MS at most, and tells the page (rig-limits) when the answer changes; a page that loaded
// after is given the last answer (get-rig-limits). Out of the car nothing is asked and the page is told not known.
// Nothing here throws, and a host that does not answer is "not known", never a number.
//
//   { brakeKg: 45 | null, car: 'mx5 mx52016' | null }
const http = require('http');
const RacingDeskInCar = require('./in-car');
const rigApi = require('./rig-api');

const BRAKE_FORCE_PATH = '/racing-desk/data/brakeforce';
const ASK_EVERY_MS = 2000;
const ANSWER_WITHIN_MS = 1500;
const MAX_ANSWER_BYTES = 4096;

const NOT_KNOWN = Object.freeze({ brakeKg: null, car: null });

// The host's answer as the page is told it: a force of nought or more in kg, else not known; the car as a string, else none.
function readAnswer(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ...NOT_KNOWN };
  const kg = typeof body.force_kg === 'number' && Number.isFinite(body.force_kg) && body.force_kg >= 0 ? body.force_kg : null;
  const car = typeof body.car === 'string' && body.car.length ? body.car.slice(0, 200) : null;
  return { brakeKg: kg, car };
}

// GET the brake force. Resolves the answer as the page is told it, not known for anything that is not one: nothing
// listening, no answer in time, a status other than 200, a body that is not JSON. Never rejects. Node's http.get sends
// a Host and nothing a browser sends, which is what the host answers.
function fetchBrakeForce(url, { timeoutMs = ANSWER_WITHIN_MS, get = http.get } = {}) {
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
      finish({ ...NOT_KNOWN });
      try { if (req) req.destroy(); } catch (e) { /* already gone */ }
    };
    deadline = setTimeout(giveUp, timeoutMs);
    if (typeof deadline.unref === 'function') deadline.unref();
    try {
      req = get(url, { timeout: timeoutMs, headers: { Accept: 'application/json' } }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          finish({ ...NOT_KNOWN });
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
            finish(readAnswer(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
          } catch (e) {
            finish({ ...NOT_KNOWN });
          }
        });
        res.on('error', () => finish({ ...NOT_KNOWN }));
      });
      req.on('timeout', giveUp);
      req.on('error', () => finish({ ...NOT_KNOWN }));
    } catch (e) {
      finish({ ...NOT_KNOWN });
    }
  });
}

/**
 * The keeper. `host()` is where the app's host is now (it can move: :8889, or :18889 beside SimHub); `send(limits)` tells
 * the HUD's page; `fetch(url)` resolves the host's answer (fetchBrakeForce, or a stand-in in the tests).
 *
 *   feed(payload)   the telemetry the HUD keeper polled, or null: asks the host while he is in the car
 *   current()       what the page was last told, for one that loaded after
 */
function createRigLimits({ host, send, fetch = fetchBrakeForce, now = Date.now, everyMs = ASK_EVERY_MS, log = () => {} }) {
  let current = { ...NOT_KNOWN };
  let asking = false;
  let askedAt = -Infinity;
  let saidNotLocal = false;

  function tell(next) {
    if (next.brakeKg === current.brakeKg && next.car === current.car) return;
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
    asking = true;
    try {
      const answer = await fetch(url);
      tell(readAnswer(answer));
    } catch (e) {
      tell({ ...NOT_KNOWN });
    } finally {
      asking = false;
      askedAt = now();
    }
  }

  function feed(payload) {
    if (!RacingDeskInCar.inCar(payload)) {
      tell({ ...NOT_KNOWN });
      return;
    }
    if (asking || now() - askedAt < everyMs) return;
    ask();
  }

  return { feed, current: () => ({ ...current }) };
}

module.exports = { BRAKE_FORCE_PATH, ASK_EVERY_MS, ANSWER_WITHIN_MS, NOT_KNOWN, readAnswer, fetchBrakeForce, createRigLimits };
