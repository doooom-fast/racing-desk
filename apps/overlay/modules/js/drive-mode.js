/**
 * K10 MOTORSPORTS — DRIVE MODE MODULE
 *
 * iPad-optimized full-screen racing dashboard for in-cockpit glanceability.
 * Completely self-contained: creates all DOM dynamically, integrates with telemetry pipeline.
 *
 * Public API:
 *   - window.initDriveMode() — called once on load, sets up DOM + overlays
 *   - window._driveModeUpdate(props, isDemo) — called every 33ms with telemetry tick
 */

(function initDriveModeModule() {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  // Tachometer arc constants (11 segments, 270° sweep)
  const TACH_SEGS = 11;
  const CX = 100, CY = 100, R = 88;
  const ARC_START_DEG = 135;     // bottom-left
  const ARC_SPAN_DEG = 270;      // sweep to bottom-right
  const GAP_DEG = 2.5;           // gap between segments
  const SEG_SPAN = (ARC_SPAN_DEG - GAP_DEG * (TACH_SEGS - 1)) / TACH_SEGS;
  const FULL_CIRC = 2 * Math.PI * R;

  // Spotter state tracking
  let _spotterGapBehindPrev = 999;
  let _spotterGapAheadPrev = 999;
  let _spotterLastMessage = null;
  let _spotterCooldown = 0;

  // Internal timers
  let _spotterTimer = null;
  let _toastTimer = null;
  let _pitBannerTimer = null;
  let _rpmPulseTimer = null;
  let _prevLitCount = 0;
  let _bonkersTimer = null;
  let _flagAutoFadeTimer = null;

  // Flag WebGL state
  let _flagGLCtx = null;
  let _flagGLVisible = false;
  let _flagTime = 0;

  /**
   * Format seconds to M:SS.mmm (3 decimal places for iRacing)
   */
  function _fmtLap(secs) {
    if (secs == null || secs === 0) return '—';
    const mins = Math.floor(secs / 60);
    const sec = secs - mins * 60;
    return `${mins}:${sec.toFixed(3).padStart(6, '0')}`;
  }

  /**
   * Format gap with sign: -1.342 or +2.103 (3dp)
   */
  function _fmtGap(secs) {
    if (secs == null || secs === 0) return '—';
    const sign = secs > 0 ? '+' : '';
    return sign + secs.toFixed(3);
  }

  /**
   * Get tyre temp class based on temperature
   * cold <150, optimal <220, hot <260, danger >=260
   */
  function _getTyreTempClass(temp) {
    if (temp < 150) return 'cold';
    if (temp < 220) return 'optimal';
    if (temp < 260) return 'hot';
    return 'danger';
  }

  /**
   * Update the 11 SVG arc segments based on RPM percentage
   */
  function _updateTachoSegs(pct) {
    const ring = document.getElementById('dmTachoRing');
    const segArcs = document.querySelectorAll('.dm-seg-arc');
    const lit = Math.round(pct * TACH_SEGS);
    let topColor = 'dim';

    for (let i = 0; i < TACH_SEGS; i++) {
      const el = segArcs[i];
      el.classList.remove('lit-green', 'lit-yellow', 'lit-red', 'lit-redline');
      if (i < lit) {
        const f = i / TACH_SEGS;
        if (f < 0.55)      { el.classList.add('lit-green');   topColor = 'green'; }
        else if (f < 0.73) { el.classList.add('lit-yellow');  topColor = 'yellow'; }
        else if (f < 0.91) { el.classList.add('lit-red');     topColor = 'red'; }
        else               { el.classList.add('lit-redline'); topColor = 'red'; }
      }
    }

    // RPM text color pulse on segment change
    if (lit > _prevLitCount && lit > 0) {
      const rpmText = document.getElementById('dmRpmText');
      const pulseClass = topColor === 'green' ? 'dm-rpm-pulse-green' :
                         topColor === 'yellow' ? 'dm-rpm-pulse-yellow' :
                         'dm-rpm-pulse-red';
      rpmText.classList.remove('dm-rpm-pulse-green', 'dm-rpm-pulse-yellow', 'dm-rpm-pulse-red');
      void rpmText.offsetWidth;
      rpmText.classList.add(pulseClass);
      if (_rpmPulseTimer) clearTimeout(_rpmPulseTimer);
      _rpmPulseTimer = setTimeout(() => {
        rpmText.classList.remove('dm-rpm-pulse-green', 'dm-rpm-pulse-yellow', 'dm-rpm-pulse-red');
      }, 180);
    }
    _prevLitCount = lit;

    // Redline flash on container
    ring.classList.toggle('dm-tacho-redline', pct >= 0.91);
  }

  /**
   * Show full-screen spotter overlay
   */
  function _showDMSpotter(msg, severity, duration) {
    const el = document.getElementById('dmSpotter');
    el.className = 'dm-spotter-overlay ' + severity + ' visible';
    document.getElementById('dmSpotterMsg').textContent = msg;
    clearTimeout(_spotterTimer);
    _spotterTimer = setTimeout(() => {
      el.classList.remove('visible');
    }, duration || 2500);
  }

  /**
   * Show coaching toast
   */
  function _showDMToast(title, body) {
    const t = document.getElementById('dmToast');
    document.getElementById('dmToastTitle').textContent = title;
    document.getElementById('dmToastBody').textContent = body;
    t.classList.add('visible');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => t.classList.remove('visible'), 5000);
  }

  /**
   * Start bonkers spark animation for pit banner
   */
  function _startDMSparks(container) {
    const inner = container.querySelector('.dm-pit-inner');
    if (!inner) return;
    _bonkersTimer = setInterval(() => {
      const count = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < count; i++) {
        const spark = document.createElement('div');
        const angle = -Math.PI * 0.1 + Math.random() * -Math.PI * 0.8;
        const speed = 40 + Math.random() * 80;
        const dx = Math.cos(angle) * speed * (Math.random() > 0.5 ? 1 : -1);
        const dy = Math.sin(angle) * speed;
        const size = 1.5 + Math.random() * 2.5;
        const hue = Math.random() * 55;
        const life = 300 + Math.random() * 400;
        spark.style.cssText = 'position:absolute;border-radius:50%;pointer-events:none;z-index:10;'
          + 'width:' + size + 'px;height:' + size + 'px;'
          + 'background:hsl(' + hue + ',100%,' + (55 + Math.random() * 15) + '%);'
          + 'box-shadow:0 0 ' + (size*3) + 'px hsl(' + hue + ',100%,50%),0 0 ' + (size*6) + 'px hsla(' + hue + ',100%,50%,0.4);'
          + 'left:' + (50 + (Math.random()-0.5)*60) + '%;top:50%;'
          + '--spark-dx:' + dx + 'px;--spark-dy:' + dy + 'px;'
          + 'animation:dm-pit-spark-fly ' + life + 'ms ease-out forwards;';
        inner.appendChild(spark);
        setTimeout(() => { if (spark.parentNode) spark.remove(); }, life + 50);
      }
    }, 40);
  }

  function _stopDMSparks() {
    clearInterval(_bonkersTimer);
  }

  /**
   * Update pit banner state (normal / warning / bonkers)
   */
  function _updateDMPit(props, dsPre) {
    const banner = document.getElementById('dmPitBanner');
    const isInPit = props[dsPre + 'IsInPitLane'] ? true : false;

    if (!isInPit) {
      banner.classList.remove('pit-visible', 'pit-warning', 'pit-bonkers');
      _stopDMSparks();
      clearTimeout(_pitBannerTimer);
      return;
    }

    const pitLimiterOn = props[dsPre + 'PitLimiterOn'] ? true : false;
    const isPitSpeeding = props[dsPre + 'IsPitSpeeding'] ? true : false;
    const speedMph = props[dsPre + 'SpeedMph'] || 0;
    const pitSpeedLimit = props[dsPre + 'PitSpeedLimitMph'] || 0;

    banner.classList.add('pit-visible');
    _stopDMSparks();

    if (isPitSpeeding) {
      banner.classList.remove('pit-warning');
      banner.classList.add('pit-bonkers');
      _startDMSparks(banner);
    } else if (!pitLimiterOn) {
      banner.classList.remove('pit-bonkers');
      banner.classList.add('pit-warning');
    } else {
      banner.classList.remove('pit-warning', 'pit-bonkers');
    }

    document.getElementById('dmPitSpeed').textContent = Math.round(speedMph) + ' mph';
    document.getElementById('dmPitLimit').textContent = '/ ' + Math.round(pitSpeedLimit) + ' limit';
  }

  /**
   * Show WebGL flag animation and auto-fade after 4s
   */
  function _showDMFlag(flagType) {
    if (!_flagGLCtx || !_flagGLCtx.gl) return;

    // Set flag colors if available
    if (window.setFlagGLColors) {
      window.setFlagGLColors(flagType);
    }

    _flagGLVisible = true;
    const canvas = _flagGLCtx.canvas;
    canvas.style.opacity = '1';

    clearTimeout(_flagAutoFadeTimer);
    _flagAutoFadeTimer = setTimeout(() => {
      _flagGLVisible = false;
      canvas.style.opacity = '0';
    }, 4000);
  }

  /**
   * iOS Safari detection
   */
  function _isIosSafari() {
    if (!window._k10RemoteMode) return false;
    const ua = navigator.userAgent;
    const isApple = ua.includes('iPad') || ua.includes('iPhone') ||
                    (navigator.maxTouchPoints > 1 && ua.includes('Macintosh'));
    const isStandalone = navigator.standalone === true || !window.k10;
    return isApple || isStandalone;
  }

  /**
   * Initialize Drive Mode: Create DOM, set up overlays, activate
   */
  var _dmInitialized = false;

  window.initDriveMode = function() {
    // Only initialize once
    if (_dmInitialized) return;
    // Activate if remote mode flag is set (no UA detection — iPad build always activates)
    if (!window._k10RemoteMode) return;
    _dmInitialized = true;

    // Create main layout container
    const driveMode = document.createElement('div');
    driveMode.id = 'driveMode';
    driveMode.className = 'dm-layout';

    // ─── TOP BAR ───
    const topBar = document.createElement('div');
    topBar.className = 'dm-top-bar';

    // Position card
    const cardPos = document.createElement('div');
    cardPos.className = 'dm-top-card dm-card-position';
    cardPos.innerHTML = `
      <div style="text-align:center">
        <div class="dm-pos-label">Position</div>
        <div class="dm-pos-value"><span class="dm-pos-p">P</span><span id="dmPosNum">1</span><span class="dm-pos-of" id="dmPosOf">/20</span></div>
      </div>
    `;
    topBar.appendChild(cardPos);

    // Gap ahead card
    const cardGapAhead = document.createElement('div');
    cardGapAhead.className = 'dm-top-card dm-card-gap';
    cardGapAhead.innerHTML = `
      <div class="dm-gap-label">Gap Ahead</div>
      <div class="dm-gap-driver" id="dmDriverAhead">—</div>
      <div class="dm-gap-time ahead" id="dmGapAhead">—</div>
    `;
    topBar.appendChild(cardGapAhead);

    // Lap card
    const cardLap = document.createElement('div');
    cardLap.className = 'dm-top-card dm-card-lap';
    cardLap.innerHTML = `
      <div class="dm-lap-row" style="margin-bottom:2px">
        <span class="dm-lap-label">Best</span>
        <span class="dm-lap-time best" id="dmBestLap">—</span>
        <span class="dm-lap-delta faster" id="dmLapDelta">—</span>
      </div>
      <div class="dm-lap-row">
        <span class="dm-lap-label">Last</span>
        <span class="dm-lap-time last" id="dmLastLap">—</span>
        <span class="dm-lap-number" id="dmLapNum">Lap —</span>
      </div>
    `;
    topBar.appendChild(cardLap);

    // Gap behind card
    const cardGapBehind = document.createElement('div');
    cardGapBehind.className = 'dm-top-card dm-card-gap';
    cardGapBehind.innerHTML = `
      <div class="dm-gap-label">Gap Behind</div>
      <div class="dm-gap-driver" id="dmDriverBehind">—</div>
      <div class="dm-gap-time behind" id="dmGapBehind">—</div>
    `;
    topBar.appendChild(cardGapBehind);

    driveMode.appendChild(topBar);

    // ─── CENTER ZONE ───
    const centerZone = document.createElement('div');
    centerZone.className = 'dm-center';

    // Left side panel (fuel + tyres)
    const leftPanel = document.createElement('div');
    leftPanel.className = 'dm-side-panel left';
    leftPanel.innerHTML = `
      <div class="dm-side-card">
        <div class="dm-side-card-label">Fuel</div>
        <div class="dm-fuel-mini-bar"><div class="dm-fuel-mini-fill healthy" id="dmFuelFill" style="width:47%"></div></div>
        <div class="dm-fuel-mini-row">
          <span><span class="dm-fuel-mini-val" id="dmFuelVal">—</span><span class="dm-fuel-mini-unit"> L</span></span>
          <span class="dm-fuel-mini-laps" id="dmFuelLaps">—</span>
        </div>
      </div>
      <div class="dm-side-card">
        <div class="dm-side-card-label">Tyres</div>
        <div class="dm-tyre-mini-grid">
          <div class="dm-tyre-mini-cell optimal" id="dmTyreFL">—</div>
          <div class="dm-tyre-mini-cell optimal" id="dmTyreFR">—</div>
          <div class="dm-tyre-mini-cell optimal" id="dmTyreRL">—</div>
          <div class="dm-tyre-mini-cell optimal" id="dmTyreRR">—</div>
        </div>
      </div>
    `;
    centerZone.appendChild(leftPanel);

    // Tachometer ring
    const tachoRing = document.createElement('div');
    tachoRing.id = 'dmTachoRing';
    tachoRing.className = 'dm-tacho-ring';
    const tachoSvg = document.createElementNS(SVG_NS, 'svg');
    tachoSvg.id = 'dmTachoSvg';
    tachoSvg.setAttribute('class', 'dm-tacho-svg');
    tachoSvg.setAttribute('viewBox', '0 0 200 200');

    // Create 11 SVG arc segments
    for (let i = 0; i < TACH_SEGS; i++) {
      const startDeg = ARC_START_DEG + i * (SEG_SPAN + GAP_DEG);
      const segLen = (SEG_SPAN / 360) * FULL_CIRC;
      const gapLen = FULL_CIRC - segLen;
      const offsetLen = -((startDeg / 360) * FULL_CIRC);

      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', CX);
      circle.setAttribute('cy', CY);
      circle.setAttribute('r', R);
      circle.setAttribute('stroke-dasharray', `${segLen} ${gapLen}`);
      circle.setAttribute('stroke-dashoffset', `${offsetLen}`);
      circle.classList.add('dm-seg-arc');
      tachoSvg.appendChild(circle);
    }

    tachoRing.appendChild(tachoSvg);

    // Gear display
    const gearDisplay = document.createElement('div');
    gearDisplay.id = 'dmGearDisplay';
    gearDisplay.className = 'dm-gear-display';
    gearDisplay.innerHTML = `
      <div class="dm-gear-label">Gear</div>
      <div class="dm-gear-value" id="dmGearVal">—</div>
      <div class="dm-speed-row">
        <span class="dm-speed-value" id="dmSpeedVal">—</span>
        <span class="dm-speed-unit">mph</span>
      </div>
      <div class="dm-rpm-text" id="dmRpmText">— rpm</div>
    `;
    tachoRing.appendChild(gearDisplay);
    centerZone.appendChild(tachoRing);

    // Right side panel (incidents + track map)
    const rightPanel = document.createElement('div');
    rightPanel.className = 'dm-side-panel right';
    rightPanel.innerHTML = `
      <div class="dm-side-card">
        <div class="dm-side-card-label">Incidents</div>
        <div class="dm-inc-mini-row">
          <span class="dm-inc-mini-count" id="dmIncCount">0</span>
          <span class="dm-inc-mini-x">x</span>
        </div>
        <div class="dm-inc-mini-bar">
          <div class="dm-inc-mini-fill" id="dmIncFill" style="width:0%"></div>
          <div class="dm-inc-mini-marker" style="left:50%"></div>
          <div class="dm-inc-mini-marker" style="left:100%"></div>
        </div>
      </div>
      <div class="dm-side-card">
        <div class="dm-side-card-label">Track</div>
        <div class="dm-map-mini">
          <svg viewBox="0 0 100 70">
            <path class="dm-map-track" d="M20,55 C5,55 5,15 20,15 L80,15 C95,15 95,55 80,55 Z" />
            <circle class="dm-map-opponent" cx="35" cy="15" r="3" />
            <circle class="dm-map-opponent" cx="60" cy="55" r="3" />
            <circle class="dm-map-player" cx="50" cy="15" r="4" />
          </svg>
        </div>
      </div>
    `;
    centerZone.appendChild(rightPanel);

    driveMode.appendChild(centerZone);

    // ─── BOTTOM BAR ───
    const bottomBar = document.createElement('div');
    bottomBar.className = 'dm-bottom-bar';
    bottomBar.innerHTML = `
      <div class="dm-bottom-card dm-card-flag"><div class="dm-flag-dot green" id="dmFlagDot"></div></div>
      <div class="dm-bottom-card dm-card-notify" style="flex:1;"><div class="dm-notify-text" id="dmNotifyText">Green flag</div></div>
      <div class="dm-bottom-card dm-card-controls">
        <div class="dm-ctrl-mini"><span class="dm-ctrl-mini-label">BB</span><span class="dm-ctrl-mini-val" id="dmCtrlBB">—</span></div>
        <div class="dm-ctrl-mini"><span class="dm-ctrl-mini-label">TC</span><span class="dm-ctrl-mini-val" id="dmCtrlTC">—</span></div>
        <div class="dm-ctrl-mini"><span class="dm-ctrl-mini-label">ABS</span><span class="dm-ctrl-mini-val" id="dmCtrlABS">—</span></div>
      </div>
    `;
    driveMode.appendChild(bottomBar);

    // Append main layout to body
    document.body.appendChild(driveMode);

    // ─── OVERLAY ELEMENTS ───

    // Pit banner
    const pitBanner = document.createElement('div');
    pitBanner.id = 'dmPitBanner';
    pitBanner.className = 'dm-pit-banner';
    pitBanner.innerHTML = `
      <div class="dm-pit-inner">
        <div class="dm-pit-icon">P</div>
        <div class="dm-pit-label">Pit Limiter</div>
        <div class="dm-pit-speed" id="dmPitSpeed">— mph</div>
        <div class="dm-pit-limit" id="dmPitLimit">/ — limit</div>
      </div>
    `;
    document.body.appendChild(pitBanner);

    // Spotter overlay
    const spotter = document.createElement('div');
    spotter.id = 'dmSpotter';
    spotter.className = 'dm-spotter-overlay';
    spotter.innerHTML = `
      <div class="dm-spotter-bg"></div>
      <div class="dm-spotter-card">
        <div class="dm-spotter-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <path d="M12 9v4"/><circle cx="12" cy="16" r="1" fill="currentColor"/>
          </svg>
        </div>
        <div class="dm-spotter-content">
          <div class="dm-spotter-header" id="dmSpotterHeader">Spotter</div>
          <div class="dm-spotter-msg" id="dmSpotterMsg">—</div>
        </div>
      </div>
    `;
    document.body.appendChild(spotter);

    // Toast
    const toast = document.createElement('div');
    toast.id = 'dmToast';
    toast.className = 'dm-toast-overlay';
    toast.innerHTML = `
      <div class="dm-toast-title" id="dmToastTitle">—</div>
      <div class="dm-toast-body" id="dmToastBody">—</div>
    `;
    document.body.appendChild(toast);

    // WebGL flag canvas
    const flagCanvas = document.createElement('canvas');
    flagCanvas.id = 'dmFlagCanvas';
    flagCanvas.style.position = 'fixed';
    flagCanvas.style.inset = '0';
    flagCanvas.style.zIndex = '700';
    flagCanvas.style.pointerEvents = 'none';
    flagCanvas.style.opacity = '0';
    flagCanvas.style.transition = 'opacity 0.3s';
    document.body.appendChild(flagCanvas);

    // Initialize flag WebGL if available
    if (window._flagFXFrame) {
      const gl = flagCanvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true });
      if (gl) {
        _flagGLCtx = { canvas: flagCanvas, gl };
        // Start flag animation loop
        const flagAnimLoop = (t) => {
          if (_flagGLVisible) {
            _flagTime += 16;
            window._flagFXFrame(16);
          }
          requestAnimationFrame(flagAnimLoop);
        };
        requestAnimationFrame(flagAnimLoop);
      }
    }

    // FAB + menu
    const fab = document.createElement('div');
    fab.id = 'dmFab';
    fab.className = 'dm-fab';
    fab.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>`;
    document.body.appendChild(fab);

    const fabMenu = document.createElement('div');
    fabMenu.id = 'dmFabMenu';
    fabMenu.className = 'dm-fab-menu';
    fabMenu.innerHTML = `
      <button class="dm-fab-btn" id="dmBtnSettings"><span class="dm-fab-btn-icon">⚙</span> Settings</button>
      <button class="dm-fab-btn" id="dmBtnFullscreen"><span class="dm-fab-btn-icon">🖥️</span> Fullscreen</button>
      <div class="dm-fab-sep"></div>
      <button class="dm-fab-btn" id="dmBtnExit"><span class="dm-fab-btn-icon">↩️</span> Exit Drive Mode</button>
    `;
    document.body.appendChild(fabMenu);

    // ─── FAB EVENT HANDLERS ───
    fab.addEventListener('click', (e) => {
      e.stopPropagation();
      fab.classList.toggle('open');
      fabMenu.classList.toggle('open');
    });

    document.addEventListener('click', () => {
      fab.classList.remove('open');
      fabMenu.classList.remove('open');
    });

    fabMenu.addEventListener('click', (e) => e.stopPropagation());

    document.getElementById('dmBtnSettings').addEventListener('click', () => {
      alert('Opens Settings overlay. All Drive Mode settings accessible here.');
    });

    document.getElementById('dmBtnFullscreen').addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.();
      } else {
        document.exitFullscreen?.();
      }
    });

    document.getElementById('dmBtnExit').addEventListener('click', () => {
      document.body.classList.remove('drive-mode-active');
    });

    // Activate Drive Mode
    document.body.classList.add('drive-mode-active');
  };

  /**
   * Update Drive Mode display with telemetry data
   * Called every 33ms from poll-engine.js
   */
  window._driveModeUpdate = function(props, isDemo) {
    if (!document.body.classList.contains('drive-mode-active')) return;

    // Helper extractors
    const v = (k) => props[k] != null ? props[k] : 0;
    const vs = (k) => props[k] != null ? '' + props[k] : '';
    const pre = isDemo ? 'RaceCorProDrive.Plugin.Demo.' : '';
    const dsPre = isDemo ? 'RaceCorProDrive.Plugin.Demo.DS.' : 'RaceCorProDrive.Plugin.DS.';

    // ─── GEAR & SPEED ───
    const gear = v(pre + 'Gear') || 0;
    const speed = v(pre + 'SpeedMph') || 0;
    const rpm = v(pre + 'Rpm') || 0;
    const maxRpm = v(pre + 'MaxRpm') || 8500;

    const gearEl = document.getElementById('dmGearVal');
    if (gear === 0) {
      gearEl.textContent = 'N';
      gearEl.className = 'dm-gear-value neutral';
    } else if (gear === -1) {
      gearEl.textContent = 'R';
      gearEl.className = 'dm-gear-value reverse';
    } else {
      gearEl.textContent = gear;
      gearEl.className = 'dm-gear-value';
    }

    document.getElementById('dmSpeedVal').textContent = Math.round(speed);

    const rpmRatio = maxRpm > 0 ? rpm / maxRpm : 0;
    document.getElementById('dmRpmText').textContent = Math.round(rpm).toLocaleString() + ' rpm';
    _updateTachoSegs(rpmRatio);

    // ─── POSITION ───
    const pos = v(pre + 'Position') || 0;
    const posOf = v(pre + 'TotalCars') || 0;
    document.getElementById('dmPosNum').textContent = pos;
    document.getElementById('dmPosOf').textContent = '/' + posOf;

    // ─── GAPS ───
    const gapAhead = v(pre + 'GapAhead') || 0;
    const gapBehind = v(pre + 'GapBehind') || 0;
    const driverAhead = vs(pre + 'DriverAheadName');
    const driverBehind = vs(pre + 'DriverBehindName');

    document.getElementById('dmGapAhead').textContent = _fmtGap(gapAhead);
    document.getElementById('dmGapBehind').textContent = _fmtGap(gapBehind);
    document.getElementById('dmDriverAhead').textContent = driverAhead || '—';
    document.getElementById('dmDriverBehind').textContent = driverBehind || '—';

    // ─── LAP TIMES ───
    const bestLap = v(pre + 'BestLapTime') || 0;
    const lastLap = v(pre + 'LastLapTime') || 0;
    const currentLap = v(pre + 'CurrentLapNum') || 0;
    const totalLaps = v(pre + 'TotalLaps') || 0;

    document.getElementById('dmBestLap').textContent = _fmtLap(bestLap);
    document.getElementById('dmLastLap').textContent = _fmtLap(lastLap);

    const lapDelta = lastLap - bestLap;
    const lapDeltaEl = document.getElementById('dmLapDelta');
    if (lapDelta === 0) {
      lapDeltaEl.textContent = '—';
      lapDeltaEl.className = 'dm-lap-delta';
    } else if (lapDelta < 0) {
      lapDeltaEl.textContent = _fmtGap(-lapDelta);
      lapDeltaEl.className = 'dm-lap-delta faster';
    } else {
      lapDeltaEl.textContent = _fmtGap(lapDelta);
      lapDeltaEl.className = 'dm-lap-delta slower';
    }

    const lapText = currentLap > 0 ? `Lap ${currentLap}` + (totalLaps > 0 ? ` / ${totalLaps}` : '') : 'Lap —';
    document.getElementById('dmLapNum').textContent = lapText;

    // ─── FUEL ───
    const fuel = v(dsPre + 'Fuel') || 0;
    const fuelPct = v(dsPre + 'FuelPct') || 0;
    const fuelLapsRemaining = v(dsPre + 'FuelLapsRemaining') || 0;

    document.getElementById('dmFuelVal').textContent = fuel.toFixed(1);
    document.getElementById('dmFuelLaps').textContent = fuelLapsRemaining.toFixed(1) + ' laps';

    const fuelFill = document.getElementById('dmFuelFill');
    fuelFill.style.width = Math.max(0, Math.min(100, fuelPct * 100)) + '%';
    if (fuelPct < 0.25) {
      fuelFill.className = 'dm-fuel-mini-fill critical';
    } else if (fuelPct < 0.5) {
      fuelFill.className = 'dm-fuel-mini-fill caution';
    } else {
      fuelFill.className = 'dm-fuel-mini-fill healthy';
    }

    // ─── TYRES ───
    const tyreTempFL = v(pre + 'TyreTempFrontLeft') || 0;
    const tyreTempFR = v(pre + 'TyreTempFrontRight') || 0;
    const tyreTempRL = v(pre + 'TyreTempRearLeft') || 0;
    const tyreTempRR = v(pre + 'TyreTempRearRight') || 0;

    const tyres = [
      { id: 'dmTyreFL', temp: tyreTempFL },
      { id: 'dmTyreFR', temp: tyreTempFR },
      { id: 'dmTyreRL', temp: tyreTempRL },
      { id: 'dmTyreRR', temp: tyreTempRR }
    ];

    tyres.forEach(t => {
      const el = document.getElementById(t.id);
      el.textContent = Math.round(t.temp);
      const cls = _getTyreTempClass(t.temp);
      el.className = 'dm-tyre-mini-cell ' + cls;
    });

    // ─── CONTROLS ───
    const brakeBias = v(pre + 'BrakeBias') || 0;
    const tractionControl = v(pre + 'TractionControl') || 0;
    const abs = v(pre + 'ABS') || 0;

    document.getElementById('dmCtrlBB').textContent = brakeBias.toFixed(1);
    document.getElementById('dmCtrlTC').textContent = tractionControl;
    document.getElementById('dmCtrlABS').textContent = abs;

    // ─── INCIDENTS ───
    const incidents = v(dsPre + 'IncidentCount') || 0;
    document.getElementById('dmIncCount').textContent = incidents;
    document.getElementById('dmIncFill').style.width = Math.min(100, incidents * 5) + '%';

    // ─── FLAG STATE ───
    const flagState = vs(pre + 'CurrentFlagState');
    const flagDot = document.getElementById('dmFlagDot');
    flagDot.className = 'dm-flag-dot ' + (flagState || 'green');

    // Update notification text
    const notifyMap = {
      'green': 'Green flag — racing',
      'yellow': 'Yellow flag — caution',
      'red': 'Red flag — session suspended',
      'white': 'White flag — final lap',
      'checkered': 'Checkered flag — session end',
      'blue': 'Blue flag — faster car approaching'
    };
    document.getElementById('dmNotifyText').textContent = notifyMap[flagState] || 'Green flag — racing';

    // Show flag overlay on change (if not green/none)
    if (flagState && flagState !== 'green' && flagState !== 'none') {
      _showDMFlag(flagState);
    }

    // ─── PIT LANE ───
    _updateDMPit(props, dsPre);

    // ─── SPOTTER LOGIC ───
    const gapBehindDelta = gapBehind - _spotterGapBehindPrev;
    const gapAheadDelta = gapAhead - _spotterGapAheadPrev;

    if (_spotterCooldown > 0) {
      _spotterCooldown--;
    } else if (gapBehind < 0.8 && gapBehind > 0) {
      _showDMSpotter('Car alongside', 'sp-danger', 2500);
      _spotterLastMessage = 'alongside';
      _spotterCooldown = 120;
    } else if (gapBehind < 2.0 && gapBehind > 0 && gapBehindDelta < -0.03) {
      _showDMSpotter('Car closing', 'sp-warn', 2500);
      _spotterLastMessage = 'closing';
      _spotterCooldown = 120;
    } else if (gapAhead < 0.8 && gapAhead > 0) {
      _showDMSpotter('Car right there', 'sp-danger', 2500);
      _spotterLastMessage = 'ahead-close';
      _spotterCooldown = 120;
    } else if (gapAhead < 2.0 && gapAhead > 0 && gapAheadDelta < -0.03) {
      _showDMSpotter('Closing on car ahead', 'sp-clear', 2500);
      _spotterLastMessage = 'ahead-closing';
      _spotterCooldown = 120;
    }

    _spotterGapBehindPrev = gapBehind;
    _spotterGapAheadPrev = gapAhead;

    // ─── COACHING TOAST ───
    const commentaryVisible = props[pre + 'CommentaryVisible'] ? true : false;
    const commentaryText = vs(pre + 'CommentaryText');
    const commentaryTopic = vs(pre + 'CommentaryTopicTitle');

    if (commentaryVisible && commentaryText) {
      _showDMToast(commentaryTopic || 'Coaching', commentaryText);
    }
  };
})();
