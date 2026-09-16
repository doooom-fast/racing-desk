// ═══════════════════════════════════════════════════════════════
// TOKEN LOADER — Remote Design Token CSS from K10 Pro Drive API
// ═══════════════════════════════════════════════════════════════
//
// Fetches built CSS token files from the web API and injects them
// into the overlay as a <style> block. Remote CSS sits after all
// local <link> tags in the cascade, so it overrides local defaults.
//
// Polling checks for hash changes every 5 minutes. If the network
// is unreachable the overlay keeps its current styles (graceful
// degradation). A local cache is saved via Electron IPC when
// available, providing a fallback for offline launches.

(function () {
  'use strict';

  // ── Constants ──
  const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  const STYLE_ID = 'remote-tokens';
  const CACHE_KEY = 'k10-token-css-cache';

  // ── State ──
  let _currentHash = null;
  let _pollTimer = null;
  let _apiBase = '';
  let _theme = 'dark';
  let _enabled = true;

  // ── Public API ──

  /**
   * Initialise the token loader. Called once on DOMContentLoaded.
   * Reads settings from the global _settings object (set by config.js).
   */
  function initTokenLoader() {
    _enabled = _settings.useRemoteTokens !== false;
    _theme = _settings.theme || 'dark';
    _apiBase = _settings.apiBase || 'https://prodrive.racecor.io';

    if (!_enabled) {
      console.log('[token-loader] Remote tokens disabled by settings');
      return;
    }

    // Apply data-theme attribute for CSS theme selectors
    document.body.setAttribute('data-theme', _theme);

    // Try loading cached CSS first (instant, no network)
    _loadCachedCss().then(function () {
      // Then fetch fresh from API (may update or confirm cache)
      return _fetchAndApply();
    }).catch(function (err) {
      console.warn('[token-loader] Init error:', err.message);
    });

    // Start polling for updates
    _startPolling();
  }

  /**
   * Fetch token metadata from the API.
   * Returns { overlay: { url, hash }, web: { url, hash } } or null.
   */
  async function _fetchTokenMeta() {
    try {
      var url = _apiBase + '/api/tokens/current';
      var res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (err) {
      console.warn('[token-loader] Failed to fetch token meta:', err.message);
      return null;
    }
  }

  /**
   * Fetch CSS content from a blob URL.
   */
  async function _fetchTokenCss(blobUrl) {
    try {
      var res = await fetch(blobUrl, { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.text();
    } catch (err) {
      console.warn('[token-loader] Failed to fetch token CSS:', err.message);
      return null;
    }
  }

  /**
   * Inject or update the <style> block with token CSS.
   */
  function _injectTokenCss(css) {
    if (!css) return;
    var el = document.getElementById(STYLE_ID);
    if (!el) {
      el = document.createElement('style');
      el.id = STYLE_ID;
      // Insert at end of <head> so it overrides all <link> stylesheets
      document.head.appendChild(el);
    }
    el.textContent = css;
  }

  /**
   * Full fetch → inject → cache cycle.
   */
  async function _fetchAndApply() {
    var meta = await _fetchTokenMeta();
    if (!meta || !meta.overlay) {
      console.log('[token-loader] No overlay build available');
      return;
    }

    var overlay = meta.overlay;

    // Skip if hash unchanged
    if (overlay.hash === _currentHash) {
      return;
    }

    var css = await _fetchTokenCss(overlay.url);
    if (!css) return;

    _injectTokenCss(css);
    _currentHash = overlay.hash;
    _saveCachedCss(css, overlay.hash);

    console.log('[token-loader] Applied remote tokens (hash: ' + overlay.hash + ')');
  }

  // ── Polling ──

  function _startPolling() {
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = setInterval(function () {
      if (!_enabled) return;
      _fetchAndApply().catch(function (err) {
        console.warn('[token-loader] Poll error:', err.message);
      });
    }, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (_pollTimer) {
      clearInterval(_pollTimer);
      _pollTimer = null;
    }
  }

  // ── Cache (Electron IPC or localStorage) ──

  async function _loadCachedCss() {
    var cached = null;

    // Try Electron IPC first
    if (window.k10 && window.k10.getSettings) {
      var settings = await window.k10.getSettings();
      if (settings && settings._tokenCssCache) {
        cached = settings._tokenCssCache;
      }
    }

    // Fallback to localStorage
    if (!cached) {
      try {
        cached = JSON.parse(localStorage.getItem(CACHE_KEY));
      } catch (e) {}
    }

    if (cached && cached.css) {
      _injectTokenCss(cached.css);
      _currentHash = cached.hash || null;
      console.log('[token-loader] Loaded cached tokens (hash: ' + (_currentHash || 'unknown') + ')');
    }
  }

  function _saveCachedCss(css, hash) {
    var payload = { css: css, hash: hash, savedAt: Date.now() };

    // Save to Electron settings alongside user settings
    if (window.k10 && window.k10.getSettings && window.k10.saveSettings) {
      window.k10.getSettings().then(function (settings) {
        if (settings) {
          settings._tokenCssCache = payload;
          window.k10.saveSettings(settings);
        }
      }).catch(function () {});
    }

    // Also save to localStorage as fallback
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    } catch (e) {}
  }

  // ── Theme ──

  /**
   * Switch the active theme. Updates the body attribute and re-fetches
   * if the theme has changed (future: per-theme blob URLs).
   */
  function setTheme(theme) {
    _theme = theme || 'dark';
    document.body.setAttribute('data-theme', _theme);
    _settings.theme = _theme;
    if (typeof saveSettings === 'function') saveSettings();
  }

  /**
   * Force a refresh of remote tokens (e.g. after admin publishes new build).
   */
  async function refresh() {
    _currentHash = null; // Reset hash to force re-fetch
    await _fetchAndApply();
  }

  // ── Auto-init on DOMContentLoaded ──
  document.addEventListener('DOMContentLoaded', function () {
    // Wait a tick for config.js settings to load
    setTimeout(initTokenLoader, 100);
  });

  // ── Expose global API ──
  window.tokenLoader = {
    init: initTokenLoader,
    refresh: refresh,
    setTheme: setTheme,
    stop: stopPolling,
  };

})();
