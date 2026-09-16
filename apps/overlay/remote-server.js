// ═══════════════════════════════════════════════════════════════
// K10 Motorsports — Remote Dashboard Server
// LAN-accessible HTTP server that serves dashboard.html and
// proxies SimHub telemetry so any browser on the network can
// view the dashboard with a single URL.
// ═══════════════════════════════════════════════════════════════

const http = require('http');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

// ── Constants ────────────────────────────────────────────────
const DEFAULT_PORT = 9090;
const SIMHUB_DEFAULT = 'http://localhost:8889';
const DASHBOARD_FILE = 'dashboard.html';

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.mjs': 'application/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.ttf': 'font/ttf', '.map': 'application/json',
};

// ── State ────────────────────────────────────────────────────
let _server      = null;
let _port        = DEFAULT_PORT;
let _appDir      = __dirname;
let _simhubBase  = SIMHUB_DEFAULT;
let _logFn       = console.log;
let _dispatchAction = null;  // set by main.js via setActionDispatcher()

// ── LAN IP helper ────────────────────────────────────────────
function getLanAddress() {
  const nets = os.networkInterfaces();
  for (const iface of Object.values(nets)) {
    for (const info of iface) {
      if (info.family === 'IPv4' && !info.internal) return info.address;
    }
  }
  return '0.0.0.0';
}

// ── Proxy a request to the SimHub plugin ─────────────────────
function proxyToSimhub(req, res) {
  const target = `${_simhubBase}${req.url}`;

  const proxyReq = http.get(target, { timeout: 3000 }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, {
      'Content-Type': proxyRes.headers['content-type'] || 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: 'SimHub unreachable', detail: err.message }));
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    res.writeHead(504, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: 'SimHub timeout' }));
  });
}

// ── Serve a static file ──────────────────────────────────────
function serveFile(filePath, res) {
  const resolved = path.resolve(filePath);
  const resolvedBase = path.resolve(_appDir);
  const relative = path.relative(resolvedBase, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(resolved, (err, data) => {
    if (err) {
      res.writeHead(404); res.end('Not found'); return;
    }
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(data);
  });
}

// ── Inject remote-mode overrides + touch menu ────────────────
// Rewrites the dashboard's SimHub URL to proxy through this server
// (so remote browsers don't need direct access to localhost:8889)
// and adds a floating touch menu for settings/fullscreen.
function injectRemoteOverrides(html, req) {
  const host = req.headers.host || `${getLanAddress()}:${_port}`;
  const proxyUrl = `http://${host}/racecor-io-pro-drive/`;

  const injection = `<script>
// ── K10 Remote Server Injection ──
window._simhubUrlOverride = '${proxyUrl}';
window._k10RemoteMode = true;
</script>
<style>
/* ── Touch Menu ── */
#k10-remote-menu-fab {
  position: fixed; bottom: 20px; right: 20px; z-index: 99999;
  width: 48px; height: 48px; border-radius: 50%;
  background: rgba(108,92,231,0.85); border: 2px solid rgba(255,255,255,0.2);
  color: #fff; font-size: 22px; line-height: 48px; text-align: center;
  cursor: pointer; user-select: none; -webkit-user-select: none;
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 4px 20px rgba(0,0,0,0.4);
  transition: transform 0.2s, background 0.2s;
  -webkit-tap-highlight-color: transparent;
}
#k10-remote-menu-fab:active { transform: scale(0.9); }
#k10-remote-menu-fab.open { background: rgba(108,92,231,1); transform: rotate(45deg); }

#k10-remote-menu-panel {
  position: fixed; bottom: 80px; right: 20px; z-index: 99998;
  background: rgba(16,16,30,0.95); border: 1px solid rgba(108,92,231,0.4);
  border-radius: 14px; padding: 8px; min-width: 200px;
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  box-shadow: 0 8px 32px rgba(0,0,0,0.6);
  transform: translateY(10px) scale(0.95); opacity: 0;
  pointer-events: none; transition: all 0.2s ease;
}
#k10-remote-menu-panel.open {
  transform: translateY(0) scale(1); opacity: 1; pointer-events: auto;
}

.k10-rm-btn {
  display: flex; align-items: center; gap: 10px;
  width: 100%; padding: 12px 14px; margin: 0;
  background: transparent; border: none; border-radius: 10px;
  color: #e0e0e0; font-size: 14px; font-family: system-ui, sans-serif;
  cursor: pointer; text-align: left; -webkit-tap-highlight-color: transparent;
  transition: background 0.15s;
}
.k10-rm-btn:active { background: rgba(108,92,231,0.3); }
.k10-rm-btn .k10-rm-icon { font-size: 18px; width: 24px; text-align: center; flex-shrink: 0; }
.k10-rm-btn .k10-rm-label { flex: 1; }
.k10-rm-sep { height: 1px; background: rgba(255,255,255,0.08); margin: 4px 8px; }

@media (display-mode: fullscreen) {
  #k10-remote-menu-fab { opacity: 0.3; }
  #k10-remote-menu-fab:hover, #k10-remote-menu-fab.open { opacity: 1; }
}

html, body { overscroll-behavior: none; touch-action: manipulation; }
</style>
<script>
document.addEventListener('DOMContentLoaded', () => {
  const fab = document.createElement('div');
  fab.id = 'k10-remote-menu-fab';
  fab.textContent = '+';

  const panel = document.createElement('div');
  panel.id = 'k10-remote-menu-panel';

  const actions = [
    { icon: '\\uD83D\\uDD04', label: 'Cycle Rating/Pos', fn: () => { if (typeof cycleRatingPos === 'function') cycleRatingPos(); } },
    { icon: '\\uD83D\\uDE97', label: 'Cycle Car Logo',   fn: () => { if (typeof cycleCarLogo === 'function') cycleCarLogo(); } },
    { sep: true },
    { icon: '\\uD83D\\uDCFA', label: 'Fullscreen',       fn: () => {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
        else document.exitFullscreen?.();
      }
    },
    { icon: '\\uD83D\\uDD17', label: 'Reconnect',        fn: () => {
        if (typeof _connFails !== 'undefined') { _connFails = 0; _backoffUntil = 0; }
      }
    },
  ];

  actions.forEach(a => {
    if (a.sep) {
      const sep = document.createElement('div');
      sep.className = 'k10-rm-sep';
      panel.appendChild(sep);
      return;
    }
    const btn = document.createElement('button');
    btn.className = 'k10-rm-btn';
    btn.innerHTML = '<span class="k10-rm-icon">' + a.icon + '</span><span class="k10-rm-label">' + a.label + '</span>';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      a.fn();
      if (a.label !== 'Fullscreen') {
        fab.classList.remove('open');
        panel.classList.remove('open');
      }
    });
    panel.appendChild(btn);
  });

  document.body.appendChild(panel);
  document.body.appendChild(fab);

  fab.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = fab.classList.toggle('open');
    panel.classList.toggle('open', isOpen);
  });

  document.addEventListener('click', () => {
    fab.classList.remove('open');
    panel.classList.remove('open');
  });
});
</script>`;

  if (html.includes('<head>')) {
    return html.replace('<head>', '<head>' + injection);
  }
  return html.replace('<body', injection + '<body');
}

// ── Request handler ──────────────────────────────────────────
function handleRequest(req, res) {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // ── Telemetry proxy: /racecor-io-pro-drive/*
  if (urlPath.startsWith('/racecor-io-pro-drive')) {
    proxyToSimhub(req, res);
    return;
  }

  // ── Stream Deck Action API: /api/action/:name ──
  // Simple GET request triggers an overlay action and returns JSON result.
  // Example: GET http://192.168.1.100:9090/api/action/toggle-settings
  if (urlPath.startsWith('/api/action/')) {
    const actionName = urlPath.replace('/api/action/', '').replace(/\/$/, '');
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    if (!_dispatchAction) {
      res.end(JSON.stringify({ ok: false, reason: 'action dispatcher not initialized' }));
    } else {
      const result = _dispatchAction(actionName);
      res.end(JSON.stringify(result));
    }
    return;
  }

  // ── Stream Deck Action List: /api/actions ──
  // Returns all available action names for discovery/configuration.
  if (urlPath === '/api/actions') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({
      actions: [
        // Window / App
        { name: 'toggle-overlay',     label: 'Show / Hide',       category: 'app' },
        { name: 'toggle-settings',    label: 'Open Settings',     category: 'app' },
        { name: 'reset-window',       label: 'Reset Window',      category: 'app' },
        { name: 'quit',               label: 'Quit',              category: 'app' },
        // HUD
        { name: 'toggle-drive-mode',  label: 'Drive Mode',        category: 'hud' },
        { name: 'toggle-leaderboard', label: 'Leaderboard',       category: 'hud' },
        { name: 'cycle-rating',       label: 'Cycle Rating/Pos',  category: 'hud' },
        { name: 'cycle-car-logo',     label: 'Cycle Logo',        category: 'hud' },
        { name: 'zoom-in',            label: 'Zoom In',           category: 'hud' },
        { name: 'zoom-out',           label: 'Zoom Out',          category: 'hud' },
        // Pit Box
        { name: 'pitbox-next-tab',    label: 'Pit Box Next',      category: 'pitbox' },
        { name: 'pitbox-prev-tab',    label: 'Pit Box Prev',      category: 'pitbox' },
        // Commentary
        { name: 'dismiss-commentary', label: 'Dismiss Commentary', category: 'commentary' },
        // Recording
        { name: 'toggle-recording',       label: 'Record',            category: 'recording' },
        { name: 'save-replay-buffer',     label: 'Save Replay',       category: 'recording' },
        { name: 'toggle-replay-director', label: 'Replay Director',   category: 'recording' },
        // Demo
        { name: 'restart-demo',       label: 'Restart Demo',      category: 'demo' },
        { name: 'reset-trackmap',     label: 'Reset Track Map',   category: 'demo' },
        // Editors
        { name: 'toggle-rating-editor',  label: 'Rating Editor',  category: 'editor' },
        // Presets
        { name: 'preset-broadcast',  label: 'Broadcast Mode',     category: 'preset' },
        { name: 'preset-practice',   label: 'Practice Mode',      category: 'preset' },
        { name: 'preset-qualifying', label: 'Qualifying Mode',    category: 'preset' },
      ]
    }));
    return;
  }

  // ── Health/info endpoint
  if (urlPath === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({
      app: 'K10 Motorsports',
      remoteServer: true,
      port: _port,
      lanAddress: getLanAddress(),
    }));
    return;
  }

  // ── Root: serve dashboard.html with injected proxy URL
  if (urlPath === '/' || urlPath === '') {
    const htmlPath = path.join(_appDir, DASHBOARD_FILE);
    fs.readFile(htmlPath, 'utf8', (err, html) => {
      if (err) {
        res.writeHead(404); res.end(`${DASHBOARD_FILE} not found`); return;
      }
      const patched = injectRemoteOverrides(html, req);
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(patched);
    });
    return;
  }

  // ── Fallback: serve static files from app directory
  const filePath = path.join(_appDir, urlPath);
  serveFile(filePath, res);
}

// ═══════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════

function start(opts = {}) {
  return new Promise((resolve, reject) => {
    if (_server) {
      const info = getInfo();
      resolve(info);
      return;
    }

    _port      = opts.port     || DEFAULT_PORT;
    _appDir    = opts.appDir   || __dirname;
    _simhubBase = opts.simhubUrl || SIMHUB_DEFAULT;
    _logFn     = opts.log      || console.log;

    _simhubBase = _simhubBase.replace(/\/+$/, '');

    _server = http.createServer(handleRequest);

    _server.listen(_port, '0.0.0.0', () => {
      const info = getInfo();
      _logFn(`[K10 Motorsports] Remote dashboard server started: ${info.url}`);
      resolve(info);
    });

    _server.on('error', (err) => {
      _logFn(`[K10 Motorsports] Remote server error: ${err.message}`);
      _server = null;
      reject(err);
    });
  });
}

function stop() {
  return new Promise((resolve) => {
    if (!_server) { resolve(); return; }
    _server.close(() => {
      _logFn('[K10 Motorsports] Remote dashboard server stopped');
      _server = null;
      resolve();
    });
  });
}

function isRunning() {
  return _server !== null;
}

function getInfo() {
  const lanAddress = getLanAddress();
  return {
    running: _server !== null,
    port: _port,
    lanAddress,
    url: `http://${lanAddress}:${_port}`,
  };
}

function setActionDispatcher(fn) {
  _dispatchAction = fn;
}

module.exports = { start, stop, isRunning, getInfo, getLanAddress, DEFAULT_PORT, setActionDispatcher };
