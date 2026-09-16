/**
 * @element racecor-tire-grid
 * @description 2x2 tire temperature and wear display grid showing all four wheels.
 *
 * Displays tire temperature with color-coded gradient (blue → green → yellow → red),
 * wear percentage as a horizontal bar below each tire cell, and physical tire layout.
 *
 * Accepts telemetry data via `updateData(snapshot)` method, called from poll-engine
 * or subscribed to `telemetry-update` custom events.
 *
 * @attribute none (uses properties instead)
 *
 * @property {Object} temps - Tire temperatures: { fl: number, fr: number, rl: number, rr: number }
 * @property {Object} wear - Tire wear percentages: { fl: number, fr: number, rl: number, rr: number }
 * @property {string} unit - Temperature unit: 'C' or 'F' (default: 'C')
 *
 * @fires none (no custom events)
 *
 * @slot default (not used, Shadow DOM only)
 *
 * @example
 * <racecor-tire-grid></racecor-tire-grid>
 *
 * <script>
 *   const grid = document.querySelector('racecor-tire-grid');
 *   grid.updateData(snapshot);
 * </script>
 */

(function() {
  'use strict';

  class RaceCorTireGrid extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });

      // ── Internal state ──────────────────────────────────────────
      this._temps = { fl: 0, fr: 0, rl: 0, rr: 0 };
      this._wear = { fl: 0, fr: 0, rl: 0, rr: 0 };
      this._unit = 'C';

      // ── Cached element references ────────────────────────────────
      this._cells = {};  // { fl, fr, rl, rr } → { tempEl, wearEl }

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
      this._cells = {};
    }

    // ╔═══════════════════════════════════════════════════════════╗
    // ║ PROPERTIES                                                 ║
    // ╚═══════════════════════════════════════════════════════════╝

    get temps() { return this._temps; }
    set temps(val) { this._temps = val || { fl: 0, fr: 0, rl: 0, rr: 0 }; }

    get wear() { return this._wear; }
    set wear(val) { this._wear = val || { fl: 0, fr: 0, rl: 0, rr: 0 }; }

    get unit() { return this._unit; }
    set unit(val) { this._unit = val || 'C'; }

    // ╔═══════════════════════════════════════════════════════════╗
    // ║ PUBLIC API — updateData()                                  ║
    // ╚═══════════════════════════════════════════════════════════╝

    updateData(snapshot, isImperial = false) {
      if (!snapshot) return;

      const _demo = snapshot._demo || +(snapshot['RaceCorProDrive.Plugin.DemoMode'] || 0);
      this._unit = isImperial ? 'F' : 'C';

      // Extract tire temps and wear
      if (_demo) {
        this._temps = {
          fl: +(snapshot['RaceCorProDrive.Plugin.Demo.TyreTempFL'] || 0),
          fr: +(snapshot['RaceCorProDrive.Plugin.Demo.TyreTempFR'] || 0),
          rl: +(snapshot['RaceCorProDrive.Plugin.Demo.TyreTempRL'] || 0),
          rr: +(snapshot['RaceCorProDrive.Plugin.Demo.TyreTempRR'] || 0)
        };
        this._wear = {
          fl: (1 - +(snapshot['RaceCorProDrive.Plugin.Demo.TyreWearFL'] || 0)) * 100,
          fr: (1 - +(snapshot['RaceCorProDrive.Plugin.Demo.TyreWearFR'] || 0)) * 100,
          rl: (1 - +(snapshot['RaceCorProDrive.Plugin.Demo.TyreWearRL'] || 0)) * 100,
          rr: (1 - +(snapshot['RaceCorProDrive.Plugin.Demo.TyreWearRR'] || 0)) * 100
        };
      } else {
        this._temps = {
          fl: +(snapshot['DataCorePlugin.GameData.TyreTempFrontLeft'] || 0),
          fr: +(snapshot['DataCorePlugin.GameData.TyreTempFrontRight'] || 0),
          rl: +(snapshot['DataCorePlugin.GameData.TyreTempRearLeft'] || 0),
          rr: +(snapshot['DataCorePlugin.GameData.TyreTempRearRight'] || 0)
        };
        this._wear = {
          fl: snapshot['DataCorePlugin.GameData.TyreWearFrontLeft'] != null ? (1 - +snapshot['DataCorePlugin.GameData.TyreWearFrontLeft']) * 100 : -1,
          fr: snapshot['DataCorePlugin.GameData.TyreWearFrontRight'] != null ? (1 - +snapshot['DataCorePlugin.GameData.TyreWearFrontRight']) * 100 : -1,
          rl: snapshot['DataCorePlugin.GameData.TyreTempRearLeft'] != null ? (1 - +snapshot['DataCorePlugin.GameData.TyreTempRearLeft']) * 100 : -1,
          rr: snapshot['DataCorePlugin.GameData.TyreTempRearRight'] != null ? (1 - +snapshot['DataCorePlugin.GameData.TyreTempRearRight']) * 100 : -1
        };
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

          .tire-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            grid-template-rows: 1fr 1fr;
            gap: var(--gap);
          }

          .tire-cell {
            background: var(--bg-panel);
            border: 1px solid var(--border);
            border-radius: var(--corner-r);
            padding: var(--pad);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-width: 50px;
            min-height: 50px;
          }

          .tire-position {
            font-size: var(--fs-xs);
            font-weight: var(--fw-bold);
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 4px;
          }

          .tire-temp {
            font-size: var(--fs-lg);
            font-weight: var(--fw-semi);
            transition: color 0.2s ease;
            margin-bottom: 4px;
          }

          .tire-unit {
            font-size: var(--fs-xs);
            color: var(--text-dim);
            margin-left: 1px;
          }

          .tire-wear-outer {
            width: 100%;
            height: 4px;
            background: var(--bg);
            border-radius: 2px;
            overflow: hidden;
            border: 1px solid var(--border);
            margin-top: 2px;
          }

          .tire-wear-inner {
            height: 100%;
            background: linear-gradient(to right, var(--green), var(--amber), var(--red));
            transition: width 0.2s ease;
            border-radius: 1px;
          }

          .tire-wear-label {
            font-size: 8px;
            color: var(--text-dim);
            margin-top: 2px;
          }

          /* Optimal range annotation — shown only in minimal mode */
          .tire-opt-range {
            display: none;
            font-size: 8px;
            color: var(--text-dim);
            text-align: center;
            margin-bottom: 2px;
            font-family: var(--ff-mono);
            letter-spacing: 0.03em;
          }

          /* ── MINIMAL MODE — Tufte-pure: big temps, no chrome, spatial = label ── */
          :host-context(body.mode-minimal) .tire-opt-range {
            display: block;
          }

          :host-context(body.mode-minimal) .tire-cell {
            background: transparent;
            border: none;
            border-radius: 0;
            padding: 2px;
            min-width: 40px;
            min-height: 36px;
          }

          /* Spatial position IS the label — remove redundant text labels */
          :host-context(body.mode-minimal) .tire-position {
            display: none;
          }

          :host-context(body.mode-minimal) .tire-temp {
            font-size: 22px;
            font-weight: var(--fw-black);
            margin-bottom: 0;
          }

          :host-context(body.mode-minimal) .tire-unit {
            font-size: 10px;
          }

          /* Wear bar is redundant with the wear label number */
          :host-context(body.mode-minimal) .tire-wear-outer {
            display: none;
          }

          :host-context(body.mode-minimal) .tire-wear-label {
            font-size: 7px;
            color: var(--text-dim);
            margin-top: 0;
          }
        </style>

        <div class="tire-opt-range">opt 80–95°C</div>
        <div class="tire-grid">
          <div class="tire-cell" data-pos="fl">
            <div class="tire-position">FL</div>
            <div class="tire-temp">—<span class="tire-unit">°C</span></div>
            <div class="tire-wear-outer">
              <div class="tire-wear-inner" style="width: 0%;"></div>
            </div>
            <div class="tire-wear-label">—%</div>
          </div>
          <div class="tire-cell" data-pos="fr">
            <div class="tire-position">FR</div>
            <div class="tire-temp">—<span class="tire-unit">°C</span></div>
            <div class="tire-wear-outer">
              <div class="tire-wear-inner" style="width: 0%;"></div>
            </div>
            <div class="tire-wear-label">—%</div>
          </div>
          <div class="tire-cell" data-pos="rl">
            <div class="tire-position">RL</div>
            <div class="tire-temp">—<span class="tire-unit">°C</span></div>
            <div class="tire-wear-outer">
              <div class="tire-wear-inner" style="width: 0%;"></div>
            </div>
            <div class="tire-wear-label">—%</div>
          </div>
          <div class="tire-cell" data-pos="rr">
            <div class="tire-position">RR</div>
            <div class="tire-temp">—<span class="tire-unit">°C</span></div>
            <div class="tire-wear-outer">
              <div class="tire-wear-inner" style="width: 0%;"></div>
            </div>
            <div class="tire-wear-label">—%</div>
          </div>
        </div>
      `;

      this.shadowRoot.appendChild(template.content.cloneNode(true));
    }

    _cacheElements() {
      if (!this.shadowRoot) return;

      ['fl', 'fr', 'rl', 'rr'].forEach(pos => {
        const cell = this.shadowRoot.querySelector(`[data-pos="${pos}"]`);
        if (cell) {
          this._cells[pos] = {
            tempEl: cell.querySelector('.tire-temp'),
            wearEl: cell.querySelector('.tire-wear-inner'),
            wearLabelEl: cell.querySelector('.tire-wear-label'),
            unitEl: cell.querySelector('.tire-unit')
          };
        }
      });
    }

    _tempToColor(temp) {
      // Blue (cold) → Green (optimal) → Yellow (hot) → Red (danger)
      // Assume ranges: < 60C = blue, 60-80 = green, 80-100 = yellow, > 100 = red
      if (temp < 60) return '#1e88e5';    // blue
      if (temp < 80) return '#43a047';    // green
      if (temp < 100) return '#ffb300';   // amber
      return '#e53935';                    // red
    }

    render() {
      ['fl', 'fr', 'rl', 'rr'].forEach(pos => {
        const cell = this._cells[pos];
        if (!cell) return;

        const temp = this._temps[pos] || 0;
        const wear = this._wear[pos] || 0;
        const unit = this._unit;

        // Update temperature
        if (cell.tempEl) {
          const displayTemp = temp > 0 ? Math.round(temp) : '—';
          cell.tempEl.innerHTML = displayTemp + `<span class="tire-unit">°${unit}</span>`;
          cell.tempEl.style.color = temp > 0 ? this._tempToColor(temp) : 'var(--text-dim)';
        }

        // Update wear bar
        if (cell.wearEl && wear >= 0) {
          cell.wearEl.style.width = Math.max(0, Math.min(100, wear)) + '%';
        }

        // Update wear label
        if (cell.wearLabelEl) {
          cell.wearLabelEl.textContent = wear >= 0 ? Math.round(wear) + '%' : '—%';
        }
      });
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
    customElements.define('racecor-tire-grid', RaceCorTireGrid);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = RaceCorTireGrid;
  }

})();
