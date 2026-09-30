// ═══════════════════════════════════════════════════════════════
//  DRIVE MODE — the HUD as a glance display, filling the screen
//  Ctrl+Shift+F, the Stream Deck's Drive Mode button and _settings.driveMode switch it on, on the rig; a page served
//  to an iPad has it on from the start (window._remoteMode).
//
//  This file is only the switch. What it switches is CSS (modules/styles/drive-view.css): body.drive-mode-active
//  lays every one of the HUD's panels out as the cells of one grid, so nothing is copied and every module goes on
//  writing to the same elements it always did. The things a stylesheet cannot do — fit the track map to its cell,
//  count how many leaderboard rows the cell holds, show the panels the rig's settings hide from its own screen — are
//  done by the modules that own them, when told here that the layout has changed (driveViewChanged in
//  webgl-helpers.js, applySettings in settings.js).
// ═══════════════════════════════════════════════════════════════

(function() {
  'use strict';

  let _active = false;

  function toggleDriveMode() {
    _active = !_active;
    _applyDriveMode();
    _settings.driveMode = _active;
    // saveSettings went with the HUD's own settings panel; the desk is where settings are kept now.
    if (typeof saveSettings === 'function') saveSettings();
  }
  window.toggleDriveMode = toggleDriveMode;

  function setDriveMode(on) {
    _active = !!on;
    _applyDriveMode();
  }
  window.setDriveMode = setDriveMode;

  let _reapplying = false;
  function _applyDriveMode() {
    const was = document.body.classList.contains('drive-mode-active');
    document.body.classList.toggle('drive-mode-active', _active);
    // Restore transparent background when exiting
    if (!_active) document.body.style.background = '';
    window._lbLastJson = '';   // the leaderboard's rows are counted again for the layout it is now in
    // The rig's settings say which panels its own screen shows; the glance layout shows them all, and leaving it puts
    // the settings' choice back. Only on a change: applySettings itself turns drive mode on when the settings say so.
    if (was !== _active && !_reapplying && typeof applySettings === 'function') {
      _reapplying = true;
      try { applySettings(); } catch (e) { console.warn('[RacingDesk] settings after drive mode:', e); }
      finally { _reapplying = false; }
    }
    if (typeof driveViewChanged === 'function') driveViewChanged(_active);
  }

  // ── Init ──
  function initDriveHud() {
    // Listen for Ctrl+Shift+F via Electron
    if (window.racingDesk && window.racingDesk.onToggleDriveMode) {
      window.racingDesk.onToggleDriveMode(toggleDriveMode);
    }

    // Auto-activate on remote server connections
    if (window._remoteMode) {
      setDriveMode(true);
    }

    // Restore persisted state
    if (_settings.driveMode) {
      setDriveMode(true);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDriveHud);
  } else {
    initDriveHud();
  }
})();
