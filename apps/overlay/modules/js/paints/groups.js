// Livery groups: one name for a livery across cars, so the whole garage changes paint in one go.
//
// Two kinds.
//
//   library  a version's folder name that more than one car has — "shatter" under seventeen cars. Nothing is
//            made for it and nothing remembered: a car joins the group the moment a folder of that name appears
//            under it in the library.
//   mine     a name and, for each car in it, the version to use — this car in its inverted scheme, the rest in
//            the plain one. Kept with the manager's settings, under `liveryGroups`.
//
// Setting a group applies each car's version with apply.js, car by car, so every car gets its own backup and the
// rules about cooked files hold for each. A car that already has the version on it is left alone — no backup, no
// write — which is what makes setting a group twice cost nothing. One car failing does not stop the rest; what
// happened to each comes back.
const apply = require('./apply');
const customer = require('./customer');
const installed = require('./installed');
const library = require('./library');
const { refused, messageOf } = require('./error');

const STORE_KEY = 'liveryGroups';
const LIBRARY = 'library';
const MINE = 'mine';

// A name is for a list on screen; this many characters is more than fits.
const MAX_NAME = 60;
const MAX_GROUPS = 100;
const MAX_CARS = 1000;

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function text(v, max) {
  return typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max ? v.trim() : null;
}

// The groups the library makes by itself: every version id more than one car has, by name. Ids are compared
// without their case, as the folders they are on disk are.
function fromLibrary(lib) {
  const byId = new Map();
  for (const car of (lib && Array.isArray(lib.cars) ? lib.cars : [])) {
    for (const version of car.versions) {
      const key = version.id.toLowerCase();
      if (!byId.has(key)) byId.set(key, { name: version.id, cars: [] });
      byId.get(key).cars.push({ folder: car.folder, versionId: version.id, versionName: version.name, missing: false });
    }
  }
  const groups = [];
  for (const [key, group] of byId) {
    if (group.cars.length < 2) continue;
    groups.push({ id: `${LIBRARY}:${key}`, name: group.name, kind: LIBRARY, cars: group.cars.sort((a, b) => cmp(a.folder, b.folder)) });
  }
  return groups.sort((a, b) => b.cars.length - a.cars.length || cmp(a.name.toLowerCase(), b.name.toLowerCase()));
}

// What is remembered, made safe to use: [{ id, name, cars: { <car folder>: <version id> } }]. Anything that is not
// that shape is dropped, entry by entry, rather than taking the rest with it.
function validate(raw) {
  const out = [];
  if (!Array.isArray(raw)) return out;
  const ids = new Set();
  for (const entry of raw.slice(0, MAX_GROUPS)) {
    if (!isPlainObject(entry)) continue;
    const id = text(entry.id, 200);
    const name = text(entry.name, MAX_NAME);
    if (!id || !name || !id.startsWith(`${MINE}:`) || ids.has(id) || !isPlainObject(entry.cars)) continue;
    const cars = {};
    for (const folder of Object.keys(entry.cars).slice(0, MAX_CARS)) {
      const versionId = text(entry.cars[folder], 200);
      if (text(folder, 200) && versionId) cars[folder] = versionId;
    }
    ids.add(id);
    out.push({ id, name, cars });
  }
  return out;
}

function stored(store) {
  let raw;
  try {
    raw = store && typeof store.get === 'function' ? store.get() : undefined;
  } catch (e) {
    raw = undefined;
  }
  return validate(isPlainObject(raw) ? raw[STORE_KEY] : undefined);
}

// The store holds the manager's settings whole; the groups are one key of them.
function keep(store, groups) {
  if (!store || typeof store.get !== 'function' || typeof store.set !== 'function') throw new Error('No settings store to save into.');
  const raw = store.get();
  store.set({ ...(isPlainObject(raw) ? raw : {}), [STORE_KEY]: groups });
}

// A group of the driver's own against the library as it is now: each car with its version's name, and whether
// that version is still there.
function resolve(group, lib) {
  const cars = [];
  for (const folder of Object.keys(group.cars).sort(cmp)) {
    const car = lib && Array.isArray(lib.cars) ? lib.cars.find((c) => c.folder === folder) : undefined;
    const version = car ? car.versions.find((v) => v.id === group.cars[folder]) : undefined;
    cars.push({ folder, versionId: group.cars[folder], versionName: version ? version.name : group.cars[folder], missing: !version });
  }
  return { id: group.id, name: group.name, kind: MINE, cars };
}

// Every group: the driver's own first, by name, then the library's, largest first.
function list(lib, store) {
  const mine = stored(store).map((g) => resolve(g, lib)).sort((a, b) => cmp(a.name.toLowerCase(), b.name.toLowerCase()));
  return [...mine, ...fromLibrary(lib)];
}

function slug(name) {
  return name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'group';
}

// Make a group, or change one: `id` names the one to change. `cars` is { <car folder>: <version id> }; a car given
// null, or an empty string, is left out of the group. Returns the group as list() would.
function save(store, lib, { id = null, name, cars } = {}) {
  const clean = text(name, MAX_NAME);
  if (!clean) throw refused(`A group needs a name, of at most ${MAX_NAME} characters.`);
  if (!isPlainObject(cars)) throw refused('A group needs its cars.');

  const chosen = {};
  for (const folder of Object.keys(cars)) {
    if (cars[folder] === null || cars[folder] === '') continue;
    const versionId = text(cars[folder], 200);
    const car = lib && Array.isArray(lib.cars) ? lib.cars.find((c) => c.folder === folder) : undefined;
    if (!versionId || !car || !car.versions.some((v) => v.id === versionId)) {
      throw refused(`${folder} / ${String(cars[folder])} is not in the library.`);
    }
    chosen[folder] = versionId;
  }
  if (!Object.keys(chosen).length) throw refused('A group with no car in it would set nothing.');

  const groups = stored(store);
  if (groups.some((g) => g.id !== id && g.name.toLowerCase() === clean.toLowerCase())) {
    throw refused(`There is a group called ${clean} already.`);
  }

  let group;
  if (id !== null) {
    group = groups.find((g) => g.id === id);
    if (!group) throw refused('That group is not one of yours to change.');
    group.name = clean;
    group.cars = chosen;
  } else {
    if (groups.length >= MAX_GROUPS) throw refused(`${MAX_GROUPS} groups is as many as are kept.`);
    const base = `${MINE}:${slug(clean)}`;
    let fresh = base;
    for (let n = 2; groups.some((g) => g.id === fresh); n++) fresh = `${base}-${n}`;
    group = { id: fresh, name: clean, cars: chosen };
    groups.push(group);
  }
  keep(store, groups);
  return resolve(group, lib);
}

// Forget a group of the driver's own. The liveries are the library's and stay where they are.
function remove(store, id) {
  const groups = stored(store);
  const left = groups.filter((g) => g.id !== id);
  if (left.length === groups.length) return false;
  keep(store, left);
  return true;
}

function find(lib, store, id) {
  return list(lib, store).find((g) => g.id === id) || null;
}

// Where a car's paint goes: its folder in the paint directory, or — for a car never driven, which has none yet —
// the folder the sim would make for it, named as the install names the car. Null when neither is known.
function target(car, installedCars) {
  if (car.simFolder != null) return { simFolder: car.simFolder, createFolder: false };
  const key = library.normalise(car.folder);
  const carPath = (installedCars || []).find((p) => library.normalise(p) === key);
  return carPath ? { simFolder: carPath, createFolder: true } : null;
}

// Whether what is in the car's folder is this version already, as far as this apply would write it.
function alreadyOn(paintDir, simFolder, customerId, version, includeSpec) {
  let state;
  try {
    state = installed.identify(installed.read(paintDir, simFolder, customerId), [version]);
  } catch (e) {
    return false;
  }
  if (state.appliedVersionId !== version.id) return false;
  return state.matchKind === 'exact' || (!includeSpec && state.matchKind === 'paint-only');
}

// Set a group: `request` is { paintDir, libraryRoot, customerId, groupId, includeSpec, setReadOnlyAfter,
// clearOtherCooked, force }. `installedCars` are the install's car paths (catalogue.installedCars), `base` the
// backups folder, `deps` apply.js's.
async function set(request, { lib, store, installedCars = [], base, deps } = {}) {
  const paintDir = String(request.paintDir);
  const customerId = request.customerId == null ? '' : String(request.customerId);
  const includeSpec = request.includeSpec == null ? true : Boolean(request.includeSpec);
  const force = Boolean(request.force);

  if (!customer.isValid(customerId)) throw refused('The customer id must be digits only. Nothing was changed.');
  const group = find(lib, store, String(request.groupId));
  if (!group) throw refused('That group is no longer there. Nothing was changed.');

  // What stands in the way of every car alike is said once, before any car is touched.
  const pre = await apply.preflightAll(deps);
  if (pre.blockers.length && !force) throw refused(pre.blockers.join(' '));

  const results = [];
  for (const entry of group.cars) {
    const result = { folder: entry.folder, simFolder: null, versionId: entry.versionId, outcome: 'skipped', detail: '', backupDir: null, warnings: [] };
    results.push(result);

    const car = lib.cars.find((c) => c.folder === entry.folder);
    const version = car ? car.versions.find((v) => v.id === entry.versionId) : undefined;
    if (!version) {
      result.detail = `${entry.versionId} is no longer in the library for this car.`;
      continue;
    }
    if (!version.hasPaint) {
      result.detail = 'This version has no car paint.';
      continue;
    }
    const where = target(car, installedCars);
    if (!where) {
      result.detail = 'The car has no folder in the paint directory and is not in the iRacing install.';
      continue;
    }
    result.simFolder = where.simFolder;

    if (alreadyOn(paintDir, where.simFolder, customerId, version, includeSpec)) {
      result.outcome = 'already';
      result.detail = 'Already on the car.';
      continue;
    }

    try {
      const report = await apply.apply({
        paintDir,
        libraryRoot: request.libraryRoot,
        carFolder: car.folder,
        simFolder: where.simFolder,
        versionId: version.id,
        customerId,
        includeSpec,
        setReadOnlyAfter: request.setReadOnlyAfter,
        clearOtherCooked: request.clearOtherCooked,
        force,
        createFolder: where.createFolder,
      }, version, base, deps);
      result.outcome = 'applied';
      result.detail = report.actions.filter((a) => a.kind === 'install').map((a) => a.detail).join(', ');
      result.backupDir = report.backupDir;
      // What every car would repeat was said once, above.
      result.warnings = report.warnings.filter((w) => !pre.warnings.includes(w) && !pre.blockers.some((b) => w.endsWith(b)));
    } catch (e) {
      result.outcome = 'failed';
      result.detail = messageOf(e);
    }
  }

  const count = (outcome) => results.filter((r) => r.outcome === outcome).length;
  return {
    groupId: group.id,
    name: group.name,
    results,
    applied: count('applied'),
    already: count('already'),
    skipped: count('skipped'),
    failed: count('failed'),
    warnings: [...pre.warnings, ...pre.blockers.map((b) => `Set anyway, over a warning: ${b}`)],
  };
}

module.exports = {
  STORE_KEY, MAX_NAME, fromLibrary, validate, stored, resolve, list, save, remove, find, target, alreadyOn, set,
};
