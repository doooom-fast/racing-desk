// The desk's Paints page reaches the livery manager (modules/js/paints) over one IPC channel, paints:invoke,
// carrying a command's camelCase name and the named arguments apps/paints/src/api.ts sends with it. This is the
// part of that handler that needs no Electron, so it can be tested without one: which names may be called, and
// how each one's named arguments become the positional ones the commands take. main.js wires it to ipcMain and
// hands in the settings store.

// Every command the renderer may call, and how its arguments are passed on. Anything not listed is refused —
// including anything on Object.prototype, hence the own-property check below.
const CALLS = Object.freeze({
  detectPaths: (c) => c.detectPaths(),
  detectCustomer: (c, { paintDir }) => c.detectCustomer(paintDir),
  scanLibrary: (c, { libraryRoot, paintDir }) => c.scanLibrary(libraryRoot, paintDir),
  carState: (c, args) => c.carState(args),
  tradingPaintsStatus: (c) => c.tradingPaintsStatus(),
  simStatus: (c) => c.simStatus(),
  preflight: (c, { paintDir, simFolder }) => c.preflight(paintDir, simFolder),
  applyVersion: (c, { request }) => c.applyVersion(request),
  listBackups: (c, { carFolder }) => c.listBackups(carFolder),
  revertCar: (c, args) => c.revertCar(args),
  repoStatus: (c, { path }) => c.repoStatus(path),
  repoCheck: (c, { path }) => c.repoCheck(path),
  repoPull: (c, { path }) => c.repoPull(path),
  suggestLibraries: (c, { paintDir }) => c.suggestLibraries(paintDir),
  loadSettings: (c, _args, store) => c.loadSettings(store),
  saveSettings: (c, { settings }, store) => {
    // Without them the port would save its defaults over what is remembered; the Rust refused the call.
    if (settings === null || typeof settings !== 'object') throw new Error('saveSettings needs the settings.');
    return c.saveSettings(settings, store);
  },
  previewImage: (c, { path, maxEdge }) => c.previewImage(path, maxEdge),
  carCatalogue: (c, { libraryRoot, paintDir }) => c.carCatalogue({ libraryRoot, paintDir }),
});

const NAMES = Object.freeze(Object.keys(CALLS));

// Whether `name` is a command the renderer may call: one of ours, and one `commands` actually has.
function isCommand(commands, name) {
  return typeof name === 'string'
    && Object.prototype.hasOwnProperty.call(CALLS, name)
    && commands != null
    && typeof commands[name] === 'function';
}

// Run `name` from `commands` (paints.createCommands()) with the renderer's named arguments. Rejects with an Error
// for a name it will not dispatch; otherwise the command's own result or rejection comes back untouched.
async function invoke(commands, store, name, args) {
  if (!isCommand(commands, name)) throw new Error(`Not a paints command: ${String(name)}`);
  const named = args !== null && typeof args === 'object' ? args : {};
  return CALLS[name](commands, named, store);
}

module.exports = { NAMES, isCommand, invoke };
