// Race control message banner

  // ═══════════════════════════════════════════════════════════════
  //  RACE CONTROL MESSAGE BANNER
  // ═══════════════════════════════════════════════════════════════

  // Only critical session-altering events get the Race Control banner.
  // Blue, white, green, debris are handled by the flag overlay on the gaps block.
  const RC_MESSAGES = {
    yellow:    { title: 'CAUTION',          detail: 'Full course yellow — hold position' },
    red:       { title: 'RED FLAG',         detail: 'Session stopped — return to pits' },
    checkered: { title: 'CHECKERED FLAG',   detail: 'Race complete — cool down lap' },
    black:     { title: 'BLACK FLAG',       detail: 'Penalty — report to pit lane immediately' },
    meatball:  { title: 'MEATBALL FLAG',    detail: 'Mechanical issue — pit for required repairs' },
  };

  // Duration each race control message stays visible (ms)
  const RC_DISPLAY_MS = 8000;

  function showRaceControl(flagType) {
    const banner = document.getElementById('rcBanner');
    if (!banner) return;
    const msg = RC_MESSAGES[flagType];
    if (!msg) return;

    const titleEl = document.getElementById('rcTitle');
    const detailEl = document.getElementById('rcDetail');
    if (titleEl) titleEl.textContent = msg.title;
    if (detailEl) detailEl.textContent = msg.detail;

    // Remove previous flag classes
    banner.className = banner.className.replace(/\brc-flag-\S+/g, '').trim();
    banner.classList.add('rc-flag-' + flagType);
    banner.classList.add('rc-visible');
    _rcVisible = true;

    // Dim HUD elements
    document.body.classList.add('rc-active');

    // Auto-hide after duration
    if (_rcTimeout) clearTimeout(_rcTimeout);
    _rcTimeout = setTimeout(() => {
      hideRaceControl();
    }, RC_DISPLAY_MS);
  }

  function hideRaceControl() {
    const banner = document.getElementById('rcBanner');
    if (!banner) return;
    banner.classList.remove('rc-visible');
    _rcVisible = false;
    if (_rcTimeout) { clearTimeout(_rcTimeout); _rcTimeout = null; }

    // Restore HUD elements
    document.body.classList.remove('rc-active');
  }

  // ═══════════════════════════════════════════════════════════════
