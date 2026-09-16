// Commentary Data Visualizations

  // ═══════════════════════════════════════════════════════════════
  //  COMMENTARY DATA VISUALIZATIONS
  //  Canvas-based mini visualizations that appear beneath the
  //  commentary text, driven by the topicId that triggered the
  //  commentary event. Live-updating while the commentary is visible.
  // ═══════════════════════════════════════════════════════════════

  const _vizCanvas = document.getElementById('commentaryVizCanvas');
  const _vizCtx = _vizCanvas ? _vizCanvas.getContext('2d') : null;
  const _vizContainer = document.getElementById('commentaryViz');
  const _vizValueEl = document.getElementById('commentaryVizValue');
  const _vizLabelEl = document.getElementById('commentaryVizLabel');

  let _vizActive = false;
  let _vizTopicId = '';
  let _vizHue = 0;
  let _vizHistory = [];       // rolling data buffer for live line charts
  const _VIZ_HIST_LEN = 60;  // ~2 seconds of samples at 30fps poll rate
  let _vizGridGhostPos = 0;   // captured on first grid frame so it doesn't drift

  // ── Viz type definitions ──
  // Each topicId maps to a visualization type and configuration.
  // 'gauge'   — arc gauge showing a single value 0-1
  // 'bar'     — horizontal bar with label
  // 'line'    — rolling line chart with history buffer
  // 'gforce'  — 2D g-force dot (lat vs long)
  // 'quad'    — four-corner display (tyres)
  // 'delta'   — +/- delta bar centered at zero
  // 'counter' — simple large numeric display (no canvas)
  const _vizConfig = {
    // ── Car response ──
    spin_catch:            { type: 'gforce',  label: 'G-Force',        unit: 'g' },
    high_cornering_load:   { type: 'gforce',  label: 'Cornering Load', unit: 'g' },
    heavy_braking:         { type: 'line',    label: 'Brake Pressure', unit: '%',    src: 'brake' },
    car_balance_sustained: { type: 'gforce',  label: 'Car Balance',    unit: 'g' },
    rapid_gear_change:     { type: 'line',    label: 'RPM',            unit: '',     src: 'rpm' },
    wall_contact:          { type: 'incident', label: 'Incidents' },
    off_track:             { type: 'incident', label: 'Incidents' },
    kerb_hit:              { type: 'gforce',  label: 'Impact',         unit: 'g' },

    // ── Hardware ──
    abs_activation:        { type: 'line',    label: 'Brake + ABS',    unit: '%',    src: 'brake' },
    tc_intervention:       { type: 'line',    label: 'Throttle + TC',  unit: '%',    src: 'throttle' },
    ffb_torque_spike:      { type: 'line',    label: 'Steer Torque',   unit: '',     src: 'steerTorque' },
    brake_bias_change:     { type: 'gauge',   label: 'Brake Bias',     unit: '%',    src: 'brakeBias', min: 40, max: 65 },
    tc_setting_change:     { type: 'gauge',   label: 'TC Level',       unit: '',     src: 'tc', min: 0, max: 12 },
    abs_setting_change:    { type: 'gauge',   label: 'ABS Level',      unit: '',     src: 'abs', min: 0, max: 12 },
    arb_front_change:      { type: 'bar',     label: 'Front ARB',      unit: '',     src: 'tc' },
    arb_rear_change:       { type: 'bar',     label: 'Rear ARB',       unit: '',     src: 'abs' },

    // ── Game feel ──
    qualifying_push:       { type: 'delta',   label: 'Lap Delta',      unit: 's',    src: 'lapDelta' },
    personal_best:         { type: 'delta',   label: 'Lap Delta',      unit: 's',    src: 'lapDelta' },
    long_stint:            { type: 'counter', label: 'Laps',           src: 'laps' },
    session_time_low:      { type: 'counter', label: 'Remaining',      src: 'sessionTime' },
    drs_active:            { type: 'line',    label: 'Speed',          unit: 'mph',  src: 'speed' },
    ers_low:               { type: 'gauge',   label: 'ERS Battery',    unit: '%',    src: 'fuel', min: 0, max: 100 },

    // ── Racing experience ──
    close_battle:          { type: 'delta',   label: 'Gap',            unit: 's',    src: 'gapAhead' },
    position_gained:       { type: 'grid',    label: 'Grid Position' },
    position_lost:         { type: 'grid',    label: 'Grid Position' },
    incident_spike:        { type: 'incident', label: 'Incidents' },
    low_fuel:              { type: 'gauge',   label: 'Fuel',           unit: 'L',    src: 'fuel', min: 0, max: 100 },
    hot_tyres:             { type: 'quad',    label: 'Tyre Temps',     unit: '°C',   src: 'tyreTemp' },
    tyre_wear_high:        { type: 'quad',    label: 'Tyre Wear',      unit: '%',    src: 'tyreWear' },
    track_temp_hot:        { type: 'counter', label: 'Track Temp',     src: 'trackTemp' },
    track_temp_cold:       { type: 'counter', label: 'Track Temp',     src: 'trackTemp' },
    wet_track:             { type: 'counter', label: 'Track Temp',     src: 'trackTemp' },

    // Catch-all for topics that appear in demo
    pit_entry:             { type: 'counter', label: 'Laps',           src: 'laps' },
    race_start:            { type: 'grid',    label: 'Grid Position' },
    formation_lap:         { type: 'grid',    label: 'Grid Position' },
    yellow_flag:           { type: 'incident', label: 'Incidents' },
    black_flag:            { type: 'incident', label: 'Incidents' },
    debris_on_track:       { type: 'incident', label: 'Incidents' },
  };

  // ── Latest telemetry snapshot (updated by poll engine) ──
  let _vizTelemetry = {};

  // Public: called by poll-engine each frame to push fresh data
  window.updateCommentaryVizData = function(data) {
    _vizTelemetry = data;
    if (_vizActive) _renderVizFrame();
  };

  // Public: activate a viz for the given topicId
  window.showCommentaryViz = function(topicId, hue) {
    const cfg = _vizConfig[topicId];
    if (!cfg || !_vizContainer) {
      if (_vizContainer) _vizContainer.classList.remove('viz-active');
      _vizActive = false;
      return;
    }
    _vizTopicId = topicId;
    _vizHue = hue;
    _vizHistory = [];
    _vizActive = true;
    _vizContainer.classList.add('viz-active');
    _vizContainer.setAttribute('data-viz-type', cfg.type);
    if (_vizLabelEl) _vizLabelEl.textContent = cfg.label;
    if (_vizValueEl) _vizValueEl.textContent = '';
    _renderVizFrame();
  };

  // Public: deactivate
  window.hideCommentaryViz = function() {
    _vizActive = false;
    _vizHistory = [];
    _vizGridGhostPos = 0;
    if (_vizContainer) _vizContainer.classList.remove('viz-active');
  };

  // ── Resolve a data value from the telemetry snapshot ──
  function _getVizValue(src) {
    const t = _vizTelemetry;
    switch (src) {
      case 'brake':       return t.brake || 0;
      case 'throttle':    return t.throttle || 0;
      case 'rpm':         return t.rpmRatio || 0;
      case 'speed':       return t.speed || 0;
      case 'brakeBias':   return t.brakeBias || 0;
      case 'tc':          return t.tc || 0;
      case 'abs':         return t.abs || 0;
      case 'fuel':        return t.fuelPct || 0;
      case 'lapDelta':    return t.lapDelta || 0;
      case 'gapAhead':    return t.gapAhead || 0;
      case 'steerTorque': return t.steerTorque || 0;
      case 'position':    return t.position || 0;
      case 'prevPosition': return t.prevPosition || 0;
      case 'startPosition': return t.startPosition || 0;
      case 'totalCars':   return t.totalCars || 0;
      case 'incidents':   return t.incidents || 0;
      case 'incidentLimitPenalty': return t.incidentLimitPenalty || 0;
      case 'incidentLimitDQ':     return t.incidentLimitDQ || 0;
      case 'laps':        return t.lap || 0;
      case 'sessionTime': return t.sessionTime || '';
      case 'trackTemp':   return t.trackTemp || 0;
      case 'tyreTemp':    return t.tyreTemps || [0,0,0,0];
      case 'tyreWear':    return t.tyreWears || [0,0,0,0];
      default:            return 0;
    }
  }

  // ── Master render dispatcher ──
  function _renderVizFrame() {
    const cfg = _vizConfig[_vizTopicId];
    if (!cfg) return;

    switch (cfg.type) {
      case 'line':    _renderLine(cfg);    break;
      case 'gauge':   _renderGauge(cfg);   break;
      case 'gforce':  _renderGForce(cfg);  break;
      case 'bar':     _renderBar(cfg);     break;
      case 'delta':   _renderDelta(cfg);   break;
      case 'quad':    _renderQuad(cfg);    break;
      case 'counter':  _renderCounter(cfg);  break;
      case 'grid':     _renderGrid(cfg);     break;
      case 'incident': _renderIncident(cfg); break;
    }
  }

  // ── Canvas setup helper ──
  function _prepCanvas() {
    if (!_vizCanvas || !_vizCtx) return null;
    const rect = _vizCanvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (w < 2 || h < 2) return null;
    if (_vizCanvas.width !== w || _vizCanvas.height !== h) {
      _vizCanvas.width = w;
      _vizCanvas.height = h;
    }
    _vizCtx.clearRect(0, 0, w, h);
    return { ctx: _vizCtx, w, h, dpr };
  }

  function _hslStr(h, s, l, a) {
    return `hsla(${h}, ${s}%, ${l}%, ${a})`;
  }

  // ════════════════════════════════════════════
  //  LINE — rolling waveform with glow
  // ════════════════════════════════════════════
  function _renderLine(cfg) {
    const val = _getVizValue(cfg.src);
    // Normalize to 0-1 for line chart
    let norm = val;
    if (cfg.src === 'speed') norm = Math.min(1, val / 200);
    else if (cfg.src === 'steerTorque') norm = Math.min(1, Math.abs(val) / 50);
    else if (cfg.src === 'rpm') norm = val; // already 0-1

    _vizHistory.push(norm);
    if (_vizHistory.length > _VIZ_HIST_LEN) _vizHistory.shift();

    const c = _prepCanvas();
    if (!c) return;
    const { ctx, w, h } = c;
    const count = _vizHistory.length;
    if (count < 2) return;

    // Fill area under curve
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i < count; i++) {
      const x = (i / (count - 1)) * w;
      const y = h - _vizHistory[i] * (h - 4) - 2;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    const fillGrad = ctx.createLinearGradient(0, 0, 0, h);
    fillGrad.addColorStop(0, _hslStr(_vizHue, 60, 55, 0.25));
    fillGrad.addColorStop(1, _hslStr(_vizHue, 60, 55, 0.02));
    ctx.fillStyle = fillGrad;
    ctx.fill();

    // Stroke line
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const x = (i / (count - 1)) * w;
      const y = h - _vizHistory[i] * (h - 4) - 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, _hslStr(_vizHue, 50, 60, 0.15));
    grad.addColorStop(0.5, _hslStr(_vizHue, 60, 65, 0.6));
    grad.addColorStop(1, _hslStr(_vizHue, 60, 65, 0.9));
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Live dot at leading edge
    const lastY = h - _vizHistory[count - 1] * (h - 4) - 2;
    ctx.beginPath();
    ctx.arc(w - 1, lastY, 3, 0, Math.PI * 2);
    ctx.fillStyle = _hslStr(_vizHue, 60, 70, 0.9);
    ctx.fill();

    // Value display
    const displayVal = cfg.src === 'speed' ? Math.round(val) :
                       cfg.src === 'steerTorque' ? val.toFixed(1) :
                       Math.round(val * 100);
    if (_vizValueEl) _vizValueEl.textContent = displayVal + (cfg.unit ? ' ' + cfg.unit : '');
  }

  // ════════════════════════════════════════════
  //  GAUGE — arc gauge with animated fill
  // ════════════════════════════════════════════
  function _renderGauge(cfg) {
    const rawVal = _getVizValue(cfg.src);
    const min = cfg.min || 0;
    const max = cfg.max || 100;
    const pct = Math.max(0, Math.min(1, (rawVal - min) / (max - min)));

    const c = _prepCanvas();
    if (!c) return;
    const { ctx, w, h } = c;

    const cx = w / 2;
    const cy = h * 0.7;
    const r = Math.min(cx, cy) * 0.85;
    const startAngle = Math.PI * 0.8;
    const endAngle = Math.PI * 2.2;
    const fillAngle = startAngle + (endAngle - startAngle) * pct;

    // Background arc
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, endAngle, false);
    ctx.strokeStyle = _hslStr(_vizHue, 20, 25, 0.3);
    ctx.lineWidth = Math.max(6, r * 0.12);
    ctx.lineCap = 'round';
    ctx.stroke();

    // Filled arc
    if (pct > 0.01) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, startAngle, fillAngle, false);
      const arcGrad = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
      arcGrad.addColorStop(0, _hslStr(_vizHue, 55, 50, 0.7));
      arcGrad.addColorStop(1, _hslStr(_vizHue, 65, 65, 0.95));
      ctx.strokeStyle = arcGrad;
      ctx.lineWidth = Math.max(6, r * 0.12);
      ctx.lineCap = 'round';
      ctx.stroke();

      // Glow at tip
      const tipX = cx + Math.cos(fillAngle) * r;
      const tipY = cy + Math.sin(fillAngle) * r;
      const glow = ctx.createRadialGradient(tipX, tipY, 0, tipX, tipY, r * 0.2);
      glow.addColorStop(0, _hslStr(_vizHue, 60, 65, 0.5));
      glow.addColorStop(1, _hslStr(_vizHue, 60, 65, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(tipX - r * 0.2, tipY - r * 0.2, r * 0.4, r * 0.4);
    }

    if (_vizValueEl) {
      const fmt = cfg.src === 'brakeBias' ? rawVal.toFixed(1) : Math.round(rawVal);
      _vizValueEl.textContent = fmt + (cfg.unit ? ' ' + cfg.unit : '');
    }
  }

  // ════════════════════════════════════════════
  //  G-FORCE — 2D dot (lateral vs longitudinal)
  // ════════════════════════════════════════════
  function _renderGForce(cfg) {
    const latG = _vizTelemetry.latG || 0;
    const longG = _vizTelemetry.longG || 0;
    const totalG = Math.sqrt(latG * latG + longG * longG);

    const c = _prepCanvas();
    if (!c) return;
    const { ctx, w, h } = c;

    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.min(cx, cy) * 0.85;

    // Background rings
    for (let ring = 1; ring <= 3; ring++) {
      ctx.beginPath();
      ctx.arc(cx, cy, (maxR / 3) * ring, 0, Math.PI * 2);
      ctx.strokeStyle = _hslStr(_vizHue, 20, 30, 0.15);
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Crosshairs
    ctx.beginPath();
    ctx.moveTo(cx - maxR, cy); ctx.lineTo(cx + maxR, cy);
    ctx.moveTo(cx, cy - maxR); ctx.lineTo(cx, cy + maxR);
    ctx.strokeStyle = _hslStr(_vizHue, 20, 40, 0.12);
    ctx.lineWidth = 1;
    ctx.stroke();

    // G-force dot — normalize to 3g range
    const scale = maxR / 3;
    const dotX = cx + (latG * scale);
    const dotY = cy - (longG * scale); // up = positive longG (accel)

    // Trail (store positions)
    if (!_vizHistory.length || _vizHistory[0].x !== undefined) {
      // ok
    } else {
      _vizHistory = [];
    }
    _vizHistory.push({ x: dotX, y: dotY });
    if (_vizHistory.length > 20) _vizHistory.shift();

    // Draw trail
    for (let i = 0; i < _vizHistory.length - 1; i++) {
      const alpha = (i / _vizHistory.length) * 0.3;
      ctx.beginPath();
      ctx.arc(_vizHistory[i].x, _vizHistory[i].y, 2, 0, Math.PI * 2);
      ctx.fillStyle = _hslStr(_vizHue, 55, 60, alpha);
      ctx.fill();
    }

    // Main dot with glow
    const glowR = 8 + totalG * 4;
    const glow = ctx.createRadialGradient(dotX, dotY, 0, dotX, dotY, glowR);
    glow.addColorStop(0, _hslStr(_vizHue, 65, 65, 0.7));
    glow.addColorStop(0.5, _hslStr(_vizHue, 60, 60, 0.2));
    glow.addColorStop(1, _hslStr(_vizHue, 60, 60, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(dotX - glowR, dotY - glowR, glowR * 2, glowR * 2);

    ctx.beginPath();
    ctx.arc(dotX, dotY, 4, 0, Math.PI * 2);
    ctx.fillStyle = _hslStr(_vizHue, 60, 70, 0.95);
    ctx.fill();

    if (_vizValueEl) _vizValueEl.textContent = totalG.toFixed(2) + ' g';
  }

  // ════════════════════════════════════════════
  //  BAR — simple horizontal filled bar
  // ════════════════════════════════════════════
  function _renderBar(cfg) {
    const rawVal = _getVizValue(cfg.src);
    const pct = Math.max(0, Math.min(1, rawVal / 12)); // 0-12 range for TC/ABS

    const c = _prepCanvas();
    if (!c) return;
    const { ctx, w, h } = c;

    const barH = Math.max(8, h * 0.35);
    const barY = (h - barH) / 2;
    const radius = barH / 2;

    // Background
    _roundRect(ctx, 0, barY, w, barH, radius);
    ctx.fillStyle = _hslStr(_vizHue, 20, 20, 0.3);
    ctx.fill();

    // Fill
    if (pct > 0.01) {
      const fillW = Math.max(barH, w * pct);
      _roundRect(ctx, 0, barY, fillW, barH, radius);
      const grad = ctx.createLinearGradient(0, 0, fillW, 0);
      grad.addColorStop(0, _hslStr(_vizHue, 55, 45, 0.7));
      grad.addColorStop(1, _hslStr(_vizHue, 65, 60, 0.95));
      ctx.fillStyle = grad;
      ctx.fill();
    }

    if (_vizValueEl) _vizValueEl.textContent = Math.round(rawVal) + (cfg.unit ? ' ' + cfg.unit : '');
  }

  function _roundRect(ctx, x, y, w, h, r) {
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

  // ════════════════════════════════════════════
  //  DELTA — centered +/- bar (lap delta, gap)
  // ════════════════════════════════════════════
  function _renderDelta(cfg) {
    const rawVal = _getVizValue(cfg.src);
    // Clamp to ±5 seconds for display range
    const clamped = Math.max(-5, Math.min(5, rawVal));
    const pct = clamped / 5; // -1 to +1

    const c = _prepCanvas();
    if (!c) return;
    const { ctx, w, h } = c;

    const barH = Math.max(8, h * 0.35);
    const barY = (h - barH) / 2;
    const midX = w / 2;

    // Background bar
    _roundRect(ctx, 0, barY, w, barH, barH / 2);
    ctx.fillStyle = _hslStr(0, 0, 25, 0.2);
    ctx.fill();

    // Center line
    ctx.beginPath();
    ctx.moveTo(midX, barY - 2);
    ctx.lineTo(midX, barY + barH + 2);
    ctx.strokeStyle = _hslStr(0, 0, 60, 0.4);
    ctx.lineWidth = 1;
    ctx.stroke();

    // Delta fill
    if (Math.abs(pct) > 0.005) {
      const isNeg = pct < 0;
      const hue = isNeg ? 145 : 0; // green for negative (gaining), red for positive (losing)
      const fillW = Math.abs(pct) * (w / 2);
      const fillX = isNeg ? midX - fillW : midX;

      ctx.beginPath();
      ctx.rect(fillX, barY, fillW, barH);
      ctx.fillStyle = _hslStr(hue, 60, 50, 0.7);
      ctx.fill();
    }

    // Value display
    const sign = rawVal > 0.005 ? '+' : rawVal < -0.005 ? '' : '';
    if (_vizValueEl) _vizValueEl.textContent = sign + rawVal.toFixed(3) + ' ' + cfg.unit;
    if (_vizValueEl) _vizValueEl.style.color = rawVal < -0.005 ? 'hsl(145, 60%, 60%)' : rawVal > 0.005 ? 'hsl(0, 60%, 65%)' : '';
  }

  // ════════════════════════════════════════════
  //  QUAD — four-corner display (tyres) with heatmap
  // ════════════════════════════════════════════

  // Tyre temp color bands — matches getTyreTempClass() in webgl-helpers.js
  // Thresholds are °F (iRacing native). Returns { hue, sat, label }.
  function _tyreTempColor(tempF) {
    if (tempF <= 0)   return { hue: 0,   sat: 0,  label: '' };       // no data
    if (tempF < 150)  return { hue: 200, sat: 70, label: 'cold' };   // blue  < 66°C
    if (tempF < 230)  return { hue: 123, sat: 45, label: 'optimal' };// green 66-110°C
    if (tempF < 270)  return { hue: 45,  sat: 90, label: 'hot' };    // amber 110-132°C
    return              { hue: 0,   sat: 70, label: 'danger' };       // red   > 132°C
  }

  // Tyre wear color (percentage 0-100)
  function _tyreWearColor(pct) {
    if (pct > 50)  return { hue: 123, sat: 45 };  // green
    if (pct > 25)  return { hue: 45,  sat: 90 };  // amber
    return           { hue: 0,   sat: 70 };        // red
  }

  function _renderQuad(cfg) {
    const vals = _getVizValue(cfg.src);
    const arr = Array.isArray(vals) ? vals : [0, 0, 0, 0];

    const c = _prepCanvas();
    if (!c) return;
    const { ctx, w, h, dpr } = c;

    const gap = 4 * dpr;
    const cellW = (w - gap) / 2;
    const cellH = (h - gap) / 2;
    const positions = [
      [0, 0],                    // FL
      [cellW + gap, 0],          // FR
      [0, cellH + gap],          // RL
      [cellW + gap, cellH + gap] // RR
    ];
    const labels = ['FL', 'FR', 'RL', 'RR'];
    const isTemp = cfg.src === 'tyreTemp';

    for (let i = 0; i < 4; i++) {
      const [x, y] = positions[i];
      const val = arr[i] || 0;
      const col = isTemp ? _tyreTempColor(val) : _tyreWearColor(val);
      const hue = col.hue;
      const sat = col.sat;

      // ── Heatmap fill: radial gradient from center of cell ──
      const cx = x + cellW / 2;
      const cy = y + cellH / 2;
      const rMax = Math.max(cellW, cellH) * 0.8;

      // Intensity scales with how extreme the value is
      let intensity;
      if (isTemp) {
        // Hotter = brighter fill; cold = very faint
        intensity = val <= 0 ? 0 : Math.max(0.12, Math.min(0.55, (val - 100) / 300));
      } else {
        // Lower wear = brighter fill (more alarming)
        intensity = Math.max(0.12, 0.55 - (val / 100) * 0.4);
      }

      // Cell base
      _roundRect(ctx, x, y, cellW, cellH, 4 * dpr);
      ctx.fillStyle = `hsla(${hue}, ${sat}%, 12%, 0.6)`;
      ctx.fill();

      // Heatmap radial glow
      const radGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rMax);
      radGrad.addColorStop(0, `hsla(${hue}, ${sat}%, 45%, ${intensity})`);
      radGrad.addColorStop(0.6, `hsla(${hue}, ${sat}%, 30%, ${intensity * 0.4})`);
      radGrad.addColorStop(1, `hsla(${hue}, ${sat}%, 20%, 0)`);
      _roundRect(ctx, x, y, cellW, cellH, 4 * dpr);
      ctx.fillStyle = radGrad;
      ctx.fill();

      // Border — brighter at higher intensity
      _roundRect(ctx, x, y, cellW, cellH, 4 * dpr);
      ctx.strokeStyle = `hsla(${hue}, ${sat}%, 50%, ${0.3 + intensity * 0.5})`;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Value text
      ctx.fillStyle = `hsla(${hue}, ${sat}%, 70%, 0.95)`;
      ctx.font = `bold ${11 * dpr}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const dispVal = isTemp ? Math.round(val) + '°' : Math.round(val) + '%';
      ctx.fillText(dispVal, cx, cy - 2 * dpr);

      // Corner label
      ctx.fillStyle = `hsla(${hue}, ${Math.round(sat * 0.7)}%, 60%, 0.5)`;
      ctx.font = `${7 * dpr}px system-ui, sans-serif`;
      ctx.fillText(labels[i], cx, cy + 10 * dpr);
    }

    if (_vizValueEl) _vizValueEl.textContent = '';
  }

  // ════════════════════════════════════════════
  //  GRID — dot-strip position display
  //  Row of dots (one per car), player highlighted,
  //  ghost position shown with ring outline.
  //  Mirrors the pre-race grid strip style.
  // ════════════════════════════════════════════
  function _renderGrid(cfg) {
    const pos = Math.round(_getVizValue('position')) || 0;
    if (pos <= 0) return;
    let total = Math.round(_getVizValue('totalCars')) || 0;
    if (total < pos) total = pos + 4;
    const startPos = Math.round(_getVizValue('startPosition')) || 0;

    // Capture ghost on first render only
    if (_vizGridGhostPos === 0) {
      const prev = Math.round(_getVizValue('prevPosition'));
      if (prev > 0 && prev !== pos) _vizGridGhostPos = prev;
    }

    const c = _prepCanvas();
    if (!c) return;
    const { ctx, w, h, dpr } = c;

    // ── Layout ──
    const dotSize = 7 * dpr;
    const dotGap = 3 * dpr;
    const dotR = 2 * dpr;           // corner radius
    const dotsPerRow = Math.floor((w + dotGap) / (dotSize + dotGap));
    const rows = Math.ceil(total / dotsPerRow);
    const stripH = rows * (dotSize + dotGap) - dotGap;
    const startY = Math.max(0, (h * 0.6 - stripH) / 2);  // vertically center in top 60%

    for (let i = 1; i <= total; i++) {
      const idx = i - 1;
      const col = idx % dotsPerRow;
      const row = Math.floor(idx / dotsPerRow);
      // Center each row
      const carsInRow = Math.min(dotsPerRow, total - row * dotsPerRow);
      const rowW = carsInRow * (dotSize + dotGap) - dotGap;
      const rowOffX = (w - rowW) / 2;
      const x = rowOffX + col * (dotSize + dotGap);
      const y = startY + row * (dotSize + dotGap);

      const isPlayer = (i === pos);
      const isGhost = (_vizGridGhostPos > 0 && i === _vizGridGhostPos);
      const isStart = (startPos > 0 && i === startPos && startPos !== pos);

      _roundRect(ctx, x, y, dotSize, dotSize, dotR);
      if (isPlayer) {
        // Player — bright hue-matched fill with glow
        ctx.fillStyle = `hsla(${_vizHue}, 80%, 55%, 1)`;
        ctx.fill();
        ctx.save();
        ctx.shadowColor = `hsla(${_vizHue}, 90%, 60%, 0.7)`;
        ctx.shadowBlur = 8 * dpr;
        _roundRect(ctx, x, y, dotSize, dotSize, dotR);
        ctx.fillStyle = `hsla(${_vizHue}, 80%, 55%, 0.6)`;
        ctx.fill();
        ctx.restore();
      } else if (isGhost) {
        // Ghost (previous position) — dashed outline
        ctx.fillStyle = `hsla(${_vizHue}, 30%, 20%, 0.3)`;
        ctx.fill();
        _roundRect(ctx, x, y, dotSize, dotSize, dotR);
        ctx.setLineDash([2 * dpr, 2 * dpr]);
        ctx.strokeStyle = `hsla(${_vizHue}, 55%, 55%, 0.6)`;
        ctx.lineWidth = 1.2 * dpr;
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (isStart) {
        // Start position — dim ring
        ctx.fillStyle = 'hsla(0, 0%, 25%, 0.4)';
        ctx.fill();
        _roundRect(ctx, x, y, dotSize, dotSize, dotR);
        ctx.strokeStyle = 'hsla(0, 0%, 50%, 0.3)';
        ctx.lineWidth = 1 * dpr;
        ctx.stroke();
      } else {
        // Other cars — neutral dim
        ctx.fillStyle = 'hsla(0, 0%, 30%, 0.45)';
        ctx.fill();
      }
    }

    // ── Value label ──
    if (_vizValueEl) {
      const change = (_vizGridGhostPos > 0 && _vizGridGhostPos !== pos)
        ? _vizGridGhostPos - pos
        : (startPos > 0 ? startPos - pos : 0);
      if (change !== 0) {
        _vizValueEl.textContent = 'P' + pos + ' / ' + total + (change > 0 ? ' \u25B2' + change : ' \u25BC' + Math.abs(change));
        _vizValueEl.style.color = change > 0 ? 'hsl(145, 60%, 60%)' : 'hsl(0, 60%, 65%)';
      } else {
        _vizValueEl.textContent = 'P' + pos + ' / ' + total;
        _vizValueEl.style.color = '';
      }
    }
  }

  // ════════════════════════════════════════════
  //  INCIDENT — quad-style incident tracker
  //  2×2 cells:
  //    [Count  ] [To Pen ]
  //    [To DQ  ] [Accrued]  (bar fill)
  //  Uses _settings.incPenalty / incDQ thresholds.
  // ════════════════════════════════════════════

  // Incident severity heatmap: green(0) → amber → red
  function _incSeverityColor(count, limit) {
    if (count <= 0)                return { hue: 123, sat: 40 };  // green — clean
    const pct = count / Math.max(1, limit);
    if (pct < 0.35)               return { hue: 123, sat: 45 };  // green — comfortable
    if (pct < 0.55)               return { hue: 60,  sat: 50 };  // yellow — caution
    if (pct < 0.75)               return { hue: 35,  sat: 65 };  // amber — warning
    if (pct < 0.90)               return { hue: 15,  sat: 70 };  // orange — danger
    return                          { hue: 0,   sat: 75 };        // red — critical
  }

  // Remaining-to-threshold heatmap: green(safe) → red(imminent)
  function _incRemainingColor(remaining) {
    if (remaining <= 0)  return { hue: 0,   sat: 80 };   // red — at/past limit
    if (remaining <= 2)  return { hue: 0,   sat: 70 };   // red — critical
    if (remaining <= 4)  return { hue: 15,  sat: 65 };   // orange
    if (remaining <= 6)  return { hue: 35,  sat: 55 };   // amber
    return                 { hue: 123, sat: 40 };          // green — safe
  }

  function _renderIncident(cfg) {
    const count = Math.round(_getVizValue('incidents')) || 0;
    // Read real incident limits from SDK; fall back to settings / defaults
    const sdkPen = Math.round(_getVizValue('incidentLimitPenalty')) || 0;
    const sdkDQ  = Math.round(_getVizValue('incidentLimitDQ')) || 0;
    const penLimit = sdkPen > 0 ? sdkPen : ((typeof _settings !== 'undefined' && _settings.incPenalty) || 17);
    const dqLimit  = sdkDQ  > 0 ? sdkDQ  : ((typeof _settings !== 'undefined' && _settings.incDQ)      || 25);
    const toPen = Math.max(0, penLimit - count);
    const toDQ  = Math.max(0, dqLimit - count);

    const c = _prepCanvas();
    if (!c) return;
    const { ctx, w, h, dpr } = c;

    // ── 2×2 quad layout ──
    const gap = 4 * dpr;
    const cellW = (w - gap) / 2;
    const cellH = (h - gap) / 2;
    const positions = [
      [0, 0],                    // Count (top-left)
      [cellW + gap, 0],          // To Penalty (top-right)
      [0, cellH + gap],          // To DQ (bottom-left)
      [cellW + gap, cellH + gap] // Accrued bar (bottom-right)
    ];

    // Accrued fraction as a percentage of DQ limit
    const accruedPct = Math.min(100, Math.round((count / dqLimit) * 100));

    // Cell data
    const cells = [
      { val: '' + count,
        label: 'COUNT',
        col: _incSeverityColor(count, dqLimit),
        intensity: Math.max(0.15, Math.min(0.55, count / dqLimit)) },
      { val: toPen > 0 ? '' + toPen : 'PEN!',
        label: 'TO PEN',
        col: _incRemainingColor(toPen),
        intensity: toPen <= 0 ? 0.55 : toPen <= 3 ? 0.45 : 0.25 },
      { val: toDQ > 0 ? '' + toDQ : 'DQ!',
        label: 'TO DQ',
        col: _incRemainingColor(toDQ),
        intensity: toDQ <= 0 ? 0.55 : toDQ <= 3 ? 0.45 : 0.20 },
      { val: accruedPct + '%',
        label: 'ACCRUED',
        col: _incSeverityColor(count, dqLimit),
        intensity: Math.max(0.10, Math.min(0.40, count / dqLimit * 0.6)) }
    ];

    for (let i = 0; i < 4; i++) {
      const [x, y] = positions[i];
      const cell = cells[i];
      const hue = cell.col.hue;
      const sat = cell.col.sat;
      const intensity = cell.intensity;

      // Cell base fill
      _roundRect(ctx, x, y, cellW, cellH, 4 * dpr);
      ctx.fillStyle = `hsla(${hue}, ${sat}%, 12%, 0.6)`;
      ctx.fill();

      // Bottom-right cell: horizontal bar fill instead of radial glow
      if (i === 3) {
        const fillW = Math.max(0, (count / dqLimit) * cellW);
        if (fillW > 0) {
          ctx.save();
          _roundRect(ctx, x, y, cellW, cellH, 4 * dpr);
          ctx.clip();
          ctx.fillStyle = `hsla(${hue}, ${sat}%, 35%, ${intensity + 0.15})`;
          ctx.fillRect(x, y, fillW, cellH);
          ctx.restore();
        }

        // Penalty marker line
        const penX = x + (penLimit / dqLimit) * cellW;
        if (penX > x && penX < x + cellW) {
          ctx.beginPath();
          ctx.moveTo(penX, y + 2 * dpr);
          ctx.lineTo(penX, y + cellH - 2 * dpr);
          ctx.strokeStyle = `hsla(35, 80%, 55%, ${toPen <= 0 ? 0.3 : 0.6})`;
          ctx.lineWidth = 1 * dpr;
          ctx.setLineDash([2 * dpr, 2 * dpr]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      } else {
        // Heatmap radial glow (other cells)
        const cx = x + cellW / 2;
        const cy = y + cellH / 2;
        const rMax = Math.max(cellW, cellH) * 0.8;
        const radGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rMax);
        radGrad.addColorStop(0, `hsla(${hue}, ${sat}%, 45%, ${intensity})`);
        radGrad.addColorStop(0.6, `hsla(${hue}, ${sat}%, 30%, ${intensity * 0.4})`);
        radGrad.addColorStop(1, `hsla(${hue}, ${sat}%, 20%, 0)`);
        _roundRect(ctx, x, y, cellW, cellH, 4 * dpr);
        ctx.fillStyle = radGrad;
        ctx.fill();
      }

      // Border
      _roundRect(ctx, x, y, cellW, cellH, 4 * dpr);
      ctx.strokeStyle = `hsla(${hue}, ${sat}%, 50%, ${0.3 + intensity * 0.5})`;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Value text
      ctx.fillStyle = `hsla(${hue}, ${Math.max(sat, 30)}%, 70%, 0.95)`;
      ctx.font = `bold ${11 * dpr}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const cx2 = x + cellW / 2;
      const cy2 = y + cellH / 2;
      ctx.fillText(cell.val, cx2, cy2 - 2 * dpr);

      // Label
      ctx.fillStyle = `hsla(${hue}, ${Math.round(sat * 0.7)}%, 60%, 0.5)`;
      ctx.font = `${7 * dpr}px system-ui, sans-serif`;
      ctx.fillText(cell.label, cx2, cy2 + 10 * dpr);
    }

    if (_vizValueEl) _vizValueEl.textContent = '';
  }

  // ════════════════════════════════════════════
  //  COUNTER — simple large numeric (no canvas)
  // ════════════════════════════════════════════
  function _renderCounter(cfg) {
    const rawVal = _getVizValue(cfg.src);
    // Clear canvas
    if (_vizCtx && _vizCanvas) _vizCtx.clearRect(0, 0, _vizCanvas.width, _vizCanvas.height);

    let display;
    if (cfg.src === 'position' && rawVal > 0) display = 'P' + Math.round(rawVal);
    else if (cfg.src === 'sessionTime' && typeof rawVal === 'string') display = rawVal;
    else if (cfg.src === 'trackTemp') display = rawVal.toFixed(1) + '°C';
    else display = Math.round(rawVal);

    if (_vizValueEl) {
      _vizValueEl.textContent = display;
      _vizValueEl.style.color = '';
    }
  }

  // ═══════════════════════════════════════════════════════════════
