/**
 * iRacing's own flag field (modules/js/session-flags.js). The payload's one word, currentFlagState, cannot tell a local
 * yellow from a full-course caution and leaves out one lap to green, ten and five to go, halfway, green held, the black
 * flag furled, disqualified and the start lights; the host sends the field itself, only where the sim says it. Here is
 * every bit of it and every combination the HUD acts on; the page that draws them is held in drive-view.spec.mjs.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const SF = require('../../modules/js/session-flags.js');

const KEY = 'DataCorePlugin.GameRawData.Telemetry.SessionFlags';
const at = (raw) => SF.decode(raw);

test.describe('the bits are irsdk_Flags', () => {
  test('each is the value IRSDKSharper (the SDK header) gives it', () => {
    expect(SF.KEY).toBe(KEY);
    expect(SF.BITS).toEqual({
      checkered: 0x1, white: 0x2, green: 0x4, yellow: 0x8, red: 0x10, blue: 0x20, debris: 0x40, crossed: 0x80,
      yellowWaving: 0x100, oneLapToGreen: 0x200, greenHeld: 0x400, tenToGo: 0x800, fiveToGo: 0x1000, randomWaving: 0x2000,
      caution: 0x4000, cautionWaving: 0x8000, black: 0x10000, disqualify: 0x20000, servicible: 0x40000, furled: 0x80000,
      repair: 0x100000, startHidden: 0x10000000, startReady: 0x20000000, startSet: 0x40000000, startGo: 0x80000000,
    });
  });
});

test.describe('read: a key that is sent is believed, so only a flag field is read as one', () => {
  test('a whole number of the field\'s 32 bits, signed or not', () => {
    expect(SF.read({ [KEY]: 0 })).toBe(0);
    expect(SF.read({ [KEY]: 8 })).toBe(8);
    expect(SF.read({ [KEY]: 0x4208 })).toBe(0x4208);
    expect(SF.read({ [KEY]: 0x80000004 })).toBe(0x80000004);
    expect(SF.read({ [KEY]: 4294967295 })).toBe(4294967295);
    expect(SF.read({ [KEY]: -2147483644 }), 'the SDK hands the field over as an int: the same 32 bits').toBe(0x80000004);
    expect(SF.read({ [KEY]: '4' })).toBe(4);
    expect(SF.read({ [KEY]: ' 16 ' })).toBe(16);
  });

  test('nothing made up: no key, no payload, not a number, not whole, not of the field', () => {
    for (const payload of [null, undefined, '', 0, 'x', [], {}, { [KEY]: null }, { [KEY]: undefined }, { [KEY]: '' }, { [KEY]: '  ' },
      { [KEY]: true }, { [KEY]: false }, { [KEY]: 'yellow' }, { [KEY]: 1.5 }, { [KEY]: NaN }, { [KEY]: Infinity },
      { [KEY]: 4294967296 }, { [KEY]: -2147483649 }, { [KEY]: [] }, { [KEY]: {} }, { currentFlagState: 'yellow' }]) {
      expect(SF.read(payload), JSON.stringify(payload)).toBeNull();
    }
  });
});

test.describe('decode: the flag the page shows', () => {
  test('a local yellow is the sector he is in: 0x8, 0x100 or both, without a full-course caution', () => {
    for (const raw of [0x8, 0x100, 0x8 | 0x100]) {
      const d = at(raw);
      expect(d.flag, `0x${raw.toString(16)}`).toBe('localyellow');
      expect(d.localYellow).toBe(true);
      expect(d.caution).toBe(false);
    }
  });

  test('a local yellow does not take the chequered flag from him: the finish is what he is looking at', () => {
    expect(at(0x1 | 0x100).flag).toBe('checkered');
    expect(at(0x1 | 0x8).flag).toBe('checkered');
    expect(at(0x1 | 0x100).localYellow, 'it is still known to be out').toBe(true);
    expect(at(0x1 | 0x4000).flag, 'a caution is still the caution, as it always was').toBe('caution');
  });

  test('a full-course caution is 0x4000 or 0x8000, and wins over the local yellow that comes with it', () => {
    for (const raw of [0x4000, 0x8000, 0x4000 | 0x8000, 0x4000 | 0x8, 0x8000 | 0x100, 0x4000 | 0x8 | 0x100]) {
      const d = at(raw);
      expect(d.flag, `0x${raw.toString(16)}`).toBe('caution');
      expect(d.caution).toBe(true);
    }
    expect(at(0x4000).localYellow).toBe(false);
  });

  test('one lap to green is 0x200 under a full-course caution, and is neither the caution nor the white flag', () => {
    expect(at(0x4000 | 0x200).flag).toBe('onetogreen');
    expect(at(0x8000 | 0x200).flag).toBe('onetogreen');
    expect(at(0x8000 | 0x8 | 0x200).flag).toBe('onetogreen');
    expect(at(0x4000 | 0x200).caution, 'the caution is still known to be out').toBe(true);
    expect(at(0x4000 | 0x200).oneToGreen).toBe(true);
    expect(at(0x4000).flag, 'a caution without it is the caution').toBe('caution');
    expect(at(0x4000).oneToGreen).toBe(false);
    expect(at(0x2).flag, 'the white flag is the last lap').toBe('white');
    expect(at(0x4000 | 0x200 | 0x2).flag, 'under a caution it is the caution that is shown, as it is over the white flag').toBe('onetogreen');
    expect(at(0x10000 | 0x4000 | 0x200).flag, 'the black flag is worse').toBe('black');
  });

  test('on its own 0x200 is nothing: it is up whenever he is not under green, and is never above the white or chequered flag', () => {
    // His recordings have it in every practice and test session, on out-laps, on the grid, in the parade and beside the
    // chequered flag in the cool-down: a flag that was out all the time would be no flag.
    expect(at(0x200).flag).toBe('none');
    expect(at(0x200).oneToGreen).toBe(false);
    expect(at(0x200 | 0x40000 | 0x10000000).flag).toBe('none');
    expect(at(0x2 | 0x200).flag, 'the white flag, the last lap').toBe('white');
    expect(at(0x1 | 0x200).flag, 'the chequered flag, through the cool-down').toBe('checkered');
    expect(at(0x4 | 0x200).flag).toBe('green');
    expect(at(0x8 | 0x200).flag).toBe('localyellow');
    expect(at(0x20 | 0x200).flag).toBe('blue');
    expect(at(0x40 | 0x200).flag).toBe('debris');
    expect(at(0x400 | 0x200).flag).toBe('greenheld');
    expect(at(0x80000 | 0x200).flag, 'the black flag furled is a warning, with it or not').toBe('furled');
  });

  test('green held is 0x400, and beats the plain green it comes with', () => {
    expect(at(0x4).flag).toBe('green');
    expect(at(0x4 | 0x400).flag).toBe('greenheld');
    expect(at(0x400).flag).toBe('greenheld');
    expect(at(0x4 | 0x400).greenHeld).toBe(true);
  });

  test('the black flag furled is a warning (0x80000), not the black flag (0x10000)', () => {
    expect(at(0x80000).flag).toBe('furled');
    expect(at(0x80000).furled).toBe(true);
    expect(at(0x10000).flag).toBe('black');
    expect(at(0x10000 | 0x80000).flag, 'the flag itself is the worse').toBe('black');
    expect(at(0x80000 | 0x4000).flag, 'a warning to him is before the track\'s caution').toBe('furled');
  });

  test('disqualified (0x20000) is a state of its own, worse than the black flag and the meatball', () => {
    expect(at(0x20000).flag).toBe('disqualify');
    expect(at(0x20000).disqualified).toBe(true);
    expect(at(0x20000 | 0x10000 | 0x100000).flag).toBe('disqualify');
  });

  test('the flags the one word always had keep their places', () => {
    expect(at(0x1).flag).toBe('checkered');
    expect(at(0x2).flag).toBe('white');
    expect(at(0x4).flag).toBe('green');
    expect(at(0x10).flag).toBe('red');
    expect(at(0x20).flag).toBe('blue');
    expect(at(0x40).flag).toBe('debris');
    expect(at(0x100000).flag).toBe('meatball');
    // The order: red, disqualified, the meatball, black, furled, caution (one to green under it), local yellow, blue,
    // debris, white, chequered, green held, green.
    expect(at(0x10 | 0x20000 | 0x100000 | 0x10000 | 0x80000 | 0x200 | 0x4000 | 0x8 | 0x20 | 0x40 | 0x2 | 0x1 | 0x400 | 0x4).flag).toBe('red');
    expect(at(0x20000 | 0x100000 | 0x10000).flag).toBe('disqualify');
    expect(at(0x100000 | 0x10000 | 0x4000).flag).toBe('meatball');
    expect(at(0x10000 | 0x80000 | 0x4000).flag).toBe('black');
    expect(at(0x8 | 0x20 | 0x40 | 0x2).flag).toBe('localyellow');
    expect(at(0x20 | 0x40 | 0x2 | 0x1 | 0x4).flag).toBe('blue');
    expect(at(0x40 | 0x2 | 0x1 | 0x4).flag).toBe('debris');
    expect(at(0x2 | 0x1 | 0x4).flag).toBe('white');
    expect(at(0x1 | 0x4).flag).toBe('checkered');
  });

  test('no flag out, and bits that are not flags the page shows, is none', () => {
    for (const raw of [0, 0x80, 0x200, 0x800, 0x1000, 0x2000, 0x40000, 0x10000000, 0x20000000, 0x40000000, 0x80000000]) {
      expect(at(raw).flag, `0x${raw.toString(16)}`).toBe('none');
    }
  });
});

test.describe('the values his own recordings have (the newest .ibt files, read 2026-09-30)', () => {
  // Every real frame also carries 0x40000 (service allowed: not a flag) and 0x10000000 (the start lights hidden) from the
  // first frame of a session to the last, or the start lights' own bit in their place. [value, where, flag, start lights]
  const RECORDED = [
    [0x10040200, 'practice or a test session, all of it; the grid (SessionState 1); qualifying', 'none', 'hidden'],
    [0x10000200, 'the first seconds of a session, before the service bit is up', 'none', 'hidden'],
    [0x20040200, 'warm-up and the parade: lights ready', 'none', 'ready'],
    [0x40040200, 'warm-up: lights set', 'none', 'set'],
    [0x80040204, 'warm-up and the start: lights go, green', 'green', 'go'],
    [0x80040004, 'the start, four seconds: lights go, green', 'green', 'go'],
    [0x20040600, 'the end of the parade: green held', 'greenheld', 'ready'],
    [0x80040604, 'the start after it', 'greenheld', 'go'],
    [0x10040000, 'mid-race, nothing out', 'none', 'hidden'],
    [0x10040004, 'mid-race, green', 'green', 'hidden'],
    [0x10040002, 'the last lap', 'white', 'hidden'],
    [0x10040001, 'the chequered flag', 'checkered', 'hidden'],
    [0x10040201, 'the cool-down, and the end of a lone qualifying: the chequered flag is still out', 'checkered', 'hidden'],
    [0x10040101, 'the chequered flag with a yellow waved somewhere after it', 'checkered', 'hidden'],
    [0x10040024, 'blue with green', 'blue', 'hidden'],
    [0x10040040, 'debris', 'debris', 'hidden'],
    [0x10040100, 'a local yellow, waved', 'localyellow', 'hidden'],
    [0x10040104, 'a local yellow at the start of a lap', 'localyellow', 'hidden'],
    [0x10040140, 'a local yellow and debris', 'localyellow', 'hidden'],
    [0x100c0200, 'the black flag furled, in practice', 'furled', 'hidden'],
  ];
  for (const [raw, where, flag, start] of RECORDED) {
    test(`0x${raw.toString(16)} (${where}) is ${flag}`, () => {
      const d = at(raw);
      expect(d.flag).toBe(flag);
      expect(d.start).toBe(start);
      expect(d.oneToGreen, 'no full-course caution in any recording').toBe(false);
    });
  }

  test('no real value shows a one lap to green, and the practice and grid value shows nothing at all', () => {
    for (const [raw] of RECORDED) expect(at(raw).flag, `0x${raw.toString(16)}`).not.toBe('onetogreen');
    expect(at(0x10040200).notices).toEqual([]);
  });
});

test.describe('decode: the small things, said once', () => {
  test('ten to go (0x800), five to go (0x1000) and halfway (0x80) are notices, and leave the flag as it was', () => {
    expect(at(0x800).notices).toEqual(['tenToGo']);
    expect(at(0x1000).notices).toEqual(['fiveToGo']);
    expect(at(0x80).notices).toEqual(['crossed']);
    expect(at(0x800 | 0x80).notices).toEqual(['tenToGo', 'crossed']);
    expect(at(0x800 | 0x1000).notices, 'five to go is what ten to go becomes').toEqual(['fiveToGo']);
    expect(at(0x4 | 0x800).flag).toBe('green');
    expect(at(0x4 | 0x800).notices).toEqual(['tenToGo']);
    expect(at(0x4000 | 0x1000).flag).toBe('caution');
    expect(at(0).notices).toEqual([]);
    expect(at(0x4).notices).toEqual([]);
  });

  test('what is said of each', () => {
    expect(SF.NOTICES.tenToGo).toBe('10 laps to go');
    expect(SF.NOTICES.fiveToGo).toBe('5 laps to go');
    expect(SF.NOTICES.crossed).toBe('Halfway');
  });

  test('the tracker says each once when it comes up, and again after it has gone', () => {
    const tracker = SF.createNoticeTracker();
    expect(tracker.update(at(0))).toEqual([]);
    expect(tracker.update(at(0x800))).toEqual([{ id: 'tenToGo', text: '10 laps to go' }]);
    expect(tracker.update(at(0x800)), 'not again while it is up').toEqual([]);
    expect(tracker.update(at(0x800 | 0x80))).toEqual([{ id: 'crossed', text: 'Halfway' }]);
    expect(tracker.update(at(0x1000 | 0x80))).toEqual([{ id: 'fiveToGo', text: '5 laps to go' }]);
    expect(tracker.update(at(0))).toEqual([]);
    expect(tracker.update(at(0x80))).toEqual([{ id: 'crossed', text: 'Halfway' }]);
  });

  test('a frame with no field forgets what was up: a source that comes back says them again', () => {
    const tracker = SF.createNoticeTracker();
    expect(tracker.update(at(0x1000))).toHaveLength(1);
    expect(tracker.update(null)).toEqual([]);
    expect(tracker.update(at(0x1000))).toHaveLength(1);
    tracker.reset();
    expect(tracker.update(at(0x1000))).toHaveLength(1);
  });
});

test.describe('decode: the start lights', () => {
  test('hidden, ready, set and go are the four bits of the top nibble', () => {
    expect(at(0x10000000).start).toBe('hidden');
    expect(at(0x20000000).start).toBe('ready');
    expect(at(0x40000000).start).toBe('set');
    expect(at(0x80000000).start).toBe('go');
    expect(at(0x80000004).start, 'go with the green flag: the sign bit is a flag').toBe('go');
    expect(at(0x80000004).flag).toBe('green');
    expect(at(0).start).toBeNull();
    expect(at(0x4000).start).toBeNull();
  });

  test('the grid draws set as its red lights and go as its green, and ready as nothing new', () => {
    expect(SF.lightsPhase(at(0x40000000))).toBe(6);
    expect(SF.lightsPhase(at(0x80000000))).toBe(7);
    expect(SF.lightsPhase(at(0x20000000))).toBe(0);
    expect(SF.lightsPhase(at(0x10000000))).toBe(0);
    expect(SF.lightsPhase(at(0))).toBe(0);
    expect(SF.lightsPhase(null)).toBe(0);
    expect(SF.lightsPhaseOf({ [KEY]: 0x40000000 })).toBe(6);
    expect(SF.lightsPhaseOf({ [KEY]: -2147483648 })).toBe(7);
    expect(SF.lightsPhaseOf({})).toBe(0);
  });
});

test.describe('flagOf: the field where the payload carries it, the one word where it does not', () => {
  test('with no field the word is the flag, as it has always been', () => {
    for (const word of ['none', 'yellow', 'green', 'red', 'blue', 'white', 'debris', 'checkered', 'black', 'meatball', 'orange']) {
      expect(SF.flagOf(null, word), word).toBe(word);
    }
    expect(SF.flagOf(null, ''), 'no word').toBe('none');
    expect(SF.flagOf(null, undefined)).toBe('none');
    expect(SF.flagOf(null, 0)).toBe('none');
    expect(SF.flagOf(null, '0')).toBe('none');
  });

  test('the field says which yellow; it is believed over the word', () => {
    expect(SF.flagOf(at(0x8), 'yellow')).toBe('localyellow');
    expect(SF.flagOf(at(0x4000), 'yellow')).toBe('caution');
    expect(SF.flagOf(at(0x100), 'none'), 'the word left a waved local yellow out').toBe('localyellow');
    expect(SF.flagOf(at(0), 'none')).toBe('none');
    expect(SF.flagOf(at(0), 'yellow'), 'the sim says nothing is out').toBe('none');
  });

  test('a car being lapped is in the word and not the field, and is kept where nothing else is out', () => {
    expect(SF.flagOf(at(0), 'orange')).toBe('orange');
    expect(SF.flagOf(at(0x4), 'orange'), 'green is out: the field decides').toBe('green');
    expect(SF.flagOf(at(0x4000), 'orange')).toBe('caution');
  });
});
