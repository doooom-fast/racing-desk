// ═══════════════════════════════════════════════════════════════
// Global action handlers — dispatched via Electron IPC from
// hotkeys, Stream Deck plugin, or HTTP action API.
// ═══════════════════════════════════════════════════════════════

(function initKeyboardActions() {
  'use strict';
  var k = window.k10;
  if (!k) return;

  // ── Restart demo ──
  if (k.onRestartDemo) {
    k.onRestartDemo(function() {
      var baseUrl = window._simhubUrlOverride || SIMHUB_URL;
      var sep = baseUrl.indexOf('?') === -1 ? '?' : '&';
      fetch(baseUrl + sep + 'action=restartdemo')
        .then(function(r) { if (r.ok) console.log('[K10] Demo restarted'); else console.warn('[K10] Demo restart failed:', r.status); })
        .catch(function(err) { console.warn('[K10] Demo restart error:', err); });
    });
  }

  // ── Reset track map ──
  if (k.onResetTrackmap) {
    k.onResetTrackmap(function() {
      if (typeof resetTrackMap === 'function') resetTrackMap();
    });
  }

  // ── Pitbox tab cycling ──
  if (k.onPitboxNextTab) {
    k.onPitboxNextTab(function() {
      if (typeof pitboxCycleTab === 'function') pitboxCycleTab(1);
    });
  }
  if (k.onPitboxPrevTab) {
    k.onPitboxPrevTab(function() {
      if (typeof pitboxCycleTab === 'function') pitboxCycleTab(-1);
    });
  }

  // ── Dismiss commentary ──
  if (k.onDismissCommentary) {
    k.onDismissCommentary(function() {
      if (typeof hideCommentary === 'function') hideCommentary();
    });
  }

  // ── Cycle rating / position page ──
  if (k.onCycleRating) {
    k.onCycleRating(function() {
      if (typeof cycleRatingPos === 'function') cycleRatingPos();
    });
  }

  // ── Cycle car logo ──
  if (k.onCycleCarLogo) {
    k.onCycleCarLogo(function() {
      if (typeof cycleCarLogo === 'function') cycleCarLogo();
    });
  }

  // ── Zoom in/out (CSS transform scale) ──
  if (k.onZoomIn) {
    k.onZoomIn(function() {
      _adjustZoom(0.05);
    });
  }
  if (k.onZoomOut) {
    k.onZoomOut(function() {
      _adjustZoom(-0.05);
    });
  }

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
    console.log('[K10] Zoom: ' + (_currentZoom * 100).toFixed(0) + '%');
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
    console.log('[K10] Applied preset: ' + name);
  }

})();
