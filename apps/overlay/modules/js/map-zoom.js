// The following map's zoom — the local view that follows his car (#zoomMapSvg in dashboard.html, drawn by
// webgl-helpers.js on the rig's HUD, in the glance layout, on the iPad and in the pages OBS draws) — as a function of
// his speed. He asked (2026-10-01): "include a zoom into my car on the following map that scales in with my speed
// increasing and out when it decreases, in relation to that speed change". Most dashboards go the other way (wider at
// speed, to see further ahead), so which way it goes is one setting, "Following map zoom" in Settings → Look
// (`followMapZoom` in overlay-settings.json): 'closer' — closer at speed, his ask and the default — 'wider', or 'fixed'.
// The setting reaches the iPad and the OBS pages through their display-settings allowlists (remote-server.js), and a
// settings file from before it is given 'closer' once (migrateFile, from main.js).
//
// The view is a radius in the map's own units (the outline is drawn in a 0–100 space; on the rig the view is 2r
// across with the car at its centre, in the glance layout 2r across by its cell's shape with the car two-thirds of
// the way down). The bounds are the two the local view has always had, so neither end is new on his rig:
//   R_CLOSE 5.6      the closest: an eleventh of the map across, the bend ahead and the cars beside him, never a blur
//   R_WIDE  50/3     the widest: a third of the map across, never the whole circuit (the full map beside it is that)
// and what each mode does between them:
//   closer  r = R_WIDE − t · (R_WIDE − R_CLOSE)    t = clamp(speed / 150, 0, 1)    his ask, the default
//   wider   r = R_CLOSE + t · (R_WIDE − R_CLOSE)    t = clamp(speed / 75, 0, 1)    the map as it was until this setting
//   fixed   r = R_FIXED, the middle of the two (11.15): one view at every speed — new, not what the map was
// 'wider' is the old local view exactly, the curve it had for months (closest standing still, widest from 75 mph),
// so there is one setting that gives it back; 'fixed' is not that view, it is a third one. In 'closer' the radius is
// linear in his speed up to 150 mph, a speed most of his cars reach on a straight and the fastest of them (the GTPs,
// and a GT3 down Le Mans' or Daytona's longest straights) pass, where the view stays at its closest: linear in the
// radius is the plain reading of "in relation to that speed change", and a ceiling any higher would leave the slower
// cars with a view that never gets close.
// The drawn radius follows the target with a first-order ease of time constant TAU_S, 0.4 s: 63 % of a step in 0.4 s,
// 90 % in 0.93 s, 99 % in 1.85 s — by the page's own clock. A slow frame counts for no more than MAX_STEP_S, a tenth
// of a second, so one late frame (an iPad's Wi-Fi, a browser source in OBS) moves it by about a fifth of what is left
// at most and the rest comes over the next frames, as the car's own position does; the step is never a jump. After
// RESTART_AFTER_S, two seconds, with no frame at all (the page was in the background) the radius it had belongs to
// a speed from long ago, and it starts again at the target. Telemetry noise of a mile an hour or two moves the target
// by less than a tenth of a unit, and the ease takes the rest out.
//
// Pure: runs in the page (window.RacingDeskMapZoom) and in Node (require) alike; nothing here touches the DOM.
(function () {
  'use strict';

  const KEY = 'followMapZoom';
  const MODES = Object.freeze(['closer', 'wider', 'fixed']);
  const DEFAULT = 'closer';
  // The choices as the desk shows them (modules/desk/settings-model.js).
  const OPTIONS = Object.freeze([['closer', 'Closer at speed'], ['wider', 'Wider at speed'], ['fixed', 'Fixed']]);

  const R_CLOSE = 5.6;
  const R_WIDE = 50 / 3;
  const R_FIXED = (R_CLOSE + R_WIDE) / 2;
  const SPEED_MAX_MPH = 150;        // 'closer': the speed at which the view is at its closest
  const WIDER_MAX_MPH = 75;         // 'wider', the map as it was: the speed at which the view is at its widest
  const TAU_S = 0.4;
  const MAX_STEP_S = 0.1;           // the longest a single frame is allowed to count for
  const RESTART_AFTER_S = 2;        // a gap this long between frames starts the view afresh

  /** The mode a setting's value means: one of MODES, else the default. */
  function modeOf(value) {
    return typeof value === 'string' && MODES.includes(value) ? value : DEFAULT;
  }

  /** The radius the view is heading for at this speed, in map units: a pure function of the speed and the mode. */
  function targetRadius(speedMph, mode) {
    const m = modeOf(mode);
    if (m === 'fixed') return R_FIXED;
    const s = typeof speedMph === 'number' && Number.isFinite(speedMph) ? speedMph : 0;
    if (m === 'wider') return R_CLOSE + Math.min(1, Math.max(0, s / WIDER_MAX_MPH)) * (R_WIDE - R_CLOSE);
    return R_WIDE - Math.min(1, Math.max(0, s / SPEED_MAX_MPH)) * (R_WIDE - R_CLOSE);
  }

  /** The radius after dtSeconds of easing from `current` towards `target`; a current that is no number is the target. */
  function ease(current, target, dtSeconds) {
    if (typeof current !== 'number' || !Number.isFinite(current)) return target;
    const dt = typeof dtSeconds === 'number' && Number.isFinite(dtSeconds) && dtSeconds > 0 ? dtSeconds : 0;
    if (dt === 0) return current;
    return current + (target - current) * (1 - Math.exp(-dt / TAU_S));
  }

  /**
   * The follower a page keeps: one radius, eased towards each frame's target by the clock the page hands it
   * (performance.now(), in ms). The first frame sets the radius outright. A frame counts for the time since the one
   * before it, at most MAX_STEP_S, so a late frame does not make the view jump; and after RESTART_AFTER_S with no
   * frame the radius starts again at the target (the page was in the background: what it held is from another speed).
   */
  function follower() {
    let radius = NaN;
    let lastMs = NaN;
    return {
      radius(speedMph, mode, nowMs) {
        const target = targetRadius(speedMph, mode);
        const now = typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : NaN;
        const gap = Number.isFinite(now) && Number.isFinite(lastMs) ? Math.max(0, (now - lastMs) / 1000) : 0;
        if (gap > RESTART_AFTER_S) radius = NaN;
        radius = Number.isFinite(radius) ? ease(radius, target, Math.min(MAX_STEP_S, gap)) : target;
        lastMs = now;
        return radius;
      },
      current() { return radius; },
      reset() { radius = NaN; lastMs = NaN; },
    };
  }

  /**
   * The settings with the key as this build reads it: a file from before the setting, or one with a value that is not
   * a mode, is given 'closer'. Returns { settings, changed, added }; `settings` is a new object, the one given is
   * left as it was.
   */
  function migrate(settings) {
    const input = settings !== null && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
    const next = { ...input };
    if (typeof next[KEY] === 'string' && MODES.includes(next[KEY])) return { settings: next, changed: false, added: [] };
    next[KEY] = DEFAULT;
    return { settings: next, changed: true, added: [KEY] };
  }

  /**
   * Migrate the file in place, through settings-file.js (atomic; a file that is there but unreadable is left as it is,
   * so nothing is written over what might still be recovered). Returns migrate's result with `state`.
   */
  function migrateFile(file, { settingsFile }) {
    const { settings, state } = settingsFile.read(file);
    if (state === 'unreadable') return { settings: {}, changed: false, added: [], state };
    const result = migrate(settings);
    if (result.changed) settingsFile.save(file, result.settings);
    return { ...result, state };
  }

  const api = {
    KEY, MODES, DEFAULT, OPTIONS, R_CLOSE, R_WIDE, R_FIXED, SPEED_MAX_MPH, WIDER_MAX_MPH, TAU_S, MAX_STEP_S, RESTART_AFTER_S,
    modeOf, targetRadius, ease, follower, migrate, migrateFile,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.RacingDeskMapZoom = api;
})();
