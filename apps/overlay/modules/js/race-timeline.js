// Race timeline position strip

  // ═══════════════════════════════════════════════════════════════
  //  RACE TIMELINE — position state color strip
  // ═══════════════════════════════════════════════════════════════

  // History stores objects: { delta: N, p1: bool, checkered: bool, event: string|null }
  // delta = positions gained/lost vs start (negative = gained, positive = lost from start)
  // event: null, 'pit', 'offtrack', 'damage' — drawn as markers on the timeline
  const RT_MAX_SAMPLES = 310;
  const _rtHistory = [];
  let _rtStartPos = 0;
  let _rtLastLap = 0;
  let _rtLastPos = 0;
  let _rtLastDelta = null;
  let _rtFinished = false;
  let _rtLastIncident = 0;
  let _rtWasInPit = false;

  // Heat-mapped color: intensity scales with number of positions gained/lost
  // delta 0 = neutral blue, negative = green (gained), positive = red (lost)
  // Clamp heat at ±5 positions for a sane max
  function rtColor(sample) {
    if (sample.checkered) return null; // handled separately
    if (sample.p1) {
      const heat = Math.min(Math.abs(sample.delta), 5);
      const lit  = 58 + heat * 4;
      return 'hsla(42, 72%, ' + lit + '%, 0.8)';
    }
    const d = sample.delta;
    if (d === 0) return 'hsla(210, 42%, 54%, 0.8)';
    if (d < 0) {
      const heat = Math.min(Math.abs(d), 5);
      const sat  = 38 + heat * 8;
      const lit  = 46 + heat * 5;
      return 'hsla(145, ' + sat + '%, ' + lit + '%, 0.8)';
    }
    const heat = Math.min(d, 5);
    const sat  = 38 + heat * 8;
    const lit  = 48 + heat * 5;
    return 'hsla(0, ' + sat + '%, ' + lit + '%, 0.8)';
  }

  function updateRaceTimeline(position, currentLap, flagState, incidentCount, isInPit) {
    if (!position || position <= 0) return;
    if (_rtStartPos <= 0 && position > 0) _rtStartPos = position;

    const delta = position - _rtStartPos;  // negative = gained positions, positive = lost positions

    // Detect events
    let event = null;
    if (isInPit && !_rtWasInPit) {
      event = 'pit';
    } else if (incidentCount > _rtLastIncident && _rtLastIncident > 0) {
      // Incident count jumped — either off-track or contact/damage
      const inc = incidentCount - _rtLastIncident;
      event = inc >= 4 ? 'damage' : 'offtrack';  // 4+ points typically = heavy contact/damage
    }
    _rtWasInPit = !!isInPit;
    if (incidentCount > 0) _rtLastIncident = incidentCount;

    const sample = {
      delta: delta,
      p1: position === 1,
      checkered: flagState === 'checkered',
      event: event,
      newLap: currentLap > 0 && currentLap !== _rtLastLap,
    };
    if (sample.checkered) _rtFinished = true;

    const lapChanged = currentLap > 0 && currentLap !== _rtLastLap;
    const posChanged = position !== _rtLastPos && _rtLastPos > 0;
    const hasEvent = event !== null;
    if (lapChanged || posChanged || hasEvent) {
      _rtHistory.push(sample);
      _rtLastLap = currentLap;
      _rtLastDelta = delta;
    } else if (_rtHistory.length === 0) {
      _rtHistory.push(sample);
      _rtLastDelta = delta;
    }
    _rtLastPos = position;
    if (_rtHistory.length > RT_MAX_SAMPLES) _rtHistory.shift();

    renderTimeline();
  }

  // Event marker colors
  const RT_EVENT_COLORS = {
    pit:     'hsla(210, 80%, 65%, 0.9)',   // blue — pit stop
    offtrack: 'hsla(35, 90%, 55%, 0.9)',    // orange — off track / minor incident
    damage:  'hsla(0, 85%, 55%, 0.9)',      // red — heavy contact / damage
  };

  function renderTimeline() {
    const canvas = document.getElementById('rtCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const len = _rtHistory.length;
    if (len === 0) return;

    const sliceW = Math.max(1, w / len);

    // First pass: draw position colors
    for (let i = 0; i < len; i++) {
      const sample = _rtHistory[i];
      const x = Math.floor(i * sliceW);
      const nextX = Math.floor((i + 1) * sliceW);
      const sw = nextX - x;

      if (sample.checkered) {
        const sqSize = 2;
        for (let cy = 0; cy < h; cy += sqSize) {
          for (let cx = x; cx < x + sw; cx += sqSize) {
            const row = Math.floor(cy / sqSize);
            const col = Math.floor((cx - x) / sqSize);
            ctx.fillStyle = (row + col) % 2 === 0 ? 'hsla(0,0%,100%,0.35)' : 'hsla(0,0%,0%,0.4)';
            ctx.fillRect(cx, cy, Math.min(sqSize, x + sw - cx), Math.min(sqSize, h - cy));
          }
        }
      } else {
        ctx.fillStyle = rtColor(sample);
        ctx.fillRect(x, 0, sw, h);
      }
    }

    // Second pass: draw event markers (small triangles/diamonds on top)
    for (let i = 0; i < len; i++) {
      const sample = _rtHistory[i];
      if (!sample.event) continue;
      const x = Math.floor(i * sliceW + sliceW / 2);
      const color = RT_EVENT_COLORS[sample.event] || 'hsla(0,0%,100%,0.5)';

      // Draw a small downward-pointing triangle at top of timeline
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x - 3, 0);
      ctx.lineTo(x + 3, 0);
      ctx.lineTo(x, 5);
      ctx.closePath();
      ctx.fill();

      // Vertical tick line
      ctx.strokeStyle = color.replace(/[\d.]+\)$/, '0.6)');
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 5);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // Third pass: draw white lap boundary lines
    for (let i = 0; i < len; i++) {
      const sample = _rtHistory[i];
      if (!sample.newLap) continue;
      const x = Math.floor(i * sliceW);
      ctx.strokeStyle = 'hsla(0,0%,100%,0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
  }

  function resetTimeline() {
    _rtHistory.length = 0;
    _rtStartPos = 0;
    _rtLastLap = 0;
    _rtLastPos = 0;
    _rtLastDelta = null;
    _rtFinished = false;
    const canvas = document.getElementById('rtCanvas');
    if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  }

  // ═══════════════════════════════════════════════════════════════
