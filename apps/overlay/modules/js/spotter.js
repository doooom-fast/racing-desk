// Spotter messages — stacking system

  // ═══════════════════════════════════════════════════════════════
  //  SPOTTER MESSAGES (stacking: new messages push old ones)
  // ═══════════════════════════════════════════════════════════════
  let _spotterLastGapA = 0;        // previous gap ahead (seconds)
  let _spotterLastGapB = 0;        // previous gap behind (seconds)
  let _spotterLastMsg = '';         // legacy — kept for announceAdjustment bypass
  let _spotterLastPosA = 0;        // previous position of car ahead
  let _spotterLastPosB = 0;        // previous position of car behind

  // Stack management — max 3 messages visible at once
  const _spotterMaxStack = 3;
  const _spotterMsgDuration = 5000;  // ms per message

  // SVG icons per severity (viewBox 0 0 24 24, stroke-based)
  const _spotterIcons = {
    default: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    'sp-warn': '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><circle cx="12" cy="16" r="1" fill="currentColor" stroke="none"/>',
    'sp-danger': '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><circle cx="12" cy="16" r="1" fill="currentColor" stroke="none"/>',
    'sp-clear': '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/>',
    'sp-bb':  '<circle cx="12" cy="12" r="9"/><path d="M12 3v18"/><path d="M8 8h8"/><path d="M6 12h12"/>',
    'sp-tc':  '<path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10"/><path d="M12 8v8"/><path d="M8 12h8"/>',
    'sp-abs': '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 8v8"/><path d="M8 12h8"/>',
    'sp-lap': '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M10 2h4"/><path d="M12 2v3"/>'
  };

  function _createSpotterCard(msg, severity, headerText, iconOverride, adjType) {
    const card = document.createElement('div');
    card.className = 'sp-inner ' + severity;

    const iconPath = _spotterIcons[iconOverride || severity] || _spotterIcons.default;
    const iconAttr = adjType ? ` data-adj="${adjType}"` : '';
    card.innerHTML =
      `<svg class="sp-icon"${iconAttr} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
        iconPath +
      '</svg>' +
      '<div class="sp-content">' +
        '<div class="sp-header"></div>' +
        '<div class="sp-message"></div>' +
      '</div>';

    card.querySelector('.sp-header').textContent = headerText || 'Spotter';
    card.querySelector('.sp-message').textContent = msg;

    if (adjType) {
      card.setAttribute('data-adj-type', adjType);
    }

    return card;
  }

  function _pushSpotterMsg(msg, severity, headerOverride, iconOverride, adjType, category) {
    const stack = document.getElementById('spotterStack');
    if (!stack || !msg) return;

    // Reuse existing card of same category (avoid stacking duplicates)
    if (category) {
      const existing = stack.querySelector(`[data-spot-cat="${category}"]`);
      if (existing) {
        // Update content
        const msgEl = existing.querySelector('.sp-message');
        if (msgEl) msgEl.textContent = msg;
        const headerEl = existing.querySelector('.sp-header');
        if (headerEl) headerEl.textContent = headerOverride || 'Spotter';

        // Update severity class
        existing.className = 'sp-inner ' + severity + ' sp-active';

        // Update icon
        const iconPath = _spotterIcons[iconOverride || severity] || _spotterIcons.default;
        const iconEl = existing.querySelector('.sp-icon');
        if (iconEl) iconEl.innerHTML = iconPath;

        // Reset auto-dismiss timer
        if (existing._spotterTimer) clearTimeout(existing._spotterTimer);
        existing._spotterTimer = setTimeout(() => {
          _fadeOutCard(existing);
        }, _spotterMsgDuration);

        // Re-trigger WebGL glow
        if (window.setSpotterGlow) {
          const glowMap = { 'sp-warn': 'warn', 'sp-danger': 'danger', 'sp-clear': 'clear' };
          window.setSpotterGlow(glowMap[severity] || 'warn');
        }
        return;
      }
    }

    // Create and insert the new card
    const card = _createSpotterCard(msg, severity, headerOverride, iconOverride, adjType);
    if (category) card.setAttribute('data-spot-cat', category);
    stack.prepend(card);

    // Trigger WebGL glow for the newest message
    if (window.setSpotterGlow) {
      const glowMap = { 'sp-warn': 'warn', 'sp-danger': 'danger', 'sp-clear': 'clear' };
      window.setSpotterGlow(glowMap[severity] || 'warn');
    }

    // Animate in on next frame
    requestAnimationFrame(() => {
      card.classList.add('sp-active');
    });

    // Enforce max stack size — fade out oldest if over limit
    const cards = stack.querySelectorAll('.sp-inner:not(.sp-fading)');
    if (cards.length > _spotterMaxStack) {
      const oldest = cards[cards.length - 1];
      _fadeOutCard(oldest);
    }

    // Auto-remove after duration
    const timer = setTimeout(() => {
      _fadeOutCard(card);
    }, _spotterMsgDuration);

    // Store timer on element for cleanup
    card._spotterTimer = timer;
  }

  function _fadeOutCard(card) {
    if (!card || card.classList.contains('sp-fading')) return;
    card.classList.remove('sp-active');
    card.classList.add('sp-fading');
    setTimeout(() => {
      card.remove();
      // Turn off glow if stack is now empty
      const stack = document.getElementById('spotterStack');
      if (stack && stack.children.length === 0 && window.setSpotterGlow) {
        window.setSpotterGlow('off');
      }
    }, 500); // matches CSS transition duration
    if (card._spotterTimer) {
      clearTimeout(card._spotterTimer);
      card._spotterTimer = null;
    }
  }

  // Extract the message "shape" — strip trailing numeric gap so
  // "Car behind — 2.1s" and "Car behind — 2.0s" both become "Car behind —"
  function _spotterMsgPattern(msg) {
    return msg.replace(/[\d.]+s$/, '').trim();
  }

  // Recent-message memo: pattern → expiry timestamp
  // Prevents any message of the same pattern from repeating within the cooldown
  const _spotterMemo = new Map();
  const _spotterPatternCooldown = 4000;  // ms — suppress same pattern for 4s
  const _spotterExactCooldown = 5000;    // ms — suppress exact match for 5s (matches message duration)

  function _showSpotterMsg(msg, severity, headerOverride, category) {
    if (!msg) return;
    const pattern = _spotterMsgPattern(msg);
    const now = Date.now();

    // Check memo — suppress if same pattern fired recently
    const expiry = _spotterMemo.get(pattern);
    if (expiry && now < expiry) {
      console.debug('[K10 Spotter] Suppressed by pattern memo (in cooldown):', pattern, 'expires in', Math.round((expiry - now) / 100) / 10, 's');
      return;
    }

    // Also suppress exact duplicate text within a shorter window
    const exactExpiry = _spotterMemo.get(msg);
    if (exactExpiry && now < exactExpiry) {
      console.debug('[K10 Spotter] Suppressed by exact match memo (in cooldown):', msg, 'expires in', Math.round((exactExpiry - now) / 100) / 10, 's');
      return;
    }

    // Record both pattern and exact text with their respective cooldowns
    _spotterMemo.set(pattern, now + _spotterPatternCooldown);
    _spotterMemo.set(msg, now + _spotterExactCooldown);

    // Prune old entries periodically (keep map from growing)
    if (_spotterMemo.size > 30) {
      for (const [k, v] of _spotterMemo) {
        if (now >= v) _spotterMemo.delete(k);
      }
    }

    console.debug('[K10 Spotter] Showing message:', msg, 'severity:', severity);
    _pushSpotterMsg(msg, severity, headerOverride, null, null, category);
  }

  function updateSpotter(p, isDemo) {
    const stack = document.getElementById('spotterStack');
    if (!stack) return;

    // ═══════════════════════════════════════════════════════════
    //  RACE SESSIONS: gap-based proximity spotter
    // ═══════════════════════════════════════════════════════════
    const gAhead  = isDemo ? (+p['RaceCorProDrive.Plugin.Demo.GapAhead'] || 0)  : (+p['IRacingExtraProperties.iRacing_Opponent_Ahead_Gap'] || 0);
    const gBehind = isDemo ? (+p['RaceCorProDrive.Plugin.Demo.GapBehind'] || 0) : (+p['IRacingExtraProperties.iRacing_Opponent_Behind_Gap'] || 0);

    // Compute gap deltas (negative = gap shrinking = closing)
    const deltaA = _spotterLastGapA > 0 && gAhead > 0 ? gAhead - _spotterLastGapA : 0;
    const deltaB = _spotterLastGapB > 0 && gBehind > 0 ? gBehind - _spotterLastGapB : 0;

    let msg = '';
    let severity = '';
    let category = null;

    // ═ FIRST READING: when we first detect a car nearby (previous was 0, now > 0) ═
    // Show basic proximity alert without requiring delta change
    const isFirstReadingAhead = _spotterLastGapA === 0 && gAhead > 0 && gAhead <= 4.0;
    const isFirstReadingBehind = _spotterLastGapB === 0 && gBehind > 0 && gBehind <= 4.0;

    if (isFirstReadingAhead && !msg) {
      if (gAhead <= 0.8) {
        msg = 'Car right there — ' + gAhead.toFixed(1) + 's';
        severity = 'sp-danger';
      } else if (gAhead <= 2.0) {
        msg = 'Car ahead — ' + gAhead.toFixed(1) + 's';
        severity = 'sp-clear';
      } else {
        msg = 'Car ahead — ' + gAhead.toFixed(1) + 's';
        severity = 'sp-warn';
      }
      category = 'ahead';
    }

    if (isFirstReadingBehind && !msg) {
      if (gBehind <= 0.8) {
        msg = 'Car alongside — ' + gBehind.toFixed(1) + 's';
        severity = 'sp-danger';
      } else if (gBehind <= 2.0) {
        msg = 'Car behind — ' + gBehind.toFixed(1) + 's';
        severity = 'sp-warn';
      } else {
        msg = 'Car behind — ' + gBehind.toFixed(1) + 's';
        severity = 'sp-warn';
      }
      category = 'behind';
    }

    // ═ Threat behind — car closing on us ═
    if (!msg && gBehind > 0 && gBehind <= 0.8) {
      msg = 'Car alongside — ' + gBehind.toFixed(1) + 's';
      severity = 'sp-danger';
      category = 'behind';
    } else if (!msg && gBehind > 0 && gBehind <= 2.0) {
      if (deltaB < -0.03) {
        msg = 'Car closing — ' + gBehind.toFixed(1) + 's';
        severity = 'sp-warn';
      } else if (_spotterLastGapB > 0) {  // Only show "car behind" if we've seen the gap before
        msg = 'Car behind — ' + gBehind.toFixed(1) + 's';
        severity = 'sp-warn';
      }
      category = 'behind';
    } else if (!msg && gBehind > 0 && gBehind <= 4.0 && deltaB < -0.03) {
      msg = 'Car reeling in — ' + gBehind.toFixed(1) + 's';
      severity = 'sp-warn';
      category = 'behind';
    }

    // ═ Opportunity ahead — we're closing on the car ahead ═
    if (!msg && gAhead > 0 && gAhead <= 0.8) {
      msg = 'Car right there — ' + gAhead.toFixed(1) + 's';
      severity = 'sp-danger';
      category = 'ahead';
    } else if (!msg && gAhead > 0 && gAhead <= 2.0) {
      if (deltaA < -0.03) {
        msg = 'Closing on car ahead — ' + gAhead.toFixed(1) + 's';
        severity = 'sp-clear';
      } else if (deltaA > 0.03) {
        msg = 'Car ahead pulling away — ' + gAhead.toFixed(1) + 's';
        severity = 'sp-warn';
      } else if (_spotterLastGapA > 0) {  // Only show "car ahead" if we've seen the gap before
        msg = 'Car ahead — ' + gAhead.toFixed(1) + 's';
        severity = 'sp-clear';
      }
      category = 'ahead';
    } else if (!msg && gAhead > 0 && gAhead <= 4.0 && deltaA < -0.03) {
      msg = 'Gaining on car ahead — ' + gAhead.toFixed(1) + 's';
      severity = 'sp-clear';
      category = 'ahead';
    }

    // ═ Pass events — position swaps (no category, normal stacking) ═
    if (!msg && _spotterLastGapA > 0 && _spotterLastGapA < 3.0 && gAhead > _spotterLastGapA + 2.0 && gBehind > 0 && gBehind < 3.0) {
      msg = 'Clear — position gained';
      severity = 'sp-clear';
    }
    if (!msg && _spotterLastGapB > 0 && _spotterLastGapB < 3.0 && gBehind > _spotterLastGapB + 2.0 && gAhead > 0 && gAhead < 3.0) {
      msg = 'Position lost';
      severity = 'sp-danger';
    }

    _spotterLastGapA = gAhead;
    _spotterLastGapB = gBehind;

    if (msg) _showSpotterMsg(msg, severity, null, category);
  }

  // ═══════════════════════════════════════════════════════════════
  //  IN-CAR ADJUSTMENT ANNOUNCEMENTS
  //  Called from poll-engine when BB / TC / ABS values change.
  //  Shows a brief spotter-style callout with the new value.
  //  Reuses existing adjustment card instead of stacking new ones.
  // ═══════════════════════════════════════════════════════════════
  window.announceAdjustment = function(type, value, direction) {
    const stack = document.getElementById('spotterStack');
    if (!stack) return;

    const arrow = direction > 0 ? '\u25B2' : direction < 0 ? '\u25BC' : '';
    let label, icon;
    switch (type) {
      case 'bb':
        label = 'Brake Bias ' + arrow + ' ' + (typeof value === 'number' ? value.toFixed(1) : value);
        icon = 'sp-bb';
        break;
      case 'tc':
        label = 'TC ' + arrow + ' ' + Math.round(value);
        icon = 'sp-tc';
        break;
      case 'abs':
        label = 'ABS ' + arrow + ' ' + Math.round(value);
        icon = 'sp-abs';
        break;
      default:
        label = type + ' ' + arrow + ' ' + value;
        icon = 'default';
    }

    // Check if an adjustment card of this type already exists in the stack
    const existingCard = stack.querySelector(`[data-adj-type="${type}"]`);
    if (existingCard) {
      // Update existing card text
      const msgEl = existingCard.querySelector('.sp-message');
      if (msgEl) {
        msgEl.textContent = label;
      }
      // Reset auto-dismiss timer
      if (existingCard._spotterTimer) {
        clearTimeout(existingCard._spotterTimer);
      }
      const timer = setTimeout(() => {
        _fadeOutCard(existingCard);
      }, _spotterMsgDuration);
      existingCard._spotterTimer = timer;

      // Flash the card to provide visual feedback
      existingCard.classList.remove('sp-active');
      requestAnimationFrame(() => {
        existingCard.classList.add('sp-active');
      });
    } else {
      // No existing adjustment card — create a new one
      _pushSpotterMsg(label, 'sp-clear', 'Adjustment', icon, type);
    }
  };

  // ═══════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════
  //  TIRE / TRACK CONDITION MISMATCH DETECTION
  // ═══════════════════════════════════════════════════════════════
  let _tyreMismatchLastAlert = 0;
  const _tyreMismatchCooldown = 60000; // Only alert once per minute

  window.checkTyreMismatch = function(p, isDemo) {
    const pre = isDemo ? 'RaceCorProDrive.Plugin.Demo.DS.' : 'RaceCorProDrive.Plugin.DS.';
    const isWet = +(p[pre + 'WeatherWet']) === 1;
    const trackWetness = +(p[pre + 'TrackWetness']) || 0;

    // Tire compound: try multiple possible property paths
    // Some SimHub plugins expose TireCompound directly; others use raw telemetry indices
    let onWetTires = false;

    // Try K10 plugin custom property first
    const compound = +(p[pre + 'TireCompound']);
    if (!isNaN(compound)) {
      // 1 = wet tires, 0 = dry tires
      onWetTires = compound === 1;
    } else {
      // Fallback: we don't have reliable tire compound data
      return;
    }

    const now = Date.now();
    if (now - _tyreMismatchLastAlert < _tyreMismatchCooldown) return;

    let msg = '';
    let severity = '';

    // Wet weather but on dry tires — critical alert
    if (isWet && !onWetTires && trackWetness > 0.3) {
      msg = 'Dry tires on wet track — consider pitting for wets';
      severity = 'sp-warn';
    }
    // Dry weather but on wet tires — performance warning
    else if (!isWet && onWetTires && trackWetness < 0.1) {
      msg = 'Wet tires on dry track — losing grip to compound';
      severity = 'sp-warn';
    }

    if (msg) {
      _tyreMismatchLastAlert = now;
      _showSpotterMsg(msg, severity, 'Conditions');
    }
  };
