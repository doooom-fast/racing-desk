// ═══════════════════════════════════════════════════════════════
// The Racing Desk — Preload Script
// Exposes safe IPC bridge to the HUD (dashboard.html) and the desk (desk.html)
// ═══════════════════════════════════════════════════════════════

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('racingDesk', {
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
  // Remote dashboard server (iPad/tablet access)
  getRemoteServerInfo: () => ipcRenderer.invoke('get-remote-server-info'),
  startRemoteServer: (opts) => ipcRenderer.invoke('start-remote-server', opts),
  stopRemoteServer: () => ipcRenderer.invoke('stop-remote-server'),
  // (Dashboard + settings popout windows removed — the desk's Settings
  // page owns that surface. The renderer just listens for settings-sync
  // to pick up changes to overlay-settings.json: the desk's saves, sent
  // on by main.js's save-settings handler, and anything else the file
  // watcher sees.)
  notifySettingsChanged: (settings) => ipcRenderer.invoke('settings-changed', settings),
  onSettingsSync: (callback) => {
    ipcRenderer.on('settings-sync', (event, settings) => callback(settings));
  },
  // Desk window: main.js asks for a page (tray menu → Paints / Settings) while the window is already open.
  onShowPage: (callback) => {
    ipcRenderer.on('show-page', (_event, page) => callback(page));
  },
  // Desk window, Paints page: the livery manager's commands (modules/js/paints, dispatched by main.js's
  // paints:invoke) and the bits of the shell it needs. main.js answers { value } or { error } — Electron would
  // otherwise wrap a thrown error's message in its own — so invoke rejects with the command's own message here.
  paints: {
    invoke: async (name, args) => {
      const result = await ipcRenderer.invoke('paints:invoke', name, args);
      if (result && result.error !== undefined) throw new Error(result.error);
      return result ? result.value : undefined;
    },
    pickFolder: (options) => ipcRenderer.invoke('paints:pickFolder', options),
    reveal: (p) => ipcRenderer.invoke('paints:reveal', p),
    openPath: (p) => ipcRenderer.invoke('paints:openPath', p),
  },
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
