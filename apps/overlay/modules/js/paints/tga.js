// Showing the paint itself. Ported from apps/paints/src-tauri/src/tga.rs, with lib.rs's preview_image.
//
// The cards preview whatever the design pipeline exported as PNG, but a version need not have one, and a render
// is not the file that gets installed. This decodes the .tga so the app can show the actual artwork — flat, in UV
// space, but unarguably the bytes going into the sim.
//
// iRacing's own paints are uncompressed 24-bit, but a paint folder collects files from everywhere, so run-length
// encoding, 16- and 32-bit colour and greyscale are all handled. Colour-mapped TGAs are refused by name rather
// than rendered as noise. As in the Rust, the alpha channel of a 32-bit file is dropped: the preview is opaque RGB.
// The one reader that wants it — the crop behind the HUD's car badge (logo-livery-picker.js), which must not choose
// a window that is mostly transparent — asks for it with `keepAlpha`, and gets it as a channel of its own.
//
// Decoding 2048x2048 and shipping it to a 280-pixel card would waste most of the work, so the result is
// downscaled and cached as PNG against the file's size and modification time. The PNG encoder is the few dozen
// lines it takes (zlib is in Node; the chunk framing and CRC are here) so the app needs no image dependency.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { other } = require('./error');

// A paint is 12MB; something an order of magnitude larger is not a car texture.
const MAX_SOURCE_BYTES = 192 * 1024 * 1024;
// Beyond this a TGA is not plausible and the allocation should not be attempted.
const MAX_PIXELS = 16384 * 16384;
// Keep the cache bounded — a big library could otherwise hold every paint in memory.
const MAX_CACHE_ENTRIES = 48;
// Previews are inlined as data URLs rather than served from disk, because the library lives wherever the user
// keeps it. PNG/JPEG/WebP files above this are refused rather than shipped whole.
const MAX_PREVIEW_BYTES = 12 * 1024 * 1024;
const DEFAULT_MAX_EDGE = 640;

function readHeader(b) {
  if (b.length < 18) throw other('Not a TGA: the file is too short.');
  return {
    idLen: b[0],
    colorMapType: b[1],
    imageType: b[2],
    colorMapLen: b[5] | (b[6] << 8),
    colorMapEntryBits: b[7],
    width: b[12] | (b[13] << 8),
    height: b[14] | (b[15] << 8),
    bits: b[16],
    descriptor: b[17],
  };
}

// Turn one source pixel at `src[off]` into RGB at `out[o]`. TGA stores colour as BGR(A).
function pixelToRgb(src, off, bits, out, o) {
  switch (bits) {
    case 32:
    case 24:
      out[o] = src[off + 2];
      out[o + 1] = src[off + 1];
      out[o + 2] = src[off];
      break;
    case 16: {
      // ARRRRRGG GGGBBBBB, five bits a channel, widened so white stays white.
      const v = src[off] | (src[off + 1] << 8);
      const r = (v >> 10) & 0x1f;
      const g = (v >> 5) & 0x1f;
      const bl = v & 0x1f;
      out[o] = (r << 3) | (r >> 2);
      out[o + 1] = (g << 3) | (g >> 2);
      out[o + 2] = (bl << 3) | (bl >> 2);
      break;
    }
    default:
      // Greyscale.
      out[o] = src[off];
      out[o + 1] = src[off];
      out[o + 2] = src[off];
  }
}

// Decode a TGA into { width, height, rgb }: tightly packed RGB, top row first. With `keepAlpha`, a 32-bit file's
// alpha comes too, as `alpha` (one byte a pixel, the same order); any other depth has no alpha and gives none.
function decode(bytes, { keepAlpha = false } = {}) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const h = readHeader(b);

  if (h.colorMapType !== 0 || h.imageType === 1 || h.imageType === 9) {
    throw other('This TGA uses a colour map, which iRacing paints do not. Re-export it as 24- or 32-bit true colour.');
  }
  let rle;
  switch (h.imageType) {
    case 2: case 3: rle = false; break;
    case 10: case 11: rle = true; break;
    case 0: throw other('This TGA holds no image data.');
    default: throw other(`Unsupported TGA image type ${h.imageType}.`);
  }
  let bpp;
  switch (h.bits) {
    case 32: bpp = 4; break;
    case 24: bpp = 3; break;
    case 16: bpp = 2; break;
    case 8: bpp = 1; break;
    default: throw other(`Unsupported TGA colour depth: ${h.bits} bits.`);
  }
  if (h.width === 0 || h.height === 0) throw other('This TGA has no size.');
  const pixels = h.width * h.height;
  if (pixels > MAX_PIXELS) throw other('This TGA is implausibly large.');

  // Skip the image id and any colour map table before the pixels start.
  const mapBytes = h.colorMapLen * Math.ceil(h.colorMapEntryBits / 8);
  const start = 18 + h.idLen + mapBytes;
  if (start > b.length) throw other('This TGA ends before its image data.');
  const data = b.subarray(start);

  const rgb = Buffer.alloc(pixels * 3);
  const alpha = keepAlpha && h.bits === 32 ? Buffer.alloc(pixels) : null;

  if (rle) {
    let src = 0;
    let done = 0;
    const one = [0, 0, 0];
    while (done < pixels) {
      if (src >= data.length) throw other('This TGA ends mid-way through its image.');
      const packet = data[src++];
      const count = (packet & 0x7f) + 1;
      if (done + count > pixels) throw other('This TGA claims more pixels than it has.');
      if (packet & 0x80) {
        // Run: one pixel repeated.
        if (src + bpp > data.length) throw other('This TGA ends mid-way through a run.');
        pixelToRgb(data, src, h.bits, one, 0);
        const a = alpha ? data[src + 3] : 0;
        src += bpp;
        for (let i = 0; i < count; i++) {
          const o = (done + i) * 3;
          rgb[o] = one[0];
          rgb[o + 1] = one[1];
          rgb[o + 2] = one[2];
          if (alpha) alpha[done + i] = a;
        }
      } else {
        const need = count * bpp;
        if (src + need > data.length) throw other('This TGA ends mid-way through a block.');
        for (let i = 0; i < count; i++) {
          pixelToRgb(data, src + i * bpp, h.bits, rgb, (done + i) * 3);
          if (alpha) alpha[done + i] = data[src + i * bpp + 3];
        }
        src += need;
      }
      done += count;
    }
  } else {
    const need = pixels * bpp;
    if (data.length < need) throw other('This TGA is shorter than its header claims.');
    for (let i = 0; i < pixels; i++) {
      pixelToRgb(data, i * bpp, h.bits, rgb, i * 3);
      if (alpha) alpha[i] = data[i * bpp + 3];
    }
  }

  // Bit 5 of the descriptor: set means the first row stored is the top one. Paint files are usually bottom-up,
  // and getting this wrong silently shows the car upside down.
  const topDown = (h.descriptor & 0x20) !== 0;
  if (!topDown) {
    flipRows(rgb, h.width * 3, h.height);
    if (alpha) flipRows(alpha, h.width, h.height);
  }

  return alpha ? { width: h.width, height: h.height, rgb, alpha } : { width: h.width, height: h.height, rgb };
}

// Turn a buffer of `height` rows of `stride` bytes upside down, in place.
function flipRows(buf, stride, height) {
  const row = Buffer.alloc(stride);
  for (let y = 0; y < Math.floor(height / 2); y++) {
    const top = y * stride;
    const bottom = (height - 1 - y) * stride;
    buf.copy(row, 0, top, top + stride);
    buf.copy(buf, top, bottom, bottom + stride);
    row.copy(buf, bottom);
  }
}

// Average down to fit `maxEdge`, so a 2048 sheet does not travel to a 280-pixel card.
function downscale(img, maxEdge) {
  const longest = Math.max(img.width, img.height);
  if (!maxEdge || longest <= maxEdge) {
    return { width: img.width, height: img.height, rgb: Buffer.from(img.rgb) };
  }
  const scale = maxEdge / longest;
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const out = Buffer.alloc(w * h * 3);

  const xs = img.width / w;
  const ys = img.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * ys);
    const y1 = Math.min(Math.max(Math.floor((y + 1) * ys), y0 + 1), img.height);
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * xs);
      const x1 = Math.min(Math.max(Math.floor((x + 1) * xs), x0 + 1), img.width);
      let r = 0;
      let g = 0;
      let bl = 0;
      let n = 0;
      for (let sy = y0; sy < y1; sy++) {
        const row = sy * img.width;
        for (let sx = x0; sx < x1; sx++) {
          const i = (row + sx) * 3;
          r += img.rgb[i];
          g += img.rgb[i + 1];
          bl += img.rgb[i + 2];
          n += 1;
        }
      }
      const o = (y * w + x) * 3;
      out[o] = Math.floor(r / n);
      out[o + 1] = Math.floor(g / n);
      out[o + 2] = Math.floor(bl / n);
    }
  }
  return { width: w, height: h, rgb: out };
}

// CRC-32 as PNG specifies it. Node 22+ has zlib.crc32, but the Electron this ships in bundles an older Node.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Encode packed RGB as an 8-bit truecolour PNG: one IDAT, filter type 0 on every row.
function toPng(img) {
  const { width, height, rgb } = img;
  if (rgb.length !== width * height * 3) throw other('Could not encode the preview: pixel data does not match the size.');
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 2;    // colour type: truecolour
  ihdr[10] = 0;   // compression
  ihdr[11] = 0;   // filter method
  ihdr[12] = 0;   // no interlace
  let idat;
  try {
    idat = zlib.deflateSync(raw);
  } catch (e) {
    throw other(`Could not encode the preview: ${e.message}`);
  }
  return Buffer.concat([PNG_SIGNATURE, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

// (path, requested size) → { len, modified, png }. The same file at two sizes is two entries; a repaint of the
// same file is noticed by size and modification time rather than served stale.
let cache = new Map();

// Decode a paint file and hand back a PNG of it, memoised on size and modification time.
function renderFile(filePath, maxEdge) {
  const md = fs.statSync(filePath);
  if (md.size > MAX_SOURCE_BYTES) throw other('That texture is too large to preview.');
  const key = `${String(filePath).toLowerCase()}\u0000${maxEdge}`;
  const hit = cache.get(key);
  if (hit && hit.len === md.size && hit.modified === md.mtimeMs) return hit.png;

  const png = toPng(downscale(decode(fs.readFileSync(filePath)), maxEdge));

  // Crude, but it keeps a big library from pinning every paint in memory.
  if (cache.size >= MAX_CACHE_ENTRIES) cache = new Map();
  cache.set(key, { len: md.size, modified: md.mtimeMs, png });
  return png;
}

function clearCache() {
  cache = new Map();
}

// Any image a card can show, as a data URL. PNG, JPEG and WebP are passed through as they are (up to the size
// cap); a .tga is decoded and scaled down, because the paints are 2048x2048 and the card is a few hundred
// pixels wide.
function previewImage(filePath, maxEdge) {
  const ext = path.extname(String(filePath)).slice(1).toLowerCase();
  if (ext === 'tga') {
    const png = renderFile(filePath, maxEdge == null ? DEFAULT_MAX_EDGE : maxEdge);
    return `data:image/png;base64,${png.toString('base64')}`;
  }
  const md = fs.statSync(filePath);
  if (md.size > MAX_PREVIEW_BYTES) throw other('Preview image is too large to show.');
  let mime;
  switch (ext) {
    case 'png': mime = 'image/png'; break;
    case 'jpg': case 'jpeg': mime = 'image/jpeg'; break;
    case 'webp': mime = 'image/webp'; break;
    default: throw other('Previews must be PNG, JPEG, WebP or TGA.');
  }
  return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
}

module.exports = {
  MAX_SOURCE_BYTES, MAX_PIXELS, MAX_CACHE_ENTRIES, MAX_PREVIEW_BYTES, DEFAULT_MAX_EDGE,
  readHeader, decode, downscale, crc32, toPng, renderFile, clearCache, previewImage,
};
