// Leaderboard renderer

  // ═══════════════════════════════════════════════════════════════
  //  LEADERBOARD RENDERER
  // ═══════════════════════════════════════════════════════════════

  // ── Each car's place through the race in hand ─────────────────
  // One trail per car: where the car was at the first frame of the race in which it has a place (the driver's own
  // starts from his grid slot), then every change of place, on the page's own clock. Only a race has one. In
  // practice, qualifying and warm-up "position" is the order of best laps, and one line that means two things is
  // what drew his race going down while he went up the grid: the line began with the ranks of the sessions before.
  // A trail belongs to one session (its type and track) and to one green flag, and is dropped with either. It is
  // drawn from the green flag on, through the chequered flag and the cool-down (that is when he looks back at how the
  // race went), with its right-hand end held where the race ended.
  const TRAIL_MAX = 64;            // the start is always kept; past this the oldest change after it goes
  const _trails = new Map();       // name -> { pts: [[t, place], …], v: <number of changes> }
  let _trailType = '';             // the session the trails belong to: its type, and its track
  let _trailTrack = '';
  let _trailEnd = 0;               // the page's clock at the last frame of the race that added to the trails

  function resetLeaderboardTrails() {
    _trails.clear();
    _trailType = '';
    _trailTrack = '';
    _trailEnd = 0;
  }
  window.resetLeaderboardTrails = resetLeaderboardTrails;

  // Which session this frame is; whether it is a race under way (green or chequered flag: `racing`, when trails are
  // added to); and whether it is a race whose trails are to be drawn (`shown`: that, and the cool-down after it).
  function _trailSession(p) {
    const demo = +p['RacingDesk.Plugin.DemoMode'] || 0;
    const ds = demo ? 'RacingDesk.Plugin.Demo.DS.' : 'RacingDesk.Plugin.DS.';
    const grid = demo ? 'RacingDesk.Plugin.Demo.Grid.' : 'RacingDesk.Plugin.Grid.';
    const type = '' + (p[demo ? 'RacingDesk.Plugin.Demo.SessionTypeName' : 'RacingDesk.Plugin.SessionTypeName'] || '');
    // The plugin's own name for the track, and no other: a second source with a name of its own for the same track
    // would be two sessions, every time the frames took turns to say it.
    const track = '' + (p['RacingDesk.Plugin.TrackMap.TrackName'] || '');
    const mode = +p[ds + 'SessionMode'] || 0;              // 4 is a race
    const state = parseInt(p[grid + 'SessionState']) || 0; // 4 racing, 5 chequered
    return { type, track, racing: mode === 4 && (state === 4 || state === 5), shown: mode === 4 && state >= 4 };
  }

  // Every car in the field, not only the ones on show, so that a car scrolling into view has its history.
  function _recordTrails(raw, at) {
    for (let i = 0; i < raw.length; i++) {
      const r = raw[i];
      const pos = +r[0];
      if (!(pos > 0)) continue;   // the sim gives no place for a few seconds after the green
      const name = r[1];
      let tr = _trails.get(name);
      if (!tr) {
        tr = { pts: [], v: 0 };
        _trails.set(name, tr);
      }
      const pts = tr.pts;
      if (pts.length === 0) {
        // His own line starts at the grid slot the host kept, whatever place the first frame gave him.
        const start = r[7] === 1 && _startPosition > 0 ? _startPosition : pos;
        pts.push([at, start]);
        if (start !== pos) pts.push([at, pos]);
        tr.v++;
      } else if (pts[pts.length - 1][1] !== pos) {
        pts.push([at, pos]);
        if (pts.length > TRAIL_MAX) pts.splice(1, 1);
        tr.v++;
      }
    }
  }

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
  const SPARK_W = 44;      // the sparkline's cell, in its own units
  const SPARK_H = 14;
  const SPARK_PAD = 1.5;   // the line stays this far from the top and the foot, so a stroke there is not cut

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
    pitChip.textContent = 'In pit';
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

    // The cell is 44 by 14 units drawn over whatever box the row gives it (preserveAspectRatio none), so the
    // strokes are set in pixels (leaderboard.css, vector-effect) and not stretched with it. Three things in it: a
    // dashed hairline at the place the race began, the line, and the dot where the line is now.
    const sparkSvg = document.createElementNS(SVG_NS, 'svg');
    sparkSvg.setAttribute('class', 'lb-spark');
    sparkSvg.setAttribute('preserveAspectRatio', 'none');
    sparkSvg.setAttribute('viewBox', '0 0 ' + SPARK_W + ' ' + SPARK_H);
    const sparkBase = document.createElementNS(SVG_NS, 'line');
    sparkBase.setAttribute('class', 'lb-spark-start');
    sparkBase.setAttribute('x1', '0');
    sparkBase.setAttribute('x2', String(SPARK_W));
    const sparkLine = document.createElementNS(SVG_NS, 'polyline');
    sparkLine.setAttribute('class', 'lb-spark-line');
    sparkLine.setAttribute('fill', 'none');
    sparkLine.setAttribute('stroke-linecap', 'round');
    sparkLine.setAttribute('stroke-linejoin', 'round');
    const sparkDot = document.createElementNS(SVG_NS, 'line');
    sparkDot.setAttribute('class', 'lb-spark-dot');
    sparkDot.setAttribute('stroke-linecap', 'round');
    sparkSvg.appendChild(sparkBase);
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
      sparkSvg, sparkBase, sparkLine, sparkDot,
      // Cached values so setAttribute / textContent only fires on change
      lastClassName: '', lastPosText: '', lastNameText: '', lastPitVisible: false,
      lastGapText: '', lastGapClass: '',
      lastLapText: '', lastLapClass: '',
      lastSparkTrail: null, lastSparkKey: '', lastSparkPts: '', lastSparkBase: '', lastSparkColor: '', lastSparkVisible: false,
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

  // The line for a car's trail: the race's own time across (its start at the left, now at the right) and the place
  // up and down with the better place higher, so P1 is the top when it is reached. The vertical scale is the trail's
  // own range, at least two places wide, so a single place gained is a visible step. The dashed hairline is where
  // the race began: above it is places gained, below it places lost.
  function _trailShape(trail, at) {
    const pts = trail.pts;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const q = pts[i][1];
      if (q < lo) lo = q;
      if (q > hi) hi = q;
    }
    if (hi - lo < 2) {
      const mid = (lo + hi) / 2;
      lo = mid - 1;
      hi = mid + 1;
    }
    const room = SPARK_H - 2 * SPARK_PAD;
    const yOf = (q) => SPARK_PAD + ((q - lo) / (hi - lo)) * room;
    const t0 = pts[0][0];
    const span = Math.max(1, at - t0);
    let line = '';
    let lastY = 0;
    for (let i = 0; i < pts.length; i++) {
      const x = ((pts[i][0] - t0) / span) * SPARK_W;
      const y = yOf(pts[i][1]);
      if (i > 0) line += ' ' + x.toFixed(1) + ',' + lastY.toFixed(1);   // hold the last place until the change
      line += (i > 0 ? ' ' : '') + x.toFixed(1) + ',' + y.toFixed(1);
      lastY = y;
    }
    line += ' ' + SPARK_W + ',' + lastY.toFixed(1);
    return { line, start: yOf(pts[0][1]).toFixed(1), lastY: lastY.toFixed(1) };
  }

  // Redrawn only when the trail has changed or a second has gone by (the right-hand end of the line is now), and a
  // node is written to only when what it says has changed.
  function _setSpark(row, trail, at, color) {
    const visible = !!trail;
    if (row.lastSparkVisible !== visible) {
      row.sparkSvg.style.display = visible ? '' : 'none';
      row.lastSparkVisible = visible;
    }
    if (!visible) return;
    const key = trail.v + ':' + ((at / 1000) | 0);
    if (row.lastSparkTrail !== trail || row.lastSparkKey !== key) {
      row.lastSparkTrail = trail;
      row.lastSparkKey = key;
      const shape = _trailShape(trail, at);
      if (row.lastSparkPts !== shape.line) {
        row.sparkLine.setAttribute('points', shape.line);
        row.sparkDot.setAttribute('x1', String(SPARK_W));
        row.sparkDot.setAttribute('x2', String(SPARK_W));
        row.sparkDot.setAttribute('y1', shape.lastY);
        row.sparkDot.setAttribute('y2', shape.lastY);
        row.lastSparkPts = shape.line;
      }
      if (row.lastSparkBase !== shape.start) {
        row.sparkBase.setAttribute('y1', shape.start);
        row.sparkBase.setAttribute('y2', shape.start);
        row.lastSparkBase = shape.start;
      }
    }
    if (row.lastSparkColor !== color) {
      row.sparkLine.setAttribute('stroke', color);
      row.sparkDot.setAttribute('stroke', color);
      row.lastSparkColor = color;
    }
  }

  // In the glance layout (drive-view.css) the panel is one cell of a grid and its rows share its height, so how many
  // fit is the cell's business and not the sum the rig's HUD does of the screen minus the dashboard: as many as the
  // type the cell gives them takes at 1.9 lines to a row. Asked again only when the window changes size.
  let _driveRows = { w: 0, h: 0, n: 0 };
  function _driveRowCount(rowsEl) {
    const w = window.innerWidth, h = window.innerHeight;
    if (_driveRows.n > 0 && _driveRows.w === w && _driveRows.h === h) return _driveRows.n;
    const room = rowsEl.clientHeight;
    if (!(room > 0)) return _driveRows.n || 8;   // not laid out yet: the next frame asks again
    const fs = parseFloat(getComputedStyle(rowsEl).fontSize) || 16;
    _driveRows = { w, h, n: Math.max(3, Math.floor(room / (fs * 1.9))) };
    return _driveRows.n;
  }

  function updateLeaderboard(p) {
    const lbPanel = document.getElementById('leaderboardPanel');
    if (!lbPanel || lbPanel.classList.contains('section-hidden')) return;
    // A test drive has no field: the panel is not shown (poll-engine.js sets the class; leaderboard.css and
    // drive-view.css hide it), and its rows are not written while it is away.
    if (document.body.classList.contains('session-testdrive')) return;
    // Leaderboard comes as raw JSON array from the plugin
    let raw = p['RacingDesk.Plugin.Leaderboard'];
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
    const driveView = document.body.classList.contains('drive-mode-active');
    let dedupe = (_settings.lbFocus || 'me') + '|' + (_settings.lbMaxRows || 5)
      + '|' + (expandToFill ? '1' : '0') + '|' + (window.innerHeight || 0) + '|' + (driveView ? window.innerWidth : 0);
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

    // Each car's place through the race: a new session starts new trails, and only a race under way adds to them.
    const trailNow = performance.now();
    // A frame that names no type or no track says nothing about which session it is, and changes nothing.
    const session = _trailSession(p);
    if ((session.type && session.type !== _trailType) || (session.track && session.track !== _trailTrack)) _trails.clear();
    if (session.type) _trailType = session.type;
    if (session.track) _trailTrack = session.track;
    if (session.racing) {
      _recordTrails(raw, trailNow);
      _trailEnd = trailNow;
    }

    // ── Focus + row limit logic ──
    const focusMode = _settings.lbFocus || 'me';

    // The panel is the standings, whichever row it centres on: it never shows relative (on-track) timings, so it
    // is called the leaderboard either way.
    const headerEl = document.querySelector('.lb-header');
    if (headerEl && headerEl.textContent !== 'Leaderboard') headerEl.textContent = 'Leaderboard';
    let maxRows = _settings.lbMaxRows || 5;

    if (driveView) {
      maxRows = _driveRowCount(container);
    } else {
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

      // ── Sparkline: this car's place through the race ──
      // Drawn from the trail the frame's walk of the whole field made (_recordTrails), and only in a race and its
      // cool-down: out of one the cell is empty, and the last-lap column carries the lap's colour. His own line is
      // coloured by where he stands against where he began (gold P1, green ahead of the start, red behind it, blue
      // where it began); the rest are white.
      const trail = session.shown ? _trails.get(name) : null;
      let sparkColor = 'hsla(0,0%,100%,0.35)';
      if (isSelf) {
        const began = trail ? trail.pts[0][1] : _startPosition;
        if (pos === 1) sparkColor = 'hsla(42,80%,55%,1)';
        else if (began > 0 && pos < began) sparkColor = 'hsla(145,75%,50%,1)';
        else if (began > 0 && pos > began) sparkColor = 'hsla(0,75%,50%,1)';
        else sparkColor = 'hsla(210,75%,55%,1)';
      }
      _setSpark(row, trail, session.racing ? trailNow : _trailEnd, sparkColor);

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
    // Each row is put in its place, before whatever is there now: moving an existing node is cheaper than detaching
    // and re-creating it, and only rows out of place are moved. (Appending them to the end, as this did, left the rows
    // of the cars that had gone out of view at the top and then cut the wanted ones off the bottom: a field that
    // shifted by several places at once — he climbed, a pit stop — showed a row or two in the wrong order.)
    for (let i = 0; i < visibleRows.length; i++) {
      const wantNode = visibleRows[i].el;
      const haveNode = container.children[i];
      if (haveNode !== wantNode) container.insertBefore(wantNode, haveNode || null);
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
    // The name is shown as the source sends it. Every other driver's is a character's from packages/pseudonyms, already in
    // this board's style (the initial, a dot, the surname: "H. Incandenza"), and a character known by a nickname alone
    // ("Sick Boy") is sent whole and must stay whole — the shortening this did to real names would have cut it in two. The
    // incident coach matches its threats to these rows by this text, so the text is the one the source chose.
    return typeof fullName === 'string' ? fullName.trim() : '';
  }
