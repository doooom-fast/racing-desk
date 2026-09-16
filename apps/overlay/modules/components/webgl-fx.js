/**
 * @element racecor-webgl-fx
 * @description WebGL2 post-processing effects engine for tachometer and telemetry visualization.
 *
 * Singleton WebGL2 context for full-screen post-processing effects including:
 * - Tachometer bloom glow and heat distortion (color zones, redline pulse)
 * - RPM-driven visual feedback (pulsing intensity at redline)
 * - DPR-aware rendering (HiDPI scaling compensation)
 *
 * Fragment shaders defined as template literals. Handles context loss gracefully.
 * Uniforms driven by real-time telemetry: rpmRatio, throttle, brake, clutch.
 *
 * @property {number} rpmRatio - RPM / maxRPM, 0.0-1.0
 * @property {number} throttle - Throttle input 0.0-1.0
 * @property {number} brake - Brake input 0.0-1.0
 * @property {number} clutch - Clutch input 0.0-1.0
 * @property {boolean} enabled - Enable/disable rendering
 */

(function() {
  'use strict';

  class RaceCorWebGLFX extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });

      this._rpmRatio = 0;
      this._throttle = 0;
      this._brake = 0;
      this._clutch = 0;
      this._enabled = true;

      this._canvas = null;
      this._gl = null;
      this._program = null;
      this._uniforms = {};
      this._buffer = null;
      this._rafId = null;
      this._time = 0;

      this._telemetryHandler = null;
    }

    connectedCallback() {
      this._renderTemplate();
      this._initWebGL();
      this._subscribeToData();
      if (this._enabled) {
        this._startRenderLoop();
      }
    }

    disconnectedCallback() {
      this._stopRenderLoop();
      if (this._telemetryHandler && window) {
        window.removeEventListener('telemetry-update', this._telemetryHandler);
        this._telemetryHandler = null;
      }
      if (this._gl) {
        this._gl = null;
      }
    }

    get rpmRatio() { return this._rpmRatio; }
    set rpmRatio(val) { this._rpmRatio = Math.max(0, Math.min(1, +val || 0)); }

    get throttle() { return this._throttle; }
    set throttle(val) { this._throttle = Math.max(0, Math.min(1, +val || 0)); }

    get brake() { return this._brake; }
    set brake(val) { this._brake = Math.max(0, Math.min(1, +val || 0)); }

    get clutch() { return this._clutch; }
    set clutch(val) { this._clutch = Math.max(0, Math.min(1, +val || 0)); }

    get enabled() { return this._enabled; }
    set enabled(val) {
      this._enabled = !!val;
      if (this._enabled) {
        this._startRenderLoop();
      } else {
        this._stopRenderLoop();
      }
    }

    updateData(snapshot) {
      if (!snapshot) return;

      const dsPre = 'RaceCorProDrive.Plugin.DS.';
      const gameDataPre = 'DataCorePlugin.GameData.';

      const maxRpm = +snapshot[gameDataPre + 'CarSettings_MaxRPM'] || 1;
      this._rpmRatio = +(snapshot[dsPre + 'RpmRatio']) ||
        (maxRpm > 0 ? Math.min(1, (+snapshot[gameDataPre + 'Rpms'] || 0) / maxRpm) : 0);

      // Normalize pedal inputs (server-normalized preferred, fallback to client math)
      let thr = +(snapshot[dsPre + 'ThrottleNorm']);
      let brk = +(snapshot[dsPre + 'BrakeNorm']);
      let clt = +(snapshot[dsPre + 'ClutchNorm']);

      if (!(thr >= 0)) {
        thr = +snapshot[gameDataPre + 'Throttle'] || 0;
        while (thr > 1.01) thr /= 100;
        thr = Math.min(1, Math.max(0, thr));
      }
      if (!(brk >= 0)) {
        brk = +snapshot[gameDataPre + 'Brake'] || 0;
        while (brk > 1.01) brk /= 100;
        brk = Math.min(1, Math.max(0, brk));
      }
      if (!(clt >= 0)) {
        clt = +snapshot[gameDataPre + 'Clutch'] || 0;
        while (clt > 1.01) clt /= 100;
        clt = Math.min(1, Math.max(0, clt));
      }

      this._throttle = thr;
      this._brake = brk;
      this._clutch = clt;
    }

    _renderTemplate() {
      if (!this.shadowRoot) return;

      const template = document.createElement('template');
      template.innerHTML = `
        <style>
          :host {
            display: block;
            width: 100%;
            height: 100%;
          }

          canvas {
            display: block;
            width: 100%;
            height: 100%;
            position: absolute;
            top: 0;
            left: 0;
            pointer-events: none;
          }
        </style>

        <canvas id="webglFxCanvas"></canvas>
      `;

      this.shadowRoot.appendChild(template.content.cloneNode(true));
    }

    _initWebGL() {
      if (!this.shadowRoot) return;

      this._canvas = this.shadowRoot.querySelector('#webglFxCanvas');
      if (!this._canvas) return;

      const gl = this._canvas.getContext('webgl2', {
        alpha: true,
        premultipliedAlpha: true,
        antialias: true
      });

      if (!gl) {
        console.warn('[RaceCorWebGLFX] WebGL2 not available');
        return;
      }

      this._gl = gl;
      this._initShaders();

      if (this._program) {
        this._cacheUniforms();
        this._setupBuffers();
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      }
    }

    _initShaders() {
      if (!this._gl) return;

      const gl = this._gl;

      // Vertex shader: full-screen quad
      const vertexSrc = `#version 300 es
        in vec2 aPos;
        out vec2 vUV;
        void main() {
          vUV = aPos * 0.5 + 0.5;
          gl_Position = vec4(aPos, 0.0, 1.0);
        }`;

      // Fragment shader: tachometer bloom + heat distortion
      const fragmentSrc = `#version 300 es
        precision highp float;
        in vec2 vUV;
        out vec4 fragColor;

        uniform float uRpm;
        uniform float uTime;
        uniform vec2 uRes;
        uniform float uDPR;
        uniform float uThrottle;
        uniform float uBrake;

        vec3 rpmColor(float r) {
          if (r < 0.55) return vec3(0.18, 0.82, 0.34);  // green
          if (r < 0.73) return vec3(0.95, 0.75, 0.15);  // amber
          return vec3(0.92, 0.22, 0.20);                 // red
        }

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0,0.0)), f.x),
                     mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), f.x), f.y);
        }

        void main() {
          vec2 uv = vUV;
          float dprScale = max(uDPR, 1.0);
          float dpr2 = dprScale * dprScale;

          // Heat distortion — active at high RPM
          float heatIntensity = smoothstep(0.75, 0.95, uRpm) * 0.6 * dpr2;
          if (heatIntensity > 0.0) {
            float n1 = noise(uv * 8.0 + uTime * 3.0) * 2.0 - 1.0;
            float n2 = noise(uv * 6.0 - uTime * 2.5 + 50.0) * 2.0 - 1.0;
            uv += vec2(n1, n2) * heatIntensity * 0.012;
          }

          // Bloom glow — bar region is bottom 35% of the block
          float barTop = 0.35;
          float barY = smoothstep(0.0, barTop, uv.y);
          float inBar = 1.0 - barY;

          float fillX = uRpm;
          float xDist = max(0.0, uv.x - fillX);
          float glowFalloff = exp(-xDist * (6.0 / dpr2)) * inBar;

          vec3 col = rpmColor(uRpm);

          float pulse = 1.0;
          if (uRpm >= 0.91) {
            pulse = 0.85 + 0.15 * sin(uTime * 18.0);
          }

          float bloom = glowFalloff * uRpm * 1.2 * dpr2 * pulse;

          float aboveBar = smoothstep(barTop, barTop + 0.3 * dpr2, uv.y);
          float upGlow = aboveBar * exp(-abs(uv.x - fillX * 0.5) * (3.0 / dpr2)) * uRpm * 0.35 * dpr2 * pulse;

          float edgeGlow = exp(-abs(uv.y - barTop) * (25.0 / dpr2)) * smoothstep(0.0, fillX, uv.x) * uRpm * 0.5 * dpr2;

          float alpha = bloom + upGlow + edgeGlow;
          vec3 final = col * alpha;

          // Redline strobe
          if (uRpm >= 0.91) {
            float redStr = smoothstep(0.91, 0.96, uRpm);
            float flash = pow(0.5 + 0.5 * sin(uTime * 22.0), 4.0);
            float flicker = 0.8 + 0.2 * sin(uTime * 55.0 + uv.x * 12.0);
            float vig = 1.0 - 0.2 * length((uv - 0.5) * vec2(0.8, 1.4));
            float flashA = flash * flicker * redStr * vig * 0.5 * dpr2;
            vec3 flashCol = vec3(0.95, 0.08, 0.03);
            final += flashCol * flashA;
            alpha += flashA;

            float scan = 0.88 + 0.12 * sin(uv.y * uRes.y * 0.4 + uTime * 45.0);
            final *= scan;
            alpha *= scan;
          }

          float maxAlpha = dprScale > 1.1 ? 0.95 : 0.85;
          alpha = clamp(alpha, 0.0, maxAlpha);
          fragColor = vec4(final * alpha, alpha);
        }`;

      const vertexShader = this._createShader(gl, gl.VERTEX_SHADER, vertexSrc);
      const fragmentShader = this._createShader(gl, gl.FRAGMENT_SHADER, fragmentSrc);

      if (vertexShader && fragmentShader) {
        this._program = this._createProgram(gl, vertexShader, fragmentShader);
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
      }
    }

    _createShader(gl, type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);

      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.warn('[RaceCorWebGLFX] Shader compile error:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }

      return shader;
    }

    _createProgram(gl, vertexShader, fragmentShader) {
      const program = gl.createProgram();
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.warn('[RaceCorWebGLFX] Program link error:', gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
        return null;
      }

      return program;
    }

    _cacheUniforms() {
      if (!this._gl || !this._program) return;

      const gl = this._gl;
      this._uniforms = {
        aPos: gl.getAttribLocation(this._program, 'aPos'),
        uRpm: gl.getUniformLocation(this._program, 'uRpm'),
        uTime: gl.getUniformLocation(this._program, 'uTime'),
        uRes: gl.getUniformLocation(this._program, 'uRes'),
        uDPR: gl.getUniformLocation(this._program, 'uDPR'),
        uThrottle: gl.getUniformLocation(this._program, 'uThrottle'),
        uBrake: gl.getUniformLocation(this._program, 'uBrake'),
      };
    }

    _setupBuffers() {
      if (!this._gl) return;

      const gl = this._gl;
      this._buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this._buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
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

    _startRenderLoop() {
      if (this._rafId) return;

      const frame = (dt) => {
        this._time += dt / 1000;
        this._renderFrame();
        this._rafId = requestAnimationFrame(frame);
      };

      this._rafId = requestAnimationFrame(frame);
    }

    _stopRenderLoop() {
      if (this._rafId) {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
      }
    }

    _renderFrame() {
      if (!this._gl || !this._program || !this._canvas) return;

      const gl = this._gl;
      const rect = this._canvas.parentElement?.getBoundingClientRect();
      if (!rect) return;

      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);

      if (this._canvas.width !== w || this._canvas.height !== h) {
        this._canvas.width = w;
        this._canvas.height = h;
        gl.viewport(0, 0, w, h);
      }

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(this._program);
      gl.bindBuffer(gl.ARRAY_BUFFER, this._buffer);
      gl.enableVertexAttribArray(this._uniforms.aPos);
      gl.vertexAttribPointer(this._uniforms.aPos, 2, gl.FLOAT, false, 0, 0);

      gl.uniform1f(this._uniforms.uRpm, this._rpmRatio);
      gl.uniform1f(this._uniforms.uTime, this._time);
      gl.uniform2f(this._uniforms.uRes, this._canvas.width, this._canvas.height);
      gl.uniform1f(this._uniforms.uDPR, dpr);
      gl.uniform1f(this._uniforms.uThrottle, this._throttle);
      gl.uniform1f(this._uniforms.uBrake, this._brake);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }

  customElements.define('racecor-webgl-fx', RaceCorWebGLFX);
})();
