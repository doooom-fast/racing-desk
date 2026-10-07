// The live gap to his own laps: what the HUD's delta says, on the rig and on the iPad alike.
//
// The plugin's RacingDesk.Plugin.DS.LapDelta is iRacing's LapDeltaToBestLap, and iRacing measures that against his best
// lap ever in that car at that track (the lap file it keeps in Documents\iRacing\lapfiles), not against this session:
// it is there before he has driven a lap of the session, and it stays positive until he beats that lap. At Zandvoort on
// 2026-09-29 it was positive on 87% of the frames of his qualifying and 72% of his race, so the HUD showed it red with a
// plus nearly all the time, with nothing to say what it was against. The payload carries no gap to this session's laps,
// so it is worked out here, from his own laps as the page sees them: where he is round the lap (DS.TrackPct) and the
// time on the lap so far. A lap seen whole, from the line to the line, in the car and not marked invalid, is a lap to
// measure against; the fastest is his best of the session, and the fastest of each sector make the optimal lap.
//
// Pure: no DOM. poll-engine.js feeds it every frame and draws what view() says; the unit tests run it in Node.
(function () {
  'use strict';

  // A lap begun at the line is first seen this soon after it (a slow page may see it late: the line itself, nought on
  // the clock at nought round the lap, is put in for it), and a lap seen whole was last seen this close before it.
  const START_MAX = 0.08;
  const START_TIME_MAX = 8; // seconds on the lap at its first sample
  const END_MIN = 0.92;     // its time at the line is carried on from the last two looks
  const MIN_SAMPLES = 20;   // and seen this many times on the way round

  // The time at a place round a lap seen whole, from its samples (pcts rising, times with them).
  function timeAt(pcts, times, pct) {
    const n = pcts.length;
    if (pct <= pcts[0]) return times[0];
    if (pct >= pcts[n - 1]) return times[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pcts[mid] <= pct) lo = mid; else hi = mid;
    }
    const span = pcts[hi] - pcts[lo];
    return span > 0 ? times[lo] + (times[hi] - times[lo]) * ((pct - pcts[lo]) / span) : times[lo];
  }

  // The sectors as [start, end] pairs from the boundaries between them (0 < b < 1, rising); none given is one sector.
  function sectorsOf(boundaries) {
    const b = (Array.isArray(boundaries) ? boundaries : []).map(Number).filter((x) => x > 0 && x < 1).sort((x, y) => x - y);
    const edges = [0, ...b, 1];
    const out = [];
    for (let i = 0; i < edges.length - 1; i++) if (edges[i + 1] > edges[i]) out.push([edges[i], edges[i + 1]]);
    return out;
  }

  function create() {
    let key = null;         // the session the laps belong to
    let cur = null;         // the lap under way: { pcts, times, clean, fromLine }
    let best = null;        // the fastest lap seen whole: { pcts, times, time }
    let sectors = sectorsOf(null);
    let sectorKey = '';
    let bestSectors = [];   // per sector, the fastest seen: { time, pcts, times, from }
    let lastPct = -1;
    let lastT = -1;

    function reset() {
      cur = null; best = null; bestSectors = []; lastPct = -1; lastT = -1;
    }

    // The frames stopped and have begun again (the rig's HUD switched off and on, or he got out and back in): the lap under
    // way is over and is not joined to what comes after the gap, which would make one lap of two and could be taken for his
    // best. The bests are kept; the next lap begun at the line is measured against them.
    function breakLap() {
      cur = null; lastPct = -1; lastT = -1;
    }

    // A lap has ended at the line: keep it if it was seen whole.
    function close() {
      if (!cur || !cur.fromLine || !cur.clean || cur.pcts.length < MIN_SAMPLES) return;
      const n = cur.pcts.length;
      if (cur.pcts[n - 1] < END_MIN) return;
      // Its time at the line, carried on from the last two samples.
      const p1 = cur.pcts[n - 1], t1 = cur.times[n - 1];
      const p0 = cur.pcts[n - 2], t0 = cur.times[n - 2];
      const slope = p1 > p0 ? (t1 - t0) / (p1 - p0) : 0;
      const time = t1 + Math.max(0, (1 - p1) * slope);
      if (!(time > 0)) return;
      const pcts = Float64Array.from([...cur.pcts, 1]);
      const times = Float64Array.from([...cur.times, time]);
      if (!best || time < best.time) best = { pcts, times, time };
      sectors.forEach(([from, to], i) => {
        const t = timeAt(pcts, times, to) - timeAt(pcts, times, from);
        if (t > 0 && (!bestSectors[i] || t < bestSectors[i].time)) bestSectors[i] = { time: t, pcts, times, from };
      });
    }

    /**
     * One frame: which session (its type and track), where he is round the lap (0-1), the time on the lap so far, and
     * whether this frame counts (in the car, off pit road, the lap not marked invalid). The sector boundaries are the
     * session's, as the plugin gives them; they are taken once per session.
     */
    function feed({ session = '', pct, t, clean = true, boundaries = null } = {}) {
      if (session !== key) {
        key = session;
        reset();
        sectorKey = '';
      }
      const sk = Array.isArray(boundaries) ? boundaries.join(',') : '';
      if (sk && sk !== sectorKey) {
        // Sectors that change mid-session (the plugin's own came late) start their bests again.
        sectorKey = sk;
        sectors = sectorsOf(boundaries);
        bestSectors = [];
      }
      if (!(pct >= 0 && pct <= 1) || !(t >= 0)) return;
      // A new lap: over the line (the place wraps round), or the lap's clock started again (a reset, the pits).
      // The two need not come in the same frame: a clock that starts again just short of the line ends the lap too.
      const wrapped = lastPct > 0.9 && pct < 0.1;
      const restarted = lastT >= 0 && t < lastT - 1;
      if (!cur || wrapped || restarted) {
        if (cur && (wrapped || lastPct >= END_MIN)) close();
        const fromLine = pct <= START_MAX && t <= START_TIME_MAX;
        cur = { pcts: fromLine && pct > 0 ? [0] : [], times: fromLine && pct > 0 ? [0] : [], clean: true, fromLine };
      }
      if (!clean) cur.clean = false;
      // Only onward: a spin or a moment going backwards is not a place he has been faster to.
      if (cur.pcts.length === 0 || pct > cur.pcts[cur.pcts.length - 1]) {
        cur.pcts.push(pct);
        cur.times.push(t);
      }
      lastPct = pct;
      lastT = t;
    }

    /** The gaps where he is now: to his best lap of the session and to the optimal lap, each null when there is none. */
    function view() {
      const out = { best: null, optimal: null, bestTime: best ? best.time : 0, optimalTime: 0 };
      const complete = bestSectors.length === sectors.length && bestSectors.every(Boolean);
      if (complete) out.optimalTime = bestSectors.reduce((sum, s) => sum + s.time, 0);
      if (!cur || !cur.fromLine || lastPct < 0 || lastT < 0) return out;
      if (best) out.best = lastT - timeAt(best.pcts, best.times, lastPct);
      if (complete) {
        let ref = 0;
        for (let i = 0; i < sectors.length; i++) {
          const [from, to] = sectors[i];
          const s = bestSectors[i];
          if (lastPct >= to && i < sectors.length - 1) { ref += s.time; continue; }
          ref += timeAt(s.pcts, s.times, lastPct) - timeAt(s.pcts, s.times, from);
          break;
        }
        out.optimal = lastT - ref;
      }
      return out;
    }

    return { feed, view, reset, breakLap };
  }

  /**
   * A gap as the HUD writes it: a minus and green when he is gaining, a plus and red when he is losing, and neither at
   * nought. The minus is the typographic one, the width of the plus in the mono face.
   */
  function format(d) {
    if (typeof d !== 'number' || !isFinite(d)) return { text: '', cls: '' };
    const r = Math.round(d * 1000) / 1000;
    if (r === 0) return { text: '0.000', cls: 'delta-even' };
    return r < 0 ? { text: '−' + (-r).toFixed(3), cls: 'delta-faster' } : { text: '+' + r.toFixed(3), cls: 'delta-slower' };
  }

  // What each delta is measured against, as the HUD labels it.
  const LABELS = Object.freeze({ session: 'vs session best', optimal: 'vs optimal', alltime: 'vs all-time best' });

  /**
   * The one delta the HUD shows, and what it is against: his best lap of the session once he has one, else iRacing's
   * gap to his best lap ever (DS.LapDelta), which is there from the first lap. Null when there is neither.
   */
  function pick(v, allTime) {
    if (v && typeof v.best === 'number' && isFinite(v.best)) return { value: v.best, ref: 'session', label: LABELS.session };
    if (typeof allTime === 'number' && isFinite(allTime) && allTime !== 0) return { value: allTime, ref: 'alltime', label: LABELS.alltime };
    return null;
  }

  const api = { create, format, pick, timeAt, sectorsOf, LABELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.RacingDeskLapDelta = api;
})();
