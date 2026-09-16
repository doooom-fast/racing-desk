// ═══════════════════════════════════════════════════════════════
// SCORING ENGINE — TV Score + Interest Score calculators
//
// Every second of the race gets two scores:
//
// TV Score (0–100): How much reason to show TV/broadcast camera
//   High → switch to TV view, Low → stay cockpit
//
// Interest Score (0–100): How interesting is this moment to a viewer
//   High → keep in edit, Low → candidate for cutting
//
// These are pure rule-based. Claude refines the editorial judgment
// on top of these mechanical scores.
// ═══════════════════════════════════════════════════════════════

// ── TV Score Weights ────────────────────────────────────────
const TV_WEIGHTS = {
  gap_ahead_close:      40,   // < 0.8s gap ahead → battle
  gap_ahead_battle:     25,   // < 1.5s gap ahead → developing
  gap_behind_close:     35,   // < 0.8s gap behind → being attacked
  gap_behind_battle:    20,   // < 1.5s gap behind → pressure
  side_by_side:         50,   // closest car < 1.5 car lengths
  position_changed:     60,   // overtake just happened
  incident:             45,   // incident nearby
  pit:                  55,   // pit entry/exit
  flag_not_green:       30,   // caution / safety car
  lap_one:              70,   // race start
  speed_drop:           40,   // off track or contact
  // Negative (stay cockpit)
  hot_lap:             -30,   // delta_best < -0.5s
  clean_air:           -20,   // gaps > 3.0s both sides
  braking_zone:        -15,   // heavy braking (immersive)
};

// ── Interest Score Weights ──────────────────────────────────
const INTEREST_WEIGHTS = {
  gap_close:            35,   // in a battle (< 1.5s either side)
  gap_pressure:         30,   // being hunted (< 1.5s behind)
  position_changed:     80,   // something just happened
  incident:             60,   // contact or off-track
  pit:                  50,   // strategic moment
  flag_not_green:       40,   // caution, restart coming
  speed_drop:           45,   // spin, lockup, off-track
  start_or_finish:      70,   // lap 1 or last lap
  fast_lap:             25,   // on a fast lap
  // Negative (boring)
  clean_air:           -40,   // no one near you
  no_movement:         -10,   // same position > 60s
};

// ── Hysteresis ──────────────────────────────────────────────
const TV_HOLD_MIN_SEC = 4;      // minimum time to hold TV view
const COCKPIT_HOLD_MIN_SEC = 6; // minimum time to hold cockpit

/**
 * Score every second of the race for TV view preference.
 * @param {Array} frames - Telemetry frames (30fps)
 * @param {Array} events - Detected events from detect-events.js
 * @returns {Array<{t: number, tvScore: number, interestScore: number}>}
 */
export function scoreFrames(frames, events) {
  if (!frames || frames.length === 0) return [];

  // Build an event lookup by second
  const eventsBySecond = new Map();
  for (const e of events) {
    const sec = Math.floor(e.t);
    if (!eventsBySecond.has(sec)) eventsBySecond.set(sec, []);
    eventsBySecond.get(sec).push(e);
    // Spread events across their duration
    if (e.duration) {
      for (let s = sec + 1; s <= sec + Math.ceil(e.duration); s++) {
        if (!eventsBySecond.has(s)) eventsBySecond.set(s, []);
        eventsBySecond.get(s).push(e);
      }
    }
  }

  // Sample one frame per second (skip intermediate frames)
  const lastT = frames[frames.length - 1]?.t || 0;
  const totalSeconds = Math.ceil(lastT);
  const scores = [];

  // Build a frame index (nearest frame per second)
  const frameIndex = new Map();
  for (const f of frames) {
    const sec = Math.round(f.t);
    if (!frameIndex.has(sec)) frameIndex.set(sec, f);
  }

  let prevPos = 0;
  let posHeldSince = 0;

  for (let sec = 0; sec <= totalSeconds; sec++) {
    const f = frameIndex.get(sec);
    if (!f) {
      scores.push({ t: sec, tvScore: 0, interestScore: 0 });
      continue;
    }

    let tvScore = 0;
    let interestScore = 0;
    const secEvents = eventsBySecond.get(sec) || [];

    // ── Frame-based signals ─────────────────────────────
    const gapAhead = f.gapAhead ?? Infinity;
    const gapBehind = f.gapBehind ?? Infinity;
    const closestCar = f.closestCar ?? Infinity;

    // TV Score signals
    if (gapAhead < 0.8) tvScore += TV_WEIGHTS.gap_ahead_close;
    else if (gapAhead < 1.5) tvScore += TV_WEIGHTS.gap_ahead_battle;

    if (gapBehind < 0.8) tvScore += TV_WEIGHTS.gap_behind_close;
    else if (gapBehind < 1.5) tvScore += TV_WEIGHTS.gap_behind_battle;

    if (closestCar < 1.5) tvScore += TV_WEIGHTS.side_by_side;

    if (f.lap === 1) tvScore += TV_WEIGHTS.lap_one;

    if (f.pit) tvScore += TV_WEIGHTS.pit;

    if (f.flag && f.flag !== 'green') tvScore += TV_WEIGHTS.flag_not_green;

    if (f.lapDelta && f.lapDelta < -0.5) tvScore += TV_WEIGHTS.hot_lap;

    if (gapAhead > 3 && gapBehind > 3) tvScore += TV_WEIGHTS.clean_air;

    if (f.brake > 0.8) tvScore += TV_WEIGHTS.braking_zone;

    // Interest Score signals
    if (gapAhead < 1.5 || gapBehind < 1.5) interestScore += INTEREST_WEIGHTS.gap_close;
    if (gapBehind < 1.5) interestScore += INTEREST_WEIGHTS.gap_pressure;

    if (f.lap === 1 || f.endOfRace) interestScore += INTEREST_WEIGHTS.start_or_finish;

    if (f.pit) interestScore += INTEREST_WEIGHTS.pit;

    if (f.flag && f.flag !== 'green') interestScore += INTEREST_WEIGHTS.flag_not_green;

    if (gapAhead > 3 && gapBehind > 3) interestScore += INTEREST_WEIGHTS.clean_air;

    // Position staleness
    if (f.pos === prevPos) {
      if (sec - posHeldSince > 60) interestScore += INTEREST_WEIGHTS.no_movement;
    } else {
      posHeldSince = sec;
    }
    prevPos = f.pos || prevPos;

    // ── Event-based signals ─────────────────────────────
    for (const e of secEvents) {
      switch (e.event) {
        case 'position_change':
          tvScore += TV_WEIGHTS.position_changed;
          interestScore += INTEREST_WEIGHTS.position_changed;
          break;
        case 'incident':
          tvScore += TV_WEIGHTS.incident;
          interestScore += INTEREST_WEIGHTS.incident;
          break;
        case 'speed_drop':
          tvScore += TV_WEIGHTS.speed_drop;
          interestScore += INTEREST_WEIGHTS.speed_drop;
          break;
        case 'fast_lap':
          interestScore += INTEREST_WEIGHTS.fast_lap;
          break;
        case 'close_battle':
          // Already handled by gap signals, but boost a bit
          tvScore += 10;
          interestScore += 15;
          break;
      }
    }

    // Clamp scores
    tvScore = Math.max(0, Math.min(100, tvScore));
    interestScore = Math.max(0, Math.min(100, interestScore));

    scores.push({ t: sec, tvScore, interestScore });
  }

  return scores;
}

/**
 * Apply hysteresis to TV scores → produce camera switch list.
 * Prevents jarring rapid cuts between cockpit and TV view.
 * @param {Array} scores - Per-second scores from scoreFrames()
 * @param {number} [tvThreshold=40] - Score above which TV view is preferred
 * @returns {Array<{start: number, end: number, source: 'cockpit'|'tv'}>}
 */
export function applyCameraHysteresis(scores, tvThreshold = 40) {
  if (scores.length === 0) return [];

  const segments = [];
  let currentSource = 'cockpit';
  let segmentStart = 0;
  let holdUntil = 0;

  for (let i = 0; i < scores.length; i++) {
    const { t, tvScore } = scores[i];
    const wantTV = tvScore >= tvThreshold;
    const wantSource = wantTV ? 'tv' : 'cockpit';

    if (t < holdUntil) continue;  // still in hold period

    if (wantSource !== currentSource) {
      // Close previous segment
      if (i > 0) {
        segments.push({ start: segmentStart, end: t, source: currentSource });
      }
      currentSource = wantSource;
      segmentStart = t;
      holdUntil = t + (wantTV ? TV_HOLD_MIN_SEC : COCKPIT_HOLD_MIN_SEC);
    }
  }

  // Close final segment
  const lastT = scores.length > 0 ? (scores[scores.length - 1]?.t || 0) : 0;
  if (scores.length > 0) {
    segments.push({ start: segmentStart, end: lastT, source: currentSource });
  }

  return segments;
}
