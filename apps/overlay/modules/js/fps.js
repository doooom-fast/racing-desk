// FPS counter

  // ═══════════════════════════════════════════════════════════════
  //  FPS COUNTER — uses game framerate from API, not browser render rate
  // ═══════════════════════════════════════════════════════════════
  let _apiFps = 0;

  function setApiFps(val) {
    _apiFps = val;
  }

  let _fpsLastUpdate = 0;
  function updateFps() {
    const now = performance.now();
    if (now - _fpsLastUpdate < 1000) return; // update display once per second
    _fpsLastUpdate = now;
    const el = document.getElementById('dsFps');
    if (el) el.textContent = _apiFps > 0 ? Math.round(_apiFps) : '—';
  }
