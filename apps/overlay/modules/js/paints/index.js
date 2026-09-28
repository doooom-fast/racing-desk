// The livery manager's command surface: the 17 Tauri commands from apps/paints/src-tauri/src/lib.rs, in camelCase,
// with the argument shapes of apps/paints/src/api.ts and the return shapes of src/types.ts, so the React UI can be
// reused unchanged over an IPC bridge — and those the Rust never had: carCatalogue, which needs the install and the
// local store, and the four for livery groups (groups.js). Everything here runs under plain Node — no Electron imports — and every command returns a Promise;
// main.js wires each key to an ipcMain.handle and awaits it.
//
// The Rust side owned every decision that touches the disk, and so does this: the UI asks for things to happen
// and renders what comes back; it never builds a path or a filename of its own, so the rules about backups,
// renaming and cooked files live in exactly one place.
const fs = require('fs');
const path = require('path');
const apply = require('./apply');
const catalogue = require('./catalogue');
const customer = require('./customer');
const digest = require('./digest');
const error = require('./error');
const groups = require('./groups');
const installed = require('./installed');
const library = require('./library');
const paths = require('./paths');
const processMod = require('./process');
const repo = require('./repo');
const roles = require('./roles');
const settings = require('./settings');
const tga = require('./tga');
const tradingpaints = require('./tradingpaints');

// `overrides` lets the host (or a test) swap in its environment: `backupsBase` (a path or a function returning
// one; default %LOCALAPPDATA%\Racing Desk\paints\backups), `simState` and `tradingPaints` (async inspectors),
// `env`, `exec` (how commands are run) and `registry` (how Documents is looked up); for the catalogue, `carNames`
// (async, the store's rows — see car-names.js; none by default) and `installRoot` (the iRacing install set by
// hand: a path, or a function returning one or nothing; detection fills in when it does not hold a cars folder).
function createCommands(overrides = {}) {
  const env = overrides.env || process.env;
  const exec = overrides.exec;
  const simState = overrides.simState || (() => processMod.simState(exec ? { exec } : undefined));
  const tradingPaints = overrides.tradingPaints
    || (() => tradingpaints.inspect({ env, isRunning: (exe) => processMod.isRunning(exe, exec ? { exec } : undefined) }));
  const applyDeps = { simState, tradingPaints, now: overrides.now };
  const repoDeps = exec ? { exec } : undefined;
  const base = () => {
    if (typeof overrides.backupsBase === 'function') return overrides.backupsBase();
    if (typeof overrides.backupsBase === 'string') return overrides.backupsBase;
    return apply.backupsBase({ env });
  };
  const carNames = async () => {
    if (typeof overrides.carNames !== 'function') return [];
    try {
      const rows = await overrides.carNames();
      return Array.isArray(rows) ? rows : [];
    } catch (e) {
      return [];   // names are a nicety: the list falls back to folder names
    }
  };
  const findInstall = () => {
    let override = typeof overrides.installRoot === 'function' ? overrides.installRoot() : overrides.installRoot;
    if (typeof override !== 'string') override = null;
    return catalogue.installRoot({ override, env, exec });
  };
  // The install's names for its cars, families among them: what a car's paint folder is called before there is one.
  const installPaths = async () => {
    const walked = catalogue.walkInstall(await findInstall());
    return [...walked.cars, ...walked.families];
  };
  const isDir = (p) => {
    try { return fs.statSync(p).isDirectory(); } catch (e) { return false; }
  };

  return {
    detectPaths: async () => paths.detect({ env, exec, registry: overrides.registry }),

    detectCustomer: async (paintDir) => customer.detect(paintDir, { tradingPaints }),

    scanLibrary: async (libraryRoot, paintDir) => library.scan(libraryRoot, paintDir || null),

    // The installed state of one car, with the applied version worked out by hashing. A car outside the library —
    // one the catalogue listed from the install or the paint directory — has an installed state like any other,
    // and no versions for it to match.
    carState: async ({ paintDir, libraryRoot, carFolder, simFolder, customerId }) => {
      const lib = library.scan(libraryRoot, paintDir);
      const car = lib.cars.find((c) => c.folder === carFolder);
      let sim = simFolder != null ? simFolder : null;
      if (sim === null) sim = car ? car.simFolder : library.resolveSimFolder(carFolder, null, paintDir).simFolder;
      const state = installed.read(paintDir, sim, customerId);
      installed.identify(state, car ? car.versions : []);
      return state;
    },

    tradingPaintsStatus: async () => tradingPaints(),

    simStatus: async () => simState(),

    preflight: async (paintDir, simFolder) => apply.preflight(paintDir, simFolder, applyDeps),

    applyVersion: async (request) => {
      const lib = library.scan(request.libraryRoot, request.paintDir);
      const car = lib.cars.find((c) => c.folder === request.carFolder);
      const version = car ? car.versions.find((v) => v.id === request.versionId) : undefined;
      if (!version) throw error.other(`${request.carFolder} / ${request.versionId} is no longer in the library.`);
      // Whether a folder may be made is decided here, whatever the page sent: only where there is none, and only
      // under a name the install has for one of its cars.
      const missing = !isDir(path.join(String(request.paintDir), String(request.simFolder)));
      const createFolder = missing && (await installPaths()).includes(String(request.simFolder));
      return apply.apply({ ...request, createFolder }, version, base(), applyDeps);
    },

    listBackups: async (carFolder) => apply.listBackups(base(), carFolder),

    revertCar: async ({ paintDir, carFolder, simFolder, customerId, backupId, force }) => apply.revert(
      paintDir, base(), carFolder, simFolder, customerId, backupId == null ? null : backupId, Boolean(force), applyDeps,
    ),

    // Read the library's git checkout without touching the network.
    repoStatus: async (p) => repo.status(p, repoDeps),

    // Ask the remote whether anything is waiting. Transfers no objects.
    repoCheck: async (p) => repo.check(p, repoDeps),

    // Fast-forward the library to the remote.
    repoPull: async (p) => repo.pull(p, repoDeps),

    // Libraries findable near the sim, so the common case needs no browsing.
    suggestLibraries: async (paintDir) => repo.suggestLibraries(paintDir, { env, exec }),

    // The store is main.js's: { get(), set(obj) }.
    loadSettings: async (store) => settings.load(store),

    saveSettings: async (s, store) => {
      settings.save(store, s);
      return null;
    },

    previewImage: async (p, maxEdge) => tga.previewImage(p, maxEdge),

    // Every car the rig knows, named: the library's, the install's and the paint directory's. Not in lib.rs.
    carCatalogue: async ({ libraryRoot, paintDir } = {}) => {
      const lib = libraryRoot ? library.scan(libraryRoot, paintDir || null) : null;
      const [root, names] = await Promise.all([findInstall(), carNames()]);
      return catalogue.catalogue({ library: lib, paintDir: paintDir || null, installRoot: root, names });
    },

    // Livery groups: the library's own and the driver's. Not in lib.rs.
    liveryGroups: async ({ libraryRoot, paintDir } = {}, store) =>
      groups.list(libraryRoot ? library.scan(libraryRoot, paintDir || null) : null, store),

    saveGroup: async ({ libraryRoot, paintDir, id, name, cars } = {}, store) =>
      groups.save(store, library.scan(libraryRoot, paintDir || null), { id: id == null ? null : id, name, cars }),

    deleteGroup: async (id, store) => groups.remove(store, id),

    setGroup: async (request, store) => {
      if (request === null || typeof request !== 'object') throw error.other('setGroup needs the request.');
      const lib = library.scan(request.libraryRoot, request.paintDir);
      return groups.set(request, { lib, store, installedCars: await installPaths(), base: base(), deps: applyDeps });
    },
  };
}

const commands = createCommands();

// Every command name, in the order lib.rs registers them, then the desk's own — handy for wiring IPC handlers in
// a loop.
const COMMAND_NAMES = Object.freeze(Object.keys(commands));

module.exports = {
  commands,
  createCommands,
  COMMAND_NAMES,
  apply,
  catalogue,
  customer,
  digest,
  error,
  groups,
  installed,
  library,
  paths,
  process: processMod,
  repo,
  roles,
  settings,
  tga,
  tradingpaints,
};
