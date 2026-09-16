// ═══════════════════════════════════════════════════════════════
// K10 Motorsports — Game Logo Overlay
// Shows the current game's logo (iRacing, etc.) in the
// corner opposite the main dashboard layout position.
// ═══════════════════════════════════════════════════════════════

(function() {
  'use strict';

  var _logoEl = null;
  var _currentSvg = '';
  var _currentGameId = '';
  var _visible = false;
  var _customLogoUrl = null;
  var _loadAttempted = {};  // { gameId: true } — prevents retry spam on 404

  // Map game IDs to SVG filenames
  var GAME_LOGO_FILES = {
    'iracing': 'iracing.svg'
  };

  // Logo-corner mapping: dashboard position → logo position
  // Logo goes on the opposite vertical edge AND opposite horizontal side
  // to avoid overlap with the dashboard.
  var OPPOSITE_CORNER = {
    'top-right':       'bottom-left',
    'top-left':        'bottom-right',
    'bottom-right':    'top-left',
    'bottom-left':     'top-right',
    'absolute-center': 'bottom-left'
  };

  // CSS class map for positioning
  // When dashboard is at bottom (bottom-left/bottom-right), logo must clear
  // the 200px dashboard height + 10px gap, so position at bottom:210px.
  // Otherwise use 10px from top edges.
  var POS_STYLES = {
    'top-left':     'top:10px;left:10px;',
    'top-right':    'top:10px;right:10px;',
    'bottom-left':  'bottom:210px;left:10px;',
    'bottom-right': 'bottom:210px;right:10px;'
  };

  function createLogoElement() {
    if (_logoEl) return;
    _logoEl = document.createElement('div');
    _logoEl.id = 'gameLogoOverlay';
    _logoEl.style.cssText =
      'position:fixed;z-index:50;width:180px;pointer-events:none;' +
      'opacity:0;transition:opacity 0.4s ease;' +
      'display:flex;align-items:center;justify-content:center;';
    document.body.appendChild(_logoEl);
  }

  function updatePosition() {
    if (!_logoEl) return;
    // Read from global _settings object (not window._settings)
    // _settings is exposed as a global from config.js
    var layoutPos = (_settings && _settings.layoutPosition) || 'top-right';
    var logoPos = OPPOSITE_CORNER[layoutPos] || 'bottom-left';
    var style = POS_STYLES[logoPos] || POS_STYLES['bottom-left'];
    // Reset all positioning
    _logoEl.style.top = '';
    _logoEl.style.right = '';
    _logoEl.style.bottom = '';
    _logoEl.style.left = '';
    // Apply new position
    var parts = style.split(';').filter(Boolean);
    parts.forEach(function(p) {
      var kv = p.split(':');
      if (kv.length === 2) _logoEl.style[kv[0].trim()] = kv[1].trim();
    });
  }

  function loadSvg(gameId) {
    // Check if custom logo is set first
    if (_customLogoUrl) {
      loadCustomLogo();
      return;
    }

    var file = GAME_LOGO_FILES[gameId];
    if (!file) {
      // No logo for this game
      if (_logoEl) _logoEl.style.opacity = '0';
      _currentGameId = gameId;
      _currentSvg = '';
      return;
    }
    if (gameId === _currentGameId && (_currentSvg || _loadAttempted[gameId])) {
      // Already loaded or already failed — don't retry
      if (_visible && _logoEl && _currentSvg) _logoEl.style.opacity = '0.5';
      return;
    }
    _currentGameId = gameId;

    // Resolve path — works from both file:// and http://
    var basePath = '';
    if (window._simhubUrlOverride) {
      // Remote mode: assets served from root
      basePath = '/';
    }
    var url = basePath + 'images/logos/' + file;

    fetch(url)
      .then(function(r) { return r.ok ? r.text() : ''; })
      .then(function(svg) {
        if (!svg || gameId !== _currentGameId) return;
        _currentSvg = svg;
        if (_logoEl) {
          _logoEl.innerHTML = svg;
          // Style the SVG element
          var svgEl = _logoEl.querySelector('svg');
          if (svgEl) {
            svgEl.style.width = '100%';
            svgEl.style.height = 'auto';
            svgEl.style.maxHeight = '80px';
          }
          if (_visible) _logoEl.style.opacity = '0.5';
        }
      })
      .catch(function() { _loadAttempted[gameId] = true; });
  }

  function loadCustomLogo() {
    if (!_customLogoUrl || !_logoEl) return;

    _currentSvg = '';
    _logoEl.innerHTML = '';

    // Check if it's an SVG or raster image
    var isSvg = _customLogoUrl.toLowerCase().endsWith('.svg');

    if (isSvg) {
      // Fetch and inject SVG
      fetch(_customLogoUrl)
        .then(function(r) { return r.ok ? r.text() : ''; })
        .then(function(svg) {
          if (!svg || !_customLogoUrl) return;
          _currentSvg = svg;
          if (_logoEl) {
            _logoEl.innerHTML = svg;
            var svgEl = _logoEl.querySelector('svg');
            if (svgEl) {
              svgEl.style.width = '100%';
              svgEl.style.height = 'auto';
              svgEl.style.maxHeight = '80px';
            }
            if (_visible) _logoEl.style.opacity = '0.5';
          }
        })
        .catch(function() { /* non-critical */ });
    } else {
      // Use img tag for raster images
      var img = document.createElement('img');
      img.src = _customLogoUrl;
      img.style.width = '100%';
      img.style.height = 'auto';
      img.style.maxHeight = '80px';
      img.style.borderRadius = '4px';
      img.onload = function() {
        if (_logoEl && _customLogoUrl) {
          _logoEl.innerHTML = '';
          _logoEl.appendChild(img);
          if (_visible) _logoEl.style.opacity = '0.5';
        }
      };
      img.onerror = function() { /* non-critical */ };
      _logoEl.appendChild(img);
    }
  }

  /**
   * Set custom logo URL from Pro user data
   * @param {string} url — HTTPS URL to custom logo (SVG or PNG/JPG)
   */
  window.setCustomLogoUrl = function(url) {
    _customLogoUrl = url || null;
    if (_visible && _logoEl) {
      loadSvg(_currentGameId);
    }
  };

  /**
   * Called from poll-engine on each telemetry tick.
   * @param {string} gameId — current game ID (e.g. 'iracing')
   * @param {boolean} show — whether the setting is enabled
   */
  window.updateGameLogo = function(gameId, show) {
    createLogoElement();
    _visible = show;

    if (!show || (!gameId && !_customLogoUrl)) {
      if (_logoEl) _logoEl.style.opacity = '0';
      return;
    }

    if (!show) {
      if (_logoEl) _logoEl.style.opacity = '0';
      return;
    }

    updatePosition();
    loadSvg(gameId);
  };

  // Re-position when layout changes
  var _origApplyLayout = window.applyLayout;
  if (typeof _origApplyLayout === 'function') {
    window.applyLayout = function() {
      _origApplyLayout.apply(this, arguments);
      updatePosition();
    };
  }
  // Also listen for settings changes
  window.addEventListener('k10-layout-changed', updatePosition);

  // Ensure position is updated when applySettings is called
  // (which loads _settings from localStorage)
  var _origApplySettings = window.applySettings;
  if (typeof _origApplySettings === 'function') {
    window.applySettings = function() {
      _origApplySettings.apply(this, arguments);
      // Update logo position after settings are applied
      if (_logoEl) {
        updatePosition();
      }
    };
  }
})();
