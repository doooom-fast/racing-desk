// SIMHUB HTTP API POLLING ENGINE
// Depends on: config.js (SIMHUB_URL, POLL_MS, PROP_KEYS)

  // ═══════════════════════════════════════════════════════════════
  // SIMHUB HTTP API POLLING ENGINE
  // Self-contained data bridge — polls SimHub's web server directly.
  // Works as standalone browser overlay or OBS Browser Source.
  // The JavascriptExtensions file is unused in this mode.
  //
  // Config: The Racing Desk plugin HTTP server (port 8889)
  // The plugin serves all telemetry, demo, commentary and track map data
  // as a flat JSON map from its own HTTP server — no SimHub web API needed.
  // ═══════════════════════════════════════════════════════════════

  // Constants and property keys are defined in config.js
  // Connection status, fetchProps, applyGameMode are in game-detect.js
  // Settings persistence and Discord state are in connections.js

  // ─── Fallback demo track map — Sebring International (80-pt Catmull-Rom→Bezier) ──
  // Generated from bundled CSV: sebring international.csv
  // Normalised to 0-100 viewBox with 5% padding (same algorithm as C# NormaliseAndBuild)
  const _DEMO_FALLBACK_MAP = 'M 58.9,71.8 C 64.2,72.1 62.3,72.0 64.0,72.1 C 65.7,72.1 67.3,72.3 69.0,72.2 C 70.6,72.0 72.5,72.0 73.7,71.2 C 75.0,70.3 75.8,68.6 76.3,67.1 C 76.9,65.6 76.9,63.8 77.0,62.1 C 77.0,60.4 76.7,58.7 76.5,56.9 C 76.2,55.2 75.8,53.6 75.5,51.8 C 75.2,50.1 74.9,48.3 74.8,46.5 C 74.7,44.8 75.0,43.0 74.9,41.3 C 74.7,39.7 74.8,37.6 74.0,36.4 C 73.1,35.3 71.2,35.2 69.7,34.5 C 68.2,33.9 66.6,32.9 65.0,32.4 C 63.5,32.0 61.6,31.2 60.3,31.8 C 59.0,32.3 58.2,34.2 57.3,35.6 C 56.5,37.0 56.0,38.7 55.0,40.1 C 54.0,41.5 52.6,42.9 51.3,44.0 C 50.0,45.1 48.7,45.9 47.3,46.8 C 45.8,47.6 44.1,48.4 42.4,49.0 C 40.6,49.5 38.7,49.9 36.8,50.2 C 34.9,50.4 32.9,50.4 30.9,50.4 C 28.9,50.4 26.8,50.3 24.8,50.3 C 22.7,50.3 20.5,50.4 18.5,50.4 C 16.6,50.4 14.7,50.4 12.9,50.4 C 11.2,50.4 9.3,50.9 8.0,50.4 C 6.7,49.8 5.2,48.6 5.1,47.3 C 5.0,46.1 6.6,44.5 7.4,43.0 C 8.2,41.6 8.8,40.0 9.9,38.7 C 11.0,37.4 12.4,36.0 13.9,35.1 C 15.4,34.1 17.1,33.5 18.8,32.8 C 20.4,32.1 22.3,31.5 23.9,30.9 C 25.6,30.2 27.3,29.7 28.7,28.9 C 30.2,28.1 31.3,27.2 32.5,26.2 C 33.8,25.2 34.9,24.0 36.0,22.9 C 37.2,21.8 38.2,20.7 39.4,19.5 C 40.6,18.3 41.9,16.8 43.1,15.7 C 44.4,14.5 45.7,12.9 47.0,12.7 C 48.3,12.6 49.7,13.9 50.9,14.8 C 52.2,15.7 53.2,17.3 54.6,18.0 C 56.0,18.8 57.7,19.2 59.3,19.2 C 61.0,19.1 62.9,18.4 64.5,17.8 C 66.1,17.3 67.4,16.4 69.0,16.0 C 70.5,15.6 72.2,15.6 73.9,15.5 C 75.6,15.4 77.7,15.0 79.1,15.5 C 80.4,16.1 81.7,17.6 82.2,19.0 C 82.7,20.4 82.1,22.2 82.1,24.0 C 82.0,25.8 82.0,27.8 81.9,29.6 C 81.9,31.3 81.8,32.8 81.8,34.5 C 81.7,36.1 81.7,37.9 81.6,39.5 C 81.6,41.1 81.3,42.6 81.3,44.2 C 81.3,45.8 81.3,47.4 81.6,49.0 C 82.0,50.5 82.7,52.1 83.4,53.7 C 84.2,55.2 85.1,56.9 86.2,58.4 C 87.3,59.8 89.0,61.1 90.2,62.4 C 91.5,63.8 93.0,65.0 93.8,66.5 C 94.6,67.9 95.1,69.6 94.9,71.1 C 94.6,72.6 93.0,73.9 92.4,75.4 C 91.8,77.0 91.7,78.7 91.2,80.4 C 90.8,82.0 90.6,84.3 89.6,85.4 C 88.7,86.6 86.8,87.1 85.3,87.4 C 83.7,87.6 82.1,87.1 80.4,87.0 C 78.7,86.9 76.8,86.8 75.1,86.7 C 73.4,86.7 71.9,86.9 70.2,86.9 C 68.5,86.9 66.7,86.9 64.8,86.9 C 63.0,86.9 61.0,86.9 59.1,86.8 C 57.1,86.8 55.1,86.8 53.1,86.8 C 51.1,86.7 48.9,86.7 46.9,86.7 C 44.8,86.7 42.7,86.8 40.8,86.8 C 38.9,86.8 37.3,86.8 35.6,86.8 C 33.8,86.8 32.1,86.8 30.4,86.7 C 28.7,86.7 27.3,86.8 25.6,86.7 C 23.9,86.7 21.8,86.8 20.1,86.5 C 18.3,86.2 16.8,85.7 15.3,84.8 C 13.9,84.0 12.3,82.9 11.4,81.5 C 10.5,80.2 10.0,78.2 10.1,76.7 C 10.3,75.2 11.1,73.5 12.3,72.5 C 13.4,71.5 15.3,71.2 17.0,70.8 C 18.6,70.4 20.4,70.2 22.1,70.1 C 23.8,70.0 25.3,70.0 27.0,70.0 C 28.7,70.0 27.0,69.9 32.3,70.2 C 37.7,70.5 53.7,71.5 58.9,71.8 Z';

  // ─── Time value parser — handles both numeric seconds and TimeSpan strings ───
  function _parseTimeValue(val) {
    if (val == null || val === '') return 0;
    // Try numeric first (most common case)
    var n = +val;
    if (!isNaN(n)) return n;
    // Try TimeSpan string format "HH:MM:SS.fff" or "MM:SS.fff"
    if (typeof val === 'string') {
      var parts = val.split(':');
      if (parts.length === 3) {
        // HH:MM:SS.fff
        return (+parts[0] || 0) * 3600 + (+parts[1] || 0) * 60 + (parseFloat(parts[2]) || 0);
      } else if (parts.length === 2) {
        // MM:SS.fff
        return (+parts[0] || 0) * 60 + (parseFloat(parts[1]) || 0);
      }
    }
    return 0;
  }

  // ─── Track display name ───
  // iRacing's display name arrives in the payload (TrackMap.TrackDisplayName); the game's internal
  // track name is the fallback. Resolved locally — no network lookups.
  function trackDisplayName(p, gameTrackName) {
    return (p && p['RacingDesk.Plugin.TrackMap.TrackDisplayName']) || gameTrackName || '';
  }
  window.trackDisplayName = trackDisplayName;

  // Write the track name into the full-map label and, if it doesn't fit on
  // one line, kick off a slow horizontal marquee (pause → slide → pause → return).
  let _lastFullMapLabelText = '';
  function _setFullMapLabel(labelEl, name) {
    if (!labelEl || name === _lastFullMapLabelText) return;
    _lastFullMapLabelText = name;
    let inner = labelEl.querySelector('.map-zoom-label-inner');
    if (!inner) {
      inner = document.createElement('span');
      inner.className = 'map-zoom-label-inner';
      labelEl.textContent = '';
      labelEl.appendChild(inner);
    }
    inner.textContent = name;
    // Reset before re-measuring so .clientWidth/.scrollWidth aren't influenced
    // by an in-flight transform.
    labelEl.classList.remove('is-marquee');
    labelEl.style.removeProperty('--marquee-distance');
    labelEl.style.removeProperty('--marquee-duration');
    requestAnimationFrame(function() {
      // Bail if the name changed again before this frame ran.
      if (inner.textContent !== name) return;
      const overflow = inner.scrollWidth - labelEl.clientWidth;
      if (overflow > 2) {
        // ~30 px/sec slide, clamped — keeps long names readable without
        // feeling sluggish on short ones.
        const duration = Math.max(10, Math.min(24, 8 + overflow / 30));
        labelEl.style.setProperty('--marquee-distance', '-' + (overflow + 6) + 'px');
        labelEl.style.setProperty('--marquee-duration', duration.toFixed(1) + 's');
        labelEl.classList.add('is-marquee');
      }
    });
  }

  // ─── In the car or not ───
  // modules/js/in-car.js says what in the car means. In the app it is main.js that asks it and tells this page
  // (in-race-state): out of the car the window is hidden and the page does nothing — no poll, no frames, no
  // effects — and it is not for a hidden page to notice that the driver is back in. A page with no main process
  // behind it (an iPad, a browser, OBS) has to notice for itself, so it goes on polling once a second.
  const _mainDecides = !window._remoteMode && !!window.racingDesk && window.racingDesk.inCarFromMain === true
    && typeof window.racingDesk.onInRaceState === 'function' && typeof window.racingDesk.getInRaceState === 'function';
  const _inCarSignal = _mainDecides ? null : RacingDeskInCar.createInCarSignal({ onChange: _setInCar });

  // The gap to his own laps of the session (lap-delta.js), fed every frame he is in the car.
  const _lapDeltaTracker = RacingDeskLapDelta.create();
  // The small flags iRacing's field says (ten and five to go, halfway) are said once when they come up (session-flags.js).
  const _flagNotices = window.RacingDeskSessionFlags ? window.RacingDeskSessionFlags.createNoticeTracker() : null;
  // Whether the cars ahead and behind are closing or dropping away (gap-trend.js), said in the glance layout.
  const _gapTrend = RacingDeskGapTrend.create();
  const _trendSaid = [null, null];
  function _sayTrend(index, el, said) {
    const key = said ? said.text + '|' + said.cls : '';
    if (!el || _trendSaid[index] === key) return;
    _trendSaid[index] = key;
    if (said) { el.dataset.trend = said.text; el.dataset.trendCls = said.cls; }
    else { delete el.dataset.trend; delete el.dataset.trendCls; }
  }

  function _setInCar(inCar) {
    inCar = !!inCar;
    if (inCar === _prevInRace) return;
    _prevInRace = inCar;
    if (inCar) {
      if (_mainDecides) {
        _snapshotDirty = false;   // what was last read is from the last time he was in
        startConnectionClean();   // and so is any backoff (game-detect.js)
      }
    } else if (!_isIdle) {
      // Out with no frame to say so (the source went quiet): the flag the other modules read still has to change.
      _isIdle = true;
      document.body.classList.add('idle-state');
    }
    if (_mainDecides) _backoffCapMs = inCar ? 500 : 10000;   // config.js says why
    setOverlayActive(inCar);
    // One poll at once, not at the timer's first tick: the window is on screen already.
    if (inCar && _mainDecides) pollUpdate();
  }

  // ─── Data fetch loop (runs on setInterval — decoupled from display) ───
  async function pollUpdate() {
    if (_pollActive) return;
    _pollActive = true;
    try {
      const p = await fetchProps();
      if (p) {
        _latestSnapshot = p;
        _snapshotDirty = true;
      }
      // Every poll, answered or not: a source that has gone quiet is out of the car too.
      if (_inCarSignal) _inCarSignal.feed(p);
    } catch (err) {
      console.error('[K10 poll] Fetch error:', err);
    } finally {
      _pollActive = false;
    }
  }

  // ─── Poll-rate control + active/dormant switch ───
  // The overlay is "active" only while the driver is in the car. Dormant, the FX + ambient loops are paused, and
  // the poll and the frames stop altogether when main.js decides (slow to once a second when the page has to
  // notice for itself). This is required, not just nice-to-have: the anti-throttling switches in main.js keep
  // timers + rAF running at full speed even when the window is hidden, so the renderer has to self-regulate.
  function setPollRate(ms) {
    if (_pollIntervalId) clearInterval(_pollIntervalId);
    _pollIntervalId = ms ? setInterval(pollUpdate, ms) : null;
  }

  function setOverlayActive(active) {
    if (active || !_mainDecides) {
      setPollRate(active ? POLL_MS : IDLE_POLL_MS);
      _startFrames();
    } else {
      setPollRate(0);
      _stopFrames();
    }
    // The page on an iPad draws the HUD's effects as the rig does, unless they have been switched off from its menu
    // (remote-server.js keeps that in the iPad's own storage): an iPad too slow for them can go without.
    var effects = active && !(window._remoteMode && window._rdEffectsOff === true);
    if (typeof window.setGLFXActive === 'function') window.setGLFXActive(effects);
    var ambMode = (_settings && _settings.ambientMode) || 'auto';
    if (effects && ambMode !== 'off') {
      if (typeof window.startAmbientLight === 'function') window.startAmbientLight();
    } else {
      if (typeof window.stopAmbientLight === 'function') window.stopAmbientLight();
    }
  }

  // ─── rAF render loop — DOM writes synchronized to display refresh rate ───
  let _rafId = 0;
  function _rafLoop() {
    _rafId = requestAnimationFrame(_rafLoop);
    if (!_snapshotDirty || !_latestSnapshot) return;
    _snapshotDirty = false;
    _renderFrame(_latestSnapshot);
  }
  function _startFrames() {
    if (!_rafId) _rafId = requestAnimationFrame(_rafLoop);
  }
  function _stopFrames() {
    if (_rafId) cancelAnimationFrame(_rafId);
    _rafId = 0;
  }

  // ─── Render frame — all DOM reads/writes happen here, once per display frame ───
  function _renderFrame(p) {
    _pollFrame++;
    _cycleFrameCount++;
    try {
      // Accumulate race data for post-race results screen
      if (typeof accumulateRaceData === 'function') {
        try { accumulateRaceData(p, _demo); } catch(e) { /* silent */ }
      }

    // Diagnostic logging (first 3 frames + every 300 frames ~10s)
    if (_pollFrame <= 3 || _pollFrame % 300 === 0) {
      const keys = Object.keys(p).filter(k => p[k] != null && p[k] !== 0 && p[k] !== '');
      console.log(`[K10 poll #${_pollFrame}] Got ${Object.keys(p).length} keys, ${keys.length} non-empty. DemoMode=${p['RacingDesk.Plugin.DemoMode']}, GameRunning=${p['DataCorePlugin.GameRunning']}`);
      if (_pollFrame === 1) console.log('[K10 poll] Sample values:', JSON.stringify(Object.fromEntries(keys.slice(0, 10).map(k => [k, p[k]]))));
    }

    // ── Plugin version check — warn if old DLL is serving incomplete data ──
    if (_pollFrame === 1 && !p['DataCorePlugin.GameRunning'] && p['DataCorePlugin.GameRunning'] !== 0) {
      let dbg = document.createElement('div');
      dbg.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(20,20,28,0.95);color:#ff8;font:12px/1.6 system-ui,sans-serif;padding:20px 28px;z-index:99999;border-radius:10px;max-width:420px;text-align:center;border:1px solid rgba(255,255,255,0.12);';
      dbg.innerHTML = '<div style="font-size:14px;font-weight:600;color:#fff;margin-bottom:8px">Plugin needs rebuild</div>' +
        '<div style="color:#aaa;font-size:11px;line-height:1.6">The SimHub plugin is an older version that doesn\'t serve telemetry data via HTTP.<br><br>' +
        'Rebuild the C# project in Visual Studio and restart SimHub.<br>' +
        `<span style="color:#666;font-size:10px">Got ${Object.keys(p).length} keys, expected 50+</span></div>`;
      document.body.appendChild(dbg);
      setTimeout(() => dbg.remove(), 15000);
    }

    const v = (k) => p[k] != null ? p[k] : 0;
    const vs = (k) => p[k] != null ? '' + p[k] : '';

    // Demo mode: swap data sources when plugin demo mode is active
    const _demo = +v('RacingDesk.Plugin.DemoMode') || 0;
    const d = (gameKey, demoKey) => _demo ? v('RacingDesk.Plugin.' + demoKey) : v(gameKey);
    const ds = (gameKey, demoKey) => _demo ? vs('RacingDesk.Plugin.' + demoKey) : vs(gameKey);

    const sessionPre = _demo ? 'RacingDesk.Plugin.Demo.Grid.' : 'RacingDesk.Plugin.Grid.';
    const dsPre = _demo ? 'RacingDesk.Plugin.Demo.DS.' : 'RacingDesk.Plugin.DS.';
    const sessNum = parseInt(vs(sessionPre + 'SessionState')) || 0;
    const _inPitLane = +(p[dsPre + 'IsInPitLane']) > 0;

    // Session mode from plugin (single source of truth)
    // 0=Unknown, 1=Practice, 2=Qualifying, 3=Warmup, 4=Race
    const sessionMode = +(p[dsPre + 'SessionMode']) || 0;

    // What kind of session it is, for the CSS: the glance layout (drive-view.css) puts the live delta in its big
    // cell out of a race, and the place in one. Written only when it changes.
    const _raceMode = sessionMode === 4;
    if (_raceMode !== _prevRaceMode) {
      _prevRaceMode = _raceMode;
      document.body.classList.toggle('session-race', _raceMode);
      document.body.classList.toggle('session-nonrace', !_raceMode);
    }

    // ─── Session change detection — reset per-session state ───
    const _currSessionTypeName = _demo
      ? vs('RacingDesk.Plugin.Demo.SessionTypeName')
      : vs('RacingDesk.Plugin.SessionTypeName');
    if (_currSessionTypeName && _currSessionTypeName !== _prevSessionTypeName && _prevSessionTypeName) {
      console.log('[RacingDesk] Session changed:', _prevSessionTypeName, '→', _currSessionTypeName);
      // Capture practice/quali/warmup session end before resetting
      if (typeof window.capturePracticeSessionEnd === 'function') {
        window.capturePracticeSessionEnd(p, _demo);
      }
      if (typeof resetTimeline === 'function') resetTimeline();
      // A place in one session is not a place in the next: the leaderboard's trails begin again, and so does the
      // start (the host's is asked for again, or it is the first place seen).
      if (typeof resetLeaderboardTrails === 'function') resetLeaderboardTrails();
      _startPosition = 0;
      if (typeof resetRaceResults === 'function') resetRaceResults();
      // Capture session start snapshot for sync
      if (typeof window.captureSessionStart === 'function') {
        window.captureSessionStart(p, _demo);
      }
      window._sessionStartCaptured = true;
    }
    if (_currSessionTypeName) _prevSessionTypeName = _currSessionTypeName;

    // The green flag: a race begins from its grid. What tells a heat from a feature of the same type at the same
    // track is nothing but this, so the trails and the start begin again here too. A frame with no state says
    // nothing and does not count as the state before.
    if (sessionMode === 4 && sessNum === 4 && _prevGridState >= 1 && _prevGridState <= 3) {
      if (typeof resetLeaderboardTrails === 'function') resetLeaderboardTrails();
      _startPosition = 0;
    }
    if (sessNum > 0) _prevGridState = sessNum;

    // First-frame capture: if we haven't captured a start snapshot yet and have session data
    if (typeof window.captureSessionStart === 'function' && !window._sessionStartCaptured && _currSessionTypeName) {
      window.captureSessionStart(p, _demo);
      window._sessionStartCaptured = true;
    }

    // Detect game and apply feature gating
    const rawGameId = v('RacingDesk.Plugin.GameId') || '';
    const newGameId = detectGameId(rawGameId);
    if (newGameId !== _currentGameId) {
      _currentGameId = newGameId;
      window._currentGameId = _currentGameId;
      _isIRacing = (_currentGameId === 'iracing');
      _isRally = isRallyGame() || _rallyModeEnabled;
      applyGameMode();
    }
    // Game logo overlay
    if (window.updateGameLogo) window.updateGameLogo(_currentGameId, _settings.showGameLogo !== false);

    // All games are now allowed without connection checks

    // In the car or not, by this frame: modules/js/in-car.js (demo mode counts, so the HUD can be looked at).
    // _isIdle gates the heavy render below; body.idle-state is kept as a state flag for the page's own tests
    // and styles to read. There is no idle logo — out of the car the window is hidden entirely. Neither that nor
    // whether this page polls is decided per frame: see _setInCar, above.
    const nowIdle = !RacingDeskInCar.inCar(p);
    if (nowIdle !== _isIdle) {
      _isIdle = nowIdle;
      document.body.classList.toggle('idle-state', nowIdle);
      // On an iPad, back in the car — the same car, after the garage, say — the rig chooses another section of the
      // paint, as it does on its own screen: ask for it (car-logos.js). A change of car asks, below.
      if (!nowIdle && (window._remoteMode || window._obsMode) && typeof requestRemoteLivery === 'function') requestRemoteLivery();
    }

    // Skip rest of update in idle (except settings remain responsive)
    // Moza hardware status must update even when idle — user may open
    // settings to configure hardware without being in a race session.
    if (window.updateMozaStatus) window.updateMozaStatus(p);

    if (_isIdle) return;

    // ─── Gear / Speed / RPM ───
    const gear = ds('DataCorePlugin.GameData.Gear', 'Demo.Gear') || 'N';
    const rpm = +d('DataCorePlugin.GameData.Rpms', 'Demo.Rpm') || 0;
    const maxRpm = +d('DataCorePlugin.GameData.CarSettings_MaxRPM', 'Demo.MaxRpm') || 1;
    const speed = +d('DataCorePlugin.GameData.SpeedMph', 'Demo.SpeedMph') || 0;

    const gearEl = document.getElementById('gearText');
    const rpmEl = document.getElementById('rpmText');
    const speedEl = document.getElementById('speedText');
    if (gearEl) gearEl.textContent = gear;
    if (rpmEl) rpmEl.textContent = rpm > 0 ? Math.round(rpm) : '0';
    if (speedEl) speedEl.textContent = speed > 0 ? Math.round(speed) : '0';
    // RPM ratio — server-computed (DS.RpmRatio), fallback to client math
    const rpmRatio = +(p[dsPre + 'RpmRatio']) || (maxRpm > 0 ? Math.min(1, rpm / maxRpm) : 0);
    updateTacho(rpmRatio);
    // Redline flash on entire tacho block
    const tachoBlock = document.querySelector('.tacho-block');
    if (tachoBlock) {
      if (rpmRatio >= 0.91) tachoBlock.classList.add('tacho-redline');
      else tachoBlock.classList.remove('tacho-redline');
    }

    // ─── Pedals — server-normalized (DS.ThrottleNorm etc.), fallback to client math ───
    let thr = +(p[dsPre + 'ThrottleNorm']);
    let brk = +(p[dsPre + 'BrakeNorm']);
    let clt = +(p[dsPre + 'ClutchNorm']);
    // Fallback: normalize client-side if server values not available
    if (!(thr >= 0)) {
      thr = +d('DataCorePlugin.GameData.Throttle', 'Demo.Throttle') || 0;
      while (thr > 1.01) thr /= 100;
      thr = Math.min(1, Math.max(0, thr));
    }
    if (!(brk >= 0)) {
      brk = +d('DataCorePlugin.GameData.Brake', 'Demo.Brake') || 0;
      while (brk > 1.01) brk /= 100;
      brk = Math.min(1, Math.max(0, brk));
    }
    if (!(clt >= 0)) {
      clt = +d('DataCorePlugin.GameData.Clutch', 'Demo.Clutch') || 0;
      while (clt > 1.01) clt /= 100;
      clt = Math.min(1, Math.max(0, clt));
    }

    // Auto-hide clutch for cars with autoclutch/DCT/no manual clutch pedal.
    // Only runs the DOM write on state transitions (_clutchHidden flips);
    // the DOM refs are cached the first time we need them and never
    // re-queried, so the hot path is just the `if (clt > 0.03)` check.
    if (clt > 0.03) _clutchSeenActive = true;
    if (!_clutchSeenActive && _pollFrame > 60 && speed > 10) {
      if (!_clutchHidden) {
        _clutchHidden = true;
        if (!_clutchLabelEl) _clutchLabelEl = document.getElementById('clutchLabelGroup');
        if (!_clutchLayerEl) _clutchLayerEl = document.querySelector('.clutch-layer');
        if (_clutchLabelEl) _clutchLabelEl.style.display = 'none';
        if (_clutchLayerEl) _clutchLayerEl.style.display = 'none';
      }
    } else if (_clutchSeenActive && _clutchHidden) {
      _clutchHidden = false;
      if (!_clutchLabelEl) _clutchLabelEl = document.getElementById('clutchLabelGroup');
      if (!_clutchLayerEl) _clutchLayerEl = document.querySelector('.clutch-layer');
      if (_clutchLabelEl) _clutchLabelEl.style.display = '';
      if (_clutchLayerEl) _clutchLayerEl.style.display = '';
    }

    // Push every sample — rAF gate in webgl-helpers coalesces to display rate
    renderPedalTrace(thr, brk, _clutchHidden ? 0 : clt);

    // ─── Pedal curve overlay (response curves from active profile) ───
    if (window.updatePedalCurves) window.updatePedalCurves(p);

    // Moza status update moved before idle return (see above)

    // ─── WebGL FX update ───
    if (window.updateGLFX) window.updateGLFX(rpmRatio, thr, brk, clt);
    // Post-processing pipeline — feed smoothed telemetry for screen effects
    if (window.updatePostFX) window.updatePostFX({
      speed: speed,
      rpm: rpmRatio,
      latG: +(p[dsPre + 'LatG']) || 0,
      longG: +(p[dsPre + 'LongG']) || 0,
      yawRate: +(p[dsPre + 'YawRate']) || 0,
      steer: Math.max(-1, Math.min(1, +(p['DataCorePlugin.GameRawData.Telemetry.SteeringWheelAngle']) || 0))
    });

    // ─── Fuel — bar shows current fuel vs full tank capacity ───
    const fuel = +d('DataCorePlugin.GameData.Fuel', 'Demo.Fuel') || 0;
    const maxFuel = +d('DataCorePlugin.GameData.MaxFuel', 'Demo.MaxFuel') || 0;
    // Bar percentage: current fuel / full tank capacity (not starting fuel)
    const fuelPct = maxFuel > 0 ? (fuel / maxFuel) * 100 : 0;
    const fuelRem = document.querySelector('.fuel-remaining');
    // Respect DisplayUnits for fuel label (0=imperial/gal, 1=metric/L)
    const _rawFuelUnits = p[dsPre + 'DisplayUnits'];
    const _fuelImperial = _rawFuelUnits !== '' && _rawFuelUnits != null && parseInt(_rawFuelUnits) === 0;
    const fuelDisplay = _fuelImperial ? fuel / 3.78541 : fuel;
    const fuelUnitLabel = _fuelImperial ? 'gal' : 'L';
    if (fuelRem) fuelRem.innerHTML = fuelDisplay > 0 ? fuelDisplay.toFixed(1) + ' <span class="unit">' + fuelUnitLabel + '</span>' : '— <span class="unit">' + fuelUnitLabel + '</span>';
    updateFuelBar(fuelPct, 0);

    const fuelPerLapRaw = _demo ? (+v('RacingDesk.Plugin.Demo.FuelPerLap') || 0) : (+v('DataCorePlugin.Computed.Fuel_LitersPerLap') || 0);
    const fuelPerLap = _fuelImperial ? fuelPerLapRaw / 3.78541 : fuelPerLapRaw;
    const fuelLapsEst = +(p[dsPre + 'FuelLapsRemaining']) || (fuelPerLapRaw > 0 ? fuel / fuelPerLapRaw : 0);
    const completedLaps = +(p[dsPre + 'CompletedLaps']) || 0;
    const fuelVals = document.querySelectorAll('.fuel-stats .val');
    if (fuelVals.length >= 2) {
      // Show "calculating..." during lap 1 when fuelPerLap hasn't stabilized yet
      if (fuelPerLap > 0) {
        fuelVals[0].textContent = fuelPerLap.toFixed(2);
      } else if (completedLaps < 2 && fuel > 0) {
        fuelVals[0].textContent = 'calc...';
      } else {
        fuelVals[0].textContent = '—';
      }
      // Fix #10: Show "—" instead of "0" when fuelPerLap is 0 (no data yet)
      fuelVals[1].textContent = fuelLapsEst > 0.1 ? fuelLapsEst.toFixed(1) : '—';
    }
    const pitSug = document.querySelector('.fuel-pit-suggest');
    if (pitSug) {
      const remLaps = +d('DataCorePlugin.GameData.RemainingLaps', 'Demo.RemainingLaps') || 0;
      pitSug.textContent = (fuelLapsEst > 0 && remLaps > 0 && fuelLapsEst < remLaps)
        ? 'PIT in ~' + Math.ceil(fuelLapsEst) + ' laps' : '';
    }

    // ─── Tyres ───
    // Tyre wear on the wire is tread remaining, 0..100 %, 100 = new, from the host, the SimHub plugin and the demo
    // alike (root CLAUDE.md, Tyre wear); null, or 0, is not measured. It is read as it is — nothing in the HUD
    // converts it — and the pit box's rings are where it is shown (pitbox.js). The tyre cells below are the old
    // panel's, which dashboard.html no longer has: updateTyreCell returns at once.
    const wearOf = (k) => { const x = p[k]; return x == null || x === '' || !(+x > 0) ? null : Math.max(0, Math.min(100, +x)); };
    const wearPct = (k) => { const w = wearOf(k); return w == null ? -1 : w; };
    if (_demo) {
      updateTyreCell(0, +v('RacingDesk.Plugin.Demo.TyreTempFL'), wearPct('RacingDesk.Plugin.Demo.TyreWearFL'));
      updateTyreCell(1, +v('RacingDesk.Plugin.Demo.TyreTempFR'), wearPct('RacingDesk.Plugin.Demo.TyreWearFR'));
      updateTyreCell(2, +v('RacingDesk.Plugin.Demo.TyreTempRL'), wearPct('RacingDesk.Plugin.Demo.TyreWearRL'));
      updateTyreCell(3, +v('RacingDesk.Plugin.Demo.TyreTempRR'), wearPct('RacingDesk.Plugin.Demo.TyreWearRR'));
    } else {
      updateTyreCell(0, +v('DataCorePlugin.GameData.TyreTempFrontLeft'), wearPct('DataCorePlugin.GameData.TyreWearFrontLeft'));
      updateTyreCell(1, +v('DataCorePlugin.GameData.TyreTempFrontRight'), wearPct('DataCorePlugin.GameData.TyreWearFrontRight'));
      updateTyreCell(2, +v('DataCorePlugin.GameData.TyreTempRearLeft'), wearPct('DataCorePlugin.GameData.TyreWearRearLeft'));
      updateTyreCell(3, +v('DataCorePlugin.GameData.TyreTempRearRight'), wearPct('DataCorePlugin.GameData.TyreWearRearRight'));
    }

    // ─── Controls (BB / TC / ABS) ───
    // Where the car is in the canonical list, the host says what it has and what each control reads — NONE, OFF,
    // a value, a mode — with the car's own label (RacingDesk.Plugin.CarControls; modules/js/car-controls.js).
    // Without it — another sim, a car the list does not have, the demo, a host from before there was a list —
    // the HUD goes by what it can see, as it always did.
    const carControls = _demo ? null : RacingDeskCarControls.read(p);
    const bb = _demo ? +v('RacingDesk.Plugin.Demo.BrakeBias') : (+v('DataCorePlugin.GameRawData.Telemetry.dcBrakeBias') || 0);
    const tc = _demo ? +v('RacingDesk.Plugin.Demo.TC') : p['DataCorePlugin.GameRawData.Telemetry.dcTractionControl'];
    const abs = _demo ? +v('RacingDesk.Plugin.Demo.ABS') : p['DataCorePlugin.GameRawData.Telemetry.dcABS'];
    const absActive = +v(dsPre + 'AbsActive') || 0;
    const tcActive  = +v(dsPre + 'TcActive')  || 0;
    const carModel = ds('DataCorePlugin.GameData.CarModel', 'Demo.CarModel');
    if (carModel !== _lastCarModel) {
      _tcSeen = false; _absSeen = false;
      _lastCarModel = carModel;
      _carAdj = getCarAdjustability(carModel);
      setCarLogo(detectMfr(carModel), carModel);
      // On an iPad the crop of the car's paint behind the badge is the rig's to choose; the page asks for it
      // (car-logos.js). In the app the main process sends it of its own accord.
      if ((window._remoteMode || window._obsMode) && typeof requestRemoteLivery === 'function') requestRemoteLivery();
      // Track car usage for driver profile heatmap
      if (carModel && !_demo && typeof recordCarSession === 'function') recordCarSession(carModel);
    }

    // The latest car, track and game on window, for anything that wants them without polling p[].
    // Pattern matches `window._currentGameId` above.
    window._currentCarModel = carModel || null;
    window._currentTrackName = ds('DataCorePlugin.GameData.TrackName', 'Demo.TrackName') || null;
    window._currentIsDemo = _demo;
    if (_demo) { _tcSeen = true; _absSeen = true; }
    else {
      // Once we see any valid value (even 0), the car has this system
      if (tc != null && +tc >= 0) _tcSeen = true;
      if (abs != null && +abs >= 0) _absSeen = true;
    }
    if (!_carControlsPanel) _carControlsPanel = document.querySelector('.car-controls');
    if (carControls) {
      // The list's word: each of the three as NONE, OFF, ON, a value or its mode; the car's other controls in a
      // row under them; DRS and push-to-pass with the spotter's word when they change.
      window._carControlsView = RacingDeskCarControls.render(_carControlsPanel, carControls, {
        flash: flashCtrlBar,
        announce: (id, value, direction, label, text) => { if (window.announceAdjustment) window.announceAdjustment(id, value, direction, label, text); },
        say: (s) => { if (typeof _showSpotterMsg === 'function') _showSpotterMsg(s.msg, s.severity, s.header, s.category); },
      }, _carControlsState);
    } else {
    if (_carControlsState.car) { RacingDeskCarControls.clear(_carControlsPanel, _carControlsState); window._carControlsView = null; }
    // If car is in the no-adjust list, hide the module entirely for absent systems
    // tcNoAdjust / absNoAdjust: electronic exists but isn't driver-adjustable → show "Fixed" + flash when active
    // Adjustable car with value 0 → driver turned it off → show "Off"
    const tcOk = _demo || (_carAdj && _carAdj.noTC ? false : (_tcSeen || (_carAdj && _carAdj.tcNoAdjust && tcActive > 0)));
    const absOk = _demo || (_carAdj && _carAdj.noABS ? false : (_absSeen || (_carAdj && _carAdj.absNoAdjust && absActive > 0)));
    const bbOk = _demo || (_carAdj && _carAdj.noBB ? false : (bb > 0));
    setCtrlVisibility(bbOk, tcOk, absOk);

    const bbEl = document.querySelector('#ctrlBB .ctrl-value');
    if (bbEl && bbOk) { bbEl.textContent = bb > 0 ? bb.toFixed(1) : '—'; document.getElementById('ctrlBB').style.setProperty('--ctrl-pct', (bb > 0 ? Math.min(100, ((bb-30)/40)*100) : 0) + '%'); }
    if (tcOk) {
      const el = document.querySelector('#ctrlTC .ctrl-value');
      const tcBox = document.getElementById('ctrlTC');
      if (el) {
        if (_carAdj && _carAdj.tcNoAdjust) {
          // TC exists but not adjustable — show "Fixed", flash when active
          el.textContent = 'Fixed';
          el.classList.add('ctrl-value-fixed');
          tcBox.style.setProperty('--ctrl-pct', tcActive > 0 ? '100%' : '0%');
        } else if (+tc === 0) {
          el.textContent = 'Off';
          el.classList.remove('ctrl-value-fixed');
          tcBox.style.setProperty('--ctrl-pct', '0%');
        } else {
          el.textContent = Math.round(+tc);
          el.classList.remove('ctrl-value-fixed');
          tcBox.style.setProperty('--ctrl-pct', Math.min(100, (+tc/12)*100) + '%');
        }
      }
    }
    if (absOk) {
      const el = document.querySelector('#ctrlABS .ctrl-value');
      const absBox = document.getElementById('ctrlABS');
      if (el) {
        if (_carAdj && _carAdj.absNoAdjust) {
          // ABS exists but not adjustable — show "Fixed", flash when active
          el.textContent = 'Fixed';
          el.classList.add('ctrl-value-fixed');
          absBox.style.setProperty('--ctrl-pct', absActive > 0 ? '100%' : '0%');
        } else if (+abs === 0) {
          el.textContent = 'Off';
          el.classList.remove('ctrl-value-fixed');
          absBox.style.setProperty('--ctrl-pct', '0%');
        } else {
          el.textContent = Math.round(+abs);
          el.classList.remove('ctrl-value-fixed');
          absBox.style.setProperty('--ctrl-pct', Math.min(100, (+abs/12)*100) + '%');
        }
      }
    }
    // Flash control bars on value change + announce via spotter
    if (_prevBB >= 0 && bb > 0 && Math.abs(bb - _prevBB) > 0.05) {
      flashCtrlBar('ctrlBB');
      if (window.announceAdjustment) window.announceAdjustment('bb', bb, bb > _prevBB ? 1 : -1);
    }
    if (_prevTC >= 0 && +tc !== _prevTC) {
      flashCtrlBar('ctrlTC');
      if (window.announceAdjustment) window.announceAdjustment('tc', +tc, +tc > _prevTC ? 1 : -1);
    }
    if (_prevABS >= 0 && +abs !== _prevABS) {
      flashCtrlBar('ctrlABS');
      if (window.announceAdjustment) window.announceAdjustment('abs', +abs, +abs > _prevABS ? 1 : -1);
    }
    if (bb > 0) _prevBB = bb;
    if (tcOk) _prevTC = +tc;
    if (absOk) _prevABS = +abs;
    }   // not from the list

    // TC / ABS active flash — runs on main dashboard, not gated behind datastream visibility. For every car, the
    // list's and not: the glow says the aid is cutting in, which no list can say. (datastream.js sets the same
    // class while it runs; where this was skipped for a listed car, a glow it left on had nothing to clear it.)
    const tcBoxEl = document.getElementById('ctrlTC');
    const absBoxEl = document.getElementById('ctrlABS');
    if (tcActive > 0) _tcFlashFrames = 8;
    if (absActive > 0) _absFlashFrames = 8;
    if (tcBoxEl) { tcBoxEl.classList.toggle('ctrl-active', _tcFlashFrames > 0); if (_tcFlashFrames > 0) _tcFlashFrames--; }
    if (absBoxEl) { absBoxEl.classList.toggle('ctrl-active', _absFlashFrames > 0); if (_absFlashFrames > 0) _absFlashFrames--; }

    // ─── Manufacturer country flag trigger ───
    // Shows 5-second aurora wisps in manufacturer's country colors on:
    //   Practice: leaving pit lane (entering the car)
    //   Qualifying: first timed lap (completedLaps 0 → 1)
    //   Race: green lights (Grid.SessionState transitions to 4)
    if (window.showMfrFlag && _currentCarLogo && _currentCarLogo !== 'generic' && _currentCarLogo !== 'none') {
      const isPractice = sessionMode === 1 || sessionMode === 3;
      const isQuali = sessionMode === 2;
      const isRace = sessionMode === 4;

      let shouldFire = false;

      // Practice: pit → track transition
      if (isPractice && _mfrFlagPrevInPit && !_inPitLane) {
        shouldFire = true;
      }
      // Qualifying: first completed lap (outlap done, first timed lap begins)
      if (isQuali && _mfrFlagPrevCompletedLaps === 0 && completedLaps === 1) {
        shouldFire = true;
      }
      // Race: green lights — Grid.SessionState transitions from parade (3) to racing (4)
      if (isRace && _mfrFlagPrevSessState === 3 && sessNum === 4) {
        shouldFire = true;
      }

      // Reset flag when session changes (new practice/quali/race)
      if (sessNum !== _mfrFlagPrevSessState && (sessNum === 1 || sessNum === 2 || sessNum === 3)) {
        _mfrFlagShownThisSession = false;
      }

      if (shouldFire && !_mfrFlagShownThisSession) {
        _mfrFlagShownThisSession = true;
        const countryCode = _mfrCountry[_currentCarLogo];
        if (countryCode && _countryFlags[countryCode]) {
          const fc = _countryFlags[countryCode];
          window.showMfrFlag(fc[0], fc[1], fc[2]);
        }
      }

      _mfrFlagPrevSessState = sessNum;
      _mfrFlagPrevInPit = _inPitLane;
      _mfrFlagPrevCompletedLaps = completedLaps;
    }

    // ─── Position / Lap / Current Lap Time ───
    // Snapshot previous position BEFORE it gets overwritten (used by grid viz)
    const _vizSnapPrevPos = _lastPosition;
    const pos = +d('DataCorePlugin.GameData.Position', 'Demo.Position') || 0;
    const lap = +d('DataCorePlugin.GameData.CurrentLap', 'Demo.CurrentLap') || 0;
    const bestLap = +d('DataCorePlugin.GameData.BestLapTime', 'Demo.BestLapTime') || 0;
    // Parse CurrentLapTime robustly — SimHub may send this as a number
    // (seconds), a TimeSpan string ("00:01:23.456"), or null. Fall back
    // to iRacing raw telemetry LapCurrentLapTime if GameData fails.
    const curLapTime = _demo
      ? (+(p['RacingDesk.Plugin.Demo.CurrentLapTime']) || 0)
      : (_parseTimeValue(p['DataCorePlugin.GameData.CurrentLapTime'])
         || +(p['DataCorePlugin.GameRawData.Telemetry.LapCurrentLapTime']) || 0);
    // (data-digits is how many the place has: the glance layout sizes the number to fit P4 and P12 alike)
    const posDigits = pos > 0 ? ('' + pos).length : 1;
    document.querySelectorAll('.pos-number').forEach(el => {
      const sp = el.querySelector('.skew-accent');
      if (sp) sp.textContent = pos > 0 ? 'P' + pos : 'P—';
      if (el.getAttribute('data-digits') !== '' + posDigits) el.setAttribute('data-digits', '' + posDigits);
    });
    // The delta: the gap to his best lap of this session, worked out from his own laps (lap-delta.js); before he has
    // one, iRacing's gap to his best lap ever in this car here (DS.LapDelta), which is what the plugin sends and is
    // there from the first lap. Each is labelled with what it is against, a minus and green when he is gaining, a plus
    // and red when he is losing.
    const allTimeDelta = +(p[dsPre + 'LapDelta']) || 0;
    const _trackPct = +(p[dsPre + 'TrackPct']);
    const _bounds = ('' + (p[dsPre + 'SectorBoundaryPcts'] || '')).split(',').map(Number).filter((x) => x > 0 && x < 1);
    if (_bounds.length === 0) {
      const s2 = +(p[dsPre + 'SectorS2StartPct']) || 0, s3 = +(p[dsPre + 'SectorS3StartPct']) || 0;
      if (s2 > 0) _bounds.push(s2);
      if (s3 > s2) _bounds.push(s3);
    }
    // The same boundaries colour the circuit's sectors on the map (webgl-helpers.js splits the outline by them, in a
    // race and out of one): the session's own, never equal fractions.
    if (_bounds.length > 0 && String(window._sectorBoundaries) !== String(_bounds)) window._sectorBoundaries = _bounds;
    _lapDeltaTracker.feed({
      session: _currSessionTypeName + '|' + (vs('RacingDesk.Plugin.TrackMap.TrackName') || vs('DataCorePlugin.GameData.TrackName')),
      pct: isFinite(_trackPct) ? _trackPct : NaN,
      t: curLapTime,
      clean: !_inPitLane && !(+(p[dsPre + 'IsLapInvalid']) > 0),
      boundaries: _bounds,
    });
    const _deltaView = _lapDeltaTracker.view();
    const _delta = curLapTime > 0.5 ? RacingDeskLapDelta.pick(_deltaView, allTimeDelta) : null;
    const _deltaShown = _delta ? RacingDeskLapDelta.format(_delta.value) : { text: '', cls: '' };
    const lapDelta = _delta ? _delta.value : 0;
    window._lapDeltaView = { shown: _delta, view: _deltaView, allTime: allTimeDelta || null };
    document.querySelectorAll('.pos-meta-row .val').forEach(el => {
      const row = el.closest('.pos-meta-row');
      if (row.classList.contains('delta-row')) {
        if (el.textContent !== _deltaShown.text) el.textContent = _deltaShown.text;
        const cls = 'val' + (_deltaShown.cls ? ' ' + _deltaShown.cls : '');
        if (el.className !== cls) el.className = cls;
        const ref = row.querySelector('.delta-ref');
        const label = _delta ? _delta.label : '';
        if (ref && ref.textContent !== label) ref.textContent = label;
      } else if (row.classList.contains('current-row')) {
        // Current lap time (no delta appended — that's in the delta row now)
        if (curLapTime > 0.5) {
          el.textContent = fmtLap(curLapTime);
          el.classList.remove('purple', 'green');
          if (_delta && lapDelta < 0) el.classList.add('green');
        } else {
          // Between laps: show best lap for reference
          el.textContent = bestLap > 0 ? fmtLap(bestLap) : '—:——.———';
          const sb = window._sessionBestLap || 0;
          const isSessionBest = bestLap > 0 && sb > 0 && Math.abs(bestLap - sb) < 0.05;
          el.classList.remove('purple', 'green');
          if (bestLap > 0) el.classList.add(isSessionBest ? 'purple' : 'green');
        }
        row.style.textAlign = 'left';
      }
      else el.textContent = lap > 0 ? lap : '—';
    });
    if (pos !== _lastPosition && _lastPosition > 0 && pos > 0) {
      document.querySelectorAll('.pos-number').forEach(el => flashElement(el, pos < _lastPosition ? 'ahead-changed' : 'behind-changed'));
      // WebGL leaderboard event animation on position change
      if (window.triggerLBEvent) {
        if (pos === 1 && pos < _lastPosition) {
          window.triggerLBEvent('p1');   // P1 gold celebration
        } else {
          window.triggerLBEvent(pos < _lastPosition ? 'gain' : 'lose');
        }
      }
    }
    // Start position — prefer server-computed, fallback to client-side
    const serverStartPos = +(p[dsPre + 'StartPosition']) || 0;
    if (serverStartPos > 0) _startPosition = serverStartPos;
    else if (_startPosition === 0 && pos > 0) _startPosition = pos;
    _lastPosition = pos;
    // Position delta indicator — prefer server-computed DS.PositionDelta
    document.querySelectorAll('.pos-delta').forEach(el => {
      const delta = +(p[dsPre + 'PositionDelta']) || (_startPosition > 0 && pos > 0 ? _startPosition - pos : 0);
      if (delta > 0) {
        el.textContent = '▲ ' + delta;
        el.className = 'pos-delta visible delta-up';
      } else if (delta < 0) {
        el.textContent = '▼ ' + Math.abs(delta);
        el.className = 'pos-delta visible delta-down';
      } else {
        el.textContent = '';
        el.className = 'pos-delta delta-same';
      }
    });
    // Update player highlight: 0=blue(same), 1=green(ahead), 2=red(behind), 3=gold(P1)
    if (window.setLBHighlightMode) {
      if (pos === 1) {
        window.setLBHighlightMode(3);
      } else if (_startPosition > 0 && pos > 0) {
        if (pos < _startPosition) window.setLBHighlightMode(1);      // ahead of start
        else if (pos > _startPosition) window.setLBHighlightMode(2); // behind start
        else window.setLBHighlightMode(0);                           // same as start
      } else {
        window.setLBHighlightMode(0);
      }
    }

    // ─── Race Timer + Last Lap + End-of-Race Logic ───
    const sessionTime = +d('DataCorePlugin.GameData.SessionTimeSpan', 'Demo.SessionTime') || 0;
    const lastLapTime = +d('DataCorePlugin.GameData.LastLapTime', 'Demo.LastLapTime') || 0;
    const remTime = +d('DataCorePlugin.GameData.RemainingTime', 'Demo.RemainingTime') || 0;
    const totalLaps = +d('DataCorePlugin.GameData.TotalLaps', 'Demo.TotalLaps') || 0;
    const remLaps = +d('DataCorePlugin.GameData.RemainingLaps', 'Demo.RemainingLaps') || 0;
    const timerEl = document.getElementById('raceTimerValue');
    const timerRow = document.querySelector('.timer-row');
    const isPracticeTimer = sessionMode === 1 || sessionMode === 3; // Practice or Warmup
    const isQualiTimer = sessionMode === 2;
    const isNonRaceTimer = isPracticeTimer || isQualiTimer;
    // Determine if this is a lap-limited race (not timed)
    const isLapRace = +(p[dsPre + 'IsLapRace']) > 0;
    // Read current sector early — needed for lap-race timer popup on sector transitions
    const timerCurSector = +(p[dsPre + 'CurrentSector']) || 1;

    // In the glance layout the clock cell says what it shows (drive-view.css); on the rig it is just the time.
    const driveClock = document.body.classList.contains('drive-mode-active');
    let clockKey = '';
    if (timerEl) {
      if (isPracticeTimer) {
        clockKey = 'Clock';
        // Practice: show local wall clock time (12-hour format)
        const now = new Date();
        let hours = now.getHours();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;
        const mins = now.getMinutes();
        timerEl.textContent = hours + ':' + (mins < 10 ? '0' : '') + mins + ' ' + ampm;
      } else if (isLapRace && !isNonRaceTimer) {
        // Lap-limited race: show current lap time instead of useless 168:00:00 countdown. The glance layout has the
        // time on this lap in its hero already, so its clock says the laps to go.
        if (driveClock && remLaps >= 1) { timerEl.textContent = '' + remLaps; clockKey = 'Laps to go'; }
        else if (remLaps === 1) timerEl.textContent = 'Final Lap';
        else if (remLaps === 0) { timerEl.textContent = 'Finish'; clockKey = 'Flag'; }
        else if (curLapTime > 0) {
          const lm = Math.floor(curLapTime / 60);
          const ls = curLapTime % 60;
          timerEl.textContent = (lm > 0 ? lm + ':' : '') + (lm > 0 && ls < 10 ? '0' : '') + ls.toFixed(1);
        } else {
          timerEl.textContent = '0.0';
        }
      } else if (isQualiTimer) {
        clockKey = 'Time left';
        // Qualifying: show remaining session time
        const serverFmt = p[dsPre + 'RemainingTimeFormatted'] || '';
        if (serverFmt) {
          timerEl.textContent = serverFmt;
        } else if (remTime > 0) {
          const m = Math.floor(remTime / 60);
          const s = Math.floor(remTime % 60);
          timerEl.textContent = m + ':' + (s < 10 ? '0' : '') + s;
        } else {
          timerEl.textContent = '0:00';
        }
      } else {
        clockKey = 'Time left';
        // Timed race: show remaining time
        const serverFmt = p[dsPre + 'RemainingTimeFormatted'] || '';
        if (serverFmt) {
          timerEl.textContent = serverFmt;
        } else {
          const displayTime = remTime > 0 ? remTime : sessionTime;
          if (displayTime > 0) {
            const h = Math.floor(displayTime / 3600);
            const m = Math.floor((displayTime % 3600) / 60);
            const s = Math.floor(displayTime % 60);
            timerEl.textContent = h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
          } else {
            timerEl.textContent = '0:00:00';
          }
        }
      }
    }
    const clockKeyEl = document.getElementById('raceTimerKey');
    if (clockKeyEl && clockKeyEl.dataset.k !== clockKey) { clockKeyEl.dataset.k = clockKey; clockKeyEl.textContent = clockKey; }
    const lastLapEl = document.getElementById('lastLapTimeValue');
    if (lastLapEl) { lastLapEl.textContent = fmtLap(lastLapTime); }

    // ── Timer visibility logic ──
    // Lap-limited races: pop up on sector transitions and lap changes, auto-hide between
    const sectorChanged = timerCurSector !== _prevTimerSector && _prevTimerSector > 0;
    _prevTimerSector = timerCurSector;

    if (isLapRace && !isNonRaceTimer && timerRow) {
      // Show on sector transition or lap change
      if (sectorChanged || (lap > 0 && lap !== _prevLap && _prevLap > 0)) {
        timerRow.classList.add('timer-visible');
        showPositionPage();
        if (_timerHideTimeout) clearTimeout(_timerHideTimeout);
        if (!_timerPinned) {
          _timerHideTimeout = setTimeout(() => {
            if (!_timerPinned) timerRow.classList.remove('timer-visible');
          }, 10000); // 10s visibility per sector popup
        }
      }
    } else if (!isNonRaceTimer) {
      // Timed race: show on lap change, auto-hide after 30s
      if (lap > 0 && lap !== _prevLap && _prevLap > 0 && timerRow) {
        timerRow.classList.add('timer-visible');
        showPositionPage();
        if (_timerHideTimeout) clearTimeout(_timerHideTimeout);
        if (!_timerPinned) {
          _timerHideTimeout = setTimeout(() => {
            if (!_timerPinned) timerRow.classList.remove('timer-visible');
          }, 30000);
        }
      }
    }

    // ── Lap validity from plugin (single source of truth) ──
    _lapInvalid = +(p[dsPre + 'IsLapInvalid']) > 0;

    _prevLap = lap;

    // End-of-race: pin timer visible for final 3 laps or final 5 minutes
    const serverEndOfRace = +(p[dsPre + 'IsEndOfRace']) > 0;  // checkered flag
    const isEndOfRace = serverEndOfRace || (isLapRace
      ? (remLaps > 0 && remLaps <= 3)     // final 3 laps for lap races
      : (remTime > 0 && remTime <= 300)); // final 5 minutes for timed races
    if (isEndOfRace && timerRow) {
      _timerPinned = true;
      showPositionPage();
      if (_timerHideTimeout) { clearTimeout(_timerHideTimeout); _timerHideTimeout = null; }
      timerRow.classList.add('timer-visible');
    } else if (_timerPinned && !isEndOfRace) {
      _timerPinned = false; // race ended or data reset
    }

    // Non-race sessions (qualifying, practice): always keep timer visible
    if (isNonRaceTimer && timerRow) {
      timerRow.classList.add('timer-visible');
    }

    // ─── iRating / Safety ───
    // Priority: manual entry (always wins when set) → telemetry
    let ir = window._manualIRating > 0 ? window._manualIRating
      : (_demo ? (+v('RacingDesk.Plugin.Demo.IRating') || 0) : (+v('IRacingExtraProperties.iRacing_DriverInfo_IRating') || 0));
    let sr = window._manualSafetyRating > 0 ? window._manualSafetyRating
      : (_demo ? (+v('RacingDesk.Plugin.Demo.SafetyRating') || 0) : (+v('IRacingExtraProperties.iRacing_DriverInfo_SafetyRating') || 0));
    _hasRatingData = (ir > 0 || sr > 0);

    // Initial rating backfill (one-time on first connection)
    if (typeof window.initialRatingSync === 'function') {
      window.initialRatingSync(p, _demo);
    }

    const ratVals = document.querySelectorAll('.rating-value');
    if (ratVals.length >= 2) { ratVals[0].textContent = ir > 0 ? (ir >= 1000 ? (ir / 1000).toFixed(1) + 'k' : String(ir)) : '—'; ratVals[1].textContent = sr > 0 ? sr.toFixed(2) : '—'; }
    updateIRBar(ir);
    updateSRPie(sr);

    // ─── Estimated iRating Delta ───
    // Fix #3: Server sends int.MinValue (-2147483648) as sentinel for "no data".
    // Distinguish that from an actual delta of 0 (perfectly average finish).
    const irDeltaRaw = +(p[dsPre + 'EstimatedIRatingDelta']);
    const IR_NO_DATA = -2147483648;
    const irDeltaHasData = !isNaN(irDeltaRaw) && irDeltaRaw !== IR_NO_DATA;
    const irDelta = irDeltaHasData ? irDeltaRaw : 0;
    window._lastIRDelta = irDelta; // expose for driver profile modal
    const ratDeltas = document.querySelectorAll('.rating-delta');
    if (ratDeltas.length >= 1) {
      const el = ratDeltas[0];
      if (irDeltaHasData && ir > 0) {
        el.textContent = (irDelta > 0 ? '+' : '') + irDelta;
        el.className = 'rating-delta ' + (irDelta > 0 ? 'positive' : irDelta < 0 ? 'negative' : 'neutral');
      } else {
        el.textContent = '—';
        el.className = 'rating-delta';
      }
    }
    // SR delta: show manual license letter if set, otherwise derive from SR value
    if (ratDeltas.length >= 2) {
      const srEl = ratDeltas[1];
      const lic = window._manualLicense || '';
      if (lic) {
        srEl.textContent = lic === 'R' ? 'R' : lic === 'P' ? 'Pro' : lic;
        srEl.className = 'rating-delta';
      } else if (sr > 0) {
        srEl.textContent = sr >= 3.0 ? 'A' : sr >= 2.0 ? 'B' : sr >= 1.0 ? 'C' : 'D';
        srEl.className = 'rating-delta';
      } else {
        srEl.textContent = '—';
        srEl.className = 'rating-delta';
      }
    }

    // ─── Gaps / Lap Timing ───
    const nonRace = sessionMode >= 1 && sessionMode <= 3; // Practice, Qualifying, or Warmup

    const gapLabels = document.querySelectorAll('.gaps-block .panel-label');
    const gapTimes = document.querySelectorAll('.gap-time');
    const gapDrivers = document.querySelectorAll('.gap-driver');
    const gapIRs = document.querySelectorAll('.gap-ir');
    const gapItems = document.querySelectorAll('.gap-item');

    if (nonRace) {
      // ── Non-race: show F1-style sector indicator (data from plugin SectorTracker) ──
      const sectorEl = document.getElementById('sectorIndicator');
      const gapAhead = document.getElementById('gapAheadItem');
      const gapBehind = document.getElementById('gapBehindItem');
      if (sectorEl) sectorEl.style.display = '';
      if (gapAhead) gapAhead.style.display = 'none';
      if (gapBehind) gapBehind.style.display = 'none';

      const curSector = +(p[dsPre + 'CurrentSector']) || 1;
      // The sector he is in is coloured by the same gap the HUD shows (see the delta, above).
      const sectorDelta = _delta ? _delta.value : 0;

      // Sector count: iRacing's SplitTimeInfo, via the plugin
      const sectorCount = +(p[dsPre + 'SectorCount']) || +(p['RacingDesk.Plugin.DS.SectorCount']) || 0;

      // Build sector arrays from plugin data (pad to sectorCount)
      const splits = [], deltas = [], states = [];
      for (let si = 1; si <= sectorCount; si++) {
        splits.push(+(p[dsPre + 'SectorSplitS' + si]) || 0);
        deltas.push(+(p[dsPre + 'SectorDeltaS' + si]) || 0);
        states.push(+(p[dsPre + 'SectorStateS' + si]) || 0);
      }
      // state: 0=none, 1=pb (session best / purple), 2=faster (green), 3=slower (yellow)
      const stateClass = ['', 'sector-pb', 'sector-faster', 'sector-slower'];

      // Store for track map sector coloring (the boundaries the map splits by are the session's own, set above)
      window._sectorData = { curSector, splits, deltas, states, sectorCount };

      // Read current lap time for live sector elapsed
      const currentLapTime = _demo
        ? (+(p['RacingDesk.Plugin.Demo.CurrentLapTime']) || 0)
        : (+(p['DataCorePlugin.GameData.CurrentLapTime']) || 0);

      // ── Dynamic sector cell management ──
      // Ensure sectorIndicator has the right number of cells (label only — no times)
      if (sectorEl) {
        const existing = sectorEl.querySelectorAll('.sector-cell');
        if (existing.length !== sectorCount) {
          sectorEl.innerHTML = '';
          for (let i = 1; i <= sectorCount; i++) {
            const cell = document.createElement('div');
            cell.className = 'sector-cell';
            cell.id = 'sector' + i;
            cell.innerHTML = '<div class="sector-label">S' + i + '</div>';
            sectorEl.appendChild(cell);
          }
        }
      }

      // Color mapping: green = my best, yellow = worse than my best, red = invalid
      // No purple — we don't have "best of everyone on track" data
      // state: 0=none, 1=pb (treat as green), 2=faster (green), 3=slower (yellow)
      const sectorColorClass = ['', 'sector-faster', 'sector-faster', 'sector-slower'];

      for (let si = 1; si <= sectorCount; si++) {
        const cell = document.getElementById('sector' + si);
        if (!cell) continue;

        cell.classList.remove('sector-pb', 'sector-faster', 'sector-slower', 'sector-invalid', 'sector-active');

        // If lap is invalid (incident occurred), mark all sectors red
        if (_lapInvalid) {
          cell.classList.add('sector-invalid');
        }

        if (si === curSector) {
          cell.classList.add('sector-active');
          // Live delta coloring on active sector
          if (!_lapInvalid && sectorDelta !== 0) {
            cell.classList.add(sectorDelta < 0 ? 'sector-faster' : 'sector-slower');
          }
        } else if (states[si - 1] > 0) {
          // Completed sector with a new performance state — apply and cache it
          if (!_lapInvalid) {
            const cls = sectorColorClass[states[si - 1]];
            if (cls) cell.classList.add(cls);
          }
          _prevSectorStates[si - 1] = states[si - 1];
        } else if (_prevSectorStates[si - 1] > 0) {
          // No new state yet (e.g. new lap, splits cleared) — retain previous color
          if (!_lapInvalid) {
            const cls = sectorColorClass[_prevSectorStates[si - 1]];
            if (cls) cell.classList.add(cls);
          }
        }
      }

      // Cache this poll's splits so next poll can distinguish a real final
      // sector from a bogus cumulative time (iRacing clears splits on lap cross)
      _prevSectorSplits = splits.slice();

      _gapsNonRaceMode = true;
    } else {
      // ── Race: show ahead / behind gaps ──
      if (_gapsNonRaceMode) {
        // Restore gaps, hide sectors
        if (gapLabels.length >= 2) { gapLabels[0].textContent = 'Ahead'; gapLabels[1].textContent = 'Behind'; }
        const sectorEl = document.getElementById('sectorIndicator');
        const gapAhead = document.getElementById('gapAheadItem');
        const gapBehind = document.getElementById('gapBehindItem');
        if (sectorEl) sectorEl.style.display = 'none';
        if (gapAhead) gapAhead.style.display = '';
        if (gapBehind) gapBehind.style.display = '';
        // Clear sector map highlights (dynamic N-sector support)
        window._sectorData = null;
        const mapSectorEls = document.querySelectorAll('.map-sector');
        mapSectorEls.forEach(el => el.setAttribute('stroke', 'transparent'));
        _gapsNonRaceMode = false;
        _gapsWorstLap = 0;
        _gapsLastLap = 0;
      }
      const gAhead  = _demo ? (+v('RacingDesk.Plugin.Demo.GapAhead') || 0)  : (+v('IRacingExtraProperties.iRacing_Opponent_Ahead_Gap') || 0);
      const gBehind = _demo ? (+v('RacingDesk.Plugin.Demo.GapBehind') || 0) : (+v('IRacingExtraProperties.iRacing_Opponent_Behind_Gap') || 0);
      const dAhead  = _demo ? vs('RacingDesk.Plugin.Demo.DriverAhead')  : vs('IRacingExtraProperties.iRacing_Opponent_Ahead_Name');
      const dBehind = _demo ? vs('RacingDesk.Plugin.Demo.DriverBehind') : vs('IRacingExtraProperties.iRacing_Opponent_Behind_Name');
      const irA     = _demo ? (+v('RacingDesk.Plugin.Demo.IRAhead') || 0)   : (+v('IRacingExtraProperties.iRacing_Opponent_Ahead_IRating') || 0);
      const irB     = _demo ? (+v('RacingDesk.Plugin.Demo.IRBehind') || 0)  : (+v('IRacingExtraProperties.iRacing_Opponent_Behind_IRating') || 0);
      if (gapTimes.length >= 2) { gapTimes[0].textContent = (gAhead && Math.abs(gAhead) >= 0.05) ? fmtGap(-Math.abs(gAhead)) : '—'; gapTimes[1].textContent = (gBehind && Math.abs(gBehind) >= 0.05) ? fmtGap(Math.abs(gBehind)) : '—'; }
      if (gapDrivers.length >= 2) { gapDrivers[0].textContent = dAhead || '—'; gapDrivers[1].textContent = dBehind || '—'; }
      if (gapIRs.length >= 2) { gapIRs[0].textContent = irA > 0 ? irA + ' iR' : ''; gapIRs[1].textContent = irB > 0 ? irB + ' iR' : ''; }
      if (gapIRs.length >= 2) {
        const trend = _gapTrend.update(lap, dAhead, gAhead, dBehind, gBehind);
        _sayTrend(0, gapIRs[0], trend.ahead);
        _sayTrend(1, gapIRs[1], trend.behind);
      }
      if (gapItems.length >= 2) {
        if (dAhead !== _lastDriverAhead && _lastDriverAhead) flashElement(gapItems[0], 'ahead-changed');
        if (dBehind !== _lastDriverBehind && _lastDriverBehind) flashElement(gapItems[1], 'behind-changed');
      }
      _lastDriverAhead = dAhead; _lastDriverBehind = dBehind;
    }

    // ─── Flag Status → Gaps Block ───
    // iRacing's own flag field, where the host sends it (session-flags.js): it tells a local yellow from a full-course
    // caution, and says one lap to green, green held, the black flag furled and disqualified. With no field in the payload
    // (a plugin from before it, a replay, a sim that does not say, the demo) the one word it always sent is all there is.
    const rawFlag = (_forceFlagState && _demo) ? _forceFlagState : (vs('currentFlagState') || 'none');
    const flagWord = (!rawFlag || rawFlag === '0' || rawFlag === 0) ? 'none' : rawFlag;
    const flagField = (window.RacingDeskSessionFlags && !_demo) ? window.RacingDeskSessionFlags.read(p) : null;
    const flagDetail = flagField === null ? null : window.RacingDeskSessionFlags.decode(flagField);
    const flagState = flagDetail ? window.RacingDeskSessionFlags.flagOf(flagDetail, flagWord) : flagWord;
    const isGreenFlag = (f) => f === 'green' || f === 'greenheld';
    // The small things the field says — ten and five to go, halfway — are said once each, as the spotter says its calls.
    if (_flagNotices) {
      for (const note of _flagNotices.update(flagDetail)) {
        if (typeof _showSpotterMsg === 'function') _showSpotterMsg(note.text, 'sp-clear', 'Race control', 'flag-' + note.id);
      }
    }
    const gapsBlock = document.getElementById('gapsBlock');
    if (gapsBlock) {
      const flagLabels = {
        yellow: 'CAUTION', caution: 'CAUTION', localyellow: 'LOCAL YELLOW', onetogreen: '1 LAP TO GREEN', red: 'RED FLAG', blue: 'BLUE FLAG',
        white: 'LAST LAP', debris: 'DEBRIS', checkered: 'FINISH', black: 'BLACK FLAG', furled: 'BLACK FLAG WARNING', disqualify: 'DISQUALIFIED',
        green: 'GREEN', greenheld: 'GREEN HELD', meatball: 'MEATBALL', orange: 'LAPPED CAR',
      };
      const flagContexts = {
        yellow: 'Full course caution — hold position', caution: 'Full course caution — hold position',
        localyellow: 'Local yellow — slow in this sector', onetogreen: 'Green flag next lap — be ready',
        red: 'Session stopped — return to pits', blue: 'Faster car approaching — yield', white: 'Last lap — push to the line',
        debris: 'Debris on track — stay alert', checkered: 'Checkered flag — race complete', black: 'Penalty — report to pit lane',
        furled: 'Warning — a black flag may follow', disqualify: 'Disqualified — return to the pits',
        green: 'Green flag — racing resumes', greenheld: 'Green flag held — racing resumes', meatball: 'Repair required — pit immediately',
        orange: 'Car ahead must yield — make the pass',
      };

      // Minimum hold durations per flag type (ms) — prevents flicker from rapid state changes (a local yellow comes and
      // goes with the sector he is in, so it is held the shortest)
      const FLAG_HOLD_MS = {
        yellow: 8000, caution: 8000, localyellow: 3000, onetogreen: 6000, red: 10000, blue: 4000, white: 6000, debris: 5000,
        checkered: 10000, black: 8000, furled: 8000, disqualify: 10000, green: 5000, greenheld: 5000, meatball: 10000, orange: 4000,
      };

      let showFlag = flagState;
      const now = Date.now();

      // When a new flag appears, set minimum hold time
      if (flagState !== 'none' && flagState !== _flagHoldState) {
        _flagHoldState = flagState;
        _flagHoldUntil = now + (FLAG_HOLD_MS[flagState] || 5000);
      }

      // Green flag: show briefly when transitioning from caution, then clear
      if (isGreenFlag(flagState) && !isGreenFlag(_lastFlagState) && _lastFlagState !== 'none') {
        if (_greenFlagTimeout) clearTimeout(_greenFlagTimeout);
        _greenFlagTimeout = setTimeout(() => {
          const gb = document.getElementById('gapsBlock');
          if (gb) gb.className = gb.className.replace(/\bflag-\S+/g, '').trim() + ' panel gaps-block';
          if (window.setFlagGLColors) window.setFlagGLColors(null);
          _greenFlagTimeout = null;
          _flagHoldState = 'none';
        }, FLAG_HOLD_MS.green);
      } else if (isGreenFlag(flagState) && !_greenFlagTimeout) {
        showFlag = 'none'; // green with no active timer = steady state, don't show
      } else if (flagState === 'none') {
        // Flag cleared — but hold the overlay if minimum duration hasn't elapsed
        if (now < _flagHoldUntil && _flagHoldState !== 'none') {
          showFlag = _flagHoldState; // keep showing previous flag
        } else {
          if (_greenFlagTimeout) { clearTimeout(_greenFlagTimeout); _greenFlagTimeout = null; }
          showFlag = 'none';
          _flagHoldState = 'none';
        }
      }

      // The flag on show, for the glance layout's background (drive-view.css): written only when it changes.
      if (document.body.dataset.flag !== showFlag) document.body.dataset.flag = showFlag;

      // Remove all flag-* classes
      gapsBlock.className = gapsBlock.className.replace(/\bflag-\S+/g, '').trim();
      if (showFlag !== 'none') {
        gapsBlock.classList.add('flag-active', 'flag-' + showFlag);
        const lbl = flagLabels[showFlag] || showFlag.toUpperCase();
        const ctx = flagContexts[showFlag] || '';
        const fl1 = document.getElementById('flagLabel1');
        const fc1 = document.getElementById('flagCtx1');
        if (fl1) fl1.textContent = lbl;
        if (fc1) fc1.textContent = ctx;
        // Set WebGL flag icon colors
        if (window.setFlagGLColors) window.setFlagGLColors(showFlag);
      } else {
        if (window.setFlagGLColors) window.setFlagGLColors(null);
      }
      // ── Race Control banner — only for critical events ──
      // Minor flags (blue, white, green, debris) are handled by the flag module on the gaps block.
      // Race Control only fires for session-altering events: red, black, yellow (full course), checkered — and what is
      // said to him alone: the black flag furled, disqualified.
      const RC_FLAGS = { red: true, black: true, yellow: true, caution: true, checkered: true, meatball: true, furled: true, disqualify: true };
      if (flagState !== _lastFlagState) {
        if (RC_FLAGS[flagState]) {
          showRaceControl(flagState);
        }
        // Another flag replaces the one the banner is about, at once (a banner saying yellow over a blue flag says two
        // things); a flag that is cleared leaves it until the hold has run out, so it is not yanked early.
        else if (flagState !== 'none' || now >= _flagHoldUntil) {
          hideRaceControl();
        }
      }

      // ── Leaderboard event animations for race start / finish ──
      if (flagState !== _lastFlagState && window.triggerLBEvent) {
        // Green flag transition from non-green = race start (or restart)
        if (isGreenFlag(flagState) && !isGreenFlag(_lastFlagState) && _lastFlagState !== 'none') {
          window.triggerLBEvent('green');
        }
        // Checkered flag = race finish
        if (flagState === 'checkered' && _lastFlagState !== 'checkered') {
          window.triggerLBEvent('finish');
        }
      }
      _lastFlagState = flagState;
      // Expose for ambient-light.js polled color source
      window._currentFlagState = flagState;
    }

    // ─── Ambient light — feed screen color from C# plugin ───
    {
      const ambHas = +v('RacingDesk.Plugin.DS.AmbientHasData') || 0;
      if (ambHas && typeof window.updateAmbientFromPoll === 'function') {
        const ambR = +v('RacingDesk.Plugin.DS.AmbientR') || 0;
        const ambG = +v('RacingDesk.Plugin.DS.AmbientG') || 0;
        const ambB = +v('RacingDesk.Plugin.DS.AmbientB') || 0;
        window.updateAmbientFromPoll(ambR, ambG, ambB);
      }
    }

    // ─── Commentary ───
    const cmVis = +v('RacingDesk.Plugin.CommentaryVisible') || 0;
    if (cmVis && !_commentaryWasVisible) {
      const cmTopicId = vs('RacingDesk.Plugin.CommentaryTopicId');
      // In pit lane: only allow pit-related commentary through
      const pitAllowedTopics = ['pit_entry', 'low_fuel', 'tyre_wear_high'];
      const suppressInPit = _inPitLane && !pitAllowedTopics.includes(cmTopicId);
      if (!suppressInPit) {
        const hue = colorToHue(vs('RacingDesk.Plugin.CommentarySentimentColor'));
        const severity = +v('RacingDesk.Plugin.CommentarySeverity') || 0;
        const trackImg = vs('RacingDesk.Plugin.CommentaryTrackImage') || '';
        const carImg = vs('RacingDesk.Plugin.CommentaryCarImage') || '';
        const commentaryImg = trackImg || carImg;  // track image takes priority, car image as fallback
        showCommentary(hue, vs('RacingDesk.Plugin.CommentaryTopicTitle'), vs('RacingDesk.Plugin.CommentaryText'), vs('RacingDesk.Plugin.CommentaryCategory'), cmTopicId, severity, commentaryImg);
      }
    } else if (!cmVis && _commentaryWasVisible) {
      hideCommentary();
    }
    _commentaryWasVisible = !!cmVis;

    // ─── Strategy calls (displayed via commentary panel with amber hue) ───
    var stVis = +v('RacingDesk.Plugin.Strategy.Visible') || 0;
    if (stVis && !_strategyWasVisible && !cmVis) {
      // Show strategy call through the commentary panel with amber hue (45)
      var stLabel = vs('RacingDesk.Plugin.Strategy.Label') || 'STRATEGY';
      var stText  = vs('RacingDesk.Plugin.Strategy.Text') || '';
      var stSev   = +v('RacingDesk.Plugin.Strategy.Severity') || 1;
      if (stText) {
        showCommentary(45, stLabel, stText, 'strategy', 'strategy_call', stSev);
      }
    } else if (!stVis && _strategyWasVisible && !cmVis) {
      hideCommentary();
    }
    _strategyWasVisible = !!stVis;

    // ─── Commentary visualization data feed ───
    if (cmVis && window.updateCommentaryVizData) {
      window.updateCommentaryVizData({
        brake: brk,
        throttle: thr,
        rpmRatio: rpmRatio,
        speed: speed,
        brakeBias: bb,
        tc: +(tc || 0),
        abs: +(abs || 0),
        fuelPct: fuelPct,
        lapDelta: +(v(dsPre + 'LapDelta') || 0),
        gapAhead: _demo ? +(v('RacingDesk.Plugin.Demo.GapAhead') || 0) : +(v('IRacingExtraProperties.iRacing_Opponent_Ahead_Gap') || 0),
        latG: +(v(dsPre + 'LatG') || 0),
        longG: +(v(dsPre + 'LongG') || 0),
        steerTorque: +(v(dsPre + 'SteerTorque') || 0),
        position: pos,
        prevPosition: _vizSnapPrevPos || 0,
        startPosition: _startPosition || 0,
        totalCars: +(v(sessionPre + 'TotalCars')) || 0,
        incidents: +(v(dsPre + 'IncidentCount') || 0),
        incidentLimitPenalty: +(v(dsPre + 'IncidentLimitPenalty') || 0),
        incidentLimitDQ: +(v(dsPre + 'IncidentLimitDQ') || 0),
        lap: lap,
        sessionTime: vs('DataCorePlugin.GameData.RemainingTime') || '',
        trackTemp: +(v(dsPre + 'TrackTemp') || 0),
        tyreTemps: _demo
          ? [+v('RacingDesk.Plugin.Demo.TyreTempFL'), +v('RacingDesk.Plugin.Demo.TyreTempFR'), +v('RacingDesk.Plugin.Demo.TyreTempRL'), +v('RacingDesk.Plugin.Demo.TyreTempRR')]
          : [+v('DataCorePlugin.GameData.TyreTempFrontLeft'), +v('DataCorePlugin.GameData.TyreTempFrontRight'), +v('DataCorePlugin.GameData.TyreTempRearLeft'), +v('DataCorePlugin.GameData.TyreTempRearRight')],
        // Tread remaining as it is on the wire (0..100 %; null where not measured), for the tyre_wear_high quad
        tyreWears: _demo
          ? [wearOf('RacingDesk.Plugin.Demo.TyreWearFL'), wearOf('RacingDesk.Plugin.Demo.TyreWearFR'), wearOf('RacingDesk.Plugin.Demo.TyreWearRL'), wearOf('RacingDesk.Plugin.Demo.TyreWearRR')]
          : [wearOf('DataCorePlugin.GameData.TyreWearFrontLeft'), wearOf('DataCorePlugin.GameData.TyreWearFrontRight'), wearOf('DataCorePlugin.GameData.TyreWearRearLeft'), wearOf('DataCorePlugin.GameData.TyreWearRearRight')]
      });
    }

    // ─── Driver display name (for leaderboard) ───
    const dfn = vs('RacingDesk.Plugin.DriverFirstName') || '';
    const dln = vs('RacingDesk.Plugin.DriverLastName') || '';
    if (dfn || dln) {
      _driverDisplayName = (dfn && dln) ? dfn + ' ' + dln : (dfn || dln);
    }
    // Zoom map label: first initial + last name, fallback "Local"
    const _zoomLbl = document.getElementById('zoomMapLabel');
    if (_zoomLbl) {
      _zoomLbl.textContent = (dfn && dln) ? dfn + ' ' + dln : (dln || 'Local');
    }

    // ─── Track map ───
    const mapReady = +v('RacingDesk.Plugin.TrackMap.Ready') || 0;
    const pluginPath = mapReady ? (vs('RacingDesk.Plugin.TrackMap.SvgPath') || '') : '';
    let mapOpp  = vs('RacingDesk.Plugin.TrackMap.Opponents') || '';
    const mapHeading = +v('RacingDesk.Plugin.TrackMap.PlayerHeading') || 0;
    // The plugin's outline — from the driver's own telemetry where available — and positions in the same space.
    const _curTrackName = vs('RacingDesk.Plugin.TrackMap.TrackName')
                       || vs('DataCorePlugin.GameData.TrackName') || '';
    const mapPath = pluginPath || '';
    const mapPX = +v('RacingDesk.Plugin.TrackMap.PlayerX') || 50;
    const mapPY = +v('RacingDesk.Plugin.TrackMap.PlayerY') || 50;
    // Why there is or is not a map (ready, first-lap, no-host, none); a host from before it says nothing.
    const mapStatus = vs('RacingDesk.Plugin.TrackMap.Status') || '';
    try { updateTrackMap(mapPath, mapPX, mapPY, mapOpp, speed, mapHeading, mapStatus); } catch(e) { console.error('[RacingDesk] Track map error:', e); }
    const fullMapLbl = document.getElementById('fullMapLabel');
    if (fullMapLbl && _curTrackName) _setFullMapLabel(fullMapLbl, trackDisplayName(p, _curTrackName));

    // ─── Datastream ───
    try { updateDatastream(p, _demo); } catch(e) { console.error('[RacingDesk] Datastream error:', e); }

    // ─── Laps (the glance layout's panel: laps-panel.js) ───
    try {
      if (window.updateLapsPanel) window.updateLapsPanel(p, {
        dsPre, lap, totalLaps, remLaps, remTime, lastLap: lastLapTime, bestLap, isLapRace, raceMode: sessionMode === 4,
        fuelLaps: fuelLapsEst, view: _deltaView, allTime: allTimeDelta || null,
      });
    } catch(e) { console.error('[RacingDesk] Laps panel error:', e); }

    // ─── Pit Box ───
    try { updatePitBox(p); } catch(e) { console.error('[RacingDesk] PitBox error:', e); }

    // ─── Incidents ───
    try { updateIncidents(p, _demo); } catch(e) { console.error('[RacingDesk] Incidents error:', e); }

    // ─── Leaderboard ───
    try { updateLeaderboard(p); } catch(e) { console.error('[RacingDesk] Leaderboard error:', e); }

    // ─── Pit Limiter ───
    try { updatePitLimiter(p, _demo); } catch(e) { console.error('[RacingDesk] Pit limiter error:', e); }

    // ─── Race End Screen ───
    try {
      const isCheckered = flagState === 'checkered';
      if (isCheckered && !_prevCheckered) {
        showRaceEnd(p, _demo);
        // Show post-race results after race-end screen auto-dismisses (31s)
        if (typeof showRaceResults === 'function') {
          setTimeout(function() {
            try { showRaceResults(p, _demo); } catch(e) { console.warn('[RacingDesk] Race results error:', e); }
          }, 31000);
        }
        // Capture session end for sync
        if (typeof window.captureSessionEnd === 'function') {
          window.captureSessionEnd(p, _demo);
        }
      } else if (!isCheckered && _prevCheckered && _raceEndVisible) {
        hideRaceEnd();
      }
      _prevCheckered = isCheckered;
    } catch(e) { console.error('[RacingDesk] Race end error:', e); }

    // ─── Grid / Formation ───
    try { updateGrid(p, _demo); } catch(e) { console.error('[RacingDesk] Grid error:', e); }

    // ─── Spotter (disabled in pit lane — no close racing alerts) ───
    try { if (!_inPitLane) updateSpotter(p, _demo); } catch(e) { console.error('[RacingDesk] Spotter error:', e); }

    // ─── Incident Coach (threat tracking, composure, cool-down, voice) ───
    try { if (typeof updateIncidentCoach === 'function') updateIncidentCoach(p); } catch(e) { console.error('[RacingDesk] IncidentCoach error:', e); }

    // ─── Tire / Track Condition Mismatch ───
    try { if (typeof checkTyreMismatch === 'function' && !_inPitLane) checkTyreMismatch(p, _demo); } catch(e) { console.error('[RacingDesk] Tire mismatch check error:', e); }

    // ─── Race Timeline ───
    try {
      const rtIncidents = +(v('RacingDesk.Plugin.DS.IncidentCount')) || 0;
      const rtInPit = +(v('RacingDesk.Plugin.DS.IsInPitLane')) > 0;
      updateRaceTimeline(pos, lap, flagState, rtIncidents, rtInPit);
    } catch(e) { console.error('[RacingDesk] Timeline error:', e); }

    // ─── Cycling timer (wall-clock, independent of render rate) ───
    // Suppress cycling while timer row is visible — keep position page showing
    const _timerShowing = timerRow && timerRow.classList.contains('timer-visible');
    // Asymmetric cycle: 60s on position page, 15s on rating page
    const _now = Date.now();
    if (!_cycleLastSwitch) _cycleLastSwitch = _now;
    const _onRatingPage = window._isRatingPageActive ? window._isRatingPageActive() : false;
    const _cycleTargetMs = _onRatingPage ? 15000 : 60000;
    if (_now - _cycleLastSwitch >= _cycleTargetMs) { _cycleLastSwitch = _now; if (!_timerShowing) cycleRatingPos(); }

    // ─── FPS counter (game API framerate, not browser) ───
    setApiFps(+v('DataCorePlugin.GameRawData.Telemetry.FrameRate') || 0);
    updateFps();

    // Recording is not the page's: OBS records the screen and the main process writes the telemetry sidecar
    // beside it (modules/js/obs). Nothing of a recording is drawn here, because the HUD is in the picture.

    } catch (err) {
      console.error('[K10 render] Error in frame #' + _pollFrame + ':', err);
    }
  }

  // ─── Start polling ───
  // Always poll the plugin's HTTP API (port 8889) for telemetry data.
  // This works in all contexts: SimHub DashTemplate overlay, standalone browser,
  // OBS Browser Source, or any web view. The plugin's HTTP server serves all
  // telemetry, demo, commentary, and track map data as a single JSON blob.
  // Load external assets before starting the poll loop
  Promise.all([loadCarLogos(), loadCountryFlags()]).then(() => {
    console.log('[The Racing Desk] Assets loaded, polling SimHub HTTP API at ' + SIMHUB_URL);

    // Initialize logo cycling (before we connect, the logos will cycle to be visible). Not in the app's hidden
    // window, which connects only once the driver is in the car; nor in the page OBS draws, which is in the picture.
    if (!_mainDecides && !window._obsMode) {
      _logoCycleTimer = setInterval(() => {
        if (!_hasEverConnected) cycleCarLogo();
      }, 3000);
    }
    setCarLogo(carLogoOrder[0], _demoModels[carLogoOrder[0]]);

    // Settings and Discord state are loaded by connections.js on script load

    if (_mainDecides) {
      // Nothing until main.js says he is in the car. It says so on every change; asking covers what it said
      // before this page was listening.
      window.racingDesk.onInRaceState(_setInCar);
      Promise.resolve(window.racingDesk.getInRaceState()).then(_setInCar).catch(function() {});
    } else {
      // Start polling. Do one immediate read so launch gets data without
      // waiting a full interval, then settle into the dormant (slow) rate.
      // The first poll that finds the driver in the car flips us to the fast
      // rate (_setInCar).
      pollUpdate();
      setPollRate(IDLE_POLL_MS);
      _startFrames();
    }
    window.addEventListener('beforeunload', function() {
      if (_pollIntervalId) clearInterval(_pollIntervalId);
    });
  });

  // ═══════════════════════════════════════════════════════════════
