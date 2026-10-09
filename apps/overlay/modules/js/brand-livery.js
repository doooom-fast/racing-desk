// The Racing Desk's own tile, drawn as a detail of a livery (#brandLivery in dashboard.html, .brand-livery in
// dashboard.css). He asked on 2026-10-08: "Change the k10 logo to a livery image that shows some aspect of the doooom
// logo". It was the old mark on a drifting WebGL chevron field; it is now a part of the DOOOOM wordmark, large and cropped
// by the square, in the colours of the car's own paint — as it sits on a DOOOOM car, where the wordmark runs across the
// flank and a square of the flank shows a letter or two and no more.
//
// Cheap to draw by design: one element and an SVG in it, one mask (images/branding/doooom-mark.png, the wordmark at 1400 by
// 260 as an alpha mask with sixteen levels, 30 KB: the source art in apps/livery/art is 2798 by 519 and is not shipped), two
// colours and a window (the SVG's viewBox), set once and not animated. Nothing here runs per frame. (The mask is an SVG's
// own <image>: Chromium refuses a CSS mask-image whose image is a file's, and the app's page is a file.)
//
// What varies, and when: which part of the wordmark shows (how large, and where along it) is rolled again each time he is
// back in the car and when the car changes (poll-engine.js calls rollBrandLivery, where it already asks for the car's crop),
// as the car tile's crop is. The colours follow the car tile's crop of his paint — the paint's commonest colour for the
// ground, the next most distinct one for the lettering — and are the glass's blue-grey on near-black when there is no paint
// to take them from (a car he has no paint for, a page in a browser).
//
// Pure where it can be (the window, the palette): runs in the page (window.RacingDeskBrandLivery) and in Node (require) alike.
(function () {
  'use strict';

  const ART = Object.freeze({ width: 1400, height: 260, src: 'images/branding/doooom-mark.png' });
  // The square window, as a share of the artwork's height: from half of it (a letter's middle, cropped top and bottom) to
  // four fifths (a letter nearly whole). The artwork's lowest tenth is the stray tops of the SPEEDSPORTS line under the
  // wordmark; the window stays above it.
  const SIDE_SHARE = Object.freeze({ min: 0.5, max: 0.8 });
  const INK_BOTTOM_SHARE = 0.9;

  // The colours when there is no paint: near-black under the glass's own blue-grey.
  const FALLBACK = Object.freeze({ body: [22, 25, 32], ink: [115, 140, 191] });

  // Which part of the wordmark shows. rand() is in [0, 1). Returns the window in the artwork's own pixels, and as the viewBox
  // that puts exactly it in a square of any size.
  function pickWindow(rand) {
    const r = typeof rand === 'function' ? rand : Math.random;
    const side = ART.height * (SIDE_SHARE.min + (SIDE_SHARE.max - SIDE_SHARE.min) * r());
    const x = (ART.width - side) * r();
    const y = Math.max(0, ART.height * INK_BOTTOM_SHARE - side) * r();
    return { side, x, y, viewBox: [x, y, side, side].map((n) => n.toFixed(2)).join(' ') };
  }

  const luma = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const mix = (a, b, t) => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));

  // The two colours of a crop of his paint, from its pixels (RGBA, as a canvas gives them): the ground is the commonest
  // colour, the lettering the commonest colour that is far from it. Sorted into four levels a channel, so a gradient is
  // one colour and a shade of it is the same. A paint of one colour (or nothing far enough from it) gets a lettering made
  // from the ground: lighter on a dark one, darker on a light one. The two always differ in lightness by a quarter or more,
  // so the lettering is read against the ground whatever the paint is.
  function paletteOf(data) {
    if (!data || data.length < 4) return null;
    const bins = new Map();
    let n = 0;
    for (let i = 0; i + 3 < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const key = (data[i] >> 6) * 16 + (data[i + 1] >> 6) * 4 + (data[i + 2] >> 6);
      let b = bins.get(key);
      if (!b) { b = { n: 0, r: 0, g: 0, b: 0 }; bins.set(key, b); }
      b.n++; b.r += data[i]; b.g += data[i + 1]; b.b += data[i + 2]; n++;
    }
    if (!n) return null;
    const mean = (b) => [Math.round(b.r / b.n), Math.round(b.g / b.n), Math.round(b.b / b.n)];
    let top = null;
    for (const b of bins.values()) if (!top || b.n > top.n) top = b;
    const body = mean(top);
    let accent = null, best = 0;
    for (const b of bins.values()) {
      if (b.n < n * 0.025) continue;
      const c = mean(b);
      const d = dist(c, body);
      if (d < 90) continue;
      const score = b.n * d;
      if (score > best) { best = score; accent = c; }
    }
    const lighter = (c) => mix(c, [255, 255, 255], 0.8);
    const darker = (c) => mix(c, [0, 0, 0], 0.85);
    let ink = accent || (luma(body) < 0.5 ? lighter(body) : darker(body));
    if (Math.abs(luma(ink) - luma(body)) < 0.25) ink = luma(body) < 0.5 ? lighter(body) : darker(body);
    return { body, ink };
  }

  const css = (c) => 'rgb(' + c[0] + ', ' + c[1] + ', ' + c[2] + ')';

  const api = { ART, SIDE_SHARE, FALLBACK, pickWindow, paletteOf };

  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  // ── The page ──────────────────────────────────────────────────────────────────────────────────────────────────────
  let _token = 0;

  function el() { return document.getElementById('brandLivery'); }

  function setColours(palette) {
    const e = el();
    if (!e) return;
    const p = palette || { body: FALLBACK.body, ink: FALLBACK.ink };
    e.style.setProperty('--brand-body', css(p.body));
    e.style.setProperty('--brand-ink', css(p.ink));
    e.classList.toggle('from-paint', !!palette);
  }

  // A new part of the wordmark. (`window._brandRoll`, a number in [0, 1), pins the roll: the golden frames set it, as the other
  // specs set `_displaySettingsEveryMs`, so that a frame is the same one every run.)
  function roll(rand) {
    const e = el();
    const svg = e && e.querySelector('svg');
    if (!svg) return null;
    const pinned = typeof window._brandRoll === 'number' && window._brandRoll >= 0 && window._brandRoll < 1 ? () => window._brandRoll : null;
    const w = pickWindow(rand || pinned);
    svg.setAttribute('viewBox', w.viewBox);
    e.classList.add('rolled');
    return w;
  }

  // The car tile's crop of his paint (a URL; anything else is no paint): its two colours, found on a canvas of a few pixels.
  function followPaint(url) {
    const mine = ++_token;
    if (typeof url !== 'string' || !url.length) { setColours(null); return; }
    const img = new Image();
    img.onload = () => {
      if (mine !== _token) return;
      try {
        const c = document.createElement('canvas');
        c.width = c.height = 24;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0, 24, 24);
        setColours(paletteOf(g.getImageData(0, 0, 24, 24).data));
      } catch (e) { setColours(null); }
    };
    img.onerror = () => { if (mine === _token) setColours(null); };
    img.src = url;
  }

  window.RacingDeskBrandLivery = Object.assign({ roll, followPaint, setColours }, api);
  window.rollBrandLivery = roll;
  // Drawn at once: a part of the wordmark and the fallback colours, until a car and a paint say otherwise.
  roll();
  setColours(null);
})();
