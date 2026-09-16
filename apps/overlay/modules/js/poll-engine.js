// SIMHUB HTTP API POLLING ENGINE
// Depends on: config.js (SIMHUB_URL, POLL_MS, PROP_KEYS)

  // ═══════════════════════════════════════════════════════════════
  // SIMHUB HTTP API POLLING ENGINE
  // Self-contained data bridge — polls SimHub's web server directly.
  // Works as standalone browser overlay or OBS Browser Source.
  // The JavascriptExtensions file is unused in this mode.
  //
  // Config: K10 Motorsports plugin HTTP server (port 8889)
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

  // ─── Track display name resolver ───
  // Fetches user-customized display names from the K10 API.
  // Falls back to the game-provided name if no custom name is set or API is unreachable.
  const _trackDisplayNameCache = {};    // { gameTrackName → displayName }
  const _trackSectorCountCache = {};   // { gameTrackName → sectorCount (3 or 7) }
  const _trackDisplayNamePending = {};  // { gameTrackName → true } (in-flight requests)
  // Exposed on window so drive-hud.js can also prefer API track maps
  const _trackApiSvgCache = window._trackApiSvgCache = {}; // { gameTrackName → svgPath from rawCsv }
  // Normalized points keyed by track name. Lets drive-hud.js derive the
  // player dot's (x,y) directly from LapDistPct against the API path's
  // own coordinate space, instead of trusting the plugin's PlayerX/Y
  // (which is normalized against the plugin's local — and frequently
  // stale or corrupt — track recording).
  const _trackApiPointsCache = window._trackApiPointsCache = {}; // { gameTrackName → [{x,y,p}, ...] }
  const K10_DISPLAY_NAME_API = 'https://prodrive.racecor.io/api/tracks';

  // ─── Derive approximate points from a pre-built svgPath ───
  // Used when the API returned a `svgPath` without `rawCsv` (legacy DB
  // rows from older plugin versions). We need a points array with lap
  // fractions so the player dot can be positioned via TrackPct in the
  // API's coordinate space — otherwise the rendered path is in API
  // space but PlayerX/Y comes from the plugin's local recording in a
  // different normalization, and the dot drifts relative to the track
  // (looks like the map "spins" as the user drives, especially in the
  // heading-locked zoom map).
  //
  // The path is built by Catmull-Rom → cubic Bézier: `M p0 C c1 c2 p1
  // C c1 c2 p2 ...`. Every third coord-pair starting from index 1 is a
  // track endpoint; the rest are control points adjacent to a curve.
  // We assume uniform spacing along the original CSV (which the
  // plugin's recording approximately is — points are sampled at fixed
  // distance intervals during the recording lap), so `p = i / N`. This
  // is approximate but several orders of magnitude better than mixing
  // coord spaces. Falls back to using every coord (control + endpoint)
  // when the path is just M+L (no curves).
  function _pointsFromSvgPath(svgPath) {
    var raw = svgPath.match(/[\d.]+[,\s]+[\d.]+/g);
    if (!raw || raw.length < 4) return [];
    var hasCurves = /[Cc]/.test(svgPath);
    var pts = [];
    if (hasCurves) {
      // M p0 then groups of (c1 c2 p) — keep the first coord, then
      // every third coord starting at offset 3 (the C-segment endpoint).
      var first = raw[0].split(/[,\s]+/);
      pts.push({ x: +first[0], y: +first[1], p: 0 });
      for (var i = 3; i < raw.length; i += 3) {
        var parts = raw[i].split(/[,\s]+/);
        pts.push({ x: +parts[0], y: +parts[1], p: 0 });
      }
    } else {
      for (var j = 0; j < raw.length; j++) {
        var pp = raw[j].split(/[,\s]+/);
        pts.push({ x: +pp[0], y: +pp[1], p: 0 });
      }
    }
    if (pts.length < 2) return [];
    var n = pts.length;
    for (var k = 0; k < n; k++) pts[k].p = k / n;
    return pts;
  }

  // ─── CSV → SVG conversion (mirrors C# TrackMapProvider + track-svg.ts) ───
  // When the web API has authoritative rawCsv data, we convert it here so the
  // overlay can prefer it over the plugin's locally-cached track recording.
  // Returns { path, points } — points are normalized to the same 0–100
  // viewBox as the path, each carrying its lap-distance fraction (`p`).
  function _csvToTrackData(csv) {
    var lines = csv.trim().split('\n');
    var pts = [];
    for (var i = 0; i < lines.length; i++) {
      var parts = lines[i].split(',');
      if (parts.length < 3) continue;
      var x = parseFloat(parts[0]), z = parseFloat(parts[1]), pct = parseFloat(parts[2]);
      if (isNaN(x) || isNaN(z)) continue;
      // Skip degenerate sentinel points SimHub writes at lap end
      if (x === 0 && z === 0 && pct > 0.99) continue;
      pts.push({ x: x, y: z, p: isNaN(pct) ? 0 : pct });
    }
    if (pts.length < 10) return { path: '', points: [] };

    // Normalize to 0–100 viewBox with 5% padding (uniform scale)
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (var j = 0; j < pts.length; j++) {
      if (pts[j].x < minX) minX = pts[j].x;
      if (pts[j].x > maxX) maxX = pts[j].x;
      if (pts[j].y < minY) minY = pts[j].y;
      if (pts[j].y > maxY) maxY = pts[j].y;
    }
    var rangeX = maxX - minX || 1, rangeY = maxY - minY || 1;
    var scale = 90.0 / Math.max(rangeX, rangeY);
    var offX = (100.0 - rangeX * scale) / 2.0;
    var offY = (100.0 - rangeY * scale) / 2.0;
    for (var k = 0; k < pts.length; k++) {
      pts[k].x = (pts[k].x - minX) * scale + offX;
      pts[k].y = (pts[k].y - minY) * scale + offY;
    }

    // Catmull-Rom → cubic Bézier spline
    var f = function(n) { return n.toFixed(2); };
    var path = 'M ' + f(pts[0].x) + ',' + f(pts[0].y);
    var len = pts.length;
    for (var m = 0; m < len; m++) {
      var p0 = pts[(m - 1 + len) % len];
      var p1 = pts[m];
      var p2 = pts[(m + 1) % len];
      var p3 = pts[(m + 2) % len];
      var cx1 = p1.x + (p2.x - p0.x) / 6.0;
      var cy1 = p1.y + (p2.y - p0.y) / 6.0;
      var cx2 = p2.x - (p3.x - p1.x) / 6.0;
      var cy2 = p2.y - (p3.y - p1.y) / 6.0;
      path += ' C ' + f(cx1) + ',' + f(cy1) + ' ' + f(cx2) + ',' + f(cy2) + ' ' + f(p2.x) + ',' + f(p2.y);
    }
    return { path: path + ' Z', points: pts };
  }

  // Walk normalized API points to interpolate (x,y) at the given lap-distance
  // fraction (0..1). Used by drive-hud.js so the player dot lands on the API
  // path even when the plugin's local CSV is stale/corrupt. Returns null if
  // the points array is too small to interpolate from.
  window._lapDistToApiXY = function(points, lapDistPct) {
    if (!points || points.length < 2) return null;
    var pct = ((+lapDistPct) % 1 + 1) % 1;     // wrap into [0,1)
    // Points are stored in lap-order with increasing `p`. Find the segment
    // straddling `pct` via linear scan — point counts are <500, no need for
    // binary search at this scale.
    for (var i = 0; i < points.length - 1; i++) {
      var a = points[i], b = points[i + 1];
      if (pct >= a.p && pct <= b.p) {
        var span = b.p - a.p;
        var t = span > 0 ? (pct - a.p) / span : 0;
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      }
    }
    // Wrap segment (last point → first point)
    var last = points[points.length - 1], first = points[0];
    var wrapSpan = (1 - last.p) + first.p;
    if (wrapSpan > 0) {
      var rel = pct >= last.p ? (pct - last.p) : (1 - last.p + pct);
      var t2 = rel / wrapSpan;
      return { x: last.x + (first.x - last.x) * t2, y: last.y + (first.y - last.y) * t2 };
    }
    return { x: first.x, y: first.y };
  };

  // Reproject opponent dots from the plugin's coordinate space into the API
  // path's space. The plugin reports each car as an (x,y) normalized against
  // its LOCAL recording; when we render the curated API outline instead (see
  // the mapPath selection in the render loop), those raw coords land cars off
  // the drawn track — the "driving around in the wilderness" symptom. We
  // recover each car's lap fraction by snapping it to the plugin path (which
  // shares the cars' local normalization), then map that fraction onto the API
  // points — exactly how the player dot is remapped via _lapDistToApiXY. Cars
  // therefore land on the same outline the player does.
  //
  //   oppStr     "x,y,pit;x,y,pit;..." in plugin space
  //   pluginPath the plugin's own SVG path (same space as oppStr)
  //   apiPts     API points [{x,y,p}] — the rendered outline's space
  //
  // Returns a reprojected "x,y,pit;..." string, or the input unchanged when
  // reprojection isn't possible (missing data / unparseable plugin path).
  var _reprojOppCache = { path: '', pts: null };
  window._reprojectOpponentsToApi = function(oppStr, pluginPath, apiPts) {
    if (!oppStr || !pluginPath || !apiPts || apiPts.length < 2) return oppStr;
    // Parse + cache the plugin endpoints across frames — re-parse on track change only.
    if (_reprojOppCache.path !== pluginPath) {
      _reprojOppCache.path = pluginPath;
      _reprojOppCache.pts = _pointsFromSvgPath(pluginPath);
    }
    var pp = _reprojOppCache.pts;
    if (!pp || pp.length < 10) return oppStr;
    var segs = oppStr.split(';');
    var out = '';
    for (var i = 0; i < segs.length; i++) {
      if (!segs[i]) continue;
      var f = segs[i].split(',');
      if (f.length < 2) continue;
      var ox = +f[0], oy = +f[1];
      if (!isFinite(ox) || !isFinite(oy)) continue;
      // Nearest plugin-path endpoint → its lap fraction.
      var bd = Infinity, bp = 0;
      for (var j = 0; j < pp.length; j++) {
        var dx = ox - pp[j].x, dy = oy - pp[j].y;
        var d = dx * dx + dy * dy;
        if (d < bd) { bd = d; bp = pp[j].p; }
      }
      var pos = window._lapDistToApiXY(apiPts, bp);
      var nx = pos ? pos.x : ox, ny = pos ? pos.y : oy;
      out += (out ? ';' : '') + nx.toFixed(2) + ',' + ny.toFixed(2) + ',' + (f[2] || '0');
    }
    return out;
  };

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

  function resolveTrackDisplayName(gameTrackName, trackSlug) {
    if (_trackDisplayNameCache[gameTrackName] || _trackDisplayNamePending[gameTrackName]) return;
    _trackDisplayNamePending[gameTrackName] = true;
    // Pass the raw SimHub TrackId as a config hint so the API can disambiguate
    // multi-config venues (e.g. Nürburgring Nordschleife → GP vs Combined).
    var url = K10_DISPLAY_NAME_API + '?trackName=' + encodeURIComponent(gameTrackName);
    if (trackSlug && trackSlug !== gameTrackName) {
      url += '&config=' + encodeURIComponent(trackSlug);
    }
    fetch(url)
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        // displayName from API already falls back to trackName server-side
        _trackDisplayNameCache[gameTrackName] = (data && data.displayName) || gameTrackName;
        // Cache sector count from API (0 if not present — don't assume 3)
        _trackSectorCountCache[gameTrackName] = (data && data.sectorCount) || 0;
        // Three sources of track-map data, in preference order:
        //   1. data.svgPath + data.points — server has pre-computed
        //      both from rawCsv. Path and points share a coord space
        //      by construction; player dot lands on the path. Drop-in,
        //      no client-side parsing.
        //   2. data.rawCsv — legacy CSV path; build path + points
        //      locally. Same algorithm the server now runs, kept for
        //      back-compat with API responses cached before the
        //      points field shipped.
        //   3. data.svgPath alone — legacy DB row with no rawCsv.
        //      Derive approximate points from the path itself
        //      (uniform-spacing assumption) so the dot still tracks.
        if (data && data.svgPath && Array.isArray(data.points) && data.points.length >= 2) {
          _trackApiSvgCache[gameTrackName] = data.svgPath;
          _trackApiPointsCache[gameTrackName] = data.points;
          console.log('[K10] Track map: server-provided path + points for', gameTrackName,
            '(' + data.svgPath.length + ' chars,', data.points.length, 'points)');
        } else if (data && data.rawCsv) {
          try {
            var built = _csvToTrackData(data.rawCsv);
            if (built && built.path) {
              _trackApiSvgCache[gameTrackName] = built.path;
              _trackApiPointsCache[gameTrackName] = built.points;
              console.log('[K10] Track map: built from rawCsv for', gameTrackName,
                '(' + built.path.length + ' chars,', built.points.length, 'points)');
            }
          } catch (e) {
            console.warn('[K10] Failed to convert API rawCsv to SVG for', gameTrackName, e);
          }
        } else if (data && data.svgPath) {
          // svgPath without rawCsv or points — derive approximate
          // points from the path. Avoids the spinning-map symptom
          // that came from rendering API path + plugin PlayerX/Y in
          // different normalizations.
          _trackApiSvgCache[gameTrackName] = data.svgPath;
          var derived = _pointsFromSvgPath(data.svgPath);
          if (derived.length >= 2) {
            _trackApiPointsCache[gameTrackName] = derived;
            console.log('[K10] Track map: svgPath only for', gameTrackName,
              '(' + data.svgPath.length + ' chars) —',
              derived.length, 'points derived from path');
          } else {
            console.log('[K10] Track map: svgPath only for', gameTrackName,
              '(' + data.svgPath.length + ' chars) — could not derive points; player dot will use plugin coords');
          }
        }
      })
      .catch(function() {
        // API unreachable — use the game name, no assumed sectors
        _trackDisplayNameCache[gameTrackName] = gameTrackName;
        _trackSectorCountCache[gameTrackName] = 0;
      })
      .finally(function() {
        delete _trackDisplayNamePending[gameTrackName];
      });
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
    } catch (err) {
      console.error('[K10 poll] Fetch error:', err);
    } finally {
      _pollActive = false;
    }
  }

  // ─── Poll-rate control + active/dormant switch ───
  // The overlay is "active" only while there is live car data on screen.
  // When dormant we slow the SimHub poll and pause the FX + ambient loops so
  // the renderer stops competing with the sim for CPU/GPU/network. This is
  // required, not just nice-to-have: the anti-throttling switches in main.js
  // keep timers + rAF running at full speed even when the window is hidden,
  // so the renderer has to self-regulate. Driven by the debounced in-car
  // edges (not the immediate _isIdle) so brief session-state dips don't flap.
  function setPollRate(ms) {
    if (_pollIntervalId) clearInterval(_pollIntervalId);
    _pollIntervalId = setInterval(pollUpdate, ms);
  }

  function setOverlayActive(active) {
    setPollRate(active ? POLL_MS : IDLE_POLL_MS);
    if (typeof window.setGLFXActive === 'function') window.setGLFXActive(active);
    var ambMode = (_settings && _settings.ambientMode) || 'auto';
    if (active && ambMode !== 'off') {
      if (typeof window.startAmbientLight === 'function') window.startAmbientLight();
    } else {
      if (typeof window.stopAmbientLight === 'function') window.stopAmbientLight();
    }
  }

  // ─── rAF render loop — DOM writes synchronized to display refresh rate ───
  function _rafLoop() {
    requestAnimationFrame(_rafLoop);
    if (!_snapshotDirty || !_latestSnapshot) return;
    _snapshotDirty = false;
    _renderFrame(_latestSnapshot);
  }
  requestAnimationFrame(_rafLoop);

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
      console.log(`[K10 poll #${_pollFrame}] Got ${Object.keys(p).length} keys, ${keys.length} non-empty. DemoMode=${p['RaceCorProDrive.Plugin.DemoMode']}, GameRunning=${p['DataCorePlugin.GameRunning']}`);
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
    const _demo = +v('RaceCorProDrive.Plugin.DemoMode') || 0;
    const d = (gameKey, demoKey) => _demo ? v('RaceCorProDrive.Plugin.' + demoKey) : v(gameKey);
    const ds = (gameKey, demoKey) => _demo ? vs('RaceCorProDrive.Plugin.' + demoKey) : vs(gameKey);

    // ─── In-car detection ───
    // Always use REAL game state here (never demo-swapped), so the overlay
    // stays dormant/hidden when no game is actually running even if the
    // SimHub plugin has demo mode enabled.
    const gameRunning = +v('DataCorePlugin.GameRunning') || 0;
    const realSessNum = parseInt(vs('RaceCorProDrive.Plugin.Grid.SessionState')) || 0;
    const sessionPre = _demo ? 'RaceCorProDrive.Plugin.Demo.Grid.' : 'RaceCorProDrive.Plugin.Grid.';
    const dsPre = _demo ? 'RaceCorProDrive.Plugin.Demo.DS.' : 'RaceCorProDrive.Plugin.DS.';
    const sessNum = parseInt(vs(sessionPre + 'SessionState')) || 0;
    const _inPitLane = +(p[dsPre + 'IsInPitLane']) > 0;

    // Session mode from plugin (single source of truth)
    // 0=Unknown, 1=Practice, 2=Qualifying, 3=Warmup, 4=Race
    const sessionMode = +(p[dsPre + 'SessionMode']) || 0;

    // ─── Session change detection — reset per-session state ───
    const _currSessionTypeName = _demo
      ? vs('RaceCorProDrive.Plugin.Demo.SessionTypeName')
      : vs('RaceCorProDrive.Plugin.SessionTypeName');
    if (_currSessionTypeName && _currSessionTypeName !== _prevSessionTypeName && _prevSessionTypeName) {
      console.log('[K10] Session changed:', _prevSessionTypeName, '→', _currSessionTypeName);
      // Capture practice/quali/warmup session end before resetting
      if (typeof window.capturePracticeSessionEnd === 'function') {
        window.capturePracticeSessionEnd(p, _demo);
      }
      if (typeof resetTimeline === 'function') resetTimeline();
      if (typeof resetRaceResults === 'function') resetRaceResults();
      // Capture session start snapshot for sync
      if (typeof window.captureSessionStart === 'function') {
        window.captureSessionStart(p, _demo);
      }
      window._sessionStartCaptured = true;
    }
    if (_currSessionTypeName) _prevSessionTypeName = _currSessionTypeName;

    // First-frame capture: if we haven't captured a start snapshot yet and have session data
    if (typeof window.captureSessionStart === 'function' && !window._sessionStartCaptured && _currSessionTypeName) {
      window.captureSessionStart(p, _demo);
      window._sessionStartCaptured = true;
    }

    // Detect game and apply feature gating
    const rawGameId = v('RaceCorProDrive.Plugin.GameId') || '';
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

    // Expose rolling/formation start state for leaderboard sparklines
    window._isRollingStart = (sessNum === 2 || sessNum === 3); // Warmup or ParadeLaps

    // In-car detection: idle when no game is running OR no active session,
    // and not in demo mode (demo always shows the full HUD for preview).
    // SessionState 0 = menus/results; 1=GetInCar, 2=Warmup, 3=ParadeLaps,
    // 4=Racing all mean you're in the car. _isIdle gates the heavy render
    // below; body.idle-state is kept as a state flag other modules read
    // (e.g. replay-buffer). There is no idle logo — when not in a car the
    // window is hidden entirely (see the in-car visibility signal below).
    const nowIdle = !_demo && (!gameRunning || realSessNum === 0);
    if (nowIdle !== _isIdle) {
      _isIdle = nowIdle;
      document.body.classList.toggle('idle-state', nowIdle);
    }

    // In-car visibility signal — drives the overlay window's show/hide (main
    // process) and the renderer's active/dormant workload. Demo mode is ALSO
    // in-car so the overlay shows during preview. Short debounce on "leave"
    // only — session-state briefly hits 0 between sessions and we don't want
    // the window to flicker out and back. Entering a car is immediate.
    const nowInRace = !!_demo || (gameRunning && realSessNum > 0);
    if (nowInRace !== _prevInRace) {
      if (nowInRace) {
        // Enter car: immediate, cancel any pending leave.
        if (_inRaceLeaveTimer) { clearTimeout(_inRaceLeaveTimer); _inRaceLeaveTimer = null; }
        _prevInRace = true;
        setOverlayActive(true);
        if (window.k10 && window.k10.notifyInRaceState) {
          window.k10.notifyInRaceState(true);
        }
      } else {
        // Leave car: debounce 2s to ride through session transitions before
        // going dormant + hiding the window.
        if (_inRaceLeaveTimer) clearTimeout(_inRaceLeaveTimer);
        _inRaceLeaveTimer = setTimeout(function() {
          _inRaceLeaveTimer = null;
          _prevInRace = false;
          setOverlayActive(false);
          if (window.k10 && window.k10.notifyInRaceState) {
            window.k10.notifyInRaceState(false);
          }
        }, 2000);
      }
    } else if (nowInRace && _inRaceLeaveTimer) {
      // Flapped back to in-car during the debounce window — cancel the leave.
      clearTimeout(_inRaceLeaveTimer);
      _inRaceLeaveTimer = null;
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

    const fuelPerLapRaw = _demo ? (+v('RaceCorProDrive.Plugin.Demo.FuelPerLap') || 0) : (+v('DataCorePlugin.Computed.Fuel_LitersPerLap') || 0);
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
    // Backend sends wear as 0=new, 1=gone. Convert to remaining % for display
    // (100 = full life, 0 = destroyed) so bar width + color thresholds are correct.
    if (_demo) {
      updateTyreCell(0, +v('RaceCorProDrive.Plugin.Demo.TyreTempFL'), (1 - (+v('RaceCorProDrive.Plugin.Demo.TyreWearFL') || 0)) * 100);
      updateTyreCell(1, +v('RaceCorProDrive.Plugin.Demo.TyreTempFR'), (1 - (+v('RaceCorProDrive.Plugin.Demo.TyreWearFR') || 0)) * 100);
      updateTyreCell(2, +v('RaceCorProDrive.Plugin.Demo.TyreTempRL'), (1 - (+v('RaceCorProDrive.Plugin.Demo.TyreWearRL') || 0)) * 100);
      updateTyreCell(3, +v('RaceCorProDrive.Plugin.Demo.TyreTempRR'), (1 - (+v('RaceCorProDrive.Plugin.Demo.TyreWearRR') || 0)) * 100);
    } else {
      updateTyreCell(0, +v('DataCorePlugin.GameData.TyreTempFrontLeft'), (p['DataCorePlugin.GameData.TyreWearFrontLeft'] != null ? (1 - +p['DataCorePlugin.GameData.TyreWearFrontLeft']) * 100 : -1));
      updateTyreCell(1, +v('DataCorePlugin.GameData.TyreTempFrontRight'), (p['DataCorePlugin.GameData.TyreWearFrontRight'] != null ? (1 - +p['DataCorePlugin.GameData.TyreWearFrontRight']) * 100 : -1));
      updateTyreCell(2, +v('DataCorePlugin.GameData.TyreTempRearLeft'), (p['DataCorePlugin.GameData.TyreWearRearLeft'] != null ? (1 - +p['DataCorePlugin.GameData.TyreWearRearLeft']) * 100 : -1));
      updateTyreCell(3, +v('DataCorePlugin.GameData.TyreTempRearRight'), (p['DataCorePlugin.GameData.TyreWearRearRight'] != null ? (1 - +p['DataCorePlugin.GameData.TyreWearRearRight']) * 100 : -1));
    }

    // ─── Controls (BB / TC / ABS) ───
    const bb = _demo ? +v('RaceCorProDrive.Plugin.Demo.BrakeBias') : (+v('DataCorePlugin.GameRawData.Telemetry.dcBrakeBias') || 0);
    const tc = _demo ? +v('RaceCorProDrive.Plugin.Demo.TC') : p['DataCorePlugin.GameRawData.Telemetry.dcTractionControl'];
    const abs = _demo ? +v('RaceCorProDrive.Plugin.Demo.ABS') : p['DataCorePlugin.GameRawData.Telemetry.dcABS'];
    const absActive = +v(dsPre + 'AbsActive') || 0;
    const tcActive  = +v(dsPre + 'TcActive')  || 0;
    const carModel = ds('DataCorePlugin.GameData.CarModel', 'Demo.CarModel');
    if (carModel !== _lastCarModel) {
      _tcSeen = false; _absSeen = false;
      _lastCarModel = carModel;
      _carAdj = getCarAdjustability(carModel);
      setCarLogo(detectMfr(carModel), carModel);
      // Track car usage for driver profile heatmap
      if (carModel && !_demo && typeof recordCarSession === 'function') recordCarSession(carModel);
    }

    // Expose latest car + track + game on window so the recorder/sidecar
    // can stamp recording metadata at start time without polling p[].
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
    // TC / ABS active flash — runs on main dashboard, not gated behind datastream visibility
    const tcBoxEl = document.getElementById('ctrlTC');
    const absBoxEl = document.getElementById('ctrlABS');
    if (tcActive > 0) _tcFlashFrames = 8;
    if (absActive > 0) _absFlashFrames = 8;
    if (tcBoxEl) { tcBoxEl.classList.toggle('ctrl-active', _tcFlashFrames > 0); if (_tcFlashFrames > 0) _tcFlashFrames--; }
    if (absBoxEl) { absBoxEl.classList.toggle('ctrl-active', _absFlashFrames > 0); if (_absFlashFrames > 0) _absFlashFrames--; }

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
      ? (+(p['RaceCorProDrive.Plugin.Demo.CurrentLapTime']) || 0)
      : (_parseTimeValue(p['DataCorePlugin.GameData.CurrentLapTime'])
         || +(p['DataCorePlugin.GameRawData.Telemetry.LapCurrentLapTime']) || 0);
    document.querySelectorAll('.pos-number').forEach(el => {
      const sp = el.querySelector('.skew-accent');
      if (sp) sp.textContent = pos > 0 ? 'P' + pos : 'P—';
    });
    // Use server-computed LapDelta (cumulative sector delta at current track position)
    const lapDelta = +(p[dsPre + 'LapDelta']) || 0;
    document.querySelectorAll('.pos-meta-row .val').forEach(el => {
      const row = el.closest('.pos-meta-row');
      if (row.classList.contains('delta-row')) {
        // Delta row: show cumulative lap delta vs best lap
        if (curLapTime > 0.5 && bestLap > 0) {
          el.textContent = (lapDelta >= 0 ? '+' : '') + lapDelta.toFixed(3);
          el.classList.remove('delta-faster', 'delta-slower', 'delta-pb');
          if (lapDelta <= -0.5) el.classList.add('delta-pb');
          else if (lapDelta < 0) el.classList.add('delta-faster');
          else if (lapDelta > 0) el.classList.add('delta-slower');
        } else {
          el.textContent = '';
          el.classList.remove('delta-faster', 'delta-slower', 'delta-pb');
        }
      } else if (row.classList.contains('current-row')) {
        // Current lap time (no delta appended — that's in the delta row now)
        if (curLapTime > 0.5) {
          el.textContent = fmtLap(curLapTime);
          el.classList.remove('purple', 'green');
          if (bestLap > 0 && lapDelta < 0) el.classList.add('green');
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

    if (timerEl) {
      if (isPracticeTimer) {
        // Practice: show local wall clock time (12-hour format)
        const now = new Date();
        let hours = now.getHours();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;
        const mins = now.getMinutes();
        timerEl.textContent = hours + ':' + (mins < 10 ? '0' : '') + mins + ' ' + ampm;
      } else if (isLapRace && !isNonRaceTimer) {
        // Lap-limited race: show current lap time instead of useless 168:00:00 countdown
        if (remLaps === 1) timerEl.textContent = 'Final Lap';
        else if (remLaps === 0) timerEl.textContent = 'Finish';
        else if (curLapTime > 0) {
          const lm = Math.floor(curLapTime / 60);
          const ls = curLapTime % 60;
          timerEl.textContent = (lm > 0 ? lm + ':' : '') + (lm > 0 && ls < 10 ? '0' : '') + ls.toFixed(1);
        } else {
          timerEl.textContent = '0.0';
        }
      } else if (isQualiTimer) {
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
      : (_demo ? (+v('RaceCorProDrive.Plugin.Demo.IRating') || 0) : (+v('IRacingExtraProperties.iRacing_DriverInfo_IRating') || 0));
    let sr = window._manualSafetyRating > 0 ? window._manualSafetyRating
      : (_demo ? (+v('RaceCorProDrive.Plugin.Demo.SafetyRating') || 0) : (+v('IRacingExtraProperties.iRacing_DriverInfo_SafetyRating') || 0));
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
      const lapDelta = +(p[dsPre + 'LapDelta']) || 0;

      // Sector count: use cloud-configured value from K10 API only (no fallback)
      const _gameTrack = p['RaceCorProDrive.Plugin.TrackMap.TrackName']
                      || p['DataCorePlugin.GameData.TrackName'] || '';
      if (_gameTrack) resolveTrackDisplayName(_gameTrack); // ensure API call fires
      const sectorCount = (_gameTrack && _trackSectorCountCache[_gameTrack]) || 0;

      // Build sector arrays from plugin data (pad to sectorCount)
      const splits = [], deltas = [], states = [];
      for (let si = 1; si <= sectorCount; si++) {
        splits.push(+(p[dsPre + 'SectorSplitS' + si]) || 0);
        deltas.push(+(p[dsPre + 'SectorDeltaS' + si]) || 0);
        states.push(+(p[dsPre + 'SectorStateS' + si]) || 0);
      }
      // state: 0=none, 1=pb (session best / purple), 2=faster (green), 3=slower (yellow)
      const stateClass = ['', 'sector-pb', 'sector-faster', 'sector-slower'];

      // Store for track map sector coloring + boundaries for path splitting
      window._sectorData = { curSector, splits, deltas, states, sectorCount };
      // Equal-fraction boundaries for track map (N-1 boundaries for N sectors)
      const boundaries = [];
      for (let bi = 1; bi < sectorCount; bi++) boundaries.push(bi / sectorCount);
      window._sectorBoundaries = boundaries;

      // Read current lap time for live sector elapsed
      const currentLapTime = _demo
        ? (+(p['RaceCorProDrive.Plugin.Demo.CurrentLapTime']) || 0)
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
          if (!_lapInvalid && lapDelta !== 0) {
            cell.classList.add(lapDelta < 0 ? 'sector-faster' : 'sector-slower');
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
      const gAhead  = _demo ? (+v('RaceCorProDrive.Plugin.Demo.GapAhead') || 0)  : (+v('IRacingExtraProperties.iRacing_Opponent_Ahead_Gap') || 0);
      const gBehind = _demo ? (+v('RaceCorProDrive.Plugin.Demo.GapBehind') || 0) : (+v('IRacingExtraProperties.iRacing_Opponent_Behind_Gap') || 0);
      const dAhead  = _demo ? vs('RaceCorProDrive.Plugin.Demo.DriverAhead')  : vs('IRacingExtraProperties.iRacing_Opponent_Ahead_Name');
      const dBehind = _demo ? vs('RaceCorProDrive.Plugin.Demo.DriverBehind') : vs('IRacingExtraProperties.iRacing_Opponent_Behind_Name');
      const irA     = _demo ? (+v('RaceCorProDrive.Plugin.Demo.IRAhead') || 0)   : (+v('IRacingExtraProperties.iRacing_Opponent_Ahead_IRating') || 0);
      const irB     = _demo ? (+v('RaceCorProDrive.Plugin.Demo.IRBehind') || 0)  : (+v('IRacingExtraProperties.iRacing_Opponent_Behind_IRating') || 0);
      if (gapTimes.length >= 2) { gapTimes[0].textContent = (gAhead && Math.abs(gAhead) >= 0.05) ? fmtGap(-Math.abs(gAhead)) : '—'; gapTimes[1].textContent = (gBehind && Math.abs(gBehind) >= 0.05) ? fmtGap(Math.abs(gBehind)) : '—'; }
      if (gapDrivers.length >= 2) { gapDrivers[0].textContent = dAhead || '—'; gapDrivers[1].textContent = dBehind || '—'; }
      if (gapIRs.length >= 2) { gapIRs[0].textContent = irA > 0 ? irA + ' iR' : ''; gapIRs[1].textContent = irB > 0 ? irB + ' iR' : ''; }
      if (gapItems.length >= 2) {
        if (dAhead !== _lastDriverAhead && _lastDriverAhead) flashElement(gapItems[0], 'ahead-changed');
        if (dBehind !== _lastDriverBehind && _lastDriverBehind) flashElement(gapItems[1], 'behind-changed');
      }
      _lastDriverAhead = dAhead; _lastDriverBehind = dBehind;
    }

    // ─── Flag Status → Gaps Block ───
    const rawFlag = (_forceFlagState && _demo) ? _forceFlagState : (vs('currentFlagState') || 'none');
    const flagState = (!rawFlag || rawFlag === '0' || rawFlag === 0) ? 'none' : rawFlag;
    const gapsBlock = document.getElementById('gapsBlock');
    if (gapsBlock) {
      const flagLabels = { yellow: 'CAUTION', red: 'RED FLAG', blue: 'BLUE FLAG', white: 'LAST LAP', debris: 'DEBRIS', checkered: 'FINISH', black: 'BLACK FLAG', green: 'GREEN', meatball: 'MEATBALL', orange: 'LAPPED CAR' };
      const flagContexts = { yellow: 'Full course caution — hold position', red: 'Session stopped — return to pits', blue: 'Faster car approaching — yield', white: 'Last lap — push to the line', debris: 'Debris on track — stay alert', checkered: 'Checkered flag — race complete', black: 'Penalty — report to pit lane', green: 'Green flag — racing resumes', meatball: 'Repair required — pit immediately', orange: 'Car ahead must yield — make the pass' };

      // Minimum hold durations per flag type (ms) — prevents flicker from rapid state changes
      const FLAG_HOLD_MS = { yellow: 8000, red: 10000, blue: 4000, white: 6000, debris: 5000, checkered: 10000, black: 8000, green: 5000, meatball: 10000, orange: 4000 };

      let showFlag = flagState;
      const now = Date.now();

      // When a new flag appears, set minimum hold time
      if (flagState !== 'none' && flagState !== _flagHoldState) {
        _flagHoldState = flagState;
        _flagHoldUntil = now + (FLAG_HOLD_MS[flagState] || 5000);
      }

      // Green flag: show briefly when transitioning from caution, then clear
      if (flagState === 'green' && _lastFlagState !== 'green' && _lastFlagState !== 'none') {
        if (_greenFlagTimeout) clearTimeout(_greenFlagTimeout);
        _greenFlagTimeout = setTimeout(() => {
          const gb = document.getElementById('gapsBlock');
          if (gb) gb.className = gb.className.replace(/\bflag-\S+/g, '').trim() + ' panel gaps-block';
          if (window.setFlagGLColors) window.setFlagGLColors(null);
          _greenFlagTimeout = null;
          _flagHoldState = 'none';
        }, FLAG_HOLD_MS.green);
      } else if (flagState === 'green' && !_greenFlagTimeout) {
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
      // Race Control only fires for session-altering events: red, black, yellow (full course), checkered.
      const RC_FLAGS = { red: true, black: true, yellow: true, checkered: true, meatball: true };
      if (flagState !== _lastFlagState) {
        if (RC_FLAGS[flagState]) {
          showRaceControl(flagState);
        }
        // Only hide RC banner when flag hold has also expired — don't yank it early
        else if ((flagState === 'none' || !RC_FLAGS[flagState]) && now >= _flagHoldUntil) {
          hideRaceControl();
        }
      }

      // ── Leaderboard event animations for race start / finish ──
      if (flagState !== _lastFlagState && window.triggerLBEvent) {
        // Green flag transition from non-green = race start (or restart)
        if (flagState === 'green' && _lastFlagState !== 'green' && _lastFlagState !== 'none') {
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
      const ambHas = +v('RaceCorProDrive.Plugin.DS.AmbientHasData') || 0;
      if (ambHas && typeof window.updateAmbientFromPoll === 'function') {
        const ambR = +v('RaceCorProDrive.Plugin.DS.AmbientR') || 0;
        const ambG = +v('RaceCorProDrive.Plugin.DS.AmbientG') || 0;
        const ambB = +v('RaceCorProDrive.Plugin.DS.AmbientB') || 0;
        window.updateAmbientFromPoll(ambR, ambG, ambB);
      }
    }

    // ─── Commentary ───
    const cmVis = +v('RaceCorProDrive.Plugin.CommentaryVisible') || 0;
    if (cmVis && !_commentaryWasVisible) {
      const cmTopicId = vs('RaceCorProDrive.Plugin.CommentaryTopicId');
      // In pit lane: only allow pit-related commentary through
      const pitAllowedTopics = ['pit_entry', 'low_fuel', 'tyre_wear_high'];
      const suppressInPit = _inPitLane && !pitAllowedTopics.includes(cmTopicId);
      if (!suppressInPit) {
        const hue = colorToHue(vs('RaceCorProDrive.Plugin.CommentarySentimentColor'));
        const severity = +v('RaceCorProDrive.Plugin.CommentarySeverity') || 0;
        const trackImg = vs('RaceCorProDrive.Plugin.CommentaryTrackImage') || '';
        const carImg = vs('RaceCorProDrive.Plugin.CommentaryCarImage') || '';
        const commentaryImg = trackImg || carImg;  // track image takes priority, car image as fallback
        showCommentary(hue, vs('RaceCorProDrive.Plugin.CommentaryTopicTitle'), vs('RaceCorProDrive.Plugin.CommentaryText'), vs('RaceCorProDrive.Plugin.CommentaryCategory'), cmTopicId, severity, commentaryImg);
      }
    } else if (!cmVis && _commentaryWasVisible) {
      hideCommentary();
    }
    _commentaryWasVisible = !!cmVis;

    // ─── Strategy calls (displayed via commentary panel with amber hue) ───
    var stVis = +v('RaceCorProDrive.Plugin.Strategy.Visible') || 0;
    if (stVis && !_strategyWasVisible && !cmVis) {
      // Show strategy call through the commentary panel with amber hue (45)
      var stLabel = vs('RaceCorProDrive.Plugin.Strategy.Label') || 'STRATEGY';
      var stText  = vs('RaceCorProDrive.Plugin.Strategy.Text') || '';
      var stSev   = +v('RaceCorProDrive.Plugin.Strategy.Severity') || 1;
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
        gapAhead: _demo ? +(v('RaceCorProDrive.Plugin.Demo.GapAhead') || 0) : +(v('IRacingExtraProperties.iRacing_Opponent_Ahead_Gap') || 0),
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
          ? [+v('RaceCorProDrive.Plugin.Demo.TyreTempFL'), +v('RaceCorProDrive.Plugin.Demo.TyreTempFR'), +v('RaceCorProDrive.Plugin.Demo.TyreTempRL'), +v('RaceCorProDrive.Plugin.Demo.TyreTempRR')]
          : [+v('DataCorePlugin.GameData.TyreTempFrontLeft'), +v('DataCorePlugin.GameData.TyreTempFrontRight'), +v('DataCorePlugin.GameData.TyreTempRearLeft'), +v('DataCorePlugin.GameData.TyreTempRearRight')],
        tyreWears: _demo
          ? [(1 - (+v('RaceCorProDrive.Plugin.Demo.TyreWearFL') || 0)) * 100, (1 - (+v('RaceCorProDrive.Plugin.Demo.TyreWearFR') || 0)) * 100, (1 - (+v('RaceCorProDrive.Plugin.Demo.TyreWearRL') || 0)) * 100, (1 - (+v('RaceCorProDrive.Plugin.Demo.TyreWearRR') || 0)) * 100]
          : [(p['DataCorePlugin.GameData.TyreWearFrontLeft'] != null ? (1 - +p['DataCorePlugin.GameData.TyreWearFrontLeft']) * 100 : 100), (p['DataCorePlugin.GameData.TyreWearFrontRight'] != null ? (1 - +p['DataCorePlugin.GameData.TyreWearFrontRight']) * 100 : 100), (p['DataCorePlugin.GameData.TyreWearRearLeft'] != null ? (1 - +p['DataCorePlugin.GameData.TyreWearRearLeft']) * 100 : 100), (p['DataCorePlugin.GameData.TyreWearRearRight'] != null ? (1 - +p['DataCorePlugin.GameData.TyreWearRearRight']) * 100 : 100)]
      });
    }

    // ─── Driver display name (for leaderboard) ───
    const dfn = vs('RaceCorProDrive.Plugin.DriverFirstName') || '';
    const dln = vs('RaceCorProDrive.Plugin.DriverLastName') || '';
    if (dfn || dln) {
      _driverDisplayName = (dfn && dln) ? dfn + ' ' + dln : (dfn || dln);
    }
    // Zoom map label: first initial + last name, fallback "Local"
    const _zoomLbl = document.getElementById('zoomMapLabel');
    if (_zoomLbl) {
      _zoomLbl.textContent = (dfn && dln) ? dfn + ' ' + dln : (dln || 'Local');
    }

    // ─── Track map ───
    const mapReady = +v('RaceCorProDrive.Plugin.TrackMap.Ready') || 0;
    const pluginPath = mapReady ? (vs('RaceCorProDrive.Plugin.TrackMap.SvgPath') || '') : '';
    let mapOpp  = vs('RaceCorProDrive.Plugin.TrackMap.Opponents') || '';
    const mapHeading = +v('RaceCorProDrive.Plugin.TrackMap.PlayerHeading') || 0;
    // Prefer web API track maps when available — they're curated and
    // override stale/corrupt SimHub .shtl recordings (e.g. Nordschleife
    // teleport lines). When the API hasn't produced an override yet
    // (request in flight, no entry for this track, offline) fall back
    // to the plugin-provided SvgPath so the overlay still draws a track.
    const _curTrackName = vs('RaceCorProDrive.Plugin.TrackMap.TrackName')
                       || vs('DataCorePlugin.GameData.TrackName') || '';
    const _curTrackSlug = vs('RaceCorProDrive.Plugin.TrackMap.TrackSlug') || '';
    const _apiMapPath = _trackApiSvgCache[_curTrackName];
    const mapPath = _apiMapPath || pluginPath || '';
    // Player coords: when the API path is in use, derive (x,y) from the
    // API's own points by lap-distance fraction so the dot tracks the
    // curated path. Plugin PlayerX/Y is normalized against its local
    // recording and won't align with the API's coordinate space.
    let mapPX, mapPY;
    const _apiPts = _apiMapPath ? _trackApiPointsCache[_curTrackName] : null;
    if (_apiPts && _apiPts.length >= 2 && typeof window._lapDistToApiXY === 'function') {
      const _pct = +v('RaceCorProDrive.Plugin.DS.TrackPct');
      const pos = window._lapDistToApiXY(_apiPts, isFinite(_pct) ? _pct : 0);
      if (pos) { mapPX = pos.x; mapPY = pos.y; }
    }
    if (mapPX === undefined) {
      mapPX = +v('RaceCorProDrive.Plugin.TrackMap.PlayerX') || 50;
      mapPY = +v('RaceCorProDrive.Plugin.TrackMap.PlayerY') || 50;
    }
    // Opponents come from the plugin in its local normalization. When the API
    // outline is what we draw, reproject them into its space (same lap-distance
    // remap the player gets above) so they sit on the track, not beside it.
    if (_apiMapPath && _apiPts && _apiPts.length >= 2) {
      mapOpp = window._reprojectOpponentsToApi(mapOpp, pluginPath, _apiPts);
    }
    try { updateTrackMap(mapPath, mapPX, mapPY, mapOpp, speed, mapHeading); } catch(e) { console.error('[K10] Track map error:', e); }
    // Full map label: show display name (from K10 API) or fall back to game name
    const fullMapLbl = document.getElementById('fullMapLabel');
    if (fullMapLbl) {
      const trackName = vs('RaceCorProDrive.Plugin.TrackMap.TrackName')
                     || vs('DataCorePlugin.GameData.TrackName')
                     || '';
      if (trackName) {
        const resolved = _trackDisplayNameCache[trackName];
        if (resolved) {
          _setFullMapLabel(fullMapLbl, resolved);
        } else {
          // Show game name immediately, then upgrade if K10 returns a display name
          _setFullMapLabel(fullMapLbl, trackName);
          resolveTrackDisplayName(trackName, _curTrackSlug);
        }
      }
    }

    // ─── Datastream ───
    try { updateDatastream(p, _demo); } catch(e) { console.error('[K10] Datastream error:', e); }

    // ─── Pit Box ───
    try { updatePitBox(p); } catch(e) { console.error('[K10] PitBox error:', e); }

    // ─── Incidents ───
    try { updateIncidents(p, _demo); } catch(e) { console.error('[K10] Incidents error:', e); }

    // ─── Leaderboard ───
    try { updateLeaderboard(p); } catch(e) { console.error('[K10] Leaderboard error:', e); }

    // ─── Pit Limiter ───
    try { updatePitLimiter(p, _demo); } catch(e) { console.error('[K10] Pit limiter error:', e); }

    // ─── Race End Screen ───
    try {
      const isCheckered = flagState === 'checkered';
      if (isCheckered && !_prevCheckered) {
        showRaceEnd(p, _demo);
        // Show post-race results after race-end screen auto-dismisses (31s)
        if (typeof showRaceResults === 'function') {
          setTimeout(function() {
            try { showRaceResults(p, _demo); } catch(e) { console.warn('[K10] Race results error:', e); }
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
    } catch(e) { console.error('[K10] Race end error:', e); }

    // ─── Grid / Formation ───
    try { updateGrid(p, _demo); } catch(e) { console.error('[K10] Grid error:', e); }

    // ─── Spotter (disabled in pit lane — no close racing alerts) ───
    try { if (!_inPitLane) updateSpotter(p, _demo); } catch(e) { console.error('[K10] Spotter error:', e); }

    // ─── Incident Coach (threat tracking, composure, cool-down, voice) ───
    try { if (typeof updateIncidentCoach === 'function') updateIncidentCoach(p); } catch(e) { console.error('[K10] IncidentCoach error:', e); }

    // ─── Tire / Track Condition Mismatch ───
    try { if (typeof checkTyreMismatch === 'function' && !_inPitLane) checkTyreMismatch(p, _demo); } catch(e) { console.error('[K10] Tire mismatch check error:', e); }

    // ─── Race Timeline ───
    try {
      const rtIncidents = +(v('RaceCorProDrive.Plugin.DS.IncidentCount')) || 0;
      const rtInPit = +(v('RaceCorProDrive.Plugin.DS.IsInPitLane')) > 0;
      updateRaceTimeline(pos, lap, flagState, rtIncidents, rtInPit);
    } catch(e) { console.error('[K10] Timeline error:', e); }

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

    // ─── Drive HUD ───
    try { if (window.updateDriveHud) window.updateDriveHud(p, !!_demo); } catch(e) { console.error('[K10] Drive HUD error:', e); }

    // ─── Telemetry sidecar (write frame when recording) ───
    try {
      if (typeof window.sidecarCaptureFrame === 'function' && typeof window.recorderIsRecording === 'function' && window.recorderIsRecording()) {
        window.sidecarCaptureFrame(p, !!_demo);
      }
    } catch(e) { console.error('[K10] Sidecar error:', e); }

    // ─── Auto-record triggers (Phase 4) ───
    try {
      if (typeof window.checkAutoRecordTriggers === 'function') {
        window.checkAutoRecordTriggers(p, !!_demo, _inPitLane, sessNum, serverEndOfRace);
      }
    } catch(e) { console.error('[K10] Auto-record error:', e); }

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
    console.log('[K10 Motorsports] Assets loaded, polling SimHub HTTP API at ' + SIMHUB_URL);

    // Initialize logo cycling (before we connect, the logos will cycle to be visible)
    _logoCycleTimer = setInterval(() => {
      if (!_hasEverConnected) cycleCarLogo();
    }, 3000);
    setCarLogo(carLogoOrder[0], _demoModels[carLogoOrder[0]]);

    // Settings and Discord state are loaded by connections.js on script load

    // Start polling. Do one immediate read so launch gets data without
    // waiting a full interval, then settle into the dormant (slow) rate.
    // The first poll that detects live car data flips us to the fast rate
    // and reveals the window via setOverlayActive(true) in the in-car block.
    pollUpdate();
    setPollRate(IDLE_POLL_MS);
    window.addEventListener('beforeunload', function() {
      if (_pollIntervalId) clearInterval(_pollIntervalId);
    });
  });

  // ═══════════════════════════════════════════════════════════════
