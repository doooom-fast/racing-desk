// The HUD on an iPad: a small web server on the home network that serves the HUD to a browser, laid out as a glance
// display (drive mode: the HUD's own panels as the cells of a grid that fills the screen), and passes it the
// telemetry the HUD itself reads. Off unless the driver switches it on (Settings, in the desk).
//
// It sends numbers, never pictures of the game, and it is read-only from the network:
//
//   GET /                   the HUD page, told to ask this server for its telemetry. It is the only page that asks
//                           the internet for anything: Adobe's kit of the HUD's typefaces, once the page has loaded
//   GET /racing-desk/       the telemetry, fetched from the plugin or host on this machine — and nothing else of
//                           theirs: a request carrying a query (?action=…) is refused, so nothing on the network
//                           can change a setting, a pedal profile or the wheel base through here
//   GET /modules/… /images/… /fonts/…   what the page is made of, and no other file of the app's
//   GET /livery-crop.png    the crop of the car's paint behind the HUD's car badge, as the main process holds it in
//                           memory (modules/js/logo-livery.js): one fixed address, no query, nothing from disk, and
//                           404 while there is none. The page asks for it again when the car changes
//   GET /api/action/<name>  the HUD's actions, for a program on this machine (a Stream Deck button), which says so
//                           with the header X-Racing-Desk: 1. Refused to anything that comes over the network, and
//                           to anything a browser sends: a page cannot put that header on a link, an image or a
//                           form, so no page the driver happens to have open can quit the app
//
// Two of these servers run (createServer): the iPad's, on the home network while its switch is on, and one that is
// always up on 127.0.0.1 alone (`loopback: true`, port 9091 by default, `localServerPort`) for the programs on this
// machine: the Stream Deck's buttons, whatever the iPad switch says, and OBS, which may draw the HUD itself
// (docs/recording.md, "HUD drawn by OBS"). The loopback one serves three things more, and the iPad's refuses them:
//
//   GET /obs                   the HUD page in OBS mode: told it is OBS's (window._obsMode), its telemetry here, his
//                              display settings (below), no black background, no iPad menu and no key — a browser
//                              source's address in OBS's scene file carries nothing
//   GET /api/settings-display  his display settings, the allowlist alone (DISPLAY_SETTINGS: the zoom, the position,
//                              the panels, the look): never a key, the paints, the iPad's or the recording's keys.
//                              The OBS page asks every ten seconds
//   GET /api/status            with { inCar, hudVisible, recording } beside the two words it always said
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
// The crop behind the car badge, from memory (never a file): the page asks for it here and nowhere else.
const CROP_PATH = '/livery-crop.png';
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
  { name: 'quit', label: 'Quit Overlay', category: 'app' },   // the HUD is put away; the app carries on
  { name: 'toggle-drive-mode', label: 'Drive Mode', category: 'hud' },
  { name: 'toggle-leaderboard', label: 'Leaderboard', category: 'hud' },
  { name: 'cycle-rating', label: 'Cycle Rating/Pos', category: 'hud' },
  { name: 'cycle-car-logo', label: 'Cycle Logo', category: 'hud' },
  { name: 'zoom-in', label: 'Zoom In', category: 'hud' },
  { name: 'zoom-out', label: 'Zoom Out', category: 'hud' },
  { name: 'pitbox-next-tab', label: 'Pit Box Next', category: 'pitbox' },
  { name: 'pitbox-prev-tab', label: 'Pit Box Prev', category: 'pitbox' },
  { name: 'dismiss-commentary', label: 'Dismiss Commentary', category: 'commentary' },
  // Recording is OBS's (modules/js/obs): Record and Stop are one action, the Stream Deck's "Toggle Recording" button.
  { name: 'toggle-recording', label: 'Record', category: 'recording' },
  { name: 'start-recording', label: 'Record', category: 'recording' },
  { name: 'stop-recording', label: 'Stop recording', category: 'recording' },
  { name: 'save-replay-buffer', label: 'Save Replay', category: 'recording' },
  { name: 'tv-shots', label: 'TV shots', category: 'recording' },
  { name: 'restart-demo', label: 'Restart Demo', category: 'demo' },
  { name: 'reset-trackmap', label: 'Reset Track Map', category: 'demo' },
  { name: 'toggle-rating-editor', label: 'Rating Editor', category: 'editor' },
  { name: 'preset-broadcast', label: 'Broadcast Mode', category: 'preset' },
  { name: 'preset-practice', label: 'Practice Mode', category: 'preset' },
  { name: 'preset-qualifying', label: 'Qualifying Mode', category: 'preset' },
]);

// The settings the HUD page in OBS is told of: what the rig's own HUD draws by — the panels (show*), the zoom, the
// position, the look, the leaderboard's rows, the glance layout's switch — and nothing that is a key, a folder, an
// address or a device. A key not listed here is not sent, whatever is added to the settings file later.
const DISPLAY_SETTINGS = Object.freeze([
  'zoom', 'layoutPosition', 'bottomYOffset', 'visualPreset', 'theme', 'ambientMode', 'driveMode', 'rallyMode',
  'lbMaxRows', 'lbFocus', 'lbExpandToFill', 'logoSubtitle', 'incPenalty', 'incDQ', 'forceFlag',
]);
const DISPLAY_SETTING_PATTERN = /^show[A-Z]/;
const LOCAL_DEFAULT_PORT = 9091;
const OBS_PATH = '/obs';
const SETTINGS_PATH = '/api/settings-display';

/** His settings cut down to what the OBS page may be told (DISPLAY_SETTINGS and the show* switches). */
function displaySettingsOf(settings) {
  const out = {};
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) return out;
  for (const [key, value] of Object.entries(settings)) {
    if (!DISPLAY_SETTINGS.includes(key) && !DISPLAY_SETTING_PATTERN.test(key)) continue;
    if (value !== null && typeof value === 'object') continue;   // a setting is a word, a number or a switch
    out[key] = value;
  }
  return out;
}

// What the page is given before anything of its own runs: that it is the remote one, and that its telemetry is
// here, at whatever address it was reached by. Worked out in the page, from its own address: nothing the request
// said is written into it.
//
// The faces are the HUD's own (sofia-pro-comp and stolzl, from Adobe's kit) and the iPad is drawn in them, but the
// page never waits for them. A stylesheet from the internet holds the whole page back until it arrives, for as long
// as it takes to give up when the iPad has the rig and no internet, so the kit is taken out of what is served
// and asked for by a script once the page has loaded. Adobe serves it to any address (its web projects have no
// list of domains to add this one to), with or without a referrer, and its fonts may not be copied or passed on, so
// the rig never serves them: the iPad fetches them from Adobe itself. Until the text face has arrived the page is
// in the condensed faces iPadOS has (`:root:not(.rd-kit)`), so its text is never invisible and never late, and a
// page with no internet stays in them.
// The kit's stylesheet, added by script once the page has loaded (both pages).
function kitScript(kits) {
  return `addEventListener('load', function () {
  var kits = ${kits};
  var faces = ['700 1em sofia-pro-comp', '400 1em stolzl'];
  kits.forEach(function (href) {
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = function () {
      // The text face is the one the glance layout is set in: with it, the page changes over. The display face is asked
      // for alongside and is the fallback stack's till it comes.
      Promise.all(faces.map(function (face) { return document.fonts.load(face); })).then(function (loaded) {
        if (loaded[0].length > 0) document.documentElement.classList.add('rd-kit');
      }, function () {});
    };
    document.head.appendChild(link);
  });
});`;
}

// The HUD's faces until the kit's have arrived (both pages).
const FALLBACK_FACES = `:root:not(.rd-kit) {
  --ff: "Avenir Next Condensed", "Helvetica Neue", sans-serif;
  --ff-display: "Avenir Next", "Helvetica Neue", sans-serif;
}`;

// What the HUD page in OBS is given: that it is OBS's (window._obsMode — not the iPad's: the page lays itself out as
// the rig's HUD, not as the glance layout, and decides in-car for itself as the iPad does), its telemetry here, his
// display settings now and where to ask for them again, and the one rule that hides it out of the car — the rig's
// window is hidden then; a browser source is not, and a frozen HUD over the garage would be in the picture. No
// background (a browser source composites over the game), no menu, no key.
function obsInjection(kits, settingsJson) {
  return `<meta name="referrer" content="no-referrer">
<script>
window._obsMode = true;
window._simhubUrlOverride = location.origin + '${TELEMETRY_PATH}';
window._obsSettings = ${settingsJson};
window._obsSettingsUrl = '${SETTINGS_PATH}';
document.documentElement.classList.add('rd-obs');
// Hidden until the telemetry says he is in the car: the page starts out idle and says so only on a change.
document.addEventListener('DOMContentLoaded', function () { document.body.classList.add('idle-state'); });
${kitScript(kits)}
</script>
<style>
html, body { background: transparent; }
/* Out of the car the page is not drawn at all: OBS would composite whatever it showed over the garage and the menus. */
html.rd-obs body.idle-state { visibility: hidden; }
${FALLBACK_FACES}
</style>`;
}

function injection(kits) {
  return `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="referrer" content="no-referrer">
<script>
window._remoteMode = true;
window._simhubUrlOverride = location.origin + '${TELEMETRY_PATH}';
document.documentElement.classList.add('rd-remote');
// The HUD's effects are drawn here as on the rig unless they were switched off from the menu, on this iPad, before.
try { window._rdEffectsOff = localStorage.getItem('rd-effects') === 'off'; } catch (e) { window._rdEffectsOff = false; }
if (window._rdEffectsOff) document.documentElement.classList.add('rd-effects-off');
${kitScript(kits)}
</script>
<style>
/* The app's window is see-through, over the game. A browser's is not: there is nothing behind it but white. */
html { background: #000; }
/* The HUD's faces until the kit's have arrived. */
${FALLBACK_FACES}
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
  display: block; width: 100%; padding: 14px 16px; margin: 0;
  background: transparent; border: none; border-radius: 6px;
  color: rgba(255,255,255,0.94); font: 600 16px var(--ff, system-ui), system-ui, sans-serif;
  cursor: pointer; text-align: left; -webkit-tap-highlight-color: transparent;
}
.rd-rm-btn:active { background: rgba(255,255,255,0.08); }
/* In the glance layout (modules/styles/drive-view.css) the menu is laid over the Racing Desk mark, the one touch
   target on the screen: the whole square answers a tap, and the menu's sign sits in its corner. Its list opens from
   it, upward or downward, where there is room (the script below). */
body.drive-mode-active #rd-remote-menu-fab {
  grid-area: brand; position: relative; inset: auto; z-index: 20;
  width: auto; height: auto; min-width: 44px; min-height: 44px;
  display: flex; align-items: flex-start; justify-content: flex-end;
  padding: 3px 7px;
  border-radius: var(--corner-r, 8px);
  background: transparent; border: 1px solid transparent;
  color: rgba(255,255,255,0.62);
  font: 400 clamp(18px, 2.8vmin, 30px)/1 system-ui, sans-serif;
  opacity: 1;
}
body.drive-mode-active #rd-remote-menu-fab.open { color: #dc3714; border-color: rgba(220,55,20,0.6); }
html, body { overscroll-behavior: none; touch-action: manipulation; }
</style>
<script>
document.addEventListener('DOMContentLoaded', function () {
  var fab = document.createElement('div');
  fab.id = 'rd-remote-menu-fab';
  fab.textContent = '\\u2261';
  var panel = document.createElement('div');
  panel.id = 'rd-remote-menu-panel';

  // The whole HUD is laid out for the rig's screen, over the game; on an iPad it is the glance layout or nothing.
  var actions = [
    { label: 'Full screen', keep: true, fn: function () {
        var el = document.documentElement;
        if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        else if (el.requestFullscreen || el.webkitRequestFullscreen) (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
      } },
    { label: 'Reconnect', keep: false, fn: function () {
        if (typeof _connFails !== 'undefined') { _connFails = 0; _backoffUntil = 0; }
      } },
    // The HUD's effects (the WebGL glows, the flag's moving pattern) cost an iPad its frame rate: one that stutters
    // can go without them. Kept on this iPad; the numbers, the colours and the flags are the same either way.
    { label: function () { return window._rdEffectsOff ? 'Effects: off' : 'Effects: on'; }, keep: true, fn: function () {
        var off = !window._rdEffectsOff;
        window._rdEffectsOff = off;
        try { localStorage.setItem('rd-effects', off ? 'off' : 'on'); } catch (e) {}
        document.documentElement.classList.toggle('rd-effects-off', off);
        var inCar = typeof _isIdle === 'undefined' || !_isIdle;
        if (typeof window.setGLFXActive === 'function') window.setGLFXActive(!off && inCar);
        if (off && typeof window.stopAmbientLight === 'function') window.stopAmbientLight();
        if (!off && inCar && typeof window.startAmbientLight === 'function') window.startAmbientLight();
      } },
  ];
  var labelOf = function (a) { return typeof a.label === 'function' ? a.label() : a.label; };
  actions.forEach(function (a) {
    var btn = document.createElement('button');
    btn.className = 'rd-rm-btn';
    btn.textContent = labelOf(a);
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      a.fn();
      btn.textContent = labelOf(a);
      if (!a.keep) { fab.classList.remove('open'); panel.classList.remove('open'); }
    });
    panel.appendChild(btn);
  });
  document.body.appendChild(panel);
  document.body.appendChild(fab);
  // In the glance layout the list opens from the menu's square, on the side of it with the more room, on screen.
  function place() {
    if (!document.body.classList.contains('drive-mode-active')) return;
    var r = fab.getBoundingClientRect();
    var w = panel.offsetWidth, gap = 8;
    panel.style.right = 'auto';
    panel.style.left = Math.max(gap, Math.min(r.left, innerWidth - w - gap)) + 'px';
    if (r.top > innerHeight - r.bottom) { panel.style.top = 'auto'; panel.style.bottom = (innerHeight - r.top + gap) + 'px'; }
    else { panel.style.bottom = 'auto'; panel.style.top = (r.bottom + gap) + 'px'; }
  }
  fab.addEventListener('click', function (e) {
    e.stopPropagation();
    panel.classList.toggle('open', fab.classList.toggle('open'));
    if (panel.classList.contains('open')) place();
  });
  document.addEventListener('click', function () {
    fab.classList.remove('open');
    panel.classList.remove('open');
  });
});
</script>`;
}

// The kits the page names (a stylesheet on use.typekit.net), the only thing the page is allowed to ask the internet
// for, and only once it has loaded.
const KIT_LINK = /^https:\/\/use\.typekit\.net\/[A-Za-z0-9]+\.css$/i;

// A stylesheet from the internet is taken out of the page, whichever it is: the kit comes back after the load, from
// the script above, and nothing else does. The page is drawn in the fonts it has until then.
function stripKits(html) {
  const kits = [];
  const local = html.replace(/<link\b[^>]*\bhref=["'](https?:\/\/[^"']*)["'][^>]*>\s*/gi, (tag, href) => {
    if (KIT_LINK.test(href) && !kits.includes(href)) kits.push(href);
    return '';
  });
  // The addresses are the page's own, not the request's; the escape is for a script tag's sake all the same.
  return { local, kits: JSON.stringify(kits).replace(/</g, '\\u003c') };
}

function addToHead(local, add) {
  if (local.includes('<head>')) return local.replace('<head>', () => `<head>${add}`);
  return local.replace('<body', () => `${add}<body`);
}

function injectRemoteOverrides(html) {
  const { local, kits } = stripKits(html);
  return addToHead(local, injection(kits));
}

// The OBS page: `settings` is his settings whole, cut down here to what displaySettingsOf lets through and written
// into the page as JSON (a setting is a word, a number or a switch; the escape is for a script tag's sake all the same).
function injectObsOverrides(html, settings) {
  const { local, kits } = stripKits(html);
  const json = JSON.stringify(displaySettingsOf(settings)).replace(/</g, '\\u003c');
  return addToHead(local, obsInjection(kits, json));
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
// addresses(), crop(), loopback, status(), displaySettings() } — and `get`, for the tests, in place of http.get.
// `crop()` is the crop of the car's paint behind the badge as the main process holds it, { png, id } or null; left
// out, there is never one. `loopback` is the listener on 127.0.0.1 alone, the one that serves the OBS page and the
// display settings; `status()` is what the app says of the HUD and the recording, `displaySettings()` his settings
// whole (cut down here, never sent whole).
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
    else {
      // A recording action waits on OBS (modules/js/obs), so an answer may be a promise: the Stream Deck's tick or cross
      // goes by what it resolves to, as it did by what was returned.
      Promise.resolve().then(() => config.dispatchAction(name)).then(
        (answer) => sendJson(res, 200, answer),
        (err) => sendJson(res, 500, { ok: false, reason: err && err.message ? err.message : String(err) }),
      );
    }
    return;
  }

  const given = url.searchParams.get(KEY_PARAM);
  if (!local && !sameKey(given, config.key) && !sameKey(cookieOf(req, KEY_COOKIE), config.key)) {
    sendText(res, 403, NEEDS_KEY);
    return;
  }

  if (pathname === '/api/status') {
    let more = {};
    try { more = typeof config.status === 'function' ? config.status() : {}; } catch (e) { more = {}; }
    if (more === null || typeof more !== 'object') more = {};
    sendJson(res, 200, { app: 'The Racing Desk', remoteServer: true, loopback: !!config.loopback, ...more });
    return;
  }

  // The OBS page and his display settings: the loopback listener's alone. The iPad's answers as it does to any
  // address it has no page for.
  if (pathname === SETTINGS_PATH) {
    if (!config.loopback) { sendText(res, 404, 'Not found'); return; }
    let settings = null;
    try { settings = typeof config.displaySettings === 'function' ? config.displaySettings() : null; } catch (e) { settings = null; }
    sendJson(res, 200, displaySettingsOf(settings));
    return;
  }

  if (pathname === OBS_PATH) {
    if (!config.loopback || url.search.length) { sendText(res, 404, 'Not found'); return; }
    fs.readFile(path.join(config.appDir, DASHBOARD_FILE), 'utf8', (err, html) => {
      if (err) { sendText(res, 404, `${DASHBOARD_FILE} not found`); return; }
      let settings = null;
      try { settings = typeof config.displaySettings === 'function' ? config.displaySettings() : null; } catch (e) { settings = null; }
      res.writeHead(200, {
        ...NO_STORE,
        'Content-Type': 'text/html; charset=utf-8',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "frame-ancestors 'none'",
        'X-Frame-Options': 'DENY',
      });
      res.end(injectObsOverrides(html, settings));
    });
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

  // The crop behind the car badge: what the main process holds, whole, from memory. The address is the one and
  // takes no query; nothing in the request names a file, and nothing on disk is read for it.
  if (pathname === CROP_PATH) {
    if (url.search.length) {
      sendText(res, 404, 'Not found');
      return;
    }
    let crop = null;
    try { crop = typeof config.crop === 'function' ? config.crop() : null; } catch (e) { crop = null; }
    if (!crop || !Buffer.isBuffer(crop.png) || !crop.png.length) {
      sendText(res, 404, 'No livery crop to show.');
      return;
    }
    res.writeHead(200, {
      ...NO_STORE,
      'Content-Type': 'image/png',
      'Content-Length': crop.png.length,
      // The page keeps the crop it has when it is told the same one again; the tag says which it is and no more.
      ETag: `"${String(crop.id == null ? crop.png.length : crop.id).replace(/[^\w.-]/g, '')}"`,
    });
    res.end(crop.png);
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

// ── The servers the app runs ──
// Two of one kind (createServer): the iPad's on the home network, switched on from the desk, and the loopback one,
// always up on 127.0.0.1 for the programs on this machine. Each keeps its own listener; the action dispatcher is
// one for both (setActionDispatcher: main.js's). The module's own start/stop/getInfo/isRunning are the iPad's, as
// they always were.

let _dispatchAction = null;   // main.js's, handed over with setActionDispatcher()

function addressFor(address, port, key) {
  return `http://${address}:${port}/${key ? `?${KEY_PARAM}=${key}` : ''}`;
}

let _addresses = { at: 0, list: [] };
function keptAddresses(now = Date.now()) {
  if (now - _addresses.at >= ADDRESSES_KEPT_MS) _addresses = { at: now, list: lanAddresses() };
  return _addresses.list;
}

// `loopback`: the listener on 127.0.0.1 alone, whatever `host` a start says, serving the OBS page and the display
// settings; its address is never shown as one to open on an iPad (getInfo says 127.0.0.1 and no key).
function createServer({ loopback = false } = {}) {
  let _server = null;
  let _starting = null;
  let _port = loopback ? LOCAL_DEFAULT_PORT : DEFAULT_PORT;
  let _key = null;
  let _logFn = console.log;
  const name = loopback ? 'Local server' : 'Remote server';

  function getInfo() {
    if (loopback) {
      return { running: _server !== null, port: _port, loopback: true, lanAddress: null, url: _server ? `http://127.0.0.1:${_port}/` : null, addresses: [] };
    }
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

  // opts: { port, appDir, telemetryUrl (as the settings hold it), key, log, crop (the badge's crop, from memory),
  // host (the tests' — 127.0.0.1), status (what the app says of the HUD and the recording, for /api/status),
  // displaySettings (his settings, for the OBS page and /api/settings-display, loopback only) }
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
      const port = Number.isInteger(opts.port) && opts.port >= 1024 && opts.port <= 65535 ? opts.port : (loopback ? LOCAL_DEFAULT_PORT : DEFAULT_PORT);
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
        loopback,
        get dispatchAction() { return _dispatchAction; },
        addresses: () => keptAddresses(),
        names: () => [os.hostname()],
        crop: typeof opts.crop === 'function' ? opts.crop : () => null,
        status: typeof opts.status === 'function' ? opts.status : null,
        displaySettings: typeof opts.displaySettings === 'function' ? opts.displaySettings : null,
      };
      const server = http.createServer((req, res) => {
        try {
          handleRequest(config, req, res);
        } catch (err) {
          log(`[RacingDesk] ${name}: ${req.method} ${String(req.url).split('?')[0]} failed: ${err.message}`);
          if (!res.headersSent) sendText(res, 500, 'The rig could not answer that.');
          else res.end();
        }
      });
      server.once('error', (err) => {
        log(`[RacingDesk] ${name} did not start: ${err.message}`);
        reject(err.code === 'EADDRINUSE' ? new Error(`Port ${port} is in use by another program. Choose another port.`) : err);
      });
      // An iPad is one connection, or a few. Whatever opens hundreds and says nothing is not one.
      server.maxConnections = 64;
      server.headersTimeout = 10000;
      server.requestTimeout = 15000;
      server.listen(port, loopback ? '127.0.0.1' : (opts.host || '0.0.0.0'), () => {
        _server = server;
        _port = server.address().port;
        _key = opts.key;
        _logFn = log;
        const info = getInfo();
        // The key stays out of the log: the address without it is enough to say the server is up.
        if (loopback) _logFn(`[RacingDesk] ${name} listening on 127.0.0.1:${_port} (the Stream Deck's buttons, the HUD for OBS), telemetry from ${config.telemetryBase}`);
        else _logFn(`[RacingDesk] ${name} listening on port ${_port}${info.lanAddress ? ` (${info.lanAddress})` : ''}, telemetry from ${config.telemetryBase}`);
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
        _logFn(`[RacingDesk] ${name} stopped`);
        resolve();
      });
      // A browser holds its connection open between polls; closing them is what lets the port go now.
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    });
  }

  function isRunning() {
    return _server !== null;
  }

  return { start, stop, isRunning, getInfo, loopback };
}

function setActionDispatcher(fn) {
  _dispatchAction = fn;
}

// The iPad's server, which the module's own functions are.
const lan = createServer();

module.exports = {
  DEFAULT_PORT, LOCAL_DEFAULT_PORT, TELEMETRY_DEFAULT, ACTIONS, ACTION_HEADER, KEY_COOKIE, KEY_PARAM, CROP_PATH, OBS_PATH, SETTINGS_PATH,
  DISPLAY_SETTINGS,
  start: lan.start, stop: lan.stop, isRunning: lan.isRunning, getInfo: lan.getInfo, getLanAddress, setActionDispatcher,
  createServer,
  // The parts, for the tests.
  newKey, isKey, lanAddresses, telemetryBase, namesThisMachine, isLocal, fromBrowser, staticFile, injectRemoteOverrides,
  injectObsOverrides, displaySettingsOf, handleRequest,
};
