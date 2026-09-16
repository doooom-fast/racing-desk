// ═══════════════════════════════════════════════════════════════
// REPLAY DIRECTOR UI — Renderer-side controls for Phase 5
//
// Shows progress overlay during automated replay recording,
// handles start/stop/cancel, and wires the recording pipeline
// to the director's record commands.
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────
  var _running = false;
  var _overlay = null;
  var _statusEl = null;
  var _progressEl = null;
  var _cancelBtn = null;

  // ── Build the progress overlay ─────────────────────────────
  function createOverlay() {
    if (_overlay) return;

    _overlay = document.createElement('div');
    _overlay.id = 'replayDirectorOverlay';
    _overlay.className = 'replay-director-overlay';
    _overlay.style.cssText = [
      'position: fixed',
      'bottom: 80px',
      'left: 50%',
      'transform: translateX(-50%)',
      'background: hsla(220, 20%, 10%, 0.92)',
      'border: 1px solid hsla(220, 40%, 40%, 0.5)',
      'border-radius: 8px',
      'padding: 12px 20px',
      'color: #eee',
      'font-family: var(--font-mono, monospace)',
      'font-size: 12px',
      'z-index: 99999',
      'pointer-events: auto',
      'display: none',
      'min-width: 280px',
      'text-align: center',
      'backdrop-filter: blur(8px)',
    ].join(';');

    var title = document.createElement('div');
    title.textContent = 'REPLAY DIRECTOR';
    title.style.cssText = 'font-size: 10px; letter-spacing: 2px; color: hsl(200, 70%, 65%); margin-bottom: 6px;';

    _statusEl = document.createElement('div');
    _statusEl.style.cssText = 'margin-bottom: 4px;';
    _statusEl.textContent = 'Preparing...';

    _progressEl = document.createElement('div');
    _progressEl.style.cssText = 'height: 3px; background: hsla(200, 50%, 30%, 0.5); border-radius: 2px; margin: 8px 0; overflow: hidden;';
    var bar = document.createElement('div');
    bar.id = 'replayDirectorBar';
    bar.style.cssText = 'height: 100%; width: 0%; background: hsl(200, 70%, 55%); transition: width 0.5s ease;';
    _progressEl.appendChild(bar);

    _cancelBtn = document.createElement('button');
    _cancelBtn.textContent = 'Cancel';
    _cancelBtn.style.cssText = [
      'background: hsla(0, 50%, 40%, 0.7)',
      'border: 1px solid hsla(0, 50%, 50%, 0.5)',
      'color: #eee',
      'font-size: 11px',
      'padding: 4px 14px',
      'border-radius: 4px',
      'cursor: pointer',
      'margin-top: 4px',
    ].join(';');
    _cancelBtn.onclick = function () {
      if (window.k10 && window.k10.cancelReplayDirector) {
        window.k10.cancelReplayDirector();
      }
    };

    _overlay.appendChild(title);
    _overlay.appendChild(_statusEl);
    _overlay.appendChild(_progressEl);
    _overlay.appendChild(_cancelBtn);
    document.body.appendChild(_overlay);
  }

  function show() {
    if (!_overlay) createOverlay();
    _overlay.style.display = 'block';
    _running = true;
  }

  function hide() {
    if (_overlay) _overlay.style.display = 'none';
    _running = false;
  }

  function updateStatus(text) {
    if (_statusEl) _statusEl.textContent = text;
  }

  function updateBar(percent) {
    var bar = document.getElementById('replayDirectorBar');
    if (bar) bar.style.width = Math.min(100, percent) + '%';
  }

  // ── Start the replay director ─────────────────────────────
  // Looks for the most recent sidecar file and kicks off recording.
  async function startDirector() {
    if (_running) {
      // Already running — cancel instead
      if (window.k10 && window.k10.cancelReplayDirector) {
        window.k10.cancelReplayDirector();
      }
      return;
    }

    // Find the most recent sidecar file
    var sidecarPath = findLatestSidecar();
    if (!sidecarPath) {
      showFlashMessage('No telemetry sidecar found. Record a race first.');
      return;
    }

    show();
    updateStatus('Analyzing telemetry...');

    // Preview the moments before starting
    if (window.k10 && window.k10.parseSidecarMoments) {
      var preview = await window.k10.parseSidecarMoments(sidecarPath);
      if (preview.error) {
        updateStatus('Error: ' + preview.error);
        setTimeout(hide, 3000);
        return;
      }
      if (!preview.moments || preview.moments.length === 0) {
        updateStatus('No TV-view moments found in this recording.');
        setTimeout(hide, 3000);
        return;
      }

      var estMin = Math.ceil((preview.estimatedSeconds || 0) / 60);
      updateStatus(preview.moments.length + ' moments found (~' + estMin + ' min to record)');
    }

    // Start the director
    if (window.k10 && window.k10.startReplayDirector) {
      var result = await window.k10.startReplayDirector(sidecarPath);
      if (result && result.error) {
        updateStatus('Error: ' + result.error);
        setTimeout(hide, 3000);
      }
    }
  }

  // ── Find the most recent .telemetry.jsonl ─────────────────
  // Uses the recording state to find where recordings are saved,
  // then looks for the latest sidecar file.
  function findLatestSidecar() {
    // The sidecar path is derived from the most recent recording.
    // We check window._lastRecordingPath set by the recorder, but also
    // store the timestamp to detect if it's stale from a previous session.
    var lastPath = window._lastRecordingPath;
    var lastTimestamp = window._lastRecordingTimestamp;
    var now = Date.now();

    // If the cached path is older than 30 minutes, treat it as stale
    if (lastPath && lastTimestamp && (now - lastTimestamp) < 1800000) {
      var sidecar = lastPath.replace(/\.(webm|mp4)$/i, '.telemetry.jsonl');
      return sidecar;  // Main process will validate existence
    }
    return null;
  }

  // ── Flash a brief message (no overlay) ────────────────────
  function showFlashMessage(text) {
    if (!_overlay) createOverlay();
    _overlay.style.display = 'block';
    updateStatus(text);
    _progressEl.style.display = 'none';
    _cancelBtn.style.display = 'none';
    setTimeout(function () {
      _overlay.style.display = 'none';
      _progressEl.style.display = 'block';
      _cancelBtn.style.display = 'block';
    }, 3000);
  }

  // ── Event wiring ──────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    // Hotkey toggle
    if (window.k10 && window.k10.onToggleReplayDirector) {
      window.k10.onToggleReplayDirector(function () {
        startDirector();
      });
    }

    // Progress updates from main process
    if (window.k10 && window.k10.onReplayDirectorProgress) {
      window.k10.onReplayDirectorProgress(function (progress) {
        switch (progress.status) {
          case 'starting':
            show();
            updateStatus(progress.message);
            break;

          case 'entering_replay':
          case 'switching_camera':
          case 'fast_forward':
            updateStatus(progress.message);
            break;

          case 'moment':
            updateStatus(progress.message);
            if (progress.total > 0) {
              updateBar((progress.current / progress.total) * 100);
            }
            break;

          case 'recording_start':
            updateStatus('Recording TV view...');
            break;

          case 'recording_stop':
            updateStatus('Finishing...');
            updateBar(100);
            break;

          case 'complete':
            updateStatus(progress.message);
            updateBar(100);
            setTimeout(hide, 4000);
            break;

          case 'cancelled':
            updateStatus('Cancelled');
            setTimeout(hide, 2000);
            break;

          case 'error':
            updateStatus('Error: ' + (progress.message || 'unknown'));
            setTimeout(hide, 4000);
            break;

          case 'no_moments':
            updateStatus('No TV-view moments found.');
            setTimeout(hide, 3000);
            break;
        }
      });
    }

    // Recording commands from director (start/stop the actual screen capture)
    if (window.k10 && window.k10.onReplayDirectorRecord) {
      window.k10.onReplayDirectorRecord(function (data) {
        if (data.action === 'start') {
          if (typeof window.recorderStart === 'function') {
            window.recorderStart();
          }
        } else if (data.action === 'stop') {
          if (typeof window.recorderStop === 'function') {
            window.recorderStop();
          }
        }
      });
    }
  });

  // ── Track the last recording path for sidecar lookup ──────
  window.addEventListener('recording-state-change', function (e) {
    if (e.detail && e.detail.result && e.detail.result.path) {
      window._lastRecordingPath = e.detail.result.path;
      window._lastRecordingTimestamp = Date.now();  // Mark when this path was set
    }
  });

  // ── Public API ────────────────────────────────────────────
  window.startReplayDirector = startDirector;
})();
