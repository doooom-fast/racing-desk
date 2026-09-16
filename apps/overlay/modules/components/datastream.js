/**
 * @element racecor-datastream
 * @description G-force circle, yaw rate waveform, telemetry readouts (steering torque, track temp).
 *
 * Canvas-based visualization combining:
 * - G-force diamond with trail (80-sample ring buffer for history)
 * - Yaw rate waveform with gradient fill
 * - Peak G tracker (resets per session)
 * - Steering torque and track temperature readouts
 *
 * @property {number} lateralG - Lateral G-force (-3 to +3)
 * @property {number} longitudinalG - Longitudinal G-force (-3 to +3)
 * @property {number} yawRate - Yaw rate in radians/second
 * @property {number} steeringTorque - Steering torque in Nm
 * @property {number} trackTemp - Track temperature in Celsius
 */

(function() {
  'use strict';

  class RaceCorDatastream extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });

      // ── Internal state ──────────────────────────────────────────
      this._lateralG = 0;
      this._longitudinalG = 0;
      this._yawRate = 0;
      this._steeringTorque = 0;
      this._trackTemp = 0;
      this._peakG = 0;

      // ── Canvas state ────────────────────────────────────────────
      const TRAIL_LEN = 40;
      const YAW_TRAIL_LEN = 80;
      this._trailLat = new Float32Array(TRAIL_LEN);
      this._trailLong = new Float32Array(TRAIL_LEN);
      this._trailIdx = 0;
      this._trailCount = 0;

      this._yawTrail = new Float32Array(YAW_TRAIL_LEN);
      this._yawTrailIdx = 0;
      this._yawTrailCount = 0;

      // ── Cached canvas refs ──────────────────────────────────────
      this._gforceCanvas = null;
      this._gforceCtx = null;
      this._yawCanvas = null;
      this._yawCtx = null;
      this._canvasReady = false;

      // ── Cached element refs ──────────────────────────────────────
      this._elLatG = null;
      this._elLongG = null;
      this._elPeakG = null;
      this._elYawRate = null;
      this._elSteerTorque = null;
      this._elTrackTemp = null;

      // ── Event handlers ──────────────────────────────────────────
      this._telemetryHandler = null;
      this._rafId = null;
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
      if (this._rafId) {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
      }
    }

    // ╔═══════════════════════════════════════════════════════════╗
    // ║ PROPERTIES                                                 ║
    // ╚═══════════════════════════════════════════════════════════╝

    get lateralG() { return this._lateralG; }
    set lateralG(val) { this._lateralG = +val || 0; }

    get longitudinalG() { return this._longitudinalG; }
    set longitudinalG(val) { this._longitudinalG = +val || 0; }

    get yawRate() { return this._yawRate; }
    set yawRate(val) { this._yawRate = +val || 0; }

    get steeringTorque() { return this._steeringTorque; }
    set steeringTorque(val) { this._steeringTorque = +val || 0; }

    get trackTemp() { return this._trackTemp; }
    set trackTemp(val) { this._trackTemp = +val || 0; }

    // ╔═══════════════════════════════════════════════════════════╗
    // ║ PUBLIC API                                                 ║
    // ╚═══════════════════════════════════════════════════════════╝

    updateData(snapshot) {
      if (!snapshot) return;

      const pre = snapshot._demo ? 'RaceCorProDrive.Plugin.Demo.DS.' : 'RaceCorProDrive.Plugin.DS.';
      const v = (key) => +snapshot[pre + key] || 0;

      this._lateralG = v('LatG');
      this._longitudinalG = v('LongG');
      this._yawRate = v('YawRate');
      this._steeringTorque = v('SteerTorque');
      this._trackTemp = v('TrackTemp');

      const totalG = Math.sqrt(this._lateralG * this._lateralG + this._longitudinalG * this._longitudinalG);
      if (totalG > this._peakG) this._peakG = totalG;

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

          .ds-panel {
            display: grid;
            grid-template-columns: 80px 1fr;
            gap: var(--gap);
            padding: var(--pad);
          }

          .ds-gforce-col {
            display: flex;
            flex-direction: column;
            gap: var(--gap);
          }

          .ds-canvas {
            width: 100%;
            height: auto;
            aspect-ratio: 1;
            border: 1px solid var(--border);
            border-radius: var(--corner-r);
            background: var(--bg);
          }

          .ds-readouts {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: var(--gap);
            font-size: var(--fs-xs);
          }

          .ds-readout {
            display: flex;
            flex-direction: column;
            background: var(--bg-panel);
            border: 1px solid var(--border);
            border-radius: var(--corner-r);
            padding: 6px;
            text-align: center;
          }

          .ds-readout-label {
            color: var(--text-secondary);
            font-weight: var(--fw-bold);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 2px;
          }

          .ds-readout-value {
            color: var(--text-primary);
            font-family: var(--ff-mono);
            font-size: var(--fs-sm);
            font-weight: var(--fw-semi);
          }

          .ds-waveform {
            grid-column: 1 / -1;
            border: 1px solid var(--border);
            border-radius: var(--corner-r);
            background: var(--bg);
            width: 100%;
            height: 40px;
          }

          .ds-yaw-bar {
            grid-column: 1 / -1;
            background: var(--bg-panel);
            border: 1px solid var(--border);
            border-radius: var(--corner-r);
            height: 16px;
            position: relative;
            overflow: hidden;
          }

          .ds-yaw-fill {
            position: absolute;
            height: 100%;
            background: hsla(210, 70%, 55%, 0.7);
            transition: width 0.1s ease;
          }
        </style>

        <div class="ds-panel">
          <div class="ds-gforce-col">
            <canvas class="ds-canvas ds-gforce"></canvas>
            <div class="ds-readout">
              <div class="ds-readout-label">Peak</div>
              <div class="ds-readout-value" id="dsPeakG">—</div>
            </div>
          </div>

          <div class="ds-readouts">
            <div class="ds-readout">
              <div class="ds-readout-label">Lat G</div>
              <div class="ds-readout-value" id="dsLatG">—</div>
            </div>
            <div class="ds-readout">
              <div class="ds-readout-label">Long G</div>
              <div class="ds-readout-value" id="dsLongG">—</div>
            </div>

            <div class="ds-readout">
              <div class="ds-readout-label">Yaw Rate</div>
              <div class="ds-readout-value" id="dsYawRate">—</div>
            </div>
            <div class="ds-readout">
              <div class="ds-readout-label">Steer Nm</div>
              <div class="ds-readout-value" id="dsSteerTorque">—</div>
            </div>

            <div class="ds-readout">
              <div class="ds-readout-label">Track Temp</div>
              <div class="ds-readout-value" id="dsTrackTemp">—</div>
            </div>
            <div class="ds-readout">
              <div class="ds-readout-label">Yaw</div>
              <div class="ds-yaw-bar">
                <div class="ds-yaw-fill" id="dsYawFill"></div>
              </div>
            </div>

            <canvas class="ds-waveform ds-yaw-trail"></canvas>
          </div>
        </div>
      `;

      this.shadowRoot.appendChild(template.content.cloneNode(true));
    }

    _cacheElements() {
      if (!this.shadowRoot) return;

      this._gforceCanvas = this.shadowRoot.querySelector('.ds-gforce');
      this._gforceCtx = this._gforceCanvas ? this._gforceCanvas.getContext('2d') : null;

      this._yawCanvas = this.shadowRoot.querySelector('.ds-yaw-trail');
      this._yawCtx = this._yawCanvas ? this._yawCanvas.getContext('2d') : null;

      this._elLatG = this.shadowRoot.querySelector('#dsLatG');
      this._elLongG = this.shadowRoot.querySelector('#dsLongG');
      this._elPeakG = this.shadowRoot.querySelector('#dsPeakG');
      this._elYawRate = this.shadowRoot.querySelector('#dsYawRate');
      this._elSteerTorque = this.shadowRoot.querySelector('#dsSteerTorque');
      this._elTrackTemp = this.shadowRoot.querySelector('#dsTrackTemp');
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
      if (this._canvasReady || !this._gforceCanvas) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = this._gforceCanvas.parentElement.getBoundingClientRect();
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);
      if (w > 0 && h > 0) {
        this._gforceCanvas.width = w;
        this._gforceCanvas.height = h;
        this._canvasReady = true;
      }

      if (this._yawCanvas) {
        const yaw_rect = this._yawCanvas.parentElement.getBoundingClientRect();
        const yw = Math.round(yaw_rect.width * dpr);
        const yh = Math.round(yaw_rect.height * dpr);
        if (yw > 0 && yh > 0) {
          this._yawCanvas.width = yw;
          this._yawCanvas.height = yh;
        }
      }
    }

    render() {
      // Update text readouts
      if (this._elLatG) this._elLatG.textContent = Math.abs(this._lateralG).toFixed(2) + 'g';
      if (this._elLongG) this._elLongG.textContent = Math.abs(this._longitudinalG).toFixed(2) + 'g';
      if (this._elPeakG) this._elPeakG.textContent = this._peakG.toFixed(2) + 'g';
      if (this._elYawRate) this._elYawRate.textContent = Math.abs(this._yawRate).toFixed(2) + ' r/s';
      if (this._elSteerTorque) this._elSteerTorque.textContent = this._steeringTorque.toFixed(1) + ' Nm';
      if (this._elTrackTemp) this._elTrackTemp.textContent = this._trackTemp > 0 ? this._trackTemp.toFixed(1) + '°C' : '—°C';

      // Yaw bar
      const yawFill = this.shadowRoot.querySelector('#dsYawFill');
      if (yawFill) {
        const maxYaw = 1.5;
        const pct = Math.min(Math.abs(this._yawRate) / maxYaw, 1.0) * 50;
        const yawHue = Math.max(0, 210 - Math.abs(this._yawRate) * 120);
        if (this._yawRate >= 0) {
          yawFill.style.cssText = `left:50%;width:${pct}%;background:hsla(${yawHue},70%,55%,0.7)`;
        } else {
          yawFill.style.cssText = `left:${50 - pct}%;width:${pct}%;background:hsla(${yawHue},70%,55%,0.7)`;
        }
      }

      // Canvas renders
      this._drawGforceDiamond();
      this._drawYawWaveform();
    }

    _drawGforceDiamond() {
      if (!this._gforceCtx || !this._gforceCanvas) return;

      const ctx = this._gforceCtx;
      const dpr = window.devicePixelRatio || 1;
      const w = this._gforceCanvas.width / dpr;
      const h = this._gforceCanvas.height / dpr;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const cx = w / 2, cy = h / 2;
      const maxG = 3.0;
      const r = Math.min(cx, cy) * 0.7;

      // Diamond outline
      ctx.strokeStyle = 'hsla(0,0%,100%,0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r, cy);
      ctx.closePath();
      ctx.stroke();

      // Crosshair
      ctx.strokeStyle = 'hsla(0,0%,100%,0.04)';
      ctx.beginPath();
      ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
      ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
      ctx.stroke();

      // Half-diamond
      ctx.strokeStyle = 'hsla(0,0%,100%,0.03)';
      ctx.beginPath();
      ctx.moveTo(cx, cy - r/2);
      ctx.lineTo(cx + r/2, cy);
      ctx.lineTo(cx, cy + r/2);
      ctx.lineTo(cx - r/2, cy);
      ctx.closePath();
      ctx.stroke();

      // Trail
      if (this._trailCount > 1) {
        ctx.beginPath();
        ctx.strokeStyle = 'hsla(210,60%,55%,0.15)';
        ctx.lineWidth = 1;
        for (let i = 0; i < Math.min(this._trailCount, 40); i++) {
          const idx = (this._trailIdx - 1 - i + 40) % 40;
          const px = cx + (this._trailLat[idx] / maxG) * r;
          const py = cy - (this._trailLong[idx] / maxG) * r;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }

      // Store trail
      this._trailLat[this._trailIdx] = this._lateralG;
      this._trailLong[this._trailIdx] = this._longitudinalG;
      this._trailIdx = (this._trailIdx + 1) % 40;
      this._trailCount++;

      // Dot
      let dotX = cx + (this._lateralG / maxG) * r;
      let dotY = cy - (this._longitudinalG / maxG) * r;
      const totalG = Math.sqrt(this._lateralG * this._lateralG + this._longitudinalG * this._longitudinalG);

      const hue = Math.max(0, 210 - totalG * 50);
      const lum = 55 + totalG * 5;

      ctx.fillStyle = `hsl(${hue},70%,${lum}%)`;
      ctx.beginPath();
      ctx.arc(dotX, dotY, 2.5, 0, Math.PI * 2);
      ctx.fill();

      // Glow
      ctx.fillStyle = `hsla(${hue},70%,${lum}%,0.25)`;
      ctx.beginPath();
      ctx.arc(dotX, dotY, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    _drawYawWaveform() {
      if (!this._yawCtx || !this._yawCanvas) return;

      // Store sample
      this._yawTrail[this._yawTrailIdx] = this._yawRate;
      this._yawTrailIdx = (this._yawTrailIdx + 1) % 80;
      this._yawTrailCount++;

      const ctx = this._yawCtx;
      const dpr = window.devicePixelRatio || 1;
      const w = this._yawCanvas.width / dpr;
      const h = this._yawCanvas.height / dpr;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const count = Math.min(this._yawTrailCount, 80);
      if (count < 2) return;

      const maxYaw = 1.5;
      const mid = h / 2;
      const absYaw = Math.abs(this._yawRate);
      const hue = Math.max(0, 210 - absYaw * 120) | 0;

      // Fill gradient
      const fillGrad = ctx.createLinearGradient(0, 0, w, 0);
      fillGrad.addColorStop(0,   `hsla(${hue}, 60%, 50%, 0.02)`);
      fillGrad.addColorStop(0.7, `hsla(${hue}, 65%, 50%, 0.15)`);
      fillGrad.addColorStop(1,   `hsla(${hue}, 70%, 55%, 0.35)`);

      // Waveform fill
      ctx.beginPath();
      ctx.moveTo(0, mid);
      for (let i = 0; i < count; i++) {
        const idx = (this._yawTrailIdx - count + i + 80) % 80;
        const x = (i / (count - 1)) * w;
        const val = this._yawTrail[idx];
        const y = mid - (val / maxYaw) * (mid - 2);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, mid);
      ctx.closePath();
      ctx.fillStyle = fillGrad;
      ctx.fill();

      // Waveform stroke
      const strokeGrad = ctx.createLinearGradient(0, 0, w, 0);
      strokeGrad.addColorStop(0,   `hsla(${hue}, 60%, 55%, 0.05)`);
      strokeGrad.addColorStop(0.8, `hsla(${hue}, 70%, 55%, 0.3)`);
      strokeGrad.addColorStop(1,   `hsla(${hue}, 75%, 60%, 0.6)`);

      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const idx = (this._yawTrailIdx - count + i + 80) % 80;
        const x = (i / (count - 1)) * w;
        const val = this._yawTrail[idx];
        const y = mid - (val / maxYaw) * (mid - 2);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = strokeGrad;
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Center line
      ctx.beginPath();
      ctx.moveTo(0, mid);
      ctx.lineTo(w, mid);
      ctx.strokeStyle = 'hsla(0, 0%, 100%, 0.06)';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }
  }

  customElements.define('racecor-datastream', RaceCorDatastream);
})();
