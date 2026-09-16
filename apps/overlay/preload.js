// ═══════════════════════════════════════════════════════════════
// K10 Motorsports — Preload Script
// Exposes safe IPC bridge to the HTML dashboard
// ═══════════════════════════════════════════════════════════════

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('k10', {
  // App version (read from package.json by Electron)
  getVersion: () => ipcRenderer.invoke('get-version'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  // Dashboard mode (legacy, returns 'build')
  getDashboardMode: () => ipcRenderer.invoke('get-dashboard-mode'),
  // Open URL in user's default browser
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  // Global hotkey listeners (forwarded from main process)
  onRestartDemo: (callback) => {
    ipcRenderer.on('restart-demo', () => callback());
  },
  onResetTrackmap: (callback) => {
    ipcRenderer.on('reset-trackmap', () => callback());
  },
  // iRating / Safety Rating
  getRatingData: () => ipcRenderer.invoke('get-rating-data'),
  saveRatingData: (data) => ipcRenderer.invoke('save-rating-data', data),
  onToggleRatingEditor: (callback) => {
    ipcRenderer.on('toggle-rating-editor', () => callback());
  },
  onToggleDriveMode: (callback) => {
    ipcRenderer.on('toggle-drive-mode', () => callback());
  },
  // Discord OAuth2 (legacy — still works for community features)
  discordConnect: () => ipcRenderer.invoke('discord-connect'),
  discordDisconnect: () => ipcRenderer.invoke('discord-disconnect'),
  getDiscordUser: () => ipcRenderer.invoke('get-discord-user'),
  // K10 Pro Drive OAuth2 (website account → pro features)
  k10Connect: () => ipcRenderer.invoke('k10-connect'),
  k10Disconnect: () => ipcRenderer.invoke('k10-disconnect'),
  getK10User: () => ipcRenderer.invoke('get-k10-user'),
  getK10Token: () => ipcRenderer.invoke('get-k10-token'),
  verifyK10Token: () => ipcRenderer.invoke('verify-k10-token'),
  // Remote dashboard server (iPad/tablet access)
  getRemoteServerInfo: () => ipcRenderer.invoke('get-remote-server-info'),
  startRemoteServer: (opts) => ipcRenderer.invoke('start-remote-server', opts),
  stopRemoteServer: () => ipcRenderer.invoke('stop-remote-server'),
  // (Dashboard + settings popout windows removed — the WinUI host owns
  // that surface. The renderer just listens for settings-sync to pick
  // up live changes the host writes to overlay-settings.json.)
  notifySettingsChanged: (settings) => ipcRenderer.invoke('settings-changed', settings),
  onSettingsSync: (callback) => {
    ipcRenderer.on('settings-sync', (event, settings) => callback(settings));
  },
  // Layout v2 — canonical module registry (ids → DOM selectors) and
  // measured-geometry reporting for the host editor's pixel-exact
  // proxies (written to the overlay-metrics.json sidecar, never into
  // overlay-settings.json). See prodrive-windows/docs/overlay-layout-v2.md.
  getLayoutRegistry: () => ipcRenderer.invoke('get-layout-registry'),
  reportLayoutMetrics: (metrics) => ipcRenderer.invoke('report-layout-metrics', metrics),
  // Ambient light — screen capture moved to C# plugin (ScreenColorSampler).
  // Color data now arrives via poll JSON (DS.AmbientR/G/B), no IPC needed.
  // Moza hardware manager window
  openMozaManager: () => ipcRenderer.invoke('open-moza-manager'),
  onMozaManagerClosed: (callback) => {
    ipcRenderer.on('moza-manager-closed', () => callback());
  },
  // ── Stream Deck actions (new IPC channels) ──
  onPitboxNextTab: (callback) => { ipcRenderer.on('pitbox-next-tab', () => callback()); },
  onPitboxPrevTab: (callback) => { ipcRenderer.on('pitbox-prev-tab', () => callback()); },
  onDismissCommentary: (callback) => { ipcRenderer.on('dismiss-commentary', () => callback()); },
  onCycleRating: (callback) => { ipcRenderer.on('cycle-rating', () => callback()); },
  onCycleCarLogo: (callback) => { ipcRenderer.on('cycle-car-logo', () => callback()); },
  onZoomIn: (callback) => { ipcRenderer.on('zoom-in', () => callback()); },
  onZoomOut: (callback) => { ipcRenderer.on('zoom-out', () => callback()); },
  onToggleLeaderboard: (callback) => { ipcRenderer.on('toggle-leaderboard', () => callback()); },
  onPresetBroadcast: (callback) => { ipcRenderer.on('preset-broadcast', () => callback()); },
  onPresetPractice: (callback) => { ipcRenderer.on('preset-practice', () => callback()); },
  onPresetQualifying: (callback) => { ipcRenderer.on('preset-qualifying', () => callback()); },
  // Stream Deck plugin install
  installStreamDeckPlugin: () => ipcRenderer.invoke('install-streamdeck-plugin'),
  // In-car state — drives overlay-window show/hide. Renderer → main:
  // called by poll-engine on every debounced in-car flip.
  notifyInRaceState: (isInRace) => ipcRenderer.invoke('notify-in-race-state', isInRace),
  // Main → renderer: subscribe to in-race flips (used by the web-app window
  // to render live session status without duplicating the polling logic).
  onInRaceState: (callback) => {
    ipcRenderer.on('in-race-state', (_event, isInRace) => callback(isInRace));
  },
  // Main → renderer: read the current in-race state synchronously on load
  // (so the web window can decide initial UI without waiting for a flip).
  getInRaceState: () => ipcRenderer.invoke('get-in-race-state'),
  // Screen recording
  startRecording: (opts) => ipcRenderer.invoke('start-recording', opts),
  stopRecording: () => ipcRenderer.invoke('stop-recording'),
  writeRecordingChunk: (buf) => ipcRenderer.invoke('write-recording-chunk', buf),
  getRecordingState: () => ipcRenderer.invoke('get-recording-state'),
  // Native-backend recording (WinUI host owns the FFmpeg pipeline).
  // Renderer calls these instead of the in-process recorder when
  // recordingBackend === 'native'. Host port is discovered via
  // settings.hostControlPort. See docs/recording-migration.md.
  startNativeRecording: (opts) => ipcRenderer.invoke('start-native-recording', opts),
  stopNativeRecording: () => ipcRenderer.invoke('stop-native-recording'),
  getNativeRecordingState: () => ipcRenderer.invoke('get-native-recording-state'),
  onToggleRecording: (callback) => {
    ipcRenderer.on('toggle-recording', () => callback());
  },
  onRecordingDebug: (callback) => {
    ipcRenderer.on('recording-debug', (_event, data) => callback(data));
    return () => {
      ipcRenderer.removeAllListeners('recording-debug');
    };
  },
  // FFmpeg transcode
  getFfmpegInfo: () => ipcRenderer.invoke('get-ffmpeg-info'),
  transcodeRecording: (webmPath, opts) => ipcRenderer.invoke('transcode-recording', webmPath, opts),
  onTranscodeProgress: (callback) => {
    ipcRenderer.on('transcode-progress', (_event, progress) => callback(progress));
  },
  // Telemetry sidecar (JSONL alongside video)
  sidecarStart: (filePath) => ipcRenderer.invoke('sidecar-start', filePath),
  sidecarWrite: (filePath, chunk) => ipcRenderer.send('sidecar-write', filePath, chunk),
  sidecarStop: (filePath) => ipcRenderer.invoke('sidecar-stop', filePath),
  // Replay buffer
  saveReplayBuffer: (opts) => ipcRenderer.invoke('save-replay-buffer', opts),
  onSaveReplayBuffer: (callback) => {
    ipcRenderer.on('save-replay-buffer', () => callback());
  },
  // Replay Director (Phase 5)
  startReplayDirector: (sidecarPath) => ipcRenderer.invoke('start-replay-director', sidecarPath),
  cancelReplayDirector: () => ipcRenderer.invoke('cancel-replay-director'),
  getReplayDirectorState: () => ipcRenderer.invoke('get-replay-director-state'),
  parseSidecarMoments: (sidecarPath) => ipcRenderer.invoke('parse-sidecar-moments', sidecarPath),
  onReplayDirectorProgress: (callback) => {
    ipcRenderer.on('replay-director-progress', (_event, progress) => callback(progress));
  },
  onReplayDirectorRecord: (callback) => {
    ipcRenderer.on('replay-director-record', (_event, data) => callback(data));
  },
  onToggleReplayDirector: (callback) => {
    ipcRenderer.on('toggle-replay-director', () => callback());
  },
  // Quit application
  quitApp: () => ipcRenderer.invoke('quit-app'),
});
