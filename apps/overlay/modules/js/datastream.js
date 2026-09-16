// Datastream renderer

  // ═══════════════════════════════════════════════════════════════
  //  DATASTREAM RENDERER  (optimised)
  // ═══════════════════════════════════════════════════════════════

  const _dsCanvas = document.getElementById('dsGforceCanvas');
  const _dsCtx = _dsCanvas ? _dsCanvas.getContext('2d') : null;
  let _dsPeakG = 0;
  const _dsTrailLen = 40;
  const _dsTrailLat = new Float32Array(_dsTrailLen);
  const _dsTrailLong = new Float32Array(_dsTrailLen);
  let _dsTrailIdx = 0;
  let _dsTrailCount = 0;
  let _dsAbsFlash = 0;

  // Yaw trail — ring buffer of recent yaw rate samples for waveform display
  const _yawTrailLen = 80;
  const _yawTrail = new Float32Array(_yawTrailLen);
  let _yawTrailIdx = 0;
  let _yawTrailCount = 0;
  const _yawTrailCanvas = document.getElementById('dsYawTrail');
  const _yawTrailCtx = _yawTrailCanvas ? _yawTrailCanvas.getContext('2d') : null;

  // ── Cached DOM refs (avoid per-frame getElementById) ──
  const _elLatG       = document.getElementById('dsLatG');
  const _elLongG      = document.getElementById('dsLongG');
  const _elPeakG      = document.getElementById('dsPeakG');
  const _elYawRate    = document.getElementById('dsYawRate');
  const _elYawFill    = document.getElementById('dsYawFill');
  const _elSteerTorque = document.getElementById('dsSteerTorque');
  const _elDelta      = document.getElementById('dsDelta');
  const _elTrackTemp  = document.getElementById('dsTrackTemp');
  const _elCtrlABS    = document.getElementById('ctrlABS');
  const _elCtrlTC     = document.getElementById('ctrlTC');

  // ── Cached gradients for yaw trail (reused when canvas size unchanged) ──
  let _yawCacheW = 0, _yawCacheH = 0, _yawCacheHue = -1;
  let _yawFillGrad = null, _yawStrokeGrad = null;

  // ── DPR-aware G-force canvas init (set once, not every frame) ──
  let _dsCanvasReady = false;
  const _dsCssW = 64, _dsCssH = 64;

  function _ensureGforceCanvas() {
    if (_dsCanvasReady || !_dsCanvas) return;
    const dpr = window.devicePixelRatio || 1;
    _dsCanvas.width  = _dsCssW * dpr;
    _dsCanvas.height = _dsCssH * dpr;
    _dsCanvasReady = true;
  }

  function renderYawTrail(yawRate) {
    // Store sample
    _yawTrail[_yawTrailIdx] = yawRate;
    _yawTrailIdx = (_yawTrailIdx + 1) % _yawTrailLen;
    _yawTrailCount++;

    if (!_yawTrailCtx) return;
    const c = _yawTrailCanvas;
    const w = c.width, h = c.height;
    const ctx = _yawTrailCtx;
    ctx.clearRect(0, 0, w, h);

    const count = Math.min(_yawTrailCount, _yawTrailLen);
    if (count < 2) return;

    const maxYaw = 1.5; // max expected yaw rate
    const mid = h / 2;
    const absYaw = Math.abs(yawRate);
    const hue = Math.max(0, 210 - absYaw * 120) | 0;

    // Rebuild gradients only when canvas size or hue changes
    const hueI = hue;
    if (w !== _yawCacheW || h !== _yawCacheH || hueI !== _yawCacheHue) {
      _yawCacheW = w; _yawCacheH = h; _yawCacheHue = hueI;
      _yawFillGrad = ctx.createLinearGradient(0, 0, w, 0);
      _yawFillGrad.addColorStop(0,   `hsla(${hue}, 60%, 50%, 0.02)`);
      _yawFillGrad.addColorStop(0.7, `hsla(${hue}, 65%, 50%, 0.15)`);
      _yawFillGrad.addColorStop(1,   `hsla(${hue}, 70%, 55%, 0.35)`);
      _yawStrokeGrad = ctx.createLinearGradient(0, 0, w, 0);
      _yawStrokeGrad.addColorStop(0,   `hsla(${hue}, 60%, 55%, 0.05)`);
      _yawStrokeGrad.addColorStop(0.8, `hsla(${hue}, 70%, 55%, 0.3)`);
      _yawStrokeGrad.addColorStop(1,   `hsla(${hue}, 75%, 60%, 0.6)`);
    }

    // Draw filled waveform — left=oldest, right=newest
    ctx.beginPath();
    ctx.moveTo(0, mid);
    for (let i = 0; i < count; i++) {
      const idx = (_yawTrailIdx - count + i + _yawTrailLen) % _yawTrailLen;
      const x = (i / (count - 1)) * w;
      const val = _yawTrail[idx];
      const y = mid - (val / maxYaw) * (mid - 2);
      ctx.lineTo(x, y);
    }
    // Close to baseline on right, sweep back along baseline
    ctx.lineTo(w, mid);
    ctx.closePath();
    ctx.fillStyle = _yawFillGrad;
    ctx.fill();

    // Stroke the waveform line
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const idx = (_yawTrailIdx - count + i + _yawTrailLen) % _yawTrailLen;
      const x = (i / (count - 1)) * w;
      const val = _yawTrail[idx];
      const y = mid - (val / maxYaw) * (mid - 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = _yawStrokeGrad;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Center line (zero yaw reference)
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(w, mid);
    ctx.strokeStyle = 'hsla(0, 0%, 100%, 0.06)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }
  let _dsTcFlash = 0;
  let _dsPrevTrackTemp = 0;
  let _dsPrevIncidents = -1;
  let _dsPrevDeltaSign = 0;  // -1, 0, 1

  // ── Flash via Web Animations API (no forced reflow) ──
  function dsFlash(el) {
    if (!el || !el.animate) return;
    el.animate([
      { opacity: 1, filter: 'brightness(2)' },
      { opacity: 1, filter: 'brightness(1)' }
    ], { duration: 300, easing: 'ease-out' });
  }

  function drawGforceDiamond(latG, longG) {
    if (!_dsCtx) return;
    _ensureGforceCanvas();
    const c = _dsCanvas;
    const dpr = window.devicePixelRatio || 1;
    const ctx = _dsCtx;
    // Clear without resetting canvas dimensions (preserves state)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, _dsCssW, _dsCssH);

    const cx = _dsCssW / 2, cy = _dsCssH / 2;
    const maxG = 3.0;  // full scale
    const r = 28;       // diamond radius in px

    // Diamond outline (rotated square)
    ctx.strokeStyle = 'hsla(0,0%,100%,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.stroke();

    // Inner grid lines (crosshair)
    ctx.strokeStyle = 'hsla(0,0%,100%,0.04)';
    ctx.beginPath();
    ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
    ctx.stroke();

    // Half-diamond
    ctx.strokeStyle = 'hsla(0,0%,100%,0.03)';
    ctx.beginPath();
    ctx.moveTo(cx, cy - r/2);
    ctx.lineTo(cx + r/2, cy);
    ctx.lineTo(cx, cy + r/2);
    ctx.lineTo(cx - r/2, cy);
    ctx.closePath();
    ctx.stroke();

    // G-force trail
    if (_dsTrailCount > 1) {
      ctx.beginPath();
      ctx.strokeStyle = 'hsla(210,60%,55%,0.15)';
      ctx.lineWidth = 1;
      for (let i = 0; i < Math.min(_dsTrailCount, _dsTrailLen); i++) {
        const idx = (_dsTrailIdx - 1 - i + _dsTrailLen) % _dsTrailLen;
        const px = cx + (_dsTrailLat[idx] / maxG) * r;
        const py = cy - (_dsTrailLong[idx] / maxG) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    // Store trail
    _dsTrailLat[_dsTrailIdx] = latG;
    _dsTrailLong[_dsTrailIdx] = longG;
    _dsTrailIdx = (_dsTrailIdx + 1) % _dsTrailLen;
    _dsTrailCount++;

    // Current G dot
    let dotX = cx + (latG / maxG) * r;
    let dotY = cy - (longG / maxG) * r;
    const totalG = Math.sqrt(latG * latG + longG * longG);

    // Check if dot is within diamond boundary
    // Diamond boundary: |dotX - cx|/r + |dotY - cy|/r <= 1
    const dx = Math.abs(dotX - cx);
    const dy = Math.abs(dotY - cy);
    const distanceFactor = dx / r + dy / r;
    let isClamped = false;
    let clampRatio = 0;

    if (distanceFactor > 1) {
      isClamped = true;
      clampRatio = Math.min((distanceFactor - 1) / (distanceFactor - 1), 1);

      // Project to nearest point on diamond edge
      const signX = dotX >= cx ? 1 : -1;
      const signY = dotY >= cy ? 1 : -1;
      dotX = cx + signX * (r * Math.abs(dotX - cx)) / (dx + dy);
      dotY = cy - signY * (r * Math.abs(dotY - cy)) / (dx + dy);

      const newDx = Math.abs(dotX - cx);
      const newDy = Math.abs(dotY - cy);
      const scale = 1 / ((newDx + newDy) / r);
      if (scale < 1) {
        dotX = cx + (dotX - cx) * scale;
        dotY = cy + (dotY - cy) * scale;
      }
    }

    // Dot color: blue at low G, shifts toward red/orange at high G
    const hue = Math.max(0, 210 - totalG * 50);
    let lum = 55 + totalG * 5;
    if (isClamped) lum = Math.min(lum + 20, 95);

    ctx.fillStyle = `hsl(${hue},70%,${lum}%)`;
    ctx.beginPath();
    let dotRadius = 2.5;
    if (isClamped) dotRadius = 2.5 + (5.0 - 2.5) * clampRatio;
    ctx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2);
    ctx.fill();

    // Glow
    ctx.fillStyle = `hsla(${hue},70%,${lum}%,0.25)`;
    ctx.beginPath();
    ctx.arc(dotX, dotY, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── Visibility gate: skip rendering when datastream panel is hidden ──
  const _dsPanel = document.getElementById('datastreamArea') || ((_dsCanvas) ? _dsCanvas.closest('.panel') : null);

  function updateDatastream(p, isDemo) {
    // Skip entirely if panel is not visible
    if (_dsPanel && _dsPanel.offsetParent === null) return;

    const pre = isDemo ? 'RaceCorProDrive.Plugin.Demo.DS.' : 'RaceCorProDrive.Plugin.DS.';
    const vd = (key) => +p[pre + key] || 0;

    const latG = vd('LatG');
    const longG = vd('LongG');
    const yawRate = vd('YawRate');
    const steerTorque = vd('SteerTorque');
    const trackTemp = vd('TrackTemp');
    const incidentCount = vd('IncidentCount');
    const absActive = vd('AbsActive') > 0;
    const tcActive = vd('TcActive') > 0;
    const lapDelta = vd('LapDelta');

    // Expose G-force values for map trail animation
    window._ambientLatG = latG;
    window._ambientLongG = longG;

    // G-force diamond
    drawGforceDiamond(latG, longG);

    // Lat/Long G values
    if (_elLatG) _elLatG.textContent = Math.abs(latG).toFixed(2) + 'g';
    if (_elLongG) _elLongG.textContent = Math.abs(longG).toFixed(2) + 'g';

    // Peak G tracking
    const totalG = Math.sqrt(latG * latG + longG * longG);
    const wasNewPeak = totalG > _dsPeakG && _dsPeakG > 0;
    if (totalG > _dsPeakG) _dsPeakG = totalG;
    if (_elPeakG) { _elPeakG.textContent = _dsPeakG.toFixed(2) + 'g'; if (wasNewPeak) dsFlash(_elPeakG); }

    // Yaw rate
    if (_elYawRate) _elYawRate.textContent = Math.abs(yawRate).toFixed(2) + ' r/s';

    // Yaw bar (centered, extends left for negative, right for positive)
    if (_elYawFill) {
      const maxYaw = 1.5;
      const pct = Math.min(Math.abs(yawRate) / maxYaw, 1.0) * 50;
      const yawHue = Math.max(0, 210 - Math.abs(yawRate) * 120);
      if (yawRate >= 0) {
        _elYawFill.style.cssText = `left:50%;width:${pct}%;background:hsla(${yawHue},70%,55%,0.7)`;
      } else {
        _elYawFill.style.cssText = `left:${50 - pct}%;width:${pct}%;background:hsla(${yawHue},70%,55%,0.7)`;
      }
    }

    // Yaw trail waveform
    renderYawTrail(yawRate);

    // Steering torque
    if (_elSteerTorque) _elSteerTorque.textContent = steerTorque.toFixed(1) + ' Nm';

    // Lap delta
    if (_elDelta) {
      const sign = lapDelta >= 0 ? '+' : '';
      _elDelta.textContent = sign + lapDelta.toFixed(3);
      _elDelta.classList.remove('ds-positive', 'ds-negative', 'ds-neutral');
      if (lapDelta > 0.05) _elDelta.classList.add('ds-positive');
      else if (lapDelta < -0.05) _elDelta.classList.add('ds-negative');
      else _elDelta.classList.add('ds-neutral');
      // Flash on sign change
      const curSign = lapDelta > 0.05 ? 1 : lapDelta < -0.05 ? -1 : 0;
      if (_dsPrevDeltaSign !== 0 && curSign !== 0 && curSign !== _dsPrevDeltaSign) dsFlash(_elDelta);
      if (curSign !== 0) _dsPrevDeltaSign = curSign;
    }

    // Track temp
    if (_elTrackTemp) {
      _elTrackTemp.textContent = trackTemp > 0 ? trackTemp.toFixed(1) + '°C' : '—°C';
      if (_dsPrevTrackTemp > 0 && Math.abs(trackTemp - _dsPrevTrackTemp) > 0.3) dsFlash(_elTrackTemp);
      _dsPrevTrackTemp = trackTemp;
    }

    // ABS/TC activity → glow on adjustments module bars
    if (absActive) _dsAbsFlash = 8;
    if (tcActive) _dsTcFlash = 8;
    if (_elCtrlABS) {
      _elCtrlABS.classList.toggle('ctrl-active', _dsAbsFlash > 0);
      if (_dsAbsFlash > 0) _dsAbsFlash--;
    }
    if (_elCtrlTC) {
      _elCtrlTC.classList.toggle('ctrl-active', _dsTcFlash > 0);
      if (_dsTcFlash > 0) _dsTcFlash--;
    }
  }

  // ═══════════════════════════════════════════════════════════════
