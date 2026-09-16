// Formation lap / grid start

  // ══════════════════════════════════════════════════════════════════
  //  FORMATION LAP / GRID START
  // ══════════════════════════════════════════════════════════════════

  // Country flag colors — loaded from images/flags/flags.json
  let _countryFlags = {};
  async function loadCountryFlags() {
    try {
      const resp = await fetch('images/flags/flags.json');
      if (resp.ok) _countryFlags = await resp.json();
    } catch (e) { console.warn('Failed to load country flags:', e); }
  }

  // Simulated green light holdover — when plugin doesn't send LightsPhase,
  // we generate a synthetic sequence and hold it for 3 seconds
  let _simLightsPhase = 0;
  let _simLightsTimer = null;

  function updateGrid(p, isDemo) {
    const pre = isDemo ? 'RaceCorProDrive.Plugin.Demo.Grid.' : 'RaceCorProDrive.Plugin.Grid.';
    const sessionState = +(p[pre + 'SessionState']) || 0;
    const griddedCars  = +(p[pre + 'GriddedCars']) || 0;
    const totalCars    = +(p[pre + 'TotalCars']) || 0;
    const paceMode     = +(p[pre + 'PaceMode']) || 0;
    let lightsPhase    = +(p[pre + 'LightsPhase']) || 0;
    const startType    = (p[pre + 'StartType'] || 'rolling').toLowerCase();
    const isRolling    = startType === 'rolling';

    // Detect qualifying — no start lights needed (SessionMode: 2=Qualifying)
    const sessionModePre = isDemo ? 'RaceCorProDrive.Plugin.Demo.SessionMode' : 'RaceCorProDrive.Plugin.DS.SessionMode';
    const isQuali = +(p[sessionModePre]) === 2;

    const mod  = document.getElementById('gridModule');
    const info = document.getElementById('gridInfo');
    const lights = document.getElementById('startLights');
    if (!mod || !info || !lights) return;

    // Detect transition from ParadeLaps (3) to Racing (4): this is when lights should show.
    // If plugin doesn't send LightsPhase, we generate a synthetic green sequence
    // and hold it for 3 seconds so it's actually visible.
    const transitioningToRace = _gridPrevSessionState >= 1 && _gridPrevSessionState <= 3 && sessionState === 4;
    if (transitioningToRace && lightsPhase === 0 && _simLightsPhase === 0 && !isQuali) {
      _simLightsPhase = 7;
      clearTimeout(_simLightsTimer);
      _simLightsTimer = setTimeout(() => { _simLightsPhase = 0; }, 3000);
    }
    // Use synthetic phase when plugin isn't sending one
    if (lightsPhase === 0 && _simLightsPhase > 0) lightsPhase = _simLightsPhase;

    // SessionState 3 = ParadeLaps (formation), or lights sequence active
    // Phase 8 = post-green holdover — keep module visible while it fades naturally
    const isFormation = sessionState === 3 || sessionState === 2 || sessionState === 1;
    const isLightsActive = lightsPhase >= 1 && lightsPhase <= 8;
    const shouldShow = isFormation || isLightsActive;

    // Detect transition: was showing → no longer showing → start fadeout
    // But extend the fade window if we just transitioned to Racing (lights sequence might still play)
    if (!shouldShow && _gridActive) {
      mod.classList.remove('grid-visible');
      mod.classList.add('grid-fadeout');
      document.body.classList.remove('grid-active');
      _gridActive = false;
      if (window.setGridFlagGL) window.setGridFlagGL(false);
      clearTimeout(_gridFadeTimer);
      // Extend fade timer from 4s to 6s to allow lights to fully display during race start transition
      const fadeDelay = transitioningToRace ? 6000 : 4000;
      _gridFadeTimer = setTimeout(() => {
        mod.classList.remove('grid-fadeout');
        // Reset lights
        resetLightBulbs();
        const flagElReset = document.getElementById('gridFlag');
        if (flagElReset) flagElReset.classList.remove('flag-active');
      }, fadeDelay);
      return;
    }

    if (!shouldShow) return;

    // Show the module
    if (!_gridActive) {
      clearTimeout(_gridFadeTimer);
      mod.classList.remove('grid-fadeout');
      mod.classList.add('grid-visible');
      // Rolling starts: don't dim the dashboard during formation — driver needs instruments.
      // Only dim for standing starts or when the lights sequence is actively playing.
      if (!isRolling || isLightsActive) {
        document.body.classList.add('grid-active');
      }
      _gridActive = true;
      if (window.setGridFlagGL) window.setGridFlagGL(true);
    }
    // If we're in a rolling formation and lights just started, apply dim now
    if (isRolling && isLightsActive) {
      document.body.classList.add('grid-active');
    }
    // If rolling formation without lights, ensure dashboard stays at 100%
    if (isRolling && !isLightsActive && isFormation) {
      document.body.classList.remove('grid-active');
    }

    // Toggle between info card and lights
    if (isLightsActive) {
      info.classList.add('info-hidden');
      lights.classList.add('lights-active');
      updateStartLights(lightsPhase);
      // Hide flag during lights
      const flagElLights = document.getElementById('gridFlag');
      if (flagElLights) flagElLights.classList.remove('flag-active');
    } else {
      info.classList.remove('info-hidden');
      lights.classList.remove('lights-active');
      resetLightBulbs();

      // Update info card
      document.getElementById('gridCarsGridded').textContent = griddedCars;
      document.getElementById('gridCarsTotal').textContent = totalCars;

      // Mini grid strip — one dot per car, player highlighted in blue
      const playerPos = isDemo
        ? (+(p['RaceCorProDrive.Plugin.Demo.Position']) || 0)
        : (+(p['DataCorePlugin.GameData.Position']) || 0);
      _renderGridStrip(totalCars, griddedCars, playerPos);

      const stEl = document.getElementById('gridStartType');
      stEl.textContent = startType === 'standing' ? 'Standing Start' : 'Rolling Start';
      stEl.className = 'grid-start-type ' + startType;

      // Country flag background + WebGL glow colors
      const countryCode = (p[pre + 'TrackCountry'] || '').toUpperCase();
      const flagEl = document.getElementById('gridFlag');
      const flagColors = _countryFlags[countryCode];
      if (flagEl && flagColors) {
        document.getElementById('flagStripe1').style.background = flagColors[0];
        document.getElementById('flagStripe2').style.background = flagColors[1];
        document.getElementById('flagStripe3').style.background = flagColors[2];
        flagEl.classList.add('flag-active');
        if (window.setGridFlagColors) {
          window.setGridFlagColors(flagColors[0], flagColors[1], flagColors[2]);
        }
      } else if (flagEl) {
        flagEl.classList.remove('flag-active');
      }

      // Countdown: display time to green or pace mode
      const countdownEl = document.getElementById('gridCountdown');
      const timeToGreen = isDemo
        ? +(p['RaceCorProDrive.Plugin.Demo.Grid.TimeToGreen']) || 0
        : +(p['RaceCorProDrive.Plugin.Grid.TimeToGreen']) || 0;

      // During lights sequence (paceMode 1-3), show pace mode status
      // Otherwise, show countdown timer if available
      if (paceMode === 1) {
        countdownEl.textContent = 'GRID';
      } else if (paceMode === 2) {
        countdownEl.textContent = 'PACE';
      } else if (paceMode === 3) {
        countdownEl.textContent = 'READY';
      } else if (timeToGreen > 0) {
        // Show MM:SS countdown
        const minutes = Math.floor(timeToGreen / 60);
        const seconds = Math.floor(timeToGreen % 60);
        countdownEl.textContent = minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
      } else if (sessionState === 1) {
        countdownEl.textContent = 'PIT';
      } else if (sessionState === 2) {
        countdownEl.textContent = 'WARM';
      } else {
        countdownEl.textContent = 'FORM';
      }

      // Title reflects state
      const titleEl = mod.querySelector('.grid-title');
      if (sessionState === 1) titleEl.textContent = 'Get In Car';
      else if (sessionState === 2) titleEl.textContent = 'Warm Up';
      else titleEl.textContent = 'Formation Lap';
    }

    _gridPrevSessionState = sessionState;
    _gridLightsPhase = lightsPhase;
  }

  // ── Mini grid strip: one dot per grid slot, player highlighted ──
  let _gridStripLastHtml = '';
  function _renderGridStrip(total, gridded, playerPos) {
    const container = document.getElementById('gridStrip');
    if (!container) return;
    if (total <= 0) { container.innerHTML = ''; _gridStripLastHtml = ''; return; }

    // Build dots — only rebuild DOM when content changes
    let html = '';
    for (let i = 1; i <= total; i++) {
      const isPlayer = (i === playerPos);
      const isGridded = (i <= gridded);
      let cls = 'grid-dot';
      if (isPlayer) cls += ' player';
      else if (isGridded) cls += ' gridded';
      html += '<div class="' + cls + '"></div>';
    }
    if (html !== _gridStripLastHtml) {
      container.innerHTML = html;
      _gridStripLastHtml = html;
    }
  }

  function updateStartLights(phase) {
    // phase: 1-5 = red lights building (one column per phase)
    //         6  = all red (hold)
    //         7  = green (GO!)
    const cols = [
      ['light1t', 'light1b'],
      ['light2t', 'light2b'],
      ['light3t', 'light3b'],
      ['light4t', 'light4b'],
      ['light5t', 'light5b']
    ];

    if (phase >= 1 && phase <= 5) {
      // Light columns 1..phase are red
      for (let i = 0; i < 5; i++) {
        const cls = i < phase ? 'lit-red' : '';
        cols[i].forEach(id => {
          const el = document.getElementById(id);
          if (el) { el.className = 'light-bulb' + (cls ? ' ' + cls : ''); }
        });
      }
      document.getElementById('lightsGo').classList.remove('go-visible');
    } else if (phase === 6) {
      // All red
      cols.forEach(col => col.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.className = 'light-bulb lit-red';
      }));
      document.getElementById('lightsGo').classList.remove('go-visible');
    } else if (phase === 7) {
      // All green — GO!
      cols.forEach(col => col.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.className = 'light-bulb lit-green';
      }));
      document.getElementById('lightsGo').classList.add('go-visible');
    }
  }

  function resetLightBulbs() {
    for (let i = 1; i <= 5; i++) {
      ['t', 'b'].forEach(s => {
        const el = document.getElementById('light' + i + s);
        if (el) el.className = 'light-bulb';
      });
    }
    const go = document.getElementById('lightsGo');
    if (go) go.classList.remove('go-visible');
  }

  // ═══════════════════════════════════════════════════════════════
