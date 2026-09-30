/**
 * Choosing the section of a paint that goes behind the car badge (modules/js/logo-livery-picker.js), on sheets made
 * up here: a flat body with one busy patch picks the patch; a flat paint, an empty one and a transparent one give
 * nothing; the choice is random among the best few and the same random gives the same choice; the window is the
 * badge's shape and inside the sheet; the crop is the window's pixels at the size asked.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const picker = require('../../modules/js/logo-livery-picker.js');

const GREY = [88, 88, 94];

// A sheet of `pixelAt(x, y) → [r, g, b, a?]`.
function sheet(width, height, pixelAt, { alpha = false } = {}) {
  const rgb = Buffer.alloc(width * height * 3);
  const a = alpha ? Buffer.alloc(width * height) : null;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = pixelAt(x, y);
      const i = y * width + x;
      rgb[i * 3] = px[0];
      rgb[i * 3 + 1] = px[1];
      rgb[i * 3 + 2] = px[2];
      if (a) a[i] = px[3] === undefined ? 255 : px[3];
    }
  }
  return alpha ? { width, height, rgb, alpha: a } : { width, height, rgb };
}

// Artwork: a field of small shards in many colours, different for each `seed`.
function busy(x, y, seed = 1) {
  const cell = ((x >> 2) * 73856093) ^ ((y >> 2) * 19349663) ^ (seed * 83492791);
  const h = (cell >>> 0) % 360;
  const s = 0.7 + ((cell >>> 9) % 30) / 100;
  const v = 0.5 + ((cell >>> 17) % 50) / 100;
  const c = v * s;
  const xx = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r; let g; let b;
  if (h < 60) [r, g, b] = [c, xx, 0]; else if (h < 120) [r, g, b] = [xx, c, 0]; else if (h < 180) [r, g, b] = [0, c, xx];
  else if (h < 240) [r, g, b] = [0, xx, c]; else if (h < 300) [r, g, b] = [xx, 0, c]; else [r, g, b] = [c, 0, xx];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

const inside = (win, box) => win.x >= box.x && win.y >= box.y && win.x + win.w <= box.x + box.w && win.y + win.h <= box.y + box.h;
const centreIn = (win, box) => {
  const cx = win.x + win.w / 2;
  const cy = win.y + win.h / 2;
  return cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h;
};
const share = (win, box) => picker.overlap(win, box) * Math.min(win.w * win.h, box.w * box.h) / (win.w * win.h);

test.describe('what is chosen', () => {
  test('a flat body with one busy patch: the patch', () => {
    const patch = { x: 150, y: 40, w: 64, h: 64 };
    const img = sheet(256, 256, (x, y) => (x >= patch.x && x < patch.x + patch.w && y >= patch.y && y < patch.y + patch.h ? busy(x, y) : GREY));
    for (const r of [0, 0.3, 0.6, 0.99]) {
      const win = picker.chooseWindow(img, { random: () => r });
      expect(win, `random ${r}`).not.toBeNull();
      expect(centreIn(win, patch), `random ${r}: the window ${JSON.stringify(win)} is on the patch`).toBe(true);
      expect(share(win, patch), `random ${r}: most of the window is the patch`).toBeGreaterThanOrEqual(0.5);
      expect(win.flatShare).toBeLessThanOrEqual(picker.FLAT_SHARE);
      for (const one of win.few) expect(centreIn(one, patch), 'every one of the few is on the patch').toBe(true);
    }
  });

  test('a fully flat paint gives nothing, and so does one with only noise in it', () => {
    expect(picker.chooseWindow(sheet(256, 256, () => GREY))).toBeNull();
    expect(picker.chooseWindow(sheet(256, 256, () => [200, 30, 30]))).toBeNull();
    expect(picker.chooseWindow(sheet(256, 256, (x, y) => [88 + ((x * 7 + y * 3) % 5), 88, 94]))).toBeNull();
    expect(picker.chooseCrop(sheet(256, 256, () => GREY))).toBeNull();
  });

  test('two flat colours meeting along a line are not artwork', () => {
    expect(picker.chooseWindow(sheet(256, 256, (x) => (x < 128 ? [220, 30, 20] : [10, 10, 12])))).toBeNull();
    expect(picker.chooseWindow(sheet(256, 256, (x, y) => (x + y < 256 ? [255, 255, 255] : [20, 40, 200])))).toBeNull();
  });

  test('a paint in two colours that is a field of shards is artwork, though the base is most of it', () => {
    // The shatter liveries: a red base and black shards, edges everywhere and two hues, and the red two-thirds of
    // any window — which is what the base-coat rule lets through when the window is busy throughout.
    const img = sheet(256, 256, (x, y) => {
      const cell = (Math.floor(x / 3) * 2654435761) ^ (Math.floor(y / 3) * 40503);
      return ((cell >>> 0) % 3) === 0 ? [12, 8, 8] : [214, 48, 20];
    });
    const win = picker.chooseWindow(img, { random: () => 0.5 });
    expect(win).not.toBeNull();
    expect(win.hues).toBe(2);
    expect(win.flatShare).toBeGreaterThan(picker.FLAT_SHARE);
    expect(win.edgeDensity).toBeGreaterThanOrEqual(picker.BUSY_EDGES);
    expect(win.score).toBeGreaterThan(picker.MIN_SCORE);
  });

  test('a transparent sheet gives nothing; artwork that is opaque on a clear sheet is found', () => {
    const patch = { x: 40, y: 150, w: 70, h: 70 };
    const busyAt = (x, y) => x >= patch.x && x < patch.x + patch.w && y >= patch.y && y < patch.y + patch.h;
    const clear = sheet(256, 256, (x, y) => [...(busyAt(x, y) ? busy(x, y) : GREY), 0], { alpha: true });
    expect(picker.chooseWindow(clear)).toBeNull();
    const opaquePatch = sheet(256, 256, (x, y) => [...(busyAt(x, y) ? busy(x, y) : GREY), busyAt(x, y) ? 255 : 0], { alpha: true });
    const win = picker.chooseWindow(opaquePatch, { random: () => 0.2 });
    expect(win).not.toBeNull();
    expect(centreIn(win, patch)).toBe(true);
  });

  test('a window that is mostly the base coat or the template\'s empty ground is put out, unless it is busy throughout', () => {
    // White ground over the left half (the sheet's commonest colour), a flat grey over the top right, artwork over
    // the bottom right.
    const img = sheet(200, 200, (x, y) => (x < 100 ? [250, 250, 250] : y < 100 ? [120, 120, 124] : busy(x, y)));
    const a = picker.analyse(picker.shrink(img, picker.WORK_EDGE));
    const ground = [250, 250, 250];
    // 52 in 100 ground beside the flat grey: under the flat rule's share, and put out for being the ground.
    const beside = picker.scoreWindow(a, { x: 48, y: 0, w: 100, h: 100 }, ground);
    expect(beside.out).toBe('ground');
    expect(beside.groundShare).toBeGreaterThan(picker.GROUND_SHARE);
    expect(beside.flatShare).toBeLessThanOrEqual(picker.FLAT_SHARE);
    // The same 52 in 100 ground with artwork across the rest is busy throughout, and stays in.
    const across = picker.scoreWindow(a, { x: 48, y: 100, w: 100, h: 100 }, ground);
    expect(across.out).toBeUndefined();
    expect(across.groundShare).toBeGreaterThan(picker.GROUND_SHARE);
    expect(across.edgeDensity).toBeGreaterThanOrEqual(picker.BUSY_EDGES);
    expect(across.score).toBeGreaterThan(picker.MIN_SCORE);
    // Three-quarters ground with the artwork in one corner is not busy enough, and is out.
    const corner = picker.scoreWindow(a, { x: 24, y: 100, w: 100, h: 100 }, ground);
    expect(['flat', 'ground']).toContain(corner.out);
    expect(corner.edgeDensity).toBeLessThan(picker.BUSY_EDGES);
    // All ground is flat; all artwork is in, and ranks above the window that is half ground.
    expect(picker.scoreWindow(a, { x: 0, y: 100, w: 100, h: 100 }, ground).out).toBe('flat');
    const on = picker.scoreWindow(a, { x: 100, y: 100, w: 100, h: 100 }, ground);
    expect(on.out).toBeUndefined();
    expect(on.score).toBeGreaterThan(across.score);
  });

  test('the choice is random among the best few, which are not the same spot, and the same random is the same choice', () => {
    const patches = [{ x: 20, y: 20, w: 70, h: 70 }, { x: 160, y: 30, w: 70, h: 70 }, { x: 90, y: 160, w: 70, h: 70 }];
    const img = sheet(256, 256, (x, y) => {
      const k = patches.findIndex((p) => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h);
      return k < 0 ? GREY : busy(x, y, k + 1);
    });
    const first = picker.chooseWindow(img, { random: () => 0 });
    expect(first.few.length).toBeGreaterThanOrEqual(2);
    expect(first.few.length).toBeLessThanOrEqual(picker.KEEP);
    for (let i = 0; i < first.few.length; i++) {
      expect(first.few[i].score).toBeGreaterThanOrEqual(first.few[0].score * picker.NEAR_BEST);
      for (let j = i + 1; j < first.few.length; j++) expect(picker.overlap(first.few[i], first.few[j])).toBeLessThanOrEqual(picker.SAME_SPOT);
    }
    const seen = new Set();
    for (const r of [0, 0.34, 0.67, 0.99]) {
      const win = picker.chooseWindow(img, { random: () => r });
      seen.add(`${win.x},${win.y},${win.w}`);
      expect(patches.some((p) => centreIn(win, p)), `random ${r} is on a patch`).toBe(true);
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
    const again = picker.chooseWindow(img, { random: () => 0.34 });
    const same = picker.chooseWindow(img, { random: () => 0.34 });
    expect([again.x, again.y, again.w, again.h]).toEqual([same.x, same.y, same.w, same.h]);
    // A random that is not one is the first of the few, never nothing.
    expect(picker.chooseWindow(img, { random: () => NaN })).not.toBeNull();
    expect(picker.chooseWindow(img, { random: () => 7 })).not.toBeNull();
  });

  test('the window is the badge\'s shape, and inside the sheet, on a sheet that is not square', () => {
    const img = sheet(320, 200, (x, y) => (x >= 200 ? busy(x, y) : GREY));
    for (const aspect of [1, 1.5, 0.75]) {
      for (const r of [0, 0.5, 0.99]) {
        const win = picker.chooseWindow(img, { aspect, random: () => r });
        expect(win, `aspect ${aspect}`).not.toBeNull();
        expect(Math.abs(win.w / win.h - aspect), `aspect ${aspect}: ${win.w}x${win.h}`).toBeLessThan(0.08);
        expect(inside(win, { x: 0, y: 0, w: 320, h: 200 }), `aspect ${aspect}: inside`).toBe(true);
        for (const one of win.few) expect(inside(one, { x: 0, y: 0, w: 320, h: 200 })).toBe(true);
      }
    }
    // Too small to be a paint at all.
    expect(picker.chooseWindow(sheet(8, 8, (x, y) => busy(x, y)))).toBeNull();
    expect(picker.chooseWindow(null)).toBeNull();
  });
});

test.describe('the crop', () => {
  test('is the window\'s pixels, at the size asked, in the window\'s shape', () => {
    const img = sheet(200, 200, (x, y) => (x >= 100 ? [10, 200, 30] : [200, 10, 30]));
    const green = picker.cropImage(img, { x: 120, y: 20, w: 60, h: 60 }, 32);
    expect([green.width, green.height, green.rgb.length]).toEqual([32, 32, 32 * 32 * 3]);
    for (let i = 0; i < green.rgb.length; i += 3) expect([green.rgb[i], green.rgb[i + 1], green.rgb[i + 2]]).toEqual([10, 200, 30]);
    const wide = picker.cropImage(img, { x: 0, y: 0, w: 90, h: 60 }, 30, 1.5);
    expect([wide.width, wide.height]).toEqual([30, 20]);
    // A window across the edge averages what it covers: half red, half green.
    const across = picker.cropImage(img, { x: 90, y: 0, w: 20, h: 20 }, 1);
    expect(across.rgb[0]).toBeGreaterThan(80);
    expect(across.rgb[1]).toBeGreaterThan(80);
  });

  test('chooseCrop gives the window and its image together', () => {
    const patch = { x: 150, y: 40, w: 64, h: 64 };
    const img = sheet(256, 256, (x, y) => (x >= patch.x && x < patch.x + patch.w && y >= patch.y && y < patch.y + patch.h ? busy(x, y) : GREY));
    const chosen = picker.chooseCrop(img, { size: 48, random: () => 0.5 });
    expect(chosen).not.toBeNull();
    expect(centreIn(chosen.window, patch)).toBe(true);
    expect([chosen.image.width, chosen.image.height]).toEqual([48, 48]);
  });

  test('shrink keeps a small sheet as it is and brings a big one to the working size, alpha with it', () => {
    const small = picker.shrink(sheet(100, 50, (x, y) => [x, y, 0, x], { alpha: true }), 320);
    expect([small.width, small.height, small.alpha.length]).toEqual([100, 50, 5000]);
    const big = picker.shrink(sheet(640, 320, (x, y) => [x % 256, y % 256, 0, 200], { alpha: true }), 320);
    expect([big.width, big.height, big.rgb.length, big.alpha.length]).toEqual([320, 160, 320 * 160 * 3, 320 * 160]);
    expect(big.alpha[0]).toBe(200);
  });
});

test('the seeded random is a sequence in [0, 1) that the seed decides', () => {
  const a = picker.seeded(42);
  const b = picker.seeded(42);
  const c = picker.seeded(43);
  const fromA = Array.from({ length: 20 }, () => a());
  const fromB = Array.from({ length: 20 }, () => b());
  const fromC = Array.from({ length: 20 }, () => c());
  expect(fromA).toEqual(fromB);
  expect(fromA).not.toEqual(fromC);
  for (const v of [...fromA, ...fromC]) {
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  }
  expect(new Set(fromA).size).toBeGreaterThan(15);
});
