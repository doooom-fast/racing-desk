/**
 * Which screen a recording is of (modules/js/capture-screen.js): the one the sim is on while it runs, else the one the
 * HUD is on — both found by hud-display.js (`recordScreen`) — matched to desktopCapturer's sources by display_id, else
 * the first. It used to be the first, always.
 *
 * No Electron: the sources are fakes shaped as desktopCapturer gives them on Windows, the screens are handed to
 * hud-display as plain objects, and the callback records what it was given.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { pickScreenSource, createDisplayMediaHandler } = require('../../modules/js/capture-screen.js');
const { createHudDisplay } = require('../../modules/js/hud-display.js');

// His rig, as Electron sees it with the small screen as the primary: 1440 × 1080 at 175 % is 823 × 618 at (0, 0), and
// the 3440 × 1440 ultrawide at 100 %, where iRacing runs, begins at 823. Electron's ids for them are 2 and 1.
const SMALL = { id: 2, bounds: { x: 0, y: 0, width: 823, height: 618 }, workArea: { x: 0, y: 0, width: 823, height: 578 }, scaleFactor: 1.75, primary: true };
const ULTRAWIDE = { id: 1, bounds: { x: 823, y: 0, width: 3440, height: 1440 }, workArea: { x: 823, y: 0, width: 3440, height: 1400 }, scaleFactor: 1, primary: false };

// desktopCapturer's screens: display_id is Electron's display.id as text. The small screen is listed first — the
// one the old handler granted, whichever screen the sim was on.
const SMALL_SOURCE = { id: 'screen:2:0', name: 'Screen 1', display_id: '2' };
const ULTRAWIDE_SOURCE = { id: 'screen:1:0', name: 'Screen 2', display_id: '1' };
const SOURCES = [SMALL_SOURCE, ULTRAWIDE_SOURCE];

// The handler, and what it answered and said.
function handler({ sources = SOURCES, key = null } = {}) {
  const said = [];
  const answers = [];
  const handle = createDisplayMediaHandler({
    getSources: typeof sources === 'function' ? sources : async () => sources,
    getDisplayKey: typeof key === 'function' ? key : () => key,
    log: (line) => said.push(line),
  });
  const ask = async () => {
    await handle({}, (answer) => answers.push(answer));
    return answers.at(-1);
  };
  return { ask, said, answers };
}

test.describe('the source', () => {
  test("is the HUD's screen, found by display_id, though it is not the first listed", () => {
    expect(pickScreenSource(SOURCES, '1')).toEqual({ source: ULTRAWIDE_SOURCE, matched: true });
    expect(pickScreenSource(SOURCES, '2')).toEqual({ source: SMALL_SOURCE, matched: true });
  });

  test('a key or a display_id given as a number is the same screen', () => {
    expect(pickScreenSource(SOURCES, 1).source).toBe(ULTRAWIDE_SOURCE);
    expect(pickScreenSource([SMALL_SOURCE, { ...ULTRAWIDE_SOURCE, display_id: 1 }], '1').matched).toBe(true);
  });

  test('is the first while the HUD has no screen yet', () => {
    for (const key of [null, undefined, '', '  ']) {
      expect(pickScreenSource(SOURCES, key), String(key)).toEqual({ source: SMALL_SOURCE, matched: false });
    }
  });

  test("is the first when none of the sources is the HUD's screen: it has gone, or the platform gives no display_id", () => {
    expect(pickScreenSource(SOURCES, '3')).toEqual({ source: SMALL_SOURCE, matched: false });
    const unnamed = [{ id: 'screen:0:0', name: 'Entire screen', display_id: '' }, { id: 'screen:1:0', name: 'Screen 2' }];
    expect(pickScreenSource(unnamed, '1')).toEqual({ source: unnamed[0], matched: false });
    // An empty display_id is never a match for an empty key either.
    expect(pickScreenSource(unnamed, '').matched).toBe(false);
  });

  test('is none when there are no sources, or what was given is not a list of them', () => {
    for (const sources of [[], null, undefined, 'screen:1:0', {}, [null, 7]]) {
      expect(pickScreenSource(sources, '1'), JSON.stringify(sources)).toEqual({ source: null, matched: false });
    }
  });
});

test.describe('the handler', () => {
  test("grants the HUD's screen, with the system's sound, and says so", async () => {
    const { ask, said } = handler({ key: '1' });
    expect(await ask()).toEqual({ video: ULTRAWIDE_SOURCE, audio: 'loopback' });
    expect(said).toEqual(["[RacingDesk] Screen recording: the HUD's screen (Screen 2)"]);
  });

  test('grants the first screen when the HUD has none yet, or its screen is not listed, and says why', async () => {
    const none = handler({ key: null });
    expect(await none.ask()).toEqual({ video: SMALL_SOURCE, audio: 'loopback' });
    expect(none.said).toEqual(['[RacingDesk] Screen recording: the first screen: the HUD has no screen yet (Screen 1)']);

    const gone = handler({ key: '3' });
    expect(await gone.ask()).toEqual({ video: SMALL_SOURCE, audio: 'loopback' });
    // What would not match is said, so that ids that never agree can be seen in the log.
    expect(gone.said).toEqual(["[RacingDesk] Screen recording: the first screen: none of the screens is the HUD's (the HUD's is 3; the screens are 2, 1) (Screen 1)"]);

    const unnamed = handler({ key: '1', sources: [{ id: 'screen:0:0', name: 'Entire screen', display_id: '' }, { id: 'screen:1:0', name: 'Screen 2' }] });
    expect((await unnamed.ask()).video).toMatchObject({ id: 'screen:0:0' });
    expect(unnamed.said).toEqual(["[RacingDesk] Screen recording: the first screen: none of the screens is the HUD's (the HUD's is 1; the screens are ?, ?) (Entire screen)"]);
  });

  test("grants the sim's screen when it is told that is the one, and says so", async () => {
    const { ask, said } = handler({ key: { key: '1', reason: 'sim' } });
    expect(await ask()).toEqual({ video: ULTRAWIDE_SOURCE, audio: 'loopback' });
    expect(said).toEqual(["[RacingDesk] Screen recording: the sim's screen (Screen 2)"]);

    // Where its id matches none of the screens it says whose id it was, and what the screens' are.
    const gone = handler({ key: { key: '3', reason: 'sim' } });
    expect((await gone.ask()).video).toBe(SMALL_SOURCE);
    expect(gone.said).toEqual(["[RacingDesk] Screen recording: the first screen: none of the screens is the sim's (the sim's is 3; the screens are 2, 1) (Screen 1)"]);
  });

  test("a screen told as the HUD's, as an object or as a bare key, is the HUD's screen; a missing key is the first screen", async () => {
    const asObject = handler({ key: { key: '1', reason: 'hud' } });
    expect((await asObject.ask()).video).toBe(ULTRAWIDE_SOURCE);
    expect(asObject.said).toEqual(["[RacingDesk] Screen recording: the HUD's screen (Screen 2)"]);

    const none = handler({ key: { key: null, reason: 'hud' } });
    expect((await none.ask()).video).toBe(SMALL_SOURCE);
    expect(none.said).toEqual(['[RacingDesk] Screen recording: the first screen: the HUD has no screen yet (Screen 1)']);
  });

  test('a key that cannot be read is no key: the first screen', async () => {
    const { ask } = handler({ key: () => { throw new Error('gone'); } });
    expect(await ask()).toEqual({ video: SMALL_SOURCE, audio: 'loopback' });
  });

  test('refuses when there is no screen, or the capturer fails, and answers every time', async () => {
    const empty = handler({ sources: [] });
    expect(await empty.ask()).toEqual({ video: null });
    expect(empty.said).toEqual(['[RacingDesk] Screen recording: there is no screen to record']);

    const failing = handler({ sources: async () => { throw new Error('no capturer'); } });
    expect(await failing.ask()).toEqual({ video: null });
    expect(failing.answers).toHaveLength(1);
    expect(failing.said).toEqual(['[RacingDesk] Display media handler error: no capturer']);
  });
});

test.describe("with hud-display's recording screen", () => {
  function fakeWindow() {
    const win = { bounds: { x: 0, y: 0, width: 823, height: 618 } };
    win.isDestroyed = () => false;
    win.getBounds = () => ({ ...win.bounds });
    win.setBounds = (b) => { win.bounds = { ...b }; };
    return win;
  }

  // Physical pixels to the screens' own units: the ultrawide begins at 1440 physical, 823 in DIPs.
  const toDip = (r) => (r.x >= 1440 ? { x: 823 + (r.x - 1440), y: r.y, width: r.width, height: r.height } : { x: r.x / 1.75, y: r.y / 1.75, width: r.width / 1.75, height: r.height / 1.75 });

  function rig({ choice } = {}) {
    const state = { sim: { state: 'not-running' } };
    const hud = createHudDisplay({
      getWindow: fakeWindow,
      getDisplays: () => [SMALL, ULTRAWIDE],
      getChoice: () => choice,
      askSimWindow: async () => state.sim,
      askMonitors: async () => ({ state: 'unknown' }),
      toDipRect: toDip,
      platform: 'win32',
      askWithinMs: 40,
    });
    // As main.js wires it: the handler asks the keeper where the recording goes.
    const { ask, said } = handler({ key: () => hud.recordScreen() });
    return { hud, state, ask, said };
  }

  const RUNNING_ON_ULTRAWIDE = { state: 'running', window: { x: 1440, y: 0, width: 3440, height: 1440 }, monitor: { x: 1440, y: 0, width: 3440, height: 1440 } };
  const RUNNING_ON_SMALL = { state: 'running', window: { x: 0, y: 0, width: 1440, height: 1080 }, monitor: { x: 0, y: 0, width: 1440, height: 1080 } };

  test('the sim on the ultrawide, listed second: the recording is of the ultrawide, and follows the sim to the small screen', async () => {
    const { hud, state, ask } = rig();
    // Before the rule has run there is no HUD screen, and the first is granted.
    expect((await ask()).video).toBe(SMALL_SOURCE);

    state.sim = RUNNING_ON_ULTRAWIDE;
    await hud.refresh();
    expect(hud.currentKey()).toBe('1');
    expect((await ask()).video).toBe(ULTRAWIDE_SOURCE);

    state.sim = RUNNING_ON_SMALL;
    await hud.refresh();
    expect((await ask()).video).toBe(SMALL_SOURCE);
  });

  // The recorder is there to record the race. A screen he chose for the HUD is where the HUD goes, not where the race is:
  // with the HUD on the small screen and the sim on the ultrawide, the bundle must hold the sim and not the desktop.
  test('a small screen chosen for the HUD, the sim on the ultrawide: the recording is of the ultrawide', async () => {
    const { hud, state, ask, said } = rig({ choice: '2' });
    state.sim = RUNNING_ON_ULTRAWIDE;
    await hud.refresh();
    expect(hud.currentKey()).toBe('2');   // the HUD is on the small screen, by his choice
    expect((await ask()).video).toBe(ULTRAWIDE_SOURCE);
    expect(said.at(-1)).toBe("[RacingDesk] Screen recording: the sim's screen (Screen 2)");

    // The sim closes: nothing is being raced, and the recording is of the screen the HUD is on.
    state.sim = { state: 'not-running' };
    await hud.refresh();
    expect((await ask()).video).toBe(SMALL_SOURCE);
    expect(said.at(-1)).toBe("[RacingDesk] Screen recording: the HUD's screen (Screen 1)");
  });
});
