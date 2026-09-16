/**
 * @element racecor-drive-hud
 * @description Full-screen driving-focused display with track map, position, lap times, and incidents.
 *
 * Three-column layout:
 * - Left: SVG track map with heading-up rotation, player dot (purple), opponent dots
 * - Center: Position, lap delta, sector times, last/best lap times, live lap delta
 * - Right: Incident counter with penalty/DQ thresholds
 *
 * Properties drive map updates, sector timing, position changes, incident counts.
 * SVG path manipulation for track rendering and sector colors.
 *
 * @property {number} position - Current grid/race position
 * @property {number} lapDelta - Current lap time delta to best
 * @property {Array<number>} sectors - Sector split times [s1, s2, s3, ...]
 * @property {number} lastLap - Last completed lap time (seconds)
 * @property {number} bestLap - Best lap time (seconds)
 * @property {number} incidents - Current incident count
 * @property {string} trackMapSvg - SVG track path data
 * @property {Array<{x, y}>} playerPos - Player position on track (0-100, 0-100)
 * @property {Array<{x, y, inPit}>} opponents - Opponent positions
 * @property {number} heading - Player heading in degrees (0-360)
 */

(function() {
  'use strict';

  class RaceCorDriveHud extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });

      this._position = 0;
      this._lapDelta = 0;
      this._sectors = [];
      this._lastLap = 0;
      this._bestLap = 0;
      this._incidents = 0;
      this._trackMapSvg = '';
      this._playerPos = { x: 50, y: 50 };
      this._opponents = [];
      this._heading = 0;
      this._headingSmooth = 0;
      this._lastMapTime = 0;

      this._positionEl = null;
      this._lapDeltaEl = null;
      this._lastLapEl = null;
      this._incidentsEl = null;
      this._sectorsEl = null;
      this._mapSvg = null;
      this._mapPlayer = null;
      this._mapOpponents = null;
      this._mapRotateGroup = null;

      this._telemetryHandler = null;
    }

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
    }

    get position() { return this._position; }
    set position(val) { this._position = +val || 0; }

    get lapDelta() { return this._lapDelta; }
    set lapDelta(val) { this._lapDelta = +val || 0; }

    get sectors() { return this._sectors; }
    set sectors(val) { this._sectors = Array.isArray(val) ? val : []; }

    get lastLap() { return this._lastLap; }
    set lastLap(val) { this._lastLap = +val || 0; }

    get bestLap() { return this._bestLap; }
    set bestLap(val) { this._bestLap = +val || 0; }

    get incidents() { return this._incidents; }
    set incidents(val) { this._incidents = +val || 0; }

    get trackMapSvg() { return this._trackMapSvg; }
    set trackMapSvg(val) { this._trackMapSvg = String(val || ''); }

    get playerPos() { return this._playerPos; }
    set playerPos(val) {
      if (val && typeof val === 'object') {
        this._playerPos = { x: +val.x || 50, y: +val.y || 50 };
      }
    }

    get opponents() { return this._opponents; }
    set opponents(val) {
      this._opponents = Array.isArray(val) ? val.map(o => ({
        x: +o.x || 0,
        y: +o.y || 0,
        inPit: !!o.inPit
      })) : [];
    }

    get heading() { return this._heading; }
    set heading(val) { this._heading = (+val || 0) % 360; }

    updateData(snapshot) {
      if (!snapshot) return;

      const dsPre = 'RaceCorProDrive.Plugin.DS.';
      const gameDataPre = 'DataCorePlugin.GameData.';

      this._position = +snapshot[gameDataPre + 'Position'] || 0;
      this._lapDelta = +(snapshot[dsPre + 'LapDelta']) || 0;
      this._lastLap = +snapshot[gameDataPre + 'LastLapTime'] || 0;
      this._bestLap = +snapshot[gameDataPre + 'BestLapTime'] || 0;
      this._incidents = +(snapshot[dsPre + 'IncidentCount']) || 0;

      const mapReady = +snapshot['RaceCorProDrive.Plugin.TrackMap.Ready'] || 0;
      if (mapReady) {
        const svgPath = snapshot['RaceCorProDrive.Plugin.TrackMap.SvgPath'] || '';
        if (svgPath && svgPath !== this._trackMapSvg) {
          this._trackMapSvg = svgPath;
          this._updateTrackMap();
        }

        const px = Math.max(0, Math.min(100, +snapshot['RaceCorProDrive.Plugin.TrackMap.PlayerX'] || 50));
        const py = Math.max(0, Math.min(100, +snapshot['RaceCorProDrive.Plugin.TrackMap.PlayerY'] || 50));
        this._playerPos = { x: px, y: py };

        const heading = +(snapshot['RaceCorProDrive.Plugin.TrackMap.PlayerHeading']) || 0;
        this._heading = heading % 360;
      }

      this.render();
    }

    _renderTemplate() {
      if (!this.shadowRoot) return;

      const template = document.createElement('template');
      template.innerHTML = `
        <style>
          :host {
            display: grid;
            grid-template-columns: 1fr 1.2fr auto;
            gap: 0;
            padding: 0;
            background: #000;
            color: var(--text-primary);
            font-family: var(--ff);
            width: 100%;
            height: 100%;
          }

          .dh-left {
            display: flex;
            flex-direction: column;
            position: relative;
          }

          .dh-map {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            background: hsla(0,0%,100%,0.02);
            position: relative;
            overflow: visible;
            clip-path: inset(0 round var(--corner-r));
            border-radius: var(--corner-r);
          }

          .dh-map-svg {
            width: 100%;
            height: 100%;
          }

          .dh-map-svg .map-track {
            stroke: hsla(0,0%,100%,0.3);
            stroke-width: 2;
            fill: none;
          }

          .dh-map-svg .map-player {
            fill: var(--purple);
            filter: drop-shadow(0 0 8px var(--purple));
            r: 3;
          }

          .dh-map-svg .map-opponent {
            fill: hsla(0,0%,100%,0.35);
            transition: fill 0.2s;
            r: 2;
          }

          .dh-map-svg .map-opponent.close {
            fill: hsla(0,70%,55%,0.9);
            filter: drop-shadow(0 0 4px hsla(0,70%,55%,0.6));
          }

          .dh-center {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 3vh;
            padding: 24px;
          }

          .dh-position {
            text-align: center;
          }

          .dh-pos-num {
            font-size: 14vh;
            font-weight: 900;
            font-style: italic;
            letter-spacing: -0.03em;
            line-height: 1;
          }

          .dh-lap-delta {
            font-family: var(--ff-mono);
            font-size: 8vh;
            font-weight: 700;
            text-align: center;
            transition: color 0.2s;
          }

          .dh-lap-delta.dh-faster {
            color: var(--green);
          }

          .dh-lap-delta.dh-slower {
            color: var(--red);
          }

          .dh-lap-delta.dh-neutral {
            color: var(--text-dim);
          }

          .dh-sectors {
            display: flex;
            gap: 10px;
            width: 100%;
          }

          .dh-sector {
            flex: 1;
            text-align: center;
            padding: 16px 10px;
            border-radius: 10px;
            background: hsla(0,0%,100%,0.04);
            transition: background 0.3s;
          }

          .dh-sec-label {
            font-size: 14px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.12em;
            color: hsla(0,0%,100%,0.35);
            margin-bottom: 6px;
          }

          .dh-sec-time {
            font-family: var(--ff-mono);
            font-size: 3.5vh;
            font-weight: 600;
          }

          .dh-sec-delta {
            font-family: var(--ff-mono);
            font-size: 2vh;
            font-weight: 600;
            color: hsla(0,0%,100%,0.35);
            margin-top: 4px;
          }

          .dh-right {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 24px;
            background: hsla(0,0%,100%,0.02);
          }

          .dh-incidents {
            text-align: center;
          }

          .dh-inc-label {
            font-size: 16px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.12em;
            color: hsla(0,0%,100%,0.35);
            margin-bottom: 10px;
          }

          .dh-inc-count {
            font-family: var(--ff-mono);
            font-size: 12vh;
            font-weight: 800;
            line-height: 1;
          }

          .dh-inc-x {
            font-size: 5vh;
            font-weight: 600;
            color: hsla(0,0%,100%,0.35);
            margin-left: 2px;
          }
        </style>

        <div class="dh-left">
          <div class="dh-map">
            <svg class="dh-map-svg" id="dhMapSvg" viewBox="0 0 100 100">
              <g id="dhMapRotateGroup">
                <path class="map-track" id="dhMapTrack" d=""></path>
                <g id="dhMapOpponents"></g>
              </g>
              <circle class="map-player" id="dhMapPlayer" cx="50" cy="50" r="3"></circle>
            </svg>
          </div>
        </div>

        <div class="dh-center">
          <div class="dh-position">
            <div class="dh-pos-num" id="dhPosition">—</div>
          </div>
          <div class="dh-lap-delta dh-neutral" id="dhLapDelta">+0.000</div>
          <div class="dh-sectors" id="dhSectors"></div>
          <div style="display:flex; flex-direction:column; gap:6px; width:100%;">
            <div style="text-align:center;">
              <div style="font-size:2.2vh; font-weight:600; color:hsla(0,0%,100%,0.4); text-transform:uppercase; letter-spacing:0.08em;">Last</div>
              <div style="font-family:var(--ff-mono); font-size:3.5vh; font-weight:600;" id="dhLastLap">—</div>
            </div>
          </div>
        </div>

        <div class="dh-right">
          <div class="dh-incidents">
            <div class="dh-inc-label">Incidents</div>
            <div class="dh-inc-count" id="dhIncCount">0<span class="dh-inc-x">x</span></div>
          </div>
        </div>
      `;

      this.shadowRoot.appendChild(template.content.cloneNode(true));
    }

    _cacheElements() {
      if (!this.shadowRoot) return;
      this._positionEl = this.shadowRoot.querySelector('#dhPosition');
      this._lapDeltaEl = this.shadowRoot.querySelector('#dhLapDelta');
      this._lastLapEl = this.shadowRoot.querySelector('#dhLastLap');
      this._incidentsEl = this.shadowRoot.querySelector('#dhIncCount');
      this._sectorsEl = this.shadowRoot.querySelector('#dhSectors');
      this._mapSvg = this.shadowRoot.querySelector('#dhMapSvg');
      this._mapPlayer = this.shadowRoot.querySelector('#dhMapPlayer');
      this._mapOpponents = this.shadowRoot.querySelector('#dhMapOpponents');
      this._mapRotateGroup = this.shadowRoot.querySelector('#dhMapRotateGroup');
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

    _updateTrackMap() {
      if (!this._trackMapSvg) return;
      const dhTrack = this.shadowRoot?.querySelector('#dhMapTrack');
      if (dhTrack) {
        dhTrack.setAttribute('d', this._trackMapSvg);
      }
    }

    _fmtTime(seconds) {
      if (!seconds || seconds <= 0) return '—';
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      return (m > 0 ? m + ':' : '') + (m > 0 && s < 10 ? '0' : '') + s.toFixed(2);
    }

    render() {
      // Update position
      if (this._positionEl) {
        this._positionEl.textContent = this._position > 0 ? 'P' + this._position : 'P—';
      }

      // Update lap delta
      if (this._lapDeltaEl) {
        this._lapDeltaEl.textContent = this._lapDelta === 0 ? '+0.000'
          : (this._lapDelta >= 0 ? '+' : '') + this._lapDelta.toFixed(3);
        this._lapDeltaEl.classList.remove('dh-faster', 'dh-slower', 'dh-neutral');
        if (this._lapDelta < -0.05) {
          this._lapDeltaEl.classList.add('dh-faster');
        } else if (this._lapDelta > 0.05) {
          this._lapDeltaEl.classList.add('dh-slower');
        } else {
          this._lapDeltaEl.classList.add('dh-neutral');
        }
      }

      // Update last lap
      if (this._lastLapEl) {
        this._lastLapEl.textContent = this._fmtTime(this._lastLap);
      }

      // Update incidents
      if (this._incidentsEl) {
        this._incidentsEl.innerHTML = this._incidents + '<span class="dh-inc-x">x</span>';
      }

      // Update sectors
      if (this._sectorsEl) {
        if (this._sectors.length === 0) {
          this._sectorsEl.innerHTML = '';
        } else {
          // Create/update sector cells
          const existingCells = this._sectorsEl.querySelectorAll('.dh-sector');
          if (existingCells.length !== this._sectors.length) {
            this._sectorsEl.innerHTML = '';
            for (let i = 0; i < this._sectors.length; i++) {
              const cell = document.createElement('div');
              cell.className = 'dh-sector';
              cell.innerHTML = `<div class="dh-sec-label">S${i + 1}</div>
                <div class="dh-sec-time">${this._fmtTime(this._sectors[i])}</div>
                <div class="dh-sec-delta"></div>`;
              this._sectorsEl.appendChild(cell);
            }
          } else {
            // Update existing cells
            for (let i = 0; i < this._sectors.length; i++) {
              const timeEl = existingCells[i].querySelector('.dh-sec-time');
              if (timeEl) timeEl.textContent = this._fmtTime(this._sectors[i]);
            }
          }
        }
      }

      // Update map player position
      if (this._mapPlayer) {
        this._mapPlayer.setAttribute('cx', this._playerPos.x.toFixed(1));
        this._mapPlayer.setAttribute('cy', this._playerPos.y.toFixed(1));
      }

      // Update map heading (smooth rotation)
      if (this._mapRotateGroup) {
        const now = performance.now();
        const dt = Math.min(100, now - (this._lastMapTime || now));
        this._lastMapTime = now;

        let diff = this._heading - this._headingSmooth;
        while (diff > 180) diff -= 360;
        while (diff < -180) diff += 360;

        if (Math.abs(diff) >= 0.5) {
          const alpha = 1 - Math.pow(1 - 0.10, dt / 33);
          this._headingSmooth += diff * alpha;
        }

        this._headingSmooth = ((this._headingSmooth % 360) + 360) % 360;

        const rotDeg = (-this._headingSmooth).toFixed(2);
        this._mapRotateGroup.setAttribute('transform',
          `rotate(${rotDeg},${this._playerPos.x.toFixed(1)},${this._playerPos.y.toFixed(1)})`);
      }

      // Update opponent dots
      if (this._mapOpponents) {
        const opCount = this._opponents.length;
        while (this._mapOpponents.children.length < opCount) {
          const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          circle.classList.add('map-opponent');
          circle.setAttribute('r', '2');
          this._mapOpponents.appendChild(circle);
        }
        while (this._mapOpponents.children.length > opCount) {
          this._mapOpponents.removeChild(this._mapOpponents.lastChild);
        }

        for (let i = 0; i < opCount; i++) {
          const opp = this._opponents[i];
          const circle = this._mapOpponents.children[i];
          circle.setAttribute('cx', String(opp.x));
          circle.setAttribute('cy', String(opp.y));
          circle.style.display = opp.inPit ? 'none' : '';

          const dx = this._playerPos.x - opp.x;
          const dy = this._playerPos.y - opp.y;
          const close = (dx * dx + dy * dy) < 64;
          circle.classList.toggle('close', close);
        }
      }

      // Update SVG viewBox zoom
      if (this._mapSvg) {
        const zrVisible = 22;
        const zr = Math.ceil(zrVisible * 1.42);
        const vx = this._playerPos.x - zr;
        const vy = this._playerPos.y - zr;
        this._mapSvg.setAttribute('viewBox',
          `${vx.toFixed(1)} ${vy.toFixed(1)} ${(zr * 2)} ${(zr * 2)}`);
      }
    }
  }

  customElements.define('racecor-drive-hud', RaceCorDriveHud);
})();
