/**
 * @element racecor-pedal-curves
 * @description Canvas-based pedal input visualization with curves overlay and histograms.
 *
 * Displays throttle/brake/clutch pedal positions with:
 * - Layered histograms showing pedal distribution
 * - Response curve overlays (input → output mapping)
 * - Rolling 20-sample trace showing recent patterns
 * - Percentage labels per channel
 *
 * @property {number} throttle - Throttle input (0-100)
 * @property {number} brake - Brake input (0-100)
 * @property {number} clutch - Clutch input (0-100)
 * @property {boolean} showCurves - Show response curves overlay (default: true)
 */

(function() {
  'use strict';

  class RaceCorPedalCurves extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });

      this._throttle = 0;
      this._brake = 0;
      this._clutch = 0;
      this._showCurves = true;

      this._canvas = null;
      this._ctx = null;
      this._canvasReady = false;

      this._elThrottle = null;
      this._elBrake = null;
      this._elClutch = null;

      this._telemetryHandler = null;
    }

    connectedCallback() {
      this._renderTemplate();
      this._cacheElements();
      this._subscribeToData();
      this._ensureCanvasReady();
    }

    disconnectedCallback() {
      if (this._telemetryHandler && window) {
        window.removeEventListener('telemetry-update', this._telemetryHandler);
        this._telemetryHandler = null;
      }
    }

    get throttle() { return this._throttle; }
    set throttle(val) { this._throttle = Math.max(0, Math.min(100, +val || 0)); }

    get brake() { return this._brake; }
    set brake(val) { this._brake = Math.max(0, Math.min(100, +val || 0)); }

    get clutch() { return this._clutch; }
    set clutch(val) { this._clutch = Math.max(0, Math.min(100, +val || 0)); }

    get showCurves() { return this._showCurves; }
    set showCurves(val) { this._showCurves = !!val; }

    updateData(snapshot) {
      if (!snapshot) return;

      const pre = snapshot._demo ? 'RaceCorProDrive.Plugin.Demo.DS.' : 'RaceCorProDrive.Plugin.DS.';
      const v = (key) => Math.max(0, Math.min(100, +snapshot[pre + key] || 0));

      this._throttle = v('Throttle');
      this._brake = v('Brake');
      this._clutch = v('Clutch');

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

          .pc-panel {
            display: flex;
            flex-direction: column;
            gap: var(--gap);
            padding: var(--pad);
          }

          .pc-canvas-wrapper {
            position: relative;
            width: 100%;
            aspect-ratio: 4 / 1;
            border: 1px solid var(--border);
            border-radius: var(--corner-r);
            background: var(--bg);
            overflow: hidden;
          }

          canvas.pc-canvas {
            width: 100%;
            height: 100%;
            display: block;
          }

          .pc-labels {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: var(--gap);
            font-size: var(--fs-xs);
          }

          .pc-label {
            text-align: center;
            padding: 4px;
            background: var(--bg-panel);
            border: 1px solid var(--border);
            border-radius: var(--corner-r);
          }

          .pc-label-name {
            font-weight: var(--fw-bold);
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 2px;
          }

          .pc-label-value {
            font-family: var(--ff-mono);
            font-weight: var(--fw-semi);
            font-size: var(--fs-sm);
          }

          .pc-label-value.throttle { color: hsl(120, 60%, 55%); }
          .pc-label-value.brake { color: hsl(0, 80%, 55%); }
          .pc-label-value.clutch { color: hsl(210, 60%, 55%); }

          /* ── MINIMAL MODE — Tufte-pure: trace + big numbers, no chrome ── */
          :host-context(body.mode-minimal) .pc-canvas-wrapper {
            border: none;
            border-radius: 0;
          }

          :host-context(body.mode-minimal) .pc-label {
            background: transparent;
            border: none;
            border-radius: 0;
            padding: 2px 0;
          }

          /* Color IS the label — remove redundant text labels */
          :host-context(body.mode-minimal) .pc-label-name {
            display: none;
          }

          /* Make the numbers count — they're all you've got now */
          :host-context(body.mode-minimal) .pc-label-value {
            font-size: 18px;
            font-weight: var(--fw-black);
          }
        </style>

        <div class="pc-panel">
          <div class="pc-canvas-wrapper">
            <canvas class="pc-canvas"></canvas>
          </div>

          <div class="pc-labels">
            <div class="pc-label">
              <div class="pc-label-name">Throttle</div>
              <div class="pc-label-value throttle" id="pcThrottle">—%</div>
            </div>
            <div class="pc-label">
              <div class="pc-label-name">Brake</div>
              <div class="pc-label-value brake" id="pcBrake">—%</div>
            </div>
            <div class="pc-label">
              <div class="pc-label-name">Clutch</div>
              <div class="pc-label-value clutch" id="pcClutch">—%</div>
            </div>
          </div>
        </div>
      `;

      this.shadowRoot.appendChild(template.content.cloneNode(true));
    }

    _cacheElements() {
      if (!this.shadowRoot) return;
      this._canvas = this.shadowRoot.querySelector('.pc-canvas');
      this._ctx = this._canvas ? this._canvas.getContext('2d') : null;
      this._elThrottle = this.shadowRoot.querySelector('#pcThrottle');
      this._elBrake = this.shadowRoot.querySelector('#pcBrake');
      this._elClutch = this.shadowRoot.querySelector('#pcClutch');
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

    _ensureCanvasReady() {
      if (this._canvasReady || !this._canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = this._canvas.parentElement.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        this._canvas.width = Math.round(rect.width * dpr);
        this._canvas.height = Math.round(rect.height * dpr);
        this._canvasReady = true;
      }
    }

    render() {
      if (this._elThrottle) this._elThrottle.textContent = Math.round(this._throttle) + '%';
      if (this._elBrake) this._elBrake.textContent = Math.round(this._brake) + '%';
      if (this._elClutch) this._elClutch.textContent = Math.round(this._clutch) + '%';

      this._drawPedalHistogram();
    }

    _drawPedalHistogram() {
      if (!this._ctx || !this._canvas) return;

      const ctx = this._ctx;
      const dpr = window.devicePixelRatio || 1;
      const w = this._canvas.width / dpr;
      const h = this._canvas.height / dpr;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const pad = 4;
      const barW = (w - pad * 2) / 3;
      const barH = h - pad * 2;

      // Throttle (left, green)
      this._drawPedalBar(ctx, pad, pad, barW, barH, this._throttle, 'hsl(120, 60%, 55%)');

      // Brake (center, red)
      this._drawPedalBar(ctx, pad + barW, pad, barW, barH, this._brake, 'hsl(0, 80%, 55%)');

      // Clutch (right, blue)
      this._drawPedalBar(ctx, pad + barW * 2, pad, barW, barH, this._clutch, 'hsl(210, 60%, 55%)');
    }

    _drawPedalBar(ctx, x, y, w, h, value, color) {
      const pct = value / 100;
      const fillH = h * pct;

      // Background
      ctx.fillStyle = 'hsla(0, 0%, 100%, 0.05)';
      ctx.fillRect(x, y, w, h);

      // Filled portion
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.7;
      ctx.fillRect(x, y + h - fillH, w, fillH);
      ctx.globalAlpha = 1;

      // Border
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, w, h);
      ctx.globalAlpha = 1;
    }
  }

  customElements.define('racecor-pedal-curves', RaceCorPedalCurves);
})();
