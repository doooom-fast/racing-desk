// ═══════════════════════════════════════════════════════════════
//  CALC CLIENT — wraps web-api /api/v1/calc/* endpoints
//  Spec: prodrive-server/docs/native-app-integration.md
//
//  Replaces every locally-implemented calc engine in the overlay.
//  Each function takes the same inputs the corresponding TS calc
//  used to take and returns a Promise<Response>.
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // Base URL is overridable for dev/staging via window.K10_WEB_API_URL
  // (set early in main.js / preload.js if you want to point at localhost).
  function _baseUrl() {
    if (typeof window !== 'undefined' && window.K10_WEB_API_URL) {
      return String(window.K10_WEB_API_URL).replace(/\/+$/, '');
    }
    return 'https://api.prodrive.racecor.io';
  }

  // Bearer is optional today (web-api is open). When Phase 9b lands we
  // just start populating window._k10Token everywhere this is called.
  function _headers() {
    var h = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (typeof window !== 'undefined' && window._k10Token) {
      h['Authorization'] = 'Bearer ' + window._k10Token;
    }
    return h;
  }

  async function _post(path, body) {
    var url = _baseUrl() + path;
    var resp;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: _headers(),
        body: JSON.stringify(body || {})
      });
    } catch (e) {
      var netErr = new Error('calc-client network error: ' + (e && e.message ? e.message : e));
      netErr.cause = e;
      netErr.path = path;
      throw netErr;
    }

    if (!resp.ok) {
      var text = '';
      try { text = await resp.text(); } catch (_) {}
      var httpErr = new Error('calc-client ' + path + ' ' + resp.status + ': ' + text.slice(0, 500));
      httpErr.status = resp.status;
      httpErr.path = path;
      throw httpErr;
    }

    return resp.json();
  }

  // ─────────────────────────────────────────────────────────────
  // 1. Driver DNA
  // ─────────────────────────────────────────────────────────────
  function fetchDriverDna(sessions, ratings) {
    return _post('/api/v1/calc/dna', { sessions: sessions || [], ratings: ratings || [] });
  }

  // ─────────────────────────────────────────────────────────────
  // 2. Mastery (tracks + cars)
  // ─────────────────────────────────────────────────────────────
  function fetchMastery(sessions) {
    return _post('/api/v1/calc/mastery', { sessions: sessions || [] });
  }

  // ─────────────────────────────────────────────────────────────
  // 3. Notable moments
  // ─────────────────────────────────────────────────────────────
  function fetchMoments(sessions, ratings) {
    return _post('/api/v1/calc/moments', { sessions: sessions || [], ratings: ratings || [] });
  }

  // ─────────────────────────────────────────────────────────────
  // 4. Scatter buckets (race-time-of-week heatmap)
  // ─────────────────────────────────────────────────────────────
  function fetchScatter(sessions, timeZone) {
    var body = { sessions: sessions || [] };
    if (timeZone) body.timeZone = timeZone;
    return _post('/api/v1/calc/scatter', body);
  }

  // ─────────────────────────────────────────────────────────────
  // 5. When-engine (peak hours / day-of-week)
  // ─────────────────────────────────────────────────────────────
  function fetchWhen(sessions, ratings, timeZone) {
    var body = { sessions: sessions || [], ratings: ratings || [] };
    if (timeZone) body.timeZone = timeZone;
    return _post('/api/v1/calc/when', body);
  }

  // ─────────────────────────────────────────────────────────────
  // 6. Race-Now verdict — "should I race right now?"
  //    Recommended cadence: once on app start, then once every
  //    5–10 minutes (or on hour rollover). Verdict only changes
  //    on hour boundaries.
  // ─────────────────────────────────────────────────────────────
  function fetchRaceNow(profile, opts) {
    opts = opts || {};
    var body = { profile: profile || null };
    if (opts.now) body.now = opts.now;
    if (opts.timeZone) body.timeZone = opts.timeZone;
    if (opts.sessions) body.sessions = opts.sessions;
    return _post('/api/v1/calc/race-now', body);
  }

  // ─────────────────────────────────────────────────────────────
  // 7. Race summary (post-race debrief)
  // ─────────────────────────────────────────────────────────────
  function fetchRaceSummary(payload) {
    // payload = { session, laps, behavior, trackHistory, ratingContext }
    return _post('/api/v1/calc/race-summary', payload || {});
  }

  // ─────────────────────────────────────────────────────────────
  // Public surface
  // ─────────────────────────────────────────────────────────────
  // NRI deliberately omitted: next-race scheduling lives in the Windows
  // native app. The overlay is a live-race HUD; pre-race scheduling is
  // a different mental model and a different surface.
  window.k10CalcClient = {
    baseUrl: _baseUrl,
    fetchDriverDna: fetchDriverDna,
    fetchMastery: fetchMastery,
    fetchMoments: fetchMoments,
    fetchScatter: fetchScatter,
    fetchWhen: fetchWhen,
    fetchRaceNow: fetchRaceNow,
    fetchRaceSummary: fetchRaceSummary
  };
})();
