// The car's controls as the host sends them (RacingDesk.Plugin.CarControls): what the car has, by the canonical list,
// and what each control reads now — NONE, OFF, ON, a value, the name of a position, or unread (the car has it and
// the sim is not saying what it reads) — with the car's own label for it. This module says what each cell of the
// controls panel shows, which cells the rig's panel has room for, and what the spotter says of DRS and push-to-pass;
// poll-engine.js draws it. Pure but for render(), so it runs in the unit tests as it does in the page.
//
// The rig's HUD (not the glance layout) shows a panel for every adjustment the car has — he asked for that on
// 2026-10-01: "show adjustment panels for every adjustment available for that car. Omit ones that are not on the car
// when there's no room". The panel is 240px wide by the stylesheet and shares its column with the pedals, so the room
// is a constant of the layout, not a measurement (arrange): three full cells go across it, four compact ones, and two
// rows down it before the pedals lose their room. The car's real controls come first; a NONE cell (the car has none)
// fills a slot only where one is left, and is the first to go; past that the type steps down to compact, and past
// that the last of the car's other controls go, in the list's order from the end. The three are never dropped.
(function () {
  'use strict';

  const KEY = 'RacingDesk.Plugin.CarControls';

  // What the three cells are called when the list has no word for them.
  const LABELS = Object.freeze({ bb: 'BB', tc: 'TC', abs: 'ABS' });
  // The three cells, in the panel's order, and the DOM ids they have always had.
  const SLOTS = Object.freeze([['bb', 'ctrlBB'], ['tc', 'ctrlTC'], ['abs', 'ctrlABS']]);
  const DASH = '—';

  // The room the rig's panel has (leaderboard.css, .car-controls.ctrl-fit): cells across at the full size and at the
  // compact one, and rows down before the pedals under it lose their room.
  const ROOM = Object.freeze({ fullCols: 3, compactCols: 4, maxRows: 2 });

  const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

  /**
   * The car's controls from a payload, or null: not sent (another sim, a car the list does not have, a host from
   * before there was a list), sent as text, or not the shape the host sends. A reading that is not an object is
   * dropped; the rest is kept as it came.
   */
  function read(payload) {
    if (!payload || typeof payload !== 'object') return null;
    let cc = payload[KEY];
    if (typeof cc === 'string') {
      try { cc = JSON.parse(cc); } catch (e) { return null; }
    }
    if (!isObject(cc) || typeof cc.car !== 'string' || !cc.car) return null;
    const out = { car: cc.car, name: typeof cc.name === 'string' ? cc.name : '', kind: typeof cc.kind === 'string' ? cc.kind : '' };
    if (typeof cc.fixedSetup === 'boolean') out.fixedSetup = cc.fixedSetup;
    for (const slot of ['abs', 'tc', 'bb', 'drs', 'p2p']) if (isObject(cc[slot])) out[slot] = cc[slot];
    out.more = Array.isArray(cc.more) ? cc.more.filter((m) => isObject(m) && typeof m.id === 'string' && m.id) : [];
    return out;
  }

  const number = (x) => (typeof x === 'number' && isFinite(x) ? x : null);

  /** What a reading shows: the host's text, or its number, or a dash for one that says nothing (unread among them). */
  function textOf(r) {
    if (!r || r.state === 'unread') return DASH;
    if (typeof r.text === 'string' && r.text) return r.text;
    const n = number(r.value);
    return n === null ? DASH : String(n);
  }

  /**
   * How full a cell's bar is, 0 to 1: the host's, or the bar the HUD always drew for the three. A position with a
   * name of its own (MDM, TRACK) is not a quantity, so the number behind it does not fill a bar.
   */
  function fillOf(r, slot) {
    if (!r || r.state !== 'value') return 0;
    const fill = number(r.fill);
    if (fill !== null) return Math.max(0, Math.min(1, fill));
    if (typeof r.text === 'string' && r.text && !/^-?\d+(\.\d+)?$/.test(r.text.trim())) return 0;
    const n = number(r.value);
    if (n === null) return 0;
    if (slot === 'bb') return Math.max(0, Math.min(1, (n - 30) / 40));
    if (slot === 'tc' || slot === 'abs') return Math.max(0, Math.min(1, n / 12));
    return 0;
  }

  /** The value in a spotter's card: the text as shown, or the number. */
  function announced(r) {
    const n = number(r && r.value);
    return typeof (r && r.text) === 'string' && r.text ? r.text : n === null ? '' : String(n);
  }

  // A reading's state as the HUD goes by it: the host's word, 'unknown' where it said nothing of a primary.
  const stateOf = (r) => (typeof r.state === 'string' ? r.state : 'value');

  /**
   * The panel, cell by cell, from the car's controls.
   *
   * - primary: bb, tc, abs — always three, in that order. `hidden` for one inside a mode, which the mode's cell
   *   shows instead. `state` is the host's (none, on, off, value, unread) or 'unknown' when the host said nothing of it.
   * - modes: a cell per mode control, after the three.
   * - more: the car's other controls, in the list's order (an unread one with a dash), then DRS and push-to-pass.
   */
  function view(cc) {
    const primary = SLOTS.map(([slot, el]) => {
      const r = cc[slot];
      if (!r) return { id: slot, el, slot, label: LABELS[slot], text: DASH, state: 'unknown', fill: 0, hidden: false, locked: false, value: null };
      const mode = r.state === 'mode';
      return {
        id: slot, el, slot,
        label: (typeof r.label === 'string' && r.label) || LABELS[slot],
        text: mode ? DASH : textOf(r),
        state: mode ? 'mode' : stateOf(r),
        fill: fillOf(r, slot),
        hidden: mode,
        locked: !!r.locked,
        value: number(r.value),
        by: mode && typeof r.by === 'string' ? r.by : null,
      };
    });

    const modes = [], more = [];
    for (const m of Array.isArray(cc.more) ? cc.more : []) {
      const cell = {
        id: m.id,
        label: (typeof m.label === 'string' && m.label) || m.id,
        text: textOf(m),
        state: stateOf(m),
        fill: fillOf(m, m.id),
        locked: !!m.locked,
        value: number(m.value),
        active: false,
      };
      if (m.id === 'mode') modes.push(cell); else more.push(cell);
    }
    for (const slot of ['drs', 'p2p']) {
      const r = cc[slot];
      if (!r) continue;
      more.push({
        id: slot,
        label: (typeof r.label === 'string' && r.label) || slot.toUpperCase(),
        text: textOf(r),
        state: stateOf(r),
        fill: 0,
        locked: false,
        value: number(r.value),
        active: r.active === true,
        // DRS 1 and 2: it is there for the taking, and not yet open.
        ready: slot === 'drs' && r.active !== true && number(r.value) !== null && number(r.value) > 0,
        count: number(r.count),
      });
    }
    return { primary, modes, more };
  }

  /**
   * Which of the view's cells the rig's panel shows, and how (the room rule at the top of this file). The cells are
   * keyed as render() keys them: the three by their slot, the modes 'mode', 'mode2'…, the rest by id.
   *
   *   { cols, rows, compact, shown: [keys], omitted: [keys] }
   *
   * A NONE cell takes a slot only where one is left after the car's real controls, and is the first to go; past the
   * room at the full size the type steps down to compact; past that the last of the car's other controls go. The
   * three and the modes are kept whatever the room. A cell a mode hides takes no slot.
   */
  function arrange(v, room) {
    const r = Object.assign({}, ROOM, room || {});
    const cells = [];
    v.primary.forEach((c) => { if (!c.hidden) cells.push({ key: c.slot, none: c.state === 'none', keep: true }); });
    v.modes.forEach((c, i) => cells.push({ key: 'mode' + (i || ''), none: false, keep: true }));
    v.more.forEach((c) => cells.push({ key: c.id, none: c.state === 'none', keep: false }));

    const real = cells.filter((c) => !c.none);
    const none = cells.filter((c) => c.none);
    const fullRoom = r.maxRows * r.fullCols;
    const compact = real.length > fullRoom;
    const maxCols = compact ? r.compactCols : r.fullCols;
    const slots = r.maxRows * maxCols;

    const shown = [];
    const kept = real.filter((c) => c.keep);
    const rest = real.filter((c) => !c.keep);
    for (const c of kept) shown.push(c.key);
    for (const c of rest) { if (shown.length >= slots) break; shown.push(c.key); }
    for (const c of none) { if (shown.length >= slots) break; shown.push(c.key); }

    const rows = Math.max(1, Math.min(r.maxRows, Math.ceil(shown.length / maxCols)));
    const cols = Math.max(1, Math.min(maxCols, Math.ceil(shown.length / rows)));
    const isShown = new Set(shown);
    return { cols, rows, compact, shown, omitted: cells.filter((c) => !isShown.has(c.key)).map((c) => c.key) };
  }

  /**
   * What the spotter says as DRS and push-to-pass change from one frame to the next. `prev` may be null (the
   * first frame, another car); nothing is said of a first frame, only of a change.
   */
  function signals(prev, next) {
    const out = [];
    if (!next) return out;
    const before = prev && prev.car === next.car ? prev : null;
    if (next.drs) {
      const now = number(next.drs.value), was = before && before.drs ? number(before.drs.value) : null;
      if (was !== null && now !== null && now !== was) {
        if (now === 1) out.push({ msg: 'DRS next zone', severity: 'sp-warn', header: 'DRS', category: 'drs' });
        else if (now === 2) out.push({ msg: 'DRS — open it', severity: 'sp-clear', header: 'DRS', category: 'drs' });
        else if (now === 3) out.push({ msg: 'DRS open', severity: 'sp-clear', header: 'DRS', category: 'drs' });
      }
    }
    if (next.p2p) {
      const on = next.p2p.active === true, wasOn = !!(before && before.p2p && before.p2p.active === true);
      const count = number(next.p2p.count), wasCount = before && before.p2p ? number(before.p2p.count) : null;
      const label = (typeof next.p2p.label === 'string' && next.p2p.label) || 'P2P';
      if (before && before.p2p && on !== wasOn) {
        if (on) out.push({ msg: label + ' on' + (count !== null ? ' — ' + count + 's left' : ''), severity: 'sp-clear', header: 'Push to pass', category: 'p2p' });
        else out.push({ msg: label + ' off' + (count !== null ? ' — ' + count + 's left' : ''), severity: 'sp-warn', header: 'Push to pass', category: 'p2p' });
      } else if (count === 0 && wasCount !== null && wasCount > 0) {
        out.push({ msg: label + ' used up', severity: 'sp-danger', header: 'Push to pass', category: 'p2p' });
      }
    }
    return out;
  }

  // A reading that changed under the driver: both frames had a reading (a dash becoming a number is the sim starting
  // to say, not him turning a dial), and it is not the same.
  const isChange = (before, now) => before !== undefined && before !== now && before !== DASH && now !== DASH;

  // The glance layout (Ctrl+Shift+F, the iPad, the page OBS draws of it) lays the panel out as a cell of its grid:
  // the room rule is the rig's HUD's alone.
  const inGlance = (doc) => !!(doc && doc.body && doc.body.classList.contains('drive-mode-active'));

  /**
   * Draws the panel. `hooks.flash(elementId)` and `hooks.announce(id, value, direction, label, text)` are called
   * for a control whose reading changed since the last frame of the same car; `hooks.say(signal)` for what the
   * spotter has to say. Returns the view drawn, with `fit` (what the rig's room rule decided, or null in the glance
   * layout). DOM only from here down.
   */
  function render(panel, cc, hooks, state) {
    if (!panel || !cc) return null;
    hooks = hooks || {};
    state = state || {};
    const v = view(cc);
    const sameCar = state.car === cc.car;
    const last = sameCar && state.last ? state.last : {};
    const lastValues = sameCar && state.values ? state.values : {};
    const seen = {}, values = {};
    const doc = panel.ownerDocument;
    const glance = inGlance(doc);
    const fit = glance ? null : arrange(v);
    const omitted = new Set(fit ? fit.omitted : []);

    panel.classList.add('car-controls-listed');
    panel.classList.remove('no-adj');

    for (const cell of v.primary) {
      const el = doc.getElementById(cell.el);
      if (!el) continue;
      draw(el, cell, omitted.has(cell.slot));
      seen[cell.id] = cell.text;
      values[cell.id] = cell.value;
      if (sameCar && isChange(last[cell.id], cell.text) && !cell.hidden) changed(cell, el.id, hooks, lastValues[cell.id]);
    }

    // The mode cells sit after the three, before the "no adjustments" line.
    const anchor = doc.getElementById('ctrlNoAdj');
    let modeEls = Array.from(panel.querySelectorAll('.ctrl-item.ctrl-mode'));
    while (modeEls.length > v.modes.length) modeEls.pop().remove();
    v.modes.forEach((cell, i) => {
      let el = modeEls[i];
      if (!el) {
        el = doc.createElement('div');
        el.className = 'ctrl-item ctrl-mode';
        el.id = i === 0 ? 'ctrlMode' : 'ctrlMode' + (i + 1);
        el.innerHTML = '<div class="ctrl-label"></div><div class="ctrl-value"></div>';
        if (anchor && anchor.parentNode === panel) panel.insertBefore(el, anchor); else panel.appendChild(el);
        modeEls.push(el);
      }
      const key = 'mode' + (i || '');
      draw(el, cell, omitted.has(key));
      seen[key] = cell.text;
      values[key] = cell.value;
      if (sameCar && isChange(last[key], cell.text)) changed(cell, el.id, hooks, lastValues[key]);
    });

    // The car's other controls: in the glance layout a row of their own; on the rig's HUD cells like the three (the
    // row's box dissolves in the stylesheet, .ctrl-more as display: contents). Only where there are any.
    let row = doc.getElementById('ctrlMore');
    if (v.more.length === 0) {
      if (row) row.remove();
    } else {
      if (!row) {
        row = doc.createElement('div');
        row.className = 'ctrl-more';
        row.id = 'ctrlMore';
        panel.appendChild(row);
      }
      const ids = v.more.map((c) => c.id).join('|');
      if (row.getAttribute('data-ids') !== ids) {
        row.setAttribute('data-ids', ids);
        row.innerHTML = '';
        for (const cell of v.more) {
          const el = doc.createElement('div');
          el.className = 'ctrl-mini';
          el.setAttribute('data-id', cell.id);
          el.innerHTML = '<span class="ctrl-mini-label"></span><span class="ctrl-mini-value"></span>';
          row.appendChild(el);
        }
      }
      const els = row.children;
      v.more.forEach((cell, i) => {
        const el = els[i];
        if (!el) return;
        const label = el.querySelector('.ctrl-mini-label');
        const value = el.querySelector('.ctrl-mini-value');
        if (label.textContent !== cell.label) label.textContent = cell.label;
        if (value.textContent !== cell.text) value.textContent = cell.text;
        value.classList.toggle('ctrl-mini-word', isWord(cell));
        value.classList.toggle('ctrl-value-wide', isWide(cell.text));
        value.classList.toggle('ctrl-value-long', isLong(cell.text));
        el.classList.toggle('ctrl-mini-off', cell.state === 'off');
        el.classList.toggle('ctrl-mini-none', cell.state === 'none');
        el.classList.toggle('ctrl-mini-unread', cell.state === 'unread');
        el.classList.toggle('ctrl-mini-active', !!cell.active);
        el.classList.toggle('ctrl-mini-ready', !!cell.ready);
        el.classList.toggle('ctrl-mini-locked', !!cell.locked);
        el.classList.toggle('ctrl-omitted', omitted.has(cell.id));
        el.style.setProperty('--ctrl-pct', Math.round(cell.fill * 100) + '%');
        seen[cell.id] = cell.text;
        values[cell.id] = cell.value;
        if (sameCar && isChange(last[cell.id], cell.text) && cell.id !== 'drs' && cell.id !== 'p2p') {
          el.classList.remove('ctrl-mini-changed');
          void el.offsetWidth;
          el.classList.add('ctrl-mini-changed');
          if (typeof hooks.announce === 'function') hooks.announce(cell.id, cell.value, direction(lastValues[cell.id], cell), cell.label, cell.text);
        }
      });
    }

    // What the room rule decided, for the stylesheet: the cells across, the rows down (the panel takes more of its
    // column for two), and the compact type. In the glance layout none of it.
    panel.classList.toggle('ctrl-fit', !!fit);
    panel.classList.toggle('ctrl-compact', !!fit && fit.compact);
    if (fit) {
      panel.style.setProperty('--ctrl-cols', String(fit.cols));
      panel.setAttribute('data-ctrl-rows', String(fit.rows));
    } else {
      panel.style.removeProperty('--ctrl-cols');
      panel.removeAttribute('data-ctrl-rows');
    }

    if (typeof hooks.say === 'function')
      for (const signal of signals(sameCar ? state.cc : null, cc)) hooks.say(signal);

    state.car = cc.car;
    state.last = seen;
    state.values = values;
    state.cc = cc;
    v.fit = fit;
    return v;
  }

  // A value that is a word (NONE, ON, OFF, TRACK, AUTOMATIC) and not a number: set small, as the three have always had it.
  const isWord = (cell) => cell.state === 'none' || cell.state === 'on' || cell.state === 'off' || (cell.state === 'value' && /[A-Za-z]{3,}/.test(cell.text));
  // Text wider than a cell at its size (leaderboard.css): a number of five characters (48.25) is set a step down,
  // and a word of seven letters or more (AUTOMATIC), or a number of six (-10.25), smaller still.
  const isNumber = (text) => /^-?[\d.]+$/.test(text);
  const isWide = (text) => typeof text === 'string' && isNumber(text) && text.length === 5;
  const isLong = (text) => typeof text === 'string' && (/[A-Za-z]{7,}/.test(text) || (isNumber(text) && text.length >= 6));

  // One of the three, or a mode: the label, the text, the bar, and the classes the styles go by.
  function draw(el, cell, omit) {
    const label = el.querySelector('.ctrl-label');
    const value = el.querySelector('.ctrl-value');
    if (label && label.textContent !== cell.label) label.textContent = cell.label;
    if (value) {
      if (value.textContent !== cell.text) value.textContent = cell.text;
      // NONE, ON and a word are set small; a number, OFF and the dash keep the size a number has.
      const word = cell.state === 'none' || cell.state === 'on' || (cell.state === 'value' && /[A-Za-z]{3,}/.test(cell.text));
      value.classList.toggle('ctrl-value-fixed', word);
      value.classList.toggle('ctrl-value-wide', isWide(cell.text));
      value.classList.toggle('ctrl-value-long', isLong(cell.text));
    }
    el.classList.toggle('ctrl-hidden', !!cell.hidden);
    el.classList.toggle('ctrl-none', cell.state === 'none');
    el.classList.toggle('ctrl-off', cell.state === 'off');
    el.classList.toggle('ctrl-on', cell.state === 'on');
    el.classList.toggle('ctrl-unread', cell.state === 'unread' || cell.state === 'unknown');
    el.classList.toggle('ctrl-locked', !!cell.locked);
    el.classList.toggle('ctrl-omitted', !!omit);
    el.style.setProperty('--ctrl-pct', Math.round(cell.fill * 100) + '%');
  }

  // Up, down, or neither: by the numbers behind the texts, where both are numbers.
  function direction(before, cell) {
    if (cell.value === null || typeof before !== 'number') return 0;
    return cell.value > before ? 1 : cell.value < before ? -1 : 0;
  }

  function changed(cell, elementId, hooks, before) {
    if (typeof hooks.flash === 'function') hooks.flash(elementId);
    if (typeof hooks.announce === 'function') hooks.announce(cell.id, cell.value, direction(before, cell), cell.label, cell.text);
  }

  /** The panel as it was before there was a list: the classes and cells this module added are taken away. */
  function clear(panel, state) {
    if (panel) {
      panel.classList.remove('car-controls-listed', 'ctrl-fit', 'ctrl-compact');
      panel.style.removeProperty('--ctrl-cols');
      panel.removeAttribute('data-ctrl-rows');
      for (const el of Array.from(panel.querySelectorAll('.ctrl-item.ctrl-mode, .ctrl-more'))) el.remove();
      for (const [, id] of SLOTS) {
        const el = panel.ownerDocument.getElementById(id);
        if (!el) continue;
        el.classList.remove('ctrl-none', 'ctrl-off', 'ctrl-on', 'ctrl-locked', 'ctrl-unread', 'ctrl-omitted');
        const label = el.querySelector('.ctrl-label');
        if (label) label.textContent = LABELS[id === 'ctrlBB' ? 'bb' : id === 'ctrlTC' ? 'tc' : 'abs'];
        const value = el.querySelector('.ctrl-value');
        if (value) value.classList.remove('ctrl-value-wide', 'ctrl-value-long');
      }
    }
    if (state) { state.car = null; state.last = null; state.values = null; state.cc = null; }
  }

  const api = { KEY, LABELS, ROOM, read, view, arrange, signals, render, clear, textOf, fillOf, announced };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.RacingDeskCarControls = api;
})();
