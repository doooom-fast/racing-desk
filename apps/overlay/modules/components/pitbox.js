/**
 * @element racecor-pitbox
 * @description Tabbed pit strategy panel (Fuel, Tires, Strategy).
 *
 * Displays pit-stop information:
 * - Fuel consumption and required refill
 * - Tire wear and selection
 * - Pit window and strategy planning
 *
 * @property {Object} fuelData - { currentFuel, consumption, required }
 * @property {Object} tireData - { temps, wear, compound }
 * @property {Object} strategyData - { window, stint }
 * @property {string} activeTab - 'fuel' | 'tires' | 'strategy'
 */

(function() {
  'use strict';

  class RaceCorPitbox extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });

      this._fuelData = {};
      this._tireData = {};
      this._strategyData = {};
      this._activeTab = 'fuel';

      this._tabElements = {};
      this._pageElements = {};

      this._telemetryHandler = null;
    }

    connectedCallback() {
      this._renderTemplate();
      this._cacheElements();
      this._subscribeToData();
      this._switchTab('fuel');
    }

    disconnectedCallback() {
      if (this._telemetryHandler && window) {
        window.removeEventListener('telemetry-update', this._telemetryHandler);
        this._telemetryHandler = null;
      }
    }

    get fuelData() { return this._fuelData; }
    set fuelData(val) { this._fuelData = val || {}; }

    get tireData() { return this._tireData; }
    set tireData(val) { this._tireData = val || {}; }

    get strategyData() { return this._strategyData; }
    set strategyData(val) { this._strategyData = val || {}; }

    get activeTab() { return this._activeTab; }
    set activeTab(val) { this._activeTab = val || 'fuel'; this._switchTab(val); }

    updateData(snapshot) {
      if (!snapshot) return;
      const pre = 'RaceCorProDrive.Plugin.';
      const v = (key) => snapshot[pre + key];

      this._fuelData = {
        current: +v('DS.FuelPct') || 0,
        consumption: +v('DS.FuelPerLapFormatted') || 0,
        required: v('PitBox.FuelDisplay') || '—'
      };

      this._tireData = {
        temps: {
          fl: +v('DS.TyreTempFL') || 0,
          fr: +v('DS.TyreTempFR') || 0,
          rl: +v('DS.TyreTempRL') || 0,
          rr: +v('DS.TyreTempRR') || 0
        },
        wear: {
          fl: +v('GameData.TyreWearFrontLeft') || 0,
          fr: +v('GameData.TyreWearFrontRight') || 0,
          rl: +v('GameData.TyreWearRearLeft') || 0,
          rr: +v('GameData.TyreWearRearRight') || 0
        }
      };

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

          .pb-panel {
            display: flex;
            flex-direction: column;
            height: 100%;
          }

          .pb-tabs {
            display: flex;
            gap: 2px;
            padding: var(--pad);
            border-bottom: 1px solid var(--border);
            background: var(--bg-panel);
          }

          .pb-tab {
            flex: 1;
            padding: 6px;
            background: var(--bg);
            border: 1px solid var(--border);
            border-radius: var(--corner-r);
            text-align: center;
            font-size: var(--fs-xs);
            font-weight: var(--fw-semi);
            cursor: pointer;
            transition: background-color 0.2s;
          }

          .pb-tab:hover {
            background: var(--bg-panel);
          }

          .pb-tab.active {
            background: var(--accent);
            color: var(--bg);
          }

          .pb-pages {
            flex: 1;
            overflow-y: auto;
            padding: var(--pad);
          }

          .pb-page {
            display: none;
          }

          .pb-page.active {
            display: block;
          }

          .pb-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: var(--gap);
            margin-bottom: var(--gap);
            padding: var(--pad);
            background: var(--bg-panel);
            border: 1px solid var(--border);
            border-radius: var(--corner-r);
            font-size: var(--fs-sm);
          }

          .pb-label {
            color: var(--text-secondary);
            font-weight: var(--fw-bold);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            font-size: var(--fs-xs);
          }

          .pb-value {
            color: var(--text-primary);
            font-family: var(--ff-mono);
            font-weight: var(--fw-semi);
            text-align: right;
          }

          .pb-bar {
            grid-column: 1 / -1;
            height: 8px;
            background: var(--bg);
            border-radius: 4px;
            overflow: hidden;
            border: 1px solid var(--border);
          }

          .pb-bar-fill {
            height: 100%;
            background: hsl(145, 70%, 55%);
            transition: width 0.2s ease;
          }

          .pb-bar-fill.warn {
            background: hsl(45, 90%, 55%);
          }

          .pb-bar-fill.crit {
            background: hsl(0, 80%, 55%);
          }
        </style>

        <div class="pb-panel">
          <div class="pb-tabs">
            <div class="pb-tab active" data-tab="fuel">Fuel</div>
            <div class="pb-tab" data-tab="tires">Tires</div>
            <div class="pb-tab" data-tab="strategy">Strategy</div>
          </div>

          <div class="pb-pages">
            <!-- Fuel Tab -->
            <div class="pb-page active" data-page="fuel">
              <div class="pb-row">
                <div><div class="pb-label">Current</div></div>
                <div><div class="pb-value" id="pbFuelCurrent">—</div></div>
              </div>
              <div class="pb-row">
                <div><div class="pb-label">Per Lap</div></div>
                <div><div class="pb-value" id="pbFuelPerLap">—</div></div>
              </div>
              <div class="pb-row">
                <div><div class="pb-label">Required</div></div>
                <div><div class="pb-value" id="pbFuelRequired">—</div></div>
              </div>
              <div class="pb-bar">
                <div class="pb-bar-fill" id="pbFuelBar" style="width: 50%;"></div>
              </div>
            </div>

            <!-- Tires Tab -->
            <div class="pb-page" data-page="tires">
              <div class="pb-row">
                <div><div class="pb-label">FL Temp</div></div>
                <div><div class="pb-value" id="pbTempFL">—</div></div>
              </div>
              <div class="pb-row">
                <div><div class="pb-label">FR Temp</div></div>
                <div><div class="pb-value" id="pbTempFR">—</div></div>
              </div>
              <div class="pb-row">
                <div><div class="pb-label">RL Temp</div></div>
                <div><div class="pb-value" id="pbTempRL">—</div></div>
              </div>
              <div class="pb-row">
                <div><div class="pb-label">RR Temp</div></div>
                <div><div class="pb-value" id="pbTempRR">—</div></div>
              </div>
            </div>

            <!-- Strategy Tab -->
            <div class="pb-page" data-page="strategy">
              <div class="pb-row">
                <div><div class="pb-label">Pit Window</div></div>
                <div><div class="pb-value" id="pbWindow">—</div></div>
              </div>
              <div class="pb-row">
                <div><div class="pb-label">Strategy</div></div>
                <div><div class="pb-value" id="pbStint">—</div></div>
              </div>
            </div>
          </div>
        </div>
      `;

      this.shadowRoot.appendChild(template.content.cloneNode(true));
    }

    _cacheElements() {
      if (!this.shadowRoot) return;
      const tabs = this.shadowRoot.querySelectorAll('.pb-tab');
      tabs.forEach(tab => {
        const t = tab.dataset.tab;
        this._tabElements[t] = tab;
        tab.addEventListener('click', () => this._switchTab(t));
      });

      const pages = this.shadowRoot.querySelectorAll('.pb-page');
      pages.forEach(page => {
        this._pageElements[page.dataset.page] = page;
      });
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

    _switchTab(tab) {
      this._activeTab = tab;
      Object.keys(this._tabElements).forEach(t => {
        this._tabElements[t].classList.toggle('active', t === tab);
      });
      Object.keys(this._pageElements).forEach(p => {
        this._pageElements[p].classList.toggle('active', p === tab);
      });
    }

    render() {
      const el = (id) => this.shadowRoot.querySelector('#' + id);

      // Fuel tab
      if (el('pbFuelCurrent')) el('pbFuelCurrent').textContent = this._fuelData.current ? Math.round(this._fuelData.current) + '%' : '—';
      if (el('pbFuelPerLap')) el('pbFuelPerLap').textContent = this._fuelData.consumption || '—';
      if (el('pbFuelRequired')) el('pbFuelRequired').textContent = this._fuelData.required;
      if (el('pbFuelBar')) {
        el('pbFuelBar').style.width = Math.min(100, this._fuelData.current) + '%';
        el('pbFuelBar').className = 'pb-bar-fill' +
          (this._fuelData.current < 10 ? ' crit' : this._fuelData.current < 25 ? ' warn' : '');
      }

      // Tires tab
      const formatTemp = (c) => c > 0 ? Math.round(c) + '°C' : '—';
      if (el('pbTempFL')) el('pbTempFL').textContent = formatTemp(this._tireData.temps?.fl);
      if (el('pbTempFR')) el('pbTempFR').textContent = formatTemp(this._tireData.temps?.fr);
      if (el('pbTempRL')) el('pbTempRL').textContent = formatTemp(this._tireData.temps?.rl);
      if (el('pbTempRR')) el('pbTempRR').textContent = formatTemp(this._tireData.temps?.rr);

      // Strategy tab
      if (el('pbWindow')) el('pbWindow').textContent = this._strategyData.window || '—';
      if (el('pbStint')) el('pbStint').textContent = this._strategyData.stint || '—';
    }
  }

  customElements.define('racecor-pitbox', RaceCorPitbox);
})();
