// ═══════════════════════════════════════════════════════════════
// The Racing Desk — Electron Overlay
// Transparent, always-on-top, click-through overlay window
// that renders the HTML dashboard over the sim
// ═══════════════════════════════════════════════════════════════

const { app, BrowserWindow, ipcMain, screen, globalShortcut, shell, Menu, Tray, powerMonitor, dialog, safeStorage } = require('electron');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const remoteServer = require('./remote-server');
const isDev        = process.argv.includes('--dev');
const devMode      = isDev ? require('./dev-mode') : null;
const { isAllowedExternalUrl } = require('./modules/js/external-links');
const hostLauncher = require('./modules/js/host-launcher');
const appLog       = require('./modules/js/app-log');
const hudVisibility = require('./modules/js/hud-visibility');
const hudDisplay   = require('./modules/js/hud-display');
const { createHudKeys } = require('./modules/js/hud-keys');
const settingsFile = require('./modules/js/settings-file');
const recordingSettings = require('./modules/js/recording-settings');
const mapZoom = require('./modules/js/map-zoom');
const streamdeckInstall = require('./modules/js/streamdeck-install');
const obs = require('./modules/js/obs');
const RacingDeskInCar = require('./modules/js/in-car');
const { spawn, execFile } = require('child_process');
const paints       = require('./modules/js/paints');
const paintsIpc    = require('./modules/js/paints-ipc');
const { createCarNames } = require('./modules/js/paints/car-names');
const rigApi       = require('./modules/js/rig-api');
const { createDeskReads, deskHostOf } = require('./modules/js/desk-reads');
const runtimeActions = require('./modules/js/runtime-actions');
const logoLivery   = require('./modules/js/logo-livery');

// ── Log ─────────────────────────────────────────────────────
// From source, racing-desk-debug.log beside this file. In the built app, overlay.log beside the host's log in
// %LOCALAPPDATA%\Racing Desk: the folder this file is in is inside app.asar there, and nothing written to it was
// ever kept. modules/js/app-log.js has the rules — two files of four megabytes at most, and a line that cannot
// be written is dropped. No line carries a customer id or the name of a key he pressed.
const appLogFile = appLog.createLog({ file: appLog.logPath({ isPackaged: app.isPackaged, appDir: __dirname }) });
function logToFile(msg) {
  appLogFile.write(msg);
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
app.setName('Racing Desk');

// ── Settings folder ───────────────────────────────────────────
// The app was "K10 Motorsports" until 2026-09-27, and Electron keeps its settings under the app's name. The old
// folder moves across whole, the first time this name runs and only while the new one doesn't exist — a
// half-and-half state would be worse than the old name. Before the single-instance lock, which lives in there.
(function migrateSettingsFolder() {
  const appData = app.getPath('appData');
  const current = path.join(appData, 'Racing Desk');
  const old = path.join(appData, 'K10 Motorsports');
  if (fs.existsSync(current) || !fs.existsSync(old)) return;
  try {
    fs.renameSync(old, current);
    logToFile(`[RacingDesk] Settings moved from ${old} to ${current}`);
  } catch (err) {
    logToFile(`[RacingDesk] Settings could not be moved from ${old}: ${err.message}`);
  }
})();

// ── One instance ──────────────────────────────────────────────
// The app's only visible presence is a tray icon, so a second double-click on the shortcut must open the desk
// in the running instance — not a second HUD, tray icon and host. The lock lives under userData, hence after
// setName.
const isFirstInstance = app.requestSingleInstanceLock();
if (!isFirstInstance) app.quit();
else app.on('second-instance', () => showDesk());

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

if (process.env.RACING_DESK_FORCE_SOFTWARE === '1') {
  app.disableHardwareAcceleration();
}

// ── Settings helpers ─────────────────────────────────────────
function getSettingsPath() {
  return path.join(app.getPath('userData'), 'overlay-settings.json');
}

// modules/js/settings-file.js has the rules: atomic writes, a BOM is fine, and a file that is there but won't
// parse is copied aside before anything replaces it.
function loadSettingsSync() {
  return settingsFile.load(getSettingsPath());
}

// Stamp the timestamp of the last write originating from this process so the
// settings-file watcher can ignore its own writes (it only re-broadcasts
// changes made by something else; the desk's saves reach the HUD from the
// save-settings handler itself).
let _lastSelfSettingsWriteAt = 0;
function saveSettingsSync(settings) {
  const { kept } = settingsFile.save(getSettingsPath(), settings);
  if (kept) logToFile(`[RacingDesk] Settings file couldn't be read; the old one is kept at ${kept}`);
  _lastSelfSettingsWriteAt = Date.now();
}

// One key of the file, every other kept. Throws rather than write over a file it couldn't read.
function saveSettingsKeySync(key, value) {
  settingsFile.setKey(getSettingsPath(), key, value);
  _lastSelfSettingsWriteAt = Date.now();
}

// The recording keys, brought from the Electron recorder's days to OBS's (modules/js/recording-settings.js): once,
// before anything reads the file. A file that cannot be read is left as it is.
(function migrateRecordingSettings() {
  try {
    const result = recordingSettings.migrateFile(getSettingsPath(), { settingsFile });
    if (result.changed) {
      _lastSelfSettingsWriteAt = Date.now();
      logToFile(`[RacingDesk] Recording settings brought to version ${recordingSettings.VERSION}: ${result.removed.length} removed, ${result.renamed.length} renamed, ${result.added.length} added`);
    } else if (result.state === 'unreadable') {
      logToFile('[RacingDesk] Recording settings: the settings file could not be read, so it was left as it is');
    }
  } catch (err) {
    logToFile(`[RacingDesk] Recording settings could not be migrated: ${err.message}`);
  }
})();

// The following map's zoom (modules/js/map-zoom.js): a settings file from before the setting, or one holding a word
// that is not one of its three, is given "Closer at speed" once, before anything reads the file. A file that cannot be
// read is left as it is.
(function migrateFollowMapZoom() {
  try {
    const result = mapZoom.migrateFile(getSettingsPath(), { settingsFile });
    if (result.changed) {
      _lastSelfSettingsWriteAt = Date.now();
      logToFile(`[RacingDesk] Following map zoom: ${mapZoom.KEY} set to ${result.settings[mapZoom.KEY]} in the settings file`);
    }
  } catch (err) {
    logToFile(`[RacingDesk] Following map zoom could not be set in the settings file: ${err.message}`);
  }
})();

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
let deskWindow = null;
let tray = null;                 // module-level so the icon isn't garbage-collected
let hostUrl = null;              // where startLocalHost() found or started RacingDesk.Host
let hostChild = null;            // the RacingDesk.Host process this app started, killed on quit
let hostNote = null;             // why there is no host of our own, shown by the desk when nothing answers
let deskHost = null;             // the host URL the desk window was loaded with
let quitting = false;            // set by before-quit, so closing the desk during a quit doesn't quit again
let relaunchPending = false;     // the Ctrl+Shift+G relaunch is waiting to go (leaveForRelaunch, below); a quit gives it up
app.on('before-quit', (event) => {
  quitting = true;
  // A real quit while the Ctrl+Shift+G relaunch is waiting (a STARTED, a filing: seconds at most) is a quit after all: the
  // relaunch is given up (leaveForRelaunch resolves to false), or the app would end here with the recording and the
  // replay buffer left running and nothing to take them over.
  const relaunchGivenUp = relaunchPending;
  relaunchPending = false;
  // A recording Racing Desk started is stopped before the app goes (StopRecord, STOPPED waited for 3 s at most): a
  // detached OBS would otherwise record on with nothing left to stop it. Once; then the quit goes through.
  if (typeof recording !== 'undefined' && recording && !stoppedForQuit && (relaunchGivenUp || recording.needsStopForQuit() || tvShots.needsStopForQuit() || (hudSourceOn() && obsClient.identified()))) {
    event.preventDefault();
    stopOwnedRecording().finally(() => app.quit());
  }
});

// ═══════════════════════════════════════════════════════════════
// DESK WINDOW — career, form and race history from the local store
// ═══════════════════════════════════════════════════════════════

// --desk-host=http://localhost:18889 points the desk at a RacingDesk.Host you run by hand (and skips starting one). The host
// answers programs on this machine and no other address (its data carries the driver's customer id), so a flag that names
// another machine would leave the app with no host that answers it, for the desk, the HUD's screen lookup, the car names and
// the TV shots alike: it is ignored, once in the log, and the app finds or starts a host of its own as it does with no flag.
let ignoredDeskHost = null;
function deskHostFlag() {
  const { url, ignored } = deskHostOf(process.argv);
  if (ignored !== undefined && ignored !== ignoredDeskHost) {
    ignoredDeskHost = ignored;
    logToFile(`[RacingDesk] Host: --desk-host=${ignored} is ignored: the host's data is for this machine only, so use localhost or 127.0.0.1 at the port a host of this machine listens on`);
  }
  return url;
}

function localHostUrl() {
  const flag = deskHostFlag();
  if (flag) return flag;
  if (hostUrl) return hostUrl;
  const settings = loadSettingsSync();
  return settings.simhubUrl
    ? settings.simhubUrl.replace(/\/racing-desk\/?$/, '')
    : 'http://localhost:8889';
}

// desk.html reads its host from the query once, at load: reload it if the host has changed since — a desk
// opened from the tray or Ctrl+Shift+O while startLocalHost() was still deciding would otherwise stay pointed
// at SimHub.
// `page` is one of the desk's pages — desk, cars, settings (desk.js showPage); without one, the desk opens where
// it was.
function loadDesk(page) {
  deskHost = localHostUrl();
  const query = { host: deskHost };
  if (hostNote) query.note = hostNote;
  if (page) query.page = page;
  deskWindow.loadFile(path.join(__dirname, 'desk.html'), { query });
}

function showDesk(page) {
  if (deskWindow && !deskWindow.isDestroyed()) {
    if (localHostUrl() !== deskHost) loadDesk(page);
    else if (page) deskWindow.webContents.send('show-page', page);
    if (deskWindow.isMinimized()) deskWindow.restore();
    deskWindow.show();
    deskWindow.focus();
    return;
  }
  deskWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1024,
    minHeight: 680,
    title: 'Racing Desk',
    icon: path.join(__dirname, 'images', 'branding', 'icon.png'),
    backgroundColor: '#0b0b0d',
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
  });
  loadDesk(page);
  // Closing the desk quits the app, as closing any program's window does: the HUD's window is hidden and the
  // tray icon sits behind Windows' overflow arrow, so otherwise the app would carry on with nothing on screen.
  // Minimise the desk to keep the HUD while racing.
  deskWindow.on('close', () => { if (!quitting) app.quit(); });
  deskWindow.on('closed', () => { deskWindow = null; });
}

// The desk reads the local store from RacingDesk.Host, so the app starts one — beside SimHub on :18889 when
// SimHub holds :8889, in its place otherwise — or uses the one already running. The wait is bounded; the
// desk retries by itself if the host takes longer. Not in dev mode: `npm run dev` is the HUD over a replay,
// and a live host beside it would open the hardware and record for nothing.
async function startLocalHost() {
  if (deskHostFlag() || isDev) {
    logToFile(isDev ? '[RacingDesk] Host: dev mode, not starting one' : `[RacingDesk] Host: --desk-host=${deskHostFlag()}, not starting one`);
    return;
  }
  try {
    const result = await hostLauncher.startHost({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appDir: __dirname,
      log: (msg) => logToFile(`[RacingDesk] Host: ${msg}`),
    });
    logToFile(`[RacingDesk] Host: ${result.reason}`);
    hostUrl = result.url;
    hostChild = result.child;
    if (!hostUrl) hostNote = result.reason;
    if (hostChild) {
      const up = await hostLauncher.waitForHost(hostUrl, { timeoutMs: 10000, child: hostChild });
      if (up) {
        logToFile(`[RacingDesk] Host: answering at ${hostUrl}`);
      } else if (hostChild.exitCode !== null) {
        // The host stops itself when its port turns out to be taken (see Program.cs); whatever took it is
        // what the desk will find there.
        hostNote = `RacingDesk.Host exited (${hostChild.exitCode}) — see ${hostLauncher.hostLogPath()}`;
        logToFile(`[RacingDesk] Host: ${hostNote}`);
      } else {
        logToFile(`[RacingDesk] Host: no answer at ${hostUrl} after 10 s — the desk keeps trying`);
      }
    }
  } catch (err) {
    logToFile(`[RacingDesk] Host: start failed: ${err.stack || err.message}`);
  }
}

// ── Tray icon ─────────────────────────────────────────────────
// The HUD is hidden until the driver is in the car, and with --no-desk there is no desk window either, so the
// tray icon is what shows the app is running whatever else is on screen: it opens the desk, switches the HUD
// and quits. Closing the desk window quits the app too (showDesk, above); minimised, it leaves the HUD running.
// Those are the two ways the app is quit. Quitting the overlay — Ctrl+Shift+Q in the car, the Stream Deck's
// button — puts the HUD away and quits nothing (the quit action, below).
function createTray() {
  const iconFile = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  tray = new Tray(path.join(__dirname, 'images', 'branding', iconFile));
  tray.setToolTip('Racing Desk');
  buildTrayMenu();
  tray.on('click', () => showDesk());          // a single click is what people try first on Windows
  tray.on('double-click', () => showDesk());
}
let trayMenu = null;

// The menu is built again whenever the recording changes (recording state is on the tray, the desk's masthead and
// the Stream Deck, and never on the HUD, which OBS films). "Record" / "Stop recording" go through the same action
// the Stream Deck's button does; "Open OBS" is there while OBS is not answering.
function buildTrayMenu() {
  if (!tray) return;
  const rec = recording ? recording.status() : null;
  const items = [
    { label: 'Open desk', click: () => showDesk('desk') },
    { label: 'Cars', click: () => showDesk('cars') },   // liveries, view and pedals: one page
    { label: 'Settings', click: () => showDesk('settings') },
    { type: 'separator' },
  ];
  if (rec) {
    const recordingNow = rec.recording || rec.starting;
    items.push({ label: recordingNow ? `Stop recording${rec.recording ? ' · ' + trayElapsed(rec.elapsedMs) : ''}` : 'Record', enabled: !rec.busy, click: () => { dispatchAction('toggle-recording', { source: 'tray' }); } });
    if (rec.replay && rec.replay.on) items.push({ label: 'Save replay', enabled: !!rec.replay.running && !rec.busy, click: () => { dispatchAction('save-replay-buffer', { source: 'tray' }); } });
    // TV shots of the latest recording, from iRacing's replay: out of the car, with OBS open and nothing recording.
    const tv = tvShots.status();
    if (tv.running) items.push({ label: `Stop TV shots · ${tv.index} of ${tv.total}`, click: () => { tvShots.cancel(); } });
    else items.push({ label: 'TV shots of the last recording', enabled: rec.obs === 'open' && !recordingNow && !rec.busy && !hud.state().inCar, click: () => { dispatchAction('tv-shots', { source: 'tray' }); } });
    if (rec.obs !== 'open') items.push({ label: 'Open OBS', enabled: rec.busy !== 'starting-obs', click: () => { openObs().catch(() => {}); } });
    items.push({ type: 'separator' });
  }
  items.push(
    // Ticked while the HUD is switched on. Out of the car the window is hidden either way, so the tick is the
    // only place the switch can be seen — and this the only switch that works there: the key and the Stream
    // Deck's button are left alone out of the car (the toggle-overlay action, below).
    { id: 'hud', label: 'HUD on/off', type: 'checkbox', checked: true, click: () => { hud.toggle({ anywhere: true }); tickHudSwitch(); } },
    { type: 'separator' },
    { label: 'Quit Racing Desk', click: () => app.quit() },
  );
  trayMenu = Menu.buildFromTemplate(items);
  tray.setContextMenu(trayMenu);
  tickHudSwitch();
}

function trayElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

// ── The HUD is on the screen iRacing is on ───────────────────
// modules/js/hud-display.js chooses the screen and moves the window there — never shows or hides it, which is
// hud-visibility's alone. The rule: the screen he chose in Settings (`hudDisplay`) while it is connected; else the
// one the sim's window is on, which the app's host says (/racing-desk/data/simwindow) because Electron cannot see
// another program's windows; else the one that matches the size iRacing's own ini says it runs at; else the largest.
// It is asked at start (the ini decides: the sim is probably not running), each time he gets in the car, before
// the window is revealed (beforeReveal, below), whenever a screen is added, removed or changes, and by the reset
// key. Nothing here places the HUD on the primary screen: the primary is only what the module is told is primary.
function connectedDisplays() {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d) => ({
    id: d.id, bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor, primary: d.id === primaryId,
  }));
}

const hudScreen = hudDisplay.createHudDisplay({
  getWindow: () => overlayWindow,
  getDisplays: connectedDisplays,
  getChoice: () => loadSettingsSync().hudDisplay,
  readIni: () => hudDisplay.readSimIni(app.getPath('documents')),
  askSimWindow: () => hudDisplay.fetchSimWindow(`${localHostUrl()}${hudDisplay.SIM_WINDOW_PATH}`),
  // The screens' real sizes: Electron's are DIPs, rounded up, and a 1440 × 1080 screen at 175 % reads 823 × 618.
  askMonitors: () => hudDisplay.fetchMonitors(`${localHostUrl()}${hudDisplay.MONITORS_PATH}`),
  toDipRect: (rect) => screen.screenToDipRect(null, rect),
  keepAsIs: isDev,
  // The desk's Settings page lists the screens and says where the HUD is: it is told when either has changed.
  onChange: () => {
    if (deskWindow && !deskWindow.isDestroyed()) deskWindow.webContents.send('hud-displays-changed');
    // The HUD's size is the source's: on another screen it is fitted again (only when it differs; hud-source.js).
    if (hudSourceOn() && obsClient.identified()) applyHudSource('the HUD changed screen');
  },
  log: logToFile,
});

// ── The HUD is on screen only while the driver is in the car ──
// The window is made hidden and modules/js/hud-visibility.js is the only thing that reveals it: while the
// telemetry says he is in the car (modules/js/in-car.js), he has not switched the HUD off, and the page is
// loaded. It is this process that asks the telemetry — once a second, twice in the car — and tells the page
// (in-race-state); out of the car the page neither polls nor draws, so at the sim's menus, in the garage, in a
// replay, with the sim closed, the HUD costs a request a second and nothing is ever quit to get it off the screen.
// The garage and the replay are told from the car by the telemetry's own IsOnTrack, which the app's host sends;
// a source that sends none (a SimHub plugin from before 2026-09-29) has a session under way taken for in the car.
// The driver's own switch is kept until the app is quit: off stays off when he gets in, on shows nothing while
// he is out. The tray's "HUD on/off" throws it anywhere; Ctrl+Shift+H and the Stream Deck's button only in the
// car, where what they do is seen. A page that has died is loaded again from there too (loadDashboard): two
// seconds after its process went, and when he gets in the car with none. Dev mode's window stays as dev-mode.js
// put it.
const hud = hudVisibility.createHudVisibility({
  getWindow: () => overlayWindow,
  onInCar: (inCar) => hudKeys.hold(inCar),
  // Got in: the window is put on the screen the sim is on before it is revealed, not after.
  beforeReveal: () => hudScreen.refresh(),
  // The same answer is what the livery behind the car badge goes by (livery, below): which car he is in, and when —
  // and what auto-record and the replay buffer go by (recording.feed: the keeper, below).
  fetchPayload: () => hudVisibility.fetchPayload(hudTelemetryUrl()).then((payload) => { livery.feed(payload); recording.feed(payload); return payload; }),
  loadPage: () => loadDashboard(),
  keepVisible: isDev,
  onSwitch: () => tickHudSwitch(),
  log: logToFile,
});

// The HUD's keys. Held by every program on the machine while they are held here, so held only while he is in the
// car (modules/js/hud-keys.js).
const HUD_KEYS = {
  'CommandOrControl+Shift+H': () => { dispatchAction('toggle-overlay'); },
  'CommandOrControl+Shift+R': () => { dispatchAction('reset-window'); },
  'CommandOrControl+Shift+G': () => {
    // Restart the app. (It flipped a green-screen key as it went, which nothing ever read: the key is gone, migrated
    // out by recording-settings.js, and the restart is what the key does.)
    logToFile('[RacingDesk] Ctrl+Shift+G: restarting...');
    // app.exit skips before-quit, and a restart is not a quit: a recording and a replay buffer Racing Desk started are
    // left running in OBS for the relaunched app to take over (leaveForRelaunch), so the race stays one video. This key
    // is held only while he is in the car, so the new instance must not start OBS with the app (--no-obs-start): the
    // dialogs OBS can open at its start would land over the sim; and it must not open the desk over the sim either
    // (--no-desk): the desk's closing is a quit, and a recording the restart was meant to keep would be stopped by it.
    // A quit that comes while the relaunch waits gives it up (before-quit): `go` is then false.
    leaveForRelaunch().then((go) => {
      if (!go) return;
      app.relaunch({ args: [...process.argv.slice(1).filter((a) => a !== NO_OBS_START && a !== NO_DESK), NO_OBS_START, NO_DESK] });
      app.exit(0);
    });
  },
  'CommandOrControl+Shift+D': () => { if (overlayWindow) overlayWindow.webContents.send('restart-demo'); },
  'CommandOrControl+Shift+I': () => { if (overlayWindow) overlayWindow.webContents.send('toggle-rating-editor'); },
  'CommandOrControl+Shift+F': () => { if (overlayWindow) overlayWindow.webContents.send('toggle-drive-mode'); },
  // Recording, from the car: Record/Stop never starts OBS from here (the HUD says "OBS is not open" instead).
  'CommandOrControl+Shift+V': () => { dispatchAction('toggle-recording', { source: 'key' }); },
  'CommandOrControl+Shift+B': () => { dispatchAction('save-replay-buffer', { source: 'key' }); },
  'CommandOrControl+Shift+P': () => { dispatchAction('tv-shots', { source: 'key' }); },
  // Quits the overlay, and only the overlay (the quit action, below).
  'CommandOrControl+Shift+Q': () => { dispatchAction('quit'); },
};
const hudKeys = createHudKeys({
  keys: HUD_KEYS,
  register: (key, act) => globalShortcut.register(key, act),
  unregister: (key) => globalShortcut.unregister(key),
  log: logToFile,
});

// ── OBS records (modules/js/obs) ───────────────────────────────
// The client talks obs-websocket 5 to OBS on 127.0.0.1 and tries again every 5 s while OBS is closed, which is how
// OBS being open is noticed (tasklist runs only on a press). The password is read from OBS's own settings file each
// time OBS asks, or is the one he typed on the Recording card, kept with safeStorage; it is held in memory by neither
// this file nor the client, and no log line carries it. The keeper mirrors OBS's recording, writes the sidecar and
// the chapters, files each recording in its folder, knows which recordings are Racing Desk's, keeps the floor under
// the disk, records by itself from the payload it is fed (hud, above) and keeps the replay buffer with the car.
// Recording state is shown on the desk's masthead, the tray and the Stream Deck, never on the HUD, which OBS films.
const obsPaths = obs.launcher.obsPaths(app.getPath('appData'));
const recordingStateFile = path.join(app.getPath('userData'), 'recording-state.json');
let obsFilePassword = null;   // from OBS's config.json the last time Set up OBS ran; otherwise read afresh at Hello

function typedObsPassword() {
  const enc = loadSettingsSync()[OBS_PASSWORD_KEY];
  if (typeof enc !== 'string' || !enc || !app.isReady()) return null;
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(Buffer.from(enc, 'base64')) || null;
  } catch (e) {
    return null;
  }
}

function obsPassword() {
  const typed = typedObsPassword();
  if (typed) return typed;
  const cfg = obs.launcher.readWebSocketConfig(obsPaths.configJson, { readFile: fs.readFileSync });
  return cfg.state === 'ok' ? cfg.password : obsFilePassword;
}

function obsPort() {
  const cfg = obs.launcher.readWebSocketConfig(obsPaths.configJson, { readFile: fs.readFileSync });
  return cfg.state === 'ok' ? cfg.port : obs.launcher.WS_DEFAULT_PORT;
}

const obsClient = obs.createObsClient({ port: obsPort, password: obsPassword, log: logToFile });

function recordingFolder() {
  return recordingSettings.recordingFolder(loadSettingsSync(), { exists: fs.existsSync, home: app.getPath('home') });
}

const execFileAsync = (cmd, args) => new Promise((resolve, reject) => {
  execFile(cmd, args, { windowsHide: true, timeout: 5000 }, (err, stdout) => (err ? reject(err) : resolve({ stdout })));
});

// What a press has to do about OBS when it is not answering (modules/js/obs/launcher.js): nothing if it is running (its
// WebSocket may be off, or it may be asking about its last crash), else start it detached and minimised — and never a
// second one, whether tasklist cannot say or two presses come together. Only ever from the desk, the tray or the
// Stream Deck, out of the car (the keeper sees to that); never from the car, auto-record or the app's start unless
// "Start OBS with Racing Desk" is on, and then only once the telemetry says he is out of the car.
const obsStarter = obs.launcher.createStarter({
  exec: execFileAsync,
  paths: obsPaths,
  obsPath: () => loadSettingsSync().obsPath,
  exists: fs.existsSync,
  readdir: fs.readdirSync,
  readFile: fs.readFileSync,
  spawn,
  log: logToFile,
});
const startObsIfClosed = () => obsStarter.startIfClosed();

// "Open OBS" on the tray and the card: a press, out of the car.
async function openObs() {
  if (hud.state().inCar) return { ok: false, reason: 'OBS is not opened from the car' };
  const answer = await startObsIfClosed();
  if (answer.ok) obsClient.tryNow();
  return answer;
}

// "Start OBS with Racing Desk": never from the relaunch Ctrl+Shift+G makes (a key held only in the car), and never
// while he is in the car — a Racing Desk restarted mid-session would open OBS over the sim, with whatever dialog it
// has to ask. The telemetry is asked until it answers (a host just started answers a few seconds late; up to a
// minute), and OBS is started only if it says he is out of the car.
const NO_OBS_START = '--no-obs-start';
const NO_DESK = '--no-desk';   // no desk window at start; the relaunch Ctrl+Shift+G makes carries it too, for the same reason
async function startObsWithApp() {
  const asked = Date.now();
  for (;;) {
    const payload = await hudVisibility.fetchPayload(hudTelemetryUrl()).catch(() => null);
    const decision = obs.launcher.startWithApp({
      enabled: loadSettingsSync().obsStartWithApp === true,
      relaunched: process.argv.includes(NO_OBS_START),
      answered: !!payload,
      inCar: RacingDeskInCar.inCar(payload),
    });
    if (decision.start) {
      const answer = await startObsIfClosed();
      if (answer.ok) obsClient.tryNow();
      else logToFile(`[RacingDesk] OBS with the app: ${answer.reason}`);
      return;
    }
    if (!decision.wait) { logToFile(`[RacingDesk] OBS is not started with the app: ${decision.why}`); return; }
    if (Date.now() - asked > 60000) { logToFile('[RacingDesk] OBS is not started with the app: the telemetry did not answer in a minute'); return; }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

const recording = obs.createRecordingKeeper({
  client: obsClient,
  settings: loadSettingsSync,
  recordFolder: recordingFolder,
  // The folder OBS's own profile records into: where the floor looks while OBS is not there to be asked.
  obsFolder: () => obs.launcher.profileRecordFolder({ appData: app.getPath('appData'), readFile: fs.readFileSync }),
  stateFile: recordingStateFile,
  // The real rate of his newest recordings, from the files (modules/js/obs/recording-rate.js), for the card's GB an hour
  // and the hours left; until there is one, the bitrate his profile is capped at (setupStatus reads the encoder file,
  // and keeps it for five seconds).
  // Only the recordings begun after the profile's encoder file was last written count: those before were made with other
  // settings (the fixed 100 Mbps, which is 45 GB an hour whatever the racing), and the first race with the quality target
  // would be averaged with them.
  measureRate: (root, { since = null } = {}) => obs.recordingRate.measureRate(root, { fs, since }),
  measureSince: () => obs.launcher.encoderChangedAt({ appData: app.getPath('appData'), readFile: fs.readFileSync, mtimeOf: (file) => fs.statSync(file).mtimeMs }),
  configuredBytesPerSecond: () => { const cap = setupStatus().capKbps; return Number.isFinite(cap) && cap > 0 ? cap * 125 : null; },
  fetchPayload: () => hudVisibility.fetchPayload(hudTelemetryUrl()),
  inCar: () => hud.state().inCar,
  // A press in the car that finds OBS not answering asks tasklist whether it is open at all, so that "OBS is not open"
  // is not put on the HUD (and into the video) when it is.
  obsRunning: () => obs.launcher.isObsRunning({ exec: execFileAsync }),
  startObs: startObsIfClosed,
  // The two sentences the HUD may show, and no other.
  notice: (text) => { if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.webContents.send('hud-notice', text); },
  onChange: () => { buildTrayMenu(); tellDeskRecording(); },
  log: logToFile,
});

// ── "HUD drawn by OBS" (modules/js/obs/hud-source.js) ──
// Off unless he turns it on. On: the HUD's own window is taken out of every screen capture first (setContentProtection,
// which takes effect at the next composition), then OBS is given the HUD as a browser source in the scenes of the
// collection the switch was turned on in that have a game video, from the loopback listener's page (/obs), just above
// it; the page is reloaded when OBS answers unless it is alive and polling, and the source is disabled when Racing Desk
// quits (CEF has no handler for a page that failed to load). Off: the items are disabled — at every connect, whatever
// OBS was left showing — and then the window is in the capture again; never removed. Nothing of his is ever removed.
// The page's address is the port the listener is on (not the one the settings name: it may have been taken), and the HUD
// is not given to OBS while the listener is not up. Which page is his choice, "Rig HUD" (/obs, the HUD window's size,
// fitted to the game) or "iPad dashboard" (/obs-ipad, an iPad's size, placed once in a corner: hud-source.js).
const hudSource = obs.createHudSource({
  client: obsClient,
  url: (view) => { const info = localServer.getInfo(); return info.running ? `http://127.0.0.1:${info.port}${view === 'ipad' ? remoteServer.OBS_IPAD_PATH : remoteServer.OBS_PATH}` : null; },
  view: () => hudSourceView(),
  ready: () => localServer.isRunning(),
  pageAlive: () => localServer.servedWithin(OBS_PAGE_ALIVE_MS),
  size: hudSourceSize,
  state: obs.hudSource.fileState(path.join(app.getPath('userData'), 'hud-source-state.json'), { fs, log: logToFile }),
  log: logToFile,
});
const OBS_PAGE_ALIVE_MS = 5000;   // the page asks the telemetry every second out of the car and thirty times a second in it

// The HUD's screen in DIPs, as the rig's window lays its page out: the page is drawn in CSS pixels, and the source is the
// same size and scaled up to the canvas by OBS (a source in physical pixels would lay the page out larger, and the
// recorded HUD would be smaller than the one he sees wherever the screen is not at 100 %).
function hudSourceSize() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return null;
  const bounds = overlayWindow.getBounds();
  return { width: bounds.width, height: bounds.height };
}

const hudSourceOn = () => loadSettingsSync().obsHudSource === true;
// What OBS draws with the switch on, 'rig' or 'ipad' (recording-settings.js: 'ipad' only when the file says so).
const hudSourceView = () => recordingSettings.hudViewOf(loadSettingsSync());
let hudSourceWas = null;
let hudViewWas = null;

// The switch as it stands, applied: called at OBS's connect, when the collection changes, when the settings change (the
// switch, or the choice of what OBS draws), when the HUD's screen changes and at start. hudSource.apply does the ordering
// — the window out of the capture before the source is enabled, and back in only after OBS has stopped drawing it — and
// applies "off" whatever the last word was, so a HUD left enabled in OBS is switched off at every connect. `fresh`: the
// switch has just been turned on.
function applyHudSource(why, { fresh = false } = {}) {
  hudSourceWas = hudSourceOn();
  hudViewWas = hudSourceView();
  const protect = (flag) => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    try { overlayWindow.setContentProtection(flag); } catch (err) { logToFile(`[RacingDesk] HUD source: the window could not be ${flag ? 'taken out of' : 'put back into'} the capture: ${err.message}`); }
  };
  hudSource.apply({ on: hudSourceWas, fresh, protect })
    .then(() => tellDeskRecording())
    .catch((err) => logToFile(`[RacingDesk] HUD source (${why}): ${err.message}`));
}

obsClient.onChange((state) => {
  if (state.phase === 'identified') applyHudSource('OBS answered');
});
// He changed to another scene collection: the HUD is where it was set up and nowhere else, and the window follows.
obsClient.on('CurrentSceneCollectionChanged', () => applyHudSource('the scene collection changed'));

// ── TV shots (modules/js/obs/tv-shots.js) ──
// After a race, from the desk's race detail, the tray or the Stream Deck: the recording's moments recorded again from
// iRacing's replay through a TV camera, the replay driven by the app's own host over its replay route
// (/racing-desk/data/replay: the SDK's own commands, for a program on this machine). No key is pressed. The take goes
// into the race's folder as `… tv.mp4` with its sidecar; progress is on the desk's pill and card and the tray.
const hostReplay = {
  status: () => askHost('GET', '/racing-desk/data/replay'),
  command: (body) => askHost('POST', '/racing-desk/data/replay', body),
};

// A request of the app's own host, from this process (a page's would be refused): JSON in, JSON out, 3 s at most.
async function askHost(method, route, body = null) {
  const res = await fetch(`${localHostUrl()}${route}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(3000),
  });
  let answer = null;
  try { answer = await res.json(); } catch (e) { answer = null; }
  if (!res.ok) return { ok: false, error: (answer && answer.error) || `the host answered ${res.status}`, status: res.status };
  return answer;
}

const tvShots = obs.createTvShots({
  client: obsClient,
  recording,
  replay: hostReplay,
  settings: loadSettingsSync,
  // The facecam a take has hidden is written here before it is hidden and shown again from here at the next start or the
  // next time OBS answers, whatever became of the take (modules/js/obs/tv-shots.js).
  stateFile: path.join(app.getPath('userData'), 'tv-state.json'),
  inCar: () => hud.state().inCar,
  log: logToFile,
  onChange: () => { buildTrayMenu(); tellDeskRecording(); },
});

// The recording a race is of, for the desk's race detail: by the session's start and track, in the recordings folder.
function recordingForRace(race) {
  const list = obs.recordingsIndex.listRecordings(recordingFolder(), { fs });
  const found = obs.recordingsIndex.matchRace(list, { startedAt: race && race.startedAt, track: race && race.track });
  return found ? { folder: found.folder, name: found.name, video: found.video, take: found.take, startedAt: found.startedAt, clips: found.clips } : null;
}

// TV shots of a recording: the desk names the race's folder; the tray and the Stream Deck mean the latest recording.
async function startTvShots({ source = 'desk', folder = null } = {}) {
  if (hud.state().inCar) return { ok: false, reason: obs.tvShots.IN_CAR };
  let where = typeof folder === 'string' && folder ? folder : null;
  if (!where) {
    const latest = obs.recordingsIndex.latest(obs.recordingsIndex.listRecordings(recordingFolder(), { fs }));
    if (!latest) return { ok: false, reason: obs.tvShots.NO_RECORDING };
    where = latest.folder;
  }
  logToFile(`[RacingDesk] TV shots asked for from the ${source}: ${where}`);
  return tvShots.start({ folder: where });
}

// What the desk is told of the recording: the keeper's status, what Set up OBS has left to do, and the folder.
let setupLookedAt = { at: 0, value: null };
function setupStatus() {
  const now = Date.now();
  if (setupLookedAt.value && now - setupLookedAt.at < 5000) return setupLookedAt.value;
  const folder = recordingFolder();
  const cfg = obs.launcher.readWebSocketConfig(obsPaths.configJson, { readFile: fs.readFileSync });
  const profile = obs.launcher.currentProfileIni({ appData: app.getPath('appData'), readFile: fs.readFileSync });
  let check = null;
  if (profile) {
    try { check = obs.launcher.profileCheck(fs.readFileSync(profile.ini, 'utf8'), folder); } catch (e) { check = null; }
  }
  // The recordings' size: whether the profile's encoder file has the quality target, for the encoders it means something
  // to (NVENC, Advanced output); null where it does not, and then nothing is said of size.
  let encoder = null;
  try { encoder = obs.launcher.encoderStatus({ appData: app.getPath('appData'), readFile: fs.readFileSync }); } catch (e) { encoder = null; }
  const qualityTarget = encoder && encoder.applies ? encoder.qualityTarget : null;
  const value = {
    wsState: cfg.state,
    wsEnabled: cfg.state === 'ok' ? cfg.enabled : null,
    wsPort: cfg.port,
    profile: profile ? profile.profile : null,
    hybrid: check ? check.hybrid : null,
    replayBuffer: check ? check.replayBuffer : null,
    replaySeconds: check ? check.replaySeconds : null,
    folderSet: check ? check.folder : null,
    folderExists: fs.existsSync(folder),
    obsFound: !!obs.launcher.findObs({ obsPath: loadSettingsSync().obsPath, exists: fs.existsSync }),
    encoder: encoder ? encoder.encoder : null,
    qualityTarget,
    capKbps: encoder && encoder.applies ? encoder.capKbps : null,
    outputSize: encoder && encoder.applies ? encoder.size : null,
    needed: !(cfg.state === 'ok' && cfg.enabled && check && check.ok && qualityTarget !== false),
  };
  setupLookedAt = { at: now, value };
  return value;
}

function recordingStatus() {
  const state = obsClient.state();
  const settings = loadSettingsSync();
  return {
    ...recording.status(),
    folder: recordingFolder(),
    setup: setupStatus(),
    needsPassword: !!(state.authFailed || state.passwordMissing),
    passwordTyped: typeof settings[OBS_PASSWORD_KEY] === 'string' && settings[OBS_PASSWORD_KEY].length > 0,
    obsStartOnRecord: settings.obsStartOnRecord !== false,
    obsStartWithApp: settings.obsStartWithApp === true,
    obsPath: typeof settings.obsPath === 'string' ? settings.obsPath : null,
    recordingAutoRecord: settings.recordingAutoRecord !== false,
    recordingInstantReplay: settings.recordingInstantReplay === true,
    recordingChapters: settings.recordingChapters !== false,
    obsHudSource: settings.obsHudSource === true,
    obsHudView: recordingSettings.hudViewOf(settings),
    obsPanelBackground: typeof settings.obsPanelBackground === 'number' && Number.isFinite(settings.obsPanelBackground) ? settings.obsPanelBackground : 90,
    tvShotsHideFacecam: settings.tvShotsHideFacecam !== false,
    hudSource: hudSource.status(),
    tv: tvShots.status(),
  };
}

function tellDeskRecording() {
  if (deskWindow && !deskWindow.isDestroyed()) {
    try { deskWindow.webContents.send('recording-state', recordingStatus()); } catch (e) { /* closing */ }
  }
}

// Set up OBS: one press does what OBS needs — the WebSocket on and its password read, Hybrid MP4, the 20 s replay
// buffer and the recording folder in his profile, and the recordings' size (a quality target instead
// of a fixed bitrate, in the profile's encoder file, which only a run with OBS closed can write) — in the files while
// OBS is closed, over the WebSocket while it is open. The card says in one sentence what it will change before he presses.
async function setupObs() {
  const folder = recordingFolder();
  setupLookedAt = { at: 0, value: null };
  // modules/js/obs/launcher.js: over the WebSocket while OBS answers, in its files only while it is known to be closed
  // (a tasklist that cannot say, or OBS open and not answering, leaves them alone: OBS would write them over).
  const result = await obs.launcher.setupObs({
    client: obsClient, exec: execFileAsync, appData: app.getPath('appData'), folder,
    readFile: fs.readFileSync, writeFile: fs.writeFileSync, rename: fs.renameSync, mkdir: fs.mkdirSync, exists: fs.existsSync,
  });
  setupLookedAt = { at: 0, value: null };
  // The encoder file may have been written just now: the recordings measured are those since.
  recording.refreshRate();
  if (result.ran === 'closed') {
    obsFilePassword = result.password;
    logToFile(`[RacingDesk] Set up OBS (closed): ${[...result.did, ...result.problems].join(' ')} (password: ${result.password ? 'set' : 'none'})`);
    // The password in OBS's own file is the one it has now: one typed earlier, which would be tried first and may be
    // the one OBS refused, is dropped.
    if (result.password && typeof loadSettingsSync()[OBS_PASSWORD_KEY] === 'string') {
      const settings = loadSettingsSync();
      delete settings[OBS_PASSWORD_KEY];
      saveSettingsSync(settings);
    }
    obsClient.passwordChanged();
  } else {
    logToFile(`[RacingDesk] Set up OBS (${result.ran || 'not done'}): ${[...result.did, ...result.problems].join(' ')}`);
  }
  return { ok: result.ok, did: result.did, problems: result.problems };
}

// The password he typed, kept with safeStorage and stripped from every page's copy of the settings; an empty one
// takes the typed password away and OBS's own file is read again. The value is never logged.
function setObsPassword(text) {
  const value = typeof text === 'string' ? text : '';
  if (!value) {
    const settings = loadSettingsSync();
    if (OBS_PASSWORD_KEY in settings) { delete settings[OBS_PASSWORD_KEY]; saveSettingsSync(settings); }
    obsClient.passwordChanged();
    return { ok: true };
  }
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, reason: 'Windows could not protect the password, so it was not kept.' };
  saveSettingsKeySync(OBS_PASSWORD_KEY, safeStorage.encryptString(value).toString('base64'));
  logToFile('[RacingDesk] OBS password typed on the Recording card (password: set)');
  obsClient.passwordChanged();
  return { ok: true };
}

// Quitting: a recording Racing Desk started is stopped (StopRecord, STOPPED waited for 3 s at most) and the recording
// that has just stopped is filed (the file held still for two seconds, moved with its sidecar: up to 8 s more, a few
// seconds usually); OBS and his own recordings are left as they are.
let stoppedForQuit = false;
function stopOwnedRecording() {
  if (stoppedForQuit) return Promise.resolve();
  stoppedForQuit = true;
  // A take under way ends and his facecam is shown again before anything else is waited for (1.5 s at most, as the HUD
  // source below): left hidden it would be missing from every recording he makes next.
  const tvOff = Promise.race([tvShots.stopForQuit(), new Promise((resolve) => setTimeout(resolve, 1500))]).catch(() => {});
  // The HUD source is switched off in OBS on the way out: a browser source whose page has gone shows whatever CEF shows
  // for a page that failed to load, and nothing reloads it until Racing Desk is back.
  const hudOff = hudSourceOn() && obsClient.identified()
    ? Promise.race([hudSource.disable({ final: true }), new Promise((resolve) => setTimeout(resolve, 1500))]).catch(() => {})
    : Promise.resolve();
  return Promise.race([
    Promise.all([recording.stopOwnedForQuit(), hudOff, tvOff]),
    new Promise((resolve) => setTimeout(resolve, obs.recording.QUIT_WAIT_MS + obs.recording.FILING_QUIT_WAIT_MS + 500)),
  ]).catch((err) => logToFile(`[RacingDesk] Recording: could not be stopped on quit: ${err.message}`));
}

// Relaunching (Ctrl+Shift+G, a key held only in the car): not a quit. The recording and the replay buffer Racing Desk
// started run on in OBS — the keeper keeps the state file, which says both are its own, and closes the sidecar to be gone
// on in — and the relaunched app, back within seconds, takes them over when OBS answers, so a restart mid-race leaves the
// race one video (modules/js/obs/recording.js, leaveForRelaunch). The HUD source stays on: the page in OBS stays loaded
// and goes on by itself when the new listener is up. A take under way ends and his facecam is shown again, as at a quit:
// nothing drives the replay once this process is gone (first, and then the keeper, so that nothing is closed that a quit
// arriving meanwhile would need). A filing under way is waited for, as at a quit.
// Resolves to whether the relaunch is to go on. It is not when a quit is under way, or comes while this waits (the tray's
// Quit, the desk closed: before-quit gives the relaunch up, `relaunchPending`, and takes the quit path, which stops what
// Racing Desk started and files it — the relaunch must not leave it running with no app).
function leaveForRelaunch() {
  if (stoppedForQuit || relaunchPending) return Promise.resolve(false);
  relaunchPending = true;
  const tvOff = Promise.race([tvShots.stopForQuit(), new Promise((resolve) => setTimeout(resolve, 1500))]).catch(() => {});
  return Promise.race([
    tvOff.then(() => (relaunchPending ? recording.leaveForRelaunch() : null)),
    new Promise((resolve) => setTimeout(resolve, obs.recording.QUIT_WAIT_MS + obs.recording.FILING_QUIT_WAIT_MS + 500)),
  ]).catch((err) => logToFile(`[RacingDesk] Recording: could not be left for the relaunch: ${err.message}`)).then(() => relaunchPending);
}

// Where the HUD's page reads its telemetry. The settings are read again every ten seconds, not every poll.
let hudTelemetry = { url: null, readAt: 0 };
function hudTelemetryUrl() {
  if (!hudTelemetry.url || Date.now() - hudTelemetry.readAt > 10000) {
    const replayPort = devMode ? devMode.readArgs().replayPort : null;
    hudTelemetry = { url: hudVisibility.telemetryUrl(loadSettingsSync().simhubUrl, { replayPort }), readAt: Date.now() };
  }
  return hudTelemetry.url;
}

function tickHudSwitch() {
  const item = trayMenu && trayMenu.getMenuItemById('hud');
  if (item) item.checked = !hud.state().hudOff;
}

// Single dashboard: vanilla TypeScript build (Vite-bundled, single-file HTML)
const DASHBOARD_FILE = 'dashboard.html';

function getDashboardFile() {
  return DASHBOARD_FILE;
}

/** Load the dashboard into the overlay window via file:// (all assets inlined). */
function loadDashboard() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  logToFile('[RacingDesk] Loading dashboard via file://');
  // Said here as well as at did-start-navigation, which comes a moment later: in between, a poll that finds
  // him in the car must not take the page for gone and load it a second time.
  hud.pageLoading();
  // How it ended is said by did-finish-load and did-fail-load; a load given up for a newer one rejects too.
  overlayWindow.loadFile(path.join(__dirname, getDashboardFile())).catch(() => {});
}

async function createOverlay() {
  logToFile(`[RacingDesk] Dashboard: ${getDashboardFile()}`);

  // ── Transparent overlay window ──
  // On the screen hud-display chooses (hudScreen, above). macOS: its workArea, to respect the dock and menu bar.
  // Windows: its full bounds, so the overlay covers the entire screen over the game.
  const startAt = hudScreen.initialBounds() || {};

  overlayWindow = new BrowserWindow({
    width:  startAt.width,
    height: startAt.height,
    x:      startAt.x,
    y:      startAt.y,
    icon: path.join(__dirname, 'images', 'branding', 'icon.png'),
    // Created hidden — shown only while the driver is in the car (hud, above).
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
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  // A window made on a screen of another scale can come out at the wrong size: looked at, and put right if so.
  hudScreen.place();
  if (devMode) devMode.attach(overlayWindow, { rootDir: __dirname, log: logToFile });
  // A page being loaded — the first time, after a crash, on resume — is nothing to look at, and once loaded it
  // has to be told afresh whether he is in the car.
  overlayWindow.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) hud.pageLoading();
  });
  loadDashboard();
  logToFile('[RacingDesk] Overlay created hidden — shown while the driver is in the car');

  overlayWindow.webContents.on('did-finish-load', () => {
    hud.pageLoaded();
  });

  // -3 is a load given up for a newer one, which has its own ending to come.
  overlayWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    logToFile(`[RacingDesk] Dashboard did not load: ${errorDescription} (${errorCode})`);
    hud.pageFailed();
  });

  overlayWindow.on('closed', () => { hud.stop(); overlayWindow = null; });
  hud.start();

  // ── Follow the screens ──
  // A screen added, removed or changed — its size or scale, or the taskbar moving its work area — is a reason to ask
  // again where the HUD belongs, whichever screen it was. The window is moved only if the answer differs.
  const screensChanged = (why) => () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    logToFile(`[RacingDesk] ${why}`);
    hudScreen.refresh();
  };
  screen.on('display-added', screensChanged('A screen was added'));
  screen.on('display-removed', screensChanged('A screen was removed'));
  screen.on('display-metrics-changed', () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    hudScreen.refresh();
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
  // The HUD's keeper loads the page again (hud-visibility.js pageGone): for every reason but a clean exit, two
  // seconds later, three times at most without a load finishing — and once more each time he gets in the car.
  overlayWindow.webContents.on('render-process-gone', (_event, details) => {
    logToFile(`[RacingDesk] Renderer gone: ${details.reason}`);
    hud.pageGone(details.reason);
  });

  overlayWindow.webContents.on('unresponsive', () => {
    // A page that hangs takes no new load either: it is its process that has to go. render-process-gone then
    // has it loaded again (hud.pageGone), counted with the rest.
    logToFile('[RacingDesk] Renderer unresponsive — ending its process, to load the page again');
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      try { overlayWindow.webContents.forcefullyCrashRenderer(); } catch (_) { loadDashboard(); }
    }
  });

  // ── GPU process crash handler ───────────────────────────────
  app.on('child-process-gone', (_event, details) => {
    logToFile(`[RacingDesk] Child process gone: type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`);
    if (details.type === 'GPU') {
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        logToFile('[RacingDesk] GPU process crashed — reloading dashboard');
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
    logToFile('[RacingDesk] System resumed — reloading dashboard');
    setTimeout(() => {
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        loadDashboard();
      }
    }, 1500);
  });
}

// ── The HUD on an iPad (remote-server.js) ────────────────────
// Off unless the driver switched it on in the desk's Settings; then it starts with the app. What it is reached
// by — the key in its address — is made the first time and kept in the settings, so an address opened once on
// the iPad goes on working.
let remoteServerError = null;

// The keys of the settings file that are this process's own: written one at a time, as the switch is thrown.
const REMOTE_SETTINGS = ['remoteServer', 'remoteServerPort', 'remoteServerKey'];
// And the OBS WebSocket password he typed, kept with Electron's safeStorage (modules/js/obs): the same rule.
const OBS_PASSWORD_KEY = 'obsWebSocketPasswordEnc';
const PRIVATE_SETTINGS = [...REMOTE_SETTINGS, OBS_PASSWORD_KEY];

// The settings as a window is given them: without the key in the iPad's address or the OBS password, which no page
// has a use for.
function withoutRemoteKey(settings) {
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) return settings;
  const { remoteServerKey, [OBS_PASSWORD_KEY]: obsPassword, ...rest } = settings;
  return rest;
}

function remoteServerKey(renew = false) {
  const saved = loadSettingsSync().remoteServerKey;
  if (!renew && remoteServer.isKey(saved)) return saved;
  const key = remoteServer.newKey();
  saveSettingsKeySync('remoteServerKey', key);
  return key;
}

async function startRemoteServer(port) {
  const settings = loadSettingsSync();
  remoteServerError = null;
  try {
    return await remoteServer.start({
      port: port || settings.remoteServerPort || remoteServer.DEFAULT_PORT,
      appDir: __dirname,
      telemetryUrl: settings.simhubUrl,
      key: remoteServerKey(),
      log: logToFile,
      // The crop behind the car badge, for the iPad, from this process's memory (livery, below).
      crop: () => livery.current(),
      // His settings whole; the server tells the iPad the panel background and nothing else (remote-server.js, IPAD_SETTINGS).
      displaySettings: () => loadSettingsSync(),
    });
  } catch (err) {
    remoteServerError = err.message;
    throw err;
  }
}

function remoteServerInfo() {
  const settings = loadSettingsSync();
  return {
    ...remoteServer.getInfo(),
    enabled: settings.remoteServer === true,
    port: remoteServer.isRunning() ? remoteServer.getInfo().port : (settings.remoteServerPort || remoteServer.DEFAULT_PORT),
    error: remoteServerError,
  };
}

async function maybeStartRemoteServer() {
  if (loadSettingsSync().remoteServer !== true) return;
  try {
    await startRemoteServer();
  } catch (err) {
    logToFile(`[RacingDesk] Remote server failed to start: ${err.message}`);
  }
}

// ── The listener on 127.0.0.1 alone (remote-server.js, loopback) ──
// Always up, whatever the iPad switch: the Stream Deck's buttons ask it for the actions, and OBS draws the HUD from
// it when "HUD drawn by OBS" is on (/obs). Of the settings file it serves the display settings alone (the allowlist
// in remote-server.js), and of the app its state (/api/status). Its port is `localServerPort` (9091 unless changed);
// it never has a key to show, and never listens on any other address.
const localServer = remoteServer.createServer({ loopback: true });

function localServerPort() {
  const port = loadSettingsSync().localServerPort;
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : remoteServer.LOCAL_DEFAULT_PORT;
}

// What the loopback listener says of the app: in the car or not, the HUD on screen or not, and the recording in short
// (the Stream Deck writes it on its key; the OBS page may read it).
function localStatus() {
  const h = hud.state();
  const r = recording.status();
  return {
    inCar: h.inCar,
    hudVisible: h.visible,
    // His HUD switch (Ctrl+Shift+H, the tray, the Stream Deck, Quit Overlay): the page OBS draws is hidden while it is off.
    hudOff: h.hudOff === true,
    hudActions: { seq: hudPageActions.seq, recent: hudPageActions.recent.slice() },
    recording: {
      recording: r.recording, starting: r.starting, stopping: r.stopping, paused: r.paused, elapsedMs: r.elapsedMs,
      obs: r.obs, owned: r.owned, auto: r.auto, replay: !!(r.replay && r.replay.running),
      tv: (() => { const t = tvShots.status(); return t.running ? { running: true, index: t.index, total: t.total, step: t.step } : null; })(),
    },
  };
}

// Started, and tried again with a growing wait until it is up (a port another program holds at the app's start is not a
// listener that is never there, and the Stream Deck and the HUD in OBS both depend on it); the port is read afresh at each
// try. When it comes up the HUD source is applied again: it is not given to OBS while the page is not served.
function startLocalServer() {
  return remoteServer.startWithRetry(localServer, () => ({
    port: localServerPort(),
    appDir: __dirname,
    telemetryUrl: loadSettingsSync().simhubUrl,
    key: remoteServer.newKey(),   // a key the loopback listener never asks for; the server needs one to start
    log: logToFile,
    crop: () => livery.current(),
    status: localStatus,
    displaySettings: () => loadSettingsSync(),
  }), {
    log: logToFile,
    onUp: () => { if (hudSourceOn() && obsClient.identified()) applyHudSource('the listener is up'); },
  });
}

logToFile('[RacingDesk] App starting...');

app.whenReady().then(async () => {
  if (!isFirstInstance) return;   // quitting: the running instance opens its desk instead

  // Remove the default Electron menu bar (File/Edit/View/etc) from all windows
  Menu.setApplicationMenu(null);

  logToFile(`[RacingDesk] Platform: ${os.platform()} ${os.arch()} | Electron ${process.versions.electron}`);
  logToFile('[RacingDesk] Hotkeys: Ctrl+Shift+O desk; the HUD\'s are held while he is in the car, Ctrl+Shift+Q (HUD away) among them');
  try {
    createOverlay();
    logToFile('[RacingDesk] Overlay window created OK');
    applyHudSource('start');
    createTray();

    maybeStartRemoteServer();
    startLocalServer();
    startSettingsWatcher();

    // OBS: the client tries its WebSocket every 5 s from here on; OBS itself is started only on his press, unless
    // he turned "Start OBS with Racing Desk" on.
    recording.start();
    obsClient.start();
    if (!isDev && loadSettingsSync().obsStartWithApp === true) {
      startObsWithApp().catch((err) => logToFile(`[RacingDesk] OBS with the app: ${err.message}`));
    }

    // The Stream Deck plugin, from the copy this build carries (not in dev mode, whose folder is the source tree).
    if (!isDev) installStreamDeckPlugin();
  } catch (err) {
    logToFile(`[RacingDesk] FATAL: createOverlay() threw: ${err.stack || err.message}`);
    app.quit();
    return;
  }

  // ── AUTO-CONNECT iRacing ──
  // Open the iRacing web client and start syncing on app launch.
  // No clicks needed — just opens the window and goes.
  //
  // ── GLOBAL HOTKEYS ──
  // The app's own one is held for as long as it runs. The HUD's (HUD_KEYS) are held only while he is in the
  // car: hud-visibility says when (onInCar). In dev mode the window is always there, and so are its keys.
  // No key quits the app: Ctrl+Shift+Q did, from wherever it was pressed, and took the desk and the host with
  // the overlay it was pressed to be rid of.

  globalShortcut.register('CommandOrControl+Shift+O', () => showDesk('desk'));

  if (isDev) hudKeys.hold(true);

  await startLocalHost();
  if (!process.argv.includes(NO_DESK)) showDesk();
});

app.on('will-quit', () => {
  if (app.isReady()) globalShortcut.unregisterAll();   // a second instance quits before ready
  if (typeof recording !== 'undefined' && recording) { recording.dispose(); obsClient.stop(); }
  // The host watches this process (--parent-pid) and stops by itself once we're gone, flushing the lap it
  // was recording; a kill now would cut that short. The 3 s backstop only fires if the app is still here. A host
  // that outlives us is not this code's to end: it ends itself if its stop is not over 5 s after we went (HostStop.cs).
  hostLauncher.stopHost(hostChild, { graceMs: 3000 });
});

// ═══════════════════════════════════════════════════════════════
// STREAM DECK ACTION API
// Centralized dispatcher for all overlay actions. Called by
// both global hotkeys and the HTTP action endpoint so Stream
// Deck can trigger any action via a simple GET request.
// ═══════════════════════════════════════════════════════════════

const _actionHandlers = {
  // ── Window / App ──
  // The driver's switch, not the window's: see hud, above. From Ctrl+Shift+H and the Stream Deck, so only in the
  // car: out of it the switch is left as it was and the answer says so ({ ok: false, reason: 'out of the car' }).
  'toggle-overlay': () => hud.toggle(),
  // "Open Settings" on the Stream Deck: the desk's Settings page. (It opened racing-desk-native://settings, the old
  // WinUI app's protocol, which is not this app.)
  'toggle-settings': () => {
    try {
      showDesk('settings');
      return { ok: true };
    } catch (err) {
      logToFile(`[RacingDesk] toggle-settings failed: ${err.message}`);
      return { ok: false, reason: err.message };
    }
  },
  // Puts the window back on the screen the rule chooses (hudScreen, above), covering all of it; the answer does not
  // wait for the sim to be asked where it is.
  'reset-window': () => {
    if (!overlayWindow) return { ok: false, reason: 'no window' };
    logToFile('[RacingDesk] HUD window reset');
    hudScreen.reset();
    return { ok: true };
  },
  // "Quit Overlay" on the Stream Deck, Ctrl+Shift+Q in the car. It is the overlay that is quit: the HUD is put
  // away and the app carries on. The app itself is quit from the tray, or by closing the desk.
  'quit': () => hud.putAway(),

  // ── Renderer IPC passthrough ──
  'restart-demo':           () => _sendRenderer('restart-demo'),
  'toggle-rating-editor':   () => _sendRenderer('toggle-rating-editor'),
  'toggle-drive-mode':      () => _sendRenderer('toggle-drive-mode'),

  // ── Recording (modules/js/obs) ──
  // Record and Stop are OBS's, mirrored by the keeper. Where the press came from decides whether OBS may be started:
  // the desk, the tray and the Stream Deck may (out of the car), a key in the car may not. The answer is a promise
  // the Stream Deck's route awaits.
  'toggle-recording':   ({ source = 'streamdeck' } = {}) => recording.toggle({ source }),
  'start-recording':    ({ source = 'streamdeck' } = {}) => recording.record({ source }),
  'stop-recording':     () => recording.stop(),
  'save-replay-buffer': ({ source = 'streamdeck' } = {}) => recording.saveReplay({ source }),
  // TV shots: from the desk (which names the race's folder), the tray and the Stream Deck (the latest recording); a key
  // in the car answers that they are made from the desk after the race.
  'tv-shots':           ({ source = 'streamdeck', folder = null } = {}) => (source === 'key' ? { ok: false, reason: obs.tvShots.IN_CAR } : startTvShots({ source, folder })),

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

// The actions that change the rig's page alone and are saved nowhere (a Stream Deck key on the rig's HUD: zoom, cycle, the
// pit box tabs, the commentary): the page OBS draws is told of them by the loopback listener's status, which carries the
// last of them with a number (remote-server.js, the page asks it once a second).
const HUD_PAGE_ACTIONS = new Set(['zoom-in', 'zoom-out', 'cycle-rating', 'cycle-car-logo', 'pitbox-next-tab', 'pitbox-prev-tab', 'dismiss-commentary']);
const hudPageActions = { seq: 0, recent: [] };
function noteHudAction(name) {
  if (!HUD_PAGE_ACTIONS.has(name)) return;
  hudPageActions.seq += 1;
  hudPageActions.recent.push({ n: hudPageActions.seq, name });
  if (hudPageActions.recent.length > 16) hudPageActions.recent.shift();
}

function _sendRenderer(channel) {
  noteHudAction(channel);
  if (!overlayWindow) return { ok: false, reason: 'no window' };
  overlayWindow.webContents.send(channel);
  return { ok: true };
}

/**
 * Execute a named action. Returns a result object.
 * @param {string} name — action name (e.g. 'toggle-overlay')
 * @returns {{ ok: boolean, reason?: string }}
 */
function dispatchAction(name, context = {}) {
  const handler = _actionHandlers[name];
  if (!handler) return { ok: false, reason: 'unknown action: ' + name };
  try {
    return handler(context);
  } catch (err) {
    logToFile(`[RacingDesk] Action error (${name}): ${err.message}`);
    return { ok: false, reason: err.message };
  }
}

// Expose dispatcher to remote-server.js for HTTP action API
remoteServer.setActionDispatcher(dispatchAction);

app.on('window-all-closed', () => {
  app.quit();
});

// ── The Stream Deck plugin, installed at every start ──
// From the unpacked copy beside the asar (electron-builder.yml asarUnpack): copied when the Stream Deck app has none,
// or not the one this build carries. modules/js/streamdeck-install.js has the rules; it failed at every start until
// 2026-09-30, copying from inside the asar.
function installStreamDeckPlugin() {
  try {
    const result = streamdeckInstall.install({
      srcDir: streamdeckInstall.pluginSource(__dirname),
      pluginsDir: streamdeckInstall.pluginsDir(),
      log: logToFile,
    });
    logToFile(`[RacingDesk] Stream Deck plugin: ${result.did} (${result.reason})`);
  } catch (err) {
    logToFile(`[RacingDesk] Stream Deck plugin install failed: ${err.message}`);
  }
}

// ── IPC: In the car or not ──
// Decided here (hud, above) and sent to the HUD's page as in-race-state on each change, and once more whenever
// the page has been loaded. A page asks for it as it starts, in case that was sent before it was listening.
// Nothing a page says shows or hides the window.
ipcMain.handle('get-in-race-state', async () => {
  return hud.state().inCar;
});

// ── IPC: Recording, for the desk's Recording card and masthead ──
// The status as it stands (recording:status) and the commands (recording:command: record, stop, toggle, saveReplay,
// setup, openObs, openFolder, chooseFolder, password). Each answers in words, never a rejection; the password's value is
// kept with safeStorage and never logged. Every change is pushed as recording-state. The desk window's alone.
ipcMain.handle('recording:status', async (event) => {
  if (!fromDesk(event)) return { error: 'Recording is the desk window\'s.' };
  return recordingStatus();
});

ipcMain.handle('recording:command', async (event, command, value) => {
  if (!fromDesk(event)) return { ok: false, reason: 'Recording is the desk window\'s.' };
  try {
    switch (command) {
      case 'record': return await recording.record({ source: 'desk' });
      case 'stop': return await recording.stop();
      case 'toggle': return await recording.toggle({ source: 'desk' });
      case 'saveReplay': return await recording.saveReplay({ source: 'desk' });
      case 'setup': { const answer = await setupObs(); tellDeskRecording(); return answer; }
      case 'openObs': { const answer = await openObs(); tellDeskRecording(); return answer; }
      case 'openFolder': {
        const folder = recordingFolder();
        try { fs.mkdirSync(folder, { recursive: true }); } catch (e) { return { ok: false, reason: `The folder ${folder} could not be made: ${e.message}` }; }
        await shell.openPath(folder);
        return { ok: true };
      }
      case 'chooseFolder': {
        const owner = deskWindow && !deskWindow.isDestroyed() ? deskWindow : null;
        const options = { title: 'Where recordings go', properties: ['openDirectory', 'createDirectory'], defaultPath: recordingFolder() };
        const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
        if (result.canceled || !result.filePaths.length) return { ok: false, reason: 'No folder was chosen.' };
        saveSettingsKeySync('recordingFolder', result.filePaths[0]);
        setupLookedAt = { at: 0, value: null };
        // Hours left are about the drive OBS records to, which is this folder only once Set up OBS has pointed it here.
        recording.refreshFree().then(() => tellDeskRecording());
        return { ok: true, folder: result.filePaths[0] };
      }
      case 'password': { const answer = setObsPassword(value); tellDeskRecording(); return answer; }
      case 'tvShots': { const answer = await startTvShots({ source: 'desk', folder: value && typeof value === 'object' ? value.folder : null }); tellDeskRecording(); return answer; }
      case 'tvShotsCancel': { const answer = tvShots.cancel(); tellDeskRecording(); return answer; }
      case 'recordingFor': return { ok: true, recording: recordingForRace(value && typeof value === 'object' ? value : null) };
      case 'openRecording': {
        // The race's own folder, opened in Explorer: one of the recordings folder's, and nothing else.
        const where = value && typeof value === 'object' && typeof value.folder === 'string' ? path.resolve(value.folder) : null;
        const root = path.resolve(recordingFolder());
        if (!where || path.relative(root, where).startsWith('..') || path.isAbsolute(path.relative(root, where)) || !fs.existsSync(where)) return { ok: false, reason: 'That is not a recording\'s folder.' };
        await shell.openPath(where);
        return { ok: true };
      }
      default: return { ok: false, reason: `Unknown command: ${String(command)}` };
    }
  } catch (err) {
    logToFile(`[RacingDesk] Recording command ${command} failed: ${err.message}`);
    return { ok: false, reason: err.message };
  }
});

// ── IPC: The HUD's screen ──
// For the desk's Settings page: the screens connected, by a plain name, and the one the HUD is on and why.
ipcMain.handle('get-hud-displays', async () => hudScreen.describe());

// Settings popout / Moza manager windows + the settings-changed relay
// were removed alongside the in-overlay settings UI. Settings are edited
// on the desk's Settings page now, which saves through 'save-settings'
// below and reaches the HUD from there; the watcher picks up anything
// else that writes overlay-settings.json and broadcasts it to the
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
      logToFile('[RacingDesk] settings watcher: load failed: ' + e.message);
      return;
    }
    overlayWindow.webContents.send('settings-sync', withoutRemoteKey(settings));
    logToFile('[RacingDesk] settings-sync broadcast (file changed)');
    hudScreen.settingsChanged();
    if ((settings.obsHudSource === true) !== hudSourceWas) applyHudSource('the settings file changed', { fresh: settings.obsHudSource === true });
    else if (settings.obsHudSource === true && recordingSettings.hudViewOf(settings) !== hudViewWas) applyHudSource('the choice changed in the settings file');
  });
}

// ── IPC: iRating / Safety Rating persistence ──
ipcMain.handle('get-rating-data', async () => {
  return loadRatingData();
});

ipcMain.handle('save-rating-data', async (event, data) => {
  if (typeof data !== 'object' || data === null) {
    logToFile('[RacingDesk] Warning: save-rating-data received invalid data');
    return;
  }
  saveRatingData(data);
});

// ── IPC: App version (from package.json, stamped by CI from git tag) ──
ipcMain.handle('get-version', () => app.getVersion());

// ── IPC: Settings persistence ──
ipcMain.handle('get-settings', async () => {
  try {
    return withoutRemoteKey(JSON.parse(fs.readFileSync(getSettingsPath(), 'utf8')));
  } catch (e) {
    return null;
  }
});

ipcMain.handle('save-settings', async (event, settings) => {
  // The file is replaced whole (no merge), so a null or non-object would wipe it
  if (typeof settings !== 'object' || settings === null) {
    logToFile('[RacingDesk] Warning: save-settings received invalid data');
    return false;
  }
  // A page saves the file whole, from the copy it read a moment before. The iPad view's keys are not a page's to
  // set, and one changed in that moment — a new key for the address — must not be put back as it was.
  const onDisk = loadSettingsSync();
  for (const key of PRIVATE_SETTINGS) {
    if (key in onDisk) settings[key] = onDisk[key];
    else delete settings[key];
  }
  const hudSourceBefore = onDisk.obsHudSource === true;
  const hudViewBefore = recordingSettings.hudViewOf(onDisk);
  saveSettingsSync(settings);
  if ((settings.obsHudSource === true) !== hudSourceBefore) applyHudSource('the switch', { fresh: settings.obsHudSource === true });
  // The choice of what OBS draws, with the switch on: the source's address and size change, and the item is placed or
  // fitted as the choice asks (hud-source.js). Not `fresh`: the collection it is in stays the one.
  else if (settings.obsHudSource === true && recordingSettings.hudViewOf(settings) !== hudViewBefore) applyHudSource('the choice');
  // The desk's Settings page saves through here, and the watcher below ignores our own writes — so tell the
  // HUD directly; it re-applies on settings-sync (modules/js/settings.js).
  if (overlayWindow && !overlayWindow.isDestroyed() && event.sender !== overlayWindow.webContents) {
    overlayWindow.webContents.send('settings-sync', withoutRemoteKey(settings));
  }
  // A different screen for the HUD takes effect now, and the answer waits for it so that the desk can say where the
  // HUD is. No more than the sim's short answer is waited for.
  await hudScreen.settingsChanged();
  return true;
});

// ── IPC: Dashboard mode query (legacy, returns 'build') ──
ipcMain.handle('get-dashboard-mode', async () => {
  return 'build';
});

// ── IPC: Paints — the livery manager on the desk's Cars page ──
// The UI (apps/paints/src, bundled into the desk by apps/paints/build-island.mjs) asks for everything over
// paints:invoke; modules/js/paints does the file work, in this process. modules/js/paints-ipc.js says which names
// may be called and how their arguments are passed on. The handler answers { value } or { error } rather than
// throwing, because Electron would otherwise wrap a thrown error's message in its own; preload.js turns { error }
// back into a rejection carrying the command's message, which is what the UI shows.
// The page's list of cars is every car the rig knows (modules/js/paints/catalogue.js), named from the local store:
// the host the app found or started serves the names at /racing-desk/data/cars. Asked with a 3 s limit and kept
// for a minute; with no host answering the list shows folder names. The install is the one the iracing://
// registration points at, unless `paints.installDir` in overlay-settings.json names another.
const carNames = createCarNames({ host: () => hostUrl || localHostUrl() });
const paintsCommands = paints.createCommands({
  carNames,
  installRoot: () => (loadSettingsSync().paints || {}).installDir,
  // The hashes of the library's paints, beside the backups: a library is hundreds of files, hashed in this
  // process, and is hashed once.
  hashes: (() => {
    try { return path.join(path.dirname(paints.apply.backupsBase()), 'hashes.json'); } catch (e) { return null; }
  })(),
  // Where an update puts files that are in the library's way — untracked files an incoming one would be written over
  // — at %LOCALAPPDATA%\Racing Desk\library-set-aside, in a folder of its own for each. Moved there, never deleted.
  setAside: (() => {
    try { return path.join(path.dirname(path.dirname(paints.apply.backupsBase())), 'library-set-aside'); } catch (e) { return null; }
  })(),
});
// What the manager remembers (the two folders, the customer id, the apply options) is the `paints` key of
// overlay-settings.json, beside the HUD's settings. The file is rewritten whole; every other key is kept, and the
// HUD ignores the write (the watcher skips this process's own writes, and nothing of the HUD's changed).
const paintsStore = {
  get: () => loadSettingsSync().paints || {},
  // Refuses when the file is there but unreadable, rather than replace the HUD's settings with { paints }.
  set: (obj) => saveSettingsKeySync('paints', obj),
};

// ── The livery behind the car badge (modules/js/logo-livery.js) ──
// The square under the car's logo on the HUD shows a section of the paint the sim is showing on his car — the
// paint folder's car_<customer id>.tga for the car he is in, cropped to a window with artwork in it — chosen here,
// in a worker, when he gets in the car and when the car changes, and never by the page: the page reads no file and
// builds no path. It is handed to the HUD's page as a data URL (logo-livery, and get-logo-livery for a page that
// loaded after), and served to the iPad from memory at one fixed address (remote-server.js, /livery-crop.png). The
// paint folder and the customer id are the desk's paint settings; the car's folder is what the host's car-controls
// key names, or the store's name for the car. With any of the three missing the badge is the maker's colour, as it
// was. No log line carries the customer id or the paint's path.
const livery = logoLivery.createLogoLivery({
  paintDir: () => (loadSettingsSync().paints || {}).paintDir,
  customerId: () => (loadSettingsSync().paints || {}).customerId,
  carNames,
  onCrop: (crop) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.webContents.send('logo-livery', crop ? crop.dataUrl : null);
  },
  log: logToFile,
});

ipcMain.handle('get-logo-livery', async () => {
  const crop = livery.current();
  return crop ? crop.dataUrl : null;
});

// These are the desk window's. The HUD shares the preload, and has no business with the paint folder.
const fromDesk = (event) => !!deskWindow && !deskWindow.isDestroyed() && event.sender === deskWindow.webContents;

ipcMain.handle('paints:invoke', async (event, name, args) => {
  if (!fromDesk(event)) return { error: 'Paints belongs to the desk window.' };
  try {
    return { value: await paintsIpc.invoke(paintsCommands, paintsStore, name, args) };
  } catch (err) {
    return { error: paints.error.messageOf(err) };
  }
});

// The folder picker for the paint folder and the library; null when it is cancelled.
ipcMain.handle('paints:pickFolder', async (event, options) => {
  if (!fromDesk(event)) return null;
  const dialogOptions = { properties: ['openDirectory'] };
  if (options && typeof options.title === 'string') dialogOptions.title = options.title;
  if (options && typeof options.defaultPath === 'string') dialogOptions.defaultPath = options.defaultPath;
  const owner = deskWindow && !deskWindow.isDestroyed() ? deskWindow : null;
  const result = owner ? await dialog.showOpenDialog(owner, dialogOptions) : await dialog.showOpenDialog(dialogOptions);
  return result.canceled || !result.filePaths.length ? null : result.filePaths[0];
});

// Show a file in Explorer, or open a folder — only for paths that exist. Opening is for folders alone:
// shell.openPath on a file runs it, and nothing the manager does calls for that.
ipcMain.handle('paints:reveal', async (event, p) => {
  if (fromDesk(event) && typeof p === 'string' && fs.existsSync(p)) shell.showItemInFolder(p);
});

ipcMain.handle('paints:openPath', async (event, p) => {
  if (!fromDesk(event) || typeof p !== 'string') return;
  let isFolder = false;
  try { isFolder = fs.statSync(p).isDirectory(); } catch (e) { /* not there */ }
  if (isFolder) await shell.openPath(p);
});

// ── IPC: Rig — a car's view and pedals, on the desk's Cars page ──
// What the host has recorded per car is asked for by this process (modules/js/rig-api.js), not by the page: the
// page builds no address of its own, and the host it is asked of is one on this machine. rig:read answers the
// host's cars, views, pedals and the canonical list of cars with what its check has said of them, each as
// { value }, { missing: true } or { error }. The one write — which
// SmartControl profile a car is driven with — comes through here too: the host answers 403 to any request
// carrying an Origin header, which every request from a page does. It answers { ok: true, car } or
// { ok: false, error }; neither ever throws, and the page shows what it is given beside the car.
const rig = rigApi.createRigApi({ host: () => localHostUrl() });
const RIG_NOT_DESK = 'The Cars page belongs to the desk window.';

// The desk's own reads of the host's store — status, sessions, the schedule, one session's laps — are asked for here too
// (modules/js/desk-reads.js): the host answers programs on this machine and no page, the desk's included, because a file's page
// says Origin: null and so does a web page that is redirected, sandboxed or opened from disk. Answered { value }, or
// { error } with notHere / noAnswer / status; never thrown.
const deskReader = createDeskReads({ host: () => localHostUrl() });

ipcMain.handle('desk:read', async (event, name, id) => {
  if (!fromDesk(event)) return { error: 'These reads belong to the desk window.' };
  return deskReader.read(name, id);
});

ipcMain.handle('rig:read', async (event) => {
  if (!fromDesk(event)) return rigApi.unread(RIG_NOT_DESK);
  return rig.read();
});

ipcMain.handle('rig:bindPedals', async (event, carPath, profileId) => {
  if (!fromDesk(event)) return { ok: false, error: RIG_NOT_DESK };
  // A car path of 1–200 characters; a profile id of at most 200, or null for none. Nothing else is sent on.
  const problem = rigApi.bindingProblem(carPath, profileId);
  if (problem) return { ok: false, error: problem };
  return rig.bindPedals(carPath, profileId);
});

// ── IPC: the runtime's ?action= routes, for the HUD ──
// The runtime (the SimHub plugin, or the host) answers a request for one of its ?action= routes only when a program on this
// machine made it, and a page's request is not one: it carries an Origin, "null" for a file. So the HUD's own calls —
// restartdemo, setrect, and the pedal profiles — are asked for here, by Node (modules/js/runtime-actions.js), which
// sends none. Only those routes, with their arguments checked, of a runtime on this machine; answered { ok, body } or
// { ok: false, error }, and never thrown. The HUD's window and the desk's ask; nothing else has a preload.
const hudActions = runtimeActions.createRuntimeActions({
  // The address the HUD reads its telemetry from, which dev mode sends to the replay: the actions go where its polls go.
  url: () => hudVisibility.telemetryUrl(loadSettingsSync().simhubUrl, { replayPort: devMode ? devMode.readArgs().replayPort : null }),
});
const fromHud = (event) => !!overlayWindow && !overlayWindow.isDestroyed() && event.sender === overlayWindow.webContents;

ipcMain.handle('runtime:action', async (event, name, params) => {
  if (!fromHud(event) && !fromDesk(event)) return { ok: false, error: 'The runtime is asked from the HUD and the desk alone.' };
  return hudActions.run(name, params);
});

// ── IPC: Open external URL in user's default browser ──
ipcMain.handle('open-external', async (event, urlStr) => {
  try {
    if (isAllowedExternalUrl(urlStr)) await shell.openExternal(urlStr);
  } catch (e) {
    // no handler for the scheme (the iRacing UI not installed) — silently reject
  }
});

// ═══════════════════════════════════════════════════════════════
// ── IPC: Remote Dashboard Server ──
// The desk's Settings page switches it on and off, and shows the address. Each answers with the server as it
// now stands — { running, enabled, port, url, addresses, error } — and `success`; what went wrong is in `error`,
// in words, not a rejection. Only the desk window may ask: the address holds the key.
const REMOTE_NOT_DESK = { success: false, error: 'The iPad view is switched from the desk window.' };
const validPort = (port) => Number.isInteger(port) && port >= 1024 && port <= 65535;

ipcMain.handle('get-remote-server-info', async (event) => {
  if (!fromDesk(event)) return REMOTE_NOT_DESK;
  return { success: true, ...remoteServerInfo() };
});

ipcMain.handle('start-remote-server', async (event, opts) => {
  if (!fromDesk(event)) return REMOTE_NOT_DESK;
  const port = opts && opts.port !== undefined ? opts.port : undefined;
  if (port !== undefined && !validPort(port)) {
    return { success: false, ...remoteServerInfo(), error: 'A port is a whole number from 1024 to 65535.' };
  }
  try {
    // Another port is another server: the one that is up goes first.
    if (port !== undefined && remoteServer.isRunning() && remoteServer.getInfo().port !== port) await remoteServer.stop();
    await startRemoteServer(port);
    saveSettingsKeySync('remoteServer', true);
    if (port !== undefined) saveSettingsKeySync('remoteServerPort', port);
    return { success: true, ...remoteServerInfo() };
  } catch (err) {
    return { success: false, ...remoteServerInfo(), error: err.message };
  }
});

ipcMain.handle('stop-remote-server', async (event) => {
  if (!fromDesk(event)) return REMOTE_NOT_DESK;
  try {
    await remoteServer.stop();
    remoteServerError = null;
    saveSettingsKeySync('remoteServer', false);
    return { success: true, ...remoteServerInfo() };
  } catch (err) {
    return { success: false, ...remoteServerInfo(), error: err.message };
  }
});

// A new key: every address handed out before stops working, on every device that had one.
ipcMain.handle('renew-remote-server-key', async (event) => {
  if (!fromDesk(event)) return REMOTE_NOT_DESK;
  try {
    const running = remoteServer.isRunning();
    if (running) await remoteServer.stop();
    remoteServerKey(true);
    if (running) await startRemoteServer();
    return { success: true, ...remoteServerInfo() };
  } catch (err) {
    return { success: false, ...remoteServerInfo(), error: err.message };
  }
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
