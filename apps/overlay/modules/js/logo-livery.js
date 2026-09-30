// The livery behind the HUD's car badge: which paint, when, and what is kept.
//
// The square under the car's logo was a flat splash of the maker's colour. Now it is a section of the paint the
// sim is showing on his car — Documents\iRacing\paint\<car>\car_<customer id>.tga, the very bytes the sim reads —
// cropped to a window with artwork in it (logo-livery-picker.js) and laid under the logo. The main process
// chooses it, here, and never on the page: the page reads no file and builds no path. It is chosen when he gets
// in the car and when the car changes while he is in it, once each, and kept until the next of those: the choice
// is random among the best few, so each time he gets in the car it is another section, and within a drive it
// does not flicker. Getting out keeps the last crop (the HUD is hidden then anyway; the iPad shows the last car).
//
// What names the paint: the car's folder is the sim's CarPath, which the host sends in the car-controls key for a
// car the list has (`car`); for one it does not, the store's name for the car matches the telemetry's model name
// (`carNames`, /racing-desk/data/cars). The paint folder and the customer id are the desk's paint settings. None
// of those three is enough on its own, and with any missing the badge is the maker's colour, as it was.
//
// The paint is read and decoded in a worker (logo-livery-worker.js), one at a time; a newer wish supersedes a pick
// still under way, whose answer is then dropped. Nothing here throws into the poll that feeds it, and no line of
// the log carries the customer id or the paint's path.
'use strict';
const path = require('path');
const fs = require('fs');
const { Worker } = require('worker_threads');
const { createInCarSignal } = require('./in-car');
const { isValid: isCustomerId } = require('./paints/customer');

const CAR_CONTROLS_KEY = 'RacingDesk.Plugin.CarControls';
const CAR_MODEL_KEY = 'DataCorePlugin.GameData.CarModel';
const DEMO_KEY = 'RacingDesk.Plugin.DemoMode';

// The crop's edge: about twice the badge's largest size on any screen (the glance layout's cell on the rig's
// ultrawide is about 290 pixels across).
const CROP_EDGE = 512;
// A 2048 by 2048 paint at 32 bits is 16 megabytes; nothing larger than this is read.
const MAX_PAINT_BYTES = 70 * 1024 * 1024;
// A pick that has not answered by then is ended: the decode takes a quarter of a second, the whole under one.
const PICK_WITHIN_MS = 20000;
// The worker's file, beside this one. In the built app this folder is inside app.asar; the worker's files are
// unpacked beside it (electron-builder.yml, asarUnpack), and a worker is started from the unpacked copy.
const WORKER_FILE = 'logo-livery-worker.js';

// The sim's folder name for a car: `mx5 mx52016`, `dallara dallarair18` — letters, digits, spaces, hyphens and
// underscores, and nothing that is a path.
const CAR_PATH_SHAPE = /^[a-z0-9][a-z0-9 _.-]{0,79}$/i;

function isCarPath(value) {
  return typeof value === 'string' && CAR_PATH_SHAPE.test(value) && !value.includes('..') && !/\.$/.test(value.trim());
}

// The host's car-controls key, as an object from :8889 or its text from the WebSocket feed; null for neither.
function carControlsOf(payload) {
  const raw = payload ? payload[CAR_CONTROLS_KEY] : undefined;
  if (raw === undefined || raw === null || raw === '') return null;
  let cc = raw;
  if (typeof cc === 'string') {
    try { cc = JSON.parse(cc); } catch (e) { return null; }
  }
  return cc && typeof cc === 'object' && !Array.isArray(cc) ? cc : null;
}

// The car the payload names: { carPath } where the host sent it, else { model } for the store to name, or null
// (the demo, no car, a payload that is not one).
function carOfPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const demo = payload[DEMO_KEY];
  if (demo === true || Number(demo) > 0 || (typeof demo === 'string' && /^true$/i.test(demo.trim()))) return null;
  const cc = carControlsOf(payload);
  if (cc && isCarPath(cc.car)) return { carPath: cc.car.trim() };
  const model = payload[CAR_MODEL_KEY];
  if (typeof model === 'string' && model.trim().length) return { model: model.trim() };
  return null;
}

// The store's folder name for a car, by the sim's name for it: the rows /racing-desk/data/cars gives.
function carPathByName(rows, model) {
  if (!Array.isArray(rows) || typeof model !== 'string') return null;
  const wanted = model.trim().toLowerCase();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || typeof row.car_path !== 'string') continue;
    const name = typeof row.name === 'string' ? row.name.trim().toLowerCase() : '';
    if (name.length && name === wanted && isCarPath(row.car_path)) return row.car_path.trim();
  }
  return null;
}

// The worker's file: the unpacked copy in the built app, this folder's otherwise.
function workerFile(dir = __dirname) {
  const here = path.join(dir, WORKER_FILE);
  const unpacked = here.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  if (unpacked !== here) {
    try { if (fs.existsSync(unpacked)) return unpacked; } catch (e) { /* the packed copy, then */ }
  }
  return here;
}

// One pick, in a worker of its own. Resolves the PNG (a Buffer) or null where there is nothing to show; rejects
// for a paint that could not be read or decoded, with a reason that carries no path.
function pickInWorker(job, { file = workerFile(), timeoutMs = PICK_WITHIN_MS } = {}) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(file, { workerData: job });
    } catch (e) {
      reject(new Error(`the worker could not be started (${e.code || e.message})`));
      return;
    }
    let done = false;
    let timer = null;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      if (timer !== null) clearTimeout(timer);
      fn(value);
    };
    timer = setTimeout(() => {
      finish(reject, new Error('the crop took too long'));
      worker.terminate().catch(() => {});
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    worker.once('message', (m) => {
      if (!m || typeof m !== 'object') finish(reject, new Error('the worker answered nothing'));
      else if (!m.ok) finish(reject, new Error(String(m.reason || 'the worker failed')));
      else if (!m.png) finish(resolve, null);
      else finish(resolve, { png: Buffer.from(m.png.buffer, m.png.byteOffset, m.png.byteLength), window: m.window, ms: m.ms });
    });
    worker.once('error', (e) => finish(reject, new Error(`the worker failed (${e && e.message ? e.message.replace(/[A-Za-z]:[\\/][^\s'"]*/g, '<path>') : 'no reason'})`)));
    worker.once('exit', (code) => { if (!done) finish(reject, new Error(`the worker ended (${code})`)); });
  });
}

/**
 * The keeper.
 *
 *   paintDir()     the paint folder from the settings, or nothing
 *   customerId()   the customer id from the settings, or nothing
 *   carNames()     async: the store's rows (car_path, name), for a car the host did not name; may be left out
 *   pick(job)      async: the crop of the paint the job names — pickInWorker by default; the tests hand in their own
 *   onCrop(crop)   the crop has changed: { png, id, dataUrl } or null
 *   log(line)
 *   random()       a number in [0, 1), for the seed the worker is given
 *
 * { feed(payload), current(), state() }
 */
function createLogoLivery({
  paintDir,
  customerId,
  carNames = null,
  pick = pickInWorker,
  onCrop = null,
  log = () => {},
  random = Math.random,
  size = CROP_EDGE,
  aspect = 1,
  maxBytes = MAX_PAINT_BYTES,
  leaveMs,
  staleMs,
  now = Date.now,
} = {}) {
  let crop = null;          // { png, id, dataUrl, carPath } — what the badge shows
  let wanted = null;        // the car the crop is for, or being made for: 'path:<carPath>' or 'model:<name>'
  let seq = 0;              // each wish is numbered; an answer to an older one is dropped
  let picking = false;
  let picks = 0;

  const signal = createInCarSignal({
    leaveMs, staleMs, now,
    onChange: (inCar) => {
      // Out of the car the wish is let go, so that getting in — into the same car — is a new pick.
      if (!inCar) wanted = null;
    },
  });

  function say(next) {
    if (next === null && crop === null) return;   // nothing was up, and nothing is: the page need not hear it
    crop = next;
    if (typeof onCrop === 'function') {
      try { onCrop(next); } catch (e) { log(`[RacingDesk] Livery: the crop could not be handed on (${e.message})`); }
    }
  }

  function clear(why) {
    if (crop !== null) log(`[RacingDesk] Livery: ${why} → the badge is the maker's colour`);
    else if (why) log(`[RacingDesk] Livery: ${why}`);
    say(null);
  }

  // The car's folder, from what the payload said: at once, or from the store's names.
  async function resolveCarPath(car) {
    if (car.carPath) return car.carPath;
    if (typeof carNames !== 'function') return null;
    let rows;
    try { rows = await carNames(); } catch (e) { rows = null; }
    return carPathByName(rows, car.model);
  }

  async function choose(mine, car) {
    picking = true;
    picks += 1;
    try {
      const carPath = await resolveCarPath(car);
      if (mine !== seq) return;
      if (!carPath) { clear('the store has no folder name for this car yet'); return; }
      const dir = paintDir ? paintDir() : null;
      const id = customerId ? customerId() : null;
      if (typeof dir !== 'string' || !dir.length) { clear('no paint folder is set'); return; }
      if (!isCustomerId(id)) { clear('no customer id is set'); return; }
      const job = {
        paintDir: dir, carFolder: carPath, fileName: `car_${id}.tga`,
        size, aspect, maxBytes, seed: Math.floor(random() * 0x7fffffff) || 1,
      };
      let out;
      try {
        out = await pick(job);
      } catch (e) {
        if (mine !== seq) return;
        clear(`the paint for ${carPath} could not be read (${e.message})`);
        return;
      }
      if (mine !== seq) return;
      if (!out || !Buffer.isBuffer(out.png)) { clear(`no paint with artwork to show for ${carPath}`); return; }
      const idOf = `${mine}-${out.png.length}`;
      say({ png: out.png, id: idOf, dataUrl: `data:image/png;base64,${out.png.toString('base64')}`, carPath });
      const w = out.window || {};
      log(`[RacingDesk] Livery: a crop of the paint for ${carPath} is behind the badge (${out.png.length} bytes, window ${w.w || '?'}px at ${w.x || 0},${w.y || 0}, one of ${w.among || '?'} of ${w.looked || '?'} looked at, ${out.ms || '?'} ms)`);
    } finally {
      if (mine === seq) picking = false;
    }
  }

  // Each poll's payload, or null when nothing answered. Never throws.
  function feed(payload) {
    try {
      const inCar = signal.feed(payload);
      if (!inCar) return;
      const car = carOfPayload(payload);
      const key = car ? (car.carPath ? `path:${car.carPath.toLowerCase()}` : `model:${car.model.toLowerCase()}`) : null;
      if (key === wanted) return;
      wanted = key;
      seq += 1;
      if (!car) { clear(crop ? 'no car to show' : ''); return; }
      choose(seq, car).catch((e) => log(`[RacingDesk] Livery: ${e.message}`));
    } catch (e) {
      log(`[RacingDesk] Livery: ${e.message}`);
    }
  }

  return {
    feed,
    current: () => crop,
    state: () => ({ inCar: signal.inCar(), wanted, picking, picks, has: crop !== null }),
  };
}

module.exports = {
  CROP_EDGE, MAX_PAINT_BYTES, PICK_WITHIN_MS, CAR_CONTROLS_KEY, CAR_MODEL_KEY,
  isCarPath, carOfPayload, carPathByName, workerFile, pickInWorker, createLogoLivery,
};
