/**
 * Decoding paints for the cards: a hand-built 4x4 TGA in every variant the sim's folder collects (uncompressed
 * and RLE, 24- and 32-bit, both origins, 16-bit and greyscale), the box downscale, the PNG encoder checked chunk
 * by chunk and by a browser, and previewImage's data URLs and size caps. Port of the tests in
 * apps/paints/src-tauri/src/tga.rs plus lib.rs's preview_image.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const require = createRequire(import.meta.url);
const tga = require('../../modules/js/paints/tga.js');

const RED = [255, 0, 0];
const GREEN = [0, 255, 0];
const BLUE = [0, 0, 255];
const WHITE = [255, 255, 255];

// The 4x4 test card, rows top first: red | green over blue | white, two pixels each.
const CARD = [
  [RED, RED, GREEN, GREEN],
  [RED, RED, GREEN, GREEN],
  [BLUE, BLUE, WHITE, WHITE],
  [BLUE, BLUE, WHITE, WHITE],
];
const CARD_RGB = Buffer.from(CARD.flat(2));

function header({ w, h, bits, imageType, topDown, idLen = 0 }) {
  const v = Buffer.alloc(18);
  v[0] = idLen;
  v[2] = imageType;
  v.writeUInt16LE(w, 12);
  v.writeUInt16LE(h, 14);
  v[16] = bits;
  v[17] = topDown ? 0x20 : 0x00;
  return v;
}

// TGA stores BGR(A); 16-bit is ARRRRRGG GGGBBBBB; 8-bit is grey.
function encodePixel([r, g, b], bits) {
  switch (bits) {
    case 32: return [b, g, r, 0x80];
    case 24: return [b, g, r];
    case 16: { const v = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3); return [v & 0xff, v >> 8]; }
    default: return [r];
  }
}

// Build a TGA of `rows` (top first). Bottom-up files store the last row first.
function build(rows, { bits = 24, topDown = true, rle = false, idLen = 0 } = {}) {
  const w = rows[0].length;
  const h = rows.length;
  const stored = topDown ? rows : [...rows].reverse();
  const body = [];
  if (rle) {
    // Each row: a run packet for the first two pixels, a literal packet for the last two — both packet kinds.
    for (const row of stored) {
      body.push(0x80 | (2 - 1), ...encodePixel(row[0], bits));
      body.push(2 - 1, ...encodePixel(row[2], bits), ...encodePixel(row[3], bits));
    }
  } else {
    for (const row of stored) for (const px of row) body.push(...encodePixel(px, bits));
  }
  const imageType = (bits === 8 ? 3 : 2) + (rle ? 8 : 0);
  return Buffer.concat([header({ w, h, bits, imageType, topDown, idLen }), Buffer.alloc(idLen, 0x41), Buffer.from(body)]);
}

test.describe('decode', () => {
  test('a 4x4 uncompressed 24-bit bottom-up card — the shape the pipeline writes', () => {
    const img = tga.decode(build(CARD, { topDown: false }));
    expect([img.width, img.height]).toEqual([4, 4]);
    expect(Buffer.compare(img.rgb, CARD_RGB)).toBe(0);
  });

  test('every variant decodes to the same pixels: top-down, RLE, 32-bit, an image id', () => {
    for (const opts of [
      { topDown: true }, { topDown: false, rle: true }, { topDown: true, rle: true },
      { bits: 32, topDown: false }, { bits: 32, topDown: true, rle: true }, { topDown: false, idLen: 5 },
    ]) {
      const img = tga.decode(build(CARD, opts));
      expect(Buffer.compare(img.rgb, CARD_RGB), JSON.stringify(opts)).toBe(0);
    }
  });

  test('16-bit colour widens so white stays white, and greyscale spreads across the channels', () => {
    const img16 = tga.decode(build(CARD, { bits: 16 }));
    expect(Buffer.compare(img16.rgb, CARD_RGB)).toBe(0);
    const grey = tga.decode(build([[[7, 7, 7], [200, 200, 200]]], { bits: 8 }));
    expect([...grey.rgb]).toEqual([7, 7, 7, 200, 200, 200]);
  });

  test('BGR is swapped to RGB, and bottom-up rows are flipped', () => {
    // One pixel, red. Stored BGR, so a decoder that forgets to swap returns blue.
    expect([...tga.decode(build([[RED]])).rgb]).toEqual([255, 0, 0]);
    // Two rows: red stored first (the bottom row), green second (the top row). Bottom-up means green first.
    const twoRows = build([[GREEN], [RED]], { topDown: false });
    expect([...tga.decode(twoRows).rgb]).toEqual([0, 255, 0, 255, 0, 0]);
    // The same bytes marked top-down must not be flipped.
    twoRows[17] = 0x20;
    expect([...tga.decode(twoRows).rgb]).toEqual([255, 0, 0, 0, 255, 0]);
  });

  test('run-length packets: a run of three, then two literals', () => {
    const v = Buffer.concat([header({ w: 5, h: 1, bits: 24, imageType: 10, topDown: true }), Buffer.from([
      0x80 | 2, 0, 0, 255,          // run of 3, BGR red
      1, 0, 255, 0, 0, 0, 255,      // 2 literals: green, red
    ])]);
    const img = tga.decode(v);
    expect(img.width).toBe(5);
    expect([...img.rgb]).toEqual([255, 0, 0, 255, 0, 0, 255, 0, 0, 0, 255, 0, 255, 0, 0]);
  });

  test('truncated, empty and lying files are errors, not crashes', () => {
    const card = build(CARD, { topDown: false });
    expect(() => tga.decode(card.subarray(0, 20))).toThrow('This TGA is shorter than its header claims.');
    expect(() => tga.decode(Buffer.alloc(0))).toThrow('Not a TGA: the file is too short.');
    expect(() => tga.decode(Buffer.alloc(18))).toThrow('This TGA holds no image data.');
    // Claims 4x4 but carries one pixel. Must refuse rather than read past the buffer.
    const liar = build([[RED]]);
    liar.writeUInt16LE(4, 12);
    liar.writeUInt16LE(4, 14);
    expect(() => tga.decode(liar)).toThrow('This TGA is shorter than its header claims.');
    // RLE that runs out, and RLE that overshoots.
    const short = build(CARD, { rle: true }).subarray(0, 24);
    expect(() => tga.decode(short)).toThrow(/ends mid-way/);
    const over = Buffer.concat([header({ w: 2, h: 1, bits: 24, imageType: 10, topDown: true }), Buffer.from([0x80 | 4, 0, 0, 255])]);
    expect(() => tga.decode(over)).toThrow('This TGA claims more pixels than it has.');
    const noSize = build([[RED]]);
    noSize.writeUInt16LE(0, 12);
    expect(() => tga.decode(noSize)).toThrow('This TGA has no size.');
  });

  test('colour-mapped files are refused by name; odd depths and types too', () => {
    const v = build([[RED]]);
    v[1] = 1;   // colour map present
    v[2] = 1;   // colour-mapped image
    expect(() => tga.decode(v)).toThrow(/colour map/);
    const depth = build([[RED]]);
    depth[16] = 12;
    expect(() => tga.decode(depth)).toThrow('Unsupported TGA colour depth: 12 bits.');
    const type = build([[RED]]);
    type[2] = 7;
    expect(() => tga.decode(type)).toThrow('Unsupported TGA image type 7.');
  });
});

test.describe('downscale', () => {
  test('averages rather than drops', () => {
    // A 2x1 image of pure red and pure green must average to a single olive pixel, not pick one of them.
    const small = tga.downscale({ width: 2, height: 1, rgb: Buffer.from([255, 0, 0, 0, 255, 0]) }, 1);
    expect([small.width, small.height]).toEqual([1, 1]);
    expect([...small.rgb]).toEqual([127, 127, 0]);
  });

  test('the 4x4 card to 2x2 is its four quadrants', () => {
    const img = tga.decode(build(CARD, { topDown: false }));
    const half = tga.downscale(img, 2);
    expect([half.width, half.height]).toEqual([2, 2]);
    expect([...half.rgb]).toEqual([...RED, ...GREEN, ...BLUE, ...WHITE]);
    // To 3: uneven boxes still cover every source pixel.
    const three = tga.downscale(img, 3);
    expect([three.width, three.height]).toEqual([3, 3]);
    expect(three.rgb.length).toBe(27);
  });

  test('leaves small images alone, keeps aspect, and 0 means no limit', () => {
    const img = { width: 2, height: 2, rgb: Buffer.alloc(12, 1) };
    const same = tga.downscale(img, 64);
    expect([same.width, same.height]).toEqual([2, 2]);
    expect(same.rgb).not.toBe(img.rgb);   // a copy, as the Rust cloned
    const wide = tga.downscale({ width: 8, height: 2, rgb: Buffer.alloc(48, 9) }, 4);
    expect([wide.width, wide.height]).toEqual([4, 1]);
    expect(tga.downscale({ width: 8, height: 2, rgb: Buffer.alloc(48, 9) }, 0).width).toBe(8);
  });
});

// A PNG reader that is not ours: chunk framing, CRCs, inflate, filter-0 rows.
function readPng(png) {
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks = [];
  let at = 8;
  while (at < png.length) {
    const len = png.readUInt32BE(at);
    const type = png.subarray(at + 4, at + 8).toString('latin1');
    const data = png.subarray(at + 8, at + 8 + len);
    const crc = png.readUInt32BE(at + 8 + len);
    const expectedCrc = typeof zlib.crc32 === 'function' ? zlib.crc32(png.subarray(at + 4, at + 8 + len)) : tga.crc32(png.subarray(at + 4, at + 8 + len));
    expect(crc, `${type} crc`).toBe(expectedCrc >>> 0);
    chunks.push({ type, data });
    at += 12 + len;
  }
  expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
  const ihdr = chunks[0].data;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  expect([ihdr[8], ihdr[9], ihdr[10], ihdr[11], ihdr[12]]).toEqual([8, 2, 0, 0, 0]);
  const raw = zlib.inflateSync(chunks[1].data);
  const stride = width * 3;
  expect(raw.length).toBe((stride + 1) * height);
  const rgb = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    expect(raw[y * (stride + 1)], `filter byte row ${y}`).toBe(0);
    raw.copy(rgb, y * stride, y * (stride + 1) + 1, (y + 1) * (stride + 1));
  }
  return { width, height, rgb };
}

test.describe('toPng', () => {
  test('encodes a PNG another reader agrees with, CRCs and all', () => {
    const png = tga.toPng({ width: 2, height: 1, rgb: Buffer.from([255, 0, 0, 0, 255, 0]) });
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    const back = readPng(png);
    expect([back.width, back.height]).toEqual([2, 1]);
    expect([...back.rgb]).toEqual([255, 0, 0, 0, 255, 0]);
    const card = readPng(tga.toPng(tga.decode(build(CARD, { topDown: false }))));
    expect(Buffer.compare(card.rgb, CARD_RGB)).toBe(0);
  });

  test('the CRC matches the reference implementation', () => {
    expect(tga.crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    expect(tga.crc32(Buffer.alloc(0))).toBe(0);
    expect(tga.crc32(Buffer.from('IEND', 'latin1'))).toBe(0xae426082);
  });

  test('mismatched pixel data is refused', () => {
    expect(() => tga.toPng({ width: 2, height: 2, rgb: Buffer.alloc(3) })).toThrow(/Could not encode the preview/);
  });
});

test.describe('files', () => {
  let dir;
  test.beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'racing-desk-paints-tga-')); });
  test.afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  test('renderFile decodes, scales and caches against size and mtime', () => {
    const p = path.join(dir, 'car.tga');
    fs.writeFileSync(p, build(CARD, { topDown: false }));
    const first = tga.renderFile(p, 2);
    const second = tga.renderFile(p, 2);
    expect(second).toBe(first);   // the very same buffer: served from the cache
    expect([...readPng(first).rgb]).toEqual([...RED, ...GREEN, ...BLUE, ...WHITE]);
    // A different size is a different entry.
    expect(readPng(tga.renderFile(p, 64)).width).toBe(4);
    // A repaint is noticed.
    fs.writeFileSync(p, build([[GREEN]]));
    expect([...readPng(tga.renderFile(p, 2)).rgb]).toEqual([0, 255, 0]);
    tga.clearCache();
    expect(tga.renderFile(p, 2)).not.toBe(first);
  });

  test('previewImage: a TGA becomes a PNG data URL, scaled to maxEdge (640 by default)', () => {
    const p = path.join(dir, 'paint.TGA');
    fs.writeFileSync(p, build(CARD, { topDown: false }));
    const url = tga.previewImage(p, 2);
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
    const png = Buffer.from(url.slice('data:image/png;base64,'.length), 'base64');
    expect([...readPng(png).rgb]).toEqual([...RED, ...GREEN, ...BLUE, ...WHITE]);
    // No maxEdge: a 4x4 is already under 640, so it comes through at 4x4.
    expect(readPng(Buffer.from(tga.previewImage(p).split(',')[1], 'base64')).width).toBe(4);
  });

  test('previewImage: PNG, JPEG and WebP pass through under the cap; anything else is refused', () => {
    const png = tga.toPng({ width: 1, height: 1, rgb: Buffer.from(RED) });
    fs.writeFileSync(path.join(dir, 'preview.png'), png);
    expect(tga.previewImage(path.join(dir, 'preview.png'))).toBe(`data:image/png;base64,${png.toString('base64')}`);
    fs.writeFileSync(path.join(dir, 'a.JPG'), 'jpeg bytes');
    expect(tga.previewImage(path.join(dir, 'a.JPG'))).toBe(`data:image/jpeg;base64,${Buffer.from('jpeg bytes').toString('base64')}`);
    fs.writeFileSync(path.join(dir, 'b.jpeg'), 'j');
    expect(tga.previewImage(path.join(dir, 'b.jpeg')).startsWith('data:image/jpeg;base64,')).toBe(true);
    fs.writeFileSync(path.join(dir, 'c.webp'), 'w');
    expect(tga.previewImage(path.join(dir, 'c.webp')).startsWith('data:image/webp;base64,')).toBe(true);
    fs.writeFileSync(path.join(dir, 'd.gif'), 'g');
    expect(() => tga.previewImage(path.join(dir, 'd.gif'))).toThrow('Previews must be PNG, JPEG, WebP or TGA.');
    expect(() => tga.previewImage(path.join(dir, 'missing.png'))).toThrow();
  });

  test('previewImage: the size caps', () => {
    const big = path.join(dir, 'big.png');
    const fd = fs.openSync(big, 'w');
    fs.writeSync(fd, Buffer.alloc(1), 0, 1, tga.MAX_PREVIEW_BYTES);   // sparse: 12 MiB + 1 byte long
    fs.closeSync(fd);
    expect(fs.statSync(big).size).toBe(tga.MAX_PREVIEW_BYTES + 1);
    expect(() => tga.previewImage(big)).toThrow('Preview image is too large to show.');
    // A TGA beyond the source cap is refused before it is read.
    const huge = path.join(dir, 'huge.tga');
    const fd2 = fs.openSync(huge, 'w');
    fs.writeSync(fd2, Buffer.alloc(1), 0, 1, tga.MAX_SOURCE_BYTES);
    fs.closeSync(fd2);
    expect(() => tga.previewImage(huge, 64)).toThrow('That texture is too large to preview.');
  });

  test('the data URL decodes in a browser to the same pixels', async ({ page }) => {
    const p = path.join(dir, 'browser.tga');
    fs.writeFileSync(p, build(CARD, { topDown: false, rle: true, bits: 32 }));
    const url = tga.previewImage(p, 2);
    const seen = await page.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return { w: img.naturalWidth, h: img.naturalHeight, data: Array.from(ctx.getImageData(0, 0, c.width, c.height).data) };
    }, url);
    expect([seen.w, seen.h]).toEqual([2, 2]);
    expect(seen.data).toEqual([...RED, 255, ...GREEN, 255, ...BLUE, 255, ...WHITE, 255]);
  });
});
