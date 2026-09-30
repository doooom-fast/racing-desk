// The crop behind the car badge, made off the main thread: a worker (worker_threads) that reads one paint, decodes
// it (paints/tga.js), chooses a window with artwork in it (logo-livery-picker.js) and hands back a PNG of it, then
// ends. One paint is 12 to 16 megabytes and four million pixels, and the process that owns the HUD's windows must
// not stop to look at it. logo-livery.js starts one worker per pick, and ends it when a newer car makes the pick
// unwanted (an aborted signal, `pickInWorker`), so there is never more than one at work.
//
// The paint is named in pieces — the paint folder, the car's folder, the file — and the worker itself makes sure
// the file it opens is inside the paint folder, by the path and by what the path really is (a junction elsewhere is
// refused). What goes back is the crop and a few numbers; never the path, and never the customer id, which is in
// the file's name and nowhere in the answer. What goes wrong goes back as a short reason with no path in it.
'use strict';
const fs = require('fs');
const path = require('path');
const { parentPort, workerData } = require('worker_threads');
const tga = require('./paints/tga');
const picker = require('./logo-livery-picker');

// A paint of 2048 by 2048 at 32 bits is 16 megabytes uncompressed; nothing plausible is over this.
const DEFAULT_MAX_BYTES = 70 * 1024 * 1024;
// A paint is 2048 pixels across and high. The file's size is no limit on the image it declares — a run-length
// encoded file of a few kilobytes can say 16384 by 16384, and tga.decode, which accepts that, would allocate a
// gigabyte for it — so the header is read first, and nothing wider or higher than this is decoded.
const DEFAULT_MAX_EDGE = 4096;

// The file, checked to be inside the paint folder twice over: as a path, and as what the path really is. The
// car's folder and the file's name are each one name and not a path, so the file is a car folder's own and never
// the paint folder itself or something at its top.
function paintFileIn(paintDir, carFolder, fileName) {
  if (typeof paintDir !== 'string' || !paintDir.length) return null;
  if (typeof carFolder !== 'string' || !carFolder.length || path.basename(carFolder) !== carFolder) return null;
  if (typeof fileName !== 'string' || !fileName.length || path.basename(fileName) !== fileName) return null;
  const root = path.resolve(paintDir);
  const file = path.resolve(root, carFolder, fileName);
  const rel = path.relative(root, file);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  let realRoot;
  let realFile;
  try {
    realRoot = fs.realpathSync.native(root);
    realFile = fs.realpathSync.native(file);
  } catch (e) {
    return null;   // not there, or not readable: nothing to show
  }
  const realRel = path.relative(realRoot, realFile);
  if (!realRel || realRel.startsWith('..') || path.isAbsolute(realRel)) return null;
  return realFile;
}

// The file's bytes, after its header has said the image is a plausible size: the 18 bytes are read on their own,
// and a file that declares more than `maxEdge` either way is refused before the rest is read or anything decoded.
// Every read names its own position, so nothing depends on where the handle's was left.
function readPaint(file, maxEdge) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const head = Buffer.alloc(Math.min(18, size));
    fs.readSync(fd, head, 0, head.length, 0);
    const h = tga.readHeader(head);
    // Only a header that is one the decoder takes is judged by its size; anything else is for the decoder to refuse by
    // name, before it allocates anything (a file that is not a TGA has letters where the size is).
    const takes = h.colorMapType === 0 && [2, 3, 10, 11].includes(h.imageType) && [8, 16, 24, 32].includes(h.bits);
    if (takes && (h.width > maxEdge || h.height > maxEdge)) throw new Error('the paint declares an image too large to be a paint');
    const bytes = Buffer.alloc(size);
    head.copy(bytes, 0);
    let at = head.length;
    while (at < size) {
      const n = fs.readSync(fd, bytes, at, size - at, at);
      if (n === 0) break;
      at += n;
    }
    return at === size ? bytes : bytes.subarray(0, at);
  } finally {
    fs.closeSync(fd);
  }
}

// The crop of the paint named by `job`: { png, window: { x, y, w, h }, ms } or null where there is nothing to show.
// Throws for a file that cannot be read or is not a paint; the message never carries the path.
function cropPaint(job) {
  const {
    paintDir, carFolder, fileName, size = 512, aspect = 1, seed = 1, maxBytes = DEFAULT_MAX_BYTES, maxEdge = DEFAULT_MAX_EDGE,
  } = job;
  const began = Date.now();
  const file = paintFileIn(paintDir, carFolder, fileName);
  if (!file) return null;
  const st = fs.statSync(file);
  if (!st.isFile()) return null;
  if (st.size > maxBytes) throw new Error('the paint file is too large to be a paint');
  const img = tga.decode(readPaint(file, maxEdge), { keepAlpha: true });
  const chosen = picker.chooseCrop(img, { aspect, size, random: picker.seeded(seed) });
  if (!chosen) return null;
  const png = tga.toPng(chosen.image);
  const { x, y, w, h, score, few, looked } = chosen.window;
  return { png, window: { x, y, w, h, score, among: few.length, looked }, ms: Date.now() - began };
}

// A reason with no path in it: fs errors carry the file's path in their message, and a code instead says enough.
function reasonOf(e) {
  if (e && typeof e.code === 'string' && e.code.length) return `file ${e.code}`;
  return String(e && e.message ? e.message : e).replace(/[A-Za-z]:[\\/][^\s'"]*/g, '<path>').replace(/\/[^\s'"]+/g, '<path>');
}

if (parentPort) {
  try {
    const out = cropPaint(workerData || {});
    // The PNG is copied across, not transferred: a small one sits in Node's shared buffer pool, which is not
    // transferable, and a big one is a hundred kilobytes or so, copied in less time than it took to make.
    if (!out) parentPort.postMessage({ ok: true, png: null });
    else parentPort.postMessage({ ok: true, png: out.png, window: out.window, ms: out.ms });
  } catch (e) {
    parentPort.postMessage({ ok: false, reason: reasonOf(e) });
  }
}

module.exports = { DEFAULT_MAX_BYTES, DEFAULT_MAX_EDGE, paintFileIn, readPaint, cropPaint, reasonOf };
