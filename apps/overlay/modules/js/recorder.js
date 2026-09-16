// ═══════════════════════════════════════════════════════════════
// SCREEN RECORDER — Phase 2: Screen + System Audio + Facecam
// Captures the full display (game + overlay composited) to a local
// .webm file using Electron's desktopCapturer + MediaRecorder.
//
// Phase 2 additions:
//   • System audio via user-selected audio input device
//     (virtual audio cable like VB-Audio appears as a mic input)
//   • Mic audio (separate device from system audio)
//   • Audio mixing via Web Audio API (mic + system → single track)
//   • Facecam compositing via offscreen canvas PiP
//
// Chunks are streamed to the main process via IPC for file I/O.
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────
  var _mediaRecorder = null;
  var _displayStream = null;
  var _micStream = null;
  var _systemAudioStream = null;
  var _webcamStream = null;
  var _audioContext = null;
  var _compositeCanvas = null;
  var _compositeCtx = null;
  var _compositeAnimFrame = null;
  var _recording = false;
  var _startTime = 0;

  // ── Codec negotiation ──────────────────────────────────────
  var CODEC_PREFS = [
    'video/webm;codecs=h264',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp8',
    'video/webm',
  ];

  function pickMimeType() {
    for (var i = 0; i < CODEC_PREFS.length; i++) {
      if (MediaRecorder.isTypeSupported(CODEC_PREFS[i])) {
        return CODEC_PREFS[i];
      }
    }
    return '';
  }

  // ── Quality presets ────────────────────────────────────────
  // Always capture at native resolution (3440×1440 ultrawide) to preserve
  // the full overlay layout in the corners. Bitrates scaled for 21:9.
  // 16:9 conversion happens downstream in the editing pipeline.
  var QUALITY = {
    low:    { videoBitsPerSecond:  8000000 },   //  8 Mbps
    medium: { videoBitsPerSecond: 16000000 },   // 16 Mbps
    high:   { videoBitsPerSecond: 28000000 },   // 28 Mbps
  };

  // ── Facecam defaults ───────────────────────────────────────
  var FACECAM_DEFAULTS = {
    width: 320,
    height: 240,
    x: 'right',      // 'left' or 'right'
    y: 'bottom',     // 'top' or 'bottom'
    margin: 20,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'hsla(0, 0%, 100%, 0.25)',
  };

  // ── Device enumeration ─────────────────────────────────────
  // List available audio/video input devices so the user can pick
  // a mic, a system audio source (virtual cable), and a webcam.
  async function enumerateDevices() {
    try {
      // Must request permission first or labels will be empty
      var tempStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      tempStream.getTracks().forEach(function (t) { t.stop(); });
    } catch (e) {
      // If user denies, we'll still get device IDs but no labels
    }

    var devices = await navigator.mediaDevices.enumerateDevices();
    var audioInputs = [];
    var videoInputs = [];

    devices.forEach(function (d) {
      if (d.kind === 'audioinput') {
        audioInputs.push({ deviceId: d.deviceId, label: d.label || ('Mic ' + (audioInputs.length + 1)) });
      } else if (d.kind === 'videoinput') {
        videoInputs.push({ deviceId: d.deviceId, label: d.label || ('Camera ' + (videoInputs.length + 1)) });
      }
    });

    return { audioInputs: audioInputs, videoInputs: videoInputs };
  }

  // ── Cross-runtime device-id resolution ─────────────────────
  // The Windows host's Settings page persists a WinRT DeviceInformation.Id
  // (e.g. `\\?\USB#VID_046D&PID_085C#…{guid}\GLOBAL`). Chromium's
  // navigator.mediaDevices.enumerateDevices() returns origin-scoped SHA-256
  // hashes — different namespace entirely. Passing the WinRT id straight to
  // getUserMedia({deviceId:{exact:…}}) throws NotFoundError every time.
  //
  // Workaround: the host now writes a friendly label (`*Label` settings key)
  // alongside the WinRT id. We match by label first, normalized (USB hubs
  // and driver versions like to append "(USB Video Device)" or a port
  // index, so we accept startsWith/contains). If the label fails or is
  // missing (older saves), we try the raw id as a Chromium id — that only
  // hits if the overlay itself wrote the setting in a prior session.
  // Returns a Chromium deviceId string, or null when nothing matches.
  function normalizeDeviceLabel(s) {
    if (!s) return '';
    return ('' + s)
      .toLowerCase()
      .replace(/\s*\(usb video( device)?\)\s*$/i, '')
      .replace(/\s*\(\d+- /, ' (')
      .replace(/[\s ]+/g, ' ')
      .trim();
  }

  async function resolveDeviceId(kind, savedId, savedLabel) {
    if (!savedId && !savedLabel) return null;
    var devices;
    try {
      devices = await navigator.mediaDevices.enumerateDevices();
    } catch (e) {
      return null;
    }
    var candidates = devices.filter(function (d) { return d.kind === kind; });
    if (candidates.length === 0) return null;

    // 1. Exact-match the saved Chromium deviceId (overlay-authored settings).
    if (savedId) {
      for (var i = 0; i < candidates.length; i++) {
        if (candidates[i].deviceId === savedId) return savedId;
      }
    }
    // 2. Match by normalized friendly label (host-authored settings).
    if (savedLabel) {
      var want = normalizeDeviceLabel(savedLabel);
      for (var j = 0; j < candidates.length; j++) {
        if (normalizeDeviceLabel(candidates[j].label) === want) {
          return candidates[j].deviceId;
        }
      }
      // Looser: substring either direction. Catches "Logitech BRIO" vs
      // "Logitech BRIO (USB Video Device)".
      for (var k = 0; k < candidates.length; k++) {
        var have = normalizeDeviceLabel(candidates[k].label);
        if (have && (have.indexOf(want) !== -1 || want.indexOf(have) !== -1)) {
          return candidates[k].deviceId;
        }
      }
    }
    return null;
  }

  // ── Webcam stream acquisition ──────────────────────────────
  // Resolve to a Chromium deviceId first; if resolution fails we fall back
  // to {ideal: id} so the OS picks something rather than aborting the
  // entire recording. emitWebcamWarning surfaces the mismatch on the UI.
  async function getWebcamStream(deviceId, deviceLabel) {
    var baseVideo = {
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 30 },
    };
    var resolved = await resolveDeviceId('videoinput', deviceId, deviceLabel);
    if (resolved) {
      return await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: Object.assign({ deviceId: { exact: resolved } }, baseVideo),
      });
    }
    console.warn('[Recorder] Webcam device not resolvable (id=' + deviceId + ', label=' + deviceLabel + ') — falling back to default camera');
    emitWebcamWarning('Saved camera not found — using default');
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: baseVideo,
    });
  }

  // ── User-visible webcam warnings ───────────────────────────
  // recorder-ui.js listens on 'recording-webcam-warning' and flashes the
  // message on the indicator. Keeps recorder.js free of DOM code.
  function emitWebcamWarning(message) {
    try {
      window.dispatchEvent(new CustomEvent('recording-webcam-warning', {
        detail: { message: message },
      }));
    } catch (e) {
      // CustomEvent should always be available, but never let telemetry
      // plumbing crash the recording path.
    }
  }

  // ── Native-backend delegation ──────────────────────────────
  // When the user has flipped Settings → Recording → Backend to "Native",
  // the WinUI host owns the entire capture pipeline (FFmpeg + gdigrab +
  // dshow). We just call into its HTTP control server via the main
  // process. Local capture in this renderer is bypassed entirely so we
  // don't double-record. The host-side migration plan lives in
  // prodrive-windows/docs/recording-migration.md.
  var _nativeRecording = false;
  var _nativeStartTime = 0;
  var _nativeStatePoller = null;

  async function startNativeRecording(options) {
    if (_nativeRecording || _recording) {
      console.warn('[Recorder] Already recording (native)');
      return { error: 'Already recording' };
    }
    if (!window.k10 || typeof window.k10.startNativeRecording !== 'function') {
      return { error: 'Native recording bridge unavailable — preload missing IPC' };
    }
    var result = await window.k10.startNativeRecording({
      car: window._currentCarModel || null,
      track: window._currentTrackName || null,
      outputDirectory: (options && options.outputDirectory) || null,
    });
    if (result && !result.error) {
      _nativeRecording = true;
      _nativeStartTime = Date.now();
      _startTime = _nativeStartTime; // recorderElapsedMs() uses this
      _recording = true; // share the public "is recording?" flag so the indicator UI lights up
      window.dispatchEvent(new CustomEvent('recording-state-change', {
        detail: { recording: true, filename: result.path || '(native)' },
      }));
      startNativeStatePolling();
      console.log('[Recorder] Native recording started → ' + (result.path || '?'));
      return { success: true, filename: result.path || '' };
    }
    var err = (result && result.error) || 'Unknown native recording error';
    console.error('[Recorder] Native start failed:', err);
    return { error: err };
  }

  async function stopNativeRecording() {
    if (!_nativeRecording) {
      return { error: 'Not recording (native)' };
    }
    stopNativeStatePolling();
    var result = await window.k10.stopNativeRecording();
    _nativeRecording = false;
    _recording = false;
    window.dispatchEvent(new CustomEvent('recording-state-change', {
      detail: { recording: false, result: result },
    }));
    return result;
  }

  // Poll the host every few seconds so the indicator picks up host-side
  // stops (e.g. ffmpeg crashed, user hit Stop from another surface).
  // The local timer in recorder-ui drives second-by-second display;
  // we just need the eventual divergence to be detectable.
  function startNativeStatePolling() {
    stopNativeStatePolling();
    _nativeStatePoller = setInterval(async function () {
      try {
        var state = await window.k10.getNativeRecordingState();
        if (!state || state.error) return;
        if (_nativeRecording && state.recording === false) {
          // Host stopped without us asking — sync UI state.
          _nativeRecording = false;
          _recording = false;
          stopNativeStatePolling();
          window.dispatchEvent(new CustomEvent('recording-state-change', {
            detail: { recording: false, result: state },
          }));
        }
      } catch (e) { /* ignore — transient */ }
    }, 3000);
  }
  function stopNativeStatePolling() {
    if (_nativeStatePoller) { clearInterval(_nativeStatePoller); _nativeStatePoller = null; }
  }

  // ── Start recording ────────────────────────────────────────
  async function startRecording(options) {
    if (_recording) {
      console.warn('[Recorder] Already recording');
      return { error: 'Already recording' };
    }

    // Route to the WinUI host when the user opted into the native
    // backend. The Electron capture path below stays intact as the
    // working default for users still on "electron".
    var backend = (window._settings && window._settings.recordingBackend) || 'electron';
    if (backend === 'native') {
      return startNativeRecording(options || {});
    }

    options = options || {};
    var settings = window._settings || {};
    var quality = QUALITY[options.quality || settings.recordingQuality] || QUALITY.high;
    var includeMic = options.includeMic != null ? options.includeMic : (settings.recordingMic !== false);
    var includeSystemAudio = options.includeSystemAudio != null ? options.includeSystemAudio : !!settings.recordingSystemAudioDevice;
    var includeWebcam = options.includeWebcam != null ? options.includeWebcam : !!settings.recordingWebcamDevice;

    try {
      // ── 1. Display capture ─────────────────────────────────
      // Electron 33+ requires getDisplayMedia (the old getUserMedia +
      // chromeMediaSource:'desktop' pattern was removed).
      // The main process has a setDisplayMediaRequestHandler that
      // auto-grants access to the primary screen.
      _displayStream = await navigator.mediaDevices.getDisplayMedia({
        audio: false,
        video: {
          width: { max: 7680 },
          height: { max: 4320 },
          frameRate: { max: 60 },
        },
      });
      console.log('[Recorder] Display stream acquired');

      // ── 2. Audio sources ───────────────────────────────────
      // Mic and system audio are separate audio input devices.
      // System audio comes from a virtual audio cable (VB-Audio etc.)
      // that the user has configured in Windows sound settings.
      // We mix them together via Web Audio API into a single track.

      var micDeviceId = settings.recordingMicDevice || undefined;
      var sysDeviceId = settings.recordingSystemAudioDevice || undefined;
      var micLabel    = settings.recordingMicLabel || undefined;
      var sysLabel    = settings.recordingSystemAudioLabel || undefined;

      if (includeMic) {
        try {
          var micConstraints = {
            audio: {
              echoCancellation: false,
              noiseSuppression: true,
              autoGainControl: true,
            },
            video: false,
          };
          var resolvedMic = await resolveDeviceId('audioinput', micDeviceId, micLabel);
          if (resolvedMic) {
            micConstraints.audio.deviceId = { exact: resolvedMic };
          } else if (micDeviceId || micLabel) {
            // Host-picked mic that we can't bind — let Chromium pick the
            // OS default rather than aborting the whole recording.
            console.warn('[Recorder] Mic device not resolvable (id=' + micDeviceId + ', label=' + micLabel + '), using default');
          }
          _micStream = await navigator.mediaDevices.getUserMedia(micConstraints);
          console.log('[Recorder] Mic stream acquired');
        } catch (micErr) {
          console.warn('[Recorder] Mic unavailable:', micErr.message);
          _micStream = null;
        }
      }

      if (includeSystemAudio && (sysDeviceId || sysLabel)) {
        try {
          var resolvedSys = await resolveDeviceId('audioinput', sysDeviceId, sysLabel);
          if (!resolvedSys) {
            throw new Error('System audio device not found — pick a virtual cable in Settings.');
          }
          _systemAudioStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              deviceId: { exact: resolvedSys },
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            },
            video: false,
          });
          console.log('[Recorder] System audio stream acquired (virtual cable)');
        } catch (sysErr) {
          console.warn('[Recorder] System audio unavailable:', sysErr.message);
          _systemAudioStream = null;
        }
      }

      // ── 3. Mix audio via Web Audio API ─────────────────────
      var mixedAudioTrack = null;
      var hasMic = _micStream && _micStream.getAudioTracks().length > 0;
      var hasSys = _systemAudioStream && _systemAudioStream.getAudioTracks().length > 0;

      if (hasMic || hasSys) {
        _audioContext = new AudioContext();
        var destination = _audioContext.createMediaStreamDestination();

        if (hasMic) {
          var micSource = _audioContext.createMediaStreamSource(_micStream);
          // Mic gain — slightly lower to avoid drowning out game audio
          var micGain = _audioContext.createGain();
          micGain.gain.value = settings.recordingMicVolume != null ? settings.recordingMicVolume : 0.8;
          micSource.connect(micGain).connect(destination);
        }

        if (hasSys) {
          var sysSource = _audioContext.createMediaStreamSource(_systemAudioStream);
          var sysGain = _audioContext.createGain();
          sysGain.gain.value = settings.recordingSystemVolume != null ? settings.recordingSystemVolume : 1.0;
          sysSource.connect(sysGain).connect(destination);
        }

        mixedAudioTrack = destination.stream.getAudioTracks()[0];
        console.log('[Recorder] Audio mixed:', (hasMic ? 'mic' : '') + (hasMic && hasSys ? '+' : '') + (hasSys ? 'system' : ''));
      }

      // ── 4. Webcam (optional facecam PiP) ───────────────────
      // Failures here used to be silent — a console.warn and then the recording
      // just proceeded without a facecam, which looks to the user like "camera
      // is selected but doesn't record my face." We now surface every failure
      // mode through the 'recording-webcam-warning' event so recorder-ui can
      // flash it on the indicator. Fallback: if {exact: id} fails with
      // NotFoundError (usually a stale deviceId that changed across restarts),
      // retry once with {ideal: id} so the OS can pick the best available match.
      var webcamDeviceId = settings.recordingWebcamDevice || undefined;

      if (includeWebcam && !webcamDeviceId) {
        // Dropdown says "camera picked" but the setting never persisted.
        // Common cause: user changed the selection but the change handler
        // didn't fire. Surface it so the user isn't left wondering.
        emitWebcamWarning('No camera selected in settings — facecam skipped');
      }

      if (includeWebcam && webcamDeviceId) {
        try {
          _webcamStream = await getWebcamStream(webcamDeviceId, settings.recordingWebcamLabel);
          console.log('[Recorder] Webcam stream acquired');
        } catch (camErr) {
          var reason = camErr && camErr.name ? camErr.name + ': ' + camErr.message : String(camErr);
          console.warn('[Recorder] Webcam unavailable:', reason);
          emitWebcamWarning('Facecam error — ' + reason);
          _webcamStream = null;
        }
      }

      // ── 5. Compose video stream ────────────────────────────
      // If facecam is active, composite display + webcam onto an
      // offscreen canvas and capture that as the video track.
      // Otherwise, use the raw display stream directly.
      var videoTrack;

      if (_webcamStream) {
        videoTrack = createCompositeStream(_displayStream, _webcamStream, settings);
      } else {
        videoTrack = _displayStream.getVideoTracks()[0];
      }

      // ── 6. Build final MediaStream ─────────────────────────
      var finalTracks = [videoTrack];
      if (mixedAudioTrack) {
        finalTracks.push(mixedAudioTrack);
      }
      var finalStream = new MediaStream(finalTracks);

      // ── 7. Create MediaRecorder ────────────────────────────
      var mimeType = pickMimeType();
      var recorderOpts = {
        videoBitsPerSecond: quality.videoBitsPerSecond,
      };
      if (mimeType) {
        recorderOpts.mimeType = mimeType;
      }

      _mediaRecorder = new MediaRecorder(finalStream, recorderOpts);
      console.log('[Recorder] Using codec:', _mediaRecorder.mimeType);
      console.log('[Recorder] Video bitrate:', quality.videoBitsPerSecond, 'bps');
      console.log('[Recorder] Audio sources: mic=' + (hasMic ? 'yes' : 'no') + ', system=' + (hasSys ? 'yes' : 'no') + ', webcam=' + (_webcamStream ? 'yes' : 'no'));

      // ── 8. Tell main process to open a write stream ────────
      // Pass current car + track so main.js can embed slugs in the
      // filename. Both come from poll-engine's per-frame state via
      // window._currentCarModel / _currentTrackName. The sidecar
      // header also stamps them; this is the file-system surfacing.
      var result = await window.k10.startRecording({
        ext: 'webm',
        car: window._currentCarModel || null,
        track: window._currentTrackName || null,
      });
      if (result.error) {
        throw new Error(result.error);
      }

      // ── 9. Stream chunks to main process ───────────────────
      _mediaRecorder.ondataavailable = function (e) {
        if (e.data && e.data.size > 0) {
          console.log('[Recorder] Chunk available:', e.data.size, 'bytes');
          e.data.arrayBuffer().then(function (buf) {
            window.k10.writeRecordingChunk(buf);
          }).catch(function (err) {
            console.error('[Recorder] Failed to convert blob to arrayBuffer:', err);
          });
        }
      };

      _mediaRecorder.onerror = function (e) {
        console.error('[Recorder] MediaRecorder error:', e.error);
        stopRecording();
        if (typeof window.onRecordingError === 'function') {
          window.onRecordingError(e.error);
        }
      };

      _mediaRecorder.onstop = function () {
        console.log('[Recorder] MediaRecorder stopped');
      };

      // ── 10. Start — request data every 1 second ────────────
      _mediaRecorder.start(1000);
      _recording = true;
      _startTime = Date.now();

      window.dispatchEvent(new CustomEvent('recording-state-change', {
        detail: { recording: true, filename: result.filename },
      }));

      // Start telemetry sidecar alongside video
      if (typeof window.sidecarStart === 'function' && result.path) {
        window.sidecarStart(result.path);
      }

      console.log('[Recorder] Recording started → ' + result.filename);
      return { success: true, filename: result.filename };

    } catch (err) {
      console.error('[Recorder] Start failed:', err);
      cleanup();
      return { error: err.message };
    }
  }

  // ── Facecam composite ──────────────────────────────────────
  // Draw display capture + webcam PiP onto an offscreen canvas,
  // then captureStream() to produce a single video track.
  function createCompositeStream(displayStream, webcamStream, settings) {
    var displayTrack = displayStream.getVideoTracks()[0];
    var displaySettings = displayTrack.getSettings();
    var canvasW = displaySettings.width || 3440;
    var canvasH = displaySettings.height || 1440;

    // Create offscreen canvas at display resolution
    _compositeCanvas = document.createElement('canvas');
    _compositeCanvas.width = canvasW;
    _compositeCanvas.height = canvasH;
    _compositeCtx = _compositeCanvas.getContext('2d');

    // Video elements for drawing frames. play() returns a Promise that rejects
    // when Electron's autoplay policy blocks it (can happen if the document
    // hasn't had a recent user gesture). Swallowing that silently used to leave
    // webcamVideo.readyState stuck at 0, which made drawFrame() skip the PiP
    // forever — looks to the user like "the camera just doesn't work." Now we
    // catch, surface, and still let the display track go through.
    var displayVideo = document.createElement('video');
    displayVideo.srcObject = displayStream;
    displayVideo.muted = true;
    displayVideo.playsInline = true;
    displayVideo.play().catch(function (err) {
      console.warn('[Recorder] displayVideo.play() rejected:', err && err.message);
    });

    var webcamVideo = document.createElement('video');
    webcamVideo.srcObject = webcamStream;
    webcamVideo.muted = true;
    webcamVideo.playsInline = true;
    webcamVideo.play().catch(function (err) {
      console.warn('[Recorder] webcamVideo.play() rejected:', err && err.message);
      emitWebcamWarning('Facecam blocked by autoplay policy — ' + (err && err.message || 'unknown'));
    });

    // Facecam PiP dimensions and position
    var fc = Object.assign({}, FACECAM_DEFAULTS, settings.recordingFacecam || {});
    var pipW = fc.width;
    var pipH = fc.height;
    var pipX = fc.x === 'left' ? fc.margin : canvasW - pipW - fc.margin;
    var pipY = fc.y === 'top' ? fc.margin : canvasH - pipH - fc.margin;

    // Composite draw loop — runs at display refresh rate
    function drawFrame() {
      _compositeCtx.drawImage(displayVideo, 0, 0, canvasW, canvasH);

      if (webcamVideo.readyState >= 2) {
        // Draw rounded rect clip for the facecam
        _compositeCtx.save();
        roundedRect(_compositeCtx, pipX, pipY, pipW, pipH, fc.borderRadius);
        _compositeCtx.clip();
        _compositeCtx.drawImage(webcamVideo, pipX, pipY, pipW, pipH);
        _compositeCtx.restore();

        // Border
        if (fc.borderWidth > 0) {
          _compositeCtx.save();
          _compositeCtx.strokeStyle = fc.borderColor;
          _compositeCtx.lineWidth = fc.borderWidth;
          roundedRect(_compositeCtx, pipX, pipY, pipW, pipH, fc.borderRadius);
          _compositeCtx.stroke();
          _compositeCtx.restore();
        }
      }

      _compositeAnimFrame = requestAnimationFrame(drawFrame);
    }

    drawFrame();

    // captureStream(0) = manual frame rate, driven by rAF
    // captureStream(60) = browser-managed 60fps
    var canvasStream = _compositeCanvas.captureStream(60);
    return canvasStream.getVideoTracks()[0];
  }

  // Canvas helper: draw a rounded rectangle path
  function roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // ── Stop recording ─────────────────────────────────────────
  async function stopRecording() {
    // Native backend path — bypasses _mediaRecorder entirely.
    if (_nativeRecording) {
      return stopNativeRecording();
    }
    if (!_recording || !_mediaRecorder) {
      return { error: 'Not recording' };
    }

    return new Promise(function (resolve) {
      _mediaRecorder.onstop = async function () {
        var result = await window.k10.stopRecording();
        cleanup();

        window.dispatchEvent(new CustomEvent('recording-state-change', {
          detail: { recording: false, result: result },
        }));

        // Stop telemetry sidecar
        if (typeof window.sidecarStop === 'function') {
          window.sidecarStop();
        }

        console.log('[Recorder] Recording saved');

        // Auto-transcode .webm → .mp4 if FFmpeg is available
        if (result && result.success && result.path) {
          autoTranscode(result.path);
        }

        resolve(result);
      };

      _mediaRecorder.stop();
    });
  }

  // ── Auto-transcode ─────────────────────────────────────────
  // Fire-and-forget transcode from .webm → .mp4 using FFmpeg.
  // Runs in the background after recording stops. Progress is
  // forwarded to the UI via 'transcode-progress' IPC events.
  async function autoTranscode(webmPath) {
    var settings = window._settings || {};

    // If user chose WebM output, skip transcode entirely
    if (settings.recordingOutputFormat === 'webm') {
      console.log('[Recorder] Output format is WebM — skipping transcode');
      return;
    }

    if (!window.k10 || !window.k10.getFfmpegInfo) return;

    var info = await window.k10.getFfmpegInfo();
    if (!info.available) {
      console.log('[Recorder] FFmpeg not available — keeping .webm');
      return;
    }

    console.log('[Recorder] Auto-transcode starting (' + info.encoder + ')...');
    window.dispatchEvent(new CustomEvent('transcode-state-change', {
      detail: { transcoding: true, encoder: info.encoder },
    }));

    var opts = {
      quality: settings.recordingQuality || 'high',
      encoder: settings.recordingEncoder || 'auto',
      deleteSource: settings.recordingDeleteSource !== false,
    };

    try {
      var result = await window.k10.transcodeRecording(webmPath, opts);
      if (result.error) {
        console.warn('[Recorder] Transcode failed:', result.error);
      } else {
        console.log('[Recorder] Transcode complete → ' + result.outputPath);
      }
      window.dispatchEvent(new CustomEvent('transcode-state-change', {
        detail: { transcoding: false, result: result },
      }));
    } catch (err) {
      console.error('[Recorder] Transcode error:', err);
      window.dispatchEvent(new CustomEvent('transcode-state-change', {
        detail: { transcoding: false, error: err.message },
      }));
    }
  }

  // ── Toggle ─────────────────────────────────────────────────
  async function toggleRecording() {
    if (_recording) {
      return stopRecording();
    } else {
      return startRecording();
    }
  }

  // ── Cleanup ────────────────────────────────────────────────
  function cleanup() {
    _recording = false;
    _startTime = 0;

    if (_compositeAnimFrame) {
      cancelAnimationFrame(_compositeAnimFrame);
      _compositeAnimFrame = null;
    }
    _compositeCanvas = null;
    _compositeCtx = null;

    if (_displayStream) {
      _displayStream.getTracks().forEach(function (t) { t.stop(); });
      _displayStream = null;
    }
    if (_micStream) {
      _micStream.getTracks().forEach(function (t) { t.stop(); });
      _micStream = null;
    }
    if (_systemAudioStream) {
      _systemAudioStream.getTracks().forEach(function (t) { t.stop(); });
      _systemAudioStream = null;
    }
    if (_webcamStream) {
      _webcamStream.getTracks().forEach(function (t) { t.stop(); });
      _webcamStream = null;
    }
    if (_audioContext) {
      _audioContext.close().catch(function () {}).finally(function () {
        _audioContext = null;
      });
    }
    _mediaRecorder = null;
  }

  // ── Getters ────────────────────────────────────────────────
  function isRecording() {
    return _recording;
  }

  function getElapsedMs() {
    return _recording ? Date.now() - _startTime : 0;
  }

  // ── Wire up hotkey from main process ───────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    if (window.k10 && window.k10.onToggleRecording) {
      window.k10.onToggleRecording(function () {
        toggleRecording();
      });
    }
  });

  // ── Public API ─────────────────────────────────────────────
  window.recorderStart = startRecording;
  window.recorderStop = stopRecording;
  window.recorderToggle = toggleRecording;
  window.recorderIsRecording = isRecording;
  window.recorderElapsedMs = getElapsedMs;
  window.recorderEnumerateDevices = enumerateDevices;
})();
