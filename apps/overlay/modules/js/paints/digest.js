// Content hashing, used to answer "is this version the one currently installed?". Ported from
// apps/paints/src-tauri/src/digest.rs.
//
// Paint files are multi-megabyte TGAs and a car can have several versions, so hashes are memoised against the
// file's size and modification time. Nothing here is security-sensitive; the hash only has to tell two paints
// apart.
const crypto = require('crypto');
const fs = require('fs');

const CHUNK = 256 * 1024;

let cache = new Map();

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
  return hex;
}

// Drop everything memoised. Called after an apply or revert, when files on disk moved under us and a stale
// "currently applied" badge would be actively misleading.
function clearCache() {
  cache = new Map();
}

module.exports = { fileSha256, clearCache };
