// ═══════════════════════════════════════════════════════════════
// FRAME VALUES — what a sidecar frame's numbers and words mean
//
// The sidecar writes 0 for a number the payload did not have
// (telemetry-sidecar.js: `+v(k) || 0`), and `none` for a flag word it
// did not have. Read as they stand, a gap of 0 is a car alongside and
// `none` is a flag out: on his 2026-10-27 race the gap behind was 0 in
// every frame and the flag `none` in most, and the TV view won 98.6 %
// of it. The event detector and the scoring engine read them here.
// ═══════════════════════════════════════════════════════════════

/** A gap in seconds, or null: 0 is a gap the sidecar was not given (no car there, or no source), never a car 0 s away. */
export function knownGap(v) {
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** A race position, or null: 0 is not given, and -1 is iRacing's word for a car out of the session (after the race). */
export function knownPosition(v) {
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** No flag out: `none` (the payload had no word) and green. */
export function isNoFlag(flag) {
  return !flag || flag === 'none' || flag === 'green';
}

/** A caution: the whole field slows (a full-course yellow, the red). */
export function isCaution(flag) {
  return flag === 'yellow' || flag === 'red';
}

/**
 * The flags that change his race, and are a flag change worth an event: not `debris` (iRacing's local flag for a
 * sector with debris in it, out every lap at the same place), not `blue` (a faster car about to lap him) and not
 * `orange` (the host's word for a car ahead being lapped).
 */
export const RACE_FLAGS = new Set(['yellow', 'red', 'white', 'checkered', 'black', 'meatball']);

/**
 * When the race started: the first frame of lap 1 after lap 0 (the grid), or the first frame of a recording begun
 * on lap 1; null for a recording begun later. The detector's race_start is the same rule.
 */
export function raceStartTime(frames) {
  let prevLap = 0;
  for (const f of frames) {
    if (prevLap === 0 && f.lap === 1) return f.t || 0;
    prevLap = f.lap || prevLap;
  }
  return null;
}

/** How long after the start the start is still the story: the launch and the first corners, not all of lap 1. */
export const START_HOLD_SEC = 60;

/** How long after his chequered flag the finish is still worth showing (the scores), and its numbers read (the session's). */
export const FINISH_HOLD_SEC = 10;

/**
 * When his race ended: the t of the first frame that says it is over (`endOfRace`, his chequered flag), or null.
 * Everything after it is the cool-down lap, the pits and the menus.
 */
export function finishTime(frames) {
  const f = frames.find((x) => x.endOfRace);
  return f ? (f.t || 0) : null;
}
