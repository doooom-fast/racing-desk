// A sentence the main process wants said on the HUD for a moment, and only these: the recording's two, "OBS is not open"
// and "OBS didn't start recording", and Racing Desk's own lines about the car he is in — its brakes and its height, as
// putting them back says them ("Trial: brakes Porsche 963 GTP · 70 kg", "Trial: height Porsche 963 GTP · −2.0 cm (its
// camera file)", "Trial: no camera file for the Lotus 79 yet"; modules/js/restore-api.js), shown at his first moment in
// the car, one after another. Nothing of a recording's state is ever drawn on the HUD — OBS records the screen the HUD is
// on, so a red dot or a timer here would be in every video: the recording's two are never recorded, because there is no
// recording, and the car's lines are never shown while OBS records. Only the rig's HUD is told: the iPad and the pages
// OBS draws have no main process behind them. The notice fades after two seconds. Nothing here reads the telemetry or
// the settings.
(function () {
  'use strict';

  var SHOW_MS = 2000;
  var _el = null;
  var _timer = null;

  function element() {
    if (_el) return _el;
    _el = document.createElement('div');
    _el.id = 'hudNotice';
    _el.className = 'hud-notice';
    _el.setAttribute('role', 'status');
    document.body.appendChild(_el);
    return _el;
  }

  function show(text) {
    if (typeof text !== 'string' || !text.trim()) return;
    var el = element();
    el.textContent = text;
    el.classList.add('hud-notice-on');
    if (_timer) clearTimeout(_timer);
    _timer = setTimeout(function () { el.classList.remove('hud-notice-on'); _timer = null; }, SHOW_MS);
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (window.racingDesk && typeof window.racingDesk.onHudNotice === 'function') {
      window.racingDesk.onHudNotice(show);
    }
  });

  window.hudNotice = show;
})();
