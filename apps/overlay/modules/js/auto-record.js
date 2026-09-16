// ═══════════════════════════════════════════════════════════════
// AUTO-RECORD — Phase 4: Telemetry-aware recording triggers
//
// Automatically starts/stops recording based on telemetry state:
//   • Start when car exits pit lane
//   • Stop when car enters pit lane (optional per-stint split)
//   • Stop when session ends (checkered flag / IsEndOfRace)
//   • Auto-split per stint when enabled
//
// Called from poll-engine.js every frame via checkAutoRecordTriggers().
// All decisions are based on poll-engine state — no direct HTTP calls.
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────
  var _prevInPit = null;          // null = first frame (no transition)
  var _prevSessionState = 0;      // track session state changes
  var _autoRecording = false;     // we initiated this recording
  var _autoRecordEnabled = false; // user setting
  var _autoStopOnPit = true;      // stop when entering pits (stint split)
  var _debounceFrames = 0;        // ignore rapid pit in/out (e.g., pit exit + immediate re-entry)
  var _endOfRaceHandled = false;  // only handle once per session
  var _DEBOUNCE_THRESHOLD = 30;   // ~1 second at 30fps

  // ── Settings sync ─────────────────────────────────────────
  // Read from window._settings on each call (settings may change mid-session)
  function readSettings() {
    var s = window._settings || {};
    _autoRecordEnabled = !!s.recordingAutoRecord;
    _autoStopOnPit = s.recordingAutoStopOnPit !== false; // default true
  }

  // ── Main check — called every poll frame ──────────────────
  // p: raw telemetry props, isDemo: bool, inPitLane: bool,
  // sessionState: number, endOfRace: bool
  function checkAutoRecordTriggers(p, isDemo, inPitLane, sessionState, endOfRace) {
    readSettings();
    if (!_autoRecordEnabled) {
      _prevInPit = inPitLane;
      _prevSessionState = sessionState;
      return;
    }

    var isRecording = typeof window.recorderIsRecording === 'function' && window.recorderIsRecording();

    // ── Debounce: wait N frames after any pit transition ────
    if (_debounceFrames > 0) {
      _debounceFrames--;
      _prevInPit = inPitLane;
      _prevSessionState = sessionState;
      return;
    }

    // ── Pit exit → start recording ──────────────────────────
    if (_prevInPit === true && !inPitLane) {
      if (!isRecording) {
        console.log('[AutoRecord] Pit exit detected — starting recording');
        _autoRecording = true;
        _endOfRaceHandled = false;
        _debounceFrames = _DEBOUNCE_THRESHOLD;
        if (typeof window.recorderStart === 'function') {
          window.recorderStart();
        }
        window.dispatchEvent(new CustomEvent('auto-record-event', {
          detail: { event: 'auto-start', reason: 'pit_exit' },
        }));
      }
    }

    // ── Pit entry → stop recording (if we started it) ───────
    if (_autoStopOnPit && _prevInPit === false && inPitLane) {
      if (isRecording && _autoRecording) {
        console.log('[AutoRecord] Pit entry detected — stopping recording (stint split)');
        _debounceFrames = _DEBOUNCE_THRESHOLD;
        if (typeof window.recorderStop === 'function') {
          window.recorderStop();
        }
        _autoRecording = false;
        window.dispatchEvent(new CustomEvent('auto-record-event', {
          detail: { event: 'auto-stop', reason: 'pit_entry' },
        }));
      }
    }

    // ── End of race → stop recording ────────────────────────
    if (endOfRace && !_endOfRaceHandled) {
      if (isRecording && _autoRecording) {
        // Wait a few seconds to capture the finish moment
        _endOfRaceHandled = true;
        console.log('[AutoRecord] End of race — stopping recording in 5s');
        setTimeout(function () {
          if (typeof window.recorderIsRecording === 'function' && window.recorderIsRecording()) {
            if (typeof window.recorderStop === 'function') {
              window.recorderStop();
            }
            _autoRecording = false;
            window.dispatchEvent(new CustomEvent('auto-record-event', {
              detail: { event: 'auto-stop', reason: 'end_of_race' },
            }));
          }
        }, 5000);
      }
    }

    // ── Session change → reset state ────────────────────────
    if (sessionState !== _prevSessionState && _prevSessionState > 0) {
      _endOfRaceHandled = false;
      // If we were auto-recording and session changed, stop
      if (isRecording && _autoRecording) {
        console.log('[AutoRecord] Session changed — stopping recording');
        if (typeof window.recorderStop === 'function') {
          window.recorderStop();
        }
        _autoRecording = false;
        window.dispatchEvent(new CustomEvent('auto-record-event', {
          detail: { event: 'auto-stop', reason: 'session_change' },
        }));
      }
    }

    _prevInPit = inPitLane;
    _prevSessionState = sessionState;
  }

  // ── Query state ───────────────────────────────────────────
  function isAutoRecording() {
    return _autoRecording;
  }

  // ── Public API ────────────────────────────────────────────
  window.checkAutoRecordTriggers = checkAutoRecordTriggers;
  window.isAutoRecording = isAutoRecording;
})();
