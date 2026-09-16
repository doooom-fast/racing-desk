// Incidents module renderer

  // ═══════════════════════════════════════════════════════════════
  //  INCIDENTS MODULE RENDERER
  // ═══════════════════════════════════════════════════════════════
  function updateIncidents(p, isDemo) {
    const panel = document.getElementById('incidentsPanel');
    if (!panel || panel.classList.contains('section-hidden')) return;
    const pre = isDemo ? 'RaceCorProDrive.Plugin.Demo.DS.' : 'RaceCorProDrive.Plugin.DS.';
    const incidentCount = +(p[pre + 'IncidentCount']) || 0;

    const countEl = document.getElementById('incCount');
    if (!countEl) return;
    countEl.textContent = incidentCount;

    // Flash on increment
    if (_dsPrevIncidents >= 0 && incidentCount > _dsPrevIncidents) {
      countEl.classList.remove('inc-flash');
      void countEl.offsetWidth;
      countEl.classList.add('inc-flash');
    }
    _dsPrevIncidents = incidentCount;

    // Progressive color level: 0=green, 5=red
    // 0x=0, 1-2x=1, 3-4x=2, 5-6x=3, 7-9x=4, 10+=5
    let level;
    if (incidentCount === 0) level = 0;
    else if (incidentCount <= 2) level = 1;
    else if (incidentCount <= 4) level = 2;
    else if (incidentCount <= 6) level = 3;
    else if (incidentCount <= 9) level = 4;
    else level = 5;

    for (let i = 0; i <= 5; i++) panel.classList.toggle('inc-level-' + i, i === level);

    // Threshold counters — remaining incidents to penalty / DQ
    // Read from the iRacing SDK via the plugin (parsed from session YAML WeekendOptions).
    // Plugin sends IncidentLimitDQ (from SDK IncidentLimit) and IncidentLimitPenalty
    // (calculated at ~68% of DQ only when DQ >= 20, otherwise 0).
    //
    // Three display modes:
    //   1. Both penalty + DQ limits exist  → show penalty row, DQ row, both markers
    //   2. DQ only (penalty = 0)           → hide penalty row + marker, show DQ only
    //   3. No limits (both = 0)            → hide thresholds + progress bar entirely
    const sdkPen = +(p[pre + 'IncidentLimitPenalty']) || 0;
    const sdkDQ  = +(p[pre + 'IncidentLimitDQ']) || 0;

    // Check if we're in a non-race session (practice, qualifying, test, warmup)
    const isNonRaceSession = !!(+(p[pre + 'IsNonRaceSession']) || 0);

    // Determine effective limits: 0 means "no limit for this threshold"
    let penLimit, dqLimit;
    if (isNonRaceSession) {
      penLimit = 0;
      dqLimit = 0;
    } else {
      penLimit = sdkPen;
      dqLimit  = sdkDQ;
    }

    const hasPenalty = penLimit > 0;
    const hasDQ     = dqLimit > 0;
    const hasAnyLimit = hasPenalty || hasDQ;

    const toPen = hasPenalty ? Math.max(0, penLimit - incidentCount) : -1;
    const toDQ  = hasDQ     ? Math.max(0, dqLimit  - incidentCount) : -1;

    // ── Threshold rows visibility ──
    const thresholds = document.querySelector('#incidentsPanel .inc-thresholds');
    const progressEl = document.getElementById('incProgress');
    const penRow = document.getElementById('incToPen')?.closest('.inc-thresh-row');
    const dqRow  = document.getElementById('incToDQ')?.closest('.inc-thresh-row');

    if (thresholds) thresholds.style.display = hasAnyLimit ? '' : 'none';
    if (progressEl) progressEl.style.display = hasAnyLimit ? '' : 'none';
    if (penRow) penRow.style.display = hasPenalty ? '' : 'none';

    const penEl = document.getElementById('incToPen');
    const dqEl  = document.getElementById('incToDQ');
    if (penEl && hasPenalty) {
      penEl.textContent = toPen > 0 ? toPen : 'PENALTY';
      penEl.className = 'inc-thresh-val' + (toPen === 0 ? ' thresh-hit' : toPen <= 3 ? ' thresh-crit' : toPen <= 6 ? ' thresh-near' : '');
    }
    if (dqEl) {
      if (!hasDQ) {
        dqEl.textContent = '\u221E';
        dqEl.className = 'inc-thresh-val';
      } else {
        dqEl.textContent = toDQ > 0 ? toDQ : 'DQ';
        dqEl.className = 'inc-thresh-val' + (toDQ === 0 ? ' thresh-hit' : toDQ <= 3 ? ' thresh-crit' : toDQ <= 6 ? ' thresh-near' : '');
      }
    }

    // ── Progress bar: accrued fill + penalty / DQ markers ──
    const barFill = document.getElementById('incBarFill');
    const markerPen = document.getElementById('incMarkerPen');
    const markerDQ = document.getElementById('incMarkerDQ');
    if (barFill && markerPen && markerDQ) {
      if (!hasDQ) {
        // No DQ limit — hide the bar entirely
        barFill.style.width = '0%';
        markerPen.style.display = 'none';
        markerDQ.style.display = 'none';
      } else {
        // Bar represents 0 → dqLimit, fill shows accrued
        const fillPct = Math.min(100, (incidentCount / dqLimit) * 100);
        barFill.style.width = fillPct + '%';

        // Penalty marker — only if penalty threshold exists
        if (hasPenalty) {
          const penPct = Math.min(100, (penLimit / dqLimit) * 100);
          markerPen.style.left = penPct + '%';
          markerPen.style.display = 'block';
          markerPen.style.opacity = incidentCount >= penLimit ? '0.3' : '0.7';
        } else {
          markerPen.style.display = 'none';
        }

        // DQ marker is always at the end
        markerDQ.style.left = '100%';
        markerDQ.style.display = 'block';
      }
    }

    // ── WebGL fire effect at thresholds ──
    if (window.setIncidentsGL) {
      if (hasDQ && toDQ === 0) {
        window.setIncidentsGL('dq');
      } else if (hasPenalty && toPen === 0) {
        window.setIncidentsGL('penalty');
      } else {
        window.setIncidentsGL('');
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
