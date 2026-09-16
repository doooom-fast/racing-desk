/**
 * @element racecor-sector-hud
 * @description Sector timing display with color-coded splits.
 *
 * Shows S1, S2, S3+ sector times:
 * - Green: personal best
 * - Purple: session best
 * - Yellow: off-pace
 * - White: no data
 * - Delta per sector vs personal best
 *
 * @property {Array} sectors - Array of { time, delta, status, isPB, isSessionBest }
 */

(function() {
  'use strict';

  class RaceCorSectorHud extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });

      this._sectors = [];

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

    get sectors() { return this._sectors; }
    set sectors(val) { this._sectors = val || []; }

    updateData(snapshot) {
      if (!snapshot) return;

      const pre = 'RaceCorProDrive.Plugin.DS.';
      const s1 = +snapshot[pre + 'Sector1'] || 0;
      const s2 = +snapshot[pre + 'Sector2'] || 0;
      const s3 = +snapshot[pre + 'Sector3'] || 0;

      const s1_pb = +snapshot[pre + 'Sector1PB'] || 0;
      const s2_pb = +snapshot[pre + 'Sector2PB'] || 0;
      const s3_pb = +snapshot[pre + 'Sector3PB'] || 0;

      this._sectors = [
        { time: s1, pb: s1_pb, label: 'S1', delta: s1_pb > 0 ? s1 - s1_pb : 0 },
        { time: s2, pb: s2_pb, label: 'S2', delta: s2_pb > 0 ? s2 - s2_pb : 0 },
        { time: s3, pb: s3_pb, label: 'S3', delta: s3_pb > 0 ? s3 - s3_pb : 0 }
      ];

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

          .sh-panel {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
            gap: var(--gap);
            padding: var(--pad);
          }

          .sh-sector {
            display: flex;
            flex-direction: column;
            gap: 4px;
            padding: var(--pad);
            background: var(--bg-panel);
            border: 1px solid var(--border);
            border-radius: var(--corner-r);
            text-align: center;
          }

          .sh-label {
            font-size: var(--fs-xs);
            font-weight: var(--fw-bold);
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }

          .sh-time {
            font-family: var(--ff-mono);
            font-size: var(--fs-sm);
            font-weight: var(--fw-semi);
            color: var(--text-primary);
          }

          .sh-time.pb {
            color: hsl(145, 70%, 55%);
          }

          .sh-time.session {
            color: hsl(270, 70%, 60%);
          }

          .sh-time.slow {
            color: hsl(45, 90%, 55%);
          }

          .sh-delta {
            font-size: 11px;
            color: var(--text-dim);
            font-family: var(--ff-mono);
          }

          .sh-delta.gain {
            color: hsl(145, 70%, 55%);
          }

          .sh-delta.loss {
            color: hsl(0, 80%, 55%);
          }
        </style>

        <div class="sh-panel"></div>
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
      const panel = this.shadowRoot.querySelector('.sh-panel');
      if (!panel) return;

      let html = '';
      for (const sector of this._sectors) {
        const timeStr = sector.time > 0
          ? this._formatTime(sector.time)
          : '—';

        let timeClass = '';
        if (sector.time > 0) {
          if (sector.pb > 0 && Math.abs(sector.time - sector.pb) < 0.05) {
            timeClass = 'pb';
          } else if (sector.time > sector.pb + 0.5) {
            timeClass = 'slow';
          }
        }

        const deltaStr = sector.delta !== 0 && sector.time > 0
          ? (sector.delta > 0 ? '+' : '') + sector.delta.toFixed(2)
          : '';

        const deltaClass = deltaStr
          ? (sector.delta < 0 ? 'gain' : 'loss')
          : '';

        html += '<div class="sh-sector">'
          + '<div class="sh-label">' + sector.label + '</div>'
          + '<div class="sh-time ' + timeClass + '">' + timeStr + '</div>'
          + (deltaStr ? '<div class="sh-delta ' + deltaClass + '">' + deltaStr + '</div>' : '')
          + '</div>';
      }

      panel.innerHTML = html;
    }

    _formatTime(seconds) {
      if (seconds <= 0) return '—';
      const m = Math.floor(seconds / 60);
      const s = seconds - m * 60;
      return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
    }
  }

  customElements.define('racecor-sector-hud', RaceCorSectorHud);
})();
