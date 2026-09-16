// ═══════════════════════════════════════════════════════════════
// K10 Motorsports — Electron Overlay
// Transparent, always-on-top, click-through overlay window
// that renders the HTML dashboard over the sim
// ═══════════════════════════════════════════════════════════════

const { app, BrowserWindow, ipcMain, screen, globalShortcut, shell, Menu, desktopCapturer, session, powerMonitor } = require('electron');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const http   = require('http');
const https  = require('https');
const crypto = require('crypto');
const remoteServer = require('./remote-server');
const updater      = require('./modules/js/auto-updater');
const ffmpegEncoder  = require('./modules/js/ffmpeg-encoder');
const bundleWriter   = require('./modules/js/bundle-writer');
const replayDirector = require('./modules/js/replay-director');

// ── Crash log ───────────────────────────────────────────────
// Write a log file next to the app so crash info is visible
const LOG_PATH = path.join(__dirname, 'k10-debug.log');
function logToFile(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}\n`;
  try { fs.appendFileSync(LOG_PATH, line); } catch (e) { /* non-critical */ }
  console.log(msg);
}

// Catch crashes that would silently kill the process
process.on('uncaughtException', (err) => {
  logToFile(`UNCAUGHT EXCEPTION: ${err.stack || err.message}`);
});
process.on('unhandledRejection', (reason) => {
  logToFile(`UNHANDLED REJECTION: ${reason}`);
});

// ── App name ──────────────────────────────────────────────────
app.setName('K10 Motorsports');

// ── GPU / sandbox flags ─────────────────────────────────────
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('disable-software-rasterizer');

// ── Anti-throttling ─────────────────────────────────────────
// The overlay is never the focused window (the sim is) and gets
// classified as occluded whenever a fullscreen sim covers the
// screen. Without these, Chromium backgrounds the renderer and
// throttles requestAnimationFrame + timers to ~1fps — every
// animation goes choppy and stays choppy until the app is
// relaunched. An always-on HUD must render at full rate even
// when Chromium thinks it is in the background.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

if (process.env.K10_FORCE_SOFTWARE === '1') {
  app.disableHardwareAcceleration();
}

// ── Settings helpers ─────────────────────────────────────────
function getSettingsPath() {
  return path.join(app.getPath('userData'), 'overlay-settings.json');
}

function loadSettingsSync() {
  try {
    return JSON.parse(fs.readFileSync(getSettingsPath(), 'utf8'));
  } catch (e) {
    return {};
  }
}

// Stamp the timestamp of the last write originating from this process so the
// settings-file watcher can ignore its own writes (it only re-broadcasts
// changes made by the WinUI host).
let _lastSelfSettingsWriteAt = 0;
function saveSettingsSync(settings) {
  fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2));
  _lastSelfSettingsWriteAt = Date.now();
}

// ── iRating / Safety Rating persistence ──────────────────────
function getRatingPath() {
  return path.join(app.getPath('userData'), 'irating-history.json');
}

function loadRatingData() {
  try {
    return JSON.parse(fs.readFileSync(getRatingPath(), 'utf8'));
  } catch (e) {
    return { iRating: 0, safetyRating: 0, history: [] };
  }
}

function saveRatingData(data) {
  fs.writeFileSync(getRatingPath(), JSON.stringify(data, null, 2));
}

// (Local asset server removed — no longer needed. Dashboard is a single inlined HTML file.)

// ── State ────────────────────────────────────────────────────
// Overlay settings UI is gone — all settings live in the Windows host
// app now. This process is a pure read-only HUD: load settings.json,
// apply via modules/js/settings.js, render. No popout windows, no
// settings mode, no in-overlay editors.
let overlayWindow = null;
let isInRace = false;            // true when poll-engine reports live car data (drives overlay visibility)
let rendererCrashCount = 0;

// ── Session-gated visibility ─────────────────────────────────
// The overlay window is created hidden and only shown while there is
// live car data to display. poll-engine (in the renderer) flips isInRace
// via IPC when the driver is in the car (gameRunning && session active,
// or demo mode). When not in a car the window stays hidden AND the
// renderer goes dormant (slow poll, paused FX) so the overlay never
// competes with the sim for CPU/GPU/network — notably while iRacing
// loads its anti-cheat at the menus. There is no "logo-only" idle screen.
// Single dashboard: vanilla TypeScript build (Vite-bundled, single-file HTML)
const DASHBOARD_FILE = 'dashboard.html';

function getDashboardFile() {
  return DASHBOARD_FILE;
}

async function createOverlay() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = primaryDisplay.bounds;

  logToFile(`[K10] Dashboard: ${getDashboardFile()}`);
  logToFile(`[K10] Primary display: ${screenW}x${screenH} at (${primaryDisplay.bounds.x}, ${primaryDisplay.bounds.y})`);

  /** Load the dashboard into the overlay window via file:// (all assets inlined). */
  function loadDashboard() {
    logToFile('[K10] Loading dashboard via file://');
    overlayWindow.loadFile(path.join(__dirname, getDashboardFile()));
  }

  // ── Transparent overlay window ──
  // macOS: use workArea to respect the dock and menu bar.
  // Windows: use full bounds so the overlay covers the entire screen over the game.
  const isMac = process.platform === 'darwin';
  const overlayBounds = isMac ? primaryDisplay.workArea : primaryDisplay.bounds;

  overlayWindow = new BrowserWindow({
    width:  overlayBounds.width,
    height: overlayBounds.height,
    x:      overlayBounds.x,
    y:      overlayBounds.y,
    icon: path.join(__dirname, 'images', 'branding', 'icon.png'),
    // Created hidden — shown only while there is live car data (isInRace).
    show: false,
    frame: false,
    alwaysOnTop: true,
    // Session-only window — never a persistent taskbar tile.
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: false,
    minimizable: false,
    maximizable: false,
    transparent: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      // Never throttle the HUD when it is unfocused or occluded —
      // see the anti-throttling command-line switches above.
      backgroundThrottling: false
    }
  });

  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  loadDashboard();
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  logToFile('[K10] Overlay created hidden — awaiting live car data (isInRace)');

  overlayWindow.webContents.on('did-finish-load', () => {
    rendererCrashCount = 0;
  });

  overlayWindow.on('closed', () => { overlayWindow = null; });

  // ── Reflow overlay when system UI changes ──
  // Windows: taskbar auto-hide changes workArea — reflow to full bounds.
  // macOS: dock resize/show/hide changes workArea — reflow to workArea.
  screen.on('display-metrics-changed', (_event, display, changedMetrics) => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    if (!changedMetrics.includes('workArea') && !changedMetrics.includes('bounds')) return;

    const primary = screen.getPrimaryDisplay();
    if (display.id !== primary.id) return;

    // macOS: respect dock/menu bar via workArea. Windows: cover full screen.
    const target = process.platform === 'darwin' ? primary.workArea : primary.bounds;
    const cur = overlayWindow.getBounds();
    if (cur.x === target.x && cur.y === target.y && cur.width === target.width && cur.height === target.height) return;

    logToFile(`[K10] Display metrics changed (${changedMetrics.join(', ')}), reflowing overlay to ${target.width}x${target.height}`);
    overlayWindow.setBounds({ x: target.x, y: target.y, width: target.width, height: target.height });
  });

  // ── Windows: periodically re-assert always-on-top ──────────
  // DirectX fullscreen exclusive mode can steal z-order even from
  // screen-saver level windows. Re-assert every 5 seconds — but only
  // while the overlay is actually shown (in-car). When hidden there is
  // nothing to keep on top, and skipping the churn keeps us dormant.
  if (process.platform === 'win32') {
    setInterval(() => {
      if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()) {
        overlayWindow.setAlwaysOnTop(false);
        overlayWindow.setAlwaysOnTop(true, 'screen-saver');
      }
    }, 5000);
  }

  // ── Crash recovery ──────────────────────────────────────────
  overlayWindow.webContents.on('render-process-gone', (_event, details) => {
    logToFile(`[K10] Renderer crashed: ${details.reason}`);
    if (details.reason === 'crashed' || details.reason === 'killed') {
      rendererCrashCount++;
      if (rendererCrashCount > 3) {
        logToFile('[K10] Renderer crash limit reached (3) — giving up');
        return;
      }
      setTimeout(() => {
        if (overlayWindow && !overlayWindow.isDestroyed()) {
          loadDashboard();
        }
      }, 2000);
    }
  });

  overlayWindow.webContents.on('unresponsive', () => {
    logToFile('[K10] Renderer unresponsive — reloading');
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      loadDashboard();
    }
  });

  // ── GPU process crash handler ───────────────────────────────
  app.on('child-process-gone', (_event, details) => {
    logToFile(`[K10] Child process gone: type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`);
    if (details.type === 'GPU') {
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        logToFile('[K10] GPU process crashed — reloading dashboard');
        setTimeout(() => {
          if (overlayWindow && !overlayWindow.isDestroyed()) {
            loadDashboard();
          }
        }, 2000);
      }
    }
  });

  // ── System resume recovery ──────────────────────────────────
  // After display or system sleep the GPU context and renderer
  // can come back throttled or with lost WebGL contexts — the
  // state the user otherwise clears with a manual restart.
  // Reload the dashboard on resume so the overlay self-heals.
  powerMonitor.on('resume', () => {
    logToFile('[K10] System resumed — reloading dashboard');
    setTimeout(() => {
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        loadDashboard();
      }
    }, 1500);
  });
}

// ── Remote Dashboard Server ──────────────────────────────────
// Auto-start the LAN server if enabled in settings
async function maybeStartRemoteServer() {
  const settings = loadSettingsSync();
  if (settings.remoteServer !== true) return;
  try {
    const simhubUrl = settings.simhubUrl
      ? settings.simhubUrl.replace(/\/racecor-io-pro-drive\/?$/, '')
      : 'http://localhost:8889';
    const info = await remoteServer.start({
      port: settings.remoteServerPort || remoteServer.DEFAULT_PORT,
      appDir: __dirname,
      simhubUrl: simhubUrl,
      log: logToFile,
    });
    logToFile(`[K10] Remote dashboard: ${info.url} (iPad/tablet access)`);
  } catch (err) {
    logToFile(`[K10] Remote server failed to start: ${err.message}`);
  }
}

logToFile('[K10] App starting...');

app.whenReady().then(() => {
  // Remove the default Electron menu bar (File/Edit/View/etc) from all windows
  Menu.setApplicationMenu(null);

  logToFile(`[K10] Platform: ${os.platform()} ${os.arch()} | Electron ${process.versions.electron}`);
  logToFile('[K10] Hotkeys: Ctrl+Shift+H/R/D/M/Q');
  try {
    createOverlay();
    logToFile('[K10] Overlay window created OK');

    // ── Display media handler for screen recording ──
    // Electron 33+ requires this to allow getDisplayMedia() in the renderer.
    // Automatically grant access to the primary screen without a picker dialog.
    session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen'] });
        if (sources.length > 0) {
          callback({ video: sources[0], audio: 'loopback' });
        } else {
          callback({ video: null });
        }
      } catch (err) {
        logToFile(`[K10] Display media handler error: ${err.message}`);
        callback({ video: null });
      }
    });

    // ── Media permission handler for facecam + mic ──
    // The overlay window is transparent + focusable:false, so a Chromium
    // permission prompt would have no UI surface and silently fail. The
    // overlay is loaded from a local file:// origin we ship, so granting
    // these is safe. Without this, getUserMedia({video}) never opens the
    // camera and the green light never turns on, even after the user
    // picks a device in the Windows host's Settings page.
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      if (permission === 'media' || permission === 'mediaKeySystem'
          || permission === 'display-capture' || permission === 'fullscreen') {
        callback(true);
        return;
      }
      callback(false);
    });
    session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
      if (permission === 'media' || permission === 'mediaKeySystem'
          || permission === 'display-capture' || permission === 'fullscreen') {
        return true;
      }
      return false;
    });

    maybeStartRemoteServer();
    updater.initAutoUpdater(overlayWindow, logToFile);
    startSettingsWatcher();

    // ── Auto-install Stream Deck plugin on first run ──
    autoInstallStreamDeckPlugin();
  } catch (err) {
    logToFile(`[K10] FATAL: createOverlay() threw: ${err.stack || err.message}`);
    app.quit();
    return;
  }

  // ── AUTO-CONNECT iRacing ──
  // Open the iRacing web client and start syncing on app launch.
  // No clicks needed — just opens the window and goes.
  //
  // ── GLOBAL HOTKEYS ──

  globalShortcut.register('CommandOrControl+Shift+H', () => {
    if (overlayWindow) {
      if (overlayWindow.isVisible()) overlayWindow.hide();
      else overlayWindow.show();
    }
  });

  globalShortcut.register('CommandOrControl+Shift+R', () => {
    if (!overlayWindow) return;
    const { width: sw, height: sh } = screen.getPrimaryDisplay().bounds;
    overlayWindow.setBounds({ x: 0, y: 0, width: sw, height: sh });
    console.log('[K10] Window position/size reset');
  });

  globalShortcut.register('CommandOrControl+Shift+G', () => {
    // Toggle green-screen mode and restart
    const settings = loadSettingsSync();
    settings.greenScreen = !settings.greenScreen;
    saveSettingsSync(settings);
    const mode = settings.greenScreen ? 'green-screen' : 'transparent';
    console.log(`[K10] Toggling to ${mode} mode — restarting...`);
    app.relaunch();
    app.exit(0);
  });

  globalShortcut.register('CommandOrControl+Shift+Q', () => {
    app.quit();
  });

  globalShortcut.register('CommandOrControl+Shift+D', () => {
    if (overlayWindow) overlayWindow.webContents.send('restart-demo');
  });

  globalShortcut.register('CommandOrControl+Shift+M', () => {
    if (overlayWindow) overlayWindow.webContents.send('reset-trackmap');
  });

  globalShortcut.register('CommandOrControl+Shift+I', () => {
    if (overlayWindow) overlayWindow.webContents.send('toggle-rating-editor');
  });

  globalShortcut.register('CommandOrControl+Shift+F', () => {
    if (overlayWindow) overlayWindow.webContents.send('toggle-drive-mode');
  });

  globalShortcut.register('CommandOrControl+Shift+V', () => {
    if (overlayWindow) overlayWindow.webContents.send('toggle-recording');
  });

  globalShortcut.register('CommandOrControl+Shift+B', () => {
    if (overlayWindow) overlayWindow.webContents.send('save-replay-buffer');
  });

  globalShortcut.register('CommandOrControl+Shift+P', () => {
    if (overlayWindow) overlayWindow.webContents.send('toggle-replay-director');
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// ═══════════════════════════════════════════════════════════════
// STREAM DECK ACTION API
// Centralized dispatcher for all overlay actions. Called by
// both global hotkeys and the HTTP action endpoint so Stream
// Deck can trigger any action via a simple GET request.
// ═══════════════════════════════════════════════════════════════

const _actionHandlers = {
  // ── Window / App ──
  'toggle-overlay': () => {
    if (!overlayWindow) return { ok: false, reason: 'no window' };
    if (overlayWindow.isVisible()) overlayWindow.hide();
    else overlayWindow.show();
    return { ok: true, visible: overlayWindow.isVisible() };
  },
  'toggle-settings': () => {
    // Settings UI lives in the WinUI host now. Deep-link via the
    // racecor-native:// protocol scheme the host registers — activating
    // the URI brings the host window to the front (single-instance
    // behavior) and the host's protocol handler can route to Settings.
    // Falls back gracefully if the host isn't installed.
    try {
      shell.openExternal('racecor-native://settings');
      return { ok: true };
    } catch (err) {
      logToFile(`[K10] toggle-settings failed: ${err.message}`);
      return { ok: false, reason: err.message };
    }
  },
  'reset-window': () => {
    if (!overlayWindow) return { ok: false, reason: 'no window' };
    const { width: sw, height: sh } = screen.getPrimaryDisplay().bounds;
    overlayWindow.setBounds({ x: 0, y: 0, width: sw, height: sh });
    return { ok: true };
  },
  'quit': () => {
    app.quit();
    return { ok: true };
  },

  // ── Renderer IPC passthrough ──
  'restart-demo':           () => _sendRenderer('restart-demo'),
  'reset-trackmap':         () => _sendRenderer('reset-trackmap'),
  'toggle-rating-editor':   () => _sendRenderer('toggle-rating-editor'),
  'toggle-drive-mode':      () => _sendRenderer('toggle-drive-mode'),
  'toggle-recording':       () => _sendRenderer('toggle-recording'),
  'save-replay-buffer':     () => _sendRenderer('save-replay-buffer'),
  'toggle-replay-director': () => _sendRenderer('toggle-replay-director'),

  // ── New actions (not bound to hotkeys) ──
  'pitbox-next-tab':     () => _sendRenderer('pitbox-next-tab'),
  'pitbox-prev-tab':     () => _sendRenderer('pitbox-prev-tab'),
  'dismiss-commentary':  () => _sendRenderer('dismiss-commentary'),
  'cycle-rating':        () => _sendRenderer('cycle-rating'),
  'cycle-car-logo':      () => _sendRenderer('cycle-car-logo'),
  'zoom-in':             () => _sendRenderer('zoom-in'),
  'zoom-out':            () => _sendRenderer('zoom-out'),
  'toggle-leaderboard':  () => _sendRenderer('toggle-leaderboard'),

  // ── Mode presets ──
  'preset-broadcast': () => _sendRenderer('preset-broadcast'),
  'preset-practice':  () => _sendRenderer('preset-practice'),
  'preset-qualifying': () => _sendRenderer('preset-qualifying'),
};

function _sendRenderer(channel) {
  if (!overlayWindow) return { ok: false, reason: 'no window' };
  overlayWindow.webContents.send(channel);
  return { ok: true };
}

/**
 * Execute a named action. Returns a result object.
 * @param {string} name — action name (e.g. 'toggle-overlay')
 * @returns {{ ok: boolean, reason?: string }}
 */
function dispatchAction(name) {
  const handler = _actionHandlers[name];
  if (!handler) return { ok: false, reason: 'unknown action: ' + name };
  try {
    return handler();
  } catch (err) {
    logToFile(`[K10] Action error (${name}): ${err.message}`);
    return { ok: false, reason: err.message };
  }
}

// Expose dispatcher to remote-server.js for HTTP action API
remoteServer.setActionDispatcher(dispatchAction);

app.on('window-all-closed', () => {
  app.quit();
});

// ── Stream Deck plugin auto-install on every launch ──
// Idempotent: presence of `manifest.json` inside the installed plugin dir is
// the only "already installed" check. The previous version short-circuited on
// a settings flag, which got stuck `true` on partial / failed installs and
// blocked retries forever. Now the only state we trust is the filesystem.
function autoInstallStreamDeckPlugin() {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return;
  const fs = require('fs');
  const os = require('os');

  const sdPluginsDir = process.platform === 'win32'
    ? path.join(process.env.APPDATA || '', 'Elgato', 'StreamDeck', 'Plugins')
    : path.join(os.homedir(), 'Library', 'Application Support',
        'com.elgato.StreamDeck', 'Plugins');

  if (!fs.existsSync(sdPluginsDir)) {
    logToFile('[K10] StreamDeck install: plugins dir not found at ' + sdPluginsDir + ' — Stream Deck app likely not installed; skipping');
    return;
  }

  const installedDir = path.join(sdPluginsDir, 'com.k10motorsports.racecor.overlay.sdPlugin');
  const installedManifest = path.join(installedDir, 'manifest.json');
  if (fs.existsSync(installedManifest)) {
    logToFile('[K10] StreamDeck install: already present at ' + installedDir);
    return;
  }

  const srcDir = path.join(__dirname, 'streamdeck', 'racecor',
    'com.k10motorsports.racecor.overlay.sdPlugin');
  if (!fs.existsSync(path.join(srcDir, 'manifest.json'))) {
    logToFile('[K10] StreamDeck install: source not bundled at ' + srcDir + ' — check electron-builder files list');
    return;
  }

  try {
    fs.cpSync(srcDir, installedDir, { recursive: true });
    logToFile('[K10] StreamDeck install: copied to ' + installedDir);
  } catch (err) {
    logToFile('[K10] Stream Deck plugin install failed: ' + err.message);
  }
}

// ── IPC: Stream Deck plugin install ──
// Zips the bundled .sdPlugin directory into a .streamDeckPlugin file
// and opens it, which triggers the Stream Deck app to install the plugin.
ipcMain.handle('install-streamdeck-plugin', async () => {
  const fs = require('fs');
  const os = require('os');
  const { execSync } = require('child_process');
  const sdPluginDir = path.join(__dirname, 'streamdeck', 'racecor',
    'com.k10motorsports.racecor.overlay.sdPlugin');

  if (!fs.existsSync(sdPluginDir)) {
    logToFile('[K10] Stream Deck plugin not found at: ' + sdPluginDir);
    return { ok: false, reason: 'Plugin files not found in app bundle' };
  }

  const tmpFile = path.join(os.tmpdir(),
    'com.k10motorsports.racecor.overlay.streamDeckPlugin');

  try {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);

    const parentDir = path.dirname(sdPluginDir);
    const dirName = path.basename(sdPluginDir);

    if (process.platform === 'win32') {
      execSync(`powershell -Command "Compress-Archive -Path '${dirName}' -DestinationPath '${tmpFile}' -Force"`,
        { cwd: parentDir, timeout: 15000 });
    } else {
      execSync(`zip -r "${tmpFile}" "${dirName}"`,
        { cwd: parentDir, timeout: 15000 });
    }

    await shell.openPath(tmpFile);
    logToFile('[K10] Stream Deck plugin install triggered');
    return { ok: true };
  } catch (err) {
    logToFile('[K10] Stream Deck plugin install error: ' + err.message);
    return { ok: false, reason: err.message };
  }
});

// ── IPC: In-car state (drives overlay window visibility) ──
// poll-engine (in the renderer) emits this on every debounced flip
// between "live car data" and "not in a car". The window is shown only
// while in a car and hidden otherwise, so the overlay is never on-screen
// — or competing with the sim for resources — at the menus.
ipcMain.handle('notify-in-race-state', async (_event, inRace) => {
  if (inRace === isInRace) return;   // no change
  isInRace = !!inRace;
  if (!overlayWindow || overlayWindow.isDestroyed()) return;

  if (isInRace) {
    // Reveal the overlay without stealing focus from the game.
    overlayWindow.showInactive();
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
    overlayWindow.setFocusable(false);
    logToFile('[K10] In-car → overlay revealed');
  } else {
    overlayWindow.hide();
    logToFile('[K10] Out of car → overlay hidden');
  }
});

// Expose the current in-race state so the web window can decide initial UI
// on load (rather than waiting for the next flip — which may not come for
// minutes if the user is already in a steady state).
ipcMain.handle('get-in-race-state', async () => {
  return isInRace;
});

// ── IPC: Screen recording ──────────────────────────────────────
// The renderer handles capture via getDisplayMedia + MediaRecorder.
// Main process owns the file I/O: creates the write stream, receives
// chunks from the renderer, and finalizes the file on stop.
let _recordingStream = null;
let _recordingPath = null;
let _recordingStartTime = null;
let _recordingBytesWritten = 0;
let _recordingChunkCount = 0;
let _lastChunkDebugAt = 0;

function getRecordingDir() {
  // Use user-configured directory, fall back to system Videos folder
  const settings = loadSettingsSync();
  const dir = settings.recordingDirectory || app.getPath('videos');
  // Ensure the directory exists
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// Slugify a free-form name (track / car) for safe inclusion in filenames.
// Lower-cases, strips non-[a-z0-9], collapses runs to single dash, trims
// length, drops trailing dashes. Returns "" when nothing usable remains.
function slugForFilename(name, maxLen = 32) {
  if (!name) return '';
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen)
    .replace(/-+$/, '');
}

ipcMain.handle('start-recording', async (_event, options = {}) => {
  if (_recordingStream) {
    return { error: 'Already recording' };
  }
  try {
    const settings = loadSettingsSync();
    const dir = getRecordingDir();
    const dirSource = settings.recordingDirectory ? 'settings' : 'default';
    const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const ext = options.ext || 'webm';
    // Filename embeds track + car slugs when available — both for human
    // browsing and so prodrive-designer can group recordings by venue/car
    // without parsing the sidecar header. Falls back to bare timestamp.
    const trackSlug = slugForFilename(options.track);
    const carSlug = slugForFilename(options.car);
    const tail = [trackSlug, carSlug].filter(Boolean).join('_');
    const filename = tail ? `RaceCor_${ts}_${tail}.${ext}` : `RaceCor_${ts}.${ext}`;
    _recordingPath = path.join(dir, filename);
    _recordingStream = fs.createWriteStream(_recordingPath);
    _recordingStartTime = Date.now();
    _recordingBytesWritten = 0;
    _recordingChunkCount = 0;
    _lastChunkDebugAt = 0;

    const logMsg = `[K10] Recording started: ${_recordingPath} (from ${dirSource})`;
    logToFile(logMsg);
    console.log(logMsg);

    // Send debug event to renderer
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('recording-debug', {
        kind: 'start',
        path: _recordingPath,
        filename: filename,
        dir: dir,
        dirSource: dirSource,
      });
    }

    return { success: true, path: _recordingPath, filename };
  } catch (err) {
    logToFile(`[K10] Recording start error: ${err.message}`);
    return { error: err.message };
  }
});

ipcMain.handle('write-recording-chunk', async (_event, arrayBuffer) => {
  if (!_recordingStream) return;
  try {
    _recordingStream.write(Buffer.from(arrayBuffer));
    _recordingBytesWritten += arrayBuffer.byteLength;
    _recordingChunkCount += 1;

    // Throttled debug event: only send once every 2 seconds
    const now = Date.now();
    if (now - _lastChunkDebugAt >= 2000) {
      _lastChunkDebugAt = now;
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('recording-debug', {
          kind: 'chunk',
          bytesWritten: _recordingBytesWritten,
          chunkCount: _recordingChunkCount,
        });
      }
    }
  } catch (err) {
    logToFile(`[K10] Recording write error: ${err.message}`);
  }
});

ipcMain.handle('stop-recording', async () => {
  if (!_recordingStream) {
    return { error: 'Not recording' };
  }
  return new Promise((resolve) => {
    const filePath = _recordingPath;
    const duration = Date.now() - _recordingStartTime;
    _recordingStream.end(() => {
      let fileSize = 0;
      try { fileSize = fs.statSync(filePath).size; } catch (e) { /* ok */ }
      const sizeStr = (fileSize / 1024 / 1024).toFixed(1);
      const durationStr = (duration / 1000).toFixed(1);
      const logMsg = `[K10] Recording stopped: ${filePath} (${sizeStr} MB, ${durationStr}s)`;
      logToFile(logMsg);
      console.log(logMsg);

      // Send debug event to renderer
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('recording-debug', {
          kind: 'stop',
          path: filePath,
          filename: path.basename(filePath),
          fileSize: fileSize,
          duration: duration,
        });
      }

      resolve({ success: true, path: filePath, fileSize, duration });
    });
    _recordingStream = null;
    _recordingPath = null;
    _recordingStartTime = null;
  });
});

ipcMain.handle('get-recording-state', async () => {
  return {
    recording: !!_recordingStream,
    path: _recordingPath,
    duration: _recordingStartTime ? Date.now() - _recordingStartTime : 0,
  };
});

// ── IPC: Native recording (delegates to WinUI host's HTTP server) ──
// When the user toggles "Native" recording backend in the host's Settings
// page, recorder.js routes start/stop calls through these handlers
// instead of doing in-process capture. The host's RecordingControlServer
// writes its bound port to overlay-settings.json (`hostControlPort`); we
// read it on each call so port changes don't require an overlay restart.
// See docs/recording-migration.md for the migration plan.

function hostControlRequest(method, pathSuffix, bodyObj) {
  return new Promise((resolve) => {
    const settings = loadSettingsSync();
    const port = settings.hostControlPort;
    if (!port) {
      resolve({ error: 'Host control server not configured (hostControlPort missing). Is the Windows host running?' });
      return;
    }
    const body = bodyObj ? Buffer.from(JSON.stringify(bodyObj)) : null;
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: pathSuffix,
      method,
      headers: body
        ? { 'content-type': 'application/json', 'content-length': body.length }
        : {},
      timeout: 8000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        try {
          const parsed = raw ? JSON.parse(raw) : {};
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            resolve({ error: parsed.error || `Host returned ${res.statusCode}` });
          }
        } catch (e) {
          resolve({ error: `Host returned invalid JSON: ${e.message}` });
        }
      });
    });
    req.on('error', (err) => {
      resolve({ error: `Could not reach host: ${err.message}` });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ error: 'Host control server timed out' });
    });
    if (body) req.write(body);
    req.end();
  });
}

ipcMain.handle('start-native-recording', async (_event, options = {}) => {
  const result = await hostControlRequest('POST', '/v1/recording/start', {
    car: options.car || null,
    track: options.track || null,
    outputDirectory: options.outputDirectory || null,
  });
  if (!result.error) {
    logToFile(`[K10] Native recording started via host → ${result.path || '(no path)'}`);
  } else {
    logToFile(`[K10] Native recording start failed: ${result.error}`);
  }
  return result;
});

ipcMain.handle('stop-native-recording', async () => {
  const result = await hostControlRequest('POST', '/v1/recording/stop', null);
  if (!result.error) {
    logToFile(`[K10] Native recording stopped via host → ${result.path || '(no path)'} (${result.fileSize || 0} bytes)`);
  } else {
    logToFile(`[K10] Native recording stop failed: ${result.error}`);
  }
  return result;
});

ipcMain.handle('get-native-recording-state', async () => {
  return hostControlRequest('GET', '/v1/recording/state', null);
});

// ── IPC: Telemetry sidecar (.telemetry.jsonl alongside video) ──
// The renderer writes frame-synced telemetry data as JSON Lines.
// We keep a write stream open per-sidecar for efficient appending.
let _sidecarStreams = {};  // path → fs.WriteStream

ipcMain.handle('sidecar-start', async (_event, filePath) => {
  try {
    if (_sidecarStreams[filePath]) {
      _sidecarStreams[filePath].end();
    }
    _sidecarStreams[filePath] = fs.createWriteStream(filePath, { flags: 'w' });
    logToFile(`[K10] Sidecar started: ${filePath}`);
    return { success: true, path: filePath };
  } catch (err) {
    logToFile(`[K10] Sidecar start error: ${err.message}`);
    return { error: err.message };
  }
});

ipcMain.on('sidecar-write', (_event, filePath, chunk) => {
  // Use ipcMain.on (fire-and-forget) for performance — 30 writes/sec
  // However, check for backpressure: if write() returns false, the internal
  // buffer is full and we should wait for 'drain' before accepting more.
  var stream = _sidecarStreams[filePath];
  if (stream && !stream.destroyed) {
    var canWrite = stream.write(chunk);
    if (!canWrite) {
      logToFile(`[K10] Sidecar write backpressure on ${filePath} — waiting for drain`);
      // The renderer will eventually retry or the stream will emit 'drain'
      // and automatically resume. Log this edge case for monitoring.
    }
  }
});

ipcMain.handle('sidecar-stop', async (_event, filePath) => {
  var stream = _sidecarStreams[filePath];
  if (stream) {
    stream.end();
    delete _sidecarStreams[filePath];
    logToFile(`[K10] Sidecar stopped: ${filePath}`);
  }
  return { success: true };
});

// ── IPC: Replay buffer save ──
// Saves a chunk of buffered recording data to a timestamped clip file.
ipcMain.handle('save-replay-buffer', async (_event, options) => {
  try {
    const dir = getRecordingDir();
    const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    // Match start-recording's filename shape so file browsers + the
    // designer's mapper can treat clips and recordings the same way.
    const trackSlug = slugForFilename(options && options.track);
    const carSlug = slugForFilename(options && options.car);
    const tail = [trackSlug, carSlug].filter(Boolean).join('_');
    const filename = tail
      ? `RaceCor_Replay_${ts}_${tail}.webm`
      : `RaceCor_Replay_${ts}.webm`;
    const filePath = path.join(dir, filename);
    // options.data is an ArrayBuffer from the renderer
    const buf = Buffer.from(options.data);
    fs.writeFileSync(filePath, buf);
    const fileSize = fs.statSync(filePath).size;
    logToFile(`[K10] Replay buffer saved: ${filePath} (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);
    return { success: true, path: filePath, filename, fileSize };
  } catch (err) {
    logToFile(`[K10] Replay buffer save error: ${err.message}`);
    return { error: err.message };
  }
});

// ── IPC: FFmpeg transcode (.webm → .mp4) ──
// After recording stops, the renderer can request a transcode to MP4
// with hardware-accelerated encoding (NVENC on the 4090).
let _transcoding = false;

ipcMain.handle('get-ffmpeg-info', async () => {
  const ffmpegPath = ffmpegEncoder.getFfmpegPath();
  const encoder = ffmpegEncoder.detectEncoder();
  return {
    available: !!ffmpegPath,
    path: ffmpegPath,
    encoder: encoder,
    hardware: encoder && encoder !== 'libx264',
  };
});

ipcMain.handle('transcode-recording', async (_event, webmPath, options) => {
  if (_transcoding) {
    return { error: 'Transcode already in progress' };
  }
  if (!webmPath || !fs.existsSync(webmPath)) {
    return { error: 'Source file not found: ' + webmPath };
  }

  _transcoding = true;
  logToFile(`[K10] Transcode starting: ${webmPath}`);

  try {
    var result = await ffmpegEncoder.transcode(webmPath, options, function (progress) {
      // Forward progress to renderer
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('transcode-progress', progress);
      }
    });

    logToFile(`[K10] Transcode complete: ${result.outputPath} (${(result.fileSize / 1024 / 1024).toFixed(1)} MB, encoder: ${result.encoder})`);

    // Bundle into .rcpdv if a paired sidecar exists. Default behavior is on;
    // caller can set options.bundle === false to keep producing loose mp4+jsonl.
    var shouldBundle = !options || options.bundle !== false;
    if (shouldBundle) {
      var sidecarPath = result.outputPath.replace(/\.(mp4|mov|m4v)$/i, '.telemetry.jsonl');
      if (!fs.existsSync(sidecarPath)) {
        // Loose recordings (no sidecar) skip bundling silently.
        logToFile(`[K10] Bundle skipped — no sidecar at ${sidecarPath}`);
      } else {
        try {
          var bundleResult = bundleWriter.writeBundle({
            mp4Path: result.outputPath,
            telemetryPath: sidecarPath,
            appInfo: {
              app: 'prodrive-overlay',
              version: app.getVersion(),
              platform: process.platform,
            },
            video: {
              duration: result.duration || 0,
              width: result.width || 0,
              height: result.height || 0,
              codec: 'h264',
            },
          });
          logToFile(
            `[K10] Bundle written: ${bundleResult.outputPath} ` +
            `(id=${bundleResult.bundleId}, ` +
            `${(bundleResult.totalBytes / 1024 / 1024).toFixed(1)} MB, ` +
            `${bundleResult.frameCount} frames)`
          );
          // Notify renderer for UI feedback
          if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.webContents.send('bundle-complete', {
              path: bundleResult.outputPath,
              bundleId: bundleResult.bundleId,
              totalBytes: bundleResult.totalBytes,
              frameCount: bundleResult.frameCount,
            });
          }
          result.bundlePath = bundleResult.outputPath;
          result.bundleId = bundleResult.bundleId;

          // Delete intermediates only if bundling succeeded AND caller opted in.
          // Defaults to keeping mp4+jsonl until users trust the bundle pipeline.
          if (options && options.deleteIntermediatesOnBundle === true) {
            try { fs.unlinkSync(result.outputPath); } catch (_) {}
            try { fs.unlinkSync(sidecarPath); } catch (_) {}
            logToFile(`[K10] Deleted intermediates after bundle: mp4 + jsonl`);
          }
        } catch (bundleErr) {
          // Bundling failure must NOT lose the recording. Log + carry on.
          logToFile(`[K10] Bundle error (recording preserved): ${bundleErr.message}`);
        }
      }
    }

    // Delete source .webm if transcode succeeded and setting allows
    if (options && options.deleteSource !== false) {
      ffmpegEncoder.cleanupSource(webmPath);
      logToFile(`[K10] Deleted source .webm: ${webmPath}`);
    }

    _transcoding = false;
    return result;
  } catch (err) {
    _transcoding = false;
    logToFile(`[K10] Transcode error: ${err.message}`);
    return { error: err.message };
  }
});

// Manual bundle handler — wraps an existing mp4 + jsonl pair into a .rcpdv
// without re-transcoding. Useful for retrofitting prior recordings.
ipcMain.handle('bundle-recording', async (_event, mp4Path, options) => {
  if (!mp4Path || !fs.existsSync(mp4Path)) {
    return { error: 'mp4 not found: ' + mp4Path };
  }
  var sidecarPath =
    (options && options.telemetryPath) ||
    mp4Path.replace(/\.(mp4|mov|m4v)$/i, '.telemetry.jsonl');
  if (!fs.existsSync(sidecarPath)) {
    return { error: 'sidecar not found: ' + sidecarPath };
  }
  try {
    var result = bundleWriter.writeBundle({
      mp4Path: mp4Path,
      telemetryPath: sidecarPath,
      outputPath: options && options.outputPath,
      appInfo: {
        app: 'prodrive-overlay',
        version: app.getVersion(),
        platform: process.platform,
      },
    });
    logToFile(`[K10] Bundle written (manual): ${result.outputPath}`);
    return result;
  } catch (err) {
    logToFile(`[K10] Bundle error (manual): ${err.message}`);
    return { error: err.message };
  }
});

// Read a bundle header without decompressing telemetry. Used by UI lists.
ipcMain.handle('read-bundle-header', async (_event, rcpdvPath) => {
  if (!rcpdvPath || !fs.existsSync(rcpdvPath)) {
    return { error: 'bundle not found: ' + rcpdvPath };
  }
  try {
    var header = bundleWriter.readBundleHeader(rcpdvPath);
    if (!header) return { error: 'not a Prodrive bundle' };
    return { header: header };
  } catch (err) {
    return { error: err.message };
  }
});

// ── IPC: Replay Director (Phase 5) ──
// Automates iRacing replay recording of TV-view moments identified
// by the telemetry sidecar. Sends keyboard input to iRacing.

ipcMain.handle('start-replay-director', async (_event, sidecarPath) => {
  if (replayDirector.isRunning()) {
    return { error: 'Replay director is already running' };
  }
  if (!sidecarPath || !fs.existsSync(sidecarPath)) {
    return { error: 'Sidecar file not found: ' + sidecarPath };
  }

  logToFile(`[K10] Replay director starting: ${sidecarPath}`);

  // Run in background — don't await (it takes minutes)
  replayDirector.run(sidecarPath, {
    onProgress: function (progress) {
      // Forward progress to renderer
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('replay-director-progress', progress);
      }
      if (progress.status === 'recording_start') {
        // Tell renderer to start the screen recording
        if (overlayWindow && !overlayWindow.isDestroyed()) {
          overlayWindow.webContents.send('replay-director-record', { action: 'start' });
        }
      } else if (progress.status === 'recording_stop') {
        if (overlayWindow && !overlayWindow.isDestroyed()) {
          overlayWindow.webContents.send('replay-director-record', { action: 'stop' });
        }
      }
      logToFile(`[K10] Replay director: ${progress.status} — ${progress.message || ''}`);
    },
  }).then(function (result) {
    logToFile(`[K10] Replay director finished: ${JSON.stringify(result)}`);
  }).catch(function (err) {
    logToFile(`[K10] Replay director error: ${err.message}`);
  });

  return { success: true, message: 'Replay director started' };
});

ipcMain.handle('cancel-replay-director', async () => {
  replayDirector.cancel();
  return { success: true };
});

ipcMain.handle('get-replay-director-state', async () => {
  return replayDirector.getProgress();
});

ipcMain.handle('parse-sidecar-moments', async (_event, sidecarPath) => {
  try {
    const moments = replayDirector.parseSidecar(sidecarPath);
    const estimatedSec = replayDirector.estimateTime(moments);
    return { success: true, moments, estimatedSeconds: estimatedSec };
  } catch (err) {
    return { error: err.message };
  }
});

const isDev = process.argv.includes('--dev');

// Settings popout / Moza manager windows + the settings-changed relay
// were removed alongside the in-overlay settings UI. Settings live in
// the WinUI host now — the host writes overlay-settings.json directly,
// and the watcher below picks up the change and broadcasts it to the
// renderer. No secondary BrowserWindow lives here.

// fs.watchFile is polling-based, which is what we want: the WinUI host
// writes atomically (temp + rename), and the rename breaks fs.watch on
// Windows because the watched inode disappears. Polling stat survives
// that. 500ms is plenty for a human-driven settings edit.
function startSettingsWatcher() {
  const settingsPath = getSettingsPath();
  fs.watchFile(settingsPath, { interval: 500 }, (curr, prev) => {
    if (curr.mtimeMs === prev.mtimeMs) return;            // no real change
    if (Date.now() - _lastSelfSettingsWriteAt < 1500) return;  // our own write
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    let settings;
    try {
      settings = loadSettingsSync();
    } catch (e) {
      logToFile('[K10] settings watcher: load failed: ' + e.message);
      return;
    }
    overlayWindow.webContents.send('settings-sync', settings);
    logToFile('[K10] settings-sync broadcast (file changed)');
  });
}

// ── IPC: iRating / Safety Rating persistence ──
ipcMain.handle('get-rating-data', async () => {
  return loadRatingData();
});

ipcMain.handle('save-rating-data', async (event, data) => {
  if (typeof data !== 'object' || data === null) {
    logToFile('[K10] Warning: save-rating-data received invalid data');
    return;
  }
  saveRatingData(data);
});

// ── IPC: App version (from package.json, stamped by CI from git tag) ──
ipcMain.handle('get-version', () => app.getVersion());

// ── IPC: Settings persistence ──
ipcMain.handle('get-settings', async () => {
  try {
    return JSON.parse(fs.readFileSync(getSettingsPath(), 'utf8'));
  } catch (e) {
    return null;
  }
});

ipcMain.handle('save-settings', async (event, settings) => {
  saveSettingsSync(settings);
  return true;
});

// ── IPC: Dashboard mode query (legacy, returns 'build') ──
ipcMain.handle('get-dashboard-mode', async () => {
  return 'build';
});

// ── IPC: Layout v2 — module registry + metrics sidecar ──
// The registry ships two ways: outside the asar via extraResources
// (resources/layout-registry.json — also what the WinUI host reads)
// and inside the app files for dev runs. Prefer the extraResources
// copy when packaged so all three readers see the same bytes.
function getLayoutRegistryPath() {
  if (app.isPackaged) {
    const packaged = path.join(process.resourcesPath, 'layout-registry.json');
    if (fs.existsSync(packaged)) return packaged;
  }
  return path.join(__dirname, 'layout-registry.json');
}

ipcMain.handle('get-layout-registry', async () => {
  try {
    return JSON.parse(fs.readFileSync(getLayoutRegistryPath(), 'utf8'));
  } catch (e) {
    logToFile('[K10] layout registry read failed: ' + e.message);
    return null; // renderer stays on the legacy layout path
  }
});

// Observed module/group geometry from the renderer → sidecar file the
// host's editor watches for pixel-exact proxies. Separate file from
// overlay-settings.json on purpose: each file has exactly one writer
// (host writes settings, overlay writes metrics), so neither can
// clobber the other's whole-file atomic saves.
ipcMain.handle('report-layout-metrics', async (event, metrics) => {
  if (!metrics || typeof metrics !== 'object') return false;
  try {
    const metricsPath = path.join(path.dirname(getSettingsPath()), 'overlay-metrics.json');
    const tmp = metricsPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(metrics, null, 2));
    fs.renameSync(tmp, metricsPath); // atomic swap — watcher never sees a partial file
    return true;
  } catch (e) {
    logToFile('[K10] layout metrics write failed: ' + e.message);
    return false;
  }
});

// ── IPC: Quit app ──
ipcMain.handle('quit-app', () => {
  app.quit();
});

// ── IPC: Open external URL in user's default browser ──
ipcMain.handle('open-external', async (event, urlStr) => {
  try {
    const url = new URL(urlStr);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      await shell.openExternal(urlStr);
    }
  } catch (e) {
    // invalid URL — silently reject
  }
});

// ═══════════════════════════════════════════════════════════════
// AUTO-UPDATER (overlay)
// Checks GitHub Releases for new versions, downloads in background,
// installs on next restart.
// ═══════════════════════════════════════════════════════════════
// (require moved to top of file with other imports)

ipcMain.handle('check-for-updates', async () => {
  return updater.checkForUpdates();
});

ipcMain.handle('download-update', async () => {
  return updater.downloadUpdate();
});

ipcMain.handle('install-update', async () => {
  updater.installAndRestart();
});

// ═══════════════════════════════════════════════════════════════
// DISCORD OAUTH2 INTEGRATION
// Opens the user's browser for Discord authorization, listens
// on a local callback server, exchanges the code for a token,
// then fetches and persists the Discord user profile.
// ═══════════════════════════════════════════════════════════════

const DISCORD_CLIENT_ID     = '1483105220023160882';
const DISCORD_REDIRECT_PORT = 18492;
const DISCORD_REDIRECT_URI  = `http://localhost:${DISCORD_REDIRECT_PORT}/callback`;
const DISCORD_SCOPES        = 'identify guilds.join';
const DISCORD_GUILD_ID      = '1310050023326121994';  // K10 Motorsports server
const DISCORD_GUILD_INVITE  = 'https://discord.gg/racecor-io-pro-drive';

let _discordCallbackServer = null;
let _discordCodeVerifier   = null;  // PKCE code_verifier for current auth flow

// PKCE helpers — generate verifier + S256 challenge (no client secret needed)
function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}
function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function getDiscordPath() {
  return path.join(app.getPath('userData'), 'discord-user.json');
}

function loadDiscordUser() {
  try {
    return JSON.parse(fs.readFileSync(getDiscordPath(), 'utf8'));
  } catch (e) {
    return null;
  }
}

function saveDiscordUser(user) {
  fs.writeFileSync(getDiscordPath(), JSON.stringify(user, null, 2));
}

function clearDiscordUser() {
  try { fs.unlinkSync(getDiscordPath()); } catch (e) { /* ok */ }
}

function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function httpsPost(url, body, headers) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const postData = typeof body === 'string' ? body : new URLSearchParams(body).toString();
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        ...headers,
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(postData);
    req.end();
  });
}

async function exchangeCodeForToken(code) {
  if (!_discordCodeVerifier) throw new Error('Missing PKCE code verifier');

  const tokenData = await httpsPost('https://discord.com/api/oauth2/token', {
    client_id: DISCORD_CLIENT_ID,
    grant_type: 'authorization_code',
    code: code,
    redirect_uri: DISCORD_REDIRECT_URI,
    code_verifier: _discordCodeVerifier,
  });

  _discordCodeVerifier = null;  // single-use
  if (tokenData.error) throw new Error(tokenData.error_description || tokenData.error);
  return tokenData;
}

async function fetchDiscordProfile(accessToken) {
  const user = await httpsGet('https://discord.com/api/users/@me', {
    Authorization: `Bearer ${accessToken}`,
  });
  if (user.id) return user;
  throw new Error('Failed to fetch Discord profile');
}

function startCallbackServer() {
  return new Promise((resolve, reject) => {
    if (_discordCallbackServer) {
      try { _discordCallbackServer.close(); } catch (e) { /* ok */ }
    }

    _discordCallbackServer = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost:${DISCORD_REDIRECT_PORT}`);

      if (url.pathname === '/callback') {
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body style="background:#1a1a2e;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2 style="color:#f44336">Connection Cancelled</h2><p>You can close this tab and return to the overlay.</p></div></body></html>');
          resolve({ error });
          setTimeout(() => { try { _discordCallbackServer.close(); } catch (e) {} _discordCallbackServer = null; }, 1000);
          return;
        }

        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body style="background:#1a1a2e;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2 style="color:#4caf50">Connected!</h2><p>You can close this tab and return to the K10 Motorsports overlay.</p></div></body></html>');
          resolve({ code });
          setTimeout(() => { try { _discordCallbackServer.close(); } catch (e) {} _discordCallbackServer = null; }, 1000);
          return;
        }

        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Missing code parameter');
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    _discordCallbackServer.listen(DISCORD_REDIRECT_PORT, '127.0.0.1', () => {
      console.log(`[K10] Discord callback server listening on port ${DISCORD_REDIRECT_PORT}`);
    });

    _discordCallbackServer.on('error', (err) => {
      console.error('[K10] Discord callback server error:', err);
      reject(err);
    });

    // Timeout: close server after 5 minutes if no callback received
    setTimeout(() => {
      if (_discordCallbackServer) {
        try { _discordCallbackServer.close(); } catch (e) {}
        _discordCallbackServer = null;
        resolve({ error: 'timeout' });
      }
    }, 300000);
  });
}

// ── IPC: Discord OAuth2 ──
ipcMain.handle('discord-connect', async () => {
  try {
    // Generate PKCE verifier + challenge (no client secret needed)
    _discordCodeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(_discordCodeVerifier);

    // Start listening for the callback BEFORE opening the browser
    const callbackPromise = startCallbackServer();

    // Open Discord OAuth2 authorization URL in user's default browser (with PKCE)
    const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(DISCORD_SCOPES)}&code_challenge=${codeChallenge}&code_challenge_method=S256`;

    // Temporarily lower z-level so the browser window is visible above the overlay
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.setAlwaysOnTop(false);
    }

    await shell.openExternal(authUrl);
    console.log('[K10] Discord OAuth2: opened browser for authorization (PKCE)');

    // Wait for the callback
    const result = await callbackPromise;

    // Restore z-level (respect idle mode — don't go always-on-top when not racing)
    if (overlayWindow && !overlayWindow.isDestroyed() && isInRace) {
      overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    }

    if (result.error) {
      return { success: false, error: result.error };
    }

    // Exchange code for token
    const tokenData = await exchangeCodeForToken(result.code);

    // Fetch user profile
    const profile = await fetchDiscordProfile(tokenData.access_token);

    // Build user data to persist
    const userData = {
      id: profile.id,
      username: profile.username,
      globalName: profile.global_name || profile.username,
      discriminator: profile.discriminator,
      avatar: profile.avatar,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + (tokenData.expires_in * 1000),
      connectedAt: new Date().toISOString(),
    };

    saveDiscordUser(userData);
    console.log(`[K10] Discord connected: ${userData.globalName} (${userData.id})`);

    return {
      success: true,
      user: {
        id: userData.id,
        username: userData.username,
        globalName: userData.globalName,
        avatar: userData.avatar,
      },
    };
  } catch (err) {
    console.error('[K10] Discord connect error:', err);
    // Restore z-level if it was lowered (respect idle mode)
    if (overlayWindow && !overlayWindow.isDestroyed() && !overlayWindow.isAlwaysOnTop() && isInRace) {
      overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    }
    return { success: false, error: err.message };
  }
});

ipcMain.handle('discord-disconnect', async () => {
  clearDiscordUser();
  console.log('[K10] Discord disconnected');
  return { success: true };
});

ipcMain.handle('get-discord-user', async () => {
  const user = loadDiscordUser();
  if (!user) return null;
  // Return only safe fields (no tokens)
  return {
    id: user.id,
    username: user.username,
    globalName: user.globalName,
    avatar: user.avatar,
    connectedAt: user.connectedAt,
  };
});

// ═══════════════════════════════════════════════════════════════
// K10 PRO DRIVE OAUTH2 INTEGRATION
// Opens the user's browser to the K10 website for authorization,
// reuses the same localhost callback server (port 18492),
// exchanges the auth code for a K10 access token.
// ═══════════════════════════════════════════════════════════════

const K10_API_BASE = process.env.K10_API_BASE || 'https://prodrive.racecor.io';

function getK10Path() {
  return path.join(app.getPath('userData'), 'k10-pro-user.json');
}

function loadK10User() {
  try {
    return JSON.parse(fs.readFileSync(getK10Path(), 'utf8'));
  } catch (e) {
    return null;
  }
}

function saveK10User(data) {
  fs.writeFileSync(getK10Path(), JSON.stringify(data, null, 2));
}

function clearK10User() {
  try { fs.unlinkSync(getK10Path()); } catch (e) { /* ok */ }
}

async function httpsPostJson(url, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const postData = JSON.stringify(body);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };
    // Use http for localhost dev, https for production
    const lib = urlObj.protocol === 'http:' ? http : https;
    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(postData);
    req.end();
  });
}

async function httpsGetWithAuth(url, token) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const lib = urlObj.protocol === 'http:' ? http : https;
    const req = lib.get(url, {
      headers: { Authorization: `Bearer ${token}` },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { reject(new Error('Invalid JSON: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

ipcMain.handle('k10-connect', async () => {
  try {
    // Generate PKCE verifier + challenge
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = crypto.randomBytes(16).toString('hex');

    // Start listening for the callback BEFORE opening the browser
    const callbackPromise = startCallbackServer();

    // Build the K10 Pro Drive authorization URL
    const authUrl = `${K10_API_BASE}/api/plugin-auth/authorize?code_challenge=${codeChallenge}&code_challenge_method=S256&state=${state}&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}`;

    // Temporarily lower z-level so the browser window is visible above the overlay
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.setAlwaysOnTop(false);
    }

    await shell.openExternal(authUrl);
    console.log('[K10] K10 Pro OAuth2: opened browser for authorization');

    // Wait for the callback
    const result = await callbackPromise;

    // Restore z-level (respect idle mode — don't go always-on-top when not racing)
    if (overlayWindow && !overlayWindow.isDestroyed() && isInRace) {
      overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    }

    if (result.error) {
      return { success: false, error: result.error };
    }

    // Exchange code for K10 access token
    const tokenData = await httpsPostJson(`${K10_API_BASE}/api/plugin-auth/token`, {
      grant_type: 'authorization_code',
      code: result.code,
      code_verifier: codeVerifier,
    });

    if (tokenData.error) {
      return { success: false, error: tokenData.error };
    }

    // Verify token and get user profile + features
    const verifyResult = await httpsGetWithAuth(`${K10_API_BASE}/api/plugin-auth/verify`, tokenData.access_token);
    if (verifyResult.status !== 200 || !verifyResult.data.user) {
      return { success: false, error: 'Token verification failed' };
    }

    const userData = {
      ...verifyResult.data.user,
      features: verifyResult.data.features || [],
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: tokenData.expires_at,
      connectedAt: new Date().toISOString(),
    };

    saveK10User(userData);
    console.log(`[K10] K10 Pro connected: ${userData.discordDisplayName || userData.discordUsername} (${userData.discordId})`);

    return {
      success: true,
      user: {
        id: userData.id,
        discordId: userData.discordId,
        discordUsername: userData.discordUsername,
        discordDisplayName: userData.discordDisplayName,
        discordAvatar: userData.discordAvatar,
        features: userData.features,
      },
    };
  } catch (err) {
    console.error('[K10] K10 Pro connect error:', err);
    if (overlayWindow && !overlayWindow.isDestroyed() && !overlayWindow.isAlwaysOnTop() && isInRace) {
      overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    }
    return { success: false, error: err.message };
  }
});

ipcMain.handle('k10-disconnect', async () => {
  clearK10User();
  console.log('[K10] K10 Pro disconnected');
  return { success: true };
});

ipcMain.handle('get-k10-user', async () => {
  const user = loadK10User();
  if (!user) return null;
  // Return only safe fields (no tokens)
  return {
    id: user.id,
    discordId: user.discordId,
    discordUsername: user.discordUsername,
    discordDisplayName: user.discordDisplayName,
    discordAvatar: user.discordAvatar,
    features: user.features || [],
    connectedAt: user.connectedAt,
  };
});

ipcMain.handle('get-k10-token', async () => {
  const user = loadK10User();
  return user?.accessToken || null;
});

ipcMain.handle('verify-k10-token', async () => {
  const user = loadK10User();
  if (!user || !user.accessToken) return { valid: false };

  try {
    const result = await httpsGetWithAuth(`${K10_API_BASE}/api/plugin-auth/verify`, user.accessToken);
    if (result.status === 200 && result.data.user) {
      // Update stored features
      user.features = result.data.features || [];
      saveK10User(user);
      return { valid: true, features: user.features };
    }

    // Try refresh
    if (user.refreshToken) {
      const refreshResult = await httpsPostJson(`${K10_API_BASE}/api/plugin-auth/token`, {
        grant_type: 'refresh_token',
        refresh_token: user.refreshToken,
      });
      if (refreshResult.access_token) {
        user.accessToken = refreshResult.access_token;
        user.refreshToken = refreshResult.refresh_token;
        user.expiresAt = refreshResult.expires_at;
        saveK10User(user);
        return { valid: true, features: user.features };
      }
    }

    return { valid: false };
  } catch (err) {
    console.warn('[K10] Token verification failed:', err.message);
    return { valid: false };
  }
});

// ═══════════════════════════════════════════════════════════════
// ── IPC: Remote Dashboard Server ──
ipcMain.handle('get-remote-server-info', async () => {
  return remoteServer.getInfo();
});

ipcMain.handle('start-remote-server', async (event, opts = {}) => {
  try {
    const settings = loadSettingsSync();
    const simhubUrl = (settings.simhubUrl || 'http://localhost:8889/racecor-io-pro-drive/')
      .replace(/\/racecor-io-pro-drive\/?$/, '');
    const info = await remoteServer.start({
      port: opts.port || settings.remoteServerPort || remoteServer.DEFAULT_PORT,
      appDir: __dirname,
      simhubUrl: simhubUrl,
      log: logToFile,
    });
    // Persist the enabled state
    settings.remoteServer = true;
    if (opts.port) settings.remoteServerPort = opts.port;
    saveSettingsSync(settings);
    return { success: true, ...info };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('stop-remote-server', async () => {
  await remoteServer.stop();
  const settings = loadSettingsSync();
  settings.remoteServer = false;
  saveSettingsSync(settings);
  return { success: true };
});

// ═══════════════════════════════════════════════════════════════
// AMBIENT LIGHT — Screen Color Capture (REMOVED)
//
// The Electron desktopCapturer pipeline has been replaced by a
// native C# ScreenColorSampler in the SimHub plugin. The plugin
// captures a small screen region using Graphics.CopyFromScreen()
// on a background thread at ~4 FPS and embeds the averaged RGB
// in the telemetry JSON (DS.AmbientR/G/B/HasData).
//
// The dashboard JS reads ambient color from poll data via
// poll-engine.js → updateAmbientFromPoll() in ambient-light.js.
//
// No Electron IPC or desktopCapturer is needed anymore.
// ═══════════════════════════════════════════════════════════════
