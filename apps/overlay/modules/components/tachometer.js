/**
 * @element racecor-tachometer
 * @description RPM gauge with segmented color bar, gear display, and speed readout.
 *
 * Shows RPM as a horizontal bar filled left-to-right with color zones:
 * - Green: RPM < 55% of max
 * - Yellow: RPM 55-73% of max
 * - Red: RPM 73-91% of max
 * - Redline flash: RPM >= 91%
 *
 * Large gear number dominates the layout. Speed display with unit in corner.
 * Properties drive all updates via telemetry subscription.
 *
 * @property {number} rpmRatio - RPM / maxRPM, 0.0-1.0
 * @property {string} gear - Current gear ('N', 'R', '1'-'8', etc.)
 * @property {number} speed - Current speed in display units
 * @property {string} speedUnit - Speed unit label ('MPH', 'KPH')
 * @property {number} rpmValue - Actual RPM numeric value for readout
 */

(function() {
  'use strict';

  class RaceCorTachometer extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });

      this._rpmRatio = 0;
      this._gear = 'N';
      this._speed = 0;
      this._speedUnit = 'MPH';
      this._rpmValue = 0;

      this._gearEl = null;
      this._speedEl = null;
      this._speedUnitEl = null;
      this._rpmEl = null;
      this._barTrackEl = null;
      this._segmentEls = [];

      this._telemetryHandler = null;
      this._prevLitCount = 0;
      this._rpmPulseTimer = null;
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
      if (this._rpmPulseTimer) {
        clearTimeout(this._rpmPulseTimer);
        this._rpmPulseTimer = null;
      }
    }

    get rpmRatio() { return this._rpmRatio; }
    set rpmRatio(val) { this._rpmRatio = Math.max(0, Math.min(1, +val || 0)); }

    get gear() { return this._gear; }
    set gear(val) { this._gear = String(val || 'N'); }

    get speed() { return this._speed; }
    set speed(val) { this._speed = +val || 0; }

    get speedUnit() { return this._speedUnit; }
    set speedUnit(val) { this._speedUnit = String(val || 'MPH'); }

    get rpmValue() { return this._rpmValue; }
    set rpmValue(val) { this._rpmValue = +val || 0; }

    updateData(snapshot) {
      if (!snapshot) return;

      const dsPre = 'RaceCorProDrive.Plugin.DS.';
      const gameDataPre = 'DataCorePlugin.GameData.';

      // RPM ratio: server-computed preferred, fallback to client math
      const maxRpm = +snapshot[gameDataPre + 'CarSettings_MaxRPM'] || 1;
      this._rpmRatio = +(snapshot[dsPre + 'RpmRatio']) ||
        (maxRpm > 0 ? Math.min(1, (+snapshot[gameDataPre + 'Rpms'] || 0) / maxRpm) : 0);

      this._rpmValue = +snapshot[gameDataPre + 'Rpms'] || 0;
      this._gear = snapshot[gameDataPre + 'Gear'] || 'N';
      this._speed = +snapshot[gameDataPre + 'SpeedMph'] || 0;

      // Speed unit from DisplayUnits (0=imperial/MPH, 1=metric/KPH)
      const displayUnits = +snapshot[dsPre + 'DisplayUnits'];
      this._speedUnit = (displayUnits === 1) ? 'KPH' : 'MPH';

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

          .tacho-container {
            display: flex;
            flex-direction: column;
            height: 100%;
            width: 100%;
            position: relative;
          }

          .tacho-top-row {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            flex: 0 0 auto;
            min-height: 0;
          }

          .tacho-gear {
            font-size: 64px;
            font-weight: var(--fw-black);
            line-height: 0.85;
            text-align: left;
            flex: 0 1 auto;
          }

          .tacho-speed-cluster {
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            gap: 0;
            margin-left: auto;
            flex: 0 1 auto;
          }

          .speed-value {
            font-size: 20px;
            font-weight: var(--fw-black);
            line-height: 1;
            font-variant-numeric: tabular-nums;
            letter-spacing: -0.01em;
            text-align: right;
          }

          .speed-unit {
            font-size: var(--fs-xs);
            font-weight: var(--fw-medium);
            color: var(--text-dim);
            text-align: right;
            line-height: 1;
          }

          .tacho-rpm {
            font-size: var(--fs-lg);
            font-weight: var(--fw-bold);
            font-variant-numeric: tabular-nums;
            transition: color 0.2s ease, text-shadow 0.15s ease-out, transform 0.15s ease-out;
            text-align: right;
            line-height: 1;
            margin: 2px 0 4px 0;
            flex: 0 0 auto;
          }

          .tacho-rpm.rpm-pulse-green {
            text-shadow: 0 0 8px var(--green), 0 0 16px hsla(140, 70%, 50%, 0.3);
            transform: scale(1.04);
          }
          .tacho-rpm.rpm-pulse-yellow {
            text-shadow: 0 0 8px var(--amber), 0 0 16px hsla(45, 90%, 55%, 0.3);
            transform: scale(1.04);
          }
          .tacho-rpm.rpm-pulse-red {
            text-shadow: 0 0 10px var(--red), 0 0 20px hsla(0, 80%, 50%, 0.4);
            transform: scale(1.06);
          }

          .tacho-bar-track {
            display: flex;
            gap: 2px;
            flex: 1;
            align-items: flex-end;
            margin-top: 4px;
          }

          .tacho-seg {
            flex: 1;
            border-radius: 2px 2px 0 0;
            background: hsla(0,0%,100%,0.06);
            transition: background var(--t-fast), height 60ms linear, box-shadow var(--t-fast);
            min-height: 2px;
            height: 2px;
            position: relative;
            border: 1px solid hsla(0,0%,100%,0.04);
            border-bottom: none;
          }

          .tacho-seg.lit-green {
            background: linear-gradient(
              to bottom,
              hsla(140, 75%, 70%, 0.95) 0%,
              var(--green) 35%,
              hsla(140, 80%, 30%, 0.90) 100%
            );
            border-color: hsla(140, 60%, 50%, 0.30);
            box-shadow:
              inset 0  1px 0 hsla(140, 80%, 85%, 0.40),
              inset 0 -1px 2px hsla(140, 80%, 20%, 0.50),
              0 0 4px hsla(140, 70%, 50%, 0.35),
              0 0 10px hsla(140, 70%, 50%, 0.12);
            opacity: 1;
          }

          .tacho-seg.lit-yellow {
            background: linear-gradient(
              to bottom,
              hsla(45, 95%, 75%, 0.95) 0%,
              var(--amber) 35%,
              hsla(40, 90%, 28%, 0.90) 100%
            );
            border-color: hsla(45, 80%, 50%, 0.30);
            box-shadow:
              inset 0  1px 0 hsla(45, 90%, 88%, 0.45),
              inset 0 -1px 2px hsla(40, 80%, 20%, 0.50),
              0 0 5px hsla(45, 85%, 55%, 0.40),
              0 0 12px hsla(45, 85%, 55%, 0.15);
            opacity: 1;
          }

          .tacho-seg.lit-red {
            background: linear-gradient(
              to bottom,
              hsla(0, 85%, 65%, 0.95) 0%,
              var(--red) 35%,
              hsla(0, 80%, 25%, 0.90) 100%
            );
            border-color: hsla(0, 70%, 50%, 0.35);
            box-shadow:
              inset 0  1px 0 hsla(0, 80%, 80%, 0.45),
              inset 0 -1px 2px hsla(0, 80%, 18%, 0.55),
              0 0 6px hsla(0, 80%, 50%, 0.45),
              0 0 14px hsla(0, 80%, 50%, 0.18);
            opacity: 1;
          }

          .tacho-seg.lit-redline {
            background: linear-gradient(
              to bottom,
              hsla(0, 90%, 72%, 1.0) 0%,
              var(--red) 30%,
              hsla(0, 85%, 28%, 0.95) 100%
            );
            border-color: hsla(0, 80%, 50%, 0.50);
            box-shadow:
              inset 0  1px 0 hsla(0, 85%, 85%, 0.55),
              inset 0 -1px 2px hsla(0, 85%, 18%, 0.60),
              0 0 8px hsla(0, 85%, 50%, 0.55),
              0 0 18px hsla(0, 85%, 50%, 0.25);
            animation: redline-pulse 0.3s ease-in-out infinite alternate;
          }

          @keyframes redline-pulse {
            0% { opacity: 0.84; }
            100% { opacity: 1; }
          }

          /* ── MINIMAL MODE — Tufte-pure: flat segments, bigger numbers ── */
          :host-context(body.mode-minimal) .tacho-gear {
            font-size: 80px;
          }

          :host-context(body.mode-minimal) .speed-value {
            font-size: 28px;
            font-weight: var(--fw-black);
          }

          :host-context(body.mode-minimal) .tacho-rpm {
            font-size: 16px;
            text-shadow: none !important;
            transform: none !important;
          }

          :host-context(body.mode-minimal) .tacho-seg {
            border: none;
            box-shadow: none !important;
            border-radius: 1px 1px 0 0;
            transition: background 60ms linear, height 60ms linear;
          }

          :host-context(body.mode-minimal) .tacho-seg.lit-green {
            background: var(--green);
            box-shadow: none;
            border: none;
          }

          :host-context(body.mode-minimal) .tacho-seg.lit-yellow {
            background: var(--amber);
            box-shadow: none;
            border: none;
          }

          :host-context(body.mode-minimal) .tacho-seg.lit-red {
            background: var(--red);
            box-shadow: none;
            border: none;
          }

          :host-context(body.mode-minimal) .tacho-seg.lit-redline {
            background: var(--red);
            box-shadow: none;
            border: none;
            animation: none;
            opacity: 1;
          }

          :host-context(body.mode-minimal) .tacho-rpm.rpm-pulse-green,
          :host-context(body.mode-minimal) .tacho-rpm.rpm-pulse-yellow,
          :host-context(body.mode-minimal) .tacho-rpm.rpm-pulse-red {
            text-shadow: none !important;
            transform: none !important;
          }
        </style>

        <div class="tacho-container">
          <div class="tacho-top-row">
            <div class="tacho-gear" id="tachoGear">N</div>
            <div class="tacho-speed-cluster">
              <div class="speed-value" id="tachoSpeed">0</div>
              <div class="speed-unit" id="tachoSpeedUnit">MPH</div>
            </div>
          </div>
          <span class="tacho-rpm" id="tachoRpm" style="color: var(--text-dim);">0</span>
          <div class="tacho-bar-track" id="tachoBarTrack"></div>
        </div>
      `;

      this.shadowRoot.appendChild(template.content.cloneNode(true));
    }

    _cacheElements() {
      if (!this.shadowRoot) return;
      this._gearEl = this.shadowRoot.querySelector('#tachoGear');
      this._speedEl = this.shadowRoot.querySelector('#tachoSpeed');
      this._speedUnitEl = this.shadowRoot.querySelector('#tachoSpeedUnit');
      this._rpmEl = this.shadowRoot.querySelector('#tachoRpm');
      this._barTrackEl = this.shadowRoot.querySelector('#tachoBarTrack');

      // Create segment elements (11 segments like the original)
      const TACH_SEGS = 11;
      if (this._barTrackEl) {
        this._barTrackEl.innerHTML = '';
        for (let i = 0; i < TACH_SEGS; i++) {
          const seg = document.createElement('div');
          seg.className = 'tacho-seg';
          this._barTrackEl.appendChild(seg);
          this._segmentEls.push(seg);
        }
      }
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
      const TACH_SEGS = 11;
      const RPM_COLORS = {
        green: 'var(--green)',
        yellow: 'var(--amber)',
        red: 'var(--red)',
        dim: 'var(--text-dim)',
      };

      // Update gear
      if (this._gearEl) {
        this._gearEl.textContent = this._gear;
      }

      // Update speed and unit
      if (this._speedEl) {
        this._speedEl.textContent = this._speed > 0 ? Math.round(this._speed) : '0';
      }
      if (this._speedUnitEl) {
        this._speedUnitEl.textContent = this._speedUnit;
      }

      // Update RPM numeric readout and segments
      const lit = Math.round(this._rpmRatio * TACH_SEGS);
      let topColor = 'dim';

      if (this._segmentEls.length === TACH_SEGS) {
        for (let i = 0; i < TACH_SEGS; i++) {
          const seg = this._segmentEls[i];
          seg.className = 'tacho-seg';

          if (i < lit) {
            const fraction = i / TACH_SEGS;
            if (fraction < 0.55) {
              seg.classList.add('lit-green');
              topColor = 'green';
            } else if (fraction < 0.73) {
              seg.classList.add('lit-yellow');
              topColor = 'yellow';
            } else if (fraction < 0.91) {
              seg.classList.add('lit-red');
              topColor = 'red';
            } else {
              seg.classList.add('lit-redline');
              topColor = 'red';
            }
            seg.style.height = '100%';
          } else {
            seg.style.height = '2px';
          }
        }
      }

      // Update RPM text color
      if (this._rpmEl) {
        this._rpmEl.style.color = RPM_COLORS[topColor];
        this._rpmEl.textContent = this._rpmValue > 0 ? Math.round(this._rpmValue) : '0';

        // Pulse animation when a new segment lights up
        if (lit > this._prevLitCount && lit > 0) {
          const pulseClass = topColor === 'green' ? 'rpm-pulse-green'
            : topColor === 'yellow' ? 'rpm-pulse-yellow' : 'rpm-pulse-red';
          this._rpmEl.classList.remove('rpm-pulse-green', 'rpm-pulse-yellow', 'rpm-pulse-red');
          // Force reflow to restart animation
          void this._rpmEl.offsetWidth;
          this._rpmEl.classList.add(pulseClass);

          if (this._rpmPulseTimer) clearTimeout(this._rpmPulseTimer);
          this._rpmPulseTimer = setTimeout(() => {
            this._rpmEl.classList.remove('rpm-pulse-green', 'rpm-pulse-yellow', 'rpm-pulse-red');
          }, 180);
        }
      }

      this._prevLitCount = lit;
    }
  }

  customElements.define('racecor-tachometer', RaceCorTachometer);
})();
