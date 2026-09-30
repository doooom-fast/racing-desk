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
// rules about cooked files hold for each. A car that already has the version on it — its helmet too, where one
// comes with it — is left alone — no backup, no write — which is what makes setting a group twice cost nothing.
// One car failing does not stop the rest; what happened to each comes back.
//
// The helmet comes with the livery, and the group sees to the default helmet once for all its cars: the set the
// library's manifest names as its default (apply.js), put in place after the cars where it is missing or is
// another — never the set the cars wear. The default that was there is backed up before any car is touched, and
// every car's backup names that backup, so reverting any one of them puts the default back as well. A default in
// place already is left as it is, backup and all.
const path = require('path');
const apply = require('./apply');
const customer = require('./customer');
const helmets = require('./helmets');
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
//
// A folder the library names for the car (a version's meta.json can) is taken as named, there or not: a name is
// not a folder. It is made, as any is, only when it is missing and the install has a car by that name — what a
// one-car apply decides for itself (index.js).
function target(car, installedCars) {
  const names = installedCars || [];
  if (car.simFolder != null) return { simFolder: car.simFolder, createFolder: names.includes(car.simFolder) };
  const key = library.normalise(car.folder);
  const carPath = names.find((p) => library.normalise(p) === key);
  return carPath ? { simFolder: carPath, createFolder: true } : null;
}

// Whether what is in the car's folder is this version already, as far as this apply would write it. A version
// with no spec map writes the paint alone, whatever spec map is in the folder, so for it the paint decides. A
// version that comes with a helmet (`helmetSource`, the library's file) is on the car only when that helmet is too.
function alreadyOn(paintDir, simFolder, customerId, version, includeSpec, helmetSource = null) {
  let state;
  try {
    state = installed.identify(installed.read(paintDir, simFolder, customerId), [version]);
  } catch (e) {
    return false;
  }
  if (state.appliedVersionId !== version.id) return false;
  const paintAlone = !includeSpec || !version.hasSpec;
  if (!(state.matchKind === 'exact' || (paintAlone && state.matchKind === 'paint-only'))) return false;
  if (!helmetSource) return true;
  // No helmet on the car, or one that cannot be read: the apply puts it there.
  return apply.sameBytes(path.join(paintDir, simFolder, helmets.installedName(customerId)), helmetSource.path);
}

// What is said of the default helmet where the library keeps no helmet list, or one that cannot be read.
function noList(manifest) {
  return manifest.reason === 'unreadable' || manifest.reason === 'malformed'
    ? "The library's helmet list could not be read, so the default helmet was left as it was."
    : 'The library keeps no helmets, so the default helmet was left as it was.';
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
  const warnings = [...pre.warnings, ...pre.blockers.map((b) => `Set anyway, over a warning: ${b}`)];

  // Which helmet each car's version comes with, read once for the group. And the default helmet — the set the
  // library names as its default, whatever the cars wear — looked at before any car is touched, so that where it
  // is to be put in place the default that is there is backed up first, once, and every car's backup names that
  // one backup. A default in place already is neither backed up nor written again, as a car already wearing its
  // version is left alone: setting a group twice costs nothing.
  const manifest = helmets.readManifest(request.libraryRoot);
  const comesWith = new Map();
  for (const entry of group.cars) {
    const car = lib.cars.find((c) => c.folder === entry.folder);
    const version = car ? car.versions.find((v) => v.id === entry.versionId) : undefined;
    if (version) comesWith.set(entry.folder, helmets.resolve(request.libraryRoot, car.folder, version.id, manifest));
  }
  const fallback = apply.defaultHelmet(paintDir, request.libraryRoot, customerId, manifest);
  const now = deps && typeof deps.now === 'function' ? deps.now : () => new Date();
  const defaultBackup = fallback.source && !fallback.inPlace ? apply.backUpDefault(paintDir, base, customerId, `set ${group.name}`, now) : null;

  const results = [];
  for (const entry of group.cars) {
    const result = { folder: entry.folder, simFolder: null, versionId: entry.versionId, outcome: 'skipped', detail: '', backupDir: null, warnings: [], helmet: null };
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

    const helmet = comesWith.get(entry.folder) || null;
    if (alreadyOn(paintDir, where.simFolder, customerId, version, includeSpec, helmet ? helmet.source : null)) {
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
        // The group sees to the default once, below, for every car; each car's backup names the default's.
        ensureDefaultHelmet: false,
        defaultHelmetBackup: defaultBackup ? defaultBackup.id : null,
      }, version, base, deps);
      result.outcome = 'applied';
      result.detail = report.actions.filter((a) => a.kind === 'install').map((a) => a.detail).join(', ');
      result.backupDir = report.backupDir;
      result.helmet = report.helmet;
      // What every car would repeat was said once, above.
      result.warnings = report.warnings.filter((w) => !pre.warnings.includes(w) && !pre.blockers.some((b) => w.endsWith(b)));
    } catch (e) {
      result.outcome = 'failed';
      result.detail = messageOf(e);
    }
  }

  // The default helmet, once, after the cars: the library's default set, put in place where it was missing or
  // another, whether or not any car needed writing. What the cars wear has no say in it. A library that keeps no
  // helmet list has no default to see to, and the group says so once, where each car said it of its own helmet.
  const done = apply.writeDefault(paintDir, customerId, fallback, warnings);
  const helmet = { set: fallback.set, put: done.put, said: done.said || noList(manifest), backupDir: defaultBackup ? defaultBackup.dir : null };

  const count = (outcome) => results.filter((r) => r.outcome === outcome).length;
  return {
    groupId: group.id,
    name: group.name,
    results,
    applied: count('applied'),
    already: count('already'),
    skipped: count('skipped'),
    failed: count('failed'),
    warnings,
    helmet,
  };
}

module.exports = {
  STORE_KEY, MAX_NAME, fromLibrary, validate, stored, resolve, list, save, remove, find, target, alreadyOn, set,
};
