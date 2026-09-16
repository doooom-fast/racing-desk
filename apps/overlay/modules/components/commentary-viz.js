/**
 * @element racecor-commentary-viz
 * @description Advanced commentary visualization with Canvas-based telemetry charts.
 *
 * Displays sentiment-colored commentary panel with track image backdrop,
 * Canvas-based visualization (line charts, gauges, bar graphs, g-force plots).
 * Dynamic show/hide animations with border glow effects.
 * WebGL glow canvas around the panel for ambient light effects.
 *
 * Visualization types: line, gauge, gforce, bar, delta, quad, counter, grid, incident
 * Topic-based config system maps commentary topics to appropriate viz types.
 * Live telemetry data drives chart updates and value displays.
 *
 * @property {string} title - Commentary title/headline
 * @property {string} text - Commentary main text
 * @property {string} meta - Metadata (speaker, source)
 * @property {string} topicId - Topic ID for viz type selection
 * @property {number} sentimentHue - Sentiment hue (0-360) for color tint
 * @property {boolean} visible - Show/hide the panel
 * @property {string} trackImage - Track image URL for backdrop
 */

(function() {
  'use strict';

  class RaceCorCommentaryViz extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });

      this._title = '';
      this._text = '';
      this._meta = '';
      this._topicId = '';
      this._sentimentHue = 0;
      this._visible = false;
      this._trackImage = '';

      this._titleEl = null;
      this._textEl = null;
      this._metaEl = null;
      this._trackImgEl = null;
      this._vizCanvas = null;
      this._vizCtx = null;
      this._containerEl = null;

      this._vizActive = false;
      this._vizHistory = [];
      this._VIZ_HIST_LEN = 60;
      this._telemetryData = {};

      this._vizConfig = {
        // Car response
        'spin_catch': { type: 'gforce', label: 'G-Force', unit: 'g' },
        'high_cornering_load': { type: 'gforce', label: 'Cornering Load', unit: 'g' },
        'heavy_braking': { type: 'line', label: 'Brake Pressure', unit: '%', src: 'brake' },
        'car_balance_sustained': { type: 'gforce', label: 'Car Balance', unit: 'g' },
        'rapid_gear_change': { type: 'line', label: 'RPM', unit: '', src: 'rpm' },
        'wall_contact': { type: 'incident', label: 'Incidents' },
        'off_track': { type: 'incident', label: 'Incidents' },
        'kerb_hit': { type: 'gforce', label: 'Impact', unit: 'g' },

        // Hardware
        'abs_activation': { type: 'line', label: 'Brake + ABS', unit: '%', src: 'brake' },
        'tc_intervention': { type: 'line', label: 'Throttle + TC', unit: '%', src: 'throttle' },
        'ffb_torque_spike': { type: 'line', label: 'Steer Torque', unit: '', src: 'steerTorque' },
        'brake_bias_change': { type: 'gauge', label: 'Brake Bias', unit: '%', src: 'brakeBias', min: 40, max: 65 },

        // Game feel
        'qualifying_push': { type: 'delta', label: 'Lap Delta', unit: 's', src: 'lapDelta' },
        'personal_best': { type: 'delta', label: 'Lap Delta', unit: 's', src: 'lapDelta' },
        'long_stint': { type: 'counter', label: 'Laps', src: 'laps' },
        'session_time_low': { type: 'counter', label: 'Remaining', src: 'sessionTime' },
        'drs_active': { type: 'line', label: 'Speed', unit: 'mph', src: 'speed' },
        'ers_low': { type: 'gauge', label: 'ERS Battery', unit: '%', src: 'fuel', min: 0, max: 100 },

        // Racing experience
        'close_battle': { type: 'delta', label: 'Gap', unit: 's', src: 'gapAhead' },
        'position_gained': { type: 'grid', label: 'Grid Position' },
        'position_lost': { type: 'grid', label: 'Grid Position' },
        'incident_spike': { type: 'incident', label: 'Incidents' },
        'low_fuel': { type: 'gauge', label: 'Fuel', unit: 'L', src: 'fuel', min: 0, max: 100 },
        'hot_tyres': { type: 'quad', label: 'Tyre Temps', unit: '°C', src: 'tyreTemp' },
        'tyre_wear_high': { type: 'quad', label: 'Tyre Wear', unit: '%', src: 'tyreWear' },
        'track_temp_hot': { type: 'counter', label: 'Track Temp', src: 'trackTemp' },
        'track_temp_cold': { type: 'counter', label: 'Track Temp', src: 'trackTemp' },
        'wet_track': { type: 'counter', label: 'Track Temp', src: 'trackTemp' },
        'pit_entry': { type: 'counter', label: 'Laps', src: 'laps' },
        'race_start': { type: 'grid', label: 'Grid Position' },
        'formation_lap': { type: 'grid', label: 'Grid Position' },
      };

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
    }

    get title() { return this._title; }
    set title(val) { this._title = String(val || ''); }

    get text() { return this._text; }
    set text(val) { this._text = String(val || ''); }

    get meta() { return this._meta; }
    set meta(val) { this._meta = String(val || ''); }

    get topicId() { return this._topicId; }
    set topicId(val) { this._topicId = String(val || ''); }

    get sentimentHue() { return this._sentimentHue; }
    set sentimentHue(val) { this._sentimentHue = +val || 0; }

    get visible() { return this._visible; }
    set visible(val) { this._visible = !!val; }

    get trackImage() { return this._trackImage; }
    set trackImage(val) { this._trackImage = String(val || ''); }

    updateData(snapshot) {
      if (!snapshot) return;

      const dsPre = 'RaceCorProDrive.Plugin.DS.';
      const gameDataPre = 'DataCorePlugin.GameData.';

      this._telemetryData = {
        brake: +(snapshot[dsPre + 'BrakeNorm']) || 0,
        throttle: +(snapshot[dsPre + 'ThrottleNorm']) || 0,
        rpmRatio: +(snapshot[dsPre + 'RpmRatio']) || 0,
        speed: +snapshot[gameDataPre + 'SpeedMph'] || 0,
        fuel: +snapshot[gameDataPre + 'Fuel'] || 0,
        lapDelta: +(snapshot[dsPre + 'LapDelta']) || 0,
        incidents: +(snapshot[dsPre + 'IncidentCount']) || 0,
        laps: +(snapshot[dsPre + 'CompletedLaps']) || 0,
      };

      if (this._vizActive) {
        this._renderVizFrame();
      }
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

          .commentary-inner {
            position: relative;
            width: 280px;
            flex: 1;
            background: hsla(var(--commentary-h, ${this._sentimentHue}), 50%, 13%, 0.96);
            border: 1px solid hsla(var(--commentary-h, ${this._sentimentHue}), 50%, 27%, 0.50);
            border-radius: var(--corner-r);
            padding: 14px;
            display: flex;
            flex-direction: column;
            justify-content: flex-start;
            transition: background 0.8s ease, border-color 0.8s ease;
            overflow: visible;
            min-height: 0;
            opacity: 0;
            transition: opacity 0.4s ease;
          }

          .commentary-inner.visible {
            opacity: 1;
          }

          .commentary-title {
            font-family: var(--ff);
            font-size: 18px;
            font-weight: 700;
            line-height: 1.0;
            margin-bottom: 6px;
            padding-right: 38px;
          }

          .commentary-icon {
            position: absolute;
            top: 12px;
            right: 12px;
            width: 24px;
            height: 24px;
            opacity: 0.85;
          }

          .commentary-text {
            font-family: sofia-pro-comp, var(--ff);
            font-size: 14px;
            font-weight: var(--fw-medium);
            line-height: 1.2;
            color: var(--text-primary);
            flex: 1;
            overflow: hidden;
            -webkit-mask-image: linear-gradient(to bottom, black 85%, transparent 100%);
            mask-image: linear-gradient(to bottom, black 85%, transparent 100%);
          }

          .commentary-viz-canvas {
            width: 100%;
            height: 100px;
            margin-top: 8px;
            border-radius: var(--corner-r);
            background: hsla(0,0%,0%,0.2);
          }

          .commentary-track-img {
            width: calc(100% + 28px);
            margin: -14px -14px 10px;
            height: 0;
            overflow: hidden;
            border-radius: var(--corner-r) var(--corner-r) 0 0;
            background-size: cover;
            background-position: center;
            background-repeat: no-repeat;
            position: relative;
            opacity: 0;
            transition: height 0.5s cubic-bezier(.4,0,.2,1), opacity 0.6s ease 0.15s;
          }

          .commentary-track-img.active {
            height: 120px;
            opacity: 1;
          }

          .commentary-track-img::after {
            content: '';
            position: absolute;
            inset: 0;
            background: linear-gradient(
              to bottom,
              transparent 30%,
              hsla(var(--commentary-h, ${this._sentimentHue}), 50%, 13%, 0.85) 100%
            );
            pointer-events: none;
          }
        </style>

        <div class="commentary-inner" id="commentaryInner">
          <div class="commentary-track-img" id="commentaryTrackImg" style="background-image: url('');"></div>
          <div class="commentary-title" id="commentaryTitle">—</div>
          <div class="commentary-text" id="commentaryText">—</div>
          <canvas class="commentary-viz-canvas" id="commentaryVizCanvas" width="250" height="100"></canvas>
        </div>
      `;

      this.shadowRoot.appendChild(template.content.cloneNode(true));
    }

    _cacheElements() {
      if (!this.shadowRoot) return;
      this._containerEl = this.shadowRoot.querySelector('#commentaryInner');
      this._titleEl = this.shadowRoot.querySelector('#commentaryTitle');
      this._textEl = this.shadowRoot.querySelector('#commentaryText');
      this._trackImgEl = this.shadowRoot.querySelector('#commentaryTrackImg');
      this._vizCanvas = this.shadowRoot.querySelector('#commentaryVizCanvas');
      this._vizCtx = this._vizCanvas?.getContext('2d') || null;
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

    _getVizValue(src) {
      const t = this._telemetryData;
      switch (src) {
        case 'brake': return t.brake || 0;
        case 'throttle': return t.throttle || 0;
        case 'rpm': return t.rpmRatio || 0;
        case 'speed': return t.speed || 0;
        case 'fuel': return t.fuel || 0;
        case 'lapDelta': return t.lapDelta || 0;
        case 'laps': return t.laps || 0;
        default: return 0;
      }
    }

    _renderVizFrame() {
      const cfg = this._vizConfig[this._topicId];
      if (!cfg || !this._vizCanvas || !this._vizCtx) return;

      const ctx = this._vizCtx;
      const w = this._vizCanvas.width;
      const h = this._vizCanvas.height;

      ctx.clearRect(0, 0, w, h);

      // Simple line chart visualization
      if (cfg.type === 'line') {
        const val = this._getVizValue(cfg.src);
        let norm = val;
        if (cfg.src === 'speed') norm = Math.min(1, val / 200);
        else if (cfg.src === 'rpm') norm = val;

        this._vizHistory.push(norm);
        if (this._vizHistory.length > this._VIZ_HIST_LEN) this._vizHistory.shift();

        const count = this._vizHistory.length;
        if (count >= 2) {
          // Draw filled area
          ctx.beginPath();
          ctx.moveTo(0, h);
          for (let i = 0; i < count; i++) {
            const x = (i / (count - 1)) * w;
            const y = h - this._vizHistory[i] * (h - 4) - 2;
            ctx.lineTo(x, y);
          }
          ctx.lineTo(w, h);
          ctx.closePath();

          const fillGrad = ctx.createLinearGradient(0, 0, 0, h);
          fillGrad.addColorStop(0, `hsla(${this._sentimentHue}, 60%, 55%, 0.25)`);
          fillGrad.addColorStop(1, `hsla(${this._sentimentHue}, 60%, 55%, 0.02)`);
          ctx.fillStyle = fillGrad;
          ctx.fill();

          // Draw line
          ctx.beginPath();
          for (let i = 0; i < count; i++) {
            const x = (i / (count - 1)) * w;
            const y = h - this._vizHistory[i] * (h - 4) - 2;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = `hsl(${this._sentimentHue}, 60%, 65%)`;
          ctx.lineWidth = 2;
          ctx.lineJoin = 'round';
          ctx.stroke();

          // Live dot
          const lastY = h - this._vizHistory[count - 1] * (h - 4) - 2;
          ctx.beginPath();
          ctx.arc(w - 1, lastY, 3, 0, Math.PI * 2);
          ctx.fillStyle = `hsl(${this._sentimentHue}, 60%, 70%)`;
          ctx.fill();
        }
      } else if (cfg.type === 'gauge') {
        // Simple gauge visualization
        const rawVal = this._getVizValue(cfg.src);
        const min = cfg.min || 0;
        const max = cfg.max || 100;
        const pct = Math.max(0, Math.min(1, (rawVal - min) / (max - min)));

        const cx = w / 2;
        const cy = h * 0.7;
        const r = Math.min(cx, cy) * 0.7;
        const startAngle = Math.PI * 0.8;
        const endAngle = Math.PI * 2.2;
        const fillAngle = startAngle + (endAngle - startAngle) * pct;

        // Background arc
        ctx.beginPath();
        ctx.arc(cx, cy, r, startAngle, endAngle, false);
        ctx.strokeStyle = `hsla(${this._sentimentHue}, 20%, 25%, 0.3)`;
        ctx.lineWidth = 12;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Filled arc
        if (pct > 0.01) {
          ctx.beginPath();
          ctx.arc(cx, cy, r, startAngle, fillAngle, false);
          ctx.strokeStyle = `hsl(${this._sentimentHue}, 60%, 55%)`;
          ctx.lineWidth = 12;
          ctx.lineCap = 'round';
          ctx.stroke();
        }
      } else if (cfg.type === 'counter') {
        // Simple counter display
        const val = this._getVizValue(cfg.src);
        ctx.fillStyle = `hsl(${this._sentimentHue}, 60%, 65%)`;
        ctx.font = 'bold 32px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(Math.round(val), w / 2, h / 2);
      } else if (cfg.type === 'incident') {
        // Simple incident counter
        const val = this._getVizValue('incidents');
        ctx.fillStyle = 'hsl(0, 80%, 55%)';
        ctx.font = 'bold 48px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(Math.round(val), w / 2, h / 2);
      }
    }

    render() {
      if (!this.shadowRoot) return;

      // Update container visibility and hue
      if (this._containerEl) {
        this._containerEl.classList.toggle('visible', this._visible);
        this._containerEl.style.setProperty('--commentary-h', String(this._sentimentHue));
      }

      // Update title
      if (this._titleEl) {
        this._titleEl.textContent = this._title || '—';
      }

      // Update text
      if (this._textEl) {
        this._textEl.textContent = this._text || '—';
      }

      // Update track image
      if (this._trackImgEl) {
        if (this._trackImage) {
          this._trackImgEl.style.backgroundImage = `url('${this._trackImage}')`;
          this._trackImgEl.classList.add('active');
        } else {
          this._trackImgEl.classList.remove('active');
        }
      }

      // Update viz
      const cfg = this._vizConfig[this._topicId];
      if (cfg && this._visible) {
        this._vizActive = true;
        this._renderVizFrame();
      } else {
        this._vizActive = false;
        this._vizHistory = [];
      }
    }
  }

  customElements.define('racecor-commentary-viz', RaceCorCommentaryViz);
})();
