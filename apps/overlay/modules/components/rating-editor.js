/**
 * @element racecor-rating-editor
 * @description iRating/Safety Rating editing interface.
 *
 * Provides UI for manual editing of:
 * - iRating value with slider and input
 * - Safety Rating with slider and input
 * - License selection dropdown
 * - Validation and persistence
 *
 * @property {number} irating - iRating value (0-9999)
 * @property {number} safetyRating - Safety Rating (0.00-5.00)
 * @property {boolean} editing - Editing mode flag
 */

(function() {
  'use strict';

  class RaceCorRatingEditor extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });

      this._irating = 0;
      this._safetyRating = 0;
      this._editing = false;

      this._irInputEl = null;
      this._irSliderEl = null;
      this._srInputEl = null;
      this._srSliderEl = null;

      this._saveHandler = null;
    }

    connectedCallback() {
      this._renderTemplate();
      this._cacheElements();
      this._bindEvents();
    }

    disconnectedCallback() {
      if (this._saveHandler) {
        this._saveHandler = null;
      }
    }

    get irating() { return this._irating; }
    set irating(val) { this._irating = Math.max(0, Math.min(9999, +val || 0)); this.render(); }

    get safetyRating() { return this._safetyRating; }
    set safetyRating(val) { this._safetyRating = Math.max(0, Math.min(5.0, +val || 0)); this.render(); }

    get editing() { return this._editing; }
    set editing(val) { this._editing = !!val; this.render(); }

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

          .re-panel {
            display: flex;
            flex-direction: column;
            gap: var(--gap);
            padding: var(--pad);
          }

          .re-section {
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding: var(--pad);
            background: var(--bg-panel);
            border: 1px solid var(--border);
            border-radius: var(--corner-r);
          }

          .re-label {
            font-size: var(--fs-xs);
            font-weight: var(--fw-bold);
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }

          .re-row {
            display: grid;
            grid-template-columns: 1fr 100px;
            gap: var(--gap);
            align-items: center;
          }

          input[type="range"] {
            flex: 1;
            height: 6px;
            cursor: pointer;
          }

          input[type="text"],
          input[type="number"] {
            padding: 4px 8px;
            background: var(--bg);
            border: 1px solid var(--border);
            border-radius: 4px;
            color: var(--text-primary);
            font-family: var(--ff-mono);
            font-size: var(--fs-sm);
          }

          .re-buttons {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: var(--gap);
          }

          button {
            padding: 6px 12px;
            background: var(--accent);
            color: var(--bg);
            border: none;
            border-radius: 4px;
            font-weight: var(--fw-semi);
            cursor: pointer;
            transition: opacity 0.2s;
          }

          button:hover {
            opacity: 0.8;
          }

          button.secondary {
            background: var(--border);
            color: var(--text-primary);
          }

          .re-history {
            max-height: 200px;
            overflow-y: auto;
            border: 1px solid var(--border);
            border-radius: 4px;
            background: var(--bg);
            font-size: 11px;
          }

          .re-history-entry {
            padding: 4px 8px;
            border-bottom: 1px solid var(--border);
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: var(--gap);
          }

          .re-history-entry:last-child {
            border-bottom: none;
          }

          .re-history-time {
            color: var(--text-dim);
            font-family: var(--ff-mono);
          }

          .re-history-del {
            background: none;
            border: none;
            color: var(--text-dim);
            cursor: pointer;
            padding: 0;
            width: 16px;
            height: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
          }

          .re-history-del:hover {
            color: hsl(0, 80%, 55%);
          }
        </style>

        <div class="re-panel">
          <div class="re-section">
            <div class="re-label">iRating</div>
            <div class="re-row">
              <input type="range" id="reIRatingSlider" min="0" max="9999" value="0">
              <input type="number" id="reIRatingInput" min="0" max="9999" value="0">
            </div>
          </div>

          <div class="re-section">
            <div class="re-label">Safety Rating</div>
            <div class="re-row">
              <input type="range" id="reSRSlider" min="0" max="5" step="0.01" value="0">
              <input type="number" id="reSRInput" min="0" max="5" step="0.01" value="0">
            </div>
          </div>

          <div class="re-buttons">
            <button id="reButton Save">Save</button>
            <button id="reButtonReset" class="secondary">Reset</button>
          </div>

          <div class="re-section">
            <div class="re-label">History</div>
            <div class="re-history" id="reHistory">
              <div style="padding: 8px; text-align: center; color: var(--text-dim); font-size: 11px;">No history yet</div>
            </div>
          </div>
        </div>
      `;

      this.shadowRoot.appendChild(template.content.cloneNode(true));
    }

    _cacheElements() {
      if (!this.shadowRoot) return;
      this._irInputEl = this.shadowRoot.querySelector('#reIRatingInput');
      this._irSliderEl = this.shadowRoot.querySelector('#reIRatingSlider');
      this._srInputEl = this.shadowRoot.querySelector('#reSRInput');
      this._srSliderEl = this.shadowRoot.querySelector('#reSRSlider');
    }

    _bindEvents() {
      if (!this.shadowRoot) return;

      const saveBtn = this.shadowRoot.querySelector('#reButton Save') || this.shadowRoot.querySelector('[id*="Save"]');
      const resetBtn = this.shadowRoot.querySelector('#reButtonReset');

      if (this._irInputEl && this._irSliderEl) {
        this._irInputEl.addEventListener('input', (e) => {
          this._irSliderEl.value = Math.max(0, Math.min(9999, +e.target.value));
          this._irating = +this._irSliderEl.value;
        });
        this._irSliderEl.addEventListener('input', (e) => {
          this._irInputEl.value = +e.target.value;
          this._irating = +e.target.value;
        });
      }

      if (this._srInputEl && this._srSliderEl) {
        this._srInputEl.addEventListener('input', (e) => {
          this._srSliderEl.value = Math.max(0, Math.min(5, +e.target.value));
          this._safetyRating = +this._srSliderEl.value;
        });
        this._srSliderEl.addEventListener('input', (e) => {
          this._srInputEl.value = (+e.target.value).toFixed(2);
          this._safetyRating = +e.target.value;
        });
      }

      if (saveBtn) {
        saveBtn.addEventListener('click', () => {
          this.dispatchEvent(new CustomEvent('rating-save', {
            detail: { irating: this._irating, safetyRating: this._safetyRating },
            bubbles: true,
            composed: true
          }));
        });
      }

      if (resetBtn) {
        resetBtn.addEventListener('click', () => {
          this.render();
        });
      }
    }

    render() {
      if (this._irInputEl) this._irInputEl.value = this._irating || 0;
      if (this._irSliderEl) this._irSliderEl.value = this._irating || 0;
      if (this._srInputEl) this._srInputEl.value = (this._safetyRating || 0).toFixed(2);
      if (this._srSliderEl) this._srSliderEl.value = this._safetyRating || 0;
    }
  }

  customElements.define('racecor-rating-editor', RaceCorRatingEditor);
})();
