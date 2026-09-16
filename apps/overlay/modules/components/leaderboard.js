/**
 * @element racecor-leaderboard
 * @description Full leaderboard table with Canvas sparkline history and color-coded gaps.
 *
 * Displays driver rankings with position, name, gap, iRating, and lap time.
 * Includes Canvas sparklines showing lap time trends (12-sample rolling history).
 * Color-coded: player row highlighted, position changes marked, best laps colored.
 * Supports focus modes (lead/player-centered) and dynamic max rows.
 *
 * @property {Array} drivers - Array of driver objects: [pos, name, irating, bestLap, lastLap, gapToPlayer, inPit, isPlayer]
 * @property {string} playerName - Player display name (used to override name in row)
 * @property {string} focusMode - 'lead' (show from P1) or 'me' (center on player)
 * @property {number} maxRows - Maximum rows to display (default: 5)
 */

(function() {
  'use strict';

  class RaceCorLeaderboard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });

      // ── Internal state ──────────────────────────────────────────
      this._drivers = [];
      this._playerName = '';
      this._focusMode = 'me';
      this._maxRows = 5;
      this._sessionBestLap = Infinity;
      this._sparkHistory = {}; // name → [lap times]

      // ── Cached DOM refs ────────────────────────────────────────
      this._rowsContainer = null;

      // ── Event handler ────────────────────────────────────────
      this._telemetryHandler = null;
    }

    connectedCallback() {
      this._renderTemplate();
      this._cacheElements();
      this._subscribeToData();
      this.render();
    }

    disconnectedCallback() {
      if (this._telemetryHandler && window) {
        window.removeEventListener('telemetry-update', this._telemetryHandler);
        this._telemetryHandler = null;
      }
      this._sparkHistory = {};
    }

    // ╔═══════════════════════════════════════════════════════════╗
    // ║ PROPERTIES                                                 ║
    // ╚═══════════════════════════════════════════════════════════╝

    get drivers() { return this._drivers; }
    set drivers(val) { this._drivers = val || []; }

    get playerName() { return this._playerName; }
    set playerName(val) { this._playerName = val || ''; }

    get focusMode() { return this._focusMode; }
    set focusMode(val) { this._focusMode = val || 'me'; }

    get maxRows() { return this._maxRows; }
    set maxRows(val) { this._maxRows = val || 5; }

    // ╔═══════════════════════════════════════════════════════════╗
    // ║ PUBLIC API                                                 ║
    // ╚═══════════════════════════════════════════════════════════╝

    updateData(snapshot) {
      if (!snapshot) return;

      // Parse leaderboard from plugin (raw JSON array)
      let raw = snapshot['RaceCorProDrive.Plugin.Leaderboard'];
      if (typeof raw === 'string') {
        try { raw = JSON.parse(raw); } catch(e) { raw = null; }
      }

      // Hide the leaderboard panel when there's no data
      const panel = document.getElementById('leaderboardPanel');
      if (!raw || !Array.isArray(raw) || raw.length === 0) {
        if (panel) panel.classList.add('section-hidden');
        return;
      }
      if (panel) panel.classList.remove('section-hidden');

      this._drivers = raw;

      // Calculate session best lap
      let sessionBest = Infinity;
      for (let entry of raw) {
        const b = +entry[3];
        if (b > 0 && b < sessionBest) sessionBest = b;
      }
      this._sessionBestLap = sessionBest === Infinity ? 0 : sessionBest;

      this.render();
    }

    // ╔═══════════════════════════════════════════════════════════╗
    // ║ RENDERING                                                  ║
    // ╚═══════════════════════════════════════════════════════════╝

    _renderTemplate() {
      if (!this.shadowRoot) return;

      const template = document.createElement('template');
      template.innerHTML = `
        <style>
          :host {
            display: block;
            font-family: var(--ff);
            color: var(--text-primary);
            overflow: hidden;
          }

          .lb-panel {
            display: flex;
            flex-direction: column;
            height: 100%;
          }

          .lb-header {
            display: grid;
            grid-template-columns: 30px 140px 60px 40px 50px 1fr;
            gap: var(--gap);
            padding: var(--pad);
            background: var(--bg-panel);
            border-bottom: 1px solid var(--border);
            font-size: var(--fs-xs);
            font-weight: var(--fw-bold);
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }

          .lb-rows {
            flex: 1;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 2px;
            padding: 2px;
          }

          .lb-row {
            display: grid;
            grid-template-columns: 30px 140px 60px 40px 50px 1fr;
            gap: var(--gap);
            padding: var(--pad);
            background: var(--bg);
            border: 1px solid var(--border);
            border-radius: var(--corner-r);
            align-items: center;
            font-size: var(--fs-sm);
            transition: background-color 0.2s ease;
          }

          .lb-row.lb-player {
            background: var(--bg-highlight);
            border-color: var(--accent);
            font-weight: var(--fw-semi);
          }

          .lb-row.lb-pit {
            opacity: 0.6;
          }

          .lb-pos {
            font-weight: var(--fw-bold);
            color: var(--text-secondary);
            text-align: center;
          }

          .lb-name {
            color: var(--text-primary);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .lb-lap {
            font-family: var(--ff-mono);
            text-align: center;
          }

          .lb-lap.lap-pb {
            color: hsl(270, 70%, 60%);
            font-weight: var(--fw-bold);
          }

          .lb-lap.lap-fast {
            color: hsl(145, 70%, 55%);
          }

          .lb-lap.lap-slow {
            color: hsl(0, 70%, 55%);
          }

          .lb-ir {
            font-size: var(--fs-xs);
            color: var(--text-dim);
            text-align: right;
          }

          .lb-gap {
            font-family: var(--ff-mono);
            font-size: var(--fs-xs);
            text-align: right;
            font-weight: var(--fw-semi);
          }

          .lb-gap.gap-ahead {
            color: hsl(145, 70%, 55%);
          }

          .lb-gap.gap-behind {
            color: hsl(0, 70%, 55%);
          }

          .lb-gap.gap-player {
            color: transparent;
          }

          .lb-spark {
            width: 100%;
            height: 100%;
            min-width: 44px;
            min-height: 14px;
          }
        </style>

        <div class="lb-panel">
          <div class="lb-header">
            <div>Pos</div>
            <div>Driver</div>
            <div>Lap</div>
            <div>iR</div>
            <div>Gap</div>
            <div>Trend</div>
          </div>
          <div class="lb-rows"></div>
        </div>
      `;

      this.shadowRoot.appendChild(template.content.cloneNode(true));
    }

    _cacheElements() {
      if (!this.shadowRoot) return;
      this._rowsContainer = this.shadowRoot.querySelector('.lb-rows');
    }

    _subscribeToData() {
      if (!window) return;
      this._telemetryHandler = (event) => {
        if (event.detail && event.detail.snapshot) {
          this.updateData(event.detail.snapshot);
        }
      };
      window.addEventListener('telemetry-update', this._telemetryHandler);
    }

    render() {
      if (!this._rowsContainer) return;

      // Find player and calculate visible rows
      let playerIdx = -1;
      let playerLastLap = 0;
      for (let i = 0; i < this._drivers.length; i++) {
        if (this._drivers[i][7] === 1) {
          playerIdx = i;
          playerLastLap = +this._drivers[i][4]; // capture player's last lap
          break;
        }
      }

      let visible = [];
      if (this._focusMode === 'lead') {
        visible = this._drivers.slice(0, this._maxRows);
      } else {
        if (playerIdx < 0) {
          visible = this._drivers.slice(0, this._maxRows);
        } else {
          const half = Math.floor(this._maxRows / 2);
          let start = Math.max(0, playerIdx - half);
          let end = start + this._maxRows;
          if (end > this._drivers.length) { end = this._drivers.length; start = Math.max(0, end - this._maxRows); }
          visible = this._drivers.slice(start, end);
        }
      }

      // Build HTML for each row
      let html = '';
      for (const entry of visible) {
        const [pos, name, ir, best, last, gap, pit, isPlayer] = entry;
        const isSelf = isPlayer === 1;

        // Classes
        const classes = ['lb-row'];
        if (isSelf) classes.push('lb-player');
        if (pit) classes.push('lb-pit');

        // Gap display based on focus mode
        let gapStr = '', gapClass = 'gap-player';
        if (!isSelf) {
          if (this._focusMode === 'lead') {
            // In 'lead' mode, show either lap time (P1) or gap to leader
            if (pos === 1) {
              // P1: show their last lap time formatted as mm:ss.fff
              if (last > 0) {
                const m = Math.floor(last / 60), s = last - m * 60;
                gapStr = m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
              }
              gapClass = 'gap-leader';
            } else {
              // Others: show gap to P1 (first entry in drivers array)
              const leader = this._drivers[0];
              if (leader) {
                const leaderLast = +leader[4]; // P1's lastLap
                const gapToLeader = last > 0 && leaderLast > 0 ? last - leaderLast : 0;
                if (gapToLeader > 0) {
                  gapStr = '+' + gapToLeader.toFixed(1) + 's';
                  gapClass = 'gap-behind';
                } else if (gapToLeader < 0) {
                  gapStr = '-' + Math.abs(gapToLeader).toFixed(1) + 's';
                  gapClass = 'gap-ahead';
                }
              }
            }
          } else {
            // 'me' mode: show gap to player (relative to player's last lap)
            // Calculate gap as: driver.lastLap - player.lastLap
            if (last > 0 && playerLastLap > 0) {
              const relativeGap = last - playerLastLap;
              if (relativeGap > 0) {
                gapStr = '+' + relativeGap.toFixed(1) + 's';
                gapClass = 'gap-behind';
              } else if (relativeGap < 0) {
                gapStr = '-' + Math.abs(relativeGap).toFixed(1) + 's';
                gapClass = 'gap-ahead';
              }
            }
          }
        }

        // iRating
        const irStr = ir > 0 ? (ir >= 1000 ? (ir / 1000).toFixed(1) + 'k' : '' + ir) : '';

        // Update sparkline history
        const lastNum = +last;
        if (lastNum > 0) {
          if (!this._sparkHistory[name]) this._sparkHistory[name] = [];
          const h = this._sparkHistory[name];
          if (h.length === 0 || h[h.length - 1] !== lastNum) {
            h.push(lastNum);
            if (h.length > 12) h.shift();
          }
        }

        // Build sparkline SVG
        let sparkSvg = '';
        const hist = this._sparkHistory[name] ? this._sparkHistory[name].filter(v => v > 0) : null;
        if (hist && hist.length >= 2) {
          const mn = Math.min(...hist), mx = Math.max(...hist);
          const range = mx - mn || 1;
          const w = 44, h2 = 14;
          let pts = '';
          for (let i = 0; i < hist.length; i++) {
            const x = (i / (hist.length - 1)) * w;
            const y = ((hist[i] - mn) / range) * h2;
            if (i === 0) {
              pts += x.toFixed(1) + ',' + y.toFixed(1);
            } else {
              const prevY = ((hist[i - 1] - mn) / range) * h2;
              pts += ' ' + x.toFixed(1) + ',' + prevY.toFixed(1);
              pts += ' ' + x.toFixed(1) + ',' + y.toFixed(1);
            }
          }
          let col = 'hsla(0,0%,100%,0.3)';
          if (isSelf) {
            if (pos === 1) col = 'hsla(42,80%,55%,1)';
            else col = 'hsla(210,75%,55%,1)';
          }
          sparkSvg = '<svg class="lb-spark" viewBox="0 0 ' + w + ' ' + h2 + '" preserveAspectRatio="none">'
            + '<polyline points="' + pts + '" fill="none" stroke="' + col + '" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>'
            + '</svg>';
        }

        // Lap time coloring
        let lapStr = '', lapClass = '';
        if (last > 0) {
          const m = Math.floor(last / 60), s = last - m * 60;
          lapStr = m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
          if (this._sessionBestLap > 0 && Math.abs(last - this._sessionBestLap) < 0.05) {
            lapClass = 'lap-pb';
          } else if (best > 0 && Math.abs(last - best) < 0.05) {
            lapClass = 'lap-fast';
          } else {
            lapClass = 'lap-slow';
          }
        }

        html += '<div class="' + classes.join(' ') + '">'
          + '<div class="lb-pos">' + pos + '</div>'
          + '<div class="lb-name">' + (isSelf ? this._playerName : this._escHtml(name)) + '</div>'
          + '<div class="lb-lap ' + lapClass + '">' + lapStr + '</div>'
          + '<div class="lb-ir">' + irStr + '</div>'
          + '<div class="lb-gap ' + gapClass + '">' + gapStr + '</div>'
          + sparkSvg
          + '</div>';
      }

      this._rowsContainer.innerHTML = html;
    }

    _escHtml(s) {
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  }

  customElements.define('racecor-leaderboard', RaceCorLeaderboard);
})();
