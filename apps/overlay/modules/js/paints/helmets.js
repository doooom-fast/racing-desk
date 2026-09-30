// Helmets come with the livery. The driver's words: "we pick a livery for a car or a fleet, and the helmet comes
// along with it so whatever my last choice was sets the helmet. it's not a single thing on its own."
//
// The library keeps them in one folder the design pipeline writes, at the top of the checkout:
//
//   <checkout>/helmets/manifest.json         { customer_id, default, sets: { <set>: { file, body, art } },
//                                              variants: { "<car folder>/<version>": "<set>" } }
//   <checkout>/helmets/<set>/helmet_<id>.tga  one 24-bit TGA per set, up to 2048²
//
// The library the app is given is the checkout itself or, as it usually is, the checkout's cars/ folder — so the
// helmets are looked for in the library's own folder first, and then beside it, in the folder the library is in.
// Each set's `file` is relative to the folder that holds helmets/, which is where the pipeline wrote it from.
//
// The sim reads paint/<car folder>/helmet_<id>.tga as that car's helmet, and paint/helmet_<id>.tga as the default
// for every car without one of its own; the same two rules for suit_<id>.tga, which nothing here touches since
// the manifest names none. <id> is the customer id — the app's own, whatever id the library's file names carry.
//
// This module reads the library and says what would go where. It writes nothing: the copying, the backups and the
// undo are apply.js's, so a helmet is backed up, written and put back exactly as the car's paint is.
//
// What is trusted, and what is not. The manifest is a file written by hand or by a script, so nothing in it is
// taken as a path to write to: a set's `file` is read only when it names a file under helmets/ — no `..`, no drive,
// no absolute path, and the file itself (links followed) inside that folder — and only a TGA of a plausible size
// and shape is used. Where a set names anything else it is dropped, with a note, and the car's helmet is left as it
// is. The destination is always the sim folder the car's paint goes to, or the paint root for the default.
const fs = require('fs');
const path = require('path');
const tga = require('./tga');
const { messageOf } = require('./error');

// The one folder of the library helmets are read from.
const FOLDER = 'helmets';
const MANIFEST = 'manifest.json';

// A helmet is a 24-bit TGA of up to 2048², which is 12 MiB and a header; nothing larger than 16 MiB is read.
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_EDGE = 2048;

// What a hand-written manifest is allowed to be: enough for a fleet, not enough to turn a scan into a crawl.
const MAX_SETS = 100;
const MAX_VARIANTS = 5000;
const MAX_NAME = 80;
const MAX_FILE = 300;

const DIGITS = /^[0-9]+$/;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// A set's name, as it is shown on a card and said in a sentence: text, trimmed, of a length that fits.
function setName(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 && t.length <= MAX_NAME && !/[\u0000-\u001f]/.test(t) ? t : null;
}

// A colour as the manifest writes it, [r, g, b] of whole numbers 0–255; null for anything else. The colours are
// for the swatch on the card and nothing more, so a bad one loses the swatch, not the helmet.
function colour(v) {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const out = v.map((n) => (Number.isInteger(n) && n >= 0 && n <= 255 ? n : null));
  return out.includes(null) ? null : out;
}

// A set's file as a path relative to the folder that holds helmets/, or null: it has to be under helmets/, made of
// plain folder and file names, and be a .tga. `helmets\shatter\helmet_1.tga` and `helmets/shatter/helmet_1.tga` are
// both taken.
function fileUnderHelmets(file) {
  if (typeof file !== 'string' || !file.length || file.length > MAX_FILE) return null;
  const parts = file.split(/[\\/]+/);
  if (parts.length < 2 || parts[0].toLowerCase() !== FOLDER) return null;
  for (const part of parts) {
    if (part === '' || part === '.' || part === '..' || /^[a-z]:$/i.test(part) || /[\u0000-\u001f]/.test(part)) return null;
  }
  if (!/\.tga$/i.test(parts[parts.length - 1])) return null;
  return parts.join(path.sep);
}

function none(reason, notes = []) {
  return { found: false, reason, default: null, sets: {}, refused: {}, variants: {}, notes };
}

// The folders a library's helmets/ may be in: the library's own, else the one it is in — the checkout, when the
// library is the checkout's cars/ folder.
function holders(root) {
  const here = path.resolve(root);
  const up = path.dirname(here);
  return up === here ? [here] : [here, up];
}

// The library's helmets, as far as they can be trusted: { found, reason, default, sets, refused, variants, notes,
// base }.
//
//   base      the folder that holds helmets/ — the library itself or the folder it is in; what each set's file is
//             relative to (only where found)
//   sets      { <name>: { file (relative to base, under helmets/), body, art } } — only sets whose file is one that
//             may be read
//   refused   { <name>: <why, in a sentence> } — the sets whose file names something outside helmets/, kept by
//             name so that a version which comes with one can say why its helmet was left alone
//   variants  { "<car folder>/<version>": <set name> } — only variants naming a set that was kept or refused
//   default   the manifest's default set, when it was kept, else null
//   reason    why nothing was found: no-library, no-manifest, unreadable, malformed
//
// The manifest's customer_id is not read: the app names every file it writes with its own id.
function readManifest(libraryRoot) {
  const root = typeof libraryRoot === 'string' && libraryRoot.trim().length ? libraryRoot : null;
  if (!root) return none('no-library');
  let text = null;
  let base = null;
  for (const holder of holders(root)) {
    try {
      text = fs.readFileSync(path.join(holder, FOLDER, MANIFEST), 'utf8');
      base = holder;
      break;
    } catch (e) {
      if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) continue;
      return none('unreadable', [`The helmet list could not be read (${messageOf(e)}).`]);
    }
  }
  if (base === null) return none('no-manifest');
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return none('malformed', [`The helmet list could not be read (${messageOf(e)}).`]);
  }
  if (!isPlainObject(raw) || !isPlainObject(raw.sets)) {
    return none('malformed', ['The helmet list is not in the shape the app reads.']);
  }

  const notes = [];
  const sets = {};
  const refused = {};
  for (const key of Object.keys(raw.sets).slice(0, MAX_SETS)) {
    const name = setName(key);
    const entry = raw.sets[key];
    if (!name || !isPlainObject(entry)) continue;
    const file = fileUnderHelmets(entry.file);
    if (!file) {
      refused[name] = `The ${name} helmet names a file outside the library's helmets folder, so it is not used.`;
      notes.push(refused[name]);
      continue;
    }
    sets[name] = { file, body: colour(entry.body), art: colour(entry.art) };
  }

  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const variants = {};
  if (isPlainObject(raw.variants)) {
    for (const key of Object.keys(raw.variants).slice(0, MAX_VARIANTS)) {
      const name = setName(raw.variants[key]);
      if (typeof key !== 'string' || !key.length || key.length > MAX_FILE || !name) continue;
      if (!has(sets, name) && !has(refused, name)) continue;
      variants[key] = name;
    }
  }

  const fallback = setName(raw.default);
  return {
    found: true,
    reason: null,
    default: fallback && has(sets, fallback) ? fallback : null,
    sets,
    refused,
    variants,
    notes,
    base,
  };
}

// The set a version comes with, by "<car folder>/<version id>" — as written, else without regard to case, since the
// folders it names are folders on disk. Null when the manifest names none.
function setFor(manifest, carFolder, versionId) {
  if (!manifest || !manifest.found) return null;
  const key = `${carFolder}/${versionId}`;
  if (Object.prototype.hasOwnProperty.call(manifest.variants, key)) return manifest.variants[key];
  const lower = key.toLowerCase();
  for (const k of Object.keys(manifest.variants)) {
    if (k.toLowerCase() === lower) return manifest.variants[k];
  }
  return null;
}

// What a card shows of a version's helmet: { set, body, art, problem }, or null when the list names none for it.
// `problem` is null for a helmet that can be used, and else says in a sentence why the set the version comes with
// cannot — the sentence an apply says of it: a set whose file is outside helmets/ is refused when the list is read,
// and one whose file is missing or is no helmet the sim takes is found out by `usable`, which takes a set's name
// and answers that sentence or null (checker()). Without `usable` a set that was kept is taken as usable.
function pick(manifest, carFolder, versionId, usable = () => null) {
  const set = setFor(manifest, carFolder, versionId);
  if (!set) return null;
  const entry = manifest.sets[set];
  if (!entry) return { set, body: null, art: null, problem: manifest.refused[set] || null };
  return { set, body: entry.body, art: entry.art, problem: usable(set) || null };
}

// Whether each set of a manifest can be used, looked at once however many versions ask: a function from a set's
// name to null (it can) or the sentence why it cannot. For a scan, which asks once per version.
function checker(libraryRoot, manifest) {
  const seen = new Map();
  return (set) => {
    if (!seen.has(set)) seen.set(set, sourceFor(libraryRoot, manifest, set).problem || null);
    return seen.get(set);
  };
}

// Whether a file is a helmet as the sim names one: `helmet_<digits>.tga`, or its cooked `.mip`. { role, id, ext },
// or null.
function parseHelmet(fileName) {
  const m = /^helmet_([0-9]+)\.(tga|mip)$/i.exec(String(fileName));
  return m ? { role: 'helmet', id: m[1], ext: m[2].toLowerCase() } : null;
}

// The name a helmet takes once installed for a customer.
function installedName(customerId) {
  return `helmet_${customerId}.tga`;
}

function cookedName(customerId) {
  return `helmet_${customerId}.mip`;
}

// Whether `child` is inside `parent`, both as paths on disk with links followed.
function within(parent, child) {
  const rel = path.relative(parent, child);
  return rel.length > 0 && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

// The file a set would be copied from, checked: { path, size } or { problem } in words. Only a file under the
// library's helmets folder, only a 24-bit true-colour TGA of no more than 2048², and no larger than 16 MiB.
function sourceFor(libraryRoot, manifest, set) {
  const entry = manifest && manifest.found ? manifest.sets[set] : undefined;
  if (!entry) return { problem: `The ${set} helmet is not in the library's helmet list.` };
  // What the list's files are relative to is the folder it was found in, which is not always the library's own.
  const base = typeof manifest.base === 'string' && manifest.base.length ? manifest.base : String(libraryRoot);
  const folder = path.resolve(base, FOLDER);
  const file = path.resolve(base, entry.file);
  if (!within(folder, file)) return { problem: `The ${set} helmet's file is outside the library's helmets folder.` };

  let real;
  let realFolder;
  let st;
  try {
    real = fs.realpathSync(file);
    realFolder = fs.realpathSync(folder);
    st = fs.statSync(real);
  } catch (e) {
    return { problem: `The ${set} helmet's file is not in the library.` };
  }
  if (!within(realFolder, real)) return { problem: `The ${set} helmet's file is outside the library's helmets folder.` };
  if (!st.isFile()) return { problem: `The ${set} helmet's file is not a file.` };
  if (st.size > MAX_BYTES) return { problem: `The ${set} helmet's file is larger than any helmet the sim takes.` };

  const head = Buffer.alloc(18);
  let n = 0;
  let fd;
  try {
    fd = fs.openSync(real, 'r');
    n = fs.readSync(fd, head, 0, 18, 0);
  } catch (e) {
    return { problem: `The ${set} helmet's file could not be read (${messageOf(e)}).` };
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (e) { /* nothing to do */ } }
  }
  if (n < 18) return { problem: `The ${set} helmet's file is not a TGA.` };
  const h = tga.readHeader(head);
  if (h.colorMapType !== 0 || (h.imageType !== 2 && h.imageType !== 10) || h.bits !== 24) {
    return { problem: `The ${set} helmet's file is not a 24-bit true-colour TGA.` };
  }
  if (h.width < 1 || h.height < 1 || h.width > MAX_EDGE || h.height > MAX_EDGE) {
    return { problem: `The ${set} helmet is ${h.width} × ${h.height}, and the sim takes helmets up to ${MAX_EDGE} × ${MAX_EDGE}.` };
  }
  return { path: file, size: st.size };
}

// Why a car's helmet is left as it is, in a sentence, for a version that comes with no usable helmet.
function leftAlone(manifest, set, problem) {
  const alone = 'so the helmet on the car was left as it was.';
  if (!manifest || !manifest.found) {
    if (manifest && (manifest.reason === 'unreadable' || manifest.reason === 'malformed')) {
      return `The library's helmet list could not be read, ${alone}`;
    }
    return `The library keeps no helmets, ${alone}`;
  }
  if (!set) return `No helmet comes with this version, ${alone}`;
  return `${problem} The car's helmet was left as it was.`;
}

// What an apply of <carFolder>/<versionId> would do about the helmet, from the library as it is now:
//
//   { set, body, art, source: { path, size } | null, said }
//
// `source` is the file to copy, or null with `said` saying why the car's helmet is left as it is. `manifest` may be
// passed in when the caller has read it already (a group reads it once for every car).
function resolve(libraryRoot, carFolder, versionId, manifest = readManifest(libraryRoot)) {
  const set = setFor(manifest, carFolder, versionId);
  if (!set) return { set: null, body: null, art: null, source: null, said: leftAlone(manifest, null, null) };
  const entry = manifest.sets[set];
  if (!entry) {
    // A set the list was read with, and refused: the version says which, and why it is not used.
    return { set, body: null, art: null, source: null, said: leftAlone(manifest, set, manifest.refused[set]) };
  }
  const found = sourceFor(libraryRoot, manifest, set);
  if (found.problem) {
    return { set, body: entry.body, art: entry.art, source: null, said: leftAlone(manifest, set, found.problem) };
  }
  return { set, body: entry.body, art: entry.art, source: { path: found.path, size: found.size }, said: '' };
}

// The library's default set — the helmet every car without one of its own wears, paint/helmet_<id>.tga — ready
// to copy, or null with why: { set, source, problem }. It is the set the manifest names as `default` and nothing
// else: not the set a car was just given, not the set a group's cars agree on (his choice, 2026-09-30).
function resolveDefault(libraryRoot, manifest = readManifest(libraryRoot)) {
  if (!manifest.found || !manifest.default) return { set: null, source: null, problem: 'The library names no default helmet.' };
  const found = sourceFor(libraryRoot, manifest, manifest.default);
  if (found.problem) return { set: manifest.default, source: null, problem: found.problem };
  return { set: manifest.default, source: { path: found.path, size: found.size }, problem: null };
}

module.exports = {
  FOLDER, MANIFEST, MAX_BYTES, MAX_EDGE, MAX_SETS, MAX_VARIANTS, MAX_NAME, DIGITS, fileUnderHelmets, readManifest, setFor,
  pick, checker, parseHelmet, installedName, cookedName, sourceFor, leftAlone, resolve, resolveDefault,
};
