// ═══════════════════════════════════════════════════════════════
//  AMBIENT CAPTURE — Region selection + settings color preview
// ═══════════════════════════════════════════════════════════════
//
//  1) User draws a capture rectangle via "Draw Region" button.
//     The rect is sent to the C# plugin via HTTP so the native
//     ScreenColorSampler captures color from that region only.
//
//  2) Settings preview: a colored div + info text showing the
//     current ambient color (~15fps, only while settings open).
//     (Screen thumbnail preview is no longer available since
//     capture moved from Electron to the C# plugin.)
//
//  3) When settings re-open, the saved capture rect is re-drawn
//     so the user can see where they last placed it.
// ═══════════════════════════════════════════════════════════════

(function initAmbientCapture() {
  'use strict';

  let _captureRect = null;     // { x, y, w, h } as ratios of viewport

  // Preview state
  let _previewInterval = null;

  // Region selection state
  let _isSelecting = false;
  let _startX = 0, _startY = 0;

  // ═════════════════════════════════════════════
  //  REGION SELECTION UI
  // ═════════════════════════════════════════════

  window.startCaptureAreaSelection = async function() {
    // No permission needed — capture is done natively by the C# plugin
    // (Windows GDI+ doesn't require special permissions)

    // Show selection overlay (settings stay open for click surface)
    const overlay = document.getElementById('captureAreaOverlay');
    if (!overlay) return;

    overlay.style.display = 'block';
    const rectEl = document.getElementById('captureAreaRect');
    if (rectEl) rectEl.style.display = 'none';

    overlay.addEventListener('mousedown', onSelectionStart);
    document.addEventListener('keydown', onSelectionEscape);
  };

  function onSelectionStart(e) {
    if (e.button !== 0) return;
    _isSelecting = true;
    _startX = e.clientX;
    _startY = e.clientY;
    const rectEl = document.getElementById('captureAreaRect');
    if (rectEl) {
      rectEl.style.display = 'block';
      rectEl.style.left = _startX + 'px';
      rectEl.style.top = _startY + 'px';
      rectEl.style.width = '0px';
      rectEl.style.height = '0px';
    }
    document.addEventListener('mousemove', onSelectionMove);
    document.addEventListener('mouseup', onSelectionEnd);
  }

  function onSelectionMove(e) {
    if (!_isSelecting) return;
    const rectEl = document.getElementById('captureAreaRect');
    if (!rectEl) return;
    const x = Math.min(e.clientX, _startX);
    const y = Math.min(e.clientY, _startY);
    const w = Math.abs(e.clientX - _startX);
    const h = Math.abs(e.clientY - _startY);
    rectEl.style.left = x + 'px';
    rectEl.style.top = y + 'px';
    rectEl.style.width = w + 'px';
    rectEl.style.height = h + 'px';
  }

  function onSelectionEnd(e) {
    if (!_isSelecting) return;
    _isSelecting = false;
    document.removeEventListener('mousemove', onSelectionMove);
    document.removeEventListener('mouseup', onSelectionEnd);

    const x = Math.min(e.clientX, _startX);
    const y = Math.min(e.clientY, _startY);
    const w = Math.abs(e.clientX - _startX);
    const h = Math.abs(e.clientY - _startY);

    if (w < 20 || h < 20) {
      console.warn('[AmbientCapture] Selection too small, ignoring');
      closeSelectionOverlay();
      return;
    }

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    _captureRect = { x: x / vw, y: y / vh, w: w / vw, h: h / vh };

    // Persist locally
    if (window._settings) {
      window._settings.ambientCaptureRect = _captureRect;
      if (typeof window.saveSettings === 'function') window.saveSettings();
    }

    // Send to C# plugin via HTTP so ScreenColorSampler uses this region
    sendRectToPlugin(_captureRect);

    console.log('[AmbientCapture] Region set:', _captureRect);
    closeSelectionOverlay();
  }

  function onSelectionEscape(e) {
    if (e.key === 'Escape') closeSelectionOverlay();
  }

  function closeSelectionOverlay() {
    const overlay = document.getElementById('captureAreaOverlay');
    if (overlay) {
      overlay.style.display = 'none';
      overlay.removeEventListener('mousedown', onSelectionStart);
    }
    document.removeEventListener('keydown', onSelectionEscape);
    document.removeEventListener('mousemove', onSelectionMove);
    document.removeEventListener('mouseup', onSelectionEnd);
    _isSelecting = false;
  }

  // ═════════════════════════════════════════════
  //  SEND RECT TO C# PLUGIN VIA HTTP
  // ═════════════════════════════════════════════

  function sendRectToPlugin(rect) {
    if (!rect) return;
    const url = (window._simhubUrlOverride || SIMHUB_URL) +
      '?action=setrect' +
      '&x=' + rect.x.toFixed(6) +
      '&y=' + rect.y.toFixed(6) +
      '&w=' + rect.w.toFixed(6) +
      '&h=' + rect.h.toFixed(6);
    fetch(url).catch(err => {
      console.warn('[AmbientCapture] Failed to send rect to plugin:', err);
    });
  }

  // ═════════════════════════════════════════════
  //  SETTINGS PREVIEW — realtime color swatch
  //  ~15fps, only when settings panel is open.
  //  (No thumbnail preview — that required Electron IPC)
  // ═════════════════════════════════════════════

  window.startAmbientPreview = function() {
    if (_previewInterval) return;

    // Show saved capture rect overlay outline (non-interactive)
    showSavedRect();

    // Update color swatch at ~15fps
    _previewInterval = setInterval(updatePreview, 66);
    updatePreview(); // immediate first frame
  };

  window.stopAmbientPreview = function() {
    if (_previewInterval) {
      clearInterval(_previewInterval);
      _previewInterval = null;
    }
    hideSavedRect();
  };

  function updatePreview() {
    const swatch = document.getElementById('ambientPreviewSwatch');
    const info = document.getElementById('ambientPreviewInfo');
    if (!swatch && !info) return;

    // Get ambient color state
    const state = (typeof window.getAmbientColor === 'function')
      ? window.getAmbientColor()
      : { r: 0, g: 0, b: 0, tr: 0, tg: 0, tb: 0, enabled: false, hasData: false, polled: false };

    // Use target color (immediate, not lerped) so preview reacts fast
    const cr = state.tr !== undefined ? state.tr : state.r;
    const cg = state.tg !== undefined ? state.tg : state.g;
    const cb = state.tb !== undefined ? state.tb : state.b;
    const r8 = Math.round(cr * 255);
    const g8 = Math.round(cg * 255);
    const b8 = Math.round(cb * 255);

    // Color swatch — just set the background color
    if (swatch) {
      swatch.style.background = `rgb(${r8}, ${g8}, ${b8})`;
    }

    // Info text
    if (info) {
      let source;
      if (!state.enabled) source = 'OFF';
      else if (state.hasData && !state.polled) source = 'Screen Capture';
      else if (state.polled) source = 'Flag State';
      else source = 'No region set';

      const rect = _captureRect
        ? `Region: ${Math.round(_captureRect.w * 100)}% × ${Math.round(_captureRect.h * 100)}%`
        : 'Draw a region to start';

      info.textContent = `RGB(${r8}, ${g8}, ${b8}) — ${source} — ${rect}`;
    }
  }

  // ═════════════════════════════════════════════
  //  SAVED RECT VISUALIZATION
  //  When settings open, show where the capture
  //  rect is positioned as a dashed outline.
  // ═════════════════════════════════════════════

  let _savedRectDiv = null;

  function showSavedRect() {
    // Load from settings if we don't have one in memory
    if (!_captureRect && window._settings && window._settings.ambientCaptureRect) {
      _captureRect = window._settings.ambientCaptureRect;
    }
    if (!_captureRect) return;

    if (!_savedRectDiv) {
      _savedRectDiv = document.createElement('div');
      _savedRectDiv.id = 'savedCaptureRect';
      _savedRectDiv.style.cssText =
        'position:fixed;z-index:9999;pointer-events:none;' +
        'border:2px dashed hsla(45,100%,60%,0.6);' +
        'background:hsla(45,100%,60%,0.05);' +
        'border-radius:3px;' +
        'box-shadow:0 0 8px hsla(45,100%,60%,0.2);';
      document.body.appendChild(_savedRectDiv);
    }

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    _savedRectDiv.style.left   = Math.round(_captureRect.x * vw) + 'px';
    _savedRectDiv.style.top    = Math.round(_captureRect.y * vh) + 'px';
    _savedRectDiv.style.width  = Math.round(_captureRect.w * vw) + 'px';
    _savedRectDiv.style.height = Math.round(_captureRect.h * vh) + 'px';
    _savedRectDiv.style.display = 'block';
  }

  function hideSavedRect() {
    if (_savedRectDiv) _savedRectDiv.style.display = 'none';
  }

  // ── Restore saved capture rect on load ──
  window.restoreAmbientCapture = function() {
    if (window._settings && window._settings.ambientCaptureRect) {
      _captureRect = window._settings.ambientCaptureRect;
      // Send to C# plugin via HTTP
      sendRectToPlugin(_captureRect);
      console.log('[AmbientCapture] Restored saved region:', _captureRect);
    }
  };

  window.stopAmbientCapture = function() {
    // Nothing to stop — C# plugin handles capture lifecycle
  };

})();
