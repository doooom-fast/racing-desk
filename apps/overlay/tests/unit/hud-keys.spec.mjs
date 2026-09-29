/**
 * The HUD's keys are held only while the driver is in the car: held, they are taken from every other program on
 * the machine. No Electron here — what registers and unregisters a key is handed in.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createHudKeys } = require('../../modules/js/hud-keys.js');
const { createHudVisibility } = require('../../modules/js/hud-visibility.js');

function machine({ taken = [] } = {}) {
  const held = new Map();
  const log = [];
  const said = [];
  const keys = createHudKeys({
    keys: { 'Ctrl+Shift+H': () => said.push('H'), 'Ctrl+Shift+V': () => said.push('V'), 'Ctrl+Shift+P': () => said.push('P') },
    register: (key, act) => {
      if (taken.includes(key)) return false;
      held.set(key, act);
      return true;
    },
    unregister: (key) => { held.delete(key); },
    log: (line) => log.push(line),
  });
  return { keys, held, log, said };
}

test('out of the car no key is held', () => {
  const m = machine();
  expect([...m.held.keys()]).toEqual([]);
  m.keys.hold(false);
  expect([...m.held.keys()]).toEqual([]);
  expect(m.log).toEqual([]);
});

test('in the car they are held, and do what they do; out of it they are the computer\'s again', () => {
  const m = machine();
  m.keys.hold(true);
  expect([...m.held.keys()].sort()).toEqual(['Ctrl+Shift+H', 'Ctrl+Shift+P', 'Ctrl+Shift+V']);
  m.held.get('Ctrl+Shift+V')();
  expect(m.said).toEqual(['V']);

  m.keys.hold(false);
  expect([...m.held.keys()]).toEqual([]);
  expect(m.keys.held()).toEqual([]);
  expect(m.log.filter((line) => /held: he is in the car|let go: he is out of the car/.test(line))).toHaveLength(2);
});

test('told the same twice, it does it once', () => {
  let registered = 0;
  const keys = createHudKeys({ keys: { A: () => {} }, register: () => { registered++; return true; }, unregister: () => { registered--; } });
  keys.hold(true);
  keys.hold(true);
  keys.hold(1);
  expect(registered).toBe(1);
  keys.hold(false);
  keys.hold(false);
  expect(registered).toBe(0);
});

test('a key another program holds is not had, the rest are, and it is not let go of later', () => {
  const m = machine({ taken: ['Ctrl+Shift+V'] });
  let unregistered = [];
  const keys = createHudKeys({
    keys: { 'Ctrl+Shift+H': () => {}, 'Ctrl+Shift+V': () => {} },
    register: (key) => key !== 'Ctrl+Shift+V',
    unregister: (key) => unregistered.push(key),
    log: (line) => m.log.push(line),
  });
  keys.hold(true);
  expect(keys.held()).toEqual(['Ctrl+Shift+H']);
  expect(m.log.some((line) => line.includes('Ctrl+Shift+V is held by another program'))).toBe(true);
  keys.hold(false);
  expect(unregistered).toEqual(['Ctrl+Shift+H']);   // not the other program's key
});

test('a key that throws does not stop the rest', () => {
  const held = [];
  const keys = createHudKeys({
    keys: { A: () => {}, B: () => {}, C: () => {} },
    register: (key) => { if (key === 'B') throw new Error('no'); held.push(key); return true; },
    unregister: () => {},
  });
  expect(() => keys.hold(true)).not.toThrow();
  expect(held).toEqual(['A', 'C']);
});

test('hud-visibility says when he gets in and out, and what it is told to do with that may throw', async () => {
  const heard = [];
  let payload = null;
  let at = 0;
  const win = {
    visible: false,
    isDestroyed: () => false,
    isVisible() { return this.visible; },
    showInactive() { this.visible = true; },
    hide() { this.visible = false; },
    setAlwaysOnTop() {}, setIgnoreMouseEvents() {}, setFocusable() {},
    webContents: { send() {} },
  };
  const hud = createHudVisibility({
    getWindow: () => win,
    fetchPayload: async () => payload,
    onInCar: (inCar) => { heard.push(inCar); if (heard.length === 1) throw new Error('a key could not be had'); },
    now: () => at,
    setTimer: () => null,
    clearTimer: () => {},
  });
  hud.pageLoaded();

  const car = { 'DataCorePlugin.GameRunning': 1, 'RacingDesk.Plugin.Grid.SessionState': 4, 'DataCorePlugin.GameRawData.Telemetry.IsOnTrack': 1 };
  const garage = { ...car, 'DataCorePlugin.GameRawData.Telemetry.IsOnTrack': 0 };

  payload = garage;
  await hud.poll();
  expect(heard).toEqual([]);

  payload = car;
  await expect(hud.poll()).resolves.toMatchObject({ inCar: true, visible: true });
  expect(heard).toEqual([true]);

  payload = garage;
  at += 1000;
  await hud.poll();
  expect(heard).toEqual([true]);             // not yet: two seconds out before it is believed
  at += 2500;
  await hud.poll();
  expect(heard).toEqual([true, false]);
  expect(win.visible).toBe(false);
});
