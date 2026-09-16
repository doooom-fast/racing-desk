// Race end screen

  // ═══════════════════════════════════════════════════════════════
  //  RACE END SCREEN
  // ═══════════════════════════════════════════════════════════════

  function _fmtLapTime(seconds) {
    if (!seconds || seconds <= 0 || !isFinite(seconds)) return '—';
    const m = Math.floor(seconds / 60);
    const s = seconds - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(3);
  }
  function _fmtIR(ir) {
    if (!ir || ir <= 0) return '—';
    return ir >= 1000 ? (ir / 1000).toFixed(1) + 'k' : String(ir);
  }

  function showRaceEnd(p, isDemo) {
    const screen = document.getElementById('raceEndScreen');
    if (!screen || _raceEndVisible) return;

    // Gather data
    const pre = isDemo ? 'RaceCorProDrive.Plugin.Demo.' : '';
    const pos = isDemo ? +(p['RaceCorProDrive.Plugin.Demo.Position']) || 0 : +(p['DataCorePlugin.GameData.Position']) || 0;
    const dsPre = isDemo ? 'RaceCorProDrive.Plugin.Demo.DS.' : 'RaceCorProDrive.Plugin.DS.';
    const incidents = +(p[dsPre + 'IncidentCount']) || 0;
    const completedLaps = +(p[dsPre + 'CompletedLaps']) || 0;
    const totalLaps = isDemo ? +(p['RaceCorProDrive.Plugin.Demo.TotalLaps']) || 0 : +(p['DataCorePlugin.GameData.TotalLaps']) || 0;
    const bestLap = isDemo ? +(p['RaceCorProDrive.Plugin.Demo.BestLapTime']) || 0 : +(p['DataCorePlugin.GameData.BestLapTime']) || 0;
    const iRating = isDemo ? +(p['RaceCorProDrive.Plugin.Demo.IRating']) || 0 : +(p['IRacingExtraProperties.iRacing_DriverInfo_IRating']) || 0;

    // DNF detection
    const isDNF = pos === 0 || (completedLaps > 0 && totalLaps > 0 && completedLaps < Math.max(1, Math.floor(totalLaps * 0.5)));

    // Finish type
    let finishType;
    if (isDNF) finishType = 'dnf';
    else if (pos >= 1 && pos <= 3) finishType = 'podium';
    else if (pos >= 4 && pos <= 10) finishType = 'strong';
    else finishType = 'midpack';

    // Title / subtitle / tint
    let title, subtitle = null, tint;
    if (isDNF) {
      title = 'TOUGH BREAK'; subtitle = 'Every lap is a lesson. Regroup and go again.'; tint = 'purple';
    } else if (finishType === 'podium') {
      title = pos === 1 ? 'VICTORY!' : 'PODIUM FINISH!';
      tint = pos === 1 ? 'gold' : pos === 2 ? 'silver' : 'bronze';
    } else if (finishType === 'strong') {
      title = 'STRONG FINISH'; tint = 'green';
    } else {
      title = 'RACE COMPLETE'; tint = 'neutral';
    }

    // Position the race end screen over the HUD bounds
    const dash = document.getElementById('dashboard');
    if (dash) {
      const r = dash.getBoundingClientRect();
      screen.style.top = Math.max(0, r.top - 12) + 'px';
      screen.style.left = Math.max(0, r.left - 12) + 'px';
      screen.style.width = (r.width + 24) + 'px';
      screen.style.height = (r.height + 24) + 'px';
    } else {
      screen.style.top = '10px'; screen.style.right = '10px';
      screen.style.width = '500px'; screen.style.height = '260px';
    }

    // Remove old tint classes
    screen.className = 'race-end-screen re-visible re-tint-' + tint;

    // Populate content
    const posEl = document.getElementById('rePosition');
    const titleEl = document.getElementById('reTitle');
    const subEl = document.getElementById('reSubtitle');
    const cleanEl = document.getElementById('reCleanBadge');
    const statPos = document.getElementById('reStatPos');
    const statInc = document.getElementById('reStatInc');
    const statLap = document.getElementById('reStatLap');
    const statIR = document.getElementById('reStatIR');

    if (posEl) posEl.textContent = !isDNF && pos > 0 ? 'P' + pos : '—';
    if (titleEl) titleEl.textContent = title;
    if (subEl) { subEl.textContent = subtitle || ''; subEl.style.display = subtitle ? '' : 'none'; }
    if (cleanEl) cleanEl.style.display = incidents <= 4 ? '' : 'none';
    if (statPos) statPos.textContent = !isDNF && pos > 0 ? 'P' + pos : 'DNF';
    if (statInc) statInc.textContent = incidents;
    if (statLap) statLap.textContent = _fmtLapTime(bestLap);
    if (statIR) statIR.textContent = _fmtIR(iRating);

    // Confetti for podium
    const confetti = document.getElementById('reConfetti');
    if (confetti) {
      confetti.innerHTML = '';
      if (finishType === 'podium') {
        for (let i = 0; i < 14; i++) {
          const dot = document.createElement('div');
          dot.className = 're-confetti-dot';
          dot.style.left = (5 + i * 6.8) + '%';
          dot.style.animationDelay = (i * 0.12) + 's';
          dot.style.animationDuration = (2.5 + Math.random() * 2) + 's';
          confetti.appendChild(dot);
        }
      }
    }

    _raceEndVisible = true;

    // Auto-hide after 30s
    if (_raceEndTimer) clearTimeout(_raceEndTimer);
    _raceEndTimer = setTimeout(hideRaceEnd, 30000);
  }

  function hideRaceEnd() {
    const screen = document.getElementById('raceEndScreen');
    if (screen) screen.classList.remove('re-visible');
    _raceEndVisible = false;
    if (_raceEndTimer) { clearTimeout(_raceEndTimer); _raceEndTimer = null; }
  }

  // ══════════════════════════════════════════════════════════════════
