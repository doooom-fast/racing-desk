// WebGL utility functions and data

  const TACH_SEGS = 11;
  const tachoBar = document.getElementById('tachoBar');
  const rpmText = document.getElementById('rpmText');
  for (let i = 0; i < TACH_SEGS; i++) {
    const s = document.createElement('div');
    s.className = 'tacho-seg';
    tachoBar.appendChild(s);
  }

  const RPM_COLORS = {
    green: 'var(--green)',
    yellow: 'var(--amber)',
    red: 'var(--red)',
    dim: 'var(--text-dim)',
  };

  let _prevLitCount = 0;
  let _rpmPulseTimer = null;

  function updateTacho(pct) {
    const segs = tachoBar.children;
    const lit = Math.round(pct * TACH_SEGS);
    let topColor = 'dim';
    for (let i = 0; i < TACH_SEGS; i++) {
      segs[i].className = 'tacho-seg';
      if (i < lit) {
        const f = i / TACH_SEGS;
        if (f < 0.55) { segs[i].classList.add('lit-green'); topColor = 'green'; }
        else if (f < 0.73) { segs[i].classList.add('lit-yellow'); topColor = 'yellow'; }
        else if (f < 0.91) { segs[i].classList.add('lit-red'); topColor = 'red'; }
        else { segs[i].classList.add('lit-redline'); topColor = 'red'; }
        segs[i].style.height = '100%';
      } else {
        segs[i].style.height = '2px';
      }
    }
    rpmText.style.color = RPM_COLORS[topColor];

    // Pulse the RPM text when a new segment lights up
    if (lit > _prevLitCount && lit > 0) {
      const pulseClass = topColor === 'green' ? 'rpm-pulse-green'
        : topColor === 'yellow' ? 'rpm-pulse-yellow' : 'rpm-pulse-red';
      rpmText.classList.remove('rpm-pulse-green', 'rpm-pulse-yellow', 'rpm-pulse-red');
      // Force reflow so the class re-triggers the transition
      void rpmText.offsetWidth;
      rpmText.classList.add(pulseClass);
      if (_rpmPulseTimer) clearTimeout(_rpmPulseTimer);
      _rpmPulseTimer = setTimeout(() => {
        rpmText.classList.remove('rpm-pulse-green', 'rpm-pulse-yellow', 'rpm-pulse-red');
      }, 180);
    }
    _prevLitCount = lit;
  }
  updateTacho(0); // Will be driven by SimHub RPM data

  // ═══ LAYERED PEDAL HISTOGRAMS — DOM bars ═══
  // Render strategy: each bar is a DOM div with `transform-origin: bottom`
  // and `will-change: transform`. We only ever mutate `style.transform` (scaleY)
  // so the bars are GPU-composited — no layout, no paint, no style recalc on
  // the parent. Height is never touched. We cache all element refs at setup
  // time; no per-frame DOM lookups, no querySelector in the render loop.
  const HIST_BARS = 20;
  const _histChannels = []; // { bars: HTMLCollection, buf: Float32Array, head: number }

  function setupHist(id, cls) {
    const c = document.getElementById(id);
    if (!c) return null;
    for (let i = 0; i < HIST_BARS; i++) {
      const b = document.createElement('div');
      b.className = `pedal-hist-bar ${cls}`;
      if (i === HIST_BARS - 1) b.classList.add('live');
      c.appendChild(b);
    }
    return { bars: c.children, buf: new Float32Array(HIST_BARS), head: 0 };
  }
  const _thrChan = setupHist('throttleHist', 'throttle');
  const _brkChan = setupHist('brakeHist', 'brake');
  const _cltChan = setupHist('clutchHist', 'clutch');
  if (_thrChan) _histChannels.push(_thrChan);
  if (_brkChan) _histChannels.push(_brkChan);
  if (_cltChan) _histChannels.push(_cltChan);

  // Ring-buffer push: O(1), no allocations, no Array#shift churn.
  // `head` points at the oldest slot (which becomes the newest after we write).
  function _pushHist(chan, v) {
    chan.buf[chan.head] = v;
    chan.head = (chan.head + 1) % HIST_BARS;
  }

  // Render reads the ring buffer in oldest→newest order and applies scaleY.
  function _renderChan(chan) {
    if (!chan) return;
    const { bars, buf, head } = chan;
    for (let i = 0; i < HIST_BARS; i++) {
      const v = buf[(head + i) % HIST_BARS];
      bars[i].style.transform = 'scaleY(' + (v > 0.01 ? v : 0.01) + ')';
    }
  }

  // Initialize empty
  if (_thrChan) _renderChan(_thrChan);
  if (_brkChan) _renderChan(_brkChan);
  if (_cltChan) _renderChan(_cltChan);

  // ═══ PEDAL TRACE — curve-following dots + trail (2D canvas) ═══
  // When a pedal profile is active, dots travel along the response curves.
  // Falls back to time-series waveforms when no profile is loaded.
  const _pedalTraceLen = 120;
  const _ptThr = new Float32Array(_pedalTraceLen);
  const _ptBrk = new Float32Array(_pedalTraceLen);
  const _ptClt = new Float32Array(_pedalTraceLen);
  let _ptIdx = 0;
  let _ptCount = 0;
  const _ptCanvas = document.getElementById('pedalTraceCanvas');
  const _ptCtx = _ptCanvas ? _ptCanvas.getContext('2d') : null;

  // Cache canvas backing-store size and update only on resize. Calling
  // getBoundingClientRect() in the render loop forces a sync layout every
  // frame; with a ResizeObserver we sync size off the layout thread instead.
  let _ptW = 0, _ptH = 0;
  if (_ptCanvas && typeof ResizeObserver !== 'undefined') {
    const _ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const cr = e.contentRect;
        const w = Math.round(cr.width) || 240;
        const h = Math.round(cr.height) || 80;
        if (_ptCanvas.width !== w) _ptCanvas.width = w;
        if (_ptCanvas.height !== h) _ptCanvas.height = h;
        _ptW = w; _ptH = h;
      }
    });
    _ro.observe(_ptCanvas);
  } else if (_ptCanvas) {
    // Fallback: one-shot size at load
    const r = _ptCanvas.getBoundingClientRect();
    _ptW = _ptCanvas.width = Math.round(r.width) || 240;
    _ptH = _ptCanvas.height = Math.round(r.height) || 80;
  }

  // Cache the three percentage label nodes. Doing querySelectorAll('.pedal-pct')
  // every frame walks the entire document; once cached this is just three
  // textContent writes per frame.
  let _pedalPctEls = null;
  function _getPctEls() {
    if (_pedalPctEls && _pedalPctEls[0] && _pedalPctEls[0].isConnected) return _pedalPctEls;
    const list = document.querySelectorAll('.pedal-pct');
    _pedalPctEls = list.length >= 3 ? [list[0], list[1], list[2]] : null;
    return _pedalPctEls;
  }

  // Trail history for curve-following dots (stores canvas positions)
  const _trailLen = 16;
  const _thrTrail = [];
  const _brkTrail = [];
  const _cltTrail = [];

  // ─── rAF-gated pedal rendering ───
  let _pedalRafId = 0;
  let _pedalPending = false;
  let _pendingThr = 0, _pendingBrk = 0, _pendingClt = 0;

  function renderPedalTrace(thr, brk, clt) {
    _pendingThr = thr;
    _pendingBrk = brk;
    _pendingClt = clt;
    if (!_pedalPending) {
      _pedalPending = true;
      _pedalRafId = requestAnimationFrame(_flushPedalFrame);
    }
  }

  function _flushPedalFrame() {
    _pedalPending = false;
    const thr = _pendingThr, brk = _pendingBrk, clt = _pendingClt;

    // Push into the three ring buffers and render. No allocations, no
    // Array#shift (which is O(n)), no per-frame DOM lookups.
    if (_thrChan) { _pushHist(_thrChan, thr); _renderChan(_thrChan); }
    if (_brkChan) { _pushHist(_brkChan, brk); _renderChan(_brkChan); }
    if (_cltChan) { _pushHist(_cltChan, clt); _renderChan(_cltChan); }

    // Update percentage labels via cached refs (no querySelectorAll per frame).
    const pct = _getPctEls();
    if (pct) {
      pct[0].textContent = Math.round(thr * 100) + '%';
      pct[1].textContent = Math.round(brk * 100) + '%';
      pct[2].textContent = Math.round(clt * 100) + '%';
    }

    if (!_ptCtx) return;
    // Canvas size is tracked by ResizeObserver; no getBoundingClientRect here.
    const w = _ptW, h = _ptH;
    if (!w || !h) return;
    const ctx = _ptCtx;
    ctx.clearRect(0, 0, w, h);

    // ── Curve-following mode: dots travel along response curves ──
    const curvePos = window.getCurvePositions ? window.getCurvePositions(thr, brk, clt) : null;
    if (curvePos && curvePos.length > 0) {
      _renderCurveDots(ctx, curvePos, thr, brk, clt);
      return;
    }

    // ── Fallback: time-series waveforms (no profile loaded) ──
    _ptThr[_ptIdx] = thr;
    _ptBrk[_ptIdx] = brk;
    _ptClt[_ptIdx] = clt;
    _ptIdx = (_ptIdx + 1) % _pedalTraceLen;
    _ptCount++;

    const count = Math.min(_ptCount, _pedalTraceLen);
    if (count < 3) return;

    const traces = [
      { buf: _ptThr, color: [76, 175, 80] },
      { buf: _ptBrk, color: [244, 67, 54] },
      { buf: _ptClt, color: [66, 165, 245] },
    ];

    for (const tr of traces) {
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const idx = (_ptIdx - count + i + _pedalTraceLen) % _pedalTraceLen;
        const x = (i / (count - 1)) * w;
        const y = h - tr.buf[idx] * (h - 2) - 1;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      const [r, g, b] = tr.color;
      grad.addColorStop(0, `rgba(${r},${g},${b},0.0)`);
      grad.addColorStop(0.3, `rgba(${r},${g},${b},0.08)`);
      grad.addColorStop(0.7, `rgba(${r},${g},${b},0.2)`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0.45)`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.stroke();

      const lastIdx = (_ptIdx - 1 + _pedalTraceLen) % _pedalTraceLen;
      const lastVal = tr.buf[lastIdx];
      if (lastVal > 0.02) {
        const lx = w - 1;
        const ly = h - lastVal * (h - 2) - 1;
        ctx.beginPath();
        ctx.arc(lx, ly, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},0.6)`;
        ctx.fill();
      }
    }
  }

  // ── Curve-following dot renderer ──
  // Each dot sits on the response curve at the current pedal input position.
  // A fading trail of recent positions shows movement along the curve.
  function _renderCurveDots(ctx, positions, thr, brk, clt) {
    // Update trails — map pedal values to their corresponding trail arrays
    const trailMap = [
      { trail: _thrTrail, val: thr },
      { trail: _brkTrail, val: brk },
      { trail: _cltTrail, val: clt },
    ];

    // Push new positions into trail buffers
    for (const pos of positions) {
      let trail;
      if (pos.rgb[0] === 76) trail = _thrTrail;        // green = throttle
      else if (pos.rgb[0] === 244) trail = _brkTrail;   // red = brake
      else trail = _cltTrail;                            // blue = clutch

      trail.push({ x: pos.x, y: pos.y });
      while (trail.length > _trailLen) trail.shift();
    }

    // Clear trails for pedals not in positions (below threshold)
    if (thr <= 0.01) _thrTrail.length = 0;
    if (brk <= 0.01) _brkTrail.length = 0;
    if (clt <= 0.01) _cltTrail.length = 0;

    // Draw trails + dots
    const allTrails = [
      { trail: _thrTrail, rgb: [76, 175, 80] },
      { trail: _brkTrail, rgb: [244, 67, 54] },
      { trail: _cltTrail, rgb: [66, 165, 245] },
    ];

    for (const { trail, rgb } of allTrails) {
      if (trail.length < 1) continue;
      const [r, g, b] = rgb;

      // Draw fading trail line
      if (trail.length >= 2) {
        for (let i = 1; i < trail.length; i++) {
          const alpha = (i / trail.length) * 0.35;
          ctx.beginPath();
          ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
          ctx.lineTo(trail[i].x, trail[i].y);
          ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      // Draw glowing dot at current position
      const cur = trail[trail.length - 1];

      // Outer glow
      ctx.beginPath();
      ctx.arc(cur.x, cur.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r},${g},${b},0.15)`;
      ctx.fill();

      // Inner glow
      ctx.beginPath();
      ctx.arc(cur.x, cur.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r},${g},${b},0.5)`;
      ctx.fill();

      // Core dot
      ctx.beginPath();
      ctx.arc(cur.x, cur.y, 2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r},${g},${b},0.9)`;
      ctx.fill();
    }
  }

  // ═══ COMMENTARY ═══
  const col = document.getElementById('commentaryCol');
  const dash = document.getElementById('dashboard');
  const inner = document.getElementById('commentaryInner');

  // ── Commentary icon library ──
  // Each SVG uses currentColor so it inherits the sentiment hue via style.color.
  // viewBox 0 0 24 24, stroke-based, 1.5px stroke for clarity at 28px render size.
  const _s = (d, extra) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"${extra||''}>${d}</svg>`;
  const _commentaryIcons = {
    // ── car_response ──
    spin_catch:        _s('<path d="M12 2v4"/><path d="M12 18v4"/><path d="M4.93 4.93l2.83 2.83"/><path d="M16.24 16.24l2.83 2.83"/><path d="M2 12h4"/><path d="M18 12h4"/><path d="M4.93 19.07l2.83-2.83"/><path d="M16.24 7.76l2.83-2.83"/><circle cx="12" cy="12" r="3"/><path d="M14.5 9.5l3-3" stroke-dasharray="2 2"/>'),
    wall_contact:      _s('<rect x="2" y="4" width="4" height="16" rx="1"/><path d="M6 12h5"/><path d="M11 8l4 4-4 4"/><path d="M15 7l2 2-2 2"/><path d="M17 13l2 2-2 2"/><circle cx="19" cy="6" r="1" fill="currentColor" stroke="none"/>'),
    off_track:         _s('<path d="M3 20L12 4l9 16H3z"/><path d="M12 10v4"/><circle cx="12" cy="17" r="0.5" fill="currentColor"/>'),
    kerb_hit:          _s('<path d="M3 18h18"/><path d="M3 18l3-3h2l3-3h2l3-3h2l3-3"/><path d="M8 12v6"/><path d="M16 6v12"/><circle cx="12" cy="9" r="2"/>'),
    high_cornering_load: _s('<circle cx="12" cy="12" r="9"/><path d="M12 12l6-3"/><path d="M12 3v2"/><path d="M12 19v2"/><path d="M3 12h2"/><path d="M19 12h2"/><path d="M5.64 5.64l1.41 1.41"/><path d="M16.95 16.95l1.41 1.41"/>'),
    heavy_braking:     _s('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><rect x="10" y="6" width="4" height="5" rx="1" fill="currentColor" stroke="none" opacity="0.5"/><path d="M8 12h8"/><path d="M12 8v8"/>'),
    car_balance_sustained: _s('<path d="M4 16l4-8h8l4 8"/><circle cx="8" cy="16" r="2"/><circle cx="16" cy="16" r="2"/><path d="M12 4v4"/><path d="M10 6h4"/>'),
    rapid_gear_change: _s('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7v4h3V7"/><path d="M12 11v4h3v-4"/><path d="M9 15v3"/><circle cx="12" cy="19" r="0.5" fill="currentColor"/>'),

    // ── hardware ──
    abs_activation:    _s('<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 11h2l1-2 1 4 1-4 1 2h2"/>', ' stroke-width="1.8"'),
    tc_intervention:   _s('<path d="M12 3a9 9 0 1 0 0 18"/><path d="M12 3a9 9 0 0 1 0 18"/><path d="M9 9l6 6"/><path d="M9 9h3v3"/>'),
    ffb_torque_spike:  _s('<path d="M12 2v20"/><path d="M2 12h20"/><path d="M7 7c2 2 3 5 5 5s3-3 5-5"/><path d="M7 17c2-2 3-5 5-5s3 3 5 5"/>'),
    brake_bias_change: _s('<circle cx="12" cy="12" r="9"/><path d="M12 3v18"/><path d="M8 8h-1a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1"/><path d="M16 8h1a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-1"/><path d="M8 12h8" stroke-dasharray="2 1"/>'),
    tc_setting_change: _s('<circle cx="12" cy="12" r="9"/><path d="M8 8h8"/><path d="M12 8v8"/><path d="M9 15l3-3 3 3" stroke-dasharray="2 1"/>'),
    abs_setting_change: _s('<circle cx="12" cy="12" r="9"/><path d="M7 12h10"/><path d="M7 9h10"/><path d="M7 15h10"/><circle cx="14" cy="12" r="1.5" fill="currentColor" stroke="none"/>'),
    arb_front_change:  _s('<path d="M4 16h16"/><path d="M6 16V8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8"/><path d="M10 12h4" stroke-dasharray="2 1"/><path d="M8 10l2 2-2 2"/>'),
    arb_rear_change:   _s('<path d="M4 8h16"/><path d="M6 8v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8"/><path d="M10 12h4" stroke-dasharray="2 1"/><path d="M16 10l-2 2 2 2"/>'),

    // ── game_feel ──
    qualifying_push:   _s('<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8"/>'),
    drs_active:        _s('<path d="M2 8h20"/><path d="M4 8l2 10h12l2-10"/><path d="M8 8V5a4 4 0 0 1 8 0v3"/><path d="M10 12h4" stroke-dasharray="3 2"/>'),
    ers_low:           _s('<path d="M2 12h4l2-4 3 8 3-8 2 4h4"/><path d="M18 6l2 2-2 2"/>'),
    personal_best:     _s('<path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.3L12 16.7l-6.2 4.5 2.4-7.3L2 9.4h7.6z"/>'),
    long_stint:        _s('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/><path d="M16 4l2 2"/><path d="M8 4L6 6"/>'),
    session_time_low:  _s('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/><path d="M3 3l3 3"/><path d="M21 3l-3 3"/>'),

    // ── racing_experience ──
    close_battle:      _s('<path d="M5 17l3-12h3l2 5 2-5h3l3 12"/><path d="M4 10h16" stroke-dasharray="3 2"/><circle cx="8" cy="17" r="1.5"/><circle cx="16" cy="17" r="1.5"/>'),
    position_gained:   _s('<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>'),
    position_lost:     _s('<path d="M12 5v14"/><path d="M5 12l7 7 7-7"/>'),
    yellow_flag:       _s('<path d="M5 2v20"/><path d="M5 4h12l-3 4 3 4H5"/>'),
    debris_on_track:   _s('<path d="M3 20h18"/><path d="M7 17l2-5"/><path d="M12 12l-1-4"/><path d="M15 14l2-6"/><path d="M10 17l1-3"/><circle cx="8" cy="10" r="1" fill="currentColor"/><circle cx="14" cy="7" r="1.5" fill="currentColor"/><circle cx="17" cy="11" r="1" fill="currentColor"/>'),
    race_start:        _s('<circle cx="8" cy="6" r="2.5"/><circle cx="16" cy="6" r="2.5"/><circle cx="8" cy="12" r="2.5"/><circle cx="16" cy="12" r="2.5"/><circle cx="8" cy="18" r="2.5" fill="currentColor" opacity="0.3"/><circle cx="16" cy="18" r="2.5" fill="currentColor" opacity="0.3"/>'),
    formation_lap:     _s('<path d="M3 6h18"/><path d="M7 6v12"/><path d="M12 6v12"/><path d="M17 6v12"/><path d="M5 14h14" stroke-dasharray="2 2"/><path d="M3 18h18"/>'),
    pit_entry:         _s('<path d="M3 12h4l2-3h6l2 3h4"/><path d="M7 12v5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-5"/><circle cx="9" cy="15" r="1"/><circle cx="15" cy="15" r="1"/><path d="M11 5h2v4h-2z" fill="currentColor" stroke="none"/><path d="M10 5h4"/>'),
    low_fuel:          _s('<rect x="5" y="4" width="14" height="16" rx="2"/><path d="M9 4V2h6v2"/><path d="M9 12h6"/><path d="M12 12v5"/><path d="M8 18h8" stroke-dasharray="2 1"/>'),
    wet_track:         _s('<path d="M4 14a4 4 0 0 1 4-4 4 4 0 0 1 4 4 4 4 0 0 0 4-4 4 4 0 0 1 4 4"/><path d="M4 18a4 4 0 0 1 4-4 4 4 0 0 1 4 4 4 4 0 0 0 4-4 4 4 0 0 1 4 4"/><path d="M8 3v3"/><path d="M12 2v4"/><path d="M16 3v3"/>'),
    track_temp_cold:   _s('<path d="M12 2v14"/><circle cx="12" cy="18" r="4"/><path d="M8 18a4 4 0 0 0 8 0"/><path d="M10 8h4"/><path d="M10 11h4"/><path d="M3 5l2 1"/><path d="M3 9l2-1"/>'),
    track_temp_hot:    _s('<path d="M12 2v14"/><circle cx="12" cy="18" r="4" fill="currentColor" opacity="0.2"/><path d="M8 18a4 4 0 0 0 8 0"/><path d="M10 8h4"/><path d="M10 11h4"/><path d="M18 3l1 3"/><path d="M20 8l-2 1"/><path d="M19 12l-2-1"/>'),
    tyre_wear_high:    _s('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M9 7l6 10" stroke-dasharray="2 2"/><path d="M15 7l-6 10" stroke-dasharray="2 2"/>'),
    hot_tyres:         _s('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v3"/><path d="M12 18v3"/><path d="M3 12h3"/><path d="M18 12h3"/><path d="M10 10l-3-3" stroke-dasharray="1.5 1.5"/><path d="M14 14l3 3" stroke-dasharray="1.5 1.5"/>'),
    incident_spike:    _s('<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><circle cx="12" cy="16" r="0.5" fill="currentColor"/>'),
    black_flag:        _s('<path d="M5 2v20"/><path d="M5 4h14v8H5"/><path d="M5 4h7v4H5" fill="currentColor" opacity="0.4"/><path d="M12 8h7v4h-7" fill="currentColor" opacity="0.4"/>'),

    // strategy engine
    strategy_call:     _s('<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>'),

    // fallback
    _default:          _s('<circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 3"/>')
  };

  // Title → topicId reverse map (fallback when CommentaryTopicId isn't available). Looked up in lower case: the titles
  // are in sentence case since 2026-10-02 ("Anti-lock activation"), and a plugin from before sends them in title case
  // with their acronyms ("ABS Activation"), so both are here where they differ by more than case.
  const _titleToTopicId = {
    'big save': 'spin_catch',
    'wall / barrier contact': 'wall_contact',
    'off track': 'off_track',
    'kerb / curb hit': 'kerb_hit',
    'anti-lock activation': 'abs_activation', 'abs activation': 'abs_activation',
    'traction control cut': 'tc_intervention',
    'close racing': 'close_battle',
    'position gained': 'position_gained',
    'position lost': 'position_lost',
    'yellow flag': 'yellow_flag',
    'debris on track': 'debris_on_track',
    'race start': 'race_start',
    'formation / pace lap': 'formation_lap',
    'personal best lap': 'personal_best',
    'pit lane entry': 'pit_entry',
    'maximum cornering load': 'high_cornering_load',
    'force feedback torque spike': 'ffb_torque_spike', 'ffb torque spike': 'ffb_torque_spike',
    'low fuel': 'low_fuel',
    'wet conditions': 'wet_track',
    'cold track conditions': 'track_temp_cold',
    'high tyre wear': 'tyre_wear_high',
    'overheating tyres': 'hot_tyres',
    'major braking zone': 'heavy_braking',
    'hot qualifying lap': 'qualifying_push',
    'iracing incident points': 'incident_spike',
    'hybrid battery low': 'ers_low', 'ers battery low': 'ers_low',
    'high track temperature': 'track_temp_hot',
    'drs open': 'drs_active',
    'car on the limit': 'car_balance_sustained',
    'black flag': 'black_flag',
    'aggressive gear shift': 'rapid_gear_change',
    'long stint distance': 'long_stint',
    'session time running out': 'session_time_low',
    'brake bias adjustment': 'brake_bias_change',
    'traction control adjusted': 'tc_setting_change',
    'anti-lock level adjusted': 'abs_setting_change', 'abs level adjusted': 'abs_setting_change',
    'front rollbar adjusted': 'arb_front_change', 'front arb adjusted': 'arb_front_change',
    'rear rollbar adjusted': 'arb_rear_change', 'rear arb adjusted': 'arb_rear_change',
  };
  // Category → icon fallback (when neither topicId nor title match)
  const _categoryIcons = {
    car_response:       _commentaryIcons['car_balance_sustained'],
    hardware:           _commentaryIcons['abs_activation'],
    game_feel:          _commentaryIcons['qualifying_push'],
    racing_experience:  _commentaryIcons['close_battle'],
    strategy:           _s('<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>'),
  };

  function _resolveCommentaryIcon(topicId, title, category) {
    if (topicId && _commentaryIcons[topicId]) return _commentaryIcons[topicId];
    const idFromTitle = typeof title === 'string' ? _titleToTopicId[title.toLowerCase()] : undefined;
    if (idFromTitle && _commentaryIcons[idFromTitle]) return _commentaryIcons[idFromTitle];
    if (category && _categoryIcons[category]) return _categoryIcons[category];
    return _commentaryIcons['_default'];
  }

  // Overheating topics → force orange (hue 30) or red (hue 0) based on severity
  const _heatTopics = { hot_tyres: true, track_temp_hot: true };
  // Wear / degradation topics → force orange hue
  const _wearTopics = { tyre_wear_high: true, long_stint: true };
  // Best / achievement topics → force green color scheme
  const _bestTopics = { personal_best: true, position_gained: true };

  function showCommentary(hue, title, text, meta, topicId, severity, trackImage) {
    // Resolve topic early so we can override hue for heat, wear & best topics
    const resolvedTopic = topicId || _titleToTopicId[title] || '';
    if (_heatTopics[resolvedTopic]) {
      hue = (severity >= 3) ? 0 : 30;   // high severity → red, else orange
    } else if (_wearTopics[resolvedTopic]) {
      hue = 30;                           // orange for wear/degradation
    } else if (_bestTopics[resolvedTopic]) {
      hue = 145;                          // green for achievements
    }

    col.style.setProperty('--commentary-h', hue);
    inner.style.background = `hsla(${hue}, 50%, 13%, 0.96)`;
    inner.style.borderColor = `hsla(${hue}, 50%, 27%, 0.50)`;
    document.getElementById('commentaryTitle').textContent = title;
    document.getElementById('commentaryTitle').style.color = `hsl(${hue},55%,65%)`;
    // Set commentary icon — try topicId, then title lookup, then category, then default
    const iconEl = document.getElementById('commentaryIcon');
    const iconColor = `hsl(${hue},55%,65%)`;
    const svgStr = _resolveCommentaryIcon(topicId, title, meta);
    iconEl.innerHTML = svgStr;
    iconEl.style.color = iconColor;
    const textEl = document.getElementById('commentaryText');
    const scrollEl = document.getElementById('commentaryScroll');
    textEl.textContent = text;
    textEl.classList.remove('scrolling');
    scrollEl.classList.remove('no-overflow');
    document.getElementById('commentaryMeta').textContent = meta;

    // Track image — show when URL provided by track-related commentary
    const imgEl = document.getElementById('commentaryTrackImg');
    if (trackImage) {
      imgEl.style.backgroundImage = `url(${trackImage})`;
      imgEl.innerHTML = '<span class="img-attr">Wikimedia Commons \u00B7 CC</span>';
      imgEl.classList.add('active');
    } else {
      imgEl.classList.remove('active');
    }

    col.classList.add('visible');
    dash.style.setProperty('--sentiment-h', hue);
    dash.style.setProperty('--sentiment-s', '40%');
    dash.style.setProperty('--sentiment-l', '12%');
    dash.style.setProperty('--sentiment-alpha', '0.06');

    // Activate data visualization for this topic (hue already overridden for heat)
    if (window.showCommentaryViz) window.showCommentaryViz(resolvedTopic, hue);
    // Activate WebGL trail effect on commentary border
    if (window.setCommentaryTrailGL) window.setCommentaryTrailGL(true, hue);

    // After width transition settles (~600ms), measure overflow for slow scroll
    setTimeout(() => {
      const scrollH = scrollEl.clientHeight;
      const textH = textEl.scrollHeight;
      if (textH > scrollH + 4) {
        const overflow = textH - scrollH;
        textEl.style.setProperty('--scroll-distance', `-${overflow}px`);
        // Duration: ~40px/s so it reads comfortably
        const duration = Math.max(6, overflow / 40 * 2 + 4);
        textEl.style.setProperty('--scroll-duration', `${duration.toFixed(1)}s`);
        textEl.classList.add('scrolling');
      } else {
        scrollEl.classList.add('no-overflow');
      }
    }, 620);  // wait for commentary-col max-height transition (0.55s) to finish
  }
  function hideCommentary() {
    col.classList.remove('visible');
    dash.style.setProperty('--sentiment-alpha', '0');
    if (window.hideCommentaryViz) window.hideCommentaryViz();
    if (window.setCommentaryTrailGL) window.setCommentaryTrailGL(false);
    // Clear track image
    const imgEl = document.getElementById('commentaryTrackImg');
    if (imgEl) imgEl.classList.remove('active');
  }

  // ═══ CYCLING PANELS (rating/position only — fuel/tyres no longer cycle) ═══
  let ratingActive = true;

  let _hasRatingData = false; // set true when iRating or SR become nonzero
  // Allow external modules (rating-editor.js) to flag rating data as available
  window.setHasRatingData = function(val) { _hasRatingData = !!val; };
  // Expose current cycle state so poll-engine can use asymmetric timing
  window._isRatingPageActive = function() { return ratingActive; };
  function cycleRatingPos() {
    // Don't cycle to rating page if no iRating/SR data is available
    if (!_hasRatingData) return;
    const r = document.getElementById('ratingPage');
    const p = document.getElementById('positionPage');
    const d1 = document.getElementById('dotRating');
    const d2 = document.getElementById('dotPos');
    if (ratingActive) {
      r.classList.replace('active', 'inactive');
      p.classList.replace('inactive', 'active');
      d1.classList.remove('active'); d2.classList.add('active');
    } else {
      p.classList.replace('active', 'inactive');
      r.classList.replace('inactive', 'active');
      d2.classList.remove('active'); d1.classList.add('active');
    }
    ratingActive = !ratingActive;
  }

  // Force position page visible (used when timer row is showing)
  function showPositionPage() {
    const r = document.getElementById('ratingPage');
    const p = document.getElementById('positionPage');
    const d1 = document.getElementById('dotRating');
    const d2 = document.getElementById('dotPos');
    if (ratingActive) {
      r.classList.replace('active', 'inactive');
      p.classList.replace('inactive', 'active');
      d1.classList.remove('active'); d2.classList.add('active');
      ratingActive = false;
    }
  }

  // Cycling interval — call cycleRatingPos() from SimHub timer or JS setInterval
  // setInterval(cycleRatingPos, 10000);

  // ═══ iRATING BAR CHART ═══
  function updateIRBar(iRating) {
    const maxIR = 5000;
    const pct = Math.min(100, (iRating / maxIR) * 100);
    document.getElementById('irBarFill').style.width = pct + '%';
  }
  updateIRBar(0); // Will be set from session data

  // ═══ SAFETY RATING PIE CHART ═══
  function updateSRPie(srValue) {
    const pct = Math.min(1, srValue / 4.0);
    const circ = 2 * Math.PI * 15; // ~94.25
    const offset = circ * (1 - pct);
    const fill = document.getElementById('srPieFill');
    fill.setAttribute('stroke-dashoffset', offset);
    // Color: green if > 3.0, amber if > 2.0, red if lower
    if (srValue >= 3.0) fill.setAttribute('stroke', 'var(--green)');
    else if (srValue >= 2.0) fill.setAttribute('stroke', 'var(--amber)');
    else fill.setAttribute('stroke', 'var(--red)');
    // text label removed
  }
  updateSRPie(0); // Will be set from session data

  // ═══ FLASH SYSTEM ═══
  function flashElement(el, className) {
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
    setTimeout(() => el.classList.remove(className), 1500);
  }

  function flashCtrlBar(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('ctrl-changed', 'ctrl-flash-out');
    void el.offsetWidth;
    el.classList.add('ctrl-changed');
    setTimeout(() => {
      el.classList.remove('ctrl-changed');
      el.classList.add('ctrl-flash-out');
      setTimeout(() => el.classList.remove('ctrl-flash-out'), 1200);
    }, 300);
  }

  // ═══ CONTROL VISIBILITY ═══
  // Hide TC/ABS ctrl-items when the car doesn't have them
  function setCtrlVisibility(hasBB, hasTC, hasABS) {
    const bb = document.getElementById('ctrlBB');
    const tc = document.getElementById('ctrlTC');
    const abs = document.getElementById('ctrlABS');
    if (bb) bb.classList.toggle('ctrl-hidden', !hasBB);
    if (tc) tc.classList.toggle('ctrl-hidden', !hasTC);
    if (abs) abs.classList.toggle('ctrl-hidden', !hasABS);
    // Show "No Adjustments" when none are available
    const panel = bb && bb.closest('.car-controls');
    if (panel) panel.classList.toggle('no-adj', !hasBB && !hasTC && !hasABS);
  }

  // ═══ TYRE TEMPERATURE COLORING ═══
  // Returns CSS class based on tyre temp (°F for iRacing)
  function getTyreTempClass(tempF) {
    if (tempF <= 0) return '';
    if (tempF < 150) return 'cold';       // < 66°C
    if (tempF < 230) return 'optimal';     // 66-110°C
    if (tempF < 270) return 'hot';         // 110-132°C
    return 'danger';                       // > 132°C
  }

  // Update a single tyre cell: temp value + color class + wear bar.
  // wearPct is tread REMAINING, as the wire has it: 100 = brand new, 0 = destroyed, -1 = not measured
  // (root CLAUDE.md, Tyre wear). dashboard.html has no .tyre-cell any more, so this returns at once.
  function updateTyreCell(index, tempF, wearPct) {
    const cells = document.querySelectorAll('.tyre-cell');
    const wearFills = document.querySelectorAll('.tyre-wear-fill');
    if (index >= cells.length) return;
    const cell = cells[index];

    // No wear data — show empty bar with dim indicator
    if (wearPct < 0) {
      if (index < wearFills.length) {
        wearFills[index].style.width = '0%';
        wearFills[index].style.background = 'hsla(0,0%,100%,0.1)';
      }
      // Still update temp
      cell.textContent = tempF > 0 ? Math.round(tempF) + '°' : '—';
      cell.className = 'tyre-cell ' + getTyreTempClass(tempF);
      return;
    }

    cell.textContent = tempF > 0 ? Math.round(tempF) + '°' : '—';
    cell.className = 'tyre-cell ' + getTyreTempClass(tempF);
    if (index < wearFills.length) {
      wearFills[index].style.width = Math.max(0, Math.min(100, wearPct)) + '%';
      // Colour by tread remaining at the engine's thresholds: red under 20, amber under 35, green above
      if (wearPct < TYRE_WEAR_CRIT_BELOW) wearFills[index].style.background = 'var(--red)';
      else if (wearPct < TYRE_WEAR_WARN_BELOW) wearFills[index].style.background = 'var(--amber)';
      else wearFills[index].style.background = 'var(--green)';
    }
  }

  // ═══ FUEL STATE ═══
  function updateFuelBar(pct, pitLapPct) {
    const bar = document.querySelector('.fuel-bar-inner');
    if (!bar) return;
    bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
    bar.className = 'fuel-bar-inner';
    if (pct > 40) bar.classList.add('healthy');
    else if (pct > 15) bar.classList.add('caution');
    else bar.classList.add('critical');
    // Pit marker
    const marker = document.querySelector('.fuel-bar-pit-marker');
    if (marker && pitLapPct > 0) {
      marker.style.left = Math.min(100, pitLapPct) + '%';
      marker.style.display = '';
    } else if (marker) {
      marker.style.display = 'none';
    }
  }

  // ═══ TRACK MAP ═══
  let _mapLastPath = '';
  let _mapSmoothedX = 0, _mapSmoothedY = 0;
  let _mapHasInit = false;
  const _SVG_NS = 'http://www.w3.org/2000/svg';
  const _MAP_MAX_OPPONENTS = 63; // iRacing max field size

  // G-force animation trail on player dot — ring buffer of recent positions
  let _fullMapTrailEl = null;
  let _zoomMapTrailEl = null;
  // One-shot flag: did we log whether the trail polylines attached?
  let _trailCheckDone = false;

  // Parsed track path coordinates for snapping and off-track detection
  let _trackPathCoords = []; // [{x, y}, ...]
  const _OFF_TRACK_DIST = 4.0; // SVG units — beyond this, player is off-track

  // Trail: draws a section of the actual track path behind the player,
  // fading from transparent at the tail to opaque near the car.
  // On turn entry the trail fades out gradually instead of snapping away.
  const _TURN_G_THRESHOLD = 0.5;
  var _wasInTurn = false;
  var _trailStartIdx = -1;  // index in _trackPathCoords where current trail begins
  var _trailFading = false;  // true while trail is shrinking toward player
  const _TRAIL_FADE_SPEED = 12; // indices to advance _trailStartIdx per frame during fade
  // Where the car was on the outline a frame ago, and how far round the lap one frame may take it: a car does not
  // drive a fiftieth of the lap in a frame, so more than that is a teleport (a reset or a tow to the pits, out of the
  // car and back in) and the trail that was behind the car is not behind it any more.
  var _prevPlayerIdx = -1;
  const _TRAIL_TELEPORT_LAP_FRACTION = 0.02;
  function _forgetTrail() { _trailStartIdx = -1; _trailFading = false; _prevPlayerIdx = -1; }

  // 25% of the track path length (in coordinate indices)
  function _trailMaxLen() {
    return Math.max(4, Math.floor(_trackPathCoords.length * 0.25));
  }

  function _ensureTrailPolyline(parentId, refElId, trailId) {
    var parent = document.getElementById(parentId);
    if (!parent) return null;
    var trail = document.getElementById(trailId);
    if (trail) return trail;

    // Create SVG gradient: transparent at tail → trail color at head
    var svgRoot = parent.closest('svg') || parent.ownerSVGElement;
    if (svgRoot) {
      var defs = svgRoot.querySelector('defs');
      if (!defs) {
        defs = document.createElementNS(_SVG_NS, 'defs');
        svgRoot.insertBefore(defs, svgRoot.firstChild);
      }
      var gradId = trailId + '-grad';
      if (!document.getElementById(gradId)) {
        var grad = document.createElementNS(_SVG_NS, 'linearGradient');
        grad.id = gradId;
        grad.setAttribute('gradientUnits', 'userSpaceOnUse');
        var stop0 = document.createElementNS(_SVG_NS, 'stop');
        stop0.setAttribute('offset', '0%');
        stop0.setAttribute('stop-color', '#00acc1');
        stop0.setAttribute('stop-opacity', '0');
        var stop1 = document.createElementNS(_SVG_NS, 'stop');
        stop1.setAttribute('offset', '100%');
        stop1.setAttribute('stop-color', '#00acc1');
        stop1.setAttribute('stop-opacity', '0.90');
        grad.appendChild(stop0);
        grad.appendChild(stop1);
        defs.appendChild(grad);
      }
    }

    trail = document.createElementNS(_SVG_NS, 'polyline');
    trail.id = trailId;
    trail.setAttribute('fill', 'none');
    trail.setAttribute('stroke', 'url(#' + trailId + '-grad)');
    trail.setAttribute('stroke-linecap', 'round');
    trail.setAttribute('stroke-linejoin', 'round');
    var refEl = document.getElementById(refElId);
    if (refEl) parent.insertBefore(trail, refEl);
    else parent.appendChild(trail);
    return trail;
  }

  // `near` is where the car is on the outline (_nearestTrackPoint): the point of the outline at or behind it (`seg`) and
  // the place on the line itself (`x`, `y`). The trail runs along the outline's points to that one and then to the car,
  // so it ends at the car and not at the nearest point of the outline, which at the iPad's closest view is a few pixels
  // away. Written to a thousandth of a unit, as the view's box is: a tenth was three pixels there.
  function _renderTrackTrail(trailEl, strokeWidth, near) {
    var playerIdx = near ? near.seg : -1;
    if (!trailEl || playerIdx < 0 || _trackPathCoords.length < 4) {
      if (trailEl) trailEl.setAttribute('points', '');
      return;
    }

    var maxLen = _trailMaxLen();
    var n = _trackPathCoords.length;

    // After S/F or pit-exit reset (_trailStartIdx === -1), anchor the trail
    // start to the player's current position so it grows from here — never
    // wrapping backward across the start/finish line.
    if (_trailStartIdx < 0) {
      _trailStartIdx = playerIdx;
    }

    // Walk backward from player along track path, up to maxLen points
    // or until we hit the trail start (turn entry / lap boundary)
    var startIdx = _trailStartIdx;
    // How many points back from player to the trail start?
    var backDist = (playerIdx - startIdx + n) % n;
    // Clamp to max trail length (but never wrap past the trail start)
    if (backDist > maxLen) {
      startIdx = (playerIdx - maxLen + n) % n;
      backDist = maxLen;
    }
    // Nothing to draw yet (player hasn't moved from start): no stub from the point behind him to the car either, which
    // would be a dab of trail under a car standing still and its colour read from the page's style every frame
    if (backDist === 0) {
      trailEl.setAttribute('points', '');
      return;
    }
    var headC = { x: near.x, y: near.y };

    // Build points from tail (startIdx) → the point at or behind the car → the car, along the track path
    var pts = '';
    var tailC = _trackPathCoords[startIdx];
    for (var i = 0; i <= backDist; i++) {
      var ci = (startIdx + i) % n;
      var c = _trackPathCoords[ci];
      pts += c.x.toFixed(3) + ',' + c.y.toFixed(3) + ' ';
    }
    pts += headC.x.toFixed(3) + ',' + headC.y.toFixed(3);

    trailEl.setAttribute('points', pts);
    trailEl.setAttribute('stroke-width', String(strokeWidth));

    // Update gradient: tail (transparent) → head (opaque near player)
    // Color follows the car manufacturer brand, pushed 50% toward white
    var gradId = trailEl.id + '-grad';
    var grad = document.getElementById(gradId);
    if (grad) {
      grad.setAttribute('x1', tailC.x.toFixed(3));
      grad.setAttribute('y1', tailC.y.toFixed(3));
      grad.setAttribute('x2', headC.x.toFixed(3));
      grad.setAttribute('y2', headC.y.toFixed(3));
      // Read brand color and lighten 50% toward white
      var raw = getComputedStyle(document.documentElement).getPropertyValue('--map-player-color').trim();
      var trailColor = raw || '#00acc1';
      // Parse HSLA and push lightness 50% toward 100
      var hm = trailColor.match(/hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/);
      if (hm) {
        var h = hm[1], s = hm[2], l = parseFloat(hm[3]);
        var newL = l + (100 - l) * 0.5;
        trailColor = 'hsl(' + h + ',' + s + '%,' + newL.toFixed(0) + '%)';
      }
      var stops = grad.querySelectorAll('stop');
      if (stops[0]) stops[0].setAttribute('stop-color', trailColor);
      if (stops[1]) stops[1].setAttribute('stop-color', trailColor);
    }
  }

  // Every pair of numbers in a path string, in order — what the page took from the path before it read the path's own
  // points (below), kept for a path it cannot read, which it then draws as it was given.
  function _parsePathCoords(svgPath) {
    const raw = svgPath.match(/[\d.]+[,\s]+[\d.]+/g);
    if (!raw) return [];
    return raw.map(function(pair) {
      var parts = pair.split(/[,\s]+/);
      return { x: +parts[0], y: +parts[1] };
    });
  }

  // ── The outline as the page draws it ──
  // The host sends the outline as an SVG path (TrackMapProvider.BuildSvgPath): a Catmull-Rom spline through its points —
  // one to a bin of the lap, about every 5 m — as cubic Béziers. The page reads the points the line passes through (the
  // end of each segment; a Bézier's two control points are off the line) and draws the spline through them itself, to a
  // thousandth of a unit, and everything else it does with the outline goes by points on that line: where the car is on
  // it, the trail behind the car, the full map's fit, the sectors. It used to take every pair of numbers in the path,
  // control points and all, as points of the line, and put the car and the trail on the nearest of them.
  // Why (he saw it on 2026-10-02: "the iPad zoom map seems to be very squiggly"): the plugin wrote every number to a tenth
  // of a unit, which at Le Mans is 6 m and more than the 5 m between its points, and at Bathurst 2.4 m. The line drawn
  // from it strayed from his real one by 1 to 2 px at the iPad's closest view (30 px to a unit) and turned by 40 to 90
  // degrees from one bit of it to the next, which is the squiggle, and the car and its trail stepped from one rounded
  // point to the next. The host writes two decimals now (0.2 px there), but a plugin from before it is still at one, so
  // where a path's rounding is a fifth of the spacing between its points or more, the points are smoothed a little before
  // the spline is drawn through them: three passes of 1-2-1, about a point and a quarter either way (6 m at the host's
  // 5 m spacing). On his own outlines (Le Mans, Bathurst, Jefferson) that leaves the line within 1.5 px of the true one
  // at the iPad's closest view and turning by a degree or so between samples; a hairpin of 15 m radius is pulled in by
  // about a metre where the points are 5 m apart, under a pixel there. A path rounded finely enough for its spacing —
  // the host's two decimals, the demo's sparse circuit, the tests' — is drawn through its own points untouched.
  const _OUTLINE_COARSE = 0.2;        // rounding of this share of the spacing between points, or more, is smoothed out
  const _OUTLINE_SMOOTH_PASSES = 3;   // passes of 1-2-1 over the points then
  const _OUTLINE_DP = 3;              // the decimals the page writes the line in

  // What an SVG path from the host says: the points the line passes through, whether it is a curve through them or
  // straight lines between them, whether it closes, and the most decimals any of its numbers was written with. `M x,y`,
  // then `L x,y` (or bare pairs after M) or `C x1,y1 x2,y2 x,y`, then `Z`: absolute commands, which is all the host
  // writes. Null for anything else.
  function _readOutline(svgPath) {
    const tokens = String(svgPath).match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)/g);
    if (!tokens || tokens[0] !== 'M') return null;
    const pts = [];
    let decimals = 0, curves = 0, closed = false, cmd = '', i = 0;
    const isCmd = (t) => /^[A-Za-z]$/.test(t);
    const num = () => {
      const t = tokens[i];
      if (t === undefined || isCmd(t)) return NaN;
      i++;
      const dot = t.indexOf('.');
      if (dot >= 0) decimals = Math.max(decimals, t.length - dot - 1);
      return +t;
    };
    while (i < tokens.length) {
      const t = tokens[i];
      if (isCmd(t)) {
        i++;
        if (t === 'Z') { closed = true; continue; }
        if ((t !== 'M' && t !== 'L' && t !== 'C') || (t === 'M' && pts.length) || closed) return null;
        cmd = t;
        continue;
      }
      if (closed) return null;
      if (cmd === 'C') {
        const c = [num(), num(), num(), num()];
        if (!c.every(Number.isFinite)) return null;
        curves++;
      }
      const x = num(), y = num();
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      pts.push({ x: x, y: y });
      if (cmd === 'M') cmd = 'L';
    }
    // A loop that comes back to where it began ends on its first point: that point once.
    if (closed && pts.length > 3 && pts[pts.length - 1].x === pts[0].x && pts[pts.length - 1].y === pts[0].y) pts.pop();
    if (pts.length < 3) return null;
    return { points: pts, curve: curves > 0, closed: closed, decimals: decimals };
  }

  // One pass of 1-2-1 over the points, round the loop when it is one; an open line keeps its ends.
  function _smoothOutline(pts, closed) {
    const n = pts.length;
    return pts.map(function(b, i) {
      if (!closed && (i === 0 || i === n - 1)) return b;
      const a = pts[(i - 1 + n) % n], c = pts[(i + 1) % n];
      return { x: (a.x + 2 * b.x + c.x) / 4, y: (a.y + 2 * b.y + c.y) / 4 };
    });
  }

  // The outline the page draws, from the host's path: { d } the path for the <path> sources, { coords } points along the
  // drawn line for everything else, and whether it was smoothed. A curve's points are the spline sampled at its points
  // and a third and two-thirds of the way between them — as many as the pairs the page used to take from the host's
  // path (its point, then two control points, a segment at a time), so the trail's length, the teleport rule and the
  // sectors, which count in these points, are what they were. A path of straight lines is drawn as one, through its
  // points. A path the page cannot read is drawn as it was given, with every pair of numbers in it as its points (and the
  // self-check in updateTrackMap says when nothing of it renders).
  function _outlineOf(svgPath) {
    const read = _readOutline(svgPath);
    if (!read) return { d: svgPath, coords: _parsePathCoords(svgPath), smoothed: false, read: false };
    let pts = read.points;
    const n = pts.length;
    const segs = read.closed ? n : n - 1;
    const gaps = [];
    for (let k = 0; k < segs; k++) gaps.push(Math.hypot(pts[(k + 1) % n].x - pts[k].x, pts[(k + 1) % n].y - pts[k].y));
    gaps.sort(function(a, b) { return a - b; });
    const spacing = gaps[Math.floor(gaps.length / 2)];
    const rounding = Math.pow(10, -read.decimals);
    const smoothed = spacing > 0 && rounding / spacing >= _OUTLINE_COARSE;
    if (smoothed) for (let k = 0; k < _OUTLINE_SMOOTH_PASSES; k++) pts = _smoothOutline(pts, read.closed);
    const f = function(v) { return v.toFixed(_OUTLINE_DP); };
    const at = function(k) { return read.closed ? pts[(k + n) % n] : pts[Math.max(0, Math.min(n - 1, k))]; };
    let d = 'M ' + f(pts[0].x) + ',' + f(pts[0].y);
    const coords = [{ x: pts[0].x, y: pts[0].y }];
    for (let k = 0; k < segs; k++) {
      const p0 = at(k - 1), p1 = at(k), p2 = at(k + 1), p3 = at(k + 2);
      if (!read.curve) {
        d += ' L ' + f(p2.x) + ',' + f(p2.y);
        coords.push({ x: p2.x, y: p2.y });
        continue;
      }
      // Catmull-Rom to a cubic Bézier, as the host builds it.
      const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
      d += ' C ' + f(c1x) + ',' + f(c1y) + ' ' + f(c2x) + ',' + f(c2y) + ' ' + f(p2.x) + ',' + f(p2.y);
      for (let s = 1; s <= 2; s++) {
        const t = s / 3, u = 1 - t;
        coords.push({
          x: u * u * u * p1.x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * p2.x,
          y: u * u * u * p1.y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * p2.y,
        });
      }
      coords.push({ x: p2.x, y: p2.y });
    }
    // A line of straight segments that closes comes back to its first point by the Z alone, as the host's did.
    if (read.closed && !read.curve) coords.pop();
    if (read.closed) d += ' Z';
    return { d: d, coords: coords, smoothed: smoothed, read: true };
  }

  // Where (px, py) is nearest on the outline: on the segment between two of its points (the last back to the first
  // included), so that the car slides along the line drawn and does not hop from one point to the next. Returns
  // { x, y, dist, seg, t, idx }: the place on the line, how far it is, the point at or behind it (`seg`) and how far
  // on towards the next it is (`t`), and the nearer of the two (`idx`).
  function _nearestTrackPoint(px, py) {
    var best = { x: px, y: py, dist: Infinity, idx: -1, seg: -1, t: 0 };
    var n = _trackPathCoords.length;
    for (var i = 0; i < n; i++) {
      var a = _trackPathCoords[i], b = _trackPathCoords[(i + 1) % n];
      var ex = b.x - a.x, ey = b.y - a.y, len = ex * ex + ey * ey;
      var t = len > 0 ? ((px - a.x) * ex + (py - a.y) * ey) / len : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      var qx = a.x + ex * t, qy = a.y + ey * t;
      var d = (px - qx) * (px - qx) + (py - qy) * (py - qy);
      if (d < best.dist) { best.x = qx; best.y = qy; best.dist = d; best.seg = i; best.t = t; }
    }
    if (best.seg >= 0) best.idx = best.t < 0.5 ? best.seg : (best.seg + 1) % n;
    best.dist = Math.sqrt(best.dist);
    return best;
  }

  // What the map cell says while there is no map, by the host's TrackMap.Status: the outline is the host's, from
  // the driver's own laps, and there is nothing to reset or record here.
  // 'no-host' is the app's own maps not answering the telemetry source: the app is running (it is what is showing this),
  // so a minute of it is a start that has not finished or a part of the app that has stopped, and restarting the app
  // starts it again. What it says is what he can do about it, in his words, and not the name of a part of the app.
  const _MAP_WAITING = {
    'first-lap': 'Map after one clean lap',
    'no-host': 'No map yet — the app is starting its maps',
  };
  // With a map drawn, one note: 'crowd' is SimHub's shared map of the layout, which the host serves until his first
  // clean lap gives it an outline of his own (root CLAUDE.md, Track maps). Said plainly, in one line under the
  // circuit and above its name: a line is all the circuit gives up for it, in the rig's small cell as in the glance
  // layout's, so where the cell is narrower than the line the line slides, as the circuit's name does (_fitMapNote).
  const _MAP_NOTE = {
    'crowd': 'SimHub’s map until your first clean lap',
  };
  const _MAP_NO_HOST_LONG = 'No map — restart the app to bring its maps back';
  const _MAP_NO_HOST_LONG_AFTER_MS = 60000;
  let _mapNoHostSince = 0;
  let _mapWaitingShown = '';
  let _mapNoteWatcher = null;

  // The note is one line (nowrap). If its cell is narrower than the line, the line slides: pause, slide, pause,
  // return, as the circuit's name does (poll-engine.js _setFullMapLabel). Measured when the note is set and whenever
  // its cell changes size (the rig's small cell, the glance layout, the iPad turned), so it is never cut short unseen.
  function _fitMapNote(el) {
    const inner = el.querySelector('.map-note-inner');
    el.classList.remove('is-marquee');
    el.style.removeProperty('--marquee-distance');
    el.style.removeProperty('--marquee-duration');
    if (!inner) return;
    const overflow = inner.scrollWidth - el.clientWidth;
    if (overflow > 2) {
      const duration = Math.max(10, Math.min(24, 8 + overflow / 30));
      el.style.setProperty('--marquee-distance', '-' + (overflow + 6) + 'px');
      el.style.setProperty('--marquee-duration', duration.toFixed(1) + 's');
      el.classList.add('is-marquee');
    }
  }
  function _setMapWaiting(status, hasPath) {
    let text = hasPath ? (_MAP_NOTE[status] || '') : (_MAP_WAITING[status] || '');
    if (status === 'no-host' && !hasPath) {
      const now = Date.now();
      if (!_mapNoHostSince) _mapNoHostSince = now;
      if (now - _mapNoHostSince >= _MAP_NO_HOST_LONG_AFTER_MS) text = _MAP_NO_HOST_LONG;
    } else {
      _mapNoHostSince = 0;
    }
    if (text === _mapWaitingShown) return;
    _mapWaitingShown = text;
    const el = document.getElementById('fullMapWaiting');
    if (!el) return;
    const note = !!(hasPath && text);
    el.classList.toggle('map-note', note);
    if (note) {
      el.textContent = '';
      const inner = document.createElement('span');
      inner.className = 'map-note-inner';
      inner.textContent = text;
      el.appendChild(inner);
      requestAnimationFrame(function() { _fitMapNote(el); });
      if (!_mapNoteWatcher && typeof ResizeObserver === 'function') {
        _mapNoteWatcher = new ResizeObserver(function() { _fitMapNote(el); });
        _mapNoteWatcher.observe(el);
      }
    } else {
      el.textContent = text;
      _fitMapNote(el);
    }
  }

  // Sector colors: 0=none(transparent), 1=pb(purple), 2=faster(green), 3=slower(red)
  const _sectorColors = ['transparent', 'hsl(280,60%,55%)', 'hsl(130,60%,50%)', 'hsl(0,65%,50%)'];
  const _sectorActiveColor = 'hsla(0,0%,100%,0.25)';

  // Split the outline into N sector sub-paths, along the points the page draws it by (_outlineOf).
  // boundaryPcts is an array of N-1 boundary percentages: the session's own (SplitTimeInfo, which poll-engine.js
  // keeps in window._sectorBoundaries), e.g. [0.35, 0.70]. Falls back to equal thirds if none are given.
  // The host's outline has one point per LapDistPct bin, and the page's points are evenly three to each of those, so
  // point index ≈ pct * count.
  function _sectorPaths(coords, boundaryPcts) {
    if (!coords || coords.length < 6) return [];
    var f = function(c) { return c.x.toFixed(_OUTLINE_DP) + ',' + c.y.toFixed(_OUTLINE_DP); };

    // Determine boundary indices from percentages
    var pcts = (Array.isArray(boundaryPcts) && boundaryPcts.length >= 1)
      ? boundaryPcts
      : [0.333, 0.667]; // default to 3 sectors
    var indices = pcts.map(function(p) { return Math.round(p * coords.length); });

    // Build N sector sub-paths
    var result = [];
    var prevIdx = 0;
    for (var s = 0; s <= indices.length; s++) {
      var endIdx = s < indices.length ? indices[s] : coords.length;
      var pts = coords.slice(prevIdx, endIdx);
      if (pts.length === 0) { result.push(''); prevIdx = endIdx; continue; }
      var startPt = prevIdx === 0 ? pts[0] : coords[prevIdx - 1];
      var d = 'M ' + f(startPt);
      for (var j = (prevIdx === 0 ? 1 : 0); j < pts.length; j++) d += ' L ' + f(pts[j]);
      result.push(d);
      prevIdx = endIdx;
    }
    return result;
  }
  // The same from a path string, as the page reads it.
  function _splitPathIntoSectors(svgPath, boundaryPcts) {
    return _sectorPaths(_outlineOf(svgPath).coords, boundaryPcts);
  }
  window._splitPathIntoSectors = _splitPathIntoSectors;

  // ═══ THE MAPS IN THE GLANCE LAYOUT ═══
  // drive-view.css makes the two maps cells of a grid, as big as the cells are. The full circuit is fitted to its
  // cell (its viewBox is the outline's own box, so the circuit fills the cell and not a centred square), the local
  // view takes its cell's shape with the car two-thirds of the way down, and what is drawn in pixels there — the
  // lines of the outline, the car, the other cars — is worked out from how many pixels one unit of the map is
  // (`--px` on the svg is that, the other way about: units to a pixel). None of it runs unless drive mode is on.
  const _dv = { on: false, fullUnit: 0, zoomUnit: 0, zoomAspect: 0, zoomW: 0 };
  // The marker sizes, in pixels: the car, the other cars, and the glow under the car.
  const _DV_PLAYER_PX = 7, _DV_OPPONENT_PX = 5, _DV_GLOW_PX = 14;

  function _dvSizeMarkers(svg, unit) {
    if (!svg) return;
    const player = svg.querySelector('.map-player');
    if (player) player.setAttribute('r', (_DV_PLAYER_PX * unit).toFixed(3));
    const glow = svg.querySelector('#trackPlayerGlow');
    if (glow) glow.setAttribute('r', (_DV_GLOW_PX * unit).toFixed(3));
    const dots = svg.querySelectorAll('.map-opponent');
    for (let i = 0; i < dots.length; i++) dots[i].setAttribute('r', (_DV_OPPONENT_PX * unit).toFixed(3));
  }

  // The room kept round the outline inside the svg, in pixels: the outline's outer stroke reaches 6px past its centre line
  // and the car's dot 7px, so nine is room for both at the edge. It was a share of the circuit's longer side (6 % of it on
  // each side, 22px of a 366px circuit), which took a seventh of the cell's height from a circuit that is limited by
  // height, which is the case on an iPad on its side: he asked (2026-10-01) for the maps 1.5 times what they were, and the
  // circuit drawn only 1.2 to 1.4 times, so the margin is what the strokes need and no more.
  const _DV_MAP_MARGIN_PX = 9;

  // The full circuit's viewBox, its box and the pixels a unit is, and where the local view is, measured again.
  function _dvLayout() {
    if (!_dv.on) return;
    const fullSvg = document.getElementById('fullMapSvg');
    if (fullSvg) {
      const r = fullSvg.getBoundingClientRect();
      let vb = [0, 0, 100, 100];
      if (_trackPathCoords.length > 3) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let i = 0; i < _trackPathCoords.length; i++) {
          const c = _trackPathCoords[i];
          if (c.x < x0) x0 = c.x;
          if (c.x > x1) x1 = c.x;
          if (c.y < y0) y0 = c.y;
          if (c.y > y1) y1 = c.y;
        }
        const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
        // The margin is pixels, so it is worked out from the scale the circuit will be drawn at: the box's size less the
        // margin on both sides, over the circuit's, on the axis that limits it. (An svg not yet measured, or one too small
        // to have the margin, keeps the old share of the circuit's side.)
        const m = Math.min(_DV_MAP_MARGIN_PX, Math.min(r.width, r.height) * 0.12);
        const scale = r.width > 0 && r.height > 0 ? Math.min((r.width - 2 * m) / w, (r.height - 2 * m) / h) : 0;
        const mu = scale > 0 ? m / scale : Math.max(w, h) * 0.06;
        vb = [x0 - mu, y0 - mu, w + 2 * mu, h + 2 * mu];
      }
      // Rounded as the attribute is, so that the pixels a unit is are those of the box the browser is given.
      vb = vb.map((v) => +v.toFixed(1));
      fullSvg.setAttribute('viewBox', vb.join(' '));
      if (r.width > 0 && r.height > 0) {
        _dv.fullUnit = 1 / Math.min(r.width / vb[2], r.height / vb[3]);
        fullSvg.style.setProperty('--px', _dv.fullUnit.toFixed(4));
        _dvSizeMarkers(fullSvg, _dv.fullUnit);
      }
    }
    const zoomSvg = document.getElementById('zoomMapSvg');
    if (zoomSvg) {
      const r = zoomSvg.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        _dv.zoomAspect = r.width / r.height;
        _dv.zoomW = r.width;
        _dv.zoomUnit = 0;   // the next frame sizes what is in it
      }
    }
  }

  // Told by drive-hud.js that the layout has changed. Out of drive mode the maps are the HUD's own again.
  function driveViewChanged(on) {
    _dv.on = !!on;
    if (_dv.on) {
      _dvLayout();
      return;
    }
    const fullSvg = document.getElementById('fullMapSvg');
    const zoomSvg = document.getElementById('zoomMapSvg');
    if (fullSvg) { fullSvg.setAttribute('viewBox', '0 0 100 100'); fullSvg.style.removeProperty('--px'); }
    if (zoomSvg) zoomSvg.style.removeProperty('--px');
    const restore = (svg, player, dots) => {
      if (!svg) return;
      const p = svg.querySelector('.map-player');
      if (p) p.setAttribute('r', String(player));
      const glow = svg.querySelector('#trackPlayerGlow');
      if (glow) glow.setAttribute('r', '7');
      const list = svg.querySelectorAll('.map-opponent');
      for (let i = 0; i < list.length; i++) list[i].setAttribute('r', String(dots));
    };
    restore(fullSvg, 4, 2.5);
    restore(zoomSvg, 2, 1.5);
    _dv.zoomUnit = 0;
  }
  window.driveViewChanged = driveViewChanged;
  window.addEventListener('resize', _dvLayout);
  window.addEventListener('orientationchange', _dvLayout);

  // The local view's radius, following his speed (modules/js/map-zoom.js): closer at speed, wider, or fixed, by the
  // "Following map zoom" setting, eased by the page's clock.
  const _followZoom = RacingDeskMapZoom.follower();
  function _followZoomMode() {
    return RacingDeskMapZoom.modeOf(typeof _settings !== 'undefined' && _settings ? _settings.followMapZoom : undefined);
  }

  // Smoothed heading for local map rotation
  let _mapSmoothedHeading = 0;

  function updateTrackMap(svgPath, playerX, playerY, opponentStr, speedMph, headingDeg, status) {
    // While there is no map the cell says why (the host's TrackMap.Status); with one it says nothing.
    _setMapWaiting(status, !!svgPath);

    // No track map available — clear outline, hide markers, center dots
    if (!svgPath && _mapLastPath !== '') {
      _mapLastPath = '';
      _mapHasInit = false;
      _trackPathCoords = [];
      _forgetTrail();
      // Clear the source paths — the <use> layers pointing at them
      // (outer/middle/inner × full/zoom) clear in lockstep.
      ['fullMapTrackSrc', 'zoomMapTrackSrc'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.setAttribute('d', '');
      });

      // Remove sector sub-paths
      const fullSvg = document.getElementById('fullMapSvg');
      if (fullSvg) fullSvg.querySelectorAll('.map-sector').forEach(el => el.remove());

      // Hide start/finish markers
      const fullSF = document.getElementById('fullMapSF');
      const zoomSF = document.getElementById('zoomMapSF');
      if (fullSF) fullSF.style.display = 'none';
      if (zoomSF) zoomSF.style.display = 'none';
    }

    // Update track outline (only when path changes — new track or first load)
    if (svgPath && svgPath !== _mapLastPath) {
      _mapLastPath = svgPath;
      _mapHasInit = false;
      // The line the page draws, and the points along it that the car, the trail, the fit and the sectors go by
      // (_outlineOf: the host's points, a spline through them drawn here, smoothed first where the path is coarse).
      const outline = _outlineOf(svgPath);
      _trackPathCoords = outline.coords;
      _forgetTrail();   // the indices of the trail were of the outline before
      // The three rendered layers (outer / middle / inner) are <use>
      // elements that reference a single source <path> in <defs>. Update
      // the two source paths (full + zoom) and all six rendered layers
      // follow automatically — one source of truth per map.
      var _SRC_IDS = ['fullMapTrackSrc', 'zoomMapTrackSrc'];
      _SRC_IDS.forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.setAttribute('d', outline.d);
      });
      // IDs of the rendered layers, used by the self-check below to
      // verify the path is visible (not just the defs source).
      var _LAYER_IDS = ['fullMapTrack', 'fullMapTrackOuter', 'fullMapTrackInner',
       'zoomMapTrack', 'zoomMapTrackOuter', 'zoomMapTrackInner'];

      // Self-check: a non-empty svgPath that produces zero-sized bboxes
      // on every layer means the browser couldn't parse it as an SVG
      // path (no M/L/C commands, or just raw "x,y x,y" with no verbs).
      // This is the exact class of bug where dots drive around a correct
      // track shape but no line ever renders — the coord parser is
      // happy with "0,0 1,2" but the browser refuses to render it.
      try {
        var _anyRendered = false;
        var _missingEls = [];
        var _zeroBbox = [];
        for (var _i = 0; _i < _LAYER_IDS.length; _i++) {
          var _el = document.getElementById(_LAYER_IDS[_i]);
          if (!_el) { _missingEls.push(_LAYER_IDS[_i]); continue; }
          var _bb = _el.getBBox && _el.getBBox();
          if (_bb && (_bb.width > 0 || _bb.height > 0)) { _anyRendered = true; }
          else { _zeroBbox.push(_LAYER_IDS[_i]); }
        }
        if (!_anyRendered) {
          console.warn('[K10 track-map] svgPath set but nothing rendered — likely malformed path.',
            '\n  path prefix:', svgPath.slice(0, 80),
            '\n  path length:', svgPath.length,
            '\n  has M command:', /(^|\s)[Mm]\s*[\d-]/.test(svgPath),
            '\n  missing elements:', _missingEls,
            '\n  zero-bbox elements:', _zeroBbox,
            '\n  parsed coord pairs:', _trackPathCoords.length);
        } else if (_zeroBbox.length > 0) {
          console.warn('[K10 track-map] Partial render — some layers zero-sized:', _zeroBbox);
        }
      } catch (e) {
        // getBBox throws if element is detached from DOM — ignore silently
      }

      // A new circuit is fitted to its cell (glance layout only)
      if (_dv.on) _dvLayout();

      // Split path into N sector sub-paths using native iRacing boundaries
      const boundaryPcts = Array.isArray(window._sectorBoundaries) ? window._sectorBoundaries : null;
      const sectorPaths = _sectorPaths(_trackPathCoords, boundaryPcts);
      const sectorCount = sectorPaths.length;

      // Dynamically create/update sector path elements in the full map SVG
      const fullSvg = document.getElementById('fullMapSvg');
      if (fullSvg) {
        // Remove old sector paths
        fullSvg.querySelectorAll('.map-sector').forEach(el => el.remove());
        // Insert new sector paths before the opponents group
        const oppGroup = document.getElementById('fullMapOpponents');
        for (let i = 0; i < sectorCount; i++) {
          const path = document.createElementNS(_SVG_NS, 'path');
          path.classList.add('map-sector');
          path.id = 'mapSector' + (i + 1);
          path.setAttribute('d', sectorPaths[i]);
          if (oppGroup) fullSvg.insertBefore(path, oppGroup);
          else fullSvg.appendChild(path);
        }
      }

      // Position start/finish marker at the first point of the line drawn (LapDistPct=0)
      const sfMatch = outline.read ? null : svgPath.match(/^M\s*([\d.]+)[,\s]+([\d.]+)/);
      if (outline.read || sfMatch) {
        const sfX = outline.read ? _trackPathCoords[0].x : +sfMatch[1];
        const sfY = outline.read ? _trackPathCoords[0].y : +sfMatch[2];
        const sf = 'translate(' + sfX.toFixed(_OUTLINE_DP) + ',' + sfY.toFixed(_OUTLINE_DP) + ')';
        const fullSF = document.getElementById('fullMapSF');
        const zoomSF = document.getElementById('zoomMapSF');
        if (fullSF) {
          fullSF.setAttribute('transform', sf);
          fullSF.style.display = '';
        }
        if (zoomSF) {
          zoomSF.setAttribute('transform', sf);
          zoomSF.style.display = '';
        }
      }
    }

    // Update sector colors from live performance data (set by poll-engine)
    if (window._sectorData) {
      const sd = window._sectorData;
      for (let i = 1; i <= sd.sectorCount; i++) {
        const el = document.getElementById('mapSector' + i);
        if (!el) continue;
        if (i === sd.curSector) {
          el.setAttribute('stroke', _sectorActiveColor);
        } else {
          el.setAttribute('stroke', _sectorColors[sd.states[i - 1]] || 'transparent');
        }
      }
    }

    // Sanity: clamp coordinates to 0–100 SVG range
    playerX = Math.max(0, Math.min(100, playerX));
    playerY = Math.max(0, Math.min(100, playerY));

    // Snap player position to nearest track point when path is available
    // This keeps the demo car (and live car) visually on the track
    if (_trackPathCoords.length > 10) {
      var snap = _nearestTrackPoint(playerX, playerY);
      // Only snap if reasonably close (within ~6 SVG units) — prevents
      // warping from completely wrong coordinates
      if (snap.dist < 6) {
        playerX = snap.x;
        playerY = snap.y;
      }
    }

    // A low-pass filter on the position. The host places the car along a closed loop, the line included, so there
    // is no jump at the line to guard against: a step is a step, and a slow blend after one would be a slide.
    if (!_mapHasInit) {
      _mapSmoothedX = playerX;
      _mapSmoothedY = playerY;
      _mapHasInit = true;
    } else {
      _mapSmoothedX += (playerX - _mapSmoothedX) * 0.45;
      _mapSmoothedY += (playerY - _mapSmoothedY) * 0.45;
    }

    const sx = _mapSmoothedX;
    const sy = _mapSmoothedY;

    // Where the car is on the track (used for off-track detection + trail): the point of the outline at or behind it
    var playerNearest = _trackPathCoords.length > 10 ? _nearestTrackPoint(sx, sy) : null;
    var playerIdx = playerNearest ? playerNearest.seg : -1;

    // A teleport: the trail was anchored behind the car, and the car is somewhere else. Round the loop the short way
    // (a step across the line is a step); more than a fiftieth of the lap in one frame is no drive.
    if (playerIdx >= 0 && _prevPlayerIdx >= 0 && _trackPathCoords.length > 10) {
      var _n = _trackPathCoords.length, _d = Math.abs(playerIdx - _prevPlayerIdx);
      if (Math.min(_d, _n - _d) > _n * _TRAIL_TELEPORT_LAP_FRACTION) { _trailStartIdx = -1; _trailFading = false; }
    }
    _prevPlayerIdx = playerIdx;

    // Off-track detection
    let isOffTrack = playerNearest ? playerNearest.dist > _OFF_TRACK_DIST : false;

    // Update track line highlighting based on on/off-track state
    document.querySelectorAll('.map-track-outer').forEach(function(el) {
      el.classList.toggle('off-track', isOffTrack);
    });
    document.querySelectorAll('.map-track-inner').forEach(function(el) {
      el.classList.toggle('on-track', !isOffTrack);
    });

    // Update player dot
    const fullPlayer = document.getElementById('fullMapPlayer');
    const zoomPlayer = document.getElementById('zoomMapPlayer');
    if (fullPlayer) {
      fullPlayer.setAttribute('cx', sx.toFixed(1));
      fullPlayer.setAttribute('cy', sy.toFixed(1));
    }
    if (zoomPlayer) {
      // Thousandths of a unit, as the view's box below is: rounded to a tenth, the dot and the box's centre each
      // round on their own and the car wobbles against the middle of its view (see the box).
      zoomPlayer.setAttribute('cx', sx.toFixed(3));
      zoomPlayer.setAttribute('cy', sy.toFixed(3));
    }

    // Update track glow effect following player position
    const glowFullSvg = document.getElementById('fullMapSvg');
    const glowZoomSvg = document.getElementById('zoomMapSvg');
    if (glowFullSvg) _updateTrackGlow(glowFullSvg, sx, sy);
    if (glowZoomSvg) _updateTrackGlow(glowZoomSvg, sx, sy);

    // G-force trail — read current G from datastream globals
    const latG  = window._ambientLatG  || 0;
    const longG = window._ambientLongG || 0;
    const totalG = Math.sqrt(latG * latG + longG * longG);

    // Turn detection: when G crosses above threshold, start fading the trail out
    var inTurnNow = totalG >= _TURN_G_THRESHOLD;
    if (inTurnNow && !_wasInTurn) {
      _trailFading = true;
    }
    _wasInTurn = inTurnNow;

    // Gradual fade: advance trail start toward player each frame
    if (_trailFading && _trailStartIdx >= 0 && playerIdx >= 0) {
      var n = _trackPathCoords.length;
      var gap = (playerIdx - _trailStartIdx + n) % n;
      if (gap <= _TRAIL_FADE_SPEED) {
        // Caught up — trail fully faded, restart from player
        _trailStartIdx = playerIdx;
        _trailFading = false;
      } else {
        _trailStartIdx = (_trailStartIdx + _TRAIL_FADE_SPEED) % n;
      }
    }

    // Ensure trail polylines exist and render using actual track geometry
    if (!_fullMapTrailEl)  _fullMapTrailEl  = _ensureTrailPolyline('fullMapSvg', 'fullMapPlayer', 'fullMapTrail');
    if (!_zoomMapTrailEl) _zoomMapTrailEl = _ensureTrailPolyline('zoomMapRotateGroup', 'zoomMapOpponents', 'zoomMapTrail');
    // The width of the outline's outer layer (.map-track-outer): in the glance layout that is in pixels (on the local
    // view, at the view R_LINE_WEIGHTS across, and with the zoom from there)
    _renderTrackTrail(_fullMapTrailEl, _dv.on && _dv.fullUnit ? 12 * _dv.fullUnit : 5, playerNearest);
    _renderTrackTrail(_zoomMapTrailEl, _dv.on && _dv.zoomUnit ? 10 * RacingDeskMapZoom.GLANCE_WEIGHT * _dv.zoomUnit : 2.5, playerNearest);

    // Self-check: warn once if trail polylines couldn't be created.
    // Their absence means _renderTrackTrail is silently no-op'ing and
    // the trail feature is dead for this session.
    if (!_trailCheckDone && _trackPathCoords.length > 10) {
      _trailCheckDone = true;
      if (!_fullMapTrailEl || !_zoomMapTrailEl) {
        console.warn('[K10 track-map] Trail polyline(s) failed to attach.',
          '\n  fullMapTrail:', !!_fullMapTrailEl,
          '\n  zoomMapTrail:', !!_zoomMapTrailEl,
          '\n  fullMapSvg present:', !!document.getElementById('fullMapSvg'),
          '\n  zoomMapRotateGroup present:', !!document.getElementById('zoomMapRotateGroup'));
      }
    }

    // Update zoom map — player always centered, track rotates so driving direction always points UP. The view's
    // radius follows his speed (map-zoom.js): closer in as he goes faster, by default — what he asked for — or
    // wider, or one view at every speed, by the "Following map zoom" setting; between the bounds the view has
    // always had, eased over a fifth of a second and never faster than its cap, so that a speed that jumps (a reset, a
    // tow, a crash) is not a jump in the map. The view's box, its pivot and the car's dot are written to a thousandth
    // of a unit: at the closest the view is 11 units across and at speed it is the one that scrolls fastest, where
    // steps of a tenth were jerks of two or three pixels.
    const zoomSvg = document.getElementById('zoomMapSvg');
    if (zoomSvg) {
      const spd = typeof speedMph === 'number' ? speedMph : 0;
      const zr = _followZoom.radius(spd, _followZoomMode(), performance.now());

      if (_dv.on && _dv.zoomAspect > 0) {
        // The glance layout: the view is the shape of its cell, as wide as the radius says, and the car is
        // two-thirds of the way down it, so what is ahead gets the room. What is drawn on it — the road's three
        // lines, the trail, the car and the others — is sized in pixels for the view R_LINE_WEIGHTS across, and so
        // in the map's own units: it grows as the view closes in and shrinks as it opens out, as on the rig's HUD,
        // whose lines are in those units. It was sized again in pixels whenever the zoom moved by a few percent,
        // which took the zoom back out of everything but the bends: on a straight the closest view looked like the
        // widest. It is sized again only when the cell changes (_dvLayout puts zoomUnit to 0).
        const vw = zr * 2 * RacingDeskMapZoom.GLANCE_VIEW, vh = vw / _dv.zoomAspect;
        zoomSvg.setAttribute('viewBox', (sx - vw / 2).toFixed(3) + ' ' + (sy - vh * (2 / 3)).toFixed(3) + ' ' + vw.toFixed(3) + ' ' + vh.toFixed(3));
        const unit = (2 * RacingDeskMapZoom.R_LINE_WEIGHTS) / _dv.zoomW;
        if (unit !== _dv.zoomUnit) {
          _dv.zoomUnit = unit;
          zoomSvg.style.setProperty('--px', unit.toFixed(4));
          _dvSizeMarkers(zoomSvg, unit * RacingDeskMapZoom.GLANCE_DOT);
        }
      } else {
        // ViewBox always centered on player — NO clamping, overflow="visible"
        // handles content outside the 0-100 range. Player is always at center.
        const vx = sx - zr;
        const vy = sy - zr;
        zoomSvg.setAttribute('viewBox', vx.toFixed(3) + ' ' + vy.toFixed(3) + ' ' + (zr * 2).toFixed(3) + ' ' + (zr * 2).toFixed(3));
      }

      // Clear any legacy CSS rotation on the SVG element
      zoomSvg.style.transform = '';
      zoomSvg.style.transformOrigin = '';

      // Rotate the inner group around the player's SVG coordinate so
      // the driving direction always points up. Player dot is outside
      // the group so it stays upright and visually centered.
      if (typeof headingDeg === 'number') {
        let diff = headingDeg - _mapSmoothedHeading;
        if (diff > 180) diff -= 360;
        if (diff < -180) diff += 360;
        // Dead-zone: ignore sub-degree jitter
        if (Math.abs(diff) < 0.5) diff = 0;
        _mapSmoothedHeading += diff * 0.15;
        _mapSmoothedHeading = ((_mapSmoothedHeading % 360) + 360) % 360;

        const rotGrp = document.getElementById('zoomMapRotateGroup');
        if (rotGrp) {
          rotGrp.setAttribute('transform',
            'rotate(' + (-_mapSmoothedHeading).toFixed(2) + ',' + sx.toFixed(3) + ',' + sy.toFixed(3) + ')');
        }
      }
    }

    // Parse and render opponents
    const fullG = document.getElementById('fullMapOpponents');
    const zoomG = document.getElementById('zoomMapOpponents');
    if (!fullG || !zoomG) return;

    // Parse "x,y,pit;x,y,pit;..." format
    const parts = opponentStr ? opponentStr.split(';') : [];
    const count = Math.min(parts.length, _MAP_MAX_OPPONENTS);

    // Ensure we have enough circle elements (create/remove as needed)
    _ensureOpponentDots(fullG, count, _dv.on && _dv.fullUnit ? _DV_OPPONENT_PX * _dv.fullUnit : 2.5);
    _ensureOpponentDots(zoomG, count, _dv.on && _dv.zoomUnit ? _DV_OPPONENT_PX * _dv.zoomUnit : 1.5);

    // Where each car is, and which of them pulse: the _NEAR_PULSED nearest to him within _NEAR_D2, of those on track.
    // Every car within that distance pulsed, with a drop-shadow at its peak: at a start, the whole field on both maps.
    const fullDots = fullG.children;
    const zoomDots = zoomG.children;
    _nearIdx.fill(-1);
    _nearD2.fill(Infinity);
    for (let i = 0; i < count; i++) {
      const seg = parts[i].split(',');
      _oppOk[i] = seg.length >= 2 ? 1 : 0;
      if (!_oppOk[i]) continue;
      // Clamp opponent coords to 0–100
      const ox = Math.max(0, Math.min(100, +seg[0]));
      const oy = Math.max(0, Math.min(100, +seg[1]));
      _oppX[i] = ox;
      _oppY[i] = oy;
      _oppPit[i] = seg[2] === '1' ? 1 : 0;
      if (_oppPit[i]) continue;
      const dx = sx - ox, dy = sy - oy, d2 = dx * dx + dy * dy;
      if (!(d2 < _NEAR_D2) || !(d2 < _nearD2[_NEAR_PULSED - 1])) continue;
      let k = _NEAR_PULSED - 1;
      while (k > 0 && d2 < _nearD2[k - 1]) { _nearD2[k] = _nearD2[k - 1]; _nearIdx[k] = _nearIdx[k - 1]; k--; }
      _nearD2[k] = d2;
      _nearIdx[k] = i;
    }
    // The same on both maps. A dot is written only where it differs from what it was given last.
    for (let i = 0; i < count; i++) {
      if (!_oppOk[i]) continue;
      const ox = _oppX[i], oy = _oppY[i], inPit = _oppPit[i] === 1;
      const close = _isClose(sx, sy, ox, oy);
      const near = _nearIdx.indexOf(i) >= 0;
      _drawOpponent(fullDots[i], ox, oy, inPit, close, near);
      _drawOpponent(zoomDots[i], ox, oy, inPit, close, near);
    }
  }

  // The cars that pulse, at most, and within what distance of him (squared, in map units: ~20 units).
  const _NEAR_PULSED = 3;
  const _NEAR_D2 = 400;
  const _nearIdx = new Int16Array(_NEAR_PULSED);
  const _nearD2 = new Float64Array(_NEAR_PULSED);
  const _oppX = new Float64Array(_MAP_MAX_OPPONENTS);
  const _oppY = new Float64Array(_MAP_MAX_OPPONENTS);
  const _oppPit = new Uint8Array(_MAP_MAX_OPPONENTS);
  const _oppOk = new Uint8Array(_MAP_MAX_OPPONENTS);

  // One car's dot: its place, shown or not (in the pits), and its two classes, each written only when it changes. They
  // were all written for every car on both maps on every frame, the same values most of them, each a style invalidation.
  // What was written is kept on the element, so a dot made afresh (_ensureOpponentDots) is written whole.
  function _drawOpponent(dot, x, y, hidden, close, near) {
    if (dot._rdX !== x) { dot._rdX = x; dot.setAttribute('cx', x); }
    if (dot._rdY !== y) { dot._rdY = y; dot.setAttribute('cy', y); }
    if (dot._rdHidden !== hidden) { dot._rdHidden = hidden; dot.style.display = hidden ? 'none' : ''; }
    if (dot._rdClose !== close) { dot._rdClose = close; dot.classList.toggle('close', close); }
    if (dot._rdNear !== near) { dot._rdNear = near; dot.classList.toggle('map-opponent-near', near); }
  }

  function _ensureOpponentDots(parent, count, radius) {
    while (parent.children.length < count) {
      const c = document.createElementNS(_SVG_NS, 'circle');
      c.classList.add('map-opponent');
      c.setAttribute('r', radius);
      parent.appendChild(c);
    }
    while (parent.children.length > count) {
      parent.removeChild(parent.lastChild);
    }
  }

  function _isClose(px, py, ox, oy) {
    const dx = px - ox, dy = py - oy;
    return (dx * dx + dy * dy) < 64; // ~8 SVG units
  }

  function _updateTrackGlow(svgEl, px, py) {
    // Create or update a radial gradient glow that follows player position
    let glow = svgEl.getElementById('trackPlayerGlow');
    let grad = svgEl.getElementById('trackGlowGrad');

    if (!glow) {
      // Create radial gradient definition once
      const defs = svgEl.querySelector('defs') || (() => {
        const d = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        svgEl.insertBefore(d, svgEl.firstChild);
        return d;
      })();

      grad = document.createElementNS('http://www.w3.org/2000/svg', 'radialGradient');
      grad.id = 'trackGlowGrad';
      // Bright white-ish core that fades to brand color at edges
      const stopCore = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
      stopCore.setAttribute('offset', '0%');
      stopCore.setAttribute('stop-color', 'hsl(0,0%,100%)');
      stopCore.setAttribute('stop-opacity', '0.45');
      grad.appendChild(stopCore);

      const stopMid = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
      stopMid.setAttribute('offset', '35%');
      stopMid.setAttribute('stop-color', 'var(--map-player-color, hsl(185,70%,55%))');
      stopMid.setAttribute('stop-opacity', '0.25');
      grad.appendChild(stopMid);

      const stopOuter = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
      stopOuter.setAttribute('offset', '100%');
      stopOuter.setAttribute('stop-color', 'var(--map-player-color, hsl(185,70%,55%))');
      stopOuter.setAttribute('stop-opacity', '0');
      grad.appendChild(stopOuter);

      defs.appendChild(grad);

      // Create glow circle overlay — tight radius, pulsing via CSS
      glow = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      glow.id = 'trackPlayerGlow';
      glow.setAttribute('r', '7');
      glow.setAttribute('fill', 'url(#trackGlowGrad)');
      glow.style.pointerEvents = 'none';
      glow.style.mixBlendMode = 'screen';
      glow.style.animation = 'map-glow-pulse 2s ease-in-out infinite';

      // Insert before dots so it's behind them
      const dotsGroup = svgEl.querySelector('.map-opponent') || svgEl.lastChild;
      if (dotsGroup && dotsGroup.parentNode) {
        dotsGroup.parentNode.insertBefore(glow, dotsGroup);
      } else {
        svgEl.appendChild(glow);
      }
    }

    // Update glow position to follow player: to a thousandth, as the car's dot on the local view is (a tenth is three
    // pixels at the iPad's closest view, and the glow shimmered round the dot)
    glow.setAttribute('cx', px.toFixed(3));
    glow.setAttribute('cy', py.toFixed(3));
  }

  // ═══ EXPOSE ALL FUNCTIONS TO WINDOW ═══
