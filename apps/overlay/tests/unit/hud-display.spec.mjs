/**
 * Which screen the HUD's window is on (modules/js/hud-display.js): the one he chose in Settings, else the one the
 * sim's window is on, else the one iRacing's own ini says it runs at, else the largest — never just the primary.
 *
 * No Electron: the screens, the sim window's rectangle, the ini's text and the saved choice are handed in, and the
 * window is a fake that records what it is asked. The one test that opens a socket listens on 127.0.0.1, on a port
 * the system picks.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import { EventEmitter } from 'node:events';
import http from 'node:http';

const require = createRequire(import.meta.url);
const {
  physicalSize, normaliseDisplays, displayName, listDisplays, matchSimWindow, parseSimWindow, fetchSimWindow,
  parseMonitors, fetchMonitors, matchMonitors, ASK_WITHIN_MS,
  parseSimIni, simSizeFromIni, simIniPath, readSimIni, chooseDisplay, boundsFor, createHudDisplay,
} = require('../../modules/js/hud-display.js');
const { PREPARE_WITHIN_MS } = require('../../modules/js/hud-visibility.js');

// ── His rig, read on 2026-09-29 ──────────────────────────────────────────────────────────────────────────────
// \\.\DISPLAY2 is the Windows primary: 1440 × 1080 physical at 175 %, so Electron sees 823 × 618 at (0, 0). Not 617:
// 1080 / 1.75 is 617.14 and Chromium takes the enclosing rectangle — the app's own overlay.log has this screen as
// "823x618" and a 1920 × 1080 one at 175 % as "1098x618".
// \\.\DISPLAY1 is the 3440 × 1440 ultrawide at 100 %, where iRacing runs; Windows lays it out at x = 1440 physical.
const SMALL = { id: 2, bounds: { x: 0, y: 0, width: 823, height: 618 }, workArea: { x: 0, y: 0, width: 823, height: 578 }, scaleFactor: 1.75, primary: true };
const ULTRAWIDE = { id: 1, bounds: { x: 823, y: 0, width: 3440, height: 1440 }, workArea: { x: 823, y: 0, width: 3440, height: 1400 }, scaleFactor: 1, primary: false };
const RIG = [SMALL, ULTRAWIDE];

// The same two screens as a read-only Win32 query found them at 20:10 on 2026-09-29, an hour after the brief's
// reading: the ultrawide is the Windows primary at (0, 0), and the small screen is to the left of it at (-1440, 0)
// physical, (-823, 0) in DIPs. Whichever is primary, the rule must not depend on it.
const SMALL_LEFT = { id: 2, bounds: { x: -823, y: 0, width: 823, height: 618 }, workArea: { x: -823, y: 0, width: 823, height: 578 }, scaleFactor: 1.75, primary: false };
const ULTRAWIDE_MAIN = { id: 1, bounds: { x: 0, y: 0, width: 3440, height: 1440 }, workArea: { x: 0, y: 0, width: 3440, height: 1400 }, scaleFactor: 1, primary: true };
const RIG_ULTRAWIDE_MAIN = [SMALL_LEFT, ULTRAWIDE_MAIN];

// What the host's monitors route says of the small screen (Windows knows its panel): 1440 × 1080, whatever the DIPs say.
const SMALL_SIZE = new Map([['2', { width: 1440, height: 1080 }]]);
// The monitors as the host lists them in physical pixels, for each of the two layouts.
const MONITORS_SMALL_MAIN = [{ x: 0, y: 0, width: 1440, height: 1080, primary: true }, { x: 1440, y: 0, width: 3440, height: 1440, primary: false }];
const MONITORS_ULTRAWIDE_MAIN = [{ x: -1440, y: 0, width: 1440, height: 1080, primary: false }, { x: 0, y: 0, width: 3440, height: 1440, primary: true }];

// His rendererDX11Monitor.ini's [Display] section as iRacing writes it: values, then a tab and a comment.
function iniOf({ fullScreen = 0, maximized = 1, width = 3440, height = 1440, fullWidth = 3440, fullHeight = 1440, eol = '\n', before = '', after = '' } = {}) {
  return [
    '[AutoCfg]', 'AutoCfgCompleted=1                              \t; 0=need to run 3D autocfg at startup',
    before,
    '[Display]',
    'windowedYPos=0                                  \t; Window top left corner in windowed mode',
    'windowedXPos=0                                  \t; Window top left corner in windowed mode',
    `windowedWidth=${width}                              \t; windowed mode width`,
    `windowedMaximized=${maximized}                             \t; Window is maximized in windowed mode`,
    `windowedHeight=${height}                             \t; windowed mode height`,
    'RefreshRate=240.000                             \t; Refresh Rate',
    `fullScreenWidth=${fullWidth}                            \t; full screen Window's width`,
    `fullScreenHeight=${fullHeight}                           \t; full screen Window's height`,
    `fullScreen=${fullScreen}                            \t; fullscreen?`,
    'deviceIdx=0                                     \t; which adapter',
    after,
    '[MonitorSetup]', 'NumMonitors=1                                   \t; 1 or 3',
    '',
  ].join(eol);
}
const HIS_INI = iniOf();

// The sim's window as Electron gives it once converted to the screens' own units.
const onTheUltrawide = { x: 823, y: 0, width: 3440, height: 1440 };
const onTheSmall = { x: 0, y: 0, width: 823, height: 618 };

const choose = (over) => chooseDisplay({ displays: RIG, ...over });

test.describe('what a screen really is', () => {
  // How Chromium sees a screen: its DIPs are the enclosing rectangle of the physical size over the scale.
  const asElectronSees = (width, height, scale) => ({ width: Math.ceil(width / scale), height: Math.ceil(height / scale) });

  test('1440 × 1080 at 175 % is 823 × 618 to Electron, and the estimate from that is a pixel or two out', () => {
    expect(asElectronSees(1440, 1080, 1.75)).toEqual({ width: 823, height: 618 });
    expect(asElectronSees(1920, 1080, 1.75)).toEqual({ width: 1098, height: 618 });   // the log's other line
    // The estimate is DIPs by scale, rounded: 618 × 1.75 is 1081.5. It is what is shown until the host says.
    expect(physicalSize(SMALL)).toEqual({ width: 1440, height: 1082 });
    expect(physicalSize(ULTRAWIDE)).toEqual({ width: 3440, height: 1440 });
    expect(physicalSize({ bounds: { width: 1920, height: 1080 } })).toEqual({ width: 1920, height: 1080 });
  });

  test('an estimate is marked as one, except at 100 %, where there is nothing to round; the host\'s size is exact', () => {
    const [small, ultrawide] = normaliseDisplays(RIG);
    expect([small.exact, ultrawide.exact]).toEqual([false, true]);
    const [known] = normaliseDisplays(RIG, SMALL_SIZE);
    expect(known).toMatchObject({ key: '2', exact: true, physical: { width: 1440, height: 1080 } });
    // Once read, a screen keeps the size it was given, and a size that is not one is not taken.
    expect(normaliseDisplays([known])[0]).toMatchObject({ exact: true, physical: { width: 1440, height: 1080 } });
    expect(normaliseDisplays(RIG, new Map([['2', { width: 0, height: 'x' }]]))[0]).toMatchObject({ exact: false, physical: { width: 1440, height: 1082 } });
  });

  test("the ini's size finds the screen it is the size of, at every scale, as Electron reports it", () => {
    // Each screen beside one larger than it at 100 %, so that "the largest" is never the answer that happens to be right.
    const cases = [
      [1440, 1080, 1.75], [1920, 1080, 1.75], [1920, 1080, 1.25], [1920, 1080, 1.5], [2560, 1440, 1.5], [2560, 1440, 1.25],
      [2560, 1440, 1.75], [3840, 2160, 1.5], [3840, 2160, 1.75], [3840, 2160, 2], [2560, 1600, 2.25], [1366, 768, 1.25],
    ];
    for (const [width, height, scale] of cases) {
      const dip = asElectronSees(width, height, scale);
      const rig = [
        { id: 1, bounds: { x: 0, y: 0, ...dip }, scaleFactor: scale, primary: true },
        { id: 2, bounds: { x: dip.width, y: 0, width: 5120, height: 2160 }, scaleFactor: 1, primary: false },
      ];
      const ini = parseSimIni(iniOf({ fullScreen: 1, fullWidth: width, fullHeight: height }));
      expect(chooseDisplay({ displays: rig, ini }), `${width} × ${height} at ${scale * 100} %`).toMatchObject({ key: '1', reason: 'ini' });
    }
  });

  test('his small screen: iRacing set to 1440 × 1080 is the small screen, though it reads 823 × 618', () => {
    // This is the case that fell through to "the largest" while a screen's size was worked out as DIPs × scale, rounded.
    expect(chooseDisplay({ displays: RIG, ini: parseSimIni(iniOf({ fullScreen: 1, fullWidth: 1440, fullHeight: 1080 })) }))
      .toMatchObject({ key: '2', reason: 'ini', why: 'iRacing is set to run full screen at 1440 × 1080' });
    // And with the host having said what the panel is, exactly the same.
    expect(chooseDisplay({ displays: normaliseDisplays(RIG, SMALL_SIZE), ini: parseSimIni(iniOf({ fullScreen: 1, fullWidth: 1440, fullHeight: 1080 })) }))
      .toMatchObject({ key: '2', reason: 'ini' });
    // A size near it but not it, when the panel's own size is known, is not it.
    expect(chooseDisplay({ displays: normaliseDisplays(RIG, SMALL_SIZE), ini: parseSimIni(iniOf({ fullScreen: 1, fullWidth: 1439, fullHeight: 1080 })) }))
      .toMatchObject({ reason: 'largest' });
  });

  test('a maximized window is as big as the room a screen has beside its taskbar, and that is a size it can be', () => {
    // Bounds first: his ultrawide is 3440 × 1440 and so is his ini, but a rig where the taskbar is showing has 3440 × 1400.
    const ini = parseSimIni(iniOf({ width: 3440, height: 1400 }));
    expect(choose({ ini })).toMatchObject({ key: '1', reason: 'ini', why: 'iRacing is set to run maximized at 3440 × 1400, which is a screen without its taskbar' });
    // Not for a window that is not maximized, nor for full screen.
    expect(choose({ ini: parseSimIni(iniOf({ maximized: 0, width: 3440, height: 1400 })) })).toMatchObject({ reason: 'largest' });
    expect(choose({ ini: parseSimIni(iniOf({ fullScreen: 1, fullWidth: 3440, fullHeight: 1400 })) })).toMatchObject({ reason: 'largest' });
    // The small screen's room, at 175 %: 823 × 578 DIPs.
    expect(choose({ ini: parseSimIni(iniOf({ width: 1440, height: 1011 })) })).toMatchObject({ key: '2', reason: 'ini' });
  });

  test('screens with no usable bounds are left out, and one is the primary whoever says so', () => {
    const kept = normaliseDisplays([
      null, {}, { id: 1 }, { id: 2, bounds: { x: 0, y: 0, width: 0, height: 10 } },
      { id: 3, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
      { id: 4, bounds: { x: 1920, y: 0, width: 1920, height: 1080 } },
    ]);
    expect(kept.map((d) => d.key)).toEqual(['3', '4']);
    expect(kept.map((d) => d.primary)).toEqual([true, false]);   // the one at the origin
    expect(normaliseDisplays('nope')).toEqual([]);
  });
});

test.describe("what iRacing is set to run at: the ini's [Display] section", () => {
  test('his ini is maximized in a window at 3440 × 1440, not full screen', () => {
    expect(parseSimIni(HIS_INI)).toEqual({
      fullScreen: false, maximized: true, windowed: { width: 3440, height: 1440 }, full: { width: 3440, height: 1440 },
    });
    expect(simSizeFromIni(parseSimIni(HIS_INI))).toEqual({ width: 3440, height: 1440, how: 'maximized' });
  });

  test('full screen is the full-screen size; a window that is not maximized is the windowed size', () => {
    const full = parseSimIni(iniOf({ fullScreen: 1, width: 1920, height: 1080, fullWidth: 2560, fullHeight: 1440 }));
    expect(simSizeFromIni(full)).toEqual({ width: 2560, height: 1440, how: 'fullscreen' });
    const windowed = parseSimIni(iniOf({ maximized: 0, width: 1920, height: 1080 }));
    expect(simSizeFromIni(windowed)).toEqual({ width: 1920, height: 1080, how: 'windowed' });
  });

  test('the file as it is written: a byte order mark, Windows line ends, comments, other sections', () => {
    expect(parseSimIni(`\uFEFF${iniOf({ eol: '\r\n' })}`)).toEqual(parseSimIni(HIS_INI));
    // Keys of other sections are not the [Display] ones, and the section is found however it is written.
    const other = iniOf({ before: '[Other]\nfullScreen=1\nwindowedWidth=1\nwindowedHeight=1' });
    expect(simSizeFromIni(parseSimIni(other))).toEqual({ width: 3440, height: 1440, how: 'maximized' });
    expect(parseSimIni(HIS_INI.replace('[Display]', '[ display ]'))).toEqual(parseSimIni(HIS_INI));
    expect(parseSimIni(HIS_INI.replace(/windowedMaximized/, 'WINDOWEDMAXIMIZED'))).toEqual(parseSimIni(HIS_INI));
  });

  test('a missing, empty or garbled file says nothing', () => {
    for (const text of [
      null, undefined, '', 42, {}, '<html>not an ini</html>', '\0\0\0\u0001\u0002binary', '[Display]', '[Display]\nfullScreen=maybe',
      // Sizes missing or not sizes.
      HIS_INI.replace(/windowedWidth=\d+/, 'windowedWidth=wide'),
      HIS_INI.replace(/windowedHeight=\d+/, 'windowedHeight=0'),
      HIS_INI.replace(/fullScreen=0/, 'fullScreen=2'),
      HIS_INI.replace(/fullScreen=0[^\n]*\n/, ''),
      iniOf({ fullScreen: 1, fullWidth: 0, fullHeight: 0 }),
      HIS_INI.replace('[Display]', '[Displays]'),
    ]) {
      expect(parseSimIni(text), JSON.stringify(text)).toBeNull();
    }
    expect(simSizeFromIni(null)).toBeNull();
    expect(simSizeFromIni({})).toBeNull();
  });

  test('read from Documents\\iRacing, and null for a file that is not there, unreadable or absurdly large', () => {
    const seen = [];
    expect(readSimIni('C:\\Users\\Someone\\Documents', { stat: (f) => ({ size: 10 }), read: (f, enc) => { seen.push([f, enc]); return HIS_INI; } })).toBe(HIS_INI);
    expect(seen).toEqual([[simIniPath('C:\\Users\\Someone\\Documents'), 'utf8']]);
    expect(simIniPath('C:\\Users\\Someone\\Documents')).toMatch(/Documents[\\/]iRacing[\\/]rendererDX11Monitor\.ini$/);
    expect(readSimIni('C:\\nowhere', { stat: () => { throw new Error('ENOENT'); }, read: () => HIS_INI })).toBeNull();
    expect(readSimIni('C:\\x', { stat: () => ({ size: 10 }), read: () => { throw new Error('EBUSY'); } })).toBeNull();
    expect(readSimIni('C:\\x', { stat: () => ({ size: 50 * 1024 * 1024 }), read: () => HIS_INI })).toBeNull();
  });
});

test.describe('the sim window on a screen', () => {
  test('the screen that has most of it', () => {
    expect(matchSimWindow(onTheUltrawide, RIG).display.key).toBe('1');
    expect(matchSimWindow(onTheSmall, RIG).display.key).toBe('2');
    // A maximized window's frame runs a few pixels past the screen's edges on every side.
    expect(matchSimWindow({ x: 815, y: -8, width: 3456, height: 1456 }, RIG).display.key).toBe('1');
  });

  test('straddling two screens, the one that holds more of it; equal shares go to the left one', () => {
    const left = { id: 10, bounds: { x: 0, y: 0, width: 2560, height: 1440 }, scaleFactor: 1, primary: true };
    const right = { id: 11, bounds: { x: 2560, y: 0, width: 2560, height: 1440 }, scaleFactor: 1, primary: false };
    expect(matchSimWindow({ x: 1000, y: 0, width: 2560, height: 1440 }, [right, left]).display.key).toBe('10');   // 1560 on the left, 1000 on the right
    expect(matchSimWindow({ x: 2000, y: 0, width: 2560, height: 1440 }, [left, right]).display.key).toBe('11');   // 560 on the left, 2000 on the right
    expect(matchSimWindow({ x: 1280, y: 0, width: 2560, height: 1440 }, [right, left]).display.key).toBe('10');   // half and half
  });

  test('on no screen, or not a rectangle, it is nowhere', () => {
    expect(matchSimWindow({ x: -32000, y: -32000, width: 160, height: 28 }, RIG)).toBeNull();
    for (const rect of [null, undefined, {}, { x: 0, y: 0, width: 0, height: 100 }, { x: NaN, y: 0, width: 10, height: 10 }, 'window']) {
      expect(matchSimWindow(rect, RIG)).toBeNull();
    }
  });

  test("the host's answer is read as running, not running, or not an answer", () => {
    const running = { process: 'iRacingSim64DX11', window: { x: 1440, y: 0, width: 3440, height: 1440 }, monitor: { x: 1440, y: 0, width: 3440, height: 1440 } };
    expect(parseSimWindow(running)).toEqual({ state: 'running', window: running.window, monitor: running.monitor, process: 'iRacingSim64DX11' });
    expect(parseSimWindow({ window: running.window, monitor: null })).toMatchObject({ state: 'running', monitor: null, process: null });
    expect(parseSimWindow(null)).toEqual({ state: 'not-running' });
    expect(parseSimWindow({ window: null })).toEqual({ state: 'not-running' });
    for (const body of [undefined, 'null', 7, [], {}, { window: {} }, { window: { x: 0, y: 0, width: -1, height: 5 } }, { RacingDeskTelemetry: 1 }]) {
      expect(parseSimWindow(body), JSON.stringify(body)).toEqual({ state: 'unknown' });
    }
  });
});

test.describe('the rule, with his screens', () => {
  test('the sim not running: iRacing is set to run maximized at 3440 × 1440, and the ultrawide is that size', () => {
    const decision = choose({ ini: parseSimIni(HIS_INI) });
    expect(decision.key).toBe('1');
    expect(decision.reason).toBe('ini');
    expect(decision.why).toBe('iRacing is set to run maximized at 3440 × 1440');
    expect(decision.choiceMissing).toBe(false);
  });

  test('nothing known at all: the largest screen, which is the ultrawide and not the primary', () => {
    const decision = choose({});
    expect(decision.key).toBe('1');
    expect(decision.reason).toBe('largest');
  });

  test('the sim running on the ultrawide, and on the small one when that is where he has put it', () => {
    expect(choose({ simWindow: onTheUltrawide, ini: parseSimIni(HIS_INI) })).toMatchObject({ key: '1', reason: 'sim', why: 'iRacing is running on it' });
    // The window beats the ini: he has moved it since the ini was written.
    expect(choose({ simWindow: onTheSmall, ini: parseSimIni(HIS_INI) })).toMatchObject({ key: '2', reason: 'sim' });
  });

  test('a screen he chose beats the sim and the ini, while it is connected', () => {
    for (const choice of ['2', ' 2 ']) {
      expect(choose({ choice, simWindow: onTheUltrawide, ini: parseSimIni(HIS_INI) })).toMatchObject({ key: '2', reason: 'chosen', why: 'you chose it in Settings', choiceMissing: false });
    }
    expect(choose({ choice: '1', simWindow: onTheSmall })).toMatchObject({ key: '1', reason: 'chosen' });
  });

  test("Automatic, however it is written, is the rule's own answer", () => {
    for (const choice of [null, undefined, 'auto', '', '  ', 0, 2, {}]) {
      expect(choose({ choice, simWindow: onTheUltrawide }), String(choice)).toMatchObject({ key: '1', reason: 'sim', choiceMissing: false });
    }
  });

  test('a saved choice that is not connected is not used, is said to be missing, and is used again when the screen is back', () => {
    const missing = choose({ choice: '99', simWindow: onTheUltrawide });
    expect(missing).toMatchObject({ key: '1', reason: 'sim', choiceMissing: true });
    const alone = choose({ choice: '99', ini: parseSimIni(HIS_INI) });
    expect(alone).toMatchObject({ key: '1', reason: 'ini', choiceMissing: true });
    // The same choice, the screen there: the choice is in force.
    const back = chooseDisplay({ displays: [...RIG, { id: 99, bounds: { x: 4263, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }], choice: '99', simWindow: onTheUltrawide });
    expect(back).toMatchObject({ key: '99', reason: 'chosen', choiceMissing: false });
  });

  test("the ini's size is matched against the physical size, so 1440 × 1080 is the small screen at 175 %", () => {
    expect(choose({ ini: parseSimIni(iniOf({ fullScreen: 1, fullWidth: 1440, fullHeight: 1080 })) })).toMatchObject({ key: '2', reason: 'ini', why: 'iRacing is set to run full screen at 1440 × 1080' });
    expect(choose({ ini: parseSimIni(iniOf({ maximized: 0, width: 1440, height: 1080 })) })).toMatchObject({ key: '2', reason: 'ini', why: 'iRacing is set to run in a 1440 × 1080 window' });
    // Not the DIP size the screen reports.
    expect(choose({ ini: parseSimIni(iniOf({ fullScreen: 1, fullWidth: 823, fullHeight: 618 })) })).toMatchObject({ reason: 'largest' });
  });

  test('an ini that matches no screen, or is missing or garbled, falls to the largest', () => {
    for (const text of [iniOf({ width: 1920, height: 1080 }), null, '', 'garbage', '[Display]\nfullScreen=1']) {
      expect(choose({ ini: parseSimIni(text) }), String(text)).toMatchObject({ key: '1', reason: 'largest' });
    }
  });

  test('the sim window on no screen (asked while it is minimized, or off the desktop) leaves it to the ini', () => {
    expect(choose({ simWindow: { x: -32000, y: -32000, width: 160, height: 28 }, ini: parseSimIni(HIS_INI) })).toMatchObject({ key: '1', reason: 'ini' });
  });
});

test.describe('the rule, with other rigs', () => {
  const at = (id, x, width, height, extra = {}) => ({ id, bounds: { x, y: 0, width, height }, scaleFactor: 1, primary: false, ...extra });

  test('one screen is the only one, and a choice that names another is missing, not obeyed', () => {
    const only = [at(5, 0, 2560, 1440, { primary: true })];
    expect(chooseDisplay({ displays: only })).toMatchObject({ key: '5', reason: 'only' });
    expect(chooseDisplay({ displays: only, choice: '7', simWindow: { x: 0, y: 0, width: 2560, height: 1440 } })).toMatchObject({ key: '5', reason: 'only', choiceMissing: true });
    expect(chooseDisplay({ displays: only, choice: '5' })).toMatchObject({ key: '5', reason: 'chosen' });
  });

  test('no screens is no answer, whatever else is known', () => {
    expect(chooseDisplay({ displays: [], choice: '1', simWindow: onTheUltrawide, ini: parseSimIni(HIS_INI) })).toBeNull();
    expect(chooseDisplay({ displays: undefined })).toBeNull();
  });

  test('three monitors alike: the sim decides, and with nothing known the primary one, in the middle', () => {
    const three = [at(1, 0, 2560, 1440), at(2, 2560, 2560, 1440, { primary: true }), at(3, 5120, 2560, 1440)];
    expect(chooseDisplay({ displays: three, simWindow: { x: 5120, y: 0, width: 2560, height: 1440 } })).toMatchObject({ key: '3', reason: 'sim' });
    expect(chooseDisplay({ displays: three, simWindow: { x: 0, y: 0, width: 2560, height: 1440 } })).toMatchObject({ key: '1', reason: 'sim' });
    expect(chooseDisplay({ displays: three })).toMatchObject({ key: '2', reason: 'primary' });
    // All three are 2560 × 1440, and the ini says so: the primary of the three.
    expect(chooseDisplay({ displays: three, ini: parseSimIni(iniOf({ fullScreen: 1, fullWidth: 2560, fullHeight: 1440 })) }))
      .toMatchObject({ key: '2', reason: 'ini', why: 'iRacing is set to run full screen at 2560 × 1440, and 3 screens are that size' });
  });

  test('two screens alike and the primary not one of them: the first from the left', () => {
    const rig = [at(1, 0, 1920, 1080, { primary: true }), at(3, 3840, 2560, 1440), at(2, 1920, 2560, 1440)];
    expect(chooseDisplay({ displays: rig, ini: parseSimIni(iniOf({ fullScreen: 1, fullWidth: 2560, fullHeight: 1440 })) })).toMatchObject({ key: '2', reason: 'ini' });
    expect(chooseDisplay({ displays: rig })).toMatchObject({ key: '2', reason: 'largest' });
  });

  test('mixed scaling: the largest is by physical size, and the ini is matched by it', () => {
    const mixed = [
      at(1, 0, 2560, 1440),                                          // 2560 × 1440 at 100 %
      at(2, 2560, 2560, 1440, { scaleFactor: 1.5, primary: true }),  // 3840 × 2160 at 150 %
      at(3, 5120, 1920, 1080),                                       // 1920 × 1080 at 100 %
    ];
    expect(chooseDisplay({ displays: mixed })).toMatchObject({ key: '2', reason: 'largest' });
    expect(chooseDisplay({ displays: mixed, ini: parseSimIni(iniOf({ fullScreen: 1, fullWidth: 1920, fullHeight: 1080 })) })).toMatchObject({ key: '3', reason: 'ini' });
    expect(chooseDisplay({ displays: mixed, ini: parseSimIni(iniOf({ fullScreen: 1, fullWidth: 3840, fullHeight: 2160 })) })).toMatchObject({ key: '2', reason: 'ini' });
  });

  test('a sim window straddling two of three screens is on the one with more of it', () => {
    const three = [at(1, 0, 2560, 1440), at(2, 2560, 2560, 1440, { primary: true }), at(3, 5120, 2560, 1440)];
    expect(chooseDisplay({ displays: three, simWindow: { x: 1500, y: 0, width: 2560, height: 1440 } })).toMatchObject({ key: '2', reason: 'sim' });   // 1060 left, 1500 middle
    expect(chooseDisplay({ displays: three, simWindow: { x: 4000, y: 0, width: 2560, height: 1440 } })).toMatchObject({ key: '3', reason: 'sim' });   // 1120 middle, 1440 right
  });
});

test.describe('the same rig with the ultrawide as the Windows primary', () => {
  const choose2 = (over) => chooseDisplay({ displays: RIG_ULTRAWIDE_MAIN, ...over });

  test('the ultrawide by the ini, by the sim, and by size; the small one when the sim is there or when he says so', () => {
    expect(choose2({ ini: parseSimIni(HIS_INI) })).toMatchObject({ key: '1', reason: 'ini' });
    expect(choose2({})).toMatchObject({ key: '1', reason: 'largest' });
    expect(choose2({ simWindow: { x: 0, y: 0, width: 3440, height: 1440 }, ini: parseSimIni(HIS_INI) })).toMatchObject({ key: '1', reason: 'sim' });
    expect(choose2({ simWindow: { x: -823, y: 0, width: 823, height: 618 }, ini: parseSimIni(HIS_INI) })).toMatchObject({ key: '2', reason: 'sim' });
    expect(choose2({ choice: '2', simWindow: { x: 0, y: 0, width: 3440, height: 1440 } })).toMatchObject({ key: '2', reason: 'chosen' });
    // iRacing set to run at the small screen's size finds it wherever it sits.
    expect(choose2({ ini: parseSimIni(iniOf({ fullScreen: 1, fullWidth: 1440, fullHeight: 1080 })) })).toMatchObject({ key: '2', reason: 'ini' });
  });

  test('a maximized frame that overhangs the primary screen is still on it', () => {
    // As Windows reports a maximized window: eight pixels past the edge on the left, right and top.
    expect(choose2({ simWindow: { x: -8, y: -8, width: 3456, height: 1408 } })).toMatchObject({ key: '1', reason: 'sim' });
  });

  test('named as it sits: the small one on the left, the ultrawide on the right and the main one', () => {
    expect(listDisplays(normaliseDisplays(RIG_ULTRAWIDE_MAIN, SMALL_SIZE))).toEqual([
      { key: '2', name: '1440 × 1080 (left)', primary: false },
      { key: '1', name: '3440 × 1440 (right, primary)', primary: true },
    ]);
  });

  test("the primary is not what puts the window on the sim's screen: the same answer with either as primary", () => {
    const asked = { simWindow: { x: 0, y: 0, width: 3440, height: 1440 } };
    const flipped = RIG_ULTRAWIDE_MAIN.map((d) => ({ ...d, primary: !d.primary }));
    expect(chooseDisplay({ displays: flipped, ...asked })).toMatchObject({ key: '1', reason: 'sim' });
    expect(chooseDisplay({ displays: RIG_ULTRAWIDE_MAIN, ...asked })).toMatchObject({ key: '1', reason: 'sim' });
  });
});

test.describe('the screens by a plain name', () => {
  const at = (id, x, y, width, height, extra = {}) => ({ id, bounds: { x, y, width, height }, scaleFactor: 1, primary: false, ...extra });

  test('his two: the size it really is, where it sits and whether it is the main one', () => {
    const rig = normaliseDisplays(RIG, SMALL_SIZE);   // the host has said what the small panel is
    expect(displayName(SMALL, rig)).toBe('1440 × 1080 (left, primary)');
    expect(displayName(ULTRAWIDE, rig)).toBe('3440 × 1440 (right)');
    expect(listDisplays(rig)).toEqual([
      { key: '2', name: '1440 × 1080 (left, primary)', primary: true },
      { key: '1', name: '3440 × 1440 (right)', primary: false },
    ]);
  });

  test('a scaled screen the host has not sized is named by the estimate, and says "about"; one at 100 % is exact', () => {
    // 823 × 618 at 175 % is 1440 × 1080 to the panel but 1081.5 to arithmetic: 1082 is the estimate, and not passed off as its size.
    expect(displayName(SMALL, RIG)).toBe('about 1440 × 1082 (left, primary)');
    expect(displayName(ULTRAWIDE, RIG)).toBe('3440 × 1440 (right)');
    expect(listDisplays(RIG).map((d) => d.name)).toEqual(['about 1440 × 1082 (left, primary)', '3440 × 1440 (right)']);
  });

  test('one screen has no left or right', () => {
    expect(displayName(at(1, 0, 0, 2560, 1440, { primary: true }), [at(1, 0, 0, 2560, 1440, { primary: true })])).toBe('2560 × 1440 (primary)');
    expect(displayName(at(1, 0, 0, 2560, 1440), [at(1, 0, 0, 2560, 1440)])).toBe('2560 × 1440 (primary)');   // the only one is the main one
  });

  test('three side by side are left, middle and right, and screens of one size are told apart by it', () => {
    const three = [at(2, 2560, 0, 2560, 1440, { primary: true }), at(1, 0, 0, 2560, 1440), at(3, 5120, 0, 2560, 1440)];
    expect(listDisplays(three).map((d) => d.name)).toEqual(['2560 × 1440 (left)', '2560 × 1440 (middle, primary)', '2560 × 1440 (right)']);
  });

  test('stacked screens are top and bottom, and more than three are counted from the left', () => {
    const stacked = [at(1, 0, 0, 1920, 1080, { primary: true }), at(2, 0, 1080, 1920, 1080)];
    expect(listDisplays(stacked).map((d) => d.name)).toEqual(['1920 × 1080 (top, primary)', '1920 × 1080 (bottom)']);
    const four = [0, 1, 2, 3].map((i) => at(i + 1, i * 1920, 0, 1920, 1080, { primary: i === 0 }));
    expect(listDisplays(four).map((d) => d.name)).toEqual([
      '1920 × 1080 (left, primary)', '1920 × 1080 (2nd from the left)', '1920 × 1080 (3rd from the left)', '1920 × 1080 (right)',
    ]);
  });

  test('the keys are the ones the settings hold, as text', () => {
    expect(listDisplays([{ ...SMALL, id: 2528732444 }, ULTRAWIDE]).map((d) => d.key)).toEqual(['2528732444', '1']);
  });
});

test.describe('where the window goes', () => {
  test('all of the screen on Windows, its work area on a Mac, which leaves the dock and the menu bar alone', () => {
    const [ultrawide] = normaliseDisplays([ULTRAWIDE]);
    expect(boundsFor(ultrawide, 'win32')).toEqual({ x: 823, y: 0, width: 3440, height: 1440 });
    expect(boundsFor(ultrawide, 'linux')).toEqual({ x: 823, y: 0, width: 3440, height: 1440 });
    expect(boundsFor(ultrawide, 'darwin')).toEqual({ x: 823, y: 0, width: 3440, height: 1400 });
  });
});

// ── Asking the host ─────────────────────────────────────────────────────────────────────────────────────────

test.describe('fetchSimWindow', () => {
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

  const URL_ = 'http://localhost:18889/racing-desk/data/simwindow';
  const RUNNING = { process: 'iRacingSim64DX11', window: { x: 1440, y: 0, width: 3440, height: 1440 }, monitor: { x: 1440, y: 0, width: 3440, height: 1440 } };

  test('running, from an answer in one piece or several', async () => {
    const body = JSON.stringify(RUNNING);
    const whole = fakeGet({ status: 200, body });
    expect(await fetchSimWindow(URL_, { get: whole.get })).toMatchObject({ state: 'running', window: RUNNING.window });
    expect(whole.seen.urls).toEqual([URL_]);
    expect(await fetchSimWindow(URL_, { get: fakeGet({ status: 200, chunks: [body.slice(0, 20), body.slice(20)] }).get })).toMatchObject({ state: 'running' });
  });

  test('null is the sim not running; anything that is not an answer is unknown', async () => {
    expect(await fetchSimWindow(URL_, { get: fakeGet({ status: 200, body: 'null' }).get })).toEqual({ state: 'not-running' });
    for (const answer of [
      { status: 404, body: 'Not found' },
      { status: 500, body: JSON.stringify(RUNNING) },
      { status: 200, body: '<html>' },
      { status: 200, body: '' },
      { status: 200, body: '[1,2]' },
      { status: 200, body: '{"DataCorePlugin.GameRunning":1}' },   // the telemetry, from something else on that port
      { error: 'ECONNREFUSED' },
    ]) {
      expect(await fetchSimWindow(URL_, { get: fakeGet(answer).get }), JSON.stringify(answer)).toEqual({ state: 'unknown' });
    }
  });

  test('unknown when no answer comes in time, and the request is dropped', async () => {
    const { get, seen } = fakeGet({ silent: true });
    const started = Date.now();
    expect(await fetchSimWindow(URL_, { get, timeoutMs: 50 })).toEqual({ state: 'unknown' });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(seen.destroyed).toBe(1);
  });

  test('an answer that goes on for ever is dropped, not read', async () => {
    const big = fakeGet({ status: 200, chunks: ['{"x":"', 'a'.repeat(70 * 1024), '"}'] });
    expect(await fetchSimWindow(URL_, { get: big.get })).toEqual({ state: 'unknown' });
    expect(big.seen.destroyed).toBe(1);
  });

  test('unknown when the request cannot even be made', async () => {
    expect(await fetchSimWindow('nowhere', { get: () => { throw new Error('Invalid URL'); } })).toEqual({ state: 'unknown' });
  });

  test('over a real socket on 127.0.0.1: an answer, one that never comes, and nothing listening', async () => {
    const seen = [];
    const server = http.createServer((req, res) => {
      seen.push(req.url);
      if (req.url.endsWith('/hang')) return;   // never answered
      res.setHeader('content-type', 'application/json');
      res.end(req.url.endsWith('/closed') ? 'null' : JSON.stringify(RUNNING));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      expect(await fetchSimWindow(`${base}/racing-desk/data/simwindow`)).toMatchObject({ state: 'running', process: 'iRacingSim64DX11' });
      expect(await fetchSimWindow(`${base}/closed`)).toEqual({ state: 'not-running' });
      const started = Date.now();
      expect(await fetchSimWindow(`${base}/hang`, { timeoutMs: 100 })).toEqual({ state: 'unknown' });
      expect(Date.now() - started).toBeLessThan(2000);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    // The port it was on is not listening any more.
    expect(await fetchSimWindow(`${base}/racing-desk/data/simwindow`, { timeoutMs: 500 })).toEqual({ state: 'unknown' });
    expect(seen[0]).toBe('/racing-desk/data/simwindow');
  });
});

// ── The keeper ──────────────────────────────────────────────────────────────────────────────────────────────

// A window that says where it is and does what it is told — and would show, hide or take the focus if it were
// asked to, which the test then sees. `drift` is how many of the next setBounds calls come out as they do on a
// screen of another scale: at the size the window had before.
function fakeWindow(start = { x: 0, y: 0, width: 823, height: 618 }) {
  const win = {
    bounds: { ...start },
    calls: [],
    drift: 0,
    destroyed: false,
    isDestroyed: () => win.destroyed,
    getBounds: () => ({ ...win.bounds }),
    setBounds: (b) => {
      win.calls.push(['setBounds', { ...b }]);
      if (win.drift > 0) {
        win.drift--;
        win.bounds = { x: b.x, y: b.y, width: win.bounds.width, height: win.bounds.height };
      } else {
        win.bounds = { ...b };
      }
    },
  };
  for (const name of ['show', 'showInactive', 'hide', 'focus', 'blur', 'minimize', 'restore', 'maximize', 'moveTop']) {
    win[name] = () => { win.calls.push([name]); };
  }
  return win;
}

const RUNNING_ON_ULTRAWIDE = { state: 'running', window: { x: 1440, y: 0, width: 3440, height: 1440 }, monitor: { x: 1440, y: 0, width: 3440, height: 1440 } };
const RUNNING_ON_SMALL = { state: 'running', window: { x: 0, y: 0, width: 1440, height: 1080 }, monitor: { x: 0, y: 0, width: 1440, height: 1080 } };
const NOT_RUNNING = { state: 'not-running' };
const HOST_SILENT = { state: 'unknown' };
// Physical pixels to the screens' own units, for his layout: the ultrawide begins at 1440 physical, 823 in DIPs.
const toDip = (r) => (r.x >= 1440 ? { x: 823 + (r.x - 1440), y: r.y, width: r.width, height: r.height } : { x: r.x / 1.75, y: r.y / 1.75, width: r.width / 1.75, height: r.height / 1.75 });

function keeper(over = {}) {
  const win = over.window === undefined ? fakeWindow() : over.window;
  const said = [];
  const told = { count: 0 };
  const asked = { host: 0, ini: 0, monitors: 0 };
  // `monitors` is what the host's monitors route says: his two screens in physical pixels, or a function for another answer.
  const state = {
    displays: [SMALL, ULTRAWIDE], choice: undefined, ini: HIS_INI, sim: NOT_RUNNING,
    monitors: { state: 'ok', monitors: MONITORS_SMALL_MAIN },
  };
  const hud = createHudDisplay({
    getWindow: () => win,
    getDisplays: () => state.displays,
    getChoice: () => state.choice,
    readIni: () => { asked.ini++; return state.ini; },
    askSimWindow: async () => { asked.host++; return typeof state.sim === 'function' ? state.sim() : state.sim; },
    askMonitors: async () => { asked.monitors++; return typeof state.monitors === 'function' ? state.monitors() : state.monitors; },
    toDipRect: toDip,
    onChange: () => { told.count++; },
    platform: 'win32',
    askWithinMs: 40,
    log: (line) => said.push(line),
    ...over.options,
  });
  return { hud, win, said, asked, state, told };
}

// Physical to DIPs for that layout: a rectangle whose centre is left of the origin is on the 175 % screen.
const toDipMain = (r) => (r.x + r.width / 2 >= 0 ? { ...r } : { x: r.x / 1.75, y: r.y / 1.75, width: r.width / 1.75, height: r.height / 1.75 });

const moves = (win) => win.calls.filter(([name]) => name === 'setBounds').map(([, b]) => b);
const noShowing = (win) => expect(win.calls.filter(([name]) => name !== 'setBounds')).toEqual([]);

test.describe('the keeper', () => {
  test('makes the window on the screen the ini says, without asking the host: the sim is probably not running', () => {
    const { hud, asked, said } = keeper();
    expect(hud.initialBounds()).toEqual({ x: 823, y: 0, width: 3440, height: 1440 });
    expect(asked.host).toBe(0);
    expect(asked.monitors).toBe(0);
    // Nobody has said yet what the small panel is, and the line does not claim to know.
    expect(said).toEqual([
      '[RacingDesk] Screens: about 1440 × 1082 at 175% (0, 0), primary; 3440 × 1440 at 100% (823, 0)',
      '[RacingDesk] HUD screen: 3440 × 1440 (right) — iRacing is set to run maximized at 3440 × 1440',
    ]);
  });

  test('currentKey is the screen the rule last chose, and null before it has run: what a recording is of', async () => {
    const { hud, state, asked } = keeper();
    expect(hud.currentKey()).toBeNull();
    hud.initialBounds();
    expect(hud.currentKey()).toBe('1');   // the ini: the ultrawide
    state.sim = RUNNING_ON_SMALL;
    await hud.refresh();
    expect(hud.currentKey()).toBe('2');
    state.choice = '1';
    await hud.settingsChanged();
    expect(hud.currentKey()).toBe('1');
    // It asks nothing of its own.
    const before = { ...asked };
    hud.currentKey();
    expect(asked).toEqual(before);
  });

  test('a window made on the primary screen by the system is moved to the chosen one, and looked at again if it did not take', () => {
    const { hud, win } = keeper();
    win.drift = 1;   // the first try comes out at the small size
    expect(hud.place()).toBe(true);
    expect(moves(win)).toEqual([{ x: 823, y: 0, width: 3440, height: 1440 }, { x: 823, y: 0, width: 3440, height: 1440 }]);
    expect(win.getBounds()).toEqual({ x: 823, y: 0, width: 3440, height: 1440 });
    noShowing(win);
  });

  test('the host says the sim is on the small screen: the window goes there, and it is said once', async () => {
    const { hud, win, said, state } = keeper();
    hud.place();
    win.calls.length = 0;
    state.sim = RUNNING_ON_SMALL;
    const decision = await hud.refresh();
    expect(decision).toMatchObject({ key: '2', reason: 'sim' });
    expect(moves(win)).toEqual([{ x: 0, y: 0, width: 823, height: 618 }]);
    // Asked again, nothing changed: nothing moved, nothing said.
    const said1 = said.length;
    await hud.refresh();
    await hud.refresh();
    expect(moves(win)).toHaveLength(1);
    expect(said).toHaveLength(said1);
    expect(said.filter((line) => line.includes('HUD screen:')).at(-1)).toBe('[RacingDesk] HUD screen: 1440 × 1080 (left, primary) — iRacing is running on it');
    noShowing(win);
  });

  test("the sim's window in physical pixels is taken to the screens' units, so the ultrawide at x = 1440 is the one at 823", async () => {
    const { hud, win, state } = keeper({ window: fakeWindow({ x: 0, y: 0, width: 823, height: 618 }) });
    state.ini = null;
    state.sim = RUNNING_ON_ULTRAWIDE;
    expect(await hud.refresh()).toMatchObject({ key: '1', reason: 'sim' });
    expect(win.getBounds()).toEqual({ x: 823, y: 0, width: 3440, height: 1440 });
  });

  test('with the ultrawide as the primary and the small screen to its left: the sim on the small one takes the HUD there, and back', async () => {
    const { hud, win, state } = keeper({ window: fakeWindow({ x: 0, y: 0, width: 3440, height: 1440 }), options: { toDipRect: toDipMain } });
    state.displays = RIG_ULTRAWIDE_MAIN;
    // Windows reports the small screen's window in physical pixels, left of the origin.
    state.sim = { state: 'running', window: { x: -1440, y: 0, width: 1440, height: 1080 }, monitor: { x: -1440, y: 0, width: 1440, height: 1080 } };
    expect(await hud.refresh()).toMatchObject({ key: '2', reason: 'sim' });
    expect(win.getBounds()).toEqual({ x: -823, y: 0, width: 823, height: 618 });
    state.sim = { state: 'running', window: { x: -8, y: -8, width: 3456, height: 1408 }, monitor: { x: 0, y: 0, width: 3440, height: 1440 } };
    expect(await hud.refresh()).toMatchObject({ key: '1', reason: 'sim' });
    expect(win.getBounds()).toEqual({ x: 0, y: 0, width: 3440, height: 1440 });
    noShowing(win);
  });

  test('the host is not there: the ini decides, and it is said that the host did not say', async () => {
    const { hud, said, state } = keeper();
    state.sim = { state: 'unknown' };
    expect(await hud.refresh()).toMatchObject({ key: '1', reason: 'ini' });
    expect(said.at(-1)).toContain('(the host did not say where iRacing is)');
  });

  test('a host that never answers is not waited for beyond the limit, and the ini decides', async () => {
    const { hud, win, state } = keeper();
    state.sim = () => new Promise(() => {});
    const started = Date.now();
    expect(await hud.refresh()).toMatchObject({ key: '1', reason: 'ini' });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(win.getBounds()).toEqual({ x: 823, y: 0, width: 3440, height: 1440 });
  });

  test('a host that fails is a host that did not say', async () => {
    for (const sim of [() => { throw new Error('ECONNREFUSED'); }, () => Promise.reject(new Error('boom')), () => undefined, () => 'x', () => ({})]) {
      const { hud, state } = keeper();
      state.sim = sim;
      expect(await hud.refresh(), String(sim)).toMatchObject({ key: '1', reason: 'ini' });
    }
  });

  test('an ini that is missing or garbled leaves the largest screen, host or not', async () => {
    for (const ini of [null, '', '\0\0garbage', '[Display]']) {
      const { hud, state } = keeper();
      state.ini = ini;
      state.sim = { state: 'unknown' };
      expect(await hud.refresh(), String(ini)).toMatchObject({ key: '1', reason: 'largest' });
    }
    const { hud, state } = keeper({ options: { readIni: () => { throw new Error('EACCES'); } } });
    state.sim = { state: 'unknown' };
    expect(await hud.refresh()).toMatchObject({ key: '1', reason: 'largest' });
  });

  test('a choice made in Settings applies at once, and only when it has changed', async () => {
    const { hud, win, asked, state, said } = keeper();
    hud.place();
    state.sim = RUNNING_ON_ULTRAWIDE;
    await hud.refresh();
    const hostAsks = asked.host;
    // Nothing changed: not asked.
    await hud.settingsChanged();
    expect(asked.host).toBe(hostAsks);
    state.choice = '2';
    expect(await hud.settingsChanged()).toMatchObject({ key: '2', reason: 'chosen' });
    expect(win.getBounds()).toEqual({ x: 0, y: 0, width: 823, height: 618 });
    expect(said.at(-1)).toBe('[RacingDesk] HUD screen: 1440 × 1080 (left, primary) — you chose it in Settings');
    // The same choice again: not asked, not moved.
    const moved = moves(win).length;
    await hud.settingsChanged();
    expect(moves(win)).toHaveLength(moved);
    // Back to Automatic.
    state.choice = 'auto';
    expect(await hud.settingsChanged()).toMatchObject({ key: '1', reason: 'sim' });
    expect(win.getBounds()).toEqual({ x: 823, y: 0, width: 3440, height: 1440 });
    noShowing(win);
  });

  test('a screen that goes: the HUD follows the sim, says the choice is not connected, and goes back when the screen does', async () => {
    const { hud, win, state, said } = keeper();
    const extra = { id: 9, bounds: { x: 4263, y: 0, width: 1920, height: 1080 }, workArea: { x: 4263, y: 0, width: 1920, height: 1040 }, scaleFactor: 1, primary: false };
    state.displays = [SMALL, ULTRAWIDE, extra];
    state.choice = '9';
    state.sim = RUNNING_ON_ULTRAWIDE;
    expect(await hud.refresh()).toMatchObject({ key: '9', reason: 'chosen' });
    expect(win.getBounds()).toEqual({ x: 4263, y: 0, width: 1920, height: 1080 });

    state.displays = [SMALL, ULTRAWIDE];   // unplugged
    expect(await hud.refresh()).toMatchObject({ key: '1', reason: 'sim', choiceMissing: true });
    expect(win.getBounds()).toEqual({ x: 823, y: 0, width: 3440, height: 1440 });
    expect(said.at(-1)).toContain('the screen chosen in Settings is not connected, so it is Automatic for now');
    expect((await hud.describe()).choiceMissing).toBe(true);

    state.displays = [SMALL, ULTRAWIDE, extra];   // plugged in again: the choice was never lost
    expect(await hud.refresh()).toMatchObject({ key: '9', reason: 'chosen', choiceMissing: false });
    expect(win.getBounds()).toEqual({ x: 4263, y: 0, width: 1920, height: 1080 });
  });

  test('the primary going away and the screens changing scale move the window to where the rule now says', async () => {
    const { hud, win, state } = keeper();
    state.sim = { state: 'not-running' };
    await hud.refresh();
    expect(win.getBounds()).toEqual({ x: 823, y: 0, width: 3440, height: 1440 });
    // The ultrawide is now the only screen, at the origin.
    state.displays = [{ ...ULTRAWIDE, bounds: { x: 0, y: 0, width: 3440, height: 1440 }, primary: true }];
    expect(await hud.refresh()).toMatchObject({ key: '1', reason: 'only' });
    expect(win.getBounds()).toEqual({ x: 0, y: 0, width: 3440, height: 1440 });
  });

  test('Ctrl+Shift+R puts it back on the chosen screen, not the primary one', async () => {
    const { hud, win, state } = keeper();
    hud.place();
    win.bounds = { x: 100, y: 100, width: 500, height: 300 };   // moved or resized by something
    state.sim = RUNNING_ON_ULTRAWIDE;
    await hud.reset();
    expect(win.getBounds()).toEqual({ x: 823, y: 0, width: 3440, height: 1440 });
    win.bounds = { x: 0, y: 0, width: 823, height: 618 };
    state.choice = '2';
    await hud.reset();
    expect(win.getBounds()).toEqual({ x: 0, y: 0, width: 823, height: 618 });
    noShowing(win);
  });

  test('a window that will not take its bounds is tried three times, and said', async () => {
    const { hud, win, said } = keeper();
    win.drift = 99;
    await hud.refresh();
    expect(moves(win)).toHaveLength(3);
    expect(said.at(-1)).toMatch(/HUD screen: the window is at 823x618 \(823, 0\), not 3440x1440 \(823, 0\), after 3 tries/);
    win.drift = 0;
    await hud.refresh();
    expect(win.getBounds()).toEqual({ x: 823, y: 0, width: 3440, height: 1440 });
  });

  test('a window a pixel or two off is where it should be: nothing is set at every poll', async () => {
    const { hud, win } = keeper({ window: fakeWindow({ x: 822, y: 1, width: 3441, height: 1439 }) });
    await hud.refresh();
    expect(moves(win)).toEqual([]);
  });

  test('rounds asked for while one is under way are run once more, with what is known then', async () => {
    const { hud, win, state, asked } = keeper();
    let release;
    state.sim = () => new Promise((resolve) => { release = () => resolve(RUNNING_ON_SMALL); });
    const first = hud.refresh();
    const second = hud.refresh();
    const third = hud.refresh();
    await new Promise((resolve) => setImmediate(resolve));
    expect(asked.host).toBe(1);
    // The sim's window is now on the ultrawide, for the round that follows.
    state.sim = RUNNING_ON_ULTRAWIDE;
    release();
    const [a, b, c] = await Promise.all([first, second, third]);
    expect(asked.host).toBe(2);
    expect([a.key, b.key, c.key]).toEqual(['1', '1', '1']);
    expect(win.getBounds()).toEqual({ x: 823, y: 0, width: 3440, height: 1440 });
  });

  test('the screens that cannot be read leave the window alone, and nothing rejects', async () => {
    const { hud, win, said } = keeper({ options: { getDisplays: () => { throw new Error('no screens'); } } });
    expect(hud.initialBounds()).toBeNull();
    expect(hud.place()).toBe(false);
    expect(await hud.refresh()).toBeNull();
    expect(await hud.describe()).toEqual({ displays: [], using: null, choiceMissing: false });
    expect(moves(win)).toEqual([]);
    expect(said.some((line) => line.includes('the screens could not be read (no screens)'))).toBe(true);
  });

  test('a window that has gone is left alone', async () => {
    const { hud, win, state } = keeper();
    win.destroyed = true;
    state.sim = RUNNING_ON_SMALL;
    expect(await hud.refresh()).toMatchObject({ key: '2' });
    expect(win.calls).toEqual([]);
    expect(hud.place()).toBe(false);
  });

  test("in dev mode the window is dev-mode.js's: nothing moves it, and the host is not asked", async () => {
    const { hud, win, asked, state } = keeper({ options: { keepAsIs: true } });
    state.sim = RUNNING_ON_SMALL;
    expect(hud.place()).toBe(false);
    expect(await hud.refresh()).toMatchObject({ key: '1', reason: 'ini' });
    expect(win.calls).toEqual([]);
    expect(asked.host).toBe(0);
  });

  test('on a Mac there is no sim window to ask for, and the work area is used', async () => {
    const { hud, win, asked } = keeper({ options: { platform: 'darwin' } });
    expect(hud.initialBounds()).toEqual({ x: 823, y: 0, width: 3440, height: 1400 });
    expect(await hud.refresh()).toMatchObject({ key: '1' });
    expect(asked.host).toBe(0);
    expect(win.getBounds()).toEqual({ x: 823, y: 0, width: 3440, height: 1400 });
  });

  test('says which screens there are once, and again when they change', async () => {
    const { hud, said, state } = keeper();
    await hud.refresh();
    await hud.refresh();
    expect(said.filter((line) => line.includes('Screens:'))).toHaveLength(1);
    state.displays = [SMALL];
    await hud.refresh();
    expect(said.filter((line) => line.includes('Screens:'))).toHaveLength(2);
    expect(said.at(-1)).toContain('it is the only screen');
  });

  test("tells the desk the screens by name and where the HUD is and why, and never shows or hides anything", async () => {
    const { hud, win, state } = keeper();
    state.sim = RUNNING_ON_ULTRAWIDE;
    await hud.refresh();
    expect(await hud.describe()).toEqual({
      displays: [
        { key: '2', name: '1440 × 1080 (left, primary)', primary: true },
        { key: '1', name: '3440 × 1440 (right)', primary: false },
      ],
      using: { key: '1', name: '3440 × 1440 (right)', reason: 'sim', why: 'iRacing is running on it' },
      choiceMissing: false,
    });
    noShowing(win);
  });

  test('without anything decided yet, describe works it out from what is known', async () => {
    const { hud } = keeper();
    expect((await hud.describe()).using).toMatchObject({ key: '1', reason: 'ini' });
  });
});

test.describe('the keeper: what the host says of the screens, and what it does not say', () => {
  const changed = (said) => said.filter((line) => line.includes('Screens:'));

  test('the screens are named by the sizes the host gives: asked once for a layout, and again when the layout changes', async () => {
    const { hud, said, asked, state } = keeper();
    hud.place();   // made before the host was asked
    expect(changed(said)).toEqual(['[RacingDesk] Screens: about 1440 × 1082 at 175% (0, 0), primary; 3440 × 1440 at 100% (823, 0)']);
    await hud.refresh();
    expect(asked.monitors).toBe(1);
    expect(changed(said).at(-1)).toBe('[RacingDesk] Screens: 1440 × 1080 at 175% (0, 0), primary; 3440 × 1440 at 100% (823, 0)');
    await hud.refresh();
    await hud.describe();
    expect(asked.monitors).toBe(1);
    expect((await hud.describe()).displays.map((d) => d.name)).toEqual(['1440 × 1080 (left, primary)', '3440 × 1440 (right)']);
    // The small screen is set to 150 %: 960 × 720 to Electron, the same panel, a layout the host was not asked about.
    state.displays = [{ ...SMALL, bounds: { x: 0, y: 0, width: 960, height: 720 }, scaleFactor: 1.5 }, ULTRAWIDE];
    await hud.refresh();
    expect(asked.monitors).toBe(2);
    expect(changed(said).at(-1)).toBe('[RacingDesk] Screens: 1440 × 1080 at 150% (0, 0), primary; 3440 × 1440 at 100% (823, 0)');
  });

  test('a host that does not list the monitors leaves the estimate, marked as one, and is asked again next round', async () => {
    const { hud, state, asked } = keeper();
    for (const answer of [HOST_SILENT, { state: 'ok', monitors: [] }, { state: 'ok', monitors: [{ x: 0, y: 0, width: 1000, height: 1000 }] }, () => { throw new Error('ECONNREFUSED'); }, () => new Promise(() => {})]) {
      state.monitors = answer;
      const before = asked.monitors;
      expect((await hud.describe()).displays.map((d) => d.name), String(answer)).toEqual(['about 1440 × 1082 (left, primary)', '3440 × 1440 (right)']);
      expect(asked.monitors).toBe(before + 1);
    }
    // And the round still decides, whatever the monitors did.
    expect(await hud.refresh()).toMatchObject({ key: '1', reason: 'ini' });
    // Then the host says: the names are the panel's.
    state.monitors = { state: 'ok', monitors: MONITORS_SMALL_MAIN };
    await hud.refresh();
    expect((await hud.describe()).displays.map((d) => d.name)).toEqual(['1440 × 1080 (left, primary)', '3440 × 1440 (right)']);
  });

  test('the monitors are paired with the screens by where they are, with the ultrawide as the primary too', async () => {
    const { hud, state } = keeper({ options: { toDipRect: toDipMain } });
    state.displays = RIG_ULTRAWIDE_MAIN;
    state.monitors = { state: 'ok', monitors: MONITORS_ULTRAWIDE_MAIN };
    expect((await hud.describe()).displays).toEqual([
      { key: '2', name: '1440 × 1080 (left)', primary: false },
      { key: '1', name: '3440 × 1440 (right, primary)', primary: true },
    ]);
  });

  test('the ini finds the small screen for iRacing set to run at 1440 × 1080, with or without the host, and the window goes there', async () => {
    for (const monitors of [{ state: 'ok', monitors: MONITORS_SMALL_MAIN }, HOST_SILENT]) {
      const { hud, win, state } = keeper();
      state.ini = iniOf({ maximized: 0, width: 1440, height: 1080 });
      state.monitors = monitors;
      expect(await hud.refresh(), JSON.stringify(monitors)).toMatchObject({ key: '2', reason: 'ini' });
      expect(win.getBounds()).toEqual({ x: 0, y: 0, width: 823, height: 618 });
    }
  });

  test("the host not saying where iRacing is is not the host saying it is closed: the HUD stays on the sim's screen", async () => {
    const { hud, win, state, said } = keeper();
    state.sim = RUNNING_ON_SMALL;
    expect(await hud.refresh()).toMatchObject({ key: '2', reason: 'sim' });
    expect(win.getBounds()).toEqual({ x: 0, y: 0, width: 823, height: 618 });

    // The host restarts, is slow, or fails, and a screen changes, the key is pressed, or a setting is saved.
    for (const silence of [HOST_SILENT, () => new Promise(() => {}), () => { throw new Error('ECONNREFUSED'); }, () => 'nonsense']) {
      state.sim = silence;
      expect(await hud.refresh(), String(silence)).toMatchObject({ key: '2', reason: 'sim', why: 'iRacing was last on it, and the host did not say where it is now' });
      expect(win.getBounds()).toEqual({ x: 0, y: 0, width: 823, height: 618 });
    }
    expect(await hud.reset()).toMatchObject({ key: '2' });
    expect(said.at(-1)).toContain('(the host did not say where iRacing is)');

    // A window made afresh in that time goes where the sim was, not where the ini says.
    win.bounds = { x: 100, y: 100, width: 500, height: 300 };
    expect(hud.place()).toBe(true);
    expect(win.getBounds()).toEqual({ x: 0, y: 0, width: 823, height: 618 });

    // The host saying it is closed is an answer: the ini decides, and an unknown after that has nothing to keep.
    state.sim = NOT_RUNNING;
    expect(await hud.refresh()).toMatchObject({ key: '1', reason: 'ini' });
    state.sim = HOST_SILENT;
    expect(await hud.refresh()).toMatchObject({ key: '1', reason: 'ini' });
    expect(win.getBounds()).toEqual({ x: 823, y: 0, width: 3440, height: 1440 });
  });

  test('a screen kept for the sim that is no longer connected is not kept, and a screen he chose beats it', async () => {
    const { hud, win, state } = keeper();
    state.sim = RUNNING_ON_SMALL;
    await hud.refresh();
    state.sim = HOST_SILENT;
    state.displays = [ULTRAWIDE, { ...SMALL, id: 5 }];   // that screen is gone, another has taken its place
    expect(await hud.refresh()).toMatchObject({ key: '1', reason: 'ini' });
    expect(win.getBounds()).toEqual({ x: 823, y: 0, width: 3440, height: 1440 });

    state.displays = [SMALL, ULTRAWIDE];
    state.sim = RUNNING_ON_SMALL;
    await hud.refresh();
    state.sim = HOST_SILENT;
    state.choice = '1';
    expect(await hud.refresh()).toMatchObject({ key: '1', reason: 'chosen' });
    state.choice = 'auto';
    // Back to Automatic: the choice is no longer a sim decision, so there is nothing kept, and the ini decides.
    expect(await hud.refresh()).toMatchObject({ key: '1', reason: 'ini' });
  });

  test('the desk is told when the screens or where the HUD is have changed, and only then', async () => {
    const { hud, state, told } = keeper();
    await hud.refresh();
    expect(told.count).toBe(1);
    await hud.refresh();
    await hud.refresh();
    expect(told.count).toBe(1);
    state.sim = RUNNING_ON_SMALL;
    await hud.refresh();
    expect(told.count).toBe(2);
    state.displays = [SMALL];
    await hud.refresh();
    expect(told.count).toBe(3);
  });

  test('a desk that cannot be told does not stop the HUD being put where it goes', async () => {
    const { hud, win, state } = keeper({ options: { onChange: () => { throw new Error('the window is gone'); } } });
    state.sim = RUNNING_ON_SMALL;
    expect(await hud.refresh()).toMatchObject({ key: '2' });
    expect(win.getBounds()).toEqual({ x: 0, y: 0, width: 823, height: 618 });
  });

  test('nothing is asked of the host on a Mac or in dev mode, monitors included', async () => {
    for (const options of [{ platform: 'darwin' }, { keepAsIs: true }]) {
      const { hud, asked } = keeper({ options });
      await hud.refresh();
      await hud.describe();
      expect(asked.host + asked.monitors, JSON.stringify(options)).toBe(0);
    }
  });

  test("a round is the host's short wait at the most, and two of them — one under way and one after — fit in the time the window may be kept hidden", async () => {
    // The host never answers. A round under way when another is asked for is followed by one more: two waits.
    const { hud, state } = keeper();
    state.sim = () => new Promise(() => {});
    state.monitors = () => new Promise(() => {});
    const started = Date.now();
    const first = hud.refresh();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = hud.refresh();
    await Promise.all([first, second]);
    expect(Date.now() - started).toBeLessThan(2 * 40 + 500);
    // hud-visibility waits for the window to be put right before it reveals it; that wait has to outlast the two rounds
    // of the real limit, or the window would come up where it was and move afterwards.
    expect(PREPARE_WITHIN_MS).toBeGreaterThanOrEqual(2 * ASK_WITHIN_MS + 500);
  });
});

// ── The host's monitors ─────────────────────────────────────────────────────────────────────────────────────

test.describe('the monitors, and which screen each is', () => {
  const dipsA = (r) => toDip(r);   // small at the origin, the ultrawide from x = 1440 physical

  test('each monitor is the screen it lies on, and gives its size in physical pixels', () => {
    const sizes = matchMonitors(RIG, MONITORS_SMALL_MAIN, dipsA);
    expect([...sizes]).toEqual([['2', { width: 1440, height: 1080 }], ['1', { width: 3440, height: 1440 }]]);
    const left = matchMonitors(RIG_ULTRAWIDE_MAIN, MONITORS_ULTRAWIDE_MAIN, toDipMain);
    expect(left.get('2')).toEqual({ width: 1440, height: 1080 });
    expect(left.get('1')).toEqual({ width: 3440, height: 1440 });
  });

  test('a monitor is not a screen it does not agree with in size: it is left alone', () => {
    // The layout changed between the two askings: a 1920 × 1080 monitor where the 175 % screen (823 × 618) is.
    const sizes = matchMonitors(RIG, [{ x: 0, y: 0, width: 1920, height: 1080 }, MONITORS_SMALL_MAIN[1]], dipsA);
    expect([...sizes.keys()]).toEqual(['1']);
  });

  test('two monitors on one screen, a monitor on none, and monitors that are not rectangles pair with nothing', () => {
    const twice = matchMonitors(RIG, [MONITORS_SMALL_MAIN[0], { x: 0, y: 0, width: 1440, height: 1080 }], dipsA);
    expect(twice.size).toBe(0);
    expect(matchMonitors(RIG, [{ x: 90000, y: 0, width: 1440, height: 1080 }], dipsA).size).toBe(0);
    for (const monitors of [null, undefined, 'monitors', [null, {}, { x: 0, y: 0, width: 0, height: 10 }, 7]]) {
      expect(matchMonitors(RIG, monitors, dipsA).size, String(monitors)).toBe(0);
    }
    expect(matchMonitors(RIG, MONITORS_SMALL_MAIN, () => { throw new Error('no such rectangle'); }).size).toBe(0);
    expect(matchMonitors([], MONITORS_SMALL_MAIN, dipsA).size).toBe(0);
  });

  test("the host's answer is a list of rectangles, or not an answer", () => {
    expect(parseMonitors(MONITORS_SMALL_MAIN)).toEqual({ state: 'ok', monitors: MONITORS_SMALL_MAIN });
    expect(parseMonitors([])).toEqual({ state: 'ok', monitors: [] });
    expect(parseMonitors([{ x: 0, y: 0, width: 10, height: 10 }, null, { x: 0, y: 0, width: -1, height: 10 }])).toEqual({
      state: 'ok', monitors: [{ x: 0, y: 0, width: 10, height: 10, primary: false }],
    });
    // A dozen screens is more than a rig has; more than that are not read.
    const many = Array.from({ length: 40 }, (_, i) => ({ x: i * 100, y: 0, width: 100, height: 100 }));
    expect(parseMonitors(many).monitors).toHaveLength(16);
    for (const body of [null, undefined, {}, 'null', 7, { RacingDeskTelemetry: 1 }, { window: { x: 0, y: 0, width: 1, height: 1 } }]) {
      expect(parseMonitors(body), JSON.stringify(body)).toEqual({ state: 'unknown' });
    }
  });

  test('fetched on the same terms as the sim window: a list, or unknown for anything else, and never for long', async () => {
    const fakeGet = (answer) => (url, _options, onResponse) => {
      const req = new EventEmitter();
      req.destroy = () => {};
      setImmediate(() => {
        if (answer.silent) return;
        if (answer.error) { req.emit('error', new Error(answer.error)); return; }
        const res = new EventEmitter();
        res.statusCode = answer.status;
        res.resume = () => {};
        onResponse(res);
        res.emit('data', Buffer.from(answer.body));
        res.emit('end');
      });
      return req;
    };
    const URL_ = 'http://localhost:18889/racing-desk/data/monitors';
    expect(await fetchMonitors(URL_, { get: fakeGet({ status: 200, body: JSON.stringify(MONITORS_SMALL_MAIN) }) })).toEqual({ state: 'ok', monitors: MONITORS_SMALL_MAIN });
    for (const answer of [{ status: 404, body: 'Not found' }, { status: 500, body: '[]' }, { status: 200, body: '<html>' }, { status: 200, body: 'null' }, { error: 'ECONNREFUSED' }]) {
      expect(await fetchMonitors(URL_, { get: fakeGet(answer) }), JSON.stringify(answer)).toEqual({ state: 'unknown' });
    }
    const started = Date.now();
    expect(await fetchMonitors(URL_, { get: fakeGet({ silent: true }), timeoutMs: 50 })).toEqual({ state: 'unknown' });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test('over a real socket on 127.0.0.1', async () => {
    const server = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(req.url.endsWith('/racing-desk/data/monitors') ? JSON.stringify(MONITORS_ULTRAWIDE_MAIN) : 'null');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      expect(await fetchMonitors(`${base}/racing-desk/data/monitors`)).toEqual({ state: 'ok', monitors: MONITORS_ULTRAWIDE_MAIN });
      // Anything else answering on that path — a null — is no list.
      expect(await fetchMonitors(`${base}/elsewhere`)).toEqual({ state: 'unknown' });
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
