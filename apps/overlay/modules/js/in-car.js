// Whether the driver is in the car, from what the telemetry says. This is the one place that is decided. The main
// process asks it, to show and hide the HUD's window (modules/js/hud-visibility.js); the HUD's page asks it whether
// a frame is worth drawing (poll-engine.js); and a page with no main process behind it — on an iPad, in a browser
// — asks it for itself. Pure: no DOM, no timers, no Electron, so it runs in all three and in the unit tests.
(function () {
  'use strict';

  const KEYS = Object.freeze({
    gameRunning: 'DataCorePlugin.GameRunning',
    sessionState: 'RacingDesk.Plugin.Grid.SessionState',
    demoMode: 'RacingDesk.Plugin.DemoMode',
    // iRacing's own "the player is in the car, physics running", and not a replay. The app's host sends it, 1 or
    // 0, and only where the sim says it (TelemetryCapture.InCar); sent, it decides. In Assetto Corsa and EVO the same
    // key carries the graphics page's status — live is in, a replay or the pause is out — so the page need not know the sim.
    onTrack: 'DataCorePlugin.GameRawData.Telemetry.IsOnTrack',
  });

  // Out of the car has to last this long before it is believed: the session state drops to 0 for a moment between
  // sessions, and the HUD should not blink off and on. Getting in is believed at once.
  const LEAVE_MS = 2000;
  // A source that has not answered for this long says nothing about the car any more.
  const STALE_MS = 3000;

  // The payload's flags are 1 and 0; true, 'true' and 'True' are taken as well, for a writer that sends booleans.
  function flag(value) {
    if (value === true) return true;
    if (typeof value === 'string' && /^true$/i.test(value.trim())) return true;
    return Number(value) > 0;
  }

  const sent = (value) => value !== undefined && value !== null && value !== '';

  /**
   * In the car, by this payload? No payload is out of the car.
   *
   * - Demo mode is in the car: it is switched on to look at the HUD.
   * - The sim not running, or not in a session yet, is out.
   * - With iRacing's IsOnTrack in the payload, that is the answer: the garage screen and a replay are out.
   * - Without it, a session under way (SessionState 1 GetInCar … 6 CoolDown) is all there is to go on. That
   *   describes the session, not the driver: from a source that sends no IsOnTrack — a SimHub plugin from before
   *   2026-09-29 — the garage screen and a replay count as in the car.
   */
  function inCar(payload) {
    if (!payload || typeof payload !== 'object') return false;
    if (flag(payload[KEYS.demoMode])) return true;
    if (!flag(payload[KEYS.gameRunning])) return false;
    if (sent(payload[KEYS.onTrack])) return flag(payload[KEYS.onTrack]);
    return (parseInt(payload[KEYS.sessionState], 10) || 0) > 0;
  }

  /**
   * In the car or not, over time: fed each poll's payload — null when the source did not answer — it says when
   * that changes. It keeps no timer of its own, so leaving is noticed on the first poll after it has lasted
   * leaveMs, however many frames arrived in between.
   *
   * { feed(payload) → in the car, inCar() }; onChange(inCar) is called on each change.
   */
  function createInCarSignal({ leaveMs = LEAVE_MS, staleMs = STALE_MS, now = Date.now, onChange = null } = {}) {
    let state = false;        // what was last said
    let answeredAt = null;    // when the source last answered
    let outSince = null;      // when the telemetry began saying out of the car, while we still say in

    function say(next) {
      outSince = null;
      if (next === state) return;
      state = next;
      if (typeof onChange === 'function') onChange(state);
    }

    function feed(payload) {
      const at = now();
      if (payload && typeof payload === 'object') {
        answeredAt = at;
        if (inCar(payload)) {
          say(true);
        } else if (state) {
          if (outSince === null) outSince = at;
          if (at - outSince >= leaveMs) say(false);
        }
      } else if (state && (answeredAt === null || at - answeredAt >= staleMs)) {
        say(false);
      }
      return state;
    }

    return { feed, inCar: () => state };
  }

  const api = { KEYS, LEAVE_MS, STALE_MS, inCar, createInCarSignal };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.RacingDeskInCar = api;
})();
