// The library: versions of a paint, kept outside the sim's folders. Ported from apps/paints/src-tauri/src/library.rs.
//
//   <library>/<car folder>/<version>/
//       car.tga | car_<id>.tga            paint
//       car_spec.tga | car_spec_<id>.tga  spec map, optional
//       preview*.png                      optional
//       meta.json                         optional
//
// Both filename shapes are accepted on purpose. The plan describes role-only names; the design pipeline that
// feeds this app already writes car_1159839.tga, and asking it to change would be the tail wagging the dog.
const fs = require('fs');
const path = require('path');
const digest = require('./digest');
const roles = require('./roles');
const { messageOf } = require('./error');

// The library folder older versions of the app wrote backups into. Backups now live in the app's own data
// directory — inside a git checkout they made the repo permanently dirty — but a library may still carry one,
// and it is not a car.
const LEGACY_BACKUP_DIR = '.backups';

const META_STRING_KEYS = ['name', 'created', 'notes', 'source', 'seed', 'simFolder'];

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch (e) { return false; }
}

function emptyMeta() {
  return { name: null, created: null, notes: null, source: null, seed: null, simFolder: null };
}

// Fold a folder name down to something comparable. The library uses `mx5-mx52016` while the sim uses
// `mx5 mx52016`, and neither is wrong.
function normalise(name) {
  let out = '';
  let lastSpace = false;
  for (const ch of String(name).trim()) {
    const c = (ch === '-' || ch === '_') ? ' ' : ch;
    if (/\s/.test(c)) {
      if (!lastSpace && out.length) out += ' ';
      lastSpace = true;
    } else {
      out += c.toLowerCase();
      lastSpace = false;
    }
  }
  // A trailing space can only come from trailing punctuation; drop it.
  return out.replace(/ +$/, '');
}

function subdirNames(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

// Match a library car folder to the sim's folder for that car. Returns { simFolder, inferred }, where `inferred`
// marks a loose match, so the UI can say so instead of quietly installing into a folder the user did not name.
function resolveSimFolder(libraryFolder, metaOverride, paintDir) {
  if (typeof metaOverride === 'string' && metaOverride.trim().length) {
    return { simFolder: metaOverride, inferred: false };
  }
  if (!paintDir) return { simFolder: null, inferred: false };
  let simDirs;
  try {
    simDirs = subdirNames(paintDir);
  } catch (e) {
    return { simFolder: null, inferred: false };
  }
  const exact = simDirs.find((d) => d === libraryFolder);
  if (exact !== undefined) return { simFolder: exact, inferred: false };
  const target = normalise(libraryFolder);
  const loose = simDirs.find((d) => normalise(d) === target);
  if (loose !== undefined) return { simFolder: loose, inferred: loose !== libraryFolder };
  return { simFolder: null, inferred: false };
}

// meta.json with the strictness serde had: every known field is a string or null, unknown fields are ignored,
// and anything else is a malformed file — reported, never allowed to hide the paint files next to it.
function parseMeta(text) {
  const raw = JSON.parse(text);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('expected an object at the top level');
  }
  const meta = emptyMeta();
  for (const key of META_STRING_KEYS) {
    const v = raw[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string') throw new Error(`invalid type for ${key}: expected a string`);
    meta[key] = v;
  }
  return meta;
}

function readMeta(versionDir) {
  let text;
  try {
    text = fs.readFileSync(path.join(versionDir, 'meta.json'), 'utf8');
  } catch (e) {
    return { meta: emptyMeta(), problem: null };
  }
  try {
    return { meta: parseMeta(text), problem: null };
  } catch (e) {
    // A malformed meta.json must not hide the paint files next to it.
    return { meta: emptyMeta(), problem: `meta.json could not be read (${messageOf(e)}); ignoring it.` };
  }
}

function scanVersion(dir) {
  const id = path.basename(dir);
  const { meta, problem } = readMeta(dir);
  const files = [];
  const previews = [];
  const problems = problem ? [problem] : [];

  const names = fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort(cmp);

  for (const name of names) {
    const filePath = path.join(dir, name);
    const role = roles.parseLibraryFile(name);
    if (role) {
      let size = 0;
      try { size = fs.statSync(filePath).size; } catch (e) { size = 0; }
      try {
        const sha256 = digest.fileSha256(filePath);
        files.push({ role, roleLabel: roles.roleLabel(role), fileName: name, path: filePath, size, sha256 });
      } catch (e) {
        problems.push(`${name} could not be read (${messageOf(e)}).`);
      }
    } else if (name.toLowerCase().endsWith('.png')) {
      previews.push(filePath);
    }
  }

  // Two files claiming the same role would make the install order decide the outcome.
  for (const role of roles.CAR_ROLES) {
    const n = files.filter((f) => f.role === role).length;
    if (n > 1) {
      problems.push(`${n} files in this version claim the ${roles.roleLabel(role)} role; only one can be installed.`);
    }
  }

  const hasPaint = files.some((f) => f.role === 'car');
  const hasSpec = files.some((f) => f.role === 'car_spec');
  if (!hasPaint) problems.push('No car paint (car.tga) in this version.');

  const name = meta.name && meta.name.trim().length ? meta.name : id;
  return { id, name, path: dir, files, previews, meta, hasPaint, hasSpec, problems };
}

// Walk <library>/<car>/<version>. `paintDir` (optional) lets each car be matched to the sim's own folder name.
function scan(root, paintDir) {
  const cars = [];
  const notes = [];
  const rootText = String(root);

  if (!isDir(root)) {
    notes.push(`${rootText} is not a folder.`);
    return { root: rootText, cars, notes };
  }

  // LEGACY_BACKUP_DIR is ours, and dotfolders are never cars.
  const carDirs = subdirNames(root).filter((n) => !n.startsWith('.')).sort(cmp);

  for (const folder of carDirs) {
    const carDir = path.join(root, folder);
    const versionDirs = subdirNames(carDir).sort(cmp);

    const versions = [];
    for (const v of versionDirs) {
      const versionDir = path.join(carDir, v);
      try {
        versions.push(scanVersion(versionDir));
      } catch (e) {
        notes.push(`${versionDir} could not be read (${messageOf(e)}).`);
      }
    }
    if (versions.length === 0) continue;

    // A sim-folder override on any version applies to the car.
    const withOverride = versions.find((v) => v.meta.simFolder !== null);
    const overrideName = withOverride ? withOverride.meta.simFolder : null;
    const { simFolder, inferred } = resolveSimFolder(folder, overrideName, paintDir || null);
    if (simFolder === null && paintDir) {
      notes.push(`No folder named ${folder} in the sim's paint directory. The sim creates a car's folder the first `
        + 'time you drive it.');
    }

    cars.push({ folder, simFolder, simFolderInferred: inferred, versions });
  }

  return { root: rootText, cars, notes };
}

module.exports = { LEGACY_BACKUP_DIR, normalise, resolveSimFolder, parseMeta, readMeta, scanVersion, scan, emptyMeta };
