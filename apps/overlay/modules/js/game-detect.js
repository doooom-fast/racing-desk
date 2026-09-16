// Game detection system

  const GAME_FEATURES = {
    iracing:     { hasIRating: true,  hasIncidents: true,  hasFlags: true,  hasFormation: true,  hasDRS: true,  hasERS: true  },
    acc:         { hasIRating: false, hasIncidents: false, hasFlags: true,  hasFormation: true,  hasDRS: false, hasERS: true  },
    ac:          { hasIRating: false, hasIncidents: false, hasFlags: true,  hasFormation: false, hasDRS: false, hasERS: false },
    acevo:       { hasIRating: false, hasIncidents: false, hasFlags: true,  hasFormation: false, hasDRS: false, hasERS: false },
    acrally:     { hasIRating: false, hasIncidents: false, hasFlags: false, hasFormation: false, hasDRS: false, hasERS: false },
    raceroom:    { hasIRating: false, hasIncidents: false, hasFlags: true,  hasFormation: true,  hasDRS: true,  hasERS: false },
    eawrc:       { hasIRating: false, hasIncidents: false, hasFlags: false, hasFormation: false, hasDRS: false, hasERS: false },
    forza:       { hasIRating: false, hasIncidents: false, hasFlags: false, hasFormation: false, hasDRS: false, hasERS: false },
  };

  function detectGameId(name) {
    if (!name) return 'iracing';
    const g = name.toLowerCase();
    if (g.includes('iracing')) return 'iracing';
    if (g.includes('assettocorsacompetizione') || g === 'acc') return 'acc';
    if (g.includes('assettocorsaevo')) return 'acevo';
    if (g.includes('assettocorsarally')) return 'acrally';
    if (g.includes('assettocorsa') || g === 'ac') return 'ac';
    if (g.includes('raceroom') || g === 'rrre' || g === 'r3e') return 'raceroom';
    if (g.includes('wrc') || g.includes('eawrc')) return 'eawrc';
    if (g.includes('forza')) return 'forza';
    return 'iracing'; // default
  }

  function getGameFeatures() {
    return GAME_FEATURES[_currentGameId] || GAME_FEATURES.iracing;
  }

  // All games are allowed — no connection check required
  function isGameAllowed() {
    return true;
  }

  function isRallyGame() {
    return _currentGameId === 'eawrc' || _currentGameId === 'acrally';
  }

  function fmtLap(t) {
    if (!t || t <= 0) return '—:——.———';
    const m = Math.floor(t / 60), s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(3);
  }
  function fmtGap(g) {
    if (!g || g === 0) return '—';
    return g > 0 ? '+' + g.toFixed(1) : g.toFixed(1);
  }
  function colorToHue(hex) {
    if (!hex || hex.length < 7) return 0;
    let r, g, b;
    if (hex.length === 9) { r = parseInt(hex.substr(3,2),16)/255; g = parseInt(hex.substr(5,2),16)/255; b = parseInt(hex.substr(7,2),16)/255; }
    else { r = parseInt(hex.substr(1,2),16)/255; g = parseInt(hex.substr(3,2),16)/255; b = parseInt(hex.substr(5,2),16)/255; }
    const mx = Math.max(r,g,b), mn = Math.min(r,g,b), d = mx - mn;
    if (d === 0) return 0;
    let h; if (mx === r) h = ((g-b)/d)%6; else if (mx === g) h = (b-r)/d+2; else h = (r-g)/d+4;
    h = Math.round(h * 60); if (h < 0) h += 360; return h;
  }

  // ─── Connection status indicator & setup banner ───
  // _hasEverConnected, _settingsForcedByDisconnect declared in config.js
  let _connBannerDismissed = false;
  let _connBannerShown = false;

  function _updateConnStatus(state) {
    const el = document.getElementById('connStatus');
    if (!el) return;
    el.className = 'conn-status ' + state;
    const titles = { connected: 'Connected to plugin server', disconnected: 'Cannot reach plugin server — is the K10 Motorsports plugin loaded in SimHub?', connecting: 'Connecting to plugin server...' };
    el.title = titles[state] || '';

    // Settings-embedded warning banner
    const settingsWarn = document.getElementById('settingsConnWarn');
    const settingsWarnUrl = document.getElementById('settingsConnWarnUrl');

    if (state === 'connected') {
      _hasEverConnected = true;
      // Hide banners
      const banner = document.getElementById('connBanner');
      if (banner && banner.classList.contains('visible')) {
        banner.classList.remove('visible');
      }
      if (settingsWarn) settingsWarn.classList.remove('warn-visible');
      // Stop logo demo cycle once connected
      if (_logoCycleTimer) { clearInterval(_logoCycleTimer); _logoCycleTimer = null; }
      // Clear forced-disconnect flag when connection is restored
      if (_settingsForcedByDisconnect) {
        _settingsForcedByDisconnect = false;
      }
    }

    if (state === 'disconnected' && _connFails >= 2) {
      if (settingsWarn) {
        settingsWarn.classList.add('warn-visible');
        if (settingsWarnUrl) settingsWarnUrl.textContent = window._simhubUrlOverride || SIMHUB_URL;
      }
      // Show connection banner when disconnected (useful for Mac/Parallels users)
      // Banner allows quick IP entry without opening full settings
      if (!_connBannerDismissed && !_connBannerShown && _connFails >= 2) {
        const banner = document.getElementById('connBanner');
        if (banner) {
          banner.classList.add('visible');
          _connBannerShown = true;
          if (window.k10?.requestInteractive) window.k10.requestInteractive();
        }
      }
    }

    // Also refresh the Connections tab SimHub card in real-time
    if (typeof updateSimhubConnectionCard === 'function') updateSimhubConnectionCard();
  }

  function applyConnBanner() {
    const inp = document.getElementById('connBannerUrl');
    if (!inp) return;
    let host = inp.value.trim();
    if (!host) return;
    // Strip protocol/path if user pasted a full URL
    host = host.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:.*$/, '');
    const newUrl = `http://${host}:8889/racecor-io-pro-drive/`;
    window._simhubUrlOverride = newUrl;
    _settings.simhubUrl = newUrl;
    // saveSettings() is defined in connections.js which loads after game-detect.js
    // Ensure it's available before calling
    const _trySaveSettings = () => {
      if (typeof saveSettings === 'function') {
        saveSettings();
      } else {
        // Retry after a short delay when saveSettings becomes available
        setTimeout(_trySaveSettings, 100);
      }
    };
    _trySaveSettings();
    // Update the settings panel input too
    const urlInput = document.getElementById('settingsSimhubUrl');
    if (urlInput) urlInput.value = newUrl;
    // Reset backoff so we try immediately
    _connFails = 0;
    _backoffUntil = 0;
    _hasEverConnected = false;
    _connBannerShown = false;
    _updateConnStatus('connecting');
    // Hide banner and release Electron focus
    const banner = document.getElementById('connBanner');
    if (banner) banner.classList.remove('visible');
    if (window.k10?.releaseInteractive) window.k10.releaseInteractive();
    console.log('[K10 Motorsports] SimHub URL changed to ' + newUrl);
  }

  function dismissConnBanner() {
    _connBannerDismissed = true;
    const banner = document.getElementById('connBanner');
    if (banner) banner.classList.remove('visible');
    if (window.k10?.releaseInteractive) window.k10.releaseInteractive();
  }

  // Expose for onclick handlers
  window.applyConnBanner = applyConnBanner;
  window.dismissConnBanner = dismissConnBanner;

  // ─── Fetch with timeout helper ───
  function fetchWithTimeout(url, opts, ms) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), ms);
    return fetch(url, { ...opts, signal: ac.signal }).finally(() => clearTimeout(timer));
  }

  // ─── Fetch properties from SimHub HTTP API ───
  // Uses exponential backoff on failure to avoid socket exhaustion.
  async function fetchProps() {
    // Backoff: skip this cycle if we're in a cooldown window
    if (_backoffUntil > Date.now()) return null;

    const TIMEOUT_MS = 2000;

    // Single GET — our plugin serves everything in one JSON blob
    const url = window._simhubUrlOverride || SIMHUB_URL;
    try {
      const resp = await fetchWithTimeout(url, {}, TIMEOUT_MS);
      if (resp.ok) {
        const data = await resp.json();
        _connFails = 0;
        _updateConnStatus('connected');
        return data;
      }
    } catch (e) { /* unreachable */ }

    // Failed — enter exponential backoff (1s, 2s, 4s, 8s, cap 10s)
    _connFails++;
    _backoffUntil = Date.now() + Math.min(1000 * Math.pow(2, _connFails - 1), 10000);
    _updateConnStatus('disconnected');
    if (_connFails <= 3) console.warn(`[K10 Motorsports] Plugin server unreachable at ${window._simhubUrlOverride || SIMHUB_URL} — fail #${_connFails}`);
    return null;
  }

  // ── Apply game mode styling ──
  function applyGameMode() {
    const feat = getGameFeatures();
    const dashboard = document.getElementById('dashboard');

    // Toggle iRacing-specific UI elements
    const irElements = document.querySelectorAll('.ir-only');
    irElements.forEach(el => el.style.display = feat.hasIRating ? '' : 'none');

    // Toggle incident counter
    const incElements = document.querySelectorAll('.incident-only');
    incElements.forEach(el => el.style.display = feat.hasIncidents ? '' : 'none');

    // Rally mode: hide circuit-specific elements, show rally elements
    const rallyEls = document.querySelectorAll('.rally-only');
    const circuitEls = document.querySelectorAll('.circuit-only');
    rallyEls.forEach(el => el.style.display = _isRally ? '' : 'none');
    circuitEls.forEach(el => el.style.display = _isRally ? 'none' : '');

    // Update body class for CSS-level game adaptation
    document.body.classList.toggle('game-iracing', _isIRacing);
    document.body.classList.toggle('game-rally', _isRally);
    document.body.classList.toggle('game-acc', _currentGameId === 'acc');
    document.body.classList.toggle('game-acevo', _currentGameId === 'acevo');
  }
