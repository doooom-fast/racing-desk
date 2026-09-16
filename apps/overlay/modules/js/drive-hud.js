// ═══════════════════════════════════════════════════════════════
//  DRIVE HUD — Driver-focused full-screen mode
//  Shows: track map + sectors, lap delta, position, spotter, incidents
//  Ctrl+Shift+F to toggle. Auto-activates on remote server connections.
// ═══════════════════════════════════════════════════════════════

(function() {
  'use strict';

  let _active = false;
  let _dhHeadingSmooth = 0; // LERP-smoothed heading (degrees) to reduce judder
  let _dhLastMapTime = 0;   // timestamp for time-based LERP

  function toggleDriveMode() {
    _active = !_active;
    _applyDriveMode();
    _settings.driveMode = _active;
    saveSettings();
  }
  window.toggleDriveMode = toggleDriveMode;

  function setDriveMode(on) {
    _active = !!on;
    _applyDriveMode();
  }
  window.setDriveMode = setDriveMode;

  function _applyDriveMode() {
    var hud = document.getElementById('driveHud');
    document.body.classList.toggle('drive-mode-active', _active);
    if (hud) hud.style.display = _active ? 'grid' : 'none';
    // Restore transparent background when exiting
    if (!_active) document.body.style.background = '';
  }

  // ── Update drive HUD data (called from poll engine each frame) ──
  function updateDriveHud(p, isDemo) {
    if (!_active) return;

    const dsPre = isDemo ? 'RaceCorProDrive.Plugin.Demo.DS.' : 'RaceCorProDrive.Plugin.DS.';
    const v = function(k) { return p[k] != null ? p[k] : 0; };

    // Position
    const pos = isDemo
      ? (+v('RaceCorProDrive.Plugin.Demo.Position') || 0)
      : (+v('DataCorePlugin.GameData.Position') || 0);
    const posEl = document.getElementById('dhPosition');
    if (posEl) posEl.textContent = pos > 0 ? 'P' + pos : 'P—';

    // Lap delta
    const lapDelta = +(p[dsPre + 'LapDelta']) || 0;
    const deltaEl = document.getElementById('dhLapDelta');
    if (deltaEl) {
      deltaEl.textContent = lapDelta === 0 ? '+0.000' : (lapDelta >= 0 ? '+' : '') + lapDelta.toFixed(3);
      deltaEl.classList.remove('dh-faster', 'dh-slower', 'dh-neutral');
      if (lapDelta < -0.05) deltaEl.classList.add('dh-faster');
      else if (lapDelta > 0.05) deltaEl.classList.add('dh-slower');
      else deltaEl.classList.add('dh-neutral');
    }

    // Last / Current lap number
    var bestLap = isDemo ? (+v('RaceCorProDrive.Plugin.Demo.BestLapTime') || 0) : (+v('DataCorePlugin.GameData.BestLapTime') || 0);
    var lastLap = isDemo ? (+v('RaceCorProDrive.Plugin.Demo.LastLapTime') || 0) : (+v('DataCorePlugin.GameData.LastLapTime') || 0);
    var curLap = isDemo ? (+v('RaceCorProDrive.Plugin.Demo.CurrentLap') || 0) : (+v('DataCorePlugin.GameData.CurrentLap') || 0);
    var lastEl = document.getElementById('dhLastLap');
    var lapEl = document.getElementById('dhCurrentLap');
    if (lastEl) lastEl.textContent = lastLap > 0 ? _fmtLapTime(lastLap) : '—';
    if (lapEl) lapEl.textContent = curLap > 0 ? curLap : '—';

    // Live lap time + delta to best (absolutely positioned, centered)
    var liveCurrentTime = isDemo
      ? (+(p['RaceCorProDrive.Plugin.Demo.CurrentLapTime']) || 0)
      : (+(p['DataCorePlugin.GameData.CurrentLapTime']) || 0);
    var liveTimeEl = document.getElementById('dhLiveTime');
    var liveDeltaEl = document.getElementById('dhLiveDelta');
    if (liveTimeEl) {
      liveTimeEl.textContent = liveCurrentTime > 0.5 ? _fmtLapTime(liveCurrentTime) : '—';
    }
    if (liveDeltaEl && liveCurrentTime > 0.5) {
      // Use the real-time delta from the big display (same source, already computed)
      if (liveCurrentTime > 5 && Math.abs(lapDelta) < 300) {
        var sign = lapDelta >= 0 ? '+' : '';
        liveDeltaEl.textContent = sign + lapDelta.toFixed(3);
        liveDeltaEl.className = 'dh-live-delta';
        if (lapDelta <= -0.5) liveDeltaEl.classList.add('dh-delta-pb');
        else if (lapDelta < 0) liveDeltaEl.classList.add('dh-delta-faster');
        else if (lapDelta < 1.0) liveDeltaEl.classList.add('dh-delta-slower');
        else liveDeltaEl.classList.add('dh-delta-much-slower');
      } else {
        liveDeltaEl.textContent = '';
      }
    } else if (liveDeltaEl) {
      liveDeltaEl.textContent = '';
    }

    // Sectors — use cloud-configured count only (no SimHub fallback)
    var curSector = +(p[dsPre + 'CurrentSector']) || 1;
    var cloudSectors = window._sectorData && window._sectorData.sectorCount;
    var sectorCount = cloudSectors || 0;
    var splitsStr = p[dsPre + 'SectorSplits'] || '';
    var splits, deltas, states;
    if (splitsStr) {
      splits = splitsStr.split(',').map(Number);
      deltas = (p[dsPre + 'SectorDeltas'] || '').split(',').map(Number);
      states = (p[dsPre + 'SectorStates'] || '').split(',').map(Number);
    } else {
      splits = []; deltas = []; states = [];
      for (var si = 1; si <= sectorCount; si++) {
        splits.push(+(p[dsPre + 'SectorSplitS' + si]) || 0);
        deltas.push(+(p[dsPre + 'SectorDeltaS' + si]) || 0);
        states.push(+(p[dsPre + 'SectorStateS' + si]) || 0);
      }
    }
    // Color mapping: green = my best, yellow = worse than my best, red = invalid
    // No purple — we don't have "best of everyone on track" data
    // state: 0=none, 1=pb (treat as green), 2=faster (green), 3=slower (yellow)
    var dhStateClass = ['', 'dh-s-faster', 'dh-s-faster', 'dh-s-slower'];

    // Dynamically create/update drive HUD sector cells (label only — no times)
    var dhSectorsEl = document.querySelector('.dh-sectors');
    if (dhSectorsEl) {
      var existingCells = dhSectorsEl.querySelectorAll('.dh-sector');
      if (existingCells.length !== sectorCount) {
        dhSectorsEl.innerHTML = '';
        for (var ci = 1; ci <= sectorCount; ci++) {
          var cell = document.createElement('div');
          cell.className = 'dh-sector';
          cell.id = 'dhS' + ci;
          cell.innerHTML = '<div class="dh-sec-label">S' + ci + '</div>';
          dhSectorsEl.appendChild(cell);
        }
      }
    }

    for (var si = 1; si <= sectorCount; si++) {
      var cell = document.getElementById('dhS' + si);
      if (!cell) continue;

      cell.classList.remove('dh-s-pb', 'dh-s-faster', 'dh-s-slower', 'dh-s-invalid', 'dh-s-active');

      // If lap is invalid (incident occurred), mark all sectors red
      if (_lapInvalid) cell.classList.add('dh-s-invalid');

      if (si === curSector) {
        cell.classList.add('dh-s-active');
        // Live delta coloring on active sector
        if (!_lapInvalid && lapDelta !== 0) {
          cell.classList.add(lapDelta < 0 ? 'dh-s-faster' : 'dh-s-slower');
        }
      } else if (states[si - 1] > 0) {
        // Completed sector with a new performance state — apply and cache it
        if (!_lapInvalid) {
          var cls = dhStateClass[states[si - 1]];
          if (cls) cell.classList.add(cls);
        }
        _prevSectorStates[si - 1] = states[si - 1];
      } else if (_prevSectorStates[si - 1] > 0) {
        // No new state yet (e.g. new lap, splits cleared) — retain previous color
        if (!_lapInvalid) {
          var cls = dhStateClass[_prevSectorStates[si - 1]];
          if (cls) cell.classList.add(cls);
        }
      }
    }

    // Incidents
    var incCount = +(p[dsPre + 'IncidentCount']) || 0;
    var incEl = document.getElementById('dhIncCount');
    if (incEl) incEl.innerHTML = incCount + '<span class="dh-inc-x">x</span>';
    var penEl = document.getElementById('dhIncToPen');
    var dqEl = document.getElementById('dhIncToDQ');
    var isNonRace = !!(+(p[dsPre + 'IsNonRaceSession']) || 0);
    var sdkPen = isNonRace ? 0 : (+(p[dsPre + 'IncidentLimitPenalty']) || 0);
    var sdkDQ  = isNonRace ? 0 : (+(p[dsPre + 'IncidentLimitDQ']) || 0);
    var dhThresh = document.querySelector('.dh-inc-thresholds');
    if (sdkPen > 0 && sdkDQ > 0) {
      // Both penalty and DQ
      if (penEl) penEl.textContent = Math.max(0, sdkPen - incCount);
      if (dqEl) dqEl.textContent = Math.max(0, sdkDQ - incCount);
      if (dhThresh) dhThresh.style.display = '';
      if (penEl) penEl.nextSibling.textContent = ' to pen ';
    } else if (sdkDQ > 0) {
      // DQ only — hide penalty, show DQ
      if (penEl) { penEl.textContent = ''; penEl.nextSibling.textContent = ''; }
      if (dqEl) dqEl.textContent = Math.max(0, sdkDQ - incCount);
      if (dhThresh) dhThresh.style.display = '';
    } else {
      // No limits (practice, test, etc.) — hide thresholds row
      if (dhThresh) dhThresh.style.display = 'none';
    }

    // Track map — local zoom view centered on player + opponents
    var mapReady = +v('RaceCorProDrive.Plugin.TrackMap.Ready') || 0;
    if (mapReady) {
      var _dhTrackName = (p['RaceCorProDrive.Plugin.TrackMap.TrackName']
                       || p['DataCorePlugin.GameData.TrackName'] || '');
      // Prefer web API SVG (curated), fall back to the plugin's local SvgPath
      // when the API cache is empty so the track still draws while we wait
      // for (or if we never get) the override.
      var _apiSvg = (window._trackApiSvgCache && window._trackApiSvgCache[_dhTrackName]) || '';
      var _pluginSvg = (p['RaceCorProDrive.Plugin.TrackMap.SvgPath'] || '');
      var svgPath = _apiSvg || _pluginSvg || '';
      var dhTrack = document.getElementById('dhMapTrack');
      if (dhTrack && svgPath && dhTrack.getAttribute('d') !== svgPath) {
        dhTrack.setAttribute('d', svgPath);
        if (typeof _splitPathIntoSectors === 'function') {
          var boundaryPcts = Array.isArray(window._sectorBoundaries) ? window._sectorBoundaries : null;
          var sPaths = _splitPathIntoSectors(svgPath, boundaryPcts);
          // Dynamically create/update sector paths inside the rotate group
          var dhRotateGrp = document.getElementById('dhMapRotateGroup');
          if (dhRotateGrp) {
            dhRotateGrp.querySelectorAll('.map-sector').forEach(function(el) { el.remove(); });
            var dhOpp = document.getElementById('dhMapOpponents');
            for (var i = 0; i < sPaths.length; i++) {
              var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
              path.classList.add('map-sector');
              path.id = 'dhSector' + (i + 1);
              path.setAttribute('d', sPaths[i]);
              if (dhOpp) dhRotateGrp.insertBefore(path, dhOpp);
              else dhRotateGrp.appendChild(path);
            }
          }
        }
      }

      // Player position. When the API SVG is in use AND we have its points,
      // walk them by LapDistPct so the dot lands on the API's path. The
      // plugin's PlayerX/Y is normalized against the plugin's local CSV
      // recording — when that CSV is corrupt or out of date with the API,
      // those coordinates put the dot off the track. Plugin coords are
      // only correct paired with the plugin's own SvgPath.
      var px, py;
      var apiPts = _apiSvg && window._trackApiPointsCache
        ? window._trackApiPointsCache[_dhTrackName]
        : null;
      if (apiPts && apiPts.length >= 2 && typeof window._lapDistToApiXY === 'function') {
        var pct = +v('RaceCorProDrive.Plugin.DS.TrackPct');
        if (!isFinite(pct)) pct = 0;
        var pos = window._lapDistToApiXY(apiPts, pct);
        if (pos) {
          px = Math.max(0, Math.min(100, pos.x));
          py = Math.max(0, Math.min(100, pos.y));
        }
      }
      if (px === undefined) {
        px = Math.max(0, Math.min(100, +v('RaceCorProDrive.Plugin.TrackMap.PlayerX') || 50));
        py = Math.max(0, Math.min(100, +v('RaceCorProDrive.Plugin.TrackMap.PlayerY') || 50));
      }

      // Update player dot
      var dhPlayer = document.getElementById('dhMapPlayer');
      if (dhPlayer) {
        dhPlayer.setAttribute('cx', px.toFixed(1));
        dhPlayer.setAttribute('cy', py.toFixed(1));
      }

      // Zoom viewBox: centered on player with expanded radius to accommodate
      // rotation. A 22-unit visible radius needs ~31 units (22 × √2) so the
      // rotated track content isn't clipped by the viewBox rectangle.
      var dhSvg = document.getElementById('dhMapSvg');
      if (dhSvg) {
        var zrVisible = 22; // visible zoom radius
        var zr = Math.ceil(zrVisible * 1.42); // ×√2 for rotation headroom
        var vx = px - zr;
        var vy = py - zr;
        dhSvg.setAttribute('viewBox', vx.toFixed(1) + ' ' + vy.toFixed(1) + ' ' + (zr * 2) + ' ' + (zr * 2));

        // Rotate map so driving direction always points up.
        // Time-based LERP smoothing eliminates heading judder regardless
        // of poll rate. Dead-zone ignores sub-degree noise.
        var rawHeading = +(p['RaceCorProDrive.Plugin.TrackMap.PlayerHeading']) || 0;
        var diff = rawHeading - _dhHeadingSmooth;
        // Normalise diff to [-180, 180] to pick the shortest rotation arc
        while (diff > 180) diff -= 360;
        while (diff < -180) diff += 360;
        // Dead-zone: ignore tiny heading jitter (< 0.5°)
        if (Math.abs(diff) < 0.5) diff = 0;
        // Time-based LERP: smooth factor ~0.10 per 33ms (30 FPS baseline)
        var now = performance.now();
        var dt = Math.min(100, now - (_dhLastMapTime || now)); // cap at 100ms
        _dhLastMapTime = now;
        var alpha = 1 - Math.pow(1 - 0.10, dt / 33);
        _dhHeadingSmooth += diff * alpha;
        _dhHeadingSmooth = ((_dhHeadingSmooth % 360) + 360) % 360;

        // Rotate the inner group around the player's SVG coordinate, NOT the
        // SVG element itself (element rotation caused rectangular crop artefacts).
        var dhRotateGroup = document.getElementById('dhMapRotateGroup');
        if (dhRotateGroup) {
          var rotDeg = (-_dhHeadingSmooth).toFixed(2);
          dhRotateGroup.setAttribute('transform',
            'rotate(' + rotDeg + ',' + px.toFixed(1) + ',' + py.toFixed(1) + ')');
        }
        // Player dot stays outside the rotate group, so no counter-rotation needed
        dhSvg.style.transform = '';
        dhSvg.style.transformOrigin = '';
      }

      // Opponents. When the API outline is in use, reproject the plugin's
      // raw coords into its space (same remap the player dot gets above) so
      // cars sit on the track instead of floating off it.
      var opponentStr = p['RaceCorProDrive.Plugin.TrackMap.Opponents'] || '';
      if (_apiSvg && apiPts && apiPts.length >= 2 && _pluginSvg
          && typeof window._reprojectOpponentsToApi === 'function') {
        opponentStr = window._reprojectOpponentsToApi(opponentStr, _pluginSvg, apiPts);
      }
      var dhOppG = document.getElementById('dhMapOpponents');
      if (dhOppG) {
        var parts = opponentStr ? opponentStr.split(';').filter(function(s) { return s.length > 0; }) : [];
        var count = Math.min(parts.length, 63);

        // Ensure enough circle elements
        while (dhOppG.children.length < count) {
          var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          c.classList.add('map-opponent');
          c.setAttribute('r', '1.5');
          dhOppG.appendChild(c);
        }
        while (dhOppG.children.length > count) {
          dhOppG.removeChild(dhOppG.lastChild);
        }

        for (var oi = 0; oi < count; oi++) {
          var seg = parts[oi].split(',');
          if (seg.length < 2) continue;
          var ox = Math.max(0, Math.min(100, +seg[0]));
          var oy = Math.max(0, Math.min(100, +seg[1]));
          var inPit = seg[2] === '1';
          dhOppG.children[oi].setAttribute('cx', String(ox));
          dhOppG.children[oi].setAttribute('cy', String(oy));
          dhOppG.children[oi].style.display = inPit ? 'none' : '';
          // Highlight nearby opponents
          var dx = px - ox, dy = py - oy;
          var close = (dx * dx + dy * dy) < 64;
          dhOppG.children[oi].classList.toggle('close', close);
        }
      }

      // Sector colors
      if (window._sectorData) {
        var sd = window._sectorData;
        var sColors = ['transparent', 'hsl(280,60%,55%)', 'hsl(130,60%,50%)', 'hsl(0,65%,50%)'];
        for (var j = 1; j <= sd.sectorCount; j++) {
          var sEl = document.getElementById('dhSector' + j);
          if (!sEl) continue;
          sEl.setAttribute('stroke', j === sd.curSector ? 'hsla(0,0%,100%,0.25)' : (sColors[sd.states[j-1]] || 'transparent'));
        }
      }
    }

    // Track name — prefer K10 display name, fall back to game name
    var nameEl = document.getElementById('dhMapName');
    var trackName = p['RaceCorProDrive.Plugin.TrackMap.TrackName']
                 || p['DataCorePlugin.GameData.TrackName'] || '';
    if (nameEl && trackName) {
      var resolved = typeof _trackDisplayNameCache !== 'undefined' && _trackDisplayNameCache[trackName];
      nameEl.textContent = resolved || trackName;
      if (!resolved && typeof resolveTrackDisplayName === 'function') resolveTrackDisplayName(trackName);
    }
  }
  window.updateDriveHud = updateDriveHud;

  // ── Make _splitPathIntoSectors available globally ──
  // (it's defined in webgl-helpers.js, exposed here for drive hud)

  // ── Init ──
  function initDriveHud() {
    // Listen for Ctrl+Shift+F via Electron
    if (window.k10 && window.k10.onToggleDriveMode) {
      window.k10.onToggleDriveMode(toggleDriveMode);
    }

    // Auto-activate on remote server connections
    if (window._k10RemoteMode) {
      setDriveMode(true);
    }

    // Restore persisted state
    if (_settings.driveMode) {
      setDriveMode(true);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDriveHud);
  } else {
    initDriveHud();
  }
})();
