/**
 * @element racecor-incidents
 * @description Incident counter with penalty and DQ threshold indicators.
 *
 * Shows incident count with color progression (0 green → 5+ red),
 * progress bar to DQ threshold with markers for penalty and DQ points.
 *
 * Accepts telemetry data via `updateData(snapshot)` method or subscribed to `telemetry-update` events.
 *
 * @attribute none (uses properties instead)
 *
 * @property {number} count - Current incident count (default: 0)
 * @property {number} penaltyThreshold - Incidents until penalty (default: 0 = no limit)
 * @property {number} dqThreshold - Incidents until disqualification (default: 0 = no limit)
 *
 * @fires none (no custom events)
 *
 * @slot default (not used, Shadow DOM only)
 *
 * @example
 * <racecor-incidents></racecor-incidents>
 */

(function() {
  'use strict';

  class RaceCorIncidents extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });

      // ── Internal state ──────────────────────────────────────────
      this._count = 0;
      this._penaltyThreshold = 0;
      this._dqThreshold = 0;
      this._prevCount = -1;

      // ── Cached element references ────────────────────────────────
      this._countEl = null;
      this._thresholdsEl = null;
      this._progressEl = null;
      this._barFillEl = null;
      this._markerPenEl = null;
      this._markerDQEl = null;
      this._penRowEl = null;
      this._penValueEl = null;
      this._dqValueEl = null;
      this._hostEl = null;

      // ── Event handler ────────────────────────────────────────────
      this._telemetryHandler = null;
    }

    // ╔═══════════════════════════════════════════════════════════╗
    // ║ LIFECYCLE HOOKS                                            ║
    // ╚═══════════════════════════════════════════════════════════╝

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
      this._countEl = null;
      this._thresholdsEl = null;
      this._progressEl = null;
      this._barFillEl = null;
      this._markerPenEl = null;
      this._markerDQEl = null;
      this._penRowEl = null;
      this._penValueEl = null;
      this._dqValueEl = null;
      this._hostEl = null;
    }

    // ╔═══════════════════════════════════════════════════════════╗
    // ║ PROPERTIES                                                 ║
    // ╚═══════════════════════════════════════════════════════════╝

    get count() { return this._count; }
    set count(val) { this._count = parseInt(val) || 0; }

    get penaltyThreshold() { return this._penaltyThreshold; }
    set penaltyThreshold(val) { this._penaltyThreshold = parseInt(val) || 0; }

    get dqThreshold() { return this._dqThreshold; }
    set dqThreshold(val) { this._dqThreshold = parseInt(val) || 0; }

    // ╔═══════════════════════════════════════════════════════════╗
    // ║ PUBLIC API — updateData()                                  ║
    // ╚═══════════════════════════════════════════════════════════╝

    updateData(snapshot) {
      if (!snapshot) return;

      const _demo = snapshot._demo || +(snapshot['RaceCorProDrive.Plugin.DemoMode'] || 0);
      const dsPre = _demo ? 'RaceCorProDrive.Plugin.Demo.DS.' : 'RaceCorProDrive.Plugin.DS.';

      this._count = +(snapshot[dsPre + 'IncidentCount'] || 0);
      this._penaltyThreshold = +(snapshot[dsPre + 'IncidentLimitPenalty'] || 0);
      this._dqThreshold = +(snapshot[dsPre + 'IncidentLimitDQ'] || 0);

      // Non-race session check
      const isNonRaceSession = !!(+(snapshot[dsPre + 'IsNonRaceSession'] || 0));
      if (isNonRaceSession) {
        this._penaltyThreshold = 0;
        this._dqThreshold = 0;
      }

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
          }

          .inc-container {
            background: var(--bg-panel);
            border: 1px solid var(--border);
            border-radius: var(--corner-r);
            padding: var(--pad);
          }

          .inc-label {
            font-size: var(--fs-xs);
            font-weight: var(--fw-bold);
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 4px;
          }

          .inc-count {
            font-size: var(--fs-lg);
            font-weight: var(--fw-semi);
            margin-bottom: 6px;
            transition: color 0.2s ease;
          }

          /* Color levels: 0=green, 1=yellow, 2=orange, 3=red, 4=red, 5+=red */
          :host(.inc-level-0) .inc-count { color: var(--green); }
          :host(.inc-level-1) .inc-count { color: var(--amber); }
          :host(.inc-level-2) .inc-count { color: var(--orange); }
          :host(.inc-level-3) .inc-count { color: var(--red); }
          :host(.inc-level-4) .inc-count { color: var(--red); }
          :host(.inc-level-5) .inc-count { color: var(--red); }

          .inc-count.inc-flash {
            animation: incFlash 0.4s ease-out;
          }

          @keyframes incFlash {
            0% { box-shadow: 0 0 8px var(--red); }
            100% { box-shadow: none; }
          }

          .inc-thresholds {
            display: none;
            margin-top: 6px;
            border-top: 1px solid var(--border);
            padding-top: 6px;
          }

          .inc-thresholds.visible {
            display: block;
          }

          .inc-thresh-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: var(--fs-xs);
            margin-bottom: 4px;
          }

          .inc-thresh-label {
            color: var(--text-secondary);
            font-weight: var(--fw-semi);
            text-transform: uppercase;
          }

          .inc-thresh-val {
            color: var(--text-primary);
            font-weight: var(--fw-semi);
            font-family: var(--ff-mono);
          }

          .inc-thresh-val.thresh-hit {
            color: var(--red);
            font-weight: var(--fw-bold);
          }

          .inc-thresh-val.thresh-crit {
            color: var(--orange);
          }

          .inc-thresh-val.thresh-near {
            color: var(--amber);
          }

          .inc-progress {
            display: none;
            margin-top: 4px;
          }

          .inc-progress.visible {
            display: block;
          }

          .inc-bar-outer {
            height: 6px;
            background: var(--bg);
            border-radius: 2px;
            overflow: hidden;
            border: 1px solid var(--border);
            position: relative;
            margin-bottom: 2px;
          }

          .inc-bar-fill {
            height: 100%;
            background: linear-gradient(to right, var(--green), var(--amber), var(--red));
            width: 0%;
            transition: width 0.2s ease;
          }

          .inc-markers {
            position: relative;
            height: 0;
          }

          .inc-marker {
            position: absolute;
            top: -7px;
            width: 1px;
            height: 14px;
            background: var(--text-secondary);
            opacity: 0.6;
          }

          .inc-marker::before {
            content: '';
            position: absolute;
            top: -2px;
            left: -2px;
            width: 5px;
            height: 5px;
            background: inherit;
            border-radius: 50%;
          }
        </style>

        <div class="inc-container">
          <div class="inc-label">Incidents</div>
          <div class="inc-count" id="incCount">0</div>

          <div class="inc-thresholds" id="incThresholds">
            <div class="inc-thresh-row" id="incToPenRow">
              <span class="inc-thresh-label">To Penalty</span>
              <span class="inc-thresh-val" id="incToPen">—</span>
            </div>
            <div class="inc-thresh-row">
              <span class="inc-thresh-label">To DQ</span>
              <span class="inc-thresh-val" id="incToDQ">—</span>
            </div>
          </div>

          <div class="inc-progress" id="incProgress">
            <div class="inc-bar-outer">
              <div class="inc-bar-fill" id="incBarFill"></div>
            </div>
            <div class="inc-markers">
              <div class="inc-marker" id="incMarkerPen"></div>
              <div class="inc-marker" id="incMarkerDQ"></div>
            </div>
          </div>
        </div>
      `;

      this.shadowRoot.appendChild(template.content.cloneNode(true));
    }

    _cacheElements() {
      if (!this.shadowRoot) return;

      this._countEl = this.shadowRoot.getElementById('incCount');
      this._thresholdsEl = this.shadowRoot.getElementById('incThresholds');
      this._progressEl = this.shadowRoot.getElementById('incProgress');
      this._barFillEl = this.shadowRoot.getElementById('incBarFill');
      this._markerPenEl = this.shadowRoot.getElementById('incMarkerPen');
      this._markerDQEl = this.shadowRoot.getElementById('incMarkerDQ');
      this._penRowEl = this.shadowRoot.getElementById('incToPenRow');
      this._penValueEl = this.shadowRoot.getElementById('incToPen');
      this._dqValueEl = this.shadowRoot.getElementById('incToDQ');
    }

    render() {
      const hasPenalty = this._penaltyThreshold > 0;
      const hasDQ = this._dqThreshold > 0;
      const hasAnyLimit = hasPenalty || hasDQ;

      const toPen = hasPenalty ? Math.max(0, this._penaltyThreshold - this._count) : -1;
      const toDQ = hasDQ ? Math.max(0, this._dqThreshold - this._count) : -1;

      // Update count
      if (this._countEl) {
        this._countEl.textContent = this._count;

        // Flash on increment
        if (this._prevCount >= 0 && this._count > this._prevCount) {
          this._countEl.classList.remove('inc-flash');
          void this._countEl.offsetWidth;
          this._countEl.classList.add('inc-flash');
        }
        this._prevCount = this._count;
      }

      // Progressive color level
      let level;
      if (this._count === 0) level = 0;
      else if (this._count <= 2) level = 1;
      else if (this._count <= 4) level = 2;
      else if (this._count <= 6) level = 3;
      else if (this._count <= 9) level = 4;
      else level = 5;

      for (let i = 0; i <= 5; i++) {
        this.classList.toggle('inc-level-' + i, i === level);
      }

      // Thresholds visibility
      if (this._thresholdsEl) {
        this._thresholdsEl.classList.toggle('visible', hasAnyLimit);
      }

      // Threshold values
      if (this._penRowEl) {
        this._penRowEl.style.display = hasPenalty ? '' : 'none';
      }

      if (this._penValueEl && hasPenalty) {
        this._penValueEl.textContent = toPen > 0 ? toPen : 'PENALTY';
        this._penValueEl.className = 'inc-thresh-val' + (toPen === 0 ? ' thresh-hit' : toPen <= 3 ? ' thresh-crit' : toPen <= 6 ? ' thresh-near' : '');
      }

      if (this._dqValueEl) {
        if (!hasDQ) {
          this._dqValueEl.textContent = '∞';
          this._dqValueEl.className = 'inc-thresh-val';
        } else {
          this._dqValueEl.textContent = toDQ > 0 ? toDQ : 'DQ';
          this._dqValueEl.className = 'inc-thresh-val' + (toDQ === 0 ? ' thresh-hit' : toDQ <= 3 ? ' thresh-crit' : toDQ <= 6 ? ' thresh-near' : '');
        }
      }

      // Progress bar
      if (this._progressEl) {
        this._progressEl.classList.toggle('visible', hasAnyLimit);
      }

      if (this._barFillEl && this._markerPenEl && this._markerDQEl) {
        if (!hasDQ) {
          this._barFillEl.style.width = '0%';
          this._markerPenEl.style.display = 'none';
          this._markerDQEl.style.display = 'none';
        } else {
          const fillPct = Math.min(100, (this._count / this._dqThreshold) * 100);
          this._barFillEl.style.width = fillPct + '%';

          if (hasPenalty) {
            const penPct = Math.min(100, (this._penaltyThreshold / this._dqThreshold) * 100);
            this._markerPenEl.style.left = penPct + '%';
            this._markerPenEl.style.display = 'block';
            this._markerPenEl.style.opacity = this._count >= this._penaltyThreshold ? '0.3' : '0.7';
          } else {
            this._markerPenEl.style.display = 'none';
          }

          this._markerDQEl.style.left = '100%';
          this._markerDQEl.style.display = 'block';
        }
      }
    }

    // ╔═══════════════════════════════════════════════════════════╗
    // ║ DATA SUBSCRIPTION                                          ║
    // ╚═══════════════════════════════════════════════════════════╝

    _subscribeToData() {
      this._telemetryHandler = (e) => {
        if (e && e.detail) {
          this.updateData(e.detail);
        }
      };

      if (window && window.addEventListener) {
        window.addEventListener('telemetry-update', this._telemetryHandler);
      }
    }
  }

  // ══════════════════════════════════════════════════════════════
  // REGISTRATION
  // ══════════════════════════════════════════════════════════════

  if (window && window.customElements) {
    customElements.define('racecor-incidents', RaceCorIncidents);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = RaceCorIncidents;
  }

})();
