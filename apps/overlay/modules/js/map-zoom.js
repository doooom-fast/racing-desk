// The following map's zoom — the local view that follows his car (#zoomMapSvg in dashboard.html, drawn by
// webgl-helpers.js on the rig's HUD, in the glance layout, on the iPad and in the pages OBS draws) — as a function of
// his speed. He asked (2026-10-01): "include a zoom into my car on the following map that scales in with my speed
// increasing and out when it decreases, in relation to that speed change". Most dashboards go the other way (wider at
// speed, to see further ahead), so which way it goes is one setting, "Following map zoom" in Settings → Look
// (`followMapZoom` in overlay-settings.json): 'closer' — closer at speed, his ask and the default — 'wider', or 'fixed',
// one view at every speed. The setting reaches the iPad and the OBS pages through their display-settings allowlists
// (remote-server.js), and a settings file from before it is given 'closer' once (migrateFile, from main.js).
//
// The view is a radius in the map's own units (the outline is drawn in a 0–100 space; on the rig the view is 2r
// across with the car at its centre, in the glance layout 2r across by its cell's shape with the car two-thirds of
// the way down). The bounds are the two the local view has always had, so neither end is new on his rig:
//   R_CLOSE 5.6   the closest: an eleventh of the map across, the bend ahead and the cars beside him, never a blur
//   R_WIDE  16.7  the widest: a third of the map across, never the whole circuit (the full map beside it is that)
// Between them the radius is linear in his speed from 0 to SPEED_MAX_MPH, 150 mph — the top of what his cars do, so
// the view goes on changing the whole way up a straight (the old curve stopped at 75) — and clamped beyond:
//   closer  r = R_WIDE  − t · (R_WIDE − R_CLOSE)    t = clamp(speed / 150, 0, 1)
//   wider   r = R_CLOSE + t · (R_WIDE − R_CLOSE)
//   fixed   r = R_FIXED, the middle of the two (11.15)
// The drawn radius follows the target with a first-order ease of time constant TAU_S, 0.4 s: 63 % of a step in 0.4 s,
// 90 % in 0.93 s, 99 % in 1.85 s — by the page's own clock, so a slow frame moves it as far as the time says and no
// further, and a step is never a jump. Telemetry noise of a mile an hour or two moves the target by less than a tenth
// of a unit, and the ease takes the rest out.
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
  const R_WIDE = 16.7;
  const R_FIXED = (R_CLOSE + R_WIDE) / 2;
  const SPEED_MAX_MPH = 150;
  const TAU_S = 0.4;

  /** The mode a setting's value means: one of MODES, else the default. */
  function modeOf(value) {
    return typeof value === 'string' && MODES.includes(value) ? value : DEFAULT;
  }

  /** The radius the view is heading for at this speed, in map units: a pure function of the speed and the mode. */
  function targetRadius(speedMph, mode) {
    const m = modeOf(mode);
    if (m === 'fixed') return R_FIXED;
    const s = typeof speedMph === 'number' && Number.isFinite(speedMph) ? speedMph : 0;
    const t = Math.min(1, Math.max(0, s / SPEED_MAX_MPH));
    return m === 'closer' ? R_WIDE - t * (R_WIDE - R_CLOSE) : R_CLOSE + t * (R_WIDE - R_CLOSE);
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
   * (performance.now(), in ms). The first frame sets the radius outright; a frame after a pause eases over a second at
   * most, so a page that was in the background does not jump when it comes back.
   */
  function follower() {
    let radius = NaN;
    let lastMs = NaN;
    return {
      radius(speedMph, mode, nowMs) {
        const target = targetRadius(speedMph, mode);
        const now = typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : NaN;
        const dt = Number.isFinite(now) && Number.isFinite(lastMs) ? Math.min(1, Math.max(0, (now - lastMs) / 1000)) : 0;
        radius = Number.isFinite(radius) ? ease(radius, target, dt) : target;
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

  const api = { KEY, MODES, DEFAULT, OPTIONS, R_CLOSE, R_WIDE, R_FIXED, SPEED_MAX_MPH, TAU_S, modeOf, targetRadius, ease, follower, migrate, migrateFile };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.RacingDeskMapZoom = api;
})();
