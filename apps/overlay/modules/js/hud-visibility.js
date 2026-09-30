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
// A page that has died is this module's to bring back as well: main.js says what became of the page (loading,
// loaded, failed, its process gone) and is asked to load it again.
//
// What "in the car" means is modules/js/in-car.js. The window, the telemetry, the clock and the timers are handed
// in, so the rules are tested without Electron (tests/unit/hud-visibility.spec.mjs).
const http = require('http');
const { createInCarSignal } = require('./in-car');
const { telemetryBase } = require('../../remote-server');

const TELEMETRY_PATH = '/racing-desk/';
const OUT_OF_CAR_POLL_MS = 1000;
const IN_CAR_POLL_MS = 500;
const ANSWER_WITHIN_MS = 1500;
const RELOAD_AFTER_MS = 2000;
const RELOADS_AT_MOST = 3;
// How long the window may be kept hidden while it is put on the sim's screen. A round of asking the host takes 0.8 s at
// the most (hud-display.js ASK_WITHIN_MS), and one that is already under way when he gets in is followed by one more,
// which is two; the rest is for the window to be moved. If it runs out the HUD comes up where it was and moves.
const PREPARE_WITHIN_MS = 2500;
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
 *   loadPage()      starts the page loading again; main.js says how it went (pageLoaded, pageFailed)
 *   keepVisible     dev mode: the window is an ordinary one, shown by dev-mode.js, and is left as it is
 *   onSwitch(off)   the driver switched the HUD off, or back on
 *   onInCar(inCar)  he has got in the car, or out of it
 *   beforeReveal()  he has got in the car: resolves when the window is where it belongs, which is asked of the sim
 *                   and takes a moment. The window is not revealed until it has, or until prepareMs has gone by
 *                   — it would otherwise come up on the wrong screen and move.
 *
 * { start, stop, poll, toggle, putAway, pageLoading, pageLoaded, pageFailed, pageGone, state }
 */
function createHudVisibility({
  getWindow,
  fetchPayload: ask,
  loadPage = null,
  keepVisible = false,
  onSwitch = null,
  onInCar = null,
  beforeReveal = null,
  prepareMs = PREPARE_WITHIN_MS,
  reloadAfterMs = RELOAD_AFTER_MS,
  reloadsAtMost = RELOADS_AT_MOST,
  outOfCarPollMs = OUT_OF_CAR_POLL_MS,
  inCarPollMs = IN_CAR_POLL_MS,
  leaveMs,
  staleMs,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  log = () => {},
}) {
  const signal = createInCarSignal({
    leaveMs,
    staleMs,
    now,
    onChange: (inCar) => {
      if (inCar) {
        justGotIn = true;
        gotIn();
      }
      if (typeof onInCar !== 'function') return;
      try { onInCar(inCar); } catch (e) { log(`[RacingDesk] HUD: ${e.message}`); }
    },
  });
  let switchedOff = false;   // the driver's own choice, from the tray, Ctrl+Shift+H or the Stream Deck
  let pageReady = false;     // the page is loaded, and its process alive
  let loading = false;       // a load is under way
  let gone = 0;              // times the page's process has gone since a load last finished
  let toldPage = null;       // what the page was last told; null once it has been loaded afresh
  let running = false;
  let asking = false;
  let justGotIn = false;     // he got in during this poll's feed, and beforeReveal has not been asked yet
  let preparing = false;     // beforeReveal is under way: the window is not revealed until it is over
  let timer = null;
  let reloadTimer = null;    // a load booked for two seconds after the page's process went

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
    const wanted = signal.inCar() && !switchedOff && pageReady && !preparing;
    if (wanted === win.isVisible()) return;
    if (wanted) {
      reveal(win);
      log('[RacingDesk] In the car → HUD on screen');
    } else {
      win.hide();
      log(`[RacingDesk] ${!signal.inCar() ? 'Out of the car' : switchedOff ? 'HUD switched off' : 'HUD page not loaded'} → HUD hidden`);
    }
  }

  // He has just got in: before the window is revealed, main.js is given the moment to put it where it belongs.
  // Bounded, and never a reason for the HUD not to come up: a hook that throws, or takes longer than prepareMs, is
  // let go of. The window is not revealed while it is under way (apply), whatever else asks for it.
  async function prepare() {
    if (typeof beforeReveal !== 'function' || !liveWindow()) return;
    preparing = true;
    let deadline = null;
    try {
      await Promise.race([
        Promise.resolve().then(beforeReveal),
        new Promise((resolve) => { deadline = setTimer(resolve, prepareMs); }),
      ]);
    } catch (e) {
      log(`[RacingDesk] HUD: before it is shown: ${e.message}`);
    } finally {
      if (deadline !== null) clearTimer(deadline);
      preparing = false;
    }
  }

  // One round: ask the telemetry, decide, put the window right. Resolves state(); never rejects.
  async function poll() {
    if (asking) return state();
    asking = true;
    try {
      let payload = null;
      try {
        payload = await ask();
      } catch (e) {
        payload = null;
      }
      signal.feed(payload);
      if (justGotIn) {
        justGotIn = false;
        await prepare();
      }
      try {
        apply();
      } catch (e) {
        log(`[RacingDesk] HUD: ${e.message}`);
      }
    } finally {
      asking = false;
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
    if (reloadTimer !== null) clearTimer(reloadTimer);
    reloadTimer = null;
  }

  // The driver's switch. Off stays off when he gets in the car; on does not put the HUD on screen out of it.
  // The tray's works anywhere ({ anywhere: true }), and its tick shows where the switch stands. The key's and the
  // Stream Deck's work only where what they do is seen — in the car, the page loaded — and anywhere else leave
  // the switch as it was and say so: pressed at the desktop they switched the HUD off unseen, and there was none
  // when he got in.
  function toggle({ anywhere = false } = {}) {
    const win = liveWindow();
    if (!win) return { ok: false, reason: 'no window' };
    if (keepVisible) {
      if (win.isVisible()) win.hide();
      else win.show();
      return { ok: true, visible: win.isVisible() };
    }
    if (!anywhere) {
      const reason = !signal.inCar() ? 'out of the car' : !pageReady ? 'the HUD page is not loaded' : null;
      if (reason) {
        log(`[RacingDesk] HUD switch left ${switchedOff ? 'off' : 'on'}: ${reason}`);
        return { ok: false, reason, visible: win.isVisible(), hudOff: switchedOff };
      }
    }
    switchedOff = !switchedOff;
    if (typeof onSwitch === 'function') onSwitch(switchedOff);
    apply();
    return { ok: true, visible: win.isVisible(), hudOff: switchedOff };
  }

  // "Quit the overlay" — Ctrl+Shift+Q, the Stream Deck's button. The HUD is put away and the app carries on: the
  // desk, the host, and what they record for the car he is in. It is the switch thrown to off, wherever he is,
  // so the HUD comes back the way a switched-off HUD does: the tray, or Ctrl+Shift+H and the Stream Deck in the
  // car. Asked twice, it is away once.
  function putAway() {
    const win = liveWindow();
    if (!win) return { ok: false, reason: 'no window' };
    if (keepVisible) {
      if (win.isVisible()) win.hide();
      return { ok: true, visible: win.isVisible() };
    }
    if (!switchedOff) {
      switchedOff = true;
      if (typeof onSwitch === 'function') onSwitch(switchedOff);
    }
    apply();
    return { ok: true, visible: win.isVisible(), hudOff: switchedOff };
  }

  // A load has begun — the first, or one after a crash, a resume, a file changed in dev mode. There is nothing
  // to look at until it is over.
  function pageLoading() {
    pageReady = false;
    loading = true;
    toldPage = null;
    apply();
  }

  function pageLoaded() {
    pageReady = true;
    loading = false;
    gone = 0;
    toldPage = null;
    apply();
  }

  // A load that came to nothing. It is tried again when he next gets in the car (gotIn).
  function pageFailed() {
    pageReady = false;
    loading = false;
    toldPage = null;
    apply();
  }

  // Its process gone. For any reason but a clean exit the page is loaded again two seconds later — 'oom',
  // 'launch-failed' and 'abnormal-exit' as much as 'crashed' and 'killed', once the only two that were — and at
  // most three times without a load finishing in between: a page that dies as it loads would go round for ever.
  function pageGone(reason) {
    pageReady = false;
    loading = false;
    toldPage = null;
    apply();
    if (reason === 'clean-exit') return;
    gone++;
    if (gone > reloadsAtMost) {
      log(`[RacingDesk] HUD: the page's process has gone ${gone} times without a load finishing — tried again when he gets in the car`);
      return;
    }
    if (reloadTimer !== null) clearTimer(reloadTimer);
    reloadTimer = setTimer(() => {
      reloadTimer = null;
      // Something else may have loaded it in the two seconds: the GPU's process gone, the machine waking.
      if (!pageReady && !loading) load(`the page's process gone (${reason || 'no reason given'})`);
    }, reloadAfterMs);
    if (reloadTimer && typeof reloadTimer.unref === 'function') reloadTimer.unref();
  }

  // He has got in the car. A page that is gone, with no load under way or booked, is loaded once more: a page
  // past its three tries, or one whose load failed, used to stay gone until the app was started again. Once each
  // time he gets in, not once a poll.
  function gotIn() {
    if (!pageReady && !loading && reloadTimer === null) load('in the car with no page');
  }

  function load(why) {
    if (typeof loadPage !== 'function' || !liveWindow()) return;
    log(`[RacingDesk] HUD: ${why} → loading it again`);
    loading = true;
    try {
      loadPage();
    } catch (e) {
      loading = false;
      log(`[RacingDesk] HUD: the page could not be loaded (${e.message})`);
    }
  }

  function state() {
    const win = liveWindow();
    return { inCar: signal.inCar(), hudOff: switchedOff, pageReady, visible: !!win && win.isVisible() };
  }

  return { start, stop, poll, toggle, putAway, pageLoading, pageLoaded, pageFailed, pageGone, state };
}

module.exports = {
  OUT_OF_CAR_POLL_MS, IN_CAR_POLL_MS, RELOAD_AFTER_MS, RELOADS_AT_MOST, PREPARE_WITHIN_MS,
  telemetryUrl, fetchPayload, createHudVisibility,
};
