// ═══════════════════════════════════════════════════════════════
// K10 Motorsports — Auto-Updater (main process)
// Checks GitHub Releases for new overlay versions and installs
// updates with user confirmation.
// ═══════════════════════════════════════════════════════════════

let autoUpdater;

function initAutoUpdater(mainWindow, log) {
  // electron-updater is only available in packaged builds
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (e) {
    log('Auto-updater not available (dev mode) — skipping init');
    return;
  }

  autoUpdater.logger = { info: log, warn: log, error: log };
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    log('Checking for overlay updates…');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-status', { state: 'checking' });
    }
  });

  autoUpdater.on('update-available', (info) => {
    log(`Update available: v${info.version}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-status', {
        state: 'available',
        version: info.version,
        releaseNotes: info.releaseNotes || ''
      });
    }
  });

  autoUpdater.on('update-not-available', () => {
    log('Overlay is up to date.');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-status', { state: 'up-to-date' });
    }
  });

  autoUpdater.on('download-progress', (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-status', {
        state: 'downloading',
        percent: Math.round(progress.percent)
      });
    }
  });

  autoUpdater.on('update-downloaded', () => {
    log('Update downloaded — will install on next restart.');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-status', { state: 'ready' });
    }
  });

  autoUpdater.on('error', (err) => {
    log(`Auto-update error: ${err.message}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-status', {
        state: 'error',
        message: err.message
      });
    }
  });

  // Check once on startup (after a short delay to let the window load)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 10000);
}

function checkForUpdates() {
  if (autoUpdater) {
    return autoUpdater.checkForUpdates();
  }
  return Promise.reject(new Error('Auto-updater not initialized'));
}

function downloadUpdate() {
  if (autoUpdater) {
    return autoUpdater.downloadUpdate();
  }
  return Promise.reject(new Error('Auto-updater not initialized'));
}

function installAndRestart() {
  if (autoUpdater) {
    autoUpdater.quitAndInstall(false, true);
  }
}

module.exports = { initAutoUpdater, checkForUpdates, downloadUpdate, installAndRestart };
