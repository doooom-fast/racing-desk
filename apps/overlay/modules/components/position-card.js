/**
 * @element racecor-position-card
 * @description Position, iRating, and Safety Rating display with cycling pages.
 *
 * Shows current position (large), iRating with horizontal progress bar, and Safety Rating with pie.
 * Cycles between position page and rating page on a timer (5s per page).
 *
 * Accepts telemetry data via `updateData(snapshot)` method or subscribed to `telemetry-update` events.
 *
 * @attribute none (uses properties instead)
 *
 * @property {number} position - Current position (1-40+) (default: 0)
 * @property {number} totalCars - Total cars in session (default: 0)
 * @property {number} irating - iRating value (default: 0)
 * @property {number} safetyRating - Safety Rating value 0.0-4.0 (default: 0)
 * @property {string} licenseClass - License class string (default: '—')
 *
 * @fires none (no custom events)
 *
 * @slot default (not used, Shadow DOM only)
 *
 * @example
 * <racecor-position-card></racecor-position-card>
 */

(function() {
  'use strict';

  // Cached minimal-mode flag — same rationale as gap-display.js. The
  // SR-pie branch in render() ran a per-frame document.body classList
  // walk before this; with telemetry at 60Hz that's 60 sync style
  // reads per second per component instance.
  let _isMinimal = !!(document.body && document.body.classList.contains('mode-minimal'));
  function _refreshMinimalFlag() {
    _isMinimal = !!(document.body && document.body.classList.contains('mode-minimal'));
  }
  if (typeof MutationObserver !== 'undefined' && document.body) {
    new MutationObserver(_refreshMinimalFlag)
      .observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  class RaceCorPositionCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });

      // ── Internal state ──────────────────────────────────────────
      this._position = 0;
      this._totalCars = 0;
      this._irating = 0;
      this._safetyRating = 0;
      this._licenseClass = '—';

      this._currentPage = 'position';  // 'position' or 'rating'
      this._cycleTimer = null;

      // ── Cached element references ────────────────────────────────
      this._positionPageEl = null;
      this._ratingPageEl = null;
      this._posNumberEl = null;
      this._iratingValueEl = null;
      this._iratingBarEl = null;
      this._srValueEl = null;
      this._srPieEl = null;

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
      this._startCycleTimer();
      this.render();
    }

    disconnectedCallback() {
      this._stopCycleTimer();

      if (this._telemetryHandler && window) {
        window.removeEventListener('telemetry-update', this._telemetryHandler);
        this._telemetryHandler = null;
      }

      this._positionPageEl = null;
      this._ratingPageEl = null;
      this._posNumberEl = null;
      this._iratingValueEl = null;
      this._iratingBarEl = null;
      this._srValueEl = null;
      this._srPieEl = null;
    }

    // ╔═══════════════════════════════════════════════════════════╗
    // ║ PROPERTIES                                                 ║
    // ╚═══════════════════════════════════════════════════════════╝

    get position() { return this._position; }
    set position(val) { this._position = parseInt(val) || 0; }

    get totalCars() { return this._totalCars; }
    set totalCars(val) { this._totalCars = parseInt(val) || 0; }

    get irating() { return this._irating; }
    set irating(val) { this._irating = parseInt(val) || 0; }

    get safetyRating() { return this._safetyRating; }
    set safetyRating(val) { this._safetyRating = parseFloat(val) || 0; }

    get licenseClass() { return this._licenseClass; }
    set licenseClass(val) { this._licenseClass = String(val || '—'); }

    // ╔═══════════════════════════════════════════════════════════╗
    // ║ PUBLIC API — updateData()                                  ║
    // ╚═══════════════════════════════════════════════════════════╝

    updateData(snapshot) {
      if (!snapshot) return;

      const _demo = snapshot._demo || +(snapshot['RaceCorProDrive.Plugin.DemoMode'] || 0);

      // Extract position and ratings
      if (_demo) {
        this._position = +(snapshot['RaceCorProDrive.Plugin.Demo.Position'] || 0);
        this._totalCars = +(snapshot['RaceCorProDrive.Plugin.Demo.TotalCars'] || 0);
        this._irating = +(snapshot['RaceCorProDrive.Plugin.Demo.IRating'] || 0);
        this._safetyRating = +(snapshot['RaceCorProDrive.Plugin.Demo.SafetyRating'] || 0);
        this._licenseClass = String(snapshot['RaceCorProDrive.Plugin.Demo.LicenseClass'] || '—');
      } else {
        this._position = +(snapshot['DataCorePlugin.GameData.Position'] || 0);
        this._totalCars = +(snapshot['DataCorePlugin.GameData.TotalCars'] || 0);
        this._irating = +(snapshot['IRacingExtraProperties.iRacing_DriverInfo_IRating'] || 0);
        this._safetyRating = +(snapshot['DataCorePlugin.GameData.SafetyRating'] || 0);
        this._licenseClass = String(snapshot['DataCorePlugin.GameData.LicenseClass'] || '—');
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

          .card-container {
            background: var(--bg-panel);
            border: 1px solid var(--border);
            border-radius: var(--corner-r);
            padding: var(--pad);
            min-width: 60px;
            min-height: 80px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
          }

          .cycle-page {
            display: none;
            text-align: center;
            width: 100%;
          }

          .cycle-page.active {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            width: 100%;
          }

          .cycle-page.fade-in {
            animation: fadeIn 0.3s ease-in;
          }

          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }

          /* ── Position Page ── */
          .pos-number {
            font-size: var(--fs-xl);
            font-weight: var(--fw-black);
            color: var(--text-primary);
            line-height: 1;
            margin-bottom: 4px;
          }

          .pos-of-total {
            font-size: var(--fs-xs);
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }

          /* ── Rating Page ── */
          .rating-row {
            display: flex;
            flex-direction: column;
            gap: 6px;
            width: 100%;
          }

          .rating-item {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 2px;
          }

          .rating-label {
            font-size: var(--fs-xs);
            font-weight: var(--fw-bold);
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }

          .rating-value {
            font-size: var(--fs-lg);
            font-weight: var(--fw-semi);
            color: var(--text-primary);
          }

          .rating-bar {
            width: 100%;
            height: 4px;
            background: var(--bg);
            border-radius: 2px;
            overflow: hidden;
            border: 1px solid var(--border);
          }

          .rating-bar-fill {
            height: 100%;
            background: linear-gradient(to right, var(--green), var(--amber), var(--red));
            width: 0%;
            transition: width 0.2s ease;
            border-radius: 1px;
          }

          .sr-pie {
            width: 28px;
            height: 28px;
            border-radius: 50%;
            background: conic-gradient(var(--green) 0deg 0deg, var(--bg) 0deg 360deg);
            border: 1px solid var(--border);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 8px;
            color: var(--text-secondary);
          }

          /* ── MINIMAL MODE — Tufte-pure: huge position, numbers only ── */
          :host-context(body.mode-minimal) .card-container {
            background: transparent;
            border: none;
            padding: 2px;
          }

          :host-context(body.mode-minimal) .pos-number {
            font-size: 36px;
            line-height: 0.9;
          }

          :host-context(body.mode-minimal) .pos-of-total {
            font-size: 9px;
            color: var(--text-dim);
          }

          :host-context(body.mode-minimal) .rating-value {
            font-size: 16px;
            font-weight: var(--fw-black);
          }

          :host-context(body.mode-minimal) .rating-bar,
          :host-context(body.mode-minimal) .rating-bar-fill {
            display: none !important;
          }

          /* SR: number only, no pie — color encodes threshold */
          :host-context(body.mode-minimal) .sr-pie {
            width: auto;
            height: auto;
            border-radius: 0;
            background: none !important;
            border: none;
            font-size: 16px;
            font-weight: var(--fw-black);
            color: var(--text-primary);
          }

          :host-context(body.mode-minimal) .rating-label {
            font-size: 8px;
            font-weight: var(--fw-medium);
            color: var(--text-dim);
          }
        </style>

        <div class="card-container">
          <!-- Position Page -->
          <div class="cycle-page active" id="positionPage">
            <div class="pos-number" id="posNumber">—</div>
            <div class="pos-of-total" id="posOfTotal">of —</div>
          </div>

          <!-- Rating Page -->
          <div class="cycle-page inactive" id="ratingPage">
            <div class="rating-row">
              <div class="rating-item">
                <div class="rating-label">iRating</div>
                <div class="rating-value" id="iratingValue">—</div>
                <div class="rating-bar">
                  <div class="rating-bar-fill" id="iratingBar"></div>
                </div>
              </div>
              <div class="rating-item" style="align-items: center;">
                <div class="rating-label">Safety</div>
                <div class="sr-pie" id="srPie">
                  <span id="srValue">—</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;

      this.shadowRoot.appendChild(template.content.cloneNode(true));
    }

    _cacheElements() {
      if (!this.shadowRoot) return;

      this._positionPageEl = this.shadowRoot.getElementById('positionPage');
      this._ratingPageEl = this.shadowRoot.getElementById('ratingPage');
      this._posNumberEl = this.shadowRoot.getElementById('posNumber');
      const posOfTotal = this.shadowRoot.getElementById('posOfTotal');
      if (posOfTotal) this._posOfTotalEl = posOfTotal;

      this._iratingValueEl = this.shadowRoot.getElementById('iratingValue');
      this._iratingBarEl = this.shadowRoot.getElementById('iratingBar');
      this._srValueEl = this.shadowRoot.getElementById('srValue');
      this._srPieEl = this.shadowRoot.getElementById('srPie');
    }

    render() {
      // Position page
      if (this._posNumberEl) {
        this._posNumberEl.textContent = this._position > 0 ? 'P' + this._position : '—';
      }
      if (this._posOfTotalEl) {
        this._posOfTotalEl.textContent = this._totalCars > 0 ? 'of ' + this._totalCars : 'of —';
      }

      // Rating page
      if (this._iratingValueEl) {
        if (this._irating > 0) {
          this._iratingValueEl.textContent = this._irating >= 1000 ? (this._irating / 1000).toFixed(1) + 'k' : String(this._irating);
        } else {
          this._iratingValueEl.textContent = '—';
        }
      }

      // iRating bar (assuming max is ~10k)
      if (this._iratingBarEl && this._irating > 0) {
        const barPct = Math.min(100, (this._irating / 10000) * 100);
        this._iratingBarEl.style.width = barPct + '%';
      }

      // Safety rating pie
      if (this._srValueEl) {
        this._srValueEl.textContent = this._safetyRating > 0 ? this._safetyRating.toFixed(2) : '—';
      }

      if (this._srPieEl && this._safetyRating > 0) {
        if (_isMinimal) {
          // Tufte: no pie — color the number by license-class thresholds
          const srColor = this._safetyRating >= 3.0 ? 'var(--green)'
            : this._safetyRating >= 2.0 ? 'var(--amber)'
            : 'var(--red)';
          this._srPieEl.style.background = 'none';
          this._srPieEl.style.color = srColor;
        } else {
          // Standard: pie chart encoding
          const srPct = Math.min(100, (this._safetyRating / 4.0) * 100);
          const angle = (srPct / 100) * 360;
          this._srPieEl.style.background = `conic-gradient(var(--green) 0deg ${angle}deg, var(--bg) ${angle}deg 360deg)`;
        }
      }
    }

    _startCycleTimer() {
      if (this._cycleTimer) clearInterval(this._cycleTimer);

      this._cycleTimer = setInterval(() => {
        this._togglePage();
      }, 5000);  // 5 seconds per page
    }

    _stopCycleTimer() {
      if (this._cycleTimer) {
        clearInterval(this._cycleTimer);
        this._cycleTimer = null;
      }
    }

    _togglePage() {
      if (this._currentPage === 'position') {
        this._currentPage = 'rating';
        if (this._positionPageEl) this._positionPageEl.classList.remove('active');
        if (this._ratingPageEl) this._ratingPageEl.classList.add('active');
      } else {
        this._currentPage = 'position';
        if (this._ratingPageEl) this._ratingPageEl.classList.remove('active');
        if (this._positionPageEl) this._positionPageEl.classList.add('active');
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
    customElements.define('racecor-position-card', RaceCorPositionCard);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = RaceCorPositionCard;
  }

})();
