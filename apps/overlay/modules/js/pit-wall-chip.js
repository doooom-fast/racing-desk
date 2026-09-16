// ═══════════════════════════════════════════════════════════════
//  PIT WALL CHIP — overlay micro-widget
//
//  Surfaces the at-a-glance Composure score + Heat direction the
//  driver sees on web (/drive/pit-wall) and in the desktop apps.
//  Lives in the overlay as a tiny chip near the incidents panel so
//  the in-race read of "are you racing clean today?" is one glance
//  away while you're driving.
//
//  Vocabulary anchored in `agents/prodrive-context/glossary.md`.
//  No finance terminology in any string the user can see.
//
//  Polls /api/v1/dashboard at a slow cadence (60s default) — the
//  values barely move during a stint, so we don't burn requests.
//  Bails out silently on 401 / network failure: the chip stays in
//  whatever state it last had, and SimHub-driven panels are
//  unaffected.
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  const POLL_INTERVAL_MS = 60_000;          // 60s
  const FIRST_POLL_DELAY_MS = 1_500;        // 1.5s after boot

  function baseUrl() {
    if (typeof window !== 'undefined' && window.K10_WEB_API_URL) {
      return String(window.K10_WEB_API_URL).replace(/\/+$/, '');
    }
    if (typeof window !== 'undefined' && window.config && window.config.apiBase) {
      return String(window.config.apiBase).replace(/\/+$/, '');
    }
    return 'https://prodrive.racecor.io';
  }

  function headers() {
    const h = { Accept: 'application/json' };
    if (typeof window !== 'undefined' && window._k10Token) {
      h.Authorization = 'Bearer ' + window._k10Token;
    }
    return h;
  }

  // ── Styling tables ──────────────────────────────────────────

  const BAND_STYLE = {
    untouchable: { color: '#7DD3FC', label: 'Untouchable' },
    sharp:       { color: '#4ADE80', label: 'Sharp' },
    steady:      { color: '#F5A524', label: 'Steady' },
    gritty:      { color: '#FF5A47', label: 'Gritty' },
  };

  const HEAT_STYLE = {
    hot:  { color: '#FF7A1A', label: 'Hot',  glyph: '▲▲', tempo: '0.9s'  },
    warm: { color: '#F5A524', label: 'Warm', glyph: '▲',  tempo: '1.6s'  },
    cold: { color: '#5FA8FF', label: 'Cold', glyph: '▼',  tempo: '2.4s'  },
    flat: { color: '#94A3B8', label: 'Flat', glyph: '·',  tempo: '4.0s'  },
  };

  // ── DOM ─────────────────────────────────────────────────────

  let chipEl = null;
  let scoreEl = null;
  let bandEl = null;
  let dotEl = null;
  let heatEl = null;
  let timerHandle = null;

  function ensureChip() {
    if (chipEl) return chipEl;

    chipEl = document.createElement('div');
    chipEl.id = 'pitWallChip';
    chipEl.className = 'pw-chip pw-hidden';
    chipEl.setAttribute('aria-label', 'Pit Wall — Composure and Heat');

    chipEl.innerHTML = `
      <div class="pw-band-rail" aria-hidden="true"></div>
      <div class="pw-content">
        <div class="pw-row">
          <span class="pw-label">PIT WALL</span>
          <span class="pw-score" id="pwScore">—</span>
        </div>
        <div class="pw-row">
          <span class="pw-band" id="pwBand">…</span>
          <span class="pw-sep">·</span>
          <span class="pw-heat-dot" id="pwHeatDot"></span>
          <span class="pw-heat" id="pwHeat">Flat</span>
        </div>
      </div>
    `;

    document.body.appendChild(chipEl);

    scoreEl = chipEl.querySelector('#pwScore');
    bandEl  = chipEl.querySelector('#pwBand');
    dotEl   = chipEl.querySelector('#pwHeatDot');
    heatEl  = chipEl.querySelector('#pwHeat');

    return chipEl;
  }

  // ── Render ──────────────────────────────────────────────────

  function render(payload) {
    ensureChip();
    const composure = payload && payload.composure;
    const heat      = payload && payload.heat;

    if (!composure || (composure.sampleSize | 0) === 0) {
      chipEl.classList.add('pw-hidden');
      return;
    }
    chipEl.classList.remove('pw-hidden');

    const bandKey = String(composure.band || 'steady').toLowerCase();
    const band = BAND_STYLE[bandKey] || BAND_STYLE.steady;

    const heatKey = heat ? String(heat.direction || 'flat').toLowerCase() : 'flat';
    const heatStyle = HEAT_STYLE[heatKey] || HEAT_STYLE.flat;

    scoreEl.textContent = String(composure.score | 0);
    scoreEl.style.color = band.color;

    bandEl.textContent = band.label;
    bandEl.style.color = band.color;

    heatEl.textContent = heatStyle.label;
    heatEl.style.color = heatStyle.color;

    dotEl.style.backgroundColor = heatStyle.color;
    dotEl.style.setProperty('--pw-pulse-tempo', heatStyle.tempo);
    dotEl.classList.toggle('pw-dot-static', heatKey === 'flat');

    // Left rail tint follows band so the chip reads at a glance.
    const rail = chipEl.querySelector('.pw-band-rail');
    if (rail) rail.style.backgroundColor = band.color;
  }

  // ── Polling ─────────────────────────────────────────────────

  async function poll() {
    try {
      const url = baseUrl() + '/api/v1/dashboard';
      const resp = await fetch(url, { method: 'GET', headers: headers() });
      if (!resp.ok) {
        // 401 (not signed in), 5xx — keep the last good render. The
        // chip never blocks the rest of the overlay.
        return;
      }
      const data = await resp.json();
      render(data);
    } catch (_) {
      // Network/parse error — silent. Try again next tick.
    }
  }

  function start() {
    if (timerHandle) return;
    setTimeout(poll, FIRST_POLL_DELAY_MS);
    timerHandle = setInterval(poll, POLL_INTERVAL_MS);
  }

  function stop() {
    if (timerHandle) {
      clearInterval(timerHandle);
      timerHandle = null;
    }
  }

  // ── Public API ──────────────────────────────────────────────

  if (typeof window !== 'undefined') {
    window.PitWallChip = { start, stop, refresh: poll, render };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      start();
    }
  }
})();
