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
const fs = require('fs');
const path = require('path');
const customer = require('./customer');
const digest = require('./digest');
const processMod = require('./process');
const roles = require('./roles');
const tradingpaints = require('./tradingpaints');
const { refused, other, messageOf } = require('./error');

// The temporary name a texture is written to before it is renamed into place. Kept from the Tauri app so a
// leftover from a crash of either gets cleaned up.
const TMP_EXT = 'doooom-tmp';
const APP_DATA_DIR = 'Racing Desk';

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch (e) { return false; }
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

// Copy every file this customer owns in the car's folder into a timestamped backup. Both .tga and .mip are
// taken: the cooked files are about to be deleted, and a revert that restored the source but not the cache
// would leave the sim showing the wrong texture.
function backUp(paintDir, base, carFolder, simFolder, customerId, reason, now) {
  const sourceDir = path.join(paintDir, simFolder);
  const dest = newBackupDir(backupRoot(base, carFolder), now);

  const files = [];
  const names = [];
  let entries = [];
  try { entries = fs.readdirSync(sourceDir); } catch (e) { entries = []; }
  for (const name of entries) {
    const parsed = roles.parseInstalled(name);
    if (!parsed || parsed.id !== customerId) continue;
    const from = path.join(sourceDir, name);
    fs.copyFileSync(from, path.join(dest, name));
    let size = 0;
    try { size = fs.statSync(from).size; } catch (e) { size = 0; }
    let sha256 = '';
    try { sha256 = digest.fileSha256(from); } catch (e) { sha256 = ''; }
    files.push({ fileName: name, size, sha256 });
    names.push(name);
  }

  const manifest = { carFolder, simFolder, customerId, created: rfc3339Local(now()), reason, files };
  fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { dir: dest, names };
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

// The request as the UI sends it (src/types.ts ApplyRequest), with serde's defaults: includeSpec true, the rest
// false. createFolder is not the UI's to send: index.js says whether the car's folder may be made.
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

  const actions = [];
  const warnings = [...pre.warnings];
  if (pre.blockers.length) warnings.push(...pre.blockers.map((b) => `Applied anyway, over a warning: ${b}`));
  if (make) {
    fs.mkdirSync(targetDir, { recursive: true });
    actions.push({ kind: 'folder', detail: `${request.simFolder} folder made in the paint directory` });
  }

  // 1. Back up before anything is touched.
  const { dir: backupDir, names: backedUp } = backUp(
    paintDir, base, request.carFolder, request.simFolder, request.customerId, `apply ${request.versionId}`, d.now,
  );
  actions.push({
    kind: 'backup',
    detail: `${backedUp.length} file${backedUp.length === 1 ? '' : 's'} backed up to ${backupDir}`,
  });

  // 2. Install each texture, rolling back everything if one fails.
  const written = [];
  for (const file of toInstall) {
    const destName = roles.installedName(file.role, request.customerId, roles.TEXTURE_EXT);
    const dest = path.join(targetDir, destName);
    try {
      installFile(file.path, dest);
      actions.push({ kind: 'install', detail: `${file.fileName} -> ${destName}` });
      written.push(destName);
    } catch (e) {
      const failures = restoreFrom(backupDir, targetDir, backedUp);
      digest.clearCache();
      let msg = `Could not write ${destName} (${messageOf(e)}). Everything this apply had changed was put back `
        + `from ${backupDir}.`;
      if (failures.length) {
        msg += ` Some files could not be restored automatically: ${failures.join(', ')}. The backup is still on disk.`;
      }
      throw refused(msg);
    }
  }

  // 3. Clear the cooked cache, or the sim keeps serving the old texture.
  let cleared = 0;
  let leftAlone = 0;
  let entries = [];
  try { entries = fs.readdirSync(targetDir); } catch (e) { entries = []; }
  for (const name of entries) {
    const parsed = roles.parseInstalled(name);
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

  digest.clearCache();
  return { applied: true, backupDir, actions, warnings };
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

  // Reverting overwrites the current state, so take a backup of that first.
  const { dir: safetyDir } = backUp(paintDir, base, carFolder, simFolder, customerId, `before revert to ${chosen.id}`, d.now);
  actions.push({ kind: 'backup', detail: `current files backed up to ${safetyDir} first` });

  const restored = [];
  for (const name of fs.readdirSync(backupDir)) {
    if (!roles.parseInstalled(name)) continue;   // manifest.json and anything else that is not a texture
    const dest = path.join(targetDir, name);
    try {
      installFile(path.join(backupDir, name), dest);
      actions.push({ kind: 'restore', detail: name });
      restored.push(name.toLowerCase());
    } catch (e) {
      warnings.push(`Could not restore ${name}: ${messageOf(e)}`);
    }
  }

  // Remove this customer's files that the backup did not have. Names are compared case-insensitively, as the
  // filesystem does: a restored file must never be counted as an addition and deleted again.
  let removed = 0;
  let entries = [];
  try { entries = fs.readdirSync(targetDir); } catch (e) { entries = []; }
  for (const name of entries) {
    const parsed = roles.parseInstalled(name);
    if (!parsed || parsed.id !== customerId || restored.includes(name.toLowerCase())) continue;
    const p = path.join(targetDir, name);
    try { clearReadOnly(p); } catch (e) { /* the delete below reports it */ }
    try {
      fs.unlinkSync(p);
      removed += 1;
    } catch (e) {
      warnings.push(`Could not remove ${name}: ${messageOf(e)}`);
    }
  }
  if (removed > 0) actions.push({ kind: 'remove', detail: `${removed} file(s) added since that backup were removed` });

  digest.clearCache();
  return { applied: true, backupDir: chosen.path, actions, warnings };
}

module.exports = {
  TMP_EXT, preflight, preflightAll, timestamp, rfc3339Local, backupsBase, backupRoot, newBackupDir, backUp, clearReadOnly,
  setReadOnly, isReadOnly, installFile, restoreFrom, normaliseRequest, apply, listBackups, readManifest, revert,
};
