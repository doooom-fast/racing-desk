// The HUD on an iPad: a small web server on the home network that serves the HUD's drive view to a browser and
// passes it the telemetry the HUD itself reads. Off unless the driver switches it on (Settings, in the desk).
//
// It sends numbers, never pictures of the game, and it is read-only from the network:
//
//   GET /                   the HUD page, told to ask this server for its telemetry
//   GET /racing-desk/       the telemetry, fetched from the plugin or host on this machine — and nothing else of
//                           theirs: a request carrying a query (?action=…) is refused, so nothing on the network
//                           can change a setting, a pedal profile or the wheel base through here
//   GET /modules/… /images/… /fonts/…   what the page is made of, and no other file of the app's
//   GET /api/action/<name>  the HUD's actions, for a program on this machine (a Stream Deck button), which says so
//                           with the header X-Racing-Desk: 1. Refused to anything that comes over the network, and
//                           to anything a browser sends: a page cannot put that header on a link, an image or a
//                           form, so no page the driver happens to have open can quit the app
//
// Anything from the network has to know the key — eight characters, in the address the Settings page shows and its
// QR code holds. The page hands it back as a cookie, so the address is typed, or scanned, once. A request has to
// name this machine by one of its own addresses, too, which is what stops a web page elsewhere from pointing a
// name of its own at the rig and reading through the browser of somebody at home.
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const DEFAULT_PORT = 9090;
const TELEMETRY_DEFAULT = 'http://localhost:8889';
const TELEMETRY_PATH = '/racing-desk/';
const DASHBOARD_FILE = 'dashboard.html';
const PROXY_TIMEOUT_MS = 3000;
const ACTION_HEADER = 'x-racing-desk';
// Asking Windows for its adapters takes a couple of milliseconds of the main process; the answer keeps.
const ADDRESSES_KEPT_MS = 5000;

// What the page is made of. Everything else in the app's folder — main.js, the settings, logs — stays home.
const STATIC_FOLDERS = Object.freeze(['modules', 'images', 'fonts']);
const MIME = Object.freeze({
  '.css': 'text/css', '.js': 'application/javascript', '.mjs': 'application/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
});

// Keys are typed by nobody but fit in a QR code with the address: no 0, 1, l or o to mistake.
const KEY_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const KEY_LENGTH = 8;
const KEY_COOKIE = 'rdk';
const KEY_PARAM = 'k';

// Adapters that are not the home network: a virtual switch answers to an address nothing in the house can reach.
const VIRTUAL_ADAPTER = /vEthernet|WSL|Hyper-V|VirtualBox|VMware|Loopback|Tailscale|ZeroTier|WireGuard|VPN|TAP-|Bluetooth|Docker/i;

function newKey() {
  let key = '';
  for (const byte of crypto.randomBytes(KEY_LENGTH)) key += KEY_ALPHABET[byte % KEY_ALPHABET.length];
  return key;
}

function isKey(value) {
  return typeof value === 'string' && value.length === KEY_LENGTH && [...value].every((c) => KEY_ALPHABET.includes(c));
}

function sameKey(given, key) {
  if (!isKey(given) || !isKey(key)) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(key));
}

function isPrivateAddress(address) {
  const [a, b] = String(address).split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

// This machine's addresses on a network, the likeliest first: a home network's on a real adapter, then the rest.
function lanAddresses(nets = os.networkInterfaces()) {
  const found = [];
  for (const [name, list] of Object.entries(nets || {})) {
    for (const info of list || []) {
      if (!info || info.internal || (info.family !== 'IPv4' && info.family !== 4)) continue;
      if (String(info.address).startsWith('169.254.')) continue;   // no network answered: nothing is there
      found.push({ name, address: info.address, virtual: VIRTUAL_ADAPTER.test(name), home: isPrivateAddress(info.address) });
    }
  }
  const rank = (a) => (a.virtual ? 2 : 0) + (a.home ? 0 : 1);
  return found.sort((a, b) => rank(a) - rank(b) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function getLanAddress(nets) {
  const first = lanAddresses(nets)[0];
  return first ? first.address : null;
}

// Where the telemetry is, from the address the settings hold. Only an address that ends in the plugin's path is
// the driver's own choice; one from before the rename, or a bare host, is not, and the HUD ignores it likewise
// (modules/js/settings.js).
function telemetryBase(saved) {
  if (typeof saved !== 'string' || !/\/racing-desk\/?$/.test(saved)) return TELEMETRY_DEFAULT;
  try {
    const url = new URL(saved);
    if (url.protocol !== 'http:') return TELEMETRY_DEFAULT;
    return `${url.protocol}//${url.host}`;
  } catch (e) {
    return TELEMETRY_DEFAULT;
  }
}

function isLoopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

// From this machine itself — and not handed on by something on it that takes requests from elsewhere.
function isLocal(req) {
  if (!isLoopback(req.socket && req.socket.remoteAddress)) return false;
  const h = req.headers;
  return h['x-forwarded-for'] === undefined && h.forwarded === undefined && h['x-forwarded-host'] === undefined
    && h['x-real-ip'] === undefined;
}

// Whether a browser sent it. A browser says where a request came from and what it is for (Sec-Fetch-Site and
// -Dest, on every request it makes); a program says neither. Node's own fetch sends Sec-Fetch-Mode and no more,
// so that one alone is not a browser.
function fromBrowser(req) {
  const h = req.headers;
  return h.origin !== undefined || h.referer !== undefined
    || h['sec-fetch-site'] !== undefined || h['sec-fetch-dest'] !== undefined || h['sec-fetch-user'] !== undefined;
}

const HOST_SHAPE = /^([a-z0-9]([a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:]+\])(:\d{1,5})?$/i;

// Whether the request names this machine: by localhost, by one of its own addresses, or by its own name.
function namesThisMachine(hostHeader, addresses, names = []) {
  if (typeof hostHeader !== 'string' || !HOST_SHAPE.test(hostHeader)) return false;
  const hostname = hostHeader.replace(/:\d{1,5}$/, '').toLowerCase();
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') return true;
  if (addresses.some((a) => a.address === hostname)) return true;
  return names.some((name) => typeof name === 'string' && name.length > 0
    && (hostname === name.toLowerCase() || hostname === `${name.toLowerCase()}.local`));
}

function cookieOf(req, name) {
  const header = req.headers.cookie;
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}

const ACTIONS = Object.freeze([
  { name: 'toggle-overlay', label: 'Show / Hide', category: 'app' },
  { name: 'toggle-settings', label: 'Open Settings', category: 'app' },
  { name: 'reset-window', label: 'Reset Window', category: 'app' },
  { name: 'quit', label: 'Quit', category: 'app' },
  { name: 'toggle-drive-mode', label: 'Drive Mode', category: 'hud' },
  { name: 'toggle-leaderboard', label: 'Leaderboard', category: 'hud' },
  { name: 'cycle-rating', label: 'Cycle Rating/Pos', category: 'hud' },
  { name: 'cycle-car-logo', label: 'Cycle Logo', category: 'hud' },
  { name: 'zoom-in', label: 'Zoom In', category: 'hud' },
  { name: 'zoom-out', label: 'Zoom Out', category: 'hud' },
  { name: 'pitbox-next-tab', label: 'Pit Box Next', category: 'pitbox' },
  { name: 'pitbox-prev-tab', label: 'Pit Box Prev', category: 'pitbox' },
  { name: 'dismiss-commentary', label: 'Dismiss Commentary', category: 'commentary' },
  { name: 'toggle-recording', label: 'Record', category: 'recording' },
  { name: 'save-replay-buffer', label: 'Save Replay', category: 'recording' },
  { name: 'toggle-replay-director', label: 'Replay Director', category: 'recording' },
  { name: 'restart-demo', label: 'Restart Demo', category: 'demo' },
  { name: 'reset-trackmap', label: 'Reset Track Map', category: 'demo' },
  { name: 'toggle-rating-editor', label: 'Rating Editor', category: 'editor' },
  { name: 'preset-broadcast', label: 'Broadcast Mode', category: 'preset' },
  { name: 'preset-practice', label: 'Practice Mode', category: 'preset' },
  { name: 'preset-qualifying', label: 'Qualifying Mode', category: 'preset' },
]);

// What the page is given before anything of its own runs: that it is the remote one, and that its telemetry is
// here, at whatever address it was reached by. Worked out in the page, from its own address: nothing the request
// said is written into it.
const INJECTION = `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="referrer" content="no-referrer">
<script>
window._remoteMode = true;
window._simhubUrlOverride = location.origin + '${TELEMETRY_PATH}';
</script>
<style>
/* The app's window is see-through, over the game. A browser's is not: there is nothing behind it but white. */
html { background: #000; }
/* Numbers that have stopped arriving look like numbers: say that they have (game-detect.js sets the class). */
body.rd-no-data::after {
  content: 'No data from the rig';
  position: fixed; top: 0; left: 0; right: 0; z-index: 99997;
  padding: 10px 16px; text-align: center;
  background: #e46767; color: #0b0b0d; font: 600 15px system-ui, sans-serif;
}
#rd-remote-menu-fab {
  position: fixed; bottom: 20px; right: 20px; z-index: 99999;
  width: 44px; height: 44px; border-radius: 50%;
  background: rgba(19,19,22,0.85); border: 1px solid rgba(255,255,255,0.16);
  color: rgba(255,255,255,0.64); font: 22px/42px system-ui, sans-serif; text-align: center;
  cursor: pointer; user-select: none; -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent; opacity: 0.4; transition: opacity 0.2s;
}
#rd-remote-menu-fab.open { opacity: 1; color: #dc3714; }
#rd-remote-menu-panel {
  position: fixed; bottom: 74px; right: 20px; z-index: 99998;
  background: rgba(19,19,22,0.96); border: 1px solid rgba(255,255,255,0.16);
  border-radius: 10px; padding: 6px; min-width: 190px; display: none;
}
#rd-remote-menu-panel.open { display: block; }
.rd-rm-btn {
  display: block; width: 100%; padding: 12px 14px; margin: 0;
  background: transparent; border: none; border-radius: 6px;
  color: rgba(255,255,255,0.94); font: 14px system-ui, sans-serif;
  cursor: pointer; text-align: left; -webkit-tap-highlight-color: transparent;
}
.rd-rm-btn:active { background: rgba(255,255,255,0.08); }
html, body { overscroll-behavior: none; touch-action: manipulation; }
</style>
<script>
document.addEventListener('DOMContentLoaded', function () {
  var fab = document.createElement('div');
  fab.id = 'rd-remote-menu-fab';
  fab.textContent = '\\u2261';
  var panel = document.createElement('div');
  panel.id = 'rd-remote-menu-panel';

  // The whole HUD is laid out for the rig's screen, over the game; on an iPad it is the drive view or nothing.
  var actions = [
    { label: 'Full screen', keep: true, fn: function () {
        var el = document.documentElement;
        if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        else if (el.requestFullscreen || el.webkitRequestFullscreen) (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
      } },
    { label: 'Reconnect', keep: false, fn: function () {
        if (typeof _connFails !== 'undefined') { _connFails = 0; _backoffUntil = 0; }
      } },
  ];
  actions.forEach(function (a) {
    var btn = document.createElement('button');
    btn.className = 'rd-rm-btn';
    btn.textContent = a.label;
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      a.fn();
      if (!a.keep) { fab.classList.remove('open'); panel.classList.remove('open'); }
    });
    panel.appendChild(btn);
  });
  document.body.appendChild(panel);
  document.body.appendChild(fab);
  fab.addEventListener('click', function (e) {
    e.stopPropagation();
    panel.classList.toggle('open', fab.classList.toggle('open'));
  });
  document.addEventListener('click', function () {
    fab.classList.remove('open');
    panel.classList.remove('open');
  });
});
</script>`;

function injectRemoteOverrides(html) {
  // A stylesheet from the internet holds the whole page back until it arrives — for as long as it takes to give
  // up, when the iPad has the rig and no internet. The page is drawn in the fonts it has.
  const local = html.replace(/<link\b[^>]*\bhref=["']https?:\/\/[^"']*["'][^>]*>\s*/gi, '');
  if (local.includes('<head>')) return local.replace('<head>', () => `<head>${INJECTION}`);
  return local.replace('<body', () => `${INJECTION}<body`);
}

const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });

function sendJson(res, status, body) {
  res.writeHead(status, { ...NO_STORE, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function sendText(res, status, text) {
  res.writeHead(status, { ...NO_STORE, 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

// The file for a path of the page's, or null for anything that is not one of the page's files.
function staticFile(appDir, pathname) {
  const parts = pathname.split('/').filter((p) => p.length);
  if (parts.length < 2 || !STATIC_FOLDERS.includes(parts[0])) return null;
  if (parts.some((p) => p === '.' || p === '..' || p.includes('\\') || p.includes(':') || p.includes('\0'))) return null;
  const ext = path.extname(parts[parts.length - 1]).toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(MIME, ext)) return null;
  const base = path.resolve(appDir);
  const resolved = path.resolve(base, ...parts);
  const relative = path.relative(base, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return { file: resolved, type: MIME[ext] };
}

function proxyTelemetry(config, res) {
  const target = `${config.telemetryBase}${TELEMETRY_PATH}`;
  const failed = (detail) => {
    if (!res.headersSent) sendJson(res, 502, { error: 'The telemetry is not answering on the rig.', detail });
    else if (!res.writableEnded) res.end();
  };
  const upstream = (config.get || http.get)(target, { timeout: PROXY_TIMEOUT_MS }, (answer) => {
    try {
      // Telemetry is JSON whatever the rig calls it, and a status is one a browser knows.
      const status = Number.isInteger(answer.statusCode) && answer.statusCode >= 200 && answer.statusCode <= 599 ? answer.statusCode : 502;
      res.writeHead(status, { ...NO_STORE, 'Content-Type': 'application/json; charset=utf-8' });
      if (typeof answer.on === 'function') {
        answer.on('error', () => failed('the answer broke off'));
        answer.on('close', () => { if (!res.writableEnded) res.end(); });
      }
      answer.pipe(res);
    } catch (err) {
      failed(err.message);
    }
  });
  upstream.on('error', (err) => failed(err.message));
  upstream.on('timeout', () => upstream.destroy(new Error('timeout')));
  upstream.on('upgrade', (_answer, socket) => { socket.destroy(); failed('the rig answered with something that is not telemetry'); });
}

// The whole of what the server does with a request. `config` is { appDir, telemetryBase, key, dispatchAction,
// addresses() } — and `get`, for the tests, in place of http.get.
function handleRequest(config, req, res) {
  let url;
  let pathname;
  try {
    url = new URL(req.url, 'http://rig');
    pathname = decodeURIComponent(url.pathname);
  } catch (e) {
    sendText(res, 400, 'Not an address.');
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(res, 405, 'This server is read-only.');
    return;
  }

  const local = isLocal(req);
  const NEEDS_KEY = 'This address needs its key. Open the address the Racing Desk shows under Settings, or scan its code.';
  if (!namesThisMachine(req.headers.host, config.addresses(), config.names ? config.names() : [])) {
    // The network is told no more than it is about a missing key: not which names are the rig's.
    sendText(res, 403, local ? 'That is not this machine\'s name.' : NEEDS_KEY);
    return;
  }

  // The actions are for a program on this machine that says it is one, never for the network and never for a
  // browser — not a page's script, and not a link, an image or a form in one either.
  if (pathname === '/api/actions' || pathname.startsWith('/api/action/')) {
    if (!local || fromBrowser(req) || req.headers[ACTION_HEADER] !== '1' || req.method !== 'GET') {
      sendJson(res, 403, { ok: false, reason: 'actions are for programs on the rig itself' });
      return;
    }
    if (pathname === '/api/actions') {
      sendJson(res, 200, { actions: ACTIONS });
      return;
    }
    const name = pathname.slice('/api/action/'.length).replace(/\/$/, '');
    if (!ACTIONS.some((a) => a.name === name)) sendJson(res, 404, { ok: false, reason: `unknown action: ${name}` });
    else if (typeof config.dispatchAction !== 'function') sendJson(res, 503, { ok: false, reason: 'action dispatcher not initialized' });
    else sendJson(res, 200, config.dispatchAction(name));
    return;
  }

  const given = url.searchParams.get(KEY_PARAM);
  if (!local && !sameKey(given, config.key) && !sameKey(cookieOf(req, KEY_COOKIE), config.key)) {
    sendText(res, 403, NEEDS_KEY);
    return;
  }

  if (pathname === '/api/status') {
    sendJson(res, 200, { app: 'The Racing Desk', remoteServer: true });
    return;
  }

  if (pathname === '/racing-desk' || pathname === TELEMETRY_PATH) {
    if (url.search.length) {
      sendJson(res, 403, { error: 'Read-only from here: the telemetry, and nothing that changes anything.' });
      return;
    }
    proxyTelemetry(config, res);
    return;
  }

  if (pathname === '/') {
    fs.readFile(path.join(config.appDir, DASHBOARD_FILE), 'utf8', (err, html) => {
      if (err) {
        sendText(res, 404, `${DASHBOARD_FILE} not found`);
        return;
      }
      const headers = {
        ...NO_STORE,
        'Content-Type': 'text/html; charset=utf-8',
        'Referrer-Policy': 'no-referrer',
        // Nobody else's page gets to hold this one inside it.
        'Content-Security-Policy': "frame-ancestors 'none'",
        'X-Frame-Options': 'DENY',
      };
      // The key came in the address: from here on the browser carries it, and the address can lose it.
      if (sameKey(given, config.key)) {
        headers['Set-Cookie'] = `${KEY_COOKIE}=${config.key}; Max-Age=31536000; Path=/; HttpOnly; SameSite=Strict`;
      }
      res.writeHead(200, headers);
      res.end(injectRemoteOverrides(html));
    });
    return;
  }

  const found = staticFile(config.appDir, pathname);
  if (!found) {
    sendText(res, 404, 'Not found');
    return;
  }
  fs.readFile(found.file, (err, data) => {
    if (err) {
      sendText(res, 404, 'Not found');
      return;
    }
    res.writeHead(200, { 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Content-Type': found.type });
    res.end(data);
  });
}

// ── The one server the app runs ──

let _server = null;
let _starting = null;
let _port = DEFAULT_PORT;
let _key = null;
let _logFn = console.log;
let _dispatchAction = null;   // main.js's, handed over with setActionDispatcher()

function addressFor(address, port, key) {
  return `http://${address}:${port}/${key ? `?${KEY_PARAM}=${key}` : ''}`;
}

let _addresses = { at: 0, list: [] };
function keptAddresses(now = Date.now()) {
  if (now - _addresses.at >= ADDRESSES_KEPT_MS) _addresses = { at: now, list: lanAddresses() };
  return _addresses.list;
}

function getInfo() {
  const addresses = lanAddresses();
  const lanAddress = addresses.length ? addresses[0].address : null;
  return {
    running: _server !== null,
    port: _port,
    lanAddress,
    // The address to open on the iPad, key and all; null when the rig is on no network.
    url: lanAddress && _key ? addressFor(lanAddress, _port, _key) : null,
    addresses: addresses.map((a) => ({ name: a.name, address: a.address, url: _key ? addressFor(a.address, _port, _key) : null })),
  };
}

// opts: { port, appDir, telemetryUrl (as the settings hold it), key, log, host (the tests' — 127.0.0.1) }
function start(opts = {}) {
  if (_server) return Promise.resolve(getInfo());
  // Two starts at once are one start: the second would otherwise leave a listener nothing could stop.
  if (_starting) return _starting;
  _starting = listen(opts).finally(() => { _starting = null; });
  return _starting;
}

function listen(opts) {
  return new Promise((resolve, reject) => {
    if (!isKey(opts.key)) {
      reject(new Error('The server needs a key before it is reachable from the network.'));
      return;
    }
    const port = Number.isInteger(opts.port) && opts.port >= 1024 && opts.port <= 65535 ? opts.port : DEFAULT_PORT;
    const log = opts.log || console.log;
    const base = telemetryBase(opts.telemetryUrl);
    // Telemetry fetched from this very server would be fetched from this very server, and so on.
    if (new RegExp(`^http://(localhost|127\\.0\\.0\\.1|\\[::1\\]):${port}$`, 'i').test(base)) {
      reject(new Error(`Port ${port} is where the telemetry is read from. Choose another port.`));
      return;
    }
    const config = {
      appDir: opts.appDir || __dirname,
      telemetryBase: base,
      key: opts.key,
      get dispatchAction() { return _dispatchAction; },
      addresses: () => keptAddresses(),
      names: () => [os.hostname()],
    };
    const server = http.createServer((req, res) => {
      try {
        handleRequest(config, req, res);
      } catch (err) {
        log(`[RacingDesk] Remote server: ${req.method} ${String(req.url).split('?')[0]} failed: ${err.message}`);
        if (!res.headersSent) sendText(res, 500, 'The rig could not answer that.');
        else res.end();
      }
    });
    server.once('error', (err) => {
      log(`[RacingDesk] Remote server did not start: ${err.message}`);
      reject(err.code === 'EADDRINUSE' ? new Error(`Port ${port} is in use by another program. Choose another port.`) : err);
    });
    // An iPad is one connection, or a few. Whatever opens hundreds and says nothing is not one.
    server.maxConnections = 64;
    server.headersTimeout = 10000;
    server.requestTimeout = 15000;
    server.listen(port, opts.host || '0.0.0.0', () => {
      _server = server;
      _port = server.address().port;
      _key = opts.key;
      _logFn = log;
      const info = getInfo();
      // The key stays out of the log: the address without it is enough to say the server is up.
      _logFn(`[RacingDesk] Remote server listening on port ${_port}${info.lanAddress ? ` (${info.lanAddress})` : ''}, telemetry from ${config.telemetryBase}`);
      resolve(info);
    });
  });
}

function stop() {
  return new Promise((resolve) => {
    if (!_server) {
      resolve();
      return;
    }
    const server = _server;
    _server = null;
    server.close(() => {
      _logFn('[RacingDesk] Remote server stopped');
      resolve();
    });
    // A browser holds its connection open between polls; closing them is what lets the port go now.
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  });
}

function isRunning() {
  return _server !== null;
}

function setActionDispatcher(fn) {
  _dispatchAction = fn;
}

module.exports = {
  DEFAULT_PORT, TELEMETRY_DEFAULT, ACTIONS, ACTION_HEADER, KEY_COOKIE, KEY_PARAM,
  start, stop, isRunning, getInfo, getLanAddress, setActionDispatcher,
  // The parts, for the tests.
  newKey, isKey, lanAddresses, telemetryBase, namesThisMachine, isLocal, fromBrowser, staticFile, injectRemoteOverrides,
  handleRequest,
};
