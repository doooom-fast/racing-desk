// Leaderboard renderer

  // ═══════════════════════════════════════════════════════════════
  //  LEADERBOARD RENDERER
  // ═══════════════════════════════════════════════════════════════

  // Sparkline history: keyed by driver name, stores last N lap times
  const _sparkHistory = {};
  const SPARK_MAX = 12;
  // Player position history for sparkline (seeded from grid position)
  const _posHistory = [];
  let _posHistorySeeded = false;
  // Use window-scoped cache key so settings.js can reliably reset it
  window._lbLastJson = '';

  // ── Row pool ─────────────────────────────────────────────────
  // Per-driver DOM row objects, keyed by driver name. Render mutates
  // existing rows in-place rather than rebuilding the whole list every
  // tick (the old code did `container.innerHTML = html` per frame —
  // destroying + recreating 60 SVG sparklines + 60 div trees every
  // frame at 60Hz against the GPU was the main race-time framerate
  // hit). Each row caches references to its child nodes so per-tick
  // updates are pure textContent / setAttribute writes.
  const _rowPool = new Map();
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function _buildRow() {
    const row = document.createElement('div');
    row.className = 'lb-row';

    const pos = document.createElement('div');
    pos.className = 'lb-pos';
    row.appendChild(pos);

    const name = document.createElement('div');
    name.className = 'lb-name';
    const nameText = document.createTextNode('');
    const pitChip = document.createElement('span');
    pitChip.style.cssText = 'font-size:10px;color:hsla(0,70%,55%,1);margin-left:4px;';
    pitChip.textContent = 'IN PIT';
    pitChip.style.display = 'none';
    name.appendChild(nameText);
    name.appendChild(pitChip);
    row.appendChild(name);

    const gap = document.createElement('div');
    gap.className = 'lb-gap';
    row.appendChild(gap);

    const lap = document.createElement('div');
    lap.className = 'lb-lap';
    row.appendChild(lap);

    const sparkSvg = document.createElementNS(SVG_NS, 'svg');
    sparkSvg.setAttribute('class', 'lb-spark');
    sparkSvg.setAttribute('preserveAspectRatio', 'none');
    sparkSvg.setAttribute('viewBox', '0 0 44 14');
    const sparkLine = document.createElementNS(SVG_NS, 'polyline');
    sparkLine.setAttribute('fill', 'none');
    sparkLine.setAttribute('stroke-width', '1.2');
    sparkLine.setAttribute('stroke-linecap', 'round');
    sparkLine.setAttribute('stroke-linejoin', 'round');
    const sparkDot = document.createElementNS(SVG_NS, 'circle');
    sparkDot.setAttribute('r', '1.5');
    sparkSvg.appendChild(sparkLine);
    sparkSvg.appendChild(sparkDot);
    sparkSvg.style.display = 'none';
    row.appendChild(sparkSvg);

    return {
      el: row,
      posEl: pos,
      nameTextNode: nameText,
      pitChipEl: pitChip,
      gapEl: gap,
      lapEl: lap,
      sparkSvg, sparkLine, sparkDot,
      // Cached values so setAttribute / textContent only fires on change
      lastClassName: '', lastPosText: '', lastNameText: '', lastPitVisible: false,
      lastGapText: '', lastGapClass: '',
      lastLapText: '', lastLapClass: '',
      lastSparkPts: '', lastSparkColor: '', lastSparkVisible: false,
    };
  }

  function _setClass(row, fullClass) {
    if (row.lastClassName !== fullClass) {
      row.el.className = fullClass;
      row.lastClassName = fullClass;
    }
  }

  function _setText(node, value, cacheKey, row) {
    if (row[cacheKey] !== value) {
      node.textContent = value;
      row[cacheKey] = value;
    }
  }

  function _setSpark(row, pts, color, visible) {
    if (row.lastSparkVisible !== visible) {
      row.sparkSvg.style.display = visible ? '' : 'none';
      row.lastSparkVisible = visible;
    }
    if (!visible) return;
    if (row.lastSparkPts !== pts) {
      row.sparkLine.setAttribute('points', pts);
      // The last point's coordinates are also where the dot lives.
      const lastSpaceIdx = pts.lastIndexOf(' ');
      const lastPair = lastSpaceIdx >= 0 ? pts.slice(lastSpaceIdx + 1) : pts;
      const commaIdx = lastPair.indexOf(',');
      if (commaIdx > 0) {
        row.sparkDot.setAttribute('cx', lastPair.slice(0, commaIdx));
        row.sparkDot.setAttribute('cy', lastPair.slice(commaIdx + 1));
      }
      row.lastSparkPts = pts;
    }
    if (row.lastSparkColor !== color) {
      row.sparkLine.setAttribute('stroke', color);
      row.sparkDot.setAttribute('fill', color);
      row.lastSparkColor = color;
    }
  }

  function updateLeaderboard(p) {
    const lbPanel = document.getElementById('leaderboardPanel');
    if (!lbPanel || lbPanel.classList.contains('section-hidden')) return;
    // Leaderboard comes as raw JSON array from the plugin
    let raw = p['RaceCorProDrive.Plugin.Leaderboard'];
    // If plugin sends leaderboard as a JSON string, parse it
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch(e) { console.warn('[K10 LB] Failed to parse leaderboard string:', e); return; }
    }
    if (_pollFrame > 0 && _pollFrame <= 3) console.log('[K10 LB] raw type:', typeof raw, 'isArray:', Array.isArray(raw), 'length:', raw ? raw.length : 0, 'sample:', raw ? JSON.stringify(raw).slice(0, 200) : 'null');
    if (!raw || !Array.isArray(raw) || raw.length === 0) return;

    // Dedupe: skip render if data hasn't changed (+ settings version).
    // Hash is a fast concatenation of just the display-affecting fields
    // (pos|name|lap|gap|pit) — JSON.stringify(raw) used to allocate a
    // ~30KB string per tick for a 60-car field even on the bail path.
    const expandToFill = _settings.lbExpandToFill === true;
    let dedupe = (_settings.lbFocus || 'me') + '|' + (_settings.lbMaxRows || 5)
      + '|' + (expandToFill ? '1' : '0') + '|' + (window.innerHeight || 0);
    for (let i = 0; i < raw.length; i++) {
      const r = raw[i];
      // pos|name|lastLap|gapToPlayer|inPit — anything else (iRating,
      // bestLap, isPlayer flag) doesn't change visible per-tick output
      // for the 60-car field. The leaderboard re-renders on lap
      // boundaries when bestLap moves; we still pick that up via lastLap.
      dedupe += '|' + r[0] + ',' + r[1] + ',' + r[4] + ',' + r[5] + ',' + r[6];
    }
    if (dedupe === window._lbLastJson) return;
    window._lbLastJson = dedupe;

    const container = document.getElementById('lbRows');
    if (!container) return;

    // ── Focus + row limit logic ──
    const focusMode = _settings.lbFocus || 'me';

    // Update header title based on focus mode
    const headerEl = document.querySelector('.lb-header');
    if (headerEl) {
      headerEl.textContent = focusMode === 'lead' ? 'LEADERBOARD' : 'RELATIVE';
    }
    let maxRows = _settings.lbMaxRows || 5;

    // Calculate available height for the leaderboard — used by both
    // expand-to-fill (dynamic row count) and the CSS max-height safety net.
    const sec = document.getElementById('secContainer');
    const dash = document.getElementById('dashboard');
    const zoom = parseFloat(sec ? sec.style.zoom : 1) || 1;
    const vpH = window.innerHeight || 600;
    const GAP = 24; // minimum gap between leaderboard and opposite-edge HUD

    // Measure how much vertical space the main dashboard occupies
    let dashFootprint = 0;
    if (dash) {
      const dashRect = dash.getBoundingClientRect();
      if (dashRect.height > 0) dashFootprint = dashRect.height;
    }

    // Available height = viewport minus dashboard footprint minus edges minus gap
    const edgePx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--edge') || '10');
    const availH = Math.max(100, (vpH - dashFootprint - edgePx * 2 - GAP) / zoom);

    // Set CSS custom property so sec-container can't overflow even without expand-to-fill
    if (sec) sec.style.setProperty('--sec-max-h', Math.floor(availH * zoom) + 'px');

    // Expand to fill: calculate max rows that fit in available space
    if (expandToFill) {
      const rowH = 22;  // approximate row height in px (in panel coordinates)
      const headerH = 36; // header + timeline + top/bottom padding
      const marginH = 16; // breathing room
      const calculatedMaxRows = Math.max(3, Math.min(raw.length, Math.floor((availH - headerH - marginH) / rowH)));
      maxRows = calculatedMaxRows;
    }

    // Entry format: [pos, name, irating, bestLap, lastLap, gapToPlayer, inPit, isPlayer]
    // Find player index and session best
    let playerIdx = -1;
    let sessionBest = Infinity;
    for (let i = 0; i < raw.length; i++) {
      if (raw[i][7] === 1) {
        playerIdx = i;
        playerLastLap = +raw[i][4]; // capture player's last lap
      }
      const b = +raw[i][3];
      if (b > 0 && b < sessionBest) sessionBest = b;
    }
    if (sessionBest === Infinity) sessionBest = 0;
    // Expose session best for other modules (best lap coloring)
    window._sessionBestLap = sessionBest;

    // Slice visible entries based on focus mode
    let visible;
    if (focusMode === 'lead') {
      // Show from P1, up to maxRows
      visible = raw.slice(0, maxRows);
    } else {
      // ── Relative mode: sort by gap-to-player, center on player ──
      if (playerIdx < 0) {
        visible = raw.slice(0, maxRows);
      } else {
        // Build sorted copy: drivers ordered by gapToPlayer (ahead at top, behind at bottom)
        // gapToPlayer (index 5): negative = ahead, 0 = player, positive = behind
        const sorted = raw.slice().sort((a, b) => {
          const gA = a[7] === 1 ? 0 : +a[5];
          const gB = b[7] === 1 ? 0 : +b[5];
          return gA - gB;
        });

        // Find player in the sorted array
        let sortedPlayerIdx = sorted.findIndex(e => e[7] === 1);
        if (sortedPlayerIdx < 0) sortedPlayerIdx = 0;

        // Hard-center: player is always at exactly floor(maxRows/2)
        const half = Math.floor(maxRows / 2);
        let start = sortedPlayerIdx - half;
        let end = start + maxRows;

        // Clamp to array bounds while keeping player centered
        if (start < 0) { start = 0; end = Math.min(sorted.length, maxRows); }
        if (end > sorted.length) { end = sorted.length; start = Math.max(0, end - maxRows); }

        visible = sorted.slice(start, end);
      }
    }

    // Track which driver names appear this tick so stale rows can be
    // pulled out of the pool at the end.
    const seenNames = new Set();
    // visibleRows[i] = the row object that should sit at DOM position i.
    const visibleRows = new Array(visible.length);

    for (let vi = 0; vi < visible.length; vi++) {
      const entry = visible[vi];
      const [pos, name, ir, best, last, gap, pit, isPlayer] = entry;
      const isSelf = isPlayer === 1;
      seenNames.add(name);

      let row = _rowPool.get(name);
      if (!row) {
        row = _buildRow();
        _rowPool.set(name, row);
      }
      visibleRows[vi] = row;

      // Class set
      let classStr = 'lb-row';
      if (isSelf) {
        classStr += ' lb-player';
        if (pos === 1) classStr += ' lb-p1';
        else if (_startPosition > 0 && pos < _startPosition) classStr += ' lb-ahead';
        else if (_startPosition > 0 && pos > _startPosition) classStr += ' lb-behind';
        else classStr += ' lb-same';
      }
      if (!isSelf && _startPosition > 0 && pos === _startPosition && _lastPosition !== _startPosition) {
        classStr += ' lb-start-pos';
      }
      if (pit) classStr += ' lb-pit';
      _setClass(row, classStr);

      // Gap display based on focus mode
      let gapStr = '', gapClass = 'gap-player';
      if (isSelf) {
        gapStr = '';
      } else if (focusMode === 'lead') {
        // In 'lead' mode, show either lap time (P1) or gap to leader
        if (pos === 1) {
          // P1: show their last lap time formatted as mm:ss.fff
          if (last > 0) {
            const m = Math.floor(last / 60), s = last - m * 60;
            gapStr = m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
          }
          gapClass = 'gap-leader';
        } else {
          // Others: show gap to P1 (first entry in raw array)
          const leader = raw[0];
          if (leader) {
            const leaderLast = +leader[4]; // P1's lastLap
            const gapToLeader = last > 0 && leaderLast > 0 ? last - leaderLast : 0;
            if (gapToLeader > 0) {
              gapStr = '+' + gapToLeader.toFixed(1) + 's';
              gapClass = 'gap-behind';
            } else if (gapToLeader < 0) {
              gapStr = '-' + Math.abs(gapToLeader).toFixed(1) + 's';
              gapClass = 'gap-ahead';
            }
          }
        }
      } else {
        // 'me' mode: show actual on-track gap to player from plugin data
        const gapToPlayer = +gap;
        if (gapToPlayer !== 0 && !isNaN(gapToPlayer)) {
          if (gapToPlayer > 0) {
            gapStr = '+' + gapToPlayer.toFixed(1) + 's';
            gapClass = 'gap-behind';
          } else {
            gapStr = gapToPlayer.toFixed(1) + 's';
            gapClass = 'gap-ahead';
          }
        } else {
          gapStr = '';
        }
      }

      // iRating shorthand
      const irStr = ir > 0 ? (ir >= 1000 ? (ir / 1000).toFixed(1) + 'k' : '' + ir) : '';

      // ── Sparkline data collection ──
      // Non-player: track lap times. Player: track position (seeded from grid).
      if (isSelf) {
        // Seed position history with grid position on first sight
        if (!_posHistorySeeded && _startPosition > 0) {
          _posHistory.push(_startPosition);
          _posHistorySeeded = true;
        }
        // Only record real positions after green flag (not during rolling/formation).
        // This preserves the grid → green flag position jump as the first movement.
        if (!window._isRollingStart && pos > 0 && (_posHistory.length === 0 || _posHistory[_posHistory.length - 1] !== pos)) {
          _posHistory.push(pos);
          if (_posHistory.length > SPARK_MAX) _posHistory.shift();
        }
      } else {
        // Non-player: track lap times as before
        const lastNum = +last;
        if (lastNum > 0) {
          if (!_sparkHistory[name]) _sparkHistory[name] = [];
          const h = _sparkHistory[name];
          if (h.length === 0 || h[h.length - 1] !== lastNum) {
            h.push(lastNum);
            if (h.length > SPARK_MAX) h.shift();
          }
        }
      }

      // ── Sparkline points + color ──
      // Compute as a single string so the cached comparator can short
      // circuit when the underlying history hasn't moved.
      let sparkPts = '', sparkColor = '', sparkVisible = false;

      if (isSelf && _posHistory.length >= 2) {
        const mn = Math.min(..._posHistory), mx = Math.max(..._posHistory);
        const range = mx - mn || 1;
        const w = 44, h2 = 14;
        let pts = '';
        for (let i = 0; i < _posHistory.length; i++) {
          const x = (i / (_posHistory.length - 1)) * w;
          const y = ((_posHistory[i] - mn) / range) * h2;
          if (i === 0) pts += x.toFixed(1) + ',' + y.toFixed(1);
          else {
            const prevY = ((_posHistory[i - 1] - mn) / range) * h2;
            pts += ' ' + x.toFixed(1) + ',' + prevY.toFixed(1);
            pts += ' ' + x.toFixed(1) + ',' + y.toFixed(1);
          }
        }
        // Append a synthetic last-point that aligns the dot to (w, lastY)
        const lastY = ((_posHistory[_posHistory.length - 1] - mn) / range) * h2;
        pts += ' ' + w.toFixed(1) + ',' + lastY.toFixed(1);
        sparkPts = pts;
        sparkVisible = true;
        if (pos === 1) sparkColor = 'hsla(42,80%,55%,1)';
        else if (_startPosition > 0 && pos < _startPosition) sparkColor = 'hsla(145,75%,50%,1)';
        else if (_startPosition > 0 && pos > _startPosition) sparkColor = 'hsla(0,75%,50%,1)';
        else sparkColor = 'hsla(210,75%,55%,1)';
      } else if (!isSelf) {
        const hist = _sparkHistory[name] ? _sparkHistory[name].filter(v => v > 0) : null;
        if (hist && hist.length >= 2) {
          const mn = Math.min(...hist), mx = Math.max(...hist);
          const range = mx - mn || 1;
          const w = 44, h2 = 14;
          let pts = '';
          for (let i = 0; i < hist.length; i++) {
            const x = (i / (hist.length - 1)) * w;
            const y = ((hist[i] - mn) / range) * h2;
            if (i === 0) pts += x.toFixed(1) + ',' + y.toFixed(1);
            else {
              const prevY = ((hist[i - 1] - mn) / range) * h2;
              pts += ' ' + x.toFixed(1) + ',' + prevY.toFixed(1);
              pts += ' ' + x.toFixed(1) + ',' + y.toFixed(1);
            }
          }
          const lastY = ((hist[hist.length - 1] - mn) / range) * h2;
          pts += ' ' + w.toFixed(1) + ',' + lastY.toFixed(1);
          sparkPts = pts;
          sparkVisible = true;
          sparkColor = 'hsla(0,0%,100%,0.3)';
        }
      }
      // Note: dashed-baseline (pre-green-flag) rendering dropped here —
      // a flat dash isn't worth the SVG. An empty cell during rolling
      // start is honest about "no laps yet" without burning paint
      // budget. Re-add via a CSS pseudo-element if you want it back.

      _setSpark(row, sparkPts, sparkColor, sparkVisible);

      // Lap time display with color coding
      let lapStr = '', lapClass = 'lb-lap';
      if (last > 0) {
        const m = Math.floor(last / 60), s = last - m * 60;
        lapStr = m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
        if (sessionBest > 0 && Math.abs(last - sessionBest) < 0.05) lapClass = 'lb-lap lap-pb';
        else if (best > 0 && Math.abs(last - best) < 0.05) lapClass = 'lb-lap lap-fast';
        else lapClass = 'lb-lap lap-slow';
      }
      _setText(row.lapEl, lapStr, 'lastLapText', row);
      if (row.lastLapClass !== lapClass) {
        row.lapEl.className = lapClass;
        row.lastLapClass = lapClass;
      }

      // Position number
      _setText(row.posEl, '' + pos, 'lastPosText', row);

      // Driver name (text node only — pit chip is a sibling span)
      const displayName = isSelf ? _driverDisplayName : formatName(name);
      _setText(row.nameTextNode, displayName, 'lastNameText', row);
      if (row.lastPitVisible !== !!pit) {
        row.pitChipEl.style.display = pit ? '' : 'none';
        row.lastPitVisible = !!pit;
      }

      // Gap
      const gapFullClass = 'lb-gap ' + gapClass;
      _setText(row.gapEl, gapStr, 'lastGapText', row);
      if (row.lastGapClass !== gapFullClass) {
        row.gapEl.className = gapFullClass;
        row.lastGapClass = gapFullClass;
      }
    }

    // ── Apply DOM order + drop stale rows ─────────────────────
    // appendChild on an existing node moves it; cheaper than detaching
    // and re-creating. Only re-orders rows that are out of place.
    for (let i = 0; i < visibleRows.length; i++) {
      const wantNode = visibleRows[i].el;
      const haveNode = container.children[i];
      if (haveNode !== wantNode) container.appendChild(wantNode);
    }
    // Trim DOM to only the visible rows (extras from a previous render
    // when more drivers were on screen).
    while (container.children.length > visibleRows.length) {
      container.removeChild(container.lastChild);
    }
    // Garbage-collect pool entries for drivers no longer present so
    // the pool doesn't grow unbounded across sessions.
    for (const key of _rowPool.keys()) {
      if (!seenNames.has(key)) {
        const stale = _rowPool.get(key);
        if (stale.el.parentNode) stale.el.parentNode.removeChild(stale.el);
        _rowPool.delete(key);
      }
    }

    // Update WebGL highlight position after DOM update
    requestAnimationFrame(function() {
      if (window.updateLBPlayerPos) window.updateLBPlayerPos();
    });
  }


  function formatName(fullName) {
    // Format: "F. LastName" where F is first initial
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 0) return fullName;
    if (parts.length === 1) return fullName;
    const firstName = parts[0];
    const lastName = parts[parts.length - 1];
    return firstName.charAt(0).toUpperCase() + '. ' + lastName;
  }
