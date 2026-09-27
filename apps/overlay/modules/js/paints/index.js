// The livery manager's command surface: the 17 Tauri commands from apps/paints/src-tauri/src/lib.rs, in camelCase,
// with the argument shapes of apps/paints/src/api.ts and the return shapes of src/types.ts, so the React UI can be
// reused unchanged over an IPC bridge. Everything here runs under plain Node — no Electron imports — and every
// command returns a Promise; main.js wires each key to an ipcMain.handle and awaits it.
//
// The Rust side owned every decision that touches the disk, and so does this: the UI asks for things to happen
// and renders what comes back; it never builds a path or a filename of its own, so the rules about backups,
// renaming and cooked files live in exactly one place.
const apply = require('./apply');
const customer = require('./customer');
const digest = require('./digest');
const error = require('./error');
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
// `env`, `exec` (how commands are run) and `registry` (how Documents is looked up).
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

  return {
    detectPaths: async () => paths.detect({ env, exec, registry: overrides.registry }),

    detectCustomer: async (paintDir) => customer.detect(paintDir, { tradingPaints }),

    scanLibrary: async (libraryRoot, paintDir) => library.scan(libraryRoot, paintDir || null),

    // The installed state of one car, with the applied version worked out by hashing.
    carState: async ({ paintDir, libraryRoot, carFolder, simFolder, customerId }) => {
      const lib = library.scan(libraryRoot, paintDir);
      const car = lib.cars.find((c) => c.folder === carFolder);
      if (!car) throw error.other(`${carFolder} is not in the library.`);
      const sim = simFolder != null ? simFolder : car.simFolder;
      const state = installed.read(paintDir, sim, customerId);
      installed.identify(state, car.versions);
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
      return apply.apply(request, version, base(), applyDeps);
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
  };
}

const commands = createCommands();

// Every command name, in the order lib.rs registers them — handy for wiring IPC handlers in a loop.
const COMMAND_NAMES = Object.freeze(Object.keys(commands));

module.exports = {
  commands,
  createCommands,
  COMMAND_NAMES,
  apply,
  customer,
  digest,
  error,
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
