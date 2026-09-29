// When the HUD's window is on screen: while the driver is in the car, he has not switched the HUD off, and the
// page in it is loaded — and at no other time. The window is made hidden, and is only ever revealed from here.
//
// The decision is this process's, not the page's. It was the page's: hidden, it polled the telemetry and told
// main.js when to show it, from inside its own requestAnimationFrame. So the HUD appearing rested on Chromium
// running the frames and timers of a window nobody could see, and on the page not having crashed or been
// reloaded; and the timer that was to hide it again was re-armed by every frame, so once shown it stayed on
// screen until the app was quit. Here the process that owns the window asks the telemetry itself — once a second,
// twice in the car — and tells the page (in-race-state). Out of the car the page does nothing at all.
//
// What "in the car" means is modules/js/in-car.js. The window, the telemetry and the clock are handed in, so the
// rules are tested without Electron (tests/unit/hud-visibility.spec.mjs).
const http = require('http');
const { createInCarSignal } = require('./in-car');
const { telemetryBase } = require('../../remote-server');

const TELEMETRY_PATH = '/racing-desk/';
const OUT_OF_CAR_POLL_MS = 1000;
const IN_CAR_POLL_MS = 500;
const ANSWER_WITHIN_MS = 1500;
const MAX_ANSWER_BYTES = 4 * 1024 * 1024;

// The address the HUD's page reads (modules/js/settings.js): the saved one when it ends in the plugin's path,
// localhost:8889 otherwise. In dev mode the page's requests to :8889 go to the replay (dev-mode.js); so does this.
function telemetryUrl(saved, { replayPort = null } = {}) {
  let base = telemetryBase(saved);
  if (replayPort && /^http:\/\/(localhost|127\.0\.0\.1):8889$/.test(base)) base = base.replace(/:8889$/, `:${replayPort}`);
  return base + TELEMETRY_PATH;
}

// GET the telemetry. Resolves the payload, or null for anything that is not one: nothing listening, no answer in
// time, a status other than 200, a body that is not a JSON object. Never rejects.
function fetchPayload(url, { timeoutMs = ANSWER_WITHIN_MS, get = http.get } = {}) {
  return new Promise((resolve) => {
    let done = false;
    let req = null;
    let deadline = null;
    const finish = (payload) => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      resolve(payload);
    };
    const giveUp = () => {
      finish(null);
      try { if (req) req.destroy(); } catch (e) { /* already gone */ }
    };
    // The socket's own timeout is reset by every byte; this one is not.
    deadline = setTimeout(giveUp, timeoutMs);
    if (typeof deadline.unref === 'function') deadline.unref();
    try {
      req = get(url, { timeout: timeoutMs }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          finish(null);
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
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            finish(body !== null && typeof body === 'object' && !Array.isArray(body) ? body : null);
          } catch (e) {
            finish(null);
          }
        });
        res.on('error', () => finish(null));
      });
      req.on('timeout', giveUp);
      req.on('error', () => finish(null));
    } catch (e) {
      finish(null);
    }
  });
}

/**
 * The HUD window's keeper.
 *
 *   getWindow()     the HUD's BrowserWindow, or null
 *   fetchPayload()  resolves the telemetry payload, or null when nothing answered
 *   keepVisible     dev mode: the window is an ordinary one, shown by dev-mode.js, and is left as it is
 *   onSwitch(off)   the driver switched the HUD off, or back on
 *
 * { start, stop, poll, toggle, pageLoaded, pageGone, state }
 */
function createHudVisibility({
  getWindow,
  fetchPayload: ask,
  keepVisible = false,
  onSwitch = null,
  outOfCarPollMs = OUT_OF_CAR_POLL_MS,
  inCarPollMs = IN_CAR_POLL_MS,
  leaveMs,
  staleMs,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  log = () => {},
}) {
  const signal = createInCarSignal({ leaveMs, staleMs, now });
  let switchedOff = false;   // the driver's own choice, from the tray, Ctrl+Shift+H or the Stream Deck
  let pageReady = false;     // the page is loaded, and its process alive
  let toldPage = null;       // what the page was last told; null once it has been loaded afresh
  let running = false;
  let asking = false;
  let timer = null;

  function liveWindow() {
    const win = getWindow();
    return win && !win.isDestroyed() ? win : null;
  }

  // Never show(): that can take the focus, and the sim must keep it.
  function reveal(win) {
    win.showInactive();
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setIgnoreMouseEvents(true, { forward: true });
    win.setFocusable(false);
  }

  function tellPage(win) {
    const inCar = signal.inCar();
    if (!pageReady || toldPage === inCar) return;
    try {
      win.webContents.send('in-race-state', inCar);
      toldPage = inCar;
    } catch (e) {
      log(`[RacingDesk] HUD: the page could not be told (${e.message})`);
    }
  }

  // Put the window where the three facts say it belongs. It asks the window whether it is on screen rather than
  // remember having shown it, so whatever else moved it is put right at the next poll.
  function apply() {
    const win = liveWindow();
    if (!win) return;
    tellPage(win);
    if (keepVisible) return;
    const wanted = signal.inCar() && !switchedOff && pageReady;
    if (wanted === win.isVisible()) return;
    if (wanted) {
      reveal(win);
      log('[RacingDesk] In the car → HUD on screen');
    } else {
      win.hide();
      log(`[RacingDesk] ${!signal.inCar() ? 'Out of the car' : switchedOff ? 'HUD switched off' : 'HUD page not loaded'} → HUD hidden`);
    }
  }

  // One round: ask the telemetry, decide, put the window right. Resolves state(); never rejects.
  async function poll() {
    if (asking) return state();
    asking = true;
    let payload = null;
    try {
      payload = await ask();
    } catch (e) {
      payload = null;
    } finally {
      asking = false;
    }
    signal.feed(payload);
    try {
      apply();
    } catch (e) {
      log(`[RacingDesk] HUD: ${e.message}`);
    }
    return state();
  }

  // Each round is booked when the one before it is over, so a slow answer never has a second request behind it.
  function book() {
    if (!running) return;
    timer = setTimer(() => { poll().then(book); }, signal.inCar() ? inCarPollMs : outOfCarPollMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  function start() {
    if (running) return;
    running = true;
    poll().then(book);
  }

  function stop() {
    running = false;
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  // The driver's switch. Off stays off when he gets in the car; on does not put the HUD on screen out of it.
  function toggle() {
    const win = liveWindow();
    if (!win) return { ok: false, reason: 'no window' };
    if (keepVisible) {
      if (win.isVisible()) win.hide();
      else win.show();
      return { ok: true, visible: win.isVisible() };
    }
    switchedOff = !switchedOff;
    if (typeof onSwitch === 'function') onSwitch(switchedOff);
    apply();
    return { ok: true, visible: win.isVisible(), hudOff: switchedOff };
  }

  function pageLoaded() {
    pageReady = true;
    toldPage = null;
    apply();
  }

  // Loading again, or its process gone: there is nothing to look at until it is back.
  function pageGone() {
    pageReady = false;
    toldPage = null;
    apply();
  }

  function state() {
    const win = liveWindow();
    return { inCar: signal.inCar(), hudOff: switchedOff, pageReady, visible: !!win && win.isVisible() };
  }

  return { start, stop, poll, toggle, pageLoaded, pageGone, state };
}

module.exports = {
  OUT_OF_CAR_POLL_MS, IN_CAR_POLL_MS, telemetryUrl, fetchPayload, createHudVisibility,
};
