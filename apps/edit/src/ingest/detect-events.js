// ═══════════════════════════════════════════════════════════════
// EVENT DETECTION — Convert raw telemetry frames into racing events
//
// Scans the frame-by-frame telemetry and identifies moments that
// matter for editing: battles, overtakes, incidents, pit stops,
// starts, finishes, fast laps, and off-track excursions.
//
// Input: array of telemetry frame objects (from parse-telemetry)
// Output: array of event objects for the scoring + Claude pipeline
//
// A gap of 0, a position of 0 or -1 and the flag `none` are values the
// sidecar did not have (frame-values.js). After his chequered flag the
// cool-down lap is not the race: no battle, pass, pit stop, lap or off
// is found in it (the lap counter goes on a few seconds after the flag).
// ═══════════════════════════════════════════════════════════════

import { knownGap, knownPosition, isNoFlag, RACE_FLAGS, finishTime } from './frame-values.js';

/**
 * @typedef {Object} RaceEvent
 * @property {number} t - Time in seconds from recording start
 * @property {string} event - Event type name
 * @property {number} [duration] - Duration in seconds (for sustained events)
 * @property {Object} [data] - Event-specific data
 */

// ── Thresholds ──────────────────────────────────────────────
const BATTLE_GAP_THRESHOLD = 1.5;       // seconds — closer than this = battle
const CLOSE_BATTLE_GAP = 0.8;           // seconds — really close
const SIDE_BY_SIDE_DIST = 1.5;          // car lengths
const SPEED_DROP_THRESHOLD = 0.7;       // 30% speed drop = off track / spin
const BATTLE_MIN_DURATION_SEC = 2;      // ignore sub-2s battles
const BATTLE_MERGE_GAP_SEC = 5;         // merge battles within 5s
const FLAG_HOLD_SEC = 30;               // a flag back within 30s of last showing is the same flag (white and blue take turns)

/**
 * Detect all racing events from raw telemetry frames.
 * @param {Array} frames - Parsed telemetry frames (each has t, pos, speed, etc.)
 * @returns {RaceEvent[]} - Sorted event list
 */
export function detectEvents(frames) {
  if (!frames || frames.length === 0) return [];

  const events = [];
  let prevPos = 0;
  let prevIncidents = 0;
  let prevLap = 0;
  let prevSpeed = 0;
  let prevInPit = false;
  let prevFlag = 'green';
  let prevEndOfRace = false;
  let battleStartT = null;
  let battleMinGap = Infinity;
  let battleClosestAt = null;
  const flagSeenAt = new Map();
  const finishedAt = finishTime(frames);

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const t = f.t || 0;
    const raceOver = finishedAt !== null && t > finishedAt;

    // ── Race start (first lap) ────────────────────────────
    // Lap 1 beginning: from lap 0 (the grid), or in the first frame of a recording begun on lap 1. A recording begun
    // later in the race has no start in it. (The first frame was always a start as well, which gave a recording that
    // saw lap 0 two.)
    if (prevLap === 0 && f.lap === 1) {
      events.push({
        t, event: 'race_start',
        data: { pos: f.pos, totalCars: f.totalCars },
      });
    }

    // ── Position changes (overtakes / lost positions) ─────
    if (!raceOver && prevPos > 0 && f.pos > 0 && f.pos !== prevPos) {
      events.push({
        t, event: 'position_change',
        data: {
          from: prevPos, to: f.pos,
          direction: f.pos < prevPos ? 'gained' : 'lost',
          delta: prevPos - f.pos,
        },
      });
    }

    // ── Battles (sustained close gaps) ────────────────────
    const gapAhead = knownGap(f.gapAhead) ?? Infinity;
    const gapBehind = knownGap(f.gapBehind) ?? Infinity;
    const closestGap = Math.min(gapAhead, gapBehind);
    const inBattle = !raceOver && closestGap < BATTLE_GAP_THRESHOLD;

    if (inBattle && battleStartT === null) {
      battleStartT = t;
      battleMinGap = closestGap;
      battleClosestAt = t;
    } else if (inBattle && battleStartT !== null) {
      if (closestGap < battleMinGap) {
        battleMinGap = closestGap;
        battleClosestAt = t;
      }
    } else if (!inBattle && battleStartT !== null) {
      const duration = t - battleStartT;
      if (duration >= BATTLE_MIN_DURATION_SEC) {
        events.push({
          t: battleStartT, event: 'close_battle',
          duration,
          data: {
            minGap: +battleMinGap.toFixed(2),
            closestAt: battleClosestAt,
            side: gapAhead < gapBehind ? 'ahead' : 'behind',
          },
        });
      }
      battleStartT = null;
      battleMinGap = Infinity;
    }

    // ── Incidents ─────────────────────────────────────────
    if (prevIncidents >= 0 && f.incidents > prevIncidents) {
      events.push({
        t, event: 'incident',
        data: { from: prevIncidents, to: f.incidents, added: f.incidents - prevIncidents },
      });
    }

    // ── Pit entry / exit ─────────────────────────────────
    if (raceOver) {
      // Driving into the pits after the flag is not a stop.
    } else if (!prevInPit && f.pit) {
      events.push({ t, event: 'pit_entry', data: { pos: f.pos } });
    } else if (prevInPit && !f.pit) {
      events.push({ t, event: 'pit_exit', data: { pos: f.pos } });
    }

    // ── Flag changes ─────────────────────────────────────
    // `none` is no flag, as green is. Only a flag that changes his race is an event (RACE_FLAGS), and one that was
    // out a moment ago is not out again: iRacing gives one word for the flags at a time, so white and blue take turns
    // on the last lap while he is lapped.
    const flag = isNoFlag(f.flag) ? 'green' : f.flag;
    if (flag !== prevFlag && RACE_FLAGS.has(flag) && !((flagSeenAt.get(flag) ?? -Infinity) >= t - FLAG_HOLD_SEC)) {
      events.push({ t, event: 'flag_change', data: { from: prevFlag, to: flag } });
    }
    if (flag !== 'green') flagSeenAt.set(flag, t);

    // ── Speed drop (off-track, spin, lockup) ─────────────
    if (!raceOver && prevSpeed > 30 && f.speed > 0 && f.speed / prevSpeed < SPEED_DROP_THRESHOLD) {
      events.push({
        t, event: 'speed_drop',
        data: { from: +prevSpeed.toFixed(0), to: +f.speed.toFixed(0), ratio: +(f.speed / prevSpeed).toFixed(2) },
      });
    }

    // ── Lap changes ──────────────────────────────────────
    if (!raceOver && f.lap > prevLap && prevLap > 0) {
      events.push({
        t, event: 'new_lap',
        data: { lap: f.lap, lapDelta: f.lapDelta || 0 },
      });

      // Detect fast laps (negative delta = faster than best)
      if (f.lapDelta && f.lapDelta < -0.3) {
        events.push({
          t, event: 'fast_lap',
          data: { lap: f.lap, delta: f.lapDelta },
        });
      }
    }

    // ── End of race ──────────────────────────────────────
    // His chequered flag: the first frame that says the race is over, where it is still his position and lap. (It was
    // the last such frame, which is the end of the recording after the cool-down, with the position iRacing gives a
    // car out of the session, -1.)
    if (f.endOfRace && !prevEndOfRace) {
      events.push({
        t, event: 'race_end',
        data: { pos: knownPosition(f.pos) ?? (prevPos > 0 ? prevPos : 0), lap: f.lap, incidents: f.incidents },
      });
    }

    // Update previous state
    prevPos = knownPosition(f.pos) ?? prevPos;
    prevEndOfRace = !!f.endOfRace;
    prevIncidents = f.incidents ?? prevIncidents;
    prevLap = f.lap || prevLap;
    prevSpeed = f.speed || prevSpeed;
    prevInPit = !!f.pit;
    prevFlag = flag;
  }

  // Close any open battle at the end
  if (battleStartT !== null) {
    const lastT = frames[frames.length - 1]?.t || 0;
    const duration = lastT - battleStartT;
    if (duration >= BATTLE_MIN_DURATION_SEC) {
      events.push({
        t: battleStartT, event: 'close_battle', duration,
        data: { minGap: +battleMinGap.toFixed(2), closestAt: battleClosestAt },
      });
    }
  }

  // Sort by time and merge nearby battles
  events.sort((a, b) => a.t - b.t);
  return mergeBattles(events);
}

/**
 * Merge close_battle events that are within BATTLE_MERGE_GAP_SEC of each other.
 */
function mergeBattles(events) {
  const result = [];
  let pendingBattle = null;

  for (const e of events) {
    if (e.event === 'close_battle') {
      if (pendingBattle && e.t - (pendingBattle.t + (pendingBattle.duration || 0)) < BATTLE_MERGE_GAP_SEC) {
        // Extend the pending battle
        pendingBattle.duration = (e.t + (e.duration || 0)) - pendingBattle.t;
        if (e.data.minGap < pendingBattle.data.minGap) {
          pendingBattle.data = { ...pendingBattle.data, minGap: e.data.minGap, closestAt: e.data.closestAt };
        }
      } else {
        if (pendingBattle) result.push(pendingBattle);
        pendingBattle = { ...e };
      }
    } else {
      result.push(e);
    }
  }
  if (pendingBattle) result.push(pendingBattle);

  result.sort((a, b) => a.t - b.t);
  return result;
}
