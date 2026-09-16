// Incident Coach — overlay module
// Parses threat data from plugin HTTP API, manages leaderboard/map highlights,
// composure indicator, cool-down vignette, and voice coaching triggers.

  // ═══════════════════════════════════════════════════════════════
  //  INCIDENT COACH — OVERLAY INTEGRATION
  // ═══════════════════════════════════════════════════════════════

  // ── State ──────────────────────────────────────────────────────
  const _ic = {
    active: false,
    threats: [],           // parsed DriverThreatEntry[]
    alert: null,           // parsed IncidentAlert
    rageScore: 0,
    cooldownActive: false,
    behavior: null,        // parsed BehaviorMetrics

    // Tracking for voice coaching triggers
    lastVoicePromptAt: 0,
    lastContactVoiceAt: 0,
    lastIncidentLap: 0,
    prevIncidentLap: 0,
    cleanLapCounter: 0,
    prevCooldownActive: false,
    prevRageScore: 0,
    prevAlertKey: '',

    // Composure indicator state
    composureEl: null,
    composureVisible: false,

    // Incident flash
    prevFlashLap: 0,

    // Perf: cache keys to skip redundant DOM work
    _lastThreatHash: '',
    _lastMapKey: ''
  };

  // ── Threat level constants (match C# ThreatLevel enum) ────────
  const THREAT_NONE    = 0;
  const THREAT_WATCH   = 1;
  const THREAT_CAUTION = 2;
  const THREAT_DANGER  = 3;

  const THREAT_CLASSES = {
    [THREAT_WATCH]:   'ic-watch',
    [THREAT_CAUTION]: 'ic-caution',
    [THREAT_DANGER]:  'ic-danger'
  };

  const THREAT_LABELS = {
    [THREAT_WATCH]:   'WATCH',
    [THREAT_CAUTION]: 'CAUTION',
    [THREAT_DANGER]:  'DANGER'
  };

  // ── Composure indicator setup ──────────────────────────────────

  function _ensureComposureIndicator() {
    if (_ic.composureEl) return _ic.composureEl;

    const el = document.createElement('div');
    el.id = 'composureIndicator';
    el.className = 'ic-composure ic-composure-calm';
    el.innerHTML = '<div class="ic-composure-dot"></div><div class="ic-composure-label">COMPOSURE</div>';
    document.body.appendChild(el);
    _ic.composureEl = el;
    return el;
  }

  function _updateComposureIndicator(rageScore) {
    const el = _ensureComposureIndicator();

    // Remove all state classes
    el.classList.remove('ic-composure-calm', 'ic-composure-elevated',
                        'ic-composure-active', 'ic-composure-critical');

    if (rageScore <= 30) {
      el.classList.add('ic-composure-calm');
    } else if (rageScore <= 50) {
      el.classList.add('ic-composure-elevated');
    } else if (rageScore <= 70) {
      el.classList.add('ic-composure-active');
    } else {
      el.classList.add('ic-composure-critical');
    }

    // Only show when there's something to show (after first incident)
    if (rageScore > 0 || _ic.threats.length > 0) {
      el.style.display = '';
      _ic.composureVisible = true;
    }
  }

  // ── Cool-down vignette ─────────────────────────────────────────

  function _ensureCooldownVignette() {
    let el = document.getElementById('cooldownVignette');
    if (el) return el;

    el = document.createElement('div');
    el.id = 'cooldownVignette';
    el.className = 'ic-cooldown-vignette';
    document.body.appendChild(el);
    return el;
  }

  function _updateCooldownVignette(active, rageScore) {
    const el = _ensureCooldownVignette();

    if (active) {
      el.classList.add('ic-cooldown-active');
      // Intensify based on rage score
      if (rageScore > 85) {
        el.classList.add('ic-cooldown-intense');
      } else {
        el.classList.remove('ic-cooldown-intense');
      }
    } else {
      el.classList.remove('ic-cooldown-active', 'ic-cooldown-intense');
    }
  }

  // ── Leaderboard threat highlighting ────────────────────────────

  // Build a name → ThreatLevel lookup from current threats
  function _buildThreatMap() {
    const map = new Map();
    for (const t of _ic.threats) {
      if (t.Level > THREAT_NONE) {
        map.set((t.Name || '').toLowerCase(), t);
      }
    }
    return map;
  }

  /**
   * Called after leaderboard renders. Scans lb-row elements and
   * applies threat classes + icons based on the threat ledger.
   */
  function _highlightLeaderboardThreats() {
    const threatMap = _buildThreatMap();

    // ── Cache check: skip DOM work if threats haven't changed ────
    let hash = '';
    for (const [name, t] of threatMap) {
      hash += name + ':' + t.Level + ':' + t.IncidentCount + '|';
    }
    if (hash === _ic._lastThreatHash) return;
    _ic._lastThreatHash = hash;

    const rows = document.querySelectorAll('.lb-row');
    for (const row of rows) {
      // Get driver name from the lb-name element
      const nameEl = row.querySelector('.lb-name');
      if (!nameEl) continue;

      // Extract text, removing "IN PIT" suffix if present
      const nameText = (nameEl.textContent || '').replace(/\s*IN PIT\s*$/i, '').trim().toLowerCase();

      const threat = threatMap.get(nameText);
      const oldBadge = row.querySelector('.ic-threat-badge');

      if (threat) {
        const cls = THREAT_CLASSES[threat.Level];
        if (cls) {
          // Remove stale classes, apply current
          row.classList.remove('ic-watch', 'ic-caution', 'ic-danger');
          row.classList.add(cls);

          const icon = threat.Level === THREAT_DANGER ? '⚠' :
                       threat.Level === THREAT_CAUTION ? '△' : '◉';
          const title = THREAT_LABELS[threat.Level] + ' — ' + threat.IncidentCount + ' incident(s)';

          // Reuse existing badge if present; only create when needed
          if (oldBadge) {
            oldBadge.className = 'ic-threat-badge ' + cls;
            oldBadge.textContent = icon;
            oldBadge.title = title;
          } else {
            const badge = document.createElement('span');
            badge.className = 'ic-threat-badge ' + cls;
            badge.textContent = icon;
            badge.title = title;
            nameEl.prepend(badge);
          }
        }
      } else {
        // Driver not in ledger — clean up
        row.classList.remove('ic-watch', 'ic-caution', 'ic-danger');
        if (oldBadge) oldBadge.remove();
      }
    }
  }

  // ── Voice coaching triggers ────────────────────────────────────
  // Evaluate state changes and fire appropriate voice prompts.
  // Respects cooldowns and priority rules from voice-coach.js.

  function _evaluateVoiceTriggers() {
    if (!window.voiceCoachSpeak) return;
    const now = Date.now();

    // ── New incident detected (lap changed) ──────────────────────
    if (_ic.lastIncidentLap > 0 && _ic.lastIncidentLap !== _ic.prevIncidentLap) {
      _ic.prevIncidentLap = _ic.lastIncidentLap;
      _ic.cleanLapCounter = 0;

      if (now - _ic.lastContactVoiceAt > 10000) { // 10s cooldown for contact alerts
        window.voiceCoachSpeak('contact_detected', 3);
        _ic.lastContactVoiceAt = now;
      }
    }

    // ── Proximity alert to flagged driver ────────────────────────
    if (_ic.alert && _ic.alert.Active) {
      const alertKey = _ic.alert.DriverName + '|' + _ic.alert.VoicePromptKey;

      if (alertKey !== _ic.prevAlertKey) {
        _ic.prevAlertKey = alertKey;

        const vars = {
          name: _ic.alert.DriverName,
          gap: _ic.alert.GapSeconds,
          direction: _ic.alert.IsAhead ? 'ahead' : 'behind'
        };

        window.voiceCoachSpeak(
          _ic.alert.VoicePromptKey,
          _ic.alert.VoicePriority,
          vars
        );
      }
    } else {
      _ic.prevAlertKey = '';
    }

    // ── Rage escalation ──────────────────────────────────────────
    if (_ic.rageScore >= 70 && _ic.prevRageScore < 70) {
      window.voiceCoachSpeak('rage_warning', 4);
    }
    if (_ic.rageScore >= 85 && _ic.prevRageScore < 85) {
      window.voiceCoachSpeak('rage_critical', 5);
    }

    // ── Cool-down transitions ────────────────────────────────────
    if (_ic.cooldownActive && !_ic.prevCooldownActive) {
      window.voiceCoachSpeak('cooldown_active', 4);
    }
    if (!_ic.cooldownActive && _ic.prevCooldownActive) {
      window.voiceCoachSpeak('cooldown_exit', 2);
    }

    // ── Positive reinforcement — 3 clean laps post-incident ──────
    // (tracked via behavior metrics clean lap count)
    if (_ic.behavior && _ic.behavior.CleanLaps > _ic.cleanLapCounter + 2 &&
        _ic.threats.length > 0) {
      _ic.cleanLapCounter = _ic.behavior.CleanLaps;
      window.voiceCoachSpeak('positive_clean_laps', 1);
    }

    _ic.prevRageScore = _ic.rageScore;
    _ic.prevCooldownActive = _ic.cooldownActive;
  }

  // ── Spotter integration ────────────────────────────────────────
  // Push threat approach messages to the existing spotter stack.

  function _pushThreatSpotterMsg() {
    if (!_ic.alert || !_ic.alert.Active) return;
    if (!window._showSpotterMsg && typeof _showSpotterMsg !== 'function') return;

    const showFn = typeof _showSpotterMsg === 'function' ? _showSpotterMsg : window._showSpotterMsg;
    if (!showFn) return;

    const dir = _ic.alert.IsAhead ? 'ahead' : 'behind';
    const gap = (+_ic.alert.GapSeconds).toFixed(1);
    const lvl = _ic.alert.ThreatLevel;

    let msg, severity;
    if (lvl >= THREAT_DANGER) {
      msg = '⚠ ' + _ic.alert.DriverName + ' — ' + gap + 's ' + dir;
      severity = 'sp-danger';
    } else if (lvl >= THREAT_CAUTION) {
      msg = '△ ' + _ic.alert.DriverName + ' — ' + gap + 's ' + dir;
      severity = 'sp-warn';
    } else {
      msg = '◉ ' + _ic.alert.DriverName + ' — ' + gap + 's ' + dir;
      severity = 'sp-warn';
    }

    showFn(msg, severity, 'Incident Coach', 'ic-threat');
  }

  // ── Main update function ───────────────────────────────────────
  // Called every frame from poll-engine.js

  function updateIncidentCoach(p) {
    // Read master toggle
    _ic.active = +(p['RaceCorProDrive.Plugin.DS.IncidentCoach.Active']) === 1;
    if (!_ic.active) {
      // Hide UI elements when disabled
      if (_ic.composureEl) _ic.composureEl.style.display = 'none';
      _updateCooldownVignette(false, 0);
      return;
    }

    // ── Parse plugin data ────────────────────────────────────────
    _ic.rageScore = +(p['RaceCorProDrive.Plugin.DS.IncidentCoach.RageScore']) || 0;
    _ic.cooldownActive = +(p['RaceCorProDrive.Plugin.DS.IncidentCoach.CooldownActive']) === 1;
    _ic.lastIncidentLap = +(p['RaceCorProDrive.Plugin.DS.IncidentCoach.LastIncidentLap']) || 0;

    // Parse JSON fields (with try/catch for safety)
    const threatsRaw = p['RaceCorProDrive.Plugin.DS.IncidentCoach.ThreatDrivers'];
    if (threatsRaw && typeof threatsRaw === 'string' && threatsRaw !== '[]') {
      try { _ic.threats = JSON.parse(threatsRaw); } catch(e) { /* keep last */ }
    } else if (threatsRaw === '[]') {
      _ic.threats = [];
    }

    const alertRaw = p['RaceCorProDrive.Plugin.DS.IncidentCoach.ActiveAlert'];
    if (alertRaw && typeof alertRaw === 'string' && alertRaw !== '{}') {
      try { _ic.alert = JSON.parse(alertRaw); } catch(e) { /* keep last */ }
    }

    const behaviorRaw = p['RaceCorProDrive.Plugin.DS.IncidentCoach.SessionBehavior'];
    if (behaviorRaw && typeof behaviorRaw === 'string' && behaviorRaw !== '{}') {
      try { _ic.behavior = JSON.parse(behaviorRaw); } catch(e) { /* keep last */ }
    }

    // ── Update UI elements ───────────────────────────────────────
    _updateComposureIndicator(_ic.rageScore);
    _updateCooldownVignette(_ic.cooldownActive, _ic.rageScore);
    _updateDriveHudComposure(_ic.rageScore);

    // ── Leaderboard + track-map threats (throttled to ~3x/sec) ──
    // These do heavy DOM queries/mutations; no need to run every frame.
    if (typeof _pollFrame !== 'undefined' && _pollFrame % 10 === 0) {
      _highlightLeaderboardThreats();
      _updateTrackMapThreats(p);
    }

    // ── Incident flash on new contact ────────────────────────────
    if (_ic.lastIncidentLap > 0 && _ic.lastIncidentLap !== _ic.prevFlashLap) {
      _ic.prevFlashLap = _ic.lastIncidentLap;
      _triggerIncidentFlash(p);
    }

    // ── Evaluate voice triggers (throttled to ~3x/sec) ───────────
    if (typeof _pollFrame !== 'undefined' && _pollFrame % 10 === 0) {
      _evaluateVoiceTriggers();
    }

    // ── Push spotter messages (throttled to ~1x/sec) ─────────────
    if (typeof _pollFrame !== 'undefined' && _pollFrame % 30 === 0) {
      _pushThreatSpotterMsg();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  PHASE 3: DRIVE HUD COMPOSURE BAR
  // ═══════════════════════════════════════════════════════════════

  function _updateDriveHudComposure(rageScore) {
    const container = document.getElementById('dhComposure');
    const fill = document.getElementById('dhComposureFill');
    const label = document.getElementById('dhComposureLabel');
    if (!container || !fill || !label) return;

    // Only show after first incident
    if (_ic.threats.length === 0 && rageScore === 0) {
      container.style.display = 'none';
      return;
    }
    container.style.display = '';

    // Fill bar width represents rage (0–100)
    fill.style.width = Math.min(100, rageScore) + '%';

    // Color + label by tier
    if (rageScore <= 30) {
      fill.style.background = 'hsl(140, 50%, 40%)';
      label.textContent = 'CALM';
      label.style.color = 'hsl(140, 40%, 60%)';
    } else if (rageScore <= 50) {
      fill.style.background = 'hsl(35, 80%, 50%)';
      label.textContent = 'ELEVATED';
      label.style.color = 'hsl(35, 70%, 65%)';
    } else if (rageScore <= 70) {
      fill.style.background = 'hsl(25, 85%, 50%)';
      label.textContent = 'ACTIVE';
      label.style.color = 'hsl(25, 80%, 65%)';
    } else {
      fill.style.background = 'hsl(0, 70%, 50%)';
      label.textContent = _ic.cooldownActive ? 'COOL DOWN' : 'CRITICAL';
      label.style.color = 'hsl(0, 60%, 70%)';
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  PHASE 5: TRACK MAP THREAT COLORING
  // ═══════════════════════════════════════════════════════════════
  // Colors opponent dots on the drive-hud track map based on
  // threat level. Uses nearest-ahead/behind names to identify which
  // dot belongs to the flagged driver (closest dots get colored).

  function _updateTrackMapThreats(p) {
    if (_ic.threats.length === 0) return;

    const threatMap = _buildThreatMap();
    if (threatMap.size === 0) return;

    // Get nearest driver names
    const aheadName = (p['IRacingExtraProperties.iRacing_Opponent_Ahead_Name'] || '').toLowerCase();
    const behindName = (p['IRacingExtraProperties.iRacing_Opponent_Behind_Name'] || '').toLowerCase();

    // ── Cache check: skip DOM work if threat + proximity unchanged ──
    const mapKey = _ic._lastThreatHash + '/' + aheadName + '/' + behindName;
    if (mapKey === _ic._lastMapKey) return;
    _ic._lastMapKey = mapKey;

    const aheadThreat = threatMap.get(aheadName);
    const behindThreat = threatMap.get(behindName);

    // Color the closest and second-closest opponent dots
    const dhOppG = document.getElementById('dhMapOpponents');
    if (!dhOppG) return;

    const dots = dhOppG.querySelectorAll('.map-opponent');
    const playerDot = document.getElementById('dhMapPlayer');
    if (!playerDot || dots.length === 0) return;

    const px = +playerDot.getAttribute('cx') || 50;
    const py = +playerDot.getAttribute('cy') || 50;

    // O(n) two-pass: find closest and second-closest dots to player
    // (avoids allocating an array + sorting every call)
    let closest = null, closestDist = Infinity;
    let second = null, secondDist = Infinity;

    for (let i = 0; i < dots.length; i++) {
      const dot = dots[i];
      const dx = (+dot.getAttribute('cx') || 0) - px;
      const dy = (+dot.getAttribute('cy') || 0) - py;
      const dist = dx * dx + dy * dy;

      // Reset threat styling
      dot.classList.remove('ic-map-watch', 'ic-map-caution', 'ic-map-danger');
      dot.removeAttribute('data-threat');

      if (dist < closestDist) {
        second = closest; secondDist = closestDist;
        closest = dot;    closestDist = dist;
      } else if (dist < secondDist) {
        second = dot;     secondDist = dist;
      }
    }

    // The closest dot is likely the nearest-ahead or nearest-behind
    // Apply threat coloring to the 2 closest dots if their drivers are flagged
    if (closest && (aheadThreat || behindThreat)) {
      const highestThreat = (aheadThreat && behindThreat)
        ? (aheadThreat.Level >= behindThreat.Level ? aheadThreat : behindThreat)
        : (aheadThreat || behindThreat);

      const cls = THREAT_CLASSES[highestThreat.Level];
      if (cls) {
        closest.classList.add('ic-map-' + cls.replace('ic-', ''));
        closest.setAttribute('data-threat', highestThreat.Level);
      }
    }

    if (second) {
      const secondThreat = aheadThreat && behindThreat
        ? (aheadThreat.Level < behindThreat.Level ? aheadThreat : behindThreat)
        : null;
      if (secondThreat) {
        const cls = THREAT_CLASSES[secondThreat.Level];
        if (cls) {
          second.classList.add('ic-map-' + cls.replace('ic-', ''));
          second.setAttribute('data-threat', secondThreat.Level);
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  PHASE 5: INCIDENT FLASH OVERLAY
  // ═══════════════════════════════════════════════════════════════
  // Brief directional flash when contact is detected.
  // Direction inferred from lateral/longitudinal G at impact.

  function _triggerIncidentFlash(p) {
    // Get physics data at moment of incident
    const dsPre = 'RaceCorProDrive.Plugin.DS.';
    const latG = +(p[dsPre + 'LatAccel']) || 0;
    const longG = +(p[dsPre + 'LongAccel']) || 0;

    // Determine flash direction
    let direction = 'ic-flash-all';  // default: all edges
    if (Math.abs(latG) > Math.abs(longG)) {
      direction = latG > 0 ? 'ic-flash-right' : 'ic-flash-left';
    } else if (Math.abs(longG) > 0.3) {
      direction = longG < 0 ? 'ic-flash-rear' : 'ic-flash-front';
    }

    // Create flash element
    let flash = document.getElementById('incidentFlash');
    if (!flash) {
      flash = document.createElement('div');
      flash.id = 'incidentFlash';
      flash.className = 'ic-incident-flash';
      document.body.appendChild(flash);
    }

    // Reset animation
    flash.classList.remove('ic-flash-left', 'ic-flash-right', 'ic-flash-rear',
                           'ic-flash-front', 'ic-flash-all', 'ic-flash-active');
    void flash.offsetWidth; // Force reflow
    flash.classList.add(direction, 'ic-flash-active');

    // Auto-remove after animation
    setTimeout(() => {
      flash.classList.remove('ic-flash-active');
    }, 600);
  }

  // ═══════════════════════════════════════════════════════════════
  //  PHASE 4: POST-SESSION BEHAVIOR REPORT
  // ═══════════════════════════════════════════════════════════════
  // Renders behavior metrics into the race-results screen.
  // Called from race-results.js via window.renderBehaviorReport().

  window.renderBehaviorReport = function(p) {
    const section = document.getElementById('rrBehaviorSection');
    if (!section) return;

    // Only show if incident coach was active and had data
    if (!_ic.active && _ic.threats.length === 0) {
      section.style.display = 'none';
      return;
    }

    section.style.display = '';

    // ── Behavior score (composure-weighted) ──────────────────────
    const b = _ic.behavior;
    if (!b) return;

    // Composure score: 100 minus penalties
    let composure = 100;
    composure -= Math.min(30, (b.RageSpikes || 0) * 10);
    composure -= Math.min(20, (b.RetaliationAttempts || 0) * 15);
    composure -= Math.min(20, Math.floor((b.TailgatingSeconds || 0) / 10) * 5);
    composure -= Math.min(15, (b.CooldownsTriggered || 0) * 5);
    composure = Math.max(0, composure);

    // Consistency score
    const cleanPct = b.TotalLaps > 0 ? ((b.CleanLaps || 0) / b.TotalLaps) * 100 : 100;

    const scoreEl = document.getElementById('rrBehaviorScore');
    if (scoreEl) {
      scoreEl.textContent = composure;
      scoreEl.style.color = composure >= 70 ? '#43a047' :
                            composure >= 40 ? '#ff9800' : '#e53935';
    }

    // ── Breakdown grid ───────────────────────────────────────────
    const breakdownEl = document.getElementById('rrBehaviorBreakdown');
    if (breakdownEl) {
      breakdownEl.innerHTML =
        '<div class="rr-behavior-stat">' +
          '<div class="rr-bstat-val">' + (b.RageSpikes || 0) + '</div>' +
          '<div class="rr-bstat-label">Rage Spikes</div>' +
        '</div>' +
        '<div class="rr-behavior-stat">' +
          '<div class="rr-bstat-val">' + (b.CooldownsTriggered || 0) + '</div>' +
          '<div class="rr-bstat-label">Cool-Downs</div>' +
        '</div>' +
        '<div class="rr-behavior-stat">' +
          '<div class="rr-bstat-val">' + (b.RetaliationAttempts || 0) + '</div>' +
          '<div class="rr-bstat-label">Retaliation Attempts</div>' +
        '</div>' +
        '<div class="rr-behavior-stat">' +
          '<div class="rr-bstat-val">' + Math.round(cleanPct) + '%</div>' +
          '<div class="rr-bstat-label">Clean Laps</div>' +
        '</div>' +
        '<div class="rr-behavior-stat">' +
          '<div class="rr-bstat-val">' + Math.round(b.TailgatingSeconds || 0) + 's</div>' +
          '<div class="rr-bstat-label">Tailgating</div>' +
        '</div>' +
        '<div class="rr-behavior-stat">' +
          '<div class="rr-bstat-val">' + (b.HardBrakingEvents || 0) + '</div>' +
          '<div class="rr-bstat-label">Hard Braking</div>' +
        '</div>';
    }

    // ── Insights ─────────────────────────────────────────────────
    const insightsEl = document.getElementById('rrBehaviorInsights');
    if (insightsEl) {
      const insights = [];

      if ((b.RageSpikes || 0) === 0) {
        insights.push('No rage spikes this session. Excellent composure.');
      } else if ((b.RetaliationAttempts || 0) === 0) {
        insights.push('You had ' + b.RageSpikes + ' rage spike(s) but zero retaliation attempts. Strong self-control.');
      } else {
        insights.push(b.RetaliationAttempts + ' retaliation attempt(s) detected. Consider the manual cool-down button next time.');
      }

      if (cleanPct >= 80) {
        insights.push(Math.round(cleanPct) + '% clean laps — consistent, disciplined driving.');
      } else if (cleanPct >= 50) {
        insights.push('Clean lap rate dropped to ' + Math.round(cleanPct) + '%. Incidents disrupted your rhythm.');
      }

      if ((b.TailgatingSeconds || 0) > 30) {
        insights.push('Spent ' + Math.round(b.TailgatingSeconds) + 's tailgating. Build bigger gaps post-incident.');
      }

      const avgRecovery = b.RageRecoveryCount > 0
        ? (b.TotalRageRecoverySeconds / b.RageRecoveryCount).toFixed(0)
        : null;
      if (avgRecovery) {
        insights.push('Average rage recovery: ' + avgRecovery + 's. ' +
          (+avgRecovery < 15 ? 'Quick recovery.' : 'Try the 4-7-8 breathing technique.'));
      }

      insightsEl.innerHTML = insights.map(i =>
        '<div class="rr-behavior-insight">' + i + '</div>'
      ).join('');
    }

    // ── Flagged drivers summary ──────────────────────────────────
    const driversEl = document.getElementById('rrBehaviorDrivers');
    if (driversEl && _ic.threats.length > 0) {
      driversEl.innerHTML = '<div class="rr-behavior-drivers-title">Flagged Drivers</div>' +
        _ic.threats.map(t =>
          '<div class="rr-behavior-driver ' + (THREAT_CLASSES[t.Level] || '') + '">' +
            '<span class="rr-bd-name">' + (t.Name || '?') + '</span>' +
            '<span class="rr-bd-ir">' + (t.IRating || '—') + ' iR</span>' +
            '<span class="rr-bd-count">' + t.IncidentCount + ' incident(s)</span>' +
            '<span class="rr-bd-level">' + (THREAT_LABELS[t.Level] || '') + '</span>' +
          '</div>'
        ).join('');
    } else if (driversEl) {
      driversEl.innerHTML = '';
    }
  };
