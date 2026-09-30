// Applying a version, and putting it back. Ported from apps/paints/src-tauri/src/apply.rs.
//
// The rule the whole module is built around: never destructive. A paint can be hours of work, so before a single
// byte is written every file the apply could touch is copied into <backups>/<car>/<timestamp>/ with a manifest.
// Each texture is then written to a temporary name and renamed into place, so a failed or locked copy leaves the
// previous file intact rather than a half-written one. If anything fails partway, what was already replaced is
// rolled back from the backup before the error is reported.
//
// The .mip cleanup is deliberately narrow. The sim cooks <role>_<id>.mip next to each .tga, and a stale one keeps
// the old texture on screen — but the folder also holds cooked files for every driver Trading Paints has
// downloaded. Only this customer's are removed. Clearing the rest is an explicit opt-in, because it costs everyone
// else a re-cook.
//
// Nothing the app did not install is ever deleted: an apply removes only cooked files, and only this customer's;
// a revert removes only this customer's textures that the chosen backup did not contain — the ones the apply
// being undone added — after backing the current state up, which makes a revert undoable in its own right.
//
// The helmet comes with the livery (helmets.js says which). An apply that finds one copies it into the car's folder
// as helmet_<id>.tga after the car's textures, in the same step — backed up first with them, rolled back with them,
// and put back by the same revert. Helmets are per car, so an apply never changes any other car's helmet.
//
// The default helmet, paint/helmet_<id>.tga, worn by every car without one of its own, is the set the library's
// manifest names as its default — never the set a car was just given (his choice, 2026-09-30, over "the last apply
// becomes the default"). An apply sees to it: where the default is missing, or is not that set, the set is put in
// place, the default that was there backed up first under a folder of its own (DEFAULT_HELMET_FOLDER), and the
// car's backup names that backup, so reverting the car puts the default back too. A group sees to it once for all
// its cars (groups.js), and the page asks for it on its own after a library update that changed which set is the
// default (ensureDefault). A group that applies no car, and an update, take a backup of the default that no car's
// backup names, so every backup of the default can also be put back from the page on its own (listDefaultBackups,
// revertDefault), under the same guard: the driver's own default helmet is never lost to the library's.
const fs = require('fs');
const path = require('path');
const customer = require('./customer');
const digest = require('./digest');
const helmets = require('./helmets');
const processMod = require('./process');
const roles = require('./roles');
const tradingpaints = require('./tradingpaints');
const { refused, other, messageOf } = require('./error');

// The temporary name a texture is written to before it is renamed into place. Kept from the Tauri app so a
// leftover from a crash of either gets cleaned up.
const TMP_EXT = 'doooom-tmp';
const APP_DATA_DIR = 'Racing Desk';

// Where the default helmet's backups go, beside the cars' own: paint/helmet_<id>.tga is no car's. A library car
// folder never begins with a dot (library.js skips them), so no car's backups can land here.
const DEFAULT_HELMET_FOLDER = '.default-helmet';

// The shape of a backup folder's name (timestamp), which is what a manifest may name another backup by.
const BACKUP_ID = /^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}_[0-9]{3}(-[0-9]{2})?$/;

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch (e) { return false; }
}

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch (e) { return false; }
}

// A file in the car's folder that is this customer's to back up, move or remove: a car texture or its cooked file
// (roles.js), or the helmet or its cooked file. { role, id, ext } or null.
function parseMine(fileName) {
  return roles.parseInstalled(fileName) || helmets.parseHelmet(fileName);
}

// The process and downloader checks are injectable so the tests run against a quiet machine without starting
// tasklist or reading the real downloader config; `now` so timestamps can be pinned.
function withDefaults(deps = {}) {
  return {
    simState: deps.simState || (() => processMod.simState()),
    tradingPaints: deps.tradingPaints || (() => tradingpaints.inspect()),
    now: deps.now || (() => new Date()),
  };
}

// What stands in the way of any apply on this machine right now, whichever the car: the sim holding paint files
// open, the downloader about to write its own. `blockers` and `warnings` are sentences for the driver; `simRunning`
// and `downloaderRunning` say which of the two a blocker is, for a line that has to name what is in the way without
// telling the driver what to do about it (inTheWay).
async function preflightAll(deps) {
  const d = withDefaults(deps);
  const blockers = [];
  const warnings = [];

  const sim = await d.simState();
  if (sim.simRunning) {
    // The sim holds textures open; a copy can fail with the old file already gone.
    blockers.push('iRacing is running. It holds paint files open, so a swap can fail halfway. Close the sim first.');
  } else if (sim.uiRunning) {
    warnings.push('The iRacing launcher is open. That is harmless now, but starting a session will lock these files.');
  }

  const tp = await d.tradingPaints();
  if (tp.running) blockers.push(...tp.warnings);
  else warnings.push(...tp.warnings);
  return {
    blockers,
    warnings,
    simRunning: !!sim.simRunning,
    downloaderRunning: !!tp.running && tp.warnings.length > 0,
  };
}

// What is in the way, as a clause: "iRacing is running", "the Trading Paints downloader is running", or both.
function inTheWay(pre) {
  const parts = [];
  if (pre.simRunning) parts.push('iRacing is running');
  if (pre.downloaderRunning) parts.push('the Trading Paints downloader is running');
  return parts.length ? parts.join(' and ') : 'something is holding the paint files';
}

function noFolder(simFolder) {
  return `There is no ${simFolder} folder in the paint directory. The sim creates it the first time you `
    + 'drive the car.';
}

// What stands between the user and a safe apply to one car, right now. Returned to the UI so it can say so.
async function preflight(paintDir, simFolder, deps) {
  const { blockers, warnings } = await preflightAll(deps);
  if (!isDir(path.join(paintDir, simFolder))) blockers.push(noFolder(simFolder));
  return { blockers, warnings };
}

const p2 = (n) => String(n).padStart(2, '0');
const p3 = (n) => String(n).padStart(3, '0');

// Milliseconds, not seconds: an apply and the safety backup a revert takes can land in the same second, and a
// shared folder name means the second backup overwrites the first — destroying the only copy of what the user
// was trying to get back to. Fixed width throughout, so sorting these names is sorting by time.
function timestamp(d) {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}`
    + `${p2(d.getSeconds())}_${p3(d.getMilliseconds())}`;
}

// Local time with its offset, as chrono's to_rfc3339 wrote it in the manifest.
function rfc3339Local(d) {
  const off = -d.getTimezoneOffset();
  const abs = Math.abs(off);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:`
    + `${p2(d.getSeconds())}.${p3(d.getMilliseconds())}${off >= 0 ? '+' : '-'}${p2(Math.floor(abs / 60))}:${p2(abs % 60)}`;
}

// Where this machine keeps backups: %LOCALAPPDATA%\Racing Desk\paints\backups.
//
// The plan put them at <library>/.backups, which was right until the library became a git checkout. After that
// every apply left hundreds of megabytes of untracked files inside the user's repo, made `git status`
// permanently dirty, and — worst of all — the app's own update check then refused to pull because of files the
// app itself had written. Backups are the app's data, so the app keeps them.
function backupsBase({ env = process.env } = {}) {
  const has = (k) => typeof env[k] === 'string' && env[k].length > 0;
  let base = null;
  if (has('LOCALAPPDATA')) base = env.LOCALAPPDATA;
  else if (has('APPDATA')) base = env.APPDATA;
  else if (has('HOME')) base = path.join(env.HOME, '.local', 'share');
  if (!base) throw other('Nowhere to store backups on this machine.');
  return path.join(base, APP_DATA_DIR, 'paints', 'backups');
}

function backupRoot(base, carFolder) {
  return path.join(base, carFolder);
}

// Create a backup directory that is certainly new. A non-recursive mkdir fails rather than succeeding silently
// when the path is taken, which is what makes this safe against a collision instead of merely unlikely to hit one.
function newBackupDir(root, now) {
  fs.mkdirSync(root, { recursive: true });
  const stamp = timestamp(now());
  for (let attempt = 0; attempt < 100; attempt++) {
    const name = attempt === 0 ? stamp : `${stamp}-${p2(attempt)}`;
    const dir = path.join(root, name);
    try {
      fs.mkdirSync(dir);
      return dir;
    } catch (e) {
      if (e && e.code === 'EEXIST') continue;
      throw e;
    }
  }
  throw other('Could not create a backup folder; 100 names in the same millisecond were taken.');
}

function describeFile(from) {
  let size = 0;
  try { size = fs.statSync(from).size; } catch (e) { size = 0; }
  let sha256 = '';
  try { sha256 = digest.fileSha256(from); } catch (e) { sha256 = ''; }
  return { size, sha256 };
}

// Copy every file this customer owns in the car's folder into a timestamped backup. Both .tga and .mip are
// taken: the cooked files are about to be deleted, and a revert that restored the source but not the cache
// would leave the sim showing the wrong texture. The car's helmet is this customer's too, and is taken with them;
// the manifest says so (`helmetsIncluded`), which is how a revert knows that a helmet the backup lacks was not
// there. `extra` goes into the manifest: `defaultHelmetBackup`, the backup of the default helmet taken for the
// same apply, so that reverting the car puts the default back as well.
function backUp(paintDir, base, carFolder, simFolder, customerId, reason, now, extra = {}) {
  const sourceDir = path.join(paintDir, simFolder);
  const dest = newBackupDir(backupRoot(base, carFolder), now);

  const files = [];
  const names = [];
  let entries = [];
  try { entries = fs.readdirSync(sourceDir); } catch (e) { entries = []; }
  for (const name of entries) {
    const parsed = parseMine(name);
    if (!parsed || parsed.id !== customerId) continue;
    const from = path.join(sourceDir, name);
    fs.copyFileSync(from, path.join(dest, name));
    files.push({ fileName: name, ...describeFile(from) });
    names.push(name);
  }

  const manifest = {
    carFolder, simFolder, customerId, created: rfc3339Local(now()), reason, files, helmetsIncluded: true, ...extra,
  };
  fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { dir: dest, names };
}

// Copy the default helmet, paint/helmet_<id>.tga, into a timestamped backup of its own before it is replaced. A
// backup that holds no file says there was none: a revert to it takes the default away again. Returns
// { id, dir, had }. A file that is there and cannot be copied throws, before anything is written.
function backUpDefault(paintDir, base, customerId, reason, now) {
  const dest = newBackupDir(backupRoot(base, DEFAULT_HELMET_FOLDER), now);
  const name = helmets.installedName(customerId);
  const from = path.join(paintDir, name);
  const files = [];
  const had = isFile(from);
  if (had) {
    fs.copyFileSync(from, path.join(dest, name));
    files.push({ fileName: name, ...describeFile(from) });
  }
  const manifest = {
    carFolder: DEFAULT_HELMET_FOLDER, simFolder: '', customerId, created: rfc3339Local(now()), reason, files, defaultHelmet: true,
  };
  fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { id: path.basename(dest), dir: dest, had };
}

// Whether `v` names a backup folder: the timestamp shape and nothing else, since it is read from a manifest and
// joined into a path.
function isBackupId(v) {
  return typeof v === 'string' && BACKUP_ID.test(v);
}

function isReadOnly(mode) {
  return (mode & 0o222) === 0;
}

// Clear the read-only flag so a write can land. Missing files are not an error. On Windows this clears exactly
// one attribute — the one that would otherwise make the copy fail — and leaves the ACL alone.
function clearReadOnly(p) {
  let st;
  try { st = fs.statSync(p); } catch (e) { return false; }
  if (!isReadOnly(st.mode)) return false;
  fs.chmodSync(p, (st.mode & 0o777) | 0o222);
  return true;
}

// Read-only defeats Trading Paints overwriting your car: the downloader's copy fails against the attribute, so
// what this app installed stays. The cost is having to clear it again next time, which every apply does first.
function setReadOnly(p) {
  const st = fs.statSync(p);
  fs.chmodSync(p, (st.mode & 0o777) & ~0o222);
}

function withExtension(p, ext) {
  const dir = path.dirname(p);
  const stem = path.basename(p, path.extname(p));
  return path.join(dir, `${stem}.${ext}`);
}

// Copy `from` into place at `to` via a temporary name, so `to` is either the old file or the new one and never
// a half-written mixture.
function installFile(from, to) {
  const tmp = withExtension(to, TMP_EXT);
  // A leftover temp from a previous crash would make the copy fail.
  try { fs.unlinkSync(tmp); } catch (e) { /* none there */ }
  fs.copyFileSync(from, tmp);
  try {
    clearReadOnly(to);
    fs.renameSync(tmp, to);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (e2) { /* best effort */ }
    throw e;
  }
}

// Take a cooked file away so the sim cooks the texture beside it again. One that is not there is nothing; one that
// will not go is said, since the sim would then keep showing what it cooked before.
function dropCooked(p, warnings) {
  if (!isFile(p)) return false;
  try { clearReadOnly(p); } catch (e) { /* the delete below reports it */ }
  try {
    fs.unlinkSync(p);
    return true;
  } catch (e) {
    warnings.push(`Could not delete cooked file ${path.basename(p)}: ${messageOf(e)}`);
    return false;
  }
}

// Make a helmet the default for every car without one of its own: paint/helmet_<id>.tga, with its cooked file
// dropped. Backed up first by the caller (backUpDefault). Throws when the copy fails, with nothing half written.
function installDefault(paintDir, from, customerId, warnings = []) {
  installFile(from, path.join(paintDir, helmets.installedName(customerId)));
  dropCooked(path.join(paintDir, helmets.cookedName(customerId)), warnings);
}

// Put the default helmet back as a backup of it has it: the file, or — where the backup holds none — none, since
// the apply being undone put the one there is there. Returns { restored, removed }; throws when the backup is
// not there to put back from. A cooked file that will not go is said in `warnings`.
function restoreDefault(paintDir, base, customerId, backupId, warnings = []) {
  if (!isBackupId(backupId)) throw other('The backup of the default helmet is not named as one.');
  const dir = path.join(backupRoot(base, DEFAULT_HELMET_FOLDER), backupId);
  if (!isDir(dir)) throw other(`The backup of the default helmet is no longer there (${backupId}).`);
  const name = helmets.installedName(customerId);
  const kept = path.join(dir, name);
  const dest = path.join(paintDir, name);
  if (isFile(kept)) {
    installFile(kept, dest);
    dropCooked(path.join(paintDir, helmets.cookedName(customerId)), warnings);
    return { restored: true, removed: false };
  }
  if (isFile(dest)) {
    clearReadOnly(dest);
    fs.unlinkSync(dest);
    dropCooked(path.join(paintDir, helmets.cookedName(customerId)), warnings);
    return { restored: false, removed: true };
  }
  return { restored: false, removed: false };
}

// Put back the files named in `names` from `backupDir`, best effort. Returns what could not be restored.
function restoreFrom(backupDir, targetDir, names) {
  const failures = [];
  for (const name of names) {
    const from = path.join(backupDir, name);
    let isFile = false;
    try { isFile = fs.statSync(from).isFile(); } catch (e) { isFile = false; }
    if (!isFile) continue;
    const to = path.join(targetDir, name);
    try { clearReadOnly(to); } catch (e) { /* the copy below reports it */ }
    try {
      fs.copyFileSync(from, to);
    } catch (e) {
      failures.push(`${name}: ${messageOf(e)}`);
    }
  }
  return failures;
}

// Take away the files an apply wrote that the backup did not have — a spec map or a helmet the car had none of
// before — so that a rollback leaves the folder as it was, not with what was added before the write that failed.
// Best effort, like restoreFrom; returns what could not be removed.
function removeAdded(targetDir, written, backedUp) {
  const had = new Set(backedUp.map((n) => String(n).toLowerCase()));
  const failures = [];
  for (const name of written) {
    if (had.has(String(name).toLowerCase())) continue;
    const p = path.join(targetDir, name);
    if (!isFile(p)) continue;
    try { clearReadOnly(p); } catch (e) { /* the delete below reports it */ }
    try {
      fs.unlinkSync(p);
    } catch (e) {
      failures.push(`${name}: ${messageOf(e)}`);
    }
  }
  return failures;
}

// The request as the UI sends it (src/types.ts ApplyRequest), with serde's defaults: includeSpec true, the rest
// false. Three keys are not the UI's to send, and index.js sets them whatever the page sent: createFolder, whether
// the car's folder may be made; ensureDefaultHelmet, whether this apply sees to the default helmet (a group sees
// to it once for all its cars); and defaultHelmetBackup, the backup of the default a group took before its cars,
// which each car's backup then names.
function normaliseRequest(req) {
  return {
    paintDir: String(req.paintDir),
    libraryRoot: req.libraryRoot == null ? '' : String(req.libraryRoot),
    carFolder: String(req.carFolder),
    simFolder: String(req.simFolder),
    versionId: String(req.versionId),
    customerId: req.customerId == null ? '' : String(req.customerId),
    includeSpec: req.includeSpec == null ? true : Boolean(req.includeSpec),
    setReadOnlyAfter: Boolean(req.setReadOnlyAfter),
    clearOtherCooked: Boolean(req.clearOtherCooked),
    force: Boolean(req.force),
    createFolder: Boolean(req.createFolder),
    ensureDefaultHelmet: req.ensureDefaultHelmet == null ? true : Boolean(req.ensureDefaultHelmet),
    defaultHelmetBackup: isBackupId(req.defaultHelmetBackup) ? req.defaultHelmetBackup : null,
  };
}

// Whether two files hold the same bytes; false where either cannot be read.
function sameBytes(a, b) {
  try {
    return digest.fileSha256(a) === digest.fileSha256(b);
  } catch (e) {
    return false;
  }
}

// The default helmet as the library names it, and whether it is in place: { set, source, problem, listed, inPlace }.
// `listed` is whether the library keeps a helmet list at all; `inPlace` whether paint/helmet_<id>.tga is that set,
// byte for byte — a default that is missing, or is another set, is not.
function defaultHelmet(paintDir, libraryRoot, customerId, manifest = helmets.readManifest(libraryRoot)) {
  const found = helmets.resolveDefault(libraryRoot, manifest);
  const inPlace = found.source !== null && sameBytes(path.join(paintDir, helmets.installedName(customerId)), found.source.path);
  return { ...found, listed: manifest.found, inPlace };
}

// What is said of the default helmet, in a sentence: `fallback` is defaultHelmet()'s answer, `put` whether it was
// written just now, `failure` why it could not be, `kept` whether a default that was there was backed up first — said,
// so that it is known to be kept and can be put back (listDefaultBackups, revertDefault). Nothing where the library
// keeps no helmets: that is said of the car already, and there is no default to see to.
function defaultSaid(fallback, put, failure, kept = false) {
  if (put) {
    return `The ${fallback.set} helmet is now the default for every car without a helmet of its own.`
      + (kept ? ' The default helmet that was there is kept, and can be put back.' : '');
  }
  if (failure) return `The ${fallback.set} helmet could not be made the default (${failure}), so the default helmet is as it was.`;
  if (fallback.inPlace) return `The ${fallback.set} helmet is the default for every car without a helmet of its own, as before.`;
  if (!fallback.listed) return '';
  if (!fallback.set) return 'The library names no default helmet, so the default helmet was left as it was.';
  return `${fallback.problem} The default helmet was left as it was.`;
}

// See to the default helmet: put the set the library names in place where it is missing or is another, with
// its cooked file dropped. Backed up first by the caller (backUpDefault), where it is to be written. Returns
// { put, said }; a default that cannot be written is said, in `warnings` too, and never thrown, since the car — or
// the group — is done whatever happens here. `kept` is whether the backup the caller took held a default.
function writeDefault(paintDir, customerId, fallback, warnings, kept = false) {
  if (!fallback.source || fallback.inPlace) return { put: false, said: defaultSaid(fallback, false, null) };
  try {
    installDefault(paintDir, fallback.source.path, customerId, warnings);
    return { put: true, said: defaultSaid(fallback, true, null, kept) };
  } catch (e) {
    const failure = messageOf(e);
    warnings.push(`The ${fallback.set} helmet could not be made the default (${failure}). The default helmet is as it was.`);
    return { put: false, said: defaultSaid(fallback, false, failure) };
  }
}

// What became of the helmet in an apply, for the page: { set, onCar, defaultSet, defaultPut, said }. `said` is
// plain sentences: the car's helmet, then the default where this apply saw to it (`done`, writeDefault's answer)
// and there is something to say — put in place, or left as it was for a reason. A default in place as before is
// not said again after every apply.
function helmetOutcome(helmet, fallback, done) {
  const onCar = helmet.source !== null;
  const parts = [onCar ? `The ${helmet.set} helmet is on the car.` : helmet.said];
  if (done && !onCar && helmet.set !== null && helmet.set === fallback.set && !fallback.source) {
    // The version's set is the default set, and the one thing wrong with it is said once for both.
    parts.splice(0, 1, `${fallback.problem} The car's helmet and the default helmet were left as they were.`);
  } else if (done && done.said && (done.put || !fallback.inPlace)) {
    parts.push(done.said);
  }
  return {
    set: helmet.set,
    onCar,
    defaultSet: fallback ? fallback.set : null,
    defaultPut: !!(done && done.put),
    said: parts.join(' '),
  };
}

// Apply a version to the sim's folder.
async function apply(req, version, base, deps) {
  const d = withDefaults(deps);
  const request = normaliseRequest(req);
  const paintDir = request.paintDir;
  const targetDir = path.join(paintDir, request.simFolder);

  if (!customer.isValid(request.customerId)) {
    throw refused('The customer id must be digits only. Nothing was changed.');
  }

  // A car never driven has no folder yet. The sim would make one the first time the car is driven; making it now,
  // under the install's name for the car, is what has the paint there when that happens.
  const pre = await preflightAll(d);
  const make = !isDir(targetDir) && request.createFolder;
  if (!isDir(targetDir) && !make) pre.blockers.push(noFolder(request.simFolder));
  if (pre.blockers.length && !request.force) throw refused(pre.blockers.join(' '));

  const toInstall = version.files.filter((f) => request.includeSpec || f.role !== 'car_spec');
  if (!toInstall.length) throw refused('This version has no textures to install. Nothing was changed.');
  if (!toInstall.some((f) => f.role === 'car')) throw refused('This version has no car paint. Nothing was changed.');

  // The helmet that comes with the version, from the library as it is now; none leaves the car's helmet alone. And
  // the default helmet, where this apply sees to it (a group sees to it once for all its cars): the set the
  // library names, put in place when it is missing or is another — never this version's set.
  const manifest = helmets.readManifest(request.libraryRoot);
  const helmet = helmets.resolve(request.libraryRoot, request.carFolder, request.versionId, manifest);
  const fallback = request.ensureDefaultHelmet ? defaultHelmet(paintDir, request.libraryRoot, request.customerId, manifest) : null;
  const putDefault = fallback !== null && fallback.source !== null && !fallback.inPlace;

  const actions = [];
  const warnings = [...pre.warnings];
  if (pre.blockers.length) warnings.push(...pre.blockers.map((b) => `Applied anyway, over a warning: ${b}`));
  if (make) {
    fs.mkdirSync(targetDir, { recursive: true });
    actions.push({ kind: 'folder', detail: `${request.simFolder} folder made in the paint directory` });
  }

  // 1. Back up before anything is touched: the default helmet, where this apply will replace it, then the car's
  // files, whose backup names the default's so that one revert puts both back.
  let defaultBackup = request.defaultHelmetBackup;
  let defaultKept = false;
  if (putDefault && defaultBackup === null) {
    const taken = backUpDefault(paintDir, base, request.customerId, `apply ${request.versionId} to ${request.carFolder}`, d.now);
    defaultBackup = taken.id;
    defaultKept = taken.had;
  }
  const { dir: backupDir, names: backedUp } = backUp(
    paintDir, base, request.carFolder, request.simFolder, request.customerId, `apply ${request.versionId}`, d.now,
    { defaultHelmetBackup: defaultBackup },
  );
  actions.push({
    kind: 'backup',
    detail: `${backedUp.length} file${backedUp.length === 1 ? '' : 's'} backed up to ${backupDir}`,
  });

  // 2. Install each texture, and the helmet after them, rolling back everything if one fails.
  const toWrite = toInstall.map((file) => {
    const destName = roles.installedName(file.role, request.customerId, roles.TEXTURE_EXT);
    return { from: file.path, destName, kind: 'install', detail: `${file.fileName} -> ${destName}` };
  });
  if (helmet.source) {
    const destName = helmets.installedName(request.customerId);
    // Said without the file's name, as everything the helmet code says of a helmet is: no id is in it.
    toWrite.push({ from: helmet.source.path, destName, kind: 'helmet', detail: `the ${helmet.set} helmet put on the car` });
  }
  const written = [];
  for (const file of toWrite) {
    const { destName } = file;
    const dest = path.join(targetDir, destName);
    try {
      installFile(file.from, dest);
      actions.push({ kind: file.kind, detail: file.detail });
      written.push(destName);
    } catch (e) {
      const failures = [...restoreFrom(backupDir, targetDir, backedUp), ...removeAdded(targetDir, written, backedUp)];
      digest.forgetUnder(targetDir);
      let msg = `Could not write ${destName} (${messageOf(e)}). Everything this apply had changed was put back `
        + `from ${backupDir}.`;
      if (failures.length) {
        msg += ` Some files could not be restored automatically: ${failures.join(', ')}. The backup is still on disk.`;
      }
      throw refused(msg);
    }
  }

  // 3. Clear the cooked cache, or the sim keeps serving the old texture. The helmet's cooked file, where the sim
  // has left one, goes with the car's.
  let cleared = 0;
  let leftAlone = 0;
  let entries = [];
  try { entries = fs.readdirSync(targetDir); } catch (e) { entries = []; }
  for (const name of entries) {
    const parsed = parseMine(name);
    if (!parsed || parsed.ext !== roles.COOKED_EXT) continue;
    const mine = parsed.id === request.customerId;
    if (!mine && !request.clearOtherCooked) {
      leftAlone += 1;
      continue;
    }
    const p = path.join(targetDir, name);
    try { clearReadOnly(p); } catch (e) { /* the delete below reports it */ }
    try {
      fs.unlinkSync(p);
      cleared += 1;
    } catch (e) {
      warnings.push(`Could not delete cooked file ${name}: ${messageOf(e)}`);
    }
  }
  actions.push({
    kind: 'cooked',
    detail: `${cleared} cooked .mip file${cleared === 1 ? '' : 's'} deleted so the sim re-cooks`,
  });
  if (leftAlone > 0) {
    actions.push({ kind: 'cooked-kept', detail: `${leftAlone} cooked file(s) belonging to other drivers left alone` });
  }

  // 4. Optionally lock the result against Trading Paints.
  if (request.setReadOnlyAfter) {
    for (const name of written) {
      try {
        setReadOnly(path.join(targetDir, name));
      } catch (e) {
        warnings.push(`Could not set ${name} read-only: ${messageOf(e)}`);
      }
    }
    actions.push({ kind: 'read-only', detail: `${written.length} installed file(s) set read-only` });
  }

  if (!request.includeSpec && version.hasSpec) {
    warnings.push('The spec map was not installed. Any spec map already in the folder is still there and will be '
      + 'used with this paint.');
  }
  // A version with no spec map of its own leaves the one in the folder where it is: an apply takes nothing away
  // but cooked files. The paint is then worn over another paint's gloss, which has to be said.
  const specName = roles.installedName('car_spec', request.customerId, roles.TEXTURE_EXT).toLowerCase();
  if (request.includeSpec && !version.hasSpec && backedUp.some((n) => String(n).toLowerCase() === specName)) {
    warnings.push('This version has no spec map. The spec map already in the folder is still there and will be '
      + 'used with this paint.');
  }

  // 5. The default helmet is the set the library names as its default: put in place where it is missing or is
  // another, for every car without a helmet of its own — never this version's set, and no other car's helmet is
  // touched. Left to the group where one is setting its cars. The car is done whatever happens here, so a default
  // that cannot be written is said, not thrown.
  let done = null;
  if (fallback !== null) {
    done = writeDefault(paintDir, request.customerId, fallback, warnings, defaultKept);
    if (done.put) actions.push({ kind: 'helmet-default', detail: `the ${fallback.set} helmet put in place as the default, for every car without a helmet of its own` });
  }

  digest.forgetUnder(targetDir);
  return {
    applied: true,
    backupDir,
    actions,
    warnings,
    helmet: helmetOutcome(helmet, fallback, done),
  };
}

// See to the default helmet on its own, with no car: the page asks after a library update that changed which set the
// manifest names as the default. `req` is { paintDir, libraryRoot, customerId, was }. `was` is the default the list
// named before the update — a set's name, null for none — and where it is given and is still the default nothing
// has changed, so nothing is done: a default that differs for any other reason is not this update's to replace
// (the next apply sees to that). Where `was` is not given, the default is seen to whatever it was. The set the
// library names is put in place where it is missing or is another, backed up first (DEFAULT_HELMET_FOLDER), under
// the same guard an apply has: with the sim running nothing is written, and the next apply sees to it. Returns
// { set, put, said, backupDir, warnings }, `said` empty where there is nothing to say — the library keeps no
// helmets, the default did not change, or it is in place as before.
async function ensureDefault(req, base, deps) {
  const d = withDefaults(deps);
  const paintDir = String(req.paintDir);
  const libraryRoot = req.libraryRoot == null ? '' : String(req.libraryRoot);
  const customerId = req.customerId == null ? '' : String(req.customerId);
  if (!customer.isValid(customerId)) throw refused('The customer id must be digits only. Nothing was changed.');
  const was = typeof req.was === 'string' || req.was === null ? req.was : undefined;
  const warnings = [];
  const fallback = defaultHelmet(paintDir, libraryRoot, customerId);
  const quiet = { set: fallback.set, put: false, said: '', backupDir: null, warnings };
  if (!fallback.listed || fallback.inPlace) return quiet;
  if (was !== undefined && was === fallback.set) return quiet;
  if (!fallback.source) return { ...quiet, said: defaultSaid(fallback, false, null) };
  // What is said is of what is so: the default is now this set only where the update changed it.
  const lead = `The library's default helmet is ${was === undefined ? '' : 'now '}the ${fallback.set} helmet`;
  if (!isDir(paintDir)) {
    return { ...quiet, said: `${lead}; the next apply puts it in place, since there is no paint folder yet.` };
  }
  const pre = await preflightAll(d);
  if (pre.blockers.length) {
    return { ...quiet, said: `${lead}; the next apply puts it in place, since ${inTheWay(pre)} right now.` };
  }
  const backup = backUpDefault(paintDir, base, customerId, 'library update', d.now);
  const done = writeDefault(paintDir, customerId, fallback, warnings, backup.had);
  return { set: fallback.set, put: done.put, said: done.said, backupDir: backup.dir, warnings };
}

// A manifest with the strictness serde had: every field present and of the right type, or it does not count.
function readManifest(dir) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
    for (const k of ['carFolder', 'simFolder', 'customerId', 'created', 'reason']) {
      if (typeof m[k] !== 'string') return null;
    }
    if (!Array.isArray(m.files)) return null;
    for (const f of m.files) {
      if (!f || typeof f.fileName !== 'string' || typeof f.size !== 'number' || typeof f.sha256 !== 'string') return null;
    }
    return m;
  } catch (e) {
    return null;
  }
}

// Backups for one car, newest first.
function listBackups(base, carFolder) {
  const root = backupRoot(base, carFolder);
  if (!isDir(root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const id = entry.name;
    const p = path.join(root, id);
    const manifest = readManifest(p);
    out.push(manifest
      ? { id, path: p, created: manifest.created, reason: manifest.reason, fileCount: manifest.files.length }
      : { id, path: p, created: id, reason: 'unknown', fileCount: 0 });
  }
  // Folder names are timestamps, so this is newest-first.
  out.sort((a, b) => cmp(b.id, a.id));
  return out;
}

// Put a backup back. Files the backup does not contain but that belong to this customer were added by the
// apply being undone, so they are removed — after being backed up themselves, which makes a revert undoable in
// its own right.
async function revert(paintDir, base, carFolder, simFolder, customerId, backupId, force, deps) {
  const d = withDefaults(deps);
  const backups = listBackups(base, carFolder);
  const chosen = backupId != null ? backups.find((b) => b.id === backupId) : backups[0];
  if (!chosen) throw refused('There is no backup to go back to for this car.');

  const pre = await preflight(paintDir, simFolder, d);
  if (pre.blockers.length && !force) throw refused(pre.blockers.join(' '));

  const backupDir = chosen.path;
  const targetDir = path.join(paintDir, simFolder);
  const actions = [];
  const warnings = [...pre.warnings];

  // What the backup says of helmets: whether the helmet was taken with the car's files (a backup from before the
  // app kept helmets says nothing of one, and one it lacks is left alone), and which backup of the default
  // helmet the same apply took.
  const manifest = readManifest(backupDir);
  const helmetsIncluded = !!(manifest && manifest.helmetsIncluded === true);
  const defaultBackupId = manifest && isBackupId(manifest.defaultHelmetBackup) ? manifest.defaultHelmetBackup : null;

  // Reverting overwrites the current state, so take a backup of that first — of the default helmet too, where it
  // is about to be put back, so that a revert is itself undoable whole.
  const safetyDefault = defaultBackupId !== null
    ? backUpDefault(paintDir, base, customerId, `before revert to ${chosen.id}`, d.now).id
    : null;
  const { dir: safetyDir } = backUp(
    paintDir, base, carFolder, simFolder, customerId, `before revert to ${chosen.id}`, d.now, { defaultHelmetBackup: safetyDefault },
  );
  actions.push({ kind: 'backup', detail: `current files backed up to ${safetyDir} first` });

  const restored = [];
  let helmetRestored = false;
  for (const name of fs.readdirSync(backupDir)) {
    const parsed = parseMine(name);
    if (!parsed) continue;   // manifest.json and anything else that is not a texture
    const dest = path.join(targetDir, name);
    try {
      installFile(path.join(backupDir, name), dest);
      // A helmet is said without its file's name, as an apply says it.
      actions.push({ kind: 'restore', detail: parsed.role === 'helmet' ? (parsed.ext === roles.TEXTURE_EXT ? "the car's helmet" : "the car's cooked helmet") : name });
      restored.push(name.toLowerCase());
      if (parsed.role === 'helmet' && parsed.ext === roles.TEXTURE_EXT) helmetRestored = true;
    } catch (e) {
      warnings.push(`Could not restore ${name}: ${messageOf(e)}`);
    }
  }

  // Remove this customer's files that the backup did not have. Names are compared case-insensitively, as the
  // filesystem does: a restored file must never be counted as an addition and deleted again. A helmet counts only
  // where the backup speaks for helmets.
  let removed = 0;
  let helmetRemoved = false;
  let entries = [];
  try { entries = fs.readdirSync(targetDir); } catch (e) { entries = []; }
  for (const name of entries) {
    const parsed = helmetsIncluded ? parseMine(name) : roles.parseInstalled(name);
    if (!parsed || parsed.id !== customerId || restored.includes(name.toLowerCase())) continue;
    const p = path.join(targetDir, name);
    try { clearReadOnly(p); } catch (e) { /* the delete below reports it */ }
    try {
      fs.unlinkSync(p);
      removed += 1;
      if (parsed.role === 'helmet' && parsed.ext === roles.TEXTURE_EXT) helmetRemoved = true;
    } catch (e) {
      warnings.push(`Could not remove ${name}: ${messageOf(e)}`);
    }
  }
  if (removed > 0) actions.push({ kind: 'remove', detail: `${removed} file(s) added since that backup were removed` });

  // The default helmet, as it was before the apply this backup was taken for.
  let defaultPut = null;
  if (defaultBackupId !== null) {
    try {
      const r = restoreDefault(paintDir, base, customerId, defaultBackupId, warnings);
      defaultPut = r.restored ? 'restored' : r.removed ? 'removed' : 'none';
      actions.push({
        kind: 'helmet-default',
        detail: r.restored ? 'the default helmet was put back as it was'
          : r.removed ? 'the default helmet that apply set was taken away: there was none before it'
            : 'there was no default helmet before that apply, and there is none now',
      });
    } catch (e) {
      warnings.push(`The default helmet could not be put back: ${messageOf(e)}`);
    }
  }

  const parts = [];
  if (helmetRestored) parts.push("The car's helmet is as it was before that apply");
  else if (helmetRemoved) parts.push('The helmet that apply put on the car was taken off');
  if (defaultPut === 'restored') parts.push('the default helmet is as it was before it');
  else if (defaultPut === 'removed') parts.push('the default helmet it set was taken away');
  const said = parts.length ? `${parts.join(', and ')}.`.replace(/^the default/, 'The default') : '';

  digest.forgetUnder(targetDir);
  return {
    applied: true,
    backupDir: chosen.path,
    actions,
    warnings,
    helmet: { set: null, onCar: helmetRestored, defaultSet: null, defaultPut: defaultPut === 'restored', said },
  };
}

// The backups of the default helmet, newest first: { id, path, created, reason, had }. `had` is whether the default
// was a file when the backup was taken — a backup that holds none says there was none, and putting it back takes the
// default away. With `customerId` only that customer's are listed: a backup of another's would put back a file the
// app names for someone else. These are no car's backups; the cars' own name one where they were taken with it, and
// this is how every one of them is reached from the page, whichever apply, group or update took it.
function listDefaultBackups(base, customerId = null) {
  const root = backupRoot(base, DEFAULT_HELMET_FOLDER);
  if (!isDir(root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !isBackupId(entry.name)) continue;
    const p = path.join(root, entry.name);
    const manifest = readManifest(p);
    if (customerId !== null && (!manifest || manifest.customerId !== customerId)) continue;
    if (manifest && manifest.defaultHelmet === true) {
      out.push({ id: entry.name, path: p, created: manifest.created, reason: manifest.reason, had: manifest.files.length > 0 });
    } else {
      const kept = customerId !== null && isFile(path.join(p, helmets.installedName(String(customerId))));
      out.push({ id: entry.name, path: p, created: entry.name, reason: 'unknown', had: kept });
    }
  }
  out.sort((a, b) => cmp(b.id, a.id));
  return out;
}

// Put the default helmet back as one of its backups has it, from the page: the file, or — where the backup holds
// none — none. `req` is { paintDir, libraryRoot, customerId, backupId }; `libraryRoot` only so that what happens
// next can be said truthfully. The default as it stands is backed up first, so this is undoable like a revert is,
// and the same guard holds: with the sim running nothing is touched. Returns { restored, said, backupDir, warnings },
// `restored` being 'restored', 'removed' or 'none'.
async function revertDefault(req, base, deps) {
  const d = withDefaults(deps);
  const paintDir = String(req.paintDir);
  const libraryRoot = req.libraryRoot == null ? '' : String(req.libraryRoot);
  const customerId = req.customerId == null ? '' : String(req.customerId);
  if (!customer.isValid(customerId)) throw refused('The customer id must be digits only. Nothing was changed.');
  if (!isBackupId(req.backupId)) throw refused('That is not a backup of the default helmet. Nothing was changed.');
  const chosen = listDefaultBackups(base, customerId).find((b) => b.id === req.backupId);
  if (!chosen) throw refused('That backup of the default helmet is no longer there. Nothing was changed.');
  if (!isDir(paintDir)) throw refused('There is no paint folder to put the default helmet into. Nothing was changed.');

  const pre = await preflightAll(d);
  if (pre.blockers.length) throw refused(pre.blockers.join(' '));
  const warnings = [...pre.warnings];

  const safety = backUpDefault(paintDir, base, customerId, `before putting back ${chosen.id}`, d.now);
  const r = restoreDefault(paintDir, base, customerId, chosen.id, warnings);
  const restored = r.restored ? 'restored' : r.removed ? 'removed' : 'none';
  const parts = [restored === 'restored' ? 'The default helmet is back as it was.'
    : restored === 'removed' ? 'The default helmet that was put there was taken away: there was none before it.'
      : 'There was no default helmet then, and there is none now.'];
  // The library's default goes in wherever the default is another set, at the next apply: said, not left to surprise.
  const fallback = libraryRoot ? defaultHelmet(paintDir, libraryRoot, customerId) : null;
  if (fallback && fallback.source && !fallback.inPlace) {
    parts.push(`The library's default, the ${fallback.set} helmet, goes in again at the next apply.`);
  }
  return { restored, said: parts.join(' '), backupDir: safety.dir, warnings };
}

module.exports = {
  TMP_EXT, DEFAULT_HELMET_FOLDER, preflight, preflightAll, timestamp, rfc3339Local, backupsBase, backupRoot, newBackupDir,
  backUp, backUpDefault, isBackupId, clearReadOnly, setReadOnly, isReadOnly, installFile, installDefault, restoreDefault,
  restoreFrom, removeAdded, normaliseRequest, sameBytes, defaultHelmet, defaultSaid, writeDefault, helmetOutcome, apply,
  ensureDefault, inTheWay, listDefaultBackups, revertDefault, listBackups, readManifest, revert,
};
