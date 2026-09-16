/**
 * @element racecor-race-end
 * @description Race end results screen with finishing position and rating deltas.
 *
 * Shows finishing position, best lap time, incident count, and iRating/SR delta.
 * Displays title based on finish type (podium, strong, DNF, etc.) with tint color.
 * Auto-hides after 30s.
 *
 * Accepts telemetry data via `show(snapshot)` method.
 *
 * @attribute none (uses methods instead)
 *
 * @property {number} position - Finishing position (default: 0)
 * @property {number} totalLaps - Total completed laps (default: 0)
 * @property {number} bestLap - Best lap time in seconds (default: 0)
 * @property {number} incidents - Incident count (default: 0)
 * @property {number} iratingDelta - iRating change (default: 0)
 * @property {number} srDelta - Safety Rating delta (default: 0)
 *
 * @method show(snapshot, isDemo) - Display race end screen from snapshot
 * @method hide() - Hide screen immediately
 *
 * @fires none (no custom events)
 *
 * @slot default (not used, Shadow DOM only)
 *
 * @example
 * <racecor-race-end></racecor-race-end>
 */

(function() {
  'use strict';

  class RaceCorRaceEnd extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });

      // ── Internal state ──────────────────────────────────────────
      this._position = 0;
      this._totalLaps = 0;
      this._bestLap = 0;
      this._incidents = 0;
      this._iratingDelta = 0;
      this._srDelta = 0;
      this._hideTimer = null;
      this._visible = false;

      // ── Cached element references ────────────────────────────────
      this._screenEl = null;
      this._posEl = null;
      this._titleEl = null;
      this._subtitleEl = null;
      this._statPosEl = null;
      this._statLapEl = null;
      this._statIncEl = null;
      this._statIRDeltaEl = null;
      this._statSRDeltaEl = null;
    }

    // ╔═══════════════════════════════════════════════════════════╗
    // ║ LIFECYCLE HOOKS                                            ║
    // ╚═══════════════════════════════════════════════════════════╝

    connectedCallback() {
      this._renderTemplate();
      this._cacheElements();
    }

    disconnectedCallback() {
      if (this._hideTimer) {
        clearTimeout(this._hideTimer);
        this._hideTimer = null;
      }
      this._screenEl = null;
    }

    // ╔═══════════════════════════════════════════════════════════╗
    // ║ PUBLIC API — show() and hide()                             ║
    // ╚═══════════════════════════════════════════════════════════╝

    show(snapshot, isDemo = false) {
      if (!snapshot) return;

      const pre = isDemo ? 'RaceCorProDrive.Plugin.Demo.' : '';
      const dsPre = isDemo ? 'RaceCorProDrive.Plugin.Demo.DS.' : 'RaceCorProDrive.Plugin.DS.';

      // Extract data
      const pos = isDemo ? +(snapshot['RaceCorProDrive.Plugin.Demo.Position'] || 0) : +(snapshot['DataCorePlugin.GameData.Position'] || 0);
      const completedLaps = +(snapshot[dsPre + 'CompletedLaps'] || 0);
      const totalLaps = isDemo ? +(snapshot['RaceCorProDrive.Plugin.Demo.TotalLaps'] || 0) : +(snapshot['DataCorePlugin.GameData.TotalLaps'] || 0);
      const bestLap = isDemo ? +(snapshot['RaceCorProDrive.Plugin.Demo.BestLapTime'] || 0) : +(snapshot['DataCorePlugin.GameData.BestLapTime'] || 0);
      const incidents = +(snapshot[dsPre + 'IncidentCount'] || 0);

      this._position = pos;
      this._totalLaps = totalLaps;
      this._bestLap = bestLap;
      this._incidents = incidents;

      // DNF detection
      const isDNF = pos === 0 || (completedLaps > 0 && totalLaps > 0 && completedLaps < Math.max(1, Math.floor(totalLaps * 0.5)));

      // Finish type
      let finishType;
      if (isDNF) finishType = 'dnf';
      else if (pos >= 1 && pos <= 3) finishType = 'podium';
      else if (pos >= 4 && pos <= 10) finishType = 'strong';
      else finishType = 'midpack';

      // Title / tint
      let title, subtitle = null, tint;
      if (isDNF) {
        title = 'TOUGH BREAK';
        subtitle = 'Every lap is a lesson. Regroup and go again.';
        tint = 'purple';
      } else if (finishType === 'podium') {
        title = pos === 1 ? 'VICTORY!' : 'PODIUM FINISH!';
        tint = pos === 1 ? 'gold' : pos === 2 ? 'silver' : 'bronze';
      } else if (finishType === 'strong') {
        title = 'STRONG FINISH';
        tint = 'green';
      } else {
        title = 'RACE COMPLETE';
        tint = 'neutral';
      }

      // Update DOM
      if (this._posEl) this._posEl.textContent = !isDNF && pos > 0 ? 'P' + pos : '—';
      if (this._titleEl) this._titleEl.textContent = title;
      if (this._subtitleEl) {
        this._subtitleEl.textContent = subtitle || '';
        if (this._subtitleEl.style) this._subtitleEl.style.display = subtitle ? '' : 'none';
      }

      if (this._statPosEl) this._statPosEl.textContent = !isDNF && pos > 0 ? 'P' + pos : 'DNF';
      if (this._statLapEl) this._statLapEl.textContent = this._fmtLapTime(bestLap);
      if (this._statIncEl) this._statIncEl.textContent = incidents;

      // Update class for tint color
      if (this._screenEl) {
        this._screenEl.className = 're-visible re-tint-' + tint;
      }

      this._visible = true;

      // Auto-hide after 30s
      if (this._hideTimer) clearTimeout(this._hideTimer);
      this._hideTimer = setTimeout(() => {
        this.hide();
      }, 30000);
    }

    hide() {
      if (this._screenEl) {
        this._screenEl.classList.remove('re-visible');
      }
      this._visible = false;

      if (this._hideTimer) {
        clearTimeout(this._hideTimer);
        this._hideTimer = null;
      }
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
            --ff: sofia-pro-comp, sans-serif;
            display: block;
          }

          .race-end-screen {
            position: fixed;
            top: 10px;
            right: 10px;
            width: 500px;
            height: 260px;
            background: hsla(0, 0%, 8%, 0.95);
            border: 2px solid hsla(0, 0%, 100%, 0.20);
            border-radius: 12px;
            padding: 24px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
            z-index: 150;
            opacity: 0;
            transform: scale(0.95) translateY(-20px);
            transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
            pointer-events: none;
          }

          .race-end-screen.re-visible {
            opacity: 1;
            transform: scale(1) translateY(0);
            pointer-events: auto;
          }

          .re-tint-gold { border-color: hsla(48, 90%, 55%, 0.6); background: hsla(48, 90%, 15%, 0.92); }
          .re-tint-silver { border-color: hsla(210, 40%, 65%, 0.6); background: hsla(210, 40%, 15%, 0.92); }
          .re-tint-bronze { border-color: hsla(35, 85%, 60%, 0.6); background: hsla(35, 85%, 15%, 0.92); }
          .re-tint-green { border-color: hsla(120, 60%, 50%, 0.6); background: hsla(120, 60%, 15%, 0.92); }
          .re-tint-purple { border-color: hsla(280, 70%, 60%, 0.6); background: hsla(280, 70%, 15%, 0.92); }
          .re-tint-neutral { border-color: hsla(0, 0%, 100%, 0.20); background: hsla(0, 0%, 8%, 0.95); }

          .re-position {
            font-size: 48px;
            font-weight: 900;
            color: hsla(0, 0%, 100%, 0.9);
            margin-bottom: 12px;
            font-family: var(--ff);
            letter-spacing: 0.05em;
          }

          .re-title {
            font-size: 26px;
            font-weight: 700;
            color: hsla(0, 0%, 100%, 1);
            text-transform: uppercase;
            letter-spacing: 0.08em;
            margin-bottom: 4px;
            font-family: var(--ff);
          }

          .re-subtitle {
            font-size: 12px;
            color: hsla(0, 0%, 100%, 0.65);
            font-weight: 400;
            line-height: 1.4;
            margin-bottom: 16px;
            font-family: var(--ff);
          }

          .re-stats {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 12px;
            width: 100%;
            margin-top: 12px;
          }

          .re-stat {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 2px;
          }

          .re-stat-label {
            font-size: 10px;
            font-weight: 700;
            color: hsla(0, 0%, 100%, 0.50);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            font-family: var(--ff);
          }

          .re-stat-value {
            font-size: 13px;
            font-weight: 600;
            color: hsla(0, 0%, 100%, 0.90);
            font-family: var(--ff);
            font-variant-numeric: tabular-nums;
          }
        </style>

        <div class="race-end-screen" id="raceEndScreen">
          <div class="re-position" id="rePosition">—</div>
          <div class="re-title" id="reTitle">—</div>
          <div class="re-subtitle" id="reSubtitle"></div>

          <div class="re-stats">
            <div class="re-stat">
              <div class="re-stat-label">Position</div>
              <div class="re-stat-value" id="reStatPos">—</div>
            </div>
            <div class="re-stat">
              <div class="re-stat-label">Best Lap</div>
              <div class="re-stat-value" id="reStatLap">—</div>
            </div>
            <div class="re-stat">
              <div class="re-stat-label">Incidents</div>
              <div class="re-stat-value" id="reStatInc">—</div>
            </div>
          </div>
        </div>
      `;

      this.shadowRoot.appendChild(template.content.cloneNode(true));
    }

    _cacheElements() {
      if (!this.shadowRoot) return;

      this._screenEl = this.shadowRoot.getElementById('raceEndScreen');
      this._posEl = this.shadowRoot.getElementById('rePosition');
      this._titleEl = this.shadowRoot.getElementById('reTitle');
      this._subtitleEl = this.shadowRoot.getElementById('reSubtitle');
      this._statPosEl = this.shadowRoot.getElementById('reStatPos');
      this._statLapEl = this.shadowRoot.getElementById('reStatLap');
      this._statIncEl = this.shadowRoot.getElementById('reStatInc');
    }

    _fmtLapTime(seconds) {
      if (!seconds || seconds <= 0 || !isFinite(seconds)) return '—';
      const m = Math.floor(seconds / 60);
      const s = seconds - m * 60;
      return m + ':' + (s < 10 ? '0' : '') + s.toFixed(3);
    }
  }

  // ══════════════════════════════════════════════════════════════
  // REGISTRATION
  // ══════════════════════════════════════════════════════════════

  if (window && window.customElements) {
    customElements.define('racecor-race-end', RaceCorRaceEnd);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = RaceCorRaceEnd;
  }

})();
