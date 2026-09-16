// ═══════════════════════════════════════════════════════════════
// REPLAY BUFFER — Phase 4: Rolling in-memory capture buffer
//
// Continuously captures the display to a ring buffer in memory.
// When the user hits the hotkey (Ctrl+Shift+B), the last N seconds
// are saved to a clip file — like OBS's replay buffer, but with
// telemetry bookmarks from the sidecar.
//
// Architecture:
//   • Separate MediaRecorder from the main recorder (independent)
//   • Stores Blob chunks in a capped ring buffer (time-limited)
//   • On save: concatenates buffered chunks → sends to main process
//   • Buffer runs whenever the app is not idle (game is running)
//
// Memory usage: ~2-5 MB/s at medium quality × buffer duration.
// 60s buffer ≈ 120-300 MB. 120s ≈ 240-600 MB. Capped by setting.
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────
  var _mediaRecorder = null;
  var _displayStream = null;
  var _chunks = [];           // ring buffer of { blob, time } entries
  var _running = false;
  var _bufferDurationMs = 60000;  // default 60 seconds
  var _saving = false;
  var _chunkIntervalMs = 1000;    // MediaRecorder timeslice

  // ── Settings sync ─────────────────────────────────────────
  function readSettings() {
    var s = window._settings || {};
    var secs = +(s.replayBufferDuration) || 60;
    // Clamp to 30–120 seconds
    secs = Math.max(30, Math.min(120, secs));
    _bufferDurationMs = secs * 1000;
  }

  // ── Start the buffer capture ──────────────────────────────
  async function start() {
    if (_running) return;
    readSettings();

    try {
      // Get display stream (same approach as recorder.js)
      var sources = await window.navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            minWidth: 1920,
            maxWidth: 7680,
            maxFrameRate: 30,  // 30fps is plenty for replay clips
          },
        },
      });

      _displayStream = sources;

      var mimeType = 'video/webm;codecs=vp8';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm';
      }

      _mediaRecorder = new MediaRecorder(_displayStream, {
        mimeType: mimeType,
        videoBitsPerSecond: 8000000, // 8 Mbps — low-ish for buffer (saves memory)
      });

      _mediaRecorder.ondataavailable = function (e) {
        if (e.data && e.data.size > 0) {
          _chunks.push({ blob: e.data, time: Date.now() });
          trimBuffer();
        }
      };

      _mediaRecorder.onerror = function (e) {
        console.error('[ReplayBuffer] MediaRecorder error:', e);
        stop();
      };

      _mediaRecorder.start(_chunkIntervalMs);
      _running = true;
      console.log('[ReplayBuffer] Started (' + (_bufferDurationMs / 1000) + 's buffer)');

    } catch (err) {
      console.error('[ReplayBuffer] Failed to start:', err);
      cleanup();
    }
  }

  // ── Stop the buffer capture ───────────────────────────────
  function stop() {
    if (!_running) return;
    cleanup();
    console.log('[ReplayBuffer] Stopped');
  }

  function cleanup() {
    _running = false;
    if (_mediaRecorder && _mediaRecorder.state !== 'inactive') {
      try { _mediaRecorder.stop(); } catch (e) { /* ok */ }
    }
    _mediaRecorder = null;
    if (_displayStream) {
      _displayStream.getTracks().forEach(function (t) { t.stop(); });
      _displayStream = null;
    }
    _chunks = [];
  }

  // ── Trim old chunks beyond buffer duration ────────────────
  function trimBuffer() {
    var cutoff = Date.now() - _bufferDurationMs;
    while (_chunks.length > 0 && _chunks[0].time < cutoff) {
      _chunks.shift();
    }
  }

  // ── Save the buffer to a clip file ────────────────────────
  // Returns a promise that resolves with { success, path } or { error }
  async function save() {
    if (_saving) {
      return { error: 'Already saving replay buffer' };
    }
    if (_chunks.length === 0) {
      return { error: 'Replay buffer is empty' };
    }
    if (!window.k10 || !window.k10.saveReplayBuffer) {
      return { error: 'IPC not available' };
    }

    _saving = true;
    console.log('[ReplayBuffer] Saving ' + _chunks.length + ' chunks...');

    try {
      // Concatenate all buffered chunks into one Blob
      var blobs = _chunks.map(function (c) { return c.blob; });
      var fullBlob = new Blob(blobs, { type: 'video/webm' });

      // Convert to ArrayBuffer for IPC transfer
      var arrayBuf = await fullBlob.arrayBuffer();

      // Same car/track plumbing as full recording start — main.js
      // embeds slugs in the filename so replay clips are groupable
      // by venue/car alongside long-form recordings.
      var result = await window.k10.saveReplayBuffer({
        data: arrayBuf,
        car: window._currentCarModel || null,
        track: window._currentTrackName || null,
      });

      _saving = false;

      if (result && result.success) {
        console.log('[ReplayBuffer] Saved → ' + result.filename);
        window.dispatchEvent(new CustomEvent('replay-buffer-saved', {
          detail: result,
        }));

        // Auto-transcode the saved clip if FFmpeg is available
        if (window._settings && window._settings.recordingOutputFormat !== 'webm') {
          autoTranscodeClip(result.path);
        }
      }

      return result;

    } catch (err) {
      _saving = false;
      console.error('[ReplayBuffer] Save error:', err);
      return { error: err.message };
    }
  }

  // ── Auto-transcode saved replay clips ─────────────────────
  async function autoTranscodeClip(webmPath) {
    if (!window.k10 || !window.k10.getFfmpegInfo || !window.k10.transcodeRecording) return;
    var info = await window.k10.getFfmpegInfo();
    if (!info.available) return;

    var settings = window._settings || {};
    var opts = {
      quality: 'medium',  // replay clips don't need max quality
      encoder: settings.recordingEncoder || 'auto',
      deleteSource: settings.recordingDeleteSource !== false,
    };

    try {
      await window.k10.transcodeRecording(webmPath, opts);
      console.log('[ReplayBuffer] Clip transcoded to MP4');
    } catch (err) {
      console.warn('[ReplayBuffer] Clip transcode failed:', err);
    }
  }

  // ── Auto-start/stop based on idle state ───────────────────
  // Buffer should run when a game is active, not when idle.
  var _idleCheckIntervalId = null;
  window.addEventListener('DOMContentLoaded', function () {
    // Listen for idle state changes from poll-engine
    var lastIdle = true;
    _idleCheckIntervalId = setInterval(function () {
      var s = window._settings || {};
      if (!s.replayBufferEnabled) {
        if (_running) stop();
        return;
      }

      var idle = document.body.classList.contains('idle-state');
      if (idle && !lastIdle && _running) {
        stop();
      } else if (!idle && lastIdle && !_running) {
        start();
      }
      lastIdle = idle;
    }, 2000); // check every 2 seconds
  });

  // ── Cleanup idle check interval on module unload ──────────
  window.addEventListener('beforeunload', function () {
    if (_idleCheckIntervalId) {
      clearInterval(_idleCheckIntervalId);
      _idleCheckIntervalId = null;
    }
  });

  // ── Hotkey handler ────────────────────────────────────────
  // Wired up in main.js, forwarded via preload.js
  if (window.k10 && window.k10.onSaveReplayBuffer) {
    window.k10.onSaveReplayBuffer(function () {
      save();
    });
  }

  // ── Public API ────────────────────────────────────────────
  window.replayBufferStart = start;
  window.replayBufferStop = stop;
  window.replayBufferSave = save;
  window.replayBufferIsRunning = function () { return _running; };
  window.replayBufferIsSaving = function () { return _saving; };
})();
