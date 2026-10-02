/**
 * What the glance layout is held to, measured in the page — shared by the iPad's tests (drive-view.spec.mjs), the rig's
 * own Ctrl+Shift+F, and the page OBS draws at any box he gives it (hud-page-obs-ipad.spec.mjs): every panel a cell, inside
 * the screen, none over another, nothing cut off by its cell, no label under 11px and no number under 20px.
 */

// Every panel of the HUD, and the one each is. On an iPad (which is what this server serves) the two badges, the
// Racing Desk mark and the car's maker, are not shown — he asked for the logos to go — so they are not cells here;
// the rig's own Ctrl+Shift+F keeps them.
export const CELLS = {
  hero: '#positionPage', gaps: '#gapsBlock', tacho: '.tacho-block', lb: '#leaderboardPanel', map: '.map-panel',
  local: '.map-zoom-panel', laps: '#lapsPanel', rating: '#ratingPage', ctrl: '.car-controls', pedals: '.pedals-area',
  timer: '#raceTimerBlock', pit: '#pitBoxPanel', ds: '#datastreamPanel', inc: '#incidentsPanel',
};
// On the rig's own screen the two badges are cells too.
export const CELLS_RIG = { ...CELLS, brand: '#brandLogoSquare', car: '#carLogoSquare' };

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

