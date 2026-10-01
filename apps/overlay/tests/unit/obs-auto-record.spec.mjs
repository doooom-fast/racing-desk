/**
 * Auto-record's rules (modules/js/obs/auto-record.js), fed real sequences on a fake clock: practice from the pits, a
 * race from the grid, a pit-lane start, the formation lap, a red flag, a new session, the end of the race, leaving the
 * car, a Stop he pressed, and the demo. Pure: nothing here talks to OBS.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import { MOCK_TELEMETRY } from '../helpers.mjs';

const require = createRequire(import.meta.url);
const ar = require('../../modules/js/obs/auto-record.js');

// A live iRacing frame: the game running, not the demo, in the given session.
function frame({ mode = 1, type = 'Practice', num = 1, state = 4, pit = false, end = false, flag = 'green', onTrack = 1, lap = 8 } = {}) {
  return {
    ...MOCK_TELEMETRY,
    'DataCorePlugin.GameRunning': 1,
    'RacingDesk.Plugin.DemoMode': 0,
    'RacingDesk.Plugin.DS.SessionMode': mode,
    'RacingDesk.Plugin.SessionTypeName': type,
    'DataCorePlugin.GameRawData.Telemetry.SessionNum': num,
    'RacingDesk.Plugin.Grid.SessionState': state,
    'RacingDesk.Plugin.DS.IsInPitLane': pit ? 1 : 0,
    'RacingDesk.Plugin.DS.IsEndOfRace': end ? 1 : 0,
    'DataCorePlugin.GameRawData.Telemetry.IsOnTrack': onTrack,
    'DataCorePlugin.GameData.CurrentLap': lap,
    currentFlagState: flag,
  };
}
const PRACTICE = (o = {}) => frame({ mode: 1, type: 'Practice', num: 0, state: 4, ...o });
const QUALIFYING = (o = {}) => frame({ mode: 2, type: 'Open Qualify', num: 1, state: 4, ...o });
const RACE = (o = {}) => frame({ mode: 4, type: 'Race', num: 2, ...o });

// A rig: the rules on a fake clock, fed twice a second as main.js does in the car, with the keeper's state played by
// the test (recording and auto follow what the rules asked, unless the test says otherwise).
function rig({ debounceMs = 1000, endOfRaceMs = 5000 } = {}) {
  let clock = 1_000_000;
  const rules = ar.createAutoRecord({ now: () => clock, debounceMs, endOfRaceMs });
  const keeper = { recording: false, auto: false };
  const decisions = [];
  // Feed `frames` payloads 500 ms apart (a frame may be a function of the index); returns the decisions made.
  const run = (frames, { inCar = true, follow = true } = {}) => {
    const made = [];
    for (let i = 0; i < frames.length; i++) {
      const payload = typeof frames[i] === 'function' ? frames[i](i) : frames[i];
      const d = rules.feed({ payload, inCar: typeof inCar === 'function' ? inCar(i) : inCar, recording: keeper.recording, auto: keeper.auto });
      if (d) {
        made.push({ ...d, at: clock });
        decisions.push({ ...d, at: clock });
        if (follow) {
          if (d.start) { keeper.recording = true; keeper.auto = true; }
          if (d.stop) { keeper.recording = false; keeper.auto = false; }
        }
      }
      clock += 500;
    }
    return made;
  };
  return { rules, keeper, decisions, run, now: () => clock, tick: (ms) => { clock += ms; } };
}

const repeat = (n, f) => Array.from({ length: n }, () => f);

test('readFrame: what the rules read, and what is not live', () => {
  expect(ar.readFrame(null)).toEqual({ live: false });
  expect(ar.readFrame({ ...RACE(), 'RacingDesk.Plugin.DemoMode': 1 })).toEqual({ live: false });
  expect(ar.readFrame({ ...RACE(), 'DataCorePlugin.GameRunning': 0 })).toEqual({ live: false });
  expect(ar.readFrame(RACE({ state: 3, pit: true, lap: 3 }))).toEqual({ live: true, race: true, sessionKey: 'n2', sessionState: 3, inPit: true, endOfRace: false, lap: 3 });
  expect(ar.readFrame({ ...RACE(), 'DataCorePlugin.GameData.CurrentLap': undefined }).lap).toBeNull();
  expect(ar.readFrame(PRACTICE()).race).toBe(false);
  expect(ar.readFrame(QUALIFYING()).race).toBe(false);
  expect(ar.readFrame(frame({ mode: 3, type: 'Warmup' })).race).toBe(false);
  // A plugin from before DS.SessionMode and SessionNum: the session's name says which it is.
  const old = { ...RACE() };
  delete old['RacingDesk.Plugin.DS.SessionMode'];
  delete old['DataCorePlugin.GameRawData.Telemetry.SessionNum'];
  expect(ar.readFrame(old)).toMatchObject({ race: true, sessionKey: 'tRace' });
  expect(ar.readFrame({ ...old, 'RacingDesk.Plugin.SessionTypeName': 'Lone Qualify' })).toMatchObject({ race: false, sessionKey: 'tLone Qualify' });
});

test('practice from the pits: nothing in the pit box, the start a second after the pit lane is left, the stop when he leaves the car', () => {
  const r = rig();
  // In the car in the pit box for five seconds: nothing.
  expect(r.run(repeat(10, PRACTICE({ pit: true })))).toEqual([]);
  // Out of the pit lane: the start comes a second later, not on the first frame out.
  const out = r.run(repeat(6, PRACTICE({ pit: false })));
  expect(out).toEqual([{ start: true, why: 'pit exit', at: r.now() - 500 * 4 }]);   // frames at 0 and 500 ms held; 1000 ms is the second
  // Driving on, through the pit lane and out again: nothing more (it is recording).
  expect(r.run([...repeat(20, PRACTICE()), ...repeat(4, PRACTICE({ pit: true })), ...repeat(6, PRACTICE())])).toEqual([]);
  // The garage: out of the car (main.js's signal has held it two seconds already) and the stop a second later.
  const stop = r.run(repeat(6, PRACTICE({ pit: true, onTrack: 0 })), { inCar: false });
  expect(stop).toEqual([{ stop: true, why: 'out of the car', at: expect.any(Number) }]);
  expect(r.keeper.recording).toBe(false);
  // Back in the car in the pit box, then out: a new recording at the next pit exit.
  r.run(repeat(4, PRACTICE({ pit: true })));
  expect(r.run(repeat(6, PRACTICE({ pit: false })))).toEqual([{ start: true, why: 'pit exit', at: expect.any(Number) }]);
});

test('a race from the grid: the warm-up and the formation lap start nothing, the green flag starts it a second on, and the chequered flag stops it five seconds after', () => {
  const r = rig();
  // On the grid in the car: GetInCar, Warmup, ParadeLaps — nothing.
  expect(r.run([...repeat(6, RACE({ state: 1 })), ...repeat(20, RACE({ state: 2 })), ...repeat(60, RACE({ state: 3 }))])).toEqual([]);
  const green = r.run(repeat(6, RACE({ state: 4 })));
  expect(green).toEqual([{ start: true, why: 'green flag', at: expect.any(Number) }]);
  expect(green[0].at - (r.now() - 500 * 6)).toBe(1000);   // a second after the first frame at Racing
  // The race: laps, a pit stop in the car, a yellow — nothing stops it.
  expect(r.run([...repeat(40, RACE({ state: 4 })), ...repeat(10, RACE({ state: 4, pit: true })), ...repeat(10, RACE({ state: 4, flag: 'yellow' }))])).toEqual([]);
  // The chequered flag, and his own finish: he is the leader, so his lap count goes up as the flag comes out. The stop
  // is five seconds after that, not on the state going to Checkered.
  const flag = r.run(repeat(16, RACE({ state: 5, end: true, flag: 'checkered', lap: 9 })));
  expect(flag).toEqual([{ stop: true, why: 'end of race', at: expect.any(Number) }]);
  expect(flag[0].at - (r.now() - 500 * 16)).toBe(5000);
  // The cool-down, still in the car: nothing starts again (the flag is over, and the green used up).
  expect(r.run(repeat(20, RACE({ state: 6 })))).toEqual([]);
});

test('a pit-lane start sees the same green flag', () => {
  const r = rig();
  expect(r.run([...repeat(10, RACE({ state: 2, pit: true })), ...repeat(10, RACE({ state: 3, pit: true }))])).toEqual([]);
  expect(r.run(repeat(4, RACE({ state: 4, pit: true })))).toEqual([{ start: true, why: 'green flag', at: expect.any(Number) }]);
});

test('a red flag, a state change within the session and a yellow end nothing; the cool-down with no chequered flag seen does', () => {
  const r = rig();
  r.run(repeat(4, RACE({ state: 4 })));
  expect(r.keeper.recording).toBe(true);
  expect(r.run([...repeat(30, RACE({ state: 4, flag: 'red' })), ...repeat(10, RACE({ state: 4, flag: 'yellow' })), ...repeat(10, RACE({ state: 3 })), ...repeat(10, RACE({ state: 4 }))])).toEqual([]);
  // The chequered flag with his lap count going up, flickering off within the five seconds: the clock starts again.
  expect(r.run([...repeat(6, RACE({ state: 5, end: true, lap: 9 })), ...repeat(2, RACE({ state: 4, end: false, lap: 9 })), ...repeat(6, RACE({ state: 5, end: true, lap: 10 }))])).toEqual([]);
  // The cool-down is the end of the race too, five seconds on.
  const stop = r.run(repeat(12, RACE({ state: 6 })));
  expect(stop).toEqual([{ stop: true, why: 'end of race', at: expect.any(Number) }]);
});

test('a new session number stops a recording begun in the one before; the next starts by its own rule', () => {
  const r = rig();
  // Practice: out of the pits, recording.
  r.run([...repeat(4, PRACTICE({ pit: true })), ...repeat(4, PRACTICE())]);
  expect(r.keeper.recording).toBe(true);
  // Qualifying begins (the number changes; iRacing puts him in the pit box, still in the car).
  const change = r.run(repeat(4, QUALIFYING({ pit: true })));
  expect(change).toEqual([{ stop: true, why: 'new session', at: expect.any(Number) }]);
  // Out of the pits in qualifying: a new recording.
  expect(r.run(repeat(4, QUALIFYING()))).toEqual([{ start: true, why: 'pit exit', at: expect.any(Number) }]);
  // The race begins: the number changes again (stop), the grid, the green flag (start).
  expect(r.run(repeat(4, RACE({ state: 2 })))).toEqual([{ stop: true, why: 'new session', at: expect.any(Number) }]);
  expect(r.run([...repeat(10, RACE({ state: 3 })), ...repeat(4, RACE({ state: 4 }))])).toEqual([{ start: true, why: 'green flag', at: expect.any(Number) }]);
});

test('a recording he started himself is not stopped by any of this, and a Stop he pressed in a race is not undone by the green flag', () => {
  const r = rig();
  // He pressed Record on the desk (not auto) in practice, then left the car: the rules say nothing.
  r.keeper.recording = true; r.keeper.auto = false;
  expect(r.run(repeat(10, PRACTICE()))).toEqual([]);
  expect(r.run(repeat(10, PRACTICE({ onTrack: 0 })), { inCar: false })).toEqual([]);
  // In a race, under the green flag, he pressed Stop: the flag is used up until he gets back in the car.
  r.keeper.recording = false; r.keeper.auto = false;
  r.run(repeat(4, RACE({ state: 4 })));
  expect(r.keeper.recording).toBe(true);
  r.keeper.recording = false; r.keeper.auto = false;     // his Stop
  expect(r.run(repeat(20, RACE({ state: 4 })))).toEqual([]);
  // Out of the car and back in (a tow, say): the green flag counts again.
  r.run(repeat(6, RACE({ state: 4, onTrack: 0 })), { inCar: false });
  expect(r.run(repeat(4, RACE({ state: 4 })))).toEqual([{ start: true, why: 'green flag', at: expect.any(Number) }]);
  // A recording OBS started by his Ctrl+Space under the green: the flag is used up by it too.
  r.keeper.recording = false; r.keeper.auto = false;
  r.run(repeat(6, RACE({ state: 4, onTrack: 0 })), { inCar: false });
  r.keeper.recording = true; r.keeper.auto = false;
  r.run(repeat(4, RACE({ state: 4 })));
  r.keeper.recording = false;
  expect(r.run(repeat(10, RACE({ state: 4 })))).toEqual([]);
});

test('a start the keeper could not make (OBS closed) is asked for again while the flag holds; the keeper, not the rules, spaces the tries', () => {
  const r = rig();
  const asked = r.run(repeat(10, RACE({ state: 4 })), { follow: false });
  expect(asked.length).toBeGreaterThanOrEqual(3);   // every second or so over five seconds
  expect(asked.every((d) => d.start && d.why === 'green flag')).toBe(true);
  // Once it is recording, no more.
  r.keeper.recording = true; r.keeper.auto = true;
  expect(r.run(repeat(10, RACE({ state: 4 })))).toEqual([]);
});

test('the demo, a sim not running, no payload, and out of the car are nothing to start from; a break in the telemetry does not stop a recording by itself', () => {
  const r = rig();
  expect(r.run(repeat(10, { ...RACE({ state: 4 }), 'RacingDesk.Plugin.DemoMode': 1 }))).toEqual([]);
  expect(r.run(repeat(10, { ...RACE({ state: 4 }), 'DataCorePlugin.GameRunning': 0 }))).toEqual([]);
  expect(r.run(repeat(10, null))).toEqual([]);
  expect(r.run(repeat(10, RACE({ state: 4 })), { inCar: false })).toEqual([]);
  // Recording, and the telemetry stops answering while main.js still says he is in the car: nothing.
  r.keeper.recording = true; r.keeper.auto = true;
  r.run(repeat(2, RACE({ state: 4 })));
  expect(r.run(repeat(10, null))).toEqual([]);
  // Then it says he is out: the stop.
  expect(r.run(repeat(4, null), { inCar: false })).toEqual([{ stop: true, why: 'out of the car', at: expect.any(Number) }]);
});

test('a poll that got no answer at pit exit does not lose the start: the edge and the hold wait for the next answer', () => {
  // Out of the pit lane, then a poll the host did not answer in time, then answers again: the start, a second after the exit.
  const r = rig();
  r.run(repeat(4, PRACTICE({ pit: true })));
  const out = r.run([PRACTICE(), null, ...repeat(4, PRACTICE())]);
  expect(out).toEqual([{ start: true, why: 'pit exit', at: expect.any(Number) }]);
  expect(out[0].at - (r.now() - 500 * 6)).toBe(1000);
  // The silence between the last frame in the pit lane and the first out of it.
  const q = rig();
  q.run(repeat(4, PRACTICE({ pit: true })));
  expect(q.run([null, ...repeat(4, PRACTICE())])).toEqual([{ start: true, why: 'pit exit', at: expect.any(Number) }]);
});

test('the holds are by the clock: fed once a second, a start still comes a second on, and the chequered flag five seconds on', () => {
  let clock = 0;
  const rules = ar.createAutoRecord({ now: () => clock });
  const feed = (payload, extra = {}) => rules.feed({ payload, inCar: true, recording: false, auto: false, ...extra });
  expect(feed(RACE({ state: 4 }))).toBeNull();
  clock = 999;
  expect(feed(RACE({ state: 4 }))).toBeNull();
  clock = 1000;
  expect(feed(RACE({ state: 4 }))).toEqual({ start: true, why: 'green flag' });
  clock = 1500;
  expect(feed(RACE({ state: 4 }), { recording: true, auto: true })).toBeNull();   // seen running under the green: the flag is used up
  expect(rules.state().armed).toBe(false);
  clock = 2000;
  expect(feed(RACE({ state: 5, end: true, lap: 9 }), { recording: true, auto: true })).toBeNull();
  clock = 6999;
  expect(feed(RACE({ state: 5, end: true, lap: 9 }), { recording: true, auto: true })).toBeNull();
  clock = 7000;
  expect(feed(RACE({ state: 5, end: true, lap: 9 }), { recording: true, auto: true })).toEqual({ stop: true, why: 'end of race' });
  expect(rules.state()).toMatchObject({ candidate: null, armed: false });
  rules.reset();
  expect(rules.state()).toMatchObject({ candidate: null, armed: true, startedIn: null, lastSession: null, finished: false });
});

test('the leader finishes while he is a lap and a minute from his own flag: the recording runs on, and stops five seconds after HIS finish', () => {
  const r = rig();
  r.run(repeat(4, RACE({ state: 4, lap: 11 })));
  expect(r.keeper.recording).toBe(true);
  // The leader takes the flag: the flag bit and SessionState 5 are the session's, up for everyone. He is mid-lap for
  // another ninety seconds (a hundred and eighty polls) and nothing stops.
  expect(r.run(repeat(180, RACE({ state: 5, end: true, flag: 'checkered', lap: 11 })))).toEqual([]);
  expect(r.keeper.recording).toBe(true);
  // He crosses the line: his lap count goes up. Five seconds on, the stop.
  const finish = r.run(repeat(16, RACE({ state: 5, end: true, flag: 'checkered', lap: 12 })));
  expect(finish).toEqual([{ stop: true, why: 'end of race', at: expect.any(Number) }]);
  expect(finish[0].at - (r.now() - 500 * 16)).toBe(5000);
  expect(r.keeper.recording).toBe(false);
});

test('his finish seen a poll before the flag, or never (a lap count that is not sent): the cool-down still ends the race, five seconds on', () => {
  // The line crossed in the poll before the state says Checkered: the count is not "up with the flag out", so it waits for the cool-down.
  const r = rig();
  r.run(repeat(4, RACE({ state: 4, lap: 11 })));
  expect(r.run([...repeat(2, RACE({ state: 4, lap: 12 })), ...repeat(40, RACE({ state: 5, end: true, lap: 12 }))])).toEqual([]);
  expect(r.run(repeat(12, RACE({ state: 6, end: true, lap: 12 })))).toEqual([{ stop: true, why: 'end of race', at: expect.any(Number) }]);
  // No lap count in the payload at all.
  const q = rig();
  q.run(repeat(4, RACE({ state: 4 })));
  const noLap = (o) => ({ ...RACE(o), 'DataCorePlugin.GameData.CurrentLap': undefined });
  expect(q.run(repeat(40, noLap({ state: 5, end: true })))).toEqual([]);
  expect(q.run(repeat(12, noLap({ state: 6, end: true })))).toEqual([{ stop: true, why: 'end of race', at: expect.any(Number) }]);
});

test('practice and qualifying have no end of their own: the chequered flag comes out in his last flying lap and nothing stops; a new session or leaving the car does', () => {
  const q = rig();
  q.run([...repeat(4, QUALIFYING({ pit: true })), ...repeat(4, QUALIFYING())]);
  expect(q.keeper.recording).toBe(true);
  // Time runs out on a flying lap: the flag, the state, his lap count going up as he finishes it, the cool-down.
  expect(q.run([...repeat(40, QUALIFYING({ state: 5, end: true, lap: 8 })), ...repeat(40, QUALIFYING({ state: 5, end: true, lap: 9 })), ...repeat(40, QUALIFYING({ state: 6, end: true, lap: 9 }))])).toEqual([]);
  expect(q.keeper.recording).toBe(true);
  expect(q.run(repeat(4, PRACTICE({ num: 3, pit: true })))).toEqual([{ stop: true, why: 'new session', at: expect.any(Number) }]);
  const p = rig();
  p.run([...repeat(4, PRACTICE({ pit: true })), ...repeat(4, PRACTICE())]);
  expect(p.run(repeat(60, PRACTICE({ state: 5, end: true, lap: 12 })))).toEqual([]);
  expect(p.run(repeat(6, PRACTICE({ state: 5, end: true, lap: 12, onTrack: 0, pit: true })), { inCar: false })).toEqual([{ stop: true, why: 'out of the car', at: expect.any(Number) }]);
});

test('a recording whose first poll got no answer is still stopped by a new session: the session it began in is the first live frame it is seen in', () => {
  const r = rig();
  // Auto-record started it; the first feed after it is a poll with no payload.
  r.keeper.recording = true; r.keeper.auto = true;
  expect(r.run([null, null, ...repeat(4, RACE({ state: 4, num: 2 }))])).toEqual([]);
  expect(r.rules.state().startedIn).toBe('n2');
  const change = r.run(repeat(4, RACE({ state: 2, num: 3 })));
  expect(change).toEqual([{ stop: true, why: 'new session', at: expect.any(Number) }]);
});
