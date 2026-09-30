// Which screen the HUD's window is on. It was the primary one, always; on a rig whose primary screen is a small one
// and whose sim runs on the big one, the HUD landed on the wrong monitor. The rule, in the order it is applied:
//
//   1. a screen he chose in Settings (`hudDisplay`), while it is connected;
//   2. otherwise ("Automatic", the default) the screen the sim's window is on, while the sim runs;
//   3. otherwise the screen whose physical size matches the size iRacing is set to run at, which is in
//      Documents\iRacing\rendererDX11Monitor.ini (read here, never written);
//   4. otherwise the largest screen, and if several are as large the primary one among them.
//
// Electron cannot see another program's windows, so the sim's window is asked of the app's own host
// (GET /racing-desk/data/simwindow, apps/host/RacingDesk.Host/SimWindow.cs), which answers in physical pixels. The
// host may be absent — dev mode, or one that failed to start, or SimHub's plugin on :8889 answering something else
// — and then the rule falls to the ini. Nothing here waits on it for long: a short timeout, and the answer is
// "unknown".
//
// The choosing is pure: the screens, the sim window's rectangle, the ini's text and the saved choice are handed in,
// so it is tested without Electron (tests/unit/hud-display.spec.mjs). createHudDisplay is the part main.js drives:
// it asks, chooses, moves the window and says once, in the log, each time the choice changes. It never shows or
// hides the window — that is modules/js/hud-visibility.js's alone; setBounds on a hidden window is not showing it.
const http = require('http');
const fs = require('fs');
const path = require('path');

const AUTO = 'auto';
const SIM_WINDOW_PATH = '/racing-desk/data/simwindow';
const ASK_WITHIN_MS = 800;
const MAX_ANSWER_BYTES = 64 * 1024;
const MAX_INI_BYTES = 1024 * 1024;
const INI_FILE = 'rendererDX11Monitor.ini';
// A window put on a screen of another scale is sometimes given the size of the one it left; asked again it is right.
const PLACE_TRIES = 3;
const CLOSE_ENOUGH_PX = 2;

const isNumber = (n) => typeof n === 'number' && Number.isFinite(n);

// ── Screens ─────────────────────────────────────────────────────

function validRect(r) {
  return !!r && typeof r === 'object' && isNumber(r.x) && isNumber(r.y) && isNumber(r.width) && isNumber(r.height)
    && r.width > 0 && r.height > 0 && Math.abs(r.x) < 1e6 && Math.abs(r.y) < 1e6 && r.width < 1e6 && r.height < 1e6;
}

// What the sim would be set to run at on a screen: its size in physical pixels. Electron gives DIPs and a scale.
function physicalSize(display) {
  const scale = isNumber(display.scaleFactor) && display.scaleFactor > 0 ? display.scaleFactor : 1;
  return { width: Math.round(display.bounds.width * scale), height: Math.round(display.bounds.height * scale) };
}

// A screen is kept by Electron's own id for it. The id is a number; the settings hold it as text.
function displayKey(display) {
  return String(display.id);
}

// The screens as the rule reads them: each with its key, its physical size and whether it is the primary. One that
// has no usable bounds is left out. Nothing says which is primary but the caller (`primary: true`); with none
// given, the one at the origin, which on Windows is always the primary, else the first.
function normaliseDisplays(list) {
  const kept = [];
  for (const d of Array.isArray(list) ? list : []) {
    if (!d || d.id === undefined || d.id === null || !validRect(d.bounds)) continue;
    const bounds = { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height };
    kept.push({
      id: d.id,
      key: displayKey(d),
      bounds,
      workArea: validRect(d.workArea) ? { x: d.workArea.x, y: d.workArea.y, width: d.workArea.width, height: d.workArea.height } : bounds,
      scaleFactor: isNumber(d.scaleFactor) && d.scaleFactor > 0 ? d.scaleFactor : 1,
      physical: physicalSize(d),
      primary: d.primary === true,
    });
  }
  if (kept.length && !kept.some((d) => d.primary)) {
    const atOrigin = kept.find((d) => d.bounds.x === 0 && d.bounds.y === 0);
    (atOrigin || kept[0]).primary = true;
  }
  return kept;
}

// Left to right, then top to bottom: the order screens are listed and ties are broken in.
const byPosition = (a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y;

const pixels = (size) => `${size.width} × ${size.height}`;

function ordinal(n) {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'}`;
}

// Where each screen is among the others, in words: left, middle, right — or top, middle, bottom where they are
// stacked rather than side by side. None with one screen.
function positionWords(displays) {
  const words = new Map();
  if (displays.length < 2) return words;
  const centres = displays.map((d) => ({ d, x: d.bounds.x + d.bounds.width / 2, y: d.bounds.y + d.bounds.height / 2 }));
  const spread = (axis) => Math.max(...centres.map((c) => c[axis])) - Math.min(...centres.map((c) => c[axis]));
  const across = spread('x') >= spread('y');
  const major = across ? 'x' : 'y';
  const minor = across ? 'y' : 'x';
  const ends = across ? ['left', 'right'] : ['top', 'bottom'];
  centres.sort((a, b) => a[major] - b[major] || a[minor] - b[minor] || String(a.d.id).localeCompare(String(b.d.id)));
  centres.forEach((c, i) => {
    let word;
    if (i === 0) word = ends[0];
    else if (i === centres.length - 1) word = ends[1];
    else if (centres.length === 3) word = 'middle';
    else word = `${ordinal(i + 1)} from the ${ends[0]}`;
    words.set(c.d.key, word);
  });
  return words;
}

// "3440 × 1440 (right)", "1440 × 1080 (left, primary)": the size the screen really has, where it sits, and whether
// Windows has it as the main one. Two screens of one size are told apart by where they sit.
function displayName(display, displays) {
  const list = normaliseDisplays(displays);
  const own = list.find((d) => d.key === displayKey(display)) || normaliseDisplays([display])[0];
  if (!own) return 'a screen';
  const where = positionWords(list).get(own.key);
  const notes = [where, own.primary ? 'primary' : null].filter(Boolean);
  return `${pixels(own.physical)}${notes.length ? ` (${notes.join(', ')})` : ''}`;
}

// The screens a choice can be made from, left to right: [{ key, name, primary }].
function listDisplays(displays) {
  const list = normaliseDisplays(displays);
  return list.slice().sort(byPosition).map((d) => ({ key: d.key, name: displayName(d, list), primary: d.primary }));
}

// ── The sim's window ────────────────────────────────────────────

function overlap(a, b) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

// The screen most of the window is on, both in the same units (DIPs, where the screens' bounds are). A window that
// straddles two is on the one that holds more of it; equal shares go to the left one. Null when the window is on none.
function matchSimWindow(rect, displays) {
  if (!validRect(rect)) return null;
  let best = null;
  for (const d of normaliseDisplays(displays).sort(byPosition)) {
    const share = overlap(rect, d.bounds);
    if (share > 0 && (best === null || share > best.share)) best = { display: d, share };
  }
  return best;
}

// The host's answer to /racing-desk/data/simwindow, once parsed: { state: 'running', window, monitor, process },
// { state: 'not-running' } (JSON null, or no window), or { state: 'unknown' } for anything that is not an answer.
function parseSimWindow(body) {
  if (body === null) return { state: 'not-running' };
  if (typeof body !== 'object' || Array.isArray(body)) return { state: 'unknown' };
  if (body.window === null) return { state: 'not-running' };
  if (!validRect(body.window)) return { state: 'unknown' };
  const pick = (r) => ({ x: r.x, y: r.y, width: r.width, height: r.height });
  return {
    state: 'running',
    window: pick(body.window),
    monitor: validRect(body.monitor) ? pick(body.monitor) : null,
    process: typeof body.process === 'string' ? body.process.slice(0, 64) : null,
  };
}

// GET the sim window from the host. Resolves parseSimWindow's answer; never rejects. The answer has timeoutMs to
// come in, whatever the host does with the request, and one bigger than a window's rectangle can be is dropped.
function fetchSimWindow(url, { timeoutMs = ASK_WITHIN_MS, get = http.get } = {}) {
  return new Promise((resolve) => {
    let done = false;
    let req = null;
    let deadline = null;
    const finish = (answer) => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      resolve(answer);
    };
    const giveUp = () => {
      if (done) return;
      finish({ state: 'unknown' });
      try { if (req) req.destroy(); } catch (e) { /* already gone */ }
    };
    // The socket's own timeout is reset by every byte; this one is not.
    deadline = setTimeout(giveUp, timeoutMs);
    if (typeof deadline.unref === 'function') deadline.unref();
    try {
      req = get(url, { timeout: timeoutMs }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          finish({ state: 'unknown' });
          return;
        }
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_ANSWER_BYTES) giveUp();
          else chunks.push(chunk);
        });
        res.on('end', () => {
          try {
            finish(parseSimWindow(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
          } catch (e) {
            finish({ state: 'unknown' });
          }
        });
        res.on('error', () => finish({ state: 'unknown' }));
      });
      req.on('timeout', giveUp);
      req.on('error', () => finish({ state: 'unknown' }));
    } catch (e) {
      finish({ state: 'unknown' });
    }
  });
}

// ── What iRacing is set to run at ───────────────────────────────

// The [Display] section of rendererDX11Monitor.ini, as much of it as the rule reads: whether it runs full screen,
// whether its window is maximized, and the two sizes. Null for text that is not that ini or leaves out what the
// rule needs. Lines are `key=value ; comment`; the file is iRacing's and is never written.
function parseSimIni(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  const values = {};
  let inDisplay = false;
  let sawDisplay = false;
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, '').trim();
    const section = /^\[([^\]]*)\]$/.exec(line);
    if (section) {
      inDisplay = section[1].trim().toLowerCase() === 'display';
      if (inDisplay) sawDisplay = true;
      continue;
    }
    if (!inDisplay) continue;
    const pair = /^([A-Za-z]\w*)\s*=\s*(\d{1,6})$/.exec(line);
    if (pair) values[pair[1].toLowerCase()] = parseInt(pair[2], 10);
  }
  if (!sawDisplay) return null;
  const size = (w, h) => (w > 0 && h > 0 ? { width: w, height: h } : null);
  const fullScreen = values.fullscreen;
  if (fullScreen !== 0 && fullScreen !== 1) return null;
  const ini = {
    fullScreen: fullScreen === 1,
    maximized: values.windowedmaximized === 1,
    windowed: size(values.windowedwidth, values.windowedheight),
    full: size(values.fullscreenwidth, values.fullscreenheight),
  };
  return (ini.fullScreen ? ini.full : ini.windowed) ? ini : null;
}

// The size iRacing is set to run at, and how: full screen at fullScreenWidth × Height, otherwise its window, which
// when maximized is the screen it is maximized on — and the size says which. Null when the ini says nothing.
function simSizeFromIni(ini) {
  if (!ini || typeof ini !== 'object') return null;
  if (ini.fullScreen) return ini.full ? { ...ini.full, how: 'fullscreen' } : null;
  return ini.windowed ? { ...ini.windowed, how: ini.maximized ? 'maximized' : 'windowed' } : null;
}

function simIniPath(documentsDir) {
  return path.join(documentsDir, 'iRacing', INI_FILE);
}

// The ini's text, or null: missing, unreadable, or larger than a settings file has any business being.
function readSimIni(documentsDir, { read = fs.readFileSync, stat = fs.statSync } = {}) {
  try {
    const file = simIniPath(documentsDir);
    if (stat(file).size > MAX_INI_BYTES) return null;
    return String(read(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

function describeIni(size, matches) {
  const where = size.how === 'fullscreen' ? `full screen at ${pixels(size)}`
    : size.how === 'maximized' ? `maximized at ${pixels(size)}`
    : `in a ${pixels(size)} window`;
  return `iRacing is set to run ${where}${matches > 1 ? `, and ${matches} screens are that size` : ''}`;
}

// ── The rule ────────────────────────────────────────────────────

/**
 * Which screen the HUD goes on.
 *
 *   displays    [{ id, bounds, workArea, scaleFactor, primary }] — Electron's, in DIPs
 *   choice      what Settings holds: a screen's key, or 'auto' / nothing
 *   simWindow   the sim's window as { x, y, width, height } in the same DIPs, or null while it is not running
 *   ini         parseSimIni's answer, or null
 *
 * → { display, key, reason, why, choiceMissing } — reason: chosen, only, sim, ini, largest, primary — or null when
 * there are no screens. `choiceMissing` is a choice that names a screen that is not connected: it is not used and
 * is not lost, and comes back into force when the screen does.
 */
function chooseDisplay({ displays, choice = null, simWindow = null, ini = null }) {
  const list = normaliseDisplays(displays).sort(byPosition);
  if (!list.length) return null;
  const primary = list.find((d) => d.primary) || list[0];
  const wanted = typeof choice === 'string' && choice.trim() && choice.trim() !== AUTO ? choice.trim() : null;
  const chosen = wanted === null ? null : list.find((d) => d.key === wanted) || null;
  const choiceMissing = wanted !== null && chosen === null;
  const made = (display, reason, why) => ({ display, key: display.key, reason, why, choiceMissing });

  if (chosen) return made(chosen, 'chosen', 'you chose it in Settings');
  if (list.length === 1) return made(list[0], 'only', 'it is the only screen');

  const onIt = matchSimWindow(simWindow, list);
  if (onIt) return made(onIt.display, 'sim', 'iRacing is running on it');

  const size = simSizeFromIni(ini);
  if (size) {
    const matches = list.filter((d) => d.physical.width === size.width && d.physical.height === size.height);
    if (matches.length) {
      const pick = matches.find((d) => d.primary) || matches[0];
      return made(pick, 'ini', describeIni(size, matches.length));
    }
  }

  const biggest = Math.max(...list.map((d) => d.physical.width * d.physical.height));
  const tied = list.filter((d) => d.physical.width * d.physical.height === biggest);
  if (tied.length === 1) return made(tied[0], 'largest', 'it is the largest screen');
  if (tied.includes(primary)) return made(primary, 'primary', 'the largest screens are alike, and it is the main one');
  return made(tied[0], 'largest', 'it is the first of the largest screens');
}

// Where the window goes on a screen: all of it, except on a Mac, where the dock and the menu bar are left alone.
function boundsFor(display, platform) {
  const r = platform === 'darwin' ? display.workArea : display.bounds;
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

const sameBounds = (a, b, tolerance = 0) => ['x', 'y', 'width', 'height'].every((k) => Math.abs(a[k] - b[k]) <= tolerance);

function describeDisplays(displays) {
  return displays.map((d) => `${pixels(d.physical)} at ${Math.round(d.scaleFactor * 100)}% (${d.bounds.x}, ${d.bounds.y})${d.primary ? ', primary' : ''}`).join('; ');
}

/**
 * The HUD window's screen, kept.
 *
 *   getWindow()     the HUD's BrowserWindow, or null
 *   getDisplays()   [{ id, bounds, workArea, scaleFactor, primary }] as connected now
 *   getChoice()     what Settings holds for `hudDisplay`
 *   readIni()       the ini's text, or null
 *   askSimWindow()  resolves fetchSimWindow's answer; may never resolve, and is not waited for beyond askWithinMs
 *   toDipRect(r)    the sim window's rectangle from physical pixels into the units screens are in
 *   keepAsIs        dev mode: dev-mode.js puts the window where it wants it
 *
 * { initialBounds, place, refresh, reset, settingsChanged, describe }
 */
function createHudDisplay({
  getWindow,
  getDisplays,
  getChoice = () => null,
  readIni = () => null,
  askSimWindow = async () => ({ state: 'unknown' }),
  toDipRect = (r) => r,
  platform = process.platform,
  keepAsIs = false,
  askWithinMs = ASK_WITHIN_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  log = () => {},
}) {
  let last = null;            // the last decision
  let lastLogged = null;      // what was last said of the choice, so that it is said once per change
  let lastDisplays = null;    // and of the screens
  let choiceUsed = null;      // the saved choice as it was when the last decision was made
  let running = null;
  let again = false;

  function liveWindow() {
    const win = getWindow();
    return win && !win.isDestroyed() ? win : null;
  }

  function connected() {
    let list;
    try {
      list = normaliseDisplays(getDisplays());
    } catch (e) {
      log(`[RacingDesk] HUD screen: the screens could not be read (${e.message})`);
      list = [];
    }
    const seen = describeDisplays(list);
    if (seen !== lastDisplays) {
      lastDisplays = seen;
      log(`[RacingDesk] Screens: ${seen || 'none'}`);
    }
    return list;
  }

  // The choice Settings holds, as a screen's key; null for Automatic, however that is written.
  function saved() {
    try {
      const value = getChoice();
      const key = typeof value === 'string' ? value.trim() : '';
      return key && key !== AUTO ? key : null;
    } catch (e) {
      return null;
    }
  }

  function iniNow() {
    try {
      return parseSimIni(readIni());
    } catch (e) {
      return null;
    }
  }

  function decide(list, simWindow) {
    return chooseDisplay({ displays: list, choice: saved(), simWindow, ini: iniNow() });
  }

  // Said once for each change of the choice or of why it was made — not at every poll that finds it the same.
  function say(decision, list, sim) {
    const notes = [];
    if (decision.choiceMissing) notes.push('the screen chosen in Settings is not connected, so it is Automatic for now');
    if (sim === 'unknown') notes.push('the host did not say where iRacing is');
    const key = `${decision.key}|${decision.reason}|${notes.join('|')}`;
    if (key === lastLogged) return;
    lastLogged = key;
    log(`[RacingDesk] HUD screen: ${displayName(decision.display, list)} — ${decision.why}${notes.length ? ` (${notes.join('; ')})` : ''}`);
  }

  // Set the window's bounds and look again: on a screen of another scale the first try can come out at the size of
  // the one the window left. A hidden window is being moved; nothing here is a show.
  function place(decision) {
    const win = liveWindow();
    if (!win || !decision || keepAsIs) return false;
    const target = boundsFor(decision.display, platform);
    for (let tries = 0; tries < PLACE_TRIES; tries++) {
      if (sameBounds(win.getBounds(), target, CLOSE_ENOUGH_PX)) return true;
      win.setBounds(target);
    }
    const ended = win.getBounds();
    if (sameBounds(ended, target, CLOSE_ENOUGH_PX)) return true;
    log(`[RacingDesk] HUD screen: the window is at ${ended.width}x${ended.height} (${ended.x}, ${ended.y}), not ${target.width}x${target.height} (${target.x}, ${target.y}), after ${PLACE_TRIES} tries`);
    return false;
  }

  // The rule with no host asked — the sim is probably not running, or nothing is known of it — so the ini decides.
  function decideWithoutAsking() {
    const list = connected();
    choiceUsed = saved();
    const decision = decide(list, null);
    if (decision) {
      last = decision;
      say(decision, list, 'not-asked');
    }
    return decision;
  }

  // Bounds for the window's first making.
  function initialBounds() {
    const decision = decideWithoutAsking();
    return decision ? boundsFor(decision.display, platform) : null;
  }

  // The window put where the rule says with no host asked, at once: for a window that has just been made.
  function placeNow() {
    return place(decideWithoutAsking());
  }

  async function ask() {
    if (platform !== 'win32' || keepAsIs) return { state: 'unknown', skipped: true };
    let timer = null;
    try {
      const answer = await Promise.race([
        Promise.resolve().then(askSimWindow),
        new Promise((resolve) => { timer = setTimer(() => resolve({ state: 'unknown' }), askWithinMs); }),
      ]);
      return answer && typeof answer === 'object' && typeof answer.state === 'string' ? answer : { state: 'unknown' };
    } catch (e) {
      return { state: 'unknown' };
    } finally {
      if (timer !== null) clearTimer(timer);
    }
  }

  async function once() {
    const sim = await ask();
    const list = connected();
    let simWindow = null;
    if (sim.state === 'running') {
      try {
        const dip = toDipRect(sim.window);
        simWindow = validRect(dip) ? dip : null;
      } catch (e) {
        simWindow = null;
      }
    }
    choiceUsed = saved();
    const decision = decide(list, simWindow);
    if (!decision) return null;
    last = decision;
    say(decision, list, sim.skipped ? 'not-asked' : sim.state);
    place(decision);
    return decision;
  }

  // Ask where the sim is, choose and move the window, and answer the choice. Rounds asked for while one is under way
  // are run once more when it is over, with the screens as they are then. Never rejects.
  function refresh() {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      let decision = last;
      try {
        do {
          again = false;
          try {
            decision = await once();
          } catch (e) {
            log(`[RacingDesk] HUD screen: ${e.message}`);
          }
        } while (again);
      } finally {
        running = null;
      }
      return decision;
    })();
    return running;
  }

  // Ctrl+Shift+R and the Stream Deck's reset: the window goes back where the rule puts it, not to the primary screen.
  function reset() {
    return refresh();
  }

  // Settings or the file changed under us: a different choice is put into effect at once.
  function settingsChanged() {
    return saved() !== choiceUsed ? refresh() : Promise.resolve(last);
  }

  // For the desk's Settings page: the screens to choose from and where the HUD is now.
  function describe() {
    const list = connected();
    const decision = last && list.some((d) => d.key === last.key) ? last : decide(list, null);
    return {
      displays: listDisplays(list),
      using: decision ? { key: decision.key, name: displayName(decision.display, list), reason: decision.reason, why: decision.why } : null,
      choiceMissing: decision ? decision.choiceMissing : false,
    };
  }

  return { initialBounds, place: placeNow, refresh, reset, settingsChanged, describe };
}

module.exports = {
  AUTO, SIM_WINDOW_PATH, ASK_WITHIN_MS,
  physicalSize, displayKey, normaliseDisplays, positionWords, displayName, listDisplays,
  matchSimWindow, parseSimWindow, fetchSimWindow,
  parseSimIni, simSizeFromIni, simIniPath, readSimIni,
  chooseDisplay, boundsFor, createHudDisplay,
};
