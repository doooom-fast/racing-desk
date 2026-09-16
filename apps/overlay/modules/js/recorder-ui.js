// ═══════════════════════════════════════════════════════════════
// RECORDER UI — Recording indicator, timer, settings helpers
// Shows a red recording dot + elapsed time in the overlay corner.
// Also handles recording settings panel: device enumeration,
// facecam config, and settings persistence.
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  var _indicator = null;
  var _dot = null;
  var _timer = null;
  var _timerInterval = null;

  document.addEventListener('DOMContentLoaded', function () {
    createIndicator();
    bindEvents();
  });

  // ── Build the DOM ──────────────────────────────────────────
  function createIndicator() {
    _indicator = document.createElement('div');
    _indicator.className = 'rec-indicator';
    _indicator.id = 'recIndicator';

    _dot = document.createElement('span');
    _dot.className = 'rec-dot';

    _timer = document.createElement('span');
    _timer.className = 'rec-timer';
    _timer.textContent = '0:00';

    _indicator.appendChild(_dot);
    _indicator.appendChild(_timer);
    document.body.appendChild(_indicator);
  }

  // ── Event binding ──────────────────────────────────────────
  function bindEvents() {
    window.addEventListener('recording-state-change', function (e) {
      if (e.detail.recording) {
        show();
      } else {
        hide();
      }
    });

    // Transcode state
    window.addEventListener('transcode-state-change', function (e) {
      if (e.detail.transcoding) {
        showTranscode(e.detail.encoder);
      } else {
        hideTranscode(e.detail.result, e.detail.error);
      }
    });

    // Transcode progress (from main process via IPC)
    if (window.k10 && window.k10.onTranscodeProgress) {
      window.k10.onTranscodeProgress(function (progress) {
        updateTranscodeProgress(progress);
      });
    }

    // Auto-record events (Phase 4)
    window.addEventListener('auto-record-event', function (e) {
      if (!_indicator || !_timer) return;
      var detail = e.detail || {};
      if (detail.event === 'auto-start') {
        _timer.dataset.autoReason = detail.reason || '';
      } else if (detail.event === 'auto-stop') {
        // Brief label showing why auto-stop triggered
        var reasons = { pit_entry: 'Pit stop', end_of_race: 'Finish', session_change: 'Session end' };
        var label = reasons[detail.reason] || 'Auto-stopped';
        showFlash(label, 'hsl(200, 70%, 55%)', 2500);
      }
    });

    // Replay buffer saved (Phase 4)
    window.addEventListener('replay-buffer-saved', function (e) {
      var detail = e.detail || {};
      var mb = detail.fileSize ? (detail.fileSize / 1024 / 1024).toFixed(0) : '?';
      showFlash('Clip saved (' + mb + ' MB)', 'hsl(280, 60%, 60%)', 2500);
    });

    // Webcam warnings — recorder.js dispatches these when getUserMedia fails
    // or the <video> element can't autoplay. Surface them on the indicator so
    // the user doesn't discover post-recording that the facecam silently
    // dropped. Uses a distinct color so it's not mistaken for a save message.
    window.addEventListener('recording-webcam-warning', function (e) {
      var msg = (e.detail && e.detail.message) || 'Facecam unavailable';
      // Amber — same palette as transcode progress, flags a non-fatal issue.
      showFlash(msg, 'hsl(35, 80%, 55%)', 5000);
    });

    // Recording debug events (lifecycle logging)
    if (window.k10 && window.k10.onRecordingDebug) {
      window.k10.onRecordingDebug(function (data) {
        if (data.kind === 'start') {
          showPathToast('REC → ' + data.filename, 'hsl(140, 70%, 50%)', 4000);
        } else if (data.kind === 'chunk') {
          var mb = (data.bytesWritten / 1024 / 1024).toFixed(1);
          console.log('[RecorderUI] Chunks: ' + data.chunkCount + ', Bytes: ' + mb + 'MB');
        } else if (data.kind === 'stop') {
          var fileSizeMB = (data.fileSize / 1024 / 1024).toFixed(0);
          showFlash('Saved: ' + data.filename + ' — ' + fileSizeMB + ' MB', 'hsl(140, 70%, 50%)', 4000);
        }
      });
    }
  }

  // ── Flash notification on the indicator ────────────────────
  function showFlash(text, color, durationMs) {
    if (!_indicator || !_dot || !_timer) return;
    _indicator.classList.add('rec-active');
    _dot.style.background = color;
    _dot.style.boxShadow = '0 0 6px ' + color.replace(')', ', 0.6)').replace('hsl', 'hsla');
    _timer.style.color = color;
    _timer.textContent = text;
    setTimeout(function () {
      _indicator.classList.remove('rec-active');
      _dot.style.background = '';
      _dot.style.boxShadow = '';
      _timer.style.color = '';
      _timer.textContent = '0:00';
    }, durationMs || 2500);
  }

  // ── Path toast — briefly shows path, then resumes timer ──────
  function showPathToast(text, color, durationMs) {
    if (!_indicator || !_dot || !_timer) return;
    _dot.style.background = color;
    _dot.style.boxShadow = '0 0 6px ' + color.replace(')', ', 0.6)').replace('hsl', 'hsla');
    _timer.style.color = color;
    var savedText = _timer.textContent;
    _timer.textContent = text;
    setTimeout(function () {
      // Restore timer display and colors
      _timer.textContent = savedText;
      _dot.style.background = '';
      _dot.style.boxShadow = '';
      _timer.style.color = '';
    }, durationMs || 4000);
  }

  // ── Show/hide ──────────────────────────────────────────────
  function show() {
    if (!_indicator) return;
    _indicator.classList.add('rec-active');
    startTimer();
  }

  function hide() {
    if (!_indicator) return;
    _indicator.classList.remove('rec-active');
    stopTimer();
    _timer.textContent = '0:00';
  }

  // ── Timer ──────────────────────────────────────────────────
  function startTimer() {
    stopTimer();
    _timerInterval = setInterval(updateTimer, 500);
  }

  function stopTimer() {
    if (_timerInterval) {
      clearInterval(_timerInterval);
      _timerInterval = null;
    }
  }

  function updateTimer() {
    if (typeof window.recorderElapsedMs !== 'function') return;
    var ms = window.recorderElapsedMs();
    var totalSec = Math.floor(ms / 1000);
    var min = Math.floor(totalSec / 60);
    var sec = totalSec % 60;
    var hr = Math.floor(min / 60);

    if (hr > 0) {
      min = min % 60;
      _timer.textContent = hr + ':' + pad(min) + ':' + pad(sec);
    } else {
      _timer.textContent = min + ':' + pad(sec);
    }
  }

  function pad(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  // ── Transcode progress indicator ───────────────────────────
  // Reuses the recording indicator but switches to a blue/amber
  // color scheme and shows "Converting... 45%"
  function showTranscode(encoder) {
    if (!_indicator || !_dot || !_timer) return;
    _indicator.classList.add('rec-active', 'rec-transcoding');
    _dot.style.background = 'hsl(35, 80%, 55%)';
    _dot.style.boxShadow = '0 0 6px hsla(35, 80%, 55%, 0.6)';
    _timer.style.color = 'hsl(35, 70%, 65%)';
    _timer.textContent = 'Converting...';
  }

  function updateTranscodeProgress(progress) {
    if (!_timer || !_indicator) return;
    if (!_indicator.classList.contains('rec-transcoding')) return;
    _timer.textContent = 'Converting ' + progress.percent + '%';
  }

  function hideTranscode(result, error) {
    if (!_indicator || !_dot || !_timer) return;
    // Brief success/fail flash
    if (result && result.success) {
      _dot.style.background = 'hsl(140, 70%, 45%)';
      _dot.style.boxShadow = '0 0 6px hsla(140, 70%, 45%, 0.6)';
      _timer.style.color = 'hsl(140, 60%, 55%)';
      _timer.textContent = 'MP4 ready';
    } else {
      _timer.textContent = error ? 'Convert failed' : 'Done';
    }

    // Fade out after 3 seconds
    setTimeout(function () {
      _indicator.classList.remove('rec-active', 'rec-transcoding');
      // Reset colors for next recording
      _dot.style.background = '';
      _dot.style.boxShadow = '';
      _timer.style.color = '';
      _timer.textContent = '0:00';
    }, 3000);
  }

  // ═══════════════════════════════════════════════════════════
  // Recording-settings UI lived here until the Windows host took
  // over the Settings page in WinUI. Device enumeration,
  // `refreshRecordingDevices`, the `switchSettingsTab` wrap, the
  // `settingsRec*` element population — all of it targeted DOM that
  // no longer exists in the overlay. We deleted the dead code; the
  // host now writes the recording keys directly to overlay-settings.json
  // and recorder.js reads them from window._settings.
  // ═══════════════════════════════════════════════════════════
})();
