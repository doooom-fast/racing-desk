/**
 * What the glance layout is held to, measured in the page — shared by the iPad's tests (drive-view.spec.mjs), the rig's
 * own Ctrl+Shift+F, and the page OBS draws at any box he gives it (hud-page-obs-ipad.spec.mjs): every panel a cell, inside
 * the screen, none over another, nothing cut off by its cell, no label under 11px and no number under 20px.
 */

// Every panel of the HUD, and the one each is: the two badges, the Racing Desk's and the car's maker's (the two squares at
// the top left, his first), are cells on an iPad as on the rig's own Ctrl+Shift+F — he asked for the logos back on
// 2026-10-08, after they had gone on 2026-09-30. (The pit box is the weather alone here: no tyres and no fuel.)
export const CELLS = {
  brand: '#brandLogoSquare', car: '#carLogoSquare',
  hero: '#positionPage', gaps: '#gapsBlock', tacho: '.tacho-block', lb: '#leaderboardPanel', map: '.map-panel',
  local: '.map-zoom-panel', laps: '#lapsPanel', rating: '#ratingPage', ctrl: '.car-controls', pedals: '.pedals-area',
  timer: '#raceTimerBlock', pit: '#pitBoxPanel', ds: '#datastreamPanel', inc: '#incidentsPanel',
};
// The same on the rig's own screen (kept as a name: the tests that open the page from the file ask for it).
export const CELLS_RIG = CELLS;

// Everything the rules are held to, measured in the page. Each is a list of what breaks it: nothing, when it holds.
export function measure(page, cells = CELLS) {
  return page.evaluate((cellSelectors) => {
    const vw = innerWidth, vh = innerHeight;
    const shown = (el) => el.getClientRects().length > 0;
    const out = { cells: {}, outside: [], overflowing: [], cutOff: [], small: [], covered: 0, overlapping: [] };

    let area = 0;
    const rects = [];
    for (const [name, sel] of Object.entries(cellSelectors)) {
      const el = document.querySelector(sel);
      if (!el || !shown(el)) { out.outside.push(`${name}: not drawn`); continue; }
      const r = el.getBoundingClientRect();
      out.cells[name] = [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
      area += r.width * r.height;
      rects.push([name, r]);
      if (r.left < -0.5 || r.top < -0.5 || r.right > vw + 0.5 || r.bottom > vh + 0.5) out.outside.push(name);
    }
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const [a, ra] = rects[i], [b, rb] = rects[j];
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (w > 1 && h > 1) out.overlapping.push(`${a}/${b}`);
    }
    out.covered = area / (vw * vh);

    // Nothing in a cell is cut off by it: the cell's contents, and the parts inside it that lay themselves out.
    const containers = [...Object.values(cellSelectors), '#positionPage .pos-layout', '#positionPage .pos-meta', '#lbRows',
      '#incidentsPanel .inc-inner', '#gapsBlock .gap-item', '#gapsBlock .sector-cell', '#leaderboardPanel .lb-inner', '.lb-row',
      '.car-controls .ctrl-item', '.car-controls .ctrl-mini', '.ds-inner', '.pb-inner', '.pb-content', '.pb-page', '.pb-tire-circles',
      '.pb-circle-cell', '.laps-panel > *', '.laps-sectors .sector-cell', '.laps-col', '#ratingPage .rating-row',
      '#ratingPage .rating-item', '.pedal-labels-row', '.pedal-label-group', '.ds-gforce'];
    for (const sel of containers) {
      for (const el of document.querySelectorAll(sel)) {
        if (!shown(el)) continue;
        // (a line of type is taller than its line-height in a face like the mono, by a fraction of its size, and that
        // is the slack allowed in height)
        const slack = Math.max(1, parseFloat(getComputedStyle(el).fontSize) * 0.3);
        if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + slack) {
          out.overflowing.push(`${sel} ${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight}`);
        }
      }
    }

    // Nothing that is written is cut off or left out of sight: every piece of text in a cell lies inside the box its
    // ancestors let show (an overflow hidden, the ellipsis of a name that does not fit, a line clamp, and the cell).
    const gone = (el) => {
      for (let e = el; e && e !== document.body; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return true;
      }
      return false;
    };
    const window_ = (el, cell) => {
      let l = -Infinity, t = -Infinity, r = Infinity, b = Infinity;
      for (let e = el; e; e = e.parentElement) {
        const cs = getComputedStyle(e);
        // (a box that steps aside, display: contents, shows nothing of its own and clips nothing)
        if (cs.display !== 'contents' && (cs.overflowX !== 'visible' || cs.overflowY !== 'visible')) {
          const q = e.getBoundingClientRect();
          l = Math.max(l, q.left); t = Math.max(t, q.top); r = Math.min(r, q.right); b = Math.min(b, q.bottom);
        }
        if (e === cell) break;
      }
      return { l, t, r, b };
    };

    // Labels are 11px or more and numbers 20px or more. The exceptions are named: a caption to a name (the car's
    // model, a driver's iRating, an axis, a sector's number, the tank's size, the track's name) is a label whatever it
    // says, and so is a tyre's temperature under its ring (the pits' reading, not the lap's: he asked for them "Much
    // smaller", 2026-10-01); the leaderboard's rows are a list of a dozen, at 14px.
    const CAPTION = '.gap-ir, .gap-driver, .car-model-label, .sector-label, .ctrl-mini-label, .pb-circle-pos, .ir-bar-tick-label, ' +
      '.pb-fuel-tank-cap, .map-zoom-label, .panel-label, .ds-label, .pb-label, .laps-k, .pedal-channel-label, .ctrl-label, .lb-header, ' +
      '.pb-strat-btn, .pb-circle-temp';
    const tiny = new Map();
    for (const [name, sel] of Object.entries(cellSelectors)) {
      const cell = document.querySelector(sel);
      if (!cell || !shown(cell)) continue;
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const text = node.textContent.trim();
        const el = node.parentElement;
        if (!text || !el || !shown(el) || gone(el)) continue;
        if (el.closest('svg, canvas, #rd-remote-menu-fab, #rd-remote-menu-panel')) continue;

        const px = parseFloat(getComputedStyle(el).fontSize);
        // (a line's box is taller than the ink in it: a digit's is the middle three fifths, so that is what is held to
        // the box it is shown through)
        const range = document.createRange();
        range.selectNodeContents(node);
        const box = window_(el, cell);
        for (const q of range.getClientRects()) {
          if (q.width < 1) continue;
          const inset = px * (px >= 60 ? 0.3 : 0.22);
          const top = q.top + inset, bottom = q.bottom - inset;
          if (q.left < box.l - 1.5 || top < box.t - 1.5 || q.right > box.r + 1.5 || bottom > box.b + 1.5) {
            out.cutOff.push(`${name}: "${text.slice(0, 24)}" [${Math.round(q.left)},${Math.round(top)},${Math.round(q.right)},${Math.round(bottom)}] out of [${Math.round(box.l)},${Math.round(box.t)},${Math.round(box.r)},${Math.round(box.b)}]`);
            break;
          }
        }

        const inList = !!el.closest('.lb-row');
        const isCaption = !!el.closest(CAPTION);
        const isNumber = /\d/.test(text) && !isCaption && !inList;
        const min = isNumber ? 20 : 11;
        if (px < min - 0.01) tiny.set(`${name}: "${text.slice(0, 20)}" ${px.toFixed(1)}px < ${min}`, 1);
      }
    }
    out.small = [...tiny.keys()];

    // The leaderboard is a list of a dozen rows, at 14px or more in its rows' own type (its lap and gap columns are the
    // 0.84 of it, and never under a label's 11).
    for (const row of document.querySelectorAll('.lb-row')) {
      if (!shown(row)) continue;
      const px = parseFloat(getComputedStyle(row).fontSize);
      if (px < 14 - 0.01) out.small.push(`lb: a row is ${px.toFixed(1)}px < 14`);
    }
    out.place = parseFloat(getComputedStyle(document.querySelector('#positionPage .pos-number')).fontSize);
    out.gear = parseFloat(getComputedStyle(document.querySelector('.tacho-gear')).fontSize);
    const delta = document.querySelector('#positionPage .pos-meta-row.delta-row .val');
    out.delta = parseFloat(getComputedStyle(delta).fontSize);
    out.kind = document.body.classList.contains('session-race') ? 'race' : document.body.classList.contains('session-nonrace') ? 'nonrace' : 'none';
    return out;
  }, cells);
}


// What he asked for on 2026-10-08, measured in the page and held at every size and box the glance layout is drawn at (the
// iPad's seven, the rig's screens, the boxes OBS is given): the full map and the following map are square and the same
// size; the Racing Desk's tile and the car's are square, side by side in the top left corner, his first; and the pit box is
// the weather alone, no tyres and no fuel.
export function squares(page) {
  return page.evaluate(() => {
    const box = (sel) => { const el = document.querySelector(sel); if (!el || el.getClientRects().length === 0) return null; const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
    const rects = {};
    for (const [name, sel] of Object.entries({
      map: '.map-panel', local: '.map-zoom-panel', brand: '#brandLogoSquare', car: '#carLogoSquare', hero: '#positionPage', gaps: '#gapsBlock',
      tacho: '.tacho-block', lb: '#leaderboardPanel', laps: '#lapsPanel', rating: '#ratingPage', ctrl: '.car-controls', pedals: '.pedals-area',
      timer: '#raceTimerBlock', pit: '#pitBoxPanel', ds: '#datastreamPanel', inc: '#incidentsPanel',
    })) rects[name] = box(sel);
    const pit = document.getElementById('pitBoxPanel');
    return {
      rects, vw: innerWidth, vh: innerHeight,
      tyres: document.getElementById('pbPageTyres').getClientRects().length, fuel: document.getElementById('pbPageFuel').getClientRects().length,
      weather: document.getElementById('pbPageWeather').getClientRects().length,
      pitText: pit.innerText,
    };
  });
}

// (a pixel or so: the grid's tracks are fractions of a pixel)
export function holdSquares(expect, s, label, { lb = true } = {}) {
  const near = (a, b, why) => expect(Math.abs(a - b), `${label}: ${why} (${a.toFixed(1)} against ${b.toFixed(1)})`).toBeLessThanOrEqual(1.5);
  const { map, local, brand, car } = s.rects;
  for (const [name, r] of Object.entries({ map, local, brand, car })) {
    expect(r, `${label}: ${name} is drawn`).not.toBeNull();
    near(r.w, r.h, `${name} is square`);
  }
  near(map.w, local.w, 'the two maps are the same width');
  near(map.h, local.h, 'the two maps are the same height');
  expect(local.l, `${label}: the full map is first, the following map beside it`).toBeGreaterThanOrEqual(map.r);
  near(map.t, local.t, 'the two maps are in one row');
  // The tiles: side by side in the top left corner, the Racing Desk's first, one size, in a row of their own at the top.
  near(brand.w, car.w, 'the two tiles are one size');
  near(brand.t, car.t, 'the two tiles are in one row');
  expect(car.l, `${label}: the Racing Desk's tile is first, the car's after it`).toBeGreaterThanOrEqual(brand.r);
  expect(car.l - brand.r, `${label}: the tiles are side by side, a gutter apart`).toBeLessThanOrEqual(20);
  const others = Object.entries(s.rects).filter(([n, r]) => r && n !== 'brand' && n !== 'car');
  for (const [n, r] of others) {
    expect(r.t, `${label}: ${n} is not above the tiles`).toBeGreaterThanOrEqual(brand.t - 1);
    expect(r.l, `${label}: ${n} is not left of the Racing Desk's tile`).toBeGreaterThanOrEqual(brand.l - 1);
  }
  // Nothing under the tiles at the left edge is above the maps: the top row is the tiles' row.
  expect(brand.t, `${label}: the tiles are at the top`).toBeLessThanOrEqual(30);
  expect(brand.l, `${label}: the Racing Desk's tile is at the left`).toBeLessThanOrEqual(30);
  // No tyres and no fuel: the pit box is the weather.
  expect([s.tyres, s.fuel], `${label}: no tyres and no fuel`).toEqual([0, 0]);
  expect(s.weather, `${label}: the weather is there`).toBeGreaterThan(0);
  expect(s.pitText, `${label}: nothing of the tyres or the fuel is written in the pit box`).not.toMatch(/Tyres|Tread|Fuel|Pit add|Pit window|Left front/i);
  if (lb) expect(s.rects.lb, `${label}: the leaderboard is there`).not.toBeNull();
}
