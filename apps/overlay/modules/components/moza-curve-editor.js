// ═══════════════════════════════════════════════════════════════
// MOZA CURVE EDITOR
// Reusable 5-point response curve editor for pedals and handbrake.
// Hardware uses Y values at 20/40/60/80/100% input positions.
// Renders a canvas with grid, diagonal reference, draggable points,
// and linear interpolation between control points.
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  var POINT_RADIUS = 6;
  var POINT_HIT_RADIUS = 14;
  var GRID_COLOR = 'rgba(255, 255, 255, 0.06)';
  var DIAG_COLOR = 'rgba(255, 255, 255, 0.04)';
  var POINT_BORDER = 'rgba(0, 0, 0, 0.4)';

  // Fixed X positions for the 5 control points (0.2, 0.4, 0.6, 0.8, 1.0)
  var FIXED_X = [0.2, 0.4, 0.6, 0.8, 1.0];

  /**
   * MozaCurveEditor — interactive 5-point curve editor
   *
   * @param {HTMLCanvasElement} canvas — target canvas element
   * @param {Object} opts
   * @param {string} opts.color — curve color (hex or CSS color)
   * @param {string} opts.label — axis label (e.g. "Throttle")
   * @param {Function} opts.onCurveChange — callback(points: number[]) when user edits
   */
  function MozaCurveEditor(canvas, opts) {
    opts = opts || {};
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.color = opts.color || '#4CAF50';
    this.label = opts.label || '';
    this.onCurveChange = opts.onCurveChange || null;

    // 5 Y values (0–100) at the fixed X positions
    // Default = linear (20, 40, 60, 80, 100)
    this.points = [20, 40, 60, 80, 100];

    this._dragging = -1; // index of point being dragged, -1 = none
    this._hovered = -1;
    this._padding = { top: 8, right: 8, bottom: 8, left: 8 };

    this._bindEvents();
    this._resize();
    this.render();
  }

  MozaCurveEditor.prototype._resize = function () {
    var rect = this.canvas.getBoundingClientRect();
    var w = Math.round(rect.width) || 200;
    var h = Math.round(rect.height) || 140;
    var dpr = window.devicePixelRatio || 1;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._w = w;
    this._h = h;
  };

  MozaCurveEditor.prototype._plotX = function (frac) {
    var p = this._padding;
    return p.left + frac * (this._w - p.left - p.right);
  };

  MozaCurveEditor.prototype._plotY = function (val) {
    // val 0–100, 0 = bottom, 100 = top
    var p = this._padding;
    var plotH = this._h - p.top - p.bottom;
    return p.top + (1 - val / 100) * plotH;
  };

  MozaCurveEditor.prototype._canvasToValue = function (clientX, clientY) {
    var rect = this.canvas.getBoundingClientRect();
    var p = this._padding;
    var y = clientY - rect.top;
    var plotH = this._h - p.top - p.bottom;
    var val = (1 - (y - p.top) / plotH) * 100;
    return Math.max(0, Math.min(100, Math.round(val)));
  };

  MozaCurveEditor.prototype._hitTest = function (clientX, clientY) {
    var rect = this.canvas.getBoundingClientRect();
    var mx = clientX - rect.left;
    var my = clientY - rect.top;

    for (var i = 0; i < 5; i++) {
      var px = this._plotX(FIXED_X[i]);
      var py = this._plotY(this.points[i]);
      var dx = mx - px;
      var dy = my - py;
      if (dx * dx + dy * dy <= POINT_HIT_RADIUS * POINT_HIT_RADIUS) {
        return i;
      }
    }
    return -1;
  };

  MozaCurveEditor.prototype._bindEvents = function () {
    var self = this;

    this.canvas.addEventListener('mousedown', function (e) {
      var idx = self._hitTest(e.clientX, e.clientY);
      if (idx >= 0) {
        self._dragging = idx;
        e.preventDefault();
      }
    });

    this.canvas.addEventListener('mousemove', function (e) {
      if (self._dragging >= 0) {
        self.points[self._dragging] = self._canvasToValue(e.clientX, e.clientY);
        self.render();
        e.preventDefault();
      } else {
        var idx = self._hitTest(e.clientX, e.clientY);
        if (idx !== self._hovered) {
          self._hovered = idx;
          self.canvas.style.cursor = idx >= 0 ? 'grab' : 'crosshair';
          self.render();
        }
      }
    });

    var onUp = function () {
      if (self._dragging >= 0) {
        self._dragging = -1;
        self.canvas.style.cursor = 'crosshair';
        if (self.onCurveChange) {
          self.onCurveChange(self.points.slice());
        }
      }
    };
    this.canvas.addEventListener('mouseup', onUp);
    this.canvas.addEventListener('mouseleave', function () {
      self._hovered = -1;
      onUp();
      self.render();
    });

    // Touch support
    this.canvas.addEventListener('touchstart', function (e) {
      var touch = e.touches[0];
      var idx = self._hitTest(touch.clientX, touch.clientY);
      if (idx >= 0) {
        self._dragging = idx;
        e.preventDefault();
      }
    }, { passive: false });

    this.canvas.addEventListener('touchmove', function (e) {
      if (self._dragging >= 0) {
        var touch = e.touches[0];
        self.points[self._dragging] = self._canvasToValue(touch.clientX, touch.clientY);
        self.render();
        e.preventDefault();
      }
    }, { passive: false });

    this.canvas.addEventListener('touchend', function () {
      if (self._dragging >= 0) {
        self._dragging = -1;
        if (self.onCurveChange) {
          self.onCurveChange(self.points.slice());
        }
      }
    });
  };

  MozaCurveEditor.prototype.setCurve = function (points) {
    if (!Array.isArray(points) || points.length !== 5) return;
    this.points = points.map(function (v) { return Math.max(0, Math.min(100, Math.round(v))); });
    this.render();
  };

  MozaCurveEditor.prototype.getCurve = function () {
    return this.points.slice();
  };

  MozaCurveEditor.prototype.render = function () {
    var ctx = this.ctx;
    var w = this._w;
    var h = this._h;
    var p = this._padding;

    ctx.clearRect(0, 0, w, h);

    // ── Grid lines ──
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    for (var i = 0; i <= 4; i++) {
      var frac = (i + 1) * 0.2;
      // Vertical
      var gx = this._plotX(frac);
      ctx.beginPath();
      ctx.moveTo(gx, p.top);
      ctx.lineTo(gx, h - p.bottom);
      ctx.stroke();
      // Horizontal
      var gy = this._plotY(frac * 100);
      ctx.beginPath();
      ctx.moveTo(p.left, gy);
      ctx.lineTo(w - p.right, gy);
      ctx.stroke();
    }

    // ── Diagonal reference (linear) ──
    ctx.strokeStyle = DIAG_COLOR;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(this._plotX(0), this._plotY(0));
    ctx.lineTo(this._plotX(1), this._plotY(100));
    ctx.stroke();
    ctx.setLineDash([]);

    // ── Curve path ──
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    // Start from origin (0, 0)
    ctx.moveTo(this._plotX(0), this._plotY(0));
    for (var j = 0; j < 5; j++) {
      ctx.lineTo(this._plotX(FIXED_X[j]), this._plotY(this.points[j]));
    }
    ctx.stroke();

    // ── Fill under curve ──
    ctx.fillStyle = this.color.replace(')', ', 0.08)').replace('rgb(', 'rgba(');
    // Try to create a semi-transparent fill
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.moveTo(this._plotX(0), this._plotY(0));
    for (var k = 0; k < 5; k++) {
      ctx.lineTo(this._plotX(FIXED_X[k]), this._plotY(this.points[k]));
    }
    ctx.lineTo(this._plotX(1), h - p.bottom);
    ctx.lineTo(this._plotX(0), h - p.bottom);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    // ── Control points ──
    for (var m = 0; m < 5; m++) {
      var px = this._plotX(FIXED_X[m]);
      var py = this._plotY(this.points[m]);
      var isActive = m === this._dragging || m === this._hovered;

      ctx.fillStyle = isActive ? '#fff' : this.color;
      ctx.strokeStyle = POINT_BORDER;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, isActive ? POINT_RADIUS + 1 : POINT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Value label on active point
      if (isActive) {
        ctx.fillStyle = '#fff';
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(this.points[m] + '%', px, py - 12);
      }
    }

    // ── Axis label ──
    if (this.label) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.font = '9px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(this.label.toUpperCase(), p.left + 2, p.top + 10);
    }
  };

  // Export globally
  window.MozaCurveEditor = MozaCurveEditor;
})();
