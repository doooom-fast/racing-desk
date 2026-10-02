// The car's controls as the host sends them (RacingDesk.Plugin.CarControls): what the car has, by the canonical list,
// and what each control reads now — None, Off, On, a value, the name of a position, or unread (the car has it and
// the sim is not saying what it reads) — with the car's own label for it. This module says what each cell of the
// controls panel shows, which cells the rig's panel has room for, and what the spotter says of DRS and push-to-pass;
// poll-engine.js draws it. Pure but for render(), so it runs in the unit tests as it does in the page.
//
// The rig's HUD (not the glance layout) shows a panel for every adjustment the car has — he asked for that on
// 2026-10-01: "show adjustment panels for every adjustment available for that car. Omit ones that are not on the car
// when there's no room". The panel is 240px wide and as tall as it has always been (the pedals under it lose nothing),
// so the room is a constant of the layout, not a measurement (arrange): a ladder of steps, each with more cells
// across or down and its type a size smaller, and a car takes the smallest step that holds its real controls. Only a
// control the car does not have (a None cell) is ever left out, and only where its slot would make a row of its own;
// every control the car has is shown, DRS and push-to-pass among them. A label that cannot be held whole on one line
// takes a second one (labelPlan) and is cut with an ellipsis only past that.
//
// Words, not capitals (he asked on 2026-10-02; modules/js/words.js): a cell is labelled in words where they fit —
// "Anti-lock", "Bias", "Traction", "Migration", "Front rollbar", "Traction slip" — from the car list's `words` for the
// control (the host sends them as `words`), else from the control's id where its meaning is the same in every car. A
// cell shows the longest form that fits whole at its size: the words, then for a rollbar "Rollbar" with a small F or R,
// then the car's own short label (TCLO, BBAL) — the fit-to-cell sizing shrinks each before the next is tried, and none
// is cropped. Every value is shown in sentence case (None, On, Off, Track), whatever sent it.
(function () {
  'use strict';

  const W = (typeof window !== 'undefined' && window.RacingDeskWords) || (typeof require === 'function' ? require('./words.js') : null);
  const sentenceCase = W ? W.sentenceCase : (t) => t;
  const labelCase = W ? W.labelCase : (t) => t;

  const KEY = 'RacingDesk.Plugin.CarControls';

  // What the three cells are called when the list has no label for them: the car's short form, the acronyms the dash
  // has always had (shown only where the words below do not fit).
  const LABELS = Object.freeze({ bb: 'BB', tc: 'TC', abs: 'ABS' });
  // The three in words, his own (2026-10-02): "for ABS: anti-lock, for bb: bias. for tc: traction".
  const WORDS = Object.freeze({ bb: 'Bias', tc: 'Traction', abs: 'Anti-lock' });
  // A control whose meaning is its id's in every car, in words, for a host that sends none (a SimHub plugin from before
  // the car list had words): "mig: migration. arb: rollbar".
  const ID_WORDS = Object.freeze({
    abs: 'Anti-lock', brakeBias: 'Bias', brakeMigration: 'Migration', arbFront: 'Front rollbar', arbRear: 'Rear rollbar',
  });
  // A rollbar that cannot have its words: "Rollbar" with a small mark for which end it is.
  const ROLLBAR = Object.freeze({ arbFront: 'F', arbRear: 'R' });
  // The three cells, in the panel's order, and the DOM ids they have always had.
  const SLOTS = Object.freeze([['bb', 'ctrlBB'], ['tc', 'ctrlTC'], ['abs', 'ctrlABS']]);
  const DASH = '—';

  // The room the rig's panel has (leaderboard.css, .car-controls.ctrl-fit): the panel is as tall as it has always been
  // (the pedals under it lose nothing), and what it holds is a ladder of steps, each more cells across or down than the
  // one before and its type a size down: the full size, three across in one row and then two; the compact size, four
  // across in two; the tight size, three rows of four and then of five. A car takes the smallest step that holds its
  // real controls. Past the last the cells go on across in three rows, so none is ever left out.
  const ROOM = Object.freeze({
    steps: Object.freeze([
      Object.freeze({ cols: 3, rows: 1, size: 'full' }),
      Object.freeze({ cols: 3, rows: 2, size: 'full' }),
      Object.freeze({ cols: 4, rows: 2, size: 'compact' }),
      Object.freeze({ cols: 4, rows: 3, size: 'tight' }),
      Object.freeze({ cols: 5, rows: 3, size: 'tight' }),
    ]),
  });

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

  // The words of the three states that are words, whatever case the host wrote them in (a plugin from before this
  // change sends NONE, ON and OFF).
  const STATE_WORDS = Object.freeze({ none: 'None', on: 'On', off: 'Off' });

  /**
   * What a reading shows: the host's text in sentence case (None, On, Off, a position's name: Track, MDM), or its
   * number, or a dash for one that says nothing (unread among them).
   */
  function textOf(r) {
    if (!r || r.state === 'unread') return DASH;
    if (typeof r.text === 'string' && r.text) {
      // A state's own word; a text that is something else (push-to-pass off with its seconds left) is that.
      const word = STATE_WORDS[r.state];
      if (word && r.text.toLowerCase() === word.toLowerCase()) return word;
      return sentenceCase(r.text);
    }
    const n = number(r.value);
    return n === null ? DASH : String(n);
  }

  /**
   * A control's names, longest first: its words (the host's, from the car list; else the id's where its meaning is
   * the same in every car; else for one of the three, his words for it when the car's label is the generic one), then
   * for a rollbar "Rollbar" with a small F or R, then its short label as the car shows it. `label` is the short one.
   */
  function namesOf(r, id, slot) {
    const raw = (typeof r.label === 'string' && r.label) || (slot ? LABELS[slot] : '') || (id === 'drs' ? 'DRS' : id === 'p2p' ? 'P2P' : id);
    const label = labelCase(raw);
    let words = typeof r.words === 'string' && r.words.trim() ? r.words.trim() : null;
    if (!words && ID_WORDS[id] && !(id === 'abs' && raw !== 'ABS')) words = ID_WORDS[id];
    if (!words && slot && (raw === LABELS[slot] || !r.label)) words = WORDS[slot];
    if (!words && id === 'p2p' && raw === 'P2P') words = 'Push to pass';
    if (words === label) words = null;
    return { label, words, mark: ROLLBAR[id] || null };
  }

  /** The forms a cell's label may take, longest first: [{ text, mark }]. */
  function formsOf(cell) {
    const forms = [];
    if (cell.words) forms.push({ text: cell.words, mark: null });
    if (cell.mark && cell.words) forms.push({ text: 'Rollbar', mark: cell.mark });
    forms.push({ text: cell.label, mark: null });
    return forms;
  }

  /**
   * How full a cell's bar is, 0 to 1: the host's, or the bar the HUD always drew for the three. A position with a
   * name of its own (MDM, Track) is not a quantity, so the number behind it does not fill a bar.
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

  /** The value in a spotter's card: the text as shown (in sentence case), or the number. */
  function announced(r) {
    const n = number(r && r.value);
    return typeof (r && r.text) === 'string' && r.text ? sentenceCase(r.text) : n === null ? '' : String(n);
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
      if (!r) return { id: slot, el, slot, label: LABELS[slot], words: WORDS[slot], mark: null, text: DASH, state: 'unknown', fill: 0, hidden: false, locked: false, value: null };
      const mode = r.state === 'mode';
      return {
        id: slot, el, slot,
        ...namesOf(r, slot === 'bb' ? 'brakeBias' : slot, slot),
        text: mode ? DASH : textOf(r),
        state: mode ? 'mode' : stateOf(r),
        fill: fillOf(r, slot),
        hidden: mode,
        locked: !!r.locked,
        value: number(r.value),
        by: mode && typeof r.by === 'string' ? labelCase(r.by) : null,
      };
    });

    const modes = [], more = [];
    for (const m of Array.isArray(cc.more) ? cc.more : []) {
      const cell = {
        id: m.id,
        ...namesOf(m, m.id, null),
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
        ...namesOf(r, slot, null),
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
   *   { cols, rows, compact, tight, shown: [keys], omitted: [keys] }
   *
   * Every control the car has is shown: the smallest step of the room that holds the car's real cells is taken (more
   * across, a type a step down, a third row), and past the last step the cells go on across, so nothing the car has is
   * ever left out. A None cell (the car has none) fills only a slot that is left in the rows the real cells need, so it
   * never makes a row, and is omitted when there is none. A cell a mode hides takes no slot.
   */
  function arrange(v, room) {
    const steps = (room && room.steps) || ROOM.steps;
    const cells = [];
    v.primary.forEach((c) => { if (!c.hidden) cells.push({ key: c.slot, none: c.state === 'none' }); });
    v.modes.forEach((c, i) => cells.push({ key: 'mode' + (i || ''), none: false }));
    v.more.forEach((c) => cells.push({ key: c.id, none: c.state === 'none' }));

    const real = cells.filter((c) => !c.none);
    const none = cells.filter((c) => c.none);
    let step = steps.find((s) => s.rows * s.cols >= real.length);
    if (!step) {
      // Past the last step: as many across as the rows it ends in need, in its type.
      const last = steps[steps.length - 1];
      step = { cols: Math.ceil(real.length / last.rows), rows: last.rows, size: last.size };
    }
    // The slots a None cell may take are the ones left in the rows the real cells need, never a row of its own.
    const realRows = Math.max(1, Math.ceil(real.length / step.cols));
    const slots = Math.max(real.length, Math.min(step.rows, realRows) * step.cols);

    const shown = real.map((c) => c.key);
    for (const c of none) { if (shown.length >= slots) break; shown.push(c.key); }

    const rows = Math.max(1, Math.min(step.rows, Math.ceil(shown.length / step.cols)));
    const cols = Math.max(1, Math.min(step.cols, Math.ceil(shown.length / rows)));
    const isShown = new Set(shown);
    return {
      cols, rows,
      compact: step.size !== 'full',
      tight: step.size === 'tight',
      shown,
      omitted: cells.filter((c) => !isShown.has(c.key)).map((c) => c.key),
    };
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
      // In words where the host gave them (the SF23's OT is "Overtake"), else the car's own label, else "Push to pass".
      const names = namesOf(next.p2p, 'p2p', null);
      const label = names.words || names.label;
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
    if (glance) {
      // The glance layout is as it was before every adjustment had a cell (he asked for that on the desktop HUD alone):
      // a mode or another control the sim is not reporting is not in its row, as when the host left such a one out.
      v.modes = v.modes.filter((c) => c.state !== 'unread');
      v.more = v.more.filter((c) => c.state !== 'unread');
    }
    const fit = glance ? null : arrange(v);
    const omitted = new Set(fit ? fit.omitted : []);

    panel.classList.add('car-controls-listed');
    panel.classList.remove('no-adj');

    for (const cell of v.primary) {
      const el = doc.getElementById(cell.el);
      if (!el) continue;
      draw(el, cell, omitted.has(cell.slot), fit);
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
      draw(el, cell, omitted.has(key), fit);
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
        drawLabel(label, cell, fit, el);
        if (value.textContent !== cell.text) value.textContent = cell.text;
        el.style.setProperty('--ctrl-value-len', String(Math.max(1, String(cell.text || '').length)));
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
          if (typeof hooks.announce === 'function') hooks.announce(cell.id, cell.value, direction(lastValues[cell.id], cell), spoken(cell), cell.text);
        }
      });
    }

    // The glance layout's labels, measured in their cells: each the longest form that is whole there.
    if (glance) fitGlance(panel, state);
    else state.glanceSig = null;

    // What the room rule decided, for the stylesheet: the cells across, the rows down (the panel takes more of its
    // column for two), and the compact type. In the glance layout none of it.
    panel.classList.toggle('ctrl-fit', !!fit);
    panel.classList.toggle('ctrl-compact', !!fit && fit.compact);
    panel.classList.toggle('ctrl-tight', !!fit && fit.tight);
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

  // A value that is a word (None, On, Off, Track, Automatic) and not a number: set small, as the three have always had it.
  const isWord = (cell) => cell.state === 'none' || cell.state === 'on' || cell.state === 'off' || (cell.state === 'value' && /[A-Za-z]{3,}/.test(cell.text));
  // Text wider than a cell at its size (leaderboard.css): a number of five characters (48.25) is set a step down,
  // and a word of seven letters or more (Automatic), or a number of six (-10.25), smaller still.
  const isNumber = (text) => /^-?[\d.]+$/.test(text);
  const isWide = (text) => typeof text === 'string' && isNumber(text) && text.length === 5;
  const isLong = (text) => typeof text === 'string' && (/[A-Za-z]{7,}/.test(text) || (isNumber(text) && text.length >= 6));
  // How many characters wide a cell's label is, for the stylesheet to set it no larger than its cell holds on the rig
  // (--ctrl-label-len: Brake bias three across, TC toggle four across); the lock mark is two more. Past the smallest
  // size the label is cut with an ellipsis. A long value (Automatic) is sized the same way (--ctrl-value-len).
  const labelLength = (cell) => Math.max(1, String(cell.label || '').length + (cell.locked ? 2 : 0));

  // What a label of the rig's panel needs to be shown whole: how wide it is (the characters of its longest line, for
  // --ctrl-label-len) and whether it takes a second line. The cell's width is the panel's (PANEL_W, the stylesheet's
  // 240px) less the gaps, shared by the cells across, less the cell's border and padding; a label is set as large as
  // that holds it, up to its size's own (LABEL.base) and down to LABEL_FLOOR px. EM is the width of a character of the
  // label in em: Sofia Pro Comp at weight 600 with its tracking measures 0.34 to 0.53 across the car list's labels, and
  // 0.47 at the most for any of seven characters or more (the page's font is that one, not the fallback, which is half
  // as wide again), so 0.5 holds every one with a little over. A label that would be set under WRAP_BELOW px on one
  // line is broken into two where the words let it, at the split that makes the wider line narrowest, and is then set
  // to the width of that line; one word, or a label two lines do not help, stays on one.
  const PANEL_W = 240;
  const LABEL = Object.freeze({
    full:    Object.freeze({ base: 10, padX: 4, gap: 4 }),
    compact: Object.freeze({ base: 9,  padX: 3, gap: 4 }),
    tight:   Object.freeze({ base: 8,  padX: 2, gap: 2 }),
  });
  const LABEL_FLOOR = 7, WRAP_BELOW = 8, EM = 0.5, BORDER = 1;
  function labelPlan(label, locked, fit) {
    const text = String(label || '');
    const len1 = Math.max(1, text.length + (locked ? 2 : 0));
    if (!fit) return { len: len1, lines: 1 };
    const t = LABEL[fit.tight ? 'tight' : fit.compact ? 'compact' : 'full'];
    const cols = Math.max(1, fit.cols || 1);
    const inner = (PANEL_W - (cols - 1) * t.gap) / cols - 2 * BORDER - 2 * t.padX;
    const oneLine = Math.min(t.base, inner / (len1 * EM));
    const words = text.split(/\s+/).filter(Boolean);
    if (oneLine >= WRAP_BELOW || words.length < 2) return { len: len1, lines: 1 };
    let best = Infinity;
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(' ').length;
      const b = words.slice(i).join(' ').length + (locked ? 2 : 0);
      best = Math.min(best, Math.max(a, b));
    }
    return best < len1 ? { len: Math.max(1, best), lines: 2 } : { len: len1, lines: 1 };
  }

  // The width a cell of the rig's panel gives its label, by the room rule's step (labelPlan's arithmetic).
  function labelRoom(fit) {
    const t = LABEL[fit.tight ? 'tight' : fit.compact ? 'compact' : 'full'];
    const cols = Math.max(1, fit.cols || 1);
    return (PANEL_W - (cols - 1) * t.gap) / cols - 2 * BORDER - 2 * t.padX;
  }

  // A form of a label as the stylesheet sets it: its text, with the rollbar's mark as a character and a space.
  const formText = (form) => (form.mark ? form.text + ' ' + form.mark : form.text);

  /**
   * Whether a label is shown whole in a cell of the rig's panel: set on one line or two (labelPlan), at no less than
   * LABEL_FLOOR px, with no ellipsis. Always true outside the rig's room rule (the glance layout measures instead).
   */
  function fitsWhole(text, locked, fit) {
    if (!fit) return true;
    const plan = labelPlan(text, locked, fit);
    return labelRoom(fit) / (plan.len * EM) >= LABEL_FLOOR - 1e-9;
  }

  /**
   * The form of a cell's label the rig's panel shows: the longest that is whole at its size — the words, then a
   * rollbar's "Rollbar" with its mark, then the car's short label (which is shown whatever, with an ellipsis past the
   * floor as before). In the glance layout, the first: the page measures it there (fitGlance).
   */
  function chooseForm(cell, fit) {
    const forms = formsOf(cell);
    if (!fit) return forms[0];
    for (const form of forms) if (fitsWhole(formText(form), cell.locked, fit)) return form;
    // None is whole by the arithmetic (which allows for the widest letters): the one that needs the least width, the
    // longer form where two need the same, as the stylesheet then sets it down to its floor.
    let best = forms[0], least = Infinity;
    for (const form of forms) {
      const len = labelPlan(formText(form), cell.locked, fit).len;
      if (len < least) { least = len; best = form; }
    }
    return best;
  }

  // Writes a form into a label: its text, and a rollbar's mark as a small letter after it. Only when it changed.
  function writeLabel(label, form) {
    const key = form.text + '\u0001' + (form.mark || '');
    if (label.__rdLabel === key) return;
    label.__rdLabel = key;
    if (!form.mark) { label.textContent = form.text; return; }
    label.textContent = form.text + ' ';
    const mark = label.ownerDocument.createElement('span');
    mark.className = 'ctrl-mark';
    mark.textContent = form.mark;
    label.appendChild(mark);
  }

  // A cell's label as the rig or the glance layout shows it: the form, the length the stylesheet sizes it by, and
  // whether it takes two lines. The forms are kept on the element for the glance layout's measuring.
  function drawLabel(label, cell, fit, holder) {
    const forms = formsOf(cell);
    const sig = forms.map(formText).join('/');
    // On the rig, by the room rule's arithmetic; in the glance layout, what was measured for these forms, or the first
    // until it has been (fitGlance, at the end of the frame).
    const form = fit ? chooseForm(cell, fit) : label.__rdGlanceSig === sig && label.__rdGlanceForm ? label.__rdGlanceForm : forms[0];
    writeLabel(label, form);
    label.__rdForms = forms;
    label.__rdSig = sig;
    const plan = labelPlan(formText(form), cell.locked, fit);
    label.classList.toggle('ctrl-label-2l', plan.lines === 2);
    holder.style.setProperty('--ctrl-label-len', String(plan.len));
  }

  /**
   * The glance layout (no room rule: the cells are its grid's) shows each label in the longest form that is whole in
   * its cell, measured: the words first, and a shorter form for one that is cut. Measured when the forms change, when
   * the panel is resized, and when a font arrives (the iPad's face comes from Adobe after the page has drawn) — not
   * on every frame.
   */
  function fitGlance(panel, state) {
    const labels = Array.from(panel.querySelectorAll('.ctrl-label, .ctrl-mini-label')).filter((l) => Array.isArray(l.__rdForms));
    const sig = labels.map((l) => l.__rdSig).join('|');
    if (!panel.__rdWatched && typeof ResizeObserver === 'function') {
      panel.__rdWatched = true;
      new ResizeObserver(() => { panel.__rdRefit = true; }).observe(panel);
      const fonts = panel.ownerDocument.fonts;
      if (fonts && typeof fonts.addEventListener === 'function') fonts.addEventListener('loadingdone', () => { panel.__rdRefit = true; });
    }
    if (state.glanceSig === sig && !panel.__rdRefit) return;
    panel.__rdRefit = false;
    state.glanceSig = sig;
    // The room is the cell's, inside its padding (a small cell's label is not clipped by the cell, so its own box says
    // nothing of whether it fits). A cell of the row under the three is as wide as what it holds, and shares what the
    // row has left over (drive-view.css), so a label made shorter gives the others room: every label at its words, then
    // one at a time the label that runs furthest past its cell is given its next form, until every label is whole or
    // none that is not has a shorter form left — a few layouts, and only when something changed.
    // Widths to the fraction of a pixel: the text's own (a range over it, whatever its box is clipped to) and the cell's
    // inside its padding and border.
    const doc = panel.ownerDocument;
    const range = doc.createRange();
    const widthOf = (l) => { range.selectNodeContents(l); return range.getBoundingClientRect().width; };
    const room = (l) => {
      const cell = l.parentElement;
      const cs = doc.defaultView.getComputedStyle(cell);
      const edges = ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce((s, k) => s + (parseFloat(cs[k]) || 0), 0);
      return cell.getBoundingClientRect().width - edges;
    };
    const over = (l) => widthOf(l) - room(l);
    const inRow = (l) => !!l.closest('.ctrl-more');
    const at = new Map(labels.map((l) => [l, 0]));
    const last = (l) => at.get(l) + 1 >= l.__rdForms.length;
    const step = (l) => { at.set(l, at.get(l) + 1); writeLabel(l, l.__rdForms[at.get(l)]); };
    for (const l of labels) writeLabel(l, l.__rdForms[0]);
    for (let n = 0; n < 64; n++) {
      let worst = null, most = 0.5;
      for (const l of labels) {
        if (last(l)) continue;
        const by = over(l);
        if (by > most) { most = by; worst = l; }
      }
      if (!worst) break;
      step(worst);
    }
    // A label of the row under the three still past its cell at its last form: a shorter form of another label of the
    // row gives it room, the widest of them first, while there is one.
    for (let n = 0; n < 64; n++) {
      if (!labels.some((l) => inRow(l) && last(l) && over(l) > 0.5)) break;
      let widest = null, most = -1;
      for (const l of labels) {
        if (!inRow(l) || last(l)) continue;
        const w = widthOf(l);
        if (w > most) { most = w; widest = l; }
      }
      if (!widest) break;
      step(widest);
    }
    // A label past its cell still, where no form of it is whole (a row of more cells than an iPad has the width for):
    // the narrowest of its forms, as the glance layout has always let a label run past a cell too small for it.
    for (const l of labels) {
      if (l.__rdForms.length < 2 || over(l) <= 0.5) continue;
      let best = at.get(l), least = widthOf(l);
      for (let i = 0; i < l.__rdForms.length; i++) {
        if (i === at.get(l)) continue;
        writeLabel(l, l.__rdForms[i]);
        const w = widthOf(l);
        if (w < least - 0.01) { least = w; best = i; }
      }
      at.set(l, best);
      writeLabel(l, l.__rdForms[best]);
    }
    for (const l of labels) {
      l.__rdGlanceForm = l.__rdForms[at.get(l)];
      l.__rdGlanceSig = l.__rdSig;
    }
  }

  // One of the three, or a mode: the label, the text, the bar, and the classes the styles go by.
  function draw(el, cell, omit, fit) {
    const label = el.querySelector('.ctrl-label');
    const value = el.querySelector('.ctrl-value');
    if (label) drawLabel(label, cell, fit, el);
    if (value) {
      if (value.textContent !== cell.text) value.textContent = cell.text;
      // None, On and a word are set small; a number, Off and the dash keep the size a number has.
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
    el.style.setProperty('--ctrl-value-len', String(Math.max(1, String(cell.text || '').length)));
  }

  // Up, down, or neither: by the numbers behind the texts, where both are numbers.
  function direction(before, cell) {
    if (cell.value === null || typeof before !== 'number') return 0;
    return cell.value > before ? 1 : cell.value < before ? -1 : 0;
  }

  // What the spotter calls a control: its words (a card has the room), else its short label.
  const spoken = (cell) => cell.words || cell.label;

  function changed(cell, elementId, hooks, before) {
    if (typeof hooks.flash === 'function') hooks.flash(elementId);
    if (typeof hooks.announce === 'function') hooks.announce(cell.id, cell.value, direction(before, cell), spoken(cell), cell.text);
  }

  /** The panel as it was before there was a list: the classes and cells this module added are taken away. */
  function clear(panel, state) {
    if (panel) {
      panel.classList.remove('car-controls-listed', 'ctrl-fit', 'ctrl-compact', 'ctrl-tight');
      panel.style.removeProperty('--ctrl-cols');
      panel.removeAttribute('data-ctrl-rows');
      for (const el of Array.from(panel.querySelectorAll('.ctrl-item.ctrl-mode, .ctrl-more'))) el.remove();
      for (const [, id] of SLOTS) {
        const el = panel.ownerDocument.getElementById(id);
        if (!el) continue;
        el.classList.remove('ctrl-none', 'ctrl-off', 'ctrl-on', 'ctrl-locked', 'ctrl-unread', 'ctrl-omitted');
        el.style.removeProperty('--ctrl-label-len');
        el.style.removeProperty('--ctrl-value-len');
        const label = el.querySelector('.ctrl-label');
        if (label) {
          // The panel as it was before the list, in words: Bias, Traction, Anti-lock (dashboard.html has the same).
          label.textContent = WORDS[id === 'ctrlBB' ? 'bb' : id === 'ctrlTC' ? 'tc' : 'abs'];
          label.__rdLabel = undefined;
          label.__rdForms = undefined;
          label.__rdGlanceForm = undefined;
          label.classList.remove('ctrl-label-2l');
        }
        const value = el.querySelector('.ctrl-value');
        if (value) value.classList.remove('ctrl-value-wide', 'ctrl-value-long');
      }
    }
    if (state) { state.car = null; state.last = null; state.values = null; state.cc = null; state.glanceSig = null; }
  }

  const api = {
    KEY, LABELS, WORDS, ID_WORDS, ROOM, LABEL, LABEL_FLOOR, read, view, arrange, labelPlan, fitsWhole, chooseForm, formsOf,
    signals, render, clear, textOf, fillOf, announced,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.RacingDeskCarControls = api;
})();
