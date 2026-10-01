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
    var k10 = document.getElementById('brandLogoSquare');
    if (!k10) return;
    var subtitle = (_settings.logoSubtitle || '').trim();
    var el = document.getElementById('brandLogoSubtitle');
    if (!subtitle) {
      if (el) el.remove();
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.id = 'brandLogoSubtitle';
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
    showK10Logo:     '#brandLogoSquare',
    showCarLogo:     '#carLogoSquare',
    showGameLogo:    '#gameLogoOverlay',
  };

  function applySettings() {
    // Module visibility: apply .section-hidden directly to each
    // mapped panel based on the host's show* booleans. They choose what the rig's screen shows over the game; the
    // glance layout (drive mode, and the iPad: drive-view.css) is every panel, whatever they say.
    var driveMode = document.body.classList.contains('drive-mode-active');
    Object.keys(_MODULE_VISIBILITY).forEach(function(key) {
      var on = driveMode || _settings[key] !== false;
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
    //
    // Not on a page served over the network (remote-server.js), nor on the one OBS draws: there the telemetry is
    // wherever the page came from, which the server said before any of this ran. SIMHUB_URL is this machine's
    // localhost — on an iPad, the iPad.
    if (window._remoteMode || window._obsMode) {
      // keep what the server gave
    } else if (_settings.simhubUrl
        && _settings.simhubUrl !== SIMHUB_URL
        && /\/racing-desk\/?$/.test(_settings.simhubUrl)) {
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

    // Panel background
    applyPanelBackground();

    // Layout — one arrangement, placed by the position choice. A `layout` block left in the settings by
    // the old group editor is ignored.
    applyLayout();

    // Zoom
    applyZoom(_settings.zoom || 100);

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

  // ── Panel background ──
  // How solid the panels' own background is (the base fill and the glass), 0 to 100: "Panel background" in Settings →
  // Look for the rig's HUD and the iPad view (`panelBackground`), and a slider of its own for the HUD drawn by OBS
  // (`obsPanelBackground`, with the "HUD drawn by OBS" setting, read by the page OBS draws alone, so the recording can
  // be clearer or more see-through than what he drives with). 90 is what the panels have always been. base.css turns
  // --panel-alpha into the fills, the glass and, under 90 (body.panels-thin), the soft shadow under the numbers.
  var PANEL_BACKGROUND_DEFAULT = 90;
  function panelBackgroundOf(value) {
    var n = typeof value === 'number' && !isNaN(value) ? value : PANEL_BACKGROUND_DEFAULT;
    return Math.min(100, Math.max(0, n));
  }
  function panelBackgroundNow() {
    return panelBackgroundOf(window._obsMode ? _settings.obsPanelBackground : _settings.panelBackground);
  }
  window.panelBackgroundNow = panelBackgroundNow;
  function applyPanelBackground() {
    var pct = panelBackgroundNow();
    document.documentElement.style.setProperty('--panel-alpha', String(Math.round(pct) / 100));
    document.body.classList.toggle('panels-thin', pct < PANEL_BACKGROUND_DEFAULT);
  }
  window.applyPanelBackground = applyPanelBackground;

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
    if (typeof saveSettings === 'function') saveSettings();
  }

  // ── Commentary settings ──
  // The web app is the authoritative editor — values live in the overlay settings file under `commentary*` keys. They
  // used to be relayed to the SimHub plugin through ?action=setSetting; the runtime has no such route and never had one
  // in the C# runtime (the request was answered with the telemetry, and did nothing), and the app's main process passes
  // on only the routes the runtime has (runtime-actions.js), so the relay is gone and not kept as a call that is certain
  // to be refused.

  // ── Cold-start load ──
  // Pull the host's persisted overlay-settings.json once on boot, merge
  // into the renderer's _settings (which defaults to _defaultSettings
  // from config.js), and apply. Without this, the overlay ignores
  // saved settings until the user toggles something — at which point
  // the watcher fires settings-sync. Run on DOMContentLoaded so the
  // panels applySettings() touches actually exist in the DOM.
  function _loadInitialSettings() {
    if (window._obsMode || window._remoteMode) {
      // The pages OBS draws (remote-server.js, /obs and /obs-ipad) and the iPad's: what the server lets through of his
      // settings came with the page (the display allowlist for OBS; the panel background alone for the iPad), and is
      // asked for again every ten seconds from the same server, so a change made on the desk reaches this copy of the
      // HUD too. Nothing else of the settings file is ever sent here.
      _applyDisplaySettings(window._displaySettings);
      if (typeof window._displaySettingsUrl === 'string' && typeof fetch === 'function') {
        setInterval(function () {
          fetch(window._displaySettingsUrl, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; })
            .then(function (saved) { if (saved) _applyDisplaySettings(saved); })
            .catch(function () {});
        }, Number(window._displaySettingsEveryMs) > 0 ? Number(window._displaySettingsEveryMs) : 10000);
      }
      return;
    }
    if (!window.racingDesk || !window.racingDesk.getSettings) {
      // No bridge (running in a browser tab for dev) — apply defaults.
      try { applySettings(); } catch (e) { console.warn('[settings] initial apply failed:', e); }
      return;
    }
    window.racingDesk.getSettings().then(function(saved) {
      if (saved && typeof saved === 'object') {
        Object.assign(_settings, saved);
      }
      try { applySettings(); } catch (e) { console.warn('[settings] initial apply failed:', e); }
    }).catch(function(err) {
      console.warn('[settings] initial getSettings failed:', err);
      try { applySettings(); } catch (e) {}
    });
  }
  // What the page was given, applied — only when it differs from what it has, so that the ten-second ask does not
  // redraw a HUD that has not changed.
  var _displayApplied = null;
  function _applyDisplaySettings(saved) {
    if (!saved || typeof saved !== 'object') { try { applySettings(); } catch (e) {} return; }
    var text = JSON.stringify(saved);
    if (text === _displayApplied) return;
    _displayApplied = text;
    Object.assign(_settings, saved);
    try { applySettings(); } catch (e) { console.warn('[settings] apply failed:', e); }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _loadInitialSettings);
  } else {
    _loadInitialSettings();
  }

  // ── Cross-window settings sync ──
  // When the host changes settings on disk, apply them here.
  if (window.racingDesk && window.racingDesk.onSettingsSync) {
    window.racingDesk.onSettingsSync(function(newSettings) {
      if (newSettings && typeof newSettings === 'object') {
        Object.assign(_settings, newSettings);
        applySettings();
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
