// ═══════════════════════════════════════════════════════════════
// Global action handlers — dispatched via Electron IPC from
// hotkeys, Stream Deck plugin, or HTTP action API.
// ═══════════════════════════════════════════════════════════════

(function initKeyboardActions() {
  'use strict';
  // The page OBS draws has no bridge (no preload), and gets nothing from the keys: the rig's window does. Its actions are
  // still here to be done, by name, by whoever knows one was pressed (window.runHudAction): the app tells the OBS page which
  // of the page-only actions — those that change this page and are saved nowhere, so that the settings the OBS page is
  // given cannot carry them — were pressed on the rig's.
  var k = window.racingDesk || {};
  var _pageActions = {
    'zoom-in': function() { _adjustZoom(0.05); },
    'zoom-out': function() { _adjustZoom(-0.05); },
    'cycle-rating': function() { if (typeof cycleRatingPos === 'function') cycleRatingPos(); },
    'cycle-car-logo': function() { if (typeof cycleCarLogo === 'function') cycleCarLogo(); },
    'pitbox-next-tab': function() { if (typeof pitboxCycleTab === 'function') pitboxCycleTab(1); },
    'pitbox-prev-tab': function() { if (typeof pitboxCycleTab === 'function') pitboxCycleTab(-1); },
    'dismiss-commentary': function() { if (typeof hideCommentary === 'function') hideCommentary(); },
  };
  window.runHudAction = function(name) {
    var fn = Object.prototype.hasOwnProperty.call(_pageActions, name) ? _pageActions[name] : null;
    if (!fn) return false;
    fn();
    return true;
  };

  // ── Restart demo ──
  if (k.onRestartDemo) {
    k.onRestartDemo(function() {
      runtimeAction('restartdemo')
        .then(function() { console.log('[RacingDesk] Demo restarted'); })
        .catch(function(err) { console.warn('[RacingDesk] Demo restart failed:', err); });
    });
  }

  // ── Pitbox tab cycling ──
  if (k.onPitboxNextTab) k.onPitboxNextTab(_pageActions['pitbox-next-tab']);
  if (k.onPitboxPrevTab) k.onPitboxPrevTab(_pageActions['pitbox-prev-tab']);

  // ── Dismiss commentary ──
  if (k.onDismissCommentary) k.onDismissCommentary(_pageActions['dismiss-commentary']);

  // ── Cycle rating / position page ──
  if (k.onCycleRating) k.onCycleRating(_pageActions['cycle-rating']);

  // ── Cycle car logo ──
  if (k.onCycleCarLogo) k.onCycleCarLogo(_pageActions['cycle-car-logo']);

  // ── Zoom in/out (CSS transform scale) ──
  if (k.onZoomIn) k.onZoomIn(_pageActions['zoom-in']);
  if (k.onZoomOut) k.onZoomOut(_pageActions['zoom-out']);

  // ── Toggle leaderboard visibility ──
  if (k.onToggleLeaderboard) {
    k.onToggleLeaderboard(function() {
      var toggle = document.querySelector('.settings-toggle[data-key="showLeaderboard"]');
      if (toggle && typeof toggleSetting === 'function') toggleSetting(toggle);
    });
  }

  // ── Mode presets ──
  if (k.onPresetBroadcast) {
    k.onPresetBroadcast(function() { _applyPreset('broadcast'); });
  }
  if (k.onPresetPractice) {
    k.onPresetPractice(function() { _applyPreset('practice'); });
  }
  if (k.onPresetQualifying) {
    k.onPresetQualifying(function() { _applyPreset('qualifying'); });
  }

  // ── Zoom helper (CSS transform) ──
  var _currentZoom = 1.0;
  function _adjustZoom(delta) {
    _currentZoom = Math.max(0.5, Math.min(2.0, _currentZoom + delta));
    document.body.style.transform = _currentZoom === 1.0 ? '' : 'scale(' + _currentZoom + ')';
    document.body.style.transformOrigin = 'top left';
    console.log('[RacingDesk] Zoom: ' + (_currentZoom * 100).toFixed(0) + '%');
  }

  // ── Mode preset definitions ──
  // Each preset defines which settings keys should be on/off.
  // Keys not listed keep their current value.
  var _presets = {
    broadcast: {
      showLeaderboard: true,
      showCommentary: true,
      showMaps: true,
      showPosition: true,
      showPitBox: false,
      showDatastream: false,
      showSpotter: false,
    },
    practice: {
      showLeaderboard: false,
      showCommentary: true,
      showMaps: true,
      showPosition: true,
      showPitBox: true,
      showDatastream: true,
      showSpotter: true,
    },
    qualifying: {
      showLeaderboard: true,
      showCommentary: true,
      showMaps: true,
      showPosition: true,
      showPitBox: false,
      showDatastream: false,
      showSpotter: true,
    },
  };

  function _applyPreset(name) {
    var preset = _presets[name];
    if (!preset) return;
    // Update settings and toggle DOM state for each key
    Object.keys(preset).forEach(function(key) {
      var val = preset[key];
      // Update global settings object
      if (typeof _settings !== 'undefined') _settings[key] = val;
      // Find the toggle element and sync its UI state
      var toggle = document.querySelector('.settings-toggle[data-key="' + key + '"]');
      if (toggle) {
        toggle.classList.toggle('on', val);
        var section = toggle.dataset.section;
        if (section) {
          var els = document.querySelectorAll('#' + section + ', .' + section);
          for (var i = 0; i < els.length; i++) {
            els[i].classList.toggle('section-hidden', !val);
          }
        }
      }
    });
    // Persist and reflow
    if (typeof saveSettings === 'function') saveSettings();
    if (typeof applyLayout === 'function') applyLayout();
    if (typeof _collapseParentColumns === 'function') _collapseParentColumns();
    console.log('[RacingDesk] Applied preset: ' + name);
  }

})();
