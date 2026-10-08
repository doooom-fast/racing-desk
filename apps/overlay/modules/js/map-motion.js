// The two maps between the data frames, and the start/finish tick across the road — the parts of them that need no
// DOM (window.RacingDeskMapMotion, drawn by webgl-helpers.js updateTrackMap / animateTrackMap).
//
// Why. The page draws only when a new frame of telemetry arrives, about thirty a second (poll-engine.js _rafLoop). On
// the rig's HUD that is how it has always been; in the glance layout (the iPad, /obs-ipad, Ctrl+Shift+F) the following
// map is drawn 30 % closer than the rig's (map-zoom.js GLANCE_VIEW), so a frame moves the car further on the screen and
// the map visibly steps. He said on 2026-10-07: "the animations don't seem as smooth as they used to be" (the iPad and
// OBS), and, offered the map animated between the updates: "yes". So in the glance layout the maps' moving parts —
// the car's dot, the following map's view (its centre, its turn, its size), the other cars' dots and the trail behind
// the car — are drawn at the display's rate between the last two frames the page has: the usual "render one frame
// late". A step is shown over one data interval, from where the picture was to the newest frame, so it is always between
// two places the page knows and never past the newest one; a frame that is late leaves the picture at the newest place
// until it comes (nothing is guessed ahead of the data).
//
// What moves how.
//   - Places on the page's x/y (the car, the other cars): a straight line between the two, which on a closed outline
//     has no seam at the start/finish line (the host places every car on the whole loop, the line included).
//   - Where the car is on the outline (the trail's head): the outline's own point index, with a fraction, the page's
//     stand-in for LapDistPct (the outline has three points to each bin of the lap, evenly). Round the loop the short way:
//     from 239.6 to 0.4 on an outline of 240 points is a step of 0.8 points forward over the line, and not 239 back.
//   - Headings: by the shortest way round, 350° to 10° is 20° and not 340°.
//   - A jump is not a slide: a reset, a tow, a car that was not there or is in the pits now, a step longer than a car
//     drives in a data interval (JUMP_LAP_FRACTION of the lap, as the trail's own teleport rule has it), or a frame after
//     a stall (STALL_MS with none) is drawn where it is, at once.
// The zoom's own ease (map-zoom.js) is not touched: the radius it gives for each frame is one of the two ends of a step.
//
// Pure: runs in the page and in Node (require) alike; nothing here touches the DOM.
(function () {
  'use strict';

  const FIRST_INTERVAL_MS = 33;       // the step's length until two frames have been seen: the poll is every 33 ms
  const MIN_INTERVAL_MS = 12;         // a step is shown over no less than this, and no more than the next
  const MAX_INTERVAL_MS = 100;
  const INTERVAL_EASE = 0.2;          // the step's length follows the frames' own spacing, a fifth of the way a frame
  const STALL_MS = 250;               // a gap this long between frames: the picture was still, the new frame is a jump
  const JUMP_LAP_FRACTION = 0.02;     // a car does not drive a fiftieth of the lap in a data interval (webgl-helpers.js _TRAIL_TELEPORT_LAP_FRACTION)
  // The start/finish tick's direction is read over this share of the lap either side of the line (and never over less
  // than SF_MIN_POINTS of the outline's points): a short chord, which on a bend is parallel to the road at the line.
  const SF_SPAN = 0.003;
  const SF_MIN_POINTS = 1.5;

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  /** A position on a loop of length n (a point index with a fraction, an angle with n 360), a → b by t the short way round; in [0, n). */
  function lerpAround(a, b, t, n) {
    let d = b - a;
    if (d > n / 2) d -= n;
    else if (d < -n / 2) d += n;
    const r = (a + d * t) % n;
    return r < 0 ? r + n : r;
  }
  /** A heading in degrees, a → b by t the shortest way round: in [0, 360). */
  const lerpAngle = (a, b, t) => lerpAround(a, b, t, 360);
  /** The step from a to b round a loop of length n, the short way: in (−n/2, n/2]. */
  function stepAround(a, b, n) {
    let d = b - a;
    if (d > n / 2) d -= n;
    else if (d <= -n / 2) d += n;
    return d;
  }

  /**
   * The clock a page keeps for its steps: told when each data frame arrives (`frame`), it says how far through the
   * step to the newest one the page is (`phase`, 0 at the frame, 1 one data interval later and held there). The
   * interval is the frames' own spacing, eased and held between MIN_INTERVAL_MS and MAX_INTERVAL_MS.
   */
  function createClock() {
    let last = NaN;
    let interval = FIRST_INTERVAL_MS;
    return {
      /**
       * A data frame arrived at nowMs. False for the first, and for one after a stall: not to be slid to.
       */
      frame(nowMs) {
        const gap = nowMs - last;
        last = nowMs;
        if (!(gap >= 0) || gap > STALL_MS) return false;
        interval += (clamp(gap, MIN_INTERVAL_MS, MAX_INTERVAL_MS) - interval) * INTERVAL_EASE;
        return true;
      },
      /** How far through the step the page is at nowMs: 0 to 1; 1 before any frame. */
      phase(nowMs) {
        if (!Number.isFinite(last)) return 1;
        return clamp((nowMs - last) / interval, 0, 1);
      },
      interval() { return interval; },
      reset() { last = NaN; },
    };
  }

  /** Whether the step from (x0, y0) to (x1, y1) is longer than `limit` map units: a jump, not a drive. */
  function jumped(x0, y0, x1, y1, limit) {
    return Math.hypot(x1 - x0, y1 - y0) > limit;
  }

  /** The length of a closed polyline, in the map's units (a last point that repeats the first adds nothing). */
  function loopLength(coords) {
    const n = coords ? coords.length : 0;
    let total = 0;
    for (let i = 0; i < n; i++) {
      const a = coords[i], b = coords[(i + 1) % n];
      total += Math.hypot(b.x - a.x, b.y - a.y);
    }
    return total;
  }

  /**
   * The way the road runs at the outline's first point (the start/finish line, LapDistPct 0), in degrees, as SVG's
   * rotate() takes it: 0 is towards +x, and a quarter turn is towards +y (down the screen). The direction of a short
   * chord across the point — from the point a way before it to the point as far after it, along the outline, wrapping
   * past the end of the closed loop — SF_SPAN of the lap each way, and at least SF_MIN_POINTS of the outline's points.
   * A vertical line rotated by this angle is across the road. 0 for an outline too short to have a direction.
   */
  function startFinishAngle(coords) {
    if (!coords || coords.length < 3) return 0;
    // The loop's own points: a last point that repeats the first (a curve that closes) is the same point once.
    let n = coords.length;
    const first = coords[0], tail = coords[n - 1];
    if (n > 3 && Math.hypot(tail.x - first.x, tail.y - first.y) < 1e-9) n--;
    const cum = new Array(n + 1);
    cum[0] = 0;
    for (let i = 0; i < n; i++) {
      const a = coords[i], b = coords[(i + 1) % n];
      cum[i + 1] = cum[i] + Math.hypot(b.x - a.x, b.y - a.y);
    }
    const perimeter = cum[n];
    if (!(perimeter > 0)) return 0;
    const h = Math.max(SF_SPAN * perimeter, SF_MIN_POINTS * (perimeter / n));
    // The point s along the loop from the first point, s taken round the loop (negative: back from the end).
    const at = (s) => {
      let d = s % perimeter;
      if (d < 0) d += perimeter;
      let i = 0;
      while (i < n - 1 && cum[i + 1] <= d) i++;
      const a = coords[i], b = coords[(i + 1) % n];
      const len = cum[i + 1] - cum[i];
      const f = len > 0 ? (d - cum[i]) / len : 0;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    };
    const before = at(-h), after = at(h);
    const dx = after.x - before.x, dy = after.y - before.y;
    if (dx === 0 && dy === 0) return 0;
    return (Math.atan2(dy, dx) * 180) / Math.PI;
  }

  const api = {
    FIRST_INTERVAL_MS, MIN_INTERVAL_MS, MAX_INTERVAL_MS, INTERVAL_EASE, STALL_MS, JUMP_LAP_FRACTION, SF_SPAN, SF_MIN_POINTS,
    lerp, lerpAround, lerpAngle, stepAround, createClock, jumped, loopLength, startFinishAngle,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.RacingDeskMapMotion = api;
})();
