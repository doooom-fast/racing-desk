// Choosing the section of a paint that goes behind the HUD's car badge.
//
// A paint is the whole car unwrapped onto a 2048 sheet: panels of artwork, stretches of the base coat, and the
// ground of the template between the panels. What the badge wants is a window with artwork in it — the shard field,
// a sponsor's mark, the number board — and not the flat body colour, not the template's empty ground, and not
// something transparent. So every window of a few sizes is scored for how much is going on in it (edges, the spread
// of its colours, how many hues it has), the flat, the empty and the clear ones are put out, and the choice is made
// at random among the best few that are not the same spot, so that each time he gets in the car it is another
// pleasing section. Pure: no file, no DOM, no Electron. The worker (logo-livery-worker.js) hands it the decoded
// paint and takes the crop back; the tests hand it images they made up.
'use strict';

// The sheet is scored at this size across. Artwork is still artwork at 320 pixels, and a 2048 sheet would be
// four million pixels to look at for every window.
const WORK_EDGE = 320;
// The window's sizes, as shares of the sheet's shorter edge: a quarter or so of the car's unwrapped skin is a
// panel's worth, which is what reads as a section of the livery and not as a texture; the smallest is a logo's
// worth, for a paint that is a base coat with marks on it.
const FRACTIONS = Object.freeze([0.15, 0.22, 0.30, 0.40]);
// Windows are stepped a quarter of their width apart.
const STRIDE_DIV = 4;
// The choice is made among this many of the best, at most.
const KEEP = 5;
// ... each of which has to score at least this share of the best one.
const NEAR_BEST = 0.7;
// Two windows are the same spot when they overlap by more than this share of the smaller.
const SAME_SPOT = 0.35;
// A step in luminance between neighbouring pixels that counts as an edge (0–255).
const EDGE_STEP = 24;
// A window whose commonest colour covers more than this is the base coat...
const FLAT_SHARE = 0.55;
// A window mostly the sheet's own commonest colour is the template's empty ground...
const GROUND_SHARE = 0.5;
// ...unless it is busy throughout — edges on at least this share of its pixels — and the base is not most of it
// by far (the next). A black car with an orange wordmark across it is a base coat with artwork on it, and its
// wordmark windows are seven-tenths black with edges on four-tenths of their pixels; a base coat with a mark in
// one corner has edges on a tenth of them or fewer.
const BUSY_EDGES = 0.15;
const COVER_AT_MOST = 0.8;
// A window whose mean alpha is under this is mostly transparent.
const CLEAR_SHARE = 0.5;
// How near a pixel has to be to a colour to count as it (per channel, 0–255).
const NEAR = 28;
// Fewer hues than this is one colour, however it is lit.
const MIN_HUES = 2;
// Below this a window is not worth showing. On his paints (2026-09-30): two flat colours meeting along a line score
// about 0.35, the shard fields 0.76 to 0.92, a wordmark on the black Lotus about 0.6, and the coarsest shards, in
// windows the size of a panel, about 0.5.
const MIN_SCORE = 0.5;
// Pixels with less saturation than this are counted by their lightness, not their hue...
const GREY_SAT = 0.22;
// ...and so are pixels darker than this in every channel: near black, a channel or two ahead is noise, not a hue.
const DARK_MAX = 40;
// A hue bin has to hold this share of a window's pixels to be counted as one of its hues.
const HUE_SHARE = 0.04;

// Average `img` down so its longer edge is `maxEdge` at most: rgb, and alpha where there is one.
function shrink(img, maxEdge) {
  const longest = Math.max(img.width, img.height);
  if (longest <= maxEdge) {
    return { width: img.width, height: img.height, rgb: Buffer.from(img.rgb), alpha: img.alpha ? Buffer.from(img.alpha) : null };
  }
  const scale = maxEdge / longest;
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  return resample(img, { x: 0, y: 0, w: img.width, h: img.height }, w, h);
}

// The part of `img` inside `win` (source pixels), averaged down to `outW` by `outH`. Every source pixel of a cell
// counts once; a cell narrower than a pixel still takes one.
function resample(img, win, outW, outH) {
  const rgb = Buffer.alloc(outW * outH * 3);
  const alpha = img.alpha ? Buffer.alloc(outW * outH) : null;
  const xs = win.w / outW;
  const ys = win.h / outH;
  for (let y = 0; y < outH; y++) {
    const y0 = win.y + Math.floor(y * ys);
    const y1 = Math.min(Math.max(win.y + Math.floor((y + 1) * ys), y0 + 1), win.y + win.h, img.height);
    for (let x = 0; x < outW; x++) {
      const x0 = win.x + Math.floor(x * xs);
      const x1 = Math.min(Math.max(win.x + Math.floor((x + 1) * xs), x0 + 1), win.x + win.w, img.width);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = y0; sy < y1; sy++) {
        const row = sy * img.width;
        for (let sx = x0; sx < x1; sx++) {
          const i = (row + sx) * 3;
          r += img.rgb[i];
          g += img.rgb[i + 1];
          b += img.rgb[i + 2];
          if (alpha) a += img.alpha[row + sx];
          n += 1;
        }
      }
      if (n === 0) n = 1;
      const o = (y * outW + x) * 3;
      rgb[o] = Math.floor(r / n);
      rgb[o + 1] = Math.floor(g / n);
      rgb[o + 2] = Math.floor(b / n);
      if (alpha) alpha[y * outW + x] = Math.floor(a / n);
    }
  }
  return { width: outW, height: outH, rgb, alpha };
}

// What each pixel of the working image is: its luminance, whether it sits on an edge, and which hue bin it is in
// (twelve hues round the wheel for the saturated, three lightnesses for the grey).
function analyse(work) {
  const { width, height, rgb, alpha } = work;
  const n = width * height;
  const lum = new Uint8Array(n);
  const hue = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = rgb[i * 3];
    const g = rgb[i * 3 + 1];
    const b = rgb[i * 3 + 2];
    lum[i] = (r * 299 + g * 587 + b * 114) / 1000;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    if (sat < GREY_SAT || max < DARK_MAX) {
      hue[i] = 12 + (max < 70 ? 0 : max < 170 ? 1 : 2);
    } else {
      let hh;
      const d = max - min;
      if (max === r) hh = ((g - b) / d + 6) % 6;
      else if (max === g) hh = (b - r) / d + 2;
      else hh = (r - g) / d + 4;
      hue[i] = Math.min(11, Math.floor(hh * 2));
    }
  }
  const edge = new Uint8Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const dx = x + 1 < width ? Math.abs(lum[i + 1] - lum[i]) : 0;
      const dy = y + 1 < height ? Math.abs(lum[i + width] - lum[i]) : 0;
      edge[i] = dx + dy >= EDGE_STEP ? 1 : 0;
    }
  }
  return { width, height, rgb, alpha, lum, hue, edge };
}

// The commonest colour of an image — its pixels put in 512 bins, and the mean of the fullest bin's — which on a
// paint sheet is the template's ground or the base coat.
function commonestColour(rgb, from, count, stride, width, win) {
  const bins = new Uint32Array(512);
  const sums = new Float64Array(512 * 3);
  const each = (i) => {
    const r = rgb[i * 3];
    const g = rgb[i * 3 + 1];
    const b = rgb[i * 3 + 2];
    const bin = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    bins[bin] += 1;
    sums[bin * 3] += r;
    sums[bin * 3 + 1] += g;
    sums[bin * 3 + 2] += b;
  };
  if (win) {
    for (let y = win.y; y < win.y + win.h; y++) for (let x = win.x; x < win.x + win.w; x++) each(y * width + x);
  } else {
    for (let i = from; i < from + count; i += stride) each(i);
  }
  let best = 0;
  for (let k = 1; k < 512; k++) if (bins[k] > bins[best]) best = k;
  const n = bins[best] || 1;
  return [sums[best * 3] / n, sums[best * 3 + 1] / n, sums[best * 3 + 2] / n];
}

function near(rgb, i, colour) {
  return Math.abs(rgb[i * 3] - colour[0]) <= NEAR && Math.abs(rgb[i * 3 + 1] - colour[1]) <= NEAR
    && Math.abs(rgb[i * 3 + 2] - colour[2]) <= NEAR;
}

// Score one window of the analysed image. Returns null for a window put out: flat, the ground, or clear.
function scoreWindow(a, win, ground) {
  const { width, rgb, alpha, edge, hue } = a;
  const n = win.w * win.h;
  const mode = commonestColour(rgb, 0, 0, 1, width, win);
  let edges = 0;
  let flat = 0;
  let onGround = 0;
  let clear = 0;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let sr2 = 0;
  let sg2 = 0;
  let sb2 = 0;
  const hues = new Uint32Array(15);
  for (let y = win.y; y < win.y + win.h; y++) {
    for (let x = win.x; x < win.x + win.w; x++) {
      const i = y * width + x;
      edges += edge[i];
      if (near(rgb, i, mode)) flat += 1;
      if (near(rgb, i, ground)) onGround += 1;
      if (alpha) clear += alpha[i];
      hues[hue[i]] += 1;
      const r = rgb[i * 3];
      const g = rgb[i * 3 + 1];
      const b = rgb[i * 3 + 2];
      sr += r; sg += g; sb += b;
      sr2 += r * r; sg2 += g * g; sb2 += b * b;
    }
  }
  const flatShare = flat / n;
  const groundShare = onGround / n;
  const meanAlpha = alpha ? clear / n / 255 : 1;
  let distinct = 0;
  for (let k = 0; k < 15; k++) if (hues[k] / n >= HUE_SHARE) distinct += 1;
  const sd = (s, s2) => Math.sqrt(Math.max(0, s2 / n - (s / n) * (s / n)));
  const spread = (sd(sr, sr2) + sd(sg, sg2) + sd(sb, sb2)) / 3 / 128;
  const edgeDensity = edges / n;
  const facts = { edgeDensity, spread, hues: distinct, flatShare, groundShare, meanAlpha };
  // A base coat with a mark across it is artwork; a base coat with a mark in one corner is not.
  const busy = edgeDensity >= BUSY_EDGES && flatShare <= COVER_AT_MOST && groundShare <= COVER_AT_MOST;
  if (meanAlpha < CLEAR_SHARE) return { ...facts, out: 'clear' };
  if (flatShare > FLAT_SHARE && !busy) return { ...facts, out: 'flat' };
  if (groundShare > GROUND_SHARE && !busy) return { ...facts, out: 'ground' };
  if (distinct < MIN_HUES) return { ...facts, out: 'one colour' };
  // What is going on in the window: its edges above all — artwork has them, a base coat has none — then how far
  // apart its colours are, then how many hues it has, which is what tells the shard field from the sponsor board.
  const detail = 0.5 * Math.min(1, edgeDensity / 0.30) + 0.3 * Math.min(1, spread / 0.35)
    + 0.2 * Math.min(1, (distinct - 1) / 5);
  // Less of it for what the base or the ground covers past half the window, so that of two marks on a base coat
  // the one that fills its window ranks first.
  const score = detail * (1 - Math.max(0, Math.max(flatShare, groundShare) - 0.5));
  if (score < MIN_SCORE) return { ...facts, out: 'dull', score };
  return { ...facts, score };
}

// The share of the smaller of two windows that the other covers.
function overlap(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.min(a.w * a.h, b.w * b.h);
}

// Every window of the given aspect at every size and step, scored. Returns { candidates (the ones in), rejected
// (the ones out, with why) }, in the working image's pixels.
function scoreAll(a, aspect) {
  const shorter = Math.min(a.width, a.height);
  const ground = commonestColour(a.rgb, 0, a.width * a.height, 1, a.width, null);
  const candidates = [];
  const rejected = [];
  for (const fraction of FRACTIONS) {
    let h = Math.max(8, Math.round(shorter * fraction));
    let w = Math.max(8, Math.round(h * aspect));
    if (w > a.width) { w = a.width; h = Math.max(8, Math.round(w / aspect)); }
    if (h > a.height) { h = a.height; w = Math.max(8, Math.round(h * aspect)); }
    if (w > a.width || h > a.height) continue;
    const step = Math.max(2, Math.round(w / STRIDE_DIV));
    for (let y = 0; y + h <= a.height; y += step) {
      for (let x = 0; x + w <= a.width; x += step) {
        const win = { x, y, w, h };
        const s = scoreWindow(a, win, ground);
        if (s.out) rejected.push({ ...win, ...s });
        else candidates.push({ ...win, ...s });
      }
    }
  }
  candidates.sort((p, q) => q.score - p.score);
  return { candidates, rejected };
}

// The best few that are not the same spot: the best, then each next-best that overlaps none of those kept, up to
// KEEP, and none scoring under NEAR_BEST of the best.
function bestFew(candidates) {
  const few = [];
  if (!candidates.length) return few;
  const floor = candidates[0].score * NEAR_BEST;
  for (const c of candidates) {
    if (few.length >= KEEP || c.score < floor) break;
    if (few.some((k) => overlap(k, c) > SAME_SPOT)) continue;
    few.push(c);
  }
  return few;
}

/**
 * Choose the window. `img` is { width, height, rgb, alpha? } as tga.decode gives it; `aspect` is the window's
 * width over its height; `random` gives a number in [0, 1). Returns null when no window is worth showing —
 * a flat paint, an empty one, a transparent one — else { x, y, w, h } in the source's own pixels, with `score`,
 * `few` (what the choice was among, in source pixels) and `looked` (how many windows were scored).
 */
function chooseWindow(img, { aspect = 1, random = Math.random } = {}) {
  if (!img || !img.width || !img.height || img.width < 16 || img.height < 16) return null;
  const work = shrink(img, WORK_EDGE);
  const a = analyse(work);
  const { candidates, rejected } = scoreAll(a, aspect);
  const few = bestFew(candidates);
  if (!few.length) return null;
  const sx = img.width / work.width;
  const sy = img.height / work.height;
  const toSource = (c) => {
    const x = Math.max(0, Math.min(img.width - 1, Math.round(c.x * sx)));
    const y = Math.max(0, Math.min(img.height - 1, Math.round(c.y * sy)));
    let h = Math.max(1, Math.round(c.h * sy));
    let w = Math.max(1, Math.round(h * aspect));
    if (x + w > img.width) { w = img.width - x; h = Math.max(1, Math.round(w / aspect)); }
    if (y + h > img.height) { h = img.height - y; w = Math.max(1, Math.min(img.width - x, Math.round(h * aspect))); }
    return { x, y, w, h, score: c.score, edgeDensity: c.edgeDensity, spread: c.spread, hues: c.hues, flatShare: c.flatShare, groundShare: c.groundShare };
  };
  const mapped = few.map(toSource);
  let pick = Math.floor(random() * mapped.length);
  if (!(pick >= 0 && pick < mapped.length)) pick = 0;
  return { ...mapped[pick], few: mapped, looked: candidates.length + rejected.length };
}

// The chosen window of the paint, as an image `size` wide and `size / aspect` high, averaged down.
function cropImage(img, win, size, aspect = 1) {
  const outW = Math.max(1, Math.round(size));
  const outH = Math.max(1, Math.round(size / aspect));
  const out = resample(img, win, outW, outH);
  return { width: out.width, height: out.height, rgb: out.rgb };
}

// The window and the crop together; null where there is no window worth showing.
function chooseCrop(img, { aspect = 1, size = 512, random = Math.random } = {}) {
  const win = chooseWindow(img, { aspect, random });
  if (!win) return null;
  return { window: win, image: cropImage(img, win, size, aspect) };
}

// A small seeded generator (mulberry32), so a worker given a seed makes the choice the seed says.
function seeded(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = {
  WORK_EDGE, FRACTIONS, KEEP, NEAR_BEST, SAME_SPOT, FLAT_SHARE, GROUND_SHARE, BUSY_EDGES, COVER_AT_MOST, CLEAR_SHARE,
  MIN_HUES, MIN_SCORE,
  shrink, resample, analyse, scoreWindow, scoreAll, bestFew, overlap, chooseWindow, cropImage, chooseCrop, seeded,
};
