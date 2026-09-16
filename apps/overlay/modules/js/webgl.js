// WebGL FX ENGINE

  // ═══════════════════════════════════════════════════════════════
  //  WebGL FX ENGINE — Tachometer + Post-Processing
  // ═══════════════════════════════════════════════════════════════
  (function initWebGLFX() {
    'use strict';

    /* ── GL helpers ── */
    function createShader(gl, type, src) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.warn('Shader compile:', gl.getShaderInfoLog(s));
        gl.deleteShader(s); return null;
      }
      return s;
    }
    function createProgram(gl, vs, fs) {
      const p = gl.createProgram();
      gl.attachShader(p, vs); gl.attachShader(p, fs);
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        console.warn('Program link:', gl.getProgramInfoLog(p));
        return null;
      }
      return p;
    }
    function initGL(canvasId) {
      const c = document.getElementById(canvasId);
      if (!c) return null;
      const gl = c.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: true });
      if (!gl) { console.warn('WebGL2 not available for', canvasId); return null; }
      return { canvas: c, gl };
    }
    function resizeCanvas(canvas, gl) {
      const r = canvas.parentElement.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(r.width * dpr);
      const h = Math.round(r.height * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    }
    /** Half-DPR variant for glare canvases — trades sharpness for performance */
    function resizeCanvasHalfDPR(canvas, gl) {
      const r = canvas.parentElement.getBoundingClientRect();
      const dpr = Math.max((window.devicePixelRatio || 1) * 0.5, 1);
      const w = Math.round(r.width * dpr);
      const h = Math.round(r.height * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    }

    /* ════════════════════════════════════════════
       TACHOMETER FX — bloom, heat distortion
       ════════════════════════════════════════════ */
    const tachoCtx = initGL('tachoGlCanvas');
    let _tachoRpm = 0;  // updated from main loop
    let _tachoTime = 0;

    if (tachoCtx) {
      const { canvas: tC, gl: tGL } = tachoCtx;

      // Full-screen quad vertex shader
      const quadVS = `#version 300 es
        in vec2 aPos;
        out vec2 vUV;
        void main() {
          vUV = aPos * 0.5 + 0.5;
          gl_Position = vec4(aPos, 0.0, 1.0);
        }`;

      // Tachometer fragment shader — bloom glow + heat distortion
      // uDPR compensates for HiDPI/Retina displays where the same UV-space
      // effect is spread over 2-4× more physical pixels, making glow appear dimmer.
      const tachoFS = `#version 300 es
        precision highp float;
        in vec2 vUV;
        out vec4 fragColor;

        uniform float uRpm;       // 0.0 - 1.0
        uniform float uTime;
        uniform vec2  uRes;
        uniform float uDPR;       // devicePixelRatio (1.0 on 1× screens, 2.0 on Retina)

        // Color zones: green < 0.55, yellow < 0.73, red < 0.91, redline >= 0.91
        vec3 rpmColor(float r) {
          if (r < 0.55) return vec3(0.18, 0.82, 0.34);  // green
          if (r < 0.73) return vec3(0.95, 0.75, 0.15);  // amber
          return vec3(0.92, 0.22, 0.20);                 // red
        }

        // Smooth noise for heat distortion
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
                     mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
        }

        void main() {
          vec2 uv = vUV;
          // Scale glow spread so it looks the same on 1× and 2× screens
          float dprScale = max(uDPR, 1.0);
          float dpr2 = dprScale * dprScale;  // quadratic — compensates for HiDPI area scaling

          // Heat distortion — only active at high RPM
          float heatIntensity = smoothstep(0.75, 0.95, uRpm) * 0.6 * dpr2;
          if (heatIntensity > 0.0) {
            float n1 = noise(uv * 8.0 + uTime * 3.0) * 2.0 - 1.0;
            float n2 = noise(uv * 6.0 - uTime * 2.5 + 50.0) * 2.0 - 1.0;
            uv += vec2(n1, n2) * heatIntensity * 0.012;
          }

          // Bloom glow — bar region is roughly bottom 35% of the block
          float barTop = 0.35;  // bars live in bottom portion
          float barY = smoothstep(0.0, barTop, uv.y);
          float inBar = 1.0 - barY;

          // Horizontal fill: how far the RPM lights extend
          float fillX = uRpm;
          float xDist = max(0.0, uv.x - fillX);
          // Softer falloff on HiDPI so bloom covers equivalent visual area
          float glowFalloff = exp(-xDist * (6.0 / dpr2)) * inBar;

          // Color based on the edge of the lit region
          vec3 col = rpmColor(uRpm);

          // Pulsing intensity at redline
          float pulse = 1.0;
          if (uRpm >= 0.91) {
            pulse = 0.85 + 0.15 * sin(uTime * 18.0);
          }

          // Bloom: soft glow radiating from lit segments — boosted on HiDPI
          float bloom = glowFalloff * uRpm * 1.2 * dpr2 * pulse;

          // Upward glow bleed above the bars
          float aboveBar = smoothstep(barTop, barTop + 0.3 * dpr2, uv.y);
          float upGlow = aboveBar * exp(-abs(uv.x - fillX * 0.5) * (3.0 / dpr2)) * uRpm * 0.35 * dpr2 * pulse;

          // Edge highlight along the top of lit region
          float edgeGlow = exp(-abs(uv.y - barTop) * (25.0 / dpr2)) * smoothstep(0.0, fillX, uv.x) * uRpm * 0.5 * dpr2;

          float alpha = bloom + upGlow + edgeGlow;
          vec3 final = col * alpha;

          // ── Redline full-block flash strobe ──
          if (uRpm >= 0.91) {
            float redStr = smoothstep(0.91, 0.96, uRpm);
            // Hard strobe
            float flash = pow(0.5 + 0.5 * sin(uTime * 22.0), 4.0);
            // Secondary faster flicker
            float flicker = 0.8 + 0.2 * sin(uTime * 55.0 + uv.x * 12.0);
            // Gentle vignette — even glow with soft falloff at edges
            float vig = 1.0 - 0.2 * length((uv - 0.5) * vec2(0.8, 1.4));
            float flashA = flash * flicker * redStr * vig * 0.5 * dpr2;
            vec3 flashCol = vec3(0.95, 0.08, 0.03);
            final += flashCol * flashA;
            alpha += flashA;
            // Scanline overlay for CRT intensity
            float scan = 0.88 + 0.12 * sin(uv.y * uRes.y * 0.4 + uTime * 45.0);
            final *= scan;
            alpha *= scan;
          }

          float maxAlpha = dprScale > 1.1 ? 0.95 : 0.85;
          alpha = clamp(alpha, 0.0, maxAlpha);
          fragColor = vec4(final * alpha, alpha);
        }`;

      const vs = createShader(tGL, tGL.VERTEX_SHADER, quadVS);
      const fs = createShader(tGL, tGL.FRAGMENT_SHADER, tachoFS);
      const prog = createProgram(tGL, vs, fs);

      if (prog) {
        const aPos = tGL.getAttribLocation(prog, 'aPos');
        const uRpm = tGL.getUniformLocation(prog, 'uRpm');
        const uTime = tGL.getUniformLocation(prog, 'uTime');
        const uRes = tGL.getUniformLocation(prog, 'uRes');
        const uDPR = tGL.getUniformLocation(prog, 'uDPR');

        // Fullscreen quad
        const buf = tGL.createBuffer();
        tGL.bindBuffer(tGL.ARRAY_BUFFER, buf);
        tGL.bufferData(tGL.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), tGL.STATIC_DRAW);

        tGL.enable(tGL.BLEND);
        tGL.blendFunc(tGL.ONE, tGL.ONE_MINUS_SRC_ALPHA);

        window._tachoFXFrame = function(dt) {
          resizeCanvas(tC, tGL);
          _tachoTime += dt;

          tGL.clearColor(0, 0, 0, 0);
          tGL.clear(tGL.COLOR_BUFFER_BIT);

          // ── Main bloom/distortion pass ──
          tGL.useProgram(prog);
          tGL.bindBuffer(tGL.ARRAY_BUFFER, buf);
          tGL.enableVertexAttribArray(aPos);
          tGL.vertexAttribPointer(aPos, 2, tGL.FLOAT, false, 0, 0);
          tGL.uniform1f(uRpm, _tachoRpm);
          tGL.uniform1f(uTime, _tachoTime);
          tGL.uniform2f(uRes, tC.width, tC.height);
          tGL.uniform1f(uDPR, window.devicePixelRatio || 1.0);
          tGL.drawArrays(tGL.TRIANGLE_STRIP, 0, 4);
        };
      }
    }

    /* ════════════════════════════════════════════
       PEDAL VALUES — shared state used by postfx pipeline
       (histogram bars are now rendered as HTML/CSS in webgl-helpers.js)
       ════════════════════════════════════════════ */
    let _pedalValues = { thr: 0, brk: 0, clt: 0 };

    /* ════════════════════════════════════════════
       POST-PROCESSING PIPELINE — panel-masked effects
       Single GL context, one draw call. Renders at half DPR.
       ALL effects are masked to panel boundaries so nothing
       bleeds onto the game footage.

       Effects:
         1. Panel edge glow (per-source registry, up to 8)
         2. G-force vignette (lateral + longitudinal darkening)
         3. Speed chromatic aberration (RGB split near panels)
         4. Brake heat wash (warm bloom from brake zone)
         5. RPM redline pulse (panel-edge red flicker)
       ════════════════════════════════════════════ */
    let _postfxTime = 0;

    // ══════════════════════════════════════════════════════════════
    //  PERFORMANCE INSTRUMENTATION — glare shader perf tracking
    // ══════════════════════════════════════════════════════════════
    //  Measures:
    //    • FPS (frames per second, 1s rolling window)
    //    • Frame time (ms per glare draw call, via EXT_disjoint_timer_query)
    //    • Draw call skip rate (% of frames where glare had nothing to draw)
    //
    //  Access from console:  window._glarePerf
    //  Logs a summary every 5 seconds when ambient light is active.
    // ══════════════════════════════════════════════════════════════
    const _glarePerf = {
      fps: 0,
      frameTimeMs: 0,           // GPU time per glare draw (0 if timer unavailable)
      drawCalls: 0,
      skippedFrames: 0,
      totalFrames: 0,
      _frameTimes: [],          // last 60 frame timestamps for FPS calc
      _gpuQueries: [],          // pending GPU timer queries
      _timerExt: null,          // EXT_disjoint_timer_query_webgl2
      _lastLogSec: 0,
      _enabled: false,

      /** Call once after GL context is ready */
      init(gl) {
        // Try to get GPU timer extension (available on most Windows drivers)
        this._timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
        if (this._timerExt) {
          console.log('[GlarePerf] GPU timer query available — frame timing enabled');
        } else {
          console.log('[GlarePerf] GPU timer query unavailable — FPS-only mode');
        }
        this._enabled = true;
      },

      /** Call at the START of each glare frame */
      beginFrame(gl) {
        if (!this._enabled) return null;
        this.totalFrames++;

        // FPS: rolling 1-second window
        const now = performance.now();
        this._frameTimes.push(now);
        while (this._frameTimes.length > 0 && this._frameTimes[0] < now - 1000) {
          this._frameTimes.shift();
        }
        this.fps = this._frameTimes.length;

        // GPU timer: start query if extension available
        if (this._timerExt) {
          const query = gl.createQuery();
          gl.beginQuery(this._timerExt.TIME_ELAPSED_EXT, query);
          return query;
        }
        return null;
      },

      /** Call at the END of each glare frame */
      endFrame(gl, query) {
        if (!this._enabled) return;
        this.drawCalls++;

        if (query && this._timerExt) {
          gl.endQuery(this._timerExt.TIME_ELAPSED_EXT);
          this._gpuQueries.push({ query, time: performance.now() });
        }

        // Harvest completed GPU queries
        this._harvestQueries(gl);

        // Log every 5 seconds
        const sec = Math.floor(performance.now() / 1000);
        if (sec % 5 === 0 && sec !== this._lastLogSec) {
          this._lastLogSec = sec;
          const skipPct = this.totalFrames > 0
            ? ((this.skippedFrames / this.totalFrames) * 100).toFixed(1)
            : '0.0';
          console.log(
            `[GlarePerf] FPS=${this.fps} | GPU=${this.frameTimeMs.toFixed(2)}ms | ` +
            `draws=${this.drawCalls} skipped=${skipPct}% | ` +
            `ambient=${window._ambientGL ? window._ambientGL.lum.toFixed(2) : 'off'}`
          );
        }
      },

      /** Mark a frame as skipped (no draw call needed) */
      markSkipped() {
        if (!this._enabled) return;
        this.totalFrames++;
        this.skippedFrames++;

        // Still update FPS counter
        const now = performance.now();
        this._frameTimes.push(now);
        while (this._frameTimes.length > 0 && this._frameTimes[0] < now - 1000) {
          this._frameTimes.shift();
        }
        this.fps = this._frameTimes.length;
      },

      /** Harvest completed GPU timer queries */
      _harvestQueries(gl) {
        const ext = this._timerExt;
        if (!ext) return;
        // Check for GPU disjoint (driver reset, etc.)
        const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
        const pending = this._gpuQueries;
        let i = 0;
        while (i < pending.length) {
          const q = pending[i];
          const available = gl.getQueryParameter(q.query, gl.QUERY_RESULT_AVAILABLE);
          if (available) {
            if (!disjoint) {
              const ns = gl.getQueryParameter(q.query, gl.QUERY_RESULT);
              this.frameTimeMs = ns / 1e6;  // nanoseconds → milliseconds
            }
            gl.deleteQuery(q.query);
            pending.splice(i, 1);
          } else if (performance.now() - q.time > 2000) {
            // Stale query — drop it
            gl.deleteQuery(q.query);
            pending.splice(i, 1);
          } else {
            i++;
          }
        }
      },

      /** Get a summary snapshot for external consumption */
      snapshot() {
        return {
          fps: this.fps,
          gpuMs: this.frameTimeMs,
          drawCalls: this.drawCalls,
          skippedPct: this.totalFrames > 0
            ? ((this.skippedFrames / this.totalFrames) * 100)
            : 0,
          totalFrames: this.totalFrames,
        };
      }
    };
    window._glarePerf = _glarePerf;

    // Smoothed telemetry for post-processing
    const _pfx = {
      speed: 0, speedTarget: 0,
      rpm: 0, rpmTarget: 0,
      latG: 0, latGTarget: 0,
      longG: 0, longGTarget: 0,
      brakeHeat: 0,
      yawRate: 0, yawRateTarget: 0,
      steer: 0, steerTarget: 0,
    };
    // Expose for CSS-only plastic mode (ambient-light.js reads these)
    window._pfx = _pfx;
    const _pfxLerp = { speed: 3.0, rpm: 8.0, latG: 5.0, longG: 5.0, yawRate: 4.0, steer: 6.0 };

    /** Resize a full-screen canvas at half DPR for soft effects */
    function resizeCanvasScreen(canvas, gl) {
      const dpr = Math.max((window.devicePixelRatio || 1) * 0.5, 1);
      const w = Math.round(window.innerWidth * dpr);
      const h = Math.round(window.innerHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    }

    const glareCtx = initGL('glareCanvas');
    if (glareCtx) {
      const { canvas: gC, gl: gGL } = glareCtx;

      const quadVS = `#version 300 es
        in vec2 aPos;
        out vec2 vUV;
        void main() {
          vUV = aPos * 0.5 + 0.5;
          gl_Position = vec4(aPos, 0.0, 1.0);
        }`;

      // ── Post-processing fragment shader ──
      // All effects masked to panel rects — nothing escapes onto the game.
      const postfxFS = `#version 300 es
        precision highp float;
        in vec2 vUV;
        out vec4 fragColor;

        // Panel glow sources (pedals, etc.)
        uniform float uTime;
        uniform vec4  uRect[8];      // glow source rects
        uniform vec4  uColor[8];     // glow source colors
        uniform int   uCount;        // active glow sources

        // Panel mask rects (ALL visible panels)
        uniform vec4  uPanelRect[16];
        uniform float uPanelAlpha[16]; // computed opacity per panel
        uniform vec2  uPanelRadius[16]; // border-radius in UV space (rx, ry)
        uniform int   uPanelCount;

        // Telemetry
        uniform float uSpeed;
        uniform float uRpm;
        uniform float uLatG;
        uniform float uLongG;
        uniform float uBrakeHeat;
        uniform float uYawRate;
        uniform float uSteer;   // steering wheel angle, -1..+1 (negative=left)

        // Ambient light (from Electron screen capture)
        uniform vec3  uAmbientColor;  // 0-1 RGB
        uniform float uAmbientLum;    // perceptual luminance 0-1
        uniform int   uAmbientMode;   // 0=off, 1=matte, 2=reflective

        // ── Rounded-rect SDF — negative inside, positive outside ──
        float roundedRectSDF(vec2 uv, vec4 rect, vec2 radius) {
          vec2 center = rect.xy + rect.zw * 0.5;
          vec2 halfSize = rect.zw * 0.5;
          vec2 d = abs(uv - center) - halfSize + radius;
          return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - min(radius.x, radius.y);
        }

        // ── Panel mask: 0.0 outside all panels, panel opacity inside ──
        // Uses rounded-rect SDF so glare edges match CSS border-radius.
        // Respects each panel's computed CSS opacity.
        float panelMask(vec2 uv) {
          float mask = 0.0;
          for (int i = 0; i < 16; i++) {
            if (i >= uPanelCount) break;
            vec4 r = uPanelRect[i];
            vec2 rad = uPanelRadius[i];
            float sdf = roundedRectSDF(uv, r, rad);
            float fw = fwidth(sdf);  // 1-pixel feather, DPR-independent
            float m = 1.0 - smoothstep(-fw, fw, sdf);
            m *= uPanelAlpha[i];
            mask = max(mask, m);
          }
          return mask;
        }

        float pulse(float t, float speed, float base) {
          return base + (1.0 - base) * (0.5 + 0.5 * sin(t * speed * 0.6));
        }

        // ── AMBIENT GLOW — single centered radial, panel-masked ──
        // ── Steer-rotated UV helper ──
        // Rotates UV around a center point by -uSteer (inverted: glare moves
        // opposite the wheel).  ±1 → ∓0.25 rad ≈ ∓14°.
        // PERF-LITE: rotation reduced 75% (0.25 → 0.0625 rad ≈ ±3.6°)
        vec2 steerRotateUV(vec2 uv, vec2 center) {
          float a = -uSteer * 0.0625;
          float cs = cos(a), sn = sin(a);
          vec2 d = uv - center;
          return vec2(d.x * cs - d.y * sn, d.x * sn + d.y * cs) + center;
        }

        // ── PERF-LITE: single centered radial glow + sweep only ──
        // Removed: shimmer (sin×sin pow4), edgeBloom (duplicate panelMask loop).
        // Kept: center glow, bloom pulse, light sweep — enough to sell
        // sun/cloud movement across glass surfaces.
        vec4 ambientGlow(vec2 uv) {
          if (uAmbientMode == 0 || uAmbientLum < 0.01) return vec4(0.0);
          float modeMul = (uAmbientMode == 1) ? 0.5 : 1.0;

          // Speed scales movement: idle ×0.075, full speed ×0.5 (75% slower)
          float spdMul = 0.075 + uSpeed * 0.425;

          // Single radial glow from screen center
          vec2 center = vec2(0.5, 0.45);
          float dist = length(uv - center);
          float glow = exp(-dist * dist * 1.8) * 2.0;

          // Bloom pulse: slow breathing
          float bloom = 0.8 + 0.2 * sin(uTime * 1.5 * spdMul);
          glow *= bloom;

          // Steer-rotated UV for sweep (rotation at 25% of original)
          vec2 rUV = steerRotateUV(uv, center);

          // Light sweep: diagonal band simulating sun/cloud movement
          float sweep = sin(rUV.x * 2.0 + rUV.y * 1.3 - uTime * 0.2 * spdMul) * 0.5 + 0.5;
          sweep = pow(sweep, 3.0) * 0.7;

          float total = (glow + sweep) * uAmbientLum * modeMul;
          total = min(total, 2.5);

          vec3 col = uAmbientColor * total;
          float alpha = total * 0.8;
          return vec4(col, clamp(alpha, 0.0, 1.0));
        }

        // EFFECT 1: Panel glow — top-edge reflective source
        // Light originates from the top-center of each panel
        // and falls off downward, like overhead light hitting glass.
        vec4 panelGlow(vec2 uv) {
          vec3 col = vec3(0.0);
          float alpha = 0.0;
          for (int i = 0; i < 8; i++) {
            if (i >= uCount) break;
            vec4 rect = uRect[i];
            vec4 clr  = uColor[i];
            float inten = clr.a;
            if (inten < 0.01) continue;

            // Glow source: top-center of panel, 20% down from top edge
            vec2 src = vec2(rect.x + rect.z * 0.5, rect.y + rect.w * 0.20);

            // Steer-rotate UV around panel center so light tilts opposite the wheel
            vec2 panelCenter = rect.xy + rect.zw * 0.5;
            vec2 sUV = steerRotateUV(uv, panelCenter);

            // Elliptical falloff: wider horizontally, tighter vertically
            vec2 delta = sUV - src;
            delta.x /= max(rect.z * 0.7, 0.01);  // scale by panel width
            delta.y /= max(rect.w * 0.5, 0.01);   // tighter vertical
            float dist = length(delta);

            // Downward bias: glow falls toward bottom of panel (uses rotated UV)
            float downBias = smoothstep(rect.y, rect.y + rect.w, sUV.y);
            float spread = 3.0;
            float glow = exp(-dist * dist * spread) * inten;
            // Brighter at top, dimmer toward bottom
            glow *= mix(1.0, 0.3, downBias);

            // PERF-LITE: pulse speed reduced 75% (3.5→0.875, 2.0→0.5)
            float p = pulse(uTime, 0.875 + inten * 0.5, 0.88);
            glow *= p;

            col += clr.rgb * glow * 0.9;
            alpha += glow * 0.4;
          }
          return vec4(col, clamp(alpha, 0.0, 0.70));
        }

        // EFFECT 2: G-force vignette (masked to panels)
        vec4 gForceVignette(vec2 uv) {
          float totalG = length(vec2(uLatG, uLongG));
          if (totalG < 0.3) return vec4(0.0);
          float gIntensity = smoothstep(0.3, 3.0, totalG);
          vec2 center = vec2(0.5);
          float dist = length(uv - center) * 1.4;
          float vig = smoothstep(0.3, 1.0, dist);
          vec2 bias = vec2(-uLatG * 0.15, uLongG * 0.12);
          float biasedDist = length(uv - center + bias) * 1.4;
          float biasedVig = smoothstep(0.25, 1.0, biasedDist);
          float finalVig = max(vig, biasedVig) * gIntensity * 0.35;
          vec3 tint = mix(
            vec3(0.02, 0.03, 0.06),
            vec3(0.06, 0.02, 0.01),
            smoothstep(0.0, 1.5, abs(uLongG))
          );
          return vec4(tint, finalVig);
        }

        // EFFECT 3: Speed chromatic aberration — REMOVED for performance
        // (dual pow(sin) streaks + steer rotation per pixel, rarely visible)
        vec4 speedAberration(vec2 uv) { return vec4(0.0); }

        // EFFECT 4: Brake heat wash — REMOVED for performance
        // (double sin×sin shimmer per pixel, niche visual)
        vec4 brakeHeatWash(vec2 uv) { return vec4(0.0); }

        // EFFECT 5: RPM redline pulse
        vec4 rpmRedlinePulse(vec2 uv) {
          if (uRpm < 0.88) return vec4(0.0);
          float rpmIntensity = smoothstep(0.88, 0.98, uRpm);
          float strobe = 1.0;
          if (uRpm > 0.95) {
            strobe = 0.6 + 0.4 * abs(sin(uTime * 18.0));
          }
          // Edge glow relative to nearby panel edges
          float edgeDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
          float edgeGlow = exp(-edgeDist * 30.0);
          float alpha = edgeGlow * rpmIntensity * strobe * 0.40;
          vec3 col = vec3(0.95, 0.10, 0.05);
          return vec4(col * alpha, alpha);
        }

        // ── Spherical glass reflection per panel ──
        // Each module has a convex glass dome surface that catches a specular
        // highlight from an overhead light source, shifted by steering angle.
        // Dome height scales with ambient mode: full in reflective, 50% in matte.
        vec4 glassReflection(vec2 uv) {
          if (uAmbientMode == 0 || uAmbientLum < 0.005) return vec4(0.0);

          // Dome height: reflective=1.0, matte=0.5
          float domeScale = (uAmbientMode == 1) ? 0.5 : 1.0;

          // Light source: overhead, slightly shifted by steering
          vec3 lightDir = normalize(vec3(
            -0.15 + uSteer * 0.12,   // x: steer shifts highlight
            -0.3,                     // y: slightly above center
            1.0                       // z: toward viewer
          ));

          vec3 totalCol = vec3(0.0);
          float totalAlpha = 0.0;

          for (int i = 0; i < 16; i++) {
            if (i >= uPanelCount) break;
            vec4 r = uPanelRect[i];
            if (r.z < 0.001 || r.w < 0.001) continue;

            // Normalize UV within this panel
            vec2 local = (uv - r.xy) / r.zw;
            if (local.x < 0.0 || local.x > 1.0 || local.y < 0.0 || local.y > 1.0) continue;

            // SDF-based soft edge (reuse panel SDF for feathering)
            float sdf = roundedRectSDF(uv, r, uPanelRadius[i]);
            float fw = fwidth(sdf);
            float inside = smoothstep(fw, -fw * 2.0, sdf);
            if (inside < 0.001) continue;

            // Map local coords to box-shaped dome surface normal
            // The dome fills the entire panel rect, curving down at edges
            vec2 centered = local - 0.5;  // -0.5..+0.5

            // Box dome: use rounded-rect distance instead of circular
            // Panel border-radius in local 0-1 space
            vec2 panelRLocal = uPanelRadius[i] / r.zw;
            // SDF of a rounded rect in local space (0 at boundary, negative inside)
            vec2 q = abs(centered) - (0.5 - panelRLocal);
            float boxSdf = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - min(panelRLocal.x, panelRLocal.y);
            // Map to 0 at center, 1 at panel edge
            float edgeDist = smoothstep(-0.5, 0.0, boxSdf);

            // Dome height: 1 at center, 0 at edges (box-shaped falloff)
            float z = (1.0 - edgeDist) * domeScale;
            if (z < 0.001) continue;

            // Surface normal: gradient of the dome height
            // Approximate partial derivatives from the box SDF
            vec2 grad = centered * 2.0;  // base gradient pointing outward
            // Steepen near edges using the box shape
            float edgeSteep = smoothstep(0.3, 0.5, max(abs(centered.x), abs(centered.y)));
            grad *= (1.0 + edgeSteep * 3.0);
            vec3 normal = normalize(vec3(-grad, z));

            // Specular: Blinn-Phong only (Fresnel rim + caustic shimmer removed)
            vec3 viewDir = vec3(0.0, 0.0, 1.0);
            vec3 halfVec = normalize(lightDir + viewDir);
            float spec = pow(max(dot(normal, halfVec), 0.0), 32.0 * domeScale + 8.0);

            vec3 specCol = mix(vec3(1.0), uAmbientColor * 1.5 + 0.5, 0.3);
            float intensity = spec * 0.3 * uAmbientLum * domeScale;

            float a = clamp(intensity * inside * uPanelAlpha[i], 0.0, 0.5);
            totalCol += specCol * a;
            totalAlpha += a;
          }

          totalAlpha = clamp(totalAlpha, 0.0, 0.6);
          return vec4(totalCol, totalAlpha);
        }

        void main() {
          vec2 uv = vUV;
          uv.y = 1.0 - uv.y;

          // Panel mask — 0.0 outside all panels, 1.0 inside
          float mask = panelMask(uv);
          if (mask < 0.001) { fragColor = vec4(0.0); return; }

          // Layer all effects
          vec4 ambient  = ambientGlow(uv);
          vec4 glass    = glassReflection(uv);
          vec4 glow     = panelGlow(uv);
          vec4 vignette = gForceVignette(uv);
          vec4 aberr    = speedAberration(uv);
          vec4 heat     = brakeHeatWash(uv);
          vec4 redline  = rpmRedlinePulse(uv);

          // Additive composite
          vec3 col = vec3(0.0);
          float alpha = 0.0;

          // Glass dome: base layer (between module content and glare)
          col += glass.rgb;
          alpha += glass.a;

          // Ambient glow: on top of glass
          col += ambient.rgb;
          alpha += ambient.a;

          col += glow.rgb;
          alpha += glow.a;

          col = mix(col, col - vignette.rgb, vignette.a);
          alpha = max(alpha, vignette.a * 0.5);

          col += aberr.rgb;
          alpha += aberr.a;

          col += heat.rgb;
          alpha += heat.a;

          col += redline.rgb;
          alpha += redline.a;

          alpha = clamp(alpha, 0.0, 0.80);
          col = clamp(col, 0.0, 1.0);

          // Circular gradient mask — full intensity at center, 5% at screen edges
          float edgeRadius = length(uv - vec2(0.5)) / 0.7071; // 0 at center, 1 at corners
          float radialFade = mix(1.0, 0.05, smoothstep(0.0, 1.0, edgeRadius));
          alpha *= radialFade;

          // Apply panel mask
          alpha *= mask;
          fragColor = vec4(col * alpha, alpha);
        }`;

      const vs = createShader(gGL, gGL.VERTEX_SHADER, quadVS);
      const fs = createShader(gGL, gGL.FRAGMENT_SHADER, postfxFS);
      const prog = createProgram(gGL, vs, fs);

      if (prog) {
        const aPos   = gGL.getAttribLocation(prog, 'aPos');
        const uTime  = gGL.getUniformLocation(prog, 'uTime');
        const uCount = gGL.getUniformLocation(prog, 'uCount');
        const uRect = [], uColor = [];
        for (let i = 0; i < 8; i++) {
          uRect[i]  = gGL.getUniformLocation(prog, 'uRect[' + i + ']');
          uColor[i] = gGL.getUniformLocation(prog, 'uColor[' + i + ']');
        }
        // Panel mask uniforms
        const uPanelCount = gGL.getUniformLocation(prog, 'uPanelCount');
        const uPanelRect = [], uPanelAlpha = [], uPanelRadius = [];
        for (let i = 0; i < 16; i++) {
          uPanelRect[i]   = gGL.getUniformLocation(prog, 'uPanelRect[' + i + ']');
          uPanelAlpha[i]  = gGL.getUniformLocation(prog, 'uPanelAlpha[' + i + ']');
          uPanelRadius[i] = gGL.getUniformLocation(prog, 'uPanelRadius[' + i + ']');
        }
        // Telemetry uniforms
        const uSpeed     = gGL.getUniformLocation(prog, 'uSpeed');
        const uRpm       = gGL.getUniformLocation(prog, 'uRpm');
        const uLatG      = gGL.getUniformLocation(prog, 'uLatG');
        const uLongG     = gGL.getUniformLocation(prog, 'uLongG');
        const uBrakeHeat = gGL.getUniformLocation(prog, 'uBrakeHeat');
        const uYawRate   = gGL.getUniformLocation(prog, 'uYawRate');
        const uSteer     = gGL.getUniformLocation(prog, 'uSteer');
        // Ambient light uniforms
        const uAmbientColor = gGL.getUniformLocation(prog, 'uAmbientColor');
        const uAmbientLum   = gGL.getUniformLocation(prog, 'uAmbientLum');
        const uAmbientMode  = gGL.getUniformLocation(prog, 'uAmbientMode');

        const buf = gGL.createBuffer();
        gGL.bindBuffer(gGL.ARRAY_BUFFER, buf);
        gGL.bufferData(gGL.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gGL.STATIC_DRAW);

        gGL.enable(gGL.BLEND);
        gGL.blendFunc(gGL.ONE, gGL.ONE_MINUS_SRC_ALPHA);

        // ── Glow source registry ──
        const _glareSources = [];

        window.registerGlareSource = function(id, elementId, color, getIntensity) {
          const idx = _glareSources.findIndex(s => s.id === id);
          const source = { id, elementId, color, getIntensity };
          if (idx >= 0) _glareSources[idx] = source;
          else _glareSources.push(source);
        };

        window.removeGlareSource = function(id) {
          const idx = _glareSources.findIndex(s => s.id === id);
          if (idx >= 0) _glareSources.splice(idx, 1);
        };

        // Register pedal glare sources
        window.registerGlareSource('pedal-thr', 'pedalsArea',
          [0.10, 0.45, 0.08], function() { return _pedalValues.thr * 0.5; });
        window.registerGlareSource('pedal-brk', 'pedalsArea',
          [0.92, 0.22, 0.20], function() { return _pedalValues.brk * 0.5; });
        window.registerGlareSource('pedal-clt', 'pedalsArea',
          [0.25, 0.50, 0.92], function() { return _pedalValues.clt * 0.35; });

        // Panel rect caches (cleared each frame)
        const _rectCache = {};
        const PANEL_SELECTORS = '.panel, .tacho-block, .commentary-inner, .leaderboard-panel, .datastream-panel, .pitbox-panel, .incidents-panel, .spotter-panel';
        let _panelEls = null;

        function getPanelRectUV(elementId) {
          if (_rectCache[elementId]) return _rectCache[elementId];
          const el = document.getElementById(elementId);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          const vw = window.innerWidth, vh = window.innerHeight;
          const result = [r.left / vw, r.top / vh, r.width / vw, r.height / vh];
          _rectCache[elementId] = result;
          return result;
        }

        function getAllPanelRectsUV() {
          if (!_panelEls) _panelEls = document.querySelectorAll(PANEL_SELECTORS);
          const rects = [];
          const alphas = [];
          const radii = [];
          const vw = window.innerWidth, vh = window.innerHeight;
          for (let i = 0; i < _panelEls.length && rects.length < 16; i++) {
            const el = _panelEls[i];
            // Skip hidden panels
            if (el.offsetWidth === 0 || el.offsetHeight === 0) continue;
            const r = el.getBoundingClientRect();
            if (r.width < 2 || r.height < 2) continue;
            rects.push([r.left / vw, r.top / vh, r.width / vw, r.height / vh]);
            // Walk up the DOM to compute effective opacity (CSS opacity is inherited)
            let opacity = 1;
            let node = el;
            while (node && node !== document.body) {
              const o = parseFloat(getComputedStyle(node).opacity);
              if (o < 1) opacity *= o;
              node = node.parentElement;
            }
            alphas.push(opacity);
            // Border-radius in UV space for rounded-rect SDF
            const style = getComputedStyle(el);
            const brPx = parseFloat(style.borderRadius) || 0;
            radii.push([brPx / vw, brPx / vh]);
          }
          return { rects, alphas, radii };
        }

        // Smooth telemetry interpolation
        function lerpPFX(dt) {
          const p = _pfx;
          const lr = _pfxLerp;
          p.speed   += (p.speedTarget   - p.speed)   * Math.min(1, lr.speed   * dt);
          p.rpm     += (p.rpmTarget     - p.rpm)     * Math.min(1, lr.rpm     * dt);
          p.latG    += (p.latGTarget    - p.latG)    * Math.min(1, lr.latG    * dt);
          p.longG   += (p.longGTarget   - p.longG)   * Math.min(1, lr.longG   * dt);
          p.yawRate += (p.yawRateTarget - p.yawRate) * Math.min(1, lr.yawRate * dt);
          p.steer   += (p.steerTarget   - p.steer)   * Math.min(1, lr.steer   * dt);
          // Brake heat: accumulates during braking, slow decay
          const braking = Math.max(0, _pedalValues.brk);
          p.brakeHeat += braking * dt * 1.5;
          p.brakeHeat *= Math.exp(-dt * 0.6);
          p.brakeHeat = Math.min(p.brakeHeat, 1.0);
        }

        // Refresh panel element list periodically (panels may show/hide)
        let _panelRefreshCounter = 0;

        // Init perf instrumentation
        _glarePerf.init(gGL);

        window._glareFXFrame = function(dt) {
          _postfxTime += dt;
          lerpPFX(dt);

          // Refresh panel list every ~60 frames
          _panelRefreshCounter++;
          if (_panelRefreshCounter > 60) {
            _panelRefreshCounter = 0;
            _panelEls = null;
          }

          // Clear rect cache each frame
          for (const k in _rectCache) delete _rectCache[k];

          // Collect active glow sources (up to 8)
          let count = 0;
          const rects = [], colors = [];
          for (let i = 0; i < _glareSources.length && count < 8; i++) {
            const src = _glareSources[i];
            const inten = src.getIntensity();
            if (inten < 0.01) continue;
            const rect = getPanelRectUV(src.elementId);
            if (!rect) continue;
            rects.push(rect);
            colors.push([src.color[0], src.color[1], src.color[2], inten]);
            count++;
          }

          // Get all panel rects + opacities + border-radii for masking
          const { rects: panelRects, alphas: panelAlphas, radii: panelRadii } = getAllPanelRectsUV();

          const hasGlow    = count > 0;
          const hasAmbient = (window._ambientGL && window._ambientGL.lum > 0.01);
          // PERF-LITE: brakeHeat and speed aberration removed, only check
          // g-force vignette and RPM redline (the two remaining telemetry effects)
          const hasEffects = Math.abs(_pfx.latG) > 0.25 || Math.abs(_pfx.longG) > 0.25 ||
                             _pfx.rpm > 0.86;

          if (!hasGlow && !hasAmbient && !hasEffects) {
            if (gC.width > 0) {
              gGL.clearColor(0, 0, 0, 0);
              gGL.clear(gGL.COLOR_BUFFER_BIT);
            }
            _glarePerf.markSkipped();
            return;
          }

          // ── Perf: begin GPU timer ──
          const gpuQuery = _glarePerf.beginFrame(gGL);

          resizeCanvasScreen(gC, gGL);

          gGL.clearColor(0, 0, 0, 0);
          gGL.clear(gGL.COLOR_BUFFER_BIT);

          gGL.useProgram(prog);
          gGL.bindBuffer(gGL.ARRAY_BUFFER, buf);
          gGL.enableVertexAttribArray(aPos);
          gGL.vertexAttribPointer(aPos, 2, gGL.FLOAT, false, 0, 0);

          // Glow source uniforms
          gGL.uniform1f(uTime, _postfxTime);
          gGL.uniform1i(uCount, count);
          for (let i = 0; i < 8; i++) {
            if (i < count) {
              gGL.uniform4f(uRect[i], rects[i][0], rects[i][1], rects[i][2], rects[i][3]);
              gGL.uniform4f(uColor[i], colors[i][0], colors[i][1], colors[i][2], colors[i][3]);
            } else {
              gGL.uniform4f(uRect[i], 0, 0, 0, 0);
              gGL.uniform4f(uColor[i], 0, 0, 0, 0);
            }
          }

          // Panel mask uniforms (rects + per-panel opacity + border-radius)
          gGL.uniform1i(uPanelCount, panelRects.length);
          for (let i = 0; i < 16; i++) {
            if (i < panelRects.length) {
              gGL.uniform4f(uPanelRect[i], panelRects[i][0], panelRects[i][1], panelRects[i][2], panelRects[i][3]);
              gGL.uniform1f(uPanelAlpha[i], panelAlphas[i]);
              gGL.uniform2f(uPanelRadius[i], panelRadii[i][0], panelRadii[i][1]);
            } else {
              gGL.uniform4f(uPanelRect[i], 0, 0, 0, 0);
              gGL.uniform1f(uPanelAlpha[i], 0.0);
              gGL.uniform2f(uPanelRadius[i], 0, 0);
            }
          }

          // Telemetry uniforms
          gGL.uniform1f(uSpeed,     _pfx.speed);
          gGL.uniform1f(uRpm,       _pfx.rpm);
          gGL.uniform1f(uLatG,      _pfx.latG);
          gGL.uniform1f(uLongG,     _pfx.longG);
          gGL.uniform1f(uBrakeHeat, _pfx.brakeHeat);
          gGL.uniform1f(uYawRate,   Math.abs(_pfx.yawRate));
          gGL.uniform1f(uSteer,     _pfx.steer);

          // Ambient light uniforms (from Electron screen capture)
          const amb = window._ambientGL || { r: 0.3, g: 0.4, b: 0.55, lum: 0.35 };
          gGL.uniform3f(uAmbientColor, amb.r, amb.g, amb.b);
          gGL.uniform1f(uAmbientLum, amb.lum);
          gGL.uniform1i(uAmbientMode, window._ambientModeInt !== undefined ? window._ambientModeInt : 2);

          gGL.drawArrays(gGL.TRIANGLE_STRIP, 0, 4);

          // ── Perf: end GPU timer ──
          _glarePerf.endFrame(gGL, gpuQuery);
        };
      }
    }

    /* ════════════════════════════════════════════
       FLAG ICON FX — waving flag with cloth shading
       ════════════════════════════════════════════ */
    const flagCtx = initGL('flagGlCanvas');
    let _flagTime = 0;
    let _flagColors = { c1: [1,0.85,0.15], c2: [1,1,0.95], pattern: 0.0 };
    let _flagVisible = false;

    if (flagCtx) {
      const { canvas: fC, gl: fGL } = flagCtx;

      const quadVS = `#version 300 es
        in vec2 aPos;
        out vec2 vUV;
        void main() {
          vUV = aPos * 0.5 + 0.5;
          gl_Position = vec4(aPos, 0.0, 1.0);
        }`;

      const flagFS = `#version 300 es
        precision highp float;
        in vec2 vUV;
        out vec4 fragColor;

        uniform float uTime;
        uniform vec3  uColor1;
        uniform vec3  uColor2;
        uniform float uPattern;  // 0=solid, 1=horiz stripes, 2=checkered, 3=diagonal, 4=circles
        uniform vec2  uRes;      // canvas pixel size for aspect correction

        void main() {
          vec2 uv = vUV;
          float aspect = uRes.x / max(uRes.y, 1.0);

          // Full-background waving cloth — fills entire box
          float fx = uv.x;
          float fy = uv.y;

          // Wave displacement — increases from left to right (cloth physics)
          float amp = fx * fx * 0.12;
          float w1 = sin(fx * 12.0 - uTime * 5.0) * amp;
          float w2 = sin(fx * 18.0 - uTime * 3.5 + 2.0) * amp * 0.35;
          float wave = w1 + w2;

          // Distort vertical coordinate for cloth wave
          float fy2 = fy + wave * 0.6;

          // ── Cloth shading — light on peaks, dark in valleys ──
          float dWave = cos(fx * 12.0 - uTime * 5.0);
          float shade = 0.80 + 0.20 * dWave * fx;

          // ── Pattern coloring ──
          vec3 col;
          if (uPattern < 0.5) {
            // Solid
            col = uColor1;
          } else if (uPattern < 1.5) {
            // Horizontal stripes — doubled count
            float bandCount = max(4.0, floor(aspect * 1.2));
            float band = step(0.5, fract(fy2 * bandCount));
            col = mix(uColor1, uColor2, band);
          } else if (uPattern < 2.5) {
            // Checkered — doubled cells
            float cellsX = max(8.0, floor(aspect * 4.0));
            float cellsY = 4.0;
            float cx = step(0.5, fract(fx * cellsX + wave * 0.5));
            float cy = step(0.5, fract(fy2 * cellsY));
            col = mix(uColor1, uColor2, abs(cx - cy));
          } else if (uPattern < 3.5) {
            // Diagonal stripes — doubled, with wave distortion
            float diag = step(0.5, fract((fx * aspect + fy2 * 3.0) * 1.6));
            col = mix(uColor1, uColor2, diag);
          } else {
            // Circles (meatball flag) — red circles on black background
            float cellsX = max(6.0, floor(aspect * 3.0));
            float cellsY = 3.0;
            float cx = fract(fx * cellsX + wave * 0.3);
            float cy = fract(fy2 * cellsY);
            float d = length(vec2(cx - 0.5, cy - 0.5));
            float circle = 1.0 - smoothstep(0.28, 0.34, d);
            col = mix(uColor2, uColor1, circle);
          }

          col *= shade;

          // Flag cloth alpha — tripled for high visibility
          float alpha = 0.48;

          // Brightness variation from the wave folds
          alpha *= (0.85 + 0.30 * abs(dWave) * fx);

          fragColor = vec4(col * alpha, alpha);
        }`;

      const vs = createShader(fGL, fGL.VERTEX_SHADER, quadVS);
      const fs = createShader(fGL, fGL.FRAGMENT_SHADER, flagFS);
      const prog = createProgram(fGL, vs, fs);

      if (prog) {
        const aPos    = fGL.getAttribLocation(prog, 'aPos');
        const uTime   = fGL.getUniformLocation(prog, 'uTime');
        const uColor1 = fGL.getUniformLocation(prog, 'uColor1');
        const uColor2 = fGL.getUniformLocation(prog, 'uColor2');
        const uPat    = fGL.getUniformLocation(prog, 'uPattern');
        const uRes    = fGL.getUniformLocation(prog, 'uRes');

        const buf = fGL.createBuffer();
        fGL.bindBuffer(fGL.ARRAY_BUFFER, buf);
        fGL.bufferData(fGL.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), fGL.STATIC_DRAW);

        fGL.enable(fGL.BLEND);
        fGL.blendFunc(fGL.ONE, fGL.ONE_MINUS_SRC_ALPHA);

        window._flagFXFrame = function(dt) {
          if (!_flagVisible) return;
          resizeCanvas(fC, fGL);
          _flagTime += dt;

          fGL.clearColor(0, 0, 0, 0);
          fGL.clear(fGL.COLOR_BUFFER_BIT);

          fGL.useProgram(prog);
          fGL.bindBuffer(fGL.ARRAY_BUFFER, buf);
          fGL.enableVertexAttribArray(aPos);
          fGL.vertexAttribPointer(aPos, 2, fGL.FLOAT, false, 0, 0);

          fGL.uniform1f(uTime, _flagTime);
          fGL.uniform3fv(uColor1, _flagColors.c1);
          fGL.uniform3fv(uColor2, _flagColors.c2);
          fGL.uniform1f(uPat, _flagColors.pattern);
          fGL.uniform2f(uRes, fC.width, fC.height);

          fGL.drawArrays(fGL.TRIANGLE_STRIP, 0, 4);
        };
      }
    }

    // Flag color definitions per flag type
    window._FLAG_GL_COLORS = {
      yellow:    { c1: [1.0, 0.85, 0.12], c2: [1.0, 1.0, 0.92],  pattern: 0.0 },
      red:       { c1: [0.90, 0.14, 0.12], c2: [0.50, 0.06, 0.06], pattern: 0.0 },
      blue:      { c1: [0.20, 0.45, 0.92], c2: [0.08, 0.20, 0.55], pattern: 3.0 },
      green:     { c1: [0.20, 0.72, 0.28], c2: [0.10, 0.42, 0.16], pattern: 0.0 },
      white:     { c1: [0.95, 0.95, 0.95], c2: [0.72, 0.72, 0.72], pattern: 0.0 },
      debris:    { c1: [1.0, 0.85, 0.12], c2: [0.90, 0.18, 0.12], pattern: 3.0 },
      checkered: { c1: [0.95, 0.95, 0.95], c2: [0.06, 0.06, 0.06], pattern: 2.0 },
      black:     { c1: [0.06, 0.06, 0.06], c2: [0.80, 0.12, 0.08], pattern: 1.0 },
      meatball:  { c1: [0.85, 0.12, 0.10], c2: [0.06, 0.06, 0.06], pattern: 4.0 }, // red circles on black
      orange:    { c1: [1.0, 0.60, 0.08], c2: [0.90, 0.35, 0.05], pattern: 0.0 }   // solid orange
    };

    window.setFlagGLColors = function(flagType) {
      const def = window._FLAG_GL_COLORS[flagType];
      if (def) {
        _flagColors.c1 = def.c1;
        _flagColors.c2 = def.c2;
        _flagColors.pattern = def.pattern;
        _flagVisible = true;
      } else {
        _flagVisible = false;
      }
    };

    /* ════════════════════════════════════════════
       LEADERBOARD PLAYER HIGHLIGHT — shimmer/glow
       ════════════════════════════════════════════ */
    const lbCtx = initGL('lbPlayerGlCanvas');
    let _lbTime = 0;
    let _lbPlayerTop = 0;     // 0-1 normalized
    let _lbPlayerBottom = 1;   // 0-1 normalized
    let _lbHasPlayer = false;
    // Highlight mode: 0=blue(same), 1=green(ahead), 2=red(behind), 3=gold(P1)
    let _lbHighlightMode = 0;

    if (lbCtx) {
      const { canvas: lC, gl: lGL } = lbCtx;

      const quadVS = `#version 300 es
        in vec2 aPos;
        out vec2 vUV;
        void main() {
          vUV = aPos * 0.5 + 0.5;
          gl_Position = vec4(aPos, 0.0, 1.0);
        }`;

      const lbFS = `#version 300 es
        precision highp float;
        in vec2 vUV;
        out vec4 fragColor;

        uniform float uTime;
        uniform float uPlayerTop;    // normalized y of player row top
        uniform float uPlayerBot;    // normalized y of player row bottom
        uniform float uMode;         // 0=blue, 1=green, 2=red, 3=gold(P1)
        uniform vec2  uRes;

        // Pseudo-random for P1 sparkles
        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        void main() {
          vec2 uv = vUV;
          float y = 1.0 - uv.y;

          if (y < uPlayerTop || y > uPlayerBot) {
            fragColor = vec4(0.0);
            return;
          }

          float ly = (y - uPlayerTop) / max(uPlayerBot - uPlayerTop, 0.001);
          float lx = uv.x;

          // ── Color selection by mode ──
          // 0=blue(same), 1=green(ahead), 2=red(behind), 3=gold(P1)
          vec3 baseColor;
          vec3 brightColor;
          if (uMode < 0.5) {
            baseColor  = vec3(0.25, 0.45, 0.80);   // blue
            brightColor = vec3(0.40, 0.60, 0.95);
          } else if (uMode < 1.5) {
            baseColor  = vec3(0.15, 0.70, 0.40);   // green
            brightColor = vec3(0.25, 0.85, 0.55);
          } else if (uMode < 2.5) {
            baseColor  = vec3(0.80, 0.20, 0.15);   // red
            brightColor = vec3(0.95, 0.35, 0.25);
          } else {
            baseColor  = vec3(0.76, 0.60, 0.22);   // deep gold
            brightColor = vec3(1.0, 0.88, 0.55);    // bright gold
          }

          // ── Effect 1: Shimmer sweep ──
          float sweepSpeed = 0.25;
          float sweepX = fract(uTime * sweepSpeed);
          float beamW = 0.08;
          float beam = exp(-pow((lx - sweepX) / beamW, 2.0)) * 0.55;
          float trail = exp(-max(0.0, lx - sweepX + 0.1) * 4.0) * 0.08
                      * step(sweepX - 0.3, lx);
          float effect1 = beam + trail;

          // ── Effect 2: Edge breathing glow ──
          float edgeY = min(ly, 1.0 - ly);
          float edgeGlow = exp(-edgeY * 10.0) * 0.35;
          float leftGlow = exp(-lx * 6.0) * 0.45;
          float pulse = 0.55 + 0.45 * sin(uTime * 1.8);
          float effect2 = (edgeGlow + leftGlow) * pulse;

          // ── Crossfade between effects (~8s per full cycle) ──
          float blend = 0.5 + 0.5 * sin(uTime * 0.4);
          float effect = mix(effect1, effect2, blend);

          float rowEdge = smoothstep(0.0, 0.15, ly) * smoothstep(1.0, 0.85, ly);
          effect *= rowEdge;

          float alpha = clamp(effect * 0.55, 0.0, 0.5);
          vec3 col = baseColor;

          // ── P1 sparkle overlay (very sparse) ──
          if (uMode > 2.5) {
            float beamBright = exp(-pow((lx - sweepX) / beamW, 2.0)) * 0.15 * rowEdge;
            col = mix(baseColor, brightColor, beamBright * 2.0 + 0.3);

            float gridScale = 24.0;
            vec2 gridCell = floor(vec2(lx, ly) * gridScale);
            float cellRand = hash21(gridCell);
            if (cellRand > 0.94) {
              vec2 cellUV = fract(vec2(lx, ly) * gridScale);
              float sparklePhase = cellRand * 6.28 + uTime * (2.5 + cellRand * 2.0);
              float blink = pow(max(0.0, sin(sparklePhase)), 28.0);
              float dist = length(cellUV - 0.5);
              float point = exp(-dist * dist * 50.0);
              float sparkle = blink * point * rowEdge * 0.5;
              col += vec3(1.0, 0.97, 0.85) * sparkle;
              alpha += sparkle;
            }
          }

          alpha = clamp(alpha, 0.0, 0.55);
          fragColor = vec4(col * alpha, alpha);
        }`;

      const vs = createShader(lGL, lGL.VERTEX_SHADER, quadVS);
      const fs = createShader(lGL, lGL.FRAGMENT_SHADER, lbFS);
      const prog = createProgram(lGL, vs, fs);

      if (prog) {
        const aPos       = lGL.getAttribLocation(prog, 'aPos');
        const uTime      = lGL.getUniformLocation(prog, 'uTime');
        const uPlayerTop = lGL.getUniformLocation(prog, 'uPlayerTop');
        const uPlayerBot = lGL.getUniformLocation(prog, 'uPlayerBot');
        const uMode      = lGL.getUniformLocation(prog, 'uMode');
        const uRes       = lGL.getUniformLocation(prog, 'uRes');

        const buf = lGL.createBuffer();
        lGL.bindBuffer(lGL.ARRAY_BUFFER, buf);
        lGL.bufferData(lGL.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), lGL.STATIC_DRAW);

        lGL.enable(lGL.BLEND);
        lGL.blendFunc(lGL.ONE, lGL.ONE_MINUS_SRC_ALPHA);

        window._lbFXFrame = function(dt) {
          if (!_lbHasPlayer) return;
          resizeCanvas(lC, lGL);
          _lbTime += dt;

          lGL.clearColor(0, 0, 0, 0);
          lGL.clear(lGL.COLOR_BUFFER_BIT);

          lGL.useProgram(prog);
          lGL.bindBuffer(lGL.ARRAY_BUFFER, buf);
          lGL.enableVertexAttribArray(aPos);
          lGL.vertexAttribPointer(aPos, 2, lGL.FLOAT, false, 0, 0);

          lGL.uniform1f(uTime, _lbTime);
          lGL.uniform1f(uPlayerTop, _lbPlayerTop);
          lGL.uniform1f(uPlayerBot, _lbPlayerBottom);
          lGL.uniform1f(uMode, _lbHighlightMode);
          lGL.uniform2f(uRes, lC.width, lC.height);

          lGL.drawArrays(lGL.TRIANGLE_STRIP, 0, 4);
        };
      }
    }

    // Update leaderboard player row position for WebGL highlight
    window.updateLBPlayerPos = function() {
      const inner = document.querySelector('.lb-inner');
      const playerRow = document.querySelector('.lb-row.lb-player');
      if (!inner || !playerRow) {
        _lbHasPlayer = false;
        return;
      }
      const ir = inner.getBoundingClientRect();
      const pr = playerRow.getBoundingClientRect();
      if (ir.height < 1) { _lbHasPlayer = false; return; }
      _lbPlayerTop = (pr.top - ir.top) / ir.height;
      _lbPlayerBottom = (pr.bottom - ir.top) / ir.height;
      _lbHasPlayer = true;
    };

    // Update highlight mode: 0=blue(same), 1=green(ahead), 2=red(behind), 3=gold(P1)
    window.setLBHighlightMode = function(mode) { _lbHighlightMode = mode; };

    /* ════════════════════════════════════════════
       K10 LOGO BACKGROUND — ultra-subtle chevron drift
       SDF-based chevron shapes from the K10 logomark,
       barely perceptible at 3-4% opacity, drifting so slowly
       you only notice after 4-5 minutes of watching.
       ════════════════════════════════════════════ */
    const k10LogoCtx = initGL('k10LogoGlCanvas');
    let _k10LogoTime = 0;

    if (k10LogoCtx) {
      const { canvas: kC, gl: kGL } = k10LogoCtx;

      const quadVS = `#version 300 es
        in vec2 aPos;
        out vec2 vUV;
        void main() {
          vUV = aPos * 0.5 + 0.5;
          gl_Position = vec4(aPos, 0.0, 1.0);
        }`;

      const k10FS = `#version 300 es
        precision highp float;
        in vec2 vUV;
        out vec4 fragColor;
        uniform float uTime;
        uniform vec2  uRes;

        // Rotate 2D point
        vec2 rot(vec2 p, float a) {
          float c = cos(a), s = sin(a);
          return vec2(p.x*c - p.y*s, p.x*s + p.y*c);
        }

        // SDF for a single chevron (two angled bars forming a > shape)
        // Centered at origin, pointing right, with arm length and thickness
        float sdChevron(vec2 p, float armLen, float thick, float angle) {
          // Mirror across x-axis for the two arms
          vec2 q = vec2(p.x, abs(p.y));
          // Rotate the arm direction
          vec2 dir = vec2(cos(angle), sin(angle));
          // Project onto arm line
          float t = clamp(dot(q, dir), 0.0, armLen);
          vec2 closest = dir * t;
          return length(q - closest) - thick;
        }

        // Smoother chevron using box-like approach
        float sdChevronV(vec2 p, float size, float thick) {
          vec2 q = vec2(p.x, abs(p.y));
          // V-shape: line from (0, size) to (size*0.6, 0)
          vec2 a = vec2(0.0, size);
          vec2 b = vec2(size * 0.7, 0.0);
          vec2 ab = b - a;
          vec2 aq = q - a;
          float t = clamp(dot(aq, ab) / dot(ab, ab), 0.0, 1.0);
          vec2 closest = a + ab * t;
          return length(q - closest) - thick;
        }

        void main() {
          vec2 uv = vUV;
          float aspect = uRes.x / uRes.y;
          vec2 p = (uv - 0.5) * vec2(aspect, 1.0);

          float t = uTime;

          // Three chevrons that drift independently at glacial speeds
          // Each has its own phase, position offset, scale, and slight rotation

          float totalAlpha = 0.0;
          vec3 totalColor = vec3(0.0);

          // Chevron 1 — leftmost, lighter red
          {
            // Drift: very slow circular path + slight horizontal oscillation
            vec2 offset = vec2(
              sin(t * 0.008 + 0.0) * 0.12 + cos(t * 0.003) * 0.05,
              cos(t * 0.006 + 1.0) * 0.08 + sin(t * 0.004) * 0.03
            );
            float scale = 0.38 + sin(t * 0.005 + 2.0) * 0.03;
            float angle = sin(t * 0.004) * 0.06;
            vec2 cp = rot(p - vec2(-0.15, 0.0) - offset, angle) / scale;
            float d = sdChevronV(cp, 0.5, 0.06);
            float shape = 1.0 - smoothstep(-0.01, 0.03, d);
            float breath = 0.5 + 0.5 * sin(t * 0.012 + 0.0);
            float a = shape * breath * 0.035;
            totalColor += vec3(0.85, 0.30, 0.25) * a;
            totalAlpha += a;
          }

          // Chevron 2 — middle, medium red
          {
            vec2 offset = vec2(
              cos(t * 0.007 + 2.0) * 0.10 + sin(t * 0.0035) * 0.04,
              sin(t * 0.009 + 0.5) * 0.10 + cos(t * 0.005) * 0.03
            );
            float scale = 0.42 + cos(t * 0.006 + 1.0) * 0.025;
            float angle = cos(t * 0.005 + 1.0) * 0.05;
            vec2 cp = rot(p - vec2(0.0, 0.0) - offset, angle) / scale;
            float d = sdChevronV(cp, 0.5, 0.06);
            float shape = 1.0 - smoothstep(-0.01, 0.03, d);
            float breath = 0.5 + 0.5 * sin(t * 0.010 + 2.1);
            float a = shape * breath * 0.035;
            totalColor += vec3(0.75, 0.22, 0.20) * a;
            totalAlpha += a;
          }

          // Chevron 3 — rightmost, dark maroon/wine
          {
            vec2 offset = vec2(
              sin(t * 0.006 + 4.0) * 0.11 + cos(t * 0.004) * 0.05,
              cos(t * 0.008 + 3.0) * 0.09 + sin(t * 0.003) * 0.04
            );
            float scale = 0.35 + sin(t * 0.007 + 3.5) * 0.03;
            float angle = sin(t * 0.003 + 2.0) * 0.07;
            vec2 cp = rot(p - vec2(0.12, 0.0) - offset, angle) / scale;
            float d = sdChevronV(cp, 0.5, 0.06);
            float shape = 1.0 - smoothstep(-0.01, 0.03, d);
            float breath = 0.5 + 0.5 * sin(t * 0.014 + 4.2);
            float a = shape * breath * 0.035;
            totalColor += vec3(0.55, 0.12, 0.15) * a;
            totalAlpha += a;
          }

          // Very subtle edge vignette to keep it contained
          float vig = smoothstep(0.0, 0.15, min(uv.x, min(uv.y, min(1.0-uv.x, 1.0-uv.y))));
          totalAlpha *= vig;
          totalColor *= vig;

          totalAlpha = clamp(totalAlpha, 0.0, 0.06);
          fragColor = vec4(totalColor, totalAlpha);
        }`;

      const vs = createShader(kGL, kGL.VERTEX_SHADER, quadVS);
      const fs = createShader(kGL, kGL.FRAGMENT_SHADER, k10FS);
      const prog = createProgram(kGL, vs, fs);

      if (prog) {
        const aPos  = kGL.getAttribLocation(prog, 'aPos');
        const uTime = kGL.getUniformLocation(prog, 'uTime');
        const uRes  = kGL.getUniformLocation(prog, 'uRes');

        const buf = kGL.createBuffer();
        kGL.bindBuffer(kGL.ARRAY_BUFFER, buf);
        kGL.bufferData(kGL.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), kGL.STATIC_DRAW);

        kGL.enable(kGL.BLEND);
        kGL.blendFunc(kGL.ONE, kGL.ONE_MINUS_SRC_ALPHA);

        window._k10LogoFXFrame = function(dt) {
          resizeCanvas(kC, kGL);
          _k10LogoTime += dt;

          kGL.clearColor(0, 0, 0, 0);
          kGL.clear(kGL.COLOR_BUFFER_BIT);

          kGL.useProgram(prog);
          kGL.bindBuffer(kGL.ARRAY_BUFFER, buf);
          kGL.enableVertexAttribArray(aPos);
          kGL.vertexAttribPointer(aPos, 2, kGL.FLOAT, false, 0, 0);

          kGL.uniform1f(uTime, _k10LogoTime);
          kGL.uniform2f(uRes, kC.width, kC.height);

          kGL.drawArrays(kGL.TRIANGLE_STRIP, 0, 4);
        };
      }
    }

    /* ════════════════════════════════════════════
       LEADERBOARD EVENT OVERLAY — position change / race start / finish
       Subtle full-panel flash effects, lower intensity than flag animations
       ════════════════════════════════════════════ */
    const lbEvtCtx = initGL('lbEventGlCanvas');
    let _lbEvtTime = 0;
    let _lbEvtActive = false;
    let _lbEvtColor = [0.0, 0.8, 0.3]; // green default
    let _lbEvtDuration = 1.2;           // seconds
    let _lbEvtElapsed = 99;             // start expired
    let _lbEvtMode = 0;                 // 0=flash, 1=green-flag sweep, 2=checkered

    if (lbEvtCtx) {
      const { canvas: eC, gl: eGL } = lbEvtCtx;

      const quadVS = `#version 300 es
        in vec2 aPos;
        out vec2 vUV;
        void main() {
          vUV = aPos * 0.5 + 0.5;
          gl_Position = vec4(aPos, 0.0, 1.0);
        }`;

      const evtFS = `#version 300 es
        precision highp float;
        in vec2 vUV;
        out vec4 fragColor;

        uniform float uTime;
        uniform float uElapsed;
        uniform float uDuration;
        uniform vec3  uColor;
        uniform float uMode;     // 0=flash, 1=green sweep, 2=checkered, 3=P1 gold
        uniform vec2  uRes;

        // Pseudo-random hash for sparkle particles
        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        void main() {
          vec2 uv = vUV;
          float progress = clamp(uElapsed / uDuration, 0.0, 1.0);

          // Global fade out — starts fading at 40% through
          float fadeOut = smoothstep(1.0, 0.4, progress);

          float alpha = 0.0;
          vec3 col = uColor;

          if (uMode < 0.5) {
            // ── MODE 0: Subtle edge flash (position change) ──
            float edgeX = min(uv.x, 1.0 - uv.x);
            float edgeY = min(uv.y, 1.0 - uv.y);
            float edge = exp(-min(edgeX, edgeY) * 8.0);
            float attack = smoothstep(0.0, 0.15, progress);
            float envelope = attack * fadeOut;
            alpha = edge * envelope * 0.28;
            alpha += envelope * 0.04;
          }
          else if (uMode < 1.5) {
            // ── MODE 1: Green flag sweep (race start) ──
            float sweepPos = progress * 1.6 - 0.3;
            float sweep = exp(-pow((uv.x - sweepPos) / 0.15, 2.0));
            alpha = sweep * fadeOut * 0.22;
            alpha += fadeOut * 0.03 * (1.0 - progress);
          }
          else if (uMode < 2.5) {
            // ── MODE 2: Checkered finish ──
            float scale = 8.0;
            float cx = floor(uv.x * scale);
            float cy = floor(uv.y * scale);
            float checker = mod(cx + cy, 2.0);
            float reveal = smoothstep(uv.x - 0.3, uv.x + 0.1, progress * 1.5);
            col = mix(vec3(0.9), vec3(0.15), checker);
            alpha = reveal * fadeOut * 0.16;
          }
          else {
            // ── MODE 3: P1 Gold celebration ──
            // Rich gold palette — warm, not yellow
            vec3 goldDeep = vec3(0.76, 0.60, 0.22);   // deep warm gold
            vec3 goldBright = vec3(1.0, 0.88, 0.55);   // bright highlight gold
            vec3 goldWhite = vec3(1.0, 0.97, 0.85);    // near-white sparkle peak

            // ── Slow fade-in, long presence, gentle fade-out ──
            float fadeIn = smoothstep(0.0, 0.12, progress);
            float fadeP1 = fadeIn * smoothstep(1.0, 0.5, progress);

            // ── Warm edge glow (stronger than normal gain) ──
            float edgeX = min(uv.x, 1.0 - uv.x);
            float edgeY = min(uv.y, 1.0 - uv.y);
            float edge = exp(-min(edgeX, edgeY) * 5.0);
            float edgeAlpha = edge * fadeP1 * 0.35;

            // ── Soft horizontal shimmer sweep ──
            float shimmerPos = fract(uTime * 0.3 + 0.2);
            float shimmer = exp(-pow((uv.x - shimmerPos) / 0.12, 2.0)) * 0.18;
            shimmer *= fadeP1;

            // ── Sparse sparkle particles ──
            // Grid of potential sparkle sites — only a few activate
            float sparkle = 0.0;
            float gridScale = 18.0; // controls density — higher = more cells but sparser activation
            vec2 gridCell = floor(uv * gridScale);
            float cellRand = hash21(gridCell);

            // Only ~8% of cells can sparkle at all
            if (cellRand > 0.92) {
              vec2 cellUV = fract(uv * gridScale);
              // Each sparkle has its own timing offset
              float sparklePhase = cellRand * 6.28 + uTime * (2.0 + cellRand * 3.0);
              // Sharp on/off blink — visible for only a narrow window
              float blink = pow(max(0.0, sin(sparklePhase)), 24.0);
              // Point-like: bright only near cell center
              float dist = length(cellUV - 0.5);
              float point = exp(-dist * dist * 40.0);
              // Stagger appearance across the animation
              float appear = smoothstep(cellRand * 0.4, cellRand * 0.4 + 0.1, progress);
              sparkle = blink * point * appear * fadeP1 * 0.65;
            }

            // Compose: edge glow is deep gold, shimmer is bright gold, sparkles are near-white
            col = goldDeep * edgeAlpha
                + goldBright * shimmer
                + goldWhite * sparkle;
            alpha = edgeAlpha + shimmer + sparkle;
            // Very subtle overall warm wash
            col += goldDeep * fadeP1 * 0.03;
            alpha += fadeP1 * 0.03;
          }

          alpha = clamp(alpha, 0.0, 0.55);
          fragColor = vec4(col * alpha, alpha);
        }`;

      const vs = createShader(eGL, eGL.VERTEX_SHADER, quadVS);
      const fs = createShader(eGL, eGL.FRAGMENT_SHADER, evtFS);
      const prog = createProgram(eGL, vs, fs);

      if (prog) {
        const aPos      = eGL.getAttribLocation(prog, 'aPos');
        const uTime     = eGL.getUniformLocation(prog, 'uTime');
        const uElapsed  = eGL.getUniformLocation(prog, 'uElapsed');
        const uDuration = eGL.getUniformLocation(prog, 'uDuration');
        const uColor    = eGL.getUniformLocation(prog, 'uColor');
        const uMode     = eGL.getUniformLocation(prog, 'uMode');
        const uRes      = eGL.getUniformLocation(prog, 'uRes');

        const buf = eGL.createBuffer();
        eGL.bindBuffer(eGL.ARRAY_BUFFER, buf);
        eGL.bufferData(eGL.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), eGL.STATIC_DRAW);

        eGL.enable(eGL.BLEND);
        eGL.blendFunc(eGL.ONE, eGL.ONE_MINUS_SRC_ALPHA);

        window._lbEvtFXFrame = function(dt) {
          _lbEvtElapsed += dt;
          if (_lbEvtElapsed > _lbEvtDuration) {
            // Clear canvas when animation is done
            if (_lbEvtActive) {
              eGL.clearColor(0, 0, 0, 0);
              eGL.clear(eGL.COLOR_BUFFER_BIT);
              _lbEvtActive = false;
            }
            return;
          }
          _lbEvtActive = true;
          resizeCanvas(eC, eGL);
          _lbEvtTime += dt;

          eGL.clearColor(0, 0, 0, 0);
          eGL.clear(eGL.COLOR_BUFFER_BIT);

          eGL.useProgram(prog);
          eGL.bindBuffer(eGL.ARRAY_BUFFER, buf);
          eGL.enableVertexAttribArray(aPos);
          eGL.vertexAttribPointer(aPos, 2, eGL.FLOAT, false, 0, 0);

          eGL.uniform1f(uTime, _lbEvtTime);
          eGL.uniform1f(uElapsed, _lbEvtElapsed);
          eGL.uniform1f(uDuration, _lbEvtDuration);
          eGL.uniform3fv(uColor, _lbEvtColor);
          eGL.uniform1f(uMode, _lbEvtMode);
          eGL.uniform2f(uRes, eC.width, eC.height);

          eGL.drawArrays(eGL.TRIANGLE_STRIP, 0, 4);
        };
      }
    }

    // Public API: trigger a leaderboard event animation
    // type: 'gain' | 'lose' | 'p1' | 'green' | 'finish'
    window.triggerLBEvent = function(type) {
      switch (type) {
        case 'gain':
          _lbEvtColor = [0.1, 0.85, 0.35];  // green
          _lbEvtDuration = 1.0;
          _lbEvtMode = 0;
          break;
        case 'lose':
          _lbEvtColor = [0.9, 0.15, 0.1];   // red
          _lbEvtDuration = 1.0;
          _lbEvtMode = 0;
          break;
        case 'p1':
          _lbEvtColor = [0.76, 0.60, 0.22]; // deep gold (shader handles its own palette)
          _lbEvtDuration = 3.5;
          _lbEvtMode = 3;
          break;
        case 'green':
          _lbEvtColor = [0.1, 0.85, 0.35];  // green
          _lbEvtDuration = 2.0;
          _lbEvtMode = 1;
          break;
        case 'finish':
          _lbEvtColor = [0.9, 0.9, 0.9];    // white (checkered)
          _lbEvtDuration = 2.5;
          _lbEvtMode = 2;
          break;
      }
      _lbEvtElapsed = 0;
      _lbEvtActive = true;
    };

    /* ════════════════════════════════════════════
       SPOTTER GLOW — edge glow that fades in/out with messages
       Color varies by severity: warn=amber, danger=red, clear=green
       ════════════════════════════════════════════ */
    const spotCtx = initGL('spotterGlCanvas');
    let _spotTime = 0;
    // 0=idle(off), 1=warn(amber), 2=danger(red), 3=clear(green)
    let _spotMode = 0;
    let _spotIntensity = 0;  // smoothly animated 0→1

    if (spotCtx) {
      const { canvas: sC, gl: sGL } = spotCtx;

      const quadVS = `#version 300 es
        in vec2 aPos;
        out vec2 vUV;
        void main() {
          vUV = aPos * 0.5 + 0.5;
          gl_Position = vec4(aPos, 0.0, 1.0);
        }`;

      const spotFS = `#version 300 es
        precision highp float;
        in vec2 vUV;
        out vec4 fragColor;

        uniform float uTime;
        uniform float uIntensity;  // 0-1 animated fade
        uniform float uMode;       // 1=warn, 2=danger, 3=clear
        uniform vec2  uRes;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
                     mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
        }

        void main() {
          if (uIntensity < 0.005) { fragColor = vec4(0.0); return; }

          vec2 uv = vUV;

          // Color by mode
          vec3 col;
          float pulseSpeed;
          if (uMode < 1.5) {
            // Warn — warm amber
            col = vec3(0.95, 0.70, 0.15);
            pulseSpeed = 2.5;
          } else if (uMode < 2.5) {
            // Danger — urgent red
            col = vec3(0.92, 0.18, 0.12);
            pulseSpeed = 4.0;
          } else {
            // Clear — cool green
            col = vec3(0.15, 0.82, 0.40);
            pulseSpeed = 1.8;
          }

          // Edge distance — glow hugs all edges
          float edgeX = min(uv.x, 1.0 - uv.x);
          float edgeY = min(uv.y, 1.0 - uv.y);
          float edgeDist = min(edgeX, edgeY);

          // Primary edge glow — exponential falloff from borders
          float edgeGlow = exp(-edgeDist * 12.0);

          // Corner hotspots — brighter where two edges meet
          float cornerDist = length(vec2(edgeX, edgeY));
          float cornerGlow = exp(-cornerDist * 8.0) * 0.4;

          // Animated pulse — breathing intensity
          float pulse = 0.65 + 0.35 * sin(uTime * pulseSpeed);

          // Danger mode: add a faster flicker overlay
          float flicker = 1.0;
          if (uMode > 1.5 && uMode < 2.5) {
            flicker = 0.85 + 0.15 * sin(uTime * 11.0 + uv.x * 5.0);
          }

          // Noise-based shimmer along the edges
          float shimmer = noise(uv * 6.0 + uTime * 1.5) * 0.3 + 0.7;

          // Compose
          float glow = (edgeGlow + cornerGlow) * pulse * flicker * shimmer;
          glow *= uIntensity;

          // Sweep highlight — slow beam traveling around the perimeter
          float sweep = fract(uTime * 0.3);
          // Parametric edge position: top→right→bottom→left mapped to 0→1
          float perim;
          if (uv.y < 0.05) perim = uv.x * 0.25;                          // top edge
          else if (uv.x > 0.95) perim = 0.25 + uv.y * 0.25;             // right edge
          else if (uv.y > 0.95) perim = 0.5 + (1.0 - uv.x) * 0.25;     // bottom edge
          else if (uv.x < 0.05) perim = 0.75 + (1.0 - uv.y) * 0.25;    // left edge
          else perim = -1.0;

          if (perim >= 0.0) {
            float beamDist = min(abs(perim - sweep), min(abs(perim - sweep + 1.0), abs(perim - sweep - 1.0)));
            float beam = exp(-beamDist * beamDist * 800.0) * 0.5 * uIntensity;
            glow += beam;
          }

          float alpha = clamp(glow * 0.6, 0.0, 0.65);
          fragColor = vec4(col * alpha, alpha);
        }`;

      const vs = createShader(sGL, sGL.VERTEX_SHADER, quadVS);
      const fs = createShader(sGL, sGL.FRAGMENT_SHADER, spotFS);
      const prog = createProgram(sGL, vs, fs);

      if (prog) {
        const aPos       = sGL.getAttribLocation(prog, 'aPos');
        const uTime      = sGL.getUniformLocation(prog, 'uTime');
        const uIntensity = sGL.getUniformLocation(prog, 'uIntensity');
        const uMode      = sGL.getUniformLocation(prog, 'uMode');
        const uRes       = sGL.getUniformLocation(prog, 'uRes');

        const buf = sGL.createBuffer();
        sGL.bindBuffer(sGL.ARRAY_BUFFER, buf);
        sGL.bufferData(sGL.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), sGL.STATIC_DRAW);

        sGL.enable(sGL.BLEND);
        sGL.blendFunc(sGL.ONE, sGL.ONE_MINUS_SRC_ALPHA);

        window._spotterFXFrame = function(dt) {
          // Smooth intensity towards target
          const target = _spotMode > 0 ? 1.0 : 0.0;
          const speed = target > 0.5 ? 6.0 : 3.0; // fast in, slower out
          _spotIntensity += (target - _spotIntensity) * Math.min(1.0, dt * speed);

          if (_spotIntensity < 0.005) {
            // Clear canvas when fully faded
            sGL.clearColor(0, 0, 0, 0);
            sGL.clear(sGL.COLOR_BUFFER_BIT);
            return;
          }

          // Only resize canvas when glow is ramping up — prevents jarring
          // shrink when fading cards are removed from the DOM
          if (target > 0.5) resizeCanvas(sC, sGL);
          _spotTime += dt;

          sGL.clearColor(0, 0, 0, 0);
          sGL.clear(sGL.COLOR_BUFFER_BIT);

          sGL.useProgram(prog);
          sGL.bindBuffer(sGL.ARRAY_BUFFER, buf);
          sGL.enableVertexAttribArray(aPos);
          sGL.vertexAttribPointer(aPos, 2, sGL.FLOAT, false, 0, 0);

          sGL.uniform1f(uTime, _spotTime);
          sGL.uniform1f(uIntensity, _spotIntensity);
          sGL.uniform1f(uMode, _spotMode);
          sGL.uniform2f(uRes, sC.width, sC.height);

          sGL.drawArrays(sGL.TRIANGLE_STRIP, 0, 4);
        };
      }
    }

    // Public API: set spotter glow mode
    // 'warn' | 'danger' | 'clear' | 'off'
    window.setSpotterGlow = function(type) {
      switch (type) {
        case 'warn':   _spotMode = 1; break;
        case 'danger': _spotMode = 2; break;
        case 'clear':  _spotMode = 3; break;
        default:       _spotMode = 0; break;
      }
    };

    /* ════════════════════════════════════════════
       COMMENTARY TRAIL FX — flowing energy border
       ════════════════════════════════════════════ */
    const commGLCtx = initGL('commentaryGlCanvas');
    let _commTrailActive = false;
    let _commTrailTime = 0;
    let _commTrailHue = 200;   // updated via setCommentaryTrailGL

    if (commGLCtx) {
      const { canvas: cC, gl: cGL } = commGLCtx;

      const commVS = `#version 300 es
        in vec2 aPos;
        out vec2 vUV;
        void main() {
          vUV = aPos * 0.5 + 0.5;
          gl_Position = vec4(aPos, 0.0, 1.0);
        }`;

      // Trail fragment shader — energy particles tracing the border,
      // subtle inner ambient shimmer, hue-driven color.
      const commFS = `#version 300 es
        precision highp float;
        in vec2 vUV;
        out vec4 fragColor;

        uniform float uTime;
        uniform vec2  uRes;
        uniform float uIntensity;  // 0-1 fade
        uniform float uHue;        // 0-360

        // ── Noise ──
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
                     mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
        }

        // ── HSL to RGB ──
        vec3 hsl2rgb(float h, float s, float l) {
          float c = (1.0 - abs(2.0 * l - 1.0)) * s;
          float x = c * (1.0 - abs(mod(h / 60.0, 2.0) - 1.0));
          float m = l - c * 0.5;
          vec3 rgb;
          if (h < 60.0)       rgb = vec3(c, x, 0);
          else if (h < 120.0) rgb = vec3(x, c, 0);
          else if (h < 180.0) rgb = vec3(0, c, x);
          else if (h < 240.0) rgb = vec3(0, x, c);
          else if (h < 300.0) rgb = vec3(x, 0, c);
          else                rgb = vec3(c, 0, x);
          return rgb + m;
        }

        void main() {
          vec2 uv = vUV;
          float t = uTime;
          float inten = uIntensity;
          float aspect = uRes.x / uRes.y;

          // Rounded-rect SDF (UV-space with aspect correction)
          vec2 center = vec2(0.5);
          float cornerR = 0.06;
          vec2 d = abs(uv - center) - vec2(0.5 - cornerR);
          // aspect-correct for x
          d.x *= aspect;
          float sdf = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - cornerR * aspect;

          // Border band — narrow strip along the edge
          float borderW = 0.022;
          float border = smoothstep(borderW, borderW * 0.3, abs(sdf));

          // ── Trail particles: 3 streams at different speeds ──
          // Parametric angle around the perimeter
          float angle = atan(uv.y - 0.5, (uv.x - 0.5) * aspect);
          float a = angle / 6.28318 + 0.5; // normalize 0-1

          float trail1 = pow(max(0.0, sin(a * 12.5663 + t * 3.0)), 16.0);
          float trail2 = pow(max(0.0, sin(a * 18.8496 - t * 2.2 + 1.0)), 12.0);
          float trail3 = pow(max(0.0, sin(a * 8.3776  + t * 4.5 + 2.5)), 20.0);

          float trails = (trail1 * 0.7 + trail2 * 0.5 + trail3 * 0.9);
          trails *= border;

          // ── Flowing shimmer along border ──
          float shimmer = noise(vec2(a * 8.0 + t * 1.5, t * 0.3)) * 0.5 + 0.5;
          shimmer *= border * 0.35;

          // ── Subtle inner ambient glow ──
          float innerDist = smoothstep(0.0, -0.08, sdf);
          float ambient = innerDist * 0.04 * (0.7 + 0.3 * sin(t * 0.8));

          // ── Color: hue-matched with slight variation on trails ──
          vec3 baseCol = hsl2rgb(uHue, 0.6, 0.55);
          vec3 brightCol = hsl2rgb(uHue, 0.7, 0.7);
          vec3 trailCol = mix(baseCol, brightCol, trails);

          // ── Compose ──
          float alpha = (trails * 0.6 + shimmer * 0.4 + ambient) * inten;
          vec3 col = trailCol;

          // Clamp
          alpha = clamp(alpha, 0.0, 0.65);

          fragColor = vec4(col * alpha, alpha);
        }`;

      const cvs = createShader(cGL, cGL.VERTEX_SHADER, commVS);
      const cfs = createShader(cGL, cGL.FRAGMENT_SHADER, commFS);
      const commProg = (cvs && cfs) ? createProgram(cGL, cvs, cfs) : null;

      if (commProg) {
        const commPosLoc = cGL.getAttribLocation(commProg, 'aPos');
        const commUTime = cGL.getUniformLocation(commProg, 'uTime');
        const commURes = cGL.getUniformLocation(commProg, 'uRes');
        const commUInten = cGL.getUniformLocation(commProg, 'uIntensity');
        const commUHue = cGL.getUniformLocation(commProg, 'uHue');

        const commBuf = cGL.createBuffer();
        cGL.bindBuffer(cGL.ARRAY_BUFFER, commBuf);
        cGL.bufferData(cGL.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), cGL.STATIC_DRAW);

        let _commInten = 0;

        window._commTrailFXFrame = function(dt) {
          if (_commTrailActive) {
            _commInten = Math.min(1, _commInten + dt * 2.0);  // fade in ~0.5s
            _commTrailTime += dt;
          } else {
            _commInten = Math.max(0, _commInten - dt * 3.0);  // fade out faster
            if (_commInten <= 0) return;
          }

          resizeCanvas(cC, cGL);
          cGL.enable(cGL.BLEND);
          cGL.blendFunc(cGL.SRC_ALPHA, cGL.ONE);  // additive
          cGL.clearColor(0, 0, 0, 0);
          cGL.clear(cGL.COLOR_BUFFER_BIT);

          cGL.useProgram(commProg);
          cGL.uniform1f(commUTime, _commTrailTime);
          cGL.uniform2f(commURes, cC.width, cC.height);
          cGL.uniform1f(commUInten, _commInten);
          cGL.uniform1f(commUHue, _commTrailHue);

          cGL.bindBuffer(cGL.ARRAY_BUFFER, commBuf);
          cGL.enableVertexAttribArray(commPosLoc);
          cGL.vertexAttribPointer(commPosLoc, 2, cGL.FLOAT, false, 0, 0);
          cGL.drawArrays(cGL.TRIANGLE_STRIP, 0, 4);
        };
      }
    }

    // Public API: toggle commentary trail + set hue
    window.setCommentaryTrailGL = function(active, hue) {
      _commTrailActive = active;
      if (typeof hue === 'number') _commTrailHue = hue;
      if (active) _commTrailTime = 0;
    };

    /* ════════════════════════════════════════════
       BONKERS PIT BANNER FX — fire / energy burst
       ════════════════════════════════════════════ */
    const pitGLCtx = initGL('pitGlCanvas');
    let _bonkersGLActive = false;
    let _bonkersTime = 0;

    if (pitGLCtx) {
      const { canvas: pC, gl: pGL } = pitGLCtx;

      const pitVS = `#version 300 es
        in vec2 aPos;
        out vec2 vUV;
        void main() {
          vUV = aPos * 0.5 + 0.5;
          gl_Position = vec4(aPos, 0.0, 1.0);
        }`;

      const pitFS = `#version 300 es
        precision highp float;
        in vec2 vUV;
        out vec4 fragColor;

        uniform float uTime;
        uniform vec2  uRes;
        uniform float uIntensity;  // 0-1, ramps up

        // ── Noise functions ──
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
                     mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
        }
        float fbm(vec2 p) {
          float v = 0.0, a = 0.5;
          for (int i = 0; i < 4; i++) {
            v += a * noise(p);
            p *= 2.1;
            a *= 0.5;
          }
          return v;
        }

        void main() {
          vec2 uv = vUV;
          vec2 center = vec2(0.5, 0.5);
          float t = uTime;
          float inten = uIntensity;

          // Distance from perimeter (0 at edge, 1 at center)
          float dx = abs(uv.x - 0.5) * 2.0;
          float dy = abs(uv.y - 0.5) * 2.0;
          float edgeDist = max(dx, dy);
          float border = smoothstep(0.7, 1.0, edgeDist);

          // ── Fire layer: fbm-driven flames rising from edges ──
          vec2 fireUV = uv * vec2(4.0, 3.0);
          fireUV.y -= t * 2.5;                    // flames rise
          float fire = fbm(fireUV + t * 0.8);
          fire = smoothstep(0.3, 0.7, fire);
          fire *= border * inten;

          // Fire color: red core → orange → yellow tips
          vec3 fireCol = mix(vec3(0.9, 0.1, 0.0), vec3(1.0, 0.7, 0.0), fire);
          fireCol = mix(fireCol, vec3(1.0, 1.0, 0.3), fire * fire);

          // ── Energy arcs: bright streaks along perimeter ──
          float angle = atan(uv.y - 0.5, uv.x - 0.5);
          float arc1 = sin(angle * 8.0 + t * 12.0) * 0.5 + 0.5;
          float arc2 = sin(angle * 5.0 - t * 9.0 + 1.5) * 0.5 + 0.5;
          float arcMask = smoothstep(0.82, 0.95, edgeDist);
          float arcs = (pow(arc1, 8.0) + pow(arc2, 6.0) * 0.7) * arcMask * inten;
          vec3 arcCol = mix(vec3(1.0, 0.3, 0.0), vec3(1.0, 0.9, 0.2), arc1);

          // ── Heat shimmer: distorted inner haze ──
          float shimmer = noise(uv * 10.0 + t * 3.0) * 0.15;
          float innerGlow = smoothstep(0.85, 0.5, edgeDist) * shimmer * inten;
          vec3 shimmerCol = vec3(0.8, 0.2, 0.0) * innerGlow;

          // ── Pulse: whole-surface throb ──
          float pulse = (sin(t * 15.0) * 0.5 + 0.5) * 0.12 * inten * border;

          // ── Compose ──
          vec3 col = fireCol * fire * 0.9
                   + arcCol * arcs * 0.8
                   + shimmerCol
                   + vec3(1.0, 0.5, 0.1) * pulse;

          float alpha = fire * 0.7 + arcs * 0.6 + innerGlow + pulse;
          alpha = clamp(alpha * inten, 0.0, 0.85);

          fragColor = vec4(col * alpha, alpha);
        }`;

      const pvs = createShader(pGL, pGL.VERTEX_SHADER, pitVS);
      const pfs = createShader(pGL, pGL.FRAGMENT_SHADER, pitFS);
      const pitProg = (pvs && pfs) ? createProgram(pGL, pvs, pfs) : null;

      if (pitProg) {
        const pitPosLoc = pGL.getAttribLocation(pitProg, 'aPos');
        const pitUTime = pGL.getUniformLocation(pitProg, 'uTime');
        const pitURes = pGL.getUniformLocation(pitProg, 'uRes');
        const pitUInten = pGL.getUniformLocation(pitProg, 'uIntensity');

        // Full-screen quad
        const pitBuf = pGL.createBuffer();
        pGL.bindBuffer(pGL.ARRAY_BUFFER, pitBuf);
        pGL.bufferData(pGL.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), pGL.STATIC_DRAW);

        let _bonkersInten = 0;  // smoothly ramps 0→1

        window._bonkersFXFrame = function(dt) {
          // Ramp intensity
          if (_bonkersGLActive) {
            _bonkersInten = Math.min(1, _bonkersInten + dt * 2.5); // ramp up over 0.4s
            _bonkersTime += dt;
          } else {
            _bonkersInten = Math.max(0, _bonkersInten - dt * 4.0); // ramp down faster
            if (_bonkersInten <= 0) return;
          }

          resizeCanvas(pC, pGL);
          pGL.enable(pGL.BLEND);
          pGL.blendFunc(pGL.SRC_ALPHA, pGL.ONE);  // additive for fire
          pGL.clearColor(0, 0, 0, 0);
          pGL.clear(pGL.COLOR_BUFFER_BIT);

          pGL.useProgram(pitProg);
          pGL.uniform1f(pitUTime, _bonkersTime);
          pGL.uniform2f(pitURes, pC.width, pC.height);
          pGL.uniform1f(pitUInten, _bonkersInten);

          pGL.bindBuffer(pGL.ARRAY_BUFFER, pitBuf);
          pGL.enableVertexAttribArray(pitPosLoc);
          pGL.vertexAttribPointer(pitPosLoc, 2, pGL.FLOAT, false, 0, 0);
          pGL.drawArrays(pGL.TRIANGLE_STRIP, 0, 4);
        };
      }
    }

    // Public API: toggle bonkers WebGL
    window.setBonkersGL = function(active) {
      _bonkersGLActive = active;
      if (active) _bonkersTime = 0;
    };

    /* ════════════════════════════════════════════
       INCIDENTS MODULE FX — penalty / DQ fire glow
       Reuses the bonkers fire pattern with two modes:
         'penalty' → yellower, subtler, lower intensity
         'dq'      → full red bonkers fire
       ════════════════════════════════════════════ */
    const incGLCtx = initGL('incGlCanvas');
    let _incGLMode = '';   // '', 'penalty', 'dq'
    let _incGLTime = 0;
    let _incGLInten = 0;

    if (incGLCtx) {
      const { canvas: iC, gl: iGL } = incGLCtx;

      const incVS = `#version 300 es
        in vec2 aPos;
        out vec2 vUV;
        void main() {
          vUV = aPos * 0.5 + 0.5;
          gl_Position = vec4(aPos, 0.0, 1.0);
        }`;

      const incFS = `#version 300 es
        precision highp float;
        in vec2 vUV;
        out vec4 fragColor;

        uniform float uTime;
        uniform vec2  uRes;
        uniform float uIntensity;
        uniform float uHueShift;   // 0.0 = red/orange (DQ), 1.0 = yellow/amber (penalty)

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
                     mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
        }
        float fbm(vec2 p) {
          float v = 0.0, a = 0.5;
          for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.1; a *= 0.5; }
          return v;
        }

        void main() {
          vec2 uv = vUV;
          float t = uTime;
          float inten = uIntensity;
          float dx = abs(uv.x - 0.5) * 2.0;
          float dy = abs(uv.y - 0.5) * 2.0;
          float edgeDist = max(dx, dy);
          float border = smoothstep(0.65, 1.0, edgeDist);

          // Fire
          vec2 fireUV = uv * vec2(4.0, 3.0);
          fireUV.y -= t * 2.0;
          float fire = fbm(fireUV + t * 0.6);
          fire = smoothstep(0.35, 0.7, fire) * border * inten;

          // Color shift: DQ (hueShift=0) = red→orange, penalty (hueShift=1) = amber→yellow
          vec3 coreCol  = mix(vec3(0.9, 0.1, 0.0), vec3(0.85, 0.65, 0.0), uHueShift);
          vec3 tipCol   = mix(vec3(1.0, 0.7, 0.0), vec3(1.0, 0.95, 0.3), uHueShift);
          vec3 brightCol = mix(vec3(1.0, 1.0, 0.3), vec3(1.0, 1.0, 0.6), uHueShift);
          vec3 fireCol = mix(coreCol, tipCol, fire);
          fireCol = mix(fireCol, brightCol, fire * fire);

          // Energy arcs — subtler for penalty
          float angle = atan(uv.y - 0.5, uv.x - 0.5);
          float arcSpeed = mix(10.0, 6.0, uHueShift);
          float arc1 = sin(angle * 6.0 + t * arcSpeed) * 0.5 + 0.5;
          float arcMask = smoothstep(0.80, 0.95, edgeDist);
          float arcs = pow(arc1, 8.0) * arcMask * inten * mix(0.8, 0.4, uHueShift);
          vec3 arcCol = mix(tipCol, brightCol, arc1);

          // Compose
          vec3 col = fireCol * fire * 0.85 + arcCol * arcs * 0.7;
          float alpha = fire * 0.6 + arcs * 0.5;
          alpha = clamp(alpha * inten, 0.0, mix(0.80, 0.50, uHueShift));

          fragColor = vec4(col * alpha, alpha);
        }`;

      const ivs = createShader(iGL, iGL.VERTEX_SHADER, incVS);
      const ifs = createShader(iGL, iGL.FRAGMENT_SHADER, incFS);
      const incProg = (ivs && ifs) ? createProgram(iGL, ivs, ifs) : null;

      if (incProg) {
        const incPosLoc = iGL.getAttribLocation(incProg, 'aPos');
        const incUTime  = iGL.getUniformLocation(incProg, 'uTime');
        const incURes   = iGL.getUniformLocation(incProg, 'uRes');
        const incUInten = iGL.getUniformLocation(incProg, 'uIntensity');
        const incUHue   = iGL.getUniformLocation(incProg, 'uHueShift');

        const incBuf = iGL.createBuffer();
        iGL.bindBuffer(iGL.ARRAY_BUFFER, incBuf);
        iGL.bufferData(iGL.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), iGL.STATIC_DRAW);

        window._incidentsFXFrame = function(dt) {
          const active = _incGLMode !== '';
          if (active) {
            _incGLInten = Math.min(1, _incGLInten + dt * 2.0);
            _incGLTime += dt;
          } else {
            _incGLInten = Math.max(0, _incGLInten - dt * 3.0);
            if (_incGLInten <= 0) return;
          }

          resizeCanvas(iC, iGL);
          iGL.enable(iGL.BLEND);
          iGL.blendFunc(iGL.SRC_ALPHA, iGL.ONE);
          iGL.clearColor(0, 0, 0, 0);
          iGL.clear(iGL.COLOR_BUFFER_BIT);

          iGL.useProgram(incProg);
          iGL.uniform1f(incUTime, _incGLTime);
          iGL.uniform2f(incURes, iC.width, iC.height);
          iGL.uniform1f(incUInten, _incGLInten);
          iGL.uniform1f(incUHue, _incGLMode === 'penalty' ? 1.0 : 0.0);

          iGL.bindBuffer(iGL.ARRAY_BUFFER, incBuf);
          iGL.enableVertexAttribArray(incPosLoc);
          iGL.vertexAttribPointer(incPosLoc, 2, iGL.FLOAT, false, 0, 0);
          iGL.drawArrays(iGL.TRIANGLE_STRIP, 0, 4);
        };
      }
    }

    // Public API: set incidents fire mode ('', 'penalty', 'dq')
    window.setIncidentsGL = function(mode) {
      const prev = _incGLMode;
      _incGLMode = mode || '';
      if (_incGLMode && !prev) _incGLTime = 0;
      // Toggle CSS class for canvas opacity
      const panel = document.getElementById('incidentsPanel');
      if (panel) panel.classList.toggle('inc-bonkers', _incGLMode !== '');
    };

    /* ════════════════════════════════════════════
       GRID FLAG FX — flag-colored energy tendrils
       that radiate outward beyond the card edges.
       Three flag colors drift as aurora-like wisps,
       with particle sparks at the periphery.
       ════════════════════════════════════════════ */
    // ═══════════════════════════════════════════════════════════════
    // MANUFACTURER COUNTRY FLAG — aurora wisps WebGL effect
    // Shows for 5 seconds on: practice pit exit, quali first timed lap,
    // race green lights. Fades out over 1s via CSS transition.
    // ═══════════════════════════════════════════════════════════════
    const mfrFlagCtx = initGL('mfrFlagCanvas');
    let _mfrFlagActive = false;
    let _mfrFlagTime = 0;
    let _mfrFlagDuration = 5.0; // seconds before fade-out starts
    let _mfrFlagInten = 0;
    let _mfrFlagCol1 = [0.5, 0.5, 0.5];
    let _mfrFlagCol2 = [0.5, 0.5, 0.5];
    let _mfrFlagCol3 = [0.5, 0.5, 0.5];

    if (mfrFlagCtx) {
      const { canvas: mfC, gl: mfGL } = mfrFlagCtx;

      const mfVS = `#version 300 es
        in vec2 aPos;
        out vec2 vUV;
        void main() {
          vUV = aPos * 0.5 + 0.5;
          gl_Position = vec4(aPos, 0.0, 1.0);
        }`;

      // Aurora wisps — same style as grid flag, adapted for logo square
      const mfFS = `#version 300 es
        precision highp float;
        in vec2 vUV;
        out vec4 fragColor;

        uniform float uTime;
        uniform float uIntensity;
        uniform vec2  uRes;
        uniform vec3  uCol1;
        uniform vec3  uCol2;
        uniform vec3  uCol3;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
                     mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
        }
        float fbm(vec2 p) {
          float v = 0.0, a = 0.5;
          for (int i = 0; i < 4; i++) {
            v += a * noise(p);
            p = p * 2.1 + 0.3;
            a *= 0.5;
          }
          return v;
        }

        void main() {
          vec2 uv = vUV;
          float aspect = uRes.x / uRes.y;
          vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
          float t = uTime;

          // ── Aurora wisps: fbm-driven flowing tendrils ──
          float angle = atan(p.y, p.x);
          float dist = length(p);

          // Three color channels at different speeds/offsets
          float n1 = fbm(vec2(angle * 1.2 - t * 0.4, dist * 3.0 + t * 0.2));
          float n2 = fbm(vec2(angle * 1.2 + t * 0.5 + 2.094, dist * 3.0 - t * 0.15));
          float n3 = fbm(vec2(angle * 1.2 - t * 0.35 + 4.189, dist * 3.0 + t * 0.25));

          // Shape each wisp
          float falloff = exp(-dist * 2.5);
          float w1 = pow(n1, 2.5) * falloff;
          float w2 = pow(n2, 2.5) * falloff;
          float w3 = pow(n3, 2.5) * falloff;

          // Boost flag colors for vibrancy
          vec3 c1 = uCol1 * 0.8 + 0.2;
          vec3 c2 = uCol2 * 0.8 + 0.2;
          vec3 c3 = uCol3 * 0.8 + 0.2;

          vec3 col = c1 * w1 + c2 * w2 + c3 * w3;

          // ── Edge glow ──
          float edgeGlow = exp(-dist * 6.0) * 0.35;
          float wTotal = w1 + w2 + w3 + 0.001;
          vec3 edgeCol = (c1 * w1 + c2 * w2 + c3 * w3) / wTotal;
          col += edgeCol * edgeGlow;

          // ── Spark particles ──
          float sparkNoise = noise(uv * 40.0 + t * vec2(1.3, 0.7));
          float sparkMask = smoothstep(0.92, 0.96, sparkNoise) * falloff * 1.5;
          col += edgeCol * sparkMask;

          // ── Breathing pulse ──
          float pulse = 0.85 + 0.15 * sin(t * 1.5);

          float alpha = (w1 + w2 + w3 + edgeGlow + sparkMask * 0.5) * uIntensity * pulse;
          alpha = clamp(alpha, 0.0, 0.7);

          // Soft fade at canvas edges
          float canvasEdge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
          alpha *= smoothstep(0.0, 0.08, canvasEdge);

          fragColor = vec4(col * alpha, alpha);
        }`;

      const mfvs = createShader(mfGL, mfGL.VERTEX_SHADER, mfVS);
      const mffs = createShader(mfGL, mfGL.FRAGMENT_SHADER, mfFS);
      const mfProg = (mfvs && mffs) ? createProgram(mfGL, mfvs, mffs) : null;

      if (mfProg) {
        const mfPosLoc  = mfGL.getAttribLocation(mfProg, 'aPos');
        const mfUTime   = mfGL.getUniformLocation(mfProg, 'uTime');
        const mfUInten  = mfGL.getUniformLocation(mfProg, 'uIntensity');
        const mfURes    = mfGL.getUniformLocation(mfProg, 'uRes');
        const mfUCol1   = mfGL.getUniformLocation(mfProg, 'uCol1');
        const mfUCol2   = mfGL.getUniformLocation(mfProg, 'uCol2');
        const mfUCol3   = mfGL.getUniformLocation(mfProg, 'uCol3');

        const mfBuf = mfGL.createBuffer();
        mfGL.bindBuffer(mfGL.ARRAY_BUFFER, mfBuf);
        mfGL.bufferData(mfGL.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), mfGL.STATIC_DRAW);

        window._mfrFlagFXFrame = function(dt) {
          if (_mfrFlagActive) {
            _mfrFlagInten = Math.min(1, _mfrFlagInten + dt * 2.0);
            _mfrFlagTime += dt;
            // Auto-stop after duration
            if (_mfrFlagTime >= _mfrFlagDuration) {
              _mfrFlagActive = false;
              // Trigger CSS fade-out
              const cvs = document.getElementById('mfrFlagCanvas');
              if (cvs) cvs.classList.remove('flag-visible');
            }
          } else {
            _mfrFlagInten = Math.max(0, _mfrFlagInten - dt * 1.5);
            if (_mfrFlagInten <= 0) return;
          }

          resizeCanvas(mfC, mfGL);
          mfGL.enable(mfGL.BLEND);
          mfGL.blendFunc(mfGL.SRC_ALPHA, mfGL.ONE);
          mfGL.clearColor(0, 0, 0, 0);
          mfGL.clear(mfGL.COLOR_BUFFER_BIT);

          mfGL.useProgram(mfProg);
          mfGL.uniform1f(mfUTime, _mfrFlagTime);
          mfGL.uniform1f(mfUInten, _mfrFlagInten);
          mfGL.uniform2f(mfURes, mfC.width, mfC.height);
          mfGL.uniform3fv(mfUCol1, _mfrFlagCol1);
          mfGL.uniform3fv(mfUCol2, _mfrFlagCol2);
          mfGL.uniform3fv(mfUCol3, _mfrFlagCol3);

          mfGL.bindBuffer(mfGL.ARRAY_BUFFER, mfBuf);
          mfGL.enableVertexAttribArray(mfPosLoc);
          mfGL.vertexAttribPointer(mfPosLoc, 2, mfGL.FLOAT, false, 0, 0);
          mfGL.drawArrays(mfGL.TRIANGLE_STRIP, 0, 4);
        };
      }
    }

    // Public API: trigger the manufacturer flag animation
    window.showMfrFlag = function(hex1, hex2, hex3) {
      function hexToGL(hex) {
        hex = hex.replace('#', '');
        return [
          parseInt(hex.substring(0, 2), 16) / 255,
          parseInt(hex.substring(2, 4), 16) / 255,
          parseInt(hex.substring(4, 6), 16) / 255
        ];
      }
      _mfrFlagCol1 = hexToGL(hex1);
      _mfrFlagCol2 = hexToGL(hex2);
      _mfrFlagCol3 = hexToGL(hex3);
      _mfrFlagActive = true;
      _mfrFlagTime = 0;
      _mfrFlagInten = 0;
      const cvs = document.getElementById('mfrFlagCanvas');
      if (cvs) cvs.classList.add('flag-visible');
    };

    // Public API: cancel early if needed
    window.hideMfrFlag = function() {
      _mfrFlagActive = false;
      const cvs = document.getElementById('mfrFlagCanvas');
      if (cvs) cvs.classList.remove('flag-visible');
    };

    const flagGLCtx = initGL('gridFlagGlCanvas');
    let _flagGLActive = false;
    let _flagGLTime = 0;
    // Flag colors (linear RGB) — updated via setGridFlagColors
    let _gridFlagCol1 = [0.35, 0.55, 0.85];
    let _gridFlagCol2 = [0.6, 0.65, 0.8];
    let _gridFlagCol3 = [0.5, 0.7, 0.95];

    if (flagGLCtx) {
      const { canvas: fC, gl: fGL } = flagGLCtx;

      const flagVS = `#version 300 es
        in vec2 aPos;
        out vec2 vUV;
        void main() {
          vUV = aPos * 0.5 + 0.5;
          gl_Position = vec4(aPos, 0.0, 1.0);
        }`;

      const flagFS = `#version 300 es
        precision highp float;
        in vec2 vUV;
        out vec4 fragColor;

        uniform float uTime;
        uniform float uIntensity;
        uniform vec2  uRes;
        uniform vec3  uCol1;
        uniform vec3  uCol2;
        uniform vec3  uCol3;

        // Noise helpers
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
                     mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
        }
        float fbm(vec2 p) {
          float v = 0.0, a = 0.5;
          for (int i = 0; i < 4; i++) {
            v += a * noise(p);
            p = p * 2.1 + 0.3;
            a *= 0.5;
          }
          return v;
        }

        // Rounded-rect SDF
        float roundedBox(vec2 p, vec2 b, float r) {
          vec2 d = abs(p) - b + r;
          return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
        }

        void main() {
          vec2 uv = vUV;
          float aspect = uRes.x / uRes.y;
          vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
          float t = uTime;

          // Card shape — the inner card occupies ~60% of canvas
          // (canvas extends 80px beyond card on each side)
          vec2 boxSize = vec2(aspect * 0.30, 0.34);
          float r = 0.035;
          float d = roundedBox(p, boxSize, r);

          // Only draw outside the card
          if (d < -0.005) { fragColor = vec4(0.0); return; }

          // ── Aurora wisps: fbm-driven flowing tendrils ──
          float angle = atan(p.y, p.x);
          float edgeDist = max(0.0, d);

          // Three color channels at different speeds/offsets
          float n1 = fbm(vec2(angle * 1.2 - t * 0.4, edgeDist * 3.0 + t * 0.2));
          float n2 = fbm(vec2(angle * 1.2 + t * 0.5 + 2.094, edgeDist * 3.0 - t * 0.15));
          float n3 = fbm(vec2(angle * 1.2 - t * 0.35 + 4.189, edgeDist * 3.0 + t * 0.25));

          // Shape each wisp: strong near edge, fading outward
          float falloff = exp(-edgeDist * 4.5);
          float w1 = pow(n1, 2.5) * falloff;
          float w2 = pow(n2, 2.5) * falloff;
          float w3 = pow(n3, 2.5) * falloff;

          // Boost flag colors for vibrancy
          vec3 c1 = uCol1 * 0.8 + 0.2;
          vec3 c2 = uCol2 * 0.8 + 0.2;
          vec3 c3 = uCol3 * 0.8 + 0.2;

          vec3 col = c1 * w1 + c2 * w2 + c3 * w3;

          // ── Edge glow: soft light hugging the card border ──
          float edgeGlow = exp(-edgeDist * 12.0) * 0.35;
          float wTotal = w1 + w2 + w3 + 0.001;
          vec3 edgeCol = (c1 * w1 + c2 * w2 + c3 * w3) / wTotal;
          col += edgeCol * edgeGlow;

          // ── Spark particles: bright dots at the periphery ──
          float sparkNoise = noise(uv * 40.0 + t * vec2(1.3, 0.7));
          float sparkMask = smoothstep(0.92, 0.96, sparkNoise) * falloff * 1.5;
          col += edgeCol * sparkMask;

          // ── Breathing pulse ──
          float pulse = 0.85 + 0.15 * sin(t * 1.5);

          float alpha = (w1 + w2 + w3 + edgeGlow + sparkMask * 0.5) * uIntensity * pulse;
          alpha = clamp(alpha, 0.0, 0.7);

          // Soft fade at canvas edges to avoid hard cutoff
          float canvasEdge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
          alpha *= smoothstep(0.0, 0.08, canvasEdge);

          fragColor = vec4(col * alpha, alpha);
        }`;

      const fvs = createShader(fGL, fGL.VERTEX_SHADER, flagVS);
      const ffs = createShader(fGL, fGL.FRAGMENT_SHADER, flagFS);
      const flagProg = (fvs && ffs) ? createProgram(fGL, fvs, ffs) : null;

      if (flagProg) {
        const flagPosLoc = fGL.getAttribLocation(flagProg, 'aPos');
        const flagUTime  = fGL.getUniformLocation(flagProg, 'uTime');
        const flagUInten = fGL.getUniformLocation(flagProg, 'uIntensity');
        const flagURes   = fGL.getUniformLocation(flagProg, 'uRes');
        const flagUCol1  = fGL.getUniformLocation(flagProg, 'uCol1');
        const flagUCol2  = fGL.getUniformLocation(flagProg, 'uCol2');
        const flagUCol3  = fGL.getUniformLocation(flagProg, 'uCol3');

        const flagBuf = fGL.createBuffer();
        fGL.bindBuffer(fGL.ARRAY_BUFFER, flagBuf);
        fGL.bufferData(fGL.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), fGL.STATIC_DRAW);

        let _flagInten = 0;

        window._gridFlagFXFrame = function(dt) {
          if (_flagGLActive) {
            _flagInten = Math.min(1, _flagInten + dt * 1.5);
            _flagGLTime += dt;
          } else {
            _flagInten = Math.max(0, _flagInten - dt * 2.0);
            if (_flagInten <= 0) return;
          }

          resizeCanvas(fC, fGL);
          fGL.enable(fGL.BLEND);
          fGL.blendFunc(fGL.SRC_ALPHA, fGL.ONE);
          fGL.clearColor(0, 0, 0, 0);
          fGL.clear(fGL.COLOR_BUFFER_BIT);

          fGL.useProgram(flagProg);
          fGL.uniform1f(flagUTime, _flagGLTime);
          fGL.uniform1f(flagUInten, _flagInten);
          fGL.uniform2f(flagURes, fC.width, fC.height);
          fGL.uniform3fv(flagUCol1, _gridFlagCol1);
          fGL.uniform3fv(flagUCol2, _gridFlagCol2);
          fGL.uniform3fv(flagUCol3, _gridFlagCol3);

          fGL.bindBuffer(fGL.ARRAY_BUFFER, flagBuf);
          fGL.enableVertexAttribArray(flagPosLoc);
          fGL.vertexAttribPointer(flagPosLoc, 2, fGL.FLOAT, false, 0, 0);
          fGL.drawArrays(fGL.TRIANGLE_STRIP, 0, 4);
        };
      }
    }

    // Public API: toggle grid flag WebGL
    window.setGridFlagGL = function(active) {
      _flagGLActive = active;
      if (active) _flagGLTime = 0;
    };

    // Public API: set flag colors for the grid flag glow (hex → linear RGB)
    window.setGridFlagColors = function(hex1, hex2, hex3) {
      function hexToGL(hex) {
        hex = hex.replace('#', '');
        return [
          parseInt(hex.substring(0, 2), 16) / 255,
          parseInt(hex.substring(2, 4), 16) / 255,
          parseInt(hex.substring(4, 6), 16) / 255
        ];
      }
      _gridFlagCol1 = hexToGL(hex1);
      _gridFlagCol2 = hexToGL(hex2);
      _gridFlagCol3 = hexToGL(hex3);
    };

    /* ── Master FX animation loop ── */
    let _lastFXTime = 0;
    // Paused until there is live car data on screen. poll-engine flips this
    // via window.setGLFXActive() on the debounced in-car edges, so the GPU
    // FX loop does zero work at the menus (the GL context stays warm for an
    // instant resume). Starts false — boot is dormant.
    let _fxActive = false;
    function fxLoop(now) {
      const dt = Math.min((now - _lastFXTime) / 1000, 0.05); // cap at 50ms
      _lastFXTime = now;
      // Skip the FX work while dormant (not in a car) or when WebGL effects
      // are disabled. Keep rescheduling so we resume instantly on reactivate.
      if (!_fxActive || (typeof _settings !== 'undefined' && _settings.showWebGL === false)) {
        requestAnimationFrame(fxLoop);
        return;
      }
      if (window._tachoFXFrame) window._tachoFXFrame(dt);
      if (window._flagFXFrame) window._flagFXFrame(dt);
      if (window._lbFXFrame) window._lbFXFrame(dt);
      if (window._lbEvtFXFrame) window._lbEvtFXFrame(dt);
      if (window._k10LogoFXFrame) window._k10LogoFXFrame(dt);
      if (window._spotterFXFrame) window._spotterFXFrame(dt);
      if (window._bonkersFXFrame) window._bonkersFXFrame(dt);
      if (window._incidentsFXFrame) window._incidentsFXFrame(dt);
      if (window._commTrailFXFrame) window._commTrailFXFrame(dt);
      if (window._mfrFlagFXFrame) window._mfrFlagFXFrame(dt);
      if (window._gridFlagFXFrame) window._gridFlagFXFrame(dt);
      if (window._glareFXFrame) window._glareFXFrame(dt);
      requestAnimationFrame(fxLoop);
    }
    requestAnimationFrame((now) => { _lastFXTime = now; requestAnimationFrame(fxLoop); });

    // Active/dormant switch — driven by poll-engine setOverlayActive().
    window.setGLFXActive = function(on) { _fxActive = !!on; };

    /* ── Public API for main update loop ── */
    window.updateGLFX = function(rpmRatio, thr, brk, clt) {
      _tachoRpm = rpmRatio;
      _pedalValues.thr = thr;
      _pedalValues.brk = brk;
      _pedalValues.clt = clt;
    };

    /** Extended telemetry feed for post-processing pipeline.
     *  Call from poll-engine alongside updateGLFX.
     *  @param {object} t — telemetry snapshot:
     *    speed  : mph (raw)
     *    rpm    : 0–1 ratio
     *    latG   : lateral G (signed, positive = right turn)
     *    longG  : longitudinal G (signed, negative = braking)
     *    yawRate: rad/s */
    window.updatePostFX = function(t) {
      if (!t) return;
      if (t.speed !== undefined) _pfx.speedTarget = Math.min(t.speed / 200, 1.0);
      if (t.rpm   !== undefined) _pfx.rpmTarget   = t.rpm;
      if (t.latG  !== undefined) _pfx.latGTarget   = t.latG;
      if (t.longG !== undefined) _pfx.longGTarget  = t.longG;
      if (t.yawRate !== undefined) _pfx.yawRateTarget = t.yawRate;
      if (t.steer !== undefined) _pfx.steerTarget = t.steer;
    };
  })();
