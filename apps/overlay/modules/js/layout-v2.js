// ═══════════════════════════════════════════════════════════════
// K10 Motorsports — Layout v2 engine
//
// Data-driven module placement: renders the `layout` block the WinUI
// host writes into overlay-settings.json (version 2). Groups are
// position:fixed flex containers; member modules are REPARENTED into
// them (a comment placeholder marks each module's original DOM spot so
// restore() can put everything back exactly). The legacy corner engine
// (settings.js applyLayout/applyZoom) stays untouched and runs whenever
// no v2 block is present.
//
// Anchor math — one code path for locked and free groups:
//   pivot (px,py)  = anchor's unit corner (top-right → 1,0)
//   target (tx,ty) = locked ? anchor's natural corner inset by --edge
//                  : (x·vw, y·vh)            (normalized, visual px)
//   left/top       = target / zoomScale       (zoomed units)
//   transform      = translate(-px·100%, -py·100%)
// translate-% resolves against the zoomed border box, so the pivot
// lands on the target without measuring; dividing left/top by the
// scale mirrors the legacy --edge-z compensation (a zoomed element
// interprets its own left/top in zoomed units).
//
// Contract + plan: prodrive-windows/docs/overlay-layout-v2.md.
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  var PIVOTS = {
    'top-left':      [0,   0],
    'top-center':    [0.5, 0],
    'top-right':     [1,   0],
    'middle-left':   [0,   0.5],
    'center':        [0.5, 0.5],
    'middle-right':  [1,   0.5],
    'bottom-left':   [0,   1],
    'bottom-center': [0.5, 1],
    'bottom-right':  [1,   1],
  };

  var _registry = null;        // parsed layout-registry.json
  var _active = false;
  var _pending = null;         // apply() args queued until the registry arrives
  var _lastLayout = null;
  var _lastOpts = null;
  var _placeholders = {};      // moduleId → Comment node at the original DOM spot
  var _adopted = {};           // moduleId → element (currently reparented)
  var _resizeObserver = null;
  var _metricsTimer = null;

  function _root() {
    var el = document.getElementById('layoutV2Root');
    if (!el) {
      el = document.createElement('div');
      el.id = 'layoutV2Root';
      document.body.appendChild(el);
    }
    return el;
  }

  function _moduleEl(moduleId) {
    if (_adopted[moduleId]) return _adopted[moduleId];
    if (!_registry || !_registry.modules) return null;
    for (var i = 0; i < _registry.modules.length; i++) {
      var m = _registry.modules[i];
      if (m.id === moduleId) {
        return m.selector ? document.querySelector(m.selector) : null;
      }
    }
    return null;
  }

  function _adopt(moduleId) {
    var el = _moduleEl(moduleId);
    if (!el) return null;
    if (!_adopted[moduleId]) {
      // First adoption: drop a placeholder at the exact original spot
      // so restore() is order-independent and byte-exact.
      var marker = document.createComment('lv2:' + moduleId);
      el.parentNode.insertBefore(marker, el);
      _placeholders[moduleId] = marker;
      _adopted[moduleId] = el;
      el.classList.add('lv2-module');
      // Legacy paths may have left inline zoom/position state behind
      // (applyZoom, incidents' stale-class workaround, bottomYOffset).
      // The lv2-module CSS neutralizes class-driven rules; inline
      // values are cleared here.
      el.style.zoom = '';
      el.style.top = '';
      el.style.bottom = '';
      el.style.left = '';
      el.style.right = '';
      el.style.marginTop = '';
      el.style.marginBottom = '';
    }
    return el;
  }

  /** Member slots are `string | string[]` — normalize to arrays. */
  function _slotIds(slot) {
    return Array.isArray(slot) ? slot : [slot];
  }

  function _structureKey(group) {
    return JSON.stringify({ m: group.members || [], f: group.flow || 'row', g: group.gap });
  }

  function _buildGroupChildren(container, group) {
    var flow = group.flow === 'column' ? 'column' : 'row';
    var gapPx = (typeof group.gap === 'number' ? group.gap : 4) + 'px';
    container.style.flexDirection = flow;
    container.style.gap = gapPx;

    var desired = [];
    (group.members || []).forEach(function (slot) {
      var ids = _slotIds(slot);
      if (ids.length === 1) {
        var el = _adopt(ids[0]);
        if (el) desired.push(el);
        return;
      }
      // Stack: perpendicular flex inside one slot of the group flow.
      var slotEl = document.createElement('div');
      slotEl.className = 'layout-slot';
      slotEl.style.flexDirection = flow === 'row' ? 'column' : 'row';
      slotEl.style.gap = gapPx;
      ids.forEach(function (id) {
        var member = _adopt(id);
        if (member) slotEl.appendChild(member);
      });
      if (slotEl.childNodes.length) desired.push(slotEl);
    });

    // replaceChildren moves adopted nodes in one shot. Anything that
    // was in this container and is no longer desired ends up detached —
    // _reconcileOrphans() afterwards sends those modules home.
    container.replaceChildren.apply(container, desired);
  }

  function _position(container, group, scale, edgePx) {
    var anchor = PIVOTS.hasOwnProperty(group.anchor) ? group.anchor : 'top-left';
    var pivot = PIVOTS[anchor];
    var vw = window.innerWidth;
    var vh = window.innerHeight;

    var tx, ty;
    if (group.locked) {
      // Pinned to the anchor's natural point, inset by the edge gap on
      // touching edges (px 0 → +edge, px 1 → −edge, centers → 0).
      tx = pivot[0] * vw + (pivot[0] === 0 ? edgePx : pivot[0] === 1 ? -edgePx : 0);
      ty = pivot[1] * vh + (pivot[1] === 0 ? edgePx : pivot[1] === 1 ? -edgePx : 0);
    } else {
      tx = (typeof group.x === 'number' ? group.x : 0) * vw;
      ty = (typeof group.y === 'number' ? group.y : 0) * vh;
    }

    container.style.zoom = scale;
    container.style.left = (tx / scale) + 'px';
    container.style.top = (ty / scale) + 'px';
    container.style.transform =
      'translate(' + (-pivot[0] * 100) + '%, ' + (-pivot[1] * 100) + '%)';
  }

  /** Modules detached by a rebuild but in no group anymore → restore home. */
  function _reconcileOrphans() {
    Object.keys(_adopted).forEach(function (id) {
      var el = _adopted[id];
      if (!el.isConnected) _restoreModule(id);
    });
  }

  function _restoreModule(moduleId) {
    var el = _adopted[moduleId];
    var marker = _placeholders[moduleId];
    if (el && marker && marker.parentNode) {
      el.classList.remove('lv2-module');
      marker.replaceWith(el);
    } else if (marker && marker.parentNode) {
      marker.remove();
    }
    delete _adopted[moduleId];
    delete _placeholders[moduleId];
  }

  // ── Public: apply ────────────────────────────────────────────────

  /**
   * Render a v2 layout. Returns true when the engine took ownership
   * (callers skip the legacy path), false when it can't yet — bad
   * version, or registry still loading (the call is queued and re-runs
   * the full settings apply once the registry lands).
   */
  function apply(layout, opts) {
    if (!layout || layout.version !== 2 || !Array.isArray(layout.groups)) return false;
    if (!_registry) {
      _pending = { layout: layout, opts: opts || {} };
      return false;
    }

    _lastLayout = layout;
    _lastOpts = opts || {};
    var scale = ((_lastOpts.zoom || 100) / 100) || 1;

    // Same --dash-zoom / --edge-z publication as legacy applyZoom so
    // CSS consuming those variables keeps working while v2 is active.
    document.documentElement.style.setProperty('--dash-zoom', scale);
    var baseEdge = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--edge'), 10) || 10;
    document.documentElement.style.setProperty('--edge-z', (baseEdge / scale) + 'px');

    var root = _root();
    document.body.classList.add('layout-v2-active');
    _active = true;

    // Reconcile containers against the group list.
    var wanted = {};
    layout.groups.forEach(function (group) {
      if (!group || !group.id) return;
      wanted[group.id] = true;

      var container = root.querySelector('[data-group-id="' + group.id + '"]');
      if (!container) {
        container = document.createElement('div');
        container.className = 'layout-group';
        container.setAttribute('data-group-id', group.id);
        root.appendChild(container);
      }

      // Only touch the DOM tree when membership/flow actually changed —
      // re-applying for a position drag must not churn module nodes
      // (reparenting re-fires custom-element connect callbacks).
      var key = _structureKey(group);
      if (container.getAttribute('data-structure') !== key) {
        _buildGroupChildren(container, group);
        container.setAttribute('data-structure', key);
      }
      _position(container, group, scale, baseEdge);
    });

    // Drop containers whose group disappeared.
    Array.prototype.slice.call(root.children).forEach(function (container) {
      var id = container.getAttribute('data-group-id');
      if (!wanted[id]) container.remove();
    });
    _reconcileOrphans();

    _observeResizes(root);
    _scheduleMetricsReport();
    return true;
  }

  /** Put every module back at its original DOM spot and drop v2 state. */
  function restore() {
    if (!_active && !Object.keys(_adopted).length) return;
    Object.keys(_adopted).forEach(_restoreModule);
    var root = document.getElementById('layoutV2Root');
    if (root) root.remove();
    document.body.classList.remove('layout-v2-active');
    if (_resizeObserver) { _resizeObserver.disconnect(); _resizeObserver = null; }
    _active = false;
    _lastLayout = null;
  }

  function isActive() { return _active; }

  /** Re-apply the current layout with a new zoom (legacy applyZoom delegates here). */
  function setZoom(zoomVal) {
    if (!_active || !_lastLayout) return false;
    _lastOpts = _lastOpts || {};
    _lastOpts.zoom = zoomVal;
    return apply(_lastLayout, _lastOpts);
  }

  // ── Registry plumbing ────────────────────────────────────────────

  function setRegistry(registry) {
    if (!registry || !Array.isArray(registry.modules)) return;
    _registry = registry;
    if (_pending) {
      var p = _pending;
      _pending = null;
      apply(p.layout, p.opts);
    }
  }

  // In the Electron shell the registry arrives over IPC; in a plain
  // browser (Playwright) tests inject it via setRegistry directly.
  if (window.k10 && typeof window.k10.getLayoutRegistry === 'function') {
    window.k10.getLayoutRegistry().then(function (reg) {
      if (reg) setRegistry(reg);
    }).catch(function () { /* old main process — legacy path keeps working */ });
  }

  // Group targets are derived from the viewport, so a window resize
  // (display-metrics change re-asserting overlay bounds) invalidates
  // every position. Debounced re-apply of the last layout.
  var _resizeTimer = null;
  window.addEventListener('resize', function () {
    if (!_active || !_lastLayout) return;
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(function () {
      if (_active && _lastLayout) apply(_lastLayout, _lastOpts);
    }, 100);
  });

  // ── Metrics channel ──────────────────────────────────────────────
  // Observed geometry for the host editor's pixel-exact proxies. All
  // values are VISUAL px (post-zoom getBoundingClientRect). Written to
  // the overlay-metrics.json sidecar by the main process — never into
  // overlay-settings.json (one writer per file).

  function measure() {
    var out = {
      version: 2,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      zoom: _lastOpts && _lastOpts.zoom ? (_lastOpts.zoom / 100) : 1,
      modules: {},
      groups: {},
    };
    if (_registry && _registry.modules) {
      _registry.modules.forEach(function (m) {
        var el = m.id && (_adopted[m.id] || (m.selector && document.querySelector(m.selector)));
        if (!el) return;
        var r = el.getBoundingClientRect();
        if (r.width || r.height) out.modules[m.id] = { w: r.width, h: r.height };
      });
    }
    var root = document.getElementById('layoutV2Root');
    if (root) {
      Array.prototype.slice.call(root.children).forEach(function (container) {
        var id = container.getAttribute('data-group-id');
        var r = container.getBoundingClientRect();
        if (id) out.groups[id] = { x: r.x, y: r.y, w: r.width, h: r.height };
      });
    }
    return out;
  }

  function _scheduleMetricsReport() {
    if (!window.k10 || typeof window.k10.reportLayoutMetrics !== 'function') return;
    clearTimeout(_metricsTimer);
    _metricsTimer = setTimeout(function () {
      try { window.k10.reportLayoutMetrics(measure()); } catch (e) { /* non-fatal */ }
    }, 500);
  }

  function _observeResizes(root) {
    if (typeof ResizeObserver !== 'function') return;
    if (_resizeObserver) _resizeObserver.disconnect();
    _resizeObserver = new ResizeObserver(function () { _scheduleMetricsReport(); });
    Array.prototype.slice.call(root.children).forEach(function (c) {
      _resizeObserver.observe(c);
    });
  }

  window.K10LayoutV2 = {
    apply: apply,
    restore: restore,
    isActive: isActive,
    setZoom: setZoom,
    setRegistry: setRegistry,
    measure: measure,
  };
})();
