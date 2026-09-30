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
// and put back by the same revert — and then makes it the default, paint/helmet_<id>.tga, for every car without a
// helmet of its own: whatever the last choice was sets the helmet. The default that was there is backed up first,
// under a folder of its own (DEFAULT_HELMET_FOLDER), and the car's backup names that backup, so reverting the car
// puts the default back too. A group sets the default once, after its cars (groups.js), through the same two calls.
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
// open, the downloader about to write its own.
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
  return { blockers, warnings };
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
// the car's folder may be made; setDefaultHelmet, whether the version's helmet becomes the default (a group sets
// the default once for all its cars, after them); and defaultHelmetBackup, the backup of the default taken for a
// group, which each car's backup then names.
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
    setDefaultHelmet: req.setDefaultHelmet == null ? true : Boolean(req.setDefaultHelmet),
    defaultHelmetBackup: isBackupId(req.defaultHelmetBackup) ? req.defaultHelmetBackup : null,
  };
}

// What became of the helmet in an apply, for the page: { set, onCar, isDefault, said }, `said` a plain sentence.
function helmetOutcome(helmet, { onCar, isDefault, wantedDefault, defaultProblem }) {
  if (!onCar) return { set: helmet.set, onCar: false, isDefault: false, said: helmet.said };
  let said = `The ${helmet.set} helmet is on the car`;
  if (isDefault) said += ', and is now the default for every car without a helmet of its own.';
  else if (wantedDefault) said += `. It could not be made the default (${defaultProblem}), so the default helmet is as it was.`;
  else said += '.';
  return { set: helmet.set, onCar: true, isDefault, said };
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

  // The helmet that comes with the version, from the library as it is now; none leaves the car's helmet alone.
  const helmet = helmets.resolve(request.libraryRoot, request.carFolder, request.versionId);
  const setDefault = request.setDefaultHelmet && helmet.source !== null;

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
  if (setDefault && defaultBackup === null) {
    defaultBackup = backUpDefault(paintDir, base, request.customerId, `apply ${request.versionId} to ${request.carFolder}`, d.now).id;
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
    toWrite.push({ from: helmet.source.path, destName, kind: 'helmet', detail: `the ${helmet.set} helmet -> ${destName}` });
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

  // 5. The last choice is the default: the version's helmet becomes every other car's, unless a group is setting
  // the default once for all of its cars. The car is done whatever happens here, so a default that cannot be
  // written is said, not thrown.
  let isDefault = false;
  let defaultProblem = null;
  if (setDefault) {
    try {
      installDefault(paintDir, helmet.source.path, request.customerId, warnings);
      isDefault = true;
      actions.push({ kind: 'helmet-default', detail: `the ${helmet.set} helmet is now the default, for every car without a helmet of its own` });
    } catch (e) {
      defaultProblem = messageOf(e);
      warnings.push(`The ${helmet.set} helmet could not be made the default (${defaultProblem}). The default helmet is as it was.`);
    }
  }

  digest.forgetUnder(targetDir);
  return {
    applied: true,
    backupDir,
    actions,
    warnings,
    helmet: helmetOutcome(helmet, { onCar: helmet.source !== null, isDefault, wantedDefault: request.setDefaultHelmet, defaultProblem }),
  };
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
      actions.push({ kind: 'restore', detail: name });
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
    helmet: { set: null, onCar: helmetRestored, isDefault: defaultPut === 'restored', said },
  };
}

module.exports = {
  TMP_EXT, DEFAULT_HELMET_FOLDER, preflight, preflightAll, timestamp, rfc3339Local, backupsBase, backupRoot, newBackupDir,
  backUp, backUpDefault, isBackupId, clearReadOnly, setReadOnly, isReadOnly, installFile, installDefault, restoreDefault,
  restoreFrom, removeAdded, normaliseRequest, helmetOutcome, apply, listBackups, readManifest, revert,
};
