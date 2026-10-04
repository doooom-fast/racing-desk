// The recording keys of overlay-settings.json, and the migration that brings a file from the Electron recorder's
// days to OBS's. Pure: no Electron, no file access of its own (migrateFile takes settings-file.js), so it runs in
// the unit tests.
//
// What the Electron recorder kept — its quality, encoder, output format, the mic, the game audio and the facecam
// devices and their volumes, the facecam's size and corner, the "native" backend and its control port — is OBS's
// now (his profile, his sources, his scene), and is deleted: a key the app no longer reads would otherwise sit in
// the file for ever, and `recordingBackend: "native"` with `hostControlPort: 50965` named a server nothing has
// listened on since July. The replay buffer is OBS's too; its switch keeps its meaning under a new name.
//
// Run once by main.js at start, before anything reads the file; `recordingSettingsVersion` says it has been. Version 3
// (stage 2) takes `recordingAutoStopOnPit` out: his rules of 2026-09-30 stop a recording on a new session, at the end
// of the race and when he leaves the car, and the pit lane is none of those. Version 4 (stage 3) adds the loopback
// listener's port and the TV shots' facecam switch. Version 5 adds what OBS draws under "HUD drawn by OBS" (the rig
// HUD or the iPad dashboard) and the panel-background slider for it, and takes `greenScreen` out: nothing read it
// (Ctrl+Shift+G flipped it and restarted the app, and the restart was all that happened).
const path = require('path');

const VERSION = 5;

// Deleted: the Electron recorder's own, the old WinUI app's control server, "stop in the pits", and the green-screen
// key nothing read.
const DELETED = Object.freeze([
  'recordingBackend', 'hostControlPort', 'recordingAutoStopOnPit',
  'recordingQuality', 'recordingEncoder', 'recordingOutputFormat', 'recordingDeleteSource',
  'recordingMic', 'recordingMicDevice', 'recordingMicLabel', 'recordingMicVolume',
  'recordingSystemAudioDevice', 'recordingSystemAudioLabel', 'recordingSystemVolume',
  'recordingWebcamDevice', 'recordingWebcamLabel', 'recordingFacecam', 'recordingFacecamSize', 'recordingFacecamPos',
  // The in-RAM buffer's length, which OBS's replay buffer (RecRBTime, 20 s, set by "Set up OBS") replaces.
  'replayBufferDuration', 'replayBufferSeconds',
  'greenScreen',
]);

// Renamed: the same meaning, under the name the OBS keeper reads.
const RENAMED = Object.freeze({
  replayBufferEnabled: 'recordingInstantReplay',
  recordingDirectory: 'recordingFolder',
});

// Added, with the value a file without them is read as.
const ADDED = Object.freeze({
  recordingInstantReplaySeconds: 20,   // OBS's RecRBTime, which Set up OBS writes
  recordingChapters: true,
  obsStartOnRecord: true,              // Record from the desk, the tray or the Stream Deck starts OBS when it is closed
  obsStartWithApp: false,              // no longer read: OBS starts with Racing Desk while recordingAutoRecord is on (2026-10-03)
  obsPath: null,                       // null: the default install, C:\Program Files\obs-studio
  obsHudSource: false,                 // "HUD drawn by OBS": the HUD as a browser source in his scenes, off unless he turns it on
  localServerPort: 9091,               // the listener on 127.0.0.1 for the Stream Deck and the OBS page (remote-server.js)
  tvShotsHideFacecam: true,            // the facecam hidden while a TV take is recorded, and put back after
  obsHudView: 'rig',                   // what OBS draws with the switch on: the rig HUD ('rig') or the iPad dashboard ('ipad')
  obsPanelBackground: 90,              // how solid the panels are in the page OBS draws, 0 to 100 (90: as they have always been)
});

// What OBS may draw under "HUD drawn by OBS", and the word the file holds for each.
const HUD_VIEWS = Object.freeze(['rig', 'ipad']);

/** The choice as the file has it, read strictly: 'ipad' only when it says so, else 'rig'. */
function hudViewOf(settings) {
  return settings && settings.obsHudView === 'ipad' ? 'ipad' : 'rig';
}

// Kept as it is: recordingAutoRecord (on unless set to false; the keeper reads `!== false`).

const DEFAULT_FOLDER_DRIVE = 'D:\\';
const DEFAULT_FOLDER_ON_D = 'D:\\Racing Desk\\Recordings';

/**
 * The settings with the recording keys as this build reads them. Returns { settings, changed, removed, renamed,
 * added }; `settings` is a new object, the one given is left as it was.
 */
function migrate(settings) {
  const input = settings !== null && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
  const next = { ...input };
  const removed = [];
  const renamed = [];
  const added = [];
  if ((Number(next.recordingSettingsVersion) || 0) >= VERSION) {
    return { settings: next, changed: false, removed, renamed, added };
  }
  for (const key of DELETED) {
    if (key in next) { delete next[key]; removed.push(key); }
  }
  for (const [from, to] of Object.entries(RENAMED)) {
    if (!(from in next)) continue;
    const value = next[from];
    delete next[from];
    // A folder is kept only when there is one; the old default was an empty string for "the Videos folder".
    const keep = from === 'recordingDirectory' ? typeof value === 'string' && value.trim() !== '' : typeof value === 'boolean';
    if (keep && !(to in next)) { next[to] = from === 'recordingDirectory' ? value.trim() : value; renamed.push([from, to]); }
    else removed.push(from);
  }
  for (const [key, value] of Object.entries(ADDED)) {
    if (!(key in next)) { next[key] = value; added.push(key); }
  }
  next.recordingSettingsVersion = VERSION;
  return { settings: next, changed: true, removed, renamed, added };
}

/**
 * Migrate the file in place, through settings-file.js (atomic, and a file that is there but unreadable is left as
 * it is: nothing is written over what might still be recovered). Returns migrate's result with `state`.
 */
function migrateFile(file, { settingsFile }) {
  const { settings, state } = settingsFile.read(file);
  if (state === 'unreadable') return { settings: {}, changed: false, removed: [], renamed: [], added: [], state };
  const result = migrate(settings);
  if (result.changed) settingsFile.save(file, result.settings);
  return { ...result, state };
}

/**
 * Where recordings go: the folder he set, else D:\Racing Desk\Recordings while there is a D: drive (his 418 GB
 * one; C: holds about ninety minutes at his bitrate), else a Racing Desk folder in his Videos.
 */
function recordingFolder(settings, { exists, home }) {
  const set = settings && typeof settings.recordingFolder === 'string' ? settings.recordingFolder.trim() : '';
  if (set) return set;
  if (exists(DEFAULT_FOLDER_DRIVE)) return DEFAULT_FOLDER_ON_D;
  return path.join(home, 'Videos', 'Racing Desk');
}

module.exports = { VERSION, DELETED, RENAMED, ADDED, HUD_VIEWS, DEFAULT_FOLDER_ON_D, migrate, migrateFile, recordingFolder, hudViewOf };
