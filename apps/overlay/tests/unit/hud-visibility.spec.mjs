/**
 * When the HUD's window is on screen (modules/js/hud-visibility.js): while the driver is in the car, he has not
 * switched the HUD off, and the page is loaded — never otherwise, and never by taking the focus from the sim.
 *
 * A fake window, a fake telemetry, a clock the test moves and timers the test runs: no Electron, no ports, nothing
 * waited for. main.js gives the same object the real window and http.get.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { MOCK_TELEMETRY, MOCK_DEMO } from '../helpers.mjs';

const require = createRequire(import.meta.url);
const {
  createHudVisibility, fetchPayload, telemetryUrl, IN_CAR_POLL_MS, OUT_OF_CAR_POLL_MS, RELOAD_AFTER_MS, RELOADS_AT_MOST,
} = require('../../modules/js/hud-visibility.js');
const { inCar } = require('../../modules/js/in-car.js');

const SIM_CLOSED = JSON.parse(readFileSync(new URL('../golden/fixtures/base-payload.json', import.meta.url), 'utf8'));
const IN_THE_CAR = MOCK_TELEMETRY;
const AT_THE_MENUS = { ...MOCK_TELEMETRY, 'RacingDesk.Plugin.Grid.SessionState': 0 };
const NOTHING_ANSWERS = null;

// The whole payload, as the app's host sends it with the sim running and a race under way: what differs between
// the garage screen, the car and a replay is the one key.
const ON_TRACK = 'DataCorePlugin.GameRawData.Telemetry.IsOnTrack';
const SESSION_UNDER_WAY = { ...SIM_CLOSED, 'DataCorePlugin.GameRunning': 1, 'RacingDesk.Plugin.Grid.SessionState': 4 };
const IN_THE_GARAGE = { ...SESSION_UNDER_WAY, [ON_TRACK]: 0 };
const DRIVING = { ...SESSION_UNDER_WAY, [ON_TRACK]: 1 };
const WATCHING_A_REPLAY = { ...SESSION_UNDER_WAY, [ON_TRACK]: 0 };

function fakeWindow() {
  const win = {
    visible: false,
    destroyed: false,
    calls: [],
    sent: [],
    isDestroyed: () => win.destroyed,
    isVisible: () => win.visible,
    show: () => { win.calls.push('show'); win.visible = true; },
    showInactive: () => { win.calls.push('showInactive'); win.visible = true; },
    hide: () => { win.calls.push('hide'); win.visible = false; },
    focus: () => { win.calls.push('focus'); },
    setAlwaysOnTop: (...args) => { win.calls.push(['setAlwaysOnTop', ...args]); },
    setIgnoreMouseEvents: (...args) => { win.calls.push(['setIgnoreMouseEvents', ...args]); },
    setFocusable: (...args) => { win.calls.push(['setFocusable', ...args]); },
    webContents: { send: (channel, value) => { win.sent.push([channel, value]); } },
  };
  return win;
}

// The app as it is a moment after starting: the window made, hidden, its page loaded, the sim closed.
// `loads` counts the times the page was loaded again; `booked` are the timers set, run when the test says
// (the polls here are the test's own, so the only timers are the ones a load is booked with).
function rig({ keepVisible = false, loaded = true, window: given, beforeReveal } = {}) {
  const clock = { at: 10000 };
  const feed = { payload: SIM_CLOSED, asked: 0 };
  const win = given === undefined ? fakeWindow() : given;
  const switched = [];
  const page = { loads: 0 };
  const booked = [];
  const said = [];
  const hud = createHudVisibility({
    getWindow: () => win,
    fetchPayload: async () => { feed.asked++; return feed.payload; },
    loadPage: () => { page.loads++; },
    keepVisible,
    beforeReveal,
    onSwitch: (off) => switched.push(off),
    now: () => clock.at,
    setTimer: (fn, ms) => { const t = { fn, ms, cleared: false, ran: false }; booked.push(t); return t; },
    clearTimer: (t) => { t.cleared = true; },
    log: (line) => said.push(line),
  });
  if (loaded) hud.pageLoaded();
  // `ms` go by, with a poll every `every`.
  const pass = async (ms, every = 500) => {
    for (let t = 0; t < ms; t += every) {
      clock.at += every;
      await hud.poll();
    }
  };
  const getIn = async () => { feed.payload = IN_THE_CAR; await pass(500); };
  const getOut = async () => { feed.payload = SIM_CLOSED; await pass(3000); };
  // The timers booked and not yet run or cleared, run.
  const runTimers = () => {
    for (const t of booked.filter((b) => !b.cleared && !b.ran)) { t.ran = true; t.fn(); }
  };
  const waiting = () => booked.filter((b) => !b.cleared && !b.ran);
  return { clock, feed, win, hud, switched, page, booked, said, pass, getIn, getOut, runTimers, waiting };
}

const shown = (win) => win.calls.filter((c) => c === 'show' || c === 'showInactive' || c === 'focus');

test.describe('out of the car', () => {
  test('hidden when the app starts, and nothing shows it: the sim closed, its menus, nothing answering', async () => {
    const { win, feed, pass, hud } = rig();
    expect(win.isVisible()).toBe(false);
    for (const payload of [SIM_CLOSED, AT_THE_MENUS, NOTHING_ANSWERS, {}, SIM_CLOSED]) {
      feed.payload = payload;
      await pass(5000, 1000);
      expect(win.isVisible()).toBe(false);
    }
    expect(win.calls).toEqual([]);
    expect(hud.state()).toEqual({ inCar: false, hudOff: false, pageReady: true, visible: false });
  });

  test('a telemetry that throws is a telemetry that does not answer', async () => {
    const win = fakeWindow();
    const hud = createHudVisibility({ getWindow: () => win, fetchPayload: async () => { throw new Error('ECONNRESET'); } });
    hud.pageLoaded();
    expect(await hud.poll()).toMatchObject({ inCar: false, visible: false });
  });
});

test.describe('in the car', () => {
  test('shown at the first poll that says so, without taking the focus from the sim', async () => {
    const { win, getIn, hud } = rig();
    await getIn();
    expect(win.isVisible()).toBe(true);
    expect(shown(win)).toEqual(['showInactive']);
    expect(win.calls).toEqual([
      'showInactive',
      ['setAlwaysOnTop', true, 'screen-saver'],
      ['setIgnoreMouseEvents', true, { forward: true }],
      ['setFocusable', false],
    ]);
    expect(hud.state()).toEqual({ inCar: true, hudOff: false, pageReady: true, visible: true });
  });

  test('shown once, however long he drives', async () => {
    const { win, getIn, pass } = rig();
    await getIn();
    await pass(60000);
    expect(shown(win)).toEqual(['showInactive']);
    expect(win.calls).not.toContain('hide');
  });

  test('demo mode is in the car', async () => {
    const { win, feed, pass } = rig();
    feed.payload = MOCK_DEMO;
    await pass(500);
    expect(win.isVisible()).toBe(true);
  });

  test('he gets out: hidden two seconds later, the source answering all the while', async () => {
    const { win, feed, getIn, pass } = rig();
    await getIn();
    feed.payload = AT_THE_MENUS;
    await pass(2000);
    expect(win.isVisible()).toBe(true);
    await pass(500);
    expect(win.isVisible()).toBe(false);
    expect(win.calls.filter((c) => c === 'hide')).toHaveLength(1);
  });

  test('the sim closes: hidden', async () => {
    const { win, feed, getIn, pass } = rig();
    await getIn();
    feed.payload = SIM_CLOSED;
    await pass(3000);
    expect(win.isVisible()).toBe(false);
  });

  test('the telemetry stops answering: hidden three seconds later', async () => {
    const { win, feed, getIn, pass } = rig();
    await getIn();
    feed.payload = NOTHING_ANSWERS;
    await pass(2500);
    expect(win.isVisible()).toBe(true);
    await pass(500);
    expect(win.isVisible()).toBe(false);
  });

  test('between two sessions the HUD does not blink', async () => {
    const { win, feed, getIn, pass } = rig();
    await getIn();
    feed.payload = AT_THE_MENUS;
    await pass(1500);
    feed.payload = IN_THE_CAR;
    await pass(5000);
    expect(win.calls).not.toContain('hide');
    expect(shown(win)).toEqual(['showInactive']);
  });

  test('and back in again: shown again', async () => {
    const { win, feed, getIn, pass } = rig();
    await getIn();
    feed.payload = SIM_CLOSED;
    await pass(3000);
    await getIn();
    expect(win.isVisible()).toBe(true);
    expect(shown(win)).toEqual(['showInactive', 'showInactive']);
  });
});

test.describe("the garage, the car, a replay: the sim's own IsOnTrack, in the payload the host sends", () => {
  test('the payloads are what they are called', () => {
    expect(Object.keys(SESSION_UNDER_WAY).length).toBeGreaterThan(300);
    expect(ON_TRACK in SESSION_UNDER_WAY).toBe(false);
    expect(IN_THE_GARAGE).toMatchObject({ 'DataCorePlugin.GameRunning': 1, 'RacingDesk.Plugin.Grid.SessionState': 4, [ON_TRACK]: 0 });
    // Without the key the same payload is in the car: it is the key that keeps the garage off the screen.
    expect(inCar(SESSION_UNDER_WAY)).toBe(true);
    expect(inCar(IN_THE_GARAGE)).toBe(false);
    expect(inCar(DRIVING)).toBe(true);
  });

  test('in the garage the window stays hidden; in the car it is revealed, the sim keeping the focus; in a replay it is hidden two seconds on', async () => {
    const { win, feed, pass, hud } = rig();
    feed.payload = IN_THE_GARAGE;
    await pass(10000, 1000);
    expect(win.isVisible()).toBe(false);
    expect(win.calls).toEqual([]);
    expect(win.sent).toEqual([['in-race-state', false]]);

    feed.payload = DRIVING;
    await pass(500);
    expect(win.isVisible()).toBe(true);
    expect(shown(win)).toEqual(['showInactive']);
    expect(win.sent[win.sent.length - 1]).toEqual(['in-race-state', true]);

    feed.payload = WATCHING_A_REPLAY;
    await pass(2000);
    expect(win.isVisible()).toBe(true);
    await pass(500);
    expect(win.isVisible()).toBe(false);
    expect(win.calls.filter((c) => c === 'hide')).toHaveLength(1);
    expect(win.sent[win.sent.length - 1]).toEqual(['in-race-state', false]);
    expect(hud.state()).toEqual({ inCar: false, hudOff: false, pageReady: true, visible: false });

    // And it stays hidden for as long as the replay runs, with nothing shown and hidden again.
    await pass(30000, 1000);
    expect(shown(win)).toEqual(['showInactive']);
    expect(win.calls.filter((c) => c === 'hide')).toHaveLength(1);
  });
});

test.describe("the driver's switch: the key and the Stream Deck, in the car", () => {
  test('in the car it takes the HUD off the screen, and puts it back', async () => {
    const { win, hud, getIn, switched } = rig();
    await getIn();
    expect(hud.toggle()).toEqual({ ok: true, visible: false, hudOff: true });
    expect(win.isVisible()).toBe(false);
    expect(hud.toggle()).toEqual({ ok: true, visible: true, hudOff: false });
    expect(win.isVisible()).toBe(true);
    expect(switched).toEqual([true, false]);
    expect(shown(win)).toEqual(['showInactive', 'showInactive']);
  });

  test('off stays off when he gets out and in again', async () => {
    const { win, hud, getIn, getOut, pass } = rig();
    await getIn();
    hud.toggle();
    await getOut();
    await getIn();
    await pass(10000);
    expect(win.isVisible()).toBe(false);
    expect(shown(win)).toEqual(['showInactive']);
    hud.toggle();
    expect(win.isVisible()).toBe(true);
  });

  test('out of the car it switches nothing, and says so', async () => {
    // Pressed at the desktop it used to switch the HUD off, unseen: the window is hidden there either way. Then
    // there was no HUD when he got in.
    const { win, hud, feed, pass, getIn, switched, said } = rig();
    for (const payload of [SIM_CLOSED, AT_THE_MENUS, IN_THE_GARAGE, NOTHING_ANSWERS]) {
      feed.payload = payload;
      await pass(1000, 1000);
      expect(hud.toggle()).toEqual({ ok: false, reason: 'out of the car', visible: false, hudOff: false });
    }
    expect(switched).toEqual([]);
    expect(win.calls).toEqual([]);
    expect(said.filter((line) => /switch/.test(line))).toHaveLength(4);
    await getIn();
    expect(win.isVisible()).toBe(true);
  });

  test('out of the car it does not switch the HUD back on either: off is off until it is seen to be switched', async () => {
    const { win, hud, getIn, getOut, switched } = rig();
    await getIn();
    hud.toggle();
    await getOut();
    expect(hud.toggle()).toEqual({ ok: false, reason: 'out of the car', visible: false, hudOff: true });
    await getIn();
    expect(win.isVisible()).toBe(false);
    expect(hud.toggle()).toEqual({ ok: true, visible: true, hudOff: false });
    expect(switched).toEqual([true, false]);
  });

  test('in the car with no page to show, the same: nothing it did would be seen', async () => {
    const { win, hud, getIn, switched } = rig({ loaded: false });
    await getIn();
    expect(hud.toggle()).toEqual({ ok: false, reason: 'the HUD page is not loaded', visible: false, hudOff: false });
    expect(switched).toEqual([]);
    hud.pageLoaded();
    expect(win.isVisible()).toBe(true);
    expect(hud.toggle()).toEqual({ ok: true, visible: false, hudOff: true });
  });

  test('no window: it says so, and the switch stays where it was', () => {
    for (const window of [null, Object.assign(fakeWindow(), { destroyed: true })]) {
      const { hud, switched } = rig({ window, loaded: false });
      expect(hud.toggle()).toEqual({ ok: false, reason: 'no window' });
      expect(hud.toggle({ anywhere: true })).toEqual({ ok: false, reason: 'no window' });
      expect(switched).toEqual([]);
      expect(hud.state().hudOff).toBe(false);
    }
  });
});

test.describe("the driver's switch: the tray's, which works anywhere", () => {
  const tray = { anywhere: true };

  test('switched off out of the car, it is off when he gets in', async () => {
    const { win, hud, getIn, switched } = rig();
    expect(hud.toggle(tray)).toEqual({ ok: true, visible: false, hudOff: true });
    expect(switched).toEqual([true]);
    await getIn();
    expect(win.isVisible()).toBe(false);
    expect(win.calls).toEqual([]);
  });

  test('switched on out of the car, nothing comes on screen until he gets in', async () => {
    const { win, hud, pass, getIn } = rig();
    hud.toggle(tray);
    expect(hud.toggle(tray)).toEqual({ ok: true, visible: false, hudOff: false });
    await pass(5000, 1000);
    expect(win.isVisible()).toBe(false);
    expect(win.calls).toEqual([]);
    await getIn();
    expect(win.isVisible()).toBe(true);
  });

  test('in the car it takes the HUD off the screen and puts it back, as the key does', async () => {
    const { win, hud, getIn, switched } = rig();
    await getIn();
    expect(hud.toggle(tray)).toEqual({ ok: true, visible: false, hudOff: true });
    expect(hud.toggle()).toEqual({ ok: true, visible: true, hudOff: false });
    expect(hud.toggle()).toEqual({ ok: true, visible: false, hudOff: true });
    expect(hud.toggle(tray)).toEqual({ ok: true, visible: true, hudOff: false });
    expect(win.isVisible()).toBe(true);
    expect(switched).toEqual([true, false, true, false]);
  });

  test('switched off in the car with the key, it is switched back on from the tray at the desktop', async () => {
    const { win, hud, getIn, getOut } = rig();
    await getIn();
    hud.toggle();
    await getOut();
    expect(hud.toggle(tray)).toEqual({ ok: true, visible: false, hudOff: false });
    await getIn();
    expect(win.isVisible()).toBe(true);
  });
});

test.describe('quitting the overlay', () => {
  test('in the car the HUD is put away, and comes back the way a switched-off HUD does', async () => {
    const { win, hud, getIn, switched } = rig();
    await getIn();
    expect(hud.putAway()).toEqual({ ok: true, visible: false, hudOff: true });
    expect(win.isVisible()).toBe(false);
    expect(switched).toEqual([true]);
    expect(hud.toggle()).toEqual({ ok: true, visible: true, hudOff: false });
    expect(win.isVisible()).toBe(true);
  });

  test('asked twice, it is away once: the second press does not bring it back', async () => {
    const { win, hud, getIn, switched } = rig();
    await getIn();
    hud.putAway();
    expect(hud.putAway()).toEqual({ ok: true, visible: false, hudOff: true });
    expect(win.isVisible()).toBe(false);
    expect(switched).toEqual([true]);
  });

  test('away is away when he gets out and in again, until he switches it on', async () => {
    const { win, hud, getIn, getOut, pass } = rig();
    await getIn();
    hud.putAway();
    await getOut();
    await getIn();
    await pass(10000);
    expect(win.isVisible()).toBe(false);
    expect(hud.toggle({ anywhere: true })).toEqual({ ok: true, visible: true, hudOff: false });
  });

  test('out of the car it works too, unlike the key that switches: the Stream Deck is pressed from anywhere', async () => {
    const { win, hud, getIn, switched } = rig();
    expect(hud.putAway()).toEqual({ ok: true, visible: false, hudOff: true });
    expect(switched).toEqual([true]);
    await getIn();
    expect(win.isVisible()).toBe(false);
    expect(win.calls).toEqual([]);
  });

  test('the page goes on reading, so the HUD is whole the moment it is switched back on', async () => {
    const { win, hud, getIn } = rig();
    hud.putAway();
    await getIn();
    expect(win.sent[win.sent.length - 1]).toEqual(['in-race-state', true]);
  });

  test('in dev mode the window is hidden, and that is all', () => {
    const { win, hud, switched } = rig({ keepVisible: true });
    win.visible = true;
    expect(hud.putAway()).toEqual({ ok: true, visible: false });
    expect(hud.putAway()).toEqual({ ok: true, visible: false });
    expect(win.calls.filter((c) => c === 'hide')).toHaveLength(1);
    expect(switched).toEqual([]);
  });

  test('no window: it says so', () => {
    for (const window of [null, Object.assign(fakeWindow(), { destroyed: true })]) {
      const { hud, switched } = rig({ window, loaded: false });
      expect(hud.putAway()).toEqual({ ok: false, reason: 'no window' });
      expect(switched).toEqual([]);
      expect(hud.state().hudOff).toBe(false);
    }
  });
});

test.describe('the page', () => {
  test('is told when he gets in and when he gets out, and not at every poll', async () => {
    const { win, feed, getIn, pass } = rig();
    expect(win.sent).toEqual([['in-race-state', false]]);
    await pass(5000, 1000);
    await getIn();
    await pass(5000);
    feed.payload = SIM_CLOSED;
    await pass(5000);
    expect(win.sent).toEqual([['in-race-state', false], ['in-race-state', true], ['in-race-state', false]]);
  });

  test('is told whatever the switch says: switched off, the HUD goes on reading', async () => {
    const { win, hud, getIn } = rig();
    hud.toggle({ anywhere: true });
    await getIn();
    expect(win.isVisible()).toBe(false);
    expect(win.sent[win.sent.length - 1]).toEqual(['in-race-state', true]);
  });

  test('not loaded yet, he is already in the car: shown once it has loaded, and told then', async () => {
    const { win, hud, getIn } = rig({ loaded: false });
    await getIn();
    expect(win.isVisible()).toBe(false);
    expect(win.sent).toEqual([]);
    hud.pageLoaded();
    expect(win.isVisible()).toBe(true);
    expect(win.sent).toEqual([['in-race-state', true]]);
  });

  test('loaded again while he drives: off the screen while it loads, then back and told afresh', async () => {
    // The page used to remember for itself, and main.js for it; after a reload the two disagreed, and nothing
    // put that right.
    const { win, hud, page, getIn, pass, booked } = rig();
    await getIn();
    hud.pageLoading();
    expect(win.isVisible()).toBe(false);
    await pass(2000);
    expect(win.isVisible()).toBe(false);
    hud.pageLoaded();
    expect(win.isVisible()).toBe(true);
    expect(win.sent.slice(-2)).toEqual([['in-race-state', true], ['in-race-state', true]]);
    // It was loading all the while: nothing here loads it a second time.
    expect(page.loads).toBe(0);
    expect(booked).toEqual([]);
  });

  test('a page that cannot be told does not stop the window being put right', async () => {
    const { win, getIn } = rig();
    win.webContents.send = () => { throw new Error('Render frame was disposed'); };
    await getIn();
    expect(win.isVisible()).toBe(true);
  });
});

test.describe('a page that has died is loaded again', () => {
  // Every reason Electron gives for render-process-gone but 'clean-exit'. Only 'crashed' and 'killed' used to
  // load the page again; after any of the others there was no HUD until the app was started again.
  const REASONS = ['crashed', 'killed', 'oom', 'launch-failed', 'abnormal-exit', 'integrity-failure', 'memory-eviction', undefined];

  for (const reason of REASONS) {
    test(`its process gone (${reason}): off the screen, and loaded again two seconds later`, async () => {
      const { win, hud, page, getIn, booked, runTimers, pass } = rig();
      await getIn();
      hud.pageGone(reason);
      expect(win.isVisible()).toBe(false);
      expect(hud.state()).toMatchObject({ inCar: true, pageReady: false, visible: false });
      expect(page.loads).toBe(0);
      expect(booked.map((t) => t.ms)).toEqual([RELOAD_AFTER_MS]);

      // He is in the car all the while, and the polls go on: they load nothing, the timer does.
      await pass(2000);
      expect(page.loads).toBe(0);
      runTimers();
      expect(page.loads).toBe(1);
      await pass(2000);
      expect(page.loads).toBe(1);

      hud.pageLoaded();
      expect(win.isVisible()).toBe(true);
      expect(win.sent[win.sent.length - 1]).toEqual(['in-race-state', true]);
    });
  }

  test('a clean exit is not a death: nothing is booked', async () => {
    const { hud, page, booked, runTimers } = rig();
    hud.pageGone('clean-exit');
    runTimers();
    expect(booked).toEqual([]);
    expect(page.loads).toBe(0);
    expect(hud.state().pageReady).toBe(false);
  });

  test('three times at most without a load finishing, and a load that finishes starts the count again', async () => {
    const { hud, page, runTimers, waiting, said } = rig();
    expect(RELOAD_AFTER_MS).toBe(2000);
    expect(RELOADS_AT_MOST).toBe(3);
    for (let n = 1; n <= 3; n++) {
      hud.pageGone('crashed');
      runTimers();
      expect(page.loads).toBe(n);
    }
    hud.pageGone('crashed');
    expect(waiting()).toEqual([]);
    runTimers();
    expect(page.loads).toBe(3);
    expect(said.filter((line) => /4 times/.test(line))).toHaveLength(1);

    hud.pageLoaded();
    hud.pageGone('oom');
    runTimers();
    expect(page.loads).toBe(4);
  });

  test('past its three tries, he gets in the car: loaded once more — once for getting in, not once a poll', async () => {
    const { win, hud, page, runTimers, getIn, getOut, pass } = rig();
    for (let n = 1; n <= 4; n++) { hud.pageGone('crashed'); runTimers(); }
    expect(page.loads).toBe(3);

    // Out of the car nothing loads it, however long.
    await pass(60000, 1000);
    expect(page.loads).toBe(3);

    await getIn();
    expect(page.loads).toBe(4);
    await pass(60000);
    expect(page.loads).toBe(4);
    expect(win.isVisible()).toBe(false);

    // That load died as well. Nothing more until he gets in again.
    hud.pageGone('crashed');
    runTimers();
    await pass(10000);
    expect(page.loads).toBe(4);
    await getOut();
    await getIn();
    expect(page.loads).toBe(5);

    hud.pageLoaded();
    expect(win.isVisible()).toBe(true);
    expect(shown(win)).toEqual(['showInactive']);
  });

  test('a load that failed is tried again when he gets in', async () => {
    const { win, hud, page, getIn, pass } = rig({ loaded: false });
    hud.pageLoading();
    hud.pageFailed();
    await pass(5000, 1000);
    expect(page.loads).toBe(0);
    await getIn();
    expect(page.loads).toBe(1);
    hud.pageLoaded();
    expect(win.isVisible()).toBe(true);
  });

  test('getting in loads nothing while a load is under way, or booked', async () => {
    // Under way: the app has just started, and he is in the car already.
    const starting = rig({ loaded: false });
    starting.hud.pageLoading();
    await starting.getIn();
    expect(starting.page.loads).toBe(0);

    // Booked: its process went a moment before he got in.
    const { hud, page, getIn, runTimers, getOut } = rig();
    hud.pageGone('crashed');
    await getIn();
    expect(page.loads).toBe(0);
    runTimers();
    expect(page.loads).toBe(1);
    // And under way since: out and in again, it is still the one load.
    await getOut();
    await getIn();
    expect(page.loads).toBe(1);
  });

  test('loaded by something else within the two seconds, the load that was booked does nothing', async () => {
    // main.js loads the page when the GPU's process goes and when the machine wakes, too.
    const loadingAgain = rig();
    loadingAgain.hud.pageGone('crashed');
    loadingAgain.hud.pageLoading();
    loadingAgain.runTimers();
    expect(loadingAgain.page.loads).toBe(0);

    const loaded = rig();
    loaded.hud.pageGone('crashed');
    loaded.hud.pageLoading();
    loaded.hud.pageLoaded();
    loaded.runTimers();
    expect(loaded.page.loads).toBe(0);
  });

  test('gone twice before the two seconds are up: one load, not two', async () => {
    const { hud, page, booked, runTimers } = rig();
    hud.pageGone('crashed');
    hud.pageGone('killed');
    expect(booked.map((t) => t.cleared)).toEqual([true, false]);
    runTimers();
    expect(page.loads).toBe(1);
  });

  test('stopped — the window closed — what was booked is dropped; and no window, nothing is loaded', async () => {
    const { hud, page, booked, runTimers, win } = rig();
    hud.pageGone('crashed');
    hud.stop();
    expect(booked[0].cleared).toBe(true);

    hud.pageGone('crashed');
    win.destroyed = true;
    runTimers();
    expect(page.loads).toBe(0);
  });

  test('a load that throws is a load that failed', async () => {
    const win = fakeWindow();
    const said = [];
    let tries = 0;
    const feed = { payload: SIM_CLOSED };
    const clock = { at: 0 };
    const hud = createHudVisibility({
      getWindow: () => win,
      fetchPayload: async () => feed.payload,
      loadPage: () => { tries++; throw new Error('Object has been destroyed'); },
      now: () => clock.at,
      log: (line) => said.push(line),
    });
    const getInAndOut = async () => {
      feed.payload = IN_THE_CAR;
      clock.at += 500; await hud.poll();
      feed.payload = SIM_CLOSED;
      for (let i = 0; i < 6; i++) { clock.at += 500; await hud.poll(); }
    };
    await getInAndOut();
    await getInAndOut();
    expect(tries).toBe(2);
    expect(said.filter((line) => /could not be loaded/.test(line))).toHaveLength(2);
  });
});

test.describe('a hook before the window is revealed: it is put on the sim\'s screen first', () => {
  // A promise the test settles, and the moment it is asked.
  function deferred() {
    const d = { asked: 0 };
    d.promise = new Promise((resolve, reject) => { d.resolve = resolve; d.reject = reject; });
    return d;
  }
  const tick = () => new Promise((resolve) => setImmediate(resolve));

  test('asked when he gets in, with the window still hidden, and the window is revealed after it and not before', async () => {
    const seen = [];
    let win;
    const hook = async () => { seen.push(win.isVisible()); win.calls.push('moved'); };
    const r = rig({ beforeReveal: hook });
    win = r.win;
    await r.getIn();
    expect(seen).toEqual([false]);
    expect(win.isVisible()).toBe(true);
    expect(win.calls.indexOf('moved')).toBeGreaterThanOrEqual(0);
    expect(win.calls.indexOf('moved')).toBeLessThan(win.calls.indexOf('showInactive'));
    expect(shown(win)).toEqual(['showInactive']);
  });

  test('not asked again while he drives, and again each time he gets back in', async () => {
    let asked = 0;
    const r = rig({ beforeReveal: async () => { asked++; } });
    await r.getIn();
    await r.pass(30000);
    expect(asked).toBe(1);
    await r.getOut();
    expect(r.win.isVisible()).toBe(false);
    expect(asked).toBe(1);
    await r.getIn();
    expect(asked).toBe(2);
    expect(r.win.isVisible()).toBe(true);
  });

  test('not asked out of the car: at the menus, in the garage, with the sim closed or nothing answering', async () => {
    let asked = 0;
    const r = rig({ beforeReveal: async () => { asked++; } });
    for (const payload of [SIM_CLOSED, AT_THE_MENUS, NOTHING_ANSWERS, IN_THE_GARAGE]) {
      r.feed.payload = payload;
      await r.pass(3000, 1000);
    }
    expect(asked).toBe(0);
    expect(r.win.calls).toEqual([]);
  });

  test('the window waits for it: nothing reveals it while it is under way, whoever asks', async () => {
    const hook = deferred();
    const r = rig({ beforeReveal: () => { hook.asked++; return hook.promise; } });
    r.feed.payload = IN_THE_CAR;
    r.clock.at += 500;
    const poll = r.hud.poll();
    await tick();
    expect(hook.asked).toBe(1);
    expect(r.win.isVisible()).toBe(false);
    // The page loading, the driver's switch on the tray, another poll: none of them shows it.
    r.hud.pageLoaded();
    r.hud.toggle({ anywhere: true });
    r.hud.toggle({ anywhere: true });
    await r.hud.poll();
    expect(r.win.isVisible()).toBe(false);
    expect(hook.asked).toBe(1);
    expect(r.feed.asked).toBe(1);
    expect(r.hud.state()).toMatchObject({ inCar: true, visible: false });
    hook.resolve();
    await poll;
    expect(r.win.isVisible()).toBe(true);
    expect(shown(r.win)).toEqual(['showInactive']);
  });

  test('a hook that never answers is let go of after its time, and the HUD comes up', async () => {
    const r = rig({ beforeReveal: () => new Promise(() => {}) });
    r.feed.payload = IN_THE_CAR;
    r.clock.at += 500;
    const poll = r.hud.poll();
    await tick();
    expect(r.win.isVisible()).toBe(false);
    const waiting = r.waiting();
    expect(waiting).toHaveLength(1);
    expect(waiting[0].ms).toBe(1500);
    r.runTimers();
    await poll;
    expect(r.win.isVisible()).toBe(true);
  });

  test('a hook that answers clears its time', async () => {
    const r = rig({ beforeReveal: async () => {} });
    await r.getIn();
    expect(r.waiting()).toEqual([]);
    expect(r.booked.every((t) => t.cleared || t.ran)).toBe(true);
  });

  test('a hook that throws, or rejects, is said and does not keep the HUD off', async () => {
    for (const hook of [() => { throw new Error('no screens'); }, () => Promise.reject(new Error('no screens'))]) {
      const r = rig({ beforeReveal: hook });
      await r.getIn();
      expect(r.win.isVisible()).toBe(true);
      expect(r.said.some((line) => line.includes('before it is shown: no screens'))).toBe(true);
    }
  });

  test('the switch off is kept while it is under way, and the window is not revealed after it', async () => {
    const hook = deferred();
    const r = rig({ beforeReveal: () => hook.promise });
    r.feed.payload = IN_THE_CAR;
    r.clock.at += 500;
    const poll = r.hud.poll();
    await tick();
    r.hud.toggle({ anywhere: true });   // switched off, from the tray, before it comes up
    hook.resolve();
    await poll;
    expect(r.win.isVisible()).toBe(false);
    expect(r.hud.state()).toMatchObject({ inCar: true, hudOff: true, visible: false });
  });

  test('never shows or focuses the window itself: the hook is given no window', async () => {
    let args;
    const r = rig({ beforeReveal: (...given) => { args = given; } });
    await r.getIn();
    expect(args).toEqual([]);
  });
});

test.describe('the window is asked, not remembered', () => {
  test('shown by something else out of the car: hidden at the next poll', async () => {
    const { win, pass } = rig();
    win.visible = true;
    await pass(1000, 1000);
    expect(win.isVisible()).toBe(false);
  });

  test('hidden by something else in the car: shown at the next poll', async () => {
    const { win, getIn, pass } = rig();
    await getIn();
    win.visible = false;
    await pass(500);
    expect(win.isVisible()).toBe(true);
  });

  test('a window that has gone is left alone', async () => {
    const { win, feed, pass, hud } = rig();
    win.destroyed = true;
    feed.payload = IN_THE_CAR;
    await pass(2000);
    expect(win.calls).toEqual([]);
    expect(hud.state()).toMatchObject({ inCar: true, visible: false });
  });
});

test.describe('dev mode', () => {
  test('the window stays as dev-mode.js put it, in the car and out; the page is told all the same', async () => {
    const { win, feed, getIn, pass } = rig({ keepVisible: true });
    win.visible = true;   // dev-mode.js shows it once the page has loaded
    await pass(3000, 1000);
    await getIn();
    feed.payload = SIM_CLOSED;
    await pass(5000);
    expect(win.isVisible()).toBe(true);
    expect(win.calls).toEqual([]);
    expect(win.sent).toEqual([['in-race-state', false], ['in-race-state', true], ['in-race-state', false]]);
  });

  test('the switch hides and shows the window, as it always did', () => {
    const { win, hud, switched } = rig({ keepVisible: true });
    win.visible = true;
    expect(hud.toggle()).toEqual({ ok: true, visible: false });
    expect(hud.toggle()).toEqual({ ok: true, visible: true });
    expect(win.calls).toEqual(['hide', 'show']);
    expect(switched).toEqual([]);
  });
});

test.describe('start and stop', () => {
  // Timers that run when the test says so.
  function timers() {
    const booked = [];
    return {
      booked,
      setTimer: (fn, ms) => { const t = { fn, ms, cleared: false }; booked.push(t); return t; },
      clearTimer: (t) => { t.cleared = true; },
      // Run the last timer booked, and wait for the poll it starts to book the next.
      next: async () => {
        const before = booked.length;
        booked[before - 1].fn();
        await expect.poll(() => booked.length).toBe(before + 1);
      },
    };
  }

  test('it asks at once, then once a second out of the car and twice in it, one poll after another', async () => {
    const t = timers();
    const feed = { payload: SIM_CLOSED, asked: 0 };
    const win = fakeWindow();
    const hud = createHudVisibility({
      getWindow: () => win,
      fetchPayload: async () => { feed.asked++; return feed.payload; },
      setTimer: t.setTimer,
      clearTimer: t.clearTimer,
    });
    hud.pageLoaded();
    hud.start();
    hud.start();   // a second start changes nothing
    await expect.poll(() => t.booked.length).toBe(1);
    expect(feed.asked).toBe(1);
    expect(t.booked[0].ms).toBe(OUT_OF_CAR_POLL_MS);

    feed.payload = IN_THE_CAR;
    await t.next();
    expect(feed.asked).toBe(2);
    expect(win.isVisible()).toBe(true);
    expect(t.booked[1].ms).toBe(IN_CAR_POLL_MS);

    hud.stop();
    expect(t.booked[1].cleared).toBe(true);
    // A poll already on its way when it was stopped books nothing after it.
    t.booked[1].fn();
    await expect.poll(() => feed.asked).toBe(3);
    await new Promise((r) => setTimeout(r, 20));
    expect(t.booked).toHaveLength(2);
    expect(OUT_OF_CAR_POLL_MS).toBe(1000);
    expect(IN_CAR_POLL_MS).toBe(500);
  });

  test('a poll still waiting for its answer is not asked again', async () => {
    let answer;
    let asked = 0;
    const win = fakeWindow();
    const hud = createHudVisibility({
      getWindow: () => win,
      fetchPayload: () => { asked++; return new Promise((resolve) => { answer = resolve; }); },
    });
    hud.pageLoaded();
    const first = hud.poll();
    await hud.poll();
    expect(asked).toBe(1);
    answer(IN_THE_CAR);
    expect(await first).toMatchObject({ inCar: true, visible: true });
  });
});

test.describe('telemetryUrl: where the HUD reads', () => {
  test('localhost:8889, unless the settings name the plugin somewhere else', () => {
    expect(telemetryUrl(undefined)).toBe('http://localhost:8889/racing-desk/');
    expect(telemetryUrl('http://192.168.1.20:8889/racing-desk/')).toBe('http://192.168.1.20:8889/racing-desk/');
    expect(telemetryUrl('http://localhost:18889/racing-desk')).toBe('http://localhost:18889/racing-desk/');
  });

  test('an address that is not the plugin is ignored, as the page ignores it', () => {
    for (const saved of ['http://localhost:8889', 'http://localhost:8889/k10mediabroadcaster/', 'not an address', '', null, 42]) {
      expect(telemetryUrl(saved), String(saved)).toBe('http://localhost:8889/racing-desk/');
    }
  });

  test('in dev mode the replay stands in for :8889, and for nothing else', () => {
    expect(telemetryUrl(undefined, { replayPort: 18889 })).toBe('http://localhost:18889/racing-desk/');
    expect(telemetryUrl('http://127.0.0.1:8889/racing-desk/', { replayPort: 4000 })).toBe('http://127.0.0.1:4000/racing-desk/');
    expect(telemetryUrl('http://192.168.1.20:8889/racing-desk/', { replayPort: 4000 })).toBe('http://192.168.1.20:8889/racing-desk/');
    expect(telemetryUrl(undefined, { replayPort: null })).toBe('http://localhost:8889/racing-desk/');
  });
});

test.describe('fetchPayload', () => {
  // http.get, answering as the test says: { status, body } | { error } | { silent: true }.
  function fakeGet(answer) {
    const seen = { urls: [], destroyed: 0 };
    const get = (url, _options, onResponse) => {
      seen.urls.push(url);
      const req = new EventEmitter();
      req.destroy = () => { seen.destroyed++; };
      setImmediate(() => {
        if (answer.silent) return;
        if (answer.error) { req.emit('error', new Error(answer.error)); return; }
        const res = new EventEmitter();
        res.statusCode = answer.status;
        res.resume = () => {};
        onResponse(res);
        for (const chunk of answer.chunks || [answer.body]) res.emit('data', Buffer.from(chunk));
        res.emit('end');
      });
      return req;
    };
    return { get, seen };
  }

  const URL_ = 'http://localhost:8889/racing-desk/';

  test('the payload, from an answer in one piece or several', async () => {
    const body = JSON.stringify(IN_THE_CAR);
    const whole = fakeGet({ status: 200, body });
    expect(await fetchPayload(URL_, { get: whole.get })).toEqual(IN_THE_CAR);
    expect(whole.seen.urls).toEqual([URL_]);
    const pieces = fakeGet({ status: 200, chunks: [body.slice(0, 100), body.slice(100)] });
    expect(await fetchPayload(URL_, { get: pieces.get })).toEqual(IN_THE_CAR);
  });

  test('null for anything that is not a payload', async () => {
    for (const answer of [
      { status: 404, body: 'Not found' },
      { status: 500, body: JSON.stringify(IN_THE_CAR) },
      { status: 200, body: '<html>' },
      { status: 200, body: '' },
      { status: 200, body: 'null' },
      { status: 200, body: '[1,2]' },
      { status: 200, body: '"in the car"' },
      { error: 'ECONNREFUSED' },
    ]) {
      expect(await fetchPayload(URL_, { get: fakeGet(answer).get }), JSON.stringify(answer)).toBeNull();
    }
  });

  test('null when no answer comes in time, and the request is dropped', async () => {
    const { get, seen } = fakeGet({ silent: true });
    const started = Date.now();
    expect(await fetchPayload(URL_, { get, timeoutMs: 50 })).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(seen.destroyed).toBe(1);
  });

  test('null when the request cannot even be made', async () => {
    expect(await fetchPayload('nowhere', { get: () => { throw new Error('Invalid URL'); } })).toBeNull();
  });
});
