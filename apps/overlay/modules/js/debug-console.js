/**
 * ─────────────────────────────────────────────────────────────
 * Debug Console System
 * ─────────────────────────────────────────────────────────────
 * Provides two consoles for monitoring:
 * 1. iRacing Data Sync Console — logs iRacing sync operations
 * 2. Network Connection Console — logs web sync attempts
 *
 * Intercepts fetch calls and logs request/response details.
 */

(function() {
  'use strict';

  // ═══════════════════════════════════════════════════════════════
  //  CONSOLE LOG MANAGEMENT
  // ═══════════════════════════════════════════════════════════════

  const MAX_LOG_ENTRIES = 200;

  // Console state
  let _iRacingSyncLogs = [];
  let _networkLogs = [];
  let _fetchIntercepted = false;

  /**
   * Add entry to a console log
   */
  function _addLogEntry(logArray, type, message, metadata = {}) {
    const timestamp = new Date().toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3
    });

    const entry = {
      timestamp,
      type, // 'info', 'success', 'error', 'request', 'response'
      message,
      ...metadata
    };

    logArray.push(entry);

    // Keep only latest entries
    if (logArray.length > MAX_LOG_ENTRIES) {
      logArray.shift();
    }

    return entry;
  }

  /**
   * Render a log entry to HTML
   */
  function _renderLogEntry(entry) {
    let icon = '';
    let colorClass = '';

    switch (entry.type) {
      case 'success':
        icon = '✓';
        colorClass = 'log-success';
        break;
      case 'error':
        icon = '✗';
        colorClass = 'log-error';
        break;
      case 'request':
        icon = '→';
        colorClass = 'log-request';
        break;
      case 'response':
        icon = '←';
        colorClass = 'log-response';
        break;
      default:
        icon = '•';
        colorClass = 'log-info';
    }

    let html = `<div class="debug-log-entry ${colorClass}">`;
    html += `<span class="log-timestamp">${entry.timestamp}</span>`;
    html += `<span class="log-icon">${icon}</span>`;
    html += `<span class="log-message">${_escapeHtml(entry.message)}</span>`;

    if (entry.statusCode) {
      const statusClass = entry.statusCode >= 200 && entry.statusCode < 300 ? 'status-ok' : 'status-error';
      html += `<span class="log-status ${statusClass}">${entry.statusCode}</span>`;
    }

    html += '</div>';
    return html;
  }

  /**
   * Simple HTML escape
   */
  function _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Update a console UI element with rendered logs
   */
  function _renderConsole(logArray, containerEl) {
    if (!containerEl) return;

    containerEl.innerHTML = '';
    logArray.forEach(entry => {
      containerEl.innerHTML += _renderLogEntry(entry);
    });

    // Auto-scroll to bottom
    containerEl.scrollTop = containerEl.scrollHeight;
  }

  /**
   * Clear console logs
   */
  function _clearConsole(logArray) {
    logArray.length = 0;
  }

  // ═══════════════════════════════════════════════════════════════
  //  PUBLIC API FOR LOGGING
  // ═══════════════════════════════════════════════════════════════

  window.debugConsole = {
    /**
     * Log to iRacing Data Sync console
     */
    logIRacingSync: function(type, message, metadata) {
      _addLogEntry(_iRacingSyncLogs, type, message, metadata);
      const container = document.getElementById('iRacingSyncConsole');
      if (container) {
        _renderConsole(_iRacingSyncLogs, container);
      }
    },

    /**
     * Log to Network Connection console
     */
    logNetwork: function(type, message, metadata) {
      _addLogEntry(_networkLogs, type, message, metadata);
      const container = document.getElementById('networkConnectionConsole');
      if (container) {
        _renderConsole(_networkLogs, container);
      }
    },

    /**
     * Clear iRacing sync console
     */
    clearIRacingSync: function() {
      _clearConsole(_iRacingSyncLogs);
      const container = document.getElementById('iRacingSyncConsole');
      if (container) container.innerHTML = '';
    },

    /**
     * Clear network console
     */
    clearNetwork: function() {
      _clearConsole(_networkLogs);
      const container = document.getElementById('networkConnectionConsole');
      if (container) container.innerHTML = '';
    },

    /**
     * Render all logs to their containers
     */
    render: function() {
      _renderConsole(_iRacingSyncLogs, document.getElementById('iRacingSyncConsole'));
      _renderConsole(_networkLogs, document.getElementById('networkConnectionConsole'));
    }
  };

  // ═══════════════════════════════════════════════════════════════
  //  FETCH INTERCEPTION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Intercept all fetch calls to log request/response details
   */
  function _interceptFetch() {
    if (_fetchIntercepted) return;
    _fetchIntercepted = true;

    const originalFetch = window.fetch;

    window.fetch = function(...args) {
      const url = typeof args[0] === 'string' ? args[0] : args[0].url;
      const options = typeof args[1] === 'object' ? args[1] : {};
      const method = (options.method || 'GET').toUpperCase();

      // Determine which console to log to
      let isIRacingSync = false;
      let isNetworkSync = false;

      if (url.includes('/api/sessions') || url.includes('/api/ratings') || url.includes('/api/iracing') || url.includes('/api/plugin-auth')) {
        isIRacingSync = true;
      } else if (url.includes('prodrive.racecor.io')) {
        isNetworkSync = true;
      }

      // Log request
      if (isIRacingSync) {
        window.debugConsole.logIRacingSync('request', `${method} ${url}`);
      } else if (isNetworkSync) {
        window.debugConsole.logNetwork('request', `${method} ${url}`);
      }

      // Call original fetch and intercept response
      return originalFetch.apply(this, args)
        .then(function(response) {
          const statusCode = response.status;
          const statusText = response.statusText;
          const isSuccess = response.ok;

          // Clone response to read body without consuming it
          const clonedResponse = response.clone();

          if (isIRacingSync) {
            window.debugConsole.logIRacingSync(
              isSuccess ? 'success' : 'error',
              `${method} ${url} → ${statusCode} ${statusText}`,
              { statusCode }
            );
          } else if (isNetworkSync) {
            window.debugConsole.logNetwork(
              isSuccess ? 'success' : 'error',
              `${method} ${url} → ${statusCode} ${statusText}`,
              { statusCode }
            );
          }

          return response;
        })
        .catch(function(error) {
          const message = error.message || String(error);

          if (isIRacingSync) {
            window.debugConsole.logIRacingSync(
              'error',
              `${method} ${url} → ERROR: ${message}`
            );
          } else if (isNetworkSync) {
            window.debugConsole.logNetwork(
              'error',
              `${method} ${url} → ERROR: ${message}`
            );
          }

          throw error;
        });
    };
  }

  // Start intercepting fetch when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _interceptFetch);
  } else {
    _interceptFetch();
  }
})();
