/**
 * @element racecor-race-control
 * @description Race control flag banner with animated stripe and auto-hide.
 *
 * Shows critical race control messages (yellow, red, checkered, black, meatball)
 * with animated stripe background, color-coded accent bar, and auto-hide after 8s.
 *
 * Accepts flag state via `show(flagType)` or property updates.
 *
 * @attribute none (uses methods instead)
 *
 * @property {string} flagState - Current flag state: 'yellow', 'red', 'checkered', 'black', 'meatball' (default: '')
 * @property {string} detail - Custom detail text (default: from RC_MESSAGES)
 *
 * @method show(flagType) - Display banner for flag type
 * @method hide() - Hide banner immediately
 *
 * @fires none (no custom events)
 *
 * @slot default (not used, Shadow DOM only)
 *
 * @example
 * <racecor-race-control></racecor-race-control>
 *
 * <script>
 *   const banner = document.querySelector('racecor-race-control');
 *   banner.show('red');  // Show red flag
 * </script>
 */

(function() {
  'use strict';

  const RC_MESSAGES = {
    yellow:    { title: 'CAUTION',          detail: 'Full course yellow — hold position' },
    red:       { title: 'RED FLAG',         detail: 'Session stopped — return to pits' },
    checkered: { title: 'CHECKERED FLAG',   detail: 'Race complete — cool down lap' },
    black:     { title: 'BLACK FLAG',       detail: 'Penalty — report to pit lane immediately' },
    meatball:  { title: 'MEATBALL FLAG',    detail: 'Mechanical issue — pit for required repairs' },
  };

  const RC_DISPLAY_MS = 8000;

  class RaceCorRaceControl extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });

      // ── Internal state ──────────────────────────────────────────
      this._flagState = '';
      this._detail = '';
      this._hideTimer = null;

      // ── Cached element references ────────────────────────────────
      this._bannerEl = null;
      this._titleEl = null;
      this._detailEl = null;
    }

    // ╔═══════════════════════════════════════════════════════════╗
    // ║ LIFECYCLE HOOKS                                            ║
    // ╚═══════════════════════════════════════════════════════════╝

    connectedCallback() {
      this._renderTemplate();
      this._cacheElements();
    }

    disconnectedCallback() {
      if (this._hideTimer) {
        clearTimeout(this._hideTimer);
        this._hideTimer = null;
      }
      this._bannerEl = null;
      this._titleEl = null;
      this._detailEl = null;
    }

    // ╔═══════════════════════════════════════════════════════════╗
    // ║ PROPERTIES                                                 ║
    // ╚═══════════════════════════════════════════════════════════╝

    get flagState() { return this._flagState; }
    get detail() { return this._detail; }

    // ╔═══════════════════════════════════════════════════════════╗
    // ║ PUBLIC API — show() and hide()                             ║
    // ╚═══════════════════════════════════════════════════════════╝

    show(flagType) {
      if (!flagType || !RC_MESSAGES[flagType]) return;

      const msg = RC_MESSAGES[flagType];
      this._flagState = flagType;
      this._detail = msg.detail;

      if (this._titleEl) this._titleEl.textContent = msg.title;
      if (this._detailEl) this._detailEl.textContent = msg.detail;

      // Remove previous flag classes
      if (this._bannerEl) {
        this._bannerEl.className = this._bannerEl.className.replace(/\brc-flag-\S+/g, '').trim();
        this._bannerEl.classList.add('rc-flag-' + flagType);
        this._bannerEl.classList.add('rc-visible');
      }

      // Dim HUD (body.rc-active)
      if (document && document.body) {
        document.body.classList.add('rc-active');
      }

      // Auto-hide after duration
      if (this._hideTimer) clearTimeout(this._hideTimer);
      this._hideTimer = setTimeout(() => {
        this.hide();
      }, RC_DISPLAY_MS);
    }

    hide() {
      if (this._bannerEl) {
        this._bannerEl.classList.remove('rc-visible');
      }
      this._flagState = '';

      if (this._hideTimer) {
        clearTimeout(this._hideTimer);
        this._hideTimer = null;
      }

      // Restore HUD
      if (document && document.body) {
        document.body.classList.remove('rc-active');
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
            --ff: sofia-pro-comp, sans-serif;
            --ff-semi: inherit;
            display: block;
          }

          .rc-banner {
            position: fixed;
            top: 0;
            left: 50%;
            transform: translateX(-50%) translateY(-100%);
            z-index: 200;
            pointer-events: none;
            transition: transform 0.45s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.45s ease;
            opacity: 0;
          }

          .rc-banner.rc-visible {
            transform: translateX(-50%) translateY(0);
            opacity: 1;
          }

          .rc-inner {
            display: flex;
            align-items: center;
            gap: 18px;
            background: hsla(0, 0%, 3%, 0.90);
            border: 2px solid hsla(48, 90%, 55%, 0.80);
            border-top: none;
            border-radius: 0 0 14px 14px;
            padding: 16px 36px 18px 28px;
            box-shadow: 0 6px 40px hsla(0, 0%, 0%, 0.7), inset 0 -1px 0 hsla(48, 90%, 55%, 0.10);
            position: relative;
            overflow: hidden;
          }

          /* Animated stripe background */
          .rc-inner::after {
            content: '';
            position: absolute;
            inset: 0;
            z-index: 0;
            opacity: 0;
            transition: opacity 0.5s ease;
            background: repeating-linear-gradient(
              -45deg,
              hsla(48, 90%, 55%, 0.08) 0px,
              hsla(48, 90%, 55%, 0.08) 12px,
              transparent 12px,
              transparent 24px
            );
            background-size: 34px 34px;
            animation: rc-flag-scroll 1.5s linear infinite;
            pointer-events: none;
          }

          .rc-banner.rc-visible .rc-inner::after {
            opacity: 1;
          }

          @keyframes rc-flag-scroll {
            0%   { background-position: 0 0; }
            100% { background-position: 34px 34px; }
          }

          /* Per-flag stripe overrides */
          .rc-banner.rc-flag-red .rc-inner::after {
            background: repeating-linear-gradient(-45deg, hsla(0, 85%, 55%, 0.10) 0px, hsla(0, 85%, 55%, 0.10) 12px, transparent 12px, transparent 24px);
            background-size: 34px 34px;
          }

          .rc-banner.rc-flag-checkered .rc-inner::after {
            background: repeating-linear-gradient(-45deg, hsla(0, 0%, 100%, 0.08) 0px, hsla(0, 0%, 100%, 0.08) 12px, hsla(0, 0%, 0%, 0.08) 12px, hsla(0, 0%, 0%, 0.08) 24px);
            background-size: 34px 34px;
          }

          .rc-banner.rc-flag-black .rc-inner::after {
            background: repeating-linear-gradient(-45deg, hsla(0, 75%, 45%, 0.10) 0px, hsla(0, 75%, 45%, 0.10) 12px, transparent 12px, transparent 24px);
            background-size: 34px 34px;
          }

          .rc-banner.rc-flag-meatball .rc-inner::after {
            background: repeating-linear-gradient(-45deg, hsla(0, 85%, 55%, 0.12) 0px, hsla(0, 85%, 55%, 0.12) 12px, transparent 12px, transparent 24px);
            background-size: 34px 34px;
          }

          /* Left accent bar */
          .rc-inner::before {
            content: '';
            position: absolute;
            left: 0;
            top: 0;
            bottom: 0;
            width: 4px;
            z-index: 2;
            background: hsl(48, 90%, 55%);
            border-radius: 0 0 0 14px;
          }

          .rc-icon {
            width: 52px;
            height: 52px;
            flex-shrink: 0;
            position: relative;
            z-index: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 32px;
          }

          .rc-content {
            display: flex;
            flex-direction: column;
            gap: 3px;
            position: relative;
            z-index: 1;
          }

          .rc-title {
            font-family: var(--ff);
            font-size: 28px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.10em;
            color: #FFFFFF;
            line-height: 1.1;
            white-space: nowrap;
            margin: 0;
          }

          .rc-detail {
            font-family: var(--ff-semi);
            font-size: 15px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: hsl(48, 80%, 55%);
            line-height: 1.25;
            white-space: nowrap;
            margin: 0;
          }

          /* Pulse glow */
          .rc-banner.rc-visible .rc-inner {
            animation: rc-glow 3s ease-in-out infinite alternate;
          }

          @keyframes rc-glow {
            0%   { box-shadow: 0 4px 24px hsla(0, 0%, 0%, 0.6), inset 0 -1px 0 hsla(48, 90%, 55%, 0.24), 0 0 8px hsla(48, 85%, 50%, 0.24); }
            100% { box-shadow: 0 4px 24px hsla(0, 0%, 0%, 0.6), inset 0 -1px 0 hsla(48, 90%, 55%, 0.45), 0 0 18px hsla(48, 85%, 50%, 0.54); }
          }

          /* Per-flag color overrides */
          .rc-banner.rc-flag-red .rc-inner {
            border-color: hsla(0, 85%, 55%, 0.45);
          }

          .rc-banner.rc-flag-red .rc-inner::before {
            background: hsl(0, 85%, 55%);
          }

          .rc-banner.rc-flag-red .rc-detail {
            color: hsl(0, 80%, 65%);
          }

          .rc-banner.rc-flag-red.rc-visible .rc-inner {
            animation-name: rc-glow-red;
          }

          @keyframes rc-glow-red {
            0%   { box-shadow: 0 4px 24px hsla(0, 0%, 0%, 0.6), 0 0 8px hsla(0, 80%, 50%, 0.30); }
            100% { box-shadow: 0 4px 24px hsla(0, 0%, 0%, 0.6), 0 0 18px hsla(0, 80%, 50%, 0.66); }
          }

          .rc-banner.rc-flag-checkered .rc-inner {
            border-color: hsla(0, 0%, 100%, 0.30);
          }

          .rc-banner.rc-flag-checkered .rc-inner::before {
            background: repeating-linear-gradient(180deg, #fff 0 4px, #222 4px 8px);
          }

          .rc-banner.rc-flag-checkered .rc-detail {
            color: hsl(0, 0%, 80%);
          }

          .rc-banner.rc-flag-black .rc-inner {
            border-color: hsla(0, 75%, 40%, 0.40);
          }

          .rc-banner.rc-flag-black .rc-inner::before {
            background: hsl(0, 75%, 45%);
          }

          .rc-banner.rc-flag-black .rc-detail {
            color: hsl(0, 60%, 60%);
          }

          .rc-banner.rc-flag-meatball .rc-inner {
            border-color: hsla(0, 90%, 50%, 0.50);
          }

          .rc-banner.rc-flag-meatball .rc-inner::before {
            background: radial-gradient(circle, hsl(0, 85%, 52%) 40%, hsl(0, 0%, 10%) 42%);
          }

          .rc-banner.rc-flag-meatball .rc-detail {
            color: hsl(0, 80%, 65%);
          }

          .rc-banner.rc-flag-meatball.rc-visible .rc-inner {
            animation-name: rc-glow-meatball;
          }

          @keyframes rc-glow-meatball {
            0%   { box-shadow: 0 4px 24px hsla(0, 0%, 0%, 0.6), 0 0 8px hsla(0, 90%, 50%, 0.35); }
            100% { box-shadow: 0 4px 24px hsla(0, 0%, 0%, 0.6), 0 0 20px hsla(0, 90%, 50%, 0.70); }
          }

          /* ── MINIMAL MODE — Tufte-pure: solid color, big text, zero chartjunk ── */
          :host-context(body.mode-minimal) .rc-inner {
            background: hsla(0, 0%, 3%, 0.95);
            padding: 12px 24px 14px 20px;
            box-shadow: none !important;
            animation: none !important;
          }

          /* Remove animated stripes — first species of chartjunk (moiré) */
          :host-context(body.mode-minimal) .rc-inner::after {
            display: none !important;
          }

          /* Remove accent bar — decoration, not data */
          :host-context(body.mode-minimal) .rc-inner::before {
            display: none !important;
          }

          /* Remove icon — text + color communicate the flag state */
          :host-context(body.mode-minimal) .rc-icon {
            display: none;
          }

          /* The message IS the data — make it large and unmissable */
          :host-context(body.mode-minimal) .rc-title {
            font-size: 36px;
            letter-spacing: 0.15em;
          }

          :host-context(body.mode-minimal) .rc-detail {
            font-size: 14px;
          }

          :host-context(body.mode-minimal) .rc-banner.rc-visible .rc-inner {
            animation: none !important;
          }
        </style>

        <div class="rc-banner" id="rcBanner">
          <div class="rc-inner">
            <div class="rc-icon">🚩</div>
            <div class="rc-content">
              <div class="rc-title" id="rcTitle">—</div>
              <div class="rc-detail" id="rcDetail">—</div>
            </div>
          </div>
        </div>
      `;

      this.shadowRoot.appendChild(template.content.cloneNode(true));
    }

    _cacheElements() {
      if (!this.shadowRoot) return;

      this._bannerEl = this.shadowRoot.getElementById('rcBanner');
      this._titleEl = this.shadowRoot.getElementById('rcTitle');
      this._detailEl = this.shadowRoot.getElementById('rcDetail');
    }
  }

  // ══════════════════════════════════════════════════════════════
  // REGISTRATION
  // ══════════════════════════════════════════════════════════════

  if (window && window.customElements) {
    customElements.define('racecor-race-control', RaceCorRaceControl);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = RaceCorRaceControl;
  }

})();
