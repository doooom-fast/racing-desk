// Pit limiter module

  // ═══════════════════════════════════════════════════════════════
  //  PIT LIMITER
  // ═══════════════════════════════════════════════════════════════
  let _wasInPit = false;
  let _bonkersActive = false;
  let _sparkTimer = null;
  // Bonkers holdover: when entering pit at speed, lock bonkers for 3s
  // so the animation is visible even after the auto-limiter slows the car
  let _bonkersHoldUntil = 0;

  function updatePitLimiter(p, isDemo) {
    const pre = isDemo ? 'RaceCorProDrive.Plugin.Demo.DS.' : 'RaceCorProDrive.Plugin.DS.';
    // Fallback to SimHub's built-in DataCore if plugin property is not set
    const inPitLane = +(p[pre + 'IsInPitLane']) > 0 || +(p['DataCorePlugin.GameData.IsInPitLane']) > 0;
    const speedKmh = +(p[pre + 'SpeedKmh']) || +(p['DataCorePlugin.GameData.SpeedKph']) || 0;
    const pitLimiterOn = +(p[pre + 'PitLimiterOn']) > 0 || +(p['DataCorePlugin.GameData.PitLimiterEnabled']) > 0;
    const pitLimitKmh = +(p[pre + 'PitSpeedLimitKmh']) || +(p['DataCorePlugin.GameData.PitSpeedLimitKmh']) || 0;

    const banner = document.getElementById('pitBanner');
    const speedEl = document.getElementById('pitSpeed');
    const limitEl = document.getElementById('pitLimit');
    const labelEl = banner ? banner.querySelector('.pit-label') : null;
    if (!banner) return;

    // Pit limiter blue glow on tacho module — show whenever limiter is on
    const tacho = document.querySelector('.tacho-block');
    if (tacho) tacho.classList.toggle('pit-limiter-engaged', pitLimiterOn);

    // Detect pit entry while speeding — lock bonkers for 3s so it's visible
    // even after the car's auto-limiter kicks in and drops speed
    const now = Date.now();
    const isSpeeding = +(p[pre + 'IsPitSpeeding']) > 0 || (pitLimitKmh > 0 && speedKmh > pitLimitKmh) || +(p['DataCorePlugin.GameData.IsSpeedingOnPitRoad']) > 0;
    if (!_wasInPit && inPitLane && isSpeeding) {
      _bonkersHoldUntil = now + 3000;
    }
    const bonkersHeld = now < _bonkersHoldUntil;

    // Show banner when pit limiter is engaged OR in pit lane
    if (inPitLane || pitLimiterOn) {
      banner.classList.add('pit-visible');
      if (inPitLane) document.body.classList.add('pit-mode');

      // Show speed — prefer server-computed DS.SpeedMph
      if (speedEl) {
        const mph = Math.round(+(p[pre + 'SpeedMph']) || +(p['DataCorePlugin.GameData.SpeedMph']) || speedKmh * 0.621371);
        speedEl.textContent = mph > 0 ? mph + ' mph' : '';
      }
      // Show pit speed limit — prefer server-computed DS.PitSpeedLimitMph
      if (limitEl) {
        if (pitLimitKmh > 0) {
          const limitMph = Math.round(+(p[pre + 'PitSpeedLimitMph']) || +(p['DataCorePlugin.GameData.PitSpeedLimitMph']) || pitLimitKmh * 0.621371);
          limitEl.textContent = '/ ' + limitMph + ' limit';
        } else {
          limitEl.textContent = '';
        }
      }

      // ── State priority: BONKERS > WARNING > NORMAL ──
      if (inPitLane && (isSpeeding || bonkersHeld)) {
        // BONKERS — over the speed limit in pit lane, or held from entry
        banner.classList.add('pit-bonkers');
        banner.classList.remove('pit-warning');
        if (labelEl) labelEl.textContent = 'SPEEDING';
        if (_settings.showBonkers !== false) {
          if (!_bonkersActive) _startBonkersSparks(banner);
          if (window.setBonkersGL) window.setBonkersGL(true);
        }
      } else if (inPitLane && !pitLimiterOn) {
        // WARNING — in pit lane with limiter off, not yet over limit
        banner.classList.add('pit-warning');
        banner.classList.remove('pit-bonkers');
        if (labelEl) labelEl.textContent = 'PIT LIMITER OFF';
        if (_bonkersActive) _stopBonkersSparks(banner);
        if (window.setBonkersGL) window.setBonkersGL(false);
      } else {
        // NORMAL — limiter on (in or out of pit lane)
        banner.classList.remove('pit-warning', 'pit-bonkers');
        if (labelEl) labelEl.textContent = 'Pit Limiter';
        if (_bonkersActive) _stopBonkersSparks(banner);
        if (window.setBonkersGL) window.setBonkersGL(false);
      }
    } else if (pitLimitKmh > 0 && speedKmh > pitLimitKmh && bonkersHeld) {
      // Not in pit lane, limiter off — but holdover from entering pit at speed
      banner.classList.add('pit-visible', 'pit-bonkers');
      banner.classList.remove('pit-warning');
      if (labelEl) labelEl.textContent = 'SPEEDING';
      if (speedEl) {
        const mph = Math.round(+(p[pre + 'SpeedMph']) || +(p['DataCorePlugin.GameData.SpeedMph']) || speedKmh * 0.621371);
        speedEl.textContent = mph > 0 ? mph + ' mph' : '';
      }
    } else {
      banner.classList.remove('pit-visible', 'pit-warning', 'pit-bonkers');
      document.body.classList.remove('pit-mode');
      if (labelEl) labelEl.textContent = 'Pit Limiter';
      if (_bonkersActive) _stopBonkersSparks(banner);
      if (window.setBonkersGL) window.setBonkersGL(false);
    }
    _wasInPit = inPitLane;
  }

  // ═══════════════════════════════════════════════════════════════
  //  BONKERS SPARK PARTICLE SYSTEM
  //  Reusable — call _startBonkersSparks(container) on any element
  // ═══════════════════════════════════════════════════════════════

  function _startBonkersSparks(container) {
    if (_bonkersActive) return;
    _bonkersActive = true;
    const inner = container.querySelector('.pit-inner');
    if (!inner) return;
    _sparkTimer = setInterval(() => {
      if (!_bonkersActive) return;
      // Burst of 3-5 sparks per tick
      const count = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < count; i++) _spawnSpark(inner);
    }, 40);
  }

  function _stopBonkersSparks(container) {
    _bonkersActive = false;
    if (_sparkTimer) { clearInterval(_sparkTimer); _sparkTimer = null; }
    // Remove lingering sparks
    const inner = container.querySelector('.pit-inner');
    if (inner) inner.querySelectorAll('.pit-spark').forEach(s => s.remove());
  }

  function _spawnSpark(parent) {
    const spark = document.createElement('div');
    spark.className = 'pit-spark';

    // Random direction — bias upward and outward
    const angle = -Math.PI * 0.1 + Math.random() * -Math.PI * 0.8; // mostly upward arc
    const speed = 40 + Math.random() * 80;
    const dx = Math.cos(angle) * speed * (Math.random() > 0.5 ? 1 : -1);
    const dy = Math.sin(angle) * speed;
    const size = 1.5 + Math.random() * 2.5;
    const hue = Math.random() * 55;               // 0 (red) → 55 (yellow)
    const life = 300 + Math.random() * 400;        // 300-700ms
    const brightness = 55 + Math.random() * 15;

    spark.style.cssText =
      'position:absolute;border-radius:50%;pointer-events:none;z-index:10;' +
      'width:' + size + 'px;height:' + size + 'px;' +
      'background:hsl(' + hue + ',100%,' + brightness + '%);' +
      'box-shadow:0 0 ' + (size * 3) + 'px hsl(' + hue + ',100%,50%),' +
                 '0 0 ' + (size * 6) + 'px hsla(' + hue + ',100%,50%,0.4);' +
      'left:' + (50 + (Math.random() - 0.5) * 60) + '%;' +
      'top:50%;' +
      '--spark-dx:' + dx + 'px;--spark-dy:' + dy + 'px;' +
      'animation:pit-spark-fly ' + life + 'ms ease-out forwards;';

    parent.appendChild(spark);
    setTimeout(() => { if (spark.parentNode) spark.remove(); }, life + 50);
  }

  // ═══════════════════════════════════════════════════════════════
