// ═══════════════════════════════════════════════════════════════
// EVENT DETECTION — Convert raw telemetry frames into racing events
//
// Scans the frame-by-frame telemetry and identifies moments that
// matter for editing: battles, overtakes, incidents, pit stops,
// starts, finishes, fast laps, and off-track excursions.
//
// Input: array of telemetry frame objects (from parse-telemetry)
// Output: array of event objects for the scoring + Claude pipeline
// ═══════════════════════════════════════════════════════════════

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
  let battleStartT = null;
  let battleMinGap = Infinity;

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const t = f.t || 0;

    // ── Race start (first lap) ────────────────────────────
    if (i === 0 || (prevLap === 0 && f.lap === 1)) {
      events.push({
        t, event: 'race_start',
        data: { pos: f.pos, totalCars: f.totalCars },
      });
    }

    // ── Position changes (overtakes / lost positions) ─────
    if (prevPos > 0 && f.pos > 0 && f.pos !== prevPos) {
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
    const gapAhead = f.gapAhead || Infinity;
    const gapBehind = f.gapBehind || Infinity;
    const closestGap = Math.min(gapAhead, gapBehind);
    const inBattle = closestGap < BATTLE_GAP_THRESHOLD;

    if (inBattle && battleStartT === null) {
      battleStartT = t;
      battleMinGap = closestGap;
    } else if (inBattle && battleStartT !== null) {
      battleMinGap = Math.min(battleMinGap, closestGap);
    } else if (!inBattle && battleStartT !== null) {
      const duration = t - battleStartT;
      if (duration >= BATTLE_MIN_DURATION_SEC) {
        events.push({
          t: battleStartT, event: 'close_battle',
          duration,
          data: {
            minGap: +battleMinGap.toFixed(2),
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
    if (!prevInPit && f.pit) {
      events.push({ t, event: 'pit_entry', data: { pos: f.pos } });
    } else if (prevInPit && !f.pit) {
      events.push({ t, event: 'pit_exit', data: { pos: f.pos } });
    }

    // ── Flag changes ─────────────────────────────────────
    const flag = f.flag || 'green';
    if (flag !== prevFlag && flag !== 'green') {
      events.push({ t, event: 'flag_change', data: { from: prevFlag, to: flag } });
    }

    // ── Speed drop (off-track, spin, lockup) ─────────────
    if (prevSpeed > 30 && f.speed > 0 && f.speed / prevSpeed < SPEED_DROP_THRESHOLD) {
      events.push({
        t, event: 'speed_drop',
        data: { from: +prevSpeed.toFixed(0), to: +f.speed.toFixed(0), ratio: +(f.speed / prevSpeed).toFixed(2) },
      });
    }

    // ── Lap changes ──────────────────────────────────────
    if (f.lap > prevLap && prevLap > 0) {
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
    if (f.endOfRace && (i === frames.length - 1 || !frames[i + 1]?.endOfRace)) {
      events.push({
        t, event: 'race_end',
        data: { pos: f.pos, lap: f.lap, incidents: f.incidents },
      });
    }

    // Update previous state
    prevPos = f.pos || prevPos;
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
        data: { minGap: +battleMinGap.toFixed(2) },
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
        pendingBattle.data.minGap = Math.min(pendingBattle.data.minGap, e.data.minGap);
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
