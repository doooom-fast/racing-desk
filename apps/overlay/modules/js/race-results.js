// Post-Race Results Screen
// Displays race data, charts, key moments, and coaching suggestions after checkered flag

(function() {
  'use strict';

  // ═══════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════

  let _raceData = null;
  let _commentaryLog = [];
  let _currentLap = 0;
  let _prevCommentaryVis = 0;

  // ═══════════════════════════════════════════════════════════════
  // HELPER FUNCTIONS
  // ═══════════════════════════════════════════════════════════════

  function _formatTime(seconds) {
    if (!seconds || seconds <= 0 || !isFinite(seconds)) return '—';
    const m = Math.floor(seconds / 60);
    const s = seconds - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(3);
  }

  function _formatTimeShort(seconds) {
    if (!seconds || seconds <= 0 || !isFinite(seconds)) return '—';
    return seconds.toFixed(3);
  }

  function _getPositionColor(pos) {
    if (pos === 1) return '#ffd700';
    if (pos === 2) return '#c0c0c0';
    if (pos === 3) return '#cd7f32';
    if (pos >= 4 && pos <= 10) return '#43a047';
    return '#808080';
  }

  function _getPositionLabel(pos) {
    if (pos === 0) return 'DNF';
    const suffix = ['st', 'nd', 'rd'][pos - 1] || 'th';
    return pos + suffix;
  }

  // ═══════════════════════════════════════════════════════════════
  // DATA ACCUMULATION
  // ═══════════════════════════════════════════════════════════════

  window.accumulateRaceData = function(p, isDemo) {
    if (!_raceData) return; // Only accumulate if race is active

    const pre = isDemo ? 'RaceCorProDrive.Plugin.Demo.' : '';
    const dsPre = isDemo ? 'RaceCorProDrive.Plugin.Demo.DS.' : 'RaceCorProDrive.Plugin.DS.';

    const currentLap = isDemo ? +(p[pre + 'CurrentLap']) || 0 : +(p['DataCorePlugin.GameData.CurrentLap']) || 0;
    const position = isDemo ? +(p[pre + 'Position']) || 0 : +(p['DataCorePlugin.GameData.Position']) || 0;
    const incidents = +(p[dsPre + 'IncidentCount']) || 0;
    const fuel = isDemo ? +(p[pre + 'Fuel']) || 0 : +(p['DataCorePlugin.GameData.Fuel']) || 0;
    const lastLapTime = isDemo ? +(p[pre + 'LastLapTime']) || 0 : +(p['DataCorePlugin.GameData.LastLapTime']) || 0;

    // Detect lap change (store lap data when lap completes)
    if (currentLap > _currentLap && lastLapTime > 0) {
      _raceData.lapTimes.push(lastLapTime);
      _raceData.positions.push(position);
      _raceData.incidents.push(incidents);
      _raceData.fuel.push(fuel);

      // Average tyre temps (all 4 corners)
      const tyreTempFL = isDemo ? +(p[pre + 'TyreTempFL']) || 0 : +(p['DataCorePlugin.GameData.TyreTempFrontLeft']) || 0;
      const tyreTempFR = isDemo ? +(p[pre + 'TyreTempFR']) || 0 : +(p['DataCorePlugin.GameData.TyreTempFrontRight']) || 0;
      const tyreTempRL = isDemo ? +(p[pre + 'TyreTempRL']) || 0 : +(p['DataCorePlugin.GameData.TyreTempRearLeft']) || 0;
      const tyreTempRR = isDemo ? +(p[pre + 'TyreTempRR']) || 0 : +(p['DataCorePlugin.GameData.TyreTempRearRight']) || 0;
      const avgTyreTemp = (tyreTempFL + tyreTempFR + tyreTempRL + tyreTempRR) / 4;
      _raceData.tyreTempAvg.push(avgTyreTemp);

      _currentLap = currentLap;
    }

    // Commentary capture (when visibility goes 0→1)
    const commentaryVis = +(p['RaceCorProDrive.Plugin.CommentaryVisible']) || 0;
    if (commentaryVis === 1 && _prevCommentaryVis === 0) {
      const title = p['RaceCorProDrive.Plugin.CommentaryTopicTitle'] || '';
      const text = p['RaceCorProDrive.Plugin.CommentaryText'] || '';
      const topicId = p['RaceCorProDrive.Plugin.CommentaryTopicId'] || '';
      const sentiment = p['RaceCorProDrive.Plugin.CommentarySentimentColor'] || '';
      if (title && topicId) {
        _commentaryLog.push({
          lap: currentLap,
          title: title,
          text: text,
          topicId: topicId,
          sentimentHue: sentiment || '#666'
        });
      }
    }
    _prevCommentaryVis = commentaryVis;
  };

  window.resetRaceResults = function() {
    _raceData = null;
    _commentaryLog = [];
    _currentLap = 0;
  };

  // Call this at race start to begin accumulating
  function _startAccumulation() {
    _raceData = {
      lapTimes: [],
      positions: [],
      incidents: [],
      fuel: [],
      tyreTempAvg: []
    };
    _commentaryLog = [];
    _currentLap = 0;
  }

  // ═══════════════════════════════════════════════════════════════
  // CHART RENDERING
  // ═══════════════════════════════════════════════════════════════

  function _drawLapTimeChart(canvas, lapTimes) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.offsetWidth || 280;
    const h = canvas.offsetHeight || 180;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    const padding = 24;
    const chartW = w - padding * 2;
    const chartH = h - padding * 2;

    // Clear
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.fillRect(0, 0, w, h);

    if (!lapTimes || lapTimes.length === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '11px var(--ff-mono)';
      ctx.textAlign = 'center';
      ctx.fillText('No data', w / 2, h / 2);
      return;
    }

    const minTime = Math.min(...lapTimes);
    const maxTime = Math.max(...lapTimes);
    const avgTime = lapTimes.reduce((a, b) => a + b, 0) / lapTimes.length;
    const timeRange = maxTime - minTime || 1;

    // Grid lines and axis labels
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '9px var(--ff-mono)';
    ctx.textAlign = 'right';

    // Y-axis time labels
    for (let i = 0; i <= 3; i++) {
      const time = minTime + (timeRange / 3) * i;
      const y = h - padding - (i / 3) * chartH;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(w - padding, y);
      ctx.stroke();
      ctx.fillText(_formatTimeShort(time), padding - 8, y + 3);
    }

    // Plot lap times line
    ctx.strokeStyle = '#00acc1';
    ctx.lineWidth = 2;
    ctx.beginPath();

    lapTimes.forEach((time, idx) => {
      const x = padding + (idx / Math.max(1, lapTimes.length - 1)) * chartW;
      const y = h - padding - ((time - minTime) / timeRange) * chartH;

      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Highlight best lap
    const bestIdx = lapTimes.indexOf(minTime);
    if (bestIdx >= 0) {
      const x = padding + (bestIdx / Math.max(1, lapTimes.length - 1)) * chartW;
      const y = h - padding - ((minTime - minTime) / timeRange) * chartH;
      ctx.fillStyle = '#43a047';
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Average line (dashed)
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.setLineDash([4, 4]);
    const avgY = h - padding - ((avgTime - minTime) / timeRange) * chartH;
    ctx.beginPath();
    ctx.moveTo(padding, avgY);
    ctx.lineTo(w - padding, avgY);
    ctx.stroke();
    ctx.setLineDash([]);

    // X-axis labels
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    for (let i = 0; i < lapTimes.length; i += Math.max(1, Math.floor(lapTimes.length / 4))) {
      const x = padding + (i / Math.max(1, lapTimes.length - 1)) * chartW;
      ctx.fillText('L' + (i + 1), x, h - 8);
    }
  }

  function _drawPositionChart(canvas, positions, startPos) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.offsetWidth || 280;
    const h = canvas.offsetHeight || 180;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    const padding = 24;
    const chartW = w - padding * 2;
    const chartH = h - padding * 2;

    // Clear
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.fillRect(0, 0, w, h);

    if (!positions || positions.length === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '11px var(--ff-mono)';
      ctx.textAlign = 'center';
      ctx.fillText('No data', w / 2, h / 2);
      return;
    }

    const maxPos = Math.max(...positions, startPos);
    const posRange = maxPos || 1;

    // Grid lines (position levels)
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '9px var(--ff-mono)';
    ctx.textAlign = 'right';

    for (let p = 1; p <= Math.min(maxPos, 10); p++) {
      const y = h - padding - ((p - 1) / (posRange - 1 || 1)) * chartH;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(w - padding, y);
      ctx.stroke();
      ctx.fillText('P' + p, padding - 8, y + 3);
    }

    // Plot position changes
    ctx.lineWidth = 2;
    ctx.beginPath();

    positions.forEach((pos, idx) => {
      const x = padding + (idx / Math.max(1, positions.length - 1)) * chartW;
      const y = h - padding - ((pos - 1) / (posRange - 1 || 1)) * chartH;

      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Color segments by gain/loss
    for (let idx = 0; idx < positions.length - 1; idx++) {
      const x1 = padding + (idx / Math.max(1, positions.length - 1)) * chartW;
      const x2 = padding + ((idx + 1) / Math.max(1, positions.length - 1)) * chartW;
      const y1 = h - padding - ((positions[idx] - 1) / (posRange - 1 || 1)) * chartH;
      const y2 = h - padding - ((positions[idx + 1] - 1) / (posRange - 1 || 1)) * chartH;

      ctx.strokeStyle = positions[idx + 1] < positions[idx] ? '#43a047' : positions[idx + 1] > positions[idx] ? '#e53935' : 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // Start position dashed line
    if (startPos > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.setLineDash([4, 4]);
      const startY = h - padding - ((startPos - 1) / (posRange - 1 || 1)) * chartH;
      ctx.beginPath();
      ctx.moveTo(padding, startY);
      ctx.lineTo(w - padding, startY);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function _drawPerfChart(canvas, iRatingDelta, srDelta) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.offsetWidth || 280;
    const h = canvas.offsetHeight || 180;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.fillRect(0, 0, w, h);

    const centerY = h / 2;
    const centerX = w / 2;

    // Draw iRating and SR changes as bars
    const barW = 40;
    const barH = 60;
    const gap = 30;

    // iRating bar
    ctx.fillStyle = iRatingDelta >= 0 ? '#43a047' : '#e53935';
    const irBarH = Math.min(barH, Math.abs(iRatingDelta) / 100 * barH);
    ctx.fillRect(centerX - gap - barW / 2, centerY - irBarH / 2, barW, irBarH);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(centerX - gap - barW / 2, centerY - barH / 2, barW, barH);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = 'bold 14px var(--ff-mono)';
    ctx.textAlign = 'center';
    ctx.fillText((iRatingDelta >= 0 ? '+' : '') + Math.round(iRatingDelta), centerX - gap, centerY + 20);

    // SR bar
    ctx.fillStyle = srDelta >= 0 ? '#43a047' : '#e53935';
    const srBarH = Math.min(barH, Math.abs(srDelta) / 0.5 * barH);
    ctx.fillRect(centerX + gap - barW / 2, centerY - srBarH / 2, barW, srBarH);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(centerX + gap - barW / 2, centerY - barH / 2, barW, barH);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText((srDelta >= 0 ? '+' : '') + Math.abs(srDelta).toFixed(2), centerX + gap, centerY + 20);

    // Labels
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '10px var(--ff-mono)';
    ctx.fillText('iR', centerX - gap, h - 12);
    ctx.fillText('SR', centerX + gap, h - 12);
  }

  // ═══════════════════════════════════════════════════════════════
  // COACHING TIPS GENERATION
  // ═══════════════════════════════════════════════════════════════

  function _generateCoachingTips(raceData, incidents, position, iRatingDelta, srDelta) {
    const tips = [];

    // High incidents
    if (incidents > 4) {
      tips.push({
        icon: '⚠️',
        title: 'Clean Racing',
        text: 'You had ' + incidents + ' incidents. Focus on clean lines through heavy zones — brake 5m earlier into difficult corners.'
      });
    }

    // Lost positions late
    if (raceData.positions && raceData.positions.length > 0) {
      const midpoint = Math.floor(raceData.positions.length / 2);
      const midPos = raceData.positions[midpoint] || 0;
      const endPos = raceData.positions[raceData.positions.length - 1] || 0;
      if (endPos > midPos + 2) {
        tips.push({
          icon: '📉',
          title: 'Late-Race Pace',
          text: 'Your pace dropped in the final stint. Consider fuel-saving earlier to extend performance.'
        });
      }
    }

    // Tyre temperature
    if (raceData.tyreTempAvg && raceData.tyreTempAvg.length > 0) {
      const maxTyreTemp = Math.max(...raceData.tyreTempAvg);
      if (maxTyreTemp > 110) {
        tips.push({
          icon: '🔥',
          title: 'Tyre Management',
          text: 'Tyre temps peaked at ' + Math.round(maxTyreTemp) + '°C. Smoother inputs through high-speed corners will help.'
        });
      }
    }

    // iRating recovery
    if (iRatingDelta < -30) {
      tips.push({
        icon: '💪',
        title: 'Finishing Focus',
        text: 'Tough race. Focus on finishing clean — completing races is the fastest path to iRating recovery.'
      });
    }

    // Podium / Win
    if (position >= 1 && position <= 3) {
      const bestLap = raceData.lapTimes ? Math.min(...raceData.lapTimes) : 0;
      tips.push({
        icon: '🏆',
        title: 'Great Result!',
        text: 'Excellent finish. Your best lap was ' + _formatTime(bestLap) + ' — aim to hit that consistently.'
      });
    }

    // Clean + strong
    if (incidents <= 2 && position >= 4 && position <= 10) {
      tips.push({
        icon: '✓',
        title: 'Discipline + Pace',
        text: 'Clean race with a strong finish. You\'re ready to push harder on entry speed.'
      });
    }

    return tips.slice(0, 3); // Return top 3
  }

  // ═══════════════════════════════════════════════════════════════
  // RESULTS SCREEN DISPLAY
  // ═══════════════════════════════════════════════════════════════

  window.showRaceResults = function(p, isDemo) {
    if (!_raceData || _raceData.lapTimes.length === 0) {
      console.log('[RaceResults] No race data to display');
      return;
    }

    const screen = document.getElementById('raceResultsScreen');
    if (!screen) {
      console.warn('[RaceResults] Results screen DOM not found');
      return;
    }

    // Gather final data
    const pre = isDemo ? 'RaceCorProDrive.Plugin.Demo.' : '';
    const dsPre = isDemo ? 'RaceCorProDrive.Plugin.Demo.DS.' : 'RaceCorProDrive.Plugin.DS.';

    const position = isDemo ? +(p[pre + 'Position']) || 0 : +(p['DataCorePlugin.GameData.Position']) || 0;
    const trackName = isDemo ? (p[pre + 'TrackName'] || 'Track') : (p['DataCorePlugin.GameData.TrackName'] || 'Track');
    const carModel = isDemo ? (p[pre + 'CarModel'] || 'Car') : (p['DataCorePlugin.GameData.CarModel'] || 'Car');
    const totalLaps = isDemo ? +(p[pre + 'TotalLaps']) || 0 : +(p['DataCorePlugin.GameData.TotalLaps']) || 0;
    const currentLap = isDemo ? +(p[pre + 'CurrentLap']) || 0 : +(p['DataCorePlugin.GameData.CurrentLap']) || 0;
    const bestLap = isDemo ? +(p[pre + 'BestLapTime']) || 0 : +(p['DataCorePlugin.GameData.BestLapTime']) || 0;
    const incidents = +(p[dsPre + 'IncidentCount']) || 0;
    const iRatingDelta = +(p[dsPre + 'EstimatedIRatingDelta']) || 0;
    const srDelta = 0; // Not always available; would need additional props

    // Calculate total time
    let totalTime = 0;
    _raceData.lapTimes.forEach(t => totalTime += t);

    // Update DOM
    const posEl = document.getElementById('rrPosition');
    if (posEl) {
      posEl.textContent = _getPositionLabel(position);
      posEl.style.color = _getPositionColor(position);
    }

    const trackEl = document.getElementById('rrTrack');
    if (trackEl) trackEl.textContent = trackName;

    const metaEl = document.getElementById('rrMeta');
    if (metaEl) {
      metaEl.innerHTML = carModel + ' • ' + currentLap + '/' + totalLaps + ' laps • ' + _formatTime(totalTime);
    }

    const irDeltaEl = document.getElementById('rrIRDelta');
    if (irDeltaEl) {
      irDeltaEl.textContent = (iRatingDelta >= 0 ? '+' : '') + Math.round(iRatingDelta);
      irDeltaEl.style.color = iRatingDelta >= 0 ? '#43a047' : '#e53935';
    }

    // Draw charts
    const lapChart = document.getElementById('rrLapChart');
    if (lapChart) _drawLapTimeChart(lapChart, _raceData.lapTimes);

    const posChart = document.getElementById('rrPosChart');
    if (posChart) _drawPositionChart(posChart, _raceData.positions, position);

    const perfChart = document.getElementById('rrPerfChart');
    if (perfChart) _drawPerfChart(perfChart, iRatingDelta, srDelta);

    // Key moments (filter commentary)
    const momentsEl = document.getElementById('rrMoments');
    if (momentsEl) {
      const filteredMoments = _commentaryLog.filter(c =>
        ['position_gained', 'position_lost', 'incident_spike', 'personal_best', 'close_battle', 'pit_entry', 'spin_catch', 'off_track', 'wall_contact', 'qualifying_push'].includes(c.topicId)
      );
      const momentsHTML = filteredMoments.slice(0, 8).map(m =>
        '<div class="rr-moment" style="border-left-color:' + m.sentimentHue + ';">' +
        '<div class="rr-moment-lap">L' + m.lap + '</div>' +
        '<div class="rr-moment-content">' +
        '<div class="rr-moment-title">' + m.title + '</div>' +
        '<div class="rr-moment-text">' + m.text.substring(0, 50) + '...</div>' +
        '</div></div>'
      ).join('');
      momentsEl.innerHTML = momentsHTML || '<div style="color:rgba(255,255,255,0.3);text-align:center;padding:20px;">No key moments</div>';
    }

    // Coaching tips
    const tips = _generateCoachingTips(_raceData, incidents, position, iRatingDelta, srDelta);
    const tipsEl = document.getElementById('rrTips');
    if (tipsEl) {
      const tipsHTML = tips.map(t =>
        '<div class="rr-tip">' +
        '<div class="rr-tip-icon">' + t.icon + '</div>' +
        '<div class="rr-tip-content">' +
        '<div class="rr-tip-title">' + t.title + '</div>' +
        '<div class="rr-tip-text">' + t.text + '</div>' +
        '</div></div>'
      ).join('');
      tipsEl.innerHTML = tipsHTML;
    }

    // Behavior Report — wire up to incident-coach.js
    if (typeof window.renderBehaviorReport === 'function') {
      window.renderBehaviorReport(p);
    }

    // AI Analysis section — wire up to race-coach.js
    const aiSection = document.getElementById('rrAISection');
    const aiBtn = document.getElementById('rrAIBtn');
    if (aiSection && _settings.agentKey) {
      aiSection.style.display = '';
      if (aiBtn) {
        aiBtn.onclick = function() {
          if (typeof generateRaceAnalysis === 'function') {
            generateRaceAnalysis(_raceData, _commentaryLog, p, isDemo);
          } else {
            console.warn('[RaceResults] race-coach.js not loaded');
          }
        };
      }
      // Clear previous analysis
      const resultEl = document.getElementById('rrAIResult');
      if (resultEl) resultEl.innerHTML = '';
    } else if (aiSection) {
      aiSection.style.display = 'none';
    }

    // Show screen with animation
    screen.classList.add('rr-visible');
    screen.onclick = hideRaceResults;
    document.addEventListener('keydown', _handleResultsKeydown);
  };

  window.hideRaceResults = function() {
    const screen = document.getElementById('raceResultsScreen');
    if (screen) {
      screen.classList.remove('rr-visible');
      document.removeEventListener('keydown', _handleResultsKeydown);
    }
  };

  function _handleResultsKeydown(e) {
    if (e.key === 'Escape') hideRaceResults();
  }

  // ─── Initialize accumulation on session start ───
  // This should be called from poll-engine when session becomes active
  window.initRaceAccumulation = function() {
    _startAccumulation();
  };

})();
