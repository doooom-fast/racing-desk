/**
 * @element racecor-gap-display
 * @description Gap ahead/behind display with driver name and iRating.
 *
 * Shows time gap, driver name, and iRating for car directly ahead and directly behind.
 * Color-coded: green when gap is shrinking (gaining on car ahead, being caught by car behind),
 * red when gap is growing (losing to car ahead, pulling away from car behind).
 *
 * Accepts telemetry data via `updateData(snapshot)` method or subscribed to `telemetry-update` events.
 *
 * @attribute none (uses properties instead)
 *
 * @property {number} aheadGap - Time gap to car ahead in seconds (default: 0)
 * @property {string} aheadDriver - Driver name of car ahead (default: '—')
 * @property {number} aheadIR - iRating of car ahead (default: 0)
 * @property {number} behindGap - Time gap to car behind in seconds (default: 0)
 * @property {string} behindDriver - Driver name of car behind (default: '—')
 * @property {number} behindIR - iRating of car behind (default: 0)
 *
 * @fires none (no custom events)
 *
 * @slot default (not used, Shadow DOM only)
 *
 * @example
 * <racecor-gap-display></racecor-gap-display>
 */

(function() {
  'use strict';

  // ── Cached minimal-mode flag ──
  // render() runs on every telemetry tick (~60Hz). Calling
  // document.body.classList.contains('mode-minimal') inside the hot
  // path forces a sync style/layout read per call and has been
  // measured as the dominant cost on the gap+histogram render loop
  // since the Tufte minimal-mode patch landed (commit 5d0fdfa). Cache
  // the flag once, then refresh it via a single MutationObserver on
  // document.body's class attribute. The observer fires only when the
  // user toggles modes — measured ~zero cost in steady state.
  let _isMinimal = !!(document.body && document.body.classList.contains('mode-minimal'));
  function _refreshMinimalFlag() {
    _isMinimal = !!(document.body && document.body.classList.contains('mode-minimal'));
  }
  if (typeof MutationObserver !== 'undefined' && document.body) {
    new MutationObserver(_refreshMinimalFlag)
      .observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }


  class RaceCorGapDisplay extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });

      // ── Internal state ──────────────────────────────────────────
      this._aheadGap = 0;
      this._aheadDriver = '—';
      this._aheadIR = 0;
      this._prevAheadGap = -1;

      this._behindGap = 0;
      this._behindDriver = '—';
      this._behindIR = 0;
      this._prevBehindGap = -1;

      // ── Cached element references ────────────────────────────────
      this._aheadTimeEl = null;
      this._aheadDriverEl = null;
      this._aheadIREl = null;
      this._aheadCellEl = null;

      this._behindTimeEl = null;
      this._behindDriverEl = null;
      this._behindIREl = null;
      this._behindCellEl = null;

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
      this._aheadTimeEl = null;
      this._aheadDriverEl = null;
      this._aheadIREl = null;
      this._aheadCellEl = null;
      this._behindTimeEl = null;
      this._behindDriverEl = null;
      this._behindIREl = null;
      this._behindCellEl = null;
    }

    // ╔═══════════════════════════════════════════════════════════╗
    // ║ PROPERTIES                                                 ║
    // ╚═══════════════════════════════════════════════════════════╝

    get aheadGap() { return this._aheadGap; }
    set aheadGap(val) { this._aheadGap = parseFloat(val) || 0; }

    get aheadDriver() { return this._aheadDriver; }
    set aheadDriver(val) { this._aheadDriver = String(val || '—'); }

    get aheadIR() { return this._aheadIR; }
    set aheadIR(val) { this._aheadIR = parseInt(val) || 0; }

    get behindGap() { return this._behindGap; }
    set behindGap(val) { this._behindGap = parseFloat(val) || 0; }

    get behindDriver() { return this._behindDriver; }
    set behindDriver(val) { this._behindDriver = String(val || '—'); }

    get behindIR() { return this._behindIR; }
    set behindIR(val) { this._behindIR = parseInt(val) || 0; }

    // ╔═══════════════════════════════════════════════════════════╗
    // ║ PUBLIC API — updateData()                                  ║
    // ╚═══════════════════════════════════════════════════════════╝

    updateData(snapshot) {
      if (!snapshot) return;

      const _demo = snapshot._demo || +(snapshot['RaceCorProDrive.Plugin.DemoMode'] || 0);
      const dsPre = _demo ? 'RaceCorProDrive.Plugin.Demo.DS.' : 'RaceCorProDrive.Plugin.DS.';

      // Parse gap data
      this._aheadGap = +(snapshot[dsPre + 'GapAhead'] || 0);
      this._aheadDriver = String(snapshot[dsPre + 'GapAheadDriver'] || '—');
      this._aheadIR = +(snapshot[dsPre + 'GapAheadIR'] || 0);

      this._behindGap = +(snapshot[dsPre + 'GapBehind'] || 0);
      this._behindDriver = String(snapshot[dsPre + 'GapBehindDriver'] || '—');
      this._behindIR = +(snapshot[dsPre + 'GapBehindIR'] || 0);

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

          .gaps-container {
            display: flex;
            flex-direction: column;
            gap: var(--gap);
          }

          .gap-item {
            background: var(--bg-panel);
            border: 1px solid var(--border);
            border-radius: var(--corner-r);
            padding: var(--pad);
            transition: border-color var(--t-med);
          }

          .gap-item.gaining {
            border-color: var(--green);
          }

          .gap-item.losing {
            border-color: var(--red);
          }

          .gap-label {
            font-size: var(--fs-xs);
            font-weight: var(--fw-bold);
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 3px;
          }

          .gap-time {
            font-size: var(--fs-lg);
            font-weight: var(--fw-semi);
            transition: color 0.2s ease;
            margin-bottom: 2px;
          }

          .gap-time.gaining {
            color: var(--green);
          }

          .gap-time.losing {
            color: var(--red);
          }

          .gap-info {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: var(--fs-xs);
            color: var(--text-dim);
          }

          .gap-driver {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            margin-right: 4px;
          }

          .gap-ir {
            font-family: var(--ff-mono);
            color: var(--text-secondary);
            white-space: nowrap;
          }

          /* ── MINIMAL MODE — Tufte-pure: big numbers, directional arrows, no chrome ── */
          :host-context(body.mode-minimal) .gap-item {
            background: transparent;
            border: none;
            border-radius: 0;
            padding: 2px 0;
          }

          :host-context(body.mode-minimal) .gap-item.gaining,
          :host-context(body.mode-minimal) .gap-item.losing {
            border: none;
          }

          :host-context(body.mode-minimal) .gap-time {
            font-size: 20px;
            font-weight: var(--fw-black);
            font-variant-numeric: tabular-nums;
          }

          :host-context(body.mode-minimal) .gap-label {
            font-size: 8px;
            margin-bottom: 1px;
          }

          :host-context(body.mode-minimal) .gap-info {
            font-size: 8px;
          }

          :host-context(body.mode-minimal) .gap-driver {
            font-size: 8px;
          }

          :host-context(body.mode-minimal) .gap-ir {
            font-size: 8px;
          }
        </style>

        <div class="gaps-container">
          <div class="gap-item" id="gapAheadItem">
            <div class="gap-label">Ahead</div>
            <div class="gap-time ahead">—</div>
            <div class="gap-info">
              <div class="gap-driver">—</div>
              <div class="gap-ir">—</div>
            </div>
          </div>
          <div class="gap-item" id="gapBehindItem">
            <div class="gap-label">Behind</div>
            <div class="gap-time behind">—</div>
            <div class="gap-info">
              <div class="gap-driver">—</div>
              <div class="gap-ir">—</div>
            </div>
          </div>
        </div>
      `;

      this.shadowRoot.appendChild(template.content.cloneNode(true));
    }

    _cacheElements() {
      if (!this.shadowRoot) return;

      const aheadItem = this.shadowRoot.getElementById('gapAheadItem');
      if (aheadItem) {
        this._aheadTimeEl = aheadItem.querySelector('.gap-time');
        const info = aheadItem.querySelector('.gap-info');
        if (info) {
          this._aheadDriverEl = info.querySelector('.gap-driver');
          this._aheadIREl = info.querySelector('.gap-ir');
        }
        this._aheadCellEl = aheadItem;
      }

      const behindItem = this.shadowRoot.getElementById('gapBehindItem');
      if (behindItem) {
        this._behindTimeEl = behindItem.querySelector('.gap-time');
        const info = behindItem.querySelector('.gap-info');
        if (info) {
          this._behindDriverEl = info.querySelector('.gap-driver');
          this._behindIREl = info.querySelector('.gap-ir');
        }
        this._behindCellEl = behindItem;
      }
    }

    _formatGap(gap) {
      if (gap <= 0 || gap > 999) return '—';
      if (gap < 1) return (gap * 1000).toFixed(0) + 'ms';
      return gap.toFixed(3) + 's';
    }

    _formatIR(ir) {
      if (ir <= 0) return '—';
      return ir >= 1000 ? (ir / 1000).toFixed(1) + 'k' : String(ir);
    }

    render() {
      // Ahead gap
      if (this._aheadTimeEl) {
        const gapStr = this._formatGap(this._aheadGap);

        // Determine color: green if gap is shrinking (approaching), red if growing (falling back)
        const isGainingAhead = this._prevAheadGap > 0 && this._aheadGap < this._prevAheadGap;
        const isLosingAhead = this._aheadGap > this._prevAheadGap && this._prevAheadGap > 0;

        // Tufte: add directional arrows for colorblind accessibility in minimal mode
        const aheadArrow = _isMinimal ? (isGainingAhead ? '↑ ' : isLosingAhead ? '↓ ' : '  ') : '';
        this._aheadTimeEl.textContent = aheadArrow + gapStr;

        this._aheadTimeEl.className = 'gap-time ahead ' + (isGainingAhead ? 'gaining' : isLosingAhead ? 'losing' : '');
        this._prevAheadGap = this._aheadGap;

        if (this._aheadCellEl) {
          this._aheadCellEl.className = 'gap-item ' + (this._aheadTimeEl.classList.contains('gaining') ? 'gaining' : this._aheadTimeEl.classList.contains('losing') ? 'losing' : '');
        }
      }

      if (this._aheadDriverEl) {
        this._aheadDriverEl.textContent = this._aheadDriver;
      }

      if (this._aheadIREl) {
        this._aheadIREl.textContent = this._formatIR(this._aheadIR);
      }

      // Behind gap
      if (this._behindTimeEl) {
        const gapStr = this._formatGap(this._behindGap);

        // For behind: green if gap is growing (pulling away), red if shrinking (being caught)
        const isGainingBehind = this._prevBehindGap > 0 && this._behindGap > this._prevBehindGap;
        const isLosingBehind = this._behindGap < this._prevBehindGap && this._prevBehindGap > 0;

        // Tufte: directional arrows for colorblind-safe encoding
        const behindArrow = _isMinimal ? (isGainingBehind ? '↑ ' : isLosingBehind ? '↓ ' : '  ') : '';
        this._behindTimeEl.textContent = behindArrow + gapStr;

        this._behindTimeEl.className = 'gap-time behind ' + (isGainingBehind ? 'gaining' : isLosingBehind ? 'losing' : '');
        this._prevBehindGap = this._behindGap;

        if (this._behindCellEl) {
          this._behindCellEl.className = 'gap-item ' + (this._behindTimeEl.classList.contains('gaining') ? 'gaining' : this._behindTimeEl.classList.contains('losing') ? 'losing' : '');
        }
      }

      if (this._behindDriverEl) {
        this._behindDriverEl.textContent = this._behindDriver;
      }

      if (this._behindIREl) {
        this._behindIREl.textContent = this._formatIR(this._behindIR);
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
    customElements.define('racecor-gap-display', RaceCorGapDisplay);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = RaceCorGapDisplay;
  }

})();
