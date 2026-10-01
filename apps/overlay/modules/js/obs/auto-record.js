// Auto-record: when a recording starts and stops by itself, from the telemetry alone. His rules (2026-09-30):
//
// - In a race it starts at the green flag: iRacing's SessionState reaching Racing (4) while he is in the car. A
//   race begins on the grid, so pit exit never comes; the formation lap (ParadeLaps, 3) is not the start. A
//   pit-lane start sees the same green flag.
// - In practice, qualifying and a warm-up it starts at pit exit: the pit lane left, while he is in the car.
// - It stops on a new session number (practice becoming qualifying, qualifying becoming the race), at the end of
//   the race — five seconds after the chequered flag, or the cool-down, is first seen — and when he leaves the car
//   (which main.js's in-car signal already holds for two seconds). Never on a state change within a session: a
//   recording begun in the warm-up is not ended by the formation lap, and a red flag ends nothing.
// - Every start and stop is held for about a second by the clock, not by a count of frames: this is fed twice a
//   second in the car, and a count of thirty would have been fifteen seconds.
// - It stops only what it started: a recording he began on the desk or with Ctrl+Space in OBS is his to stop.
// - A race's green flag starts a recording once per stint: after any recording seen running under it in that stint
//   — his own or this one's — the green flag is not a reason to start again until he gets back in the car or the
//   session changes. So a Stop he presses mid-race is not undone a second later. A pit exit is an edge and is
//   always one.
// - The demo and a sim that is not running are nothing to record.
//
// Pure: fed { payload, inCar, recording, auto } and the clock, it answers { start, why } or { stop, why } or null.
// It starts nothing itself; the keeper (recording.js) acts on the answer, and never starts OBS for it.
const KEYS = Object.freeze({
  demo: 'RacingDesk.Plugin.DemoMode',
  gameRunning: 'DataCorePlugin.GameRunning',
  sessionNum: 'DataCorePlugin.GameRawData.Telemetry.SessionNum',
  sessionType: 'RacingDesk.Plugin.SessionTypeName',
  sessionMode: 'RacingDesk.Plugin.DS.SessionMode',
  sessionState: 'RacingDesk.Plugin.Grid.SessionState',
  inPit: 'RacingDesk.Plugin.DS.IsInPitLane',
  endOfRace: 'RacingDesk.Plugin.DS.IsEndOfRace',
});

// iRacing's SessionState (TelemetrySnapshot.cs): 0 Invalid, 1 GetInCar, 2 Warmup, 3 ParadeLaps, 4 Racing, 5 Checkered, 6 CoolDown.
const SESSION_STATE = Object.freeze({ INVALID: 0, GET_IN_CAR: 1, WARMUP: 2, PARADE: 3, RACING: 4, CHECKERED: 5, COOLDOWN: 6 });
// The host's DS.SessionMode: 0 Unknown, 1 Practice, 2 Qualifying, 3 Warmup, 4 Race.
const SESSION_MODE_RACE = 4;

const DEBOUNCE_MS = 1000;
const END_OF_RACE_MS = 5000;

const GREEN_FLAG = 'green flag';
const PIT_EXIT = 'pit exit';
const NEW_SESSION = 'new session';
const END_OF_RACE = 'end of race';
const OUT_OF_CAR = 'out of the car';

function flag(value) {
  if (value === true) return true;
  if (typeof value === 'string' && /^true$/i.test(value.trim())) return true;
  return Number(value) > 0;
}

function sent(value) {
  return value !== undefined && value !== null && value !== '';
}

/** What a payload says that these rules go by. `live` is false for no payload, the demo, or a sim not running. */
function readFrame(payload) {
  if (!payload || typeof payload !== 'object') return { live: false };
  if (flag(payload[KEYS.demo]) || !flag(payload[KEYS.gameRunning])) return { live: false };
  const mode = sent(payload[KEYS.sessionMode]) ? parseInt(payload[KEYS.sessionMode], 10) : null;
  const type = sent(payload[KEYS.sessionType]) ? String(payload[KEYS.sessionType]) : '';
  let race;
  if (mode !== null && Number.isFinite(mode)) race = mode === SESSION_MODE_RACE;
  else race = type.length > 0 && !/practice|test|qual|warm/i.test(type);
  const num = sent(payload[KEYS.sessionNum]) ? Number(payload[KEYS.sessionNum]) : NaN;
  // Which session this is: iRacing's number, else the session's name (a SimHub plugin from before the number).
  const sessionKey = Number.isFinite(num) ? `n${num}` : (type ? `t${type}` : null);
  return {
    live: true,
    race,
    sessionKey,
    sessionState: parseInt(payload[KEYS.sessionState], 10) || 0,
    inPit: flag(payload[KEYS.inPit]),
    endOfRace: flag(payload[KEYS.endOfRace]),
  };
}

/**
 * createAutoRecord({ now, debounceMs, endOfRaceMs })
 *   feed({ payload, inCar, recording, auto }) → { start: true, why } | { stop: true, why } | null
 *     payload    the telemetry as main.js polls it (null when nothing answered)
 *     inCar      main.js's in-car signal (modules/js/in-car.js), already held two seconds on the way out
 *     recording  whether OBS is recording now, whoever started it
 *     auto       whether that recording is one these rules started
 *   state() → what it is waiting on, for the log and the tests
 *   reset()
 */
function createAutoRecord({ now = Date.now, debounceMs = DEBOUNCE_MS, endOfRaceMs = END_OF_RACE_MS } = {}) {
  let candidate = null;        // { kind: 'start' | 'stop', why, since }
  let prevInPit = null;        // the last live frame's pit lane, for the pit-exit edge
  let lastInCar = false;
  let lastSession = null;      // the session key last seen live
  let startedIn = null;        // the session key the auto recording began in
  let wasRecording = false;
  let armed = true;            // a race's green flag may start a recording (see the rules above)

  function hold(kind, why, holdMs, at) {
    if (!candidate || candidate.kind !== kind || candidate.why !== why) candidate = { kind, why, since: at };
    if (at - candidate.since >= holdMs) {
      candidate = null;
      return kind === 'start' ? { start: true, why } : { stop: true, why };
    }
    return null;
  }

  function feed({ payload = null, inCar = false, recording = false, auto = false } = {}) {
    const at = now();
    const frame = readFrame(payload);

    // Re-armed by getting in the car, and by a new session.
    if (inCar && !lastInCar) armed = true;
    lastInCar = inCar;
    if (frame.live && frame.sessionKey !== null && frame.sessionKey !== lastSession) {
      if (lastSession !== null) armed = true;
      lastSession = frame.sessionKey;
    }
    // Any recording seen running under the green flag, in the car, uses it up for this stint. One seen on the grid
    // does not: it may be the session before's, in its last second before the new number stops it.
    if (recording && inCar && frame.live && frame.race && frame.sessionState === SESSION_STATE.RACING) armed = false;
    // The session the auto recording began in: noted when it is first seen running.
    if (recording && auto && !wasRecording) startedIn = frame.live ? frame.sessionKey : null;
    if (!recording) startedIn = null;
    wasRecording = recording;

    let decision = null;
    if (recording) {
      if (!auto) {
        candidate = null;
      } else if (!inCar) {
        decision = hold('stop', OUT_OF_CAR, debounceMs, at);
      } else if (frame.live && frame.sessionKey !== null && startedIn !== null && frame.sessionKey !== startedIn) {
        decision = hold('stop', NEW_SESSION, debounceMs, at);
      } else if (frame.live && (frame.endOfRace || frame.sessionState === SESSION_STATE.COOLDOWN)) {
        decision = hold('stop', END_OF_RACE, endOfRaceMs, at);
      } else {
        candidate = null;
      }
    } else if (!inCar || !frame.live) {
      candidate = null;
    } else if (frame.race) {
      if (frame.sessionState === SESSION_STATE.RACING && armed) decision = hold('start', GREEN_FLAG, debounceMs, at);
      else candidate = null;
    } else {
      // Practice, qualifying, a warm-up: the pit lane left is the edge; held while he stays out of it.
      const left = prevInPit === true && frame.inPit === false;
      if (left) candidate = { kind: 'start', why: PIT_EXIT, since: at };
      if (candidate && candidate.why === PIT_EXIT) {
        if (frame.inPit) candidate = null;
        else decision = hold('start', PIT_EXIT, debounceMs, at);
      } else {
        candidate = null;
      }
    }

    prevInPit = frame.live && inCar ? frame.inPit : null;
    return decision;
  }

  function state() {
    return { candidate: candidate ? { ...candidate } : null, armed, startedIn, lastSession };
  }

  function reset() {
    candidate = null;
    prevInPit = null;
    lastInCar = false;
    lastSession = null;
    startedIn = null;
    wasRecording = false;
    armed = true;
  }

  return { feed, state, reset };
}

module.exports = {
  KEYS, SESSION_STATE, SESSION_MODE_RACE, DEBOUNCE_MS, END_OF_RACE_MS,
  GREEN_FLAG, PIT_EXIT, NEW_SESSION, END_OF_RACE, OUT_OF_CAR,
  readFrame, createAutoRecord,
};
