// iRacing's own flag field, read by the HUD. The payload's one word, `currentFlagState`, cannot tell a local yellow from
// a full-course caution and leaves out the rest (one lap to green, ten and five to go, halfway, green held, the black
// flag furled, disqualified, the start lights), so the host also sends the field itself — `SessionFlags`, iRacing's
// irsdk_Flags — under the name SimHub gives it, and only where the sim says it. This is the one place it is read.
// (One lap to green is only said under a full-course caution: see BITS.)
// Pure: no DOM, no timers, so it runs in the page, in Node and in the unit tests (tests/unit/session-flags.spec.mjs).
(function () {
  'use strict';

  const KEY = 'DataCorePlugin.GameRawData.Telemetry.SessionFlags';

  // irsdk_Flags, as IRSDKSharper names them (IRacingSdkEnum.Flags). 0x200 is the SDK's oneLapToGreen, and in his
  // recordings it is up whenever the car is not under green, which is most of the time: the whole of a practice or test
  // session (0x10040200), a qualifying out-lap, the grid before every start (standing starts too), the warm-up and the
  // parade (0x20040200, 0x40040200, 0x20040600), and beside the chequered flag in the cool-down (0x10040201). None of his
  // recordings has a full-course caution in it, so what the bit does under one has not been seen; it is taken as the SDK
  // names it. It is not a lap to the finish either: the SDK has no bit for that beyond the white flag (0x2, the last lap).
  // So the page says one lap to green only with a full-course caution up, and otherwise takes 0x200 for nothing.
  const BITS = Object.freeze({
    checkered: 0x1, white: 0x2, green: 0x4, yellow: 0x8, red: 0x10, blue: 0x20, debris: 0x40, crossed: 0x80,
    yellowWaving: 0x100, oneLapToGreen: 0x200, greenHeld: 0x400, tenToGo: 0x800, fiveToGo: 0x1000, randomWaving: 0x2000,
    caution: 0x4000, cautionWaving: 0x8000,
    black: 0x10000, disqualify: 0x20000, servicible: 0x40000, furled: 0x80000, repair: 0x100000,
    startHidden: 0x10000000, startReady: 0x20000000, startSet: 0x40000000, startGo: 0x80000000,
  });

  // The words the page gives a flag. The first ten are `currentFlagState`'s own (and 'orange', which only the host's
  // word has: the car ahead is being lapped); the rest are what the field adds: 'caution' is a full-course caution and
  // 'yellow' stays what the word says when it does not say which, 'localyellow' is the sector he is in, 'onetogreen' is a
  // full-course caution told one lap to green.
  const FLAGS = Object.freeze([
    'none', 'red', 'disqualify', 'meatball', 'black', 'furled', 'onetogreen', 'caution', 'localyellow', 'yellow', 'blue',
    'debris', 'white', 'checkered', 'greenheld', 'green', 'orange',
  ]);

  // A key that is sent is believed, so what is not a flag field is not read as one: a whole number of the field's 32 bits,
  // signed or not (the SDK hands a bitfield over as an int), or null.
  function read(payload) {
    if (!payload || typeof payload !== 'object') return null;
    const v = payload[KEY];
    if (v === undefined || v === null || v === '' || typeof v === 'boolean') return null;
    const n = typeof v === 'string' ? (v.trim() === '' ? NaN : Number(v.trim())) : v;
    if (typeof n !== 'number' || !isFinite(n) || Math.floor(n) !== n) return null;
    if (n < -2147483648 || n > 4294967295) return null;
    return n >>> 0;
  }

  // (The sign bit is startGo: a bitwise and with it is negative, never nought, so a test against nought is the test.)
  const has = (raw, bit) => (((raw >>> 0) & bit) !== 0);

  /**
   * What the field says. `flag` is the one the page shows as the flag, in this order: red, disqualified, the meatball,
   * the black flag, the black flag furled (a warning), a full-course caution (which is one lap to green when 0x200 is up
   * with it), a local yellow (not once the chequered flag is out: the finish is what he is looking at), blue, debris,
   * white (the last lap), the chequered flag, green held, green. 0x200 without a caution is nothing (see BITS), and is
   * never ranked above the white or the chequered flag. `notices` are the small things — ten to go, five to go,
   * halfway — that are said once, and `start` is the start lights (hidden, ready, set, go) or null.
   */
  function decode(raw) {
    const r = (raw >>> 0);
    const on = (name) => ((r & BITS[name]) !== 0);
    const caution = on('caution') || on('cautionWaving');
    const localYellow = on('yellow') || on('yellowWaving');
    const out = {
      raw: r,
      flag: 'none',
      caution, localYellow,
      oneToGreen: caution && on('oneLapToGreen'),
      greenHeld: on('greenHeld'),
      furled: on('furled'),
      disqualified: on('disqualify'),
      notices: [],
      start: null,
    };
    if (on('red')) out.flag = 'red';
    else if (on('disqualify')) out.flag = 'disqualify';
    else if (on('repair')) out.flag = 'meatball';
    else if (on('black')) out.flag = 'black';
    else if (on('furled')) out.flag = 'furled';
    else if (caution) out.flag = out.oneToGreen ? 'onetogreen' : 'caution';
    else if (localYellow && !on('checkered')) out.flag = 'localyellow';   // (0x10040101 is seen once a race is over)
    else if (on('blue')) out.flag = 'blue';
    else if (on('debris')) out.flag = 'debris';
    else if (on('white')) out.flag = 'white';
    else if (on('checkered')) out.flag = 'checkered';
    else if (on('greenHeld')) out.flag = 'greenheld';
    else if (on('green')) out.flag = 'green';

    // Five to go is what ten to go becomes: only the nearer is said if both are up.
    if (on('fiveToGo')) out.notices.push('fiveToGo');
    else if (on('tenToGo')) out.notices.push('tenToGo');
    if (on('crossed')) out.notices.push('crossed');

    if (on('startGo')) out.start = 'go';
    else if (on('startSet')) out.start = 'set';
    else if (on('startReady')) out.start = 'ready';
    else if (on('startHidden')) out.start = 'hidden';
    return out;
  }

  // What the page says of each notice, and of each flag it has a sentence for beyond the old words.
  const NOTICES = Object.freeze({
    tenToGo: '10 laps to go',
    fiveToGo: '5 laps to go',
    crossed: 'Halfway',
  });

  /**
   * The flag the page shows for this payload: the field's where the payload carries it, else the word it has always
   * sent, and with neither `none`. The host's word is kept where the field says nothing is out and the word says a
   * car ahead is being lapped ('orange'), which is not in the field.
   */
  function flagOf(detail, word) {
    const w = (!word || word === '0' || word === 0) ? 'none' : String(word);
    if (!detail) return w;
    if (detail.flag === 'none' && w === 'orange') return w;
    return detail.flag;
  }

  /**
   * Each notice is said once when it comes up: the tracker is fed every frame's decode (or null, for a frame with no
   * field) and gives back the notices that were not up on the frame before. A frame with no field forgets what was up,
   * so that a source that comes and goes says them again when it is back.
   */
  function createNoticeTracker() {
    let before = [];
    return {
      update(detail) {
        const now = detail ? detail.notices : [];
        const fresh = now.filter((id) => before.indexOf(id) < 0);
        before = now.slice();
        return fresh.map((id) => ({ id, text: NOTICES[id] }));
      },
      reset() { before = []; },
    };
  }

  /**
   * The start lights as the grid draws them (formation.js: 6 all red, 7 green) where the plugin's own phase says
   * nothing: set is the red lights all lit, go the green. Ready says the lights are coming and draws none of them.
   */
  function lightsPhase(detail) {
    if (!detail) return 0;
    if (detail.start === 'go') return 7;
    if (detail.start === 'set') return 6;
    return 0;
  }

  /** The same from a payload: 0 where it carries no field. */
  function lightsPhaseOf(payload) {
    const raw = read(payload);
    return raw === null ? 0 : lightsPhase(decode(raw));
  }

  const api = { KEY, BITS, FLAGS, NOTICES, read, has, decode, flagOf, createNoticeTracker, lightsPhase, lightsPhaseOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.RacingDeskSessionFlags = api;
})();
