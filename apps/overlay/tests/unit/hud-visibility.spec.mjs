/**
 * When the HUD's window is on screen (modules/js/hud-visibility.js): while the driver is in the car, he has not
 * switched the HUD off, and the page is loaded — never otherwise, and never by taking the focus from the sim.
 *
 * A fake window, a fake telemetry and a clock the test moves: no Electron, no ports, no timers. main.js gives the
 * same object the real window and http.get.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { MOCK_TELEMETRY, MOCK_DEMO } from '../helpers.mjs';

const require = createRequire(import.meta.url);
const {
  createHudVisibility, fetchPayload, telemetryUrl, IN_CAR_POLL_MS, OUT_OF_CAR_POLL_MS,
} = require('../../modules/js/hud-visibility.js');

const SIM_CLOSED = JSON.parse(readFileSync(new URL('../golden/fixtures/base-payload.json', import.meta.url), 'utf8'));
const IN_THE_CAR = MOCK_TELEMETRY;
const AT_THE_MENUS = { ...MOCK_TELEMETRY, 'RacingDesk.Plugin.Grid.SessionState': 0 };
const NOTHING_ANSWERS = null;

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
function rig({ keepVisible = false, loaded = true, window: given } = {}) {
  const clock = { at: 10000 };
  const feed = { payload: SIM_CLOSED, asked: 0 };
  const win = given === undefined ? fakeWindow() : given;
  const switched = [];
  const hud = createHudVisibility({
    getWindow: () => win,
    fetchPayload: async () => { feed.asked++; return feed.payload; },
    keepVisible,
    onSwitch: (off) => switched.push(off),
    now: () => clock.at,
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
  return { clock, feed, win, hud, switched, pass, getIn };
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

test.describe("the driver's switch: the tray, Ctrl+Shift+H, the Stream Deck", () => {
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
    const { win, hud, feed, getIn, pass } = rig();
    await getIn();
    hud.toggle();
    feed.payload = SIM_CLOSED;
    await pass(3000);
    await getIn();
    await pass(10000);
    expect(win.isVisible()).toBe(false);
    expect(shown(win)).toEqual(['showInactive']);
    hud.toggle();
    expect(win.isVisible()).toBe(true);
  });

  test('switched off out of the car, it is off when he gets in', async () => {
    const { win, hud, getIn } = rig();
    expect(hud.toggle()).toEqual({ ok: true, visible: false, hudOff: true });
    await getIn();
    expect(win.isVisible()).toBe(false);
    expect(win.calls).toEqual([]);
  });

  test('switched on out of the car, nothing comes on screen until he gets in', async () => {
    const { win, hud, pass, getIn } = rig();
    hud.toggle();
    expect(hud.toggle()).toEqual({ ok: true, visible: false, hudOff: false });
    await pass(5000, 1000);
    expect(win.isVisible()).toBe(false);
    expect(win.calls).toEqual([]);
    await getIn();
    expect(win.isVisible()).toBe(true);
  });

  test('no window: it says so, and the switch stays where it was', () => {
    for (const window of [null, Object.assign(fakeWindow(), { destroyed: true })]) {
      const { hud, switched } = rig({ window, loaded: false });
      expect(hud.toggle()).toEqual({ ok: false, reason: 'no window' });
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
    hud.toggle();
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
    const { win, hud, getIn, pass } = rig();
    await getIn();
    hud.pageGone();
    expect(win.isVisible()).toBe(false);
    await pass(2000);
    expect(win.isVisible()).toBe(false);
    hud.pageLoaded();
    expect(win.isVisible()).toBe(true);
    expect(win.sent.slice(-2)).toEqual([['in-race-state', true], ['in-race-state', true]]);
  });

  test('its process gone for good: nothing on screen, in the car or out', async () => {
    const { win, hud, getIn, pass } = rig();
    await getIn();
    hud.pageGone();
    await pass(30000, 1000);
    expect(win.isVisible()).toBe(false);
    expect(hud.state()).toMatchObject({ inCar: true, pageReady: false, visible: false });
  });

  test('a page that cannot be told does not stop the window being put right', async () => {
    const { win, getIn } = rig();
    win.webContents.send = () => { throw new Error('Render frame was disposed'); };
    await getIn();
    expect(win.isVisible()).toBe(true);
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
