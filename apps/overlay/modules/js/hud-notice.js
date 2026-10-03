// A sentence the main process wants said on the HUD for a moment, and the only one: "OBS is not open" or "OBS didn't
// start recording". Nothing of a recording's state is ever drawn on the HUD — OBS records the screen the HUD is on,
// so a red dot or a timer here would be in every video. These two are never recorded, because there is no recording.
// The notice fades after two seconds. Nothing here reads the telemetry or the settings.
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
