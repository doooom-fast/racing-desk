// Which screen the HUD's window is on. It was the primary one, always; on a rig whose primary screen is a small one
// and whose sim runs on the big one, the HUD landed on the wrong monitor. The rule, in the order it is applied:
//
//   1. a screen he chose in Settings (`hudDisplay`), while it is connected;
//   2. otherwise ("Automatic", the default) the screen the sim's window is on, while a sim runs — iRacing, Assetto Corsa
//      or Assetto Corsa EVO, whichever the host finds (it names the process, and the reason names the game);
//   3. otherwise the screen whose physical size matches the size iRacing is set to run at, which is in
//      Documents\iRacing\rendererDX11Monitor.ini (read here, never written);
//   4. otherwise the largest screen, and if several are as large the primary one among them.
//
// Electron cannot see another program's windows, so the sim's window is asked of the app's own host
// (GET /racing-desk/data/simwindow, apps/host/RacingDesk.Host/SimWindow.cs), which answers in physical pixels. The
// host may be absent — dev mode, or one that failed to start, or SimHub's plugin on :8889 answering something else
// — and then the rule falls to the ini. Nothing here waits on it for long: a short timeout, and the answer is
// "unknown". An "unknown" is not "the sim is closed": if the sim was last seen on a screen that is still there, that
// is where the HUD stays until the host says otherwise.
//
// A screen's size. Electron gives it in DIPs, and Chromium takes the enclosing rectangle of the physical size over the
// scale: 1440 × 1080 at 175 % is 823 × 618, not 823 × 617. So bounds × scale is not the physical size and cannot be
// turned back into it (1439 is 823 wide too). Sizes are compared within one step of the scale, and the real ones are
// asked of the host (GET /racing-desk/data/monitors, EnumDisplayMonitors) and paired with the screens by position; a
// name that has only the estimate says "about".
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
const MONITORS_PATH = '/racing-desk/data/monitors';
const MAX_MONITORS = 16;
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

const scaleOf = (display) => (isNumber(display.scaleFactor) && display.scaleFactor > 0 ? display.scaleFactor : 1);

// An estimate of a screen's size in physical pixels: its DIPs by its scale. It is exact at 100 % and a pixel or two out
// at other scales (see the head of this file), so it is only what is compared and shown until the host has said.
function physicalSize(display) {
  const scale = scaleOf(display);
  return { width: Math.round(display.bounds.width * scale), height: Math.round(display.bounds.height * scale) };
}

// Whether a size in DIPs is a physical size at that scale. Chromium takes the enclosing rectangle, so the DIPs by the
// scale come to up to a step of the scale above the physical size; below it, or exact, if it were rounded another way.
// At 100 % there is nothing to round and the two are the same number.
function agrees(dip, scale, physical) {
  const step = scale === 1 ? 0 : scale;
  return Math.abs(dip * scale - physical) <= step + 1e-6;
}

const isSize = (s) => !!s && isNumber(s.width) && isNumber(s.height) && s.width > 0 && s.height > 0;

// Whether a screen is a size, physically: exactly, where the host has said what it is; within a step where it has not.
function isSized(display, size) {
  if (display.exact) return display.physical.width === size.width && display.physical.height === size.height;
  return agrees(display.bounds.width, display.scaleFactor, size.width) && agrees(display.bounds.height, display.scaleFactor, size.height);
}

// Whether the room a screen has beside its taskbar is a size: what a window maximized on it fills.
function isWorkSized(display, size) {
  return agrees(display.workArea.width, display.scaleFactor, size.width) && agrees(display.workArea.height, display.scaleFactor, size.height);
}

// A screen is kept by Electron's own id for it. The id is a number; the settings hold it as text.
function displayKey(display) {
  return String(display.id);
}

// The screens as the rule reads them: each with its key, its physical size (`exact` when it is not an estimate: the
// host said, or the scale is 100 %) and whether it is the primary. `sizes` is what the host said, by key. A screen
// already read, with an exact size of its own, keeps it. One that has no usable bounds is left out. Nothing says which
// is primary but the caller (`primary: true`); with none given, the one at the origin, which on Windows is always the
// primary, else the first.
function normaliseDisplays(list, sizes = null) {
  const kept = [];
  for (const d of Array.isArray(list) ? list : []) {
    if (!d || d.id === undefined || d.id === null || !validRect(d.bounds)) continue;
    const bounds = { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height };
    const scaleFactor = scaleOf(d);
    const said = sizes && typeof sizes.get === 'function' ? sizes.get(displayKey(d)) : null;
    const carried = d.exact === true && isSize(d.physical) ? d.physical : null;
    const known = carried || (isSize(said) ? said : null);
    kept.push({
      id: d.id,
      key: displayKey(d),
      bounds,
      workArea: validRect(d.workArea) ? { x: d.workArea.x, y: d.workArea.y, width: d.workArea.width, height: d.workArea.height } : bounds,
      scaleFactor,
      physical: known ? { width: known.width, height: known.height } : physicalSize(d),
      exact: !!known || scaleFactor === 1,
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

// A screen's size for a name or a log line; "about" where all that is known is the estimate.
const sizeWords = (display) => `${display.exact ? '' : 'about '}${pixels(display.physical)}`;

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

// "3440 × 1440 (right)", "1440 × 1080 (left, primary)": the size the screen has, where it sits, and whether Windows
// has it as the main one. Two screens of one size are told apart by where they sit.
function displayName(display, displays) {
  const list = normaliseDisplays(displays);
  const own = list.find((d) => d.key === displayKey(display)) || normaliseDisplays([display])[0];
  if (!own) return 'a screen';
  const where = positionWords(list).get(own.key);
  const notes = [where, own.primary ? 'primary' : null].filter(Boolean);
  return `${sizeWords(own)}${notes.length ? ` (${notes.join(', ')})` : ''}`;
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

// The physical size of each screen, from the monitors the host lists (physical pixels, as Windows lays them out): a
// Map from a screen's key to { width, height }. A monitor is paired with the screen most of it lies on, once it is in
// the screens' own units (`toDip`), and only if the two agree on their size within a step of the scale; a screen that
// two monitors would claim, or that none does, is left with its estimate.
function matchMonitors(displays, monitors, toDip = (r) => r) {
  const list = normaliseDisplays(displays);
  const claims = new Map();
  for (const m of Array.isArray(monitors) ? monitors : []) {
    if (!validRect(m)) continue;
    let dip;
    try {
      dip = toDip({ x: m.x, y: m.y, width: m.width, height: m.height });
    } catch (e) {
      continue;
    }
    const on = matchSimWindow(dip, list);
    if (!on || !agrees(on.display.bounds.width, on.display.scaleFactor, m.width) || !agrees(on.display.bounds.height, on.display.scaleFactor, m.height)) continue;
    const held = claims.get(on.display.key) || [];
    held.push({ width: m.width, height: m.height });
    claims.set(on.display.key, held);
  }
  const sizes = new Map();
  for (const [key, held] of claims) if (held.length === 1) sizes.set(key, held[0]);
  return sizes;
}

// The layout of the screens, as text: which screens there are, where and at what scale. What the host said of their
// sizes is good for as long as this is the same.
function layoutOf(displays) {
  return displays.map((d) => `${d.key}@${d.bounds.x},${d.bounds.y},${d.bounds.width},${d.bounds.height}x${d.scaleFactor}`).sort().join(';');
}

// The game a process name belongs to, for the reason the rule gives ("Assetto Corsa is running on it"): the host says which
// sim's window it found, by the names of RacingDesk.Core.Sims.SimProcesses. No process named is iRacing's (a host from
// before the other sims); a name that is none of these is "the sim".
const GAMES_BY_PROCESS = Object.freeze({
  iracingsim64dx11: 'iRacing',
  iracingsim64: 'iRacing',
  acs: 'Assetto Corsa',
  assettocorsaevo: 'Assetto Corsa EVO',
  'ac2-win64-shipping': 'Assetto Corsa Competizione',
});
function gameOfProcess(process) {
  if (typeof process !== 'string' || !process.trim()) return 'iRacing';
  const key = process.trim().replace(/\.exe$/i, '').toLowerCase();
  return GAMES_BY_PROCESS[key] || 'the sim';
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
function fetchSimWindow(url, options = {}) {
  return fetchJson(url, parseSimWindow, options);
}

// The monitors the host lists, once parsed: { state: 'ok', monitors: [{ x, y, width, height, primary }] }, or
// { state: 'unknown' } for anything that is not a list of them. Physical pixels, as Windows lays them out.
function parseMonitors(body) {
  if (!Array.isArray(body)) return { state: 'unknown' };
  const monitors = body.filter(validRect).slice(0, MAX_MONITORS)
    .map((m) => ({ x: m.x, y: m.y, width: m.width, height: m.height, primary: m.primary === true }));
  return { state: 'ok', monitors };
}

// GET the monitors from the host, on the same terms as the sim window: parseMonitors' answer, never a rejection.
function fetchMonitors(url, options = {}) {
  return fetchJson(url, parseMonitors, options);
}

// GET a route of the host and parse it. The answer has timeoutMs to come in, whatever the host does with the request;
// a status other than 200, a body that is not JSON and one that goes on for ever are all `{ state: 'unknown' }`.
function fetchJson(url, parse, { timeoutMs = ASK_WITHIN_MS, get = http.get } = {}) {
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
            finish(parse(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
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

function describeIni(size, matches, workArea) {
  const where = size.how === 'fullscreen' ? `full screen at ${pixels(size)}`
    : size.how === 'maximized' ? `maximized at ${pixels(size)}${workArea ? ', which is a screen without its taskbar' : ''}`
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
 *   simKept     the key of the screen the sim was last seen on, given only when the host did not say where it is now
 *               (which is not the same as saying it is not running): while that screen is connected it is the answer
 *   ini         parseSimIni's answer, or null
 *   simGame     the game whose window simWindow is, in words (gameOfProcess); iRacing when not said
 *   keptGame    the game that was on simKept's screen, in words; iRacing when not said
 *
 * → { display, key, reason, why, choiceMissing, game } — reason: chosen, only, sim, ini, largest, primary — or null when
 * there are no screens. `choiceMissing` is a choice that names a screen that is not connected: it is not used and
 * is not lost, and comes back into force when the screen does. `game` is the sim a 'sim' decision was made for.
 */
function chooseDisplay({ displays, choice = null, simWindow = null, simKept = null, ini = null, simGame = null, keptGame = null }) {
  const list = normaliseDisplays(displays).sort(byPosition);
  if (!list.length) return null;
  const primary = list.find((d) => d.primary) || list[0];
  const wanted = typeof choice === 'string' && choice.trim() && choice.trim() !== AUTO ? choice.trim() : null;
  const chosen = wanted === null ? null : list.find((d) => d.key === wanted) || null;
  const choiceMissing = wanted !== null && chosen === null;
  const made = (display, reason, why, game = null) => ({ display, key: display.key, reason, why, choiceMissing, game });

  if (chosen) return made(chosen, 'chosen', 'you chose it in Settings');
  if (list.length === 1) return made(list[0], 'only', 'it is the only screen');

  const onIt = matchSimWindow(simWindow, list);
  if (onIt) {
    const game = typeof simGame === 'string' && simGame.trim() ? simGame.trim() : 'iRacing';
    return made(onIt.display, 'sim', `${game} is running on it`, game);
  }

  const kept = typeof simKept === 'string' ? list.find((d) => d.key === simKept) || null : null;
  if (kept) {
    const game = typeof keptGame === 'string' && keptGame.trim() ? keptGame.trim() : 'iRacing';
    return made(kept, 'sim', `${game} was last on it, and the host did not say where it is now`, game);
  }

  const size = simSizeFromIni(ini);
  if (size) {
    // A maximized window fills the room a screen has beside its taskbar, so that is a size it can be too.
    let matches = list.filter((d) => isSized(d, size));
    let workArea = false;
    if (!matches.length && size.how === 'maximized') {
      matches = list.filter((d) => isWorkSized(d, size));
      workArea = matches.length > 0;
    }
    if (matches.length) {
      const pick = matches.find((d) => d.primary) || matches[0];
      return made(pick, 'ini', describeIni(size, matches.length, workArea));
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
  return displays.map((d) => `${sizeWords(d)} at ${Math.round(d.scaleFactor * 100)}% (${d.bounds.x}, ${d.bounds.y})${d.primary ? ', primary' : ''}`).join('; ');
}

/**
 * The HUD window's screen, kept.
 *
 *   getWindow()     the HUD's BrowserWindow, or null
 *   getDisplays()   [{ id, bounds, workArea, scaleFactor, primary }] as connected now
 *   getChoice()     what Settings holds for `hudDisplay`
 *   readIni()       the ini's text, or null
 *   askSimWindow()  resolves fetchSimWindow's answer; may never resolve, and is not waited for beyond askWithinMs
 *   askMonitors()   resolves fetchMonitors' answer, on the same terms: the screens' real sizes
 *   toDipRect(r)    a rectangle from physical pixels into the units screens are in (the sim window's, the monitors')
 *   keepAsIs        dev mode: dev-mode.js puts the window where it wants it
 *   onChange()      the screens, or where the HUD is and why, have changed: the desk's Settings page shows both
 *
 * { initialBounds, place, refresh, reset, settingsChanged, describe, currentKey }
 */
function createHudDisplay({
  getWindow,
  getDisplays,
  getChoice = () => null,
  readIni = () => null,
  askSimWindow = async () => ({ state: 'unknown' }),
  askMonitors = async () => ({ state: 'unknown' }),
  toDipRect = (r) => r,
  platform = process.platform,
  keepAsIs = false,
  askWithinMs = ASK_WITHIN_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onChange = () => {},
  log = () => {},
}) {
  let last = null;            // the last decision
  let lastLogged = null;      // what was last said of the choice, so that it is said once per change
  let lastDisplays = null;    // and of the screens
  let told = null;            // what onChange was last called for
  let choiceUsed = null;      // the saved choice as it was when the last decision was made
  let sizes = null;           // the screens' real sizes, by key, as the host said
  let sizesFor = null;        // and the layout of the screens it said them for
  let learning = null;
  let running = null;
  let again = false;

  function liveWindow() {
    const win = getWindow();
    return win && !win.isDestroyed() ? win : null;
  }

  function connected() {
    let raw;
    try {
      raw = getDisplays();
    } catch (e) {
      log(`[RacingDesk] HUD screen: the screens could not be read (${e.message})`);
      raw = [];
    }
    const estimated = normaliseDisplays(raw);
    // What the host said of the sizes holds for the layout it said it of, and no other.
    const list = sizes && sizesFor === layoutOf(estimated) ? normaliseDisplays(raw, sizes) : estimated;
    const seen = describeDisplays(list);
    if (seen !== lastDisplays) {
      lastDisplays = seen;
      log(`[RacingDesk] Screens: ${seen || 'none'}`);
    }
    return list;
  }

  function silentDisplays() {
    try {
      return normaliseDisplays(getDisplays());
    } catch (e) {
      return [];
    }
  }

  // An ask of the host, given askWithinMs to come back with something: what it says, or `unknown` if it says nothing
  // in time, fails, or throws.
  async function within(askFn, unknown) {
    let timer = null;
    try {
      return await Promise.race([
        Promise.resolve().then(askFn),
        new Promise((resolve) => { timer = setTimer(() => resolve(unknown), askWithinMs); }),
      ]);
    } catch (e) {
      return unknown;
    } finally {
      if (timer !== null) clearTimer(timer);
    }
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

  function decide(list, simWindow, simKept, simGame = null, keptGame = null) {
    return chooseDisplay({ displays: list, choice: saved(), simWindow, simKept, ini: iniNow(), simGame, keptGame });
  }

  // The screen the sim was last seen on: where the HUD stays for a round in which the host did not say where it is.
  function lastSimScreen() {
    return last && last.reason === 'sim' ? last.key : null;
  }

  // And which sim it was, for the reason given.
  function lastSimGame() {
    return last && last.reason === 'sim' ? last.game : null;
  }

  // Said once for each change of the choice or of why it was made — not at every poll that finds it the same.
  function say(decision, list, sim) {
    const notes = [];
    if (decision.choiceMissing) notes.push('the screen chosen in Settings is not connected, so it is Automatic for now');
    if (sim === 'unknown') notes.push('the host did not say where the sim is');
    const key = `${decision.key}|${decision.reason}|${notes.join('|')}`;
    if (key === lastLogged) return;
    lastLogged = key;
    log(`[RacingDesk] HUD screen: ${displayName(decision.display, list)} — ${decision.why}${notes.length ? ` (${notes.join('; ')})` : ''}`);
  }

  // The desk's Settings page shows the screens and where the HUD is: it is told when either has changed.
  function tell() {
    const now = `${lastDisplays}|${lastLogged}`;
    if (now === told) return;
    told = now;
    try { onChange(); } catch (e) { /* nobody is listening */ }
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

  // The rule with no host asked — the sim is probably not running, or nothing is known of it — so the ini decides,
  // unless the sim was seen on a screen before.
  function decideWithoutAsking() {
    const list = connected();
    choiceUsed = saved();
    const decision = decide(list, null, lastSimScreen(), null, lastSimGame());
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
    const answer = await within(askSimWindow, { state: 'unknown' });
    return answer && typeof answer === 'object' && typeof answer.state === 'string' ? answer : { state: 'unknown' };
  }

  // The screens' real sizes are asked of the host once for each layout of the screens, and again when it changes;
  // until it has said, a screen at a scale but 100 % is its estimate and is named "about". Never rejects, is never
  // waited on for long, and a host that does not say — or says what pairs with no screen — leaves the estimate, to be
  // asked again next round. With every screen at 100 % there is nothing to ask: a DIP is a pixel.
  function learnSizes() {
    if (platform !== 'win32' || keepAsIs) return Promise.resolve();
    if (learning) return learning;
    const round = (async () => {
      try {
        const list = silentDisplays();
        const layout = layoutOf(list);
        if (!list.some((d) => !d.exact) || (sizes && sizesFor === layout)) return;
        const answer = await within(askMonitors, { state: 'unknown' });
        if (!answer || answer.state !== 'ok' || !Array.isArray(answer.monitors)) return;
        const now = silentDisplays();
        if (layoutOf(now) !== layout) return;   // the screens changed while it was asked: the next round asks again
        const learned = matchMonitors(now, answer.monitors, toDipRect);
        if (!learned.size) return;
        sizes = learned;
        sizesFor = layout;
      } catch (e) {
        // not known
      }
    })();
    learning = round;
    round.then(() => { if (learning === round) learning = null; });
    return round;
  }

  async function once() {
    const [sim] = await Promise.all([ask(), learnSizes()]);
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
    // The host not saying is not the sim being closed: it is where it was last seen, while that screen is there.
    const simKept = sim.state === 'unknown' && !sim.skipped ? lastSimScreen() : null;
    // Which sim: the host names the process whose window it found (iRacing's, Assetto Corsa's acs, AssettoCorsaEVO).
    const simGame = sim.state === 'running' ? gameOfProcess(sim.process) : null;
    const keptGame = simKept ? lastSimGame() : null;
    choiceUsed = saved();
    const decision = decide(list, simWindow, simKept, simGame, keptGame);
    if (!decision) return null;
    last = decision;
    say(decision, list, sim.skipped ? 'not-asked' : sim.state);
    place(decision);
    tell();
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

  // For the desk's Settings page: the screens to choose from, named by the size they have, and where the HUD is now.
  async function describe() {
    await learnSizes();
    const list = connected();
    const decision = last && list.some((d) => d.key === last.key) ? last : decide(list, null, null);
    return {
      displays: listDisplays(list),
      using: decision ? { key: decision.key, name: displayName(decision.display, list), reason: decision.reason, why: decision.why } : null,
      choiceMissing: decision ? decision.choiceMissing : false,
    };
  }

  // The key of the screen the rule last chose for the HUD, or null before it has run. Nothing is asked for it; it is the
  // last decision, which each of the occasions above makes. In dev mode it is the rule's choice all the same, not where
  // dev-mode.js put the window.
  function currentKey() {
    return last ? last.key : null;
  }

  return { initialBounds, place: placeNow, refresh, reset, settingsChanged, describe, currentKey };
}

module.exports = {
  AUTO, SIM_WINDOW_PATH, MONITORS_PATH, ASK_WITHIN_MS,
  physicalSize, displayKey, normaliseDisplays, positionWords, displayName, listDisplays,
  matchSimWindow, parseSimWindow, fetchSimWindow, parseMonitors, fetchMonitors, matchMonitors, gameOfProcess,
  parseSimIni, simSizeFromIni, simIniPath, readSimIni,
  chooseDisplay, boundsFor, createHudDisplay,
};
