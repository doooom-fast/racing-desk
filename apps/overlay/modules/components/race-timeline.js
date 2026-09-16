/**
 * @element racecor-race-timeline
 * @description Canvas-based heat-mapped position history strip.
 *
 * Shows position changes over race duration as a color strip:
 * - Blue = neutral (same position)
 * - Green = gained positions (negative delta)
 * - Red = lost positions (positive delta)
 * - Gold = leading (P1)
 * - Checkered = finished
 * - Event markers: blue (pit), orange (offtrack), red (damage)
 *
 * Accepts samples via `addSample(position, lap, flagState, incidentCount, isInPit)`
 * or via `updateData(snapshot)` and `telemetry-update` events.
 *
 * @attribute none (uses methods instead)
 *
 * @method addSample(position, lap, flagState, incidentCount, isInPit) - Add a position sample
 * @method updateData(snapshot) - Update from telemetry snapshot
 * @method reset() - Clear history
 *
 * @fires none (no custom events)
 *
 * @slot default (not used, Shadow DOM only)
 *
 * @example
 * <racecor-race-timeline></racecor-race-timeline>
 *
 * <script>
 *   const timeline = document.querySelector('racecor-race-timeline');
 *   timeline.addSample(position, lap, flagState, incidents, inPit);
 * </script>
 */

(function() {
  'use strict';

  const RT_MAX_SAMPLES = 310;

  class RaceCorRaceTimeline extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });

      // ── Internal state ──────────────────────────────────────────
      this._history = [];
      this._startPos = 0;
      this._lastLap = 0;
      this._lastPos = 0;
      this._lastIncident = 0;
      this._wasInPit = false;
      this._finished = false;

      // ── Cached element references ────────────────────────────────
      this._canvas = null;
      this._ctx = null;

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
    }

    disconnectedCallback() {
      if (this._telemetryHandler && window) {
        window.removeEventListener('telemetry-update', this._telemetryHandler);
        this._telemetryHandler = null;
      }
      if (this._ctx && this._canvas) {
        this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
      }
      this._ctx = null;
      this._canvas = null;
    }

    // ╔═══════════════════════════════════════════════════════════╗
    // ║ PUBLIC API                                                 ║
    // ╚═══════════════════════════════════════════════════════════╝

    addSample(position, currentLap = 0, flagState = '', incidentCount = 0, isInPit = false) {
      if (!position || position <= 0) return;
      if (this._startPos <= 0 && position > 0) this._startPos = position;

      const delta = position - this._startPos;

      // Detect events
      let event = null;
      if (isInPit && !this._wasInPit) {
        event = 'pit';
      } else if (incidentCount > this._lastIncident && this._lastIncident > 0) {
        const inc = incidentCount - this._lastIncident;
        event = inc >= 4 ? 'damage' : 'offtrack';
      }
      this._wasInPit = !!isInPit;
      if (incidentCount > 0) this._lastIncident = incidentCount;

      const sample = {
        delta: delta,
        p1: position === 1,
        checkered: flagState === 'checkered',
        event: event,
        newLap: currentLap > 0 && currentLap !== this._lastLap,
      };
      if (sample.checkered) this._finished = true;

      const lapChanged = currentLap > 0 && currentLap !== this._lastLap;
      const posChanged = position !== this._lastPos && this._lastPos > 0;
      const hasEvent = event !== null;

      if (lapChanged || posChanged || hasEvent) {
        this._history.push(sample);
        this._lastLap = currentLap;
      } else if (this._history.length === 0) {
        this._history.push(sample);
      }

      this._lastPos = position;
      if (this._history.length > RT_MAX_SAMPLES) this._history.shift();

      this._render();
    }

    updateData(snapshot) {
      if (!snapshot) return;

      const _demo = snapshot._demo || +(snapshot['RaceCorProDrive.Plugin.DemoMode'] || 0);
      const dsPre = _demo ? 'RaceCorProDrive.Plugin.Demo.DS.' : 'RaceCorProDrive.Plugin.DS.';

      const position = _demo ? +(snapshot['RaceCorProDrive.Plugin.Demo.Position'] || 0) : +(snapshot['DataCorePlugin.GameData.Position'] || 0);
      const currentLap = +(snapshot[dsPre + 'CompletedLaps'] || 0);
      const flagState = String(snapshot[dsPre + 'FlagState'] || '');
      const incidentCount = +(snapshot[dsPre + 'IncidentCount'] || 0);
      const isInPit = +(snapshot[dsPre + 'IsInPitLane'] || 0) > 0;

      this.addSample(position, currentLap, flagState, incidentCount, isInPit);
    }

    reset() {
      this._history.length = 0;
      this._startPos = 0;
      this._lastLap = 0;
      this._lastPos = 0;
      this._lastIncident = 0;
      this._wasInPit = false;
      this._finished = false;

      if (this._ctx && this._canvas) {
        this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
      }
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
            width: 100%;
            height: 20px;
          }

          canvas {
            display: block;
            width: 100%;
            height: 100%;
          }
        </style>

        <canvas id="rtCanvas"></canvas>
      `;

      this.shadowRoot.appendChild(template.content.cloneNode(true));
    }

    _cacheElements() {
      if (!this.shadowRoot) return;

      this._canvas = this.shadowRoot.getElementById('rtCanvas');
      if (this._canvas) {
        this._canvas.width = this._canvas.clientWidth * (window.devicePixelRatio || 1);
        this._canvas.height = this._canvas.clientHeight * (window.devicePixelRatio || 1);
        this._ctx = this._canvas.getContext('2d');
        if (this._ctx && window.devicePixelRatio) {
          this._ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        }
      }
    }

    _colorForSample(sample) {
      if (sample.checkered) return null;
      if (sample.p1) {
        const heat = Math.min(Math.abs(sample.delta), 5);
        const lit = 58 + heat * 4;
        return 'hsla(42, 72%, ' + lit + '%, 0.8)';
      }

      const d = sample.delta;
      if (d === 0) return 'hsla(210, 42%, 54%, 0.8)';
      if (d < 0) {
        const heat = Math.min(Math.abs(d), 5);
        const sat = 38 + heat * 8;
        const lit = 46 + heat * 5;
        return 'hsla(145, ' + sat + '%, ' + lit + '%, 0.8)';
      }
      const heat = Math.min(d, 5);
      const sat = 38 + heat * 8;
      const lit = 48 + heat * 5;
      return 'hsla(0, ' + sat + '%, ' + lit + '%, 0.8)';
    }

    _render() {
      if (!this._canvas || !this._ctx) return;

      const w = this._canvas.width;
      const h = this._canvas.height;
      this._ctx.clearRect(0, 0, w, h);

      const len = this._history.length;
      if (len === 0) return;

      const sliceW = Math.max(1, w / len);

      // First pass: draw position colors
      for (let i = 0; i < len; i++) {
        const sample = this._history[i];
        const x = Math.floor(i * sliceW);
        const nextX = Math.floor((i + 1) * sliceW);
        const sw = nextX - x;

        if (sample.checkered) {
          const sqSize = 2;
          for (let cy = 0; cy < h; cy += sqSize) {
            for (let cx = x; cx < x + sw; cx += sqSize) {
              const row = Math.floor(cy / sqSize);
              const col = Math.floor((cx - x) / sqSize);
              this._ctx.fillStyle = (row + col) % 2 === 0 ? 'hsla(0,0%,100%,0.35)' : 'hsla(0,0%,0%,0.4)';
              this._ctx.fillRect(cx, cy, Math.min(sqSize, x + sw - cx), Math.min(sqSize, h - cy));
            }
          }
        } else {
          this._ctx.fillStyle = this._colorForSample(sample);
          this._ctx.fillRect(x, 0, sw, h);
        }
      }

      // Second pass: draw event markers
      const RT_EVENT_COLORS = {
        pit: 'hsla(210, 80%, 65%, 0.9)',
        offtrack: 'hsla(35, 90%, 55%, 0.9)',
        damage: 'hsla(0, 85%, 55%, 0.9)',
      };

      for (let i = 0; i < len; i++) {
        const sample = this._history[i];
        if (!sample.event) continue;
        const x = Math.floor(i * sliceW + sliceW / 2);
        const color = RT_EVENT_COLORS[sample.event] || 'hsla(0,0%,100%,0.5)';

        this._ctx.fillStyle = color;
        this._ctx.beginPath();
        this._ctx.moveTo(x - 3, 0);
        this._ctx.lineTo(x + 3, 0);
        this._ctx.lineTo(x, 5);
        this._ctx.closePath();
        this._ctx.fill();

        this._ctx.strokeStyle = color.replace(/[\d.]+\)$/, '0.6)');
        this._ctx.lineWidth = 1;
        this._ctx.beginPath();
        this._ctx.moveTo(x, 5);
        this._ctx.lineTo(x, h);
        this._ctx.stroke();
      }

      // Third pass: draw lap boundary lines
      for (let i = 0; i < len; i++) {
        const sample = this._history[i];
        if (!sample.newLap) continue;
        const x = Math.floor(i * sliceW);
        this._ctx.strokeStyle = 'hsla(0,0%,100%,0.4)';
        this._ctx.lineWidth = 1;
        this._ctx.beginPath();
        this._ctx.moveTo(x, 0);
        this._ctx.lineTo(x, h);
        this._ctx.stroke();
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
    customElements.define('racecor-race-timeline', RaceCorRaceTimeline);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = RaceCorRaceTimeline;
  }

})();
