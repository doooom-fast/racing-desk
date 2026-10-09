/**
 * The Racing Desk's own tile as a detail of a livery (modules/js/brand-livery.js): he asked on 2026-10-08 for "a livery
 * image that shows some aspect of the doooom logo" in place of the old mark. What is held here is the part that is pure:
 * which part of the wordmark shows (large, cropped by the square, above the stray line of lettering under the wordmark,
 * and different each time it is rolled), the two colours taken from a crop of his paint, and the asset the page draws it
 * with (web-sized, light, and not the source art). The page's side — the mask, the colours following the crop, the roll on
 * getting back in the car, the tile square at the top left — is in logo-livery-page.spec.mjs and drive-view.spec.mjs.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const bl = require('../../modules/js/brand-livery.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const OVERLAY = path.resolve(here, '..', '..');

// A reproducible stream of numbers in [0, 1).
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
// RGBA pixels of the given colours, in the given counts.
function pixels(parts) {
  const out = [];
  for (const [c, n, a = 255] of parts) for (let i = 0; i < n; i++) out.push(c[0], c[1], c[2], a);
  return Uint8ClampedArray.from(out);
}

test.describe('which part of the wordmark shows', () => {
  const { width: W, height: H } = bl.ART;

  test('the smallest and the largest window the roll can make, at the ends of its numbers', () => {
    const small = bl.pickWindow(() => 0);
    expect(small.side).toBeCloseTo(H * bl.SIDE_SHARE.min, 6);
    expect([small.x, small.y]).toEqual([0, 0]);
    const big = bl.pickWindow(() => 0.999999999);
    expect(big.side).toBeCloseTo(H * bl.SIDE_SHARE.max, 3);
    expect(big.x + big.side).toBeLessThanOrEqual(W + 0.01);
  });

  test('every window is large (half to four fifths of the wordmark\'s height: a letter or two, cropped), inside the artwork, and above its lowest tenth', () => {
    const rand = seeded(7);
    for (let i = 0; i < 3000; i++) {
      const w = bl.pickWindow(rand);
      expect(w.side).toBeGreaterThanOrEqual(H * 0.5 - 1e-9);
      expect(w.side).toBeLessThanOrEqual(H * 0.8 + 1e-9);
      expect(w.x).toBeGreaterThanOrEqual(0);
      expect(w.x + w.side).toBeLessThanOrEqual(W + 1e-6);
      expect(w.y).toBeGreaterThanOrEqual(0);
      // The wordmark's lowest tenth is the stray tops of the line of lettering under it: never in the window.
      expect(w.y + w.side).toBeLessThanOrEqual(H * 0.9 + 1e-6);
    }
  });

  test('the viewBox is exactly that window, a square: the part of the wordmark that a square of any size shows', () => {
    const rand = seeded(11);
    for (let i = 0; i < 200; i++) {
      const w = bl.pickWindow(rand);
      const [vx, vy, vw, vh] = w.viewBox.split(' ').map(Number);
      expect(vw).toBeCloseTo(vh, 2);
      expect(vx).toBeCloseTo(w.x, 2);
      expect(vy).toBeCloseTo(w.y, 2);
      expect(vw).toBeCloseTo(w.side, 2);
      // large and cropped: the window is no more than four fifths of the wordmark's height, so the square shows a part of it
      // on every side, and the wordmark is 5.4 times as wide as it is tall, so it shows a letter or two of six
      expect(W / w.side).toBeGreaterThan(5.5);
      expect(H / w.side).toBeGreaterThan(1.2);
    }
  });

  test('the same numbers give the same window, and different ones another; over many rolls every part of the wordmark and every size comes up', () => {
    expect(bl.pickWindow(seeded(3))).toEqual(bl.pickWindow(seeded(3)));
    expect(bl.pickWindow(seeded(3))).not.toEqual(bl.pickWindow(seeded(4)));
    const rand = seeded(99);
    const alongBins = new Set();
    const sizeBins = new Set();
    for (let i = 0; i < 600; i++) {
      const w = bl.pickWindow(rand);
      alongBins.add(Math.floor((w.x / (W - w.side)) * 10 - 1e-9));
      sizeBins.add(Math.floor(((w.side / H - bl.SIDE_SHARE.min) / (bl.SIDE_SHARE.max - bl.SIDE_SHARE.min)) * 5 - 1e-9));
    }
    expect(alongBins.size, 'the window gets to every tenth of the wordmark\'s length').toBe(10);
    expect(sizeBins.size, 'and every fifth of the sizes').toBe(5);
  });

  test('with no function given it rolls with Math.random: two rolls differ', () => {
    expect(bl.pickWindow()).not.toEqual(bl.pickWindow());
  });
});

test.describe('the two colours of a crop of his paint', () => {
  test('a crop of two colours: the commoner is the ground, the other the lettering', () => {
    const p = bl.paletteOf(pixels([[[10, 40, 160], 600], [[250, 190, 20], 300]]));
    expect(p).toEqual({ body: [10, 40, 160], ink: [250, 190, 20] });
  });

  test('shades of one colour are one colour (four levels a channel): a gradient is not a palette', () => {
    const shades = [];
    for (let i = 0; i < 50; i++) shades.push([[200 + (i % 5), 30 + (i % 4), 30], 10]);
    const p = bl.paletteOf(pixels(shades));
    // no colour far from the ground: the lettering is made from the ground, lighter as it is dark
    expect(p.body.map((c) => Math.round(c / 10))).toEqual([20, 3, 3]);
    expect(p.ink[1]).toBeGreaterThan(190);
  });

  test('one dark colour gets lighter lettering, one light colour darker lettering, and the two always differ in lightness by a quarter or more', () => {
    const dark = bl.paletteOf(pixels([[[20, 20, 25], 400]]));
    expect(dark.ink[0]).toBeGreaterThan(200);
    const light = bl.paletteOf(pixels([[[240, 240, 235], 400]]));
    expect(light.ink[0]).toBeLessThan(60);
    const luma = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
    for (const p of [dark, light, bl.paletteOf(pixels([[[120, 120, 120], 300], [[140, 135, 130], 100]]))]) {
      expect(Math.abs(luma(p.ink) - luma(p.body))).toBeGreaterThanOrEqual(0.25);
    }
  });

  test('a second colour that is near the ground, or a speck of one, is not the lettering', () => {
    // a dark red beside a red: near. A speck (1 in 100) of white: too few.
    const near = bl.paletteOf(pixels([[[200, 30, 30], 500], [[170, 30, 40], 400]]));
    expect(near.ink[1]).toBeGreaterThan(190);   // made from the ground
    const speck = bl.paletteOf(pixels([[[30, 30, 30], 990], [[255, 255, 255], 10]]));
    expect(speck.ink).not.toEqual([255, 255, 255]);
    expect(speck.ink[0]).toBeGreaterThan(190);
  });

  test('the lettering is the commonest colour that is far from the ground, not the furthest', () => {
    const p = bl.paletteOf(pixels([[[20, 20, 20], 500], [[240, 240, 240], 40], [[200, 60, 60], 300]]));
    expect(p.ink).toEqual([200, 60, 60]);
  });

  test('transparent pixels are not counted; a crop with nothing in it, or nothing at all, gives none', () => {
    expect(bl.paletteOf(pixels([[[255, 0, 0], 900, 0], [[0, 0, 255], 100]])).body).toEqual([0, 0, 255]);
    expect(bl.paletteOf(pixels([[[255, 0, 0], 100, 0]]))).toBeNull();
    expect(bl.paletteOf(new Uint8ClampedArray(0))).toBeNull();
    expect(bl.paletteOf(null)).toBeNull();
  });
});

test.describe('the asset the page draws it with', () => {
  const file = path.join(OVERLAY, 'images', 'branding', 'doooom-mark.png');
  const png = fs.readFileSync(file);

  test('is a web-sized PNG of the wordmark at the size the numbers assume, light to fetch and to draw, with its transparency as an alpha mask', () => {
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
    expect([width, height]).toEqual([bl.ART.width, bl.ART.height]);
    // The source art is 2798 by 519; this is half of it at most, in a palette of sixteen levels of alpha, and light.
    expect(width).toBeLessThanOrEqual(1400);
    expect(png.length, 'bytes').toBeLessThan(60 * 1024);
    // colour type 3 (a palette) with a tRNS chunk: the alpha
    expect(png[25]).toBe(3);
    expect(png.includes(Buffer.from('tRNS'))).toBe(true);
  });

  test('the page names it where the wordmark is drawn (an SVG mask, not a CSS one: a file\'s image is refused to a CSS mask), and the source art is not shipped with the app', () => {
    const html = fs.readFileSync(path.join(OVERLAY, 'dashboard.html'), 'utf8');
    expect(html).toContain(`href="${bl.ART.src}"`);
    expect(html).toContain(`width="${bl.ART.width}" height="${bl.ART.height}"`);
    expect(bl.ART.src).toBe('images/branding/doooom-mark.png');
    const css = fs.readFileSync(path.join(OVERLAY, 'modules', 'styles', 'dashboard.css'), 'utf8');
    expect(css, 'a CSS mask-image of the wordmark is not used: Chromium refuses it for a page that is a file').not.toMatch(/mask-image\s*:\s*url\([^)]*doooom/);
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    const images = walk(path.join(OVERLAY, 'images'));
    expect(images.filter((f) => /art_doooom|DOOOOM\.ai|shatter-field/i.test(f))).toEqual([]);
    expect(Math.max(...images.filter((f) => /doooom/i.test(f)).map((f) => fs.statSync(f).size))).toBeLessThan(60 * 1024);
  });

  test('the dashboard has the tile as one element and no old mark, and loads the script', () => {
    const html = fs.readFileSync(path.join(OVERLAY, 'dashboard.html'), 'utf8');
    expect(html).toContain('id="brandLivery"');
    expect(html).toContain('modules/js/brand-livery.js');
    const tile = html.slice(html.indexOf('id="brandLogoSquare"'), html.indexOf('id="carLogoSquare"'));
    expect(tile).not.toContain('<img');
    expect(tile).not.toContain('<canvas');
    expect(tile).toContain('<svg');
    expect(tile).not.toMatch(/logomark|k10/i);
  });
});
