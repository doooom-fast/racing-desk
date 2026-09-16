// AI Race Coach — Anthropic API integration for post-race analysis
// Sends structured race data to Claude with configurable tone and depth

(function() {
  'use strict';

  // ═══════════════════════════════════════════════════════════════
  // TONE DEFINITIONS
  // ═══════════════════════════════════════════════════════════════

  var _tones = {
    broadcast: {
      label: 'Broadcast Commentator',
      instruction: 'You are an enthusiastic, dramatic motorsport commentator — think Martin Brundle or David Croft doing a post-race debrief on Sky F1. Use vivid language, exclamation marks where the moment deserves it, and build narrative tension around key battles and turning points. Reference specific laps and incidents with flair. Make the driver feel like their race was worth watching.'
    },
    coach: {
      label: 'Racing Engineer',
      instruction: 'You are a professional racing engineer debriefing your driver after a session. Be direct, analytical, and data-driven. Reference specific lap numbers, time deltas, and trends. Prioritize actionable feedback over praise. Use precise language — "your entry speed into T4 is costing you 0.3s" rather than "you could be faster in the corners." Treat the driver as a peer who wants to improve.'
    },
    mentor: {
      label: 'Friendly Mentor',
      instruction: 'You are an experienced sim racer mentoring a newer driver. Be encouraging and approachable — celebrate what went well before addressing areas for growth. Frame suggestions positively ("try braking 5m later" rather than "you\'re braking too early"). Use casual language and explain the reasoning behind your advice so the driver learns the "why," not just the "what."'
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // DEPTH PROFILES
  // ═══════════════════════════════════════════════════════════════

  var _depths = {
    quick: {
      label: 'Quick (~$0.01)',
      model: 'claude-haiku-4-5-20251001',
      maxTokens: 350,
      instruction: 'Keep your analysis concise. Provide a 2-sentence summary and 1-2 key takeaways. No section headers needed — just a tight, useful paragraph.'
    },
    standard: {
      label: 'Standard (~$0.05)',
      model: 'claude-sonnet-4-6',
      maxTokens: 800,
      instruction: 'Provide a structured analysis with the sections defined below. Each section should be 2-4 sentences. Focus on the most impactful observations.'
    },
    deep: {
      label: 'Deep Dive (~$0.15)',
      model: 'claude-sonnet-4-6',
      maxTokens: 1500,
      instruction: 'Provide a thorough, detailed analysis. Go deep on lap-by-lap trends, identify micro-patterns (e.g., pace drop after incidents, tyre deg curve shape), and give specific corner-level advice where the data supports it. Include a strategy recommendation for the next race.'
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // SYSTEM PROMPT
  // ═══════════════════════════════════════════════════════════════

  function _buildSystemPrompt(tone, depth) {
    var toneConfig = _tones[tone] || _tones.coach;
    var depthConfig = _depths[depth] || _depths.standard;

    return [
      '# AI Race Coach',
      '',
      '## Your Role',
      toneConfig.instruction,
      '',
      '## Analysis Depth',
      depthConfig.instruction,
      '',
      '## Context',
      'You are analyzing a sim racing session (iRacing, Assetto Corsa Competizione, or similar).',
      'The driver uses a broadcast overlay called RaceCor by K10 Motorsports.',
      'Your analysis will be displayed directly in the post-race results screen,',
      'so format it for on-screen reading — short paragraphs, no markdown headers.',
      '',
      '## Race Data Schema',
      'You receive a JSON object with:',
      '- position: Final finish position (integer, 0 = DNF)',
      '- trackName: Circuit name',
      '- carModel: Vehicle',
      '- totalLaps: Total laps in the race',
      '- currentLap: Laps completed by the driver',
      '- lapTimes: Array of lap times in seconds (one per completed lap)',
      '- bestLapTime: Best lap time in seconds',
      '- positions: Array of position at end of each lap',
      '- incidents: Total incident count',
      '- iRatingDelta: Estimated iRating change (positive = gained)',
      '- fuelLevels: Array of fuel remaining per lap',
      '- tyreTempAvg: Array of average tyre temps (°C) per lap',
      '- commentaryLog: Array of key moments [{lap, title, text, topicId}]',
      '',
      '## Output Format',
      'Respond with a JSON object. Do not include any text outside the JSON.',
      '',
      depth === 'quick' ? [
        '{',
        '  "summary": "Brief 2-sentence race summary with the key takeaway."',
        '}'
      ].join('\n') : [
        '{',
        '  "summary": "2-3 sentence race overview capturing the story of the race.",',
        '  "paceAnalysis": "Analysis of lap time consistency, best/worst laps, and trends across stints.",',
        '  "keyMoments": "Commentary on the most significant events — battles, incidents, personal bests, pit strategy.",',
        '  "improvements": ["Specific actionable tip 1", "Specific actionable tip 2"' + (depth === 'deep' ? ', "Tip 3"' : '') + '],',
        '  "nextFocus": "The single most important thing to work on in the next session."',
        depth === 'deep' ? '  ,"strategyNote": "Tactical recommendation for the next race at this track/car combo."' : '',
        '}'
      ].join('\n'),
      '',
      '## Important',
      '- Reference specific lap numbers and data from the input — don\'t be generic.',
      '- If the data shows incidents, address them directly.',
      '- Acknowledge what went well before focusing on improvements.',
      '- Keep each field as a single string (no nested objects or arrays except improvements).',
      '- If lap times are all identical or suspiciously uniform, the data may be from demo mode — still provide a realistic-sounding analysis.'
    ].join('\n');
  }

  // ═══════════════════════════════════════════════════════════════
  // DATA PACKAGING
  // ═══════════════════════════════════════════════════════════════

  function _packageRaceData(raceData, commentaryLog, p, isDemo) {
    var pre = isDemo ? 'RaceCorProDrive.Plugin.Demo.' : '';
    var dsPre = isDemo ? 'RaceCorProDrive.Plugin.Demo.DS.' : 'RaceCorProDrive.Plugin.DS.';

    return {
      position: isDemo ? +(p[pre + 'Position']) || 0 : +(p['DataCorePlugin.GameData.Position']) || 0,
      trackName: isDemo ? (p[pre + 'TrackName'] || 'Unknown Track') : (p['DataCorePlugin.GameData.TrackName'] || 'Unknown Track'),
      carModel: isDemo ? (p[pre + 'CarModel'] || 'Unknown Car') : (p['DataCorePlugin.GameData.CarModel'] || 'Unknown Car'),
      totalLaps: isDemo ? +(p[pre + 'TotalLaps']) || 0 : +(p['DataCorePlugin.GameData.TotalLaps']) || 0,
      currentLap: isDemo ? +(p[pre + 'CurrentLap']) || 0 : +(p['DataCorePlugin.GameData.CurrentLap']) || 0,
      bestLapTime: isDemo ? +(p[pre + 'BestLapTime']) || 0 : +(p['DataCorePlugin.GameData.BestLapTime']) || 0,
      lapTimes: raceData.lapTimes || [],
      positions: raceData.positions || [],
      incidents: +(p[dsPre + 'IncidentCount']) || 0,
      iRatingDelta: +(p[dsPre + 'EstimatedIRatingDelta']) || 0,
      fuelLevels: raceData.fuel || [],
      tyreTempAvg: raceData.tyreTempAvg || [],
      commentaryLog: (commentaryLog || []).map(function(c) {
        return { lap: c.lap, title: c.title, text: c.text, topicId: c.topicId };
      })
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // API CALL
  // ═══════════════════════════════════════════════════════════════

  function _callAnthropicAPI(apiKey, systemPrompt, raceDataJSON, depth) {
    var depthConfig = _depths[depth] || _depths.standard;

    return fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: depthConfig.model,
        max_tokens: depthConfig.maxTokens,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: 'Analyze this race:\n\n' + raceDataJSON
        }]
      })
    })
    .then(function(response) {
      if (!response.ok) {
        return response.text().then(function(text) {
          throw new Error('API error (' + response.status + '): ' + text);
        });
      }
      return response.json();
    })
    .then(function(data) {
      if (!data.content || !data.content[0] || !data.content[0].text) {
        throw new Error('Unexpected API response structure');
      }
      // Parse the JSON response from Claude
      var rawText = data.content[0].text.trim();
      // Strip markdown code fences if present
      if (rawText.startsWith('```')) {
        rawText = rawText.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      }
      return JSON.parse(rawText);
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // RENDER ANALYSIS
  // ═══════════════════════════════════════════════════════════════

  function _renderAnalysis(resultEl, analysis, depth) {
    if (!resultEl) return;

    var html = '';

    // Summary (always present)
    if (analysis.summary) {
      html += '<div class="rr-ai-section">';
      html += '<div class="rr-ai-section-label">Race Summary</div>';
      html += '<div class="rr-ai-section-text">' + _escapeHtml(analysis.summary) + '</div>';
      html += '</div>';
    }

    // Pace analysis (standard + deep)
    if (analysis.paceAnalysis) {
      html += '<div class="rr-ai-section">';
      html += '<div class="rr-ai-section-label">Pace Analysis</div>';
      html += '<div class="rr-ai-section-text">' + _escapeHtml(analysis.paceAnalysis) + '</div>';
      html += '</div>';
    }

    // Key moments (standard + deep)
    if (analysis.keyMoments) {
      html += '<div class="rr-ai-section">';
      html += '<div class="rr-ai-section-label">Key Moments</div>';
      html += '<div class="rr-ai-section-text">' + _escapeHtml(analysis.keyMoments) + '</div>';
      html += '</div>';
    }

    // Improvements
    if (analysis.improvements && analysis.improvements.length > 0) {
      html += '<div class="rr-ai-section">';
      html += '<div class="rr-ai-section-label">Areas for Improvement</div>';
      html += '<div class="rr-ai-tips">';
      analysis.improvements.forEach(function(tip) {
        html += '<div class="rr-ai-tip-item">→ ' + _escapeHtml(tip) + '</div>';
      });
      html += '</div>';
      html += '</div>';
    }

    // Next focus
    if (analysis.nextFocus) {
      html += '<div class="rr-ai-section rr-ai-focus">';
      html += '<div class="rr-ai-section-label">Next Session Focus</div>';
      html += '<div class="rr-ai-section-text">' + _escapeHtml(analysis.nextFocus) + '</div>';
      html += '</div>';
    }

    // Strategy note (deep only)
    if (analysis.strategyNote) {
      html += '<div class="rr-ai-section">';
      html += '<div class="rr-ai-section-label">Strategy Note</div>';
      html += '<div class="rr-ai-section-text">' + _escapeHtml(analysis.strategyNote) + '</div>';
      html += '</div>';
    }

    resultEl.innerHTML = html;
  }

  function _escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════

  /**
   * Generate AI race analysis.
   * Called when the user clicks "Generate AI Analysis" in the results screen.
   *
   * @param {Object} raceData   — accumulated race data (_raceData from race-results.js)
   * @param {Array}  commentaryLog — captured commentary entries
   * @param {Object} p          — current telemetry snapshot
   * @param {boolean} isDemo    — demo mode flag
   */
  window.generateRaceAnalysis = function(raceData, commentaryLog, p, isDemo) {
    var apiKey = _settings.agentKey;
    if (!apiKey) {
      console.warn('[RaceCoach] No API key configured');
      return;
    }

    var tone = _settings.coachTone || 'coach';
    var depth = _settings.coachDepth || 'standard';

    var resultEl = document.getElementById('rrAIResult');
    var btn = document.getElementById('rrAIBtn');

    // Show loading state
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Analyzing...';
    }
    if (resultEl) {
      resultEl.innerHTML = '<div class="rr-ai-loading"><div class="rr-ai-spinner"></div>Sending race data to AI coach...</div>';
    }

    // Build prompt and data
    var systemPrompt = _buildSystemPrompt(tone, depth);
    var raceDataObj = _packageRaceData(raceData, commentaryLog, p, isDemo);
    var raceDataJSON = JSON.stringify(raceDataObj, null, 2);

    console.log('[RaceCoach] Requesting analysis:', { tone: tone, depth: depth, model: (_depths[depth] || _depths.standard).model });

    _callAnthropicAPI(apiKey, systemPrompt, raceDataJSON, depth)
      .then(function(analysis) {
        console.log('[RaceCoach] Analysis received');
        _renderAnalysis(resultEl, analysis, depth);
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Regenerate Analysis';
        }
      })
      .catch(function(err) {
        console.error('[RaceCoach] Error:', err);
        if (resultEl) {
          resultEl.innerHTML = '<div class="rr-ai-error">Analysis failed: ' + _escapeHtml(err.message) + '</div>';
        }
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Retry Analysis';
        }
      });
  };

  // Expose tone and depth options for UI building
  window.getRaceCoachTones = function() { return _tones; };
  window.getRaceCoachDepths = function() { return _depths; };

  // Settings update helpers
  window.updateCoachTone = function(tone) {
    _settings.coachTone = tone || 'coach';
    saveSettings();
  };

  window.updateCoachDepth = function(depth) {
    _settings.coachDepth = depth || 'standard';
    saveSettings();
  };

})();
