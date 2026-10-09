/**
 * In the car or not (modules/js/in-car.js) — the one place it is decided, for the window, the page and the
 * recorder alike. First what a single payload says; then what a run of polls says: getting in is believed at
 * once, getting out once it has lasted two seconds, and a source that has gone quiet is out. The clock is a
 * number the test moves; there are no timers to wait for.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import { readFileSync } from 'node:fs';
import { MOCK_TELEMETRY, MOCK_DEMO } from '../helpers.mjs';

const require = createRequire(import.meta.url);
const { KEYS, inCar, createInCarSignal } = require('../../modules/js/in-car.js');

// A whole payload as the plugin sent it with the sim closed.
const SIM_CLOSED = JSON.parse(readFileSync(new URL('../golden/fixtures/base-payload.json', import.meta.url), 'utf8'));
const IN_THE_CAR = MOCK_TELEMETRY;
const AT_THE_MENUS = { ...MOCK_TELEMETRY, [KEYS.sessionState]: 0 };

test.describe('inCar: one payload', () => {
  test('a session under way, the sim running: in the car', () => {
    expect(inCar(IN_THE_CAR)).toBe(true);
    for (const state of [1, 2, 3, 4, 5, 6, '4']) {
      expect(inCar({ ...IN_THE_CAR, [KEYS.sessionState]: state }), `SessionState ${state}`).toBe(true);
    }
  });

  test('the sim closed, or at its menus: out', () => {
    expect(inCar(SIM_CLOSED)).toBe(false);
    expect(inCar(AT_THE_MENUS)).toBe(false);
    expect(inCar({ ...IN_THE_CAR, [KEYS.gameRunning]: 0 })).toBe(false);
  });

  test('no payload, or something that is not one: out', () => {
    for (const nothing of [null, undefined, '', 0, 'in the car', []]) {
      expect(inCar(nothing), String(nothing)).toBe(false);
    }
    expect(inCar({})).toBe(false);
  });

  test('a payload under the names from before the rename says nothing the HUD can read: out', () => {
    expect(inCar({ 'DataCorePlugin.GameRunning': 1, 'K10Motorsports.Plugin.Grid.SessionState': 4 })).toBe(false);
  });

  test('demo mode is in the car, with the sim closed too', () => {
    expect(inCar(MOCK_DEMO)).toBe(true);
    expect(inCar({ ...SIM_CLOSED, [KEYS.demoMode]: 1 })).toBe(true);
  });

  test("iRacing's IsOnTrack, when a host sends it, is the answer: the garage screen and a replay are out", () => {
    const inTheGarage = { ...IN_THE_CAR, [KEYS.onTrack]: 0 };
    expect(inCar(inTheGarage)).toBe(false);
    expect(inCar({ ...IN_THE_CAR, [KEYS.onTrack]: false })).toBe(false);
    expect(inCar({ ...IN_THE_CAR, [KEYS.onTrack]: 'False' })).toBe(false);
    for (const yes of [1, true, 'True', '1']) {
      expect(inCar({ ...IN_THE_CAR, [KEYS.onTrack]: yes }), String(yes)).toBe(true);
    }
    // Not without the sim, whatever the key was left at.
    expect(inCar({ ...SIM_CLOSED, [KEYS.onTrack]: 1 })).toBe(false);
  });

  test('without IsOnTrack the session is all there is to go on', () => {
    expect(KEYS.onTrack in IN_THE_CAR).toBe(false);
    expect(inCar({ ...IN_THE_CAR, [KEYS.onTrack]: null })).toBe(true);
    expect(inCar({ ...IN_THE_CAR, [KEYS.onTrack]: '' })).toBe(true);
  });

  test("Assetto Corsa and EVO (2026-10-09): the same key carries the game's status, and iRacing's session state is nought there", () => {
    // SimHub publishes no SessionState for Assetto Corsa, so without the key the HUD would never have come on; the host
    // sends the key from the graphics page's status (TelemetryCapture.InCarAssetto), and the page reads it as it does iRacing's.
    for (const game of ['AssettoCorsa', 'AssettoCorsaEVO']) {
      const live = { ...IN_THE_CAR, 'RacingDesk.Plugin.GameId': game, [KEYS.sessionState]: 0, [KEYS.onTrack]: 1 };
      expect(inCar(live), game).toBe(true);
      expect(inCar({ ...live, [KEYS.onTrack]: 0 }), `${game}: a replay, the pause, loading`).toBe(false);
      expect(inCar({ ...live, [KEYS.onTrack]: undefined }), `${game}: nothing said, no session state`).toBe(false);
      expect(inCar({ ...live, [KEYS.gameRunning]: 0 }), `${game}: closed`).toBe(false);
    }
  });
});

test.describe('createInCarSignal: a run of polls', () => {
  function signalAt(start = 1000) {
    const clock = { at: start };
    const said = [];
    const signal = createInCarSignal({ now: () => clock.at, onChange: (inCar) => said.push({ at: clock.at, inCar }) });
    // Feed `payload` every `every` ms until `until` ms have gone by.
    const run = (payload, until, every = 33) => {
      const end = clock.at + until;
      while (clock.at < end) {
        clock.at += every;
        signal.feed(payload);
      }
    };
    return { clock, said, signal, run };
  }

  test('out of the car until the telemetry says otherwise', () => {
    const { signal, said, run } = signalAt();
    expect(signal.inCar()).toBe(false);
    run(SIM_CLOSED, 5000, 1000);
    run(null, 5000, 1000);
    expect(signal.inCar()).toBe(false);
    expect(said).toEqual([]);
  });

  test('getting in is believed at the first poll that says so', () => {
    const { signal, said, clock } = signalAt();
    signal.feed(AT_THE_MENUS);
    clock.at += 1000;
    expect(signal.feed(IN_THE_CAR)).toBe(true);
    expect(said).toEqual([{ at: 2000, inCar: true }]);
  });

  test('getting out is believed after two seconds of it — with frames arriving the whole time', () => {
    // The fault this replaces: the leave timer was re-armed by every frame, so with a frame every 33 ms it never
    // ran, and the HUD stayed on screen for as long as the source answered.
    const { signal, said, run } = signalAt();
    run(IN_THE_CAR, 3000);
    run(AT_THE_MENUS, 1900);
    expect(signal.inCar()).toBe(true);
    run(AT_THE_MENUS, 200);
    expect(signal.inCar()).toBe(false);
    expect(said.map((s) => s.inCar)).toEqual([true, false]);
    expect(said[1].at - said[0].at).toBeGreaterThanOrEqual(3000 + 2000 - 33);
    expect(said[1].at - said[0].at).toBeLessThan(3000 + 2000 + 100);
  });

  test('twice a second, as the main process asks while he is in the car, is enough to notice', () => {
    const { signal, said, run } = signalAt();
    run(IN_THE_CAR, 2000, 500);
    run(SIM_CLOSED, 2000, 500);
    expect(signal.inCar()).toBe(true);
    run(SIM_CLOSED, 500, 500);
    expect(signal.inCar()).toBe(false);
    // The two seconds are counted from the first poll that said out, half a second after the last that said in.
    expect(said[1].at - said[0].at).toBe(1500 + 500 + 2000);
  });

  test('once a second is enough too: out at the first poll after two seconds of it', () => {
    const { signal, said, run } = signalAt();
    run(IN_THE_CAR, 2000, 1000);
    run(SIM_CLOSED, 2000, 1000);
    expect(signal.inCar()).toBe(true);
    run(SIM_CLOSED, 1000, 1000);
    expect(signal.inCar()).toBe(false);
    expect(said[1].at - said[0].at).toBe(1000 + 1000 + 2000);
  });

  test('a dip between sessions is ridden through, and the two seconds start again after it', () => {
    const { signal, said, run } = signalAt();
    run(IN_THE_CAR, 1000);
    run(AT_THE_MENUS, 1500);
    run(IN_THE_CAR, 100);
    run(AT_THE_MENUS, 1500);
    expect(signal.inCar()).toBe(true);
    expect(said).toHaveLength(1);
    run(AT_THE_MENUS, 600);
    expect(signal.inCar()).toBe(false);
  });

  test('a source that stops answering is out of the car after three seconds', () => {
    const { signal, said, run } = signalAt();
    run(IN_THE_CAR, 2000);
    run(null, 2900, 100);
    expect(signal.inCar()).toBe(true);
    run(null, 200, 100);
    expect(signal.inCar()).toBe(false);
    expect(said.map((s) => s.inCar)).toEqual([true, false]);
  });

  test('a poll or two lost is not the source gone quiet', () => {
    const { signal, said, run } = signalAt();
    run(IN_THE_CAR, 1000);
    for (let i = 0; i < 5; i++) {
      run(null, 2000, 500);
      run(IN_THE_CAR, 500, 500);
    }
    expect(signal.inCar()).toBe(true);
    expect(said).toHaveLength(1);
  });

  test('it answers again, and he is in the car: back at once', () => {
    const { signal, said, run } = signalAt();
    run(IN_THE_CAR, 1000);
    run(null, 4000, 500);
    expect(signal.inCar()).toBe(false);
    run(IN_THE_CAR, 500, 500);
    expect(signal.inCar()).toBe(true);
    expect(said.map((s) => s.inCar)).toEqual([true, false, true]);
  });

  test('the times can be set, and nothing is said twice', () => {
    const clock = { at: 0 };
    const said = [];
    const signal = createInCarSignal({ leaveMs: 500, staleMs: 800, now: () => clock.at, onChange: (v) => said.push(v) });
    signal.feed(IN_THE_CAR);
    signal.feed(IN_THE_CAR);
    clock.at = 100; signal.feed(AT_THE_MENUS);
    clock.at = 599; signal.feed(AT_THE_MENUS);
    expect(signal.inCar()).toBe(true);
    clock.at = 600; signal.feed(AT_THE_MENUS);
    clock.at = 700; signal.feed(AT_THE_MENUS);
    expect(said).toEqual([true, false]);

    signal.feed(IN_THE_CAR);
    clock.at = 1499; signal.feed(null);
    expect(signal.inCar()).toBe(true);
    clock.at = 1500; signal.feed(null);
    expect(said).toEqual([true, false, true, false]);
  });
});
