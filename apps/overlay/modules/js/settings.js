// Settings system
  // _defaultSettings, _settings, _forceFlagState declared in config.js

  // ─── Layout management ───
  // applyLayout / applyZoom previously lived in modules/js/connections.js,
  // which was deleted when the in-overlay settings UI was retired (commit
  // 826ed67). The functions are still load-bearing — settings.js calls them
  // from applySettings() — so they're restored here, scoped to what the
  // host-driven settings file actually controls.

  // 4 user corners + a "centered" alias mapping to the programmatic
  // absolute-center used for pre-race / podium. All other behavior is
  // deterministic from the corner: right→RTL flow, bottom→column-reverse.
  // Top/bottom-center don't have CSS coverage — the host's picker is
  // pruned to match this set so users can't pick an option that
  // silently falls back to top-right.
  var _layoutPositionMap = {
    'top-right':       'layout-tr',
    'top-left':        'layout-tl',
    'bottom-right':    'layout-br',
    'bottom-left':     'layout-bl',
    'centered':        'layout-ac',
    'absolute-center': 'layout-ac'
  };
  var _allLayoutClasses = Object.keys(_layoutPositionMap).map(function(k) { return _layoutPositionMap[k]; });

  function applyLayout() {
    var dash = document.getElementById('dashboard');
    if (!dash) return;
    var pos = _settings.layoutPosition || 'top-right';

    _allLayoutClasses.forEach(function(c) { dash.classList.remove(c); });
    dash.classList.add(_layoutPositionMap[pos] || 'layout-tr');

    var isBottom = pos.indexOf('bottom') !== -1;
    var isRight  = pos.indexOf('right')  !== -1;
    var isCenter = (pos === 'absolute-center' || pos === 'centered');

    // Commentary: diagonally opposite the main HUD.
    var cmtCol = document.getElementById('commentaryCol');
    if (cmtCol) {
      cmtCol.classList.remove('cmt-tl', 'cmt-tr', 'cmt-bl', 'cmt-br');
      if (!isCenter) {
        var cmtV = isBottom ? 't' : 'b';
        var cmtH = isRight  ? 'l' : 'r';
        cmtCol.classList.add('cmt-' + cmtV + cmtH);
      } else {
        cmtCol.classList.add('cmt-bl');
      }
    }

    // Secondary panels (leaderboard / datastream / pitbox): opposite
    // vertical edge, same horizontal edge as the main HUD.
    var secVert  = isCenter ? 'bottom' : (isBottom ? 'top'    : 'bottom');
    var secHoriz = isCenter ? 'right'  : (isRight  ? 'right'  : 'left');

    var sec = document.getElementById('secContainer');
    if (sec) {
      sec.classList.remove('sec-top', 'sec-bottom', 'sec-left', 'sec-right');
      sec.classList.add('sec-' + secVert);
      sec.classList.add('sec-' + secHoriz);
      sec.style.marginTop = '';
      sec.style.marginBottom = '';
    }

    var lb = document.getElementById('leaderboardPanel');
    if (lb) {
      lb.classList.remove('lb-top', 'lb-bottom', 'lb-left', 'lb-right');
      lb.classList.add('lb-' + secVert, 'lb-' + secHoriz);
    }
    var ds = document.getElementById('datastreamPanel');
    if (ds) {
      ds.classList.remove('ds-top', 'ds-bottom', 'ds-left', 'ds-right');
      ds.classList.add('ds-' + secVert, 'ds-' + secHoriz);
    }
    var pb = document.getElementById('pitBoxPanel');
    if (pb) {
      pb.classList.remove('pb-top', 'pb-bottom', 'pb-left', 'pb-right');
      pb.classList.add('pb-' + secVert, 'pb-' + secHoriz);
    }

    // Incidents: same vertical edge as the secondary container, opposite
    // horizontal edge from it (diagonal from the main HUD).
    var incHoriz = secHoriz === 'right' ? 'left' : 'right';
    var inc = document.getElementById('incidentsPanel');
    if (inc) {
      inc.classList.remove('inc-top', 'inc-bottom', 'inc-left', 'inc-right');
      inc.classList.add('inc-' + secVert);
      inc.classList.add('inc-' + incHoriz);
      // Force every position property — Electron/CEF can hold stale
      // values after a class swap.
      inc.style.top    = secVert  === 'top'    ? '' : 'auto';
      inc.style.bottom = secVert  === 'bottom' ? '' : 'auto';
      inc.style.left   = incHoriz === 'left'   ? '' : 'auto';
      inc.style.right  = incHoriz === 'right'  ? '' : 'auto';
      inc.style.marginTop = '';
      inc.style.marginBottom = '';
    }

    // Bottom Y-offset: only meaningful for bottom-anchored layouts.
    var yOff = (_settings.bottomYOffset || 0) + 'px';
    var isBottomLayout = pos.indexOf('bottom') === 0;
    if (sec)    sec.style.marginBottom    = isBottomLayout ? yOff : '';
    if (inc)    inc.style.marginBottom    = isBottomLayout ? yOff : '';
    if (cmtCol) cmtCol.style.marginBottom = isBottomLayout ? yOff : '';
    var gameLogoEl = document.getElementById('gameLogoOverlay');
    if (gameLogoEl) gameLogoEl.style.marginBottom = isBottomLayout ? yOff : '';
  }
  window.applyLayout = applyLayout;

  function applyZoom(val) {
    // Zoom hotkeys / visual presets call this directly. When the v2
    // engine owns the layout, route through it instead — it re-derives
    // every group position from the new scale; zooming the legacy
    // element list underneath it would double-zoom adopted panels.
    if (window.K10LayoutV2 && window.K10LayoutV2.isActive()) {
      window.K10LayoutV2.setZoom(val);
      return;
    }
    var scale = (val || 100) / 100;
    document.documentElement.style.setProperty('--dash-zoom', scale);

    // --edge controls fixed-element margins. At zoom > 1, raw --edge
    // gives a smaller visual gap, so we publish --edge-z = base-edge / scale
    // for CSS to consume on zoomed elements.
    var baseEdge = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--edge'), 10) || 10;
    document.documentElement.style.setProperty('--edge-z', (baseEdge / scale) + 'px');

    var ids = ['dashboard', 'incidentsPanel', 'spotterPanel', 'commentaryCol', 'rcBanner', 'secContainer'];
    ids.forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.style.zoom = scale;
    });
  }
  window.applyZoom = applyZoom;

  // Logo subtitle: small text under the K10 logo square. The setting
  // ships from the host but no DOM was wired before; insert lazily so
  // the logo column doesn't grow when the subtitle is empty.
  function applyLogoSubtitle() {
    var k10 = document.getElementById('k10LogoSquare');
    if (!k10) return;
    var subtitle = (_settings.logoSubtitle || '').trim();
    var el = document.getElementById('k10LogoSubtitle');
    if (!subtitle) {
      if (el) el.remove();
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.id = 'k10LogoSubtitle';
      el.className = 'logo-subtitle';
      k10.parentNode.insertBefore(el, k10.nextSibling);
    }
    el.textContent = subtitle;
  }
  window.applyLogoSubtitle = applyLogoSubtitle;

  // Section class/id → element finder
  function _findSectionEls(sectionKey) {
    // Try as ID first, then as class
    let el = document.getElementById(sectionKey);
    if (el) return [el];
    return Array.from(document.querySelectorAll('.' + sectionKey));
  }

  // Settings key → CSS selector(s) for the panel(s) that key shows/hides.
  // Replaces the old [data-key]/[data-section] markup-driven mechanism
  // (the in-overlay settings UI that emitted those attributes is gone).
  // Anything in this map participates in module visibility — adding a
  // new toggle on the host side requires a row here too, otherwise
  // toggling it does nothing visible.
  var _MODULE_VISIBILITY = {
    showControls:    '.car-controls',
    showPedals:      '.pedals-area',
    showPosition:    '.pos-gaps-col, .rating-pos-block, .gaps-block',
    showTacho:       '.tacho-block',
    showMaps:        '.maps-col',
    showTimer:       '.race-timer-block',
    showCommentary:  '#commentaryCol',
    showLeaderboard: '#leaderboardPanel',
    showDatastream:  '#datastreamPanel',
    showPitBox:      '#pitBoxPanel',
    showIncidents:   '#incidentsPanel',
    showSpotter:     '#spotterPanel',
    showK10Logo:     '#k10LogoSquare',
    showCarLogo:     '#carLogoSquare',
    showGameLogo:    '#gameLogoOverlay',
  };

  function applySettings() {
    // Module visibility: apply .section-hidden directly to each
    // mapped panel based on the host's show* booleans.
    Object.keys(_MODULE_VISIBILITY).forEach(function(key) {
      var on = _settings[key] !== false;
      document.querySelectorAll(_MODULE_VISIBILITY[key]).forEach(function(el) {
        el.classList.toggle('section-hidden', !on);
      });
    });

    // Legacy [data-key]/[data-section] toggles — kept as a fallback in
    // case any in-overlay surface (Stream Deck companion, debug HUD)
    // still emits them. Cheap when the selector matches nothing.
    document.querySelectorAll('.settings-toggle[data-key]').forEach(function(t) {
      var key = t.dataset.key;
      var on = _settings[key] !== false;
      t.classList.toggle('on', on);
      _findSectionEls(t.dataset.section).forEach(function(el) {
        el.classList.toggle('section-hidden', !on);
      });
    });

    // Parent column collapse: hide wrappers when all children hidden
    _collapseParentColumns();

    // SimHub URL override — only honour the saved value if it actually
    // looks like our plugin endpoint (i.e. has the plugin path on the
    // end). Earlier host versions saved bare host:port (e.g.
    // "http://localhost:8889"), which 404s on the SimHub root and
    // produces empty-but-shaped responses — every panel sits at zero
    // and the HUD looks dead even though poll-engine "succeeds". Fall
    // back to the canonical SIMHUB_URL when the saved value is bare.
    if (_settings.simhubUrl
        && _settings.simhubUrl !== SIMHUB_URL
        && /\/racecor-io-pro-drive\/?$/.test(_settings.simhubUrl)) {
      window._simhubUrlOverride = _settings.simhubUrl;
    } else {
      window._simhubUrlOverride = null;
    }

    // WebGL effects toggle
    const webglOn = _settings.showWebGL !== false;
    document.querySelectorAll('.gl-overlay').forEach(c => {
      c.style.display = webglOn ? '' : 'none';
    });

    // Ambient light mode — migrate legacy boolean to 3-way string
    if (typeof _settings.showAmbientLight === 'boolean') {
      _settings.ambientMode = _settings.showAmbientLight ? 'reflective' : 'off';
      delete _settings.showAmbientLight;
    }
    // Ambient mode lifecycle. The legacy applyAmbientMode helper lived
    // in connections.js (deleted with the in-overlay UI). Inline the
    // tiny dispatch here so 'off'/'auto'/anything-else flips the ambient
    // light render loop on/off via the API in ambient-light.js.
    // Ambient runs only when the setting is on AND we're in a car (_isIdle
    // false). At boot / at the menus the overlay stays dormant; poll-engine's
    // in-car enter handler starts ambient once there's live car data.
    const ambMode = _settings.ambientMode || 'auto';
    if (ambMode !== 'off' && !_isIdle) {
      if (typeof window.startAmbientLight === 'function') window.startAmbientLight();
    } else {
      if (typeof window.stopAmbientLight === 'function') window.stopAmbientLight();
    }
    // Restore saved capture region — only when ambient is on AND active.
    if (ambMode !== 'off' && !_isIdle && typeof window.restoreAmbientCapture === 'function') window.restoreAmbientCapture();

    // Bonkers pit limiter toggle
    document.body.classList.toggle('bonkers-off', _settings.showBonkers === false);

    // Layout — v2 (data-driven groups written by the host's preview
    // editor) when the settings carry a v2 block and the engine has its
    // registry; legacy corner derivation otherwise. The v2 engine owns
    // zoom for everything it reparents (per-group style.zoom), so the
    // legacy zoom pass must not run alongside it — that would
    // double-zoom the moved panels. apply() returning false (registry
    // still loading) falls through to legacy for this tick; the engine
    // re-applies on its own once the registry lands.
    const zoomVal = _settings.zoom || 100;
    var _lv2 = window.K10LayoutV2;
    var _v2Active = !!(_lv2
      && _settings.layout
      && _settings.layout.version === 2
      && _lv2.apply(_settings.layout, { zoom: zoomVal }));
    if (!_v2Active) {
      if (_lv2) _lv2.restore();
      applyLayout();
      applyZoom(zoomVal);
    }

    // Logo Subtitle
    if (typeof applyLogoSubtitle === 'function') applyLogoSubtitle();

    // Force flag
    _forceFlagState = _settings.forceFlag || '';

    // Rally mode
    _rallyModeEnabled = _settings.rallyMode || false;
    _isRally = isRallyGame() || _rallyModeEnabled;

    // Drive mode
    if (_settings.driveMode && typeof setDriveMode === 'function') setDriveMode(true);

    // Datastream field toggles
    applyDsFieldToggles();

    // Theme — sync body attribute for CSS variable theming
    const theme = _settings.theme || 'dark';
    document.body.setAttribute('data-theme', theme);

    // Visual mode classes. Host's segmented control writes "minimal+"
    // (the "plus" rendering match the user-visible label) — accept both
    // that and the older "minimal-plus" key so existing on-disk JSON
    // still maps to the right body class.
    const preset = _settings.visualPreset || 'standard';
    document.body.classList.remove('mode-minimal', 'mode-minimal-plus');
    if (preset === 'minimal') {
      document.body.classList.add('mode-minimal');
    } else if (preset === 'minimal+' || preset === 'minimal-plus') {
      document.body.classList.add('mode-minimal-plus');
    }
  }

  function _collapseParentColumns() {
    // When a visual preset mode is active, CSS rules in modes.css handle all
    // visibility. Skip the section-hidden collapse logic to avoid interfering.
    if (document.body.classList.contains('mode-minimal') || document.body.classList.contains('mode-minimal-plus')) {
      return;
    }

    // Controls + Pedals share controls-pedals-block
    const cpBlock = document.querySelector('.controls-pedals-block');
    if (cpBlock) {
      const ctrlHidden = _settings.showControls === false;
      const pedalsHidden = _settings.showPedals === false;
      cpBlock.classList.toggle('section-hidden', ctrlHidden && pedalsHidden);
    }
    // Logo column: hide if both logos hidden
    const logoCol = document.querySelector('.logo-col');
    if (logoCol) {
      const k10Hidden = _settings.showK10Logo === false;
      const carHidden = _settings.showCarLogo === false;
      logoCol.classList.toggle('section-hidden', k10Hidden && carHidden);
    }
  }

  // ── Datastream field toggles ──

  function applyDsFieldToggles() {
    document.querySelectorAll('[data-ds-field]').forEach(el => {
      const key = el.dataset.dsField;
      const show = _settings[key] !== false;
      el.style.display = show ? '' : 'none';
    });
  }

  // ── Visual mode presets (Minimal, Minimal+, Standard) ──
  function applyVisualPreset(preset) {
    _settings.visualPreset = preset;

    // Remove all mode classes
    document.body.classList.remove('mode-minimal', 'mode-minimal-plus');

    if (preset === 'minimal') {
      document.body.classList.add('mode-minimal');
      // Set all effect toggles to off for Minimal mode
      _settings.showWebGL = false;
      _settings.ambientMode = 'off';
      _settings.showBorders = false;
      _settings.showSentimentHalo = false;
      _settings.showCommentaryGlow = false;
      _settings.showRcAnimation = false;
      _settings.showMapGlow = false;
      _settings.showRedlineFlash = false;
      _settings.showBonkers = false;
      _settings.showK10Logo = false;
      _settings.showCarLogo = false;
      _settings.showGameLogo = false;
    } else if (preset === 'minimal+' || preset === 'minimal-plus') {
      document.body.classList.add('mode-minimal-plus');
      // Racing-educated Tufte: data-reactive effects on, static decoration off
      _settings.showWebGL = true;  // but CSS reduces intensity to 60%
      _settings.ambientMode = 'off';
      _settings.showBorders = false;
      _settings.showSentimentHalo = true;  // but CSS reduces to 40% alpha
      _settings.showCommentaryGlow = false;
      _settings.showRcAnimation = true;    // flag animation settles after 4s
      _settings.showMapGlow = true;
      _settings.showRedlineFlash = true;
      _settings.showBonkers = false;
      _settings.showK10Logo = false;
      _settings.showCarLogo = true;  // contextual data for broadcast
      _settings.showGameLogo = false;
    } else {
      // Standard — restore defaults
      _settings.showWebGL = true;
      _settings.ambientMode = 'reflective';
      _settings.showBorders = true;
      _settings.showSentimentHalo = true;
      _settings.showCommentaryGlow = true;
      _settings.showRcAnimation = true;
      _settings.showMapGlow = true;
      _settings.showRedlineFlash = true;
      _settings.showBonkers = true;
      _settings.showK10Logo = true;
      _settings.showCarLogo = true;
      _settings.showGameLogo = true;
      // When switching back to standard, ensure mode classes are removed
      // so _collapseParentColumns() can properly restore column states
      document.body.classList.remove('mode-minimal', 'mode-minimal-plus');
    }

    // Sync UI toggles and save. saveSettings only exists when the
    // legacy in-overlay UI is loaded; otherwise the WinUI host is the
    // canonical writer and this path is dead.
    applySettings();
    if (typeof saveSettings === 'function') saveSettings();
  }

  // ── Theme switching ──
  function updateTheme(value) {
    _settings.theme = value || 'dark';
    document.body.setAttribute('data-theme', _settings.theme);
    // Notify token loader to update (if loaded)
    if (window.tokenLoader && typeof window.tokenLoader.setTheme === 'function') {
      window.tokenLoader.setTheme(_settings.theme);
    }
    if (typeof saveSettings === 'function') saveSettings();
  }

  // ── Commentary settings (authoritative copy in _settings; relayed to plugin) ──
  // The web app is the authoritative editor — values live in the overlay settings
  // file under `commentary*` keys. We relay every change to the SimHub plugin via
  // the same setSetting action it already consumes, so the plugin's
  // commentary-filter pipeline keeps working unchanged.
  function updateCommentarySetting(key, value) {
    var url = (window._simhubUrlOverride || SIMHUB_URL) + '?action=setSetting&key=' + encodeURIComponent(key) + '&value=' + encodeURIComponent(value);
    fetch(url).catch(function() {});
  }

  // Map from the prefixed OverlaySettings keys (the web UI edits these) to
  // the plugin-facing names the SimHub setSetting endpoint expects. When the
  // commentary keys change in settings, we POST each to the plugin.
  var _COMMENTARY_PLUGIN_MAP = {
    commentaryPromptDuration:   'promptDuration',
    commentaryShowTopicTitle:   'showTopicTitle',
    commentaryEventOnlyMode:    'eventOnlyMode',
    commentaryCatStrategy:      'category_strategy',
    commentaryCatTrack:         'category_track',
    commentaryCatRivals:        'category_rivals',
    commentaryCatBehavior:      'category_behavior',
    commentaryCatHardware:      'category_hardware',
    commentaryCatGameFeel:      'category_game_feel',
    commentaryCatCarResponse:   'category_car_response',
    commentaryCatRacingExperience: 'category_racing_experience',
    commentaryDriverFirstName:  'driverFirstName',
    commentaryDriverLastName:   'driverLastName',
    commentaryDemoMode:         'demoMode',
  };
  // Booleans get coerced to '1'/'0' to match the plugin's string parser.
  function _relayCommentaryToPlugin(settings) {
    if (!settings) return;
    Object.keys(_COMMENTARY_PLUGIN_MAP).forEach(function(localKey) {
      if (!(localKey in settings)) return;
      var pluginKey = _COMMENTARY_PLUGIN_MAP[localKey];
      var raw = settings[localKey];
      var val = (typeof raw === 'boolean') ? (raw ? '1' : '0') : String(raw);
      updateCommentarySetting(pluginKey, val);
    });
  }

  // ── Cold-start load ──
  // Pull the host's persisted overlay-settings.json once on boot, merge
  // into the renderer's _settings (which defaults to _defaultSettings
  // from config.js), and apply. Without this, the overlay ignores
  // saved settings until the user toggles something — at which point
  // the watcher fires settings-sync. Run on DOMContentLoaded so the
  // panels applySettings() touches actually exist in the DOM.
  function _loadInitialSettings() {
    if (!window.k10 || !window.k10.getSettings) {
      // No bridge (running in a browser tab for dev) — apply defaults.
      try { applySettings(); } catch (e) { console.warn('[settings] initial apply failed:', e); }
      return;
    }
    window.k10.getSettings().then(function(saved) {
      if (saved && typeof saved === 'object') {
        Object.assign(_settings, saved);
      }
      try { applySettings(); } catch (e) { console.warn('[settings] initial apply failed:', e); }
      _relayCommentaryToPlugin(_settings);
    }).catch(function(err) {
      console.warn('[settings] initial getSettings failed:', err);
      try { applySettings(); } catch (e) {}
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _loadInitialSettings);
  } else {
    _loadInitialSettings();
  }

  // ── Cross-window settings sync ──
  // When the host changes settings on disk, apply them here, and relay
  // any commentary keys to the SimHub plugin so its filtering stays in sync.
  if (window.k10 && window.k10.onSettingsSync) {
    window.k10.onSettingsSync(function(newSettings) {
      if (newSettings && typeof newSettings === 'object') {
        Object.assign(_settings, newSettings);
        applySettings();
        _relayCommentaryToPlugin(newSettings);
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
