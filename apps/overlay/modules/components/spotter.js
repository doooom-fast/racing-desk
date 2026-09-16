/**
 * @element racecor-spotter
 * @description Proximity/spotter overlay with directional indicators.
 *
 * Shows nearby cars with directional proximity indicators:
 * - Left/right/overlap position indicators
 * - Color intensity based on proximity
 * - Car-shaped or arrow indicators
 *
 * @property {number} left - Gap to car on left (seconds)
 * @property {number} right - Gap to car on right (seconds)
 * @property {number} leftOverlap - Overlap left indicator (0-1)
 * @property {number} rightOverlap - Overlap right indicator (0-1)
 */

(function() {
  'use strict';

  class RaceCorSpotter extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });

      this._left = 0;
      this._right = 0;
      this._leftOverlap = 0;
      this._rightOverlap = 0;

      this._telemetryHandler = null;
    }

    connectedCallback() {
      this._renderTemplate();
      this._subscribeToData();
      this.render();
    }

    disconnectedCallback() {
      if (this._telemetryHandler && window) {
        window.removeEventListener('telemetry-update', this._telemetryHandler);
        this._telemetryHandler = null;
      }
    }

    get left() { return this._left; }
    set left(val) { this._left = +val || 0; }

    get right() { return this._right; }
    set right(val) { this._right = +val || 0; }

    get leftOverlap() { return this._leftOverlap; }
    set leftOverlap(val) { this._leftOverlap = Math.max(0, Math.min(1, +val || 0)); }

    get rightOverlap() { return this._rightOverlap; }
    set rightOverlap(val) { this._rightOverlap = Math.max(0, Math.min(1, +val || 0)); }

    updateData(snapshot) {
      if (!snapshot) return;

      const gLeft = +snapshot['IRacingExtraProperties.iRacing_Opponent_Left_Gap'] || 0;
      const gRight = +snapshot['IRacingExtraProperties.iRacing_Opponent_Right_Gap'] || 0;

      this._left = gLeft;
      this._right = gRight;

      this.render();
    }

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

          .sp-panel {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: var(--gap);
            padding: var(--pad);
          }

          .sp-side {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: var(--gap);
            padding: var(--pad);
            background: var(--bg-panel);
            border: 1px solid var(--border);
            border-radius: var(--corner-r);
          }

          .sp-indicator {
            width: 60px;
            height: 60px;
            border: 2px solid var(--border);
            border-radius: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--bg);
            transition: all 0.2s ease;
          }

          .sp-indicator.active {
            border-color: var(--accent);
            background: var(--bg-highlight);
          }

          .sp-car {
            width: 40px;
            height: 24px;
            background: var(--accent);
            border-radius: 4px 4px 2px 2px;
            position: relative;
          }

          .sp-car::before {
            content: '';
            position: absolute;
            top: -4px;
            left: 50%;
            transform: translateX(-50%);
            width: 12px;
            height: 4px;
            background: var(--accent);
            border-radius: 2px;
          }

          .sp-label {
            font-size: var(--fs-xs);
            font-weight: var(--fw-bold);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--text-secondary);
            text-align: center;
          }

          .sp-value {
            font-family: var(--ff-mono);
            font-size: var(--fs-sm);
            font-weight: var(--fw-semi);
            color: var(--text-primary);
          }

          .sp-empty {
            color: var(--text-dim);
            text-align: center;
            font-size: var(--fs-xs);
          }
        </style>

        <div class="sp-panel">
          <div class="sp-side">
            <div class="sp-label">Left</div>
            <div class="sp-indicator" id="spLeftIndicator">
              <div class="sp-empty">—</div>
            </div>
            <div class="sp-value" id="spLeftValue">—</div>
          </div>

          <div class="sp-side">
            <div class="sp-label">Right</div>
            <div class="sp-indicator" id="spRightIndicator">
              <div class="sp-empty">—</div>
            </div>
            <div class="sp-value" id="spRightValue">—</div>
          </div>
        </div>
      `;

      this.shadowRoot.appendChild(template.content.cloneNode(true));
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
      const leftInd = this.shadowRoot.querySelector('#spLeftIndicator');
      const rightInd = this.shadowRoot.querySelector('#spRightIndicator');
      const leftVal = this.shadowRoot.querySelector('#spLeftValue');
      const rightVal = this.shadowRoot.querySelector('#spRightValue');

      // Left side
      if (this._left > 0 && this._left <= 4) {
        leftInd.classList.add('active');
        leftInd.innerHTML = '<div class="sp-car"></div>';
        leftVal.textContent = this._left.toFixed(1) + 's';
      } else {
        leftInd.classList.remove('active');
        leftInd.innerHTML = '<div class="sp-empty">—</div>';
        leftVal.textContent = '—';
      }

      // Right side
      if (this._right > 0 && this._right <= 4) {
        rightInd.classList.add('active');
        rightInd.innerHTML = '<div class="sp-car"></div>';
        rightVal.textContent = this._right.toFixed(1) + 's';
      } else {
        rightInd.classList.remove('active');
        rightInd.innerHTML = '<div class="sp-empty">—</div>';
        rightVal.textContent = '—';
      }
    }
  }

  customElements.define('racecor-spotter', RaceCorSpotter);
})();
