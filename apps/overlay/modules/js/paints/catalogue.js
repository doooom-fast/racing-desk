// Every car the rig knows, for the Cars page's list: the library's cars, the cars in the iRacing install and
// the cars with a folder in the sim's paint directory, merged into one list keyed on the sim's car path, each with
// its full name where the local store has one. There was no Rust for this — the Tauri shell lists the library and
// nothing else.
//
// The sim's car path is the car's folder under <install>\cars with the folders joined by spaces: cars\lotus79 is
// `lotus79`, cars\mx5\mx52016 is `mx5 mx52016`, cars\dirtsprint\winged\410 is `dirtsprint winged 410`. It is also
// the name of the car's folder in the paint directory, and the `car_path` the store keeps a name against.
//
// Nothing of iRacing's is read: a folder holding a .dat file is a car, and that the file is there is all that is
// asked of it.
const fs = require('fs');
const path = require('path');
const { normalise } = require('./library');
const { expandEnv } = require('./paths');
const { run } = require('./exec');

// Where the iRacing UI registers itself as the handler of iracing:// links — rewritten every time it starts, so
// it follows the install around. The uninstall key does not: on the rig this was written for it points at a copy
// on another drive that is no longer the one that runs.
const URL_HANDLER_KEY = 'HKCU\\Software\\Classes\\iracing\\shell\\open\\command';

// How long reg may take to answer. It answers in milliseconds; one that never does must not hold the list up.
const REG_TIMEOUT_MS = 3000;

// Folders of cars\ itself whose cars are not the driver's to paint: the pace cars. The store never has a name for
// one — the host leaves the pace car out of a session's cars — so they would be listed by folder for good.
const INSTALL_NOT_CARS = Object.freeze(['safety']);

// How deep under cars\ a car can be. The install goes three folders down (dirtsprint\winged\410); one more is
// slack, and a bound at all is so that a stray folder tree cannot turn the walk into a crawl.
const MAX_DEPTH = 4;

// The sim's own folders in the paint directory. Trading Paints leaves car_spec_<id>.mip files in helmets and
// suits, so "holds car files" alone would take them for cars.
const NOT_CARS = Object.freeze(['helmets', 'suits', 'cars']);

const CAR_FILE = /^car_.+\.(tga|mip)$/i;

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch (e) { return false; }
}

function entriesOf(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return null; }
}

// The default value out of `reg query <key> /ve` output:
//     HKEY_CURRENT_USER\Software\Classes\iracing\shell\open\command
//         (Default)    REG_SZ    "C:\...\iRacing\ui\iRacingUI.exe" "%1"
function parseDefaultValue(text) {
  const m = /^\s+\S.*?\s+REG_(?:EXPAND_)?SZ\s+(.*?)\s*$/m.exec(text || '');
  return m && m[1].length ? m[1] : null;
}

// The program a shell command line starts: the quoted path, or up to the end of the first .exe, or the first word.
function programOf(command) {
  const text = String(command || '').trim();
  if (!text.length) return null;
  if (text.startsWith('"')) {
    const end = text.indexOf('"', 1);
    return end > 1 ? text.slice(1, end) : null;
  }
  const exe = /^.*?\.exe\b/i.exec(text);
  return exe ? exe[0] : text.split(/\s+/)[0];
}

// The install the iracing:// registration points at: <root>\ui\iRacingUI.exe, so two folders above the program.
// Null for a registration that is not the whole path of a program — a bare command, a value that was never set —
// which has no folders above it but the working directory's.
async function installFromRegistry({ exec = run, env = process.env, platform = process.platform } = {}) {
  if (platform !== 'win32') return null;
  const res = await exec('reg', ['query', URL_HANDLER_KEY, '/ve'], { timeoutMs: REG_TIMEOUT_MS });
  if (!res || res.error || res.status !== 0) return null;
  const program = programOf(parseDefaultValue(res.stdout));
  if (!program) return null;
  const expanded = expandEnv(program, env);
  if (!path.isAbsolute(expanded) || !/\.exe$/i.test(expanded)) return null;
  return path.dirname(path.dirname(expanded));
}

// Where installs usually are, for a machine whose iRacing UI has never registered itself.
function usualInstalls(env = process.env) {
  const out = [];
  for (const key of ['ProgramFiles(x86)', 'ProgramFiles', 'ProgramW6432']) {
    const base = env[key];
    if (typeof base !== 'string' || !base.length) continue;
    for (const p of [path.join(base, 'Steam', 'steamapps', 'common', 'iRacing'), path.join(base, 'iRacing')]) {
      if (!out.includes(p)) out.push(p);
    }
  }
  return out;
}

// The iRacing install: the folder set by hand, then the one the iracing:// registration points at, then the usual
// places — the first of them that is a whole path and holds a `cars` folder. Null when none does; the list is then
// the library and the paint directory alone.
async function installRoot({ override, env = process.env, exec = run, platform = process.platform } = {}) {
  const candidates = [];
  if (typeof override === 'string' && override.trim().length) candidates.push(override.trim());
  const registered = await installFromRegistry({ exec, env, platform });
  if (registered) candidates.push(registered);
  candidates.push(...usualInstalls(env));
  for (const candidate of candidates) {
    // Anything less than a whole path would be looked for in the working directory.
    if (path.isAbsolute(candidate) && isDir(path.join(candidate, 'cars'))) return candidate;
  }
  return null;
}

// Walk <root>\cars. Every folder holding a .dat of its own comes back as a car path, in one of two lists:
//
//   cars      nothing beneath it is a car — lotus79, mx5 mx52016
//   families  folders beneath it are cars too — mx5, fordgt
//
// A family folder's .dat is what the cars beneath it are built on, and the disk does not say whether the folder is
// a car in its own right as well: fordgt is (beside fordgt gt3), mx5 is not (cup, roadster and mx52016 are). So
// catalogue() lists a family only when something else knows it as a car. A folder with no .dat is never a car,
// whatever is beneath it (caterham, astonmartin), and cars\safety is not walked at all (INSTALL_NOT_CARS).
function walkInstall(root) {
  const cars = [];
  const families = [];
  const visit = (dir, parts) => {
    const entries = entriesOf(dir);
    if (!entries) return false;
    const own = parts.length > 0 && entries.some((e) => e.isFile() && e.name.toLowerCase().endsWith('.dat'));
    let beneath = false;
    if (parts.length < MAX_DEPTH) {
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        if (parts.length === 0 && INSTALL_NOT_CARS.includes(e.name.toLowerCase())) continue;
        if (visit(path.join(dir, e.name), [...parts, e.name])) beneath = true;
      }
    }
    if (own) (beneath ? families : cars).push(parts.join(' '));
    return own || beneath;
  };
  if (root) visit(path.join(String(root), 'cars'), []);
  return { cars: cars.sort(cmp), families: families.sort(cmp) };
}

// The car paths in the install that are certainly cars. See walkInstall for the ones that may be.
function installedCars(root) {
  return walkInstall(root).cars;
}

function holdsCarFiles(dir) {
  const entries = entriesOf(dir);
  return !!entries && entries.some((e) => e.isFile() && CAR_FILE.test(e.name));
}

function text(v) {
  return typeof v === 'string' && v.trim().length ? v : null;
}

// The list. `library` is library.scan()'s answer (or null), `paintDir` the sim's paint directory, `installRoot`
// the install (or null), `names` the store's rows: { car_path, name, short_name, driven, … }.
//
// One entry per car, on the sim's car path with `-`, `_` and case folded away, so the library's `mx5-mx52016`, the
// install's `mx5\mx52016` and the paint directory's `mx5 mx52016` are one car:
//
//   folder             the library's folder for it, else the car path
//   simFolder          its folder in the paint directory, null when there is none
//   simFolderInferred  the library matched its folder to the sim's loosely
//   versions           the library's, [] outside it
//   name, shortName    from the store, null when the car has never been in a session
//   installed          in the install
//   installPath        the install's name for it — what the sim calls its paint folder — null outside the install
//   driven             the driver's own sessions in it, 0 when unknown
//
// A library car is kept exactly as the library described it. A folder in the paint directory is a car when the
// install has it or it holds car_*.tga / car_*.mip files itself, which leaves out helmets and suits by name
// (NOT_CARS), and the folder the library is in — a checkout in the paint directory — whatever is lying in it.
function catalogue({ library = null, paintDir = null, installRoot: root = null, names = [] } = {}) {
  const named = new Map();
  for (const row of Array.isArray(names) ? names : []) {
    if (!row || typeof row.car_path !== 'string') continue;
    const key = normalise(row.car_path);
    if (key.length && !named.has(key)) named.set(key, row);
  }

  const walked = walkInstall(root);
  const certain = new Map(walked.cars.map((p) => [normalise(p), p]));
  const families = new Map(walked.families.map((p) => [normalise(p), p]));

  const paint = new Map();
  for (const e of (paintDir && entriesOf(paintDir)) || []) {
    if (!e.isDirectory()) continue;
    const key = normalise(e.name);
    if (key.length && !paint.has(key)) paint.set(key, e.name);
  }

  const describe = (key) => {
    const row = named.get(key);
    const driven = row ? Number(row.driven) : 0;
    return {
      name: row ? text(row.name) : null,
      shortName: row ? text(row.short_name) : null,
      installed: certain.has(key) || families.has(key),
      installPath: certain.get(key) || families.get(key) || null,
      driven: Number.isFinite(driven) && driven > 0 ? driven : 0,
    };
  };

  const out = [];
  const listed = new Set();

  for (const car of (library && Array.isArray(library.cars) ? library.cars : [])) {
    const key = normalise(car.simFolder != null ? car.simFolder : car.folder);
    listed.add(key);
    out.push({
      folder: car.folder,
      simFolder: car.simFolder,
      simFolderInferred: car.simFolderInferred,
      versions: car.versions,
      ...describe(key),
    });
  }

  const add = (key, carPath) => {
    if (listed.has(key)) return;
    listed.add(key);
    out.push({
      folder: carPath,
      simFolder: paint.has(key) ? paint.get(key) : null,
      simFolderInferred: false,
      versions: [],
      ...describe(key),
    });
  };

  for (const [key, carPath] of certain) add(key, carPath);
  for (const [key, carPath] of families) {
    if (named.has(key) || paint.has(key)) add(key, carPath);
  }
  const libraryRoot = library && typeof library.root === 'string' && library.root.length ? path.resolve(library.root) : null;
  const holdsLibrary = (dir) => {
    if (libraryRoot === null) return false;
    const within = path.relative(path.resolve(dir), libraryRoot);
    return within !== '..' && !within.startsWith(`..${path.sep}`) && !path.isAbsolute(within);
  };
  for (const [key, folder] of paint) {
    if (listed.has(key) || NOT_CARS.includes(key)) continue;
    const dir = path.join(paintDir, folder);
    if (!holdsLibrary(dir) && holdsCarFiles(dir)) add(key, folder);
  }

  const label = (car) => (car.name || car.folder).toLowerCase();
  return out.sort((a, b) => cmp(label(a), label(b)) || cmp(a.folder, b.folder));
}

module.exports = {
  URL_HANDLER_KEY, REG_TIMEOUT_MS, NOT_CARS, INSTALL_NOT_CARS, parseDefaultValue, programOf, installFromRegistry,
  usualInstalls, installRoot, walkInstall, installedCars, catalogue,
};
