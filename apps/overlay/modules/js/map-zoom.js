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
//   closer  r = R_WIDE − t · (R_WIDE − R_CLOSE)    t = clamp(speed / 120, 0, 1)    his ask, the default
//   wider   r = R_CLOSE + t · (R_WIDE − R_CLOSE)    t = clamp(speed / 75, 0, 1)    the map as it was until this setting
//   fixed   r = R_FIXED, the middle of the two (11.15): one view at every speed — new, not what the map was
// 'wider' is the old local view exactly, the curve it had for months (closest standing still, widest from 75 mph),
// so there is one setting that gives it back; 'fixed' is not that view, it is a third one. In 'closer' the radius is
// linear in his speed — the plain reading of "in relation to that speed change" — and at its closest from
// SPEED_MAX_MPH, 120 mph. It was 150 (2026-10-01), and he asked the next day to "zoom in faster on the HUD zoom map":
// in his newest recorded session (the 963 GTP at Bathurst, the sidecar's speeds) half his moving time was under
// 87 mph, a quarter over 119 and only a twentieth over 150, so the view sat at its closest a twentieth of the time and
// between the first and third quartiles of his speed (52 and 119 mph) it changed by 1.6 times. At 120 it is at its
// closest on every straight of every car he drives but the MX-5 (which tops out near it), and between those quartiles
// it changes by 2.1 times (11.9 units at 52 mph, 8.6 at 87, 5.6 from 120).
// The ease (`ease`, `follower`) is on the view's scale, not its radius — a zoom in and a zoom out of the same size
// take the same time, where in the radius a zoom out from the closest began with a kick — with a time constant TAU_S,
// 0.2 s: 63 % of a change in 0.2 s, 95 % in 0.6 s. It was 0.4 s in the radius: braking at 40 mph a second (the first
// percentile of that session's frames), the view was 16 mph behind his speed, and is 8 now. The
// speed itself is smooth (from one frame to the next it bends by 0.6 mph at the 99th percentile), so a short ease
// lets no noise through. What the ease cannot take out is a speed that changes in a frame — a reset to the pits, a
// tow, a crash into a wall (the sidecar has −728 mph a second), a frame with a bad speed — so the scale also changes
// by no more than MAX_RATE, e^1.5 (4.5 times) in a second: the whole range, three times, takes three-quarters of a
// second at the least, and a lone bad frame moves the view by 5 % at most. His hardest braking in that session (51 mph
// a second over half a second, resets left out) moves the target at 0.63 in that measure, so the cap holds back what
// is not driving and never his driving.
// A slow frame counts for no more than MAX_STEP_S, a tenth of a second, so one late frame (an iPad's Wi-Fi, a browser
// source in OBS) moves it by 16 % of its scale at most and the rest comes over the next frames, as the car's own
// position does; the step is never a jump. After RESTART_AFTER_S, two seconds, with no frame at all (the page was in
// the background, or he was out of the car) the radius it had belongs to a speed from long ago, and it starts again
// at the target: getting back in is not a zoom from wherever the view was left.
// The glance layout draws the road and the cars of this view at their pixel weights when the view is R_LINE_WEIGHTS
// across (the middle of the two bounds, R_FIXED) and in proportion to the zoom either side of it, as the rig's HUD
// draws them in the map's own units: a view twice as close draws the road twice as wide. It drew them at fixed pixels
// whatever the view, which on a straight made the closest view look exactly like the widest ("the iPad zoom map …
// doesn't zoom at all", 2026-10-02).
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
  const SPEED_MAX_MPH = 120;        // 'closer': the speed from which the view is at its closest (150 until 2026-10-02)
  const WIDER_MAX_MPH = 75;         // 'wider', the map as it was: the speed at which the view is at its widest
  const TAU_S = 0.2;                // the ease's time constant, on the view's scale (0.4 s, on the radius, until 2026-10-02)
  const MAX_RATE = 1.5;             // the most the view's scale changes in a second, as a natural log: e^1.5, 4.5 times
  const MAX_STEP_S = 0.1;           // the longest a single frame is allowed to count for
  const RESTART_AFTER_S = 2;        // a gap this long between frames starts the view afresh
  // The view at which the glance layout draws this map's road and cars at their pixel weights; closer in they are
  // drawn bigger and wider out smaller, in proportion, so that the zoom is seen (webgl-helpers.js).
  const R_LINE_WEIGHTS = R_FIXED;
  // The glance layout's following map (the iPad, the OBS pages, Ctrl+Shift+F) is closer than the rig's and drawn heavier.
  // He said on 2026-10-07: "iPad zoom map needs to fill its space better, it's mostly a small dot with narrow lines".
  // Its view is GLANCE_VIEW of the rig's at the same speed; its road and trail are GLANCE_WEIGHT times their pixel
  // weights and its cars GLANCE_DOT times (webgl-helpers.js, drive-view.css). The rig's HUD is unchanged.
  const GLANCE_VIEW = 0.7;
  const GLANCE_WEIGHT = 2;
  const GLANCE_DOT = 1.5;

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

  /**
   * The radius after dtSeconds of easing from `current` towards `target`: a first-order ease of the view's scale (the
   * log of the radius) with time constant TAU_S, which moves it by no more than MAX_RATE · dt. A current that is no
   * radius is the target; no time is no move.
   */
  function ease(current, target, dtSeconds) {
    if (typeof current !== 'number' || !Number.isFinite(current) || current <= 0) return target;
    const dt = typeof dtSeconds === 'number' && Number.isFinite(dtSeconds) && dtSeconds > 0 ? dtSeconds : 0;
    if (dt === 0) return current;
    const most = MAX_RATE * dt;
    const step = Math.log(target / current) * (1 - Math.exp(-dt / TAU_S));
    return current * Math.exp(Math.max(-most, Math.min(most, step)));
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
    KEY, MODES, DEFAULT, OPTIONS, R_CLOSE, R_WIDE, R_FIXED, SPEED_MAX_MPH, WIDER_MAX_MPH, TAU_S, MAX_RATE, MAX_STEP_S,
    RESTART_AFTER_S, R_LINE_WEIGHTS, GLANCE_VIEW, GLANCE_WEIGHT, GLANCE_DOT, modeOf, targetRadius, ease, follower, migrate, migrateFile,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.RacingDeskMapZoom = api;
})();
