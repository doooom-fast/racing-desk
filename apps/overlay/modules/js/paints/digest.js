// Content hashing, used to answer "is this version the one currently installed?". Ported from
// apps/paints/src-tauri/src/digest.rs.
//
// Paint files are multi-megabyte TGAs and a car can have several versions, so hashes are memoised against the
// file's size and modification time. Nothing here is security-sensitive; the hash only has to tell two paints
// apart.
//
// The library is hundreds of files and every command scans it, in the process the HUD's windows answer to. So
// what has been hashed is not hashed again: the memo can be kept in a file (keepIn) that outlives the app, and an
// apply forgets only what it wrote over (forgetUnder), not the library beside it.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CHUNK = 256 * 1024;
const FILE_VERSION = 1;
const SAVE_AFTER_MS = 2000;

let cache = new Map();
let kept = null;        // { file, timer } once keepIn has named a file

function stamp(filePath) {
  const st = fs.statSync(filePath);
  return { len: st.size, modified: st.mtimeMs };
}

// SHA-256 of a file, hex encoded, memoised on (path, size, mtime). Throws for a missing file — an absent
// texture is an error, never a hash.
function fileSha256(filePath) {
  const key = String(filePath).toLowerCase();
  const current = stamp(filePath);
  const hit = cache.get(key);
  if (hit && hit.len === current.len && hit.modified === current.modified) return hit.hex;

  const fd = fs.openSync(filePath, 'r');
  let hex;
  try {
    const hash = crypto.createHash('sha256');
    const buf = Buffer.allocUnsafe(CHUNK);
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      hash.update(n === buf.length ? buf : buf.subarray(0, n));
    }
    hex = hash.digest('hex');
  } finally {
    fs.closeSync(fd);
  }
  cache.set(key, { len: current.len, modified: current.modified, hex });
  learnt();
  return hex;
}

// Drop everything memoised, the file's copy too.
function clearCache() {
  cache = new Map();
  learnt();
}

// Drop what is memoised for the files in a folder and beneath it. Called after an apply or revert, for the folder
// it wrote into: the files there moved under us, and a stale "currently applied" badge would be actively
// misleading. A copy keeps the time of the file it was copied from, so size and time alone do not always say.
function forgetUnder(dir) {
  const under = path.resolve(String(dir)).toLowerCase() + path.sep;
  let dropped = 0;
  for (const key of [...cache.keys()]) {
    if (path.resolve(key).toLowerCase().startsWith(under)) {
      cache.delete(key);
      dropped += 1;
    }
  }
  if (dropped) learnt();
  return dropped;
}

// Keep the memo in a file from now on: what the file holds is taken in, and what is learnt is written back a
// moment later. A file that is missing or cannot be read is an empty memo, never an error.
function keepIn(file) {
  if (kept && kept.timer) clearTimeout(kept.timer);
  kept = file ? { file: String(file), timer: null } : null;
  if (!kept) return 0;
  let taken = 0;
  try {
    const raw = JSON.parse(fs.readFileSync(kept.file, 'utf8'));
    if (raw && raw.version === FILE_VERSION && Array.isArray(raw.files)) {
      for (const row of raw.files) {
        if (!Array.isArray(row) || row.length !== 4) continue;
        const [key, len, modified, hex] = row;
        if (typeof key !== 'string' || !Number.isFinite(len) || !Number.isFinite(modified)) continue;
        if (typeof hex !== 'string' || !/^[0-9a-f]{64}$/.test(hex)) continue;
        if (!cache.has(key)) cache.set(key, { len, modified, hex });
        taken += 1;
      }
    }
  } catch (e) {
    taken = 0;
  }
  return taken;
}

function learnt() {
  if (!kept || kept.timer) return;
  kept.timer = setTimeout(() => {
    kept.timer = null;
    try { save(); } catch (e) { /* a memo that cannot be kept is only slower */ }
  }, SAVE_AFTER_MS);
  if (typeof kept.timer.unref === 'function') kept.timer.unref();
}

// Write the memo to its file now, whole: under another name first, so a reader never finds half of one. Files
// that are gone are left out, which is what keeps the memo the size of the library.
function save() {
  if (!kept) return false;
  if (kept.timer) {
    clearTimeout(kept.timer);
    kept.timer = null;
  }
  const files = [];
  for (const [key, v] of cache) {
    if (fs.existsSync(key)) files.push([key, v.len, v.modified, v.hex]);
  }
  fs.mkdirSync(path.dirname(kept.file), { recursive: true });
  const partial = `${kept.file}.part`;
  fs.writeFileSync(partial, JSON.stringify({ version: FILE_VERSION, files }));
  fs.renameSync(partial, kept.file);
  return true;
}

module.exports = { fileSha256, clearCache, forgetUnder, keepIn, save };
