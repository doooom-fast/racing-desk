/**
 * @element racecor-commentary
 * @description AI commentary panel with sentiment coloring and auto-show/hide.
 *
 * Displays commentary with:
 * - Sentiment-colored border (hue from commentary engine)
 * - Title, body text, meta info
 * - Topic icon integration
 * - Auto-show/hide with CSS transitions
 *
 * @property {string} title - Commentary title/header
 * @property {string} text - Commentary body text
 * @property {string} meta - Meta information (e.g., lap number, position)
 * @property {string} topicId - Topic identifier for icon/styling
 * @property {number} sentimentHue - Hue value (0-360) for sentiment color
 * @property {boolean} visible - Show/hide the panel
 */

(function() {
  'use strict';

  class RaceCorCommentary extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });

      this._title = '';
      this._text = '';
      this._meta = '';
      this._topicId = '';
      this._sentimentHue = 210;
      this._visible = false;

      this._contentEl = null;

      this._telemetryHandler = null;
      this._visibilityTimeout = null;
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
      if (this._visibilityTimeout) {
        clearTimeout(this._visibilityTimeout);
        this._visibilityTimeout = null;
      }
    }

    get title() { return this._title; }
    set title(val) { this._title = val || ''; this.render(); }

    get text() { return this._text; }
    set text(val) { this._text = val || ''; this.render(); }

    get meta() { return this._meta; }
    set meta(val) { this._meta = val || ''; this.render(); }

    get topicId() { return this._topicId; }
    set topicId(val) { this._topicId = val || ''; this.render(); }

    get sentimentHue() { return this._sentimentHue; }
    set sentimentHue(val) { this._sentimentHue = +val || 210; this.render(); }

    get visible() { return this._visible; }
    set visible(val) { this._visible = !!val; this.render(); }

    updateData(snapshot) {
      if (!snapshot) return;
      // Commentary data typically comes from a custom event rather than telemetry
      // This is a placeholder for future integration
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

          .cm-panel {
            display: none;
            position: relative;
            padding: var(--pad);
            background: var(--bg-panel);
            border: 2px solid hsl(210, 60%, 50%);
            border-radius: var(--corner-r);
            transition: all 0.3s ease;
            opacity: 0;
          }

          .cm-panel.visible {
            display: block;
            opacity: 1;
          }

          .cm-header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
            font-size: var(--fs-sm);
            font-weight: var(--fw-bold);
            color: var(--text-primary);
          }

          .cm-icon {
            width: 20px;
            height: 20px;
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            background: var(--bg);
            border: 1px solid var(--border);
            font-size: 11px;
          }

          .cm-body {
            font-size: var(--fs-xs);
            line-height: 1.4;
            color: var(--text-primary);
            margin-bottom: 8px;
          }

          .cm-meta {
            font-size: 10px;
            color: var(--text-dim);
            font-family: var(--ff-mono);
            text-align: right;
          }

          /* ── MINIMAL MODE — Tufte-pure: tight, no decoration ── */
          :host-context(body.mode-minimal) .cm-panel {
            padding: 6px;
            border-width: 1px;
            border-radius: 3px;
            background: transparent;
          }

          :host-context(body.mode-minimal) .cm-icon {
            display: none;
          }

          :host-context(body.mode-minimal) .cm-header {
            margin-bottom: 4px;
            gap: 4px;
          }

          :host-context(body.mode-minimal) .cm-body {
            font-size: 11px;
            line-height: 1.3;
            margin-bottom: 4px;
          }

          :host-context(body.mode-minimal) .cm-meta {
            font-size: 9px;
          }
        </style>

        <div class="cm-panel">
          <div class="cm-header">
            <div class="cm-icon">💬</div>
            <div id="cmTitle">Commentary</div>
          </div>
          <div class="cm-body" id="cmBody">—</div>
          <div class="cm-meta" id="cmMeta"></div>
        </div>
      `;

      this.shadowRoot.appendChild(template.content.cloneNode(true));
    }

    _cacheElements() {
      if (!this.shadowRoot) return;
      this._contentEl = this.shadowRoot.querySelector('.cm-panel');
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

    show(title, text, meta = '', topicId = '', sentimentHue = 210) {
      this._title = title;
      this._text = text;
      this._meta = meta;
      this._topicId = topicId;
      this._sentimentHue = sentimentHue;
      this._visible = true;

      if (this._visibilityTimeout) clearTimeout(this._visibilityTimeout);
      this._visibilityTimeout = setTimeout(() => {
        this._visible = false;
        this.render();
      }, 5000);

      this.render();
    }

    hide() {
      this._visible = false;
      if (this._visibilityTimeout) {
        clearTimeout(this._visibilityTimeout);
        this._visibilityTimeout = null;
      }
      this.render();
    }

    render() {
      if (!this._contentEl) return;

      this._contentEl.classList.toggle('visible', this._visible);
      this._contentEl.style.borderColor = `hsl(${this._sentimentHue}, 60%, 50%)`;

      const titleEl = this.shadowRoot.querySelector('#cmTitle');
      const bodyEl = this.shadowRoot.querySelector('#cmBody');
      const metaEl = this.shadowRoot.querySelector('#cmMeta');

      if (titleEl) titleEl.textContent = this._title || 'Commentary';
      if (bodyEl) bodyEl.textContent = this._text || '—';
      if (metaEl) metaEl.textContent = this._meta;

      const iconEl = this.shadowRoot.querySelector('.cm-icon');
      if (iconEl) {
        const icons = {
          'spin_catch': '🌀',
          'high_cornering_load': '🔄',
          'heavy_braking': '🛑',
          'personal_best': '✨',
          'position_gained': '⬆️',
          'position_lost': '⬇️',
          'incident_spike': '⚠️',
          'low_fuel': '⛽',
          'hot_tyres': '🔥',
          'wet_track': '🌧️'
        };
        iconEl.textContent = icons[this._topicId] || '💬';
      }
    }
  }

  customElements.define('racecor-commentary', RaceCorCommentary);
})();
