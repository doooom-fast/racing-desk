/**
 * ─────────────────────────────────────────────────────────────
 * Session Sync: Pro Drive data pipeline
 * ─────────────────────────────────────────────────────────────
 * Manages telemetry and user state synchronization with Pro Drive.
 *
 * Hooks (called by poll-engine.js):
 *   captureSessionStart(p, isDemo)  — snapshot pre-race state
 *   captureSessionEnd(p, isDemo)    — collect finish data and POST to /api/sessions
 *   initialRatingSync(p, isDemo)    — one-time baseline rating push
 */

(function() {
  'use strict';

  var API_BASE = 'https://prodrive.racecor.io';

  // ─── Session Sync State ───
  var _initialSyncDone = false;

  // Race session tracking
  var _sessionStartSnapshot = null;   // Captured at session start
  var _sessionSubmitted = false;      // Prevent double-submit per race

  // Sync enabled state is read directly from _settings.iracingDataSync (single source of truth)

  /**
   * Get bearer token from cached window property.
   * @returns {string|null} Bearer token or null if not set.
   */
  function _getToken() {
    return window._k10Token || null;
  }

  /**
   * Helper: extract a value from the poll snapshot.
   */
  function _v(p, key) {
    return p[key] != null ? p[key] : 0;
  }
  function _vs(p, key) {
    return p[key] != null ? '' + p[key] : '';
  }

  // ═══════════════════════════════════════════════════════════════
  //  PURGE EMPTY SESSIONS — cleanup errant submissions
  // ═══════════════════════════════════════════════════════════════

  window.purgeEmptySessions = function() {
    var token = _getToken();
    if (!token) {
      if (window.debugConsole) window.debugConsole.logIRacingSync('error', 'Cannot purge — not signed in');
      return;
    }
    if (window.debugConsole) window.debugConsole.logIRacingSync('info', 'Purging empty sessions...');

    fetch(API_BASE + '/api/sessions?purge=empty', {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token }
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.success) {
        if (window.debugConsole) window.debugConsole.logIRacingSync('success', 'Purged ' + data.purged + ' empty sessions (of ' + data.total + ' total)');
      } else {
        if (window.debugConsole) window.debugConsole.logIRacingSync('error', 'Purge failed: ' + (data.error || 'unknown'));
      }
    })
    .catch(function(err) {
      if (window.debugConsole) window.debugConsole.logIRacingSync('error', 'Purge error: ' + err.message);
    });
  };

  // ═══════════════════════════════════════════════════════════════
  //  SESSION START — snapshot pre-race state
  // ═══════════════════════════════════════════════════════════════

  window.captureSessionStart = function(p, isDemo) {
    if (!_settings.iracingDataSync) return;
    if (!window._k10User) {
      if (window.debugConsole) window.debugConsole.logIRacingSync('error', 'Session start skipped — not signed in to Pro Drive');
      return;
    }

    var pre = isDemo ? 'RaceCorProDrive.Plugin.Demo.' : 'RaceCorProDrive.Plugin.';
    var dsPre = isDemo ? 'RaceCorProDrive.Plugin.Demo.DS.' : 'RaceCorProDrive.Plugin.DS.';

    // Detect current game
    var gameName = _vs(p, 'RaceCorProDrive.Plugin.GameId') || _vs(p, 'GameId') || 'unknown';
    var isIRacing = gameName && (gameName === 'iRacing' || gameName === 'IRacing');

    // iRating / SR — only read for iRacing, prefer manual entry
    var ir = 0, sr = 0, license = '';
    if (isIRacing) {
      ir = window._manualIRating > 0 ? window._manualIRating
        : (isDemo ? +_v(p, pre + 'IRating') || 0
                  : +_v(p, 'IRacingExtraProperties.iRacing_DriverInfo_IRating') || 0);
      sr = window._manualSafetyRating > 0 ? window._manualSafetyRating
        : (isDemo ? +_v(p, pre + 'SafetyRating') || 0
                  : +_v(p, 'IRacingExtraProperties.iRacing_DriverInfo_SafetyRating') || 0);
      license = window._manualLicense
        || _vs(p, 'IRacingExtraProperties.iRacing_DriverInfo_LicString') || '';
    }

    // Generate unique session ID — iRacing has subsession ID, others use timestamp + track
    var sessionGameId = '';
    var subsessionId = '';
    if (isIRacing) {
      sessionGameId = _vs(p, 'IRacingExtraProperties.iRacing_SessionInfo_SessionID') || '';
      // SubSessionID is the split-specific ID that iRacing's API uses — critical for dedup
      subsessionId = _vs(p, 'IRacingExtraProperties.iRacing_SessionInfo_SubSessionID') || '';
    } else {
      // Generate a unique ID from timestamp + track + car for deduplication
      var trackForId = _vs(p, 'RaceCorProDrive.Plugin.TrackMap.TrackName')
        || _vs(p, 'DataCorePlugin.GameData.TrackName') || 'unknown';
      var carForId = _vs(p, 'DataCorePlugin.GameData.CarModel') || _vs(p, pre + 'CarModel') || 'unknown';
      sessionGameId = gameName + '_' + trackForId + '_' + carForId + '_' + Date.now();
    }

    _sessionStartSnapshot = {
      preRaceIRating: ir,
      preRaceSR: sr,
      preRaceLicense: license || 'R',
      carModel: _vs(p, 'DataCorePlugin.GameData.CarModel') || _vs(p, pre + 'CarModel') || 'Unknown',
      trackName: _vs(p, 'RaceCorProDrive.Plugin.TrackMap.TrackName')
        || _vs(p, 'DataCorePlugin.GameData.TrackName') || 'Unknown',
      sessionType: _vs(p, pre + 'SessionTypeName') || 'road',
      gameName: gameName,
      gameId: sessionGameId,
      subsessionId: subsessionId,
      startedAt: new Date().toISOString(),
      startPosition: +_v(p, 'DataCorePlugin.GameData.Position') || 0,
      startIncidents: +_v(p, dsPre + 'IncidentCount') || 0
    };
    _sessionSubmitted = false;

    console.log('[Session Sync] Session start captured (' + gameName + '):', _sessionStartSnapshot.carModel,
      '@', _sessionStartSnapshot.trackName, '| iR:', _sessionStartSnapshot.preRaceIRating);

    if (window.debugConsole) {
      window.debugConsole.logIRacingSync('info', 'Session start (' + gameName + '): ' + _sessionStartSnapshot.carModel + ' @ ' + _sessionStartSnapshot.trackName + ' (iR: ' + _sessionStartSnapshot.preRaceIRating + ')');
    }
  };

  // ═══════════════════════════════════════════════════════════════
  //  SESSION END — collect finish data and POST to /api/sessions
  // ═══════════════════════════════════════════════════════════════

  window.captureSessionEnd = function(p, isDemo) {
    if (!_settings.iracingDataSync) return;
    if (!window._k10User) {
      if (window.debugConsole) window.debugConsole.logIRacingSync('error', 'Session end skipped — not signed in to Pro Drive');
      return;
    }
    if (_sessionSubmitted) return;  // Already sent for this race
    if (!_sessionStartSnapshot) {
      console.warn('[Session Sync] No start snapshot — skipping session end');
      if (window.debugConsole) window.debugConsole.logIRacingSync('error', 'Session end skipped — no start snapshot captured');
      return;
    }

    var token = _getToken();
    if (!token) {
      console.warn('[Session Sync] No auth token — cannot submit session');
      if (window.debugConsole) window.debugConsole.logIRacingSync('error', 'Session end skipped — no auth token (reconnect to Pro Drive)');
      return;
    }

    var pre = isDemo ? 'RaceCorProDrive.Plugin.Demo.' : 'RaceCorProDrive.Plugin.';
    var dsPre = isDemo ? 'RaceCorProDrive.Plugin.Demo.DS.' : 'RaceCorProDrive.Plugin.DS.';

    // Collect finish data from current telemetry
    var finishPosition = +_v(p, 'DataCorePlugin.GameData.Position') || 0;
    var completedLaps = +_v(p, dsPre + 'CompletedLaps')
      || +_v(p, 'DataCorePlugin.GameData.CompletedLaps') || 0;
    var totalLaps = +_v(p, 'DataCorePlugin.GameData.TotalLaps') || 0;
    var bestLapTime = +_v(p, 'DataCorePlugin.GameData.BestLapTime') || 0;
    var incidentCount = +_v(p, dsPre + 'IncidentCount') || 0;

    // Guard: don't submit sessions with no meaningful race data.
    // A valid race session should have at least 1 completed lap.
    if (completedLaps <= 0 && bestLapTime <= 0) {
      console.warn('[Session Sync] Empty session data (0 laps, no best lap) — skipping submission');
      if (window.debugConsole) window.debugConsole.logIRacingSync('warn', 'Session skipped — no laps completed (empty session data)');
      return;
    }

    // Calculate incident delta from session start
    var incidentDelta = incidentCount - (_sessionStartSnapshot.startIncidents || 0);
    if (incidentDelta < 0) incidentDelta = incidentCount; // Reset protection

    // Post-race iRating for estimated delta
    var postIR = isDemo ? +_v(p, pre + 'IRating') || 0
      : +_v(p, 'IRacingExtraProperties.iRacing_DriverInfo_IRating') || 0;
    var estimatedDelta = postIR > 0 && _sessionStartSnapshot.preRaceIRating > 0
      ? postIR - _sessionStartSnapshot.preRaceIRating : 0;

    var payload = {
      preRaceIRating: _sessionStartSnapshot.preRaceIRating,
      preRaceSR: _sessionStartSnapshot.preRaceSR,
      preRaceLicense: _sessionStartSnapshot.preRaceLicense,
      carModel: _sessionStartSnapshot.carModel,
      trackName: _sessionStartSnapshot.trackName,
      sessionType: _sessionStartSnapshot.sessionType,
      gameName: _sessionStartSnapshot.gameName,
      gameId: _sessionStartSnapshot.gameId,
      subsessionId: _sessionStartSnapshot.subsessionId || null,
      finishPosition: finishPosition,
      incidentCount: incidentDelta,
      completedLaps: completedLaps,
      totalLaps: totalLaps,
      bestLapTime: bestLapTime,
      estimatedIRatingDelta: estimatedDelta,
      startedAt: _sessionStartSnapshot.startedAt,
      finishedAt: new Date().toISOString()
    };

    _sessionSubmitted = true;

    console.log('[Session Sync] Submitting session:', 'P' + finishPosition,
      completedLaps + '/' + totalLaps + ' laps',
      incidentDelta + 'x', 'ΔiR:', estimatedDelta);

    if (window.debugConsole) {
      window.debugConsole.logIRacingSync('info', 'Session submission: P' + finishPosition + ' - ' + completedLaps + '/' + totalLaps + ' laps, ' + incidentDelta + 'x incidents');
    }

    fetch(API_BASE + '/api/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify(payload)
    })
    .then(function(r) {
      if (r.ok) {
        return r.json().then(function(data) {
          console.log('[Session Sync] Session submitted successfully:', data.sessionId);
          if (window.debugConsole) {
            window.debugConsole.logIRacingSync('success', 'Session recorded with ID: ' + data.sessionId);
          }
          // Store for backfill when next session starts
          window._lastSubmittedSessionId = data.sessionId;
          window._lastSubmittedGameId = _sessionStartSnapshot.gameName || 'unknown';
        });
      } else {
        console.warn('[Session Sync] Session submit failed:', r.status);
        if (window.debugConsole) {
          window.debugConsole.logIRacingSync('error', 'Session submit failed: ' + r.status, { statusCode: r.status });
        }
        _sessionSubmitted = false; // Allow retry
      }
    })
    .catch(function(e) {
      console.error('[Session Sync] Session submit error:', e);
      if (window.debugConsole) {
        window.debugConsole.logIRacingSync('error', 'Session submit error: ' + (e.message || String(e)));
      }
      _sessionSubmitted = false; // Allow retry
    });
  };

  // ═══════════════════════════════════════════════════════════════
  //  BACKFILL — update previous session with actual rating deltas
  //  Called from captureSessionStart when we have new ratings
  // ═══════════════════════════════════════════════════════════════

  function _backfillPreviousSession(p, isDemo) {
    if (!window._lastSubmittedSessionId) return;

    // Only backfill rating deltas for iRacing
    if (window._lastSubmittedGameId && window._lastSubmittedGameId !== 'iRacing' && window._lastSubmittedGameId !== 'IRacing') {
      window._lastSubmittedSessionId = null;
      return;
    }

    var token = _getToken();
    if (!token) {
      if (window.debugConsole) window.debugConsole.logIRacingSync('error', 'Backfill skipped — no auth token');
      return;
    }

    var pre = isDemo ? 'RaceCorProDrive.Plugin.Demo.' : 'RaceCorProDrive.Plugin.';

    // Current ratings are the post-race ratings of the previous session
    var postIR = window._manualIRating > 0 ? window._manualIRating
      : (isDemo ? +_v(p, pre + 'IRating') || 0
                : +_v(p, 'IRacingExtraProperties.iRacing_DriverInfo_IRating') || 0);
    var postSR = window._manualSafetyRating > 0 ? window._manualSafetyRating
      : (isDemo ? +_v(p, pre + 'SafetyRating') || 0
                : +_v(p, 'IRacingExtraProperties.iRacing_DriverInfo_SafetyRating') || 0);

    if (postIR <= 0 && postSR <= 0) return;

    // Calculate actual deltas from stored start snapshot
    var prevStart = _sessionStartSnapshot;
    var actualIRDelta = prevStart && prevStart.preRaceIRating > 0
      ? postIR - prevStart.preRaceIRating : 0;
    var actualSRDelta = prevStart && prevStart.preRaceSR > 0
      ? postSR - prevStart.preRaceSR : 0;

    console.log('[Session Sync] Backfilling previous session with actual deltas:',
      'ΔiR:', actualIRDelta, 'ΔSR:', actualSRDelta);

    if (window.debugConsole) {
      window.debugConsole.logIRacingSync('info', 'Backfill: ΔiR=' + actualIRDelta + ', ΔSR=' + actualSRDelta);
    }

    fetch(API_BASE + '/api/sessions/backfill', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({
        actualIRatingDelta: actualIRDelta,
        actualSRDelta: actualSRDelta,
        postRaceIRating: postIR,
        postRaceSR: postSR
      })
    })
    .then(function(r) {
      if (r.ok) {
        console.log('[Session Sync] Backfill successful');
        if (window.debugConsole) {
          window.debugConsole.logIRacingSync('success', 'Backfill completed with actual rating deltas');
        }
        window._lastSubmittedSessionId = null; // Clear after backfill
      } else {
        console.warn('[Session Sync] Backfill failed:', r.status);
        if (window.debugConsole) {
          window.debugConsole.logIRacingSync('error', 'Backfill failed: ' + r.status + (r.status === 404 ? ' (no session to backfill — previous submit may have been lost)' : ''), { statusCode: r.status });
        }
      }
    })
    .catch(function(e) {
      console.error('[Session Sync] Backfill error:', e);
      if (window.debugConsole) {
        window.debugConsole.logIRacingSync('error', 'Backfill error: ' + (e.message || String(e)));
      }
    });
  }

  // Wrap captureSessionStart to also trigger backfill
  var _origCaptureStart = window.captureSessionStart;
  window.captureSessionStart = function(p, isDemo) {
    // Backfill previous session with actual deltas before starting new one
    _backfillPreviousSession(p, isDemo);
    // Then capture the new session start
    _origCaptureStart(p, isDemo);
  };

  // ═══════════════════════════════════════════════════════════════
  //  INITIAL RATING SYNC — one-time baseline
  // ═══════════════════════════════════════════════════════════════

  /**
   * Initial Rating Backfill
   * ─────────────────────────────────────────────────────────
   * One-time snapshot of current ratings when plugin first connects to Pro Drive.
   * Gives the dashboard a baseline before the first recorded race.
   */
  window.initialRatingSync = function(p, isDemo) {
    // Only run once per session
    if (_initialSyncDone) return;

    // Only if sync is enabled and user is logged in to Pro Drive
    if (!_settings.iracingDataSync) return;
    if (!window._k10User) {
      if (window.debugConsole) window.debugConsole.logIRacingSync('error', 'Initial sync skipped — not signed in to Pro Drive');
      return;
    }

    // Rating sync only applies to iRacing
    var gameName = _vs(p, 'RaceCorProDrive.Plugin.GameId') || _vs(p, 'GameId') || '';
    if (gameName && gameName !== 'iRacing' && gameName !== 'IRacing') return;

    // Extract iRating from either manual entry or telemetry
    var ir = window._manualIRating > 0 ? window._manualIRating
      : (isDemo ? +_v(p, 'RaceCorProDrive.Plugin.Demo.IRating') || 0
                : +_v(p, 'IRacingExtraProperties.iRacing_DriverInfo_IRating') || 0);

    // Extract SafetyRating from either manual entry or telemetry
    var sr = window._manualSafetyRating > 0 ? window._manualSafetyRating
      : (isDemo ? +_v(p, 'RaceCorProDrive.Plugin.Demo.SafetyRating') || 0
                : +_v(p, 'IRacingExtraProperties.iRacing_DriverInfo_SafetyRating') || 0);

    // Only sync if we actually have rating data
    if (ir <= 0 && sr <= 0) return;

    var license = window._manualLicense || '';
    var token = _getToken();
    if (!token) {
      if (window.debugConsole) window.debugConsole.logIRacingSync('error', 'Initial sync skipped — no auth token');
      return;
    }

    _initialSyncDone = true;

    if (window.debugConsole) {
      window.debugConsole.logIRacingSync('info', 'Initial rating sync - iR: ' + ir + ', SR: ' + sr + ', License: ' + (license || 'R'));
    }

    fetch(API_BASE + '/api/ratings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({
        category: 'road',  // Default; will be overridden by actual data when available
        iRating: ir,
        safetyRating: sr,
        license: license || 'R'
      })
    })
    .then(function(r) {
      if (r.ok) {
        console.log('[Session Sync] Initial rating baseline synced:', ir, sr);
        if (window.debugConsole) {
          window.debugConsole.logIRacingSync('success', 'Initial rating baseline recorded');
        }
      } else {
        console.warn('[Session Sync] Initial sync failed:', r.status);
        if (window.debugConsole) {
          window.debugConsole.logIRacingSync('error', 'Initial sync failed: ' + r.status, { statusCode: r.status });
        }
      }
    })
    .catch(function(e) {
      _initialSyncDone = false; // Allow retry on error
      console.error('[Session Sync] Initial sync error:', e);
      if (window.debugConsole) {
        window.debugConsole.logIRacingSync('error', 'Initial sync error: ' + (e.message || String(e)));
      }
    });
  };

  // ═══════════════════════════════════════════════════════════════
  //  PRACTICE / QUALIFYING SESSION END — summary for dashboard
  // ═══════════════════════════════════════════════════════════════

  // Track the previous sessionMode so we can detect practice→race transitions
  var _prevSyncSessionMode = 0;
  var _practiceSubmitted = false;

  /**
   * Called by poll-engine.js when session type changes.
   * Captures a practice/qualifying/warmup session summary and POSTs it
   * to /api/sessions so the dashboard can show practice trends over time.
   */
  window.capturePracticeSessionEnd = function(p, isDemo) {
    if (!_settings.iracingDataSync) return;
    if (!window._k10User) return;
    if (_practiceSubmitted) return;
    if (!_sessionStartSnapshot) return;

    var token = _getToken();
    if (!token) return;

    var pre = isDemo ? 'RaceCorProDrive.Plugin.Demo.' : 'RaceCorProDrive.Plugin.';
    var dsPre = isDemo ? 'RaceCorProDrive.Plugin.Demo.DS.' : 'RaceCorProDrive.Plugin.DS.';

    // Only capture non-race sessions (Practice=1, Qualifying=2, Warmup=3)
    var sessionMode = +(p[dsPre + 'SessionMode']) || 0;
    // Use the snapshot's session mode — the current p[] may already reflect the NEW session
    // So check what the start snapshot recorded
    var startSessionType = (_sessionStartSnapshot.sessionType || '').toLowerCase();
    var wasPractice = startSessionType.indexOf('practice') >= 0
      || startSessionType.indexOf('warmup') >= 0
      || startSessionType.indexOf('open qualify') >= 0
      || startSessionType.indexOf('lone qualify') >= 0
      || startSessionType.indexOf('qualify') >= 0;

    if (!wasPractice) return;

    // Gather summary data from current telemetry
    var bestLapTime = isDemo
      ? +(p[pre + 'BestLapTime']) || 0
      : +(p['DataCorePlugin.GameData.BestLapTime']) || 0;
    var completedLaps = +(p[dsPre + 'CompletedLaps'])
      || +(p['DataCorePlugin.GameData.CompletedLaps']) || 0;
    var incidentCount = +(p[dsPre + 'IncidentCount']) || 0;
    var incidentDelta = incidentCount - (_sessionStartSnapshot.startIncidents || 0);
    if (incidentDelta < 0) incidentDelta = incidentCount;

    // Collect sector best times from plugin (SectorTracker exposes best splits)
    var sectorCount = +(p[dsPre + 'SectorCount']) || 3;
    var sectorBests = [];
    var sectorBestsStr = p[dsPre + 'SectorBests'] || '';
    if (sectorBestsStr) {
      var parts = sectorBestsStr.split(',');
      for (var si = 0; si < parts.length; si++) {
        var val = parseFloat(parts[si]) || 0;
        if (val > 0) sectorBests.push(val);
      }
    }

    // Skip if we have no meaningful data (no laps completed)
    if (completedLaps <= 0 && bestLapTime <= 0) return;

    // Determine session mode name for the record
    var sessionModeName = 'practice';
    if (startSessionType.indexOf('qualify') >= 0) sessionModeName = 'qualifying';
    else if (startSessionType.indexOf('warmup') >= 0) sessionModeName = 'warmup';

    var payload = {
      preRaceIRating: _sessionStartSnapshot.preRaceIRating || 0,
      preRaceSR: _sessionStartSnapshot.preRaceSR || 0,
      preRaceLicense: _sessionStartSnapshot.preRaceLicense || 'R',
      carModel: _sessionStartSnapshot.carModel,
      trackName: _sessionStartSnapshot.trackName,
      sessionType: startSessionType || sessionModeName,
      gameName: _sessionStartSnapshot.gameName,
      gameId: _sessionStartSnapshot.gameId,
      subsessionId: _sessionStartSnapshot.subsessionId || null,
      finishPosition: null,  // No finish position in practice
      incidentCount: incidentDelta,
      completedLaps: completedLaps,
      totalLaps: 0,
      bestLapTime: bestLapTime,
      estimatedIRatingDelta: 0,
      startedAt: _sessionStartSnapshot.startedAt,
      finishedAt: new Date().toISOString(),
      // Practice-specific metadata
      isPracticeSession: true,
      practiceData: {
        sessionMode: sessionModeName,
        sectorBests: sectorBests.length > 0 ? sectorBests : null,
        sectorCount: sectorCount
      }
    };

    _practiceSubmitted = true;

    console.log('[Session Sync] Submitting ' + sessionModeName + ' session:',
      completedLaps + ' laps', 'best: ' + (bestLapTime > 0 ? bestLapTime.toFixed(3) + 's' : 'N/A'),
      incidentDelta + 'x');

    if (window.debugConsole) {
      window.debugConsole.logIRacingSync('info', sessionModeName + ' session: ' + completedLaps + ' laps, best: ' + (bestLapTime > 0 ? bestLapTime.toFixed(3) + 's' : 'N/A'));
    }

    fetch(API_BASE + '/api/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify(payload)
    })
    .then(function(r) {
      if (r.ok) {
        return r.json().then(function(data) {
          console.log('[Session Sync] ' + sessionModeName + ' session recorded:', data.sessionId);
          if (window.debugConsole) {
            window.debugConsole.logIRacingSync('success', sessionModeName + ' session recorded: ' + data.sessionId);
          }
        });
      } else {
        console.warn('[Session Sync] ' + sessionModeName + ' submit failed:', r.status);
        if (window.debugConsole) {
          window.debugConsole.logIRacingSync('error', sessionModeName + ' submit failed: ' + r.status);
        }
        _practiceSubmitted = false;
      }
    })
    .catch(function(e) {
      console.error('[Session Sync] ' + sessionModeName + ' submit error:', e);
      if (window.debugConsole) {
        window.debugConsole.logIRacingSync('error', sessionModeName + ' submit error: ' + (e.message || String(e)));
      }
      _practiceSubmitted = false;
    });
  };

  // Reset practice submitted flag when a new session starts
  var _origCaptureStartForPractice = window.captureSessionStart;
  window.captureSessionStart = function(p, isDemo) {
    _practiceSubmitted = false;
    _origCaptureStartForPractice(p, isDemo);
  };

  // ═══════════════════════════════════════════════════════════════
  //  iRACING HISTORY IMPORT — reads cookies from local iRacing app
  // ═══════════════════════════════════════════════════════════════

  var PLUGIN_BASE = 'http://localhost:8889/racecor-io-pro-drive/';

  /**
   * Trigger a full iRacing career history import.
   *
   * Flow:
   *   1. Overlay calls the SimHub plugin at localhost:8889 with ?action=iracingImport
   *   2. Plugin reads cookies from the locally running iRacing app
   *   3. Plugin fetches career data from members-ng.iracing.com using those cookies
   *   4. Plugin returns the data to us
   *   5. We POST the data to Pro Drive web API for permanent storage
   *
   * @returns {Promise<object|null>} Import result or null on failure
   */
  window.triggerIRacingImport = function() {
    var token = _getToken();
    if (!token) {
      console.warn('[Session Sync] No auth token — cannot sync to Pro Drive');
      if (window.debugConsole) window.debugConsole.logIRacingSync('error', 'iRacing import skipped — no auth token');
      return Promise.resolve(null);
    }

    console.log('[Session Sync] Step 1: Fetching iRacing career data from local plugin...');
    if (window.debugConsole) window.debugConsole.logIRacingSync('info', 'iRacing import: fetching career data from local plugin...');

    // Step 1: Ask the plugin to fetch career data using local iRacing cookies
    return fetch(PLUGIN_BASE + '?action=iracingImport')
    .then(function(r) { return r.json(); })
    .then(function(pluginResult) {
      if (!pluginResult.ok) {
        var errMsg = pluginResult.error || 'unknown error';
        console.warn('[Session Sync] Plugin iRacing fetch failed:', errMsg);
        if (window.debugConsole) window.debugConsole.logIRacingSync('error', 'iRacing import: plugin fetch failed — ' + errMsg);

        // Legacy auth retired Dec 2025 — show OAuth notice
        if (errMsg.toLowerCase().indexOf('not authenticated') >= 0 && window.showIRacingOAuthNotice) {
          window.showIRacingOAuthNotice();
        }
        return null;
      }

      var careerData = pluginResult.data;
      console.log('[Session Sync] Step 2: Got career data for',
        careerData.displayName, '(#' + careerData.custId + ')',
        '— sending to Pro Drive...');
      if (window.debugConsole) window.debugConsole.logIRacingSync('info', 'iRacing import: got data for ' + careerData.displayName + ' (#' + careerData.custId + '), uploading...');

      // Step 2: Push the career data to Pro Drive web API
      return fetch(API_BASE + '/api/iracing/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify(careerData)
      })
      .then(function(r) {
        if (r.ok) {
          return r.json().then(function(data) {
            console.log('[Session Sync] iRacing import complete:',
              data.imported.sessions + ' sessions,',
              data.imported.historyPoints + ' history points');
            if (window.debugConsole) window.debugConsole.logIRacingSync('success', 'iRacing import complete: ' + data.imported.sessions + ' sessions, ' + data.imported.historyPoints + ' history points');
            return data;
          });
        } else {
          return r.json().then(function(err) {
            console.warn('[Session Sync] Pro Drive import failed:', err.error);
            if (window.debugConsole) window.debugConsole.logIRacingSync('error', 'iRacing import failed: ' + (err.error || r.status), { statusCode: r.status });
            return null;
          });
        }
      });
    })
    .catch(function(e) {
      console.error('[Session Sync] iRacing import error:', e);
      if (window.debugConsole) window.debugConsole.logIRacingSync('error', 'iRacing import error: ' + (e.message || String(e)));
      return null;
    });
  };


  /**
   * Authenticate with iRacing using email/password (through the local plugin).
   * @param {string} email - iRacing account email
   * @param {string} password - iRacing account password
   * @returns {Promise<boolean>} true if authentication succeeded
   */
  window.authenticateIRacing = function(email, password) {
    return fetch(PLUGIN_BASE + '?action=iracingAuth&email='
      + encodeURIComponent(email) + '&password=' + encodeURIComponent(password))
    .then(function(r) { return r.json(); })
    .then(function(result) {
      if (result.ok) {
        console.log('[Session Sync] iRacing authenticated successfully');
        if (window.debugConsole) window.debugConsole.logIRacingSync('success', 'iRacing authenticated');
        return { ok: true };
      }
      var errMsg = result.error || 'unknown error';
      console.warn('[Session Sync] iRacing auth failed:', errMsg);
      if (window.debugConsole) window.debugConsole.logIRacingSync('error', 'iRacing auth failed: ' + errMsg);
      return { ok: false, error: errMsg };
    })
    .catch(function(e) {
      console.error('[Session Sync] iRacing auth error:', e);
      if (window.debugConsole) window.debugConsole.logIRacingSync('error', 'iRacing auth error: ' + (e.message || String(e)));
      return { ok: false, error: e.message || String(e) };
    });
  };

  /**
   * Check iRacing authentication status via the local plugin.
   * @returns {Promise<object|null>} Status object or null
   */
  window.checkIRacingStatus = function() {
    return fetch(PLUGIN_BASE + '?action=iracingStatus')
    .then(function(r) { return r.ok ? r.json() : null; })
    .catch(function() { return null; });
  };


  // ═══════════════════════════════════════════════════════════════
  //  POST-RACE POLL — fetch latest results from iRacing API
  // ═══════════════════════════════════════════════════════════════

  var _postRacePollTimer = null;
  var _postRacePollAttempts = 0;
  var _postRacePollMaxAttempts = 5;
  var _postRacePollInterval = 10000; // 10 seconds
  var _postRacePollGameId = null;    // subsession/gameId we're waiting for

  /**
   * Start polling iRacing API (via plugin) for the latest race result.
   * Called after captureSessionEnd for iRacing sessions. Polls every 10s
   * up to 5 times, looking for the subsession that just finished.
   * When found (or max attempts reached), stops polling.
   */
  function _startPostRacePoll(gameId) {
    _stopPostRacePoll(); // Clear any prior poll

    _postRacePollGameId = gameId || null;
    _postRacePollAttempts = 0;

    console.log('[Session Sync] Starting post-race poll for latest iRacing results...');
    if (window.debugConsole) window.debugConsole.logIRacingSync('info', 'Post-race sync: polling for finalized results...');

    // First attempt after a short delay (iRacing needs time to finalize)
    _postRacePollTimer = setTimeout(_doPostRacePoll, _postRacePollInterval);
  }

  function _stopPostRacePoll() {
    if (_postRacePollTimer) {
      clearTimeout(_postRacePollTimer);
      _postRacePollTimer = null;
    }
    _postRacePollAttempts = 0;
    _postRacePollGameId = null;
  }

  function _doPostRacePoll() {
    _postRacePollTimer = null;
    _postRacePollAttempts++;

    var token = _getToken();
    if (!token || !window._k10User) {
      console.warn('[Session Sync] Post-race poll: no auth — stopping');
      _stopPostRacePoll();
      return;
    }

    console.log('[Session Sync] Post-race poll attempt ' + _postRacePollAttempts + '/' + _postRacePollMaxAttempts);
    if (window.debugConsole) window.debugConsole.logIRacingSync('info', 'Post-race poll attempt ' + _postRacePollAttempts + '/' + _postRacePollMaxAttempts);

    // Fetch latest recent races from iRacing via the local SimHub plugin
    fetch(PLUGIN_BASE + '?action=iracingLatest')
    .then(function(r) { return r.json(); })
    .then(function(pluginResult) {
      if (!pluginResult.ok) {
        console.warn('[Session Sync] Post-race poll: plugin fetch failed:', pluginResult.error);
        if (window.debugConsole) window.debugConsole.logIRacingSync('error', 'Post-race poll failed: ' + (pluginResult.error || 'unknown'));
        _scheduleNextPoll();
        return;
      }

      var data = pluginResult.data;
      if (!data || !Array.isArray(data.recentRaces) || data.recentRaces.length === 0) {
        console.log('[Session Sync] Post-race poll: no races returned yet');
        _scheduleNextPoll();
        return;
      }

      // Push the recent races to /api/iracing/latest for deduped import
      fetch(API_BASE + '/api/iracing/latest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify(data)
      })
      .then(function(r) {
        if (r.ok) {
          return r.json().then(function(result) {
            var imported = result.imported || {};
            if (imported.sessions > 0) {
              console.log('[Session Sync] Post-race sync: imported ' + imported.sessions + ' new session(s), ' + (imported.ratings || 0) + ' rating point(s)');
              if (window.debugConsole) window.debugConsole.logIRacingSync('success', 'Post-race sync: ' + imported.sessions + ' new session(s) imported from iRacing API');
              // Success — stop polling
              _stopPostRacePoll();
            } else {
              console.log('[Session Sync] Post-race sync: no new sessions (may not be finalized yet)');
              _scheduleNextPoll();
            }
          });
        } else {
          console.warn('[Session Sync] Post-race sync: API error', r.status);
          _scheduleNextPoll();
        }
      })
      .catch(function(e) {
        console.error('[Session Sync] Post-race sync error:', e);
        _scheduleNextPoll();
      });
    })
    .catch(function(e) {
      console.warn('[Session Sync] Post-race poll: network error:', e.message || e);
      _scheduleNextPoll();
    });
  }

  function _scheduleNextPoll() {
    if (_postRacePollAttempts >= _postRacePollMaxAttempts) {
      console.log('[Session Sync] Post-race poll: max attempts reached — stopping');
      if (window.debugConsole) window.debugConsole.logIRacingSync('info', 'Post-race poll: max attempts reached, will sync on next launch');
      _stopPostRacePoll();
      return;
    }
    _postRacePollTimer = setTimeout(_doPostRacePoll, _postRacePollInterval);
  }

  // Hook into captureSessionEnd to trigger post-race polling for iRacing
  var _origCaptureEndForPoll = window.captureSessionEnd;
  window.captureSessionEnd = function(p, isDemo) {
    // Call original captureSessionEnd first
    _origCaptureEndForPoll(p, isDemo);

    // Only poll for iRacing sessions
    var gameName = _vs(p, 'RaceCorProDrive.Plugin.GameId') || _vs(p, 'GameId') || '';
    if (gameName === 'iRacing' || gameName === 'IRacing') {
      var gameId = _vs(p, 'IRacingExtraProperties.iRacing_SessionInfo_SessionID') || '';
      _startPostRacePoll(gameId);
    }
  };

  // ═══════════════════════════════════════════════════════════════
  //  SYNC ON LOAD — check if a full import has happened yet
  // ═══════════════════════════════════════════════════════════════

  /**
   * Check if a full iRacing history sync has been done. If not, trigger one.
   * Called when the overlay loads with an existing K10 Pro Drive connection.
   */
  window.checkAndSyncIRacingHistory = function() {
    var token = _getToken();
    if (!token || !window._k10User) {
      console.log('[Session Sync] Skipping iRacing check — ' + (!token ? 'no auth token' : 'no K10 user'));
      return;
    }
    if (!_settings.iracingDataSync) {
      console.log('[Session Sync] iRacing data sync is disabled in settings');
      return;
    }

    console.log('[Session Sync] Checking iRacing import status...');
    if (window.debugConsole) window.debugConsole.logIRacingSync('info', 'Checking if full iRacing history sync is needed...');

    fetch(API_BASE + '/api/iracing/import', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token }
    })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(status) {
      if (!status) {
        console.warn('[Session Sync] Could not check import status');
        return;
      }

      if (!status.connected || !status.lastImportAt) {
        // No prior import — trigger a full career sync
        console.log('[Session Sync] No prior iRacing import found — triggering full career sync');
        if (window.debugConsole) window.debugConsole.logIRacingSync('info', 'No prior import found — starting full iRacing career sync...');
        window.triggerIRacingImport();
      } else {
        console.log('[Session Sync] iRacing data already synced (last: ' + status.lastImportAt + ')');
        if (window.debugConsole) window.debugConsole.logIRacingSync('success', 'iRacing data synced (last: ' + new Date(status.lastImportAt).toLocaleDateString() + ')');

        // Even if we have a prior import, fetch the latest races to catch anything
        // that happened since the last sync (e.g. races from previous overlay session)
        _doQuietLatestSync();
      }
    })
    .catch(function(e) {
      console.warn('[Session Sync] Import status check error:', e.message || e);
    });
  };

  /**
   * Quietly sync the latest recent races without a full career export.
   * Used on load to catch races since the last sync.
   */
  function _doQuietLatestSync() {
    var token = _getToken();
    if (!token) return;

    fetch(PLUGIN_BASE + '?action=iracingLatest')
    .then(function(r) { return r.json(); })
    .then(function(pluginResult) {
      if (!pluginResult.ok || !pluginResult.data) return;

      fetch(API_BASE + '/api/iracing/latest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify(pluginResult.data)
      })
      .then(function(r) {
        if (r.ok) {
          return r.json().then(function(result) {
            var imported = result.imported || {};
            if (imported.sessions > 0) {
              console.log('[Session Sync] Quiet sync: imported ' + imported.sessions + ' new session(s)');
              if (window.debugConsole) window.debugConsole.logIRacingSync('success', 'Caught up: ' + imported.sessions + ' new session(s) from iRacing');
            }
          });
        }
      })
      .catch(function() {}); // Quiet — don't log errors for background sync
    })
    .catch(function() {}); // Plugin may not be reachable yet
  }

})();
